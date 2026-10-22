# Calculation and reporting remediation — engine 1.4.0

**Response to:** AI-assisted technical review of commit `ceec79f` (findings TR-01–TR-05 and associated weaknesses A–D, report corrections).
**Date:** 22 October 2026 · **Engine:** 1.3.1 → **1.4.0** · **Methods:** `twa_8h` 1.2.1 → **1.3.0**, `stel_15` 1.1.1 → **1.2.0** · **Migration:** 026.
**Classification unchanged: internal prototype — pilot gates remain open.** This work is not a professional method approval and not a pilot authorisation. No method version has a professional approval, and no approval carries over from 1.2.1/1.1.1 to the new versions.

## 1. Status of each item

Status labels:
- **Fixed and tested** — remediation in place with regression tests.
- **Awaiting technical re-review** — fixed and tested, but not yet re-reviewed by you. A separate AI review agent re-checked the first version of this remediation (R4, findings register §7.1). It is not external professional validation, and its eight new findings (TR-N1–N8) were fixed afterwards without a further re-check.
- **Awaiting professional judgement** — a methodological choice needs the appointed hygienist.
- **Still open**.

| Item | Engine-level defect? | Application exposure before the fix | Fixed and tested | Awaiting technical re-review | Awaiting professional judgement |
|---|---|---|---|---|---|
| TR-01 STEL timing | Yes | Any 14–16-min sample reached a formal comparison | Yes | Yes | Zero-remainder convention; any sampling tolerance (0 now) |
| TR-02 excluded / indicative evidence | Yes (roll-up) | Yes, through calculation of any assessment | Yes | Yes | Use of "remaining coverage adequate" in practice |
| TR-03 numeric validation | Yes | **Mostly blocked at ingestion**: LOD > LOQ, negative and non-finite values already rejected by laboratory entry and CSV import; flows > 0 at capture; benchmark value > 0. Now also checked in the engine and by a database constraint | Yes | Yes | — |
| TR-04 precision | Yes | Yes, for very small values | Yes | Yes | Display policy (4 significant figures) |
| TR-05 method acceptance | Yes | Yes | Yes | Yes | Consequence per method version (none stated for existing methods → disposition required) |
| A shift identity | Design | Night shifts clustered by gap inference | Yes | Yes | — |
| B exposure duration | Design | Longest task taken as total exposure | Yes | Yes | Overlap of untimed tasks |
| C below-LOQ semantics | Yes | Generic "<LOQ" with an LOD read as detected | Yes | Yes | Laboratory qualifier mapping |
| TR-N1–N8 (found by R4) | N1 engine; N3 engine; others service/report | N1: "<LOQ" value above LOQ ignored (High) | Yes | Yes | — |
| D status logic | Design | Single roll-up state | Yes (separate axes, decision table) | Yes | — |
| H1-F01 | — | — | Technical disposition updated | — | **Professional disposition still pending** |
| Synthetic report contradictions | Report | Narrative vs records; "roughly half"; "Used: Yes"; no linked action | Yes | Yes | — |

Still open: none of the above as software defects. Professional approval of every method version remains open (G3).

## 2. Version change record

| | Previous behaviour (1.3.1) | New behaviour (1.4.0) | Affected scenarios | Reassessment needed |
|---|---|---|---|---|
| `stel_15` 1.2.0 | 14–16-min samples used as the 15-min value; zero-remainder with a justification only | Exactly 15 min uninterrupted; > 15 min no result; < 15 min needs justification and supporting evidence, marked assumption-dependent | STEL samples not exactly 15 min; any short-sample assumption | Yes, for any STEL revision with such samples |
| Roll-up | Excluded/indicative evidence affected the result only if its lower bound was at or above the benchmark | Must be dispositioned; unresolved or not-replaced evidence blocks a favourable overall comparison | Any assessment with excluded, indicative or uncalculable personal samples | Yes, where the previous state was *below benchmark* |
| Validation | Engine trusted inputs | Engine rejects contradictory and non-finite inputs | Only data that bypassed the boundaries | Unlikely (boundaries already rejected most) |
| Precision | 6-decimal rounding of concentrations, minutes, volumes, ratios; molar volume 24.0551 | Full precision; display rounding only; molar volume 24.05526 (EH40) | Very small concentrations and benchmarks; conversions (difference 6.5 × 10⁻⁶ relative) | Only for very small values near a benchmark |
| Method acceptance | Flow drift and minimum volume only qualified the result | Method-specific: advisory, disposition required, invalid; not stated = disposition required | Every sample with a failed criterion | Yes, where such samples were formal |
| Shifts | Inferred from gaps (< 4 h) and dates | Explicit shift reference; inference only when unambiguous | Night and split shifts | Yes, where shifts were inferred across midnight |
| Exposure duration | Longest task or hazard duration | Overlap-aware range from task records | Groups with several tasks | Possibly (more qualified results) |
| `<LOQ` | [LOD, LOQ] when an LOD was supplied | [0, LOQ] unless the laboratory confirms detection | Below-LOQ results | Yes, where the lower bound mattered |
| Output | One roll-up state | Adds calculation availability, evidence adequacy, unresolved evidence | All | — |

**Migration implications.** Migration 026 adds columns and tables; it does not change existing records. Historical inputs, outputs, approvals and reports are untouched. Drafts recalculate with the new versions. Revisions *in review* fail the evidence-hash check and must be returned to draft and recalculated. Approved revisions keep their 1.2.1/1.1.1 outputs and approvals. Reassessment is done by creating a new revision, which is calculated with 1.3.0/1.2.0 and needs a new approval. Existing method versions have no stated acceptance consequences, so the engine treats failures as *disposition required* until a consequence is set.

**Identifying affected assessments.** `scripts/tr/engine-change-impact.ts` lists every revision calculated with an earlier version, recomputes it read-only with the current engine from its frozen inputs, and names the scenarios triggered. On the development demonstration database it found one approved revision (`twa_8h` 1.2.1) that changes from *below benchmark* to *indeterminate* because of unresolved evidence (TR-02): `engine-change-impact.demo.json`.

## 3. Evidence in this folder

| File | Content |
|---|---|
| `tr-reproductions.before-1.3.1.json` | TR-01–TR-05 run on the 1.3.1 engine (inputs as in the review; unchanged) |
| `tr-reproductions.after-1.4.0.json` | Same inputs on 1.4.0 |
| `validation-examples.before-1.3.1.json` / `…after-1.4.0.json` | Worked examples E1–E14 engine outputs before and after |
| `engine-change-impact.demo.json` | Impact report on the demonstration database |
| `../../test/fixtures/worked-examples.fixtures.json` | 65 structured fixtures: exact inputs, independently derived expected values (Python, `scripts/tr/build_fixtures.py`), expected statuses and flags, tolerances, method versions, and an explanation for every intentional change from 1.3.1 |

| Reproduction | 1.3.1 (before) | 1.4.0 (after) |
|---|---|---|
| TR-01 16-min sample 0.975 vs 1 (15-min) | complete / below benchmark | incomplete / indeterminate; STEL_SAMPLE_TOO_LONG |
| TR-02 valid 0.3125 + excluded ND 0–2 vs 0.5 | qualified / below benchmark | qualified / indeterminate; evidence adequacy *unresolved evidence*; W1 result still *below* |
| TR-03 <LOQ, LOD 1000, LOQ 1 | interval 1.041667–0.001042 / below | incomplete / indeterminate; INPUT_INVALID_LIMITS |
| TR-04 4 × 10⁻⁷ vs 3 × 10⁻⁷ | rounded to 0 / below | complete / at or above |
| TR-05 flow 2 → 1 L/min, 5 % | qualified / below | sample excluded (disposition required); not comparable; data quality failed |

## 4. Intentional changes to existing expected results

| Example | Review-pack expectation | 1.4.0 | Reason |
|---|---|---|---|
| E2 | Flagged flow drift 10 % > 5 % | Sample excluded until a reviewer's disposition (method consequence not stated) | TR-05. E2-advisory shows the qualified result when the method states "advisory" |
| E7b | 1.5 mg/m³ (flagged) | No result without supporting evidence; 1.5 mg/m³ assumption-dependent with evidence (E7b-evidence) | TR-01 |
| E8 | 76.607 mg/m³ (24.0551) | 76.6069 mg/m³ (24.05526, EH40 para 68) | TR-04 and authoritative constant; within the pack's ±0.1 % tolerance |
| E13 | 0.010417–0.03125, indeterminate | 0–0.03125, indeterminate (same state) | Item C; E13-detected keeps the LOD lower bound when detection is confirmed |
| E10c | W2 below; overall indeterminate | Same; W1's indicative result is listed as unresolved evidence | TR-02 (state unchanged) |
| E14 | "No usable personal results" | Not comparable; evidence adequacy *no formal evidence* | Item D (state unchanged) |

## 5. Test results (development workspace)

`npm test`: 256 tests in 9 suites, all passing (see `../test-evidence.md`). This includes 70 fixture tests (69 cases), 17 service and database tests for the remediation, and the existing suites with intentional updates. The updated tests are: night shift, H5 unconvertible indicative evidence, flow drift, short STEL sample, version assertions, and "every sample excluded". Browser checks were re-run on desktop Chromium; they are not device evidence.

## 6. Report corrections

- The **planned** strategy and the sampling **achieved** are shown separately. The achieved summary is generated from the records: samples, workers, worker-days, dates, results, highest ratio.
- **Automatic consistency check:** worker counts, day counts and fraction-of-benchmark statements in the interpretation or the plan that contradict the records are flagged. The text itself is not changed and stays editable.
- **Usage columns:** "Used: Yes" is replaced by *In report*, *In calculation* and *In formal comparison*, each with a reason when it is "No".
- **Linked actions:** *improvement required* and *urgent action required* now show the linked actions. If none are linked, the report states this explicitly and says recommendations must be recorded as actions before reliance.
- **Synthetic report** (`../examples/example-report.synthetic.html`) regenerated from a fresh database:
  - the narrative now matches four worker-days on two dates;
  - the highest TWA is stated as 68 % of the benchmark;
  - NF-26-003 is dispositioned as not replaced;
  - the action is linked before approval.

  Synthetic labelling and the distinction between the demonstration workflow approval and professional method approval are unchanged.

## 7. Re-check by a separate AI review agent (R4)

R4 re-checked commit `8f601b9`. It closed TR-01–TR-05, A, D and the report. It confirmed that the reproductions are unchanged and that the fixture numbers are independent. It also found eight new issues:
- **High:** TR-N1 — a "<LOQ" value above the LOQ was ignored; this existed before 1.4.0.
- **Medium:** TR-N2–N4 — an over-range result was missing from the summary; recorded task minutes were ignored when shorter task times were given; a practitioner could set aside adverse evidence.
- **Low:** TR-N5–N8.

All were fixed with tests, apart from the residual of N7, which is accepted with the application-credential boundary. Details are in the findings register §7.1. R4 also noted a limitation: the Python oracle follows the same rules as the engine, so it checks arithmetic, not design choices. Design choices remain for the hygienist (specification §0).

