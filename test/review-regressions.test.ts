// Regression tests for defects found by the independent security/safety review.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, type World } from './fixtures.js';
import { closePool, getPool, withActor } from '../src/db.js';
import { runAssessment, sampleConcentration, twa8h, type SampleInput } from '../src/calc/engine.js';
import { completeMfa, login, resolveSession } from '../src/auth/session.js';
import { totpAt } from '../src/auth/crypto.js';
import { createUserDirect } from '../scripts/bootstrap.js';
import * as reg from '../src/services/register.js';
import * as inst from '../src/services/instruments.js';
import * as plans from '../src/services/plans.js';
import * as field from '../src/services/field.js';
import * as lab from '../src/services/lab.js';
import * as asmt from '../src/services/assessments.js';
import * as ctl from '../src/services/controls.js';

let w: World;
const S: Record<string, any> = {};
const C1 = () => w.A.clients['Client One'];
const C2 = () => w.A.clients['Client Two'];

async function sample(code: string, o: Record<string, unknown> = {}) {
  const [r] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: {
    plan_id: S.plan1.id, sample_code: code, sample_type: 'personal', worker_id: S.w1.id, substance_id: w.ref.substanceId, method_version_id: w.ref.methodVersionId,
    instrument_id: S.pump.id, timezone: 'Europe/London', start_local: '2026-04-01T08:00', end_local: '2026-04-01T16:00', flow_pre_lpm: 2, flow_post_lpm: 2, ...o } }]);
  if (r.outcome !== 'created') throw new Error(`${r.outcome}: ${r.message}`);
  return r.server_id!;
}

beforeAll(async () => {
  w = await buildWorld();
  const p = w.a.prac;
  for (const [k, client] of [['1', C1()], ['2', C2()]] as const) {
    const site = await reg.createSite(p, { client_id: client, name: `Site ${k}` });
    const area = await reg.createWorkArea(p, { site_id: site.id, name: 'Area' });
    const proc = await reg.createProcess(p, { work_area_id: area.id, name: 'Proc' });
    const task = await reg.createTask(p, { process_id: proc.id, name: 'Task', duration_min_per_shift: '480' });
    const hz = await reg.createHazard(p, { task_id: task.id, substance_id: w.ref.substanceId, physical_form: 'dust', exposure_routes: ['inhalation'], exposure_duration_min: '480' });
    S[`group${k}`] = await reg.createGroup(p, { site_id: site.id, name: `G${k}`, rationale: 'Same task and conditions for all members of this group.', task_ids: [task.id], hazard_ids: [hz.id] });
    S[`site${k}`] = site;
    S[`plan${k}`] = await plans.createPlan(p, { site_id: site.id, title: `Plan ${k}`, purpose: 'Regression purpose', assessment_question: 'Regression question here', approach: 'personal', strategy_rationale: 'Regression strategy rationale text.' });
    await plans.addTarget(p, S[`plan${k}`].id, { substance_id: w.ref.substanceId });
    await plans.transitionPlan(w.a.rev, S[`plan${k}`].id, { to: 'reviewed' });
    await plans.transitionPlan(p, S[`plan${k}`].id, { to: 'scheduled' });
  }
  S.w1 = await reg.createWorker(p, { client_id: C1(), ref_code: `R1-${w.tag}` });
  await reg.addMembership(p, { group_id: S.group1.id, worker_id: S.w1.id, valid_from: '2026-01-01' });
  S.pump = await inst.createInstrument(p, { asset_tag: `RP-${w.tag}`, instrument_type: 'sampling_pump' });
  await inst.recordCalibration(p, S.pump.id, { performed_at: '2026-01-01', valid_until: '2026-12-31', outcome: 'pass' });
  S.lab = await inst.createLaboratory(p, { name: 'Reg lab' });
});
afterAll(async () => { await closePool(); });

describe('C1 cross-client evidence mixing', () => {
  it('rejects tagging a sample with another client’s exposure group', async () => {
    await expect(sample(`X-${w.tag}`, { group_id: S.group2.id })).rejects.toThrow(/different client/);
  });
  it('rejects a plan target pointing at another client’s group', async () => {
    await expect(plans.addTarget(w.a.prac, S.plan2.id, { substance_id: w.ref.substanceId, group_id: S.group1.id })).rejects.toThrow(/different client/);
  });
  it('database refuses a mismatched group even if the service is bypassed', async () => {
    const id = await sample(`DB-${w.tag}`);
    await expect(withActor(w.a.prac, (tx) => tx.query('update sampling_events set group_id_at_sampling=$2 where id=$1', [id, S.group2.id]))).rejects.toThrow(/different client/);
  });
});

describe('C2 void samples', () => {
  it('excludes a voided sample from calculation and data quality', async () => {
    const id = await sample(`V-${w.tag}`);
    await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `RS-${w.tag}`, sample_ids: [id], dispatched_at: '2026-04-02T09:00' });
    await lab.recordResult(w.a.prac, { sampling_event_id: id, substance_id: w.ref.substanceId, value: '10', unit: 'ug', qualifier: '=' });
    const { revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group1.id, substance_id: w.ref.substanceId, title: 'Void test', assessment_question: 'Does a void sample count?' });
    await asmt.updateDraft(w.a.prac, revision.id, { sample_ids: [id], benchmark_version_id: w.ref.benchmarkVersionId, exposure_minutes_per_shift: '480' });
    await field.voidSamplingEvent(w.a.prac, id, { reason: 'Cassette contaminated' });
    const r = await asmt.calculate(w.a.prac, revision.id);
    expect(r.data_quality_state).toBe('failed');
    expect(r.calc_output.samples[0].flags.map((f: any) => f.code)).toContain('SAMPLE_VOID');
  });
});

describe('C3 client read-only users cannot write', () => {
  it('blocks action evidence by a client user and client users as owners', async () => {
    const lev = await ctl.createControl(w.a.prac, { site_id: S.site1.id, name: 'LEV', kind: 'local_exhaust_ventilation', purpose: 'Capture at source', performance_criteria: 'Face velocity 1 m/s' });
    await expect(ctl.createAction(w.a.prac, { title: 'Fix', control_id: lev.id, owner_user_id: w.a.client1.userId, verification_requirement: 'Performance test of velocity' })).rejects.toThrow(/cannot own/);
  });
  it('the database rejects writes from a client-scoped session', async () => {
    await expect(withActor(w.a.client1, (tx) => tx.query(`insert into sites (tenant_id,client_id,name) values ($1,$2,'x')`, [w.A.tenant.id, C1()]))).rejects.toThrow(/row-level security/);
    await expect(withActor(w.a.client1, (tx) => tx.query(`update sites set name='y' where client_id=$1`, [C1()]))).rejects.toThrow(/row-level security/);
  });
});

describe('H1/H3 credential self-service and MFA hardening', () => {
  it('a client user can change their own password but not their role', async () => {
    await withActor(w.a.client1, (tx) => tx.query(`select self_set_password('scrypt$x')`));
    const c = await getPool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id',$1,true), set_config('app.client_id',$2,true), set_config('app.user_id',$3,true)`, [w.A.tenant.id, C1(), w.a.client1.userId]);
      const r = await c.query(`update users set role='org_admin' where id=$1`, [w.a.client1.userId]);
      expect(r.rowCount).toBe(0);
    } catch (e: any) { expect(e.message).toMatch(/row-level security/); } finally { await c.query('rollback'); c.release(); }
  });
  it('rejects a replayed TOTP code and revokes the session after five wrong codes', async () => {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const u = await createUserDirect(admin, { tenantId: w.A.tenant.id, email: `totp${Date.now()}@t.test`, name: 'T', role: 'practitioner', password: 'correct horse battery', totpSecret: secret, mfaEnabled: true });
    await admin.end();
    const s1 = await login(u.email, 'correct horse battery');
    const si1 = (await resolveSession(s1.token))!;
    const code = totpAt(secret, Date.now());
    await completeMfa(si1, code);
    const s2 = await login(u.email, 'correct horse battery');
    const si2 = (await resolveSession(s2.token))!;
    await expect(completeMfa(si2, code)).rejects.toThrow(/not accepted/);
    for (let i = 0; i < 3; i++) await expect(completeMfa(si2, '000000')).rejects.toThrow(/not accepted/);
    await expect(completeMfa(si2, '000000')).rejects.toThrow(/Too many/);
    expect(await resolveSession(s2.token)).toBeNull();
  });
});

describe('H2 import batches are client-scoped', () => {
  it('another client cannot read import rows', async () => {
    const id = await sample(`I-${w.tag}`);
    await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `RI-${w.tag}`, sample_ids: [id], dispatched_at: '2026-04-02T09:00' });
    const b = await lab.stageImport(w.a.prac, { filename: 'x.csv', csv: `sample_code,analyte,value,unit,qualifier\nI-${w.tag},Demo Dust X (synthetic),5,ug,=\n` });
    const other = await lab.importDetail(w.a.client2, b.id);
    expect(other.batch).toBeNull();
    expect(other.rows).toHaveLength(0);
    expect((await lab.importDetail(w.a.client1, b.id)).rows).toHaveLength(1);
  });
});

describe('H4 exposure period cannot silently drop unsampled time', () => {
  it('flags an exposure period shorter than the register duration', () => {
    const s = sampleConcentration({ sampleId: 'a', sampleCode: 'a', sampleType: 'personal', subjectRef: 'W', startAt: '2026-01-01T08:00:00Z', endAt: '2026-01-01T10:00:00Z', timezone: 'UTC', interruptions: [], flowPreLpm: 2, flowPostLpm: 2,
      method: { code: 'M', version: '1', resultBasis: 'mass_on_sample', flowDriftTolerancePct: 5, minVolumeL: null, suitableForFormalAssessment: true }, instrument: { assetTag: 'P', screeningOnly: false, calibrationValidAtSampling: true }, qc: [],
      result: { revision: 1, value: 100, unit: 'ug', qualifier: '=', lod: 1, loq: 2 } });
    const [r] = twa8h([s], { exposureMinutesPerShift: 120, unsampledAssumption: 'none', recordedExposureMinutes: 480 });
    expect(r.twa8h).toBeNull();
    expect(r.flags[0].code).toBe('EXPOSURE_BELOW_RECORDED');
  });
});

describe('H5 defect actions and control status', () => {
  it('blocks returning a defective control to service while its defect action is open, and restricts cancellation', async () => {
    const c = await ctl.createControl(w.a.prac, { site_id: S.site1.id, name: 'Enclosure', kind: 'enclosure', purpose: 'Contain dust at source', performance_criteria: 'Negative pressure maintained', status: 'in_service' });
    await ctl.recordInspection(w.a.tech, c.id, { at: '2026-04-03', kind: 'routine_inspection', outcome: 'failed', notes: 'Panel missing' });
    await expect(ctl.setControlStatus(w.a.prac, c.id, { status: 'in_service', reason: 'looks ok now' })).rejects.toThrow(/defect action/);
    const act = (await ctl.controlDetail(w.a.prac, c.id)).actions[0];
    await expect(ctl.cancelAction(w.a.prac, act.id, { reason: 'not needed really' })).rejects.toThrow(/technical reviewer/);
  });
});

const base = (o: Partial<SampleInput>): SampleInput => ({ sampleId: o.sampleCode ?? 's', sampleCode: 's', sampleType: 'personal', subjectRef: 'W', startAt: null, endAt: null, timezone: 'UTC', interruptions: [], flowPreLpm: 2, flowPostLpm: 2,
  method: { code: 'M', version: '1', resultBasis: 'mass_on_sample', flowDriftTolerancePct: 5, minVolumeL: null, suitableForFormalAssessment: true }, instrument: { assetTag: 'P', screeningOnly: false, calibrationValidAtSampling: true }, qc: [],
  result: { revision: 1, value: 240, unit: 'ug', qualifier: '=', lod: 1, loq: 2 }, ...o });

describe('M1/M2/M3 calculation fixes', () => {
  it('keeps a night shift crossing midnight together', () => {
    const a = sampleConcentration(base({ sampleCode: 'n1', startAt: '2026-01-01T22:00:00Z', endAt: '2026-01-02T02:00:00Z', result: { revision: 1, value: 480, unit: 'ug', qualifier: '=', lod: 1, loq: 2 } }));
    const b = sampleConcentration(base({ sampleCode: 'n2', startAt: '2026-01-02T02:00:00Z', endAt: '2026-01-02T06:00:00Z', result: { revision: 1, value: 480, unit: 'ug', qualifier: '=', lod: 1, loq: 2 } }));
    const r = twa8h([a, b], { exposureMinutesPerShift: 480, unsampledAssumption: 'none' });
    expect(r).toHaveLength(1);
    expect(r[0].twa8h!.upper).toBe(1);
    expect(r[0].shiftDate).toBe('2026-01-01');
  });
  it('merges overlapping interruptions', () => {
    const o = sampleConcentration(base({ startAt: '2026-01-01T08:00:00Z', endAt: '2026-01-01T12:00:00Z', interruptions: [
      { start: '2026-01-01T09:00:00Z', end: '2026-01-01T10:00:00Z' }, { start: '2026-01-01T09:00:00Z', end: '2026-01-01T10:00:00Z' }, { start: '2026-01-01T09:30:00Z', end: '2026-01-01T10:30:00Z' }] }));
    expect(o.sampledMinutes).toBe(150);
  });
  it('a high excluded or indicative result blocks a favourable roll-up', () => {
    const bm = { versionId: 'b', type: 'T', averagingMinutes: 480, value: 0.5, unit: 'mg/m3' as const, verificationStatus: 'verified' as const, isSynthetic: true, source: 'synthetic' };
    const low = base({ sampleCode: 'low', subjectRef: 'W1', startAt: '2026-01-01T08:00:00Z', endAt: '2026-01-01T16:00:00Z', result: { revision: 1, value: 96, unit: 'ug', qualifier: '=', lod: 1, loq: 2 } });
    const high = base({ sampleCode: 'high', subjectRef: 'W2', startAt: '2026-01-01T08:00:00Z', endAt: '2026-01-01T16:00:00Z', instrument: { assetTag: 'S', screeningOnly: true, calibrationValidAtSampling: true }, result: { revision: 1, value: 4800, unit: 'ug', qualifier: '=', lod: 1, loq: 2 } });
    const failed = { ...high, sampleCode: 'qcfail', instrument: { assetTag: 'P', screeningOnly: false, calibrationValidAtSampling: true }, qc: [{ checkType: 'flow', outcome: 'fail' as const, disposition: null }] };
    for (const other of [high, failed]) {
      const o = runAssessment({ calc: 'twa_8h', samples: [low, other], parameters: { exposureMinutesPerShift: 480, unsampledAssumption: 'none' }, benchmark: bm });
      expect(o.benchmarkState).toBe('indeterminate');
    }
  });
});

describe('second-round review fixes', () => {
  it('keeps a same-day split shift together (no under-estimate)', () => {
    const a = sampleConcentration(base({ sampleCode: 'a', startAt: '2026-01-05T06:00:00Z', endAt: '2026-01-05T08:00:00Z', result: { revision: 1, value: 240, unit: 'ug', qualifier: '=', lod: 1, loq: 2 } }));
    const b = sampleConcentration(base({ sampleCode: 'b', startAt: '2026-01-05T13:00:00Z', endAt: '2026-01-05T15:00:00Z', result: { revision: 1, value: 240, unit: 'ug', qualifier: '=', lod: 1, loq: 2 } }));
    const r = twa8h([a, b], { exposureMinutesPerShift: 240, unsampledAssumption: 'none' });
    expect(r).toHaveLength(1);
    expect(r[0].twa8h!.upper).toBe(0.5);
  });
  it('treats a group with no recorded register duration as incomplete', () => {
    const a = sampleConcentration(base({ startAt: '2026-01-05T08:00:00Z', endAt: '2026-01-05T09:00:00Z' }));
    const [r] = twa8h([a], { exposureMinutesPerShift: 60, unsampledAssumption: 'none', recordedExposureMinutes: null });
    expect(r.twa8h).toBeNull();
    expect(r.flags[0].code).toBe('EXPOSURE_NOT_IN_REGISTER');
  });
  it('a reviewer (not the creator) can cancel a defect action', async () => {
    const c = await ctl.createControl(w.a.prac, { site_id: S.site1.id, name: 'Booth', kind: 'enclosure', purpose: 'Contain spray mist', performance_criteria: 'Inward air velocity maintained', status: 'in_service' });
    await ctl.recordInspection(w.a.tech, c.id, { at: '2026-04-03', kind: 'routine_inspection', outcome: 'defect_found', notes: 'Door seal worn' });
    const act = (await ctl.controlDetail(w.a.prac, c.id)).actions[0];
    await ctl.cancelAction(w.a.rev, act.id, { reason: 'Duplicate of an existing repair action' });
    expect((await ctl.actionDetail(w.a.prac, act.id)).action.status).toBe('cancelled');
  });
  it('client-scoped sessions cannot change tenant settings or reference data', async () => {
    await expect(withActor(w.a.client1, async (tx) => {
      const r = await tx.query('update tenants set mfa_required=false');
      if (r.rowCount) throw new Error('tenant updated');
    })).resolves.toBeUndefined();
    await expect(withActor(w.a.client1, (tx) => tx.query(`insert into substances (tenant_id,name) values ($1,'x')`, [w.A.tenant.id]))).rejects.toThrow(/row-level security/);
  });
  it('MFA failures count against the account across sessions', async () => {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
    const u = await createUserDirect(admin, { tenantId: w.A.tenant.id, email: `mfa2${Date.now()}@t.test`, name: 'T', role: 'practitioner', password: 'correct horse battery', totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', mfaEnabled: true });
    for (let s = 0; s < 4; s++) {
      const l = await login(u.email, 'correct horse battery').catch((e) => e);
      if (l instanceof Error) { expect(l.message).toMatch(/locked/); break; }
      const si = (await resolveSession(l.token))!;
      for (let i = 0; i < 3; i++) await completeMfa(si, '000000').catch(() => null);
    }
    const row = (await admin.query('select locked_until from users where id=$1', [u.id])).rows[0];
    await admin.end();
    expect(row.locked_until).not.toBeNull();
  });
});

describe('STEL through the assessment service', () => {
  it('calculates a 15-minute assessment and freezes the calculation code in the revision', async () => {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
    const stelB = (await admin.query(`insert into benchmarks (tenant_id,substance_id,jurisdiction,benchmark_type,averaging_minutes) values (null,$1,'DEMO','STEL-${w.tag}',15) returning id`, [w.ref.substanceId])).rows[0].id;
    const stelV = (await admin.query(`insert into benchmark_versions (tenant_id,benchmark_id,value,unit,source_title,source_version,effective_from,verification_status,verified_by,verified_at,is_synthetic)
      values (null,$1,1.5,'mg/m3','SYNTHETIC DEMONSTRATION VALUE','demo-stel','2020-01-01','verified','platform (synthetic)',now(),true) returning id`, [stelB])).rows[0].id;
    await admin.end();
    const id = await sample(`ST-${w.tag}`, { start_local: '2026-04-01T10:00', end_local: '2026-04-01T10:15' });
    await lab.createSubmission(w.a.prac, { laboratory_id: S.lab.id, reference: `STS-${w.tag}`, sample_ids: [id], dispatched_at: '2026-04-02T09:00' });
    await lab.recordResult(w.a.prac, { sampling_event_id: id, substance_id: w.ref.substanceId, value: '60', unit: 'ug', qualifier: '=' });
    const { revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group1.id, substance_id: w.ref.substanceId, title: 'Peak task', assessment_question: 'Short-term peaks during decanting?' });
    await asmt.updateDraft(w.a.prac, revision.id, { calc_code: 'stel_15', sample_ids: [id], benchmark_version_id: stelV });
    const r = await asmt.calculate(w.a.prac, revision.id);
    expect(r.calc_code).toBe('stel_15');
    expect(r.calc_output.shifts[0].result).toEqual({ lower: 2, upper: 2, unit: 'mg/m3' });
    expect(r.benchmark_state).toBe('at_or_above_benchmark');
  });
});

describe('residual gap fixes', () => {
  it('the application role never receives password hashes', async () => {
    const c = await getPool().connect();
    try {
      await expect(c.query(`select * from auth_lookup_user('x')`)).rejects.toThrow(/does not exist|permission/);
      const p = (await c.query('select auth_password_params($1) p', [w.a.prac.email])).rows[0].p as string;
      expect(p.split('$')).toHaveLength(5);
      const u1 = (await c.query('select auth_password_params($1) p', ['nobody@x.test'])).rows[0].p;
      const u2 = (await c.query('select auth_password_params($1) p', ['nobody@x.test'])).rows[0].p;
      expect(u1).toBe(u2);
      expect(u1.split('$')).toHaveLength(5);
    } finally { c.release(); }
  });
  it('link tables follow their parent record’s client scoping', async () => {
    const own = await withActor(w.a.client1, (tx) => tx.query('select * from plan_targets where plan_id=$1', [S.plan1.id]));
    const other = await withActor(w.a.client2, (tx) => tx.query('select * from plan_targets where plan_id=$1', [S.plan1.id]));
    expect(own.rowCount).toBeGreaterThan(0);
    expect(other.rowCount).toBe(0);
    expect((await withActor(w.a.client2, (tx) => tx.query('select * from exposure_group_hazards where group_id=$1', [S.group1.id]))).rowCount).toBe(0);
  });
  it('emits action and required-control messages to enabled links (mock only)', async () => {
    const integ = await import('../src/services/integrations.js');
    await integ.upsertLink(w.a.admin, { target: 'integrarisk', external_tenant_ref: 'IR-REG', enabled: 'on' });
    await integ.upsertLink(w.a.admin, { target: 'workassura', external_tenant_ref: 'WA-REG', enabled: 'on' });
    const c = await ctl.createControl(w.a.prac, { site_id: S.site1.id, name: 'Wet cutting', kind: 'suppression', purpose: 'Suppress dust at the blade', performance_criteria: 'Water flow at the blade throughout cutting' });
    await ctl.createAction(w.a.prac, { title: 'Fit water feed', control_id: c.id, owner_user_id: w.a.owner.userId, verification_requirement: 'Performance test of water flow rate at the blade' });
    const ov = await integ.integrationsOverview(w.a.admin);
    expect(ov.outbox.some((o) => o.contract === 'ohea.action')).toBe(true);
    expect(ov.outbox.some((o) => o.contract === 'ohea.required_controls')).toBe(true);
  });
});
