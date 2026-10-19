# Phase H2 completion report — technical closure and pilot mobilisation

**Date:** 19 October 2026 · **Repository:** `agilemodular/OHExposure`, `main` · **Phase H2 commits:** `3ddbb3b` → the commit containing this report.
**Classification: Internal prototype — pilot gates remain open.**

## 1. Baseline verified

| Reported (18 Oct release report) | Found in the repository (19 Oct) |
|---|---|
| Engine 1.3.1; `twa_8h` 1.2.1; `stel_15` 1.1.1 | Same |
| 17 migrations | **18**: migration 018 (database-level pilot gates), added after the report in the H1 addendum. Kept. |
| 127 passing tests | **129** passing (H1 addendum tests). Kept. |
| No accepted gates; internal prototype; no pilot authorised | Same |

Work after the report that was preserved: the H1 residual hardening (018, recovery-key verification and KEK rotation, change PIN, attachment gating), the training and support pack, and the merged Dependabot update.

## 2. Build and environment

| Item | Value |
|---|---|
| Node.js / PostgreSQL | 22.22 / 16.15 (development); PostgreSQL 16 in CI |
| Engine | 1.3.1, unchanged in H2 |
| Migrations | 22 (019 H2 controls, 020 review fixes, 021 re-check fixes, 022 final fix) |
| Environment | Development workspace. No hosting environment exists. No field device was tested. |

## 3. Technical findings closed

The authoritative record is `findings-register.md`.

| Group | Closed |
|---|---|
| Phase H1 findings reconciled | R-M3 (attachment severity corrected to Medium, closed); R-L2 and R-L3 closed; R-X2 closed |
| Phase H2 analysis (H2-A1 to A8) | All closed after independent review: suspension races, approval evidence race, offline replay, operator upgrades, method withdrawal and expiry, key replacement, pre-migration backup, blocked-attempt audit |
| Independent review R2 | **2 Critical, 4 High, 8 Medium closed**: approval by insert; self-clearing of flags and quarantine; writer-chosen approval facts; held conflicts; superuser credentials in the app process; backup directory ownership; and M1–M8. Lows fixed except those listed in §4. |
| R2 re-check | N1–N6 and N8 closed. P1 and P2 fixed (tests; not re-reviewed). |

**Behaviour verified for each closed finding:** `test-evidence.md`, "Phase H2 verification list", maps every item in the brief's verification list to the tests that exercise it.

## 4. Findings still open, and their implications

| Finding | Severity | Implication |
|---|---|---|
| H1-F01 | Medium (calculation) | Fixed in software; the hygienist must disposition it before G3 |
| R-M8 | Low (residual) | PIN strength is the main protection for offline data; the controller must accept the residual risk within G8 |
| R-M5, R-M6 | — | Fixed; still to be exercised on real devices (G9) |
| R-L1, R-H2a, R-X1 (mitigated, accepted), R2-N7, R2-N9, R2-H3 residual, image digests | Low | See `findings-register.md` §4. None blocks a pilot by itself; G5 and G8 reviewers should accept or require them. |
| R2-Q1 | Low | Fixed (test); awaiting independent acceptance |

No Critical, High or Medium software finding is open.

## 5. Environment checks completed

| Check | Result | Label |
|---|---|---|
| Release step: pre-migration backup, then migrate, on a database one migration behind | Passed | Development |
| Non-superuser BYPASSRLS owner runs migrations, backup, restore verification and key verification | Passed | Development |
| Production compose profile validates (TLS proxy, migrate job, app without owner credentials, jobs, log limits) | Passed | Development, configuration only |
| Image build | **Not done**: registry unreachable from the workspace | Open (G5) |
| TLS, secrets, alert routing, monitoring, log retention, throttling behind the real proxy, scheduled backups, hosting restore, rollback rehearsal | **Not done**: no hosting environment | Open (G5, G6) |
| RPO and RTO | **Not agreed**: proposals only | Owner decision (D-H9) |
| Device tests | **Not done**: no hardware | Open (G9) |

## 6. External decisions outstanding

See `pilot-decision-pack.md` (P1–P17) and `hosting-decision-sheet.md` (D-H1 to D-H11). The first decisions are:
- the pilot organisation (P1);
- the named hygienist (P6);
- the hosting model and provider (P12 / D-H1).

Everything else follows from these. **Next actions and owners:**

| Action | Owner |
|---|---|
| Choose the pilot organisation and site | SHEQ Experts director |
| Appoint the hygienist and hand over `professional-review-handover.md` | SHEQ Experts director |
| Choose the hosting model and provider; obtain quotes; open the accounts listed in the decision sheet | SHEQ Experts director / hosting owner |
| Appoint the DP adviser for the PIA | SHEQ Experts |
| Name support and incident contacts | Pilot lead |

## 7. Gates

**Accepted:** none.

**Status changes in H2:** none. Evidence references were extended for G3, G4, G5, G6, G7, G8, G10 and G11. Reopening rules and the specified-pilot versus product-readiness distinction were added to the register. See `pilot-gate-register.md`.

## 8. Scope eligible for pilot consideration

**None yet.** When the gates are accepted, the scope is limited to:
- airborne-contaminant personal exposure assessment for one organisation and one site;
- the hygienist-approved calculation versions;
- professional reference benchmarks for the organisation's named substances;
- online-only capture, unless G8 and G9 are accepted for the named devices;
- the verified hosting environment.

## 9. Documents added or updated in H2

**Added:**
- `findings-register.md` (single findings record)
- `suspension-policy.md`
- `approval-and-issue-controls.md`
- `hosting-decision-sheet.md`
- `pilot-decision-pack.md`
- `professional-review-handover.md`
- `docs/templates/reference-data.template.json`
- `docs/examples/validation-examples.json`
- `deploy/` (production profile, database initialisation, timers)

**Updated:**
- `pilot-gate-register.md`
- `capability-catalogue.md`
- `test-evidence.md`
- `offline-field-capture.md` (key management)
- `operations.md` (release job, release notes)
- `privacy-impact-assessment.md` (worker-data flows verified against the code)
- `pilot-user-guides.md` and `training-record.md` (data-quality flags, suspension and escalation, report interpretation)
- `hygienist-review-pack.md`
- `release-readiness-report.md`
- `README.md`

## 9a. Addendum — remaining low findings (19 Oct 2026)

Commit `9199a11` and the R2-Q1 fix closed the low findings software could address. The independent reviewer's acceptance check confirmed R-L4, R-L5, R-L7, R2-M7 residual, R2-P1 and R2-P2 as closed and accepted R-X1 as mitigated. It raised one regression (R2-Q1: non-Latin names compared as equal), which is fixed and tested but not re-reviewed. Tests: 159 passing. No gate status changed. Remaining open items are external or deployment-time (`findings-register.md` §4).

## 10. Pilot authorisation (G11)

| Decision | By | Date | Basis |
|---|---|---|---|
| **No pilot authorised.** The database now refuses pilot level without a recorded authorisation. | — | 19 Oct 2026 | `pilot-gate-register.md` |
