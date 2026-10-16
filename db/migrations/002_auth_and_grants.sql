-- Login bookkeeping must run before the tenant context exists.
create or replace function auth_record_login(p_user uuid, p_success boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_success then
    update users set failed_logins = 0, locked_until = null where id = p_user;
  else
    update users set failed_logins = failed_logins + 1,
      locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end
    where id = p_user;
  end if;
end $$;

create or replace function auth_touch_session(p_id text) returns void
language sql security definer set search_path = public as
$$ update sessions set last_seen_at = now() where id = p_id $$;

-- Least-privilege application role. It cannot bypass RLS and cannot delete
-- append-only evidence (enforced by triggers as well as grants).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ohea_app') then
    create role ohea_app login password 'ohea_app_dev' nobypassrls;
  end if;
end $$;
grant usage on schema public to ohea_app;
grant select, insert, update on all tables in schema public to ohea_app;
grant delete on sessions, exposure_group_tasks, exposure_group_hazards, plan_targets, plan_instruments,
  lab_submission_samples, import_rows to ohea_app;
grant usage, select on all sequences in schema public to ohea_app;
revoke update on audit_events, custody_events, lab_result_revisions, action_events, reports from ohea_app;
grant execute on all functions in schema public to ohea_app;
