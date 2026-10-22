# OHEA re-review package — TR-08 (application 1.1.0, engine 1.5.1)

**Responds to:** the independent technical re-review of commit `b5eb070` (engine 1.5.1). The re-review verified that the original TR-06 and TR-07 engine reproductions are fixed, that all 113 calculation fixtures pass, and that the TR-01–TR-05 reproduction outputs match. It raised an application inconsistency, registered as **TR-08**: samples whose removal awaits a reviewer's confirmation stayed in the calculation but fell outside the approval safeguards.

**Versions:**
- **Application:** 1.0.0 → **1.1.0**.
- **Migration:** **030** (schema 001–030).
- **Engine and methods: unchanged** at 1.5.1 (`twa_8h` 1.4.1, `stel_15` 1.3.1), because no calculation behaviour changed.

Commit, versions and checksums: `07-identifiers/identifiers.json`, `MANIFEST.sha256`.

> **Not a professional sign-off, not a release.** The platform remains an **internal prototype; pilot gates remain open**. Passing automated tests is not occupational-hygiene approval or authorisation for pilot use.

## Three kinds of evidence, kept apart

| Kind | What exists |
|---|---|
| **Supplied test evidence** (development workspace) | Before and after application reproductions, the full regression suite, TR-08 integration and concurrency tests, browser checks, impact checks — `02-…`, `03-…`, `06-…` |
| **Independent technical verification** | The re-review of `b5eb070`: TR-06 and TR-07 engine reproductions fixed, 113 fixtures pass, TR-01–TR-05 outputs match (retained; all still pass here). **Not yet for TR-08.** Earlier AI-agent checks (R4, R5) are not external validation |
| **Professional approval** | **None**, for any method version |

## Status at a glance

| State | Items |
|---|---|
| **Verified by independent technical re-review** | TR-06 and TR-07 engine reproductions; 113 fixtures; TR-01–TR-05 outputs |
| **Implemented — awaiting technical re-review** | TR-08 (resolver, locks, trigger, held-record placement lock); the R5 fixes F1–F8 |
| **Awaiting professional judgement** | As before (specification §0): duplicate thresholds and conflict rule, value-field boundaries, reviewer confirmation of removals, and the 1.4.0 conventions |
| **Still open** | Any reassessment decisions for real records flagged by the impact checks (none in the development database); professional approval of every method version (G3) |

## Contents

| Folder | Content | Source |
|---|---|---|
| `01-source/` | Assessment and field services, the assessment route, migrations 029 and 030, impact checks and scenario scripts; `changes-since-b5eb070.diff` | Repository; the diff is *generated at export* |
| `02-reproductions/` | TR-08 **before** (`b5eb070`) and **after** (application 1.1.0), produced by the same scenario code; the probe source; the TR-01–TR-07 reproductions on 1.5.1 | Repository |
| `03-fixtures-and-tests/` | `tr08.test.ts`, `tr08-scenarios.ts`, `fixtures.ts`; the fixtures file and its builder; `results/` (*generated at export*): full test run with per-test status, browser logs | Repository; results generated at export |
| `04-specifications/` | Calculation specification (§0.11: effective evidence set) | Repository |
| `05-synthetic-report/` | Reassessment report regenerated with the version actually used (engine 1.5.1, `stel_15` 1.3.1, application 1.1.0), and the demonstration report | Repository |
| `06-findings/` | Findings register (§7.4 TR-08), TR-08 and TR-06/TR-07 remediation summaries, TR-08 impact checks (development database; synthetic history made with `b5eb070`), TR-06/07 impact and scenario results, test evidence, readiness report | Repository |
| `07-identifiers/` | Commit, application, engine and method versions, migration list, per-file last commit (*generated at export*) | — |

## Reproduce

```
npm ci && npm test                                            # full suite (PostgreSQL 16; see README)
npx vitest run test/tr08.test.ts                              # TR-08 integration and concurrency tests
DATABASE_ADMIN_URL=… npx tsx scripts/tr/tr08-impact.ts        # read-only TR-08 historical check
bash scripts/tr/run-tr08-scenario.sh b5eb070                  # approvals made with b5eb070, then migration 030 and the check
bash scripts/tr/run-tr06-tr07-scenario.sh 9b87c17             # TR-06/07 scenario; regenerates the reassessment report
```

The before-fix TR-08 reproduction used `docs/remediation/tr08-probe.test.ts.txt` (copy it to `test/` to re-run it on any commit) together with `test/tr08-scenarios.ts`.

## Known limits of this evidence

- Runs are in a development workspace; browser checks are desktop Chromium, not device evidence.
- When a suspension-review flag was set is recorded only when it comes from a synchronised hold, so some historical cases can only be classified as *needs investigation*.
- The impact checks on real data have only been run on the development demonstration database (nothing found). A hosted database needs its own run.

## Exclusions

No secrets, keys, environment files, database dumps or real worker data are included. Source and test files contain the repository's published **development defaults** (local disposable databases, synthetic accounts, test passwords); they give no access to any real system. Workers appear only as synthetic reference codes or fictional demonstration names.
