import type { FastifyInstance } from 'fastify';
import { completeMfa, login, logout, resolveSession } from '../auth/session.js';
import { deriveFromParams, newTotpSecret, otpauthUri, hashPassword, sha256 } from '../auth/crypto.js';
import { config } from '../config.js';
import { sendAlert } from '../alerts.js';
import { audit, one, withActor, withAnon } from '../db.js';
import { AppError } from '../errors.js';
import { html } from '../ui/html.js';
import { action, page, SESSION_COOKIE, setFlash } from './kit.js';

const authPage = (title: string, body: unknown, flash?: string | null) => html`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${config.branding.productName}</title><link rel="stylesheet" href="/static/app.css"></head><body><div class="auth">
<div class="brandline"><b>${config.branding.productName}</b><span class="muted">${config.branding.endorsement}</span></div>
<h1>${title}</h1>${flash ? html`<div class="flash err" role="alert">${flash}</div>` : ''}${body}
<p class="muted small">${config.branding.promise}</p></div><script src="/static/signed-out.js"></script></body></html>`.value;

const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure };

export function authRoutes(app: FastifyInstance) {
  app.get('/login', async (req, reply) => {
    const err = (req.query as any).e;
    return reply.type('text/html').send(authPage('Sign in', html`<form method="post" action="/login" class="stack">
      <label>Email<input name="email" type="email" autocomplete="username" required autofocus></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button>Sign in</button></form>`, err ? String(err).slice(0, 200) : null));
  });

  // Per-IP throttle (in-memory, per process) in addition to per-account lockout.
  // Per-IP throttle shared across all instances (stored in the database, keyed by a hash of the IP).
  app.post('/login', async (req, reply) => {
    const allowed = await withAnon(async (tx) => (await one(tx, 'select auth_throttle_hit($1,$2,900) ok', [sha256(`ip:${req.ip}`), config.loginIpLimit]))?.ok);
    if (!allowed) void sendAlert('auth.ip_throttled', { ip_hash: sha256(`ip:${req.ip}`).slice(0, 16) }, req.ip);
    if (!allowed) return reply.redirect(`/login?e=${encodeURIComponent('Too many sign-in attempts from this network. Try again in 15 minutes.')}`, 303);
    const b = req.body as any;
    try {
      const r = await login(String(b.email ?? ''), String(b.password ?? ''), req.headers['user-agent'], req.ip);
      reply.setCookie(SESSION_COOKIE, r.token, { ...cookieOpts, maxAge: config.sessionHours * 3600 });
      return reply.redirect(r.mfaPending || r.enrolMfa ? '/mfa' : '/', 303);
    } catch (e) {
      if (e instanceof AppError) return reply.redirect(`/login?e=${encodeURIComponent(e.message)}`, 303);
      throw e;
    }
  });

  app.get('/mfa', async (req, reply) => {
    const si = await resolveSession(req.cookies[SESSION_COOKIE], req.ip);
    if (!si) return reply.redirect('/login');
    if (si.mfaPassed) return reply.redirect('/');
    let secret: string | null = null;
    if (!si.mfaEnabled) {
      secret = await withActor(si.actor, async (tx) => {
        const existing = (await one(tx, 'select self_totp_secret() s'))?.s;
        if (existing) return existing;
        await tx.query('select self_set_totp_secret($1)', [newTotpSecret()]);
        return (await one(tx, 'select self_totp_secret() s')).s;
      });
    }
    const err = (req.query as any).e;
    return reply.type('text/html').send(authPage(secret ? 'Set up two-step verification' : 'Two-step verification', html`
      ${secret ? html`<p>Your organisation requires an authenticator app. Add this account manually in your app using the key below, then enter the 6-digit code it shows.</p>
        <p class="panel"><span class="muted small">Setup key</span><br><code>${secret.match(/.{1,4}/g)!.join(' ')}</code></p>
        <details class="small"><summary>Setup link for apps that accept otpauth URIs</summary><code>${otpauthUri(secret, si.actor.email, config.branding.productName)}</code></details>` : html`<p>Enter the 6-digit code from your authenticator app.</p>`}
      <form method="post" action="/mfa" class="stack"><input type="hidden" name="_csrf" value="${si.csrf}">
      <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label><button>Verify</button></form>
      <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${si.csrf}"><button class="secondary">Cancel and sign out</button></form>`, err ? String(err).slice(0, 200) : null));
  });

  app.post('/mfa', async (req, reply) => {
    const si = await resolveSession(req.cookies[SESSION_COOKIE], req.ip);
    if (!si) return reply.redirect('/login', 303);
    const b = req.body as any;
    if (b._csrf !== si.csrf) return reply.code(403).send('Invalid form token');
    try {
      await completeMfa(si, String(b.code ?? ''));
      return reply.redirect('/', 303);
    } catch (e) {
      if (e instanceof AppError) return reply.redirect(`/mfa?e=${encodeURIComponent(e.message)}`, 303);
      throw e;
    }
  });

  app.post('/logout', async (req, reply) => {
    const si = await resolveSession(req.cookies[SESSION_COOKIE], req.ip);
    if (si && (req.body as any)?._csrf === si.csrf) await logout(si);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    // Clears the HTTP cache. The service worker's cached page shell is removed by /static/signed-out.js on the sign-in page.
    // Never "storage": that would delete encrypted, unsynchronised field records.
    reply.header('Clear-Site-Data', '"cache"');
    return reply.redirect('/login', 303);
  });

  page(app, '/account', async (c) => ({
    title: 'Your account',
    body: html`${c.si.mustChangePassword ? html`<div class="flash warn" role="alert">You signed in with a temporary password. Choose a new password to continue.</div>` : ''}<dl class="kv"><dt>Name</dt><dd>${c.actor.name}</dd><dt>Email</dt><dd>${c.actor.email}</dd><dt>Role</dt><dd>${c.actor.role}</dd>
      <dt>Two-step verification</dt><dd>${c.si.mfaEnabled ? 'Enabled' : 'Not enabled'}</dd></dl>
      <form method="post" action="/account/password" class="stack panel"><h2>Change password</h2><input type="hidden" name="_csrf" value="${c.csrf}">
      <label>Current password<input type="password" name="current" autocomplete="current-password" required></label>
      <label>New password <span class="hint">At least 12 characters</span><input type="password" name="next" autocomplete="new-password" minlength="12" required></label>
      <div><button>Change password</button></div></form>`,
  }));
  action(app, '/account/password', async (c) => {
    await withActor(c.actor, async (tx) => {
      const params = (await one(tx, 'select self_password_params() p'))?.p;
      const ok = params && (await one(tx, 'select self_verify_dk($1) ok', [deriveFromParams(String(c.body.current ?? ''), params)]))?.ok;
      if (!ok) throw new AppError(422, 'invalid', 'Current password is incorrect');
      let h: string;
      try { h = hashPassword(String(c.body.next ?? '')); } catch (e: any) { throw new AppError(422, 'invalid', e.message); }
      await tx.query('select self_set_password($1)', [h]);
      await tx.query('update sessions set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null', [c.actor.userId, c.si.sessionId]);
      await audit(tx, c.actor, 'auth.password_changed', 'user', c.actor.userId);
    });
    return { to: '/account', ok: 'Password changed. Other sessions were signed out.' };
  });
  void setFlash;
}
