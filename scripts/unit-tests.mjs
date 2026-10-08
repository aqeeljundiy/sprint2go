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
db.db.close();
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
