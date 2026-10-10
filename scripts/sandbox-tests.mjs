// The demo company and the try-out, end to end, on a production-like server (no demo data, a throwaway data folder,
// free ports, no mail): real people sign in and check on the server that
//  1. someone opens their own demo company, made from the demo data with today's dates, and only they see it
//  2. nothing of it becomes a real document, so no job, no mail and no operator number can see it
//  3. its owner changes anything in it; nobody else can read or write it, and nothing moves between it and a real company
//  4. nothing in it reaches the outside: no AI, no mail, no uploads, no invites
//  5. Hide, Show and Reset; a company can switch it off for its people; guests never get one
//  6. operators see how many there are on the Platform page, and nowhere else
//  7. deleting the account deletes it
//  8. /try opens the demo on the app's address (the site sends it there), and only the page view is counted
//   node scripts/sandbox-tests.mjs   (after npm run build: /try is served from dist)
import { spawn } from 'node:child_process';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('..', import.meta.url).pathname;
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 's2g-sandbox-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
const APP = `app.s2g-check.test:${httpPort}`;
const SITE = `s2g-check.test:${httpPort}`;
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'production',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  MAIL_ENABLED: '0',
  PUBLIC_URL: `http://${APP}`,
  SITE_URL: `http://${SITE}`,
  S2G_OPERATORS: 'op@s2g-check.test',
  SUPPORT_EMAIL: 'support@s2g-check.test',
};
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const finish = (code) => {
  server.kill('SIGTERM');
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server may still hold a file for a moment */
  }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 120_000).unref();

const base = `http://127.0.0.1:${httpPort}`;
/** A plain request with our own Host header (fetch won't send one). */
const raw = (path, host) =>
  new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: httpPort, path, method: 'GET', headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });

try {
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) break;
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await sleep(100);
  }
  check(await fetch(`${base}/api/health`).then((r) => r.ok, () => false), 'the server starts (production, no demo data)');

  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const now = () => new Date().toISOString();
  const put = (coll, d) => db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const password = randomBytes(9).toString('hex');
  const hash = () => {
    const salt = randomBytes(16);
    return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
  };
  const person = (id, name, email, extra = {}) => {
    put('users', { id, name, email, title: '', color: '#5b5bf6', ...extra });
    db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?)').run(id, email, hash());
  };
  check(db.prepare('SELECT COUNT(*) AS n FROM docs').get().n === 0, 'the database starts empty');
  person('u-alice', 'Alice Martin', 'alice@acme.test');
  person('u-bob', 'Bob Stone', 'bob@acme.test');
  person('u-carol', 'Carol New', 'carol@new.test');
  person('u-gina', 'Gina Guest', 'gina@client.test', { clientOf: { workspaceId: 'w-acme', clientId: 'c-acme' } });
  person('u-op', 'Olive Operator', 'op@s2g-check.test');
  put('workspaces', { id: 'w-acme', name: 'Acme', color: '#0ea5e9', domains: ['acme.test'], accounts: [], members: [{ userId: 'u-alice', role: 'owner' }, { userId: 'u-bob', role: 'member' }], createdAt: now() });
  put('clients', { id: 'c-acme', workspaceId: 'w-acme', name: 'Client Co', color: '#111', status: 'active', ownerId: 'u-alice', people: [{ email: 'gina@client.test', name: 'Gina Guest', role: 'approver', status: 'joined', invitedBy: 'u-alice', at: now() }] });

  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body, headers = {}) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    return {
      ok: r.ok && cookie.startsWith('s2g='),
      token: cookie.slice(4),
      get: (path) => call('GET', path),
      post: (path, body, headers) => call('POST', path, body, headers),
      me: () => call('GET', '/api/me').then((x) => x.json()),
      state: () => call('GET', '/api/state').then((x) => x.json()),
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
    };
  };
  const alice = await signIn('alice@acme.test');
  const bob = await signIn('bob@acme.test');
  const carol = await signIn('carol@new.test');
  const gina = await signIn('gina@client.test');
  check(alice.ok && bob.ok && carol.ok && gina.ok, 'four people sign in: an owner, a member, someone with no company yet, a guest');
  const demoDocs = (s) => Object.entries(s).flatMap(([coll, docs]) => docs.filter((d) => /demo-/.test(JSON.stringify(d))).map((d) => `${coll}:${d.id}`));
  const realDemo = () => db.prepare("SELECT COUNT(*) AS n FROM docs WHERE id LIKE 'demo-%' OR data LIKE '%demo-u-%'").get().n;

  /* ---------- 1. opening it ---------- */
  check((await alice.me()).demo?.state === 'none' && (await alice.me()).demo?.allowed === true, 'before: her demo company isn’t made, and she may open one');
  const t0 = Date.now();
  const made = await alice.post('/api/sandbox', { tz: 'Asia/Jakarta' });
  const madeBody = await made.json();
  check(made.ok && madeBody.workspaceId === 'demo-u-alice' && madeBody.demo?.state === 'on', `opening it makes it (${Date.now() - t0} ms)`);
  const s1 = await alice.state();
  const ws = s1.workspaces.find((w) => w.id === 'demo-u-alice');
  check(!!ws && ws.sandbox?.owner === 'u-alice' && ws.members[0].userId === 'u-alice' && ws.members[0].role === 'owner', 'she owns it, in the owner’s seat, marked as her demo company');
  check(s1.workspaces.some((w) => w.id === 'w-acme'), 'her real company is still there next to it');
  const myMail = s1.threads.filter((t) => ws.accounts.some((a) => a.id === t.accountId && a.users.includes('u-alice')));
  check(myMail.length >= 10 && myMail.some((t) => t.unread), `her mailbox has the demo’s mail (${myMail.length} conversations)`);
  check(s1.channels.filter((c) => c.workspaceId === ws.id).length >= 8 && s1.todos.filter((t) => t.workspaceId === ws.id).length >= 15 && s1.clients.filter((c) => c.workspaceId === ws.id).length >= 5, 'channels, tasks and projects are there');
  const mates = s1.users.filter((u) => u.id.startsWith('demo-u-alice-'));
  check(mates.length === 6 && mates.some((u) => u.name === 'Owen Mitchell'), 'the made-up teammates exist only inside it');
  const standup = s1.events.find((e) => e.workspaceId === ws.id && e.title === 'Daily standup' && Math.abs(Date.parse(e.start) - Date.now()) < 7 * 86_400_000);
  check(!!standup && new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(standup.start)) === '09:30', 'its calendar is this week’s, at her hours (standup 9:30 in Jakarta)');
  const newest = Math.max(...myMail.flatMap((t) => t.messages.map((m) => Date.parse(m.date))));
  check(Date.now() - newest < 60 * 60_000, 'and its newest email arrived within the hour');
  check(!JSON.stringify(s1).includes('u-james') && /Hi Alice,/.test(JSON.stringify(myMail)), 'the demo owner’s name is hers');

  /* ---------- 2. never a real document ---------- */
  check(realDemo() === 0, 'nothing of it is in the real documents, so the jobs, the mail engine and the operator numbers can’t see it');
  const b1 = await bob.state();
  check(demoDocs(b1).length === 0, `her teammate sees none of it (${demoDocs(b1).slice(0, 3).join(', ') || 'nothing'})`);
  check((await bob.me()).demo?.state === 'none', 'and has none of his own until he opens it');

  /* ---------- 3. who reads and writes it ---------- */
  const task = { id: 'tk-alice-demo', title: 'Try a demo task', workspaceId: 'demo-u-alice', userId: 'u-alice', done: false, status: 'todo', source: 'manual', priority: 'normal', createdAt: now() };
  const w1 = await alice.sync('todos', [task]);
  check(w1.saved === 1 && realDemo() === 0 && (await alice.state()).todos.some((t) => t.id === task.id), 'her change is saved in her demo company, not as a real task');
  const someDemoTask = s1.todos.find((t) => t.workspaceId === ws.id);
  const w2 = await bob.sync('todos', [{ ...someDemoTask, title: 'Bob was here' }, { ...task, id: 'tk-bob', title: 'Bob’s' }]);
  check(w2.saved === 0 && !(await alice.state()).todos.some((t) => t.title === 'Bob was here' || t.id === 'tk-bob') && realDemo() === 0, 'someone else can’t write into it, by its id or its company');
  const w3 = await bob.sync('todos', [{ id: 'demo-sneaky', title: 'x', workspaceId: 'w-acme' }]);
  check(w3.saved === 0 && !doc('todos', 'demo-sneaky'), 'a real task can’t take a demo id');
  const w4 = await alice.sync('workspaces', [{ id: 'demo-u-bob', name: 'Bob’s demo, taken', color: '#000', domains: [], accounts: [], members: [] }]);
  check(w4.saved === 0 && !doc('workspaces', 'demo-u-bob'), 'nor a real company someone else’s demo company id');
  const w5 = await alice.sync('todos', [{ ...task, workspaceId: 'w-acme' }]);
  check(w5.saved === 0 && !doc('todos', task.id) && (await alice.state()).todos.find((t) => t.id === task.id)?.workspaceId === 'demo-u-alice', 'a demo task can’t move into her real company');
  const w6 = await alice.sync('users', [{ id: 'demo-u-alice-u-new', name: 'Invented', email: 'new@acme.test' }]);
  check(w6.saved === 0 && !doc('users', 'demo-u-alice-u-new'), 'nobody new comes into it');
  const realTask = { id: 'tk-real', title: 'Real work', workspaceId: 'w-acme', userId: 'u-alice', done: false, status: 'todo', source: 'manual', priority: 'normal' };
  const w7 = await alice.sync('todos', [realTask]);
  check(w7.saved === 1 && doc('todos', 'tk-real')?.workspaceId === 'w-acme', 'her real company works as before');

  /* ---------- 4. nothing leaves it ---------- */
  const aiR = await alice.post('/api/ai/summarize', { workspaceId: 'demo-u-alice', thread: { id: 'x', subject: 's', messages: [] } });
  check(aiR.status === 403, `no AI on anyone’s keys (${aiR.status})`);
  const mailR = await alice.post('/api/mail/send', { workspaceId: 'demo-u-alice', accountId: ws.accounts[0].id, to: [{ name: 'X', email: 'x@example.com' }], subject: 'hi', text: 'hi' });
  check(mailR.status === 403, `no mail out (${mailR.status})`);
  const upR = await alice.post('/api/upload', 'hello', { 'content-type': 'text/plain', 'x-file-name': 'a.txt', 'x-workspace': 'demo-u-alice' });
  check(upR.status === 403 && db.prepare("SELECT COUNT(*) AS n FROM files WHERE workspace_id LIKE 'demo-%'").get().n === 0, `no uploads on our server (${upR.status})`);
  const invR = await alice.post('/api/invite', { userId: 'demo-u-alice-u-owen', email: 'owen@example.com' });
  check(invR.status === 403, `no invites to its made-up people (${invR.status})`);
  const botR = await alice.post('/api/meet/bot', { meeting: { id: 'mt-demo-x', workspaceId: 'demo-u-alice', url: 'https://meet.google.com/abc-defg-hij' } });
  check(botR.status === 403, `no notetaker (${botR.status})`);
  const wl = await alice.post('/api/white-label/domain', { workspaceId: 'demo-u-alice', domain: 'portal.example.com' });
  check(wl.status === 403, `no own address (${wl.status})`);
  check(db.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE workspace_id LIKE 'demo-%'").get().n === 0, 'and no AI use is logged for it');

  /* ---------- 5. Hide, Show, Reset; companies and guests ---------- */
  const hid = await alice.post('/api/sandbox/hide');
  check(hid.ok && (await alice.me()).demo?.state === 'hidden' && demoDocs(await alice.state()).length === 0, 'Hide: out of her app');
  const w8 = await alice.sync('todos', [{ ...task, title: 'While hidden' }]);
  check(w8.saved === 0 && !doc('todos', task.id), 'nothing is saved into it while it’s hidden');
  await alice.post('/api/sandbox', { tz: 'Asia/Jakarta' });
  const s2 = await alice.state();
  check((await alice.me()).demo?.state === 'on' && s2.todos.some((t) => t.id === task.id && t.title === 'Try a demo task'), 'Show: back as she left it');
  const reset = await alice.post('/api/sandbox/reset', { tz: 'Asia/Jakarta' });
  const s3 = await alice.state();
  check(reset.ok && !s3.todos.some((t) => t.id === task.id) && s3.todos.filter((t) => t.workspaceId === 'demo-u-alice').length === s1.todos.filter((t) => t.workspaceId === 'demo-u-alice').length, 'Reset: made again from the start');
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), demoCompany: false }]);
  const off = await alice.me();
  check(doc('workspaces', 'w-acme').demoCompany === false && off.demo?.allowed === false && demoDocs(await alice.state()).length === 0, 'a company switches it off for its people');
  check((await bob.post('/api/sandbox', {})).status === 403, 'then nobody there can open one');
  await bob.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), demoCompany: true }]);
  check(doc('workspaces', 'w-acme').demoCompany === false, 'only its admins switch it back on');
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), demoCompany: true }]);
  check((await alice.me()).demo?.allowed === true && demoDocs(await alice.state()).length > 0, 'switched back on, hers is there again');
  check((await gina.me()).demo?.allowed === false && (await gina.post('/api/sandbox', {})).status === 403, 'a guest never gets one');
  check((await carol.me()).demo?.allowed === true, 'someone with no company yet may look around first');
  await carol.post('/api/sandbox', { tz: 'Europe/Amsterdam' });
  const c1 = await carol.state();
  check(c1.workspaces.length === 1 && c1.workspaces[0].id === 'demo-u-carol' && demoDocs(await alice.state()).every((x) => !x.includes('u-carol')), 'she gets her own, apart from Alice’s');
  const pc = await carol.sync('prefs', [{ id: 'u-carol', value: { 'pm-settings:u-carol': { theme: 'dark' } } }]);
  const pb = await bob.sync('prefs', [{ id: 'u-carol', value: { 'pm-settings:u-carol': { theme: 'light' } } }]);
  check(pc.saved === 1 && pb.saved === 0 && (await carol.state()).prefs.find((x) => x.id === 'u-carol')?.value['pm-settings:u-carol'].theme === 'dark', 'with no company yet her own settings are kept (and only she changes them)');

  /* ---------- 6. operators ---------- */
  db.prepare('UPDATE operators SET totp_on = 1 WHERE email = ?').run('op@s2g-check.test');
  const op = await signIn('op@s2g-check.test');
  db.prepare('UPDATE sessions SET op_ok = ? WHERE token = ?').run(now(), createHash('sha256').update(op.token).digest('hex'));
  const adm = (path) => op.get(`/api/admin/${path}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const sys = await adm('system');
  check(sys.status === 200 && sys.body.demoCompanies?.total === 2 && sys.body.demoCompanies.bytes > 0, `the Platform page counts them (${sys.body.demoCompanies?.total})`);
  for (const path of ['companies', 'people', 'today', 'growth', 'revenue', 'search?q=owen', 'search?q=pixel']) {
    const r = await adm(path);
    check(r.status === 200 && !/demo-u-|Owen|demo\.sprint2go\.com/i.test(JSON.stringify(r.body)), `and ${path.split('?')[0]}${path.includes('?') ? ` (${path.split('=')[1]})` : ''} never shows them`);
  }

  /* ---------- 7. deleting the account ---------- */
  const del = await carol.post('/api/account/delete', { password });
  check(del.ok && db.prepare("SELECT COUNT(*) AS n FROM sandbox_docs WHERE owner = 'u-carol'").get().n === 0 && !db.prepare("SELECT 1 FROM sandboxes WHERE owner = 'u-carol'").get(), 'deleting the account deletes her demo company');

  /* ---------- 8. /try ---------- */
  const built = existsSync(join(ROOT, 'dist', 'index.html'));
  check(built, 'the app is built (npm run build)');
  if (built) {
    const app = await raw('/try', APP);
    check(app.status === 200 && /<div id="root">/.test(app.body) && !/landing/i.test(app.headers['content-type'] ?? ''), `/try opens the app on its address (${app.status})`);
    const deep = await raw('/try/mail', APP);
    check(deep.status === 200 && /<div id="root">/.test(deep.body), 'and its screens reload in place');
    const site = await raw('/try', SITE);
    check(site.status === 301 && site.headers.location === `http://${APP}/try`, `the site sends /try to the app (${site.status} → ${site.headers.location})`);
    const views = db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM page_views WHERE path = '/try'").get().n;
    check(views === 1, `one page view counted for /try (${views})`);
    check(!(app.headers['set-cookie'] ?? []).some((c) => c.startsWith('s2g=')), 'no session is given out');
  }
  db.close();
} catch (e) {
  console.log('FAIL', e instanceof Error ? e.stack : e);
  failed++;
}
console.log(failed ? `\n${failed} failed` : '\nAll passed');
finish(failed ? 1 : 0);
