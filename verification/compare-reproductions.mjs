// Compares freshly generated reproduction outputs with the committed reference outputs (pairs of files), ignoring nothing:
// any difference is printed and makes the command fail.
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2); let bad = 0;
for (let i = 0; i < args.length; i += 2) {
  const [a, b] = [args[i], args[i + 1]];
  const same = JSON.stringify(JSON.parse(readFileSync(a, 'utf8'))) === JSON.stringify(JSON.parse(readFileSync(b, 'utf8')));
  console.log(`${same ? 'IDENTICAL' : 'DIFFERENT'}  ${a}  vs  ${b}`);
  if (!same) bad++;
}
process.exit(bad ? 1 : 0);
