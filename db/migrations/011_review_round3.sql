-- Fixes from the third independent verification round.

-- H3: bookkeeping functions are no longer callable with an arbitrary user id.
revoke execute on function auth_record_login(uuid, boolean) from ohea_app, public;
revoke execute on function auth_record_mfa(uuid, boolean) from ohea_app, public;

-- H1 + H3: MFA outcome recorded only for the current user; when the account locks, every session that has not
-- passed MFA is revoked, so pre-opened sessions cannot continue guessing.
create or replace function self_record_mfa(p_success boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare locked boolean;
begin
  if app_user() is null then raise exception 'no user context'; end if;
  perform auth_record_mfa(app_user(), p_success);
  select locked_until is not null and locked_until > now() into locked from users where id = app_user();
  if locked then
    update sessions set revoked_at = now() where user_id = app_user() and not mfa_passed and revoked_at is null;
  end if;
  return coalesce(locked, false);
end $$;
create or replace function self_mfa_locked() returns boolean
language sql security definer set search_path = public as
$$ select coalesce((select locked_until is not null and locked_until > now() from users where id = app_user()), false) $$;
-- Secrets are read only through functions bound to the current user.
create or replace function self_totp_secret() returns text
language sql security definer set search_path = public as
$$ select totp_secret from users where id = app_user() $$;
create or replace function self_password_params() returns text
language sql security definer set search_path = public as
$$ select array_to_string((string_to_array(password_hash, '$'))[1:5], '$') from users where id = app_user() $$;
create or replace function self_verify_dk(p_dk text) returns boolean
language sql security definer set search_path = public as
$$ select coalesce((select split_part(password_hash, '$', 6) = p_dk from users where id = app_user()), false) $$;
grant execute on function self_record_mfa(boolean), self_mfa_locked(), self_totp_secret(), self_password_params(), self_verify_dk(text) to ohea_app;

-- L2: the application role cannot read password hashes or TOTP secrets at all.
revoke select on users from ohea_app;
grant select (id, tenant_id, client_id, email, name, role, mfa_enabled, status, failed_logins, locked_until, created_at,
              must_change_password, totp_last_step, mfa_failures) on users to ohea_app;

-- H2: tables the application may DELETE from: reads follow scoping, but every write/delete needs a non-client session.
do $$
declare t text;
begin
  foreach t in array array['plan_targets','plan_instruments','lab_submission_samples','exposure_group_tasks','exposure_group_hazards'] loop
    execute format('drop policy via_parent on %I', t);
  end loop;
end $$;
create policy via_parent_read on plan_targets for select using (tenant_id = app_tenant() and exists (select 1 from monitoring_plans p where p.id = plan_id));
create policy via_parent_read on plan_instruments for select using (tenant_id = app_tenant() and exists (select 1 from monitoring_plans p where p.id = plan_id));
create policy via_parent_read on lab_submission_samples for select using (tenant_id = app_tenant() and exists (select 1 from lab_submissions s where s.id = submission_id));
create policy via_parent_read on exposure_group_tasks for select using (tenant_id = app_tenant() and exists (select 1 from exposure_groups g where g.id = group_id));
create policy via_parent_read on exposure_group_hazards for select using (tenant_id = app_tenant() and exists (select 1 from exposure_groups g where g.id = group_id));
do $$
declare t text;
begin
  foreach t in array array['plan_targets','plan_instruments','lab_submission_samples','exposure_group_tasks','exposure_group_hazards'] loop
    execute format($p$create policy staff_write on %I for all using (tenant_id = app_tenant() and app_client() is null) with check (tenant_id = app_tenant() and app_client() is null)$p$, t);
  end loop;
end $$;
drop policy tenant_opt_client on import_rows;
create policy client_read on import_rows for select using (tenant_id = app_tenant() and (app_client() is null or client_id = app_client()));
create policy staff_write on import_rows for all using (tenant_id = app_tenant() and app_client() is null) with check (tenant_id = app_tenant() and app_client() is null);
-- Sessions: client users may only touch their own sessions.
drop policy sess_tenant on sessions;
create policy sess_scope on sessions
  using (tenant_id = app_tenant() and (app_client() is null or user_id = app_user()))
  with check (tenant_id = app_tenant() and (app_client() is null or user_id = app_user()));

-- M1: links between records must stay within one client (defence in depth for service checks).
create or replace function check_same_client() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'sampling_events' and new.plan_id is not null
     and not exists (select 1 from monitoring_plans p where p.id = new.plan_id and p.client_id = new.client_id) then
    raise exception 'monitoring plan belongs to a different client from the sample' using errcode = 'P0001';
  end if;
  if tg_table_name = 'controls' then
    if not exists (select 1 from sites s where s.id = new.site_id and s.client_id = new.client_id)
       or (new.group_id is not null and not exists (select 1 from exposure_groups g where g.id = new.group_id and g.client_id = new.client_id))
       or (new.process_id is not null and not exists (select 1 from processes p where p.id = new.process_id and p.client_id = new.client_id))
       or (new.hazard_id is not null and not exists (select 1 from hazards h where h.id = new.hazard_id and h.client_id = new.client_id)) then
      raise exception 'control links records from a different client' using errcode = 'P0001';
    end if;
  end if;
  if tg_table_name = 'actions' then
    if (new.group_id is not null and not exists (select 1 from exposure_groups g where g.id = new.group_id and g.client_id = new.client_id))
       or (new.control_id is not null and not exists (select 1 from controls c where c.id = new.control_id and c.client_id = new.client_id))
       or (new.evidence_inspection_id is not null and not exists (select 1 from control_inspections i where i.id = new.evidence_inspection_id and i.client_id = new.client_id))
       or (new.verification_assessment_revision_id is not null and not exists (select 1 from assessment_revisions r where r.id = new.verification_assessment_revision_id and r.client_id = new.client_id)) then
      raise exception 'action links records from a different client' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger trg_sample_same_client before insert or update on sampling_events for each row execute function check_same_client();
create trigger trg_control_same_client before insert or update on controls for each row execute function check_same_client();
create trigger trg_action_same_client before insert or update on actions for each row execute function check_same_client();
