-- MFA failures are counted per account and are NOT reset by a successful password sign-in.
alter table users add column mfa_failures int not null default 0;
create or replace function auth_record_mfa(p_user uuid, p_success boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_success then
    update users set mfa_failures = 0 where id = p_user;
  else
    update users set mfa_failures = mfa_failures + 1,
      locked_until = case when mfa_failures + 1 >= 10 then now() + interval '30 minutes' else locked_until end
    where id = p_user;
  end if;
end $$;
grant execute on function auth_record_mfa(uuid, boolean) to ohea_app;
