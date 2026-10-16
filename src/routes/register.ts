import type { FastifyInstance } from 'fastify';
import { can, many, withActor } from '../db.js';
import * as reg from '../services/register.js';
import { lookups, substanceLabel, workerLabel } from '../services/lookups.js';
import { fmtDate, fmtDateTime, html, label, evidenceStrip } from '../ui/html.js';
import { csrfField, empty, options } from '../ui/layout.js';
import { action, back, page } from './kit.js';

const BASIS = [['recorded_fact', 'Recorded fact'], ['user_estimate', 'Estimate'], ['professionally_reviewed', 'Professionally reviewed']];
const basisTag = (b: string) => html`<span class="tag ${b === 'user_estimate' ? 'tag-q' : ''}">${BASIS.find((x) => x[0] === b)?.[1] ?? b}</span>`;

export function registerRoutes(app: FastifyInstance) {
  page(app, '/register', async (c) => {
    const [d, lk] = await Promise.all([reg.registerOverview(c.actor), lookups(c.actor)]);
    const canSite = can(c.actor, 'sites.write');
    return {
      title: 'Exposure register',
      sub: 'Sites, processes, airborne hazards and the similar exposure groups they affect.',
      head: html`<div class="actions-row"><a class="btn secondary" href="/workers">Worker references</a></div>`,
      body: html`
      <h2>Similar exposure groups</h2>
      ${d.groups.length ? html`<div class="tablewrap"><table><thead><tr><th>Group</th><th>Site</th><th>Substances</th><th class="num">Current members</th><th>Review</th></tr></thead><tbody>
        ${d.groups.map((g) => html`<tr><td><a href="/groups/${g.id}">${g.name}</a></td><td>${g.site_name}</td><td>${g.substances ?? '—'}</td><td class="num">${g.members}</td>
          <td>${g.review_required ? html`<span class="badge b-warn" title="${g.review_reason}">Review needed</span>` : html`<span class="muted small">Last reviewed ${fmtDate(g.last_reviewed_at)}</span>`}</td></tr>`)}</tbody></table></div>`
        : empty('No exposure groups yet. Open a site to add processes, tasks and groups.')}
      <h2>Airborne hazards</h2>
      ${d.hazards.length ? html`<div class="tablewrap"><table><thead><tr><th>Substance</th><th>Form</th><th>Site / area / process / task</th><th>Exposure</th><th>Existing controls</th><th>Review due</th></tr></thead><tbody>
        ${d.hazards.map((h) => html`<tr><td>${h.substance_name}${h.cas_number ? html`<br><span class="small muted">CAS ${h.cas_number}</span>` : ''}</td><td>${h.physical_form}<br><span class="small muted">${h.exposure_routes.join(', ')}</span></td>
          <td>${h.site_name} / ${h.work_area_name} / ${h.process_name} / ${h.task_name}</td><td>${h.exposure_frequency ?? '—'}${h.exposure_duration_min ? html`, ${h.exposure_duration_min} min/shift` : ''} ${basisTag(h.exposure_basis)}</td>
          <td>${h.existing_controls ?? '—'}</td><td>${h.review_due && new Date(h.review_due) < new Date() ? html`<span class="badge b-bad">Overdue ${fmtDate(h.review_due)}</span>` : fmtDate(h.review_due)}</td></tr>`)}</tbody></table></div>` : empty('No hazards recorded.')}
      <h2>Sites</h2>
      ${d.sites.length ? html`<ul>${d.sites.map((s) => html`<li><a href="/sites/${s.id}">${s.name}</a> <span class="muted small">${s.client_name}${s.reference ? ` · ${s.reference}` : ''}</span></li>`)}</ul>` : empty('No sites yet.')}
      ${canSite ? html`<details class="panel"><summary>Add a site</summary><form method="post" action="/sites" class="stack">${csrfField(c)}
        ${lk.clients.length > 1 && !c.actor.clientId ? html`<label>Client<select name="client_id" required>${options(lk.clients, 'id', (x) => x.name)}</select></label>` : ''}
        <div class="row"><label>Site name<input name="name" required></label><label>Reference<input name="reference"></label></div>
        <label>Address<textarea name="address"></textarea></label><div><button>Add site</button></div></form></details>` : ''}`,
    };
  });
  action(app, '/sites', async (c) => { const s = await reg.createSite(c.actor, c.body); return { to: `/sites/${s.id}`, ok: 'Site added' }; });

  page(app, '/sites/:id', async (c) => {
    const [t, lk] = await Promise.all([reg.siteTree(c.actor, c.params.id), lookups(c.actor)]);
    const w = can(c.actor, 'register.write');
    const sid = t.site.id;
    return {
      title: t.site.name, crumbs: [['Exposure register', '/register'], ['Site']],
      sub: `${t.site.client_name}${t.site.reference ? ` · ${t.site.reference}` : ''}`,
      body: html`
      ${t.areas.length ? t.areas.map((a) => html`<section class="panel"><h2>${a.name}</h2>${a.description ? html`<p class="muted">${a.description}</p>` : ''}
        ${t.processes.filter((p) => p.work_area_id === a.id).map((p) => html`<h3>${p.name}</h3>${p.description ? html`<p class="small muted">${p.description}</p>` : ''}
          ${t.tasks.filter((x) => x.process_id === p.id).length ? html`<div class="tablewrap"><table><thead><tr><th>Task</th><th>Duration per shift</th><th>Hazards</th></tr></thead><tbody>
            ${t.tasks.filter((x) => x.process_id === p.id).map((x) => html`<tr><td>${x.name}${x.frequency ? html`<br><span class="small muted">${x.frequency}</span>` : ''}</td>
              <td>${x.duration_min_per_shift ?? '—'} min ${basisTag(x.duration_basis)}</td>
              <td>${t.hazards.filter((h) => h.task_id === x.id).map((h) => html`${h.substance_name} (${h.physical_form})<br>`)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted small">No tasks yet.</p>`}
          ${w ? html`<details><summary class="small">Add a task to ${p.name}</summary><form method="post" action="/tasks" class="stack panel">${csrfField(c)}<input type="hidden" name="process_id" value="${p.id}">
            <div class="row"><label>Task<input name="name" required></label><label>Frequency<input name="frequency" placeholder="e.g. daily, 3 times a week"></label></div>
            <div class="row"><label>Duration per shift (min)<input name="duration_min_per_shift" type="number" min="0" step="1"></label>
            <label>Duration is<select name="duration_basis">${BASIS.map(([v, l]) => html`<option value="${v}" ${v === 'user_estimate' ? html`selected` : ''}>${l}</option>`)}</select></label></div>
            <label>Description<textarea name="description"></textarea></label><div><button>Add task</button></div></form></details>` : ''}`)}
        ${w ? html`<details><summary class="small">Add a process to ${a.name}</summary><form method="post" action="/processes" class="stack panel">${csrfField(c)}<input type="hidden" name="work_area_id" value="${a.id}">
          <label>Process<input name="name" required></label><label>Description<textarea name="description"></textarea></label><div><button>Add process</button></div></form></details>` : ''}
        </section>`) : empty('No work areas yet.')}
      ${can(c.actor, 'sites.write') ? html`<details class="panel"><summary>Add a work area</summary><form method="post" action="/work-areas" class="stack">${csrfField(c)}<input type="hidden" name="site_id" value="${sid}">
        <label>Work area<input name="name" required></label><label>Description<textarea name="description"></textarea></label><div><button>Add work area</button></div></form></details>` : ''}
      ${w && t.tasks.length ? html`<details class="panel"><summary>Record an airborne hazard</summary><form method="post" action="/hazards" class="stack">${csrfField(c)}
        <div class="row"><label>Task<select name="task_id" required>${options(t.tasks, 'id', (x) => x.name)}</select></label>
        <label>Substance<select name="substance_id" required>${options(lk.substances, 'id', substanceLabel)}</select></label></div>
        <div class="row"><label>Physical form<select name="physical_form">${['dust', 'fume', 'mist', 'vapour', 'gas', 'fibre', 'aerosol', 'other'].map((f) => html`<option>${f}</option>`)}</select></label>
          <label>Routes<select name="exposure_routes" multiple size="3">${['inhalation', 'skin', 'ingestion', 'eye'].map((r) => html`<option ${r === 'inhalation' ? html`selected` : ''}>${r}</option>`)}</select></label></div>
        <div class="row"><label>Exposure frequency<input name="exposure_frequency"></label><label>Exposure duration (min/shift)<input type="number" name="exposure_duration_min" min="0"></label>
          <label>Exposure figures are<select name="exposure_basis">${BASIS.map(([v, l]) => html`<option value="${v}" ${v === 'user_estimate' ? html`selected` : ''}>${l}</option>`)}</select></label></div>
        <label>Existing controls<textarea name="existing_controls"></textarea></label>
        <div class="row"><label>Assessment owner<select name="assessment_owner_id">${options(lk.users, 'id', (u) => u.name)}</select></label><label>Review due<input type="date" name="review_due"></label></div>
        <label>Review triggers<input name="review_triggers" placeholder="e.g. new material, process change, control failure"></label>
        <div><button>Record hazard</button></div><p class="muted small">Substance missing? <a href="/reference#substances">Add it to reference data</a>.</p></form></details>` : ''}
      <h2>Exposure groups at this site</h2>
      ${t.groups.length ? html`<ul>${t.groups.map((g) => html`<li><a href="/groups/${g.id}">${g.name}</a>${g.review_required ? html` <span class="badge b-warn">Review needed</span>` : ''}</li>`)}</ul>` : empty('No groups yet.')}
      ${w && t.tasks.length ? html`<details class="panel"><summary>Define a similar exposure group</summary><form method="post" action="/groups" class="stack">${csrfField(c)}<input type="hidden" name="site_id" value="${sid}">
        <label>Group name<input name="name" required></label><label>Description<textarea name="description"></textarea></label>
        <label>Rationale <span class="hint">Why these workers are expected to share a similar exposure profile (tasks, materials, location, duration, controls). Required.</span><textarea name="rationale" minlength="20" required></textarea></label>
        <div class="row"><label>Tasks<select name="task_ids" multiple size="5">${options(t.tasks, 'id', (x) => x.name, null, '')}</select></label>
        <label>Hazards<select name="hazard_ids" multiple size="5">${options(t.hazards, 'id', (h) => `${h.substance_name} (${h.physical_form})`, null, '')}</select></label></div>
        <div><button>Create group</button></div></form></details>` : ''}`,
    };
  });
  action(app, '/work-areas', async (c) => { await reg.createWorkArea(c.actor, c.body); return { to: `/sites/${c.body.site_id}`, ok: 'Work area added' }; });
  action(app, '/processes', async (c) => { const p = await reg.createProcess(c.actor, c.body); return { to: `/sites/${await siteOfArea(c.actor, p.work_area_id)}`, ok: 'Process added' }; });
  action(app, '/tasks', async (c) => { await reg.createTask(c.actor, c.body); return { to: back(c, '/register'), ok: 'Task added' }; });
  action(app, '/hazards', async (c) => { await reg.createHazard(c.actor, c.body); return { to: back(c, '/register'), ok: 'Hazard recorded' }; });
  action(app, '/groups', async (c) => { const g = await reg.createGroup(c.actor, c.body); return { to: `/groups/${g.id}`, ok: 'Exposure group created' }; });

  page(app, '/groups/:id', async (c) => {
    const [d, lk] = await Promise.all([reg.groupDetail(c.actor, c.params.id), lookups(c.actor)]);
    const g = d.group;
    const w = can(c.actor, 'register.write');
    const current = d.memberships.filter((m) => !m.valid_to);
    return {
      title: g.name, crumbs: [['Exposure register', '/register'], ['Exposure group']], sub: g.site_name,
      head: g.review_required ? html`<span class="badge b-warn">Review needed</span>` : '',
      body: html`<div class="cols"><div>
        ${g.review_required ? html`<div class="flash warn"><b>Changes since the last review:</b><br>${g.review_reason.split('\n').map((l: string) => html`${l}<br>`)}</div>` : ''}
        <h2>Basis for grouping</h2><p>${g.rationale}</p>${g.description ? html`<p class="muted">${g.description}</p>` : ''}
        <h2>Tasks and hazards</h2>
        <ul>${d.tasks.map((t) => html`<li>${t.name}${t.duration_min_per_shift ? html` — ${t.duration_min_per_shift} min/shift` : ''}</li>`)}</ul>
        <ul>${d.hazards.map((h) => html`<li>${h.substance_name} (${h.physical_form}; ${h.exposure_routes.join(', ')})${h.existing_controls ? html` — controls: ${h.existing_controls}` : ''}</li>`)}</ul>
        <h2>Assessments</h2>
        ${d.assessments.length ? html`<ul>${d.assessments.map((a) => html`<li><a href="/assessments/${a.id}">${a.title}</a><br>${evidenceStrip(a.data_quality_state, a.benchmark_state, a.status)}</li>`)}</ul>` : empty('No assessments for this group.')}
        <h2>Controls</h2>
        ${d.controls.length ? html`<ul>${d.controls.map((x) => html`<li><a href="/controls/${x.id}">${x.name}</a> (${label(x.kind)}, ${label(x.status)})</li>`)}</ul>` : empty('No controls linked.')}
        <h2>Review history</h2>
        ${d.reviews.length ? html`<ul class="timeline">${d.reviews.map((r) => html`<li><b>${label(r.outcome)}</b> — ${fmtDateTime(r.reviewed_at)} by ${r.reviewer}<br><span class="small">Trigger: ${r.trigger}</span><br>${r.notes}</li>`)}</ul>` : empty('Not yet reviewed.')}
        ${can(c.actor, 'groups.review') ? html`<details class="panel" ${g.review_required ? html`open` : ''}><summary>Record a group review</summary><form method="post" action="/groups/${g.id}/review" class="stack">${csrfField(c)}
          <label>Outcome<select name="outcome"><option value="group_still_valid">Group still valid</option><option value="group_revised">Group revised</option><option value="group_split">Group should be split</option><option value="group_retired">Group retired</option></select></label>
          <label>Review notes<textarea name="notes" required></textarea></label>
          <label>Updated rationale <span class="hint">Required if the group is revised</span><textarea name="rationale"></textarea></label>
          <div><button>Record review</button></div></form></details>` : ''}
      </div><div>
        <h2>Members</h2>
        <p class="small muted">Sampling records keep the group a worker belonged to at the time; ending a membership does not change them.</p>
        ${d.memberships.length ? html`<div class="tablewrap"><table><thead><tr><th>Worker</th><th>From</th><th>To</th><th></th></tr></thead><tbody>
          ${d.memberships.map((m) => html`<tr><td>${m.ref_code}${m.full_name ? html`<br><span class="small muted">${m.full_name}</span>` : ''}</td><td>${fmtDate(m.valid_from)}</td><td>${m.valid_to ? fmtDate(m.valid_to) : 'current'}</td>
            <td>${!m.valid_to && w ? html`<details><summary class="small">End</summary><form method="post" action="/memberships/${m.id}/end" class="stack">${csrfField(c)}<label>End date<input type="date" name="valid_to" required></label><label>Reason<input name="reason" required></label><button class="secondary">End membership</button></form></details>` : ''}</td></tr>`)}
          </tbody></table></div>` : empty('No members.')}
        ${w ? html`<form method="post" action="/memberships" class="stack panel">${csrfField(c)}<input type="hidden" name="group_id" value="${g.id}"><h3>Add a member</h3>
          <label>Worker<select name="worker_id" required>${options(lk.workers.filter((x) => x.client_id === g.client_id && !current.some((m) => m.worker_id === x.id)), 'id', workerLabel)}</select></label>
          <label>From<input type="date" name="valid_from" required></label><label>Reason<input name="reason"></label><div><button>Add member</button></div></form>` : ''}
      </div></div>`,
    };
  });
  action(app, '/groups/:id/review', async (c) => { await reg.reviewGroup(c.actor, c.params.id, c.body); return { to: `/groups/${c.params.id}`, ok: 'Review recorded' }; });
  action(app, '/memberships', async (c) => { await reg.addMembership(c.actor, c.body); return { to: `/groups/${c.body.group_id}`, ok: 'Member added' }; });
  action(app, '/memberships/:id/end', async (c) => { const m = await reg.endMembership(c.actor, c.params.id, c.body); return { to: `/groups/${m.group_id}`, ok: 'Membership ended' }; });

  page(app, '/workers', async (c) => {
    const lk = await lookups(c.actor);
    const showId = can(c.actor, 'worker.identity.read');
    return {
      title: 'Worker references', crumbs: [['Exposure register', '/register'], ['Workers']],
      sub: 'Workers are referred to by pseudonymous codes throughout. Names are stored separately and shown only to roles permitted to see identifiable data.',
      body: html`${lk.workers.length ? html`<div class="tablewrap"><table><thead><tr><th>Reference</th>${showId ? html`<th>Name</th>` : ''}</tr></thead><tbody>
        ${lk.workers.map((w) => html`<tr><td>${w.ref_code}</td>${showId ? html`<td>${w.full_name ?? html`<span class="muted">not recorded</span>`}</td>` : ''}</tr>`)}</tbody></table></div>` : empty('No workers yet.')}
        ${can(c.actor, 'register.write') ? html`<form method="post" action="/workers" class="stack panel">${csrfField(c)}<h2>Add a worker reference</h2>
          ${lk.clients.length > 1 && !c.actor.clientId ? html`<label>Client<select name="client_id" required>${options(lk.clients, 'id', (x) => x.name)}</select></label>` : ''}
          <label>Reference code<input name="ref_code" required placeholder="e.g. W-014"></label>
          ${can(c.actor, 'worker.identity.write') ? html`<div class="row"><label>Full name <span class="hint">Optional, restricted</span><input name="full_name" autocomplete="off"></label><label>Employee number<input name="employee_number" autocomplete="off"></label></div>` : ''}
          <div><button>Add worker</button></div></form>` : ''}`,
    };
  });
  action(app, '/workers', async (c) => { await reg.createWorker(c.actor, c.body); return { to: '/workers', ok: 'Worker added' }; });
}

async function siteOfArea(a: any, areaId: string) {
  return withActor(a, async (tx) => (await many(tx, 'select site_id from work_areas where id=$1', [areaId]))[0]?.site_id);
}
