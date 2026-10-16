# Occupational Hygiene & Exposure Assurance — by Assurentra

Standalone platform owned by SHEQ Experts Limited that connects workplace exposure measurements, competent assessments, corrective actions and evidence that controls work.

> Understand workplace exposure. Verify controls. Demonstrate protection.

**Readiness:** internal prototype, suitable to take into a controlled pilot once the items in [docs/release-readiness-report.md](docs/release-readiness-report.md) marked *before pilot* are closed. It is **not** production-ready. No real exposure limits are loaded, and the product has not had competent occupational hygiene review.

## Run it locally

Requirements: Node 22+, PostgreSQL 16.

```bash
npm install
export DATABASE_ADMIN_URL=postgres://postgres:<pw>@localhost:5432/ohea   # owner connection: migrations only
export DATABASE_URL=postgres://ohea_app:<pw>@localhost:5432/ohea          # least-privilege app role (no RLS bypass)
npm run migrate          # creates schema, RLS policies and the ohea_app role (change its password in production)
npm run seed             # optional: a clearly labelled DEMONSTRATION tenant with synthetic data
npm start                # http://localhost:3000
npm test                 # unit, workflow, isolation and HTTP tests (uses database ohea_test)
```

Demo users after `npm run seed` (password `demo-password-2026`; demo tenant does not enforce MFA): `admin@`, `practitioner@`, `technician@`, `reviewer@`, `sitemanager@`, `client@demo.test`.

Configuration is by environment variable (`src/config.ts`): `PORT`, `COOKIE_SECURE=true` (required behind HTTPS), `SESSION_HOURS`, `STORAGE_DIR`, `MAX_UPLOAD_BYTES`, `LOGIN_IP_LIMIT`, and branding — `BRAND_PRODUCT_NAME`, `BRAND_ENDORSEMENT`, `BRAND_OWNER`, `BRAND_DOMAIN` — so a permanent name and domain can be introduced without code changes.

## Layout

| Path | Contents |
|---|---|
| `db/migrations/` | Schema, row-level security, append-only and immutability triggers |
| `src/calc/engine.ts` | Deterministic, versioned exposure calculations (no AI) |
| `src/services/` | Business rules, validation, authorisation and audit for each workflow |
| `src/routes/`, `src/ui/` | Server-rendered web UI and JSON APIs |
| `public/field.js`, `public/sw.js` | Offline field-capture client and service worker |
| `scripts/` | Migrations, tenant bootstrap, demonstration seed |
| `test/` | Calculation, workflow, isolation and HTTP tests |
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
10. [Operations: backup, recovery, monitoring](docs/operations.md)
11. [Pilot acceptance checklist](docs/pilot-acceptance-checklist.md)
12. [Release readiness report](docs/release-readiness-report.md)
