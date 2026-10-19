// Phase H1 pilot controls: method gating, reference provenance, workflow suspension, MFA on existing sessions,
// device clock evidence, platform operator refusals and controlled reference-data import.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, type World } from './fixtures.js';
import { closePool, withActor } from '../src/db.js';
import * as reg from '../src/services/register.js';
import * as inst from '../src/services/instruments.js';
import * as plans from '../src/services/plans.js';
import * as field from '../src/services/field.js';
import * as lab from '../src/services/lab.js';
import * as asmt from '../src/services/assessments.js';
import * as rep from '../src/services/reports.js';
import * as ctl from '../src/services/controls.js';
import * as att from '../src/services/attachments.js';
import { assertWorkflowActive, methodCapabilities, type Workflow } from '../src/services/assurance.js';
import { CALCULATIONS } from '../src/calc/engine.js';
import { sentAlerts, resetAlertDedupe } from '../src/alerts.js';
import { login, resolveSession } from '../src/auth/session.js';
import { createTenant, createUserDirect } from '../scripts/bootstrap.js';
import { recordMethodReview, resumeWorkflows, setTenantLevel, suspendWorkflows } from '../scripts/platform-controls.js';
import { importReferenceData, validateFile } from '../scripts/import-reference-data.js';

const URL_ = process.env.DATABASE_ADMIN_URL!;
let w: World;
const S: Record<string, any> = {};
const TWA = CALCULATIONS.twa_8h.version;
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
// Stand-in for a signed review / authorisation document (test schema only).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const EVIDENCE = join(mkdtempSync(join(tmpdir(), 'ohea-ev-')), 'signed-review.pdf');
writeFileSync(EVIDENCE, '%PDF-1.4 test fixture: signed professional review');
const APPROVAL = { scope: 'Automated test scope only', evidenceFile: EVIDENCE };

/** A test-only stand-in for a professionally verified reference row (exists only in the disposable test schema). */
const refRow = (tag: string, value = 2) => ({
  substance: { name: `Test Reference Substance ${tag}` }, jurisdiction: 'TEST', benchmark_type: 'LTEL', averaging_minutes: 480, value, unit: 'mg/m3',
  source_title: 'Test fixture reference list', source_version: 'T1', source_url: 'https://example.org/test-reference', effective_from: '2020-01-01',
  provenance: 'professional_reference', reviewer_name: 'Test Fixture Reviewer', verified_on: yesterday, permitted_use: 'Automated tests only', licence_note: 'Test fixture',
});

beforeAll(async () => {
  w = await buildWorld();
  resetAlertDedupe();
  const r = await importReferenceData(URL_, [refRow(w.tag)], { importedBy: 'test operator' });
  expect(r.created).toBe(1);
  const admin = new pg.Client({ connectionString: URL_ }); await admin.connect();
  const q = (await admin.query(`select s.id sub, bv.id bv from substances s join benchmarks b on b.substance_id=s.id join benchmark_versions bv on bv.benchmark_id=b.id where s.name=$1`, [`Test Reference Substance ${w.tag}`])).rows[0];
  await admin.end();
  S.refSub = q.sub; S.refBv = q.bv;
});
afterAll(async () => {
  // Method reviews are platform-wide; restore the not-reviewed state so other suites are unaffected.
  await recordMethodReview(URL_, { method: 'twa_8h', version: TWA, status: 'not_reviewed', recordedBy: 'test operator' });
  await closePool();
});

describe('pilot gating of calculation methods and reference data', () => {
  it('builds evidence for an assessment on a reference substance', async () => {
    const { prac } = w.a;
    const site = await reg.createSite(prac, { client_id: w.A.clients['Client One'], name: 'Pilot site', reference: `P-${w.tag}` });
    const area = await reg.createWorkArea(prac, { site_id: site.id, name: 'Bay' });
    const proc = await reg.createProcess(prac, { work_area_id: area.id, name: 'Process' });
    const task = await reg.createTask(prac, { process_id: proc.id, name: 'Task', duration_min_per_shift: '480', duration_basis: 'recorded_fact' });
    const hz = await reg.createHazard(prac, { task_id: task.id, substance_id: S.refSub, physical_form: 'dust', exposure_routes: ['inhalation'], exposure_duration_min: '480' });
    S.group = await reg.createGroup(prac, { site_id: site.id, name: 'Operators', rationale: 'Same task, same tools and same shift pattern; comparable work methods observed.', task_ids: [task.id], hazard_ids: [hz.id] });
    S.worker = await reg.createWorker(prac, { client_id: w.A.clients['Client One'], ref_code: `PW-${w.tag}`, full_name: 'Pat Example' });
    await reg.addMembership(prac, { group_id: S.group.id, worker_id: S.worker.id, valid_from: '2026-01-01' });
    S.pump = await inst.createInstrument(prac, { asset_tag: `PP-${w.tag}`, instrument_type: 'sampling_pump' });
    await inst.recordCalibration(prac, S.pump.id, { performed_at: '2026-01-01', valid_until: '2027-12-31', outcome: 'pass' });
    S.plan = await plans.createPlan(prac, { site_id: site.id, title: 'Pilot plan', purpose: 'Pilot gating test', assessment_question: 'What is the 8-hour TWA?', approach: 'personal', strategy_rationale: 'Full-shift personal samples for the test.', instrument_ids: [S.pump.id] });
    await plans.addTarget(prac, S.plan.id, { group_id: S.group.id, substance_id: S.refSub, method_version_id: w.ref.methodVersionId, planned_samples: '1' });
    await plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' });
    await plans.transitionPlan(prac, S.plan.id, { to: 'scheduled' });
    await plans.transitionPlan(w.a.tech, S.plan.id, { to: 'in_progress' });
    S.code = `PS-${w.tag}`;
    S.payload = { plan_id: S.plan.id, sample_code: S.code, sample_type: 'personal', worker_id: S.worker.id, substance_id: S.refSub, method_version_id: w.ref.methodVersionId, instrument_id: S.pump.id,
      timezone: 'Europe/London', start_local: '2026-03-02T08:00', end_local: '2026-03-02T16:00', flow_pre_lpm: 2.0, flow_post_lpm: 2.0 };
    const [r] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: S.payload }], { deviceNow: Date.now() - 600_000 });
    expect(r.outcome).toBe('created');
    expect(r.warnings!.join(' ')).toMatch(/clock differed/);
    S.sample = r.server_id;
    const ev = (await field.sampleDetail(w.a.prac, S.sample)).event;
    expect(Math.abs(ev.device_clock_offset_s - 600)).toBeLessThan(5);
    const lb = await inst.createLaboratory(prac, { name: `Lab ${w.tag}` });
    await lab.createSubmission(prac, { laboratory_id: lb.id, reference: `PSUB-${w.tag}`, sample_ids: [S.sample], dispatched_at: '2026-03-04T09:00' });
    const sub = (await lab.listSubmissions(prac)).find((s) => s.reference === `PSUB-${w.tag}`);
    await lab.receiveSubmission(prac, sub.id, { received_at: '2026-03-05T10:00', received_condition: 'Intact' });
    const imp = await lab.stageImport(prac, { filename: 'p.csv', laboratory_id: lb.id, csv: `sample_code,analyte,value,unit,qualifier,lod\n${S.code},Test Reference Substance ${w.tag},96,ug,=,5\n` });
    expect(imp.status).toBe('validated');
    await lab.commitImport(prac, imp.id);
  });

  it('refuses future capture times (device clock or time zone error)', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
    const [r] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { ...S.payload, sample_code: `PS-F-${w.tag}`, start_local: tomorrow, end_local: undefined } }]);
    expect(r.outcome).toBe('rejected');
    expect(r.message).toMatch(/in the future/);
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
    await expect(field.recordCustody(w.a.prac, S.sample, { event: 'handed_over', at: later, timezone: 'UTC' })).rejects.toThrow(/Custody time .* in the future/);
  });

  it('only a platform operator can move a tenant to pilot; organisation administrators cannot', async () => {
    await expect(withActor(w.a.admin, (tx) => tx.query(`update tenants set assurance_level='pilot'`))).rejects.toThrow(/permission denied/);
    await expect(withActor(w.a.admin, (tx) => tx.query(`insert into method_reviews (calc_code,calc_version,status,recorded_by) values ('twa_8h','${TWA}','not_reviewed','x')`))).rejects.toThrow(/permission denied/);
    await expect(setTenantLevel(URL_, w.A.tenant.id, 'pilot', 'Operator', '')).rejects.toThrow(/evidence/);
    // An upgrade needs a recorded G11 authorisation and at least one approved method (here STEL) and reference benchmark.
    await expect(setTenantLevel(URL_, w.A.tenant.id, 'pilot', 'Test Operator', 'TEST-GATE-REF')).rejects.toThrow(/No recorded pilot authorisation/);
    const { recordPilotAuthorisation } = await import('../scripts/platform-controls.js');
    const authIn = { tenantId: w.A.tenant.id, scopeRef: 'TEST-PROTOCOL', provider: 'Test Director', organisation: 'Test Client Lead', authorisedOn: yesterday, document: 'TEST-G11', documentFile: EVIDENCE, recordedBy: 'Test Operator' };
    await expect(recordPilotAuthorisation(URL_, { ...authIn, recordedBy: 'test director' })).rejects.toThrow(/cannot be one of the authorisers/);
    await recordPilotAuthorisation(URL_, authIn);
    await expect(setTenantLevel(URL_, w.A.tenant.id, 'pilot', 'Test Operator', 'TEST-GATE-REF')).rejects.toThrow(/No calculation method has a current professional approval/);
    await recordMethodReview(URL_, { method: 'stel_15', version: CALCULATIONS.stel_15.version, status: 'approved', reviewer: 'Test Reviewer', competence: 'Test', reviewedOn: yesterday, evidence: 'T', recordedBy: 'Test Operator', ...APPROVAL });
    await setTenantLevel(URL_, w.A.tenant.id, 'pilot', 'Test Operator', 'TEST-GATE-REF');
    await recordMethodReview(URL_, { method: 'stel_15', version: CALCULATIONS.stel_15.version, status: 'not_reviewed', recordedBy: 'Test Operator' });
  });

  it('blocks pilot conclusions that rely on an unreviewed method', async () => {
    const { revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: S.refSub, plan_id: S.plan.id, title: 'Pilot assessment', assessment_question: 'Is exposure adequately controlled?' });
    S.rev = revision.id;
    const draft = { sample_ids: [S.sample], benchmark_version_id: S.refBv, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
      interpretation: 'Single sample for the gating test; not representative of the group.', conclusion_category: 'insufficient_evidence', limitations: 'Automated test data only.' };
    S.draft = draft;
    await asmt.updateDraft(w.a.prac, S.rev, draft);
    const calc = await asmt.calculate(w.a.prac, S.rev);
    expect(calc.calc_output.shifts[0].twa8h.lower).toBeCloseTo(0.1, 6); // 96 µg / 960 L
    await expect(asmt.submitForReview(w.a.prac, S.rev)).rejects.toThrow(/not reviewed by a competent occupational hygienist/);
    // The database refuses the same approval even if the service layer is bypassed.
    await expect(withActor(w.a.rev, (tx) => tx.query(`update assessment_revisions set status='approved' where id=$1`, [S.rev]))).rejects.toThrow(/only a revision in review/);
    // A submitter can only submit as themselves; then the reviewer's direct approval is still refused by the pilot rules.
    await expect(withActor(w.a.rev, (tx) => tx.query(`update assessment_revisions set status='in_review', submitted_by=$2 where id=$1`, [S.rev, w.a.prac.userId]))).rejects.toThrow(/submitter must be the signed-in user/);
    await withActor(w.a.prac, (tx) => tx.query(`update assessment_revisions set status='in_review', submitted_by=$2, submitted_at=now() where id=$1`, [S.rev, w.a.prac.userId]));
    await expect(withActor(w.a.rev, (tx) => tx.query(`update assessment_revisions set status='approved', reviewer_id=$2 where id=$1`, [S.rev, w.a.rev.userId]))).rejects.toThrow(/pilot approval refused/);
    await asmt.returnToDraft(w.a.rev, S.rev, { notes: 'Back to draft after the direct-write test' });
    const caps = await methodCapabilities(w.a.prac);
    expect(caps.rows.find((r) => r.code === 'twa_8h')!.pilotEnabled).toBe(false);
  });

  it('a method review needs a named reviewer, competence, a past date and evidence, recorded by someone else', async () => {
    const base = { method: 'twa_8h', version: TWA, status: 'approved', reviewer: 'Test Reviewer', competence: 'Test competence statement', reviewedOn: yesterday, evidence: 'TEST-PACK-1', recordedBy: 'Test Operator', ...APPROVAL };
    await expect(recordMethodReview(URL_, { ...base, scope: undefined })).rejects.toThrow(/--scope/);
    await expect(recordMethodReview(URL_, { ...base, evidenceFile: '/nonexistent.pdf' })).rejects.toThrow(/--evidence-file/);
    await expect(recordMethodReview(URL_, { ...base, reviewer: undefined })).rejects.toThrow(/--reviewer/);
    await expect(recordMethodReview(URL_, { ...base, evidence: '' })).rejects.toThrow(/--evidence/);
    await expect(recordMethodReview(URL_, { ...base, recordedBy: 'test reviewer' })).rejects.toThrow(/cannot be the reviewer/);
    await expect(recordMethodReview(URL_, { ...base, reviewedOn: '2099-01-01' })).rejects.toThrow(/past date/);
    await expect(recordMethodReview(URL_, { ...base, version: '0.0.1' })).rejects.toThrow(/implemented version/);
    await expect(recordMethodReview(URL_, { ...base, status: 'approved_with_conditions' })).rejects.toThrow(/conditions/);
    await recordMethodReview(URL_, base);
  });

  it('blocks pilot conclusions on synthetic or organisation-entered benchmarks', async () => {
    // An organisation-entered benchmark, even once verified inside the organisation, is not professional reference data.
    const v = await asmt.createBenchmarkVersion(w.a.prac, { substance_id: S.refSub, jurisdiction: 'ORG', benchmark_type: 'IN-HOUSE', averaging_minutes: '480', value: '1', unit: 'mg/m3', source_title: 'In-house limit', source_version: '1', effective_from: '2020-01-01' });
    await asmt.verifyBenchmarkVersion(w.a.rev, v.id, { status: 'verified', note: 'Checked against the in-house standard' });
    await asmt.updateDraft(w.a.prac, S.rev, { ...S.draft, benchmark_version_id: v.id });
    await asmt.calculate(w.a.prac, S.rev);
    await expect(asmt.submitForReview(w.a.prac, S.rev)).rejects.toThrow(/Organisation-entered and synthetic benchmarks/);
  });

  it('allows and freezes a pilot conclusion with an approved method and a reference benchmark', async () => {
    await asmt.updateDraft(w.a.prac, S.rev, S.draft);
    await asmt.calculate(w.a.prac, S.rev);
    await asmt.submitForReview(w.a.prac, S.rev);
    const ap = await asmt.approve(w.a.rev, S.rev, { approval_scope: 'Pilot gating test scope', approval_limitations: 'Automated test only', confirm_reviewed: 'on' });
    expect(ap.method_review_status).toBe('approved');
    expect(ap.benchmark_provenance).toBe('professional_reference');
  });

  it('a pilot report can be issued for a pilot-approved revision and states the approval-time status', async () => {
    S.asmtId = (await withActor(w.a.prac, (tx) => tx.query('select assessment_id from assessment_revisions where id=$1', [S.rev]))).rows[0].assessment_id;
    const r = await rep.generateReport(w.a.prac, S.asmtId, S.rev);
    expect(r.status).toBe('issued');
    expect((await rep.getReport(w.a.prac, r.id)).content_html).toMatch(/Method review status at approval:<\/strong> approved/);
    expect((await rep.getReport(w.a.prac, r.id)).content_html).not.toMatch(/NOT APPROVED UNDER AN AUTHORISED PILOT/);
  });

  it('a pilot benchmark must match the calculation averaging period', async () => {
    const { assertConclusionAllowed } = await import('../src/services/assurance.js');
    await expect(withActor(w.a.prac, (tx) => assertConclusionAllowed(tx, 'stel_15', CALCULATIONS.stel_15.version, S.refBv))).rejects.toThrow(/not reviewed|averaging period/);
    await recordMethodReview(URL_, { method: 'stel_15', version: CALCULATIONS.stel_15.version, status: 'approved', reviewer: 'Test Reviewer', competence: 'Test', reviewedOn: yesterday, evidence: 'T', recordedBy: 'Test Operator', ...APPROVAL });
    try {
      await expect(withActor(w.a.prac, (tx) => assertConclusionAllowed(tx, 'stel_15', CALCULATIONS.stel_15.version, S.refBv))).rejects.toThrow(/averaging period/);
    } finally {
      await recordMethodReview(URL_, { method: 'stel_15', version: CALCULATIONS.stel_15.version, status: 'not_reviewed', recordedBy: 'Test Operator' });
    }
  });

  it('a later withdrawal of the method approval does not alter the approved revision', async () => {
    await recordMethodReview(URL_, { method: 'twa_8h', version: TWA, status: 'not_reviewed', recordedBy: 'Test Operator' });
    const d = await asmt.assessmentDetail(w.a.prac, (await withActor(w.a.prac, (tx) => tx.query('select assessment_id from assessment_revisions where id=$1', [S.rev]))).rows[0].assessment_id);
    expect(d.approved.method_review_status).toBe('approved');
    expect(d.method!.status).toBe('not_reviewed');
  });
});

describe('pilot report issue gate', () => {
  it('refuses to issue when the method has since been rejected', async () => {
    await recordMethodReview(URL_, { method: 'twa_8h', version: TWA, status: 'rejected', reviewer: 'Test Reviewer', competence: 'Test', reviewedOn: yesterday, evidence: 'T-REJ', recordedBy: 'Test Operator' });
    await expect(rep.generateReport(w.a.prac, S.asmtId, S.rev)).rejects.toThrow(/since been rejected/);
    await recordMethodReview(URL_, { method: 'twa_8h', version: TWA, status: 'not_reviewed', recordedBy: 'Test Operator' });
  });
  it('refuses to issue, in a pilot organisation, a revision approved while at evaluation level', async () => {
    const admin = new pg.Client({ connectionString: URL_ }); await admin.connect();
    await admin.query(`update tenants set assurance_level='evaluation' where id=$1`, [w.A.tenant.id]);
    const id = (await asmt.newRevision(w.a.prac, S.asmtId, { change_reason: 'Evaluation-level reassessment for test' })).id;
    await asmt.updateDraft(w.a.prac, id, S.draft);
    await asmt.calculate(w.a.prac, id);
    await asmt.submitForReview(w.a.prac, id);
    const ap = await asmt.approve(w.a.rev, id, { approval_scope: 'Evaluation approval for test', approval_limitations: 'Automated test only', confirm_reviewed: 'on' });
    expect(ap.assurance_level_at_approval).toBe('evaluation');
    const evalReport = await rep.generateReport(w.a.prac, S.asmtId, id);
    expect((await rep.getReport(w.a.prac, evalReport.id)).content_html).toMatch(/NOT APPROVED UNDER AN AUTHORISED PILOT/);
    // Returning to pilot level needs a current method approval (database rule); STEL is approved for the purpose.
    const stel = { method: 'stel_15', version: CALCULATIONS.stel_15.version, recordedBy: 'Test Operator' };
    await recordMethodReview(URL_, { ...stel, status: 'approved', reviewer: 'Test Reviewer', competence: 'Test', reviewedOn: yesterday, evidence: 'T', ...APPROVAL });
    await admin.query(`update tenants set assurance_level='pilot' where id=$1`, [w.A.tenant.id]);
    await recordMethodReview(URL_, { ...stel, status: 'not_reviewed' });
    await admin.end();
    await expect(rep.generateReport(w.a.prac, S.asmtId, id)).rejects.toThrow(/not approved under the pilot controls/);
    // Direct insert of an issued report through the application role is refused by the database.
    await expect(withActor(w.a.prac, (tx) => tx.query(`insert into reports (tenant_id,client_id,assessment_id,assessment_revision_id,version,status,content_html,content_hash,generated_by)
      select tenant_id, client_id, assessment_id, id, 99, 'issued', 'x', '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881', $2 from assessment_revisions where id=$1`, [id, w.a.prac.userId]))).rejects.toThrow(/report issue refused/);
  });
});

describe('workflow suspension under stop conditions', () => {
  it('suspends named workflows, alerts, refuses actions and preserves records', async () => {
    const t = w.B.tenant.id;
    await expect(suspendWorkflows(URL_, t, ['field_sync', 'bogus'], 'x', 'Op')).rejects.toThrow(/Unknown workflow/);
    await expect(suspendWorkflows(URL_, t, ['field_sync'], '', 'Op')).rejects.toThrow(/reason/);
    const all: Workflow[] = ['field_sync', 'lab_import', 'assessment_approval', 'report_issue', 'action_closure'];
    await suspendWorkflows(URL_, t, all, 'Stop condition SC-TEST', 'Test Operator');
    expect(sentAlerts.some((a) => a.event === 'workflow.suspended' && a.detail.tenant_id === t)).toBe(true);
    for (const wf of all) await expect(withActor(w.b.prac, (tx) => assertWorkflowActive(tx, wf))).rejects.toThrow(/suspended.*SC-TEST/);
    // Other tenants are unaffected.
    await withActor(w.a.prac, (tx) => assertWorkflowActive(tx, 'field_sync'));
    const [r] = await field.syncBatch(w.b.prac, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: {} }]);
    expect(r.outcome).toBe('deferred'); // devices keep the record pending and retry after resumption
    expect(r.message).toMatch(/suspended/);
    const fake = randomUUID();
    await expect(field.voidSamplingEvent(w.b.prac, fake, { reason: 'Suspension gate check reason' })).rejects.toThrow(/suspended/);
    await expect(field.recordCustody(w.b.prac, fake, { event: 'handed_over', at: '2026-03-02T10:00' })).rejects.toThrow(/suspended/);
    await expect(ctl.cancelAction(w.b.admin, fake, { reason: 'Suspension gate check reason' })).rejects.toThrow(/suspended/);
    await expect(lab.receiveSubmission(w.b.prac, fake, { received_at: '2026-03-05T10:00', received_condition: 'Intact' })).rejects.toThrow(/suspended/);
    await expect(att.saveAttachment(w.b.prac, { entity_type: 'sampling_event', entity_id: fake, filename: 'note.txt', data: Buffer.from('evidence') })).rejects.toThrow(/suspended/);
    await expect(resumeWorkflows(URL_, t, ['field_sync'], 'Op', '')).rejects.toThrow(/evidence/);
    const left = await resumeWorkflows(URL_, t, ['field_sync'], 'Test Operator', 'REVALIDATION-TEST');
    expect(left).not.toContain('field_sync');
    await withActor(w.b.prac, (tx) => assertWorkflowActive(tx, 'field_sync'));
    await expect(withActor(w.b.prac, (tx) => assertWorkflowActive(tx, 'lab_import'))).rejects.toThrow(/suspended/);
  });
});

describe('MFA enforcement for sessions that existed before MFA was required', () => {
  it('a session created while MFA was optional loses full access once MFA becomes mandatory', async () => {
    const admin = new pg.Client({ connectionString: URL_ }); await admin.connect();
    const { tenant } = await createTenant(admin, { name: `MFA Org ${w.tag}`, mfaRequired: false });
    const u = await createUserDirect(admin, { tenantId: tenant.id, email: `mfa.${w.tag}@t.test`, name: 'M', role: 'practitioner', password: 'correct horse battery' });
    const l = await login(u.email, 'correct horse battery');
    expect((await resolveSession(l.token))!.mfaPassed).toBe(true);
    await admin.query('update tenants set mfa_required=true where id=$1', [tenant.id]);
    await admin.end();
    const si = (await resolveSession(l.token))!;
    expect(si.mfaPassed).toBe(false);
    expect(si.mfaRequired).toBe(true);
  });
});

describe('session idle timeout', () => {
  it('a session with no activity for longer than the idle limit is no longer accepted', async () => {
    const admin = new pg.Client({ connectionString: URL_ }); await admin.connect();
    const u = await createUserDirect(admin, { tenantId: w.B.tenant.id, email: `idle.${w.tag}@t.test`, name: 'I', role: 'practitioner', password: 'correct horse battery' });
    const l = await login(u.email, 'correct horse battery');
    expect(await resolveSession(l.token)).not.toBeNull();
    await admin.query(`update sessions set last_seen_at = now() - interval '3 hours' where user_id=$1`, [u.id]);
    await admin.end();
    expect(await resolveSession(l.token)).toBeNull();
  });
});

describe('controlled reference-data import', () => {
  it('validates every row and refuses the whole file on any error', () => {
    const { errors } = validateFile([
      { ...refRow('x'), provenance: 'synthetic' },
      { ...refRow('y'), substance: { name: 'Synthetic thing', cas_number: '64-17-5' }, provenance: 'synthetic' },
      { ...refRow('z'), verified_on: '2099-01-01' },
      { ...refRow('m'), substance: { name: 'M', molecular_weight: 46.07 } },
    ]);
    expect(errors.join('\n')).toMatch(/row 1.*synthetic/);
    expect(errors.join('\n')).toMatch(/row 2.*CAS/);
    expect(errors.join('\n')).toMatch(/row 3.*future/);
    expect(errors.join('\n')).toMatch(/row 4.*molecular_weight_source/);
  });
  it('never changes an existing version; a changed value must be a new source version', async () => {
    const again = await importReferenceData(URL_, [refRow(w.tag)], { importedBy: 'test operator' });
    expect(again.skippedExisting).toBe(1);
    await expect(importReferenceData(URL_, [refRow(w.tag, 3)], { importedBy: 'test operator' })).rejects.toThrow(/new source version/);
    const v2 = await importReferenceData(URL_, [{ ...refRow(w.tag, 3), source_version: 'T2', effective_from: '2026-01-01' }], { importedBy: 'test operator', dryRun: true });
    expect(v2).toMatchObject({ created: 1, dryRun: true });
    await expect(importReferenceData(URL_, [refRow(w.tag)], { importedBy: '' })).rejects.toThrow(/imported-by/);
  });
  it('the database refuses an incomplete professional reference row', async () => {
    const admin = new pg.Client({ connectionString: URL_ }); await admin.connect();
    const b = (await admin.query('select benchmark_id from benchmark_versions where id=$1', [S.refBv])).rows[0].benchmark_id;
    await expect(admin.query(`insert into benchmark_versions (tenant_id,benchmark_id,value,unit,source_title,source_version,effective_from,verification_status,provenance)
      values (null,$1,1,'mg/m3','x','x','2020-01-01','verified','professional_reference')`, [b])).rejects.toThrow(/professional_reference_complete/);
    await admin.end();
  });
});

describe('field recovery files', () => {
  const webcrypto = globalThis.crypto;
  async function sealFor(spki: string, obj: object, attest?: string) {
    const subtle = webcrypto.subtle;
    const pub = await subtle.importKey('spki', Buffer.from(spki, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const rk = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, rk, new TextEncoder().encode(JSON.stringify(obj)));
    const wk = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, await subtle.exportKey('raw', rk));
    const b = (x: ArrayBuffer | Uint8Array) => Buffer.from(x as ArrayBuffer).toString('base64');
    const e = { v: 1 as const, wk: b(wk), iv: b(iv), ct: b(ct) };
    const { createHmac } = await import('node:crypto');
    const { recoveryAttestKey: rak } = await import('../src/services/recovery.js');
    const k = attest ?? await withActor(w.a.tech, (tx) => rak(tx, w.A.tenant.id, w.a.tech.userId));
    return { ...e, kv: 1, mac: createHmac('sha256', Buffer.from(k, 'base64')).update(`1.${e.wk}.${e.iv}.${e.ct}`).digest('base64') };
  }
  it('opens sealed records server-side, rejects other organisations and tampering, and is idempotent', async () => {
    const { recoveryPublicKey, importRecoveryFile } = await import('../src/services/recovery.js');
    const spki = await withActor(w.a.tech, (tx) => recoveryPublicKey(tx, w.A.tenant.id));
    const cu = randomUUID();
    const rec = { tenant_id: w.A.tenant.id, user_id: w.a.tech.userId, client_uuid: cu, server_id: null, base_version: null,
      payload: { ...S.payload, sample_code: `REC-${w.tag}`, start_local: '2026-03-03T08:00', end_local: '2026-03-03T12:00' } };
    const good = await sealFor(spki, rec);
    const forged = await sealFor(spki, { ...rec, tenant_id: w.B.tenant.id });
    const tampered = { ...good, ct: Buffer.from(Buffer.from(good.ct, 'base64').map((x, i) => (i === 3 ? x ^ 1 : x))).toString('base64') };
    const file = (records: any[], tenant = w.A.tenant.id) => JSON.stringify({ format: 'ohea-field-recovery', version: 1, tenant_id: tenant, user_id: w.a.tech.userId, exported_at: '2026-10-18T09:00:00.000Z', records });
    // Importing needs both conflict-resolution and field-capture rights: neither technicians nor reviewers (approvers) alone.
    await expect(importRecoveryFile(w.a.tech, file([good]))).rejects.toThrow(/permission/);
    await expect(importRecoveryFile(w.a.rev, file([good]))).rejects.toThrow(/permission/);
    // Someone holding only the public key cannot attribute records to another user (no valid attestation MAC).
    const { recoveryAttestKey } = await import('../src/services/recovery.js');
    const spoofed = await sealFor(spki, { ...rec, client_uuid: randomUUID() }, await withActor(w.a.prac2, (tx) => recoveryAttestKey(tx, w.A.tenant.id, w.a.prac2.userId)));
    const sp = await importRecoveryFile(w.a.prac, file([spoofed]));
    expect(sp.undecryptable).toEqual([1]);
    await expect(importRecoveryFile(w.a.prac, file([good]).replace(w.a.tech.userId, randomUUID()).replace(w.a.tech.userId, randomUUID()))).rejects.toThrow(/not a user of this organisation/);
    await expect(importRecoveryFile(w.b.prac, file([good]))).rejects.toThrow(/different organisation/);
    await expect(importRecoveryFile(w.b.prac, file([good], w.B.tenant.id))).rejects.toThrow(/No recovery key|could not/);
    const r = await importRecoveryFile(w.a.prac, file([good, forged, tampered]));
    expect(r.results.map((x) => x.outcome)).toEqual(['created']);
    expect(r.undecryptable).toEqual([2, 3]);
    const row = (await withActor(w.a.prac, (tx) => tx.query('select recovered_from_user, created_by from sampling_events where client_uuid=$1', [cu]))).rows[0];
    expect(row.recovered_from_user).toBe(w.a.tech.userId);
    expect(row.created_by).toBe(w.a.prac.userId);
    const again = await importRecoveryFile(w.a.prac, file([good, forged, tampered]));
    expect(again.results[0].outcome).toBe('duplicate');
    expect(again.previouslyImportedAt).not.toBeNull();
    expect(sentAlerts.some((a) => a.event === 'field.recovery_imported')).toBe(true);
    await expect(importRecoveryFile(w.a.prac, '{"not":"a file"}')).rejects.toThrow(/not a valid/);
  });
});

describe('field recovery key integrity and KEK rotation', () => {
  it('a recovery key planted through the application role is detected and refused', async () => {
    const { recoveryPublicKey } = await import('../src/services/recovery.js');
    const { verifyRecoveryKeys } = await import('../scripts/recovery-keys.js');
    const admin = new pg.Client({ connectionString: URL_ }); await admin.connect();
    await admin.query('delete from field_recovery_keys where tenant_id=$1', [w.B.tenant.id]);
    const { generateKeyPairSync } = await import('node:crypto');
    const spki = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    await withActor(w.b.admin, (tx) => tx.query('insert into field_recovery_keys (tenant_id, public_key_spki, private_key_enc) values ($1,$2,$3)', [w.B.tenant.id, spki, 'AAAA.AAAA.AAAA']));
    await expect(withActor(w.b.admin, (tx) => recoveryPublicKey(tx, w.B.tenant.id))).rejects.toThrow(/does not open/);
    expect((await verifyRecoveryKeys(URL_)).invalid.some((x) => x.startsWith(w.B.tenant.id))).toBe(true);
    await admin.query('delete from field_recovery_keys where tenant_id=$1', [w.B.tenant.id]);
    await admin.end();
  });
  it('rotates the KEK all-or-nothing and keeps key pairs (so device envelopes stay importable)', async () => {
    const { rotateRecoveryKek } = await import('../scripts/recovery-keys.js');
    const { kekFromEnv, keyRowValid } = await import('../src/services/recovery.js');
    const { randomBytes } = await import('node:crypto');
    const oldK = kekFromEnv(); const newK = randomBytes(32);
    const admin = new pg.Client({ connectionString: URL_ }); await admin.connect();
    const before = (await admin.query('select tenant_id, public_key_spki from field_recovery_keys order by tenant_id')).rows;
    await expect(rotateRecoveryKek(URL_, oldK, newK, '')).rejects.toThrow(/authorised-by/);
    const r = await rotateRecoveryKek(URL_, oldK, newK, 'Test Operator');
    expect(r.rotated).toBe(before.length);
    const rows = (await admin.query('select tenant_id, public_key_spki, private_key_enc from field_recovery_keys order by tenant_id')).rows;
    expect(rows.map((x) => x.public_key_spki)).toEqual(before.map((x) => x.public_key_spki));
    expect(rows.every((x) => keyRowValid(x, newK) && !keyRowValid(x, oldK))).toBe(true);
    await rotateRecoveryKek(URL_, newK, oldK, 'Test Operator'); // restore for the rest of the suite
    await admin.end();
  });
});
