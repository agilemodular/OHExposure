# Privacy impact assessment — draft for the pilot

**Status:** DRAFT prepared by the development team, 18 Oct 2026; data flows re-verified against the code on 19 Oct 2026 (§3a). Ready for review by the people named in §8. **Not reviewed** by a data-protection adviser, the controller (pilot organisation) or SHEQ Experts. It does not by itself close pilot gate **G7 (privacy and retention)**; the decisions marked *To be confirmed* must be made and recorded by the people named. This is not legal advice.

## 1. Processing in scope

Occupational hygiene exposure assessment for airborne contaminants: registering work, planning and capturing samples (including offline), laboratory results, calculations, professional review, reports, corrective actions and verification, for one pilot organisation and site.

## 2. Roles

| Party | Role (proposed — *to be confirmed* by the DP adviser) |
|---|---|
| Pilot organisation (employer of the workers sampled) | Controller for its workers' exposure records |
| SHEQ Experts Limited (Assurentra), as consultancy using the platform | Processor, or joint controller where it gives professional opinions in its own name — *to be confirmed* |
| SHEQ Experts Limited, as platform provider | Processor (hosting and operation) |
| Hosting provider (database, storage, logs, backups) | Sub-processor — *to be confirmed* (not yet selected; gate G5) |
| Alert receiver (webhook target: e-mail/chat/on-call service) | Sub-processor if used — alert payloads contain user ids, tenant ids and IP-derived keys only, never exposure data |
| Laboratory | Separate controller/processor under its own contract; the platform imports its result files, no live connection |

No AI provider, e-mail provider, analytics or advertising service is used. Integrations with other Assurentra products are disabled/mock only and transmit nothing.

## 3. Data categories and flows

| Category | Examples | Source | Where held | Who can see it |
|---|---|---|---|---|
| Worker identity | Full name, employee number | Organisation | `worker_identities` — separate table, readable only in sessions with the identifiable-data permission (`app.pii`) | Roles with worker-identity permission; **never sent to field devices**; never in reports by default (reports use reference codes) |
| Pseudonymous worker reference | Reference code (e.g. NF-W01), group memberships | Organisation | Server; encrypted on field devices when offline is enabled | Users of that organisation/client |
| Exposure records | Sample times, location descriptions, tasks performed, control status, results, calculations, interpretations | Field staff, laboratory | Server; offline records encrypted on devices until synchronised | Users of that organisation/client; client read-only users see issued reports for their client |
| Health data | **Not collected.** Free-text fields carry a reminder not to record health information | — | — | — |
| User accounts | Name, e-mail, role, password hash (scrypt), TOTP secret, MFA state | Administrators | `users` (secrets not readable by the application role) | Administrators of that organisation |
| Security and audit | Sign-in events, IP address, user agent, every change, approval, download, export | System | `audit_events` (append-only), `sessions`, `login_throttle` (IP keyed counters) | Organisation administrators (audit), platform operators |
| Attachments | Lab certificates, calibration certificates, photographs | Users | Attachment store (per-organisation folder; SHA-256 verified); flagged when identifiable | Users of that organisation/client |
| Backups | Copies of all of the above | System | Backup location (hosting — *to be confirmed*) | Hosting owner |
| Recovery files | Encrypted field records exported from a device | Field user | User's download; imported server-side | Opened only by the server for that organisation; importer needs `conflicts.resolve` |

Flow: field device ⇄ application (HTTPS) ⇄ PostgreSQL + attachment store → backups. Laboratory files uploaded by users. Reports generated server-side and downloaded/printed by users.

### 3a. Actual worker-data flows (verified against the code, 19 Oct 2026)

| Flow | Who and how | Control |
|---|---|---|
| Entry of worker identities (name, employee number) | Organisation administrators and practitioners (`worker.identity.write`) on the register pages | Separate table; RLS requires the identifiable-data flag, set only for roles with `worker.identity.read` (administrator, practitioner, technical reviewer) |
| Use in fieldwork | Field devices receive **reference codes only**; names never leave the server for the field client | `/api/field/bootstrap` sends reference codes only (browser-checked) |
| Offline copies on devices | Only when offline capture is enabled (off by default): encrypted records and reference cache; recovery envelopes; purge after 24 h of sync; reference expiry after 7 days | `offline-field-capture.md` (key management summary) |
| Records held during a suspension | Payloads of field records submitted while sync is suspended, kept in `field_intake_holds` (reference codes, not names) | Tenant RLS; reviewer access only (`conflicts.resolve`) |
| Recovery files | Ciphertext only; opened server-side by practitioners for the same organisation; imports audited | `/field/recovery` |
| Reports | Worker reference codes; names are not printed | Report generator |
| Exports | Full JSON export by roles with `export.data`; **identities are included only if the exporting user may read them**; every export audited (`export.full`, with `includes_identities`) | Administrator, practitioner, reviewer |
| Integrations | Disabled or mock only; contracts carry reference codes (`worker_ref`), never names | `integration-contracts.md` |
| Support access | Platform operators via the owner connection, on a ticket, two-person rule for manual SQL | `support-and-incident-procedure.md` §4; `approval-and-issue-controls.md` §4 |
| Backups | Contain everything, including identities and sealed recovery keys; retention to be decided (§5); disposal in live data is not propagated to existing backups | `hosting-decision-sheet.md` |
| Audit trail | Records who viewed, changed, exported or downloaded what; IP addresses kept | Retention to be decided |
| Incidents | `support-and-incident-procedure.md` §3, including lost devices and misdirected recovery files | Contacts to be confirmed |

## 4. Purposes and lawful basis (*to be confirmed* by the controller and DP adviser)

Purpose: assessing and controlling workers' exposure to hazardous substances and demonstrating that controls work. Likely basis: legal obligation of the employer (e.g. COSHH in GB) and legitimate interests for related security processing. If health surveillance data were ever added, special-category conditions would apply — **out of scope** for this product phase.

## 5. Retention decisions required

The platform supports per-organisation retention policies by record class and two-person disposal (requester ≠ approver, enforced in the database); disposal pseudonymises worker identities (`[disposed]`) and marks attachments disposed while keeping exposure records and the audit trail. **No default periods are asserted.** Different classes need different periods; one period for everything is not appropriate.

| Record class | Consideration | Decision | Decided by | Date |
|---|---|---|---|---|
| Exposure monitoring records (samples, results, assessments, reports) | Statutory minimums may apply for exposure records (in GB, COSHH requires at least 5 years for monitoring records, and 40 years where records are representative of personal exposures of identifiable employees) — *to be verified against current legislation by the DP adviser* | *To be confirmed* | Controller + DP adviser | |
| Worker identities | Needed to link exposure to individuals; may be disposed earlier than exposure records if retention rules allow | *To be confirmed* | Controller + DP adviser | |
| Attachments | Follow the record they evidence | *To be confirmed* | Controller | |
| Audit events | Security and evidential value; append-only | *To be confirmed* | Controller + platform provider | |
| User accounts after leaving | Deactivate rather than delete while their approvals remain evidential | *To be confirmed* | Controller | |
| Sessions, login throttle counters | Operational; short | *To be confirmed* (proposal: sessions expire after 10 h; throttle windows minutes) | Platform provider | |
| Backups | Rolling; disposal in live data is not propagated to backups until they expire | *To be confirmed* (script default 35 days; managed PITR window per hosting) | Hosting owner | |
| Field devices | Synchronised copies removed after 24 h; reference data refused after 7 days; unsynchronised records kept until synchronised or recovered | Implemented; *to be confirmed* as acceptable | Controller | |
| Pilot data after the pilot | Keep, export to the organisation, or delete | *To be confirmed* | Controller | |

## 6. Rights, export and deletion

Administrators can export the organisation's data (audit-logged). Access requests can be served from worker identity and exposure records. Erasure is limited by statutory retention of exposure records; where permitted, two-person disposal pseudonymises the identity. Rectification is by new revisions (history kept), not overwriting.

## 7. Risks and mitigations

| Risk | Mitigation in place | Residual / action |
|---|---|---|
| Cross-organisation or cross-client disclosure | PostgreSQL row-level security forced on every table; client scoping; tests and three independent software reviews | Penetration test not done (G5/D8) |
| Identifiable data seen by roles that do not need it | Separate identity table; `app.pii` guard; field devices get reference codes only | Confirm role assignments with the controller |
| **Offline device lost or shared** | Online-only by default; offline only when enabled per organisation after gate G8; AES-256-GCM encryption under a device PIN; inactivity lock; per-user stores; 24 h purge; recovery without PIN via server-sealed envelopes | Does not protect against malware, an unlocked device or weak PINs (see `offline-field-capture.md`); requires managed devices |
| **Revoked user keeps access on an offline device** | Revocation enforced at next connection; reference expiry 7 days | Inherent to offline use; device management and procedures |
| Recovery file mislaid | Contains ciphertext only; opened only server-side for that organisation; import audited and alerted | Instruct users to delete after hand-over |
| Support access to customer data | Platform operators use the owner connection outside the application; actions are scripted and audited (`platform.*` events) | Draft procedure in `support-and-incident-procedure.md` §4 — *to be agreed* |
| Incident (breach, lost device, wrong disclosure) | Alerts for lockouts, throttling, suspensions; audit trail; workflow suspension under stop conditions | Draft procedure in `support-and-incident-procedure.md` §3; contacts and notification timelines *to be confirmed* |
| Backups and offline copies outlive deletion | Documented above | Retention decision for backups |
| Free text containing health or third-party data | On-screen reminders | Training (gate G10) |

## 8. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Data-protection adviser | | | |
| Controller (pilot organisation) | | | |
| SHEQ Experts (platform provider) | | | |
