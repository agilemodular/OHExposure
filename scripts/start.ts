// Production entrypoint: apply migrations with the owner connection, rotate the app role password from its
// secret, then start the server on the least-privilege connection.
import { migrate, pendingMigrations, setAppRolePassword } from './migrate.js';
import { runBackup } from './backup.js';
import { verifyRecoveryKeys } from './recovery-keys.js';

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required to apply migrations');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (application role connection) is required');
if (process.env.NODE_ENV === 'production') {
  if (process.env.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE=true is required in production (serve over HTTPS)');
  if (!process.env.APP_DB_PASSWORD) throw new Error('APP_DB_PASSWORD is required in production');
  if (/ohea_app_dev/.test(process.env.DATABASE_URL)) throw new Error('DATABASE_URL still uses the development password');
}
// Rollback support: before applying migrations to an existing database, take a verified backup to restore if the
// release must be rolled back (migrations are forward-only).
const pending = await pendingMigrations(adminUrl);
if (pending.length && process.env.PRE_MIGRATION_BACKUP_DIR) {
  const b = await runBackup({ adminUrl, storageDir: process.env.STORAGE_DIR ?? '/data/attachments/', backupDir: process.env.PRE_MIGRATION_BACKUP_DIR, retainDays: 365 });
  console.log(JSON.stringify({ level: 'info', msg: 'pre-migration backup', dir: b.dir, pending }));
} else if (pending.length && process.env.NODE_ENV === 'production') {
  throw new Error(`Migrations pending (${pending.join(', ')}) and PRE_MIGRATION_BACKUP_DIR is not set; refusing to migrate without a rollback point`);
}
await migrate(adminUrl);
if (process.env.APP_DB_PASSWORD) await setAppRolePassword(adminUrl, process.env.APP_DB_PASSWORD);
// Refuse to start if any organisation's field recovery key does not open with the configured KEK.
const keys = await verifyRecoveryKeys(adminUrl);
if (keys.invalid.length) throw new Error(`Field recovery keys do not open with FIELD_RECOVERY_KEK for ${keys.invalid.length} organisation(s); see scripts/recovery-keys.ts`);
await import('../src/server.js');
