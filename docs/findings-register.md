# Findings register

**This is the single authoritative record of technical findings.** Other documents (completion reports, release-readiness report) summarise it and must not contradict it. A finding is **Closed** only when the remediation is in place, there is verification evidence that exercises the behaviour, and a reviewer has accepted the result. "Documented" is not a closure state.

**Statuses:**
- **Open**: no remediation yet.
- **Mitigated**: partly reduced; residual risk stated.
- **Fixed, awaiting acceptance**: remediation and evidence exist, but no reviewer has re-checked it.
- **Closed**: fixed, verified and re-checked by an independent reviewer.
- **Accepted risk**: a decision-maker has accepted the residual risk. Requires a named person and date.

**Severity:** Critical / High / Medium / Low, as defined in `hygienist-review-pack.md` §8. The "now" severity is the residual severity after remediation.

Reviewer key:
- **R1** — independent software reviewer, Phase H1 (18 Oct 2026; re-check of commit `40693c4`).
- **R2** — independent software reviewer, Phase H2 (19 Oct 2026). Its results are added in §3.
- **R3** — post-H2 targeted reviews (19 Oct 2026, evening): R2-P1/P2 re-review and the online-only configuration. Results in §5.

**Nature of these reviews.** R1–R3 were carried out by separate AI review agents that had no part in writing the code and worked from the repository, the running demonstration server and their own tests. They are independent of the code author in that sense. They are **not** human reviewers and **not** the external security review that G8 and G5 require; their results are software verification evidence only.

## 1. Reconciled from Phase H1

| ID | Finding | Workflow | Original → now | Reason for change | Reproduction (original) | Remediation | Verification evidence | Reviewer acceptance | Pilot / production implication |
|---|---|---|---|---|---|---|---|---|---|
| H1-F01 | Roll-up said *not comparable* instead of *indeterminate* when no formal result could be calculated | Calculation | Medium → none (fixed) | Engine 1.3.1 | Two overlapping samples for one worker → state *not comparable* | `twa_8h` 1.2.1, `stel_15` 1.1.1 | `calc.test.ts` "engine 1.3.1 roll-up" (5); `validation-examples.json` E9 | Software: R1 ✓. **Professional disposition: awaiting reviewer (G3)** | Must be dispositioned by the hygienist before the method is approved |
| R-H1 | Issued reports skipped the pilot gate; older approvals lost the warning | Report issue | High → none | Service gate, then database trigger (018/019) | Issue a pre-H1 approval in a pilot tenant | Service issue gate; exact status comparison; assurance level frozen; `enforce_report_issue` | `assurance.test.ts` report gate (3); `h2.test.ts` direct insert refused | R1 ✓ (service). Database path: R2 (§3) | None once accepted |
| R-H2 | Legacy plaintext store never migrated in online-only mode | Offline | High → Low (residual R-H2a) | Migration added | Device with old `ohea-field` store, offline off | `legacyOnlineOnly` sends and deletes | Browser check (desktop) | R1 ✓ | See R-H2a |
| R-H2a | Legacy records the server rejects stay in the plaintext store and are re-sent on each visit until corrected | Offline | Low | Residual of R-H2 | Legacy record failing validation | None. The store is deleted once nothing in it would be lost. | Code | R1 noted | Pilot devices start with this version; only devices that used earlier builds are affected (demo only so far). **Open (Low).** |
| R-H3 | Online-only records lost silently; stale form token | Offline | High → none | In-page hold, close warning, token refresh for the same user | Session expires with an unsent record | `field.js` | Browser check (unsent warning, resend) | R1 ✓ after re-check fix | None |
| R-M1 | Recovery files forgeable with the public key | Recovery | Medium → none | Per-user, per-version attestation; user must exist | Seal an envelope for another user | HMAC attestation from the private key of each key version | `assurance.test.ts` (spoofed, unknown user), `h2.test.ts` (wrong-version attestation) | R1 ✓ | None |
| R-M1a | Recovery files exported before attestation are refused | Recovery | Low | Residual | Pre-H1 recovery file | None needed; only demo data existed | — | R1 noted | **Closed as not applicable** to pilot devices; recorded for completeness |
| R-M2 | Recovery import skipped `field.capture` | Recovery | Medium → none | Both permissions required; page hidden otherwise | Reviewer imports a file | Permission checks | `assurance.test.ts` | R1 ✓ | None |
| **R-M3** | **Attachment upload not gated by suspension** | Suspension | **Medium** → none | Gated (H1 addendum), then intake quarantine, finalisation re-check and link-time check (H2) | Upload to a sampling event while `field_sync` is suspended | `attachments.ts`; tenant row share-lock | `assurance.test.ts`; `h2.test.ts` (intake, admission, race) | **Closed (R2)** after follow-ups C2/N2 | **Reconciliation.** The H1 completion report rated this Medium. The 18 Oct release report listed it among "low" residual items. **Medium is correct**: an upload during a suspension can alter evidence under investigation. The release report is corrected. |
| R-M4 | Suspended sync marked records *rejected* | Suspension / offline | Medium → none | `deferred`, plus server-side hold (H2) | Sync while suspended | `field.ts` | `h2.test.ts` offline replay | R1 ✓ (deferred); hold: R2 | None |
| R-M5 | Wind-down after offline switched off lost the recovery key | Offline | Medium → Low (unexercised) | Fixed in logic | Switch offline off with unsynchronised records | `field.js` | Code only; **not browser-tested** | R1 ✓ (code) | Exercise in the device tests (F21) before enabling offline. **Fixed, awaiting device evidence.** |
| R-M6 | Unlock could sync under another user's session | Offline | Medium → none | Unlock refuses; token refresh checks the user | Shared browser profile | `field.js` | Code; **not browser-tested** | R1 ✓ | Covered by device test F17 |
| R-M7 | Duplicate conflict rows on re-send | Offline | Medium → none | De-duplicated | Re-import same file | `field.ts` | `assurance.test.ts` recovery re-import | R1 ✓ | None |
| R-M8 | Weak PINs allowed; protection overstated | Offline | Medium → Low | 8+ characters with a non-digit; *Change PIN*; documentation states guessing rates | 6-digit PIN | `field.js`; `offline-field-capture.md` key management | Browser check (change PIN) | R1 ✓ (policy) | PIN strength remains the main defence. **Accepted-risk decision needed by the controller within G8.** |
| R-M9 | Pilot gate did not check averaging period | Approval | Medium → none | Service and trigger | TWA benchmark on STEL calculation | `assurance.ts`; `enforce_pilot_approval` | `assurance.test.ts` | R1 ✓ | None |
| R-L1 | Cached page held personal data after sign-out | Offline | Low → Low (residual) | Sign-in page deletes the cache | Sign out, inspect Cache API | `signed-out.js` | Browser check | R1 ✓ after re-check fix | Residual: not cleared if the user never reaches the sign-in page. **Mitigated.** |
| **R-L2** | No database-level issue gate; recovery key planting by the application role | Approval / report issue / recovery | Low → none | Triggers 018 and 019; key verification at start and first use | Insert an issued report as `ohea_app` | `enforce_report_issue`, `enforce_pilot_approval`, `activeRecoveryKey` | `assurance.test.ts`; `h2.test.ts` (direct writes refused) | **Closed (R2)**: issue path probed (C1/H1 fixed); key-row verification not separately probed | None |
| **R-L3** | No KEK startup check or rotation | Recovery | Low → none | `recovery-keys.ts verify` / `rotate` / `replace`; start check | Wrong KEK only noticed at import | Scripts and start check | `assurance.test.ts` rotation; `h2.test.ts` replacement | **Closed (R2)**: rotation and replacement checked sound | None |
| R-L4 | Alert de-duplication map unbounded; CLI accepted demo level | Operations | Low → Low (residual) | Level validated; map pruned past 5,000 entries | — | `alerts.ts`; `platform-controls.ts` | Code | R1 ✓ | Map now hard-bounded at 5,000 keys (oldest evicted first; refreshed keys move to the end), commit `9199a11`, `h2.test.ts`. **Closed (R2 acceptance check).** |
| **R-L5** | Recovery import is CPU-heavy (synchronous RSA) | Recovery | Low → Low | Capped at 200 records and 5 MB per file | Import a 500-record file | Caps; the import now yields between records and at most two imports run at once (others get *busy*), commit `9199a11` | `h2.test.ts` | **Closed (R2 acceptance check).** A background job remains an option before production. |
| R-L6 | Reviewer could be the importer of reference data | Reference data | Low → Low (residual R-X1) | Name comparison added | — | `import-reference-data.ts` | Code | R1 ✓ | See R-X1 |
| **R-L7** | Handover, interruption and custody times not checked for the future | Field / lab | Low → none | Checked for interruptions, handover, custody, dispatch and receipt | Future custody time accepted | `util.assertNotFuture` | `assurance.test.ts` (custody); `h2.test.ts` (interruption, handover, dispatch, receipt) | **Closed (R2 acceptance check)** | — |
| R-X1 | Separation between reviewer and recording operator is a name comparison only (method reviews, reference imports, pilot authorisations) | Authority | Low | — | Use a different spelling of the same name | Signed documents are hashed and stored (H2), so the evidence can be checked | Names compared after normalisation (case, accents, punctuation, word order; Unicode letters kept); operator OS user and host recorded in the audit event (`scripts/identity.ts`, `9199a11`, regression fix below) | **Mitigated; name-based by design** (confirmed by the R2 acceptance check; risk acceptance proposed in §6, not yet given). The gate reviewer checks the signed document against the record. |
| R-X2 | Calibration evidence was not locked during approval | Approval | Low → none | Found in H2 analysis | Record a calibration while an approval is finalising | Instruments share-locked during approval; calibration writes lock the instrument (R2-M7) | Code | **Closed (R2)** | — |

**The four remaining low findings named in the H1 release report** were R-L2, R-L3, R-L5 and R-L7. The release report's summary grouped three items (attachment upload, database-level issue gate, KEK rotation): it mixed R-M3 (Medium) with R-L2 and R-L3, and left out R-L5 and R-L7. Status now: R-L2, R-L3 and R-L7 are *Fixed, awaiting acceptance*; R-L5 is *Mitigated*.

## 2. Phase H2 analysis findings (before the independent review)

| ID | Finding | Original | Remediation | Verification | Status |
|---|---|---|---|---|---|
| H2-A1 | Suspension check and dependent write were not atomic (race with a suspension being applied) | Medium | Tenant row share-lock in every suspension check; per-item check in offline sync | `h2.test.ts` (suspension waits for a finalising upload) | **Closed (R2)** |
| H2-A2 | Evidence could change between the approval's input check and the approval | Medium | Evidence rows share-locked; writers take update locks | `h2.test.ts` (amendment waits; approval then refused) | **Closed (R2)**, extended to instruments and benchmark (M7) |
| H2-A3 | Offline records arriving after a suspension could enter an assessment unnoticed | Medium | Server-side hold, flag on arrival, review by another person; approval trigger refuses unreviewed held samples | `h2.test.ts` offline replay | **Closed (R2)** after H2, M1–M3, N1, N3 |
| H2-A4 | An operator could satisfy the pilot gate with a bare status change | High | Pilot level requires a recorded G11 authorisation (trigger, also binding on the owner connection) plus an approved method and reference data; approvals need scope and a hashed signed document | `assurance.test.ts`; `h2.test.ts` | **Closed (R2)**; pilot preconditions also in the database (020) |
| H2-A5 | Method approvals had no withdrawal, expiry or scope | Medium | `withdrawn`/`expired` effective status; staleness notice; `method-impact` | `h2.test.ts` | **Closed (R2)** after the ordering fix |
| H2-A6 | Recovery key pair could not be replaced | Medium | Versioned keys; `replace`; device re-seal | `h2.test.ts`; browser check | **Closed (R2)**; revocation and separate attestation secrets added (M6) |
| H2-A7 | No rollback point before migrations | Medium | Pre-migration backup in the entrypoint, required in production | Release step run against a database one migration behind | **Closed (R2)** in development; hosting rehearsal under G6 |
| H2-A8 | Refused attempts were not audited | Low | `workflow.blocked` / `assessment.blocked` on a separate connection | `h2.test.ts` | **Closed (R2)** after M5 |

## 3. Phase H2 independent review (R2)

R2 reviewed commits `1fce123..2640caf` with rolled-back probes as the application role. It then re-checked the fixes in `599c0b2`, and the re-check fixes in `fff4b79` (§3.3).

### 3.1 Findings from the review

| ID | Finding | Workflow | Original → now | Reproduction | Remediation | Verification evidence | Reviewer acceptance | Pilot / production implication |
|---|---|---|---|---|---|---|---|---|
| R2-C1 | A revision inserted as `approved` skipped every approval rule; the issue trigger trusted its writer-chosen facts | Approval / issue | **Critical** → none | Insert an approved revision as `ohea_app`, then an issued report | Approval trigger on INSERT and UPDATE; new revisions only as drafts with an author | `h2.test.ts` (insert approved / in review refused) | R2 re-check: **Fixed** | — |
| R2-C2 | Application role could clear suspension flags, un-quarantine and self-admit | Suspension | **Critical** → see R2-N1/N2 | Direct updates of `sampling_events` / `attachments` | Triggers `protect_suspension_review`, `protect_attachment`, `refuse_unadmitted_link` | `h2.test.ts` C2 | R2 re-check: partially fixed. Holds and attachment content left open (N1, N2); fixed in 021 | — |
| R2-H1 | Approval trigger trusted writer-supplied reviewer, author and submitter; content editable in review | Approval | High → none | Insert `in_review` with null author, approve | Reviewer and submitter must be the signed-in user; author and submitter taken from the stored row; content frozen once in review | `h2.test.ts`, `assurance.test.ts` | R2 re-check: **Fixed** | — |
| R2-H2 | A held record returning as a conflict entered the record unflagged | Suspension / offline | High → none | Held update synchronised after resumption against a newer version, device copy applied | Hold tracked as `in_conflict`; applying the device copy flags the sample | `h2.test.ts` H2/M3 | Re-check: partially (stuck holds, N3); fixed in 021 | — |
| R2-H3 | Production app process held superuser credentials | Hosting | High → Low (residual: owner role is BYPASSRLS and table owner) | Compose passed `DATABASE_ADMIN_URL` to the app; owner was the cluster superuser | Separate release job; app has application credentials only and refuses owner credentials; non-superuser BYPASSRLS owner | Owner role verified running migrations, backup and restore verification in development; compose validated | R2 re-check: **Fixed** | Existing deployments need the steps in `operations.md` §Release notes (N7) |
| R2-H4 | `/backups` root-owned while image runs as `node` | Hosting | High → none for new volumes | Reasoned from the Dockerfile | Directory created and owned in the image | Not built here (registry unreachable) | Re-check: fixed for new volumes | Verify in hosting (G6); existing volumes per N7 |
| R2-M1 | Hold release and flag in a separate transaction | Offline | Medium → none | Failure between transactions | Same transaction | Code and tests | **Fixed** | — |
| R2-M2 | The submitter of a held record or the original capturer could clear it | Suspension | Medium → none | Practitioner clears own held record | Service and trigger check creator, recovered-from user and hold submitters | `h2.test.ts` M2 | **Fixed** | — |
| R2-M3 | A pending held update did not block approval | Approval | Medium → none | Held update to an existing sample | Service and trigger refuse `held` / `in_conflict` holds | `h2.test.ts` | **Fixed** (led to N3, fixed) | — |
| R2-M4 | Race between placing a hold and approval or issue | Suspension | Medium → none | Concurrent hold and approval | Assessment row share-locked (service and trigger); hold takes an update lock | `h2.test.ts` M4 | **Fixed** | — |
| R2-M5 | Refused-attempt audit could exhaust the connection pool | Operations | Medium → none | 10 concurrent refusals | Dedicated two-connection pool with a timeout | Code | **Fixed** | — |
| R2-M6 | Replaced key versions remained valid indefinitely; attest keys derived from private keys | Recovery | Medium → Low | Compromised old private key | Per-version attestation secret; `replace --revoke-previous` | `h2.test.ts` M6 | **Fixed (opt-in)** | Revocation strands unsynchronised records on devices that cannot reconnect (documented trade-off). Key versions created before migration 020 (demonstration organisation only) keep private-key-derived attestation until replaced; new organisations get separate attestation secrets automatically |
| R2-M7 | Organisation suspension left calibrations and instruments open; approval did not lock them | Suspension / approval | Medium → Low | Record a calibration during suspension | Calibration and instrument status gated; instruments and benchmark share-locked during approval | `h2.test.ts` | **Fixed** | Residual closed: `recordMaintenance` is gated by field-sync suspension and locks the instrument (`9199a11`). **Closed (R2 acceptance check).** |
| R2-M8 | AI suggestion application raced with submission and ignored holds | Assessment | Medium → none | Apply a suggestion during submission | Row lock and hold check | Code | **Fixed** | AI provider disabled anyway |
| R2-L | Lows: method-review ordering in one transaction; view columns; pilot authorisation mutability; NULL suspension helper; integration delivery and holds; expired methods at issue; MAC not covering the version; non-atomic device writes; gzip on authenticated pages; floating image tags; CREATEDB for restore; KEK in backup jobs; weak tests | Various | Low | — | All fixed except image tags (pinned by comment, to digest at deployment) and the name-only check (R-X1) | Tests for ordering and pilot authorisations; code | Re-check: **Fixed** except tags (partial) and R-X1 (mitigated, not fixed; risk acceptance proposed in §6) | Pin image digests in G5 |

### 3.2 Findings from the re-check

| ID | Finding | Original → now | Remediation | Verification | Acceptance |
|---|---|---|---|---|---|
| R2-N1 | `field_intake_holds` freely editable by the application role | High → none | Trigger: fixed content; transitions `held` → `in_conflict` / `synchronised` (only once the sample is flagged) / `dismissed` (reviewed, not the submitter); no deletion | `h2.test.ts` N1/N3 | **Closed (R2)** |
| R2-N2 | Attachment entity, content and storage key changeable | Medium–High → none | All columns immutable except admission, disposal and PII marker | `h2.test.ts` N2 | **Closed (R2)** |
| R2-N3 | A hold could block a sample permanently | Medium → none | `in_conflict` on repeated conflicts; *keep server copy* dismisses; reviewed *Dismiss* action | `h2.test.ts` N1/N3 | **Closed (R2)** |
| R2-N4 | Calibrations updatable by the application role | Low → none | UPDATE revoked | `h2.test.ts` N4 | **Closed (R2)** |
| R2-N5 | Writer could backdate `approved_at`; `in_review` → `withdrawn` accepted | Low → none | Approval time set by the database; transitions fixed | `h2.test.ts` N5 | **Closed (R2)** |
| R2-N6 | Suspension state of other organisations readable | Low → none | Other organisations read as suspended | `h2.test.ts` N6 | **Closed (R2)** |
| R2-N7 | Fresh-volume assumptions (owner role, `/backups` ownership) | Low | Release notes for existing deployments (`operations.md`) | Documentation | **Open (Low)** until applied on a real deployment |
| R2-N8 | Development entrypoint removed the owner URL late | Low → none | Removed before the release step runs | Code | **Closed (R2)** |
| R2-N9 | Direct approval through the application credentials does not verify the inputs hash or snapshot hash (service-only checks) | Low (found while writing N5 test) | None. The boundary is documented in `approval-and-issue-controls.md` §3. Direct writes must still satisfy every trigger rule, and the signed-in user must be an eligible reviewer. | `h2.test.ts` N5 shows a rule-compliant direct approval succeeds | **Open (Low)**, documented boundary |

### 3.3 Final re-check of 021 (R2, commit `fff4b79`)

**Re-check result:** N1, N2, N3, N4, N5, N6 and N8 are **Fixed**. Legitimate flows were confirmed working: held sync, keep-server and dismissal by another person, submit and approve, supersede, attachment disposal, new-revision inserts. Admission was not exercised; its logic is unchanged from 020.

Two further items were raised and fixed in migration 022:

| ID | Finding | Remediation | Verification | Acceptance |
|---|---|---|---|---|
| R2-P1 | Practitioner who submitted a held copy could not *keep server copy*: the whole resolution failed with a database error | `resolveConflict` checks first and gives a clear message (someone else must resolve). It also checks field-sync suspension before dismissing. | Code | **Closed (R2 acceptance check)** |
| R2-P2 | An `in_conflict` hold could be repointed to another sample | Any same-status change refused; the sample of a held conflict is immutable | `h2.test.ts` "R2 final re-check" (final-hold case) | **Closed (R2 acceptance check).** |

R2-N1 to N6 and N8 are therefore **Closed (R2)**. R2-C2, R2-H2 and R2-N3 are **Closed (R2)** through their follow-ups.

### 3.4 Acceptance check of the remaining low findings (R2, commit `9199a11`)

The reviewer confirmed R2-P1, R2-P2, R-L4, R-L5, R-L7 and the R2-M7 residual as fixed, confirmed R-X1 as mitigated (name-based by design; risk acceptance is a decision for the owner in §6), and raised one regression:

| ID | Finding | Remediation | Verification | Acceptance |
|---|---|---|---|---|
| R2-Q1 | The new name normalisation removed every non-Latin character, so any two non-Latin names (e.g. two Chinese names) compared as the same person and the separation check refused legitimate records | Unicode letters and digits are kept; if normalisation leaves nothing, the trimmed lower-case names are compared | `h2.test.ts` (`王伟` ≠ `李娜`; `王伟` = ` 王伟 `) | **Closed (R2 re-check)** |
| R2-Q2 | Medium (fails closed). The fix for R2-Q1 removed combining marks from every script, so distinct names in Devanagari, Thai or Japanese kana collided (सुनील = सोनल, मीना = मोना, ジロウ = シロウ). Legitimate reviewers or authorisers could have been refused | Marks are removed only after Latin, Greek, Cyrillic, Arabic and Hebrew letters (optional accents and vowel points) and are kept elsewhere | `h2.test.ts` (Hindi, Thai and Japanese pairs; accented Latin, Greek and Hangul equivalents) | **Closed (R2 re-check)** |
| R2-Q3 | Low: a space inside a CJK name hid a match (`王伟` vs `王 伟`) | Whitespace between Han, kana and Hangul characters is ignored | `h2.test.ts` | **Closed (R2 re-check)** |
| R2-Q4 | Low: an invisible joiner, variation selector or detached mark added to a name hid a match (`王伟` vs `王伟` + U+034F) | Invisible joiners, variation selectors, zero-width characters and marks not attached to a letter are ignored, as the reviewer suggested | `h2.test.ts` (five cases) | **Closed (R3, 22 Oct; see §5.4)** |

## 4. Open findings summary (19 Oct 2026, post-H2; TR rows updated 22 Oct 2026)

Closed since the H2 report: R-L4, R-L5, R-L7, R2-M7 residual, R2-P1, R2-P2, R2-P3, R2-P4, R2-P5, R2-P6, R2-Q1–Q4, OO-R1–OO-R6 (§5.4). Fixed and tested but not re-reviewed: R2-Q5. Treatment of every remaining Low finding is proposed in §6.

| ID | Severity | Status | Proposed treatment (§6) |
|---|---|---|---|
| H1-F01 | Medium (calculation) | Fixed in software; technical disposition updated for engine 1.4.0 (§7); **professional disposition pending** | Not a software decision: appointed hygienist (G2/G3); brief in `professional-review-handover.md` §1.0 |
| TR-01–TR-05, TR-A–D, TR-R | High/Medium (calculation and reporting) | Fixed and tested; TR-01–TR-05 reproduction outputs verified to match by the independent technical re-review of `b5eb070`; the rest awaiting technical re-review (§7) | Re-review of engine 1.4.0; professional judgement on the conventions listed in §7 |
| TR-N1–N3, TR-N5–N8 | High–Low | Fixed and tested; awaiting technical re-review (§7.1) | As above |
| TR-06 (supersedes TR-N4), TR-07; R5-F1–F8 | High (calculation; reachable through the application) | Engine reproductions and fixtures verified by the independent technical re-review of `b5eb070`; R5 fixes awaiting re-review (§7.2, §7.3), engine 1.5.1 | Re-review of the R5 fixes; professional judgement on the duplicate thresholds and conflict rule, and the value-field boundaries |
| TR-08 (with R6-N1–N5, M1–M2) | High (approval safeguards; reproduced end to end) | **Implemented — awaiting technical re-review** (§7.4, §7.5), application 1.1.1 | Re-review of the resolver, locks and trigger |
| R2-Q5 | Low | Partly fixed (tests); remaining edge cases fall under R-X1 | Accept with R-X1 (§6) |
| R-H2a, R-M5, R-M6, R-M8, R-L1, OO-R7 | Low | Open / mitigated (offline capability) | Defer while offline capture is off |
| R-X1 (with R2-Q5) | Low | Mitigated | Accept for the pilot with controls |
| R2-H3 | Low (residual) | Owner role privileged | Accept for the pilot with controls |
| R2-N9 | Low | Documented boundary | Accept for the pilot with controls |
| R2-P3a | Low | Open | Accept |
| R2-P4 residual | Low | Open | Accept for the pilot with controls |
| R2-N7 | Low | Open | Fix before pilot if any existing volume is reused |
| Image tags | Low | Partial | Fix before pilot (pin digests) |

**No Critical or High software finding is open without an implemented fix.** The TR-06 and TR-07 engine reproductions are verified as fixed by the independent technical re-review of `b5eb070`; the R5 fixes (§7.3) and TR-08 (§7.4) are implemented but not yet re-reviewed. H1-F01 is fixed in software and awaits the hygienist's disposition.

## 5. Post-H2 targeted reviews (R3, 19 Oct 2026)

### 5.1 R2-P1 and R2-P2 (targeted re-review)

Fix commit `cb24083` (migration 022 and `src/services/field.ts`). The reviewer reproduced each original failure on `cb24083^` and re-ran it on the fixed code, each against its own database.

| ID | Original defect | Reproduction before the fix | After the fix | Alternative and failure paths checked | Result |
|---|---|---|---|---|---|
| R2-P1 | A practitioner who had submitted a held copy chose *keep server copy*; the database refused the dismissal (submitter cannot dismiss) and the user saw a raw database error | Submitter: `P0001 hold refused: dismissal needs … other than the submitter`; other user during a suspension: `P0001 … field synchronisation is suspended` | Submitter: 403 with a clear message (someone else must resolve); other user during a suspension: 423 *suspended* | No partial state after refusal (hold, sample, conflict unchanged); another practitioner and a technical reviewer can keep the server copy; the submitter can apply the device copy (sample flagged, submitter cannot clear the flag); all suspended-sync paths refused and work after resumption; other organisation 404; field technician 403; an ordinary conflict without a hold is still resolvable by its submitter | **Closed (R3)** |
| R2-P2 | An `in_conflict` hold could be repointed to a different sample (same-status update, or a transition that also changed the sample) | Repoint, set to null and dismiss-while-repointing all succeeded as the application role | All refused | `held` repoint refused; same-status edits of notes, resolution fields, status and payload refused; legitimate transitions work (held→in_conflict, replay of an existing conflict, held→synchronised by replay and directly once flagged, in_conflict→dismissed by another person); submitter dismissal refused; deletes refused | **Closed (R3)** |

### 5.2 New findings from the post-H2 work

| ID | Finding | Severity | Remediation | Verification | Status |
|---|---|---|---|---|---|
| R2-P3 | A hold could be closed (*synchronised*) or put *in conflict* against an unrelated sample, bypassing dismissal rules | Medium | Migration 023: a hold can only be linked to its own sample (the sample it updates, or the sample created from it) | `h2.test.ts` "R2-P2/P3"; reviewer's attack refused | **Closed (R3)** |
| R2-P3a | The hold's client identifier and server id are taken from the submitter and not checked against each other, so a submitter can open a conflict on another sample by mixing them | Low | None: the normal sync call already lets the same user open a conflict on that sample; nothing is gained and nothing is lost silently | Reviewer analysis | Open (Low); proposed *accept* (§6) |
| R2-P4 | A report inserted directly with the application credentials could carry content and a content hash unrelated to each other or to the approved revision (found while building the demonstration) | Medium | Migration 024: the stored hash must match the content; an issued report must state its revision's approval record hash; existing issuer, approval and pilot checks unchanged | `demonstration.test.ts` rows 29–30 of the walkthrough; full suite | **Closed (R3)** |
| R2-P4 residual | An authorised issuer (practitioner or reviewer) writing directly with the application credentials could still store other text that carries the correct approval hash | Low | Application credentials are held only by the application process (privileged-access rules); the service writes a `report.issued` audit event and a re-rendered report would differ | — | Open (Low); proposed *accept with controls* (§6) |
| R2-P5 | The R2-P2 regression test picked any dismissed hold across organisations and could fail by chance; it did not exercise an in-conflict hold | Low (test) | Test restricted to the organisation; new in-conflict test added | `h2.test.ts` | Fixed |
| OO-R1 | Online-only: a connection drop replaced a half-completed form with the record list, losing what had been typed | Medium | The form stays on screen; Save is disabled with a notice while offline | Browser check OO-4 (form kept) | **Closed (R3)** |
| OO-R2 | Online-only: a record held during a suspension said it would become a sample once accepted, but reviewers can only dismiss holds and the page never resent it | Low | Shown as *Not saved* with an explanation; the user sends again after resumption, when the hold synchronises and the sample is flagged | Code; reviewer's suspension run | **Closed (R3)** |
| OO-R3 | Online-only: the session-expiry message referred to *Sync now*, but the button is *Send again* | Low | Wording | Code | **Closed (R3)** |
| OO-R4 | Online-only: Save was not disabled while sending; two instant submits produced two page rows (the second rejected by the unique sample code) | Low | One submission at a time | Browser check OO-6 (double submission) | **Closed (R3)** |
| OO-R5 | `offline-field-capture.md` online-only row out of date | Low (documentation) | Updated | — | **Closed (R3)** |
| OO-R6 | The test database setup ignored the configured database and could wipe `ohea_test` from a copy pointed elsewhere | Low (test) | Shared settings module `test/test-env.ts` | Full suite | Fixed after re-check (see §5.3); not re-reviewed |
| OO-R7 | A device winding down an earlier offline store keeps its page-shell cache until the next page load | Low | None needed for pilot devices that never had offline on | Reviewer | Open (Low); proposed *defer* (§6) |

### 5.3 Re-check of the fixes in `3ac4474` and migration 024

Reviewer re-check (R3) against `3ac4474` and migration 024:

| Item | Re-check result |
|---|---|
| OO-R1 form kept on connection loss | **Closed (R3)**: form survives offline with Save disabled and the notice; on reconnection nothing is sent |
| OO-R2 suspension shown as *Not saved* | **Closed (R3)**: during the suspension a resend leaves one hold; after resumption the sample is created, the hold synchronises and the sample is flagged |
| OO-R3 wording | **Closed (R3)** |
| OO-R4 single submission | **Closed (R3)**: double-click and simultaneous submits give one record and one row |
| OO-R5 documentation | **Closed (R3)** |
| OO-R6 test database | **Not closed**: the configured environment did not reach the global setup. Fixed afterwards: one shared settings module (`test/test-env.ts`) is used by both; full suite passes. Not re-reviewed |
| R2-P4 (migration 024) | **Closed (R3)**: wrong or upper-case hash, and content without the approval record hash, refused; client insert refused by row security; normal issue works. The stated residual was confirmed (approval hash placed in an HTML comment is accepted) |

New from the re-check:

| ID | Finding | Severity | Remediation | Verification | Status |
|---|---|---|---|---|---|
| R2-P6 | Any role (e.g. a field technician) could insert a *draft* report with made-up content directly; drafts only had to match their content hash. Clients cannot read drafts | Low | Migration 025: every report, draft or issued, must be generated by the signed-in user holding a practitioner or technical reviewer role | `h2.test.ts` (technician draft insert refused) | Fixed (test); not re-reviewed |
| OO-R7 | (confirmed) shell cache kept during offline wind-down until the next page load | Low | — | Reviewer | Open (Low); proposed *defer* (§6) |

### 5.4 Re-check of the remaining unreviewed fixes (R3, 22 Oct 2026, commits `82ae30b` and `1f24b1a`)

| Item | First re-check (`82ae30b`) | After fix (`1f24b1a`) |
|---|---|---|
| R2-Q4 name check | **Not closed (Medium)**: other default-ignorable characters (soft hyphen, bidi controls, tags, Hangul fillers) and stray marks on Han or Devanagari still made the same name look different; non-decomposing Latin letters (Ł, ø, đ, ß) did not match plain spellings (Low) | **Closed (R3)**: all default-ignorable characters stripped; meaningless inherited marks removed (kana voicing kept); non-decomposing Latin letters folded; distinct names in Devanagari, Thai, kana, CJK and Hangul stay distinct |
| R2-P5 test | Partly closed: a hold staying *held* could have been repointed without any test failing (the database already refused it with another message; the gap was test coverage) | **Closed (R3)**: test asserts the refusal; removing the protection makes it fail |
| R2-P6 draft-report generator | **Closed (R3)**: technician, action owner, client and organisation administrator inserts refused, as is a practitioner naming another user, null or another tenant's user; normal generation works | — |
| OO-R6 test settings | **Closed (R3)**: a run pointed at another database left `ohea_test` unchanged | — |

New from the second re-check:

| ID | Finding | Severity | Remediation | Status |
|---|---|---|---|---|
| R2-Q5 | Remaining name-check edge cases: a spacing dakuten (゛) was dropped (カ゛ロウ read as カロウ); a separate voicing mark after a non-kana letter, a mark from another script on a letter, the braille blank, control characters and hair space still made a name look different | Low | Spacing dakuten and handakuten read as the combining marks; control characters and the braille blank removed (tests). Marks from another script and spacing characters that split a word are not handled | Partly fixed; residual falls under R-X1 (name-based by design; the signed documents remain the control) |

## 6. Proposed treatment of the remaining Low findings (for the pilot defined in `pilot-decision-pack.md`)

Basis: an online-only pilot (offline capture off), one organisation and site, airborne-contaminant personal exposure only, fresh managed pilot devices, a fresh hosting deployment, application database credentials held only by the application process. Severity alone did not decide the treatment. **Every row is a proposal**: it takes effect only when the named owner records acceptance (name and date) in the *Accepted* column; until then the finding stays open.

| ID | Finding (short) | Treatment | Justification for this pilot | Owner who accepts | Evidence / conditions | Review trigger | Accepted |
|---|---|---|---|---|---|---|---|
| R-H2a | Legacy plaintext records rejected by the server stay on the device | Defer — capability disabled | Only devices that ran pre-H1 builds hold such a store; pilot devices start from a clean profile. In online-only mode the store is shown for review and sent only on the user's action | Platform owner | Device test O1 shows empty site storage on each pilot device | A device that ran an earlier build is used | |
| R-M5 | Wind-down after offline is switched off not exercised on a device | Defer — capability disabled | Offline is never switched on for the pilot organisation | Platform owner + controller (G8) | Offline stays off (audit shows no `platform.offline_enabled` for the organisation) | Offline enabled for any pilot organisation (reopens G8, G9; run F21) | |
| R-M6 | Unlock could sync under another user's session (fixed; device test outstanding) | Defer — capability disabled | Unlock exists only with offline storage; the online shared-device case is covered by retained F17 and O9 | Platform owner | F17 and O9 pass on pilot devices | Offline enabled | |
| R-M8 | PIN strength is the main protection for offline data | Defer — capability disabled | No PIN-protected store exists in online-only mode | Controller | — | Offline enabled: controller's accepted-risk decision becomes a G8 condition | |
| R-L1 | Cached page shell may persist if the user never reaches the sign-in page | Defer — capability disabled | Online-only mode registers no service worker and removes earlier shell caches (OO-2) | Platform owner | OO-2 on pilot devices (O1) | Offline enabled | |
| OO-R7 | Shell cache kept until next page load on a device winding down offline | Defer — capability disabled | Applies only to devices that had offline on | Platform owner | As R-H2a | As R-H2a | |
| R-X1 (with R2-Q5) | Separation between reviewer and recording operator is a name comparison; residual Unicode edge cases (R2-Q5) | Accept with controls | Names are normalised across scripts; operator OS user and host are recorded; signed documents are hashed and stored, so the gate reviewer can check the signed document against each record | SHEQ Experts director (G11) | Gate reviewer checks each method approval and the pilot authorisation against the signed documents (hash match) before acceptance | Any doubt over who recorded or signed a record; change of platform operators | |
| R2-H3 | Database owner role is privileged (bypasses row security; owns tables) | Accept with controls | Needed for migrations, backups and restores; the running application never holds it | Hosting owner (G5) | Owner credentials only in the secrets manager and the release job; named holders listed; database audit logging enabled (`approval-and-issue-controls.md` §4) | Change of hosting, operators or secret holders | |
| R2-N9 | A direct approval with the application credentials does not re-verify the inputs hash | Accept with controls | Direct writes must still meet every database rule (eligible reviewer, submitter ≠ reviewer, pilot rules, evidence locks); the application credentials are held only by the application process | Platform owner + hosting owner | Privileged-access rules applied; no person holds the application database password | Any person given the application credentials; before production use, add a database check | |
| R2-P3a | Hold identifiers not cross-checked | Accept | No gain over the normal sync call; nothing is lost silently | Platform owner | — | Change to sync or hold logic | |
| R2-P4 residual | An authorised issuer writing directly could store other text that carries the approval hash | Accept with controls | Same credential control as R2-N9; issue through the service writes a `report.issued` audit event and a re-rendered report would differ | Platform owner + hosting owner | Monthly check that every issued report has a matching `report.issued` audit event (`operations.md` §Monitoring) | As R2-N9 | |
| R2-N7 | Existing deployments need role and volume changes | Fix before pilot (if applicable) | Not applicable to a fresh deployment; required if any earlier volume is reused | Hosting owner (G5) | Deployment record states fresh volumes, or the release-note steps were applied | Reuse of volumes | |
| Image tags | Base images not pinned to digests | Fix before pilot | Pinning is a deployment step that removes the risk outright | Hosting owner (G5) | Digests recorded in the G5 evidence | Any image update | |

## 7. AI-assisted technical review of commit `ceec79f` (TR, 22 Oct 2026)

Source: an AI-assisted technical review of the evidence package `OHEA-technical-review-evidence-ceec79f.zip`. It is not an external professional validation. Each finding was reproduced on the 1.3.1 engine before any change (`docs/remediation/tr-reproductions.before-1.3.1.json`). Inputs are unchanged in the regression fixtures. Version change record and before/after outputs: `docs/remediation/remediation-summary.md`.

| ID | Affected versions | Reproduction inputs | Observed output (1.3.1) | Expected safety property | Root cause | Correction (1.4.0) | Regression evidence | Professional-review dependency | Status |
|---|---|---|---|---|---|---|---|---|---|
| TR-01 | `stel_15` 1.1.1, engine 1.3.1 | 31.2 µg over 16 min at 2 L/min (0.975 mg/m³); 15-min benchmark 1 mg/m³ | complete / below benchmark | An average over more than 15 min must not establish a favourable 15-minute result | 14–16 min accepted as 15 min (unconditional ±1 min); zero remainder accepted on a justification alone | Exact 15 min uninterrupted only; > 15 min no result; interrupted windows explicit; shorter samples need justification and supporting evidence, marked assumption-dependent; sampling tolerance 0 as a versioned convention; numerical timestamp tolerance (0.1 s) separate | Fixtures TR-01, TR-01a–f, E7, E7b, E7b-evidence; `calc.test.ts` short-sample test | Zero-remainder convention and any non-zero sampling tolerance (EH40 gives no method) | Fixed and tested; awaiting technical re-review |
| TR-02 | Engine 1.3.1 roll-up | W1 300 µg / 960 L (0.3125); W2 failed QC, non-detect < 1920 µg (0–2 mg/m³); benchmark 0.5 | qualified / below benchmark | Unresolved excluded or indicative evidence must not allow an unqualified favourable overall result; excluded data is not proof either way | Lower-bound-only check on excluded and indicative results | Evidence-disposition model (duplicate, outside scope, not replaced, remaining coverage adequate — reviewer only), reason and consequences required; separate axes; valid results keep their comparison | Fixtures TR-02, TR-02a–g, E10a–c, E14; `tr-services.test.ts` (roles, draft-only, append-only, database refusal) | How "remaining coverage adequate" is used | Fixed and tested; awaiting technical re-review |
| TR-03 | Engine 1.3.1 (engine-level); boundaries already rejected LOD > LOQ, negatives and non-finite values | <LOQ, LOD 1000 µg, LOQ 1 µg | interval 1.041667–0.001042 (lower > upper) / below benchmark | Contradictory or invalid inputs produce no numeric comparison, a specific reason, and the evidence is kept | Engine trusted its inputs; no interval-order check | Engine validation (finite, non-negative, LOD ≤ LOQ, units, qualifiers, flows, timestamps, benchmark, interval order); explicit unbounded upper; database constraint `lab_result_values_valid`; boundary checks extended (method parameters, task times, qualifier mapping) | Fixtures TR-03, TR-03a–g; `tr-services.test.ts` (import rejection shown separately from the engine; database refusal) | — | Fixed and tested; awaiting technical re-review |
| TR-04 | Engine 1.3.1 | 0.000384 µg over 480 min at 2 L/min (4 × 10⁻⁷ mg/m³); benchmark 3 × 10⁻⁷ | concentration rounded to 0 / below benchmark | Precision kept until display; a positive value never compares or displays as zero | `round(x, 6)` applied to concentrations, minutes, volumes, conversions and ratios | No intermediate rounding; conservative relative comparison tolerance 10⁻⁹; 4-significant-figure display policy; molar volume 24.05526 (EH40 para 68) | Fixtures TR-04, TR-04a–f, E8 | Display policy | Fixed and tested; awaiting technical re-review |
| TR-05 | Engine 1.3.1 | Flow 2.0 → 1.0 L/min; method tolerance 5 % | qualified / below benchmark (still formal) | A failed method criterion that requires rejection or review prevents formal use until a proper disposition | Acceptance failures only produced a qualify flag | Method-specific consequences (advisory, disposition required, invalid); not stated = disposition required (flagged); reviewer disposition with criterion, evidence and scope; invalid cannot be overridden; same for minimum volume | Fixtures TR-05, TR-05a–e, E2, E2-advisory; `tr-services.test.ts` (reviewer-only, invalid refused, database trigger) | Consequence for each real method version (e.g. MDHS14/4 para 63 for cyclones: invalid) | Fixed and tested; awaiting technical re-review |
| TR-A | Engine 1.3.1 | Night shift 22:00–06:00 without association | Clustered by inferred gaps | No silent merging or splitting of shifts | Gap inference | Explicit shift reference captured with the sample; inference only when unambiguous | Fixtures A-1–A-3; `review-regressions.test.ts`; `tr-services.test.ts` | — | Fixed and tested; awaiting technical re-review |
| TR-B | Service (assessments) | Several tasks for one group | Longest duration treated as total exposure | Total exposure reflects overlapping and sequential tasks without double counting | `greatest(max(...))` over hazards and tasks | Task records with optional times; union for timed, range for untimed; estimates flagged | Fixtures B-1–B-3; `tr-services.test.ts` | Overlap of untimed tasks | Fixed and tested; awaiting technical re-review |
| TR-C | Engine 1.3.1 | <LOQ with an LOD supplied | Interval [LOD, LOQ] (detection inferred) | Detection only when the laboratory confirms it; original qualifier kept | LOD used as lower bound whenever present | Generic <LOQ = [0, LOQ]; `detected_below_loq` = [LOD, LOQ]; laboratory text stored; CSV mapping | Fixtures E13, E13-detected; `tr-services.test.ts` (mapping, raw text kept) | Mapping of each pilot laboratory's qualifiers | Fixed and tested; awaiting technical re-review |
| TR-D | Engine 1.3.1 | — | One roll-up state | Comparability, calculation availability, evidence adequacy, numerical comparison and professional conclusion are separate | Single state | Separate output fields and a documented decision table (specification §0.8) | Fixtures (all cases assert the relevant axes) | — | Fixed and tested; awaiting technical re-review |
| TR-R | Synthetic report (`ceec79f`) | Demonstration assessment | Narrative "all three on two days" vs four worker-days; "roughly half" vs 68 %; "Used: Yes"; *improvement required* with no linked action at approval | Factual statements consistent with records; separate usage indicators; actions or explicit explanation | Free-text narrative; single usage column; action created after approval in the demonstration | Generated factual summary, planned vs achieved, automatic consistency check, usage columns, linked actions or explicit statement; demonstration corrected and regenerated | `tr-services.test.ts` (report consistency); `docs/examples/example-report.synthetic.html` | — | Fixed and tested; awaiting technical re-review |

**H1-F01 (technical disposition updated).** The roll-up was replaced in 1.4.0 by the decision table in specification §0.8. The H1-F01 rule is retained: when no formal result can be calculated, the comparison is *indeterminate*. Professional disposition is still pending (G3).

### 7.1 Re-check of engine 1.4.0 (R4, 22 Oct 2026, commit `8f601b9`)

R4 was a separate AI review agent with no part in writing the code. It is not a human or external professional review. It worked in its own worktree and database, and the full suite passed (248).
- **Reproductions:** the before outputs reproduce exactly on `ceec79f` and the after outputs match. Inputs are unchanged.
- **Fixture independence:** confirmed for the numbers. The builder imports only standard Python modules, regenerates byte-identical output, and six values matched hand checks. Limitation: the oracle follows the same rules as the engine, so it checks the arithmetic, not the design.
- **Historical integrity:** confirmed. Approved revisions are unchanged, new revisions use the new versions, approvals do not transfer, and the impact script is read-only.

Verdicts: TR-01, TR-02 (see N4), TR-03, TR-04, TR-05, A, D and the report closed; B not fully closed (N3); C closed as specified (see N1). New findings and treatment (fixed in commit after `8f601b9`, with tests; not re-reviewed):

| ID | Finding | Severity | Treatment | Evidence | Status |
|---|---|---|---|---|---|
| TR-N1 | "<LOQ" used the LOQ even when the reported value was higher (and "<LOD" mirrored the reverse); 600 µg "<LOQ" with LOQ 30 gave 0–0.031 mg/m³, below 0.5. Existed before 1.4.0 | High | Upper bound = larger of reported value and limit; difference flagged; oracle rule changed the same way independently | Fixture TR-03h (0–0.625, indeterminate) | Fixed (tests); awaiting re-review |
| TR-N2 | Highest-result summary ignored an over-range formal result (ratio ∞) | Medium | Over-range result reported as the highest with unknown upper bound; percentage claims flagged against it | `tr-services.test.ts` (N2) | Fixed (tests); awaiting re-review |
| TR-N3 | Task times shorter than the task's recorded minutes made the minutes ignored, so unsampled exposure could vanish | Medium | Recorded minutes bound the total; inconsistency flagged | Fixture B-4 | Fixed (tests); awaiting re-review |
| TR-N4 | A practitioner could set aside adverse excluded evidence as "duplicate" (any sample) or "outside scope"; set-aside evidence not shown | Medium | Duplicate must be another formal sample of the same worker and shift; outside scope is reviewer-only (service and database, migration 027); set-aside evidence listed in the note, page and report | Fixtures TR-02h, TR-02i; `tr-services.test.ts` (N4) | Superseded by TR-06 (§7.2): the correction was insufficient |
| TR-N5 | Narrative check false positives ("within 5 %", ranges, "within 28 days") and misses ("the five operators", "0.68 times") | Low | Percent and multiple claims only in benchmark/limit sentences, not after "within", largest per sentence; day counts only after on/over/across/during/for; "the N workers were" added. Documented as heuristic and advisory | Phrase probes; report tests | Fixed; residual: heuristic by nature |
| TR-N6 | A formal sample in a shift made indicative by another sample showed "not compared" without the reason | Low | Reason stated | Code | Fixed |
| TR-N7 | Acceptance dispositions are sample-level (also on samples of approved revisions) and did not check the criterion had failed; database checks trust the `app.user_id` set by the application role | Low | Criterion must have failed (service). Sample-level by design: a later disposition changes the evidence hash, so approved revisions are flagged stale, not altered. `app.user_id` trust is the existing application-credential boundary (R2-N9), with the same controls | `tr-services.test.ts` (N7) | Partly fixed; residual accepted with R2-N9 (proposed, §6) |
| TR-N8 | Documentation gave 76.6064 for E8; correct 76.6069 | Low (documentation) | Corrected | — | Fixed |
| R4-T | The "approved revision unchanged" test checked only the version | Low (test) | Full-row hash compared before and after a new revision is calculated | `tr-services.test.ts` | Fixed |


### 7.2 Findings on package `9b87c17` (engine 1.4.0): TR-06 and TR-07 (22 Oct 2026)

Source: two findings supplied with the remediation brief of 22 October 2026, stated as independently reproduced on the re-review package `9b87c17`. This register does not record who made them; they are treated as technical review findings, not as professional validation. Both were reproduced on engine 1.4.0 with the inputs unchanged before any change (`docs/remediation/tr06-tr07.before-1.4.0.json`), and an application probe showed both were reachable through the services, not only the engine (`docs/remediation/tr06-tr07.application-probe.before-1.4.0.txt`). Correction: engine **1.5.0** (`twa_8h` **1.4.0**, `stel_15` **1.3.0**), migration **028**; amended after the R5 re-check in engine **1.5.1** (`twa_8h` **1.4.1**, `stel_15` **1.3.1**), migration **029** (§7.3). Summary and evidence: `docs/remediation/remediation-summary-tr06-tr07.md`.

| ID | Affected versions | Reproduction inputs (unchanged) | Observed (1.4.0) | Expected safety property | Root cause | Correction (1.5.0) | Regression evidence | Professional-review dependency | Status |
|---|---|---|---|---|---|---|---|---|---|
| TR-06 | Engine 1.4.0 roll-up (`twa_8h` 1.3.0, `stel_15` 1.2.0); service `recordEvidenceDisposition`; trigger of migration 027. Application exposure confirmed (practitioner) | W1 08:00–08:15 0.1 mg/m³ valid; W1 15:00–15:15 2 mg/m³ excluded (failed QC, no disposition); 15-min synthetic benchmark 1 mg/m³; afternoon dispositioned *duplicate* of morning | Before disposition: indeterminate. After: **below benchmark, evidence adequate** | A different sample offered as coverage must not pass as a duplicate; a duplicate label must not suppress adverse evidence; missing relationship evidence leaves the disposition unresolved; coverage judgements stay reviewer-only | The R4 fix (TR-N4) checked only worker and shift/date; there was no duplicate category and no relationship evidence | Supported categories `same_event_record` and `paired_colocated` with relationship checks (worker, substance, exposure group, tasks, shift, window ±1 min / overlap ≥ 90 %, same instrument / pair reference recorded at capture); a higher paired result or a disagreeing same-event record is a conflict and stays unresolved; engine, service and database (migration 028) enforce it; rejected and set-aside dispositions shown with their evidence in the page and report; the superseded revision's treatment is re-checked in the report | Fixtures in group TR-06 (24 cases: TR-06, TR-06-before, TR-06a–v), TR-02b (intentional change); `tr06-tr07.test.ts` TR-06 (6 tests: reproduction through service and database, reviewer-only route, refusals, supported pair with audit and report, same-event record, conflict and later amendment); scenario run | 1-min and 90 % thresholds; the higher-result conflict rule; paired averaging (not implemented) | Implemented; **engine reproduction verified fixed by the independent technical re-review of `b5eb070`** (22 Oct 2026); all 113 fixtures verified passing |
| TR-07 | Engine 1.4.0 (`sample_concentration`); laboratory entry, amendment and CSV import; database constraint of migration 026. Application exposure confirmed (direct entry and CSV `DET<LOQ`) | `detected_below_loq`, value 600 µg, LOD 10 µg, LOQ 30 µg, 960 L; 8-h synthetic benchmark 0.5 mg/m³ | Interval 0.01042–0.03125 mg/m³, **below benchmark**; the value 600 µg ignored | Contradictory inputs give a validation failure and no favourable formal assessment; the value is neither used as a result nor discarded; original laboratory evidence kept | The value field had no defined meaning for this qualifier and was not validated against it | Defined value meaning per qualifier (`value_meaning`); detected-below-LOQ estimate in [LOD, LOQ] inclusive, or equal to the LOQ when declared a reporting threshold; one shared rule (`qualifierValueProblem`) for engine, entry, amendments and CSV import, with a message naming the conflicting fields; database constraint `lab_result_value_meaning_valid` (NOT VALID for historical rows); contradictory samples cannot be set aside except as *not replaced*; explicit CSV mapping column `value_meaning` | Fixtures in group TR-07 (17 cases: TR-07, TR-07a–p); `tr06-tr07.test.ts` TR-07 (7 tests: entry, boundaries, amendments, CSV incl. mapping and preserved raw row, database, generic qualifiers, historical record); scenario run | Inclusive boundaries; laboratory-specific mappings | Implemented; **engine reproduction verified fixed by the independent technical re-review of `b5eb070`** (22 Oct 2026); all 113 fixtures verified passing |

Impact on existing records (read-only scan, `scripts/tr/tr06-tr07-impact.ts`): development demonstration database — none found (`docs/remediation/tr06-tr07-impact.demo.json`). Synthetic historical scenario created with the 1.4.0 code — one approved revision with an issued report, classified as a *confirmed changed outcome* (below benchmark → indeterminate); it was not altered, and a new revision was created with a reason (`docs/remediation/tr06-tr07-impact.scenario.json`, `tr06-tr07-scenario.summary.json`).

TR-N4 (§7.1) is superseded by TR-06: its correction was insufficient.

**Re-review (22 Oct 2026).** The independent technical re-review of `b5eb070` verified that the original TR-06 and TR-07 engine reproductions are fixed, that all 113 calculation fixtures pass, and that the TR-01–TR-05 reproduction outputs match the supplied results. It raised TR-08 (§7.4). This is technical verification, not professional occupational-hygiene approval.

### 7.3 Re-check of engine 1.5.0 (R5, 22 Oct 2026, commit `808f76b`)

R5 was a separate AI review agent with no part in writing the code, working in its own worktree and database. **It is not a human or external professional review, and it is not the technical re-review requested for TR-06 and TR-07.** It ran the full suite (311 passed), the reproductions, about 40 engine probes and a service/database probe suite, and confirmed the fixtures are regenerated byte-identically by an oracle that does not use the engine.

Verdicts: TR-06 **not closed** (F1); TR-07 substantively closed (Lows below). Treatment (engine **1.5.1**, `twa_8h` **1.4.1**, `stel_15` **1.3.1**, migration **029**; fixed with tests; **not re-reviewed**):

| ID | Finding | Severity | Treatment | Evidence | Status |
|---|---|---|---|---|---|
| R5-F1 | A paired duplicate whose set-aside result could not be calculated (e.g. 50 mg/m³ entered on a mass-on-sample method; flow missing) skipped the conflict check and was set aside: below benchmark / adequate | **High** | Both results must be calculable; otherwise the duplicate is not accepted (engine and service; the database cannot compare results) | Fixtures TR-06w, TR-06x; `tr06-tr07.test.ts` F1; mutation detected | Fixed (tests); awaiting technical re-review |
| R5-F2 | A practitioner could drop adverse or contradictory evidence by unticking it in the draft's sample list (no record, no reviewer), equivalent to a reviewer-only scope decision. Existed before 1.4.0 | Medium | Removal needs a reason and is recorded append-only (`assessment_sample_removals`, migration 029); a practitioner's removal is a request and the sample stays in the evidence until a technical reviewer confirms (service and database); listed on the page and in the report; part of the input hash; pending removals carried into a new revision (specification §0.11) | `tr06-tr07.test.ts` F2 (service, database, report, append-only); mutation detected. Existing tests that narrow the pool now confirm removals through the services (`test/fixtures.ts`, `updateDraftConfirmed`) | Fixed (tests); awaiting technical re-review |
| R5-F3 | A duplicate stayed accepted at calculation after the set-aside sample was voided (service and database refused it) | Low | Void samples refused by the engine too | Fixture TR-06y; `tr06-tr07.test.ts` F3 | Fixed (tests) |
| R5-F4 | The database accepted NaN/Infinity in laboratory values and limits (PostgreSQL `numeric`) | Low | `lab_result_values_finite`, `sampling_flows_finite` (migration 029, NOT VALID only if historical rows violate) | `tr06-tr07.test.ts` F4 | Fixed (tests) |
| R5-F5 | The database accepted a related sample on a non-duplicate disposition | Low | `evidence_disposition_related_only_duplicate` (migration 029) | `tr06-tr07.test.ts` F5 | Fixed (tests) |
| R5-F6 | CSV numbers parsed with `Number()`: `0x1E` imported as 30 | Low | Decimal or scientific notation only; other text rejected | `tr06-tr07.test.ts` F6 | Fixed (tests) |
| R5-F7 | Relationship evidence not frozen in the audit event or shown in the report | Low | Audit event and report carry both samples' windows, instruments, pair references, tasks, group, shift and the retained result | `tr06-tr07.test.ts` F7 | Fixed (tests) |
| R5-F8 | Impact scan counted a supported but conflicting duplicate as sufficient; did not flag evidence amended after approval; attribution could include earlier engine changes | Low | Compares results from the frozen inputs; lists results amended since the calculation; states attribution | Scenario re-run | Fixed |
| R5-D | Documentation: "missing evidence never passes" and "later unsupported dispositions are rejected" were not true in 1.5.0; finite limits not enforced by the database; capability matrix stale; bytecode committed | Low (documentation) | Corrected with the fixes above; capability matrix updated; bytecode removed and ignored | — | Fixed |

### 7.4 TR-08: effective sample list not used by the approval safeguards (22 Oct 2026, reviewed commit `b5eb070`)

Source: application inconsistency raised with the independent technical re-review of `b5eb070` (engine 1.5.1). That re-review verified that the original TR-06 and TR-07 engine reproductions are fixed, that all 113 calculation fixtures pass, and that the TR-01–TR-05 reproduction outputs match; those closures are retained.

**Finding.** Since 1.5.1, `buildSnapshot()` includes the selected samples **and** samples whose removal awaits a technical reviewer's confirmation (R5-F2). `assertCurrent()` used only `r.sample_ids` for the sampling-event and instrument locks and for the held-record and suspension-review checks. `approve()` used only `r.sample_ids` for the reviewer's own-QC-disposition check, and so did the database approval trigger (`enforce_pilot_approval`, migration 020). A sample could therefore stay in the calculation while falling outside these safeguards.

**Evidence history.**

| Date | Evidence | Status |
|---|---|---|
| 22 Oct 2026 | Source inspection (`src/services/assessments.ts` `assertCurrent`, `approve`; migration 020 trigger) | **Verified by source inspection; end-to-end impact awaiting integration reproduction** (status at registration) |
| 22 Oct 2026 | Integration reproductions on `b5eb070` through the services and database roles used by normal users (`test/tr08-scenarios.ts`; output `docs/remediation/tr08.before-b5eb070.json`) | **Reproduced end to end** for all five paths below; no other control blocked them |

| Path | Reproduction on `b5eb070` | Result |
|---|---|---|
| Held field record on a pending-removal sample | Sample in the calculation; submission and approval | **Both succeeded** (the hold was not checked) |
| Suspension-review flag on a pending-removal sample | Same | **Both succeeded** |
| Approver recorded a QC disposition for a pending-removal sample | Same reviewer approves | **Succeeded** (independence check missed it) |
| Laboratory amendment of a pending-removal sample during approval | Approval paused after its evidence check (test holds the row it supersedes); amendment started | **Amendment committed while the approval was paused; the approval then succeeded** on evidence that had changed |
| Calibration change of the pending-removal sample's instrument during approval | Same, failed calibration recorded for the instrument | **Committed while paused; approval succeeded** |

Controls that do work for **selected** samples (unchanged, for comparison): held records and suspension flags block submission and approval (`h2.test.ts` "H2/M3", "holds records received while suspended …"); a laboratory amendment waits for the approval's share lock (`h2.test.ts` "a laboratory amendment cannot commit between the approval check and the approval").

**Treatment (application 1.1.0, migration 030; engine 1.5.1 and method versions unchanged because no calculation behaviour changed).**
- **One shared resolver** of the effective evidence set: SQL functions `assessment_removal_state` and `assessment_effective_sample_ids` (migration 030), called by the service (`resolveEvidence`) and by the approval trigger. It returns selected samples plus samples whose latest removal request has no later reviewer confirmation. It removes duplicates and gives a deterministic order (selected in stored order, then pending by id). It reads only removal rows of the revision's own tenant and client, and samples of that tenant and client, under row-level security. A re-added sample is simply selected, and an earlier confirmation never authorises a later request (sequence order). The removal history and confirmations are kept.
- **Used consistently** in:
  - snapshot and calculation;
  - sampling-event and instrument share locks (id order);
  - held-record and suspension-review checks;
  - reviewer QC-disposition independence, in the service and now also the database trigger;
  - freshness (hash);
  - new revisions;
  - the prior-disposition review in reports;
  - comparability (frozen inputs).

  The page and the report keep the selected list and pending removals visible, and messages say when a blocking sample is pending removal.
- **Transaction safety.**
  - Every writer of `sample_ids` and of removals locks the revision row, which approval and submission hold `FOR UPDATE`, so membership cannot change during the check.
  - Laboratory amendments, QC checks, dispositions and voids lock the sample `FOR UPDATE`; calibrations lock the instrument `FOR UPDATE`. These wait for the approval's share locks on the effective set.
  - **Related writer-path fix:** placing a held field record on an existing sample took no lock on the sample, so a hold could appear between an approval's hold check and its commit (also for selected samples). It now takes `FOR NO KEY UPDATE` on the sample.
  - The trigger re-checks holds, suspension review and independence on the effective set inside the approving transaction.
- **Tests** (`test/tr08.test.ts`, 13; scenarios shared with the before-fix reproduction):
  - held record and suspension flag, at submission, at approval and through the trigger;
  - approver QC disposition (pending and selected samples);
  - concurrent amendment and calibration (coordinated transactions, sequence captured);
  - freshness failure;
  - hold placement during approval;
  - confirmed removal;
  - re-add and second request;
  - resolver properties;
  - an ordinary assessment.

  Mutation checks were detected for the service resolver use, the trigger and the hold-placement lock.
- **Historical impact (read-only, `scripts/tr/tr08-impact.ts`).** Development database: nothing flagged. Synthetic history created with `b5eb070` (`scripts/tr/run-tr08-scenario.sh`): 4 approved revisions with issued reports flagged:
  - 2 *concern* (an outstanding held record; the approver's own QC disposition);
  - 1 *needs investigation* (a suspension flag whose set time is not recorded, cleared after approval);
  - 1 *potentially affected, no concern found*.

  Approved revisions were unchanged by the check (row hash).

**Status: implemented — awaiting technical re-review.** The re-review's verified closure of the TR-06 and TR-07 engine reproductions, the 113 fixtures and the TR-01–TR-05 outputs stands; they pass unchanged.

### 7.5 Re-check of the TR-08 change (R6, 22 Oct 2026, commit `a9a4fff`)

R6 was a separate AI review agent, working in its own worktree and database. **It is not the requested technical re-review and not professional validation.** It ran the full suite (333 passed) and probe tests, and found the resolver semantics sound. It found the gaps below. Treatment: **application 1.1.1**, migration **031**; engine 1.5.1 and method versions unchanged (no calculation change). All are fixed with tests; **not re-reviewed**.

| ID | Finding | Severity | Treatment | Evidence | Status |
|---|---|---|---|---|---|
| R6-N1 | A held field record sent with only its `client_uuid` (device never learned the server id, e.g. a lost response) did not match its sample: approval succeeded for pending and selected samples, and placing such a hold took no lock. Predates TR-08 | Medium | Holds match by `client_uuid` too (service, approval trigger re-created in 031, impact check); placing one locks the existing sample `FOR NO KEY UPDATE` | `tr08.test.ts` N1 ×2; mutations detected | Fixed (tests); awaiting technical re-review |
| R6-N2 | Register records in the snapshot (task and hazard durations and times, substance) were not locked: a task update committed during a paused approval, which then approved stale exposure records. Predates TR-08 | Medium | Tasks, hazards and the substance share-locked in submission and approval (fixed order after samples and instruments) | `tr08.test.ts` N2; mutation detected | Fixed (tests); awaiting technical re-review |
| R6-N5 | `staleness()` reported "evidence has changed" for every calculated revision (stored JSONB reorders keys), so the staleness signal relied on in the TR-08 documents was meaningless. Pre-existing | Medium | Canonical comparison | `tr08.test.ts` N5 (no warning when unchanged; warning after an amendment); mutation detected | Fixed (tests); awaiting technical re-review |
| R6-N3 | Laboratory import commit locked samples in file order: deadlock with an approval (failed closed with a raw database error) | Low | Import commit, submission dispatch and receipt lock samples in id order first | `tr08.test.ts` N3 reproduces the R6 sequence; mutation (deadlock) detected | Fixed (tests) |
| R6-N4 | A sample awaiting removal confirmation could not be dispositioned ("not part of this revision"), and the disposition form hid it | Low | Dispositions over the effective set (service; disposition trigger re-created in 031 from its 028 body); form lists pending samples | `tr08.test.ts` N4 | Fixed (tests) |
| R6-M1 | A new revision turned unconfirmed removals into selected samples, losing the request | Low | Carried forward as removal requests in the new revision ("Carried forward from rN …"), so they stay evidence and visible until confirmed | `tr08.test.ts` carry-forward | Fixed (tests) |
| R6-M2 | Impact check: laboratory writes for any substance counted; "now" and "at approval" concerns mixed in the counts | Low | Assessed substance only; separate counts (`concernEstablishedAtApproval`, `concernOutstandingNowOnly`) | Scenario re-run | Fixed |
| R6-D | Documentation overclaims: hold placement always locks (only with server id); deterministic lock order system-wide (not for writers); later amendment "reported as staleness" (staleness always fired); every safeguard uses the effective set (dispositions and client_uuid holds did not) | Low (documentation) | Corrected with the fixes above (`remediation-summary-tr08.md` §7) | — | Fixed |

**Status of TR-08 after R6: implemented — awaiting technical re-review** (application 1.1.1).
