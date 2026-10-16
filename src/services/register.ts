import { z } from 'zod';
import { audit, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { invalid, notFound } from '../errors.js';
import { optDate, optNum, optStr, optUuid, parse, reqStr, strArray, uuid } from './util.js';

const BASIS = z.enum(['recorded_fact', 'user_estimate', 'professionally_reviewed']);

// ───── Sites & hierarchy
export async function createSite(a: Actor, input: unknown) {
  requirePerm(a, 'sites.write');
  const d = parse(z.object({ client_id: optUuid, name: reqStr(2, 200), reference: optStr, address: optStr }), input);
  return withActor(a, async (tx) => {
    const clientId = a.clientId ?? d.client_id ?? (await one(tx, 'select id from clients where is_default limit 1'))?.id;
    if (!clientId) throw invalid('Select a client for this site');
    const r = await one(tx, 'insert into sites (tenant_id,client_id,name,reference,address) values ($1,$2,$3,$4,$5) returning *', [a.tenantId, clientId, d.name, d.reference, d.address]);
    await audit(tx, a, 'site.create', 'site', r.id, d);
    return r;
  });
}

async function parentClient(tx: Tx, table: string, id: string) {
  const r = await one(tx, `select client_id from ${table} where id=$1`, [id]);
  if (!r) throw notFound(table.replace(/s$/, ''));
  return r.client_id as string;
}

export async function createWorkArea(a: Actor, input: unknown) {
  requirePerm(a, 'sites.write');
  const d = parse(z.object({ site_id: uuid, name: reqStr(2, 200), description: optStr }), input);
  return withActor(a, async (tx) => {
    const c = await parentClient(tx, 'sites', d.site_id);
    const r = await one(tx, 'insert into work_areas (tenant_id,client_id,site_id,name,description) values ($1,$2,$3,$4,$5) returning *', [a.tenantId, c, d.site_id, d.name, d.description]);
    await audit(tx, a, 'work_area.create', 'work_area', r.id, d);
    return r;
  });
}

export async function createProcess(a: Actor, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(z.object({ work_area_id: uuid, name: reqStr(2, 200), description: optStr }), input);
  return withActor(a, async (tx) => {
    const c = await parentClient(tx, 'work_areas', d.work_area_id);
    const r = await one(tx, 'insert into processes (tenant_id,client_id,work_area_id,name,description) values ($1,$2,$3,$4,$5) returning *', [a.tenantId, c, d.work_area_id, d.name, d.description]);
    await audit(tx, a, 'process.create', 'process', r.id, d);
    return r;
  });
}

const taskSchema = z.object({ name: reqStr(2, 200), description: optStr, frequency: optStr, duration_min_per_shift: optNum, duration_basis: BASIS.default('user_estimate') });
export async function createTask(a: Actor, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(taskSchema.extend({ process_id: uuid }), input);
  return withActor(a, async (tx) => {
    const c = await parentClient(tx, 'processes', d.process_id);
    const r = await one(tx, `insert into tasks (tenant_id,client_id,process_id,name,description,frequency,duration_min_per_shift,duration_basis)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [a.tenantId, c, d.process_id, d.name, d.description, d.frequency, d.duration_min_per_shift, d.duration_basis]);
    await audit(tx, a, 'task.create', 'task', r.id, d);
    return r;
  });
}
export async function updateTask(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(taskSchema, input);
  return withActor(a, async (tx) => {
    const before = await one(tx, 'select * from tasks where id=$1', [id]);
    if (!before) throw notFound('Task');
    const r = await one(tx, `update tasks set name=$2,description=$3,frequency=$4,duration_min_per_shift=$5,duration_basis=$6,updated_at=now() where id=$1 returning *`,
      [id, d.name, d.description, d.frequency, d.duration_min_per_shift, d.duration_basis]);
    await flagGroupsForReview(tx, a, `Task "${before.name}" changed`, { taskId: id });
    await audit(tx, a, 'task.update', 'task', id, { before, after: d });
    return r;
  });
}

// ───── Substances (tenant-defined; platform reference rows are read-only)
export async function createSubstance(a: Actor, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(z.object({ name: reqStr(2, 200), cas_number: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{2,7}-\d{2}-\d$/, 'CAS format NNNNNNN-NN-N').optional()).transform((v) => v ?? null), ec_number: optStr }), input);
  return withActor(a, async (tx) => {
    const r = await one(tx, 'insert into substances (tenant_id,name,cas_number,ec_number) values ($1,$2,$3,$4) returning *', [a.tenantId, d.name, d.cas_number, d.ec_number]);
    await audit(tx, a, 'substance.create', 'substance', r.id, d);
    return r;
  });
}

// ───── Hazards (exposure register entries)
const hazardSchema = z.object({
  substance_id: uuid,
  physical_form: z.enum(['dust', 'fume', 'mist', 'vapour', 'gas', 'fibre', 'aerosol', 'other']),
  exposure_routes: strArray.pipe(z.array(z.enum(['inhalation', 'skin', 'ingestion', 'eye'])).min(1)),
  description: optStr,
  exposure_frequency: optStr,
  exposure_duration_min: optNum,
  exposure_basis: BASIS.default('user_estimate'),
  existing_controls: optStr,
  assessment_owner_id: optUuid,
  review_triggers: optStr,
  review_due: optDate,
});
export async function createHazard(a: Actor, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(hazardSchema.extend({ task_id: uuid }), input);
  if (d.exposure_basis === 'professionally_reviewed') requirePerm(a, 'groups.review');
  return withActor(a, async (tx) => {
    const c = await parentClient(tx, 'tasks', d.task_id);
    const r = await one(tx, `insert into hazards (tenant_id,client_id,task_id,substance_id,physical_form,exposure_routes,description,exposure_frequency,exposure_duration_min,exposure_basis,existing_controls,assessment_owner_id,review_triggers,review_due)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [a.tenantId, c, d.task_id, d.substance_id, d.physical_form, d.exposure_routes, d.description, d.exposure_frequency, d.exposure_duration_min, d.exposure_basis, d.existing_controls, d.assessment_owner_id, d.review_triggers, d.review_due]);
    await audit(tx, a, 'hazard.create', 'hazard', r.id, d);
    return r;
  });
}
export async function updateHazard(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(hazardSchema, input);
  if (d.exposure_basis === 'professionally_reviewed') requirePerm(a, 'groups.review');
  return withActor(a, async (tx) => {
    const before = await one(tx, 'select * from hazards where id=$1', [id]);
    if (!before) throw notFound('Hazard');
    const r = await one(tx, `update hazards set substance_id=$2,physical_form=$3,exposure_routes=$4,description=$5,exposure_frequency=$6,exposure_duration_min=$7,exposure_basis=$8,existing_controls=$9,assessment_owner_id=$10,review_triggers=$11,review_due=$12,updated_at=now() where id=$1 returning *`,
      [id, d.substance_id, d.physical_form, d.exposure_routes, d.description, d.exposure_frequency, d.exposure_duration_min, d.exposure_basis, d.existing_controls, d.assessment_owner_id, d.review_triggers, d.review_due]);
    await flagGroupsForReview(tx, a, 'Linked hazard (material, form or controls) changed', { hazardId: id });
    await audit(tx, a, 'hazard.update', 'hazard', id, { before, after: d });
    return r;
  });
}

// ───── Similar exposure groups
export async function createGroup(a: Actor, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(z.object({
    site_id: uuid, name: reqStr(2, 200), description: optStr,
    rationale: reqStr(20, 5000).describe('Why these workers share a similar exposure profile'),
    task_ids: strArray, hazard_ids: strArray,
  }), input);
  return withActor(a, async (tx) => {
    const c = await parentClient(tx, 'sites', d.site_id);
    const g = await one(tx, 'insert into exposure_groups (tenant_id,client_id,site_id,name,description,rationale) values ($1,$2,$3,$4,$5,$6) returning *', [a.tenantId, c, d.site_id, d.name, d.description, d.rationale]);
    await setGroupLinks(tx, a, g.id, d.task_ids, d.hazard_ids);
    await audit(tx, a, 'group.create', 'exposure_group', g.id, d);
    return g;
  });
}
async function setGroupLinks(tx: Tx, a: Actor, groupId: string, taskIds: string[], hazardIds: string[]) {
  await tx.query('delete from exposure_group_tasks where group_id=$1', [groupId]);
  await tx.query('delete from exposure_group_hazards where group_id=$1', [groupId]);
  for (const t of taskIds) {
    if (!(await one(tx, 'select 1 from tasks where id=$1', [t]))) throw notFound('Task');
    await tx.query('insert into exposure_group_tasks (tenant_id,group_id,task_id) values ($1,$2,$3)', [a.tenantId, groupId, t]);
  }
  for (const h of hazardIds) {
    if (!(await one(tx, 'select 1 from hazards where id=$1', [h]))) throw notFound('Hazard');
    await tx.query('insert into exposure_group_hazards (tenant_id,group_id,hazard_id) values ($1,$2,$3)', [a.tenantId, groupId, h]);
  }
}

/** Marks groups linked to a changed task/hazard/control/process as requiring review. */
export async function flagGroupsForReview(tx: Tx, a: Actor, reason: string, by: { taskId?: string; hazardId?: string; groupId?: string; processId?: string }) {
  const ids = await many<{ id: string }>(tx, `
    select distinct g.id from exposure_groups g
    left join exposure_group_tasks gt on gt.group_id=g.id
    left join exposure_group_hazards gh on gh.group_id=g.id
    left join tasks t on t.id=gt.task_id
    where ($1::uuid is not null and gt.task_id=$1) or ($2::uuid is not null and gh.hazard_id=$2)
       or ($3::uuid is not null and g.id=$3) or ($4::uuid is not null and t.process_id=$4)`,
    [by.taskId ?? null, by.hazardId ?? null, by.groupId ?? null, by.processId ?? null]);
  for (const { id } of ids) {
    await tx.query(`update exposure_groups set review_required=true, review_reason=coalesce(review_reason || E'\n','') || $2 where id=$1`, [id, reason]);
    await audit(tx, a, 'group.review_flagged', 'exposure_group', id, { reason });
  }
  return ids.length;
}

export async function reviewGroup(a: Actor, groupId: string, input: unknown) {
  requirePerm(a, 'groups.review');
  const d = parse(z.object({
    outcome: z.enum(['group_still_valid', 'group_revised', 'group_split', 'group_retired']),
    notes: reqStr(10), rationale: optStr, task_ids: strArray.optional(), hazard_ids: strArray.optional(),
  }), input);
  return withActor(a, async (tx) => {
    const g = await one(tx, 'select * from exposure_groups where id=$1', [groupId]);
    if (!g) throw notFound('Exposure group');
    if (d.outcome === 'group_revised') {
      if (!d.rationale || d.rationale.length < 20) throw invalid('A revised group requires an updated rationale (min 20 characters)');
      await tx.query('update exposure_groups set rationale=$2 where id=$1', [groupId, d.rationale]);
      if (d.task_ids || d.hazard_ids) await setGroupLinks(tx, a, groupId, d.task_ids ?? [], d.hazard_ids ?? []);
    }
    const r = await one(tx, 'insert into group_reviews (tenant_id,client_id,group_id,trigger,outcome,notes,reviewed_by) values ($1,$2,$3,$4,$5,$6,$7) returning *',
      [a.tenantId, g.client_id, groupId, g.review_reason ?? 'Scheduled review', d.outcome, d.notes, a.userId]);
    await tx.query('update exposure_groups set review_required=false, review_reason=null, last_reviewed_at=now() where id=$1', [groupId]);
    await audit(tx, a, 'group.reviewed', 'exposure_group', groupId, d);
    return r;
  });
}

// ───── Workers (pseudonymous) and identities (restricted)
export async function createWorker(a: Actor, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(z.object({ client_id: optUuid, ref_code: reqStr(2, 50), full_name: optStr, employee_number: optStr }), input);
  if ((d.full_name || d.employee_number) && !a.perms.has('worker.identity.write')) requirePerm(a, 'worker.identity.write');
  return withActor(a, async (tx) => {
    const clientId = a.clientId ?? d.client_id ?? (await one(tx, 'select id from clients where is_default limit 1'))?.id;
    if (!clientId) throw invalid('Select a client');
    const w = await one(tx, 'insert into workers (tenant_id,client_id,ref_code) values ($1,$2,$3) returning *', [a.tenantId, clientId, d.ref_code]);
    if (d.full_name) await tx.query('insert into worker_identities (worker_id,tenant_id,client_id,full_name,employee_number) values ($1,$2,$3,$4,$5)', [w.id, a.tenantId, clientId, d.full_name, d.employee_number]);
    await audit(tx, a, 'worker.create', 'worker', w.id, { ref_code: d.ref_code, identity_recorded: !!d.full_name });
    return w;
  });
}

export async function addMembership(a: Actor, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(z.object({ group_id: uuid, worker_id: uuid, valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: optStr }), input);
  return withActor(a, async (tx) => {
    const g = await one(tx, 'select client_id from exposure_groups where id=$1', [d.group_id]);
    const w = await one(tx, 'select client_id from workers where id=$1', [d.worker_id]);
    if (!g || !w) throw notFound('Group or worker');
    if (g.client_id !== w.client_id) throw invalid('Worker and group belong to different clients');
    const open = await one(tx, 'select id from group_memberships where group_id=$1 and worker_id=$2 and valid_to is null', [d.group_id, d.worker_id]);
    if (open) throw invalid('Worker already has an open membership of this group');
    const r = await one(tx, 'insert into group_memberships (tenant_id,client_id,group_id,worker_id,valid_from,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *',
      [a.tenantId, g.client_id, d.group_id, d.worker_id, d.valid_from, d.reason, a.userId]);
    await audit(tx, a, 'membership.add', 'group_membership', r.id, d);
    return r;
  });
}
/** Ends a membership. Historical sampling events keep their frozen group association. */
export async function endMembership(a: Actor, membershipId: string, input: unknown) {
  requirePerm(a, 'register.write');
  const d = parse(z.object({ valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: reqStr(3) }), input);
  return withActor(a, async (tx) => {
    const m = await one(tx, 'select * from group_memberships where id=$1', [membershipId]);
    if (!m) throw notFound('Membership');
    if (m.valid_to) throw invalid('Membership already ended');
    const r = await one(tx, `update group_memberships set valid_to=$2, reason=coalesce(reason||'; ','')||$3 where id=$1 returning *`, [membershipId, d.valid_to, d.reason]);
    await audit(tx, a, 'membership.end', 'group_membership', membershipId, d);
    return r;
  });
}

// ───── Read models
export async function registerOverview(a: Actor) {
  return withActor(a, async (tx) => ({
    sites: await many(tx, `select s.*, c.name client_name from sites s join clients c on c.id=s.client_id order by c.name, s.name`),
    groups: await many(tx, `select g.*, s.name site_name,
        (select count(*) from group_memberships m where m.group_id=g.id and m.valid_to is null)::int members,
        (select string_agg(distinct sb.name, ', ') from exposure_group_hazards gh join hazards h on h.id=gh.hazard_id join substances sb on sb.id=h.substance_id where gh.group_id=g.id) substances
      from exposure_groups g join sites s on s.id=g.site_id order by g.review_required desc, g.name`),
    hazards: await many(tx, `select h.*, sb.name substance_name, sb.cas_number, t.name task_name, p.name process_name, wa.name work_area_name, s.name site_name
      from hazards h join substances sb on sb.id=h.substance_id join tasks t on t.id=h.task_id join processes p on p.id=t.process_id
      join work_areas wa on wa.id=p.work_area_id join sites s on s.id=wa.site_id order by s.name, wa.name, p.name, t.name`),
  }));
}

export async function siteTree(a: Actor, siteId: string) {
  return withActor(a, async (tx) => {
    const site = await one(tx, 'select s.*, c.name client_name from sites s join clients c on c.id=s.client_id where s.id=$1', [siteId]);
    if (!site) throw notFound('Site');
    return {
      site,
      areas: await many(tx, 'select * from work_areas where site_id=$1 order by name', [siteId]),
      processes: await many(tx, 'select p.* from processes p join work_areas w on w.id=p.work_area_id where w.site_id=$1 order by p.name', [siteId]),
      tasks: await many(tx, 'select t.* from tasks t join processes p on p.id=t.process_id join work_areas w on w.id=p.work_area_id where w.site_id=$1 order by t.name', [siteId]),
      hazards: await many(tx, `select h.*, sb.name substance_name from hazards h join substances sb on sb.id=h.substance_id join tasks t on t.id=h.task_id
        join processes p on p.id=t.process_id join work_areas w on w.id=p.work_area_id where w.site_id=$1`, [siteId]),
      groups: await many(tx, 'select * from exposure_groups where site_id=$1 order by name', [siteId]),
    };
  });
}

export async function groupDetail(a: Actor, groupId: string) {
  return withActor(a, async (tx) => {
    const g = await one(tx, 'select g.*, s.name site_name from exposure_groups g join sites s on s.id=g.site_id where g.id=$1', [groupId]);
    if (!g) throw notFound('Exposure group');
    return {
      group: g,
      tasks: await many(tx, 'select t.* from exposure_group_tasks gt join tasks t on t.id=gt.task_id where gt.group_id=$1', [groupId]),
      hazards: await many(tx, `select h.*, s.name substance_name from exposure_group_hazards gh join hazards h on h.id=gh.hazard_id join substances s on s.id=h.substance_id where gh.group_id=$1`, [groupId]),
      // identities only visible where RLS allows (app.pii)
      memberships: await many(tx, `select m.*, w.ref_code, wi.full_name from group_memberships m join workers w on w.id=m.worker_id
        left join worker_identities wi on wi.worker_id=w.id and wi.disposed_at is null where m.group_id=$1 order by m.valid_to nulls first, m.valid_from desc`, [groupId]),
      reviews: await many(tx, 'select r.*, u.name reviewer from group_reviews r left join users u on u.id=r.reviewed_by where group_id=$1 order by reviewed_at desc', [groupId]),
      assessments: await many(tx, `select a.*, r.status, r.benchmark_state, r.data_quality_state from assessments a join assessment_revisions r on r.assessment_id=a.id and r.revision=a.current_revision where a.group_id=$1`, [groupId]),
      controls: await many(tx, 'select * from controls where group_id=$1', [groupId]),
    };
  });
}
