import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { resolveSession, type SessionInfo } from '../auth/session.js';
import { config } from '../config.js';
import { one, withActor } from '../db.js';
import { AppError } from '../errors.js';
import { layout, type PageCtx } from '../ui/layout.js';
import type { Safe } from '../ui/html.js';

export const SESSION_COOKIE = 'ohea_sid';

declare module 'fastify' {
  interface FastifyRequest { si?: SessionInfo | null }
}

export type Ctx = PageCtx & { req: FastifyRequest; reply: FastifyReply; si: SessionInfo; body: any; params: any; query: any };

export function setFlash(reply: FastifyReply, kind: 'ok' | 'err' | 'warn', msg: string) {
  reply.setCookie('ohea_flash', Buffer.from(JSON.stringify({ kind, msg: msg.slice(0, 600) })).toString('base64url'), { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 60 });
}
function takeFlash(req: FastifyRequest, reply: FastifyReply) {
  const c = req.cookies.ohea_flash;
  if (!c) return null;
  reply.clearCookie('ohea_flash', { path: '/' });
  try { return JSON.parse(Buffer.from(c, 'base64url').toString()); } catch { return null; }
}

async function navCounts(si: SessionInfo) {
  return withActor(si.actor, async (tx) => {
    const r = await one(tx, `select
      (select count(*) from assessment_revisions where status='in_review')::int + (select count(*) from actions where status in ('evidence_submitted','effectiveness_reviewed'))::int verification,
      (select count(*) from sync_conflicts where status='open')::int conflicts`);
    return r as Record<string, number>;
  });
}

function csrfOk(si: SessionInfo, token: unknown) {
  if (typeof token !== 'string' || token.length !== si.csrf.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(si.csrf));
}

/** Requires a fully authenticated session (MFA completed where required). */
async function requireAuth(req: FastifyRequest, reply: FastifyReply, json: boolean): Promise<SessionInfo | null> {
  const si = await resolveSession(req.cookies[SESSION_COOKIE] ?? bearer(req), req.ip);
  if (!si) {
    if (json) reply.code(401).send({ error: 'unauthenticated' }); else reply.redirect('/login');
    return null;
  }
  if (!si.mfaPassed) {
    if (json) reply.code(401).send({ error: 'mfa_required' }); else reply.redirect('/mfa');
    return null;
  }
  if (si.mustChangePassword && !/^\/account(\/password)?(\?|$)/.test(req.url)) {
    if (json) reply.code(403).send({ error: 'password_change_required' }); else reply.redirect('/account?force=1');
    return null;
  }
  req.si = si;
  return si;
}
const bearer = (req: FastifyRequest) => req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;

function ctxOf(req: FastifyRequest, reply: FastifyReply, si: SessionInfo): Ctx {
  return { req, reply, si, actor: si.actor, csrf: si.csrf, tenant: si.tenant, path: req.url.split('?')[0], body: req.body ?? {}, params: req.params ?? {}, query: req.query ?? {} };
}

export function page(app: FastifyInstance, path: string, handler: (c: Ctx) => Promise<{ title: string; crumbs?: [string, string?][]; sub?: unknown; head?: unknown; body: unknown } | Safe | string>) {
  app.get(path, async (req, reply) => {
    const si = await requireAuth(req, reply, false);
    if (!si) return reply;
    const c = ctxOf(req, reply, si);
    c.flash = takeFlash(req, reply);
    try {
      const out = await handler(c);
      if (reply.sent) return reply;
      if (typeof out === 'string' || (out as any).value !== undefined) return reply.type('text/html').send(String(out));
      c.counts = await navCounts(si);
      return reply.type('text/html').send(layout(c, out as any));
    } catch (e) {
      if (e instanceof AppError) {
        c.counts = await navCounts(si).catch(() => ({}));
        return reply.code(e.status).type('text/html').send(layout(c, { title: e.status === 404 ? 'Not found' : e.status === 403 ? 'Not permitted' : 'Something needs attention', body: `<p>${escapeHtml(e.message)}</p><p><a href="/">Back to overview</a></p>` }));
      }
      throw e;
    }
  });
}

/** Form POST: validates CSRF, runs the action, redirects with a flash message. Errors return to the referring page. */
export function action(app: FastifyInstance, path: string, handler: (c: Ctx) => Promise<string | { to: string; ok?: string; warn?: string }>) {
  app.post(path, async (req, reply) => {
    const si = await requireAuth(req, reply, false);
    if (!si) return reply;
    const c = ctxOf(req, reply, si);
    if (!csrfOk(si, c.body?._csrf)) return reply.code(403).send('Invalid or missing form token. Reload the page and try again.');
    const back = safeBack(req.headers.referer) ?? '/';
    try {
      const r = await handler(c);
      if (reply.sent) return reply;
      const o = typeof r === 'string' ? { to: r } : r;
      if (o.ok) setFlash(reply, 'ok', o.ok);
      if (o.warn) setFlash(reply, 'warn', o.warn);
      return reply.redirect(o.to, 303);
    } catch (e) {
      if (e instanceof AppError) { setFlash(reply, 'err', e.message); return reply.redirect(back, 303); }
      throw e;
    }
  });
}

/** JSON API (used by the offline field client and integrations). CSRF via header for cookie sessions. */
export function api(app: FastifyInstance, method: 'GET' | 'POST', path: string, handler: (c: Ctx) => Promise<unknown>) {
  app.route({ method, url: path, handler: async (req, reply) => {
    const si = await requireAuth(req, reply, true);
    if (!si) return reply;
    const c = ctxOf(req, reply, si);
    if (method !== 'GET' && req.cookies[SESSION_COOKIE] && !csrfOk(si, req.headers['x-csrf-token'])) return reply.code(403).send({ error: 'csrf' });
    try {
      const r = await handler(c);
      if (reply.sent) return reply;
      return reply.send(r ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return reply.code(e.status).send({ error: e.code, message: e.message });
      throw e;
    }
  } });
}

/** Same-origin path of the referring page (never an external URL). */
export const back = (c: Ctx, fallback = '/') => safeBack(c.req.headers.referer) ?? fallback;
function safeBack(ref: string | undefined) {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    const path = u.pathname + u.search;
    return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;
  } catch { return null; }
}
export const safePath = safeBack;

/** Authenticated GET handler for non-HTML responses (files, reports, exports). Applies MFA and password-change rules. */
export const authed = (req: FastifyRequest, reply: FastifyReply) => requireAuth(req, reply, false);

/** Authenticated multipart POST: CSRF token is read from the form body (never the URL). */
export async function authedMultipart(req: FastifyRequest, reply: FastifyReply) {
  const si = await requireAuth(req, reply, false);
  if (!si) return null;
  const fields: Record<string, string> = {};
  let file: { filename: string; data: Buffer } | null = null;
  for await (const p of req.parts()) {
    if (p.type === 'file') {
      if (!csrfOk(si, fields._csrf)) { await p.toBuffer().catch(() => null); continue; }
      file = { filename: p.filename, data: await p.toBuffer() };
    } else fields[p.fieldname] = String(p.value);
  }
  if (!csrfOk(si, fields._csrf)) { reply.code(403).send('Invalid or missing form token. Reload the page and try again.'); return null; }
  return { si, fields, file, back: safeBack(req.headers.referer) ?? '/' };
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
