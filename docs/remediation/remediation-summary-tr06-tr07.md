# Duplicate-evidence and detected-below-LOQ remediation — engines 1.5.0 and 1.5.1

**Responds to:** two findings on re-review package `9b87c17` (engine 1.4.0), supplied with the brief of 22 October 2026 as independently reproduced. This document does not record who made them.
**Date:** 22 October 2026 · **Engine:** 1.4.0 → 1.5.0 → **1.5.1** · **Methods:** `twa_8h` 1.3.0 → 1.4.0 → **1.4.1**, `stel_15` 1.2.0 → 1.3.0 → **1.3.1** · **Migrations:** 028, 029.

> **Current state:** engine **1.5.1** (`twa_8h` 1.4.1, `stel_15` 1.3.1). The independent technical re-review of `b5eb070` verified that the TR-06 and TR-07 engine reproductions are fixed and that all 113 fixtures pass; it raised TR-08 (approval safeguards), which is handled in application 1.1.0 without changing the engine: `remediation-summary-tr08.md`. References to 1.5.0 below describe that superseded version.

> **Amended after the R5 re-check (§8).** R5 (a separate AI review agent, not the requested technical re-review) found that 1.5.0 did not fully close TR-06: a duplicate without a calculable result skipped the conflict check (High). It also found a pre-existing route for dropping evidence by narrowing the sample list (Medium) and six Lows. All are fixed in 1.5.1 with tests.
**Classification unchanged: internal prototype — pilot gates remain open.** Passing automated tests is not occupational-hygiene approval or authorisation for pilot use. No method version has a professional approval, and nothing approved for any earlier version transfers.

## 1. Status

| Item | Implemented and tested | Awaiting technical re-review | Awaiting professional judgement | Still open |
|---|---|---|---|---|
| TR-06 duplicate-evidence dispositions (with R5-F1, F3) | Yes | **Yes** (only the R5 AI agent has checked it; its findings are fixed but not re-checked) | Window thresholds (±1 min; ≥ 90 % overlap); higher-result conflict rule; paired averaging (not implemented) | — |
| TR-07 contradictory detected-below-LOQ inputs | Yes | **Yes** | Inclusive [LOD, LOQ] boundaries; mapping of each pilot laboratory's formats | — |
| Sample-list removals (R5-F2) | Yes | **Yes** | Whether a reviewer's confirmation is the right control | — |
| Historical records | Read-only impact scan; no record altered | Yes | Whether to reassess each affected assessment (people decide) | Reassessment of any real affected records (none in the development database) |

Evidence classes in this package are kept apart: **supplied test evidence** (runs in the development workspace, listed in §6); **independent technical verification** (none yet for 1.5.0; R4 was an AI review agent that checked 1.4.0 only); **professional approval** (none for any version).

## 2. Engine-level defect or application exposure

Both were checked on 1.4.0 before any change: the engine reproductions (`tr06-tr07.before-1.4.0.json`) and an application probe calling the services as a practitioner (`tr06-tr07.application-probe.before-1.4.0.txt`). A second check ran the 1.4.0 code end to end (§5).

| | Engine | Service | Database | Result |
|---|---|---|---|---|
| TR-06 | Accepted a duplicate naming any formal sample of the same worker and shift/date | Accepted it from a practitioner | Trigger (027) checked only role, draft status and that both samples belong to the revision | **Application exposure**: approved and reported as *below benchmark* in the 1.4.0 scenario |
| TR-07 | Ignored the value; interval [LOD, LOQ] | Direct entry and CSV import (`DET<LOQ`) accepted 600 µg with LOQ 30 µg | Constraint (026) checked only the limits | **Application exposure**: approved and reported as *below benchmark* in the 1.4.0 scenario |

## 3. What changed

### TR-06 — duplicate relationships (specification §0.9)
- Three situations are now distinct: a **duplicate record of the same sampling event** (`same_event_record`), a **genuine paired or co-located sample** (`paired_colocated`), and **a different sample offered as evidence of adequate remaining coverage**. The third is not a duplicate. It goes through `remaining_coverage_adequate`, which only a technical reviewer can record (unchanged since migration 027).
- **Relationship evidence**, all taken from the records (1.5.1: both results must also be calculable, and neither sample void):
  - always: same worker, a result for the assessed substance on both samples, the same exposure group, the same recorded tasks and the same shift;
  - `same_event_record`: start and end within 1 min, and the same instrument;
  - `paired_colocated`: the same **pair reference recorded at capture** (new field `sampling_events.pair_ref`), and an overlap of at least 90 % of the longer window.
  - Missing evidence, including a result that cannot be calculated, leaves the disposition unresolved (true from 1.5.1; in 1.5.0 a missing result was not caught — R5-F1).
- **Conflicts.** A paired result that is higher than the retained one is a conflict, and so is a same-event record whose result differs. The sample stays unresolved, so a favourable overall comparison is not possible. A technical reviewer can review the pair and record a coverage judgement.
- **Enforcement:**
  - the engine checks at every calculation, so a disposition that later becomes unsupported (an amended result, a void, a result no longer calculable — the last two from 1.5.1) is rejected then;
  - the service checks before recording, using the same function, and states the reason;
  - the database trigger in migration 028 checks every invariant it can verify; the result comparison is left to the engine and the service.
- **Audit and report:**
  - the audit event records the category, the sample and related codes, the reason, the consequence, the sample's interval and its flags;
  - the page and the report list accepted set-asides (category, related sample, retained result, reason, consequence, findings) and rejected dispositions (with the reason they were not accepted);
  - for a new revision, the report also re-checks and shows the superseded revision's dispositions.

### TR-07 — value-field meaning (specification §0.10)
- Each qualifier now has a defined meaning for the value field (`value_meaning`: measured, estimate, reporting threshold, lower limit).
- `detected_below_loq` requires finite limits with LOD < LOQ. A value, if given, is either:
  - an **estimate** within [LOD, LOQ], both limits inclusive (a value equal to a limit is accepted and noted); or
  - a **reporting threshold** equal to the LOQ, which the CSV column `value_meaning` must declare explicitly.

  The interval is always [LOD, LOQ].
- A contradictory record is refused at direct entry, on amendment and at CSV import. The message names the qualifier, value, limits and conflicting fields. The value is not changed or discarded: the CSV row is kept in `import_rows.raw`, also for rejected batches, and the laboratory text is stored.
- The database constraint `lab_result_value_meaning_valid` (migration 028) is NOT VALID for historical rows.
- Historical contradictory records:
  - the engine produces no numeric result for them (`INPUT_INVALID_DBL_VALUE`);
  - they cannot be set aside except as *not replaced*, so they always block a favourable overall comparison;
  - they are corrected by an amendment (a new result revision with a reason; earlier revisions are kept).
- Existing `<LOD`, `<LOQ`, `estimated` and `>` behaviour is unchanged (fixtures E5, E13, TR-03g, TR-03h, TR-07p; application test "generic qualifiers").

## 4. Version change record and migration 028

| | Previous (1.4.0) | 1.5.0 | Affected scenarios | Reassessment |
|---|---|---|---|---|
| Duplicate disposition | Same worker and shift/date only | Category and relationship evidence; conflict rule | Any assessment with a duplicate disposition | Yes, where the overall state was *below benchmark* and a duplicate set aside evidence |
| `detected_below_loq` value | Ignored | Must agree with the limits; else no numeric result | Detected-below-LOQ records with a value | Yes, where such a record was used |
| Contradictory sample disposition | Could be set aside like any other | Only *not replaced* | As above | As above |
| 1.5.1: duplicate with an uncalculable result; void after disposition | Set aside | Unresolved | Duplicates whose set-aside sample has no result or was voided | Yes, if any (none found) |
| 1.5.1: removing samples from the list | Silent | Recorded; effective only after a reviewer confirms | Any draft whose sample list was narrowed | Recalculate drafts |
| Everything else | — | Unchanged: TR-01–TR-05 and E1–E14 outputs are identical apart from version labels (`tr-reproductions.after-1.5.0.json`, `validation-examples.after-1.5.0.json`) | — | — |

**Migration 029** (1.5.1) adds `assessment_sample_removals` with its trigger, and the constraints `evidence_disposition_related_only_duplicate`, `lab_result_values_finite` and `sampling_flows_finite` (each NOT VALID only when historical rows violate it). It changes no existing row.

**Migration 028** adds the following and changes no existing row:
- `sampling_events.pair_ref`;
- `assessment_evidence_dispositions.duplicate_type`, with the constraint `evidence_disposition_duplicate_type` (NOT VALID when historical duplicates exist);
- the function `ohea_norm_text`, and the trigger `protect_evidence_disposition` replaced with the duplicate checks;
- `lab_result_revisions.value_meaning`, with the constraint `lab_result_value_meaning_valid` (NOT VALID when historical violations exist).

What this means for existing revisions:
- **Approved revisions** keep their outputs, approvals and reports.
- **Drafts** recalculate with the new versions.
- **Revisions in review** fail the evidence-hash check (the snapshot now includes relationship evidence and the value meaning) and must be returned to draft.
- **Reassessment** is a new revision with a reason, using the existing supersession workflow.

## 5. Impact on existing records (read-only)

`scripts/tr/tr06-tr07-impact.ts` runs in a read-only transaction. It lists:
- duplicate dispositions without sufficient relationship evidence;
- contradictory laboratory records (current or superseded);
- dependent revisions and their reports.

For each dependent revision it re-runs the current engine on the frozen inputs. It separates a **confirmed changed outcome** (the state differs and a TR-06/TR-07 marker is present) from **potentially affected** records.

| Database | Duplicate dispositions (insufficient) | Contradictory lab records | Dependent revisions | Confirmed changed | Approved affected | Issued reports affected | File |
|---|---|---|---|---|---|---|---|
| Development demonstration database | 0 (0) | 0 | 0 | 0 | 0 | 0 | `tr06-tr07-impact.demo.json` |
| Synthetic historical scenario, after migration 028 | 1 (1) | 1 | 1 | 1 (*below benchmark → indeterminate*) | 1 | 1 | `tr06-tr07-impact.scenario.json` |
| Same, after the new revision | 1 (1) | 1 | 2 (r1 confirmed; r2 draft, potentially affected) | 1 | 1 | 1 | `tr06-tr07-impact.scenario-after-reassessment.json` |

**Scenario** (`scripts/tr/run-tr06-tr07-scenario.sh`, disposable database, synthetic data):
1. The legacy phase ran the code of `9b87c17` (engine 1.4.0) on migrations up to 027. Through the 1.4.0 services it recorded the review's duplicate (morning/afternoon, different windows) and a `DET<LOQ` result of 600 µg (LOD 10, LOQ 30). It was calculated *below benchmark / adequate*, then approved and reported.
2. Migration 028 was applied with the current code. Both constraints stayed NOT VALID, as designed for historical rows.
3. The current phase checked the approved revision and its issued report by full-row hash before and after: both unchanged. It then created revision 2 with a reason. All three duplicate attempts were refused by the service, each with its reason. SYN-DBL was recorded as *not replaced*.
4. The result was *indeterminate*, *unresolved evidence*. The draft report is `docs/examples/example-report-tr06-tr07.synthetic.html`; the summary and audit extract are in `tr06-tr07-scenario.summary.json`.

## 6. Tests actually executed (development workspace, 22 October 2026)

| Run | Result | What it is |
|---|---|---|
| `npm test` (Vitest, full suite, disposable test database, application role with RLS) | **320 passed, 0 failed, 10 suites** on 1.5.1 (311 on 1.5.0); per-test results of the packaged run in the package's `03-fixtures-and-tests/results/test-run.json` | Includes 113 structured fixtures (27 TR-06, 17 TR-07; expected values from the independent Python oracle `scripts/tr/build_fixtures.py`, statuses written by hand from the specification) and 19 application tests in `test/tr06-tr07.test.ts` (6 for the R5 fixes) |
| Mutation checks (not committed; run by hand) | Every mutation detected (1.5.1: F1, F2 and F3 mutations also detected) | Engine: overlap threshold, conflict rule, LOQ check, substance check, contradictory set-aside → fixture failures. Service: duplicate check, laboratory value check → application test failures |
| Browser checks (desktop Chromium, headless, development server) | 24/24 and 17/17 | Field capture forms (pair reference added). **Not device evidence** |
| Scenario run | As §5 | Two code versions, one disposable database |

Tests that build an assessment from a narrower set than its starting pool now record the removal and have a technical reviewer confirm it through the services (`updateDraftConfirmed` in `test/fixtures.ts`); no expectation was weakened. Intentional changes to existing expectations: fixture **TR-02b** (an uncategorised duplicate is no longer accepted; was *below / adequate*, now *indeterminate / unresolved*). Existing application tests needed only the order of two service checks to be restored; no expectation was weakened.

## 7. Known limits

- The Python oracle implements the documented rules. It verifies arithmetic and status logic against the specification, not whether the rules are methodologically right (the same limit R4 noted for 1.4.0).
- The database cannot compare results (concentrations exist only in the engine), so the conflict rule is enforced by the engine and the service.
- Thresholds (±1 min, 90 %) and the conflict rule are conventions chosen for safety and are listed for professional judgement.
- The impact scan of real data has been run only on the development demonstration database. Any hosted database needs its own run.

## 8. R5 re-check of 1.5.0 and engine 1.5.1

R5 was a separate AI review agent (not a person, not the requested re-review). Findings and treatment are in `findings-register.md` §7.3:
- **F1 (High):** a duplicate with an uncalculable set-aside result skipped the conflict check. Now both results must be calculable.
- **F2 (Medium, pre-existing):** sample-list narrowing. Removals are now recorded, and a practitioner's removal takes effect only after a technical reviewer confirms it (specification §0.11).
- **F3–F8 (Low):**
  - a void sample is never a duplicate at calculation;
  - the database refuses non-finite laboratory values and flows;
  - only a duplicate can name a related sample;
  - CSV numbers are strictly decimal or scientific;
  - the audit and the report keep the relationship evidence;
  - the impact scan compares frozen results and flags amended evidence.
- **Outputs:** the TR-01–TR-07 reproductions and E1–E14 are unchanged apart from version labels (`*.after-1.5.1.json`). The scenario and the impact scans were re-run on 1.5.1 with the same results.
