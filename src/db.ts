import pg from 'pg';
import { config } from './config.js';
import { permissionsFor, type Permission, type Role } from './authz.js';
import { forbidden } from './errors.js';

pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric → number
pg.types.setTypeParser(1082, (v) => v); // date stays 'YYYY-MM-DD'

let pool: pg.Pool | null = null;
export function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  return pool;
}
export async function closePool() {
  await pool?.end();
  pool = null;
}

export type Actor = {
  userId: string;
  tenantId: string;
  clientId: string | null; // non-null for client-scoped users
  role: Role;
  name: string;
  email: string;
  perms: Set<Permission>;
  ip?: string;
};

export function actorFrom(u: { id: string; tenant_id: string; client_id: string | null; role: Role; name: string; email: string }, ip?: string): Actor {
  return { userId: u.id, tenantId: u.tenant_id, clientId: u.client_id, role: u.role, name: u.name, email: u.email, perms: permissionsFor(u.role), ip };
}

export function can(a: Actor, p: Permission) {
  return a.perms.has(p);
}
export function requirePerm(a: Actor, p: Permission) {
  if (!a.perms.has(p)) throw forbidden(`Requires permission: ${p}`);
}

export type Tx = pg.PoolClient;

/** Runs fn inside a transaction with the actor's tenant/client/PII context applied for RLS. */
export async function withActor<T>(a: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.tenant_id',$1,true), set_config('app.client_id',$2,true),
              set_config('app.pii',$3,true), set_config('app.user_id',$4,true)`,
      [a.tenantId, a.clientId ?? '', a.perms.has('worker.identity.read') ? 'on' : 'off', a.userId],
    );
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** For unauthenticated operations (login) — no tenant context; only SECURITY DEFINER functions are reachable. */
export async function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function one<T = any>(tx: Tx, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await tx.query(sql, params);
  return (r.rows[0] as T) ?? null;
}
export async function many<T = any>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query(sql, params)).rows as T[];
}

export async function audit(tx: Tx, a: Actor | null, action: string, entityType?: string, entityId?: string, detail: object = {}) {
  await tx.query(
    'insert into audit_events (tenant_id,user_id,action,entity_type,entity_id,detail,ip) values ($1,$2,$3,$4,$5,$6,$7)',
    [a?.tenantId ?? null, a?.userId ?? null, action, entityType ?? null, entityId ?? null, detail, a?.ip ?? null],
  );
}

/** Resolves the client a new record belongs to: client users are pinned; others must pass one that is visible. */
export async function resolveClient(tx: Tx, a: Actor, siteId: string): Promise<string> {
  const s = await one<{ client_id: string }>(tx, 'select client_id from sites where id=$1', [siteId]);
  if (!s) throw forbidden('Site not accessible');
  return s.client_id;
}
