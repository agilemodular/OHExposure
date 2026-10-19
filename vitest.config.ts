import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './test/test-env';

export default defineConfig({
  test: {
    env: TEST_ENV,
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 30000,
  },
});
