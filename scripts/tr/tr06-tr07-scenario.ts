// Synthetic historical scenario for TR-06 / TR-07, run in two phases against one disposable database.
//   phase "legacy"  — run with the 1.4.0 code (git worktree at the reviewed commit) on a database migrated to 027:
//                     records, through the 1.4.0 services, a "duplicate" disposition across different sampling windows
//                     and a detected-below-LOQ result of 600 µg (LOD 10, LOQ 30); calculates, approves and issues a report.
//   phase "current" — run with the current code after migration 028: keeps the approved revision and issued report
//                     unchanged, creates a new revision with a reason, recalculates with engine 1.5.0 and generates the
//                     draft report showing the unresolved contradictory evidence and the rejected duplicate treatment.
// SYNTHETIC DATA ONLY. Used by scripts/tr/run-tr06-tr07-scenario.sh.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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

const ADMIN_URL = process.env.DATABASE_ADMIN_URL!;
const phase = process.argv[2];
const ORG = 'TR-06/TR-07 Scenario Consultancy (synthetic)';
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
const users = async () => Object.fromEntries((await admin.query(`select u.* from users u join tenants t on t.id=u.tenant_id where t.name=$1`, [ORG])).rows.map((u) => [u.role, actorFrom(u)]));

if (phase === 'legacy') {
  let ref = (await admin.query(`select s.id sub from substances s where s.is_synthetic and s.tenant_id is null limit 1`)).rows[0];
  const sub = ref ? ref.sub : (await loadSyntheticReference(admin)).substanceId;
  const T = await createTenant(admin, { name: ORG, kind: 'consultancy', isDemo: true, mfaRequired: false, clients: ['Synthetic Works Ltd (demo)'] });
  const mk = async (role: string, name: string) => actorFrom(await createUserDirect(admin, { tenantId: T.tenant.id, email: `${role}@tr0607.test`, name, role, password: 'scenario-password-2026' }));
  const A = { prac: await mk('practitioner', 'Pat Practitioner'), tech: await mk('field_technician', 'Terry Technician'), rev: await mk('technical_reviewer', 'Robin Reviewer') };
  const C1 = T.clients['Synthetic Works Ltd (demo)'];
  const site = await reg.createSite(A.prac, { client_id: C1, name: 'Synthetic works', reference: 'SYN-WORKS' });
  const area = await reg.createWorkArea(A.prac, { site_id: site.id, name: 'Mixing room' });
  const proc = await reg.createProcess(A.prac, { work_area_id: area.id, name: 'Powder charging' });
  const task = await reg.createTask(A.prac, { process_id: proc.id, name: 'Charging the mixer', duration_min_per_shift: '60', duration_basis: 'recorded_fact' });
  const hz = await reg.createHazard(A.prac, { task_id: task.id, substance_id: sub, physical_form: 'dust', exposure_routes: ['inhalation'] });
  const group = await reg.createGroup(A.prac, { site_id: site.id, name: 'Mixer operators', rationale: 'Same charging task, same equipment and the same shift pattern.', task_ids: [task.id], hazard_ids: [hz.id] });
  const w1 = await reg.createWorker(A.prac, { client_id: C1, ref_code: 'SYN-W1', full_name: 'Synthetic Worker One' });
  const w2 = await reg.createWorker(A.prac, { client_id: C1, ref_code: 'SYN-W2', full_name: 'Synthetic Worker Two' });
  for (const w of [w1, w2]) await reg.addMembership(A.prac, { group_id: group.id, worker_id: w.id, valid_from: '2026-01-01' });
  const pump = await inst.createInstrument(A.prac, { asset_tag: 'SYN-PUMP-1', instrument_type: 'sampling_pump' });
  await inst.recordCalibration(A.prac, pump.id, { performed_at: '2026-01-01', valid_until: '2027-12-31', outcome: 'pass' });
  const method = await inst.createMethodVersion(A.prac, { code: 'SYN-GRAV', title: 'Synthetic gravimetric method', source_reference: 'Synthetic scenario', version: '1', flow_drift_tolerance_pct: '5', result_basis: 'mass_on_sample', suitable_for_formal_assessment: 'on', flow_drift_consequence: 'disposition_required' });
  const plan = await plans.createPlan(A.prac, { site_id: site.id, title: 'Short-term charging exposure', purpose: 'Synthetic scenario for TR-06 and TR-07', assessment_question: 'Is short-term exposure during charging adequately controlled?', approach: 'personal', strategy_rationale: '15-minute personal samples during charging.', instrument_ids: [pump.id] });
  await plans.addTarget(A.prac, plan.id, { group_id: group.id, substance_id: sub, method_version_id: method.id, planned_samples: '3' });
  await plans.transitionPlan(A.rev, plan.id, { to: 'reviewed' });
  await plans.transitionPlan(A.prac, plan.id, { to: 'scheduled' });
  await plans.transitionPlan(A.tech, plan.id, { to: 'in_progress' });
  const cap = async (code: string, worker: any, start: string, end: string, flow: number) => (await field.syncBatch(A.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: {
    plan_id: plan.id, sample_code: code, sample_type: 'personal', worker_id: worker.id, substance_id: sub, method_version_id: method.id, instrument_id: pump.id,
    timezone: 'UTC', start_local: start, end_local: end, flow_pre_lpm: flow, flow_post_lpm: flow, shift_ref: 'DAY-2026-03-02', tasks_performed: 'Charging the mixer' } }]))[0].server_id!;
  const am = await cap('SYN-AM', w1, '2026-03-02T08:00', '2026-03-02T08:15', 2);   // 3 µg / 30 L  = 0.1 mg/m³
  const pm = await cap('SYN-PM', w1, '2026-03-02T15:00', '2026-03-02T15:15', 2);   // 60 µg / 30 L = 2 mg/m³ (failed QC)
  const db = await cap('SYN-DBL', w2, '2026-03-02T09:00', '2026-03-02T09:15', 4);  // detected < LOQ, value 600 µg, 60 L
  await field.addQcCheck(A.tech, pm, { check_type: 'flow_check', outcome: 'fail', detail: 'Pump stopped and restarted during sampling' });
  const labo = await inst.createLaboratory(A.prac, { name: 'Synthetic Analytical Laboratory' });
  await lab.createSubmission(A.prac, { laboratory_id: labo.id, reference: 'SYN-SUB-1', sample_ids: [am, pm, db], dispatched_at: '2026-03-03T09:00' });
  await lab.receiveSubmission(A.prac, (await lab.listSubmissions(A.prac))[0].id, { received_at: '2026-03-04T10:00', received_condition: 'Intact' });
  const csv = 'sample_code,analyte,value,unit,qualifier,lod,loq,lab_report_ref\nSYN-AM,Demo Dust X (synthetic),3,ug,=,1,3,SYN-LR-1\nSYN-PM,Demo Dust X (synthetic),60,ug,=,1,3,SYN-LR-1\nSYN-DBL,Demo Dust X (synthetic),600,ug,DET<LOQ,10,30,SYN-LR-1\n';
  const batch = await lab.stageImport(A.prac, { filename: 'synthetic-results.csv', csv, laboratory_id: labo.id });
  if (batch.status !== 'validated') throw new Error(`legacy import ${batch.status}`);
  await lab.commitImport(A.prac, batch.id);
  const b = await asmt.createBenchmarkVersion(A.prac, { substance_id: sub, jurisdiction: 'ORG', benchmark_type: 'SYN-STEL', averaging_minutes: '15', value: '1', unit: 'mg/m3', source_title: 'Synthetic 15-minute benchmark (demonstration only)', source_version: '1', effective_from: '2020-01-01' });
  await asmt.verifyBenchmarkVersion(A.rev, b.id, { status: 'verified', note: 'Synthetic demonstration benchmark checked against the scenario.' });
  const { assessment, revision } = await asmt.createAssessment(A.prac, { group_id: group.id, substance_id: sub, plan_id: plan.id, title: 'Mixer charging — short-term exposure (synthetic)', assessment_question: 'Is short-term exposure during charging adequately controlled?' });
  await asmt.updateDraft(A.prac, revision.id, { calc_code: 'stel_15', sample_ids: [am, pm, db], benchmark_version_id: b.id,
    interpretation: 'Synthetic scenario. Short-term results for both operators were below the synthetic benchmark.', conclusion_category: 'exposure_adequately_controlled', limitations: 'Synthetic scenario data only.' });
  await asmt.recordEvidenceDisposition(A.prac, revision.id, { sample_id: pm, kind: 'duplicate', related_sample_id: am, reason: 'Recorded as a duplicate of the morning sample', consequence: 'The morning sample represents this worker and shift' });
  const calc = await asmt.calculate(A.prac, revision.id);
  console.log(`legacy: ${calc.calc_output.engineVersion} ${calc.calc_code} ${calc.calc_version} → ${calc.benchmark_state} / ${calc.calc_output.evidenceAdequacy}`);
  await asmt.submitForReview(A.prac, revision.id);
  await asmt.approve(A.rev, revision.id, { approval_scope: 'Synthetic scenario only', approval_limitations: 'Synthetic data; demonstration of a historical record', confirm_reviewed: 'on' });
  const report = await rep.generateReport(A.rev, assessment.id, revision.id);
  console.log(`legacy: approved revision ${revision.id}; report ${report.id} (${report.status})`);
} else if (phase === 'current') {
  const A = await users();
  const r = (await admin.query(`select r.*, a.id aid from assessment_revisions r join assessments a on a.id=r.assessment_id join tenants t on t.id=r.tenant_id where t.name=$1 and r.status='approved'`, [ORG])).rows[0];
  const before = (await admin.query(`select md5(r::text) h from assessment_revisions r where id=$1`, [r.id])).rows[0].h;
  const reportsBefore = (await admin.query(`select md5(string_agg(p::text, '' order by p.id)) h from reports p where assessment_revision_id=$1`, [r.id])).rows[0].h;
  const n = await asmt.newRevision(A.practitioner, r.aid, { change_reason: 'Reassessment after engine 1.5.0 (TR-06 duplicate relationship rules; TR-07 contradictory detected-below-LOQ inputs)' });
  // The 1.4.0 duplicate disposition belongs to the approved revision; the new revision starts without dispositions.
  // Record the same claim again to show how 1.5.0 treats it: refused by the service with its reason.
  const ids = (await admin.query(`select id, sample_code from sampling_events where sample_code in ('SYN-AM','SYN-PM','SYN-DBL')`)).rows;
  const id = (c: string) => ids.find((x) => x.sample_code === c).id;
  const attempts: string[] = [];
  for (const t of [undefined, 'same_event_record', 'paired_colocated'])
    try { await asmt.recordEvidenceDisposition(A.practitioner, n.id, { sample_id: id('SYN-PM'), kind: 'duplicate', related_sample_id: id('SYN-AM'), duplicate_type: t, reason: 'Recorded as a duplicate of the morning sample', consequence: 'The morning sample represents this worker and shift' }); attempts.push(`${t ?? 'no category'}: ACCEPTED`); }
    catch (e: any) { attempts.push(`${t ?? 'no category'}: refused — ${e.message}`); }
  try { await asmt.recordEvidenceDisposition(A.practitioner, n.id, { sample_id: id('SYN-DBL'), kind: 'not_replaced', reason: 'Laboratory result contradicts its qualifier; clarification requested from the laboratory.', consequence: 'Worker SYN-W2 has no formal short-term result until the laboratory clarifies the result.' }); attempts.push('SYN-DBL not_replaced: recorded'); } catch (e: any) { attempts.push(`SYN-DBL not_replaced: refused — ${e.message}`); }
  await asmt.updateDraft(A.practitioner, n.id, { calc_code: 'stel_15', sample_ids: r.sample_ids, benchmark_version_id: r.benchmark_version_id,
    interpretation: 'Synthetic scenario, reassessed with engine 1.5.0. SYN-PM (worker SYN-W1, 15:00–15:15, 2 mg/m³) was excluded by a failed flow check and is not a duplicate of the morning sample SYN-AM (08:00–08:15). The laboratory result for SYN-DBL contradicts its qualifier and awaits clarification. No favourable overall conclusion is possible.',
    conclusion_category: 'insufficient_evidence', limitations: 'Synthetic scenario data only. SYN-PM unresolved; SYN-DBL awaiting laboratory clarification.' });
  const calc = await asmt.calculate(A.practitioner, n.id);
  const draft = await rep.generateReport(A.practitioner, r.aid, n.id);
  const html = (await rep.getReport(A.practitioner, draft.id)).content_html;
  const after = (await admin.query(`select md5(r::text) h from assessment_revisions r where id=$1`, [r.id])).rows[0].h;
  const reportsAfter = (await admin.query(`select md5(string_agg(p::text, '' order by p.id)) h from reports p where assessment_revision_id=$1`, [r.id])).rows[0].h;
  const auditRows = (await admin.query(`select a.at, a.action, u.name actor, a.detail from audit_events a left join users u on u.id=a.user_id where a.action in ('assessment.evidence_disposition','lab_result.create','assessment.approved','report.issued','assessment.new_revision') and a.tenant_id=$1 order by a.at, a.id`, [r.tenant_id])).rows;
  const summary = { approvedRevisionUnchanged: before === after, issuedReportsUnchanged: reportsBefore === reportsAfter, newRevision: { id: n.id, calc: `${calc.calc_output.engineVersion} ${calc.calc_code} ${calc.calc_version}`, benchmark: calc.benchmark_state, dataQuality: calc.data_quality_state, evidenceAdequacy: calc.calc_output.evidenceAdequacy, unresolved: calc.calc_output.unresolvedEvidence }, attempts, auditTrail: auditRows };
  writeFileSync(process.argv[3], html);
  writeFileSync(process.argv[4], JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, auditTrail: `${auditRows.length} rows` }, null, 1));
}
await admin.end();
await closePool();
