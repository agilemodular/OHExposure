// Recovery of unsynchronised field records without the capturing user's device PIN.
//
// Each offline record is additionally sealed in a "recovery envelope": a fresh AES-256-GCM key encrypts the record and
// that key is wrapped with the organisation's RSA-OAEP-256 public key. The matching private key is stored only in
// encrypted form (AES-256-GCM under FIELD_RECOVERY_KEK, held outside the database). A recovery file exported from a
// device therefore contains ciphertext only; it can be opened only by this server, for the same organisation, by a
// user with the conflicts.resolve permission. Recovered records go through the normal idempotent sync path, so a
// record that already reached the server is recognised as a duplicate and a stale edit becomes a reviewable conflict.
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt, constants, randomBytes, scryptSync } from 'node:crypto';
import { z } from 'zod';
import { sendAlert } from '../alerts.js';
import { audit, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { invalid } from '../errors.js';
import { syncBatch } from './field.js';

function kek(): Buffer {
  const v = process.env.FIELD_RECOVERY_KEK;
  if (v) {
    const b = Buffer.from(v, 'base64');
    if (b.length !== 32) throw new Error('FIELD_RECOVERY_KEK must be 32 bytes, base64-encoded');
    return b;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('FIELD_RECOVERY_KEK is required in production');
  // Development and test only: a fixed, publicly known key. Never protects anything real.
  return scryptSync('ohea-development-recovery-kek', 'ohea', 32);
}
export function assertRecoveryKeyConfigured() { kek(); }

const seal = (plain: Buffer) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', kek(), iv); const ct = Buffer.concat([c.update(plain), c.final()]); return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.'); };
const unseal = (s: string) => { const [iv, tag, ct] = s.split('.').map((x) => Buffer.from(x, 'base64')); const d = createDecipheriv('aes-256-gcm', kek(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]); };

/** Returns the organisation's recovery public key (SPKI, base64), creating the key pair on first use. */
export async function recoveryPublicKey(tx: Tx, tenantId: string): Promise<string> {
  const k = await one(tx, 'select public_key_spki from field_recovery_keys');
  if (k) return k.public_key_spki;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const r = await one(tx, `insert into field_recovery_keys (tenant_id, public_key_spki, private_key_enc) values ($1,$2,$3) on conflict (tenant_id) do nothing returning public_key_spki`, [tenantId, spki, seal(pkcs8)]);
  return r?.public_key_spki ?? (await one(tx, 'select public_key_spki from field_recovery_keys')).public_key_spki;
}

const envelope = z.object({ v: z.literal(1), wk: z.string().min(16), iv: z.string().min(8), ct: z.string().min(8) });
const file = z.object({
  format: z.literal('ohea-field-recovery'), version: z.literal(1), tenant_id: z.string().uuid(), user_id: z.string().uuid(),
  exported_at: z.string(), records: z.array(envelope).min(1).max(500),
});

export async function importRecoveryFile(a: Actor, raw: string) {
  requirePerm(a, 'conflicts.resolve');
  let parsed: z.infer<typeof file>;
  try { parsed = file.parse(JSON.parse(raw)); } catch { throw invalid('This is not a valid field recovery file.'); }
  if (parsed.tenant_id !== a.tenantId) throw invalid('This recovery file belongs to a different organisation and cannot be imported here.');
  const sha = createHash('sha256').update(raw).digest('hex');
  const { pk, already } = await withActor(a, async (tx) => ({
    pk: await one(tx, 'select private_key_enc from field_recovery_keys'),
    already: await one(tx, 'select id, imported_at from field_recovery_imports where file_sha256=$1', [sha]),
  }));
  if (!pk) throw invalid('No recovery key exists for this organisation, so this file cannot have been produced here.');
  const priv = { key: unseal(pk.private_key_enc), format: 'der' as const, type: 'pkcs8' as const, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };
  const items: any[] = [];
  const undecryptable: number[] = [];
  parsed.records.forEach((e, i) => {
    try {
      const key = privateDecrypt(priv, Buffer.from(e.wk, 'base64'));
      const buf = Buffer.from(e.ct, 'base64');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
      d.setAuthTag(buf.subarray(buf.length - 16));
      const rec = JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
      // The sealed content names its organisation and user; both must match the file header.
      if (rec.tenant_id !== a.tenantId || rec.user_id !== parsed.user_id) { undecryptable.push(i + 1); return; }
      items.push({ client_uuid: rec.client_uuid, server_id: rec.server_id ?? null, base_version: rec.base_version ?? null, payload: rec.payload });
    } catch { undecryptable.push(i + 1); }
  });
  // Recovered records are attributed to the importing user, with the original capturing user recorded on each record.
  const results = items.length ? await syncBatch(a, items, { recoveredFromUser: parsed.user_id, requirePerm: false }) : [];
  const outcomes = { total: parsed.records.length, undecryptable, results: results.map((r) => ({ client_uuid: r.client_uuid, outcome: r.outcome, message: r.message ?? null })) };
  await withActor(a, async (tx) => {
    await tx.query('insert into field_recovery_imports (tenant_id, file_sha256, original_user_id, imported_by, items, outcomes) values ($1,$2,$3,$4,$5,$6)',
      [a.tenantId, sha, parsed.user_id, a.userId, parsed.records.length, outcomes]);
    await audit(tx, a, 'field.recovery_import', 'user', parsed.user_id, { file_sha256: sha, items: parsed.records.length, undecryptable: undecryptable.length, previously_imported: already?.id ?? null });
  });
  void sendAlert('field.recovery_imported', { tenant_id: a.tenantId, imported_by: a.userId, original_user: parsed.user_id, items: parsed.records.length }, sha);
  return { ...outcomes, previouslyImportedAt: already?.imported_at ?? null };
}
