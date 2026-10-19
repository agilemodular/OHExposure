// Regenerates docs/examples/validation-examples.json: the engine's own output for every worked example in the
// professional validation pack (E1–E14), so the reviewer sees exactly what the application produces.
//   npx tsx scripts/generate-validation-examples.ts
import { writeFileSync } from 'node:fs';
import { CALCULATIONS, ENGINE_VERSION, MOLAR_VOLUME_L, convertInterval, runAssessment, sampleConcentration, stel15, twa8h, type SampleInput } from '../src/calc/engine.js';

const method = { code: 'M', version: '1', resultBasis: 'mass_on_sample' as const, flowDriftTolerancePct: 5, minVolumeL: null, suitableForFormalAssessment: true };
const inst = { assetTag: 'P1', screeningOnly: false, calibrationValidAtSampling: true };
const s = (o: Partial<SampleInput>): SampleInput => ({ sampleId: o.sampleCode ?? 'S', sampleCode: 'S', sampleType: 'personal', subjectRef: 'W1', startAt: '2026-03-02T08:00:00Z', endAt: '2026-03-02T16:00:00Z', timezone: 'UTC', interruptions: [], flowPreLpm: 2, flowPostLpm: 2, method, instrument: inst, qc: [], result: { revision: 1, value: 300, unit: 'ug', qualifier: '=', lod: 10, loq: 30 }, ...o });
const res = (value: number | null, qualifier: any = '=', lod = 10, loq = 30) => ({ revision: 1, value, unit: 'ug' as const, qualifier, lod, loq });
const bm = (v: number, avg = 480) => ({ versionId: 'b', type: 'EXAMPLE', averagingMinutes: avg, value: v, unit: 'mg/m3' as const, verificationStatus: 'verified' as const, isSynthetic: true, source: 'synthetic example' });
const P = { exposureMinutesPerShift: 480, unsampledAssumption: 'none' as const };
const J = 'Worker in office with no process access for the rest of the shift.';
const run = (samples: SampleInput[], b = bm(0.5), p: any = P, calc: any = 'twa_8h') => {
  const r = runAssessment({ calc, samples, parameters: p, benchmark: b });
  return { dataQuality: r.dataQualityState, benchmarkState: r.benchmarkState, note: r.benchmarkNote, results: r.shifts.map((x: any) => ({ subject: x.subjectRef, result: x.result, flags: x.flags.map((f: any) => f.code) })), issues: r.issues.map((f: any) => f.code) };
};
const conc = (x: SampleInput) => { const o = sampleConcentration(x); return { sampledMinutes: o.sampledMinutes, volumeL: o.volumeL, concentration: o.concentration, indicative: o.indicative, flags: o.flags.map((f) => f.code) }; };
const calFail = { ...inst, calibrationValidAtSampling: false };

const examples = {
  E1: { sample: conc(s({})), assessment: run([s({})]) },
  E2: { sample: conc(s({ flowPostLpm: 1.8, interruptions: [{ start: '2026-03-02T12:00:00Z', end: '2026-03-02T12:30:00Z' }] })) },
  E3: { assessment: run([s({ sampleCode: 'A', endAt: '2026-03-02T12:00:00Z', result: res(240) }), s({ sampleCode: 'B', startAt: '2026-03-02T12:00:00Z', result: res(96) })]) },
  E4: {
    none: twa8h([sampleConcentration(s({ endAt: '2026-03-02T12:00:00Z', result: res(240) }))], P)[0],
    zero: twa8h([sampleConcentration(s({ endAt: '2026-03-02T12:00:00Z', result: res(240) }))], { ...P, unsampledAssumption: 'zero_exposure', unsampledJustification: J })[0].twa8h,
    same: twa8h([sampleConcentration(s({ endAt: '2026-03-02T12:00:00Z', result: res(240) }))], { ...P, unsampledAssumption: 'same_as_sampled', unsampledJustification: J })[0].twa8h,
  },
  E5: { sample: conc(s({ result: res(null, '<LOD') })), vs0_05: run([s({ result: res(null, '<LOD') })], bm(0.05)).benchmarkState, vs0_005: run([s({ result: res(null, '<LOD') })], bm(0.005)).benchmarkState },
  E6: { assessment: run([s({ endAt: '2026-03-02T18:00:00Z', result: res(360) })], bm(0.5), { ...P, exposureMinutesPerShift: 600 }) },
  E7: { stel: stel15([sampleConcentration(s({ startAt: '2026-03-02T10:00:00Z', endAt: '2026-03-02T10:15:00Z', result: res(45, '=', 1, 3) }))], {})[0].result },
  E7b: { stel: stel15([sampleConcentration(s({ startAt: '2026-03-02T10:00:00Z', endAt: '2026-03-02T10:10:00Z', result: res(45, '=', 1, 3) }))], { shortSampleAssumption: 'zero_remainder', shortSampleJustification: 'Decanting task observed to last 10 minutes.' })[0].result },
  E8: { molarVolumeL: MOLAR_VOLUME_L, converted: convertInterval({ lower: 20, upper: 20, unit: 'ppm' }, 'mg/m3', 92.14) },
  E9: { assessment: run([s({ sampleCode: 'A', endAt: '2026-03-02T12:00:00Z', result: res(240) }), s({ sampleCode: 'B', startAt: '2026-03-02T11:00:00Z', result: res(240) })]) },
  E10a: { assessment: run([s({ instrument: calFail })], bm(1)) },
  E10b: { assessment: run([s({ instrument: calFail })], bm(0.2)) },
  E10c: { assessment: run([s({ sampleCode: 'OK', subjectRef: 'W2', result: res(96) }), s({ sampleCode: 'CAL', instrument: calFail })], bm(0.2)) },
  E11: { assessment: run([s({ sampleType: 'static' })], bm(0.2)) },
  E12: { assessment: run([s({ instrument: { ...inst, screeningOnly: true } })], bm(1)) },
  E13: { sample: conc(s({ result: res(null, '<LOQ') })), vs0_02: run([s({ result: res(null, '<LOQ') })], bm(0.02)).benchmarkState },
  E14: { assessment: run([s({ qc: [{ checkType: 'flow_check', outcome: 'fail', disposition: null }] })]) },
};
const out = { generated: new Date().toISOString(), engine: ENGINE_VERSION, calculations: CALCULATIONS, note: 'Synthetic inputs as stated in docs/hygienist-review-pack.md §3; benchmark values are examples, not exposure limits.', examples };
writeFileSync(new URL('../docs/examples/validation-examples.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('written', Object.keys(examples).length, 'examples');
