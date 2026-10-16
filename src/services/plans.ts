import { z } from 'zod';
import { audit, can, many, one, requirePerm, withActor, type Actor } from '../db.js';
import { conflict, forbidden, invalid, notFound } from '../errors.js';
import { optDate, optNum, optStr, optUuid, parse, reqStr, strArray, uuid } from './util.js';

const planSchema = z.object({
  site_id: uuid,
  title: reqStr(3, 200),
  purpose: reqStr(10),
  assessment_question: reqStr(10),
  approach: z.enum(['personal', 'static', 'mixed', 'other']),
  strategy_rationale: reqStr(20).describe('Why this sampling strategy, number and duration of samples answer the question'),
  intended_duration_min: optNum,
  coverage_notes: optStr,
  lab_requirements: optStr,
  operating_conditions: optStr,
  quality_checks: optStr,
  practitioner_id: optUuid,
  reviewer_id: optUuid,
  planned_start: optDate,
  planned_end: optDate,
  instrument_ids: strArray,
});
const targetSchema = z.object({ group_id: optUuid, substance_id: uuid, method_version_id: optUuid, planned_samples: optNum, notes: optStr });

export async function createPlan(a: Actor, input: unknown) {
  requirePerm(a, 'plans.write');
  const d = parse(planSchema, input);
  return withActor(a, async (tx) => {
    const site = await one(tx, 'select client_id from sites where id=$1', [d.site_id]);
    if (!site) throw notFound('Site');
    const p = await one(tx, `insert into monitoring_plans (tenant_id,client_id,site_id,title,purpose,assessment_question,approach,strategy_rationale,intended_duration_min,coverage_notes,lab_requirements,operating_conditions,quality_checks,practitioner_id,reviewer_id,planned_start,planned_end,created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
      [a.tenantId, site.client_id, d.site_id, d.title, d.purpose, d.assessment_question, d.approach, d.strategy_rationale, d.intended_duration_min, d.coverage_notes, d.lab_requirements, d.operating_conditions, d.quality_checks, d.practitioner_id ?? a.userId, d.reviewer_id, d.planned_start, d.planned_end, a.userId]);
    for (const i of d.instrument_ids) await tx.query('insert into plan_instruments (tenant_id,plan_id,instrument_id) values ($1,$2,$3)', [a.tenantId, p.id, i]);
    await audit(tx, a, 'plan.create', 'monitoring_plan', p.id, d);
    return p;
  });
}

/** Editing a reviewed or scheduled plan returns it to draft: the change must be reviewed again. */
export async function updatePlan(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'plans.write');
  const d = parse(planSchema.extend({ version: z.coerce.number().int() }), input);
  return withActor(a, async (tx) => {
    const p = await one(tx, 'select * from monitoring_plans where id=$1 for update', [id]);
    if (!p) throw notFound('Plan');
    if (['in_progress', 'completed', 'cancelled'].includes(p.status)) throw invalid(`A ${p.status.replace('_', ' ')} plan cannot be edited; record deviations on sampling events or create a new plan.`);
    if (p.version !== d.version) throw conflict('This plan was changed by someone else. Reload and reapply your changes.');
    const backToDraft = p.status !== 'draft';
    const r = await one(tx, `update monitoring_plans set title=$2,purpose=$3,assessment_question=$4,approach=$5,strategy_rationale=$6,intended_duration_min=$7,coverage_notes=$8,lab_requirements=$9,operating_conditions=$10,quality_checks=$11,practitioner_id=$12,reviewer_id=$13,planned_start=$14,planned_end=$15,
        status='draft', reviewed_by=case when $16 then null else reviewed_by end, reviewed_at=case when $16 then null else reviewed_at end, version=version+1 where id=$1 returning *`,
      [id, d.title, d.purpose, d.assessment_question, d.approach, d.strategy_rationale, d.intended_duration_min, d.coverage_notes, d.lab_requirements, d.operating_conditions, d.quality_checks, d.practitioner_id, d.reviewer_id, d.planned_start, d.planned_end, backToDraft]);
    await tx.query('delete from plan_instruments where plan_id=$1', [id]);
    for (const i of d.instrument_ids) await tx.query('insert into plan_instruments (tenant_id,plan_id,instrument_id) values ($1,$2,$3)', [a.tenantId, id, i]);
    await audit(tx, a, backToDraft ? 'plan.update_reverted_to_draft' : 'plan.update', 'monitoring_plan', id, { before: p, after: d });
    return r;
  });
}

export async function addTarget(a: Actor, planId: string, input: unknown) {
  requirePerm(a, 'plans.write');
  const d = parse(targetSchema, input);
  return withActor(a, async (tx) => {
    const p = await one(tx, 'select status from monitoring_plans where id=$1', [planId]);
    if (!p) throw notFound('Plan');
    if (p.status !== 'draft') throw invalid('Targets can only be changed while the plan is in draft');
    const r = await one(tx, 'insert into plan_targets (tenant_id,plan_id,group_id,substance_id,method_version_id,planned_samples,notes) values ($1,$2,$3,$4,$5,$6,$7) returning *',
      [a.tenantId, planId, d.group_id, d.substance_id, d.method_version_id, d.planned_samples, d.notes]);
    await audit(tx, a, 'plan.target_add', 'monitoring_plan', planId, d);
    return r;
  });
}

const TRANSITIONS: Record<string, string[]> = {
  draft: ['reviewed', 'cancelled'],
  reviewed: ['scheduled', 'draft', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function transitionPlan(a: Actor, id: string, input: unknown) {
  const d = parse(z.object({ to: z.enum(['draft', 'reviewed', 'scheduled', 'in_progress', 'completed', 'cancelled']), reason: optStr }), input);
  return withActor(a, async (tx) => {
    const p = await one(tx, 'select * from monitoring_plans where id=$1 for update', [id]);
    if (!p) throw notFound('Plan');
    if (!TRANSITIONS[p.status].includes(d.to)) throw invalid(`Cannot move a plan from ${p.status} to ${d.to}`);
    if (d.to === 'reviewed') {
      requirePerm(a, 'plans.review');
      if (p.created_by === a.userId) throw forbidden('A plan must be reviewed by someone other than its author');
      const t = await one(tx, 'select count(*)::int n from plan_targets where plan_id=$1', [id]);
      if (!t.n) throw invalid('Add at least one target substance before review');
    } else if (d.to === 'cancelled') {
      if (!can(a, 'plans.write') && !can(a, 'plans.review')) throw forbidden();
      if (!d.reason) throw invalid('A cancellation reason is required');
    } else {
      if (!can(a, 'plans.write') && !(d.to === 'in_progress' && can(a, 'field.capture'))) throw forbidden();
    }
    if (d.to === 'completed') {
      const open = await one(tx, `select count(*)::int n from sampling_events where plan_id=$1 and status in ('planned','in_progress')`, [id]);
      if (open.n) throw invalid(`${open.n} sampling event(s) are still planned or in progress; complete or void them first`);
    }
    const r = await one(tx, `update monitoring_plans set status=$2, cancelled_reason=coalesce($3,cancelled_reason),
        reviewed_by=case when $2='reviewed' then $4::uuid else reviewed_by end, reviewed_at=case when $2='reviewed' then now() else reviewed_at end,
        version=version+1 where id=$1 returning *`, [id, d.to, d.reason, a.userId]);
    await audit(tx, a, `plan.${d.to}`, 'monitoring_plan', id, { from: p.status, reason: d.reason });
    return r;
  });
}

export async function listPlans(a: Actor) {
  return withActor(a, (tx) => many(tx, `select p.*, s.name site_name, u.name practitioner_name,
      (select count(*) from sampling_events e where e.plan_id=p.id)::int sample_count
    from monitoring_plans p join sites s on s.id=p.site_id left join users u on u.id=p.practitioner_id
    order by coalesce(p.planned_start, p.created_at::date) desc`));
}

export async function planDetail(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const plan = await one(tx, `select p.*, s.name site_name, u.name practitioner_name, r.name reviewer_name, rb.name reviewed_by_name
      from monitoring_plans p join sites s on s.id=p.site_id left join users u on u.id=p.practitioner_id left join users r on r.id=p.reviewer_id left join users rb on rb.id=p.reviewed_by where p.id=$1`, [id]);
    if (!plan) throw notFound('Plan');
    return {
      plan,
      targets: await many(tx, `select t.*, s.name substance_name, g.name group_name, m.code method_code, mv.version method_version
        from plan_targets t join substances s on s.id=t.substance_id left join exposure_groups g on g.id=t.group_id
        left join sampling_method_versions mv on mv.id=t.method_version_id left join sampling_methods m on m.id=mv.method_id where t.plan_id=$1`, [id]),
      instruments: await many(tx, 'select i.* from plan_instruments pi join instruments i on i.id=pi.instrument_id where pi.plan_id=$1', [id]),
      samples: await many(tx, `select e.*, w.ref_code worker_ref, s.name substance_name from sampling_events e left join workers w on w.id=e.worker_id left join substances s on s.id=e.substance_id where e.plan_id=$1 order by e.start_at nulls last, e.sample_code`, [id]),
    };
  });
}
