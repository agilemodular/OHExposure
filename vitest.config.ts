import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://ohea_app:ohea_app_dev@localhost:5432/ohea_test',
      DATABASE_ADMIN_URL: 'postgres://postgres:postgres_dev@localhost:5432/ohea_test',
      STORAGE_DIR: '/tmp/ohea-test-storage/',
      LOGIN_IP_LIMIT: '1000',
    },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 30000,
  },
});
