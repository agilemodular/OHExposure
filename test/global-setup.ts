import pg from 'pg';
import { migrate } from '../scripts/migrate.js';
import { TEST_ENV } from './test-env.js';

export default async function () {
  // Same database as the tests (test/test-env.ts), so a copy pointed elsewhere never wipes ohea_test.
  const url = TEST_ENV.DATABASE_ADMIN_URL;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('drop schema public cascade; create schema public; grant all on schema public to public;');
  await c.end();
  await migrate(url);
}
