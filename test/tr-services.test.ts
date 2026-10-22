// Engine 1.4.0 remediation at the application level: import/API boundaries (TR-03, item C), evidence dispositions
// (TR-02), acceptance dispositions (TR-05), shift association (item A), task intervals (item B), report consistency.
import { randomUUID, createHash } from 'node:crypto';
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
import * as ctl from '../src/services/controls.js';
import { evidenceFacts, narrativeChecks } from '../src/services/narrative.js';

let w: World;
const S: Record<string, any> = {};
const URL_ = process.env.DATABASE_ADMIN_URL!;
const sha = (x: string) => createHash('sha256').update(x).digest('hex');

beforeAll(async () => {
  w = await buildWorld();
  const { prac } = w.a;
  const site = await reg.createSite(prac, { client_id: w.A.clients['Client One'], name: 'TR site', reference: `TR-${w.tag}` });
  const area = await reg.createWorkArea(prac, { site_id: site.id, name: 'Bay' });
  const proc = await reg.createProcess(prac, { work_area_id: area.id, name: 'Process' });
  S.task = await reg.createTask(prac, { process_id: proc.id, name: 'Main task', duration_min_per_shift: '480', duration_basis: 'recorded_fact', typical_start_min: '0', typical_end_min: '480' });
  const hz = await reg.createHazard(prac, { task_id: S.task.id, substance_id: w.ref.substanceId, physical_form: 'dust', exposure_routes: ['inhalation'] });
  S.group = await reg.createGroup(prac, { site_id: site.id, name: 'TR group', rationale: 'Same task, same tools and same shift pattern; comparable work methods observed.', task_ids: [S.task.id], hazard_ids: [hz.id] });
  S.workers = [];
  for (const n of [1, 2]) {
    const wk = await reg.createWorker(prac, { client_id: w.A.clients['Client One'], ref_code: `TRW${n}-${w.tag}`, full_name: `TR Worker ${n}` });
    await reg.addMembership(prac, { group_id: S.group.id, worker_id: wk.id, valid_from: '2026-01-01' });
    S.workers.push(wk);
  }
  S.pump = await inst.createInstrument(prac, { asset_tag: `TRP-${w.tag}`, instrument_type: 'sampling_pump' });
  await inst.recordCalibration(prac, S.pump.id, { performed_at: '2026-01-01', valid_until: '2027-12-31', outcome: 'pass' });
  S.method = await inst.createMethodVersion(w.a.prac, { code: `TRM-${w.tag}`, title: 'TR gravimetric', source_reference: 'Test fixture', version: '1', flow_drift_tolerance_pct: '5', result_basis: 'mass_on_sample', suitable_for_formal_assessment: 'on', flow_drift_consequence: 'disposition_required' });
  S.plan = await plans.createPlan(prac, { site_id: site.id, title: 'TR plan', purpose: 'Remediation tests for engine 1.4.0', assessment_question: 'What is the 8-hour TWA?', approach: 'personal', strategy_rationale: 'Full-shift personal samples of all two workers on one day.', instrument_ids: [S.pump.id] });
  await plans.addTarget(prac, S.plan.id, { group_id: S.group.id, substance_id: w.ref.substanceId, method_version_id: S.method.id, planned_samples: '2' });
  await plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' });
  await plans.transitionPlan(prac, S.plan.id, { to: 'scheduled' });
  await plans.transitionPlan(w.a.tech, S.plan.id, { to: 'in_progress' });
  const cap = async (code: string, wi: number, post: number, shift: string | null) => (await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: {
    plan_id: S.plan.id, sample_code: code, sample_type: 'personal', worker_id: S.workers[wi].id, substance_id: w.ref.substanceId, method_version_id: S.method.id, instrument_id: S.pump.id,
    timezone: 'UTC', start_local: '2026-03-02T08:00', end_local: '2026-03-02T16:00', flow_pre_lpm: 2, flow_post_lpm: post, shift_ref: shift } }]))[0];
  S.codes = [`TR1-${w.tag}`, `TR2-${w.tag}`];
  const r1 = await cap(S.codes[0], 0, 2, 'DAY-0302');
  const r2 = await cap(S.codes[1], 1, 1, 'DAY-0302');
  S.s1 = r1.server_id; S.s2 = r2.server_id;
  S.lab = await inst.createLaboratory(prac, { name: `TR lab ${w.tag}` });
  await lab.createSubmission(prac, { laboratory_id: S.lab.id, reference: `TRSUB-${w.tag}`, sample_ids: [S.s1, S.s2], dispatched_at: '2026-03-04T09:00' });
  const sub = (await lab.listSubmissions(prac)).find((s) => s.reference === `TRSUB-${w.tag}`);
  await lab.receiveSubmission(prac, sub.id, { received_at: '2026-03-05T10:00', received_condition: 'Intact' });
});
afterAll(async () => { await closePool(); });

describe('TR-03 and item C at the import and API boundaries (separately from the engine)', () => {
  it('rejects contradictory limits, unknown qualifiers and non-finite values in a laboratory file', async () => {
    const an = 'Demo Dust X (synthetic)';
    const bad = await lab.stageImport(w.a.prac, { filename: 'bad.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,lod,loq\n${S.codes[0]},${an},,ug,<LOQ,1000,1\n${S.codes[1]},${an},abc,ug,=,1,3\n` });
    expect(bad.status).toBe('rejected');
    const rows = (await lab.importDetail(w.a.prac, bad.id)).rows.map((r: any) => r.errors.join(' '));
    expect(rows[0]).toMatch(/LOQ cannot be below LOD/);
    expect(rows[1]).toMatch(/not a number/);
    const q = await lab.stageImport(w.a.prac, { filename: 'q.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,lod,loq\n${S.codes[0]},${an},5,ug,~approx,1,3\n` });
    expect((await lab.importDetail(w.a.prac, q.id)).rows[0].errors.join(' ')).toMatch(/not recognised/);
  });
  it('maps laboratory qualifier text and keeps the original; "<LOQ" is not read as a detection', async () => {
    const an = 'Demo Dust X (synthetic)';
    const ok = await lab.stageImport(w.a.prac, { filename: 'ok.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,lod,loq\n${S.codes[0]},${an},300,ug,=,10,30\n${S.codes[1]},${an},,ug,DET<LOQ,10,30\n` });
    expect(ok.status).toBe('validated');
    await lab.commitImport(w.a.prac, ok.id);
    const d = await field.sampleDetail(w.a.prac, S.s2);
    expect(d.results[0].qualifier).toBe('detected_below_loq');
    expect(d.results[0].lab_qualifier).toBe('DET<LOQ');
  });
  it('the database refuses contradictory limits even through a direct write', async () => {
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const rid = (await c.query('select id, tenant_id, client_id from lab_results where sampling_event_id=$1', [S.s1])).rows[0];
    await expect(c.query(`insert into lab_result_revisions (tenant_id,client_id,result_id,revision,unit,qualifier,lod,loq,amendment_reason) values ($1,$2,$3,99,'ug','<LOQ',1000,1,'test')`, [rid.tenant_id, rid.client_id, rid.id])).rejects.toThrow(/lab_result_values_valid/);
    await c.end();
  });
  it('refuses invalid method parameters and task intervals', async () => {
    await expect(inst.createMethodVersion(w.a.prac, { code: `X-${w.tag}`, title: 'Bad', source_reference: 'Test fixture', version: '1', min_volume_l: '0', result_basis: 'mass_on_sample' })).rejects.toThrow(/greater than zero/);
    await expect(reg.updateTask(w.a.prac, S.task.id, { name: 'Main task', duration_min_per_shift: '480', typical_start_min: '300', typical_end_min: '100' })).rejects.toThrow(/start < end/);
  });
});

describe('TR-05 acceptance dispositions', () => {
  it('a failed flow criterion excludes the sample until a technical reviewer accepts it with evidence and scope', async () => {
    const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title: 'TR assessment', assessment_question: 'Is exposure adequately controlled for the TR group?' });
    S.as = assessment; S.rev = revision.id;
    await updateDraftConfirmed(w.a.prac, S.rev, { sample_ids: [S.s1, S.s2], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480', unsampled_assumption: 'none' });
    const c1 = await asmt.calculate(w.a.prac, S.rev);
    const s2 = c1.calc_output.samples.find((s: any) => s.sampleCode === S.codes[1]);
    expect(s2.included).toBe(false);
    expect(s2.flags.map((f: any) => f.code)).toContain('FLOW_DRIFT_DISPOSITION_REQUIRED');
    expect(c1.calc_output.evidenceAdequacy).toBe('unresolved_evidence');
    await expect(field.recordAcceptanceDisposition(w.a.prac, S.s2, { criterion: 'flow_drift', evidence: 'Mid-sampling checks recorded', scope: 'This sample' })).rejects.toThrow(/permission/);
    await expect(withActor(w.a.prac, (tx) => tx.query(`insert into sample_acceptance_dispositions (tenant_id,client_id,sampling_event_id,criterion,evidence,scope,authorised_by) select tenant_id, client_id, id, 'flow_drift', 'Direct write attempt', 'This sample', $2 from sampling_events where id=$1`, [S.s2, w.a.prac.userId]))).rejects.toThrow(/technical reviewer/);
    await field.recordAcceptanceDisposition(w.a.rev, S.s2, { criterion: 'flow_drift', evidence: 'Mid-sampling flow checks at 2 h and 4 h were within 5 %; pump log PL-7.', scope: 'This sample, March 2026 baseline only' });
    await expect(asmt.submitForReview(w.a.prac, S.rev)).rejects.toThrow(/changed|Recalculate|interpretation/i);
    const c2 = await asmt.calculate(w.a.prac, S.rev);
    const s2b = c2.calc_output.samples.find((s: any) => s.sampleCode === S.codes[1]);
    expect(s2b.included).toBe(true);
    expect(s2b.flags.map((f: any) => f.code)).toContain('FLOW_DRIFT_ACCEPTED');
  });
  it('a method criterion marked invalid cannot be accepted', async () => {
    const m = await inst.createMethodVersion(w.a.prac, { code: `TRM-${w.tag}`, title: 'TR gravimetric', source_reference: 'Test fixture', version: '2-cyclone', flow_drift_tolerance_pct: '5', result_basis: 'mass_on_sample', suitable_for_formal_assessment: 'on', flow_drift_consequence: 'invalid' });
    const [r] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { plan_id: S.plan.id, sample_code: `TRX-${w.tag}`, sample_type: 'personal', worker_id: S.workers[0].id, substance_id: w.ref.substanceId, method_version_id: m.id, instrument_id: S.pump.id, timezone: 'UTC', start_local: '2026-03-03T08:00', end_local: '2026-03-03T16:00', flow_pre_lpm: 2, flow_post_lpm: 1 } }]);
    await expect(field.recordAcceptanceDisposition(w.a.rev, r.server_id!, { criterion: 'flow_drift', evidence: 'Any evidence at all here', scope: 'This sample' })).rejects.toThrow(/invalid/);
  });
});

describe('TR-02 evidence dispositions', () => {
  it('records dispositions on drafts only, by permitted roles, and the reviewer-only judgement is enforced', async () => {
    await expect(asmt.recordEvidenceDisposition(w.a.tech, S.rev, { sample_id: S.s2, kind: 'outside_scope', reason: 'Not part of scope here', consequence: 'No effect on the assessment' })).rejects.toThrow(/permission|practitioner/i);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, S.rev, { sample_id: S.s2, kind: 'remaining_coverage_adequate', reason: 'Remaining coverage judged adequate', consequence: 'Worker 2 covered by other evidence' })).rejects.toThrow(/technical reviewer/);
    await expect(withActor(w.a.prac, (tx) => tx.query(`insert into assessment_evidence_dispositions (tenant_id,client_id,revision_id,sampling_event_id,kind,reason,consequence,recorded_by) select tenant_id, client_id, id, $2, 'remaining_coverage_adequate', 'Direct write attempt', 'Direct write attempt', $3 from assessment_revisions where id=$1`, [S.rev, S.s2, w.a.prac.userId]))).rejects.toThrow(/technical reviewer/);
    await asmt.recordEvidenceDisposition(w.a.prac, S.rev, { sample_id: S.s2, kind: 'not_replaced', reason: 'Recorded for the regression test', consequence: 'Worker 2 remains unassessed for this period' });
    const rv = (await asmt.assessmentDetail(w.a.prac, S.as.id)).current;
    expect(rv.calc_output).toBeNull(); // a disposition clears the calculation
    await expect(withActor(w.a.prac, (tx) => tx.query('update assessment_evidence_dispositions set reason=$2 where revision_id=$1', [S.rev, 'changed later']))).rejects.toThrow(/append-only|permission/);
  });
  it('item A: shift references recorded at capture reach the engine', async () => {
    const out = (await asmt.calculate(w.a.prac, S.rev)).calc_output;
    expect(out.shifts.every((s: any) => s.shiftRef === 'DAY-0302')).toBe(true);
    expect(out.shifts.flatMap((s: any) => s.flags.map((f: any) => f.code))).not.toContain('SHIFT_INFERRED');
  });
  it('item B: the register supplies task records with times', async () => {
    const out = (await asmt.calculate(w.a.prac, S.rev)).calc_output;
    expect(out.issues.map((f: any) => f.code)).not.toContain('EXPOSURE_NOT_IN_REGISTER');
    const snap = (await asmt.assessmentDetail(w.a.prac, S.as.id)).current.inputs_snapshot;
    expect(snap.exposureRecords).toEqual([{ ref: 'Main task', minutes: 480, basis: 'recorded_fact', startMin: 0, endMin: 480 }]);
  });
});

describe('report consistency (section 8 of the brief)', () => {
  it('flags narrative contradictions, separates usage indicators and states when no actions are linked', async () => {
    await updateDraftConfirmed(w.a.prac, S.rev, { sample_ids: [S.s1, S.s2], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
      interpretation: 'Three workers were sampled over two days; results are roughly half the benchmark.', conclusion_category: 'improvement_required', limitations: 'Regression test data only.' });
    await asmt.recordEvidenceDisposition(w.a.prac, S.rev, { sample_id: S.s2, kind: 'not_replaced', reason: 'Recorded for the regression test', consequence: 'Worker 2 remains unassessed for this period' });
    const r = await asmt.calculate(w.a.prac, S.rev);
    const issues = narrativeChecks(r.interpretation, evidenceFacts(r.calc_output));
    expect(issues.join(' ')).toMatch(/Three workers were sampled/);
    expect(issues.join(' ')).toMatch(/two days/);
    const draft = await rep.generateReport(w.a.prac, S.as.id, S.rev);
    const html = (await rep.getReport(w.a.prac, draft.id)).content_html;
    expect(html).toMatch(/In calculation/);
    expect(html).toMatch(/In formal comparison/);
    expect(html).not.toMatch(/<th>Used<\/th>/);
    expect(html).toMatch(/Consistency check/);
    expect(html).toMatch(/No actions are linked to this assessment/);
    expect(html).toMatch(/Sampling achieved \(from the records\)/);
    expect(draft.content_hash).toBe(sha(html));
  });
  it('a linked action replaces the no-action statement', async () => {
    await ctl.createAction(w.a.prac, { title: 'Improve extraction', source_type: 'assessment', source_id: S.as.id, owner_user_id: w.a.owner.userId, verification_requirement: 'Face velocity test and re-sampling of both workers' });
    const draft = await rep.generateReport(w.a.prac, S.as.id, S.rev);
    const html = (await rep.getReport(w.a.prac, draft.id)).content_html;
    expect(html).not.toMatch(/No actions are linked/);
    expect(html).toMatch(/Improve extraction/);
  });
});

describe('versioning (section 9 of the brief)', () => {
  it('an approval of the previous method version does not transfer to the changed version', async () => {
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    await c.query('begin');
    try {
      await c.query(`insert into method_reviews (calc_code,calc_version,status,reviewer_name,reviewer_competence,reviewed_on,evidence_ref,recorded_by,permitted_scope,evidence_sha256)
        values ('twa_8h','1.2.1','approved','Former Reviewer','Test competence','2026-01-01','OLD-PACK','test operator','Former scope', repeat('a',64))`);
      expect((await c.query(`select method_status_effective('twa_8h','1.2.1') s`)).rows[0].s).toBe('approved');
      expect((await c.query(`select method_status_effective('twa_8h','1.3.0') s`)).rows[0].s).not.toMatch(/approved/);
    } finally { await c.query('rollback'); await c.end(); }
  });
  it('a new revision is calculated with the current versions and keeps the earlier approved revision unchanged', async () => {
    const { CALCULATIONS } = await import('../src/calc/engine.js');
    const d = await asmt.assessmentDetail(w.a.prac, S.as.id);
    expect(d.current.calc_version).toBe(CALCULATIONS.twa_8h.version);
  });
});

describe('R4 re-check fixes', () => {
  it('N4: setting evidence aside as outside scope is a reviewer decision (service and database)', async () => {
    await expect(asmt.recordEvidenceDisposition(w.a.prac, S.rev, { sample_id: S.s2, kind: 'outside_scope', reason: 'Not part of the scope here', consequence: 'No effect on the assessment' })).rejects.toThrow(/technical reviewer/);
    await expect(withActor(w.a.prac, (tx) => tx.query(`insert into assessment_evidence_dispositions (tenant_id,client_id,revision_id,sampling_event_id,kind,reason,consequence,recorded_by) select tenant_id, client_id, id, $2, 'outside_scope', 'Direct write attempt', 'Direct write attempt', $3 from assessment_revisions where id=$1`, [S.rev, S.s2, w.a.prac.userId]))).rejects.toThrow(/technical reviewer/);
    await expect(asmt.recordEvidenceDisposition(w.a.prac, S.rev, { sample_id: S.s2, kind: 'duplicate', related_sample_id: S.s2, reason: 'Duplicate of itself attempt', consequence: 'Should be refused here' })).rejects.toThrow(/itself/);
  });
  it('N7: only a criterion that actually failed can be accepted', async () => {
    await expect(field.recordAcceptanceDisposition(w.a.rev, S.s1, { criterion: 'flow_drift', evidence: 'Nothing failed on this sample', scope: 'This sample' })).rejects.toThrow(/has not failed/);
  });
  it('N2: an over-range formal result is the highest result and makes percentage statements questionable', () => {
    const out = { samples: [], unresolvedEvidence: [], shifts: [
      { subjectRef: 'W1', shiftDate: 'd', result: { lower: 0.3125, upper: 0.3125, unit: 'mg/m3' }, comparison: { state: 'below_benchmark', ratio: { lower: 0.625, upper: 0.625 } }, indicative: false },
      { subjectRef: 'W2', shiftDate: 'd', result: { lower: 0.2083, upper: 'Infinity', unit: 'mg/m3', upperUnbounded: true }, comparison: { state: 'indeterminate', ratio: { lower: 0.4167, upper: 'Infinity' } }, indicative: false }] };
    const f = evidenceFacts(out);
    expect(f.highestRatio).toBe(Infinity);
    expect(narrativeChecks('Exposure was about 60 % of the WEL.', f).join(' ')).toMatch(/over range/);
  });
  it('an approved revision is unchanged by a later revision calculated with the current versions', async () => {
    await updateDraftConfirmed(w.a.prac, S.rev, { sample_ids: [S.s1, S.s2], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
      interpretation: 'Two workers were sampled on one day; one worker remains unassessed (flow failure).', conclusion_category: 'insufficient_evidence', limitations: 'Regression test data only.' });
    await asmt.recordEvidenceDisposition(w.a.prac, S.rev, { sample_id: S.s2, kind: 'not_replaced', reason: 'Recorded for the regression test', consequence: 'Worker 2 remains unassessed for this period' });
    await asmt.calculate(w.a.prac, S.rev);
    await asmt.submitForReview(w.a.prac, S.rev);
    await asmt.approve(w.a.rev, S.rev, { approval_scope: 'TR regression test scope', approval_limitations: 'Automated test only', confirm_reviewed: 'on' });
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    const h = async () => (await c.query('select md5(r::text) h from assessment_revisions r where id=$1', [S.rev])).rows[0].h;
    const before = await h();
    const n = await asmt.newRevision(w.a.prac, S.as.id, { change_reason: 'Reassessment after engine change' });
    await asmt.calculate(w.a.prac, n.id);
    expect(await h()).toBe(before);
    expect((await c.query('select calc_version, supersedes_revision_id from assessment_revisions where id=$1', [n.id])).rows[0]).toEqual({ calc_version: (await import('../src/calc/engine.js')).CALCULATIONS.twa_8h.version, supersedes_revision_id: S.rev });
    await c.end();
  });
});
