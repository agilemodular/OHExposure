# Approval and report-issue controls

How an assessment can be approved and a report issued, what each path must satisfy, and where each rule is enforced.

## 1. Every path that can approve or issue

| Path | Approves? | Issues? | Enforcement |
|---|---|---|---|
| Web UI: *Approve revision* (`POST /assessments/rev/:id/approve`) → `assessments.approve()` | Yes | — | Service + database |
| Web UI: *Issue report* (`POST /assessments/:id/report/:rev`) → `reports.generateReport()` for an approved revision | — | Yes | Service + database |
| JSON APIs (`/api/sync`, `/api/field/bootstrap`) | No | No | — |
| Laboratory import, recovery import, offline sync | No: they create or update evidence only. Approvals already made are frozen. Later changes produce a staleness notice, never an altered conclusion. | No | — |
| Background job: integration delivery | No: sends copies of approved findings. Held during approval or issue suspensions. | No | Service |
| Operator CLI (`platform-controls`, `import-reference-data`, `recovery-keys`, `backup`, `restore-verify`) | **No command approves or issues.** Method reviews and pilot authorisations are records consulted by the gates, not approvals of assessments. | No | — |
| Organisation administrator tools | No: administrators hold neither `assess.approve` nor `reports.generate` | No | Service + database |
| **Direct SQL with the application credentials** (`ohea_app`, e.g. a compromised application process or a mistaken maintenance script using the application role) | Refused unless every database rule below holds | Refused unless every database rule below holds | **Database triggers** |
| Owner connection (`ohea_owner`: not superuser, BYPASSRLS, owns the tables) or a superuser | Triggers still apply to ordinary writes, but the owner can alter or disable them | Same | Not protected; see §4 |

## 2. Prerequisites and where each is enforced

| Prerequisite | Approval | Report issue |
|---|---|---|
| Tenant and client scope | RLS on every table, plus service checks. Trigger requires the reviewer to belong to the revision's organisation. | RLS. Trigger requires the revision to belong to the same assessment and client, and the issuer to the same organisation. |
| Authorised actor | Service: `assess.approve`. Trigger: the reviewer recorded is **the signed-in user** (`app_user()`) and an **active technical reviewer** of the organisation. The submitter recorded at submission must also be the signed-in user. | Service: `reports.generate`. Trigger: the issuer recorded is the signed-in user and an active practitioner or technical reviewer. |
| Separation of duties | Service and trigger: reviewer is not the author or submitter. The trigger compares against the stored author and submitter, which must exist and cannot be changed. Service only: reviewer did not record a QC disposition on the samples. | — |
| State transition | Trigger: new revisions are inserted only as drafts with an author and no review or approval data. Only `in_review` → `approved`. Once in review, the content is frozen; only the review outcome may change. Approved revisions are immutable (trigger from the build phase). | Trigger: the revision must be `approved` at issue time; read with a share lock. |
| Approved method and version | Pilot organisations: service and trigger. Effective status from `method_status_effective()`, so expired or withdrawn approvals don't count. Status is frozen on the revision. | Pilot: the revision must have been approved at pilot level with an approved method. Refused if that method version has since been withdrawn or rejected. |
| Suitable verified reference data | Pilot: service and trigger. `professional_reference` and `verified`; provenance frozen. | Pilot: frozen provenance must be `professional_reference`. |
| Matching averaging period | Pilot: service and trigger | Covered at approval |
| Current calculation inputs | **Service only, transactional.** Input hash recomputed against current evidence, with that evidence share-locked against concurrent amendment, void or QC change. | Not needed: the report is generated from the frozen approved snapshot. |
| Required professional review | Approval itself is the professional review: scope, limitations and confirmation are required by the service. | Only approved revisions can be issued (trigger). |
| Samples received during a suspension | Service and trigger: refused while a sample is flagged and not cleared, or has a held update or a held conflict | — |
| No applicable suspension or hold | Service and trigger. The tenant row and the assessment row are share-locked, so a suspension or hold cannot be committed between the check and the write. | Service and trigger (same locks) |
| Immutable approved evidence | Approved revisions, issued reports, audit, custody, lab revisions and action events are append-only or immutable (triggers and revoked grants) | Same |

## 3. Why this boundary

- **Database triggers** carry the rules that can be judged from the database alone: state, actor role, separation, suspension, holds, held samples, method status, provenance and averaging. Any write through the application credentials hits them, whatever code path produced it.
- **The current-inputs check** recomputes a hash over the calculation snapshot built by the application from many tables. Duplicating that in SQL would create a second implementation to keep in step. It stays in the service, inside the same transaction as the approval, with the evidence rows locked.
- Approval-time facts (method status, provenance, assurance level) are **taken by the trigger from the authoritative tables**. Values supplied by the caller are overwritten.

**Race conditions covered**

| Race | Control |
|---|---|
| Suspension between check and write | Share lock on the tenant row |
| Evidence change during approval | Share locks on the sampling events, the instruments they used and the benchmark version, against writers' update locks (results, QC, void, calibration, instrument status, benchmark verification) |
| Approval status changing during report issue | Share lock on the revision row in the issue trigger |
| Method withdrawal | A withdrawal committed after an approval doesn't alter it (history kept); later issue is refused |

## 4. Privileged maintenance access

Production uses three database identities:

| Identity | Rights | Used by |
|---|---|---|
| `ohea_app` | No RLS bypass; column grants; every trigger applies | The running application, and nothing else |
| `ohea_owner` | Owns the tables; BYPASSRLS; not superuser | The one-shot release job (migrations, pre-migration backup, recovery-key check), backup and restore-verification jobs, operator scripts |
| Cluster superuser | Everything | Database initialisation only; credentials sealed (break-glass) |

The running application never holds owner credentials: the server refuses to start in production if `DATABASE_ADMIN_URL` is present.

As table owner, `ohea_owner` can alter or disable triggers and write directly, and a superuser can do anything. **The platform does not claim protection against an unrestricted database administrator.** Requirements, to be confirmed with the hosting owner (G5):

- Owner credentials are held in the secrets manager. They are used only by the deployment entrypoint, backups, restore verification and operator scripts, never by the running application.
- Operator scripts write `platform.*` audit events. Any manual SQL with owner credentials must be:
  - done under a support or incident ticket (`support-and-incident-procedure.md` §4);
  - performed by two people;
  - logged with the statements run.
- Database server audit logging (e.g. `pgaudit`, or the managed provider's audit log) should capture owner-role sessions. It must be retained under the log-retention decision and reviewed after any use.
- Backups contain everything, including sealed recovery keys. Access to the backup location is restricted like owner access.
