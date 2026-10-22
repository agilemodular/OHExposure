-- Application 1.1.1 (R6 re-check of the TR-08 fix, an AI review agent). Replaces two trigger functions; no row is changed.
--
-- R6-N1: a held field record sent with only its client_uuid (the device never learned the server id, e.g. a lost
-- response) was not matched to its sample by the approval check. Holds now also match the sample with the same
-- client_uuid. (Re-created from the exact migration 030 body; only the hold condition changes.)
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
     or exists (select 1 from field_intake_holds h join sampling_events e on (h.server_id = e.id or h.sampling_event_id = e.id or (e.client_uuid is not null and h.client_uuid = e.client_uuid))
                where e.id = any(eff) and h.status in ('held','in_conflict')) then
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

-- R6-N4: evidence dispositions may be recorded for any sample in the EFFECTIVE evidence set, including a sample whose
-- removal awaits a reviewer's confirmation (it is still evidence and may need a disposition). Re-created from the exact
-- migration 028 body; only the membership checks change.
create or replace function protect_evidence_disposition() returns trigger language plpgsql as $$
declare u record; r record; s record; t record; sub uuid; overlap double precision; longer double precision; eff uuid[];
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
  select status, tenant_id, client_id, sample_ids, assessment_id into r from assessment_revisions where id = new.revision_id for share;
  if r.status is distinct from 'draft' then raise exception 'evidence disposition refused: the revision is not a draft' using errcode = 'P0001'; end if;
  if r.tenant_id is distinct from new.tenant_id or r.client_id is distinct from new.client_id then raise exception 'evidence disposition refused: revision mismatch' using errcode = 'P0001'; end if;
  -- R6-N4: the effective evidence set (selected + removals awaiting confirmation), as for every other safeguard.
  eff := assessment_effective_sample_ids(new.revision_id, r.sample_ids);
  if not (new.sampling_event_id = any(eff)) then raise exception 'evidence disposition refused: the sample is not part of the evidence of this revision' using errcode = 'P0001'; end if;
  if new.related_sampling_event_id is not null and (not (new.related_sampling_event_id = any(eff)) or new.related_sampling_event_id = new.sampling_event_id) then
    raise exception 'evidence disposition refused: the related sample must be another sample of this revision' using errcode = 'P0001';
  end if;

  -- TR-06: a duplicate needs a supported category and matching relationship evidence (invariants that the database can
  -- check reliably). Comparison of the two results is done by the engine at calculation, where the concentrations exist.
  if new.kind = 'duplicate' then
    if new.duplicate_type is null then
      raise exception 'duplicate refused: state the duplicate category (same_event_record or paired_colocated); a different sample offered as adequate remaining coverage needs a technical reviewer''s remaining_coverage_adequate disposition' using errcode = 'P0001';
    end if;
    select * into s from sampling_events where id = new.sampling_event_id;
    select * into t from sampling_events where id = new.related_sampling_event_id;
    select substance_id into sub from assessments where id = r.assessment_id;
    if s.sample_type <> 'personal' or t.sample_type <> 'personal' then raise exception 'duplicate refused: both samples must be personal samples' using errcode = 'P0001'; end if;
    if s.status = 'void' or t.status = 'void' then raise exception 'duplicate refused: a void sample cannot be part of a duplicate relationship' using errcode = 'P0001'; end if;
    if s.worker_id is null or s.worker_id is distinct from t.worker_id then raise exception 'duplicate refused: the related sample is for a different worker' using errcode = 'P0001'; end if;
    if not exists (select 1 from lab_results where sampling_event_id = s.id and substance_id = sub) or not exists (select 1 from lab_results where sampling_event_id = t.id and substance_id = sub) then
      raise exception 'duplicate refused: both samples must have a result for the assessed substance' using errcode = 'P0001';
    end if;
    if s.group_id_at_sampling is null or s.group_id_at_sampling is distinct from t.group_id_at_sampling then raise exception 'duplicate refused: the related sample belongs to a different exposure group (or none is recorded)' using errcode = 'P0001'; end if;
    if ohea_norm_text(s.tasks_performed) is null or ohea_norm_text(t.tasks_performed) is null then raise exception 'duplicate refused: the tasks performed must be recorded for both samples' using errcode = 'P0001'; end if;
    if ohea_norm_text(s.tasks_performed) <> ohea_norm_text(t.tasks_performed) then raise exception 'duplicate refused: the tasks recorded for the two samples differ' using errcode = 'P0001'; end if;
    if s.start_at is null or s.end_at is null or t.start_at is null or t.end_at is null then raise exception 'duplicate refused: the sampling window must be recorded for both samples' using errcode = 'P0001'; end if;
    if coalesce(nullif(btrim(s.shift_ref), ''), ((s.start_at at time zone coalesce(s.timezone, 'UTC'))::date)::text)
       is distinct from coalesce(nullif(btrim(t.shift_ref), ''), ((t.start_at at time zone coalesce(t.timezone, 'UTC'))::date)::text) then
      raise exception 'duplicate refused: the related sample is associated with a different shift' using errcode = 'P0001';
    end if;
    if new.duplicate_type = 'same_event_record' then
      if abs(extract(epoch from s.start_at - t.start_at)) > 60 or abs(extract(epoch from s.end_at - t.end_at)) > 60 then
        raise exception 'duplicate refused: the sampling windows differ by more than 1 min, so the records are not of the same sampling event' using errcode = 'P0001';
      end if;
      if s.instrument_id is null or s.instrument_id is distinct from t.instrument_id then raise exception 'duplicate refused: a duplicate record of one sampling event must name the same instrument' using errcode = 'P0001'; end if;
    else
      if nullif(btrim(s.pair_ref), '') is null or btrim(s.pair_ref) is distinct from btrim(t.pair_ref) then
        raise exception 'duplicate refused: paired samplers need the same pair reference recorded at capture on both samples' using errcode = 'P0001';
      end if;
      overlap := extract(epoch from least(s.end_at, t.end_at) - greatest(s.start_at, t.start_at));
      longer := greatest(extract(epoch from s.end_at - s.start_at), extract(epoch from t.end_at - t.start_at));
      if overlap <= 0 or overlap < 0.9 * longer then raise exception 'duplicate refused: paired samplers must run at the same time (overlap at least 90 %% of the longer window)' using errcode = 'P0001'; end if;
    end if;
  end if;
  return new;
end $$;
