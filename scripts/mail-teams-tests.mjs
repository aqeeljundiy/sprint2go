// Mail for teams (server/mailPlus.ts and the files it names), end to end on a production-like server with a throwaway
// data folder, free test ports and a local SMTP sink as "the world", so nothing leaves this machine:
//  1. delegation: a teammate reads and sends from someone's mailbox (as it, or "on behalf of"), it's logged, and when
//     it's taken back they can't any more; a sync can't add delegates
//  2. forwarding: an address proved with its code, mail goes on to it, the copy here archived; admins block it outside
//  3. groups and shared inboxes: who may post, delivery to each member, a shared inbox, owners and admins
//  4. data loss rules: card numbers blocked, NIK warned (and sent once confirmed), all logged
//  5. legal hold stops deleting for good; retention deletes old mail, not a held person's
//  6. contacts: vCard and CSV in and out, duplicates merged, everyone you've emailed
//  7. export a mailbox as mbox, import it (or a Takeout) into another mailbox, and undo
//  8. POP3: off by default, app passwords over TLS only, fetching, and what happens to the copy here
//  9. mail storage counts toward the company's
// Plus the parts that need no server (card and NIK checks, vCard and CSV, mbox both ways), in this process.
//   node --import ./server/register.mjs scripts/mail-teams-tests.mjs
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';

const ROOT = new URL('..', import.meta.url).pathname;
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 0. the parts that need no server ---------- */
const unitDir = mkdtempSync(join(tmpdir(), 's2g-mailteams-unit-'));
process.env.S2G_DATA = unitDir;
{
  const compliance = await import('../server/mailCompliance.ts');
  check(compliance.findCards('Pay with 4111 1111 1111 1111 please').length === 1 && compliance.findCards('order 1234 5678 9012 3456').length === 0, 'card numbers are found with the Luhn check (and random digits aren’t)');
  check(compliance.findNiks('NIK saya 3201234508900001 ya').length === 1 && compliance.findNiks('ref 9999999999999999').length === 0 && compliance.findNiks('3201236508900001').length === 1, 'NIK numbers are found by their shape (province, birth date, women +40)');
  const pol = { dlp: [{ id: 'r1', name: 'Cards', kind: 'card', action: 'block', on: true }, { id: 'r2', name: 'Secret words', kind: 'words', words: 'project mango, payroll', action: 'warn', on: true }] };
  const hits = compliance.scan(pol, { subject: 'Payroll', text: 'card 5500-0000-0000-0004' });
  check(hits.length === 2 && compliance.blocking(hits).length === 1, 'an email breaking two rules finds both, one of them blocking');

  const contacts = await import('../server/mailContacts.ts');
  const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Laras Anindita\r\nEMAIL;TYPE=INTERNET:laras@client.test\r\nTEL:+62 812 0000 111\r\nORG:Client Co\r\nCATEGORIES:Clients,myContacts\r\nNOTE:Likes\\, mango\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:2.1\r\nN:Stone;Bob\r\nEMAIL:bob@example.test\r\nEND:VCARD\r\n';
  const parsed = contacts.parseVcf(vcf);
  check(parsed.length === 2 && parsed[0].name === 'Laras Anindita' && parsed[0].labels.join() === 'Clients' && parsed[0].notes === 'Likes, mango' && parsed[1].name === 'Bob Stone', 'vCard files are read (names, emails, phones, labels, notes)');
  const csv = 'Name,E-mail 1 - Value,Phone 1 - Value,Labels\r\n"Bima, Jr",bima@client.test,0812,Vendors ::: * starred\r\n';
  const fromCsv = contacts.parseCsv(csv);
  check(fromCsv.length === 1 && fromCsv[0].name === 'Bima, Jr' && fromCsv[0].emails[0] === 'bima@client.test' && fromCsv[0].labels.join() === 'Vendors', 'Google’s CSV is read (quoted commas, ::: lists)');
  const semi = contacts.parseCsv('Name;Email\nIntan;intan@x.test\n');
  check(semi.length === 1 && semi[0].emails[0] === 'intan@x.test', 'a CSV with semicolons (Excel in some countries) is read too');
  const back = contacts.parseVcf(contacts.toVcf([contacts.cleanContact({ name: 'A; B', emails: ['a@b.test'], labels: ['X'], notes: 'line1\nline2' })]));
  check(back[0]?.name === 'A; B' && back[0]?.notes === 'line1\nline2', 'contacts written as vCard read back the same');
  const dupes = contacts.duplicates([contacts.cleanContact({ name: 'Laras P', emails: ['n@x.test'] }), contacts.cleanContact({ name: 'Laras Anindita', emails: ['n@x.test'] }), contacts.cleanContact({ name: 'Other', emails: ['o@x.test'] })]);
  check(dupes.length === 1 && dupes[0].length === 2, 'duplicates are found by a shared email');

  const ex = await import('../server/mailExport.ts');
  const msgs = ['From: a@x.test\r\nSubject: one\r\nX-Gmail-Labels: Inbox,Unread\r\n\r\nFrom the start\r\n>From quoted\r\n', 'From: b@x.test\r\nSubject: two\r\n\r\nbody two café\r\n'];
  const text = msgs.map((m) => `From x@x Thu Jan  1 00:00:00 2026\n${m.replace(/\r\n/g, '\n').replace(/^(>*From )/gm, '>$1')}\n`).join('');
  const got = [];
  for await (const m of ex.readMbox(Readable.from([Buffer.from(text, 'utf8')]))) got.push(m);
  check(got.length === 2 && got[0].raw.toString().includes('\r\nFrom the start\r\n>From quoted') && got[0].labels.includes('unread') && got[1].raw.toString('utf8').includes('café'), 'mbox reads back: messages split on From lines, quoting undone, 8-bit text intact, Gmail labels');
  const zipOut = new PassThrough();
  const chunks = [];
  zipOut.on('data', (c) => chunks.push(c));
  await ex.writeZip(zipOut, [{ name: 'a.mbox', data: Readable.from([Buffer.from(text)]) }]);
  const zf = join(unitDir, 't.zip');
  writeFileSync(zf, Buffer.concat(chunks));
  const zip = await import('../server/zip.ts');
  const entries = await zip.readZip(zf, { maxFiles: 10, maxTotal: 1e8 });
  const unz = await zip.readEntryText(zf, entries[0], 1e8);
  check(entries.length === 1 && entries[0].name === 'a.mbox' && unz === text, 'the zip we write is read by our own careful zip reader, byte for byte');
}

/* ---------- the server ---------- */
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const dir = mkdtempSync(join(tmpdir(), 's2g-mailteams-'));
const [httpPort, smtpPort, imapPort, imapsPort, subPort, subsPort, popPort, popsPort, sinkPort] = await Promise.all(Array.from({ length: 9 }, freePort));
const base = `http://127.0.0.1:${httpPort}`;
const MAIL_HOST = 'mail.s2g-teams.test';
const sunk = [];
const sink = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  logger: false,
  onData(stream, session, cb) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => (sunk.push({ from: session.envelope.mailFrom?.address, to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), raw: Buffer.concat(chunks).toString() }), cb()));
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
  SUPPORT_EMAIL: 'support@s2g-teams.test',
  IMAP_ENABLED: '1',
  IMAP_TEST_TLS: '1',
  IMAP_PORT: String(imapPort),
  IMAPS_PORT: String(imapsPort),
  SUBMISSION_PORT: String(subPort),
  SUBMISSIONS_PORT: String(subsPort),
  POP3_ENABLED: '1',
  POP3_PORT: String(popPort),
  POP3S_PORT: String(popsPort),
  S2G_MAIL_RETENTION_MS: '1500',
};
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
const finish = async (code) => {
  server.kill('SIGTERM');
  sink.close();
  for (const d of [dir, unitDir])
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the server may still hold a file */
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
  const up = await waitFor(() => /POP3 on/.test(log) || server.exitCode !== null, 30_000);
  check(!!up && /POP3 on/.test(log), 'the server starts with IMAP and POP3 on (production, test certificate)');

  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const now = () => new Date().toISOString();
  const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const put = (coll, d) => db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const threadsOf = (acc) => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND json_extract(data, '$.accountId') = ?").all(acc).map((r) => JSON.parse(r.data));
  const password = randomBytes(9).toString('hex');
  const person = (id, name, email) => {
    const salt = randomBytes(16);
    put('users', { id, name, email, title: '', color: '#5b5bf6' });
    db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?)').run(id, email, `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`);
  };
  person('u-alice', 'Alice Martin', 'alice@acme.test');
  person('u-bob', 'Bob Stone', 'bob@acme.test');
  person('u-carol', 'Carol Reed', 'carol@acme.test');
  const ready = (accounts) => ({ at: now(), receive: true, send: true, why: {}, mailboxes: Object.fromEntries(accounts.map((a) => [a.id, { receive: true, send: true }])) });
  const accounts = [
    { id: 'a-alice', email: 'alice@acme.test', name: 'Alice Martin', kind: 'personal', connected: true, users: ['u-alice'] },
    { id: 'a-bob', email: 'bob@acme.test', name: 'Bob Stone', kind: 'personal', connected: true, users: ['u-bob'] },
    { id: 'a-carol', email: 'carol@acme.test', name: 'Carol Reed', kind: 'personal', connected: true, users: ['u-carol'] },
  ];
  put('workspaces', { id: 'w-acme', name: 'Acme', color: '#0ea5e9', domains: ['acme.test'], emailSetup: 'hosted', timeZone: 'Asia/Jakarta', accounts, members: [{ userId: 'u-alice', role: 'owner' }, { userId: 'u-bob', role: 'member' }, { userId: 'u-carol', role: 'member' }], mailReady: ready(accounts), createdAt: now() });
  const canSend = () => {
    const w = doc('workspaces', 'w-acme');
    w.mailReady = ready(w.accounts);
    put('workspaces', w);
  };
  const laras = { name: 'Laras Client', email: 'laras@client.test' };
  const aliceP = { name: 'Alice Martin', email: 'alice@acme.test' };
  put('threads', { id: 'th-a1', accountId: 'a-alice', workspaceId: 'w-acme', subject: 'Mango launch', location: 'inbox', starred: false, unread: true, labels: [], messages: [{ id: 'm1', from: laras, to: [aliceP], date: ago(2), body: 'Can we launch the mango on Friday?', mid: '<mango1@client.test>' }, { id: 'm2', from: aliceP, to: [laras], date: ago(1), body: 'Friday works.', mid: '<mango2@acme.test>' }] });
  put('threads', { id: 'th-a-old', accountId: 'a-alice', workspaceId: 'w-acme', subject: 'Old kiwi', location: 'archive', starred: false, unread: false, labels: [], messages: [{ id: 'm3', from: laras, to: [aliceP], date: ago(400), body: 'Kiwi from last year', mid: '<kiwi@client.test>' }] });
  put('threads', { id: 'th-c-old', accountId: 'a-carol', workspaceId: 'w-acme', subject: 'Old papaya', location: 'archive', starred: false, unread: false, labels: [], messages: [{ id: 'm4', from: laras, to: [{ name: 'Carol', email: 'carol@acme.test' }], date: ago(400), body: 'Papaya from last year', mid: '<papaya@client.test>' }] });

  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body, headers = {}) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
    return {
      ok: r.ok,
      call,
      json: async (method, path, body, headers) => {
        const x = await call(method, path, body, headers);
        return { status: x.status, ...(await x.json().catch(() => ({}))) };
      },
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
      state: () => call('GET', '/api/state?only=threads,workspaces').then((x) => x.json()),
    };
  };
  const alice = await signIn('alice@acme.test');
  const bob = await signIn('bob@acme.test');
  const carol = await signIn('carol@acme.test');
  check(alice.ok && bob.ok && carol.ok, 'people sign in');
  const smtpIn = (from, to, subject, text, extra = {}) => nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, ignoreTLS: true }).sendMail({ envelope: { from, to }, from, to, subject, text, ...extra }).then((r) => r.accepted ?? [], (e) => e.responseCode ?? e.message);

  /* ---------- 1. delegation ---------- */
  const bobBefore = await bob.state();
  check(!bobBefore.threads.some((t) => t.accountId === 'a-alice'), 'before: Bob can’t see Alice’s mail');
  const notHers = await carol.json('POST', '/api/mail/delegates', { workspaceId: 'w-acme', accountId: 'a-alice', delegates: [{ userId: 'u-carol', send: 'as' }] });
  check(notHers.status === 400 && !doc('workspaces', 'w-acme').accounts.find((a) => a.id === 'a-alice').delegates, 'a teammate can’t give themselves access to someone’s mailbox');
  const grant = await alice.json('POST', '/api/mail/delegates', { workspaceId: 'w-acme', accountId: 'a-alice', delegates: [{ userId: 'u-bob', send: 'behalf' }] });
  check(grant.status === 200 && grant.delegates?.[0]?.userId === 'u-bob' && grant.delegates[0].by === 'u-alice', 'Alice gives Bob access to her mailbox, sending on her behalf');
  const bobAfter = await bob.state();
  check(bobAfter.threads.some((t) => t.id === 'th-a1'), 'Bob now sees Alice’s mail');
  canSend();
  const subj = `Mango plan ${randomBytes(3).toString('hex')}`;
  const sent = await bob.json('POST', '/api/mail/send', { workspaceId: 'w-acme', accountId: 'a-alice', threadId: 'th-new1', messageId: 'mm1', to: [laras], cc: [], subject: subj, text: 'The plan is ready.', files: [] });
  check(sent.status === 200, `Bob sends from Alice’s mailbox (${sent.error ?? 'ok'})`);
  const out1 = await waitFor(() => sunk.find((x) => x.raw.includes(subj)));
  check(!!out1 && /^From: .*alice@acme\.test/im.test(out1.raw) && /^Sender: "?Bob Stone"? <bob@acme\.test>/im.test(out1.raw), 'it leaves From Alice with Bob as the Sender ("sent by Bob on behalf of Alice")');
  const access = await alice.json('GET', '/api/mail/access?ws=w-acme');
  check(access.log?.some((l) => l.action === 'delegate.grant') && access.log.some((l) => l.action === 'delegate.send' && l.actor === 'u-bob'), 'the grant and Bob’s email are in Alice’s mail log');
  const bobAccess = await bob.json('GET', '/api/mail/access?ws=w-acme');
  check(bobAccess.delegatedToMe?.some((d) => d.id === 'a-alice' && d.send === 'behalf'), 'Bob’s Settings list Alice’s mailbox as given to him');
  // A sync can't add delegates (only the API, by the owner).
  const wsNow = doc('workspaces', 'w-acme');
  await alice.sync('workspaces', [{ ...wsNow, accounts: wsNow.accounts.map((a) => (a.id === 'a-carol' ? { ...a, delegates: [{ userId: 'u-alice', send: 'as', by: 'u-alice', at: now() }] } : a)) }]);
  check(!doc('workspaces', 'w-acme').accounts.find((a) => a.id === 'a-carol').delegates && !!doc('workspaces', 'w-acme').accounts.find((a) => a.id === 'a-alice').delegates, 'saving the company can’t add delegates to someone’s mailbox (or drop the real ones)');
  const revoke = await alice.json('POST', '/api/mail/delegates', { workspaceId: 'w-acme', accountId: 'a-alice', delegates: [] });
  const bobGone = await bob.state();
  const afterRevoke = await bob.json('POST', '/api/mail/send', { workspaceId: 'w-acme', accountId: 'a-alice', threadId: 'th-new2', messageId: 'mm2', to: [laras], cc: [], subject: 'again', text: 'x', files: [] });
  check(revoke.status === 200 && !bobGone.threads.some((t) => t.accountId === 'a-alice') && afterRevoke.status === 403, 'once Alice takes it back, Bob can’t read or send from her mailbox');
  check((await alice.json('GET', '/api/mail/access?ws=w-acme')).log.some((l) => l.action === 'delegate.revoke'), 'taking it back is logged');

  /* ---------- 2. forwarding (one system with filters: their addresses and link, the company rule) ---------- */
  const fwdAddr = 'alice.home@outside.test';
  const add = await alice.json('POST', '/api/mail/forwarding', { accountId: 'a-alice', address: fwdAddr });
  const st0 = await alice.json('GET', '/api/mail/access?ws=w-acme');
  check(add.status === 200 && add.verified === false && st0.mailboxes.find((m) => m.id === 'a-alice').forwarding.addresses[0]?.verified === false, 'Alice adds a forwarding address (the one filters use too); it waits for its link');
  const tooEarly = await alice.json('POST', '/api/mail/forward-all', { workspaceId: 'w-acme', accountId: 'a-alice', on: true, address: fwdAddr, keep: 'archive' });
  check(tooEarly.status === 400, 'forwarding can’t start before the address is confirmed');
  const link = (await waitFor(() => /forwarding confirmation for alice@acme\.test to alice\.home@outside\.test \(no system mail here\): (\S+)/.exec(log)?.[1]))?.toString();
  const opened = link ? await fetch(link.replace(/^https?:\/\/[^/]+/, base)) : null;
  const st1 = await alice.json('GET', '/api/mail/access?ws=w-acme');
  check(!!opened?.ok && st1.mailboxes.find((m) => m.id === 'a-alice').forwarding.addresses[0]?.verified === true, 'opening the link confirms it, once, for forwarding and filters alike');
  const bobTries = await bob.json('POST', '/api/mail/forward-all', { workspaceId: 'w-acme', accountId: 'a-alice', on: true, address: fwdAddr });
  check(bobTries.status === 403, 'nobody else switches on forwarding for her mailbox');
  const on = await alice.json('POST', '/api/mail/forward-all', { workspaceId: 'w-acme', accountId: 'a-alice', on: true, address: fwdAddr, keep: 'archive' });
  check(on.status === 200 && on.forwarding.on && on.forwarding.keep === 'archive', 'forwarding on, the copy here archived');
  const fsubj = `Guava order ${randomBytes(3).toString('hex')}`;
  await smtpIn('buyer@client.test', ['alice@acme.test'], fsubj, 'Two boxes of guava please');
  const fwd = await waitFor(() => sunk.find((x) => x.raw.includes(fsubj) && x.to.includes(fwdAddr)));
  check(!!fwd && /^X-Forwarded-To: alice\.home@outside\.test/im.test(fwd.raw) && /^X-S2G-Forwarded: alice@acme\.test/im.test(fwd.raw) && /^From: buyer@client\.test/im.test(fwd.raw) && fwd.from === 'alice@acme.test' && /DKIM-Signature: v=1;[^]*?d=acme\.test;/i.test(fwd.raw), 'new mail goes on to the address, from the sender as it was, signed for acme.test');
  const here = await waitFor(() => threadsOf('a-alice').find((t) => t.subject === fsubj));
  check(here?.location === 'archive', 'and Alice’s copy here is archived as she chose');
  // The company rule (Settings, Mail): company only stops it at once.
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), mailForwarding: 'company' }]);
  const st = await alice.json('GET', '/api/mail/access?ws=w-acme');
  check(doc('workspaces', 'w-acme').mailForwarding === 'company' && st.mailboxes.find((m) => m.id === 'a-alice').forwarding.blocked === true, 'an admin sets forwarding to company addresses only: her forwarding shows as stopped');
  const fsubj2 = `Durian order ${randomBytes(3).toString('hex')}`;
  await smtpIn('buyer@client.test', ['alice@acme.test'], fsubj2, 'Durian too');
  await waitFor(() => threadsOf('a-alice').find((t) => t.subject === fsubj2));
  await sleep(800);
  check(!sunk.some((x) => x.raw.includes(fsubj2)) && threadsOf('a-alice').find((t) => t.subject === fsubj2)?.location === 'inbox', 'then nothing more goes outside, and the mail stays in her inbox');
  const outsideAdd = await carol.json('POST', '/api/mail/forwarding', { accountId: 'a-carol', address: 'carol@gmail.test' });
  check(outsideAdd.status === 403, 'and nobody can add an outside address');
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), mailForwarding: 'verified' }]);

  /* ---------- 3. groups and shared inboxes ---------- */
  const memberMakes = await bob.json('POST', '/api/mail/groups', { workspaceId: 'w-acme', groups: [{ address: 'x@acme.test', kind: 'list', owners: ['u-bob'], members: [] }] });
  check(memberMakes.status === 400, 'a member can’t make a group');
  const badAddr = await alice.json('POST', '/api/mail/groups', { workspaceId: 'w-acme', groups: [{ address: 'sales@other.test', kind: 'list', owners: ['u-alice'], members: [] }] });
  check(badAddr.status === 400, 'a group’s address must be at the company’s domain');
  const taken = await alice.json('POST', '/api/mail/groups', { workspaceId: 'w-acme', groups: [{ address: 'bob@acme.test', kind: 'list', owners: ['u-alice'], members: [] }] });
  check(taken.status === 400, 'or not someone’s mailbox already');
  const made = await alice.json('POST', '/api/mail/groups', {
    workspaceId: 'w-acme',
    groups: [
      { address: 'team@acme.test', name: 'Team', kind: 'list', owners: ['u-alice'], members: ['u-bob', 'u-carol'], whoCanPost: 'company' },
      { address: 'help@acme.test', name: 'Help', kind: 'inbox', owners: ['u-bob'], members: ['u-carol'], whoCanPost: 'anyone' },
    ],
  });
  const help = made.groups?.find((g) => g.address === 'help@acme.test');
  const helpBox = doc('workspaces', 'w-acme').accounts.find((a) => a.id === help?.accountId);
  check(made.status === 200 && made.groups.length === 2 && helpBox?.kind === 'shared' && helpBox.users.includes('u-bob') && helpBox.users.includes('u-carol') && helpBox.groupId === help.id, 'an admin makes a group and a shared inbox (with its own mailbox for its people)');
  const outsider = await smtpIn('stranger@else.test', ['team@acme.test'], 'Hello team', 'from outside');
  check(outsider === 550, 'someone outside the company can’t post to a company-only group (550)');
  const tsubj = `Standup ${randomBytes(3).toString('hex')}`;
  const inside = await smtpIn('alice@acme.test', ['team@acme.test'], tsubj, 'Standup at 10');
  const gotBob = await waitFor(() => threadsOf('a-bob').find((t) => t.subject === tsubj));
  const gotCarol = await waitFor(() => threadsOf('a-carol').find((t) => t.subject === tsubj));
  check(Array.isArray(inside) && !!gotBob && !!gotCarol, 'mail from someone at the company reaches each member’s own mailbox');
  const hsubj = `Where is my order ${randomBytes(3).toString('hex')}`;
  await smtpIn('customer@else.test', ['help@acme.test'], hsubj, 'Order 42?');
  const inShared = await waitFor(() => threadsOf(help.accountId).find((t) => t.subject === hsubj));
  const carolSees = (await carol.state()).threads.some((t) => t.subject === hsubj);
  check(!!inShared && carolSees, 'anyone can write to the shared inbox; its people see it there');
  const assign = await carol.sync('threads', [{ ...inShared, assignee: 'u-bob' }]);
  check(assign.status === 200 && doc('threads', inShared.id).assignee === 'u-bob', 'a conversation in the shared inbox is given to one of its people');
  // Its owner changes who's in it; not someone who isn't.
  const bobGroups = await bob.json('GET', '/api/mail/groups?ws=w-acme');
  check(bobGroups.groups.length === 2 && bobGroups.admin === false, 'members see the groups they’re in');
  const ownerEdit = await bob.json('POST', '/api/mail/groups', { workspaceId: 'w-acme', groups: bobGroups.groups.map((g) => (g.id === help.id ? { ...g, members: [], whoCanPost: 'members' } : { ...g, members: [] })) });
  const after = doc('workspaces', 'w-acme').mailGroups;
  check(ownerEdit.status === 200 && after.find((g) => g.id === help.id).members.length === 0 && after.find((g) => g.address === 'team@acme.test').members.length === 2, 'its owner changes the shared inbox; a group they don’t own stays as it was');
  check(!doc('workspaces', 'w-acme').accounts.find((a) => a.id === help.accountId).users.includes('u-carol'), 'and the shared inbox’s people follow');
  const membersOnly = await smtpIn('customer@else.test', ['help@acme.test'], 'again', 'x');
  check(membersOnly === 550, 'a members-only inbox refuses others');
  const wsg = doc('workspaces', 'w-acme');
  await alice.sync('workspaces', [{ ...wsg, mailGroups: [] }]);
  check(doc('workspaces', 'w-acme').mailGroups?.length === 2, 'saving the company can’t change its groups');

  /* ---------- 4. data loss rules ---------- */
  await alice.json('POST', '/api/mail/policy', { workspaceId: 'w-acme', policy: { dlp: [{ name: 'Card numbers', kind: 'card', action: 'block', on: true }, { name: 'KTP numbers', kind: 'nik', action: 'warn', on: true }] } });
  canSend();
  const card = await alice.json('POST', '/api/mail/send', { workspaceId: 'w-acme', accountId: 'a-alice', threadId: 'th-dlp1', messageId: 'md1', to: [laras], cc: [], subject: 'Payment', text: 'My card is 4111 1111 1111 1111', files: [] });
  check(card.status === 409 && card.dlp?.action === 'block', 'an email with a card number is blocked');
  const nik = await alice.json('POST', '/api/mail/send', { workspaceId: 'w-acme', accountId: 'a-alice', threadId: 'th-dlp2', messageId: 'md2', to: [laras], cc: [], subject: 'KTP', text: 'NIK 3201234508900001', files: [] });
  const nikOk = await alice.json('POST', '/api/mail/send', { workspaceId: 'w-acme', accountId: 'a-alice', threadId: 'th-dlp2', messageId: 'md2', to: [laras], cc: [], subject: 'KTP', text: 'NIK 3201234508900001', files: [], dlpAck: true });
  check(nik.status === 409 && nik.dlp?.action === 'warn' && nikOk.status === 200, 'one with a NIK warns, and goes once the sender confirms');
  const plog = await alice.json('GET', '/api/mail/policy?ws=w-acme');
  check(['dlp.block', 'dlp.warn', 'dlp.warn-sent'].every((a) => plog.log.some((l) => l.action === a)) && !JSON.stringify(plog.log).includes('4111'), 'all three are in the company’s mail log, without the numbers');
  check((await bob.json('GET', '/api/mail/policy?ws=w-acme')).status === 403, 'only admins see and change the mail rules');

  /* ---------- 5. legal hold and retention ---------- */
  await alice.json('POST', '/api/mail/policy', { workspaceId: 'w-acme', policy: { holds: [{ userId: 'u-alice', reason: 'Audit 2026' }], retention: { days: 365 } } });
  const pol = doc('workspaces', 'w-acme').mailPolicy;
  check(pol.holds?.[0]?.userId === 'u-alice' && pol.retention?.days === 365 && Date.parse(pol.retention.deleteFrom) > Date.now() + 6 * 86_400_000, 'a legal hold on Alice; retention of a year starts after a week’s notice');
  const del = await alice.sync('threads', [], ['th-a1']);
  check(!!doc('threads', 'th-a1') && /legal hold/.test(del.why ?? ''), 'Alice can’t delete her mail for good while she’s on hold');
  // The week passes (moved here), and the daily run comes.
  const w5 = doc('workspaces', 'w-acme');
  w5.mailPolicy.retention.deleteFrom = ago(1);
  put('workspaces', w5);
  const ran = await waitFor(() => /retention\.run/.test(JSON.stringify(db.prepare("SELECT action FROM mail_audit WHERE workspace_id = 'w-acme'").all())), 70_000);
  check(!!ran && !doc('threads', 'th-c-old') && !!doc('threads', 'th-a-old') && !!doc('threads', 'th-a1'), 'the daily run deletes year-old mail, except Alice’s (on hold)');

  /* ---------- 6. contacts ---------- */
  const imp = await carol.json('POST', '/api/mail/contacts/import', { workspaceId: 'w-acme', format: 'vcf', text: 'BEGIN:VCARD\r\nFN:Laras Client\r\nEMAIL:laras@client.test\r\nCATEGORIES:Clients\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Laras C\r\nEMAIL:laras.c@client.test\r\nEND:VCARD\r\n' });
  const imp2 = await carol.json('POST', '/api/mail/contacts/import', { workspaceId: 'w-acme', format: 'csv', text: 'Name,E-mail 1 - Value,Phone 1 - Value\nLaras Client,laras@client.test,+62 811 222 333\n' });
  check(imp.added === 2 && imp2.updated === 1, 'contacts come in from vCard and CSV; the same email updates instead of doubling');
  const list = await carol.json('GET', '/api/mail/contacts?ws=w-acme');
  const larasC = list.contacts.find((x) => x.emails.includes('laras@client.test'));
  check(larasC?.phones.includes('+62 811 222 333') && larasC.labels.includes('Clients') && list.team.some((m) => m.email === 'alice@acme.test') && list.frequent.some((f) => f.email === 'alice@acme.test'), 'her contacts, the team, and everyone she’s emailed');
  const both = list.contacts.filter((x) => x.name.startsWith('Laras')).map((x) => x.id);
  const merged = await carol.json('POST', '/api/mail/contacts/merge', { workspaceId: 'w-acme', ids: both });
  check(merged.contact?.emails.length === 2 && (await carol.json('GET', '/api/mail/contacts?ws=w-acme')).contacts.length === 1, 'two contacts merge into one with both emails');
  const vcfOut = await (await carol.call('GET', '/api/mail/contacts/export?ws=w-acme&format=vcf')).text();
  check(vcfOut.includes('BEGIN:VCARD') && vcfOut.includes('laras.c@client.test'), 'they export as vCard');
  check(!(await alice.json('GET', '/api/mail/contacts?ws=w-acme')).contacts.length, 'someone else’s contacts are their own');

  /* ---------- 7. export and import ---------- */
  const zipRes = await alice.call('GET', '/api/mail/export?ws=w-acme&account=a-alice');
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  const zf = join(dir, 'export.zip');
  writeFileSync(zf, zipBuf);
  const zip = await import('../server/zip.ts');
  const entries = await zip.readZip(zf, { maxFiles: 10, maxTotal: 1e9 });
  const mboxText = await zip.readEntryText(zf, entries[0], 1e9);
  check(zipRes.status === 200 && entries[0]?.name.endsWith('.mbox') && (mboxText.match(/^From \S+ /gm) ?? []).length >= 4 && mboxText.includes('X-Gmail-Labels: Inbox') && mboxText.includes('Mango launch'), 'Alice exports her mailbox: a zip with an mbox, each email where it was');
  check((await bob.call('GET', '/api/mail/export?ws=w-acme&account=a-alice')).status === 403, 'nobody else exports it');
  const upl = await alice.json('POST', '/api/import/upload?workspaceId=w-acme&source=mail', zipBuf, { 'content-type': 'application/octet-stream', 'x-file-name': 'alice.zip' });
  const readyJob = await waitFor(async () => {
    const j = (await alice.json('GET', `/api/import/${upl.job?.id}`)).job;
    return j && j.status !== 'reading' ? j : null;
  }, 20_000);
  check(readyJob?.status === 'ready' && readyJob.preview?.mail?.messages >= 4 && readyJob.preview.mail.suggested === 'a-alice', `the export reads as an import: ${readyJob?.preview?.mail?.messages} emails, and it suggests Alice’s mailbox`);
  const started = await alice.json('POST', `/api/import/${upl.job.id}/start`, { choices: { people: {}, mailbox: 'a-carol' } });
  const doneJob = await waitFor(async () => {
    const j = (await alice.json('GET', `/api/import/${upl.job.id}`)).job;
    return j && (j.status === 'done' || j.status === 'failed') ? j : null;
  }, 30_000);
  const carolMail = threadsOf('a-carol');
  check(started.status === 200 && doneJob?.status === 'done' && carolMail.some((t) => t.subject === 'Mango launch' && t.messages.length === 2 && t.location === 'inbox'), 'it goes into Carol’s mailbox, conversations joined and in their places');
  const undone = await alice.json('POST', `/api/import/${upl.job.id}/undo`);
  check(undone.status === 200 && !threadsOf('a-carol').some((t) => t.subject === 'Mango launch'), 'Undo takes it back out');
  const takeout = Buffer.from(['From 1@xxx Mon Jan 05 10:00:00 +0000 2026', 'X-GM-THRID: 1', 'X-Gmail-Labels: Spam', 'From: spammer@else.test', 'To: carol@acme.test', 'Subject: Cheap stuff', 'Message-ID: <spam1@else.test>', '', 'buy', '', 'From 2@xxx Mon Jan 05 11:00:00 +0000 2026', 'X-Gmail-Labels: Sent,Starred', 'From: carol@acme.test', 'To: laras@client.test', 'Subject: Sent from Gmail', 'Message-ID: <sent1@acme.test>', '', 'hi', ''].join('\n'));
  const up2 = await alice.json('POST', '/api/import/upload?workspaceId=w-acme&source=mail', takeout, { 'content-type': 'application/octet-stream', 'x-file-name': 'All mail.mbox' });
  await waitFor(async () => (await alice.json('GET', `/api/import/${up2.job?.id}`)).job?.status === 'ready', 20_000);
  await alice.json('POST', `/api/import/${up2.job.id}/start`, { choices: { people: {}, mailbox: 'a-carol' } });
  await waitFor(async () => (await alice.json('GET', `/api/import/${up2.job.id}`)).job?.status === 'done', 20_000);
  const cm = threadsOf('a-carol');
  check(cm.find((t) => t.subject === 'Cheap stuff')?.location === 'spam' && cm.find((t) => t.subject === 'Sent from Gmail')?.starred === true && cm.find((t) => t.subject === 'Sent from Gmail')?.location === 'archive', 'a Gmail mbox keeps Gmail’s places: Spam stays spam, Sent and Starred too');
  const notAdmin = await bob.json('POST', '/api/import/upload?workspaceId=w-acme&source=mail', takeout, { 'content-type': 'application/octet-stream', 'x-file-name': 'x.mbox' });
  check(notAdmin.status === 403, 'only admins import');

  /* ---------- 8. POP3 ---------- */
  const app = await bob.json('POST', '/api/mailapps/passwords', { name: 'Old laptop', password });
  const pop = (secure) =>
    new Promise((resolve) => {
      const sock = secure ? tlsConnect({ host: '127.0.0.1', port: popsPort, servername: MAIL_HOST, rejectUnauthorized: false }) : netConnect(popPort, '127.0.0.1');
      let buf = '';
      const waiters = [];
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        while (waiters.length && waiters[0].test(buf)) {
          const w = waiters.shift();
          const out = buf;
          buf = '';
          w.res(out);
        }
      });
      const read = (multi) => new Promise((res) => waiters.push({ test: (b) => (multi ? /\r\n\.\r\n$/.test(b) || /^-ERR.*\r\n$/.test(b) : /\r\n$/.test(b)), res }));
      const cmd = (line, multi = false) => (sock.write(`${line}\r\n`), read(multi));
      read(false).then(() => resolve({ cmd, close: () => sock.destroy() }));
      sock.on('error', () => {});
    });
  const p0 = await pop(false);
  const plainUser = await p0.cmd('USER bob@acme.test');
  const capa = await p0.cmd('CAPA', true);
  p0.close();
  check(/^-ERR/.test(plainUser) && /STLS/.test(capa) && !/^USER/m.test(capa), 'the plain port takes no user name before STLS');
  const p1 = await pop(true);
  await p1.cmd('USER bob@acme.test');
  const offNow = await p1.cmd(`PASS ${app.password}`);
  p1.close();
  check(/^-ERR.*POP is off/.test(offNow), 'POP is off until Bob switches it on for himself');
  const prefs = await bob.json('POST', '/api/mail/pop', { on: true, after: 'archive', from: 'all' });
  check(prefs.prefs?.on && prefs.prefs.after === 'archive', 'Bob switches POP on: fetched mail is archived here');
  const p2 = await pop(true);
  await p2.cmd('USER bob@acme.test');
  const wrongPw = await p2.cmd(`PASS ${password}`);
  p2.close();
  check(/^-ERR/.test(wrongPw), 'his sprint2go password doesn’t work over POP');
  const p3 = await pop(true);
  await p3.cmd('USER bob@acme.test');
  const okPass = await p3.cmd(`PASS ${app.password}`);
  const stat = await p3.cmd('STAT');
  const uidl = await p3.cmd('UIDL', true);
  const retr = await p3.cmd('RETR 1', true);
  const quit = await p3.cmd('QUIT');
  p3.close();
  const n = Number(/^\+OK (\d+)/.exec(stat)?.[1] ?? -1);
  check(/^\+OK/.test(okPass) && n >= 1 && /^1 \S+/m.test(uidl) && retr.includes(tsubj) && /^\+OK/.test(quit), `an app password signs in over TLS; STAT, UIDL and RETR give his mail (${n})`);
  const bobT = await waitFor(() => threadsOf('a-bob').find((t) => t.subject === tsubj && t.location === 'archive'));
  check(!!bobT, 'what POP fetched is archived here, as he chose');
  const p4 = await pop(true);
  await p4.cmd('USER bob@acme.test');
  await p4.cmd(`PASS ${app.password}`);
  const stat2 = await p4.cmd('STAT');
  await p4.cmd('QUIT');
  p4.close();
  check(Number(/^\+OK (\d+)/.exec(stat2)?.[1] ?? -1) === n - 1, 'and it isn’t offered again');

  /* ---------- 9. storage ---------- */
  const room = await alice.json('GET', '/api/storage?workspaceId=w-acme');
  const mine = await alice.json('GET', '/api/mail/storage?ws=w-acme');
  check(room.mail > 0 && room.used >= room.mail, `mail counts toward the company’s storage (${room.mail} bytes)`);
  check(mine.mailboxes?.[0]?.bytes > 0 && mine.largest?.length > 0 && typeof mine.trash?.count === 'number' && mine.held?.includes('a-alice'), 'Mail storage lists her mailbox, largest emails, Spam and Trash, and says she’s on hold');
  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll mail for teams checks passed');
await finish(failed ? 1 : 0);
