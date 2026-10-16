-- Fixes from independent security/safety review.

-- C3: client-scoped sessions are read-only at the database level, whatever the application does.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname in ('tenant_client','tenant_opt_client','tenant_only') loop
    execute format('alter policy %I on %I with check (tenant_id = app_tenant() and app_client() is null)', r.policyname, r.tablename);
  end loop;
end $$;

-- H1: users change their own credentials only through narrow SECURITY DEFINER functions bound to app.user_id.
create or replace function self_set_password(p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_user() is null then raise exception 'no user context'; end if;
  update users set password_hash = p_hash, must_change_password = false where id = app_user();
end $$;
create or replace function self_set_totp_secret(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_user() is null then raise exception 'no user context'; end if;
  update users set totp_secret = p_secret where id = app_user() and totp_secret is null;
end $$;
-- H3: record the last accepted TOTP time-step to block replay; enable MFA on first success.
alter table users add column totp_last_step bigint;
create or replace function self_accept_totp_step(p_step bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if app_user() is null then raise exception 'no user context'; end if;
  update users set totp_last_step = p_step, mfa_enabled = true
   where id = app_user() and (totp_last_step is null or totp_last_step < p_step)
  returning true into ok;
  return coalesce(ok, false);
end $$;
alter table sessions add column mfa_failures int not null default 0;
grant execute on function self_set_password(text), self_set_totp_secret(text), self_accept_totp_step(bigint) to ohea_app;

-- H2: import batches belong to exactly one client; rows inherit it.
alter table import_rows add column client_id uuid references clients(id);
drop policy tenant_only on import_rows;
create policy tenant_opt_client on import_rows
  using (tenant_id = app_tenant() and (app_client() is null or client_id = app_client()))
  with check (tenant_id = app_tenant() and app_client() is null);

-- C1: a sample's group at sampling must belong to the same client (defence in depth).
create or replace function check_sample_group_client() returns trigger language plpgsql as $$
begin
  if new.group_id_at_sampling is not null and not exists
     (select 1 from exposure_groups g where g.id = new.group_id_at_sampling and g.client_id = new.client_id) then
    raise exception 'exposure group belongs to a different client from the sample' using errcode = 'P0001';
  end if;
  if new.worker_id is not null and not exists
     (select 1 from workers w where w.id = new.worker_id and w.client_id = new.client_id) then
    raise exception 'worker belongs to a different client from the sample' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_sample_group_client before insert or update on sampling_events
  for each row execute function check_sample_group_client();

-- L2: benchmark versions: values are fixed once entered; verification only moves forward.
create or replace function protect_benchmark_version() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['verification_status','verified_by','verified_at']) <> (to_jsonb(old) - array['verification_status','verified_by','verified_at']) then
    raise exception 'benchmark version values are immutable; enter a new version' using errcode = 'P0001';
  end if;
  if not ((old.verification_status = 'unverified' and new.verification_status in ('verified','withdrawn'))
       or (old.verification_status = 'verified' and new.verification_status = 'withdrawn')
       or old.verification_status = new.verification_status) then
    raise exception 'invalid benchmark verification transition % -> %', old.verification_status, new.verification_status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_protect_benchmark before update on benchmark_versions for each row execute function protect_benchmark_version();
create trigger trg_no_delete_bv before delete on benchmark_versions for each row execute function forbid_delete();
