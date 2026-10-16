# Test evidence

Run: 16 October 2026, Node 22.22, PostgreSQL 16, commit after "Second review round". Command: `npm test` (Vitest 5). The test database is dropped, migrated from scratch and exercised as the least-privilege application role, so row-level security is active in every test.

**Result: 80 passed, 0 failed, across 4 suites.**

| Suite | Tests | Covers |
|---|---|---|
| `calc.test.ts` | 30 | Calculation engine with hand-calculated expected values |
| `workflow.test.ts` | 22 | End-to-end workflow (register → plan → offline capture → lab import → assessment → approval → report → controls), tenant/client isolation, attachments, append-only evidence, governance, integrations |
| `http.test.ts` | 9 | Sign-in, TOTP MFA, lockout, CSRF, forced password change, sign-out, headers, role access, every page for every role |
| `review-regressions.test.ts` | 19 | One or more tests for each defect found by the independent review, including second-round fixes |

## Other evidence

| Evidence | Result |
|---|---|
| Headless Chromium 141 run of the offline field client | Shell loaded from service-worker cache while offline; sample saved offline; synchronised on reconnect; re-sent record returned *duplicate*; sync without CSRF header refused (403) |
| Screenshots of overview, assessment workspace, sample, register, action and issued report pages | Reviewed for layout, labelling of synthetic data, and separation of the three assessment states |
| RLS coverage query | 52 of 52 tables have row-level security enabled and forced |
| Backup rehearsal (`pg_dump` → `pg_restore` into a new database) | Record counts and all RLS policies identical after restore |
| Demo seed through the service layer | All workflow steps completed; TWA values hand-checked (e.g. 210 µg over 720 L → 0.2917 mg/m³; × 360/480 → 0.2188 mg/m³) |
| Independent review, two rounds | Round 1: 3 critical, 5 high, 6 medium, 2 low — all fixed. Round 2 (re-verification): 3 regressions and 4 partial fixes — all fixed and covered by tests above. A third verification round has not been run. |

## Not tested

Physical mobile devices; Safari/Firefox; load and concurrency; penetration testing; email delivery (not built); live integrations (not built); restore of the attachment store in a hosted environment.

## Full test list

- ✓ `http.test.ts` › authentication › rejects unauthenticated access and redirects to sign-in
- ✓ `http.test.ts` › authentication › requires MFA enrolment where the tenant mandates it, using standard TOTP
- ✓ `http.test.ts` › authentication › locks an account after repeated failures without revealing whether it exists
- ✓ `http.test.ts` › authentication › enforces CSRF tokens on form posts and the sync API
- ✓ `http.test.ts` › authentication › revokes the session on sign-out
- ✓ `http.test.ts` › authentication › forces a password change after sign-in with an administrator-issued temporary password
- ✓ `http.test.ts` › authentication › sets security headers
- ✓ `http.test.ts` › authorisation over HTTP › blocks pages and actions outside a role, and other tenants’ records
- ✓ `http.test.ts` › authorisation over HTTP › every main page renders for each role without server errors
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
