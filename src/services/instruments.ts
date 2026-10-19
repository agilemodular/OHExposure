import { assertWorkflowActive } from './assurance.js';
import { assertLinkableAttachment } from './attachments.js';
import { z } from 'zod';
import { audit, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { invalid, notFound } from '../errors.js';
import { bool, date, optNum, optStr, optUuid, parse, reqStr, uuid } from './util.js';

export async function createInstrument(a: Actor, input: unknown) {
  requirePerm(a, 'instruments.write');
  const d = parse(z.object({
    asset_tag: reqStr(1, 60), instrument_type: z.enum(['sampling_pump', 'direct_reading_monitor', 'flow_calibrator', 'other']),
    make: optStr, model: optStr, serial_number: optStr, measures: optStr,
    range_min: optNum, range_max: optNum, range_units: optStr, screening_only: bool, client_id: optUuid,
  }), input);
  if (d.range_min != null && d.range_max != null && d.range_max <= d.range_min) throw invalid('Range maximum must exceed minimum');
  if (d.instrument_type === 'direct_reading_monitor' && !d.screening_only && !d.measures)
    throw invalid('Describe what a direct-reading monitor measures before designating it suitable for formal assessment');
  return withActor(a, async (tx) => {
    const r = await one(tx, `insert into instruments (tenant_id,client_id,asset_tag,instrument_type,make,model,serial_number,measures,range_min,range_max,range_units,screening_only)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [a.tenantId, d.client_id, d.asset_tag, d.instrument_type, d.make, d.model, d.serial_number, d.measures, d.range_min, d.range_max, d.range_units, d.screening_only]);
    await audit(tx, a, 'instrument.create', 'instrument', r.id, d);
    return r;
  });
}

export async function setInstrumentStatus(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'instruments.write');
  const d = parse(z.object({ status: z.enum(['in_service', 'out_of_service', 'retired']), reason: reqStr(3) }), input);
  return withActor(a, async (tx) => {
    await assertWorkflowActive(tx, 'field_sync', 'change instrument status');
    const r = await one(tx, 'update instruments set status=$2 where id=$1 returning *', [id, d.status]);
    if (!r) throw notFound('Instrument');
    await tx.query('insert into instrument_maintenance (tenant_id,instrument_id,at,kind,notes,recorded_by) values ($1,$2,current_date,$3,$4,$5)', [a.tenantId, id, `status:${d.status}`, d.reason, a.userId]);
    await audit(tx, a, 'instrument.status', 'instrument', id, d);
    return r;
  });
}

export async function recordCalibration(a: Actor, instrumentId: string, input: unknown) {
  requirePerm(a, 'instruments.write');
  const d = parse(z.object({ performed_at: date, valid_until: date, provider: optStr, certificate_ref: optStr, outcome: z.enum(['pass', 'fail', 'adjusted_pass']), attachment_id: optUuid }), input);
  if (d.valid_until < d.performed_at) throw invalid('Valid-until date must not be before the calibration date');
  return withActor(a, async (tx) => {
    // Calibration evidence is field evidence: refused while field synchronisation is suspended, and the instrument row
    // is locked so the change cannot interleave with an approval that relies on it.
    await assertWorkflowActive(tx, 'field_sync', 'record calibration');
    if (!(await one(tx, 'select 1 from instruments where id=$1 for update', [instrumentId]))) throw notFound('Instrument');
    await assertLinkableAttachment(tx, d.attachment_id);
    const r = await one(tx, `insert into calibrations (tenant_id,instrument_id,performed_at,valid_until,provider,certificate_ref,outcome,attachment_id,recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [a.tenantId, instrumentId, d.performed_at, d.valid_until, d.provider, d.certificate_ref, d.outcome, d.attachment_id, a.userId]);
    await audit(tx, a, 'instrument.calibration', 'instrument', instrumentId, d);
    return r;
  });
}

export async function recordMaintenance(a: Actor, instrumentId: string, input: unknown) {
  requirePerm(a, 'instruments.write');
  const d = parse(z.object({ at: date, kind: reqStr(2, 100), notes: optStr }), input);
  return withActor(a, async (tx) => {
    await assertWorkflowActive(tx, 'field_sync', 'record maintenance');
    if (!(await one(tx, 'select 1 from instruments where id=$1 for update', [instrumentId]))) throw notFound('Instrument');
    const r = await one(tx, 'insert into instrument_maintenance (tenant_id,instrument_id,at,kind,notes,recorded_by) values ($1,$2,$3,$4,$5,$6) returning *', [a.tenantId, instrumentId, d.at, d.kind, d.notes, a.userId]);
    await audit(tx, a, 'instrument.maintenance', 'instrument', instrumentId, d);
    return r;
  });
}

/** true = valid passing calibration covering the date; false = covering calibration failed or only expired evidence; null = no evidence. */
export async function calibrationValidAt(tx: Tx, instrumentId: string, isoDate: string): Promise<boolean | null> {
  const day = isoDate.slice(0, 10);
  const rows = await many(tx, 'select performed_at, valid_until, outcome from calibrations where instrument_id=$1 and performed_at <= $2 order by performed_at desc', [instrumentId, day]);
  if (!rows.length) return null;
  const covering = rows.find((r) => r.valid_until >= day);
  if (!covering) return false;
  return covering.outcome !== 'fail';
}

export function calibrationState(cals: { performed_at: string; valid_until: string; outcome: string }[], today = new Date().toISOString().slice(0, 10)) {
  if (!cals.length) return { state: 'missing' as const, label: 'No calibration evidence' };
  const latest = [...cals].sort((x, y) => (x.performed_at < y.performed_at ? 1 : -1))[0];
  if (latest.outcome === 'fail') return { state: 'failed' as const, label: `Last calibration failed (${latest.performed_at})` };
  if (latest.valid_until < today) return { state: 'expired' as const, label: `Expired ${latest.valid_until}` };
  const days = Math.round((Date.parse(latest.valid_until) - Date.parse(today)) / 86400000);
  return days <= 30 ? { state: 'due_soon' as const, label: `Valid until ${latest.valid_until} (${days} days)` } : { state: 'valid' as const, label: `Valid until ${latest.valid_until}` };
}

export async function listInstruments(a: Actor) {
  return withActor(a, async (tx) => {
    const inst = await many(tx, 'select * from instruments order by asset_tag');
    const cals = await many(tx, 'select instrument_id, performed_at, valid_until, outcome from calibrations');
    return inst.map((i) => ({ ...i, calibration: calibrationState(cals.filter((c) => c.instrument_id === i.id)) }));
  });
}

export async function instrumentDetail(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const i = await one(tx, 'select * from instruments where id=$1', [id]);
    if (!i) throw notFound('Instrument');
    const calibrations = await many(tx, 'select c.*, u.name recorded_by_name from calibrations c left join users u on u.id=c.recorded_by where instrument_id=$1 order by performed_at desc', [id]);
    return {
      instrument: { ...i, calibration: calibrationState(calibrations) },
      calibrations,
      maintenance: await many(tx, 'select * from instrument_maintenance where instrument_id=$1 order by at desc', [id]),
      usage: await many(tx, 'select id, sample_code, start_at, status from sampling_events where instrument_id=$1 order by start_at desc nulls last limit 50', [id]),
    };
  });
}

// ───── Sampling methods (tenant-defined versions; platform rows read-only)
export async function createMethodVersion(a: Actor, input: unknown) {
  requirePerm(a, 'benchmark.write');
  const d = parse(z.object({
    code: reqStr(2, 60), title: reqStr(3, 300), source_reference: reqStr(3, 500), version: reqStr(1, 30),
    collection_media: optStr, flow_rate_lpm_min: optNum, flow_rate_lpm_max: optNum, flow_drift_tolerance_pct: optNum, min_volume_l: optNum,
    result_basis: z.enum(['mass_on_sample', 'concentration']), suitable_for_formal_assessment: bool, notes: optStr,
  }), input);
  return withActor(a, async (tx) => {
    let m = await one(tx, 'select * from sampling_methods where tenant_id=$1 and code=$2', [a.tenantId, d.code]);
    if (!m) m = await one(tx, 'insert into sampling_methods (tenant_id,code,title,source_reference) values ($1,$2,$3,$4) returning *', [a.tenantId, d.code, d.title, d.source_reference]);
    const v = await one(tx, `insert into sampling_method_versions (tenant_id,method_id,version,collection_media,flow_rate_lpm_min,flow_rate_lpm_max,flow_drift_tolerance_pct,min_volume_l,result_basis,suitable_for_formal_assessment,notes)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [a.tenantId, m.id, d.version, d.collection_media, d.flow_rate_lpm_min, d.flow_rate_lpm_max, d.flow_drift_tolerance_pct, d.min_volume_l, d.result_basis, d.suitable_for_formal_assessment, d.notes]);
    await audit(tx, a, 'method.version_create', 'sampling_method', m.id, d);
    return v;
  });
}

export async function listMethodVersions(a: Actor) {
  return withActor(a, (tx) => many(tx, `select v.*, m.code, m.title, m.source_reference, m.tenant_id is null as platform
    from sampling_method_versions v join sampling_methods m on m.id=v.method_id order by m.code, v.version`));
}

export async function createLaboratory(a: Actor, input: unknown) {
  requirePerm(a, 'lab.write');
  const d = parse(z.object({ name: reqStr(2, 200), accreditation_ref: optStr, contact: optStr }), input);
  return withActor(a, async (tx) => {
    const r = await one(tx, 'insert into laboratories (tenant_id,name,accreditation_ref,contact) values ($1,$2,$3,$4) returning *', [a.tenantId, d.name, d.accreditation_ref, d.contact]);
    await audit(tx, a, 'laboratory.create', 'laboratory', r.id, d);
    return r;
  });
}
