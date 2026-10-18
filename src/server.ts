import { buildApp } from './app.js';
import { config } from './config.js';
import { assertRecoveryKeyConfigured } from './services/recovery.js';

// Refuse to start in production without the key that protects field recovery private keys.
assertRecoveryKeyConfigured();

const app = await buildApp();
await app.listen({ port: config.port, host: process.env.HOST ?? '0.0.0.0' });
