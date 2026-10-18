-- Phase H1: pilot controls. Tenant assurance level, offline capture gate, workflow suspension,
-- professional method reviews, reference-data provenance, field recovery keys, device clock evidence.

-- ── Tenant controls (set only by platform operators through scripts; the application role cannot change them)
alter table tenants add column assurance_level text not null default 'evaluation'
  check (assurance_level in ('demo','evaluation','pilot'));
alter table tenants add column offline_capture_enabled boolean not null default false;
alter table tenants add column suspended_workflows text[] not null default '{}'
  check (suspended_workflows <@ array['field_sync','lab_import','assessment_approval','report_issue','action_closure']::text[]);
alter table tenants add column suspension_reason text;
update tenants set assurance_level = 'demo', offline_capture_enabled = true where is_demo;
revoke update on tenants from ohea_app;
grant update (name, branding) on tenants to ohea_app;

-- ── Professional method reviews (platform-wide, append-only history; latest row per method version is current)
create table method_reviews (
  id uuid primary key default gen_random_uuid(),
  calc_code text not null,
  calc_version text not null,
  status text not null check (status in ('not_reviewed','approved','approved_with_conditions','rejected')),
  conditions text,
  reviewer_name text,
  reviewer_competence text,
  reviewed_on date,
  evidence_ref text,
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  check (status = 'not_reviewed' or (reviewer_name is not null and reviewer_competence is not null and reviewed_on is not null and evidence_ref is not null)),
  check (status <> 'approved_with_conditions' or conditions is not null)
);
create trigger trg_method_reviews_append before update or delete on method_reviews for each row execute function forbid_update();
alter table method_reviews enable row level security;
alter table method_reviews force row level security;
create policy read_all on method_reviews for select using (true);
grant select on method_reviews to ohea_app;
revoke insert, update, delete on method_reviews from ohea_app;

create or replace view current_method_reviews as
  select distinct on (calc_code, calc_version) * from method_reviews order by calc_code, calc_version, recorded_at desc;
grant select on current_method_reviews to ohea_app;

-- ── Reference-data provenance (professionally verified platform reference vs tenant-entered vs synthetic)
alter table benchmark_versions disable trigger trg_protect_benchmark;
alter table benchmark_versions add column provenance text not null default 'tenant_entered'
  check (provenance in ('tenant_entered','professional_reference','synthetic'));
alter table benchmark_versions add column reviewer_name text;
alter table benchmark_versions add column verified_on date;
alter table benchmark_versions add column permitted_use text;
alter table benchmark_versions add column licence_note text;
update benchmark_versions set provenance = 'synthetic' where is_synthetic;
alter table benchmark_versions enable trigger trg_protect_benchmark;
alter table benchmark_versions add constraint professional_reference_complete check (
  provenance <> 'professional_reference' or (tenant_id is null and not is_synthetic and verification_status in ('verified','withdrawn')
    and reviewer_name is not null and verified_on is not null and permitted_use is not null and source_url is not null));
alter table benchmark_versions add constraint synthetic_flag_consistent check ((provenance = 'synthetic') = is_synthetic);

-- Assessment revisions record the review status of the method and the provenance of the benchmark at approval.
alter table assessment_revisions disable trigger trg_protect_approved;
alter table assessment_revisions add column method_review_status text;
alter table assessment_revisions add column benchmark_provenance text;
alter table assessment_revisions enable trigger trg_protect_approved;

-- ── Field recovery: per-tenant key pair. Private key is stored encrypted with a key held outside the database.
create table field_recovery_keys (
  tenant_id uuid primary key references tenants(id),
  public_key_spki text not null,
  private_key_enc text not null,
  created_at timestamptz not null default now()
);
alter table field_recovery_keys enable row level security;
alter table field_recovery_keys force row level security;
create policy tenant_only on field_recovery_keys using (tenant_id = app_tenant()) with check (tenant_id = app_tenant() and app_client() is null);
grant select, insert on field_recovery_keys to ohea_app;

create table field_recovery_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  file_sha256 text not null,
  original_user_id uuid,
  imported_by uuid not null,
  items int not null,
  outcomes jsonb not null,
  imported_at timestamptz not null default now()
);
create trigger trg_fri_append before update or delete on field_recovery_imports for each row execute function forbid_update();
alter table field_recovery_imports enable row level security;
alter table field_recovery_imports force row level security;
create policy tenant_only on field_recovery_imports using (tenant_id = app_tenant()) with check (tenant_id = app_tenant() and app_client() is null);
grant select, insert on field_recovery_imports to ohea_app;

-- ── Device clock evidence on field records
alter table sampling_events add column device_clock_offset_s int;
alter table sampling_events add column recovered_from_user uuid;
