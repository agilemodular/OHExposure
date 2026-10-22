#!/usr/bin/env bash
# TR-08 historical scenario: approvals made with the reviewed code (b5eb070, migrations to 029) in a disposable database,
# then migration 030 with the current code and the read-only TR-08 impact check. Synthetic data; database dropped after.
# Output: docs/remediation/tr08-impact.scenario.json
set -euo pipefail
LEGACY=${1:-b5eb070}
SUPER=${EXAMPLE_SUPER_URL:-postgres://postgres:postgres_dev@localhost:5432/postgres}
DB=ohea_tr08_scenario
ADMIN=${SUPER%/*}/$DB
APP=${ADMIN/postgres:postgres_dev/ohea_app:ohea_app_dev}
ROOT=$(pwd)
WT=$(mktemp -d)/legacy
psql "$SUPER" -qc "drop database if exists $DB with (force)" -c "create database $DB"
git worktree add -q --detach "$WT" "$LEGACY"
trap 'git -C "$ROOT" worktree remove --force "$WT"; psql "$SUPER" -qc "drop database if exists $DB with (force)"' EXIT
ln -s "$ROOT/node_modules" "$WT/node_modules"
cp scripts/tr/tr08-scenario.ts "$WT/scripts/tr/"
echo "── legacy phase: code at $LEGACY, migrations $(ls "$WT/db/migrations" | tail -1)"
(cd "$WT" && DATABASE_ADMIN_URL=$ADMIN DATABASE_URL=$APP npx tsx -e "import('./scripts/migrate.ts').then((m) => m.migrate(process.env.DATABASE_ADMIN_URL))" | tail -1 \
  && DATABASE_ADMIN_URL=$ADMIN DATABASE_URL=$APP npx tsx scripts/tr/tr08-scenario.ts)
echo "── migrate with the current code"
DATABASE_ADMIN_URL=$ADMIN npx tsx -e "import('./scripts/migrate.ts').then((m) => m.migrate(process.env.DATABASE_ADMIN_URL))"
psql "$ADMIN" -Atc "select md5(string_agg(r::text, '' order by r.id)) from assessment_revisions r where status='approved'" > /tmp/tr08-before.md5
echo "── read-only TR-08 impact check"
DATABASE_ADMIN_URL=$ADMIN npx tsx scripts/tr/tr08-impact.ts --json docs/remediation/tr08-impact.scenario.json
psql "$ADMIN" -Atc "select md5(string_agg(r::text, '' order by r.id)) from assessment_revisions r where status='approved'" > /tmp/tr08-after.md5
cmp -s /tmp/tr08-before.md5 /tmp/tr08-after.md5 && echo "approved revisions unchanged by the check (row hash identical)"
