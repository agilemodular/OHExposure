import type { FastifyInstance } from 'fastify';
import { can, many, withActor } from '../db.js';
import { invalid } from '../errors.js';
import * as lab from '../services/lab.js';
import * as att from '../services/attachments.js';
import * as inst from '../services/instruments.js';
import { lookups } from '../services/lookups.js';
import { fmtDate, fmtDateTime, html, label } from '../ui/html.js';
import { csrfField, empty, options } from '../ui/layout.js';
import { action, authedMultipart, back, page, setFlash } from './kit.js';
import { attachmentsBlock } from './field.js';

export function labRoutes(app: FastifyInstance) {
  page(app, '/lab', async (c) => {
    const [results, subs, lk, collected] = await Promise.all([lab.listResults(c.actor), lab.listSubmissions(c.actor), lookups(c.actor),
      withActor(c.actor, (tx) => many(tx, `select id, sample_code from sampling_events where status='collected' order by sample_code`))]);
    return {
      title: 'Laboratory results', sub: 'Submissions, chain of custody and analytical results. Amended results are kept as revisions.',
      body: html`
      <h2>Recent results</h2>
      ${results.length ? html`<div class="tablewrap"><table><thead><tr><th>Sample</th><th>Analyte</th><th>Result</th><th>Rev</th><th>Laboratory / report</th><th>Entered</th></tr></thead><tbody>
        ${results.map((r) => html`<tr><td><a href="/samples/${r.sample_id}">${r.sample_code}</a> <span class="small muted">${label(r.sample_type)}</span></td><td>${r.substance_name}</td>
          <td>${r.qualifier === '=' ? '' : html`<span class="tag tag-q">${r.qualifier}</span> `}${r.value ?? (r.qualifier === '<LOD' ? r.lod : '')} ${r.unit}</td><td>${r.revision}</td><td>${r.lab_name ?? '—'} ${r.lab_report_ref ?? ''}</td><td>${fmtDateTime(r.entered_at)}</td></tr>`)}</tbody></table></div>` : empty('No results yet.')}
      <div class="cols"><div>
      <h2>Import results from a file</h2>
      ${can(c.actor, 'lab.import') ? html`<form method="post" action="/lab/import" enctype="multipart/form-data" class="stack panel">${csrfField(c)}
        <p class="small">CSV columns: <code>${lab.IMPORT_COLUMNS.join(', ')}</code>. <code>sample_code</code>, <code>value</code>, <code>unit</code>, <code>qualifier</code> and either <code>analyte</code> or <code>cas_number</code> are required.
        Qualifiers: <code>=</code>, <code>&lt;LOD</code>, <code>&lt;LOQ</code>, <code>&gt;</code>, <code>estimated</code>. Every row is validated first; nothing is saved unless the whole file is valid.</p>
        <label>Laboratory<select name="laboratory_id">${options(lk.labs, 'id', (l) => l.name)}</select></label>
        <label>CSV file<input type="file" name="file" accept=".csv,.txt" required></label><div><button>Validate file</button></div></form>` : html`<p class="muted">Your role cannot import results.</p>`}
      </div><div>
      <h2>Laboratory submissions</h2>
      ${subs.length ? html`<ul class="timeline">${subs.map((s) => html`<li><b>${s.reference}</b> — ${s.lab_name}<br>Dispatched ${fmtDateTime(s.dispatched_at)} · ${s.sample_count} sample(s) · ${s.result_count} result(s)<br>
        ${s.received_at ? html`Received ${fmtDateTime(s.received_at)}: ${s.received_condition}` : can(c.actor, 'lab.write') ? html`<form method="post" action="/lab/submissions/${s.id}/receive" class="stack">${csrfField(c)}<div class="row"><label>Received<input type="datetime-local" name="received_at" required></label><label>Condition<input name="received_condition" required placeholder="e.g. intact, seals unbroken"></label></div><button class="secondary tiny">Record receipt</button></form>` : 'Not yet received'}</li>`)}</ul>` : empty('No submissions.')}
      ${can(c.actor, 'lab.write') ? html`<details class="panel"><summary>Dispatch collected samples</summary>${collected.length ? html`<form method="post" action="/lab/submissions" class="stack">${csrfField(c)}
        <label>Laboratory<select name="laboratory_id" required>${options(lk.labs, 'id', (l) => l.name)}</select></label><label>Submission reference<input name="reference" required></label>
        <label>Samples<select name="sample_ids" multiple size="6" required>${options(collected, 'id', (s) => s.sample_code, null, '')}</select></label>
        <div class="row"><label>Dispatched<input type="datetime-local" name="dispatched_at" required></label><label>Courier reference<input name="courier_ref"></label></div>
        <div><button>Record dispatch</button></div></form>` : html`<p class="muted small">No collected samples waiting for dispatch.</p>`}</details>
        <details class="panel"><summary>Add a laboratory</summary><form method="post" action="/lab/laboratories" class="stack">${csrfField(c)}<label>Name<input name="name" required></label><label>Accreditation reference<input name="accreditation_ref"></label><label>Contact<input name="contact"></label><div><button class="secondary">Add laboratory</button></div></form></details>` : ''}
      </div></div>`,
    };
  });
  action(app, '/lab/results', async (c) => { await lab.recordResult(c.actor, c.body); return { to: back(c, '/lab'), ok: 'Result saved' }; });
  action(app, '/lab/submissions', async (c) => { await lab.createSubmission(c.actor, c.body); return { to: '/lab', ok: 'Dispatch recorded; custody updated for each sample' }; });
  action(app, '/lab/submissions/:id/receive', async (c) => { await lab.receiveSubmission(c.actor, c.params.id, c.body); return { to: '/lab', ok: 'Receipt recorded' }; });
  action(app, '/lab/laboratories', async (c) => { await inst.createLaboratory(c.actor, c.body); return { to: '/lab', ok: 'Laboratory added' }; });

  app.post('/lab/import', async (req, reply) => {
    const m = await authedMultipart(req, reply);
    if (!m) return reply;
    const { si, fields, file } = m;
    try {
      if (!file) throw invalid('Choose a file');
      if (!att.sniff(file.data, file.filename)?.startsWith('text/')) throw invalid('Import files must be CSV text');
      const b = await lab.stageImport(si.actor, { filename: file.filename, csv: file.data.toString('utf8'), laboratory_id: fields.laboratory_id || null });
      // Keep the source file only when the batch is tied to one client; otherwise it could be visible across clients.
      if (b.client_id) await att.saveAttachment(si.actor, { entity_type: 'import_batch', entity_id: b.id, filename: file.filename, data: file.data });
      setFlash(reply, b.status === 'validated' ? 'ok' : 'err', b.status === 'validated' ? `All ${b.row_count} rows are valid. Review and commit.` : `${b.error_count} of ${b.row_count} rows have problems. Nothing has been saved.`);
      return reply.redirect(`/lab/imports/${b.id}`, 303);
    } catch (e: any) {
      if (!e.status) throw e;
      setFlash(reply, 'err', e.message);
      return reply.redirect('/lab', 303);
    }
  });

  page(app, '/lab/imports/:id', async (c) => {
    if (!can(c.actor, 'lab.import') && !can(c.actor, 'lab.write')) throw new (await import('../errors.js')).AppError(403, 'forbidden', 'Your role cannot view laboratory import files');
    const d = await lab.importDetail(c.actor, c.params.id);
    if (!d.batch) throw invalid('Import not found');
    const files = await att.listAttachments(c.actor, 'import_batch', c.params.id);
    return {
      title: `Import: ${d.batch.filename}`, crumbs: [['Laboratory results', '/lab'], ['Import']],
      sub: `${d.batch.row_count} rows · ${label(d.batch.status)}${d.batch.committed_at ? ` ${fmtDateTime(d.batch.committed_at)}` : ''}`,
      head: d.batch.status === 'validated' && can(c.actor, 'lab.import') ? html`<form method="post" action="/lab/imports/${d.batch.id}/commit">${csrfField(c)}<button>Commit ${d.batch.row_count} results</button></form>` : '',
      body: html`${d.batch.status === 'rejected' ? html`<div class="flash err">This file was rejected. Correct the rows below and upload it again; nothing was saved.</div>` : ''}
        <div class="tablewrap"><table><thead><tr><th>Row</th><th>Sample</th><th>Analyte</th><th>Result</th><th>Problems</th></tr></thead><tbody>
        ${d.rows.map((r) => html`<tr><td>${r.row_no}</td><td>${r.raw.sample_code}</td><td>${r.raw.analyte || r.raw.cas_number}</td><td>${r.raw.qualifier} ${r.raw.value} ${r.raw.unit}</td>
          <td>${r.errors.length ? html`<ul class="issues">${r.errors.map((e: string) => html`<li class="sev-exclude">${e}</li>`)}</ul>` : html`<span class="badge b-ok">Valid</span>`}</td></tr>`)}</tbody></table></div>
        ${attachmentsBlock(c, 'import_batch', d.batch.id, files, false)}`,
    };
  });
  action(app, '/lab/imports/:id/commit', async (c) => { const r = await lab.commitImport(c.actor, c.params.id); return { to: '/lab', ok: r.already ? 'This import was already committed' : `${r.count} results imported` }; });

  // ── Instruments
  page(app, '/instruments', async (c) => {
    const list = await inst.listInstruments(c.actor);
    const tone: Record<string, string> = { valid: 'b-ok', due_soon: 'b-warn', expired: 'b-bad', failed: 'b-bad', missing: 'b-bad' };
    return {
      title: 'Instruments', sub: 'Sampling pumps, direct-reading monitors and calibrators, with calibration and service evidence.',
      body: html`${list.length ? html`<div class="tablewrap"><table><thead><tr><th>Asset</th><th>Type</th><th>Make / model</th><th>Designation</th><th>Calibration</th><th>Status</th></tr></thead><tbody>
        ${list.map((i) => html`<tr><td><a href="/instruments/${i.id}">${i.asset_tag}</a></td><td>${label(i.instrument_type)}</td><td>${[i.make, i.model].filter(Boolean).join(' ') || '—'}</td>
          <td>${i.screening_only ? html`<span class="tag tag-q">screening only</span>` : 'formal'}</td><td><span class="badge ${tone[i.calibration.state]}">${i.calibration.label}</span></td><td>${label(i.status)}</td></tr>`)}</tbody></table></div>` : empty('No instruments yet.')}
        ${can(c.actor, 'instruments.write') ? html`<details class="panel"><summary>Add an instrument</summary><form method="post" action="/instruments" class="stack">${csrfField(c)}
          <div class="row"><label>Asset tag<input name="asset_tag" required></label><label>Type<select name="instrument_type"><option value="sampling_pump">Sampling pump</option><option value="direct_reading_monitor">Direct-reading monitor</option><option value="flow_calibrator">Flow calibrator</option><option value="other">Other</option></select></label></div>
          <div class="row"><label>Make<input name="make"></label><label>Model<input name="model"></label><label>Serial number<input name="serial_number"></label></div>
          <label>Measures <span class="hint">What it measures and how</span><input name="measures"></label>
          <div class="row"><label>Range minimum<input type="number" step="any" name="range_min"></label><label>Range maximum<input type="number" step="any" name="range_max"></label><label>Range units<input name="range_units"></label></div>
          <label class="check"><input type="checkbox" name="screening_only" value="on"> Screening only — results will be labelled indicative and excluded from formal benchmark comparison</label>
          <div><button>Add instrument</button></div></form></details>` : ''}`,
    };
  });
  action(app, '/instruments', async (c) => { const i = await inst.createInstrument(c.actor, c.body); return { to: `/instruments/${i.id}`, ok: 'Instrument added. Record its calibration evidence.' }; });

  page(app, '/instruments/:id', async (c) => {
    const d = await inst.instrumentDetail(c.actor, c.params.id);
    const i = d.instrument;
    const files = await att.listAttachments(c.actor, 'instrument', i.id);
    const w = can(c.actor, 'instruments.write');
    return {
      title: i.asset_tag, crumbs: [['Instruments', '/instruments'], ['Instrument']], sub: `${label(i.instrument_type)} · ${label(i.status)}`,
      body: html`<div class="cols"><div>
        <dl class="kv"><dt>Make / model</dt><dd>${[i.make, i.model].filter(Boolean).join(' ') || '—'}</dd><dt>Serial</dt><dd>${i.serial_number ?? '—'}</dd><dt>Measures</dt><dd>${i.measures ?? '—'}</dd>
          <dt>Range</dt><dd>${i.range_min ?? '—'} – ${i.range_max ?? '—'} ${i.range_units ?? ''}</dd><dt>Designation</dt><dd>${i.screening_only ? 'Screening only (indicative results)' : 'Formal assessment'}</dd>
          <dt>Calibration</dt><dd>${i.calibration.label}</dd></dl>
        <h2>Calibration history</h2>
        ${d.calibrations.length ? html`<div class="tablewrap"><table><thead><tr><th>Performed</th><th>Valid until</th><th>Outcome</th><th>Provider / certificate</th><th>Recorded by</th></tr></thead><tbody>
          ${d.calibrations.map((x) => html`<tr><td>${fmtDate(x.performed_at)}</td><td>${fmtDate(x.valid_until)}</td><td>${x.outcome === 'fail' ? html`<span class="badge b-bad">fail</span>` : label(x.outcome)}</td><td>${x.provider ?? '—'} ${x.certificate_ref ?? ''}${x.attachment_id ? html` <a href="/attachments/${x.attachment_id}">certificate</a>` : ''}</td><td>${x.recorded_by_name ?? '—'}</td></tr>`)}</tbody></table></div>` : empty('No calibration evidence. Samples taken with this instrument will be flagged.')}
        ${w ? html`<form method="post" action="/instruments/${i.id}/calibrations" class="stack panel">${csrfField(c)}<h3>Record calibration</h3>
          <div class="row"><label>Performed<input type="date" name="performed_at" required></label><label>Valid until<input type="date" name="valid_until" required></label>
          <label>Outcome<select name="outcome"><option value="pass">pass</option><option value="adjusted_pass">adjusted, then pass</option><option value="fail">fail</option></select></label></div>
          <div class="row"><label>Provider<input name="provider"></label><label>Certificate reference<input name="certificate_ref"></label></div>
          <label>Certificate file <span class="hint">Upload under Attachments, then select</span><select name="attachment_id">${options(files, 'id', (f) => f.filename)}</select></label>
          <div><button>Record calibration</button></div></form>` : ''}
        <h2>Maintenance and service</h2>
        ${d.maintenance.length ? html`<ul class="timeline">${d.maintenance.map((m) => html`<li>${fmtDate(m.at)} — <b>${m.kind}</b>${m.notes ? html`: ${m.notes}` : ''}</li>`)}</ul>` : empty('None recorded.')}
        ${w ? html`<form method="post" action="/instruments/${i.id}/maintenance" class="stack panel">${csrfField(c)}<h3>Record maintenance</h3><div class="row"><label>Date<input type="date" name="at" required></label><label>Kind<input name="kind" required></label></div><label>Notes<input name="notes"></label><div><button class="secondary">Record</button></div></form>
          <form method="post" action="/instruments/${i.id}/status" class="stack panel">${csrfField(c)}<h3>Change status</h3><div class="row"><label>Status<select name="status">${['in_service', 'out_of_service', 'retired'].map((s) => html`<option value="${s}" ${s === i.status ? html`selected` : ''}>${label(s)}</option>`)}</select></label><label>Reason<input name="reason" required></label></div><div><button class="secondary">Update status</button></div></form>` : ''}
      </div><div>
        <h2>Recent use</h2>${d.usage.length ? html`<ul>${d.usage.map((u) => html`<li><a href="/samples/${u.id}">${u.sample_code}</a> <span class="small muted">${fmtDate(u.start_at)} · ${label(u.status)}</span></li>`)}</ul>` : empty('Not used yet.')}
        ${attachmentsBlock(c, 'instrument', i.id, files, w)}
      </div></div>`,
    };
  });
  action(app, '/instruments/:id/calibrations', async (c) => { await inst.recordCalibration(c.actor, c.params.id, c.body); return { to: `/instruments/${c.params.id}`, ok: 'Calibration recorded' }; });
  action(app, '/instruments/:id/maintenance', async (c) => { await inst.recordMaintenance(c.actor, c.params.id, c.body); return { to: `/instruments/${c.params.id}`, ok: 'Maintenance recorded' }; });
  action(app, '/instruments/:id/status', async (c) => { await inst.setInstrumentStatus(c.actor, c.params.id, c.body); return { to: `/instruments/${c.params.id}`, ok: 'Status updated' }; });
}
