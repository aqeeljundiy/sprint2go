// Mail smoke test: starts the server (not production, demo data, throwaway data folder, free ports), then talks SMTP
// to it like any other mail server would, and reads the database to see what really happened:
//  1. mail to a seed mailbox (aqeel@pixelandprofits.com) is stored in that mailbox
//  2. a "Some of each" routing test address is accepted and swallowed, and the company's lastCheck says it worked
//  3. an unknown routing test address is refused
//  4. a second company that adds pixelandprofits.com gets none of its mail
//  5. read tracking: a tracked email goes out through a local sink (MAIL_RELAY_URL), each outside recipient with their
//     own picture and links; loading them as an outside mail app would updates the sender's thread, and the app can't
//     write opens itself
//  6. Bcc: the hidden recipient gets it and nobody sees them
//   node scripts/smoke-mail.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

const dir = mkdtempSync(join(tmpdir(), 's2g-smoke-'));
const [httpPort, smtpPort, sinkPort] = [await freePort(), await freePort(), await freePort()];
// Where "the world" is for this test: a local SMTP sink that keeps what it gets. Nothing leaves this machine.
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
  ...process.env,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  // Nothing outside: no SES, no off-site copies, no Let's Encrypt, whatever a local .env says.
  SES_KEY: '',
  SES_SECRET: '',
  MAIL_FROM: '',
  S3_BUCKET: '',
  CF_DNS_TOKEN: '',
  PUBLIC_URL: '',
  SUPPORT_EMAIL: '',
  MAIL_RELAY_URL: `smtp://127.0.0.1:${sinkPort}`,
  GEO_COUNTRY_HEADER: '',
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
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 120_000).unref();

try {
  // Wait for the mail engine to listen.
  for (let i = 0; i < 300 && !/Mail: receiving/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  check(/Mail: receiving/.test(log), `the server starts and receives mail on port ${smtpPort}`);
  if (!/Mail: receiving/.test(log)) finish(1);
  check(/no email: codes go to this log/.test(log), 'without SES or a real domain, codes go to the log (local development)');

  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const smtp = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, tls: { rejectUnauthorized: false }, connectionTimeout: 10_000 });
  const send = (to, subject) => smtp.sendMail({ from: 'Smoke Test <smoke@example.com>', to, subject, text: `Hello from the smoke test (${subject}).` });
  const threadWith = (subject) => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${subject}%`).map((r) => JSON.parse(r.data));
  const waitFor = async (fn) => {
    for (let i = 0; i < 100; i++) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  };

  // 1. Ordinary mail to a seed mailbox.
  const s1 = `smoke ${randomBytes(4).toString('hex')}`;
  await send('aqeel@pixelandprofits.com', s1);
  const t1 = await waitFor(() => threadWith(s1)[0]);
  check(!!t1 && t1.accountId === 'pnp-aqeel' && t1.workspaceId === 'pnp', 'mail to aqeel@pixelandprofits.com is stored in that mailbox');

  // 2. A routing test the server sent (made here in its table): accepted, swallowed, and recorded on the company.
  const token = randomBytes(12).toString('hex');
  db.prepare("INSERT INTO routing_probes (token, workspace_id, domain, kind, state, sent_at) VALUES (?, 'pnp', 'pixelandprofits.com', 'manual', 'sent', ?)").run(token, new Date().toISOString());
  const s2 = `routing ${token}`;
  await send(`s2g-check-${token}@pixelandprofits.com`, s2);
  const arrived = await waitFor(() => db.prepare('SELECT state FROM routing_probes WHERE token = ?').get(token)?.state === 'arrived');
  check(!!arrived, 'a routing test address is accepted and marked arrived');
  const pnp = JSON.parse(db.prepare("SELECT data FROM docs WHERE coll = 'workspaces' AND id = 'pnp'").get().data);
  check(pnp.mailRouting?.lastCheck?.ok === true && !!pnp.mailRouting?.verifiedAt, 'the company’s mailRouting.lastCheck says routing works');
  check(threadWith(s2).length === 0, 'the routing test never shows up in a mailbox');

  // 3. A routing test address nobody sent is refused like any unknown address.
  const refused = await send(`s2g-check-${randomBytes(12).toString('hex')}@pixelandprofits.com`, 'unknown test').then(() => false, (e) => e.responseCode === 550);
  check(refused, 'an unknown routing test address is refused (550)');

  // 4. A second company claims pixelandprofits.com: the first one keeps its mail; the newcomer's addresses get nothing.
  const other = { id: 'smoke-other', name: 'Not Pixel & Profits', domains: ['pixelandprofits.com'], members: [], emailSetup: 'hosted', accounts: [{ id: 'other-aqeel', email: 'aqeel@pixelandprofits.com', name: 'Impostor', kind: 'personal', users: [] }, { id: 'other-only', email: 'only-other@pixelandprofits.com', name: 'Impostor', kind: 'personal', users: [] }] };
  db.prepare("INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES ('workspaces', ?, ?, ?, NULL)").run(other.id, JSON.stringify(other), new Date().toISOString());
  const s4 = `smoke-owner ${randomBytes(4).toString('hex')}`;
  await send('aqeel@pixelandprofits.com', s4);
  const t4 = await waitFor(() => threadWith(s4)[0]);
  check(!!t4 && t4.accountId === 'pnp-aqeel', 'with a second company on the same domain, mail still goes to the company that holds it');
  const refusedOther = await send('only-other@pixelandprofits.com', 'not yours').then(() => false, (e) => e.responseCode === 550);
  check(refusedOther, 'the second company’s own address at that domain is refused');

  // 5. Read tracking, end to end.
  const base = `http://127.0.0.1:${httpPort}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'aqeel@pixelandprofits.com', password: env.SEED_PASSWORD }) });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  check(login.ok && cookie.startsWith('s2g='), 'signs in as the sender');
  const api = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  // This laptop can't prove DNS or port 25 for the demo domain: say the mailbox can send (the server checks that itself).
  const canSend = () => {
    const w = JSON.parse(db.prepare("SELECT data FROM docs WHERE coll = 'workspaces' AND id = 'pnp'").get().data);
    w.mailReady = { at: new Date().toISOString(), receive: true, send: true, why: {}, mailboxes: Object.fromEntries((w.accounts ?? []).map((a) => [a.id, { receive: true, send: true }])) };
    db.prepare("UPDATE docs SET data = ? WHERE coll = 'workspaces' AND id = 'pnp'").run(JSON.stringify(w));
  };
  const tid = `t-smoke-${randomBytes(4).toString('hex')}`;
  const mid = `m-smoke-${randomBytes(4).toString('hex')}`;
  const subject = `tracked ${randomBytes(4).toString('hex')}`;
  const to = [
    { name: 'Client One', email: 'client@outside-smoke.example' },
    { name: 'Client Two', email: 'second@outside-smoke.example' },
    { name: 'Rizky', email: 'rizky@pixelandprofits.com' },
  ];
  const html = '<p>Hello, see <a href="https://shop.example/offer?id=7&amp;x=1">the offer</a>.</p>';
  // The app saves the sent copy (with the recipients it expects to track, and a made-up open), then asks to send it.
  const made = Object.fromEntries(to.slice(0, 2).map((p) => [p.email, { opens: [{ at: new Date().toISOString(), device: 'made up' }], clicks: [] }]));
  const message = { id: mid, from: { name: 'Aqeel', email: 'aqeel@pixelandprofits.com' }, to, date: new Date().toISOString(), body: 'Hello, see the offer.', html, tracking: made, trackOptions: { opens: true, clicks: true, notify: true, attachments: false, details: false, remindDays: 3 } };
  const saved = await api('/api/sync', { coll: 'threads', upserts: [{ id: tid, accountId: 'pnp-aqeel', workspaceId: 'pnp', subject, location: 'archive', starred: false, unread: false, labels: [], messages: [message] }], deletes: [] });
  check(saved.ok, 'the app saves the sent copy');
  const sendBody = { workspaceId: 'pnp', accountId: 'pnp-aqeel', threadId: tid, messageId: mid, to, cc: [], subject, text: 'Hello, see the offer.', html, files: [], track: true, trackOptions: { opens: true, clicks: true, notify: true } };
  canSend();
  let sent = await api('/api/mail/send', sendBody);
  if (sent.status === 409) (canSend(), (sent = await api('/api/mail/send', sendBody)));
  check(sent.ok, `the mail engine takes the tracked email (${sent.status})`);
  const ours = () => sunk.filter((m) => m.raw.includes(subject));
  const got = await waitFor(() => (ours().length >= 2 ? ours() : null));
  check(!!got, 'both outside recipients’ copies reach the sink');
  const thread = () => JSON.parse(db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND id = ?").get(tid)?.data ?? 'null');
  if (got) {
    const copies = await Promise.all(got.map(async (m) => ({ to: m.to[0], parsed: await simpleParser(m.raw) })));
    const one = copies.find((c) => c.to === 'client@outside-smoke.example');
    const two = copies.find((c) => c.to === 'second@outside-smoke.example');
    const pixel = (c) => /<img src="([^"]+\/t\/o\/[a-f0-9]{32}\.gif)"/.exec(c?.parsed.html ?? '')?.[1];
    const link = (c) => /href="([^"]+\/t\/c\/[a-f0-9]{32}\?[^"]+)"/.exec(c?.parsed.html ?? '')?.[1]?.replace(/&amp;/g, '&');
    const local = (u) => u.replace(/^https?:\/\/[^/]+/, base);
    // Every copy leaves signed for the sender's domain (mailauth signs only from signatureData; an empty signature once
    // went unnoticed).
    check(got.every((m) => /^DKIM-Signature: v=1; a=rsa-sha256;[^]*?\bd=pixelandprofits\.com;/im.test(m.raw.toString('utf8').split(/\r?\n\r?\n/)[0])), 'every copy is DKIM-signed for the sender’s domain');
    check(!!pixel(one) && !!pixel(two) && pixel(one) !== pixel(two), 'each outside recipient gets a picture of their own');
    check(!!link(one) && link(one) !== link(two), 'and links of their own');
    check(one?.parsed.text?.includes('Hello, see the offer.') && !one?.parsed.text?.includes('/t/'), 'the plain-text part stays as written');
    const inside = await waitFor(() =>
      db
        .prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?")
        .all(`%${subject}%`)
        .map((r) => JSON.parse(r.data))
        .find((t) => t.accountId === 'pnp-rizky'),
    );
    check(!!inside && !String(inside.messages[0].html ?? '').includes('/t/o/'), 'the teammate’s copy has no picture');
    const t0 = thread();
    check(
      !!t0 && Object.keys(t0.messages[0].tracking ?? {}).sort().join() === 'client@outside-smoke.example,second@outside-smoke.example' && t0.messages[0].tracking['client@outside-smoke.example'].opens.length === 0,
      'the sender’s copy tracks the two outsiders, and the app’s made-up open is gone',
    );
    // Outside mail apps open it: an iPhone, then Gmail's proxy, then Apple Mail Privacy Protection.
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const img = await fetch(local(pixel(one)), { headers: { 'user-agent': iphone } });
    const gif = Buffer.from(await img.arrayBuffer());
    check(img.status === 200 && img.headers.get('content-type') === 'image/gif' && gif.subarray(0, 6).toString() === 'GIF89a' && /no-store/.test(img.headers.get('cache-control') ?? ''), 'the picture is a transparent GIF that is never cached');
    const opened = await waitFor(() => thread()?.messages[0].tracking?.['client@outside-smoke.example']?.opens?.[0]);
    check(opened?.device === 'iPhone · Apple Mail' && !opened.place && !opened.auto, `the sender’s thread shows the open on an iPhone (${JSON.stringify(opened)})`);
    await fetch(local(pixel(two)), { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)' } });
    await fetch(local(pixel(one)), { headers: { 'user-agent': 'Mozilla/5.0' } });
    const after = await waitFor(() => {
      const tr = thread()?.messages[0].tracking;
      return tr?.['second@outside-smoke.example']?.opens?.length && tr['client@outside-smoke.example'].opens.length >= 2 ? tr : null;
    });
    check(after?.['second@outside-smoke.example'].opens[0].via === 'gmail' && after['second@outside-smoke.example'].opens[0].device === '', 'Gmail’s proxy shows as opened via Gmail, with no device');
    check(after?.['client@outside-smoke.example'].opens[1]?.auto === 'apple', 'Apple Mail Privacy Protection shows as maybe automatic');
    const bogus = await fetch(`${base}/t/o/${'0'.repeat(32)}.gif`);
    check(bogus.status === 200 && bogus.headers.get('content-type') === 'image/gif', 'an unknown picture answers the same');
    // A click: on to the original address only, and only with the server's signature.
    const clickUrl = local(link(one));
    const click = await fetch(clickUrl, { redirect: 'manual', headers: { 'user-agent': iphone } });
    check(click.status === 302 && click.headers.get('location') === 'https://shop.example/offer?id=7&x=1', 'a click goes on to the address in the email');
    const evil = await fetch(clickUrl.replace(/u=[^&]+/, `u=${encodeURIComponent('https://evil.example/')}`), { redirect: 'manual' });
    check(evil.status === 400 && !evil.headers.get('location'), 'a changed click address goes nowhere (no open redirect)');
    const clicked = await waitFor(() => thread()?.messages[0].tracking?.['client@outside-smoke.example']?.clicks?.[0]);
    check(clicked?.label === 'the offer' && clicked.url === 'https://shop.example/offer?id=7&x=1', 'the click shows on the sender’s thread with its link text');
    const notices = await waitFor(() => {
      const list = db.prepare("SELECT data FROM docs WHERE coll = 'notices' AND data LIKE ?").all(`%${subject}%`).map((r) => JSON.parse(r.data));
      return list.length >= 2 ? list : null;
    });
    check(notices?.length === 2 && notices.every((n) => n.userId === 'u-aqeel' && n.event === 'opened' && n.link?.id === tid), 'the sender hears about the first open by each person, not the automatic one');
    // The app can't write opens: a copy with its own opens and delivery state keeps the server's.
    const before = thread();
    const forged = { ...before, unread: true, messages: [{ ...before.messages[0], delivery: { state: 'failed', at: new Date().toISOString() }, tracking: { 'client@outside-smoke.example': { opens: [], clicks: [] } } }] };
    await api('/api/sync', { coll: 'threads', upserts: [forged], deletes: [] });
    const kept = thread();
    check(kept.unread === true && kept.messages[0].tracking['client@outside-smoke.example'].opens.length === 2 && kept.messages[0].delivery?.state !== 'failed', 'the app’s own write keeps the server’s opens and delivery state');
    // The app's real order: it asks to send first and saves the thread a moment later. The server's marks still land.
    const tid2 = `t-smoke-${randomBytes(4).toString('hex')}`;
    const mid2 = `m-smoke-${randomBytes(4).toString('hex')}`;
    const to2 = [{ name: 'Third', email: 'third@outside-smoke.example' }, { name: 'Rizky', email: 'rizky@pixelandprofits.com' }];
    canSend();
    const sent2 = await api('/api/mail/send', { ...sendBody, threadId: tid2, messageId: mid2, to: to2, subject: `${subject} later` });
    const both = Object.fromEntries(to2.map((p) => [p.email, { opens: [], clicks: [] }])); // the app's guess: Rizky too
    await api('/api/sync', { coll: 'threads', upserts: [{ id: tid2, accountId: 'pnp-aqeel', workspaceId: 'pnp', subject: `${subject} later`, location: 'archive', starred: false, unread: false, labels: [], messages: [{ ...message, id: mid2, to: to2, tracking: both }] }], deletes: [] });
    const t2 = await waitFor(() => {
      const t = JSON.parse(db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND id = ?").get(tid2)?.data ?? 'null');
      return t?.messages?.[0]?.delivery?.state === 'sent' ? t : null;
    });
    check(sent2.ok && !!t2?.messages[0].mid && Object.keys(t2.messages[0].tracking ?? {}).join() === 'third@outside-smoke.example', 'sent before the app saved it: the Message-ID, delivery state and who is tracked still land on the message');
  }

  // 6. Bcc: the hidden recipient gets the email; no copy names them, in its headers or in a teammate's mailbox.
  const s6 = `bcc ${randomBytes(4).toString('hex')}`;
  canSend();
  const sent6 = await api('/api/mail/send', { workspaceId: 'pnp', accountId: 'pnp-aqeel', threadId: `t-smoke-${randomBytes(4).toString('hex')}`, messageId: `m-smoke-${randomBytes(4).toString('hex')}`, to: [{ name: 'Open', email: 'open@outside-smoke.example' }], cc: [{ name: 'Rizky', email: 'rizky@pixelandprofits.com' }], bcc: [{ name: 'Hidden', email: 'hidden@outside-smoke.example' }], subject: s6, text: 'Bcc check', files: [] });
  check(sent6.ok, `the mail engine takes an email with Bcc (${sent6.status})`);
  const got6 = await waitFor(() => {
    const m = sunk.filter((x) => x.raw.includes(s6));
    return m.length >= 2 ? m : null;
  });
  check(!!got6 && got6.some((m) => m.to.includes('hidden@outside-smoke.example')), 'the Bcc recipient gets a copy');
  check(!!got6 && got6.every((m) => !/hidden@outside-smoke/i.test(m.raw.toString('utf8').split(/\r?\n\r?\n/)[0])), 'no copy names them in its headers');
  const inside6 = await waitFor(() => threadWith(s6).find((t) => t.accountId === 'pnp-rizky'));
  check(!!inside6 && !JSON.stringify(inside6.messages[0].to).includes('hidden@'), 'the teammate’s copy doesn’t list them either');

  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.message : e}`);
}
console.log(failed ? `\n${failed} failed` : '\nMail smoke test passed');
finish(failed ? 1 : 0);
