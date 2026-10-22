// TR-08: the effective evidence set (selected samples + removals awaiting a reviewer's confirmation) is used by every
// approval safeguard. Runs through the application services and the database roles of normal users. The same scenario
// functions produced the before-fix evidence on b5eb070 (docs/remediation/tr08.before-b5eb070.json).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withActor } from '../src/db.js';
import * as field from '../src/services/field.js';
import * as asmt from '../src/services/assessments.js';
import { resumeWorkflows, suspendWorkflows } from '../scripts/platform-controls.js';
import { updateDraftConfirmed } from './fixtures.js';
import * as T from './tr08-scenarios.js';

let S: any;
const URL_ = () => process.env.DATABASE_ADMIN_URL!;
const approveIn = { approval_scope: 'TR-08 test scope only', approval_limitations: 'Synthetic test data only', confirm_reviewed: 'on' };
const draftBase = () => ({ benchmark_version_id: S.w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
  interpretation: 'Synthetic TR-08 scenario; one full-shift result below the synthetic benchmark.', conclusion_category: 'insufficient_evidence', limitations: 'Synthetic test data only.' });
const admin = async () => { const c = new pg.Client({ connectionString: URL_() }); await c.connect(); return c; };
/** A direct approval through the application role (as the reviewer), to show the database trigger's own decision. */
const directApprove = (revId: string) => withActor(S.w.a.rev, (tx) => tx.query(`update assessment_revisions set status='approved', reviewer_id=$2, approval_scope='Direct write test', approval_limitations='Direct write test', snapshot_hash=repeat('a',64) where id=$1`, [revId, S.w.a.rev.userId]));
const holdOn = async (x: any) => {
  await suspendWorkflows(URL_(), S.w.A.tenant.id, ['field_sync'], 'TR-08 test', 'TR-08 Operator');
  await field.syncBatch(S.w.a.tech, [{ client_uuid: x.client_uuid, server_id: x.id, base_version: 1, payload: { ...x.payload, notes: `Edited offline during suspension ${Math.random()}` } }]);
  await resumeWorkflows(URL_(), S.w.A.tenant.id, ['field_sync'], 'TR-08 Operator', 'T8-REVAL');
};
const inReviewWithPending = async (title: string) => {
  const keep = await T.sample(S, { day: 11 + S.n % 15 }), x = await T.sample(S, { day: 12 + S.n % 15 });
  const { assessmentId, revId } = await T.withPendingRemoval(S, keep.id, x.id, title);
  await asmt.calculate(S.w.a.prac, revId);
  await asmt.submitForReview(S.w.a.prac, revId);
  return { keep, x, assessmentId, revId };
};

beforeAll(async () => { S = await T.setup(); }, 120000);
afterAll(async () => { await closePool(); });

describe('TR-08 safeguards over the effective evidence set', () => {
  it('a held sample with a pending removal stays effective evidence and blocks submission', async () => {
    const r = await T.heldSample(S);
    expect(r.inCalculation).toBe(true);
    expect(r.submit).toMatch(/refused: .*removal requested but not confirmed.*during a suspension/);
  });
  it('… and blocks approval when the hold appears after submission (service and database trigger)', async () => {
    const { x, revId } = await inReviewWithPending('TR-08 held after submit');
    await holdOn(x);
    await expect(asmt.approve(S.w.a.rev, revId, approveIn)).rejects.toThrow(/during a suspension/);
    await expect(directApprove(revId)).rejects.toThrow(/field records received during a suspension/);
  });
  it('a sample awaiting suspension review with a pending removal keeps the review requirement (submission, approval, trigger)', async () => {
    const r = await T.suspensionReview(S);
    expect(r.submit).toMatch(/refused: .*during a suspension/);
    const { x, revId } = await inReviewWithPending('TR-08 flag after submit');
    const c = await admin(); await c.query('update sampling_events set suspension_review_required=true where id=$1', [x.id]); await c.end();
    await expect(asmt.approve(S.w.a.rev, revId, approveIn)).rejects.toThrow(/during a suspension/);
    await expect(directApprove(revId)).rejects.toThrow(/field records received during a suspension/);
  });
  it('the approver who recorded a QC disposition for a sample awaiting removal confirmation cannot approve (service and trigger)', async () => {
    const r = await T.reviewerQcDisposition(S);
    expect(r.qcDispositionByApprover).toBe('succeeded');
    expect(r.approve).toMatch(/refused: You recorded a QC disposition .*awaiting removal confirmation/);
    const rev = (await withActor(S.w.a.prac, (tx) => tx.query(`select r.id from assessment_revisions r join assessments a on a.id=r.assessment_id where a.title='TR-08 QC disposition' and r.status='in_review'`))).rows[0];
    await expect(directApprove(rev.id)).rejects.toThrow(/reviewer recorded a QC disposition/);
  });
  it('control: the independence restriction also applies to a selected sample', async () => {
    const x = await T.sample(S, { day: 26, qcFail: true });
    const qc = (await field.sampleDetail(S.w.a.prac, x.id)).qc.find((q: any) => q.outcome === 'fail');
    await field.disposeQcFailure(S.w.a.rev, qc.id, { disposition: 'accepted_with_justification', reason: 'Reviewer accepts: flow check within tolerance on re-test' });
    const { revision } = await asmt.createAssessment(S.w.a.prac, { group_id: S.group.id, substance_id: S.w.ref.substanceId, plan_id: S.plan.id, title: 'TR-08 selected QC', assessment_question: 'Is exposure adequately controlled for the TR-08 group?' });
    await updateDraftConfirmed(S.w.a.prac, revision.id, { ...draftBase(), sample_ids: [x.id] });
    await asmt.calculate(S.w.a.prac, revision.id); await asmt.submitForReview(S.w.a.prac, revision.id);
    await expect(asmt.approve(S.w.a.rev, revision.id, approveIn)).rejects.toThrow(/You recorded a QC disposition/);
  });
});

describe('TR-08 concurrency (coordinated transactions; sequence captured)', () => {
  it('a laboratory amendment of a pending-removal sample waits until the approval has committed', async () => {
    const r = await T.concurrentAmendment(S);
    expect(r.inCalculation).toBe(true);
    expect(r.blockedByApproval).toBe(true);
    expect(r.sequence).toEqual(['controller holds the previously approved revision row', 'approval paused after its evidence check (waiting to supersede r1)', 'amendment started',
      'amendment is waiting for a lock held by the approval', 'controller released the row', 'approval finished: succeeded', 'amendment finished: succeeded']);
    expect(r.evidenceChangedBeforeApprovalCommitted).toBe(false);
  });
  it('a calibration change for the pending-removal sample\'s instrument waits until the approval has committed', async () => {
    const r = await T.concurrentCalibration(S);
    expect(r.blockedByApproval).toBe(true);
    expect(r.sequence.indexOf('approval finished: succeeded')).toBeLessThan(r.sequence.indexOf('calibration finished: succeeded'));
  });
  it('an amendment committed before the approval\'s check makes the approval fail on freshness', async () => {
    const { x, revId } = await inReviewWithPending('TR-08 amended before approval');
    const lab = await import('../src/services/lab.js');
    await lab.recordResult(S.w.a.prac, { sampling_event_id: x.id, substance_id: S.w.ref.substanceId, value: '900', unit: 'ug', qualifier: '=', lod: '1', loq: '3', amendment_reason: 'Laboratory re-issue (TR-08 freshness)' });
    await expect(asmt.approve(S.w.a.rev, revId, approveIn)).rejects.toThrow(/changed since the calculation/);
  });
  it('writer path: placing a held record on a sample waits for an in-flight approval check', async () => {
    const { x, revId } = await inReviewWithPending('TR-08 hold placement race');
    await suspendWorkflows(URL_(), S.w.A.tenant.id, ['field_sync'], 'TR-08 race', 'TR-08 Operator');
    const obs = await admin();
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL }); await app.connect();
    await app.query('begin');
    await app.query(`select set_config('app.tenant_id',$1,true), set_config('app.client_id','',true), set_config('app.user_id',$2,true)`, [S.w.A.tenant.id, S.w.a.rev.userId]);
    const eff = (await app.query('select assessment_effective_sample_ids($1) e', [revId])).rows[0].e;
    expect(eff).toContain(x.id);
    await app.query('select id from sampling_events where id = any($1) order by id for share', [eff]); // what the approval holds
    let placed: string | null = null;
    const p = T.attempt(() => field.syncBatch(S.w.a.tech, [{ client_uuid: x.client_uuid, server_id: x.id, base_version: 1, payload: { ...x.payload, notes: 'Held during the race test' } }])).then((v) => { placed = v; });
    await T.waitFor(async () => placed !== null || (await T.lockWaiters(obs)).some((b) => /for no key update/.test(b.query)), 'hold placement waiting or done');
    expect(placed).toBeNull();
    await app.query('commit'); await app.end();
    await p; await obs.end();
    expect(placed).toBe('succeeded');
    await resumeWorkflows(URL_(), S.w.A.tenant.id, ['field_sync'], 'TR-08 Operator', 'T8-REVAL');
    await expect(asmt.approve(S.w.a.rev, revId, approveIn)).rejects.toThrow(/during a suspension/);
  });
});

describe('TR-08 removal workflow and resolver', () => {
  it('a reviewer\'s confirmation takes the sample out of the effective evidence (and its hold no longer blocks)', async () => {
    const keep = await T.sample(S, { day: 27 }), x = await T.sample(S, { day: 28 });
    const { revId } = await T.withPendingRemoval(S, keep.id, x.id, 'TR-08 confirmed removal');
    await holdOn(x);
    await expect(asmt.calculate(S.w.a.prac, revId).then(() => asmt.submitForReview(S.w.a.prac, revId))).rejects.toThrow(/during a suspension/);
    await asmt.confirmSampleRemoval(S.w.a.rev, revId, { sample_id: x.id, reason: 'Reviewer: this sample is outside the scope of the TR-08 question' });
    const ev = await withActor(S.w.a.prac, async (tx) => asmt.resolveEvidence(tx, (await tx.query('select id, sample_ids from assessment_revisions where id=$1', [revId])).rows[0]));
    expect(ev).toEqual({ selected: [keep.id], pending: [], effective: [keep.id] });
    const out = (await asmt.calculate(S.w.a.prac, revId)).calc_output;
    expect(out.samples.map((s: any) => s.sampleCode)).toEqual([keep.code]);
    await asmt.submitForReview(S.w.a.prac, revId);
    expect((await asmt.approve(S.w.a.rev, revId, approveIn)).status).toBe('approved');
  });
  it('a re-added sample removed again is pending: the earlier confirmation does not authorise the new request', async () => {
    const keep = await T.sample(S, { day: 29 }), x = await T.sample(S, { day: 30 });
    const { revId } = await T.withPendingRemoval(S, keep.id, x.id, 'TR-08 re-added');
    S.revWithRemovals = { revId, x: x.id };
    await asmt.confirmSampleRemoval(S.w.a.rev, revId, { sample_id: x.id, reason: 'Reviewer confirms the first removal request' });
    await asmt.updateDraft(S.w.a.prac, revId, { ...draftBase(), sample_ids: [keep.id, x.id] });              // re-added
    const readd = await withActor(S.w.a.prac, async (tx) => asmt.resolveEvidence(tx, (await tx.query('select id, sample_ids from assessment_revisions where id=$1', [revId])).rows[0]));
    expect(readd).toEqual({ selected: [keep.id, x.id], pending: [], effective: [keep.id, x.id] });
    await asmt.updateDraft(S.w.a.prac, revId, { ...draftBase(), sample_ids: [keep.id], removal_reason: 'Second removal request after re-adding' });
    const again = await withActor(S.w.a.prac, async (tx) => asmt.resolveEvidence(tx, (await tx.query('select id, sample_ids from assessment_revisions where id=$1', [revId])).rows[0]));
    expect(again).toEqual({ selected: [keep.id], pending: [x.id], effective: [keep.id, x.id] });
    const c = await admin();
    const hist = (await c.query('select action, reason from assessment_sample_removals where revision_id=$1 and sampling_event_id=$2 order by seq', [revId, x.id])).rows;
    await c.end();
    expect(hist.map((h) => h.action)).toEqual(['requested', 'confirmed', 'requested']); // history kept, confirmation evidence kept
    const d = await asmt.assessmentDetail(S.w.a.prac, (await withActor(S.w.a.prac, (tx) => tx.query('select assessment_id from assessment_revisions where id=$1', [revId]))).rows[0].assessment_id);
    expect(d.removals.find((r: any) => r.sampleId === x.id)).toMatchObject({ status: 'pending_reviewer_confirmation', reason: 'Second removal request after re-adding', confirmedBy: null });
  });
  it('resolver: duplicates removed, deterministic order, revision-scoped', async () => {
    const a = await T.sample(S, { day: 1 }), b = await T.sample(S, { day: 2 });
    const c = await admin();
    const { revId, x } = S.revWithRemovals; // has a pending removal of x (previous test)
    const e1 = (await c.query('select assessment_effective_sample_ids($1, $2::uuid[]) e', [revId, [b.id, a.id, b.id]])).rows[0].e;
    const e2 = (await c.query('select assessment_effective_sample_ids($1, $2::uuid[]) e', [revId, [b.id, a.id, b.id]])).rows[0].e;
    const none = (await c.query('select assessment_effective_sample_ids($1, $2::uuid[]) e', [revId, [x, a.id]])).rows[0].e;
    await c.end();
    expect(e1).toEqual([b.id, a.id, x]);   // selected in stored order without duplicates, then the pending removal
    expect(e2).toEqual(e1);
    expect(none).toEqual([x, a.id]);       // re-selected: listed once, as selected
    // Another organisation's user sees nothing of this revision's removals (row-level security applies to the resolver).
    const other = await withActor(S.w.b.prac, (tx) => tx.query('select count(*)::int n from assessment_removal_state($1, $2::uuid[])', [revId, []]));
    expect(other.rows[0].n).toBe(0);
  });
  it('an ordinary assessment without pending removals submits and is approved as before', async () => {
    const x = await T.sample(S, { day: 31 % 30 + 1 });
    const { revision } = await asmt.createAssessment(S.w.a.prac, { group_id: S.group.id, substance_id: S.w.ref.substanceId, plan_id: S.plan.id, title: 'TR-08 ordinary', assessment_question: 'Is exposure adequately controlled for the TR-08 group?' });
    await updateDraftConfirmed(S.w.a.prac, revision.id, { ...draftBase(), sample_ids: [x.id] });
    await asmt.calculate(S.w.a.prac, revision.id);
    await asmt.submitForReview(S.w.a.prac, revision.id);
    const out = await asmt.approve(S.w.a.rev, revision.id, approveIn);
    expect(out.status).toBe('approved');
  });
});
