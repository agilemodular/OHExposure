// Recovery of unsynchronised field records without the capturing user's device PIN.
//
// Each offline record is additionally sealed in a "recovery envelope": a fresh AES-256-GCM key encrypts the record and
// that key is wrapped with the organisation's RSA-OAEP-256 public key. The matching private key is stored only in
// encrypted form (AES-256-GCM under FIELD_RECOVERY_KEK, held outside the database). A recovery file exported from a
// device therefore contains ciphertext only; it can be opened only by this server, for the same organisation, by a
// user with the conflicts.resolve permission. Recovered records go through the normal idempotent sync path, so a
// record that already reached the server is recognised as a duplicate and a stale edit becomes a reviewable conflict.
import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, constants, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sendAlert } from '../alerts.js';
import { audit, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
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

export const sealWith = (k: Buffer, plain: Buffer) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', k, iv); const ct = Buffer.concat([c.update(plain), c.final()]); return [iv, c.getAuthTag(), ct].map((x) => x.toString('base64')).join('.'); };
export const unsealWith = (k: Buffer, s: string) => { const [iv, tag, ct] = s.split('.').map((x) => Buffer.from(x, 'base64')); const d = createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]); };
const seal = (plain: Buffer) => sealWith(kek(), plain);
const unseal = (s: string) => unsealWith(kek(), s);
export const kekFromEnv = kek;

/**
 * Checks that a stored key row opens with the given KEK and that its public key belongs to its private key. A row
 * inserted directly through the application role (with a public key whose private half is not sealed here) fails.
 */
export function keyRowValid(row: { public_key_spki: string; private_key_enc: string; attest_secret_enc?: string | null }, k: Buffer = kek()) {
  try {
    const priv = createPrivateKey({ key: unsealWith(k, row.private_key_enc), format: 'der', type: 'pkcs8' });
    if (row.attest_secret_enc && unsealWith(k, row.attest_secret_enc).length !== 32) return false;
    return createPublicKey(priv).export({ type: 'spki', format: 'der' }).toString('base64') === row.public_key_spki;
  } catch { return false; }
}
const verifiedTenants = new Set<string>();

/** New key material: an RSA-OAEP 3072-bit pair with the private half sealed under the KEK. */
export function newKeyMaterial(k: Buffer = kek()) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  return { public_key_spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), private_key_enc: sealWith(k, privateKey.export({ type: 'pkcs8', format: 'der' })),
    // Separate random secret for attestation keys, so that exposure of a version's private key alone does not allow
    // attributable recovery files to be forged.
    attest_secret_enc: sealWith(k, randomBytes(32)) };
}

export interface ActiveKey { version: number; spki: string; privateKeyEnc: string; attestSecretEnc: string | null }
/**
 * The organisation's active recovery key version, created on first use and verified (against the KEK and its own
 * public half) the first time this process uses it. Older versions are kept, inactive, so envelopes sealed to them on
 * devices that have not reconnected stay importable.
 */
export async function activeRecoveryKey(tx: Tx, tenantId: string): Promise<ActiveKey> {
  let k = await one(tx, 'select key_version, public_key_spki, private_key_enc, attest_secret_enc from field_recovery_keys where active');
  if (!k) {
    const m = newKeyMaterial();
    await tx.query(`insert into field_recovery_keys (tenant_id, key_version, public_key_spki, private_key_enc, attest_secret_enc, active) values ($1,1,$2,$3,$4,true) on conflict do nothing`,
      [tenantId, m.public_key_spki, m.private_key_enc, m.attest_secret_enc]);
    k = await one(tx, 'select key_version, public_key_spki, private_key_enc, attest_secret_enc from field_recovery_keys where active');
  }
  const tag = `${tenantId}:${k.key_version}`;
  if (!verifiedTenants.has(tag)) {
    if (!keyRowValid(k)) {
      void sendAlert('recovery_key.invalid', { tenant_id: tenantId, key_version: k.key_version }, tag);
      throw new Error('Field recovery key for this organisation does not open with FIELD_RECOVERY_KEK or does not match; offline capture is unavailable until a platform operator resolves it (scripts/recovery-keys.ts verify).');
    }
    verifiedTenants.add(tag);
  }
  return { version: k.key_version, spki: k.public_key_spki, privateKeyEnc: k.private_key_enc, attestSecretEnc: k.attest_secret_enc ?? null };
}
export const recoveryPublicKey = async (tx: Tx, tenantId: string) => (await activeRecoveryKey(tx, tenantId)).spki;

/**
 * Per-user attestation key. Sent to the device only inside the PIN-encrypted reference data; each envelope carries an
 * HMAC under it, so a recovery file can only claim records for the user whose device (and PIN) produced it. Holding the
 * organisation's public key alone is not enough to forge an attributable record. Derived from the private key of a key
 * version, so it survives KEK rotation and is distinct for each key version.
 */
export const attestKeyFrom = (privateKeyEnc: string, tenantId: string, userId: string) =>
  createHmac('sha256', createHash('sha256').update(unseal(privateKeyEnc)).digest()).update(`ohea-recovery-attest|${tenantId}|${userId}`).digest('base64');
/** Attestation key of a key version: from its separate secret, or (versions created before that existed) its private key. */
export const attestKeyFor = (row: { privateKeyEnc: string; attestSecretEnc: string | null }, tenantId: string, userId: string) =>
  row.attestSecretEnc
    ? createHmac('sha256', unseal(row.attestSecretEnc)).update(`ohea-recovery-attest|${tenantId}|${userId}`).digest('base64')
    : attestKeyFrom(row.privateKeyEnc, tenantId, userId);
export async function recoveryAttestKey(tx: Tx, tenantId: string, userId: string) {
  return attestKeyFor(await activeRecoveryKey(tx, tenantId), tenantId, userId);
}
/** Envelope MAC. Binds the key version as well as the ciphertext. */
export const envelopeMac = (key: string, e: { kv?: number; wk: string; iv: string; ct: string }) =>
  createHmac('sha256', Buffer.from(key, 'base64')).update(`${e.kv ?? 1}.${e.wk}.${e.iv}.${e.ct}`).digest('base64');
const macOk = (key: string, e: { kv: number; wk: string; iv: string; ct: string; mac: string }, legacy: boolean) => {
  const got = Buffer.from(e.mac, 'base64');
  const eq = (want: Buffer) => got.length === want.length && timingSafeEqual(got, want);
  if (eq(Buffer.from(envelopeMac(key, e), 'base64'))) return true;
  // Version-1 keys created before the MAC covered the version also accept the earlier form.
  return legacy && eq(createHmac('sha256', Buffer.from(key, 'base64')).update(`${e.wk}.${e.iv}.${e.ct}`).digest());
};

const envelope = z.object({ v: z.literal(1), kv: z.number().int().positive().default(1), wk: z.string().min(16).max(2000), iv: z.string().min(8).max(64), ct: z.string().min(8).max(200_000), mac: z.string().min(16).max(200) });
const file = z.object({
  format: z.literal('ohea-field-recovery'), version: z.literal(1), tenant_id: z.string().uuid(), user_id: z.string().uuid(),
  exported_at: z.string(), records: z.array(envelope).min(1).max(200),
});

export async function importRecoveryFile(a: Actor, raw: string) {
  // Importing creates field evidence, so it needs both conflict-resolution and field-capture rights.
  requirePerm(a, 'conflicts.resolve');
  requirePerm(a, 'field.capture');
  if (raw.length > 5_000_000) throw invalid('Recovery file is too large.');
  let parsed: z.infer<typeof file>;
  try { parsed = file.parse(JSON.parse(raw)); } catch { throw invalid('This is not a valid field recovery file.'); }
  if (parsed.tenant_id !== a.tenantId) throw invalid('This recovery file belongs to a different organisation and cannot be imported here.');
  const sha = createHash('sha256').update(raw).digest('hex');
  const { keys, already } = await withActor(a, async (tx) => ({
    keys: await many(tx, 'select key_version, public_key_spki, private_key_enc, attest_secret_enc, revoked_at from field_recovery_keys'),
    already: await one(tx, 'select id, imported_at from field_recovery_imports where file_sha256=$1', [sha]),
  }));
  if (!keys.length) throw invalid('No recovery key exists for this organisation, so this file cannot have been produced here.');
  const owner = await withActor(a, (tx) => one(tx, 'select id from users where id=$1', [parsed.user_id]));
  if (!owner) throw invalid('The user named in this recovery file is not a user of this organisation.');
  // Each envelope names the key version it was sealed to; every version the organisation has had is kept.
  const byVersion = new Map<number, { attest: string; legacy: boolean; priv: any }>();
  for (const k of keys) {
    if (k.revoked_at) continue;     // revoked versions (suspected compromise) open nothing
    if (!keyRowValid(k)) continue;  // an invalid row (wrong KEK, planted) opens nothing
    byVersion.set(k.key_version, { attest: attestKeyFor({ privateKeyEnc: k.private_key_enc, attestSecretEnc: k.attest_secret_enc }, a.tenantId, parsed.user_id), legacy: !k.attest_secret_enc,
      priv: { key: unseal(k.private_key_enc), format: 'der' as const, type: 'pkcs8' as const, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } });
  }
  const items: any[] = [];
  const undecryptable: number[] = [];
  parsed.records.forEach((e, i) => {
    try {
      const kv = byVersion.get(e.kv);
      if (!kv || !macOk(kv.attest, e, kv.legacy)) { undecryptable.push(i + 1); return; }
      const key = privateDecrypt(kv.priv, Buffer.from(e.wk, 'base64'));
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
