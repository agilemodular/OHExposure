# Suspension policy

**Purpose.** This policy says what remains possible while part of the platform is suspended under a stop condition (see `pilot-protocol.md` §9). It is enforced on the server. A platform operator applies and releases every suspension with `scripts/platform-controls.ts`, quoting a recorded reason and, on release, a revalidation reference.

## Kinds of suspension

| Kind | Applied with | Scope |
|---|---|---|
| **Workflow suspension** | `suspend --tenant <id> --suspend <workflows>` | One or more of the five workflows of one organisation: `field_sync`, `lab_import`, `assessment_approval`, `report_issue`, `action_closure` |
| **Organisation suspension** | `suspend --tenant <id> --suspend all` | All five workflows of one organisation |
| **Assessment hold** | `hold --assessment <id> --reason …` / `release … --evidence …` | One assessment (for example SC2, a calculation discrepancy in one assessment) |

Reading never stops. Every record stays readable and exportable, so the investigation can proceed.

## What is permitted

● permitted · ✕ refused · Q quarantined intake only · H held for review

| Action | Workflow suspended (the action's own workflow) | Organisation suspended | Assessment on hold (that assessment) |
|---|---|---|---|
| Read, search, export, view audit trail | ● | ● | ● |
| Create or edit field samples (online) | ✕ `field_sync` | ✕ | ● (samples are not part of an assessment until selected) |
| Offline synchronisation | **H**: each item is stored in `field_intake_holds` and the device keeps it pending (`deferred`). When it later synchronises it is flagged for review and cannot support a submission or approval until someone other than the submitter clears it. | H | ● |
| Custody, void, QC checks and dispositions | ✕ `field_sync` | ✕ | ● |
| Apply a device copy to resolve a sync conflict | ✕ `field_sync` | ✕ | ● |
| Recovery-file import | **H**: items are processed as offline synchronisation | H | ● |
| Lab dispatch, receipt, manual results, amendments, CSV commit | ✕ `lab_import` | ✕ | ● |
| Ordinary attachment upload | ✕ for sampling events (`field_sync`); lab submissions, results and imports (`lab_import`); inspections and actions (`action_closure`); assessments (`assessment_approval`). Calibration, instrument and control files: ● | ✕ for those record types | ● |
| Remediation evidence intake | **Q**: practitioners and technical reviewers only, with a reason. The file is quarantined: readable, but not admitted and not linkable as evidence. | Q | ● |
| Admit quarantined evidence | ✕ until the workflow is resumed. Then a technical reviewer other than the uploader, with notes. | ✕ | ● |
| Link an attachment as evidence (e.g. lab certificate) | Quarantined, unadmitted files are refused at linking and again at CSV commit | same | same |
| Edit draft assessment, recalculate | ● (drafts only; nothing is approved) | ● | ✕ |
| Submit for review | ● | ● | ✕ |
| Approve | ✕ `assessment_approval`, enforced in the service **and** the database | ✕ | ✕ (service and database) |
| Create a new revision | ● | ● | ✕ |
| Generate draft report (watermarked) | ● | ● | ● |
| Issue report | ✕ `report_issue`, service and database | ✕ | ✕ (service and database) |
| Corrective action effectiveness review, closure, cancellation | ✕ `action_closure` | ✕ | ● |
| Raise or assign actions, record implementation | ● (no verification decision is made) | ● | ● |
| Outbound integration delivery (background job) | Held, left pending, while `assessment_approval` or `report_issue` is suspended | Held | ● |
| Disposal requests and decisions | ✕ while **any** workflow of the organisation is suspended (evidence must be preserved) | ✕ | ● |
| User administration (add, suspend, reset two-step) | ● (needed for containment) | ● | ● |
| Retention settings | ● (no records are deleted by changing them) | ● | ● |
| Platform operator controls (suspend, resume, hold, release, level, offline) | ● (owner connection; audited) | ● | ● |
| Backups and restore verification | ● | ● | ● |

## Timing and in-flight work

- **Tenant row lock.** Every suspension check takes a share lock on the organisation's tenant row for the rest of its transaction.
  - A suspension committed while an upload, import, sync item or approval is finalising waits for that transaction to finish.
  - Anything that finalises after the suspension is refused, or held for offline items.
  - An upload that began before the suspension but finishes after it is refused at finalisation.
- **Per-item checks.** Offline synchronisation checks suspension per item, inside each item's transaction. A suspension cannot slip in mid-batch.
- **Evidence locks.** Approval checks share-lock the evidence (sampling events). A laboratory amendment, void or QC change cannot commit between the approval's evidence check and the approval itself. After such a change the approval is refused until recalculation.

## Audit

| Event | Audit action |
|---|---|
| Suspension, resumption, hold, release | `platform.workflow_suspended`, `platform.workflow_resumed`, `platform.assessment_hold`, `platform.assessment_release` (with reason, authoriser and revalidation reference). Suspension also raises a critical alert. |
| Refused attempt | `workflow.blocked` or `assessment.blocked`, with workflow or assessment, action and reason. Written on a separate connection, so the record survives the refused transaction's rollback. |
| Permitted exceptions | `attachment.remediation_intake`, `attachment.admitted`, `field.sync_held`, `sample.suspension_review_cleared`, `integration.delivery_held` |

## Limits

- **Owner connection.** Suspension does not restrict the owner (administrator) connection used by platform operators. See `approval-and-issue-controls.md` §4.
- **Offline devices.** A device that stays offline does not know about a suspension. Its records are held when it reconnects.
- **Records captured during a suspension but synchronised only after resumption.** These are not detected; the capture time alone is not trusted. They are not flagged. Every assessment still needs professional review of the samples it uses.
