/**
 * Deterministic, versioned exposure calculations. No AI involvement.
 *
 * Design rules (see docs/calculation-specifications.md):
 *  - Non-detects are never replaced by zero. They are carried as an interval [lower, upper];
 *    no single point estimate is produced from a qualified result.
 *  - Missing durations, flows, results or exposure periods produce explicit "incomplete" outputs,
 *    never silent defaults.
 *  - Unsampled exposure time is only filled when the caller selects a documented assumption with a
 *    written justification; otherwise no 8-hour TWA is produced.
 *  - Static samples are never compared with personal benchmarks.
 *  - Results from screening-only instruments, or methods not suitable for formal assessment,
 *    are labelled indicative and excluded from the formal benchmark comparison.
 *  - Failed QC checks without an authorised disposition exclude the sample and remain listed.
 */

// 1.1.0: voided samples excluded; overlapping interruptions merged; shifts clustered across midnight;
// exposure period checked against the register; high excluded/indicative results block a favourable roll-up.
export const ENGINE_VERSION = '1.1.0';

export type Qualifier = '=' | '<LOD' | '<LOQ' | '>' | 'estimated';
export type MassUnit = 'ug' | 'mg';
export type ConcUnit = 'ug/m3' | 'mg/m3' | 'ppm' | 'f/ml';

export interface SampleInput {
  sampleId: string;
  sampleCode: string;
  sampleType: 'personal' | 'static' | 'field_blank' | 'other';
  subjectRef: string | null; // worker ref (personal) or location (static)
  voided?: boolean;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
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
  } | null;
  instrument: { assetTag: string; screeningOnly: boolean; calibrationValidAtSampling: boolean | null } | null;
  qc: { checkType: string; outcome: 'pass' | 'fail' | 'not_applicable'; disposition: 'accepted_with_justification' | 'sample_invalidated' | null }[];
  result: {
    revision: number;
    value: number | null;
    unit: MassUnit | ConcUnit;
    qualifier: Qualifier;
    lod: number | null;
    loq: number | null;
  } | null;
}

export type Flag = { code: string; severity: 'info' | 'qualify' | 'incomplete' | 'exclude'; message: string };

export interface Interval { lower: number; upper: number; unit: ConcUnit } // upper may be Infinity
export interface SampleOutput {
  sampleId: string;
  sampleCode: string;
  sampleType: SampleInput['sampleType'];
  subjectRef: string | null;
  shiftDate: string | null;
  startMs: number | null;
  endMs: number | null;
  sampledMinutes: number | null;
  volumeL: number | null;
  concentration: Interval | null; // null when not calculable
  isPointValue: boolean;          // true only for unqualified detected results
  indicative: boolean;
  included: boolean;
  flags: Flag[];
}

const MIN = 60_000;
const round = (x: number, dp = 6) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : x);

function localDate(iso: string, tz: string | null) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** sample_concentration v1.0.0 — converts one laboratory result into an airborne concentration interval. */
export function sampleConcentration(s: SampleInput): SampleOutput {
  const flags: Flag[] = [];
  const out: SampleOutput = {
    sampleId: s.sampleId, sampleCode: s.sampleCode, sampleType: s.sampleType, subjectRef: s.subjectRef,
    shiftDate: s.startAt ? localDate(s.startAt, s.timezone) : null,
    startMs: s.startAt ? Date.parse(s.startAt) : null, endMs: s.endAt ? Date.parse(s.endAt) : null,
    sampledMinutes: null, volumeL: null, concentration: null, isPointValue: false, indicative: false, included: true, flags,
  };

  if (s.voided) {
    flags.push({ code: 'SAMPLE_VOID', severity: 'exclude', message: 'Sample has been voided and cannot be used as evidence.' });
  }
  if (s.sampleType === 'field_blank') {
    flags.push({ code: 'FIELD_BLANK', severity: 'exclude', message: 'Field blank — used for quality control, not as an exposure result.' });
    out.included = false;
    return out;
  }

  // QC checks
  for (const q of s.qc) {
    if (q.outcome !== 'fail') continue;
    if (q.disposition === 'accepted_with_justification')
      flags.push({ code: 'QC_FAIL_ACCEPTED', severity: 'qualify', message: `Failed QC check "${q.checkType}" accepted with recorded justification.` });
    else if (q.disposition === 'sample_invalidated')
      flags.push({ code: 'QC_FAIL_INVALIDATED', severity: 'exclude', message: `Sample invalidated after failed QC check "${q.checkType}".` });
    else
      flags.push({ code: 'QC_FAIL_UNRESOLVED', severity: 'exclude', message: `Failed QC check "${q.checkType}" has no authorised disposition; sample cannot be used as evidence.` });
  }

  // Instrument / method suitability
  if (!s.instrument) flags.push({ code: 'NO_INSTRUMENT', severity: 'qualify', message: 'No instrument recorded for this sample.' });
  else {
    if (s.instrument.calibrationValidAtSampling === null)
      flags.push({ code: 'CALIBRATION_MISSING', severity: 'qualify', message: `No calibration evidence for ${s.instrument.assetTag} covering the sampling date.` });
    else if (!s.instrument.calibrationValidAtSampling)
      flags.push({ code: 'CALIBRATION_INVALID', severity: 'qualify', message: `Calibration for ${s.instrument.assetTag} was expired or failed at the sampling date.` });
    if (s.instrument.screeningOnly) {
      out.indicative = true;
      flags.push({ code: 'SCREENING_INSTRUMENT', severity: 'qualify', message: `${s.instrument.assetTag} is designated screening-only; result is indicative and excluded from formal benchmark comparison.` });
    }
  }
  if (!s.method) {
    flags.push({ code: 'NO_METHOD', severity: 'incomplete', message: 'No sampling/analytical method version recorded.' });
  } else if (!s.method.suitableForFormalAssessment) {
    out.indicative = true;
    flags.push({ code: 'METHOD_INDICATIVE', severity: 'qualify', message: `Method ${s.method.code} v${s.method.version} is not designated suitable for formal exposure assessment.` });
  }

  // Duration
  if (!s.startAt || !s.endAt) {
    flags.push({ code: 'DURATION_MISSING', severity: 'incomplete', message: 'Sampling start or end time is missing.' });
  } else {
    const start = Date.parse(s.startAt), end = Date.parse(s.endAt);
    if (!(end > start)) flags.push({ code: 'DURATION_INVALID', severity: 'incomplete', message: 'Sampling end is not after start.' });
    else {
      // Clip interruptions to the sampling window and merge overlaps so no time is subtracted twice.
      const spans: [number, number][] = [];
      for (const i of s.interruptions) {
        if (!(Date.parse(i.end) > Date.parse(i.start))) {
          flags.push({ code: 'INTERRUPTION_INVALID', severity: 'incomplete', message: 'An interruption has an end before its start.' });
          continue;
        }
        const a = Math.max(start, Date.parse(i.start)), b = Math.min(end, Date.parse(i.end));
        if (b > a) spans.push([a, b]);
      }
      spans.sort((x, y) => x[0] - y[0]);
      let paused = 0, curA = -Infinity, curB = -Infinity;
      for (const [a, b] of spans) {
        if (a > curB) { if (curB > curA) paused += curB - curA; curA = a; curB = b; }
        else curB = Math.max(curB, b);
      }
      if (curB > curA) paused += curB - curA;
      out.sampledMinutes = round((end - start - paused) / MIN, 3);
      if (paused > 0) flags.push({ code: 'INTERRUPTED', severity: 'info', message: `Sampling interrupted for ${round(paused / MIN, 1)} min; excluded from sampled duration.` });
      if (out.sampledMinutes <= 0) flags.push({ code: 'DURATION_INVALID', severity: 'incomplete', message: 'No sampled time after interruptions.' });
    }
  }

  const r = s.result;
  if (!r) {
    flags.push({ code: 'RESULT_MISSING', severity: 'incomplete', message: 'No laboratory or measurement result recorded.' });
    return finalise(out);
  }

  const isMass = r.unit === 'ug' || r.unit === 'mg';
  if (s.method && (s.method.resultBasis === 'mass_on_sample') !== isMass)
    flags.push({ code: 'RESULT_BASIS_MISMATCH', severity: 'incomplete', message: `Result unit ${r.unit} does not match the method's result basis (${s.method.resultBasis}).` });

  // Interval in the reported unit
  let lo: number, hi: number;
  switch (r.qualifier) {
    case '=':
      if (r.value === null || r.value < 0) { flags.push({ code: 'VALUE_INVALID', severity: 'incomplete', message: 'Reported value missing or negative.' }); return finalise(out); }
      lo = hi = r.value; out.isPointValue = true; break;
    case 'estimated':
      if (r.value === null || r.value < 0) { flags.push({ code: 'VALUE_INVALID', severity: 'incomplete', message: 'Estimated value missing or negative.' }); return finalise(out); }
      lo = hi = r.value; flags.push({ code: 'ESTIMATED', severity: 'qualify', message: 'Laboratory reported an estimated value.' }); break;
    case '<LOD': {
      const bound = r.value ?? r.lod;
      if (bound === null) { flags.push({ code: 'ND_NO_LIMIT', severity: 'incomplete', message: 'Non-detect reported without a detection limit.' }); return finalise(out); }
      lo = 0; hi = bound;
      flags.push({ code: 'NON_DETECT', severity: 'qualify', message: `Non-detect (< ${bound} ${r.unit}). Carried as an interval from 0 to the reported limit; not replaced by zero.` });
      break;
    }
    case '<LOQ': {
      const upper = r.loq ?? r.value;
      if (upper === null) { flags.push({ code: 'LOQ_NO_LIMIT', severity: 'incomplete', message: 'Below-LOQ result reported without a quantification limit.' }); return finalise(out); }
      lo = r.lod ?? 0; hi = upper;
      flags.push({ code: 'BELOW_LOQ', severity: 'qualify', message: `Detected below the limit of quantification; carried as an interval ${lo}–${hi} ${r.unit}.` });
      break;
    }
    case '>':
      if (r.value === null) { flags.push({ code: 'VALUE_INVALID', severity: 'incomplete', message: 'Over-range result without a value.' }); return finalise(out); }
      lo = r.value; hi = Infinity;
      flags.push({ code: 'OVER_RANGE', severity: 'qualify', message: `Result exceeded the reportable range (> ${r.value} ${r.unit}); upper bound unknown.` });
      break;
  }

  if (isMass) {
    // Volume from mean of pre- and post-sampling flow.
    if (s.flowPreLpm == null || s.flowPostLpm == null || s.flowPreLpm <= 0 || s.flowPostLpm <= 0) {
      flags.push({ code: 'FLOW_MISSING', severity: 'incomplete', message: 'Pre- and post-sampling flow rates are both required to calculate air volume.' });
      return finalise(out);
    }
    const drift = (Math.abs(s.flowPostLpm - s.flowPreLpm) / s.flowPreLpm) * 100;
    const tol = s.method?.flowDriftTolerancePct ?? null;
    if (tol === null) flags.push({ code: 'FLOW_TOLERANCE_UNDEFINED', severity: 'qualify', message: `Flow changed by ${round(drift, 1)}%; the method version defines no acceptance tolerance.` });
    else if (drift > tol) flags.push({ code: 'FLOW_DRIFT_EXCEEDED', severity: 'qualify', message: `Flow changed by ${round(drift, 1)}%, exceeding the method tolerance of ${tol}%.` });
    if (out.sampledMinutes === null || out.sampledMinutes <= 0) return finalise(out);
    const meanFlow = (s.flowPreLpm + s.flowPostLpm) / 2;
    out.volumeL = round(meanFlow * out.sampledMinutes, 3);
    if (s.method?.minVolumeL != null && out.volumeL < s.method.minVolumeL)
      flags.push({ code: 'VOLUME_BELOW_MIN', severity: 'qualify', message: `Air volume ${out.volumeL} L is below the method minimum of ${s.method.minVolumeL} L.` });
    const toMg = r.unit === 'ug' ? 1 / 1000 : 1;
    const m3 = out.volumeL / 1000;
    out.concentration = { lower: round((lo * toMg) / m3), upper: hi === Infinity ? Infinity : round((hi * toMg) / m3), unit: 'mg/m3' };
  } else {
    const unit = r.unit as ConcUnit;
    if (unit === 'ug/m3') out.concentration = { lower: round(lo / 1000), upper: hi === Infinity ? Infinity : round(hi / 1000), unit: 'mg/m3' };
    else out.concentration = { lower: lo, upper: hi, unit };
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
export interface TwaParameters {
  /** Total minutes of exposure to the substance in the shift for this group (from task records); required. */
  exposureMinutesPerShift: number | null;
  unsampledAssumption: UnsampledAssumption;
  unsampledJustification?: string;
  /** Longest exposure duration recorded in the register (task/hazard) for this group and substance; set by the service, not the user. */
  recordedExposureMinutes?: number | null;
}

export interface ShiftTwa {
  subjectRef: string;
  shiftDate: string;
  sampleCodes: string[];
  sampledMinutes: number;
  exposureMinutes: number | null;
  coveragePct: number | null;
  twa8h: Interval | null;
  indicative: boolean;
  flags: Flag[];
}

export const REFERENCE_PERIOD_MIN = 480;
export const SHIFT_GAP_MIN = 240;

/** twa_8h v1.0.0 — EH40 8-hour TWA: Σ(Cᵢ·Tᵢ)/480 min, by worker and shift date (personal samples only). */
export function twa8h(samples: SampleOutput[], p: TwaParameters): ShiftTwa[] {
  // A shift is a run of a worker's samples separated by gaps of less than SHIFT_GAP_MIN, so night shifts
  // that cross midnight are not split by calendar date. The shift is labelled by its first sample's local date.
  const bySubject = new Map<string, SampleOutput[]>();
  for (const s of samples) {
    if (!s.included || s.sampleType !== 'personal') continue;
    const k = s.subjectRef ?? '?';
    bySubject.set(k, [...(bySubject.get(k) ?? []), s]);
  }
  const groups = new Map<string, SampleOutput[]>();
  for (const [subject, list] of bySubject) {
    const sorted = [...list].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    let cur: SampleOutput[] = [];
    let lastEnd = -Infinity;
    const flush = () => { if (cur.length) groups.set(`${subject}|${cur[0].shiftDate ?? '?'}|${groups.size}`, cur); cur = []; };
    for (const s of sorted) {
      if (s.startMs === null || s.startMs - lastEnd > SHIFT_GAP_MIN * MIN) flush();
      cur.push(s);
      lastEnd = Math.max(lastEnd, s.endMs ?? s.startMs ?? lastEnd);
    }
    flush();
  }
  const res: ShiftTwa[] = [];
  for (const [k, ss] of groups) {
    const [subjectRef, shiftDate] = k.split('|');
    const overlaps = ss.some((s, i) => i > 0 && s.startMs !== null && ss[i - 1].endMs !== null && s.startMs < ss[i - 1].endMs!);
    const flags: Flag[] = [];
    const sampled = ss.reduce((a, s) => a + (s.sampledMinutes ?? 0), 0);
    const out: ShiftTwa = {
      subjectRef, shiftDate, sampleCodes: ss.map((s) => s.sampleCode), sampledMinutes: round(sampled, 3),
      exposureMinutes: p.exposureMinutesPerShift, coveragePct: null, twa8h: null,
      indicative: ss.some((s) => s.indicative), flags,
    };
    res.push(out);

    const units = new Set(ss.map((s) => s.concentration?.unit));
    if (ss.some((s) => !s.concentration)) {
      flags.push({ code: 'SAMPLE_NOT_CALCULABLE', severity: 'incomplete', message: 'One or more samples in this shift have no calculable concentration.' });
      continue;
    }
    if (units.size !== 1) { flags.push({ code: 'UNIT_MISMATCH', severity: 'incomplete', message: 'Samples in this shift use incompatible units.' }); continue; }
    const unit = ss[0].concentration!.unit;
    // overlapping samples on the same subject would double count
    if (p.exposureMinutesPerShift == null || !(p.exposureMinutesPerShift > 0)) {
      flags.push({ code: 'EXPOSURE_PERIOD_MISSING', severity: 'incomplete', message: 'Exposure duration per shift is not recorded; 8-hour TWA cannot be calculated.' });
      continue;
    }
    const E = p.exposureMinutesPerShift;
    if (overlaps) { flags.push({ code: 'SAMPLES_OVERLAP', severity: 'incomplete', message: 'Samples for this worker overlap in time and would be double counted.' }); continue; }
    if (p.recordedExposureMinutes != null && E < p.recordedExposureMinutes - 0.5) {
      flags.push({ code: 'EXPOSURE_BELOW_RECORDED', severity: 'incomplete', message: `The exposure period entered (${E} min) is shorter than the duration recorded in the exposure register (${p.recordedExposureMinutes} min). Correct the entry or update the register; unsampled time must not be dropped silently.` });
      continue;
    }
    out.coveragePct = round(Math.min(100, (sampled / E) * 100), 1);
    if (sampled > E + 0.5) flags.push({ code: 'SAMPLED_EXCEEDS_EXPOSURE', severity: 'qualify', message: `Sampled time (${round(sampled, 1)} min) exceeds the recorded exposure period (${E} min); the recorded exposure period may be wrong.` });
    if (E > REFERENCE_PERIOD_MIN) flags.push({ code: 'EXTENDED_SHIFT', severity: 'info', message: `Exposure period ${E} min exceeds 8 h; total exposure is still referenced to 480 min.` });

    let lo = ss.reduce((a, s) => a + s.concentration!.lower * s.sampledMinutes!, 0);
    let hi = ss.reduce((a, s) => a + s.concentration!.upper * s.sampledMinutes!, 0);
    const unsampled = Math.max(0, E - sampled);
    if (unsampled > 0.5) {
      const just = (p.unsampledJustification ?? '').trim();
      if (p.unsampledAssumption === 'none') {
        flags.push({ code: 'COVERAGE_INCOMPLETE', severity: 'incomplete', message: `${round(unsampled, 1)} min of exposure was not sampled and no documented assumption was selected; no 8-hour TWA is produced.` });
        continue;
      }
      if (just.length < 20) {
        flags.push({ code: 'ASSUMPTION_UNJUSTIFIED', severity: 'incomplete', message: 'An unsampled-period assumption requires a written justification (min 20 characters).' });
        continue;
      }
      if (p.unsampledAssumption === 'same_as_sampled') {
        lo += (lo / sampled) * unsampled;
        hi += (hi / sampled) * unsampled;
        flags.push({ code: 'EXTRAPOLATED', severity: 'qualify', message: `Unsampled ${round(unsampled, 1)} min assumed at the sampled mean concentration. Justification: ${just}` });
      } else {
        flags.push({ code: 'UNSAMPLED_ZERO', severity: 'qualify', message: `Unsampled ${round(unsampled, 1)} min assumed to involve no exposure. Justification: ${just}` });
      }
    }
    out.twa8h = { lower: round(lo / REFERENCE_PERIOD_MIN), upper: Number.isFinite(hi) ? round(hi / REFERENCE_PERIOD_MIN) : Infinity, unit };
  }
  return res;
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

export function compareInterval(i: Interval | null, b: BenchmarkRef): { state: ComparisonState; ratio: { lower: number; upper: number } | null; reason?: string } {
  if (!i) return { state: 'not_comparable', ratio: null, reason: 'No calculated exposure.' };
  if (i.unit !== b.unit) return { state: 'not_comparable', ratio: null, reason: `Exposure unit ${i.unit} differs from benchmark unit ${b.unit}; unit conversion is not supported in this version.` };
  const ratio = { lower: round(i.lower / b.value, 4), upper: Number.isFinite(i.upper) ? round(i.upper / b.value, 4) : Infinity };
  if (i.upper < b.value) return { state: 'below_benchmark', ratio };
  if (i.lower >= b.value) return { state: 'at_or_above_benchmark', ratio };
  return { state: 'indeterminate', ratio, reason: 'The result interval spans the benchmark value (e.g. a non-detect whose limit exceeds the benchmark).' };
}

// ───────────────────────── Assessment roll-up ─────────────────────────

export interface AssessmentInput {
  calc: 'twa_8h';
  samples: SampleInput[];
  parameters: TwaParameters;
  benchmark: BenchmarkRef | null;
}
export interface AssessmentOutput {
  engineVersion: string;
  calcCode: string;
  calcVersion: string;
  samples: SampleOutput[];
  shifts: (ShiftTwa & { comparison: ReturnType<typeof compareInterval> | null })[];
  staticSamples: { sampleCode: string; concentration: Interval | null; note: string }[];
  dataQualityState: 'complete' | 'qualified' | 'incomplete' | 'failed';
  benchmarkState: 'below_benchmark' | 'at_or_above_benchmark' | 'indeterminate' | 'not_comparable' | 'no_verified_benchmark';
  benchmarkNote: string;
  issues: Flag[];
  disclaimer: string;
}

export const CALCULATIONS = {
  twa_8h: { code: 'twa_8h', version: '1.1.0' },
};

export function runAssessment(input: AssessmentInput): AssessmentOutput {
  const samples = input.samples.map(sampleConcentration);
  const shifts = twa8h(samples, input.parameters);
  const issues: Flag[] = [];
  const staticSamples = samples
    .filter((s) => s.sampleType === 'static' && s.included)
    .map((s) => ({ sampleCode: s.sampleCode, concentration: s.concentration, note: 'Static/area sample — contextual evidence only; not compared with personal exposure benchmarks.' }));

  const b = input.benchmark;
  let benchmarkState: AssessmentOutput['benchmarkState'];
  let benchmarkNote = '';
  const usable = b && b.verificationStatus === 'verified' && b.averagingMinutes === REFERENCE_PERIOD_MIN;
  const withCmp = shifts.map((sh) => ({
    ...sh,
    comparison: usable && !sh.indicative ? compareInterval(sh.twa8h, b!) : null,
  }));

  if (!b) { benchmarkState = 'no_verified_benchmark'; benchmarkNote = 'No benchmark selected.'; }
  else if (b.verificationStatus !== 'verified') { benchmarkState = 'no_verified_benchmark'; benchmarkNote = `Selected benchmark version is ${b.verificationStatus}; it cannot be used for comparison until verified.`; }
  else if (b.averagingMinutes !== REFERENCE_PERIOD_MIN) { benchmarkState = 'not_comparable'; benchmarkNote = `Benchmark averaging period (${b.averagingMinutes} min) does not match the 8-hour TWA calculation.`; }
  else {
    const formal = withCmp.filter((s) => s.comparison);
    if (!formal.length) {
      benchmarkState = 'not_comparable';
      benchmarkNote = shifts.length ? 'Only indicative (screening) personal results are available; no formal benchmark comparison.' : 'No personal 8-hour TWA results are available; static results are not comparable with personal benchmarks.';
    } else {
      const st = formal.map((s) => s.comparison!.state);
      benchmarkState = st.includes('at_or_above_benchmark') ? 'at_or_above_benchmark'
        : st.includes('indeterminate') || st.includes('not_comparable') ? 'indeterminate'
        : 'below_benchmark';
      const incompleteShifts = withCmp.filter((s) => !s.twa8h).length;
      if (incompleteShifts && benchmarkState === 'below_benchmark') benchmarkState = 'indeterminate';
      benchmarkNote = `${formal.length} formal worker-shift result(s) compared with ${b.type} ${b.value} ${b.unit} (${b.source}).`;
      if (incompleteShifts) benchmarkNote += ` ${incompleteShifts} worker-shift(s) could not be calculated.`;
    }
    // Evidence that was excluded or is only indicative must not be outweighed silently: if any such personal
    // result is itself at or above the benchmark, a favourable roll-up becomes indeterminate.
    const highSet = samples.filter((s) => s.sampleType === 'personal' && (!s.included || s.indicative) && s.concentration && s.concentration.unit === b.unit && s.concentration.lower >= b.value);
    if (highSet.length && (benchmarkState === 'below_benchmark' || benchmarkState === 'not_comparable')) {
      benchmarkState = 'indeterminate';
      benchmarkNote += ` ${highSet.length} excluded or indicative result(s) (${highSet.map((s) => s.sampleCode).join(', ')}) are at or above the benchmark value; they must be explained before any favourable conclusion.`;
    }
    if (b.isSynthetic && !/synthetic/i.test(b.source)) benchmarkNote += ' SYNTHETIC DEMONSTRATION BENCHMARK — not a real exposure limit.';
  }

  for (const s of samples) for (const f of s.flags) if (f.severity !== 'info') issues.push({ ...f, message: `${s.sampleCode}: ${f.message}` });
  for (const s of shifts) for (const f of s.flags) if (f.severity !== 'info') issues.push({ ...f, message: `${s.subjectRef} ${s.shiftDate}: ${f.message}` });

  const usableSamples = samples.filter((s) => s.included && s.sampleType !== 'field_blank');
  let dq: AssessmentOutput['dataQualityState'];
  if (!usableSamples.length) dq = 'failed';
  else if (issues.some((f) => f.severity === 'incomplete') || shifts.some((s) => !s.twa8h)) dq = 'incomplete';
  else if (issues.length) dq = 'qualified';
  else dq = 'complete';
  if (samples.some((s) => !s.included && s.sampleType !== 'field_blank') && dq === 'complete') dq = 'qualified';

  return {
    engineVersion: ENGINE_VERSION, calcCode: 'twa_8h', calcVersion: CALCULATIONS.twa_8h.version,
    samples, shifts: withCmp, staticSamples, dataQualityState: dq, benchmarkState, benchmarkNote, issues,
    disclaimer: 'Calculated outputs and benchmark comparisons are not a compliance conclusion. Professional interpretation by a competent person is required.',
  };
}

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
    diff.push({ aspect: 'Mean sampled duration (min)', before: String(b ?? '—'), after: String(a ?? '—') });
  return { comparable: diff.length === 0, differences: diff };
}
