# OHEA re-review package — engine 1.4.0 remediation

**Responds to:** AI-assisted technical review of commit `ceec79f` (TR-01–TR-05, items A–D, synthetic report).
**Engine:** 1.3.1 → **1.4.0** · **Methods:** `twa_8h` 1.2.1 → **1.3.0**, `stel_15` 1.1.1 → **1.2.0** · **Migrations:** 026, 027 · Commit and checksums: `07-identifiers/identifiers.json`, `MANIFEST.sha256`.

> **Not a professional sign-off.** This package is for technical re-review. No method version has a professional approval, and nothing approved for earlier versions transfers. The platform remains an **internal prototype; pilot gates remain open**. The internal reviews referred to (R1–R4) were made by separate AI review agents, not by people or an external firm.

## Status at a glance

| State | Items |
|---|---|
| **Fixed and tested** | TR-01–TR-05; A–D; report corrections; R4 findings TR-N1–N8 (N7 partly, see below) |
| **Awaiting technical re-review** | All of the above. TR-01–TR-05, A, D and the report were closed by R4 (an AI review agent) on `8f601b9`. TR-N1–N8 were fixed after it and have not been re-checked |
| **Awaiting professional judgement** | STEL zero-remainder convention and sampling tolerance (0); generic "<LOQ" as 0–LOQ; method acceptance consequences per method version (including the MDHS14/4 volume basis); molar volume (EH40 24.05526); evidence-disposition model and decision table; shift and exposure-duration rules; display policy; H1-F01 disposition |
| **Still open** | Narrative consistency check is heuristic (advisory only). TR-N7 residual: the database trusts the user identity set by the application process, which is the existing application-credential boundary (R2-N9), accepted with the same controls (proposal). Professional approval of every method version (G3) |

## Contents

| Folder | Content | Source |
|---|---|---|
| `01-source/` | Engine, relevant services (assessments, field, lab, instruments, register, narrative, usage, reports), display helpers, migrations 026–027 (in the diff), reproduction, impact and generator scripts, demonstration seed; `changes-since-ceec79f.diff` | Repository, unchanged; the diff is *generated at export* |
| `02-reproductions/` | TR-01–TR-05 outputs **before** (1.3.1) and **after** (1.4.0); E1–E14 engine outputs before and after | Repository |
| `03-fixtures-and-tests/` | `worked-examples.fixtures.json` (69 cases: exact inputs, independently derived expected values, statuses, flags, tolerances, method versions, explanation of each intentional change); `build_fixtures.py` (the independent Python calculation); fixture, service and engine tests; `results/` (*generated at export*): full test run (256 passed), desktop browser checks | Repository; results generated at export |
| `04-specifications/` | Calculation specification (§0: 1.4.0 rules, numerical policy, references, decision table), hygienist review pack, professional review handover | Repository |
| `05-synthetic-report/` | Revised synthetic report; the report as reviewed at `ceec79f` (*extracted at export from git*); demonstration walkthrough | Repository / git |
| `06-findings/` | Findings register (§7 TR entries with closure evidence; §7.1 R4), remediation summary, impact report on the demonstration database, test evidence | Repository |
| `07-identifiers/` | Commit, versions, migrations, per-file last commit (*generated at export*) | — |

## Reproduce

```
npm ci && npm test                                    # full suite (needs PostgreSQL 16; see README)
npx tsx scripts/tr/reproductions.ts                   # TR-01–TR-05 on the current engine
python3 scripts/tr/build_fixtures.py                  # regenerates the fixtures (byte-identical)
DATABASE_ADMIN_URL=… npx tsx scripts/tr/engine-change-impact.ts   # read-only impact listing
npx tsx scripts/export-example-report.ts              # rebuilds the synthetic report in a disposable database
```

## Known limits of this evidence

- The Python oracle implements the same documented rules as the engine; it verifies arithmetic and status logic against the specification, not whether the rules are methodologically right.
- All runs are in a development workspace; browser checks are desktop Chromium, not device evidence.
- The reviewing hygienist's scope of work (`docs/procurement/`) was written before this change and names `twa_8h` 1.2.1 and `stel_15` 1.1.1; the candidate versions are now 1.3.0 and 1.2.0.

## Exclusions

No secrets, keys, environment files, database dumps or real worker data are included. The source and test files contain the repository's published **development defaults** (local disposable test databases, the synthetic demonstration accounts and test-fixture passwords). They give no access to any real system, and the server refuses to start in production with the development database password. Workers appear only as synthetic reference codes or fictional demonstration names.
