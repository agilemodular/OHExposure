// Regenerates docs/examples/example-report.synthetic.html: builds a fresh, disposable database, seeds the
// demonstration organisation (synthetic data only) and exports its issued report unchanged.
//   npx tsx scripts/export-example-report.ts
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const SUPER = process.env.EXAMPLE_SUPER_URL ?? 'postgres://postgres:postgres_dev@localhost:5432/postgres';
const DB = 'ohea_example_report';
const admin = SUPER.replace(/\/[^/]+$/, `/${DB}`);
const c = new pg.Client({ connectionString: SUPER }); await c.connect();
await c.query(`drop database if exists ${DB} with (force)`); await c.query(`create database ${DB}`); await c.end();
const env = { ...process.env, DATABASE_ADMIN_URL: admin, DATABASE_URL: (() => { const u = new URL(admin); u.username = 'ohea_app'; u.password = process.env.OHEA_APP_PASSWORD ?? 'ohea_app_dev'; return u.toString(); })() };
execFileSync('npx', ['tsx', '-e', `import('./scripts/migrate.ts').then((m) => m.migrate(process.env.DATABASE_ADMIN_URL))`], { env, stdio: 'inherit' });
execFileSync('npx', ['tsx', 'scripts/seed-demo.ts'], { env, stdio: 'inherit' });
const d = new pg.Client({ connectionString: admin }); await d.connect();
const r = (await d.query(`select content_html from reports where status='issued' order by generated_at desc limit 1`)).rows[0];
await d.end();
const x = new pg.Client({ connectionString: SUPER }); await x.connect(); await x.query(`drop database ${DB} with (force)`); await x.end();
writeFileSync(new URL('../docs/examples/example-report.synthetic.html', import.meta.url), r.content_html);
console.log('written docs/examples/example-report.synthetic.html');
