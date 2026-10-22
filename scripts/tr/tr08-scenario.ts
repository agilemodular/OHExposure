// Synthetic historical scenario for the TR-08 impact check. Run with the code of the reviewed commit (b5eb070) on a
// disposable database migrated to 029; it records approvals that the pre-TR-08 safeguards allowed:
//   A — a sample with a held field record, removal requested but not confirmed, approved;
//   B — the approving reviewer had recorded a QC disposition for a sample whose removal was not confirmed; approved and reported;
//   C — a sample whose removal was not confirmed, no other concern; approved (potentially affected, nothing found);
//   D — a suspension-review flag set without a recorded time, cleared after approval (sequence cannot be established).
// Then (current code) migration 030 is applied and scripts/tr/tr08-impact.ts is run read-only.
// SYNTHETIC DATA ONLY. Used by scripts/tr/run-tr08-scenario.sh.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTenant, createUserDirect, loadSyntheticReference } from '../bootstrap.js';
import { actorFrom, closePool } from '../../src/db.js';
import * as reg from '../../src/services/register.js';
import * as inst from '../../src/services/instruments.js';
import * as plans from '../../src/services/plans.js';
import * as field from '../../src/services/field.js';
import * as lab from '../../src/services/lab.js';
import * as asmt from '../../src/services/assessments.js';
import * as rep from '../../src/services/reports.js';
import { resumeWorkflows, suspendWorkflows } from '../platform-controls.js';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL!;
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
const ref = (await admin.query(`select s.id sub, bv.id bv from substances s join benchmarks b on b.substance_id=s.id join benchmark_versions bv on bv.benchmark_id=b.id where s.is_synthetic and bv.is_synthetic and s.tenant_id is null limit 1`)).rows[0]
  ?? await loadSyntheticReference(admin).then((r) => ({ sub: r.substanceId, bv: r.benchmarkVersionId }));
const T = await createTenant(admin, { name: 'TR-08 Scenario Consultancy (synthetic)', kind: 'consultancy', isDemo: true, mfaRequired: false, clients: ['TR-08 Works Ltd (demo)'] });
const mk = async (role: string, name: string) => actorFrom(await createUserDirect(admin, { tenantId: T.tenant.id, email: `${role}@tr08.test`, name, role, password: 'scenario-password-2026' }));
const A = { prac: await mk('practitioner', 'Pat Practitioner'), tech: await mk('field_technician', 'Terry Technician'), rev: await mk('technical_reviewer', 'Robin Reviewer') };
const C1 = T.clients['TR-08 Works Ltd (demo)'];
const site = await reg.createSite(A.prac, { client_id: C1, name: 'TR-08 works', reference: 'T8-WORKS' });
const area = await reg.createWorkArea(A.prac, { site_id: site.id, name: 'Bay' });
const proc = await reg.createProcess(A.prac, { work_area_id: area.id, name: 'Process' });
const task = await reg.createTask(A.prac, { process_id: proc.id, name: 'Main task', duration_min_per_shift: '480', duration_basis: 'recorded_fact' });
const hz = await reg.createHazard(A.prac, { task_id: task.id, substance_id: ref.sub, physical_form: 'dust', exposure_routes: ['inhalation'] });
const group = await reg.createGroup(A.prac, { site_id: site.id, name: 'Operators', rationale: 'Same task, same tools and the same shift pattern.', task_ids: [task.id], hazard_ids: [hz.id] });
const worker = await reg.createWorker(A.prac, { client_id: C1, ref_code: 'T8-W1', full_name: 'Synthetic Worker' });
await reg.addMembership(A.prac, { group_id: group.id, worker_id: worker.id, valid_from: '2026-01-01' });
const pump = await inst.createInstrument(A.prac, { asset_tag: 'T8-PUMP', instrument_type: 'sampling_pump' });
await inst.recordCalibration(A.prac, pump.id, { performed_at: '2026-01-01', valid_until: '2027-12-31', outcome: 'pass' });
const method = await inst.createMethodVersion(A.prac, { code: 'T8-GRAV', title: 'Synthetic gravimetric', source_reference: 'Synthetic scenario', version: '1', flow_drift_tolerance_pct: '5', result_basis: 'mass_on_sample', suitable_for_formal_assessment: 'on', flow_drift_consequence: 'disposition_required' });
const plan = await plans.createPlan(A.prac, { site_id: site.id, title: 'TR-08 plan', purpose: 'Synthetic TR-08 scenario', assessment_question: 'What is the 8-hour TWA?', approach: 'personal', strategy_rationale: 'Full-shift personal samples.', instrument_ids: [pump.id] });
await plans.addTarget(A.prac, plan.id, { group_id: group.id, substance_id: ref.sub, method_version_id: method.id, planned_samples: '8' });
await plans.transitionPlan(A.rev, plan.id, { to: 'reviewed' });
await plans.transitionPlan(A.prac, plan.id, { to: 'scheduled' });
await plans.transitionPlan(A.tech, plan.id, { to: 'in_progress' });
const labo = await inst.createLaboratory(A.prac, { name: 'Synthetic laboratory' });
let n = 0;
const sample = async (day: number, qcFail = false) => {
  const code = `T8-S${++n}`; const client_uuid = randomUUID();
  const payload = { plan_id: plan.id, sample_code: code, sample_type: 'personal', worker_id: worker.id, substance_id: ref.sub, method_version_id: method.id, instrument_id: pump.id,
    timezone: 'UTC', start_local: `2026-05-${String(day).padStart(2, '0')}T08:00`, end_local: `2026-05-${String(day).padStart(2, '0')}T16:00`, flow_pre_lpm: 2, flow_post_lpm: 2, tasks_performed: 'Main task' };
  const [r] = await field.syncBatch(A.tech, [{ client_uuid, server_id: null, base_version: null, payload }]);
  if (qcFail) await field.addQcCheck(A.tech, r.server_id!, { check_type: 'flow_check', outcome: 'fail', detail: 'Pump fault at collection' });
  await lab.createSubmission(A.prac, { laboratory_id: labo.id, reference: `SUB-${code}`, sample_ids: [r.server_id], dispatched_at: '2026-05-28T09:00' });
  await lab.recordResult(A.prac, { sampling_event_id: r.server_id, substance_id: ref.sub, value: '300', unit: 'ug', qualifier: '=', lod: '1', loq: '3' });
  return { id: r.server_id!, code, client_uuid, payload };
};
const base = { benchmark_version_id: ref.bv, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
  interpretation: 'Synthetic TR-08 scenario; full-shift results below the synthetic benchmark.', conclusion_category: 'insufficient_evidence', limitations: 'Synthetic scenario data only.' };
const approveIn = { approval_scope: 'Synthetic scenario only', approval_limitations: 'Synthetic data; historical record for the TR-08 impact check', confirm_reviewed: 'on' };
async function caseOf(title: string, keep: any, x: any, before?: () => Promise<void>) {
  const { assessment, revision } = await asmt.createAssessment(A.prac, { group_id: group.id, substance_id: ref.sub, plan_id: plan.id, title, assessment_question: 'Is exposure adequately controlled for the operators?' });
  const others = revision.sample_ids.filter((s: string) => s !== keep.id && s !== x.id);
  if (others.length) { // narrow the creation pool to the two samples of the case through the confirmed route
    await asmt.updateDraft(A.prac, revision.id, { ...base, sample_ids: [keep.id, x.id], removal_reason: 'Not part of this case (scenario set-up)' });
    for (const o of others) await asmt.confirmSampleRemoval(A.rev, revision.id, { sample_id: o, reason: 'Outside this case (scenario set-up)' });
  }
  await asmt.updateDraft(A.prac, revision.id, { ...base, sample_ids: [keep.id], removal_reason: `Practitioner removes ${x.code}; not confirmed by a reviewer` });
  if (before) await before();
  await asmt.calculate(A.prac, revision.id); await asmt.submitForReview(A.prac, revision.id); await asmt.approve(A.rev, revision.id, approveIn);
  const report = await rep.generateReport(A.rev, assessment.id, revision.id);
  console.log(`legacy: ${title} approved; report ${report.status}`);
}
// A — held field record on the sample whose removal awaits confirmation.
const a1 = await sample(1), a2 = await sample(2);
await caseOf('Case A — held record', a1, a2, async () => {
  await suspendWorkflows(ADMIN_URL, T.tenant.id, ['field_sync'], 'Scenario suspension', 'Scenario Operator');
  await field.syncBatch(A.tech, [{ client_uuid: a2.client_uuid, server_id: a2.id, base_version: 1, payload: { ...a2.payload, notes: 'Edited offline during suspension' } }]);
  await resumeWorkflows(ADMIN_URL, T.tenant.id, ['field_sync'], 'Scenario Operator', 'SCN-REVAL');
});
// B — the approving reviewer recorded a QC disposition for that sample.
const b1 = await sample(3), b2 = await sample(4, true);
const qc = (await field.sampleDetail(A.prac, b2.id)).qc.find((q: any) => q.outcome === 'fail');
await field.disposeQcFailure(A.rev, qc.id, { disposition: 'accepted_with_justification', reason: 'Reviewer accepts: flow check within tolerance on re-test' });
await caseOf('Case B — reviewer QC disposition', b1, b2);
// C — pending removal, nothing else.
const c1 = await sample(5), c2 = await sample(6);
await caseOf('Case C — pending removal only', c1, c2);
// D — suspension-review flag set outside the hold workflow (time not recorded) and cleared after approval.
const d1 = await sample(7), d2 = await sample(8);
await caseOf('Case D — flag cleared after approval', d1, d2, async () => { await admin.query('update sampling_events set suspension_review_required=true where id=$1', [d2.id]); });
await field.clearSuspensionReview(A.prac, d2.id, { notes: 'Reviewed after the approval (scenario)' });
await admin.end();
await closePool();
