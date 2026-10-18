# Release readiness report

**Updated:** 18 October 2026 (after Phase H1) · **Scope:** airborne contaminants · **Engine:** 1.3.1 (`twa_8h` 1.2.1, `stel_15` 1.1.1) · **Migrations:** 17

## Classification

**Internal prototype — pilot gates remain open.**

The evidence does not yet support a controlled pilot or a production release. Pilot readiness is tracked only in `pilot-gate-register.md`. **No gate is accepted.** Phase H1 details are in `phase-h1-completion-report.md`.

## Completed and verified (software, development environment)

- **Phases A–G**: working vertical workflows, persistence, authorisation and validation from the start. Forced row-level security on all 56 application tables. Append-only evidence and immutable approvals.
- **Phase H1 controls:**
  - pilot assurance levels set only by a platform operator
  - pilot conclusions and report issue limited to approved methods, professional-reference benchmarks and matching averaging periods
  - method status, provenance and assurance level frozen at approval
  - workflow suspension under stop conditions
  - offline data protection with server-side recovery
  - session idle timeout, MFA on pre-existing sessions, signed security alerts
  - backup and restore-verification scripts
  - controlled reference-data import
- **Automated evidence:** 127 tests, all passing (`test-evidence.md`); desktop browser check 21/21; development restore 18/18.
- **Independent software review:**
  - Three rounds during the build: no open critical or high findings.
  - One round on the Phase H1 controls: 3 high, 9 medium and 7 low findings. All high and medium findings are fixed with tests, except one documented gap: attachment upload is not gated by suspension. Four low findings remain documented.
  - The re-check result is recorded in the completion report.

## Awaiting environment verification

| Item | Gate |
|---|---|
| Production hosting, TLS, secrets manager, alert routing to people, uptime monitoring, log retention; penetration test or a documented decision | G5 |
| Scheduled backups with failure alerts, and a restore verified **in the hosting environment** with agreed RPO and RTO | G6 |
| Field capture on the actual pilot devices (22 tests); desktop Chromium results are not device evidence | G9 |

## Decisions outstanding (outside software)

| Decision | Owner | Gate |
|---|---|---|
| Pilot organisation, site, tasks and substances (chosen by the organisation) | SHEQ Experts + pilot organisation | G1 |
| Named competent occupational hygienist | SHEQ Experts | G2 |
| Method approvals from the signed validation pack | Reviewer | G3 |
| Professional reference data and method parameters; licensing | Reviewer + operator | G4 |
| PIA roles, retention per record class, support-access and incident procedures | DP adviser + controller | G7 |
| External security review of offline protection and acceptance of its limitations | Platform owner + controller | G8 |
| Training, support and incident contacts | SHEQ Experts | G10 |
| Final pilot authorisation | SHEQ Experts director + pilot organisation | G11 |

## Gates

| Status | Gates |
|---|---|
| Accepted | none |
| Ready for review | G8 |
| Awaiting external evidence | G3, G4, G5, G6, G7 |
| Not started | G1, G2, G9, G10, G11 |

## Remaining risks

| Risk | Severity | Mitigation / next step |
|---|---|---|
| Methods not reviewed by a competent hygienist | High | G2/G3. Enforced: pilot conclusions are impossible until approval |
| No real benchmark content | High | G4. Controlled import ready; pilot conclusions need professional reference rows |
| Offline data on devices | Medium | Off by default for real organisations. When enabled, protection depends on PIN strength and managed devices, and does not resist malware. Revocation waits for reconnection |
| No hosting, alert delivery, penetration test, or hosting restore | High for pilot | G5/G6 |
| PIA unreviewed; retention undecided | High for pilot | G7 |
| Representativeness and statistics (BS EN 689) not assessed by software | Medium | Reviewer interpretation; convention C18 |
| Attachment upload not gated by suspension; no database-level issue gate; no KEK rotation | Low | Documented in the completion report; address before production |

## Release decision

**Not for production.** The pilot decision is recorded separately in the completion report (§10): **no pilot authorised.**

## Next decision

1. Choose the pilot organisation and its substances.
2. Appoint the reviewing hygienist.
3. Choose hosting.

These unblock G1–G7. Do not expand into noise, vibration, thermal exposure, AI assistance or live integrations during this phase.
