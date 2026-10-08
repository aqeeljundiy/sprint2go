// Production must never pretend. Code that only exists for the demo carries a "DEMO ONLY" comment, and has to sit
// behind a guard that is false on a real server: demoOk, !real, caps.demo or !server.on. This fails when one doesn't:
//  - the guard is within a few lines after the comment, or
//  - the comment is on a function (const fakeIt = ..., function fakeIt) and every place that calls it is guarded.
//   node scripts/check-demo-guards.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const GUARD = /\bdemoOk\b|!\s*real\b|\bcaps\.demo\b|!\s*server\.on\b/;
const WITHIN = 6; // lines after the comment
const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
};
walk(join(ROOT, 'src'));

const problems = [];
let found = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/DEMO ONLY/.test(line)) return;
    found++;
    const after = lines.slice(i + 1, i + 1 + WITHIN);
    if (after.some((l) => GUARD.test(l))) return;
    // A demo-only function (the first code line after the comment declares it): check every call.
    const code = after.find((l) => l.trim() && !/^\s*(\*|\/\/|\/\*)/.test(l)) ?? '';
    const decl = /^\s*(?:export\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/.exec(code);
    if (decl) {
      const name = decl[1];
      const calls = lines.map((l, n) => ({ l, n })).filter(({ l, n }) => new RegExp(`\\b${name}\\s*\\(`).test(l) && !new RegExp(`(?:const|let|function)\\s+${name}\\b`).test(l) && n !== i);
      const unguarded = calls.filter(({ n }) => !lines.slice(Math.max(0, n - 2), n + 1).some((l) => GUARD.test(l)));
      if (calls.length && !unguarded.length) return;
      problems.push(`${relative(ROOT, file)}:${i + 1}  DEMO ONLY function ${name}() ${calls.length ? `is called without a guard at line ${unguarded.map(({ n }) => n + 1).join(', ')}` : 'is never called behind a guard'}`);
      return;
    }
    problems.push(`${relative(ROOT, file)}:${i + 1}  DEMO ONLY code without a guard (demoOk, !real, caps.demo or !server.on) in the next ${WITHIN} lines`);
  });
}

if (problems.length) {
  console.error(`Demo-only code that could run on a real server:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`${found} DEMO ONLY spots, all guarded.`);
