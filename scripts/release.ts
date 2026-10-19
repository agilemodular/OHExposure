// Release steps run before the application starts, with the owner connection, in a separate one-shot process so the
// running application never holds owner credentials:
//   1. refuse unsafe production configuration;
//   2. take a backup before applying pending migrations (rollback point; required in production);
//   3. apply migrations; 4. set the application role password from its secret;
//   5. refuse to continue if any field recovery key does not open with the configured KEK.
//   DATABASE_ADMIN_URL=… [PRE_MIGRATION_BACKUP_DIR=…] npx tsx scripts/release.ts
import { migrate, pendingMigrations, setAppRolePassword } from './migrate.js';
import { runBackup } from './backup.js';
import { verifyRecoveryKeys } from './recovery-keys.js';

export async function release(env: NodeJS.ProcessEnv = process.env) {
  const adminUrl = env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required to apply migrations');
  if (env.NODE_ENV === 'production') {
    if (!env.APP_DB_PASSWORD) throw new Error('APP_DB_PASSWORD is required in production');
    if (!env.FIELD_RECOVERY_KEK) throw new Error('FIELD_RECOVERY_KEK is required in production');
  }
  const pending = await pendingMigrations(adminUrl);
  if (pending.length && env.PRE_MIGRATION_BACKUP_DIR) {
    const b = await runBackup({ adminUrl, storageDir: env.STORAGE_DIR ?? '/data/attachments/', backupDir: env.PRE_MIGRATION_BACKUP_DIR, retainDays: 365 });
    console.log(JSON.stringify({ level: 'info', msg: 'pre-migration backup', dir: b.dir, pending }));
  } else if (pending.length && env.NODE_ENV === 'production') {
    throw new Error(`Migrations pending (${pending.join(', ')}) and PRE_MIGRATION_BACKUP_DIR is not set; refusing to migrate without a rollback point`);
  }
  await migrate(adminUrl);
  if (env.APP_DB_PASSWORD) await setAppRolePassword(adminUrl, env.APP_DB_PASSWORD);
  const keys = await verifyRecoveryKeys(adminUrl);
  if (keys.invalid.length) throw new Error(`Field recovery keys do not open with FIELD_RECOVERY_KEK for ${keys.invalid.length} organisation(s); see scripts/recovery-keys.ts`);
}

if (process.argv[1]?.endsWith('release.ts')) {
  release().then(() => { console.log('release steps complete'); process.exit(0); }, (e) => { console.error(e.message); process.exit(1); });
}
