-- Client-scoped sessions must not write tenant settings or reference data either.
alter policy own_tenant_upd on tenants using (id = app_tenant() and app_client() is null) with check (id = app_tenant() and app_client() is null);
do $$
declare t text;
begin
  foreach t in array array['substances','benchmarks','benchmark_versions','sampling_methods','sampling_method_versions'] loop
    execute format('alter policy ref_write on %I using (tenant_id = app_tenant() and app_client() is null) with check (tenant_id = app_tenant() and app_client() is null)', t);
  end loop;
end $$;
