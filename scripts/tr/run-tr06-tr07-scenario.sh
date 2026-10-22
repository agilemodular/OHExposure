#!/usr/bin/env bash
# Runs the synthetic TR-06 / TR-07 historical scenario end to end in a disposable database (dropped afterwards):
#   1. migrate to 027 and run the legacy phase with the code of the reviewed commit (engine 1.4.0, git worktree);
#   2. migrate to 028 with the current code; run the read-only impact scan;
#   3. run the current phase (new revision, recalculation, draft report); run the impact scan again.
# Outputs (docs/remediation/ and docs/examples/):
#   tr06-tr07-impact.scenario.json            impact scan after migration 028, before any reassessment
#   tr06-tr07-scenario.summary.json           approved revision / issued report unchanged; new revision; refused attempts; audit
#   example-report-tr06-tr07.synthetic.html   draft report of the new revision
# Usage (repository root, clean tree not required):  bash scripts/tr/run-tr06-tr07-scenario.sh [legacy-commit]
set -euo pipefail
LEGACY=${1:-9b87c17}
SUPER=${EXAMPLE_SUPER_URL:-postgres://postgres:postgres_dev@localhost:5432/postgres}
DB=ohea_tr0607_scenario
ADMIN=${SUPER%/*}/$DB
APP=$(node -e 'const u=new URL(process.argv[1]); u.username="ohea_app"; u.password=process.env.OHEA_APP_PASSWORD||"ohea_app_dev"; console.log(u.toString())' "$ADMIN")
ROOT=$(pwd)
WT=$(mktemp -d)/legacy
psql "$SUPER" -qc "drop database if exists $DB with (force)" -c "create database $DB template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'"
git worktree add -q --detach "$WT" "$LEGACY"
trap 'git -C "$ROOT" worktree remove --force "$WT"; psql "$SUPER" -qc "drop database if exists $DB with (force)"' EXIT
ln -s "$ROOT/node_modules" "$WT/node_modules"
cp scripts/tr/tr06-tr07-scenario.ts "$WT/scripts/tr/"
echo "── legacy phase: code at $LEGACY (engine $(grep -o "ENGINE_VERSION = '[^']*'" "$WT/src/calc/engine.ts")), migrations $(ls "$WT/db/migrations" | tail -1)"
(cd "$WT" && DATABASE_ADMIN_URL=$ADMIN DATABASE_URL=$APP npx tsx -e "import('./scripts/migrate.ts').then((m) => m.migrate(process.env.DATABASE_ADMIN_URL))" \
  && DATABASE_ADMIN_URL=$ADMIN DATABASE_URL=$APP npx tsx scripts/tr/tr06-tr07-scenario.ts legacy)
echo "── migrate with the current code"
DATABASE_ADMIN_URL=$ADMIN npx tsx -e "import('./scripts/migrate.ts').then((m) => m.migrate(process.env.DATABASE_ADMIN_URL))"
psql "$ADMIN" -Atc "select conname || ' validated=' || convalidated from pg_constraint where conname in ('evidence_disposition_duplicate_type','lab_result_value_meaning_valid') order by 1"
echo "── read-only impact scan"
DATABASE_ADMIN_URL=$ADMIN npx tsx scripts/tr/tr06-tr07-impact.ts --json docs/remediation/tr06-tr07-impact.scenario.json
echo "── current phase: new revision with a reason, recalculation, draft report"
DATABASE_ADMIN_URL=$ADMIN DATABASE_URL=$APP npx tsx scripts/tr/tr06-tr07-scenario.ts current docs/examples/example-report-tr06-tr07.synthetic.html docs/remediation/tr06-tr07-scenario.summary.json
echo "── impact scan after reassessment"
DATABASE_ADMIN_URL=$ADMIN npx tsx scripts/tr/tr06-tr07-impact.ts --json docs/remediation/tr06-tr07-impact.scenario-after-reassessment.json
