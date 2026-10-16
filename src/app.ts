import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { join } from 'node:path';
import { config } from './config.js';
import { AppError } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { overviewRoutes } from './routes/overview.js';
import { registerRoutes } from './routes/register.js';
import { planRoutes } from './routes/plans.js';
import { fieldRoutes } from './routes/field.js';
import { labRoutes } from './routes/lab.js';
import { assessmentRoutes } from './routes/assessments.js';
import { controlRoutes } from './routes/controls.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });
  await app.register(fstatic, { root: join(import.meta.dirname, '..', 'public'), prefix: '/static/', maxAge: '1h' });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
    if (!reply.getHeader('Content-Security-Policy'))
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const ct = String(reply.getHeader('content-type') ?? '');
    if (ct.includes('text/html') || ct.includes('json')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // Service worker must be served from root scope for the offline field client.
  app.get('/sw.js', async (_req, reply) => reply.type('application/javascript').header('Service-Worker-Allowed', '/').sendFile('sw.js'));
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());
  app.get('/healthz', async () => ({ ok: true }));

  authRoutes(app);
  overviewRoutes(app);
  registerRoutes(app);
  planRoutes(app);
  fieldRoutes(app);
  labRoutes(app);
  assessmentRoutes(app);
  controlRoutes(app);
  adminRoutes(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if ((err as any).statusCode === 413 || (err as any).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'too_large', message: 'Upload too large' });
    req.log.error(err);
    return reply.code(500).type('text/plain').send('An unexpected error occurred. It has been logged.');
  });
  return app;
}
