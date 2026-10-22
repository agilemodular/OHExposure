# Pilot decision pack

**Purpose:** the decisions that software work cannot make, in one place. **Only confirmed information is entered.** Each row names the role responsible and the gates it unblocks. When a decision is made, record it here with the date and the evidence reference, and update `pilot-gate-register.md`.

**Confirmed information as of 19 October 2026: none.** No pilot organisation, site, reviewer, laboratory, device, hosting provider, recovery objective, privacy role, contact or date has been confirmed to the project, and no approval or authorisation has been given. Every row below is therefore open. Numbers P1–P17 are unchanged from the Phase H2 pack; P4a (reference benchmarks) and P12a (recovery objectives) split out items that were part of G4 and P12.

| # | Item | Confirmed | Decision needed | Responsible role | Unblocks | Evidence required for acceptance |
|---|---|---|---|---|---|---|
| P1 | Pilot organisation | — | Name one organisation willing to run a parallel pilot | SHEQ Experts director | G1 → all later decisions | Written agreement (purpose, parallel running, data handling, exit) — pilot protocol §1–2 |
| P2 | Pilot site | — | Name one site | Pilot organisation + SHEQ pilot lead | G1, G9 (devices on site), P10 | Site named in the agreement |
| P3 | Tasks in scope | — | List the processes and tasks to be monitored | Pilot organisation | G1, G4, P5 | Task list annexed to the agreement |
| P4 | Substances | — | Choose the substances (airborne contaminants only) | Pilot organisation, advised by the reviewer | G4 (reference data), P7 | Substance list; completed `docs/templates/reference-data.template.json` |
| P4a | Reference benchmarks and verification owner | — | Verify a benchmark for each pilot substance; name who verifies | Reviewer (P6) + platform operator | G4; pilot level (database requires a professional reference benchmark) | Rows imported as *professional reference* with reviewer, date, source, permitted use, licence note |
| P5 | Similar exposure groups | — | Define groups and their rationale (during set-up) | Practitioner; reviewed by the hygienist | Pilot workflow step 1 | Group records with rationale, reviewed |
| P6 | Reviewing occupational hygienist | — (scope of work for quotation prepared 22 Oct 2026, `docs/procurement/`; not yet issued; response deadline and contact to be inserted) | Appoint a named competent hygienist, independent of development | SHEQ Experts director | G2 → G3, G4, H1-F01 disposition | Appointment letter; competence statement (e.g. chartered status, membership number); independence confirmed; accepted quotation against the scope of work |
| P7 | Monitoring and analytical methods | — | Confirm sampling and analytical methods and their parameters for each substance | Reviewer (P6) | G4 | Method versions configured and checked against the publications, signed by the reviewer |
| P8 | Calculation methods and versions requiring approval | Candidates only: `twa_8h` 1.4.1; `stel_15` 1.3.1 if short-term limits apply (engine 1.5.1, replacing 1.4.0/1.3.0, 1.3.0/1.2.0 and, before them, 1.2.1/1.1.1 after the technical reviews of 22 Oct 2026); unit conversion if ppm limits apply | Approve, approve with conditions, or reject each; disposition H1-F01 | Reviewer (P6) | G3; pilot level (database requires an approved method) | Signed validation pack; approvals recorded with `platform-controls method-review` (scope, expiry, hashed document) |
| P9 | Laboratory arrangements | — | Choose the laboratory; confirm accreditation and result file format | Pilot lead | Pilot workflow step 3 | Laboratory name, accreditation reference, sample result file tested against the CSV import |
| P10 | Devices and browsers | — | Name each device model, OS version, browser and management arrangement | Pilot site lead | G9 | Device list; device standard (`online-only-pilot-configuration.md` §5) |
| P11 | Offline capture | **Off** (platform default). Proposed: online-only pilot | Accept the online-only configuration and the proposed G8/G9 scope | Director + pilot organisation; G8 and G9 owners | G8, G9 scope | Signed scope decisions (`online-only-pilot-configuration.md` §6) |
| P12 | Hosting environment | — | Choose hosting model, provider, region and domain | SHEQ Experts director / hosting owner | G5, G6 | `hosting-decision-sheet.md` D-H1–D-H11 completed; accounts opened |
| P12a | Recovery objectives (RPO, RTO) | — (proposals in `operations.md` are not decisions) | Agree RPO and RTO | SHEQ Experts director with the pilot organisation | G6 | Agreed values recorded; one hosting restore measured against them |
| P13 | Privacy roles and retention | — | Confirm controller/processor roles, appoint the DP adviser, set retention per record class | DP adviser + controller | G7 | Signed PIA; retention decisions configured |
| P14 | Support and incident contacts | — | Name contacts, routes, hours and response targets | Pilot lead | G10, G7 | Completed `support-and-incident-procedure.md` |
| P15 | Training | — | Set dates and attendees; deliver training | Pilot lead | G10 | Completed `training-record.md` signed by attendees (only after delivery) |
| P16 | Proposed dates | — | Set start, end and review points | Pilot lead + pilot organisation | G11 | Dates in the agreement |
| P17 | Final authorisation | **Not given** | Authorise the pilot once G1–G10 are accepted | SHEQ Experts director + pilot organisation representative | Pilot start | Recorded with `platform-controls pilot-authorise` (signed document hashed); G11 entry |

## What is ready now (no decision needed)

- **Software controls for a controlled pilot**: pilot level, method and reference-data gates, suspension, holds, recovery and key replacement. All are implemented and tested in development.
- **Deployable configuration for either hosting option** (`deploy/`).
- **Professional review handover pack** for the reviewer, including the H1-F01 brief (§1.0).
- **Online-only pilot configuration** with verification results and proposed G8/G9 scope (`online-only-pilot-configuration.md`).
- **Synthetic demonstration walkthrough** for reviewers and decision-makers (`docs/examples/demonstration-walkthrough.synthetic.md`); not evidence of field validation.
- **User guides, training record, and support and incident templates.**
- **Scope of work for quotation** for the reviewing hygienist (`docs/procurement/Scope-of-Work-Professional-Review.docx`); response deadline and contact still to be inserted before issue.

## Order of decisions

P1 and P6 come first. P12 can run in parallel. P3, P4 and P7 follow P1 and P6. P8 follows P6. P13–P15 follow P1. P9 follows P1. P10 follows P2. P11 can be decided with P1. P4a follows P4 and P6. P12a follows P12. P17 comes last.
