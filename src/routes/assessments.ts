import { METHOD_APPROVED } from '../services/assurance.js';
import type { FastifyInstance } from 'fastify';
import { can } from '../db.js';
import * as asmt from '../services/assessments.js';
import * as ctl from '../services/controls.js';
import * as rep from '../services/reports.js';
import * as ai from '../services/ai.js';
import { lookups, substanceLabel } from '../services/lookups.js';
import { config } from '../config.js';
import { evidenceStrip, fmtDate, fmtDateTime, fmtNum, html, interval, label } from '../ui/html.js';
import { csrfField, empty, options, type PageCtx } from '../ui/layout.js';
import { action, back, page } from './kit.js';
import { evidenceFacts, factualSummary, narrativeChecks } from '../services/narrative.js';
import { usage } from '../services/usage.js';
import { STEL_REMAINDER_EVIDENCE } from '../calc/engine.js';
import { authed } from './kit.js';

const CONCLUSIONS = [['insufficient_evidence', 'Insufficient evidence to conclude'], ['improvement_required', 'Improvement required'], ['urgent_action_required', 'Urgent action required'], ['exposure_adequately_controlled', 'Exposure adequately controlled (professional judgement)']];

function calcOutput(out: any, dispo?: { c: PageCtx; revId: string; samples: any[] } | null) {
  if (!out) return empty('Not calculated yet. Save the draft inputs, then run the calculation.');
  const facts = evidenceFacts(out);
  return html`
    <p><b>Summary (from the records):</b> ${factualSummary(facts, out.calcCode)}</p>
    ${out.calculationAvailability ? html`<dl class="kv"><dt>Calculation availability</dt><dd>${label(out.calculationAvailability)}</dd><dt>Evidence adequacy</dt><dd>${label(out.evidenceAdequacy)}</dd><dt>Overall comparison</dt><dd>${label(out.benchmarkState)}</dd></dl>` : ''}
    <h3>Per-sample concentrations</h3>
    <div class="tablewrap"><table><thead><tr><th>Sample</th><th>Type</th><th>Subject</th><th class="num">Sampled min</th><th class="num">Volume L</th><th>Concentration</th><th>In calculation</th><th>In formal comparison</th></tr></thead><tbody>
    ${out.samples.map((s: any) => { const u = usage(out, s); return html`<tr><td>${s.sampleCode}</td><td>${label(s.sampleType)}</td><td>${s.subjectRef ?? '—'}</td><td class="num">${fmtNum(s.sampledMinutes)}</td><td class="num">${fmtNum(s.volumeL)}</td>
      <td>${interval(s.concentration)}${s.indicative ? html` <span class="tag tag-q">indicative</span>` : ''}${s.included ? '' : html` <span class="badge b-bad">Excluded</span>`}</td><td>${u.calculation}</td><td>${u.formal}</td></tr>`; })}</tbody></table></div>
    ${out.unresolvedEvidence?.length ? html`<h3>Evidence not used formally</h3><p class="small">Until each sample below has a disposition, no favourable overall comparison is possible.</p><ul class="issues">${out.unresolvedEvidence.map((u: any) => html`<li class="sev-${u.disposition === 'not_replaced' ? 'incomplete' : 'exclude'}"><b>${u.sampleCode}</b> (${u.subjectRef ?? '—'}): ${u.why}${u.reasons?.length ? html`<br><span class="small">Findings: ${u.reasons.join(' ')}</span>` : ''}${u.rejectedDisposition ? html`<br><span class="small">Disposition recorded but <b>not accepted</b>${u.rejectedDisposition.conflict ? ' (conflicting results)' : ''}: ${label(u.rejectedDisposition.kind)}${u.rejectedDisposition.duplicateType ? ` — ${label(u.rejectedDisposition.duplicateType)}` : ''}${u.rejectedDisposition.relatedSampleCode ? ` of ${u.rejectedDisposition.relatedSampleCode}` : ''}, by ${u.rejectedDisposition.by}: "${u.rejectedDisposition.reason}"</span>` : ''}</li>`)}</ul>
      ${dispo ? html`<details class="panel"><summary>Record an evidence disposition</summary><form method="post" action="/assessments/rev/${dispo.revId}/disposition" class="stack">${csrfField(dispo.c)}
        <div class="row"><label>Sample<select name="sample_id" required>${dispo.samples.filter((x: any) => out.unresolvedEvidence.some((u: any) => u.sampleCode === x.sample_code)).map((x: any) => html`<option value="${x.id}">${x.sample_code}</option>`)}</select></label>
        <label>Disposition<select name="kind"><option value="duplicate">Duplicate (same sampling event, or paired sampler)</option><option value="not_replaced">Not replaced — the worker or task remains unassessed</option>${can(dispo.c.actor, 'assess.approve') ? html`<option value="outside_scope">Outside the scope of this assessment (reviewer)</option><option value="remaining_coverage_adequate">Remaining coverage adequate (reviewer judgement)</option>` : ''}</select></label>
        <label>Duplicate of<select name="related_sample_id"><option value="">—</option>${dispo.samples.map((x: any) => html`<option value="${x.id}">${x.sample_code}</option>`)}</select></label>
        <label>Duplicate category <span class="hint">A different sample offered as adequate remaining coverage is not a duplicate</span><select name="duplicate_type"><option value="">—</option><option value="same_event_record">Second record of the same sampling event (same worker, instrument, window)</option><option value="paired_colocated">Paired / co-located sampler (same pair reference recorded at capture)</option></select></label></div>
        <label>Reason<textarea name="reason" required minlength="10"></textarea></label><label>Consequences for this assessment<textarea name="consequence" required minlength="10" placeholder="Which worker, task or period is affected, and what remains covered"></textarea></label><div><button class="secondary">Record disposition</button></div></form></details>` : ''}` : ''}
    ${out.calcCode === 'stel_15' ? html`<h3>15-minute short-term results</h3>` : html`<h3>8-hour TWA by worker and shift</h3>`}
    ${out.shifts.length ? html`<div class="tablewrap"><table><thead><tr><th>Worker</th><th>${out.calcCode === 'stel_15' ? 'Date' : 'Shift'}</th><th>Samples</th><th class="num">${out.calcCode === 'stel_15' ? 'Sampled min' : 'Coverage'}</th><th>${out.calcCode === 'stel_15' ? '15-min value' : '8-h TWA'}</th><th>Benchmark comparison</th></tr></thead><tbody>
      ${out.shifts.map((s: any) => html`<tr><td>${s.subjectRef}</td><td>${s.shiftDate}</td><td>${s.sampleCodes.join(', ')}</td><td class="num">${out.calcCode === 'stel_15' ? fmtNum(s.sampledMinutes) : html`${fmtNum(s.coveragePct)}%`}</td><td>${interval(s.result ?? s.twa8h)}${s.comparison?.converted ? html`<br><span class="small muted">≈ ${interval(s.comparison.converted)}</span>` : ''}</td>
        <td>${s.comparison ? html`${label(s.comparison.state)}${s.comparison.ratio ? html` <span class="small muted">(${fmtNum(s.comparison.ratio.lower)}${s.comparison.ratio.upper !== s.comparison.ratio.lower ? html`–${fmtNum(s.comparison.ratio.upper)}` : ''} × benchmark)</span>` : ''}` : html`<span class="muted">not compared</span>`}</td></tr>`)}</tbody></table></div>` : empty('No personal worker-shift results.')}
    ${out.setAsideEvidence?.length ? html`<h3>Evidence set aside by disposition</h3><ul>${out.setAsideEvidence.map((x: any) => html`<li><b>${x.sampleCode}</b> (${x.subjectRef ?? '—'}): ${label(x.kind)}${x.duplicateType ? html` — ${label(x.duplicateType)} of ${x.relatedSampleCode}${x.relatedInterval ? html` [retained: ${interval(x.relatedInterval)}]` : ''}` : ''} — ${x.by}: ${x.reason}${x.interval ? html` [${interval(x.interval)}]` : ''}${x.consequence ? html`<br><span class="small">Consequences: ${x.consequence}</span>` : ''}</li>`)}</ul>` : ''}
    ${out.staticSamples.length ? html`<p class="note">Static samples are shown as contextual evidence only and are never compared with personal exposure benchmarks.</p>` : ''}
    <p><b>Benchmark:</b> ${out.benchmarkNote}</p>
    ${out.issues.length ? html`<h3>Data quality findings</h3><ul class="issues">${out.issues.map((f: any) => html`<li class="sev-${f.severity}"><b>${label(f.severity)}</b> — ${f.message}</li>`)}</ul>` : html`<p class="muted">No data quality findings.</p>`}
    <p class="small muted">${out.calcCode} v${out.calcVersion}, engine ${out.engineVersion}. ${out.disclaimer}</p>`;
}

function draftForm(c: PageCtx, d: any) {
  const r = d.current; const p = r.parameters ?? {};
  return html`<form method="post" action="/assessments/rev/${r.id}/draft" class="stack panel">${csrfField(c)}<h2>Draft inputs</h2>
    <fieldset class="panel"><legend>Samples included</legend>
      ${d.candidates.length ? d.candidates.map((s: any) => html`<label class="check"><input type="checkbox" name="sample_ids" value="${s.id}" ${r.sample_ids.includes(s.id) ? html`checked` : ''}> ${s.sample_code} — ${label(s.sample_type)}, ${s.ref_code ?? 'no worker'}, ${fmtDate(s.start_at)} <span class="small muted">(${label(s.status)})</span></label>`) : html`<p class="muted">No samples for this substance.</p>`}
      <label>Reason for removing samples <span class="hint">Required if you untick a sample that is in the list. A removal takes effect only when a technical reviewer confirms it; until then the sample stays in the evidence.</span><input name="removal_reason"></label>
    </fieldset>
    <label>Calculation<select name="calc_code">
      <option value="twa_8h" ${r.calc_code !== 'stel_15' ? html`selected` : ''}>8-hour time-weighted average (long-term benchmark, 480 min)</option>
      <option value="stel_15" ${r.calc_code === 'stel_15' ? html`selected` : ''}>15-minute short-term exposure (short-term benchmark, 15 min)</option></select></label>
    <label>Benchmark version<select name="benchmark_version_id">${options(d.benchmarks, 'id', (b: any) => `${b.jurisdiction} ${b.benchmark_type} ${b.value} ${b.unit} — ${b.source_version} (${b.verification_status}; ${b.provenance === 'professional_reference' ? 'professional reference' : b.provenance === 'synthetic' ? 'SYNTHETIC' : 'entered by organisation'})`, r.benchmark_version_id, '— no benchmark —')}</select></label>
    <div class="row"><label>Exposure duration per shift (min) <span class="hint">From task records; required for an 8-hour TWA</span><input type="number" min="1" name="exposure_minutes_per_shift" value="${p.exposureMinutesPerShift ?? ''}"></label>
    <label>Unsampled exposure time<select name="unsampled_assumption">
      <option value="none" ${p.unsampledAssumption === 'none' ? html`selected` : ''}>No assumption — do not calculate a TWA if coverage is incomplete</option>
      <option value="zero_exposure" ${p.unsampledAssumption === 'zero_exposure' ? html`selected` : ''}>Assume no exposure during unsampled time</option>
      <option value="same_as_sampled" ${p.unsampledAssumption === 'same_as_sampled' ? html`selected` : ''}>Assume the sampled mean applies to unsampled time</option></select></label></div>
    <label>Justification for the unsampled-time assumption <span class="hint">Required for either assumption; it is printed in the report</span><textarea name="unsampled_justification">${p.unsampledJustification ?? ''}</textarea></label>
    <fieldset class="panel"><legend>15-minute calculation only</legend>
      <label>Samples shorter than 15 minutes<select name="short_sample_assumption">
        <option value="none" ${p.shortSampleAssumption !== 'zero_remainder' ? html`selected` : ''}>No assumption — do not calculate</option>
        <option value="zero_remainder" ${p.shortSampleAssumption === 'zero_remainder' ? html`selected` : ''}>Assume no exposure for the rest of the 15 minutes</option></select></label>
      <label>Justification for the short-sample assumption<textarea name="short_sample_justification">${p.shortSampleJustification ?? ''}</textarea></label>
      <div class="row"><label>Supporting evidence for zero exposure in the rest of the period<select name="short_sample_evidence_basis"><option value="">— none —</option>${STEL_REMAINDER_EVIDENCE.map((b) => html`<option value="${b}" ${p.shortSampleEvidenceBasis === b ? html`selected` : ''}>${label(b)}</option>`)}</select></label>
      <label>Evidence reference<input name="short_sample_evidence_ref" value="${p.shortSampleEvidenceRef ?? ''}" placeholder="e.g. observation log, instrument record"></label></div>
      <p class="small muted">Only an uninterrupted sample of exactly 15 minutes gives a direct result. Shorter or interrupted samples need the assumption, a justification and supporting evidence (completion of the task alone is not evidence); the result is marked assumption-dependent. Samples longer than 15 minutes cannot be used for a short-term result.</p></fieldset>
    <h3>Professional interpretation</h3>
    <label>Interpretation<textarea name="interpretation" rows="5">${r.interpretation ?? ''}</textarea></label>
    <label>Conclusion<select name="conclusion_category">${options(CONCLUSIONS.map(([v, l]) => ({ v, l })), 'v', (x: any) => x.l, r.conclusion_category, '— select —')}</select></label>
    <label>Limitations and uncertainty<textarea name="limitations">${r.limitations ?? ''}</textarea></label>
    <div class="actions-row"><button>Save draft</button><span class="small muted">Saving clears the previous calculation; run it again afterwards.</span></div></form>`;
}

export function assessmentRoutes(app: FastifyInstance) {
  page(app, '/assessments', async (c) => {
    const [list, lk] = await Promise.all([asmt.listAssessments(c.actor), lookups(c.actor)]);
    return {
      title: 'Assessments', sub: 'Each assessment keeps data quality, benchmark comparison and professional review as separate states.',
      body: html`${list.length ? html`<div class="tablewrap"><table><thead><tr><th>Assessment</th><th>Group</th><th>States</th><th>Conclusion</th></tr></thead><tbody>
        ${list.map((a) => html`<tr><td><a href="/assessments/${a.id}">${a.title}</a><br><span class="small muted">${a.substance_name} · r${a.current_revision}</span></td><td>${a.group_name}</td>
          <td>${evidenceStrip(a.data_quality_state, a.benchmark_state, a.status)}</td><td>${a.conclusion_category ? label(a.conclusion_category) : '—'}</td></tr>`)}</tbody></table></div>` : empty('No assessments yet.')}
        ${can(c.actor, 'assess.write') ? html`<details class="panel" ${list.length ? '' : html`open`}><summary>Start an assessment</summary><form method="post" action="/assessments" class="stack">${csrfField(c)}
          <div class="row"><label>Exposure group<select name="group_id" required>${options(lk.groups, 'id', (g) => `${g.name} (${g.site_name})`)}</select></label>
          <label>Substance<select name="substance_id" required>${options(lk.substances, 'id', substanceLabel)}</select></label></div>
          <label>Title<input name="title" required></label><label>Assessment question<textarea name="assessment_question" required></textarea></label>
          <div><button>Start assessment</button></div><p class="small muted">Analysed samples for this group and substance are pre-selected; you can change the selection.</p></form></details>` : ''}`,
    };
  });
  action(app, '/assessments', async (c) => { const r = await asmt.createAssessment(c.actor, c.body); return { to: `/assessments/${r.assessment.id}`, ok: 'Assessment started' }; });

  page(app, '/assessments/:id', async (c) => {
    const d = await asmt.assessmentDetail(c.actor, c.params.id);
    const a = d.assessment; const r = d.current;
    const lk = await lookups(c.actor);
    const isDraft = r?.status === 'draft';
    const btn = (path: string, text: string, cls = '') => html`<form method="post" action="${path}" class="inline-form">${csrfField(c)}<button class="${cls}">${text}</button></form>`;
    const suggestions = r && isDraft ? await ai.listSuggestions(c.actor, r.id) : [];
    return {
      title: a.title, crumbs: [['Assessments', '/assessments'], ['Assessment']],
      sub: html`${a.substance_name}${a.cas_number ? ` (CAS ${a.cas_number})` : ''} · <a href="/groups/${a.group_id}">${a.group_name}</a> · revision ${r.revision}`,
      head: evidenceStrip(r.data_quality_state, r.benchmark_state, r.status),
      body: html`
      <p><b>Question:</b> ${a.assessment_question}</p>
      ${r.change_reason ? html`<p class="small muted">Revision ${r.revision} reason: ${r.change_reason}</p>` : ''}
      ${d.staleCurrent.length ? html`<div class="flash warn" role="status"><b>Evidence has changed.</b><ul>${d.staleCurrent.map((s) => html`<li>${s}</li>`)}</ul>${r.status === 'approved' ? 'The approved conclusion is unchanged; create a new revision to reassess.' : 'Recalculate before submitting.'}</div>` : ''}
      ${d.approved && d.approved.id !== r.id ? html`<div class="note">Revision ${d.approved.revision} remains the approved assessment (${fmtDate(d.approved.approved_at)}) until this revision is approved. ${d.staleApproved.length ? html`<br><b>Note:</b> ${d.staleApproved.join(' ')}` : ''}</div>` : ''}

      <div class="actions-row no-print">
        ${isDraft && can(c.actor, 'assess.write') ? html`${btn(`/assessments/rev/${r.id}/calculate`, 'Run calculation')}${r.calc_output ? btn(`/assessments/rev/${r.id}/submit`, 'Submit for review', 'secondary') : ''}` : ''}
        ${!['draft', 'in_review'].includes(r.status) && can(c.actor, 'assess.write') ? html`<details><summary class="btn secondary">Create new revision</summary><form method="post" action="/assessments/${a.id}/revise" class="stack panel">${csrfField(c)}<label>Reason for revision<input name="change_reason" required></label><button>Create revision</button></form></details>` : ''}
        ${can(c.actor, 'reports.generate') && r.calc_output ? btn(`/assessments/${a.id}/report/${r.id}`, r.status === 'approved' ? 'Issue report' : 'Generate draft report', 'secondary') : ''}
      </div>

      ${r.status === 'in_review' && can(c.actor, 'assess.approve') ? html`<section class="panel"><h2>Professional review</h2>
        <p class="small">Approval records your identity, the time, the scope and the limitations, and freezes the evidence, calculation and benchmark version used. You cannot approve an assessment you authored or submitted.</p>
        <form method="post" action="/assessments/rev/${r.id}/approve" class="stack">${csrfField(c)}
          <label>Scope of approval<textarea name="approval_scope" required placeholder="Which workers, tasks, period and substance this conclusion covers"></textarea></label>
          <label>Limitations<textarea name="approval_limitations" required></textarea></label>
          <label class="check"><input type="checkbox" name="confirm_reviewed" value="on" required> I have reviewed the sampling evidence, data quality findings, calculation and interpretation.</label>
          <div><button>Approve revision ${r.revision}</button></div></form>
        <form method="post" action="/assessments/rev/${r.id}/return" class="stack">${csrfField(c)}<label>Return to author with notes<textarea name="notes" required></textarea></label><div><button class="secondary">Return to draft</button></div></form></section>` : ''}
      ${r.status === 'approved' ? html`<section class="panel"><h2>Approval</h2><dl class="kv"><dt>Approved by</dt><dd>${r.reviewer_name}</dd><dt>When</dt><dd>${fmtDateTime(r.approved_at)}</dd>
        <dt>Scope</dt><dd>${r.approval_scope}</dd><dt>Limitations</dt><dd>${r.approval_limitations}</dd><dt>Record hash</dt><dd><code>${r.snapshot_hash}</code></dd></dl></section>` : ''}

      <h2>Calculation</h2>
      ${d.method ? html`<p>${METHOD_APPROVED.has(d.method.status)
        ? html`<span class="badge b-ok">Method approved${d.method.status === 'approved_with_conditions' ? ' with conditions' : ''}</span> <span class="small muted">${d.method.reviewer}, ${fmtDate(d.method.reviewedOn)}${d.method.conditions ? ` — ${d.method.conditions}` : ''}</span>`
        : d.method.status === 'rejected' ? html`<span class="badge b-bad">Method rejected by professional review — unavailable for conclusions</span>`
        : html`<span class="badge b-warn">Method not reviewed</span> <span class="small">${d.controls.assuranceLevel === 'pilot' ? 'Results are shown for reconciliation only; this revision cannot be submitted or approved until the method is approved.' : 'Results are for discussion only and are labelled as unreviewed in reports.'}</span>`}</p>` : ''}
      ${d.removals?.length ? html`<section class="panel"><h3>Samples removed from the sample list</h3><ul class="issues">${d.removals.map((x: any) => html`<li class="sev-${x.status === 'confirmed' ? 'info' : 'incomplete'}"><b>${x.sampleCode}</b>: ${x.status === 'confirmed' ? html`removal confirmed by ${x.confirmedBy} (${x.confirmation})` : html`removal requested — <b>awaiting a technical reviewer's confirmation; the sample stays in the evidence</b>`}. Requested by ${x.requestedBy}: “${x.reason}”
        ${x.status !== 'confirmed' && isDraft && can(c.actor, 'assess.approve') ? html`<form method="post" action="/assessments/rev/${r.id}/removal" class="row">${csrfField(c)}<input type="hidden" name="sample_id" value="${x.sampleId}"><input name="reason" required minlength="10" placeholder="Why the sample is outside the scope of this assessment"><button class="secondary">Confirm removal</button></form>` : ''}</li>`)}</ul></section>` : ''}
      ${calcOutput(r.calc_output, isDraft && (can(c.actor, 'assess.write') || can(c.actor, 'assess.approve')) ? { c, revId: r.id, samples: d.candidates.filter((x: any) => r.sample_ids.includes(x.id)) } : null)}
      ${r.parameters?.unsampledAssumption && r.parameters.unsampledAssumption !== 'none' ? html`<p class="note">Unsampled-time assumption: ${label(r.parameters.unsampledAssumption)} — ${r.parameters.unsampledJustification}</p>` : ''}

      <h2>Interpretation</h2>
      ${r.interpretation && r.calc_output ? (() => { const issues = narrativeChecks(r.interpretation, evidenceFacts(r.calc_output)); return issues.length ? html`<div class="flash warn" role="status"><b>The interpretation may contradict the recorded results.</b><ul>${issues.map((x) => html`<li>${x}</li>`)}</ul>The text is not changed; edit it if needed.</div>` : ''; })() : ''}
      ${['improvement_required', 'urgent_action_required'].includes(r.conclusion_category) && !d.actions.length ? html`<div class="flash warn" role="status">The conclusion requires improvement but no action is linked to this assessment. Raise the corrective actions below, or the report will state that none are recorded.</div>` : ''}
      ${r.interpretation ? html`<p>${r.interpretation}</p><p><b>Conclusion:</b> ${label(r.conclusion_category ?? 'not set')}</p><p><b>Limitations:</b> ${r.limitations ?? '—'}</p>` : empty('No interpretation yet.')}
      ${isDraft && can(c.actor, 'assess.write') ? draftForm(c, d) : ''}
      ${isDraft && can(c.actor, 'assess.write') ? html`<p class="small muted">${config.aiProvider === 'none' ? 'AI drafting assistance is not configured for this deployment.' : ''}${suggestions.length ? ` ${suggestions.length} AI suggestion(s) recorded.` : ''}</p>` : ''}

      <h2>Actions raised</h2>
      ${d.actions.length ? html`<ul>${d.actions.map((x) => html`<li><a href="/actions/${x.id}">${x.title}</a> — ${label(x.status)}</li>`)}</ul>` : empty('No actions raised from this assessment.')}
      ${can(c.actor, 'actions.assign') ? html`<details class="panel"><summary>Raise a corrective action</summary><form method="post" action="/actions" class="stack">${csrfField(c)}
        <input type="hidden" name="source_type" value="assessment"><input type="hidden" name="source_id" value="${a.id}"><input type="hidden" name="group_id" value="${a.group_id}">
        <label>Action<input name="title" required></label><label>Description<textarea name="description"></textarea></label>
        <div class="row"><label>Owner<select name="owner_user_id">${options(lk.users, 'id', (u) => u.name)}</select></label><label>Priority<select name="priority"><option>normal</option><option>high</option><option>urgent</option><option>low</option></select></label><label>Due<input type="date" name="due_date"></label></div>
        <label>Verification requirement <span class="hint">How effectiveness will be demonstrated</span><textarea name="verification_requirement" required></textarea></label>
        <label class="check"><input type="checkbox" name="requires_exposure_reassessment" value="on"> Closure requires an approved post-implementation exposure assessment</label><div><button>Raise action</button></div></form></details>` : ''}

      <h2>Reports</h2>
      ${d.reports.length ? html`<ul>${d.reports.map((x) => html`<li><a href="/reports/${x.id}">Version ${x.version}</a> — ${x.status === 'issued' ? 'issued' : html`<span class="badge b-warn">draft</span>`} ${fmtDateTime(x.generated_at)}</li>`)}</ul>` : empty('No reports generated.')}

      <h2>Revision history</h2>
      <div class="tablewrap"><table><thead><tr><th>Revision</th><th>Status</th><th>States</th><th>Created</th><th>Reviewer</th><th>Reason</th></tr></thead><tbody>
      ${d.revisions.map((x) => html`<tr><td>r${x.revision}</td><td>${label(x.status)}</td><td>${evidenceStrip(x.data_quality_state, x.benchmark_state, x.status)}</td><td>${fmtDateTime(x.created_at)} ${x.created_by_name ?? ''}</td><td>${x.reviewer_name ?? '—'}</td><td>${x.change_reason ?? '—'}</td></tr>`)}</tbody></table></div>
      ${d.revisions.filter((x) => x.inputs_snapshot).length > 1 ? html`<form method="get" action="/assessments/${a.id}/compare" class="actions-row panel"><label>Before<select name="before">${options(d.revisions.filter((x) => x.inputs_snapshot), 'id', (x) => `r${x.revision}`, null, '')}</select></label><label>After<select name="after">${options(d.revisions.filter((x) => x.inputs_snapshot), 'id', (x) => `r${x.revision}`, null, '')}</select></label><button class="secondary">Compare</button></form>` : ''}`,
    };
  });

  page(app, '/assessments/:id/compare', async (c) => {
    const r = await asmt.compareRevisions(c.actor, String(c.query.before), String(c.query.after));
    const tw = (rev: any) => (rev.calc_output?.shifts ?? []).map((s: any) => html`${s.subjectRef} ${s.shiftDate}: ${interval(s.result ?? s.twa8h)}<br>`);
    return {
      title: 'Before and after comparison', crumbs: [['Assessments', '/assessments'], ['Assessment', `/assessments/${c.params.id}`], ['Compare']],
      body: html`${r.comparable ? html`<div class="note">No differences were found in method, tasks, operating conditions, control status, sample types or duration. Differences in results may still have other causes.</div>`
        : html`<div class="flash warn"><b>These results are not directly comparable.</b> The differences below may explain changes in measured exposure independently of any control.</div>
          <div class="tablewrap"><table><thead><tr><th>Aspect</th><th>Before (r${r.before.revision})</th><th>After (r${r.after.revision})</th></tr></thead><tbody>${r.differences.map((x) => html`<tr><td>${x.aspect}</td><td>${x.before}</td><td>${x.after}</td></tr>`)}</tbody></table></div>`}
        <div class="cols"><div><h2>Before — r${r.before.revision}</h2>${evidenceStrip(r.before.data_quality_state, r.before.benchmark_state, r.before.status)}<p>${tw(r.before)}</p></div>
        <div><h2>After — r${r.after.revision}</h2>${evidenceStrip(r.after.data_quality_state, r.after.benchmark_state, r.after.status)}<p>${tw(r.after)}</p></div></div>`,
    };
  });

  action(app, '/assessments/rev/:id/draft', async (c) => { const r = await asmt.updateDraft(c.actor, c.params.id, c.body); return { to: `/assessments/${r.assessment_id}`, ok: 'Draft saved. Run the calculation to update results.' }; });
  action(app, '/assessments/rev/:id/calculate', async (c) => { const r = await asmt.calculate(c.actor, c.params.id); return { to: `/assessments/${r.assessment_id}`, ok: `Calculated: data ${label(r.data_quality_state)}, benchmark ${label(r.benchmark_state)}` }; });
  action(app, '/assessments/rev/:id/removal', async (c) => { await asmt.confirmSampleRemoval(c.actor, c.params.id, c.body); return { to: back(c, '/assessments'), ok: 'Removal confirmed. Run the calculation again.' }; });
  action(app, '/assessments/rev/:id/disposition', async (c) => { await asmt.recordEvidenceDisposition(c.actor, c.params.id, c.body); return { to: back(c, '/assessments'), ok: 'Disposition recorded. Run the calculation again.' }; });
  action(app, '/assessments/rev/:id/submit', async (c) => { const r = await asmt.submitForReview(c.actor, c.params.id); return { to: `/assessments/${r.assessment_id}`, ok: 'Submitted for professional review' }; });
  action(app, '/assessments/rev/:id/approve', async (c) => { const r = await asmt.approve(c.actor, c.params.id, c.body); return { to: `/assessments/${r.assessment_id}`, ok: `Revision ${r.revision} approved` }; });
  action(app, '/assessments/rev/:id/return', async (c) => { await asmt.returnToDraft(c.actor, c.params.id, c.body); return { to: back(c, '/assessments'), ok: 'Returned to draft' }; });
  action(app, '/assessments/:id/revise', async (c) => { await asmt.newRevision(c.actor, c.params.id, c.body); return { to: `/assessments/${c.params.id}`, ok: 'New draft revision created' }; });
  action(app, '/assessments/:id/report/:rev', async (c) => { const r = await rep.generateReport(c.actor, c.params.id, c.params.rev); return { to: `/reports/${r.id}`, ok: r.status === 'issued' ? 'Report issued' : 'Draft report generated' }; });
  action(app, '/actions', async (c) => { const x = await ctl.createAction(c.actor, c.body); return { to: `/actions/${x.id}`, ok: 'Action raised' }; });

  // ── Reports
  page(app, '/reports', async (c) => {
    const list = await rep.listReports(c.actor);
    return {
      title: 'Reports', sub: 'Each report version is fixed at generation. Only approved assessments produce issued reports; drafts are watermarked.',
      body: list.length ? html`<div class="tablewrap"><table><thead><tr><th>Assessment</th><th>Version</th><th>Status</th><th>Generated</th><th>Content hash</th></tr></thead><tbody>
        ${list.map((r) => html`<tr><td><a href="/assessments/${r.assessment_id}">${r.title}</a></td><td><a href="/reports/${r.id}">v${r.version}</a></td><td>${r.status === 'issued' ? 'Issued' : html`<span class="badge b-warn">Draft</span>`}</td><td>${fmtDateTime(r.generated_at)}</td><td><code>${r.content_hash.slice(0, 16)}…</code></td></tr>`)}</tbody></table></div>` : empty('No reports available.'),
    };
  });
  app.get('/reports/:id', async (req, reply) => {
    const si = await authed(req, reply);
    if (!si) return reply;
    try {
      const r = await rep.getReport(si.actor, (req.params as any).id);
      return reply.type('text/html').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'").send(r.content_html);
    } catch (e: any) {
      if (e.status) return reply.code(e.status).type('text/plain').send(e.message);
      throw e;
    }
  });
}
