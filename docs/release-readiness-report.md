# Release readiness report — first release

**Date:** 17 October 2026 · **Scope:** airborne contaminants, phases A–G implemented, phase H (pilot) not started · **Engine:** v1.3.0

## Recommendation

**The evidence supports an internal prototype. It does not yet support a controlled pilot or a production release.**

A controlled pilot becomes appropriate once the *before pilot* items below are closed — chiefly competent occupational hygiene review, verified benchmark content for the pilot substances, hosting with backups, and testing on the actual field devices. None of these can be closed by further software work alone.

## What exists and is verified

All phases A–G were built as working vertical workflows with persistence, authorisation and validation from the start (no interface-only screens for core workflows). Automated evidence: **105 tests across 4 suites, all passing** (calculations, end-to-end workflow and isolation, HTTP/auth, and regression tests for the independent review), plus a headless-browser run of offline capture and a backup/restore rehearsal. See `test-evidence.md` and `capability-catalogue.md`.

Strongest areas:

- **Isolation** is enforced by PostgreSQL row-level security, forced on all 52 tables, with consultancy client scoping and a separate guard for identifiable worker data; client-scoped sessions are read-only at database level.
- **Evidence integrity:** append-only custody, lab revisions, action history, audit and reports; approved assessments immutable by trigger; approval blocked if any input changed after calculation.
- **Safety rules** (23 rules in `safety-rule-register.md`): no automatic verdicts, non-detects as intervals, explicit unsampled-time assumptions, static/screening exclusion, separation of duties, and verification before closure.

## Independent verification

Three review rounds by two independent reviewers who did not write the code, each actively trying to break isolation, safety rules, authentication and calculations:

- **Round 1** found 3 critical, 5 high, 6 medium and 2 low defects (including cross-client evidence mixing, voided samples counted as evidence, and client users able to write). Its re-check found 3 regressions introduced by the fixes and 4 partial fixes.
- **Round 3**, by a fresh reviewer, found no critical defects but 5 high, 4 medium and 3 low (including an MFA lockout bypass from pre-opened sessions, client deletes on link tables, and expired calibration supporting a favourable conclusion). Its re-check confirmed the fixes and found one remaining hardening gap, now closed.

Every finding is fixed and covered by a regression test (102 tests in total). Reviewer hand calculations matched the engine in every case. **No open critical or high findings remain from software review.** This is not a substitute for a penetration test (D8) or professional review (D1).

## Remaining risks

| Risk | Severity | Mitigation / next step |
|---|---|---|
| Methods and outputs not reviewed by a competent occupational hygienist | High | D1 — mandatory before pilot |
| No real benchmark content; tenants must enter and verify limits themselves | High | D2 — decide platform reference-data policy and licensing |
| Offline client tested only in desktop Chromium; data unencrypted on device; revocation waits for reconnection | Medium | D10; managed devices; documented in `offline-field-capture.md` |
| No penetration test or DPIA; no certifications | High for production | D8 |
| No external alerting; backups rehearsed only in development | Medium | D7 — hosting owner to provide alerting and managed backups |
| STEL and unit conversion conventions implemented but not professionally validated; statistical compliance testing not implemented | Medium | D1 review; reviewer addresses representativeness |
| Overlapping samples now flagged, but sampling strategy representativeness is not assessed by software | Medium | Professional interpretation; pilot test P5 |
| AI assistance and live integrations absent | — | Blocked by design until D5/D6; core workflows do not need them |

## Status by delivery phase

| Phase | Status |
|---|---|
| A. Review, architecture, evidence model | Complete |
| B. Authentication, tenant isolation, permissions | Complete, verified |
| C. Exposure register and monitoring plans | Complete, verified |
| D. Fieldwork, instruments, samples, lab results | Complete, verified; live lab integration blocked (D4) |
| E. Calculations and professional review | Complete for 8-h TWA; verified in software, **not professionally validated** |
| F. Controls, actions, verification | Complete, verified |
| G. Reporting, offline sync, integration contracts | Reports and offline sync verified; integrations mock-only; PDF via browser print |
| H. Pilot validation and release assessment | Release assessment done (this report); **pilot not started** (D13) |

## Before pilot (from `pilot-acceptance-checklist.md`)

1. Competent hygienist review and sign-off (D1) — the review pack is ready for them.
2. Verified benchmarks and method parameters for pilot substances (D2, D3).
3. Hosting with TLS, changed credentials, backups and one restore test (D7) — the deployment package and provisioning tool are ready.
4. DPIA and agreed retention periods (D8, D9).
5. Field device testing on pilot hardware (D10) — the test script is ready.

## Next decision

Choose the pilot organisation and substances, and appoint the reviewing hygienist. Those two decisions unblock D1–D3 and D13. Do **not** expand into noise, vibration or thermal exposure until the pilot has validated this scope.
