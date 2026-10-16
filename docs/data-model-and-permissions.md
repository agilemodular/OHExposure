# Data model and permission matrix

## Record structure

All operational records carry `tenant_id` and `client_id` and are isolated by row-level security. Identifiers are UUIDs. Relationships are explicit foreign keys.

```
tenants ─ clients
   └ sites ─ work_areas ─ processes ─ tasks ─ hazards (substance, form, routes, exposure basis)
        └ exposure_groups (rationale ≥ 20 chars) ─┬ exposure_group_tasks / exposure_group_hazards
                                                  ├ group_memberships (valid_from / valid_to; history kept)
                                                  ├ group_reviews
                                                  └ monitoring_plans ─ plan_targets (substance, group, method version)
                                                        └ sampling_events (group_id_at_sampling frozen)
                                                              ├ sample_qc_checks (+ authorised disposition)
                                                              ├ custody_events (append-only)
                                                              └ lab_results ─ lab_result_revisions (append-only)
   assessments ─ assessment_revisions (inputs snapshot + hash; immutable once approved)
   controls ─ control_inspections ─ actions ─ action_events (append-only)
   reports (immutable, content hash) · attachments (SHA-256) · audit_events (append-only)
   workers (pseudonymous ref) ─ worker_identities (restricted; disposable)
   instruments ─ calibrations, instrument_maintenance · laboratories · import_batches ─ import_rows
   substances · benchmarks ─ benchmark_versions · sampling_methods ─ sampling_method_versions
   retention_policies · disposal_requests · sync_conflicts · integration_links · integration_outbox
```

### Facts, estimates and reviewed conclusions

`tasks.duration_basis` and `hazards.exposure_basis` record whether a figure is a *recorded fact*, a *user estimate* or *professionally reviewed* (setting the last requires `groups.review`). Assessment revisions keep the calculated output, the professional interpretation and the reviewer's approval as separate fields.

### History preservation

- Ending a group membership sets `valid_to`; it never edits sampling events, which keep `group_id_at_sampling`.
- Laboratory amendments create a new `lab_result_revisions` row with a mandatory reason; earlier revisions cannot be updated or deleted (trigger + grant).
- Approved assessment revisions can only change status to *superseded* or *withdrawn* (trigger).
- `audit_events`, `custody_events`, `action_events` and `reports` are append-only (trigger + revoked UPDATE).

## Row-level security

The application connects as `ohea_app` (`NOBYPASSRLS`). All 52 tables have RLS **enabled and forced** (verified with `pg_class.relrowsecurity / relforcerowsecurity`). Policy families:

| Policy | Tables | Rule |
|---|---|---|
| tenant + client | operational records | `tenant_id = app.tenant_id` and, for client-scoped users, `client_id = app.client_id` |
| tenant + optional client | instruments, attachments, import batches, AI suggestions | as above, but rows with no client are visible across the tenant |
| tenant only | calibrations, laboratories (read), link tables, governance | `tenant_id = app.tenant_id` |
| reference | substances, benchmarks, methods | platform rows (`tenant_id IS NULL`) readable by all, writable by none; tenant rows by owner |
| PII guard | worker_identities | additionally requires `app.pii = 'on'` (set only for roles with `worker.identity.read`) |
| clients / users | clients, users | client-scoped users see only their own client and users; they cannot insert |

Login and session lookup happen before a tenant is known and use two `SECURITY DEFINER` functions that return only the fields needed.

## Roles

| Role | Typical person | Scope |
|---|---|---|
| Organisation administrator | Account owner | Users, clients, retention, disposal approval, integrations, audit, export |
| Occupational hygiene practitioner | Consultant / in-house hygienist | Register, plans, fieldwork, lab, assessments (author), controls, actions |
| Field technician | Sampling technician | Field capture, instruments, inspections |
| Technical reviewer | Senior / chartered hygienist | Plan review, assessment approval, benchmark verification, effectiveness review and closure |
| Site manager / action owner | Client-side manager | Implement actions assigned to them, record inspections |
| Client read-only | Client contact | Read their own client's records and issued reports only |

## Permission matrix

| Permission | Admin | Practitioner | Field tech | Reviewer | Action owner | Client RO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `read` | ● | ● | ● | ● | ● | ● |
| `org.manage` | ● |  |  |  |  |  |
| `users.manage` | ● |  |  |  |  |  |
| `sites.write` | ● | ● |  |  |  |  |
| `register.write` |  | ● |  |  |  |  |
| `groups.review` |  | ● |  | ● |  |  |
| `worker.identity.read` | ● | ● |  | ● |  |  |
| `worker.identity.write` | ● | ● |  |  |  |  |
| `plans.write` |  | ● |  |  |  |  |
| `plans.review` |  |  |  | ● |  |  |
| `field.capture` |  | ● | ● |  |  |  |
| `instruments.write` |  | ● | ● |  |  |  |
| `lab.write` |  | ● |  |  |  |  |
| `lab.import` |  | ● |  |  |  |  |
| `assess.write` |  | ● |  |  |  |  |
| `assess.approve` |  |  |  | ● |  |  |
| `benchmark.write` |  | ● |  |  |  |  |
| `benchmark.verify` |  |  |  | ● |  |  |
| `controls.write` |  | ● |  |  |  |  |
| `controls.inspect` |  | ● | ● |  | ● |  |
| `actions.assign` |  | ● |  |  |  |  |
| `actions.implement` |  |  |  |  | ● |  |
| `actions.review` |  |  |  | ● |  |  |
| `reports.generate` |  | ● |  | ● |  |  |
| `reports.read_drafts` | ● | ● |  | ● |  |  |
| `audit.read` | ● |  |  | ● |  |  |
| `export.data` | ● | ● |  | ● |  |  |
| `disposal.request` | ● | ● |  |  |  |  |
| `disposal.approve` | ● |  |  |  |  |  |
| `conflicts.resolve` |  | ● |  | ● |  |  |
| `integrations.manage` | ● |  |  |  |  |  |

### Separation-of-duties rules enforced in services (not only by role)

| Rule | Where |
|---|---|
| A plan cannot be reviewed by its author | `plans.transitionPlan` |
| An assessment cannot be approved by its author or submitter | `assessments.approve` |
| A tenant benchmark cannot be verified by the person who entered it | `assessments.verifyBenchmarkVersion` |
| Effectiveness cannot be reviewed by the implementer | `controls.reviewEffectiveness` |
| Disposal cannot be approved by the requester (also a DB check constraint) | `admin.decideDisposal` |
| Only the action owner (or a practitioner) can record implementation/evidence | `controls.markImplemented`, `submitEvidence` |
