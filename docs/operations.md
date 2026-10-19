# Operations: security controls, backup, recovery, monitoring and deployment

Status labels: **Implemented and tested** (automated tests in this repository) · **Verified in development** (run in the development workspace only) · **Hosting owner** (must be provided and evidenced in the hosting environment — pilot gates G5/G6 in `pilot-gate-register.md`).

## Security controls

| Control | Status | Detail |
|---|---|---|
| Login throttling | Implemented and tested | Per-IP limit (`LOGIN_IP_LIMIT`, default 20 per window) stored in the database so it holds across instances; throttled IPs raise `auth.ip_throttled` alerts |
| Account lockout | Implemented and tested | 5 wrong passwords → 15 min lock; 10 wrong two-step codes across sessions → 30 min lock; `auth.account_locked` / `auth.mfa_lockout` alerts. Password comparison happens in the database; the application role cannot read hashes or TOTP secrets |
| Session invalidation | Implemented and tested | Sessions revoked on sign-out, on suspension of the user, on administrator password reset, and on a user's own password change (other sessions). Absolute expiry `SESSION_HOURS` (10 h); **idle expiry `SESSION_IDLE_MINUTES` (default 120 min, added in H1)**. A locked account blocks new sign-ins; it does not end sessions already open |
| MFA | Implemented and tested | TOTP with replay protection; required by default for new organisations; **since H1, a session created before MFA became mandatory loses full access until the user enrols** |
| Secrets | Hosting owner | Required in production: `DATABASE_URL`, `DATABASE_ADMIN_URL` (migrations only), `APP_DB_PASSWORD`, `FIELD_RECOVERY_KEK` (32 bytes, base64), `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`. Store in a secrets manager; never in the image or repository. The server refuses to start in production without `COOKIE_SECURE=true`, `APP_DB_PASSWORD`, `FIELD_RECOVERY_KEK`, or with the development database password |
| TLS and session cookies | Implemented; TLS is hosting owner | Cookies HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=true`; HSTS sent when secure; CSP `default-src 'self'`, `frame-ancestors 'none'`; X-Frame-Options DENY; CSRF token on every state-changing request. Set `TRUST_PROXY` to the proxy hop count |
| Security monitoring and alerting | Implemented and tested (delivery is hosting owner) | `src/alerts.ts` writes every alert to the structured log and, when `ALERT_WEBHOOK_URL` is set, POSTs JSON signed with `x-ohea-signature: sha256=<HMAC>`; 10-minute de-duplication. Events: account locked, MFA lockout, IP throttled, integration dead letter, backup failed/succeeded, restore verification failed, workflow suspended, field recovery imported. The hosting owner routes the webhook to named people and tests it (G5) |
| Health checks | Implemented | `GET /healthz` (process up); `GET /readyz` (database reachable and the latest migration applied) for load balancers. Administrator **System health** panel |
| Database-level pilot gates | Implemented and tested | Migration 018: on approval the database records method status, benchmark provenance and assurance level from the authoritative tables and refuses non-compliant approvals in pilot organisations; an issued report is refused unless its revision is approved (and, in pilot organisations, pilot-approved and its method not since rejected) |
| Field recovery keys | Implemented and tested | `scripts/recovery-keys.ts verify` (run by the release job `scripts/release.ts`; release refused on failure) and `rotate` (re-seals every private key under `FIELD_RECOVERY_KEK_NEW` in one transaction; key pairs unchanged). Rotation procedure: run `rotate`, replace the secret, restart, run `verify`. Rotate at least annually and immediately if the KEK may be exposed |
| Platform operator controls | Implemented and tested | `scripts/platform-controls.ts` (assurance level, offline enablement, workflow suspension/resumption, method review records) uses the owner connection; organisation administrators cannot change these. Every change writes a `platform.*` audit event |
| Penetration test | Not done | Hosting owner / SHEQ Experts decision (G5, D8) |

## Backup

Two stores must be backed up together: PostgreSQL (all records, audit trail, report contents, RLS policies) and the attachment store (`STORAGE_DIR`).

**Script (implemented, verified in development):** `scripts/backup.ts`

```
DATABASE_ADMIN_URL=… STORAGE_DIR=/data/attachments BACKUP_DIR=/backups/ohea BACKUP_RETAIN_DAYS=35 npx tsx scripts/backup.ts
```

Creates `BACKUP_DIR/ohea-<UTC>/` with `db.dump` (pg_dump custom format), `attachments.tar` and `manifest.json` (SHA-256 of both, row counts of key tables, RLS policy count, tables without forced RLS, applied migrations, server and pg_dump versions). Prunes backups older than the retention period **only after** a successful backup. Writes `BACKUP_DIR/last-backup.json` and raises `backup.succeeded` or `backup.failed` (critical).

**Schedule (hosting owner).** Example systemd timer (daily 01:30 UTC):

```
# /etc/systemd/system/ohea-backup.service
[Service]
Type=oneshot
EnvironmentFile=/etc/ohea/backup.env
WorkingDirectory=/opt/ohea
ExecStart=/usr/bin/npx tsx scripts/backup.ts
# /etc/systemd/system/ohea-backup.timer
[Timer]
OnCalendar=*-*-* 01:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

Monitoring must alert if `last-backup.json` is older than 26 hours or `ok` is false (covers the case where the job never runs). The backup location must be encrypted and copied off-site. Managed PostgreSQL point-in-time recovery, where available, is preferred for the database and complements (does not replace) these verified backups.

## Restore verification

**Script (implemented, verified in development):** `scripts/restore-verify.ts <backup dir> [--keep] [--evidence-label "<environment>"]`

Checks manifest checksums **before** restoring; restores into a scratch database and scratch folder; compares row counts with the manifest; confirms RLS policies, forced RLS on every table, applied migrations and the audit trail's append-only trigger; verifies every attachment against its recorded SHA-256; records restore duration and recovery point; writes `restore-verification-<time>.json` next to the backup; drops the scratch database unless `--keep`; raises `restore_verify.failed` on any failure.

**Development evidence (18 Oct 2026, not hosting evidence):** demo database (PostgreSQL 16.15) with one synthetic attachment — 18/18 checks passed, restore in 0.7 s (`docs/examples/restore-verification.development.json`). A deliberately altered archive was refused before restoring ("Backup files do not match their manifest").

**Hosting environment (open, G6):** run monthly and after any change to the backup method, with `--evidence-label "<hosting environment>"`, and record the result against G6. Agree RPO/RTO targets (proposal: RPO ≤ 24 h, ≤ 5 min with PITR; RTO ≤ 8 h) and compare with the measured restore time.

## Recovery (restoring the service)

1. Declare the incident; if records may be affected, suspend workflows (`platform-controls.ts suspend`) so nobody writes to a database that will be replaced.
2. Restore the database to the chosen point, and the attachment store to the same or a later point.
3. Run `restore-verify.ts` against the restored backup (or the equivalent checks against the restored database).
4. Run the release job (`scripts/release.ts`: migrations are idempotent), then start the application.
5. Re-run integration delivery: idempotency keys prevent duplicates downstream.
6. Field devices re-sync: records created after the restore point are recreated from device queues (the server treats them as new; duplicates are recognised by client UUID). Devices whose users cannot sign in can export recovery files.
7. Resume workflows with a revalidation reference.

## Rollback (defective release)

1. Suspend the affected workflows.
2. Redeploy the previous image tag.
3. Database migrations are forward-only. If the defective release applied a migration, **do not** hand-edit the schema: restore the pre-deployment backup (taken by the deployment process immediately before migrating) into a new database, verify it, and repoint the application; or, where the migration is additive and the previous release tolerates it, run the previous release against the current schema after confirming in staging.
4. Record what was rolled back, the data window affected, and revalidation before resuming.

The release job takes this backup automatically before applying pending migrations (`PRE_MIGRATION_BACKUP_DIR`; required in production), and the production compose profile runs it before the application starts.

## Monitoring

Implemented: structured JSON request logs (cookies and authorisation headers redacted); health and readiness endpoints; System health panel (locked accounts, users without two-step verification, failed sign-ins, two-step failures in 24 h, failed/dead-lettered integration messages, open sync conflicts, pending disposals); audit events for sign-in, MFA, every change, approval, download, export, disposal, platform control and recovery import; security alert webhook. CI (`.github/workflows/ci.yml`) runs typecheck, `npm audit --audit-level=high` and the full test suite against PostgreSQL 16; CodeQL and Dependabot are enabled.

Hosting owner to provide: delivery of alerts to people; uptime and error-rate alerting; log shipping and retention; database metrics; backup staleness monitoring.

**Issued-report check (monthly; findings R2-P4 residual and R2-N9).** Every issued report should have a matching `report.issued` audit event written by the application. Run as the owner role; any row returned is investigated as a possible direct write:

```sql
select r.id, r.tenant_id, r.generated_at, r.generated_by
from reports r
where r.status = 'issued'
  and not exists (select 1 from audit_events e where e.action = 'report.issued' and e.entity_type = 'report' and e.entity_id = r.id::text);
```

## Deployment

- `Dockerfile` and `docker-compose.yml` (app + PostgreSQL 16, named volumes, health checks). The image has not been built in the development workspace (Docker Hub unreachable) — build once in the hosting environment.
- **Production (`deploy/docker-compose.prod.yml`):**
  - A one-shot `migrate` job runs `scripts/release.ts` with the owner credentials. It runs the configuration checks, takes the pre-migration backup, applies migrations, sets the app-role password and verifies the recovery keys.
  - The application then starts with **only** the application credentials. The server refuses to start in production if owner credentials are present.
  - The database owner `ohea_owner` is created at first start as a non-superuser with BYPASSRLS (`deploy/db-init`). The cluster superuser is not used by the platform.
- **Single process (development, or the simple `docker-compose.yml`):** `scripts/start.ts` runs the same release steps, removes the owner URL from its environment, then starts the server.
- `scripts/provision-tenant.ts` creates a real organisation (evaluation level, offline capture off, MFA enforced) with a first administrator who must change a one-time password; it refuses to run against a database holding the demo tenant.
- The demo tenant must not be present in the pilot environment.

## Release notes for existing deployments (finding R2-N7)

The production profile assumes fresh volumes. On a database or backup volume created by an earlier version:

1. As the cluster superuser:
   ```sql
   alter role ohea_owner nosuperuser bypassrls createdb createrole;
   grant ohea_app to ohea_owner with admin option;
   ```
   The grant is needed only if `ohea_app` was created by another role.
2. On the host: `docker run --rm -v ohea_backups:/b alpine chown -R 1000:1000 /b`, where 1000 is the `node` user in the image.
3. Remove `DATABASE_ADMIN_URL` from the application's environment; the server refuses to start in production with it present.
4. Pin `postgres` and `caddy` images to digests and record them in the G5 evidence.
