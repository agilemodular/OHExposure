#!/usr/bin/env python3
"""Builds the re-review ZIP for the engine 1.4.0 remediation from the repository at HEAD.

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
name = f'OHEA-rereview-engine-1.4.0-{short}'
P = os.path.join(out_dir, name)
shutil.rmtree(P, ignore_errors=True)

FILES = {
  '01-source/src/calc/engine.ts': 'src/calc/engine.ts',
  '01-source/src/services/assessments.ts': 'src/services/assessments.ts',
  '01-source/src/services/field.ts': 'src/services/field.ts',
  '01-source/src/services/lab.ts': 'src/services/lab.ts',
  '01-source/src/services/instruments.ts': 'src/services/instruments.ts',
  '01-source/src/services/register.ts': 'src/services/register.ts',
  '01-source/src/services/narrative.ts': 'src/services/narrative.ts',
  '01-source/src/services/usage.ts': 'src/services/usage.ts',
  '01-source/src/services/reports.ts': 'src/services/reports.ts',
  '01-source/src/ui/html.ts': 'src/ui/html.ts',
  '01-source/db/migrations/026_engine_1_4_remediation.sql': 'db/migrations/026_engine_1_4_remediation.sql',
  '01-source/scripts/tr/reproductions.ts': 'scripts/tr/reproductions.ts',
  '01-source/scripts/tr/engine-change-impact.ts': 'scripts/tr/engine-change-impact.ts',
  '01-source/scripts/generate-validation-examples.ts': 'scripts/generate-validation-examples.ts',
  '01-source/scripts/export-example-report.ts': 'scripts/export-example-report.ts',
  '01-source/scripts/seed-demo.ts': 'scripts/seed-demo.ts',
  '02-reproductions/tr-reproductions.before-1.3.1.json': 'docs/remediation/tr-reproductions.before-1.3.1.json',
  '02-reproductions/tr-reproductions.after-1.4.0.json': 'docs/remediation/tr-reproductions.after-1.4.0.json',
  '02-reproductions/validation-examples.before-1.3.1.json': 'docs/remediation/validation-examples.before-1.3.1.json',
  '02-reproductions/validation-examples.after-1.4.0.json': 'docs/remediation/validation-examples.after-1.4.0.json',
  '03-fixtures-and-tests/worked-examples.fixtures.json': 'test/fixtures/worked-examples.fixtures.json',
  '03-fixtures-and-tests/build_fixtures.py': 'scripts/tr/build_fixtures.py',
  '03-fixtures-and-tests/worked-examples.test.ts': 'test/worked-examples.test.ts',
  '03-fixtures-and-tests/tr-services.test.ts': 'test/tr-services.test.ts',
  '03-fixtures-and-tests/calc.test.ts': 'test/calc.test.ts',
  '03-fixtures-and-tests/review-regressions.test.ts': 'test/review-regressions.test.ts',
  '04-specifications/calculation-and-benchmark-specifications.md': 'docs/calculation-and-benchmark-specifications.md',
  '04-specifications/hygienist-review-pack.md': 'docs/hygienist-review-pack.md',
  '04-specifications/professional-review-handover.md': 'docs/professional-review-handover.md',
  '05-synthetic-report/example-report.synthetic.html': 'docs/examples/example-report.synthetic.html',
  '05-synthetic-report/demonstration-walkthrough.synthetic.md': 'docs/examples/demonstration-walkthrough.synthetic.md',
  '06-findings/findings-register.md': 'docs/findings-register.md',
  '06-findings/remediation-summary.md': 'docs/remediation/remediation-summary.md',
  '06-findings/engine-change-impact.demo.json': 'docs/remediation/engine-change-impact.demo.json',
  '06-findings/test-evidence.md': 'docs/test-evidence.md',
}
for dst, src in FILES.items():
    d = os.path.join(P, dst); os.makedirs(os.path.dirname(d), exist_ok=True); shutil.copy2(os.path.join(R, src), d)

# Generated at export: previous synthetic report (as reviewed), diff, test results, browser logs, identifiers.
os.makedirs(os.path.join(P, '05-synthetic-report'), exist_ok=True)
open(os.path.join(P, '05-synthetic-report/example-report.synthetic.before-ceec79f.html'), 'w').write(git('show', 'ceec79f:docs/examples/example-report.synthetic.html'))
open(os.path.join(P, '01-source/changes-since-ceec79f.diff'), 'w').write(git('diff', 'ceec79f', 'HEAD', '--', 'src', 'db', 'public/field.js', 'scripts/seed-demo.ts') + '\n')
tr = json.load(open(test_json))
summary = {'command': 'npx vitest run --reporter=json (full suite, disposable test database)', 'commit': commit, 'total': tr['numTotalTests'], 'passed': tr['numPassedTests'], 'failed': tr['numFailedTests'], 'success': tr['success'],
           'suites': [{'file': os.path.relpath(f['name'], R), 'status': f['status'], 'tests': [{'title': ' > '.join(a['ancestorTitles'] + [a['title']]), 'status': a['status']} for a in f['assertionResults']]} for f in tr['testResults']]}
os.makedirs(os.path.join(P, '03-fixtures-and-tests/results'), exist_ok=True)
json.dump(summary, open(os.path.join(P, '03-fixtures-and-tests/results/test-run.json'), 'w'), indent=1, ensure_ascii=False)
for src, dst in [(b_off, 'browser-offline-protection.log'), (b_on, 'browser-online-only.log')]:
    lines = [l for l in open(src).read().splitlines() if l.startswith(('PASS', 'FAIL')) or 'checks passed' in l]
    open(os.path.join(P, '03-fixtures-and-tests/results', dst), 'w').write('\n'.join(lines) + '\n')
eng = open(os.path.join(R, 'src/calc/engine.ts')).read()
ident = {'repository': 'github.com/agilemodular/OHExposure', 'branch': 'main', 'commit': commit, 'commit_date': git('log', '-1', '--format=%cI'), 'reviewed_baseline': 'ceec79fd5462cd12ad7b4c1bf3695b5bc0f897c7',
         'engine_version': re.search(r"ENGINE_VERSION = '([^']+)'", eng).group(1),
         'methods': dict(re.findall(r"(twa_8h|stel_15): \{ code: '\w+', version: '([^']+)'", eng)),
         'previous': {'engine': '1.3.1', 'twa_8h': '1.2.1', 'stel_15': '1.1.1'},
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
