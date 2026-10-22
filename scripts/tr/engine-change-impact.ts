// Identifies assessment revisions calculated with an earlier engine/method version and shows, read-only, how the
// current engine would treat the same frozen inputs. Nothing is changed: approved revisions, outputs and reports stay
// as they are. Reassessment is done by creating a new revision (traceable, with a reason), never by recalculating in place.
//   DATABASE_ADMIN_URL=… npx tsx scripts/tr/engine-change-impact.ts [--json out.json]
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { CALCULATIONS, ENGINE_VERSION, runAssessment, type CalcCode } from '../../src/calc/engine.js';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL is required (owner connection, read-only use)');
const SCENARIOS: [string, RegExp][] = [
  ['TR-01 STEL timing', /^STEL_(SAMPLE_TOO_LONG|WINDOW_TOO_LONG|SAMPLE_SHORT|REMAINDER_EVIDENCE_REQUIRED|ZERO_REMAINDER)$/],
  ['TR-03 input validation', /^INPUT_INVALID_/],
  ['TR-05 method acceptance', /^(ACCEPTANCE_RULE_UNDEFINED|FLOW_DRIFT_|VOLUME_BELOW_MIN_)/],
  ['A shift association', /^SHIFT_ASSOCIATION_REQUIRED$/],
  ['B exposure duration', /^EXPOSURE_(OVERLAP_UNKNOWN|DURATION_ESTIMATED|BELOW_RECORDED)$/],
  ['C below-LOQ semantics', /^BELOW_LOQ$/],
];

export async function engineChangeImpact(adminUrl: string) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    const rows = (await c.query(`select r.id, t.name organisation, a.title assessment, r.revision, r.status, coalesce(r.calc_code,'twa_8h') calc_code, r.calc_version,
        r.data_quality_state, r.benchmark_state, r.inputs_snapshot, r.parameters, r.approved_at,
        (select count(*)::int from reports p where p.assessment_revision_id = r.id and p.status='issued') issued_reports
      from assessment_revisions r join assessments a on a.id=r.assessment_id join tenants t on t.id=r.tenant_id
      where r.calc_output is not null order by t.name, a.title, r.revision`)).rows;
    const out = [];
    for (const r of rows) {
      const calc = CALCULATIONS[r.calc_code as CalcCode];
      if (!calc || r.calc_version === calc.version || !r.inputs_snapshot) continue;
      const s = r.inputs_snapshot;
      const now = runAssessment({ calc: calc.code, samples: s.samples, parameters: { ...s.parameters, ...(s.exposureRecords ? { exposureRecords: s.exposureRecords } : { recordedExposureMinutes: s.recordedExposureMinutes ?? undefined }) }, benchmark: s.benchmark, molecularWeight: s.molecularWeight });
      const codes = new Set([...now.samples.flatMap((x) => x.flags), ...now.shifts.flatMap((x) => x.flags)].map((f) => f.code));
      const scenarios = SCENARIOS.filter(([, re]) => [...codes].some((k) => re.test(k))).map(([n]) => n);
      if (now.unresolvedEvidence.length) scenarios.push('TR-02 unresolved evidence');
      const changed = now.benchmarkState !== r.benchmark_state || now.dataQualityState !== r.data_quality_state;
      if (changed && !scenarios.length) scenarios.push('TR-04 precision or other classification change');
      out.push({
        organisation: r.organisation, assessment: r.assessment, revision: r.revision, status: r.status, issuedReports: r.issued_reports,
        calculatedWith: `${r.calc_code} ${r.calc_version}`, currentVersion: `${calc.code} ${calc.version} (engine ${ENGINE_VERSION})`,
        before: { dataQuality: r.data_quality_state, benchmark: r.benchmark_state },
        withCurrentEngine: { dataQuality: now.dataQualityState, benchmark: now.benchmarkState, evidenceAdequacy: now.evidenceAdequacy, calculationAvailability: now.calculationAvailability },
        classificationChanged: changed, scenarios,
        action: r.status === 'approved' ? (changed || scenarios.length ? 'Review: create a new revision with a reason if reassessment is needed; the approval does not transfer to the new method version.' : 'No change in classification; reassessment at the next review.')
          : r.status === 'in_review' ? 'Return to draft and recalculate before approval (evidence hash will not match).'
          : r.status === 'draft' ? 'Recalculate.' : 'Historical; no action.',
      });
    }
    return out;
  } finally { await c.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await engineChangeImpact(url);
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({ generated: new Date().toISOString(), engine: ENGINE_VERSION, revisions: res }, null, 2));
  for (const r of res) console.log(`${r.organisation} · ${r.assessment} r${r.revision} (${r.status}, ${r.calculatedWith}): ${r.before.benchmark} → ${r.withCurrentEngine.benchmark}; ${r.scenarios.join('; ') || 'no scenario'} — ${r.action}`);
  console.log(`${res.length} revision(s) calculated with an earlier version.`);
}
