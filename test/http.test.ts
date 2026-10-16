import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closePool } from '../src/db.js';
import { totpAt } from '../src/auth/crypto.js';
import { createTenant, createUserDirect } from '../scripts/bootstrap.js';
import * as reg from '../src/services/register.js';
import { buildWorld, type World } from './fixtures.js';

process.env.NODE_ENV = 'test';
let app: Awaited<ReturnType<typeof buildApp>>;
let w: World;
const PW = 'correct horse battery';

const cookieOf = (res: any) => (res.headers['set-cookie'] as string[] | string | undefined ? ([] as string[]).concat(res.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ') : '');
async function signIn(email: string, password = PW) {
  const r = await app.inject({ method: 'POST', url: '/login', payload: { email, password } });
  return { res: r, cookie: cookieOf(r) };
}
const csrfFrom = (body: string) => /name="_csrf" value="([^"]+)"/.exec(body)?.[1];

beforeAll(async () => { app = await buildApp(); w = await buildWorld(); });
afterAll(async () => { await app.close(); await closePool(); });

describe('authentication', () => {
  it('rejects unauthenticated access and redirects to sign-in', async () => {
    const r = await app.inject({ url: '/assessments' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/login');
    expect((await app.inject({ url: '/api/field/bootstrap' })).statusCode).toBe(401);
  });

  it('requires MFA enrolment where the tenant mandates it, using standard TOTP', async () => {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
    const T = await createTenant(admin, { name: `MFA Org ${Date.now()}`, mfaRequired: true });
    const u = await createUserDirect(admin, { tenantId: T.tenant.id, email: `mfa${Date.now()}@t.test`, name: 'M', role: 'practitioner', password: PW });
    const { res, cookie } = await signIn(u.email);
    expect(res.headers.location).toBe('/mfa');
    expect((await app.inject({ url: '/', headers: { cookie } })).headers.location).toBe('/mfa');
    const page = await app.inject({ url: '/mfa', headers: { cookie } });
    const secret = (await admin.query('select totp_secret from users where id=$1', [u.id])).rows[0].totp_secret;
    await admin.end();
    expect(page.body).toContain(secret.slice(0, 4));
    const bad = await app.inject({ method: 'POST', url: '/mfa', headers: { cookie }, payload: { _csrf: csrfFrom(page.body), code: '000000' } });
    expect(bad.headers.location).toMatch(/^\/mfa\?e=/);
    const ok = await app.inject({ method: 'POST', url: '/mfa', headers: { cookie }, payload: { _csrf: csrfFrom(page.body), code: totpAt(secret, Date.now()) } });
    expect(ok.headers.location).toBe('/');
    expect((await app.inject({ url: '/', headers: { cookie } })).statusCode).toBe(200);
  });

  it('locks an account after repeated failures without revealing whether it exists', async () => {
    const unknown = await signIn('nobody@nowhere.test', 'whatever-password');
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
    const email = (await createUserDirect(admin, { tenantId: w.A.tenant.id, email: `lock${Date.now()}@t.test`, name: 'L', role: 'action_owner', password: PW })).email;
    await admin.end();
    let last: any;
    for (let i = 0; i < 5; i++) last = await signIn(email, 'wrong-password-123');
    expect(decodeURIComponent(unknown.res.headers.location as string)).toContain('not recognised');
    const locked = await signIn(email);
    expect(decodeURIComponent(locked.res.headers.location as string)).toContain('locked');
    void last;
  });

  it('enforces CSRF tokens on form posts and the sync API', async () => {
    const { cookie } = await signIn(w.a.prac.email);
    const r = await app.inject({ method: 'POST', url: '/sites', headers: { cookie }, payload: { name: 'No token site' } });
    expect(r.statusCode).toBe(403);
    const api = await app.inject({ method: 'POST', url: '/api/sync', headers: { cookie, 'content-type': 'application/json' }, payload: { items: [] } });
    expect(api.statusCode).toBe(403);
  });

  it('revokes the session on sign-out', async () => {
    const { cookie } = await signIn(w.a.rev.email);
    const home = await app.inject({ url: '/', headers: { cookie } });
    await app.inject({ method: 'POST', url: '/logout', headers: { cookie }, payload: { _csrf: csrfFrom(home.body) } });
    expect((await app.inject({ url: '/', headers: { cookie } })).statusCode).toBe(302);
  });

  it('forces a password change after sign-in with an administrator-issued temporary password', async () => {
    const { createUser } = await import('../src/services/admin.js');
    const r = await createUser(w.a.admin, { email: `temp${Date.now()}@t.test`, name: 'Temp User', role: 'field_technician' });
    const { cookie } = await signIn(r.user.email, r.temporaryPassword);
    const home = await app.inject({ url: '/', headers: { cookie } });
    expect(home.headers.location).toBe('/account?force=1');
    const acct = await app.inject({ url: '/account', headers: { cookie } });
    await app.inject({ method: 'POST', url: '/account/password', headers: { cookie }, payload: { _csrf: csrfFrom(acct.body), current: r.temporaryPassword, next: 'a brand new long password' } });
    expect((await app.inject({ url: '/', headers: { cookie } })).statusCode).toBe(200);
  });

  it('sets security headers', async () => {
    const r = await app.inject({ url: '/login' });
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('authorisation over HTTP', () => {
  it('blocks pages and actions outside a role, and other tenants’ records', async () => {
    const site = await reg.createSite(w.a.prac, { client_id: w.A.clients['Client One'], name: 'HTTP site' });
    const tech = await signIn(w.a.tech.email);
    expect((await app.inject({ url: '/admin', headers: { cookie: tech.cookie } })).statusCode).toBe(403);
    const home = await app.inject({ url: '/', headers: { cookie: tech.cookie } });
    const post = await app.inject({ method: 'POST', url: '/sites', headers: { cookie: tech.cookie, referer: 'http://localhost/register' }, payload: { _csrf: csrfFrom(home.body), name: 'Tech site' } });
    expect(post.statusCode).toBe(303);
    expect(decodeURIComponent(cookieOf(post))).not.toContain('Site added');
    const other = await signIn(w.b.prac.email);
    expect((await app.inject({ url: `/sites/${site.id}`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    const c2 = await signIn(w.a.client2.email);
    expect((await app.inject({ url: `/sites/${site.id}`, headers: { cookie: c2.cookie } })).statusCode).toBe(404);
    const c1 = await signIn(w.a.client1.email);
    expect((await app.inject({ url: `/sites/${site.id}`, headers: { cookie: c1.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/export', headers: { cookie: c1.cookie } })).statusCode).toBe(403);
  });

  it('every main page renders for each role without server errors', async () => {
    const pages = ['/', '/register', '/workers', '/plans', '/calendar', '/samples', '/instruments', '/lab', '/assessments', '/controls', '/actions', '/verification', '/reports', '/reference', '/account'];
    for (const who of ['admin', 'prac', 'tech', 'rev', 'owner', 'client1'] as const) {
      const { cookie } = await signIn(w.a[who].email);
      for (const p of pages) {
        const r = await app.inject({ url: p, headers: { cookie } });
        expect([200, 403], `${who} ${p}`).toContain(r.statusCode);
      }
    }
  });
});
