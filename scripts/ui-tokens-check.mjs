// The phone layer keeps to the sprint2go system (src/tokens.css, docs/mobile-kit.md "The system"). Fails on a
// font-size, font, font-weight, padding, margin, gap, border-radius, height or min-height value in the phone layer
// that is not a token or an allowed value. The phone layer is every rule in src/mobile/*.css (except inside a
// min-width or tablet media query) and every rule inside an @media (max-width: 767px | 599px | 359px) block elsewhere
// in src/. A line that has to break the rule says why in a comment on that line: /* system: <reason> */.
//   node scripts/ui-tokens-check.mjs           check, exit 1 on any miss
//   node scripts/ui-tokens-check.mjs --list    also print the exceptions
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const SPACE = [0, 4, 8, 12, 16, 24, 32, 48];
const SPACE_NAMED = [56, 88]; // the tab bar's room, the create button's room at a list's end
const WEIGHTS = ['400', '600', '700', 'normal', 'inherit'];
// Sizes a box may have: spacing, icons (16 20 24), pictures (24 32 40 56), rows (44 48 64 80), segmented (36), the top
// bar (52) and the tab bar (56), hairlines and progress bars (1 2), dots (6 8 10).
const SIZES = new Set([0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 36, 40, 44, 48, 52, 56, 64, 80, 88, 96]);
const PHONE_MQ = /@media[^{]*\(max-width:\s*(767|599|359)px\)/;
const NOT_PHONE_MQ = /@media[^{]*\((min-width|min-height):|prefers-|hover|pointer|print/;

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'landing') walk(p); }
    else if (f.endsWith('.css') && f !== 'tokens.css') files.push(p);
  }
})(SRC);

const px = (v) => [...v.matchAll(/(-?\d*\.?\d+)px/g)].map((m) => +m[1]);
const misses = [];
const exceptions = [];
function check(file, line, sel, prop, value, raw) {
  const v = value.replace(/!important/, '').trim();
  const bad = (why) => (/\/\*\s*system:/.test(raw) ? exceptions : misses).push(`${relative(ROOT, file)}:${line + 1}  ${sel.slice(0, 70)}  { ${prop}: ${value} }  ${why}`);
  const literals = (allowed, label) => {
    // Tokens and calc() of tokens are fine; px literals must be allowed ones; no em/rem for spacing.
    if (/\d(r?em)\b/.test(v.replace(/var\([^)]*\)/g, ''))) return bad(`${label}: use px on the scale or a token`);
    for (const n of px(v.replace(/var\([^)]*\)/g, ''))) if (!allowed(n)) return bad(`${label}: ${n}px is off the system`);
  };
  if (prop === 'font-size') {
    if (/^(var\(--fs-[a-z]+\)|inherit|0|1em|100%)$/.test(v)) return;
    return bad('font-size: use a --fs-* token (display 24, title 17, body 15, secondary 13, caption 12, field 16)');
  }
  if (prop === 'font') {
    if (/^(var\(--t-[a-z]+\)|inherit)$/.test(v)) return;
    return bad('font: use a --t-* role');
  }
  if (prop === 'font-weight') {
    if (WEIGHTS.includes(v) || /^var\(--fw-[a-z]+\)$/.test(v)) return;
    return bad('font-weight: 400, 600 or 700');
  }
  if (/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(prop)) {
    const margin = prop.startsWith('margin');
    return literals((n) => SPACE.includes(Math.abs(n)) || SPACE_NAMED.includes(n) || (margin && Math.abs(n) === 1), prop);
  }
  if (/radius$/.test(prop)) {
    if (/^(0|50%|inherit)( (0|50%|var\(--r-[a-z]+\)))*$/.test(v) || /^(var\(--r-[a-z]+\)|0)( (var\(--r-[a-z]+\)|0))*$/.test(v)) return;
    return bad('radius: --r-tile 10, --r-card 16, --r-pill, --r-round, or 0');
  }
  if (prop === 'height' || prop === 'min-height') {
    return literals((n) => SIZES.has(Math.abs(n)) || (n > 96 && n % 8 === 0), prop);
  }
}

for (const file of files) {
  const whole = file.includes('/src/mobile/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const stack = []; // { kind: 'phone' | 'not' | 'rule' | 'at', sel }
  let buf = '';
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let clean = '';
    for (let j = 0; j < raw.length; ) {
      if (inComment) { const k = raw.indexOf('*/', j); if (k < 0) break; inComment = false; j = k + 2; continue; }
      const k = raw.indexOf('/*', j);
      if (k < 0) { clean += raw.slice(j); break; }
      clean += raw.slice(j, k); inComment = true; j = k + 2;
    }
    for (const part of clean.split(/([{}])/)) {
      if (part === '{') {
        const sel = buf.trim(); buf = '';
        let kind = 'rule';
        if (sel.startsWith('@media')) kind = PHONE_MQ.test(sel) ? 'phone' : NOT_PHONE_MQ.test(sel) ? 'not' : /max-width/.test(sel) ? 'not' : 'at';
        else if (sel.startsWith('@keyframes')) kind = 'not';
        else if (sel.startsWith('@')) kind = 'at';
        stack.push({ kind, sel });
      } else if (part === '}') { stack.pop(); buf = ''; }
      else if (stack.length && stack[stack.length - 1].kind === 'rule') {
        const kinds = stack.map((s) => s.kind);
        const phone = kinds.includes('not') ? false : kinds.includes('phone') ? true : whole;
        for (const decl of part.split(';')) {
          const m = decl.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/);
          if (m && phone) check(file, i, stack[stack.length - 1].sel, m[1], m[2], raw);
        }
      } else buf += ' ' + part;
    }
  }
}

if (process.argv.includes('--list')) for (const e of exceptions) console.log('  allowed  ' + e);
if (misses.length) {
  console.error(misses.join('\n'));
  console.error(`\n${misses.length} value(s) in the phone layer are off the sprint2go system. Use the tokens in src/tokens.css (docs/mobile-kit.md).`);
  process.exitCode = 1;
} else console.log(`Phone layer keeps to the system (${files.length} files, ${exceptions.length} explained exceptions).`);
