# Pilot decision pack

**Purpose:** the decisions that software work cannot make, in one place. **Only confirmed information is entered.** As of 19 October 2026 **none of these decisions has been made**. Each row names the role responsible and the gates it unblocks. When a decision is made, record it here with the date and the evidence reference, and update `pilot-gate-register.md`.

| # | Decision | Confirmed value | Responsible role | Unblocks | Inputs available |
|---|---|---|---|---|---|
| P1 | Pilot organisation | **Not decided** | SHEQ Experts director | G1 → all | `pilot-protocol.md` §1–2 |
| P2 | Pilot site | **Not decided** | Pilot organisation + SHEQ pilot lead | G1, G9 | — |
| P3 | Processes and tasks in scope | **Not decided** | Pilot organisation | G1, G4 | Register structure in `pilot-user-guides.md` (practitioner §1) |
| P4 | Substances, chosen by the pilot organisation | **Not decided** | Pilot organisation, advised by the reviewer | G4 | `docs/templates/reference-data.template.json` (blank) |
| P5 | Similar exposure groups and their rationale | **Not decided** (set up during the pilot from P3) | Practitioner, reviewed by the hygienist | Pilot workflow step 1 | — |
| P6 | Named competent occupational hygienist, with competence | **Not appointed** | SHEQ Experts director | G2 → G3, G4 | `professional-review-handover.md` |
| P7 | Approved monitoring and analytical methods (sampling method versions, flow tolerances, minimum volumes) | **Not decided** | Reviewer (P6) | G4 | `reference-data-workflow.md` §8 |
| P8 | Calculation methods to approve | **None approved.** Candidates: `twa_8h` 1.2.1, `stel_15` 1.1.1 if short-term limits apply, unit conversion if ppm limits apply | Reviewer (P6) | G3 | Validation pack |
| P9 | Laboratory, its accreditation and result file format | **Not decided** | Pilot lead | Pilot workflow step 3 | CSV import format (practitioner guide §3) |
| P10 | Field devices (make, model, OS, browser, MDM) | **Not decided**. No device tested. | Pilot site lead | G9 | `field-device-test-script.md` F1–F23 |
| P11 | Offline capture for the pilot | **Off** (default). Enable only if G8 and G9 are accepted. | Platform owner + controller | G8, G9 | `offline-field-capture.md` |
| P12 | Hosting provider, region, domain, RPO and RTO | **Not decided** | SHEQ Experts director | G5, G6 | `hosting-decision-sheet.md` |
| P13 | Privacy roles, DP adviser, retention per record class | **Not decided** | DP adviser + controller | G7 | `privacy-impact-assessment.md` |
| P14 | Support and incident contacts, response targets | **Not decided** | Pilot lead | G10, G7 | `support-and-incident-procedure.md` |
| P15 | Training dates and attendees | **Not decided** | Pilot lead | G10 | `training-record.md` |
| P16 | Pilot dates and review points | **Not decided**. Suggested review points: after setup (register and plan), after the first laboratory results, after the first approved assessment, after any control verification, and a final review. | Pilot lead + pilot organisation | G11 | `pilot-protocol.md` §6, §11 |
| P17 | Final pilot authorisation (G11) | **Not given** | SHEQ Experts director + pilot organisation representative, recorded with `platform-controls.ts pilot-authorise` | Pilot start | `pilot-gate-register.md` |

## What is ready now (no decision needed)

- **Software controls for a controlled pilot**: pilot level, method and reference-data gates, suspension, holds, recovery and key replacement. All are implemented and tested in development.
- **Deployable configuration for either hosting option** (`deploy/`).
- **Professional review handover pack** for the reviewer.
- **User guides, training record, and support and incident templates.**

## Order of decisions

P1 and P6 come first. P12 can run in parallel. P3, P4 and P7 follow P1 and P6. P8 follows P6. P13–P15 follow P1. P10 follows P2. P17 comes last.
