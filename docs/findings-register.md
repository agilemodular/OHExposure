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

## 1. Reconciled from Phase H1

| ID | Finding | Workflow | Original → now | Reason for change | Reproduction (original) | Remediation | Verification evidence | Reviewer acceptance | Pilot / production implication |
|---|---|---|---|---|---|---|---|---|---|
| H1-F01 | Roll-up said *not comparable* instead of *indeterminate* when no formal result could be calculated | Calculation | Medium → none (fixed) | Engine 1.3.1 | Two overlapping samples for one worker → state *not comparable* | `twa_8h` 1.2.1, `stel_15` 1.1.1 | `calc.test.ts` "engine 1.3.1 roll-up" (3); `validation-examples.json` E9 | Software: R1 ✓. **Professional disposition: awaiting reviewer (G3)** | Must be dispositioned by the hygienist before the method is approved |
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
| R-X1 | Separation between reviewer and recording operator is a name comparison only (method reviews, reference imports, pilot authorisations) | Authority | Low | — | Use a different spelling of the same name | Signed documents are hashed and stored (H2), so the evidence can be checked | Names compared after normalisation (case, accents, punctuation, word order; Unicode letters kept); operator OS user and host recorded in the audit event (`scripts/identity.ts`, `9199a11`, regression fix below) | **Mitigated; name-based by design (accepted in the R2 acceptance check).** The gate reviewer checks the signed document against the record. |
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
| R2-L | Lows: method-review ordering in one transaction; view columns; pilot authorisation mutability; NULL suspension helper; integration delivery and holds; expired methods at issue; MAC not covering the version; non-atomic device writes; gzip on authenticated pages; floating image tags; CREATEDB for restore; KEK in backup jobs; weak tests | Various | Low | — | All fixed except image tags (pinned by comment, to digest at deployment) and the name-only check (R-X1) | Tests for ordering and pilot authorisations; code | Re-check: **Fixed** except tags (partial) and R-X1 (accepted, not fixed) | Pin image digests in G5 |

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

The reviewer confirmed R2-P1, R2-P2, R-L4, R-L5, R-L7 and the R2-M7 residual as fixed, accepted R-X1 as mitigated (name-based by design), and raised one regression:

| ID | Finding | Remediation | Verification | Acceptance |
|---|---|---|---|---|
| R2-Q1 | The new name normalisation removed every non-Latin character, so any two non-Latin names (e.g. two Chinese names) compared as the same person and the separation check refused legitimate records | Unicode letters and digits are kept; if normalisation leaves nothing, the trimmed lower-case names are compared | `h2.test.ts` (`王伟` ≠ `李娜`; `王伟` = ` 王伟 `) | **Closed (R2 re-check)** |
| R2-Q2 | Medium (fails closed). The fix for R2-Q1 removed combining marks from every script, so distinct names in Devanagari, Thai or Japanese kana collided (सुनील = सोनल, मीना = मोना, ジロウ = シロウ). Legitimate reviewers or authorisers could have been refused | Marks are removed only after Latin, Greek, Cyrillic, Arabic and Hebrew letters (optional accents and vowel points) and are kept elsewhere | `h2.test.ts` (Hindi, Thai and Japanese pairs; accented Latin, Greek and Hangul equivalents) | **Closed (R2 re-check)** |
| R2-Q3 | Low: a space inside a CJK name hid a match (`王伟` vs `王 伟`) | Whitespace between Han, kana and Hangul characters is ignored | `h2.test.ts` | **Closed (R2 re-check)** |
| R2-Q4 | Low: an invisible joiner, variation selector or detached mark added to a name hid a match (`王伟` vs `王伟` + U+034F) | Invisible joiners, variation selectors, zero-width characters and marks not attached to a letter are ignored, as the reviewer suggested | `h2.test.ts` (five cases) | Fixed (tests); not re-reviewed. Name-based by design (R-X1): the signed document remains the control |

## 4. Open findings summary (19 Oct 2026, after the acceptance check)

Closed in the acceptance check and removed from this table: R-L4, R-L5, R-L7, R2-M7 residual, R2-P1, R2-P2.

| ID | Severity | Status | Implication | Next action / owner |
|---|---|---|---|---|
| H1-F01 | Medium (calculation) | Fixed; **professional disposition pending** | Blocks G3 until dispositioned | Appointed hygienist (G2/G3) |
| R-H2a | Low | Open | Only devices that ran pre-H1 builds (demo) | None for pilot devices |
| R-M5 | Low | Fixed, awaiting device evidence | Exercise in device test F21 before enabling offline | Pilot site (G9) |
| R-M6 | — | Fixed, awaiting device evidence (F17) | — | Pilot site (G9) |
| R-M8 | Low | Mitigated; **accepted-risk decision needed** | PIN strength is the main defence | Controller, within G8 |
| R-L1 | Low | Mitigated | Cached page may persist if the user never reaches the sign-in page | Accept within G8 |
| R-X1 | Low | Mitigated (accepted by R2) | Separation checks are name-based by design | Gate reviewers check signed documents (hashes stored) |
| R-X2 | — | Closed by R2-M7 (instruments locked during approval) | — | — |
| R2-H3 | Low (residual) | Owner role remains privileged (BYPASSRLS, table owner) | Documented privileged access | Hosting owner (G5) |
| R2-N7 | Low | Open | Existing deployments need role and volume changes | Hosting owner on first deployment (G5) |
| R2-N9 | Low | Open (documented boundary) | Inputs-hash check is service-only | Accept, or add a database check before production |
| R2-Q4 | Low | Fixed (tests), not re-reviewed | Invisible characters in names | Next independent review; R-X1 control applies |
| Image tags | Low | Partial | Pin digests at deployment | Hosting owner (G5) |

**No Critical, High or Medium software finding is open.** The one open Medium item, H1-F01, is fixed in software and awaits the hygienist's professional disposition.
