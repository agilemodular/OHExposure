// Phase H2: suspension consistency (holds, intake quarantine, in-flight uploads, offline replay, background jobs,
// disposal), approval/report-issue prerequisites on every write path, races, professional authority records
// (scope, evidence hash, withdrawal, expiry, pilot authorisation) and versioned field recovery keys.
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import * as att from '../src/services/attachments.js';
import * as adm from '../src/services/admin.js';
import * as integ from '../src/services/integrations.js';
import { CALCULATIONS } from '../src/calc/engine.js';
import { holdAssessment, methodImpact, recordMethodReview, recordPilotAuthorisation, releaseAssessment, resumeWorkflows, setTenantLevel, suspendWorkflows } from '../scripts/platform-controls.js';
import { importReferenceData } from '../scripts/import-reference-data.js';
import { replaceRecoveryKey } from '../scripts/recovery-keys.js';

const URL_ = process.env.DATABASE_ADMIN_URL!;
const TWA = CALCULATIONS.twa_8h.version;
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const EVIDENCE = join(mkdtempSync(join(tmpdir(), 'ohea-h2-')), 'signed.pdf');
writeFileSync(EVIDENCE, '%PDF-1.4 test fixture');
const APPROVE = { method: 'twa_8h', version: TWA, status: 'approved', reviewer: 'H2 Reviewer', competence: 'Test', reviewedOn: yesterday, evidence: 'H2-PACK', evidenceFile: EVIDENCE, scope: 'Test scope', recordedBy: 'H2 Operator' };
const NOT_REVIEWED = { method: 'twa_8h', version: TWA, status: 'not_reviewed', recordedBy: 'H2 Operator' };
let w: World;
const S: Record<string, any> = {};
const admin = () => { const c = new pg.Client({ connectionString: URL_ }); return c.connect().then(() => c); };

/** Evidence chain on tenant A: site → group → plan → two collected samples with results. */
async function buildEvidence() {
  const r = await importReferenceData(URL_, [{ substance: { name: `H2 Reference Substance ${w.tag}` }, jurisdiction: 'TEST', benchmark_type: 'LTEL', averaging_minutes: 480, value: 2, unit: 'mg/m3',
    source_title: 'Test fixture list', source_version: 'H2', source_url: 'https://example.org/h2', effective_from: '2020-01-01', provenance: 'professional_reference',
    reviewer_name: 'H2 Fixture Reviewer', verified_on: yesterday, permitted_use: 'Automated tests only', licence_note: 'Test fixture' }], { importedBy: 'h2 operator' });
  expect(r.created).toBe(1);
  const c = await admin();
  const q = (await c.query(`select s.id sub, bv.id bv from substances s join benchmarks b on b.substance_id=s.id join benchmark_versions bv on bv.benchmark_id=b.id where s.name=$1`, [`H2 Reference Substance ${w.tag}`])).rows[0];
  await c.end();
  S.sub = q.sub; S.bv = q.bv;
  const { prac } = w.a;
  const site = await reg.createSite(prac, { client_id: w.A.clients['Client One'], name: 'H2 site', reference: `H2-${w.tag}` });
  const area = await reg.createWorkArea(prac, { site_id: site.id, name: 'Bay' });
  const proc = await reg.createProcess(prac, { work_area_id: area.id, name: 'Process' });
  const task = await reg.createTask(prac, { process_id: proc.id, name: 'Task', duration_min_per_shift: '480', duration_basis: 'recorded_fact' });
  const hz = await reg.createHazard(prac, { task_id: task.id, substance_id: S.sub, physical_form: 'dust', exposure_routes: ['inhalation'], exposure_duration_min: '480' });
  S.group = await reg.createGroup(prac, { site_id: site.id, name: 'Operators', rationale: 'Same task, tools and shift pattern; comparable methods observed.', task_ids: [task.id], hazard_ids: [hz.id] });
  S.worker = await reg.createWorker(prac, { client_id: w.A.clients['Client One'], ref_code: `H2W-${w.tag}`, full_name: 'Sam Example' });
  await reg.addMembership(prac, { group_id: S.group.id, worker_id: S.worker.id, valid_from: '2026-01-01' });
  S.pump = await inst.createInstrument(prac, { asset_tag: `H2P-${w.tag}`, instrument_type: 'sampling_pump' });
  await inst.recordCalibration(prac, S.pump.id, { performed_at: '2026-01-01', valid_until: '2027-12-31', outcome: 'pass' });
  S.plan = await plans.createPlan(prac, { site_id: site.id, title: 'H2 plan', purpose: 'H2 automated control tests', assessment_question: 'What is the TWA?', approach: 'personal', strategy_rationale: 'Full-shift personal samples for testing.', instrument_ids: [S.pump.id] });
  await plans.addTarget(prac, S.plan.id, { group_id: S.group.id, substance_id: S.sub, method_version_id: w.ref.methodVersionId, planned_samples: '2' });
  await plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' });
  await plans.transitionPlan(prac, S.plan.id, { to: 'scheduled' });
  await plans.transitionPlan(w.a.tech, S.plan.id, { to: 'in_progress' });
  S.payload = (code: string, day: string) => ({ plan_id: S.plan.id, sample_code: code, sample_type: 'personal', worker_id: S.worker.id, substance_id: S.sub, method_version_id: w.ref.methodVersionId,
    instrument_id: S.pump.id, timezone: 'Europe/London', start_local: `${day}T08:00`, end_local: `${day}T16:00`, flow_pre_lpm: 2, flow_post_lpm: 2 });
  S.samples = [];
  for (const [i, day] of ['2026-03-02', '2026-03-03'].entries()) {
    const [x] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: S.payload(`H2S-${w.tag}-${i}`, day) }]);
    expect(x.outcome).toBe('created');
    S.samples.push(x.server_id);
  }
  S.lab = await inst.createLaboratory(prac, { name: `H2 Lab ${w.tag}` });
  await lab.createSubmission(prac, { laboratory_id: S.lab.id, reference: `H2SUB-${w.tag}`, sample_ids: S.samples, dispatched_at: '2026-03-04T09:00' });
  const sub = (await lab.listSubmissions(prac)).find((s) => s.reference === `H2SUB-${w.tag}`);
  await lab.receiveSubmission(prac, sub.id, { received_at: '2026-03-05T10:00', received_condition: 'Intact' });
  const imp = await lab.stageImport(prac, { filename: 'h2.csv', laboratory_id: S.lab.id,
    csv: `sample_code,analyte,value,unit,qualifier,lod\nH2S-${w.tag}-0,H2 Reference Substance ${w.tag},96,ug,=,5\nH2S-${w.tag}-1,H2 Reference Substance ${w.tag},48,ug,=,5\n` });
  await lab.commitImport(prac, imp.id);
  S.draft = { benchmark_version_id: S.bv, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
    interpretation: 'Two full-shift samples for the H2 tests; not representative of the group.', conclusion_category: 'insufficient_evidence', limitations: 'Automated test data only.' };
}
async function inReview(sampleIds: string[]) {
  const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: S.sub, plan_id: S.plan.id, title: `H2 assessment ${randomUUID().slice(0, 4)}`, assessment_question: 'Is exposure adequately controlled?' });
  await asmt.updateDraft(w.a.prac, revision.id, { ...S.draft, sample_ids: sampleIds });
  await asmt.calculate(w.a.prac, revision.id);
  await asmt.submitForReview(w.a.prac, revision.id);
  return { assessmentId: assessment.id, revId: revision.id };
}
const approveIn = { approval_scope: 'H2 automated test scope', approval_limitations: 'Automated test only', confirm_reviewed: 'on' };

beforeAll(async () => { w = await buildWorld(); await buildEvidence(); });
afterAll(async () => {
  await recordMethodReview(URL_, NOT_REVIEWED);
  await closePool();
});

describe('suspension policy — records, attachments, intake, background jobs, administration', () => {
  it('records refused attempts in the audit trail (they survive the rollback)', async () => {
    await suspendWorkflows(URL_, w.B.tenant.id, ['lab_import'], 'SC-H2 test', 'H2 Operator');
    await expect(lab.receiveSubmission(w.b.prac, randomUUID(), { received_at: '2026-03-05T10:00', received_condition: 'Intact' })).rejects.toThrow(/suspended/);
    const c = await admin();
    const n = (await c.query(`select count(*)::int n from audit_events where tenant_id=$1 and action='workflow.blocked' and detail->>'workflow'='lab_import'`, [w.B.tenant.id])).rows[0].n;
    await c.end();
    expect(n).toBeGreaterThan(0);
    await resumeWorkflows(URL_, w.B.tenant.id, ['lab_import'], 'H2 Operator', 'H2-REVAL');
  });

  it('blocks ordinary uploads, quarantines authorised remediation intake, and admits it only after resumption by another reviewer', async () => {
    await suspendWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'SC3 H2 investigation', 'H2 Operator');
    const file = { entity_type: 'sampling_event', entity_id: S.samples[0], filename: 'note.txt', data: Buffer.from('remediation evidence') };
    await expect(att.saveAttachment(w.a.prac, file)).rejects.toThrow(/suspended/);
    await expect(att.saveAttachment(w.a.tech, { ...file, intake: { reason: 'Calibration record for the investigation' } })).rejects.toThrow(/limited to practitioners/);
    await expect(att.saveAttachment(w.a.prac, { ...file, intake: { reason: 'short' } })).rejects.toThrow(/at least 10/);
    const q = await att.saveAttachment(w.a.prac, { ...file, intake: { reason: 'Pump calibration certificate for SC3 investigation' } });
    expect(q.quarantined).toBe(true);
    // Quarantined evidence cannot be linked as a laboratory certificate.
    await expect(withActor(w.a.prac, (tx) => att.assertLinkableAttachment(tx, q.id))).rejects.toThrow(/quarantined/);
    await expect(att.admitAttachment(w.a.rev, q.id, { notes: 'Checked against the original' })).rejects.toThrow(/suspended/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'H2 Operator', 'H2-REVAL');
    await expect(att.admitAttachment(w.a.prac, q.id, { notes: 'Checked against the original' })).rejects.toThrow(/technical reviewer/);
    await att.admitAttachment(w.a.rev, q.id, { notes: 'Checked against the original certificate' });
    await withActor(w.a.prac, (tx) => att.assertLinkableAttachment(tx, q.id));
    // Intake is not a way round ordinary uploads when nothing is suspended.
    await expect(att.saveAttachment(w.a.prac, { ...file, intake: { reason: 'Pump calibration certificate again' } })).rejects.toThrow(/only for records whose workflow is suspended/);
  });

  it('an upload in flight when a suspension is committed is refused at finalisation (suspension waits for, or precedes, the check)', async () => {
    // Hold a share lock on the tenant row the way a finalising upload does, and show that the suspension waits for it.
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL }); await app.connect();
    await app.query('begin');
    await app.query(`select set_config('app.tenant_id',$1,true), set_config('app.client_id','',true), set_config('app.user_id',$2,true)`, [w.A.tenant.id, w.a.prac.userId]);
    await app.query('select 1 from tenants where id=$1 for share', [w.A.tenant.id]);
    let done = false;
    const susp = suspendWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'SC3 race test', 'H2 Operator').then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toBe(false); // blocked behind the finalising transaction
    await app.query('commit'); await app.end();
    await susp;
    // Any upload finalising after the suspension committed is refused.
    await expect(att.saveAttachment(w.a.prac, { entity_type: 'sampling_event', entity_id: S.samples[0], filename: 'late.txt', data: Buffer.from('late') })).rejects.toThrow(/suspended/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'H2 Operator', 'H2-REVAL');
  });

  it('holds integration deliveries and refuses disposal while approval or issue is suspended', async () => {
    await suspendWorkflows(URL_, w.A.tenant.id, ['report_issue'], 'SC5 H2', 'H2 Operator');
    const r = await integ.deliverPending(w.a.admin);
    expect(r).toMatchObject({ delivered: 0, mock: 0 });
    const c0 = await admin();
    const held = (await c0.query(`select count(*)::int n from audit_events where tenant_id=$1 and action='integration.delivery_held'`, [w.A.tenant.id])).rows[0].n;
    await c0.end();
    expect(held).toBeGreaterThan(0);
    await expect(adm.requestDisposal(w.a.admin, { record_class: 'attachment', entity_id: randomUUID(), reason: 'Retention period has expired for this file' })).rejects.toThrow(/cannot be disposed of while workflows are suspended/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['report_issue'], 'H2 Operator', 'H2-REVAL');
  });
});

describe('offline replay after a suspension', () => {
  it('holds records received while suspended, flags them when they finally arrive, and keeps them out of assessments until cleared', async () => {
    await suspendWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'SC3 replay test', 'H2 Operator');
    const cu = randomUUID();
    const payload = S.payload(`H2R-${w.tag}`, '2026-03-06');
    const [r1] = await field.syncBatch(w.a.tech, [{ client_uuid: cu, server_id: null, base_version: null, payload }]);
    expect(r1.outcome).toBe('deferred');
    const [r1b] = await field.syncBatch(w.a.tech, [{ client_uuid: cu, server_id: null, base_version: null, payload }]); // retry: one hold, not two
    expect(r1b.outcome).toBe('deferred');
    let h = await field.listSuspensionHolds(w.a.prac);
    expect(h.held.filter((x) => x.client_uuid === cu)).toHaveLength(1);
    await expect(field.listSuspensionHolds(w.a.tech)).rejects.toThrow(/permission/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'H2 Operator', 'H2-REVAL');
    const [r2] = await field.syncBatch(w.a.tech, [{ client_uuid: cu, server_id: null, base_version: null, payload }]);
    expect(r2.outcome).toBe('created');
    expect((r2.warnings ?? []).join(' ')).toMatch(/received during a suspension/);
    h = await field.listSuspensionHolds(w.a.prac);
    expect(h.toReview.map((x) => x.id)).toContain(r2.server_id);
    S.replayed = r2.server_id;
    // Laboratory result so the sample could be used.
    await lab.recordResult(w.a.prac, { sampling_event_id: r2.server_id, substance_id: S.sub, value: '60', unit: 'ug', qualifier: '=', lod: '5' }).catch(async () => {
      // the sample must be collected/dispatched first in some flows; record custody then retry
      await field.recordCustody(w.a.prac, r2.server_id!, { event: 'dispatched', at: '2026-03-07T09:00' });
      await lab.recordResult(w.a.prac, { sampling_event_id: r2.server_id, substance_id: S.sub, value: '60', unit: 'ug', qualifier: '=', lod: '5' });
    });
    const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: S.sub, plan_id: S.plan.id, title: 'H2 replay', assessment_question: 'Does replayed evidence enter silently?' });
    await asmt.updateDraft(w.a.prac, revision.id, { ...S.draft, sample_ids: [S.replayed] });
    await asmt.calculate(w.a.prac, revision.id);
    await expect(asmt.submitForReview(w.a.prac, revision.id)).rejects.toThrow(/during a suspension and must be reviewed/);
    await expect(field.clearSuspensionReview(w.a.tech, S.replayed, { notes: 'Checked against the device' })).rejects.toThrow(/permission/);
    await field.clearSuspensionReview(w.a.prac, S.replayed, { notes: 'Checked against the field sheet and device' });
    await asmt.submitForReview(w.a.prac, revision.id);
    S.replayAssessment = assessment.id;
  });
});

describe('approval and report-issue prerequisites on every write path', () => {
  it('direct writes through the application role cannot approve outside the rules', async () => {
    const { revId } = await inReview([S.samples[0]]);
    S.revA = revId;
    const direct = (actor: any, sql: string, params: unknown[]) => withActor(actor, (tx) => tx.query(sql, params));
    await expect(direct(w.a.prac, `update assessment_revisions set status='approved', reviewer_id=$2 where id=$1`, [revId, w.a.prac.userId])).rejects.toThrow(/active technical reviewer/);
    await expect(direct(w.a.rev, `update assessment_revisions set status='approved', reviewer_id=$2 where id=$1`, [revId, w.a.prac.userId])).rejects.toThrow(/reviewer must be the signed-in user/);
    await expect(direct(w.a.rev, `update assessment_revisions set status='approved', reviewer_id=$2 where id=$1`, [revId, w.b.prac.userId])).rejects.toThrow(/reviewer must be the signed-in user/);
    // Content cannot be changed after submission, not even in the approving statement.
    await expect(direct(w.a.rev, `update assessment_revisions set status='approved', reviewer_id=$2, interpretation='changed by reviewer' where id=$1`, [revId, w.a.rev.userId])).rejects.toThrow(/cannot be edited/);
    await expect(direct(w.a.prac, `update assessment_revisions set sample_ids=$2 where id=$1`, [revId, [S.samples[1]]])).rejects.toThrow(/cannot be edited/);
    // Nothing can be inserted already approved or in review (finding R2-C1).
    await expect(direct(w.a.prac, `insert into assessment_revisions (tenant_id,client_id,assessment_id,revision,sample_ids,calc_code,calc_version,parameters,created_by,status,reviewer_id,approved_at,method_review_status,benchmark_provenance,assurance_level_at_approval)
      select tenant_id, client_id, assessment_id, 99, sample_ids, calc_code, calc_version, parameters, created_by, 'approved', $2, now(), 'approved', 'professional_reference', 'pilot' from assessment_revisions where id=$1`, [revId, w.a.rev.userId])).rejects.toThrow(/new revisions must be drafts/);
    await expect(direct(w.a.prac, `insert into assessment_revisions (tenant_id,client_id,assessment_id,revision,sample_ids,calc_code,calc_version,parameters,created_by,status,submitted_by)
      select tenant_id, client_id, assessment_id, 98, sample_ids, calc_code, calc_version, parameters, null, 'in_review', null from assessment_revisions where id=$1`, [revId])).rejects.toThrow(/new revisions must be drafts/);
    await suspendWorkflows(URL_, w.A.tenant.id, ['assessment_approval'], 'SC2 H2', 'H2 Operator');
    await expect(direct(w.a.rev, `update assessment_revisions set status='approved', reviewer_id=$2 where id=$1`, [revId, w.a.rev.userId])).rejects.toThrow(/approval is suspended/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['assessment_approval'], 'H2 Operator', 'H2-REVAL');
  });

  it('an assessment on hold cannot be approved or issued by any path; release needs a revalidation reference', async () => {
    await holdAssessment(URL_, (await withActor(w.a.prac, (tx) => tx.query('select assessment_id from assessment_revisions where id=$1', [S.revA]))).rows[0].assessment_id, 'SC2 calculation discrepancy', 'H2 Operator');
    await expect(asmt.approve(w.a.rev, S.revA, approveIn)).rejects.toThrow(/on hold/);
    await expect(withActor(w.a.rev, (tx) => tx.query(`update assessment_revisions set status='approved', reviewer_id=$2 where id=$1`, [S.revA, w.a.rev.userId]))).rejects.toThrow(/on hold/);
    const asId = (await withActor(w.a.prac, (tx) => tx.query('select assessment_id from assessment_revisions where id=$1', [S.revA]))).rows[0].assessment_id;
    await expect(releaseAssessment(URL_, asId, 'H2 Operator', '')).rejects.toThrow(/evidence/);
    await releaseAssessment(URL_, asId, 'H2 Operator', 'H2-REVAL-SC2');
    const ap = await asmt.approve(w.a.rev, S.revA, approveIn);
    expect(ap.status).toBe('approved');
    S.asA = asId;
  });

  it('report issue through the application role is refused for a non-approved revision or a non-issuing role', async () => {
    const { assessmentId, revId } = await inReview([S.samples[1]]);
    const ins = (actor: any, rev: string, as: string, by: string) => withActor(actor, (tx) => tx.query(`insert into reports (tenant_id,client_id,assessment_id,assessment_revision_id,version,status,content_html,content_hash,generated_by)
      select tenant_id, client_id, $2, id, 50, 'issued', 'x', 'x', $3 from assessment_revisions where id=$1`, [rev, as, by]));
    await expect(ins(w.a.prac, revId, assessmentId, w.a.prac.userId)).rejects.toThrow(/not an approved revision/);
    await expect(ins(w.a.prac, S.revA, S.asA, w.a.tech.userId)).rejects.toThrow(/issuer must be/);
    await expect(ins(w.a.prac, S.revA, assessmentId, w.a.prac.userId)).rejects.toThrow(/not an approved revision of this assessment/);
  });

  it('a laboratory amendment cannot commit between the approval check and the approval (evidence is share-locked)', async () => {
    const { revId } = await inReview([S.samples[1]]);
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL }); await app.connect();
    await app.query('begin');
    await app.query(`select set_config('app.tenant_id',$1,true), set_config('app.client_id','',true), set_config('app.pii','off',true), set_config('app.user_id',$2,true)`, [w.A.tenant.id, w.a.rev.userId]);
    await app.query('select id from sampling_events where id = any($1) for share', [[S.samples[1]]]); // what approve() holds
    let amended = false;
    const amend = lab.recordResult(w.a.prac, { sampling_event_id: S.samples[1], substance_id: S.sub, value: '50', unit: 'ug', qualifier: '=', lod: '5', amendment_reason: 'Transcription correction from lab' }).then(() => { amended = true; });
    await new Promise((r) => setTimeout(r, 400));
    expect(amended).toBe(false);
    await app.query('commit'); await app.end();
    await amend;
    // After the amendment the approval sees changed evidence and refuses until recalculated.
    await expect(asmt.approve(w.a.rev, revId, approveIn)).rejects.toThrow(/changed since the calculation/);
  });
});

describe('administrative and professional authority', () => {
  it('a method approval without scope or signed evidence is refused, also at database level', async () => {
    await expect(recordMethodReview(URL_, { ...APPROVE, scope: '' })).rejects.toThrow(/--scope/);
    await expect(recordMethodReview(URL_, { ...APPROVE, evidenceFile: undefined })).rejects.toThrow(/--evidence-file/);
    const c = await admin();
    await expect(c.query(`insert into method_reviews (calc_code,calc_version,status,reviewer_name,reviewer_competence,reviewed_on,evidence_ref,recorded_by)
      values ('twa_8h',$1,'approved','X','Y',$2,'Z','Op')`, [TWA, yesterday])).rejects.toThrow(/approval_evidence/);
    await c.end();
  });

  it('pilot level cannot be set without a recorded authorisation, even by the owner connection', async () => {
    const c = await admin();
    await expect(c.query(`update tenants set assurance_level='pilot' where id=$1`, [w.B.tenant.id])).rejects.toThrow(/no recorded pilot authorisation/);
    await c.end();
    await expect(setTenantLevel(URL_, w.B.tenant.id, 'pilot', 'H2 Operator', 'H2')).rejects.toThrow(/No recorded pilot authorisation/);
  });

  it('withdrawal blocks new use, leaves approved revisions and their provenance intact, and identifies them for review', async () => {
    await recordPilotAuthorisation(URL_, { tenantId: w.A.tenant.id, scopeRef: 'H2-SCOPE', provider: 'H2 Director', organisation: 'H2 Client', authorisedOn: yesterday, document: 'H2-G11', documentFile: EVIDENCE, recordedBy: 'H2 Operator' });
    await recordMethodReview(URL_, APPROVE);
    await setTenantLevel(URL_, w.A.tenant.id, 'pilot', 'H2 Operator', 'H2-G11');
    const { assessmentId, revId } = await inReview([S.samples[0]]);
    const ap = await asmt.approve(w.a.rev, revId, approveIn);
    expect(ap).toMatchObject({ method_review_status: 'approved', assurance_level_at_approval: 'pilot', benchmark_provenance: 'professional_reference' });
    await rep.generateReport(w.a.prac, assessmentId, revId);
    await recordMethodReview(URL_, { ...APPROVE, status: 'withdrawn', evidence: 'H2-WITHDRAWAL', evidenceFile: undefined, scope: undefined });
    // New use blocked: no new pilot conclusion, no further report issue for the withdrawn version.
    const second = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: S.sub, plan_id: S.plan.id, title: 'H2 after withdrawal', assessment_question: 'Is new use blocked after this change?' });
    await asmt.updateDraft(w.a.prac, second.revision.id, { ...S.draft, sample_ids: [S.samples[0]] });
    await asmt.calculate(w.a.prac, second.revision.id);
    await expect(asmt.submitForReview(w.a.prac, second.revision.id)).rejects.toThrow(/withdrawn/);
    await expect(rep.generateReport(w.a.prac, assessmentId, revId)).rejects.toThrow(/since been withdrawn/);
    // History intact and flagged.
    const d = await asmt.assessmentDetail(w.a.prac, assessmentId);
    expect(d.approved.method_review_status).toBe('approved');
    expect(d.staleApproved.join(' ')).toMatch(/now "withdrawn"/);
    const impact = await methodImpact(URL_, 'twa_8h', TWA);
    expect(impact.some((x) => x.assessment === d.assessment.title && x.issued_reports >= 1)).toBe(true);
  });

  it('an expired approval no longer permits new use', async () => {
    await recordMethodReview(URL_, { ...APPROVE, reviewedOn: '2026-01-01', expiresOn: '2026-06-01' });
    const c = await admin();
    expect((await c.query('select method_status_effective($1,$2) s', ['twa_8h', TWA])).rows[0].s).toBe('expired');
    await c.end();
    const third = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: S.sub, plan_id: S.plan.id, title: 'H2 expired', assessment_question: 'Is new use blocked after this change?' });
    await asmt.updateDraft(w.a.prac, third.revision.id, { ...S.draft, sample_ids: [S.samples[0]] });
    await asmt.calculate(w.a.prac, third.revision.id);
    await expect(asmt.submitForReview(w.a.prac, third.revision.id)).rejects.toThrow(/expired/);
    await recordMethodReview(URL_, NOT_REVIEWED);
  });
});

describe('field recovery key versions', () => {
  async function seal(spki: string, attest: string, kv: number, rec: object) {
    const subtle = globalThis.crypto.subtle;
    const pub = await subtle.importKey('spki', Buffer.from(spki, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const rk = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, rk, new TextEncoder().encode(JSON.stringify(rec)));
    const wk = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, await subtle.exportKey('raw', rk));
    const b = (x: ArrayBuffer | Uint8Array) => Buffer.from(x as ArrayBuffer).toString('base64');
    const e = { v: 1, kv, wk: b(wk), iv: b(iv), ct: b(ct) };
    return { ...e, mac: createHmac('sha256', Buffer.from(attest, 'base64')).update(`${e.kv}.${e.wk}.${e.iv}.${e.ct}`).digest('base64') };
  }
  const fileOf = (records: any[]) => JSON.stringify({ format: 'ohea-field-recovery', version: 1, tenant_id: w.A.tenant.id, user_id: w.a.tech.userId, exported_at: new Date().toISOString(), records });
  it('replacement is all-or-nothing, keeps old versions importable, and rejects unknown versions without loss', async () => {
    const { activeRecoveryKey, attestKeyFor, importRecoveryFile } = await import('../src/services/recovery.js');
    const v1 = await withActor(w.a.tech, (tx) => activeRecoveryKey(tx, w.A.tenant.id));
    const rec = (code: string) => ({ tenant_id: w.A.tenant.id, user_id: w.a.tech.userId, client_uuid: randomUUID(), server_id: null, base_version: null, payload: S.payload(code, '2026-03-09') });
    // A device that never reconnects keeps an envelope sealed to v1.
    const oldEnv = await seal(v1.spki, attestKeyFor(v1, w.A.tenant.id, w.a.tech.userId), v1.version, rec(`H2K1-${w.tag}`));
    // Interrupted replacement: nothing changes.
    await expect(replaceRecoveryKey(URL_, w.A.tenant.id, 'H2 Operator', 'test', { simulateFailureAfterDeactivate: true })).rejects.toThrow(/simulated/);
    expect((await withActor(w.a.tech, (tx) => activeRecoveryKey(tx, w.A.tenant.id))).version).toBe(v1.version);
    await expect(replaceRecoveryKey(URL_, w.A.tenant.id, '', 'x')).rejects.toThrow(/authorised-by/);
    const r = await replaceRecoveryKey(URL_, w.A.tenant.id, 'H2 Operator', 'Scheduled replacement test');
    const v2 = await withActor(w.a.tech, (tx) => activeRecoveryKey(tx, w.A.tenant.id));
    expect(v2.version).toBe(r.version);
    expect(v2.spki).not.toBe(v1.spki);
    const newEnv = await seal(v2.spki, attestKeyFor(v2, w.A.tenant.id, w.a.tech.userId), v2.version, rec(`H2K2-${w.tag}`));
    const unknown = { ...newEnv, kv: 99 };
    const crossed = await seal(v2.spki, attestKeyFor(v1, w.A.tenant.id, w.a.tech.userId), v2.version, rec(`H2K3-${w.tag}`)); // attested with the wrong version
    const out = await importRecoveryFile(w.a.prac, fileOf([oldEnv, newEnv, unknown, crossed]));
    expect(out.results.map((x) => x.outcome)).toEqual(['created', 'created']);
    expect(out.undecryptable).toEqual([3, 4]);
  });
});

describe('future-time checks on every field and custody time (finding R-L7)', () => {
  it('refuses future interruption, handover, dispatch and receipt times', async () => {
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
    const base = S.payload(`H2T-${w.tag}`, '2026-03-10');
    const [i] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { ...base, interruptions: [{ start: '2026-03-10T10:00', end: later, reason: 'x' }] } }]);
    expect(i.outcome).toBe('rejected'); expect(i.message).toMatch(/end|future/i);
    const [h] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { ...base, sample_code: `H2T2-${w.tag}`, handover_to: 'Lab courier', handover_local: later } }]);
    expect(h.outcome).toBe('rejected'); expect(h.message).toMatch(/Handover time .* future/);
    const [fresh] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { ...base, sample_code: `H2T3-${w.tag}` } }]);
    expect(fresh.outcome).toBe('created');
    await expect(lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `H2F-${w.tag}`, sample_ids: [fresh.server_id], dispatched_at: later })).rejects.toThrow(/Dispatch time .* future/);
    await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `H2F-${w.tag}`, sample_ids: [fresh.server_id], dispatched_at: '2026-03-11T09:00' });
    const sub = (await lab.listSubmissions(w.a.prac)).find((x) => x.reference === `H2F-${w.tag}`);
    await expect(lab.receiveSubmission(w.a.prac, sub.id, { received_at: later, received_condition: 'Intact' })).rejects.toThrow(/Receipt time .* future/);
  });
});

describe('cross-tenant and worker-record access remain closed for the new tables', () => {
  it('another organisation sees none of the holds, intake records or authorisations', async () => {
    const q = (sql: string) => withActor(w.b.prac, (tx) => tx.query(sql)).then((r) => r.rowCount);
    expect(await q('select 1 from field_intake_holds')).toBe(0);
    expect(await q('select 1 from assessment_holds')).toBe(0);
    expect(await q('select 1 from pilot_authorisations')).toBe(0);
    expect(await q(`select 1 from attachments where quarantined`)).toBe(0);
    await expect(withActor(w.b.prac, (tx) => tx.query(`insert into assessment_holds (tenant_id, assessment_id, reason, placed_by) values ($1,$2,'xxxxx','me')`, [w.B.tenant.id, S.asA]))).rejects.toThrow(/permission denied/);
    await expect(withActor(w.a.admin, (tx) => tx.query(`insert into pilot_authorisations (tenant_id, scope_ref, authorised_by_provider, authorised_by_organisation, authorised_on, document_ref, document_sha256, recorded_by) values ($1,'x','a','b','2026-01-01','d',$2,'c')`, [w.A.tenant.id, 'a'.repeat(64)]))).rejects.toThrow(/permission denied/);
  });
  it('field technicians still cannot read worker names in holds or samples', async () => {
    const r = await withActor(w.a.tech, (tx) => tx.query('select full_name from worker_identities'));
    expect(r.rowCount).toBe(0);
  });
});

describe('independent review R2 findings', () => {
  it('C2: the application role cannot clear a suspension flag, self-admit, or un-quarantine', async () => {
    // A flagged sample (from the replay test) — direct clearing by the capturer, or removing the flag, is refused.
    const c = await admin();
    await c.query('update sampling_events set suspension_review_required=true where id=$1', [S.samples[1]]); // owner sets a fresh flag for the test
    await c.end();
    const direct = (actor: any, sql: string, p: unknown[]) => withActor(actor, (tx) => tx.query(sql, p));
    await expect(direct(w.a.prac, 'update sampling_events set suspension_review_required=false where id=$1', [S.samples[1]])).rejects.toThrow(/cannot be removed/);
    await expect(direct(w.a.tech, 'update sampling_events set suspension_reviewed_by=$2, suspension_reviewed_at=now() where id=$1', [S.samples[1], w.a.tech.userId])).rejects.toThrow(/practitioner or technical reviewer|someone other/);
    await expect(direct(w.a.prac, 'update sampling_events set suspension_reviewed_by=$2, suspension_reviewed_at=now() where id=$1', [S.samples[1], w.a.rev.userId])).rejects.toThrow(/signed-in user/);
    await field.clearSuspensionReview(w.a.prac, S.samples[1], { notes: 'Checked for the review-finding test' });
    await expect(direct(w.a.rev, 'update sampling_events set suspension_reviewed_at=now() + interval \'1 day\' where id=$1', [S.samples[1]])).rejects.toThrow(/recorded once/);
    // Attachments: quarantine flip and self-admission refused; inserting an ordinary row while suspended refused.
    await suspendWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'SC3 C2 test', 'H2 Operator');
    const q = await att.saveAttachment(w.a.prac, { entity_type: 'sampling_event', entity_id: S.samples[0], filename: 'c2.txt', data: Buffer.from('c2'), intake: { reason: 'Evidence for the C2 test case' } });
    await expect(direct(w.a.prac, 'update attachments set quarantined=false where id=$1', [q.id])).rejects.toThrow(/cannot be changed/);
    await expect(direct(w.a.prac, `insert into attachments (tenant_id,client_id,entity_type,entity_id,filename,mime_type,size_bytes,sha256,storage_key,uploaded_by)
      select tenant_id, client_id, 'sampling_event', $1, 'x.txt', 'text/plain', 1, 'x', 'k', $2 from sampling_events where id=$1`, [S.samples[0], w.a.prac.userId])).rejects.toThrow(/is suspended/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'H2 Operator', 'H2-REVAL');
    await expect(direct(w.a.prac, 'update attachments set admitted_by=$2, admitted_at=now() where id=$1', [q.id, w.a.prac.userId])).rejects.toThrow(/technical reviewer other than the uploader/);
    // A quarantined file cannot be linked as calibration evidence either.
    await expect(inst.recordCalibration(w.a.prac, S.pump.id, { performed_at: '2026-02-01', valid_until: '2027-02-01', outcome: 'pass', attachment_id: q.id })).rejects.toThrow(/quarantined/);
  });

  it('M2: neither the submitter of a held record nor the original capturer can clear it', async () => {
    await suspendWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'SC3 M2 test', 'H2 Operator');
    const cu = randomUUID();
    const payload = S.payload(`H2M2-${w.tag}`, '2026-03-12');
    await field.syncBatch(w.a.prac, [{ client_uuid: cu, server_id: null, base_version: null, payload }]); // practitioner submits during suspension
    await resumeWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'H2 Operator', 'H2-REVAL');
    const [r] = await field.syncBatch(w.a.prac, [{ client_uuid: cu, server_id: null, base_version: null, payload }]);
    expect(r.outcome).toBe('created');
    await expect(field.clearSuspensionReview(w.a.prac, r.server_id!, { notes: 'Clearing my own record' })).rejects.toThrow(/[Ss]omeone other than/);
    await expect(withActor(w.a.prac, (tx) => tx.query('update sampling_events set suspension_reviewed_by=$2, suspension_reviewed_at=now() where id=$1', [r.server_id, w.a.prac.userId]))).rejects.toThrow(/[Ss]omeone other than/);
    await field.clearSuspensionReview(w.a.rev, r.server_id!, { notes: 'Checked by the reviewer' });
  });

  it('H2/M3: a held update that becomes a conflict, and a pending held update, both block approval until reviewed', async () => {
    // Held update to an existing sample.
    const target = S.samples[0];
    const cur = (await field.sampleDetail(w.a.prac, target)).event;
    await suspendWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'SC3 H2 test', 'H2 Operator');
    const changed = { ...S.payload(`H2S-${w.tag}-0`, '2026-03-02'), notes: 'Edited offline during suspension' };
    await field.syncBatch(w.a.tech, [{ client_uuid: cur.client_uuid, server_id: target, base_version: 1, payload: changed }]);
    await resumeWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'H2 Operator', 'H2-REVAL');
    // While the hold is pending, an assessment using the sample cannot be submitted.
    const { revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: S.sub, plan_id: S.plan.id, title: 'H2 held update', assessment_question: 'Does a held update block use?' });
    await asmt.updateDraft(w.a.prac, revision.id, { ...S.draft, sample_ids: [target] });
    await asmt.calculate(w.a.prac, revision.id);
    await expect(asmt.submitForReview(w.a.prac, revision.id)).rejects.toThrow(/during a suspension/);
    // On reconnect it becomes a conflict (sample already analysed); applying the device copy flags the sample.
    const [cr] = await field.syncBatch(w.a.tech, [{ client_uuid: cur.client_uuid, server_id: target, base_version: 1, payload: changed }]);
    expect(cr.outcome).toBe('conflict');
    const holds = await field.listSuspensionHolds(w.a.prac);
    expect(holds.held.find((h) => h.client_uuid === cur.client_uuid)?.status).toBe('in_conflict');
  });

  it('M4: placing a hold waits for an in-flight approval check (assessment row share-locked)', async () => {
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL }); await app.connect();
    await app.query('begin');
    await app.query(`select set_config('app.tenant_id',$1,true), set_config('app.client_id','',true), set_config('app.user_id',$2,true)`, [w.A.tenant.id, w.a.rev.userId]);
    await app.query('select 1 from assessments where id=$1 for share', [S.asA]);
    let placed = false;
    const p = holdAssessment(URL_, S.asA, 'M4 race test hold', 'H2 Operator').then(() => { placed = true; });
    await new Promise((r) => setTimeout(r, 400));
    expect(placed).toBe(false);
    await app.query('commit'); await app.end();
    await p;
    await releaseAssessment(URL_, S.asA, 'H2 Operator', 'M4-REVAL');
  });

  it('M6: a revoked key version stops opening recovery files; MAC binds the version', async () => {
    const { activeRecoveryKey, attestKeyFor, importRecoveryFile, envelopeMac } = await import('../src/services/recovery.js');
    const k = await withActor(w.a.tech, (tx) => activeRecoveryKey(tx, w.A.tenant.id));
    const subtle = globalThis.crypto.subtle;
    const pub = await subtle.importKey('spki', Buffer.from(k.spki, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const rk = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const rec = { tenant_id: w.A.tenant.id, user_id: w.a.tech.userId, client_uuid: randomUUID(), server_id: null, base_version: null, payload: S.payload(`H2M6-${w.tag}`, '2026-03-13') };
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, rk, new TextEncoder().encode(JSON.stringify(rec)));
    const wk = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, await subtle.exportKey('raw', rk));
    const b = (x: ArrayBuffer | Uint8Array) => Buffer.from(x as ArrayBuffer).toString('base64');
    const env: any = { v: 1, kv: k.version, wk: b(wk), iv: b(iv), ct: b(ct) };
    env.mac = envelopeMac(attestKeyFor(k, w.A.tenant.id, w.a.tech.userId), env);
    const relabelled = { ...env, kv: k.version + 50 };
    const f = (records: any[]) => JSON.stringify({ format: 'ohea-field-recovery', version: 1, tenant_id: w.A.tenant.id, user_id: w.a.tech.userId, exported_at: new Date().toISOString(), records });
    await replaceRecoveryKey(URL_, w.A.tenant.id, 'H2 Operator', 'Suspected compromise (test)', { revokePrevious: true });
    const out = await importRecoveryFile(w.a.prac, f([env, relabelled]));
    expect(out.undecryptable).toEqual([1, 2]);
  });

  it('Low: method-review ordering inside one transaction, and pilot authorisations are append-only', async () => {
    const c = await admin();
    await c.query('begin');
    await c.query(`insert into method_reviews (calc_code,calc_version,status,reviewer_name,reviewer_competence,reviewed_on,evidence_ref,recorded_by) values ('stel_15',$1,'rejected','R','C','2026-01-01','E','x')`, [CALCULATIONS.stel_15.version]);
    await c.query(`insert into method_reviews (calc_code,calc_version,status,recorded_by) values ('stel_15',$1,'not_reviewed','x')`, [CALCULATIONS.stel_15.version]);
    expect((await c.query('select method_status_effective($1,$2) s', ['stel_15', CALCULATIONS.stel_15.version])).rows[0].s).toBe('not_reviewed');
    await c.query('rollback');
    const pa = (await c.query('select id from pilot_authorisations where tenant_id=$1 and withdrawn_at is null limit 1', [w.A.tenant.id])).rows[0];
    await expect(c.query(`update pilot_authorisations set scope_ref='changed' where id=$1`, [pa.id])).rejects.toThrow(/append-only/);
    await c.end();
  });
});

describe('independent review R2 re-check (N1–N6)', () => {
  beforeAll(async () => { await recordMethodReview(URL_, APPROVE); }); // organisation A is at pilot level by now
  const direct = (actor: any, sql: string, p: unknown[] = []) => withActor(actor, (tx) => tx.query(sql, p));
  it('N1/N3: held records cannot be edited directly; a stale hold is dismissed by someone else and unblocks the sample', async () => {
    const holds = await field.listSuspensionHolds(w.a.prac);
    const h = holds.held.find((x) => x.status === 'in_conflict');
    expect(h).toBeTruthy();
    await expect(direct(w.a.prac, `update field_intake_holds set status='synchronised' where id=$1`, [h.id])).rejects.toThrow(/flagged for review|hold refused/);
    await expect(direct(w.a.prac, `update field_intake_holds set submitted_by=$2 where id=$1`, [h.id, w.a.rev.userId])).rejects.toThrow(/cannot be changed/);
    await expect(direct(w.a.prac, `delete from field_intake_holds where id=$1`, [h.id])).rejects.toThrow(/permission denied|append-only|cannot/i);
    await expect(field.dismissHold(w.a.tech, h.id, { notes: 'Device was reset by the site' })).rejects.toThrow(/permission/);
    await field.dismissHold(w.a.prac, h.id, { notes: 'Device was reset; the held edit is obsolete' });
    // The assessment from the held-update test can now be submitted.
    const r = (await direct(w.a.prac, `select r.id from assessment_revisions r join assessments a on a.id=r.assessment_id where a.title='H2 held update' and r.status='draft'`)).rows[0];
    await asmt.calculate(w.a.prac, r.id);
    await asmt.submitForReview(w.a.prac, r.id);
  });
  it('N2: an attachment cannot be moved to another record or have its content swapped', async () => {
    const a1 = await att.saveAttachment(w.a.prac, { entity_type: 'assessment', entity_id: S.asA, filename: 'n2.txt', data: Buffer.from('n2') });
    await expect(direct(w.a.prac, `update attachments set entity_type='sampling_event', entity_id=$2 where id=$1`, [a1.id, S.samples[0]])).rejects.toThrow(/cannot be changed/);
    await expect(direct(w.a.prac, `update attachments set sha256='x', storage_key='y' where id=$1`, [a1.id])).rejects.toThrow(/cannot be changed/);
  });
  it('N4/N5/N6: calibrations are not editable; approval time and transitions are fixed; other organisations\' suspension state is not readable', async () => {
    await expect(direct(w.a.prac, `update calibrations set outcome='pass'`)).rejects.toThrow(/permission denied/);
    const { revId } = await inReview([S.samples[0]]);
    await expect(direct(w.a.prac, `update assessment_revisions set status='withdrawn' where id=$1`, [revId])).rejects.toThrow(/not a permitted transition/);
    const ap = (await direct(w.a.rev, `update assessment_revisions set status='approved', reviewer_id=$2, approved_at='2020-01-01', approval_scope='Direct test scope', approval_limitations='Direct test', snapshot_hash='x' where id=$1 returning approved_at`, [revId, w.a.rev.userId]).catch((e) => e));
    // A direct approval meeting every rule goes through, but the approval time is the database's, not the writer's.
    expect(ap).not.toBeInstanceOf(Error);
    expect(Math.abs(new Date(ap.rows[0].approved_at).getTime() - Date.now())).toBeLessThan(60_000);
    const other = (await direct(w.a.prac, 'select workflow_suspended($1, $2) s', [w.B.tenant.id, 'field_sync'])).rows[0].s;
    expect(other).toBe(true);
  });
});

describe('R2 final re-check', () => {
  it('a held conflict cannot be repointed to another sample', async () => {
    const c = await admin();
    const h = (await c.query(`select id, tenant_id from field_intake_holds where status='dismissed' limit 1`)).rows[0];
    await c.end();
    // Final holds cannot change at all; same-status changes are refused for any hold.
    await expect(withActor(w.a.prac, (tx) => tx.query(`update field_intake_holds set sampling_event_id=$2 where id=$1`, [h.id, S.samples[1]]))).rejects.toThrow(/hold refused/);
  });
});

describe('remaining low findings (19 Oct, evening)', () => {
  it('R-X1: separation checks compare normalised names (order, case, accents, punctuation)', async () => {
    const { samePerson } = await import('../scripts/identity.js');
    expect(samePerson('Smith, Jane', 'jane  SMITH')).toBe(true);
    expect(samePerson('王伟', '李娜')).toBe(false);
    expect(samePerson('王伟', ' 王伟 ')).toBe(true);
    expect(samePerson('Zoë O’Brien', 'zoe obrien')).toBe(true);
    expect(samePerson('Jane Smith', 'J. Smith')).toBe(false); // different spellings are not detected (documented)
    expect(samePerson('Zoë Brien', 'zoe brien')).toBe(true);
    await expect(recordMethodReview(URL_, { ...APPROVE, reviewer: 'Operator, H2', recordedBy: 'h2 operator' })).rejects.toThrow(/cannot be the reviewer/);
    await expect(recordPilotAuthorisation(URL_, { tenantId: w.B.tenant.id, scopeRef: 'X', provider: 'Ann Lee', organisation: 'lee, ann', authorisedOn: yesterday, document: 'D', documentFile: EVIDENCE, recordedBy: 'Op' })).rejects.toThrow(/different people/);
  });
  it('R-L4: the alert de-duplication map stays bounded', async () => {
    const { sendAlert, alertDedupeSize } = await import('../src/alerts.js');
    const warn = console.warn; console.warn = () => {};
    try { for (let i = 0; i < 5200; i++) await sendAlert('auth.ip_throttled', {}, `ip-${i}`); } finally { console.warn = warn; }
    expect(alertDedupeSize()).toBeLessThanOrEqual(5000);
  });
  it('R2-M7 residual: instrument maintenance is refused while field sync is suspended', async () => {
    await suspendWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'SC3 maintenance test', 'H2 Operator');
    await expect(inst.recordMaintenance(w.a.prac, S.pump.id, { at: '2026-03-01', kind: 'Service', notes: 'x' })).rejects.toThrow(/suspended/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['field_sync'], 'H2 Operator', 'H2-REVAL');
  });
});
