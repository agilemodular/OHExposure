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
| **R-M3** | **Attachment upload not gated by suspension** | Suspension | **Medium** → none | Gated (H1 addendum), then intake quarantine, finalisation re-check and link-time check (H2) | Upload to a sampling event while `field_sync` is suspended | `attachments.ts`; tenant row share-lock | `assurance.test.ts`; `h2.test.ts` (intake, admission, race) | Fixed, awaiting acceptance (R2) | **Reconciliation.** The H1 completion report rated this Medium. The 18 Oct release report listed it among "low" residual items. **Medium is correct**: an upload during a suspension can alter evidence under investigation. The release report is corrected. |
| R-M4 | Suspended sync marked records *rejected* | Suspension / offline | Medium → none | `deferred`, plus server-side hold (H2) | Sync while suspended | `field.ts` | `h2.test.ts` offline replay | R1 ✓ (deferred); hold: R2 | None |
| R-M5 | Wind-down after offline switched off lost the recovery key | Offline | Medium → Low (unexercised) | Fixed in logic | Switch offline off with unsynchronised records | `field.js` | Code only; **not browser-tested** | R1 ✓ (code) | Exercise in the device tests (F21) before enabling offline. **Fixed, awaiting device evidence.** |
| R-M6 | Unlock could sync under another user's session | Offline | Medium → none | Unlock refuses; token refresh checks the user | Shared browser profile | `field.js` | Code; **not browser-tested** | R1 ✓ | Covered by device test F17 |
| R-M7 | Duplicate conflict rows on re-send | Offline | Medium → none | De-duplicated | Re-import same file | `field.ts` | `assurance.test.ts` recovery re-import | R1 ✓ | None |
| R-M8 | Weak PINs allowed; protection overstated | Offline | Medium → Low | 8+ characters with a non-digit; *Change PIN*; documentation states guessing rates | 6-digit PIN | `field.js`; `offline-field-capture.md` key management | Browser check (change PIN) | R1 ✓ (policy) | PIN strength remains the main defence. **Accepted-risk decision needed by the controller within G8.** |
| R-M9 | Pilot gate did not check averaging period | Approval | Medium → none | Service and trigger | TWA benchmark on STEL calculation | `assurance.ts`; `enforce_pilot_approval` | `assurance.test.ts` | R1 ✓ | None |
| R-L1 | Cached page held personal data after sign-out | Offline | Low → Low (residual) | Sign-in page deletes the cache | Sign out, inspect Cache API | `signed-out.js` | Browser check | R1 ✓ after re-check fix | Residual: not cleared if the user never reaches the sign-in page. **Mitigated.** |
| **R-L2** | No database-level issue gate; recovery key planting by the application role | Approval / report issue / recovery | Low → none | Triggers 018 and 019; key verification at start and first use | Insert an issued report as `ohea_app` | `enforce_report_issue`, `enforce_pilot_approval`, `activeRecoveryKey` | `assurance.test.ts`; `h2.test.ts` (direct writes refused) | Fixed, awaiting acceptance (R2) | None once accepted |
| **R-L3** | No KEK startup check or rotation | Recovery | Low → none | `recovery-keys.ts verify` / `rotate` / `replace`; start check | Wrong KEK only noticed at import | Scripts and start check | `assurance.test.ts` rotation; `h2.test.ts` replacement | Fixed, awaiting acceptance (R2) | None once accepted |
| R-L4 | Alert de-duplication map unbounded; CLI accepted demo level | Operations | Low → Low (residual) | Level validated; map pruned past 5,000 entries | — | `alerts.ts`; `platform-controls.ts` | Code | R1 ✓ | Residual: unbounded within one 10-minute window. **Accepted for the pilot scale; not yet signed by anyone, so still Open (Low).** |
| **R-L5** | Recovery import is CPU-heavy (synchronous RSA) | Recovery | Low → Low | Capped at 200 records and 5 MB per file | Import a 500-record file | Caps | Code | Not re-checked | **Mitigated.** Imports need practitioner rights. Production: move to a background job. |
| R-L6 | Reviewer could be the importer of reference data | Reference data | Low → Low (residual R-X1) | Name comparison added | — | `import-reference-data.ts` | Code | R1 ✓ | See R-X1 |
| **R-L7** | Handover, interruption and custody times not checked for the future | Field / lab | Low → none | Checked for interruptions, handover, custody, dispatch and receipt | Future custody time accepted | `util.assertNotFuture` | `assurance.test.ts` (custody); `h2.test.ts` (interruption, handover, dispatch, receipt) | Fixed, awaiting acceptance (R2) | None once accepted |
| R-X1 | Separation between reviewer and recording operator is a name comparison only (method reviews, reference imports, pilot authorisations) | Authority | Low | — | Use a different spelling of the same name | Signed documents are hashed and stored (H2), so the evidence can be checked | Code | — | **Open (Low).** Mitigation: the gate reviewer checks the signed document against the record. |
| R-X2 | Calibration evidence is not locked during approval (instrument calibrations can be added concurrently) | Approval | Low | Found in H2 analysis | Record a calibration while an approval is finalising | None; a later staleness check detects changed evidence | Code | — | **Open (Low).** Calibration additions are rare and audited. |

**The four remaining low findings named in the H1 release report** were R-L2, R-L3, R-L5 and R-L7. The release report's summary grouped three items (attachment upload, database-level issue gate, KEK rotation): it mixed R-M3 (Medium) with R-L2 and R-L3, and left out R-L5 and R-L7. Status now: R-L2, R-L3 and R-L7 are *Fixed, awaiting acceptance*; R-L5 is *Mitigated*.

## 2. Phase H2 analysis findings (before the independent review)

| ID | Finding | Original | Remediation | Verification | Status |
|---|---|---|---|---|---|
| H2-A1 | Suspension check and dependent write were not atomic (race with a suspension being applied) | Medium | Tenant row share-lock in every suspension check; per-item check in offline sync | `h2.test.ts` (suspension waits for a finalising upload) | Fixed, awaiting acceptance (R2) |
| H2-A2 | Evidence could change between the approval's input check and the approval | Medium | Evidence rows share-locked; writers take update locks | `h2.test.ts` (amendment waits; approval then refused) | Fixed, awaiting acceptance (R2) |
| H2-A3 | Offline records arriving after a suspension could enter an assessment unnoticed | Medium | Server-side hold, flag on arrival, review by another person; approval trigger refuses unreviewed held samples | `h2.test.ts` offline replay | Fixed, awaiting acceptance (R2) |
| H2-A4 | An operator could satisfy the pilot gate with a bare status change | High | Pilot level requires a recorded G11 authorisation (trigger, also binding on the owner connection) plus an approved method and reference data; approvals need scope and a hashed signed document | `assurance.test.ts`; `h2.test.ts` | Fixed, awaiting acceptance (R2) |
| H2-A5 | Method approvals had no withdrawal, expiry or scope | Medium | `withdrawn`/`expired` effective status; staleness notice; `method-impact` | `h2.test.ts` | Fixed, awaiting acceptance (R2) |
| H2-A6 | Recovery key pair could not be replaced | Medium | Versioned keys; `replace`; device re-seal | `h2.test.ts`; browser check | Fixed, awaiting acceptance (R2) |
| H2-A7 | No rollback point before migrations | Medium | Pre-migration backup in the entrypoint, required in production | Entrypoint run against a database one migration behind | Fixed, awaiting acceptance (R2) |
| H2-A8 | Refused attempts were not audited | Low | `workflow.blocked` / `assessment.blocked` on a separate connection | `h2.test.ts` | Fixed, awaiting acceptance (R2) |

## 3. Phase H2 independent review (R2)

*(Results to be added when the review completes.)*
