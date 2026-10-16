// Applies SQL migrations in order using the admin (owner) connection.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export async function migrate(adminUrl: string) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
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

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate(process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres_dev@localhost:5432/ohea').then(
    () => process.exit(0),
    (e) => { console.error(e); process.exit(1); },
  );
}
