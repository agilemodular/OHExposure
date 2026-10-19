# Release readiness report

**Updated:** 19 October 2026 (after Phase H2) · **Scope:** airborne contaminants · **Engine:** 1.3.1 (`twa_8h` 1.2.1, `stel_15` 1.1.1) · **Migrations:** 22

## Classification

**Internal prototype — pilot gates remain open.**

No pilot gate is accepted and no pilot is authorised. Readiness for a pilot is tracked only in `pilot-gate-register.md`. Technical findings are tracked only in `findings-register.md`. Phase details: `phase-h1-completion-report.md`, `phase-h2-completion-report.md`.

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
- **Automated evidence:** 156 tests, all passing. Desktop browser check 24/24. A development restore was verified as the non-superuser owner. **None of this is hosting or device evidence.**
- **Independent software review (R2).** R2 reviewed the Phase H2 controls, re-checked the fixes, then re-checked the final fixes.
  - The first review found 2 critical, 4 high, 8 medium and 9 low findings, plus 9 more from the re-checks.
  - **All Critical, High and Medium software findings are closed.**
  - The open Low findings are listed in `findings-register.md` §4.
  - Two final fixes (R2-P1, R2-P2) are verified by tests but have not been re-reviewed.

## Correction to the 18 October report

The 18 October report listed attachment upload during suspension among "low" residual items. It was a **Medium** finding (R-M3), as the H1 completion report stated; it is now closed. The "four low findings" referred to were R-L2, R-L3, R-L5 and R-L7, now respectively closed, closed, mitigated and fixed.

## Awaiting environment verification

| Item | Gate | Prepared |
|---|---|---|
| Hosting, TLS, secrets, alert routing, monitoring, log retention, image build and digests | G5 | `hosting-decision-sheet.md`, `deploy/` |
| Scheduled backups with failure alerts; restore in the hosting environment against agreed RPO/RTO; rollback rehearsal | G6 | Release job with pre-migration backup; jobs and timers |
| Field-device tests F1–F23 on the pilot devices | G9 | `field-device-test-script.md` |

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
| Ready for review | G8 (needs an external security review and a controller decision on PIN-strength residual risk) |
| Awaiting external evidence | G3, G4, G5, G6, G7 |
| In progress | G10 (materials ready; no one trained) |
| Not started | G1, G2, G9, G11 |

## Exact scope eligible for pilot consideration

**None yet**, because no gate is accepted. When the gates are accepted, the scope eligible for consideration is limited to:

- airborne-contaminant personal exposure assessment, for one organisation and one site;
- the calculation versions the hygienist approves (candidates: `twa_8h` 1.2.1 and `stel_15` 1.1.1, with unit conversion if needed);
- the professional reference benchmarks imported for the substances the organisation names;
- online-only field capture, unless G8 and G9 are accepted for the named devices;
- the hosting environment verified under G5 and G6.

Out of scope: noise, vibration, thermal exposure, statistical compliance testing, AI assistance and live integrations.

## Remaining risks

| Risk | Severity | Mitigation / next step |
|---|---|---|
| No method professionally approved; H1-F01 awaiting disposition | High for pilot | G2/G3. Pilot conclusions are impossible until approval |
| No real reference data | High for pilot | G4. Template and controlled import are ready |
| No hosting, alert delivery, penetration test or hosting restore | High for pilot | G5/G6. Decision sheet is ready |
| Privacy roles and retention undecided | High for pilot | G7. PIA re-verified against the code |
| Offline protection depends on PIN strength and device management | Medium | Off by default; G8/G9 |
| Owner role is privileged (BYPASSRLS, table owner) | Medium | Privileged-access rules (`approval-and-issue-controls.md` §4); database audit logging (G5) |
| Representativeness and statistics not assessed by the software | Medium | Professional interpretation; flagged prominently in the review handover |
| Open Low software findings | Low | `findings-register.md` §4 |

## Release decision

**Not for production.** The pilot decision is recorded separately under G11: **no pilot authorised.**
