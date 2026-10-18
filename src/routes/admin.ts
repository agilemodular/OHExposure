import type { FastifyInstance } from 'fastify';
import { ROLES } from '../authz.js';
import { can, requirePerm } from '../db.js';
import * as adm from '../services/admin.js';
import * as asmt from '../services/assessments.js';
import * as inst from '../services/instruments.js';
import * as integ from '../services/integrations.js';
import * as reg from '../services/register.js';
import { lookups, substanceLabel } from '../services/lookups.js';
import { methodCapabilities } from '../services/assurance.js';
import { provenanceBadge } from '../ui/html.js';
import { fmtDate, fmtDateTime, html, label } from '../ui/html.js';
import { csrfField, empty, options } from '../ui/layout.js';
import { action, api, page } from './kit.js';
import { authed } from './kit.js';

export function adminRoutes(app: FastifyInstance) {
  page(app, '/admin', async (c) => {
    requirePerm(c.actor, 'users.manage');
    const [u, gov, integrations, health] = await Promise.all([adm.listUsers(c.actor), adm.governance(c.actor), integ.integrationsOverview(c.actor), adm.systemHealth(c.actor)]);
    const temp = c.query.temp ? String(c.query.temp) : null;
    return {
      title: 'Organisation', sub: c.tenant.kind === 'consultancy' ? 'Consultancy account: client users see only their own client’s records.' : undefined,
      head: can(c.actor, 'export.data') ? html`<a class="btn secondary" href="/export">Export data (JSON)</a>` : '',
      body: html`
      ${temp ? html`<div class="flash warn">Temporary password: <code>${temp}</code><br>Share it with the user through a separate channel. It is not shown again. They will be asked to set up two-step verification at first sign-in.</div>` : ''}
      <h2>System health</h2>
      <div class="ledger"><section><dl>
        <dt>Accounts currently locked</dt><dd class="${health.security.locked_accounts ? 'attn' : 'zero'}">${health.security.locked_accounts}</dd>
        <dt>Active users without two-step verification</dt><dd class="${health.security.mfa_not_enrolled ? 'attn' : 'zero'}">${health.security.mfa_not_enrolled}</dd>
        <dt>Recent failed sign-in attempts (not yet cleared)</dt><dd class="${health.security.failed_logins_now ? 'attn' : 'zero'}">${health.security.failed_logins_now}</dd>
        <dt>Two-step failures in the last 24 hours</dt><dd class="${health.mfaFailures24h ? 'attn' : 'zero'}">${health.mfaFailures24h}</dd>
      </dl></section><section><dl>
        <dt>Integration messages failed or dead-lettered</dt><dd class="${health.integrationProblems ? 'attn' : 'zero'}">${health.integrationProblems}</dd>
        <dt>Open offline sync conflicts</dt><dd class="${health.openConflicts ? 'attn' : 'zero'}">${health.openConflicts}</dd>
        <dt>Disposal requests awaiting a decision</dt><dd class="${health.pendingDisposals ? 'attn' : 'zero'}">${health.pendingDisposals}</dd>
      </dl></section></div>
      <h2>Users</h2>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Client</th><th>Two-step</th><th>Status</th><th></th></tr></thead><tbody>
        ${u.users.map((x) => html`<tr><td>${x.name}</td><td>${x.email}</td><td>${label(x.role)}</td><td>${x.client_name ?? 'all'}</td><td>${x.mfa_enabled ? 'enabled' : html`<span class="badge b-warn">not set up</span>`}</td><td>${x.status}</td>
          <td>${x.id !== c.actor.userId ? html`<form method="post" action="/admin/users/${x.id}/status" class="inline-form">${csrfField(c)}<input type="hidden" name="status" value="${x.status === 'active' ? 'suspended' : 'active'}"><button class="secondary tiny">${x.status === 'active' ? 'Suspend' : 'Reactivate'}</button></form>
            <form method="post" action="/admin/users/${x.id}/mfa-reset" class="inline-form">${csrfField(c)}<button class="secondary tiny">Reset two-step</button></form>` : ''}</td></tr>`)}</tbody></table></div>
      <form method="post" action="/admin/users" class="stack panel">${csrfField(c)}<h3>Add a user</h3>
        <div class="row"><label>Name<input name="name" required></label><label>Email<input type="email" name="email" required></label>
        <label>Role<select name="role">${ROLES.map((r) => html`<option value="${r}">${label(r)}</option>`)}</select></label>
        <label>Client <span class="hint">Client read-only users only</span><select name="client_id">${options(u.clients, 'id', (x) => x.name, null, '— all clients —')}</select></label></div>
        <div><button>Add user</button></div></form>
      ${c.tenant.kind === 'consultancy' ? html`<h2>Clients</h2><ul>${u.clients.map((x) => html`<li>${x.name}</li>`)}</ul>
        <form method="post" action="/admin/clients" class="actions-row panel">${csrfField(c)}<input name="name" placeholder="Client name" required><button class="secondary">Add client</button></form>` : ''}
      <h2>Retention</h2>
      <p class="small muted">Set retention periods on advice. Records are not deleted automatically: disposal of identifiable data or files needs a request and approval by a second person.</p>
      ${gov.retention.length ? html`<ul>${gov.retention.map((r) => html`<li>${label(r.record_class)}: ${r.retain_years} years — ${r.basis}</li>`)}</ul>` : empty('No retention periods set.')}
      <form method="post" action="/admin/retention" class="stack panel">${csrfField(c)}<div class="row"><label>Record class<select name="record_class">${['worker_identity', 'attachment', 'audit_event', 'sampling_record'].map((x) => html`<option value="${x}">${label(x)}</option>`)}</select></label>
        <label>Years<input type="number" name="retain_years" min="1" max="100" required></label></div><label>Basis<input name="basis" required placeholder="Legal or policy basis for this period"></label><div><button class="secondary">Save retention period</button></div></form>
      <h2>Disposal requests</h2>
      ${gov.disposals.length ? html`<div class="tablewrap"><table><thead><tr><th>Record</th><th>Reason</th><th>Requested</th><th>Status</th><th></th></tr></thead><tbody>
        ${gov.disposals.map((d) => html`<tr><td>${label(d.record_class)} <code>${d.entity_id.slice(0, 8)}</code></td><td>${d.reason}</td><td>${fmtDateTime(d.requested_at)} ${d.requested_by_name}</td><td>${label(d.status)}${d.decided_by_name ? ` (${d.decided_by_name})` : ''}</td>
          <td>${d.status === 'pending' && can(c.actor, 'disposal.approve') && d.requested_by !== c.actor.userId ? html`<form method="post" action="/admin/disposals/${d.id}" class="stack">${csrfField(c)}<input name="notes" placeholder="Decision notes" required><div class="actions-row"><button name="decision" value="approved" class="danger tiny">Approve disposal</button><button name="decision" value="rejected" class="secondary tiny">Reject</button></div></form>` : ''}</td></tr>`)}</tbody></table></div>` : empty('No disposal requests.')}
      <h2>Assurentra integrations</h2>
      <p class="small muted">Optional and versioned. This product works fully without them. No live connection has been built or tested: enabled links run in mock mode and record outbound messages locally without sending anything.</p>
      <div class="tablewrap"><table><thead><tr><th>Product</th><th>Contracts</th><th>Link</th></tr></thead><tbody>
        ${Object.entries(integ.CONTRACTS).map(([t, cs]) => { const l = integrations.links.find((x) => x.target === t); return html`<tr><td>${label(t)}</td><td>${Object.entries(cs).map(([k, v]: any) => html`<code>${k}</code> v${v.version} — ${v.purpose}<br>`)}</td>
          <td>${l ? html`${l.enabled ? html`<span class="badge b-warn">Enabled — mock</span>` : 'Disabled'}<br><span class="small muted">${l.external_tenant_ref}</span>` : 'Not linked'}</td></tr>`; })}</tbody></table></div>
      <form method="post" action="/admin/integrations" class="stack panel">${csrfField(c)}<div class="row"><label>Product<select name="target">${Object.keys(integ.CONTRACTS).map((t) => html`<option value="${t}">${label(t)}</option>`)}</select></label>
        <label>Tenant reference in that product<input name="external_tenant_ref" required></label></div><label class="check"><input type="checkbox" name="enabled" value="on"> Enabled (mock mode)</label><div><button class="secondary">Save link</button></div></form>
      ${integrations.outbox.length ? html`<h3>Outbound messages</h3><div class="actions-row"><form method="post" action="/admin/integrations/deliver">${csrfField(c)}<button class="secondary tiny">Run delivery now</button></form></div>
        <div class="tablewrap"><table><thead><tr><th>Target</th><th>Contract</th><th>Event</th><th>Status</th><th>Attempts</th><th>Created</th></tr></thead><tbody>
        ${integrations.outbox.map((o) => html`<tr><td>${o.target}</td><td>${o.contract} v${o.contract_version}</td><td>${o.event_type}</td><td>${o.status === 'mock_recorded' ? html`<span class="badge b-warn">mock — not transmitted</span>` : label(o.status)}${o.last_error ? html`<br><span class="small">${o.last_error}</span>` : ''}</td><td>${o.attempts}</td><td>${fmtDateTime(o.created_at)}</td></tr>`)}</tbody></table></div>` : ''}`,
    };
  });
  action(app, '/admin/users', async (c) => { const r = await adm.createUser(c.actor, c.body); return { to: `/admin?temp=${encodeURIComponent(r.temporaryPassword)}`, ok: `User ${r.user.email} added` }; });
  action(app, '/admin/users/:id/status', async (c) => { await adm.setUserStatus(c.actor, c.params.id, c.body); return { to: '/admin', ok: 'User status updated' }; });
  action(app, '/admin/users/:id/mfa-reset', async (c) => { await adm.resetMfa(c.actor, c.params.id); return { to: '/admin', ok: 'Two-step verification reset; the user must enrol again' }; });
  action(app, '/admin/clients', async (c) => { await adm.createClient(c.actor, c.body); return { to: '/admin', ok: 'Client added' }; });
  action(app, '/admin/retention', async (c) => { await adm.setRetention(c.actor, c.body); return { to: '/admin', ok: 'Retention period saved' }; });
  action(app, '/admin/disposals/:id', async (c) => { await adm.decideDisposal(c.actor, c.params.id, c.body); return { to: '/admin', ok: 'Decision recorded' }; });
  action(app, '/admin/integrations', async (c) => { await integ.upsertLink(c.actor, c.body); return { to: '/admin', ok: 'Integration link saved (mock mode)' }; });
  action(app, '/admin/integrations/deliver', async (c) => { const r = await integ.deliverPending(c.actor); return { to: '/admin', ok: `Delivery run: ${r.mock} recorded by mock transport, ${r.failed} failed. Nothing was transmitted.` }; });
  action(app, '/disposals', async (c) => { await adm.requestDisposal(c.actor, c.body); return { to: '/admin', ok: 'Disposal requested; a second person must approve it' }; });

  app.get('/export', async (req, reply) => {
    const si = await authed(req, reply);
    if (!si) return reply;
    try {
      const data = await adm.exportData(si.actor);
      return reply.type('application/json').header('Content-Disposition', `attachment; filename="export-${new Date().toISOString().slice(0, 10)}.json"`).send(JSON.stringify(data, null, 1));
    } catch (e: any) { if (e.status) return reply.code(e.status).send(e.message); throw e; }
  });

  page(app, '/audit', async (c) => {
    const rows = await adm.auditLog(c.actor, { entity_id: c.query.entity || undefined });
    return {
      title: 'Audit history', sub: 'Append-only record of sign-ins, changes, approvals, downloads and exports.',
      body: html`<form method="get" class="actions-row"><input name="entity" placeholder="Filter by record id" value="${c.query.entity ?? ''}"><button class="secondary">Filter</button></form>
        <div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td>${fmtDateTime(r.at)}</td><td>${r.user_name ?? '—'}</td><td>${r.action}</td><td>${r.entity_type ?? ''} ${r.entity_id ? html`<a href="/audit?entity=${r.entity_id}"><code>${String(r.entity_id).slice(0, 8)}</code></a>` : ''}</td>
          <td><code class="small">${JSON.stringify(r.detail).slice(0, 220)}</code></td></tr>`)}</tbody></table></div>`,
    };
  });

  page(app, '/reference', async (c) => {
    const [bm, methods, lk, caps] = await Promise.all([asmt.listBenchmarks(c.actor), inst.listMethodVersions(c.actor), lookups(c.actor), methodCapabilities(c.actor)]);
    const capLabel = (s: string) => s === 'approved' ? 'Approved for pilot conclusions' : s === 'approved_with_conditions' ? 'Approved with conditions' : s === 'rejected' ? 'Rejected — unavailable' : 'Not reviewed';
    return {
      title: 'Benchmarks and methods',
      sub: 'Exposure benchmarks are versioned with their source. Only verified versions can be used for comparison, and approved assessments keep the version they used.',
      body: html`
      <div class="note">No real exposure limits are pre-loaded. Rows marked synthetic exist only for demonstration and testing. Enter limits from the current authoritative publication and have a second person verify them.</div>
      <h2>Calculation methods</h2>
      <p class="small muted">Review decisions are recorded by a platform operator from a competent occupational hygienist's signed review. Organisation administrators cannot change them. ${caps.controls.assuranceLevel === 'pilot' ? 'This organisation is in an authorised pilot: only approved methods can support approved conclusions.' : 'Outside an authorised pilot, unreviewed methods can be calculated but every output states that they are not reviewed.'}</p>
      <div class="tablewrap"><table><thead><tr><th>Calculation</th><th>Version</th><th>Professional review</th><th>Reviewer</th><th>Usable for pilot conclusions</th></tr></thead><tbody>
        ${caps.rows.map((m) => html`<tr><td>${m.label} <span class="small muted">(${m.averagingMinutes}-min reference)</span></td><td>${m.code} v${m.version}</td>
          <td><span class="badge ${m.pilotEnabled ? 'b-ok' : m.status === 'rejected' ? 'b-bad' : 'b-warn'}">${capLabel(m.status)}</span>${m.conditions ? html`<br><span class="small">${m.conditions}</span>` : ''}</td>
          <td>${m.reviewer ? html`${m.reviewer}<br><span class="small muted">${fmtDate(m.reviewedOn)} · ${m.evidenceRef}</span>` : html`<span class="muted">—</span>`}</td><td>${m.pilotEnabled ? 'Yes' : 'No'}</td></tr>`)}</tbody></table></div>
      <h2>Exposure benchmarks</h2>
      ${bm.length ? html`<div class="tablewrap"><table><thead><tr><th>Substance</th><th>Benchmark</th><th>Value</th><th>Source</th><th>Effective</th><th>Verification</th></tr></thead><tbody>
        ${bm.map((b) => html`<tr id="bv-${b.id}"><td>${b.substance_name}${b.cas_number ? html`<br><span class="small muted">CAS ${b.cas_number}</span>` : ''}</td><td>${b.jurisdiction} ${b.benchmark_type}<br><span class="small muted">${b.averaging_minutes}-min reference</span></td>
          <td>${b.value} ${b.unit}${b.annotations?.length ? html`<br><span class="small">${b.annotations.join(', ')}</span>` : ''}${b.is_synthetic ? html` <span class="synthetic">synthetic</span>` : ''}</td>
          <td>${b.source_url ? html`<a href="${b.source_url}" rel="noopener noreferrer">${b.source_title}</a>` : b.source_title}<br><span class="small muted">${b.source_version}</span><br>${provenanceBadge(b)}</td>
          <td>${fmtDate(b.effective_from)}${b.effective_to ? html` – ${fmtDate(b.effective_to)}` : ''}</td>
          <td>${b.verification_status === 'verified' ? html`verified<br><span class="small muted">${b.verified_by}</span>` : html`<span class="badge ${b.verification_status === 'withdrawn' ? 'b-neutral' : 'b-warn'}">${b.verification_status}</span>`}
            ${!b.platform && can(c.actor, 'benchmark.verify') && b.verification_status === 'unverified' ? html`<form method="post" action="/reference/benchmarks/${b.id}/verify" class="stack">${csrfField(c)}<input name="note" placeholder="Checked against (publication, page)" required><div class="actions-row"><button name="status" value="verified" class="tiny">Verify</button><button name="status" value="withdrawn" class="secondary tiny">Withdraw</button></div></form>` : ''}</td></tr>`)}</tbody></table></div>` : empty('No benchmarks.')}
      ${can(c.actor, 'benchmark.write') ? html`<details class="panel"><summary>Enter a benchmark version</summary><form method="post" action="/reference/benchmarks" class="stack">${csrfField(c)}
        <div class="row"><label>Substance<select name="substance_id" required>${options(lk.substances, 'id', substanceLabel)}</select></label><label>Jurisdiction<input name="jurisdiction" required placeholder="e.g. GB"></label>
        <label>Type<input name="benchmark_type" required placeholder="e.g. WEL-LTEL"></label><label>Averaging period (min)<input type="number" name="averaging_minutes" required placeholder="480"></label></div>
        <div class="row"><label>Value<input type="number" step="any" min="0" name="value" required></label><label>Unit<select name="unit"><option>mg/m3</option><option>ppm</option><option>f/ml</option></select></label>
        <label>Annotations<select name="annotations" multiple size="3"><option>Sk</option><option>Sen</option><option>Carc</option><option>BMGV</option></select></label></div>
        <div class="row"><label>Source title<input name="source_title" required></label><label>Source edition / version<input name="source_version" required></label><label>Source URL<input type="url" name="source_url"></label></div>
        <div class="row"><label>Effective from<input type="date" name="effective_from" required></label><label>Effective to<input type="date" name="effective_to"></label></div>
        <p class="small muted">Check you have the right to reproduce the source before entering values from proprietary limit databases.</p><div><button>Save (unverified)</button></div></form></details>` : ''}
      <h2>Sampling and analytical methods</h2>
      ${methods.length ? html`<div class="tablewrap"><table><thead><tr><th>Method</th><th>Version</th><th>Flow range</th><th>Flow tolerance</th><th>Result basis</th><th>Designation</th></tr></thead><tbody>
        ${methods.map((m) => html`<tr><td>${m.code} — ${m.title}<br><span class="small muted">${m.source_reference}</span></td><td>${m.version}</td><td>${m.flow_rate_lpm_min ?? '—'}–${m.flow_rate_lpm_max ?? '—'} L/min</td><td>${m.flow_drift_tolerance_pct != null ? `${m.flow_drift_tolerance_pct}%` : html`<span class="badge b-warn">not defined</span>`}</td><td>${label(m.result_basis)}</td><td>${m.suitable_for_formal_assessment ? 'formal' : html`<span class="tag tag-q">indicative only</span>`}</td></tr>`)}</tbody></table></div>` : empty('No methods.')}
      ${can(c.actor, 'benchmark.write') ? html`<details class="panel"><summary>Add a method version</summary><form method="post" action="/reference/methods" class="stack">${csrfField(c)}
        <div class="row"><label>Code<input name="code" required></label><label>Version<input name="version" required></label><label>Title<input name="title" required></label></div>
        <label>Source reference<input name="source_reference" required></label>
        <div class="row"><label>Collection media<input name="collection_media"></label><label>Min flow (L/min)<input type="number" step="any" name="flow_rate_lpm_min"></label><label>Max flow (L/min)<input type="number" step="any" name="flow_rate_lpm_max"></label>
        <label>Flow drift tolerance (%)<input type="number" step="any" name="flow_drift_tolerance_pct"></label><label>Minimum volume (L)<input type="number" step="any" name="min_volume_l"></label></div>
        <div class="row"><label>Result basis<select name="result_basis"><option value="mass_on_sample">mass on sample</option><option value="concentration">concentration</option></select></label></div>
        <label class="check"><input type="checkbox" name="suitable_for_formal_assessment" value="on" checked> Suitable for formal exposure assessment</label><div><button>Add method version</button></div></form></details>` : ''}
      <h2 id="substances">Substances</h2>
      <p>${lk.substances.map((s) => html`${substanceLabel(s)}${s.molecular_weight ? html` <span class="small muted">MW ${s.molecular_weight} g/mol</span>` : ''}<br>`)}</p>
      <p class="small muted">Molecular weight is used only to convert between ppm and mg/m³ at 20 °C and 101.325 kPa when a result and benchmark use different units.</p>
      ${can(c.actor, 'register.write') ? html`<form method="post" action="/reference/substances" class="actions-row panel">${csrfField(c)}<input name="name" placeholder="Substance name" required><input name="cas_number" placeholder="CAS number"><input name="ec_number" placeholder="EC number"><input type="number" step="any" min="0" name="molecular_weight" placeholder="Molecular weight g/mol"><input name="molecular_weight_source" placeholder="Source of molecular weight"><button class="secondary">Add substance</button></form>` : ''}`,
    };
  });
  action(app, '/reference/benchmarks', async (c) => { await asmt.createBenchmarkVersion(c.actor, c.body); return { to: '/reference', ok: 'Benchmark saved as unverified. A second person must verify it before use.' }; });
  action(app, '/reference/benchmarks/:id/verify', async (c) => { await asmt.verifyBenchmarkVersion(c.actor, c.params.id, c.body); return { to: '/reference', ok: 'Benchmark verification recorded' }; });
  action(app, '/reference/methods', async (c) => { await inst.createMethodVersion(c.actor, c.body); return { to: '/reference', ok: 'Method version added' }; });
  action(app, '/reference/substances', async (c) => { await reg.createSubstance(c.actor, c.body); return { to: '/reference#substances', ok: 'Substance added' }; });
  void api;
}
