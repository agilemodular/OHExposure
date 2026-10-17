# Operations: backup, recovery and monitoring

## Backup

Two stores must be backed up together:

1. **PostgreSQL** — all records, audit trail, report contents and RLS policies.
   - Development rehearsal (performed): `pg_dump -Fc ohea` → `pg_restore` into a new database. Row counts for sampling events, assessment revisions and audit events, and all 60 RLS policies, matched after restore.
   - Production (not yet set up): managed PostgreSQL with point-in-time recovery, daily snapshots retained per the retention policy, and a monthly restore test into an isolated environment.
2. **Attachment store** (`STORAGE_DIR`) — files are named by random id under a per-tenant folder and verified against their SHA-256 on every read. Back up with versioning (e.g. object storage with versioning and object lock). Restore must use the same keys; a missing or altered file is reported as an integrity failure rather than served.

## Recovery

1. Restore the database snapshot to the chosen point in time.
2. Restore the attachment store to the same or a later point.
3. Run `npm run migrate` (idempotent) to confirm schema state.
4. Re-run integration delivery: idempotency keys prevent duplicates downstream.
5. Field devices re-sync automatically; any record created after the restore point that the server no longer knows is recreated from the device queue.

Targets to agree before production: RPO ≤ 24 h (≤ 5 min with PITR), RTO ≤ 8 h.

## Monitoring

Implemented: structured JSON request logs (cookies and authorisation headers redacted); `GET /healthz` (process up); `GET /readyz` (database reachable and migrations applied — use for load-balancer checks); an administrator **System health** panel (locked accounts, users without two-step verification, failed sign-ins, two-step failures in 24 h, failed or dead-lettered integration messages, open sync conflicts, pending disposals); audit events for sign-in, MFA, every change, approval, download, export and disposal; CI (`.github/workflows/ci.yml`) running typecheck, `npm audit --audit-level=high` and the full test suite against PostgreSQL 16. `npm audit` reported 0 vulnerabilities on 17 Oct 2026.

Not implemented (hosting owner to provide): external uptime and error-rate alerting that notifies people; log shipping and retention; database metrics. CI runs on GitHub (`agilemodular/OHExposure`); the first run on 17 Oct 2026 passed typecheck, dependency audit and the full test suite in 42 s. CodeQL (security-extended queries) runs on every push, pull request and weekly; Dependabot proposes npm, GitHub Actions and base-image updates, keeping the Node.js image on its LTS line. CodeQL findings appear in the repository's Security tab (not readable from the development workspace).

## Deployment

Packaging (verified 17 Oct 2026, except where noted):

- `Dockerfile` and `docker-compose.yml` (app + PostgreSQL 16, named volumes for data and attachments, health checks). The compose file validates; **the image could not be built in the development workspace because Docker Hub was not reachable** — build it once in the hosting environment.
- `scripts/start.ts` applies migrations with the owner connection, sets the `ohea_app` password from `APP_DB_PASSWORD`, then starts the server. Tested on an empty database: all 13 migrations applied, the development password stopped working, HTTPS headers were sent.
- In production mode it refuses to start without `COOKIE_SECURE=true` and `APP_DB_PASSWORD`, or with the development password in `DATABASE_URL`.
- `scripts/provision-tenant.ts` creates a real organisation with MFA enforced and a first administrator who must change a one-time password; it refuses to run against a database holding the demo tenant.

## Deployment notes

- Run behind TLS with `COOKIE_SECURE=true` (adds HSTS). Set `TRUST_PROXY` to the number of proxy hops (or proxy addresses); leave it empty when there is no proxy, so `X-Forwarded-For` is ignored.
- `APP_DB_PASSWORD` replaces the development password created by migration 002; keep the owner credentials for migrations only.
- The per-IP login throttle is stored in the database, so it holds across multiple instances. An edge WAF is still recommended.
- No security testing or certification has been carried out.
