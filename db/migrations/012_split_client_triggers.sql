-- plpgsql resolves NEW.<field> per table at run time, so each table gets its own check function.
drop trigger trg_sample_same_client on sampling_events;
drop trigger trg_control_same_client on controls;
drop trigger trg_action_same_client on actions;
drop function check_same_client();

create or replace function check_sample_plan_client() returns trigger language plpgsql as $$
begin
  if new.plan_id is not null and not exists (select 1 from monitoring_plans p where p.id = new.plan_id and p.client_id = new.client_id) then
    raise exception 'monitoring plan belongs to a different client from the sample' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function check_control_client() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from sites s where s.id = new.site_id and s.client_id = new.client_id)
     or (new.group_id is not null and not exists (select 1 from exposure_groups g where g.id = new.group_id and g.client_id = new.client_id))
     or (new.process_id is not null and not exists (select 1 from processes p where p.id = new.process_id and p.client_id = new.client_id))
     or (new.hazard_id is not null and not exists (select 1 from hazards h where h.id = new.hazard_id and h.client_id = new.client_id)) then
    raise exception 'control links records from a different client' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function check_action_client() returns trigger language plpgsql as $$
begin
  if (new.group_id is not null and not exists (select 1 from exposure_groups g where g.id = new.group_id and g.client_id = new.client_id))
     or (new.control_id is not null and not exists (select 1 from controls c where c.id = new.control_id and c.client_id = new.client_id))
     or (new.evidence_inspection_id is not null and not exists (select 1 from control_inspections i where i.id = new.evidence_inspection_id and i.client_id = new.client_id))
     or (new.verification_assessment_revision_id is not null and not exists (select 1 from assessment_revisions r where r.id = new.verification_assessment_revision_id and r.client_id = new.client_id)) then
    raise exception 'action links records from a different client' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_sample_plan_client before insert or update on sampling_events for each row execute function check_sample_plan_client();
create trigger trg_control_client before insert or update on controls for each row execute function check_control_client();
create trigger trg_action_client before insert or update on actions for each row execute function check_action_client();
