import { z } from 'zod';
import { hashPassword, randomToken } from '../auth/crypto.js';
import { ROLES } from '../authz.js';
import { audit, can, many, one, requirePerm, withActor, type Actor } from '../db.js';
import { forbidden, invalid, notFound } from '../errors.js';
import { purgeStoredFile } from './attachments.js';
import { optUuid, parse, reqStr, uuid } from './util.js';

// ───── Users & clients
export async function createUser(a: Actor, input: unknown) {
  requirePerm(a, 'users.manage');
  const d = parse(z.object({ email: z.string().email().toLowerCase(), name: reqStr(2, 120), role: z.enum(ROLES), client_id: optUuid }), input);
  if (d.role === 'client_readonly' && !d.client_id) throw invalid('Client read-only users must be linked to a client');
  if (d.role !== 'client_readonly' && d.client_id) throw invalid('Only client read-only users are scoped to a single client');
  const temp = randomToken(12);
  return withActor(a, async (tx) => {
    if (await one(tx, 'select 1 from users where lower(email)=$1', [d.email])) throw invalid('A user with that email already exists in this organisation');
    const u = await one(tx, 'insert into users (tenant_id,client_id,email,name,role,password_hash) values ($1,$2,$3,$4,$5,$6) returning id,email,name,role,client_id',
      [a.tenantId, d.client_id, d.email, d.name, d.role, hashPassword(temp)]).catch((e) => {
      if (e.code === '23505') throw invalid('That email is already registered');
      throw e;
    });
    await audit(tx, a, 'user.create', 'user', u.id, { email: d.email, role: d.role, client_id: d.client_id });
    return { user: u, temporaryPassword: temp };
  });
}

export async function setUserStatus(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'users.manage');
  const d = parse(z.object({ status: z.enum(['active', 'suspended']) }), input);
  if (id === a.userId) throw invalid('You cannot change your own status');
  return withActor(a, async (tx) => {
    const r = await one(tx, 'update users set status=$2 where id=$1 returning id', [id, d.status]);
    if (!r) throw notFound('User');
    if (d.status === 'suspended') await tx.query('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [id]);
    await audit(tx, a, `user.${d.status}`, 'user', id);
  });
}

export async function resetMfa(a: Actor, id: string) {
  requirePerm(a, 'users.manage');
  return withActor(a, async (tx) => {
    await tx.query('update users set mfa_enabled=false, totp_secret=null where id=$1', [id]);
    await tx.query('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [id]);
    await audit(tx, a, 'user.mfa_reset', 'user', id);
  });
}

export async function createClient(a: Actor, input: unknown) {
  requirePerm(a, 'org.manage');
  const d = parse(z.object({ name: reqStr(2, 200) }), input);
  return withActor(a, async (tx) => {
    const r = await one(tx, 'insert into clients (tenant_id,name) values ($1,$2) returning *', [a.tenantId, d.name]);
    await audit(tx, a, 'client.create', 'client', r.id, d);
    return r;
  });
}

export async function listUsers(a: Actor) {
  return withActor(a, async (tx) => ({
    users: await many(tx, 'select u.id,u.email,u.name,u.role,u.status,u.mfa_enabled,u.client_id,c.name client_name from users u left join clients c on c.id=u.client_id order by u.name'),
    clients: await many(tx, 'select * from clients order by name'),
  }));
}

// ───── Audit
export async function auditLog(a: Actor, filter: { entity_id?: string; limit?: number } = {}) {
  requirePerm(a, 'audit.read');
  return withActor(a, (tx) => many(tx, `select e.*, u.name user_name from audit_events e left join users u on u.id=e.user_id
    where ($1::text is null or e.entity_id=$1) order by e.id desc limit $2`, [filter.entity_id ?? null, Math.min(filter.limit ?? 300, 2000)]));
}

// ───── Retention & authorised disposal (two-person rule)
export async function setRetention(a: Actor, input: unknown) {
  requirePerm(a, 'org.manage');
  const d = parse(z.object({ record_class: z.enum(['worker_identity', 'attachment', 'audit_event', 'sampling_record']), retain_years: z.coerce.number().int().min(1).max(100), basis: reqStr(10) }), input);
  return withActor(a, async (tx) => {
    await tx.query(`insert into retention_policies (tenant_id,record_class,retain_years,basis) values ($1,$2,$3,$4)
      on conflict (tenant_id,record_class) do update set retain_years=excluded.retain_years, basis=excluded.basis`, [a.tenantId, d.record_class, d.retain_years, d.basis]);
    await audit(tx, a, 'retention.set', 'retention_policy', d.record_class, d);
  });
}

export async function requestDisposal(a: Actor, input: unknown) {
  requirePerm(a, 'disposal.request');
  const d = parse(z.object({ record_class: z.enum(['worker_identity', 'attachment']), entity_id: uuid, reason: reqStr(20) }), input);
  return withActor(a, async (tx) => {
    const exists = d.record_class === 'attachment'
      ? await one(tx, 'select uploaded_at as created from attachments where id=$1 and disposed_at is null', [d.entity_id])
      : await one(tx, 'select w.created_at as created from worker_identities wi join workers w on w.id=wi.worker_id where wi.worker_id=$1 and wi.disposed_at is null', [d.entity_id]);
    if (!exists) throw notFound('Record (or you lack access to identifiable data)');
    const r = await one(tx, 'insert into disposal_requests (tenant_id,record_class,entity_id,reason,requested_by) values ($1,$2,$3,$4,$5) returning *', [a.tenantId, d.record_class, d.entity_id, d.reason, a.userId]);
    await audit(tx, a, 'disposal.requested', d.record_class, d.entity_id, d);
    return r;
  });
}

export async function decideDisposal(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'disposal.approve');
  const d = parse(z.object({ decision: z.enum(['approved', 'rejected']), notes: reqStr(5) }), input);
  return withActor(a, async (tx) => {
    const r = await one(tx, 'select * from disposal_requests where id=$1 for update', [id]);
    if (!r) throw notFound('Disposal request');
    if (r.status !== 'pending') throw invalid('Already decided');
    if (r.requested_by === a.userId) throw forbidden('Disposal must be approved by someone other than the requester');
    await tx.query('update disposal_requests set status=$2, decided_by=$3, decided_at=now() where id=$1', [id, d.decision, a.userId]);
    if (d.decision === 'approved') {
      if (r.record_class === 'attachment') {
        const att = await one(tx, 'update attachments set disposed_at=now() where id=$1 returning storage_key', [r.entity_id]);
        if (att) purgeStoredFile(att.storage_key);
      } else {
        // Identity is removed; the pseudonymous worker reference and all exposure history remain.
        await tx.query(`update worker_identities set full_name='[disposed]', employee_number=null, disposed_at=now() where worker_id=$1`, [r.entity_id]);
      }
      await tx.query(`update disposal_requests set status='executed', executed_at=now() where id=$1`, [id]);
    }
    await audit(tx, a, `disposal.${d.decision}`, r.record_class, r.entity_id, d);
  });
}

export async function governance(a: Actor) {
  return withActor(a, async (tx) => ({
    retention: await many(tx, 'select * from retention_policies order by record_class'),
    disposals: await many(tx, `select d.*, ru.name requested_by_name, du.name decided_by_name from disposal_requests d left join users ru on ru.id=d.requested_by left join users du on du.id=d.decided_by order by requested_at desc limit 100`),
  }));
}

// ───── Controlled export (tenant/client-scoped by RLS; identities only with permission)
export async function exportData(a: Actor) {
  requirePerm(a, 'export.data');
  return withActor(a, async (tx) => {
    const tables = ['sites', 'work_areas', 'processes', 'tasks', 'hazards', 'exposure_groups', 'group_memberships', 'workers', 'monitoring_plans', 'plan_targets',
      'sampling_events', 'sample_qc_checks', 'custody_events', 'lab_results', 'lab_result_revisions', 'instruments', 'calibrations', 'assessments', 'assessment_revisions',
      'controls', 'control_inspections', 'actions', 'action_events'];
    const out: Record<string, unknown[]> = {};
    for (const t of tables) out[t] = await many(tx, `select * from ${t}`);
    if (can(a, 'worker.identity.read')) out.worker_identities = await many(tx, 'select * from worker_identities where disposed_at is null');
    await audit(tx, a, 'export.full', 'tenant', a.tenantId, { tables: Object.keys(out), includes_identities: !!out.worker_identities });
    return { exported_at: new Date().toISOString(), tenant_id: a.tenantId, client_scope: a.clientId, data: out };
  });
}
