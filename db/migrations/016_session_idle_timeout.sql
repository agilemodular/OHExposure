-- Phase H1 operational hardening: sessions end after a period without activity, in addition to the absolute expiry.
create or replace function auth_session_active(p_id text, p_idle_minutes int)
returns table (session_id text, user_id uuid, tenant_id uuid, csrf_token text, mfa_passed boolean, expires_at timestamptz)
language sql security definer set search_path = public as
$$ select s.id, s.user_id, s.tenant_id, s.csrf_token, s.mfa_passed, s.expires_at
   from sessions s join users u on u.id = s.user_id
   where s.id = p_id and s.revoked_at is null and s.expires_at > now() and u.status = 'active'
     and s.last_seen_at > now() - make_interval(mins => greatest(p_idle_minutes, 1)) $$;
revoke all on function auth_session_active(text, int) from public;
grant execute on function auth_session_active(text, int) to ohea_app;
