// Platform-level provisioning that runs with the owner connection (outside tenant RLS):
// creating a tenant and its first administrator, and loading platform reference data.
import pg from 'pg';
import { hashPassword } from '../src/auth/crypto.js';

export async function createTenant(admin: pg.Client, o: { name: string; kind?: 'direct' | 'consultancy'; isDemo?: boolean; mfaRequired?: boolean; clients?: string[] }) {
  const t = (await admin.query('insert into tenants (name,kind,is_demo,mfa_required) values ($1,$2,$3,$4) returning *', [o.name, o.kind ?? 'direct', o.isDemo ?? false, o.mfaRequired ?? true])).rows[0];
  const clients: Record<string, string> = {};
  const names = o.clients?.length ? o.clients : [o.name];
  for (const [i, n] of names.entries()) {
    clients[n] = (await admin.query('insert into clients (tenant_id,name,is_default) values ($1,$2,$3) returning id', [t.id, n, i === 0 && o.kind !== 'consultancy'])).rows[0].id;
  }
  return { tenant: t, clients };
}

export async function createUserDirect(admin: pg.Client, o: { tenantId: string; email: string; name: string; role: string; password: string; clientId?: string | null; totpSecret?: string; mfaEnabled?: boolean }) {
  return (await admin.query(`insert into users (tenant_id,client_id,email,name,role,password_hash,totp_secret,mfa_enabled) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [o.tenantId, o.clientId ?? null, o.email.toLowerCase(), o.name, o.role, hashPassword(o.password), o.totpSecret ?? null, o.mfaEnabled ?? false])).rows[0];
}

/** Synthetic platform reference rows used for tests and demonstrations. Clearly labelled; NOT real limits. */
export async function loadSyntheticReference(admin: pg.Client) {
  const sub = (await admin.query(`insert into substances (tenant_id,name,cas_number,is_synthetic) values (null,'Demo Dust X (synthetic)',null,true) returning id`)).rows[0].id;
  const b = (await admin.query(`insert into benchmarks (tenant_id,substance_id,jurisdiction,benchmark_type,averaging_minutes) values (null,$1,'DEMO','LTEL',480) returning id`, [sub])).rows[0].id;
  const bv = (await admin.query(`insert into benchmark_versions (tenant_id,benchmark_id,value,unit,source_title,source_version,effective_from,verification_status,verified_by,verified_at,is_synthetic,provenance)
    values (null,$1,0.5,'mg/m3','SYNTHETIC DEMONSTRATION VALUE — not an exposure limit','demo-1','2020-01-01','verified','platform (synthetic)',now(),true,'synthetic') returning id`, [b])).rows[0].id;
  const m = (await admin.query(`insert into sampling_methods (tenant_id,code,title,source_reference) values (null,'DEMO-GRAV','Synthetic gravimetric method (demonstration)','Synthetic — for demonstration and testing only') returning id`)).rows[0].id;
  const mv = (await admin.query(`insert into sampling_method_versions (tenant_id,method_id,version,collection_media,flow_rate_lpm_min,flow_rate_lpm_max,flow_drift_tolerance_pct,min_volume_l,result_basis,suitable_for_formal_assessment)
    values (null,$1,'1','Filter in sampling head (synthetic)',1.5,2.5,5,null,'mass_on_sample',true) returning id`, [m])).rows[0].id;
  return { substanceId: sub, benchmarkVersionId: bv, methodVersionId: mv };
}
