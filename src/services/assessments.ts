import { z } from 'zod';
import { sha256 } from '../auth/crypto.js';
import { CALCULATIONS, comparability, duplicateProblem, DUPLICATE_TYPES, runAssessment, sampleConcentration, serialiseOutput, STEL_REMAINDER_EVIDENCE, type BenchmarkRef, type CalcCode, type DuplicateType, type ExposureRecord, type SampleInput } from '../calc/engine.js';
import { audit, can, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { conflict, forbidden, invalid, notFound } from '../errors.js';
import { calibrationValidAt } from './instruments.js';
import { enqueue } from './integrations.js';
import { assertAssessmentNotOnHold, assertConclusionAllowed, assertWorkflowActive, METHOD_APPROVED, methodReview, tenantControls } from './assurance.js';
import { bool, date, optNum, optStr, optUuid, parse, reqStr, strArray, uuid } from './util.js';

// ───── Benchmarks
export async function createBenchmarkVersion(a: Actor, input: unknown) {
  requirePerm(a, 'benchmark.write');
  const d = parse(z.object({
    substance_id: uuid, jurisdiction: reqStr(2, 10), benchmark_type: reqStr(2, 40), averaging_minutes: z.coerce.number().int().positive(),
    value: z.coerce.number().positive(), unit: z.enum(['mg/m3', 'ppm', 'f/ml']), annotations: strArray,
    source_title: reqStr(3, 300), source_version: reqStr(1, 100), source_url: optStr, effective_from: date, effective_to: z.preprocess((v) => (v === '' ? undefined : v), date.optional()).transform((v) => v ?? null),
  }), input);
  return withActor(a, async (tx) => {
    let b = await one(tx, 'select * from benchmarks where tenant_id=$1 and substance_id=$2 and jurisdiction=$3 and benchmark_type=$4', [a.tenantId, d.substance_id, d.jurisdiction, d.benchmark_type]);
    if (!b) b = await one(tx, 'insert into benchmarks (tenant_id,substance_id,jurisdiction,benchmark_type,averaging_minutes) values ($1,$2,$3,$4,$5) returning *', [a.tenantId, d.substance_id, d.jurisdiction, d.benchmark_type, d.averaging_minutes]);
    else if (b.averaging_minutes !== d.averaging_minutes) throw invalid('Averaging period differs from the existing benchmark of this type');
    const v = await one(tx, `insert into benchmark_versions (tenant_id,benchmark_id,value,unit,annotations,source_title,source_version,source_url,effective_from,effective_to,verification_status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unverified') returning *`,
      [a.tenantId, b.id, d.value, d.unit, d.annotations, d.source_title, d.source_version, d.source_url, d.effective_from, d.effective_to]);
    await audit(tx, a, 'benchmark.version_create', 'benchmark_version', v.id, d);
    return v;
  });
}

export async function verifyBenchmarkVersion(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'benchmark.verify');
  const d = parse(z.object({ status: z.enum(['verified', 'withdrawn']), note: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const v = await one(tx, 'select * from benchmark_versions where id=$1 and tenant_id=$2 for update', [id, a.tenantId]);
    if (!v) throw notFound('Tenant benchmark version');
    if (v.verification_status === 'withdrawn' || v.verification_status === d.status) throw invalid(`This benchmark version is already ${v.verification_status}`);
    const creator = await one(tx, `select user_id from audit_events where action='benchmark.version_create' and entity_id=$1`, [id]);
    if (creator?.user_id === a.userId) throw forbidden('A benchmark must be verified by someone other than the person who entered it');
    const r = await one(tx, 'update benchmark_versions set verification_status=$2, verified_by=$3, verified_at=now() where id=$1 returning *', [id, d.status, `${a.name} <${a.email}>`]);
    await audit(tx, a, `benchmark.${d.status}`, 'benchmark_version', id, d);
    return r;
  });
}

export async function listBenchmarks(a: Actor, substanceId?: string) {
  return withActor(a, (tx) => many(tx, `select v.*, b.jurisdiction, b.benchmark_type, b.averaging_minutes, b.substance_id, s.name substance_name, s.cas_number, b.tenant_id is null as platform
    from benchmark_versions v join benchmarks b on b.id=v.benchmark_id join substances s on s.id=b.substance_id
    where ($1::uuid is null or b.substance_id=$1) order by s.name, b.benchmark_type, v.effective_from desc`, [substanceId ?? null]));
}

// ───── Inputs
type Snapshot = { samples: SampleInput[]; refs: { sampleId: string; version: number; resultRevisionId: string | null; qcIds: string[] }[]; benchmark: BenchmarkRef | null; parameters: any; exposureRecords: ExposureRecord[]; molecularWeight?: number | null };

async function buildSnapshot(tx: Tx, rev: any, substanceId: string): Promise<Snapshot> {
  const samples: SampleInput[] = [];
  const refs: Snapshot['refs'] = [];
  for (const sid of rev.sample_ids as string[]) {
    const e = await one(tx, `select e.*, w.ref_code from sampling_events e left join workers w on w.id=e.worker_id where e.id=$1`, [sid]);
    if (!e) throw notFound('Sample in assessment');
    const mv = e.method_version_id ? await one(tx, 'select v.*, m.code from sampling_method_versions v join sampling_methods m on m.id=v.method_id where v.id=$1', [e.method_version_id]) : null;
    const inst = e.instrument_id ? await one(tx, 'select asset_tag, screening_only from instruments where id=$1', [e.instrument_id]) : null;
    const cal = e.instrument_id && e.start_at ? await calibrationValidAt(tx, e.instrument_id, e.start_at.toISOString()) : null;
    const qc = await many(tx, 'select id, check_type, outcome, disposition from sample_qc_checks where sampling_event_id=$1 order by recorded_at, id', [sid]);
    const res = await one(tx, `select v.* from lab_results r join lab_result_revisions v on v.result_id=r.id and v.revision=r.current_revision where r.sampling_event_id=$1 and r.substance_id=$2`, [sid, substanceId]);
    // TR-05: reviewer acceptances of failed method criteria; TR-02: the latest evidence disposition for this revision.
    const acc = await many(tx, 'select d.criterion, d.evidence, d.scope, u.name from sample_acceptance_dispositions d join users u on u.id=d.authorised_by where d.sampling_event_id=$1 order by d.criterion', [sid]);
    const disp = await one(tx, `select d.kind, d.reason, d.consequence, d.duplicate_type, u.name, rs.sample_code related from assessment_evidence_dispositions d join users u on u.id=d.recorded_by
      left join sampling_events rs on rs.id=d.related_sampling_event_id where d.revision_id=$1 and d.sampling_event_id=$2 order by d.seq desc limit 1`, [rev.id, sid]);
    samples.push({
      sampleId: e.id, sampleCode: e.sample_code, sampleType: e.sample_type, subjectRef: e.sample_type === 'personal' ? e.ref_code : e.location_desc, voided: e.status === 'void',
      startAt: e.start_at?.toISOString() ?? null, endAt: e.end_at?.toISOString() ?? null, timezone: e.timezone, shiftRef: e.shift_ref ?? null,
      // TR-06 relationship evidence: the substance of the result used here, exposure group at sampling, tasks, pair reference.
      substanceRef: res ? substanceId : null, groupRef: e.group_id_at_sampling ?? null, tasksPerformed: e.tasks_performed ?? null, pairRef: e.pair_ref ?? null,
      interruptions: e.interruptions ?? [], flowPreLpm: e.flow_pre_lpm, flowPostLpm: e.flow_post_lpm,
      method: mv ? { code: mv.code, version: mv.version, resultBasis: mv.result_basis, flowDriftTolerancePct: mv.flow_drift_tolerance_pct, minVolumeL: mv.min_volume_l, suitableForFormalAssessment: mv.suitable_for_formal_assessment,
        acceptance: { flowDrift: mv.flow_drift_consequence ?? null, minVolume: mv.min_volume_consequence ?? null } } : null,
      acceptanceDispositions: acc.map((x) => ({ criterion: x.criterion, evidence: x.evidence, scope: x.scope, authorisedBy: x.name })),
      evidenceDisposition: disp ? { kind: disp.kind, reason: disp.reason, consequence: disp.consequence, authorisedBy: disp.name, relatedSampleCode: disp.related ?? null, duplicateType: disp.duplicate_type ?? null } : null,
      instrument: inst ? { assetTag: inst.asset_tag, screeningOnly: inst.screening_only, calibrationValidAtSampling: cal } : null,
      qc: qc.map((q) => ({ checkType: q.check_type, outcome: q.outcome, disposition: q.disposition })),
      result: res ? { revision: res.revision, value: res.value, unit: res.unit, qualifier: res.qualifier, lod: res.lod, loq: res.loq, labQualifier: res.lab_qualifier ?? null, valueMeaning: res.value_meaning ?? null } : null,
    });
    refs.push({ sampleId: e.id, version: e.version, resultRevisionId: res?.id ?? null, qcIds: qc.map((q) => `${q.id}:${q.disposition ?? ''}`) });
  }
  let benchmark: BenchmarkRef | null = null;
  if (rev.benchmark_version_id) {
    const b = await one(tx, `select v.*, b.benchmark_type, b.averaging_minutes, b.jurisdiction from benchmark_versions v join benchmarks b on b.id=v.benchmark_id where v.id=$1`, [rev.benchmark_version_id]);
    if (b) benchmark = { versionId: b.id, type: `${b.jurisdiction} ${b.benchmark_type}`, averagingMinutes: b.averaging_minutes, value: b.value, unit: b.unit, verificationStatus: b.verification_status, isSynthetic: b.is_synthetic, source: `${b.source_title}, ${b.source_version}` };
  }
  // Exposure records from the register for this group and substance (engine 1.4.0, item B). One record per task (a task
  // with several hazards for the substance counts once, at its longest stated duration); hazards without a task count alone.
  const recs = await many(tx, `select t.id, t.name ref,
      max(coalesce(h.exposure_duration_min, t.duration_min_per_shift)) minutes,
      case when bool_and(case when h.exposure_duration_min is not null then h.exposure_basis else t.duration_basis end in ('recorded_fact','professionally_reviewed'))
        then 'recorded_fact' else 'user_estimate' end basis,
      min(t.typical_start_min) start_min, max(t.typical_end_min) end_min
    from exposure_group_hazards gh join hazards h on h.id=gh.hazard_id join tasks t on t.id=h.task_id
    where gh.group_id=$1 and h.substance_id=$2 group by t.id, t.name order by t.name`, [rev.group_id, substanceId]);
  const exposureRecords: ExposureRecord[] = recs.filter((r) => r.minutes != null || r.start_min != null)
    .map((r) => ({ ref: r.ref, minutes: r.minutes == null ? null : Number(r.minutes), basis: r.basis, startMin: r.start_min, endMin: r.end_min }));
  const mw = (await one(tx, 'select molecular_weight from substances where id=$1', [substanceId]))?.molecular_weight ?? null;
  return { samples, refs, benchmark, parameters: rev.parameters, exposureRecords, molecularWeight: mw };
}
const calcOf = (code: string | null | undefined) => CALCULATIONS[(code as CalcCode) ?? 'twa_8h'] ?? CALCULATIONS.twa_8h;
const hashOf = (s: Snapshot, calcCode: string | null | undefined) => sha256(JSON.stringify({ samples: s.samples, refs: s.refs, benchmark: s.benchmark, parameters: s.parameters, exposure: s.exposureRecords, mw: s.molecularWeight ?? null, calc: calcOf(calcCode) }));

// ───── Lifecycle
export async function createAssessment(a: Actor, input: unknown) {
  requirePerm(a, 'assess.write');
  const d = parse(z.object({ group_id: uuid, substance_id: uuid, plan_id: optUuid, title: reqStr(3, 200), assessment_question: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const g = await one(tx, 'select client_id from exposure_groups where id=$1', [d.group_id]);
    if (!g) throw notFound('Exposure group');
    const as = await one(tx, 'insert into assessments (tenant_id,client_id,group_id,substance_id,plan_id,title,assessment_question,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
      [a.tenantId, g.client_id, d.group_id, d.substance_id, d.plan_id, d.title, d.assessment_question, a.userId]);
    const samples = await many(tx, `select id from sampling_events where group_id_at_sampling=$1 and substance_id=$2 and status='analysed' and client_id=$4 and ($3::uuid is null or plan_id=$3)`, [d.group_id, d.substance_id, d.plan_id, g.client_id]);
    const rev = await one(tx, `insert into assessment_revisions (tenant_id,client_id,assessment_id,revision,sample_ids,calc_code,calc_version,parameters,created_by)
      values ($1,$2,$3,1,$4,'twa_8h',$5,$6,$7) returning *`,
      [a.tenantId, g.client_id, as.id, samples.map((s) => s.id), CALCULATIONS.twa_8h.version, { exposureMinutesPerShift: null, unsampledAssumption: 'none' }, a.userId]);
    await audit(tx, a, 'assessment.create', 'assessment', as.id, d);
    return { assessment: as, revision: rev };
  });
}

const draftSchema = z.object({
  calc_code: z.enum(['twa_8h', 'stel_15']).default('twa_8h'),
  short_sample_assumption: z.enum(['none', 'zero_remainder']).default('none'),
  short_sample_justification: optStr,
  short_sample_evidence_basis: z.preprocess((v) => (v === '' ? undefined : v), z.enum(STEL_REMAINDER_EVIDENCE).optional()).transform((v) => v ?? null),
  short_sample_evidence_ref: optStr,
  sample_ids: strArray.pipe(z.array(uuid)),
  benchmark_version_id: optUuid,
  exposure_minutes_per_shift: optNum,
  unsampled_assumption: z.enum(['none', 'zero_exposure', 'same_as_sampled']).default('none'),
  unsampled_justification: optStr,
  interpretation: optStr,
  interpretation_ai_assisted: bool.optional(),
  conclusion_category: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['exposure_adequately_controlled', 'improvement_required', 'urgent_action_required', 'insufficient_evidence']).optional()).transform((v) => v ?? null),
  limitations: optStr,
});

async function loadRev(tx: Tx, revId: string, lock = false) {
  const r = await one(tx, `select r.*, a.substance_id, a.group_id, a.title, a.created_by assessment_created_by from assessment_revisions r join assessments a on a.id=r.assessment_id where r.id=$1 ${lock ? 'for update of r' : ''}`, [revId]);
  if (!r) throw notFound('Assessment revision');
  return r;
}

export async function updateDraft(a: Actor, revId: string, input: unknown) {
  requirePerm(a, 'assess.write');
  const d = parse(draftSchema, input);
  return withActor(a, async (tx) => {
    const r = await loadRev(tx, revId, true);
    await assertAssessmentNotOnHold(tx, r.assessment_id);
    if (r.status !== 'draft') throw invalid(`Only draft revisions can be edited (this one is ${r.status}). Create a new revision.`);
    for (const sid of d.sample_ids) {
      const e = await one(tx, `select e.client_id, e.substance_id, e.sample_code,
          exists (select 1 from lab_results lr where lr.sampling_event_id=e.id and lr.substance_id=$2) has_result
        from sampling_events e where e.id=$1`, [sid, r.substance_id]);
      if (!e || e.client_id !== r.client_id) throw notFound('Sample');
      if (e.substance_id !== r.substance_id && !e.has_result) throw invalid(`Sample ${e.sample_code} was not taken or analysed for this assessment's substance`);
    }
    if (d.benchmark_version_id) {
      const b = await one(tx, 'select b.substance_id from benchmark_versions v join benchmarks b on b.id=v.benchmark_id where v.id=$1', [d.benchmark_version_id]);
      if (!b) throw notFound('Benchmark version');
      if (b.substance_id !== r.substance_id) throw invalid('Benchmark is for a different substance');
    }
    const parameters = d.calc_code === 'stel_15'
      ? { shortSampleAssumption: d.short_sample_assumption, shortSampleJustification: d.short_sample_justification ?? undefined, shortSampleEvidenceBasis: d.short_sample_evidence_basis, shortSampleEvidenceRef: d.short_sample_evidence_ref }
      : { exposureMinutesPerShift: d.exposure_minutes_per_shift, unsampledAssumption: d.unsampled_assumption, unsampledJustification: d.unsampled_justification ?? undefined };
    const out = await one(tx, `update assessment_revisions set sample_ids=$2, benchmark_version_id=$3, parameters=$4, interpretation=$5, conclusion_category=$6, limitations=$7,
        calc_code=$8, calc_version=$9, calc_output=null, data_quality_state=null, benchmark_state=null, inputs_snapshot=null, inputs_hash=null where id=$1 returning *`,
      [revId, d.sample_ids, d.benchmark_version_id, parameters, d.interpretation, d.conclusion_category, d.limitations, d.calc_code, calcOf(d.calc_code).version]);
    await audit(tx, a, 'assessment.draft_update', 'assessment_revision', revId, { ...d, interpretation: d.interpretation ? `[${d.interpretation.length} chars]` : null });
    return out;
  });
}

/**
 * TR-02: disposition of a personal sample that cannot serve as formal evidence in this draft revision (excluded,
 * indicative or uncalculable). The engine needs a disposition before a favourable overall comparison is possible:
 *  - duplicate (TR-06, engine 1.5.0): a supported duplicate category with matching relationship evidence —
 *      same_event_record: a second record of the same sampling event (same worker, instrument, window ±1 min);
 *      paired_colocated:  a paired / co-located sampler with the same pair reference recorded at capture, run at the same time.
 *    Both also need the same worker, substance, exposure group, tasks and shift. A different sample offered as evidence
 *    that the remaining coverage is adequate is NOT a duplicate (reviewer-only remaining_coverage_adequate).
 *    A set-aside result higher than the retained paired result (or a disagreeing record of one event) is a conflict and
 *    is refused: a duplicate label cannot suppress adverse evidence.
 *  - outside_scope (reviewer): the sample is not part of what this assessment covers;
 *  - not_replaced: the worker or task it covered remains unassessed (blocks a favourable overall comparison);
 *  - remaining_coverage_adequate (reviewer): the remaining evidence is judged adequate (stated consequence).
 * Append-only; the latest row per sample applies. Recorded on draft revisions only. The engine re-checks every
 * disposition at calculation, so a later change of evidence cannot leave an unsupported disposition in effect.
 */
export async function recordEvidenceDisposition(a: Actor, revId: string, input: unknown) {
  if (!can(a, 'assess.write') && !can(a, 'assess.approve')) throw forbidden('Only a practitioner or technical reviewer can disposition evidence');
  const d = parse(z.object({ sample_id: uuid, kind: z.enum(['duplicate', 'outside_scope', 'not_replaced', 'remaining_coverage_adequate']), reason: reqStr(10), consequence: reqStr(10), related_sample_id: optUuid,
    duplicate_type: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(DUPLICATE_TYPES as [DuplicateType, ...DuplicateType[]]).optional()).transform((v) => v ?? null) }), input);
  if (d.kind === 'duplicate' && !d.related_sample_id) throw invalid('A duplicate must name the valid sample it duplicates');
  if (d.related_sample_id && d.related_sample_id === d.sample_id) throw invalid('A sample cannot be a duplicate of itself');
  if (d.kind === 'duplicate' && !d.duplicate_type) throw invalid('State the duplicate category: a second record of the same sampling event, or a paired / co-located sampler. A different sample offered as evidence that the remaining coverage is adequate is not a duplicate; a technical reviewer records that as "remaining coverage adequate".');
  if (d.kind !== 'duplicate' && (d.duplicate_type || d.related_sample_id)) throw invalid('A related sample and a duplicate category apply only to a duplicate disposition');
  if ((d.kind === 'remaining_coverage_adequate' || d.kind === 'outside_scope') && !can(a, 'assess.approve')) throw forbidden('Only a technical reviewer can set evidence aside as outside scope or accept that the remaining coverage is adequate');
  return withActor(a, async (tx) => {
    const r = await loadRev(tx, revId, true);
    await assertAssessmentNotOnHold(tx, r.assessment_id);
    if (r.status !== 'draft') throw invalid('Evidence can only be dispositioned on a draft revision');
    if (!r.sample_ids.includes(d.sample_id)) throw invalid('The sample is not part of this revision');
    if (d.related_sample_id && !r.sample_ids.includes(d.related_sample_id)) throw invalid('The related sample is not part of this revision');
    const snap = await buildSnapshot(tx, r, r.substance_id);
    const pick = (id: string) => { const i = snap.samples.findIndex((x) => x.sampleId === id); return i < 0 ? undefined : { input: snap.samples[i], output: sampleConcentration(snap.samples[i]) }; };
    const self = pick(d.sample_id)!;
    // TR-07: contradictory or invalid inputs await laboratory clarification; they can only be recorded as not replaced.
    if (d.kind !== 'not_replaced' && self.output.flags.some((f) => f.code.startsWith('INPUT_INVALID_')))
      throw invalid(`${self.input.sampleCode} has contradictory or invalid inputs awaiting correction (${self.output.flags.filter((f) => f.code.startsWith('INPUT_INVALID_')).map((f) => f.message).join(' ')}) It cannot be set aside; record it as not replaced or amend the result.`);
    if (d.kind === 'duplicate') {
      // Same rule as the engine (duplicateProblem); refused here with the reason so that nothing unsupported is recorded.
      const rel = pick(d.related_sample_id!);
      const p = duplicateProblem({ kind: 'duplicate', reason: d.reason, consequence: d.consequence, authorisedBy: a.name, relatedSampleCode: rel?.input.sampleCode ?? null, duplicateType: d.duplicate_type }, self, rel);
      if (p) throw invalid(`Duplicate refused for ${self.input.sampleCode}: ${p.problem}.`);
    }
    const row = await one(tx, `insert into assessment_evidence_dispositions (tenant_id,client_id,revision_id,sampling_event_id,kind,reason,consequence,related_sampling_event_id,recorded_by,duplicate_type)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [r.tenant_id, r.client_id, revId, d.sample_id, d.kind, d.reason, d.consequence, d.related_sample_id, a.userId, d.duplicate_type]);
    // The calculation no longer reflects the evidence: clear it so it must be rerun.
    await tx.query('update assessment_revisions set calc_output=null, data_quality_state=null, benchmark_state=null, inputs_snapshot=null, inputs_hash=null where id=$1', [revId]);
    await audit(tx, a, 'assessment.evidence_disposition', 'assessment_revision', revId, { ...d, sample_code: self.input.sampleCode, related_sample_code: d.related_sample_id ? pick(d.related_sample_id)?.input.sampleCode ?? null : null,
      sample_interval: self.output.concentration, sample_flags: self.output.flags.map((f) => f.code) });
    return row;
  });
}

/**
 * Evidence dispositions of the revision this one supersedes, re-checked against the current rules and records
 * (engine 1.5.0). Dispositions are per revision and are not carried forward automatically; this shows, for the report
 * and the reviewer, how earlier treatment of evidence stands now (e.g. a 1.4.0 "duplicate" across sampling windows).
 */
export async function priorDispositionReview(tx: Tx, rev: any) {
  if (!rev.supersedes_revision_id) return null;
  const prev = await one(tx, 'select r.id, r.revision, r.sample_ids, r.status, a.substance_id from assessment_revisions r join assessments a on a.id=r.assessment_id where r.id=$1', [rev.supersedes_revision_id]);
  if (!prev) return null;
  const rows = await many(tx, `select distinct on (d.sampling_event_id) d.kind, d.duplicate_type, d.reason, d.consequence, d.recorded_at, d.sampling_event_id, d.related_sampling_event_id, u.name by_name, s.sample_code, rs.sample_code related_code
    from assessment_evidence_dispositions d join users u on u.id=d.recorded_by join sampling_events s on s.id=d.sampling_event_id left join sampling_events rs on rs.id=d.related_sampling_event_id
    where d.revision_id=$1 order by d.sampling_event_id, d.seq desc`, [prev.id]);
  if (!rows.length) return { revision: prev.revision, items: [] };
  const ids = [...new Set([...(rev.sample_ids ?? []), ...prev.sample_ids])];
  const snap = await buildSnapshot(tx, { ...rev, sample_ids: ids }, prev.substance_id);
  const pick = (id: string | null) => { const i = snap.samples.findIndex((x) => x.sampleId === id); return i < 0 ? undefined : { input: snap.samples[i], output: sampleConcentration(snap.samples[i]) }; };
  const items = rows.map((d) => {
    const self = pick(d.sampling_event_id);
    let status: string;
    if (d.kind === 'duplicate') {
      const p = self ? duplicateProblem({ kind: 'duplicate', reason: d.reason, consequence: d.consequence, authorisedBy: d.by_name, relatedSampleCode: d.related_code, duplicateType: d.duplicate_type }, self, pick(d.related_sampling_event_id)) : { problem: 'the sample is no longer available', conflict: false };
      status = p ? `not accepted under the current rules: ${p.problem}` : 'consistent with the current relationship rules; it applies only if recorded again in this revision';
    } else status = 'a judgement for that revision; it applies only if recorded again in this revision';
    const inThis = (rev.sample_ids ?? []).includes(d.sampling_event_id);
    return { sampleCode: d.sample_code, kind: d.kind, duplicateType: d.duplicate_type, relatedSampleCode: d.related_code, by: d.by_name, recordedAt: d.recorded_at, reason: d.reason, consequence: d.consequence,
      interval: self?.output.concentration ?? null, inThisRevision: inThis, status };
  });
  return { revision: prev.revision, items };
}

export async function calculate(a: Actor, revId: string) {
  requirePerm(a, 'assess.write');
  return withActor(a, async (tx) => {
    const r = await loadRev(tx, revId, true);
    await assertAssessmentNotOnHold(tx, r.assessment_id);
    if (r.status !== 'draft') throw invalid('Only draft revisions can be recalculated');
    const snap = await buildSnapshot(tx, r, r.substance_id);
    const calc = calcOf(r.calc_code);
    const output = runAssessment({ calc: calc.code, samples: snap.samples, parameters: { ...snap.parameters, exposureRecords: snap.exposureRecords }, benchmark: snap.benchmark, molecularWeight: snap.molecularWeight });
    const hash = hashOf(snap, calc.code);
    const out = await one(tx, `update assessment_revisions set calc_output=$2, data_quality_state=$3, benchmark_state=$4, inputs_snapshot=$5, inputs_hash=$6, calc_code=$8, calc_version=$7 where id=$1 returning *`,
      [revId, serialiseOutput(output), output.dataQualityState, output.benchmarkState, snap, hash, calc.version, calc.code]);
    await audit(tx, a, 'assessment.calculated', 'assessment_revision', revId, { dq: output.dataQualityState, benchmark: output.benchmarkState, hash });
    return out;
  });
}

async function assertCurrent(tx: Tx, r: any) {
  if (!r.calc_output || !r.inputs_hash) throw invalid('Run the calculation first');
  // Share-lock the evidence so that no result amendment, QC disposition or void can commit between this check and the
  // end of the transaction (writers take FOR UPDATE on the same sampling-event rows).
  await tx.query('select id from sampling_events where id = any($1) order by id for share', [r.sample_ids ?? []]);
  // Calibration evidence and the benchmark version also feed the calculation: lock them against concurrent change.
  await tx.query('select i.id from instruments i join sampling_events e on e.instrument_id = i.id where e.id = any($1) order by i.id for share of i', [r.sample_ids ?? []]);
  if (r.benchmark_version_id) await tx.query('select id from benchmark_versions where id=$1 for share', [r.benchmark_version_id]);
  const pending = await one(tx, `select e.sample_code from sampling_events e where e.id = any($1) and ((e.suspension_review_required and e.suspension_reviewed_at is null)
      or exists (select 1 from field_intake_holds h where h.status in ('held','in_conflict') and (h.server_id = e.id or h.sampling_event_id = e.id))) limit 1`, [r.sample_ids ?? []]);
  if (pending) throw invalid(`Sample ${pending.sample_code} reached the server during a suspension and must be reviewed (Sync conflicts → Held field records) before this assessment can be submitted or approved.`);
  const snap = await buildSnapshot(tx, r, r.substance_id);
  if (hashOf(snap, r.calc_code) !== r.inputs_hash) throw conflict('Underlying evidence has changed since the calculation was run (e.g. an amended laboratory result or QC disposition). Recalculate before continuing.');
}

function checkConclusion(r: any) {
  if (!r.interpretation || r.interpretation.trim().length < 30) throw invalid('A professional interpretation (min 30 characters) is required');
  if (!r.conclusion_category) throw invalid('Select a conclusion category');
  if (!r.limitations || r.limitations.trim().length < 10) throw invalid('State the limitations and uncertainty of this assessment');
  if (r.conclusion_category === 'exposure_adequately_controlled') {
    if (['failed', 'incomplete'].includes(r.data_quality_state)) throw invalid(`"Exposure adequately controlled" cannot be concluded when data quality is ${r.data_quality_state}`);
    if (r.benchmark_state !== 'below_benchmark') throw invalid(`"Exposure adequately controlled" can only be concluded when every formal result is below a verified benchmark (current comparison: ${String(r.benchmark_state).replace(/_/g, ' ')}). Use another conclusion category and explain in the interpretation.`);
  }
}

export async function submitForReview(a: Actor, revId: string) {
  requirePerm(a, 'assess.write');
  return withActor(a, async (tx) => {
    const r = await loadRev(tx, revId, true);
    await assertAssessmentNotOnHold(tx, r.assessment_id);
    if (r.status !== 'draft') throw invalid('Only drafts can be submitted');
    await assertCurrent(tx, r);
    checkConclusion(r);
    await assertConclusionAllowed(tx, (r.calc_code ?? 'twa_8h') as CalcCode, r.calc_version, r.benchmark_version_id);
    const out = await one(tx, `update assessment_revisions set status='in_review', submitted_by=$2, submitted_at=now() where id=$1 returning *`, [revId, a.userId]);
    await audit(tx, a, 'assessment.submitted', 'assessment_revision', revId);
    return out;
  });
}

export async function returnToDraft(a: Actor, revId: string, input: unknown) {
  requirePerm(a, 'assess.approve');
  const d = parse(z.object({ notes: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const r = await loadRev(tx, revId, true);
    await assertAssessmentNotOnHold(tx, r.assessment_id);
    if (r.status !== 'in_review') throw invalid('Only revisions in review can be returned');
    await tx.query(`update assessment_revisions set status='draft', submitted_by=null, submitted_at=null where id=$1`, [revId]);
    await audit(tx, a, 'assessment.returned', 'assessment_revision', revId, d);
  });
}

export async function approve(a: Actor, revId: string, input: unknown) {
  requirePerm(a, 'assess.approve');
  const d = parse(z.object({ approval_scope: reqStr(10), approval_limitations: reqStr(10), confirm_reviewed: bool }), input);
  if (!d.confirm_reviewed) throw invalid('Confirm you have reviewed the evidence, calculation and interpretation');
  return withActor(a, async (tx) => {
    const r = await loadRev(tx, revId, true);
    await assertAssessmentNotOnHold(tx, r.assessment_id);
    if (r.status !== 'in_review') throw invalid('Only revisions in review can be approved');
    await assertWorkflowActive(tx, 'assessment_approval');
    if (r.submitted_by === a.userId || r.created_by === a.userId) throw forbidden('An assessment must be approved by someone other than its author or submitter');
    await assertCurrent(tx, r);
    checkConclusion(r);
    const ownDisposition = await one(tx, `select 1 from sample_qc_checks where sampling_event_id = any($1) and disposition_by=$2 limit 1`, [r.sample_ids, a.userId]);
    if (ownDisposition) throw forbidden('You recorded a QC disposition for a sample in this assessment, so another reviewer must approve it');
    if (r.calc_output?.issues?.some((f: any) => f.code === 'CALCULATION_PENDING')) throw invalid('Calculation incomplete');
    // Re-checked at approval: the method review status and benchmark provenance are frozen into the approved revision.
    const gate = await assertConclusionAllowed(tx, (r.calc_code ?? 'twa_8h') as CalcCode, r.calc_version, r.benchmark_version_id);
    const snapshotHash = sha256(JSON.stringify({ inputs_hash: r.inputs_hash, calc_output: r.calc_output, interpretation: r.interpretation, conclusion: r.conclusion_category, limitations: r.limitations, scope: d.approval_scope, approval_limitations: d.approval_limitations, reviewer: a.userId }));
    const prev = await many(tx, `select id from assessment_revisions where assessment_id=$1 and status='approved' and id<>$2`, [r.assessment_id, revId]);
    for (const p of prev) await tx.query(`update assessment_revisions set status='superseded' where id=$1`, [p.id]);
    const out = await one(tx, `update assessment_revisions set status='approved', reviewer_id=$2, approved_at=now(), approval_scope=$3, approval_limitations=$4, snapshot_hash=$5,
        method_review_status=$6, benchmark_provenance=$7, assurance_level_at_approval=$8 where id=$1 returning *`,
      [revId, a.userId, d.approval_scope, d.approval_limitations, snapshotHash, gate.methodStatus, gate.benchmarkProvenance, gate.controls.assuranceLevel]);
    await audit(tx, a, 'assessment.approved', 'assessment_revision', revId, { scope: d.approval_scope, limitations: d.approval_limitations, snapshot_hash: snapshotHash, superseded: prev.map((p) => p.id) });
    // Optional outbound integration messages (only if the tenant enabled the link; mock by default).
    const ctx = await one(tx, `select a.id, a.title, g.name group_name, si.reference site_ref, s.name substance, s.cas_number from assessments a join exposure_groups g on g.id=a.group_id
      join sites si on si.id=g.site_id join substances s on s.id=a.substance_id where a.id=$1`, [r.assessment_id]);
    const provenance = { source: 'ohea', assessment_revision_id: revId, snapshot_hash: snapshotHash, calc: `${r.calc_code} ${r.calc_version}` };
    await enqueue(tx, a.tenantId, 'integrarisk', 'ohea.reviewed_finding', 'approved', `${r.assessment_id}:r${r.revision}`, {
      finding_id: revId, assessment_id: r.assessment_id, revision: r.revision, approved_at: out.approved_at, reviewer: a.name, site_ref: ctx.site_ref, group_ref: ctx.group_name,
      substance: ctx.substance, cas_number: ctx.cas_number, data_quality_state: r.data_quality_state, benchmark_state: r.benchmark_state, conclusion_category: r.conclusion_category, provenance });
    await enqueue(tx, a.tenantId, 'foresensa', 'ohea.exposure_data', 'approved', `${r.assessment_id}:r${r.revision}`, {
      assessment_id: r.assessment_id, revision: r.revision, substance: ctx.substance, professional_status: 'approved', data_quality_state: r.data_quality_state, benchmark_state: r.benchmark_state,
      shift_results: (r.calc_output.shifts ?? []).map((s: any) => ({ worker_ref: s.subjectRef, shift_date: s.shiftDate, twa8h_lower: s.twa8h?.lower ?? null, twa8h_upper: s.twa8h?.upper ?? null, unit: s.twa8h?.unit ?? null, indicative: s.indicative })),
      provenance });
    return out;
  });
}

/** Material change after approval → a new draft revision that must itself be reviewed. */
export async function newRevision(a: Actor, assessmentId: string, input: unknown) {
  requirePerm(a, 'assess.write');
  const d = parse(z.object({ change_reason: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const as = await one(tx, 'select * from assessments where id=$1 for update', [assessmentId]);
    if (!as) throw notFound('Assessment');
    await assertAssessmentNotOnHold(tx, assessmentId);
    const cur = await one(tx, 'select * from assessment_revisions where assessment_id=$1 and revision=$2', [assessmentId, as.current_revision]);
    if (['draft', 'in_review'].includes(cur.status)) throw invalid('The current revision is still open; edit it instead');
    const n = as.current_revision + 1;
    const rev = await one(tx, `insert into assessment_revisions (tenant_id,client_id,assessment_id,revision,sample_ids,calc_code,calc_version,parameters,benchmark_version_id,interpretation,conclusion_category,limitations,supersedes_revision_id,change_reason,created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [as.tenant_id, as.client_id, assessmentId, n, cur.sample_ids, cur.calc_code ?? 'twa_8h', calcOf(cur.calc_code).version, cur.parameters, cur.benchmark_version_id, cur.interpretation, cur.conclusion_category, cur.limitations, cur.id, d.change_reason, a.userId]);
    await tx.query('update assessments set current_revision=$2 where id=$1', [assessmentId, n]);
    await audit(tx, a, 'assessment.new_revision', 'assessment', assessmentId, { revision: n, reason: d.change_reason });
    return rev;
  });
}

/** Detects evidence or reference changes since a revision was calculated/approved. Never mutates the revision. */
export async function staleness(tx: Tx, r: any) {
  const reasons: string[] = [];
  if (r.inputs_snapshot) {
    // Evidence references (sample versions, result revisions, QC dispositions) are compared independently of the
    // calculation version, so an engine update never hides a real evidence change.
    const snap = await buildSnapshot(tx, r, r.substance_id);
    if (JSON.stringify(snap.refs) !== JSON.stringify(r.inputs_snapshot.refs)) reasons.push('Underlying sample, QC or laboratory evidence has changed since this revision was calculated.');
    const latest = calcOf(r.calc_code).version;
    if (r.calc_version && r.calc_version !== latest)
      reasons.push(`The calculation method has been updated (v${r.calc_version} → v${latest}) since this revision was calculated; reassessment may be required. This revision's results are unchanged.`);
  }
  if (r.benchmark_version_id) {
    const newer = await one(tx, `select v2.id, v2.value, v2.unit, v2.source_version from benchmark_versions v1 join benchmark_versions v2 on v2.benchmark_id=v1.benchmark_id
      where v1.id=$1 and v2.id<>v1.id and v2.verification_status='verified' and v2.effective_from > v1.effective_from order by v2.effective_from desc limit 1`, [r.benchmark_version_id]);
    if (newer) reasons.push(`A newer verified benchmark version exists (${newer.value} ${newer.unit}, ${newer.source_version}); reassessment may be required. This revision's conclusion is unchanged.`);
    const cur = await one(tx, 'select verification_status from benchmark_versions where id=$1', [r.benchmark_version_id]);
    if (cur?.verification_status === 'withdrawn') reasons.push('The benchmark version used has since been withdrawn.');
  }
  // A change in the professional review of the method since approval is reported for review; the approved revision and
  // its reports keep the status recorded at approval.
  if (r.status === 'approved' && r.method_review_status && r.calc_version) {
    const now = (await methodReview(tx, r.calc_code ?? 'twa_8h', r.calc_version)).status;
    if (METHOD_APPROVED.has(r.method_review_status) && !METHOD_APPROVED.has(now))
      reasons.push(`The professional approval of the calculation method (${r.calc_code ?? 'twa_8h'} v${r.calc_version}) is now "${now.replace(/_/g, ' ')}". This revision was approved while it was "${r.method_review_status.replace(/_/g, ' ')}" and is unchanged; it should be reviewed.`);
  }
  return reasons;
}

export async function assessmentDetail(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const as = await one(tx, `select a.*, g.name group_name, s.name substance_name, s.cas_number, u.name created_by_name from assessments a
      join exposure_groups g on g.id=a.group_id join substances s on s.id=a.substance_id left join users u on u.id=a.created_by where a.id=$1`, [id]);
    if (!as) throw notFound('Assessment');
    const revisions = await many(tx, `select r.*, ru.name reviewer_name, su.name submitted_by_name, cu.name created_by_name from assessment_revisions r
      left join users ru on ru.id=r.reviewer_id left join users su on su.id=r.submitted_by left join users cu on cu.id=r.created_by where assessment_id=$1 order by revision desc`, [id]);
    const current = revisions.find((r) => r.revision === as.current_revision);
    const approved = revisions.find((r) => r.status === 'approved') ?? null;
    const candidates = await many(tx, `select e.id, e.sample_code, e.sample_type, e.status, e.start_at, w.ref_code from sampling_events e left join workers w on w.id=e.worker_id
      where e.client_id=$1 and (e.substance_id=$2 or exists (select 1 from lab_results r where r.sampling_event_id=e.id and r.substance_id=$2)) and e.status <> 'void' order by e.start_at desc nulls last`, [as.client_id, as.substance_id]);
    const benchmarks = await many(tx, `select v.*, b.jurisdiction, b.benchmark_type, b.averaging_minutes from benchmark_versions v join benchmarks b on b.id=v.benchmark_id where b.substance_id=$1 order by v.verification_status='verified' desc, v.effective_from desc`, [as.substance_id]);
    const staleCurrent = current ? await staleness(tx, { ...current, substance_id: as.substance_id, group_id: as.group_id }) : [];
    const staleApproved = approved && approved.id !== current?.id ? await staleness(tx, { ...approved, substance_id: as.substance_id, group_id: as.group_id }) : staleCurrent;
    const actions = await many(tx, `select * from actions where source_type='assessment' and source_id=$1 order by created_at`, [id]);
    const reports = await many(tx, 'select id, version, status, generated_at, assessment_revision_id from reports where assessment_id=$1 order by version desc', [id]);
    const method = current ? await methodReview(tx, current.calc_code ?? 'twa_8h', current.calc_version ?? CALCULATIONS.twa_8h.version) : null;
    const controls = await tenantControls(tx);
    return { assessment: as, revisions, current, approved, candidates, benchmarks, staleCurrent, staleApproved, actions, reports, method, controls };
  });
}

export async function listAssessments(a: Actor) {
  return withActor(a, (tx) => many(tx, `select a.*, g.name group_name, s.name substance_name, r.status, r.data_quality_state, r.benchmark_state, r.conclusion_category, r.approved_at
    from assessments a join assessment_revisions r on r.assessment_id=a.id and r.revision=a.current_revision
    join exposure_groups g on g.id=a.group_id join substances s on s.id=a.substance_id order by a.created_at desc`));
}

/** Before/after comparability between two calculated revisions (e.g. pre- and post-control). */
export async function compareRevisions(a: Actor, beforeId: string, afterId: string) {
  return withActor(a, async (tx) => {
    const sides = [];
    for (const id of [beforeId, afterId]) {
      const r = await loadRev(tx, id);
      if (!r.inputs_snapshot) throw invalid('Both revisions must be calculated');
      const evs = await many(tx, 'select tasks_performed, operating_conditions, control_status, sample_type from sampling_events where id = any($1)', [r.sample_ids]);
      const mins = (r.calc_output?.samples ?? []).map((s: any) => s.sampledMinutes).filter((x: any) => typeof x === 'number');
      sides.push({
        rev: r,
        input: {
          label: `${r.title} r${r.revision}`,
          methods: r.inputs_snapshot.samples.map((s: SampleInput) => (s.method ? `${s.method.code} v${s.method.version}` : 'none')),
          meanSampledMinutes: mins.length ? Math.round(mins.reduce((x: number, y: number) => x + y, 0) / mins.length) : null,
          tasks: evs.map((e) => e.tasks_performed ?? ''),
          operatingConditions: evs.map((e) => e.operating_conditions ?? ''),
          controlStatus: evs.map((e) => e.control_status ?? ''),
          sampleTypes: evs.map((e) => e.sample_type),
        },
      });
    }
    return { before: sides[0].rev, after: sides[1].rev, ...comparability(sides[0].input, sides[1].input) };
  });
}
