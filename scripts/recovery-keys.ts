// Field recovery key administration (owner connection; platform operator only).
//
//   verify:  DATABASE_ADMIN_URL=… FIELD_RECOVERY_KEK=… npx tsx scripts/recovery-keys.ts verify
//            Every organisation's recovery key must open with the configured KEK and its public key must match its
//            private key. Run by scripts/start.ts before the server starts.
//   rotate:  DATABASE_ADMIN_URL=… FIELD_RECOVERY_KEK=<current> FIELD_RECOVERY_KEK_NEW=<new> npx tsx scripts/recovery-keys.ts rotate --authorised-by "<name>"
//            Re-seals every private key under the new KEK in one transaction (all or nothing). The organisations' key
//            pairs are unchanged, so recovery files already on devices stay importable. Then replace
//            FIELD_RECOVERY_KEK with the new value and restart. Attestation keys derive from the key pair, not the KEK,
//            so devices and existing recovery envelopes are unaffected.
//   replace: … npx tsx scripts/recovery-keys.ts replace --tenant <id> --authorised-by "<name>" --reason "<why>"
//            New key pair version for one organisation; earlier versions are kept for importing older envelopes.
import pg from 'pg';
import { keyRowValid, kekFromEnv, newKeyMaterial, sealWith, unsealWith } from '../src/services/recovery.js';

const parseKek = (v: string | undefined, name: string) => {
  const b = Buffer.from(v ?? '', 'base64');
  if (b.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return b;
};

export async function verifyRecoveryKeys(url: string) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    const rows = (await c.query('select tenant_id, key_version, public_key_spki, private_key_enc from field_recovery_keys')).rows;
    const k = kekFromEnv();
    const bad = rows.filter((r) => !keyRowValid(r, k)).map((r) => `${r.tenant_id} v${r.key_version}`);
    return { total: rows.length, invalid: bad };
  } finally { await c.end(); }
}

export async function rotateRecoveryKek(url: string, oldKek: Buffer, newKek: Buffer, authorisedBy: string) {
  if (!authorisedBy?.trim()) throw new Error('--authorised-by is required');
  if (oldKek.equals(newKek)) throw new Error('The new KEK must differ from the current one');
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('begin');
    const rows = (await c.query('select tenant_id, key_version, public_key_spki, private_key_enc from field_recovery_keys for update')).rows;
    for (const r of rows) {
      if (!keyRowValid(r, oldKek)) throw new Error(`Key for organisation ${r.tenant_id} (v${r.key_version}) does not open with the current KEK; nothing rotated`);
      const enc = sealWith(newKek, unsealWith(oldKek, r.private_key_enc));
      await c.query('update field_recovery_keys set private_key_enc=$3 where tenant_id=$1 and key_version=$2', [r.tenant_id, r.key_version, enc]);
      if (!keyRowValid({ ...r, private_key_enc: enc }, newKek)) throw new Error('Re-sealed key failed verification; nothing rotated');
    }
    await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values (null, null, 'platform.recovery_kek_rotated', 'field_recovery_keys', null, $1)`,
      [{ keys: rows.length, authorised_by: authorisedBy }]);
    await c.query('commit');
    return { rotated: rows.length };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { await c.end(); }
}

/**
 * Replaces an organisation's recovery key pair (suspected compromise of a private key, or scheduled replacement).
 * In one transaction: verifies the current key, deactivates it and creates the next version. Old versions are never
 * deleted, so envelopes on devices that have not yet reconnected remain importable; devices re-seal their
 * unsynchronised records to the new version at their next online unlock.
 */
export async function replaceRecoveryKey(url: string, tenantId: string, authorisedBy: string, reason: string, opts: { simulateFailureAfterDeactivate?: boolean } = {}) {
  if (!authorisedBy?.trim() || !reason?.trim()) throw new Error('--authorised-by and --reason are required');
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('begin');
    const cur = (await c.query('select tenant_id, key_version, public_key_spki, private_key_enc from field_recovery_keys where tenant_id=$1 and active for update', [tenantId])).rows[0];
    if (cur && !keyRowValid(cur)) throw new Error('The current key does not open with the configured KEK; resolve that first (verify)');
    const next = ((await c.query('select coalesce(max(key_version),0)+1 v from field_recovery_keys where tenant_id=$1', [tenantId])).rows[0].v) as number;
    await c.query('update field_recovery_keys set active=false where tenant_id=$1 and active', [tenantId]);
    if (opts.simulateFailureAfterDeactivate) throw new Error('simulated failure (test)');
    const m = newKeyMaterial();
    await c.query('insert into field_recovery_keys (tenant_id, key_version, public_key_spki, private_key_enc, active) values ($1,$2,$3,$4,true)', [tenantId, next, m.public_key_spki, m.private_key_enc]);
    await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values ($1, null, 'platform.recovery_key_replaced', 'field_recovery_keys', $2, $3)`,
      [tenantId, tenantId, { from_version: cur?.key_version ?? null, to_version: next, authorised_by: authorisedBy, reason }]);
    await c.query('commit');
    return { tenantId, version: next };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { await c.end(); }
}

if (process.argv[1]?.endsWith('recovery-keys.ts')) {
  const a = process.argv.slice(2);
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('DATABASE_ADMIN_URL is required'); process.exit(1); }
  const run = async () => {
    if (a[0] === 'verify') { const r = await verifyRecoveryKeys(url); if (r.invalid.length) throw new Error(`${r.invalid.length} of ${r.total} recovery keys invalid: ${r.invalid.join(', ')}`); return r; }
    if (a[0] === 'rotate') { const i = a.indexOf('--authorised-by'); return rotateRecoveryKek(url, parseKek(process.env.FIELD_RECOVERY_KEK, 'FIELD_RECOVERY_KEK'), parseKek(process.env.FIELD_RECOVERY_KEK_NEW, 'FIELD_RECOVERY_KEK_NEW'), i >= 0 ? a[i + 1] : ''); }
    if (a[0] === 'replace') { const g = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : ''; }; return replaceRecoveryKey(url, g('--tenant'), g('--authorised-by'), g('--reason')); }
    throw new Error('Commands: verify, rotate, replace');
  };
  run().then((r) => { console.log(JSON.stringify(r)); process.exit(0); }, (e) => { console.error(`Refused: ${e.message}`); process.exit(1); });
}
