# Pilot gate register

**This register is the single source of truth for pilot readiness.** The pilot acceptance checklist, release-readiness report and Phase H1 completion report refer to it rather than repeating gate status.

**Classification (18 Oct 2026): Internal prototype — pilot gates remain open.** No gate is accepted.

## Rules

- Status moves **Not started → In progress → Awaiting external evidence → Ready for review → Accepted** (or **Rejected**, which returns the gate to *In progress* with the reason recorded).
- **Writing a document never closes a gate.** A gate is *Accepted* only when its acceptance criteria are met by evidence and a named reviewer with the right authority records the decision and date below. The development team cannot accept gates that depend on professional, operational or customer evidence.
- Appointments, professional approvals, device tests and operational evidence are recorded only when they have actually happened, with a reference to where the evidence is kept. Nothing here is pre-filled.
- Gate decisions that change platform behaviour (assurance level, offline enablement, method approvals) are applied by a platform operator with `scripts/platform-controls.ts`, quoting the gate reference as `--evidence`. Each change is audited.

## Register

| Gate | Owner (proposed role) | Status | Acceptance criteria | Evidence reference | Reviewer | Review date |
|---|---|---|---|---|---|---|
| **G1** Pilot organisation and scope | SHEQ Experts pilot lead | Not started | One organisation, one site, limited tasks and substances named **by the organisation**; written agreement covering purpose, parallel running, data handling and exit (pilot protocol §1–2) | — | | |
| **G2** Named competent reviewer | SHEQ Experts director | Not started | A named occupational hygienist with stated competence (e.g. chartered status and membership number) appointed in writing to review methods, benchmarks and pilot assessments; independence from software development confirmed | — | | |
| **G3** Approved calculation methods | Reviewer (G2) | Awaiting external evidence | Signed professional validation pack: decision recorded for each method version used in the pilot (`twa_8h` 1.2.1, `stel_15` 1.1.1 if used, unit conversion); all findings dispositioned; approvals recorded with `platform-controls method-review` from the signed copy | Pack ready: `hygienist-review-pack.md`; enforcement: `assurance.ts`, `test/assurance.test.ts`. Blocked by G2 | | |
| **G4** Verified benchmarks and method parameters | Reviewer (G2) + platform operator | Awaiting external evidence | Every benchmark for the pilot substances imported as *professional reference* with reviewer, date, source, permitted use and licence note; reproduction rights checked; method versions for pilot methods configured and checked against the method publications | Workflow and tooling: `reference-data-workflow.md`, `scripts/import-reference-data.ts`. Blocked by G1, G2 | | |
| **G5** Hosting and operational security | Hosting owner | Awaiting external evidence | Production hosting with TLS and `COOKIE_SECURE=true`; secrets in a secrets manager (DB passwords, `FIELD_RECOVERY_KEK`, alert webhook secret); changed credentials; alert webhook routed to named people and tested; uptime/error monitoring; log retention; penetration test or documented decision to pilot without one | Application controls implemented and tested (`operations.md` §Security controls). Hosting not selected | | |
| **G6** Backup and restoration | Hosting owner | Awaiting external evidence | Scheduled backups of database and attachments in the hosting environment with failure alerts; **one restore verified in the hosting environment** with `restore-verify.ts --evidence-label`, RTO/RPO recorded and accepted; rollback procedure rehearsed | Scripts and runbook: `operations.md`; development restore verified 18 Oct 2026 (`docs/examples/restore-verification.development.json`) — **not hosting evidence** | | |
| **G7** Privacy and retention | DP adviser + controller | Awaiting external evidence | PIA reviewed and signed; roles confirmed; retention decision per record class recorded and configured; support-access and incident procedures agreed | Draft: `privacy-impact-assessment.md` | | |
| **G8** Offline data protection | Platform owner + independent security reviewer | Ready for review | Independent review of the offline design and implementation finds no unresolved high-severity issue; documented limitations accepted by the controller; device-management requirements agreed. Until accepted, offline capture stays **off** for real organisations | `offline-field-capture.md`; `public/field.js`; `src/services/recovery.ts`; browser check 20/20 (desktop Chromium — not device evidence); recovery tests. Internal independent software review (18 Oct 2026): 3 high and 9 medium findings, fixed and retested (`phase-h1-completion-report.md`). **An external security review is still required for acceptance** | | |
| **G9** Actual field-device testing | Pilot site lead + SHEQ field technician | Not started | Field device tests F1–F22 run on each pilot device model/OS/browser in its managed configuration, results recorded with build and limitations; no open defect that risks data loss or exposure | Script: `field-device-test-script.md`. No physical-device runs | | |
| **G10** Training and support | SHEQ Experts pilot lead | Not started | Pilot users trained (field capture, PIN and recovery, review workflow, limitations); written procedure that the platform does not authorise work or replace emergency arrangements; named support and incident contacts with hours | — | | |
| **G11** Final pilot authorisation | SHEQ Experts director + pilot organisation | Not started | G1–G10 accepted; stop conditions and rollback agreed; tenant moved to *pilot* level (and offline enabled only if G8 and G9 accepted) by a platform operator quoting this gate | Blocked by G1–G10 | | |

## Decision log

Record each status change: date · gate · from → to · by whom · evidence reference · notes.

| Date | Gate | Change | By | Evidence | Notes |
|---|---|---|---|---|---|
| 18 Oct 2026 | G1–G11 | Register created; statuses set as above | Development team (not a gate decision) | Phase H1 completion report | No gate accepted |
