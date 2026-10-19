-- Post-H2 demonstration finding R2-P4: a report row inserted directly with the application credentials could carry
-- content and a content hash unrelated to each other or to the approved revision. The database now requires the stored
-- hash to match the content and an issued report to state its revision's approval record hash. It cannot verify that
-- the rest of the content was rendered by the service; issue is audited by the service, and the audit trail and the
-- approval record hash let a reviewer detect a report that does not match its revision.
create or replace function enforce_report_issue() returns trigger language plpgsql as $$
declare
  r record;
  g record;
  lvl text;
  cur text;
begin
  -- Every report row carries the hash of its own content.
  if new.content_hash is distinct from encode(sha256(convert_to(new.content_html, 'UTF8')), 'hex') then
    raise exception 'report refused: content hash does not match the report content' using errcode = 'P0001';
  end if;
  if new.status <> 'issued' then return new; end if;
  select status, assessment_id, client_id, assurance_level_at_approval, method_review_status, benchmark_provenance, calc_code, calc_version, snapshot_hash
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
  -- An issued report must state the approval record hash of the revision it was issued from.
  if r.snapshot_hash is null or position(r.snapshot_hash in new.content_html) = 0 then
    raise exception 'report issue refused: the report does not carry the approval record hash of its revision' using errcode = 'P0001';
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
