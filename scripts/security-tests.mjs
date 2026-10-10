// Security and billing, end to end: starts the server (not production, demo data, throwaway data folder, free ports,
// a local SMTP sink as "the world"), signs in as the demo's owner (Raka), a member (Intan) and a guest (Laras at
// Kopinara), and checks on the server what each may see and change:
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
// 13. chat: a message sent later is its author's alone until its time, then goes out with its notices; a saved
//     message's reminder comes once
// 14. two-step sign-in: "Remember this device" for 30 days, signed and bound to the person, forgotten on Forget,
//     "Sign out everywhere" and a password change
// 15. free trials: one per person and per company domain, the reason on the plan, and one more when an operator allows it
// 16. BIMI: the logo is checked for SVG Tiny PS basics, served from a stable address in a sandbox, admins only
// 17. a project's or team's own task stages: who sets them, only lists that work, guests' approvals use them
// 18. files on a task's comments: only your own uploads on your comments; a guest opens only those on comments shared with her
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
  const raka = await signIn('raka@demo.sprint2go.com');
  const intan = await signIn('intan@demo.sprint2go.com');
  const laras = await signIn('laras@kopinara.example');
  check(raka.ok && intan.ok && laras.ok, 'the owner, a member and a guest sign in');

  /* ---------- 1. projects ---------- */
  const secret = { id: 'c-secret', workspaceId: 'pnp', name: 'Secret launch', color: '#111', status: 'active', ownerId: 'u-raka', people: [{ email: 'cfo@secret.example', name: 'The CFO', role: 'approver', status: 'joined', invitedBy: 'u-raka', at: now() }] };
  put('clients', secret);
  put('channels', { id: 'ch-secret', workspaceId: 'pnp', kind: 'channel', name: 'secret-launch', members: ['u-raka'], clientId: 'c-secret', category: 'client' });
  put('messages', { id: 'msg-secret', channelId: 'ch-secret', userId: 'u-raka', text: 'the numbers', at: now() });
  put('meetings', { id: 'mt-secret', workspaceId: 'pnp', title: 'Secret pricing', at: now(), minutes: 30, clientId: 'c-secret', attendees: ['Raka'], summary: 'prices', actions: [] });
  put('drive', { id: 'dr-secret-folder', name: 'Secret', kind: 'folder', parentId: null, size: 0, modified: now(), workspaceId: 'pnp', clientId: 'c-secret' });
  put('drive', { id: 'dr-secret-file', name: 'deck.pdf', kind: 'pdf', parentId: 'dr-secret-folder', size: 10, modified: now(), workspaceId: 'pnp' });
  put('notes', { id: 'nt-secret', workspaceId: 'pnp', title: 'Plan', html: 'x', ownerId: 'u-raka', visibility: 'team', clientId: 'c-secret', createdAt: now(), updatedAt: now(), updatedBy: 'u-raka' });
  put('quotes', { id: 'q-secret', workspaceId: 'pnp', clientId: 'c-secret', status: 'draft', createdBy: 'u-raka' });
  put('tables', { id: 'tb-secret', workspaceId: 'pnp', name: 'Leads', color: '#111', clientId: 'c-secret', fields: [{ id: 'f1', name: 'Name', type: 'text' }], views: [], createdBy: 'u-raka' });
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
  const owner1 = ids(await raka.state());
  check(Object.values(owner1).every(Boolean), `the owner sees the project and everything in it (${JSON.stringify(owner1)})`);
  const member1 = ids(await intan.state());
  check(Object.values(member1).every((v) => !v), `a member who isn't on it sees none of it (${JSON.stringify(member1)})`);
  check(!(await intan.state()).users.some((u) => u.email === 'cfo@secret.example'), 'nor its guests’ names');
  const poke = await intan.sync('clients', [{ ...secret, name: 'Mine now' }]);
  check(poke.saved === 0 && doc('clients', 'c-secret').name === 'Secret launch', 'she can’t change it either');
  const pnp = doc('workspaces', 'pnp');
  await raka.sync('workspaces', [{ ...pnp, permissions: { ...(pnp.permissions ?? {}), seeAllProjects: true } }]);
  const member2 = ids(await intan.state());
  check(member2.clients && member2.channels && member2.meetings && member2.drive && member2.tables, 'with “See every project” on, she sees it');
  const pnp2 = doc('workspaces', 'pnp');
  await raka.sync('workspaces', [{ ...pnp2, permissions: { ...(pnp2.permissions ?? {}), seeAllProjects: false, inviteGuests: false } }]);

  /* ---------- 2. guests, notices, chat ---------- */
  put('clients', { id: 'c-team', workspaceId: 'pnp', name: 'Team project', color: '#222', status: 'active', ownerId: 'u-raka', members: [{ userId: 'u-intan', role: 'member', addedBy: 'u-raka', at: now() }], people: [] });
  const added = await intan.sync('clients', [{ ...doc('clients', 'c-team'), people: [{ email: 'friend@outside.example', name: 'Friend', role: 'approver', status: 'joined', invitedBy: 'u-intan', at: now() }] }]);
  check(doc('clients', 'c-team').people.length === 0 && /Lead/.test(added.why ?? ''), 'without “Invite guests”, a member can’t make someone a guest (and is told why)');
  const outsider = await intan.sync('notices', [{ id: 'n-x', userId: 'u-yusuf', workspaceId: 'pnp', kind: 'team', text: 'click this', at: now(), read: false, url: 'https://evil.example' }]);
  check(outsider.saved === 0 && !doc('notices', 'n-x'), 'a notice can’t go to someone outside the company');
  await intan.sync('notices', [{ id: 'n-y', userId: 'u-bima', workspaceId: 'pnp', kind: 'team', text: 'hi', at: now(), read: false, url: 'https://evil.example' }]);
  check(doc('notices', 'n-y') && !doc('notices', 'n-y').url, 'a notice links only inside the app');
  put('channels', { id: 'ch-both', workspaceId: 'pnp', kind: 'channel', name: 'both', members: ['u-raka', 'u-intan'] });
  put('messages', { id: 'msg-raka', channelId: 'ch-both', userId: 'u-raka', text: 'I said this', at: now() });
  await intan.sync('messages', [{ ...doc('messages', 'msg-raka'), text: 'I said something else', reactions: { '👍': ['u-intan'] } }]);
  const m = doc('messages', 'msg-raka');
  check(m.text === 'I said this' && m.reactions?.['👍']?.[0] === 'u-intan', 'someone else’s message: a reaction yes, its words no');
  await intan.sync('messages', [], ['msg-raka']);
  check(!!doc('messages', 'msg-raka'), 'and she can’t delete it');

  /* ---------- 3. files ---------- */
  const up = await raka.post('/api/upload', 'internal numbers', { 'content-type': 'text/plain', 'x-file-name': 'numbers.txt', 'x-workspace': 'pnp' }).then((r) => r.json());
  const guestGet = () => laras.get(up.url).then((r) => r.status);
  check((await guestGet()) === 404, 'a guest can’t open the company’s other files, even with the address');
  put('drive', { id: 'dr-shared', name: 'numbers.txt', kind: 'doc', parentId: null, size: 16, modified: now(), workspaceId: 'pnp', clientId: 'c-kopinara', sharedWithClient: true, url: up.url });
  check((await guestGet()) === 200, 'once it’s shared with her project, she can');

  /* ---------- 4. pausing ---------- */
  const paused = await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, paused: true } }]);
  check(doc('workspaces', 'pnp').plan.paused === true && doc('workspaces', 'pnp').plan.pauses?.length === 1 && !paused.why, 'an owner pauses the plan, and the server notes when');
  const todo = await intan.sync('todos', [{ id: 'td-paused', title: 'new work', userId: 'u-intan', workspaceId: 'pnp', done: false, createdAt: now() }]);
  check(todo.saved === 0 && /paused/.test(todo.why ?? ''), 'a paused company is read-only for its members, with the reason');
  const guestMsg = await laras.sync('messages', [{ id: 'msg-guest-paused', channelId: 'ch-kopinara-shared', userId: 'guest', guestEmail: 'laras@kopinara.example', text: 'hello', at: now() }]);
  check(guestMsg.saved === 0, 'and for its guests');
  const ai = await intan.post('/api/ai/summarize', { workspaceId: 'pnp', thread: { subject: 'x', messages: [] } });
  check(ai.status === 403, 'no AI while paused');
  const upl = await intan.post('/api/upload', 'x', { 'content-type': 'text/plain', 'x-file-name': 'x.txt', 'x-workspace': 'pnp' });
  check(upl.status === 403, 'no uploads while paused');
  canSend();
  const mail = await raka.post('/api/mail/send', { workspaceId: 'pnp', accountId: 'pnp-raka', threadId: '', messageId: 'm-p', to: [{ name: 'X', email: 'x@outside.example' }], cc: [], subject: 'paused', text: 'x', files: [] });
  check(mail.status === 403 && /paused/.test((await mail.json()).error ?? ''), `no mail goes out while paused (${mail.status})`);
  const st = await intan.state();
  check(st.todos.length > 0 && st.clients.length > 0, 'everyone still reads everything');
  await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, paused: false } }]);
  const resumed = doc('workspaces', 'pnp').plan;
  check(!resumed.paused && !!resumed.pauses?.[0]?.to, 'the owner resumes it');
  // 90 days already used this year: no more pausing.
  put('workspaces', { ...doc('workspaces', 'pnp'), plan: { ...resumed, pauses: [{ from: new Date(Date.now() - 200 * 86_400_000).toISOString(), to: new Date(Date.now() - 105 * 86_400_000).toISOString() }] } });
  const again = await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, paused: true } }]);
  check(!doc('workspaces', 'pnp').plan.paused && /3 months a year/.test(again.why ?? ''), 'after 3 months of pauses in a year, the plan can’t be paused again');
  const adminTry = await signIn('sofia@demo.sprint2go.com');
  const byAdmin = await adminTry.sync('workspaces', [{ ...doc('workspaces', 'pnp'), plan: { ...doc('workspaces', 'pnp').plan, addons: { ...doc('workspaces', 'pnp').plan.addons, branding: true } } }]);
  check(!doc('workspaces', 'pnp').plan.addons.branding && /owners/.test(byAdmin.why ?? ''), 'an admin who isn’t an owner can’t change the plan');

  /* ---------- 5. plan limits ---------- */
  const ws = doc('workspaces', 'pnp');
  const extra = Array.from({ length: 10 }, (_, i) => ({ id: `extra-${i}`, email: `extra${i}@demo.sprint2go.com`, name: `Extra ${i}`, kind: 'personal', connected: false, users: [] }));
  const boxes = await raka.sync('workspaces', [{ ...ws, accounts: [...ws.accounts, ...extra] }]);
  check(!doc('workspaces', 'pnp').accounts.some((a) => a.id === 'extra-0') && /room for/.test(boxes.why ?? ''), 'more hosted mailboxes than the plan has room for are refused, with the reason');
  const status = await raka.get('/api/meet/status?ws=pnp').then((r) => r.json());
  check(status.minutes?.total === (4 * 7 + 10) * 60, `the notetaker’s hours this month come from the plan and add-ons (${status.minutes?.total} minutes)`);
  const credits = await raka.post('/api/mail/credits', { workspaceId: 'pnp', pack: 1000 });
  const before = doc('workspaces', 'pnp').mailCredits ?? 0;
  check(credits.status === 409 && (doc('workspaces', 'pnp').mailCredits ?? 0) === before, 'without Boosted sending on this server there are no credits to buy, and none appear');
  const setup = await raka.get('/api/mail/setup?ws=pnp').then((r) => r.json());
  check(setup.boostedAvailable === false && !!setup.creditOrders?.blocked, 'Email delivery says why');
  const route = await raka.post('/api/mail/route', { workspaceId: 'pnp', route: 'boosted' });
  check(route.status === 409, 'and Boosted can’t be switched on');

  /* ---------- 6. WhatsApp ---------- */
  const appSecret = randomBytes(16).toString('hex');
  const connect = await raka.post('/api/whatsapp/connect', { workspaceId: 'pnp', phoneNumberId: '1039000001', token: 'EAAG' + 'x'.repeat(40), appSecret });
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
  const hijack = await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), whatsapp: { phoneNumberId: '1039000002', connected: true, verifyToken: 'mine' } }]);
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
  const ics = ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT', `UID:${randomBytes(6).toString('hex')}@outside.example`, 'DTSTART:20261120T030000Z', 'DTEND:20261120T040000Z', `SUMMARY:${inviteSubject}`, 'ORGANIZER;CN=Olga:mailto:olga@organiser.example', 'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:raka@demo.sprint2go.com', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  canSend();
  await smtp.sendMail({ from: 'Olga <olga@organiser.example>', to: 'raka@demo.sprint2go.com', subject: inviteSubject, text: 'Join us', icalEvent: { method: 'REQUEST', content: ics } });
  const inviteThread = await waitFor(() => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${inviteSubject}%`).map((r) => JSON.parse(r.data)).find((t) => t.accountId === 'pnp-raka' && t.messages.some((x) => x.invite)));
  canSend();
  const rsvp = inviteThread ? await raka.post('/api/mail/invite', { threadId: inviteThread.id, messageId: inviteThread.messages.find((x) => x.invite).id, answer: 'accepted' }) : null;
  const reply = await waitFor(() => sunk.find((x) => x.to.includes('olga@organiser.example') && x.raw.includes('METHOD:REPLY')));
  check(rsvp?.ok && !!reply && (await signedBy(reply.raw)).includes('demo.sprint2go.com'), 'an invite answer leaves DKIM-signed for demo.sprint2go.com (and verifies)');
  // Out of office: the automatic answer.
  canSend();
  const away = await raka.post('/api/mail/away', { workspaceId: 'pnp', accountId: 'pnp-raka', away: { on: true, subject: 'Away', message: 'Back on Monday.' } });
  canSend();
  await smtp.sendMail({ from: 'Ben <ben@writer.example>', to: 'raka@demo.sprint2go.com', subject: `question ${randomBytes(3).toString('hex')}`, text: 'Are you there?' });
  const auto = await waitFor(() => sunk.find((x) => x.to.includes('ben@writer.example')));
  check(away.ok && !!auto && /Auto-Submitted: auto-replied/i.test(auto.raw.toString()) && (await signedBy(auto.raw)).includes('demo.sprint2go.com'), 'an out-of-office answer leaves DKIM-signed too');
  // A routing test ("Some of each"): our own mail, signed with the platform's key for the support domain.
  const probe = await raka.post('/api/mail/routing-test', { workspaceId: 'pnp' });
  const probeMail = await waitFor(() => sunk.find((x) => x.to.some((t) => t.startsWith('s2g-check-'))));
  check(probe.ok && !!probeMail && (await signedBy(probeMail.raw)).includes(SUPPORT_DOMAIN), `a routing test leaves DKIM-signed for ${SUPPORT_DOMAIN}`);

  /* ---------- 8. files in projects a member can't see ---------- */
  const upload = (who, text, ws = 'pnp', name = 'notes.txt') => who.post('/api/upload', text, { 'content-type': 'text/plain', 'x-file-name': name, 'x-workspace': ws }).then((r) => r.json());
  const secretFile = await upload(raka, 'the secret numbers', 'pnp', 'secret.txt');
  put('drive', { id: 'dr-secret-numbers', name: 'secret.txt', kind: 'doc', parentId: 'dr-secret-folder', size: 18, modified: now(), workspaceId: 'pnp', url: secretFile.url });
  const opensWith = (who, u) => who.get(u).then((r) => r.status);
  check((await opensWith(intan, secretFile.url)) === 404, 'a member can’t download a file in a project she can’t see, even with the address');
  check((await opensWith(raka, secretFile.url)) === 200, 'the owner can');
  const inChat = await upload(raka, 'said in the project channel', 'pnp', 'chat.txt');
  put('messages', { id: 'msg-secret-file', channelId: 'ch-secret', userId: 'u-raka', text: 'here', at: now(), files: [{ name: 'chat.txt', size: 27, type: 'text/plain', url: inChat.url }] });
  check((await opensWith(intan, inChat.url)) === 404, 'nor one sent in its channel');
  const loose = await upload(raka, 'on nothing yet');
  check((await opensWith(intan, loose.url)) === 200, 'a file that isn’t on anything yet opens for the team');
  const hers = await upload(intan, 'mine');
  put('drive', { id: 'dr-secret-hers', name: 'hers.txt', kind: 'doc', parentId: 'dr-secret-folder', size: 4, modified: now(), workspaceId: 'pnp', url: hers.url });
  check((await opensWith(intan, hers.url)) === 200, 'her own upload always opens');
  const pnpSee = doc('workspaces', 'pnp');
  await raka.sync('workspaces', [{ ...pnpSee, permissions: { ...(pnpSee.permissions ?? {}), seeAllProjects: true } }]);
  check((await opensWith(intan, secretFile.url)) === 200, 'with “See every project” on, she can');
  await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), permissions: { ...(doc('workspaces', 'pnp').permissions ?? {}), seeAllProjects: false } }]);
  check((await opensWith(laras, secretFile.url)) === 404, 'and a guest never can');

  /* ---------- 9. support tickets: operators open what customers attach ---------- */
  const yusuf = await signIn('yusuf@rimbagroup.example');
  const shot = await upload(yusuf, 'a screenshot', 'elk', 'shot.txt');
  const other = await upload(yusuf, 'not attached', 'elk', 'other.txt');
  const ticket = await yusuf.post('/api/support', { subject: 'Something broke', body: 'See the screenshot', workspaceId: 'elk', attachments: [{ name: 'shot.txt', url: shot.url }, { name: 'someone else’s', url: secretFile.url }] }).then((r) => r.json());
  const attached = JSON.parse(db.prepare('SELECT attachments FROM ticket_messages WHERE ticket_id = ?').get(ticket.id)?.attachments ?? '[]');
  check(attached.length === 1 && attached[0].url === shot.url, 'a ticket keeps only files the customer uploaded, not another address');
  db.prepare("INSERT INTO operators (email, role, added_by, added_at, totp_on) VALUES (?, 'support', 'test', ?, 1)").run('bima@demo.sprint2go.com', now());
  const bima = await signIn('bima@demo.sprint2go.com');
  check((await opensWith(bima, shot.url)) === 404, 'an operator who hasn’t passed the console’s two-step sign-in can’t open it');
  db.prepare('UPDATE sessions SET op_ok = ? WHERE token = ?').run(now(), createHash('sha256').update(bima.token).digest('hex'));
  const opens = () => db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'ticket.file-open' AND target = ? AND operator = ?").get(ticket.id, 'bima@demo.sprint2go.com').n;
  check((await opensWith(bima, shot.url)) === 200 && opens() === 1, 'past it, a support operator opens what the customer attached, and it’s in the audit log');
  await opensWith(bima, shot.url);
  check(opens() === 1, 'opening it again a moment later is the same entry');
  check((await opensWith(bima, other.url)) === 404, 'the customer’s other files stay closed');
  db.prepare("UPDATE operators SET role = 'finance' WHERE email = ?").run('bima@demo.sprint2go.com');
  check((await opensWith(bima, shot.url)) === 404, 'an operator without the support permission can’t');
  check((await opensWith(yusuf, shot.url)) === 200, 'the customer still opens their own');
  // A ticket from before 9 Oct, when a ticket could point at any file: its attachment is someone else's file.
  db.prepare("UPDATE operators SET role = 'support' WHERE email = ?").run('bima@demo.sprint2go.com');
  const oldAt = '2026-10-08T09:00:00.000Z';
  db.prepare("INSERT INTO tickets (id, number, subject, status, priority, channel, requester_email, requester_name, requester_user, workspace_id, tags, created_at, updated_at) VALUES ('t-old-files', 990001, 'Old one', 'open', 'normal', 'app', 'yusuf@rimbagroup.example', 'Yusuf', ?, 'elk', '[]', ?, ?)").run(db.prepare('SELECT user_id FROM logins WHERE email = ?').get('yusuf@rimbagroup.example')?.user_id ?? null, oldAt, oldAt);
  db.prepare("INSERT INTO ticket_messages (id, ticket_id, at, kind, author, author_name, body, internal, attachments) VALUES ('tm-old-files', 't-old-files', ?, 'customer', 'yusuf@rimbagroup.example', 'Yusuf', 'see attached', 0, ?)").run(oldAt, JSON.stringify([{ name: 'numbers.txt', url: secretFile.url }]));
  check((await opensWith(bima, secretFile.url)) === 404, 'an old ticket pointing at another company’s file doesn’t open it for support');
  const oldView = await bima.get('/api/admin/ticket?id=t-old-files').then((r) => r.json());
  const shown = oldView.messages?.[0]?.attachments?.[0];
  check(!!shown && shown.url === '' && shown.blocked === 'Attachment from before 9 Oct, ask the person to send it again', 'the operator sees “Attachment from before 9 Oct, ask the person to send it again” instead of a link');
  const newView = await bima.get(`/api/admin/ticket?id=${ticket.id}`).then((r) => r.json());
  check(newView.messages?.[0]?.attachments?.[0]?.url === shot.url && !newView.messages[0].attachments[0].blocked, 'a file sent with its ticket still links');

  /* ---------- 10. invoices bill active people ---------- */
  db.prepare("UPDATE operators SET role = 'owner' WHERE email = ?").run('bima@demo.sprint2go.com');
  const month = now().slice(0, 7);
  const pnpMembers = doc('workspaces', 'pnp').members.map((x) => x.userId);
  const activeIds = new Set(db.prepare('SELECT DISTINCT user_id FROM activity_days WHERE day >= ?').all(`${month}-01`).map((r) => r.user_id));
  const activeHere = pnpMembers.filter((id) => activeIds.has(id)).length;
  const made = await bima.post('/api/admin/invoice/create', { workspaceId: 'pnp' }).then((r) => r.json());
  const inv = made.id ? db.prepare('SELECT lines, note FROM invoices WHERE id = ?').get(made.id) : null;
  const planLine = inv ? JSON.parse(inv.lines)[0]?.text ?? '' : '';
  check(activeHere > 0 && activeHere < pnpMembers.length && planLine.includes(`${activeHere} active ${activeHere === 1 ? 'person' : 'people'} of ${pnpMembers.length} on the team`), `the invoice bills the ${activeHere} people active this month, not all ${pnpMembers.length} (“${planLine}”)`);
  check(/signed in or used sprint2go/.test(inv?.note ?? ''), 'and says what active means');
  const billingPage = await raka.get('/api/billing/invoices?ws=pnp').then((r) => r.json());
  check(billingPage.active?.people === activeHere && billingPage.active?.team === pnpMembers.length, 'the billing page shows the same count');

  /* ---------- 11. the company's time zone ---------- */
  await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), timeZone: 'Europe/Amsterdam' }]);
  check(doc('workspaces', 'pnp').timeZone === 'Europe/Amsterdam', 'an owner sets the company’s time zone');
  await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), timeZone: 'Mars/Olympus' }]);
  check(doc('workspaces', 'pnp').timeZone === 'Europe/Amsterdam', 'a zone the clock doesn’t know isn’t saved');
  await intan.sync('workspaces', [{ ...doc('workspaces', 'pnp'), timeZone: 'Asia/Tokyo' }]);
  check(doc('workspaces', 'pnp').timeZone === 'Europe/Amsterdam', 'a member can’t change it');

  /* ---------- 12. mail: refused sends and reply reminders ---------- */
  const reminders = (threadId) => db.prepare('SELECT * FROM mail_remind WHERE thread_id = ?').all(threadId);
  const w12 = doc('workspaces', 'pnp');
  put('workspaces', { ...w12, mailReady: { at: now(), receive: true, send: false, why: {}, mailboxes: {} } });
  const tracked = (threadId) => ({ workspaceId: 'pnp', accountId: 'pnp-raka', threadId, messageId: 'm-1', to: [{ name: 'Budi', email: 'budi@client-check.example' }], cc: [], subject: 'Proposal', text: 'Here it is', html: '<p>Here it is</p>', files: [], track: true, trackOptions: { opens: true, clicks: true, notify: true, remindDays: 3 } });
  const refused = await raka.post('/api/mail/send', tracked('t-refused'));
  check(refused.status === 409 && !!(await refused.json()).error && reminders('t-refused').length === 0, `a send the mailbox can’t do is refused with the reason, and nothing is planned (${refused.status})`);
  canSend();
  const sent = await raka.post('/api/mail/send', tracked('t-remind'));
  const rem = reminders('t-remind')[0];
  const days = rem ? (Date.parse(rem.due_at) - Date.now()) / 86_400_000 : 0;
  check(sent.ok && rem?.by_user === 'u-raka' && rem.state === 'waiting' && days > 2.9 && days <= 3, 'a tracked email with “Remind me if no reply” is noted on the server, three days out');

  /* ---------- 13. chat: Send later and Remind me ---------- */
  const inAnHour = new Date(Date.now() + 3600_000).toISOString();
  await raka.sync('messages', [{ id: 'msg-later', channelId: 'ch-both', userId: 'u-raka', text: '@Intan this goes out later', at: now(), sendAt: inAnHour }]);
  check(doc('messages', 'msg-later')?.sendAt === inAnHour, 'a message can wait for its time');
  check(!(await intan.state()).messages.some((x) => x.id === 'msg-later') && (await raka.state()).messages.some((x) => x.id === 'msg-later'), 'until then only its author sees it');
  await intan.sync('messages', [{ ...doc('messages', 'msg-later'), reactions: { '👍': ['u-intan'] } }]);
  await intan.sync('messages', [], ['msg-later']);
  check(!!doc('messages', 'msg-later') && !doc('messages', 'msg-later').reactions, 'nobody else can touch it or delete it');
  await raka.sync('messages', [{ ...doc('messages', 'msg-raka'), sendAt: inAnHour }]);
  check(!doc('messages', 'msg-raka').sendAt, 'a message that went out can’t be made to wait again');
  await raka.sync('messages', [{ ...doc('messages', 'msg-later'), sendAt: new Date(Date.now() - 1000).toISOString() }]);
  const intanPrefs = doc('prefs', 'u-intan')?.value ?? {};
  await intan.sync('prefs', [{ id: 'u-intan', value: { ...intanPrefs, 's2g-chat-saved:u-intan': [{ id: 'msg-raka', channelId: 'ch-both', at: now(), remindAt: new Date(Date.now() - 1000).toISOString() }] } }]);
  const chatNotices = () => db.prepare("SELECT data FROM docs WHERE coll = 'notices' AND json_extract(data, '$.userId') = 'u-intan' AND json_extract(data, '$.link.app') = 'chat'").all().map((r) => JSON.parse(r.data).text);
  const went = await waitFor(() => !doc('messages', 'msg-later').sendAt && chatNotices().some((t) => t.startsWith('Reminder:')), 400);
  check(!!went && (await intan.state()).messages.some((x) => x.id === 'msg-later'), 'when its time comes the server sends it, and now she sees it');
  check(chatNotices().some((t) => t === 'Raka mentioned you in #both: “@Intan this goes out later”'), 'the person it mentions hears about it');
  check(chatNotices().filter((t) => t === 'Reminder: Raka in #both: “I said this”').length === 1 && doc('prefs', 'u-intan').value['s2g-chat-saved:u-intan'][0].reminded === true, 'a saved message’s reminder comes once, and is marked done in her settings');

  /* ---------- 14. two-step sign-in: "Remember this device" ---------- */
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
    const intanMail = 'intan@demo.sprint2go.com';
    const intanId = db.prepare('SELECT user_id FROM logins WHERE email = ?').get(intanMail).user_id;
    // Intan turns two-step sign-in on.
    const first = await login(intanMail);
    const d1 = as(first.session);
    const setup = await d1('POST', '/api/2fa/setup', {}).then((r) => r.json());
    const enabled = await d1('POST', '/api/2fa/enable', { code: totp(setup.secret) });
    check(enabled.ok, 'a member turns on two-step sign-in');
    // Next sign-in: the code, with "Remember this device".
    const second = await login(intanMail);
    check(second.body.twoStep === 'code', 'a new sign-in asks for the code');
    const verify = await fetch(`${base}/api/2fa/verify`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `s2g=${second.session}` }, body: JSON.stringify({ code: totp(setup.secret, 1), remember: true }) });
    const deviceCookie = Object.fromEntries(verify.headers.getSetCookie().map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')])).s2g_dev;
    const setCookieLine = verify.headers.getSetCookie().find((c) => c.startsWith('s2g_dev=')) ?? '';
    check(verify.ok && !!deviceCookie && /HttpOnly/.test(setCookieLine) && /Max-Age=2592000/.test(setCookieLine), 'ticking “Remember this device” gives the browser a 30-day device cookie it can’t read from scripts');
    const third = await login(intanMail, deviceCookie);
    const meThird = await as(third.session)('GET', '/api/me').then((r) => r.json());
    check(third.status === 200 && !third.body.twoStep && !meThird.twoStep && meThird.me === intanId, 'that device signs in with just the password');
    const listed = await as(third.session, deviceCookie)('GET', '/api/2fa').then((r) => r.json());
    check(listed.devices?.length === 1 && listed.devices[0].current === true && /until|\d/.test(listed.devices[0].expiresAt) && Date.parse(listed.devices[0].expiresAt) - Date.now() > 29.9 * 86_400_000, 'it’s in her remembered devices, marked as this device, for 30 days');
    // The token is signed and bound to its person: changed, someone else's, or expired, it asks for the code. (Sofia,
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
    const adiMail = 'sofia@demo.sprint2go.com';
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
    check(forgetOne.ok && (await login(intanMail, deviceCookie)).body.twoStep === 'code', 'Forget: that device asks for the code again');
    // Sign out everywhere: other sessions end, every remembered device is forgotten, this session stays.
    const devA = madeDevice(intanId);
    const keep = await login(intanMail, devA.token);
    const other = await login(intanMail, madeDevice(intanId).token);
    const out = await as(keep.session)('POST', '/api/2fa/signout-everywhere', {});
    const otherMe = await as(other.session)('GET', '/api/me');
    const keepMe = await as(keep.session)('GET', '/api/me').then((r) => r.json());
    const left = db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?').get(intanId).n;
    check(out.ok && otherMe.status === 401 && keepMe.me === intanId && left === 0, `“Sign out everywhere” ends the other sessions and forgets every remembered device, and this one stays (${otherMe.status}, ${left} left)`);
    check((await login(intanMail, devA.token)).body.twoStep === 'code', 'so a device remembered before asks for the code again');
    // A password change forgets them too.
    const devB = madeDevice(intanId);
    const pw = await as(keep.session)('POST', '/api/password', { current: env.SEED_PASSWORD, next: 'a-new-password-123' });
    check(pw.ok && db.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ?').get(intanId).n === 0, 'a password change forgets every remembered device');
    check((await login(intanMail, devB.token, 'a-new-password-123')).body.twoStep === 'code', 'and the next sign-in there asks for the code');

  }
  /* ---------- 15. free trials: one per person and per company domain ---------- */
  {
    const trialWs = (id, name) => ({ workspace: { id, name, color: '#5b5bf6', domains: [], accounts: [], members: [], plan: { track: 'ai', tier: 'studio', cycle: 'monthly', trialEnds: new Date(Date.now() + 14 * 86_400_000).toISOString(), addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: name, emails: [] }, since: now() } }, users: [] });
    // Raka's demo companies already had trials (they count from before the rule), and Intan's address is at the same
    // company domain: her new company starts on Free, and says why.
    const asked = await raka.get('/api/trial').then((r) => r.json());
    check(asked.available === false && /^You’ve already had a free trial, with /.test(asked.why ?? ''), `the onboarding hears a second trial isn’t available (“${asked.why}”)`);
    const made = await raka.post('/api/workspace', trialWs('ws-trial-1', 'Second Co')).then((r) => r.json());
    const second = doc('workspaces', 'ws-trial-1');
    check(second?.plan?.tier === 'free' && !second.plan.trialEnds && /already had a free trial/.test(second.plan.trialRefused ?? '') && /already had a free trial/.test(made.trialRefused ?? ''), 'a second company of the same person starts on Free, with the reason on its plan');
    // The app can't give itself the trial back.
    await raka.sync('workspaces', [{ ...second, plan: { ...second.plan, tier: 'studio', track: 'ai', trialEnds: new Date(Date.now() + 14 * 86_400_000).toISOString() } }]);
    check(!doc('workspaces', 'ws-trial-1').plan.trialEnds, 'saving a trial from the app doesn’t start one');
    const notice = db.prepare("SELECT data FROM docs WHERE coll = 'notices' AND json_extract(data, '$.workspaceId') = 'ws-trial-1'").get();
    check(!!notice && /starts on Free/.test(JSON.parse(notice.data).text), 'the owner is told in the app');
    // An operator allows one more: the next company gets it.
    const granted = await bima.post('/api/admin/person/trial-grant', { userId: 'u-raka' });
    const third = granted.ok ? await raka.post('/api/workspace', trialWs('ws-trial-2', 'Third Co')).then((r) => r.json()) : null;
    check(granted.ok && !third?.trialRefused && !!doc('workspaces', 'ws-trial-2')?.plan?.trialEnds, 'after an operator allows another, the next company starts on its trial');
    const fourth = await raka.post('/api/workspace', trialWs('ws-trial-3', 'Fourth Co')).then((r) => r.json());
    check(!!fourth.trialRefused && doc('workspaces', 'ws-trial-3')?.plan?.tier === 'free', 'and only that one');
  }

  /* ---------- 16. BIMI: the logo is checked, served from a stable address, and only admins change it ---------- */
  {
    const good = '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 64 64"><title>sprint2go demo</title><rect width="64" height="64" fill="#5b5bf6"/></svg>';
    const bad = good.replace('<rect', '<script>alert(document.cookie)</script><rect');
    const refused = await raka.post('/api/mail/bimi', { workspaceId: 'pnp', name: 'logo.svg', svg: bad });
    const refusedBody = await refused.json();
    check(refused.status === 400 && refusedBody.problems?.some((p) => /script/.test(p)) && !doc('workspaces', 'pnp').bimi, 'a logo with a script is refused, with the reason, and nothing is kept');
    const member = await (await signIn('joko@demo.sprint2go.com')).post('/api/mail/bimi', { workspaceId: 'pnp', name: 'logo.svg', svg: good });
    check(member.status === 403, 'a member can’t set the company’s logo');
    const saved = await raka.post('/api/mail/bimi', { workspaceId: 'pnp', name: 'logo.svg', svg: good }).then((r) => r.json());
    check(saved.record?.host === 'default._bimi' && saved.record.value === `v=BIMI1; l=${saved.url}; a=;` && saved.url.endsWith('/bimi/pnp.svg') && !!doc('workspaces', 'pnp').bimi?.fileId, 'an admin’s logo is kept, with the exact default._bimi record');
    const served = await fetch(`${base}/bimi/pnp.svg`);
    const servedBody = await served.text();
    check(served.ok && served.headers.get('content-type') === 'image/svg+xml' && /sandbox/.test(served.headers.get('content-security-policy') ?? '') && servedBody === good, 'it’s served without signing in, as an SVG in a sandbox');
    check((await fetch(`${base}/bimi/elk.svg`)).status === 404, 'a company without a logo has nothing there');
    await raka.sync('workspaces', [{ ...doc('workspaces', 'pnp'), bimi: { fileId: secretFile.url.split('/').pop(), name: 'x', at: now(), by: 'u-raka' } }]);
    check(!!doc('workspaces', 'pnp').bimi?.fileId && doc('workspaces', 'pnp').bimi.fileId !== secretFile.url.split('/').pop(), 'the app can’t point the logo at another file');
  }

  /* ---------- 17. a project's or team's own task stages: who sets them, only lists that work, approvals use them ---------- */
  {
    const own = [{ id: 'todo', kind: 'open' }, { id: 'st-design', kind: 'active', name: 'Design' }, { id: 'st-check', kind: 'review', name: 'Check' }, { id: 'done', kind: 'done' }];
    const joko = await signIn('joko@demo.sprint2go.com'); // a member, not on this project's lead list
    const proj = doc('clients', 'c-selara');
    await joko.sync('clients', [{ ...proj, taskStages: own }]);
    check(!doc('clients', 'c-selara').taskStages, 'a member can’t give a project its own stages');
    await raka.sync('clients', [{ ...doc('clients', 'c-selara'), taskStages: own }]);
    check(JSON.stringify(doc('clients', 'c-selara').taskStages) === JSON.stringify(own), 'an admin can');
    await raka.sync('clients', [{ ...doc('clients', 'c-selara'), taskStages: [{ id: 'st-x', kind: 'active' }] }]);
    check(doc('clients', 'c-selara').taskStages?.length === 4, 'a list without a start and a done stage isn’t kept');
    await raka.sync('teams', [{ ...doc('teams', 't-perf'), taskStages: [{ id: 'q', kind: 'open', name: 'Queue' }, { id: 'cut', kind: 'active', name: 'Cutting' }, { id: 'done', kind: 'done' }] }]);
    check(doc('teams', 't-perf').taskStages?.length === 3, 'a team gets its own stages from an admin');
    await joko.sync('teams', [{ ...doc('teams', 't-perf'), taskStages: undefined }]);
    check(doc('teams', 't-perf').taskStages?.length === 3, 'not from a member who doesn’t lead it');
    await joko.sync('teams', [{ ...doc('teams', 't-video'), taskStages: [{ id: 'q', kind: 'open', name: 'Queue' }, { id: 'done', kind: 'done' }] }]);
    check(doc('teams', 't-video').taskStages?.length === 2, 'its lead can');
    // A guest asks for changes on finished work in that project: it goes back to the project's own first "in progress".
    const hannahTask = { id: 'td-own-stage', workspaceId: 'pnp', clientId: 'c-selara', title: 'Hero banner', userId: 'u-raka', assignees: ['u-raka'], done: true, status: 'done', visibleToClient: true, approval: { status: 'waiting', at: now() }, source: 'manual', createdBy: 'u-raka', createdAt: now(), priority: 'normal' };
    put('todos', hannahTask);
    // Hannah approves work for Selara (the approver role), so she can ask for changes.
    const selara = doc('clients', 'c-selara');
    put('clients', { ...selara, people: (selara.people ?? []).map((x) => (x.email === 'hannah@selaraskin.example' ? { ...x, role: 'approver' } : x)) });
    const hannah = await signIn('hannah@selaraskin.example');
    if (hannah.ok) {
      await hannah.sync('todos', [{ ...hannahTask, approval: { status: 'changes', note: 'Bigger logo' } }]);
      const after = doc('todos', 'td-own-stage');
      check(after.done === false && after.status === 'st-design', `changes asked: back to the project’s own first in-progress stage (${after.status})`);
    } else check(true, 'the guest can’t sign in here (no seed password for guests): approvals checked in unit tests');
    // Guests see a project's own stages as ids and kinds only.
    const larasState = await laras.state();
    check(!JSON.stringify(larasState.clients ?? []).includes('"name":"Design"'), 'guests never see the names of a project’s own stages');
  }


  /* ---------- 18. files on a task's comments: whose files, and who opens them ---------- */
  {
    const up = (who, text, name) => who.post('/api/upload', text, { 'content-type': 'text/plain', 'x-file-name': name, 'x-workspace': 'pnp' }).then((r) => r.json());
    const inside = await up(raka, 'for the team only', 'internal.txt');
    const shared = await up(raka, 'for the guest too', 'shared.txt');
    const intans = await up(intan, 'intan’s own', 'intan.txt');
    const card = (f, name = f.name) => ({ name, size: 1, type: 'text/html', url: f.url });
    const base = { id: 'td-files', workspaceId: 'pnp', clientId: 'c-kopinara', title: 'Launch photos', userId: 'u-raka', assignees: ['u-raka', 'u-intan'], done: false, status: 'todo', visibleToClient: true, source: 'manual', createdBy: 'u-raka', createdAt: now(), priority: 'normal', history: [] };
    put('todos', base);
    await raka.sync('todos', [
      {
        ...base,
        history: [
          { id: 'tf-in', at: now(), by: 'u-raka', kind: 'comment', text: 'internal', files: [card(inside, 'evil.html'), card(intans)] },
          { id: 'tf-out', at: now(), by: 'u-raka', kind: 'comment', text: 'have a look', toClient: true, files: [card(shared)] },
        ],
      },
    ]);
    const saved = doc('todos', 'td-files');
    const filesOf = (id) => (doc('todos', 'td-files').history.find((h) => h.id === id)?.files ?? []).map((f) => `${f.name} ${f.type} ${f.url}`);
    check(JSON.stringify(filesOf('tf-in')) === JSON.stringify([`internal.txt text/plain ${inside.url}`]), `a comment keeps only its writer’s own uploads, named as uploaded (${JSON.stringify(filesOf('tf-in'))})`);
    check(filesOf('tf-out').length === 1 && saved.history.length === 2, 'the shared comment keeps its file');
    // Saving the task again with other files under a saved comment (sessions from earlier sections are signed out by now).
    const sofia1 = await raka.sync('todos', [{ ...saved, title: 'Launch photos, final', history: saved.history.map((h) => (h.id === 'tf-in' ? { ...h, files: [card(intans)] } : h)) }]);
    check(sofia1.saved === 1 && doc('todos', 'td-files').title === 'Launch photos, final', `the task is saved again (${JSON.stringify(sofia1)})`);
    check(JSON.stringify(filesOf('tf-in')) === JSON.stringify([`internal.txt text/plain ${inside.url}`]), 'nobody swaps the files under someone else’s comment');
    const seen = (await laras.state()).todos.find((x) => x.id === 'td-files');
    const seenFiles = JSON.stringify(seen?.history ?? []);
    check(!!seen && seenFiles.includes(shared.url) && !seenFiles.includes(inside.url), 'a guest sees the files on comments shared with her, not on internal ones');
    check((await laras.get(shared.url)).status === 200, 'she opens the shared one');
    check((await laras.get(inside.url)).status === 404, 'not the internal one, though the task is shared with her');
    check((await raka.get(inside.url)).status === 200 && (await raka.get(shared.url)).status === 200, 'the team opens both');
    // The guest attaches her own upload; not a file of the company's.
    const hers = await laras.post('/api/upload', 'from the client', { 'content-type': 'text/plain', 'x-file-name': 'brief.txt', 'x-workspace': 'pnp' }).then((r) => r.json());
    await laras.sync('todos', [{ ...seen, history: [...seen.history, { id: 'tf-guest', at: now(), by: 'laras@kopinara.example', kind: 'comment', text: 'ours', files: [card(hers), card(inside)] }] }]);
    const guestFiles = filesOf('tf-guest');
    check(guestFiles.length === 1 && guestFiles[0].includes(hers.url) && doc('todos', 'td-files').history.find((h) => h.id === 'tf-guest')?.toClient === true, `a guest’s comment carries her own upload only (${JSON.stringify(guestFiles)})`);
    check((await raka.get(hers.url)).status === 200, 'and the team opens it');
    // A project that doesn't let guests add files: her comment goes in without them.
    const kopi = doc('clients', 'c-kopinara');
    put('clients', { ...kopi, access: { ...(kopi.access ?? {}), uploads: false } });
    const again = (await laras.state()).todos.find((x) => x.id === 'td-files');
    await laras.sync('todos', [{ ...again, history: [...again.history, { id: 'tf-guest2', at: now(), by: 'laras@kopinara.example', kind: 'comment', text: 'one more', files: [card(hers)] }] }]);
    const second = doc('todos', 'td-files').history.find((h) => h.id === 'tf-guest2');
    check(!!second && !second.files, 'with guest uploads off, her comment is kept without files');
    put('clients', kopi);
  }

  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} failed` : '\nSecurity and billing checks passed');
finish(failed ? 1 : 0);
