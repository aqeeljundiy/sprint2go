// Unit checks for the parts that can't be tried end to end on a laptop or in CI: the SigV4 signer (against AWS's
// published examples), the ARC verdict, who holds a mail domain, labelled backups, and that Let's Encrypt stays off
// without CF_DNS_TOKEN. Runs on a throwaway data folder.
//   node --import ./server/register.mjs scripts/unit-tests.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 's2g-unit-'));
process.env.S2G_DATA = dir;
process.env.SUPPORT_EMAIL = 'support@example-s2g.com';
process.env.MAIL_HOST = 'mail.example-s2g.com';
for (const k of ['CF_DNS_TOKEN', 'CF_ZONE_ID', 'MAIL_TLS_CERT', 'MAIL_TLS_KEY', 'SES_KEY', 'SES_SECRET', 'MAIL_FROM', 'S3_BUCKET', 'S3_KEY', 'S3_SECRET']) delete process.env[k];

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message.split('\n').join('\n     ') : e}`);
  }
};

/* ---------- SigV4 (server/sigv4.ts) against AWS's documented examples ---------- */

const { signV4, sha256Hex, uriEncode, canonicalQuery } = await import('../server/sigv4.ts');
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

await test('SigV4: AWS test suite "get-vanilla"', () => {
  const r = signV4({ method: 'GET', host: 'example.amazonaws.com', path: '/', payloadHash: sha256Hex(''), region: 'us-east-1', service: 'service', key: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', date: new Date('2015-08-30T12:36:00Z') });
  assert.equal(r.authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});
const s3Example = { host: 'examplebucket.s3.amazonaws.com', region: 'us-east-1', service: 's3', key: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z') };
await test('SigV4: S3 docs example, GET object', () => {
  const r = signV4({ ...s3Example, method: 'GET', path: '/test.txt', headers: { range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY }, payloadHash: EMPTY });
  assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});
await test('SigV4: S3 docs example, PUT object (encoded key, body hash)', () => {
  const body = 'Welcome to Amazon S3.';
  const hash = sha256Hex(body);
  assert.equal(hash, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const r = signV4({ ...s3Example, method: 'PUT', path: `/${uriEncode('test$file.text', true)}`, headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': hash }, payloadHash: hash });
  assert.equal(r.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});
await test('SigV4: S3 docs example, list objects (query)', () => {
  const r = signV4({ ...s3Example, method: 'GET', path: '/', query: canonicalQuery({ prefix: 'J', 'max-keys': '2' }), headers: { 'x-amz-content-sha256': EMPTY }, payloadHash: EMPTY });
  assert.equal(r.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});
await test('SigV4: keys and prefixes are encoded the S3 way', () => {
  assert.equal(uriEncode('sprint2go/sprint2go-2026-10-09.db.gz', true), 'sprint2go/sprint2go-2026-10-09.db.gz');
  assert.equal(canonicalQuery({ prefix: 'sprint2go/', 'list-type': '2' }), 'list-type=2&prefix=sprint2go%2F');
  assert.equal(uriEncode("a b!'()*~"), 'a%20b%21%27%28%29%2A~');
});

/* ---------- off-site config (server/offsite.ts) ---------- */

const offsite = await import('../server/offsite.ts');
await test('Off-site copies stay off without S3_*', () => {
  assert.equal(offsite.offsiteConfigured(), false);
  assert.equal(offsite.offsiteState().configured, false);
});
await test('Off-site: R2 / B2 / MinIO use path style on their endpoint, AWS its bucket host', () => {
  Object.assign(process.env, { S3_BUCKET: 'backups', S3_KEY: 'k', S3_SECRET: 's', S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com' });
  let c = offsite.s3Config();
  assert.equal(c.host, 'acc.r2.cloudflarestorage.com');
  assert.equal(c.root, '/backups');
  assert.equal(c.region, 'auto');
  delete process.env.S3_ENDPOINT;
  process.env.S3_REGION = 'ap-southeast-1';
  c = offsite.s3Config();
  assert.equal(c.host, 'backups.s3.ap-southeast-1.amazonaws.com');
  assert.equal(c.root, '');
  for (const k of ['S3_BUCKET', 'S3_KEY', 'S3_SECRET', 'S3_REGION']) delete process.env[k];
});

/* ---------- ARC (server/mailer.ts) ---------- */

const mailer = await import('../server/mailer.ts');
await test('ARC: a passing chain sealed by Google, where the original passed, is trusted', () => {
  assert.equal(mailer.arcVerdict({ status: { result: 'pass' }, signature: { signingDomain: 'google.com' }, authenticationResults: { dmarc: { result: 'pass' } } }).trusted, true);
  assert.equal(mailer.arcVerdict({ status: { result: 'pass' }, signature: { signingDomain: 'microsoft.com' }, authenticationResults: { spf: { result: 'pass' }, dkim: [{ result: 'pass' }] } }).trusted, true);
  assert.equal(mailer.arcVerdict({ status: { result: 'pass' }, signature: { signingDomain: 'zohomail.com' }, authenticationResults: { dkim: [{ result: 'pass' }] } }).trusted, true);
});
await test('ARC: other sealers, broken chains and failed originals are not', () => {
  assert.equal(mailer.arcVerdict({ status: { result: 'pass' }, signature: { signingDomain: 'forwarder.example' }, authenticationResults: { dmarc: { result: 'pass' } } }).trusted, false);
  assert.equal(mailer.arcVerdict({ status: { result: 'fail' }, signature: { signingDomain: 'google.com' }, authenticationResults: { dmarc: { result: 'pass' } } }).trusted, false);
  assert.equal(mailer.arcVerdict({ status: { result: 'pass' }, signature: { signingDomain: 'google.com' }, authenticationResults: { dmarc: { result: 'fail' }, spf: { result: 'pass' } } }).trusted, false);
  assert.equal(mailer.arcVerdict({ status: { result: 'pass' }, signature: { signingDomain: 'notgoogle.com' }, authenticationResults: { dmarc: { result: 'pass' } } }).trusted, false);
  assert.equal(mailer.arcVerdict(undefined).trusted, false);
});

/* ---------- system mail (server/mailer.ts) ---------- */

await test('System mail: no-reply at the support domain, through our own engine when SES is off', () => {
  assert.equal(mailer.NOREPLY, 'no-reply@example-s2g.com');
  assert.equal(mailer.systemMailPath(), 'own');
});

/* ---------- who holds a domain (server/domains.ts) ---------- */

const db = await import('../server/db.ts');
const domains = await import('../server/domains.ts');
const ws = (id, domain, accounts = []) => ({ id, name: id, domains: domain ? [domain] : [], members: [], accounts });
await test('Domains: the first company to claim holds it; a later one can’t use it', () => {
  db.writeDocs('workspaces', [ws('w-a', 'acme.example', [{ id: 'a1', email: 'ann@acme.example', kind: 'personal', users: [] }]), ws('w-b', 'acme.example', [{ id: 'b1', email: 'bob@acme.example', kind: 'personal', users: [] }, { id: 'b2', email: 'ann@acme.example', kind: 'personal', users: [] }])], [], null);
  assert.equal(domains.ownerOf('acme.example').id, 'w-a');
  assert.equal(domains.ownership(ws('w-a', 'acme.example'), 'acme.example').state, 'pending');
  assert.equal(domains.ownership(ws('w-b', 'acme.example'), 'acme.example').state, 'held');
  const map = mailer.localAccounts();
  assert.equal(map.get('ann@acme.example')?.ws.id, 'w-a', 'inbound for the domain goes to its holder');
  assert.equal(map.has('bob@acme.example'), false, 'the other company gets nothing at the domain');
});
await test('Domains: MX here proves it for the holder, never for another company', () => {
  const b = db.getDoc('workspaces', 'w-b');
  assert.equal(domains.settle(b, 'acme.example', { mxHere: true, dkim: '', txt: [] }).state, 'held');
  const a = db.getDoc('workspaces', 'w-a');
  const own = domains.settle(a, 'acme.example', { mxHere: true, dkim: '', txt: [] });
  assert.equal(own.state, 'verified');
  assert.equal(own.how, 'mx');
  assert.equal(domains.ownership(b, 'acme.example').state, 'taken');
});
await test('Domains: the rightful owner takes it over with its own TXT token, and keeps it', () => {
  const a = db.getDoc('workspaces', 'w-a');
  const b = db.getDoc('workspaces', 'w-b');
  assert.notEqual(domains.verifyRecord('w-a', 'acme.example'), domains.verifyRecord('w-b', 'acme.example'));
  assert.match(domains.verifyRecord('w-b', 'acme.example'), /^sprint2go-verify=[a-f0-9]{32}$/);
  assert.equal(domains.settle(b, 'acme.example', { mxHere: false, dkim: '', txt: ['v=spf1 ~all', domains.verifyRecord('w-b', 'acme.example')] }).state, 'verified');
  assert.equal(domains.ownership(a, 'acme.example').state, 'taken');
  assert.equal(mailer.localAccounts().get('ann@acme.example')?.ws.id, 'w-b', 'inbound follows the verified owner');
  // Both tokens there: the verified owner keeps it.
  assert.equal(domains.settle(a, 'acme.example', { mxHere: true, dkim: '', txt: [domains.verifyRecord('w-a', 'acme.example'), domains.verifyRecord('w-b', 'acme.example')] }).state, 'taken');
});
await test('Domains: the holder’s DKIM record proves it', () => {
  db.writeDocs('workspaces', [ws('w-c', 'solo.example')], [], null);
  const c = db.getDoc('workspaces', 'w-c');
  const key = domains.domainKey('solo.example', 'w-c');
  assert.equal(domains.settle(c, 'solo.example', { mxHere: false, dkim: 'v=DKIM1; k=rsa; p=AAAA', txt: [] }).state, 'pending', 'a different key proves nothing');
  const own = domains.settle(c, 'solo.example', { mxHere: false, dkim: `v=DKIM1; k=rsa; p=${key.publicKey}`, txt: [] });
  assert.equal(own.state, 'verified');
  assert.equal(own.how, 'dkim');
});
await test('Domains: a key made for a company that doesn’t hold the domain goes to the holder', () => {
  db.writeDocs('workspaces', [ws('w-d', 'first.example'), ws('w-e', 'first.example')], [], null);
  domains.domainKey('first.example', 'w-e');
  assert.equal(db.db.prepare('SELECT workspace_id FROM mail_domains WHERE domain = ?').get('first.example').workspace_id, 'w-d');
  assert.equal(domains.ownerOf('first.example').id, 'w-d');
});
await test('Domains: copies from kept mailboxes at a shared address (gmail.com) still arrive', () => {
  db.writeDocs('workspaces', [ws('w-f', '', [{ id: 'f1', email: 'someone@gmail.com', kind: 'personal', users: [], provider: 'google' }])], [], null);
  assert.equal(mailer.localAccounts().get(`someone.w-f@${mailer.MAIL_HOST}`)?.ws.id, 'w-f');
});

/* ---------- read tracking (server/readTracking.ts) ---------- */

const track = await import('../server/readTracking.ts');
await test('Tracking: links go through a signed click address, mail links stay, the picture goes at the end', () => {
  const html = '<p>Hi <a href="https://shop.example/a?x=1&amp;y=2">the shop</a>, <a href="mailto:me@x.example">mail me</a> or <a class="b" href=\'https://example.org/\'>https://example.org/</a></p>';
  const token = 'a'.repeat(32);
  const { html: out, links } = track.instrument(html, token, 'https://app.example', { opens: true, clicks: true });
  assert.match(out, /href="https:\/\/app\.example\/t\/c\/a{32}\?u=https%3A%2F%2Fshop\.example%2Fa%3Fx%3D1%26y%3D2&amp;s=[a-f0-9]{32}"/);
  assert.match(out, /<a class="b" href="https:\/\/app\.example\/t\/c\//, 'other attributes stay');
  assert.match(out, /href="mailto:me@x\.example"/);
  assert.ok(out.endsWith(`<img src="https://app.example/t/o/${token}.gif" width="1" height="1" alt="" style="width:1px;height:1px;border:0;margin:0;padding:0;display:block">`));
  assert.deepEqual(links, [{ u: 'https://shop.example/a?x=1&y=2', l: 'the shop' }, { u: 'https://example.org/', l: 'example.org' }]);
  const plain = track.instrument(html, token, 'https://app.example', { opens: false, clicks: false }).html;
  assert.equal(plain, html, 'nothing asked, nothing changed');
});
await test('Tracking: web addresses typed as text become links (never inside a tag or a link)', () => {
  assert.equal(track.linkify('<p>See https://a.example/x?y=1&amp;z=2.</p>'), '<p>See <a href="https://a.example/x?y=1&amp;z=2">https://a.example/x?y=1&amp;z=2</a>.</p>');
  assert.equal(track.linkify('<p><a href="https://b.example/">https://b.example/</a> <img src="https://c.example/i.png"></p>'), '<p><a href="https://b.example/">https://b.example/</a> <img src="https://c.example/i.png"></p>');
  assert.equal(track.linkify('<p>here: https://d.example/q4&nbsp;</p><p>&lt;https://e.example/&gt;</p>'), '<p>here: <a href="https://d.example/q4">https://d.example/q4</a>&nbsp;</p><p>&lt;<a href="https://e.example/">https://e.example/</a>&gt;</p>');
});
await test('Tracking: a click address works only for the token and address it was made for', () => {
  const t = 'b'.repeat(32);
  const out = track.instrument('<a href="https://ok.example/">x</a>', t, 'https://app.example', { opens: false, clicks: true }).html;
  const sig = /s=([a-f0-9]{32})/.exec(out)[1];
  assert.equal(track.validSig(t, 'https://ok.example/', sig), true);
  assert.equal(track.validSig(t, 'https://evil.example/', sig), false, 'another address');
  assert.equal(track.validSig('c'.repeat(32), 'https://ok.example/', sig), false, 'another token');
  assert.equal(track.validSig(t, 'https://ok.example/', ''), false);
});
await test('Tracking: Gmail’s proxy is a person without a device, Apple’s and filters maybe automatic, apps give a rough device', () => {
  assert.deepEqual(track.readAgent('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)'), { device: '', via: 'gmail' });
  assert.deepEqual(track.readAgent('YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html'), { device: '', via: 'yahoo' });
  assert.equal(track.readAgent('Mozilla/5.0').auto, 'apple');
  assert.equal(track.readAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', '17.58.1.2').auto, 'apple', 'from Apple’s network');
  assert.equal(track.readAgent('').auto, 'scanner');
  assert.equal(track.readAgent('curl/8.4.0').auto, 'scanner');
  assert.equal(track.readAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', '203.0.113.9').device, 'iPhone · Apple Mail');
  assert.equal(track.readAgent('Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17328; Pro)').device, 'Windows PC · Outlook');
  assert.equal(track.readAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36').device, 'Android phone · browser');
});
await test('Tracking: teammates, the company’s domains and its mailboxes are never tracked; a switched-off company tracks nobody', () => {
  db.writeDocs('users', [{ id: 'u-t1', name: 'Tia', email: 'tia@personal.example' }], [], null);
  const w = { id: 'w-t', name: 'T', domains: ['team.example'], members: [{ userId: 'u-t1', role: 'member' }], accounts: [{ id: 't1', email: 'tia@gmail.com', users: ['u-t1'] }] };
  assert.equal(track.isInternal(w, 'anyone@team.example'), true);
  assert.equal(track.isInternal(w, 'TIA@personal.example'), true);
  assert.equal(track.isInternal(w, 'tia@gmail.com'), true);
  assert.equal(track.isInternal(w, 'client@outside.example'), false);
  const base = { accountId: 't1', threadId: 't-x', messageId: 'm-x', by: 'u-t1', html: '<p>hi</p>', recipients: ['client@outside.example', 'anyone@team.example'], opens: true, clicks: true, notify: true };
  const copies = track.prepare({ ...base, ws: w });
  assert.deepEqual([...copies.keys()], ['client@outside.example']);
  assert.equal(track.prepare({ ...base, ws: { ...w, readTracking: false }, messageId: 'm-y' }).size, 0);
  assert.equal(track.prepare({ ...base, ws: w, messageId: 'm-z', html: undefined }).size, 0, 'no HTML, no picture');
});
await test('Tracking: the app can’t write opens; a tracked message shows what the server has', () => {
  db.writeDocs('workspaces', [{ id: 'w-t', name: 'T', domains: ['team.example'], members: [], accounts: [{ id: 't1', email: 'tia@team.example', users: [] }] }], [], null);
  const thread = { id: 't-x', accountId: 't1', workspaceId: 'w-t', messages: [{ id: 'm-x', to: [{ name: 'Client', email: 'client@outside.example' }] }] };
  db.writeDocs('threads', [thread], [], null);
  const token = db.db.prepare("SELECT token FROM mail_track WHERE message_id = 'm-x'").get().token;
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  assert.equal(track.recordOpen(token, { userAgent: ua, ip: '203.0.113.9', headers: {} }), true);
  assert.equal(track.recordOpen(token, { userAgent: ua, ip: '203.0.113.9', headers: {} }), false, 'the same open again within a minute');
  const fake = { ...thread, messages: [{ ...thread.messages[0], tracking: { 'client@outside.example': { opens: [{ at: '2020-01-01T00:00:00Z', device: 'x' }, { at: '2020-01-02T00:00:00Z', device: 'x' }], clicks: [] } } }] };
  const kept = track.guardThread(fake, db.getDoc('threads', 't-x'), false);
  assert.equal(kept.messages[0].tracking['client@outside.example'].opens.length, 1);
  assert.equal(kept.messages[0].tracking['client@outside.example'].opens[0].device, 'Mac · Apple Mail');
  const fresh = track.guardThread({ id: 't-new', messages: [{ id: 'm-new', tracking: { 'a@b.example': { opens: [{ at: 'x', device: 'y' }], clicks: [{ at: 'x', label: 'l', url: 'u' }] } } }] }, undefined, false);
  assert.deepEqual(fresh.messages[0].tracking, { 'a@b.example': { opens: [], clicks: [] } }, 'a new message only names who will be tracked');
});

/* ---------- backups (server/db.ts) ---------- */

await test('Backups: a labelled one-off sits next to the daily copy and outside its rotation', async () => {
  const daily = await db.backup();
  const labelled = await db.backup('before-demo-cleanup');
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(daily.split('/').pop(), `sprint2go-${day}.db`);
  assert.equal(labelled.split('/').pop(), `sprint2go-${day}-before-demo-cleanup.db`);
  const bdir = join(dir, 'backups');
  for (let i = 1; i <= 20; i++) writeFileSync(join(bdir, `sprint2go-2020-01-${String(i).padStart(2, '0')}.db`), '');
  await db.backup();
  const files = readdirSync(bdir);
  assert.equal(files.filter((f) => db.DAILY_BACKUP.test(f)).length, 14, 'the last 14 daily copies');
  assert.ok(files.includes(`sprint2go-${day}-before-demo-cleanup.db`), 'the labelled copy is kept');
  assert.ok(files.includes(`sprint2go-${day}.db`), 'today’s daily copy is kept');
});

/* ---------- the mail server's certificate (server/mailcert.ts) ---------- */

const cert = await import('../server/mailcert.ts');
await test('Certificate: Let’s Encrypt stays off without CF_DNS_TOKEN', async () => {
  assert.equal(cert.acmeConfigured(), false);
  assert.equal(await cert.ensureAcme('mail.example-s2g.com', () => {}), false);
  assert.equal(cert.certState('mail.example-s2g.com').acme, false);
});
await test('Certificate: the self-signed fallback is served and never called trusted', () => {
  const tls = cert.loadTls('mail.example-s2g.com');
  if (!tls) return console.log('     (no openssl here: plain SMTP only, nothing to check)');
  assert.equal(tls.source, 'self-signed');
  const st = cert.certState('mail.example-s2g.com');
  assert.equal(st.trusted, false);
  assert.equal(st.issuer, 'self-signed');
  assert.ok((st.daysLeft ?? 0) > 3000);
});
await test('Certificate: certificate files that don’t match their key fall back to self-signed instead of stopping the server', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const other = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  writeFileSync(join(dir, 'other-key.pem'), other);
  process.env.MAIL_TLS_CERT = join(dir, 'mail-cert.pem'); // the self-signed one, with a key it wasn't made for
  process.env.MAIL_TLS_KEY = join(dir, 'other-key.pem');
  const tls = cert.loadTls('mail.example-s2g.com');
  delete process.env.MAIL_TLS_CERT;
  delete process.env.MAIL_TLS_KEY;
  if (!tls) return console.log('     (no openssl here: nothing to fall back to)');
  assert.equal(tls.source, 'self-signed');
  assert.match(cert.certState('mail.example-s2g.com').error?.message ?? '', /usable pair/);
});
await test('Certificate: with a token, an empty host or localhost is never sent to Let’s Encrypt', async () => {
  process.env.CF_DNS_TOKEN = 'not-a-real-token';
  assert.equal(await cert.ensureAcme('localhost', () => {}), false);
  process.env.CF_ZONE_ID = 'zone-123';
  assert.equal(await cert.zoneFor('mail.example-s2g.com'), 'zone-123');
  delete process.env.CF_DNS_TOKEN;
  delete process.env.CF_ZONE_ID;
});

db.db.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
