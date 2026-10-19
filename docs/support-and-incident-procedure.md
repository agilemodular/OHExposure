# Pilot support and incident procedure

**Gates:** G7 (incident handling, support access) and G10 (support contacts).
**Status:** template. Every *To be confirmed* entry must be completed and agreed by SHEQ Experts and the pilot organisation before the pilot starts. Nothing here is in force until then.

## 1. Contacts

| Role | Name | Phone | E-mail | Hours | Deputy |
|---|---|---|---|---|---|
| Pilot lead (SHEQ Experts) | *To be confirmed* | | | | |
| Competent reviewer (occupational hygienist) | *To be confirmed* | | | | |
| Platform operator | *To be confirmed* | | | | |
| Hosting on-call | *To be confirmed* | | | 24 h? *To be confirmed* | |
| Data-protection contact (SHEQ Experts) | *To be confirmed* | | | | |
| Data-protection contact (pilot organisation, controller) | *To be confirmed* | | | | |
| Site contact | *To be confirmed* | | | | |

Security alerts from the platform (account lockouts, throttling, failed backups, suspended workflows, invalid recovery keys, recovery imports) are routed to: *To be confirmed* (gate G5).

## 2. Ordinary support

| Severity | Examples | Response target (*to be confirmed*) | Route |
|---|---|---|---|
| S1 — blocked, possible harm or data exposure | Any stop condition in §3 | Immediate (phone) | §3 |
| S2 — blocked, no harm | Cannot sign in; sync keeps failing; import refused unexpectedly | Same working day | Phone or e-mail to the pilot lead |
| S3 — degraded | A screen is slow or confusing; a wording problem | 2 working days | E-mail |
| S4 — suggestion | Feature requests | Logged for the pilot review | E-mail |

**When reporting, include:** what you were doing; the time and time zone; record references (sample code, assessment title); the exact message; device and browser for field problems. Do **not** send worker names, passwords, PINs or recovery files by e-mail. Recovery files go to a practitioner in person or by an agreed secure transfer.

**Before reporting, check these first:**
- **Locked account.** Wait 15 minutes, or ask the administrator.
- **Session ended.** Sign in again. Field records stay on the device or, in online-only mode, in the open page.
- **Times refused as "in the future".** Check the device clock and time zone.

## 3. Incidents and stop conditions

The stop conditions are those in `pilot-protocol.md` §9:

| Code | Stop condition |
|---|---|
| SC1 | Cross-organisation or unauthorised access to identities |
| SC2 | Unexplained calculation discrepancy |
| SC3 | Lost or corrupted records |
| SC4 | Conclusion approved on an unapproved method or benchmark |
| SC5 | Approved evidence or the audit trail altered |
| SC6 | Offline data exposed |
| SC7 | Action closed without verification |

Other incidents include a lost or stolen device, a suspected compromised account, a recovery file sent to the wrong person, and an alert of `backup.failed`, `restore_verify.failed` or `recovery_key.invalid`.

| Step | Who | What |
|---|---|---|
| 1. Stop and preserve | Whoever notices | Stop the affected work. Don't edit, delete or "fix" records, and don't reset devices. Note times, users and record references. Take screenshots. |
| 2. Report | Whoever notices | Phone the pilot lead at once (deputy if unavailable). For possible personal-data exposure, also the data-protection contacts. |
| 3. Contain | Pilot lead → platform operator | Suspend the affected workflows (`platform-controls.ts suspend … --reason "SCn: …"`). For a lost device or compromised account: suspend the user, which ends their sessions; consider switching offline capture off. For a misdirected recovery file: ask the recipient to delete it. It can only be opened by the server, and imports are audited. |
| 4. Assess | Pilot lead with the reviewer and DP contacts | Scope (which records, users, time window), cause, and whether personal data was exposed. Export the audit trail for the window. |
| 5. Notify | Controller (pilot organisation), advised by DP contacts | Decide whether regulators or individuals must be told, within the legal time limits (*to be confirmed* by the DP adviser for the applicable law). Record the decision even if no notification is made. |
| 6. Remediate and revalidate | Development team, reviewer | Fix the cause, add a regression test, re-run the affected acceptance tests, and record the evidence. |
| 7. Resume | Platform operator, on the pilot lead's decision | `platform-controls.ts resume … --evidence "<revalidation ref>"`. |
| 8. Review | Pilot lead | Record the incident in the log below; feed it into the pilot final review. |

**Lost or stolen field device (with offline capture on):**
1. Suspend the user.
2. Note whether the device was locked.
3. Records on it are encrypted under the user's PIN, and the reference cache expires after 7 days.
4. Ask the user whether their PIN could be guessed.
5. Unsynchronised records on that device are lost unless a recovery file was exported earlier.
6. Treat it as SC6 if the device was unlocked or the PIN is weak.

## 4. Support access to organisation data

| Rule | Detail (*to be confirmed*) |
|---|---|
| Who | Named platform operators only |
| When | Only on an open support or incident ticket, with the pilot organisation's permission recorded on the ticket, except in an emergency affecting security, when the pilot lead decides and informs the organisation afterwards |
| How | Owner-connection scripts that write `platform.*` audit events. No browsing of identities. Use reference codes. |
| Record | Ticket reference, who, when, what was accessed and why |
| Never | Approve, sign off or alter assessments, method reviews or reports on anyone's behalf |

## 5. Incident log

| Ref | Date/time | Reported by | Category / stop condition | Workflows suspended | Personal data involved? | Notified | Remediation and revalidation | Resumed | Closed by |
|---|---|---|---|---|---|---|---|---|---|
| *None* | | | | | | | | | |
