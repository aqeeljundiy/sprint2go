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
const ajDeps = { recorderUp: () => true, send: async (_ws, m) => (ajSent.push(m), null), notify: (ids, _ws, text) => ajNotes.push({ ids, text }) };
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
  const deps = { broadcast: () => {}, notify: (ids, ws, text) => told.push(text) };
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

db.db.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
