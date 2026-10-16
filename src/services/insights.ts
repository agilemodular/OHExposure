import { many, one, withActor, type Actor } from '../db.js';

/** Portfolio overview. Counts are separate dimensions, never collapsed into a single status. */
export async function dashboard(a: Actor) {
  return withActor(a, async (tx) => {
    const n = async (sql: string, p: unknown[] = []) => (await one(tx, sql, p))?.n ?? 0;
    return {
      counts: {
        sites: await n('select count(*)::int n from sites'),
        groups: await n('select count(*)::int n from exposure_groups'),
        groupsNeedingReview: await n('select count(*)::int n from exposure_groups where review_required'),
        hazardsOverdue: await n('select count(*)::int n from hazards where review_due < current_date'),
        plansActive: await n(`select count(*)::int n from monitoring_plans where status in ('reviewed','scheduled','in_progress')`),
        samplesAwaitingResults: await n(`select count(*)::int n from sampling_events where status in ('collected','dispatched','received')`),
        unresolvedQc: await n(`select count(*)::int n from sample_qc_checks where outcome='fail' and disposition is null`),
        instrumentsCalibrationIssue: await n(`select count(*)::int n from instruments i where status='in_service' and not exists (select 1 from calibrations c where c.instrument_id=i.id and c.valid_until >= current_date and c.outcome <> 'fail')`),
        assessmentsInReview: await n(`select count(*)::int n from assessment_revisions where status='in_review'`),
        assessmentsDraft: await n(`select count(*)::int n from assessment_revisions where status='draft'`),
        atOrAbove: await n(`select count(*)::int n from assessments a join assessment_revisions r on r.assessment_id=a.id and r.status='approved' where r.benchmark_state='at_or_above_benchmark'`),
        actionsOpen: await n(`select count(*)::int n from actions where status not in ('verified_closed','cancelled')`),
        actionsOverdue: await n(`select count(*)::int n from actions where status not in ('verified_closed','cancelled') and due_date < current_date`),
        verificationQueue: await n(`select count(*)::int n from actions where status in ('evidence_submitted','effectiveness_reviewed')`),
        controlsDefective: await n(`select count(*)::int n from controls where status='defective'`),
        controlsUnverified: await n(`select count(*)::int n from controls c where c.status in ('proposed','in_service') and not exists (select 1 from actions x where x.control_id=c.id and x.status='verified_closed') and not exists (select 1 from control_inspections i where i.control_id=c.id and i.outcome='satisfactory' and i.kind in ('thorough_examination_test','performance_test','commissioning'))`),
        syncConflicts: await n(`select count(*)::int n from sync_conflicts where status='open'`),
      },
      assessmentStates: await many(tx, `select r.data_quality_state, r.benchmark_state, r.status, count(*)::int n from assessments a join assessment_revisions r on r.assessment_id=a.id and r.revision=a.current_revision group by 1,2,3 order by 4 desc`),
      overdueActions: await many(tx, `select x.id, x.title, x.due_date, x.priority, u.name owner_name from actions x left join users u on u.id=x.owner_user_id where x.status not in ('verified_closed','cancelled') and x.due_date < current_date order by x.due_date limit 10`),
      reviewGroups: await many(tx, `select id, name, review_reason from exposure_groups where review_required order by name limit 10`),
      gaps: await evidenceGaps(tx),
    };
  });
}

/** Deterministic missing-evidence checks (rule-based, not AI). */
export async function evidenceGaps(tx: any) {
  const gaps: { severity: 'high' | 'medium'; message: string; href: string }[] = [];
  for (const r of await many(tx, `select e.id, e.sample_code from sampling_events e where e.status in ('collected','dispatched','received','analysed') and e.sample_type='personal' and (e.flow_pre_lpm is null or e.flow_post_lpm is null) and e.method_version_id in (select id from sampling_method_versions where result_basis='mass_on_sample') limit 20`))
    gaps.push({ severity: 'high', message: `Sample ${r.sample_code}: pre/post flow missing — air volume cannot be calculated`, href: `/samples/${r.id}` });
  for (const r of await many(tx, `select e.id, e.sample_code, i.asset_tag from sampling_events e join instruments i on i.id=e.instrument_id where e.start_at is not null and e.status <> 'void'
      and not exists (select 1 from calibrations c where c.instrument_id=e.instrument_id and c.performed_at <= e.start_at::date and c.valid_until >= e.start_at::date and c.outcome <> 'fail') limit 20`))
    gaps.push({ severity: 'high', message: `Sample ${r.sample_code}: no valid calibration evidence for ${r.asset_tag} on the sampling date`, href: `/samples/${r.id}` });
  for (const r of await many(tx, `select q.sampling_event_id id, e.sample_code, q.check_type from sample_qc_checks q join sampling_events e on e.id=q.sampling_event_id where q.outcome='fail' and q.disposition is null limit 20`))
    gaps.push({ severity: 'high', message: `Sample ${r.sample_code}: failed "${r.check_type}" check has no disposition`, href: `/samples/${r.id}` });
  for (const r of await many(tx, `select e.id, e.sample_code from sampling_events e where e.status='analysed' and not exists (select 1 from lab_results r join lab_result_revisions v on v.result_id=r.id and v.revision=r.current_revision where r.sampling_event_id=e.id and v.source_attachment_id is not null) limit 20`))
    gaps.push({ severity: 'medium', message: `Sample ${r.sample_code}: laboratory result has no source certificate attached`, href: `/samples/${r.id}` });
  for (const r of await many(tx, `select e.id, e.sample_code from sampling_events e where e.sample_type='personal' and e.status not in ('planned','void') and e.group_id_at_sampling is null limit 20`))
    gaps.push({ severity: 'medium', message: `Sample ${r.sample_code}: no exposure group recorded at time of sampling`, href: `/samples/${r.id}` });
  for (const r of await many(tx, `select id, name from controls where kind in ('local_exhaust_ventilation','enclosure') and status='in_service' and not exists (select 1 from control_inspections i where i.control_id=controls.id and i.kind='thorough_examination_test' and i.at > current_date - interval '14 months') limit 20`))
    gaps.push({ severity: 'medium', message: `Control "${r.name}": no thorough examination/test recorded in the last 14 months`, href: `/controls/${r.id}` });
  return gaps;
}

export async function calendar(a: Actor, from: string, to: string) {
  return withActor(a, async (tx) => ({
    plans: await many(tx, `select p.id, p.title, p.status, p.planned_start, p.planned_end, s.name site_name from monitoring_plans p join sites s on s.id=p.site_id
      where p.status <> 'cancelled' and coalesce(p.planned_end, p.planned_start) >= $1::date and p.planned_start <= $2::date order by p.planned_start`, [from, to]),
    hazardReviews: await many(tx, `select h.id, h.review_due, sb.name substance_name from hazards h join substances sb on sb.id=h.substance_id where h.review_due between $1::date and $2::date`, [from, to]),
    actionsDue: await many(tx, `select id, title, due_date, status from actions where status not in ('verified_closed','cancelled') and due_date between $1::date and $2::date`, [from, to]),
    calibrationsDue: await many(tx, `select i.id, i.asset_tag, max(c.valid_until) valid_until from instruments i join calibrations c on c.instrument_id=i.id where i.status='in_service' group by i.id, i.asset_tag having max(c.valid_until) between $1::date and $2::date`, [from, to]),
  }));
}

export async function verificationQueue(a: Actor) {
  return withActor(a, async (tx) => ({
    assessments: await many(tx, `select r.id, r.revision, a.id assessment_id, a.title, r.submitted_at, u.name submitted_by_name, r.data_quality_state, r.benchmark_state
      from assessment_revisions r join assessments a on a.id=r.assessment_id left join users u on u.id=r.submitted_by where r.status='in_review' order by r.submitted_at`),
    actions: await many(tx, `select x.id, x.title, x.status, x.verification_requirement, u.name owner_name from actions x left join users u on u.id=x.owner_user_id where x.status in ('evidence_submitted','effectiveness_reviewed') order by x.created_at`),
    plans: await many(tx, `select p.id, p.title, p.created_at, u.name author from monitoring_plans p left join users u on u.id=p.created_by where p.status='draft' and exists (select 1 from plan_targets t where t.plan_id=p.id) order by p.created_at`),
    benchmarks: await many(tx, `select v.id, v.value, v.unit, v.source_title, s.name substance_name, b.benchmark_type from benchmark_versions v join benchmarks b on b.id=v.benchmark_id join substances s on s.id=b.substance_id where v.verification_status='unverified' and v.tenant_id is not null`),
    conflicts: await many(tx, `select id, entity_id, submitted_at from sync_conflicts where status='open'`),
    qc: await many(tx, `select q.id, q.check_type, e.sample_code, e.id sample_id from sample_qc_checks q join sampling_events e on e.id=q.sampling_event_id where q.outcome='fail' and q.disposition is null`),
  }));
}
