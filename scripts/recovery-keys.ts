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
import pg from 'pg';
import { keyRowValid, kekFromEnv, sealWith, unsealWith } from '../src/services/recovery.js';

const parseKek = (v: string | undefined, name: string) => {
  const b = Buffer.from(v ?? '', 'base64');
  if (b.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return b;
};

export async function verifyRecoveryKeys(url: string) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    const rows = (await c.query('select tenant_id, public_key_spki, private_key_enc from field_recovery_keys')).rows;
    const k = kekFromEnv();
    const bad = rows.filter((r) => !keyRowValid(r, k)).map((r) => r.tenant_id as string);
    return { total: rows.length, invalid: bad };
  } finally { await c.end(); }
}

export async function rotateRecoveryKek(url: string, oldKek: Buffer, newKek: Buffer, authorisedBy: string) {
  if (!authorisedBy?.trim()) throw new Error('--authorised-by is required');
  if (oldKek.equals(newKek)) throw new Error('The new KEK must differ from the current one');
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('begin');
    const rows = (await c.query('select tenant_id, public_key_spki, private_key_enc from field_recovery_keys for update')).rows;
    for (const r of rows) {
      if (!keyRowValid(r, oldKek)) throw new Error(`Key for organisation ${r.tenant_id} does not open with the current KEK; nothing rotated`);
      const enc = sealWith(newKek, unsealWith(oldKek, r.private_key_enc));
      await c.query('update field_recovery_keys set private_key_enc=$2 where tenant_id=$1', [r.tenant_id, enc]);
      if (!keyRowValid({ ...r, private_key_enc: enc }, newKek)) throw new Error('Re-sealed key failed verification; nothing rotated');
    }
    await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values (null, null, 'platform.recovery_kek_rotated', 'field_recovery_keys', null, $1)`,
      [{ keys: rows.length, authorised_by: authorisedBy }]);
    await c.query('commit');
    return { rotated: rows.length };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { await c.end(); }
}

if (process.argv[1]?.endsWith('recovery-keys.ts')) {
  const a = process.argv.slice(2);
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('DATABASE_ADMIN_URL is required'); process.exit(1); }
  const run = async () => {
    if (a[0] === 'verify') { const r = await verifyRecoveryKeys(url); if (r.invalid.length) throw new Error(`${r.invalid.length} of ${r.total} recovery keys invalid: ${r.invalid.join(', ')}`); return r; }
    if (a[0] === 'rotate') { const i = a.indexOf('--authorised-by'); return rotateRecoveryKek(url, parseKek(process.env.FIELD_RECOVERY_KEK, 'FIELD_RECOVERY_KEK'), parseKek(process.env.FIELD_RECOVERY_KEK_NEW, 'FIELD_RECOVERY_KEK_NEW'), i >= 0 ? a[i + 1] : ''); }
    throw new Error('Commands: verify, rotate');
  };
  run().then((r) => { console.log(JSON.stringify(r)); process.exit(0); }, (e) => { console.error(`Refused: ${e.message}`); process.exit(1); });
}
