// Mail smoke test: starts the server (not production, demo data, throwaway data folder, free ports), then talks SMTP
// to it like any other mail server would, and reads the database to see what really happened:
//  1. mail to a seed mailbox (aqeel@pixelandprofits.com) is stored in that mailbox
//  2. a "Some of each" routing test address is accepted and swallowed, and the company's lastCheck says it worked
//  3. an unknown routing test address is refused
//  4. a second company that adds pixelandprofits.com gets none of its mail
//   node scripts/smoke-mail.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';

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
const [httpPort, smtpPort] = [await freePort(), await freePort()];
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

  db.close();
} catch (e) {
  check(false, `unexpected: ${e instanceof Error ? e.message : e}`);
}
console.log(failed ? `\n${failed} failed` : '\nMail smoke test passed');
finish(failed ? 1 : 0);
