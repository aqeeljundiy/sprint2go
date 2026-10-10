// Mail's extras on the server, end to end: the server starts on a throwaway data folder (free ports, a local SMTP sink
// as "the world", nothing leaves this machine) and these are checked through its HTTP API, its SMTP and its database:
//  1. Cc stays Cc: received mail, our own mailboxes' copies and what leaves keep To and Cc apart
//  2. an alias as From (only one that delivers into the mailbox), Reply-To and priority headers
//  3. confidential mode: what leaves and what our mailboxes keep is a notice; the words open only for the right people,
//     outside people get a link that asks for an emailed code, the sender can remove access, and it expires
//  4. show original: the source with what SPF, DKIM and DMARC said, and the .eml download, only for the mailbox's people
//  5. print: a clean page of its own (no scripts from the email, its pictures through our proxy), confidential mail shut
//  6. pictures through our proxy: signed in only, pictures only, never runnable
// First, without a server: who a reply goes to (src/mailPeople.ts) and smart compose's everyday phrases.
//   node --import ./server/register.mjs scripts/mail-extras-tests.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const ROOT = new URL('..', import.meta.url).pathname;
const freePort = () =>
  new Promise((res, rej) => {
    const s = netServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 0. Without a server ---------- */
{
  let bad = 0;
  const unit = (ok, what) => (console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`), ok || bad++);
  const { replyPeople, canReplyAll } = await import('../src/mailPeople.ts');
  const { localSuggestion } = await import('../src/components/mail/phrases.ts');
  const me = (e) => e.endsWith('@us.example');
  const P = (email) => ({ name: email.split('@')[0], email });
  const m = { id: 'm', from: P('ana@them.example'), to: [P('me@us.example'), P('bo@them.example')], cc: [P('cy@them.example'), P('me2@us.example')], date: '', body: '' };
  const one = replyPeople(m, false, me);
  unit(one.to.map((p) => p.email).join() === 'ana@them.example' && one.cc.length === 0, 'Reply answers the sender only');
  const all = replyPeople(m, true, me);
  unit(all.to.map((p) => p.email).join() === 'ana@them.example,bo@them.example' && all.cc.map((p) => p.email).join() === 'cy@them.example', 'Reply all: the sender and To in To, Cc stays Cc, never me');
  const rt = replyPeople({ ...m, replyTo: [P('desk@them.example')] }, false, me);
  unit(rt.to[0].email === 'desk@them.example', 'Reply goes to Reply-To when there is one');
  const mine = replyPeople({ ...m, from: P('me@us.example'), to: [P('ana@them.example')], cc: [] }, false, me);
  unit(mine.to[0].email === 'ana@them.example', 'replying to my own message goes to the people I wrote to');
  unit(canReplyAll(m, me) && !canReplyAll({ ...m, to: [P('me@us.example')], cc: [] }, me), 'Reply all is offered only when it reaches more people');
  unit(localSuggestion('Hi Isabel,\n\nThank you for your e') === 'mail.' && localSuggestion('Looking forw') === 'ard to hearing from you.', 'everyday phrases finish what was started');
  unit(localSuggestion('Terima kasih atas') === ' emailnya.' && localSuggestion('Salam') === ' hangat,', 'in Indonesian too');
  unit(localSuggestion('The') === null && localSuggestion('Kind regards,') === null && localSuggestion('xyz qwerty') === null, 'nothing when nothing obvious comes next');
  if (bad) (console.log(`\n${bad} failed`), process.exit(1));
}

const dir = mkdtempSync(join(tmpdir(), 's2g-extras-'));
const [httpPort, smtpPort, sinkPort, picPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
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
// "Somebody's website" with a picture and a page, for the picture proxy.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pics = httpServer((req, res) => {
  if (req.url === '/pic.png') return res.writeHead(200, { 'content-type': 'image/png' }), res.end(PNG);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<script>alert(1)</script>');
});
await new Promise((res) => pics.listen(picPort, '127.0.0.1', res));

const env = {
  ...process.env,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  SES_KEY: '',
  SES_SECRET: '',
  MAIL_FROM: '',
  S3_BUCKET: '',
  CF_DNS_TOKEN: '',
  PUBLIC_URL: '',
  SUPPORT_EMAIL: '',
  MAIL_RELAY_URL: `smtp://127.0.0.1:${sinkPort}`,
  GEO_COUNTRY_HEADER: '',
  S2G_ALLOW_PRIVATE_FETCH: '1', // the picture proxy may reach the test's own little website on this machine
  IMAP_ENABLED: '',
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
  pics.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server may still hold a file for a moment */
  }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 150_000).unref();

const base = `http://127.0.0.1:${httpPort}`;
const waitFor = async (fn, tries = 100) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  return null;
};
const headOf = (raw) => raw.toString('utf8').split(/\r?\n\r?\n/)[0];

try {
  for (let i = 0; i < 300 && !/Mail: receiving/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  check(/Mail: receiving/.test(log), 'the server starts and receives mail');
  if (!/Mail: receiving/.test(log)) finish(1);
  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const threadsWith = (text) => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${text}%`).map((r) => JSON.parse(r.data));
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.SEED_PASSWORD }) });
    return (r.headers.get('set-cookie') ?? '').split(';')[0];
  };
  const james = await signIn('james@demo.sprint2go.com');
  const owen = await signIn('owen@demo.sprint2go.com');
  const isabel = await signIn('isabel@demo.sprint2go.com');
  check(james.startsWith('s2g=') && owen.startsWith('s2g=') && isabel.startsWith('s2g='), 'three teammates sign in');
  const as = (cookie) => ({
    get: (path, extra = {}) => fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual', ...extra }),
    post: (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }),
  });
  const A = as(james);
  const R = as(owen);
  const D = as(isabel);
  // This laptop can't prove DNS for the demo domain: say every mailbox can send (the server checks that itself).
  const canSend = () => {
    const w = doc('workspaces', 'pnp');
    w.mailReady = { at: new Date().toISOString(), receive: true, send: true, why: {}, mailboxes: Object.fromEntries((w.accounts ?? []).map((a) => [a.id, { receive: true, send: true }])) };
    db.prepare("UPDATE docs SET data = ? WHERE coll = 'workspaces' AND id = 'pnp'").run(JSON.stringify(w));
  };
  canSend();
  const smtp = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, tls: { rejectUnauthorized: false } });
  const id = () => randomBytes(4).toString('hex');
  const send = async (who, body) => {
    canSend();
    let r = await who.post('/api/mail/send', body);
    if (r.status === 409) (canSend(), (r = await who.post('/api/mail/send', body)));
    return r;
  };
  const sinkFor = (subject, n = 1) => waitFor(() => {
    const m = sunk.filter((x) => x.raw.includes(subject));
    return m.length >= n ? m : null;
  });

  /* ---------- 1. Cc stays Cc ---------- */
  const s1 = `cc in ${id()}`;
  await smtp.sendMail({ from: 'Client <client@outside-extras.example>', to: 'James <james@demo.sprint2go.com>', cc: 'Other <other@outside-extras.example>', replyTo: 'Desk <desk@outside-extras.example>', subject: s1, text: 'Hello with a Cc.', html: '<p>Hello with a Cc.</p><script>alert(1)</script><img src="https://pics.example/logo.png"><img src="https://pixel.example/p.gif" width="1" height="1"><table><tr><td>cell</td></tr></table>', headers: { Importance: 'high' } });
  const t1 = await waitFor(() => threadsWith(s1).find((t) => t.accountId === 'pnp-james'));
  const m1 = t1?.messages?.[0];
  check(m1?.to?.length === 1 && m1.to[0].email === 'james@demo.sprint2go.com' && m1.cc?.[0]?.email === 'other@outside-extras.example', 'received mail keeps To and Cc apart');
  check(m1?.replyTo?.[0]?.email === 'desk@outside-extras.example' && m1.priority === 'high', 'received mail keeps Reply-To and its priority');
  const s1b = `cc out ${id()}`;
  const tid1 = `t-x-${id()}`;
  const r1 = await send(A, { workspaceId: 'pnp', accountId: 'pnp-james', threadId: tid1, messageId: `m-x-${id()}`, to: [{ name: 'Client', email: 'client@outside-extras.example' }], cc: [{ name: 'Owen', email: 'owen@demo.sprint2go.com' }], subject: s1b, text: 'Cc out', files: [] });
  check(r1.ok, `the mail engine takes an email with Cc (${r1.status})`);
  const got1 = await sinkFor(s1b);
  check(!!got1 && /^Cc: .*owen@demo\.sprint2go\.com/im.test(headOf(got1[0].raw)) && /^To: .*client@outside-extras\.example/im.test(headOf(got1[0].raw)), 'what leaves names Owen in Cc, the client in To');
  const in1 = await waitFor(() => threadsWith(s1b).find((t) => t.accountId === 'pnp-owen'));
  check(in1?.messages?.[0]?.cc?.[0]?.email === 'owen@demo.sprint2go.com' && in1.messages[0].to.every((p) => p.email !== 'owen@demo.sprint2go.com'), 'the teammate’s copy keeps them in Cc, not To');

  /* ---------- 2. Alias as From, Reply-To, priority ---------- */
  const w = doc('workspaces', 'pnp');
  w.mailAliases = [{ id: 'al-sales', address: 'sales@demo.sprint2go.com', to: ['pnp-james'] }, { id: 'al-ops', address: 'ops@demo.sprint2go.com', to: ['pnp-owen'] }];
  db.prepare("UPDATE docs SET data = ? WHERE coll = 'workspaces' AND id = 'pnp'").run(JSON.stringify(w));
  const s2 = `alias ${id()}`;
  const r2 = await send(A, { workspaceId: 'pnp', accountId: 'pnp-james', threadId: `t-x-${id()}`, messageId: `m-x-${id()}`, fromAddress: 'sales@demo.sprint2go.com', replyTo: [{ name: 'Desk', email: 'desk@demo.sprint2go.com' }], priority: 'high', to: [{ name: 'Client', email: 'client@outside-extras.example' }], cc: [], subject: s2, text: 'From the alias', files: [] });
  check(r2.ok, `an alias of the mailbox can be the From (${r2.status})`);
  const got2 = await sinkFor(s2);
  const h2 = got2 ? headOf(got2[0].raw) : '';
  check(/^From: .*sales@demo\.sprint2go\.com/im.test(h2), 'what leaves is from the alias');
  check(/^Reply-To: .*desk@demo\.sprint2go\.com/im.test(h2) && /^Importance: high/im.test(h2) && /^X-Priority: 1/im.test(h2), 'with Reply-To, Importance and X-Priority');
  check(/^DKIM-Signature:[^]*?d=demo\.sprint2go\.com/im.test(h2), 'and signed for the domain');
  const r2b = await send(A, { workspaceId: 'pnp', accountId: 'pnp-james', threadId: `t-x-${id()}`, messageId: `m-x-${id()}`, fromAddress: 'ops@demo.sprint2go.com', to: [{ name: 'Client', email: 'client@outside-extras.example' }], cc: [], subject: `alias no ${id()}`, text: 'x', files: [] });
  check(r2b.status === 403, 'an alias of someone else’s mailbox can’t be the From');
  const r2c = await send(A, { workspaceId: 'pnp', accountId: 'pnp-james', threadId: `t-x-${id()}`, messageId: `m-x-${id()}`, fromAddress: 'boss@bank.example', to: [{ name: 'Client', email: 'client@outside-extras.example' }], cc: [], subject: `spoof ${id()}`, text: 'x', files: [] });
  check(r2c.status === 403, 'nor any other address');

  /* ---------- 3. Confidential mode ---------- */
  const SECRET = `the launch code is ${id()}`;
  const s3 = `confidential ${id()}`;
  const tid3 = `t-x-${id()}`;
  const mid3 = `m-x-${id()}`;
  const until = new Date(Date.now() + 86_400_000).toISOString();
  // The app saves the sender's copy (with its words), then asks to send it.
  await A.post('/api/sync', { coll: 'threads', upserts: [{ id: tid3, accountId: 'pnp-james', workspaceId: 'pnp', subject: s3, location: 'archive', starred: false, unread: false, labels: [], messages: [{ id: mid3, from: { name: 'James', email: 'james@demo.sprint2go.com' }, to: [{ name: 'Client', email: 'client@outside-extras.example' }, { name: 'Owen', email: 'owen@demo.sprint2go.com' }], date: new Date().toISOString(), body: SECRET, html: `<p>${SECRET}</p>`, confidential: { id: 'c-000000000000000000', expiresAt: '2099-01-01T00:00:00.000Z', passcode: false, sender: true } }] }], deletes: [] });
  const r3 = await send(A, { workspaceId: 'pnp', accountId: 'pnp-james', threadId: tid3, messageId: mid3, to: [{ name: 'Client', email: 'client@outside-extras.example' }, { name: 'Owen', email: 'owen@demo.sprint2go.com' }], cc: [], subject: s3, text: SECRET, html: `<p>${SECRET}</p>`, files: [], confidential: { expiresAt: until, passcode: true }, track: true });
  check(r3.ok, `the mail engine takes a confidential email (${r3.status})`);
  const got3 = await sinkFor(s3);
  const raw3 = got3?.[0]?.raw.toString('utf8') ?? '';
  const parsed3 = got3 ? await simpleParser(got3[0].raw) : null;
  check(!!got3 && !raw3.includes(SECRET), 'what leaves doesn’t carry the words');
  const link = (parsed3?.text ?? '').match(/https?:\/\/[^\s]+\/c\/([A-Za-z0-9_-]{32})/);
  check(!!link && !/\/t\/o\//.test(raw3), 'it carries a link of its own (and no tracking picture)');
  const token = link?.[1] ?? '';
  const in3 = await waitFor(() => threadsWith(s3).find((t) => t.accountId === 'pnp-owen'));
  const cm = in3?.messages?.[0];
  check(!!cm && !JSON.stringify(cm).includes(SECRET) && cm.confidential?.id?.startsWith('c-') && !cm.confidential.sender, 'the teammate’s copy holds a notice and the confidential mark, not the words');
  // Wait for the whole server mark (id and sender), not just the id: the two can land a moment apart.
  const own3 = await waitFor(() => { const m = doc('threads', tid3)?.messages?.[0]; return m?.confidential?.sender === true && m.confidential.id === cm?.confidential?.id && doc('threads', tid3); });
  check(own3?.messages?.[0]?.confidential?.sender === true && own3.messages[0].confidential.id === cm?.confidential?.id && own3.messages[0].body === SECRET, 'the sender’s copy keeps its words and gets the server’s mark (not the one the app made up)');
  const cid = cm?.confidential?.id ?? 'c-none';
  const ro = await R.get(`/api/mail/confidential/${cid}`);
  const roBody = await ro.json().catch(() => ({}));
  check(ro.status === 200 && roBody.content?.text === SECRET && /no-store/.test(ro.headers.get('cache-control') ?? ''), 'the teammate opens the words in the app');
  check((await A.get(`/api/mail/confidential/${cid}`)).status === 200, 'the sender does too');
  check((await D.get(`/api/mail/confidential/${cid}`)).status === 404, 'someone who doesn’t have either mailbox can’t');
  const orig3 = await R.get(`/api/mail/original?thread=${in3?.id}&message=${cm?.id}`);
  check(orig3.ok && !(await orig3.text()).includes(SECRET), 'the teammate’s source (mail apps, Show original) has no words either');
  // Outside: the page asks for a code first.
  const page = await fetch(`${base}/c/${token}`);
  const pageText = await page.text();
  check(page.status === 200 && !pageText.includes(SECRET) && /Send me a code/.test(pageText) && /default-src 'none'/.test(page.headers.get('content-security-policy') ?? ''), 'the outside link asks for a code, shows nothing yet, and runs no scripts');
  const askCode = await fetch(`${base}/c/${token}/code`, { method: 'POST', redirect: 'manual', headers: { origin: base } });
  check(askCode.status === 303, 'a code can be asked for');
  const code = (await waitFor(() => log.match(/\[confidential\] code for client@outside-extras\.example: (\d{6})/)?.[1]))?.toString() ?? '';
  check(/^\d{6}$/.test(code), 'the code goes to the recipient’s address (the log, on a laptop)');
  const wrong = await fetch(`${base}/c/${token}/verify`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: `code=${code === '000000' ? '111111' : '000000'}` });
  check(wrong.status === 303 && !(wrong.headers.get('set-cookie') ?? '').includes('s2gc_'), 'a wrong code opens nothing');
  const right = await fetch(`${base}/c/${token}/verify`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: `code=${code}` });
  const pass = (right.headers.get('set-cookie') ?? '').split(';')[0];
  check(right.status === 303 && pass.startsWith('s2gc_') && /HttpOnly/i.test(right.headers.get('set-cookie') ?? ''), 'the right code gives this browser a pass');
  const open = await fetch(`${base}/c/${token}`, { headers: { cookie: pass } });
  const openText = await open.text();
  check(open.status === 200 && openText.includes(SECRET) && /user-select:none/.test(openText) && /Printing is turned off/.test(openText), 'with the pass the words show, with nothing to select or print');
  const forwarded = await fetch(`${base}/c/${token}`);
  check(!(await forwarded.text()).includes(SECRET), 'the same link in another browser (a forward) still asks for the code');
  // The sender removes access: the link, the teammate and the sender's own copy all say so.
  check((await R.post('/api/mail/confidential/revoke', { id: cid })).status === 404, 'a recipient can’t remove access');
  const rv = await A.post('/api/mail/confidential/revoke', { id: cid });
  check(rv.ok, 'the sender removes access');
  const after = await fetch(`${base}/c/${token}`, { headers: { cookie: pass } });
  check(after.status === 410 && /Access removed/.test(await after.text()), 'the link now says access was removed');
  check((await R.get(`/api/mail/confidential/${cid}`)).status === 410, 'the teammate can’t open it any more');
  const marked = await waitFor(() => threadsWith(s3).find((t) => t.accountId === 'pnp-owen' && t.messages[0].confidential?.revokedAt));
  check(!!marked && !!doc('threads', tid3)?.messages?.[0]?.confidential?.revokedAt, 'both copies show access was removed');
  // An app can't change the server's mark (to open it again).
  const forged = { ...marked, messages: marked.messages.map((m) => ({ ...m, confidential: { ...m.confidential, revokedAt: undefined, expiresAt: '2099-01-01T00:00:00.000Z' } })) };
  await R.post('/api/sync', { coll: 'threads', upserts: [forged], deletes: [] });
  check(!!doc('threads', marked.id)?.messages?.[0]?.confidential?.revokedAt, 'the app’s own write keeps the server’s mark');
  // Expiry, without a code: the link opens straight away, then not after its time.
  const s3b = `confidential open ${id()}`;
  const r3b = await send(A, { workspaceId: 'pnp', accountId: 'pnp-james', threadId: `t-x-${id()}`, messageId: `m-x-${id()}`, to: [{ name: 'Client', email: 'client@outside-extras.example' }], cc: [], subject: s3b, text: SECRET, files: [], confidential: { expiresAt: until, passcode: false } });
  const got3b = r3b.ok ? await sinkFor(s3b) : null;
  const token2 = got3b ? ((await simpleParser(got3b[0].raw)).text ?? '').match(/\/c\/([A-Za-z0-9_-]{32})/)?.[1] : '';
  const open2 = await fetch(`${base}/c/${token2}`);
  check(open2.status === 200 && (await open2.text()).includes(SECRET), 'without a code the link opens straight away');
  db.prepare("UPDATE mail_confidential SET expires_at = ? WHERE id = (SELECT conf_id FROM mail_confidential_access WHERE token = ?)").run(new Date(Date.now() - 1000).toISOString(), token2);
  const gone = await fetch(`${base}/c/${token2}`);
  check(gone.status === 410 && /expired/i.test(await gone.text()), 'after its time it says it expired');
  check((await fetch(`${base}/c/${'x'.repeat(32)}`)).status === 404, 'a made-up link finds nothing');

  /* ---------- 4. Show original ---------- */
  const og = await A.get(`/api/mail/original?thread=${t1?.id}&message=${m1?.id}`);
  const ogBody = await og.json().catch(() => ({}));
  check(og.ok && ogBody.kind === 'raw' && ogBody.source.includes(`Subject: ${s1}`) && /other@outside-extras\.example/.test(ogBody.cc), 'Show original gives the source as it arrived, with its Cc');
  check(typeof ogBody.auth === 'object' && ['spf', 'dmarc'].some((k) => typeof ogBody.auth[k] === 'string'), `and what SPF, DKIM and DMARC said (${JSON.stringify(ogBody.auth)})`);
  const eml = await A.get(`/api/mail/original?thread=${t1?.id}&message=${m1?.id}&download=1`);
  check(eml.ok && eml.headers.get('content-type') === 'message/rfc822' && /attachment; filename=".*\.eml"/.test(eml.headers.get('content-disposition') ?? '') && (await eml.text()).includes(s1), 'the .eml downloads as a file');
  check((await D.get(`/api/mail/original?thread=${t1?.id}&message=${m1?.id}`)).status === 404, 'someone without the mailbox gets nothing');
  const sentOg = await A.get(`/api/mail/original?thread=${tid3}`);
  const sentBody = await sentOg.json().catch(() => ({}));
  check(sentOg.ok && sentBody.signedBy === 'demo.sprint2go.com', 'a sent message shows who signed it (DKIM)');

  /* ---------- 5. Print ---------- */
  const pr = await A.get(`/api/mail/print?thread=${t1?.id}&auto=1`);
  const prText = await pr.text();
  const csp = pr.headers.get('content-security-policy') ?? '';
  check(pr.ok && /text\/html/.test(pr.headers.get('content-type') ?? '') && prText.includes(s1) && prText.includes('Hello with a Cc.') && prText.includes('<td>cell</td>'), 'print gives a page of its own with the email as it was sent');
  check(!/alert\(1\)/.test(prText) && /script-src 'nonce-/.test(csp) && /print\(\)/.test(prText) && pr.headers.get('x-frame-options') === 'SAMEORIGIN', 'no script from the email; only our own print call runs; the app can frame it');
  check(prText.includes('/api/mail/img?u=https%3A%2F%2Fpics.example%2Flogo.png') && !prText.includes('pixel.example') && /Cc: .*other@outside-extras\.example/.test(prText), 'its pictures go through our proxy (tracking pixels never), and Cc is printed');
  const prC = await R.get(`/api/mail/print?thread=${in3?.id}`);
  check(prC.ok && /Printing is turned off/.test(await prC.text()), 'a confidential email someone sent here doesn’t print');
  check((await D.get(`/api/mail/print?thread=${t1?.id}`)).status === 404, 'nobody else can print it');

  /* ---------- 6. Pictures through our proxy ---------- */
  const pic = await A.get(`/api/mail/img?u=${encodeURIComponent(`http://127.0.0.1:${picPort}/pic.png`)}`);
  const picBody = Buffer.from(await pic.arrayBuffer());
  check(pic.ok && pic.headers.get('content-type') === 'image/png' && picBody.equals(PNG) && /sandbox/.test(pic.headers.get('content-security-policy') ?? ''), 'a picture comes through the proxy, and can never run anything');
  const notPic = await A.get(`/api/mail/img?u=${encodeURIComponent(`http://127.0.0.1:${picPort}/page.html`)}`);
  check(notPic.status === 415, 'a page that isn’t a picture is refused');
  check((await fetch(`${base}/api/mail/img?u=${encodeURIComponent(`http://127.0.0.1:${picPort}/pic.png`)}`)).status === 401, 'only for people signed in');
  check((await A.get('/api/mail/img?u=javascript:alert(1)')).status === 400, 'only http and https');

  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} failed` : '\nMail extras tests passed');
finish(failed ? 1 : 0);
