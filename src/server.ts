import { buildApp } from './app.js';
import { config } from './config.js';
import { assertRecoveryKeyConfigured } from './services/recovery.js';

// Refuse to start in production without the key that protects field recovery private keys.
assertRecoveryKeyConfigured();
if (process.env.NODE_ENV === 'production') {
  if (process.env.COOKIE_SECURE !== 'true') throw new Error('COOKIE_SECURE=true is required in production (serve over HTTPS)');
  if (!process.env.DATABASE_URL || /ohea_app_dev/.test(process.env.DATABASE_URL)) throw new Error('DATABASE_URL must use the application role with its production password');
  if (process.env.DATABASE_ADMIN_URL && process.env.OHEA_ALLOW_ADMIN_URL !== 'true')
    throw new Error('The running server must not hold owner credentials: remove DATABASE_ADMIN_URL (run migrations with scripts/release.ts)');
}

const app = await buildApp();
await app.listen({ port: config.port, host: process.env.HOST ?? '0.0.0.0' });
