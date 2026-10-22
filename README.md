# Occupational Hygiene & Exposure Assurance — by Assurentra

Standalone platform owned by SHEQ Experts Limited that connects workplace exposure measurements, competent assessments, corrective actions and evidence that controls work.

> Understand workplace exposure. Verify controls. Demonstrate protection.

**Readiness:** **Internal prototype — pilot gates remain open.** Pilot readiness is tracked in [docs/pilot-gate-register.md](docs/pilot-gate-register.md); no gate is accepted yet. It is **not** production-ready. No real exposure limits are loaded, no calculation method has had competent occupational hygiene review, and the field client has not been tested on actual field devices.

## Run it locally

Requirements: Node 22, PostgreSQL 16 with a **UTF-8** database (`create database ohea template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`). Independent verification from source: [docs/verification-runbook.md](docs/verification-runbook.md).

```bash
npm install
export DATABASE_ADMIN_URL=postgres://postgres:<pw>@localhost:5432/ohea   # owner connection: migrations only
export DATABASE_URL=postgres://ohea_app:<pw>@localhost:5432/ohea          # least-privilege app role (no RLS bypass)
npm run migrate          # creates schema, RLS policies and the ohea_app role (change its password in production)
npm run seed             # optional: a clearly labelled DEMONSTRATION tenant with synthetic data
npm start                # http://localhost:3000
npm test                 # unit, workflow, isolation and HTTP tests (uses database ohea_test)
```

### Deploying a pilot or production environment

```bash
cp .env.example .env            # set strong, different DB_OWNER_PASSWORD and APP_DB_PASSWORD
docker compose up -d --build    # applies migrations, rotates the app role password, starts on :3000
docker compose exec app npx tsx scripts/provision-tenant.ts \
  --name "Pilot Organisation Ltd" --admin-email admin@pilot.example --admin-name "Pilot Admin"
```

Put a TLS-terminating proxy in front and set `TRUST_PROXY=1`. In production a separate release job (`scripts/release.ts`, see `deploy/docker-compose.prod.yml`) applies migrations with the owner credentials and the server runs with application credentials only; together they refuse to start without `COOKIE_SECURE=true`, an `APP_DB_PASSWORD`, a `FIELD_RECOVERY_KEK` (32 random bytes, base64), or if the development password is still in use. New organisations start at *evaluation* level with offline capture off; platform-level controls (pilot level, offline enablement, workflow suspension, method review records, reference data import) are applied with `scripts/platform-controls.ts` and `scripts/import-reference-data.ts`. Backups: `scripts/backup.ts` and `scripts/restore-verify.ts`. The provisioning tool refuses to create a real organisation in a database that contains the demo tenant. See `docs/operations.md`.

Demo users after `npm run seed` (password `demo-password-2026`; demo tenant does not enforce MFA): `admin@`, `practitioner@`, `technician@`, `reviewer@`, `sitemanager@`, `client@demo.test`.

Configuration is by environment variable (`src/config.ts`): `PORT`, `COOKIE_SECURE=true` (required behind HTTPS), `SESSION_HOURS`, `SESSION_IDLE_MINUTES`, `FIELD_RECOVERY_KEK`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`, `STORAGE_DIR`, `MAX_UPLOAD_BYTES`, `LOGIN_IP_LIMIT`, `TRUST_PROXY`, `APP_DB_PASSWORD` (production), and branding — `BRAND_PRODUCT_NAME`, `BRAND_ENDORSEMENT`, `BRAND_OWNER`, `BRAND_DOMAIN` — so a permanent name and domain can be introduced without code changes.

## Layout

| Path | Contents |
|---|---|
| `db/migrations/` | Schema, row-level security, append-only and immutability triggers |
| `src/calc/engine.ts` | Deterministic, versioned exposure calculations (no AI) |
| `src/services/` | Business rules, validation, authorisation and audit for each workflow |
| `src/routes/`, `src/ui/` | Server-rendered web UI and JSON APIs |
| `public/field.js`, `public/sw.js` | Offline field-capture client and service worker |
| `scripts/` | Migrations, tenant bootstrap, demonstration seed, platform controls, reference import, backup and restore verification |
| `test/` | Calculation, workflow, isolation, HTTP and pilot-control tests; `test/browser/` desktop browser checks |
| `docs/` | Release evidence pack (see below) |

## Release evidence pack

1. [Product scope and architecture](docs/product-scope-and-architecture.md)
2. [Data model and permission matrix](docs/data-model-and-permissions.md)
3. [Calculation and benchmark specifications](docs/calculation-and-benchmark-specifications.md)
4. [Safety-rule register](docs/safety-rule-register.md)
5. [Implemented capability catalogue](docs/capability-catalogue.md)
6. [Test evidence](docs/test-evidence.md)
7. [External dependency register](docs/external-dependency-register.md)
8. [Integration contracts](docs/integration-contracts.md)
9. [Offline field capture](docs/offline-field-capture.md)
10. [Operations: security controls, backup, recovery, monitoring](docs/operations.md)
11. [Pilot acceptance checklist](docs/pilot-acceptance-checklist.md)
12. [Release readiness report](docs/release-readiness-report.md)
13. [Professional validation pack](docs/hygienist-review-pack.md)
14. [Field device acceptance tests](docs/field-device-test-script.md)
15. [Pilot gate register](docs/pilot-gate-register.md) — single source of pilot readiness
16. [Pilot protocol and stop conditions](docs/pilot-protocol.md)
17. [Reference data workflow](docs/reference-data-workflow.md)
18. [Privacy impact assessment (draft)](docs/privacy-impact-assessment.md)
19. [Phase H1 completion report](docs/phase-h1-completion-report.md) · [Phase H2 completion report](docs/phase-h2-completion-report.md) · [Post-H2 handover](docs/post-h2-handover.md) · [Online-only pilot configuration](docs/online-only-pilot-configuration.md) · [Synthetic demonstration](docs/examples/demonstration-walkthrough.synthetic.md)
- [Findings register](docs/findings-register.md) — single record of technical findings
- [Suspension policy](docs/suspension-policy.md) · [Approval and issue controls](docs/approval-and-issue-controls.md)
- [Hosting decision sheet](docs/hosting-decision-sheet.md) · [Pilot decision pack](docs/pilot-decision-pack.md) · [Professional review handover](docs/professional-review-handover.md)
20. [Pilot user guides](docs/pilot-user-guides.md)
21. [Training record (template)](docs/training-record.md)
22. [Support and incident procedure (template)](docs/support-and-incident-procedure.md)
