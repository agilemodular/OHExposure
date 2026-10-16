import type { FastifyInstance } from 'fastify';
import { calendar, dashboard, verificationQueue } from '../services/insights.js';
import { fmtDate, fmtDateTime, html, label, dqBadge, bmBadge } from '../ui/html.js';
import { empty } from '../ui/layout.js';
import { page } from './kit.js';

export function overviewRoutes(app: FastifyInstance) {
  page(app, '/', async (c) => {
    const d = await dashboard(c.actor);
    const k = d.counts;
    const line = (t: string, n: number, href: string, attn = true) => html`<dt>${t}</dt><dd class="${n === 0 ? 'zero' : attn ? 'attn' : ''}">${n ? html`<a href="${href}">${n}</a>` : '0'}</dd>`;
    return {
      title: 'Overview',
      sub: 'What needs attention across exposure evidence, assessments and controls.',
      body: html`
      <div class="ledger">
        <section><h2>Evidence quality</h2><dl>
          ${line('Failed QC checks without a disposition', k.unresolvedQc, '/verification')}
          ${line('In-service instruments without valid calibration', k.instrumentsCalibrationIssue, '/instruments')}
          ${line('Samples awaiting results', k.samplesAwaitingResults, '/samples?status=collected', false)}
          ${line('Open offline sync conflicts', k.syncConflicts, '/conflicts')}
        </dl></section>
        <section><h2>Assessments</h2><dl>
          ${line('Awaiting professional review', k.assessmentsInReview, '/verification')}
          ${line('Drafts in progress', k.assessmentsDraft, '/assessments', false)}
          ${line('Approved with results at or above benchmark', k.atOrAbove, '/assessments')}
          ${line('Exposure groups needing review', k.groupsNeedingReview, '/register')}
          ${line('Hazard reviews overdue', k.hazardsOverdue, '/register')}
        </dl></section>
        <section><h2>Controls and actions</h2><dl>
          ${line('Open corrective actions', k.actionsOpen, '/actions', false)}
          ${line('Overdue actions', k.actionsOverdue, '/actions')}
          ${line('Awaiting effectiveness verification', k.verificationQueue, '/verification')}
          ${line('Controls reported defective', k.controlsDefective, '/controls')}
          ${line('Controls without performance verification', k.controlsUnverified, '/controls')}
        </dl></section>
      </div>
      <div class="cols"><div>
        <h2>Missing evidence</h2>
        <p class="muted small">Rule-based checks; they do not use AI. Each item links to the record to complete.</p>
        ${d.gaps.length ? html`<ul class="issues">${d.gaps.map((g) => html`<li class="sev-${g.severity === 'high' ? 'incomplete' : 'qualify'}"><a href="${g.href}">${g.message}</a></li>`)}</ul>` : empty('No missing-evidence findings.')}
        <h2>Current assessment states</h2>
        ${d.assessmentStates.length ? html`<div class="tablewrap"><table><thead><tr><th>Data quality</th><th>Benchmark comparison</th><th>Review</th><th class="num">Assessments</th></tr></thead><tbody>
          ${d.assessmentStates.map((r) => html`<tr><td>${dqBadge(r.data_quality_state)}</td><td>${bmBadge(r.benchmark_state)}</td><td>${label(r.status)}</td><td class="num">${r.n}</td></tr>`)}</tbody></table></div>
          <p class="muted small">These states are recorded separately. A result below a benchmark is not, on its own, a conclusion that exposure is controlled.</p>` : empty('No assessments yet.')}
      </div><div>
        <h2>Overdue actions</h2>
        ${d.overdueActions.length ? html`<ul class="issues">${d.overdueActions.map((x) => html`<li class="sev-incomplete"><a href="/actions/${x.id}">${x.title}</a><br><span class="small muted">Due ${fmtDate(x.due_date)} · ${x.owner_name ?? 'unassigned'}</span></li>`)}</ul>` : empty('Nothing overdue.')}
        <h2>Groups flagged for review</h2>
        ${d.reviewGroups.length ? html`<ul class="issues">${d.reviewGroups.map((g) => html`<li class="sev-qualify"><a href="/groups/${g.id}">${g.name}</a><br><span class="small muted">${g.review_reason}</span></li>`)}</ul>` : empty('No group changes awaiting review.')}
      </div></div>`,
    };
  });

  page(app, '/calendar', async (c) => {
    const now = new Date();
    const m = /^\d{4}-\d{2}$/.test(c.query.m ?? '') ? c.query.m : now.toISOString().slice(0, 7);
    const [y, mo] = m.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const last = new Date(Date.UTC(y, mo, 0));
    const d = await calendar(c.actor, first.toISOString().slice(0, 10), last.toISOString().slice(0, 10));
    const pad = (first.getUTCDay() + 6) % 7;
    const days: any[] = [];
    for (let i = 0; i < pad; i++) days.push(null);
    for (let i = 1; i <= last.getUTCDate(); i++) days.push(new Date(Date.UTC(y, mo - 1, i)).toISOString().slice(0, 10));
    const iso = (v: any) => (v ? String(v).slice(0, 10) : null);
    const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
    const today = now.toISOString().slice(0, 10);
    return {
      title: 'Monitoring calendar',
      sub: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      head: html`<div class="actions-row"><a class="btn secondary" href="/calendar?m=${prev}">Previous month</a><a class="btn secondary" href="/calendar?m=${next}">Next month</a></div>`,
      body: html`<div class="cal" role="grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => html`<div class="hd">${x}</div>`)}
        ${days.map((day) => day ? html`<div class="${day === today ? 'today' : ''}"><span class="dn">${Number(day.slice(8))}</span>
          ${d.plans.filter((p) => iso(p.planned_start)! <= day && (iso(p.planned_end) ?? iso(p.planned_start))! >= day).map((p) => html`<a class="ev" href="/plans/${p.id}">${p.title} <span class="muted">(${label(p.status)})</span></a>`)}
          ${d.actionsDue.filter((x) => iso(x.due_date) === day).map((x) => html`<a class="ev act" href="/actions/${x.id}">Action due: ${x.title}</a>`)}
          ${d.calibrationsDue.filter((x) => iso(x.valid_until) === day).map((x) => html`<a class="ev cal-due" href="/instruments/${x.id}">Calibration expires: ${x.asset_tag}</a>`)}
          ${d.hazardReviews.filter((x) => iso(x.review_due) === day).map((x) => html`<span class="ev act">Hazard review: ${x.substance_name}</span>`)}
        </div>` : html`<div></div>`)}</div>`,
    };
  });

  page(app, '/verification', async (c) => {
    const q = await verificationQueue(c.actor);
    return {
      title: 'Verification queue',
      sub: 'Items that need an independent person to review before they count as evidence.',
      body: html`
      <h2>Assessments awaiting professional review</h2>
      ${q.assessments.length ? html`<div class="tablewrap"><table><thead><tr><th>Assessment</th><th>Submitted</th><th>Data quality</th><th>Benchmark</th></tr></thead><tbody>
        ${q.assessments.map((r) => html`<tr><td><a href="/assessments/${r.assessment_id}">${r.title}</a> r${r.revision}</td><td>${fmtDateTime(r.submitted_at)} by ${r.submitted_by_name}</td><td>${dqBadge(r.data_quality_state)}</td><td>${bmBadge(r.benchmark_state)}</td></tr>`)}</tbody></table></div>` : empty('No assessments awaiting review.')}
      <h2>Corrective actions awaiting effectiveness review or closure</h2>
      ${q.actions.length ? html`<div class="tablewrap"><table><thead><tr><th>Action</th><th>Stage</th><th>Verification required</th></tr></thead><tbody>
        ${q.actions.map((x) => html`<tr><td><a href="/actions/${x.id}">${x.title}</a><br><span class="small muted">${x.owner_name ?? ''}</span></td><td>${label(x.status)}</td><td>${x.verification_requirement}</td></tr>`)}</tbody></table></div>` : empty('No actions awaiting verification.')}
      <h2>Monitoring plans awaiting review</h2>
      ${q.plans.length ? html`<ul>${q.plans.map((p) => html`<li><a href="/plans/${p.id}">${p.title}</a> <span class="muted small">by ${p.author}</span></li>`)}</ul>` : empty('No draft plans with targets.')}
      <h2>Failed quality checks without a disposition</h2>
      ${q.qc.length ? html`<ul>${q.qc.map((x) => html`<li><a href="/samples/${x.sample_id}">${x.sample_code}</a>: ${x.check_type}</li>`)}</ul>` : empty('None.')}
      <h2>Organisation benchmarks awaiting verification</h2>
      ${q.benchmarks.length ? html`<ul>${q.benchmarks.map((b) => html`<li><a href="/reference#bv-${b.id}">${b.substance_name} ${b.benchmark_type}: ${b.value} ${b.unit}</a> <span class="muted small">${b.source_title}</span></li>`)}</ul>` : empty('None.')}
      ${q.conflicts.length ? html`<h2>Offline sync conflicts</h2><p><a href="/conflicts">${q.conflicts.length} open conflict(s)</a></p>` : ''}`,
    };
  });
}
