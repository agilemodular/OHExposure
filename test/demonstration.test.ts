// SYNTHETIC DEMONSTRATION — reviewable walkthrough of the airborne-contaminant workflow and its failure cases.
//
// Runs in the disposable test database only (dropped and rebuilt for every run), in an organisation created for the
// run. Every person, substance, benchmark, laboratory result, method approval and pilot authorisation below is
// SYNTHETIC and labelled as such. None of it is a professional approval, a pilot gate decision or field-validation
// evidence. Set WRITE_DEMONSTRATION=1 to write the transcript to docs/examples/demonstration-walkthrough.synthetic.md.
import { randomUUID } from 'node:crypto';
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
import * as ctl from '../src/services/controls.js';
import { CALCULATIONS } from '../src/calc/engine.js';
import { importReferenceData } from '../scripts/import-reference-data.js';
import { recordMethodReview, recordPilotAuthorisation, resumeWorkflows, setTenantLevel, suspendWorkflows } from '../scripts/platform-controls.js';

const URL_ = process.env.DATABASE_ADMIN_URL!;
const TWA = CALCULATIONS.twa_8h.version;
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const DOC = join(mkdtempSync(join(tmpdir(), 'ohea-demo-')), 'synthetic-demonstration-document.pdf');
writeFileSync(DOC, '%PDF-1.4 SYNTHETIC DEMONSTRATION DOCUMENT - not a signed professional review or authorisation');
const DEMO = 'SYNTHETIC DEMONSTRATION';

let w: World;
const S: Record<string, any> = {};
type Line = { kind: 'step' | 'refused' | 'note'; title: string; who?: string; detail: string };
const log: Line[] = [];
const step = (title: string, who: string, detail: string) => log.push({ kind: 'step', title, who, detail });
const note = (title: string, detail: string) => log.push({ kind: 'note', title, detail });
async function refused(title: string, who: string, p: Promise<unknown>, expected: RegExp) {
  let msg = '';
  await p.then(() => { throw new Error(`${title}: expected a refusal, but the action succeeded`); }, (e) => { msg = String(e?.message ?? e); });
  expect(msg).toMatch(expected);
  log.push({ kind: 'refused', title, who, detail: msg.replace(/\s+/g, ' ').slice(0, 300) });
}

const SUB = (tag: string) => `Demo Dust Q (DEMONSTRATION ONLY) ${tag}`;
const refRow = (tag: string, name: string, title: string) => ({
  substance: { name }, jurisdiction: 'DEMO', benchmark_type: 'LTEL', averaging_minutes: 480, value: 0.5, unit: 'mg/m3',
  source_title: title, source_version: 'DEMO-1', source_url: 'https://example.org/demonstration-only', effective_from: '2020-01-01',
  provenance: 'professional_reference', reviewer_name: 'DEMONSTRATION reviewer (not a real verification)', verified_on: yesterday,
  permitted_use: 'Demonstration only', licence_note: `Invented value for the demonstration (${tag})`,
});

beforeAll(async () => {
  w = await buildWorld();
  // The importer refuses to label synthetic data as professional reference data; the demonstration row is therefore
  // labelled DEMONSTRATION ONLY instead, and exists only in the disposable test database.
  await refused('Synthetic data presented as a professional reference benchmark (missing benchmark approval)', 'Platform operator',
    importReferenceData(URL_, [refRow(w.tag, `Demo Dust Q (synthetic) ${w.tag}`, 'Synthetic list')], { importedBy: 'Demonstration operator' }), /cannot describe a synthetic/);
  const r = await importReferenceData(URL_, [refRow(w.tag, SUB(w.tag), 'DEMONSTRATION ONLY reference list — not a real exposure limit')], { importedBy: 'Demonstration operator' });
  expect(r.created).toBe(1);
  const c = new pg.Client({ connectionString: URL_ }); await c.connect();
  const q = (await c.query(`select s.id sub, bv.id bv from substances s join benchmarks b on b.substance_id=s.id join benchmark_versions bv on bv.benchmark_id=b.id where s.name=$1`, [SUB(w.tag)])).rows[0];
  await c.end();
  S.sub = q.sub; S.refBv = q.bv;
  note('Demonstration reference data', 'Benchmark 0.5 mg/m³ (8 h) for "Demo Dust Q (DEMONSTRATION ONLY)": an invented value, imported only into the disposable test database.');
});

afterAll(async () => {
  // Demonstration method approvals are platform-wide in the test schema: return to "not reviewed".
  for (const [m, v] of [['twa_8h', TWA], ['stel_15', CALCULATIONS.stel_15.version]]) await recordMethodReview(URL_, { method: m, version: v, status: 'not_reviewed', recordedBy: 'Demonstration operator' });
  await closePool();
  if (process.env.WRITE_DEMONSTRATION === '1') writeFileSync(join(__dirname, '..', 'docs', 'examples', 'demonstration-walkthrough.synthetic.md'), transcript());
});

function transcript() {
  const out = [
    '# Demonstration walkthrough — SYNTHETIC DATA',
    '',
    '> **Synthetic demonstration.** Generated by `test/demonstration.test.ts` in the disposable test database. Every organisation, person, substance, benchmark, laboratory result, method approval and pilot authorisation here is invented and labelled *synthetic demonstration*. Nothing in this file is a professional approval, a pilot gate decision, or field-validation evidence, and it must not be counted as such.',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)} · Engine: \`twa_8h\` ${TWA} · Regenerate: \`WRITE_DEMONSTRATION=1 npx vitest run test/demonstration.test.ts\``,
    '',
    '| # | Stage | Who | Outcome |',
    '|---|---|---|---|',
  ];
  let n = 0;
  for (const l of log) {
    const tag = l.kind === 'refused' ? '**Refused (expected)** — ' : l.kind === 'note' ? '*Note* — ' : '';
    out.push(`| ${++n} | ${l.title} | ${l.who ?? '—'} | ${tag}${l.detail.replace(/\|/g, '\\|')} |`);
  }
  out.push('', '## Failure cases shown', '',
    '| Case | Row(s) |', '|---|---|',
    ...[['Missing benchmark approval', /benchmark/i], ['Unsupported (unapproved) method', /method/i], ['Invalid or incomplete evidence', /invalid|incomplete/i], ['Suspension', /suspen/i], ['Changed inputs after calculation', /changed/i], ['Unauthorised approval or report issue', /unauthorised|direct/i]]
      .map(([k, re]) => `| ${k} | ${log.map((l, i) => (l.kind === 'refused' && (re as RegExp).test(l.title) ? i + 1 : null)).filter(Boolean).join(', ')} |`));
  return out.join('\n') + '\n';
}

describe('SYNTHETIC DEMONSTRATION: monitoring plan → verification decision, with failure cases', () => {
  it('1. register, instrument and monitoring plan', async () => {
    const { prac } = w.a;
    note('Environment', `Disposable test database; organisation "${w.A.tenant.name}" created for this run at evaluation level. All values synthetic.`);
    const site = await reg.createSite(prac, { client_id: w.A.clients['Client One'], name: 'Synthetic Works (demonstration)', reference: `DEMO-${w.tag}` });
    const area = await reg.createWorkArea(prac, { site_id: site.id, name: 'Mixing room' });
    const proc = await reg.createProcess(prac, { work_area_id: area.id, name: 'Powder charging' });
    const task = await reg.createTask(prac, { process_id: proc.id, name: 'Tipping sacks into the mixer', duration_min_per_shift: '480', duration_basis: 'recorded_fact' });
    const hz = await reg.createHazard(prac, { task_id: task.id, substance_id: S.sub, physical_form: 'dust', exposure_routes: ['inhalation'], exposure_duration_min: '480' });
    S.group = await reg.createGroup(prac, { site_id: site.id, name: 'Mixer operators', rationale: 'Same task, same mixer, same shift pattern; comparable work methods observed on the walk-through.', task_ids: [task.id], hazard_ids: [hz.id] });
    S.worker = await reg.createWorker(prac, { client_id: w.A.clients['Client One'], ref_code: `MX-${w.tag}`, full_name: 'Synthetic Worker One' });
    await reg.addMembership(prac, { group_id: S.group.id, worker_id: S.worker.id, valid_from: '2026-01-01' });
    S.site = site;
    S.pump = await inst.createInstrument(prac, { asset_tag: `DP-${w.tag}`, instrument_type: 'sampling_pump', make: 'Synthetic', model: 'P-1' });
    await inst.recordCalibration(prac, S.pump.id, { performed_at: '2026-01-05', valid_until: '2027-01-04', outcome: 'pass', certificate_ref: 'DEMO-CAL-1' });
    step('Register', 'Practitioner', 'Site → work area → process → task → hazard (Demo Dust Q, demonstration only) → similar exposure group with written rationale → worker (reference code).');
    step('Instrument', 'Practitioner', 'Sampling pump with a passing calibration valid at the time of sampling.');
    S.plan = await plans.createPlan(prac, { site_id: site.id, title: 'Mixer operators — baseline', purpose: 'Establish full-shift personal exposure of mixer operators', assessment_question: 'What is the 8-hour TWA exposure of mixer operators to Demo Dust Q?', approach: 'personal', strategy_rationale: 'Full-shift personal samples across representative production days.', instrument_ids: [S.pump.id] });
    await plans.addTarget(prac, S.plan.id, { group_id: S.group.id, substance_id: S.sub, method_version_id: w.ref.methodVersionId, planned_samples: '2' });
    await refused('Plan review by its author (unauthorised)', 'Practitioner', plans.transitionPlan(prac, S.plan.id, { to: 'reviewed' }), /permission|review/);
    await plans.transitionPlan(w.a.rev, S.plan.id, { to: 'reviewed' });
    await plans.transitionPlan(prac, S.plan.id, { to: 'scheduled' });
    await plans.transitionPlan(w.a.tech, S.plan.id, { to: 'in_progress' });
    step('Monitoring plan', 'Practitioner → Technical reviewer', 'Plan with target (group, substance, method, 2 planned samples) reviewed by someone other than its author, scheduled and started.');
  });

  it('2. sample records and laboratory result', async () => {
    const base = { plan_id: S.plan.id, sample_type: 'personal', worker_id: S.worker.id, substance_id: S.sub, method_version_id: w.ref.methodVersionId, instrument_id: S.pump.id, timezone: 'Europe/London', flow_pre_lpm: 2.0, flow_post_lpm: 2.0, tasks_performed: 'Sack tipping', control_status: 'LEV on' };
    S.code1 = `DQ-${w.tag}-1`; S.code2 = `DQ-${w.tag}-2`;
    const [a] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { ...base, sample_code: S.code1, start_local: '2026-03-02T08:00', end_local: '2026-03-02T16:00' } }]);
    expect(a.outcome).toBe('created'); S.s1 = a.server_id;
    // Second sample: the finish time and post-sampling flow were not recorded.
    const [b] = await field.syncBatch(w.a.tech, [{ client_uuid: randomUUID(), server_id: null, base_version: null, payload: { ...base, sample_code: S.code2, start_local: '2026-03-03T08:00', flow_post_lpm: null } }]);
    expect(b.outcome).toBe('created'); S.s2 = b.server_id;
    step('Sample records', 'Field technician', `${S.code1}: 08:00–16:00 at 2.0 L/min (960 L). ${S.code2}: finish time and post-sampling flow not recorded (kept as an incomplete record).`);
    const lb = await inst.createLaboratory(w.a.prac, { name: 'Synthetic Analytical Laboratory (demonstration)', accreditation_ref: 'DEMO-ACC-0000' });
    await lab.createSubmission(w.a.prac, { laboratory_id: lb.id, reference: `DSUB-${w.tag}`, sample_ids: [S.s1], dispatched_at: '2026-03-04T09:00' });
    const sub = (await lab.listSubmissions(w.a.prac)).find((s) => s.reference === `DSUB-${w.tag}`);
    await lab.receiveSubmission(w.a.prac, sub.id, { received_at: '2026-03-05T10:00', received_condition: 'Intact, seals unbroken' });
    const bad = await lab.stageImport(w.a.prac, { filename: 'results.csv', laboratory_id: lb.id, csv: `sample_code,analyte,value,unit,qualifier,lod\n${S.code1},${SUB(w.tag)},288,ug,=,5\nUNKNOWN-1,${SUB(w.tag)},1,ug,=,5\n` });
    expect(bad.status).toBe('rejected');
    log.push({ kind: 'refused', title: 'Laboratory file with an unknown sample code (invalid evidence)', who: 'Practitioner', detail: 'Whole file rejected at validation; nothing imported.' });
    const imp = await lab.stageImport(w.a.prac, { filename: 'results.csv', laboratory_id: lb.id, csv: `sample_code,analyte,value,unit,qualifier,lod,lab_report_ref\n${S.code1},${SUB(w.tag)},288,ug,=,5,DEMO-LR-1\n` });
    expect(imp.status).toBe('validated');
    await lab.commitImport(w.a.prac, imp.id);
    step('Laboratory result', 'Practitioner', `Chain of custody (dispatch, receipt in good condition); result file validated and committed: ${S.code1} = 288 µg.`);
  });

  it('3. calculation, and refusals before the controls are in place', async () => {
    const { revision } = await asmt.createAssessment(w.a.prac, { group_id: S.group.id, substance_id: S.sub, plan_id: S.plan.id, title: 'Mixer operators — Demo Dust Q (synthetic)', assessment_question: 'Is mixer-operator exposure to Demo Dust Q adequately controlled?' });
    S.rev = revision.id;
    S.draft = { sample_ids: [S.s1], benchmark_version_id: S.refBv, exposure_minutes_per_shift: '480', unsampled_assumption: 'none',
      interpretation: 'One full-shift personal sample, below the synthetic benchmark; one day only, so the group is not characterised.', conclusion_category: 'insufficient_evidence', limitations: 'Single sample on a single day; synthetic demonstration data.' };
    // Incomplete evidence: include the sample with no finish time and try to conclude "adequately controlled".
    await asmt.updateDraft(w.a.prac, S.rev, { ...S.draft, sample_ids: [S.s1, S.s2], conclusion_category: 'exposure_adequately_controlled' });
    const inc = await asmt.calculate(w.a.prac, S.rev);
    expect(inc.data_quality_state).toBe('incomplete');
    note('Calculation with incomplete evidence', `Data quality ${inc.data_quality_state}; comparison ${inc.benchmark_state}. ${inc.benchmark_note ?? ''}`.trim());
    await refused('Favourable conclusion on incomplete evidence', 'Practitioner', asmt.submitForReview(w.a.prac, S.rev), /cannot be concluded|complete|qualified/);
    await asmt.updateDraft(w.a.prac, S.rev, S.draft);
    const c = await asmt.calculate(w.a.prac, S.rev);
    expect(c.data_quality_state).toBe('complete');
    expect(c.benchmark_state).toBe('below_benchmark');
    expect(c.calc_output.shifts[0].twa8h.upper).toBeCloseTo(0.3, 6);
    step('Calculation', 'Practitioner', `twa_8h ${c.calc_version}: 288 µg ÷ 960 L = 0.30 mg/m³ over 480 min → 8-h TWA 0.30 mg/m³; data quality ${c.data_quality_state}; comparison with the demonstration-only 0.5 mg/m³ benchmark: ${c.benchmark_state}. "${c.calc_output.disclaimer}"`);
  });

  it('4. pilot controls: demonstration authorisation, method and benchmark gates', async () => {
    note('Demonstration records', 'The next records exist only in the disposable test database. They are labelled SYNTHETIC DEMONSTRATION and stand in for the real G11 authorisation and the hygienist\'s method approval, which have not been given.');
    await recordPilotAuthorisation(URL_, { tenantId: w.A.tenant.id, scopeRef: `${DEMO} scope`, provider: 'Demonstration Director (synthetic)', organisation: 'Demonstration Client Lead (synthetic)', authorisedOn: yesterday, document: `${DEMO}-G11`, documentFile: DOC, recordedBy: 'Demonstration operator' });
    await recordMethodReview(URL_, { method: 'stel_15', version: CALCULATIONS.stel_15.version, status: 'approved', reviewer: 'Demonstration Hygienist (synthetic)', competence: `${DEMO} — no real competence`, reviewedOn: yesterday, evidence: `${DEMO}-PACK`, evidenceFile: DOC, scope: `${DEMO} only`, recordedBy: 'Demonstration operator' });
    await setTenantLevel(URL_, w.A.tenant.id, 'pilot', 'Demonstration operator', `${DEMO}-G11`);
    await recordMethodReview(URL_, { method: 'stel_15', version: CALCULATIONS.stel_15.version, status: 'not_reviewed', recordedBy: 'Demonstration operator' });
    step('Pilot level (demonstration)', 'Platform operator', 'Demonstration organisation set to pilot level after a synthetic authorisation; the database requires both.');
    // Unsupported method: twa_8h has no approval in the demonstration database at this point.
    await refused('Method not approved for pilot use (unsupported method)', 'Practitioner', asmt.submitForReview(w.a.prac, S.rev), /not reviewed by a competent occupational hygienist/);
    await recordMethodReview(URL_, { method: 'twa_8h', version: TWA, status: 'approved', reviewer: 'Demonstration Hygienist (synthetic)', competence: `${DEMO} — no real competence`, reviewedOn: yesterday, evidence: `${DEMO}-PACK`, evidenceFile: DOC, scope: `${DEMO} only`, recordedBy: 'Demonstration operator' });
    step('Method approval (demonstration)', 'Platform operator', `twa_8h ${TWA} recorded as approved by a synthetic reviewer, with scope and hashed document.`);
    // A method the reviewer has not approved (stel_15) for the same evidence.
    await asmt.updateDraft(w.a.prac, S.rev, { ...S.draft, calc_code: 'stel_15' });
    await asmt.calculate(w.a.prac, S.rev);
    await refused('Calculation method stel_15 not approved (unsupported method)', 'Practitioner', asmt.submitForReview(w.a.prac, S.rev), /not reviewed|not comparable|averaging period|method/);
    // Missing benchmark approval: an organisation-entered benchmark that nobody has verified.
    const v = await asmt.createBenchmarkVersion(w.a.prac, { substance_id: S.sub, jurisdiction: 'ORG', benchmark_type: 'IN-HOUSE', averaging_minutes: '480', value: '1', unit: 'mg/m3', source_title: 'In-house target (synthetic)', source_version: '1', effective_from: '2020-01-01' });
    await asmt.updateDraft(w.a.prac, S.rev, { ...S.draft, benchmark_version_id: v.id });
    const nb = await asmt.calculate(w.a.prac, S.rev);
    note('Calculation against an unverified benchmark', `Comparison state: ${nb.benchmark_state}.`);
    await refused('Benchmark without professional approval (missing benchmark approval)', 'Practitioner', asmt.submitForReview(w.a.prac, S.rev), /Organisation-entered and synthetic benchmarks|benchmark/);
    await asmt.updateDraft(w.a.prac, S.rev, S.draft);
    await asmt.calculate(w.a.prac, S.rev);
    await asmt.submitForReview(w.a.prac, S.rev);
    step('Submission for review', 'Practitioner', 'Approved method (demonstration) and professional-reference benchmark (demonstration-only value): submission accepted.');
  });

  it('5. review: changed inputs, suspension and unauthorised approval are refused', async () => {
    // Changed inputs after calculation: a QC check is added to the sample while the revision is in review.
    await field.addQcCheck(w.a.prac, S.s1, { check_type: 'Post-sampling cassette inspection', outcome: 'pass', detail: 'Recorded after the calculation' });
    await refused('Evidence changed after calculation', 'Technical reviewer', asmt.approve(w.a.rev, S.rev, { approval_scope: 'Mixer operators, March 2026', approval_limitations: 'Single day; synthetic data', confirm_reviewed: 'on' }), /Recalculate|changed/);
    await asmt.returnToDraft(w.a.rev, S.rev, { notes: 'Evidence changed after calculation; recalculate' });
    await asmt.calculate(w.a.prac, S.rev);
    await asmt.submitForReview(w.a.prac, S.rev);
    step('Recalculation', 'Practitioner', 'Returned to draft, recalculated on the current evidence, resubmitted.');
    // Unauthorised approval: the practitioner (submitter) through the service, and directly in the database.
    await refused('Approval by the submitting practitioner (unauthorised)', 'Practitioner', asmt.approve(w.a.prac, S.rev, { approval_scope: 'Mixer operators', approval_limitations: 'Synthetic', confirm_reviewed: 'on' }), /permission|assess.approve/);
    await refused('Direct database approval with the application credentials (unauthorised)', 'Practitioner (direct SQL)', withActor(w.a.prac, (tx) => tx.query(`update assessment_revisions set status='approved', reviewer_id=$2 where id=$1`, [S.rev, w.a.prac.userId])), /refused|reviewer|submitter|permission/);
    // Suspension of assessment approval.
    await suspendWorkflows(URL_, w.A.tenant.id, ['assessment_approval'], `${DEMO}: stop condition exercise`, 'Demonstration operator');
    await refused('Approval while assessment approval is suspended (suspension)', 'Technical reviewer', asmt.approve(w.a.rev, S.rev, { approval_scope: 'Mixer operators, March 2026', approval_limitations: 'Single day; synthetic data', confirm_reviewed: 'on' }), /suspended/);
    await resumeWorkflows(URL_, w.A.tenant.id, ['assessment_approval'], 'Demonstration operator', `${DEMO}-REVALIDATION`);
    step('Suspension and resumption', 'Platform operator', 'Assessment approval suspended (refusal shown above), then resumed with a revalidation reference.');
    const ap = await asmt.approve(w.a.rev, S.rev, { approval_scope: 'Mixer operators, March 2026 (synthetic demonstration)', approval_limitations: 'Single sample on one day; group not characterised; synthetic data', confirm_reviewed: 'on' });
    expect(ap.status).toBe('approved');
    step('Review and approval', 'Technical reviewer', `Approved by someone other than the submitter; frozen with method status "${ap.method_review_status}", benchmark provenance "${ap.benchmark_provenance}", assurance level "${ap.assurance_level_at_approval}" and snapshot hash ${String(ap.snapshot_hash).slice(0, 12)}…`);
  });

  it('6. report issue: unauthorised issue is refused', async () => {
    S.asmtId = (await withActor(w.a.prac, (tx) => tx.query('select assessment_id from assessment_revisions where id=$1', [S.rev]))).rows[0].assessment_id;
    const fake = '<p>Fabricated report: exposure adequately controlled</p>';
    const ins = (html: string, hash: string, by: any) => withActor(by, (tx) => tx.query(`insert into reports (tenant_id,client_id,assessment_id,assessment_revision_id,version,status,content_html,content_hash,generated_by)
      select tenant_id, client_id, assessment_id, id, 99, 'issued', $3, $4, $2 from assessment_revisions where id=$1`, [S.rev, by.userId, html, hash]));
    const { createHash } = await import('node:crypto');
    const h = (x: string) => createHash('sha256').update(x).digest('hex');
    await refused('Direct insert of an issued report with fabricated content (unauthorised report issue)', 'Practitioner (direct SQL)', ins(fake, 'x', w.a.prac), /content hash does not match/);
    await refused('Direct insert of an issued report not bound to its approval record (unauthorised report issue)', 'Practitioner (direct SQL)', ins(fake, h(fake), w.a.prac), /approval record hash/);
    const snap = (await withActor(w.a.prac, (tx) => tx.query('select snapshot_hash from assessment_revisions where id=$1', [S.rev]))).rows[0].snapshot_hash;
    const bound = `${fake}<code>${snap}</code>`;
    await refused('Direct insert of an issued report by a field technician (unauthorised report issue)', 'Field technician (direct SQL)', ins(bound, h(bound), w.a.tech), /issuer must be an active practitioner or technical reviewer|reports are generated by an active practitioner or technical reviewer/);
    note('Residual (finding R2-P4)', 'The database checks the content hash, the approval record hash, the issuer and every approval prerequisite. It cannot check that the rest of a report was rendered by the application: a practitioner or reviewer (who may issue reports anyway) writing directly to the database could store other text carrying the correct approval hash. Such a report has no matching report.issued audit event and differs from a re-rendered report.');
    await refused('Report issue by a client read-only user (unauthorised report issue)', 'Client (read-only)', rep.generateReport(w.a.client1, S.asmtId, S.rev), /permission|not found/);
    const r = await rep.generateReport(w.a.rev, S.asmtId, S.rev);
    expect(r.status).toBe('issued');
    const html = (await rep.getReport(w.a.client1, r.id)).content_html;
    expect(html).toMatch(/DEMONSTRATION ONLY/);
    step('Report issue', 'Technical reviewer → Client', 'Report issued from the approved revision; the client can read it; the substance and benchmark source are labelled DEMONSTRATION ONLY, and it carries the statement that a comparison is not a compliance conclusion.');
  });

  it('7. control action, follow-up evidence and verification decision', async () => {
    const today = new Date().toISOString().slice(0, 10);
    S.lev = await ctl.createControl(w.a.prac, { site_id: S.site.id, name: 'Sack-tipping booth LEV', kind: 'local_exhaust_ventilation', purpose: 'Capture dust at the tipping point', group_id: S.group.id, owner_user_id: w.a.owner.userId, performance_criteria: 'Face velocity ≥ 0.5 m/s across the booth opening' });
    const act = await ctl.createAction(w.a.prac, { title: 'Improve booth capture at the tipping point', control_id: S.lev.id, owner_user_id: w.a.owner.userId, verification_requirement: 'Face-velocity test across the opening and follow-up personal sampling', requires_exposure_reassessment: '' });
    note('Action closure rule', 'If an action is marked as needing exposure reassessment, it can only be reviewed as effective once an approved follow-up assessment exists. This demonstration closes on measured control performance only.');
    step('Control action', 'Practitioner', 'Action on the booth extraction with a measurable verification requirement, assigned to the action owner.');
    await ctl.markImplemented(w.a.owner, act.id, { notes: 'Baffles fitted and fan speed increased (synthetic)' });
    const vis = await ctl.recordInspection(w.a.owner, S.lev.id, { at: today, kind: 'routine_inspection', outcome: 'satisfactory' });
    await ctl.submitEvidence(w.a.owner, act.id, { inspection_id: vis.id, notes: 'Visual check after the change' });
    await refused('Closure on installation evidence alone (invalid evidence)', 'Technical reviewer', ctl.reviewEffectiveness(w.a.rev, act.id, { outcome: 'effective', notes: 'Looks right after the change; installed as specified.' }), /Installation alone|measur|performance|approved/);
    await ctl.reviewEffectiveness(w.a.rev, act.id, { outcome: 'not_effective', notes: 'No performance evidence; needs the face-velocity test.' });
    await ctl.markImplemented(w.a.owner, act.id, { notes: 'Resubmitting with the face-velocity test' });
    const test = await ctl.recordInspection(w.a.owner, S.lev.id, { at: today, kind: 'performance_test', outcome: 'satisfactory', measurements: 'Face velocity 0.6–0.8 m/s at 9 points (synthetic)' });
    await ctl.submitEvidence(w.a.owner, act.id, { inspection_id: test.id, notes: 'Face-velocity test report (synthetic)' });
    step('Follow-up evidence', 'Action owner', 'Measured face velocity submitted after the visual check was rejected as insufficient.');
    await ctl.reviewEffectiveness(w.a.rev, act.id, { outcome: 'effective', notes: 'Face velocity meets the criterion at all points of the booth opening.' });
    await ctl.closeVerified(w.a.rev, act.id, { notes: 'Verified on the measured face velocity (synthetic)' });
    const d = await ctl.actionDetail(w.a.prac, act.id);
    expect(d.action.status).toBe('verified_closed');
    const g = await reg.groupDetail(w.a.prac, S.group.id);
    step('Verification decision', 'Technical reviewer', `Action closed as verified on measured performance (status ${d.action.status}). Group flagged for exposure reassessment: ${g.group.review_required ? 'yes' : 'no'}.`);
  });
});
