import { z } from 'zod';
import { audit, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { invalid, notFound } from '../errors.js';
import { assertWorkflowActive } from './assurance.js';
import { optNum, optStr, optUuid, parse, reqStr, strArray, uuid, zonedToUtc } from './util.js';

const resultSchema = z.object({
  sampling_event_id: uuid,
  substance_id: uuid,
  value: optNum,
  unit: z.enum(['ug', 'mg', 'ug/m3', 'mg/m3', 'ppm', 'f/ml']),
  qualifier: z.enum(['=', '<LOD', '<LOQ', '>', 'estimated']),
  lod: optNum,
  loq: optNum,
  analytical_method: optStr,
  laboratory_id: optUuid,
  lab_report_ref: optStr,
  uncertainty: optStr,
  sample_condition: optStr,
  lab_comments: optStr,
  source_attachment_id: optUuid,
  amendment_reason: optStr,
});
type ResultIn = z.infer<typeof resultSchema>;

function validateResult(d: ResultIn) {
  if (['=', '>', 'estimated'].includes(d.qualifier) && d.value == null) throw invalid(`A value is required for qualifier "${d.qualifier}"`);
  if (d.qualifier === '<LOD' && d.value == null && d.lod == null) throw invalid('A non-detect needs the detection limit (or the reported "<" value)');
  if (d.qualifier === '<LOQ' && d.loq == null && d.value == null) throw invalid('A below-LOQ result needs the quantification limit');
  for (const k of ['value', 'lod', 'loq'] as const) if (d[k] != null && d[k]! < 0) throw invalid(`${k} cannot be negative`);
  if (d.lod != null && d.loq != null && d.loq < d.lod) throw invalid('LOQ cannot be below LOD');
}

async function writeResult(tx: Tx, a: Actor, d: ResultIn, batchId: string | null) {
  validateResult(d);
  const e = await one(tx, 'select * from sampling_events where id=$1 for update', [d.sampling_event_id]);
  if (!e) throw notFound('Sampling event');
  if (e.status === 'void') throw invalid(`Sample ${e.sample_code} is void`);
  if (e.status === 'planned' || e.status === 'in_progress') throw invalid(`Sample ${e.sample_code} has not been collected`);
  const sub = await one(tx, 'select name from substances where id=$1', [d.substance_id]);
  if (!sub) throw notFound('Substance');
  let res = await one(tx, 'select * from lab_results where sampling_event_id=$1 and substance_id=$2 for update', [d.sampling_event_id, d.substance_id]);
  let revision = 1;
  if (res) {
    if (!d.amendment_reason) throw invalid(`A result for ${sub.name} already exists on ${e.sample_code}; provide an amendment reason to record a revision`);
    revision = res.current_revision + 1;
    await tx.query('update lab_results set current_revision=$2 where id=$1', [res.id, revision]);
  } else {
    res = await one(tx, 'insert into lab_results (tenant_id,client_id,sampling_event_id,substance_id,analyte_name) values ($1,$2,$3,$4,$5) returning *', [e.tenant_id, e.client_id, d.sampling_event_id, d.substance_id, sub.name]);
  }
  const rev = await one(tx, `insert into lab_result_revisions (tenant_id,client_id,result_id,revision,value,unit,qualifier,lod,loq,analytical_method,laboratory_id,lab_report_ref,uncertainty,sample_condition,lab_comments,source_attachment_id,amendment_reason,import_batch_id,entered_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
    [e.tenant_id, e.client_id, res.id, revision, d.value, d.unit, d.qualifier, d.lod, d.loq, d.analytical_method, d.laboratory_id, d.lab_report_ref, d.uncertainty, d.sample_condition, d.lab_comments, d.source_attachment_id, revision > 1 ? d.amendment_reason : null, batchId, a.userId]);
  await tx.query('insert into custody_events (tenant_id,client_id,sampling_event_id,event,at,notes,recorded_by) values ($1,$2,$3,$4,now(),$5,$6)',
    [e.tenant_id, e.client_id, e.id, revision > 1 ? 'result_amended' : 'analysed', revision > 1 ? d.amendment_reason : d.lab_report_ref, a.userId]);
  if (e.status !== 'analysed') await tx.query(`update sampling_events set status='analysed', version=version+1, updated_at=now() where id=$1`, [e.id]);
  await audit(tx, a, revision > 1 ? 'lab_result.amend' : 'lab_result.create', 'lab_result', res.id, { sample: e.sample_code, revision, qualifier: d.qualifier, value: d.value, unit: d.unit, batch: batchId });
  return { result: res, revision: rev };
}

export async function recordResult(a: Actor, input: unknown) {
  requirePerm(a, 'lab.write');
  const d = parse(resultSchema, input);
  return withActor(a, async (tx) => { await assertWorkflowActive(tx, 'lab_import'); return writeResult(tx, a, d, null); });
}

// ───── Submissions & chain of custody
export async function createSubmission(a: Actor, input: unknown) {
  requirePerm(a, 'lab.write');
  const d = parse(z.object({ laboratory_id: uuid, reference: reqStr(2, 100), sample_ids: strArray.pipe(z.array(uuid).min(1)), dispatched_at: z.string(), timezone: z.string().default('Europe/London'), courier_ref: optStr, notes: optStr }), input);
  return withActor(a, async (tx) => {
    await assertWorkflowActive(tx, 'lab_import');
    const samples = await many(tx, 'select * from sampling_events where id = any($1) for update', [d.sample_ids]);
    if (samples.length !== d.sample_ids.length) throw notFound('One or more samples');
    const clients = new Set(samples.map((s) => s.client_id));
    if (clients.size > 1) throw invalid('A submission cannot mix samples from different clients');
    for (const s of samples) if (s.status !== 'collected') throw invalid(`Sample ${s.sample_code} is ${s.status}; only collected samples can be dispatched`);
    const at = zonedToUtc(d.dispatched_at, d.timezone);
    const sub = await one(tx, 'insert into lab_submissions (tenant_id,client_id,laboratory_id,reference,dispatched_at,dispatched_by,courier_ref,notes) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
      [a.tenantId, samples[0].client_id, d.laboratory_id, d.reference, at, a.userId, d.courier_ref, d.notes]);
    for (const s of samples) {
      await tx.query('insert into lab_submission_samples (tenant_id,submission_id,sampling_event_id) values ($1,$2,$3)', [a.tenantId, sub.id, s.id]);
      await tx.query('insert into custody_events (tenant_id,client_id,sampling_event_id,event,at,party,notes,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [s.tenant_id, s.client_id, s.id, 'dispatched', at, d.courier_ref, `Submission ${d.reference}`, a.userId]);
      await tx.query(`update sampling_events set status='dispatched', version=version+1, updated_at=now() where id=$1`, [s.id]);
    }
    await audit(tx, a, 'lab_submission.create', 'lab_submission', sub.id, d);
    return sub;
  });
}

export async function receiveSubmission(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'lab.write');
  const d = parse(z.object({ received_at: z.string(), timezone: z.string().default('Europe/London'), received_condition: reqStr(2) }), input);
  return withActor(a, async (tx) => {
    await assertWorkflowActive(tx, 'lab_import');
    const sub = await one(tx, 'select * from lab_submissions where id=$1 for update', [id]);
    if (!sub) throw notFound('Submission');
    if (sub.received_at) throw invalid('Receipt already recorded');
    const at = zonedToUtc(d.received_at, d.timezone);
    await tx.query('update lab_submissions set received_at=$2, received_condition=$3 where id=$1', [id, at, d.received_condition]);
    const samples = await many(tx, 'select e.* from lab_submission_samples x join sampling_events e on e.id=x.sampling_event_id where x.submission_id=$1', [id]);
    for (const s of samples) {
      await tx.query('insert into custody_events (tenant_id,client_id,sampling_event_id,event,at,condition,notes,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [s.tenant_id, s.client_id, s.id, 'received_by_lab', at, d.received_condition, `Submission ${sub.reference}`, a.userId]);
      if (s.status === 'dispatched') await tx.query(`update sampling_events set status='received', version=version+1 where id=$1`, [s.id]);
    }
    await audit(tx, a, 'lab_submission.received', 'lab_submission', id, d);
  });
}

export async function listSubmissions(a: Actor) {
  return withActor(a, (tx) => many(tx, `select s.*, l.name lab_name, (select count(*) from lab_submission_samples x where x.submission_id=s.id)::int sample_count,
      (select count(*) from lab_submission_samples x join lab_results r on r.sampling_event_id=x.sampling_event_id where x.submission_id=s.id)::int result_count
    from lab_submissions s join laboratories l on l.id=s.laboratory_id order by s.created_at desc`));
}

// ───── Structured import (CSV). Stage → validate → commit, all-or-nothing.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export const IMPORT_COLUMNS = ['sample_code', 'analyte', 'cas_number', 'value', 'unit', 'qualifier', 'lod', 'loq', 'analytical_method', 'lab_report_ref', 'uncertainty', 'sample_condition', 'lab_comments', 'amendment_reason'];

export async function stageImport(a: Actor, input: { filename: string; csv: string; laboratory_id?: string | null; source_attachment_id?: string | null }) {
  requirePerm(a, 'lab.import');
  const rows = parseCsv(input.csv.replace(/^﻿/, ''));
  if (rows.length < 2) throw invalid('The file has no data rows');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = ['sample_code', 'value', 'unit', 'qualifier'].filter((c) => !header.includes(c));
  if (missing.length) throw invalid(`Missing required column(s): ${missing.join(', ')}. Expected columns: ${IMPORT_COLUMNS.join(', ')}`);
  if (!header.includes('analyte') && !header.includes('cas_number')) throw invalid('Provide an analyte or cas_number column');
  if (rows.length > 5001) throw invalid('Maximum 5,000 rows per import');
  return withActor(a, async (tx) => {
    const b = await one(tx, 'insert into import_batches (tenant_id,kind,filename,laboratory_id,source_attachment_id,created_by) values ($1,$2,$3,$4,$5,$6) returning *',
      [a.tenantId, 'lab_results_csv', input.filename, input.laboratory_id ?? null, input.source_attachment_id ?? null, a.userId]);
    let errors = 0;
    const seen = new Set<string>();
    const clientsSeen = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const raw = Object.fromEntries(header.map((h, j) => [h, (rows[i][j] ?? '').trim()]));
      const errs: string[] = [];
      const ev = await one(tx, 'select id, status, client_id from sampling_events where sample_code=$1', [raw.sample_code]);
      if (!ev) errs.push(`Unknown sample code "${raw.sample_code}"`);
      else if (['void', 'planned', 'in_progress'].includes(ev.status)) errs.push(`Sample is ${ev.status}`);
      let sub = null;
      if (raw.cas_number) sub = await one(tx, 'select id, name from substances where cas_number=$1 order by tenant_id nulls last limit 1', [raw.cas_number]);
      if (!sub && raw.analyte) sub = await one(tx, 'select id, name from substances where lower(name)=lower($1) order by tenant_id nulls last limit 1', [raw.analyte]);
      if (!sub) errs.push(`Unknown analyte "${raw.analyte || raw.cas_number}"`);
      const num = (k: string) => (raw[k] === '' || raw[k] === undefined ? null : Number(raw[k]));
      const parsed: any = {
        sampling_event_id: ev?.id, substance_id: sub?.id, value: num('value'), unit: raw.unit, qualifier: raw.qualifier || '=', lod: num('lod'), loq: num('loq'),
        analytical_method: raw.analytical_method || null, laboratory_id: input.laboratory_id ?? null, lab_report_ref: raw.lab_report_ref || null, uncertainty: raw.uncertainty || null,
        sample_condition: raw.sample_condition || null, lab_comments: raw.lab_comments || null, source_attachment_id: input.source_attachment_id ?? null, amendment_reason: raw.amendment_reason || null,
      };
      for (const k of ['value', 'lod', 'loq']) if (parsed[k] !== null && !Number.isFinite(parsed[k])) errs.push(`${k} "${raw[k]}" is not a number`);
      const chk = resultSchema.safeParse(parsed);
      if (!chk.success) errs.push(...chk.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
      else { try { validateResult(chk.data); } catch (e: any) { errs.push(e.message); } }
      if (ev && sub) {
        const key = `${ev.id}|${sub.id}`;
        if (seen.has(key)) errs.push('Duplicate sample/analyte row in this file');
        seen.add(key);
        const exists = await one(tx, 'select 1 from lab_results where sampling_event_id=$1 and substance_id=$2', [ev.id, sub.id]);
        if (exists && !parsed.amendment_reason) errs.push('A result already exists; supply amendment_reason to record a revision');
      }
      if (ev) {
        clientsSeen.add(ev.client_id);
        if (clientsSeen.size > 1) errs.push('An import file may only contain samples for one client; split the file by client');
      }
      if (errs.length) errors++;
      await tx.query('insert into import_rows (tenant_id,client_id,batch_id,row_no,raw,parsed,errors) values ($1,$2,$3,$4,$5,$6,$7)', [a.tenantId, ev?.client_id ?? null, b.id, i + 1, raw, parsed, JSON.stringify(errs)]);
    }
    if (clientsSeen.size === 1) await tx.query('update import_batches set client_id=$2 where id=$1', [b.id, [...clientsSeen][0]]);
    const status = errors ? 'rejected' : 'validated';
    await tx.query('update import_batches set status=$2, row_count=$3, error_count=$4 where id=$1', [b.id, status, rows.length - 1, errors]);
    await audit(tx, a, 'import.staged', 'import_batch', b.id, { filename: input.filename, rows: rows.length - 1, errors });
    return { ...b, status, row_count: rows.length - 1, error_count: errors, client_id: clientsSeen.size === 1 ? [...clientsSeen][0] : null };
  });
}

/** Commits a validated batch in a single transaction; an interruption leaves nothing half-written and the batch retryable. */
export async function commitImport(a: Actor, batchId: string) {
  requirePerm(a, 'lab.import');
  return withActor(a, async (tx) => {
    const b = await one(tx, 'select * from import_batches where id=$1 for update', [batchId]);
    if (!b) throw notFound('Import batch');
    if (b.status === 'committed') return { already: true, count: b.row_count };
    await assertWorkflowActive(tx, 'lab_import');
    if (b.status !== 'validated') throw invalid('Only a fully validated batch can be committed; correct the file and re-import');
    const rows = await many(tx, 'select * from import_rows where batch_id=$1 order by row_no', [batchId]);
    for (const r of rows) await writeResult(tx, a, parse(resultSchema, r.parsed), batchId);
    await tx.query(`update import_batches set status='committed', committed_at=now() where id=$1`, [batchId]);
    await audit(tx, a, 'import.committed', 'import_batch', batchId, { rows: rows.length });
    return { already: false, count: rows.length };
  });
}

export async function importDetail(a: Actor, id: string) {
  return withActor(a, async (tx) => ({
    batch: await one(tx, 'select * from import_batches where id=$1', [id]),
    rows: await many(tx, 'select * from import_rows where batch_id=$1 order by row_no', [id]),
  }));
}

export async function listResults(a: Actor) {
  return withActor(a, (tx) => many(tx, `select r.id, e.id sample_id, e.sample_code, e.sample_type, s.name substance_name, v.value, v.unit, v.qualifier, v.lod, v.revision, v.lab_report_ref, v.entered_at, l.name lab_name
    from lab_results r join lab_result_revisions v on v.result_id=r.id and v.revision=r.current_revision join sampling_events e on e.id=r.sampling_event_id
    join substances s on s.id=r.substance_id left join laboratories l on l.id=v.laboratory_id order by v.entered_at desc limit 500`));
}
