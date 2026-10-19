#!/bin/sh
# First start of the database container only: create the non-superuser owner of the ohea database. The platform never
# uses the cluster superuser; migrations, backups, restore verification and operator scripts use this role. It has
# BYPASSRLS (operator scripts and pg_dump must see every organisation) but no superuser rights; as table owner it can
# still alter tables and triggers, so its credentials are treated as privileged (docs/approval-and-issue-controls.md §4).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pw="$OHEA_OWNER_PASSWORD" <<'SQL'
create role ohea_owner login nosuperuser createdb createrole bypassrls password :'pw';
alter database ohea owner to ohea_owner;
alter schema public owner to ohea_owner;
SQL
