// TR-08 scenarios: samples whose removal awaits a technical reviewer's confirmation stay in the calculation
// (buildSnapshot) — are they also covered by the approval safeguards? Each scenario runs through the application services
// and database roles used by normal users and RETURNS what happened (it asserts nothing). The same scenarios are run on
// the reviewed code (probe, before the fix) and after the fix (test/tr08.test.ts asserts the required outcomes).
// Concurrency: explicit synchronisation — the approval is paused at a known lock and the other writer's state is read from
// pg_stat_activity; no fixed delays decide the outcome.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildWorld, type World } from './fixtures.js';
import * as reg from '../src/services/register.js';
import * as inst from '../src/services/instruments.js';
import * as plans from '../src/services/plans.js';
import * as field from '../src/services/field.js';
import * as lab from '../src/services/lab.js';
import * as asmt from '../src/services/assessments.js';
import { resumeWorkflows, suspendWorkflows } from '../scripts/platform-controls.js';

const URL_ = () => process.env.DATABASE_ADMIN_URL!;
export const attempt = async (f: () => Promise<unknown>) => { try { await f(); return 'succeeded'; } catch (e: any) { return `refused: ${e.message}`; } };
const admin = async () => { const c = new pg.Client({ connectionString: URL_() }); await c.connect(); return c; };
export async function waitFor(cond: () => Promise<boolean>, what: string, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for: ${what}`);
}
/** Backends of the application role currently waiting for a lock, with their query text. */
export async function lockWaiters(c: pg.Client) {
  return (await c.query(`select pid, query from pg_stat_activity where wait_event_type='Lock' and usename='ohea_app'`)).rows as { pid: number; query: string }[];
}

export async function setup() {
  const w: World = await buildWorld();
  const S: Record<string, any> = { w };
  const { prac } = w.a;
  const site = await reg.createSite(prac, { client_id: w.A.clients['Client One'], name: 'TR-08 site', reference: `T8-${w.tag}` });
  const area = await reg.createWorkArea(prac, { site_id: site.id, name: 'Bay' });
  const proc = await reg.createProcess(prac, { work_area_id: area.id, name: 'Process' });
  const task = await reg.createTask(prac, { process_id: proc.id, name: 'Main task', duration_min_per_shift: '480', duration_basis: 'recorded_fact', typical_start_min: '0', typical_end_min: '480' });
  const hz = await reg.createHazard(prac, { task_id: task.id, substance_id: w.ref.substanceId, physical_form: 'dust', exposure_routes: ['inhalation'] });
  S.group = await reg.createGroup(prac, { site_id: site.id, name: 'TR-08 group', rationale: 'Same task, same tools and same shift pattern; comparable work methods observed.', task_ids: [task.id], hazard_ids: [hz.id] });
  S.worker = await reg.createWorker(prac, { client_id: w.A.clients['Client One'], ref_code: `T8W-${w.tag}`, full_name: 'TR-08 Worker' });
  await reg.addMembership(prac, { group_id: S.group.id, worker_id: S.worker.id, valid_from: '2026-01-01' });
  S.pump = await inst.createInstrument(prac, { asset_tag: `T8P-${w.tag}`, instrument_type: 'sampling_pump' });
  S.pump2 = await inst.createInstrument(prac, { asset_tag: `T8Q-${w.tag}`, instrument_type: 'sampling_pump' });
  for (const p of [S.pump, S.pump2]) await inst.recordCalibration(prac, p.id, { performed_at: '2026-01-01', valid_until: '2027-12-31', outcome: 'pass' });
  S.method = await inst.createMethodVersion(prac, { code: `T8M-${w.tag}`, title: 'TR-08 gravimetric', source_reference: 'Test fixture', version: '1', flow_drift_tolerance_pct: '5', result_basis: 'mass_on_sample', suitable_for_formal_assessment: 'on', flow_drift_consequence: 'disposition_required' });
  S.plan = await plans.createPlan(prac, { site_id: site.id, title: 'TR-08 plan', purpose: 'TR-08 effective sample list', assessment_question: 'What is the 8-hour TWA?', approach: 'personal', strategy_rationale: 'Full-shift personal samples.', instrument_ids: [S.pump.id, S.pump2.id] });
  await plans.addTarget(prac, S.plan.id, { group_id: S.group.id, substance_id: w.ref.substanceId, method_version_id: S.method.id, planned_samples: '20' });
  await plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' });
  await plans.transitionPlan(prac, S.plan.id, { to: 'scheduled' });
  await plans.transitionPlan(w.a.tech, S.plan.id, { to: 'in_progress' });
  S.lab = await inst.createLaboratory(prac, { name: `T8 lab ${w.tag}` });
  S.n = 0;
  return S;
}

/** Captures, dispatches, receives and analyses one full-shift sample (300 µg → 0.3125 mg/m³ at 960 L). */
export async function sample(S: any, o: { pump?: any; day: number; qcFail?: boolean } ) {
  const { w } = S;
  const code = `T8-${++S.n}-${w.tag}`;
  const day = String(o.day).padStart(2, '0');
  const payload = { plan_id: S.plan.id, sample_code: code, sample_type: 'personal', worker_id: S.worker.id, substance_id: w.ref.substanceId, method_version_id: S.method.id, instrument_id: (o.pump ?? S.pump).id,
    timezone: 'UTC', start_local: `2026-04-${day}T08:00`, end_local: `2026-04-${day}T16:00`, flow_pre_lpm: 2, flow_post_lpm: 2, tasks_performed: 'Main task' };
  const client_uuid = randomUUID();
  const [r] = await field.syncBatch(w.a.tech, [{ client_uuid, server_id: null, base_version: null, payload }]);
  if (o.qcFail) await field.addQcCheck(w.a.tech, r.server_id!, { check_type: 'flow_check', outcome: 'fail', detail: 'Pump fault at collection' });
  await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `T8SUB-${code}`, sample_ids: [r.server_id], dispatched_at: '2026-04-28T09:00' });
  await lab.recordResult(w.a.prac, { sampling_event_id: r.server_id, substance_id: w.ref.substanceId, value: '300', unit: 'ug', qualifier: '=', lod: '1', loq: '3' });
  return { id: r.server_id!, code, client_uuid, payload };
}

const draftBase = (S: any) => ({ benchmark_version_id: S.w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
  interpretation: 'Synthetic TR-08 scenario; one full-shift result below the synthetic benchmark.', conclusion_category: 'insufficient_evidence', limitations: 'Synthetic test data only.' });

/** Assessment whose selected list is [keep]; `pending` is removed by the practitioner and NOT confirmed by a reviewer. */
export async function withPendingRemoval(S: any, keep: string, pending: string, title: string) {
  const { w } = S;
  const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title, assessment_question: 'Is exposure adequately controlled for the TR-08 group?' });
  // Narrow the creation pool to [keep, pending] through the confirmed route (the fixture's other samples are not part of the case) …
  const { updateDraftConfirmed } = await import('./fixtures.js');
  await updateDraftConfirmed(w.a.prac, revision.id, { ...draftBase(S), sample_ids: [keep, pending] });
  // … then the practitioner removes `pending` with a reason; no reviewer confirms it.
  await asmt.updateDraft(w.a.prac, revision.id, { ...draftBase(S), sample_ids: [keep], removal_reason: 'Practitioner removes this sample (TR-08 scenario)' });
  return { assessmentId: assessment.id, revId: revision.id };
}

const approveIn = { approval_scope: 'TR-08 test scope only', approval_limitations: 'Synthetic test data only', confirm_reviewed: 'on' };

// ── Scenarios ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function heldSample(S: any) {
  const { w } = S;
  const keep = await sample(S, { day: 1 }), x = await sample(S, { day: 2 });
  await suspendWorkflows(URL_(), w.A.tenant.id, ['field_sync'], 'TR-08 held-record scenario', 'TR-08 Operator');
  await field.syncBatch(w.a.tech, [{ client_uuid: x.client_uuid, server_id: x.id, base_version: 1, payload: { ...x.payload, notes: 'Edited offline during suspension' } }]);
  await resumeWorkflows(URL_(), w.A.tenant.id, ['field_sync'], 'TR-08 Operator', 'T8-REVAL');
  const { revId } = await withPendingRemoval(S, keep.id, x.id, 'TR-08 held');
  const calc = (await asmt.calculate(w.a.prac, revId)).calc_output;
  const inCalculation = calc.samples.some((s: any) => s.sampleCode === x.code);
  const submit = await attempt(() => asmt.submitForReview(w.a.prac, revId));
  const approve = submit === 'succeeded' ? await attempt(() => asmt.approve(w.a.rev, revId, approveIn)) : 'not reached';
  return { scenario: 'held record on a sample whose removal awaits confirmation', inCalculation, submit, approve };
}

export async function suspensionReview(S: any) {
  const { w } = S;
  const keep = await sample(S, { day: 3 }), x = await sample(S, { day: 4 });
  const c = await admin();
  await c.query('update sampling_events set suspension_review_required=true where id=$1', [x.id]); // as the server sets it when a held record arrives
  await c.end();
  const { revId } = await withPendingRemoval(S, keep.id, x.id, 'TR-08 suspension review');
  const calc = (await asmt.calculate(w.a.prac, revId)).calc_output;
  const inCalculation = calc.samples.some((s: any) => s.sampleCode === x.code);
  const submit = await attempt(() => asmt.submitForReview(w.a.prac, revId));
  const approve = submit === 'succeeded' ? await attempt(() => asmt.approve(w.a.rev, revId, approveIn)) : 'not reached';
  return { scenario: 'suspension-review flag on a sample whose removal awaits confirmation', inCalculation, submit, approve };
}

export async function reviewerQcDisposition(S: any) {
  const { w } = S;
  const keep = await sample(S, { day: 5 }), x = await sample(S, { day: 6, qcFail: true });
  const qc = (await field.sampleDetail(w.a.prac, x.id)).qc.find((q: any) => q.outcome === 'fail');
  const disp = await attempt(() => field.disposeQcFailure(w.a.rev, qc.id, { disposition: 'accepted_with_justification', reason: 'Reviewer accepts: flow check within tolerance on re-test' }));
  const { revId } = await withPendingRemoval(S, keep.id, x.id, 'TR-08 QC disposition');
  const calc = (await asmt.calculate(w.a.prac, revId)).calc_output;
  const inCalculation = calc.samples.some((s: any) => s.sampleCode === x.code);
  const submit = await attempt(() => asmt.submitForReview(w.a.prac, revId));
  const approve = submit === 'succeeded' ? await attempt(() => asmt.approve(w.a.rev, revId, approveIn)) : 'not reached';
  return { scenario: 'approver recorded a QC disposition for a sample whose removal awaits confirmation', qcDispositionByApprover: disp, inCalculation, submit, approve };
}

/**
 * Concurrency: an approval is paused after its evidence check (at the point where it supersedes the previously approved
 * revision, whose row the test holds), then another writer changes evidence of the pending-removal sample. Returns whether
 * that writer was blocked by the approval's locks, the sequence, and the final state.
 */
async function concurrent(S: any, kind: 'amendment' | 'calibration') {
  const { w } = S;
  const keep = await sample(S, { day: kind === 'amendment' ? 7 : 9 }), x = await sample(S, { day: kind === 'amendment' ? 8 : 10, pump: S.pump2 });
  // r1: approved with [keep, x]; r2: new revision where x's removal awaits confirmation.
  const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title: `TR-08 concurrent ${kind}`, assessment_question: 'Is exposure adequately controlled for the TR-08 group?' });
  const { updateDraftConfirmed } = await import('./fixtures.js');
  await updateDraftConfirmed(w.a.prac, revision.id, { ...draftBase(S), sample_ids: [keep.id, x.id] });
  await asmt.calculate(w.a.prac, revision.id); await asmt.submitForReview(w.a.prac, revision.id); await asmt.approve(w.a.rev, revision.id, approveIn);
  const r2 = await asmt.newRevision(w.a.prac, assessment.id, { change_reason: 'TR-08 concurrency scenario' });
  await asmt.updateDraft(w.a.prac, r2.id, { ...draftBase(S), sample_ids: [keep.id], removal_reason: 'Practitioner removes this sample (TR-08 scenario)' });
  const calc = (await asmt.calculate(w.a.prac, r2.id)).calc_output;
  const inCalculation = calc.samples.some((s: any) => s.sampleCode === x.code);
  await asmt.submitForReview(w.a.prac, r2.id);

  const seq: string[] = [];
  const ctl = await admin(), obs = await admin();
  await ctl.query('begin');
  await ctl.query('select id from assessment_revisions where id=$1 for update', [revision.id]); // the row approve() will supersede
  seq.push('controller holds the previously approved revision row');
  let approved: string | null = null;
  const appr = attempt(() => asmt.approve(w.a.rev, r2.id, approveIn)).then((x) => { approved = x; seq.push(`approval finished: ${x.slice(0, 80)}`); });
  await waitFor(async () => (await lockWaiters(obs)).some((b) => /superseded/.test(b.query)), 'approval paused after its evidence check');
  seq.push('approval paused after its evidence check (waiting to supersede r1)');
  let written: string | null = null;
  const writer = (kind === 'amendment'
    ? attempt(() => lab.recordResult(w.a.prac, { sampling_event_id: x.id, substance_id: w.ref.substanceId, value: '900', unit: 'ug', qualifier: '=', lod: '1', loq: '3', amendment_reason: 'Laboratory re-issue (TR-08 concurrency scenario)' }))
    : attempt(() => inst.recordCalibration(w.a.prac, S.pump2.id, { performed_at: '2026-04-11', valid_until: '2026-04-30', outcome: 'fail' }))
  ).then((x) => { written = x; seq.push(`${kind} finished: ${x.slice(0, 80)}`); });
  seq.push(`${kind} started`);
  // Either the writer completes while the approval is still paused, or it is observed waiting for a lock.
  await waitFor(async () => written !== null || (await lockWaiters(obs)).some((b) => kind === 'amendment' ? /lab_result|sampling_events/.test(b.query) : /instruments/.test(b.query)), `${kind} completed or waiting`);
  const blockedByApproval = written === null;
  seq.push(blockedByApproval ? `${kind} is waiting for a lock held by the approval` : `${kind} committed while the approval was paused`);
  await ctl.query('commit'); seq.push('controller released the row');
  await appr; await writer;
  const st = (await obs.query('select status, inputs_hash from assessment_revisions where id=$1', [r2.id])).rows[0];
  await ctl.end(); await obs.end();
  // Did the approved revision rely on evidence that changed during its own transaction?
  const evidenceChangedBeforeApprovalCommitted = !blockedByApproval && approved === 'succeeded';
  return { scenario: `${kind} of a pending-removal sample's evidence concurrent with approval`, inCalculation, blockedByApproval, approval: approved, write: written, finalStatus: st.status, evidenceChangedBeforeApprovalCommitted, sequence: seq };
}
export const concurrentAmendment = (S: any) => concurrent(S, 'amendment');
export const concurrentCalibration = (S: any) => concurrent(S, 'calibration');
