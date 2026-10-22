import { config } from '../config.js';
import { sha256 } from '../auth/crypto.js';
import { audit, can, many, one, requirePerm, withActor, type Actor } from '../db.js';
import { AppError, forbidden, invalid, notFound } from '../errors.js';
import { assertAssessmentNotOnHold, assertWorkflowActive, METHOD_APPROVED, methodReview, tenantControls } from './assurance.js';
import { bmBadge, dqBadge, fmtDate, fmtDateTime, fmtNum, html, interval, label, psBadge, raw } from '../ui/html.js';
import { evidenceFacts, factualSummary, narrativeChecks } from './narrative.js';
import { usage } from './usage.js';

/**
 * Generates an immutable report version from a specific assessment revision.
 * Approved revision → issued report. Any other state → draft report, watermarked.
 * Content is taken from the revision's frozen snapshot and calculation output, so it stays
 * consistent with the approved assessment even if live records change later.
 */
export async function generateReport(a: Actor, assessmentId: string, revisionId: string) {
  requirePerm(a, 'reports.generate');
  return withActor(a, async (tx) => {
    const as = await one(tx, `select a.*, g.name group_name, g.rationale group_rationale, g.description group_description, s.name substance_name, s.cas_number, si.name site_name, c.name client_name, t.name tenant_name, t.is_demo
      from assessments a join exposure_groups g on g.id=a.group_id join substances s on s.id=a.substance_id join sites si on si.id=g.site_id join clients c on c.id=a.client_id join tenants t on t.id=a.tenant_id where a.id=$1`, [assessmentId]);
    if (!as) throw notFound('Assessment');
    const rev = await one(tx, `select r.*, ru.name reviewer_name, ru.email reviewer_email, cu.name author_name from assessment_revisions r left join users ru on ru.id=r.reviewer_id left join users cu on cu.id=r.created_by where r.id=$1 and r.assessment_id=$2`, [revisionId, assessmentId]);
    if (!rev) throw notFound('Revision');
    if (!rev.calc_output) throw invalid('The revision has no calculation output to report');
    const issued = rev.status === 'approved';
    if (issued) { await assertWorkflowActive(tx, 'report_issue', 'issue report'); await assertAssessmentNotOnHold(tx, assessmentId, 'issue report'); }
    // Issued reports state the method review status frozen at approval; drafts state the current status.
    const current = await methodReview(tx, rev.calc_code ?? 'twa_8h', rev.calc_version);
    const methodStatus: string = issued ? (rev.method_review_status ?? 'not_recorded') : current.status;
    const methodOk = METHOD_APPROVED.has(methodStatus);
    // Conditions in force when the method status was fixed (at approval for issued reports).
    const review = await one(tx, `select status, conditions, reviewer_name, reviewed_on from method_reviews where calc_code=$1 and calc_version=$2 ${issued ? 'and recorded_at <= $3' : ''} order by recorded_at desc limit 1`,
      issued ? [rev.calc_code ?? 'twa_8h', rev.calc_version, rev.approved_at] : [rev.calc_code ?? 'twa_8h', rev.calc_version]);
    const controls = await tenantControls(tx);
    const levelAtApproval: string | null = issued ? (rev.assurance_level_at_approval ?? null) : null;
    if (issued && controls.assuranceLevel === 'pilot') {
      // A pilot organisation can only issue reports for conclusions approved under the pilot gate.
      if (levelAtApproval !== 'pilot' || !methodOk || rev.benchmark_provenance !== 'professional_reference')
        throw new AppError(422, 'not_pilot_approved', 'This revision was not approved under the pilot controls (approved method and professional reference benchmark). Create a new revision and have it approved before issuing a report.');
      if (current.status === 'rejected' || current.status === 'withdrawn' || current.status === 'expired')
        throw new AppError(422, 'method_rejected', `The professional approval of the calculation method used by this revision has since been ${current.status}. Reassess before issuing a report.`);
    }
    const plan = as.plan_id ? await one(tx, 'select * from monitoring_plans where id=$1', [as.plan_id]) : null;
    const tasks = await many(tx, 'select t.name, t.description, p.name process_name from exposure_group_tasks gt join tasks t on t.id=gt.task_id join processes p on p.id=t.process_id where gt.group_id=$1', [as.group_id]);
    const bench = rev.benchmark_version_id ? await one(tx, 'select v.*, b.jurisdiction, b.benchmark_type, b.averaging_minutes from benchmark_versions v join benchmarks b on b.id=v.benchmark_id where v.id=$1', [rev.benchmark_version_id]) : null;
    const samples = rev.inputs_snapshot?.samples ?? [];
    const methods = [...new Map(samples.filter((s: any) => s.method).map((s: any) => [`${s.method.code} v${s.method.version}`, s.method])).entries()];
    const instruments = [...new Map(samples.filter((s: any) => s.instrument).map((s: any) => [s.instrument.assetTag, s.instrument])).values()];
    const acts = await many(tx, `select title, status, verification_requirement, due_date, priority from actions where source_type='assessment' and source_id=$1 and status <> 'cancelled' order by created_at`, [assessmentId]);
    const history = await many(tx, `select r.revision, r.status, r.change_reason, r.approved_at, ru.name reviewer_name from assessment_revisions r left join users ru on ru.id=r.reviewer_id where r.assessment_id=$1 and r.revision <= $2 order by revision`, [assessmentId, rev.revision]);
    const out = rev.calc_output;
    const facts = evidenceFacts(out);
    const narrativeIssues = narrativeChecks(rev.interpretation, facts);
    const planIssues = plan ? narrativeChecks(plan.strategy_rationale, facts, 'The planned strategy') : [];
    const needsActions = ['improvement_required', 'urgent_action_required'].includes(rev.conclusion_category);
    const last = await one(tx, 'select coalesce(max(version),0)::int v from reports where assessment_id=$1', [assessmentId]);
    const version = last.v + 1;
    const b = config.branding;

    const body = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${as.title} — Occupational hygiene report v${version}</title>
<style>${raw(REPORT_CSS)}</style></head><body>
${issued ? '' : html`<div class="watermark" aria-hidden="true">DRAFT — NOT APPROVED</div><p class="draftnote">DRAFT: this report is generated from an assessment revision that has not been professionally approved (status: ${label(rev.status)}). It must not be relied upon.</p>`}
${as.is_demo ? html`<p class="draftnote">DEMONSTRATION DATA — synthetic records for demonstration only. Not real measurements.</p>` : ''}
<header><div class="brand">${b.productName} <span>${b.endorsement}</span></div>
<h1>${as.title}</h1>
<table class="meta"><tr><th>Client</th><td>${as.client_name}</td><th>Site</th><td>${as.site_name}</td></tr>
<tr><th>Report version</th><td>${version} (${issued ? 'issued' : 'draft'})</td><th>Assessment revision</th><td>r${rev.revision} — ${label(rev.status)}</td></tr>
<tr><th>Generated</th><td>${fmtDateTime(new Date())}</td><th>Prepared by</th><td>${rev.author_name ?? '—'}</td></tr></table>
<p>${dqBadge(rev.data_quality_state)} ${bmBadge(rev.benchmark_state)} ${psBadge(rev.status)}</p></header>

<h2>1. Purpose and scope</h2>
<p><strong>Assessment question:</strong> ${as.assessment_question}</p>
${plan ? html`<p><strong>Monitoring purpose:</strong> ${plan.purpose}</p>` : ''}
${issued ? html`<p><strong>Scope of approval:</strong> ${rev.approval_scope}</p>` : ''}

<h2>2. Processes and exposure group assessed</h2>
<p><strong>Similar exposure group:</strong> ${as.group_name}. ${as.group_description ?? ''}</p>
<p><strong>Basis for grouping:</strong> ${as.group_rationale}</p>
<p><strong>Substance:</strong> ${as.substance_name}${as.cas_number ? html` (CAS ${as.cas_number})` : ''}</p>
${tasks.length ? html`<ul>${tasks.map((t) => html`<li>${t.process_name} — ${t.name}${t.description ? html`: ${t.description}` : ''}</li>`)}</ul>` : ''}

<h2>3. Sampling strategy and methods</h2>
${plan ? html`<p><strong>Planned approach:</strong> ${label(plan.approach)}. ${plan.strategy_rationale}</p>${plan.coverage_notes ? html`<p><strong>Coverage:</strong> ${plan.coverage_notes}</p>` : ''}` : html`<p>No monitoring plan linked.</p>`}
<p><strong>Sampling achieved (from the records):</strong> ${factualSummary(facts, out.calcCode)}</p>
${planIssues.length ? html`<p class="draftnote"><strong>Deviation from the plan:</strong> ${planIssues.join(' ')}</p>` : ''}
<ul>${methods.map(([k, m]: any) => html`<li>${k} — result basis ${label(m.resultBasis)}; flow tolerance ${m.flowDriftTolerancePct ?? 'not defined'}%; ${m.suitableForFormalAssessment ? 'suitable for formal assessment' : 'indicative only'}</li>`)}</ul>
<p class="${methodOk ? '' : 'draftnote'}"><strong>Method review status${issued ? ' at approval' : ''}:</strong> ${methodStatus === 'not_recorded' ? 'not recorded (approved before method review tracking)' : label(methodStatus)}${methodOk && review ? html` — ${review.reviewer_name}, ${fmtDate(review.reviewed_on)}${review.conditions ? html`. <strong>Conditions:</strong> ${review.conditions}` : ''}` : ''}${methodOk ? '' : ' — this calculation method has not been approved by a competent occupational hygienist. Results are for discussion only and must not be relied upon for conclusions.'}</p>
${issued && current.status !== methodStatus && methodStatus !== 'not_recorded' ? html`<p class="draftnote"><strong>Current method review status:</strong> ${label(current.status)} (changed since approval). Reassessment may be required.</p>` : ''}
${issued
  ? (levelAtApproval === 'pilot' ? '' : levelAtApproval === 'demo' ? '' : html`<p class="draftnote">NOT APPROVED UNDER AN AUTHORISED PILOT — ${levelAtApproval ? `approved while the organisation was at ${levelAtApproval} level` : 'approved before assurance levels were recorded'}. Outputs are not for reliance.</p>`)
  : (controls.assuranceLevel === 'evaluation' ? html`<p class="draftnote">EVALUATION USE — this organisation is not operating under an authorised pilot. Outputs are not for reliance.</p>` : '')}
<p><strong>Calculation:</strong> ${out.calcCode} v${out.calcVersion} (engine ${out.engineVersion}). ${out.calcCode === 'stel_15' ? html`Short-sample assumption: ${label(rev.parameters?.shortSampleAssumption ?? 'none')}${rev.parameters?.shortSampleJustification ? html` — ${rev.parameters.shortSampleJustification}` : ''}.` : html`Parameters: exposure per shift ${rev.parameters?.exposureMinutesPerShift ?? 'not recorded'} min; unsampled period assumption: ${label(rev.parameters?.unsampledAssumption ?? 'none')}${rev.parameters?.unsampledJustification ? html` — ${rev.parameters.unsampledJustification}` : ''}.`}</p>

<h2>4. Instruments and quality checks</h2>
<table><thead><tr><th>Instrument</th><th>Calibration at sampling</th><th>Designation</th></tr></thead><tbody>
${instruments.map((i: any) => html`<tr><td>${i.assetTag}</td><td>${i.calibrationValidAtSampling === null ? 'No evidence' : i.calibrationValidAtSampling ? 'Valid' : 'Expired or failed'}</td><td>${i.screeningOnly ? 'Screening only' : 'Formal'}</td></tr>`)}
</tbody></table>
${out.issues.length ? html`<h3>Data quality findings</h3><ul class="issues">${out.issues.map((f: any) => html`<li class="sev-${f.severity}">[${label(f.severity)}] ${f.message}</li>`)}</ul>` : html`<p>No data quality findings.</p>`}

<h2>5. Results</h2>
<p><strong>Summary:</strong> ${factualSummary(facts, out.calcCode)}${facts.calculationAvailability ? html` Calculation availability: ${label(facts.calculationAvailability)}. Evidence adequacy: ${label(facts.evidenceAdequacy)}.` : ''}</p>
<table><thead><tr><th>Sample</th><th>Type</th><th>Subject</th><th>Sampled (min)</th><th>Volume (L)</th><th>Concentration</th><th>In report</th><th>In calculation</th><th>In formal comparison</th></tr></thead><tbody>
${out.samples.map((s: any) => { const u = usage(out, s); return html`<tr><td>${s.sampleCode}</td><td>${label(s.sampleType)}</td><td>${s.subjectRef ?? '—'}</td><td>${fmtNum(s.sampledMinutes)}</td><td>${fmtNum(s.volumeL)}</td><td>${interval(s.concentration)}${s.indicative ? html` <span class="tag">indicative</span>` : ''}</td><td>Yes</td><td>${u.calculation}</td><td>${u.formal}</td></tr>`; })}
</tbody></table>
${out.unresolvedEvidence?.length ? html`<p><strong>Evidence not used formally:</strong></p><ul>${out.unresolvedEvidence.map((u: any) => html`<li>${u.sampleCode} (${u.subjectRef ?? '—'}): ${u.why}</li>`)}</ul>` : ''}
<h3>${out.calcCode === 'stel_15' ? '15-minute short-term results (personal)' : '8-hour time-weighted averages (personal)'}</h3>
<table><thead><tr><th>Worker ref</th><th>${out.calcCode === 'stel_15' ? 'Date' : 'Shift date'}</th><th>Samples</th><th>${out.calcCode === 'stel_15' ? 'Sampled (min)' : 'Coverage'}</th><th>${out.calcCode === 'stel_15' ? '15-min value' : '8-h TWA'}</th><th>Benchmark comparison</th></tr></thead><tbody>
${out.shifts.length ? out.shifts.map((s: any) => html`<tr><td>${s.subjectRef}</td><td>${s.shiftDate}</td><td>${s.sampleCodes.join(', ')}</td><td>${out.calcCode === 'stel_15' ? fmtNum(s.sampledMinutes) : html`${fmtNum(s.coveragePct)}%`}</td><td>${interval(s.result ?? s.twa8h)}${s.comparison?.converted ? html` (≈ ${interval(s.comparison.converted)})` : ''}</td><td>${s.comparison ? html`${label(s.comparison.state)}${s.comparison.ratio ? html` (ratio ${fmtNum(s.comparison.ratio.lower)}${s.comparison.ratio.upper !== s.comparison.ratio.lower ? html`–${fmtNum(s.comparison.ratio.upper)}` : ''})` : ''}` : 'not compared'}</td></tr>`) : html`<tr><td colspan="6">No personal results for this calculation.</td></tr>`}
</tbody></table>
${out.staticSamples.length ? html`<p class="muted">Static samples are reported as contextual evidence and are not compared with personal exposure benchmarks.</p>` : ''}

<h2>6. Applicable benchmark</h2>
${bench ? html`<p>${bench.jurisdiction} ${bench.benchmark_type} (${bench.averaging_minutes}-min reference): ${fmtNum(bench.value)} ${bench.unit}${bench.annotations?.length ? html` [${bench.annotations.join(', ')}]` : ''}. Source: ${bench.source_title}, ${bench.source_version}; effective from ${fmtDate(bench.effective_from)}. Verification: ${label(bench.verification_status)}. Provenance: ${bench.provenance === 'professional_reference' ? html`professionally verified reference data (${bench.reviewer_name}, ${fmtDate(bench.verified_on)})` : bench.provenance === 'synthetic' ? 'synthetic demonstration value' : 'entered by the organisation — not professionally verified reference data'}.${bench.is_synthetic ? html` <strong>SYNTHETIC DEMONSTRATION VALUE — not a real exposure limit.</strong>` : ''}</p>` : html`<p>No benchmark applied.</p>`}
<p>${out.benchmarkNote}</p>
<p class="muted">${out.disclaimer}</p>

<h2>7. Limitations and uncertainty</h2>
<p>${rev.limitations ?? '—'}</p>
${issued ? html`<p><strong>Reviewer-stated limitations:</strong> ${rev.approval_limitations}</p>` : ''}

<h2>8. Professional interpretation</h2>
<p>${rev.interpretation ?? 'Not yet provided.'}</p>
${narrativeIssues.length ? html`<div class="draftnote"><strong>Consistency check (automatic):</strong> the interpretation appears to contradict the recorded results.<ul>${narrativeIssues.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}
<p><strong>Conclusion category:</strong> ${label(rev.conclusion_category ?? 'not set')}</p>

<h2>9. Required actions and verification requirements</h2>
${acts.length ? html`<table><thead><tr><th>Action</th><th>Priority</th><th>Due</th><th>Status</th><th>Verification required</th></tr></thead><tbody>
${acts.map((x) => html`<tr><td>${x.title}</td><td>${x.priority}</td><td>${fmtDate(x.due_date)}</td><td>${label(x.status)}</td><td>${x.verification_requirement}</td></tr>`)}</tbody></table>` : needsActions
  ? html`<p class="draftnote"><strong>No actions are linked to this assessment.</strong> The conclusion (${label(rev.conclusion_category)}) requires improvement, but no corrective action has been recorded against it in this system. Recommendations must be recorded as actions with an owner, a due date and a verification requirement before this report is relied upon.</p>`
  : html`<p>No actions recorded against this assessment.</p>`}

<h2>10. Review and revision history</h2>
<table><thead><tr><th>Revision</th><th>Status</th><th>Reviewer</th><th>Approved</th><th>Reason for revision</th></tr></thead><tbody>
${history.map((h) => html`<tr><td>r${h.revision}</td><td>${label(h.status)}</td><td>${h.reviewer_name ?? '—'}</td><td>${fmtDateTime(h.approved_at)}</td><td>${h.change_reason ?? '—'}</td></tr>`)}
</tbody></table>
${issued ? html`<p class="sig">Approved by ${rev.reviewer_name} (${rev.reviewer_email}) on ${fmtDateTime(rev.approved_at)}. Approval record hash: <code>${rev.snapshot_hash}</code></p>` : ''}
<footer>${b.owner} · ${b.productName} ${b.endorsement}. Clinical diagnosis and medical fitness decisions are outside the scope of this report.</footer>
</body></html>`.value;

    const r = await one(tx, `insert into reports (tenant_id,client_id,assessment_id,assessment_revision_id,version,status,content_html,content_hash,generated_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, version, status, content_hash`,
      [as.tenant_id, as.client_id, assessmentId, revisionId, version, issued ? 'issued' : 'draft', body, sha256(body), a.userId]);
    await audit(tx, a, issued ? 'report.issued' : 'report.draft_generated', 'report', r.id, { assessment: assessmentId, revision: rev.revision, hash: r.content_hash });
    return r;
  });
}

export async function getReport(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const r = await one(tx, 'select * from reports where id=$1', [id]);
    if (!r) throw notFound('Report');
    if (r.status !== 'issued' && !can(a, 'reports.read_drafts')) throw forbidden('Draft reports are not available to your role');
    await audit(tx, a, 'report.viewed', 'report', id);
    return r;
  });
}

export async function listReports(a: Actor) {
  return withActor(a, (tx) => many(tx, `select r.id, r.version, r.status, r.generated_at, r.content_hash, a.title, a.id assessment_id from reports r join assessments a on a.id=r.assessment_id
    where ($1 or r.status='issued') order by r.generated_at desc`, [can(a, 'reports.read_drafts')]));
}

const REPORT_CSS = `
body{font:14px/1.5 Georgia,'Times New Roman',serif;color:#1d232b;max-width:900px;margin:32px auto;padding:0 24px;position:relative}
h1{font-size:26px;margin:4px 0 12px} h2{font-size:17px;border-bottom:1px solid #c9d0d8;padding-bottom:4px;margin-top:28px} h3{font-size:15px}
.brand{font:600 12px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#245b5b}.brand span{font-weight:400;color:#5c6670}
table{border-collapse:collapse;width:100%;margin:8px 0;font:13px system-ui,sans-serif} th,td{border:1px solid #d6dbe1;padding:5px 7px;text-align:left;vertical-align:top} th{background:#f1f4f6}
table.meta th{width:16%}
.badge{display:inline-block;font:600 12px system-ui,sans-serif;padding:2px 8px;border-radius:10px;border:1px solid #99a3ad;margin-right:4px}
.b-ok{background:#e3f1ea;border-color:#5c9c7c}.b-warn{background:#fbf0d9;border-color:#c49a3c}.b-bad{background:#f8e1e1;border-color:#b85c5c}.b-neutral{background:#eef1f4}
.tag{font:11px system-ui,sans-serif;background:#eef1f4;border-radius:4px;padding:1px 5px}.muted{color:#5c6670}
.issues li.sev-exclude,.issues li.sev-incomplete{color:#8a2d2d}
.watermark{position:fixed;top:40%;left:0;right:0;text-align:center;font:700 72px system-ui,sans-serif;color:rgba(184,92,92,.13);transform:rotate(-24deg);pointer-events:none;z-index:9}
.draftnote{border:2px solid #b85c5c;background:#f8e1e1;padding:8px 12px;font:600 13px system-ui,sans-serif}
.sig{border-top:1px solid #c9d0d8;padding-top:8px} code{font-size:11px;word-break:break-all}
footer{margin-top:36px;font:12px system-ui,sans-serif;color:#5c6670;border-top:1px solid #c9d0d8;padding-top:8px}
@media print{.watermark{position:fixed}}`;
