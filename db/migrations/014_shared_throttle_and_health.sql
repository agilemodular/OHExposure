-- Login throttle shared by every application instance. Keys are hashed IPs; rows expire after the window.
create table login_throttle (
  key text primary key,
  hits int not null,
  window_start timestamptz not null
);
alter table login_throttle enable row level security;
alter table login_throttle force row level security;
-- No policies: reachable only through the function below.
create or replace function auth_throttle_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into login_throttle as t (key, hits, window_start) values (p_key, 1, now())
  on conflict (key) do update set
    hits = case when t.window_start < now() - make_interval(secs => p_window_seconds) then 1 else t.hits + 1 end,
    window_start = case when t.window_start < now() - make_interval(secs => p_window_seconds) then now() else t.window_start end
  returning hits into n;
  delete from login_throttle where window_start < now() - make_interval(secs => p_window_seconds * 4) and random() < 0.01;
  return n <= p_limit;
end $$;
grant execute on function auth_throttle_hit(text, int, int) to ohea_app;

-- Tenant-scoped operational health counts for administrators.
create or replace function tenant_security_health() returns table (failed_logins_now int, locked_accounts int, mfa_not_enrolled int)
language sql security definer set search_path = public as $$
  select coalesce(sum(failed_logins), 0)::int,
         count(*) filter (where locked_until > now())::int,
         count(*) filter (where not mfa_enabled and status = 'active')::int
  from users where tenant_id = app_tenant() and app_client() is null
$$;
grant execute on function tenant_security_health() to ohea_app;
