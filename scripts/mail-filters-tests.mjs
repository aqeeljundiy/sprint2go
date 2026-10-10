// Mail labels and filters (src/mailFilterMatch.ts, server/mailFilters.ts), end to end on a production-like server: no
// demo data, a throwaway data folder, free test ports, and a local SMTP sink as "the world", so nothing ever leaves
// this machine. Mail arrives over SMTP like real mail.
//  1. the matcher: every criterion (from, to, subject, words, size, files, list, the address it came in through)
//  2. labels: made, nested, renamed, deleted (the mail stays), per mailbox or the company's, and who may do what
//  3. filters on arriving mail: every action, run order, company filters first, stop, blocked senders
//  4. forwarding: only to confirmed or company addresses, within the company's rule
//  5. applying a filter to mail already here, with Undo; the "N emails match" preview
//  6. permissions: members can't make company or shared inbox filters, nobody sees someone else's
//  7. phone mail apps (IMAP): label folders nest, filtered mail shows in them, folders made in a mail app are labels
//   node --import ./server/register.mjs scripts/mail-filters-tests.mjs
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { criteriaFromSearch, factsOf, labelPath, labelTree, matches, subtree } from '../src/mailFilterMatch.ts';

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

/* ---------- 1. the matcher ---------- */
{
  const nadia = { name: 'Nadia Putri', email: 'nadia@kopikita.co.id' };
  const f = (extra = {}) => ({ from: nadia, to: [{ name: 'Aqeel', email: 'aqeel@pnp.test' }], subject: 'Invoice 42 for October', body: 'Please find the purchase order attached. Thanks!', size: 120_000, attachments: [{ name: 'PO-42.pdf' }], ...extra });
  check(matches({ from: 'nadia@kopikita.co.id' }, f()) && !matches({ from: 'dimas@kopikita.co.id' }, f()), 'from: an exact address');
  check(matches({ from: '@kopikita.co.id' }, f()) && matches({ from: 'kopikita.co.id' }, f()) && matches({ from: 'co.id' }, f()), 'from: a domain, with or without @, and its parent domain');
  check(matches({ from: '@mail.kopikita.co.id' }, f()) === false && matches({ from: '@kopikita.co.id' }, f({ from: { email: 'a@mail.kopikita.co.id' } })), 'from: a domain matches its subdomains, not the other way round');
  check(matches({ from: '*@kopi*.co.id' }, f()) && !matches({ from: '*@bank.co.id' }, f()), 'from: wildcards');
  check(matches({ from: 'nadia' }, f()) && matches({ from: 'Putri' }, f()), 'from: part of the name or address');
  check(matches({ from: 'dimas@x.test, @kopikita.co.id' }, f()) && matches({ from: 'dimas@x.test OR nadia@kopikita.co.id' }, f()), 'from: a list (commas or OR)');
  check(matches({ to: 'aqeel@pnp.test' }, f()) && matches({ to: '@pnp.test' }, f({ to: [{ email: 'x@else.test' }, { email: 'cc@pnp.test' }] })) && !matches({ to: '@else.test' }, f()), 'to: To and Cc');
  check(matches({ subject: 'invoice' }, f()) && !matches({ subject: 'receipt' }, f()) && matches({ subject: 'invoice october' }, f()), 'subject: every word');
  check(matches({ hasWords: '"purchase order"' }, f()) && !matches({ hasWords: '"order purchase"' }, f()), 'has the words: a phrase in quotes');
  check(matches({ hasWords: 'receipt OR invoice' }, f()) && !matches({ hasWords: 'receipt OR refund' }, f()), 'has the words: OR');
  check(matches({ hasWords: 'invoice -refund' }, f()) && !matches({ hasWords: 'invoice -thanks' }, f()), 'has the words: -word excludes');
  check(matches({ hasWords: 'invoic' }, f()) && !matches({ hasWords: 'nvoice' }, f()), 'words match from the start of a word');
  check(matches({ hasWords: 'kafe' }, f({ body: 'Kafé KopiKita' })), 'accents don’t matter');
  check(matches({ from: '@kopikita.co.id', notWords: 'refund' }, f()) && !matches({ from: '@kopikita.co.id', notWords: 'thanks' }, f()), 'doesn’t have');
  check(matches({ size: { op: 'larger', mb: 0.1 } }, f()) && !matches({ size: { op: 'larger', mb: 1 } }, f()) && matches({ size: { op: 'smaller', mb: 1 } }, f()), 'size: larger and smaller');
  check(matches({ hasAttachment: true }, f()) && !matches({ hasAttachment: true }, f({ attachments: [] })) && !matches({ hasAttachment: true }, f({ attachments: [{ name: 'invite.ics' }] })), 'has attachment (a calendar invite isn’t one)');
  check(matches({ attachment: 'pdf' }, f()) && matches({ attachment: 'document' }, f()) && !matches({ attachment: 'spreadsheet' }, f()) && matches({ attachment: 'PO-*' }, f()) && matches({ attachment: 'po-42' }, f()), 'attachment: a type, a wildcard or part of the name');
  check(matches({ list: 'news.acme.test' }, f({ listId: 'Acme News <news.acme.test>' })) && matches({ list: '*' }, f({ listId: '<x.test>' })) && !matches({ list: '*' }, f()), 'mailing list: by its List-Id, or any list');
  check(matches({ deliveredTo: 'sales@pnp.test' }, f({ deliveredTo: ['sales@pnp.test'] })) && !matches({ deliveredTo: 'sales@pnp.test' }, f({ deliveredTo: ['aqeel@pnp.test'] })), 'sent to: the address it came in through');
  check(!matches({}, f()) && !matches({ from: '  ' }, f()), 'an empty filter matches nothing');
  check(matches({ from: '@kopikita.co.id', subject: 'invoice', hasAttachment: true }, f()) && !matches({ from: '@kopikita.co.id', subject: 'receipt' }, f()), 'every criterion must hold');
  const facts = factsOf('Weekly news', { from: { email: 'n@news.test' }, to: [{ email: 'a@b.test' }], cc: [{ email: 'c@b.test' }], body: 'hi', listUnsubscribe: { url: 'https://news.acme.test/u?x=1' }, attachments: [{ name: 'a.pdf', size: '1.5 MB' }] });
  check(facts.listId === 'news.acme.test' && facts.to.length === 2 && facts.size > 1.5 * 1024 * 1024, 'older mail: the unsubscribe link stands in for List-Id, Cc counts as To, sizes come from the files');
  const c = criteriaFromSearch('from:@dokploy.com subject:"server down" has:attachment larger:2M deploy -test');
  check(c.from === '@dokploy.com' && c.subject === 'server down' && c.hasAttachment && c.size?.mb === 2 && c.size.op === 'larger' && c.hasWords === 'deploy' && c.notWords === 'test', 'a search becomes the same filter');
  const L = [
    { id: 'a', workspaceId: 'w', accountId: null, name: 'Clients', parentId: null, color: '#000', show: 'show' },
    { id: 'b', workspaceId: 'w', accountId: null, name: 'KopiKita', parentId: 'a', color: '#000', show: 'show' },
    { id: 'c', workspaceId: 'w', accountId: null, name: 'Q4', parentId: 'b', color: '#000', show: 'show' },
  ];
  check(labelPath(L[2], L) === 'Clients/KopiKita/Q4' && subtree('a', L).length === 3 && labelTree(L).map((x) => x.depth).join() === '0,1,2', 'nested labels: their path, what’s inside, the tree');
}

/* ---------- the server ---------- */
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
const dir = mkdtempSync(join(tmpdir(), 's2g-filters-'));
const [httpPort, smtpPort, imapPort, imapsPort, subPort, subsPort, sinkPort] = await Promise.all(Array.from({ length: 7 }, freePort));
const base = `http://127.0.0.1:${httpPort}`;
const MAIL_HOST = 'mail.s2g-filters.test';

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
  SUPPORT_EMAIL: 'support@s2g-filters.test',
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
  if (!up || !/Phone mail apps: IMAP on/.test(log)) throw new Error('the server didn’t start');

  /* ---------- the company, straight into the database ---------- */
  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const now = () => new Date().toISOString();
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const put = (coll, d) => db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const all = (coll) => db.prepare('SELECT data FROM docs WHERE coll = ?').all(coll).map((r) => JSON.parse(r.data));
  const password = randomBytes(9).toString('hex');
  const person = (id, name, email) => {
    const salt = randomBytes(16);
    put('users', { id, name, email, title: '', color: '#5b5bf6' });
    db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?)').run(id, email, `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`);
  };
  person('u-alice', 'Alice Martin', 'alice@acme.test');
  person('u-bob', 'Bob Stone', 'bob@acme.test');
  person('u-carol', 'Carol Reed', 'carol@acme.test');
  const accounts = [
    { id: 'a-alice', email: 'alice@acme.test', name: 'Alice Martin', kind: 'personal', connected: true, users: ['u-alice'] },
    { id: 'a-bob', email: 'bob@acme.test', name: 'Bob Stone', kind: 'personal', connected: true, users: ['u-bob'] },
    { id: 'a-carol', email: 'carol@acme.test', name: 'Carol Reed', kind: 'personal', connected: true, users: ['u-carol'] },
    { id: 'a-hello', email: 'hello@acme.test', name: 'Acme', kind: 'shared', connected: true, users: ['u-alice', 'u-bob'] },
  ];
  const ready = { at: now(), receive: true, send: true, why: {}, mailboxes: Object.fromEntries(accounts.map((a) => [a.id, { receive: true, send: true }])) };
  put('workspaces', { id: 'w-acme', name: 'Acme', color: '#0ea5e9', domains: ['acme.test'], emailSetup: 'hosted', timeZone: 'Asia/Jakarta', accounts, mailAliases: [{ id: 'al-sales', address: 'sales@acme.test', to: ['a-alice'] }], members: [{ userId: 'u-alice', role: 'owner' }, { userId: 'u-bob', role: 'member' }, { userId: 'u-carol', role: 'member' }], mailReady: ready, createdAt: now() });
  const msgOf = (id, from, subject, body, at, extra = {}) => ({ id, from, to: [{ name: 'Alice', email: 'alice@acme.test' }], date: at, body, mid: `<${id}@x.test>`, ...extra });
  for (let i = 1; i <= 3; i++) put('threads', { id: `th-old${i}`, accountId: 'a-alice', workspaceId: 'w-acme', subject: `Old invoice ${i}`, location: 'inbox', starred: false, unread: true, labels: [], messages: [msgOf(`om${i}`, { name: 'Vendor', email: 'billing@vendor.test' }, `Old invoice ${i}`, 'Your invoice', ago(600 + i))] });
  put('threads', { id: 'th-other', accountId: 'a-alice', workspaceId: 'w-acme', subject: 'Lunch?', location: 'inbox', starred: false, unread: true, labels: [], messages: [msgOf('om9', { name: 'Bob', email: 'friend@else.test' }, 'Lunch?', 'Lunch tomorrow?', ago(30))] });
  put('threads', { id: 'th-bob', accountId: 'a-bob', workspaceId: 'w-acme', subject: 'For Bob', location: 'inbox', starred: false, unread: true, labels: [], messages: [msgOf('om10', { name: 'X', email: 'x@else.test' }, 'For Bob', 'hi', ago(20))] });

  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
      ok: r.ok,
      json: async (method, path, body) => {
        const x = await call(method, path, body);
        return { status: x.status, ...(await x.json().catch(() => ({}))) };
      },
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
      state: (coll) => call('GET', `/api/state?only=${coll}`).then((x) => x.json()).then((s) => s[coll] ?? []),
    };
  };
  const alice = await signIn('alice@acme.test');
  const bob = await signIn('bob@acme.test');
  const carol = await signIn('carol@acme.test');
  check(alice.ok && bob.ok && carol.ok, 'people sign in');

  /* ---------- 2. labels ---------- */
  const label = (id, name, extra = {}) => ({ id, workspaceId: 'w-acme', accountId: 'a-alice', name, parentId: null, color: '#10b981', show: 'show', ...extra });
  let r = await alice.sync('mailLabels', [label('lb-clients', 'Clients'), label('lb-kopi', 'KopiKita', { parentId: 'lb-clients' }), label('lb-news', 'News')]);
  check(r.saved === 3 && doc('mailLabels', 'lb-kopi')?.parentId === 'lb-clients' && doc('mailLabels', 'lb-kopi').createdBy === 'u-alice', 'Alice makes labels in her mailbox, one nested under another');
  r = await alice.sync('mailLabels', [label('lb-dupe', 'clients')]);
  check(r.saved === 0 && /already a label/.test(r.why ?? ''), 'two labels with the same name in the same place aren’t allowed');
  r = await alice.sync('mailLabels', [label('lb-fin', 'Finance', { accountId: null })]);
  check(r.saved === 1 && doc('mailLabels', 'lb-fin')?.accountId === null, 'an admin makes a company label');
  r = await bob.sync('mailLabels', [{ ...label('lb-bobco', 'Bob company'), accountId: null }]);
  check(r.saved === 0 && !doc('mailLabels', 'lb-bobco') && /Only admins/.test(r.why ?? ''), 'a member can’t make a company label');
  r = await bob.sync('mailLabels', [label('lb-hello', 'Leads', { accountId: 'a-hello' })]);
  check(r.saved === 1, 'a member on a shared inbox makes a label the inbox’s team shares');
  r = await carol.sync('mailLabels', [label('lb-carol-in-alice', 'Sneaky')]);
  check(r.saved === 0 && !doc('mailLabels', 'lb-carol-in-alice'), 'nobody makes labels in someone else’s mailbox');
  r = await carol.sync('mailLabels', [], ['lb-clients']);
  check(!!doc('mailLabels', 'lb-clients'), 'nor deletes theirs');
  const bobSees = (await bob.state('mailLabels')).map((l) => l.id).sort().join();
  check(bobSees === 'lb-fin,lb-hello', `Bob sees the company’s labels and his shared inbox’s, not Alice’s own (saw ${bobSees})`);
  r = await alice.sync('mailLabels', [{ ...doc('mailLabels', 'lb-clients'), name: 'Customers' }]);
  check(r.saved === 1 && doc('mailLabels', 'lb-clients').name === 'Customers', 'renaming keeps the label’s id');
  r = await alice.sync('mailLabels', [{ ...doc('mailLabels', 'lb-clients'), parentId: 'lb-kopi' }]);
  check(doc('mailLabels', 'lb-clients').parentId === null, 'a label can’t be nested inside its own sub-label');
  r = await bob.sync('threads', [{ ...doc('threads', 'th-bob'), labels: ['lb-kopi', 'lb-fin'] }]);
  check(JSON.stringify(doc('threads', 'th-bob').labels) === '["lb-fin"]', 'a thread only takes labels of its own mailbox or the company');

  /* ---------- 3. filters on arriving mail ---------- */
  const smtpIn = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, tls: { rejectUnauthorized: false } });
  const arrive = async (mail) => {
    const subject = `${mail.subject} ${randomBytes(3).toString('hex')}`;
    await smtpIn.sendMail({ ...mail, subject });
    const t = await waitFor(() => all('threads').find((x) => x.subject === subject), 8000);
    if (!t) throw new Error(`“${subject}” didn’t arrive`);
    return t;
  };
  const filter = (id, criteria, actions, extra = {}) => ({ id, workspaceId: 'w-acme', accountId: 'a-alice', enabled: true, order: 0, criteria, actions, ...extra });
  r = await alice.sync('mailFilters', [
    filter('f-kopi', { from: '@kopikita.test' }, { labels: ['lb-kopi'], archive: true, star: true }, { order: 1, name: 'KopiKita' }),
    filter('f-read', { subject: 'newsletter' }, { read: true, important: 'no' }, { order: 2 }),
    filter('f-imp', { hasWords: 'urgent' }, { important: 'yes' }, { order: 3 }),
    filter('f-spam', { from: 'spammy@else.test' }, { spam: true }, { order: 4 }),
    filter('f-trash', { subject: 'unsubscribe-me' }, { trash: true }, { order: 5 }),
    filter('f-list', { list: 'news.acme-news.test' }, { labels: ['lb-news'] }, { order: 6 }),
    filter('f-alias', { deliveredTo: 'sales@acme.test' }, { labels: ['lb-clients'] }, { order: 7 }),
    filter('f-big', { size: { op: 'larger', mb: 0.25 } }, { labels: ['lb-fin'] }, { order: 8 }),
    filter('f-pdf', { attachment: 'pdf' }, { labels: ['lb-news'] }, { order: 9 }),
    filter('f-snooze', { subject: 'later please' }, { snoozeDays: 2 }, { order: 10 }),
    filter('f-task', { subject: 'todo for me' }, { task: { assignee: 'u-alice', dueDays: 1 } }, { order: 11 }),
    filter('f-reply', { from: 'asker@else.test' }, { reply: { name: 'Thanks', text: 'Thanks, we got it.' } }, { order: 12 }),
  ]);
  check(r.saved === 12, 'Alice makes filters for her mailbox');
  check(doc('mailFilters', 'f-kopi').createdBy === 'u-alice' && doc('mailFilters', 'f-kopi').hits === 0, 'who made it and how often it ran are the server’s');

  let t = await arrive({ from: 'Nadia <nadia@kopikita.test>', to: 'alice@acme.test', subject: 'Q4 concepts', text: 'Here they are.' });
  check(t.labels.includes('lb-kopi') && t.location === 'archive' && t.starred === true && t.filed?.at(-1)?.name === 'KopiKita' && t.filed.at(-1).scope === 'mine', 'label, skip the inbox and star, with “Filed by your filter” on it');
  check((await waitFor(() => doc('mailFilters', 'f-kopi').hits === 1, 3000)) === true, 'the filter counts what it did');
  t = await arrive({ from: 'news@else.test', to: 'alice@acme.test', subject: 'Weekly newsletter', text: 'news' });
  check(t.unread === false && t.important === false && t.location === 'inbox', 'mark as read, never important');
  t = await arrive({ from: 'boss@else.test', to: 'alice@acme.test', subject: 'Please', text: 'This is urgent.' });
  check(t.important === true, 'always mark important (has the words)');
  t = await arrive({ from: 'spammy@else.test', to: 'alice@acme.test', subject: 'Win', text: 'prize' });
  check(t.location === 'spam', 'send to Spam');
  t = await arrive({ from: 'shop@else.test', to: 'alice@acme.test', subject: 'unsubscribe-me deals', text: 'deals' });
  check(t.location === 'trash', 'delete');
  t = await arrive({ from: 'list@acme-news.test', to: 'alice@acme.test', subject: 'List post', text: 'post', headers: { 'List-Id': 'Acme News <news.acme-news.test>' } });
  check(t.labels.includes('lb-news'), 'from a mailing list (List-Id)');
  t = await arrive({ from: 'buyer@else.test', to: 'sales@acme.test', subject: 'Quote', text: 'price?' });
  check(t.accountId === 'a-alice' && t.labels.includes('lb-clients'), 'sent to an alias');
  t = await arrive({ from: 'files@else.test', to: 'alice@acme.test', subject: 'Big', text: 'big', attachments: [{ filename: 'photo.bin', content: randomBytes(320 * 1024) }] });
  check(t.labels.includes('lb-fin') && !t.labels.includes('lb-news'), 'size larger than (and a .bin isn’t a pdf)');
  t = await arrive({ from: 'files@else.test', to: 'alice@acme.test', subject: 'Small', text: 'po', attachments: [{ filename: 'PO-7.pdf', content: Buffer.from('%PDF-1.4 tiny') }] });
  check(t.labels.includes('lb-news') && !t.labels.includes('lb-fin'), 'attachment type');
  t = await arrive({ from: 'self@else.test', to: 'alice@acme.test', subject: 'later please', text: 'x' });
  check(!!t.snoozedUntil && Date.parse(t.snoozedUntil) > Date.now() + 86_400_000, 'snooze');
  t = await arrive({ from: 'pm@else.test', to: 'alice@acme.test', subject: 'todo for me', text: 'Do the thing' });
  const task = await waitFor(() => all('todos').find((x) => x.threadId === t.id), 3000);
  check(!!task && task.userId === 'u-alice' && task.title === t.subject && !!task.due && task.workspaceId === 'w-acme', 'make a task (with its assignee and due date, linked to the email)');
  const sunkBefore = sunk.length;
  t = await arrive({ from: 'Asker <asker@else.test>', to: 'alice@acme.test', subject: 'A question', text: '?' });
  const answer = await waitFor(() => sunk.slice(sunkBefore).find((x) => x.to.includes('asker@else.test')), 5000);
  const answerParsed = answer ? await simpleParser(answer.raw) : null;
  check(!!answer && answerParsed.text.includes('Thanks, we got it.') && /auto-replied/i.test(answerParsed.headers.get('auto-submitted') ?? ''), 'reply with a template (marked as an automatic answer)');
  await arrive({ from: 'Asker <asker@else.test>', to: 'alice@acme.test', subject: 'Another question', text: '?' });
  await sleep(600);
  check(sunk.slice(sunkBefore).filter((x) => x.to.includes('asker@else.test')).length === 1, 'the template answer goes once per sender every 4 days');

  // Order and stop: the first match says stop, so the next one doesn't run.
  await alice.sync('mailFilters', [filter('f-first', { subject: 'ordered' }, { labels: ['lb-clients'] }, { order: -2, stop: true }), filter('f-second', { subject: 'ordered' }, { labels: ['lb-news'] }, { order: -1 })]);
  t = await arrive({ from: 'o@else.test', to: 'alice@acme.test', subject: 'ordered', text: 'x' });
  check(t.labels.includes('lb-clients') && !t.labels.includes('lb-news'), 'filters run in order, and “don’t run later filters” stops the rest');
  await alice.sync('mailFilters', [{ ...doc('mailFilters', 'f-first'), stop: false }]);
  t = await arrive({ from: 'o@else.test', to: 'alice@acme.test', subject: 'ordered', text: 'x' });
  check(t.labels.includes('lb-clients') && t.labels.includes('lb-news'), 'without stop, every matching filter runs (labels add up)');
  await alice.sync('mailFilters', [{ ...doc('mailFilters', 'f-first'), enabled: false }]);
  t = await arrive({ from: 'o@else.test', to: 'alice@acme.test', subject: 'ordered', text: 'x' });
  check(!t.labels.includes('lb-clients') && t.labels.includes('lb-news'), 'a filter switched off doesn’t run');
  // The strongest place wins, and "never send to Spam" beats a Spam filter.
  await alice.sync('mailFilters', [filter('f-tospam', { subject: 'tug of war' }, { spam: true }, { order: 20 }), filter('f-never', { subject: 'tug of war' }, { neverSpam: true, archive: true }, { order: 21 })]);
  t = await arrive({ from: 'o@else.test', to: 'alice@acme.test', subject: 'tug of war', text: 'x' });
  check(t.location === 'archive', 'never send to Spam wins over Send to Spam');
  // Company filters first.
  r = await alice.sync('mailFilters', [{ ...filter('f-company', { subject: 'company wide' }, { labels: ['lb-fin'] }, { order: 99 }), accountId: null }]);
  check(r.saved === 1, 'an admin makes a company filter');
  t = await arrive({ from: 'o@else.test', to: 'carol@acme.test', subject: 'company wide', text: 'x' });
  check(t.accountId === 'a-carol' && t.labels.includes('lb-fin') && t.filed?.[0]?.scope === 'company', 'a company filter runs on everyone’s mail');
  await alice.sync('mailFilters', [filter('f-after', { subject: 'company wide' }, { star: true }, { order: -100 })]);
  t = await arrive({ from: 'o@else.test', to: 'alice@acme.test', subject: 'company wide', text: 'x' });
  check(t.filed?.[0]?.filterId === 'f-company' && t.filed?.[1]?.filterId === 'f-after', 'company filters run before the mailbox’s own, whatever their order');
  // A shared inbox's filter assigns.
  r = await alice.sync('mailFilters', [{ ...filter('f-assign', { subject: 'shipping' }, { assign: 'u-bob' }), accountId: 'a-hello' }]);
  check(r.saved === 1, 'an admin makes a shared inbox filter');
  t = await arrive({ from: 'c@else.test', to: 'hello@acme.test', subject: 'shipping to Bali', text: 'x' });
  check(t.assignee === 'u-bob' && t.filed?.at(-1)?.scope === 'shared', 'assign to a teammate on the shared inbox');
  check(!!(await waitFor(() => all('notices').find((n) => n.userId === 'u-bob' && /assigned to you by a filter/.test(n.text)), 3000)), 'and they’re told');
  // Blocked senders: deleted on arrival, everywhere.
  await alice.sync('prefs', [{ id: 'u-alice', value: { 'pm-blocked:u-alice': [{ id: 'b1', kind: 'domain', value: 'pest.test', at: now() }] } }]);
  t = await arrive({ from: 'x@pest.test', to: 'alice@acme.test', subject: 'Buy now', text: 'x' });
  check(t.location === 'trash' && t.filed?.at(-1)?.scope === 'block', 'a blocked sender’s mail goes to Trash on arrival');
  t = await arrive({ from: 'x@pest.test', to: 'hello@acme.test', subject: 'Buy now too', text: 'x' });
  check(t.location === 'inbox', 'one person’s block doesn’t throw away a shared inbox’s mail');
  // Mail between teammates runs through filters too.
  r = await bob.sync('mailFilters', [{ ...filter('f-bob', { from: 'alice@acme.test' }, { labels: [], star: true }), accountId: 'a-bob' }]);
  const aliceSends = await alice.json('POST', '/api/mail/send', { workspaceId: 'w-acme', accountId: 'a-alice', threadId: 'th-send', messageId: 'm-send', to: [{ name: 'Bob', email: 'bob@acme.test' }], cc: [], subject: 'From a teammate', text: 'hi', html: '<p>hi</p>', files: [] });
  void aliceSends;
  const teammate = await waitFor(() => all('threads').find((x) => x.accountId === 'a-bob' && x.subject === 'From a teammate'), 5000);
  check(r.saved === 1 && !!teammate && teammate.starred === true, 'a teammate’s email runs through the receiver’s filters');

  /* ---------- 4. forwarding ---------- */
  r = await alice.sync('mailFilters', [filter('f-fwd', { subject: 'pass it on' }, { forward: 'boss@outside.test' })]);
  check(r.saved === 0 && /confirmed/.test(r.why ?? ''), 'forwarding to an outside address that hasn’t confirmed is refused');
  const sunkAt = sunk.length;
  const asked = await alice.json('POST', '/api/mail/forwarding', { accountId: 'a-alice', address: 'boss@outside.test' });
  // A test host has no system mail (a .test domain): the link goes to the server's log, as sign-up codes do.
  const confirm = await waitFor(() => sunk.slice(sunkAt).find((x) => x.to.includes('boss@outside.test')), 1500);
  const link = confirm ? (await simpleParser(confirm.raw)).text.match(/https?:\/\/\S+confirm\?token=[a-f0-9]+/)?.[0] : log.match(/to boss@outside\.test \(no system mail here\): (\S+)/)?.[1];
  check(asked.status === 200 && asked.verified === false && !!link, 'adding an outside address sends it a link to confirm');
  const list1 = await alice.json('GET', '/api/mail/forwarding?accountId=a-alice');
  check(list1.addresses?.[0]?.verified === false, 'until it’s opened, it waits');
  const opened = await fetch(link.replace(/^https?:\/\/[^/]+/, base));
  check(opened.status === 200 && (await opened.text()).includes('Forwarding confirmed'), 'opening the link confirms it');
  r = await alice.sync('mailFilters', [filter('f-fwd', { subject: 'pass it on' }, { forward: 'boss@outside.test' })]);
  check(r.saved === 1 && doc('mailFilters', 'f-fwd').actions.forward === 'boss@outside.test', 'then a filter may forward to it');
  const fwdAt = sunk.length;
  await arrive({ from: 'Client <client@else.test>', to: 'alice@acme.test', subject: 'pass it on', text: 'The contract is attached.' });
  const fwd = await waitFor(() => sunk.slice(fwdAt).find((x) => x.to.includes('boss@outside.test')), 5000);
  const fwdParsed = fwd ? await simpleParser(fwd.raw) : null;
  check(!!fwd && fwdParsed.text.includes('The contract is attached.') && fwdParsed.headers.get('x-s2g-forwarded') === 'alice@acme.test' && fwdParsed.replyTo?.value?.[0]?.address === 'client@else.test', 'arriving mail is forwarded (from the mailbox, Reply-To the sender, marked so it never loops)');
  r = await bob.sync('mailFilters', [{ ...filter('f-bob-fwd', { subject: 'to alice' }, { forward: 'alice@acme.test' }), accountId: 'a-bob' }]);
  check(r.saved === 1, 'the company’s own addresses need no confirmation');
  const bobFwd = await arrive({ from: 'c@else.test', to: 'bob@acme.test', subject: 'to alice', text: 'x' });
  check(!!(await waitFor(() => all('threads').find((x) => x.accountId === 'a-alice' && x.subject === bobFwd.subject), 5000)), 'forwarding to a teammate lands in their mailbox');
  // The company's rule: only its own addresses, then off.
  const ws = doc('workspaces', 'w-acme');
  r = await bob.sync('workspaces', [{ ...ws, mailForwarding: 'off' }]);
  check(doc('workspaces', 'w-acme').mailForwarding === undefined, 'a member can’t change the forwarding rule');
  r = await alice.sync('workspaces', [{ ...ws, mailForwarding: 'company' }]);
  check(doc('workspaces', 'w-acme').mailForwarding === 'company', 'an admin limits forwarding to the company’s own addresses');
  const outAt = sunk.length;
  await arrive({ from: 'Client <client@else.test>', to: 'alice@acme.test', subject: 'pass it on', text: 'again' });
  await sleep(800);
  check(!sunk.slice(outAt).some((x) => x.to.includes('boss@outside.test')) && /only allows forwarding to its own/.test(doc('mailFilters', 'f-fwd').problem ?? ''), 'then nothing goes outside, and the filter says why');
  r = await alice.json('POST', '/api/mail/forwarding', { accountId: 'a-alice', address: 'other@outside.test' });
  check(r.status === 403, 'and no new outside address can be added');
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), mailForwarding: 'off' }]);
  r = await bob.sync('mailFilters', [{ ...filter('f-bob-fwd2', { subject: 'x' }, { forward: 'alice@acme.test' }), accountId: 'a-bob' }]);
  check(r.saved === 0 && /switched off/.test(r.why ?? ''), 'with forwarding off, no filter may forward');
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), mailForwarding: 'verified' }]);

  /* ---------- 5. applying to mail already here ---------- */
  const preview = await alice.json('POST', '/api/mail/filters/preview', { workspaceId: 'w-acme', accountId: 'a-alice', criteria: { from: 'billing@vendor.test' } });
  check(preview.count === 3 && preview.sample?.length === 3, `the preview counts the matching conversations (got ${preview.count})`);
  const noPeek = await carol.json('POST', '/api/mail/filters/preview', { workspaceId: 'w-acme', accountId: 'a-alice', criteria: { from: 'billing@vendor.test' } });
  check(noPeek.count === 0, 'nobody counts someone else’s mail');
  await alice.sync('mailFilters', [filter('f-old', { from: 'billing@vendor.test' }, { labels: ['lb-fin'], archive: true, read: true, forward: 'boss@outside.test' })]);
  const applyAt = sunk.length;
  const applied = await alice.json('POST', '/api/mail/filters/apply', { id: 'f-old' });
  const old1 = doc('threads', 'th-old1');
  check(applied.changed === 3 && old1.labels.includes('lb-fin') && old1.location === 'archive' && old1.unread === false && !!applied.undo, 'also apply to the matching conversations: labelled, archived, read');
  await sleep(500);
  check(!sunk.slice(applyAt).some((x) => x.to.includes('boss@outside.test')), 'forwarding never runs on old mail');
  check(doc('threads', 'th-other').labels.length === 0 && doc('threads', 'th-other').location === 'inbox', 'mail that doesn’t match is untouched');
  const undone = await alice.json('POST', '/api/mail/filters/undo', { undo: applied.undo });
  const back = doc('threads', 'th-old1');
  check(undone.restored === 3 && back.labels.length === 0 && back.location === 'inbox' && back.unread === true, 'Undo puts back exactly what changed');
  check((await bob.json('POST', '/api/mail/filters/apply', { id: 'f-old' })).status === 404, 'nobody applies someone else’s filter');

  /* ---------- 6. permissions ---------- */
  r = await bob.sync('mailFilters', [{ ...filter('f-bob-co', { subject: 'x' }, { star: true }), accountId: null }]);
  check(r.saved === 0 && !doc('mailFilters', 'f-bob-co'), 'members can’t make company filters');
  r = await bob.sync('mailFilters', [{ ...filter('f-bob-hello', { subject: 'x' }, { star: true }), accountId: 'a-hello' }]);
  check(r.saved === 0 && !doc('mailFilters', 'f-bob-hello'), 'members can’t make a shared inbox’s filters');
  r = await bob.sync('mailFilters', [{ ...doc('mailFilters', 'f-company'), enabled: false }]);
  check(doc('mailFilters', 'f-company').enabled === true, 'nor switch off a company filter');
  r = await carol.sync('mailFilters', [{ ...filter('f-carol', { subject: 'x' }, { star: true }), accountId: 'a-alice' }]);
  check(r.saved === 0, 'nobody makes filters for someone else’s mailbox');
  r = await bob.sync('mailFilters', [{ ...filter('f-bob-assign', { subject: 'x' }, { assign: 'u-carol' }), accountId: 'a-bob' }]);
  check(r.saved === 0 && /shared inbox/.test(r.why ?? ''), 'assigning is for a shared inbox’s filters only');
  r = await alice.sync('mailFilters', [filter('f-empty', {}, { star: true })]);
  check(r.saved === 0 && /at least one thing/.test(r.why ?? ''), 'a filter that looks for nothing isn’t saved');
  r = await alice.sync('mailFilters', [filter('f-noop', { from: 'x@y.test' }, {})]);
  check(r.saved === 0, 'nor one that does nothing');
  const bobFilters = (await bob.state('mailFilters')).map((f) => f.id);
  check(bobFilters.includes('f-company') && bobFilters.includes('f-assign') && !bobFilters.includes('f-kopi') && bobFilters.includes('f-bob'), 'Bob sees the company’s and his shared inbox’s filters and his own, never Alice’s');
  check((await carol.state('mailFilters')).every((f) => f.accountId === null || f.accountId === 'a-carol'), 'Carol sees only the company’s and her own');

  /* ---------- 7. phone mail apps (IMAP) ---------- */
  const made = await alice.json('POST', '/api/mailapps/passwords', { name: 'iPhone', password });
  const imap = new ImapFlow({ host: '127.0.0.1', port: imapsPort, secure: true, servername: MAIL_HOST, auth: { user: 'alice@acme.test', pass: made.password }, tls: { rejectUnauthorized: false }, logger: false, emitLogs: false });
  imap.on('error', () => {});
  await imap.connect();
  clients.push(imap);
  const folders = new Map((await imap.list()).map((f) => [f.path, f]));
  check(folders.has('Customers') && folders.has('Customers/KopiKita') && folders.has('Finance') && folders.has('News'), 'labels are folders, nested ones under their parent (Customers/KopiKita)');
  check(folders.get('Customers').flags.has('\\HasChildren') && folders.get('Customers/KopiKita').flags.has('\\HasNoChildren'), 'a folder with labels inside says so');
  check(folders.has('hello@acme.test/Leads') && !folders.has('Leads') && folders.has('hello@acme.test/Finance'), 'a shared inbox’s labels stay in its own folder tree (with the company’s)');
  const kopi = await imap.mailboxOpen('Customers/KopiKita');
  const inKopi = [];
  for await (const x of imap.fetch('1:*', { envelope: true })) inKopi.push(x.envelope.subject);
  check(kopi.exists === 1 && inKopi[0]?.startsWith('Q4 concepts'), 'mail a filter labelled shows in the label’s folder');
  await imap.mailboxCreate('Projects/Q4');
  const made2 = all('mailLabels').filter((l) => l.accountId === 'a-alice' && (l.name === 'Projects' || l.name === 'Q4'));
  check(made2.length === 2 && made2.find((l) => l.name === 'Q4')?.parentId === made2.find((l) => l.name === 'Projects')?.id, 'a folder made in a mail app is a label (and its parent)');
  await imap.mailboxRename('Projects/Q4', 'Projects/Q1');
  check(all('mailLabels').some((l) => l.name === 'Q1') && !all('mailLabels').some((l) => l.name === 'Q4'), 'renaming the folder renames the label');
  const inboxNow = await imap.mailboxOpen('INBOX');
  void inboxNow;
  const q1 = all('mailLabels').find((l) => l.name === 'Q1');
  const otherUid = (await imap.search({ subject: 'Lunch' }, { uid: true }))[0];
  await imap.messageCopy(String(otherUid), 'Projects/Q1', { uid: true });
  check(doc('threads', 'th-other').labels.includes(q1.id), 'copying into the folder labels the email');
  await imap.mailboxDelete('Projects/Q1');
  check(!doc('mailLabels', q1.id) && !doc('threads', 'th-other').labels.includes(q1.id), 'deleting the folder deletes the label, and the email keeps everything else');
  const refused = await imap.mailboxCreate('INBOX/Nope').then(() => 'made', () => 'refused');
  const refused2 = await imap.mailboxDelete('Sent').then(() => 'deleted', () => 'refused');
  check(refused === 'refused' && refused2 === 'refused', 'the places themselves (INBOX, Sent) can’t be made or deleted');
  // Mail moved in from elsewhere runs through the filters (marks only).
  await imap.append('INBOX', Buffer.from(`From: Nadia <nadia@kopikita.test>\r\nTo: alice@acme.test\r\nSubject: Imported concepts\r\nMessage-ID: <imp1@kopikita.test>\r\nDate: ${new Date().toUTCString()}\r\n\r\nOld mail\r\n`));
  const imported = await waitFor(() => all('threads').find((x) => x.subject === 'Imported concepts'), 4000);
  check(!!imported && imported.labels.includes('lb-kopi') && imported.location === 'archive', 'mail imported into INBOX by a mail app is filtered too');

  /* ---------- deleting a label ---------- */
  r = await alice.sync('mailLabels', [], ['lb-clients']);
  const kopiThread = all('threads').find((x) => x.subject.startsWith('Q4 concepts'));
  check(!doc('mailLabels', 'lb-clients') && !doc('mailLabels', 'lb-kopi'), 'deleting a label deletes the labels inside it');
  check(!!kopiThread && !kopiThread.labels.includes('lb-kopi') && kopiThread.location === 'archive', 'its mail stays where it was, without the label');
  check(!doc('mailFilters', 'f-kopi').actions.labels && /was deleted/.test(doc('mailFilters', 'f-kopi').problem ?? ''), 'a filter that applied it says it needs attention');
  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll mail label and filter checks passed');
await finish(failed ? 1 : 0);
