#!/usr/bin/env bash
# OHEA verification run: executes the runbook (docs/verification-runbook.md) and records evidence tied to the source commit.
# Every step records its command, start and end time (UTC), exit code and full log. A failing step is recorded and the run
# continues; the script exits non-zero if any step failed.
#
# Required:
#   OHEA_PG_SUPER_URL       superuser URL of a DISPOSABLE PostgreSQL 16 server, database "postgres",
#                           e.g. postgres://postgres:postgres_dev@localhost:55432/postgres
#   OHEA_CONFIRM_DISPOSABLE=yes   confirms that server holds no data you need. The run DROPS and re-creates these databases:
#                           ohea_verify_test, ohea_verify_app, ohea_example_report, ohea_tr0607_scenario, ohea_tr08_scenario
#                           and creates the cluster-wide role ohea_app (password ohea_app_dev, development default).
# Optional:
#   OHEA_EVIDENCE_DIR       where to write evidence (default: ../ohea-evidence-<commit> next to the checkout)
#   OHEA_BROWSER=1          also run the automated desktop-browser checks (needs Python 3 + Playwright + Chromium)
#   OHEA_PORT               port for the local server used by the browser checks (default 3100)
# Run from the root of a git checkout (the historical scenarios need the repository history).
set -uo pipefail
: "${OHEA_PG_SUPER_URL:?set OHEA_PG_SUPER_URL to the superuser URL of a disposable PostgreSQL 16 server}"
[ "${OHEA_CONFIRM_DISPOSABLE:-}" = "yes" ] || { echo "Refusing to run: set OHEA_CONFIRM_DISPOSABLE=yes to confirm $OHEA_PG_SUPER_URL is disposable" >&2; exit 2; }
ROOT=$(pwd)
git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "Run from the root of a git checkout" >&2; exit 2; }
COMMIT=$(git rev-parse HEAD); SHORT=$(git rev-parse --short HEAD)
EV=${OHEA_EVIDENCE_DIR:-$ROOT/../ohea-evidence-$SHORT}
mkdir -p "$EV/logs" "$EV/outputs"
STEPS="$EV/steps.jsonl"; : > "$STEPS"
SUPER=$OHEA_PG_SUPER_URL
url_db() { node -e 'const u=new URL(process.argv[1]); u.pathname="/"+process.argv[2]; if (process.argv[3]) { u.username=process.argv[3]; u.password=process.argv[4]; } console.log(u.toString())' "$@"; }
ADMIN_TEST=$(url_db "$SUPER" ohea_verify_test); APP_TEST=$(url_db "$SUPER" ohea_verify_test ohea_app "${OHEA_APP_PASSWORD:-ohea_app_dev}")
ADMIN_APP=$(url_db "$SUPER" ohea_verify_app); APP_APP=$(url_db "$SUPER" ohea_verify_app ohea_app "${OHEA_APP_PASSWORD:-ohea_app_dev}")
export EXAMPLE_SUPER_URL=$SUPER
FAILED=0; N=0
step() { # step <name> <command...>
  local name=$1; shift; N=$((N+1)); local log; log=$(printf "%s/logs/%02d-%s.log" "$EV" "$N" "$name")
  local t0; t0=$(date -u +%FT%T.%3NZ)
  echo "── [$N] $name: $*"
  ( eval "$@" ) > "$log" 2>&1; local rc=$?
  local t1; t1=$(date -u +%FT%T.%3NZ)
  node -e 'console.log(JSON.stringify({step:+process.argv[1],name:process.argv[2],command:process.argv[3],started:process.argv[4],finished:process.argv[5],exitCode:+process.argv[6],log:process.argv[7]}))' \
    "$N" "$name" "$*" "$t0" "$t1" "$rc" "$(basename "$log")" >> "$STEPS"
  [ $rc -eq 0 ] || { FAILED=$((FAILED+1)); echo "   FAILED (exit $rc) — see $log"; }
  return 0
}

# 1. Source identity and environment
step source-identity 'git rev-parse HEAD; git log -1 --format="%H %cI %s"; echo "working tree status (empty = clean):"; git status --porcelain'
CLEAN_AT_START=$([ -z "$(git status --porcelain)" ] && echo true || echo false)
step environment 'uname -a; cat /etc/os-release 2>/dev/null | head -3; echo node $(node -v); echo npm $(npm -v); psql --version; psql "$SUPER" -Atc "select version()"; python3 --version 2>&1; python3 -c "import importlib.metadata as m; print(\"playwright\", m.version(\"playwright\"))" 2>&1 || true'

# 2. Locked dependencies
step npm-ci 'npm ci --no-audit --no-fund'
step dependency-versions "npm ls --depth=0 --json > '$EV/outputs/npm-ls.json'; npm ls --depth=0"
step typecheck 'npx tsc --noEmit -p .'

# 3. Disposable databases (explicit names only)
UTF="template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'"   # UTF-8 required (TR-09), whatever the cluster default
create_dbs() { psql "$SUPER" -v ON_ERROR_STOP=1 -c 'drop database if exists ohea_verify_test with (force)' -c 'drop database if exists ohea_verify_app with (force)' \
  -c "create database ohea_verify_test $UTF" -c "create database ohea_verify_app $UTF"; psql "$SUPER" -Atc "select datname, pg_encoding_to_char(encoding) from pg_database where datname like 'ohea_verify_%' order by 1"; }
step create-databases create_dbs

# 4. Migrations (application database; the test database is migrated by the test global setup)
step migrate "DATABASE_ADMIN_URL='$ADMIN_APP' npx tsx scripts/migrate.ts"
step migration-list "psql '$ADMIN_APP' -Atc 'select name, applied_at from schema_migrations order by name' | tee '$EV/outputs/schema_migrations.txt'; echo count \$(psql '$ADMIN_APP' -Atc 'select count(*) from schema_migrations')"

# 5. Full regression suite (per-test outcomes in JSON)
step full-suite "TEST_DATABASE_URL='$APP_TEST' TEST_DATABASE_ADMIN_URL='$ADMIN_TEST' npx vitest run --reporter=default --reporter=json --outputFile='$EV/outputs/full-suite.json'"

# 6. The 20 TR-08 tests separately
step tr08-tests "TEST_DATABASE_URL='$APP_TEST' TEST_DATABASE_ADMIN_URL='$ADMIN_TEST' npx vitest run test/tr08.test.ts --reporter=default --reporter=json --outputFile='$EV/outputs/tr08-tests.json'"
step tr08-concurrency-sequences "TEST_DATABASE_URL='$APP_TEST' TEST_DATABASE_ADMIN_URL='$ADMIN_TEST' OHEA_SEQUENCES_OUT='$EV/outputs/tr08-sequences.json' npx vitest run --config verification/vitest.probe.config.mjs"

# 7. Reproductions and calculation fixtures
step reproductions-tr01-tr05 "npx tsx scripts/tr/reproductions.ts '$EV/outputs/tr-reproductions.json'"
step reproductions-tr06-tr07 "npx tsx scripts/tr/reproductions-tr06-tr07.ts '$EV/outputs/tr06-tr07-reproductions.json'"
step compare-reproductions "node verification/compare-reproductions.mjs docs/remediation/tr-reproductions.after-1.5.1.json '$EV/outputs/tr-reproductions.json' docs/remediation/tr06-tr07.after-1.5.1.json '$EV/outputs/tr06-tr07-reproductions.json'"
step fixtures-rebuild 'python3 scripts/tr/build_fixtures.py && git diff --exit-code --stat -- test/fixtures && echo "fixtures byte-identical to the committed file"'
step fixtures-run "TEST_DATABASE_URL='$APP_TEST' TEST_DATABASE_ADMIN_URL='$ADMIN_TEST' npx vitest run test/worked-examples.test.ts --reporter=default --reporter=json --outputFile='$EV/outputs/fixtures.json'"

# 8. Synthetic reports (scripts write into docs/; outputs are copied to the evidence and the tracked files restored)
step report-demonstration "npx tsx scripts/export-example-report.ts && cp docs/examples/example-report.synthetic.html '$EV/outputs/'"
step report-tr06-tr07-scenario "bash scripts/tr/run-tr06-tr07-scenario.sh 9b87c17 && cp docs/examples/example-report-tr06-tr07.synthetic.html docs/remediation/tr06-tr07-scenario.summary.json docs/remediation/tr06-tr07-impact.scenario.json docs/remediation/tr06-tr07-impact.scenario-after-reassessment.json '$EV/outputs/'"

# 9. Historical impact checks on synthetic data (read-only checks)
step seed-synthetic "DATABASE_ADMIN_URL='$ADMIN_APP' DATABASE_URL='$APP_APP' npx tsx scripts/seed-demo.ts"
step impact-tr08-seeded "DATABASE_ADMIN_URL='$ADMIN_APP' npx tsx scripts/tr/tr08-impact.ts --json '$EV/outputs/tr08-impact.seeded.json'"
step impact-tr06-tr07-seeded "DATABASE_ADMIN_URL='$ADMIN_APP' npx tsx scripts/tr/tr06-tr07-impact.ts --json '$EV/outputs/tr06-tr07-impact.seeded.json'"
step impact-tr08-scenario "bash scripts/tr/run-tr08-scenario.sh b5eb070 && cp docs/remediation/tr08-impact.scenario.json '$EV/outputs/'"

# 10. Optional automated desktop-browser checks (not device testing)
if [ "${OHEA_BROWSER:-0}" = "1" ]; then
  PORT=${OHEA_PORT:-3100}
  # Refuse a port that is already in use, so the checks cannot reach a server this run did not start.
  if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then echo "Port $PORT is already in use; set OHEA_PORT to a free port" >&2; FAILED=$((FAILED+1)); else
  # Own process group, so the server and its tsx/esbuild children are stopped together afterwards.
  setsid bash -c "PORT=$PORT DATABASE_URL='$APP_APP' DATABASE_ADMIN_URL='$ADMIN_APP' STORAGE_DIR='$EV/storage/' exec npx tsx src/server.ts" > "$EV/logs/server.log" 2>&1 < /dev/null & SERVER_PGID=$!
  step wait-for-server "for i in \$(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/login | grep -q 200 && exit 0; sleep 1; done; exit 1"
  step browser-offline-protection "BASE=http://localhost:$PORT DATABASE_ADMIN_URL='$ADMIN_APP' python3 test/browser/field_offline_protection.py"
  step browser-online-only "BASE=http://localhost:$PORT DATABASE_ADMIN_URL='$ADMIN_APP' python3 test/browser/field_online_only.py"
  kill -- -"$SERVER_PGID" 2>/dev/null; sleep 1; kill -9 -- -"$SERVER_PGID" 2>/dev/null
  fi
fi

# Restore tracked files written by the generators; record what the regenerated outputs changed.
git diff --stat > "$EV/outputs/regenerated-tracked-files.diffstat"
git checkout -- docs test/fixtures 2>/dev/null
CLEAN_AT_END=$([ -z "$(git status --porcelain)" ] && echo true || echo false)

# Summary and evidence manifest
node verification/summarise.mjs "$EV" "$COMMIT" "$CLEAN_AT_START" "$CLEAN_AT_END" "$FAILED" > "$EV/SUMMARY.md"
( cd "$EV" && find . -type f ! -name EVIDENCE.sha256 -print0 | sort -z | xargs -0 sha256sum > EVIDENCE.sha256 )
echo; cat "$EV/SUMMARY.md"
[ $FAILED -eq 0 ]
