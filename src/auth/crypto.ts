import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Password hashing: scrypt (N=2^15, r=8, p=1), per-password salt.
const N = 32768, R = 8, P = 1, KEYLEN = 64;
export function hashPassword(pw: string): string {
  if (pw.length < 12) throw new Error('Password must be at least 12 characters');
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, r, p, s, h] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(h, 'base64');
  const dk = scryptSync(pw, Buffer.from(s, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
  return timingSafeEqual(dk, expected);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) — compatible with standard authenticator apps
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));
export function totpAt(secret: string, timeMs: number, step = 30) {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}
/** Returns the matched 30-second time-step (for replay protection), or null. */
export function verifyTotpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const w of [-1, 0, 1]) {
    const t = now + w * 30_000;
    const c = totpAt(secret, t);
    if (timingSafeEqual(Buffer.from(c), Buffer.from(code))) return Math.floor(t / 30_000);
  }
  return null;
}
export const verifyTotp = (secret: string, code: string, now = Date.now()) => verifyTotpStep(secret, code, now) !== null;
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
