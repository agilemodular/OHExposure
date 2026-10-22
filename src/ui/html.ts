import { formatValue } from '../calc/engine.js';
// Minimal auto-escaping HTML templating.
export class Safe {
  constructor(public readonly value: string) {}
  toString() { return this.value; }
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const render = (v: unknown): string => {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
};
export function html(strings: TemplateStringsArray, ...vals: unknown[]): Safe {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const raw = (s: string) => new Safe(s);

// ── Formatting helpers
export const fmtDate = (d: unknown) => (d ? new Date(d as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '—');
export const fmtDateTime = (d: unknown, tz = 'Europe/London') =>
  d ? new Date(d as string).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }) : '—';
/** Display policy (engine 1.4.0, TR-04): 4 significant figures; a positive value is never shown as zero. Calculations use full precision. */
export const fmtNum = (n: unknown, _dp = 3) => {
  if (n === 'Infinity' || n === Infinity) return '∞';
  if (n === null || n === undefined || n === '') return '—';
  const x = Number(n);
  return Number.isFinite(x) ? formatValue(x) : '—';
};
export const label = (s: unknown) => String(s ?? '').replace(/_/g, ' ');
export function interval(i: any) {
  if (!i) return html`<span class="muted">insufficient evidence — not calculated</span>`;
  if (i.upperUnbounded || i.upper === 'Infinity' || i.upper === Infinity) return html`&gt; ${fmtNum(i.lower)} ${i.unit} <span class="tag tag-q">upper bound unknown</span>`;
  if (i.lower === i.upper) return html`${fmtNum(i.lower)} ${i.unit}`;
  if (i.lower === 0) return html`&lt; ${fmtNum(i.upper)} ${i.unit} <span class="tag tag-q">range 0–${fmtNum(i.upper)}</span>`;
  return html`${fmtNum(i.lower)}–${fmtNum(i.upper)} ${i.unit} <span class="tag tag-q">interval</span>`;
}

// ── Separate state badges (never a single traffic light)
const DQ: Record<string, string> = { complete: 'ok', qualified: 'warn', incomplete: 'bad', failed: 'bad' };
const BM: Record<string, string> = { below_benchmark: 'neutral', at_or_above_benchmark: 'bad', indeterminate: 'warn', not_comparable: 'neutral', no_verified_benchmark: 'warn' };
const PS: Record<string, string> = { draft: 'neutral', in_review: 'warn', approved: 'ok', superseded: 'neutral', withdrawn: 'neutral' };
export const dqBadge = (s: string | null) => s ? html`<span class="badge b-${DQ[s] ?? 'neutral'}" title="Data quality">Data: ${label(s)}</span>` : html`<span class="badge b-neutral">Data: not calculated</span>`;
export const bmBadge = (s: string | null) => s ? html`<span class="badge b-${BM[s] ?? 'neutral'}" title="Benchmark comparison (not a compliance conclusion)">Benchmark: ${label(s)}</span>` : html`<span class="badge b-neutral">Benchmark: —</span>`;
export const psBadge = (s: string | null) => html`<span class="badge b-${PS[s ?? ''] ?? 'neutral'}" title="Professional assessment">Review: ${label(s ?? 'none')}</span>`;
/** The three independent assessment states, shown side by side — never merged into one verdict. */
export function evidenceStrip(dq: string | null, bm: string | null, ps: string | null) {
  const seg = (title: string, v: string | null, tone: string) => html`<span class="ev-${tone}"><small>${title}</small><b>${v ? label(v) : 'not yet'}</b></span>`;
  return html`<span class="evidence" role="group" aria-label="Assessment states">${seg('Data quality', dq, dq ? DQ[dq] : 'neutral')}${seg('Benchmark comparison', bm, bm ? BM[bm] : 'neutral')}${seg('Professional review', ps, ps ? PS[ps] : 'neutral')}</span>`;
}
/** Distinguishes professionally verified reference data from organisation-entered and synthetic values. */
export const provenanceBadge = (b: { provenance?: string; reviewer_name?: string | null }) =>
  b.provenance === 'professional_reference' ? html`<span class="badge b-ok" title="Verified by ${b.reviewer_name ?? ''}">Professional reference</span>`
  : b.provenance === 'synthetic' ? html`<span class="synthetic">Synthetic</span>`
  : html`<span class="badge b-warn">Entered by organisation</span>`;
export const statusBadge = (s: string, tone = 'neutral') => html`<span class="badge b-${tone}">${label(s)}</span>`;
