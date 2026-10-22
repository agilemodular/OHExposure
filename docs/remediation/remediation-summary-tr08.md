# Effective evidence set for approval safeguards — TR-08

**Reviewed commit:** `b5eb070` (engine 1.5.1) · **Date:** 22 October 2026 · **Application:** 1.0.0 → **1.1.0** · **Migration:** 030 · **Engine and methods:** unchanged (1.5.1; `twa_8h` 1.4.1, `stel_15` 1.3.1).
**Classification unchanged: internal prototype — pilot gates remain open.** Passing automated tests is not occupational-hygiene approval or authorisation for pilot use.

## 1. Status

| Item | State |
|---|---|
| TR-06, TR-07 engine reproductions; 113 fixtures; TR-01–TR-05 outputs | **Verified by the independent technical re-review of `b5eb070`** — retained; all still pass |
| TR-08 effective sample list not used by the approval safeguards | **Implemented — awaiting technical re-review** |
| Historical records | Read-only check provided; nothing flagged in the development database; any hosted database needs its own run |

The evidence classes are kept apart:
- **Supplied test evidence:** the development-workspace runs in this package.
- **Independent technical verification:** the re-review of `b5eb070` covers the items marked as verified above. It does not cover TR-08, which it raised.
- **Professional approval:** none, for any method version.

## 2. Finding and evidence history

Since 1.5.1, a practitioner's removal of a sample from the list is a request, and the sample stays in the calculation until a technical reviewer confirms it. `buildSnapshot()` included those samples. The safeguards did not:
- `assertCurrent()` used only the selected list for its locks and for the held-record and suspension-review checks;
- `approve()` used only the selected list for the reviewer's own-QC-disposition check;
- the database approval trigger (migration 020) also checked only the selected list.

| Step | Status |
|---|---|
| Source inspection (at registration) | Verified by source inspection; end-to-end impact awaiting integration reproduction |
| Integration reproduction on `b5eb070` (services and database roles of normal users) | **Reproduced end to end** for all five paths (`tr08.before-b5eb070.json`) |

| Path | Before (`b5eb070`) | After (application 1.1.0, `tr08.after.json` and `test/tr08.test.ts`) |
|---|---|---|
| Held record on a pending-removal sample | Submission and approval **succeeded** | Submission refused; if the hold appears after submission, approval refused by the service **and** the database trigger |
| Suspension-review flag on a pending-removal sample | Submission and approval **succeeded** | Refused at submission, approval and in the trigger |
| Approver recorded a QC disposition for a pending-removal sample | Approval **succeeded** | Refused (service and trigger) |
| Laboratory amendment of a pending-removal sample during approval | Amendment committed while the approval was paused after its check; approval **succeeded** | Amendment **waits** for the approval's lock and commits afterwards (the approved evidence is what was checked; the later amendment is reported as staleness) |
| Calibration change of that sample's instrument during approval | Same | Same: waits |

No other control blocked the reproduced paths before the fix. For **selected** samples, the existing controls already worked (cited in the findings register, §7.4).

## 3. Design

**One resolver, shared by the service and the database** (migration 030):
- `assessment_removal_state(revision, selected)`: for each sample with a removal request, the latest request and confirmation (by sequence) and the resulting state (`pending`, `confirmed`, `re_added`).
- `assessment_effective_sample_ids(revision, selected)`: the selected samples, deduplicated in stored order, followed by the pending removals ordered by id.

How the rules are met:
- **Revision, tenant and client boundaries.** Only removal rows of the revision's own tenant and client are used, for samples of that tenant and client. Row-level security applies, so another organisation sees nothing.
- **Re-added samples.** A re-added sample is simply selected; its removal history is kept.
- **Repeated requests.** A confirmation counts only if it comes later (by sequence) than the latest request. A confirmation of an earlier request therefore never authorises a later one.

**Where the resolver is used:**
- snapshot and calculation;
- sampling-event and instrument share locks;
- held-record and suspension-review checks;
- reviewer QC independence (now also in the database);
- freshness (hash);
- carrying pending removals into a new revision;
- the report's prior-disposition review;
- comparability, which now uses the frozen inputs.

**Visibility.** The page and the report already list the selected samples and removals (pending or confirmed, with who and why). Refusal messages now say when the blocking sample is one awaiting removal confirmation.

**Transaction safety.**

| Writer | Lock | Interaction with submission and approval |
|---|---|---|
| Draft update (`sample_ids`), removal request or confirmation | Revision row `FOR UPDATE` (the trigger on removals also takes `FOR SHARE`) | Serialised with submission and approval, which hold the same row `FOR UPDATE`; membership cannot change during the check |
| Laboratory result or amendment, QC check, QC disposition, void | Sample `FOR UPDATE` | Waits for the approval's `FOR SHARE` on every effective sample (locked in id order) |
| Calibration | Instrument `FOR UPDATE` | Waits for the approval's `FOR SHARE` on the effective samples' instruments (id order) |
| Held field record on an existing sample | **New:** sample `FOR NO KEY UPDATE` | Previously took no sample lock, so it could appear after an approval's hold check, also for selected samples. Now it waits |
| Hold on the assessment | Assessment row (existing) | Unchanged |

Lock order: revision row, then sampling events by id, then instruments by id, then benchmark version. The trigger re-locks the effective samples (already held) and re-checks holds, suspension review and independence inside the approving transaction.

The concurrency tests do not rely on comparing a hash. An approval is paused after its evidence check by holding the row it must supersede. The other writer is then observed (through `pg_stat_activity`) to be waiting for the approval's lock, and the sequence of events is recorded. A separate test shows that a change committed **before** the check makes approval fail on freshness.

## 4. Versioning decision

- **No calculation behaviour changed.** The same inputs give the same outputs, and the TR-01–TR-07 reproductions, E1–E14 and all 113 fixtures are unchanged.
- **Engine and methods stay** at 1.5.1, `twa_8h` 1.4.1 and `stel_15` 1.3.1. No method version has a professional approval, so nothing needs to transfer.
- **Application version** (`package.json`) goes from 1.0.0 to **1.1.0** for the safeguard change and schema migration 030.
- **Snapshot hash.** Pending removals are now ordered by id. A revision **in review** whose frozen inputs include a pending removal may fail the freshness check and need recalculation. Approved revisions are not affected.

## 5. Historical impact (read-only)

`scripts/tr/tr08-impact.ts` runs in a read-only transaction. It looks at revisions in review, approved or superseded whose frozen inputs include samples outside the selected list. For each such sample it reports:
- held records or suspension-review flags outstanding now, or in force at approval. Hold timestamps are recorded, and a flag is set when its hold is synchronised;
- a QC disposition recorded by the approving reviewer before approval;
- laboratory or calibration writes after the calculation, and up to 5 minutes after approval, that are not in the frozen inputs;
- whether the sequence cannot be established from the records.

It does not conclude that a flagged revision was wrongly approved, and it changes nothing. Corrections use the existing workflow: a new revision with a reason, then supersession of reports after re-approval.

| Database | Flagged | Concern | Needs investigation | No concern found | Approved | Issued reports | File |
|---|---|---|---|---|---|---|---|
| Development demonstration database | 0 | 0 | 0 | 0 | 0 | 0 | `tr08-impact.demo.json` |
| Synthetic history made with `b5eb070` (`run-tr08-scenario.sh`) | 4 | 2 (held record outstanding; approver's own QC disposition) | 1 (flag cleared after approval, set time not recorded) | 1 | 4 | 4 | `tr08-impact.scenario.json` |

In the scenario, approved revisions had the same row hash before and after the check.

## 6. Tests actually executed (development workspace)

See `docs/test-evidence.md`. The packaged run's per-test results are in the package's `03-fixtures-and-tests/results/test-run.json`. `test/tr08.test.ts` has 13 integration and concurrency tests.

Mutation checks were run by hand. Each of these broke the expected tests:
- the service resolver use reverted to the selected list;
- the trigger reverted to the selected list;
- the hold-placement lock removed.
