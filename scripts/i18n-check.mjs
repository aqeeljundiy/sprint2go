#!/usr/bin/env node
// The language check (docs/i18n.md). Finds the English text the code translates (t, tn, tx, tj, mark, msg, phrase) and
// compares it with the Indonesian dictionaries in src/i18n/id/<area>.ts.
//
//   node scripts/i18n-check.mjs                 per area: words used, translated, missing; fails on placeholder problems
//   node scripts/i18n-check.mjs --strict        also fails on missing words, conflicts and copy problems
//   node scripts/i18n-check.mjs --strict admin,server,misc   the same, for these areas only (finished ones)
//   node scripts/i18n-check.mjs --missing shell the words with no Indonesian yet in one area (or a file path)
//   node scripts/i18n-check.mjs --todo settings text that still looks untranslated in an area's files (or one file)
//   node scripts/i18n-check.mjs --unused        entries no code uses any more
//   node scripts/i18n-check.mjs --dynamic       calls whose text isn't written out where they are
//
// Fails (exit 1) on: a {placeholder} in the Indonesian that the English doesn't have or the other way round, and
// t('… {name} …', { … }) called without a value for a placeholder. Missing words are fine while builders work.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync, Visitor } from 'rolldown/utils';

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const STRICT = flag('--strict');
// --strict a,b,c: only these areas' missing words and only warnings that name them fail the check.
const STRICT_AREAS = STRICT && opt('--strict') && !opt('--strict').startsWith('--') ? opt('--strict').split(',').map((x) => x.trim()) : null;

/* ---------- which area each file belongs to (the owners are in docs/i18n.md and each area file's header) ---------- */

const AREAS = [
  ['shell', /^src\/(App|Root|main|lazy|terms|toast|sync|store|push|pushBridge|diagnostics|tryOut|sandbox|caps|utils|exitAnimations|slidingTabs|onePanel|presence|photos|seed)\.tsx?$|^src\/mobile\/|^src\/components\/(MobileTop|AppRail|CommandPalette|AccountMenu|WorkspaceSwitcher|InstallPrompt|Notifications|DemoCompany|AppSettings|AppSetupCard|Avatar|Logo|WorkspaceLogo|PhotoPicker)\.tsx$/],
  ['ui', /^src\/components\/ui\/|^src\/i18n\/(format|index)\.ts$/],
  ['settings', /^src\/settings\.ts$|^src\/components\/(SettingsPage|settingsList|NotificationSettings|HelpSection|OutOfOffice|WorkspaceForms|ConnectedApps|EmailSetupGuide|PhoneMailApps|LanguagePicker)\.tsx?$|^src\/components\/(admin|imports)\/|^src\/data\/(pricing|aiCatalog|aiModels)\.ts$/],
  ['auth', /^src\/components\/(SignIn|TwoStep)\.tsx$/],
  ['home', /^src\/components\/HomeView\.tsx$|^src\/components\/home\/|^src\/needsYou\.ts$/],
  ['onboarding', /^src\/components\/Onboarding\.tsx$/],
  ['mail', /^src\/components\/(Reader|Compose|MessageList|Sidebar|RecipientInput|BlockDialog|TempAddress|TrackingDashboard|TrackingPanel|AIWriter|InviteCard)\.tsx$|^src\/components\/mail\/|^src\/(mailRules|tracking|inviteTimes|identity)\.ts$|^src\/data\/mock\.ts$/],
  ['calendar', /^src\/components\/calendar\/|^src\/(repeat|recurrence)\.ts$|^src\/components\/(CalendarView|CalendarSidebar|EventEditor|ConnectCalendar|HolidayCountries)\.tsx$|^src\/(calendarUtils|calendarLink|holidayDays|holidayRegions)\.ts$|^src\/data\/(calendar|holidays)\.ts$/],
  ['notes', /^src\/components\/notes\/|^src\/components\/(NotesApp|RichEditor)\.tsx$|^src\/data\/notes\.ts$/],
  ['chat', /^src\/components\/(ChatApp|ChannelDialog|ChannelMaterials|ChatDraft|Huddle)\.tsx$|^src\/components\/chat\/|^src\/ice\.ts$/],
  ['meet', /^src\/components\/MeetApp\.tsx$|^src\/(meetingLinks)\.ts$|^src\/data\/languages\.ts$/],
  ['drive', /^src\/components\/(DriveView|DriveSidebar|DrivePreview|BigFileDialog|FileIcon)\.tsx$|^src\/data\/drive\.ts$/],
  ['tasks', /^src\/components\/(TasksView|TaskDrawer|TasksSidebar|BrainDump|TemplateDialog)\.tsx$|^src\/components\/tasks\/|^src\/(quickAdd|taskDates|stages)\.ts$|^src\/data\/templates\.ts$/],
  ['projects', /^src\/components\/(ProjectsHome|ProjectsSidebar|ProjectPhone|ProjectPeople|ProjectPicker|ProjectBadge|PastClients|EndClientDialog|Quotes)\.tsx$/],
  ['teams', /^src\/components\/teams\//],
  ['tables', /^src\/components\/tables\/|^src\/data\/tables\.ts$/],
  ['vault', /^src\/components\/VaultApp\.tsx$|^src\/vaultCrypto\.ts$/],
  ['guest', /^src\/components\/(ClientApp|SharedHome)\.tsx$|^src\/(clientActions|clientView)\.ts$/],
  ['admin', /^src\/admin\//],
  ['server', /^server\//],
  ['misc', /./], // everything no area above claims
];
const areaOf = (file) => AREAS.find(([, re]) => re.test(file))[0];

/* ---------- the code: every t('…'), tn(n, '…', '…'), tx('ctx', '…'), mark('…') and msg('…') ---------- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'landing' || p.endsWith(join('src', 'i18n', 'id'))) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'server'))].map((p) => relative(ROOT, p).split('\\').join('/'));
const lineAt = (src, i) => src.slice(0, i).split('\n').length;
/** The text of a string literal or a template literal without ${}. Anything else: null. */
const strOf = (n) => (!n ? null : n.type === 'Literal' && typeof n.value === 'string' ? n.value : n.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis.map((q) => q.value.cooked).join('') : null);
const holes = (s) => new Set([...s.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((m) => m[1].charAt(0).toLowerCase() + m[1].slice(1)));

const used = new Map(); // key -> [{ file, line, area }]
const errors = [];
const warnings = [];
const dynamic = []; // t(something) whose text can't be read here
const todo = []; // { file, line, text, how }
const TRANSLATED = new Set(['t', 'tn', 'tx', 'tj', 'mark', 'msg', 'phrase']);
const TEXTY = /^(title|placeholder|aria-label|label|text|alt|hint|sub|confirm|description|desc|heading|tooltip|empty|emptyText|cta|action|okLabel|cancelLabel|subtitle|note|help|why|error|question|body|name|value)$/;
const looksLikeWords = (s) => /[A-Za-z]{2}/.test(s) && (/\s/.test(s.trim()) || /^[A-Z][a-z]/.test(s.trim())) && !/^[a-z0-9-]+(\s[a-z0-9-]+)*$/.test(s.trim()) && !/^(https?:|mailto:|\/|#|\.)/.test(s.trim()) && !/^[A-Z][a-zA-Z]+(\.[A-Za-z]+)+/.test(s.trim());

function use(key, file, line, area) {
  if (!used.has(key)) used.set(key, []);
  used.get(key).push({ file, line, area });
}

for (const file of files) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  if (!/\b(t|tn|tx|mark|msg)\(/.test(src) && !flag('--todo')) continue;
  let ast;
  try {
    ast = parseSync(file, src, { lang: file.endsWith('x') ? 'tsx' : 'ts' });
  } catch (e) {
    warnings.push(`${file}: couldn't be read (${e.message})`);
    continue;
  }
  const area = areaOf(file);
  const inside = []; // [start, end] of translated calls, so --todo skips their strings
  // Only the functions imported from src/i18n count (other files have their own little t() or msg()).
  const local = new Map(); // local name -> t | tn | tx | mark | msg
  for (const st of ast.program.body) {
    if (st.type !== 'ImportDeclaration' || !/(^|\/)i18n(\/(index|tj))?(\.tsx?)?$|^\.\/(index|tj)(\.tsx?)?$/.test(st.source.value)) continue;
    if (/^\.\/(index|tj)/.test(st.source.value) && !file.startsWith('src/i18n/')) continue;
    for (const s of st.specifiers) if (s.type === 'ImportSpecifier' && TRANSLATED.has(s.imported.name)) local.set(s.local.name, s.imported.name);
  }
  if (!local.size && !flag('--todo')) continue;
  new Visitor({
    CallExpression(node) {
      const name = node.callee?.type === 'Identifier' ? local.get(node.callee.name) : null;
      if (!name) return;
      inside.push([node.start, node.end]);
      const line = lineAt(src, node.start);
      const a = node.arguments;
      const keys = [];
      let vars = null;
      let one = null;
      if (name === 't' || name === 'tj' || name === 'mark' || name === 'msg' || name === 'phrase') keys.push(strOf(a[0])), (vars = a[1]);
      else if (name === 'tx') {
        const ctx = strOf(a[0]);
        const text = strOf(a[1]);
        keys.push(ctx !== null && text !== null ? `${ctx}::${text}` : null);
        vars = a[2];
      } else if (name === 'tn') {
        keys.push(strOf(a[2]));
        one = strOf(a[1]); // English only (the dictionary is keyed by the plural), but its placeholders need values too
        vars = a[3];
      }
      for (const k of keys) {
        if (k === null) {
          if (name !== 'mark') dynamic.push(`${file}:${line} ${name}(…) with text that isn't written out`);
          continue;
        }
        use(k, file, line, area);
        // Every placeholder needs a value: t('Hello {name}') without { name } shows "{name}".
        const need = [...new Set([...holes(k.includes('::') ? k.slice(k.indexOf('::') + 2) : k), ...(one ? holes(one) : [])])].filter((h) => !(name === 'tn' && h === 'n'));
        if (!need.length || name === 'mark') continue;
        if (!vars) {
          errors.push(`${file}:${line} ${name}('${k}') has {${need.join('}, {')}} but no values`);
          continue;
        }
        if (vars.type === 'ObjectExpression' && !vars.properties.some((p) => p.type === 'SpreadElement')) {
          const given = new Set(vars.properties.map((p) => (p.key?.type === 'Identifier' ? p.key.name : p.key?.value)).filter(Boolean));
          const lost = need.filter((h) => !given.has(h));
          if (lost.length) errors.push(`${file}:${line} ${name}('${k}') has no value for {${lost.join('}, {')}}`);
        }
      }
    },
  }).visit(ast.program);

  // --todo: text on screen that isn't in t() yet (a guess: JSX text, texty attributes and properties).
  if (flag('--todo')) {
    const free = (n) => !inside.some(([s, e]) => n.start >= s && n.end <= e);
    const add = (n, text, how) => free(n) && looksLikeWords(text) && todo.push({ file, area, line: lineAt(src, n.start), text: text.trim().replace(/\s+/g, ' '), how });
    new Visitor({
      JSXText(n) {
        if (/[A-Za-z]{2}/.test(n.value)) add(n, n.value.trim() ? n.value : '', 'text');
      },
      JSXAttribute(n) {
        const nm = n.name?.name;
        if (typeof nm !== 'string' || !TEXTY.test(nm)) return;
        const s = strOf(n.value) ?? (n.value?.type === 'JSXExpressionContainer' ? strOf(n.value.expression) : null);
        if (s !== null) add(n.value, s, nm);
        else if (n.value?.type === 'JSXExpressionContainer' && n.value.expression.type === 'TemplateLiteral') add(n.value, n.value.expression.quasis.map((q) => q.value.cooked).join('…'), nm);
      },
      Property(n) {
        const k = n.key?.type === 'Identifier' ? n.key.name : n.key?.value;
        if (typeof k !== 'string' || !TEXTY.test(k)) return;
        const s = strOf(n.value);
        if (s !== null) add(n.value, s, k);
        else if (n.value?.type === 'TemplateLiteral') add(n.value, n.value.quasis.map((q) => q.value.cooked).join('…'), k);
      },
    }).visit(ast.program);
  }
}

/* ---------- files the server and the scripts load: Node can't import a folder or React ---------- */

{
  const reached = new Set();
  const find = (from, spec) => {
    if (!spec.startsWith('.')) return null;
    const base = join(from, '..', spec);
    for (const c of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
    return null;
  };
  const visit = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
      if (m[1]) continue; // type-only: erased
      const to = find(file, m[2]);
      if (!to) continue;
      const rel = relative(ROOT, file).split('\\').join('/');
      if (rel.startsWith('src/') && /(^|\/)i18n$/.test(m[2])) errors.push(`${rel} imports '${m[2]}': the server loads this file, so import '${m[2]}/index' (and '${m[2]}/format'), docs/i18n.md`);
      if (rel.startsWith('src/') && /i18n\/(tj|useLang)$/.test(m[2])) errors.push(`${rel} imports '${m[2]}': the server loads this file, and that one needs React`);
      visit(to);
    }
  };
  for (const dir of ['server', 'scripts']) for (const f of readdirSync(join(ROOT, dir))) if (/\.(ts|mjs)$/.test(f) && !f.endsWith('.test.ts')) visit(join(ROOT, dir, f));
}

/* ---------- the dictionaries ---------- */

const idDir = join(ROOT, 'src', 'i18n', 'id');
const areaFiles = readdirSync(idDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
const indexSrc = readFileSync(join(idDir, 'index.ts'), 'utf8');
const dict = new Map(); // key -> [{ area, value }]
for (const f of areaFiles) {
  // An area can split its words into parts: settings.ts, settings.ai.ts… (all of them are the settings area).
  const area = f.replace(/\.ts$/, '').split('.')[0];
  if (!indexSrc.includes(`from './${f.replace(/\.ts$/, '')}'`)) errors.push(`src/i18n/id/${f} isn't imported in src/i18n/id/index.ts`);
  if (!AREAS.some(([a]) => a === area) && area !== 'common') warnings.push(`src/i18n/id/${f}: no files map to "${area}" in scripts/i18n-check.mjs`);
  const entries = (await import(pathToFileURL(join(idDir, f)).href)).default;
  for (const [k, v] of Object.entries(entries)) {
    if (!dict.has(k)) dict.set(k, []);
    dict.get(k).push({ area, file: f, value: v });
    const en = k.includes('::') ? k.slice(k.indexOf('::') + 2) : k;
    if (typeof v !== 'string' || !v.trim()) {
      errors.push(`${area}: "${k}" has an empty Indonesian text`);
      continue;
    }
    const [a, b] = [holes(en), holes(v)];
    const extra = [...b].filter((h) => !a.has(h));
    const lost = [...a].filter((h) => !b.has(h));
    if (extra.length || lost.length) errors.push(`${area}: placeholders differ in "${k}" → "${v}"${extra.length ? ` (Indonesian adds {${extra.join('}, {')}})` : ''}${lost.length ? ` (Indonesian drops {${lost.join('}, {')}})` : ''}`);
    if (/[—–]/.test(v)) warnings.push(`${area}: a dash in "${v}" (no em or en dashes in either language)`);
    if (/Sprint2go|SPRINT2GO/.test(v)) warnings.push(`${area}: "${v}" (always lowercase "sprint2go")`);
  }
}
for (const [k, list] of dict) {
  const values = new Set(list.map((x) => x.value));
  if (values.size > 1) warnings.push(`"${k}" means different things in ${list.map((x) => `id/${x.file} ("${x.value}")`).join(' and ')}: the last file loaded wins everywhere. Use tx('context', …) for one of them.`);
}

/* ---------- the report ---------- */

const rows = new Map(AREAS.map(([a]) => [a, { used: new Set(), missing: new Set() }]));
for (const [k, where] of used)
  for (const w of where) {
    rows.get(w.area).used.add(k);
    if (!dict.has(k) && !(k.includes('::') && dict.has(k.slice(k.indexOf('::') + 2)))) rows.get(w.area).missing.add(k);
  }

const pick = (what) => {
  if (!what) return () => true;
  if (AREAS.some(([a]) => a === what)) return (x) => x.area === what;
  return (x) => x.file.startsWith(what);
};

if (flag('--missing')) {
  const want = pick(opt('--missing'));
  const out = [];
  for (const [k, where] of used) {
    if (dict.has(k) || (k.includes('::') && dict.has(k.slice(k.indexOf('::') + 2)))) continue;
    const here = where.filter(want);
    if (here.length) out.push(`  ${JSON.stringify(k)}  (${here[0].file}:${here[0].line}${here.length > 1 ? ` +${here.length - 1}` : ''})`);
  }
  console.log(`${out.length} without Indonesian${opt('--missing') ? ` in ${opt('--missing')}` : ''}:\n${out.sort().join('\n')}`);
} else if (flag('--todo')) {
  const want = pick(opt('--todo'));
  const list = todo.filter(want);
  let last = '';
  for (const x of list) {
    if (x.file !== last) console.log(`\n${x.file}`);
    last = x.file;
    console.log(`  ${String(x.line).padStart(5)}  ${x.how.padEnd(11)} ${x.text.slice(0, 110)}`);
  }
  console.log(`\n${list.length} places that may still be English (a guess: names, data and code can show up here too).`);
} else if (flag('--unused')) {
  const unused = [...dict.keys()].filter((k) => !used.has(k) && !used.has(k.slice(k.indexOf('::') + 2)));
  console.log(`${unused.length} Indonesian entries no code uses:\n${unused.map((k) => `  ${dict.get(k)[0].area}: ${JSON.stringify(k)}`).join('\n')}`);
} else {
  const own = (a) => [...dict.values()].filter((l) => l.some((x) => x.area === a)).length;
  console.log('Indonesian, per area (words the code uses / with Indonesian / missing, and the entries in its file):');
  for (const [a, r] of rows) {
    if (!r.used.size && !own(a)) continue;
    console.log(`  ${a.padEnd(11)} ${String(r.used.size).padStart(5)} used  ${String(r.used.size - r.missing.size).padStart(5)} translated  ${String(r.missing.size).padStart(5)} missing   ${String(own(a)).padStart(5)} in id/${a}.ts`);
  }
  if (own('common')) console.log(`  ${'common'.padEnd(11)} ${''.padStart(5)}       ${''.padStart(5)}             ${''.padStart(5)}           ${String(own('common')).padStart(5)} in id/common.ts`);
  if (dynamic.length) console.log(`\n${dynamic.length} calls translate text that isn't written out where they are (fine for mark()ed tables; run with --dynamic to list).`);
  if (flag('--dynamic')) console.log(dynamic.map((d) => '  ' + d).join('\n'));
}

if (warnings.length) console.log(`\nWarnings:\n${warnings.map((w) => '  ' + w).join('\n')}`);
if (errors.length) console.log(`\nProblems:\n${errors.map((e) => '  ' + e).join('\n')}`);
const strictRows = STRICT_AREAS ? [...rows].filter(([a]) => STRICT_AREAS.includes(a)).map(([, r]) => r) : [...rows.values()];
const missing = strictRows.reduce((n, r) => n + r.missing.size, 0);
const strictWarnings = STRICT_AREAS ? warnings.filter((w) => STRICT_AREAS.some((a) => w.startsWith(`${a}:`) || w.includes(`id/${a}.`) || w.includes(`src/i18n/id/${a}`))) : warnings;
const fail = errors.length > 0 || (STRICT && (missing > 0 || strictWarnings.length > 0));
if (fail) {
  console.log(`\ni18n check failed${STRICT && !errors.length ? ` (--strict${STRICT_AREAS ? ` ${STRICT_AREAS.join(',')}` : ''}: ${missing} missing, ${strictWarnings.length} warnings)` : ''}.`);
  process.exit(1);
}
console.log(`\ni18n check passed${missing ? ` (${missing} words still English, allowed until --strict)` : ''}.`);
