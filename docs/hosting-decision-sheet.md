# Hosting decision sheet

**Gates:** G5 (hosting and operational security) and G6 (backup and restoration).
**Status:** **No hosting environment has been selected or provisioned.** This sheet sets out the decisions needed. The deployable configuration in `deploy/` is ready. No prices are quoted here; costs must be obtained from the chosen provider.

## 1. Decisions required

| # | Decision | Options | Owner | Unblocks |
|---|---|---|---|---|
| D-H1 | Hosting model | **A.** Single UK-region virtual machine running `deploy/docker-compose.prod.yml` (app, PostgreSQL 16, Caddy). Simplest to run for one pilot site. **B.** Managed container service plus managed PostgreSQL 16 with point-in-time recovery (PITR). Less to operate, more parts to set up. | SHEQ Experts director | Everything below |
| D-H2 | Provider and region | *To be confirmed*. UK or EU region recommended for the privacy assessment (G7). | SHEQ Experts + DP adviser | G5, G7 |
| D-H3 | Domain name | *To be confirmed*, e.g. a sub-domain of assurentra.com. Needs DNS access. | SHEQ Experts | TLS |
| D-H4 | Secrets manager | Provider's secrets manager, or an encrypted vault on the host as the minimum for option A | Hosting owner | Secrets |
| D-H5 | Backup location | Separate account or bucket with versioning and encryption, in a different failure domain from the database | Hosting owner | G6 |
| D-H6 | Alert routing | Webhook relay to e-mail, chat or an on-call tool, with named recipients (`support-and-incident-procedure.md` §1) | Pilot lead | G5 |
| D-H7 | Log service and retention | Provider log service, or shipping from the host. Retention to match the PIA decision. | Hosting owner + DP adviser | G5, G7 |
| D-H8 | Uptime monitoring | External check of `/readyz` every minute, plus backup-staleness monitoring (`deploy/systemd/ohea-backup-staleness.sh`) | Hosting owner | G5 |
| D-H9 | **RPO and RTO** | To be **agreed by the owner**. The figures in `operations.md` (RPO ≤ 24 h, or ≤ 5 min with PITR; RTO ≤ 8 h) are proposals only. | SHEQ Experts director with the pilot organisation | G6 |
| D-H10 | Penetration test before the pilot, or a documented decision to pilot without one | — | SHEQ Experts director | G5 |
| D-H11 | Operator access | Named people with owner and host access, their MFA, and the two-person rule for manual SQL | SHEQ Experts | G5 |

## 2. Services needed

| Service | Option A | Option B |
|---|---|---|
| Compute | 1 VM (suggested starting size: 2 vCPU, 4 GB RAM, 40 GB disk; to be confirmed against load) | Container service, 1–2 instances |
| Database | PostgreSQL 16 container with a volume on the VM | Managed PostgreSQL 16 with PITR. The owner role needs `CREATEDB` for restore verification, or use a separate verification instance. |
| Attachment storage | Docker volume on the VM | Persistent volume or object storage (the app writes to a filesystem path) |
| TLS | Caddy with automatic certificates (ports 80 and 443 open) | Provider load balancer with a managed certificate; set `TRUST_PROXY` to its hop count |
| Backups | Systemd timers run the `backup` and `restore-verify` jobs; copy `/backups` off-site | Managed PITR **plus** the same `backup` job, because attachments and checksummed restore checks are not covered by PITR |
| Secrets | Host vault or `.env` with mode 600 (minimum) | Provider secrets manager |
| Logs | Docker json-file with size limits; shipping to be decided | Provider log service |
| E-mail or alert relay | Webhook relay | Webhook relay |

## 3. Costs to confirm (provider quotes; none assumed)

Compute; database (managed or VM disk); storage and backup storage, including retention; data egress; log retention; domain and DNS; uptime monitoring; alert relay; penetration test; operator time for monthly restore verification.

## 4. Access outstanding

- Hosting account
- DNS
- Secrets manager
- Backup location
- Alert relay
- Log service
- A named operator with MFA on each of the above

## 5. Verification checklist for the target environment

Each item records: **done in development** (labelled as development evidence), **prepared** (configuration exists), and the evidence still needed **in the hosting environment**.

| Item | Development evidence | Prepared configuration | Needed in hosting (G5/G6) |
|---|---|---|---|
| TLS and domain | — | Caddyfile with redirect and automatic certificates; app sends HSTS when `COOKIE_SECURE=true` | Certificate issued; SSL Labs grade or equivalent; HTTP redirects to HTTPS |
| Secrets handling | Start-up refuses missing or development secrets (tested) | `.env.production.example`; compose fails when secrets are unset | Secrets in a manager; not in the image or repository; access list |
| Least-privilege roles | `ohea_app` has no RLS bypass; column grants (tested). Migrations, backup and restore verification run as a non-superuser BYPASSRLS owner (verified in development, 19 Oct). | Separate `migrate` job; app receives only application credentials and refuses owner credentials; `deploy/db-init` creates `ohea_owner` | `\du` output recorded; confirm the superuser password is sealed; for managed PostgreSQL, create an equivalent owner role (BYPASSRLS needs the provider's admin role) |
| Login throttling in the actual deployment model | Throttle is stored in the database, so it holds across instances (tested); `TRUST_PROXY=1` behind Caddy | Compose sets `TRUST_PROXY=1` | Confirm client IPs reach the app correctly behind the real proxy or load balancer (a test sign-in from two addresses) |
| MFA and session invalidation | Tested (MFA for existing sessions, idle timeout, suspension revokes sessions) | — | Spot check in the hosting environment |
| Security-alert routing | Alerts emitted and signed (tested) | `ALERT_WEBHOOK_URL` and `SECRET` required by the production compose | A test alert reaches the named people |
| Monitoring and log retention | `/healthz`, `/readyz` | Log size limits; staleness script | External uptime check configured; log retention set |
| Scheduled backups and failure alerts | Backup script and alert tested in development | Systemd timers and `backup` job | First scheduled backup; a forced failure raises an alert |
| Restoration | 18/18 checks in development (`docs/examples/restore-verification.development.json`), **development evidence only** | `restore-verify` job, monthly timer | Restore of a hosting backup with `--evidence-label "<environment>"`, measured duration compared with the agreed RTO |
| Deployment rollback | Pre-migration backup taken by the entrypoint before pending migrations (tested on a database one migration behind); refused in production without one | `PRE_MIGRATION_BACKUP_DIR` set in compose | Rehearse: deploy, roll back to the previous image and restore the pre-migration backup into a new database |
| Image build | Not possible in the development workspace (registry unreachable) | Dockerfile with PostgreSQL 16 client tools | Build and record the image digest |
