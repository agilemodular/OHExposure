# Release readiness report

**Updated:** 22 October 2026 (engine 1.5.1: TR-06, TR-07 and the R5 re-check) · **Scope:** airborne contaminants · **Engine:** 1.5.1 (`twa_8h` 1.4.1, `stel_15` 1.3.1) · **Migrations:** 29 (001–029)

This report does not declare release readiness. It records what has been verified in the development environment.

## Classification

**Internal prototype — pilot gates remain open.**

No pilot gate is accepted and no pilot is authorised. Readiness for a pilot is tracked only in `pilot-gate-register.md`. Technical findings are tracked only in `findings-register.md`. Phase details: `phase-h1-completion-report.md`, `phase-h2-completion-report.md`, `post-h2-handover.md`.

## Completed and verified in software (development environment)

- **Phases A–G**: vertical workflows with persistence, authorisation and validation. Forced row-level security on all application tables. Append-only evidence; immutable approvals.
- **Phase H1**:
  - pilot assurance levels with method and reference-data gates;
  - workflow suspension;
  - offline data protection with server-side recovery;
  - session controls and signed alerts;
  - backup and restore verification;
  - controlled reference import.
- **Phase H2**:
  - **Suspension policy.** Covers workflows, organisations and single assessments, and is enforced in both services and database triggers. Lock-based race protection, quarantined remediation intake, and server-side holds for offline records.
  - **Approval and report issue.** The prerequisites are enforced in the database for every write made with the application credentials.
  - **Professional authority records.** These carry permitted scope, hashed signed evidence, expiry and withdrawal. A recorded pilot authorisation is required before pilot level can be set.
  - **Field recovery keys.** These are versioned, with replacement and revocation.
  - **Production deployment profile.** The running application never holds owner credentials.
- **Post-H2 evidence closure:**
  - R2-P1 and R2-P2 re-reviewed against the original failure: closed.
  - Two further Medium findings found, fixed and closed on re-check: a hold could be linked to an unrelated sample (R2-P3), and a directly inserted report was not bound to its content or approval record (R2-P4). One Low found on re-check (R2-P6, draft reports by any role) is fixed and tested.
  - The reviews (R1–R3) were made by separate AI review agents, not by people or an external security firm; G8 and G5 still require external review.
  - **Online-only pilot configuration** defined and verified on desktop Chromium (17/17), with a proposed G8/G9 scope for the gate owners.
  - Every remaining Low finding has a proposed treatment awaiting its owner's acceptance (`findings-register.md` §6).
  - H1-F01 brief written for the hygienist.
  - Synthetic demonstration walkthrough with the six failure cases.
- **Engine 1.4.0 remediation (22 Oct 2026):** the AI-assisted technical review of `ceec79f` found five calculation defects (TR-01–TR-05) and associated weaknesses. All are fixed and tested and await technical re-review (`findings-register.md` §7; `docs/remediation/remediation-summary.md`). The candidate method versions became `twa_8h` 1.3.0 and `stel_15` 1.2.0 (since replaced by 1.4.0 and 1.3.0, below).
- **Engine 1.5.0 remediation (22 Oct 2026):** two findings on package `9b87c17`: a duplicate disposition could set aside a different sample (TR-06), and contradictory detected-below-LOQ inputs gave a favourable result (TR-07). Both are implemented and tested and **await technical re-review** (`findings-register.md` §7.2; `docs/remediation/remediation-summary-tr06-tr07.md`). A re-check by a separate AI review agent (R5) found one High and one Medium issue remaining; both are fixed with six Lows in engine 1.5.1 (`findings-register.md` §7.3), not yet re-reviewed. The candidate method versions are now `twa_8h` 1.4.1 and `stel_15` 1.3.1; no approval exists or transfers.
- **Automated evidence:** 320 tests, all passing (10 suites). Desktop browser checks 24/24 (offline) and 17/17 (online-only), re-run on engine 1.5.1. A development restore was verified as the non-superuser owner. **None of this is hosting or device evidence.**
- **Independent software review (R2).** R2 reviewed the Phase H2 controls, re-checked the fixes, then re-checked the final fixes.
  - The first review found 2 critical, 4 high, 8 medium and 9 low findings, plus 9 more from the re-checks.
  - **All Critical and High findings from R2 are closed. Every Medium software finding from R2 is closed except H1-F01, which is fixed in software and awaits the hygienist's disposition.** The later calculation findings (TR-01–TR-07) are tracked in `findings-register.md` §7–§7.2.
  - The open Low findings are listed in `findings-register.md` §4.
  - An acceptance check closed the remaining software low findings (R-L4, R-L5, R-L7, R2-M7 residual, R2-P1, R2-P2) and confirmed R-X1 as mitigated (risk acceptance is proposed and awaits the SHEQ Experts director, `findings-register.md` §6). The follow-on name-check findings R2-Q1 to R2-Q4 are closed on re-check; residual edge cases (R2-Q5, Low) fall under R-X1; see `findings-register.md` §3.4 and §5.4.

## Correction to the 18 October report

The 18 October report listed attachment upload during suspension among "low" residual items. It was a **Medium** finding (R-M3), as the H1 completion report stated; it is now closed. The "four low findings" referred to were R-L2, R-L3, R-L5 and R-L7, now all closed.

## Awaiting environment verification

| Item | Gate | Prepared |
|---|---|---|
| Hosting, TLS, secrets, alert routing, monitoring, log retention, image build and digests | G5 | `hosting-decision-sheet.md`, `deploy/` |
| Scheduled backups with failure alerts; restore in the hosting environment against agreed RPO/RTO; rollback rehearsal | G6 | Release job with pre-migration backup; jobs and timers |
| Field-device tests on the pilot devices (online-only: retained F tests and O1–O10, if the proposed scope is accepted) | G9 | `field-device-test-script.md`; `online-only-pilot-configuration.md` §5 |

## Decisions outstanding (outside software)

All decisions are listed with owners in `pilot-decision-pack.md`:

- pilot organisation, site, tasks and substances
- named hygienist
- methods and method approvals
- laboratory
- devices
- hosting, RPO and RTO
- privacy roles and retention
- support contacts
- training and pilot dates
- G11 authorisation

## Gates

| Status | Gates |
|---|---|
| Accepted | none |
| Ready for review | G8 (needs an external security review; for an online-only pilot, a scope decision by the platform owner and controller is proposed instead of the offline-specific requirements) |
| Awaiting external evidence | G3, G4, G5, G6, G7 |
| In progress | G10 (materials ready; no one trained) |
| Not started | G1, G2, G9, G11 |

## Exact scope eligible for pilot consideration

**None yet**, because no gate is accepted. When the gates are accepted, the scope eligible for consideration is limited to:

- airborne-contaminant personal exposure assessment, for one organisation and one site;
- the calculation versions the hygienist approves (candidates: `twa_8h` 1.2.1 and `stel_15` 1.1.1, with unit conversion if needed);
- the professional reference benchmarks imported for the substances the organisation names;
- online-only field capture (configuration in `online-only-pilot-configuration.md`), unless G8 and G9 are accepted in full for the named devices;
- the hosting environment verified under G5 and G6.

Out of scope: noise, vibration, thermal exposure, statistical compliance testing, AI assistance and live integrations.

## Remaining risks

| Risk | Severity | Mitigation / next step |
|---|---|---|
| No method professionally approved; H1-F01 awaiting disposition | High for pilot | G2/G3. Pilot conclusions are impossible until approval |
| No real reference data | High for pilot | G4. Template and controlled import are ready |
| No hosting, alert delivery, penetration test or hosting restore | High for pilot | G5/G6. Decision sheet is ready |
| Privacy roles and retention undecided | High for pilot | G7. PIA re-verified against the code |
| Offline protection depends on PIN strength and device management | Medium | Off by default; proposed online-only pilot; G8/G9 |
| Online-only operation loses unsent records if the page closes | Medium | Paper field-sheet procedure; warnings; device tests O3–O10 |
| Owner role is privileged (BYPASSRLS, table owner) | Low (R2-H3, residual) | Privileged-access rules (`approval-and-issue-controls.md` §4); database audit logging (G5) |
| Representativeness and statistics not assessed by the software | Medium | Professional interpretation; flagged prominently in the review handover |
| Open Low software findings | Low | `findings-register.md` §4 |

## Release decision

**Not for production.** The pilot decision is recorded separately under G11: **no pilot authorised.**
