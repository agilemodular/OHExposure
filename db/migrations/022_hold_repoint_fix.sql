-- R2 final re-check: a hold's sample link cannot be changed while its status stays the same.
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
    raise exception 'hold refused: no change permitted without a status transition' using errcode = 'P0001';
  end if;
  if old.status in ('synchronised','dismissed') then
    raise exception 'hold refused: % holds are final', old.status using errcode = 'P0001';
  end if;
  if old.status = 'in_conflict' and new.sampling_event_id is distinct from old.sampling_event_id then
    raise exception 'hold refused: the sample of a held conflict cannot be changed' using errcode = 'P0001';
  end if;
  if new.status = 'in_conflict' then
    if old.status <> 'held' or new.sampling_event_id is null then raise exception 'hold refused: invalid transition' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.status = 'synchronised' then
    if new.sampling_event_id is null or not exists (select 1 from sampling_events where id = new.sampling_event_id and suspension_review_required) then
      raise exception 'hold refused: a hold is marked synchronised only once its sample is flagged for review' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.status = 'dismissed' then
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
