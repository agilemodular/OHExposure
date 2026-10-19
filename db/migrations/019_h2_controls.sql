-- Phase H2: consistent suspension, assessment holds, quarantined remediation evidence, offline holds, professional
-- authority records (scope, expiry, evidence hash, withdrawal), recorded pilot authorisations, versioned field
-- recovery keys, and database-level approval/issue prerequisites for every write path open to the application role.

-- ── Assessment holds (placed and released by a platform operator on a recorded decision)
create table assessment_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  assessment_id uuid not null references assessments(id),
  reason text not null check (length(trim(reason)) >= 5),
  placed_by text not null,
  placed_at timestamptz not null default now(),
  released_by text,
  released_at timestamptz,
  release_evidence text,
  check ((released_at is null) = (released_by is null)),
  check (released_at is null or release_evidence is not null)
);
create unique index assessment_holds_one_active on assessment_holds (assessment_id) where released_at is null;
alter table assessment_holds enable row level security;
alter table assessment_holds force row level security;
create policy tenant_read on assessment_holds for select using (tenant_id = app_tenant());
grant select on assessment_holds to ohea_app;   -- no insert/update: operator only

create or replace function assessment_on_hold(p_assessment uuid) returns boolean language sql stable as
$$ select exists (select 1 from assessment_holds where assessment_id = p_assessment and released_at is null) $$;

create or replace function workflow_suspended(p_tenant uuid, p_workflow text) returns boolean language sql stable as
$$ select coalesce(p_workflow = any(suspended_workflows), false) from tenants where id = p_tenant $$;

-- ── Quarantined remediation evidence (uploaded through the authorised intake while a workflow is suspended)
alter table attachments add column quarantined boolean not null default false;
alter table attachments add column intake_reason text;
alter table attachments add column admitted_by uuid references users(id);
alter table attachments add column admitted_at timestamptz;
alter table attachments add constraint quarantine_reason check (not quarantined or intake_reason is not null);
alter table attachments add constraint admission_pair check ((admitted_by is null) = (admitted_at is null));

-- ── Offline records received while field sync is suspended: held for review, never entered into records directly
create table field_intake_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_uuid uuid not null,
  server_id uuid,
  base_version int,
  payload jsonb not null,
  submitted_by uuid not null references users(id),
  received_at timestamptz not null default now(),
  suspension_reason text,
  status text not null default 'held' check (status in ('held','synchronised')),
  resolved_at timestamptz,
  sampling_event_id uuid references sampling_events(id)
);
create unique index field_intake_holds_once on field_intake_holds (tenant_id, client_uuid, md5(payload::text));
alter table field_intake_holds enable row level security;
alter table field_intake_holds force row level security;
create policy tenant_only on field_intake_holds using (tenant_id = app_tenant()) with check (tenant_id = app_tenant() and app_client() is null);
grant select, insert, update on field_intake_holds to ohea_app;

-- Samples whose capture reached the server during or because of a suspension must be reviewed before use.
alter table sampling_events add column suspension_review_required boolean not null default false;
alter table sampling_events add column suspension_reviewed_by uuid references users(id);
alter table sampling_events add column suspension_reviewed_at timestamptz;

-- ── Professional authority: scope, expiry, authentic evidence, withdrawal
alter table method_reviews drop constraint if exists method_reviews_status_check;
alter table method_reviews add constraint method_reviews_status_check
  check (status in ('not_reviewed','approved','approved_with_conditions','rejected','withdrawn'));
alter table method_reviews add column permitted_scope text;
alter table method_reviews add column expires_on date;
alter table method_reviews add column evidence_sha256 text;
-- New approvals must state their permitted scope and the SHA-256 of the signed evidence document. (NOT VALID: rows
-- recorded before this migration keep their original form and are reported as lacking an evidence hash.)
alter table method_reviews add constraint approval_evidence check (
  status not in ('approved','approved_with_conditions') or
  (permitted_scope is not null and evidence_sha256 ~ '^[0-9a-f]{64}$')) not valid;
alter table method_reviews add constraint expiry_after_review check (expires_on is null or reviewed_on is null or expires_on > reviewed_on);

-- Effective status used by every gate: an approval past its expiry date no longer permits new use.
create or replace function method_status_effective(p_code text, p_version text) returns text language sql stable as
$$ select case when r.status in ('approved','approved_with_conditions') and r.expires_on is not null and r.expires_on < current_date
               then 'expired' else coalesce(r.status, 'not_reviewed') end
   from (select 1) one left join lateral (
     select status, expires_on from method_reviews where calc_code = p_code and calc_version = p_version order by recorded_at desc limit 1) r on true $$;

-- ── Recorded pilot authorisation (G11). Required before an organisation can be moved to pilot level.
create table pilot_authorisations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  scope_ref text not null,
  authorised_by_provider text not null,
  authorised_by_organisation text not null,
  authorised_on date not null,
  document_ref text not null,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  check (lower(recorded_by) <> lower(authorised_by_provider) and lower(recorded_by) <> lower(authorised_by_organisation))
);
create trigger trg_pilot_auth_append before delete on pilot_authorisations for each row execute function forbid_update();
alter table pilot_authorisations enable row level security;
alter table pilot_authorisations force row level security;
create policy tenant_read on pilot_authorisations for select using (tenant_id = app_tenant());
grant select on pilot_authorisations to ohea_app;

-- The application role cannot place an organisation at pilot level at all (column grants exclude it since 015); this
-- trigger additionally stops an owner-level update that has no recorded, current authorisation.
create or replace function enforce_pilot_level() returns trigger language plpgsql as $$
begin
  if new.assurance_level = 'pilot' and old.assurance_level is distinct from 'pilot'
     and not exists (select 1 from pilot_authorisations where tenant_id = new.id and withdrawn_at is null) then
    raise exception 'pilot level refused: no recorded pilot authorisation (G11) for this organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_enforce_pilot_level before update on tenants for each row execute function enforce_pilot_level();

-- ── Versioned field recovery keys
alter table field_recovery_keys add column key_version int not null default 1;
alter table field_recovery_keys add column active boolean not null default true;
alter table field_recovery_keys drop constraint field_recovery_keys_pkey;
alter table field_recovery_keys add primary key (tenant_id, key_version);
create unique index field_recovery_keys_one_active on field_recovery_keys (tenant_id) where active;
grant select, insert on field_recovery_keys to ohea_app;   -- unchanged: no update, no delete

-- ── Approval prerequisites in the database (replaces the 018 function; same trigger)
create or replace function enforce_pilot_approval() returns trigger language plpgsql as $$
declare
  lvl text;
  bv record;
  rv record;
  need_minutes int;
begin
  if new.status <> 'approved' or old.status = 'approved' then return new; end if;
  -- State, actor and separation of duties hold for every organisation.
  if old.status <> 'in_review' then
    raise exception 'approval refused: only a revision in review can be approved' using errcode = 'P0001';
  end if;
  select u.id, u.role, u.status, u.tenant_id into rv from users u where u.id = new.reviewer_id;
  if rv.id is null or rv.tenant_id <> new.tenant_id or rv.status <> 'active' or rv.role <> 'technical_reviewer' then
    raise exception 'approval refused: reviewer must be an active technical reviewer of this organisation' using errcode = 'P0001';
  end if;
  if new.reviewer_id = new.created_by or new.reviewer_id is not distinct from new.submitted_by then
    raise exception 'approval refused: reviewer must not be the author or submitter' using errcode = 'P0001';
  end if;
  if workflow_suspended(new.tenant_id, 'assessment_approval') then
    raise exception 'approval refused: assessment approval is suspended for this organisation' using errcode = 'P0001';
  end if;
  if assessment_on_hold(new.assessment_id) then
    raise exception 'approval refused: assessment is on hold' using errcode = 'P0001';
  end if;
  if exists (select 1 from sampling_events where id = any(new.sample_ids) and suspension_review_required and suspension_reviewed_at is null) then
    raise exception 'approval refused: a sample received during a suspension has not been reviewed' using errcode = 'P0001';
  end if;
  select assurance_level into lvl from tenants where id = new.tenant_id;
  new.assurance_level_at_approval := lvl;
  new.method_review_status := method_status_effective(coalesce(new.calc_code, 'twa_8h'), new.calc_version);
  select v.provenance, v.verification_status, b.averaging_minutes into bv
    from benchmark_versions v join benchmarks b on b.id = v.benchmark_id where v.id = new.benchmark_version_id;
  new.benchmark_provenance := bv.provenance;
  if lvl = 'pilot' then
    need_minutes := case coalesce(new.calc_code, 'twa_8h') when 'stel_15' then 15 else 480 end;
    if new.method_review_status not in ('approved', 'approved_with_conditions') then
      raise exception 'pilot approval refused: calculation % % is %', coalesce(new.calc_code, 'twa_8h'), new.calc_version, new.method_review_status using errcode = 'P0001';
    end if;
    if bv.provenance is distinct from 'professional_reference' or bv.verification_status is distinct from 'verified' then
      raise exception 'pilot approval refused: benchmark is not verified professional reference data' using errcode = 'P0001';
    end if;
    if bv.averaging_minutes is distinct from need_minutes then
      raise exception 'pilot approval refused: benchmark averaging period does not match the calculation' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ── Report issue prerequisites in the database (replaces the 018 function; same trigger)
create or replace function enforce_report_issue() returns trigger language plpgsql as $$
declare
  r record;
  g record;
  lvl text;
  cur text;
begin
  if new.status <> 'issued' then return new; end if;
  select status, assessment_id, client_id, assurance_level_at_approval, method_review_status, benchmark_provenance, calc_code, calc_version
    into r from assessment_revisions where id = new.assessment_revision_id for share;
  if r.status is distinct from 'approved' or r.assessment_id is distinct from new.assessment_id or r.client_id is distinct from new.client_id then
    raise exception 'report issue refused: revision is not an approved revision of this assessment' using errcode = 'P0001';
  end if;
  select u.role, u.status, u.tenant_id into g from users u where u.id = new.generated_by;
  if g.tenant_id is distinct from new.tenant_id or g.status <> 'active' or g.role not in ('practitioner', 'technical_reviewer') then
    raise exception 'report issue refused: issuer must be an active practitioner or technical reviewer of this organisation' using errcode = 'P0001';
  end if;
  if workflow_suspended(new.tenant_id, 'report_issue') then
    raise exception 'report issue refused: report issue is suspended for this organisation' using errcode = 'P0001';
  end if;
  if assessment_on_hold(new.assessment_id) then
    raise exception 'report issue refused: assessment is on hold' using errcode = 'P0001';
  end if;
  select assurance_level into lvl from tenants where id = new.tenant_id;
  if lvl = 'pilot' then
    cur := method_status_effective(coalesce(r.calc_code, 'twa_8h'), r.calc_version);
    if r.assurance_level_at_approval is distinct from 'pilot'
       or r.method_review_status not in ('approved', 'approved_with_conditions')
       or r.benchmark_provenance is distinct from 'professional_reference' then
      raise exception 'report issue refused: revision was not approved under the pilot controls' using errcode = 'P0001';
    end if;
    if cur in ('rejected', 'withdrawn') then
      raise exception 'report issue refused: calculation method approval has since been %', cur using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
