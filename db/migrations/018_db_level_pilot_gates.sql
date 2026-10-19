-- Phase H1 hardening (review finding L2): the pilot rules are also enforced in the database, so a defect in the
-- application, or direct use of the application role, cannot approve or issue a pilot conclusion that the service
-- layer would refuse. The approval-time facts are taken from the authoritative tables, not from the caller.

create or replace function enforce_pilot_approval() returns trigger language plpgsql as $$
declare
  lvl text;
  bv record;
  need_minutes int;
begin
  if new.status <> 'approved' or old.status = 'approved' then return new; end if;
  select assurance_level into lvl from tenants where id = new.tenant_id;
  new.assurance_level_at_approval := lvl;
  new.method_review_status := coalesce(
    (select status from current_method_reviews where calc_code = coalesce(new.calc_code, 'twa_8h') and calc_version = new.calc_version),
    'not_reviewed');
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
create trigger trg_enforce_pilot_approval before update on assessment_revisions
  for each row execute function enforce_pilot_approval();

create or replace function enforce_report_issue() returns trigger language plpgsql as $$
declare
  r record;
  lvl text;
  cur text;
begin
  if new.status <> 'issued' then return new; end if;
  select status, assessment_id, assurance_level_at_approval, method_review_status, benchmark_provenance, calc_code, calc_version
    into r from assessment_revisions where id = new.assessment_revision_id;
  if r.status is distinct from 'approved' or r.assessment_id is distinct from new.assessment_id then
    raise exception 'report issue refused: revision is not an approved revision of this assessment' using errcode = 'P0001';
  end if;
  select assurance_level into lvl from tenants where id = new.tenant_id;
  if lvl = 'pilot' then
    cur := coalesce((select status from current_method_reviews where calc_code = coalesce(r.calc_code, 'twa_8h') and calc_version = r.calc_version), 'not_reviewed');
    if r.assurance_level_at_approval is distinct from 'pilot'
       or r.method_review_status not in ('approved', 'approved_with_conditions')
       or r.benchmark_provenance is distinct from 'professional_reference' then
      raise exception 'report issue refused: revision was not approved under the pilot controls' using errcode = 'P0001';
    end if;
    if cur = 'rejected' then
      raise exception 'report issue refused: calculation method has since been rejected' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger trg_enforce_report_issue before insert on reports
  for each row execute function enforce_report_issue();
