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
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.equal(mailer.systemMailPath(), 'own');
  process.env.NODE_ENV = 'development';
  assert.equal(mailer.systemMailPath(), 'log', 'a laptop shows codes instead of mailing real people');
  if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
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

/* ---------- what a plan allows (server/billing.ts) ---------- */

const billing = await import('../server/billing.ts');
const platform = await import('../server/platform.ts');
const DAY = 86_400_000;
const paidPlan = (extra = {}) => ({ track: 'own', tier: 'small', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: 'B', emails: ['owner@b.example'] }, since: '2026-01-15T00:00:00.000Z', ...extra });
await test('Pausing: up to 90 days in any year, never on Free or the trial; resuming closes the pause', () => {
  const on = billing.pauseOnSave({ paused: true, tier: 'small' }, paidPlan());
  assert.equal(on.paused, true);
  assert.equal(on.pauses.length, 1);
  const off = billing.pauseOnSave({ paused: false, tier: 'small' }, paidPlan({ paused: true, pauses: on.pauses }));
  assert.equal(off.paused, undefined);
  assert.ok(off.pauses[0].to, 'the pause has an end');
  const used = [{ from: new Date(Date.now() - 100 * DAY).toISOString(), to: new Date(Date.now() - 10 * DAY).toISOString() }];
  assert.equal(Math.round(billing.pauseDaysUsed(used)), 90);
  assert.match(billing.pauseOnSave({ paused: true, tier: 'small' }, paidPlan({ pauses: used })).why, /3 months a year/);
  assert.match(billing.pauseOnSave({ paused: true, tier: 'free' }, paidPlan({ tier: 'free' })).why, /paid plan/);
  assert.match(billing.pauseOnSave({ paused: true, tier: 'studio' }, paidPlan({ tier: 'studio', trialEnds: new Date(Date.now() + 5 * DAY).toISOString() })).why, /trial/);
  // Pauses from more than a year ago don't count.
  assert.equal(billing.pauseDaysUsed([{ from: new Date(Date.now() - 500 * DAY).toISOString(), to: new Date(Date.now() - 400 * DAY).toISOString() }]), 0);
});
await test('Pausing: a pause that used up the year resumes by itself, and the owners hear it', () => {
  const ws = { id: 'w-pause', name: 'Paused Co', members: [{ userId: 'u-p', role: 'owner' }], accounts: [], plan: paidPlan({ paused: true, pauses: [{ from: new Date(Date.now() - 91 * DAY).toISOString() }] }) };
  db.writeDocs('workspaces', [ws], [], null);
  const told = [];
  const resumed = billing.resumeExpiredPauses((w) => db.writeDocs('workspaces', [w], [], null), (ids, text) => told.push([ids, text]));
  assert.deepEqual(resumed, ['w-pause']);
  assert.equal(db.getDoc('workspaces', 'w-pause').plan.paused, undefined);
  assert.deepEqual(told[0][0], ['u-p']);
  assert.equal(billing.readOnlyWhy(db.getDoc('workspaces', 'w-pause')), null);
  assert.match(billing.readOnlyWhy({ name: 'X', plan: { paused: true } }), /paused, so it’s read-only/);
});
await test('Cancelling waits for the end of the paid period, then moves to Free', () => {
  assert.equal(billing.periodEnd({ cycle: 'monthly' }, new Date('2026-10-09T10:00:00Z')), '2026-11-01T00:00:00.000Z');
  assert.equal(billing.periodEnd({ cycle: 'yearly', since: '2026-03-15T00:00:00.000Z' }, new Date('2026-10-09T10:00:00Z')), '2027-03-15T00:00:00.000Z');
  db.writeDocs('workspaces', [{ id: 'w-cancel', name: 'Leaving', members: [{ userId: 'u-c', role: 'owner' }], accounts: [], plan: paidPlan({ cancelAt: new Date(Date.now() - 1000).toISOString() }) }], [], null);
  billing.endCancelled((w) => db.writeDocs('workspaces', [w], [], null), () => {});
  assert.equal(db.getDoc('workspaces', 'w-cancel').plan.tier, 'free');
  assert.equal(db.getDoc('workspaces', 'w-cancel').plan.cancelAt, undefined);
});
await test('Hosted mailboxes: one per person on paid plans (shared free), Free pays for each; beyond the room they can’t send', () => {
  const box = (id, kind = 'personal', extra = {}) => ({ id, email: `${id}@b.example`, name: id, kind, users: [], ...extra });
  const ws = { id: 'w-box', name: 'Boxes', members: [{ userId: 'u-b1', role: 'owner' }, { userId: 'u-b2', role: 'member' }], accounts: [box('a'), box('b'), box('shared', 'shared'), box('kept', 'personal', { provider: 'google' })], plan: paidPlan() };
  assert.deepEqual({ ...billing.mailboxes(ws) }, { included: 2, addon: 0, total: 2, sharedFree: true, used: 2 });
  const more = billing.mailboxesOnSave({ ...ws, accounts: [...ws.accounts, box('c')] }, ws);
  assert.equal(more.accounts.length, ws.accounts.length, 'a third personal mailbox is refused');
  assert.match(more.why, /room for 2 personal hosted mailboxes/);
  assert.equal(billing.mailboxesOnSave({ ...ws, accounts: [...ws.accounts, box('c')], plan: paidPlan({ addons: { mailboxes: 1, storage50: 0, meetHours10: 0, branding: false } }) }, ws).why, undefined, 'with a mailbox add-on it fits');
  const free = { ...ws, plan: paidPlan({ tier: 'free' }) };
  assert.equal(billing.mailboxes(free).total, 0);
  assert.deepEqual([...billing.overRoom(free)], ['a', 'b', 'shared'], 'after a downgrade to Free, every hosted mailbox waits (shared ones too)');
  assert.equal(billing.overRoom(ws).size, 0);
});
await test('Notetaker hours: the plan’s, plus add-ons, minus what bots used this month', () => {
  const ws = { id: 'w-meet', name: 'Meet', members: [{ userId: 'u-m', role: 'owner' }], accounts: [], plan: paidPlan({ addons: { mailboxes: 0, storage50: 0, meetHours10: 1, branding: false } }) };
  db.writeDocs('workspaces', [ws], [], null);
  db.writeDocs('meetings', [{ id: 'mt-1', workspaceId: 'w-meet', bot: true, status: 'done', at: new Date().toISOString(), minutes: 90 }, { id: 'mt-2', workspaceId: 'w-meet', bot: false, status: 'done', at: new Date().toISOString(), minutes: 600 }], [], null);
  const m = billing.meetMinutes(ws);
  assert.equal(m.allowance, (4 + 10) * 60, 'Small: 4 hours a person, plus 10');
  assert.equal(m.used, 90, 'only the bot’s meetings count');
  assert.equal(m.left, 14 * 60 - 90);
  assert.equal(billing.meetMinutes({ ...ws, plan: paidPlan({ tier: 'business' }) }).left, Infinity);
});
await test('Boosted credits: an invoice by bank transfer; the credits arrive once, when it’s paid', () => {
  assert.match(billing.creditsBlocked(false), /isn’t available/);
  assert.match(billing.creditsBlocked(true), /bank details/, 'no bank details yet: nothing to pay into');
  platform.setSetting('billing', { name: 'sprint2go', address: '', npwp: '', bank: 'BCA 123 456 7890 a.n. PT Test', email: '' });
  assert.equal(billing.creditsBlocked(true), null);
  db.writeDocs('workspaces', [{ id: 'w-credits', name: 'Credits', members: [{ userId: 'u-cr', role: 'owner' }], accounts: [], plan: paidPlan(), mailCredits: 10 }], [], null);
  const ws = db.getDoc('workspaces', 'w-credits');
  const r = billing.orderCredits(ws, 5000, 'u-cr');
  assert.equal(r.credits, 5000);
  assert.equal(r.invoice.status, 'sent');
  assert.equal(r.invoice.subtotal, 59_000);
  assert.equal(db.getDoc('workspaces', 'w-credits').mailCredits, 10, 'nothing is added before it’s paid');
  assert.equal(billing.openOrders('w-credits').length, 1);
  assert.ok(billing.isCreditInvoice(r.invoice.id));
  assert.equal(billing.orderCredits(ws, 1234, 'u-cr').error, 'Pick one of the packs.');
  const save = (w) => db.writeDocs('workspaces', [w], [], null);
  assert.equal(billing.invoicePaid(r.invoice.id, save, () => {}), 5010);
  assert.equal(billing.invoicePaid(r.invoice.id, save, () => {}), null, 'paying twice adds nothing more');
  assert.equal(db.getDoc('workspaces', 'w-credits').mailCredits, 5010);
  const v = billing.orderCredits(db.getDoc('workspaces', 'w-credits'), 1000, 'u-cr');
  billing.invoiceVoided(v.invoice.id);
  assert.equal(billing.invoicePaid(v.invoice.id, save, () => {}), null, 'a voided order never adds credits');
});

/* ---------- WhatsApp's webhook (server/whatsapp.ts) ---------- */

const whatsapp = await import('../server/whatsapp.ts');
const { createHmac } = await import('node:crypto');
await test('WhatsApp: only posts signed with the app’s secret are read; without a secret the webhook is off', () => {
  delete process.env.WHATSAPP_APP_SECRET;
  const ws = { id: 'w-wa', name: 'WA', members: [{ userId: 'u-wa', role: 'owner' }], accounts: [], whatsapp: { phoneNumberId: '555', connected: true, verifyToken: 'tok-123' } };
  db.writeDocs('workspaces', [ws], [], null);
  const q = (t) => new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': t, 'hub.challenge': 'abc' });
  assert.equal(whatsapp.challenge(q('tok-123'), [ws]).status, 403, 'no secret yet: Meta’s check fails');
  const raw = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '555' }, messages: [{ from: '62811', type: 'text', text: { body: 'hi' } }] } }] }] }));
  const sig = (key) => 'sha256=' + createHmac('sha256', key).update(raw).digest('hex');
  assert.equal(whatsapp.receive(raw, sig('anything'), [ws], () => {}).status, 401);
  db.saveKey('w-wa', whatsapp.SECRET_KEY, 'a'.repeat(32), undefined, 'u-wa');
  assert.deepEqual(whatsapp.challenge(q('tok-123'), [ws]), { status: 200, body: 'abc' });
  assert.equal(whatsapp.challenge(q('tok-124'), [ws]).status, 403);
  assert.equal(whatsapp.receive(raw, undefined, [ws], () => {}).status, 401, 'unsigned');
  assert.equal(whatsapp.receive(raw, sig('b'.repeat(32)), [ws], () => {}).status, 401, 'signed with another secret');
  assert.equal(whatsapp.receive(Buffer.concat([raw, Buffer.from(' ')]), sig('a'.repeat(32)), [ws], () => {}).status, 401, 'a changed body');
  const out = whatsapp.receive(raw, sig('a'.repeat(32)), [ws], () => {});
  assert.deepEqual(out, { status: 200, read: 1 });
  process.env.WHATSAPP_APP_SECRET = 'platform-secret';
  assert.equal(whatsapp.receive(raw, sig('platform-secret'), [{ ...ws, id: 'w-wa2' }], () => {}).read, 1, 'sprint2go’s own app’s secret works for every company');
  delete process.env.WHATSAPP_APP_SECRET;
});

/* ---------- Settings, AI limits (server/aiLimits.ts) ---------- */

const aiLimits = await import('../server/aiLimits.ts');
await test('AI: blocked providers are never allowed; a key at its monthly cap rests; alerts fire once per level', () => {
  const ws = { id: 'w-ai', name: 'AI Co', members: [{ userId: 'u-ai', role: 'owner' }], ai: { blocked: ['deepseek'], alerts: true, providers: [{ id: 'anthropic', capUsd: 1 }] } };
  db.writeDocs('workspaces', [ws], [], null);
  const may = aiLimits.allowed(ws);
  assert.equal(may('deepseek'), false);
  assert.equal(may('deepseek', true), false, 'not even through our own AI');
  assert.equal(may('anthropic'), true);
  // US$10 per million output tokens on Claude Sonnet 5.5 (the catalogue's price): 50k tokens is US$0.50, half the cap.
  db.logUsage({ workspaceId: 'w-ai', userId: 'u-ai', job: 'draft', provider: 'anthropic', model: 'claude-sonnet-5-5', inTokens: 0, outTokens: 50_000 });
  assert.equal(Math.round(aiLimits.spendUsd('w-ai').anthropic * 100), 50);
  const told = [];
  const tell = (ids, text) => told.push(text?.text ?? text);
  aiLimits.checkAlerts(ws, () => 0, tell);
  assert.equal(told.length, 1);
  assert.match(told[0], /50% of the Anthropic key|50% of the .* key/);
  assert.equal(aiLimits.allowed(ws)('anthropic'), true, 'below the cap the key works');
  db.logUsage({ workspaceId: 'w-ai', userId: 'u-ai', job: 'draft', provider: 'anthropic', model: 'claude-sonnet-5-5', inTokens: 0, outTokens: 60_000 });
  assert.equal(aiLimits.allowed(ws)('anthropic'), false, 'at its cap the key rests');
  assert.equal(aiLimits.allowed(ws)('anthropic', true), true, 'our own AI isn’t the company’s key');
  aiLimits.checkAlerts(ws, () => 0, tell);
  aiLimits.checkAlerts(ws, () => 0, tell);
  assert.equal(told.length, 2, 'straight past 80% to 100%: one message, once');
  assert.match(told[1], /cap .*reached/);
  const quiet = [];
  aiLimits.checkAlerts({ ...ws, ai: { ...ws.ai, alerts: false } }, () => 0, (ids, text) => quiet.push(text));
  assert.equal(quiet.length, 0, 'alerts off: nothing');
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

/* ---------- jobs the settings promise: clocks are set by hand, the outside world is faked ---------- */

// Nothing in these tests may reach a real mail server: any delivery goes to a closed local port.
process.env.MAIL_RELAY_URL = 'smtp://127.0.0.1:9';

/* the notetaker joins by itself (server/autojoin.ts) */

const links = await import('../src/meetingLinks.ts');
await test('Notetaker rule: organize or accept, organize only, every link, off', () => {
  const mine = (e) => e === 'ana@aj.example';
  const own = {};
  const invited = { inviteUid: 'x', organizer: { name: 'Bo', email: 'bo@else.example' }, rsvp: 'tentative' };
  assert.equal(links.joinsByRule(own, 'accepted', mine), true);
  assert.equal(links.joinsByRule(invited, 'accepted', mine), false, 'maybe is not yes');
  assert.equal(links.joinsByRule({ ...invited, rsvp: 'accepted' }, 'accepted', mine), true);
  assert.equal(links.joinsByRule({ ...invited, rsvp: 'accepted' }, 'organizer', mine), false);
  assert.equal(links.joinsByRule({ inviteUid: 'x', organizer: { name: 'Ana', email: 'ana@aj.example' } }, 'organizer', mine), true);
  assert.equal(links.joinsByRule({ feed: 'link' }, 'accepted', mine), true, 'a linked calendar keeps what they go to');
  assert.equal(links.joinsByRule(invited, 'all', mine), true);
  assert.equal(links.joinsByRule(own, 'off', mine), false);
  const ev = { id: 'e', title: 't', calendarId: 'c', start: '', end: '', meetUrl: 'https://teams.microsoft.com/l/meetup-join/abc' };
  assert.equal(links.botJoins(ev, 'all', {}, mine), false, 'Teams: the notetaker can’t join');
  assert.equal(links.botJoins({ ...ev, meetUrl: 'https://zoom.us/j/123' }, 'off', { e: true }, mine), true, 'their own switch wins');
});

const autojoin = await import('../server/autojoin.ts');
const T0 = Date.parse('2026-10-12T02:00:00.000Z'); // Monday 9:00 in Jakarta
const ajEvent = (id, mins, extra = {}) => ({ id, title: `Call ${id}`, calendarId: 'work', start: new Date(T0 + mins * 60_000).toISOString(), end: new Date(T0 + (mins + 30) * 60_000).toISOString(), userId: 'aj-ana', workspaceId: 'w-aj', meetUrl: `https://meet.google.com/abc-defg-${id}`, ...extra });
db.writeDocs('users', [{ id: 'aj-ana', name: 'Ana Owner', email: 'ana@aj.example' }, { id: 'aj-mo', name: 'Mo Member', email: 'mo@aj.example' }], [], null);
db.writeDocs('workspaces', [{ id: 'w-aj', name: 'AJ', members: [{ userId: 'aj-ana', role: 'owner' }, { userId: 'aj-mo', role: 'member' }], accounts: [], meetings: { joinMode: 'accepted', botName: 'AJ Notetaker' }, plan: { tier: 'studio', track: 'ai', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false } } }], [], null);
db.writeDocs('events', [
  ajEvent('soon', 1),
  ajEvent('later', 10),
  ajEvent('maybe', 1, { inviteUid: 'u1', organizer: { name: 'Bo', email: 'bo@else.example' }, rsvp: 'tentative' }),
  ajEvent('teams', 1, { meetUrl: 'https://teams.microsoft.com/l/meetup-join/xyz' }),
  ajEvent('skip', 1),
  { ...ajEvent('soon', 1), id: 'soon-mo', userId: 'aj-mo' }, // the same call on a colleague's calendar
], [], null);
db.writeDocs('prefs', [{ id: 'aj-ana', value: { 's2g-join:aj-ana': { skip: false } } }], [], null);
const ajSent = [];
const ajNotes = [];
const ajDeps = { recorderUp: () => true, send: async (_ws, m) => (ajSent.push(m), null), notify: (ids, _ws, text) => ajNotes.push({ ids, text: text?.text ?? text }) };
await test('Auto-join: only events about to start, with a Meet or Zoom link, that the rules say to record; once per call', async () => {
  const r = await autojoin.runAutoJoin(ajDeps, T0);
  assert.deepEqual(r.map((x) => [x.eventId, x.outcome]), [['soon', 'sent']]);
  assert.equal(ajSent[0].url, 'https://meet.google.com/abc-defg-soon');
  assert.equal(ajSent[0].createdBy, 'aj-ana');
  assert.equal(ajSent[0].eventId, 'soon');
  assert.equal(ajSent[0].bot, true);
  assert.equal(ajSent[0].botName, 'AJ Notetaker');
  assert.equal((await autojoin.runAutoJoin(ajDeps, T0 + 30_000)).length, 0, 'never twice');
  const later = await autojoin.runAutoJoin(ajDeps, T0 + 9 * 60_000);
  assert.deepEqual(later.map((x) => x.eventId), ['later']);
});
await test('Auto-join: nothing while the recorder is down', async () => {
  db.writeDocs('events', [ajEvent('down', 31)], [], null);
  assert.equal((await autojoin.runAutoJoin({ ...ajDeps, recorderUp: () => false }, T0 + 30 * 60_000)).length, 0);
});
await test('Auto-join: a recorder that refuses marks it failed and tells the owner', async () => {
  const r = await autojoin.runAutoJoin({ ...ajDeps, send: async () => 'Recorder said 500' }, T0 + 30 * 60_000);
  assert.deepEqual(r.map((x) => [x.eventId, x.outcome]), [['down', 'failed']]);
  assert.match(ajNotes.at(-1).text, /couldn’t join “Call down”: Recorder said 500/);
});
await test('Auto-join: only admins when "Who can record" says so', async () => {
  const w = db.getDoc('workspaces', 'w-aj');
  db.writeDocs('workspaces', [{ ...w, meetings: { ...w.meetings, whoCanRecord: 'admins' } }], [], null);
  db.writeDocs('events', [{ ...ajEvent('mo', 40), userId: 'aj-mo' }], [], null);
  const r = await autojoin.runAutoJoin(ajDeps, T0 + 39 * 60_000);
  assert.deepEqual(r.map((x) => [x.eventId, x.outcome]), [['mo', 'not-allowed']]);
  db.writeDocs('workspaces', [w], [], null);
});
await test('Auto-join: the plan’s meeting-bot hours used up means no bot, and the owner hears why', async () => {
  const h = autojoin.botHours(db.getDoc('workspaces', 'w-aj'), T0);
  assert.equal(h.hours, 100, 'Studio AI: 10 hours for each of the 10 included seats');
  db.writeDocs('meetings', [{ id: 'm-used', workspaceId: 'w-aj', bot: true, minutes: 6000, at: new Date(T0 - 86_400_000).toISOString() }], [], null);
  db.writeDocs('events', [ajEvent('full', 50)], [], null);
  const r = await autojoin.runAutoJoin(ajDeps, T0 + 49 * 60_000);
  assert.deepEqual(r.map((x) => [x.eventId, x.outcome]), [['full', 'no-hours']]);
  assert.match(ajNotes.at(-1).text, /100 meeting-bot hours are used up/);
  db.writeDocs('meetings', [], ['m-used'], null);
});

/* channel summaries on a schedule (src/jobTimes.ts, server/summaries.ts) */

const jt = await import('../src/jobTimes.ts');
const at = (day, hour, minute = 0) => jt.zonedTime(day, hour, 'Asia/Jakarta') + minute * 60_000;

await test('Job times: local days, hours and run days in Jakarta', () => {
  assert.equal(new Date(at('2026-10-09', 6)).toISOString(), '2026-10-08T23:00:00.000Z');
  assert.deepEqual(jt.localParts(at('2026-10-09', 6, 30), 'Asia/Jakarta'), { day: '2026-10-09', hour: 6, minute: 30, weekday: 5 });
  assert.equal(jt.runDayOn('weekly', '2026-10-09'), '2026-10-05');
  assert.equal(jt.runDayOn('monthly', '2026-10-09'), '2026-10-01');
  assert.deepEqual(jt.summaryPeriod('monthly', '2026-10-01'), { key: 'monthly:2026-09', from: '2026-09-01', to: '2026-10-01', label: 'September 2026' });
  assert.deepEqual(jt.summaryPeriod('weekly', '2026-10-05'), { key: 'weekly:2026-09-28', from: '2026-09-28', to: '2026-10-05', label: 'Week of 28 September' });
  assert.equal(jt.summaryPeriod('daily', '2026-10-09').label, 'Thursday 8 October');
});
await test('Job times: a summary is due once, from 6:00 on its day; a missed one only when the schedule ran before', () => {
  assert.equal(jt.summaryDue('daily', undefined, at('2026-10-09', 5)), null, 'not before 6:00');
  assert.equal(jt.summaryDue('daily', undefined, at('2026-10-09', 6))?.key, 'daily:2026-10-08');
  assert.equal(jt.summaryDue('daily', 'daily:2026-10-08', at('2026-10-09', 9)), null, 'written already');
  assert.equal(jt.summaryDue('weekly', undefined, at('2026-10-09', 9)), null, 'a new schedule waits for Monday');
  assert.equal(jt.summaryDue('weekly', 'weekly:2026-09-21', at('2026-10-06', 9))?.key, 'weekly:2026-09-28', 'missed Monday, caught up on Tuesday');
  assert.equal(jt.summaryDue('weekly', 'weekly:2026-09-21', at('2026-10-09', 9)), null, 'too late to catch up');
  assert.equal(jt.summaryDue('monthly', undefined, at('2026-11-01', 6))?.key, 'monthly:2026-10');
  assert.equal(jt.summaryDue('off', undefined, at('2026-11-01', 6)), null);
  assert.equal(jt.nextSummaryDay('weekly', undefined, at('2026-10-09', 9)), '2026-10-12');
  assert.equal(jt.nextSummaryDay('daily', 'daily:2026-10-08', at('2026-10-09', 9)), '2026-10-10');
  assert.equal(jt.nextSummaryDay('daily', 'daily:2026-10-07', at('2026-10-09', 3)), '2026-10-09');
  assert.equal(jt.nextSummaryDay('monthly', 'monthly:2026-09', at('2026-10-09', 9)), '2026-11-01');
  assert.equal(jt.channelSchedule({ kind: 'dm' }), 'off');
  assert.equal(jt.channelSchedule({ kind: 'channel' }), 'monthly');
  assert.equal(jt.channelSchedule({ kind: 'channel', digest: true }), 'daily');
});

const summaries = await import('../server/summaries.ts');
const S0 = at('2026-10-09', 6, 5); // Friday, just after summaries are written
db.writeDocs('workspaces', [{ id: 'w-sum', name: 'Sum', members: [{ userId: 'aj-ana', role: 'owner' }], accounts: [] }], [], null);
db.writeDocs('channels', [
  { id: 'ch-daily', workspaceId: 'w-sum', kind: 'channel', name: 'design', members: ['aj-ana'], summary: { schedule: 'daily', post: true, history: [{ id: 'old', text: 'Asked by hand', period: 'Today', at: '2026-10-07T03:00:00.000Z', auto: false, by: 'aj-ana' }] } },
  { id: 'ch-quiet', workspaceId: 'w-sum', kind: 'channel', name: 'quiet', members: ['aj-ana'], summary: { schedule: 'daily', post: false, history: [] } },
  { id: 'ch-monthly', workspaceId: 'w-sum', kind: 'channel', name: 'general', members: ['aj-ana'] },
  { id: 'ch-dm', workspaceId: 'w-sum', kind: 'dm', name: '', members: ['aj-ana', 'aj-mo'] },
], [], null);
const yesterday = (h) => new Date(at('2026-10-08', h)).toISOString();
db.writeDocs('messages', [
  { id: 'sm1', channelId: 'ch-daily', userId: 'aj-ana', text: 'Logo v2 is approved', at: yesterday(10) },
  { id: 'sm2', channelId: 'ch-daily', userId: 'aj-mo', text: 'Sending files tomorrow', at: yesterday(15), files: [{ name: 'logo.png', size: 10, type: 'image/png' }] },
  { id: 'sm3', channelId: 'ch-daily', userId: 'aj-ana', text: 'Today, not yesterday', at: new Date(S0 - 60_000).toISOString() },
  { id: 'sm4', channelId: 'ch-dm', userId: 'aj-ana', text: 'A private chat', at: yesterday(11) },
], [], null);
const sumInputs = [];
const sumDeps = (write) => ({ broadcast: () => {}, write: async (ws, input) => (sumInputs.push(input), write(ws, input)) });
await test('Summaries: a due one is written once, kept in history and posted; nothing happened means none', async () => {
  const r = await summaries.runSummaries(sumDeps(async () => ({ text: 'Logo approved; files come tomorrow.' })), S0, 'Asia/Jakarta');
  assert.deepEqual(r.map((x) => [x.channelId, x.state]).sort(), [['ch-daily', 'done'], ['ch-quiet', 'nothing']], 'monthly waits for the 1st, a DM has no schedule');
  assert.equal(sumInputs.length, 1, 'no AI for a quiet channel');
  assert.deepEqual(sumInputs[0].messages.map((m) => m.text), ['Logo v2 is approved', 'Sending files tomorrow'], 'only yesterday, in Jakarta time');
  assert.equal(sumInputs[0].period, 'Thursday 8 October');
  assert.deepEqual(sumInputs[0].messages[1].files, ['logo.png']);
  const ch = db.getDoc('channels', 'ch-daily');
  assert.equal(ch.summary.history[0].text, 'Logo approved; files come tomorrow.');
  assert.equal(ch.summary.history[0].auto, true);
  assert.equal(ch.summary.history[1].id, 'old', 'earlier summaries stay');
  assert.equal(ch.summary.last.key, 'daily:2026-10-08');
  const posted = db.allDocs('messages').filter((m) => m.channelId === 'ch-daily' && m.kind === 'summary');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].summaryOf, 'Thursday 8 October');
  assert.equal((await summaries.runSummaries(sumDeps(async () => ({ text: 'again' })), S0 + 15 * 60_000, 'Asia/Jakarta')).length, 0, 'never twice');
});
await test('Summaries: no working AI means no summary, and the channel says why', async () => {
  const S1 = at('2026-10-10', 6, 5);
  db.writeDocs('messages', [{ id: 'sm5', channelId: 'ch-daily', userId: 'aj-ana', text: 'Friday news', at: new Date(at('2026-10-09', 12)).toISOString() }], [], null);
  const r = (await summaries.runSummaries(sumDeps(async () => ({ off: 'AI isn’t set up for this company.' })), S1, 'Asia/Jakarta')).filter((x) => x.channelId === 'ch-daily');
  assert.deepEqual(r.map((x) => [x.channelId, x.state]), [['ch-daily', 'off']]);
  const ch = db.getDoc('channels', 'ch-daily');
  assert.equal(ch.summary.last.why, 'AI isn’t set up for this company.');
  assert.equal(ch.summary.history.length, 2, 'nothing added');
  assert.equal(jt.nextSummaryDay('daily', jt.settledKey(ch.summary.last), S1 + 60_000, 'Asia/Jakarta', true), '2026-10-11', 'Next moves on');
});
await test('Summaries: a failure is tried again an hour later, then written', async () => {
  const S2 = at('2026-10-11', 6, 5);
  db.writeDocs('messages', [{ id: 'sm6', channelId: 'ch-daily', userId: 'aj-ana', text: 'Saturday news', at: new Date(at('2026-10-10', 12)).toISOString() }], [], null);
  const daily = (list) => list.filter((x) => x.channelId === 'ch-daily');
  let r = daily(await summaries.runSummaries(sumDeps(async () => ({ failed: 'timeout' })), S2, 'Asia/Jakarta'));
  assert.deepEqual(r.map((x) => x.state), ['failed']);
  assert.equal(daily(await summaries.runSummaries(sumDeps(async () => ({ text: 'too early' })), S2 + 30 * 60_000, 'Asia/Jakarta')).length, 0, 'waits for the retry');
  r = daily(await summaries.runSummaries(sumDeps(async () => ({ text: 'Saturday: news.' })), S2 + 61 * 60_000, 'Asia/Jakarta'));
  assert.deepEqual(r.map((x) => [x.key, x.state]), [['daily:2026-10-10', 'done']]);
});
await test('Summaries: an older copy saved from the app keeps the server’s summaries and adds asked ones', () => {
  const before = db.getDoc('channels', 'ch-daily');
  const stale = { ...before, topic: 'new topic', summary: { schedule: 'weekly', post: false, history: [{ id: 'mine', text: 'Asked now', period: 'This week', at: '2026-10-11T05:00:00.000Z', auto: false }], last: undefined } };
  const kept = summaries.keepSummaries(stale, before);
  assert.equal(kept.topic, 'new topic');
  assert.equal(kept.summary.schedule, 'weekly');
  assert.deepEqual(kept.summary.last, before.summary.last);
  assert.ok(kept.summary.history.some((h) => h.id === 'mine') && kept.summary.history.some((h) => h.text === 'Saturday: news.'));
});

/* undo send (server/mailer.ts): mail waits for the sender's window, Undo takes it back */

process.env.MAIL_ENABLED = '0'; // no SMTP server here, just the engine's bookkeeping
const mailBroadcasts = [];
mailer.startMailer({ publicUrl: 'http://localhost', broadcast: (c, u) => mailBroadcasts.push([c, u]), notify: () => {}, log: () => {} });
db.writeDocs('workspaces', [{ id: 'w-undo', name: 'Undo Co', domains: [], members: [{ userId: 'aj-ana', role: 'owner' }], accounts: [
  { id: 'ub-ana', email: `ana.undo@${mailer.MAIL_HOST}`, name: 'Ana', kind: 'personal', users: ['aj-ana'] },
  { id: 'ub-mo', email: `mo.undo@${mailer.MAIL_HOST}`, name: 'Mo', kind: 'personal', users: ['aj-mo'] },
] }], [], null);
const outgoing = (messageId) => ({ workspaceId: 'w-undo', accountId: 'ub-ana', threadId: 't-undo', messageId, from: { name: 'Ana', email: `ana.undo@${mailer.MAIL_HOST}` }, to: [{ name: 'Mo', email: `mo.undo@${mailer.MAIL_HOST}` }], cc: [], subject: 'Hello', text: 'Hi Mo', files: [] });
const inMoBox = () => db.allDocs('threads').filter((t) => t.accountId === 'ub-mo').length;
db.writeDocs('threads', [{ id: 't-undo', accountId: 'ub-ana', subject: 'Hello', location: 'archive', messages: [{ id: 'msg-1', from: {}, to: [], date: '', body: 'Hi Mo' }] }], [], null);
await test('Undo send: the email waits, nobody gets it, and Undo takes it back (only its sender)', async () => {
  const h = mailer.holdSend(outgoing('msg-1'), { userId: 'aj-ana', releaseAt: Date.now() + 20_000 });
  assert.equal(db.getDoc('threads', 't-undo').messages[0].delivery.state, 'held');
  assert.equal(mailer.heldUntil('t-undo', 'msg-1'), h.until);
  assert.equal((await mailer.releaseHeld(Date.now())).length, 0, 'not before its time');
  assert.equal(inMoBox(), 0, 'our own mailboxes don’t get it while it waits');
  assert.deepEqual(mailer.cancelHeld('t-undo', 'msg-1', 'aj-mo'), { ok: false, why: 'not-yours' });
  const back = mailer.cancelHeld('t-undo', 'msg-1', 'aj-ana');
  assert.equal(back.ok, true);
  assert.equal(back.email.text, 'Hi Mo');
  assert.deepEqual(mailer.cancelHeld('t-undo', 'msg-1', 'aj-ana'), { ok: false, why: 'gone' });
  assert.equal((await mailer.releaseHeld(Date.now() + 60_000)).length, 0, 'an undone email never goes');
  assert.equal(inMoBox(), 0);
});
await test('Undo send: when the window is over it goes out like any email, and can’t be undone', async () => {
  mailer.holdSend(outgoing('msg-2'), { userId: 'aj-ana', releaseAt: Date.now() + 5_000 });
  const r = await mailer.releaseHeld(Date.now() + 6_000);
  assert.deepEqual(r.map((x) => x.state), ['sent']);
  assert.equal(inMoBox(), 1, 'delivered to the colleague’s mailbox');
  assert.deepEqual(mailer.cancelHeld('t-undo', 'msg-2', 'aj-ana'), { ok: false, why: 'gone' });
});
await test('Undo send: a refused email is marked failed on the message', async () => {
  const w = db.getDoc('workspaces', 'w-undo');
  db.writeDocs('workspaces', [{ ...w, accounts: w.accounts.map((a) => (a.id === 'ub-ana' ? { ...a, sendPaused: { reason: 'Too many bounces.' } } : a)) }], [], null);
  db.writeDocs('threads', [{ ...db.getDoc('threads', 't-undo'), messages: [...db.getDoc('threads', 't-undo').messages, { id: 'msg-3', from: {}, to: [], date: '', body: 'x' }] }], [], null);
  mailer.holdSend(outgoing('msg-3'), { userId: 'aj-ana', releaseAt: Date.now() - 1 });
  const r = await mailer.releaseHeld();
  assert.deepEqual(r.map((x) => x.state), ['failed']);
  const m = db.getDoc('threads', 't-undo').messages.find((x) => x.id === 'msg-3');
  assert.equal(m.delivery.state, 'failed');
  assert.match(m.delivery.error, /paused/);
  db.writeDocs('workspaces', [w], [], null);
});

await test('Local mail: outside addresses are held on this computer (marked, never retried); teammates still get it', async () => {
  const relay = process.env.MAIL_RELAY_URL;
  delete process.env.MAIL_RELAY_URL;
  assert.equal(mailer.keepsMailLocal(), true, 'not production, no relay');
  db.writeDocs('threads', [{ ...db.getDoc('threads', 't-undo'), messages: [...db.getDoc('threads', 't-undo').messages, { id: 'msg-4', from: {}, to: [], date: '', body: 'x' }] }], [], null);
  const before = inMoBox();
  const email = { ...outgoing('msg-4'), to: [{ name: 'Mo', email: `mo.undo@${mailer.MAIL_HOST}` }, { name: 'Budi', email: 'budi@client.example' }] };
  assert.deepEqual(mailer.heldLocally(email), ['budi@client.example']);
  const r = await mailer.queueSend(email);
  assert.deepEqual(r.held, ['budi@client.example']);
  assert.equal(r.queued, 0, 'nothing waits to go out');
  assert.equal(inMoBox(), before + 1, 'the colleague on this server got it');
  const rows = db.db.prepare('SELECT state, error, attempts FROM outbox WHERE thread_id = ? AND message_id = ?').all('t-undo', 'msg-4');
  assert.deepEqual(rows.map((x) => x.state), ['local']);
  assert.match(rows[0].error, /Held on this computer/);
  const m = db.getDoc('threads', 't-undo').messages.find((x) => x.id === 'msg-4');
  assert.equal(m.delivery.state, 'local');
  assert.deepEqual(m.delivery.kept, ['budi@client.example']);
  // An older row still queued for the world (from before) is held by the pump, once, without a try.
  db.db.prepare("INSERT INTO outbox (id, workspace_id, account_id, thread_id, message_id, route, from_addr, to_addr, raw, attempts, next_at, state, error, created_at) VALUES ('old-q', 'w-undo', 'ub-ana', 't-undo', 'msg-4', 'own', 'a@x', 'old@client.example', x'00', 0, ?, 'queued', NULL, ?)").run(new Date(0).toISOString(), new Date().toISOString());
  await mailer.pump();
  assert.deepEqual({ ...db.db.prepare("SELECT state, attempts FROM outbox WHERE id = 'old-q'").get() }, { state: 'local', attempts: 0 });
  assert.deepEqual(db.getDoc('threads', 't-undo').messages.find((x) => x.id === 'msg-4').delivery.kept.sort(), ['budi@client.example', 'old@client.example']);
  // A relay, MAIL_ENABLED=1 or production lets it out.
  process.env.MAIL_RELAY_URL = 'smtp://127.0.0.1:1';
  assert.equal(mailer.keepsMailLocal(), false);
  assert.deepEqual(mailer.heldLocally(email), []);
  delete process.env.MAIL_RELAY_URL;
  process.env.MAIL_ENABLED = '1';
  assert.equal(mailer.keepsMailLocal(), false);
  process.env.MAIL_ENABLED = '0';
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.equal(mailer.keepsMailLocal(), false);
  if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
  process.env.MAIL_RELAY_URL = relay;
});

await test('DKIM: mail from an address at our own mail name is signed with the platform key the console shows, and verifies', async () => {
  const { authenticate } = await import('mailauth');
  const records = await mailer.platformDkim();
  const host = records.find((r) => r.domain === mailer.MAIL_HOST);
  assert.ok(host, 'the console lists our own mail name');
  assert.equal(host.host, `s2g._domainkey.${mailer.MAIL_HOST}`);
  assert.match(host.value, /^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]{300,}$/);
  assert.ok(records.some((r) => r.domain === 'example-s2g.com' && /no-reply@example-s2g\.com/.test(r.use)), 'and the support domain of system mail');
  const relay = process.env.MAIL_RELAY_URL; // a closed port: queued with its signature, nothing leaves
  db.writeDocs('threads', [{ ...db.getDoc('threads', 't-undo'), messages: [...db.getDoc('threads', 't-undo').messages, { id: 'msg-5', from: {}, to: [], date: '', body: 'x' }] }], [], null);
  await mailer.queueSend({ ...outgoing('msg-5'), to: [{ name: 'Out', email: 'out@client.example' }] });
  const row = db.db.prepare('SELECT id, raw FROM outbox WHERE thread_id = ? AND message_id = ?').get('t-undo', 'msg-5');
  const raw = Buffer.from(row.raw);
  assert.match(raw.toString('utf8', 0, 600), new RegExp(`DKIM-Signature:[^]*d=${mailer.MAIL_HOST.replace(/\./g, '\\.')};[^]*s=s2g;`));
  const resolver = async (name, type) => {
    if (type === 'TXT' && name === host.host) return [[host.value]];
    throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  };
  const r = await authenticate(raw, { ip: '127.0.0.1', helo: 'test', sender: `ana.undo@${mailer.MAIL_HOST}`, mta: 'test', resolver });
  assert.equal(r.dkim.results[0]?.status?.result, 'pass', 'the signature checks out against the record the console shows');
  db.db.prepare('DELETE FROM outbox WHERE id = ?').run(row.id);
  assert.equal(process.env.MAIL_RELAY_URL, relay);
});

const supportMod = await import('../server/support.ts');
await test('Tickets: an attachment counts only when it was sent with its ticket (before 9 Oct a ticket could point at any file)', () => {
  const at = '2026-10-09T10:00:00.000Z';
  const fits = (f, who = 'u-req') => supportMod.fileFitsTicket(f, who, at);
  assert.equal(fits({ workspaceId: 'w1', by: 'u-req', at: '2026-10-09T09:58:00.000Z' }), true, 'their own upload, made while they wrote it');
  assert.equal(fits({ workspaceId: 'w1', by: 'u-other', at: '2026-10-09T09:58:00.000Z' }), false, 'someone else’s file');
  assert.equal(fits({ workspaceId: 'w1', by: 'u-req', at: '2026-09-01T09:00:00.000Z' }), false, 'their own, but an old file from elsewhere');
  assert.equal(fits({ workspaceId: 'w1', by: 'u-req', at: '2026-10-10T10:00:00.000Z' }), false, 'uploaded after the message');
  assert.equal(fits({ workspaceId: 'w1', by: 'u-req', at: '2026-10-09T09:58:00.000Z' }, null), false, 'no requester to match');
  assert.equal(fits({ workspaceId: 'platform', by: 'mail', at: '2026-10-09T10:00:01.000Z' }), true, 'what came with the email to support');
  assert.equal(fits({ workspaceId: 'platform', by: 'mail', at: '2026-10-01T10:00:00.000Z' }), false, 'another email’s attachment');
  assert.equal(fits({ workspaceId: 'acme', by: 'mail', at: at }), false, 'a company mailbox’s attachment');
  assert.equal(fits(null), false, 'a file that’s gone');
  assert.equal(supportMod.OLD_ATTACHMENT, 'Attachment from before 9 Oct, ask the person to send it again');
});

await test('Invites: an all-day invite goes on the calendar as floating dates, so no zone moves its day', async () => {
  const invites = await import('../server/invites.ts');
  const { parseInvite } = await import('../server/ics.ts');
  const inv = parseInvite('BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:allday-1\nDTSTART;VALUE=DATE:20261020\nDTEND;VALUE=DATE:20261022\nSUMMARY:Offsite\nEND:VEVENT\nEND:VCALENDAR');
  const { docs } = invites.eventsFor(inv, { userId: 'aj-ana', workspaceId: 'w-aj', threadId: 't-x', rsvp: 'accepted', mine: ['ana@aj.example'] });
  assert.equal(docs.length, 1);
  assert.deepEqual([docs[0].start, docs[0].end, docs[0].allDay], ['2026-10-20T00:00:00', '2026-10-22T00:00:00', true]);
  assert.equal(docs[0].occurrence, '2026-10-20T12:00:00.000Z', 'its date as the invite writes it, for later updates and cancellations');
  const timed = parseInvite('BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:timed-1\nDTSTART:20261020T020000Z\nDTEND:20261020T030000Z\nSUMMARY:Call\nEND:VEVENT\nEND:VCALENDAR');
  const t = invites.eventsFor(timed, { userId: 'aj-ana', workspaceId: 'w-aj', threadId: 't-y', rsvp: 'accepted', mine: ['ana@aj.example'] }).docs[0];
  assert.deepEqual([t.start, t.end, t.occurrence], ['2026-10-20T02:00:00.000Z', '2026-10-20T03:00:00.000Z', undefined], 'timed invites keep their instants');
});

await test('Calendar links: the same link written another way is the same calendar', async () => {
  const { calendarLinkKey } = await import('../src/calendarLink.ts');
  const base = calendarLinkKey('https://calendar.google.com/calendar/ical/abc%40group/private-XyZ/basic.ics?a=1&b=2');
  for (const same of [
    'webcal://calendar.google.com/calendar/ical/abc%40group/private-XyZ/basic.ics?b=2&a=1',
    'webcals://CALENDAR.google.com/calendar/ical/abc%40group/private-XyZ/basic.ics?a=1&b=2#top',
    'http://calendar.google.com:80/calendar/ical/abc%40group/private-XyZ/basic.ics/?a=1&b=2',
    '  https://calendar.google.com:443/calendar/ical/abc%40group/private-XyZ/basic.ics?a=1&b=2  ',
  ])
    assert.equal(calendarLinkKey(same), base, same);
  assert.notEqual(calendarLinkKey('https://calendar.google.com/calendar/ical/abc%40group/private-xyz/basic.ics?a=1&b=2'), base, 'a secret address is case-sensitive');
  assert.notEqual(calendarLinkKey('https://calendar.google.com/calendar/ical/abc%40group/private-XyZ/basic.ics?a=1'), base, 'a different query is another calendar');
  assert.equal(calendarLinkKey('ftp://x.example/cal.ics'), null);
  assert.equal(calendarLinkKey('not a link'), null);
  // The server says so instead of adding it again (before it reads anything from the link).
  const feeds = await import('../server/calendarFeeds.ts');
  db.writeDocs('calendars', [{ id: 'link-dup', name: 'Bookings', source: 'ics', ownerId: 'aj-ana', readOnly: true, url: 'https://cal.example.com/feeds/ana.ics?token=a&v=2', share: 'busy' }], [], null);
  await assert.rejects(feeds.addLink('aj-ana', { url: 'webcal://CAL.example.com/feeds/ana.ics/?v=2&token=a' }), /already added this calendar, as “Bookings”/);
  db.writeDocs('calendars', [], ['link-dup'], null);
});

await test('Holidays: each person sees the countries they chose, the company’s until they choose', async () => {
  const { regionsOf, regionsToSave } = await import('../src/holidayRegions.ts');
  assert.deepEqual(regionsOf(undefined, 'ID'), ['ID'], 'nothing chosen: the company’s country');
  assert.deepEqual(regionsOf(undefined, undefined), [], 'a company without holidays: none');
  assert.deepEqual(regionsOf(['SG', 'XX', 'NL'], 'ID'), ['SG', 'NL'], 'their own choice, without the company’s, and only countries we have');
  assert.deepEqual(regionsOf([], 'ID'), [], 'none at all is a choice too');
  assert.equal(regionsToSave(['ID'], 'ID'), undefined, 'just the company’s country: no choice of their own, so a new company country follows');
  assert.deepEqual(regionsToSave(['NL', 'ID', 'SG'], 'ID'), ['ID', 'SG', 'NL'], 'kept in the list’s order');
  assert.deepEqual(regionsToSave([], 'ID'), [], 'none');
  const feeds = await import('../server/calendarFeeds.ts');
  await assert.rejects(feeds.holidaysForPerson('XX'), /aren’t available/);
});

/* email for teammates who are away (server/digest.ts) */

const digest = await import('../server/digest.ts');
const D0 = at('2026-10-12', 9, 10); // Monday 9:10 in Jakarta
const hoursAgo = (h) => new Date(D0 - h * 3600_000).toISOString();
await db.setLogin('aj-ana', 'ana@aj.example', 'unit-test-password');
await db.setLogin('aj-mo', 'mo@aj.example', 'unit-test-password');
db.writeDocs('notices', [
  { id: 'dn-dm', userId: 'aj-ana', workspaceId: 'w-aj', kind: 'mention', text: 'Mo messaged you: “lunch?”', at: hoursAgo(3), read: false, link: { app: 'chat', id: 'ch-x', msg: 'mx' } },
  { id: 'dn-task', userId: 'aj-ana', workspaceId: 'w-aj', kind: 'task', text: 'Mo assigned you “Write the brief”', at: hoursAgo(2), read: false, link: { app: 'tasks', id: 'task-1' } },
  { id: 'dn-read', userId: 'aj-ana', workspaceId: 'w-aj', kind: 'task', text: 'Already read', at: hoursAgo(2), read: true, link: { app: 'tasks', id: 'task-2' } },
  { id: 'dn-seen', userId: 'aj-ana', workspaceId: 'w-aj', kind: 'mention', text: 'Seen in chat', at: hoursAgo(2), read: false, link: { app: 'chat', id: 'ch-seen', msg: 'my' } },
  { id: 'dn-before', userId: 'aj-ana', workspaceId: 'w-aj', kind: 'mention', text: 'From before she left', at: hoursAgo(5), read: false, link: { app: 'chat', id: 'ch-x' } },
  { id: 'dn-done', userId: 'aj-ana', workspaceId: 'w-aj', kind: 'done', text: 'Finished work', at: hoursAgo(2), read: false },
], [], null);
db.writeDocs('prefs', [{ id: 'aj-ana', value: { 's2g-read:aj-ana': { 'ch-seen': hoursAgo(1) }, 'pm-settings:aj-ana': { timeZone: 'Asia/Jakarta' } } }], [], null);
const w0 = db.getDoc('workspaces', 'w-aj');
db.writeDocs('workspaces', [{ ...w0, accounts: [{ id: 'aj-box', email: 'ana@aj.example', name: 'Ana', kind: 'personal', users: ['aj-ana'] }] }], [], null);
db.writeDocs('threads', [
  { id: 'dt-reply', accountId: 'aj-box', subject: 'Proposal', location: 'inbox', unread: true, messages: [{ id: 'q1', from: { name: 'Ana', email: 'ana@aj.example' }, to: [], date: hoursAgo(30), body: 'Here it is' }, { id: 'q2', from: { name: 'Budi', email: 'budi@client.example' }, to: [], date: hoursAgo(1.5), body: 'Looks good' }] },
  { id: 'dt-news', accountId: 'aj-box', subject: 'Newsletter', location: 'inbox', unread: true, messages: [{ id: 'q3', from: { name: 'News', email: 'news@else.example' }, to: [], date: hoursAgo(1.5), body: 'Hi', listUnsubscribe: { url: 'https://x', oneClick: true } }] },
], [], null);
const mails = [];
const digestDeps = (lastActive) => ({ publicUrl: 'https://app.example', lastActive: () => lastActive, send: async (to, subject, text, html) => (mails.push({ to, subject, text, html }), true) });
await test('Digest: someone away gets one email at 9:00 their time, about what came while they were away', async () => {
  assert.equal((await digest.runDigests(digestDeps(D0 - 30 * 60_000), D0)).filter((r) => r.userId === 'aj-ana').length, 0, 'not while they’re around');
  assert.equal((await digest.runDigests(digestDeps(D0 - 4 * 3600_000), at('2026-10-12', 8, 50))).filter((r) => r.userId === 'aj-ana').length, 0, 'not before 9:00');
  const r = await digest.runDigests(digestDeps(D0 - 4 * 3600_000), D0);
  assert.deepEqual(r.filter((x) => x.userId === 'aj-ana'), [{ userId: 'aj-ana', items: 3, sent: true }]);
  const m = mails.at(-1);
  assert.equal(m.to, 'ana@aj.example');
  assert.equal(m.subject, '3 things waiting for you in AJ');
  assert.match(m.text, /Mo messaged you/);
  assert.match(m.text, /https:\/\/app\.example\/tasks\?ws=w-aj&id=task-1&notice=dn-task/);
  assert.match(m.text, /Budi replied: Proposal/);
  for (const not of ['Already read', 'Seen in chat', 'From before she left', 'Finished work', 'Newsletter']) assert.ok(!m.text.includes(not), `${not} is left out`);
  assert.ok(!/—/.test(m.text + m.html), 'no em dashes');
  assert.match(m.html, /<a href="https:\/\/app\.example\/mail\?ws=w-aj&amp;id=dt-reply"/);
});
await test('Digest: never the same thing twice, and once a day', async () => {
  db.writeDocs('notices', [{ id: 'dn-new', userId: 'aj-ana', workspaceId: 'w-aj', kind: 'mention', text: 'Something new', at: new Date(D0 + 60_000).toISOString(), read: false, link: { app: 'chat', id: 'ch-x' } }], [], null);
  assert.equal((await digest.runDigests(digestDeps(D0 - 4 * 3600_000), D0 + 2 * 3600_000)).filter((r) => r.userId === 'aj-ana').length, 0, 'today’s email went already');
  const r = await digest.runDigests(digestDeps(D0 - 4 * 3600_000), D0 + 24 * 3600_000);
  assert.deepEqual(r.filter((x) => x.userId === 'aj-ana'), [{ userId: 'aj-ana', items: 1, sent: true }], 'tomorrow: only the new thing');
});
await test('Digest: hourly or off, and the kinds switched off in Settings, Notifications stay out', async () => {
  db.writeDocs('prefs', [{ id: 'aj-mo', value: { 'pm-settings:aj-mo': { emailDigest: 'hourly', notifyTasks: false, timeZone: 'Asia/Jakarta' } } }], [], null);
  db.writeDocs('notices', [
    { id: 'dm-1', userId: 'aj-mo', workspaceId: 'w-aj', kind: 'mention', text: 'Ana mentioned you in #design', at: new Date(D0 - 90 * 60_000).toISOString(), read: false, link: { app: 'chat', id: 'ch-d' } },
    { id: 'dm-2', userId: 'aj-mo', workspaceId: 'w-aj', kind: 'task', text: 'Ana assigned you a task', at: new Date(D0 - 90 * 60_000).toISOString(), read: false, link: { app: 'tasks', id: 't9' } },
  ], [], null);
  const r = await digest.runDigests(digestDeps(D0 - 2 * 3600_000), at('2026-10-12', 15));
  assert.deepEqual(r.filter((x) => x.userId === 'aj-mo'), [{ userId: 'aj-mo', items: 1, sent: true }], 'hourly: any time of day; tasks are off for Mo');
  db.writeDocs('prefs', [{ id: 'aj-mo', value: { 'pm-settings:aj-mo': { emailDigest: 'off' } } }], [], null);
  db.writeDocs('notices', [{ id: 'dm-3', userId: 'aj-mo', workspaceId: 'w-aj', kind: 'mention', text: 'More', at: new Date(at('2026-10-12', 15, 30)).toISOString(), read: false }], [], null);
  assert.equal((await digest.runDigests(digestDeps(D0 - 2 * 3600_000), at('2026-10-12', 17))).filter((x) => x.userId === 'aj-mo').length, 0, 'off');
});

/* deleting old chat messages (server/retention.ts) */

const retention = await import('../server/retention.ts');
const R0 = Date.parse('2026-10-09T03:00:00.000Z');
const DAYMS = 86_400_000;
await test('Retention: off by default; switching it on starts a week’s notice; a shorter period starts it again', () => {
  assert.equal(retention.chatOnSave({ history: 'forever' }, undefined, R0).started, undefined);
  const on = retention.chatOnSave({ history: '1y', deleteFrom: '2000-01-01T00:00:00.000Z', lastRun: { at: 'x' } }, { history: 'forever' }, R0);
  assert.equal(on.chat.deleteFrom, new Date(R0 + 7 * DAYMS).toISOString(), 'the app can’t set when it starts');
  assert.equal(on.chat.lastRun, undefined, 'or the last run');
  assert.equal(on.started.period, '1y');
  const same = retention.chatOnSave({ history: '1y', celebrations: false }, on.chat, R0 + DAYMS);
  assert.equal(same.started, undefined);
  assert.equal(same.chat.deleteFrom, on.chat.deleteFrom);
  const shorter = retention.chatOnSave({ history: '90d' }, on.chat, R0 + 2 * DAYMS);
  assert.equal(shorter.chat.deleteFrom, new Date(R0 + 9 * DAYMS).toISOString());
  assert.equal(retention.chatOnSave({ history: 'forever' }, on.chat, R0).chat.deleteFrom, undefined);
});
await test('Retention: nothing goes before the notice ends; then old messages go, except pinned, kept projects and live threads; files stay in Drive', () => {
  const chat = retention.chatOnSave({ history: '90d', keep: ['c-keep'] }, undefined, R0).chat;
  db.writeDocs('workspaces', [{ id: 'w-ret', name: 'Ret', members: [{ userId: 'aj-ana', role: 'owner' }], accounts: [], chat }], [], null);
  db.writeDocs('channels', [
    { id: 'rc-1', workspaceId: 'w-ret', kind: 'channel', name: 'general', members: ['aj-ana'] },
    { id: 'rc-keep', workspaceId: 'w-ret', kind: 'channel', name: 'keep', members: ['aj-ana'], clientId: 'c-keep' },
    { id: 'rc-other', workspaceId: 'w-other', kind: 'channel', name: 'other', members: [] },
  ], [], null);
  const old = new Date(R0 - 200 * DAYMS).toISOString();
  const fresh = new Date(R0 - 5 * DAYMS).toISOString();
  db.writeDocs('drive', [{ id: 'dv-1', name: 'brief.pdf', kind: 'pdf', parentId: null, size: 5, modified: old, workspaceId: 'w-ret', channelId: 'rc-1' }], [], null);
  db.writeDocs('messages', [
    { id: 'rm-old', channelId: 'rc-1', userId: 'aj-ana', text: 'old', at: old },
    { id: 'rm-file', channelId: 'rc-1', userId: 'aj-ana', text: 'brief', at: old, files: [{ name: 'brief.pdf', size: 5, type: 'application/pdf', driveId: 'dv-1', url: '/api/files/0123456789abcdef0123456789abcdef' }] },
    { id: 'rm-guestfile', channelId: 'rc-1', userId: 'guest', guestEmail: 'g@client.example', text: '', at: old, files: [{ name: 'photo.jpg', size: 7, type: 'image/jpeg', url: '/api/files/fedcba9876543210fedcba9876543210' }] },
    { id: 'rm-pinned', channelId: 'rc-1', userId: 'aj-ana', text: 'pinned', at: old, pinned: true },
    { id: 'rm-root', channelId: 'rc-1', userId: 'aj-ana', text: 'thread start', at: old },
    { id: 'rm-reply', channelId: 'rc-1', userId: 'aj-ana', text: 'still going', at: fresh, parentId: 'rm-root' },
    { id: 'rm-new', channelId: 'rc-1', userId: 'aj-ana', text: 'new', at: fresh },
    { id: 'rm-kept', channelId: 'rc-keep', userId: 'aj-ana', text: 'kept project', at: old },
    { id: 'rm-elsewhere', channelId: 'rc-other', userId: 'aj-ana', text: 'another company', at: old },
  ], [], null);
  const told = [];
  const deps = { broadcast: () => {}, notify: (ids, ws, text) => told.push(text?.text ?? text) };
  assert.deepEqual(retention.runRetention(deps, R0 + 6 * DAYMS).filter((r) => r.workspaceId === 'w-ret'), [], 'still in the notice week');
  assert.ok(db.getDoc('messages', 'rm-old'));
  const r = retention.runRetention(deps, R0 + 7 * DAYMS + 60_000).filter((x) => x.workspaceId === 'w-ret');
  assert.deepEqual(r, [{ workspaceId: 'w-ret', deleted: 3, files: 2 }]);
  for (const id of ['rm-old', 'rm-file', 'rm-guestfile']) assert.equal(db.getDoc('messages', id), undefined, `${id} deleted`);
  for (const id of ['rm-pinned', 'rm-root', 'rm-reply', 'rm-new', 'rm-kept', 'rm-elsewhere']) assert.ok(db.getDoc('messages', id), `${id} kept`);
  assert.equal(db.getDoc('drive', 'dv-1').url, '/api/files/0123456789abcdef0123456789abcdef', 'the saved copy can be opened');
  const added = db.allDocs('drive').find((d) => d.url === '/api/files/fedcba9876543210fedcba9876543210');
  assert.equal(added?.kind, 'image');
  assert.equal(added?.uploadedBy, 'g@client.example');
  assert.match(db.auditList(5, 'w-ret')[0].detail, /^3 chat messages older than 90 days/);
  assert.equal(db.getDoc('workspaces', 'w-ret').chat.lastRun.deleted, 3);
  assert.match(told.at(-1), /deleted every day: 3 older than 90 days/);
  assert.deepEqual(retention.runRetention(deps, R0 + 7 * DAYMS + 3600_000).filter((x) => x.workspaceId === 'w-ret'), [], 'once a day');
  const next = retention.runRetention(deps, R0 + 8 * DAYMS + 60_000).filter((x) => x.workspaceId === 'w-ret');
  assert.deepEqual(next, [{ workspaceId: 'w-ret', deleted: 0, files: 0 }], 'every run is logged, even with nothing to delete');
  assert.equal(db.auditList(5, 'w-ret')[0].detail.startsWith('0 chat messages'), true);
});

/* the company's time zone (src/jobTimes.ts, server/summaries.ts, server/digest.ts) */

await test('Time zone: a company’s own, else Jakarta; only zones the clock knows', () => {
  assert.equal(jt.companyTz({ timeZone: 'Europe/Amsterdam' }), 'Europe/Amsterdam');
  assert.equal(jt.companyTz({}), 'Asia/Jakarta', 'companies from before the choice');
  assert.equal(jt.companyTz({ timeZone: 'Mars/Olympus' }), 'Asia/Jakarta');
  assert.equal(jt.isZone('Mars/Olympus'), false);
  assert.equal(jt.isZone('America/Argentina/Buenos_Aires'), true);
});
await test('Summaries: written at 6:00 on the company’s own clock, for its own day', async () => {
  db.writeDocs('workspaces', [{ id: 'w-ams', name: 'Ams', timeZone: 'Europe/Amsterdam', members: [{ userId: 'aj-ana', role: 'owner' }], accounts: [] }], [], null);
  db.writeDocs('channels', [{ id: 'ch-ams', workspaceId: 'w-ams', kind: 'channel', name: 'ams', members: ['aj-ana'], summary: { schedule: 'daily', post: false, history: [] } }], [], null);
  const ams = (day, hour, minute = 0) => jt.zonedTime(day, hour, 'Europe/Amsterdam') + minute * 60_000;
  db.writeDocs('messages', [{ id: 'ams-1', channelId: 'ch-ams', userId: 'aj-ana', text: 'Late on Monday in Amsterdam', at: new Date(ams('2026-10-12', 23)).toISOString() }], [], null);
  const mine = (list) => list.filter((x) => x.channelId === 'ch-ams');
  assert.equal(mine(await summaries.runSummaries(sumDeps(async () => ({ text: 'x' })), at('2026-10-13', 6, 5))).length, 0, '6:05 in Jakarta is still the night before in Amsterdam');
  const r = mine(await summaries.runSummaries(sumDeps(async () => ({ text: 'Monday in Amsterdam.' })), ams('2026-10-13', 6, 5)));
  assert.deepEqual(r.map((x) => [x.key, x.state]), [['daily:2026-10-12', 'done']]);
  assert.deepEqual(sumInputs.filter((i) => i.channel === '#ams').at(-1).messages.map((m) => m.text), ['Late on Monday in Amsterdam'], 'Monday by Amsterdam’s clock (Tuesday in Jakarta)');
});
await test('Digest: someone whose device never said a time zone gets it on their company’s clock', () => {
  db.writeDocs('workspaces', [{ id: 'w-ldn', name: 'Ldn', timeZone: 'Europe/London', members: [{ userId: 'aj-lee', role: 'owner' }], accounts: [] }], [], null);
  assert.equal(digest.digestPrefs('aj-lee').tz, 'Europe/London');
  db.writeDocs('prefs', [{ id: 'aj-lee', value: { 'pm-settings:aj-lee': { timeZone: 'Asia/Tokyo' } } }], [], null);
  assert.equal(digest.digestPrefs('aj-lee').tz, 'Asia/Tokyo', 'their own, once their device says it');
});

/* invoices bill active people (server/billing.ts) */

const billingMod = await import('../server/billing.ts');
await test('Billing: a month bills the people on the team who signed in or used it that month, at least one', () => {
  db.writeDocs('users', [
    { id: 'bp-1', name: 'One', email: 'one@bp.example' },
    { id: 'bp-2', name: 'Two', email: 'two@bp.example' },
    { id: 'bp-3', name: 'Three', email: 'three@bp.example' },
    { id: 'bp-gone', name: 'Gone', email: 'gone@bp.example', deletedAt: '2026-08-01T00:00:00.000Z' },
  ], [], null);
  const ws = { id: 'w-bp', members: ['bp-1', 'bp-2', 'bp-3', 'bp-gone'].map((userId, i) => ({ userId, role: i ? 'member' : 'owner' })) };
  const day = db.db.prepare('INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)');
  for (const [u, d] of [['bp-1', '2026-09-03'], ['bp-1', '2026-09-20'], ['bp-2', '2026-09-30'], ['bp-3', '2026-08-31'], ['bp-3', '2026-10-01'], ['bp-gone', '2026-09-10']]) day.run(u, d);
  assert.deepEqual(billingMod.activePeople(ws, '2026-09'), { active: 2, team: 3, period: '2026-09' }, 'September: One and Two; Three was only around in August and October');
  assert.deepEqual(billingMod.activePeople(ws, '2026-07'), { active: 1, team: 3, period: '2026-07' }, 'nobody around: the plan still bills one');
});

await test('Operator MRR: counts the people active this month, the same rule as the invoice', async () => {
  const adminMod = await import('../server/admin.ts');
  const ws = { id: 'w-mrr', name: 'MRR', members: ['bp-1', 'bp-2', 'bp-3'].map((userId, i) => ({ userId, role: i ? 'member' : 'owner' })), plan: { track: 'own', tier: 'small', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: 'MRR', emails: [] } } };
  const month = new Date().toISOString().slice(0, 7);
  db.db.prepare('DELETE FROM activity_days WHERE user_id IN (?, ?, ?) AND day >= ?').run('bp-1', 'bp-2', 'bp-3', `${month}-01`);
  const day = db.db.prepare('INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)');
  day.run('bp-1', `${month}-01`);
  day.run('bp-2', `${month}-01`);
  const m = adminMod.mrrNow(ws);
  assert.equal(m.state, 'paying');
  assert.equal(m.mrr, adminMod.mrrOf(ws, 2).mrr, 'two of the three were active this month');
  assert.ok(m.mrr < adminMod.mrrOf(ws, 3).mrr, 'the third, not around this month, isn’t counted');
  assert.equal(billingMod.activePeople(ws).active, 2, 'the invoice counts the same two');
});

/* plan switches, prorated (src/data/pricing.ts, server/billing.ts) */

const pricing = await import('../src/data/pricing.ts');
const platformMod = await import('../server/platform.ts');
const P = (tier, extra = {}) => ({ track: 'own', tier, cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: 'X', emails: [] }, since: '2026-01-01T00:00:00.000Z', ...extra });
const OCT9 = new Date('2026-10-09T03:00:00Z'); // 8 days of October behind, 23 (the 9th included) ahead
const OCT20 = new Date('2026-10-20T03:00:00Z');
const studio = pricing.priceFor('own', 'studio', 3);
const agency = pricing.priceFor('own', 'agency', 3);
const business = pricing.priceFor('own', 'business', 3);
await test('Plan switch: an upgrade charges the difference for the rest of the month, on the next invoice', () => {
  const a = pricing.prorate(P('studio'), P('agency'), 3, OCT9, true);
  assert.equal(a.amount, Math.round(((agency - studio) * 23) / 31));
  assert.ok(a.amount > 0, 'a charge');
  assert.deepEqual([a.period, a.daysBefore, a.days, a.from, a.to], ['2026-10', 8, 31, 'Studio', 'Agency']);
  assert.equal(a.text, 'Agency instead of Studio from 9 October: the rest of October (23 of 31 days)');
  assert.ok(!/—/.test(a.text), 'no em dashes');
});
await test('Plan switch: a downgrade is a credit for the rest of the month', () => {
  const a = pricing.prorate(P('agency'), P('studio'), 3, OCT9, true);
  assert.equal(a.amount, -Math.round(((agency - studio) * 23) / 31));
  // Before this month's invoice was made: it bills the new plan in full, so the days before are put right instead.
  const b = pricing.prorate(P('agency'), P('studio'), 3, OCT9, false);
  assert.equal(b.amount, Math.round(((agency - studio) * 8) / 31), 'a charge for the 8 days on Agency, since October’s invoice bills Studio');
  assert.equal(b.text, 'Agency instead of Studio until 8 October (8 of 31 days)');
});
await test('Plan switch: two switches on the same day are one line, from the first plan to the last', () => {
  const one = pricing.prorate(P('studio'), P('agency'), 3, OCT9, true);
  const two = pricing.prorate(P('agency'), P('business'), 3, OCT9, true);
  const list = pricing.addAdjustment(pricing.addAdjustment(undefined, one, 'a1'), two, 'a2');
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, one.amount + two.amount);
  assert.ok(Math.abs(list[0].amount - ((business - studio) * 23) / 31) <= 1, 'the same as one switch from Studio to Business');
  assert.equal(list[0].text, 'Business instead of Studio from 9 October: the rest of October (23 of 31 days)');
});
await test('Plan switch: switching back the same day leaves nothing; switching back later bills the days on the other plan', () => {
  const there = pricing.prorate(P('studio'), P('agency'), 3, OCT9, true);
  const back = pricing.prorate(P('agency'), P('studio'), 3, OCT9, true);
  assert.equal(pricing.addAdjustment(pricing.addAdjustment(undefined, there, 'a1'), back, 'a2'), undefined, 'nothing on the invoice');
  const later = pricing.prorate(P('agency'), P('studio'), 3, OCT20, true);
  const list = pricing.addAdjustment(pricing.addAdjustment(undefined, there, 'a1'), later, 'a2');
  assert.equal(list.length, 1);
  assert.ok(Math.abs(list[0].amount - ((agency - studio) * 11) / 31) <= 1, 'Agency for 9 to 19 October: 11 days');
  assert.equal(list[0].text, 'Agency from 9 October to 19 October, then back to Studio');
});
await test('Plan switch: nothing is prorated during a trial or free months, to or from Free, or when the cycle changes', () => {
  assert.equal(pricing.prorate(P('studio', { trialEnds: '2026-10-20T00:00:00.000Z' }), P('agency'), 3, OCT9), null);
  assert.equal(pricing.prorate(P('studio', { comp: { until: '2026-12-01T00:00:00.000Z' } }), P('agency'), 3, OCT9), null);
  assert.equal(pricing.prorate(P('free'), P('studio'), 3, OCT9), null);
  assert.equal(pricing.prorate(P('studio'), P('free'), 3, OCT9), null);
  assert.equal(pricing.prorate(P('studio'), P('studio', { cycle: 'yearly' }), 3, OCT9), null);
});
await test('Plan switch: the server records it on the plan and the next invoice has the line; a credit bigger than the invoice carries over', async () => {
  const adminMod = await import('../server/admin.ts');
  const ws = { id: 'w-pro', name: 'Pro', members: [{ userId: 'bp-1', role: 'owner' }], plan: P('studio') };
  db.writeDocs('workspaces', [ws], [], null);
  const at = new Date();
  const list = billingMod.adjustmentsOnSave(ws, ws.plan, P('agency'), at);
  assert.equal(list.length, 1);
  assert.equal(list[0].invoiced, false, 'this month’s invoice isn’t made yet: it bills Agency, and the days on Studio are put right');
  assert.ok(list[0].amount <= 0);
  const withSwitch = { ...ws, plan: { ...P('agency'), adjustments: list } };
  const lines = adminMod.invoiceLinesFor(withSwitch, at.toISOString().slice(0, 7)).lines;
  assert.ok(lines.some((l) => l.text === list[0].text && l.amount === list[0].amount) || list[0].amount === 0, 'the line is on the invoice');
  // Once this month's invoice exists, a switch charges the rest of the month instead.
  platformMod.createInvoice({ workspaceId: 'w-pro', period: at.toISOString().slice(0, 7), lines: [{ text: 'Studio plan', amount: studio }], discount: 0, dueDays: 14, billTo: { company: 'Pro', emails: [] }, by: 'test' });
  const after = billingMod.adjustmentsOnSave(ws, ws.plan, P('agency'), at);
  assert.equal(after.find((a) => a.invoiced)?.amount > 0, true);
  // A credit bigger than the whole invoice brings it to zero, and the rest waits for the next one.
  const big = { ...ws, plan: { ...P('small'), adjustments: [{ id: 'x', at: at.toISOString(), period: '2026-10', invoiced: true, from: 'Business', to: 'Small', daysBefore: 8, days: 31, amount: -5_000_000, text: 'Small instead of Business from 9 October' }] } };
  const r = adminMod.invoiceLinesFor(big, '2026-11');
  assert.equal(r.lines.reduce((n, l) => n + l.amount, 0), 0, 'the invoice comes to zero');
  assert.ok(r.carry < 0 && r.carry > -5_000_000, 'the rest of the credit is carried');
});

await test('Trials: one per person and per company domain; an operator can allow one more', async () => {
  await import('../server/domains.ts'); // the proven-domain table
  const trialPlanOf = () => ({ ...P('studio'), track: 'ai', trialEnds: new Date(Date.now() + 14 * 86_400_000).toISOString() });
  const first = billingMod.trialOnCreate(trialPlanOf(), { id: 'tr-ana', email: 'ana@trial-co.example' }, { id: 'w-tr1', name: 'Trial One' });
  assert.ok(first.plan.trialEnds && !first.why, 'the first company gets the trial');
  const again = billingMod.trialOnCreate(trialPlanOf(), { id: 'tr-ana', email: 'ana@trial-co.example' }, { id: 'w-tr2', name: 'Trial Two' });
  assert.equal(again.plan.tier, 'free');
  assert.equal(again.plan.trialEnds, undefined);
  assert.match(again.why, /^You’ve already had a free trial, with Trial One from \d+ \w+ \d{4}\. Pick a plan any time, or ask us about another trial in Settings, Help\.$/);
  assert.equal(again.plan.trialRefused, again.why, 'the billing page can say why');
  // Another login at the same company domain: no second trial either.
  const colleague = billingMod.trialCheck('tr-bo', 'bo@trial-co.example');
  assert.equal(colleague.ok, false);
  assert.match(colleague.why, /^trial-co\.example already had a free trial, with Trial One/);
  // A shared mail service says nothing about the company: someone else at gmail.com still gets theirs.
  billingMod.trialOnCreate(trialPlanOf(), { id: 'tr-gm1', email: 'one@gmail.com' }, { id: 'w-tr3', name: 'Gmail One' });
  assert.equal(billingMod.trialCheck('tr-gm2', 'two@gmail.com').ok, true);
  // A domain another company with a trial has proven in its DNS counts too.
  db.db.prepare("INSERT OR REPLACE INTO mail_domains (domain, workspace_id, selector, private_key, public_key, created_at, verified_at, verified_how) VALUES ('proven-co.example', 'w-tr1', 's2g', 'x', 'y', ?, ?, 'txt')").run(new Date().toISOString(), new Date().toISOString());
  assert.match(billingMod.trialCheck('tr-new', 'new@gmail.com', ['proven-co.example']).why, /proven-co\.example belongs to Trial One, which already had a free trial/);
  // An operator allows one more: the next company gets it, and the allowance is used up.
  billingMod.grantTrial('tr-ana', 'ops@example.com');
  assert.ok(billingMod.trialOnCreate(trialPlanOf(), { id: 'tr-ana', email: 'ana@trial-co.example' }, { id: 'w-tr4', name: 'Trial Four' }).plan.trialEnds);
  assert.equal(billingMod.trialCheck('tr-ana', 'ana@trial-co.example').ok, false);
  assert.deepEqual(billingMod.trialsOf('tr-ana').trials.map((t) => [t.company, t.how]), [['Trial One', 'self'], ['Trial Four', 'granted']]);
  // A plan without a trial (Free, or a paid plan) is left as it is.
  assert.equal(billingMod.trialOnCreate(P('free'), { id: 'tr-ana', email: 'ana@trial-co.example' }, { id: 'w-tr5', name: 'X' }).why, undefined);
});

await test('BIMI: a logo passes only with the SVG Tiny PS basics, and the record points at its stable address', async () => {
  const bimi = await import('../server/bimi.ts');
  const good = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"><title>Pixel and Profits</title><rect width="100" height="100" fill="#5b5bf6"/><path d="M20 20h60v60H20z" fill="url(#g)"/></svg>';
  assert.deepEqual(bimi.svgProblems(good), []);
  const has = (svg, re) => bimi.svgProblems(svg).some((p) => re.test(p));
  assert.ok(has(good.replace(' baseProfile="tiny-ps"', ''), /baseProfile="tiny-ps"/), 'the profile');
  assert.ok(has(good.replace('version="1.2"', 'version="1.1"'), /version="1\.2"/), 'the version');
  assert.ok(has(good.replace('0 0 100 100', '0 0 120 80'), /isn’t square: its viewBox is 120 by 80/), 'square');
  assert.ok(has(good.replace('<title>Pixel and Profits</title>', ''), /<title>/), 'a title');
  assert.ok(has(good.replace('<rect', '<script>alert(1)</script><rect'), /script/), 'no scripts');
  assert.ok(has(good.replace('<rect', '<rect onclick="x()"'), /event handlers/), 'no handlers');
  assert.ok(has(good.replace('<rect', '<image href="https://evil.example/x.png"/><rect'), /embedded picture/), 'no pictures');
  assert.ok(has(good.replace('url(#g)', 'url(https://evil.example/f.svg#g)'), /outside the file/), 'no outside references');
  assert.ok(has(good.replace('<rect', '<use xlink:href="other.svg#a"/><rect'), /outside the file/), 'no outside use');
  assert.ok(has(good.replace('<rect', '<animate attributeName="x"/><rect'), /animated/), 'still');
  assert.ok(has('<!DOCTYPE svg [<!ENTITY x "y">]>' + good.replace('<?xml version="1.0" encoding="UTF-8"?>', ''), /DOCTYPE/), 'no entities');
  assert.ok(has(good.replace('<svg ', '<svg x="0" '), /x or y/), 'no x or y on the root');
  assert.ok(has(good + ' '.repeat(33 * 1024), /32 KB/), 'small');
  assert.deepEqual(bimi.svgProblems('<html></html>'), ['It isn’t an SVG file: it should start with an <svg> element.']);
  const url = bimi.logoUrl('https://app.sprint2go.com', 'pnp');
  assert.equal(url, 'https://app.sprint2go.com/bimi/pnp.svg');
  assert.equal(bimi.bimiRecord(url), 'v=BIMI1; l=https://app.sprint2go.com/bimi/pnp.svg; a=;');
});

await test('Task stages: a task follows its project’s own stages, else its team’s, else the company’s; moving maps it', async () => {
  const st = await import('../src/stages.ts');
  const company = [{ id: 'todo', kind: 'open' }, { id: 'doing', kind: 'active' }, { id: 'done', kind: 'done' }];
  const proj = [{ id: 'todo', kind: 'open' }, { id: 'st-design', kind: 'active', name: 'Design' }, { id: 'st-build', kind: 'active', name: 'Build' }, { id: 'st-shipped', kind: 'done', name: 'Shipped' }];
  const team = [{ id: 'st-queue', kind: 'open', name: 'Queue' }, { id: 'st-edit', kind: 'active', name: 'Design' }, { id: 'done', kind: 'done' }];
  st.registerStages([{ id: 'w-st', taskStages: company }], 'w-st', { clients: [{ id: 'c-own', taskStages: proj }, { id: 'c-plain' }], teams: [{ id: 't-own', taskStages: team }] });
  const t = (x) => ({ workspaceId: 'w-st', done: false, ...x });
  assert.equal(st.stagesForTask(t({ clientId: 'c-own', teamId: 't-own' })), st.projectStages('c-own'), 'the project’s own first');
  assert.deepEqual(st.stagesForTask(t({ clientId: 'c-plain', teamId: 't-own' })).map((x) => x.id), ['st-queue', 'st-edit', 'done'], 'then the team’s own');
  assert.deepEqual(st.stagesForTask(t({ clientId: 'c-plain' })).map((x) => x.id), ['todo', 'doing', 'done'], 'then the company’s');
  // Ticking and starting use the task's own stages.
  assert.equal(st.stageIdFor(t({ clientId: 'c-own' }), 'done'), 'st-shipped');
  assert.equal(st.stageIdFor(t({ clientId: 'c-own' }), 'active'), 'st-design');
  assert.equal(st.kindOf(t({ clientId: 'c-own', status: 'st-build' })), 'active');
  // On a board of the company's columns (My tasks), a task of other stages sits in the column of its kind; dropped on
  // a column, it goes to its own first stage of that kind.
  assert.equal(st.columnOf(t({ clientId: 'c-own', status: 'st-build' }), company).id, 'doing');
  assert.equal(st.ownStageForColumn(t({ clientId: 'c-own' }), company[2]).id, 'st-shipped');
  // Moving to another project or team: the stage of the same name, else the first one (a finished task stays finished).
  const moved = st.stageAfterMove(t({ clientId: 'c-own', status: 'st-design' }), t({ clientId: 'c-plain', teamId: 't-own' }));
  assert.deepEqual([moved.stage.id, moved.kept], ['st-edit', true], 'Design is Design there too');
  const firstOne = st.stageAfterMove(t({ clientId: 'c-own', status: 'st-build' }), t({ clientId: 'c-plain' }));
  assert.deepEqual([firstOne.stage.id, firstOne.kept, firstOne.from.id], ['todo', false, 'st-build'], 'no Build there: the first stage');
  const finished = st.stageAfterMove(t({ clientId: 'c-own', status: 'st-shipped', done: true }), t({ clientId: 'c-plain' }));
  assert.equal(finished.stage.id, 'done', 'a finished task stays finished');
  assert.equal(st.stageAfterMove(t({ clientId: 'c-plain' }), t({ clientId: undefined })), null, 'the same stages: nothing to map');
  // The server reads them from the documents (no registry).
  assert.deepEqual(st.stagesFrom({ client: { taskStages: proj }, team: { taskStages: team }, workspace: { taskStages: company } }).map((x) => x.id), proj.map((x) => x.id));
  assert.deepEqual(st.stagesFrom({ client: { taskStages: [{ id: 'x', kind: 'active' }] }, workspace: { taskStages: company } }).map((x) => x.id), ['todo', 'doing', 'done'], 'an unusable own list (no open or done stage) follows the company');
  st.registerStages([], undefined, { clients: [], teams: [] });
  assert.equal(st.projectStages('c-own'), null, 'a project that stopped having its own stages follows the company again');
});

/* read tracking: reminders and Outlook.com's picture proxy (server/readTracking.ts) */

const readTracking = await import('../server/readTracking.ts');
await test('Read tracking: Outlook.com’s picture proxy shows as “via Outlook”; desktop Outlook stays a device', () => {
  assert.deepEqual(readTracking.readAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246 Mozilla/5.0'), { device: '', via: 'outlook' });
  assert.deepEqual(readTracking.readAgent('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)'), { device: '', via: 'gmail' });
  assert.deepEqual(readTracking.readAgent('Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.4266; Pro)'), { device: 'Windows PC · Outlook' });
  assert.equal(readTracking.readAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0').via, undefined, 'a real Edge isn’t the proxy');
});
await test('Read tracking: “Remind me if no reply” tells the sender once, only when nobody wrote back', () => {
  db.writeDocs('workspaces', [{ id: 'w-rr', name: 'RR', domains: ['rr.example'], members: [{ userId: 'aj-ana', role: 'owner' }, { userId: 'aj-mo', role: 'member' }], accounts: [{ id: 'rr-box', email: 'ana@rr.example', name: 'Ana', kind: 'personal', users: ['aj-ana'] }] }], [], null);
  const sent = (id, extra = [], location = 'archive') => ({ id, accountId: 'rr-box', subject: 'Proposal', location, messages: [{ id: 'out', from: { name: 'Ana', email: 'ana@rr.example' }, to: [{ name: 'Budi', email: 'budi@client.example' }], date: new Date().toISOString(), body: 'Here it is' }, ...extra] });
  db.writeDocs('threads', [
    sent('rr-quiet'),
    sent('rr-answered', [{ id: 'in', from: { name: 'Budi', email: 'budi@client.example' }, to: [], date: new Date().toISOString(), body: 'Thanks' }]),
    sent('rr-colleague', [{ id: 'mo', from: { name: 'Mo', email: 'mo@rr.example' }, to: [], date: new Date().toISOString(), body: 'Nudged him' }]),
    sent('rr-trashed', [], 'trash'),
  ], [], null);
  for (const id of ['rr-quiet', 'rr-answered', 'rr-colleague', 'rr-trashed', 'rr-gone']) readTracking.planReminder({ workspaceId: 'w-rr', accountId: 'rr-box', threadId: id, messageId: 'out', by: 'aj-ana', days: 3 });
  readTracking.planReminder({ workspaceId: 'w-rr', accountId: 'rr-box', threadId: 'rr-quiet', messageId: 'never', by: 'aj-ana', days: 0 });
  readTracking.planReminder({ workspaceId: 'w-rr', accountId: 'rr-box', threadId: 'rr-quiet', messageId: 'too-long', by: 'aj-ana', days: 90 });
  const t0 = Date.now();
  assert.equal(readTracking.runReplyReminders(t0 + 2 * DAYMS).length, 0, 'not before its day');
  const told = readTracking.runReplyReminders(t0 + 3 * DAYMS + 60_000);
  assert.deepEqual(told.map((n) => n.link.id).sort(), ['rr-colleague', 'rr-quiet'], 'a teammate writing isn’t a reply; an answer, the trash or a deleted conversation means none');
  const n = told.find((x) => x.link.id === 'rr-quiet');
  assert.equal(n.userId, 'aj-ana');
  assert.equal(n.kind, 'mail');
  assert.equal(n.text, 'No reply yet from Budi to “Proposal”. Time to follow up?');
  assert.ok(db.getDoc('notices', n.id), 'saved for the bell (and push, like any notice)');
  assert.equal(readTracking.runReplyReminders(t0 + 4 * DAYMS).length, 0, 'once');
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM mail_remind WHERE message_id IN ('never', 'too-long')").get().n, 0, 'off, or longer than a month: nothing planned');
});

/* ---------- the models a key can use (server/models.ts, src/data/aiModels.ts) ---------- */

const mdl = await import('../server/models.ts');
const am = await import('../src/data/aiModels.ts');
const cat = await import('../src/data/aiCatalog.ts');
const ids = (list) => list.models.map((m) => m.id);
await test('Model lists: OpenAI’s shape (SumoPod, Groq, Mistral, a company’s own server) keeps chat models, catalogue ones first', () => {
  const raw = mdl.parseOpenAIList({
    object: 'list',
    data: [
      { id: 'kimi-k2-0905', object: 'model', owned_by: 'moonshot' },
      { id: 'text-embedding-3-small', object: 'model' },
      { id: 'claude-opus-5-5', object: 'model', owned_by: 'anthropic' },
      { id: 'gemini/gemini-3.5-flash', object: 'model' },
      { id: 'whisper-large-v3', object: 'model' },
      { id: 'mistral-embed', capabilities: { completion_chat: false } },
      { id: 'llama-retired', active: false },
      { id: 'tts-1' },
      { id: 'dall-e-3' },
      { id: 'glm-4.6' },
      { id: 'kimi-k2-0905' },
    ],
  });
  const list = am.mergeModels('sumopod', raw);
  assert.equal(list.source, 'live');
  assert.deepEqual(ids(list).slice(0, 2), ['claude-opus-5-5', 'gemini/gemini-3.5-flash'], 'catalogue models first, in the catalogue’s order');
  const opus = list.models[0];
  assert.deepEqual([opus.name, opus.tier, opus.price, opus.recommended], ['Claude Opus 5.5', 'best', [4, 20], true], 'they keep their friendly name, tier and price');
  const kimi = list.models.find((m) => m.id === 'kimi-k2-0905');
  assert.deepEqual([kimi.name, kimi.price, kimi.recommended, kimi.family], ['Kimi K2 0905', null, false, 'Kimi'], 'the rest: a name from the id, price unknown');
  assert.ok(!ids(list).some((id) => /embed|tts|dall-e|retired/.test(id)), 'no embeddings, speech output, images or retired models');
  assert.equal(list.models.find((m) => m.id === 'whisper-large-v3')?.kind, 'speech', 'speech to text is kept for the speech job only');
  assert.equal(ids(list).filter((x) => x === 'kimi-k2-0905').length, 1, 'once each');
  assert.throws(() => mdl.parseOpenAIList({ error: { message: 'nope' } }), 'not a list is an error, not an empty list');
});
await test('Model lists: OpenRouter’s names and per-token prices (per million here); image makers dropped', () => {
  const raw = mdl.parseOpenAIList({
    data: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
      { id: 'qwen/qwen3-coder', name: 'Qwen: Qwen3 Coder', pricing: { prompt: '0.00000022', completion: '0.00000095' }, architecture: { output_modalities: ['text'] } },
      { id: 'google/gemini-3-pro-image', name: 'Google: Nano Banana', pricing: { prompt: '0.000002', completion: '0.00012' }, architecture: { output_modalities: ['image', 'text'] } },
    ],
  });
  const list = am.mergeModels('openrouter', raw);
  assert.deepEqual(ids(list), ['anthropic/claude-sonnet-5.5', 'qwen/qwen3-coder']);
  const q = list.models[1];
  assert.equal(q.name, 'Qwen3 Coder', 'the company prefix comes off the name');
  assert.deepEqual(q.price, [0.22, 0.95]);
});
await test('Model lists: Anthropic (pages) and Gemini (only models that generateContent)', () => {
  const a = mdl.parseAnthropicList({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { type: 'model', id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }], has_more: true, last_id: 'claude-sonnet-4-5-20250929' });
  assert.equal(a.next, 'claude-sonnet-4-5-20250929', 'the next page starts after the last id');
  const al = am.mergeModels('anthropic', a.models);
  assert.deepEqual(al.models.map((m) => m.name), ['Claude Opus 5.5', 'Claude Sonnet 4.5']);
  const g = mdl.parseGeminiList({
    models: [
      { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'Gemini 2.5 Flash TTS', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemma-3-27b-it', displayName: 'Gemma 3 27B', supportedGenerationMethods: ['generateContent'] },
    ],
    nextPageToken: '',
  });
  assert.equal(g.next, null);
  const gl = am.mergeModels('google', g.models);
  assert.deepEqual(ids(gl), ['gemini-3.5-flash', 'gemma-3-27b-it'], 'no embeddings, no speech output; "models/" comes off');
  assert.equal(gl.models[0].recommended, true);
});
await test('Model lists: Bedrock keeps Anthropic’s text models that are still offered', () => {
  const raw = mdl.parseBedrockList({
    modelSummaries: [
      { modelId: 'anthropic.claude-sonnet-5-5', modelName: 'Claude Sonnet 5.5', providerName: 'Anthropic', outputModalities: ['TEXT'], modelLifecycle: { status: 'ACTIVE' } },
      { modelId: 'anthropic.claude-v2', modelName: 'Claude', providerName: 'Anthropic', outputModalities: ['TEXT'], modelLifecycle: { status: 'LEGACY' } },
      { modelId: 'amazon.titan-embed-text-v2:0', modelName: 'Titan Embeddings', providerName: 'Amazon', outputModalities: ['EMBEDDING'] },
      { modelId: 'meta.llama4-maverick-17b-instruct-v1:0', modelName: 'Llama 4 Maverick', providerName: 'Meta', outputModalities: ['TEXT'] },
    ],
  });
  assert.deepEqual(raw.map((m) => m.id), ['anthropic.claude-sonnet-5-5']);
  assert.equal(am.mergeModels('bedrock', raw).models[0].name, 'Claude Sonnet 5.5 on Bedrock', 'the catalogue’s name');
});
await test('Model lists: an empty list falls back to our catalogue; readable names from ids', () => {
  const empty = am.mergeModels('sumopod', [{ id: 'text-embedding-3-large' }]);
  assert.equal(empty.source, 'catalog');
  assert.ok(empty.note && empty.models.length > 3);
  assert.equal(am.prettyModelName('claude-sonnet-4-5-20250929'), 'Claude Sonnet 4.5');
  assert.equal(am.prettyModelName('gpt-4o-mini'), 'GPT-4o mini');
  assert.equal(am.prettyModelName('meta-llama/llama-3.3-70b-instruct'), 'Llama 3.3 70B Instruct');
  assert.equal(am.prettyModelName('anthropic.claude-haiku-4-5-20251001-v1:0'), 'Claude Haiku 4.5');
  assert.ok(am.MODEL_ID.test('gemini/gemini-3.1-pro-preview') && am.MODEL_ID.test('anthropic.claude-v2:1') && !am.MODEL_ID.test('a b') && !am.MODEL_ID.test('https://x/y?z'));
});
await test('Model lists: a new key is tested with a small model it really offers', () => {
  const live = am.mergeModels('custom', [{ id: 'llama3.1:70b' }, { id: 'qwen2.5:7b' }]);
  assert.equal(mdl.testModelFor('custom', live), 'qwen2.5:7b', 'not the placeholder "custom", a small one from the list');
  assert.equal(mdl.testModelFor('sumopod', am.mergeModels('sumopod', [{ id: 'deepseek-v4-flash' }, { id: 'claude-opus-5-5' }])), 'deepseek-v4-flash', 'the catalogue’s fast one when offered');
  assert.equal(mdl.testModelFor('anthropic', null), 'claude-haiku-4-5', 'no list: the catalogue’s fast one');
});
await test('Presets never pick a catalogue model the provider doesn’t offer', () => {
  const { presetJobs } = cat;
  const sumo = ['deepseek-v4-flash', 'kimi-k2-0905'];
  const jobs = presetJobs('balanced', ['sumopod'], false, { live: { sumopod: sumo }, defaults: { sumopod: 'kimi-k2-0905' } });
  for (const [job, pick] of Object.entries(jobs)) if (job !== 'speech') assert.ok(sumo.includes(pick.model), `${job} got ${pick.model}`);
  assert.equal(jobs.braindump.model, 'kimi-k2-0905', 'nothing of that tier offered: the key’s own model');
  assert.equal(presetJobs('cheap', ['sumopod'], false, { live: { sumopod: sumo } }).replies.model, 'deepseek-v4-flash', 'a catalogue model it offers, where it fits');
  assert.equal(presetJobs('balanced', ['sumopod'], false).braindump.model, 'claude-sonnet-5', 'without a list, the catalogue as before');
});
await test('A model the provider dropped: its jobs move to the job’s fallback, with a note for Settings', () => {
  const ai = {
    preset: 'custom',
    providers: [
      { id: 'sumopod', status: 'ok', model: 'kimi-k2-0905' },
      { id: 'anthropic', status: 'ok', model: 'claude-sonnet-5-5' },
    ],
    jobs: {
      summary: { provider: 'sumopod', model: 'glm-4.6' },
      replies: { provider: 'sumopod', model: 'glm-4.6' },
      ask: { provider: 'sumopod', model: 'glm-4.6', fallback: 'anthropic' },
      draft: { provider: 'sumopod', model: 'my-own-finetune', typed: true },
      todos: { provider: 'sumopod', model: 'kimi-k2-0905' },
      speech: { provider: 'custom', model: 'browser' },
    },
    blocked: [],
  };
  const list = am.mergeModels('sumopod', [{ id: 'kimi-k2-0905' }, { id: 'deepseek-v4-flash' }]);
  const next = mdl.movesFor(ai, 'sumopod', list, '2026-10-09T08:00:00.000Z');
  assert.deepEqual(next.jobs.summary, { provider: 'sumopod', model: 'kimi-k2-0905' }, 'to the key’s own model');
  assert.deepEqual(next.jobs.ask, { provider: 'anthropic', model: 'claude-sonnet-5-5', fallback: 'anthropic' }, 'to its fallback provider when it has one');
  assert.deepEqual(next.jobs.draft, ai.jobs.draft, 'a model id typed in by hand isn’t on lists, so it stays');
  assert.deepEqual(next.jobs.todos, ai.jobs.todos, 'models still offered stay');
  assert.deepEqual(next.notes.map((n) => n.text), ['SumoPod no longer offers GLM 4.6; Ask AI moved to Claude Sonnet 5.5 on Anthropic.', 'SumoPod no longer offers GLM 4.6; summaries & catch me up and suggest replies moved to Kimi K2 0905.']);
  assert.equal(mdl.movesFor(next, 'sumopod', list), null, 'nothing more to move');
  assert.equal(mdl.movesFor(ai, 'sumopod', am.catalogList('sumopod')), null, 'our catalogue never moves anything');
  // The key's own model gone too: a recommended one of the same tier takes its place.
  const both = mdl.movesFor({ ...ai, jobs: { summary: { provider: 'sumopod', model: 'glm-4.6' } } }, 'sumopod', am.mergeModels('sumopod', [{ id: 'deepseek-v4-flash' }, { id: 'claude-opus-5-5' }]));
  assert.equal(both.providers[0].model, 'claude-opus-5-5');
  assert.deepEqual(both.jobs.summary, { provider: 'sumopod', model: 'claude-opus-5-5' });
});

await test('Our AI: until operators pick, each job uses the recommended model on the keys we have', async () => {
  const plan = await import('../server/aiplan.ts');
  const had = db.db.prepare("SELECT provider FROM platform_ai_keys").all().map((r) => r.provider);
  db.db.prepare('DELETE FROM platform_ai_keys').run();
  try {
    const none = plan.config().jobs;
    assert.equal(none.ask.primary.provider, 'anthropic', 'no key at all: the plain recommendation');
    db.db.prepare('INSERT INTO platform_ai_keys (provider, sealed, base_url, last4, enabled, added_by, added_at) VALUES (?, ?, NULL, ?, 1, NULL, ?)').run('sumopod', db.seal('sk-unit-test-0000'), '0000', new Date().toISOString());
    const jobs = plan.config().jobs;
    for (const [id, r] of Object.entries(jobs)) assert.equal(r.primary.provider, 'sumopod', `${id} runs on the only key we have`);
    assert.match(jobs.ask.primary.model, /claude-sonnet/, 'a heavy job keeps its Claude Sonnet family on SumoPod');
    assert.ok(jobs.ask.fallback && jobs.ask.fallback.model !== jobs.ask.primary.model, 'with a different model as the fallback');
    assert.match(jobs.speech.primary.model, /gemini/, 'speech uses SumoPod’s audio model');
  } finally {
    db.db.prepare("DELETE FROM platform_ai_keys WHERE provider = 'sumopod' AND last4 = '0000'").run();
    void had;
  }
});

/* ---------- the demo company (src/sandbox.ts, server/sandbox.ts) ---------- */

const sbx = await import('../src/sandbox.ts');
const { seed } = await import('../src/seed.ts');
await test('Demo company: a copy of the sample company, every id in the person’s own space, the person in the owner’s seat', () => {
  const built = sbx.buildSandbox(seed(), { id: 'u-maria', name: 'María José' }, '2026-10-09T08:00:00.000Z');
  const ws = built.workspaces[0];
  assert.equal(ws.id, 'demo-u-maria');
  assert.deepEqual(ws.sandbox, { owner: 'u-maria', createdAt: '2026-10-09T08:00:00.000Z', tried: [] });
  assert.deepEqual(ws.members[0], { userId: 'u-maria', role: 'owner' }, 'the person owns it');
  assert.ok(ws.members.length > 1 && ws.members.slice(1).every((m) => m.userId.startsWith('demo-u-maria-')), 'the teammates are the demo’s own people');
  const json = JSON.stringify(built);
  assert.ok(!/"u-aqeel"|"pnp"|"elk"/.test(json), 'nothing points at the demo’s own ids any more');
  for (const [coll, docs] of Object.entries(built)) for (const d of docs) if (coll !== 'workspaces') assert.ok(d.id.startsWith('demo-u-maria-') || coll === 'calendars', `${coll} ${d.id} is in their space`);
  assert.ok(built.threads.length && built.threads.every((t) => ws.accounts.some((a) => a.id === t.accountId)), 'mail only in its own mailboxes');
  assert.ok(built.messages.every((m) => built.channels.some((c) => c.id === m.channelId)), 'chat only in its own channels');
  assert.ok(built.todos.every((t) => t.workspaceId === ws.id) && built.events.every((e) => e.workspaceId === ws.id), 'tasks and events say whose they are');
  assert.ok(!built.clients.some((c) => /Kopi Harian|Supplements/.test(c.name)), 'the other company stays out');
  assert.ok(!built.calendars.some((c) => c.source === 'google'), 'no pretend Google account in their name');
  assert.ok(built.calendars.some((c) => c.id === 'hol-demo-u-maria'), 'the holiday calendar has the name the app looks for');
  assert.ok(!/Aqeel/.test(json) && /Hi María,/.test(json) && /maria@pixelandprofits\.com/.test(json), 'the seat’s name and address are theirs');
  assert.ok(built.users.every((u) => u.id.startsWith('demo-u-maria-')) && !built.users.some((u) => u.id === 'u-maria'), 'their own profile stays their real one');
});
await test('Demo company: ids that start with demo- are the demo’s, whatever the company', () => {
  assert.equal(sbx.isSandboxId('demo-u-1'), true);
  assert.equal(sbx.isSandboxId('pnp'), false);
  assert.equal(sbx.isSandbox({ id: 'pnp' }), false);
  assert.equal(sbx.isSandbox({ id: 'demo-u-1' }), true);
});

const sandbox = await import('../server/sandbox.ts');
await test('Demo company: made fresh in the person’s time zone (this week’s standup at 9:30 their time)', async () => {
  await sandbox.make('u-unit', { name: 'Unit Tester' }, 'Asia/Jakarta');
  const docs = sandbox.docsOf('u-unit');
  const standup = docs.events.find((e) => e.title === 'Daily standup');
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(standup.start));
  assert.equal(local, '09:30');
  const week = (d) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return Math.floor((x.getTime() - Date.UTC(2026, 0, 5)) / (7 * 86_400_000));
  };
  assert.ok(docs.events.some((e) => e.title === 'Daily standup' && Math.abs(week(e.start) - week(Date.now())) <= 1), 'in this week (or the next)');
  const recent = docs.threads.flatMap((t) => t.messages).map((m) => Date.parse(m.date)).sort((a, b) => b - a)[0];
  assert.ok(Date.now() - recent < 60 * 60_000, 'the newest email arrived within the hour');
  assert.equal(db.allDocs('workspaces').filter((w) => String(w.id).startsWith('demo-')).length, 0, 'nothing of it is a real document');
  assert.equal(sandbox.info('u-unit').hidden, false);
  // Someone on the other side of the world gets their own 9:30.
  await sandbox.make('u-unit-ny', { name: 'New York' }, 'America/New_York');
  const ny = sandbox.docsOf('u-unit-ny').events.find((e) => e.title === 'Daily standup');
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ny.start)), '09:30');
  sandbox.remove('u-unit-ny');
});
await test('Demo company: the owner changes anything in it; nothing moves out, nobody new comes in, and it stays small', () => {
  const ws = sandbox.getDoc('u-unit', 'workspaces', 'demo-u-unit');
  const task = { id: 'unit-task', title: 'Mine', workspaceId: 'demo-u-unit' };
  assert.equal(sandbox.belongs('u-unit', 'todos', task, false), true, 'a new task in it belongs in it');
  assert.equal(sandbox.belongs('u-other', 'todos', task, false), false, 'never in someone else’s');
  assert.equal(sandbox.belongs('u-unit', 'todos', { id: 'x', workspaceId: 'w-real' }, false), false, 'a real company’s stays real');
  assert.equal(sandbox.belongs('u-unit', 'todos', { ...task, id: 'real-one' }, true), false, 'an id a real document has stays real');
  const r1 = sandbox.write('u-unit', 'todos', [task], []);
  assert.equal(r1.saved.length, 1);
  const r2 = sandbox.write('u-unit', 'todos', [{ ...task, workspaceId: 'w-real' }], []);
  assert.deepEqual([r2.saved.length, r2.refused], [0, ['unit-task']], 'it can’t move into a real company');
  const r3 = sandbox.write('u-unit', 'users', [{ id: 'demo-u-unit-new', name: 'Someone' }], []);
  assert.equal(r3.saved.length, 0, 'no new people');
  const r4 = sandbox.write('u-unit', 'workspaces', [{ ...ws, name: 'Renamed', members: [], sandbox: { owner: 'u-evil', createdAt: '2000-01-01', tried: ['reply', 'nope'], listOff: true } }], []);
  const after = r4.saved[0];
  assert.equal(after.name, 'Renamed');
  assert.deepEqual(after.members, [{ userId: 'u-unit', role: 'owner' }], 'they stay its owner');
  assert.deepEqual(after.sandbox, { owner: 'u-unit', createdAt: ws.sandbox.createdAt, tried: ['reply'], listOff: true }, 'whose it is stays; only real "Try this" keys');
  const big = sandbox.write('u-unit', 'messages', [{ id: 'unit-big', channelId: sandbox.docsOf('u-unit').channels[0].id, text: 'x'.repeat(3_100_000) }], []);
  assert.equal(big.saved.length, 0, 'a huge document isn’t kept');
  assert.match(big.why ?? '', /small files/);
  const del = sandbox.write('u-unit', 'workspaces', [], ['demo-u-unit']);
  assert.equal(del.deleted.length, 0, 'the company itself isn’t deleted by a save (Reset and Hide do that)');
});
await test('Demo company: hidden, shown, cleaned up after a month unused, and counted only for operators', () => {
  sandbox.setHidden('u-unit', true);
  assert.equal(sandbox.stateOf('u-unit', true).state, 'hidden');
  sandbox.setHidden('u-unit', false);
  assert.equal(sandbox.stateOf('u-unit', true).state, 'on');
  assert.equal(sandbox.stats().total, 1);
  assert.deepEqual(sandbox.cleanup(), [], 'used today: kept');
  db.db.prepare('UPDATE sandboxes SET used_at = ? WHERE owner = ?').run(new Date(Date.now() - 31 * 86_400_000).toISOString(), 'u-unit');
  assert.deepEqual(sandbox.cleanup(), ['u-unit'], 'unused for a month: gone');
  assert.equal(sandbox.info('u-unit'), null);
  assert.deepEqual(sandbox.docsOf('u-unit'), {}, 'with everything in it');
  assert.equal(sandbox.stateOf('u-unit', true).state, 'none', 'made again, fresh, the next time');
});

/* ---------- Calendar reminders (server/eventReminders.ts) ---------- */

const { eventReminders, reminderText } = await import('../server/eventReminders.ts');
await test('Event reminders: due once per start, again when moved, never for teammates’ copies or far too late', () => {
  const now = Date.parse('2026-10-09T09:50:00Z');
  const at = (min) => new Date(now + min * 60_000).toISOString();
  const ev = (id, startMin, remind, extra = {}) => ({ id, title: id, start: at(startMin), end: at(startMin + 30), userId: 'u-a', remind, ...extra });
  const list = [
    ev('due', 10, 10), // 10 minutes before a start 10 minutes away: now
    ev('later', 30, 10), // in 20 minutes
    ev('sent', 10, 10, { remindedFor: at(10) }), // already reminded for this start
    ev('moved', 10, 10, { remindedFor: at(-60) }), // reminded for an older start: again
    ev('none', 5, undefined),
    ev('feed', 5, 10, { feed: 'link' }), // a calendar link's copy: not ours to remind
    ev('stale', -5, 7 * 60), // the reminder was due seven hours ago
  ];
  assert.deepEqual(eventReminders(list, now).map((e) => e.id), ['due', 'moved']);
  assert.equal(reminderText(ev('Standup', 10, 10), now), '“Standup” starts in 10 minutes');
  assert.equal(reminderText(ev('Standup', 0, 0), now), '“Standup” is starting now');
  assert.equal(reminderText(ev('Offsite', 60 * 24, 1440, { allDay: true }), now), '“Offsite” is tomorrow');
});

/* ---------- Notes: view only, sharing and Recently deleted (server/notesTrash.ts) ---------- */

const { guardNote, expiredNotes } = await import('../server/notesTrash.ts');
await test('Notes: view-only notes stay as their owner left them; sharing and deleting are for who may', () => {
  const note = { id: 'n1', ownerId: 'u-owner', visibility: 'team', html: '<p>a</p>' };
  assert.equal(guardNote({ ...note, html: '<p>b</p>' }, { ...note, teamCan: 'view' }, 'u-other', false).doc, null, 'view only: a teammate changes nothing');
  assert.equal(guardNote({ ...note, html: '<p>b</p>', teamCan: 'view' }, { ...note, teamCan: 'view' }, 'u-owner', true).doc.html, '<p>b</p>', 'its owner does');
  const shared = guardNote({ ...note, html: '<p>b</p>', visibility: 'private' }, note, 'u-other', false);
  assert.equal(shared.doc.visibility, 'team', 'only the owner changes who sees it');
  assert.equal(shared.doc.html, '<p>b</p>', 'the edit itself is kept');
  const del = guardNote({ ...note, deletedAt: '2026-10-09T00:00:00Z' }, note, 'u-other', false);
  assert.equal(del.doc.deletedAt, undefined, 'a member who may not delete it can’t put it in Recently deleted');
  const ok = guardNote({ ...note, deletedAt: '2026-10-09T00:00:00Z' }, note, 'u-admin', true);
  assert.equal(ok.doc.deletedBy, 'u-admin', 'who deleted it is the server’s to say');
  const back = guardNote({ ...note, deletedAt: undefined, deletedBy: 'x' }, { ...note, deletedAt: '2026-10-09T00:00:00Z', deletedBy: 'u-admin' }, 'u-owner', true);
  assert.equal(back.doc.deletedBy, undefined, 'put back');
  const now = Date.parse('2026-11-20T00:00:00Z');
  assert.deepEqual(expiredNotes([{ id: 'old', deletedAt: '2026-10-01T00:00:00Z' }, { id: 'new', deletedAt: '2026-11-10T00:00:00Z' }, { id: 'live' }], now).map((n) => n.id), ['old'], 'gone for good after 30 days');
});

/* ---------- Tasks: due-date colours, rescheduling, Quick Add (src/taskDates.ts, src/quickAdd.ts) ---------- */

const td = await import('../src/taskDates.ts');
const qa = await import('../src/quickAdd.ts');
const TODAY = '2026-10-09'; // a Friday
await test('Task dates: each due date gets its colour (red overdue, green today, amber tomorrow, purple this week, grey later)', () => {
  assert.equal(td.dateTone('2026-10-08', TODAY), 'overdue');
  assert.equal(td.dateTone('2025-12-31', TODAY), 'overdue');
  assert.equal(td.dateTone(TODAY, TODAY), 'today');
  assert.equal(td.dateTone('2026-10-10', TODAY), 'tomorrow');
  assert.equal(td.dateTone('2026-10-11', TODAY), 'week');
  assert.equal(td.dateTone('2026-10-15', TODAY), 'week', 'six days on is still this week');
  assert.equal(td.dateTone('2026-10-16', TODAY), 'later');
  assert.equal(td.dateTone('2026-01-01', '2025-12-31'), 'tomorrow', 'across the new year');
  assert.equal(td.dateGroup(undefined, TODAY), 'none');
});
await test('Task dates: the words on a row', () => {
  assert.equal(td.dueText('2026-10-08', TODAY), 'Yesterday');
  assert.equal(td.dueText(TODAY, TODAY), 'Today');
  assert.equal(td.dueText('2026-10-10', TODAY), 'Tomorrow');
  assert.equal(td.dueText('2026-10-12', TODAY), 'Monday');
  assert.equal(td.dueText('2026-10-02', TODAY), '2 Oct');
  assert.equal(td.dueText('2027-02-01', TODAY), '1 Feb 2027');
  assert.equal(td.dayHeading('2026-10-09', TODAY), 'Today · Fri 9 Oct');
  assert.equal(td.addMonths('2026-01-31', 1), '2026-02-28', 'kept inside the month');
  assert.equal(td.weekStart('2026-10-11'), '2026-10-05', 'weeks start on Monday');
});
await test('Task dates: reschedule choices and Reschedule all (with its Undo)', () => {
  const c = td.dayChoices(TODAY, '2026-10-01');
  assert.deepEqual(c.map((x) => x.id), ['today', 'tomorrow', 'nextweek', 'none'], 'on a Friday there is no "this weekend" (tomorrow is Saturday)');
  assert.equal(c.find((x) => x.id === 'nextweek').day, '2026-10-12');
  assert.equal(c.find((x) => x.id === 'nextweek').hint, 'Mon 12 Oct');
  const wed = td.dayChoices('2026-10-07');
  assert.deepEqual(wed.map((x) => x.id), ['today', 'tomorrow', 'weekend', 'nextweek'], 'midweek: this weekend; no "No date" without one');
  assert.equal(wed.find((x) => x.id === 'weekend').day, '2026-10-10');
  const r = td.reschedule([{ id: 'a', due: '2026-10-01' }, { id: 'b', due: '2026-10-05' }, { id: 'c', due: TODAY }], TODAY);
  assert.deepEqual(r.patches, [{ id: 'a', due: TODAY }, { id: 'b', due: TODAY }], 'the one already on that day stays');
  assert.deepEqual(r.undo, [{ id: 'a', due: '2026-10-01' }, { id: 'b', due: '2026-10-05' }]);
  assert.deepEqual(td.reschedule([{ id: 'a', due: '2026-10-01' }], '').patches, [{ id: 'a', due: undefined }], 'No date clears it');
});
await test('Task dates: snoozing a team-queue task says exactly when it comes back', () => {
  const s = td.snoozeChoices(new Date(2026, 9, 9, 10, 2));
  assert.deepEqual(s.map((x) => x.id), ['hour', 'evening', 'tomorrow', 'nextweek']);
  assert.equal(s[0].hint, 'Today, 11:05', 'an hour on, rounded up to five minutes');
  assert.equal(s[1].hint, 'Today, 18:00');
  assert.equal(s[2].hint, 'Tomorrow, 09:00');
  assert.equal(s[3].hint, 'Mon 12 Oct, 09:00');
  assert.deepEqual(td.snoozeChoices(new Date(2026, 9, 9, 17, 0)).map((x) => x.id), ['hour', 'tomorrow', 'nextweek'], 'late in the day: no "this evening"');
});
const qctx = {
  today: TODAY,
  now: new Date(2026, 9, 9, 10, 0),
  projects: [{ id: 'c-kopi', name: 'Kopi Harian' }, { id: 'c-elk', name: 'Elkiya Group' }],
  people: [{ id: 'u-dewi', name: 'Dewi Lestari' }, { id: 'u-rizky', name: 'Rizky Pratama' }],
  stages: [{ id: 'todo', name: 'To do' }, { id: 'doing', name: 'In progress' }, { id: 'review', name: 'Review' }],
};
await test('Quick Add: reads the date and time, project, person and priority, and leaves the title', () => {
  const r = qa.parseQuickAdd('Send invoice tomorrow 3pm #kopi +dewi p1', qctx);
  assert.equal(r.title, 'Send invoice');
  assert.equal(r.due, '2026-10-10');
  assert.equal(r.time, '15:00');
  assert.equal(r.clientId, 'c-kopi');
  assert.deepEqual(r.assignees, ['u-dewi']);
  assert.equal(r.priority, 'high');
  assert.equal(new Date(r.remindAt).getHours(), 15, 'a time with the date reminds then');
  assert.deepEqual(r.tokens.map((t) => [t.kind, t.text, t.label]), [
    ['date', 'tomorrow 3pm', 'Tomorrow 15:00'],
    ['project', '#kopi', 'Kopi Harian'],
    ['person', '+dewi', 'Dewi'],
    ['priority', 'p1', 'P1'],
  ]);
  assert.equal(r.tokens[0].keys.length, 2, 'the date and its time are one highlight');
});
await test('Quick Add: weekdays, "next", "in 2 weeks", dates and stages', () => {
  const p = (t) => qa.parseQuickAdd(t, qctx);
  assert.equal(p('Review contract by Friday').due, TODAY, 'a weekday is that day or the next one');
  assert.equal(p('Review contract by Friday').title, 'Review contract', '"by" goes with the date');
  assert.equal(p('Plan next friday').due, '2026-10-16', 'next friday is the one in next week');
  assert.equal(p('Plan next week').due, '2026-10-12');
  assert.equal(p('Report in 2 weeks').due, '2026-10-23');
  assert.equal(p('Launch 13 oct').due, '2026-10-13');
  assert.equal(p('Launch oct 13').due, '2026-10-13');
  assert.equal(p('Launch 31/12').due, '2026-12-31');
  assert.equal(p('Launch 1 sep').due, '2027-09-01', 'a date already past this year is next year');
  assert.equal(p('Ship it /review').stageId, 'review');
  assert.equal(p('Ship it /prog').stageId, 'doing', 'a stage by the start of its name');
  assert.equal(p('Meet 9am').due, '2026-10-10', 'a time already gone today is tomorrow');
  assert.equal(p('Meet 2pm').due, TODAY);
});
await test('Quick Add: repeats, reminders, and words that only look like tokens', () => {
  const p = (t, off) => qa.parseQuickAdd(t, { ...qctx, off });
  const mon = p('Call Dimas every Monday');
  assert.equal(mon.repeat, 'weekly');
  assert.equal(mon.due, '2026-10-12', 'the first one on Monday');
  assert.equal(p('Pay rent every month').repeat, 'monthly');
  assert.equal(p('Pay rent every month').due, TODAY, 'a repeat starts today');
  assert.equal(p('Standup every weekday').repeat, 'weekdays');
  const rem = p('Check ads !2h');
  assert.equal(rem.title, 'Check ads');
  assert.equal(new Date(rem.remindAt).getHours(), 12);
  assert.equal(new Date(p('Call !3pm').remindAt).getHours(), 15);
  const keep = p('Ask about #unknown and +nobody, see mp3 p5');
  assert.equal(keep.title, 'Ask about #unknown and +nobody, see mp3 p5', 'nothing unknown is taken out');
  assert.equal(keep.tokens.length, 0);
  // Tapping a highlight turns it back into words, and nothing inside it is read again.
  const once = p('Create monthly report');
  assert.equal(once.repeat, 'monthly');
  const plain = p('Create monthly report', [once.tokens[0].key]);
  assert.equal(plain.repeat, undefined);
  assert.equal(plain.title, 'Create monthly report');
  const next = p('Plan next friday');
  assert.equal(p('Plan next friday', next.tokens[0].keys).due, undefined, '"friday" inside "next friday" stays words too');
  assert.equal(p('Plan next friday, then call', next.tokens[0].keys).due, undefined, 'still off after typing more');
});
await test('Quick Add: suggestions follow the word being typed', () => {
  assert.deepEqual(qa.triggerAt('Send #ko', 8), { char: '#', query: 'ko', start: 5 });
  assert.deepEqual(qa.triggerAt('Ask +', 5), { char: '+', query: '', start: 4 });
  assert.equal(qa.triggerAt('Send it', 7), null);
  assert.equal(qa.asToken('#', 'Kopi Harian'), '#Kopi-Harian');
  assert.equal(qa.parseQuickAdd('Brief #Kopi-Harian', qctx).clientId, 'c-kopi', 'what a suggestion puts in is read back');
});

/* ---------- Needs you (src/needsYou.ts): Home and the connector's needs_me ---------- */

const ny = await import('../src/needsYou.ts');
await test('Needs you: what needs me, in order, with notifications folded in and the badge counting the list', () => {
  const now = new Date(2026, 9, 9, 10, 0).getTime();
  const task = (id, x) => ({ id, title: id, done: false, userId: 'me', assignees: ['me'], status: 'todo', ...x });
  const kinds = { r: 'review' };
  const list = ny.needsYou({
    me: 'me',
    today: TODAY,
    now,
    tasks: [
      task('late', { due: '2026-10-07' }),
      task('today', { due: TODAY }),
      task('review', { userId: 'dewi', assignees: ['dewi'], supervisorId: 'me', status: 'r' }),
      task('queue', { userId: '', assignees: [], teamId: 'design' }),
      task('handed', { userId: 'dewi', assignees: ['dewi'], createdBy: 'me', due: '2026-10-01' }),
      task('fresh', { due: '2026-10-20' }),
      task('done', { done: true, due: '2026-10-01' }),
    ],
    stageKind: (t) => kinds[t.status] ?? 'open',
    teams: [{ id: 'design', name: 'Design', leadId: 'me' }],
    clients: [{ id: 'c', name: 'Kopi', domain: 'kopi.id' }],
    isOwner: false,
    firstName: (id) => ({ dewi: 'Dewi' })[id] ?? '',
    events: [
      { id: 'soon', title: 'Standup', start: new Date(now + 12 * 60_000).toISOString(), end: new Date(now + 40 * 60_000).toISOString() },
      { id: 'later', title: 'Lunch', start: new Date(now + 3 * 3_600_000).toISOString(), end: new Date(now + 4 * 3_600_000).toISOString() },
    ],
    threads: [{ id: 'th', subject: 'Invoice?', location: 'inbox', unread: true, messages: [{ from: { name: 'Nadia', email: 'nadia@kopi.id' } }] }],
    mine: (e) => e === 'me@agency.id',
    notices: [
      { id: 'n1', kind: 'task', text: 'Dewi finished “review”. Ready for your review', at: '2026-10-09T01:00:00Z', read: false, link: { app: 'tasks', id: 'review' } },
      { id: 'n2', kind: 'mention', text: 'Rizky mentioned you in #design', at: '2026-10-09T02:00:00Z', read: false, link: { app: 'chat', id: 'ch' } },
      { id: 'n3', kind: 'task', text: 'Dewi assigned you “fresh”', at: '2026-10-09T01:30:00Z', read: false, link: { app: 'tasks', id: 'fresh' } },
      { id: 'n4', kind: 'done', text: 'Dewi finished “logo”', at: '2026-10-09T01:40:00Z', read: false, link: { app: 'tasks', id: 'gone' } },
      { id: 'n5', kind: 'mention', text: 'old', at: '2026-10-08T01:00:00Z', read: true },
    ],
  });
  assert.deepEqual(list.map((x) => x.kind), ['meeting', 'review', 'mention', 'assigned', 'late', 'today', 'queue', 'delegated', 'mail']);
  assert.equal(list[0].group, 'now');
  assert.equal(list[0].sub, 'In 12 min');
  assert.deepEqual(list.find((x) => x.kind === 'review').noticeIds, ['n1'], 'the "ready for review" notice joins the review');
  assert.equal(list.find((x) => x.kind === 'today').group, 'today');
  assert.equal(ny.needsCount(list), 7, 'the badge: not the meeting, not today');
  assert.deepEqual(ny.updatesOf([{ id: 'n4', read: false, at: '1' }, { id: 'n2', read: false, at: '2' }, { id: 'n5', read: true, at: '0' }], list).map((n) => n.id), ['n4'], 'what is left is news');
});
await test('Needs you: a meeting leaves 5 minutes after it starts; the owner sees every queue', () => {
  const now = Date.parse('2026-10-09T03:00:00Z');
  const base = { me: 'me', today: TODAY, now, stageKind: () => 'open', clients: [], firstName: () => '', teams: [{ id: 't', name: 'Ops' }] };
  const ev = (mins) => [{ id: 'e', title: 'Call', start: new Date(now + mins * 60_000).toISOString(), end: new Date(now + (mins + 30) * 60_000).toISOString() }];
  assert.equal(ny.needsYou({ ...base, tasks: [], isOwner: false, events: ev(-4) })[0]?.sub, 'Happening now');
  assert.equal(ny.needsYou({ ...base, tasks: [], isOwner: false, events: ev(-6) }).length, 0);
  assert.equal(ny.needsYou({ ...base, tasks: [], isOwner: false, events: ev(31) }).length, 0);
  const q = [{ id: 'q', title: 'q', done: false, userId: '', teamId: 't' }];
  assert.equal(ny.needsYou({ ...base, tasks: q, isOwner: false }).length, 0);
  assert.equal(ny.needsYou({ ...base, tasks: q, isOwner: true })[0].kind, 'queue');
});

/* ---------- chat: send later, reminders on saved messages, mutes (server/chatLater.ts) ---------- */

const chatLater = await import('../server/chatLater.ts');
{
  const T = Date.parse('2026-10-09T10:00:00Z');
  const at = (mins) => new Date(T + mins * 60_000).toISOString();
  db.writeDocs('users', [{ id: 'u-cl-ann', name: 'Ann Lee', email: 'ann@cl.example' }, { id: 'u-cl-bo', name: 'Bo Tan', email: 'bo@cl.example' }, { id: 'u-cl-cy', name: 'Cy Ray', email: 'cy@cl.example' }], [], null);
  db.writeDocs('channels', [
    { id: 'ch-cl-dm', workspaceId: 'w-cl', kind: 'dm', name: '', members: ['u-cl-ann', 'u-cl-bo'] },
    { id: 'ch-cl-room', workspaceId: 'w-cl', kind: 'channel', name: 'launch', members: ['u-cl-ann', 'u-cl-bo', 'u-cl-cy'] },
  ], [], null);
  await test('Send later: a time only while the message hasn’t gone out, at most 120 days ahead', () => {
    const fresh = chatLater.guardOwnMessage({ id: 'm1', userId: 'u-cl-ann', text: 'hi', sendAt: at(60) }, null, T);
    assert.equal(fresh.sendAt, at(60));
    const far = chatLater.guardOwnMessage({ id: 'm1', userId: 'u-cl-ann', text: 'hi', sendAt: at(60 * 24 * 400) }, null, T);
    assert.equal(far.sendAt, new Date(T + 120 * 86_400_000).toISOString(), 'clamped to 120 days');
    const sent = chatLater.guardOwnMessage({ id: 'm1', userId: 'u-cl-ann', text: 'hi', sendAt: at(60) }, { id: 'm1', userId: 'u-cl-ann', text: 'hi', at: at(-5) }, T);
    assert.equal('sendAt' in sent, false, 'a message that went out can’t be made to wait again');
    const bad = chatLater.guardOwnMessage({ id: 'm1', userId: 'u-cl-ann', text: 'hi', sendAt: 'soon' }, null, T);
    assert.equal('sendAt' in bad, false, 'a time that isn’t one is dropped');
    const now = chatLater.guardOwnMessage({ id: 'm1', userId: 'u-cl-ann', text: 'hi', sendAt: null }, { id: 'm1', userId: 'u-cl-ann', sendAt: at(60) }, T);
    assert.equal('sendAt' in now, false, '“Send now” clears it');
  });
  await test('Send later: waiting messages are their author’s alone', () => {
    const m = { id: 'm2', userId: 'u-cl-ann', sendAt: at(5) };
    assert.equal(chatLater.hiddenFrom(m, 'u-cl-bo'), true);
    assert.equal(chatLater.hiddenFrom(m, 'u-cl-ann'), false);
    assert.equal(chatLater.hiddenFrom({ id: 'm3', userId: 'u-cl-ann' }, 'u-cl-bo'), false);
  });
  await test('Send later: due messages go out now, with the notices a message sent then would bring', () => {
    db.writeDocs('messages', [
      { id: 'm-root', channelId: 'ch-cl-room', userId: 'u-cl-cy', text: 'Who has the deck?', at: at(-60) },
      { id: 'm-dm', channelId: 'ch-cl-dm', userId: 'u-cl-ann', text: 'Morning! Call at 10?', at: at(-30), sendAt: at(-1) },
      { id: 'm-mention', channelId: 'ch-cl-room', userId: 'u-cl-ann', text: '@Bo can you check the numbers', at: at(-30), sendAt: at(0) },
      { id: 'm-reply', channelId: 'ch-cl-room', userId: 'u-cl-ann', text: 'I do', at: at(-30), sendAt: at(-2), parentId: 'm-root' },
      { id: 'm-later', channelId: 'ch-cl-room', userId: 'u-cl-ann', text: 'not yet', at: at(-30), sendAt: at(30) },
    ], [], null);
    const out = chatLater.publishDue(T);
    assert.deepEqual(out.messages.map((m) => m.id).sort(), ['m-dm', 'm-mention', 'm-reply']);
    assert.ok(out.messages.every((m) => m.at === at(0) && !('sendAt' in m)), 'their time is now, and they wait no more');
    const texts = out.notices.map((n) => `${n.userId}: ${n.text}`).sort();
    assert.deepEqual(texts, ['u-cl-bo: Ann mentioned you in #launch: “@Bo can you check the numbers”', 'u-cl-bo: Ann messaged you: “Morning! Call at 10?”', 'u-cl-cy: Ann replied to your message in #launch: “I do”']);
    assert.ok(out.notices.every((n) => n.kind === 'mention' && n.workspaceId === 'w-cl' && n.link.app === 'chat' && n.read === false));
    db.writeDocs('messages', out.messages, [], null);
    assert.deepEqual(chatLater.publishDue(T).messages, [], 'each goes out once');
  });
  await test('Remind me: a saved message’s reminder comes once, at its time, and an older copy of the settings can’t bring it back', () => {
    const key = 'p-unit-saved';
    const saved = [
      { id: 'm-root', channelId: 'ch-cl-room', at: at(-10), remindAt: at(-1) },
      { id: 'm-dm', channelId: 'ch-cl-dm', at: at(-10), remindAt: at(60) },
      { id: 'm-mention', channelId: 'ch-cl-room', at: at(-10) },
    ];
    db.writeDocs('prefs', [{ id: 'u-cl-bo', value: { [`s2g-chat-saved:u-cl-bo`]: saved, other: key } }], [], null);
    const out = chatLater.remindersDue(T, () => true);
    assert.equal(out.notices.length, 1);
    assert.equal(out.notices[0].text, 'Reminder: Cy in #launch: “Who has the deck?”');
    assert.equal(out.notices[0].userId, 'u-cl-bo');
    assert.deepEqual(out.notices[0].link, { app: 'chat', id: 'ch-cl-room', msg: 'm-root' });
    const after = out.prefs[0].value['s2g-chat-saved:u-cl-bo'];
    assert.deepEqual(after.map((x) => !!x.reminded), [true, false, false]);
    assert.equal(out.prefs[0].value.other, key, 'the rest of their settings stay');
    db.writeDocs('prefs', out.prefs, [], null);
    assert.equal(chatLater.remindersDue(T, () => true).notices.length, 0, 'once');
    const stale = { id: 'u-cl-bo', value: { 's2g-chat-saved:u-cl-bo': saved } };
    const kept = chatLater.keepReminded(stale, db.getDoc('prefs', 'u-cl-bo'));
    assert.equal(kept.value['s2g-chat-saved:u-cl-bo'][0].reminded, true, 'an older copy keeps it done');
    const moved = chatLater.keepReminded({ id: 'u-cl-bo', value: { 's2g-chat-saved:u-cl-bo': [{ ...saved[0], remindAt: at(120) }] } }, db.getDoc('prefs', 'u-cl-bo'));
    assert.equal(!!moved.value['s2g-chat-saved:u-cl-bo'][0].reminded, false, 'a new time is a new reminder');
    db.writeDocs('prefs', [{ id: 'u-cl-cy', value: { 's2g-chat-saved:u-cl-cy': [{ id: 'm-dm', channelId: 'ch-cl-dm', remindAt: at(-1) }] } }], [], null);
    const blind = chatLater.remindersDue(T, () => false);
    assert.equal(blind.notices[0].text, 'Reminder: a message you saved', 'a message they can’t read isn’t quoted');
  });
  await test('Mute: for an hour, until a time, or for good', () => {
    const v = { 's2g-chat-muted:u-cl-bo': { a: 'always', b: at(30), c: at(-30) } };
    assert.equal(chatLater.mutedFor(v, 'u-cl-bo', 'a', T), true);
    assert.equal(chatLater.mutedFor(v, 'u-cl-bo', 'b', T), true);
    assert.equal(chatLater.mutedFor(v, 'u-cl-bo', 'c', T), false, 'the hour is over');
    assert.equal(chatLater.mutedFor(v, 'u-cl-bo', 'd', T), false);
    assert.equal(chatLater.mutedFor(v, 'u-cl-ann', 'a', T), false, 'only their own');
  });
}

/* ---------- Team mail: snoozes, comments, who handles it, and when a phone buzzes (src/mailRules.ts, server/mailTeam.ts, server/notifyPush.ts) ---------- */

const mailRules = await import('../src/mailRules.ts');
const mailTeam = await import('../server/mailTeam.ts');
const pushRules = await import('../server/notifyPush.ts');
const msg = (id, from, minsAgo = 60) => ({ id, from: { name: from.split('@')[0], email: from }, to: [], date: new Date(Date.now() - minsAgo * 60_000).toISOString(), body: 'Hello' });

await test('Snooze: a due email comes back unread to the inbox; one not due stays hidden', () => {
  const now = new Date().toISOString();
  const t = { location: 'inbox', unread: false, snoozedUntil: new Date(Date.now() - 1000).toISOString(), messages: [msg('m1', 'client@outside.example')] };
  const woke = mailRules.wakeThread(t, now);
  assert.equal(woke.unread, true);
  assert.equal(woke.location, 'inbox');
  assert.equal('snoozedUntil' in woke, false);
  assert.equal(mailRules.wakeThread({ ...t, snoozedUntil: new Date(Date.now() + 60_000).toISOString() }, now), null);
  assert.equal(mailRules.wakeThread({ ...t, location: 'archive' }, now).location, 'inbox', 'snoozed from Archive (a sent email): back in the inbox');
});
await test('Snooze "only if no reply": comes back when nobody wrote; a reply since keeps it away, in Archive', () => {
  const now = new Date().toISOString();
  const due = new Date(Date.now() - 1000).toISOString();
  const quiet = { location: 'inbox', unread: false, snoozedUntil: due, snoozeIfNoReply: 'm1', messages: [msg('m1', 'me@team.example')] };
  const back = mailRules.wakeThread(quiet, now);
  assert.equal(back.unread, true, 'nobody wrote: it comes back');
  assert.equal('snoozeIfNoReply' in back, false);
  const replied = { ...quiet, messages: [msg('m1', 'me@team.example'), msg('m2', 'me@team.example', 5)] };
  const handled = mailRules.wakeThread(replied, now);
  assert.equal(handled.unread, false, 'a reply from here: no comeback');
  assert.equal(handled.location, 'archive');
  assert.deepEqual(mailRules.snoozePatch(replied, due, true), { snoozedUntil: due, snoozeIfNoReply: 'm2' });
  assert.equal(mailRules.snoozePatch(replied, due, false).snoozeIfNoReply, undefined);
});
await test('Snooze presets: exact times, only the ones that make sense now', () => {
  const monMorning = new Date(2026, 9, 5, 8, 10); // Monday 08:10
  const p = mailRules.snoozePresets(monMorning).map((x) => x.id);
  assert.deepEqual(p, ['later', 'evening', 'tomorrow', 'weekend', 'week']);
  const later = mailRules.snoozePresets(monMorning)[0].at;
  assert.equal(later.getHours() * 60 + later.getMinutes(), 11 * 60 + 15, 'three hours on, to the next quarter');
  const friNight = new Date(2026, 9, 9, 21, 0); // Friday 21:00
  assert.deepEqual(mailRules.snoozePresets(friNight).map((x) => x.id), ['tomorrow', 'week']);
  const week = mailRules.snoozePresets(friNight).find((x) => x.id === 'week').at;
  assert.equal(week.getDay(), 1, 'next week is Monday');
  assert.equal(week.getHours(), 9);
});
await test('People, not systems: newsletters and notification senders are automated', () => {
  assert.equal(mailRules.fromPerson({ from: { email: 'nadia@kopikita.co.id' } }), true);
  assert.equal(mailRules.fromPerson({ from: { email: 'no-reply@aws.amazon.com' } }), false);
  assert.equal(mailRules.fromPerson({ from: { email: 'notifications@dokploy.com' } }), false);
  assert.equal(mailRules.fromPerson({ from: { email: 'news+weekly@shop.example' } }), false);
  assert.equal(mailRules.fromPerson({ from: { email: 'dina@figma.com' }, listUnsubscribe: { url: 'https://x', oneClick: true } }), false);
  const mine = (e) => e.endsWith('@team.example');
  assert.equal(mailRules.needsReply({ location: 'inbox', messages: [msg('a', 'client@outside.example')] }, mine), true);
  assert.equal(mailRules.needsReply({ location: 'inbox', messages: [msg('a', 'client@outside.example'), msg('b', 'me@team.example')] }, mine), false, 'answered');
  assert.equal(mailRules.needsReply({ location: 'archive', messages: [msg('a', 'client@outside.example')] }, mine), false, 'done');
});
await test('Comments: everyone writes their own; nobody changes or removes someone else’s', () => {
  const acct = { id: 'box', users: ['u-ann', 'u-bob'] };
  const before = { id: 't-c', accountId: 'box', notes: [{ id: 'n1', by: 'u-ann', text: 'Ann’s', at: '2026-10-01T10:00:00.000Z' }, { id: 'n2', by: 'u-bob', text: 'Bob’s', at: '2026-10-01T11:00:00.000Z' }] };
  const asked = { ...before, notes: [{ id: 'n1', by: 'u-ann', text: 'Changed by Bob', at: 'x' }, { id: 'n3', by: 'u-ann', text: 'Bob pretending to be Ann', at: 'x' }, { id: 'n4', by: 'u-bob', text: '  New from Bob  ', at: 'not a date' }] };
  const out = mailTeam.guardTeamMail(asked, before, 'u-bob', acct, '2026-10-09T00:00:00.000Z');
  assert.deepEqual(out.notes.map((n) => [n.id, n.by, n.text]), [['n1', 'u-ann', 'Ann’s'], ['n4', 'u-bob', 'New from Bob']], 'Ann’s stays as written; Bob removed his own; the forged one is dropped');
  assert.equal(out.notes[1].at, '2026-10-09T00:00:00.000Z', 'a bad time becomes the server’s');
  const edit = mailTeam.guardTeamMail({ ...before, notes: [before.notes[0], { ...before.notes[1], text: 'Bob, edited' }] }, before, 'u-bob', acct);
  assert.equal(edit.notes[1].text, 'Bob, edited', 'their author edits their own');
});
await test('Who handles an email: only someone with the mailbox, and the server notes who gave it to them', () => {
  const acct = { id: 'box', users: ['u-ann', 'u-bob'] };
  const before = { id: 't-a', accountId: 'box' };
  const given = mailTeam.guardTeamMail({ ...before, assignee: 'u-bob', assignedBy: 'u-bob' }, before, 'u-ann', acct);
  assert.equal(given.assignee, 'u-bob');
  assert.equal(given.assignedBy, 'u-ann');
  const outsider = mailTeam.guardTeamMail({ ...given, assignee: 'u-stranger' }, given, 'u-ann', acct);
  assert.equal(outsider.assignee, 'u-bob', 'someone without the mailbox can’t be given it');
  assert.equal(outsider.assignedBy, 'u-ann');
  const none = mailTeam.guardTeamMail({ ...given, assignee: undefined }, given, 'u-bob', acct);
  assert.equal('assignee' in none || 'assignedBy' in none, false);
  const keep = mailTeam.guardTeamMail({ ...given, assignedBy: 'u-bob' }, given, 'u-bob', acct);
  assert.equal(keep.assignedBy, 'u-ann', 'who gave it is the server’s');
  const snooze = mailTeam.guardTeamMail({ ...before, snoozedUntil: 'soon', snoozeIfNoReply: 'm1' }, before, 'u-ann', acct);
  assert.equal('snoozedUntil' in snooze || 'snoozeIfNoReply' in snooze, false, 'a snooze needs a real time');
});
await test('Mail pushes: people only, held about 20 seconds, dropped once read elsewhere; shared inboxes buzz only the assignee', async () => {
  const sent = [];
  pushRules.initPushRules({ active: () => false, desktop: { has: (u) => u.startsWith('u-p'), send: (u, a) => sent.push({ u, tag: a.tag }) } });
  pushRules.setPushHold(60);
  db.writeDocs('workspaces', [{ id: 'w-push', name: 'Push', domains: ['push.example'], members: [{ userId: 'u-pa', role: 'owner' }, { userId: 'u-pb', role: 'member' }], accounts: [{ id: 'pa', email: 'pa@push.example', kind: 'personal', users: ['u-pa'] }, { id: 'shared', email: 'hello@push.example', kind: 'shared', users: ['u-pa', 'u-pb'] }] }], [], null);
  const arrive = (id, account, from, extra = {}) => {
    const t = { id, accountId: account, subject: id, location: 'inbox', unread: true, starred: false, labels: [], messages: [{ ...msg(`m-${id}`, from, 0) }], ...extra };
    db.writeDocs('threads', [t], [], null);
    pushRules.onBroadcast('threads', [t]);
    return t;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  arrive('t-person', 'pa', 'client@outside.example');
  arrive('t-robot', 'pa', 'no-reply@service.example');
  const seen = arrive('t-seen', 'pa', 'other@outside.example');
  assert.equal(sent.length, 0, 'nothing buzzes straight away');
  db.writeDocs('threads', [{ ...seen, unread: false }], [], null); // read on the computer a few seconds later
  arrive('t-shared-open', 'shared', 'lead@outside.example');
  arrive('t-shared-mine', 'shared', 'lead2@outside.example', { assignee: 'u-pb' });
  await sleep(150);
  assert.deepEqual(sent.map((x) => `${x.u} ${x.tag}`).sort(), ['u-pa mail:t-person', 'u-pb mail:t-shared-mine'], 'a person’s mail, and the shared one given to Bob; not the robot, the read one or the unassigned one');
  // A mention in a comment: held too, and dropped if the notice was read meanwhile.
  sent.length = 0;
  const note = (id) => ({ id, userId: 'u-pb', workspaceId: 'w-push', kind: 'mention', text: 'Ann mentioned you', at: new Date().toISOString(), read: false, link: { app: 'mail', id: 't-shared-open' } });
  db.writeDocs('notices', [note('n-push-1'), note('n-push-2')], [], null);
  pushRules.onBroadcast('notices', [note('n-push-1'), note('n-push-2')]);
  db.writeDocs('notices', [{ ...note('n-push-2'), read: true }], [], null);
  await sleep(150);
  assert.deepEqual(sent.map((x) => x.tag), ['mail:t-shared-open'], 'one mention buzzes; the one already read doesn’t');
  pushRules.setPushHold(20_000);
});

/* ---------- each reader's language (server/lang.ts, docs/i18n.md) ---------- */

const lang = await import('../server/lang.ts');
const { textOf } = await import('../src/i18n/index.ts');
db.writeDocs('workspaces', [{ id: 'w-lang-id', name: 'Kopi Nusantara', language: 'id', members: [{ userId: 'u-lang-co', role: 'owner' }] }, { id: 'w-lang-en', name: 'Plain Co', members: [{ userId: 'u-lang-en', role: 'owner' }, { userId: 'u-lang-own', role: 'member' }] }], [], null);
db.writeDocs('users', [{ id: 'u-lang-co', name: 'Sari Dewi', email: 'sari@kopi.example' }, { id: 'u-lang-en', name: 'Ann Lee', email: 'ann@plain.example' }, { id: 'u-lang-own', name: 'Budi', email: 'budi@plain.example' }], [], null);
db.writeDocs('prefs', [{ id: 'u-lang-own', value: { 'pm-settings:u-lang-own': { language: 'id' } } }], [], null);
await test('Language: a person’s own pick, else the company’s default, else English', () => {
  assert.equal(lang.langOf('u-lang-own'), 'id', 'their own pick wins');
  assert.equal(lang.langOf('u-lang-co'), 'id', 'the company’s default');
  assert.equal(lang.langOf('u-lang-en'), 'en', 'neither: English');
  assert.equal(lang.langOfEmail('nobody@else.example', 'w-lang-id'), 'id', 'an invitee: the company’s default');
  assert.equal(lang.browserLang('en-US,en;q=0.9,id;q=0.8'), 'en');
  assert.equal(lang.browserLang('id-ID,id;q=0.9'), 'id');
  assert.equal(lang.requestLang({ headers: { cookie: 's2g-lang=id', 'accept-language': 'en' } }), 'id', 'the screen’s language first');
  assert.equal(lang.requestLang({ headers: { 'accept-language': 'id-ID' } }), 'id', 'else the browser’s');
});
await test('Language: a notice reads in Indonesian for an Indonesian reader and in English otherwise', () => {
  const ev = { id: 'e1', title: 'Standup', start: new Date(Date.parse('2026-10-09T09:10:00Z')).toISOString(), end: '2026-10-09T09:30:00Z', remind: 10, userId: 'u-lang-own' };
  return import('../server/eventReminders.ts').then(({ reminderWords: rw }) => {
    const n = rw(ev, Date.parse('2026-10-09T09:00:00Z'));
    assert.equal(n.text, '“Standup” starts in 10 minutes', 'saved in English');
    assert.equal(lang.inLang('id', () => textOf(n)), '“Standup” dimulai 10 menit lagi');
    assert.equal(lang.inLang(lang.langOf('u-lang-en'), () => textOf(n)), '“Standup” starts in 10 minutes');
    const r = retention.noticeWords('Kopi Nusantara', '90d', '2026-10-16T05:00:00Z', 'Asia/Jakarta');
    assert.match(lang.inLang('id', () => textOf(r)), /^Mulai 16 Oktober, .*90 hari/);
    assert.match(r.text, /^From 16 October, chat messages older than 90 days/);
  });
});
await test('Language: an email comes out in Indonesian for an Indonesian reader and in English otherwise', async () => {
  const digest = await import('../server/digest.ts');
  const item = { key: 'n:x', group: 'messages', ...(await import('../src/i18n/index.ts')).msg('{name} messaged you: {quote}', { name: 'Mo', quote: '“lunch?”' }), url: 'https://app.example/chat', at: new Date().toISOString(), workspaceId: 'w-lang-id' };
  const id = digest.compose('Budi Santoso', 'Kopi Nusantara', [item], 'https://app.example', lang.langOf('u-lang-own'));
  assert.equal(id.subject, '1 hal menunggu Anda di Kopi Nusantara');
  assert.match(id.text, /^Halo Budi, selama Anda tidak ada:/);
  assert.match(id.text, /Mo mengirimi Anda pesan: “lunch\?”/);
  assert.match(id.html, /Ubah seberapa sering/);
  const en = digest.compose('Ann Lee', 'Plain Co', [item], 'https://app.example', lang.langOf('u-lang-en'));
  assert.equal(en.subject, '1 thing waiting for you in Plain Co');
  assert.match(en.text, /Mo messaged you: “lunch\?”/);
});

db.db.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
