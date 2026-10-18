# Test evidence

Latest run: **18 October 2026**, Node 22.22, PostgreSQL 16.15, engine **1.3.1**, commit range `0d8dab4..` (Phase H1). Command: `npm test` (Vitest). The test database schema is dropped and migrated from scratch (16 migrations), and tests run as the least-privilege application role, so row-level security is active throughout. Environment: development workspace (Linux container), not the hosting environment.

**Result: 123 passed, 0 failed, across 5 suites** (baseline before Phase H1: 105 on commit 0d8dab4, re-verified 18 Oct 2026 and green in CI).

| Suite | Tests | Covers |
|---|---|---|
| `calc.test.ts` | 40 | Calculation engine (8-h TWA, 15-min STEL, unit conversion) with hand-calculated expected values; 1.3.1 roll-up (finding H1-F01) |
| `workflow.test.ts` | 22 | End-to-end workflow, tenant/client isolation, attachments, append-only evidence, governance, integrations |
| `http.test.ts` | 13 | Sign-in, TOTP MFA, lockout, CSRF, forced password change, sign-out, proxy trust, headers, every page for every role, provisioning, readiness, shared throttle |
| `review-regressions.test.ts` | 33 | Regression tests for every defect found in the independent review rounds; STEL service flow; tenant controls not writable by the application role |
| `assurance.test.ts` | 15 | **Phase H1:** pilot method gating; reference provenance (synthetic, organisation-entered, professional); method review recording rules; frozen status after approval; workflow suspension of all five workflows with alerts and resumption; MFA on pre-existing sessions; idle timeout; future capture times and device clock offset; reference import validation, immutability and DB constraint; recovery files (permission, cross-organisation, forged and tampered envelopes, idempotency, attribution, alert) |

## Phase H1 targeted evidence

| Evidence | Environment | Result |
|---|---|---|
| `test/browser/field_offline_protection.py` | Desktop Chromium 141 headless, 420 × 900, development server, demo data | 17/17 checks (see `offline-field-capture.md`). **Not mobile-device evidence** |
| `scripts/backup.ts` + `scripts/restore-verify.ts` | Development PostgreSQL 16.15 | 18/18 checks, restore 0.7 s; tampered archive refused. **Not hosting evidence** (`docs/examples/restore-verification.development.json`) |
| Reference import dry run of `docs/examples/reference-data.synthetic.json` | Development | 2 rows valid, 1 substance; nothing written |
| Engine-generated worked examples E1–E14 (validation pack) | Development | Values in `hygienist-review-pack.md` produced by the engine |
| UI check: method review status and provenance on Reference data and assessment pages | Development, desktop Chromium | "Not reviewed" shown for `twa_8h` 1.2.1 and `stel_15` 1.1.1; "Usable for pilot conclusions: No" |
| GitHub Actions CI and CodeQL | GitHub-hosted runners | Green on Phase H1 commits 2bc9a36 and 553dea5 (later commits: see completion report) |

## Independent verification

| Round | Reviewer | Found | Outcome |
|---|---|---|---|
| 1 | Reviewer A (no part in writing the code) | 3 critical, 5 high, 6 medium, 2 low | All fixed with tests |
| 1 re-check | Reviewer A | 3 regressions from the fixes, 4 partial fixes | All fixed with tests |
| 3 | Reviewer B (fresh, no prior context) | 0 critical, 5 high, 4 medium, 3 low | All fixed with tests |
| 3 re-check | Reviewer B | 10 of 12 fixed; 1 hardening gap (self-service functions not bound to tenant); 1 low item that was an error in the reviewer's reference value | Gap fixed with tests; reference value corrected (molar volume is 24.0551 L/mol) |

Reviewer B independently hand-checked six calculation cases (full and partial 8-h TWA, STEL short and long samples, non-detect, overlapping interruptions); all matched.

## Other evidence

| Evidence | Result |
|---|---|
| GitHub Actions CI (PostgreSQL 16 service, clean runner) | Run 39062015665 passed: typecheck, `npm audit --audit-level=high`, full test suite |
| Headless Chromium 141 run of the offline field client | Shell loaded from cache offline; record saved offline; synchronised on reconnect; re-sent record returned *duplicate*; sync without CSRF header refused |
| Page screenshots (overview, assessment, sample, register, action, reference, issued report) | Reviewed for layout, synthetic-data labelling and separate assessment states |
| RLS coverage query | All application tables have row-level security enabled and forced |
| Backup rehearsal (`pg_dump` → `pg_restore`) | Record counts and RLS policies identical after restore |
| Demo seed through the service layer | All steps complete; TWA values hand-checked |

## Not tested

Physical mobile devices; Safari/Firefox; load and concurrency; penetration testing; email (not built); live integrations (not built); attachment-store restore in a hosted environment.

## Full test list

- ✓ `http.test.ts` › authentication › rejects unauthenticated access and redirects to sign-in
- ✓ `http.test.ts` › authentication › requires MFA enrolment where the tenant mandates it, using standard TOTP
- ✓ `http.test.ts` › authentication › locks an account after repeated failures without revealing whether it exists
- ✓ `http.test.ts` › authentication › enforces CSRF tokens on form posts and the sync API
- ✓ `http.test.ts` › authentication › revokes the session on sign-out
- ✓ `http.test.ts` › authentication › forces a password change after sign-in with an administrator-issued temporary password
- ✓ `http.test.ts` › authentication › ignores X-Forwarded-For unless a trusted proxy is configured
- ✓ `http.test.ts` › authentication › reports readiness and throttles sign-in attempts through the shared database store
- ✓ `http.test.ts` › authentication › sets security headers
- ✓ `http.test.ts` › authorisation over HTTP › blocks pages and actions outside a role, and other tenants’ records
- ✓ `http.test.ts` › authorisation over HTTP › every main page renders for each role without server errors
- ✓ `http.test.ts` › pilot tenant provisioning › creates an MFA-enforced organisation whose first admin must change the one-time password
- ✓ `http.test.ts` › pilot tenant provisioning › refuses to provision into a database that holds a demonstration tenant
- ✓ `review-regressions.test.ts` › C1 cross-client evidence mixing › rejects tagging a sample with another client’s exposure group
- ✓ `review-regressions.test.ts` › C1 cross-client evidence mixing › rejects a plan target pointing at another client’s group
- ✓ `review-regressions.test.ts` › C1 cross-client evidence mixing › database refuses a mismatched group even if the service is bypassed
- ✓ `review-regressions.test.ts` › C2 void samples › excludes a voided sample from calculation and data quality
- ✓ `review-regressions.test.ts` › C3 client read-only users cannot write › blocks action evidence by a client user and client users as owners
- ✓ `review-regressions.test.ts` › C3 client read-only users cannot write › the database rejects writes from a client-scoped session
- ✓ `review-regressions.test.ts` › H1/H3 credential self-service and MFA hardening › a client user can change their own password but not their role
- ✓ `review-regressions.test.ts` › H1/H3 credential self-service and MFA hardening › rejects a replayed TOTP code and revokes the session after five wrong codes
- ✓ `review-regressions.test.ts` › H2 import batches are client-scoped › another client cannot read import rows
- ✓ `review-regressions.test.ts` › H4 exposure period cannot silently drop unsampled time › flags an exposure period shorter than the register duration
- ✓ `review-regressions.test.ts` › H5 defect actions and control status › blocks returning a defective control to service while its defect action is open, and restricts cancellation
- ✓ `review-regressions.test.ts` › M1/M2/M3 calculation fixes › keeps a night shift crossing midnight together
- ✓ `review-regressions.test.ts` › M1/M2/M3 calculation fixes › merges overlapping interruptions
- ✓ `review-regressions.test.ts` › M1/M2/M3 calculation fixes › a high excluded or indicative result blocks a favourable roll-up
- ✓ `review-regressions.test.ts` › second-round review fixes › keeps a same-day split shift together (no under-estimate)
- ✓ `review-regressions.test.ts` › second-round review fixes › treats a group with no recorded register duration as incomplete
- ✓ `review-regressions.test.ts` › second-round review fixes › a reviewer (not the creator) can cancel a defect action
- ✓ `review-regressions.test.ts` › second-round review fixes › client-scoped sessions cannot change tenant settings or reference data
- ✓ `review-regressions.test.ts` › second-round review fixes › MFA failures count against the account across sessions
- ✓ `review-regressions.test.ts` › STEL through the assessment service › calculates a 15-minute assessment and freezes the calculation code in the revision
- ✓ `review-regressions.test.ts` › residual gap fixes › the application role never receives password hashes
- ✓ `review-regressions.test.ts` › residual gap fixes › link tables follow their parent record’s client scoping
- ✓ `review-regressions.test.ts` › residual gap fixes › emits action and required-control messages to enabled links (mock only)
- ✓ `review-regressions.test.ts` › third-round review fixes › H1: a session opened before an MFA lock cannot complete MFA
- ✓ `review-regressions.test.ts` › third-round review fixes › H2: client sessions cannot delete link rows
- ✓ `review-regressions.test.ts` › third-round review fixes › H3/L2: the application role cannot call account bookkeeping or read secrets
- ✓ `review-regressions.test.ts` › third-round review fixes › H4: a result without valid calibration evidence is indicative only
- ✓ `review-regressions.test.ts` › third-round review fixes › H5: an indicative result in an unconvertible unit blocks a favourable roll-up
- ✓ `review-regressions.test.ts` › third-round review fixes › M1: evidence from another client cannot close an action
- ✓ `review-regressions.test.ts` › third-round review fixes › M2: a field technician cannot void an analysed sample
- ✓ `review-regressions.test.ts` › third-round review fixes › M3: a STEL result needs a continuous 15-minute window
- ✓ `review-regressions.test.ts` › third-round re-verification follow-ups › self-service functions refuse a user id from another tenant
- ✓ `review-regressions.test.ts` › third-round re-verification follow-ups › lab import resolves a tenant’s own substance before a platform substance of the same name
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › builds the register: site → area → process → task → hazard → group → worker
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › restricts identifiable worker data to authorised roles (RLS)
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › records instruments with calibration evidence
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › runs a plan through independent review and scheduling
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › captures field samples offline with idempotent sync and conflict preservation
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › warns visibly when an expired instrument is used
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › dispatches samples with chain of custody and imports lab results all-or-nothing
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › calculates, reviews and approves an assessment with separation of duties
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › keeps approved revisions immutable at the database level
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › flags staleness after a lab amendment without changing the approved conclusion
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › blocks approval if evidence changes between calculation and approval
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › issues reports only from approved revisions and watermarks drafts
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › requires verification evidence before closing a control action
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › a defective inspection raises a tracked action automatically
- ✓ `workflow.test.ts` › end-to-end vertical workflow (Client One) › preserves historical group association when membership ends
- ✓ `workflow.test.ts` › tenant and client isolation › another tenant cannot read or reference records
- ✓ `workflow.test.ts` › tenant and client isolation › a raw query without tenant context returns nothing
- ✓ `workflow.test.ts` › tenant and client isolation › client read-only users see only their own client
- ✓ `workflow.test.ts` › tenant and client isolation › attachments are tenant-scoped, type-checked and integrity-verified
- ✓ `workflow.test.ts` › tenant and client isolation › evidence tables are append-only for the application role
- ✓ `workflow.test.ts` › governance and integrations › disposal requires a second person and keeps pseudonymous history
- ✓ `workflow.test.ts` › governance and integrations › integration messages are mock-only, idempotent and never claim delivery
- ✓ `calc.test.ts` › sample_concentration v1 › computes mg/m3 from mass, mean flow and sampled duration
- ✓ `calc.test.ts` › sample_concentration v1 › subtracts interruptions from sampled time
- ✓ `calc.test.ts` › sample_concentration v1 › never replaces a non-detect with zero: carries an interval to the LOD
- ✓ `calc.test.ts` › sample_concentration v1 › a non-detect without any limit is incomplete, not zero
- ✓ `calc.test.ts` › sample_concentration v1 › treats over-range as unbounded above
- ✓ `calc.test.ts` › sample_concentration v1 › missing flow or duration makes the sample incomplete
- ✓ `calc.test.ts` › sample_concentration v1 › flags flow drift beyond the method tolerance, and missing tolerance
- ✓ `calc.test.ts` › sample_concentration v1 › excludes a sample with an unresolved failed QC check and keeps the failure visible
- ✓ `calc.test.ts` › sample_concentration v1 › includes but qualifies a failed QC check accepted with justification
- ✓ `calc.test.ts` › sample_concentration v1 › labels screening-only instruments as indicative
- ✓ `calc.test.ts` › sample_concentration v1 › flags missing calibration evidence
- ✓ `calc.test.ts` › sample_concentration v1 › rejects a result unit that contradicts the method basis
- ✓ `calc.test.ts` › sample_concentration v1 › converts direct concentration results in ug/m3 to mg/m3
- ✓ `calc.test.ts` › twa_8h v1 › computes Σ(C·T)/480 for consecutive samples
- ✓ `calc.test.ts` › twa_8h v1 › produces no TWA when unsampled exposure has no documented assumption
- ✓ `calc.test.ts` › twa_8h v1 › requires a justification for any unsampled-period assumption
- ✓ `calc.test.ts` › twa_8h v1 › applies zero-exposure and same-as-sampled assumptions when justified
- ✓ `calc.test.ts` › twa_8h v1 › uses actual exposure time over 8 h against the 480 min reference
- ✓ `calc.test.ts` › twa_8h v1 › requires an exposure period
- ✓ `calc.test.ts` › twa_8h v1 › ignores static samples
- ✓ `calc.test.ts` › benchmark comparison › classifies intervals relative to the benchmark
- ✓ `calc.test.ts` › assessment roll-up › does not compare with an unverified benchmark
- ✓ `calc.test.ts` › assessment roll-up › never yields a safe/compliant verdict field
- ✓ `calc.test.ts` › assessment roll-up › treats static-only evidence as not comparable
- ✓ `calc.test.ts` › assessment roll-up › treats screening-only evidence as not formally comparable
- ✓ `calc.test.ts` › assessment roll-up › reports failed data quality when every sample is excluded
- ✓ `calc.test.ts` › assessment roll-up › downgrades below-benchmark to indeterminate when some worker-shifts are incomplete
- ✓ `calc.test.ts` › assessment roll-up › rejects a benchmark with a non-matching averaging period
- ✓ `calc.test.ts` › assessment roll-up › is deterministic
- ✓ `calc.test.ts` › before/after comparability › surfaces differences that affect comparability
- ✓ `calc.test.ts` › stel_15 v1 › uses a 15-minute sample directly (60 µg / 30 L = 2 mg/m³)
- ✓ `calc.test.ts` › stel_15 v1 › rejects a sample longer than 15 minutes
- ✓ `calc.test.ts` › stel_15 v1 › needs a justified assumption for a short sample, then averages over 15 min
- ✓ `calc.test.ts` › stel_15 v1 › compares only with a 15-minute benchmark
- ✓ `calc.test.ts` › ppm ↔ mg/m³ conversion › uses the molar volume at 20 °C and 101.325 kPa
- ✓ `calc.test.ts` › ppm ↔ mg/m³ conversion › refuses to convert without a molecular weight, or for fibres
- ✓ `calc.test.ts` › ppm ↔ mg/m³ conversion › compares a ppm result with a mg/m³ benchmark only when molecular weight is known
