# Verified pilot reference data workflow

**Gate:** G4 (verified benchmarks and method parameters). **Tool:** `scripts/import-reference-data.ts` (platform operator, owner database connection). **Example file:** `docs/examples/reference-data.synthetic.json` (synthetic only).

The pilot organisation chooses its pilot substances and tasks. **This workflow does not choose them on the organisation's behalf**, and no real limits are shipped with the software.

## Three kinds of benchmark, kept visibly distinct

| Provenance | Who creates it | Where it can be used | Shown as |
|---|---|---|---|
| **Professional reference** | Platform operator, from a verified source, after a named competent reviewer checks every row | All organisations; **the only kind that can support conclusions in a pilot organisation** | Green *Professional reference* badge, reviewer named |
| **Entered by organisation** | An organisation user with `benchmark.write`; verified by a different person with `benchmark.verify` | That organisation only; calculation and discussion; conclusions in evaluation organisations (labelled) | Amber *Entered by organisation* badge |
| **Synthetic** | Platform (demo) | Demonstration and tests only | *Synthetic* label and "not a real exposure limit" in every output |

## Fields required for each reference row

Substance identity (name; CAS and EC numbers where they exist; molecular weight **with its source** if conversion will be used) · jurisdiction · benchmark type (e.g. LTEL, STEL) · value and unit · averaging period · annotations (e.g. Sk, Sen, Carc as published) · source title, edition/version and URL · effective from (and to, if superseded) · reviewer name · verification date · permitted use · licence note (reproduction rights for the source).

The database enforces completeness: a row marked *professional reference* without reviewer, verification date, source URL or permitted use, or marked synthetic, or owned by an organisation, is refused (`professional_reference_complete` constraint). Synthetic rows must say "synthetic" in the substance name and must not carry a real CAS number.

## Steps

1. **Pilot organisation names the substances, tasks and jurisdiction** (pilot protocol §2). Record the request.
2. **Source check.** The preparer obtains the current authoritative edition (for GB, the current HSE EH40 publication or its successor) and records title, edition and URL. **Check reproduction rights** for the source; proprietary limit databases may not permit loading values into third-party software. Record the outcome in `licence_note`.
3. **Prepare the file** (JSON array, one row per benchmark, format as in the example). Molecular weights need a cited source.
4. **Independent verification.** A competent reviewer, not the preparer, checks every row against the source, completes `reviewer_name` and `verified_on`, and signs the file listing (keep the signed copy with the pilot records — it is the evidence reference for gate G4).
5. **Dry run:** `DATABASE_ADMIN_URL=… npx tsx scripts/import-reference-data.ts file.json --dry-run --imported-by "<operator>"`. Every row is validated; any error refuses the whole file.
6. **Import** without `--dry-run`. The import is all-or-nothing and writes a `platform.reference_import` audit event (operator, row count).
7. **Check on screen** (Reference data page): values, units, averaging periods, annotations, provenance badges and reviewer names.
8. **Method parameters** for each sampling/analytical method the pilot uses (flow tolerance, flow range, minimum volume, result basis, suitability for formal assessment) are entered as method versions and checked against the method publication by the reviewer (also G4).

## Changes never alter approved assessments

- Existing benchmark versions are **never edited**. Re-importing a row with the same source version and effective date but a different value is refused; a corrected or updated value must be a new source version with its own effective date.
- Each approved assessment revision freezes the benchmark version it used and its provenance. A newer verified version, or withdrawal of the used version, raises a *reassessment may be required* notice; the approved conclusion and its issued report are unchanged (tested).
- Organisation-entered benchmarks follow the same rule: new versions, never edits; verification by a second person.

## Current state (18 Oct 2026)

No professional reference rows exist in any environment. The only platform benchmark is the synthetic `DEMO LTEL 0.5 mg/m³`. The synthetic example file was dry-run successfully (2 rows, 1 new substance, nothing written). Automated tests exercise validation, immutability, the database constraint and pilot enforcement using a disposable test-only row.
