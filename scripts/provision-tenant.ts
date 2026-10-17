// Provisions a real (non-demonstration) organisation: MFA enforced, clients created, and a first administrator
// whose one-time password must be changed at first sign-in. Runs with the owner connection (outside tenant RLS).
//
//   npm run provision -- --name "Acme Fabrication Ltd" --admin-email alex@acme.example --admin-name "Alex Smith"
//   npm run provision -- --name "Hygiene Consultants Ltd" --kind consultancy --client "Client A" --client "Client B" ...
import pg from 'pg';
import { hashPassword, randomToken } from '../src/auth/crypto.js';

export interface ProvisionInput {
  name: string;
  kind: 'direct' | 'consultancy';
  clients: string[];
  adminEmail: string;
  adminName: string;
  allowWithDemo?: boolean;
}

export async function provisionTenant(adminUrl: string, i: ProvisionInput) {
  if (i.name.trim().length < 2) throw new Error('Organisation name is required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.adminEmail)) throw new Error('A valid administrator email is required');
  if (i.adminName.trim().length < 2) throw new Error('Administrator name is required');
  if (i.kind === 'consultancy' && !i.clients.length) throw new Error('A consultancy needs at least one --client');
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('begin');
    const demo = await c.query('select name from tenants where is_demo');
    if (demo.rowCount && !i.allowWithDemo)
      throw new Error(`This database contains a demonstration tenant (${demo.rows[0].name}). Pilot and production organisations must not share a database with demo data. Use a separate database, or pass --allow-with-demo for testing only.`);
    if ((await c.query('select 1 from tenants where lower(name)=lower($1)', [i.name.trim()])).rowCount) throw new Error('An organisation with that name already exists');
    if ((await c.query('select 1 from users where lower(email)=lower($1)', [i.adminEmail])).rowCount) throw new Error('That administrator email is already registered');
    const t = (await c.query(`insert into tenants (name, kind, is_demo, mfa_required) values ($1,$2,false,true) returning id`, [i.name.trim(), i.kind])).rows[0];
    const clientNames = i.clients.length ? i.clients : [i.name.trim()];
    for (const [n, cn] of clientNames.entries())
      await c.query('insert into clients (tenant_id, name, is_default) values ($1,$2,$3)', [t.id, cn.trim(), n === 0 && i.kind === 'direct']);
    const temp = randomToken(15);
    const u = (await c.query(`insert into users (tenant_id, email, name, role, password_hash, must_change_password) values ($1,lower($2),$3,'org_admin',$4,true) returning id`,
      [t.id, i.adminEmail, i.adminName.trim(), hashPassword(temp)])).rows[0];
    await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values ($1,null,'tenant.provisioned','tenant',$2,$3)`,
      [t.id, String(t.id), { kind: i.kind, clients: clientNames, first_admin: u.id, mfa_required: true }]);
    await c.query('commit');
    return { tenantId: t.id as string, adminUserId: u.id as string, temporaryPassword: temp };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

function parseArgs(argv: string[]): ProvisionInput {
  const get = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const clients: string[] = [];
  argv.forEach((a, i) => { if (a === '--client' && argv[i + 1]) clients.push(argv[i + 1]); });
  return {
    name: get('--name') ?? '',
    kind: (get('--kind') ?? 'direct') === 'consultancy' ? 'consultancy' : 'direct',
    clients,
    adminEmail: get('--admin-email') ?? '',
    adminName: get('--admin-name') ?? '',
    allowWithDemo: argv.includes('--allow-with-demo'),
  };
}

if (process.argv[1]?.endsWith('provision-tenant.ts')) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('DATABASE_ADMIN_URL is required'); process.exit(1); }
  provisionTenant(url, parseArgs(process.argv.slice(2))).then((r) => {
    console.log('Organisation provisioned. Two-step verification is required for all users.');
    console.log(`Administrator one-time password: ${r.temporaryPassword}`);
    console.log('Give it to the administrator through a separate secure channel. It is shown only once and must be changed at first sign-in.');
    process.exit(0);
  }, (e) => { console.error(`Not provisioned: ${e.message}`); process.exit(1); });
}
