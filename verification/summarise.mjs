// Writes SUMMARY.md for a verification run from steps.jsonl and the JSON test reports.
import { existsSync, readFileSync } from 'node:fs';
const [ev, commit, cleanStart, cleanEnd, failed] = process.argv.slice(2);
const steps = readFileSync(`${ev}/steps.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const vit = (f) => { if (!existsSync(`${ev}/outputs/${f}`)) return null; const j = JSON.parse(readFileSync(`${ev}/outputs/${f}`, 'utf8'));
  const all = j.testResults.flatMap((t) => t.assertionResults); const c = (s) => all.filter((a) => a.status === s).length;
  return { total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests, skipped: c('skipped') + c('pending') + c('todo'), files: j.testResults.length }; };
const out = [];
out.push(`# Verification run — ${commit.slice(0, 7)}`, '');
out.push(`- Source commit: \`${commit}\``, `- Working tree clean at start: **${cleanStart}**; restored clean at end: **${cleanEnd}**`, `- Steps: ${steps.length}; failed: **${failed}**`, '');
out.push('| # | Step | Started (UTC) | Finished (UTC) | Exit | Log |', '|---|---|---|---|---|---|');
for (const s of steps) out.push(`| ${s.step} | ${s.name} | ${s.started} | ${s.finished} | ${s.exitCode} | logs/${s.log} |`);
out.push('', '| Test run | Total | Passed | Failed | Skipped | Files |', '|---|---|---|---|---|---|');
for (const [n, f] of [['Full regression suite', 'full-suite.json'], ['TR-08 tests', 'tr08-tests.json'], ['Calculation fixtures', 'fixtures.json']]) {
  const r = vit(f); out.push(r ? `| ${n} | ${r.total} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.files} |` : `| ${n} | not run | | | | |`);
}
out.push('', 'Per-test outcomes: `outputs/*.json` (Vitest JSON). Concurrency sequences: `outputs/tr08-sequences.json`. Checksums: `EVIDENCE.sha256`.');
out.push('', 'This is a run by the development team (supplied evidence), not independent verification and not professional approval.');
console.log(out.join('\n'));
