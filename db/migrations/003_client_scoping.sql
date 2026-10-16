-- Client-scoped users must not see other clients or their users.
drop policy tenant_only on clients;
create policy tenant_client_self on clients
  using (tenant_id = app_tenant() and (app_client() is null or id = app_client()))
  with check (tenant_id = app_tenant() and app_client() is null);
drop policy tenant_only on users;
create policy tenant_users on users
  using (tenant_id = app_tenant() and (app_client() is null or client_id is null or client_id = app_client()))
  with check (tenant_id = app_tenant() and app_client() is null);
-- Laboratories / calibrations are tenant-level reference; client users may read them but not write.
drop policy tenant_only on laboratories;
create policy lab_read on laboratories for select using (tenant_id = app_tenant());
create policy lab_write on laboratories for all using (tenant_id = app_tenant() and app_client() is null) with check (tenant_id = app_tenant() and app_client() is null);
