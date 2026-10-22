// TR-08 historical impact check. READ-ONLY: runs in a read-only transaction and changes nothing.
// Finds submitted, approved or superseded revisions whose FROZEN calculation inputs include samples that are not in the
// revision's selected list (samples whose removal awaited a reviewer's confirmation, engine 1.5.1 / migration 029), i.e.
// evidence that the pre-TR-08 safeguards did not cover. For each such sample it reports, where the records allow:
//   - held field records or suspension-review flags OUTSTANDING now, or IN FORCE AT APPROVAL;
//   - a QC disposition recorded by the approving reviewer before approval (independence);
//   - laboratory or calibration writes close to the approval that could have raced it;
//   - cases where the sequence cannot be established from the records (needs further investigation).
// It does not conclude that a flagged revision was approved incorrectly, and it changes no approval, calculation or
// report. Corrections use the existing workflow: a new revision with a reason; supersede reports after re-approval.
//   DATABASE_ADMIN_URL=… npx tsx scripts/tr/tr08-impact.ts [--json out.json]
import { writeFileSync } from 'node:fs';
import pg from 'pg';

export async function tr08Impact(adminUrl: string) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('begin transaction read only');
    const revs = (await c.query(`select r.id, r.revision, r.status, r.sample_ids, r.inputs_snapshot, r.submitted_at, r.approved_at, r.reviewer_id, ru.name reviewer,
        a.title assessment, t.name organisation,
        coalesce((select json_agg(json_build_object('id', p.id, 'version', p.version, 'status', p.status) order by p.version) from reports p where p.assessment_revision_id=r.id), '[]') reports
      from assessment_revisions r join assessments a on a.id=r.assessment_id join tenants t on t.id=r.tenant_id left join users ru on ru.id=r.reviewer_id
      where r.status in ('in_review','approved','superseded') and r.inputs_snapshot is not null order by t.name, a.title, r.revision`)).rows;
    const out = [];
    for (const r of revs) {
      const frozen: string[] = (r.inputs_snapshot.samples ?? []).map((s: any) => s.sampleId);
      const outside = frozen.filter((id) => !(r.sample_ids ?? []).includes(id));
      if (!outside.length) continue;
      const at = r.approved_at as Date | null;
      // Calculation time (audit) — writes before it are reflected in the frozen inputs; only later writes could race.
      const calcAt = (await c.query(`select max(at) t from audit_events where action='assessment.calculated' and entity_id=$1 and ($2::timestamptz is null or at <= $2)`, [r.id, r.submitted_at])).rows[0].t as Date | null;
      const frozenResults = new Set((r.inputs_snapshot.refs ?? []).map((x: any) => x.resultRevisionId).filter(Boolean));
      const samples = [];
      for (const sid of outside) {
        const e = (await c.query('select sample_code, instrument_id, suspension_review_required, suspension_reviewed_at from sampling_events where id=$1', [sid])).rows[0];
        const holds = (await c.query(`select status, received_at, resolved_at from field_intake_holds where server_id=$1 or sampling_event_id=$1 order by received_at`, [sid])).rows;
        const concerns: string[] = [], investigate: string[] = [];
        const removal = (await c.query(`select x.action, x.reason, x.recorded_at, u.name from assessment_sample_removals x join users u on u.id=x.recorded_by where x.revision_id=$1 and x.sampling_event_id=$2 order by x.seq`, [r.id, sid])).rows;
        const qc = r.reviewer_id ? (await c.query(`select check_type, disposition, disposition_at from sample_qc_checks where sampling_event_id=$1 and disposition_by=$2`, [sid, r.reviewer_id])).rows : [];
        // Writes after the calculation and up to 5 min after approval that are not reflected in the frozen inputs.
        const labWrites = at && calcAt ? (await c.query(`select v.id, v.revision, v.entered_at from lab_result_revisions v join lab_results l on l.id=v.result_id where l.sampling_event_id=$1 and v.entered_at > $2::timestamptz and v.entered_at < $3::timestamptz + interval '5 minutes'`, [sid, calcAt, at])).rows.filter((v) => !frozenResults.has(v.id)) : [];
        const calWrites = at && calcAt && e.instrument_id ? (await c.query(`select outcome, recorded_at from calibrations where instrument_id=$1 and recorded_at > $2::timestamptz and recorded_at < $3::timestamptz + interval '5 minutes'`, [e.instrument_id, calcAt, at])).rows : [];
        if (at && !calcAt) investigate.push('the calculation time is not recorded, so writes around approval cannot be placed in sequence');
        // Holds (timestamps recorded): outstanding now, or in force at approval.
        for (const h of holds) {
          if (['held', 'in_conflict'].includes(h.status)) concerns.push(`held field record outstanding now (received ${h.received_at.toISOString()})`);
          else if (at && h.received_at < at && (!h.resolved_at || h.resolved_at > at)) concerns.push(`held field record in force at approval (received ${h.received_at.toISOString()}, resolved ${h.resolved_at?.toISOString() ?? '—'})`);
        }
        // Suspension-review flag: set when a hold is synchronised (that hold's resolved_at); otherwise the time is not recorded.
        if (e.suspension_review_required) {
          const sync = holds.filter((h) => h.status === 'synchronised' && h.resolved_at).map((h) => h.resolved_at as Date).sort((x, y) => +x - +y).pop();
          if (!e.suspension_reviewed_at) concerns.push('suspension review outstanding now');
          else if (at && sync && sync < at && e.suspension_reviewed_at > at) concerns.push(`suspension review pending at approval (flagged ${sync.toISOString()}, reviewed ${e.suspension_reviewed_at.toISOString()})`);
          else if (at && !sync && e.suspension_reviewed_at > at) investigate.push('suspension-review flag reviewed after approval; when the flag was set is not recorded');
        }
        for (const q of qc) {
          if (at && q.disposition_at && q.disposition_at < at) concerns.push(`approving reviewer recorded a QC disposition (${q.check_type}: ${q.disposition}) before approval`);
          else if (!at) concerns.push(`the reviewer recorded a QC disposition (${q.check_type}); approval by that reviewer is now refused`);
        }
        if (labWrites.length) investigate.push(`laboratory result revision(s) ${labWrites.map((x) => `r${x.revision} at ${x.entered_at.toISOString()}`).join(', ')} written after the calculation and not in the frozen inputs (within 5 min of approval); the approval may not have checked it`);
        if (calWrites.length) investigate.push(`calibration record(s) ${calWrites.map((x) => `${x.outcome} at ${x.recorded_at.toISOString()}`).join(', ')} for its instrument after the calculation (up to 5 min after approval); the approval may not have checked it`);
        if (!removal.length) investigate.push('no removal record for this sample in this revision (frozen inputs and selected list differ for another reason)');
        samples.push({ sampleId: sid, sampleCode: e.sample_code, removalHistory: removal.map((x) => ({ action: x.action, by: x.name, at: x.recorded_at, reason: x.reason })), concerns, investigate,
          classification: concerns.length ? 'concern' : investigate.length ? 'needs investigation' : 'no concern found in the records' });
      }
      const cls = samples.some((s) => s.classification === 'concern') ? 'concern' : samples.some((s) => s.classification === 'needs investigation') ? 'needs investigation' : 'potentially affected; no concern found in the records';
      out.push({ organisation: r.organisation, assessment: r.assessment, revision: r.revision, status: r.status, submittedAt: r.submitted_at, approvedAt: r.approved_at, reviewer: r.reviewer,
        samplesInCalculationNotSelected: samples, classification: cls, reports: r.reports, issuedReports: (r.reports as any[]).filter((p) => p.status === 'issued').length,
        action: r.status === 'approved' ? 'Review. If reassessment is needed, create a new revision with a reason (approval does not transfer) and supersede issued reports after re-approval. The approved revision and its reports are not altered.'
          : r.status === 'in_review' ? 'Under the TR-08 fix, approval re-checks the effective evidence; return to draft if a concern is listed.' : 'Superseded; review only if its reports are still relied upon.' });
    }
    await c.query('rollback');
    return { generated: new Date().toISOString(), readOnly: true, scope: 'revisions in review, approved or superseded whose frozen inputs include samples outside the selected list',
      summary: { revisionsFlagged: out.length, concern: out.filter((x) => x.classification === 'concern').length, needsInvestigation: out.filter((x) => x.classification === 'needs investigation').length,
        noConcernFound: out.filter((x) => x.classification.startsWith('potentially')).length, approved: out.filter((x) => x.status === 'approved').length, issuedReports: out.reduce((n, x) => n + x.issuedReports, 0) },
      revisions: out };
  } finally { await c.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required (owner connection; the check is read-only)');
  const res = await tr08Impact(url);
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res.summary, null, 1));
  for (const r of res.revisions) console.log(`${r.organisation} · ${r.assessment} r${r.revision} (${r.status}): ${r.classification} — ${r.samplesInCalculationNotSelected.map((s: any) => `${s.sampleCode}: ${[...s.concerns, ...s.investigate].join('; ') || 'none'}`).join(' | ')}`);
}
