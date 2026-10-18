import { config } from '../config.js';
import { can, type Actor } from '../db.js';
import type { Permission } from '../authz.js';
import { html, label, type Safe } from './html.js';
import { WORKFLOW_LABEL } from '../services/assurance.js';

export type PageCtx = { actor: Actor; csrf: string; tenant: any; path: string; flash?: { kind: 'ok' | 'err' | 'warn'; msg: string } | null; counts?: Record<string, number> };

const NAV: { grp?: string; href?: string; text?: string; perm?: Permission; match?: string; count?: string }[] = [
  { href: '/', text: 'Overview' },
  { grp: 'Exposure' },
  { href: '/register', text: 'Exposure register', match: '/register|/sites|/groups|/workers' },
  { href: '/plans', text: 'Monitoring plans', match: '/plans' },
  { href: '/calendar', text: 'Monitoring calendar' },
  { grp: 'Fieldwork & laboratory' },
  { href: '/field', text: 'Field sampling', perm: 'field.capture' },
  { href: '/samples', text: 'Samples', match: '/samples' },
  { href: '/instruments', text: 'Instruments', match: '/instruments' },
  { href: '/lab', text: 'Laboratory results', match: '/lab' },
  { grp: 'Assessment' },
  { href: '/assessments', text: 'Assessments', match: '/assessments' },
  { href: '/controls', text: 'Controls', match: '/controls' },
  { href: '/actions', text: 'Corrective actions', match: '/actions' },
  { href: '/verification', text: 'Verification queue', count: 'verification' },
  { href: '/reports', text: 'Reports', match: '/reports' },
  { grp: 'Administration' },
  { href: '/reference', text: 'Benchmarks & methods', match: '/reference' },
  { href: '/admin', text: 'Organisation', perm: 'users.manage', match: '/admin' },
  { href: '/conflicts', text: 'Sync conflicts', perm: 'conflicts.resolve', count: 'conflicts' },
  { href: '/audit', text: 'Audit history', perm: 'audit.read' },
];

export function layout(p: PageCtx, o: { title: string; crumbs?: [string, string?][]; sub?: unknown; head?: unknown; body: unknown }): string {
  const b = config.branding;
  const nav = NAV.filter((n) => !n.perm || can(p.actor, n.perm)).map((n) => {
    if (n.grp) return html`<div class="grp">${n.grp}</div>`;
    const active = n.href === '/' ? p.path === '/' : new RegExp(`^(${n.match ?? n.href})`).test(p.path);
    const c = n.count ? p.counts?.[n.count] : 0;
    return html`<a href="${n.href}" ${active ? html`aria-current="page"` : ''}>${n.text}${c ? html`<span class="count">${c}</span>` : ''}</a>`;
  });
  return html`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title} — ${b.productName}</title><link rel="stylesheet" href="/static/app.css"><link rel="manifest" href="/static/manifest.json"></head>
<body><div class="shell"><aside class="rail"><a class="mark" href="/">${b.productName}</a><div class="endorse">${b.endorsement}</div><nav aria-label="Main">${nav}</nav></aside>
<main id="main">
<div class="topbar"><span>${p.tenant.name}${p.actor.clientId ? html` · client access` : ''}</span>
<span>${p.actor.name} (${label(p.actor.role)}) · <a href="/account">Account</a> · <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${p.csrf}"><button class="secondary tiny">Sign out</button></form></span></div>
${p.tenant.is_demo ? html`<div class="demo-band" role="note">Demonstration organisation — all records here are synthetic and must not be used for real decisions.</div>` : ''}
${p.tenant.assurance_level === 'evaluation' ? html`<div class="flash warn" role="note">Evaluation use. This organisation is not operating under an authorised pilot: calculations may use methods and benchmarks that are not professionally reviewed, and outputs are not for reliance.</div>` : ''}
${p.tenant.suspended_workflows?.length ? html`<div class="flash err" role="alert"><b>Suspended:</b> ${p.tenant.suspended_workflows.map((w: string) => WORKFLOW_LABEL[w as keyof typeof WORKFLOW_LABEL] ?? w).join(', ')}.${p.tenant.suspension_reason ? html` Reason: ${p.tenant.suspension_reason}.` : ''} Existing records are preserved and readable.</div>` : ''}
${p.flash ? html`<div class="flash ${p.flash.kind}" role="${p.flash.kind === 'err' ? 'alert' : 'status'}">${p.flash.msg}</div>` : ''}
<div class="pagehead"><div>${o.crumbs ? html`<div class="crumbs">${o.crumbs.map(([t, h], i) => html`${i ? ' / ' : ''}${h ? html`<a href="${h}">${t}</a>` : t}`)}</div>` : ''}<h1>${o.title}</h1>${o.sub ? html`<p class="sub">${o.sub}</p>` : ''}</div>${o.head ?? ''}</div>
${o.body}
</main></div></body></html>`.value;
}

export const csrfField = (p: PageCtx) => html`<input type="hidden" name="_csrf" value="${p.csrf}">`;
export function options(rows: any[], valueKey: string, labelFn: (r: any) => string, selected?: string | null, blank = '— select —') {
  return html`${blank ? html`<option value="">${blank}</option>` : ''}${rows.map((r) => html`<option value="${r[valueKey]}" ${r[valueKey] === selected ? html`selected` : ''}>${labelFn(r)}</option>`)}`;
}
export const empty = (msg: string, action?: Safe) => html`<div class="empty">${msg} ${action ?? ''}</div>`;
