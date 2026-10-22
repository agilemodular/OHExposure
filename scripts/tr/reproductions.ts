// TR-01–TR-05 reproductions from the AI-assisted technical review of commit ceec79f.
// Inputs are fixed; do not change them to make results pass. Prints the engine's output for each case as JSON.
//   npx tsx scripts/tr/reproductions.ts [out.json]
import { writeFileSync } from 'node:fs';
import * as E from '../../src/calc/engine.js';

const method = { code: 'M', version: '1', resultBasis: 'mass_on_sample' as const, flowDriftTolerancePct: 5, minVolumeL: null, suitableForFormalAssessment: true };
const inst = { assetTag: 'P1', screeningOnly: false, calibrationValidAtSampling: true };
const base = (o: any = {}): E.SampleInput => ({ sampleId: o.sampleCode ?? 'S', sampleCode: 'S', sampleType: 'personal', subjectRef: 'W1', startAt: '2026-03-02T08:00:00Z', endAt: '2026-03-02T16:00:00Z', timezone: 'UTC', interruptions: [], flowPreLpm: 2, flowPostLpm: 2, method, instrument: inst, qc: [], result: { revision: 1, value: 300, unit: 'ug', qualifier: '=', lod: 10, loq: 30 }, ...o });
const bm = (value: number, averagingMinutes = 480) => ({ versionId: 'b', type: 'SYNTHETIC', averagingMinutes, value, unit: 'mg/m3' as const, verificationStatus: 'verified' as const, isSynthetic: true, source: 'synthetic' });
const P = { exposureMinutesPerShift: 480, unsampledAssumption: 'none' as const };
const view = (r: E.AssessmentOutput) => ({
  engine: r.engineVersion, calc: `${r.calcCode} ${r.calcVersion}`, dataQuality: r.dataQualityState, benchmarkState: r.benchmarkState,
  ...(('evidenceAdequacy' in r) ? { evidenceAdequacy: (r as any).evidenceAdequacy, calculationAvailability: (r as any).calculationAvailability } : {}),
  note: r.benchmarkNote,
  samples: r.samples.map((s) => ({ code: s.sampleCode, included: s.included, indicative: s.indicative, sampledMinutes: s.sampledMinutes, volumeL: s.volumeL, concentration: s.concentration, flags: s.flags.map((f) => `${f.code}:${f.severity}`) })),
  results: r.shifts.map((x: any) => ({ subject: x.subjectRef, result: x.result, comparison: x.comparison?.state ?? null, flags: x.flags.map((f: any) => `${f.code}:${f.severity}`) })),
});

const cases: Record<string, { description: string; output: unknown }> = {};
// TR-01: a 16-minute sample averaging 0.975 mg/m³ against a 15-minute benchmark of 1 mg/m³.
// 0.975 mg/m³ × 32 L (16 min × 2 L/min) = 31.2 µg.
cases['TR-01'] = { description: '16-minute sample, average 0.975 mg/m³, 15-minute benchmark 1 mg/m³', output: view(E.runAssessment({ calc: 'stel_15',
  samples: [base({ startAt: '2026-03-02T10:00:00Z', endAt: '2026-03-02T10:16:00Z', result: { revision: 1, value: 31.2, unit: 'ug', qualifier: '=', lod: 1, loq: 3 } })],
  parameters: { exposureMinutesPerShift: null, unsampledAssumption: 'none' } as any, benchmark: bm(1, 15) })) };
// TR-02: one valid worker below 0.5 mg/m³; another worker's excluded non-detect, interval 0–2 mg/m³ (< 1920 µg over 960 L).
cases['TR-02'] = { description: 'W1 valid 0.3125 mg/m³; W2 excluded (failed QC) non-detect 0–2 mg/m³; benchmark 0.5 mg/m³', output: view(E.runAssessment({ calc: 'twa_8h',
  samples: [base({ sampleCode: 'A' }), base({ sampleCode: 'B', subjectRef: 'W2', result: { revision: 1, value: null, unit: 'ug', qualifier: '<LOD', lod: 1920, loq: 5000 }, qc: [{ checkType: 'flow_check', outcome: 'fail', disposition: null }] })],
  parameters: P, benchmark: bm(0.5) })) };
// TR-03: below LOQ with LOD 1000 µg and LOQ 1 µg (contradictory limits).
cases['TR-03'] = { description: '<LOQ with LOD 1000 µg and LOQ 1 µg; benchmark 0.5 mg/m³', output: view(E.runAssessment({ calc: 'twa_8h',
  samples: [base({ result: { revision: 1, value: null, unit: 'ug', qualifier: '<LOQ', lod: 1000, loq: 1 } })], parameters: P, benchmark: bm(0.5) })) };
// TR-04: 0.000384 µg over 480 min at 2 L/min = 4e-7 mg/m³; benchmark 3e-7 mg/m³.
cases['TR-04'] = { description: '0.000384 µg over 960 L (4e-7 mg/m³); benchmark 3e-7 mg/m³', output: view(E.runAssessment({ calc: 'twa_8h',
  samples: [base({ result: { revision: 1, value: 0.000384, unit: 'ug', qualifier: '=', lod: 0.0001, loq: 0.0003 } })], parameters: P, benchmark: bm(0.0000003) })) };
// TR-05: flow 2 → 1 L/min against a 5 % tolerance.
cases['TR-05'] = { description: 'Flow 2.0 L/min before, 1.0 L/min after, method tolerance 5 %; benchmark 0.5 mg/m³', output: view(E.runAssessment({ calc: 'twa_8h',
  samples: [base({ flowPostLpm: 1 })], parameters: P, benchmark: bm(0.5) })) };

const out = { engine: E.ENGINE_VERSION, methods: Object.fromEntries(Object.entries(E.CALCULATIONS).map(([k, v]) => [k, v.version])), cases };
const json = JSON.stringify(out, (_k, v) => (v === Infinity ? 'Infinity' : v), 2);
if (process.argv[2]) writeFileSync(process.argv[2], json); else console.log(json);
