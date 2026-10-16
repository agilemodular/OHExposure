import type { FastifyInstance } from 'fastify';
import { can } from '../db.js';
import * as ctl from '../services/controls.js';
import * as att from '../services/attachments.js';
import { lookups } from '../services/lookups.js';
import { fmtDate, fmtDateTime, html, label } from '../ui/html.js';
import { csrfField, empty, options } from '../ui/layout.js';
import { action, page } from './kit.js';
import { attachmentsBlock } from './field.js';

const KINDS = ['elimination_substitution', 'process_change', 'enclosure', 'local_exhaust_ventilation', 'general_ventilation', 'suppression', 'work_practice', 'rpe', 'ppe', 'other'];
const STAGES = ['assigned', 'implemented', 'evidence_submitted', 'effectiveness_reviewed', 'verified_closed'];
const STAGE_TEXT: Record<string, string> = { assigned: 'Action assigned', implemented: 'Improvement implemented', evidence_submitted: 'Evidence submitted', effectiveness_reviewed: 'Effectiveness reviewed', verified_closed: 'Verified closure' };
const statusTone = (s: string) => (s === 'defective' ? 'b-bad' : s === 'in_service' ? 'b-neutral' : 'b-neutral');

export function controlRoutes(app: FastifyInstance) {
  page(app, '/controls', async (c) => {
    const [list, lk] = await Promise.all([ctl.listControls(c.actor), lookups(c.actor)]);
    return {
      title: 'Exposure controls', sub: 'Each control states its purpose and performance criteria. Installation alone is never treated as verification.',
      body: html`${list.length ? html`<div class="tablewrap"><table><thead><tr><th>Control</th><th>Type</th><th>Site / group</th><th>Status</th><th>Last inspection</th><th class="num">Open actions</th></tr></thead><tbody>
        ${list.map((x) => html`<tr><td><a href="/controls/${x.id}">${x.name}</a><br><span class="small muted">${x.owner_name ?? 'no owner'}</span></td><td>${label(x.kind)}</td><td>${x.site_name}${x.group_name ? html`<br><span class="small muted">${x.group_name}</span>` : ''}</td>
          <td><span class="badge ${statusTone(x.status)}">${label(x.status)}</span></td><td>${x.last_inspection ? html`${fmtDate(x.last_inspection)} — ${label(x.last_outcome)}` : html`<span class="muted">none</span>`}</td><td class="num">${x.open_actions}</td></tr>`)}</tbody></table></div>` : empty('No controls recorded.')}
        ${can(c.actor, 'controls.write') ? html`<details class="panel"><summary>Record a control</summary><form method="post" action="/controls" class="stack">${csrfField(c)}
          <div class="row"><label>Site<select name="site_id" required>${options(lk.sites, 'id', (s) => s.name)}</select></label><label>Name<input name="name" required></label>
          <label>Type<select name="kind">${KINDS.map((k) => html`<option value="${k}">${label(k)}</option>`)}</select></label></div>
          <label>Purpose<textarea name="purpose" required></textarea></label>
          <label>Performance criteria <span class="hint">Measurable for engineering controls, e.g. face velocity, capture distance, static pressure</span><textarea name="performance_criteria"></textarea></label>
          <div class="row"><label>Exposure group<select name="group_id">${options(lk.groups, 'id', (g) => g.name)}</select></label><label>Owner<select name="owner_user_id">${options(lk.users, 'id', (u) => u.name)}</select></label>
          <label>Status<select name="status"><option value="proposed">proposed</option><option value="in_service">in service</option></select></label></div>
          <div><button>Record control</button></div></form></details>` : ''}`,
    };
  });
  action(app, '/controls', async (c) => { const x = await ctl.createControl(c.actor, c.body); return { to: `/controls/${x.id}`, ok: 'Control recorded' }; });

  page(app, '/controls/:id', async (c) => {
    const [d, lk, files] = await Promise.all([ctl.controlDetail(c.actor, c.params.id), lookups(c.actor), att.listAttachments(c.actor, 'control', c.params.id)]);
    const x = d.control;
    return {
      title: x.name, crumbs: [['Controls', '/controls'], ['Control']], sub: `${label(x.kind)} · ${x.site_name}`,
      head: html`<span class="badge ${statusTone(x.status)}">${label(x.status)}</span>`,
      body: html`<div class="cols"><div>
        <dl class="kv"><dt>Purpose</dt><dd>${x.purpose}</dd><dt>Performance criteria</dt><dd>${x.performance_criteria ?? html`<span class="badge b-warn">not defined</span>`}</dd>
          <dt>Process</dt><dd>${x.process_name ?? '—'}</dd><dt>Exposure group</dt><dd>${x.group_id ? html`<a href="/groups/${x.group_id}">${x.group_name}</a>` : '—'}</dd><dt>Owner</dt><dd>${x.owner_name ?? '—'}</dd></dl>
        <h2>Inspections, maintenance and tests</h2>
        ${d.inspections.length ? html`<div class="tablewrap"><table><thead><tr><th>Date</th><th>Kind</th><th>Outcome</th><th>Measurements / notes</th><th>By</th></tr></thead><tbody>
          ${d.inspections.map((i) => html`<tr><td>${fmtDate(i.at)}</td><td>${label(i.kind)}</td><td>${i.outcome === 'satisfactory' ? 'satisfactory' : html`<span class="badge b-bad">${label(i.outcome)}</span>`}</td><td>${i.measurements ?? ''}${i.notes ? html`<br>${i.notes}` : ''}</td><td>${i.recorded_by_name ?? '—'}</td></tr>`)}</tbody></table></div>` : empty('No inspection or test evidence.')}
        ${can(c.actor, 'controls.inspect') ? html`<form method="post" action="/controls/${x.id}/inspections" class="stack panel">${csrfField(c)}<h3>Record inspection or test</h3>
          <div class="row"><label>Date<input type="date" name="at" required></label><label>Kind<select name="kind"><option value="routine_inspection">Routine inspection</option><option value="maintenance">Maintenance</option><option value="thorough_examination_test">Thorough examination and test</option><option value="performance_test">Performance test</option><option value="commissioning">Commissioning</option></select></label>
          <label>Outcome<select name="outcome"><option value="satisfactory">Satisfactory</option><option value="defect_found">Defect found</option><option value="failed">Failed</option></select></label></div>
          <label>Measurements<input name="measurements"></label><label>Notes <span class="hint">Required for defects and failures; a corrective action is raised automatically</span><textarea name="notes"></textarea></label><div><button>Record</button></div></form>` : ''}
      </div><div>
        <h2>Actions</h2>${d.actions.length ? html`<ul>${d.actions.map((a) => html`<li><a href="/actions/${a.id}">${a.title}</a> — ${label(a.status)}</li>`)}</ul>` : empty('No actions.')}
        ${can(c.actor, 'actions.assign') ? html`<details class="panel"><summary>Raise an action for this control</summary><form method="post" action="/actions" class="stack">${csrfField(c)}<input type="hidden" name="control_id" value="${x.id}"><input type="hidden" name="group_id" value="${x.group_id ?? ''}">
          <label>Action<input name="title" required></label><label>Owner<select name="owner_user_id">${options(lk.users, 'id', (u) => u.name, x.owner_user_id)}</select></label>
          <div class="row"><label>Priority<select name="priority"><option>normal</option><option>high</option><option>urgent</option><option>low</option></select></label><label>Due<input type="date" name="due_date"></label></div>
          <label>Verification requirement<textarea name="verification_requirement" required placeholder="e.g. commissioning test of face velocity at each hood and post-control personal sampling"></textarea></label>
          <label class="check"><input type="checkbox" name="requires_exposure_reassessment" value="on"> Requires an approved post-implementation exposure assessment</label><div><button>Raise action</button></div></form></details>` : ''}
        ${can(c.actor, 'controls.write') ? html`<form method="post" action="/controls/${x.id}/status" class="stack panel">${csrfField(c)}<h3>Change status</h3><select name="status">${['proposed', 'in_service', 'defective', 'withdrawn'].map((s) => html`<option value="${s}" ${s === x.status ? html`selected` : ''}>${label(s)}</option>`)}</select><input name="reason" placeholder="Reason" required><button class="secondary">Update</button></form>` : ''}
        ${attachmentsBlock(c, 'control', x.id, files, can(c.actor, 'controls.write') || can(c.actor, 'controls.inspect'))}
      </div></div>`,
    };
  });
  action(app, '/controls/:id/inspections', async (c) => { await ctl.recordInspection(c.actor, c.params.id, c.body); return { to: `/controls/${c.params.id}`, ok: 'Recorded' }; });
  action(app, '/controls/:id/status', async (c) => { await ctl.setControlStatus(c.actor, c.params.id, c.body); return { to: `/controls/${c.params.id}`, ok: 'Status updated; linked exposure group flagged for review' }; });

  page(app, '/actions', async (c) => {
    const mine = c.query.mine === '1';
    const list = await ctl.listActions(c.actor, mine);
    return {
      title: 'Corrective actions', sub: 'Closure requires submitted evidence and an independent effectiveness review.',
      head: html`<div class="actions-row"><a class="btn ${mine ? 'secondary' : ''}" href="/actions">All</a><a class="btn ${mine ? '' : 'secondary'}" href="/actions?mine=1">Assigned to me</a></div>`,
      body: list.length ? html`<div class="tablewrap"><table><thead><tr><th>Action</th><th>Linked to</th><th>Owner</th><th>Due</th><th>Stage</th></tr></thead><tbody>
        ${list.map((x) => html`<tr><td><a href="/actions/${x.id}">${x.title}</a>${x.priority === 'urgent' ? html` <span class="badge b-bad">urgent</span>` : ''}</td><td>${x.control_name ?? x.group_name ?? label(x.source_type)}</td><td>${x.owner_name ?? '—'}</td>
          <td>${x.overdue ? html`<span class="badge b-bad">Overdue ${fmtDate(x.due_date)}</span>` : fmtDate(x.due_date)}</td><td>${STAGE_TEXT[x.status] ?? label(x.status)}</td></tr>`)}</tbody></table></div>` : empty(mine ? 'Nothing assigned to you.' : 'No actions.'),
    };
  });

  page(app, '/actions/:id', async (c) => {
    const [d, files] = await Promise.all([ctl.actionDetail(c.actor, c.params.id), att.listAttachments(c.actor, 'action', c.params.id)]);
    const x = d.action;
    const isOwner = x.owner_user_id === c.actor.userId;
    const idx = STAGES.indexOf(x.status);
    const f = (path: string, inner: unknown, btn: string) => html`<form method="post" action="/actions/${x.id}/${path}" class="stack panel">${csrfField(c)}${inner}<div><button>${btn}</button></div></form>`;
    return {
      title: x.title, crumbs: [['Corrective actions', '/actions'], ['Action']],
      sub: html`${x.control_name ? html`Control: <a href="/controls/${x.control_id}">${x.control_name}</a> · ` : ''}${x.group_name ? `${x.group_name} · ` : ''}owner ${x.owner_name ?? 'unassigned'} · due ${fmtDate(x.due_date)}`,
      body: html`
      ${x.status === 'cancelled' ? html`<div class="steps"><span class="now">Cancelled</span></div>` : html`<div class="steps" aria-label="Action stage">${STAGES.map((s, i) => html`<span class="${i === idx ? 'now' : i < idx ? 'done' : ''}">${STAGE_TEXT[s]}</span>`)}</div>`}
      <div class="cols"><div>
        ${x.description ? html`<p>${x.description}</p>` : ''}
        <p><b>Verification requirement:</b> ${x.verification_requirement}${x.requires_exposure_reassessment ? html` <span class="tag">requires approved exposure reassessment</span>` : ''}</p>
        ${x.effectiveness_outcome ? html`<p><b>Last effectiveness outcome:</b> ${label(x.effectiveness_outcome)}${x.reviewed_by_name ? ` (${x.reviewed_by_name})` : ''}</p>` : ''}
        ${x.status === 'assigned' && (isOwner || can(c.actor, 'actions.assign')) ? f('implement', html`<h3>Record implementation</h3><label>What was done<textarea name="notes" required></textarea></label>`, 'Mark implemented') : ''}
        ${x.status === 'implemented' && (isOwner || can(c.actor, 'actions.assign')) ? f('evidence', html`<h3>Submit evidence</h3><p class="small">Upload files under Attachments, and/or link an inspection or test recorded after implementation.</p>
          ${d.inspections.length ? html`<label>Inspection or test<select name="inspection_id">${options(d.inspections, 'id', (i) => `${fmtDate(i.at)} ${label(i.kind)} — ${label(i.outcome)}`)}</select></label>` : ''}
          <label>Notes<textarea name="notes" required></textarea></label>`, 'Submit evidence') : ''}
        ${x.status === 'evidence_submitted' && can(c.actor, 'actions.review') ? f('review', html`<h3>Review effectiveness</h3><p class="small">You cannot review an action you implemented. For engineering controls, a satisfactory performance test or an approved post-control assessment is required to judge it effective.</p>
          <label>Outcome<select name="outcome"><option value="effective">Effective</option><option value="partially_effective">Partially effective — reopen</option><option value="not_effective">Not effective — reopen</option></select></label>
          <label>Approved post-implementation assessment<select name="verification_assessment_revision_id">${options(d.approvedRevisions, 'id', (r) => `${r.title} r${r.revision} (${fmtDate(r.approved_at)})`)}</select></label>
          <label>Review notes<textarea name="notes" required></textarea></label>`, 'Record review') : ''}
        ${x.status === 'effectiveness_reviewed' && can(c.actor, 'actions.review') ? f('close', html`<h3>Close as verified</h3><label>Closure notes<textarea name="notes" required></textarea></label>`, 'Close as verified') : ''}
        ${!['verified_closed', 'cancelled'].includes(x.status) && can(c.actor, 'actions.assign') ? html`<details class="panel"><summary>Cancel action</summary><form method="post" action="/actions/${x.id}/cancel" class="stack">${csrfField(c)}<label>Reason<input name="reason" required></label><button class="danger">Cancel action</button></form></details>` : ''}
        ${attachmentsBlock(c, 'action', x.id, files, (isOwner && can(c.actor, 'actions.implement')) || can(c.actor, 'actions.assign'))}
      </div><div>
        <h2>History</h2><ul class="timeline">${d.events.map((e) => html`<li><b>${STAGE_TEXT[e.to_status] ?? label(e.to_status)}</b> — ${fmtDateTime(e.at)} ${e.by_name ?? ''}${e.notes ? html`<br><span class="small">${e.notes}</span>` : ''}</li>`)}</ul>
      </div></div>`,
    };
  });
  action(app, '/actions/:id/implement', async (c) => { await ctl.markImplemented(c.actor, c.params.id, c.body); return { to: `/actions/${c.params.id}`, ok: 'Implementation recorded' }; });
  action(app, '/actions/:id/evidence', async (c) => { await ctl.submitEvidence(c.actor, c.params.id, c.body); return { to: `/actions/${c.params.id}`, ok: 'Evidence submitted for review' }; });
  action(app, '/actions/:id/review', async (c) => { await ctl.reviewEffectiveness(c.actor, c.params.id, c.body); return { to: `/actions/${c.params.id}`, ok: 'Effectiveness review recorded' }; });
  action(app, '/actions/:id/close', async (c) => { await ctl.closeVerified(c.actor, c.params.id, c.body); return { to: `/actions/${c.params.id}`, ok: 'Closed as verified' }; });
  action(app, '/actions/:id/cancel', async (c) => { await ctl.cancelAction(c.actor, c.params.id, c.body); return { to: `/actions/${c.params.id}`, ok: 'Action cancelled' }; });
}
