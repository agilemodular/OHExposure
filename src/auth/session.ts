import { config } from '../config.js';
import { actorFrom, audit, one, withActor, withAnon, type Actor } from '../db.js';
import { AppError } from '../errors.js';
import { deriveFromParams, randomToken, sha256, verifyTotpStep } from './crypto.js';

export type LoginResult = { token: string; mfaPending: boolean; enrolMfa: boolean };

export async function login(email: string, password: string, ua?: string, ip?: string): Promise<LoginResult> {
  // The database returns only salt and cost parameters, then compares the derived key itself:
  // the application role never receives password hashes.
  const params = await withAnon((tx) => one<{ p: string }>(tx, 'select auth_password_params($1) p', [email]));
  const dk = deriveFromParams(password, params!.p);
  const r = await withAnon((tx) => one<{ user_id: string | null; tenant_id: string | null; outcome: string }>(tx, 'select * from auth_login($1,$2)', [email, dk]));
  if (r?.outcome === 'locked') throw new AppError(429, 'locked', 'Account temporarily locked after repeated failed attempts. Try again later.');
  if (r?.outcome !== 'ok' || !r.user_id || !r.tenant_id) throw new AppError(401, 'auth_failed', 'Email or password not recognised');
  const u = { id: r.user_id, tenant_id: r.tenant_id };

  const token = randomToken();
  const sid = sha256(token);
  const full = await withActor(
    { userId: u.id, tenantId: u.tenant_id, clientId: null, role: 'client_readonly', name: '', email, perms: new Set() },
    async (tx) => {
      const usr = await one(tx, 'select u.id, u.tenant_id, u.client_id, u.role, u.name, u.email, u.mfa_enabled, t.mfa_required from users u join tenants t on t.id=u.tenant_id where u.id=$1', [u.id]);
      await tx.query(
        `insert into sessions (id,user_id,tenant_id,csrf_token,mfa_passed,expires_at,user_agent)
         values ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval, $7)`,
        [sid, u.id, u.tenant_id, randomToken(18), !usr.mfa_enabled && !usr.mfa_required, String(config.sessionHours), ua ?? null],
      );
      await audit(tx, actorFrom(usr, ip), 'auth.login', 'user', u.id);
      return usr;
    },
  );
  return { token, mfaPending: full.mfa_enabled, enrolMfa: !full.mfa_enabled && full.mfa_required };
}

export type SessionInfo = { actor: Actor; csrf: string; mfaPassed: boolean; sessionId: string; mfaEnabled: boolean; mfaRequired: boolean; mustChangePassword: boolean; tenant: any };

export async function resolveSession(token: string | undefined, ip?: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const sid = sha256(token);
  const s = await withAnon((tx) => one(tx, 'select * from auth_session($1)', [sid]));
  if (!s) return null;
  const boot: Actor = { userId: s.user_id, tenantId: s.tenant_id, clientId: null, role: 'client_readonly', name: '', email: '', perms: new Set() };
  const { u, t } = await withActor(boot, async (tx) => ({
    u: await one(tx, 'select id,tenant_id,client_id,role,name,email,mfa_enabled,must_change_password from users where id=$1', [s.user_id]),
    t: await one(tx, 'select id,name,kind,is_demo,mfa_required from tenants where id=$1', [s.tenant_id]),
  }));
  if (!u) return null;
  await withAnon((tx) => tx.query('select auth_touch_session($1)', [sid]));
  return { actor: actorFrom(u, ip), csrf: s.csrf_token, mfaPassed: s.mfa_passed, sessionId: sid, mfaEnabled: u.mfa_enabled, mfaRequired: t.mfa_required, mustChangePassword: u.must_change_password, tenant: t };
}

export async function completeMfa(si: SessionInfo, code: string) {
  // The failure counter must persist, so the outcome is decided inside the transaction and thrown after commit.
  const outcome = await withActor(si.actor, async (tx) => {
    // A locked account cannot complete MFA from any session, including sessions opened before the lock.
    if ((await one(tx, 'select self_mfa_locked() l'))?.l) {
      await tx.query('update sessions set revoked_at=now() where id=$1', [si.sessionId]);
      await audit(tx, si.actor, 'auth.mfa_refused_locked', 'user', si.actor.userId);
      return 'locked' as const;
    }
    const secret = (await one(tx, 'select self_totp_secret() s'))?.s as string | null;
    const step = secret ? verifyTotpStep(secret, code.trim()) : null;
    // Replay protection: each time-step is accepted once.
    const accepted = step !== null && (await one(tx, 'select self_accept_totp_step($1) ok', [step]))?.ok;
    if (accepted) {
      await tx.query('select self_record_mfa(true)');
      await tx.query('update sessions set mfa_passed=true where id=$1', [si.sessionId]);
      await audit(tx, si.actor, si.mfaEnabled ? 'auth.mfa_passed' : 'auth.mfa_enrolled', 'user', si.actor.userId);
      return 'ok' as const;
    }
    const s = await one(tx, `update sessions set mfa_failures = mfa_failures + 1,
      revoked_at = case when mfa_failures + 1 >= 5 then now() else revoked_at end where id=$1 returning mfa_failures`, [si.sessionId]);
    // Count against the account as well as the session, so signing in again does not reset the attempt budget;
    // when the account locks, every session that has not passed MFA is revoked.
    const accountLocked = (await one(tx, 'select self_record_mfa(false) l'))?.l;
    const locked = accountLocked || (s?.mfa_failures ?? 0) >= 5;
    await audit(tx, si.actor, locked ? 'auth.mfa_session_revoked' : 'auth.mfa_failed', 'user', si.actor.userId);
    return locked ? ('locked' as const) : ('failed' as const);
  });
  if (outcome === 'locked') throw new AppError(401, 'mfa_locked', 'Too many incorrect codes. Sign in again.');
  if (outcome === 'failed') throw new AppError(401, 'mfa_failed', 'Code not accepted');
}

export async function logout(si: SessionInfo) {
  await withActor(si.actor, async (tx) => {
    await tx.query('update sessions set revoked_at=now() where id=$1', [si.sessionId]);
    await audit(tx, si.actor, 'auth.logout', 'user', si.actor.userId);
  });
}
