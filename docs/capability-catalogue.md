# Implemented capability catalogue

Classification used throughout:

- **Verified** — implemented and covered by automated tests and/or a recorded browser run.
- **Unverified** — implemented and exercised manually or by the demo seed, without a dedicated automated test.
- **Interface only** — a screen or contract exists but no working end-to-end behaviour.
- **Incomplete** — part of the workflow works; a named part is missing.
- **Proposed** — designed, not built.
- **Blocked** — needs an external dependency (see `external-dependency-register.md`).

"Verified" means verified by software tests against synthetic data. **Nothing is verified as professionally suitable** until competent occupational hygiene review (D1).

## B. Authentication, tenancy, permissions

| Capability | Status | Evidence / notes |
|---|---|---|
| Password sign-in (scrypt; comparison inside the database, hashes never returned to the app), sessions (hashed tokens, httpOnly, SameSite) | Verified | http + regression tests |
| TOTP MFA enrolment and challenge; tenant-level enforcement (default on); replay protection; session revoked after 5 wrong codes; account locked after 10 across sessions | Verified | http + review-regressions tests (real TOTP codes) |
| Account lockout (5 failures/15 min) and per-IP throttle | Verified | http: lockout test; throttle triggered during test development |
| Forced change of administrator-issued temporary passwords | Verified | http test |
| CSRF protection on all forms and the sync API | Verified | http test; browser run |
| Security headers (CSP, frame-deny, no-store) | Verified | http test |
| Tenant isolation via forced RLS on all 52 tables; client-scoped sessions read-only at DB level | Verified | isolation + regression tests; catalogue query |
| Consultancy client scoping | Verified | isolation tests (client 1 vs client 2, users, reports, attachments) |
| Restricted identifiable worker data | Verified | workflow: RLS hides names from field technicians |
| Role-based permission matrix and separation-of-duties rules | Verified | workflow + http tests |
| Cross-client link prevention (services + database triggers) | Verified | review-regressions |
| Secrets (password hashes, TOTP seeds) unreadable by the application role | Verified | review-regressions |
| MFA recovery codes / self-service reset | Proposed | Admin can reset MFA |
| Single sign-on (SAML/OIDC) | Proposed | |

## C. Exposure register and monitoring plans

| Capability | Status | Evidence / notes |
|---|---|---|
| Organisation → site → area → process → task → hazard | Verified | workflow test |
| Fact / estimate / reviewed provenance on durations | Unverified | UI and service rules |
| Similar exposure groups with mandatory rationale; membership history | Verified | workflow tests |
| Group review triggers on task, hazard and control changes; review records | Verified | workflow (control change flags group) |
| Monitoring plans with strategy rationale, targets, instruments | Verified | workflow test |
| Plan status workflow with independent review; edits return to draft | Verified | workflow test (transitions); edit-to-draft unverified |
| Monitoring calendar | Unverified | renders plans, actions due, calibration expiry, hazard reviews |

## D. Fieldwork, instruments, laboratory

| Capability | Status | Evidence / notes |
|---|---|---|
| Online sample capture with time zone, interruptions, flows, conditions, deviations | Verified | workflow + http |
| Offline capture, idempotent sync, conflict preservation and resolution | Verified | workflow test + browser run |
| Calibration evidence and on-date validity; expired/failed flagged | Verified | workflow + calc tests |
| QC checks with authorised disposition | Verified | workflow + calc tests |
| Chain of custody: collection, hand-over, dispatch, receipt, analysis, amendment | Verified | workflow test asserts sequence |
| Manual result entry with qualifiers, LOD/LOQ, uncertainty, comments | Verified | workflow (amendment) |
| Result revisions (append-only) | Verified | DB grant/trigger test |
| CSV import: stage → validate → all-or-nothing commit; idempotent retry; source file retained | Verified | workflow test |
| Attachments: content-type sniffing, size limit, SHA-256 integrity, scoped download | Verified | isolation test |
| Live laboratory integration | Blocked | D4 |

## E. Assessments and professional review

| Capability | Status | Evidence / notes |
|---|---|---|
| Deterministic `sample_concentration` and `twa_8h` v1.0.0 | Verified (software) | 30 calc tests; seed results hand-checked |
| Non-detect intervals, coverage assumptions, static/screening exclusion | Verified | calc tests |
| Separate data-quality / benchmark / review states | Verified | calc + UI |
| Inputs snapshot and hash; approval blocked if evidence changed | Verified | workflow test |
| Approval with reviewer, time, scope, limitations; independence | Verified | workflow test |
| Immutable approved revisions; new revision for change | Verified | DB trigger test |
| Staleness notices (evidence changed, newer/withdrawn benchmark) | Verified (evidence), Unverified (benchmark path) | workflow test |
| Before/after comparability | Verified (engine), Unverified (page) | calc test |
| Benchmark versions with second-person verification | Verified (rule), Unverified (UI) | service rule |
| STEL (15-minute) calculation `stel_15` | Verified (software) | calc tests + service test |
| ppm ↔ mg/m³ conversion using recorded molecular weight | Verified (software) | calc tests |
| Statistical compliance testing (e.g. BS EN 689) | Proposed | |
| Real jurisdiction benchmark content | Blocked | D2 |

## F. Controls, actions, verification

| Capability | Status | Evidence / notes |
|---|---|---|
| Control register with purpose, links, owner, performance criteria | Verified | workflow test |
| Inspections/tests; defects auto-raise actions and flag groups | Verified | workflow test |
| Five-milestone action workflow; reopen on ineffective | Verified | event sequence assertion |
| Installation-alone and reassessment closure guards | Verified | workflow test |
| Verification queue and dashboard indicators | Unverified | renders; counts checked in screenshots |

## G. Reporting, offline, integrations

| Capability | Status | Evidence / notes |
|---|---|---|
| Report bound to a specific revision; issued only from approved; drafts watermarked; immutable with hash | Verified | workflow test |
| Client access to issued reports only | Verified | workflow test |
| PDF export | Incomplete | Browser print-to-PDF only; print styles provided |
| Integration contracts, outbox, idempotency, retries | Verified (mock) | workflow test |
| Live integrations | Blocked | D5 |
| AI-assisted extraction/narrative | Interface only / Blocked | Suggestion store + acceptance flow; no provider (D6) |

## Governance and operations

| Capability | Status | Evidence / notes |
|---|---|---|
| Append-only audit of changes, sign-ins, downloads, exports | Verified (append-only); Unverified (completeness of coverage) | DB test |
| Retention configuration; two-person disposal of identities and files | Verified | workflow test |
| Controlled tenant/client-scoped JSON export | Verified | isolation test |
| Backup and restore | Unverified (rehearsal only) | `operations.md` |
| Monitoring | Verified (in-app) | `/readyz`, admin System health panel; external alerting not provided (hosting) |
| CI pipeline with dependency audit | Unverified (not yet run on GitHub) | `.github/workflows/ci.yml`; same commands pass locally |
| Multi-instance login throttle | Verified | http test |
| Demonstration tenant with labelled synthetic data | Verified | seed + screenshots |
| Deployment package (Dockerfile, compose) | Unverified (compose validated; image not built — registry unreachable) | `operations.md` |
| Production entrypoint with config guards and app-role password rotation | Verified | manual run on empty database |
| Pilot tenant provisioning (MFA enforced, forced password change, demo-database guard) | Verified | http tests |
