-- 1. Password hashes never leave the database.
-- The application asks for the salt and cost parameters, derives the key itself (scrypt), and the database
-- compares. Unknown emails get deterministic dummy parameters so responses do not reveal whether an account exists.
create or replace function auth_password_params(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  select password_hash into h from users where lower(email) = lower(p_email);
  if h is not null then
    return array_to_string((string_to_array(h, '$'))[1:5], '$');
  end if;
  return 'scrypt$32768$8$1$' || substr(encode(digest(lower(p_email) || ':ohea-dummy-salt', 'sha256'), 'base64'), 1, 24);
end $$;

create or replace function auth_login(p_email text, p_dk text)
returns table (user_id uuid, tenant_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
declare u users%rowtype; ok boolean;
begin
  select * into u from users where lower(email) = lower(p_email);
  if not found then return query select null::uuid, null::uuid, 'invalid'::text; return; end if;
  if u.status <> 'active' then return query select null::uuid, null::uuid, 'invalid'::text; return; end if;
  if u.locked_until is not null and u.locked_until > now() then return query select u.id, u.tenant_id, 'locked'::text; return; end if;
  ok := split_part(u.password_hash, '$', 6) = p_dk;
  perform auth_record_login(u.id, ok);
  return query select case when ok then u.id end, case when ok then u.tenant_id end, case when ok then 'ok' else 'invalid' end::text;
end $$;

revoke execute on function auth_lookup_user(text) from ohea_app, public;
drop function auth_lookup_user(text);
grant execute on function auth_password_params(text), auth_login(text, text) to ohea_app;

-- 2. Link tables inherit client scoping from their parent record (the parent's own RLS applies inside the subquery).
drop policy tenant_only on plan_targets;
create policy via_parent on plan_targets
  using (tenant_id = app_tenant() and exists (select 1 from monitoring_plans p where p.id = plan_id))
  with check (tenant_id = app_tenant() and app_client() is null);
drop policy tenant_only on plan_instruments;
create policy via_parent on plan_instruments
  using (tenant_id = app_tenant() and exists (select 1 from monitoring_plans p where p.id = plan_id))
  with check (tenant_id = app_tenant() and app_client() is null);
drop policy tenant_only on lab_submission_samples;
create policy via_parent on lab_submission_samples
  using (tenant_id = app_tenant() and exists (select 1 from lab_submissions s where s.id = submission_id))
  with check (tenant_id = app_tenant() and app_client() is null);
drop policy tenant_only on exposure_group_tasks;
create policy via_parent on exposure_group_tasks
  using (tenant_id = app_tenant() and exists (select 1 from exposure_groups g where g.id = group_id))
  with check (tenant_id = app_tenant() and app_client() is null);
drop policy tenant_only on exposure_group_hazards;
create policy via_parent on exposure_group_hazards
  using (tenant_id = app_tenant() and exists (select 1 from exposure_groups g where g.id = group_id))
  with check (tenant_id = app_tenant() and app_client() is null);
