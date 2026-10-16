# Calculation and benchmark specifications

Engine: `src/calc/engine.ts`, engine version **1.1.0** (calculation `twa_8h` v1.1.0). Pure functions, no I/O, no AI. Every assessment revision stores `calc_code`, `calc_version`, the full input snapshot and a SHA-256 hash of the inputs. Tests: `test/calc.test.ts`.

> **Methodological sources must be confirmed by a competent occupational hygienist against the current editions before pilot use.** The references below identify the conventions the engine implements; they were not re-checked against the live publications during this build (no access was attempted), and no text from them is reproduced.

## 1. `sample_concentration` (engine 1.1.0)

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

**Limitations.** No correction for temperature/pressure. No ppm ↔ mg/m³ conversion (requires molecular weight and reference conditions; deferred). No blank correction (field blanks are excluded and listed). No measurement-uncertainty propagation; uncertainty reported by the laboratory is displayed but not used.

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
| No / expired / failed calibration on sampling date | qualify | included, flagged |
| Screening-only instrument or method not suitable for formal assessment | qualify | labelled *indicative*; excluded from formal benchmark comparison |
| Failed QC check without disposition | exclude | sample excluded, failure listed |
| Failed QC check, disposition *sample invalidated* | exclude | excluded, listed |
| Failed QC check, disposition *accepted with justification* | qualify | included, flagged |
| Field blank | exclude | not an exposure result |
| Sample voided | exclude | listed, never used |

## 2. `twa_8h` v1.1.0

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

**Limitations.** Overlapping samples on the same worker are not detected and would double count — a plan/QC responsibility in this release. No statistical treatment of between-worker or day-to-day variability (e.g. BS EN 689 compliance testing) — the professional interpretation must address representativeness. STEL (15-minute) calculation is **not** implemented; a benchmark with a non-480-minute averaging period returns *not comparable*.

## 3. Benchmark comparison

```
interval upper  <  benchmark  → below_benchmark
interval lower  ≥  benchmark  → at_or_above_benchmark
otherwise                      → indeterminate   (e.g. a non-detect whose LOD exceeds the benchmark)
units differ                   → not_comparable
```

Roll-up for the revision: any *at or above* → at_or_above; any indeterminate or incomplete worker-shift → indeterminate; any excluded or indicative personal result whose lower bound is at or above the benchmark → indeterminate (named in the note); only indicative or static evidence → not_comparable; no benchmark or benchmark not *verified* → no_verified_benchmark.

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

- **No real exposure limits are loaded.** The only platform benchmark is `DEMO LTEL 0.5 mg/m³` for the synthetic substance *Demo Dust X*, flagged `is_synthetic` and labelled on every screen and report.
- Unverified versions cannot be used for comparison.
- The approved revision stores `benchmark_version_id` inside its frozen snapshot. A later verified version, or withdrawal of the used version, raises a *reassessment may be required* notice on the assessment; the approved conclusion and its report are unchanged (tested).
- Before populating production data, verify the current authoritative source and check reproduction rights for any proprietary limit database (see external dependency register).

## 6. Test cases

`test/calc.test.ts` (30 cases) and the calculation section of `test/review-regressions.test.ts` (4 cases: night shift, overlapping interruptions, high indicative/excluded results, exposure-period guard) cover, with hand-calculated expected values: volume and concentration (120 µg, 2.0 L/min, 240 min → 0.25 mg/m³); interruption subtraction (210 min); non-detect interval (upper = 5 µg / 0.48 m³); non-detect without limit → incomplete; over-range → ∞; missing flow/duration/invalid duration; flow drift and undefined tolerance; QC fail unresolved/accepted; screening instrument; missing calibration; unit/basis mismatch; µg/m³ conversion; consecutive-sample TWA (0.175 mg/m³); incomplete coverage with no assumption; unjustified assumption; zero and same-as-sampled assumptions (0.125, 0.25); 600-minute shift (0.125); missing exposure period; static exclusion; all four comparison states; unverified benchmark; no verdict field; static-only; screening-only; all-excluded → failed; partial incomplete → indeterminate; averaging-period mismatch; determinism; before/after comparability.
