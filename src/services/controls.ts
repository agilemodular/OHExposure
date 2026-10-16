import { z } from 'zod';
import { audit, can, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { forbidden, invalid, notFound } from '../errors.js';
import { flagGroupsForReview } from './register.js';
import { enqueue } from './integrations.js';
import { bool, date, optDate, optStr, optUuid, parse, reqStr, uuid } from './util.js';

const ENGINEERING = ['enclosure', 'local_exhaust_ventilation', 'general_ventilation', 'suppression', 'process_change', 'elimination_substitution'];

const controlSchema = z.object({
  site_id: uuid, name: reqStr(2, 200),
  kind: z.enum(['elimination_substitution', 'process_change', 'enclosure', 'local_exhaust_ventilation', 'general_ventilation', 'suppression', 'work_practice', 'rpe', 'ppe', 'other']),
  purpose: reqStr(10), process_id: optUuid, hazard_id: optUuid, group_id: optUuid, owner_user_id: optUuid, performance_criteria: optStr,
  status: z.enum(['proposed', 'in_service', 'defective', 'withdrawn']).default('proposed'),
});

export async function createControl(a: Actor, input: unknown) {
  requirePerm(a, 'controls.write');
  const d = parse(controlSchema, input);
  if (ENGINEERING.includes(d.kind) && !d.performance_criteria) throw invalid('Engineering controls need measurable performance criteria (e.g. face velocity, capture distance, enclosure integrity)');
  return withActor(a, async (tx) => {
    const s = await one(tx, 'select client_id from sites where id=$1', [d.site_id]);
    if (!s) throw notFound('Site');
    const r = await one(tx, `insert into controls (tenant_id,client_id,site_id,name,kind,purpose,process_id,hazard_id,group_id,owner_user_id,performance_criteria,status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [a.tenantId, s.client_id, d.site_id, d.name, d.kind, d.purpose, d.process_id, d.hazard_id, d.group_id, d.owner_user_id, d.performance_criteria, d.status]);
    if (d.group_id) await flagGroupsForReview(tx, a, `Control "${d.name}" added`, { groupId: d.group_id });
    await audit(tx, a, 'control.create', 'control', r.id, d);
    await emitControl(tx, r.id);
    return r;
  });
}

export async function setControlStatus(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'controls.write');
  const d = parse(z.object({ status: z.enum(['proposed', 'in_service', 'defective', 'withdrawn']), reason: reqStr(5) }), input);
  return withActor(a, async (tx) => {
    if (d.status === 'in_service') {
      const open = await one(tx, `select count(*)::int n from actions where control_id=$1 and source_type='control_inspection' and status not in ('verified_closed','cancelled')`, [id]);
      if (open?.n) throw invalid(`${open.n} defect action(s) are still open; the control returns to service when they are closed as verified`);
    }
    const c = await one(tx, 'update controls set status=$2 where id=$1 returning *', [id, d.status]);
    if (!c) throw notFound('Control');
    if (c.group_id) await flagGroupsForReview(tx, a, `Control "${c.name}" status changed to ${d.status}`, { groupId: c.group_id });
    await audit(tx, a, 'control.status', 'control', id, d);
    await emitControl(tx, id);
    return c;
  });
}

export async function recordInspection(a: Actor, controlId: string, input: unknown) {
  requirePerm(a, 'controls.inspect');
  const d = parse(z.object({
    at: date, kind: z.enum(['routine_inspection', 'maintenance', 'thorough_examination_test', 'performance_test', 'commissioning']),
    outcome: z.enum(['satisfactory', 'defect_found', 'failed']), measurements: optStr, notes: optStr, raise_action: bool.optional(),
  }), input);
  if (d.outcome !== 'satisfactory' && !d.notes) throw invalid('Describe the defect or failure');
  return withActor(a, async (tx) => {
    const c = await one(tx, 'select * from controls where id=$1', [controlId]);
    if (!c) throw notFound('Control');
    const r = await one(tx, `insert into control_inspections (tenant_id,client_id,control_id,at,kind,outcome,measurements,notes,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [a.tenantId, c.client_id, controlId, d.at, d.kind, d.outcome, d.measurements, d.notes, a.userId]);
    if (d.outcome !== 'satisfactory') {
      await tx.query(`update controls set status='defective' where id=$1`, [controlId]);
      // A defect always raises a tracked action; it is not left as a note.
      await insertAction(tx, a, c.client_id, {
        title: `Rectify ${d.outcome === 'failed' ? 'failed' : 'defective'} control: ${c.name}`, description: d.notes, source_type: 'control_inspection', source_id: r.id,
        control_id: controlId, group_id: c.group_id, owner_user_id: c.owner_user_id, priority: d.outcome === 'failed' ? 'urgent' : 'high', due_date: null,
        verification_requirement: 'Satisfactory re-inspection or performance test after repair.', requires_exposure_reassessment: false,
      });
      if (c.group_id) await flagGroupsForReview(tx, a, `Control "${c.name}" found ${d.outcome.replace('_', ' ')}`, { groupId: c.group_id });
    }
    await audit(tx, a, 'control.inspection', 'control', controlId, d);
    return r;
  });
}

// ───── Corrective actions: assigned → implemented → evidence_submitted → effectiveness_reviewed → verified_closed
const actionSchema = z.object({
  title: reqStr(3, 200), description: optStr,
  source_type: z.enum(['assessment', 'control_inspection', 'group_review', 'manual']).default('manual'), source_id: optUuid,
  control_id: optUuid, group_id: optUuid, owner_user_id: optUuid, priority: z.enum(['urgent', 'high', 'normal', 'low']).default('normal'),
  due_date: optDate, verification_requirement: reqStr(10), requires_exposure_reassessment: bool,
  client_id: optUuid,
});

async function insertAction(tx: Tx, a: Actor, clientId: string, d: Omit<z.infer<typeof actionSchema>, 'client_id'>) {
  const r = await one(tx, `insert into actions (tenant_id,client_id,title,description,source_type,source_id,control_id,group_id,owner_user_id,priority,due_date,verification_requirement,requires_exposure_reassessment,created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [a.tenantId, clientId, d.title, d.description, d.source_type, d.source_id, d.control_id, d.group_id, d.owner_user_id, d.priority, d.due_date, d.verification_requirement, d.requires_exposure_reassessment, a.userId]);
  await tx.query('insert into action_events (tenant_id,client_id,action_id,to_status,notes,by_user) values ($1,$2,$3,$4,$5,$6)', [a.tenantId, clientId, r.id, 'assigned', 'Action created', a.userId]);
  return r;
}

export async function createAction(a: Actor, input: unknown) {
  requirePerm(a, 'actions.assign');
  const d = parse(actionSchema, input);
  return withActor(a, async (tx) => {
    let clientId = d.client_id;
    if (d.control_id) clientId = (await one(tx, 'select client_id from controls where id=$1', [d.control_id]))?.client_id;
    else if (d.group_id) clientId = (await one(tx, 'select client_id from exposure_groups where id=$1', [d.group_id]))?.client_id;
    else if (d.source_type === 'assessment' && d.source_id) clientId = (await one(tx, 'select client_id from assessments where id=$1', [d.source_id]))?.client_id;
    clientId = clientId ?? a.clientId ?? (await one(tx, 'select id from clients where is_default limit 1'))?.id;
    if (!clientId) throw invalid('Link the action to a control, group or assessment');
    if (d.owner_user_id) {
      const o = await one(tx, 'select role, status from users where id=$1', [d.owner_user_id]);
      if (!o || o.status !== 'active') throw notFound('Owner');
      if (o.role === 'client_readonly') throw invalid('Client read-only users cannot own actions');
    }
    if (d.control_id) {
      const c = await one(tx, 'select kind from controls where id=$1', [d.control_id]);
      if (c && ENGINEERING.includes(c.kind) && !d.requires_exposure_reassessment && !/test|examination|measure|velocity|sampl/i.test(d.verification_requirement))
        throw invalid('Verification for an engineering control must state how performance or exposure reduction will be measured');
    }
    const r = await insertAction(tx, a, clientId, d);
    await audit(tx, a, 'action.create', 'action', r.id, d);
    await emitAction(tx, r.id);
    return r;
  });
}

async function event(tx: Tx, a: Actor, act: any, to: string, notes: string | null) {
  await tx.query('insert into action_events (tenant_id,client_id,action_id,from_status,to_status,notes,by_user) values ($1,$2,$3,$4,$5,$6,$7)', [act.tenant_id, act.client_id, act.id, act.status, to, notes, a.userId]);
  await audit(tx, a, `action.${to}`, 'action', act.id, { from: act.status, notes });
  await emitAction(tx, act.id);
}

/** Optional outbound messages (only when the tenant enabled the link; mock transport by default). */
async function emitAction(tx: Tx, actionId: string) {
  const x = await one(tx, 'select * from actions where id=$1', [actionId]);
  const seq = (await one(tx, 'select count(*)::int n from action_events where action_id=$1', [actionId]))?.n ?? 0;
  await enqueue(tx, x.tenant_id, 'integrarisk', 'ohea.action', `status:${x.status}`, `${x.id}:${seq}`, {
    action_id: x.id, title: x.title, status: x.status, priority: x.priority, due_date: x.due_date, verification_requirement: x.verification_requirement,
    source_assessment_id: x.source_type === 'assessment' ? x.source_id : null, provenance: { source: 'ohea', action_event_seq: seq },
  });
}
async function emitControl(tx: Tx, controlId: string) {
  const c = await one(tx, `select c.*, s.reference site_ref, p.name process_ref from controls c join sites s on s.id=c.site_id left join processes p on p.id=c.process_id where c.id=$1`, [controlId]);
  const tasks = c.group_id ? await many(tx, 'select t.name from exposure_group_tasks gt join tasks t on t.id=gt.task_id where gt.group_id=$1', [c.group_id]) : [];
  const asmts = c.group_id ? await many(tx, `select r.id from assessments a join assessment_revisions r on r.assessment_id=a.id and r.status='approved' where a.group_id=$1`, [c.group_id]) : [];
  await enqueue(tx, c.tenant_id, 'workassura', 'ohea.required_controls', `status:${c.status}`, `${c.id}:${c.status}:${Date.now()}`, {
    control_id: c.id, name: c.name, kind: c.kind, status: c.status, site_ref: c.site_ref, process_ref: c.process_ref,
    task_refs: tasks.map((t) => t.name), assessment_refs: asmts.map((r) => r.id),
    provenance: { source: 'ohea', note: 'Informational. Does not authorise work.' },
  });
}

export async function markImplemented(a: Actor, id: string, input: unknown) {
  const d = parse(z.object({ notes: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const act = await one(tx, 'select * from actions where id=$1 for update', [id]);
    if (!act) throw notFound('Action');
    if (!((can(a, 'actions.implement') || can(a, 'actions.assign')) && act.owner_user_id === a.userId) && !can(a, 'actions.assign')) throw forbidden('Only the action owner or a practitioner can record implementation');
    if (act.status !== 'assigned') throw invalid(`Action is ${act.status}`);
    await tx.query(`update actions set status='implemented', implemented_by=$2, implemented_at=now() where id=$1`, [id, a.userId]);
    await event(tx, a, act, 'implemented', d.notes);
  });
}

/** Evidence must be a linked inspection/test after implementation, or an attachment on the action. */
export async function submitEvidence(a: Actor, id: string, input: unknown) {
  const d = parse(z.object({ inspection_id: optUuid, notes: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const act = await one(tx, 'select * from actions where id=$1 for update', [id]);
    if (!act) throw notFound('Action');
    if (!((can(a, 'actions.implement') || can(a, 'actions.assign')) && act.owner_user_id === a.userId) && !can(a, 'actions.assign')) throw forbidden();
    if (act.status !== 'implemented') throw invalid(`Action is ${act.status}; evidence follows implementation`);
    const att = await one(tx, `select count(*)::int n from attachments where entity_type='action' and entity_id=$1 and disposed_at is null`, [id]);
    if (d.inspection_id) {
      const ins = await one(tx, 'select * from control_inspections where id=$1', [d.inspection_id]);
      if (!ins) throw notFound('Inspection');
      if (act.control_id && ins.control_id !== act.control_id) throw invalid('Inspection is for a different control');
      if (new Date(ins.at) < new Date(act.implemented_at.toISOString().slice(0, 10))) throw invalid('Evidence inspection pre-dates implementation');
    } else if (!att.n) throw invalid('Attach evidence or link a post-implementation inspection/test');
    await tx.query(`update actions set status='evidence_submitted', evidence_inspection_id=$2 where id=$1`, [id, d.inspection_id]);
    await event(tx, a, act, 'evidence_submitted', d.notes);
  });
}

export async function reviewEffectiveness(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'actions.review');
  const d = parse(z.object({ outcome: z.enum(['effective', 'partially_effective', 'not_effective']), verification_assessment_revision_id: optUuid, notes: reqStr(20) }), input);
  return withActor(a, async (tx) => {
    const act = await one(tx, 'select * from actions where id=$1 for update', [id]);
    if (!act) throw notFound('Action');
    if (act.status !== 'evidence_submitted') throw invalid(`Action is ${act.status}`);
    if (act.implemented_by === a.userId) throw forbidden('Effectiveness must be reviewed by someone other than the implementer');
    if (d.verification_assessment_revision_id) {
      const r = await one(tx, 'select r.status, r.approved_at, r.client_id, a.group_id from assessment_revisions r join assessments a on a.id=r.assessment_id where r.id=$1', [d.verification_assessment_revision_id]);
      if (!r || r.status !== 'approved') throw invalid('The verification assessment must be an approved revision');
      if (r.client_id !== act.client_id || (act.group_id && r.group_id !== act.group_id)) throw invalid('The verification assessment must cover the same client and exposure group as the action');
      if (r.approved_at < act.implemented_at) throw invalid('The verification assessment pre-dates implementation');
    }
    if (d.outcome === 'effective' && act.requires_exposure_reassessment && !d.verification_assessment_revision_id)
      throw invalid('This action requires an approved post-implementation exposure assessment before it can be judged effective');
    if (d.outcome === 'effective' && act.control_id) {
      const c = await one(tx, 'select kind from controls where id=$1', [act.control_id]);
      const ins = act.evidence_inspection_id ? await one(tx, 'select kind, outcome from control_inspections where id=$1', [act.evidence_inspection_id]) : null;
      const measured = ins && ins.outcome === 'satisfactory' && ['thorough_examination_test', 'performance_test', 'commissioning'].includes(ins.kind);
      if (c && ENGINEERING.includes(c.kind) && !measured && !d.verification_assessment_revision_id)
        throw invalid('Installation alone does not verify an engineering control: link a satisfactory performance test/thorough examination or an approved post-control assessment');
    }
    if (d.outcome === 'effective') {
      await tx.query(`update actions set status='effectiveness_reviewed', effectiveness_outcome=$2, verification_assessment_revision_id=$3, effectiveness_reviewed_by=$4, effectiveness_reviewed_at=now() where id=$1`,
        [id, d.outcome, d.verification_assessment_revision_id, a.userId]);
      await event(tx, a, act, 'effectiveness_reviewed', `Effective. ${d.notes}`);
    } else {
      // Not (fully) effective → reopen; history preserved in action_events.
      await tx.query(`update actions set status='assigned', effectiveness_outcome=$2, implemented_by=null, implemented_at=null, evidence_inspection_id=null where id=$1`, [id, d.outcome]);
      await event(tx, a, act, 'assigned', `Reopened — ${d.outcome.replace('_', ' ')}. ${d.notes}`);
    }
  });
}

export async function closeVerified(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'actions.review');
  const d = parse(z.object({ notes: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const act = await one(tx, 'select * from actions where id=$1 for update', [id]);
    if (!act) throw notFound('Action');
    if (act.status !== 'effectiveness_reviewed' || act.effectiveness_outcome !== 'effective') throw invalid('Only actions reviewed as effective can be closed as verified');
    await tx.query(`update actions set status='verified_closed', closed_by=$2, closed_at=now() where id=$1`, [id, a.userId]);
    if (act.control_id) await tx.query(`update controls set status='in_service' where id=$1 and status in ('proposed','defective')
      and not exists (select 1 from actions x where x.control_id=$1 and x.id<>$2 and x.source_type='control_inspection' and x.status not in ('verified_closed','cancelled'))`, [act.control_id, id]);
    await event(tx, a, act, 'verified_closed', d.notes);
  });
}

export async function cancelAction(a: Actor, id: string, input: unknown) {
  const d = parse(z.object({ reason: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    const act = await one(tx, 'select * from actions where id=$1 for update', [id]);
    if (!act || ['verified_closed', 'cancelled'].includes(act.status)) throw invalid('Action cannot be cancelled');
    if (act.source_type === 'control_inspection' || act.priority === 'urgent') {
      if (!can(a, 'actions.review')) throw forbidden('Defect and urgent actions can only be cancelled by a technical reviewer');
      if (act.created_by === a.userId) throw forbidden('Defect and urgent actions must be cancelled by someone other than their creator');
    } else requirePerm(a, 'actions.assign');
    await tx.query(`update actions set status='cancelled' where id=$1`, [id]);
    await event(tx, a, act, 'cancelled', d.reason);
  });
}

export async function listControls(a: Actor) {
  return withActor(a, (tx) => many(tx, `select c.*, s.name site_name, g.name group_name, u.name owner_name,
      (select max(at) from control_inspections i where i.control_id=c.id) last_inspection,
      (select outcome from control_inspections i where i.control_id=c.id order by at desc, recorded_at desc limit 1) last_outcome,
      (select count(*) from actions x where x.control_id=c.id and x.status not in ('verified_closed','cancelled'))::int open_actions
    from controls c join sites s on s.id=c.site_id left join exposure_groups g on g.id=c.group_id left join users u on u.id=c.owner_user_id order by c.status='defective' desc, c.name`));
}

export async function controlDetail(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const c = await one(tx, `select c.*, s.name site_name, g.name group_name, p.name process_name, u.name owner_name from controls c join sites s on s.id=c.site_id
      left join exposure_groups g on g.id=c.group_id left join processes p on p.id=c.process_id left join users u on u.id=c.owner_user_id where c.id=$1`, [id]);
    if (!c) throw notFound('Control');
    return {
      control: c,
      inspections: await many(tx, 'select i.*, u.name recorded_by_name from control_inspections i left join users u on u.id=i.recorded_by where control_id=$1 order by at desc', [id]),
      actions: await many(tx, 'select * from actions where control_id=$1 order by created_at desc', [id]),
    };
  });
}

export async function listActions(a: Actor, mine = false) {
  return withActor(a, (tx) => many(tx, `select x.*, u.name owner_name, c.name control_name, g.name group_name,
      (x.due_date < current_date and x.status not in ('verified_closed','cancelled')) overdue
    from actions x left join users u on u.id=x.owner_user_id left join controls c on c.id=x.control_id left join exposure_groups g on g.id=x.group_id
    where (not $1 or x.owner_user_id=$2) order by (x.status in ('verified_closed','cancelled')), x.priority='urgent' desc, x.due_date nulls last`, [mine, a.userId]));
}

export async function actionDetail(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const x = await one(tx, `select x.*, u.name owner_name, c.name control_name, c.kind control_kind, g.name group_name, iu.name implemented_by_name, ru.name reviewed_by_name, cu.name closed_by_name
      from actions x left join users u on u.id=x.owner_user_id left join controls c on c.id=x.control_id left join exposure_groups g on g.id=x.group_id
      left join users iu on iu.id=x.implemented_by left join users ru on ru.id=x.effectiveness_reviewed_by left join users cu on cu.id=x.closed_by where x.id=$1`, [id]);
    if (!x) throw notFound('Action');
    return {
      action: x,
      events: await many(tx, 'select e.*, u.name by_name from action_events e left join users u on u.id=e.by_user where action_id=$1 order by at', [id]),
      inspections: x.control_id ? await many(tx, 'select * from control_inspections where control_id=$1 order by at desc', [x.control_id]) : [],
      approvedRevisions: await many(tx, `select r.id, r.revision, r.approved_at, a.title from assessment_revisions r join assessments a on a.id=r.assessment_id where r.status='approved' and r.client_id=$1 order by r.approved_at desc`, [x.client_id]),
    };
  });
}
