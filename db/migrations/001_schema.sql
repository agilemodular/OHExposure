-- Occupational Hygiene & Exposure Assurance — core schema
-- Tenant isolation is enforced in the database with Row-Level Security (RLS).
-- The application connects as role ohea_app (NOBYPASSRLS) and sets, per transaction:
--   app.tenant_id  — the caller's organisation
--   app.client_id  — set only for client-scoped users (consultancy client access); empty = all clients in tenant
--   app.pii        — 'on' only when the caller holds worker.identity.read
--   app.user_id    — for audit/default columns

create extension if not exists pgcrypto;

create or replace function app_tenant() returns uuid language sql stable as
$$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;
create or replace function app_client() returns uuid language sql stable as
$$ select nullif(current_setting('app.client_id', true), '')::uuid $$;
create or replace function app_pii() returns boolean language sql stable as
$$ select coalesce(current_setting('app.pii', true), '') = 'on' $$;
create or replace function app_user() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ───────────────────────── Tenancy & identity ─────────────────────────
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'direct' check (kind in ('direct','consultancy')),
  is_demo boolean not null default false,
  mfa_required boolean not null default true,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid references clients(id),
  email text not null unique,
  name text not null,
  role text not null check (role in ('org_admin','practitioner','field_technician','technical_reviewer','action_owner','client_readonly')),
  password_hash text not null,
  totp_secret text,
  mfa_enabled boolean not null default false,
  status text not null default 'active' check (status in ('active','suspended')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  check (role <> 'client_readonly' or client_id is not null)
);

create table sessions (
  id text primary key,                       -- sha256 of the bearer token; raw token never stored
  user_id uuid not null references users(id),
  tenant_id uuid not null references tenants(id),
  csrf_token text not null,
  mfa_passed boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text
);

create table audit_events (
  id bigserial primary key,
  tenant_id uuid references tenants(id),
  user_id uuid,
  at timestamptz not null default now(),
  action text not null,
  entity_type text,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  ip text
);

-- ───────────────────────── Site hierarchy ─────────────────────────
create table sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  name text not null,
  reference text,
  address text,
  created_at timestamptz not null default now()
);
create table work_areas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  site_id uuid not null references sites(id),
  name text not null,
  description text
);
create table processes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  work_area_id uuid not null references work_areas(id),
  name text not null,
  description text,
  updated_at timestamptz not null default now()
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  process_id uuid not null references processes(id),
  name text not null,
  description text,
  frequency text,
  duration_min_per_shift numeric,
  duration_basis text not null default 'user_estimate' check (duration_basis in ('recorded_fact','user_estimate','professionally_reviewed')),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Reference data ─────────────────────────
-- tenant_id NULL = platform reference row (maintained by platform administrators only)
create table substances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  name text not null,
  cas_number text,
  ec_number text,
  other_identifiers jsonb not null default '{}'::jsonb,
  is_synthetic boolean not null default false
);

create table benchmarks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  substance_id uuid not null references substances(id),
  jurisdiction text not null,               -- e.g. 'GB'
  benchmark_type text not null,             -- e.g. 'WEL-LTEL', 'WEL-STEL'
  averaging_minutes int not null check (averaging_minutes > 0),
  unique nulls not distinct (tenant_id, substance_id, jurisdiction, benchmark_type)
);
create table benchmark_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  benchmark_id uuid not null references benchmarks(id),
  value numeric not null check (value > 0),
  unit text not null check (unit in ('mg/m3','ppm','f/ml')),
  annotations text[] not null default '{}',
  source_title text not null,
  source_version text not null,
  source_url text,
  effective_from date not null,
  effective_to date,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','withdrawn')),
  verified_by text,
  verified_at timestamptz,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

create table sampling_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  code text not null,
  title text not null,
  source_reference text not null,
  unique nulls not distinct (tenant_id, code)
);
create table sampling_method_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  method_id uuid not null references sampling_methods(id),
  version text not null,
  collection_media text,
  flow_rate_lpm_min numeric,
  flow_rate_lpm_max numeric,
  flow_drift_tolerance_pct numeric,          -- method-specific acceptance; no universal default
  min_volume_l numeric,
  result_basis text not null default 'mass_on_sample' check (result_basis in ('mass_on_sample','concentration')),
  suitable_for_formal_assessment boolean not null default true,
  notes text,
  status text not null default 'active' check (status in ('active','withdrawn')),
  unique (method_id, version)
);

create table laboratories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  accreditation_ref text,
  contact text
);

-- ───────────────────────── Instruments ─────────────────────────
create table instruments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid references clients(id),
  asset_tag text not null,
  instrument_type text not null check (instrument_type in ('sampling_pump','direct_reading_monitor','flow_calibrator','other')),
  make text, model text, serial_number text,
  measures text,                              -- capability description
  range_min numeric, range_max numeric, range_units text,
  screening_only boolean not null default false,
  status text not null default 'in_service' check (status in ('in_service','out_of_service','retired')),
  unique (tenant_id, asset_tag)
);
create table calibrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  instrument_id uuid not null references instruments(id),
  performed_at date not null,
  valid_until date not null,
  provider text,
  certificate_ref text,
  outcome text not null check (outcome in ('pass','fail','adjusted_pass')),
  attachment_id uuid,
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  check (valid_until >= performed_at)
);
create table instrument_maintenance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  instrument_id uuid not null references instruments(id),
  at date not null,
  kind text not null,
  notes text,
  recorded_by uuid
);

-- ───────────────────────── Workers & exposure groups ─────────────────────────
create table workers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  ref_code text not null,                    -- pseudonymous reference used across the app
  created_at timestamptz not null default now(),
  unique (tenant_id, ref_code)
);
-- Identifiable data held separately; readable only when app.pii = 'on'
create table worker_identities (
  worker_id uuid primary key references workers(id),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  full_name text not null,
  employee_number text,
  disposed_at timestamptz
);

create table hazards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  task_id uuid not null references tasks(id),
  substance_id uuid not null references substances(id),
  physical_form text not null check (physical_form in ('dust','fume','mist','vapour','gas','fibre','aerosol','other')),
  exposure_routes text[] not null default '{inhalation}',
  description text,
  exposure_frequency text,
  exposure_duration_min numeric,
  exposure_basis text not null default 'user_estimate' check (exposure_basis in ('recorded_fact','user_estimate','professionally_reviewed')),
  existing_controls text,
  assessment_owner_id uuid references users(id),
  review_triggers text,
  review_due date,
  updated_at timestamptz not null default now()
);

create table exposure_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  site_id uuid not null references sites(id),
  name text not null,
  description text,
  rationale text not null check (length(trim(rationale)) >= 20),
  review_required boolean not null default false,
  review_reason text,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table exposure_group_tasks (
  tenant_id uuid not null references tenants(id),
  group_id uuid not null references exposure_groups(id),
  task_id uuid not null references tasks(id),
  primary key (group_id, task_id)
);
create table exposure_group_hazards (
  tenant_id uuid not null references tenants(id),
  group_id uuid not null references exposure_groups(id),
  hazard_id uuid not null references hazards(id),
  primary key (group_id, hazard_id)
);
create table group_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  group_id uuid not null references exposure_groups(id),
  worker_id uuid not null references workers(id),
  valid_from date not null,
  valid_to date,
  reason text,
  created_by uuid,
  check (valid_to is null or valid_to >= valid_from)
);
create table group_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  group_id uuid not null references exposure_groups(id),
  trigger text not null,
  outcome text not null check (outcome in ('group_still_valid','group_revised','group_split','group_retired')),
  notes text not null,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now()
);

-- ───────────────────────── Monitoring plans ─────────────────────────
create table monitoring_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  site_id uuid not null references sites(id),
  title text not null,
  purpose text not null,
  assessment_question text not null,
  approach text not null check (approach in ('personal','static','mixed','other')),
  strategy_rationale text not null,
  intended_duration_min numeric,
  coverage_notes text,
  lab_requirements text,
  operating_conditions text,
  quality_checks text,
  practitioner_id uuid references users(id),
  reviewer_id uuid references users(id),
  status text not null default 'draft' check (status in ('draft','reviewed','scheduled','in_progress','completed','cancelled')),
  planned_start date,
  planned_end date,
  reviewed_by uuid, reviewed_at timestamptz,
  cancelled_reason text,
  version int not null default 1,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table plan_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  plan_id uuid not null references monitoring_plans(id),
  group_id uuid references exposure_groups(id),
  substance_id uuid not null references substances(id),
  method_version_id uuid references sampling_method_versions(id),
  planned_samples int,
  notes text
);
create table plan_instruments (
  tenant_id uuid not null references tenants(id),
  plan_id uuid not null references monitoring_plans(id),
  instrument_id uuid not null references instruments(id),
  primary key (plan_id, instrument_id)
);

-- ───────────────────────── Sampling & laboratory ─────────────────────────
create table sampling_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  plan_id uuid references monitoring_plans(id),
  sample_code text not null,
  sample_type text not null check (sample_type in ('personal','static','field_blank','other')),
  worker_id uuid references workers(id),
  group_id_at_sampling uuid references exposure_groups(id),   -- frozen association; never rewritten by membership changes
  location_desc text,
  substance_id uuid references substances(id),
  method_version_id uuid references sampling_method_versions(id),
  instrument_id uuid references instruments(id),
  media_lot text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  interruptions jsonb not null default '[]'::jsonb,
  tasks_performed text,
  flow_pre_lpm numeric,
  flow_post_lpm numeric,
  control_status text,
  operating_conditions text,
  deviations text,
  notes text,
  handover_to text,
  handover_at timestamptz,
  status text not null default 'planned' check (status in ('planned','in_progress','collected','dispatched','received','analysed','void')),
  void_reason text,
  client_uuid uuid unique,                 -- idempotency key for offline capture
  version int not null default 1,
  captured_offline boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sample_code),
  check (end_at is null or start_at is null or end_at > start_at),
  check (sample_type <> 'personal' or worker_id is not null or status = 'planned')
);
create table sample_qc_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  sampling_event_id uuid not null references sampling_events(id),
  check_type text not null,
  outcome text not null check (outcome in ('pass','fail','not_applicable')),
  detail text,
  recorded_by uuid, recorded_at timestamptz not null default now(),
  disposition text check (disposition in ('accepted_with_justification','sample_invalidated')),
  disposition_reason text,
  disposition_by uuid, disposition_at timestamptz
);
create table lab_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  laboratory_id uuid not null references laboratories(id),
  reference text not null,
  dispatched_at timestamptz, dispatched_by uuid, courier_ref text,
  received_at timestamptz, received_condition text,
  notes text,
  created_at timestamptz not null default now()
);
create table lab_submission_samples (
  tenant_id uuid not null references tenants(id),
  submission_id uuid not null references lab_submissions(id),
  sampling_event_id uuid not null references sampling_events(id),
  primary key (submission_id, sampling_event_id)
);
create table custody_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  sampling_event_id uuid not null references sampling_events(id),
  event text not null check (event in ('collected','handed_over','dispatched','received_by_lab','analysed','result_amended','returned','discarded')),
  at timestamptz not null,
  party text,
  condition text,
  notes text,
  recorded_by uuid,
  recorded_at timestamptz not null default now()
);
create table lab_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  sampling_event_id uuid not null references sampling_events(id),
  substance_id uuid not null references substances(id),
  analyte_name text not null,
  current_revision int not null default 1,
  unique (sampling_event_id, substance_id)
);
create table lab_result_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  result_id uuid not null references lab_results(id),
  revision int not null,
  value numeric,
  unit text not null check (unit in ('ug','mg','ug/m3','mg/m3','ppm','f/ml')),
  qualifier text not null check (qualifier in ('=','<LOD','<LOQ','>','estimated')),
  lod numeric, loq numeric,
  analytical_method text,
  laboratory_id uuid references laboratories(id),
  lab_report_ref text,
  uncertainty text,
  sample_condition text,
  lab_comments text,
  source_attachment_id uuid,
  amendment_reason text,
  import_batch_id uuid,
  entered_by uuid,
  entered_at timestamptz not null default now(),
  unique (result_id, revision),
  check (revision = 1 or amendment_reason is not null),
  check (qualifier not in ('=','>','estimated') or value is not null),
  check (qualifier <> '<LOD' or lod is not null or value is not null)
);
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid references clients(id),
  kind text not null,
  filename text,
  laboratory_id uuid references laboratories(id),
  source_attachment_id uuid,
  status text not null default 'staged' check (status in ('staged','validated','rejected','committed')),
  row_count int not null default 0,
  error_count int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create table import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  batch_id uuid not null references import_batches(id),
  row_no int not null,
  raw jsonb not null,
  parsed jsonb,
  errors jsonb not null default '[]'::jsonb
);

-- ───────────────────────── Assessments ─────────────────────────
create table assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  group_id uuid not null references exposure_groups(id),
  substance_id uuid not null references substances(id),
  plan_id uuid references monitoring_plans(id),
  title text not null,
  assessment_question text not null,
  current_revision int not null default 1,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table assessment_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  assessment_id uuid not null references assessments(id),
  revision int not null,
  status text not null default 'draft' check (status in ('draft','in_review','approved','superseded','withdrawn')),
  sample_ids uuid[] not null default '{}',
  calc_code text,
  calc_version text,
  parameters jsonb not null default '{}'::jsonb,
  calc_output jsonb,
  data_quality_state text check (data_quality_state in ('complete','qualified','incomplete','failed')),
  benchmark_state text check (benchmark_state in ('below_benchmark','at_or_above_benchmark','indeterminate','not_comparable','no_verified_benchmark')),
  benchmark_version_id uuid references benchmark_versions(id),
  interpretation text,
  conclusion_category text check (conclusion_category in ('exposure_adequately_controlled','improvement_required','urgent_action_required','insufficient_evidence')),
  limitations text,
  inputs_snapshot jsonb,
  inputs_hash text,
  submitted_by uuid, submitted_at timestamptz,
  reviewer_id uuid, approved_at timestamptz,
  approval_scope text, approval_limitations text,
  snapshot_hash text,
  supersedes_revision_id uuid,
  change_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (assessment_id, revision),
  check (status <> 'approved' or (reviewer_id is not null and approved_at is not null and approval_scope is not null and approval_limitations is not null and inputs_snapshot is not null and snapshot_hash is not null and interpretation is not null and conclusion_category is not null))
);

-- Approved revisions are immutable except for transition to superseded/withdrawn.
create or replace function protect_approved_revision() returns trigger language plpgsql as $$
begin
  if old.status in ('approved','superseded','withdrawn') then
    if old.status = 'approved' and new.status in ('superseded','withdrawn')
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
      return new;
    end if;
    raise exception 'approved assessment revision % is immutable; create a new revision', old.id
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_protect_approved before update on assessment_revisions
  for each row execute function protect_approved_revision();
create or replace function forbid_delete() returns trigger language plpgsql as $$
begin raise exception '% rows cannot be deleted', tg_table_name using errcode = 'P0001'; end $$;
create trigger trg_no_delete_rev before delete on assessment_revisions for each row execute function forbid_delete();
create trigger trg_no_delete_lrr before delete on lab_result_revisions for each row execute function forbid_delete();
create trigger trg_no_delete_cus before delete on custody_events for each row execute function forbid_delete();
create or replace function forbid_update() returns trigger language plpgsql as $$
begin raise exception '% rows are append-only', tg_table_name using errcode = 'P0001'; end $$;
create trigger trg_lrr_append before update on lab_result_revisions for each row execute function forbid_update();
create trigger trg_cus_append before update on custody_events for each row execute function forbid_update();
create trigger trg_audit_append before update or delete on audit_events for each row execute function forbid_update();

-- ───────────────────────── Controls & actions ─────────────────────────
create table controls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  site_id uuid not null references sites(id),
  name text not null,
  kind text not null check (kind in ('elimination_substitution','process_change','enclosure','local_exhaust_ventilation','general_ventilation','suppression','work_practice','rpe','ppe','other')),
  purpose text not null,
  process_id uuid references processes(id),
  hazard_id uuid references hazards(id),
  group_id uuid references exposure_groups(id),
  owner_user_id uuid references users(id),
  performance_criteria text,
  status text not null default 'proposed' check (status in ('proposed','in_service','defective','withdrawn')),
  created_at timestamptz not null default now()
);
create table control_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  control_id uuid not null references controls(id),
  at date not null,
  kind text not null check (kind in ('routine_inspection','maintenance','thorough_examination_test','performance_test','commissioning')),
  outcome text not null check (outcome in ('satisfactory','defect_found','failed')),
  measurements text,
  notes text,
  recorded_by uuid,
  recorded_at timestamptz not null default now()
);
create table actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  title text not null,
  description text,
  source_type text not null check (source_type in ('assessment','control_inspection','group_review','manual')),
  source_id uuid,
  control_id uuid references controls(id),
  group_id uuid references exposure_groups(id),
  owner_user_id uuid references users(id),
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  due_date date,
  verification_requirement text not null,
  requires_exposure_reassessment boolean not null default false,
  status text not null default 'assigned' check (status in ('assigned','implemented','evidence_submitted','effectiveness_reviewed','verified_closed','cancelled')),
  implemented_by uuid, implemented_at timestamptz,
  evidence_inspection_id uuid references control_inspections(id),
  verification_assessment_revision_id uuid references assessment_revisions(id),
  effectiveness_outcome text check (effectiveness_outcome in ('effective','partially_effective','not_effective')),
  effectiveness_reviewed_by uuid, effectiveness_reviewed_at timestamptz,
  closed_by uuid, closed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table action_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  action_id uuid not null references actions(id),
  from_status text, to_status text not null,
  notes text,
  by_user uuid,
  at timestamptz not null default now()
);
create trigger trg_ae_append before update or delete on action_events for each row execute function forbid_update();

-- ───────────────────────── Attachments, reports, AI, governance ─────────────────────────
create table attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid references clients(id),
  entity_type text not null,
  entity_id uuid not null,
  filename text not null,
  mime_type text not null,
  size_bytes int not null,
  sha256 text not null,
  storage_key text not null,
  contains_pii boolean not null default false,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  disposed_at timestamptz
);
create table reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  assessment_id uuid not null references assessments(id),
  assessment_revision_id uuid not null references assessment_revisions(id),
  version int not null,
  status text not null check (status in ('draft','issued')),
  content_html text not null,
  content_hash text not null,
  generated_by uuid,
  generated_at timestamptz not null default now(),
  unique (assessment_id, version)
);
create trigger trg_reports_append before update or delete on reports for each row execute function forbid_update();

create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid references clients(id),
  kind text not null check (kind in ('extraction','evidence_gap','summary','narrative_draft')),
  entity_type text not null,
  entity_id uuid not null,
  content jsonb not null,
  source_refs jsonb not null default '[]'::jsonb,
  provider text not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  decided_by uuid, decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table retention_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  record_class text not null check (record_class in ('worker_identity','attachment','audit_event','sampling_record')),
  retain_years int not null check (retain_years > 0),
  basis text not null,
  unique (tenant_id, record_class)
);
create table disposal_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  record_class text not null,
  entity_id uuid not null,
  reason text not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed')),
  decided_by uuid, decided_at timestamptz,
  executed_at timestamptz,
  check (decided_by is null or decided_by <> requested_by)
);

create table sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  entity_type text not null,
  entity_id uuid not null,
  client_uuid uuid,
  base_version int,
  server_version int,
  client_payload jsonb not null,
  server_payload jsonb not null,
  submitted_by uuid,
  submitted_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','resolved_keep_server','resolved_apply_client')),
  resolved_by uuid, resolved_at timestamptz, resolution_notes text
);

create table integration_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target text not null check (target in ('integrarisk','workassura','foresensa','sentrisafe','firesafe')),
  external_tenant_ref text not null,
  mode text not null default 'mock' check (mode in ('mock','live')),
  enabled boolean not null default false,
  endpoint_url text,
  unique (tenant_id, target)
);
create table integration_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target text not null,
  contract text not null,
  contract_version text not null,
  event_type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','delivered','failed','dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Row-Level Security ─────────────────────────
do $$
declare t text;
begin
  -- tables with mandatory client_id
  foreach t in array array['sites','work_areas','processes','tasks','workers','hazards','exposure_groups',
     'group_memberships','group_reviews','monitoring_plans','sampling_events','sample_qc_checks','lab_submissions',
     'custody_events','lab_results','lab_result_revisions','assessments','assessment_revisions','controls',
     'control_inspections','actions','action_events','reports','sync_conflicts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_client on %I using (tenant_id = app_tenant() and (app_client() is null or client_id = app_client())) with check (tenant_id = app_tenant() and (app_client() is null or client_id = app_client()))$p$, t);
  end loop;
  -- tenant-level tables (optionally client-tagged, otherwise visible across the tenant)
  foreach t in array array['instruments','attachments','import_batches','ai_suggestions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_opt_client on %I using (tenant_id = app_tenant() and (app_client() is null or client_id is null or client_id = app_client())) with check (tenant_id = app_tenant() and (app_client() is null or client_id = app_client()))$p$, t);
  end loop;
  -- tenant-only tables
  foreach t in array array['calibrations','instrument_maintenance','laboratories','exposure_group_tasks','exposure_group_hazards',
     'plan_targets','plan_instruments','lab_submission_samples','import_rows','retention_policies','disposal_requests',
     'integration_links','integration_outbox','clients','users'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_only on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())$p$, t);
  end loop;
  -- reference tables: platform rows readable by all; tenant rows only by owner; platform rows not writable by app
  foreach t in array array['substances','benchmarks','benchmark_versions','sampling_methods','sampling_method_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy ref_read on %I for select using (tenant_id is null or tenant_id = app_tenant())$p$, t);
    execute format($p$create policy ref_write on %I for all using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())$p$, t);
  end loop;
end $$;

alter table worker_identities enable row level security;
alter table worker_identities force row level security;
create policy pii_guard on worker_identities
  using (app_pii() and tenant_id = app_tenant() and (app_client() is null or client_id = app_client()))
  with check (app_pii() and tenant_id = app_tenant() and (app_client() is null or client_id = app_client()));

alter table tenants enable row level security;
alter table tenants force row level security;
create policy own_tenant on tenants for select using (id = app_tenant());
create policy own_tenant_upd on tenants for update using (id = app_tenant()) with check (id = app_tenant());

alter table audit_events enable row level security;
alter table audit_events force row level security;
create policy audit_read on audit_events for select using (tenant_id = app_tenant());
create policy audit_insert on audit_events for insert with check (tenant_id = app_tenant() or tenant_id is null);

-- sessions are only reachable through SECURITY DEFINER functions below
alter table sessions enable row level security;
alter table sessions force row level security;
create policy sess_tenant on sessions using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

-- ───────────────────────── Pre-tenant auth functions (SECURITY DEFINER) ─────────────────────────
create or replace function auth_lookup_user(p_email text)
returns table (id uuid, tenant_id uuid, password_hash text, status text, failed_logins int, locked_until timestamptz)
language sql security definer set search_path = public as
$$ select id, tenant_id, password_hash, status, failed_logins, locked_until from users where lower(email) = lower(p_email) $$;

create or replace function auth_session(p_id text)
returns table (session_id text, user_id uuid, tenant_id uuid, csrf_token text, mfa_passed boolean, expires_at timestamptz)
language sql security definer set search_path = public as
$$ select s.id, s.user_id, s.tenant_id, s.csrf_token, s.mfa_passed, s.expires_at
   from sessions s join users u on u.id = s.user_id
   where s.id = p_id and s.revoked_at is null and s.expires_at > now() and u.status = 'active' $$;
