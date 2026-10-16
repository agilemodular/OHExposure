import { describe, expect, it } from 'vitest';
import { comparability, compareInterval, runAssessment, sampleConcentration, twa8h, type BenchmarkRef, type SampleInput } from '../src/calc/engine.js';

const method = { code: 'TEST-GRAV', version: '1', resultBasis: 'mass_on_sample' as const, flowDriftTolerancePct: 5, minVolumeL: null, suitableForFormalAssessment: true };
const inst = { assetTag: 'P-01', screeningOnly: false, calibrationValidAtSampling: true };
function s(o: Partial<SampleInput> = {}): SampleInput {
  return {
    sampleId: o.sampleCode ?? 'S1', sampleCode: 'S1', sampleType: 'personal', subjectRef: 'W-001',
    startAt: '2026-03-02T08:00:00Z', endAt: '2026-03-02T12:00:00Z', timezone: 'Europe/London', interruptions: [],
    flowPreLpm: 2.0, flowPostLpm: 2.0, method, instrument: inst, qc: [],
    result: { revision: 1, value: 120, unit: 'ug', qualifier: '=', lod: 5, loq: 15 }, ...o,
  };
}
const bm = (o: Partial<BenchmarkRef> = {}): BenchmarkRef => ({ versionId: 'b1', type: 'TEST-LTEL', averagingMinutes: 480, value: 0.2, unit: 'mg/m3', verificationStatus: 'verified', isSynthetic: true, source: 'synthetic', ...o });

describe('sample_concentration v1', () => {
  it('computes mg/m3 from mass, mean flow and sampled duration', () => {
    const o = sampleConcentration(s());
    expect(o.sampledMinutes).toBe(240);
    expect(o.volumeL).toBe(480);
    expect(o.concentration).toEqual({ lower: 0.25, upper: 0.25, unit: 'mg/m3' });
    expect(o.isPointValue).toBe(true);
    expect(o.flags).toEqual([]);
  });
  it('subtracts interruptions from sampled time', () => {
    const o = sampleConcentration(s({ interruptions: [{ start: '2026-03-02T10:00:00Z', end: '2026-03-02T10:30:00Z' }] }));
    expect(o.sampledMinutes).toBe(210);
    expect(o.volumeL).toBe(420);
  });
  it('never replaces a non-detect with zero: carries an interval to the LOD', () => {
    const o = sampleConcentration(s({ result: { revision: 1, value: null, unit: 'ug', qualifier: '<LOD', lod: 5, loq: 15 } }));
    expect(o.concentration!.lower).toBe(0);
    expect(o.concentration!.upper).toBeCloseTo(5 / 1000 / 0.48, 6);
    expect(o.isPointValue).toBe(false);
    expect(o.flags.map((f) => f.code)).toContain('NON_DETECT');
  });
  it('a non-detect without any limit is incomplete, not zero', () => {
    const o = sampleConcentration(s({ result: { revision: 1, value: null, unit: 'ug', qualifier: '<LOD', lod: null, loq: null } }));
    expect(o.concentration).toBeNull();
    expect(o.flags.map((f) => f.code)).toContain('ND_NO_LIMIT');
  });
  it('treats over-range as unbounded above', () => {
    const o = sampleConcentration(s({ result: { revision: 1, value: 500, unit: 'ug', qualifier: '>', lod: null, loq: null } }));
    expect(o.concentration!.upper).toBe(Infinity);
  });
  it('missing flow or duration makes the sample incomplete', () => {
    expect(sampleConcentration(s({ flowPostLpm: null })).concentration).toBeNull();
    expect(sampleConcentration(s({ endAt: null })).flags.map((f) => f.code)).toContain('DURATION_MISSING');
    expect(sampleConcentration(s({ endAt: '2026-03-02T07:00:00Z' })).flags.map((f) => f.code)).toContain('DURATION_INVALID');
  });
  it('flags flow drift beyond the method tolerance, and missing tolerance', () => {
    expect(sampleConcentration(s({ flowPostLpm: 1.8 })).flags.map((f) => f.code)).toContain('FLOW_DRIFT_EXCEEDED');
    expect(sampleConcentration(s({ method: { ...method, flowDriftTolerancePct: null } })).flags.map((f) => f.code)).toContain('FLOW_TOLERANCE_UNDEFINED');
  });
  it('excludes a sample with an unresolved failed QC check and keeps the failure visible', () => {
    const o = sampleConcentration(s({ qc: [{ checkType: 'post-flow check', outcome: 'fail', disposition: null }] }));
    expect(o.included).toBe(false);
    expect(o.flags[0].code).toBe('QC_FAIL_UNRESOLVED');
  });
  it('includes but qualifies a failed QC check accepted with justification', () => {
    const o = sampleConcentration(s({ qc: [{ checkType: 'leak check', outcome: 'fail', disposition: 'accepted_with_justification' }] }));
    expect(o.included).toBe(true);
    expect(o.flags[0].severity).toBe('qualify');
  });
  it('labels screening-only instruments as indicative', () => {
    expect(sampleConcentration(s({ instrument: { ...inst, screeningOnly: true } })).indicative).toBe(true);
  });
  it('flags missing calibration evidence', () => {
    expect(sampleConcentration(s({ instrument: { ...inst, calibrationValidAtSampling: null } })).flags.map((f) => f.code)).toContain('CALIBRATION_MISSING');
  });
  it('rejects a result unit that contradicts the method basis', () => {
    const o = sampleConcentration(s({ result: { revision: 1, value: 0.2, unit: 'mg/m3', qualifier: '=', lod: null, loq: null } }));
    expect(o.concentration).toBeNull();
  });
  it('converts direct concentration results in ug/m3 to mg/m3', () => {
    const o = sampleConcentration(s({ method: { ...method, resultBasis: 'concentration' }, result: { revision: 1, value: 250, unit: 'ug/m3', qualifier: '=', lod: null, loq: null } }));
    expect(o.concentration).toEqual({ lower: 0.25, upper: 0.25, unit: 'mg/m3' });
  });
});

describe('twa_8h v1', () => {
  const full = [
    sampleConcentration(s({ sampleCode: 'A', sampleId: 'A' })), // 0.25 for 240
    sampleConcentration(s({ sampleCode: 'B', sampleId: 'B', startAt: '2026-03-02T12:30:00Z', endAt: '2026-03-02T16:30:00Z', result: { revision: 1, value: 48, unit: 'ug', qualifier: '=', lod: 5, loq: 15 } })), // 0.1 for 240
  ];
  it('computes Σ(C·T)/480 for consecutive samples', () => {
    const [r] = twa8h(full, { exposureMinutesPerShift: 480, unsampledAssumption: 'none' });
    expect(r.twa8h).toEqual({ lower: 0.175, upper: 0.175, unit: 'mg/m3' });
    expect(r.coveragePct).toBe(100);
  });
  it('produces no TWA when unsampled exposure has no documented assumption', () => {
    const [r] = twa8h([full[0]], { exposureMinutesPerShift: 480, unsampledAssumption: 'none' });
    expect(r.twa8h).toBeNull();
    expect(r.flags[0].code).toBe('COVERAGE_INCOMPLETE');
  });
  it('requires a justification for any unsampled-period assumption', () => {
    const [r] = twa8h([full[0]], { exposureMinutesPerShift: 480, unsampledAssumption: 'zero_exposure', unsampledJustification: 'short' });
    expect(r.twa8h).toBeNull();
  });
  it('applies zero-exposure and same-as-sampled assumptions when justified', () => {
    const j = 'Worker observed in office with no process access for the remainder of the shift.';
    expect(twa8h([full[0]], { exposureMinutesPerShift: 480, unsampledAssumption: 'zero_exposure', unsampledJustification: j })[0].twa8h!.upper).toBe(0.125);
    expect(twa8h([full[0]], { exposureMinutesPerShift: 480, unsampledAssumption: 'same_as_sampled', unsampledJustification: j })[0].twa8h!.upper).toBe(0.25);
  });
  it('uses actual exposure time over 8 h against the 480 min reference', () => {
    const one = sampleConcentration(s({ endAt: '2026-03-02T18:00:00Z' })); // 600 min, 1200 L, 0.1 mg/m3
    const [r] = twa8h([one], { exposureMinutesPerShift: 600, unsampledAssumption: 'none' });
    expect(r.twa8h!.upper).toBe(0.125);
  });
  it('requires an exposure period', () => {
    expect(twa8h(full, { exposureMinutesPerShift: null, unsampledAssumption: 'none' })[0].twa8h).toBeNull();
  });
  it('ignores static samples', () => {
    expect(twa8h([sampleConcentration(s({ sampleType: 'static' }))], { exposureMinutesPerShift: 240, unsampledAssumption: 'none' })).toHaveLength(0);
  });
});

describe('benchmark comparison', () => {
  it('classifies intervals relative to the benchmark', () => {
    expect(compareInterval({ lower: 0.1, upper: 0.1, unit: 'mg/m3' }, bm()).state).toBe('below_benchmark');
    expect(compareInterval({ lower: 0.2, upper: 0.2, unit: 'mg/m3' }, bm()).state).toBe('at_or_above_benchmark');
    expect(compareInterval({ lower: 0, upper: 0.3, unit: 'mg/m3' }, bm()).state).toBe('indeterminate');
    expect(compareInterval({ lower: 0.1, upper: 0.1, unit: 'ppm' }, bm()).state).toBe('not_comparable');
  });
});

describe('assessment roll-up', () => {
  const params = { exposureMinutesPerShift: 240, unsampledAssumption: 'none' as const };
  it('does not compare with an unverified benchmark', () => {
    const o = runAssessment({ calc: 'twa_8h', samples: [s()], parameters: params, benchmark: bm({ verificationStatus: 'unverified' }) });
    expect(o.benchmarkState).toBe('no_verified_benchmark');
  });
  it('never yields a safe/compliant verdict field', () => {
    const o = runAssessment({ calc: 'twa_8h', samples: [s()], parameters: params, benchmark: bm({ value: 10 }) }) as any;
    expect(o.benchmarkState).toBe('below_benchmark');
    expect(JSON.stringify(o)).not.toMatch(/"(safe|compliant)"/);
    expect(o.disclaimer).toMatch(/not a compliance conclusion/);
  });
  it('treats static-only evidence as not comparable', () => {
    const o = runAssessment({ calc: 'twa_8h', samples: [s({ sampleType: 'static' })], parameters: params, benchmark: bm() });
    expect(o.benchmarkState).toBe('not_comparable');
    expect(o.staticSamples).toHaveLength(1);
  });
  it('treats screening-only evidence as not formally comparable', () => {
    const o = runAssessment({ calc: 'twa_8h', samples: [s({ instrument: { ...inst, screeningOnly: true } })], parameters: params, benchmark: bm({ value: 10 }) });
    expect(o.benchmarkState).toBe('not_comparable');
    // …but an indicative result at or above the benchmark makes the comparison indeterminate, not silently ignorable
    expect(runAssessment({ calc: 'twa_8h', samples: [s({ instrument: { ...inst, screeningOnly: true } })], parameters: params, benchmark: bm() }).benchmarkState).toBe('indeterminate');
  });
  it('reports failed data quality when every sample is excluded', () => {
    const o = runAssessment({ calc: 'twa_8h', samples: [s({ qc: [{ checkType: 'flow', outcome: 'fail', disposition: null }] })], parameters: params, benchmark: bm() });
    expect(o.dataQualityState).toBe('failed');
  });
  it('downgrades below-benchmark to indeterminate when some worker-shifts are incomplete', () => {
    const o = runAssessment({ calc: 'twa_8h', samples: [s(), s({ sampleCode: 'X', sampleId: 'X', subjectRef: 'W-002', flowPostLpm: null })], parameters: params, benchmark: bm({ value: 10 }) });
    expect(o.dataQualityState).toBe('incomplete');
    expect(o.benchmarkState).toBe('indeterminate');
  });
  it('rejects a benchmark with a non-matching averaging period', () => {
    const o = runAssessment({ calc: 'twa_8h', samples: [s()], parameters: params, benchmark: bm({ averagingMinutes: 15 }) });
    expect(o.benchmarkState).toBe('not_comparable');
  });
  it('is deterministic', () => {
    const a = runAssessment({ calc: 'twa_8h', samples: [s()], parameters: params, benchmark: bm() });
    const b = runAssessment({ calc: 'twa_8h', samples: [s()], parameters: params, benchmark: bm() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('before/after comparability', () => {
  it('surfaces differences that affect comparability', () => {
    const base = { label: 'b', methods: ['M1'], meanSampledMinutes: 400, tasks: ['grinding'], operatingConditions: ['normal'], controlStatus: ['LEV off'], sampleTypes: ['personal'] };
    const r = comparability(base, { ...base, label: 'a', controlStatus: ['LEV on'], meanSampledMinutes: 200 });
    expect(r.comparable).toBe(false);
    expect(r.differences.map((d) => d.aspect)).toEqual(['Control status during sampling', 'Mean sampled duration (min)']);
  });
});
