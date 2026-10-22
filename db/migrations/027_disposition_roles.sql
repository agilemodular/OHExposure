-- R4 re-check (N4): setting evidence aside as "outside scope" removes it from the overall comparison, so it is a
-- technical reviewer's decision, like "remaining coverage adequate". Practitioners may record "duplicate" (checked by the
-- engine against the same worker and shift) and "not replaced".
create or replace function protect_evidence_disposition() returns trigger language plpgsql as $$
declare u record; r record;
begin
  if tg_op <> 'INSERT' then raise exception 'evidence dispositions are append-only' using errcode = 'P0001'; end if;
  if new.recorded_by is distinct from app_user() then raise exception 'evidence disposition refused: must be recorded by the signed-in user' using errcode = 'P0001'; end if;
  select role, status, tenant_id into u from users where id = new.recorded_by;
  if u.tenant_id is distinct from new.tenant_id or u.status <> 'active' or u.role not in ('practitioner','technical_reviewer') then
    raise exception 'evidence disposition refused: only an active practitioner or technical reviewer can disposition evidence' using errcode = 'P0001';
  end if;
  if new.kind in ('remaining_coverage_adequate','outside_scope') and u.role <> 'technical_reviewer' then
    raise exception 'evidence disposition refused: only a technical reviewer can set evidence aside as outside scope or accept that the remaining coverage is adequate' using errcode = 'P0001';
  end if;
  select status, tenant_id, client_id, sample_ids into r from assessment_revisions where id = new.revision_id for share;
  if r.status is distinct from 'draft' then raise exception 'evidence disposition refused: the revision is not a draft' using errcode = 'P0001'; end if;
  if r.tenant_id is distinct from new.tenant_id or r.client_id is distinct from new.client_id then raise exception 'evidence disposition refused: revision mismatch' using errcode = 'P0001'; end if;
  if not (new.sampling_event_id = any(r.sample_ids)) then raise exception 'evidence disposition refused: the sample is not part of this revision' using errcode = 'P0001'; end if;
  if new.related_sampling_event_id is not null and (not (new.related_sampling_event_id = any(r.sample_ids)) or new.related_sampling_event_id = new.sampling_event_id) then
    raise exception 'evidence disposition refused: the related sample must be another sample of this revision' using errcode = 'P0001';
  end if;
  return new;
end $$;
