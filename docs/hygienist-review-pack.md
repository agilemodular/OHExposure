# Professional validation pack — occupational hygiene review

**Start with** `professional-review-handover.md`, which indexes this pack and the supporting material.

**For:** the competent occupational hygienist appointed to review the platform before a controlled pilot (pilot gates **G2** and **G3**, dependency D1).
**Engine:** 1.4.0 (updated 22 Oct 2026; see `docs/remediation/remediation-summary.md` and specification §0) — `sample_concentration` (engine-level), `twa_8h` **v1.3.0**, `stel_15` **v1.2.0**, ppm ↔ mg/m³ conversion. **Prepared:** 18 October 2026.
**No code inspection is needed.** Every number in this pack was produced by running the engine on the stated inputs (generator kept with the test evidence), not typed in.

## How to use this pack

1. Read section 1 (what the software decides and what it leaves to people).
2. For each convention in section 2, mark **Accept**, **Accept with conditions** or **Reject**, and note why.
3. Recalculate the worked examples in section 3 by hand. Each has an expected result and a tolerance.
4. Review the restrictions (section 4), the example report and limitation statements (section 5), and the control-effectiveness and closure rules (section 6).
5. Record any finding in the findings register (section 8) and sign section 9.

Two different questions are asked, and they are kept apart throughout:

| Question | Who answers | Evidence |
|---|---|---|
| **Software correctness** — does the software do what the specification says? | Software verification (tests, independent software reviewers) | `test-evidence.md`; 122 automated tests; three independent software review rounds |
| **Methodological suitability** — is what the specification says appropriate occupational hygiene practice for the pilot? | **You** | This pack |

A method version can be used for pilot conclusions only after you approve it. Your decision is recorded by a platform operator from your signed copy of this pack (`scripts/platform-controls.ts method-review`); the operator cannot be the reviewer, and **no administrator role in the application can record or change a method approval.** Organisation administrators have no database right to do so. Until a method version is approved, pilot organisations cannot submit or approve conclusions that use it, and every report states "Method review status: not reviewed". A pilot organisation also cannot issue a report for a revision that was not approved under these controls, or whose method has since been rejected; issued reports state the method status and any conditions in force at approval, and whether the conclusion was approved under an authorised pilot.

Everything here uses synthetic inputs. No real exposure limits are loaded.

## 1. What the software decides and what it does not

The software calculates and flags. It never concludes that exposure is safe or compliant. Every assessment carries three separate states, never merged into one traffic light:

| State | Set by | Values |
|---|---|---|
| Data quality | Engine | complete · qualified · incomplete · failed |
| Benchmark comparison | Engine | below · at or above · indeterminate · not comparable · no verified benchmark |
| Professional review | People | draft · in review · approved |

Separately, the screen and report show **method review status** (approved · approved with conditions · not reviewed · rejected) and **benchmark provenance** (professional reference · entered by organisation · synthetic). "Not calculated" results are shown as *insufficient evidence — not calculated*, never as a number.

The practitioner writes the interpretation, conclusion category and limitations. A second competent person approves them, recording scope and limitations. **"Exposure adequately controlled" can only be selected when data quality is complete or qualified and every formal result is below a verified benchmark.** It remains a professional judgement.

## 2. Conventions to confirm

| # | Convention as implemented | Why it matters | Decision |
|---|---|---|---|
| C1 | Air volume = arithmetic mean of pre- and post-sampling flow × sampled minutes. | Assumes flow changes linearly. | ☐ Accept ☐ Conditions ☐ Reject |
| C2 | Interruptions are subtracted from sampled time; overlapping interruptions are merged first. | Pump-off time must not count. | ☐ ☐ ☐ |
| C3 | Flow drift is flagged against the tolerance recorded on each method version. **No universal default** — with none recorded the result is flagged "tolerance undefined". | Method-specific acceptance. | ☐ ☐ ☐ |
| C4 | A non-detect is carried as the interval **0 to the reporting limit**. Never zero, never LOD/2. | Avoids false low results; may give *indeterminate* near the benchmark. | ☐ ☐ ☐ |
| C5 | Below LOQ → **LOD (or 0) to LOQ**; over-range → **value to unbounded**. | Same principle as C4. | ☐ ☐ ☐ |
| C6 | 8-hour TWA = Σ(Cᵢ·Tᵢ) / 480 min, per worker per shift, personal samples only. Shifts over 8 h are still divided by 480. | Core long-term calculation. | ☐ ☐ ☐ |
| C7 | A shift is a worker's samples separated by gaps under 4 hours, labelled with the local date of the first sample (night shifts not split). **Overlapping samples for one worker make that worker-shift incomplete; no TWA is produced.** | Split/night shifts; double counting. | ☐ ☐ ☐ |
| C8 | Unsampled exposure time: **no TWA** unless the practitioner chooses *zero exposure* or *same as sampled* with a written justification (printed in the report). | No silent extrapolation. | ☐ ☐ ☐ |
| C9 | The exposure period entered must not be shorter than the longest duration recorded in the register for that group and substance; with no recorded duration the TWA is incomplete. | Stops unsampled time being dropped. | ☐ ☐ ☐ |
| C10 | Static samples are listed as context only and never compared with personal benchmarks. | Area ≠ personal exposure. | ☐ ☐ ☐ |
| C11 | Results are **indicative only** (excluded from formal comparison) when the instrument is screening-only, the method is not designated for formal assessment, no instrument is recorded, or calibration evidence is missing, expired or failed on the sampling date. | Traceable measurement chain. | ☐ ☐ ☐ |
| C12 | A failed QC check excludes the sample until a practitioner or reviewer records a disposition (invalidate, or accept with a ≥ 20-character justification). The person who recorded a disposition cannot approve that assessment. | Failed checks never silently become evidence. | ☐ ☐ ☐ |
| C13 | Any excluded or indicative personal result at or above the benchmark (or not convertible to its unit) turns a favourable comparison into *indeterminate*. | High readings cannot be outweighed silently. | ☐ ☐ ☐ |
| C14 | **Roll-up (changed in 1.3.1):** if any formal worker-shift cannot be calculated and no formal result is at or above the benchmark, the comparison is *indeterminate*; if only indicative results exist it is *not comparable*. | Uncalculable evidence leaves the question open. | ☐ ☐ ☐ |
| C15 | STEL: a sample of **14–16 minutes** gives the 15-minute value directly. Samples over 16 minutes, or spread over more than 16 minutes by pauses, are refused. | Longer averages dilute peaks. | ☐ ☐ ☐ |
| C16 | STEL: a sample under 14 minutes is used only if the practitioner chooses *zero for the rest of the 15 minutes* and justifies it; value = C × T / 15. | Confirm against current guidance. | ☐ ☐ ☐ |
| C17 | ppm ↔ mg/m³ uses 20 °C, 101.325 kPa (molar volume 24.0551 L/mol) and the substance's recorded molecular weight with its source. No conversion for fibres. | Confirm per jurisdiction. | ☐ ☐ ☐ |
| C18 | No statistical compliance test (e.g. BS EN 689) is performed; the interpretation must address representativeness. | Known limitation. | ☐ Acceptable for pilot ☐ Must be added first |
| C19 | No temperature/pressure correction of sampled air volume; no blank correction; laboratory uncertainty displayed but not propagated. | Known limitations. | ☐ Acceptable for pilot ☐ Must be added first |

## 3. Worked examples, expected results and tolerances

> **Updated for engine 1.4.0 (22 Oct 2026).** E2, E7b, E8 and E13 change intentionally (method acceptance, STEL remainder evidence, EH40 molar volume, below-LOQ semantics); the reasons are in `docs/remediation/remediation-summary.md` §4. Structured versions of every example, with exact inputs and independently derived expected values, are in `test/fixtures/worked-examples.fixtures.json`. Where the table below differs from the fixtures, the fixtures state the 1.4.0 behaviour put to you for confirmation.

**Tolerance:** hand results should agree with the expected value to **±0.1 % relative** (rounding: concentrations are stored to 6 significant decimals; displayed to 4 significant figures). Any larger difference is a finding. Categorical outcomes (state, flag, "not calculated") must match exactly.

Common inputs unless stated: personal sample, 08:00–16:00, flow 2.0 L/min before and after, calibrated pump, method flow tolerance 5 %, exposure period 480 min, unsampled-time assumption *none*, verified synthetic benchmark.

### 3a. Sampling and calculation

| # | Scenario | Inputs | Expected result |
|---|---|---|---|
| E1 | Full-shift sample | 300 µg; 480 min | 960 L → **0.3125 mg/m³**; 8-h TWA **0.3125 mg/m³** |
| E2 | Interruption and flow drift | 300 µg; 30-min pause; post-flow 1.8 L/min | 450 min × 1.9 L/min = 855 L → **0.350877 mg/m³**; flags *interrupted*, *flow drift 10 % > 5 %* |
| E3 | Two consecutive samples | A: 240 µg 08:00–12:00 → 0.5; B: 96 µg 12:00–16:00 → 0.2 | (0.5×240 + 0.2×240)/480 = **0.35 mg/m³** |
| E4 | **Partial shift** — half-shift sample, 480-min exposure | 240 µg, 08:00–12:00 → 0.5 mg/m³; coverage 50 % | No assumption: **no TWA** (*coverage incomplete*). Zero exposure (justified): **0.25**. Same as sampled (justified): **0.5 mg/m³** |
| E6 | 10-hour shift | 360 µg over 600 min (1200 L) → 0.3; exposure 600 min | 0.3 × 600/480 = **0.375 mg/m³** (*extended shift*) |
| E9 | **Overlapping samples** for one worker | A: 240 µg 08:00–12:00; B: 240 µg 11:00–16:00 | **No TWA** (*samples overlap*); data quality *incomplete*; comparison **indeterminate** — "1 worker-shift result could not be calculated" |

### 3b. Non-detects and qualified results

| # | Scenario | Inputs | Expected result |
|---|---|---|---|
| E5 | Non-detect | < LOD 10 µg; 960 L | Interval **0 – 0.010417 mg/m³**. Benchmark 0.05: *below*. Benchmark 0.005: *indeterminate* |
| E13 | Below LOQ | < LOQ; LOD 10 µg, LOQ 30 µg; 960 L | Interval **0.010417 – 0.03125 mg/m³**. Benchmark 0.02: *indeterminate*; data quality *qualified* |

### 3c. Calibration failures, static and screening restrictions, QC

| # | Scenario | Inputs | Expected result |
|---|---|---|---|
| E10a | **Calibration expired** on sampling date, result below benchmark | E1 inputs; pump calibration invalid; benchmark 1.0 | Concentration 0.3125 shown, **indicative**; comparison **not comparable** ("only indicative personal results … missing, expired or failed calibration") |
| E10b | Calibration expired, result above benchmark | As E10a; benchmark 0.2 | Comparison **indeterminate** — the indicative result is at or above the benchmark and must be explained |
| E10c | Calibration expired on one of two workers | W2: 96 µg (0.1, valid pump); W3: E10b | W2 below; overall **indeterminate** because of W3's indicative 0.3125 ≥ 0.2 |
| E11 | **Static sample only** | E1 inputs, sample type static | 0.3125 listed as context; **not compared**; comparison *not comparable* ("static results are not comparable with personal benchmarks") |
| E12 | **Screening-only instrument** | E1 inputs; instrument flagged screening-only; benchmark 1.0 | Indicative; comparison *not comparable* |
| E14 | Failed QC check without disposition | E1 inputs; one failed QC check | Sample excluded; data quality **failed**; "no usable personal results (all samples excluded or not calculable)" |

### 3d. Short-term and conversion

| # | Scenario | Inputs | Expected result |
|---|---|---|---|
| E7 | STEL, 15-min sample | 45 µg, 10:00–10:15 (30 L) | **1.5 mg/m³** |
| E7b | STEL, 10-min sample, zero-remainder assumption | 45 µg, 10 min (20 L) → 2.25 | 2.25 × 10/15 = **1.5 mg/m³** (flagged) |
| E8 | Unit conversion | 20 ppm, MW 92.14 g/mol | 20 × 92.14 / 24.0551 = **76.607 mg/m³** |

## 4. Sampling assumptions and restrictions (summary)

- **Personal vs static:** only personal samples produce exposure results; static and field blanks never do (C10).
- **Screening and calibration:** screening-only instruments, methods not designated for formal assessment, and missing/expired/failed calibration make a result indicative only; indicative results are never compared formally but are not ignored when high (C11, C13).
- **Unit conversion:** only ppm ↔ mg/m³, only with a recorded molecular weight and its source; the report states the conditions used (C17).
- **Non-detects:** always intervals; comparison may be indeterminate when the reporting limit is close to the benchmark (C4, C5). Ask the laboratory for lower limits or longer sampling where that matters.
- **Partial-shift and overlapping samples:** no extrapolation without a justified assumption; overlaps block the worker-shift (C7, C8).
- **Representativeness:** not assessed by software (C18).

## 5. Benchmark interpretation, example report and limitation statements

**Benchmark interpretation.** The comparison states only where the result interval lies relative to the benchmark value: *below* (whole interval below), *at or above* (whole interval at or above), *indeterminate* (interval straddles the value, or relevant evidence could not be calculated or is high but indicative), *not comparable* (different averaging period, unit not convertible, or only indicative/static evidence), *no verified benchmark*. Every output carries: "Calculated outputs and benchmark comparisons are not a compliance conclusion. Professional interpretation by a competent person is required." In a pilot organisation, conclusions can only be approved against **professional reference** benchmark versions (see `reference-data-workflow.md`); organisation-entered and synthetic values are for calculation and discussion only.

**Example report.** `docs/examples/example-report.synthetic.html` is an issued report from the demonstration organisation (synthetic data and benchmark). Please review its content and order. It shows: purpose and scope; group and grouping basis; sampling strategy and methods; **method review status** (currently "not reviewed — results are for discussion only"); calculation code and version; instruments and calibration; data quality findings; sample results with intervals and indicative tags; TWAs and comparisons; benchmark with source, verification and provenance; limitations; interpretation; conclusion category; actions; revision history; approval with scope, limitations and snapshot hash.

**Standard limitation statements generated by the software** (reviewers add their own):

| Situation | Statement |
|---|---|
| Every report | Calculated outputs and benchmark comparisons are not a compliance conclusion. Professional interpretation by a competent person is required. |
| Method not approved | Method review status: not reviewed — this calculation method has not been approved by a competent occupational hygienist. Results are for discussion only and must not be relied upon for conclusions. |
| Evaluation organisation | EVALUATION USE — this organisation is not operating under an authorised pilot. Outputs are not for reliance. |
| Synthetic benchmark | SYNTHETIC DEMONSTRATION VALUE — not a real exposure limit. |
| Unsampled-time assumption | The assumption chosen and the practitioner's justification, verbatim. |
| Non-detect | Carried as an interval from 0 to the reported limit; not replaced by zero. |
| Indicative result | Calibration … expired or failed at the sampling date / screening-only instrument; result treated as indicative only. |
| Indicative or excluded result above benchmark | N excluded or indicative result(s) (codes) are at or above the benchmark value; they must be explained before any favourable conclusion. |
| Conversion applied | Results were converted to mg/m³ at 20 °C and 101.325 kPa (molar volume 24.0551 L/mol) using molecular weight … g/mol. |
| Draft | DRAFT — not approved watermark and banner. |

## 6. Control effectiveness and closure rules

| Rule | As implemented |
|---|---|
| A corrective action cannot be closed on installation alone | Closure requires an **effectiveness review** with evidence; *installed* ≠ *effective* |
| Verification requirement | Each action records what evidence will verify it (e.g. post-control monitoring, LEV commissioning test); evidence is submitted as an inspection record |
| Separation of duties | The person who implemented the action cannot review its effectiveness or close it |
| Effectiveness outcomes | effective · partially effective · not effective; only *effective* allows *closed — verified* |
| Not effective / partially effective | Action returns to *assigned*; implementation and evidence links are cleared; the full history is kept in the action's event log |
| Exposure reassessment | Where an action is marked as requiring exposure reassessment, it can be judged effective only by linking an **approved** post-implementation assessment revision |
| Post-control monitoring | Compared with the baseline only when comparable (same group, substance, calculation, benchmark basis); the comparability check states why not otherwise |
| Stop control | Action closure can be suspended for an organisation under a pilot stop condition |

**Please confirm** these rules are adequate for the pilot, in particular what evidence should count as verification for LEV (e.g. commissioning and periodic thorough examination records) and whether repeat monitoring should be mandatory before closure for given action types.

## 7. Questions for you

1. Are other conventions needed before pilot (blank correction, T/P correction, uncertainty)?
2. For the pilot substances (chosen by the pilot organisation, not by us), which jurisdiction, benchmark type and edition apply? Will you verify the reference rows (`reference-data-workflow.md`)?
3. Which sampling and analytical methods will the pilot use, with what flow tolerance, flow range and minimum volume?
4. Is the example report acceptable in content and order?
5. Is the 4-hour gap for night-shift grouping (C7) suitable for the site's shift patterns?
6. Are the closure rules (section 6) sufficient?

## 8. Findings register

Software-correctness findings and methodological findings are recorded separately. Severity: **Critical** (could produce a wrong favourable conclusion), **High** (wrong number or state in common cases), **Medium** (wrong in edge cases or misleading wording), **Low** (presentation).

| ID | Type | Severity | Capability / version | Finding | Correction | Retest evidence | Reviewer disposition |
|---|---|---|---|---|---|---|---|
| H1-F01 | Software correctness (found while preparing this pack) | Medium | `twa_8h` 1.2.0, `stel_15` 1.1.0 | When every formal worker-shift was uncalculable (e.g. overlapping samples), the roll-up said *not comparable* instead of *indeterminate*, contrary to the specification; note wording blamed static or screening results for unrelated causes | Engine 1.3.1: `twa_8h` 1.2.1, `stel_15` 1.1.1 | `test/calc.test.ts` "engine 1.3.1 roll-up" (3 tests); examples E9, E10a, E14 regenerated | Awaiting reviewer |
| | Methodological | | | *(for the reviewer)* | | | |

Any convention marked *conditions* or *reject* becomes a finding, is corrected under a new method version, retested, and returned for disposition. Historical approved assessments keep the version they used.

## 9. Sign-off

Sign-off is by a named competent person, with a statement of competence. It is recorded by a platform operator from this signed document; it is not given by any software role.

| Item | Decision | Conditions, permitted scope, review/expiry date | Name and competence | Signature | Date |
|---|---|---|---|---|---|
| Conventions C1–C19 | | | | | |
| Worked examples E1–E14 checked | | | | | |
| `twa_8h` v1.3.0 | ☐ Approved ☐ With conditions ☐ Rejected | | | | |
| `stel_15` v1.2.0 | ☐ Approved ☐ With conditions ☐ Rejected | | | | |
| Unit conversion (engine 1.3.1) | ☐ Approved ☐ With conditions ☐ Rejected | | | | |
| Example report and limitation statements | | | | | |
| Control effectiveness and closure rules | | | | | |
| Suitable for a controlled pilot | ☐ Yes ☐ Yes, with conditions ☐ No | | | | |
