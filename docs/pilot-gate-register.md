# Pilot gate register

**This register is the single source of truth for pilot readiness.** The pilot acceptance checklist, release-readiness report and Phase H1 completion report refer to it rather than repeating gate status.

**Classification (19 Oct 2026, post-H2 evidence closure): Internal prototype — pilot gates remain open.** No gate is accepted.

**Readiness here means readiness for one specified pilot** (organisation, site, tasks, substances, methods, devices and hosting as fixed under G1, G4, G9 and G5). Acceptance of these gates is not evidence of general product readiness, which needs, among other things, a penetration test, production hosting and operating experience beyond the pilot.

## Rules

- Status moves **Not started → In progress → Awaiting external evidence → Ready for review → Accepted** (or **Rejected**, which returns the gate to *In progress* with the reason recorded).
- **Writing a document never closes a gate.** A gate is *Accepted* only when its acceptance criteria are met by evidence and a named reviewer with the right authority records the decision and date below. The development team cannot accept gates that depend on professional, operational or customer evidence.
- Appointments, professional approvals, device tests and operational evidence are recorded only when they have actually happened, with a reference to where the evidence is kept. Nothing here is pre-filled.
- Gate decisions that change platform behaviour (assurance level, offline enablement, method approvals) are applied by a platform operator with `scripts/platform-controls.ts`, quoting the gate reference as `--evidence`. Each change is audited.

## Acceptance requirements (all gates)

A gate can be accepted only when:
1. its acceptance criteria are satisfied;
2. the evidence is accessible (a reference someone else can open) and current (produced on the build, data and environment the pilot will use);
3. the designated reviewer records acceptance with name and date;
4. any remaining conditions are written in the decision log.

## Reopening

An accepted gate reopens, and the pilot level may have to be withdrawn (`platform-controls.ts pilot-withdraw`), after a material change:

| Change | Gates reopened |
|---|---|
| New calculation or engine version, or a method approval withdrawn or expired | G3 (and G11) |
| Reference data added, superseded or withdrawn for pilot substances | G4 |
| Change to offline protection (client encryption, key handling, recovery) or enabling offline for another organisation | G8, G9 |
| New device model, OS major version or browser | G9 |
| Hosting, region, database, backup arrangement or secrets change | G5, G6 |
| Change of pilot organisation, site, tasks, substances or reviewer | G1, G2, G4, G11 |
| Privacy roles, data flows or retention change | G7 |
| A stop condition triggered | Per the investigation; at least the gates covering the affected workflow |

## Technical findings linked to gates

Findings are recorded in `findings-register.md`. Open or unaccepted findings that bear on a gate:

| Gate | Findings |
|---|---|
| G3 | H1-F01: awaiting professional disposition (brief: `professional-review-handover.md` §1.0) |
| G5 | R-X1 (name-based separation checks, mitigated and accepted by R2), R2-Q1 to R2-Q4 (name check; see findings register §3.4); privileged-access controls in `approval-and-issue-controls.md` §4 to be confirmed with the hosting owner |
| G6 | H2-A7 (pre-migration backup): rehearsal in hosting needed |
| G8 | Offline findings R-M5, R-M6, R-M8, R-L1, R-H2a: proposed *defer while offline capture is off* (`findings-register.md` §6); online-only verification and its re-check (§5) |
| G9 | Online-only device tests O1–O10 and retained F tests (`online-only-pilot-configuration.md` §5); R-M5/R-M6 only if offline is enabled |
| All software-closure items | Phase H2 findings and the Phase H1 fixes marked *awaiting acceptance (R2)* |

## Register

| Gate | Owner (proposed role) | Status | Acceptance criteria | Evidence reference | Reviewer | Review date |
|---|---|---|---|---|---|---|
| **G1** Pilot organisation and scope | SHEQ Experts pilot lead | Not started | One organisation, one site, limited tasks and substances named **by the organisation**; written agreement covering purpose, parallel running, data handling and exit (pilot protocol §1–2) | — | | |
| **G2** Named competent reviewer | SHEQ Experts director | Not started | A named occupational hygienist with stated competence (e.g. chartered status and membership number) appointed in writing to review methods, benchmarks and pilot assessments; independence from software development confirmed | — | | |
| **G3** Approved calculation methods | Reviewer (G2) | Awaiting external evidence | Signed professional validation pack: decision recorded for each method version used in the pilot (`twa_8h` 1.2.1, `stel_15` 1.1.1 if used, unit conversion); all findings dispositioned; approvals recorded with `platform-controls method-review` from the signed copy | Pack ready: `hygienist-review-pack.md`; enforcement: `assurance.ts`, `test/assurance.test.ts`. Blocked by G2; Handover: `professional-review-handover.md`; engine outputs `docs/examples/validation-examples.json`; authority records now require scope and a hashed signed document, and support withdrawal and expiry (H2); H1-F01 brief added to the handover (post-H2) | | |
| **G4** Verified benchmarks and method parameters | Reviewer (G2) + platform operator | Awaiting external evidence | Every benchmark for the pilot substances imported as *professional reference* with reviewer, date, source, permitted use and licence note; reproduction rights checked; method versions for pilot methods configured and checked against the method publications | Workflow and tooling: `reference-data-workflow.md`, `scripts/import-reference-data.ts`. Blocked by G1, G2; Template `docs/templates/reference-data.template.json` (rejected by the importer until completed) | | |
| **G5** Hosting and operational security | Hosting owner | Awaiting external evidence | Production hosting with TLS and `COOKIE_SECURE=true`; secrets in a secrets manager (DB passwords, `FIELD_RECOVERY_KEK`, alert webhook secret); changed credentials; alert webhook routed to named people and tested; uptime/error monitoring; log retention; penetration test or documented decision to pilot without one | Application controls implemented and tested (`operations.md` §Security controls). Hosting not selected; `hosting-decision-sheet.md` (decisions D-H1–D-H11 outstanding); `deploy/` configuration (compose validated; image not built here); privileged access `approval-and-issue-controls.md` §4 | | |
| **G6** Backup and restoration | Hosting owner | Awaiting external evidence | Scheduled backups of database and attachments in the hosting environment with failure alerts; **one restore verified in the hosting environment** with `restore-verify.ts --evidence-label`, RTO/RPO recorded and accepted; rollback procedure rehearsed | Scripts and runbook: `operations.md`; development restore verified 18 Oct 2026 (`docs/examples/restore-verification.development.json`) — **not hosting evidence**; Scheduled jobs and timers in `deploy/`; pre-migration backup in the entrypoint (tested in development only) | | |
| **G7** Privacy and retention | DP adviser + controller | Awaiting external evidence | PIA reviewed and signed; roles confirmed; retention decision per record class recorded and configured; support-access and incident procedures agreed | Draft: `privacy-impact-assessment.md`; Worker-data flows re-verified against code (PIA §3a) | | |
| **G8** Offline data protection | Platform owner + independent security reviewer | Ready for review | Independent review of the offline design and implementation finds no unresolved high-severity issue; documented limitations accepted by the controller; device-management requirements agreed. Until accepted, offline capture stays **off** for real organisations | `offline-field-capture.md`; `public/field.js`; `src/services/recovery.ts`; browser check 22/22 (desktop Chromium — not device evidence); recovery tests. Internal independent software review (18 Oct 2026): 3 high and 9 medium findings, fixed and re-checked (`phase-h1-completion-report.md`). **An external security review is still required for acceptance**; Key management summary and versioned key replacement (H2; tests and desktop browser check); **proposed online-only scope** — offline-specific requirements excluded while offline is off, device-management and online-only verification retained (`online-only-pilot-configuration.md` §5); not accepted | | |
| **G9** Actual field-device testing | Pilot site lead + SHEQ field technician | Not started | Field device tests F1–F23 run on each pilot device model/OS/browser in its managed configuration, results recorded with build and limitations; no open defect that risks data loss or exposure | Script: `field-device-test-script.md`. No physical-device runs. Proposed online-only test list (F exclusions with reasons, O1–O10): `online-only-pilot-configuration.md` §5; not accepted | | |
| **G10** Training and support | SHEQ Experts pilot lead | In progress | Pilot users trained (field capture, PIN and recovery, review workflow, limitations); written procedure that the platform does not authorise work or replace emergency arrangements; named support and incident contacts with hours | Prepared (not evidence of training): `pilot-user-guides.md`, `training-record.md` (blank), `support-and-incident-procedure.md` (contacts to be confirmed); Training additions: data-quality flags, suspension and escalation, report interpretation (T8, C11–C12) | | |
| **G11** Final pilot authorisation | SHEQ Experts director + pilot organisation | Not started | G1–G10 accepted; stop conditions and rollback agreed; tenant moved to *pilot* level (and offline enabled only if G8 and G9 accepted) by a platform operator quoting this gate | Blocked by G1–G10; Recorded authorisation required by the database before pilot level (`platform-controls.ts pilot-authorise`); decision pack `pilot-decision-pack.md` | | |

## Decision log

Record each status change: date · gate · from → to · by whom · evidence reference · notes.

| Date | Gate | Change | By | Evidence | Notes |
|---|---|---|---|---|---|
| 18 Oct 2026 | G1–G11 | Register created; statuses set as above | Development team (not a gate decision) | Phase H1 completion report | No gate accepted |
| 19 Oct 2026 | G10 | Not started → In progress | Development team (not a gate decision) | User guides, training record template, support and incident procedure template | No one trained; contacts not confirmed |
| 19 Oct 2026 | G1–G11 | Phase H2: no status changes to gates. Evidence references extended (findings register, suspension policy, approval/issue controls, hosting decision sheet, deployable configuration, decision pack, review handover). | Development team (not a gate decision) | `phase-h2-completion-report.md` | No gate accepted |
| 19 Oct 2026 | — | Phase H2 closure: independent review R2 findings closed; no gate status changed | Development team (not a gate decision) | `phase-h2-completion-report.md`, `findings-register.md` | No gate accepted; no pilot authorised |
| 19 Oct 2026 | — | Remaining software low findings closed (R2 acceptance check, `findings-register.md` §3.4); no gate status changed | Development team (not a gate decision) | `findings-register.md` | No gate accepted; no pilot authorised |
| 19 Oct 2026 | G8, G9 | Post-H2: online-only configuration and proposed G8/G9 scope prepared; Low-finding dispositions proposed; no status change | Development team (not a gate decision) | `online-only-pilot-configuration.md`; `findings-register.md` §5–6; `post-h2-handover.md` | Scope proposals need the gate owners' acceptance; no gate accepted; no pilot authorised |
