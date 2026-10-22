#!/usr/bin/env python3
"""Builds the re-review ZIP for the engine 1.5.0 remediation (TR-06, TR-07; amended as 1.5.1 after the R5 re-check) from the repository at HEAD.

Run from the repository root after the test run:
  python3 scripts/tr/build_rereview_package.py <test-run.json> <browser-offline.log> <browser-online.log> <out-dir>
All files are copied unchanged from the repository except those marked "generated at export" in the README.
"""
import hashlib, json, os, re, shutil, subprocess, sys, zipfile

R = os.getcwd()
test_json, b_off, b_on, out_dir = sys.argv[1:5]
git = lambda *a: subprocess.check_output(['git', *a], cwd=R).decode().strip()
commit = git('rev-parse', 'HEAD'); short = commit[:7]
assert git('status', '--porcelain') == '', 'working tree must be clean'
BASE = 'b5eb070'
name = f'OHEA-rereview-app-1.1.0-engine-1.5.1-{short}'
P = os.path.join(out_dir, name)
shutil.rmtree(P, ignore_errors=True)

FILES = {
  '01-source/src/services/assessments.ts': 'src/services/assessments.ts',
  '01-source/src/services/field.ts': 'src/services/field.ts',
  '01-source/src/services/reports.ts': 'src/services/reports.ts',
  '01-source/src/routes/assessments.ts': 'src/routes/assessments.ts',
  '01-source/db/migrations/020_h2_review_fixes.sql': 'db/migrations/020_h2_review_fixes.sql',
  '01-source/db/migrations/029_sample_removals_finite_values.sql': 'db/migrations/029_sample_removals_finite_values.sql',
  '01-source/db/migrations/030_effective_sample_set.sql': 'db/migrations/030_effective_sample_set.sql',
  '01-source/scripts/tr/tr08-impact.ts': 'scripts/tr/tr08-impact.ts',
  '01-source/scripts/tr/tr08-scenario.ts': 'scripts/tr/tr08-scenario.ts',
  '01-source/scripts/tr/run-tr08-scenario.sh': 'scripts/tr/run-tr08-scenario.sh',
  '01-source/scripts/tr/tr06-tr07-scenario.ts': 'scripts/tr/tr06-tr07-scenario.ts',
  '02-reproductions/tr08.before-b5eb070.json': 'docs/remediation/tr08.before-b5eb070.json',
  '02-reproductions/tr08.after.json': 'docs/remediation/tr08.after.json',
  '02-reproductions/tr08-probe.test.ts.txt': 'docs/remediation/tr08-probe.test.ts.txt',
  '02-reproductions/tr08-scenarios.before-b5eb070.ts.txt': 'docs/remediation/tr08-scenarios.before-b5eb070.ts.txt',
  '02-reproductions/tr06-tr07.after-1.5.1.json': 'docs/remediation/tr06-tr07.after-1.5.1.json',
  '02-reproductions/tr-reproductions.after-1.5.1.json': 'docs/remediation/tr-reproductions.after-1.5.1.json',
  '02-reproductions/validation-examples.after-1.5.1.json': 'docs/remediation/validation-examples.after-1.5.1.json',
  '03-fixtures-and-tests/tr08.test.ts': 'test/tr08.test.ts',
  '03-fixtures-and-tests/tr08-scenarios.ts': 'test/tr08-scenarios.ts',
  '03-fixtures-and-tests/fixtures.ts': 'test/fixtures.ts',
  '03-fixtures-and-tests/worked-examples.fixtures.json': 'test/fixtures/worked-examples.fixtures.json',
  '03-fixtures-and-tests/build_fixtures.py': 'scripts/tr/build_fixtures.py',
  '04-specifications/calculation-and-benchmark-specifications.md': 'docs/calculation-and-benchmark-specifications.md',
  '05-synthetic-report/example-report-tr06-tr07.synthetic.html': 'docs/examples/example-report-tr06-tr07.synthetic.html',
  '05-synthetic-report/example-report.synthetic.html': 'docs/examples/example-report.synthetic.html',
  '06-findings/findings-register.md': 'docs/findings-register.md',
  '06-findings/remediation-summary-tr08.md': 'docs/remediation/remediation-summary-tr08.md',
  '06-findings/remediation-summary-tr06-tr07.md': 'docs/remediation/remediation-summary-tr06-tr07.md',
  '06-findings/tr08-impact.demo.json': 'docs/remediation/tr08-impact.demo.json',
  '06-findings/tr08-impact.scenario.json': 'docs/remediation/tr08-impact.scenario.json',
  '06-findings/tr06-tr07-impact.scenario.json': 'docs/remediation/tr06-tr07-impact.scenario.json',
  '06-findings/tr06-tr07-scenario.summary.json': 'docs/remediation/tr06-tr07-scenario.summary.json',
  '06-findings/test-evidence.md': 'docs/test-evidence.md',
  '06-findings/release-readiness-report.md': 'docs/release-readiness-report.md',
}
for dst, src in FILES.items():
    d = os.path.join(P, dst); os.makedirs(os.path.dirname(d), exist_ok=True); shutil.copy2(os.path.join(R, src), d)

# Generated at export: previous synthetic report (as reviewed), diff, test results, browser logs, identifiers.
os.makedirs(os.path.join(P, '05-synthetic-report'), exist_ok=True)
open(os.path.join(P, f'05-synthetic-report/example-report-tr06-tr07.synthetic.as-reviewed-{BASE}.html'), 'w').write(git('show', f'{BASE}:docs/examples/example-report-tr06-tr07.synthetic.html'))
open(os.path.join(P, f'01-source/changes-since-{BASE}.diff'), 'w').write(git('diff', BASE, 'HEAD', '--', 'src', 'db', 'public/field.js', 'scripts/tr', 'test', 'package.json') + '\n')
tr = json.load(open(test_json))
import datetime
summary = {'command': 'npx vitest run --reporter=json (full suite, disposable test database, application role with RLS)', 'environment': 'development workspace (Linux container); not the hosting environment', 'evidence_class': 'supplied test evidence (not independent verification, not professional approval)',
           'started': datetime.datetime.fromtimestamp(tr['startTime'] / 1000, datetime.timezone.utc).isoformat(), 'commit': commit, 'total': tr['numTotalTests'], 'passed': tr['numPassedTests'], 'failed': tr['numFailedTests'], 'success': tr['success'],
           'suites': [{'file': os.path.relpath(f['name'], R), 'status': f['status'], 'tests': [{'title': ' > '.join(a['ancestorTitles'] + [a['title']]), 'status': a['status']} for a in f['assertionResults']]} for f in tr['testResults']]}
os.makedirs(os.path.join(P, '03-fixtures-and-tests/results'), exist_ok=True)
json.dump(summary, open(os.path.join(P, '03-fixtures-and-tests/results/test-run.json'), 'w'), indent=1, ensure_ascii=False)
for src, dst in [(b_off, 'browser-offline-protection.log'), (b_on, 'browser-online-only.log')]:
    lines = [l for l in open(src).read().splitlines() if l.startswith(('PASS', 'FAIL')) or 'checks passed' in l]
    open(os.path.join(P, '03-fixtures-and-tests/results', dst), 'w').write('\n'.join(lines) + '\n')
eng = open(os.path.join(R, 'src/calc/engine.ts')).read()
ident = {'repository': 'github.com/agilemodular/OHExposure', 'branch': 'main', 'commit': commit, 'commit_date': git('log', '-1', '--format=%cI'), 'reviewed_baseline': git('rev-parse', BASE),
         'engine_version': re.search(r"ENGINE_VERSION = '([^']+)'", eng).group(1),
         'methods': dict(re.findall(r"(twa_8h|stel_15): \{ code: '\w+', version: '([^']+)'", eng)),
         'application_version': json.load(open(os.path.join(R, 'package.json')))['version'],
         'previous': {'application': '1.0.0', 'engine': '1.5.1', 'twa_8h': '1.4.1', 'stel_15': '1.3.1', 'note': 'engine and methods unchanged by TR-08'},
         'migrations_added': ['030_effective_sample_set.sql'],
         'findings': {'TR-08': 'implemented — awaiting technical re-review', 'TR-06/TR-07 engine reproductions': 'verified fixed by the independent technical re-review of b5eb070', 'R5-F1..F8': 'fixed in 1.5.1 — awaiting technical re-review'},
         'evidence_classes': {'supplied_test_evidence': 'development workspace runs in this package', 'independent_technical_verification': 're-review of b5eb070 (TR-06/TR-07 engine reproductions, 113 fixtures, TR-01–TR-05 outputs); not yet TR-08', 'professional_approval': 'none for any version'},
         'classification': 'internal prototype; pilot gates open; no release or pilot readiness declared',
         'molar_volume_L_per_mol': re.search(r'MOLAR_VOLUME_L = ([0-9.]+)', eng).group(1),
         'migrations': sorted(os.listdir(os.path.join(R, 'db/migrations'))),
         'method_review_status': 'not reviewed — no professional approval exists for any version; approvals are per version and do not transfer',
         'build_artifact': 'none (no image built); the git commit identifies the implementation',
         'files': [{'package_path': d, 'repository_path': s, 'last_changed_in_commit': git('log', '-1', '--format=%H', '--', s)} for d, s in FILES.items()]}
os.makedirs(os.path.join(P, '07-identifiers'), exist_ok=True)
json.dump(ident, open(os.path.join(P, '07-identifiers/identifiers.json'), 'w'), indent=1)
shutil.copy2(os.path.join(R, 'scripts/tr/README.package.md'), os.path.join(P, 'README.md'))
with open(os.path.join(P, 'MANIFEST.sha256'), 'w') as m:
    for root, _, fs in sorted(os.walk(P)):
        for f in sorted(fs):
            if f == 'MANIFEST.sha256': continue
            p = os.path.join(root, f)
            m.write(f"{hashlib.sha256(open(p, 'rb').read()).hexdigest()}  ./{os.path.relpath(p, P)}\n")
z = os.path.join(out_dir, name + '.zip')
if os.path.exists(z): os.remove(z)
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _, fs in sorted(os.walk(P)):
        for f in sorted(fs):
            p = os.path.join(root, f); zf.write(p, os.path.relpath(p, out_dir))
print(z)
