#!/usr/bin/env node
// Renders every system email with sample data, in English and Indonesian, to research/email-previews/ (git-ignored):
// the HTML and plain text of each, plus screenshots at 375 and 640 wide in light and dark (prefers-color-scheme), and
// an index.html to look through them all.
//   node --import ./server/register.mjs scripts/email-previews.mjs [--no-shots]
// Screenshots need Playwright's Chromium (this repo has no Playwright: it's found in a nearby node_modules, e.g.
// recorder/, or set PLAYWRIGHT_DIR to a folder that has node_modules/playwright).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'research', 'email-previews');
const PUBLIC = 'https://app.sprint2go.com';
const data = mkdtempSync(join(tmpdir(), 's2g-email-previews-'));
process.env.S2G_DATA = data;
process.env.PUBLIC_URL = PUBLIC;
const shots = !process.argv.includes('--no-shots');

/* ---------- Playwright: this repo's, else one nearby (recorder/ in this checkout or the main one) ---------- */
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {}
  const dirs = [process.env.PLAYWRIGHT_DIR].filter(Boolean);
  for (let d = ROOT; d !== dirname(d); d = dirname(d)) dirs.push(join(d, 'recorder'), d);
  for (const d of dirs) if (existsSync(join(d, 'node_modules', 'playwright'))) return createRequire(join(d, 'package.json'))('playwright');
  return null;
}
async function launch(chromium) {
  try {
    return await chromium.launch();
  } catch (e) {
    // The installed Playwright may want a newer browser than the cache has: use the newest cached headless shell.
    const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
    const shells = existsSync(cache) ? readdirSync(cache).filter((n) => n.startsWith('chromium_headless_shell-')).sort().reverse() : [];
    for (const s of shells)
      for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
        const exe = join(cache, s, sub, 'chrome-headless-shell');
        if (existsSync(exe)) return chromium.launch({ executablePath: exe });
      }
    throw e;
  }
}

const pw = shots ? await loadPlaywright() : null;
if (shots && !pw) console.log('Playwright not found: writing HTML and text only.');
const browser = pw ? await launch(pw.chromium) : null;

/** A sample company logo (a PNG made in the browser), so the previews show a company with one. */
async function sampleLogo() {
  if (!browser) return undefined;
  const p = await browser.newPage({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 2 });
  await p.setContent('<body style="margin:0"><div style="width:64px;height:64px;border-radius:16px;background:#c2410c;color:#fff;font:800 26px/64px system-ui;text-align:center;letter-spacing:-1px">KN</div></body>');
  const png = await p.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
  await p.close();
  return `data:image/png;base64,${png.toString('base64')}`;
}

const { seed, allEmails } = await import('./email-samples.ts');
const logo = await sampleLogo();
seed(logo);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'email', 'brand'), { recursive: true });
copyFileSync(join(ROOT, 'public', 'email', 'logo.png'), join(OUT, 'email', 'logo.png'));
if (logo) writeFileSync(join(OUT, 'email', 'brand', 'w-sample-id.png'), Buffer.from(logo.split(',')[1], 'base64'));

/** The saved HTML loads our images from next to it instead of the live address. */
const local = (html, depth) => html.replaceAll(`${PUBLIC}/email/`, `${'../'.repeat(depth)}email/`).replace(/(email\/brand\/[\w-]+\.png)\?v=[\w]+/g, '$1');

const index = [];
for (const l of ['en', 'id']) {
  const dir = join(OUT, l);
  mkdirSync(dir, { recursive: true });
  for (const m of await allEmails(l)) {
    writeFileSync(join(dir, `${m.id}.html`), local(m.html, 1));
    if (m.text) writeFileSync(join(dir, `${m.id}.txt`), `Subject: ${m.subject}\n\n${m.text}`);
    const pics = [];
    if (browser)
      for (const width of [375, 640])
        for (const scheme of ['light', 'dark']) {
          const page = await browser.newPage({ viewport: { width, height: 300 }, deviceScaleFactor: 2, colorScheme: scheme });
          await page.goto(`file://${join(dir, `${m.id}.html`)}`, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          const file = `${m.id}.${width}.${scheme}.png`;
          await page.screenshot({ path: join(dir, file), fullPage: true });
          await page.close();
          pics.push(file);
        }
    index.push({ l, ...m, pics });
    console.log(`${l} ${m.id}${pics.length ? ` (${pics.length} screenshots)` : ''}`);
  }
}
await browser?.close();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>sprint2go emails</title><style>body{font-family:system-ui;margin:24px;background:#f5f6f8;color:#0b0c10}h2{margin:40px 0 4px}p{margin:0 0 12px;color:#777a88}.row{display:flex;gap:16px;align-items:flex-start;overflow-x:auto}img{border:1px solid #e2e3e9;border-radius:8px;background:#fff}a{color:#2448ff}</style>
<h1>sprint2go emails</h1>${index
    .map((m) => `<h2>${esc(m.name)} <small>(${m.l})</small></h2><p>${esc(m.subject)} · <a href="${m.l}/${m.id}.html">HTML</a>${m.text ? ` · <a href="${m.l}/${m.id}.txt">text</a>` : ''}</p><div class="row">${m.pics.map((p) => `<img src="${m.l}/${p}" width="${p.includes('.375.') ? 280 : 420}" loading="lazy">`).join('')}</div>`)
    .join('\n')}`,
);
rmSync(data, { recursive: true, force: true });
console.log(`Done: ${join(OUT, 'index.html')}`);
