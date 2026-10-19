// Production entrypoint: apply migrations with the owner connection, rotate the app role password from its
// secret, then start the server on the least-privilege connection.
import { migrate, setAppRolePassword } from './migrate.js';
import { verifyRecoveryKeys } from './recovery-keys.js';

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required to apply migrations');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (application role connection) is required');
if (process.env.NODE_ENV === 'production') {
  if (process.env.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE=true is required in production (serve over HTTPS)');
  if (!process.env.APP_DB_PASSWORD) throw new Error('APP_DB_PASSWORD is required in production');
  if (/ohea_app_dev/.test(process.env.DATABASE_URL)) throw new Error('DATABASE_URL still uses the development password');
}
await migrate(adminUrl);
if (process.env.APP_DB_PASSWORD) await setAppRolePassword(adminUrl, process.env.APP_DB_PASSWORD);
// Refuse to start if any organisation's field recovery key does not open with the configured KEK.
const keys = await verifyRecoveryKeys(adminUrl);
if (keys.invalid.length) throw new Error(`Field recovery keys do not open with FIELD_RECOVERY_KEK for ${keys.invalid.length} organisation(s); see scripts/recovery-keys.ts`);
await import('../src/server.js');
