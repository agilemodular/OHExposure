# Pilot acceptance checklist

**During pilot** items are the acceptance tests the pilot must pass before any production decision. The pilot itself runs under `pilot-protocol.md`, including its stop conditions.

## Before pilot

Pre-pilot readiness is tracked only in **`pilot-gate-register.md`** (gates G1–G11, with owners, acceptance criteria, evidence and reviewer decisions). A controlled pilot can start only when every gate there is accepted. As of 18 Oct 2026 no gate is accepted.

Completed software verification that supports the gates: three independent security/safety verification rounds with no open critical or high findings (17 Oct 2026); Phase H1 controls and tests (18 Oct 2026, see `test-evidence.md`).

## During pilot — acceptance tests

| # | Test | Pass criterion |
|---|---|---|
| P1 | Register a real process, task, hazard and similar exposure group with rationale | Practitioner completes without support; reviewer agrees grouping basis |
| P2 | Plan reviewed by someone other than the author, then scheduled | Author cannot self-review; review recorded |
| P3 | Capture at least 10 personal samples, some offline | All synchronise; no duplicates; any conflicts resolved explicitly |
| P4 | Dispatch, receipt and lab results imported from the laboratory's real file | Import validates; chain of custody complete; source certificate attached |
| P5 | Independent hand calculation of every TWA in one assessment | All values agree to stated precision |
| P6 | Include at least one non-detect, one interrupted sample and one failed QC check | Non-detect shown as interval; interruption subtracted; QC failure requires disposition |
| P7 | Assessment approved by a reviewer; report issued | Report matches the approved revision; reviewer, scope and limitations shown |
| P8 | Amend a lab result after approval | Approved conclusion unchanged; staleness notice; new revision required |
| P9 | Raise and close a control action using real commissioning/test evidence | Cannot close on installation alone; separation of reviewer and implementer holds. If no intervention or post-control evidence occurs in the pilot period, record *not exercised* — never simulated |
| P10 | Client read-only user reviews issued report | Sees own client only; cannot see drafts or other clients |
| P11 | Export and audit review by administrator | Export complete; audit shows who changed, approved, downloaded what |
| P12 | Backup restore during pilot | `restore-verify.ts` in the hosting environment passes all checks (counts, RLS, migrations, attachment hashes) |
| P13 | Pilot conclusion attempted with an unapproved method or organisation-entered benchmark | Refused by the server with a message naming the reason |
| P14 | Offline recovery: forgotten PIN on a real device | Recovery file imported by a reviewer; records arrive once, attributed to the capturing user |

## Exit decision

Record outcomes against P1–P14, defects found, and user feedback. The release readiness report is then updated with a recommendation for production, a second pilot, or rework.
