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

Implemented: structured JSON request logs (cookies and authorisation headers redacted); `GET /healthz`; audit events for sign-in, MFA, every change, approval, download, export and disposal.

Not implemented (needed for production): uptime and error-rate alerting; log shipping and retention; database metrics; alert on integration dead letters and on repeated failed sign-ins; dependency vulnerability scanning in CI.

## Deployment notes

- Run behind TLS with `COOKIE_SECURE=true` (adds HSTS). Set `trustProxy` appropriately for the load balancer.
- Change the `ohea_app` password created by migration 002 and supply it via `DATABASE_URL`; keep the owner credentials for migrations only.
- The login IP throttle is in-memory per process; use a shared store or the edge (WAF) when running more than one instance.
- No security testing or certification has been carried out.
