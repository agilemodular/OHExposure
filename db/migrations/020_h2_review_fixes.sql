-- Phase H2 independent review fixes (R2): approval by INSERT, writer-chosen approval facts, self-clearing of
-- suspension flags and quarantine, held updates and conflicts, hold races, method-review ordering, pilot
-- authorisation integrity, versioned attestation secrets and key revocation.

-- ── Suspension helper never returns NULL (a row hidden by RLS must not read as "not suspended")
create or replace function workflow_suspended(p_tenant uuid, p_workflow text) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select p_workflow = any(suspended_workflows) from tenants where id = p_tenant), true) $$;

-- ── Approval rules apply to INSERT as well as UPDATE; approval facts are never taken from the writer
create or replace function enforce_pilot_approval() returns trigger language plpgsql as $$
declare
  lvl text;
  bv record;
  rv record;
  need_minutes int;
  frozen text[] := array['status','reviewer_id','approved_at','approval_scope','approval_limitations','snapshot_hash',
                         'method_review_status','benchmark_provenance','assurance_level_at_approval','submitted_by','submitted_at'];
begin
  if tg_op = 'INSERT' then
    -- New revisions start as drafts with no approval or review facts; nothing can be born approved or in review.
    if new.status <> 'draft' or new.reviewer_id is not null or new.approved_at is not null or new.snapshot_hash is not null
       or new.method_review_status is not null or new.benchmark_provenance is not null or new.assurance_level_at_approval is not null
       or new.submitted_by is not null or new.created_by is null then
      raise exception 'revision refused: new revisions must be drafts without approval or review data, with an author' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'revision refused: the author cannot be changed' using errcode = 'P0001';
  end if;
  -- Once submitted, the content is frozen: only the review outcome may change (approval, or return to draft).
  if old.status = 'in_review' and (to_jsonb(new) - frozen) <> (to_jsonb(old) - frozen) then
    raise exception 'revision refused: a revision in review cannot be edited; return it to draft first' using errcode = 'P0001';
  end if;
  if old.status = 'in_review' and new.status = 'in_review' and new.submitted_by is distinct from old.submitted_by then
    raise exception 'revision refused: the submitter cannot be changed' using errcode = 'P0001';
  end if;
  if new.status = 'in_review' and old.status = 'draft' and (new.submitted_by is null or new.submitted_by is distinct from app_user()) then
    raise exception 'revision refused: the submitter must be the signed-in user' using errcode = 'P0001';
  end if;
  if new.status <> 'approved' or old.status = 'approved' then return new; end if;
  if old.status <> 'in_review' then
    raise exception 'approval refused: only a revision in review can be approved' using errcode = 'P0001';
  end if;
  if new.reviewer_id is null or new.reviewer_id is distinct from app_user() then
    raise exception 'approval refused: the reviewer must be the signed-in user' using errcode = 'P0001';
  end if;
  select u.id, u.role, u.status, u.tenant_id into rv from users u where u.id = new.reviewer_id;
  if rv.id is null or rv.tenant_id <> new.tenant_id or rv.status <> 'active' or rv.role <> 'technical_reviewer' then
    raise exception 'approval refused: reviewer must be an active technical reviewer of this organisation' using errcode = 'P0001';
  end if;
  if old.created_by is null or old.submitted_by is null or new.reviewer_id = old.created_by or new.reviewer_id = old.submitted_by then
    raise exception 'approval refused: reviewer must not be the author or submitter' using errcode = 'P0001';
  end if;
  if workflow_suspended(new.tenant_id, 'assessment_approval') then
    raise exception 'approval refused: assessment approval is suspended for this organisation' using errcode = 'P0001';
  end if;
  perform 1 from assessments where id = new.assessment_id for share;   -- serialises with placing a hold
  if assessment_on_hold(new.assessment_id) then
    raise exception 'approval refused: assessment is on hold' using errcode = 'P0001';
  end if;
  if exists (select 1 from sampling_events where id = any(new.sample_ids) and suspension_review_required and suspension_reviewed_at is null)
     or exists (select 1 from field_intake_holds where status in ('held','in_conflict') and (server_id = any(new.sample_ids) or sampling_event_id = any(new.sample_ids))) then
    raise exception 'approval refused: a sample has field records received during a suspension that have not been reviewed' using errcode = 'P0001';
  end if;
  select assurance_level into lvl from tenants where id = new.tenant_id;
  new.assurance_level_at_approval := lvl;
  new.method_review_status := method_status_effective(coalesce(new.calc_code, 'twa_8h'), new.calc_version);
  select v.provenance, v.verification_status, b.averaging_minutes into bv
    from benchmark_versions v join benchmarks b on b.id = v.benchmark_id where v.id = new.benchmark_version_id;
  new.benchmark_provenance := bv.provenance;
  new.approved_at := coalesce(new.approved_at, now());
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
drop trigger if exists trg_enforce_pilot_approval on assessment_revisions;
create trigger trg_enforce_pilot_approval before insert or update on assessment_revisions
  for each row execute function enforce_pilot_approval();

-- ── Report issue: expired approvals also refused for new issue; hold row share-locked
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
  if new.generated_by is distinct from app_user() then
    raise exception 'report issue refused: the issuer must be the signed-in user' using errcode = 'P0001';
  end if;
  select u.role, u.status, u.tenant_id into g from users u where u.id = new.generated_by;
  if g.tenant_id is distinct from new.tenant_id or g.status <> 'active' or g.role not in ('practitioner', 'technical_reviewer') then
    raise exception 'report issue refused: issuer must be an active practitioner or technical reviewer of this organisation' using errcode = 'P0001';
  end if;
  if workflow_suspended(new.tenant_id, 'report_issue') then
    raise exception 'report issue refused: report issue is suspended for this organisation' using errcode = 'P0001';
  end if;
  perform 1 from assessments where id = new.assessment_id for share;
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
    if cur in ('rejected', 'withdrawn', 'expired') then
      raise exception 'report issue refused: calculation method approval is now %', cur using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ── Suspension-review flags: set only by the system, cleared once, by someone who did not submit the record
alter table field_intake_holds drop constraint field_intake_holds_status_check;
alter table field_intake_holds add constraint field_intake_holds_status_check check (status in ('held','synchronised','in_conflict'));

create or replace function protect_suspension_review() returns trigger language plpgsql as $$
declare
  rv record;
begin
  if old.suspension_review_required and not new.suspension_review_required then
    raise exception 'suspension review flag cannot be removed; a reviewer must clear it' using errcode = 'P0001';
  end if;
  if old.suspension_reviewed_at is not null and new.suspension_reviewed_at is not null
     and (new.suspension_reviewed_at <> old.suspension_reviewed_at or new.suspension_reviewed_by is distinct from old.suspension_reviewed_by) then
    raise exception 'suspension review is recorded once' using errcode = 'P0001';
  end if;
  if new.suspension_reviewed_at is null and old.suspension_reviewed_at is not null and not (new.suspension_review_required and old.suspension_review_required) then
    raise exception 'suspension review cannot be removed' using errcode = 'P0001';
  end if;
  if new.suspension_reviewed_at is not null and old.suspension_reviewed_at is null then
    if not new.suspension_review_required then
      raise exception 'nothing to clear' using errcode = 'P0001';
    end if;
    if new.suspension_reviewed_by is null or new.suspension_reviewed_by is distinct from app_user() then
      raise exception 'suspension review must be recorded by the signed-in user' using errcode = 'P0001';
    end if;
    select u.role, u.status, u.tenant_id into rv from users u where u.id = new.suspension_reviewed_by;
    if rv.tenant_id is distinct from new.tenant_id or rv.status <> 'active' or rv.role not in ('practitioner', 'technical_reviewer') then
      raise exception 'suspension review must be recorded by an active practitioner or technical reviewer' using errcode = 'P0001';
    end if;
    if new.suspension_reviewed_by = old.created_by or new.suspension_reviewed_by is not distinct from old.recovered_from_user
       or exists (select 1 from field_intake_holds h where (h.sampling_event_id = old.id or h.server_id = old.id or h.client_uuid = old.client_uuid) and h.submitted_by = new.suspension_reviewed_by) then
      raise exception 'suspension review must be recorded by someone other than the person who captured or submitted the record' using errcode = 'P0001';
    end if;
    if workflow_suspended(new.tenant_id, 'field_sync') then
      raise exception 'field synchronisation is suspended' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger trg_protect_suspension_review before update on sampling_events for each row execute function protect_suspension_review();

-- ── Attachments: quarantine is permanent, admission once by an eligible reviewer, ordinary rows refused while suspended
create or replace function attachment_workflow(p_entity text) returns text language sql immutable as
$$ select case p_entity when 'sampling_event' then 'field_sync' when 'lab_submission' then 'lab_import' when 'lab_result' then 'lab_import'
     when 'import_batch' then 'lab_import' when 'control_inspection' then 'action_closure' when 'action' then 'action_closure'
     when 'assessment' then 'assessment_approval' when 'calibration' then 'field_sync' when 'instrument' then 'field_sync' else null end $$;

create or replace function protect_attachment() returns trigger language plpgsql as $$
declare
  rv record;
  wf text := attachment_workflow(new.entity_type);
begin
  if tg_op = 'INSERT' then
    if new.admitted_at is not null or new.admitted_by is not null then
      raise exception 'attachment refused: files cannot be inserted as already admitted' using errcode = 'P0001';
    end if;
    if not new.quarantined and wf is not null and workflow_suspended(new.tenant_id, wf) then
      raise exception 'attachment refused: % is suspended; use the remediation intake', wf using errcode = 'P0001';
    end if;
    if new.quarantined and (wf is null or not workflow_suspended(new.tenant_id, wf)) then
      raise exception 'attachment refused: quarantined intake is only for records whose workflow is suspended' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.quarantined is distinct from old.quarantined or new.intake_reason is distinct from old.intake_reason or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'attachment refused: quarantine and uploader cannot be changed' using errcode = 'P0001';
  end if;
  if old.admitted_at is not null and (new.admitted_at is distinct from old.admitted_at or new.admitted_by is distinct from old.admitted_by) then
    raise exception 'attachment refused: admission is recorded once' using errcode = 'P0001';
  end if;
  if old.admitted_at is null and new.admitted_at is not null then
    if not old.quarantined then raise exception 'attachment refused: only quarantined files are admitted' using errcode = 'P0001'; end if;
    if new.admitted_by is distinct from app_user() then raise exception 'attachment refused: admission must be recorded by the signed-in user' using errcode = 'P0001'; end if;
    select u.role, u.status, u.tenant_id into rv from users u where u.id = new.admitted_by;
    if rv.tenant_id is distinct from new.tenant_id or rv.status <> 'active' or rv.role <> 'technical_reviewer' or new.admitted_by = old.uploaded_by then
      raise exception 'attachment refused: admission needs an active technical reviewer other than the uploader' using errcode = 'P0001';
    end if;
    if wf is not null and workflow_suspended(new.tenant_id, wf) then
      raise exception 'attachment refused: % is still suspended', wf using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger trg_protect_attachment before insert or update on attachments for each row execute function protect_attachment();

-- Evidence links may not point at quarantined, unadmitted files.
create or replace function refuse_unadmitted_link() returns trigger language plpgsql as $$
declare
  att uuid := coalesce(to_jsonb(new)->>'attachment_id', to_jsonb(new)->>'source_attachment_id')::uuid;
begin
  if att is not null and exists (select 1 from attachments where id = att and quarantined and admitted_at is null) then
    raise exception 'evidence link refused: the file is quarantined remediation evidence not yet admitted' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_lab_rev_link before insert on lab_result_revisions for each row execute function refuse_unadmitted_link();
create trigger trg_import_link before insert or update on import_batches for each row execute function refuse_unadmitted_link();
create trigger trg_calibration_link before insert on calibrations for each row execute function refuse_unadmitted_link();

-- ── Method reviews: strict ordering within a transaction; views expose all columns
alter table method_reviews add column seq bigserial;
alter table method_reviews alter column recorded_at set default clock_timestamp();
create or replace function method_status_effective(p_code text, p_version text) returns text language sql stable as
$$ select case when r.status in ('approved','approved_with_conditions') and r.expires_on is not null and r.expires_on < current_date
               then 'expired' else coalesce(r.status, 'not_reviewed') end
   from (select 1) one left join lateral (
     select status, expires_on from method_reviews where calc_code = p_code and calc_version = p_version order by recorded_at desc, seq desc limit 1) r on true $$;
drop view current_method_reviews;
create view current_method_reviews as
  select distinct on (calc_code, calc_version) * from method_reviews order by calc_code, calc_version, recorded_at desc, seq desc;
grant select on current_method_reviews to ohea_app;

-- ── Pilot authorisations: withdrawal is the only permitted change, once; withdrawal returns the tenant to evaluation;
--    pilot level also requires an approved method and reference data at the time it is set.
create or replace function protect_pilot_authorisation() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'withdrawn_at') <> (to_jsonb(old) - 'withdrawn_at') or old.withdrawn_at is not null or new.withdrawn_at is null then
    raise exception 'pilot authorisations are append-only; the only permitted change is a single withdrawal' using errcode = 'P0001';
  end if;
  update tenants set assurance_level = 'evaluation' where id = new.tenant_id and assurance_level = 'pilot'
    and not exists (select 1 from pilot_authorisations where tenant_id = new.tenant_id and withdrawn_at is null and id <> new.id);
  return new;
end $$;
create trigger trg_pilot_auth_update before update on pilot_authorisations for each row execute function protect_pilot_authorisation();

create or replace function enforce_pilot_level() returns trigger language plpgsql as $$
begin
  if new.assurance_level = 'pilot' and old.assurance_level is distinct from 'pilot' then
    if not exists (select 1 from pilot_authorisations where tenant_id = new.id and withdrawn_at is null) then
      raise exception 'pilot level refused: no recorded pilot authorisation (G11) for this organisation' using errcode = 'P0001';
    end if;
    if not exists (select 1 from (select distinct calc_code, calc_version from method_reviews) m
                   where method_status_effective(m.calc_code, m.calc_version) in ('approved','approved_with_conditions')) then
      raise exception 'pilot level refused: no calculation method has a current professional approval' using errcode = 'P0001';
    end if;
    if not exists (select 1 from benchmark_versions where provenance = 'professional_reference' and verification_status = 'verified') then
      raise exception 'pilot level refused: no verified professional reference benchmark exists' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ── Recovery keys: separate attestation secret per version; revocation
alter table field_recovery_keys add column attest_secret_enc text;
alter table field_recovery_keys add column revoked_at timestamptz;
