# Product scope and architecture

## Project review (phase A)

The workspace contained no existing repository, application, database, authentication, infrastructure or integrations for this product. It was established as a new project. No code from other Assurentra products (IntegraRisk, WorkAssura, Foresensa, SentriSafe/SentriAssure, FireSafe/FireSafe Assure) was available to inspect, so none was reused or modified; integration is defined only as versioned contracts (see `integration-contracts.md`).

## Scope

**Owned by this product (first release):** occupational exposure register; similar exposure groups; monitoring and sampling plans; field measurement records (online and offline); instruments and calibration evidence; laboratory submissions, chain of custody and results; specialist exposure assessments with professional review; exposure-control records; corrective actions with effectiveness verification; reviewed reports; audit, retention and disposal.

**Agents covered:** airborne contaminants (dust, fume, mist, vapour, gas, fibre, aerosol) assessed by personal sampling against an 8-hour reference period.

**Out of scope:** clinical diagnosis, medical fitness decisions, occupational health case management; noise, vibration and thermal exposure (see extension points); authorising hazardous work or replacing emergency procedures.

**Independence:** the product runs with no other Assurentra product present. All integrations are optional and disabled by default.

## Architecture

```
 Browser (server-rendered pages)        Field device (offline client)
        │  forms + CSRF token                │  IndexedDB queue → POST /api/sync
        ▼                                    ▼
 ┌─────────────────────── Fastify application (Node 22, TypeScript) ───────────────────────┐
 │ routes/  auth · pages · JSON API · attachment and report streaming · security headers    │
 │ services/ validation (zod) · permission checks · workflow state rules · audit events     │
 │ calc/    deterministic, versioned calculations (pure functions, no I/O, no AI)            │
 └──────────────────────────────┬──────────────────────────────────────────────────────────┘
                                │ role ohea_app (NOBYPASSRLS); per-transaction:
                                │ app.tenant_id · app.client_id · app.pii · app.user_id
                                ▼
 PostgreSQL 16 — row-level security forced on every table; append-only and immutability
 triggers; SECURITY DEFINER functions only for pre-tenant login/session lookup
                                │
 Local file store (attachments) — content-sniffed, SHA-256 verified on every read
```

### Key decisions

| Decision | Reason |
|---|---|
| Tenant isolation in the database (RLS) as well as in code | A missed `WHERE tenant_id` in application code cannot leak data; a raw query with no tenant context returns nothing (tested). |
| Consultancy clients as a second RLS dimension (`app.client_id`) | Client read-only users see only their client's records through every path, including exports and attachments. |
| Identifiable worker data in a separate table guarded by `app.pii` | Pseudonymous references are used everywhere; names are visible only to roles with `worker.identity.read`. |
| Approved revisions immutable by trigger | A material change requires a new revision and fresh review; history cannot be rewritten even by a code defect. |
| Calculations as pure, versioned functions | Reproducible and testable; each approved revision records calculation code, version and an inputs hash. |
| Server-rendered UI, no front-end framework | Smaller attack surface, strict CSP (`script-src 'self'`), works on low-end site devices. Only the field client uses JavaScript. |
| No AI in any authoritative path | AI is an optional, labelled suggestion layer; this release ships with it disabled. |

### Extension points for other exposure disciplines (proposed, not implemented)

Noise, vibration and thermal exposure use different metrics (e.g. daily personal noise exposure, A(8) vibration magnitude, heat-stress indices), measurement chains and benchmarks. They must not reuse the chemical TWA engine. The intended extension path:

- a new `calc_code` in the calculation registry (`CALCULATIONS` in `src/calc/engine.ts`) with its own input schema and tests;
- discipline-specific measurement tables (e.g. sound-level meter records) rather than overloading `lab_results`;
- a hazard *agent class* on `hazards` (currently chemical forms only) to route assessments to the right engine;
- benchmark types and units added per discipline, verified per jurisdiction.

The assessment lifecycle, review, revision, report, controls and verification workflows are discipline-neutral and would be reused.
