// Backup of both stores that must be restored together: the PostgreSQL database and the attachment store.
//
//   DATABASE_ADMIN_URL=... STORAGE_DIR=... BACKUP_DIR=/var/backups/ohea [BACKUP_RETAIN_DAYS=35] npx tsx scripts/backup.ts
//
// Produces BACKUP_DIR/ohea-<UTC timestamp>/ containing db.dump (pg_dump custom format), attachments.tar and
// manifest.json (SHA-256 of both files, row counts, RLS policy count, applied migrations, tool versions). Backups older
// than the retention period are pruned only after a new backup has completed. Success and failure raise alerts
// (see src/alerts.ts) and update BACKUP_DIR/last-backup.json, which monitoring should check for staleness.
//
// This is a building block for the hosting owner's backup schedule. It does not replace managed point-in-time recovery,
// off-site copies or encryption of the backup location, which belong to the hosting environment.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { sendAlert } from '../src/alerts.js';

export const KEY_TABLES = ['tenants', 'users', 'sampling_events', 'lab_results', 'assessment_revisions', 'reports', 'actions', 'attachments', 'audit_events', 'method_reviews', 'benchmark_versions'];

export const sha256File = (p: string) => new Promise<string>((res, rej) => {
  const h = createHash('sha256');
  createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
});

export async function dbFacts(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const counts: Record<string, number> = {};
    for (const t of KEY_TABLES) counts[t] = (await c.query(`select count(*)::int n from ${t}`)).rows[0].n;
    const policies = (await c.query(`select count(*)::int n from pg_policies where schemaname='public'`)).rows[0].n;
    const unforced = (await c.query(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and relname <> 'schema_migrations' and not (relrowsecurity and relforcerowsecurity) order by 1`)).rows.map((r) => r.relname);
    const migrations = (await c.query('select name from schema_migrations order by name')).rows.map((r) => r.name);
    const server = (await c.query('show server_version')).rows[0].server_version;
    return { counts, policies, unforced, migrations, server };
  } finally { await c.end(); }
}

export async function runBackup(o: { adminUrl: string; storageDir: string; backupDir: string; retainDays: number; now?: Date }) {
  const stamp = (o.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = join(o.backupDir, `ohea-${stamp}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const started = Date.now();
  try {
    const facts = await dbFacts(o.adminUrl);
    execFileSync('pg_dump', ['-Fc', '--no-password', '-f', join(dir, 'db.dump'), o.adminUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (!existsSync(o.storageDir)) mkdirSync(o.storageDir, { recursive: true });
    execFileSync('tar', ['-cf', join(dir, 'attachments.tar'), '-C', o.storageDir, '.'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const files = Number(execFileSync('tar', ['-tf', join(dir, 'attachments.tar')]).toString().split('\n').filter((l) => l && !l.endsWith('/')).length);
    const manifest = {
      format: 'ohea-backup', version: 1, created_at: new Date(started).toISOString(),
      db: { file: 'db.dump', sha256: await sha256File(join(dir, 'db.dump')), bytes: statSync(join(dir, 'db.dump')).size },
      attachments: { file: 'attachments.tar', sha256: await sha256File(join(dir, 'attachments.tar')), bytes: statSync(join(dir, 'attachments.tar')).size, files },
      ...facts, pg_dump: execFileSync('pg_dump', ['--version']).toString().trim(), duration_ms: Date.now() - started,
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    // Prune only after success, and only directories this script created.
    const cutoff = Date.now() - o.retainDays * 86_400_000;
    const pruned: string[] = [];
    for (const d of readdirSync(o.backupDir)) {
      const p = join(o.backupDir, d);
      if (/^ohea-\d{8}T\d{6}Z$/.test(d) && p !== dir && existsSync(join(p, 'manifest.json')) && statSync(p).mtimeMs < cutoff) { rmSync(p, { recursive: true, force: true }); pruned.push(d); }
    }
    writeFileSync(join(o.backupDir, 'last-backup.json'), JSON.stringify({ ok: true, at: manifest.created_at, dir, pruned }, null, 2));
    await sendAlert('backup.succeeded', { dir, db_bytes: manifest.db.bytes, attachments: files, duration_ms: manifest.duration_ms });
    return { dir, manifest, pruned };
  } catch (e: any) {
    const msg = String(e.stderr ?? e.message ?? e).slice(0, 500);
    rmSync(dir, { recursive: true, force: true });
    try { writeFileSync(join(o.backupDir, 'last-backup.json'), JSON.stringify({ ok: false, at: new Date().toISOString(), error: msg }, null, 2)); } catch { /* backup dir unwritable */ }
    await sendAlert('backup.failed', { error: msg, backup_dir: o.backupDir });
    throw new Error(`Backup failed: ${msg}`);
  }
}

if (process.argv[1]?.endsWith('backup.ts')) {
  const adminUrl = process.env.DATABASE_ADMIN_URL, backupDir = process.env.BACKUP_DIR;
  if (!adminUrl || !backupDir) { console.error('DATABASE_ADMIN_URL and BACKUP_DIR are required'); process.exit(1); }
  runBackup({ adminUrl, backupDir, storageDir: process.env.STORAGE_DIR ?? new URL('../storage/', import.meta.url).pathname, retainDays: Number(process.env.BACKUP_RETAIN_DAYS ?? 35) })
    .then((r) => { console.log(JSON.stringify({ ok: true, dir: r.dir, db_bytes: r.manifest.db.bytes, attachments: r.manifest.attachments.files, pruned: r.pruned })); process.exit(0); },
      (e) => { console.error(e.message); process.exit(1); });
}
