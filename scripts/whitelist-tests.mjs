// The Whitelist ("Unlimited" in the app), checked two ways.
//  1. In this process, on a throwaway data folder: what an Unlimited plan lifts (people on Free's 5, hosted
//     mailboxes, the notetaker's hours, prorating, invoices' totals), and Boosted sending's monthly limit (SES): a send
//     that fits goes Boosted, 80% tells the owners and operators once, a send past the limit doesn't fit, people it's
//     switched off for never use it.
//  2. End to end (the server on a throwaway folder and free ports, demo data, a stand-in disk): only operators see the
//     Whitelist and only billing operators change it, each change in the audit log; a whitelisted company has every
//     limit lifted (mailboxes, notetaker hours, storage up to the disk's safety reserve with a plain message after),
//     no invoices, codes, credits, pauses or plan changes from the app; AI's monthly limit tells owners and operators
//     at 80% and pauses AI at 100% with a plain message, and a raised limit applies at once; each person's rules (a
//     share of AI, a storage cap, AI and the notetaker off) only split what the company has; revenue, MRR and the AI
//     verdict leave it out and count it on its own line; taking it off brings back the plan it had.
//   node --import ./server/register.mjs scripts/whitelist-tests.mjs
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('..', import.meta.url).pathname;
const unitDir = mkdtempSync(join(tmpdir(), 's2g-whitelist-unit-'));
process.env.S2G_DATA = unitDir;

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const now = () => new Date().toISOString();

/* ---------- 1. in this process ---------- */
{
  const db = await import('../server/db.ts');
  await import('../server/mailer.ts'); // its outbox table
  const wl = await import('../server/whitelist.ts');
  const billing = await import('../server/billing.ts');
  const kit = await import('../server/importKit.ts');
  const { mailboxRoom, meetHours, monthlyTotal, prorate } = await import('../src/data/pricing.ts');
  const free = { track: 'own', tier: 'free', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: 'Acme', emails: [] }, since: now() };
  const members = Array.from({ length: 12 }, (_, i) => ({ userId: `u-${i}`, role: i === 0 ? 'owner' : i === 1 ? 'admin' : 'member' }));
  const ws = { id: 'w-acme', name: 'Acme', members, accounts: [], plan: free };
  db.writeDocs('workspaces', [ws], [], null);
  check(kit.seatsLeft(ws) === 0, 'on Free, 12 people leave no room to import anyone else');
  const unl = wl.unlimitedPlan(free, 'Acme');
  const uws = { ...ws, plan: unl };
  db.writeDocs('workspaces', [uws], [], null);
  check(unl.unlimited === true && unl.tier === 'business' && unl.track === 'ai' && unl.addons.branding && !unl.trialEnds && !unl.paused, 'the Unlimited plan: the top plan with every add-on, no trial or pause');
  check(kit.seatsLeft(uws) === null, 'Unlimited: no limit on people');
  check(mailboxRoom(unl, 12).total === Infinity, 'Unlimited: as many hosted mailboxes as wanted');
  const boxes = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, email: `p${i}@acme.test`, kind: 'personal' }));
  check(billing.mailboxesOnSave({ ...uws, accounts: boxes }, uws).accounts.length === 40 && billing.overRoom({ ...uws, accounts: boxes }).size === 0, 'forty mailboxes save and all of them send');
  check(meetHours(unl, 12) === Infinity && billing.meetMinutes(uws).left === Infinity, 'Unlimited: no limit on the notetaker’s hours');
  check(monthlyTotal(unl, 12).total === 0 && prorate(unl, { track: 'own', tier: 'small', cycle: 'monthly' }, 12) === null, 'nothing to bill and nothing to prorate');
  check(billing.adjustmentsOnSave(uws, unl, { ...free, tier: 'studio' }) === undefined, 'no prorated switch waits on an Unlimited plan');

  // Boosted sending's monthly limit.
  wl.add('w-acme', free, { note: 'Seed investor', aiUnit: 'usd', aiLimit: 10, sesLimit: 100 }, 'op@test');
  const told = { notices: [], ops: [] };
  wl.init({ notify: (ids, text, url, wsId) => told.notices.push({ ids, text: text.text, url, wsId }), operators: (kind, text, to) => told.ops.push({ kind, text: text.text, to }) });
  const sent = (n) => {
    const ins = db.db.prepare("INSERT INTO outbox (id, workspace_id, account_id, thread_id, message_id, route, from_addr, to_addr, raw, attempts, next_at, state, error, created_at) VALUES (?, 'w-acme', 'a0', 't', 'm', 'boosted', 'p0@acme.test', ?, x'', 0, ?, 'sent', NULL, ?)");
    for (let i = 0; i < n; i++) ins.run(randomBytes(6).toString('hex'), `x${i}@out.test`, now(), now());
  };
  sent(70);
  check(wl.sesUsed('w-acme') === 70 && wl.sesGate(uws, 10, 'u-2').ok, '70 of 100 Boosted emails used: a send to 10 more fits');
  wl.checkAlerts(uws, 'u-2');
  check(told.notices.length === 0 && told.ops.length === 0, 'nobody is told below 80%');
  sent(12);
  wl.checkAlerts(uws, 'u-2');
  check(told.notices.some((n) => n.ids.includes('u-0') && !n.ids.includes('u-2') && /80% of this month’s Boosted sending/.test(n.text)), 'at 80% the owners hear it');
  check(told.ops.some((o) => /used 80% of this month’s Boosted sending/.test(o.text) && o.to === '/admin/whitelist'), 'and so do the operators');
  const before = told.notices.length;
  wl.checkAlerts(uws, 'u-2');
  check(told.notices.length === before, '80% is told once');
  const g = wl.sesGate(uws, 30, 'u-2');
  check(!g.ok && g.why === 'used-up', 'a send past the month’s limit doesn’t go Boosted');
  wl.checkAlerts(uws, 'u-2', { sesFull: true });
  check(told.notices.some((n) => /Boosted sending .* is used up, so mail goes out from the sprint2go server/.test(n.text)), 'and the owners hear that it’s used up');
  wl.update('w-acme', { sesLimit: 500 }, 'op@test');
  check(wl.sesGate(uws, 30, 'u-2').ok, 'a raised limit applies at once');
  const r = wl.saveRules(uws, [{ userId: 'u-3', boosted: false }], 'u-0', 10 * GB);
  check(r.ok && !wl.sesGate(uws, 1, 'u-3').ok && wl.sesGate(uws, 1, 'u-3').why === 'off' && wl.sesGate(uws, 1, 'u-4').ok, 'someone Boosted sending is switched off for sends from our server; everyone else still Boosted');
  check(!wl.saveRules(uws, [{ userId: 'u-3', ai: 11 }], 'u-0', 10 * GB).ok, 'a share of AI can’t be more than the company has');
  check(!wl.saveRules(uws, [{ userId: 'u-3', storageGB: 6 }, { userId: 'u-4', storageGB: 6 }], 'u-0', 10 * GB).ok, 'storage caps can’t add up to more than there is');
  check(!wl.saveRules(uws, [{ userId: 'u-stranger', aiOn: false }], 'u-0', 10 * GB).ok, 'rules only for people on the team');
  check(wl.reserve(100 * GB) === 20 * GB && wl.reserve(1000 * GB) === 100 * GB, 'the disk’s safety reserve: 20 GB, or 10% on a bigger disk');
  check(billing.creditsBlocked(true, uws) !== null && 'error' in billing.orderCredits(uws, 1000, 'u-0'), 'no Boosted credits to buy on Unlimited');
  const back = wl.restoredPlan(wl.remove('w-acme'), 'Acme');
  check(JSON.stringify(back) === JSON.stringify(free) && !wl.entry('w-acme') && !wl.rules('w-acme').length, 'taken off, the old plan comes back and the rules go');
}

/* ---------- 2. end to end ---------- */
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
const dir = mkdtempSync(join(tmpdir(), 's2g-whitelist-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
// A disk of 100 GB with its 20 GB reserve and 40 MB more free: Unlimited companies have 40 MB to upload into.
const DISK_FREE = 20 * GB + 40 * MB;
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  S2G_OPERATORS: 'bayu@elkiyagroup.com',
  S2G_FAKE_DISK: `${100 * GB},${DISK_FREE}`,
  SUPPORT_EMAIL: 'support@s2g-check.test',
  PUBLIC_URL: '',
  RECORDER_URL: '',
};
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
const finish = (code) => {
  server.kill('SIGTERM');
  for (const d of [dir, unitDir])
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the server may still hold a file for a moment */
    }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 180_000).unref();

try {
  for (let i = 0; i < 300 && !/sprint2go on http/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  check(/sprint2go on http/.test(log), 'the server starts');
  if (!/sprint2go on http/.test(log)) finish(1);

  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const base = `http://127.0.0.1:${httpPort}`;
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.SEED_PASSWORD }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body, headers = {}) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    const asJson = async (x) => ({ status: x.status, body: await x.json().catch(() => ({})) });
    return {
      ok: r.ok && cookie.startsWith('s2g='),
      token: cookie.slice(4),
      get: (path) => call('GET', path).then(asJson),
      post: (path, body, headers) => call('POST', path, body, headers).then(asJson),
      sync: (coll, upserts) => call('POST', '/api/sync', { coll, upserts, deletes: [] }).then(asJson),
    };
  };
  const operator = async (email, role) => {
    if (role) db.prepare('INSERT INTO operators (email, role, added_by, added_at, totp_on) VALUES (?, ?, ?, ?, 1)').run(email, role, 'test', now());
    else db.prepare('UPDATE operators SET totp_on = 1 WHERE email = ?').run(email);
    const s = await signIn(email);
    db.prepare('UPDATE sessions SET op_ok = ? WHERE token = ?').run(now(), createHash('sha256').update(s.token).digest('hex'));
    return s;
  };
  const op = await operator('bayu@elkiyagroup.com'); // owner operator (S2G_OPERATORS)
  const support = await operator('dimas@elkiyagroup.com', 'support');
  const aqeel = await signIn('aqeel@pixelandprofits.com'); // owner of Pixel & Profits
  const aditya = await signIn('aditya@pixelandprofits.com'); // admin
  const rizky = await signIn('rizky@pixelandprofits.com'); // member
  const dewi = await signIn('dewi@pixelandprofits.com'); // member
  check(op.ok && support.ok && aqeel.ok && aditya.ok && rizky.ok && dewi.ok, 'operators, owner, admin and members sign in');
  const audit = async () => (await op.get('/api/admin/audit')).body.entries ?? [];
  const notices = (userId) => db.prepare("SELECT data FROM docs WHERE coll = 'notices'").all().map((r) => JSON.parse(r.data)).filter((n) => n.userId === userId);

  /* operator-only */
  check((await dewi.get('/api/admin/whitelist')).status >= 401, 'someone who isn’t an operator can’t see the Whitelist');
  check((await aqeel.post('/api/admin/whitelist/add', { workspaceId: 'pnp', aiLimit: 1, sesLimit: 1 })).status >= 401 && !doc('workspaces', 'pnp').plan.unlimited, 'nor put their own company on it');
  check((await aqeel.sync('workspaces', [{ ...doc('workspaces', 'elk'), plan: { ...doc('workspaces', 'elk').plan, unlimited: true } }])) && !doc('workspaces', 'elk').plan.unlimited, 'the app can’t make a plan Unlimited');
  const supView = await support.get('/api/admin/whitelist');
  check(supView.status === 200 && supView.body.can === false, 'a support operator sees the list but can’t change it');
  check((await support.post('/api/admin/whitelist/add', { workspaceId: 'pnp', aiLimit: 1, sesLimit: 1 })).status === 403, 'and adding is refused');

  /* finding a company */
  for (const q of ['pixel', 'pixelandprofits.com', 'aqeel@pixelandprofits.com']) {
    const f = await op.get(`/api/admin/whitelist/find?q=${encodeURIComponent(q)}`);
    check(f.body.results?.some((x) => x.id === 'pnp'), `found by ${q.includes('@') ? 'owner email' : q.includes('.') ? 'domain' : 'name'}`);
  }

  /* adding */
  const prevPlan = doc('workspaces', 'pnp').plan;
  const add = await op.post('/api/admin/whitelist/add', { workspaceId: 'pnp', note: 'Seed investor', aiUnit: 'rp', aiLimit: 100_000, sesLimit: 1000 });
  const pnp = doc('workspaces', 'pnp');
  check(add.status === 200 && pnp.plan.unlimited && pnp.plan.tier === 'business' && pnp.plan.track === 'ai', 'whitelisted: the company is on Unlimited');
  check((await audit()).some((a) => a.action === 'whitelist.add' && a.target === 'pnp' && /Seed investor/.test(a.detail) && /was Small/.test(a.detail)), 'in the audit log, with the plan it had');
  check((await op.post('/api/admin/whitelist/add', { workspaceId: 'pnp', aiLimit: 1, sesLimit: 1 })).status === 409, 'it can’t be added twice');
  const list = await op.get('/api/admin/whitelist');
  const row = list.body.rows?.find((x) => x.workspaceId === 'pnp');
  check(row?.note === 'Seed investor' && row.aiLimit === 100_000 && row.aiUnit === 'rp' && row.sesLimit === 1000 && row.owner?.email, 'the list shows the note, the limits and the owner');
  check(!(await op.get('/api/admin/whitelist/find?q=pixel')).body.results?.some((x) => x.id === 'pnp'), 'and the search no longer offers it');
  check((await op.post('/api/admin/company/plan', { id: 'pnp', tier: 'studio' })).status === 409, 'its plan is the Whitelist’s: the company page can’t change it');

  /* every limit lifted */
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `wl-box-${i}`, email: `box${i}@pixelandprofits.com`, name: `Box ${i}`, kind: 'personal', connected: true, users: ['u-aqeel'] }));
  await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), accounts: [...doc('workspaces', 'pnp').accounts, ...many] }]);
  check(doc('workspaces', 'pnp').accounts.filter((a) => a.id.startsWith('wl-box-')).length === 25, '25 more hosted mailboxes are kept');
  const meet = await aqeel.get('/api/meet/status?ws=pnp');
  check(meet.body.minutes && meet.body.minutes.total === null && meet.body.minutes.left === null, 'the notetaker has no hour limit');
  const room = await aqeel.get('/api/storage?workspaceId=pnp');
  check(room.status === 200 && room.body.left === 40 * MB && room.body.total === room.body.used + 40 * MB, 'storage: what the disk has above its safety reserve');
  const upload = (who, bytes, name = 'file.bin') => who.post('/api/upload', new Uint8Array(bytes), { 'content-type': 'application/octet-stream', 'x-file-name': name, 'x-workspace': 'pnp' });
  check((await upload(aditya, 5 * MB)).status === 200, 'a 5 MB upload goes in');
  const tooBig = await upload(aditya, 45 * MB);
  check(tooBig.status === 413 && /nearly full, so uploads are stopped/.test(tooBig.body.error), 'one that would eat into the reserve stops with a plain message');
  check(!!db.prepare("SELECT 1 FROM alerts_sent WHERE kind = 'unlimited:disk'").get(), 'and the operators are told');
  await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, tier: 'free', paused: true, unlimited: false } }]);
  check(doc('workspaces', 'pnp').plan.unlimited && !doc('workspaces', 'pnp').plan.paused && doc('workspaces', 'pnp').plan.tier === 'business', 'the app can’t pause it, change it or take it off Unlimited');

  /* no bills */
  check((await op.post('/api/admin/invoice/create', { workspaceId: 'pnp' })).status === 409, 'no invoice can be made for it');
  await op.post('/api/admin/invoice/generate', {});
  check(!db.prepare("SELECT 1 FROM invoices WHERE workspace_id = 'pnp'").get(), 'the month’s invoice run leaves it out');
  check((await aqeel.post('/api/billing/coupon', { workspaceId: 'pnp', code: 'ANY' })).status === 409, 'no code to apply');
  check((await aqeel.post('/api/mail/credits', { workspaceId: 'pnp', pack: 1000 })).status >= 400 && !db.prepare("SELECT 1 FROM credit_orders WHERE workspace_id = 'pnp'").get(), 'no Boosted credits to buy');

  /* not counted as revenue */
  const companies = (await op.get('/api/admin/companies')).body.companies;
  const c = companies.find((x) => x.id === 'pnp');
  check(c.state === 'unlimited' && c.mrr === 0 && c.plan.unlimited, 'its MRR is 0 and its state is Unlimited');
  const rev = (await op.get('/api/admin/revenue')).body;
  check(rev.unlimited === 1 && !rev.companies.some((x) => x.id === 'pnp') && !('Business AI' in rev.byTier) && rev.mrr === companies.filter((x) => !x.internal).reduce((n, x) => n + x.mrr, 0), 'revenue leaves it out and counts it on its own line');
  const today = (await op.get('/api/admin/today')).body.kpis;
  check(today.unlimited === 1, 'Today counts it on its own');

  /* AI: the monthly limit, 80% and 100% */
  const useAI = (userId, outTokens) =>
    db.prepare("INSERT INTO ai_usage (workspace_id, user_id, job, provider, model, in_tokens, out_tokens, at, via) VALUES ('pnp', ?, 'summary', 'included', 'gpt-5', 0, ?, ?, 'openai')").run(userId, outTokens, now());
  useAI('u-faisal', 1_000_000);
  const used = (await aqeel.get('/api/unlimited?ws=pnp')).body.ai.used;
  check(used > 0, `AI on our keys is counted (${Math.round(used)} rupiah)`);
  await op.post('/api/admin/whitelist/update', { workspaceId: 'pnp', aiLimit: Math.ceil(used / 0.85) });
  check((await audit()).some((a) => a.action === 'whitelist.update' && a.target === 'pnp' && /AI Rp/.test(a.detail)), 'a changed limit is in the audit log');
  const ask = (who) => who.post('/api/ai/summarize', { workspaceId: 'pnp', thread: { subject: 'Hi', messages: [{ from: 'a', body: 'b' }] } });
  const r85 = await ask(dewi);
  check(r85.status !== 429, 'at 85% AI still runs');
  check(!!db.prepare("SELECT 1 FROM whitelist_alerts WHERE workspace_id = 'pnp' AND meter = 'ai' AND level = 80").get(), '80% is noted');
  check(notices('u-aqeel').some((n) => /80% of this month’s AI/.test(n.text)) && notices('u-faisal').some((n) => /80% of this month’s AI/.test(n.text)) && !notices('u-dewi').some((n) => /80% of this month’s AI/.test(n.text)), 'the owners hear it (members don’t)');
  check(!!db.prepare("SELECT 1 FROM alerts_sent WHERE kind LIKE 'unlimited:pnp:ai:80:%'").get() && notices('u-bayu').some((n) => /used 80% of this month’s AI/.test(n.text)), 'and the operators, through their alerts');
  await op.post('/api/admin/whitelist/update', { workspaceId: 'pnp', aiLimit: Math.floor(used * 0.9) });
  const r100 = await ask(dewi);
  check(r100.status === 429 && r100.body.error === 'This month’s AI is used up. Ask your admin.', 'at 100% AI pauses with a plain message');
  check(notices('u-aqeel').some((n) => /AI is paused until the 1st/.test(n.text)), 'the owners hear that it’s paused');
  check((await aqeel.get('/api/meet/status?ws=pnp')).body.minutes?.total === null && (await upload(aditya, 1 * MB)).status === 200, 'everything else keeps working');
  await op.post('/api/admin/whitelist/update', { workspaceId: 'pnp', aiLimit: Math.ceil(used * 3) });
  check((await ask(dewi)).status !== 429, 'a raised limit applies at once');

  /* each person's rules */
  const view = await aqeel.get('/api/unlimited?ws=pnp');
  check(view.status === 200 && view.body.canManage && view.body.people.length === doc('workspaces', 'pnp').members.length, 'owners see everyone’s use');
  check((await rizky.post('/api/unlimited/rules', { workspaceId: 'pnp', rules: [{ userId: 'u-rizky', aiOn: true, ai: 1 }] })).status === 403, 'a member can’t set rules');
  const share = Math.round(used * 0.5);
  check((await aditya.post('/api/unlimited/rules', { workspaceId: 'pnp', rules: [{ userId: 'u-rizky', ai: Math.ceil(used * 4) }] })).status === 400, 'a share can’t be more than the company’s limit');
  check((await aditya.post('/api/unlimited/rules', { workspaceId: 'pnp', rules: [{ userId: 'u-rizky', storageGB: 50 }] })).status === 400, 'a storage cap can’t be more than there is');
  const set = await aditya.post('/api/unlimited/rules', { workspaceId: 'pnp', rules: [{ userId: 'u-rizky', ai: share, storageGB: 0.01 }, { userId: 'u-dewi', aiOn: false, notetaker: false }] });
  check(set.status === 200, 'an admin sets a share of AI and a storage cap for one person, and switches AI and the notetaker off for another');
  check((await ask(rizky)).status !== 429, 'within his share Rizky’s AI runs');
  useAI('u-rizky', Math.ceil(1_000_000 * 0.45));
  await ask(rizky);
  check(notices('u-rizky').some((n) => /80% of your AI for this month/.test(n.text)) && notices('u-aditya').some((n) => /Rizky Pratama used 80% of their AI/.test(n.text)), 'at 80% of his share he and the admins hear it');
  useAI('u-rizky', 1_000_000);
  const rz = await ask(rizky);
  check(rz.status === 429 && rz.body.error === 'Your AI for this month is used up. Ask your admin.', 'at 100% of his share his AI pauses, with a plain message');
  check(notices('u-rizky').some((n) => /Your AI for this month .* is used up/.test(n.text)), 'and he hears it');
  check((await ask(aqeel)).status !== 429, 'others keep theirs');
  const d1 = await ask(dewi);
  check(d1.status === 403 && /AI is switched off for you/.test(d1.body.error), 'AI switched off: a plain message');
  const bot = await dewi.post('/api/meet/bot', { meeting: { id: 'm-wl-test', workspaceId: 'pnp', title: 'Call', url: 'https://meet.google.com/abc-defg-hij' } });
  check(bot.status === 403 && /notetaker is switched off for you/.test(bot.body.error), 'the notetaker switched off: a plain message');
  check((await upload(rizky, 8 * MB)).status === 200, 'Rizky uploads within his cap');
  const capped = await upload(rizky, 4 * MB);
  check(capped.status === 413 && /more than your storage allows/.test(capped.body.error), 'past his cap: a plain message');
  check((await upload(aqeel, 4 * MB)).status === 200, 'people without a cap share what’s left');

  /* the AI page: never in the verdict */
  const ai = (await op.get('/api/admin/ai')).body;
  check(ai.money?.unlimited?.some((x) => x.id === 'pnp' && x.cost > 0) && !ai.money.losing.some((x) => x.id === 'pnp') && !ai.money.other.some((x) => x.id === 'pnp'), 'the AI page shows its cost on its own line, outside the verdict');

  /* taking it off */
  const off = await op.post('/api/admin/whitelist/remove', { workspaceId: 'pnp' });
  const after = doc('workspaces', 'pnp').plan;
  check(off.status === 200 && JSON.stringify(after) === JSON.stringify(prevPlan), 'taken off: the plan it had comes back');
  check((await audit()).some((a) => a.action === 'whitelist.remove' && a.target === 'pnp'), 'in the audit log');
  check(!db.prepare("SELECT 1 FROM whitelist_rules WHERE workspace_id = 'pnp'").get() && (await aqeel.get('/api/unlimited?ws=pnp')).status === 404, 'its rules are gone');
  check((await op.get('/api/admin/companies')).body.companies.find((x) => x.id === 'pnp').state === 'paying', 'and it counts as paying again');
  check((await support.post('/api/admin/whitelist/remove', { workspaceId: 'elk' })).status === 403, 'a support operator can’t take anyone off either');
  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} failed` : '\nWhitelist checks passed');
finish(failed ? 1 : 0);
