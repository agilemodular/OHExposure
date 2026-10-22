# Effective evidence set for approval safeguards — TR-08

**Reviewed commit:** `b5eb070` (engine 1.5.1) · **Date:** 22 October 2026 · **Application:** 1.0.0 → 1.1.0 → **1.1.1** · **Migrations:** 030, 031 · **Engine and methods:** unchanged (1.5.1; `twa_8h` 1.4.1, `stel_15` 1.3.1).
**Classification unchanged: internal prototype — pilot gates remain open.** Passing automated tests is not occupational-hygiene approval or authorisation for pilot use.

## 1. Status

| Item | State |
|---|---|
| TR-06, TR-07 engine reproductions; 113 fixtures; TR-01–TR-05 outputs | **Verified by the independent technical re-review of `b5eb070`** — retained; all still pass |
| TR-08 effective sample list not used by the approval safeguards | **Corrected by source review; supplied integration evidence reviewed; independent runtime verification outstanding** (application 1.1.1, after the R6 AI-agent re-check, §7; technical review of `21a6d0f`, §8) |
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

| Path | Before (`b5eb070`) | After (application **1.1.1**: `tr08.after.json` at `b1f4dd0`, `test/tr08.test.ts`, and the handover candidate's own run) |
|---|---|---|
| Held record on a pending-removal sample | Submission and approval **succeeded** | Submission refused; if the hold appears after submission, approval refused by the service **and** the database trigger |
| Suspension-review flag on a pending-removal sample | Submission and approval **succeeded** | Refused at submission, approval and in the trigger |
| Approver recorded a QC disposition for a pending-removal sample | Approval **succeeded** | Refused (service and trigger) |
| Laboratory amendment of a pending-removal sample during approval | Amendment committed while the approval was paused after its check; approval **succeeded** | Amendment **waits** for the approval's lock and commits afterwards (the approved evidence is what was checked; the later amendment is reported as staleness — reliable from 1.1.1, R6-N5) |
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
| Held field record on an existing sample | **New:** sample `FOR NO KEY UPDATE` — by server id (1.1.0) and by `client_uuid` when the device has no server id (1.1.1, R6-N1) | Previously took no sample lock, so it could appear after an approval's hold check, also for selected samples. Now it waits |
| Task or hazard update (register) | Row `FOR UPDATE` | **1.1.1 (R6-N2):** submission and approval share-lock the tasks, hazards and substance that feed the snapshot, so the update waits |
| Laboratory import commit; submission dispatch and receipt | **1.1.1 (R6-N3):** samples `FOR UPDATE` in id order before writing | Same order as approval, so no deadlock |
| Hold on the assessment | Assessment row (existing) | Unchanged |

Lock order in submission and approval: revision row, then sampling events by id, then instruments by id, then tasks, hazards and substance (1.1.1), then benchmark version. Writers lock rows of one kind, several of them in id order. The trigger re-locks the effective samples (already held) and re-checks holds, suspension review and independence inside the approving transaction.

The concurrency tests do not rely on comparing a hash. An approval is paused after its evidence check by holding the row it must supersede. The other writer is then observed (through `pg_stat_activity`) to be waiting for the approval's lock, and the sequence of events is recorded. A separate test shows that a change committed **before** the check makes approval fail on freshness.

## 4. Versioning decision

- **No calculation behaviour changed.** The same inputs give the same outputs, and the TR-01–TR-07 reproductions, E1–E14 and all 113 fixtures are unchanged.
- **Engine and methods stay** at 1.5.1, `twa_8h` 1.4.1 and `stel_15` 1.3.1. No method version has a professional approval, so nothing needs to transfer.
- **Application version** (`package.json`) went from 1.0.0 to 1.1.0 for the safeguard change and schema migration 030, then to **1.1.1** for the R6 fixes and migration 031 (§7). The current candidate is **1.1.1**.
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

See `docs/test-evidence.md`. `test/tr08.test.ts` has **20** integration and concurrency tests: the 13 written for application 1.1.0, plus 7 added in 1.1.1 for the R6 fixes (§7). The current evidence for the handover candidate comes from its own verification run (`docs/verification-runbook.md`); earlier outputs keep their original commit identifiers.

Mutation checks were run by hand. Each of these broke the expected tests:
- the service resolver use reverted to the selected list;
- the trigger reverted to the selected list;
- the hold-placement lock removed.

## 7. R6 re-check (an AI review agent) and application 1.1.1

R6 checked application 1.1.0 at `a9a4fff`. It is not the requested re-review. It found the resolver sound and found three Medium, two Low and two minor issues, plus documentation overclaims (`findings-register.md` §7.5). All are fixed in **1.1.1** with migration 031, with 7 more tests, and every fix was mutation-checked:
- **N1:** held records sent with only a `client_uuid` now match and lock their sample.
- **N2:** register records feeding the snapshot are locked during approval.
- **N3:** writers lock samples in id order, so a laboratory import no longer deadlocks with an approval.
- **N4:** samples awaiting removal can be given a disposition.
- **N5:** staleness now compares evidence canonically, so it is reported only when evidence actually changed.
- **Minor:** unconfirmed removals carry into a new revision as removal requests, and the impact check counts concerns at approval separately from concerns outstanding now.

Corrected statements:
- hold placement locks the sample whether the device sends the server id or only the `client_uuid`;
- the deterministic lock order covers the writers listed in §3;
- the staleness report is reliable from 1.1.1;
- evidence dispositions and `client_uuid` holds also use the effective set.

The scenario and development-database checks were re-run, with the same classifications plus separate "at approval" and "now" counts. The engine and method versions are unchanged.

## 8. Technical review of `21a6d0f` and evidence identifiers

The technical review of `21a6d0f` (application 1.1.1) found the TR-08 source inconsistency corrected and no further blocking defect within its scope. It could not run the application because the archive lacked the complete source and runtime setup. **Status: Corrected by source review; supplied integration evidence reviewed; independent runtime verification outstanding.**

**Evidence identifiers.**
- `tr08.after.json` (commit `b1f4dd0`) is the reproduction run when the 1.1.1 code was committed.
- `21a6d0f` added documentation and packaging only. No application, migration, test, dependency or configuration file differs, and neither do the TR-08 scenario or impact scripts. The reproduction is therefore unaffected, and `tr08.after.json` keeps its original identifier.

**Handover candidate.** It adds only verification tooling and documentation:
- `verification/` and `docs/verification-runbook.md`;
- `.env.verification.example` and the `package.json` `engines` field;
- `tsconfig.json` now including `verification`;
- the report and scenario scripts deriving the application-role URL from the given server URL rather than assuming the `postgres_dev` password.

It makes no application, migration, test or calculation change. Its own clean-environment run is in the handover package, under its own identifiers. A first run (candidate `a542514`) on a SQL_ASCII cluster revealed the undocumented UTF-8 database requirement (TR-09). That was fixed in tooling and documentation, and the run was repeated on the same cluster.
