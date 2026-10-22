// Structured regression fixtures (engine 1.5.0): original worked examples E1–E14, the TR-01–TR-05 reproductions from
// the technical review of ceec79f, TR-06/TR-07 from the review of 9b87c17, and new methodological cases. Expected values come from an independent Python
// calculation (scripts/tr/build_fixtures.py) and hand-written statuses; they are NOT produced by this engine.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CALCULATIONS, ENGINE_VERSION, convertInterval, runAssessment, serialiseOutput } from '../src/calc/engine.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/worked-examples.fixtures.json', import.meta.url), 'utf8'));
const close = (actual: unknown, expected: unknown, rel: number) => {
  if (expected === null) return expect(actual ?? null).toBeNull();
  if (expected === 'Infinity') return expect(actual).toBe(Infinity);
  const e = expected as number, a = actual as number;
  expect(typeof a).toBe('number');
  expect(Math.abs(a - e)).toBeLessThanOrEqual(Math.max(Math.abs(e) * rel, 1e-300));
};

describe('fixtures metadata', () => {
  it('match the implemented engine and method versions', () => {
    expect(F.engine.engine).toBe(ENGINE_VERSION);
    expect(F.engine.twa_8h).toBe(CALCULATIONS.twa_8h.version);
    expect(F.engine.stel_15).toBe(CALCULATIONS.stel_15.version);
  });
});

describe('fixture groups', () => {
  it('every fixture belongs to a group that is run', () => {
    expect(F.cases.filter((c: any) => !GROUPS.includes(c.group)).map((c: any) => c.id)).toEqual([]);
  });
});

const GROUPS = ['original', 'original-variant', 'TR', 'TR-variant', 'method', 'TR-06', 'TR-07'];
describe.each(GROUPS)('%s cases', (group) => {
  const cases: any[] = F.cases.filter((c: any) => c.group === group);
  it.each(cases.map((c: any) => ({ id: c.id, c })))('$id', ({ c }: { c: any }) => {
    const ex = c.expected, rel = c.tolerance.relative;
    if (ex.conversion) {
      const r = convertInterval(ex.conversion.from, ex.conversion.to, ex.conversion.molecularWeight)!;
      close(r.lower, ex.conversion.lower, rel); close(r.upper, ex.conversion.upper, rel);
      return;
    }
    if (ex.roundTrip) {
      const there = convertInterval({ lower: ex.roundTrip.value, upper: ex.roundTrip.value, unit: 'ppm' }, 'mg/m3', ex.roundTrip.molecularWeight)!;
      const back = convertInterval(there, 'ppm', ex.roundTrip.molecularWeight)!;
      close(back.lower, ex.roundTrip.value, ex.roundTrip.relative);
      return;
    }
    const out = runAssessment(c.input);
    expect(out.engineVersion).toBe(c.engineVersion);
    expect(out.calcVersion).toBe(c.methodVersion);
    if (ex.dataQuality) expect(out.dataQualityState).toBe(ex.dataQuality);
    if (ex.benchmarkState) expect(out.benchmarkState).toBe(ex.benchmarkState);
    if (ex.calculationAvailability) expect(out.calculationAvailability).toBe(ex.calculationAvailability);
    if (ex.evidenceAdequacy) expect(out.evidenceAdequacy).toBe(ex.evidenceAdequacy);
    if (ex.unresolved) expect(out.unresolvedEvidence.map((u) => u.sampleCode).sort()).toEqual([...ex.unresolved].sort());
    if (ex.notePattern) expect(out.benchmarkNote).toMatch(new RegExp(ex.notePattern));
    for (const [code, pattern] of Object.entries(ex.unresolvedWhy ?? {})) expect(out.unresolvedEvidence.find((u) => u.sampleCode === code)?.why ?? '').toMatch(new RegExp(pattern as string));
    if (ex.rejectedConflict) expect(out.unresolvedEvidence.filter((u) => u.rejectedDisposition?.conflict).map((u) => u.sampleCode).sort()).toEqual([...ex.rejectedConflict].sort());
    if (ex.setAside) {
      expect(out.setAsideEvidence.map((x) => x.sampleCode).sort()).toEqual(ex.setAside.map((x: any) => x.code).sort());
      for (const e of ex.setAside) { const a = out.setAsideEvidence.find((x) => x.sampleCode === e.code)!; expect(a.kind).toBe(e.kind); if (e.duplicateType) expect(a.duplicateType).toBe(e.duplicateType); }
    }
    const flags = [...out.samples.flatMap((s) => s.flags), ...out.shifts.flatMap((s) => s.flags)].map((f) => f.code);
    for (const f of ex.flagsInclude ?? []) expect(flags).toContain(f);
    const msgs = [...out.samples.flatMap((s) => s.flags), ...out.shifts.flatMap((s) => s.flags)];
    for (const [code, pattern] of Object.entries(ex.flagMessage ?? {})) expect(msgs.find((f) => f.code === code)?.message ?? '').toMatch(new RegExp(pattern as string));
    for (const s of ex.samples ?? []) {
      const a = out.samples.find((x) => x.sampleCode === s.code)!;
      expect(a).toBeTruthy();
      if ('lower' in s) close(a.concentration?.lower, s.lower, rel);
      if ('upper' in s) close(a.concentration?.upper, s.upper, rel);
      if ('upperUnbounded' in s) expect(a.concentration?.upperUnbounded).toBe(s.upperUnbounded);
      if ('included' in s) expect(a.included).toBe(s.included);
      if ('sampledMinutes' in s) close(a.sampledMinutes, s.sampledMinutes, rel);
      if ('volumeL' in s) close(a.volumeL, s.volumeL, rel);
    }
    if (ex.results) {
      expect(out.shifts.length).toBe(ex.results.length);
      ex.results.forEach((r: any, i: number) => {
        const a: any = out.shifts.find((x) => x.subjectRef === r.subject) ?? out.shifts[i];
        close(a.result?.lower, r.lower, rel); close(a.result?.upper, r.upper, rel);
        if (r.comparison) expect(a.comparison?.state ?? 'not_comparable').toBe(r.comparison);
        if (r.assumptionDependent !== undefined) expect(a.assumptionDependent).toBe(r.assumptionDependent);
      });
    }
    // Serialisation never turns an unbounded upper result into an ambiguous null.
    expect(serialiseOutput(out)).not.toMatch(/"upper":null/);
  });
});
