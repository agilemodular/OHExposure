import type { FastifyInstance } from 'fastify';
import { can, many, requirePerm, withActor } from '../db.js';
import { invalid } from '../errors.js';
import * as field from '../services/field.js';
import * as att from '../services/attachments.js';
import { lookups, substanceLabel, workerLabel } from '../services/lookups.js';
import { utcToZonedInput } from '../services/util.js';
import { fmtDate, fmtDateTime, html, label } from '../ui/html.js';
import { csrfField, empty, options, type PageCtx } from '../ui/layout.js';
import { action, api, back, page, setFlash } from './kit.js';

export function attachmentsBlock(c: PageCtx, entityType: string, entityId: string, files: any[], canAdd: boolean) {
  return html`<h3>Attachments</h3>
    ${files.length ? html`<ul>${files.map((f) => html`<li><a href="/attachments/${f.id}">${f.filename}</a> <span class="small muted">${Math.ceil(f.size_bytes / 1024)} KB · ${fmtDateTime(f.uploaded_at)}${f.contains_pii ? ' · identifiable' : ''}</span></li>`)}</ul>` : html`<p class="muted small">None.</p>`}
    ${canAdd ? html`<form method="post" action="/attachments?_csrf=${c.csrf}" enctype="multipart/form-data" class="stack panel">
      <input type="hidden" name="entity_type" value="${entityType}"><input type="hidden" name="entity_id" value="${entityId}">
      <label>File <span class="hint">PDF, PNG, JPEG, CSV or TXT</span><input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.csv,.txt"></label>
      <label class="check"><input type="checkbox" name="contains_pii" value="on"> Contains identifiable worker information</label><div><button class="secondary">Upload</button></div></form>` : ''}`;
}

export function fieldRoutes(app: FastifyInstance) {
  // ── Offline-capable capture client (static JS + service worker; data in IndexedDB)
  page(app, '/field', async (c) => {
    requirePerm(c.actor, 'field.capture');
    return {
      title: 'Field sampling',
      sub: 'Works offline. Records stay on this device until they are synchronised.',
      body: html`<div id="field-app" data-user="${c.actor.userId}" data-plan="${c.query.plan ?? ''}"><p class="muted">Loading the field client…</p>
        <noscript><div class="flash err">The field client needs JavaScript. You can still record samples online from a plan page.</div></noscript></div>
        <script src="/static/field.js" defer></script>`,
    };
  });
  api(app, 'GET', '/api/field/bootstrap', async (c) => {
    requirePerm(c.actor, 'field.capture');
    const lk = await lookups(c.actor);
    const plans = await withActor(c.actor, (tx) => many(tx, `select p.id, p.title, s.name site_name from monitoring_plans p join sites s on s.id=p.site_id where p.status in ('scheduled','in_progress') order by p.planned_start nulls last`));
    return {
      userId: c.actor.userId, csrf: c.csrf, fetchedAt: new Date().toISOString(), cacheDays: 7,
      plans,
      workers: lk.workers.map((w) => ({ id: w.id, label: workerLabel(w) })),
      groups: lk.groups.map((g) => ({ id: g.id, label: `${g.name} (${g.site_name})` })),
      instruments: lk.instruments.filter((i) => i.status === 'in_service').map((i) => ({ id: i.id, label: `${i.asset_tag}${i.screening_only ? ' (screening only)' : ''}` })),
      methods: lk.methods.map((m) => ({ id: m.id, label: `${m.code} v${m.version}` })),
      substances: lk.substances.map((s) => ({ id: s.id, label: substanceLabel(s) })),
    };
  });
  api(app, 'POST', '/api/sync', async (c) => {
    const items = Array.isArray(c.body?.items) ? c.body.items : null;
    if (!items) throw invalid('Expected { items: [...] }');
    if (items.length > 200) throw invalid('Maximum 200 items per sync');
    return { results: await field.syncBatch(c.actor, items) };
  });

  // ── Samples
  page(app, '/samples', async (c) => {
    const status = ['planned', 'in_progress', 'collected', 'dispatched', 'received', 'analysed', 'void'].includes(c.query.status) ? c.query.status : undefined;
    const list = await field.listSamples(c.actor, { status });
    return {
      title: 'Samples', sub: status ? `Showing ${label(status)} samples` : 'All sampling events',
      head: html`<form method="get" class="actions-row"><select name="status"><option value="">All statuses</option>${['planned', 'in_progress', 'collected', 'dispatched', 'received', 'analysed', 'void'].map((s) => html`<option ${s === status ? html`selected` : ''} value="${s}">${label(s)}</option>`)}</select><button class="secondary">Filter</button></form>`,
      body: list.length ? html`<div class="tablewrap"><table><thead><tr><th>Sample</th><th>Type</th><th>Worker / plan</th><th>Substance</th><th>Start</th><th>Status</th><th>Checks</th></tr></thead><tbody>
        ${list.map((s) => html`<tr><td><a href="/samples/${s.id}">${s.sample_code}</a>${s.captured_offline ? html` <span class="tag">offline</span>` : ''}</td><td>${label(s.sample_type)}</td><td>${s.worker_ref ?? '—'}<br><span class="small muted">${s.plan_title ?? ''}</span></td><td>${s.substance_name ?? '—'}</td>
          <td>${fmtDateTime(s.start_at, s.timezone)}</td><td>${label(s.status)}</td><td>${s.unresolved_qc ? html`<span class="badge b-bad">${s.unresolved_qc} failed, unresolved</span>` : ''}</td></tr>`)}</tbody></table></div>` : empty('No samples.'),
    };
  });

  page(app, '/samples/:id', async (c) => {
    const [d, lk, files] = await Promise.all([field.sampleDetail(c.actor, c.params.id), lookups(c.actor), att.listAttachments(c.actor, 'sampling_event', c.params.id)]);
    const e = d.event;
    const tz = e.timezone ?? 'Europe/London';
    const editable = can(c.actor, 'field.capture') && !['dispatched', 'received', 'analysed', 'void'].includes(e.status);
    const mins = e.start_at && e.end_at ? Math.round((new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 60000) : null;
    return {
      title: `Sample ${e.sample_code}`, crumbs: [['Samples', '/samples'], ['Sample']],
      sub: html`${label(e.sample_type)} · ${label(e.status)}${e.plan_title ? html` · <a href="/plans/${e.plan_id}">${e.plan_title}</a>` : ''}`,
      body: html`
      ${d.conflicts.length ? html`<div class="flash warn">This record has ${d.conflicts.length} unresolved offline edit conflict(s). <a href="/conflicts">Review conflicts</a>.</div>` : ''}
      ${e.status === 'void' ? html`<div class="flash err">Void: ${e.void_reason}</div>` : ''}
      <div class="cols"><div>
      <dl class="kv">
        <dt>Worker</dt><dd>${e.worker_ref ?? '—'}${e.worker_name ? html` (${e.worker_name})` : ''}</dd>
        <dt>Group at sampling</dt><dd>${e.group_name ?? html`<span class="badge b-warn">not recorded</span>`}</dd>
        <dt>Location</dt><dd>${e.location_desc ?? '—'}</dd><dt>Substance</dt><dd>${e.substance_name ?? '—'}</dd>
        <dt>Method</dt><dd>${e.method_code ? `${e.method_code} v${e.method_version}` : '—'}</dd>
        <dt>Instrument</dt><dd>${e.asset_tag ?? '—'} ${e.screening_only ? html`<span class="tag tag-q">screening only</span>` : ''}
          ${e.instrument_id ? (d.calibrationOk === null ? html`<span class="badge b-bad">No calibration evidence on sampling date</span>` : d.calibrationOk ? html`<span class="badge b-ok">Calibrated on sampling date</span>` : html`<span class="badge b-bad">Calibration expired or failed on sampling date</span>`) : ''}</dd>
        <dt>Time</dt><dd>${fmtDateTime(e.start_at, tz)} – ${fmtDateTime(e.end_at, tz)} <span class="muted small">(${tz}${mins ? `, ${mins} min elapsed` : ''})</span></dd>
        <dt>Interruptions</dt><dd>${(e.interruptions ?? []).length ? (e.interruptions as any[]).map((i) => html`${fmtDateTime(i.start, tz)}–${fmtDateTime(i.end, tz)} ${i.reason}<br>`) : 'None recorded'}</dd>
        <dt>Flow (L/min)</dt><dd>pre ${e.flow_pre_lpm ?? '—'} / post ${e.flow_post_lpm ?? '—'}</dd>
        <dt>Tasks performed</dt><dd>${e.tasks_performed ?? '—'}</dd><dt>Control status</dt><dd>${e.control_status ?? '—'}</dd>
        <dt>Operating conditions</dt><dd>${e.operating_conditions ?? '—'}</dd><dt>Deviations</dt><dd>${e.deviations ?? '—'}</dd><dt>Notes</dt><dd>${e.notes ?? '—'}</dd>
        <dt>Media lot</dt><dd>${e.media_lot ?? '—'}</dd><dt>Captured</dt><dd>${e.captured_offline ? 'Offline client' : 'Online'}, record version ${e.version}</dd>
      </dl>
      <h2>Laboratory results</h2>
      ${d.results.length ? html`<div class="tablewrap"><table><thead><tr><th>Analyte</th><th>Rev</th><th>Result</th><th>LOD / LOQ</th><th>Report</th><th>Entered</th></tr></thead><tbody>
        ${d.results.map((r) => html`<tr><td>${r.substance_name}</td><td>${r.revision}${r.amendment_reason ? html`<br><span class="small muted">${r.amendment_reason}</span>` : ''}</td><td>${r.qualifier === '=' ? '' : r.qualifier + ' '}${r.value ?? ''} ${r.unit}</td><td>${r.lod ?? '—'} / ${r.loq ?? '—'}</td><td>${r.lab_report_ref ?? '—'}</td><td>${fmtDateTime(r.entered_at)}</td></tr>`)}</tbody></table></div>` : empty('No results recorded.')}
      ${can(c.actor, 'lab.write') && ['collected', 'dispatched', 'received', 'analysed'].includes(e.status) ? html`<details class="panel"><summary>Record or amend a result</summary>
        <form method="post" action="/lab/results" class="stack">${csrfField(c)}<input type="hidden" name="sampling_event_id" value="${e.id}">
        <div class="row"><label>Analyte<select name="substance_id" required>${options(lk.substances, 'id', substanceLabel, e.substance_id)}</select></label>
        <label>Qualifier<select name="qualifier"><option value="=">= (detected)</option><option value="<LOD">&lt; LOD (not detected)</option><option value="<LOQ">&lt; LOQ</option><option value=">">&gt; (over range)</option><option value="estimated">estimated</option></select></label>
        <label>Value<input name="value" type="number" step="any" min="0"></label><label>Unit<select name="unit">${['ug', 'mg', 'ug/m3', 'mg/m3', 'ppm', 'f/ml'].map((u) => html`<option>${u}</option>`)}</select></label></div>
        <div class="row"><label>LOD<input name="lod" type="number" step="any" min="0"></label><label>LOQ<input name="loq" type="number" step="any" min="0"></label>
        <label>Laboratory<select name="laboratory_id">${options(lk.labs, 'id', (l) => l.name)}</select></label><label>Report reference<input name="lab_report_ref"></label></div>
        <div class="row"><label>Analytical method<input name="analytical_method"></label><label>Uncertainty<input name="uncertainty"></label><label>Sample condition<input name="sample_condition"></label></div>
        <label>Laboratory comments<textarea name="lab_comments"></textarea></label>
        <label>Amendment reason <span class="hint">Required when a result already exists; the earlier revision is kept</span><input name="amendment_reason"></label>
        <div><button>Save result</button></div></form></details>` : ''}
      ${editable ? html`<details class="panel"><summary>Edit field record</summary><form method="post" action="/samples/${e.id}/edit" class="stack">${csrfField(c)}<input type="hidden" name="version" value="${e.version}">
        <input type="hidden" name="sample_code" value="${e.sample_code}"><input type="hidden" name="sample_type" value="${e.sample_type}"><input type="hidden" name="plan_id" value="${e.plan_id ?? ''}">
        <div class="row"><label>Worker<select name="worker_id">${options(lk.workers, 'id', workerLabel, e.worker_id)}</select></label><label>Group<select name="group_id">${options(lk.groups, 'id', (g) => g.name, e.group_id_at_sampling)}</select></label>
        <label>Location<input name="location_desc" value="${e.location_desc ?? ''}"></label></div>
        <div class="row"><label>Substance<select name="substance_id">${options(lk.substances, 'id', substanceLabel, e.substance_id)}</select></label><label>Method<select name="method_version_id">${options(lk.methods, 'id', (m) => `${m.code} v${m.version}`, e.method_version_id)}</select></label>
        <label>Instrument<select name="instrument_id">${options(lk.instruments, 'id', (i) => i.asset_tag, e.instrument_id)}</select></label></div>
        <div class="row"><label>Time zone<input name="timezone" value="${tz}"></label><label>Start<input type="datetime-local" name="start_local" value="${utcToZonedInput(e.start_at?.toISOString?.() ?? e.start_at, tz)}"></label>
        <label>Finish<input type="datetime-local" name="end_local" value="${utcToZonedInput(e.end_at?.toISOString?.() ?? e.end_at, tz)}"></label></div>
        <label>Interruptions <span class="hint">JSON list of {"start","end","reason"} in local time</span><input name="interruptions" value="${JSON.stringify((e.interruptions ?? []).map((i: any) => ({ start: utcToZonedInput(i.start, tz), end: utcToZonedInput(i.end, tz), reason: i.reason })))}"></label>
        <div class="row"><label>Flow pre (L/min)<input type="number" step="any" name="flow_pre_lpm" value="${e.flow_pre_lpm ?? ''}"></label><label>Flow post (L/min)<input type="number" step="any" name="flow_post_lpm" value="${e.flow_post_lpm ?? ''}"></label><label>Media lot<input name="media_lot" value="${e.media_lot ?? ''}"></label></div>
        <label>Tasks performed<textarea name="tasks_performed">${e.tasks_performed ?? ''}</textarea></label>
        <div class="row"><label>Control status<input name="control_status" value="${e.control_status ?? ''}"></label><label>Operating conditions<input name="operating_conditions" value="${e.operating_conditions ?? ''}"></label></div>
        <label>Deviations<textarea name="deviations">${e.deviations ?? ''}</textarea></label><label>Notes<textarea name="notes">${e.notes ?? ''}</textarea></label>
        <div><button>Save changes</button></div></form></details>` : ''}
      ${e.status !== 'void' && (can(c.actor, 'field.capture') || can(c.actor, 'assess.write')) ? html`<details class="panel"><summary>Void this sample</summary><form method="post" action="/samples/${e.id}/void" class="stack">${csrfField(c)}<label>Reason<input name="reason" required></label><div><button class="danger">Void sample</button></div></form></details>` : ''}
      </div><div>
        <h2>Quality checks</h2>
        ${d.qc.length ? html`<ul class="issues">${d.qc.map((q) => html`<li class="${q.outcome === 'fail' ? (q.disposition === 'accepted_with_justification' ? 'sev-qualify' : 'sev-exclude') : ''}"><b>${q.check_type}</b>: ${label(q.outcome)}${q.detail ? html` — ${q.detail}` : ''}
          ${q.outcome === 'fail' ? (q.disposition ? html`<br><span class="small">Disposition: ${label(q.disposition)} by ${q.disposition_by_name} — ${q.disposition_reason}</span>`
            : html`<br><span class="small"><b>No disposition.</b> This sample cannot be used as evidence until a practitioner or reviewer records one.</span>
              ${can(c.actor, 'assess.write') || can(c.actor, 'assess.approve') ? html`<form method="post" action="/qc/${q.id}/dispose" class="stack">${csrfField(c)}<select name="disposition"><option value="sample_invalidated">Invalidate sample</option><option value="accepted_with_justification">Accept with justification</option></select><textarea name="reason" placeholder="Justification (min 20 characters)" required></textarea><button class="secondary">Record disposition</button></form>` : ''}`) : ''}</li>`)}</ul>` : empty('No checks recorded.')}
        ${can(c.actor, 'field.capture') || can(c.actor, 'lab.write') ? html`<form method="post" action="/samples/${e.id}/qc" class="stack panel">${csrfField(c)}<h3>Add a check</h3>
          <label>Check<input name="check_type" required placeholder="e.g. post-sampling flow check"></label><label>Outcome<select name="outcome"><option value="pass">pass</option><option value="fail">fail</option><option value="not_applicable">not applicable</option></select></label>
          <label>Detail<input name="detail"></label><div><button class="secondary">Add check</button></div></form>` : ''}
        <h2>Chain of custody</h2>
        ${d.custody.length ? html`<ul class="timeline">${d.custody.map((x) => html`<li><b>${label(x.event)}</b> ${fmtDateTime(x.at, tz)}${x.party ? html` — ${x.party}` : ''}${x.condition ? html`<br>Condition: ${x.condition}` : ''}${x.notes ? html`<br><span class="small muted">${x.notes}</span>` : ''}<br><span class="small muted">Recorded by ${x.recorded_by_name ?? '—'}</span></li>`)}</ul>` : empty('No custody events yet.')}
        ${can(c.actor, 'field.capture') || can(c.actor, 'lab.write') ? html`<form method="post" action="/samples/${e.id}/custody" class="stack panel">${csrfField(c)}<h3>Record custody event</h3>
          <label>Event<select name="event"><option value="handed_over">Handed over</option><option value="dispatched">Dispatched</option><option value="received_by_lab">Received by laboratory</option><option value="returned">Returned</option><option value="discarded">Discarded</option></select></label>
          <label>When (${tz})<input type="datetime-local" name="at" required></label><input type="hidden" name="timezone" value="${tz}"><label>Party<input name="party"></label><label>Condition<input name="condition"></label><label>Notes<input name="notes"></label><div><button class="secondary">Record</button></div></form>` : ''}
        ${attachmentsBlock(c, 'sampling_event', e.id, files, can(c.actor, 'field.capture') || can(c.actor, 'lab.write'))}
      </div></div>`,
    };
  });
  action(app, '/samples/:id/edit', async (c) => { const r = await field.updateSamplingEvent(c.actor, c.params.id, c.body); return { to: `/samples/${c.params.id}`, ok: 'Sample updated', ...(r.warnings.length ? { warn: r.warnings.join(' ') } : {}) }; });
  action(app, '/samples/:id/void', async (c) => { await field.voidSamplingEvent(c.actor, c.params.id, c.body); return { to: `/samples/${c.params.id}`, ok: 'Sample voided' }; });
  action(app, '/samples/:id/qc', async (c) => { await field.addQcCheck(c.actor, c.params.id, c.body); return { to: `/samples/${c.params.id}`, ok: 'Check recorded' }; });
  action(app, '/qc/:id/dispose', async (c) => { await field.disposeQcFailure(c.actor, c.params.id, c.body); return { to: back(c), ok: 'Disposition recorded' }; });
  action(app, '/samples/:id/custody', async (c) => { await field.recordCustody(c.actor, c.params.id, c.body); return { to: `/samples/${c.params.id}`, ok: 'Custody event recorded' }; });

  // ── Conflicts
  page(app, '/conflicts', async (c) => {
    requirePerm(c.actor, 'conflicts.resolve');
    const list = await field.listConflicts(c.actor);
    const KEYS = ['sample_code', 'worker_id', 'start_local', 'end_local', 'flow_pre_lpm', 'flow_post_lpm', 'tasks_performed', 'control_status', 'operating_conditions', 'deviations', 'notes'];
    const server = (s: any, k: string) => k === 'start_local' ? fmtDateTime(s.start_at, s.timezone) : k === 'end_local' ? fmtDateTime(s.end_at, s.timezone) : s[k];
    return {
      title: 'Offline sync conflicts', sub: 'When a device synchronises edits made against an older copy, both versions are kept here. Nothing is overwritten until someone decides.',
      body: list.length ? list.map((x) => html`<section class="panel"><h2><a href="/samples/${x.entity_id}">${x.server_payload.sample_code}</a> <span class="badge ${x.status === 'open' ? 'b-warn' : 'b-neutral'}">${label(x.status)}</span></h2>
        <p class="small muted">Submitted ${fmtDateTime(x.submitted_at)} by ${x.submitted_by_name ?? '—'}; device edited version ${x.base_version ?? 'new'}, server was at version ${x.server_version}.</p>
        <div class="tablewrap"><table><thead><tr><th>Field</th><th>Server copy</th><th>Device copy</th></tr></thead><tbody>
          ${KEYS.map((k) => { const a = server(x.server_payload, k) ?? '', b = x.client_payload[k] ?? ''; return String(a) !== String(b) ? html`<tr><td>${label(k)}</td><td>${String(a)}</td><td><b>${String(b)}</b></td></tr>` : ''; })}</tbody></table></div>
        ${x.status === 'open' ? html`<form method="post" action="/conflicts/${x.id}" class="stack">${csrfField(c)}<label>Decision notes<input name="notes" required></label>
          <div class="actions-row"><button name="resolution" value="resolved_keep_server" class="secondary">Keep server copy</button><button name="resolution" value="resolved_apply_client">Apply device copy</button></div></form>` : html`<p class="small">${x.resolution_notes}</p>`}
        </section>`) : empty('No sync conflicts.'),
    };
  });
  action(app, '/conflicts/:id', async (c) => { await field.resolveConflict(c.actor, c.params.id, c.body); return { to: '/conflicts', ok: 'Conflict resolved' }; });

  // ── Attachments (multipart upload, authorised download)
  app.post('/attachments', async (req, reply) => {
    const { resolveSession } = await import('../auth/session.js');
    const si = await resolveSession(req.cookies.ohea_sid, req.ip);
    if (!si || !si.mfaPassed) return reply.redirect('/login', 303);
    if ((req.query as any)._csrf !== si.csrf) return reply.code(403).send('Invalid form token');
    const parts = req.parts();
    const fields: Record<string, string> = {}; let file: { filename: string; data: Buffer } | null = null;
    for await (const p of parts) {
      if (p.type === 'file') file = { filename: p.filename, data: await p.toBuffer() };
      else fields[p.fieldname] = String(p.value);
    }
    const to = (req.headers.referer && new URL(req.headers.referer).pathname) || '/';
    try {
      if (!file) throw invalid('Choose a file');
      await att.saveAttachment(si.actor, { entity_type: fields.entity_type, entity_id: fields.entity_id, filename: file.filename, data: file.data, contains_pii: fields.contains_pii === 'on' });
      setFlash(reply, 'ok', 'File uploaded');
    } catch (e: any) {
      if (!e.status) throw e;
      setFlash(reply, 'err', e.message);
    }
    return reply.redirect(to, 303);
  });
  app.get('/attachments/:id', async (req, reply) => {
    const { resolveSession } = await import('../auth/session.js');
    const si = await resolveSession(req.cookies.ohea_sid, req.ip);
    if (!si || !si.mfaPassed) return reply.redirect('/login');
    try {
      const { meta, data } = await att.readAttachment(si.actor, (req.params as any).id);
      const inline = ['application/pdf', 'image/png', 'image/jpeg'].includes(meta.mime_type);
      return reply.type(meta.mime_type).header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${meta.filename.replace(/"/g, '')}"`)
        .header('Content-Security-Policy', "default-src 'none'; sandbox").send(data);
    } catch (e: any) {
      if (e.status) return reply.code(e.status).send(e.message);
      throw e;
    }
  });
  void fmtDate;
}
