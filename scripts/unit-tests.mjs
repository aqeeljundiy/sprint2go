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
  const tell = (ids, text) => told.push(text);
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

db.db.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
