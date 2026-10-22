-- Engine 1.5.0 (twa_8h 1.4.0, stel_15 1.3.0): TR-06 and TR-07 from the independent technical review of package 9b87c17.
-- Adds columns and constraints only; no existing row is changed. Constraints that existing rows might violate are added
-- NOT VALID (enforced for every new row) and validated only if no existing row violates them; violating historical rows
-- are listed by scripts/tr/tr06-tr07-impact.ts and corrected through the revision / amendment workflow, never in place.

-- ── TR-06: duplicate relationship evidence ──────────────────────────────────────────────────────────────────────────
-- Pair reference recorded at capture for paired / co-located samplers (the same reference on both samples).
alter table sampling_events add column pair_ref text check (pair_ref is null or length(trim(pair_ref)) between 1 and 60);

-- Supported duplicate categories. A different sample offered as evidence of adequate remaining coverage is not a
-- duplicate: that is 'remaining_coverage_adequate', reserved to a technical reviewer (migration 027).
alter table assessment_evidence_dispositions add column duplicate_type text
  check (duplicate_type is null or duplicate_type in ('same_event_record','paired_colocated'));
alter table assessment_evidence_dispositions add constraint evidence_disposition_duplicate_type
  check ((kind = 'duplicate') = (duplicate_type is not null)) not valid;
do $$ begin
  alter table assessment_evidence_dispositions validate constraint evidence_disposition_duplicate_type;
exception when check_violation then
  raise notice 'evidence_disposition_duplicate_type left NOT VALID: historical duplicate dispositions without a category exist (see the TR-06/TR-07 impact scan)';
end $$;

create or replace function ohea_norm_text(x text) returns text language sql immutable as $$
  select nullif(lower(regexp_replace(btrim(normalize(coalesce(x, ''), NFKC)), '\s+', ' ', 'g')), '')
$$;

create or replace function protect_evidence_disposition() returns trigger language plpgsql as $$
declare u record; r record; s record; t record; sub uuid; overlap double precision; longer double precision;
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
  if not (new.sampling_event_id = any(r.sample_ids)) then raise exception 'evidence disposition refused: the sample is not part of this revision' using errcode = 'P0001'; end if;
  if new.related_sampling_event_id is not null and (not (new.related_sampling_event_id = any(r.sample_ids)) or new.related_sampling_event_id = new.sampling_event_id) then
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

-- ── TR-07: meaning of the laboratory value field; contradictory detected-below-LOQ inputs ────────────────────────────
alter table lab_result_revisions add column value_meaning text
  check (value_meaning is null or value_meaning in ('measured','estimate','reporting_threshold','lower_limit'));
alter table lab_result_revisions add constraint lab_result_value_meaning_valid check (
  (value_meaning is null
    or (qualifier = '=' and value_meaning = 'measured')
    or (qualifier = 'estimated' and value_meaning = 'estimate')
    or (qualifier in ('<LOD','<LOQ') and value_meaning = 'reporting_threshold')
    or (qualifier = '>' and value_meaning = 'lower_limit')
    or (qualifier = 'detected_below_loq' and value_meaning in ('estimate','reporting_threshold')))
  and (qualifier <> 'detected_below_loq' or value is null
    or (coalesce(value_meaning, 'estimate') = 'estimate' and value >= lod and value <= loq)
    or (value_meaning = 'reporting_threshold' and value = loq))
) not valid;
do $$ begin
  alter table lab_result_revisions validate constraint lab_result_value_meaning_valid;
exception when check_violation then
  raise notice 'lab_result_value_meaning_valid left NOT VALID: historical contradictory results exist (see the TR-06/TR-07 impact scan)';
end $$;
