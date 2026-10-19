# Pilot user guides

**For:** people using the platform in the controlled pilot (gate **G10**). One section per role. Read *For everyone* first.
**Applies to:** engine 1.3.1, Phase H1 build. Screens and button names are those in the application; if they differ from what you see, report it (support procedure §2).

## For everyone

**What the platform is for.** It records how exposure to airborne substances was measured, what the results were, what a competent person concluded, and whether controls were then shown to work.

**What it is not for.** It does not authorise work, it is not a permit system, and it does not replace emergency arrangements or the competent person's judgement. It never says exposure is "safe" or "compliant".

**Three separate states.** Every assessment shows three things side by side. Read all three; none of them is a verdict.
- **Data quality:** complete, qualified, incomplete or failed.
- **Benchmark comparison:** below, at or above, indeterminate, not comparable, or no verified benchmark.
- **Professional review:** draft, in review or approved.

**Two more labels.**
- **Method review status:** whether a competent hygienist has approved the calculation method. In the pilot, only approved methods can support a conclusion.
- **Benchmark provenance:** *Professional reference*, *Entered by organisation* or *Synthetic*.

**"Insufficient evidence — not calculated"** means the inputs do not support a number. That is a result, not an error; do not work around it.

**Signing in.**
- Your organisation requires two-step verification. Set it up at first sign-in with an authenticator app.
- After 5 wrong passwords the account locks for 15 minutes. After 10 wrong two-step codes it locks for 30 minutes.
- Sessions end after 10 hours, or after 2 hours without activity.

**Personal data.**
- Workers are identified by reference codes. Only some roles can see names.
- Never type names, health information or other personal details into notes, deviations or free-text fields.

**If something looks wrong**, for example a number that doesn't match your own calculation or a record you shouldn't see: stop, don't try to fix it, and report it at once (support procedure §3). Some problems are stop conditions.

## Data-quality flags (everyone who reads results)

| Flag or label | Meaning | What to do |
|---|---|---|
| *Data: complete* | No issues found | Still read the interpretation |
| *Data: qualified* | Results are usable with a caveat (e.g. flow drift above tolerance, volume below the method minimum, a QC failure accepted with justification, an interruption) | Read each flag; the interpretation must explain it |
| *Data: incomplete* | A required input is missing (times, flows, limits) or a rule stops the calculation (unsampled time without a justified assumption, overlapping samples, exposure period too short) | Fix the input or record the assumption; never estimate around it |
| *Data: failed* | No usable personal results (all excluded) | Investigate; resample if needed |
| *indicative* | Screening-only instrument, method not for formal assessment, or calibration missing, expired or failed on the sampling date | Not used for formal comparison; if it is at or above the benchmark the comparison becomes *indeterminate* |
| *range 0–x* / *interval* | A non-detect or below-LOQ result: the true value lies in the range | Never read the upper value as the measured value or the lower as zero exposure |
| *Benchmark: indeterminate* | The range straddles the benchmark, a result could not be calculated, or a high indicative or excluded result exists | Not favourable; explain or obtain better evidence |
| *Needs suspension review* | The record reached the server during a suspension | A reviewer other than the submitter must clear it before use |
| *Quarantined remediation evidence* | A file accepted during a suspension | Not evidence until a technical reviewer admits it |

## When something is suspended or on hold (everyone)

- **What you will see.** A red banner names the suspended work and the reason. Actions in it are refused with *suspended*; an assessment on hold says *on hold*. Everything stays readable.
- **What to do.** Do not look for a way round. Note what you were doing and tell the pilot lead (`support-and-incident-procedure.md`).
- **Field technicians.** Keep capturing only if told to; records you send while field sync is suspended stay on your device and a copy is held on the server for review.
- **Practitioners and reviewers.** Evidence needed for the investigation can be uploaded through **Remediation intake** with a reason. It stays quarantined until a technical reviewer admits it after the work is resumed.
- **Escalation.** A suspension is released only by a platform operator, quoting the revalidation record. Do not ask administrators to release it; they can't.

## Field technician

You capture samples on site, including offline if your organisation has offline capture switched on.

1. **Before going to site.** Open **Field sampling** while online. Your plans, worker reference codes, instruments and methods are loaded onto the device.
2. **Device PIN (offline capture only).**
   - The first time, choose a device PIN: at least 8 characters including a letter or symbol. It is not your account password.
   - Records on the device are encrypted with it. The screen locks after 15 minutes without activity. Use **Lock now** whenever you put the device down.
   - Change it with **Change PIN** while unlocked. Never share it.
   - Wrong PINs never delete records, but delays build up after three wrong attempts.
3. **Capture a sample.** Choose **New sample** and fill in:
   - plan, sample code and type;
   - worker reference (personal samples);
   - substance, method and instrument;
   - time zone, start and finish;
   - flow before and after;
   - interruptions, as `start/end/reason` in local time separated by semicolons;
   - tasks performed, control status, operating conditions and deviations.

   Press **Save on this device** (offline) or **Save and send** (online-only).
4. **Times.** Times are local to the time zone shown. A start, finish or interruption more than 15 minutes in the future is refused: check the device clock and time zone. If the device clock is more than 5 minutes out, the server warns you after syncing.
5. **Syncing.** Records sync when you reconnect, or when you press **Sync now**. Statuses:
   - *Waiting to sync*
   - *Synchronised*
   - *Conflict — kept for review*: someone changed the record on the server; a reviewer will decide.
   - *Rejected — needs correction*: read the message, then **Edit**.
6. **Online-only mode (the pilot configuration unless offline capture is accepted).** Nothing is stored on the device.
   - **Save and send** sends the record straight away. Only *Saved on the server* means the server has it.
   - *Sending — not yet confirmed* means wait. *Not saved — send again* means the server did not confirm it: the record is held **only in this open page**.
   - Nothing is ever resent automatically, even when the connection comes back. When you are connected, press **Send again**. Sending twice is safe: the server recognises a record it already has.
   - Don't close or reload the page while a record is not saved. If your session ended, sign in again in another tab, then press **Send again** here.
   - *Held on the server for review* means field synchronisation was suspended: the server kept a copy, but it is not a sample record until a reviewer accepts it. Do not re-enter it.
7. **When the connection drops during fieldwork (online-only).**
   - Before going to site, check signal at the sampling locations. Carry the paper field sheet (sample code, worker reference, pump, start and finish times, flows, interruptions, tasks, control status).
   - If you cannot save, keep sampling as planned and write the details on the paper sheet at the time they happen. Do not rely on the open page holding unsent records: a flat battery, a crash or a closed tab loses them.
   - When back in signal, press **Send again** for any *Not saved* record, then enter any records that exist only on paper with **New sample**, using the times from the sheet.
   - Hand the paper sheet to the practitioner with the samples. Note in *Deviations* that the record was entered from a paper sheet after a connection loss.
8. **Instruments.** A pump whose calibration has expired or failed can still be recorded. The result is then only indicative and can't support a formal comparison, and the sync warning tells you this.
9. **Attachments and photographs** are added online from the sample's page (**Upload**), never in the field client.
10. **Shared devices.** Each person has a separate, encrypted store. If you see a notice that another user has unsynchronised records, don't try to open them. Use **Export recovery file** next to the notice and give the file to a practitioner.
11. **Forgotten PIN, lost access or leaving the pilot.**
    - On the lock screen choose *Forgotten your PIN?* → **Export recovery file** and give the file to a practitioner.
    - The file is encrypted and can only be opened by the server for your organisation. Delete your copy once it has been imported.
    - Only then use **Reset this device**.
12. **Custody.** Record hand-over and dispatch as they happen. Once a sample is dispatched, its field record is locked.

## Practitioner

You build the exposure register, plan monitoring, manage results and write assessments.

1. **Register.** Build the hierarchy: site → work area → process → task. Add hazards (substance, form, routes and exposure basis), then a similar exposure group. The group needs a written rationale of at least 20 characters explaining why its members are exposed alike. Add workers by reference code; names are restricted.
2. **Plans.** Create a monitoring plan with its purpose, assessment question, approach and strategy rationale. Add targets (group, substance, method version, planned samples). A reviewer, not you, must review the plan before it can be scheduled.
3. **Laboratory.** Record dispatch (**Record dispatch**) and receipt (**Record receipt**).
   - Import results with **Validate file** → **Commit … results**. The import is all-or-nothing.
   - Columns: `sample_code, analyte, value, unit, qualifier` and `lod`, with optional `cas_number, loq, analytical_method, lab_report_ref, uncertainty, sample_condition, lab_comments, amendment_reason`.
   - Non-detects use the qualifier `<LOD` with the limit in `lod`.
   - Attach the laboratory certificate.
   - An amendment needs a reason and creates a new revision; earlier values are kept.
4. **QC.** A failed QC check excludes the sample until someone records a disposition (**Record disposition**). The person who records it can't approve that assessment.
5. **Assessment.** Choose **Start assessment**, select samples and a benchmark, enter the exposure minutes per shift, then **Run calculation**.
   - **Unsampled time:** if part of the shift wasn't sampled, there is no TWA unless you choose an assumption and justify it in writing. The justification is printed in the report.
   - **Interpretation:** write the interpretation, choose a conclusion category and state the limitations.
   - **Pilot rules:** *Exposure adequately controlled* can't be chosen unless every formal result is below a verified benchmark. In the pilot, a conclusion also needs an **approved method** and a **Professional reference** benchmark.
   - Then **Submit for review**.
6. **After approval.** Approved revisions are frozen. If evidence changes later, the assessment shows a notice and you create a new revision (**Create revision**) with a reason.
7. **Reports.** **Generate draft report** gives a watermarked draft. **Issue report** is only possible from an approved revision. Drafts are never sent to clients.
8. **Sync conflicts and recovery.**
   - On **Sync conflicts**, choose **Keep server copy** or **Apply device copy**, with notes.
   - On **Recover field records**, import recovery files that field staff hand you. The import reports what was created, already present, in conflict or rejected. Recovered records show who captured them.
9. **Actions.** Raise corrective actions (**Raise action**). Each needs a verification requirement and an owner.

## Technical reviewer

You independently review plans and assessments, and judge whether actions were effective.

1. **Plans.** Review plans written by others. You can't review your own.
2. **Assessments.** Before **Approve revision …**, check:
   - the samples and their QC;
   - the calculation (recalculate at least one result by hand);
   - the unsampled-time assumption and its justification;
   - the method review status and benchmark provenance;
   - the interpretation and limitations.

   State the scope and limitations of your approval, and confirm you have reviewed the evidence.
3. **When you can't approve.** You can't approve a revision you wrote or submitted, or one where you recorded a QC disposition. In the pilot, the system refuses approval if the method isn't approved or the benchmark isn't professional reference data. Never ask an administrator to get round this; administrators can't.
4. **Sending back.** Use **Return to draft** with notes.
5. **Effectiveness.**
   - Use **Record review** with an outcome: *effective*, *partially effective* or *not effective*.
   - *Installed* is not *effective*. Look for the evidence named in the verification requirement, for example a commissioning test or repeat monitoring.
   - You can't review an action you implemented.
   - **Close as verified** is only possible after an *effective* review.
6. **Never record a calculation-method approval in the software yourself.** Method approvals come from the named hygienist's signed review and are recorded by a platform operator (gate G3).

### Validating results and reading a report (practitioners and reviewers)

- **Result validation before calculation.** Check each result against the laboratory certificate (sample code, analyte, value, unit, qualifier, LOD/LOQ). Check custody is complete and QC failures have dispositions. Check calibration is valid on the sampling date and flows are within the method's tolerance.
- **Interpreting a report.** Read it in order:
  1. Scope and question.
  2. Group and grouping basis.
  3. Method review status and whether the conclusion was approved under an authorised pilot.
  4. Data-quality findings.
  5. Results (intervals, indicative tags).
  6. Benchmark with its source and provenance.
  7. Limitations.
  8. The interpretation and conclusion category.

  *Below benchmark* for the samples taken is not proof of adequate control: representativeness and day-to-day variation are judged by the competent person, not the software.

## Action owner / site contact

1. Open **Corrective actions** to see what is assigned to you and when it's due.
2. When the work is done, choose **Mark implemented**.
3. Then **Submit evidence**: an inspection or test record with its date and outcome, plus attachments.
4. A reviewer decides whether the action was effective. If not, it comes back to you with the reasons.
5. Don't treat an open action as permission to stop or start work. The platform doesn't authorise work.

## Organisation administrator

1. **Users.**
   - **Add user** gives the person a temporary password, which they must change at first sign-in.
   - Give each person the lowest role that fits.
   - **Suspend** ends their sessions at once. A suspended field user's device is affected only when it next connects.
2. **Two-step verification.** **Reset two-step** only after you have confirmed the person's identity.
3. **Retention and disposal.** Set retention periods only as decided in the privacy assessment (gate G7). Disposal needs a second person to approve it (**Request disposal** → **Approve disposal**).
4. **System health and audit.** Check the System health panel weekly: locked accounts, users without two-step, failed sign-ins, open conflicts and pending disposals.
5. **What you can't do.** You can't change the pilot level, switch offline capture on or off, suspend workflows, or record method approvals. Those are platform operator controls. Ask the pilot lead.

## Client read-only user

You see **issued** reports for your own organisation only. You can't see drafts, other clients or worker names, and you can't change anything. Questions about a report go to the practitioner named on it.

## Platform operator (SHEQ Experts)

You act outside the application using the owner connection, and **only on a recorded decision**. Quote the gate or stop-condition reference as `--evidence` or `--reason`. All commands are in `scripts/`; each writes an audit event.

| Task | Command |
|---|---|
| Record the G11 authorisation from the signed document (you are not an authoriser) | `platform-controls.ts pilot-authorise --tenant … --provider … --organisation … --document … --document-file …` |
| Move an organisation to pilot (refused without a recorded authorisation, an approved method and reference data) | `platform-controls.ts tenant-level --level pilot --authorised-by … --evidence G11-…` |
| Withdraw a pilot authorisation (returns the organisation to evaluation) | `platform-controls.ts pilot-withdraw …` |
| Switch offline capture on or off (on only after G8 and G9) | `platform-controls.ts offline --offline on\|off …` |
| Suspend or resume workflows (stop conditions) | `platform-controls.ts suspend …` / `resume … --evidence <revalidation>` |
| Hold or release one assessment | `platform-controls.ts hold --assessment … --reason …` / `release … --evidence …` |
| List approved assessments affected by a method withdrawal | `platform-controls.ts method-impact --method … --version …` |
| Record a method review from the signed pack (scope and signed file required for approvals) | `platform-controls.ts method-review … --evidence-file … --scope …`. You are not the reviewer. |
| Import professional reference data | `import-reference-data.ts file.json --dry-run`, then without `--dry-run` |
| Backups and restore checks | `backup.ts`, `restore-verify.ts --evidence-label …` |
| Recovery keys | `recovery-keys.ts verify` / `rotate` (new KEK) / `replace` (new key pair for one organisation) |
