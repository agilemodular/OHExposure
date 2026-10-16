import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, type World } from './fixtures.js';
import { closePool, getPool, withActor } from '../src/db.js';
import * as reg from '../src/services/register.js';
import * as inst from '../src/services/instruments.js';
import * as plans from '../src/services/plans.js';
import * as field from '../src/services/field.js';
import * as lab from '../src/services/lab.js';
import * as asmt from '../src/services/assessments.js';
import * as ctl from '../src/services/controls.js';
import * as rep from '../src/services/reports.js';
import * as att from '../src/services/attachments.js';
import * as adm from '../src/services/admin.js';
import * as integ from '../src/services/integrations.js';

let w: World;
const S: Record<string, any> = {};

beforeAll(async () => { w = await buildWorld(); });
afterAll(async () => { await closePool(); });

describe('end-to-end vertical workflow (Client One)', () => {
  it('builds the register: site → area → process → task → hazard → group → worker', async () => {
    const { prac } = w.a;
    S.site = await reg.createSite(prac, { client_id: w.A.clients['Client One'], name: 'Fabrication Shop', reference: 'FAB-01' });
    S.area = await reg.createWorkArea(prac, { site_id: S.site.id, name: 'Grinding bay' });
    S.proc = await reg.createProcess(prac, { work_area_id: S.area.id, name: 'Weld dressing' });
    S.task = await reg.createTask(prac, { process_id: S.proc.id, name: 'Disc grinding of welds', duration_min_per_shift: '240', duration_basis: 'recorded_fact' });
    S.hazard = await reg.createHazard(prac, { task_id: S.task.id, substance_id: w.ref.substanceId, physical_form: 'dust', exposure_routes: ['inhalation'], exposure_duration_min: '240' });
    await expect(reg.createGroup(prac, { site_id: S.site.id, name: 'Grinders', rationale: 'too short' })).rejects.toThrow(/rationale/);
    S.group = await reg.createGroup(prac, { site_id: S.site.id, name: 'Grinders', rationale: 'Same task, same tools, same bay and same shift pattern; observed comparable work methods.', task_ids: [S.task.id], hazard_ids: [S.hazard.id] });
    S.worker = await reg.createWorker(prac, { client_id: w.A.clients['Client One'], ref_code: `W-${w.tag}`, full_name: 'Alex Example', employee_number: 'E100' });
    await reg.addMembership(prac, { group_id: S.group.id, worker_id: S.worker.id, valid_from: '2026-01-01' });
    await expect(reg.createSite(w.a.tech, { name: 'nope' })).rejects.toThrow(/permission/);
  });

  it('restricts identifiable worker data to authorised roles (RLS)', async () => {
    const forPrac = await reg.groupDetail(w.a.prac, S.group.id);
    expect(forPrac.memberships[0].full_name).toBe('Alex Example');
    const forTech = await reg.groupDetail(w.a.tech, S.group.id);
    expect(forTech.memberships[0].full_name).toBeNull();
    expect(forTech.memberships[0].ref_code).toBe(`W-${w.tag}`);
  });

  it('records instruments with calibration evidence', async () => {
    S.pump = await inst.createInstrument(w.a.prac, { asset_tag: `PUMP-${w.tag}`, instrument_type: 'sampling_pump', make: 'Demo', model: 'P1' });
    await inst.recordCalibration(w.a.prac, S.pump.id, { performed_at: '2026-01-01', valid_until: '2026-12-31', outcome: 'pass', certificate_ref: 'CAL-1' });
    S.oldPump = await inst.createInstrument(w.a.prac, { asset_tag: `PUMP-OLD-${w.tag}`, instrument_type: 'sampling_pump' });
    await inst.recordCalibration(w.a.prac, S.oldPump.id, { performed_at: '2024-01-01', valid_until: '2024-12-31', outcome: 'pass' });
    const list = await inst.listInstruments(w.a.prac);
    expect(list.find((i) => i.id === S.oldPump.id)!.calibration.state).toBe('expired');
  });

  it('runs a plan through independent review and scheduling', async () => {
    S.plan = await plans.createPlan(w.a.prac, { site_id: S.site.id, title: 'Grinding dust baseline', purpose: 'Establish baseline exposure for grinders', assessment_question: 'What is the 8-hour TWA exposure of grinders?', approach: 'personal', strategy_rationale: 'Full-shift personal samples on each grinder over representative days.', instrument_ids: [S.pump.id] });
    await expect(plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' })).rejects.toThrow(/target/);
    await plans.addTarget(w.a.prac, S.plan.id, { group_id: S.group.id, substance_id: w.ref.substanceId, method_version_id: w.ref.methodVersionId, planned_samples: '3' });
    await expect(plans.transitionPlan(w.a.prac, S.plan.id, { to: 'reviewed' })).rejects.toThrow(/plans.review|permission/);
    await plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' });
    await expect(plans.transitionPlan(w.a.prac, S.plan.id, { to: 'completed' })).rejects.toThrow(/Cannot move/);
    await plans.transitionPlan(w.a.prac, S.plan.id, { to: 'scheduled' });
    await plans.transitionPlan(w.a.tech, S.plan.id, { to: 'in_progress' });
  });

  it('captures field samples offline with idempotent sync and conflict preservation', async () => {
    const cu = randomUUID();
    S.code = `GR-${w.tag}-1`;
    const payload = { plan_id: S.plan.id, sample_code: S.code, sample_type: 'personal', worker_id: S.worker.id, substance_id: w.ref.substanceId, method_version_id: w.ref.methodVersionId, instrument_id: S.pump.id,
      timezone: 'Europe/London', start_local: '2026-03-02T08:00', end_local: '2026-03-02T12:00', flow_pre_lpm: 2.0, flow_post_lpm: 2.0, tasks_performed: 'Disc grinding', control_status: 'LEV running' };
    const [r1] = await field.syncBatch(w.a.tech, [{ client_uuid: cu, server_id: null, base_version: null, payload }]);
    expect(r1.outcome).toBe('created');
    expect(r1.warnings ?? []).toEqual([]);
    S.sample = { id: r1.server_id };
    const [dup] = await field.syncBatch(w.a.tech, [{ client_uuid: cu, server_id: null, base_version: null, payload }]);
    expect(dup.outcome).toBe('duplicate');
    // Another device edits from an older base version → conflict, server untouched
    const online = await field.sampleDetail(w.a.prac, S.sample.id);
    await field.updateSamplingEvent(w.a.prac, S.sample.id, { ...payload, notes: 'Edited online', version: online.event.version });
    const [c] = await field.syncBatch(w.a.tech, [{ client_uuid: cu, server_id: S.sample.id, base_version: 1, payload: { ...payload, notes: 'Edited offline' } }]);
    expect(c.outcome).toBe('conflict');
    const after = await field.sampleDetail(w.a.prac, S.sample.id);
    expect(after.event.notes).toBe('Edited online');
    expect(after.event.group_id_at_sampling).toBe(S.group.id);
    const conflicts = await field.listConflicts(w.a.prac);
    expect(conflicts.find((x) => x.id === c.conflict_id).client_payload.notes).toBe('Edited offline');
    await field.resolveConflict(w.a.prac, c.conflict_id!, { resolution: 'resolved_keep_server', notes: 'Online edit is correct' });
    // Stale online edit is rejected rather than overwriting
    await expect(field.updateSamplingEvent(w.a.prac, S.sample.id, { ...payload, version: 1 })).rejects.toThrow(/changed by someone else/);
  });

  it('warns visibly when an expired instrument is used', async () => {
    const [r] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: {
      plan_id: S.plan.id, sample_code: `GR-${w.tag}-2`, sample_type: 'personal', worker_id: S.worker.id, substance_id: w.ref.substanceId, method_version_id: w.ref.methodVersionId,
      instrument_id: S.oldPump.id, timezone: 'Europe/London', start_local: '2026-03-03T08:00', end_local: '2026-03-03T12:00', flow_pre_lpm: 2.0, flow_post_lpm: 1.7 } }]);
    expect(r.outcome).toBe('created');
    expect(r.warnings!.join(' ')).toMatch(/expired or failed/);
    S.sample2 = { id: r.server_id };
  });

  it('dispatches samples with chain of custody and imports lab results all-or-nothing', async () => {
    S.lab = await inst.createLaboratory(w.a.prac, { name: 'Demo Lab', accreditation_ref: 'DEMO-0000' });
    await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `SUB-${w.tag}`, sample_ids: [S.sample.id, S.sample2.id], dispatched_at: '2026-03-04T09:00' });
    const subs = await lab.listSubmissions(w.a.prac);
    await lab.receiveSubmission(w.a.prac, subs.find((s) => s.reference === `SUB-${w.tag}`).id, { received_at: '2026-03-05T10:00', received_condition: 'Intact, seals unbroken' });
    const bad = await lab.stageImport(w.a.prac, { filename: 'bad.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,lod\n${S.code},Demo Dust X (synthetic),120,ug,=,5\nNOPE,Demo Dust X (synthetic),1,ug,=,5\n` });
    expect(bad.status).toBe('rejected');
    await expect(lab.commitImport(w.a.prac, bad.id)).rejects.toThrow(/validated/);
    const good = await lab.stageImport(w.a.prac, { filename: 'good.csv', laboratory_id: S.lab.id, csv: `sample_code,analyte,value,unit,qualifier,lod,lab_report_ref\n${S.code},Demo Dust X (synthetic),120,ug,=,5,LR-1\n${`GR-${w.tag}-2`},Demo Dust X (synthetic),,ug,<LOD,5,LR-1\n` });
    expect(good.status).toBe('validated');
    expect((await lab.commitImport(w.a.prac, good.id)).count).toBe(2);
    expect((await lab.commitImport(w.a.prac, good.id)).already).toBe(true); // idempotent retry
    const det = await field.sampleDetail(w.a.prac, S.sample.id);
    expect(det.event.status).toBe('analysed');
    expect(det.custody.map((c) => c.event)).toEqual(['collected', 'dispatched', 'received_by_lab', 'analysed']);
  });

  it('calculates, reviews and approves an assessment with separation of duties', async () => {
    const { assessment, revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: w.ref.substanceId, plan_id: S.plan.id, title: 'Grinders — Demo Dust X', assessment_question: 'Is grinder exposure to Demo Dust X adequately controlled?' });
    expect(revision.sample_ids).toHaveLength(2);
    S.assessment = assessment; S.rev1 = revision;
    await asmt.updateDraft(w.a.prac, revision.id, { sample_ids: [S.sample.id], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '240', unsampled_assumption: 'none' });
    await expect(asmt.submitForReview(w.a.prac, revision.id)).rejects.toThrow(/calculation first/i);
    const calc = await asmt.calculate(w.a.prac, revision.id);
    expect(calc.data_quality_state).toBe('complete');
    expect(calc.benchmark_state).toBe('below_benchmark');
    expect(calc.calc_output.shifts[0].twa8h).toEqual({ lower: 0.125, upper: 0.125, unit: 'mg/m3' });
    await expect(asmt.submitForReview(w.a.prac, revision.id)).rejects.toThrow(/interpretation/);
    await asmt.updateDraft(w.a.prac, revision.id, { sample_ids: [S.sample.id], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '240', unsampled_assumption: 'none',
      interpretation: 'Single full-period sample below the synthetic benchmark; insufficient samples to characterise the group.', conclusion_category: 'insufficient_evidence', limitations: 'One worker, one day; not representative.' });
    await asmt.calculate(w.a.prac, revision.id);
    await asmt.submitForReview(w.a.prac, revision.id);
    await expect(asmt.approve(w.a.prac, revision.id, { approval_scope: 'Grinders, bay 1', approval_limitations: 'Single day', confirm_reviewed: 'on' })).rejects.toThrow(/assess.approve|permission/);
    const ap = await asmt.approve(w.a.rev, revision.id, { approval_scope: 'Grinders in bay 1, March 2026', approval_limitations: 'Single sample; group not characterised', confirm_reviewed: 'on' });
    expect(ap.status).toBe('approved');
    expect(ap.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps approved revisions immutable at the database level', async () => {
    const c = await getPool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id',$1,true)`, [w.A.tenant.id]);
      await expect(c.query(`update assessment_revisions set interpretation='tampered' where id=$1`, [S.rev1.id])).rejects.toThrow(/immutable/);
    } finally { await c.query('rollback'); c.release(); }
  });

  it('flags staleness after a lab amendment without changing the approved conclusion', async () => {
    await expect(lab.recordResult(w.a.prac, { sampling_event_id: S.sample.id, substance_id: w.ref.substanceId, value: '300', unit: 'ug', qualifier: '=' })).rejects.toThrow(/amendment reason/);
    await lab.recordResult(w.a.prac, { sampling_event_id: S.sample.id, substance_id: w.ref.substanceId, value: '300', unit: 'ug', qualifier: '=', amendment_reason: 'Laboratory reissued certificate after reweighing' });
    const d = await asmt.assessmentDetail(w.a.prac, S.assessment.id);
    expect(d.approved!.calc_output.shifts[0].twa8h.upper).toBe(0.125);
    expect(d.staleApproved.join(' ')).toMatch(/changed since/);
    await expect(asmt.updateDraft(w.a.prac, S.rev1.id, { sample_ids: [] })).rejects.toThrow(/Only draft/);
    const r2 = await asmt.newRevision(w.a.prac, S.assessment.id, { change_reason: 'Amended laboratory result received' });
    const c2 = await asmt.calculate(w.a.prac, r2.id);
    expect(c2.calc_output.shifts[0].twa8h.upper).toBe(0.3125);
    S.rev2 = r2;
  });

  it('blocks approval if evidence changes between calculation and approval', async () => {
    await asmt.submitForReview(w.a.prac, S.rev2.id);
    await field.addQcCheck(w.a.prac, S.sample.id, { check_type: 'Post-sampling leak check', outcome: 'fail', detail: 'Cassette seal loose' });
    await expect(asmt.approve(w.a.rev, S.rev2.id, { approval_scope: 'x'.repeat(12), approval_limitations: 'y'.repeat(12), confirm_reviewed: 'on' })).rejects.toThrow(/Recalculate/);
    await asmt.returnToDraft(w.a.rev, S.rev2.id, { notes: 'New failed QC check requires disposition' });
    const c = await asmt.calculate(w.a.prac, S.rev2.id);
    expect(c.data_quality_state).toBe('failed');
    await expect(asmt.updateDraft(w.a.prac, S.rev2.id, { sample_ids: [S.sample.id], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '240', interpretation: 'x'.repeat(40), conclusion_category: 'exposure_adequately_controlled', limitations: 'x'.repeat(20) })
      .then(() => asmt.calculate(w.a.prac, S.rev2.id)).then(() => asmt.submitForReview(w.a.prac, S.rev2.id))).rejects.toThrow(/cannot be concluded/);
  });

  it('issues reports only from approved revisions and watermarks drafts', async () => {
    const issued = await rep.generateReport(w.a.rev, S.assessment.id, S.rev1.id);
    expect(issued.status).toBe('issued');
    const draft = await rep.generateReport(w.a.prac, S.assessment.id, S.rev2.id);
    expect(draft.status).toBe('draft');
    const dr = await rep.getReport(w.a.prac, draft.id);
    expect(dr.content_html).toMatch(/DRAFT — NOT APPROVED/);
    const ir = await rep.getReport(w.a.client1, issued.id);
    expect(ir.content_html).toMatch(/0\.125 mg\/m3/);
    expect(ir.content_html).toMatch(/SYNTHETIC DEMONSTRATION VALUE/);
    await expect(rep.getReport(w.a.client1, draft.id)).rejects.toThrow(/Draft reports/);
    await expect(rep.getReport(w.a.client2, issued.id)).rejects.toThrow(/not found/);
  });

  it('requires verification evidence before closing a control action', async () => {
    S.lev = await ctl.createControl(w.a.prac, { site_id: S.site.id, name: 'Downdraught bench LEV', kind: 'local_exhaust_ventilation', purpose: 'Capture grinding dust at source', group_id: S.group.id, owner_user_id: w.a.owner.userId, performance_criteria: 'Face velocity ≥ 1 m/s at bench' });
    const g = await reg.groupDetail(w.a.prac, S.group.id);
    expect(g.group.review_required).toBe(true);
    await expect(ctl.createAction(w.a.prac, { title: 'Install LEV', control_id: S.lev.id, owner_user_id: w.a.owner.userId, verification_requirement: 'Confirm it is installed' })).rejects.toThrow(/measured/);
    const act = await ctl.createAction(w.a.prac, { title: 'Install downdraught bench', control_id: S.lev.id, owner_user_id: w.a.owner.userId, verification_requirement: 'Commissioning test of face velocity and post-installation personal sampling', requires_exposure_reassessment: '' });
    await ctl.markImplemented(w.a.owner, act.id, { notes: 'Bench installed and wired' });
    await expect(ctl.submitEvidence(w.a.owner, act.id, { notes: 'Installed, see photos' })).rejects.toThrow(/Attach evidence/);
    const today = new Date().toISOString().slice(0, 10);
    const routine = await ctl.recordInspection(w.a.owner, S.lev.id, { at: today, kind: 'routine_inspection', outcome: 'satisfactory' });
    await ctl.submitEvidence(w.a.owner, act.id, { inspection_id: routine.id, notes: 'Visual inspection after install' });
    await expect(ctl.reviewEffectiveness(w.a.rev, act.id, { outcome: 'effective', notes: 'Looks fine on inspection, installed correctly.' })).rejects.toThrow(/Installation alone/);
    await ctl.reviewEffectiveness(w.a.rev, act.id, { outcome: 'not_effective', notes: 'No performance evidence; reopen pending commissioning test.' });
    await ctl.markImplemented(w.a.owner, act.id, { notes: 'Re-submitting after commissioning' });
    const test = await ctl.recordInspection(w.a.owner, S.lev.id, { at: today, kind: 'commissioning', outcome: 'satisfactory', measurements: 'Face velocity 1.2 m/s across 5 points' });
    await ctl.submitEvidence(w.a.owner, act.id, { inspection_id: test.id, notes: 'Commissioning report' });
    await expect(ctl.closeVerified(w.a.rev, act.id, { notes: 'closing early' })).rejects.toThrow(/reviewed as effective/);
    await ctl.reviewEffectiveness(w.a.rev, act.id, { outcome: 'effective', notes: 'Commissioning shows face velocity meets criteria at all points.' });
    await ctl.closeVerified(w.a.rev, act.id, { notes: 'Verified by commissioning test' });
    const d = await ctl.actionDetail(w.a.prac, act.id);
    expect(d.action.status).toBe('verified_closed');
    expect(d.events.map((e) => e.to_status)).toEqual(['assigned', 'implemented', 'evidence_submitted', 'assigned', 'implemented', 'evidence_submitted', 'effectiveness_reviewed', 'verified_closed']);
  });

  it('a defective inspection raises a tracked action automatically', async () => {
    await ctl.recordInspection(w.a.tech, S.lev.id, { at: new Date().toISOString().slice(0, 10), kind: 'routine_inspection', outcome: 'defect_found', notes: 'Filter blocked' });
    const det = await ctl.controlDetail(w.a.prac, S.lev.id);
    expect(det.control.status).toBe('defective');
    expect(det.actions.some((x) => /Rectify/.test(x.title))).toBe(true);
  });

  it('preserves historical group association when membership ends', async () => {
    const g = await reg.groupDetail(w.a.prac, S.group.id);
    await reg.endMembership(w.a.prac, g.memberships[0].id, { valid_to: '2026-06-30', reason: 'Moved to assembly' });
    const s = await field.sampleDetail(w.a.prac, S.sample.id);
    expect(s.event.group_id_at_sampling).toBe(S.group.id);
  });
});

describe('tenant and client isolation', () => {
  it('another tenant cannot read or reference records', async () => {
    const other = w.b.prac;
    await expect(reg.siteTree(other, S.site.id)).rejects.toThrow(/not found/);
    expect((await reg.registerOverview(other)).sites).toHaveLength(0);
    await expect(field.sampleDetail(other, S.sample.id)).rejects.toThrow(/not found/);
    await expect(reg.createWorkArea(other, { site_id: S.site.id, name: 'Injected' })).rejects.toThrow(/not found/);
    await expect(asmt.assessmentDetail(other, S.assessment.id)).rejects.toThrow(/not found/);
    await expect(rep.getReport(other, (await rep.listReports(w.a.rev))[0].id)).rejects.toThrow(/not found/);
    const [r] = await field.syncBatch({ ...other, perms: new Set([...other.perms, 'field.capture']) }, [{ client_uuid: randomUUID(), server_id: S.sample.id, base_version: 1, payload: { sample_code: 'X', sample_type: 'static' } }]);
    expect(r.outcome).toBe('rejected');
    expect((await adm.exportData(other)).data.sampling_events).toHaveLength(0);
    expect((await asmt.listBenchmarks(other)).every((b) => b.platform || b.tenant_id === w.B.tenant.id)).toBe(true);
  });

  it('a raw query without tenant context returns nothing', async () => {
    const c = await getPool().connect();
    try {
      expect((await c.query('select * from sampling_events')).rowCount).toBe(0);
      expect((await c.query('select * from users')).rowCount).toBe(0);
      await expect(c.query(`insert into sites (tenant_id,client_id,name) values ($1,$2,'x')`, [w.A.tenant.id, w.A.clients['Client One']])).rejects.toThrow(/row-level security/);
    } finally { c.release(); }
  });

  it('client read-only users see only their own client', async () => {
    expect((await reg.registerOverview(w.a.client1)).sites.map((s) => s.id)).toContain(S.site.id);
    expect((await reg.registerOverview(w.a.client2)).sites).toHaveLength(0);
    await expect(field.sampleDetail(w.a.client2, S.sample.id)).rejects.toThrow(/not found/);
    const users = await adm.listUsers({ ...w.a.client2, perms: new Set([...w.a.client2.perms]) });
    expect(users.clients.map((c) => c.name)).toEqual(['Client Two']);
    expect(users.users.some((u) => u.client_id === w.A.clients['Client One'])).toBe(false);
    await expect(reg.createSite(w.a.client1, { name: 'x' })).rejects.toThrow(/permission/);
  });

  it('attachments are tenant-scoped, type-checked and integrity-verified', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% demo certificate\n');
    const a1 = await att.saveAttachment(w.a.prac, { entity_type: 'sampling_event', entity_id: S.sample.id, filename: 'cert.pdf', data: pdf });
    expect((await att.readAttachment(w.a.prac, a1.id)).data.equals(pdf)).toBe(true);
    await expect(att.readAttachment(w.b.prac, a1.id)).rejects.toThrow(/not found/);
    await expect(att.readAttachment(w.a.client2, a1.id)).rejects.toThrow(/not found/);
    await expect(att.saveAttachment(w.a.prac, { entity_type: 'sampling_event', entity_id: S.sample.id, filename: 'evil.html', data: Buffer.from('<script>') })).rejects.toThrow(/Unsupported/);
    await expect(att.saveAttachment(w.b.prac, { entity_type: 'sampling_event', entity_id: S.sample.id, filename: 'x.pdf', data: pdf })).rejects.toThrow(/not found|permission/);
  });

  it('evidence tables are append-only for the application role', async () => {
    const c = await getPool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id',$1,true)`, [w.A.tenant.id]);
      await expect(c.query(`update audit_events set action='x'`)).rejects.toThrow(/permission denied|append-only/);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id',$1,true)`, [w.A.tenant.id]);
      await expect(c.query(`delete from lab_result_revisions`)).rejects.toThrow(/permission denied|cannot be deleted/);
    } finally { await c.query('rollback'); c.release(); }
  });
});

describe('governance and integrations', () => {
  it('disposal requires a second person and keeps pseudonymous history', async () => {
    await adm.setRetention(w.a.admin, { record_class: 'worker_identity', retain_years: '40', basis: 'Retention basis to be confirmed by client legal adviser' });
    const req = await adm.requestDisposal(w.a.prac, { record_class: 'worker_identity', entity_id: S.worker.id, reason: 'Worker left; retention period reached (test)' });
    await expect(adm.decideDisposal({ ...w.a.prac, perms: new Set([...w.a.prac.perms, 'disposal.approve']) }, req.id, { decision: 'approved', notes: 'self approval attempt' })).rejects.toThrow(/someone other/);
    await adm.decideDisposal(w.a.admin, req.id, { decision: 'approved', notes: 'Approved' });
    const g = await reg.groupDetail(w.a.prac, S.group.id);
    expect(g.memberships[0].full_name).toBeNull();
    expect(g.memberships[0].ref_code).toBe(`W-${w.tag}`);
  });

  it('integration messages are mock-only, idempotent and never claim delivery', async () => {
    await integ.upsertLink(w.a.admin, { target: 'integrarisk', external_tenant_ref: 'IR-DEMO', enabled: 'on' });
    await expect(integ.upsertLink(w.a.admin, { target: 'sentrisafe', external_tenant_ref: 'SS-1', enabled: 'on' })).rejects.toThrow(/draft/);
    await withActor(w.a.admin, async (tx) => {
      const k1 = await integ.enqueue(tx, w.A.tenant.id, 'integrarisk', 'ohea.reviewed_finding', 'approved', 'test-entity', { a: 1 });
      const k2 = await integ.enqueue(tx, w.A.tenant.id, 'integrarisk', 'ohea.reviewed_finding', 'approved', 'test-entity', { a: 1 });
      expect(k1).toBeTruthy();
      expect(k2).toBeNull();
    });
    const res = await integ.deliverPending(w.a.admin);
    expect(res.delivered).toBe(0);
    expect(res.mock).toBeGreaterThan(0);
    const ov = await integ.integrationsOverview(w.a.admin);
    expect(ov.outbox.every((o) => o.status !== 'delivered')).toBe(true);
  });
});
