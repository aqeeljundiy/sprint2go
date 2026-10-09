// Imports (Slack, Trello, Google Drive), end to end, on a throwaway server (a temporary data folder, free ports, no
// mail) with the small exports in scripts/fixtures. Real people sign in and check on the server that
//  1. only owners and admins can import; members, guests and other companies can't even see an import
//  2. imports are refused in the demo company, and nothing is uploaded there
//  3. Slack: channels, private channels and direct messages, messages with authors, times, threads and reactions,
//     files fetched when their links work and listed when they don't, people matched by email, invited, mapped or
//     kept as names (and Free's 5 people respected)
//  4. Trello: a project, lists mapped to the company's stages, cards as tasks with notes, labels, due dates,
//     checklists, comments with their authors and members matched by name; archived cards stay out
//  5. Google Drive (Takeout): folders and files under "Google Drive import", storage checked, big files asked about
//  6. Undo removes exactly what an import made (and what was added inside it since), for 24 hours, once
//  7. limits: upload size, files in a zip, total unpacked size, zip bombs, and paths that point outside the zip
//   node scripts/import-tests.mjs
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeZip, malicious, slackZip, takeoutZip } from './fixtures/zip.mjs';

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

// Slack's file links point here: one file is there, any other is gone.
const PLAN = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(2039)]);
const files = httpServer((req, res) => {
  if (req.url?.startsWith('/files/q1-plan.pdf')) return res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': PLAN.length }).end(PLAN);
  res.writeHead(404).end('gone');
});
const filesPort = await freePort();
await new Promise((r) => files.listen(filesPort, '127.0.0.1', r));

const dir = mkdtempSync(join(tmpdir(), 's2g-import-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'development', // so file links may point at this machine (S2G_ALLOW_PRIVATE_FETCH); never on a real server
  S2G_ALLOW_PRIVATE_FETCH: '1',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  MAIL_ENABLED: '0',
  S2G_IMPORT_MAX_MB: '1',
  S2G_IMPORT_MAX_JSON_MB: '1',
  S2G_IMPORT_MAX_UNZIPPED_MB: '5',
  S2G_IMPORT_MAX_FILES: '200',
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
  files.close();
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

try {
  for (let i = 0; i < 300; i++) {
    if (server.exitCode !== null) break;
    if (
      await fetch(`${base}/api/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await sleep(100);
  }
  check(
    await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    ),
    'the server starts',
  );

  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const now = () => new Date().toISOString();
  const put = (coll, d) =>
    db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const all = (coll) =>
    db
      .prepare('SELECT data FROM docs WHERE coll = ?')
      .all(coll)
      .map((r) => JSON.parse(r.data));
  const password = randomBytes(9).toString('hex');
  const hash = () => {
    const salt = randomBytes(16);
    return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
  };
  const person = (id, name, email, extra = {}) => {
    put('users', { id, name, email, title: '', color: '#5b5bf6', ...extra });
    db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?)').run(id, email, hash());
  };
  person('u-alice', 'Alice Martin', 'alice@acme.test');
  person('u-bob', 'Bob Stone', 'bob@acme.test');
  person('u-carol', 'Carol Admin', 'carol@acme.test');
  person('u-gina', 'Gina Guest', 'gina@client.test', { clientOf: { workspaceId: 'w-acme', clientId: 'c-acme' } });
  person('u-zed', 'Zed Owner', 'zed@zed.test');
  // Acme asks before saving files over 10 KB (a tiny size, so the fixture's 20 KB video counts as big).
  put('workspaces', {
    id: 'w-acme',
    name: 'Acme',
    color: '#0ea5e9',
    domains: ['acme.test'],
    accounts: [],
    members: [
      { userId: 'u-alice', role: 'owner' },
      { userId: 'u-bob', role: 'member' },
      { userId: 'u-carol', role: 'admin' },
    ],
    storage: { askOver: 0.01 },
    timeZone: 'Asia/Jakarta',
    createdAt: now(),
  });
  // Zed's company is on Free with its 5 people already.
  put('workspaces', {
    id: 'w-zed',
    name: 'Zed',
    color: '#111111',
    domains: ['zed.test'],
    accounts: [],
    members: [{ userId: 'u-zed', role: 'owner' }, ...[1, 2, 3, 4].map((n) => ({ userId: `u-z${n}`, role: 'member' }))],
    plan: { track: 'own', tier: 'free', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: 'Zed', emails: [] }, since: now() },
    createdAt: now(),
  });
  for (const n of [1, 2, 3, 4]) put('users', { id: `u-z${n}`, name: `Zed Person ${n}`, email: `z${n}@zed.test`, title: '', color: '#111' });
  put('clients', {
    id: 'c-acme',
    workspaceId: 'w-acme',
    name: 'Client Co',
    color: '#111',
    status: 'active',
    ownerId: 'u-alice',
    people: [{ email: 'gina@client.test', name: 'Gina Guest', role: 'approver', status: 'joined', invitedBy: 'u-alice', at: now() }],
  });
  put('channels', { id: 'ch-acme-general', workspaceId: 'w-acme', kind: 'channel', name: 'general', members: ['u-alice', 'u-bob', 'u-carol'], topic: 'Everyone at Acme' });
  put('messages', { id: 'm-before', channelId: 'ch-acme-general', userId: 'u-bob', text: 'Already here before the import', at: now() });

  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body, headers = {}) =>
      fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie, ...headers },
        body: body === undefined ? undefined : Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body),
      });
    const j = async (method, path, body, headers) => {
      const res = await call(method, path, body, headers);
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return {
      ok: r.ok,
      call,
      j,
      upload: (ws, source, data, name = 'export.zip') => j('POST', `/api/import/upload?workspaceId=${ws}&source=${source}`, data, { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) }),
    };
  };
  const alice = await signIn('alice@acme.test');
  const bob = await signIn('bob@acme.test');
  const carol = await signIn('carol@acme.test');
  const gina = await signIn('gina@client.test');
  const zed = await signIn('zed@zed.test');
  check(alice.ok && bob.ok && carol.ok && gina.ok && zed.ok, 'everyone signs in');

  /** Waits while an import reads or runs, then returns it. */
  const settle = async (who, id) => {
    for (let i = 0; i < 200; i++) {
      const r = await who.j('GET', `/api/import/${id}`);
      if (!['reading', 'running'].includes(r.body.job?.status)) return r.body.job;
      await sleep(100);
    }
    return null;
  };
  const uploadsLeft = () => (existsSync(join(dir, 'imports')) ? readdirSync(join(dir, 'imports')).length : 0);

  /* ---------- 1. who may import ---------- */
  const SLACK = slackZip(`http://127.0.0.1:${filesPort}`);
  check((await bob.j('GET', '/api/import?workspaceId=w-acme')).status === 403, 'a member can’t see the company’s imports');
  check((await bob.upload('w-acme', 'slack', SLACK)).status === 403, 'a member can’t upload an import');
  check((await gina.upload('w-acme', 'slack', SLACK)).status === 404, 'a guest can’t import into the company');
  check((await zed.upload('w-acme', 'slack', SLACK)).status === 404, 'someone from another company can’t import into it');
  check((await alice.upload('w-acme', 'notion', SLACK)).status === 400, 'only Slack, Trello and Google Drive are taken');
  check((await alice.j('GET', '/api/import?workspaceId=w-acme')).status === 200, 'an owner sees the company’s imports');

  /* ---------- 2. never in the demo company ---------- */
  const demo = await alice.j('POST', '/api/sandbox', { tz: 'Asia/Jakarta' });
  check(demo.status === 200 && demo.body.workspaceId === 'demo-u-alice', 'the owner opens their demo company');
  const inDemo = await alice.upload('demo-u-alice', 'slack', SLACK);
  check(inDemo.status === 403 && /demo company/.test(inDemo.body.error), 'an import into the demo company is refused');
  check(db.prepare("SELECT COUNT(*) AS n FROM imports WHERE workspace_id LIKE 'demo-%'").get().n === 0 && uploadsLeft() === 0, 'nothing of it was kept on the server');

  /* ---------- 3. Slack ---------- */
  const up = await alice.upload('w-acme', 'slack', SLACK, 'Acme Slack export.zip');
  check(up.status === 200 && up.body.job?.status === 'reading', 'a Slack export uploads and is read in the background');
  const ready = await settle(alice, up.body.job.id);
  check(ready?.status === 'ready', `the Slack preview is ready${ready?.error ? `: ${ready.error}` : ''}`);
  const pv = ready.preview;
  const chan = (name) => pv.channels.find((c) => c.name === name);
  check(
    pv.channels.length === 4 && chan('general')?.into === 'ch-acme-general' && chan('design')?.messages === 1 && chan('leadership')?.kind === 'private' && pv.channels.some((c) => c.kind === 'dm'),
    'channels, a private channel and a direct message; #general goes into the one here',
  );
  check(chan('general')?.messages === 8, 'joins and leaves aren’t counted as messages');
  const p = (name) => pv.people.find((x) => x.name === name);
  check(p('Alice Martin')?.match === 'u-alice' && p('Alice Martin')?.how === 'email' && p('Bob Stone')?.match === 'u-bob', 'people here are matched by email');
  check(
    p('Dana Field')?.suggested === 'invite' && p('Dana Field')?.canInvite && p('Evan Old')?.gone && p('Evan Old')?.suggested === 'former',
    'someone new is suggested for an invite, a deactivated account is kept as a name',
  );
  check(!p('Quiet Person') && !pv.people.some((x) => /bot/i.test(x.name)), 'people who aren’t in any of it, and bots, aren’t listed');
  check(pv.files?.linked === 2 && pv.files?.notInExport === 1, 'the preview counts files with links and files not in the export');
  // Zed's company is on Free and full: an invite doesn't fit.
  const zup = await zed.upload('w-zed', 'slack', SLACK);
  const zready = await settle(zed, zup.body.job.id);
  check(zready?.preview?.seatsLeft === 0 && zready.preview.people.every((x) => x.suggested !== 'invite'), 'on a full Free plan nobody is suggested for an invite');
  const zstart = await zed.j('POST', `/api/import/${zup.body.job.id}/start`, { choices: { people: { U03DANA: { action: 'invite' } } } });
  check(zstart.status === 400 && /Free covers 5 people/.test(zstart.body.error), 'inviting past Free’s 5 people is refused');
  check((await zed.j('POST', `/api/import/${zup.body.job.id}/cancel`)).status === 200, 'a waiting import can be cancelled');

  check((await bob.j('POST', `/api/import/${up.body.job.id}/start`, { choices: { people: {} } })).status === 403, 'a member can’t start it');
  const badMap = await alice.j('POST', `/api/import/${up.body.job.id}/start`, { choices: { people: { U05FAY: { action: 'map', userId: 'u-zed' } } } });
  check(badMap.status === 400, 'mapping someone to a person outside the company is refused');
  const start = await alice.j('POST', `/api/import/${up.body.job.id}/start`, { choices: { people: { U03DANA: { action: 'invite' }, U04EVAN: { action: 'former' }, U05FAY: { action: 'map', userId: 'u-carol' } } } });
  check(start.status === 200 && start.body.job.status === 'running', 'the Slack import starts');
  const done = await settle(alice, up.body.job.id);
  check(done?.status === 'done', `the Slack import finishes${done?.error ? `: ${done.error}` : ''}`);
  const ws = doc('workspaces', 'w-acme');
  const dana = all('users').find((u) => u.email === 'dana@elsewhere.test');
  check(!!dana && ws.members.some((m) => m.userId === dana.id && m.role === 'member') && !!db.prepare('SELECT 1 FROM invites WHERE user_id = ?').get(dana.id), 'Dana joins as a member with an invite link');
  check(
    done.summary.invited.some((x) => x.email === 'dana@elsewhere.test' && /^\/\?invite=/.test(x.link)),
    'the summary has her invite link to copy',
  );
  const chans = all('channels').filter((c) => c.workspaceId === 'w-acme');
  const design = chans.find((c) => c.name === 'design');
  const lead = chans.find((c) => c.name === 'leadership');
  const dm = chans.find((c) => c.kind === 'dm');
  check(chans.filter((c) => c.name === 'general').length === 1, '#general wasn’t made twice');
  check(!!design && design.members.includes('u-bob') && design.members.includes(dana.id) && design.topic === 'Mockups, and links for #general', '#design is made with its people and purpose');
  check(!!lead && lead.private === true && lead.members.join() === 'u-alice', '#leadership stays private to its people');
  check(!!dm && dm.members.includes('u-bob') && dm.members.includes(dana.id), 'the direct message is between Bob and Dana');
  const msgs = all('messages').filter((m) => m.channelId === 'ch-acme-general');
  const welcome = msgs.find((m) => m.text.startsWith('Welcome @'));
  check(
    welcome?.userId === 'u-alice' && welcome.text === 'Welcome @Dana! Read the handbook (https://acme.test/handbook) & say hi in #design' && welcome.at === '2026-01-05T09:00:00.000Z',
    'a message keeps its author, time and text (mentions, links and channels as plain text)',
  );
  check(
    welcome?.reactions?.['👍']?.includes('u-bob') && welcome.reactions['👍'].includes(dana.id) && welcome.reactions['🎉']?.[0] === 'former:U04EVAN' && welcome.reactions[':partyparrot:']?.[0] === 'u-alice',
    'reactions keep who reacted (custom emoji by name)',
  );
  const reply = msgs.find((m) => m.text === 'Thanks, glad to be here');
  const broadcast = msgs.find((m) => m.text === 'Welcome aboard from me too');
  check(reply?.parentId === welcome?.id && reply.userId === dana.id && !reply.alsoInChannel, 'a thread reply stays in its thread');
  check(
    broadcast?.parentId === welcome?.id && broadcast.alsoInChannel === true && broadcast.userId === 'former:U04EVAN' && broadcast.authorName === 'Evan Old',
    'a reply also sent to the channel shows there, by a former member’s name',
  );
  const planMsg = msgs.find((m) => m.text === 'Here is the Q1 plan');
  const planUrl = planMsg?.files?.[0]?.url;
  const got = planUrl ? await alice.call('GET', planUrl) : null;
  check(!!got && got.status === 200 && Buffer.from(await got.arrayBuffer()).equals(PLAN), 'a file whose link works is fetched and opens');
  const planDrive = planMsg?.files?.[0]?.driveId ? doc('drive', planMsg.files[0].driveId) : null;
  check(planDrive?.channelId === 'ch-acme-general' && planDrive.url === planUrl && planDrive.uploadedBy === 'u-bob', 'a file from a public channel is in Drive too, with its channel');
  const shot = msgs.find((m) => m.text === 'Old screenshot');
  check(shot?.userId === 'u-carol' && shot.files?.[0]?.missing === 'not in the export' && !shot.files[0].url, 'Fay’s message is Carol’s (mapped); her file isn’t in the export');
  const gone = all('messages').find((m) => m.text === 'This one is gone from Slack');
  check(/couldn’t be fetched/.test(gone?.files?.[0]?.missing ?? ''), 'a file whose link is dead is marked');
  check(
    msgs.some((m) => m.text === 'Deployed v2.1 to production' && m.authorName === 'Deploy Bot'),
    'a bot’s message keeps the bot’s name',
  );
  check(
    msgs.some((m) => m.text === 'Ping @here about the ops@acme.test list' && m.edited === true),
    '@here and email links read plainly; edited stays edited',
  );
  check(
    done.summary.missing.some((x) => x.name === 'screenshot.png' && x.why === 'not in the export') && done.summary.missing.some((x) => x.name === 'gone.docx' && /couldn’t be fetched/.test(x.why)),
    'the summary lists the files it couldn’t bring',
  );
  check(
    all('notices').some((n) => n.userId === 'u-alice' && /Slack import is done/.test(n.text) && n.link?.id === 'import'),
    'the importer is told when it’s done',
  );
  check(all('messages').filter((m) => m.channelId === lead?.id).length === 1 && all('messages').filter((m) => m.channelId === dm?.id).length === 2, 'private and direct messages came in');
  check(uploadsLeft() === 0, 'the upload is gone once it’s done');

  /* ---------- 6. Undo (Slack) ---------- */
  await bob.j('POST', '/api/sync', { coll: 'messages', upserts: [{ id: 'm-after', channelId: design.id, userId: 'u-bob', text: 'Added after the import', at: now() }], deletes: [] });
  check(!!doc('messages', 'm-after'), 'Bob adds a message to an imported channel');
  check((await alice.j('GET', `/api/import/${up.body.job.id}/undo`)).body.since === 1, 'Undo says what was added since inside what it made');
  check((await bob.j('POST', `/api/import/${up.body.job.id}/undo`)).status === 403, 'a member can’t undo it');
  const planFile = planUrl.split('/').pop();
  const undone = await alice.j('POST', `/api/import/${up.body.job.id}/undo`);
  check(undone.status === 200 && undone.body.job.status === 'undone', 'Undo works');
  const left = all('messages').filter((m) => m.channelId === 'ch-acme-general');
  check(left.length === 1 && left[0].id === 'm-before', 'only #general’s own messages are left');
  check(
    !all('channels').some((c) => c.workspaceId === 'w-acme' && (['design', 'leadership'].includes(c.name) || c.kind === 'dm')) && !doc('messages', 'm-after'),
    'the channels it made are gone, with what was added since',
  );
  check(!db.prepare('SELECT 1 FROM files WHERE id = ?').get(planFile) && !existsSync(join(dir, 'files', planFile)) && !doc('drive', planDrive?.id ?? ''), 'the fetched file is gone, from Drive and from disk too');
  check(
    !doc('workspaces', 'w-acme').members.some((m) => m.userId === dana.id) && !doc('users', dana.id) && !db.prepare('SELECT 1 FROM invites WHERE user_id = ?').get(dana.id),
    'Dana, who never signed in, is gone with her invite link',
  );
  check(!!doc('channels', 'ch-acme-general') && doc('workspaces', 'w-acme').members.length === 3, 'what was there before stays');
  check((await alice.j('POST', `/api/import/${up.body.job.id}/undo`)).status === 409, 'it can’t be undone twice');

  /* ---------- 4. Trello ---------- */
  const board = readFileSync(join(ROOT, 'scripts/fixtures/trello-board.json'));
  const tup = await alice.upload('w-acme', 'trello', board, 'website.json');
  const tready = await settle(alice, tup.body.job.id);
  check(tready?.status === 'ready', `the Trello preview is ready${tready?.error ? `: ${tready.error}` : ''}`);
  const tp = tready.preview;
  const list = (name) => tp.lists.find((l) => l.name === name);
  check(
    list('To Do')?.suggested === 'todo' && list('Doing')?.suggested === 'doing' && list('Waiting on client')?.suggested === 'waiting' && list('Shipped')?.suggested === 'done' && list('Old ideas')?.archived,
    'lists get the company’s stages by their names',
  );
  check(tp.board.cards === 5 && tp.board.archivedCards === 2 && tp.board.comments === 3, 'the board’s cards, archived cards and comments are counted');
  const tperson = (name) => tp.people.find((x) => x.name === name);
  check(tperson('Alice Martin')?.match === 'u-alice' && tperson('Alice Martin')?.how === 'name' && tperson('Carol Admin')?.match === 'u-carol', 'Trello members are matched by name');
  check(tperson('Quinn Ray')?.suggested === 'former' && !tperson('Quinn Ray')?.canInvite && !!tperson('Former Freelancer'), 'someone not here (no email in Trello) stays a name');
  const tstart = await alice.j('POST', `/api/import/${tup.body.job.id}/start`, { choices: { people: {}, stages: { '66f9e0000000000000000102': 'review' } } });
  check(tstart.status === 200, 'the Trello import starts');
  const tdone = await settle(alice, tup.body.job.id);
  check(tdone?.status === 'done', `the Trello import finishes${tdone?.error ? `: ${tdone.error}` : ''}`);
  const project = all('clients').find((c) => c.name === 'Website relaunch');
  check(!!project && project.ownerId === 'u-alice' && project.members?.map((m) => m.userId).join() === 'u-carol', 'the board becomes a project with its people on it');
  const tasks = all('todos').filter((t) => t.clientId === project?.id);
  const task = (title) => tasks.find((t) => t.title === title);
  check(tasks.length === 5 && !task('Archived card') && !task('Idea in an archived list'), 'cards become tasks; archived ones stay out');
  const copy = task('Write homepage copy');
  check(copy?.status === 'todo' && copy.done === false && copy.due === '2026-11-02' && copy.priority === 'high' && copy.source === 'import', 'a card keeps its stage, due date (in the company’s time zone) and urgency');
  check(
    /Hero, about and pricing/.test(copy?.notes ?? '') &&
      /Labels: Urgent, green label/.test(copy.notes) &&
      /On this card in Trello: Quinn Ray/.test(copy.notes) &&
      /- Brief: https:\/\/docs\.example\.test\/brief/.test(copy.notes),
    'its description, labels, people not here and attachment links are in the notes',
  );
  check(copy?.checklist?.length === 3 && copy.checklist[0].text === 'Sections: Hero' && copy.checklist[0].done && !copy.checklist[2].done, 'its checklists are checklist items');
  const comments = copy?.history?.filter((h) => h.kind === 'comment') ?? [];
  check(
    comments.length === 2 && comments[0].byName === 'Quinn Ray' && /^former:/.test(comments[0].by) && comments[1].by === 'u-alice' && comments[0].at === '2026-10-01T04:00:00.000Z',
    'comments keep their authors and times',
  );
  check(copy?.assignees?.join() === 'u-alice' && copy.userId === 'u-alice' && copy.createdAt === '2026-09-30T02:00:00.000Z', 'members on a card are doing it; it keeps when it was made');
  check(task('Design mockups')?.status === 'review' && task('Design mockups')?.assignees?.join() === 'u-carol', 'a list mapped to another stage goes there');
  check(task('Set up analytics')?.done === true && task('Set up analytics')?.status === 'done', 'a card marked complete is done');
  check(task('Logo sign-off')?.status === 'waiting' && task('Kick-off call')?.done === true, 'waiting and finished lists land in waiting and done');
  check(
    task('Design mockups')?.history?.some((h) => h.byName === 'Former Freelancer'),
    'a comment by someone who left Trello keeps their name',
  );
  check((await bob.j('GET', `/api/import/${tup.body.job.id}`)).status === 403, 'a member can’t open an import');

  /* ---------- 5. Google Drive (Takeout) ---------- */
  const TAKEOUT = takeoutZip();
  const dup = await alice.upload('w-acme', 'drive', TAKEOUT, 'takeout-001.zip');
  const dready = await settle(alice, dup.body.job.id);
  check(dready?.status === 'ready', `the Takeout preview is ready${dready?.error ? `: ${dready.error}` : ''}`);
  const dp = dready.preview.drive;
  check(dp.files === 5 && dp.folders === 4 && dp.big === 1 && dp.otherParts.join() === 'Mail' && dp.into === 'new', 'Drive’s files and folders are counted, the big one is asked about, other Takeout parts are named');
  // Fill the company's storage to 10 KB short of full: the files don't fit.
  const room = (await alice.j('GET', '/api/storage?workspaceId=w-acme')).body;
  db.prepare('INSERT INTO files (id, workspace_id, uploaded_by, name, type, size, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'f'.repeat(32),
    'w-acme',
    'u-alice',
    'filler',
    'application/octet-stream',
    room.left - 10_000,
    now(),
  );
  const full = await alice.j('POST', `/api/import/${dup.body.job.id}/start`, { choices: { people: {}, big: true } });
  check(full.status === 400 && /doesn’t fit/.test(full.body.error), 'an import that doesn’t fit in the company’s storage is refused');
  db.prepare('DELETE FROM files WHERE id = ?').run('f'.repeat(32));
  check((await alice.j('POST', `/api/import/${dup.body.job.id}/start`, { choices: { people: {}, big: false } })).status === 200, 'with room, it starts (big files left out)');
  const ddone = await settle(alice, dup.body.job.id);
  check(ddone?.status === 'done', `the Drive import finishes${ddone?.error ? `: ${ddone.error}` : ''}`);
  const drive = all('drive').filter((d) => d.workspaceId === 'w-acme');
  const root = drive.find((d) => d.name === 'Google Drive import' && d.parentId === null);
  const plans = drive.find((d) => d.name === 'Plans' && d.parentId === root?.id);
  const notes = drive.find((d) => d.name === 'notes.txt');
  check(
    !!root && !!plans && drive.some((d) => d.name === 'Empty folder' && d.parentId === root.id) && drive.some((d) => d.name === 'Budget 2027.csv' && d.parentId === plans.id && d.kind === 'sheet'),
    'folders and files keep their places under Google Drive import',
  );
  check(notes?.parentId === root?.id && notes.modified === '2026-10-01T09:30:00.000Z', 'a file keeps when it was changed');
  const notesRes = notes?.url ? await alice.call('GET', notes.url) : null;
  check(!!notesRes && (await notesRes.text()) === readFileSync(join(ROOT, 'scripts/fixtures/takeout/Takeout/Drive/notes.txt'), 'utf8'), 'a file opens with what it had');
  check(!drive.some((d) => d.name === 'Launch video.mp4') && ddone.summary.missing.some((x) => x.name === 'Launch video.mp4' && /left out/.test(x.why)), 'the big file stayed out, and the summary says so');
  check(!drive.some((d) => d.name === 'README.txt' || d.name === 'archive_browser.html'), 'nothing outside Drive came in');
  // A second part of the same Takeout goes into the same folder; undoing it leaves the first part.
  const dup2 = await alice.upload('w-acme', 'drive', TAKEOUT, 'takeout-002.zip');
  const dready2 = await settle(alice, dup2.body.job.id);
  check(dready2?.preview?.drive?.into === 'existing', 'a second Takeout part goes into the same folder');
  await alice.j('POST', `/api/import/${dup2.body.job.id}/start`, { choices: { people: {}, big: true } });
  const ddone2 = await settle(alice, dup2.body.job.id);
  check(ddone2?.status === 'done' && all('drive').filter((d) => d.name === 'Google Drive import').length === 1, 'no second Google Drive import folder is made');
  const video = all('drive').find((d) => d.name === 'Launch video.mp4');
  check(!!video, 'the big file comes in when the admin says so');
  await alice.j('POST', `/api/import/${dup2.body.job.id}/undo`);
  check(!all('drive').some((d) => d.name === 'Launch video.mp4') && !!doc('drive', root.id) && !!doc('drive', notes.id), 'undoing the second part leaves the first');

  /* ---------- 7. limits and broken or hostile files ---------- */
  const tooBig = await alice.upload('w-acme', 'drive', randomBytes(1.5 * 1024 * 1024));
  check(tooBig.status === 413, 'an upload over the size limit is refused');
  const tooBigJson = await alice.upload('w-acme', 'trello', Buffer.from(`{"lists":[],"cards":[],"x":"${'a'.repeat(1.2 * 1024 * 1024)}"}`), 'big.json');
  check(tooBigJson.status === 413, 'a Trello board over its size limit is refused');
  const refused = async (what, data, source = 'drive', match) => {
    const r = await alice.upload('w-acme', source, data, `${what}.zip`);
    const job = r.status === 200 ? await settle(alice, r.body.job.id) : null;
    check(job?.status === 'failed' && match.test(job.error ?? ''), `${what}: refused (${job?.error ?? r.body.error})`);
  };
  const driveBefore = all('drive').length;
  await refused('a path that climbs out with ..', malicious.traversal(), 'drive', /points outside it/);
  await refused('an absolute path', malicious.absolute(), 'drive', /points outside it/);
  await refused('a Windows path', malicious.windows(), 'drive', /points outside it/);
  await refused('a .. hidden in the middle', malicious.hidden(), 'slack', /points outside it/);
  await refused('a zip over the unpacked limit', malicious.huge(), 'drive', /over 5 MB/);
  await refused('a zip with too many files', malicious.many(201), 'drive', /at most 200/);
  await refused('a Trello file that’s a zip', SLACK, 'trello', /That’s a zip file/);
  await refused('a Slack import that isn’t a zip', board, 'slack', /isn’t a zip file/);
  await refused('a Takeout without Drive in it', makeZip([{ name: 'Takeout/Mail/All mail.mbox', data: 'From x' }]), 'drive', /no Drive in it/);
  check(all('drive').length === driveBefore && uploadsLeft() === 0, 'none of them made anything or left an upload behind');
  // A zip bomb: says 1 KB, unpacks to 20 MB. It stops at 1 KB and the import stops; Undo takes what came before it.
  const bomb = await alice.upload('w-acme', 'drive', malicious.bomb(), 'bomb.zip');
  const bready = await settle(alice, bomb.body.job.id);
  check(bready?.status === 'ready', 'a zip bomb that lies about its size reads like any zip');
  await alice.j('POST', `/api/import/${bomb.body.job.id}/start`, { choices: { people: {}, big: true } });
  const bdone = await settle(alice, bomb.body.job.id);
  check(bdone?.status === 'failed' && /bigger than this zip says/.test(bdone.error ?? ''), 'unpacking stops at the size it claimed, and the import stops');
  const filesNow = readdirSync(join(dir, 'files'));
  check(
    filesNow.every((f) => readFileSync(join(dir, 'files', f)).length < 2 * 1024 * 1024),
    'nothing near 20 MB was written',
  );
  check(all('drive').some((d) => d.name === 'readme.txt' && d.url) && bdone.summary?.made?.some((m) => m.what === 'files' && m.n === 1), 'what it saved before the bomb is in Drive and in the summary, nothing half made');
  check(!!bdone.undoUntil && (await alice.j('POST', `/api/import/${bomb.body.job.id}/undo`)).status === 200 && !all('drive').some((d) => d.name === 'readme.txt'), 'what it made before stopping can be undone');
  // Another company's import stays theirs.
  check((await zed.j('GET', `/api/import/${tup.body.job.id}`)).status === 404, 'another company can’t open this import');
  const listed = (await alice.j('GET', '/api/import?workspaceId=w-acme')).body.jobs ?? [];
  check(listed.length >= 4 && listed.every((j) => j.workspaceId === 'w-acme'), 'the company’s imports are listed for its admins');
} catch (e) {
  console.log('FAIL', e instanceof Error ? e.stack : e);
  failed++;
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll import checks passed');
finish(failed ? 1 : 0);
