// Engine 1.5.0 at the application boundaries: TR-06 (duplicate relationships) and TR-07 (contradictory
// detected-below-LOQ inputs) from the independent technical review of package 9b87c17. Synthetic data only.
// Engine-level cases are in the fixtures (worked-examples.test.ts, groups TR-06 and TR-07).
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, type World, updateDraftConfirmed } from './fixtures.js';
import { closePool, withActor } from '../src/db.js';
import * as reg from '../src/services/register.js';
import * as inst from '../src/services/instruments.js';
import * as plans from '../src/services/plans.js';
import * as field from '../src/services/field.js';
import * as lab from '../src/services/lab.js';
import * as asmt from '../src/services/assessments.js';
import * as rep from '../src/services/reports.js';

let w: World;
const S: Record<string, any> = {};
const URL_ = process.env.DATABASE_ADMIN_URL!;
const AN = 'Demo Dust X (synthetic)';
const why = { reason: 'Recorded as a duplicate of the retained sample', consequence: 'The retained sample represents this worker and period' };

beforeAll(async () => {
  w = await buildWorld();
  const { prac } = w.a;
  const site = await reg.createSite(prac, { client_id: w.A.clients['Client One'], name: 'TR-06/07 site', reference: `T67-${w.tag}` });
  const area = await reg.createWorkArea(prac, { site_id: site.id, name: 'Bay' });
  const proc = await reg.createProcess(prac, { work_area_id: area.id, name: 'Process' });
  const task = await reg.createTask(prac, { process_id: proc.id, name: 'Main task', duration_min_per_shift: '480', duration_basis: 'recorded_fact', typical_start_min: '0', typical_end_min: '480' });
  const hz = await reg.createHazard(prac, { task_id: task.id, substance_id: w.ref.substanceId, physical_form: 'dust', exposure_routes: ['inhalation'] });
  S.group = await reg.createGroup(prac, { site_id: site.id, name: 'TR-06/07 group', rationale: 'Same task, same tools and same shift pattern; comparable work methods observed.', task_ids: [task.id], hazard_ids: [hz.id] });
  S.w = [];
  for (const n of [1, 2]) {
    const wk = await reg.createWorker(prac, { client_id: w.A.clients['Client One'], ref_code: `T67W${n}-${w.tag}`, full_name: `T67 Worker ${n}` });
    await reg.addMembership(prac, { group_id: S.group.id, worker_id: wk.id, valid_from: '2026-01-01' });
    S.w.push(wk);
  }
  S.other = await reg.createSubstance(prac, { name: `Other analyte ${w.tag}` });
  S.pump = await inst.createInstrument(prac, { asset_tag: `T67P-${w.tag}`, instrument_type: 'sampling_pump' });
  S.pump2 = await inst.createInstrument(prac, { asset_tag: `T67Q-${w.tag}`, instrument_type: 'sampling_pump' });
  for (const p of [S.pump, S.pump2]) await inst.recordCalibration(prac, p.id, { performed_at: '2026-01-01', valid_until: '2027-12-31', outcome: 'pass' });
  S.method = await inst.createMethodVersion(prac, { code: `T67M-${w.tag}`, title: 'T67 gravimetric', source_reference: 'Test fixture', version: '1', flow_drift_tolerance_pct: '5', result_basis: 'mass_on_sample', suitable_for_formal_assessment: 'on', flow_drift_consequence: 'disposition_required' });
  S.plan = await plans.createPlan(prac, { site_id: site.id, title: 'T67 plan', purpose: 'Regression tests for TR-06 and TR-07', assessment_question: 'What is the 15-minute exposure?', approach: 'personal', strategy_rationale: 'Short-term personal samples during the main task.', instrument_ids: [S.pump.id, S.pump2.id] });
  await plans.addTarget(prac, S.plan.id, { group_id: S.group.id, substance_id: w.ref.substanceId, method_version_id: S.method.id, planned_samples: '8' });
  await plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' });
  await plans.transitionPlan(prac, S.plan.id, { to: 'scheduled' });
  await plans.transitionPlan(w.a.tech, S.plan.id, { to: 'in_progress' });
  const cap = async (key: string, o: { worker?: number; start: string; end: string; pair?: string; tasks?: string | null; pump?: any; qcFail?: boolean; minutes?: number }) => {
    const code = `T67-${key}-${w.tag}`;
    const [r] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: {
      plan_id: S.plan.id, sample_code: code, sample_type: 'personal', worker_id: S.w[o.worker ?? 0].id, substance_id: w.ref.substanceId, method_version_id: S.method.id, instrument_id: (o.pump ?? S.pump).id,
      timezone: 'UTC', start_local: o.start, end_local: o.end, flow_pre_lpm: 2, flow_post_lpm: 2, shift_ref: 'DAY', tasks_performed: o.tasks === undefined ? 'Main task' : o.tasks, pair_ref: o.pair } }]);
    if (o.qcFail) await field.addQcCheck(w.a.tech, r.server_id!, { check_type: 'flow_check', outcome: 'fail', detail: 'Pump fault at collection' });
    S[key] = r.server_id; S[`${key}_code`] = code;
    return r.server_id!;
  };
  // TR-06 reproduction (exact): W1 08:00–08:15 0.1 mg/m³; W1 15:00–15:15 2 mg/m³ failed QC. 2 L/min × 15 min = 30 L.
  await cap('AM', { start: '2026-03-02T08:00', end: '2026-03-02T08:15' });
  await cap('PM', { start: '2026-03-02T15:00', end: '2026-03-02T15:15', qcFail: true });
  // Paired / co-located samplers on 3 March, pair reference PR-1 recorded at capture.
  const at = { start: '2026-03-03T08:00', end: '2026-03-03T08:15' };
  await cap('PA', { ...at, pair: 'PR-1' });
  await cap('PB', { ...at, pair: 'PR-1', qcFail: true, pump: S.pump2 });             // lower result: supported
  await cap('PC', { ...at, pair: 'PR-1', qcFail: true, pump: S.pump2 });             // higher result: conflict
  await cap('PW2', { ...at, pair: 'PR-1', qcFail: true, worker: 1, pump: S.pump2 });  // different worker
  await cap('PT', { ...at, pair: 'PR-1', qcFail: true, tasks: 'Cleaning', pump: S.pump2 }); // different task context
  await cap('PN', { ...at, qcFail: true, tasks: null, pump: S.pump2 });              // no pair reference, no tasks
  await cap('PS', { ...at, pair: 'PR-1', qcFail: true, pump: S.pump2 });             // analysed for another substance only
  await cap('SE', { ...at, qcFail: true });                                           // second record of PA's event (same pump/window)
  await cap('PX', { ...at, pair: 'PR-1', qcFail: true, pump: S.pump2 });             // R5-F1: result not calculable
  await cap('PV', { ...at, pair: 'PR-1', qcFail: true, pump: S.pump2 });             // R5-F3: voided after its disposition
  await cap('DBL', { start: '2026-03-04T08:00', end: '2026-03-04T16:00', minutes: 480 });
  await cap('DBL2', { start: '2026-03-05T08:00', end: '2026-03-05T16:00' });
  S.lab = await inst.createLaboratory(prac, { name: `T67 lab ${w.tag}` });
  const all = ['AM', 'PM', 'PA', 'PB', 'PC', 'PW2', 'PT', 'PN', 'PS', 'SE', 'PX', 'PV', 'DBL', 'DBL2'].map((k) => S[k]);
  await lab.createSubmission(prac, { laboratory_id: S.lab.id, reference: `T67SUB-${w.tag}`, sample_ids: all, dispatched_at: '2026-03-06T09:00' });
  const sub = (await lab.listSubmissions(prac)).find((s) => s.reference === `T67SUB-${w.tag}`);
  await lab.receiveSubmission(prac, sub.id, { received_at: '2026-03-06T15:00', received_condition: 'Intact' });
  const res = async (key: string, value: number, substance = w.ref.substanceId) => lab.recordResult(prac, { sampling_event_id: S[key], substance_id: substance, value: String(value), unit: 'ug', qualifier: '=', lod: '0.1', loq: '0.3' });
  for (const [k, v] of [['AM', 3], ['PM', 60], ['PA', 3], ['PB', 2.4], ['PC', 60], ['PW2', 2.4], ['PT', 2.4], ['PN', 2.4], ['SE', 3]] as const) await res(k, v);
  await res('PS', 2.4, S.other.id);
  await res('PV', 2.4);
  // 50 mg/m³ entered as a concentration on a mass-on-sample method: not calculable (RESULT_BASIS_MISMATCH).
  await lab.recordResult(prac, { sampling_event_id: S.PX, substance_id: w.ref.substanceId, value: '50', unit: 'mg/m3', qualifier: '=', lod: '0.1', loq: '0.3' });
  const b = await asmt.createBenchmarkVersion(prac, { substance_id: w.ref.substanceId, jurisdiction: 'ORG', benchmark_type: `STEL-${w.tag}`, averaging_minutes: '15', value: '1', unit: 'mg/m3', source_title: 'Synthetic 15-minute benchmark', source_version: '1', effective_from: '2020-01-01' });
  await asmt.verifyBenchmarkVersion(w.a.rev, b.id, { status: 'verified', note: 'Synthetic test benchmark verified' });
  S.bm15 = b.id;
});
afterAll(async () => { await closePool(); });

const stelRevision = async (keys: string[]) => {
  const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title: `T67 ${keys.join(' ')}`, assessment_question: 'Is short-term exposure adequately controlled?' });
  await updateDraftConfirmed(w.a.prac, revision.id, { calc_code: 'stel_15', sample_ids: keys.map((k) => S[k]), benchmark_version_id: S.bm15 });
  return { assessmentId: assessment.id, revId: revision.id };
};
const dup = (sample: string, related: string, duplicate_type?: string) => ({ sample_id: S[sample], kind: 'duplicate', related_sample_id: S[related], duplicate_type, ...why });
const directInsert = (revId: string, sample: string, related: string, type: string | null, actor = w.a.prac) => withActor(actor, (tx) => tx.query(
  `insert into assessment_evidence_dispositions (tenant_id,client_id,revision_id,sampling_event_id,kind,reason,consequence,related_sampling_event_id,recorded_by,duplicate_type)
   select tenant_id, client_id, id, $2, 'duplicate', 'Direct write attempt here', 'Direct write attempt here', $3, $4, $5 from assessment_revisions where id=$1`, [revId, S[sample], S[related], actor.userId, type]));

describe('TR-06 duplicate relationships (service, database, engine)', () => {
  it('the review reproduction stays indeterminate after every duplicate attempt', async () => {
    const { revId } = await stelRevision(['AM', 'PM']);
    const before = (await asmt.calculate(w.a.prac, revId)).calc_output;
    expect([before.benchmarkState, before.evidenceAdequacy]).toEqual(['indeterminate', 'unresolved_evidence']);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PM', 'AM'))).rejects.toThrow(/State the duplicate category/);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PM', 'AM', 'same_event_record'))).rejects.toThrow(/windows differ by more than 1 min/);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PM', 'AM', 'paired_colocated'))).rejects.toThrow(/no pair reference/);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PM', 'AM', 'adequate_coverage'))).rejects.toThrow(/duplicate_type|Invalid/i);
    // The database enforces the same invariants for direct writes.
    await expect(directInsert(revId, 'PM', 'AM', null)).rejects.toThrow(/state the duplicate category|evidence_disposition_duplicate_type/);
    await expect(directInsert(revId, 'PM', 'AM', 'same_event_record')).rejects.toThrow(/windows differ by more than 1 min/);
    await expect(directInsert(revId, 'PM', 'AM', 'paired_colocated')).rejects.toThrow(/same pair reference/);
    const after = (await asmt.calculate(w.a.prac, revId)).calc_output;
    expect([after.benchmarkState, after.evidenceAdequacy]).toEqual(['indeterminate', 'unresolved_evidence']);
    expect(after.unresolvedEvidence.map((u: any) => u.reasons.join(' ')).join(' ')).toMatch(/Failed QC check "flow_check"/);
  });

  it('a practitioner cannot use "duplicate" to bypass the reviewer-only coverage judgement; a reviewer can make that judgement', async () => {
    const { revId } = await stelRevision(['AM', 'PM']);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, { sample_id: S.PM, kind: 'remaining_coverage_adequate', reason: 'The morning sample is adequate', consequence: 'Afternoon not separately assessed' })).rejects.toThrow(/technical reviewer/);
    await asmt.recordEvidenceDisposition(w.a.rev, revId, { sample_id: S.PM, kind: 'remaining_coverage_adequate', reason: 'Reviewer judgement: afternoon task identical; morning sample adequate', consequence: 'Afternoon exposure inferred from the morning sample, stated as a limitation' });
    const out = (await asmt.calculate(w.a.prac, revId)).calc_output;
    expect(out.evidenceAdequacy).toBe('adequate_with_accepted_gaps');
    expect(out.setAsideEvidence[0]).toMatchObject({ kind: 'remaining_coverage_adequate', by: expect.stringContaining('technical_reviewer') });
  });

  it('different worker, different substance, different or missing task context, missing pair reference, different instrument: refused', async () => {
    const { revId } = await stelRevision(['PA', 'PW2', 'PT', 'PN', 'PS']);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PW2', 'PA', 'paired_colocated'))).rejects.toThrow(/different worker/);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PT', 'PA', 'paired_colocated'))).rejects.toThrow(/tasks recorded differ/);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PN', 'PA', 'paired_colocated'))).rejects.toThrow(/tasks performed are not recorded/);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PS', 'PA', 'paired_colocated'))).rejects.toThrow(/assessed substance is not recorded/);
    await expect(directInsert(revId, 'PW2', 'PA', 'paired_colocated')).rejects.toThrow(/different worker/);
    await expect(directInsert(revId, 'PT', 'PA', 'paired_colocated')).rejects.toThrow(/tasks recorded for the two samples differ/);
    await expect(directInsert(revId, 'PS', 'PA', 'paired_colocated')).rejects.toThrow(/result for the assessed substance/);
    const { revId: r2 } = await stelRevision(['PA', 'PB']);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, r2, dup('PB', 'PA', 'same_event_record'))).rejects.toThrow(/different instruments/);
    await expect(directInsert(r2, 'PB', 'PA', 'same_event_record')).rejects.toThrow(/same instrument/);
  });

  it('a supported paired sampler is set aside with its relationship evidence, author, justification and consequences in the audit trail and report', async () => {
    const { assessmentId, revId } = await stelRevision(['PA', 'PB']);
    await asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PB', 'PA', 'paired_colocated'));
    const out = (await asmt.calculate(w.a.prac, revId)).calc_output;
    expect([out.benchmarkState, out.evidenceAdequacy]).toEqual(['below_benchmark', 'adequate']);
    expect(out.setAsideEvidence).toEqual([expect.objectContaining({ sampleCode: S.PB_code, kind: 'duplicate', duplicateType: 'paired_colocated', relatedSampleCode: S.PA_code, reason: why.reason, consequence: why.consequence })]);
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const a = (await c.query(`select detail from audit_events where action='assessment.evidence_disposition' and entity_id=$1 order by id desc limit 1`, [revId])).rows[0].detail;
    await c.end();
    expect(a).toMatchObject({ kind: 'duplicate', duplicate_type: 'paired_colocated', sample_code: S.PB_code, related_sample_code: S.PA_code, reason: why.reason, consequence: why.consequence });
    expect(a.sample_flags).toContain('QC_FAIL_UNRESOLVED');
    const html = (await rep.getReport(w.a.prac, (await rep.generateReport(w.a.prac, assessmentId, revId)).id)).content_html;
    expect(html).toMatch(/paired colocated of T67-PA/);
    expect(html).toMatch(/Consequences: The retained sample represents/);
  });

  it('a supported same-event record is accepted', async () => {
    const { revId } = await stelRevision(['PA', 'SE']);
    await asmt.recordEvidenceDisposition(w.a.prac, revId, dup('SE', 'PA', 'same_event_record'));
    expect((await asmt.calculate(w.a.prac, revId)).calc_output.evidenceAdequacy).toBe('adequate');
  });

  it('a higher paired result is a conflict: refused, and re-checked at calculation after a later amendment', async () => {
    const { revId } = await stelRevision(['PA', 'PC']);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PC', 'PA', 'paired_colocated'))).rejects.toThrow(/higher than the retained result/);
    // Accepted while lower; the laboratory then amends PB upwards (traceable revision), and the engine re-checks.
    const { assessmentId, revId: r2 } = await stelRevision(['PA', 'PB']);
    await asmt.recordEvidenceDisposition(w.a.prac, r2, dup('PB', 'PA', 'paired_colocated'));
    await lab.recordResult(w.a.prac, { sampling_event_id: S.PB, substance_id: w.ref.substanceId, value: '45', unit: 'ug', qualifier: '=', lod: '0.1', loq: '0.3', amendment_reason: 'Laboratory re-weighed the filter (synthetic test)' });
    const out = (await asmt.calculate(w.a.prac, r2)).calc_output;
    expect([out.benchmarkState, out.evidenceAdequacy]).toEqual(['indeterminate', 'unresolved_evidence']);
    expect(out.unresolvedEvidence[0].rejectedDisposition).toMatchObject({ kind: 'duplicate', duplicateType: 'paired_colocated', conflict: true });
    const html = (await rep.getReport(w.a.prac, (await rep.generateReport(w.a.prac, assessmentId, r2)).id)).content_html;
    expect(html).toMatch(/Disposition recorded but not accepted \(conflicting results\)/);
    const d = await field.sampleDetail(w.a.prac, S.PB);
    expect(d.results.map((r: any) => r.revision)).toContain(2);
  });
});

describe('TR-07 contradictory detected-below-LOQ inputs (entry, amendment, import, database)', () => {
  const entry = (o: Record<string, unknown>) => lab.recordResult(w.a.prac, { sampling_event_id: S.DBL, substance_id: w.ref.substanceId, unit: 'ug', qualifier: 'detected_below_loq', lod: '10', loq: '30', ...o });
  it('the review reproduction is refused at direct entry with the conflicting fields named; nothing is stored', async () => {
    await expect(entry({ value: '600' })).rejects.toThrow(/value 600 ug, LOD 10 ug, LOQ 30 ug.*above the LOQ.*Fields in conflict: qualifier, value, loq/);
    expect((await field.sampleDetail(w.a.prac, S.DBL)).results).toEqual([]);
  });
  it('boundary values, missing and invalid limits', async () => {
    await expect(entry({ value: '30.0001' })).rejects.toThrow(/above the LOQ/);
    await expect(entry({ value: '9.999' })).rejects.toThrow(/below the LOD/);
    await expect(entry({ value: '20', loq: '' })).rejects.toThrow(/needs both limits/);
    await expect(entry({ value: null, lod: '30' })).rejects.toThrow(/LOD below the LOQ/);
    await expect(entry({ value: '20', value_meaning: 'measured' })).rejects.toThrow(/not valid for qualifier/);
    await expect(entry({ value: '600', value_meaning: 'reporting_threshold' })).rejects.toThrow(/must equal the LOQ/);
  });
  it('a valid detected-below-LOQ record gives the LOD–LOQ interval; amendments are traceable and contradictory amendments refused', async () => {
    await entry({ value: '10', lab_qualifier: 'DET<LOQ' }); // boundary: equal to the LOD, accepted
    await expect(entry({ value: '600', amendment_reason: 'Laboratory re-issue' })).rejects.toThrow(/Contradictory inputs/);
    await entry({ value: '30', value_meaning: 'reporting_threshold', amendment_reason: 'Laboratory clarified: the value field holds the LOQ' });
    const d = await field.sampleDetail(w.a.prac, S.DBL);
    expect(d.results[0]).toMatchObject({ revision: 2, qualifier: 'detected_below_loq', value_meaning: 'reporting_threshold', lab_qualifier: null });
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const revs = (await c.query(`select v.revision, v.value::float8 value, v.value_meaning, v.lab_qualifier, v.amendment_reason from lab_result_revisions v join lab_results r on r.id=v.result_id where r.sampling_event_id=$1 order by v.revision`, [S.DBL])).rows;
    await c.end();
    expect(revs).toEqual([{ revision: 1, value: 10, value_meaning: null, lab_qualifier: 'DET<LOQ', amendment_reason: null }, { revision: 2, value: 30, value_meaning: 'reporting_threshold', lab_qualifier: null, amendment_reason: 'Laboratory clarified: the value field holds the LOQ' }]);
    const { revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title: 'T67 DBL', assessment_question: 'Is exposure adequately controlled for the group?' });
    await updateDraftConfirmed(w.a.prac, revision.id, { sample_ids: [S.DBL], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480', unsampled_assumption: 'none' });
    const s = (await asmt.calculate(w.a.prac, revision.id)).calc_output.samples[0];
    expect(s.concentration.lower).toBeCloseTo(10 / 1000 / 0.96, 12);
    expect(s.concentration.upper).toBeCloseTo(30 / 1000 / 0.96, 12);
  });
  it('the CSV import rejects the reproduction, keeps the original row, and supports an explicit reporting-threshold mapping', async () => {
    const code = S.DBL2_code;
    const bad = await lab.stageImport(w.a.prac, { filename: 'tr07.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,lod,loq\n${code},${AN},600,ug,DET<LOQ,10,30\n` });
    expect(bad.status).toBe('rejected');
    const row = (await lab.importDetail(w.a.prac, bad.id)).rows[0];
    expect(row.raw).toMatchObject({ value: '600', qualifier: 'DET<LOQ', lod: '10', loq: '30' });
    expect(row.errors.join(' ')).toMatch(/Contradictory inputs.*value 600 ug.*LOD 10 ug, LOQ 30 ug/);
    const unknown = await lab.stageImport(w.a.prac, { filename: 'tr07b.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,value_meaning,lod,loq\n${code},${AN},30,ug,DET<LOQ,threshold-ish,10,30\n` });
    expect((await lab.importDetail(w.a.prac, unknown.id)).rows[0].errors.join(' ')).toMatch(/value_meaning/);
    const thr = await lab.stageImport(w.a.prac, { filename: 'tr07c.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,value_meaning,lod,loq\n${code},${AN},600,ug,DET<LOQ,reporting_threshold,10,30\n` });
    expect((await lab.importDetail(w.a.prac, thr.id)).rows[0].errors.join(' ')).toMatch(/must equal the LOQ/);
    const ok = await lab.stageImport(w.a.prac, { filename: 'tr07d.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,value_meaning,lod,loq\n${code},${AN},30,ug,DET<LOQ,reporting_threshold,10,30\n` });
    expect(ok.status).toBe('validated');
    await lab.commitImport(w.a.prac, ok.id);
    expect((await field.sampleDetail(w.a.prac, S.DBL2)).results[0]).toMatchObject({ qualifier: 'detected_below_loq', value_meaning: 'reporting_threshold', lab_qualifier: 'DET<LOQ' });
  });
  it('the database refuses a contradictory detected-below-LOQ revision written directly', async () => {
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const rid = (await c.query('select id, tenant_id, client_id from lab_results where sampling_event_id=$1', [S.DBL])).rows[0];
    await expect(c.query(`insert into lab_result_revisions (tenant_id,client_id,result_id,revision,value,unit,qualifier,lod,loq,amendment_reason) values ($1,$2,$3,99,600,'ug','detected_below_loq',10,30,'test')`, [rid.tenant_id, rid.client_id, rid.id])).rejects.toThrow(/lab_result_value_meaning_valid/);
    await expect(c.query(`insert into lab_result_revisions (tenant_id,client_id,result_id,revision,value,unit,qualifier,lod,loq,value_meaning,amendment_reason) values ($1,$2,$3,99,20,'ug','<LOQ',10,30,'estimate','test')`, [rid.tenant_id, rid.client_id, rid.id])).rejects.toThrow(/lab_result_value_meaning_valid/);
    await c.end();
  });
  it('existing generic qualifiers keep their behaviour at entry', async () => {
    const { syncBatch } = field;
    const [r] = await syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { plan_id: S.plan.id, sample_code: `T67-G-${w.tag}`, sample_type: 'personal', worker_id: S.w[0].id, substance_id: w.ref.substanceId, method_version_id: S.method.id, instrument_id: S.pump.id, timezone: 'UTC', start_local: '2026-03-07T08:00', end_local: '2026-03-07T16:00', flow_pre_lpm: 2, flow_post_lpm: 2 } }]);
    await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `T67G-${w.tag}`, sample_ids: [r.server_id], dispatched_at: '2026-03-08T09:00' });
    const g = { sampling_event_id: r.server_id, substance_id: w.ref.substanceId, unit: 'ug', lod: '10', loq: '30' };
    await lab.recordResult(w.a.prac, { ...g, qualifier: '<LOQ', value: '600' }); // R4 N1 behaviour: kept, the larger bound is used
    await lab.recordResult(w.a.prac, { ...g, qualifier: '<LOD', value: '', amendment_reason: 'Re-issued as non-detect' });
    await lab.recordResult(w.a.prac, { ...g, qualifier: 'estimated', value: '150', amendment_reason: 'Re-issued as estimate' });
    await lab.recordResult(w.a.prac, { ...g, qualifier: '>', value: '500', amendment_reason: 'Re-issued as over range' });
    expect((await field.sampleDetail(w.a.prac, r.server_id!)).results[0]).toMatchObject({ revision: 4, qualifier: '>' });
  });
  it('a historical (pre-028) contradictory record blocks a favourable assessment, cannot be set aside, and is corrected by amendment', async () => {
    // Simulates a record entered before migration 028 (when the database accepted it): the constraint is lifted and
    // restored NOT VALID inside one admin transaction, exactly the state migration 028 leaves for historical rows.
    const [r] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { plan_id: S.plan.id, sample_code: `T67-H-${w.tag}`, sample_type: 'personal', worker_id: S.w[1].id, substance_id: w.ref.substanceId, method_version_id: S.method.id, instrument_id: S.pump.id, timezone: 'UTC', start_local: '2026-03-09T08:00', end_local: '2026-03-09T16:00', flow_pre_lpm: 2, flow_post_lpm: 2 } }]);
    const [ok] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { plan_id: S.plan.id, sample_code: `T67-OK-${w.tag}`, sample_type: 'personal', worker_id: S.w[0].id, substance_id: w.ref.substanceId, method_version_id: S.method.id, instrument_id: S.pump.id, timezone: 'UTC', start_local: '2026-03-09T08:00', end_local: '2026-03-09T16:00', flow_pre_lpm: 2, flow_post_lpm: 2 } }]);
    await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `T67H-${w.tag}`, sample_ids: [r.server_id, ok.server_id], dispatched_at: '2026-03-10T09:00' });
    await lab.recordResult(w.a.prac, { sampling_event_id: ok.server_id, substance_id: w.ref.substanceId, value: '96', unit: 'ug', qualifier: '=', lod: '1', loq: '3' });
    await lab.recordResult(w.a.prac, { sampling_event_id: r.server_id, substance_id: w.ref.substanceId, value: '20', unit: 'ug', qualifier: 'detected_below_loq', lod: '10', loq: '30', lab_qualifier: 'DET<LOQ' });
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const res = (await c.query('select r.id, r.tenant_id, r.client_id from lab_results r where r.sampling_event_id=$1', [r.server_id])).rows[0];
    const def = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='lab_result_value_meaning_valid'`)).rows[0].d;
    await c.query('begin');
    await c.query('alter table lab_result_revisions drop constraint lab_result_value_meaning_valid');
    await c.query(`insert into lab_result_revisions (tenant_id,client_id,result_id,revision,value,unit,qualifier,lod,loq,lab_qualifier,amendment_reason) values ($1,$2,$3,2,600,'ug','detected_below_loq',10,30,'DET<LOQ','Simulated pre-028 laboratory re-issue (synthetic)')`, [res.tenant_id, res.client_id, res.id]);
    await c.query('update lab_results set current_revision=2 where id=$1', [res.id]);
    await c.query(`alter table lab_result_revisions add constraint lab_result_value_meaning_valid ${def.replace(/ NOT VALID$/, '')} not valid`);
    await c.query('commit');
    const { revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title: 'T67 historical', assessment_question: 'Is exposure adequately controlled for the group?' });
    await updateDraftConfirmed(w.a.prac, revision.id, { sample_ids: [ok.server_id, r.server_id], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480', unsampled_assumption: 'none' });
    const out = (await asmt.calculate(w.a.prac, revision.id)).calc_output;
    expect(out.benchmarkState).toBe('indeterminate');
    expect(out.samples.find((s: any) => s.sampleCode === `T67-H-${w.tag}`).flags.map((f: any) => f.code)).toContain('INPUT_INVALID_DBL_VALUE');
    await expect(asmt.recordEvidenceDisposition(w.a.rev, revision.id, { sample_id: r.server_id, kind: 'remaining_coverage_adequate', reason: 'Reviewer judges the other worker adequate', consequence: 'Worker 2 represented by worker 1' })).rejects.toThrow(/contradictory or invalid inputs awaiting correction/);
    await asmt.recordEvidenceDisposition(w.a.prac, revision.id, { sample_id: r.server_id, kind: 'not_replaced', reason: 'Laboratory clarification requested for the contradictory result', consequence: 'Worker 2 unassessed until the laboratory clarifies the result' });
    expect((await asmt.calculate(w.a.prac, revision.id)).calc_output.evidenceAdequacy).toBe('coverage_gap');
    // Correction through the amendment workflow; revisions 1 and 2 (the contradictory one) are kept.
    await lab.recordResult(w.a.prac, { sampling_event_id: r.server_id, substance_id: w.ref.substanceId, value: '20', unit: 'ug', qualifier: 'detected_below_loq', lod: '10', loq: '30', lab_qualifier: 'DET<LOQ', amendment_reason: 'Laboratory clarified: estimate 20 ug; 600 was a transcription error' });
    const kept = (await c.query('select v.revision, v.value::float8 value from lab_result_revisions v where v.result_id=$1 order by v.revision', [res.id])).rows;
    await c.end();
    expect(kept).toEqual([{ revision: 1, value: 20 }, { revision: 2, value: 600 }, { revision: 3, value: 20 }]);
    const fixed = (await asmt.calculate(w.a.prac, revision.id)).calc_output;
    expect(fixed.samples.find((s: any) => s.sampleCode === `T67-H-${w.tag}`).concentration).toMatchObject({ unit: 'mg/m3' });
  });
});

describe('R5 re-check fixes (engine 1.5.1)', () => {
  it('F1: a paired sampler without a calculable result cannot be set aside as a duplicate', async () => {
    const { revId } = await stelRevision(['PA', 'PX']);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PX', 'PA', 'paired_colocated'))).rejects.toThrow(/no calculable result/);
    const out = (await asmt.calculate(w.a.prac, revId)).calc_output;
    expect([out.benchmarkState, out.evidenceAdequacy]).toEqual(['indeterminate', 'unresolved_evidence']);
  });

  it('F2: a practitioner removing samples from the list is a request; the samples stay in the evidence until a reviewer confirms', async () => {
    const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title: 'T67 F2', assessment_question: 'Is short-term exposure adequately controlled?' });
    await updateDraftConfirmed(w.a.prac, revision.id, { calc_code: 'stel_15', sample_ids: [S.AM, S.PM], benchmark_version_id: S.bm15 });
    await expect(asmt.updateDraft(w.a.prac, revision.id, { calc_code: 'stel_15', sample_ids: [S.AM], benchmark_version_id: S.bm15 })).rejects.toThrow(/Give a reason/);
    await asmt.updateDraft(w.a.prac, revision.id, { calc_code: 'stel_15', sample_ids: [S.AM], benchmark_version_id: S.bm15, removal_reason: 'Afternoon sample not needed for this question' });
    const out = (await asmt.calculate(w.a.prac, revision.id)).calc_output;
    expect(out.samples.map((x: any) => x.sampleCode)).toContain(S.PM_code); // still in the evidence
    expect([out.benchmarkState, out.evidenceAdequacy]).toEqual(['indeterminate', 'unresolved_evidence']);
    // Only a technical reviewer can confirm, in the service and in the database.
    await expect(asmt.confirmSampleRemoval(w.a.prac, revision.id, { sample_id: S.PM, reason: 'Practitioner tries to confirm' })).rejects.toThrow(/technical reviewer/);
    await expect(withActor(w.a.prac, (tx) => tx.query(`insert into assessment_sample_removals (tenant_id,client_id,revision_id,sampling_event_id,action,reason,recorded_by) select tenant_id, client_id, id, $2, 'confirmed', 'Direct write attempt', $3 from assessment_revisions where id=$1`, [revision.id, S.PM, w.a.prac.userId]))).rejects.toThrow(/technical reviewer/);
    const d = await asmt.assessmentDetail(w.a.prac, assessment.id);
    expect(d.removals.filter((x: any) => x.status === 'pending_reviewer_confirmation')).toEqual([expect.objectContaining({ sampleCode: S.PM_code, status: 'pending_reviewer_confirmation', reason: 'Afternoon sample not needed for this question' })]);
    let html = (await rep.getReport(w.a.prac, (await rep.generateReport(w.a.prac, assessment.id, revision.id)).id)).content_html;
    expect(html).toMatch(/removal requested but not confirmed by a technical reviewer/);
    await asmt.confirmSampleRemoval(w.a.rev, revision.id, { sample_id: S.PM, reason: 'Reviewer: afternoon task is a different activity, outside this question' });
    const after = (await asmt.calculate(w.a.prac, revision.id)).calc_output;
    expect(after.samples.map((x: any) => x.sampleCode)).not.toContain(S.PM_code);
    html = (await rep.getReport(w.a.prac, (await rep.generateReport(w.a.prac, assessment.id, revision.id)).id)).content_html;
    expect(html).toMatch(/removal confirmed by technical_reviewer/);
    await expect(withActor(w.a.prac, (tx) => tx.query('update assessment_sample_removals set reason=$2 where revision_id=$1', [revision.id, 'changed later']))).rejects.toThrow(/append-only|permission/);
  });

  it('F3: a duplicate stops applying when the set-aside sample is voided afterwards', async () => {
    const { revId } = await stelRevision(['PA', 'PV']);
    await asmt.recordEvidenceDisposition(w.a.prac, revId, dup('PV', 'PA', 'paired_colocated'));
    expect((await asmt.calculate(w.a.prac, revId)).calc_output.evidenceAdequacy).toBe('adequate');
    await field.voidSamplingEvent(w.a.prac, S.PV, { reason: 'Filter found damaged on re-inspection (synthetic test)' });
    const out = (await asmt.calculate(w.a.prac, revId)).calc_output;
    expect(out.evidenceAdequacy).toBe('unresolved_evidence');
    expect(out.unresolvedEvidence[0].why).toMatch(/void sample/);
  });

  it('F4, F5: the database refuses non-finite laboratory values and a related sample on a non-duplicate disposition', async () => {
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const rid = (await c.query('select id, tenant_id, client_id from lab_results where sampling_event_id=$1', [S.AM])).rows[0];
    await expect(c.query(`insert into lab_result_revisions (tenant_id,client_id,result_id,revision,value,unit,qualifier,lod,loq,amendment_reason) values ($1,$2,$3,98,600,'ug','detected_below_loq',10,'Infinity','test')`, [rid.tenant_id, rid.client_id, rid.id])).rejects.toThrow(/lab_result_values_finite/);
    await expect(c.query(`insert into lab_result_revisions (tenant_id,client_id,result_id,revision,value,unit,qualifier,amendment_reason) values ($1,$2,$3,98,'NaN','ug','=','test')`, [rid.tenant_id, rid.client_id, rid.id])).rejects.toThrow(/lab_result_values_finite/);
    await c.end();
    const { revId } = await stelRevision(['AM', 'PM']);
    await expect(withActor(w.a.prac, (tx) => tx.query(`insert into assessment_evidence_dispositions (tenant_id,client_id,revision_id,sampling_event_id,kind,reason,consequence,related_sampling_event_id,recorded_by)
      select tenant_id, client_id, id, $2, 'not_replaced', 'Direct write attempt here', 'Direct write attempt here', $3, $4 from assessment_revisions where id=$1`, [revId, S.PM, S.AM, w.a.prac.userId]))).rejects.toThrow(/evidence_disposition_related_only_duplicate/);
  });

  it('F6: the CSV import rejects hexadecimal and other non-decimal numbers instead of reinterpreting them', async () => {
    const b = await lab.stageImport(w.a.prac, { filename: 'hex.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,lod,loq,amendment_reason\n${S.DBL2_code},${AN},0x1E,ug,=,10,30,re-issue\n${S.DBL2_code},${AN},Infinity,ug,=,10,30,re-issue\n` });
    const rows = (await lab.importDetail(w.a.prac, b.id)).rows;
    expect(rows[0].errors.join(' ')).toMatch(/"0x1E" is not a number/);
    expect(rows[1].errors.join(' ')).toMatch(/"Infinity" is not a number/);
  });

  it('F7: the audit event keeps the relationship evidence and the retained result', async () => {
    const { revId } = await stelRevision(['PA', 'SE']);
    await asmt.recordEvidenceDisposition(w.a.prac, revId, dup('SE', 'PA', 'same_event_record'));
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const a = (await c.query(`select detail from audit_events where action='assessment.evidence_disposition' and entity_id=$1 order by id desc limit 1`, [revId])).rows[0].detail;
    await c.end();
    expect(a.relationship.setAside).toMatchObject({ sampleCode: S.SE_code, instrument: S.pump.asset_tag, tasks: 'Main task', window: ['2026-03-03T08:00:00.000Z', '2026-03-03T08:15:00.000Z'] });
    expect(a.relationship.retained).toMatchObject({ sampleCode: S.PA_code, instrument: S.pump.asset_tag, pairRef: 'PR-1' });
    expect(a.related_interval).toMatchObject({ unit: 'mg/m3' });
  });
});
