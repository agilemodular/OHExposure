import { z } from 'zod';
import { audit, can, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { AppError, conflict, forbidden, invalid, notFound } from '../errors.js';
import { calibrationValidAt } from './instruments.js';
import { isValidTz, optNum, optStr, optUuid, parse, reqStr, uuid, zonedToUtc } from './util.js';

const localDT = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()).transform((v) => v ?? null);

export const samplingInput = z.object({
  client_uuid: optUuid,
  plan_id: optUuid,
  sample_code: reqStr(1, 60),
  sample_type: z.enum(['personal', 'static', 'field_blank', 'other']),
  worker_id: optUuid,
  group_id: optUuid,
  location_desc: optStr,
  substance_id: optUuid,
  method_version_id: optUuid,
  instrument_id: optUuid,
  media_lot: optStr,
  timezone: z.string().refine(isValidTz, 'Unknown time zone').default('Europe/London'),
  start_local: localDT,
  end_local: localDT,
  interruptions: z.preprocess((v) => (typeof v === 'string' ? (v.trim() ? JSON.parse(v) : []) : v ?? []),
    z.array(z.object({ start: z.string(), end: z.string(), reason: z.string().optional() }))),
  tasks_performed: optStr,
  flow_pre_lpm: optNum,
  flow_post_lpm: optNum,
  control_status: optStr,
  operating_conditions: optStr,
  deviations: optStr,
  notes: optStr,
  handover_to: optStr,
  handover_local: localDT,
});
export type SamplingInput = z.infer<typeof samplingInput>;

const FIELD_COLUMNS = ['plan_id', 'sample_code', 'sample_type', 'worker_id', 'group_id_at_sampling', 'location_desc', 'substance_id', 'method_version_id', 'instrument_id', 'media_lot',
  'start_at', 'end_at', 'timezone', 'interruptions', 'tasks_performed', 'flow_pre_lpm', 'flow_post_lpm', 'control_status', 'operating_conditions', 'deviations', 'notes', 'handover_to', 'handover_at'] as const;

/** Normalises and validates a capture against server state; returns column values and warnings (never hidden). */
async function prepare(tx: Tx, a: Actor, d: SamplingInput) {
  const tz = d.timezone;
  const start_at = d.start_local ? zonedToUtc(d.start_local, tz) : null;
  const end_at = d.end_local ? zonedToUtc(d.end_local, tz) : null;
  if (start_at && end_at && Date.parse(end_at) <= Date.parse(start_at)) throw invalid('Finish time must be after start time');
  const interruptions = d.interruptions.map((i) => ({ start: zonedToUtc(i.start, tz), end: zonedToUtc(i.end, tz), reason: i.reason ?? '' }));
  for (const i of interruptions) if (Date.parse(i.end) <= Date.parse(i.start)) throw invalid('Each interruption must end after it starts');
  if (d.flow_pre_lpm != null && d.flow_pre_lpm <= 0) throw invalid('Flow rate must be positive');
  if (d.flow_post_lpm != null && d.flow_post_lpm <= 0) throw invalid('Flow rate must be positive');

  const warnings: string[] = [];
  let clientId: string;
  if (d.plan_id) {
    const p = await one(tx, 'select client_id, status from monitoring_plans where id=$1', [d.plan_id]);
    if (!p) throw notFound('Plan');
    if (['draft', 'cancelled', 'completed'].includes(p.status)) throw invalid(`Samples cannot be captured against a ${p.status} plan`);
    clientId = p.client_id;
  } else if (d.worker_id) {
    clientId = (await one(tx, 'select client_id from workers where id=$1', [d.worker_id]))?.client_id;
  } else {
    clientId = a.clientId ?? (await one(tx, 'select id from clients where is_default limit 1'))?.id;
  }
  if (!clientId) throw invalid('Unable to determine the client for this sample; select a plan');

  if (d.sample_type === 'personal' && !d.worker_id && (start_at || end_at)) throw invalid('Personal samples require a worker reference');
  let group = d.group_id;
  if (group) {
    const g = await one(tx, 'select client_id from exposure_groups where id=$1', [group]);
    if (!g) throw notFound('Exposure group');
    if (g.client_id !== clientId) throw invalid('The exposure group belongs to a different client from this sample');
  }
  if (d.worker_id) {
    const w = await one(tx, 'select client_id from workers where id=$1', [d.worker_id]);
    if (!w) throw notFound('Worker');
    if (w.client_id !== clientId) throw invalid('Worker belongs to a different client from the plan');
    if (!group && start_at) {
      const gs = await many(tx, `select group_id from group_memberships where worker_id=$1 and valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)`, [d.worker_id, start_at.slice(0, 10)]);
      if (gs.length === 1) group = gs[0].group_id;
      else if (gs.length > 1) warnings.push('Worker belongs to more than one exposure group on this date; select the group sampled.');
      else warnings.push('Worker had no exposure-group membership on the sampling date.');
    }
  }
  if (d.instrument_id) {
    const inst = await one(tx, 'select asset_tag, status, screening_only from instruments where id=$1', [d.instrument_id]);
    if (!inst) throw notFound('Instrument');
    if (inst.status !== 'in_service') {
      if (!d.deviations) throw invalid(`Instrument ${inst.asset_tag} is ${inst.status.replace('_', ' ')}; record a deviation to use it`);
      warnings.push(`Instrument ${inst.asset_tag} is ${inst.status.replace('_', ' ')}.`);
    }
    if (start_at) {
      const cal = await calibrationValidAt(tx, d.instrument_id, start_at);
      if (cal === null) warnings.push(`No calibration evidence for ${inst.asset_tag} on the sampling date.`);
      else if (!cal) warnings.push(`Calibration for ${inst.asset_tag} was expired or failed on the sampling date.`);
    }
    if (inst.screening_only) warnings.push(`${inst.asset_tag} is screening-only; results will be indicative.`);
  }
  if (d.method_version_id && d.flow_pre_lpm != null) {
    const mv = await one(tx, 'select flow_rate_lpm_min, flow_rate_lpm_max from sampling_method_versions where id=$1', [d.method_version_id]);
    if (mv?.flow_rate_lpm_min != null && d.flow_pre_lpm < mv.flow_rate_lpm_min) warnings.push('Pre-sampling flow is below the method range.');
    if (mv?.flow_rate_lpm_max != null && d.flow_pre_lpm > mv.flow_rate_lpm_max) warnings.push('Pre-sampling flow is above the method range.');
  }
  const status = d.sample_type === 'field_blank' ? (end_at || start_at ? 'collected' : 'planned')
    : end_at && (d.flow_post_lpm != null || d.sample_type === 'other') ? 'collected' : start_at ? 'in_progress' : 'planned';
  const values: Record<(typeof FIELD_COLUMNS)[number], unknown> = {
    plan_id: d.plan_id, sample_code: d.sample_code, sample_type: d.sample_type, worker_id: d.worker_id, group_id_at_sampling: group,
    location_desc: d.location_desc, substance_id: d.substance_id, method_version_id: d.method_version_id, instrument_id: d.instrument_id,
    media_lot: d.media_lot, start_at, end_at, timezone: tz, interruptions: JSON.stringify(interruptions), tasks_performed: d.tasks_performed,
    flow_pre_lpm: d.flow_pre_lpm, flow_post_lpm: d.flow_post_lpm, control_status: d.control_status, operating_conditions: d.operating_conditions,
    deviations: d.deviations, notes: d.notes, handover_to: d.handover_to, handover_at: d.handover_local ? zonedToUtc(d.handover_local, tz) : null,
  };
  return { clientId, values, status, warnings };
}

async function insertEvent(tx: Tx, a: Actor, d: SamplingInput, offline: boolean) {
  const { clientId, values, status, warnings } = await prepare(tx, a, d);
  const cols = [...FIELD_COLUMNS, 'tenant_id', 'client_id', 'status', 'client_uuid', 'captured_offline', 'created_by'];
  const vals = [...FIELD_COLUMNS.map((c) => values[c]), a.tenantId, clientId, status, d.client_uuid, offline, a.userId];
  try {
    const r = await one(tx, `insert into sampling_events (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`, vals);
    if (status === 'collected') await custody(tx, a, r, 'collected', values.end_at as string, null, 'Captured at end of sampling');
    if (values.handover_to) await custody(tx, a, r, 'handed_over', (values.handover_at as string) ?? (values.end_at as string) ?? new Date().toISOString(), values.handover_to as string, values.handover_at ? null : 'Handover time not recorded; end of sampling used');
    await audit(tx, a, offline ? 'sample.create_offline' : 'sample.create', 'sampling_event', r.id, { sample_code: d.sample_code, warnings });
    return { event: r, warnings };
  } catch (e: any) {
    if (e.code === '23505' && String(e.constraint).includes('sample_code')) throw conflict(`Sample code ${d.sample_code} already exists`);
    throw e;
  }
}

async function custody(tx: Tx, a: Actor, ev: any, event: string, at: string, party: string | null, notes: string | null, condition: string | null = null) {
  await tx.query('insert into custody_events (tenant_id,client_id,sampling_event_id,event,at,party,condition,notes,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [ev.tenant_id, ev.client_id, ev.id, event, at, party, condition, notes, a.userId]);
}

export async function createSamplingEvent(a: Actor, input: unknown) {
  requirePerm(a, 'field.capture');
  const d = parse(samplingInput, input);
  return withActor(a, (tx) => insertEvent(tx, a, d, false));
}

const LOCKED = ['dispatched', 'received', 'analysed', 'void'];

async function applyUpdate(tx: Tx, a: Actor, current: any, d: SamplingInput, offline: boolean) {
  if (LOCKED.includes(current.status)) throw invalid(`Sample ${current.sample_code} is ${current.status}; field records can no longer be edited. Record a deviation note via the practitioner.`);
  const { values, status, warnings } = await prepare(tx, a, d);
  const sets = FIELD_COLUMNS.map((c, i) => `${c}=$${i + 2}`).join(',');
  const r = await one(tx, `update sampling_events set ${sets}, status=$${FIELD_COLUMNS.length + 2}, version=version+1, updated_at=now() where id=$1 returning *`,
    [current.id, ...FIELD_COLUMNS.map((c) => values[c]), status]);
  if (status === 'collected' && current.status !== 'collected') await custody(tx, a, r, 'collected', values.end_at as string, null, null);
  if (values.handover_to && values.handover_to !== current.handover_to) await custody(tx, a, r, 'handed_over', (values.handover_at as string) ?? (values.end_at as string) ?? new Date().toISOString(), values.handover_to as string, values.handover_at ? null : 'Handover time not recorded; end of sampling used');
  await audit(tx, a, offline ? 'sample.update_offline' : 'sample.update', 'sampling_event', current.id, { before_version: current.version, warnings });
  return { event: r, warnings };
}

export async function updateSamplingEvent(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'field.capture');
  const d = parse(samplingInput.extend({ version: z.coerce.number().int() }), input);
  return withActor(a, async (tx) => {
    const cur = await one(tx, 'select * from sampling_events where id=$1 for update', [id]);
    if (!cur) throw notFound('Sampling event');
    if (cur.version !== d.version) throw conflict('This sample record was changed by someone else since you opened it. Reload to see the current version.');
    return applyUpdate(tx, a, cur, d, false);
  });
}

export async function voidSamplingEvent(a: Actor, id: string, input: unknown) {
  if (!can(a, 'assess.write') && !can(a, 'field.capture')) throw forbidden();
  const d = parse(z.object({ reason: reqStr(5) }), input);
  return withActor(a, async (tx) => {
    const r = await one(tx, `update sampling_events set status='void', void_reason=$2, version=version+1, updated_at=now() where id=$1 and status <> 'void' returning *`, [id, d.reason]);
    if (!r) throw notFound('Sampling event');
    await audit(tx, a, 'sample.void', 'sampling_event', id, d);
    return r;
  });
}

// ───── QC checks — failures stay visible; only an authorised disposition changes their effect.
export async function addQcCheck(a: Actor, sampleId: string, input: unknown) {
  if (!can(a, 'field.capture') && !can(a, 'lab.write')) throw forbidden();
  const d = parse(z.object({ check_type: reqStr(2, 100), outcome: z.enum(['pass', 'fail', 'not_applicable']), detail: optStr }), input);
  return withActor(a, async (tx) => {
    const e = await one(tx, 'select tenant_id, client_id from sampling_events where id=$1', [sampleId]);
    if (!e) throw notFound('Sampling event');
    const r = await one(tx, 'insert into sample_qc_checks (tenant_id,client_id,sampling_event_id,check_type,outcome,detail,recorded_by) values ($1,$2,$3,$4,$5,$6,$7) returning *',
      [e.tenant_id, e.client_id, sampleId, d.check_type, d.outcome, d.detail, a.userId]);
    await audit(tx, a, 'sample.qc_check', 'sampling_event', sampleId, d);
    return r;
  });
}
export async function disposeQcFailure(a: Actor, checkId: string, input: unknown) {
  if (!can(a, 'assess.write') && !can(a, 'assess.approve')) throw forbidden('Only a practitioner or reviewer can disposition a failed check');
  const d = parse(z.object({ disposition: z.enum(['accepted_with_justification', 'sample_invalidated']), reason: reqStr(20) }), input);
  return withActor(a, async (tx) => {
    const q = await one(tx, 'select * from sample_qc_checks where id=$1 for update', [checkId]);
    if (!q) throw notFound('QC check');
    if (q.outcome !== 'fail') throw invalid('Only failed checks need a disposition');
    if (q.disposition) throw invalid('This failure already has a disposition');
    const r = await one(tx, 'update sample_qc_checks set disposition=$2, disposition_reason=$3, disposition_by=$4, disposition_at=now() where id=$1 returning *', [checkId, d.disposition, d.reason, a.userId]);
    await audit(tx, a, 'sample.qc_disposition', 'sampling_event', q.sampling_event_id, d);
    return r;
  });
}

export async function recordCustody(a: Actor, sampleId: string, input: unknown) {
  if (!can(a, 'field.capture') && !can(a, 'lab.write')) throw forbidden();
  const d = parse(z.object({ event: z.enum(['handed_over', 'dispatched', 'received_by_lab', 'returned', 'discarded']), at: z.string(), timezone: z.string().default('Europe/London'), party: optStr, condition: optStr, notes: optStr }), input);
  return withActor(a, async (tx) => {
    const e = await one(tx, 'select * from sampling_events where id=$1 for update', [sampleId]);
    if (!e) throw notFound('Sampling event');
    if (e.status === 'void') throw invalid('Sample is void');
    const at = zonedToUtc(d.at, d.timezone);
    await custody(tx, a, e, d.event, at, d.party, d.notes, d.condition);
    const next = d.event === 'dispatched' ? 'dispatched' : d.event === 'received_by_lab' ? 'received' : null;
    if (next) await tx.query('update sampling_events set status=$2, version=version+1, updated_at=now() where id=$1', [sampleId, next]);
    await audit(tx, a, `sample.custody.${d.event}`, 'sampling_event', sampleId, d);
  });
}

// ───── Offline synchronisation
export const syncItem = z.object({
  client_uuid: uuid,
  server_id: optUuid,
  base_version: z.number().int().nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export type SyncResult = { client_uuid: string; outcome: 'created' | 'updated' | 'duplicate' | 'conflict' | 'rejected'; server_id?: string; version?: number; conflict_id?: string; message?: string; warnings?: string[] };

/** Canonical form of a field record for duplicate detection (independent of DB vs input representation). */
function comparable(row: any) {
  return JSON.stringify(FIELD_COLUMNS.filter((c) => c !== 'group_id_at_sampling').map((c) => {
    let v = row[c];
    if (c === 'interruptions') {
      const arr = typeof v === 'string' ? JSON.parse(v) : v ?? [];
      return arr.map((i: any) => [new Date(i.start).toISOString(), new Date(i.end).toISOString(), i.reason ?? '']);
    }
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toISOString();
    if (typeof v === 'number') return v;
    return v ?? null;
  }));
}

/**
 * Idempotent sync of field captures. Each item is processed in its own transaction so one failure
 * cannot block others. Never overwrites a newer server version: a mismatch is stored as a conflict.
 */
export async function syncBatch(a: Actor, items: unknown[]): Promise<SyncResult[]> {
  requirePerm(a, 'field.capture');
  const out: SyncResult[] = [];
  for (const raw of items) {
    let it: z.infer<typeof syncItem>;
    try { it = parse(syncItem, raw); } catch (e: any) { out.push({ client_uuid: (raw as any)?.client_uuid ?? '?', outcome: 'rejected', message: e.message }); continue; }
    try {
      const res = await withActor(a, async (tx): Promise<SyncResult> => {
        const d = parse(samplingInput, { ...it.payload, client_uuid: it.client_uuid });
        const cur = it.server_id
          ? await one(tx, 'select * from sampling_events where id=$1 for update', [it.server_id])
          : await one(tx, 'select * from sampling_events where client_uuid=$1 for update', [it.client_uuid]);
        if (!cur) {
          if (it.server_id) return { client_uuid: it.client_uuid, outcome: 'rejected', message: 'Record not found or not accessible' };
          const { event, warnings } = await insertEvent(tx, a, d, true);
          return { client_uuid: it.client_uuid, outcome: 'created', server_id: event.id, version: event.version, warnings };
        }
        const { values } = await prepare(tx, a, d);
        const same = comparable(values) === comparable(cur);
        if (same) return { client_uuid: it.client_uuid, outcome: 'duplicate', server_id: cur.id, version: cur.version };
        if (it.base_version !== null && it.base_version === cur.version && !LOCKED.includes(cur.status)) {
          const { event, warnings } = await applyUpdate(tx, a, cur, d, true);
          return { client_uuid: it.client_uuid, outcome: 'updated', server_id: event.id, version: event.version, warnings };
        }
        const c = await one(tx, `insert into sync_conflicts (tenant_id,client_id,entity_type,entity_id,client_uuid,base_version,server_version,client_payload,server_payload,submitted_by)
          values ($1,$2,'sampling_event',$3,$4,$5,$6,$7,$8,$9) returning id`,
          [a.tenantId, cur.client_id, cur.id, it.client_uuid, it.base_version, cur.version, it.payload, cur, a.userId]);
        await audit(tx, a, 'sync.conflict', 'sampling_event', cur.id, { conflict_id: c.id, base_version: it.base_version, server_version: cur.version });
        return { client_uuid: it.client_uuid, outcome: 'conflict', server_id: cur.id, version: cur.version, conflict_id: c.id,
          message: LOCKED.includes(cur.status) ? `Sample is already ${cur.status}; your offline changes were kept for review.` : 'The server copy changed since you went offline; both versions were kept for review.' };
      });
      out.push(res);
    } catch (e: any) {
      out.push({ client_uuid: it.client_uuid, outcome: 'rejected', message: e instanceof AppError ? e.message : 'Server error' });
    }
  }
  return out;
}

export async function listConflicts(a: Actor) {
  return withActor(a, (tx) => many(tx, `select c.*, u.name submitted_by_name from sync_conflicts c left join users u on u.id=c.submitted_by order by c.status='open' desc, c.submitted_at desc`));
}

export async function resolveConflict(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'conflicts.resolve');
  const d = parse(z.object({ resolution: z.enum(['resolved_keep_server', 'resolved_apply_client']), notes: reqStr(5) }), input);
  return withActor(a, async (tx) => {
    const c = await one(tx, 'select * from sync_conflicts where id=$1 for update', [id]);
    if (!c) throw notFound('Conflict');
    if (c.status !== 'open') throw invalid('Conflict already resolved');
    if (d.resolution === 'resolved_apply_client') {
      const cur = await one(tx, 'select * from sampling_events where id=$1 for update', [c.entity_id]);
      const p = parse(samplingInput, { ...c.client_payload, client_uuid: cur.client_uuid });
      await applyUpdate(tx, a, cur, p, true);
    }
    await tx.query('update sync_conflicts set status=$2, resolution_notes=$3, resolved_by=$4, resolved_at=now() where id=$1', [id, d.resolution, d.notes, a.userId]);
    await audit(tx, a, 'sync.conflict_resolved', 'sampling_event', c.entity_id, d);
  });
}

// ───── Read models
export async function sampleDetail(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const e = await one(tx, `select e.*, w.ref_code worker_ref, wi.full_name worker_name, g.name group_name, s.name substance_name, i.asset_tag, i.screening_only,
        m.code method_code, mv.version method_version, p.title plan_title
      from sampling_events e left join workers w on w.id=e.worker_id left join worker_identities wi on wi.worker_id=w.id and wi.disposed_at is null
      left join exposure_groups g on g.id=e.group_id_at_sampling left join substances s on s.id=e.substance_id left join instruments i on i.id=e.instrument_id
      left join sampling_method_versions mv on mv.id=e.method_version_id left join sampling_methods m on m.id=mv.method_id left join monitoring_plans p on p.id=e.plan_id where e.id=$1`, [id]);
    if (!e) throw notFound('Sampling event');
    return {
      event: e,
      calibrationOk: e.instrument_id && e.start_at ? await calibrationValidAt(tx, e.instrument_id, e.start_at.toISOString()) : null,
      qc: await many(tx, 'select q.*, u.name disposition_by_name from sample_qc_checks q left join users u on u.id=q.disposition_by where sampling_event_id=$1 order by recorded_at', [id]),
      custody: await many(tx, 'select c.*, u.name recorded_by_name from custody_events c left join users u on u.id=c.recorded_by where sampling_event_id=$1 order by at, recorded_at', [id]),
      results: await many(tx, `select r.*, s.name substance_name, v.value, v.unit, v.qualifier, v.lod, v.loq, v.lab_report_ref, v.analytical_method, v.uncertainty, v.lab_comments, v.sample_condition, v.revision, v.amendment_reason, v.entered_at
        from lab_results r join lab_result_revisions v on v.result_id=r.id join substances s on s.id=r.substance_id where r.sampling_event_id=$1 order by s.name, v.revision desc`, [id]),
      conflicts: await many(tx, `select * from sync_conflicts where entity_id=$1 and status='open'`, [id]),
    };
  });
}

export async function listSamples(a: Actor, filter: { status?: string } = {}) {
  return withActor(a, (tx) => many(tx, `select e.id, e.sample_code, e.sample_type, e.status, e.start_at, e.end_at, e.timezone, e.captured_offline, w.ref_code worker_ref, s.name substance_name, p.title plan_title,
      (select count(*) from sample_qc_checks q where q.sampling_event_id=e.id and q.outcome='fail' and q.disposition is null)::int unresolved_qc
    from sampling_events e left join workers w on w.id=e.worker_id left join substances s on s.id=e.substance_id left join monitoring_plans p on p.id=e.plan_id
    where ($1::text is null or e.status=$1) order by e.start_at desc nulls first limit 500`, [filter.status ?? null]));
}
