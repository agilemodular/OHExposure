# OHEA re-review package — engine 1.5.1 (TR-06, TR-07, R5 re-check fixes)

**Responds to:** two findings on re-review package `9b87c17` (engine 1.4.0), supplied with the brief of 22 October 2026: duplicate-evidence dispositions (TR-06) and contradictory `detected_below_loq` inputs (TR-07).
**Engine:** 1.4.0 → 1.5.0 → **1.5.1** · **Methods:** `twa_8h` 1.3.0 → **1.4.1**, `stel_15` 1.2.0 → **1.3.1** · **Migrations:** 028, 029 (schema now 001–029). **Supersedes** the 1.5.0 package of commit `808f76b`: a re-check by a separate AI review agent (R5) found that 1.5.0 did not fully close TR-06 (findings register §7.3); everything here is re-run on 1.5.1. · Commit, versions and checksums: `07-identifiers/identifiers.json`, `MANIFEST.sha256`.

> **Not a professional sign-off, not a release.** This package is for technical re-review. The platform remains an **internal prototype; pilot gates remain open**. Passing automated tests is not occupational-hygiene approval or authorisation for pilot use. No method version has a professional approval, and nothing approved for any earlier version transfers.

## Three kinds of evidence, kept apart

| Kind | What exists for 1.5.0 |
|---|---|
| **Supplied test evidence** (run by the development team in its workspace) | Full suite, fixtures, application tests, browser checks, scenario run, impact scans — `03-fixtures-and-tests/results/`, `06-findings/` |
| **Independent technical verification** | **None for 1.5.1.** R5, a separate AI review agent, checked 1.5.0; its findings (one High, one Medium, six Low) are fixed in 1.5.1 but not re-checked. R4 (also an AI agent) checked 1.4.0. Neither is external professional validation |
| **Professional approval** | **None**, for any version |

## Status at a glance

| State | Items |
|---|---|
| **Implemented and tested** | TR-06, TR-07 (both reproductions now refused / indeterminate; valid workflows still work); R5-F1–F8 |
| **Awaiting technical re-review** | TR-06, TR-07 and the R5 fixes (all of this package); the 1.4.0 items TR-N1–N8 (fixed after R4, not re-checked) |
| **Awaiting professional judgement** | Duplicate window thresholds (±1 min; ≥ 90 % overlap); higher-result conflict rule for paired samples; reviewer confirmation of sample-list removals (§0.11); paired averaging (not implemented); inclusive [LOD, LOQ] for detected-below-LOQ estimates; laboratory-specific value mappings; everything listed for 1.4.0 (specification §0) |
| **Still open** | Reassessment decisions for any real affected records (none in the development database); TR-N7 residual (application-credential boundary, R2-N9); professional approval of every method version (G3) |

## Contents

| Folder | Content | Source |
|---|---|---|
| `01-source/` | Engine; services (assessments, field, lab, reports); routes (assessments, field); field form script; migrations 026–029; reproduction, impact and scenario scripts; `changes-since-9b87c17.diff` | Repository, unchanged; the diff is *generated at export* |
| `02-reproductions/` | TR-06/TR-07 **before** (engine 1.4.0, run from the reviewed code) and **after** (1.5.0 and 1.5.1), inputs unchanged plus labelled variants; application probe on 1.4.0; TR-01–TR-05 and E1–E14 outputs on 1.5.0 and 1.5.1 (unchanged apart from version labels) | Repository |
| `03-fixtures-and-tests/` | `worked-examples.fixtures.json` (113 cases; groups TR-06 = 27, TR-07 = 17); `build_fixtures.py` (independent Python oracle); fixture runner; `tr06-tr07.test.ts` (19 tests, 6 for R5); `fixtures.ts` (test helper that confirms sample-list removals through the services); `results/` (*generated at export*): full test run with per-test status, browser check logs | Repository; results generated at export |
| `04-specifications/` | Calculation specification (§0.9 duplicates, §0.10 value-field meaning, §0.11 sample-list removals), hygienist review pack, professional review handover | Repository |
| `05-synthetic-report/` | Synthetic report of the reassessed scenario showing the unresolved contradictory evidence and the rejected duplicate treatment; the scenario's approved 1.4.0 report is not reproduced (it is in the disposable database only) — the summary JSON records that it was unchanged; the demonstration report regenerated on 1.5.1, and as reviewed at `9b87c17` (*extracted at export from git*) | Repository / git |
| `06-findings/` | Findings register (§7.2 TR-06, TR-07: implemented — awaiting technical re-review; §7.3 R5 findings and treatment), remediation summary, impact scans (development database; scenario before and after reassessment), scenario summary with audit extract, test evidence | Repository |
| `07-identifiers/` | Commit, engine and method versions, migration list, per-file last commit (*generated at export*) | — |

## Reproduce

```
npm ci && npm test                                          # full suite (PostgreSQL 16; see README)
npx tsx scripts/tr/reproductions-tr06-tr07.ts               # TR-06 / TR-07 on the current engine
python3 scripts/tr/build_fixtures.py                        # regenerates the fixtures (byte-identical)
DATABASE_ADMIN_URL=… npx tsx scripts/tr/tr06-tr07-impact.ts # read-only impact scan of any database
bash scripts/tr/run-tr06-tr07-scenario.sh 9b87c17           # historical scenario: 1.4.0 code, then 1.5.0 (disposable database)
```

## Known limits of this evidence

- The Python oracle implements the documented rules: it verifies arithmetic and status logic, not whether the rules are methodologically right.
- All runs are in a development workspace; browser checks are desktop Chromium, not device evidence.
- The database cannot compare results, so the paired-result conflict rule and the calculable-result rule are enforced by the engine and the service only.
- The impact scan on real data has only been run on the development demonstration database (nothing found). A hosted database needs its own run.

## Exclusions

No secrets, keys, environment files, database dumps or real worker data are included. Source and test files contain the repository's published **development defaults** (local disposable databases, synthetic demonstration accounts, test passwords); they give no access to any real system. Workers appear only as synthetic reference codes or fictional demonstration names.
