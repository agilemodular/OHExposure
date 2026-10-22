// TR-06 and TR-07 reproductions from the independent technical review of package 9b87c17 (engine 1.4.0).
// Inputs are exactly as stated in the review; do not change them to make results pass. Prints the engine output as JSON.
//   npx tsx scripts/tr/reproductions-tr06-tr07.ts [out.json]
import { writeFileSync } from 'node:fs';
import * as E from '../../src/calc/engine.js';

const conc = { code: 'DR', version: '1', resultBasis: 'concentration' as const, flowDriftTolerancePct: null, minVolumeL: null, suitableForFormalAssessment: true };
const mass = { code: 'M', version: '1', resultBasis: 'mass_on_sample' as const, flowDriftTolerancePct: 5, minVolumeL: null, suitableForFormalAssessment: true };
const inst = { assetTag: 'P1', screeningOnly: false, calibrationValidAtSampling: true };
const bm = (value: number, averagingMinutes: number) => ({ versionId: 'b', type: 'SYNTHETIC', averagingMinutes, value, unit: 'mg/m3' as const, verificationStatus: 'verified' as const, isSynthetic: true, source: 'synthetic' });
const view = (r: E.AssessmentOutput) => ({
  engine: r.engineVersion, calc: `${r.calcCode} ${r.calcVersion}`, dataQuality: r.dataQualityState, benchmarkState: r.benchmarkState,
  evidenceAdequacy: r.evidenceAdequacy, calculationAvailability: r.calculationAvailability, note: r.benchmarkNote,
  unresolvedEvidence: r.unresolvedEvidence, setAsideEvidence: r.setAsideEvidence,
  samples: r.samples.map((s) => ({ code: s.sampleCode, included: s.included, sampledMinutes: s.sampledMinutes, volumeL: s.volumeL, concentration: s.concentration, flags: s.flags.map((f) => `${f.code}:${f.severity}`), messages: s.flags.filter((f) => f.code.startsWith('INPUT_INVALID')).map((f) => f.message) })),
  results: r.shifts.map((x: any) => ({ subject: x.subjectRef, samples: x.sampleCodes, result: x.result, comparison: x.comparison?.state ?? null, flags: x.flags.map((f: any) => `${f.code}:${f.severity}`) })),
});

// TR-06: duplicate disposition across different sampling windows.
//   AM: W1 08:00–08:15, 0.1 mg/m³, valid.  PM: W1 15:00–15:15, 2 mg/m³, failed QC without an accepted disposition.
//   Synthetic 15-minute benchmark 1 mg/m³.
const am: E.SampleInput = { sampleId: 'AM', sampleCode: 'AM', sampleType: 'personal', subjectRef: 'W1', startAt: '2026-03-02T08:00:00Z', endAt: '2026-03-02T08:15:00Z', timezone: 'UTC',
  interruptions: [], flowPreLpm: null, flowPostLpm: null, method: conc, instrument: inst, qc: [], result: { revision: 1, value: 0.1, unit: 'mg/m3', qualifier: '=', lod: null, loq: null } };
const pm: E.SampleInput = { ...am, sampleId: 'PM', sampleCode: 'PM', startAt: '2026-03-02T15:00:00Z', endAt: '2026-03-02T15:15:00Z',
  qc: [{ checkType: 'flow_check', outcome: 'fail', disposition: null }], result: { revision: 1, value: 2, unit: 'mg/m3', qualifier: '=', lod: null, loq: null } };
const dup: E.EvidenceDisposition = { kind: 'duplicate', relatedSampleCode: 'AM', reason: 'Recorded as a duplicate of the morning sample', consequence: 'The morning sample represents this worker and shift', authorisedBy: 'Practitioner P' };
const stel = { shortSampleAssumption: 'none' } as any;

const cases: Record<string, { description: string; output: unknown }> = {};
cases['TR-06-before-disposition'] = { description: 'AM valid 0.1 mg/m³ (08:00–08:15); PM excluded 2 mg/m³ (15:00–15:15, failed QC, no disposition); 15-min benchmark 1 mg/m³; no evidence disposition',
  output: view(E.runAssessment({ calc: 'stel_15', samples: [am, pm], parameters: stel, benchmark: bm(1, 15) })) };
cases['TR-06-duplicate'] = { description: 'Same inputs; PM dispositioned as "duplicate" of AM by a practitioner (no duplicate category or pairing evidence supplied, as in the review)',
  output: view(E.runAssessment({ calc: 'stel_15', samples: [am, { ...pm, evidenceDisposition: dup }], parameters: stel, benchmark: bm(1, 15) })) };

// TR-07: detected_below_loq with a contradictory reported value.
//   600 µg, LOD 10 µg, LOQ 30 µg, 960 L (480 min × 2 L/min), synthetic 8-hour benchmark 0.5 mg/m³.
const dbl: E.SampleInput = { sampleId: 'D', sampleCode: 'D', sampleType: 'personal', subjectRef: 'W1', startAt: '2026-03-02T08:00:00Z', endAt: '2026-03-02T16:00:00Z', timezone: 'UTC',
  interruptions: [], flowPreLpm: 2, flowPostLpm: 2, method: mass, instrument: inst, qc: [], result: { revision: 1, value: 600, unit: 'ug', qualifier: 'detected_below_loq', lod: 10, loq: 30 } };
cases['TR-07'] = { description: 'detected_below_loq, reported value 600 µg, LOD 10 µg, LOQ 30 µg, 960 L; 8-hour benchmark 0.5 mg/m³',
  output: view(E.runAssessment({ calc: 'twa_8h', samples: [dbl], parameters: { exposureMinutesPerShift: 480, unsampledAssumption: 'none' }, benchmark: bm(0.5, 480) })) };

const out = { engine: E.ENGINE_VERSION, methods: Object.fromEntries(Object.entries(E.CALCULATIONS).map(([k, v]) => [k, v.version])), cases };
const json = JSON.stringify(out, (_k, v) => (v === Infinity ? 'Infinity' : v), 2);
if (process.argv[2]) writeFileSync(process.argv[2], json); else console.log(json);
