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
export const fmtNum = (n: unknown, dp = 3) => {
  if (n === 'Infinity' || n === Infinity) return '∞';
  if (n === null || n === undefined || n === '') return '—';
  const x = Number(n);
  return Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(1) : String(Number(x.toPrecision(4)))) : '—';
};
export const label = (s: unknown) => String(s ?? '').replace(/_/g, ' ');
export function interval(i: any) {
  if (!i) return html`<span class="muted">not calculable</span>`;
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
export const statusBadge = (s: string, tone = 'neutral') => html`<span class="badge b-${tone}">${label(s)}</span>`;
