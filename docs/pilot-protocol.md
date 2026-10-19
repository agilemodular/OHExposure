# Controlled pilot protocol

**Status:** template for agreement with the pilot organisation. Items marked *To be confirmed* must be filled in by the people responsible before gate G11; nothing here may be assumed. The pilot cannot start until every gate in `pilot-gate-register.md` is accepted.

## 1. Objectives

1. Show that the platform supports one complete, reviewed occupational hygiene workflow for real airborne-contaminant exposure at one site, in parallel with the hygienist's normal method.
2. Confirm calculations match independent hand calculation for every pilot result.
3. Confirm isolation, evidence integrity and offline capture behave as specified on the actual devices.
4. Identify defects, usability problems and missing capability before any production decision.

Not objectives: authorising work, replacing emergency arrangements, statistical compliance testing, any capability outside airborne contaminants.

## 2. Scope

| Item | Value |
|---|---|
| Organisation | *To be confirmed* (one) |
| Site | *To be confirmed* (one) |
| Processes / tasks | *To be confirmed* — limited set chosen by the organisation |
| Substances | *To be confirmed* — **chosen by the organisation**, not by the software team |
| Jurisdiction and benchmark source | *To be confirmed* (G4) |
| Sampling and analytical methods | *To be confirmed* (G4) |
| Laboratory | *To be confirmed* |
| Duration | *To be confirmed* (suggested: long enough to complete sampling → lab → review → action → follow-up monitoring for at least one group) |

## 3. Participants

| Role | Name | Organisation |
|---|---|---|
| Pilot lead | *To be confirmed* | SHEQ Experts |
| Competent reviewer (occupational hygienist) | *To be confirmed* (G2) | |
| Practitioner(s) | *To be confirmed* | |
| Field technician(s) | *To be confirmed* | |
| Site contact / action owner | *To be confirmed* | Pilot organisation |
| Client read-only user | *To be confirmed* | Pilot organisation |
| Platform operator | *To be confirmed* | SHEQ Experts |
| Data-protection contact | *To be confirmed* | |

## 4. Devices and environment

Pilot hosting environment (G5/G6). Field devices: *To be confirmed* — make/model, OS, browser, MDM configuration; each tested under G9. Offline capture enabled only if G8 and G9 are accepted; otherwise online-only capture.

## 5. Training

Before first use (G10), using `pilot-user-guides.md` and recorded in `training-record.md`: field capture and PIN/recovery; review and approval workflow; meaning of the three assessment states, method review status and benchmark provenance; limitations; stop conditions and how to report a problem.

## 6. Workflow to be exercised (in full, in parallel with the hygienist's usual method)

1. **Plan** — register processes, tasks, hazards and similar exposure groups with rationale; monitoring plan reviewed by someone other than the author.
2. **Sampling** — personal samples captured (offline only if enabled), with calibration evidence.
3. **Laboratory** — dispatch, receipt and chain of custody; results imported from the laboratory's real file; certificate attached.
4. **Reviewed assessment** — calculation, interpretation and conclusion by the practitioner; independent hand calculation of every result; approval by the competent reviewer.
5. **Control action** — where the assessment requires it, an action with a defined verification requirement.
6. **Follow-up** — implementation evidence recorded.
7. **Effectiveness verification** — post-control evidence (e.g. repeat monitoring) reviewed by someone other than the implementer; closure only on verified effectiveness.

Parallel running: the reviewer produces their usual assessment independently; differences are reconciled and recorded. **If the pilot does not produce a control intervention, or post-control evidence is not available in the pilot period, steps 5–7 are recorded as "not exercised" — a successful intervention or verified closure is never assumed or simulated.**

## 7. Success criteria

The acceptance tests P1–P14 in `pilot-acceptance-checklist.md` pass, plus: no stop condition triggered without resolution; zero unexplained calculation discrepancies; users complete the workflow without workarounds that bypass controls; reviewer confirms the reports are usable.

## 8. Support and incidents

Procedure: `support-and-incident-procedure.md`.

| Item | Value |
|---|---|
| Support contact and hours | *To be confirmed* |
| Incident contact (24 h) | *To be confirmed* |
| Data-protection incident contact | *To be confirmed* |
| Alert routing (webhook target) | *To be confirmed* (G5) |
| Escalation to stop the pilot | Pilot lead or competent reviewer |

## 9. Stop conditions

Any of the following stops the affected workflow immediately. Report to the pilot lead at once.

| # | Condition | Workflow(s) to suspend |
|---|---|---|
| SC1 | Any cross-organisation, cross-client or unauthorised worker-identity access | All (`field_sync,lab_import,assessment_approval,report_issue,action_closure`) |
| SC2 | Calculation discrepancy against hand calculation that cannot be explained | `assessment_approval,report_issue` |
| SC3 | Lost, duplicated or corrupted records (sync, import or restore) | The workflow concerned (e.g. `field_sync` or `lab_import`) |
| SC4 | A conclusion approved using an unapproved method or non-reference benchmark | `assessment_approval,report_issue` |
| SC5 | Any alteration of approved evidence, issued reports or the audit trail | All |
| SC6 | Material exposure of offline data (lost unlocked device, plaintext found on a device, recovery file misuse) | `field_sync` and switch offline capture off |
| SC7 | An action closed without verified effectiveness | `action_closure` |

**Procedure**

1. **Preserve evidence:** do not edit or delete records; note times, users, record ids; take screenshots; export the audit trail for the period; keep devices as they are (do not reset).
2. **Suspend:** a platform operator runs `scripts/platform-controls.ts suspend --tenant <id> --suspend <workflows> --reason "SCn: <summary>" --authorised-by "<name>"`. The suspension is shown to every user, raises a critical alert and is audited; existing records stay readable; field devices keep their copies.
3. **Notify** the responsible owner (pilot lead; data-protection contact for SC1/SC6) and, where required, the controller.
4. **Remediate and revalidate:** find the cause, fix it, add a regression test, and re-run the affected acceptance tests; record the outcome.
5. **Resume** only with a revalidation record: `platform-controls.ts resume … --evidence "<revalidation ref>"`.

Stopping one workflow does not invalidate evidence from other workflows unless the investigation shows they were affected; that judgement is recorded.

## 10. Rollback

If the pilot is stopped entirely: suspend all workflows; export the organisation's data for the hygienist's records; continue with the hygienist's usual method; decide on retention or deletion of pilot data under the PIA. Application rollback (a defective release) follows `operations.md` §Rollback.

## 11. Final review

At the end: results against P1–P14 and section 7; defects found and fixed; stop conditions triggered; reviewer's professional opinion on suitability; users' feedback; recommendation (production, second pilot, or rework) recorded in the release-readiness report. **The pilot decision and the release decision are recorded separately.**
