// Runs after `vite build` (npm run build): writes dist/version.json with when this build was made, the app's main
// bundle and, when it's known, the commit. Docker builds leave .git out, so this file is how the server (GET
// /api/health, the operator console) can say which build is running.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const html = readFileSync('dist/index.html', 'utf8');
const bundle = /<script[^>]+src="\/?(assets\/[^"]+\.js)"/.exec(html)?.[1] ?? null;
let commit = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA || null;
if (!commit && existsSync('.git')) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    /* not a usable checkout */
  }
}
const stamp = { builtAt: new Date().toISOString(), bundle, commit };
writeFileSync('dist/version.json', `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`Build stamp: ${stamp.builtAt}, ${bundle ?? 'no bundle found'}${commit ? `, ${commit.slice(0, 7)}` : ''}`);
