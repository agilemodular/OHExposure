// Seeds a clearly-labelled DEMONSTRATION tenant with synthetic records, using the real service layer
// so every record passes the same validation and audit trail as production data.
// Nothing here is a real measurement or a real exposure limit.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createTenant, createUserDirect, loadSyntheticReference } from './bootstrap.js';
import { actorFrom, closePool } from '../src/db.js';
import * as reg from '../src/services/register.js';
import * as inst from '../src/services/instruments.js';
import * as plans from '../src/services/plans.js';
import * as field from '../src/services/field.js';
import * as lab from '../src/services/lab.js';
import * as asmt from '../src/services/assessments.js';
import * as ctl from '../src/services/controls.js';
import * as rep from '../src/services/reports.js';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres_dev@localhost:5432/ohea';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-2026';

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
if ((await admin.query(`select 1 from tenants where name='Demo Hygiene Consultancy (synthetic)'`)).rowCount) {
  console.log('Demo tenant already exists'); process.exit(0);
}
let ref = (await admin.query(`select s.id sub, bv.id bv, mv.id mv from substances s join benchmarks b on b.substance_id=s.id join benchmark_versions bv on bv.benchmark_id=b.id, sampling_method_versions mv where s.is_synthetic and bv.is_synthetic and s.tenant_id is null limit 1`)).rows[0];
const R = ref ? { substanceId: ref.sub, benchmarkVersionId: ref.bv, methodVersionId: ref.mv } : await loadSyntheticReference(admin);
const T = await createTenant(admin, { name: 'Demo Hygiene Consultancy (synthetic)', kind: 'consultancy', isDemo: true, mfaRequired: false, clients: ['Northfield Fabrication (demo)', 'Harbour Joinery (demo)'] });
const mk = async (role: string, email: string, name: string, clientId?: string) =>
  actorFrom(await createUserDirect(admin, { tenantId: T.tenant.id, email, name, role, password: PASSWORD, clientId }));
const A = {
  admin: await mk('org_admin', 'admin@demo.test', 'Dana Admin'),
  prac: await mk('practitioner', 'practitioner@demo.test', 'Priya Practitioner'),
  tech: await mk('field_technician', 'technician@demo.test', 'Tom Technician'),
  rev: await mk('technical_reviewer', 'reviewer@demo.test', 'Rhys Reviewer'),
  owner: await mk('action_owner', 'sitemanager@demo.test', 'Sam Site-Manager'),
  client: await mk('client_readonly', 'client@demo.test', 'Chris Client', T.clients['Northfield Fabrication (demo)']),
};
await admin.end();
const C1 = T.clients['Northfield Fabrication (demo)'];

const site = await reg.createSite(A.prac, { client_id: C1, name: 'Northfield works', reference: 'NF-01', address: 'Synthetic address' });
const area = await reg.createWorkArea(A.prac, { site_id: site.id, name: 'Fabrication bay 2' });
const proc = await reg.createProcess(A.prac, { work_area_id: area.id, name: 'Weld finishing' });
const task = await reg.createTask(A.prac, { process_id: proc.id, name: 'Disc grinding of weld seams', frequency: 'Daily', duration_min_per_shift: '360', duration_basis: 'recorded_fact' });
const hazard = await reg.createHazard(A.prac, { task_id: task.id, substance_id: R.substanceId, physical_form: 'dust', exposure_routes: ['inhalation'], exposure_frequency: 'Daily', exposure_duration_min: '360', exposure_basis: 'recorded_fact', existing_controls: 'Extracted bench (partial), FFP3 masks', assessment_owner_id: A.prac.userId, review_due: '2027-03-31' });
const group = await reg.createGroup(A.prac, { site_id: site.id, name: 'Bay 2 grinders', rationale: 'Same grinding task with the same tools, material and bench layout; same shift pattern and controls.', task_ids: [task.id], hazard_ids: [hazard.id] });
const workers = [];
for (const [i, n] of ['Alex Demo', 'Bea Demo', 'Cal Demo'].entries()) {
  const w = await reg.createWorker(A.prac, { client_id: C1, ref_code: `NF-W0${i + 1}`, full_name: n });
  await reg.addMembership(A.prac, { group_id: group.id, worker_id: w.id, valid_from: '2026-01-05' });
  workers.push(w);
}
const pump1 = await inst.createInstrument(A.prac, { asset_tag: 'PUMP-07', instrument_type: 'sampling_pump', make: 'Demo', model: 'Pump P1', serial_number: 'SYN-0007' });
await inst.recordCalibration(A.prac, pump1.id, { performed_at: '2026-01-10', valid_until: '2027-01-09', outcome: 'pass', provider: 'Synthetic cal lab', certificate_ref: 'CAL-SYN-7' });
const pump2 = await inst.createInstrument(A.prac, { asset_tag: 'PUMP-11', instrument_type: 'sampling_pump', make: 'Demo', model: 'Pump P1', serial_number: 'SYN-0011' });
await inst.recordCalibration(A.prac, pump2.id, { performed_at: '2025-01-10', valid_until: '2026-01-09', outcome: 'pass', provider: 'Synthetic cal lab' });
await inst.createInstrument(A.prac, { asset_tag: 'DRM-02', instrument_type: 'direct_reading_monitor', make: 'Demo', model: 'Photometer', screening_only: 'on', measures: 'Light-scattering dust estimate (screening)' });
const labo = await inst.createLaboratory(A.prac, { name: 'Synthetic Analytical Laboratory', accreditation_ref: 'DEMO-ACC-0000' });

const plan = await plans.createPlan(A.prac, { site_id: site.id, title: 'Bay 2 grinding dust — baseline', purpose: 'Characterise grinder exposure before the planned downdraught bench upgrade.', assessment_question: 'What are 8-hour TWA exposures for Bay 2 grinders under current controls?', approach: 'personal', strategy_rationale: 'Full-shift personal sampling of all three grinders on two representative production days.', intended_duration_min: '360', planned_start: '2026-03-02', planned_end: '2026-03-03', instrument_ids: [pump1.id, pump2.id] });
await plans.addTarget(A.prac, plan.id, { group_id: group.id, substance_id: R.substanceId, method_version_id: R.methodVersionId, planned_samples: '6' });
await plans.transitionPlan(A.rev, plan.id, { to: 'reviewed' });
await plans.transitionPlan(A.prac, plan.id, { to: 'scheduled' });
await plans.transitionPlan(A.tech, plan.id, { to: 'in_progress' });

const samples: { code: string; id: string }[] = [];
const spec = [
  { w: 0, day: '02', pump: pump1, mass: 210, post: 2.0 }, { w: 1, day: '02', pump: pump1, mass: 160, post: 1.98 },
  { w: 2, day: '02', pump: pump2, mass: null, post: 2.0 }, { w: 0, day: '03', pump: pump1, mass: 330, post: 2.02 },
];
for (const [i, s] of spec.entries()) {
  const code = `NF-26-${String(i + 1).padStart(3, '0')}`;
  const [r] = await field.syncBatch(A.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: {
    plan_id: plan.id, sample_code: code, sample_type: 'personal', worker_id: workers[s.w].id, substance_id: R.substanceId, method_version_id: R.methodVersionId, instrument_id: s.pump.id,
    timezone: 'Europe/London', start_local: `2026-03-${s.day}T07:30`, end_local: `2026-03-${s.day}T13:30`, flow_pre_lpm: 2.0, flow_post_lpm: s.post,
    tasks_performed: 'Disc grinding of weld seams', control_status: 'Bench extraction running', operating_conditions: 'Normal production', handover_to: 'Office sample store' } }]);
  samples.push({ code, id: r.server_id! });
}
await field.addQcCheck(A.tech, samples[1].id, { check_type: 'Post-sampling flow check', outcome: 'pass' });
await lab.createSubmission(A.prac, { laboratory_id: labo.id, reference: 'SUB-NF-001', sample_ids: samples.map((s) => s.id), dispatched_at: '2026-03-04T09:00', courier_ref: 'SYN-COURIER-1' });
const subs = await lab.listSubmissions(A.prac);
await lab.receiveSubmission(A.prac, subs[0].id, { received_at: '2026-03-05T11:00', received_condition: 'Intact, seals unbroken' });
const csv = ['sample_code,analyte,value,unit,qualifier,lod,loq,lab_report_ref',
  ...spec.map((s, i) => `${samples[i].code},Demo Dust X (synthetic),${s.mass ?? ''},ug,${s.mass == null ? '<LOD' : '='},20,60,SYN-LR-001`)].join('\n');
const batch = await lab.stageImport(A.prac, { filename: 'synthetic-results.csv', csv, laboratory_id: labo.id });
await lab.commitImport(A.prac, batch.id);

const { assessment, revision } = await asmt.createAssessment(A.prac, { group_id: group.id, substance_id: R.substanceId, plan_id: plan.id, title: 'Bay 2 grinders — Demo Dust X baseline', assessment_question: 'Is exposure of Bay 2 grinders to Demo Dust X adequately controlled under current controls?' });
await asmt.updateDraft(A.prac, revision.id, { sample_ids: samples.map((s) => s.id), benchmark_version_id: R.benchmarkVersionId, exposure_minutes_per_shift: '360', unsampled_assumption: 'none',
  interpretation: 'Four personal samples were taken: all three grinders on 2 March and one grinder (NF-W01) again on 3 March. The highest 8-hour TWA is about 68% of the synthetic benchmark (NF-W01, 3 March). NF-26-003 (NF-W03) was a non-detect collected with a pump whose calibration had expired; it is indicative only, so that worker is not assessed. The bench extraction was found defective on 3 March. Improvement is required: upgrade the extraction, then re-sample all grinders.',
  conclusion_category: 'improvement_required', limitations: 'Four worker-days over two dates; NF-W03 not assessed (expired calibration); synthetic benchmark used for demonstration.' });
// NF-26-003 cannot be formal evidence (expired calibration); record why and what it leaves unassessed (engine 1.4.0, TR-02).
await asmt.recordEvidenceDisposition(A.prac, revision.id, { sample_id: samples[2].id, kind: 'not_replaced', reason: 'Pump PUMP-11 calibration had expired on the sampling date; the result is indicative only.', consequence: 'Worker NF-W03 has no formal result for this baseline; to be re-sampled after the extraction upgrade.' });
await asmt.calculate(A.prac, revision.id);

const lev = await ctl.createControl(A.prac, { site_id: site.id, name: 'Bay 2 downdraught bench', kind: 'local_exhaust_ventilation', purpose: 'Capture grinding dust at source', group_id: group.id, owner_user_id: A.owner.userId, performance_criteria: 'Downdraught face velocity at least 1.0 m/s across the bench (demonstration criterion)', status: 'in_service' });
await ctl.recordInspection(A.tech, lev.id, { at: '2026-03-03', kind: 'routine_inspection', outcome: 'defect_found', notes: 'Filter differential pressure high; airflow visibly reduced' });
await ctl.createAction(A.prac, { title: 'Upgrade bench extraction and re-sample', source_type: 'assessment', source_id: assessment.id, control_id: lev.id, owner_user_id: A.owner.userId, priority: 'high', due_date: '2026-05-29',
  verification_requirement: 'Commissioning test of face velocity, then post-upgrade personal sampling of all grinders', requires_exposure_reassessment: 'on' });

await asmt.submitForReview(A.prac, revision.id);
await asmt.approve(A.rev, revision.id, { approval_scope: 'Bay 2 grinders at Northfield works, March 2026 baseline', approval_limitations: 'Small data set; demonstration benchmark; NF-W03 not assessed (NF-26-003 indicative only)', confirm_reviewed: 'on' });
await rep.generateReport(A.rev, assessment.id, revision.id);

await reg.reviewGroup(A.rev, group.id, { outcome: 'group_still_valid', notes: 'Control change noted; grouping basis unchanged pending upgrade.' });

console.log(`Demo tenant created. Users (password: ${PASSWORD}):`);
for (const [k, v] of Object.entries(A)) console.log(`  ${k.padEnd(7)} ${v.email}`);
await closePool();
