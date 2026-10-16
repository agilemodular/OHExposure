-- Self-service functions act only on the current user within the current tenant context.
create or replace function self_record_mfa(p_success boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare locked boolean;
begin
  if app_user() is null or not exists (select 1 from users where id = app_user() and tenant_id = app_tenant()) then
    raise exception 'no user context';
  end if;
  perform auth_record_mfa(app_user(), p_success);
  select locked_until is not null and locked_until > now() into locked from users where id = app_user();
  if locked then
    update sessions set revoked_at = now() where user_id = app_user() and not mfa_passed and revoked_at is null;
  end if;
  return coalesce(locked, false);
end $$;
create or replace function self_mfa_locked() returns boolean
language sql security definer set search_path = public as
$$ select coalesce((select locked_until is not null and locked_until > now() from users where id = app_user() and tenant_id = app_tenant()), false) $$;
create or replace function self_totp_secret() returns text
language sql security definer set search_path = public as
$$ select totp_secret from users where id = app_user() and tenant_id = app_tenant() $$;
create or replace function self_password_params() returns text
language sql security definer set search_path = public as
$$ select array_to_string((string_to_array(password_hash, '$'))[1:5], '$') from users where id = app_user() and tenant_id = app_tenant() $$;
create or replace function self_verify_dk(p_dk text) returns boolean
language sql security definer set search_path = public as
$$ select coalesce((select split_part(password_hash, '$', 6) = p_dk from users where id = app_user() and tenant_id = app_tenant()), false) $$;
create or replace function self_set_password(p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update users set password_hash = p_hash, must_change_password = false where id = app_user() and tenant_id = app_tenant();
  if not found then raise exception 'no user context'; end if;
end $$;
create or replace function self_set_totp_secret(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from users where id = app_user() and tenant_id = app_tenant()) then raise exception 'no user context'; end if;
  update users set totp_secret = p_secret where id = app_user() and totp_secret is null;
end $$;
create or replace function self_accept_totp_step(p_step bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update users set totp_last_step = p_step, mfa_enabled = true
   where id = app_user() and tenant_id = app_tenant() and (totp_last_step is null or totp_last_step < p_step)
  returning true into ok;
  return coalesce(ok, false);
end $$;
