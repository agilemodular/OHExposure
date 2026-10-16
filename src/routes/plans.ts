import type { FastifyInstance } from 'fastify';
import { can } from '../db.js';
import * as plans from '../services/plans.js';
import { lookups, substanceLabel } from '../services/lookups.js';
import { fmtDate, fmtDateTime, html, label } from '../ui/html.js';
import { csrfField, empty, options, type PageCtx } from '../ui/layout.js';
import { action, page } from './kit.js';

const ORDER = ['draft', 'reviewed', 'scheduled', 'in_progress', 'completed'];
const steps = (s: string) => s === 'cancelled' ? html`<div class="steps"><span class="now">Cancelled</span></div>`
  : html`<div class="steps">${ORDER.map((x, i) => html`<span class="${x === s ? 'now' : ORDER.indexOf(s) > i ? 'done' : ''}">${label(x)}</span>`)}</div>`;

function planForm(c: PageCtx, lk: any, p: any = {}, instr: string[] = []) {
  return html`${csrfField(c)}${p.id ? html`<input type="hidden" name="version" value="${p.version}">` : ''}
    <div class="row"><label>Site<select name="site_id" required ${p.id ? html`disabled` : ''}>${options(lk.sites, 'id', (s: any) => `${s.name} (${s.client_name})`, p.site_id)}</select></label>
    <label>Title<input name="title" required value="${p.title ?? ''}"></label></div>
    ${p.id ? html`<input type="hidden" name="site_id" value="${p.site_id}">` : ''}
    <label>Purpose<textarea name="purpose" required>${p.purpose ?? ''}</textarea></label>
    <label>Assessment question <span class="hint">The question this monitoring must answer</span><textarea name="assessment_question" required>${p.assessment_question ?? ''}</textarea></label>
    <div class="row"><label>Sampling approach<select name="approach">${['personal', 'static', 'mixed', 'other'].map((a) => html`<option ${a === p.approach ? html`selected` : ''}>${a}</option>`)}</select></label>
    <label>Intended sample duration (min)<input type="number" name="intended_duration_min" min="1" value="${p.intended_duration_min ?? ''}"></label></div>
    <label>Strategy rationale <span class="hint">Why this number, duration and timing of samples is appropriate. There is no universal sample count.</span><textarea name="strategy_rationale" required>${p.strategy_rationale ?? ''}</textarea></label>
    <label>Coverage<textarea name="coverage_notes">${p.coverage_notes ?? ''}</textarea></label>
    <div class="row"><label>Operating conditions to capture<textarea name="operating_conditions">${p.operating_conditions ?? ''}</textarea></label>
    <label>Planned quality checks<textarea name="quality_checks">${p.quality_checks ?? ''}</textarea></label>
    <label>Laboratory requirements<textarea name="lab_requirements">${p.lab_requirements ?? ''}</textarea></label></div>
    <div class="row"><label>Practitioner<select name="practitioner_id">${options(lk.users.filter((u: any) => u.role === 'practitioner'), 'id', (u: any) => u.name, p.practitioner_id ?? c.actor.userId)}</select></label>
    <label>Reviewer<select name="reviewer_id">${options(lk.users.filter((u: any) => u.role === 'technical_reviewer'), 'id', (u: any) => u.name, p.reviewer_id)}</select></label>
    <label>Planned start<input type="date" name="planned_start" value="${p.planned_start ?? ''}"></label><label>Planned end<input type="date" name="planned_end" value="${p.planned_end ?? ''}"></label></div>
    <label>Instruments<select name="instrument_ids" multiple size="4">${lk.instruments.map((i: any) => html`<option value="${i.id}" ${instr.includes(i.id) ? html`selected` : ''}>${i.asset_tag} (${label(i.instrument_type)}${i.screening_only ? ', screening only' : ''})</option>`)}</select></label>`;
}

export function planRoutes(app: FastifyInstance) {
  page(app, '/plans', async (c) => {
    const list = await plans.listPlans(c.actor);
    return {
      title: 'Monitoring plans', sub: 'What will be sampled, why, and how — reviewed before fieldwork begins.',
      head: can(c.actor, 'plans.write') ? html`<a class="btn" href="/plans/new">New plan</a>` : '',
      body: list.length ? html`<div class="tablewrap"><table><thead><tr><th>Plan</th><th>Site</th><th>Status</th><th>Planned</th><th class="num">Samples</th></tr></thead><tbody>
        ${list.map((p) => html`<tr><td><a href="/plans/${p.id}">${p.title}</a><br><span class="small muted">${p.practitioner_name ?? ''}</span></td><td>${p.site_name}</td><td>${label(p.status)}</td><td>${fmtDate(p.planned_start)}${p.planned_end ? html` – ${fmtDate(p.planned_end)}` : ''}</td><td class="num">${p.sample_count}</td></tr>`)}</tbody></table></div>`
        : empty('No monitoring plans yet.', can(c.actor, 'plans.write') ? html`<a href="/plans/new">Create the first plan</a>.` : undefined),
    };
  });

  page(app, '/plans/new', async (c) => {
    const lk = await lookups(c.actor);
    return { title: 'New monitoring plan', crumbs: [['Monitoring plans', '/plans'], ['New']], body: html`<form method="post" action="/plans" class="stack">${planForm(c, lk)}<div><button>Save draft plan</button></div></form>` };
  });
  action(app, '/plans', async (c) => { const p = await plans.createPlan(c.actor, c.body); return { to: `/plans/${p.id}`, ok: 'Draft plan saved. Add target substances, then send for review.' }; });

  page(app, '/plans/:id', async (c) => {
    const [d, lk] = await Promise.all([plans.planDetail(c.actor, c.params.id), lookups(c.actor)]);
    const p = d.plan;
    const editable = can(c.actor, 'plans.write') && ['draft', 'reviewed', 'scheduled'].includes(p.status);
    const t = (to: string, text: string, cls = '', reason = false) => html`<form method="post" action="/plans/${p.id}/transition" class="inline-form">${csrfField(c)}<input type="hidden" name="to" value="${to}">${reason ? html`<input name="reason" placeholder="Reason" required>` : ''}<button class="${cls}">${text}</button></form>`;
    return {
      title: p.title, crumbs: [['Monitoring plans', '/plans'], ['Plan']], sub: `${p.site_name} · ${label(p.approach)} sampling`,
      head: html`<div class="actions-row">
        ${p.status === 'draft' && can(c.actor, 'plans.review') ? t('reviewed', 'Mark reviewed') : ''}
        ${p.status === 'reviewed' && can(c.actor, 'plans.write') ? t('scheduled', 'Schedule') : ''}
        ${p.status === 'scheduled' && (can(c.actor, 'plans.write') || can(c.actor, 'field.capture')) ? t('in_progress', 'Start fieldwork') : ''}
        ${p.status === 'in_progress' && can(c.actor, 'plans.write') ? t('completed', 'Mark completed') : ''}
        ${p.status === 'in_progress' && can(c.actor, 'field.capture') ? html`<a class="btn secondary" href="/field?plan=${p.id}">Capture samples</a>` : ''}</div>`,
      body: html`${steps(p.status)}
      ${p.reviewed_at ? html`<p class="small muted">Reviewed by ${p.reviewed_by_name} on ${fmtDateTime(p.reviewed_at)}.</p>` : ''}
      ${p.cancelled_reason ? html`<div class="flash warn">Cancelled: ${p.cancelled_reason}</div>` : ''}
      <div class="cols"><div>
        <dl class="kv"><dt>Purpose</dt><dd>${p.purpose}</dd><dt>Assessment question</dt><dd>${p.assessment_question}</dd><dt>Strategy</dt><dd>${p.strategy_rationale}</dd>
        <dt>Intended duration</dt><dd>${p.intended_duration_min ? `${p.intended_duration_min} min` : '—'}</dd><dt>Coverage</dt><dd>${p.coverage_notes ?? '—'}</dd>
        <dt>Operating conditions</dt><dd>${p.operating_conditions ?? '—'}</dd><dt>Quality checks</dt><dd>${p.quality_checks ?? '—'}</dd><dt>Laboratory</dt><dd>${p.lab_requirements ?? '—'}</dd>
        <dt>Practitioner</dt><dd>${p.practitioner_name ?? '—'}</dd><dt>Reviewer</dt><dd>${p.reviewer_name ?? '—'}</dd><dt>Planned</dt><dd>${fmtDate(p.planned_start)} – ${fmtDate(p.planned_end)}</dd></dl>
        <h2>Targets</h2>
        ${d.targets.length ? html`<div class="tablewrap"><table><thead><tr><th>Substance</th><th>Group</th><th>Method</th><th class="num">Planned samples</th></tr></thead><tbody>
          ${d.targets.map((x) => html`<tr><td>${x.substance_name}</td><td>${x.group_name ?? '—'}</td><td>${x.method_code ? `${x.method_code} v${x.method_version}` : '—'}</td><td class="num">${x.planned_samples ?? '—'}</td></tr>`)}</tbody></table></div>` : empty('No targets yet; a plan needs at least one before review.')}
        ${p.status === 'draft' && can(c.actor, 'plans.write') ? html`<form method="post" action="/plans/${p.id}/targets" class="stack panel">${csrfField(c)}<h3>Add a target</h3>
          <div class="row"><label>Substance<select name="substance_id" required>${options(lk.substances, 'id', substanceLabel)}</select></label>
          <label>Exposure group<select name="group_id">${options(lk.groups, 'id', (g: any) => `${g.name} (${g.site_name})`)}</select></label></div>
          <div class="row"><label>Method version<select name="method_version_id">${options(lk.methods, 'id', (m: any) => `${m.code} v${m.version}${m.suitable_for_formal_assessment ? '' : ' (indicative)'}`)}</select></label>
          <label>Planned samples<input type="number" name="planned_samples" min="1"></label></div><label>Notes<input name="notes"></label><div><button>Add target</button></div></form>` : ''}
        <h2>Samples</h2>
        ${d.samples.length ? html`<div class="tablewrap"><table><thead><tr><th>Sample</th><th>Type</th><th>Worker / location</th><th>Start</th><th>Status</th></tr></thead><tbody>
          ${d.samples.map((s) => html`<tr><td><a href="/samples/${s.id}">${s.sample_code}</a></td><td>${label(s.sample_type)}</td><td>${s.worker_ref ?? s.location_desc ?? '—'}</td><td>${fmtDateTime(s.start_at, s.timezone)}</td><td>${label(s.status)}</td></tr>`)}</tbody></table></div>` : empty('No samples captured against this plan.')}
      </div><div>
        <h2>Instruments</h2>${d.instruments.length ? html`<ul>${d.instruments.map((i) => html`<li><a href="/instruments/${i.id}">${i.asset_tag}</a>${i.screening_only ? html` <span class="tag tag-q">screening only</span>` : ''}</li>`)}</ul>` : empty('None listed.')}
        ${editable ? html`<details class="panel"><summary>Edit plan</summary>${p.status !== 'draft' ? html`<p class="flash warn small">Saving changes returns this plan to draft and it must be reviewed again.</p>` : ''}
          <form method="post" action="/plans/${p.id}/edit" class="stack">${planForm(c, lk, p, d.instruments.map((i) => i.id))}<div><button>Save changes</button></div></form></details>` : ''}
        ${!['completed', 'cancelled'].includes(p.status) && (can(c.actor, 'plans.write') || can(c.actor, 'plans.review')) ? html`<details class="panel"><summary>Cancel plan</summary>${t('cancelled', 'Cancel plan', 'danger', true)}</details>` : ''}
      </div></div>`,
    };
  });
  action(app, '/plans/:id/edit', async (c) => { await plans.updatePlan(c.actor, c.params.id, c.body); return { to: `/plans/${c.params.id}`, ok: 'Plan updated' }; });
  action(app, '/plans/:id/targets', async (c) => { await plans.addTarget(c.actor, c.params.id, c.body); return { to: `/plans/${c.params.id}`, ok: 'Target added' }; });
  action(app, '/plans/:id/transition', async (c) => { const p = await plans.transitionPlan(c.actor, c.params.id, c.body); return { to: `/plans/${c.params.id}`, ok: `Plan ${label(p.status)}` }; });
}
