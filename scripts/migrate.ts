// Applies SQL migrations in order using the admin (owner) connection.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export async function migrate(adminUrl: string) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    // TR-09: the schema needs a UTF-8 database (e.g. Unicode normalisation in migration 028); refuse anything else early.
    const enc = (await c.query(`select pg_encoding_to_char(encoding) e, current_database() d from pg_database where datname = current_database()`)).rows[0];
    if (enc.e !== 'UTF8') throw new Error(`Database ${enc.d} uses ${enc.e} encoding; OHEA requires UTF8. Create it with: create database ${enc.d} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
    const dir = join(import.meta.dirname, '..', 'db', 'migrations');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const done = await c.query('select 1 from schema_migrations where name=$1', [f]);
      if (done.rowCount) continue;
      await c.query('begin');
      await c.query(readFileSync(join(dir, f), 'utf8'));
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
      await c.query('commit');
      console.log('applied', f);
    }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

/** Migration files not yet applied (empty for a fresh database that has no schema_migrations table yet). */
export async function pendingMigrations(adminUrl: string): Promise<string[]> {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    const exists = (await c.query(`select to_regclass('public.schema_migrations') t`)).rows[0].t;
    if (!exists) return [];
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
    return readdirSync(join(import.meta.dirname, '..', 'db', 'migrations')).filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
  } finally { await c.end(); }
}

/** Sets the application role's password from a secret, replacing the development default created by migration 002. */
export async function setAppRolePassword(adminUrl: string, password: string) {
  if (password.length < 16) throw new Error('APP_DB_PASSWORD must be at least 16 characters');
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    const { rows } = await c.query('select format($$alter role ohea_app password %L$$, $1::text) sql', [password]);
    await c.query(rows[0].sql);
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate(process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres_dev@localhost:5432/ohea').then(
    () => process.exit(0),
    (e) => { console.error(e); process.exit(1); },
  );
}
