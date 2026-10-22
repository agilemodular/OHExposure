// Separate configuration for evidence probes (not part of `npm test`): same test environment and global setup.
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../vitest.config.ts';
export default mergeConfig(base, defineConfig({ test: { include: ['verification/**/*.probe.ts'] } }));
