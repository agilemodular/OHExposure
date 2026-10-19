// Single-process entrypoint (development and simple deployments): runs the release steps with the owner connection,
// then starts the server. In production use the separate `migrate` job (scripts/release.ts) and start the server with
// only the application credentials (deploy/docker-compose.prod.yml), so the running process never holds owner rights.
import { release } from './release.js';

// The owner URL is taken out of the process environment before anything else runs; only the release step sees it.
const releaseEnv = { ...process.env };
delete process.env.DATABASE_ADMIN_URL;
await release(releaseEnv);
await import('../src/server.js');
