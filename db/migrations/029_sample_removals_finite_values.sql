-- Engine 1.5.1 (R5 re-check of 808f76b, an AI review agent). Adds tables, columns and constraints only; no row is changed.
-- Constraints that historical rows might violate are added NOT VALID and validated only if no row violates them.

-- ── R5-F2: removing a sample from a draft's sample list is a scope judgement ─────────────────────────────────────────
-- A removal is recorded with a reason. A practitioner's removal is a request: the sample stays in the evidence until a
-- technical reviewer confirms the removal. A technical reviewer's removal (or confirmation) takes effect. Append-only.
create table assessment_sample_removals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  revision_id uuid not null references assessment_revisions(id),
  sampling_event_id uuid not null references sampling_events(id),
  action text not null check (action in ('requested','confirmed')),
  reason text not null check (length(trim(reason)) >= 10),
  recorded_by uuid not null references users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  seq bigserial not null
);
alter table assessment_sample_removals enable row level security;
alter table assessment_sample_removals force row level security;
create policy tenant_client on assessment_sample_removals using (tenant_id = app_tenant() and (app_client() is null or client_id = app_client())) with check (tenant_id = app_tenant() and app_client() is null);
grant select, insert on assessment_sample_removals to ohea_app;
grant usage on sequence assessment_sample_removals_seq_seq to ohea_app;

create or replace function protect_sample_removal() returns trigger language plpgsql as $$
declare u record; r record;
begin
  if tg_op <> 'INSERT' then raise exception 'sample removals are append-only' using errcode = 'P0001'; end if;
  if new.recorded_by is distinct from app_user() then raise exception 'sample removal refused: must be recorded by the signed-in user' using errcode = 'P0001'; end if;
  select role, status, tenant_id into u from users where id = new.recorded_by;
  if u.tenant_id is distinct from new.tenant_id or u.status <> 'active' or u.role not in ('practitioner','technical_reviewer') then
    raise exception 'sample removal refused: only an active practitioner or technical reviewer can remove a sample' using errcode = 'P0001';
  end if;
  if new.action = 'confirmed' and u.role <> 'technical_reviewer' then
    raise exception 'sample removal refused: only a technical reviewer can confirm that a sample is outside the scope of the assessment' using errcode = 'P0001';
  end if;
  select status, tenant_id, client_id, sample_ids into r from assessment_revisions where id = new.revision_id for share;
  if r.status is distinct from 'draft' then raise exception 'sample removal refused: the revision is not a draft' using errcode = 'P0001'; end if;
  if r.tenant_id is distinct from new.tenant_id or r.client_id is distinct from new.client_id then raise exception 'sample removal refused: revision mismatch' using errcode = 'P0001'; end if;
  if new.sampling_event_id = any(r.sample_ids) then raise exception 'sample removal refused: the sample is still in the sample list' using errcode = 'P0001'; end if;
  if new.action = 'confirmed' and not exists (select 1 from assessment_sample_removals x where x.revision_id = new.revision_id and x.sampling_event_id = new.sampling_event_id and x.action = 'requested') then
    raise exception 'sample removal refused: there is no removal request to confirm' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_protect_sample_removal before insert or update or delete on assessment_sample_removals for each row execute function protect_sample_removal();

-- ── R5-F5: only a duplicate names a related sample ───────────────────────────────────────────────────────────────────
alter table assessment_evidence_dispositions add constraint evidence_disposition_related_only_duplicate
  check (kind = 'duplicate' or related_sampling_event_id is null) not valid;
do $$ begin
  alter table assessment_evidence_dispositions validate constraint evidence_disposition_related_only_duplicate;
exception when check_violation then raise notice 'evidence_disposition_related_only_duplicate left NOT VALID (historical rows)';
end $$;

-- ── R5-F4: numeric columns accept NaN and ±Infinity; laboratory values, limits and flows must be finite ────────────────
create or replace function ohea_finite(x numeric) returns boolean language sql immutable as $$
  select x is null or (x <> 'NaN'::numeric and x <> 'Infinity'::numeric and x <> '-Infinity'::numeric)
$$;
alter table lab_result_revisions add constraint lab_result_values_finite check (ohea_finite(value) and ohea_finite(lod) and ohea_finite(loq)) not valid;
alter table sampling_events add constraint sampling_flows_finite check (ohea_finite(flow_pre_lpm) and ohea_finite(flow_post_lpm)) not valid;
do $$ begin
  alter table lab_result_revisions validate constraint lab_result_values_finite;
exception when check_violation then raise notice 'lab_result_values_finite left NOT VALID (historical rows)';
end $$;
do $$ begin
  alter table sampling_events validate constraint sampling_flows_finite;
exception when check_violation then raise notice 'sampling_flows_finite left NOT VALID (historical rows)';
end $$;
