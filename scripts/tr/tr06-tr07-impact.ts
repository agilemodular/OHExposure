// TR-06 / TR-07 impact scan (engine 1.5.0). READ-ONLY: runs in a read-only transaction and changes nothing.
// Identifies
//   1. duplicate evidence dispositions without sufficient relationship evidence (no category, or a relationship the
//      1.5.0 rules do not support with the records as they stand);
//   2. contradictory detected-below-LOQ laboratory records (current or superseded revisions);
//   3. assessment revisions and reports (issued or draft) that depend on either.
// For every dependent revision with frozen inputs it re-runs the current engine on those inputs, read-only, and
// distinguishes a CONFIRMED CHANGED OUTCOME (overall comparison or data quality differs, with a TR-06/TR-07 marker on an
// affected sample) from POTENTIALLY AFFECTED (depends on an affected record; outcome not changed, or not calculated).
// Corrections use the existing workflow: a new revision with a reason (approvals do not transfer), result amendments,
// and report supersession. Nothing is amended here.
//   DATABASE_ADMIN_URL=… npx tsx scripts/tr/tr06-tr07-impact.ts [--json out.json]
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { CALCULATIONS, ENGINE_VERSION, duplicateProblem, qualifierValueProblem, runAssessment, sampleConcentration, type CalcCode, type SampleInput } from '../../src/calc/engine.js';

const isTr0607 = (code: string) => code === 'INPUT_INVALID_DBL_VALUE' || code === 'INPUT_INVALID_VALUE_MEANING';

export async function tr0607Impact(adminUrl: string) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('begin transaction read only');
    // ── 1. Duplicate dispositions (every row, including superseded ones; the latest row per sample applies).
    const dups = (await c.query(`select d.id, d.revision_id, d.duplicate_type, d.reason, d.consequence, d.recorded_at, u.name recorded_by, u.role recorder_role,
        s.id s_id, s.sample_code s_code, s.worker_id s_worker, s.group_id_at_sampling s_group, s.tasks_performed s_tasks, s.pair_ref s_pair, s.shift_ref s_shift, s.timezone s_tz, s.start_at s_start, s.end_at s_end, s.instrument_id s_inst, s.sample_type s_type,
        t.id t_id, t.sample_code t_code, t.worker_id t_worker, t.group_id_at_sampling t_group, t.tasks_performed t_tasks, t.pair_ref t_pair, t.shift_ref t_shift, t.timezone t_tz, t.start_at t_start, t.end_at t_end, t.instrument_id t_inst, t.sample_type t_type,
        a.substance_id, r.status revision_status, r.revision, a.title assessment, tn.name organisation,
        exists (select 1 from lab_results x where x.sampling_event_id=s.id and x.substance_id=a.substance_id) s_has_result,
        exists (select 1 from lab_results x where x.sampling_event_id=t.id and x.substance_id=a.substance_id) t_has_result,
        d.seq = (select max(seq) from assessment_evidence_dispositions z where z.revision_id=d.revision_id and z.sampling_event_id=d.sampling_event_id) is_latest
      from assessment_evidence_dispositions d join users u on u.id=d.recorded_by join sampling_events s on s.id=d.sampling_event_id
      left join sampling_events t on t.id=d.related_sampling_event_id join assessment_revisions r on r.id=d.revision_id join assessments a on a.id=r.assessment_id join tenants tn on tn.id=d.tenant_id
      where d.kind='duplicate' order by tn.name, a.title, r.revision, d.seq`)).rows;
    const ev = (p: 's' | 't', x: any): { input: SampleInput; output: ReturnType<typeof sampleConcentration> } => {
      const input: SampleInput = { sampleId: x[`${p}_id`], sampleCode: x[`${p}_code`], sampleType: x[`${p}_type`], subjectRef: x[`${p}_worker`], startAt: x[`${p}_start`]?.toISOString() ?? null, endAt: x[`${p}_end`]?.toISOString() ?? null,
        timezone: x[`${p}_tz`], shiftRef: x[`${p}_shift`], substanceRef: x[`${p}_has_result`] ? x.substance_id : null, groupRef: x[`${p}_group`], tasksPerformed: x[`${p}_tasks`], pairRef: x[`${p}_pair`],
        interruptions: [], flowPreLpm: null, flowPostLpm: null, method: null, instrument: x[`${p}_inst`] ? { assetTag: x[`${p}_inst`], screeningOnly: false, calibrationValidAtSampling: true } : null, qc: [], result: null };
      return { input, output: sampleConcentration(input) };
    };
    const duplicateFindings = dups.map((x) => {
      // Relationship evidence as recorded now (results are compared at calculation; see the revision section below).
      const p = !x.t_id ? { problem: 'no related sample recorded', conflict: false }
        : duplicateProblem({ kind: 'duplicate', reason: x.reason, consequence: x.consequence, authorisedBy: x.recorded_by, relatedSampleCode: x.t_code, duplicateType: x.duplicate_type }, ev('s', x), ev('t', x));
      return { dispositionId: x.id, organisation: x.organisation, assessment: x.assessment, revision: x.revision, revisionStatus: x.revision_status, sample: x.s_code, relatedSample: x.t_code,
        duplicateType: x.duplicate_type, recordedBy: x.recorded_by, recorderRole: x.recorder_role, recordedAt: x.recorded_at, reason: x.reason, consequence: x.consequence, latestForSample: x.is_latest,
        sufficientRelationshipEvidence: !p, problem: p?.problem ?? null };
    });

    // ── 2. Contradictory detected-below-LOQ (and value-meaning) laboratory records.
    const labs = (await c.query(`select v.id, v.revision, v.value::float8 value, v.lod::float8 lod, v.loq::float8 loq, v.unit, v.qualifier, v.lab_qualifier, v.value_meaning, v.entered_at, v.amendment_reason,
        r.current_revision, e.sample_code, s.name substance, tn.name organisation, r.sampling_event_id, r.substance_id
      from lab_result_revisions v join lab_results r on r.id=v.result_id join sampling_events e on e.id=r.sampling_event_id join substances s on s.id=r.substance_id join tenants tn on tn.id=v.tenant_id
      where v.qualifier='detected_below_loq' or v.value_meaning is not null order by tn.name, e.sample_code, v.revision`)).rows;
    const labFindings = labs.map((v) => ({ ...v, problem: qualifierValueProblem({ qualifier: v.qualifier, value: v.value, lod: v.lod, loq: v.loq, unit: v.unit, valueMeaning: v.value_meaning, labQualifier: v.lab_qualifier }) }))
      .filter((v) => v.problem).map((v) => ({ resultRevisionId: v.id, organisation: v.organisation, sample: v.sample_code, substance: v.substance, revision: v.revision, current: v.revision === v.current_revision,
        qualifier: v.qualifier, labQualifier: v.lab_qualifier, value: v.value, valueMeaning: v.value_meaning, lod: v.lod, loq: v.loq, unit: v.unit, enteredAt: v.entered_at, problem: v.problem!.message,
        status: v.revision === v.current_revision ? 'current — awaiting laboratory clarification and amendment' : 'superseded by a later amendment (kept as evidence)' }));

    // ── 3. Dependent assessment revisions and reports.
    const dupRevIds = new Set(dups.filter((x, i) => !duplicateFindings[i].sufficientRelationshipEvidence && x.is_latest).map((x) => x.revision_id));
    const labRevIds = new Set(labFindings.map((l) => l.resultRevisionId));
    const revs = (await c.query(`select r.id, r.revision, r.status, coalesce(r.calc_code,'twa_8h') calc_code, r.calc_version, r.benchmark_state, r.data_quality_state, r.inputs_snapshot, r.approved_at, r.sample_ids,
        a.title assessment, tn.name organisation, r.supersedes_revision_id,
        coalesce((select json_agg(json_build_object('id', p.id, 'status', p.status, 'generated_at', p.generated_at) order by p.generated_at) from reports p where p.assessment_revision_id=r.id), '[]') reports
      from assessment_revisions r join assessments a on a.id=r.assessment_id join tenants tn on tn.id=r.tenant_id order by tn.name, a.title, r.revision`)).rows;
    const revisions = [];
    for (const r of revs) {
      const snap = r.inputs_snapshot;
      const viaDup = dupRevIds.has(r.id) || (snap?.samples ?? []).some((s: any) => s.evidenceDisposition?.kind === 'duplicate');
      const viaLab = (snap?.refs ?? []).some((x: any) => labRevIds.has(x.resultRevisionId));
      // Drafts without a calculation: dependency through their current sample list and dispositions.
      const viaLabNoSnap = !snap && (r.sample_ids ?? []).some((sid: string) => labFindings.some((l) => l.current && labs.find((v) => v.id === l.resultRevisionId)?.sampling_event_id === sid));
      if (!viaDup && !viaLab && !viaLabNoSnap) continue;
      const calc = CALCULATIONS[r.calc_code as CalcCode];
      let recomputed: any = null, markers: string[] = [], changed: boolean | null = null;
      if (snap && calc) {
        const now = runAssessment({ calc: calc.code, samples: snap.samples, parameters: { ...snap.parameters, ...(snap.exposureRecords ? { exposureRecords: snap.exposureRecords } : { recordedExposureMinutes: snap.recordedExposureMinutes ?? undefined }) }, benchmark: snap.benchmark, molecularWeight: snap.molecularWeight });
        markers = [...now.unresolvedEvidence.filter((u) => u.rejectedDisposition?.kind === 'duplicate').map((u) => `TR-06: duplicate disposition for ${u.sampleCode} not accepted (${u.rejectedDisposition!.problem})`),
          ...now.samples.flatMap((s) => s.flags.filter((f) => isTr0607(f.code)).map((f) => `TR-07: ${s.sampleCode} ${f.code}`))];
        changed = now.benchmarkState !== r.benchmark_state || now.dataQualityState !== r.data_quality_state;
        recomputed = { engine: ENGINE_VERSION, calcVersion: calc.version, benchmark: now.benchmarkState, dataQuality: now.dataQualityState, evidenceAdequacy: now.evidenceAdequacy, calculationAvailability: now.calculationAvailability };
      }
      const confirmed = !!changed && markers.length > 0;
      const issued = (r.reports as any[]).filter((p) => p.status === 'issued');
      revisions.push({
        organisation: r.organisation, assessment: r.assessment, revision: r.revision, status: r.status, calculatedWith: r.calc_version ? `${r.calc_code} ${r.calc_version}` : 'not calculated',
        dependsOn: [...(viaDup ? ['duplicate disposition (TR-06)'] : []), ...(viaLab || viaLabNoSnap ? ['contradictory detected-below-LOQ record (TR-07)'] : [])],
        stored: { benchmark: r.benchmark_state, dataQuality: r.data_quality_state }, recomputedFromFrozenInputs: recomputed, markers,
        classification: confirmed ? 'confirmed changed outcome' : 'potentially affected',
        reports: r.reports, issuedReports: issued.length,
        action: r.status === 'approved'
          ? `${confirmed ? 'Outcome changes under 1.5.0. ' : ''}Review; reassess through a new revision with a reason (the approval does not transfer)${issued.length ? `; supersede the ${issued.length} issued report(s) once a new revision is approved` : ''}. The approved revision and its reports are not altered.`
          : r.status === 'in_review' ? 'Return to draft and recalculate (the evidence hash will not match).'
          : r.status === 'draft' ? 'Recalculate; resolve the disposition or amend the laboratory result.' : 'Historical (superseded); no action beyond the current revision.',
      });
    }
    await c.query('rollback');
    return {
      generated: new Date().toISOString(), engine: ENGINE_VERSION, methods: Object.fromEntries(Object.entries(CALCULATIONS).map(([k, v]) => [k, v.version])), readOnly: true,
      summary: {
        duplicateDispositions: duplicateFindings.length, duplicateDispositionsInsufficient: duplicateFindings.filter((d) => !d.sufficientRelationshipEvidence).length,
        contradictoryLabRecords: labFindings.length, contradictoryLabRecordsCurrent: labFindings.filter((l) => l.current).length,
        dependentRevisions: revisions.length, confirmedChangedOutcomes: revisions.filter((r) => r.classification === 'confirmed changed outcome').length,
        potentiallyAffected: revisions.filter((r) => r.classification === 'potentially affected').length,
        approvedRevisionsAffected: revisions.filter((r) => r.status === 'approved').length, issuedReportsAffected: revisions.reduce((n, r) => n + r.issuedReports, 0),
      },
      duplicateDispositions: duplicateFindings, contradictoryLabRecords: labFindings, revisions,
    };
  } finally { await c.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required (owner connection; the scan is read-only)');
  const res = await tr0607Impact(url);
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res.summary, null, 1));
  for (const r of res.revisions) console.log(`${r.organisation} · ${r.assessment} r${r.revision} (${r.status}, ${r.calculatedWith}): ${r.stored.benchmark} → ${r.recomputedFromFrozenInputs?.benchmark ?? 'n/a'} [${r.classification}] — ${r.action}`);
}
