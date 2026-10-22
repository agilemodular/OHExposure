// Factual summaries generated from the structured evidence, and checks that flag possible contradictions between the
// professional interpretation (free text, always editable) and the recorded results. The checks are heuristic and
// advisory: they can miss or misread phrasing, never change the text and never block approval.
import { formatValue } from '../calc/engine.js';

export interface EvidenceFacts {
  personalSamples: number;
  workers: string[];
  workerDays: number;
  dates: string[];
  formalResults: number;
  calculatedResults: number;
  /** Highest upper bound of a formal result relative to the benchmark (e.g. 0.68 = 68 %); null if none. */
  highestRatio: number | null;
  highestResult: { subject: string; date: string; upper: number; unit: string; unbounded?: boolean } | null;
  calculationAvailability: string | null;
  evidenceAdequacy: string | null;
  unresolved: { sampleCode: string; why: string }[];
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function evidenceFacts(out: any): EvidenceFacts {
  const personal = (out?.samples ?? []).filter((s: any) => s.sampleType === 'personal');
  const workers = [...new Set<string>(personal.map((s: any) => s.subjectRef).filter(Boolean))].sort();
  const workerDays = new Set(personal.map((s: any) => `${s.subjectRef}|${s.shiftDate}`)).size;
  const dates = [...new Set<string>(personal.map((s: any) => s.shiftDate).filter(Boolean))].sort();
  const shifts = out?.shifts ?? [];
  const formal = shifts.filter((s: any) => s.comparison && s.result && !s.indicative);
  let highestRatio: number | null = null, highestResult: EvidenceFacts['highestResult'] = null;
  for (const s of formal) {
    // N2 (R4): an over-range result has an unknown upper bound; it is the highest result and its ratio is unbounded.
    const raw = s.comparison?.ratio?.upper;
    const r = raw === 'Infinity' || raw === Infinity ? Infinity : raw;
    if ((finite(r) || r === Infinity) && (highestRatio === null || r > highestRatio)) {
      highestRatio = r;
      highestResult = { subject: s.subjectRef, date: s.shiftDate, upper: r === Infinity ? Number(s.result.lower) : Number(s.result.upper), unit: s.result.unit, unbounded: r === Infinity };
    }
  }
  return {
    personalSamples: personal.length, workers, workerDays, dates, formalResults: formal.length,
    calculatedResults: shifts.filter((s: any) => s.result).length, highestRatio, highestResult,
    calculationAvailability: out?.calculationAvailability ?? null, evidenceAdequacy: out?.evidenceAdequacy ?? null,
    unresolved: (out?.unresolvedEvidence ?? []).map((u: any) => ({ sampleCode: u.sampleCode, why: u.why })),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One-paragraph factual summary of what was sampled and found; generated, not written by a person. */
export function factualSummary(f: EvidenceFacts, calcCode: string): string {
  const parts = [`${plural(f.personalSamples, 'personal sample')} from ${plural(f.workers.length, 'worker')} (${f.workers.join(', ') || 'none'}) on ${plural(f.dates.length, 'date')} (${f.dates.join(', ') || '—'}), giving ${plural(f.workerDays, 'worker-day')}.`];
  parts.push(`${plural(f.calculatedResults, calcCode === 'stel_15' ? '15-minute result' : 'worker-shift result')} could be calculated, of which ${f.formalResults} ${f.formalResults === 1 ? 'is' : 'are'} formal (compared with the benchmark).`);
  if (f.highestRatio !== null && f.highestResult) parts.push(f.highestResult.unbounded
    ? `The highest formal result is over range: more than ${formatValue(f.highestResult.upper)} ${f.highestResult.unit} (${f.highestResult.subject}, ${f.highestResult.date}), upper bound unknown.`
    : `The highest formal result is ${formatValue(f.highestResult.upper)} ${f.highestResult.unit} (${f.highestResult.subject}, ${f.highestResult.date}), ${formatValue(f.highestRatio * 100, 2)}% of the benchmark.`);
  if (f.unresolved.length) parts.push(`${plural(f.unresolved.length, 'sample')} cannot be used as formal evidence and ${f.unresolved.length === 1 ? 'is' : 'are'} unresolved or not replaced: ${f.unresolved.map((u) => u.sampleCode).join(', ')}.`);
  return parts.join(' ');
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, single: 1, both: 2 };
const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w.toLowerCase()]);

/** Statements in the interpretation that contradict the recorded evidence (counts, dates, fraction of benchmark). */
export function narrativeChecks(text: string | null | undefined, f: EvidenceFacts, source = 'The interpretation'): string[] {
  if (!text) return [];
  const out: string[] = [];
  const t = text.replace(/\s+/g, ' ');
  // Worker counts are checked only where the text states how many were sampled ("all three grinders", "two workers were
  // sampled", "samples from four operators"), not where it mentions an individual ("one grinder (NF-W01)").
  const seenCounts = new Set<number>();
  const W = '(?:workers?|grinders?|operators?|operatives?|employees?|people|persons?|welders?)';
  for (const re of [new RegExp(`\\ball\\s+(\\w+)\\s+(?:of\\s+the\\s+)?${W}\\b`, 'gi'), new RegExp(`\\b(\\w+)\\s+${W}\\s+(?:were|was)\\s+(?:sampled|monitored)\\b`, 'gi'), new RegExp(`\\b(?:sampled|samples\\s+from|monitoring\\s+of|sampling\\s+of)\\s+(?:all\\s+|the\\s+)?(\\w+)\\s+${W}\\b`, 'gi'), new RegExp(`\\bthe\\s+(\\w+)\\s+${W}\\s+(?:were|was|all)\\b`, 'gi')]) {
    for (const m of t.matchAll(re)) {
      const n = num(m[1]);
      if (n !== undefined && n !== f.workers.length && !seenCounts.has(n)) { seenCounts.add(n); out.push(`${source} mentions "${m[0]}"; the evidence includes ${plural(f.workers.length, 'sampled worker')}.`); }
    }
  }
  for (const m of t.matchAll(/\b(?:on|over|across|during|covering|covers|for)\s+(?:the\s+)?(\w+)\s+(?:(?:representative|production|working|sampling|separate|consecutive|full|normal)\s+){0,2}(?:days|dates)\b/gi)) {
    const n = num(m[1]);
    if (n !== undefined && n !== f.dates.length) out.push(`${source} mentions "${m[0]}"; the evidence covers ${plural(f.dates.length, 'sampling date')}.`);
  }
  if (/\b(?:all|each|every)\s+(?:of\s+the\s+)?(?:\w+\s+)?(?:workers?|grinders?|operators?)\b[^.]*\b(?:on|over|across)\s+(?:both|each|all|\w+)\s+(?:\w+\s+){0,2}days?\b/i.test(t) && f.workerDays < f.workers.length * f.dates.length)
    out.push(`${source} implies every worker was sampled on every date (${f.workers.length} × ${f.dates.length} = ${f.workers.length * f.dates.length} worker-days); the evidence has ${plural(f.workerDays, 'worker-day')}.`);
  if (f.highestRatio !== null) {
    const claims: { text: string; value: number }[] = [];
    for (const m of t.matchAll(/\b(?:roughly|about|approximately|around|nearly|almost|up to)?\s*(half|a third|one third|a quarter|two thirds|three quarters)\b(?:\s+(?:of\s+)?the\s+(?:\w+\s+)?(?:benchmark|limit))?/gi)) {
      const v = { 'half': 0.5, 'a third': 1 / 3, 'one third': 1 / 3, 'a quarter': 0.25, 'two thirds': 2 / 3, 'three quarters': 0.75 }[m[1].toLowerCase() as 'half'];
      claims.push({ text: m[0].trim(), value: v });
    }
    // Percentages and multiples count only in a sentence about the benchmark or limit, not after "within"; the largest
    // figure in that sentence is taken as the claimed highest result (heuristic, advisory only).
    for (const sentence of t.split(/(?<=[.;])\s+/)) {
      if (!/\b(benchmark|limit|WEL|OEL|exposure limit)\b/i.test(sentence)) continue;
      const pcts = [...sentence.matchAll(/(?<!within\s)\b(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent)/gi)].map((m) => ({ text: m[0], value: Number(m[1]) / 100 }));
      const times = [...sentence.matchAll(/\b(\d*\.?\d+)\s*(?:times|×)\s+(?:the\s+)?(?:\w+\s+)?(?:benchmark|limit|WEL|OEL)/gi)].map((m) => ({ text: m[0], value: Number(m[1]) }));
      const all = [...pcts, ...times];
      if (all.length) claims.push(all.reduce((x, y) => (y.value > x.value ? y : x)));
    }
    const actual = f.highestRatio;
    for (const c of claims) if (actual === Infinity || Math.abs(c.value - actual) > 0.1) out.push(`${source} says "${c.text}"; the highest formal result is ${actual === Infinity ? 'over range (upper bound unknown)' : `${formatValue(actual * 100, 2)}% of the benchmark`}.`);
  }
  return [...new Set(out)];
}
