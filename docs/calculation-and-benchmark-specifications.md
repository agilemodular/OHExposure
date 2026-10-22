# Calculation and benchmark specifications

Engine: `src/calc/engine.ts`, engine version **1.4.0** (calculations `twa_8h` **v1.3.0** and `stel_15` **v1.2.0**). Pure functions, no I/O, no AI. Every assessment revision stores `calc_code`, `calc_version`, the full input snapshot and a SHA-256 hash of the inputs. Tests: `test/calc.test.ts`, `test/worked-examples.test.ts` (structured fixtures with independently derived expected values), `test/tr-services.test.ts`.

**§0 below states the 1.4.0 rules and takes precedence.** Sections 1–6 describe the 1.3.1 design; where §0 changes a rule, §0 applies. No method version has a professional approval; 1.4.0 approvals are not transferred from 1.3.1 (approvals are recorded per version).

## 0. Engine 1.4.0 (technical review of commit ceec79f, TR-01–TR-05 and items A–D)

### 0.1 Authoritative references checked (22 October 2026)

| Reference | What it supports here | Where used |
|---|---|---|
| HSE, *EH40/2005 Workplace exposure limits*, 4th edition 2020, ISBN 978 0 7176 6703 1 (https://www.hse.gov.uk/pubns/priced/eh40.pdf) — Schedule, Part 1, para 2 | 8-h TWA = (C₁T₁ + … + CₙTₙ)/8 h | `twa_8h` |
| EH40/2005 (2020), para 66 and Schedule para 8 | STEL averaging period normally 15 min, "any 15-minute period throughout the working shift"; exposure "should be recorded as the average over the specified short-term reference period … and should be determined by sampling over that period" | `stel_15` (no sampling tolerance; shorter samples need a documented assumption) |
| EH40/2005 (2020), para 68 | mg/m³ = ppm × MW / 24.05526; 24.05526 L/mol is the molar volume at 20 °C and 1 atm | Unit conversion |
| HSE, *MDHS14/4 General methods for sampling and gravimetric analysis of respirable, thoracic and inhalable aerosols* (June 2014), paras 48–63 | Flow set within ±0.1 L/min; for cyclone samplers "the sample is invalid if the final flow rate differs by more than 0.1 l.min⁻¹ or 5% (whichever is larger) from the initial flow rate"; if valid, the recommended flow rate is used as the mean | Method acceptance consequences (an example of "invalid"); volume basis is a reviewer question |
| BS EN 689:2018+AC:2019 *Workplace exposure — Measurement of exposure by inhalation to chemical agents — Strategy for testing compliance with occupational exposure limit values* | Representativeness and statistical compliance testing (not implemented; professional judgement) | Limitation statements |

EH40 gives **no** method for short-term results from samples shorter or longer than 15 minutes. The zero-remainder assumption and any sampling tolerance are therefore conventions that need professional approval; they are kept restricted (see 0.3).

### 0.2 Numerical approach (TR-04)

- Every quantity (duration, volume, concentration, interval bounds, conversions, time weighting, ratios) is computed in IEEE-754 double precision with **no intermediate rounding**.
- Benchmark comparison uses a relative tolerance of 1 × 10⁻⁹, applied conservatively: *below* only if upper < value × (1 − 10⁻⁹); *at or above* if lower ≥ value × (1 − 10⁻⁹). A result equal to the benchmark is *at or above*.
- Numerical timestamp tolerance: 0.1 s, to absorb floating-point error only. It is **not** an occupational-hygiene sampling tolerance (see 0.3).
- Display only: 4 **significant figures** (not decimal places); values below 0.001 or of 10⁶ and above in scientific notation; a positive value is never shown as 0. Ratios to the benchmark are displayed the same way.
- Unbounded upper results (over-range) carry `upper = Infinity` and `upperUnbounded: true`; stored JSON writes `"Infinity"`, never `null`.

### 0.3 `stel_15` v1.2.0 timing (TR-01)

Sampled time T (running time), elapsed window W (start to end) and reference period (15 min) are distinct.

| Case | Result |
|---|---|
| T = 15 min, uninterrupted (W = T) | Measured concentration is the 15-minute result |
| T > 15 min | **No result** (STEL_SAMPLE_TOO_LONG). The average over a longer period cannot establish the highest 15-minute exposure and is not scaled by T/15 |
| Interrupted, W > 15 min | **No result** (STEL_WINDOW_TOO_LONG) |
| T < 15 min, or interrupted within 15 min | Only with the zero-remainder assumption, a justification **and** supporting evidence (continuous observation, a direct-reading instrument record, or a process record, with a reference). Completion of the task alone is not evidence. Result C × T / 15, marked **assumption-dependent**, with a short-peak limitation note |

Sampling tolerance: **0 min** (`STEL_SAMPLING_TOLERANCE_MIN`). A non-zero tolerance would be a methodological convention requiring a new method version and professional approval.

### 0.4 Laboratory qualifiers (item C)

| Interpreted qualifier | Meaning | Interval |
|---|---|---|
| `=` | Quantified result | [v, v] |
| `estimated` | Estimated quantitative result (laboratory says so) | [v, v], qualified |
| `<LOD` | Not detected | [0, max(reported limit, LOD)] |
| `<LOQ` | Less than LOQ; **detection not confirmed** (even when an LOD is supplied) | [0, max(reported value, LOQ)] |
| `detected_below_loq` | Laboratory confirms detection between LOD and LOQ | [LOD, LOQ]; needs LOD < LOQ |
| `>` | Over range | [v, ∞), upper bound unknown |

When a reported "<" value and the stated limit differ, the larger bounds the result and the difference is flagged (LIMIT_VALUE_DIFFERS). The laboratory's own qualifier text is stored and shown beside the interpretation. CSV mapping: `ND`, `n.d.`, `not detected`, `<DL` → `<LOD`; `<LOR`, `below LOQ` → `<LOQ`; `DET<LOQ`, `detected <LOQ`, `detected below LOQ`, `trace` → `detected_below_loq`; unrecognised text is rejected.

### 0.5 Input validation (TR-03)

Engine and boundaries both check: finite numbers; value, LOD and LOQ ≥ 0; LOD ≤ LOQ; recognised units and qualifiers; flows > 0; valid timestamps; interval lower ≤ upper; benchmark value > 0, averaging period > 0, recognised unit; exposure period > 0 and ≤ 24 h. Invalid input gives no numeric result and an `INPUT_INVALID_*` flag with the specific reason; the submitted record is kept for correction and audit. Boundaries: laboratory entry and CSV import (`lab.ts`), field capture (`field.ts`), method versions (`instruments.ts`), tasks (`register.ts`), benchmark entry (`assessments.ts`); database check `lab_result_values_valid` (migration 026).

### 0.6 Method acceptance consequences (TR-05)

Each method version states, per criterion (flow drift beyond tolerance; air volume below minimum), one of:

| Consequence | Effect |
|---|---|
| `advisory` | Result kept, qualified |
| `disposition_required` | Sample excluded until a **technical reviewer** records a disposition naming the criterion, supporting evidence (≥ 10 characters) and scope; then kept, qualified |
| `invalid` | Sample excluded; no disposition can override it |
| not stated | Treated as `disposition_required` and flagged ACCEPTANCE_RULE_UNDEFINED (professional review dependency) |

Dispositions: `sample_acceptance_dispositions` (append-only; database requires an active technical reviewer as the signed-in user).

### 0.7 Shift association (item A) and exposure duration (item B)

- A sample can carry an explicit **shift reference**. Samples with the same worker and shift reference form one shift. Without references, samples are grouped by local start date only when unambiguous; a sample crossing midnight, samples within 16 h of a sample on another date, or a mix of referenced and unreferenced samples give SHIFT_ASSOCIATION_REQUIRED (no result). No silent merging or splitting.
- The register supplies one record per task linked to the group and substance (hazard duration where stated, else task duration; optional typical start and end within the shift). Timed records are combined as a union (overlaps counted once), and a record's stated minutes still bound the total if they exceed its times (flagged as inconsistent); untimed records give a range from the longest (full overlap) to the sum (sequential). Entered exposure below the lower bound → no TWA; within an unknown-overlap range → qualified; estimated durations → qualified.

### 0.8 Evidence disposition and the decision table (TR-02, item D)

Status axes are kept separate: **calculation availability** (complete, partial, none), **evidence adequacy** (adequate, adequate with accepted gaps, unresolved evidence, coverage gap, no formal evidence), **numerical comparison** per result, overall **benchmark state**, and the **professional conclusion** (people only).

A personal sample that is excluded, indicative or not calculable needs a disposition before a favourable overall comparison: `duplicate` (names another valid formal sample of the **same worker and shift** in the revision), `outside_scope` (technical reviewer only), `not_replaced` (worker or task remains unassessed), or `remaining_coverage_adequate` (technical reviewer only). Each needs a reason and an assessment of consequences (≥ 10 characters each). Recorded on draft revisions only, append-only, in `assessment_evidence_dispositions`. Every set-aside sample is listed with who set it aside and why, in the comparison note and the report.

| Situation | Overall benchmark state |
|---|---|
| No benchmark, or benchmark not verified | no verified benchmark |
| Benchmark invalid (value ≤ 0, unknown unit) | not comparable |
| Averaging period differs | not comparable |
| Any formal result at or above | **at or above** (valid adverse evidence stands regardless of other evidence) |
| All formal results below, all evidence formal or dispositioned (duplicate, outside scope) | below |
| All formal results below, gap accepted by a reviewer (remaining coverage adequate) | below (note states the accepted gap) |
| All formal results below, but unresolved evidence or a coverage gap (not replaced) | **indeterminate** |
| All formal results below, but some formal worker-shift results could not be calculated | indeterminate |
| Any formal result spans the benchmark (interval) or is not convertible, others below | indeterminate |
| Every formal result not comparable (unit) | not comparable |
| No formal results; some formal results could not be calculated | indeterminate |
| No formal results; excluded or indicative evidence could be at or above (upper bound ≥ benchmark, unknown, or unconvertible) | indeterminate (not proof either way) |
| No formal results; only indicative or excluded evidence wholly below | not comparable |
| Static samples only | not comparable |

> **Methodological sources must be confirmed by a competent occupational hygienist against the current editions before pilot use.** The references below identify the conventions the engine implements; they were not re-checked against the live publications during this build (no access was attempted), and no text from them is reproduced.

## Capability matrix (Phase H1)

One row per calculation capability. **Pilot-enabled** is enforced on the server: in an organisation at *pilot* assurance level, an assessment revision can be submitted or approved only if its calculation version has a recorded professional approval (`method_reviews`, written only by a platform operator from signed evidence) and its benchmark version is professionally verified reference data. The live status is shown on **Reference data → Calculation methods** and on every assessment and report. Historical versions are preserved: each approved revision freezes `calc_code`, `calc_version`, `method_review_status` and `benchmark_provenance`, and a later change of review status never alters it.

| Capability | `sample_concentration` | `twa_8h` | `stel_15` | Unit conversion |
|---|---|---|---|---|
| Version | engine 1.4.0 | **1.3.0** | **1.2.0** | engine 1.4.0 |
| Purpose | Airborne concentration of one sample, as an interval | Personal 8-h TWA per worker-shift vs 480-min benchmark | Personal 15-min result vs 15-min benchmark | ppm ↔ mg/m³ at comparison |
| Formula / source | §1; mass ÷ (mean flow × sampled time) | §2; Σ(CᵢTᵢ)/480 — GB convention (HSE EH40, HSG173) *to be confirmed* | §2a and §0.3; C for exactly 15 min uninterrupted; C×T/15 only with justified and evidenced zero remainder (assumption-dependent) | §3a and §0.1; mg/m³ = ppm × MW / 24.05526 (EH40 para 68) |
| Inputs | Times, interruptions, flows, method version, instrument, calibration, QC, lab result revision | Concentrations, worker refs, exposure minutes, unsampled assumption + justification, register durations | Concentrations, short-sample assumption + justification | Interval, target unit, molecular weight + source |
| Units / conversion | µg, mg on sample; µg/m³→mg/m³; ppm, f/ml passed through | Interval unit of inputs; mixed units → not calculated | As TWA | ppm, mg/m³ only; never f/ml |
| Averaging | — | 480 min (longer shifts still ÷480) | 15 min exactly (no sampling tolerance) | — |
| Missing / unsampled data | Missing times, flows, limits → incomplete | No TWA unless justified assumption; exposure period guard | < 15 min without evidenced assumption → not calculated; > 15 min refused | No MW → not comparable |
| Non-detects | Intervals [0, LOD], [0, LOQ] (generic <LOQ), [LOD, LOQ] (confirmed detection), [v, ∞) (§0.4) | Bounds propagate separately | Bounds propagate | Both bounds converted |
| Key limitations | No T/P correction, blank correction or uncertainty propagation | No BS EN 689 statistics; representativeness not assessed | Short-sample convention needs confirmation | 20 °C/101.325 kPa only |
| Test evidence | `test/calc.test.ts`, regressions | `calc.test.ts` (incl. 1.3.1 roll-up), workflow, assurance tests | `calc.test.ts`, STEL service test | `calc.test.ts` |
| Professional review status | Not reviewed | **Not reviewed** | **Not reviewed** | Not reviewed |
| Pilot-enabled | No (part of `twa_8h`/`stel_15` approval) | **No** | **No** | No (part of calculation approval) |

How a value is displayed when it is not a number:

| Display | Meaning |
|---|---|
| *insufficient evidence — not calculated* | Inputs missing or rules prevent a result (coverage, overlap, unjustified assumption, missing limit) |
| *Method not reviewed* / *Method rejected* | Calculation ran but its version has no professional approval; in pilot organisations it cannot support a conclusion |
| *not compared* / *not comparable* | Indicative or static result, unit or averaging mismatch |
| *No verified benchmark* | No benchmark selected, or not verified |
| *Entered by organisation* / *Synthetic* / *Professional reference* | Benchmark provenance; only professional reference can support pilot conclusions |

## 1. `sample_concentration` (engine 1.3.1)

**Intended use.** Convert one laboratory result for one sample into an airborne concentration, carried as an interval so qualified results are never turned into false point values.

**Inputs.** Sample type; start/end (UTC, with the local time zone retained); interruptions; pre- and post-sampling flow (L/min); method version (result basis, flow drift tolerance %, minimum volume, suitability for formal assessment); instrument (screening-only flag, calibration validity on the sampling date); QC checks with dispositions; current result revision (value, unit, qualifier, LOD, LOQ).

**Formula** (mass-on-sample methods):

```
sampled minutes  T = (end − start) − |∪ interruptions ∩ [start, end]|   (overlapping interruptions merged first)
mean flow        Q = (Q_pre + Q_post) / 2                         L/min
air volume       V = Q × T                                        L
concentration    C = m[mg] / (V / 1000)                           mg/m³     (µg are divided by 1000)
flow drift       D = |Q_post − Q_pre| / Q_pre × 100               %
```

Direct-concentration results in µg/m³ are converted to mg/m³; ppm and f/ml are passed through unchanged.

**Qualifiers → interval [lower, upper].**

| Qualifier | Interval | Point value |
|---|---|---|
| `=` | [v, v] | yes |
| `estimated` | [v, v], flagged *qualify* | yes, qualified |
| `<LOD` | [0, LOD or reported "<" value] | **no** — never replaced by zero or by LOD/2 |
| `<LOQ` | [LOD or 0, LOQ] | no |
| `>` (over range) | [v, ∞) | no |

**Assumptions.** Flow changes linearly so the arithmetic mean represents the sampling period. Interruptions are periods when the pump was not sampling.

**Limitations.** No correction of sampled air volume for temperature/pressure. Unit conversion is applied only at benchmark comparison (§3a). No blank correction (field blanks are excluded and listed). No measurement-uncertainty propagation; uncertainty reported by the laboratory is displayed but not used.

**Validation rules → outcome.**

| Condition | Severity | Effect |
|---|---|---|
| Missing start/end, end ≤ start, invalid interruption | incomplete | no concentration |
| Missing either flow (mass methods) | incomplete | no concentration |
| Result unit contradicts method basis | incomplete | no concentration |
| Non-detect with no limit; `<LOQ` with no LOQ | incomplete | no concentration |
| Flow drift above method tolerance | qualify | included, flagged |
| Method has no flow tolerance defined | qualify | included, flagged (no universal default is assumed) |
| Volume below method minimum | qualify | included, flagged |
| No instrument, or no / expired / failed calibration on sampling date | qualify | labelled *indicative*; excluded from formal benchmark comparison |
| Screening-only instrument or method not suitable for formal assessment | qualify | labelled *indicative*; excluded from formal benchmark comparison |
| Failed QC check without disposition | exclude | sample excluded, failure listed |
| Failed QC check, disposition *sample invalidated* | exclude | excluded, listed |
| Failed QC check, disposition *accepted with justification* | qualify | included, flagged |
| Field blank | exclude | not an exposure result |
| Sample voided | exclude | listed, never used |

## 2. `twa_8h` v1.2.1

**Intended use.** Personal 8-hour time-weighted average per worker per shift date, for comparison with a long-term (480-minute) benchmark. Convention as used for GB workplace exposure limits (HSE EH40, *Workplace exposure limits*; sampling strategy guidance in HSE HSG173) — to be confirmed by the reviewing hygienist.

**Formula.**

```
TWA₈ = ( Σ Cᵢ·Tᵢ  +  C_u·T_u ) / 480 min
```

Samples are grouped by worker reference into shifts: consecutive samples separated by gaps of less than 240 minutes form one shift, so night shifts crossing midnight are not split. The shift is labelled with the local date of its first sample. Overlapping samples for one worker make the shift *incomplete*. If the exposure period entered is shorter than the longest duration recorded in the register for that group and substance, the shift is *incomplete* (unsampled time cannot be dropped by under-stating the period). `E` = exposure minutes per shift for the group (recorded from task data and entered on the revision). Unsampled exposure `T_u = max(0, E − ΣTᵢ)`.

| Unsampled-time assumption | C_u | Requirement |
|---|---|---|
| `none` (default) | — | if `T_u` > 0.5 min, **no TWA is produced**; result *incomplete* |
| `zero_exposure` | 0 | written justification ≥ 20 characters, printed in the report |
| `same_as_sampled` | time-weighted mean of sampled concentration | written justification ≥ 20 characters; flagged *extrapolated* |

Intervals propagate: lower and upper bounds are calculated separately. Exposure longer than 480 minutes is still divided by 480 (flagged *extended shift*), so long shifts increase the TWA rather than being truncated.

**Not calculated:** static samples (listed as contextual evidence only); excluded samples; any worker-shift containing a sample with no calculable concentration or mixed units.

**Limitations.** No statistical treatment of between-worker or day-to-day variability (e.g. BS EN 689 compliance testing) — the professional interpretation must address representativeness. A benchmark whose averaging period is not 480 minutes returns *not comparable* for this calculation; use `stel_15` for 15-minute benchmarks.

## 2a. `stel_15` v1.1.1

**Intended use.** Personal short-term (15-minute reference period) results for comparison with a 15-minute benchmark. Each personal sample intended as a short-term measurement gives one result.

| Sampled time T | Result |
|---|---|
| 14–16 min | C (the measured concentration) |
| < 14 min, assumption *none* (default) | not calculated — *incomplete* |
| < 14 min, assumption *zero_remainder* with ≥ 20-character justification | C × T / 15, flagged *qualify* |
| > 16 min | not calculated — a longer average dilutes peaks (*incomplete*) |
| Elapsed window > 16 min (e.g. 15 sampled minutes spread over an hour by interruptions) | not calculated (*incomplete*) |

The short-sample convention (averaging over 15 minutes assuming no exposure for the remainder) must be confirmed by the reviewing hygienist against current guidance before use.

## 3a. Unit conversion (ppm ↔ mg/m³)

Applied only when a result and the benchmark use different units and the substance has a recorded molecular weight (with its source):

```
mg/m³ = ppm × MW / Vm        Vm = R·T/P = 8.314462618 × 293.15 / 101.325 = 24.0551 L/mol  (20 °C, 101.325 kPa)
```

Both interval bounds are converted. No conversion for fibres (f/ml). Without a molecular weight the comparison is *not comparable*. The note on the revision and the report states that conversion was applied and the values used. The reference conditions are those used for GB limits and must be confirmed per jurisdiction.

## 3. Benchmark comparison

```
interval upper  <  benchmark  → below_benchmark
interval lower  ≥  benchmark  → at_or_above_benchmark
otherwise                      → indeterminate   (e.g. a non-detect whose LOD exceeds the benchmark)
units differ                   → not_comparable
```

Roll-up for the revision: any *at or above* → at_or_above; every formal result *not comparable* → not_comparable; any indeterminate or incomplete worker-shift → indeterminate (since 1.3.1 also when **no** formal result could be calculated — previously reported as not comparable, finding H1-F01); any excluded or indicative personal result whose lower bound is at or above the benchmark, or that cannot be converted to the benchmark unit → indeterminate (named in the note); only indicative or static evidence → not_comparable; no benchmark or benchmark not *verified* → no_verified_benchmark.

The output always carries the statement that a benchmark comparison is not a compliance conclusion. There is no "safe" or "compliant" field anywhere in the model (asserted in tests).

## 4. Assessment states (never merged)

| Axis | Values | Set by |
|---|---|---|
| Data quality | complete · qualified · incomplete · failed | engine |
| Benchmark comparison | below · at or above · indeterminate · not comparable · no verified benchmark | engine |
| Professional review | draft · in review · approved · superseded · withdrawn | people |
| Conclusion category | insufficient evidence · improvement required · urgent action required · exposure adequately controlled | reviewer-approved interpretation |

Guard: *exposure adequately controlled* can only be submitted or approved when data quality is *complete/qualified* **and** the comparison is *below benchmark*.

## 5. Benchmark and jurisdiction management

Each benchmark version records substance, jurisdiction, type, averaging period, value, unit, annotations, source title and edition, URL, effective dates and verification status (`unverified → verified | withdrawn`, verified by a second person).

- **No real exposure limits are loaded.** The only platform benchmark is `DEMO LTEL 0.5 mg/m³` for the synthetic substance *Demo Dust X*, flagged `is_synthetic`, provenance *synthetic*, and labelled on every screen and report.
- Platform reference data can only be added through the controlled import (`scripts/import-reference-data.ts`, see `reference-data-workflow.md`). Rows marked *professional reference* must name the reviewer, verification date, source URL, permitted use and licence note; the database refuses incomplete rows.
- Unverified versions cannot be used for comparison.
- The approved revision stores `benchmark_version_id` inside its frozen snapshot. A later verified version, or withdrawal of the used version, raises a *reassessment may be required* notice on the assessment; the approved conclusion and its report are unchanged (tested).
- Before populating production data, verify the current authoritative source and check reproduction rights for any proprietary limit database (see external dependency register).

## 6. Test cases

`test/calc.test.ts` (37 cases, including STEL and conversion) and the calculation section of `test/review-regressions.test.ts` (4 cases: night shift, overlapping interruptions, high indicative/excluded results, exposure-period guard) cover, with hand-calculated expected values: volume and concentration (120 µg, 2.0 L/min, 240 min → 0.25 mg/m³); interruption subtraction (210 min); non-detect interval (upper = 5 µg / 0.48 m³); non-detect without limit → incomplete; over-range → ∞; missing flow/duration/invalid duration; flow drift and undefined tolerance; QC fail unresolved/accepted; screening instrument; missing calibration; unit/basis mismatch; µg/m³ conversion; consecutive-sample TWA (0.175 mg/m³); incomplete coverage with no assumption; unjustified assumption; zero and same-as-sampled assumptions (0.125, 0.25); 600-minute shift (0.125); missing exposure period; static exclusion; all four comparison states; unverified benchmark; no verdict field; static-only; screening-only; all-excluded → failed; partial incomplete → indeterminate; averaging-period mismatch; determinism; before/after comparability.
