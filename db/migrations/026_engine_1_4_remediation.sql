-- Engine 1.4.0 remediation (technical review of ceec79f, TR-01–TR-05 and items A–D): data needed by the engine.

-- TR-05: method-specific consequences of acceptance failures. NULL = not stated (the engine treats it as
-- "disposition required" and flags the gap for professional review).
alter table sampling_method_versions
  add column flow_drift_consequence text check (flow_drift_consequence in ('advisory','disposition_required','invalid')),
  add column min_volume_consequence text check (min_volume_consequence in ('advisory','disposition_required','invalid'));

-- TR-05: a reviewer's acceptance of a failed method criterion: criterion, supporting evidence, scope, reviewer.
create table sample_acceptance_dispositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  sampling_event_id uuid not null references sampling_events(id),
  criterion text not null check (criterion in ('flow_drift','min_volume')),
  evidence text not null check (length(trim(evidence)) >= 10),
  scope text not null check (length(trim(scope)) >= 5),
  authorised_by uuid not null references users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (sampling_event_id, criterion)
);
alter table sample_acceptance_dispositions enable row level security;
alter table sample_acceptance_dispositions force row level security;
create policy tenant_client on sample_acceptance_dispositions using (tenant_id = app_tenant() and (app_client() is null or client_id = app_client())) with check (tenant_id = app_tenant() and app_client() is null);
grant select, insert on sample_acceptance_dispositions to ohea_app;

create or replace function protect_acceptance_disposition() returns trigger language plpgsql as $$
declare u record; e record;
begin
  if tg_op <> 'INSERT' then raise exception 'acceptance dispositions are append-only' using errcode = 'P0001'; end if;
  if new.authorised_by is distinct from app_user() then raise exception 'acceptance disposition refused: the reviewer must be the signed-in user' using errcode = 'P0001'; end if;
  select role, status, tenant_id into u from users where id = new.authorised_by;
  if u.tenant_id is distinct from new.tenant_id or u.status <> 'active' or u.role <> 'technical_reviewer' then
    raise exception 'acceptance disposition refused: only an active technical reviewer can accept a failed method criterion' using errcode = 'P0001';
  end if;
  select tenant_id, client_id into e from sampling_events where id = new.sampling_event_id;
  if e.tenant_id is distinct from new.tenant_id or e.client_id is distinct from new.client_id then raise exception 'acceptance disposition refused: sample mismatch' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger trg_protect_acceptance_disposition before insert or update or delete on sample_acceptance_dispositions for each row execute function protect_acceptance_disposition();

-- TR-02: disposition of personal evidence that cannot be used formally in an assessment revision. Recorded on a draft
-- revision only; append-only (the latest row per sample applies); frozen with the revision at approval.
create table assessment_evidence_dispositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  revision_id uuid not null references assessment_revisions(id),
  sampling_event_id uuid not null references sampling_events(id),
  kind text not null check (kind in ('duplicate','outside_scope','not_replaced','remaining_coverage_adequate')),
  reason text not null check (length(trim(reason)) >= 10),
  consequence text not null check (length(trim(consequence)) >= 10),
  related_sampling_event_id uuid references sampling_events(id),
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  seq bigserial not null,
  check (kind <> 'duplicate' or related_sampling_event_id is not null)
);
alter table assessment_evidence_dispositions enable row level security;
alter table assessment_evidence_dispositions force row level security;
create policy tenant_client on assessment_evidence_dispositions using (tenant_id = app_tenant() and (app_client() is null or client_id = app_client())) with check (tenant_id = app_tenant() and app_client() is null);
grant select, insert on assessment_evidence_dispositions to ohea_app;
grant usage on sequence assessment_evidence_dispositions_seq_seq to ohea_app;

create or replace function protect_evidence_disposition() returns trigger language plpgsql as $$
declare u record; r record;
begin
  if tg_op <> 'INSERT' then raise exception 'evidence dispositions are append-only' using errcode = 'P0001'; end if;
  if new.recorded_by is distinct from app_user() then raise exception 'evidence disposition refused: must be recorded by the signed-in user' using errcode = 'P0001'; end if;
  select role, status, tenant_id into u from users where id = new.recorded_by;
  if u.tenant_id is distinct from new.tenant_id or u.status <> 'active' or u.role not in ('practitioner','technical_reviewer') then
    raise exception 'evidence disposition refused: only an active practitioner or technical reviewer can disposition evidence' using errcode = 'P0001';
  end if;
  -- Setting evidence aside on the judgement that the remaining coverage is adequate is a reviewer's decision.
  if new.kind = 'remaining_coverage_adequate' and u.role <> 'technical_reviewer' then
    raise exception 'evidence disposition refused: only a technical reviewer can accept that the remaining coverage is adequate' using errcode = 'P0001';
  end if;
  select status, tenant_id, client_id, sample_ids into r from assessment_revisions where id = new.revision_id for share;
  if r.status is distinct from 'draft' then raise exception 'evidence disposition refused: the revision is not a draft' using errcode = 'P0001'; end if;
  if r.tenant_id is distinct from new.tenant_id or r.client_id is distinct from new.client_id then raise exception 'evidence disposition refused: revision mismatch' using errcode = 'P0001'; end if;
  if not (new.sampling_event_id = any(r.sample_ids)) then raise exception 'evidence disposition refused: the sample is not part of this revision' using errcode = 'P0001'; end if;
  if new.related_sampling_event_id is not null and not (new.related_sampling_event_id = any(r.sample_ids)) then
    raise exception 'evidence disposition refused: the related sample is not part of this revision' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_protect_evidence_disposition before insert or update or delete on assessment_evidence_dispositions for each row execute function protect_evidence_disposition();

-- Item A: explicit shift / assessment-period association.
alter table sampling_events add column shift_ref text check (shift_ref is null or length(trim(shift_ref)) between 1 and 60);

-- Item B: optional task interval within the shift (minutes from shift start), so overlapping tasks are not double counted.
alter table tasks
  add column typical_start_min int,
  add column typical_end_min int,
  add constraint task_interval check ((typical_start_min is null and typical_end_min is null)
    or (typical_start_min >= 0 and typical_end_min > typical_start_min and typical_end_min <= 1440));

-- Item C and TR-03: preserve the laboratory's qualifier text; add confirmed detection below LOQ; validate limits.
alter table lab_result_revisions add column lab_qualifier text;
alter table lab_result_revisions drop constraint lab_result_revisions_qualifier_check;
alter table lab_result_revisions add constraint lab_result_revisions_qualifier_check check (qualifier in ('=','<LOD','<LOQ','detected_below_loq','>','estimated'));
alter table lab_result_revisions add constraint lab_result_values_valid check (
  (value is null or value >= 0) and (lod is null or lod >= 0) and (loq is null or loq >= 0)
  and (lod is null or loq is null or lod <= loq)
  and (qualifier <> 'detected_below_loq' or (lod is not null and loq is not null and lod < loq))) not valid;
alter table lab_result_revisions validate constraint lab_result_values_valid;
