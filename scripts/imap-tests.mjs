// Phone mail apps (server/mailApps.ts, server/imap.ts, server/submission.ts), end to end, on a production-like server:
// no demo data, a throwaway data folder, free test ports, the mail engine's own self-signed certificate (counted as
// trusted only because this is a test host), and a local SMTP sink as "the world", so nothing ever leaves this machine.
// A real IMAP client (imapflow) and nodemailer do what iPhone Mail, Gmail and Thunderbird do:
//  1. app passwords made in Settings sign in (IMAPS, STARTTLS); a wrong one, a removed one and the normal sprint2go
//     password don't, nothing signs in before TLS, and too many failures lock a username out
//  2. the folders (INBOX, Sent, Drafts, Archive, Snoozed, Trash, Spam, labels) with their special-use flags, and a shared
//     inbox as its own folder tree only for the people on it
//  3. reading, flagging, moving, labelling and deleting change the same mail in sprint2go, and the other way round
//  4. drafts appended from a mail app become drafts; a sent copy appended after sending doesn't show twice
//  5. IDLE wakes up when mail arrives over SMTP
//  6. sending from a mail app: only from the person's own addresses (and aliases), never before TLS, the email goes out
//     through the mail engine (DKIM-signed, to the sink) and shows in sprint2go's Sent
//  7. a company that switches other mail apps off ends its people's connections; autoconfig and the Apple profile
//   node scripts/imap-tests.mjs
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

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

const dir = mkdtempSync(join(tmpdir(), 's2g-imap-'));
const [httpPort, smtpPort, imapPort, imapsPort, subPort, subsPort, sinkPort] = await Promise.all(Array.from({ length: 7 }, freePort));
const base = `http://127.0.0.1:${httpPort}`;
const MAIL_HOST = 'mail.s2g-imap.test';

// "The world": a local SMTP sink that keeps what it gets.
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

const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'production',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  PUBLIC_URL: base,
  MAIL_HOST,
  MAIL_PORT: String(smtpPort),
  MAIL_RELAY_URL: `smtp://127.0.0.1:${sinkPort}`,
  SUPPORT_EMAIL: 'support@s2g-imap.test',
  IMAP_ENABLED: '1',
  IMAP_TEST_TLS: '1',
  IMAP_PORT: String(imapPort),
  IMAPS_PORT: String(imapsPort),
  SUBMISSION_PORT: String(subPort),
  SUBMISSIONS_PORT: String(subsPort),
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
const clients = [];
const finish = async (code) => {
  for (const c of clients) await c.logout().catch(() => c.close?.());
  server.kill('SIGTERM');
  sink.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server may still hold a file for a moment */
  }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-60).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), void finish(1)), 240_000).unref();

const waitFor = async (fn, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  return null;
};

try {
  const up = await waitFor(() => /Phone mail apps: IMAP on/.test(log) || server.exitCode !== null, 30_000);
  check(up && /Phone mail apps: IMAP on/.test(log), 'the server starts with mail apps on (production, no demo data, test certificate)');
  if (!/Phone mail apps: IMAP on/.test(log)) throw new Error('mail apps didn’t start');

  /* ---------- the people, their company and some mail, straight into the database ---------- */
  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const now = () => new Date().toISOString();
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const put = (coll, d) => db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const password = randomBytes(9).toString('hex');
  const person = (id, name, email) => {
    const salt = randomBytes(16);
    put('users', { id, name, email, title: '', color: '#5b5bf6' });
    db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?)').run(id, email, `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`);
  };
  person('u-alice', 'Alice Martin', 'alice@acme.test');
  person('u-bob', 'Bob Stone', 'bob@acme.test');
  person('u-carol', 'Carol Reed', 'carol@acme.test');
  person('u-erin', 'Erin Off', 'erin@offco.test');
  const ready = (accounts) => ({ at: now(), receive: true, send: true, why: {}, mailboxes: Object.fromEntries(accounts.map((a) => [a.id, { receive: true, send: true }])) });
  const acmeAccounts = [
    { id: 'a-alice', email: 'alice@acme.test', name: 'Alice Martin', kind: 'personal', connected: true, users: ['u-alice'] },
    { id: 'a-bob', email: 'bob@acme.test', name: 'Bob Stone', kind: 'personal', connected: true, users: ['u-bob'] },
    { id: 'a-carol', email: 'carol@acme.test', name: 'Carol Reed', kind: 'personal', connected: true, users: ['u-carol'] },
    { id: 'a-hello', email: 'hello@acme.test', name: 'Acme', kind: 'shared', connected: true, users: ['u-alice', 'u-bob'] },
  ];
  const acme = { id: 'w-acme', name: 'Acme', color: '#0ea5e9', domains: ['acme.test'], emailSetup: 'hosted', timeZone: 'Asia/Jakarta', accounts: acmeAccounts, mailAliases: [{ id: 'al-sales', address: 'sales@acme.test', to: ['a-alice'] }], members: [{ userId: 'u-alice', role: 'owner' }, { userId: 'u-bob', role: 'member' }, { userId: 'u-carol', role: 'member' }], mailReady: ready(acmeAccounts), createdAt: now() };
  put('workspaces', acme);
  const offAccounts = [{ id: 'a-erin', email: 'erin@offco.test', name: 'Erin Off', kind: 'personal', connected: true, users: ['u-erin'] }];
  put('workspaces', { id: 'w-off', name: 'Offco', color: '#222', domains: ['offco.test'], emailSetup: 'hosted', accounts: offAccounts, mailApps: false, members: [{ userId: 'u-erin', role: 'owner' }], mailReady: ready(offAccounts), createdAt: now() });
  const canSend = () => {
    const w = doc('workspaces', 'w-acme');
    w.mailReady = ready(w.accounts);
    put('workspaces', w);
  };
  // The company's labels (server/mailFilters.ts): every mailbox in it has them, so they're folders in every mail app.
  ['Clients', 'Team', 'Infra', 'Finance'].forEach((name, i) => put('mailLabels', { id: name.toLowerCase(), workspaceId: 'w-acme', accountId: null, name, parentId: null, color: '#10b981', show: 'show', order: i }));
  const m = (id, from, to, body, at, mid, extra = {}) => ({ id, from, to, date: at, body, mid, ...extra });
  const laras = { name: 'Laras Client', email: 'laras@client.test' };
  const aliceP = { name: 'Alice Martin', email: 'alice@acme.test' };
  put('threads', { id: 'th-launch', accountId: 'a-alice', workspaceId: 'w-acme', subject: 'Banana launch dates', location: 'inbox', starred: false, unread: true, labels: [], messages: [m('tm-1', laras, [aliceP], 'Can we move the banana launch to Friday?', ago(120), '<launch1@client.test>'), m('tm-2', aliceP, [laras], 'Friday works for us.', ago(90), '<launch2@acme.test>'), m('tm-3', laras, [aliceP], 'Great, Friday it is. Mango posters too?', ago(60), '<launch3@client.test>')] });
  put('threads', { id: 'th-invoice', accountId: 'a-alice', workspaceId: 'w-acme', subject: 'Invoice 42', location: 'inbox', starred: false, unread: false, labels: ['finance'], messages: [m('tm-4', { name: 'Billing', email: 'billing@vendor.test' }, [aliceP], 'Your invoice 42 is attached.', ago(300), '<inv42@vendor.test>', { html: '<p>Your <b>invoice 42</b> is attached.</p>' })] });
  put('threads', { id: 'th-done', accountId: 'a-alice', workspaceId: 'w-acme', subject: 'Old kiwi thread', location: 'archive', starred: false, unread: false, labels: [], messages: [m('tm-5', laras, [aliceP], 'Kiwi notes from last month', ago(5000), '<kiwi@client.test>')] });
  put('threads', { id: 'th-hello', accountId: 'a-hello', workspaceId: 'w-acme', subject: 'Do you ship to Bali?', location: 'inbox', starred: false, unread: true, labels: [], messages: [m('tm-6', { name: 'Visitor', email: 'visitor@else.test' }, [{ name: 'Acme', email: 'hello@acme.test' }], 'Do you ship papaya to Bali?', ago(30), '<bali@else.test>')] });
  put('threads', { id: 'th-carol', accountId: 'a-carol', workspaceId: 'w-acme', subject: 'Carol only', location: 'inbox', starred: false, unread: true, labels: [], messages: [m('tm-7', laras, [{ name: 'Carol', email: 'carol@acme.test' }], 'Just for Carol', ago(20), '<carol@client.test>')] });

  /* ---------- the app: signing in, and Settings, Phone mail apps ---------- */
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
      ok: r.ok && cookie.startsWith('s2g='),
      call,
      json: async (method, path, body) => {
        const x = await call(method, path, body);
        return { status: x.status, ...(await x.json().catch(() => ({}))) };
      },
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
    };
  };
  const alice = await signIn('alice@acme.test');
  const bob = await signIn('bob@acme.test');
  const carol = await signIn('carol@acme.test');
  const erin = await signIn('erin@offco.test');
  check(alice.ok && bob.ok && carol.ok && erin.ok, 'people sign in to the app');

  const info = await alice.json('GET', '/api/mailapps');
  check(info.status === 200 && info.on === true && info.host === MAIL_HOST && info.ports?.imap === imapsPort && info.username === 'alice@acme.test', 'Settings says mail apps work here, with the server, ports and username');
  check(info.mailboxes?.length === 2 && info.mailboxes.find((x) => x.top)?.email === 'alice@acme.test' && info.mailboxes.some((x) => x.email === 'hello@acme.test' && x.shared), 'it lists her own mailbox first and the shared inbox she’s on');
  const wrongPw = await alice.json('POST', '/api/mailapps/passwords', { name: 'iPhone', password: 'not-her-password' });
  check(wrongPw.status === 401, 'making an app password asks for the sprint2go password first');
  const made = await alice.json('POST', '/api/mailapps/passwords', { name: 'iPhone', password });
  check(made.status === 200 && /^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(made.password ?? ''), 'a new app password is shown once, four groups of four letters');
  const listed = await alice.json('GET', '/api/mailapps');
  check(listed.passwords?.length === 1 && listed.passwords[0].name === 'iPhone' && !JSON.stringify(listed).includes(made.password) && !JSON.stringify(listed).includes(made.password.replace(/-/g, '')), 'the list shows its name, never the password again');
  const stored = db.prepare('SELECT hash FROM app_passwords WHERE id = ?').get(made.id);
  check(!!stored && !stored.hash.includes(made.password.replace(/-/g, '')) && stored.hash.length === 64, 'only a keyed hash is stored');
  const bobPw = (await bob.json('POST', '/api/mailapps/passwords', { name: 'Android', password })).password;
  const carolPw = (await carol.json('POST', '/api/mailapps/passwords', { name: 'Laptop', password })).password;
  const erinPw = (await erin.json('POST', '/api/mailapps/passwords', { name: 'Phone', password })).password;
  const erinInfo = await erin.json('GET', '/api/mailapps');
  check(erinInfo.off?.length === 1 && erinInfo.off[0].name === 'Offco' && erinInfo.mailboxes?.length === 0, 'for someone whose company switched mail apps off, Settings says so');

  /* ---------- 1. signing in ---------- */
  const imap = (user, pass, opts = {}) => {
    const c = new ImapFlow({ host: '127.0.0.1', port: imapsPort, secure: true, servername: MAIL_HOST, auth: { user, pass }, tls: { rejectUnauthorized: false }, logger: false, emitLogs: false, ...opts });
    c.on('error', () => {});
    return c;
  };
  const a1 = imap('alice@acme.test', made.password);
  await a1.connect();
  clients.push(a1);
  check(a1.authenticated && a1.capabilities.has('IDLE') && a1.capabilities.has('UIDPLUS') && a1.capabilities.has('MOVE') && a1.capabilities.has('SPECIAL-USE') && a1.capabilities.has('CONDSTORE'), 'an app password signs in over TLS (993), with IDLE, UIDPLUS, MOVE, SPECIAL-USE and CONDSTORE');
  const tryLogin = async (user, pass, opts) => {
    const c = imap(user, pass, opts);
    try {
      await c.connect();
      await c.logout();
      return 'ok';
    } catch (e) {
      return e.authenticationFailed || /AUTHENTICATIONFAILED|AUTHORIZATIONFAILED|Authentication failed/i.test(`${e.responseText ?? ''} ${e.message}`) ? 'refused' : `error: ${e.message}`;
    }
  };
  check((await tryLogin('alice@acme.test', password)) === 'refused', 'her normal sprint2go password is refused over IMAP');
  check((await tryLogin('alice@acme.test', 'abcd-efgh-ijkl-mnop')) === 'refused', 'a wrong app password is refused');
  check((await tryLogin('bob@acme.test', made.password)) === 'refused', 'her app password doesn’t sign in as someone else');
  check((await tryLogin('alice@acme.test', made.password.toUpperCase().replace(/-/g, ' '))) === 'ok', 'spaces or capitals in the app password don’t matter');

  // The plain port: nothing signs in before STARTTLS.
  const plain = await new Promise((res) => {
    const s = connect(imapPort, '127.0.0.1');
    let got = '';
    s.on('data', (d) => {
      got += d;
      if (got.includes('a1 ') && !got.includes('a2 ')) s.write(`a2 LOGIN alice@acme.test ${made.password}\r\n`);
      if (got.includes('a2 ')) (s.end(), res(got));
    });
    s.once('data', () => s.write('a1 CAPABILITY\r\n'));
    s.on('error', () => res(got));
  });
  check(/STARTTLS/.test(plain) && /LOGINDISABLED/.test(plain) && !/AUTH=PLAIN/.test(plain) && /a2 NO \[PRIVACYREQUIRED\]/.test(plain), 'port 143 before STARTTLS: LOGINDISABLED, no AUTH=, and LOGIN is refused');
  const viaStarttls = imap('alice@acme.test', made.password, { port: imapPort, secure: false, doSTARTTLS: true });
  await viaStarttls.connect();
  check(viaStarttls.authenticated && viaStarttls.secureConnection !== false, 'STARTTLS on 143, then the app password signs in');
  await viaStarttls.logout();
  // STARTTLS can't be fooled by commands sent along with it (they're thrown away).
  const injected = await new Promise((res) => {
    const s = connect(imapPort, '127.0.0.1');
    let got = '';
    s.once('data', () => s.write('a1 STARTTLS\r\na2 CAPABILITY\r\n'));
    s.on('data', (d) => (got += d));
    setTimeout(() => (s.destroy(), res(got)), 800);
  });
  check(/a1 OK/.test(injected) && !/a2 /.test(injected), 'commands sent right after STARTTLS (before the handshake) are ignored');
  // Before signing in, nobody gets to send us megabytes.
  const big = await new Promise((res) => {
    const s = tlsConnect({ host: '127.0.0.1', port: imapsPort, rejectUnauthorized: false });
    let got = '';
    s.once('data', () => s.write('a1 LOGIN {200000}\r\n'));
    s.on('data', (d) => (got += d));
    setTimeout(() => (s.destroy(), res(got)), 800);
  });
  check(/a1 NO \[TOOBIG\]/.test(big) && !/\+ Ready/.test(big), 'a big literal before signing in is refused without being read');

  /* ---------- 2. folders ---------- */
  const folders = await a1.list();
  const byPath = new Map(folders.map((f) => [f.path, f]));
  const has = (p, use) => byPath.has(p) && (!use || byPath.get(p).specialUse === use);
  check(has('INBOX') && has('Sent', '\\Sent') && has('Drafts', '\\Drafts') && has('Archive', '\\Archive') && has('Trash', '\\Trash') && has('Spam', '\\Junk') && has('Snoozed'), 'INBOX, Sent, Drafts, Archive (Done), Snoozed, Trash and Spam, with special-use flags');
  check(['Clients', 'Team', 'Infra', 'Finance'].every((l) => has(l)), 'labels show as folders');
  check(has('hello@acme.test/Inbox') && has('hello@acme.test/Sent') && !byPath.get('hello@acme.test/Sent').specialUse, 'the shared inbox is its own folder tree (without special-use flags, so phones keep using her own Sent)');
  const c1 = imap('carol@acme.test', carolPw);
  await c1.connect();
  clients.push(c1);
  const carolFolders = (await c1.list()).map((f) => f.path);
  check(carolFolders.includes('INBOX') && !carolFolders.some((p) => p.startsWith('hello@')), 'someone not on the shared inbox doesn’t see it');
  const sneak = await c1.mailboxOpen('hello@acme.test/Inbox').then(() => 'opened', () => 'refused');
  check(sneak === 'refused', 'and can’t open it by name');
  const cInbox = await c1.mailboxOpen('INBOX');
  const carolMail = [];
  for await (const x of c1.fetch('1:*', { envelope: true })) carolMail.push(x.envelope.subject);
  check(cInbox.exists === 1 && carolMail.join() === 'Carol only', 'Carol sees only her own mail');

  /* ---------- 3. reading ---------- */
  const inbox = await a1.mailboxOpen('INBOX');
  check(inbox.exists === 3, `INBOX holds the received messages of inbox conversations (3: two from the launch thread, the invoice; got ${inbox.exists})`);
  const msgs = [];
  for await (const x of a1.fetch('1:*', { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true })) msgs.push(x);
  const launch = msgs.filter((x) => x.envelope.subject?.includes('Banana launch'));
  const lead = launch.find((x) => x.envelope.messageId === '<launch3@client.test>');
  const older = launch.find((x) => x.envelope.messageId === '<launch1@client.test>');
  check(launch.length === 2 && !lead.flags.has('\\Seen') && older.flags.has('\\Seen'), 'an unread conversation: its newest incoming message is unseen, the older ones are read');
  check(older.flags.has('\\Answered') && !lead.flags.has('\\Answered'), 'a message she answered is \\Answered');
  check(lead.envelope.from?.[0]?.address === 'laras@client.test' && lead.envelope.inReplyTo === '<launch2@acme.test>', 'ENVELOPE: sender, subject, Message-ID and In-Reply-To');
  const invoice = msgs.find((x) => x.envelope.subject === 'Invoice 42');
  check(invoice.bodyStructure?.type === 'multipart/alternative' && invoice.bodyStructure.childNodes?.length === 2, 'BODYSTRUCTURE of a rebuilt HTML message (text and HTML alternatives)');
  const full = await a1.fetchOne(String(invoice.uid), { source: true, size: true }, { uid: true });
  const parsedInv = await simpleParser(full.source);
  check(full.source.length === full.size && parsedInv.text?.includes('invoice 42') && parsedInv.html?.includes('<b>invoice 42</b>') && parsedInv.messageId === '<inv42@vendor.test>', 'BODY[] is real RFC 822 (rebuilt for older mail), and RFC822.SIZE matches it');
  const again = await a1.fetchOne(String(invoice.uid), { source: true }, { uid: true });
  check(Buffer.compare(again.source, full.source) === 0, 'the same bytes every time');
  const part = await a1.download(String(invoice.uid), '2', { uid: true });
  let partText = '';
  for await (const ch of part.content) partText += ch;
  check(partText.includes('<b>invoice 42</b>'), 'BODY[2] (the HTML part) on its own');
  const head = await a1.fetchOne(String(invoice.uid), { headers: ['subject', 'from'] }, { uid: true });
  check(/^Subject: Invoice 42/im.test(head.headers.toString()) && !/^Date:/im.test(head.headers.toString()), 'BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)] gives just those');
  const peeked = doc('threads', 'th-launch');
  check(peeked.unread === true, 'fetching with PEEK leaves it unread');
  const hits = await a1.search({ from: 'laras', seen: false }, { uid: true });
  check(hits.length === 1 && hits[0] === lead.uid, 'SEARCH FROM laras UNSEEN finds the unread one');
  const textHits = await a1.search({ body: 'mango posters' }, { uid: true });
  check(textHits.length === 1 && textHits[0] === lead.uid, 'SEARCH BODY finds words in the message');

  /* ---------- 3b. changes go both ways ---------- */
  await a1.messageFlagsAdd(String(lead.uid), ['\\Seen'], { uid: true });
  check((await waitFor(() => doc('threads', 'th-launch').unread === false, 3000)) === true, 'marking it read in the mail app marks the conversation read in sprint2go');
  await a1.messageFlagsAdd(String(lead.uid), ['\\Flagged'], { uid: true });
  check((await waitFor(() => doc('threads', 'th-launch').starred === true, 3000)) === true, 'flagging it stars it in sprint2go');
  // The app changes it: the mail app sees it on its next look.
  const t = doc('threads', 'th-launch');
  const synced = await alice.sync('threads', [{ ...t, unread: true, starred: false }]);
  check(synced.status === 200, 'the app marks it unread and takes the star off');
  const flagsNow = await a1.fetchOne(String(lead.uid), { flags: true }, { uid: true });
  check(!flagsNow.flags.has('\\Seen') && !flagsNow.flags.has('\\Flagged'), 'the mail app sees the change');
  await a1.messageFlagsRemove(String(older.uid), ['\\Seen'], { uid: true });
  const olderNow = await a1.fetchOne(String(older.uid), { flags: true }, { uid: true });
  check(doc('threads', 'th-launch').unread === true && !olderNow.flags.has('\\Seen'), 'marking an older message unread keeps it unread there too');

  /* ---------- moving, labels, deleting ---------- */
  const moved = await a1.messageMove(String(invoice.uid), 'Archive', { uid: true });
  check(!!moved && doc('threads', 'th-invoice').location === 'archive' && moved.uidMap?.size === 1, 'MOVE to Archive marks the conversation Done in sprint2go (with COPYUID)');
  await a1.mailboxOpen('Archive');
  const archived = await a1.search({ all: true }, { uid: true });
  check(archived.length === 2, 'Archive holds it and the older Done conversation');
  await a1.messageCopy(String(archived[archived.length - 1]), 'Clients', { uid: true });
  check(doc('threads', 'th-invoice').labels.includes('clients') && doc('threads', 'th-invoice').location === 'archive', 'COPY to a label folder adds the label');
  await a1.mailboxOpen('Clients');
  const inClients = await a1.search({ all: true }, { uid: true });
  await a1.messageMove(String(inClients[0]), 'Team', { uid: true });
  const labels = doc('threads', 'th-invoice').labels;
  check(labels.includes('team') && !labels.includes('clients'), 'MOVE between label folders swaps the label');
  await a1.mailboxOpen('INBOX');
  const inbox2 = await a1.search({ all: true }, { uid: true });
  await a1.messageDelete(String(inbox2[0]), { uid: true });
  check(doc('threads', 'th-launch').location === 'trash', 'deleting in INBOX moves the conversation to Trash');
  await a1.mailboxOpen('Trash');
  const inTrash = await a1.search({ all: true }, { uid: true });
  check(inTrash.length === 3, 'Trash holds the whole conversation');
  await a1.messageDelete('1:*', { uid: true });
  check(doc('threads', 'th-launch') === null, 'deleting in Trash deletes it for good');
  const snooze = await a1.messageMove('1:*', 'Snoozed', { uid: true }).catch(() => null);
  void snooze;
  await a1.mailboxOpen('Archive');
  const toSnooze = await a1.search({ all: true }, { uid: true });
  await a1.messageMove(String(toSnooze[0]), 'Snoozed', { uid: true });
  const snoozedThread = [doc('threads', 'th-done'), doc('threads', 'th-invoice')].find((x) => x.snoozedUntil);
  check(!!snoozedThread && snoozedThread.snoozedUntil > now(), 'MOVE to Snoozed snoozes it until tomorrow morning');

  /* ---------- 4. drafts and APPEND ---------- */
  const draftRaw = Buffer.from(['From: Alice Martin <alice@acme.test>', 'To: Laras Client <laras@client.test>', 'Subject: Draft about guava', 'Message-ID: <draft1@acme.test>', 'Date: ' + new Date().toUTCString(), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Thinking about guava.', ''].join('\r\n'));
  const appended = await a1.append('Drafts', draftRaw, ['\\Draft', '\\Seen']);
  const draftThread = await waitFor(() => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE '%Draft about guava%'").all().map((r) => JSON.parse(r.data))[0]);
  check(!!appended?.uid && !!draftThread && draftThread.location === 'drafts' && draftThread.accountId === 'a-alice' && draftThread.messages[0].body === 'Thinking about guava.', 'APPEND to Drafts makes a draft in sprint2go (with APPENDUID)');
  await a1.mailboxOpen('Drafts');
  const d1 = await a1.fetchOne(String(appended.uid), { source: true, flags: true }, { uid: true });
  check(Buffer.compare(d1.source, draftRaw) === 0 && d1.flags.has('\\Draft'), 'the draft reads back byte for byte, flagged \\Draft');
  await a1.messageDelete(String(appended.uid), { uid: true });
  check(doc('threads', draftThread.id) === null, 'a draft the mail app replaces (delete) is gone from sprint2go');

  /* ---------- 5. IDLE wakes up when mail arrives ---------- */
  const a2 = imap('alice@acme.test', made.password);
  await a2.connect();
  clients.push(a2);
  await a2.mailboxOpen('INBOX');
  let woke = null;
  a2.on('exists', (e) => (woke = e));
  // What phones do with an open folder: IDLE, and wait to be told.
  void a2.idle().catch(() => {});
  await sleep(300);
  const smtpIn = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, tls: { rejectUnauthorized: false } });
  const sentAt = Date.now();
  await smtpIn.sendMail({ from: 'Bima <bima@outside.test>', to: 'alice@acme.test', subject: 'Fresh papaya news', text: 'Papaya arrives tomorrow.', messageId: '<papaya@outside.test>' });
  const exists = await waitFor(() => woke, 8000);
  check(!!exists && exists.count >= 1, `IDLE: the mail app hears about new mail within moments (${exists ? Date.now() - sentAt : '-'} ms)`);
  const fresh = await a2.fetchOne('*', { source: true, envelope: true });
  check(fresh.envelope.subject === 'Fresh papaya news' && fresh.source.toString().includes('Message-ID: <papaya@outside.test>'), 'new mail is served exactly as it arrived (its source is kept)');

  /* ---------- 6. sending from a mail app ---------- */
  const submit = (user, pass, opts = {}) => nodemailer.createTransport({ host: '127.0.0.1', port: subsPort, secure: true, auth: { user, pass }, tls: { rejectUnauthorized: false, servername: MAIL_HOST }, ...opts });
  const subject = `Guava proposal ${randomBytes(3).toString('hex')}`;
  canSend();
  const sent = await submit('alice@acme.test', made.password).sendMail({ from: 'Alice Martin <alice@acme.test>', to: 'Client One <one@client.test>', cc: 'bob@acme.test', bcc: 'secret@client.test', subject, text: 'Here is the guava proposal.', html: '<p>Here is the <b>guava</b> proposal.</p>', messageId: '<guava-1@acme.test>' }).then((r) => r, (e) => e);
  check(!!sent.accepted?.length, `the mail app sends through 465 with its app password (${sent.response ?? sent.message})`);
  const sentThread = await waitFor(() => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${subject}%`).map((r) => JSON.parse(r.data)).find((x) => x.accountId === 'a-alice'));
  check(!!sentThread && sentThread.location === 'archive' && sentThread.messages[0].from.email === 'alice@acme.test' && sentThread.messages[0].mid === '<guava-1@acme.test>' && !sentThread.messages[0].tracking, 'it shows in sprint2go’s Sent (a conversation of hers, no read tracking)');
  const out = await waitFor(() => (sunk.filter((x) => x.raw.includes(subject)).length >= 2 ? sunk.filter((x) => x.raw.includes(subject)) : null));
  check(!!out && out.some((x) => x.to.includes('one@client.test')) && out.some((x) => x.to.includes('secret@client.test')), 'the mail engine delivers it to the outside recipients, Bcc included');
  check(!!out && out.every((x) => /^DKIM-Signature: v=1;[^]*?\bd=acme\.test;/im.test(x.raw.toString().split(/\r?\n\r?\n/)[0]) && !/^Bcc:/im.test(x.raw.toString())), 'DKIM-signed for acme.test, and no Bcc line leaves');
  const bobCopy = await waitFor(() => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${subject}%`).map((r) => JSON.parse(r.data)).find((x) => x.accountId === 'a-bob'));
  check(!!bobCopy && !JSON.stringify(bobCopy).includes('secret@client.test'), 'a teammate on Cc gets it in sprint2go, without the Bcc');
  const delivered = await waitFor(() => doc('threads', sentThread.id)?.messages[0].delivery?.state === 'sent');
  check(!!delivered, 'its delivery state in sprint2go turns to sent');
  await a1.mailboxOpen('Sent');
  const sentList = [];
  for await (const x of a1.fetch('1:*', { envelope: true, uid: true })) sentList.push(x);
  const guava = sentList.filter((x) => x.envelope.messageId === '<guava-1@acme.test>');
  check(guava.length === 1, 'the mail app finds it in its Sent folder');
  // iPhone and Thunderbird also put a copy in Sent themselves: it doesn't show twice.
  const copy = Buffer.from([`From: Alice Martin <alice@acme.test>`, 'To: one@client.test', `Subject: ${subject}`, 'Message-ID: <guava-1@acme.test>', 'Date: ' + new Date().toUTCString(), '', 'Here is the guava proposal.', ''].join('\r\n'));
  const dupe = await a1.append('Sent', copy, ['\\Seen']);
  await a1.mailboxOpen('Sent');
  const sentAgain = [];
  for await (const x of a1.fetch('1:*', { envelope: true, uid: true })) sentAgain.push(x);
  check(sentAgain.filter((x) => x.envelope.messageId === '<guava-1@acme.test>').length === 1 && dupe?.uid === guava[0].uid, 'appending the same sent mail to Sent doesn’t make a second copy');
  // A reply sent from the mail app lands in its conversation.
  const reply = await submit('alice@acme.test', made.password).sendMail({ from: 'alice@acme.test', to: 'bima@outside.test', subject: 'Re: Fresh papaya news', text: 'Thanks!', inReplyTo: '<papaya@outside.test>', references: ['<papaya@outside.test>'] }).then((r) => r, (e) => e);
  const papaya = await waitFor(() => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE '%Fresh papaya news%'").all().map((r) => JSON.parse(r.data)).find((x) => x.accountId === 'a-alice' && x.messages.length === 2));
  check(!!reply.accepted?.length && !!papaya, 'a reply from the mail app joins its conversation in sprint2go');
  // Only her own addresses.
  const asBob = await submit('alice@acme.test', made.password).sendMail({ from: 'bob@acme.test', to: 'x@client.test', subject: 'pretending', text: 'no' }).then(() => 'sent', (e) => e.responseCode);
  check(asBob === 553, 'she can’t send as Bob (553)');
  const headerOnly = await submit('alice@acme.test', made.password).sendMail({ envelope: { from: 'alice@acme.test', to: ['x@client.test'] }, raw: 'From: hello@outside.test\r\nTo: x@client.test\r\nSubject: header\r\n\r\nno\r\n' }).then(() => 'sent', (e) => e.responseCode);
  check(headerOnly === 553, 'or put someone else’s address in the From line');
  canSend();
  const asAlias = await submit('alice@acme.test', made.password).sendMail({ from: 'Sales <sales@acme.test>', to: 'buyer@client.test', subject: 'From sales', text: 'Hello from sales' }).then((r) => r.accepted?.length ?? 0, (e) => e.message);
  check(asAlias === 1, 'an alias that delivers into her mailbox works');
  canSend();
  const asShared = await submit('bob@acme.test', bobPw).sendMail({ from: 'Acme <hello@acme.test>', to: 'buyer@client.test', subject: 'From the shared inbox', text: 'Hello' }).then((r) => r.accepted?.length ?? 0, (e) => e.message);
  const sharedSent = await waitFor(() => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE '%From the shared inbox%'").all().map((r) => JSON.parse(r.data)).find((x) => x.accountId === 'a-hello'));
  check(asShared === 1 && !!sharedSent, 'someone on a shared inbox sends from it; it lands in the shared inbox’s Sent');
  const normal = await submit('alice@acme.test', password).sendMail({ from: 'alice@acme.test', to: 'x@client.test', subject: 'n', text: 'n' }).then(() => 'sent', (e) => e.responseCode);
  check(normal === 535, 'her normal password is refused for sending too (535)');
  const noTls = await nodemailer.createTransport({ host: '127.0.0.1', port: subPort, secure: false, ignoreTLS: true, auth: { user: 'alice@acme.test', pass: made.password } }).sendMail({ from: 'alice@acme.test', to: 'x@client.test', subject: 'n', text: 'n' }).then(() => 'sent', (e) => e.responseCode ?? e.code);
  check(noTls !== 'sent', `587 refuses to sign in before STARTTLS (${noTls})`);
  canSend();
  const viaStart = await nodemailer.createTransport({ host: '127.0.0.1', port: subPort, secure: false, requireTLS: true, auth: { user: 'alice@acme.test', pass: made.password }, tls: { rejectUnauthorized: false, servername: MAIL_HOST } }).sendMail({ from: 'alice@acme.test', to: 'starttls@client.test', subject: 'Over STARTTLS', text: 'ok' }).then((r) => r.accepted?.length ?? 0, (e) => e.message);
  check(viaStart === 1, 'and sends after STARTTLS on 587');

  /* ---------- removed app passwords, lockout ---------- */
  const b1 = imap('bob@acme.test', bobPw);
  await b1.connect();
  clients.push(b1);
  await b1.mailboxOpen('INBOX');
  let bobClosed = false;
  b1.on('close', () => (bobClosed = true));
  const bobId = (await bob.json('GET', '/api/mailapps')).passwords[0].id;
  const removed = await bob.json('POST', '/api/mailapps/passwords/remove', { id: bobId });
  await b1.noop().catch(() => {});
  check(removed.status === 200 && !!(await waitFor(() => bobClosed, 4000)), 'removing an app password ends the mail app’s connection');
  check((await tryLogin('bob@acme.test', bobPw)) === 'refused', 'and it no longer signs in');

  /* ---------- 7. a company that switches mail apps off; autoconfig; the Apple profile ---------- */
  check((await tryLogin('erin@offco.test', erinPw)) === 'refused', 'nobody signs in to mail apps at a company that switched them off');
  let aliceClosed = false;
  a2.on('close', () => (aliceClosed = true));
  const w = doc('workspaces', 'w-acme');
  const off = await alice.sync('workspaces', [{ ...w, mailApps: false }]);
  check(off.status === 200 && doc('workspaces', 'w-acme').mailApps === false, 'an admin switches “Let people use other mail apps” off');
  check(!!(await waitFor(() => aliceClosed, 4000)), 'her open mail app connections end at once');
  const memberTry = await bob.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), mailApps: true }]);
  check(doc('workspaces', 'w-acme').mailApps === false && memberTry.status === 200, 'a member can’t switch it back on');
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), mailApps: true }]);

  const ac = await fetch(`${base}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=alice@acme.test`);
  const acText = await ac.text();
  check(ac.status === 200 && acText.includes(`<hostname>${MAIL_HOST}</hostname>`) && acText.includes(`<port>${imapsPort}</port>`) && acText.includes('<socketType>STARTTLS</socketType>') && acText.includes('%EMAILADDRESS%'), 'Thunderbird’s autoconfig at the well-known address');
  const prof = await alice.call('GET', '/api/mailapps/profile?mailbox=alice@acme.test');
  const profText = await prof.text();
  check(prof.status === 200 && (prof.headers.get('content-type') ?? '').includes('apple-aspen-config') && profText.includes('<string>alice@acme.test</string>') && profText.includes(MAIL_HOST) && !profText.includes(made.password) && !/<key>(IncomingPassword|OutgoingPassword)<\/key>/.test(profText), 'the Apple profile fills in everything but the password');

  // Lockout: ten wrong tries for one username, then even the right password waits.
  const lockPw = (await carol.json('POST', '/api/mailapps/passwords', { name: 'Second', password })).password;
  for (let i = 0; i < 10; i++) await tryLogin('carol@acme.test', `wrong-${i}-pass-word-xx`);
  check((await tryLogin('carol@acme.test', lockPw)) === 'refused', 'after 10 failed tries a username is locked for a while, like the web sign-in');

  // Changing the sprint2go password ends every app password.
  const changed = await alice.json('POST', '/api/password', { current: password, next: password + 'x' });
  const left = db.prepare("SELECT COUNT(*) AS n FROM app_passwords WHERE user_id = 'u-alice'").get().n;
  check(changed.status === 200 && left === 0 && (await tryLogin('alice@acme.test', made.password)) === 'refused', 'changing the sprint2go password removes every app password');
  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll phone mail app checks passed');
await finish(failed ? 1 : 0);
