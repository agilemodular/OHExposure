# Occupational hygiene review pack

**For:** the competent occupational hygienist reviewing the platform before a controlled pilot (dependency D1).
**Engine:** 1.3.0 — `twa_8h` v1.2.0, `stel_15` v1.1.0. **Prepared:** 17 October 2026.

## What we are asking you to do

1. Check each convention in section 2 and mark it **Accept**, **Accept with change** or **Reject**.
2. Check the worked examples in section 3 by hand. Each value was produced by the engine itself, not typed in.
3. Sign section 5. Until it is signed, the platform must not be used for real exposure decisions.

Everything here uses synthetic inputs. No real exposure limits are loaded. Full detail is in `calculation-and-benchmark-specifications.md` and `safety-rule-register.md`.

## 1. What the software does and does not decide

The software calculates and flags. It never concludes that exposure is safe or compliant. Every assessment carries three separate states:

| State | Set by | Values |
|---|---|---|
| Data quality | Engine | complete · qualified · incomplete · failed |
| Benchmark comparison | Engine | below · at or above · indeterminate · not comparable · no verified benchmark |
| Professional review | People | draft · in review · approved |

The practitioner writes the interpretation, conclusion and limitations. A second competent person approves them, recording scope and limitations. **"Exposure adequately controlled" can only be selected when data quality is complete or qualified and every formal result is below a verified benchmark.** It is still a professional judgement, not an automatic outcome.

## 2. Conventions to confirm

| # | Convention as implemented | Why it matters | Your decision |
|---|---|---|---|
| C1 | Air volume = arithmetic mean of pre- and post-sampling flow × sampled minutes. | Assumes flow changes linearly. | ☐ Accept ☐ Change ☐ Reject |
| C2 | Interruptions are subtracted from sampled time; overlapping interruptions are merged first. | Pump-off time must not count. | ☐ ☐ ☐ |
| C3 | Flow drift is flagged against the tolerance recorded on each method version. **No universal default** — if a method has none, the result is flagged "tolerance undefined". | Method-specific acceptance. | ☐ ☐ ☐ |
| C4 | A non-detect is carried as the interval **0 to the reporting limit**. It is never set to zero and no single substitute value (e.g. LOD/2) is used. | Avoids false low results; may give *indeterminate* when the limit is near the benchmark. | ☐ ☐ ☐ |
| C5 | A result below the LOQ is carried as **LOD (or 0) to LOQ**; over-range as **value to unbounded**. | Same principle as C4. | ☐ ☐ ☐ |
| C6 | 8-hour TWA = Σ(Cᵢ·Tᵢ) / 480 min, per worker per shift, personal samples only. Shifts longer than 8 h are still divided by 480, which raises the TWA. | Core long-term calculation. | ☐ ☐ ☐ |
| C7 | A shift is a worker's samples on the same local date, extended across midnight when the gap is under 4 hours (night shifts). | Split shifts and night shifts. Overlapping samples make the shift incomplete. | ☐ ☐ ☐ |
| C8 | If exposure time is not fully sampled, **no TWA is produced** unless the practitioner chooses *zero exposure* or *same as sampled* for the unsampled time and writes a justification (printed in the report). | No silent extrapolation. | ☐ ☐ ☐ |
| C9 | The exposure period entered must not be shorter than the longest duration recorded in the register for that group and substance; if no duration is recorded, the TWA is incomplete. | Stops unsampled time being dropped by under-stating the period. | ☐ ☐ ☐ |
| C10 | Static samples are listed as context only and never compared with personal benchmarks. | Brief requirement. | ☐ ☐ ☐ |
| C11 | Results are **indicative only** (excluded from formal comparison) when the instrument is screening-only, the method is not designated for formal assessment, no instrument is recorded, or calibration evidence is missing, expired or failed on the sampling date. | Formal evidence needs a traceable measurement chain. | ☐ ☐ ☐ |
| C12 | A failed QC check excludes the sample until a practitioner or reviewer records a disposition (invalidate, or accept with a ≥ 20-character justification). The reviewer who recorded a disposition cannot approve that assessment. | Failed checks never silently become evidence. | ☐ ☐ ☐ |
| C13 | Any excluded or indicative personal result at or above the benchmark (or that cannot be converted to the benchmark's unit) turns a favourable comparison into *indeterminate*. | High readings cannot be outweighed silently. | ☐ ☐ ☐ |
| C14 | STEL: a sample of **14–16 minutes** gives the 15-minute value directly. Samples over 16 minutes, or spread over more than 16 minutes by pauses, are refused. | Longer averages dilute peaks. | ☐ ☐ ☐ |
| C15 | STEL: a sample under 14 minutes is used only if the practitioner chooses *zero for the rest of the 15 minutes* and justifies it; the value is C × T / 15. | Needs your confirmation against current guidance. | ☐ ☐ ☐ |
| C16 | ppm ↔ mg/m³ conversion uses 20 °C and 101.325 kPa (molar volume 24.0551 L/mol) and the substance's recorded molecular weight with its source. No conversion for fibres. | Reference conditions for GB limits; confirm per jurisdiction. | ☐ ☐ ☐ |
| C17 | No statistical compliance test (e.g. BS EN 689) is performed. The interpretation must address how representative the samples are. | Known limitation for this release. | ☐ Acceptable for pilot ☐ Must be added first |

## 3. Worked examples

Common inputs unless stated: personal sample, 08:00–16:00, flow 2.0 L/min before and after, calibrated pump, method tolerance 5 %. Check each "Engine output" by hand.

| # | Scenario | Inputs | Engine output |
|---|---|---|---|
| E1 | Full-shift sample | 300 µg; 480 min | 960 L → **0.3125 mg/m³**; 8-h TWA **0.3125 mg/m³** |
| E2 | Interruption and flow drift | 300 µg; 30-min pause; post-flow 1.8 L/min | 450 min, mean 1.9 L/min → 855 L → **0.350877 mg/m³**; flagged *interrupted* and *flow drift 10 % > 5 %* |
| E3 | Two consecutive samples | A: 240 µg, 08:00–12:00 → 0.5 mg/m³; B: 96 µg, 12:00–16:00 → 0.2 mg/m³ | (0.5×240 + 0.2×240) / 480 = **0.35 mg/m³** |
| E4 | Half-shift sample, 480-min exposure | 240 µg, 08:00–12:00 → 0.5 mg/m³; 50 % coverage | No assumption: **no TWA** (*coverage incomplete*). Zero exposure: **0.25 mg/m³**. Same as sampled: **0.5 mg/m³** |
| E5 | Non-detect | < LOD 10 µg; 960 L | Interval **0 – 0.010417 mg/m³**. Against a 0.05 benchmark: *below*. Against 0.005: *indeterminate* |
| E6 | 10-hour shift | 360 µg over 600 min (1200 L) → 0.3 mg/m³; exposure 600 min | 0.3 × 600 / 480 = **0.375 mg/m³** (flagged *extended shift*) |
| E7 | STEL, 15-min sample | 45 µg, 10:00–10:15 (30 L) | **1.5 mg/m³** |
| E7b | STEL, 10-min sample with zero-remainder assumption | 45 µg, 10 min (20 L) → 2.25 mg/m³ | 2.25 × 10 / 15 = **1.5 mg/m³** (flagged) |
| E8 | Conversion | 20 ppm, molecular weight 92.14 g/mol | 20 × 92.14 / 24.0551 = **76.607 mg/m³** |

Hand checks on cases like these by two independent software reviewers all matched (see `test-evidence.md`). They do not replace your professional check.

## 4. Questions for you

1. Are there other conventions your practice uses (e.g. blank correction, temperature/pressure correction of air volume, uncertainty propagation) that must be added before pilot?
2. For the pilot substances, which jurisdiction, benchmark type and edition should be entered? Who will verify them as the second person?
3. Which sampling and analytical methods will the pilot use, and what flow tolerance, flow range and minimum volume apply to each?
4. Is the report template (sample report in the demo tenant) acceptable in content and order? What must change?
5. Is the 4-hour gap for night-shift grouping (C7) suitable for the pilot site's shift patterns?

## 5. Sign-off

| Item | Decision | Conditions | Name | Signature | Date |
|---|---|---|---|---|---|
| Conventions C1–C17 | | | | | |
| Worked examples E1–E8 checked | | | | | |
| Report template | | | | | |
| Suitable for a controlled pilot | ☐ Yes ☐ Yes, with conditions ☐ No | | | | |

Any convention marked *change* or *reject* is recorded as a defect, fixed, re-tested and returned for a further check before the pilot starts.
