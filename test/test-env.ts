// Single source of the test database settings, used by vitest.config.ts (for the tests) and by the global setup
// (which rebuilds the schema), so the two can never point at different databases.
export const TEST_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://ohea_app:ohea_app_dev@localhost:5432/ohea_test',
  DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres_dev@localhost:5432/ohea_test',
  STORAGE_DIR: '/tmp/ohea-test-storage/',
  LOGIN_IP_LIMIT: '1000',
};
