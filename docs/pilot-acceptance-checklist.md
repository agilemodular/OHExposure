# Pilot acceptance checklist

A controlled pilot can start when every **Before pilot** item is ticked. **During pilot** items are the acceptance tests the pilot must pass before any production decision.

## Before pilot

- [ ] Competent occupational hygienist has reviewed and signed off the calculation specification, safety-rule register and report template (D1).
- [ ] Benchmarks for the pilot substances entered from the current authoritative source and verified by a second person; reproduction rights checked (D2).
- [ ] Method versions for the pilot methods configured with their flow tolerances, ranges and minimum volumes (D3).
- [ ] Hosting with TLS, `COOKIE_SECURE=true`, changed database credentials, daily backups and one successful restore test (D7).
- [ ] Data-protection impact assessment completed; retention periods set with the pilot client (D8, D9).
- [ ] Field client tested on the actual site devices, including offline capture, reconnect, and device hand-over between users (D10).
- [ ] MFA enforced for the pilot tenant (default on for new tenants); all pilot users enrolled.
- [ ] Pilot users trained; written procedure stating that the platform does not authorise work or replace emergency arrangements.
- [ ] Demo tenant not present in the pilot environment.
- [ ] Third independent security/safety verification round completed with no open critical or high findings.

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
| P9 | Raise and close a control action using real commissioning/test evidence | Cannot close on installation alone; separation of reviewer and implementer holds |
| P10 | Client read-only user reviews issued report | Sees own client only; cannot see drafts or other clients |
| P11 | Export and audit review by administrator | Export complete; audit shows who changed, approved, downloaded what |
| P12 | Backup restore during pilot | Restored environment shows identical records and attachments |

## Exit decision

Record outcomes against P1–P12, defects found, and user feedback. The release readiness report is then updated with a recommendation for production, a second pilot, or rework.
