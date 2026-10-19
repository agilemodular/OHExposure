import pg from 'pg';
import { migrate } from '../scripts/migrate.js';

export default async function () {
  // Same database as the tests (vitest.config.ts sets DATABASE_ADMIN_URL), so a copy pointed elsewhere never wipes ohea_test.
  const url = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres_dev@localhost:5432/ohea_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('drop schema public cascade; create schema public; grant all on schema public to public;');
  await c.end();
  await migrate(url);
}
