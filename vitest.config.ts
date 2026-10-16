import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://ohea_app:ohea_app_dev@localhost:5432/ohea_test',
      DATABASE_ADMIN_URL: 'postgres://postgres:postgres_dev@localhost:5432/ohea_test',
      STORAGE_DIR: '/tmp/ohea-test-storage/',
    },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 30000,
  },
});
