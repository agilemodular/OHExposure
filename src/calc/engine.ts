/**
 * Deterministic, versioned exposure calculations. No AI involvement.
 *
 * Design rules (see docs/calculation-and-benchmark-specifications.md):
 *  - Non-detects are never replaced by zero. They are carried as an interval [lower, upper];
 *    no single point estimate is produced from a qualified result.
 *  - Inputs are validated in the engine as well as at the import and API boundaries; contradictory or non-finite
 *    inputs produce no numeric result and a specific validation reason (1.4.0, TR-03).
 *  - Full double precision is kept through every step; rounding is applied only for display (1.4.0, TR-04).
 *  - Missing durations, flows, results or exposure periods produce explicit "incomplete" outputs, never silent defaults.
 *  - Unsampled exposure time is only filled when the caller selects a documented assumption with a written
 *    justification; otherwise no 8-hour TWA is produced.
 *  - Static samples are never compared with personal benchmarks.
 *  - Results from screening-only instruments, or methods not suitable for formal assessment, are labelled indicative
 *    and excluded from the formal benchmark comparison.
 *  - Failed QC checks without an authorised disposition exclude the sample and remain listed.
 *  - Method acceptance failures have method-specific consequences; a hard prohibition cannot be overridden (1.4.0, TR-05).
 *  - Excluded, indicative or uncalculable personal evidence must be dispositioned before a favourable overall
 *    comparison is possible (1.4.0, TR-02).
 */

// 1.1.0: voided samples excluded; overlapping interruptions merged; shifts clustered across midnight;
// exposure period checked against the register; high excluded/indicative results block a favourable roll-up.
// 1.2.0: STEL (stel_15) calculation; ppm ↔ mg/m³ conversion for benchmark comparison when molecular weight is recorded.
// 1.3.0: results without valid calibration or instrument evidence are indicative only; unconvertible indicative/excluded
// results block a favourable roll-up; STEL requires the elapsed window to be 15 minutes.
// 1.3.1: roll-up treats uncalculable formal results as indeterminate (was not comparable); clearer comparison notes.
// 1.4.0 (technical review of ceec79f, TR-01–TR-05 and items A–D):
//   TR-01 STEL: a result is formal only for an uninterrupted sample of exactly 15 min (no sampling tolerance unless a
//         versioned convention is approved); shorter or interrupted windows need the zero-remainder assumption WITH
//         supporting evidence and are marked assumption-dependent; longer samples give no result.
//   TR-02 roll-up: unresolved excluded / indicative / uncalculable personal evidence blocks a favourable overall
//         comparison until dispositioned (duplicate, outside scope, not replaced, or remaining coverage adequate).
//   TR-03 inputs validated (finite, non-negative, LOD ≤ LOQ, units, qualifiers, positive flows and benchmarks,
//         interval order); unbounded upper results carry upperUnbounded = true.
//   TR-04 no intermediate rounding; comparisons on full precision with a documented relative tolerance applied
//         conservatively; molar volume per EH40 para 68 (24.05526 L/mol).
//   TR-05 flow-drift and minimum-volume failures have method-specific consequences (advisory, disposition required,
//         invalid); unknown rules are treated as disposition required and flagged.
//   A explicit shift association (shiftRef); inference only when unambiguous.  B exposure duration from task records
//   as a range (overlap-aware).  C below-LOQ semantics: generic "<LOQ" is 0–LOQ; detection only when the laboratory
//   reports it.  D separate status axes: calculation availability, evidence adequacy, numerical comparison.
// 1.5.0 (independent technical review of package 9b87c17, TR-06 and TR-07):
//   TR-06 a "duplicate" disposition sets evidence aside only for a supported duplicate category with matching
//         relationship evidence (worker, substance, exposure group, tasks, shift, sampling window, and either the same
//         instrument for a duplicate record of one event or a recorded pair reference for paired samplers). A different
//         sample offered as adequate remaining coverage is not a duplicate. A paired or duplicate-record result that is
//         higher than (or, for one event, differs from) the retained result is a conflict and stays unresolved.
//   TR-07 the numeric value field has a defined meaning per qualifier; a detected-below-LOQ value outside [LOD, LOQ]
//         (or a threshold that is not the LOQ) is contradictory: no numerical result, and the sample cannot be set
//         aside by disposition until the laboratory clarifies it through an amendment.
// 1.5.1 (R5 re-check of 808f76b, an AI review agent): a duplicate needs a calculable result for BOTH samples (an unknown
//   result can no longer be set aside without the conflict check, R5-F1); a void sample cannot be part of a duplicate at
//   calculation either (R5-F3); set-aside duplicates carry their relationship evidence.
export const ENGINE_VERSION = '1.5.1';

export type Qualifier = '=' | '<LOD' | '<LOQ' | 'detected_below_loq' | '>' | 'estimated';
export const QUALIFIERS: Qualifier[] = ['=', '<LOD', '<LOQ', 'detected_below_loq', '>', 'estimated'];
/**
 * Meaning of the numeric value field (1.5.0, TR-07). Each qualifier allows only the meanings listed; the first is the
 * default when none is recorded. A laboratory format that puts a reporting threshold in the value field of a
 * detected-below-LOQ result must say so explicitly (import column value_meaning = reporting_threshold).
 *  - measured:            the quantified result.                      '='
 *  - estimate:            the laboratory's estimate of the amount.    'estimated'; 'detected_below_loq' (must lie in [LOD, LOQ])
 *  - reporting_threshold: the "less than" limit, not an amount.       '<LOD', '<LOQ'; 'detected_below_loq' (must equal the LOQ)
 *  - lower_limit:         the top of the reportable range.            '>'
 */
export type ValueMeaning = 'measured' | 'estimate' | 'reporting_threshold' | 'lower_limit';
export const VALUE_MEANINGS: Record<Qualifier, ValueMeaning[]> = {
  '=': ['measured'], estimated: ['estimate'], '<LOD': ['reporting_threshold'], '<LOQ': ['reporting_threshold'], '>': ['lower_limit'], detected_below_loq: ['estimate', 'reporting_threshold'],
};
export type MassUnit = 'ug' | 'mg';
export type ConcUnit = 'ug/m3' | 'mg/m3' | 'ppm' | 'f/ml';
export const RESULT_UNITS = ['ug', 'mg', 'ug/m3', 'mg/m3', 'ppm', 'f/ml'] as const;
export const BENCHMARK_UNITS: ConcUnit[] = ['mg/m3', 'ppm', 'f/ml'];

/** Consequence of failing a method acceptance criterion (method-specific; set on the method version). */
export type AcceptanceConsequence = 'advisory' | 'disposition_required' | 'invalid';
export type AcceptanceCriterion = 'flow_drift' | 'min_volume';
export interface AcceptanceDisposition { criterion: AcceptanceCriterion; evidence: string; authorisedBy: string; scope: string }

/** Disposition of a personal sample that cannot be used as formal evidence in this assessment (TR-02). */
export type EvidenceDispositionKind = 'duplicate' | 'outside_scope' | 'not_replaced' | 'remaining_coverage_adequate';
/**
 * Supported duplicate categories (1.5.0, TR-06). A different sample offered as evidence that the remaining coverage is
 * adequate is NOT a duplicate; that judgement is 'remaining_coverage_adequate' and is reserved to a technical reviewer.
 *  - same_event_record: a second record of the same sampling event (same worker, instrument and window).
 *  - paired_colocated:  a genuine paired / co-located sampler worn at the same time, identified by a pair reference
 *                       recorded with both samples at capture.
 */
export type DuplicateType = 'same_event_record' | 'paired_colocated';
export const DUPLICATE_TYPES: DuplicateType[] = ['same_event_record', 'paired_colocated'];
/** Start and end of two records of the same sampling event may differ by at most this (recording granularity), min. */
export const DUPLICATE_RECORD_WINDOW_TOL_MIN = 1;
/** Paired samplers: the overlap of the two sampling windows must be at least this fraction of the longer window. */
export const PAIRED_MIN_OVERLAP_FRACTION = 0.9;
export interface EvidenceDisposition { kind: EvidenceDispositionKind; reason: string; consequence: string; authorisedBy: string; relatedSampleCode?: string | null; duplicateType?: DuplicateType | string | null }

export interface SampleInput {
  sampleId: string;
  sampleCode: string;
  sampleType: 'personal' | 'static' | 'field_blank' | 'other';
  subjectRef: string | null; // worker ref (personal) or location (static)
  voided?: boolean;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  /** Explicit shift / assessment-period association recorded with the sample (1.4.0). */
  shiftRef?: string | null;
  /** Relationship evidence used to validate duplicate dispositions (1.5.0, TR-06). */
  substanceRef?: string | null;   // substance of the result used in this assessment
  groupRef?: string | null;       // exposure group at sampling
  tasksPerformed?: string | null; // tasks recorded with the sample
  pairRef?: string | null;        // paired / co-located sampler reference recorded at capture
  interruptions: { start: string; end: string; reason?: string }[];
  flowPreLpm: number | null;
  flowPostLpm: number | null;
  method: {
    code: string;
    version: string;
    resultBasis: 'mass_on_sample' | 'concentration';
    flowDriftTolerancePct: number | null;
    minVolumeL: number | null;
    suitableForFormalAssessment: boolean;
    /** Consequences of acceptance failures for this method version; null/absent = not stated (treated as disposition required). */
    acceptance?: { flowDrift?: AcceptanceConsequence | null; minVolume?: AcceptanceConsequence | null } | null;
  } | null;
  instrument: { assetTag: string; screeningOnly: boolean; calibrationValidAtSampling: boolean | null } | null;
  qc: { checkType: string; outcome: 'pass' | 'fail' | 'not_applicable'; disposition: 'accepted_with_justification' | 'sample_invalidated' | null }[];
  acceptanceDispositions?: AcceptanceDisposition[];
  evidenceDisposition?: EvidenceDisposition | null;
  result: {
    revision: number;
    value: number | null;
    unit: MassUnit | ConcUnit;
    qualifier: Qualifier;
    lod: number | null;
    loq: number | null;
    /** The laboratory's own qualifier text, preserved alongside the mapped qualifier (1.4.0). */
    labQualifier?: string | null;
    /** Declared meaning of the value field (1.5.0); null = the qualifier's default. */
    valueMeaning?: ValueMeaning | string | null;
  } | null;
}

export type Flag = { code: string; severity: 'info' | 'qualify' | 'incomplete' | 'exclude'; message: string };

/** A concentration interval. When the upper bound is unknown, upper = Infinity and upperUnbounded = true (never null). */
export interface Interval { lower: number; upper: number; unit: ConcUnit; upperUnbounded?: boolean }
export function interval(lower: number, upper: number, unit: ConcUnit): Interval {
  return Number.isFinite(upper) ? { lower, upper, unit } : { lower, upper: Infinity, unit, upperUnbounded: true };
}

export interface SampleOutput {
  sampleId: string;
  sampleCode: string;
  sampleType: SampleInput['sampleType'];
  subjectRef: string | null;
  shiftDate: string | null;
  /** Local date of the end of sampling (to detect samples that cross midnight). */
  endDate: string | null;
  shiftRef: string | null;
  startMs: number | null;
  endMs: number | null;
  /** Elapsed time from start to end (min). */
  elapsedMinutes: number | null;
  /** Time the sampler was running (elapsed minus interruptions) (min). */
  sampledMinutes: number | null;
  volumeL: number | null;
  concentration: Interval | null; // null when not calculable
  isPointValue: boolean;          // true only for unqualified detected results
  indicative: boolean;
  included: boolean;
  /** Laboratory qualifier as reported and as interpreted. */
  qualifier: { reported: string | null; interpreted: Qualifier } | null;
  flags: Flag[];
}

const MIN = 60_000;
/** Numerical tolerance for timestamps (0.1 s): absorbs floating-point error only; not a sampling tolerance. */
export const TIME_EPS_MIN = 0.1 / 60;
/** Relative tolerance for benchmark comparisons, applied conservatively (a value within it of the benchmark counts as at or above). */
export const COMPARISON_REL_TOL = 1e-9;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function localDate(ms: number, tz: string | null) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

// ───────────────────────── Display policy (presentation only) ─────────────────────────

/** Formats a value to 4 significant figures for display. Never shows a positive value as zero. */
export function formatValue(x: number | null | undefined, sig = 4): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (x === Infinity) return '∞';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a < 1e-3 || a >= 1e6) return x.toExponential(sig - 1).replace(/e\+?/, ' × 10^');
  return String(Number(x.toPrecision(sig)));
}
export function formatInterval(i: Interval | null | undefined): string {
  if (!i) return 'not calculated';
  if (i.upperUnbounded || i.upper === Infinity || (i as any).upper === 'Infinity') return `> ${formatValue(i.lower)} ${i.unit} (upper bound unknown)`;
  if (i.lower === i.upper) return `${formatValue(i.lower)} ${i.unit}`;
  return `${formatValue(i.lower)} – ${formatValue(i.upper)} ${i.unit}`;
}

// ───────────────────────── Sample concentration ─────────────────────────

/**
 * Consistency of the qualifier, the value field and the limits (1.5.0, TR-07). Shared by the engine, laboratory entry,
 * amendments and the CSV import so that every boundary applies the same rule. Returns null when consistent.
 * detected_below_loq: both limits finite with LOD < LOQ; a value, if given, is the laboratory's estimate and must lie in
 * [LOD, LOQ] (both inclusive), or, when declared a reporting threshold, must equal the LOQ.
 */
export function qualifierValueProblem(r: { qualifier: Qualifier; value: number | null; lod: number | null; loq: number | null; unit: string; valueMeaning?: string | null; labQualifier?: string | null }): { code: string; message: string; fields: string[] } | null {
  if (r.valueMeaning != null && !(VALUE_MEANINGS[r.qualifier] ?? []).includes(r.valueMeaning as ValueMeaning))
    return { code: 'VALUE_MEANING', fields: ['qualifier', 'value_meaning'], message: `Value meaning "${r.valueMeaning}" is not valid for qualifier "${r.qualifier}" (allowed: ${(VALUE_MEANINGS[r.qualifier] ?? []).join(', ')}).` };
  if (r.qualifier !== 'detected_below_loq') return null;
  const u = r.unit, rep = r.labQualifier ? ` (laboratory text "${r.labQualifier}")` : '';
  if (r.lod == null || r.loq == null || !isNum(r.lod) || !isNum(r.loq))
    return { code: 'LIMITS', fields: ['lod', 'loq'], message: `A detected-below-LOQ result needs both limits as finite numbers (LOD ${r.lod ?? 'missing'}, LOQ ${r.loq ?? 'missing'}).` };
  if (!(r.lod < r.loq)) return { code: 'LIMITS', fields: ['lod', 'loq'], message: `A detected-below-LOQ result needs the LOD below the LOQ (LOD ${r.lod} ${u}, LOQ ${r.loq} ${u}).` };
  if (r.value == null) return null;
  const meaning = (r.valueMeaning ?? 'estimate') as ValueMeaning;
  const fields = `qualifier detected_below_loq${rep}, value ${r.value} ${u}${r.valueMeaning ? ` declared as ${meaning.replace(/_/g, ' ')}` : ''}, LOD ${r.lod} ${u}, LOQ ${r.loq} ${u}`;
  const pending = 'No numerical result is produced from these inputs. Obtain the laboratory\'s clarification and record it as an amendment; the reported value is not changed or discarded.';
  if (meaning === 'reporting_threshold' && r.value !== r.loq)
    return { code: 'DBL_VALUE', fields: ['qualifier', 'value', 'value_meaning', 'loq'], message: `Contradictory inputs (${fields}): a reporting threshold for a detected-below-LOQ result must equal the LOQ. ${pending}` };
  if (meaning === 'estimate' && (r.value < r.lod || r.value > r.loq))
    return { code: 'DBL_VALUE', fields: ['qualifier', 'value', r.value > r.loq ? 'loq' : 'lod'], message: `Contradictory inputs (${fields}): the value is ${r.value > r.loq ? 'above the LOQ' : 'below the LOD'}, so it cannot be a detected-below-LOQ estimate (an estimate must lie between the LOD and the LOQ, both inclusive). ${pending}` };
  return null;
}

function acceptanceCheck(s: SampleInput, criterion: AcceptanceCriterion, failed: boolean, detail: string, flags: Flag[]) {
  if (!failed) return;
  const label = criterion === 'flow_drift' ? 'flow drift' : 'minimum air volume';
  const code = criterion === 'flow_drift' ? 'FLOW_DRIFT' : 'VOLUME_BELOW_MIN';
  const stated = criterion === 'flow_drift' ? s.method?.acceptance?.flowDrift : s.method?.acceptance?.minVolume;
  if (stated === 'advisory') { flags.push({ code: `${code}_ADVISORY`, severity: 'qualify', message: `${detail} The method treats this as advisory.` }); return; }
  if (stated === 'invalid') { flags.push({ code: `${code}_INVALID`, severity: 'exclude', message: `${detail} The method treats this as invalid; it cannot be accepted by disposition.` }); return; }
  if (!stated) flags.push({ code: 'ACCEPTANCE_RULE_UNDEFINED', severity: 'qualify', message: `The method version does not state the consequence of a ${label} failure; it is treated as requiring a disposition pending professional review.` });
  const d = (s.acceptanceDispositions ?? []).find((x) => x.criterion === criterion);
  const complete = d && d.evidence?.trim().length >= 10 && d.authorisedBy?.trim() && d.scope?.trim().length >= 5;
  if (complete) flags.push({ code: `${code}_ACCEPTED`, severity: 'qualify', message: `${detail} Accepted by ${d!.authorisedBy} for ${d!.scope}. Evidence: ${d!.evidence}` });
  else flags.push({ code: `${code}_DISPOSITION_REQUIRED`, severity: 'exclude', message: `${detail} A disposition by an authorised reviewer (criterion, supporting evidence, scope) is required before the sample can be used.` });
}

/** sample_concentration — converts one laboratory result into an airborne concentration interval. */
export function sampleConcentration(s: SampleInput): SampleOutput {
  const flags: Flag[] = [];
  const startMs = s.startAt ? Date.parse(s.startAt) : null, endMs = s.endAt ? Date.parse(s.endAt) : null;
  const out: SampleOutput = {
    sampleId: s.sampleId, sampleCode: s.sampleCode, sampleType: s.sampleType, subjectRef: s.subjectRef,
    shiftDate: isNum(startMs) ? localDate(startMs, s.timezone) : null, endDate: isNum(endMs) ? localDate(endMs - 1, s.timezone) : null, shiftRef: s.shiftRef?.trim() || null,
    startMs: isNum(startMs) ? startMs : null, endMs: isNum(endMs) ? endMs : null, elapsedMinutes: null,
    sampledMinutes: null, volumeL: null, concentration: null, isPointValue: false, indicative: false, included: true,
    qualifier: s.result ? { reported: s.result.labQualifier ?? null, interpreted: s.result.qualifier } : null, flags,
  };
  const invalid = (code: string, message: string) => flags.push({ code: `INPUT_INVALID_${code}`, severity: 'incomplete', message });

  if (s.voided) flags.push({ code: 'SAMPLE_VOID', severity: 'exclude', message: 'Sample has been voided and cannot be used as evidence.' });
  if (s.sampleType === 'field_blank') {
    flags.push({ code: 'FIELD_BLANK', severity: 'exclude', message: 'Field blank — used for quality control, not as an exposure result.' });
    out.included = false;
    return out;
  }

  for (const q of s.qc) {
    if (q.outcome !== 'fail') continue;
    if (q.disposition === 'accepted_with_justification')
      flags.push({ code: 'QC_FAIL_ACCEPTED', severity: 'qualify', message: `Failed QC check "${q.checkType}" accepted with recorded justification.` });
    else if (q.disposition === 'sample_invalidated')
      flags.push({ code: 'QC_FAIL_INVALIDATED', severity: 'exclude', message: `Sample invalidated after failed QC check "${q.checkType}".` });
    else
      flags.push({ code: 'QC_FAIL_UNRESOLVED', severity: 'exclude', message: `Failed QC check "${q.checkType}" has no authorised disposition; sample cannot be used as evidence.` });
  }

  if (!s.instrument) {
    out.indicative = true;
    flags.push({ code: 'NO_INSTRUMENT', severity: 'qualify', message: 'No instrument recorded for this sample; result treated as indicative only.' });
  } else {
    if (s.instrument.calibrationValidAtSampling === null) {
      out.indicative = true;
      flags.push({ code: 'CALIBRATION_MISSING', severity: 'qualify', message: `No calibration evidence for ${s.instrument.assetTag} covering the sampling date; result treated as indicative only.` });
    } else if (!s.instrument.calibrationValidAtSampling) {
      out.indicative = true;
      flags.push({ code: 'CALIBRATION_INVALID', severity: 'qualify', message: `Calibration for ${s.instrument.assetTag} was expired or failed at the sampling date; result treated as indicative only.` });
    }
    if (s.instrument.screeningOnly) {
      out.indicative = true;
      flags.push({ code: 'SCREENING_INSTRUMENT', severity: 'qualify', message: `${s.instrument.assetTag} is designated screening-only; result is indicative and excluded from formal benchmark comparison.` });
    }
  }
  if (!s.method) {
    flags.push({ code: 'NO_METHOD', severity: 'incomplete', message: 'No sampling/analytical method version recorded.' });
  } else {
    if (!s.method.suitableForFormalAssessment) {
      out.indicative = true;
      flags.push({ code: 'METHOD_INDICATIVE', severity: 'qualify', message: `Method ${s.method.code} v${s.method.version} is not designated suitable for formal exposure assessment.` });
    }
    if (s.method.flowDriftTolerancePct != null && !(isNum(s.method.flowDriftTolerancePct) && s.method.flowDriftTolerancePct >= 0)) invalid('METHOD_TOLERANCE', 'The method flow tolerance is not a non-negative number.');
    if (s.method.minVolumeL != null && !(isNum(s.method.minVolumeL) && s.method.minVolumeL > 0)) invalid('METHOD_MIN_VOLUME', 'The method minimum volume is not a positive number.');
  }

  // Duration
  if (!s.startAt || !s.endAt) {
    flags.push({ code: 'DURATION_MISSING', severity: 'incomplete', message: 'Sampling start or end time is missing.' });
  } else if (!isNum(startMs) || !isNum(endMs)) {
    invalid('TIME', 'Sampling start or end time is not a valid timestamp.');
  } else if (!(endMs > startMs)) {
    flags.push({ code: 'DURATION_INVALID', severity: 'incomplete', message: 'Sampling end is not after start.' });
  } else {
    out.elapsedMinutes = (endMs - startMs) / MIN;
    // Clip interruptions to the sampling window and merge overlaps so no time is subtracted twice.
    const spans: [number, number][] = [];
    for (const i of s.interruptions) {
      const a0 = Date.parse(i.start), b0 = Date.parse(i.end);
      if (!isNum(a0) || !isNum(b0)) { invalid('INTERRUPTION_TIME', 'An interruption has an invalid timestamp.'); continue; }
      if (!(b0 > a0)) { flags.push({ code: 'INTERRUPTION_INVALID', severity: 'incomplete', message: 'An interruption has an end before its start.' }); continue; }
      const a = Math.max(startMs, a0), b = Math.min(endMs, b0);
      if (b > a) spans.push([a, b]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    let paused = 0, curA = -Infinity, curB = -Infinity;
    for (const [a, b] of spans) {
      if (a > curB) { if (curB > curA) paused += curB - curA; curA = a; curB = b; }
      else curB = Math.max(curB, b);
    }
    if (curB > curA) paused += curB - curA;
    out.sampledMinutes = (endMs - startMs - paused) / MIN;
    if (paused > 0) flags.push({ code: 'INTERRUPTED', severity: 'info', message: `Sampling interrupted for ${formatValue(paused / MIN)} min; excluded from sampled duration.` });
    if (out.sampledMinutes <= 0) flags.push({ code: 'DURATION_INVALID', severity: 'incomplete', message: 'No sampled time after interruptions.' });
  }

  const r = s.result;
  if (!r) {
    flags.push({ code: 'RESULT_MISSING', severity: 'incomplete', message: 'No laboratory or measurement result recorded.' });
    return finalise(out);
  }
  // Input validation (TR-03): reject contradictory or non-finite inputs before any calculation.
  if (!(RESULT_UNITS as readonly string[]).includes(r.unit)) { invalid('UNIT', `Result unit "${r.unit}" is not recognised.`); return finalise(out); }
  if (!QUALIFIERS.includes(r.qualifier)) { invalid('QUALIFIER', `Qualifier "${r.qualifier}" is not recognised.`); return finalise(out); }
  for (const [k, v] of [['value', r.value], ['LOD', r.lod], ['LOQ', r.loq]] as const) {
    if (v === null || v === undefined) continue;
    if (!isNum(v)) { invalid('NUMBER', `${k} is not a finite number.`); return finalise(out); }
    if (v < 0) { invalid('NEGATIVE', `${k} is negative.`); return finalise(out); }
  }
  if (r.lod != null && r.loq != null && r.lod > r.loq) { invalid('LIMITS', `LOD (${r.lod} ${r.unit}) exceeds LOQ (${r.loq} ${r.unit}); the limits contradict each other.`); return finalise(out); }
  // TR-07: value meaning and detected-below-LOQ consistency (same rule as laboratory entry, import and the database).
  const vp = qualifierValueProblem(r);
  if (vp) { invalid(vp.code, vp.message); return finalise(out); }

  const isMass = r.unit === 'ug' || r.unit === 'mg';
  if (s.method && (s.method.resultBasis === 'mass_on_sample') !== isMass)
    flags.push({ code: 'RESULT_BASIS_MISMATCH', severity: 'incomplete', message: `Result unit ${r.unit} does not match the method's result basis (${s.method.resultBasis}).` });

  const reported = r.labQualifier ? ` (laboratory reported "${r.labQualifier}")` : '';
  let lo: number, hi: number;
  switch (r.qualifier) {
    case '=':
      if (r.value === null) { flags.push({ code: 'VALUE_INVALID', severity: 'incomplete', message: 'Reported value missing.' }); return finalise(out); }
      lo = hi = r.value; out.isPointValue = true; break;
    case 'estimated':
      if (r.value === null) { flags.push({ code: 'VALUE_INVALID', severity: 'incomplete', message: 'Estimated value missing.' }); return finalise(out); }
      lo = hi = r.value; flags.push({ code: 'ESTIMATED', severity: 'qualify', message: `Laboratory reported an estimated quantitative value${reported}.` }); break;
    case '<LOD': {
      // N1 (R4): when both a reported "<" value and an LOD are given, the larger bounds the result (conservative).
      const bound = r.value != null && r.lod != null ? Math.max(r.value, r.lod) : r.value ?? r.lod;
      if (r.value != null && r.lod != null && r.value !== r.lod) flags.push({ code: 'LIMIT_VALUE_DIFFERS', severity: 'qualify', message: `Reported limit ${formatValue(r.value)} differs from the LOD ${formatValue(r.lod)} ${r.unit}; the larger is used as the upper bound.` });
      if (bound === null) { flags.push({ code: 'ND_NO_LIMIT', severity: 'incomplete', message: 'Non-detect reported without a detection limit.' }); return finalise(out); }
      lo = 0; hi = bound;
      flags.push({ code: 'NON_DETECT', severity: 'qualify', message: `Not detected (< ${formatValue(bound)} ${r.unit})${reported}. Carried as an interval from 0 to the reported limit; not replaced by zero.` });
      break;
    }
    case '<LOQ': {
      // Generic "less than LOQ": detection is NOT confirmed, even if the laboratory also states an LOD (1.4.0, item C).
      const upper = r.value != null && r.loq != null ? Math.max(r.value, r.loq) : r.loq ?? r.value;
      if (r.value != null && r.loq != null && r.value !== r.loq) flags.push({ code: 'LIMIT_VALUE_DIFFERS', severity: 'qualify', message: `Reported value ${formatValue(r.value)} differs from the LOQ ${formatValue(r.loq)} ${r.unit}; the larger is used as the upper bound.` });
      if (upper === null) { flags.push({ code: 'LOQ_NO_LIMIT', severity: 'incomplete', message: 'Below-LOQ result reported without a quantification limit.' }); return finalise(out); }
      lo = 0; hi = upper;
      flags.push({ code: 'BELOW_LOQ', severity: 'qualify', message: `Less than the limit of quantification (< ${formatValue(upper)} ${r.unit})${reported}; detection not confirmed, carried as 0–LOQ.` });
      break;
    }
    case 'detected_below_loq': {
      // Laboratory confirms detection at or above the LOD but below the LOQ. The interval is always [LOD, LOQ]; a reported
      // value is never used as the result, but it must agree with the qualifier (TR-07).
      // (Limits and the value were validated above by qualifierValueProblem.)
      if ((r.valueMeaning ?? 'estimate') === 'estimate' && r.value != null && (r.value === r.lod || r.value === r.loq))
        flags.push({ code: 'DBL_VALUE_AT_LIMIT', severity: 'info', message: `The laboratory estimate ${r.value} ${r.unit} equals the ${r.value === r.lod ? 'LOD' : 'LOQ'}; accepted (limits are inclusive).` });
      lo = r.lod!; hi = r.loq!;
      flags.push({ code: 'DETECTED_BELOW_LOQ', severity: 'qualify', message: `Detected but below the limit of quantification${reported}; carried as LOD–LOQ (${formatValue(lo)}–${formatValue(hi)} ${r.unit})${r.value != null && (r.valueMeaning ?? 'estimate') === 'estimate' ? `; the laboratory estimate ${formatValue(r.value)} ${r.unit} is recorded but not used as a quantified result` : ''}.` });
      break;
    }
    case '>':
      if (r.value === null) { flags.push({ code: 'VALUE_INVALID', severity: 'incomplete', message: 'Over-range result without a value.' }); return finalise(out); }
      lo = r.value; hi = Infinity;
      flags.push({ code: 'OVER_RANGE', severity: 'qualify', message: `Result exceeded the reportable range (> ${formatValue(r.value)} ${r.unit})${reported}; upper bound unknown.` });
      break;
  }
  if (lo! > hi!) { invalid('INTERVAL', `Lower bound ${lo!} exceeds upper bound ${hi!}.`); return finalise(out); }

  if (isMass) {
    if (s.flowPreLpm == null || s.flowPostLpm == null) {
      flags.push({ code: 'FLOW_MISSING', severity: 'incomplete', message: 'Pre- and post-sampling flow rates are both required to calculate air volume.' });
      return finalise(out);
    }
    if (!isNum(s.flowPreLpm) || !isNum(s.flowPostLpm) || s.flowPreLpm <= 0 || s.flowPostLpm <= 0) {
      invalid('FLOW', 'Flow rates must be finite and greater than zero.');
      return finalise(out);
    }
    const drift = (Math.abs(s.flowPostLpm - s.flowPreLpm) / s.flowPreLpm) * 100;
    const tol = s.method?.flowDriftTolerancePct ?? null;
    if (tol === null) flags.push({ code: 'FLOW_TOLERANCE_UNDEFINED', severity: 'qualify', message: `Flow changed by ${formatValue(drift)}%; the method version defines no acceptance tolerance (professional review required).` });
    else acceptanceCheck(s, 'flow_drift', drift > tol * (1 + COMPARISON_REL_TOL), `Flow changed by ${formatValue(drift)}% (${s.flowPreLpm} → ${s.flowPostLpm} L/min), exceeding the method tolerance of ${tol}%.`, flags);
    if (out.sampledMinutes === null || out.sampledMinutes <= 0) return finalise(out);
    const meanFlow = (s.flowPreLpm + s.flowPostLpm) / 2;
    out.volumeL = meanFlow * out.sampledMinutes;
    if (s.method?.minVolumeL != null)
      acceptanceCheck(s, 'min_volume', out.volumeL < s.method.minVolumeL, `Air volume ${formatValue(out.volumeL)} L is below the method minimum of ${s.method.minVolumeL} L.`, flags);
    const toMg = r.unit === 'ug' ? 1 / 1000 : 1;
    const m3 = out.volumeL / 1000;
    out.concentration = interval((lo! * toMg) / m3, hi! === Infinity ? Infinity : (hi! * toMg) / m3, 'mg/m3');
  } else {
    const unit = r.unit as ConcUnit;
    out.concentration = unit === 'ug/m3' ? interval(lo! / 1000, hi! === Infinity ? Infinity : hi! / 1000, 'mg/m3') : interval(lo!, hi!, unit);
  }
  return finalise(out);
}

function finalise(o: SampleOutput): SampleOutput {
  if (o.flags.some((f) => f.severity === 'exclude')) o.included = false;
  if (o.flags.some((f) => f.severity === 'incomplete')) { o.concentration = null; o.isPointValue = false; }
  return o;
}

// ───────────────────────── 8-hour TWA ─────────────────────────

export type UnsampledAssumption = 'none' | 'zero_exposure' | 'same_as_sampled';
/** A task or hazard exposure duration from the register (minutes per shift); optional interval from shift start. */
export interface ExposureRecord { ref: string; minutes: number | null; basis: string | null; startMin?: number | null; endMin?: number | null }
export interface TwaParameters {
  /** Total minutes of exposure to the substance in the shift for this group; required. */
  exposureMinutesPerShift: number | null;
  unsampledAssumption: UnsampledAssumption;
  unsampledJustification?: string;
  /** Task/hazard exposure records from the register for this group and substance; set by the service, not the user. */
  exposureRecords?: ExposureRecord[] | null;
  /** Legacy (≤ 1.3.1): the longest recorded duration. Used only when exposureRecords is absent. */
  recordedExposureMinutes?: number | null;
}

export interface ShiftTwa {
  subjectRef: string;
  shiftDate: string;
  shiftRef: string | null;
  sampleCodes: string[];
  sampledMinutes: number;
  exposureMinutes: number | null;
  coveragePct: number | null;
  twa8h: Interval | null;
  /** The calculated result for the reference period (equals twa8h for twa_8h; the 15-minute value for stel_15). */
  result: Interval | null;
  averagingMinutes: number;
  indicative: boolean;
  /** True when the result depends on an assumption about unsampled time. */
  assumptionDependent: boolean;
  flags: Flag[];
}

export const REFERENCE_PERIOD_MIN = 480;

/** Range of total exposure implied by the register records: overlap-aware when intervals are known (item B). */
export function exposureRange(records: ExposureRecord[]) {
  const timed = records.filter((r) => isNum(r.startMin) && isNum(r.endMin) && r.endMin! > r.startMin!);
  const untimed = records.filter((r) => !timed.includes(r) && isNum(r.minutes) && r.minutes! > 0);
  const spans = timed.map((r) => [r.startMin!, r.endMin!] as [number, number]).sort((a, b) => a[0] - b[0]);
  let union = 0, a = -Infinity, b = -Infinity;
  for (const [x, y] of spans) { if (x > b) { if (b > a) union += b - a; a = x; b = y; } else b = Math.max(b, y); }
  if (b > a) union += b - a;
  const maxUntimed = untimed.reduce((m, r) => Math.max(m, r.minutes!), 0);
  const sumUntimed = untimed.reduce((s, r) => s + r.minutes!, 0);
  // N3 (R4): a timed record whose stated minutes exceed its interval is inconsistent; its minutes still bound the total.
  const inconsistent = timed.filter((r) => isNum(r.minutes) && r.minutes! > r.endMin! - r.startMin! + TIME_EPS_MIN);
  const maxTimedMinutes = timed.reduce((m, r) => Math.max(m, isNum(r.minutes) ? r.minutes! : 0), 0);
  const extraTimed = inconsistent.reduce((s, r) => s + (r.minutes! - (r.endMin! - r.startMin!)), 0);
  return { lower: Math.max(union, maxUntimed, maxTimedMinutes), upper: union + extraTimed + sumUntimed, inconsistent, overlapUnknown: untimed.length > 1 || (untimed.length > 0 && timed.length > 0), estimated: records.filter((r) => r.basis && r.basis !== 'recorded_fact'), count: timed.length + untimed.length };
}

/** Groups a worker's samples into shifts: by explicit shift reference, or by local date only when unambiguous (item A). */
function groupShifts(samples: SampleOutput[]) {
  const bySubject = new Map<string, SampleOutput[]>();
  for (const s of samples) {
    if (!s.included || s.sampleType !== 'personal') continue;
    const k = s.subjectRef ?? '?';
    bySubject.set(k, [...(bySubject.get(k) ?? []), s]);
  }
  const groups: { subject: string; key: string; label: string; shiftRef: string | null; samples: SampleOutput[]; flags: Flag[] }[] = [];
  for (const [subject, list] of bySubject) {
    const withRef = list.filter((s) => s.shiftRef), without = list.filter((s) => !s.shiftRef);
    const byRef = new Map<string, SampleOutput[]>();
    for (const s of withRef) byRef.set(s.shiftRef!, [...(byRef.get(s.shiftRef!) ?? []), s]);
    for (const [ref, ss] of byRef) {
      const sorted = [...ss].sort((x, y) => (x.startMs ?? 0) - (y.startMs ?? 0));
      groups.push({ subject, key: `${subject}|ref:${ref}`, label: sorted[0].shiftDate ?? '?', shiftRef: ref, samples: sorted, flags: [] });
    }
    // Without an explicit association, group by local start date, but refuse to guess when the pattern is ambiguous.
    const byDate = new Map<string, SampleOutput[]>();
    for (const s of without) byDate.set(s.shiftDate ?? '?', [...(byDate.get(s.shiftDate ?? '?') ?? []), s]);
    const dates = [...byDate.keys()].sort();
    for (const d of dates) {
      const ss = [...byDate.get(d)!].sort((x, y) => (x.startMs ?? 0) - (y.startMs ?? 0));
      const flags: Flag[] = [];
      const crossesMidnight = ss.some((s) => s.endDate !== null && s.shiftDate !== null && s.endDate !== s.shiftDate);
      const neighbour = [...byDate.entries()].some(([d2, s2]) => d2 !== d && s2.some((x) => ss.some((y) => x.startMs !== null && y.startMs !== null && Math.abs(x.startMs - y.startMs) < 16 * 60 * MIN)));
      if (withRef.length) flags.push({ code: 'SHIFT_ASSOCIATION_REQUIRED', severity: 'incomplete', message: 'Some of this worker\'s samples have a shift reference and these do not; record the shift for every sample.' });
      else if (crossesMidnight || neighbour) flags.push({ code: 'SHIFT_ASSOCIATION_REQUIRED', severity: 'incomplete', message: 'Samples cross midnight or fall within 16 hours of samples on another date, so the shift cannot be inferred safely. Record the shift for each sample.' });
      else flags.push({ code: 'SHIFT_INFERRED', severity: 'info', message: `No shift reference recorded; samples grouped by local start date ${d}.` });
      groups.push({ subject, key: `${subject}|date:${d}`, label: d, shiftRef: null, samples: ss, flags });
    }
  }
  return groups;
}

/** twa_8h — EH40 8-hour TWA: Σ(Cᵢ·Tᵢ)/480 min, by worker and shift (personal samples only). */
export function twa8h(samples: SampleOutput[], p: TwaParameters): ShiftTwa[] {
  const res: ShiftTwa[] = [];
  const groups = groupShifts(samples);
  for (const g of groups) {
    const ss = g.samples;
    // Blocking association problems first; the informational 'inferred' note is appended after the calculation flags.
    const flags: Flag[] = g.flags.filter((f) => f.severity !== 'info');
    const overlaps = ss.some((s, i) => i > 0 && s.startMs !== null && ss[i - 1].endMs !== null && s.startMs < ss[i - 1].endMs!);
    const sampled = ss.reduce((a, s) => a + (s.sampledMinutes ?? 0), 0);
    const out: ShiftTwa = {
      subjectRef: g.subject, shiftDate: g.label, shiftRef: g.shiftRef, sampleCodes: ss.map((s) => s.sampleCode), sampledMinutes: sampled,
      exposureMinutes: p.exposureMinutesPerShift, coveragePct: null, twa8h: null, result: null, averagingMinutes: REFERENCE_PERIOD_MIN,
      indicative: ss.some((s) => s.indicative), assumptionDependent: false, flags,
    };
    res.push(out);
    if (flags.some((f) => f.severity === 'incomplete')) continue;
    if (ss.some((s) => !s.concentration)) { flags.push({ code: 'SAMPLE_NOT_CALCULABLE', severity: 'incomplete', message: 'One or more samples in this shift have no calculable concentration.' }); continue; }
    const units = new Set(ss.map((s) => s.concentration!.unit));
    if (units.size !== 1) { flags.push({ code: 'UNIT_MISMATCH', severity: 'incomplete', message: 'Samples in this shift use incompatible units.' }); continue; }
    const unit = ss[0].concentration!.unit;
    const E = p.exposureMinutesPerShift;
    if (E == null || !isNum(E) || !(E > 0)) { flags.push({ code: 'EXPOSURE_PERIOD_MISSING', severity: 'incomplete', message: 'Exposure duration per shift is not recorded or not a positive number; 8-hour TWA cannot be calculated.' }); continue; }
    if (E > 24 * 60) { flags.push({ code: 'INPUT_INVALID_EXPOSURE_PERIOD', severity: 'incomplete', message: 'Exposure duration per shift exceeds 24 hours.' }); continue; }
    if (overlaps) { flags.push({ code: 'SAMPLES_OVERLAP', severity: 'incomplete', message: 'Samples for this worker overlap in time and would be double counted.' }); continue; }
    // Exposure duration against the register (item B).
    const records = p.exposureRecords ?? (p.recordedExposureMinutes === undefined ? undefined : p.recordedExposureMinutes === null ? [] : [{ ref: 'register', minutes: p.recordedExposureMinutes, basis: 'recorded_fact' }]);
    if (records !== undefined) {
      const range = exposureRange(records);
      if (!range.count) {
        flags.push({ code: 'EXPOSURE_NOT_IN_REGISTER', severity: 'incomplete', message: 'No exposure duration is recorded in the exposure register for this group and substance, so the exposure period entered cannot be checked. Link the group to its tasks/hazards and record their durations.' });
        continue;
      }
      if (E < range.lower - TIME_EPS_MIN) {
        flags.push({ code: 'EXPOSURE_BELOW_RECORDED', severity: 'incomplete', message: `The exposure period entered (${E} min) is shorter than the register supports (at least ${formatValue(range.lower)} min). Correct the entry or update the register; unsampled time must not be dropped silently.` });
        continue;
      }
      if (range.overlapUnknown && E < range.upper - TIME_EPS_MIN)
        flags.push({ code: 'EXPOSURE_OVERLAP_UNKNOWN', severity: 'qualify', message: `Task records without times imply a total exposure between ${formatValue(range.lower)} and ${formatValue(range.upper)} min depending on overlap; ${E} min was entered. Record task times or confirm the overlap.` });
      if (range.inconsistent.length) flags.push({ code: 'EXPOSURE_RECORD_INCONSISTENT', severity: 'qualify', message: `Recorded minutes exceed the recorded task times for ${range.inconsistent.map((r) => r.ref).join(', ')}; the larger is used.` });
      if (range.estimated.length) flags.push({ code: 'EXPOSURE_DURATION_ESTIMATED', severity: 'qualify', message: `Exposure durations for ${range.estimated.map((r) => r.ref).join(', ')} are estimates, not recorded facts.` });
    }
    out.coveragePct = Math.min(100, (sampled / E) * 100);
    if (sampled > E + TIME_EPS_MIN) flags.push({ code: 'SAMPLED_EXCEEDS_EXPOSURE', severity: 'qualify', message: `Sampled time (${formatValue(sampled)} min) exceeds the recorded exposure period (${E} min); the recorded exposure period may be wrong.` });
    if (E > REFERENCE_PERIOD_MIN) flags.push({ code: 'EXTENDED_SHIFT', severity: 'info', message: `Exposure period ${E} min exceeds 8 h; total exposure is still referenced to 480 min.` });

    let lo = ss.reduce((a, s) => a + s.concentration!.lower * s.sampledMinutes!, 0);
    let hi = ss.reduce((a, s) => a + s.concentration!.upper * s.sampledMinutes!, 0);
    const unsampled = Math.max(0, E - sampled);
    if (unsampled > TIME_EPS_MIN) {
      const just = (p.unsampledJustification ?? '').trim();
      if (p.unsampledAssumption === 'none') {
        flags.push({ code: 'COVERAGE_INCOMPLETE', severity: 'incomplete', message: `${formatValue(unsampled)} min of exposure was not sampled and no documented assumption was selected; no 8-hour TWA is produced.` });
        continue;
      }
      if (just.length < 20) {
        flags.push({ code: 'ASSUMPTION_UNJUSTIFIED', severity: 'incomplete', message: 'An unsampled-period assumption requires a written justification (min 20 characters).' });
        continue;
      }
      out.assumptionDependent = true;
      if (p.unsampledAssumption === 'same_as_sampled') {
        lo += (lo / sampled) * unsampled;
        hi += (hi / sampled) * unsampled;
        flags.push({ code: 'EXTRAPOLATED', severity: 'qualify', message: `Unsampled ${formatValue(unsampled)} min assumed at the sampled mean concentration. Justification: ${just}` });
      } else {
        flags.push({ code: 'UNSAMPLED_ZERO', severity: 'qualify', message: `Unsampled ${formatValue(unsampled)} min assumed to involve no exposure. Justification: ${just}` });
      }
    }
    out.twa8h = interval(lo / REFERENCE_PERIOD_MIN, Number.isFinite(hi) ? hi / REFERENCE_PERIOD_MIN : Infinity, unit);
    out.result = out.twa8h;
  }
  groups.forEach((g, i) => res[i].flags.push(...g.flags.filter((f) => f.severity === 'info')));
  return res;
}

// ───────────────────────── 15-minute STEL ─────────────────────────

export const STEL_PERIOD_MIN = 15;
/**
 * Occupational-hygiene sampling tolerance around the 15-minute reference period. 0 in stel_15 1.2.0: EH40 (Schedule,
 * para 8) says short-term exposure "should be determined by sampling over that period". Any non-zero tolerance is a
 * methodological convention and needs a new method version with professional approval.
 */
export const STEL_SAMPLING_TOLERANCE_MIN = 0;
/** Bases accepted as supporting evidence for the zero-remainder assumption. Task completion alone is not one of them. */
export const STEL_REMAINDER_EVIDENCE = ['continuous_observation', 'direct_reading_instrument', 'process_record'] as const;
export interface StelParameters {
  /** How to treat a sample shorter than 15 minutes (or an interrupted window). 'none' = not calculated. */
  shortSampleAssumption?: 'none' | 'zero_remainder';
  shortSampleJustification?: string;
  /** Supporting evidence for zero exposure during the rest of the 15-minute period (required with zero_remainder). */
  shortSampleEvidenceBasis?: (typeof STEL_REMAINDER_EVIDENCE)[number] | string | null;
  shortSampleEvidenceRef?: string | null;
}

/**
 * stel_15 — one result per personal sample intended as a 15-minute reference-period measurement (TR-01).
 *  - Sampled time T, elapsed window W (start to end) and reference period 15 min are kept distinct.
 *  - T = 15 min (within the sampling tolerance, 0 in 1.2.0) and uninterrupted: the measured concentration is the result.
 *  - T > 15 min: no result. The average over a longer period cannot establish the highest 15-minute exposure, and it
 *    is not scaled by T/15.
 *  - Interrupted with W > 15 min: no result (not a single 15-minute period).
 *  - T < 15 min, or interrupted within 15 min: only with the 'zero_remainder' assumption, a written justification AND
 *    supporting evidence (observation, direct-reading instrument or process record). The result C × T / 15 is marked
 *    assumption-dependent; short peaks inside the sample are not resolved.
 */
export function stel15(samples: SampleOutput[], p: StelParameters): ShiftTwa[] {
  const res: ShiftTwa[] = [];
  const tolerance = STEL_SAMPLING_TOLERANCE_MIN;
  for (const s of samples) {
    if (!s.included || s.sampleType !== 'personal') continue;
    const flags: Flag[] = [];
    const out: ShiftTwa = {
      subjectRef: s.subjectRef ?? '?', shiftDate: s.shiftDate ?? '?', shiftRef: s.shiftRef, sampleCodes: [s.sampleCode], sampledMinutes: s.sampledMinutes ?? 0,
      exposureMinutes: null, coveragePct: null, twa8h: null, result: null, averagingMinutes: STEL_PERIOD_MIN, indicative: s.indicative, assumptionDependent: false, flags,
    };
    res.push(out);
    if (!s.concentration || s.sampledMinutes == null || s.elapsedMinutes == null) {
      flags.push({ code: 'SAMPLE_NOT_CALCULABLE', severity: 'incomplete', message: 'Sample has no calculable concentration.' });
      continue;
    }
    const T = s.sampledMinutes, W = s.elapsedMinutes, c = s.concentration;
    const interrupted = W - T > TIME_EPS_MIN;
    if (T > STEL_PERIOD_MIN + tolerance + TIME_EPS_MIN) {
      flags.push({ code: 'STEL_SAMPLE_TOO_LONG', severity: 'incomplete', message: `Sampled for ${formatValue(T)} min. The average over a period longer than 15 minutes cannot establish the highest 15-minute exposure and is not scaled to 15 minutes.` });
      continue;
    }
    if (interrupted && W > STEL_PERIOD_MIN + tolerance + TIME_EPS_MIN) {
      flags.push({ code: 'STEL_WINDOW_TOO_LONG', severity: 'incomplete', message: `Sampling was spread over ${formatValue(W)} min with interruptions; a short-term result needs a single period of 15 minutes.` });
      continue;
    }
    if (!interrupted && Math.abs(T - STEL_PERIOD_MIN) <= tolerance + TIME_EPS_MIN) {
      out.result = { ...c };
      if (Math.abs(T - STEL_PERIOD_MIN) > TIME_EPS_MIN) flags.push({ code: 'STEL_DURATION_TOLERANCE', severity: 'qualify', message: `Sampled for ${formatValue(T)} min, accepted under the sampling tolerance of ±${tolerance} min.` });
      continue;
    }
    // Shorter than 15 minutes, or interrupted within a 15-minute window: unsampled time inside the reference period.
    const unsampled = STEL_PERIOD_MIN - T;
    const just = (p.shortSampleJustification ?? '').trim();
    if (p.shortSampleAssumption !== 'zero_remainder') {
      flags.push({ code: 'STEL_SAMPLE_SHORT', severity: 'incomplete', message: `Sampled for ${formatValue(T)} min of the 15-minute period${interrupted ? ' (interrupted)' : ''}; no documented assumption was selected for the remaining ${formatValue(unsampled)} min.` });
      continue;
    }
    if (just.length < 20) {
      flags.push({ code: 'ASSUMPTION_UNJUSTIFIED', severity: 'incomplete', message: 'The short-sample assumption requires a written justification (min 20 characters).' });
      continue;
    }
    const basis = p.shortSampleEvidenceBasis ?? null, ref = (p.shortSampleEvidenceRef ?? '').trim();
    if (!basis || !(STEL_REMAINDER_EVIDENCE as readonly string[]).includes(basis) || ref.length < 5) {
      flags.push({ code: 'STEL_REMAINDER_EVIDENCE_REQUIRED', severity: 'incomplete', message: `Zero exposure for the remaining ${formatValue(unsampled)} min needs supporting evidence (continuous observation, a direct-reading instrument or a process record) with a reference. Completion of the task alone does not establish zero exposure.` });
      continue;
    }
    out.result = interval((c.lower * T) / STEL_PERIOD_MIN, Number.isFinite(c.upper) ? (c.upper * T) / STEL_PERIOD_MIN : Infinity, c.unit);
    out.assumptionDependent = true;
    flags.push({ code: 'STEL_ZERO_REMAINDER', severity: 'qualify', message: `ASSUMPTION-DEPENDENT: exposure assumed to be zero for the remaining ${formatValue(unsampled)} min of the 15-minute period. Evidence: ${basis.replace(/_/g, ' ')} (${ref}). Justification: ${just}` });
    flags.push({ code: 'STEL_SHORT_PEAK_LIMITATION', severity: 'info', message: 'Short-duration peaks within the sampled period are not resolved by a 15-minute average.' });
  }
  return res;
}

// ───────────────────────── Unit conversion ─────────────────────────

/** Molar volume of an ideal gas at 20 °C and 1 atm (101.325 kPa), L/mol, as stated in EH40/2005 (4th ed. 2020) para 68. */
export const MOLAR_VOLUME_L = 24.05526;

/** Converts an interval between ppm and mg/m³ using molecular weight (g/mol). Returns null when not possible. */
export function convertInterval(i: Interval, to: ConcUnit, molecularWeight: number | null | undefined): Interval | null {
  if (i.unit === to) return i;
  if (!isNum(molecularWeight) || !(molecularWeight > 0)) return null;
  const f = i.unit === 'ppm' && to === 'mg/m3' ? molecularWeight / MOLAR_VOLUME_L : i.unit === 'mg/m3' && to === 'ppm' ? MOLAR_VOLUME_L / molecularWeight : null;
  if (f === null) return null;
  return interval(i.lower * f, Number.isFinite(i.upper) ? i.upper * f : Infinity, to);
}

// ───────────────────────── Benchmark comparison ─────────────────────────

export interface BenchmarkRef {
  versionId: string;
  type: string;
  averagingMinutes: number;
  value: number;
  unit: ConcUnit;
  verificationStatus: 'unverified' | 'verified' | 'withdrawn';
  isSynthetic: boolean;
  source: string;
}
export type ComparisonState = 'below_benchmark' | 'at_or_above_benchmark' | 'indeterminate' | 'not_comparable';

export function benchmarkProblem(b: BenchmarkRef): string | null {
  if (!isNum(b.value) || !(b.value > 0)) return 'Benchmark value is not a positive finite number.';
  if (!isNum(b.averagingMinutes) || !(b.averagingMinutes > 0)) return 'Benchmark averaging period is not a positive number.';
  if (!BENCHMARK_UNITS.includes(b.unit)) return `Benchmark unit "${b.unit}" is not recognised.`;
  return null;
}

/**
 * Compares a result interval with a benchmark on full precision. A bound within COMPARISON_REL_TOL of the benchmark
 * counts as at or above it (conservative): below only if upper < value × (1 − tol); at or above if lower ≥ value × (1 − tol).
 */
export function compareInterval(i0: Interval | null, b: BenchmarkRef, molecularWeight?: number | null): { state: ComparisonState; ratio: { lower: number; upper: number } | null; reason?: string; converted?: Interval } {
  if (!i0) return { state: 'not_comparable', ratio: null, reason: 'No calculated exposure.' };
  const bp = benchmarkProblem(b);
  if (bp) return { state: 'not_comparable', ratio: null, reason: bp };
  if (!(isNum(i0.lower) && i0.lower >= 0) || !(i0.upper === Infinity || isNum(i0.upper)) || i0.lower > i0.upper) return { state: 'not_comparable', ratio: null, reason: 'The result interval is invalid (non-finite, negative or reversed bounds).' };
  const i = convertInterval(i0, b.unit, molecularWeight);
  if (!i) return { state: 'not_comparable', ratio: null, reason: `Exposure unit ${i0.unit} differs from benchmark unit ${b.unit} and cannot be converted${i0.unit === 'f/ml' || b.unit === 'f/ml' ? '' : ' (no molecular weight recorded for the substance)'}.` };
  const conv = i0.unit !== b.unit ? { converted: i, reason: `Converted from ${i0.unit} to ${b.unit} at 20 °C, 101.325 kPa (molar volume ${MOLAR_VOLUME_L} L/mol, molecular weight ${molecularWeight} g/mol).` } : {};
  const ratio = { lower: i.lower / b.value, upper: Number.isFinite(i.upper) ? i.upper / b.value : Infinity };
  const threshold = b.value * (1 - COMPARISON_REL_TOL);
  if (i.upper < threshold) return { state: 'below_benchmark', ratio, ...conv };
  if (i.lower >= threshold) return { state: 'at_or_above_benchmark', ratio, ...conv };
  return { state: 'indeterminate', ratio, ...conv, reason: `The result interval spans the benchmark value${i.upperUnbounded ? ' (upper bound unknown)' : ''}.${'reason' in conv ? ' ' + conv.reason : ''}` };
}

// ───────────────────────── Assessment roll-up ─────────────────────────

export type CalcCode = 'twa_8h' | 'stel_15';
export interface AssessmentInput {
  calc: CalcCode;
  samples: SampleInput[];
  parameters: TwaParameters & StelParameters;
  benchmark: BenchmarkRef | null;
  /** Molecular weight (g/mol) of the substance, used only for ppm ↔ mg/m³ conversion. */
  molecularWeight?: number | null;
}
export interface UnresolvedEvidence {
  sampleCode: string; subjectRef: string | null; why: string; interval: Interval | null; disposition: EvidenceDispositionKind | null;
  /** Why the sample is not formal evidence: its exclusion, indicative and validation findings (1.5.0). */
  reasons?: string[];
  /** A disposition was recorded but not accepted (1.5.0): why, and what it claimed. */
  rejectedDisposition?: { kind: EvidenceDispositionKind; duplicateType: string | null; relatedSampleCode: string | null; by: string; reason: string; problem: string; conflict: boolean } | null;
}
export interface AssessmentOutput {
  engineVersion: string;
  calcCode: string;
  calcVersion: string;
  samples: SampleOutput[];
  shifts: (ShiftTwa & { comparison: ReturnType<typeof compareInterval> | null })[];
  staticSamples: { sampleCode: string; concentration: Interval | null; note: string }[];
  /** Quality of the data used (flags). */
  dataQualityState: 'complete' | 'qualified' | 'incomplete' | 'failed';
  /** Whether formal results could be calculated: all, some or none of the formal worker-shift / 15-minute results. */
  calculationAvailability: 'complete' | 'partial' | 'none';
  /** Whether all personal evidence in scope is either formal or dispositioned (TR-02). */
  evidenceAdequacy: 'adequate' | 'adequate_with_accepted_gaps' | 'unresolved_evidence' | 'coverage_gap' | 'no_formal_evidence';
  unresolvedEvidence: UnresolvedEvidence[];
  /** Personal samples set aside by a valid disposition (always reported, with who and why). */
  setAsideEvidence: { sampleCode: string; subjectRef: string | null; kind: EvidenceDispositionKind; by: string; reason: string; consequence: string; interval: Interval | null; reasons?: string[]; relationship?: ReturnType<typeof relationshipEvidence> | null; duplicateType?: string | null; relatedSampleCode?: string | null; relatedInterval?: Interval | null }[];
  /** Overall numerical comparison, gated by calculation availability and evidence adequacy (decision table in the specification). */
  benchmarkState: 'below_benchmark' | 'at_or_above_benchmark' | 'indeterminate' | 'not_comparable' | 'no_verified_benchmark';
  benchmarkNote: string;
  issues: Flag[];
  disclaimer: string;
}

export const CALCULATIONS: Record<CalcCode, { code: CalcCode; version: string; averagingMinutes: number; label: string }> = {
  twa_8h: { code: 'twa_8h', version: '1.4.1', averagingMinutes: REFERENCE_PERIOD_MIN, label: '8-hour time-weighted average' },
  stel_15: { code: 'stel_15', version: '1.3.1', averagingMinutes: STEL_PERIOD_MIN, label: '15-minute short-term exposure' },
};

const normText = (x: string | null | undefined) => (x ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/** The relationship evidence of a duplicate pair, as recorded (for the output, the audit trail and the report). */
export function relationshipEvidence(a: SampleInput, b: SampleInput) {
  const one = (x: SampleInput) => ({ sampleCode: x.sampleCode, worker: x.subjectRef, window: [x.startAt, x.endAt], shiftRef: x.shiftRef ?? null, instrument: x.instrument?.assetTag ?? null, pairRef: x.pairRef ?? null, tasks: x.tasksPerformed ?? null, group: x.groupRef ?? null, substance: x.substanceRef ?? null });
  return { setAside: one(a), retained: one(b) };
}

/**
 * Duplicate relationship check (1.5.0, TR-06). Returns null when the relationship is supported by the recorded evidence,
 * otherwise the reason it is not; conflict = the relationship is supported but the results disagree adversely.
 * Missing evidence never passes: it leaves the disposition unresolved.
 */
export function duplicateProblem(d: EvidenceDisposition, self: { input: SampleInput; output: SampleOutput }, rel: { input: SampleInput; output: SampleOutput } | undefined): { problem: string; conflict: boolean } | null {
  const no = (problem: string) => ({ problem, conflict: false });
  const type = d.duplicateType ?? null;
  if (!type || !(DUPLICATE_TYPES as string[]).includes(type)) return no(`duplicate category ${type ? `"${type}" is not supported` : 'not stated'} (supported: same-event record, paired/co-located sampler). A different sample offered as evidence that the remaining coverage is adequate is not a duplicate; that needs a technical reviewer's "remaining coverage adequate" disposition`);
  if (!rel) return no('the related sample is not part of this assessment');
  const a = self.input, b = rel.input, ao = self.output, bo = rel.output;
  if (a.sampleType !== 'personal' || b.sampleType !== 'personal') return no('both samples must be personal samples');
  if (a.voided || b.voided) return no('a void sample cannot be part of a duplicate relationship');
  if (!a.subjectRef || a.subjectRef !== b.subjectRef) return no('the related sample is for a different worker');
  if (!a.substanceRef || !b.substanceRef) return no('the assessed substance is not recorded for both samples');
  if (a.substanceRef !== b.substanceRef) return no('the related sample is for a different substance');
  if (!a.groupRef || !b.groupRef) return no('the exposure group at sampling is not recorded for both samples');
  if (a.groupRef !== b.groupRef) return no('the related sample belongs to a different exposure group');
  if (!normText(a.tasksPerformed) || !normText(b.tasksPerformed)) return no('the tasks performed are not recorded for both samples, so the exposure context cannot be confirmed');
  if (normText(a.tasksPerformed) !== normText(b.tasksPerformed)) return no(`the tasks recorded differ ("${a.tasksPerformed}" / "${b.tasksPerformed}")`);
  if ((ao.shiftRef ?? ao.shiftDate) !== (bo.shiftRef ?? bo.shiftDate)) return no('the related sample is associated with a different shift');
  if (ao.startMs === null || ao.endMs === null || bo.startMs === null || bo.endMs === null) return no('the sampling window is not recorded for both samples');
  if (type === 'same_event_record') {
    const tol = DUPLICATE_RECORD_WINDOW_TOL_MIN * MIN;
    if (Math.abs(ao.startMs - bo.startMs) > tol || Math.abs(ao.endMs - bo.endMs) > tol) return no(`the sampling windows differ by more than ${DUPLICATE_RECORD_WINDOW_TOL_MIN} min, so the records are not of the same sampling event`);
    if (!a.instrument?.assetTag || !b.instrument?.assetTag) return no('the instrument is not recorded for both records');
    if (a.instrument.assetTag !== b.instrument.assetTag) return no('the records name different instruments, so they are not of the same sampling event');
  } else {
    if (!a.pairRef?.trim() || !b.pairRef?.trim()) return no('no pair reference was recorded at capture for both samples, so they are not evidenced as paired samplers');
    if (a.pairRef.trim() !== b.pairRef.trim()) return no('the pair references recorded at capture differ');
    const overlap = Math.min(ao.endMs, bo.endMs) - Math.max(ao.startMs, bo.startMs);
    const longer = Math.max(ao.endMs - ao.startMs, bo.endMs - bo.startMs);
    if (!(overlap > 0) || overlap < PAIRED_MIN_OVERLAP_FRACTION * longer) return no(`the sampling windows overlap for ${formatValue(Math.max(0, overlap) / MIN)} min, less than ${PAIRED_MIN_OVERLAP_FRACTION * 100} % of the longer window, so the samples were not taken at the same time`);
  }
  // A duplicate label must not suppress adverse evidence (paired-result review policy, specification §0).
  const x = ao.concentration, y = bo.concentration;
  // R5-F1: both results must be known; otherwise the pair cannot be compared and nothing is set aside.
  if (!x || !y) return no(`the ${!x ? 'set-aside' : 'retained'} sample has no calculable result, so the two results cannot be compared; evidence whose result is unknown cannot be set aside as a duplicate`);
  {
    if (x.unit !== y.unit) return { problem: `the results are in different units (${x.unit} / ${y.unit}) and cannot be compared; a technical reviewer must review the pair`, conflict: true };
    const close = (p: number, q: number) => p === q || (Number.isFinite(p) && Number.isFinite(q) && Math.abs(p - q) <= COMPARISON_REL_TOL * Math.max(Math.abs(p), Math.abs(q)));
    const higher = x.upper > y.upper && !close(x.upper, y.upper);
    const differs = !close(x.lower, y.lower) || !close(x.upper, y.upper);
    if (type === 'same_event_record' && differs) return { problem: `the two records of one sampling event report different results (${formatInterval(x)} / ${formatInterval(y)}); the discrepancy must be resolved, not set aside`, conflict: true };
    if (type === 'paired_colocated' && higher) return { problem: `the paired result set aside (${formatInterval(x)}) is higher than the retained result (${formatInterval(y)}); a duplicate label cannot suppress adverse evidence. A technical reviewer must review the pair`, conflict: true };
  }
  return null;
}

function dispositionProblem(d: EvidenceDisposition | null | undefined, formalCodes: Set<string>, self: { input: SampleInput; output: SampleOutput }, byCode: Map<string, { input: SampleInput; output: SampleOutput }>): { problem: string; conflict: boolean } | null {
  const no = (problem: string) => ({ problem, conflict: false });
  if (!d) return no('no disposition recorded');
  if (!(d.reason?.trim().length >= 10)) return no('disposition reason missing');
  if (!(d.consequence?.trim().length >= 10)) return no('assessment of consequences missing');
  if (!d.authorisedBy?.trim()) return no('disposition not authorised');
  // TR-07: contradictory or invalid inputs await correction by amendment; only "not replaced" (a coverage gap) applies.
  if (d.kind !== 'not_replaced' && self.output.flags.some((f) => f.code.startsWith('INPUT_INVALID_'))) return no('the sample has contradictory or invalid inputs awaiting correction (laboratory clarification and amendment); it cannot be set aside');
  if (d.kind === 'duplicate') {
    if (!(d.relatedSampleCode && d.relatedSampleCode !== self.output.sampleCode)) return no('duplicate disposition does not name another sample');
    if (!formalCodes.has(d.relatedSampleCode)) return no('duplicate disposition does not name a valid formal sample in this assessment');
    return duplicateProblem(d, self, byCode.get(d.relatedSampleCode));
  }
  return null;
}

export function runAssessment(input: AssessmentInput): AssessmentOutput {
  const calc = CALCULATIONS[input.calc] ?? CALCULATIONS.twa_8h;
  const samples = input.samples.map(sampleConcentration);
  const shifts = calc.code === 'stel_15' ? stel15(samples, input.parameters) : twa8h(samples, input.parameters);
  const REF = calc.averagingMinutes;
  const what = calc.code === 'stel_15' ? '15-minute' : 'worker-shift';
  const issues: Flag[] = [];
  const staticSamples = samples
    .filter((s) => s.sampleType === 'static' && s.included)
    .map((s) => ({ sampleCode: s.sampleCode, concentration: s.concentration, note: 'Static/area sample — contextual evidence only; not compared with personal exposure benchmarks.' }));

  const b = input.benchmark;
  const bProblem = b ? benchmarkProblem(b) : null;
  const usable = b && !bProblem && b.verificationStatus === 'verified' && b.averagingMinutes === REF;
  const withCmp = shifts.map((sh) => ({ ...sh, comparison: usable && !sh.indicative ? compareInterval(sh.result, b!, input.molecularWeight) : null }));

  // ── Calculation availability: formal (non-indicative) results that could / could not be calculated.
  const formalShifts = withCmp.filter((s) => !s.indicative);
  const calculated = formalShifts.filter((s) => s.result);
  const calculationAvailability: AssessmentOutput['calculationAvailability'] = !calculated.length ? 'none' : calculated.length === formalShifts.length ? 'complete' : 'partial';

  // ── Evidence adequacy (TR-02): every personal sample in scope that is not formal evidence needs a disposition.
  const formalCodes = new Set(calculated.flatMap((s) => s.sampleCodes));
  const byCode = new Map(input.samples.map((s, i) => [s.sampleCode, { input: s, output: samples[i] }]));
  const unresolved: UnresolvedEvidence[] = [];
  let acceptedGaps = 0, coverageGap = false;
  const setAside: AssessmentOutput['setAsideEvidence'] = [];
  for (const s of samples) {
    if (s.sampleType !== 'personal') continue;
    const why = !s.included ? 'excluded' : s.indicative ? 'indicative only' : !s.concentration ? 'not calculable' : !formalCodes.has(s.sampleCode) ? 'its worker-shift result could not be calculated' : null;
    if (!why) continue;
    const self = byCode.get(s.sampleCode)!;
    const d = self.input.evidenceDisposition ?? null;
    const reasons = s.flags.filter((f) => f.severity === 'exclude' || f.severity === 'incomplete' || (s.indicative && f.severity === 'qualify' && /^(NO_INSTRUMENT|CALIBRATION_|SCREENING_|METHOD_INDICATIVE)/.test(f.code))).map((f) => f.message);
    const p = dispositionProblem(d, formalCodes, self, byCode);
    if (p) {
      unresolved.push({ sampleCode: s.sampleCode, subjectRef: s.subjectRef, why: `${why}; ${d ? `${d.kind.replace(/_/g, ' ')} disposition not accepted: ` : ''}${p.problem}`, interval: s.concentration, disposition: d?.kind ?? null, reasons,
        rejectedDisposition: d ? { kind: d.kind, duplicateType: d.duplicateType ?? null, relatedSampleCode: d.relatedSampleCode ?? null, by: d.authorisedBy, reason: d.reason, problem: p.problem, conflict: p.conflict } : null });
      continue;
    }
    if (d!.kind === 'not_replaced') { coverageGap = true; unresolved.push({ sampleCode: s.sampleCode, subjectRef: s.subjectRef, why: `${why}; not replaced — the worker or task it covered remains unassessed (${d!.consequence})`, interval: s.concentration, disposition: d!.kind, reasons }); }
    else {
      if (d!.kind === 'remaining_coverage_adequate') acceptedGaps++;
      const relPair = d!.relatedSampleCode ? byCode.get(d!.relatedSampleCode) : undefined;
      const rel = relPair?.output;
      setAside.push({ sampleCode: s.sampleCode, subjectRef: s.subjectRef, kind: d!.kind, by: d!.authorisedBy, reason: d!.reason, consequence: d!.consequence, interval: s.concentration, reasons,
        ...(d!.kind === 'duplicate' ? { duplicateType: d!.duplicateType ?? null, relatedSampleCode: d!.relatedSampleCode ?? null, relatedInterval: rel?.concentration ?? null, relationship: relPair ? relationshipEvidence(self.input, relPair.input) : null } : {}) });
    }
  }
  const evidenceAdequacy: AssessmentOutput['evidenceAdequacy'] = !calculated.length ? 'no_formal_evidence'
    : unresolved.some((u) => u.disposition !== 'not_replaced') ? 'unresolved_evidence' : coverageGap ? 'coverage_gap' : acceptedGaps ? 'adequate_with_accepted_gaps' : 'adequate';

  // ── Numerical comparison, gated (decision table: docs/calculation-and-benchmark-specifications.md §3a).
  let benchmarkState: AssessmentOutput['benchmarkState'];
  let benchmarkNote = '';
  if (!b) { benchmarkState = 'no_verified_benchmark'; benchmarkNote = 'No benchmark selected.'; }
  else if (bProblem) { benchmarkState = 'not_comparable'; benchmarkNote = `Benchmark rejected: ${bProblem}`; }
  else if (b.verificationStatus !== 'verified') { benchmarkState = 'no_verified_benchmark'; benchmarkNote = `Selected benchmark version is ${b.verificationStatus}; it cannot be used for comparison until verified.`; }
  else if (b.averagingMinutes !== REF) { benchmarkState = 'not_comparable'; benchmarkNote = `Benchmark averaging period (${b.averagingMinutes} min) does not match the ${calc.label} calculation (${REF} min).`; }
  else {
    const formal = withCmp.filter((s) => s.comparison && s.result);
    const uncalculated = formalShifts.length - calculated.length;
    const couldBeAtOrAbove = (i: Interval | null) => { if (!i) return true; const c = convertInterval(i, b.unit, input.molecularWeight); return !c || c.upper >= b.value * (1 - COMPARISON_REL_TOL); };
    if (!formal.length) {
      if (uncalculated) { benchmarkState = 'indeterminate'; benchmarkNote = `${uncalculated} ${what} result(s) could not be calculated; no formal benchmark comparison is possible.`; }
      else if (unresolved.some((u) => couldBeAtOrAbove(u.interval))) { benchmarkState = 'indeterminate'; benchmarkNote = 'No formal results. Excluded or indicative evidence could be at or above the benchmark (it is not proof either way) and must be resolved.'; }
      else if (shifts.length) { benchmarkState = 'not_comparable'; benchmarkNote = 'Only indicative personal results are available (screening-only instrument, method not designated for formal assessment, or missing, expired or failed calibration); no formal benchmark comparison.'; }
      else { benchmarkState = 'not_comparable'; benchmarkNote = staticSamples.length ? `No personal ${calc.label} results are available; static results are not comparable with personal benchmarks.` : `No usable personal ${calc.label} results are available (all samples excluded or not calculable).`; }
    } else {
      const st = formal.map((s) => s.comparison!.state);
      benchmarkState = st.includes('at_or_above_benchmark') ? 'at_or_above_benchmark'
        : st.every((x) => x === 'not_comparable') ? 'not_comparable'
        : st.includes('indeterminate') || st.includes('not_comparable') ? 'indeterminate'
        : 'below_benchmark';
      benchmarkNote = `${formal.length} formal ${what} result(s) compared with ${b.type} ${formatValue(b.value)} ${b.unit} (${b.source}).`;
      if (uncalculated) { benchmarkNote += ` ${uncalculated} ${what} result(s) could not be calculated.`; if (benchmarkState === 'below_benchmark') benchmarkState = 'indeterminate'; }
      if (benchmarkState === 'below_benchmark' && (evidenceAdequacy === 'unresolved_evidence' || evidenceAdequacy === 'coverage_gap')) {
        benchmarkState = 'indeterminate';
        benchmarkNote += ` Every calculated result is below the benchmark, but ${unresolved.length} personal sample(s) are unresolved (${unresolved.map((u) => `${u.sampleCode}: ${u.why}`).join('; ')}); no favourable overall comparison until they are dispositioned or replaced.`;
      }
      if (benchmarkState === 'below_benchmark' && evidenceAdequacy === 'adequate_with_accepted_gaps') benchmarkNote += ` ${acceptedGaps} sample(s) were set aside with an authorised judgement that the remaining coverage is adequate.`;
      if (formal.some((s) => s.assumptionDependent)) benchmarkNote += ' Some results depend on a documented assumption about unsampled time.';
      if (setAside.length) benchmarkNote += ` Set aside by disposition: ${setAside.map((x) => `${x.sampleCode} (${x.kind.replace(/_/g, ' ')}${x.duplicateType ? ` — ${x.duplicateType.replace(/_/g, ' ')} of ${x.relatedSampleCode}` : ''}, ${x.by}${x.interval ? `, ${formatInterval(x.interval)}` : ''})`).join('; ')}.`;
      if (formal.some((s) => s.comparison?.converted)) benchmarkNote += ` Results were converted to ${b.unit} at 20 °C and 101.325 kPa (molar volume ${MOLAR_VOLUME_L} L/mol, EH40 para 68) using molecular weight ${input.molecularWeight} g/mol.`;
    }
    if (b.isSynthetic && !/synthetic/i.test(b.source)) benchmarkNote += ' SYNTHETIC DEMONSTRATION BENCHMARK — not a real exposure limit.';
  }

  for (const s of samples) for (const f of s.flags) if (f.severity !== 'info') issues.push({ ...f, message: `${s.sampleCode}: ${f.message}` });
  for (const s of shifts) for (const f of s.flags) if (f.severity !== 'info') issues.push({ ...f, message: `${s.subjectRef} ${s.shiftDate}: ${f.message}` });

  const usableSamples = samples.filter((s) => s.included && s.sampleType !== 'field_blank');
  let dq: AssessmentOutput['dataQualityState'];
  if (!usableSamples.length) dq = 'failed';
  else if (issues.some((f) => f.severity === 'incomplete') || shifts.some((s) => !s.result)) dq = 'incomplete';
  else if (issues.length) dq = 'qualified';
  else dq = 'complete';
  if (samples.some((s) => !s.included && s.sampleType !== 'field_blank') && dq === 'complete') dq = 'qualified';

  return {
    engineVersion: ENGINE_VERSION, calcCode: calc.code, calcVersion: calc.version,
    samples, shifts: withCmp, staticSamples, dataQualityState: dq, calculationAvailability, evidenceAdequacy, unresolvedEvidence: unresolved, setAsideEvidence: setAside,
    benchmarkState, benchmarkNote, issues,
    disclaimer: 'Calculated outputs and benchmark comparisons are not a compliance conclusion. Professional interpretation by a competent person is required.',
  };
}

/** Serialises engine output without losing unbounded values: Infinity becomes the string "Infinity" (with upperUnbounded = true). */
export const serialiseOutput = (o: unknown) => JSON.stringify(o, (_k, v) => (v === Infinity ? 'Infinity' : v));

// ───────────────────────── Before / after comparability ─────────────────────────

export interface ComparabilityInput {
  label: string;
  methods: string[];
  meanSampledMinutes: number | null;
  tasks: string[];
  operatingConditions: string[];
  controlStatus: string[];
  sampleTypes: string[];
}
export function comparability(before: ComparabilityInput, after: ComparabilityInput) {
  const diff: { aspect: string; before: string; after: string }[] = [];
  const set = (a: string[]) => [...new Set(a.filter(Boolean).map((x) => x.trim()))].sort().join('; ') || '—';
  for (const [aspect, k] of [['Sampling/analytical method', 'methods'], ['Tasks performed', 'tasks'], ['Operating conditions', 'operatingConditions'], ['Control status during sampling', 'controlStatus'], ['Sample types', 'sampleTypes']] as const) {
    const x = set(before[k]), y = set(after[k]);
    if (x !== y) diff.push({ aspect, before: x, after: y });
  }
  const b = before.meanSampledMinutes, a = after.meanSampledMinutes;
  if (b == null || a == null || Math.abs(a - b) / Math.max(a, b) > 0.2)
    diff.push({ aspect: 'Mean sampled duration (min)', before: b == null ? '—' : formatValue(b), after: a == null ? '—' : formatValue(a) });
  return { comparable: diff.length === 0, differences: diff };
}
