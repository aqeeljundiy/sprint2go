// Security and billing, end to end: starts the server (not production, demo data, throwaway data folder, free ports,
// a local SMTP sink as "the world"), signs in as the demo's owner (Aqeel), a member (Dewi) and a guest (Nadia at
// KopiKita), and checks on the server what each may see and change:
//  1. projects: a member sees only the projects she's on, and nothing inside the others, until the company lets her
//  2. guests, notices and chat: who may add guests, whom a notice reaches, and someone else's message
//  3. files: a guest opens only files on something she can see
//  4. a paused plan: read-only for everyone, owners can resume, 3 months a year at most
//  5. plan limits: hosted mailboxes, the notetaker's hours, Boosted credits only by invoice and only where Boosted exists
//  6. WhatsApp: the webhook reads only posts Meta signed with the app's secret
//  7. DKIM: an invite answer, an out-of-office answer and a routing test all leave signed for their domain
//  8. files in projects a member can't see stay closed to her, even with the address
//  9. support: operators with the support permission open what customers attach, in the audit log
// 10. invoices bill the people who were active that month, and say so
// 11. the company's time zone: only admins set it, only zones the clock knows
// 12. mail: a refused send plans nothing; "Remind me if no reply" is noted when the email goes out
// 13. two-step sign-in: "Remember this device" for 30 days, signed and bound to the person, forgotten on Forget,
//     "Sign out everywhere" and a password change
//   node scripts/security-tests.mjs
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { dkimVerify } from 'mailauth';

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

const dir = mkdtempSync(join(tmpdir(), 's2g-security-'));
const [httpPort, smtpPort, sinkPort] = [await freePort(), await freePort(), await freePort()];
const sunk = [];
const sink = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  logger: false,
  onData(stream, session, cb) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => (sunk.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), raw: Buffer.concat(chunks) }), cb()));
  },
});
await new Promise((res) => sink.listen(sinkPort, '127.0.0.1', res));
const SUPPORT_DOMAIN = 'sprint2go-check.dev';
const env = {
  ...process.env,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  // Nothing outside: no SES (so no Boosted sending), no off-site copies, no Let's Encrypt; mail leaves through the sink.
  SES_KEY: '',
  SES_SECRET: '',
  MAIL_FROM: '',
  S3_BUCKET: '',
  CF_DNS_TOKEN: '',
  PUBLIC_URL: '',
  WHATSAPP_APP_SECRET: '',
  RECORDER_URL: '',
  // A real-looking support domain, so the server sends its own mail (routing tests) through the sink.
  SUPPORT_EMAIL: `support@${SUPPORT_DOMAIN}`,
  MAIL_RELAY_URL: `smtp://127.0.0.1:${sinkPort}`,
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
  sink.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server may still hold a file for a moment */
  }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 180_000).unref();

try {
  for (let i = 0; i < 300 && !/Mail: receiving/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  check(/Mail: receiving/.test(log), 'the server starts');
  if (!/Mail: receiving/.test(log)) finish(1);

  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const base = `http://127.0.0.1:${httpPort}`;
  const now = () => new Date().toISOString();
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const put = (coll, d) => db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const waitFor = async (fn, tries = 100) => {
    for (let i = 0; i < tries; i++) {
      const v = await fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  };
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.SEED_PASSWORD }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body, headers = {}) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    return {
      ok: r.ok && cookie.startsWith('s2g='),
      token: cookie.slice(4),
      get: (path) => call('GET', path),
      post: (path, body, headers) => call('POST', path, body, headers),
      del: (path, body) => call('DELETE', path, body),
      state: () => call('GET', '/api/state').then((x) => x.json()),
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
    };
  };
  // This laptop can't prove DNS or port 25 for the demo domain: say the mailboxes can send (the server checks that itself).
  const canSend = () => {
    const w = doc('workspaces', 'pnp');
    w.mailReady = { at: now(), receive: true, send: true, why: {}, mailboxes: Object.fromEntries((w.accounts ?? []).map((a) => [a.id, { receive: true, send: true }])) };
    put('workspaces', w);
  };
  const aqeel = await signIn('aqeel@pixelandprofits.com');
  const dewi = await signIn('dewi@pixelandprofits.com');
  const nadia = await signIn('nadia@kopikita.co.id');
  check(aqeel.ok && dewi.ok && nadia.ok, 'the owner, a member and a guest sign in');

  /* ---------- 1. projects ---------- */
  const secret = { id: 'c-secret', workspaceId: 'pnp', name: 'Secret launch', color: '#111', status: 'active', ownerId: 'u-aqeel', people: [{ email: 'cfo@secret.example', name: 'The CFO', role: 'approver', status: 'joined', invitedBy: 'u-aqeel', at: now() }] };
  put('clients', secret);
  put('channels', { id: 'ch-secret', workspaceId: 'pnp', kind: 'channel', name: 'secret-launch', members: ['u-aqeel'], clientId: 'c-secret', category: 'client' });
  put('messages', { id: 'msg-secret', channelId: 'ch-secret', userId: 'u-aqeel', text: 'the numbers', at: now() });
  put('meetings', { id: 'mt-secret', workspaceId: 'pnp', title: 'Secret pricing', at: now(), minutes: 30, clientId: 'c-secret', attendees: ['Aqeel'], summary: 'prices', actions: [] });
  put('drive', { id: 'dr-secret-folder', name: 'Secret', kind: 'folder', parentId: null, size: 0, modified: now(), workspaceId: 'pnp', clientId: 'c-secret' });
  put('drive', { id: 'dr-secret-file', name: 'deck.pdf', kind: 'pdf', parentId: 'dr-secret-folder', size: 10, modified: now(), workspaceId: 'pnp' });
  put('notes', { id: 'nt-secret', workspaceId: 'pnp', title: 'Plan', html: 'x', ownerId: 'u-aqeel', visibility: 'team', clientId: 'c-secret', createdAt: now(), updatedAt: now(), updatedBy: 'u-aqeel' });
  put('quotes', { id: 'q-secret', workspaceId: 'pnp', clientId: 'c-secret', status: 'draft', createdBy: 'u-aqeel' });
  put('tables', { id: 'tb-secret', workspaceId: 'pnp', name: 'Leads', color: '#111', clientId: 'c-secret', fields: [{ id: 'f1', name: 'Name', type: 'text' }], views: [], createdBy: 'u-aqeel' });
  put('rows', { id: 'rw-secret', workspaceId: 'pnp', tableId: 'tb-secret', values: { f1: 'Big client' }, order: 1 });
  const ids = (s) => ({
    clients: s.clients.some((c) => c.id === 'c-secret'),
    channels: s.channels.some((c) => c.id === 'ch-secret'),
    messages: s.messages.some((m) => m.id === 'msg-secret'),
    meetings: s.meetings.some((m) => m.id === 'mt-secret'),
    drive: s.drive.some((d) => d.id === 'dr-secret-file'),
    notes: s.notes.some((n) => n.id === 'nt-secret'),
    quotes: s.quotes.some((q) => q.id === 'q-secret'),
    tables: s.tables.some((t) => t.id === 'tb-secret'),
    rows: s.rows.some((r) => r.id === 'rw-secret'),
  });
  const owner1 = ids(await aqeel.state());
  check(Object.values(owner1).every(Boolean), `the owner sees the project and everything in it (${JSON.stringify(owner1)})`);
  const member1 = ids(await dewi.state());
  check(Object.values(member1).every((v) => !v), `a member who isn't on it sees none of it (${JSON.stringify(member1)})`);
  check(!(await dewi.state()).users.some((u) => u.email === 'cfo@secret.example'), 'nor its guests’ names');
  const poke = await dewi.sync('clients', [{ ...secret, name: 'Mine now' }]);
  check(poke.saved === 0 && doc('clients', 'c-secret').name === 'Secret launch', 'she can’t change it either');
  const pnp = doc('workspaces', 'pnp');
  await aqeel.sync('workspaces', [{ ...pnp, permissions: { ...(pnp.permissions ?? {}), seeAllProjects: true } }]);
  const member2 = ids(await dewi.state());
  check(member2.clients && member2.channels && member2.meetings && member2.drive && member2.tables, 'with “See every project” on, she sees it');
  const pnp2 = doc('workspaces', 'pnp');
  await aqeel.sync('workspaces', [{ ...pnp2, permissions: { ...(pnp2.permissions ?? {}), seeAllProjects: false, inviteGuests: false } }]);

  /* ---------- 2. guests, notices, chat ---------- */
  put('clients', { id: 'c-team', workspaceId: 'pnp', name: 'Team project', color: '#222', status: 'active', ownerId: 'u-aqeel', members: [{ userId: 'u-dewi', role: 'member', addedBy: 'u-aqeel', at: now() }], people: [] });
  const added = await dewi.sync('clients', [{ ...doc('clients', 'c-team'), people: [{ email: 'friend@outside.example', name: 'Friend', role: 'approver', status: 'joined', invitedBy: 'u-dewi', at: now() }] }]);
  check(doc('clients', 'c-team').people.length === 0 && /Lead/.test(added.why ?? ''), 'without “Invite guests”, a member can’t make someone a guest (and is told why)');
  const outsider = await dewi.sync('notices', [{ id: 'n-x', userId: 'u-dimas', workspaceId: 'pnp', kind: 'team', text: 'click this', at: now(), read: false, url: 'https://evil.example' }]);
  check(outsider.saved === 0 && !doc('notices', 'n-x'), 'a notice can’t go to someone outside the company');
  await dewi.sync('notices', [{ id: 'n-y', userId: 'u-rizky', workspaceId: 'pnp', kind: 'team', text: 'hi', at: now(), read: false, url: 'https://evil.example' }]);
  check(doc('notices', 'n-y') && !doc('notices', 'n-y').url, 'a notice links only inside the app');
  put('channels', { id: 'ch-both', workspaceId: 'pnp', kind: 'channel', name: 'both', members: ['u-aqeel', 'u-dewi'] });
  put('messages', { id: 'msg-aqeel', channelId: 'ch-both', userId: 'u-aqeel', text: 'I said this', at: now() });
  await dewi.sync('messages', [{ ...doc('messages', 'msg-aqeel'), text: 'I said something else', reactions: { '👍': ['u-dewi'] } }]);
  const m = doc('messages', 'msg-aqeel');
  check(m.text === 'I said this' && m.reactions?.['👍']?.[0] === 'u-dewi', 'someone else’s message: a reaction yes, its words no');
  await dewi.sync('messages', [], ['msg-aqeel']);
  check(!!doc('messages', 'msg-aqeel'), 'and she can’t delete it');

  /* ---------- 3. files ---------- */
  const up = await aqeel.post('/api/upload', 'internal numbers', { 'content-type': 'text/plain', 'x-file-name': 'numbers.txt', 'x-workspace': 'pnp' }).then((r) => r.json());
  const guestGet = () => nadia.get(up.url).then((r) => r.status);
  check((await guestGet()) === 404, 'a guest can’t open the company’s other files, even with the address');
  put('drive', { id: 'dr-shared', name: 'numbers.txt', kind: 'doc', parentId: null, size: 16, modified: now(), workspaceId: 'pnp', clientId: 'c-kopikita', sharedWithClient: true, url: up.url });
  check((await guestGet()) === 200, 'once it’s shared with her project, she can');

  /* ---------- 4. pausing ---------- */
  const paused = await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, paused: true } }]);
  check(doc('workspaces', 'pnp').plan.paused === true && doc('workspaces', 'pnp').plan.pauses?.length === 1 && !paused.why, 'an owner pauses the plan, and the server notes when');
  const todo = await dewi.sync('todos', [{ id: 'td-paused', title: 'new work', userId: 'u-dewi', workspaceId: 'pnp', done: false, createdAt: now() }]);
  check(todo.saved === 0 && /paused/.test(todo.why ?? ''), 'a paused company is read-only for its members, with the reason');
  const guestMsg = await nadia.sync('messages', [{ id: 'msg-guest-paused', channelId: 'ch-kopikita-shared', userId: 'guest', guestEmail: 'nadia@kopikita.co.id', text: 'hello', at: now() }]);
  check(guestMsg.saved === 0, 'and for its guests');
  const ai = await dewi.post('/api/ai/summarize', { workspaceId: 'pnp', thread: { subject: 'x', messages: [] } });
  check(ai.status === 403, 'no AI while paused');
  const upl = await dewi.post('/api/upload', 'x', { 'content-type': 'text/plain', 'x-file-name': 'x.txt', 'x-workspace': 'pnp' });
  check(upl.status === 403, 'no uploads while paused');
  canSend();
  const mail = await aqeel.post('/api/mail/send', { workspaceId: 'pnp', accountId: 'pnp-aqeel', threadId: '', messageId: 'm-p', to: [{ name: 'X', email: 'x@outside.example' }], cc: [], subject: 'paused', text: 'x', files: [] });
  check(mail.status === 403 && /paused/.test((await mail.json()).error ?? ''), `no mail goes out while paused (${mail.status})`);
  const st = await dewi.state();
  check(st.todos.length > 0 && st.clients.length > 0, 'everyone still reads everything');
  await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, paused: false } }]);
  const resumed = doc('workspaces', 'pnp').plan;
  check(!resumed.paused && !!resumed.pauses?.[0]?.to, 'the owner resumes it');
  // 90 days already used this year: no more pausing.
  put('workspaces', { ...doc('workspaces', 'pnp'), plan: { ...resumed, pauses: [{ from: new Date(Date.now() - 200 * 86_400_000).toISOString(), to: new Date(Date.now() - 105 * 86_400_000).toISOString() }] } });
  const again = await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, paused: true } }]);
  check(!doc('workspaces', 'pnp').plan.paused && /3 months a year/.test(again.why ?? ''), 'after 3 months of pauses in a year, the plan can’t be paused again');
  const adminTry = await signIn('aditya@pixelandprofits.com');
  const byAdmin = await adminTry.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, addons: { ...doc('workspaces', 'pnp').plan.addons, branding: true } } }]);
  check(!doc('workspaces', 'pnp').plan.addons.branding && /owners/.test(byAdmin.why ?? ''), 'an admin who isn’t an owner can’t change the plan');

  /* ---------- 5. plan limits ---------- */
  const ws = doc('workspaces', 'pnp');
  const extra = Array.from({ length: 10 }, (_, i) => ({ id: `extra-${i}`, email: `extra${i}@pixelandprofits.com`, name: `Extra ${i}`, kind: 'personal', connected: false, users: [] }));
  const boxes = await aqeel.sync('workspaces', [{ ...ws, accounts: [...ws.accounts, ...extra] }]);
  check(!doc('workspaces', 'pnp').accounts.some((a) => a.id === 'extra-0') && /room for/.test(boxes.why ?? ''), 'more hosted mailboxes than the plan has room for are refused, with the reason');
  const status = await aqeel.get('/api/meet/status?ws=pnp').then((r) => r.json());
  check(status.minutes?.total === (4 * 7 + 10) * 60, `the notetaker’s hours this month come from the plan and add-ons (${status.minutes?.total} minutes)`);
  const credits = await aqeel.post('/api/mail/credits', { workspaceId: 'pnp', pack: 1000 });
  const before = doc('workspaces', 'pnp').mailCredits ?? 0;
  check(credits.status === 409 && (doc('workspaces', 'pnp').mailCredits ?? 0) === before, 'without Boosted sending on this server there are no credits to buy, and none appear');
  const setup = await aqeel.get('/api/mail/setup?ws=pnp').then((r) => r.json());
  check(setup.boostedAvailable === false && !!setup.creditOrders?.blocked, 'Email delivery says why');
  const route = await aqeel.post('/api/mail/route', { workspaceId: 'pnp', route: 'boosted' });
  check(route.status === 409, 'and Boosted can’t be switched on');

  /* ---------- 6. WhatsApp ---------- */
  const appSecret = randomBytes(16).toString('hex');
  const connect = await aqeel.post('/api/whatsapp/connect', { workspaceId: 'pnp', phoneNumberId: '1039000001', token: 'EAAG' + 'x'.repeat(40), appSecret });
  check(connect.ok && doc('workspaces', 'pnp').whatsapp?.secured === true, 'WhatsApp connects with the app’s secret');
  const verifyToken = doc('workspaces', 'pnp').whatsapp.verifyToken;
  const hook = `${base}/api/whatsapp/webhook`;
  const challenge = await fetch(`${hook}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=4242`).then(async (r) => [r.status, await r.text()]);
  check(challenge[0] === 200 && challenge[1] === '4242', 'Meta’s check passes with the verify token');
  const wrongToken = await fetch(`${hook}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
  check(wrongToken.status === 403, 'and fails with any other token');
  const payload = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1039000001' }, contacts: [{ wa_id: '6281234', profile: { name: 'Stranger' } }], messages: [{ from: '6281234', type: 'text', text: { body: `hello ${randomBytes(3).toString('hex')}` }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
  const sign = (body, key) => 'sha256=' + createHmac('sha256', key).update(body).digest('hex');
  const whatsappNotices = () => db.prepare("SELECT COUNT(*) AS n FROM docs WHERE coll = 'notices' AND data LIKE '%WhatsApp from%'").get().n;
  const n0 = whatsappNotices();
  const unsigned = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
  const forged = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(payload, 'not-the-secret') }, body: payload });
  check(unsigned.status === 401 && forged.status === 401 && whatsappNotices() === n0, 'unsigned and wrongly signed posts are refused and nothing is read');
  const real = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(payload, appSecret) }, body: payload });
  check(real.status === 200 && (await waitFor(() => whatsappNotices() > n0, 20)), 'a post Meta signed is read');
  put('workspaces', { ...doc('workspaces', 'elk'), whatsapp: { phoneNumberId: '1039000002', connected: true, verifyToken: 'elk-token-123' } });
  const off = await fetch(`${hook}?hub.mode=subscribe&hub.verify_token=elk-token-123&hub.challenge=1`);
  check(off.status === 403, 'a company without an app secret: the webhook stays off');
  const hijack = await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), whatsapp: { phoneNumberId: '1039000002', connected: true, verifyToken: 'mine' } }]);
  check(doc('workspaces', 'pnp').whatsapp.phoneNumberId === '1039000001' && hijack.status === 200, 'the connection only changes through the server');

  /* ---------- 7. DKIM on everything our engine sends ---------- */
  const resolver = async (name, type) => {
    const m2 = /^s2g\._domainkey\.(.+)$/.exec(name);
    const row = m2 && type === 'TXT' ? db.prepare('SELECT public_key FROM mail_domains WHERE domain = ?').get(m2[1]) : null;
    if (row) return [[`v=DKIM1; k=rsa; p=${row.public_key}`]];
    throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  };
  const signedBy = async (raw) => (await dkimVerify(raw, { resolver })).results.filter((r) => r.status?.result === 'pass').map((r) => r.signingDomain);
  const smtp = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, tls: { rejectUnauthorized: false } });
  // An invite from outside, answered Yes: the iCalendar REPLY goes to the organiser.
  const inviteSubject = `invite ${randomBytes(3).toString('hex')}`;
  const ics = ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT', `UID:${randomBytes(6).toString('hex')}@outside.example`, 'DTSTART:20261120T030000Z', 'DTEND:20261120T040000Z', `SUMMARY:${inviteSubject}`, 'ORGANIZER;CN=Olga:mailto:olga@organiser.example', 'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:aqeel@pixelandprofits.com', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  canSend();
  await smtp.sendMail({ from: 'Olga <olga@organiser.example>', to: 'aqeel@pixelandprofits.com', subject: inviteSubject, text: 'Join us', icalEvent: { method: 'REQUEST', content: ics } });
  const inviteThread = await waitFor(() => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${inviteSubject}%`).map((r) => JSON.parse(r.data)).find((t) => t.accountId === 'pnp-aqeel' && t.messages.some((x) => x.invite)));
  canSend();
  const rsvp = inviteThread ? await aqeel.post('/api/mail/invite', { threadId: inviteThread.id, messageId: inviteThread.messages.find((x) => x.invite).id, answer: 'accepted' }) : null;
  const reply = await waitFor(() => sunk.find((x) => x.to.includes('olga@organiser.example') && x.raw.includes('METHOD:REPLY')));
  check(rsvp?.ok && !!reply && (await signedBy(reply.raw)).includes('pixelandprofits.com'), 'an invite answer leaves DKIM-signed for pixelandprofits.com (and verifies)');
  // Out of office: the automatic answer.
  canSend();
  const away = await aqeel.post('/api/mail/away', { workspaceId: 'pnp', accountId: 'pnp-aqeel', away: { on: true, subject: 'Away', message: 'Back on Monday.' } });
  canSend();
  await smtp.sendMail({ from: 'Ben <ben@writer.example>', to: 'aqeel@pixelandprofits.com', subject: `question ${randomBytes(3).toString('hex')}`, text: 'Are you there?' });
  const auto = await waitFor(() => sunk.find((x) => x.to.includes('ben@writer.example')));
  check(away.ok && !!auto && /Auto-Submitted: auto-replied/i.test(auto.raw.toString()) && (await signedBy(auto.raw)).includes('pixelandprofits.com'), 'an out-of-office answer leaves DKIM-signed too');
  // A routing test ("Some of each"): our own mail, signed with the platform's key for the support domain.
  const probe = await aqeel.post('/api/mail/routing-test', { workspaceId: 'pnp' });
  const probeMail = await waitFor(() => sunk.find((x) => x.to.some((t) => t.startsWith('s2g-check-'))));
  check(probe.ok && !!probeMail && (await signedBy(probeMail.raw)).includes(SUPPORT_DOMAIN), `a routing test leaves DKIM-signed for ${SUPPORT_DOMAIN}`);

  /* ---------- 8. files in projects a member can't see ---------- */
  const upload = (who, text, ws = 'pnp', name = 'notes.txt') => who.post('/api/upload', text, { 'content-type': 'text/plain', 'x-file-name': name, 'x-workspace': ws }).then((r) => r.json());
  const secretFile = await upload(aqeel, 'the secret numbers', 'pnp', 'secret.txt');
  put('drive', { id: 'dr-secret-numbers', name: 'secret.txt', kind: 'doc', parentId: 'dr-secret-folder', size: 18, modified: now(), workspaceId: 'pnp', url: secretFile.url });
  const opensWith = (who, u) => who.get(u).then((r) => r.status);
  check((await opensWith(dewi, secretFile.url)) === 404, 'a member can’t download a file in a project she can’t see, even with the address');
  check((await opensWith(aqeel, secretFile.url)) === 200, 'the owner can');
  const inChat = await upload(aqeel, 'said in the project channel', 'pnp', 'chat.txt');
  put('messages', { id: 'msg-secret-file', channelId: 'ch-secret', userId: 'u-aqeel', text: 'here', at: now(), files: [{ name: 'chat.txt', size: 27, type: 'text/plain', url: inChat.url }] });
  check((await opensWith(dewi, inChat.url)) === 404, 'nor one sent in its channel');
  const loose = await upload(aqeel, 'on nothing yet');
  check((await opensWith(dewi, loose.url)) === 200, 'a file that isn’t on anything yet opens for the team');
  const hers = await upload(dewi, 'mine');
  put('drive', { id: 'dr-secret-hers', name: 'hers.txt', kind: 'doc', parentId: 'dr-secret-folder', size: 4, modified: now(), workspaceId: 'pnp', url: hers.url });
  check((await opensWith(dewi, hers.url)) === 200, 'her own upload always opens');
  const pnpSee = doc('workspaces', 'pnp');
  await aqeel.sync('workspaces', [{ ...pnpSee, permissions: { ...(pnpSee.permissions ?? {}), seeAllProjects: true } }]);
  check((await opensWith(dewi, secretFile.url)) === 200, 'with “See every project” on, she can');
  await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), permissions: { ...(doc('workspaces', 'pnp').permissions ?? {}), seeAllProjects: false } }]);
  check((await opensWith(nadia, secretFile.url)) === 404, 'and a guest never can');

  /* ---------- 9. support tickets: operators open what customers attach ---------- */
  const dimas = await signIn('dimas@elkiyagroup.com');
  const shot = await upload(dimas, 'a screenshot', 'elk', 'shot.txt');
  const other = await upload(dimas, 'not attached', 'elk', 'other.txt');
  const ticket = await dimas.post('/api/support', { subject: 'Something broke', body: 'See the screenshot', workspaceId: 'elk', attachments: [{ name: 'shot.txt', url: shot.url }, { name: 'someone else’s', url: secretFile.url }] }).then((r) => r.json());
  const attached = JSON.parse(db.prepare('SELECT attachments FROM ticket_messages WHERE ticket_id = ?').get(ticket.id)?.attachments ?? '[]');
  check(attached.length === 1 && attached[0].url === shot.url, 'a ticket keeps only files the customer uploaded, not another address');
  db.prepare("INSERT INTO operators (email, role, added_by, added_at, totp_on) VALUES (?, 'support', 'test', ?, 1)").run('rizky@pixelandprofits.com', now());
  const rizky = await signIn('rizky@pixelandprofits.com');
  check((await opensWith(rizky, shot.url)) === 404, 'an operator who hasn’t passed the console’s two-step sign-in can’t open it');
  db.prepare('UPDATE sessions SET op_ok = ? WHERE token = ?').run(now(), createHash('sha256').update(rizky.token).digest('hex'));
  const opens = () => db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'ticket.file-open' AND target = ? AND operator = ?").get(ticket.id, 'rizky@pixelandprofits.com').n;
  check((await opensWith(rizky, shot.url)) === 200 && opens() === 1, 'past it, a support operator opens what the customer attached, and it’s in the audit log');
  await opensWith(rizky, shot.url);
  check(opens() === 1, 'opening it again a moment later is the same entry');
  check((await opensWith(rizky, other.url)) === 404, 'the customer’s other files stay closed');
  db.prepare("UPDATE operators SET role = 'finance' WHERE email = ?").run('rizky@pixelandprofits.com');
  check((await opensWith(rizky, shot.url)) === 404, 'an operator without the support permission can’t');
  check((await opensWith(dimas, shot.url)) === 200, 'the customer still opens their own');
  // A ticket from before 9 Oct, when a ticket could point at any file: its attachment is someone else's file.
  db.prepare("UPDATE operators SET role = 'support' WHERE email = ?").run('rizky@pixelandprofits.com');
  const oldAt = '2026-10-08T09:00:00.000Z';
  db.prepare("INSERT INTO tickets (id, number, subject, status, priority, channel, requester_email, requester_name, requester_user, workspace_id, tags, created_at, updated_at) VALUES ('t-old-files', 990001, 'Old one', 'open', 'normal', 'app', 'dimas@elkiyagroup.com', 'Dimas', ?, 'elk', '[]', ?, ?)").run(db.prepare('SELECT user_id FROM logins WHERE email = ?').get('dimas@elkiyagroup.com')?.user_id ?? null, oldAt, oldAt);
  db.prepare("INSERT INTO ticket_messages (id, ticket_id, at, kind, author, author_name, body, internal, attachments) VALUES ('tm-old-files', 't-old-files', ?, 'customer', 'dimas@elkiyagroup.com', 'Dimas', 'see attached', 0, ?)").run(oldAt, JSON.stringify([{ name: 'numbers.txt', url: secretFile.url }]));
  check((await opensWith(rizky, secretFile.url)) === 404, 'an old ticket pointing at another company’s file doesn’t open it for support');
  const oldView = await rizky.get('/api/admin/ticket?id=t-old-files').then((r) => r.json());
  const shown = oldView.messages?.[0]?.attachments?.[0];
  check(!!shown && shown.url === '' && shown.blocked === 'Attachment from before 9 Oct, ask the person to send it again', 'the operator sees “Attachment from before 9 Oct, ask the person to send it again” instead of a link');
  const newView = await rizky.get(`/api/admin/ticket?id=${ticket.id}`).then((r) => r.json());
  check(newView.messages?.[0]?.attachments?.[0]?.url === shot.url && !newView.messages[0].attachments[0].blocked, 'a file sent with its ticket still links');

  /* ---------- 10. invoices bill active people ---------- */
  db.prepare("UPDATE operators SET role = 'owner' WHERE email = ?").run('rizky@pixelandprofits.com');
  const month = now().slice(0, 7);
  const pnpMembers = doc('workspaces', 'pnp').members.map((x) => x.userId);
  const activeIds = new Set(db.prepare('SELECT DISTINCT user_id FROM activity_days WHERE day >= ?').all(`${month}-01`).map((r) => r.user_id));
  const activeHere = pnpMembers.filter((id) => activeIds.has(id)).length;
  const made = await rizky.post('/api/admin/invoice/create', { workspaceId: 'pnp' }).then((r) => r.json());
  const inv = made.id ? db.prepare('SELECT lines, note FROM invoices WHERE id = ?').get(made.id) : null;
  const planLine = inv ? JSON.parse(inv.lines)[0]?.text ?? '' : '';
  check(activeHere > 0 && activeHere < pnpMembers.length && planLine.includes(`${activeHere} active ${activeHere === 1 ? 'person' : 'people'} of ${pnpMembers.length} on the team`), `the invoice bills the ${activeHere} people active this month, not all ${pnpMembers.length} (“${planLine}”)`);
  check(/signed in or used sprint2go/.test(inv?.note ?? ''), 'and says what active means');
  const billingPage = await aqeel.get('/api/billing/invoices?ws=pnp').then((r) => r.json());
  check(billingPage.active?.people === activeHere && billingPage.active?.team === pnpMembers.length, 'the billing page shows the same count');

  /* ---------- 11. the company's time zone ---------- */
  await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), timeZone: 'Europe/Amsterdam' }]);
  check(doc('workspaces', 'pnp').timeZone === 'Europe/Amsterdam', 'an owner sets the company’s time zone');
  await aqeel.sync('workspaces', [{ ...doc('workspaces', 'pnp'), timeZone: 'Mars/Olympus' }]);
  check(doc('workspaces', 'pnp').timeZone === 'Europe/Amsterdam', 'a zone the clock doesn’t know isn’t saved');
  await dewi.sync('workspaces', [{ ...doc('workspaces', 'pnp'), timeZone: 'Asia/Tokyo' }]);
  check(doc('workspaces', 'pnp').timeZone === 'Europe/Amsterdam', 'a member can’t change it');

  /* ---------- 12. mail: refused sends and reply reminders ---------- */
  const reminders = (threadId) => db.prepare('SELECT * FROM mail_remind WHERE thread_id = ?').all(threadId);
  const w12 = doc('workspaces', 'pnp');
  put('workspaces', { ...w12, mailReady: { at: now(), receive: true, send: false, why: {}, mailboxes: {} } });
  const tracked = (threadId) => ({ workspaceId: 'pnp', accountId: 'pnp-aqeel', threadId, messageId: 'm-1', to: [{ name: 'Budi', email: 'budi@client-check.example' }], cc: [], subject: 'Proposal', text: 'Here it is', html: '<p>Here it is</p>', files: [], track: true, trackOptions: { opens: true, clicks: true, notify: true, remindDays: 3 } });
  const refused = await aqeel.post('/api/mail/send', tracked('t-refused'));
  check(refused.status === 409 && !!(await refused.json()).error && reminders('t-refused').length === 0, `a send the mailbox can’t do is refused with the reason, and nothing is planned (${refused.status})`);
  canSend();
  const sent = await aqeel.post('/api/mail/send', tracked('t-remind'));
  const rem = reminders('t-remind')[0];
  const days = rem ? (Date.parse(rem.due_at) - Date.now()) / 86_400_000 : 0;
  check(sent.ok && rem?.by_user === 'u-aqeel' && rem.state === 'waiting' && days > 2.9 && days <= 3, 'a tracked email with “Remind me if no reply” is noted on the server, three days out');

  /* ---------- 13. two-step sign-in: "Remember this device" ---------- */
  {
    // A TOTP code (RFC 6238) for a base32 secret, `ahead` 30-second steps from now.
    const totp = (secret, ahead = 0) => {
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = '';
      for (const ch of secret.replace(/[\s=]/g, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0');
      const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
      const msg = Buffer.alloc(8);
      msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + ahead));
      const h = createHmac('sha1', key).update(msg).digest();
      const o = h[h.length - 1] & 0xf;
      return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
    };
    /** A sign-in with the password and whatever device cookie this browser has: the session, the device cookie, the answer. */
    const login = async (email, device, password = env.SEED_PASSWORD) => {
      const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(device ? { cookie: `s2g_dev=${device}` } : {}) }, body: JSON.stringify({ email, password }) });
      const jar = Object.fromEntries(r.headers.getSetCookie().map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]));
      return { status: r.status, body: await r.json(), session: jar.s2g, device: jar.s2g_dev };
    };
    const as = (session, device) => (method, path, b) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie: [`s2g=${session}`, ...(device ? [`s2g_dev=${device}`] : [])].join('; ') }, body: b === undefined ? undefined : JSON.stringify(b) });
    const dewiMail = 'dewi@pixelandprofits.com';
    const dewiId = db.prepare('SELECT user_id FROM logins WHERE email = ?').get(dewiMail).user_id;
    // Dewi turns two-step sign-in on.
    const first = await login(dewiMail);
    const d1 = as(first.session);
    const setup = await d1('POST', '/api/2fa/setup', {}).then((r) => r.json());
    const enabled = await d1('POST', '/api/2fa/enable', { code: totp(setup.secret) });
    check(enabled.ok, 'a member turns on two-step sign-in');
    // Next sign-in: the code, with "Remember this device".
    const second = await login(dewiMail);
    check(second.body.twoStep === 'code', 'a new sign-in asks for the code');
    const verify = await fetch(`${base}/api/2fa/verify`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `s2g=${second.session}` }, body: JSON.stringify({ code: totp(setup.secret, 1), remember: true }) });
    const deviceCookie = Object.fromEntries(verify.headers.getSetCookie().map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')])).s2g_dev;
    const setCookieLine = verify.headers.getSetCookie().find((c) => c.startsWith('s2g_dev=')) ?? '';
    check(verify.ok && !!deviceCookie && /HttpOnly/.test(setCookieLine) && /Max-Age=2592000/.test(setCookieLine), 'ticking “Remember this device” gives the browser a 30-day device cookie it can’t read from scripts');
    const third = await login(dewiMail, deviceCookie);
    const meThird = await as(third.session)('GET', '/api/me').then((r) => r.json());
    check(third.status === 200 && !third.body.twoStep && !meThird.twoStep && meThird.me === dewiId, 'that device signs in with just the password');
    const listed = await as(third.session, deviceCookie)('GET', '/api/2fa').then((r) => r.json());
    check(listed.devices?.length === 1 && listed.devices[0].current === true && /until|\d/.test(listed.devices[0].expiresAt) && Date.parse(listed.devices[0].expiresAt) - Date.now() > 29.9 * 86_400_000, 'it’s in her remembered devices, marked as this device, for 30 days');
    // The token is signed and bound to its person: changed, someone else's, or expired, it asks for the code. (Aditya,
    // so neither of them meets the 10 sign-ins a quarter hour the server allows per address.)
    const [devId, devExp] = deviceCookie.split('.');
    const master = Buffer.from(readFileSync(join(dir, 'secret.key'), 'utf8').trim(), 'base64');
    const sign = (id, userId, exp) => createHmac('sha256', master).update(`trusted-device:${id}:${userId}:${exp}`).digest('hex').slice(0, 40);
    const madeDevice = (userId, days = 30) => {
      const id = randomBytes(9).toString('hex');
      const exp = String(Math.floor((Date.now() + days * 86_400_000) / 1000));
      db.prepare('INSERT INTO trusted_devices (id, user_id, name, created_at, used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, userId, 'Test browser', now(), now(), new Date(Number(exp) * 1000).toISOString());
      return { id, token: `${id}.${exp}.${sign(id, userId, exp)}` };
    };
    const adiMail = 'aditya@pixelandprofits.com';
    const adiId = db.prepare('SELECT user_id FROM logins WHERE email = ?').get(adiMail).user_id;
    const adi = as((await login(adiMail)).session);
    const adiSetup = await adi('POST', '/api/2fa/setup', {}).then((r) => r.json());
    await adi('POST', '/api/2fa/enable', { code: totp(adiSetup.secret) });
    const adiDev = madeDevice(adiId);
    const [aId, aExp] = adiDev.token.split('.');
    check((await login(adiMail, `${aId}.${aExp}.${'0'.repeat(40)}`)).body.twoStep === 'code', 'a changed token asks for the code');
    check((await login(adiMail, deviceCookie)).body.twoStep === 'code', 'someone else’s device token doesn’t count');
    check((await login(adiMail, madeDevice(adiId, -1).token)).body.twoStep === 'code', 'an expired one asks for the code');
    check((await login(adiMail, `${deviceCookie}~${adiDev.token}`)).body.twoStep === undefined, 'a properly signed one works, next to someone else’s on the same browser');
    // Forget: that device asks again.
    const forgetOne = await as(third.session, deviceCookie)('POST', '/api/2fa/devices/forget', { id: devId });
    check(forgetOne.ok && (await login(dewiMail, deviceCookie)).body.twoStep === 'code', 'Forget: that device asks for the code again');
    // Sign out everywhere: other sessions end, every remembered device is forgotten, this session stays.
    const devA = madeDevice(dewiId);
    const keep = await login(dewiMail, devA.token);
    const other = await login(dewiMail, madeDevice(dewiId).token);
    const out = await as(keep.session)('POST', '/api/2fa/signout-everywhere', {});
    const otherMe = await as(other.session)('GET', '/api/me');
    const keepMe = await as(keep.session)('GET', '/api/me').then((r) => r.json());
    const left = db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?').get(dewiId).n;
    check(out.ok && otherMe.status === 401 && keepMe.me === dewiId && left === 0, `“Sign out everywhere” ends the other sessions and forgets every remembered device, and this one stays (${otherMe.status}, ${left} left)`);
    check((await login(dewiMail, devA.token)).body.twoStep === 'code', 'so a device remembered before asks for the code again');
    // A password change forgets them too.
    const devB = madeDevice(dewiId);
    const pw = await as(keep.session)('POST', '/api/password', { current: env.SEED_PASSWORD, next: 'a-new-password-123' });
    check(pw.ok && db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?').get(dewiId).n === 0, 'a password change forgets every remembered device');
    check((await login(dewiMail, devB.token, 'a-new-password-123')).body.twoStep === 'code', 'and the next sign-in there asks for the code');

  }
  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} failed` : '\nSecurity and billing checks passed');
finish(failed ? 1 : 0);
