-- Phase H2 re-check fixes (R2 re-check N1–N6): protected hold records with an explicit, reviewed dismissal;
-- immutable attachment content and placement; calibrations not editable; approval time and transitions fixed;
-- suspension lookups confined to the caller's organisation.

-- ── N6: suspension state of another organisation is not readable (treated as suspended)
create or replace function workflow_suspended(p_tenant uuid, p_workflow text) returns boolean language sql stable security definer set search_path = public as
$$ select case when app_tenant() is not null and p_tenant is distinct from app_tenant() then true
               else coalesce((select p_workflow = any(suspended_workflows) from tenants where id = p_tenant), true) end $$;

-- ── N1/N3: field intake holds — fixed content, controlled transitions, reviewed dismissal
alter table field_intake_holds drop constraint field_intake_holds_status_check;
alter table field_intake_holds add constraint field_intake_holds_status_check check (status in ('held','synchronised','in_conflict','dismissed'));
alter table field_intake_holds add column resolved_by uuid references users(id);
alter table field_intake_holds add column resolution_notes text;

create or replace function protect_intake_hold() returns trigger language plpgsql as $$
declare
  rv record;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'held' or new.sampling_event_id is not null or new.resolved_at is not null or new.resolved_by is not null or new.submitted_by is distinct from app_user() then
      raise exception 'hold refused: holds are created as held, by the submitting user' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['status','resolved_at','sampling_event_id','resolved_by','resolution_notes'])
     <> (to_jsonb(old) - array['status','resolved_at','sampling_event_id','resolved_by','resolution_notes']) then
    raise exception 'hold refused: the held record cannot be changed' using errcode = 'P0001';
  end if;
  if new.status = old.status then
    if (to_jsonb(new) - 'sampling_event_id') <> (to_jsonb(old) - 'sampling_event_id') or old.status <> 'in_conflict' then
      raise exception 'hold refused: no change permitted in status %', old.status using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.status in ('synchronised','dismissed') then
    raise exception 'hold refused: % holds are final', old.status using errcode = 'P0001';
  end if;
  if new.status = 'in_conflict' then
    if old.status <> 'held' or new.sampling_event_id is null then raise exception 'hold refused: invalid transition' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.status = 'synchronised' then
    -- The held content reached the record: the sample must carry the review flag (set first, in the same transaction).
    if new.sampling_event_id is null or not exists (select 1 from sampling_events where id = new.sampling_event_id and suspension_review_required) then
      raise exception 'hold refused: a hold is marked synchronised only once its sample is flagged for review' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.status = 'dismissed' then
    -- Reviewed decision that the held content does not enter the record (device copy discarded, stale or lost device).
    if new.resolved_by is null or new.resolved_by is distinct from app_user() or length(coalesce(trim(new.resolution_notes), '')) < 10 or new.resolved_by = old.submitted_by then
      raise exception 'hold refused: dismissal needs notes and a signed-in reviewer other than the submitter' using errcode = 'P0001';
    end if;
    select u.role, u.status, u.tenant_id into rv from users u where u.id = new.resolved_by;
    if rv.tenant_id is distinct from new.tenant_id or rv.status <> 'active' or rv.role not in ('practitioner','technical_reviewer') then
      raise exception 'hold refused: dismissal needs an active practitioner or technical reviewer' using errcode = 'P0001';
    end if;
    if workflow_suspended(new.tenant_id, 'field_sync') then
      raise exception 'hold refused: field synchronisation is suspended' using errcode = 'P0001';
    end if;
    return new;
  end if;
  raise exception 'hold refused: invalid transition' using errcode = 'P0001';
end $$;
create trigger trg_protect_intake_hold before insert or update on field_intake_holds for each row execute function protect_intake_hold();
create trigger trg_intake_hold_nodelete before delete on field_intake_holds for each row execute function forbid_update();

-- ── N2: attachment content and placement are immutable (only admission, disposal and the PII marker change)
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
  if (to_jsonb(new) - array['admitted_by','admitted_at','disposed_at','contains_pii']) <> (to_jsonb(old) - array['admitted_by','admitted_at','disposed_at','contains_pii']) then
    raise exception 'attachment refused: a stored file''s content, placement, quarantine and uploader cannot be changed' using errcode = 'P0001';
  end if;
  if old.disposed_at is not null and new.disposed_at is distinct from old.disposed_at then
    raise exception 'attachment refused: disposal is final' using errcode = 'P0001';
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
  elsif new.admitted_at is null and new.admitted_by is not null then
    raise exception 'attachment refused: admission needs both reviewer and time' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── N4: calibration records are evidence; the application never edits them
revoke update on calibrations from ohea_app;

-- ── N5: approval time is the database's; revision status transitions are fixed
create or replace function enforce_revision_transitions() returns trigger language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if (old.status = 'draft' and new.status = 'in_review')
     or (old.status = 'in_review' and new.status in ('draft','approved'))
     or (old.status = 'approved' and new.status in ('superseded','withdrawn')) then
    if new.status = 'approved' then new.approved_at := now(); end if;
    return new;
  end if;
  raise exception 'revision refused: % → % is not a permitted transition', old.status, new.status using errcode = 'P0001';
end $$;
-- Runs after trg_enforce_pilot_approval (alphabetical order), so the approval time it sets is final.
create trigger trg_revision_transitions before update on assessment_revisions for each row execute function enforce_revision_transitions();
