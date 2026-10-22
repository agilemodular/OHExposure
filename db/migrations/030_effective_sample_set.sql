-- TR-08 (application change; engine and method versions unchanged): one shared resolver for an assessment revision's
-- EFFECTIVE evidence set, used by the service (snapshot, locks, holds, suspension review, reviewer independence,
-- freshness) and by the database approval trigger. Adds functions and replaces one trigger function; no row is changed.
--
--   effective samples = selected samples (assessment_revisions.sample_ids)
--                     ∪ samples whose LATEST removal request has no LATER reviewer confirmation
--
-- Rules: duplicates removed; deterministic order (selected in stored order, then pending removals by id); only removal
-- rows of the revision's own tenant and client, for samples of that tenant and client; a re-added sample is selected
-- (its removal history is kept); a confirmation counts only if it is later (seq) than the latest request, so an earlier
-- confirmation never authorises a later request.

create or replace function assessment_removal_state(p_revision uuid, p_selected uuid[])
returns table (sampling_event_id uuid, state text, requested_seq bigint, confirmed_seq bigint)
language sql stable as $$
  with r as (select id, tenant_id, client_id from assessment_revisions where id = p_revision),
  req as (
    select x.sampling_event_id, max(x.seq) seq from assessment_sample_removals x join r on x.revision_id = r.id and x.tenant_id = r.tenant_id and x.client_id = r.client_id
    where x.action = 'requested' group by x.sampling_event_id),
  conf as (
    select x.sampling_event_id, max(x.seq) seq from assessment_sample_removals x join r on x.revision_id = r.id and x.tenant_id = r.tenant_id and x.client_id = r.client_id
    where x.action = 'confirmed' group by x.sampling_event_id)
  select q.sampling_event_id,
         case when q.sampling_event_id = any(coalesce(p_selected, '{}')) then 're_added'
              when c.seq is not null and c.seq > q.seq then 'confirmed'
              else 'pending' end,
         q.seq, c.seq
  from req q
  left join conf c on c.sampling_event_id = q.sampling_event_id
  join sampling_events e on e.id = q.sampling_event_id
  join r on e.tenant_id = r.tenant_id and e.client_id = r.client_id
  order by q.sampling_event_id
$$;

create or replace function assessment_effective_sample_ids(p_revision uuid, p_selected uuid[])
returns uuid[] language sql stable as $$
  select coalesce(array_agg(id order by grp, ord, id), '{}'::uuid[]) from (
    select distinct on (id) id, grp, ord from (
      select u.id, 0 grp, u.ord from unnest(coalesce(p_selected, '{}'::uuid[])) with ordinality u(id, ord)
      union all
      select s.sampling_event_id, 1, 0 from assessment_removal_state(p_revision, p_selected) s where s.state = 'pending'
    ) all_ids order by id, grp, ord
  ) d
$$;

create or replace function assessment_effective_sample_ids(p_revision uuid)
returns uuid[] language sql stable as $$
  select assessment_effective_sample_ids(r.id, r.sample_ids) from assessment_revisions r where r.id = p_revision
$$;

-- The approval trigger (migration 020) checked held records and suspension review against sample_ids only. Re-created
-- from the exact 020 body with the evidence section changed to the effective set; it now also refuses approval by a
-- reviewer who recorded a QC disposition for any effective sample (previously checked only in the service).
create or replace function enforce_pilot_approval() returns trigger language plpgsql as $$
declare
  eff uuid[];
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
  -- TR-08: the EFFECTIVE evidence set (selected + removals awaiting confirmation), share-locked in id order.
  eff := assessment_effective_sample_ids(new.id, new.sample_ids);
  perform 1 from sampling_events where id = any(eff) order by id for share;
  if exists (select 1 from sampling_events where id = any(eff) and suspension_review_required and suspension_reviewed_at is null)
     or exists (select 1 from field_intake_holds where status in ('held','in_conflict') and (server_id = any(eff) or sampling_event_id = any(eff))) then
    raise exception 'approval refused: a sample has field records received during a suspension that have not been reviewed' using errcode = 'P0001';
  end if;
  if exists (select 1 from sample_qc_checks where sampling_event_id = any(eff) and disposition_by = new.reviewer_id) then
    raise exception 'approval refused: the reviewer recorded a QC disposition for a sample in this assessment' using errcode = 'P0001';
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
