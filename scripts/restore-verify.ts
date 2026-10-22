// Restore verification: restores a backup into a scratch database and scratch attachment folder on the same server,
// then checks that what came back is complete and intact.
//
//   DATABASE_ADMIN_URL=... npx tsx scripts/restore-verify.ts <backup dir> [--keep] [--evidence-label "<environment name>"]
//
// Checks: manifest checksums before restoring; row counts of key tables against the manifest; RLS policy count and
// forced RLS on every table; applied migrations; append-only triggers on the audit trail; every attachment row has its
// file and the file matches the recorded SHA-256. Records the measured restore time and the recovery point (backup time).
// Writes restore-verification-<timestamp>.json next to the backup. Failures raise a critical alert.
//
// This verifies that a backup can be restored. It is evidence for the hosting environment only when run there,
// against that environment's backups, and labelled with --evidence-label.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { sendAlert } from '../src/alerts.js';
import { dbFacts, KEY_TABLES, sha256File } from './backup.js';

export async function restoreVerify(adminUrl: string, dir: string, o: { keep?: boolean; label?: string } = {}) {
  const started = Date.now();
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const checks: { check: string; ok: boolean; detail?: string }[] = [];
  const add = (check: string, ok: boolean, detail?: string) => { checks.push({ check, ok, detail }); return ok; };
  const scratchName = `ohea_restore_${Date.now()}`;
  const u = new URL(adminUrl);
  const maint = new URL(adminUrl); maint.pathname = '/postgres';
  const scratchUrl = new URL(adminUrl); scratchUrl.pathname = `/${scratchName}`;
  const files = mkdtempSync(join(tmpdir(), 'ohea-restore-'));
  let created = false;
  try {
    add('database dump checksum matches manifest', (await sha256File(join(dir, manifest.db.file))) === manifest.db.sha256);
    add('attachment archive checksum matches manifest', (await sha256File(join(dir, manifest.attachments.file))) === manifest.attachments.sha256);
    if (checks.some((c) => !c.ok)) throw new Error('Backup files do not match their manifest; not restoring');

    const m = new pg.Client({ connectionString: maint.toString() }); await m.connect();
    await m.query(`create database ${scratchName} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`); created = true;
    await m.end();
    execFileSync('pg_restore', ['--exit-on-error', '--no-password', '-d', scratchUrl.toString(), join(dir, manifest.db.file)], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('tar', ['-xf', join(dir, manifest.attachments.file), '-C', files]);

    const f = await dbFacts(scratchUrl.toString());
    for (const t of KEY_TABLES) add(`row count ${t}`, f.counts[t] === manifest.counts[t], `${f.counts[t]} restored / ${manifest.counts[t]} at backup`);
    add('RLS policies restored', f.policies === manifest.policies && f.policies > 0, `${f.policies} / ${manifest.policies}`);
    add('row-level security forced on every table', f.unforced.length === 0, f.unforced.join(', ') || 'all tables');
    add('applied migrations match', JSON.stringify(f.migrations) === JSON.stringify(manifest.migrations), `${f.migrations.length} migrations, latest ${f.migrations.at(-1)}`);

    const c = new pg.Client({ connectionString: scratchUrl.toString() }); await c.connect();
    try {
      const trig = (await c.query(`select count(*)::int n from pg_trigger where tgrelid='audit_events'::regclass and not tgisinternal`)).rows[0].n;
      add('audit trail append-only triggers present', trig > 0, `${trig} trigger(s)`);
      const att = (await c.query('select id, storage_key, sha256 from attachments')).rows;
      const bad: string[] = [];
      for (const a of att) {
        const p = join(files, a.storage_key);
        if (!existsSync(p) || createHash('sha256').update(readFileSync(p)).digest('hex') !== a.sha256) bad.push(a.id);
      }
      add('every attachment present with matching SHA-256', bad.length === 0, `${att.length - bad.length}/${att.length} verified${bad.length ? `; failed: ${bad.slice(0, 5).join(', ')}` : ''}`);
    } finally { await c.end(); }

    const ok = checks.every((x) => x.ok);
    const report = {
      format: 'ohea-restore-verification', version: 1, ok, evidence_label: o.label ?? 'unlabelled (not hosting-environment evidence)',
      verified_at: new Date().toISOString(), backup_dir: dir, recovery_point: manifest.created_at, restore_duration_ms: Date.now() - started,
      source_server: manifest.server, restore_server: f.server, host: u.hostname, checks,
    };
    writeFileSync(join(dir, `restore-verification-${report.verified_at.replace(/[-:.]/g, '')}.json`), JSON.stringify(report, null, 2));
    if (!ok) await sendAlert('restore_verify.failed', { backup_dir: dir, failed: checks.filter((x) => !x.ok).map((x) => x.check) });
    return report;
  } catch (e: any) {
    const msg = String(e.stderr ?? e.message ?? e).slice(0, 500);
    await sendAlert('restore_verify.failed', { backup_dir: dir, error: msg });
    throw new Error(`Restore verification failed: ${msg}`);
  } finally {
    rmSync(files, { recursive: true, force: true });
    if (created && !o.keep) {
      const m = new pg.Client({ connectionString: maint.toString() }); await m.connect();
      await m.query(`drop database if exists ${scratchName}`).catch(() => {});
      await m.end();
    }
  }
}

if (process.argv[1]?.endsWith('restore-verify.ts')) {
  const a = process.argv.slice(2);
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !a[0]) { console.error('Usage: DATABASE_ADMIN_URL=... npx tsx scripts/restore-verify.ts <backup dir> [--keep] [--evidence-label "<env>"]'); process.exit(1); }
  const li = a.indexOf('--evidence-label');
  restoreVerify(url, a[0], { keep: a.includes('--keep'), label: li >= 0 ? a[li + 1] : undefined })
    .then((r) => { for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.check}${c.detail ? ` — ${c.detail}` : ''}`); console.log(`\n${r.ok ? 'Restore verified' : 'RESTORE VERIFICATION FAILED'} in ${(r.restore_duration_ms / 1000).toFixed(1)} s; recovery point ${r.recovery_point}`); process.exit(r.ok ? 0 : 1); },
      (e) => { console.error(e.message); process.exit(1); });
}
