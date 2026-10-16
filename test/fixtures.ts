import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createTenant, createUserDirect, loadSyntheticReference } from '../scripts/bootstrap.js';
import { actorFrom, type Actor } from '../src/db.js';
import type { Role } from '../src/authz.js';

export type World = Awaited<ReturnType<typeof buildWorld>>;
let ref: Awaited<ReturnType<typeof loadSyntheticReference>> | null = null;

export async function buildWorld() {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  if (!ref) {
    const existing = (await admin.query(`select v.id mv, s.id sub, bv.id bv from sampling_method_versions v, substances s, benchmark_versions bv
      join benchmarks b on b.id=bv.benchmark_id where s.is_synthetic and bv.is_synthetic and b.substance_id=s.id limit 1`)).rows[0];
    ref = existing ? { substanceId: existing.sub, benchmarkVersionId: existing.bv, methodVersionId: existing.mv } : await loadSyntheticReference(admin);
  }
  const tag = randomUUID().slice(0, 8);
  const A = await createTenant(admin, { name: `Consultancy ${tag}`, kind: 'consultancy', clients: ['Client One', 'Client Two'], mfaRequired: false });
  const B = await createTenant(admin, { name: `Other Org ${tag}`, kind: 'direct', mfaRequired: false });
  const mk = async (t: { tenant: any }, role: Role, clientId?: string) => {
    const u = await createUserDirect(admin, { tenantId: t.tenant.id, email: `${role}.${randomUUID().slice(0, 6)}@${tag}.test`, name: `${role} ${tag}`, role, password: 'correct horse battery', clientId });
    return actorFrom(u);
  };
  const a = {
    admin: await mk(A, 'org_admin'),
    prac: await mk(A, 'practitioner'),
    prac2: await mk(A, 'practitioner'),
    tech: await mk(A, 'field_technician'),
    rev: await mk(A, 'technical_reviewer'),
    owner: await mk(A, 'action_owner'),
    client1: await mk(A, 'client_readonly', A.clients['Client One']),
    client2: await mk(A, 'client_readonly', A.clients['Client Two']),
  };
  const b = { prac: await mk(B, 'practitioner'), admin: await mk(B, 'org_admin') };
  await admin.end();
  return { A, B, a, b, ref: ref!, tag };
}

export const as = (x: Actor) => x;
