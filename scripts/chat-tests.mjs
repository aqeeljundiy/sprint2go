// Chat's rules, end to end: following threads and group messages (src/chatFollow.ts, server/chatRules.ts,
// server/chatLater.ts). Two parts:
//  1. the rules themselves: who follows a thread, who hears about a message and why, each person's own follow choice,
//     and the notices a message sent later brings (on a throwaway data folder, in this process)
//  2. the server (demo data, a throwaway data folder, free ports, no mail): a group message is seen only by its
//     people; 2 to 8 others, all on the team; nobody is added later (a new group, or "Convert to a private channel");
//     leaving; guests only when they joined a project and the person may invite guests there, and the guest sees it
//     named after its people and can write in it; each person changes only their own follow choice
//   node --import ./server/register.mjs scripts/chat-tests.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('..', import.meta.url).pathname;
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message.split('\n').join('\n     ') : e}`);
  }
};

/* ---------- 1. the rules ---------- */

const local = mkdtempSync(join(tmpdir(), 's2g-chat-unit-'));
process.env.S2G_DATA = local;
const { followsThread, chatRecipients, ownFollow, isGroupDm } = await import('../src/chatFollow.ts');
const first = (id) => ({ 'u-a': 'Ana', 'u-b': 'Budi', 'u-c': 'Citra', 'u-d': 'Dina' })[id] ?? 'Someone';
const root = { userId: 'u-a', text: 'Launch plan, thoughts?' };

await test('Follow: starting, replying in or being mentioned in a thread follows it', () => {
  const replies = [{ userId: 'u-b', text: 'Looks good, @Citra can you check the copy?' }];
  assert.equal(followsThread(root, replies, 'u-a', 'Ana'), true, 'started it');
  assert.equal(followsThread(root, replies, 'u-b', 'Budi'), true, 'replied');
  assert.equal(followsThread(root, replies, 'u-c', 'Citra'), true, 'mentioned');
  assert.equal(followsThread(root, replies, 'u-d', 'Dina'), false, 'none of those');
  assert.equal(followsThread(root, [{ userId: 'u-b', text: '@Dinah not Dina' }], 'u-d', 'Dina'), false, 'a longer name is not a mention');
});
await test('Follow: your own choice wins either way', () => {
  assert.equal(followsThread({ ...root, follow: { 'u-d': true } }, [], 'u-d', 'Dina'), true, 'Follow');
  assert.equal(followsThread({ ...root, follow: { 'u-a': false } }, [], 'u-a', 'Ana'), false, 'Unfollow your own thread');
});
await test('Follow: each person changes only their own choice', () => {
  assert.deepEqual(ownFollow({ 'u-a': false }, { 'u-a': true, 'u-b': true }, 'u-b'), { 'u-a': false, 'u-b': true });
  assert.deepEqual(ownFollow({ 'u-a': false, 'u-b': true }, {}, 'u-b'), { 'u-a': false }, 'clearing yours keeps theirs');
  assert.equal(ownFollow(undefined, { 'u-a': 'yes' }, 'u-a'), undefined, 'only true or false');
});
await test('Notices: a reply reaches the thread’s followers once each, and nobody else', () => {
  const ch = { kind: 'channel', members: ['u-a', 'u-b', 'u-c', 'u-d'] };
  const thread = { root: { ...root, follow: { 'u-d': true } }, replies: [{ userId: 'u-b', text: 'ok' }] };
  const r = chatRecipients({ userId: 'u-b', text: 'done, @Citra', parentId: 'm-root' }, ch, thread, first);
  assert.deepEqual(r, [
    { id: 'u-a', why: 'reply' },
    { id: 'u-c', why: 'mention' },
    { id: 'u-d', why: 'thread' },
  ]);
  const off = chatRecipients({ userId: 'u-b', text: 'again' }, ch, null, first);
  assert.deepEqual(off, [], 'a channel message without a mention reaches nobody');
  const unf = chatRecipients({ userId: 'u-b', text: 'more', parentId: 'm-root' }, ch, { root: { ...root, follow: { 'u-a': false } }, replies: [] }, first);
  assert.deepEqual(unf, [], 'whoever unfollowed hears nothing, even their own thread');
});
await test('Notices: “also send to the channel” reaches the followers and the rest as a channel message', () => {
  const dm = { kind: 'dm', members: ['u-a', 'u-b', 'u-c'] };
  const r = chatRecipients({ userId: 'u-a', text: 'see above', parentId: 'm-root', alsoInChannel: true }, dm, { root: { userId: 'u-b', text: 'q' }, replies: [] }, first);
  assert.deepEqual(r, [
    { id: 'u-b', why: 'reply' },
    { id: 'u-c', why: 'group' },
  ]);
});
await test('Group messages: more than one other person, or a guest', () => {
  assert.equal(isGroupDm({ kind: 'dm', members: ['u-a', 'u-b'] }), false);
  assert.equal(isGroupDm({ kind: 'dm', members: ['u-a', 'u-b', 'u-c'] }), true);
  assert.equal(isGroupDm({ kind: 'dm', members: ['u-a', 'u-b'], guests: [{ email: 'g@x.test' }] }), true);
  assert.deepEqual(chatRecipients({ userId: 'u-a', text: 'hi all' }, { kind: 'dm', members: ['u-a', 'u-b', 'u-c'] }, null, first).map((x) => x.why), ['group', 'group']);
});

const db = await import('../server/db.ts');
const chatLater = await import('../server/chatLater.ts');
await test('Send later: a reply that goes out later reaches the thread’s followers, saying why', () => {
  db.writeDocs('channels', [{ id: 'ch-t', workspaceId: 'w', kind: 'channel', name: 'design', members: ['u-a', 'u-b', 'u-c', 'u-d'] }], [], null);
  db.writeDocs('messages', [{ id: 'm-r', channelId: 'ch-t', userId: 'u-a', text: 'Poster?', at: '2026-10-01T00:00:00.000Z', follow: { 'u-d': true } }, { id: 'm-1', channelId: 'ch-t', userId: 'u-c', text: 'on it', at: '2026-10-01T00:01:00.000Z', parentId: 'm-r' }], [], null);
  const users = new Map(['u-a', 'u-b', 'u-c', 'u-d'].map((id) => [id, { id, name: first(id) }]));
  const out = chatLater.noticesFor({ id: 'm-2', channelId: 'ch-t', userId: 'u-b', text: 'v2 attached', parentId: 'm-r' }, '2026-10-01T00:02:00.000Z', users);
  assert.deepEqual(out.map((n) => [n.userId, n.text]), [
    ['u-a', 'Budi replied to your message in #design: “v2 attached”'],
    ['u-c', 'Budi replied in a thread you follow in #design: “v2 attached”'],
    ['u-d', 'Budi replied in a thread you follow in #design: “v2 attached”'],
  ]);
  db.writeDocs('channels', [{ id: 'ch-g', workspaceId: 'w', kind: 'dm', name: '', members: ['u-a', 'u-b', 'u-c'] }], [], null);
  const g = chatLater.noticesFor({ id: 'm-3', channelId: 'ch-g', userId: 'u-a', text: 'lunch?' }, '2026-10-01T00:03:00.000Z', users);
  assert.deepEqual(g.map((n) => [n.userId, n.text, n.tr?.key]), [
    ['u-b', 'Ana in a group message: “lunch?”', '{name} in a group message: {quote}'],
    ['u-c', 'Ana in a group message: “lunch?”', '{name} in a group message: {quote}'],
  ]);
});

/* ---------- 2. the server ---------- */

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
const dir = mkdtempSync(join(tmpdir(), 's2g-chat-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  MAIL_ENABLED: '0',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  PUBLIC_URL: '',
  SUPPORT_EMAIL: 'support@s2g-chat.test',
};
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
const finish = (code) => {
  server.kill('SIGTERM');
  for (const d of [dir, local])
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the server may still hold a file for a moment */
    }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 120_000).unref();

try {
  const base = `http://127.0.0.1:${httpPort}`;
  for (let i = 0; i < 300; i++) {
    if (server.exitCode !== null) break;
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await sleep(100);
  }
  check(await fetch(`${base}/api/health`).then((r) => r.ok, () => false), 'the server starts (demo data)');
  const sdb = new DatabaseSync(join(dir, 'sprint2go.db'));
  const now = () => new Date().toISOString();
  const doc = (coll, id) => JSON.parse(sdb.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const put = (coll, d) => sdb.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.SEED_PASSWORD }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
      ok: r.ok && cookie.startsWith('s2g='),
      state: () => call('GET', '/api/state').then((x) => x.json()),
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
    };
  };
  const aqeel = await signIn('aqeel@pixelandprofits.com'); // owner
  const rizky = await signIn('rizky@pixelandprofits.com');
  const dewi = await signIn('dewi@pixelandprofits.com');
  const nadia = await signIn('nadia@kopikita.co.id'); // a guest at KopiKita (joined)
  check(aqeel.ok && rizky.ok && dewi.ok && nadia.ok, 'the owner, two members and a guest sign in');
  const sees = async (who, id) => (await who.state()).channels.some((c) => c.id === id);

  /* who's in it */
  const g = { id: 'gdm-1', workspaceId: 'pnp', kind: 'dm', name: '', members: ['u-rizky', 'u-faisal', 'u-nanda'] };
  await rizky.sync('channels', [g]);
  const saved = doc('channels', 'gdm-1');
  check(saved?.kind === 'dm' && saved.members.length === 3, 'a member starts a group message with two others');
  check((await sees(rizky, 'gdm-1')) && !(await sees(dewi, 'gdm-1')) && !(await sees(aqeel, 'gdm-1')), 'only its people see it, not even the owner');
  put('messages', { id: 'gm-1', channelId: 'gdm-1', userId: 'u-faisal', text: 'secret mango plan', at: now() });
  check(!(await dewi.state()).messages.some((m) => m.id === 'gm-1') && (await rizky.state()).messages.some((m) => m.id === 'gm-1'), 'and only they read its messages');
  const ten = await rizky.sync('channels', [{ ...g, id: 'gdm-big', members: ['u-rizky', 'u-aqeel', 'u-faisal', 'u-aditya', 'u-nanda', 'u-sekar', 'u-dewi', 'u-dimas', 'u-bayu', 'u-x'] }]);
  check(!doc('channels', 'gdm-big') && /up to 9/.test(ten.why ?? ''), 'more than 8 others is refused, with why');
  const outside = await rizky.sync('channels', [{ ...g, id: 'gdm-out', members: ['u-rizky', 'u-faisal', 'u-dimas'] }]);
  check(!doc('channels', 'gdm-out') && /team/.test(outside.why ?? ''), 'someone who isn’t on the team is refused');
  await rizky.sync('channels', [{ ...g, id: 'gdm-not-me', members: ['u-faisal', 'u-nanda', 'u-sekar'] }]);
  check(!doc('channels', 'gdm-not-me'), 'nobody starts a group message they aren’t in');
  await rizky.sync('channels', [{ ...doc('channels', 'gdm-1'), members: ['u-rizky', 'u-faisal', 'u-nanda', 'u-dewi'] }]);
  check(doc('channels', 'gdm-1').members.length === 3 && !(await sees(dewi, 'gdm-1')), 'nobody is added to it later (that’s a new group)');
  const huddle = { by: 'u-rizky', at: now(), members: ['u-rizky'] };
  await rizky.sync('channels', [{ ...doc('channels', 'gdm-1'), huddle }]);
  check(doc('channels', 'gdm-1').huddle?.members?.[0] === 'u-rizky', 'its people still start a huddle in it');
  const faisal = await signIn('faisal@pixelandprofits.com');
  await faisal.sync('channels', [{ ...doc('channels', 'gdm-1'), members: ['u-rizky', 'u-nanda'] }]);
  check(JSON.stringify(doc('channels', 'gdm-1').members) === JSON.stringify(['u-rizky', 'u-nanda']) && !(await sees(faisal, 'gdm-1')), 'someone leaves it, and stops seeing it');
  await rizky.sync('channels', [{ ...doc('channels', 'gdm-1'), members: ['u-rizky'] }]);
  check(doc('channels', 'gdm-1').members.length === 2, 'but can’t take others out');

  /* convert to a private channel */
  put('channels', { id: 'gdm-2', workspaceId: 'pnp', kind: 'dm', name: '', members: ['u-rizky', 'u-nanda', 'u-sekar'] });
  await dewi.sync('channels', [{ ...doc('channels', 'gdm-2'), kind: 'channel', name: 'hijack', members: ['u-dewi'] }]);
  check(doc('channels', 'gdm-2').kind === 'dm', 'someone outside it can’t convert it');
  await rizky.sync('channels', [{ ...doc('channels', 'gdm-2'), kind: 'channel', name: 'launch-crew', members: ['u-rizky', 'u-dewi'], private: false }]);
  const conv = doc('channels', 'gdm-2');
  check(conv.kind === 'channel' && conv.private === true && conv.name === 'launch-crew' && ['u-rizky', 'u-nanda', 'u-sekar', 'u-dewi'].every((x) => conv.members.includes(x)) && conv.ownerId === 'u-rizky', 'one of its people converts it to a private channel: everyone stays, more may come in');
  check(await sees(dewi, 'gdm-2'), 'and the person added sees it now');

  /* guests */
  const pnp = doc('workspaces', 'pnp');
  put('workspaces', { ...pnp, permissions: { ...(pnp.permissions ?? {}), inviteGuests: false } });
  const gg = { id: 'gdm-guest', workspaceId: 'pnp', kind: 'dm', name: '', members: ['u-dewi', 'u-rizky'], clientId: 'c-kopikita', guests: [{ email: 'nadia@kopikita.co.id', name: 'Nadia Putri', status: 'joined', invitedBy: 'u-dewi', at: now() }] };
  const notAllowed = await dewi.sync('channels', [gg]);
  check(!doc('channels', 'gdm-guest') && /Lead/.test(notAllowed.why ?? ''), 'a member who may not invite guests can’t message one (and is told why)');
  put('workspaces', { ...doc('workspaces', 'pnp'), permissions: { ...(pnp.permissions ?? {}), inviteGuests: true } });
  const pending = await dewi.sync('channels', [{ ...gg, guests: [{ email: 'bagus@kopikita.co.id', name: 'Bagus', status: 'joined', invitedBy: 'u-dewi', at: now() }] }]);
  check(!doc('channels', 'gdm-guest') && /joined/.test(pending.why ?? ''), 'a guest who hasn’t joined the project yet is refused');
  await dewi.sync('channels', [{ ...gg, clientId: 'c-lumina' }]);
  check(!doc('channels', 'gdm-guest'), 'a guest from another project is refused');
  await dewi.sync('channels', [gg]);
  check(doc('channels', 'gdm-guest')?.guests?.[0]?.email === 'nadia@kopikita.co.id' && doc('channels', 'gdm-guest').clientId === 'c-kopikita', 'allowed to invite guests: a group message with a guest who joined the project');
  const ns = await nadia.state();
  const named = ns.channels.find((c) => c.id === 'gdm-guest');
  check(!!named && named.kind === 'dm' && /Dewi/.test(named.name) && /Rizky/.test(named.name), `the guest sees it, named after its people (${named?.name})`);
  check(!ns.channels.some((c) => c.id === 'gdm-1' || c.id === 'gdm-2'), 'and none of the team’s other group messages');
  const gw = await nadia.sync('messages', [{ id: 'gm-guest', channelId: 'gdm-guest', userId: 'guest', guestEmail: 'nadia@kopikita.co.id', text: 'Hi both', at: now() }]);
  check(gw.saved === 1 && !!doc('messages', 'gm-guest'), 'the guest writes in it');
  await nadia.sync('messages', [{ id: 'gm-guest-2', channelId: 'gdm-1', userId: 'guest', guestEmail: 'nadia@kopikita.co.id', text: 'sneak', at: now() }]);
  check(!doc('messages', 'gm-guest-2'), 'but not in a group message she isn’t in');

  /* follow choices */
  put('channels', { id: 'ch-follow', workspaceId: 'pnp', kind: 'channel', name: 'follow', members: ['u-aqeel', 'u-dewi', 'u-rizky'] });
  put('messages', { id: 'fm-root', channelId: 'ch-follow', userId: 'u-aqeel', text: 'Root', at: now(), follow: { 'u-aqeel': false } });
  await dewi.sync('messages', [{ ...doc('messages', 'fm-root'), text: 'changed', follow: { 'u-aqeel': true, 'u-dewi': true, 'u-rizky': false } }]);
  const fm = doc('messages', 'fm-root');
  check(fm.text === 'Root' && JSON.stringify(fm.follow) === JSON.stringify({ 'u-aqeel': false, 'u-dewi': true }), 'someone follows another person’s thread: only their own choice changes');
  await aqeel.sync('messages', [{ ...doc('messages', 'fm-root'), follow: { 'u-dewi': false } }]);
  check(JSON.stringify(doc('messages', 'fm-root').follow) === JSON.stringify({ 'u-dewi': true }), 'even its author changes only their own (clearing it)');
  await rizky.sync('messages', [{ id: 'fm-new', channelId: 'ch-follow', userId: 'u-rizky', text: 'new', at: now(), follow: { 'u-aqeel': true, 'u-rizky': true } }]);
  check(JSON.stringify(doc('messages', 'fm-new')?.follow) === JSON.stringify({ 'u-rizky': true }), 'a new message carries only its author’s choice');
} catch (e) {
  failed++;
  console.log(`FAIL ${e instanceof Error ? e.stack : e}`);
}
console.log(failed ? `\n${failed} failed` : '\nAll chat checks passed.');
finish(failed ? 1 : 0);
