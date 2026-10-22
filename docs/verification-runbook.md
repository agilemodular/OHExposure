# Verification runbook

This runbook is for anyone who needs to verify the OHEA candidate independently, from source. It prepares for independent runtime verification and the appointed occupational hygienist's review. **It does not authorise deployment or pilot use**, and running it is not professional occupational-hygiene approval. OHEA remains an **internal prototype**.

**Supported runtime.**

| Component | Version |
|---|---|
| Node.js | **22.x** (tested with 22.22.0; `package.json` `engines`), with npm from that release |
| PostgreSQL | **16** (tested with 16.x) |
| Git | Any recent version. The historical scenarios need the repository history, so verify from the git bundle or a clone, not from the plain archive |
| Browser checks (optional) | Python 3 with Playwright (`pip install playwright`) and Chromium (`python3 -m playwright install chromium`) |

Linux or macOS with `bash`, `psql`, `sha256sum` (macOS: `shasum -a 256`), `curl` and `python3`.

**Safety.** Every database command below targets a **disposable** PostgreSQL server that you start for this purpose (port 55432 in the examples). The verification run **drops and re-creates** these databases on it:
- `ohea_verify_test`
- `ohea_verify_app`
- `ohea_example_report`
- `ohea_tr0607_scenario`
- `ohea_tr08_scenario`

It also creates the cluster-wide role `ohea_app`. Never point it at a server that holds data you need. The script refuses to run without `OHEA_CONFIRM_DISPOSABLE=yes`.

## 1. Check source identity and checksums

From the handover package root:

```bash
sha256sum -c MANIFEST.sha256                    # every file in the package
cat source/SOURCE_COMMIT                        # the candidate commit
git clone source/ohea.bundle ohea && cd ohea
git checkout --detach "$(cat ../source/SOURCE_COMMIT)"
git status --porcelain                          # must print nothing (clean tree)
git rev-parse HEAD                              # must equal SOURCE_COMMIT
# Optional: the plain archive has the same files as the commit
mkdir ../archive-check && tar -xzf ../source/ohea-source-*.tar.gz -C ../archive-check
diff -r --exclude=.git . ../archive-check/ohea-* && echo "archive matches the checkout"
```

## 2. Install the locked dependencies

```bash
npm ci                                          # exact versions from package-lock.json
npx tsc --noEmit -p .                           # type check
```

## 3. Create a disposable PostgreSQL server and test databases

Use **one** of these.

```bash
# (a) Docker
docker run -d --name ohea-verify-pg -e POSTGRES_PASSWORD=postgres_dev -p 55432:5432 postgres:16
# (b) Debian/Ubuntu cluster tools
sudo pg_createcluster 16 ohea_verify -p 55432 --start
sudo -u postgres psql -p 55432 -c "alter role postgres password 'postgres_dev'"
```

```bash
export OHEA_PG_SUPER_URL=postgres://postgres:postgres_dev@localhost:55432/postgres
psql "$OHEA_PG_SUPER_URL" -c 'drop database if exists ohea_verify_test with (force)' -c 'create database ohea_verify_test'
psql "$OHEA_PG_SUPER_URL" -c 'drop database if exists ohea_verify_app with (force)'  -c 'create database ohea_verify_app'
```

`.env.verification.example` lists every setting the run uses, with placeholders and disposable local defaults.

## 4. Apply migrations (001–031)

```bash
DATABASE_ADMIN_URL=postgres://postgres:postgres_dev@localhost:55432/ohea_verify_app npx tsx scripts/migrate.ts
psql postgres://postgres:postgres_dev@localhost:55432/ohea_verify_app -Atc 'select count(*) from schema_migrations'   # 31
```

Migration 002 creates the role `ohea_app` with the development password `ohea_app_dev`. The server refuses that password in production. The test database is dropped and migrated from scratch by the test global setup.

## 5. Run the complete regression suite

```bash
export TEST_DATABASE_URL=postgres://ohea_app:ohea_app_dev@localhost:55432/ohea_verify_test
export TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres_dev@localhost:55432/ohea_verify_test
npx vitest run                                  # expect: 11 files, 340 tests, all passed
```

The tests run as the least-privilege application role, so row-level security and every trigger are active. **Never** leave `TEST_DATABASE_*` unset: the defaults point at `ohea_test` on port 5432, and the global setup **drops that database's schema**.

## 6. Run the 20 TR-08 tests separately

```bash
npx vitest run test/tr08.test.ts                # expect: 20 tests passed
npx vitest run --config verification/vitest.probe.config.mjs   # concurrency sequences (writes tr08-sequences.json)
```

## 7. Run the TR-01–TR-07 reproductions and the 113 calculation fixtures

```bash
npx tsx scripts/tr/reproductions.ts /tmp/tr01-05.json
npx tsx scripts/tr/reproductions-tr06-tr07.ts /tmp/tr06-07.json
node verification/compare-reproductions.mjs docs/remediation/tr-reproductions.after-1.5.1.json /tmp/tr01-05.json \
  docs/remediation/tr06-tr07.after-1.5.1.json /tmp/tr06-07.json          # expect: IDENTICAL ×2
python3 scripts/tr/build_fixtures.py && git diff --exit-code -- test/fixtures   # independent oracle, byte-identical
npx vitest run test/worked-examples.test.ts     # 113 fixtures (115 tests incl. metadata and group checks)
```

## 8. Generate the synthetic reports

```bash
export EXAMPLE_SUPER_URL=$OHEA_PG_SUPER_URL
npx tsx scripts/export-example-report.ts                 # demonstration report → docs/examples/example-report.synthetic.html
bash scripts/tr/run-tr06-tr07-scenario.sh 9b87c17        # reassessment report (1.4.0 history, then current code)
git checkout -- docs                                     # restore the committed files afterwards
```

## 9. Run the historical impact checks against synthetic data

```bash
DATABASE_ADMIN_URL=postgres://postgres:postgres_dev@localhost:55432/ohea_verify_app \
DATABASE_URL=postgres://ohea_app:ohea_app_dev@localhost:55432/ohea_verify_app npx tsx scripts/seed-demo.ts
DATABASE_ADMIN_URL=postgres://postgres:postgres_dev@localhost:55432/ohea_verify_app npx tsx scripts/tr/tr08-impact.ts
DATABASE_ADMIN_URL=postgres://postgres:postgres_dev@localhost:55432/ohea_verify_app npx tsx scripts/tr/tr06-tr07-impact.ts
bash scripts/tr/run-tr08-scenario.sh b5eb070             # approvals made with b5eb070, then migrations 030–031 and the check
git checkout -- docs
```

These checks are read-only: they run in a read-only transaction, and the scenario compares approved-revision row hashes before and after.

## 10. All steps in one run, with evidence

```bash
set -a; . ./.env.verification; set +a                    # or export the variables above
OHEA_CONFIRM_DISPOSABLE=yes OHEA_BROWSER=1 bash verification/run-verification.sh
```

For each step the run writes the command, UTC start and end times, the exit code and the full log. It also writes:
- the runtime, database and dependency versions;
- the migration list;
- per-test outcomes in Vitest JSON;
- the TR-08 concurrency sequences;
- the regenerated reports and impact-check outputs;
- `SUMMARY.md`;
- `EVIDENCE.sha256`.

The output goes to `../ohea-evidence-<commit>/`, **outside** the source tree, so adding evidence never changes the source commit. The run restores the tracked files that the generators overwrite, and records whether the tree was clean at the start and at the end.

**Browser checks** (`OHEA_BROWSER=1`) drive desktop Chromium headless against a local server with synthetic demonstration data. They are **automated browser checks, not device testing**; field-device testing is a separate, manual script (`docs/field-device-test-script.md`) that has not been performed.

## Who ran it

Record who or what performed the run, and its scope, with the evidence. A development-team run is **supplied evidence**. An independent run must name the person or system that executed it. An AI-assisted run is not professional occupational-hygiene approval.
