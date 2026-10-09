// The sprint2go connector (server/connector.ts, server/oauth.ts, server/mcpTools.ts), end to end, on a
// production-like server (no demo data, a throwaway data folder, free ports, no mail). Checks that
//  1. AI apps find the sign-in (/.well-known), register themselves and sign in with OAuth and PKCE (S256 only),
//     through the official MCP SDK client over Streamable HTTP, with a person who signs in with their password
//  2. every tool answers, and each sees exactly what that person sees: not someone else's mail, not a project they
//     aren't on, nothing from a company where they're only a guest, nothing for guests themselves
//  3. changes go through the app's own rules, carry "via <app>" in the audit log, and anything that would leave the
//     company (mail, messages to guests) is only a draft
//  4. the company switch, Disconnect, revocation, expired, wrong and reused tokens and codes, and rate limits
//  5. the demo company works too, and nothing of it reaches the real documents
// Claude itself can't reach a local server, so the SDK's client stands in for it.
//   node scripts/mcp-tests.mjs
import { spawn } from 'node:child_process';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

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

const dir = mkdtempSync(join(tmpdir(), 's2g-mcp-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
const base = `http://127.0.0.1:${httpPort}`;
const env = {
  PATH: process.env.PATH,
  NODE_ENV: 'production',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  MAIL_ENABLED: '0',
  PUBLIC_URL: base,
  SUPPORT_EMAIL: 'support@s2g-check.test',
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
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 180_000).unref();

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha = (s) => createHash('sha256').update(s).digest('base64url');

try {
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) break;
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await sleep(100);
  }
  const up = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
  check(up, 'the server starts (production, no demo data)');
  if (!up) throw new Error('the server didn’t start');

  /* ---------- the people and their work, straight into the database ---------- */
  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const now = () => new Date().toISOString();
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const put = (coll, d) => db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data').run(coll, d.id, JSON.stringify(d), now());
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
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
  person('u-carol', 'Carol Reed', 'carol@acme.test');
  person('u-gina', 'Gina Guest', 'gina@client.test', { clientOf: { workspaceId: 'w-acme', clientId: 'c-open' } });
  person('u-dan', 'Dan Other', 'dan@other.test');
  person('u-erin', 'Erin Strict', 'erin@strict.test');
  put('workspaces', {
    id: 'w-acme',
    name: 'Acme',
    color: '#0ea5e9',
    domains: ['acme.test'],
    timeZone: 'Asia/Jakarta',
    accounts: [
      { id: 'a-alice', email: 'alice@acme.test', name: 'Alice Martin', kind: 'personal', connected: true, users: ['u-alice'] },
      { id: 'a-bob', email: 'bob@acme.test', name: 'Bob Stone', kind: 'personal', connected: true, users: ['u-bob'] },
      { id: 'a-hello', email: 'hello@acme.test', name: 'Acme', kind: 'shared', connected: true, users: ['u-alice', 'u-bob'] },
    ],
    members: [
      { userId: 'u-alice', role: 'owner' },
      { userId: 'u-bob', role: 'member' },
      { userId: 'u-carol', role: 'member' },
    ],
    createdAt: now(),
  });
  put('workspaces', { id: 'w-other', name: 'Other Co', color: '#111', domains: ['other.test'], accounts: [], members: [{ userId: 'u-dan', role: 'owner' }], createdAt: now() });
  put('workspaces', { id: 'w-strict', name: 'Strict Co', color: '#222', domains: ['strict.test'], accounts: [], members: [{ userId: 'u-erin', role: 'owner' }], security: { twoStep: true, graceDays: 0, twoStepSince: '2026-01-01T00:00:00.000Z' }, createdAt: now() });
  // Projects: Bob is on "Open", not on "Secret" (members don't see every project by default).
  put('clients', { id: 'c-open', workspaceId: 'w-acme', name: 'Open Project', color: '#10b981', status: 'active', ownerId: 'u-alice', domain: 'client.test', members: [{ userId: 'u-bob', role: 'member', addedBy: 'u-alice', at: now() }], people: [{ email: 'gina@client.test', name: 'Gina Guest', role: 'approver', status: 'joined', invitedBy: 'u-alice', at: now() }] });
  put('clients', { id: 'c-secret', workspaceId: 'w-acme', name: 'Secret Project', color: '#ef4444', status: 'active', ownerId: 'u-alice', members: [] });
  // Alice is a guest of a project at another company: none of it may show in Acme's connection.
  put('clients', { id: 'c-other', workspaceId: 'w-other', name: 'Partner Launch', color: '#999', status: 'active', ownerId: 'u-dan', people: [{ email: 'alice@acme.test', name: 'Alice Martin', role: 'collaborator', status: 'joined', invitedBy: 'u-dan', at: now() }] });
  put('teams', { id: 't-design', workspaceId: 'w-acme', name: 'Design', color: '#5b5bf6', leadId: 'u-alice', members: ['u-alice', 'u-bob'], review: true });
  put('channels', { id: 'ch-general', workspaceId: 'w-acme', kind: 'channel', name: 'general', members: ['u-alice', 'u-bob', 'u-carol'] });
  put('channels', { id: 'ch-secret', workspaceId: 'w-acme', kind: 'channel', name: 'secret-plans', clientId: 'c-secret', private: true, members: ['u-alice'] });
  put('channels', { id: 'ch-shared', workspaceId: 'w-acme', kind: 'channel', name: 'open-with-client', clientId: 'c-open', category: 'shared', members: ['u-alice', 'u-bob'], guests: [{ email: 'gina@client.test', name: 'Gina Guest', status: 'joined', invitedBy: 'u-alice', at: now() }] });
  put('channels', { id: 'ch-dm', workspaceId: 'w-acme', kind: 'dm', name: '', members: ['u-alice', 'u-bob'] });
  put('channels', { id: 'ch-partner', workspaceId: 'w-other', kind: 'channel', name: 'partner-shared', clientId: 'c-other', category: 'shared', members: ['u-dan'], guests: [{ email: 'alice@acme.test', name: 'Alice Martin', status: 'joined', invitedBy: 'u-dan', at: now() }] });
  put('messages', { id: 'm-1', channelId: 'ch-general', userId: 'u-bob', text: 'Morning all, the banana launch deck is ready', at: new Date(Date.now() - 3600_000).toISOString() });
  put('messages', { id: 'm-2', channelId: 'ch-secret', userId: 'u-alice', text: 'The pineapple acquisition stays between us', at: now() });
  put('messages', { id: 'm-3', channelId: 'ch-shared', userId: 'guest', guestEmail: 'gina@client.test', text: 'Can we see the mango drafts?', at: now() });
  put('messages', { id: 'm-4', channelId: 'ch-partner', userId: 'u-dan', text: 'Partner kiwi timeline', at: now() });
  put('todos', { id: 't-late', workspaceId: 'w-acme', title: 'Fix the banana banner', userId: 'u-bob', assignees: ['u-bob'], due: day(-2), done: false, status: 'todo', priority: 'normal', source: 'manual', createdBy: 'u-alice', supervisorId: 'u-alice', clientId: 'c-open', createdAt: now(), history: [] });
  put('todos', { id: 't-secret', workspaceId: 'w-acme', title: 'Pineapple due diligence', userId: 'u-alice', assignees: ['u-alice'], due: day(3), done: false, status: 'todo', priority: 'high', source: 'manual', createdBy: 'u-alice', clientId: 'c-secret', createdAt: now(), history: [] });
  put('todos', { id: 't-review', workspaceId: 'w-acme', title: 'Mango poster', userId: 'u-bob', assignees: ['u-bob'], done: false, status: 'review', priority: 'normal', source: 'manual', createdBy: 'u-alice', supervisorId: 'u-alice', teamId: 't-design', createdAt: now(), history: [] });
  put('todos', { id: 't-team', workspaceId: 'w-acme', title: 'Banana storyboard', userId: 'u-bob', assignees: ['u-bob'], done: false, status: 'doing', priority: 'normal', source: 'manual', createdBy: 'u-bob', supervisorId: 'u-alice', teamId: 't-design', createdAt: now(), history: [] });
  put('todos', { id: 't-other', workspaceId: 'w-other', title: 'Kiwi partner checklist', userId: 'u-dan', assignees: ['u-dan'], done: false, status: 'todo', priority: 'normal', source: 'manual', createdBy: 'u-dan', clientId: 'c-other', visibleToClient: true, createdAt: now(), history: [] });
  const msg = (id, from, to, body, at, mid) => ({ id, from, to, date: at, body, mid });
  put('threads', { id: 'th-client', accountId: 'a-alice', subject: 'Banana launch dates', location: 'inbox', starred: false, unread: true, labels: [], messages: [msg('tm-1', { name: 'Nadia Client', email: 'nadia@client.test' }, [{ name: 'Alice Martin', email: 'alice@acme.test' }], 'Can we move the banana launch to Friday?', new Date(Date.now() - 7200_000).toISOString(), '<abc@client.test>')] });
  put('threads', { id: 'th-bob', accountId: 'a-bob', subject: 'Bob private papaya', location: 'inbox', starred: false, unread: true, labels: [], messages: [msg('tm-2', { name: 'Bank', email: 'bank@bank.test' }, [{ name: 'Bob Stone', email: 'bob@acme.test' }], 'Your papaya statement', now(), '<p@bank.test>')] });
  put('threads', { id: 'th-hello', accountId: 'a-hello', subject: 'Hello inbox question', location: 'inbox', starred: false, unread: false, labels: [], messages: [msg('tm-3', { name: 'Visitor', email: 'visitor@else.test' }, [{ name: 'Acme', email: 'hello@acme.test' }], 'Do you ship to Bali?', now(), '<v@else.test>')] });
  put('notes', { id: 'n-alice', workspaceId: 'w-acme', title: 'Alice private plum', html: '<p>My <b>plum</b> ideas</p><ul><li>one</li><li>two</li></ul>', ownerId: 'u-alice', visibility: 'private', createdAt: now(), updatedAt: now(), updatedBy: 'u-alice' });
  put('notes', { id: 'n-team', workspaceId: 'w-acme', title: 'Team plum guide', html: '<p>How we work</p>', ownerId: 'u-alice', visibility: 'team', createdAt: now(), updatedAt: now(), updatedBy: 'u-alice' });
  put('notes', { id: 'n-bob', workspaceId: 'w-acme', title: 'Bob private plum', html: '<p>Bob only</p>', ownerId: 'u-bob', visibility: 'private', createdAt: now(), updatedAt: now(), updatedBy: 'u-bob' });
  put('tables', {
    id: 'tb-deals',
    workspaceId: 'w-acme',
    name: 'Deals',
    color: '#5b5bf6',
    fields: [
      { id: 'f-name', name: 'Name', type: 'text' },
      { id: 'f-stage', name: 'Stage', type: 'select', options: [{ id: 'o-lead', label: 'Lead', color: 'gray' }, { id: 'o-won', label: 'Won', color: 'green' }] },
      { id: 'f-owner', name: 'Owner', type: 'person' },
      { id: 'f-value', name: 'Value', type: 'money' },
    ],
    views: [],
    createdBy: 'u-alice',
    createdAt: now(),
  });
  put('tables', { id: 'tb-secret', workspaceId: 'w-acme', clientId: 'c-secret', name: 'Secret numbers', color: '#ef4444', fields: [{ id: 'g-name', name: 'Name', type: 'text' }], views: [], createdBy: 'u-alice', createdAt: now() });
  put('rows', { id: 'r-1', workspaceId: 'w-acme', tableId: 'tb-deals', values: { 'f-name': 'Guava Corp', 'f-stage': 'o-lead', 'f-owner': 'u-bob', 'f-value': 5000 }, order: 1, createdBy: 'u-alice', createdAt: now(), updatedAt: now() });
  put('rows', { id: 'r-secret', workspaceId: 'w-acme', tableId: 'tb-secret', values: { 'g-name': 'Pineapple price' }, order: 1, createdBy: 'u-alice', createdAt: now(), updatedAt: now() });
  const soon = new Date(Date.now() + 20 * 60_000);
  put('events', { id: 'e-standup', title: 'Banana standup', calendarId: 'work', start: soon.toISOString(), end: new Date(soon.getTime() + 30 * 60_000).toISOString(), workspaceId: 'w-acme', userId: 'u-alice', meetUrl: 'https://meet.google.com/abc-defg-hij' });
  put('events', { id: 'e-bob', title: 'Bob dentist', calendarId: 'personal', start: soon.toISOString(), end: new Date(soon.getTime() + 60 * 60_000).toISOString(), workspaceId: 'w-acme', userId: 'u-bob', notes: 'private bit' });

  /* ---------- signing in to the app (cookies), as the consent screen does ---------- */
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
      ok: r.ok && cookie.startsWith('s2g='),
      get: (path) => call('GET', path),
      post: (path, body) => call('POST', path, body),
      json: async (method, path, body) => {
        const x = await call(method, path, body);
        return { status: x.status, ...(await x.json().catch(() => ({}))) };
      },
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
    };
  };
  const alice = await signIn('alice@acme.test');
  const bob = await signIn('bob@acme.test');
  const gina = await signIn('gina@client.test');
  const erin = await signIn('erin@strict.test');
  check(alice.ok && bob.ok && gina.ok && erin.ok, 'people sign in with their passwords: an owner, a member, a guest, someone whose company requires two-step sign-in');

  /* ---------- 1. finding the sign-in ---------- */
  const bare = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const challenge = bare.headers.get('www-authenticate') ?? '';
  check(bare.status === 401 && challenge.includes(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`), '/mcp without a token: 401 that points at the sign-in');
  const prm = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then((r) => r.json());
  check(prm.resource === `${base}/mcp` && prm.authorization_servers?.[0] === base, 'protected resource metadata names /mcp and this server as its sign-in');
  const asm = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
  check(asm.issuer === base && asm.code_challenge_methods_supported?.join() === 'S256' && asm.registration_endpoint === `${base}/oauth/register` && asm.grant_types_supported.includes('refresh_token'), 'authorization server metadata: PKCE with S256 only, registration, refresh tokens');
  const oidc = await fetch(`${base}/.well-known/openid-configuration`);
  check(oidc.status === 404 && (oidc.headers.get('content-type') ?? '').includes('json'), 'other sign-in addresses answer 404, never the app’s page');
  const pre = await fetch(`${base}/oauth/token`, { method: 'OPTIONS', headers: { origin: 'https://inspector.example', 'access-control-request-method': 'POST' } });
  check(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*', 'apps in a browser may call the token endpoint (CORS, no cookies involved)');

  /* ---------- 2. the SDK's own client signs in with OAuth and PKCE ---------- */
  const consentFor = async (who, authUrl, workspaceId, allow = true) => {
    const query = Object.fromEntries(new URL(authUrl).searchParams);
    return who.json('POST', '/api/oauth/consent', { query, workspaceId, allow });
  };
  /** An OAuth client the way an AI app keeps it: registration, verifier and tokens in memory. */
  const provider = (name, redirect = 'http://127.0.0.1:53682/callback') => {
    const s = { info: undefined, tokens: undefined, verifier: '', authUrl: null };
    return {
      s,
      get redirectUrl() {
        return redirect;
      },
      get clientMetadata() {
        return { client_name: name, redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
      },
      state: () => 'st-' + randomBytes(4).toString('hex'),
      clientInformation: () => s.info,
      saveClientInformation: (i) => void (s.info = i),
      tokens: () => s.tokens,
      saveTokens: (t) => void (s.tokens = t),
      redirectToAuthorization: (u) => void (s.authUrl = u),
      saveCodeVerifier: (v) => void (s.verifier = v),
      codeVerifier: () => s.verifier,
    };
  };
  const sdkConnect = async (who, workspaceId, name) => {
    const auth = provider(name);
    const first = new Client({ name: 'mcp-tests', version: '1.0.0' });
    let needed = false;
    try {
      await first.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: auth }));
    } catch (e) {
      needed = e instanceof UnauthorizedError;
    }
    const url = auth.s.authUrl;
    const consent = url ? await consentFor(who, url, workspaceId) : {};
    const back = consent.redirect ? new URL(consent.redirect) : null;
    const code = back?.searchParams.get('code');
    const t1 = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: auth });
    if (code) await t1.finishAuth(code);
    const client = new Client({ name: 'mcp-tests', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: auth }));
    return { client, auth, needed, url, back, consent };
  };
  const a = await sdkConnect(alice, 'w-acme', 'Claude test');
  check(a.needed, 'the SDK client is told to sign in first');
  check(!!a.url && a.url.pathname === '/oauth/authorize' && a.url.searchParams.get('code_challenge_method') === 'S256' && a.url.searchParams.get('resource') === `${base}/mcp`, 'it found the sign-in, registered itself and sent the person to /oauth/authorize with PKCE (S256) and the resource');
  check(a.back?.origin === 'http://127.0.0.1:53682' && a.back.searchParams.get('iss') === base && !!a.back.searchParams.get('state'), 'after Allow the person goes back to the app with a code, its state and the issuer');
  check(!!a.auth.s.tokens?.access_token?.startsWith('s2ga_') && !!a.auth.s.tokens?.refresh_token && a.auth.s.tokens.expires_in === 3600, 'the code became an access token (an hour) and a refresh token');
  check(!db.prepare("SELECT 1 FROM oauth_tokens WHERE hash = ?").get(a.auth.s.tokens.access_token) && !!db.prepare("SELECT 1 FROM oauth_tokens WHERE hash = ?").get(createHash('sha256').update(a.auth.s.tokens.access_token).digest('hex')), 'only a hash of each token is stored');

  const tools = (await a.client.listTools()).tools;
  const names = tools.map((t) => t.name).sort();
  const want = ['about_company', 'add_event', 'add_table_row', 'calendar_agenda', 'create_task', 'draft_mail', 'draft_reply', 'list_channels', 'list_mail', 'list_notes', 'list_tables', 'list_tasks', 'needs_me', 'post_message', 'query_rows', 'read_channel', 'read_mail', 'read_note', 'read_task', 'search', 'update_table_row', 'update_task', 'write_note'];
  check(JSON.stringify(names) === JSON.stringify(want), `the tools are listed (${names.length})`);
  check(tools.every((t) => t.description && t.description.length > 40 && t.inputSchema?.type === 'object' && typeof t.annotations?.readOnlyHint === 'boolean'), 'each tool has a description, an input schema and says whether it only reads');

  const call = async (client, name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? '';
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* a plain sentence */
    }
    return { error: !!r.isError, text, data };
  };
  const A = (name, args) => call(a.client, name, args);

  console.log('\n(tools, as Alice, the owner)');
  const about = await A('about_company');
  check(about.data?.company?.name === 'Acme' && about.data.you.id === 'u-alice' && about.data.people.length === 3 && about.data.projects.some((p) => p.name === 'Secret Project') && !about.data.projects.some((p) => p.name === 'Partner Launch'), 'about_company: her company, its people and projects, not the company where she is a guest');
  check(about.data?.task_stages?.length === 5 && about.data.mailboxes.length === 2 && about.data.company.time_zone === 'Asia/Jakarta', 'about_company: task stages, her mailboxes, the time zone');
  const needs = await A('needs_me');
  const kinds = (needs.data?.needs_you ?? []).map((x) => x.kind);
  check(kinds.includes('meeting') && kinds.includes('review') && kinds.includes('delegated') && kinds.includes('mail'), `needs_me: the meeting in 20 minutes, work to review, late work she handed out, client mail (${kinds.join(', ')})`);
  check(needs.data.needs_you[0].kind === 'meeting' && needs.data.needs_you[0].join?.startsWith('https://meet.google.com'), 'needs_me: most urgent first, with the meeting’s link');
  const s1 = await A('search', { query: 'banana' });
  const found = (s1.data?.results ?? []).map((x) => x.kind);
  check(['task', 'mail', 'message', 'event'].every((k) => found.includes(k)), `search: finds tasks, mail, chat and events (${found.join(', ')})`);
  const s2 = await A('search', { query: 'kiwi' });
  check(s2.data?.results?.length === 0, 'search: nothing from the other company where she is a guest');
  const mail = await A('list_mail');
  check(mail.data?.conversations?.some((t) => t.id === 'th-client') && mail.data.conversations.some((t) => t.id === 'th-hello') && !mail.data.conversations.some((t) => t.id === 'th-bob'), 'list_mail: her mailbox and the shared one, not Bob’s');
  const read = await A('read_mail', { thread_id: 'th-client' });
  check(read.data?.messages?.[0]?.text?.includes('Friday') && read.data.link === `${base}/mail?ws=w-acme&id=th-client`, 'read_mail: the messages and a link that opens it in sprint2go');
  check((await A('read_mail', { thread_id: 'th-bob' })).error, 'read_mail: Bob’s private mail is refused');
  const mine = await A('list_tasks', { scope: 'mine' });
  check(mine.data?.tasks?.some((t) => t.id === 't-secret') && !mine.data.tasks.some((t) => t.id === 't-late'), 'list_tasks mine: her own work');
  const proj = await A('list_tasks', { scope: 'project', project: 'Open Project' });
  check(proj.data?.tasks?.length === 1 && proj.data.tasks[0].late === true, 'list_tasks project: by name, late work marked');
  const rt = await A('read_task', { task_id: 't-review' });
  check(rt.data?.stage === 'Review' && rt.data.supervisor === 'Alice Martin', 'read_task: stage and people');
  const chans = await A('list_channels');
  check(chans.data?.channels?.length === 4 && chans.data.channels.find((c) => c.id === 'ch-shared')?.guests === true && !chans.data.channels.some((c) => c.id === 'ch-partner'), 'list_channels: her channels with guests marked, nothing from the other company');
  const rc = await A('read_channel', { channel: '#open-with-client' });
  check(rc.data?.messages?.[0]?.who === 'Gina Guest (guest)' && rc.data.note?.includes('draft'), 'read_channel: by name, guests labelled, and it says posting there makes a draft');
  check((await A('read_channel', { channel: 'Bob' })).data?.id === 'ch-dm', 'read_channel: a teammate’s name opens your direct messages');
  const cal = await A('calendar_agenda');
  check(cal.data?.events?.some((e) => e.id === 'e-standup' && e.video) && !cal.data.events.some((e) => e.id === 'e-bob'), 'calendar_agenda: her week, not Bob’s');
  const calBob = await A('calendar_agenda', { person: 'Bob' });
  check(calBob.data?.events?.some((e) => e.id === 'e-bob') && !JSON.stringify(calBob.data).includes('private bit'), 'calendar_agenda for a teammate: their events without the private details');
  const notes = await A('list_notes');
  check(notes.data?.notes?.some((n) => n.id === 'n-alice') && notes.data.notes.some((n) => n.id === 'n-team') && !notes.data.notes.some((n) => n.id === 'n-bob'), 'list_notes: hers and the team’s, not Bob’s private one');
  const rn = await A('read_note', { note_id: 'n-alice' });
  check(rn.data?.text?.includes('plum') && rn.data.text.includes('- one'), 'read_note: the text, lists kept');
  const tables = await A('list_tables');
  check(tables.data?.tables?.some((t) => t.name === 'Deals' && t.fields.find((f) => f.name === 'Stage')?.choices?.join() === 'Lead,Won'), 'list_tables: fields and choices');
  const rows = await A('query_rows', { table: 'Deals', where: { Stage: 'Lead' } });
  check(rows.data?.rows?.[0]?.values?.Owner === 'Bob Stone' && rows.data.rows[0].values.Stage === 'Lead', 'query_rows: choices and people in words, filtered');

  console.log('\n(doing things, as Alice)');
  const ct = await A('create_task', { title: 'Call the banana printer', assignees: ['Bob'], due: day(1), project: 'Open Project' });
  const newTask = ct.data?.created;
  check(!!newTask?.id && doc('todos', newTask.id)?.createdBy === 'u-alice' && doc('todos', newTask.id).assignees[0] === 'u-bob', 'create_task: saved as her, assigned to Bob by name');
  check(doc('todos', newTask.id).history[0].text.includes('via Claude test'), 'create_task: the task’s history says it came via the app');
  const bobNotice = db.prepare("SELECT data FROM docs WHERE coll = 'notices' AND data LIKE '%Call the banana printer%'").get();
  check(!!bobNotice && JSON.parse(bobNotice.data).userId === 'u-bob', 'create_task: Bob hears about it in his bell');
  const ut = await A('update_task', { task_id: newTask.id, stage: 'in progress', due: day(2), comment: 'Ask for the matte paper' });
  check(doc('todos', newTask.id).status === 'doing' && doc('todos', newTask.id).due === day(2) && doc('todos', newTask.id).history.some((h) => h.kind === 'comment' && !h.toClient), 'update_task: stage by its meaning, due date, an internal comment');
  const done = await A('update_task', { task_id: 't-review', done: true });
  check(doc('todos', 't-review').done === true && done.data?.updated?.stage === 'Done', 'update_task: approving work in review finishes it');
  const wn = await A('write_note', { title: 'Plum plan', text: '# Plan\n- first\n- **second**' });
  const nn = doc('notes', wn.data?.created?.id);
  check(nn?.ownerId === 'u-alice' && nn.visibility === 'private' && nn.html.includes('<h1>Plan</h1>') && nn.html.includes('<b>second</b>'), 'write_note: a private note, headings and lists as the editor stores them');
  await A('write_note', { note_id: nn.id, text: 'third', mode: 'append' });
  check(doc('notes', nn.id).html.endsWith('<p>third</p>'), 'write_note: adds to the end of a note');
  const ar = await A('add_table_row', { table: 'Deals', values: { Name: 'Lychee Ltd', Stage: 'Won', Owner: 'Alice', Value: 1200 } });
  const row = doc('rows', ar.data?.created?.id);
  check(row?.values['f-stage'] === 'o-won' && row.values['f-owner'] === 'u-alice' && row.createdBy === 'u-alice', 'add_table_row: choices by label, people by name');
  check((await A('add_table_row', { table: 'Deals', values: { Name: 'X', Stage: 'Maybe' } })).text.includes('Its choices: Lead, Won'), 'add_table_row: a choice that doesn’t exist is refused with the ones that do');
  await A('update_table_row', { row_id: 'r-1', values: { Stage: 'Won' } });
  check(doc('rows', 'r-1').values['f-stage'] === 'o-won' && doc('rows', 'r-1').history?.[0]?.to === 'o-won', 'update_table_row: changes a field and keeps its history');
  const pm = await A('post_message', { channel: 'general', text: 'Hi @Bob, deck looks great' });
  check(!!doc('messages', pm.data?.posted?.id) && doc('messages', pm.data.posted.id).userId === 'u-alice', 'post_message: posted in a team channel as her');
  check(!!db.prepare("SELECT 1 FROM docs WHERE coll = 'notices' AND data LIKE '%mentioned you in #general%'").get(), 'post_message: Bob hears he was mentioned');
  const before = db.prepare("SELECT COUNT(*) AS n FROM docs WHERE coll = 'messages'").get().n;
  const pd = await A('post_message', { channel: 'open-with-client', text: 'Mango drafts coming Friday' });
  check(pd.data?.draft === true && /Not sent/.test(pd.data.message) && db.prepare("SELECT COUNT(*) AS n FROM docs WHERE coll = 'messages'").get().n === before, 'post_message to a channel with guests: only a draft, nothing posted');
  check(doc('prefs', 'u-alice')?.value?.['s2g-chat-drafts:u-alice']?.['ch-shared']?.text === 'Mango drafts coming Friday', 'the draft waits in her own settings for the channel’s message box');
  const ev = await A('add_event', { title: 'Banana review', start: `${day(1)}T10:00`, guests: ['Bob', 'nadia@client.test'] });
  const evd = doc('events', ev.data?.created?.id);
  check(evd?.userId === 'u-alice' && evd.guests?.length === 1 && evd.guests[0].email === 'bob@acme.test' && ev.data.not_added?.[0] === 'nadia@client.test', 'add_event: on her calendar, teammates as guests, outside people left out with a note');
  check(new Date(evd.start).toISOString().slice(11, 16) === '03:00', 'add_event: 10:00 is the company’s time (Jakarta)');
  const outbox = () => db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'outbox'").get().n ? db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n : 0;
  const ob = outbox();
  const dm = await A('draft_mail', { to: ['nadia@client.test', 'Bob'], subject: 'Banana timing', text: 'Hi Nadia,\n\nFriday works.' });
  const dt = doc('threads', dm.data?.id);
  check(dm.data?.draft === true && dt?.location === 'drafts' && dt.accountId === 'a-alice' && dt.messages[0].to.length === 2 && /Not sent/.test(dm.data.message), 'draft_mail: a draft in her Drafts, never sent');
  const dr = await A('draft_reply', { thread_id: 'th-client', text: 'Friday is fine.' });
  const drt = doc('threads', dr.data?.id);
  check(drt?.location === 'drafts' && drt.subject === 'Re: Banana launch dates' && drt.messages[0].to[0].email === 'nadia@client.test' && drt.replyTo?.mid === '<abc@client.test>', 'draft_reply: a reply draft to the sender, keeping the conversation’s thread');
  check(outbox() === ob, 'nothing went out: the mail engine’s outbox is untouched');
  const audit = db.prepare("SELECT operator, action, target, detail FROM audit WHERE action LIKE 'ai-app.%' ORDER BY id").all();
  check(audit.length >= 8 && audit.every((x) => x.detail.startsWith('via Claude test:') && x.target === 'w-acme' && x.operator === 'alice@acme.test'), `the audit log has each change “via Claude test” (${audit.length} entries)`);

  console.log('\n(what Bob, a member, can’t see or touch)');
  // A plain OAuth client, by hand: register, consent, swap the code (and the checks along the way).
  const register = (body, headers = {}) => fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const token = (form, headers = {}) => fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(form) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const handConnect = async (who, workspaceId, name = 'Hand client', redirect = 'https://app.example/callback') => {
    const reg = await register({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none' });
    const verifier = b64url(randomBytes(32));
    const query = { response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: sha(verifier), code_challenge_method: 'S256', state: 's1', resource: `${base}/mcp` };
    const c = await who.json('POST', '/api/oauth/consent', { query, workspaceId, allow: true });
    const code = c.redirect ? new URL(c.redirect).searchParams.get('code') : null;
    const t = code ? await token({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier, resource: `${base}/mcp` }) : {};
    return { reg, verifier, query, consent: c, code, ...t };
  };
  const withToken = async (accessToken) => {
    const client = new Client({ name: 'mcp-tests', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
    return client;
  };
  const bobConn = await handConnect(bob, 'w-acme', 'Bob app');
  check(!!bobConn.access_token, 'Bob connects by hand: register, consent, code for tokens');
  const B = await withToken(bobConn.access_token);
  const BC = (name, args) => call(B, name, args);
  check(!(await BC('about_company')).data?.projects?.some((p) => p.name === 'Secret Project'), 'Bob doesn’t see the project he isn’t on');
  check((await BC('read_task', { task_id: 't-secret' })).error, 'Bob can’t read a task in it');
  check((await BC('update_task', { task_id: 't-secret', title: 'hacked' })).error && doc('todos', 't-secret').title === 'Pineapple due diligence', 'Bob can’t change a task in it');
  check((await BC('create_task', { title: 'Sneak in', project: 'c-secret' })).error, 'Bob can’t put a task into it');
  check((await BC('read_channel', { channel: 'ch-secret' })).error, 'Bob can’t read its channel');
  check((await BC('query_rows', { table: 'tb-secret' })).error, 'Bob can’t read its table');
  check((await BC('search', { query: 'pineapple' })).data?.results?.length === 0, 'Bob’s search finds nothing of it');
  check((await BC('read_mail', { thread_id: 'th-client' })).error && !(await BC('list_mail', { folder: 'all' })).data.conversations.some((t) => t.id === 'th-client'), 'Bob can’t read Alice’s mail');
  check(!(await BC('list_notes')).data.notes.some((n) => n.id === 'n-alice'), 'Bob doesn’t see Alice’s private notes');
  check((await BC('write_note', { note_id: 'n-alice', text: 'mine now' })).error && doc('notes', 'n-alice').html.includes('plum'), 'Bob can’t change Alice’s private note');
  check((await BC('draft_mail', { to: ['x@y.test'], subject: 's', text: 't', mailbox: 'alice@acme.test' })).error, 'Bob can’t write a draft from Alice’s mailbox');

  console.log('\n(guests, companies and two-step sign-in)');
  const ginaAsk = await gina.json('GET', `/api/oauth/request?${new URLSearchParams(bobConn.query)}`);
  check(Array.isArray(ginaAsk.companies) && ginaAsk.companies.length === 0, 'a guest has no company to connect');
  check((await gina.json('POST', '/api/oauth/consent', { query: bobConn.query, workspaceId: 'w-acme', allow: true })).status === 400, 'a guest can’t connect the company they’re a guest of');
  const aliceAsk = await alice.json('GET', `/api/oauth/request?${new URLSearchParams(bobConn.query)}`);
  check(aliceAsk.companies?.map((c) => c.id).join() === 'w-acme' && aliceAsk.app?.name === 'Bob app' && aliceAsk.app.host === 'app.example', 'the consent screen offers only companies she is on the team of, and names the app and where it lives');
  check((await alice.json('POST', '/api/oauth/consent', { query: bobConn.query, workspaceId: 'w-other', allow: true })).status === 400, 'she can’t connect the company where she is only a guest');
  check((await erin.json('GET', `/api/oauth/request?${new URLSearchParams(bobConn.query)}`)).status === 403, 'connecting waits for two-step sign-in when a company requires it');
  const cancel = await alice.json('POST', '/api/oauth/consent', { query: bobConn.query, workspaceId: 'w-acme', allow: false });
  check(new URL(cancel.redirect).searchParams.get('error') === 'access_denied' && new URL(cancel.redirect).searchParams.get('state') === 's1', 'Cancel goes back to the app with access_denied');

  console.log('\n(sign-in rules)');
  check((await register({ client_name: 'Bad', redirect_uris: ['http://evil.example/cb'] })).status === 400, 'registration: plain http only on this computer');
  check((await register({ client_name: 'Bad', redirect_uris: ['javascript:alert(1)'] })).status === 400, 'registration: no script addresses');
  check((await register({ client_name: 'Bad', redirect_uris: ['https://x.example/cb#frag'] })).status === 400, 'registration: no #fragments');
  const reg2 = await register({ client_name: 'Rules', redirect_uris: ['https://rules.example/cb'] });
  const q = (extra) => ({ response_type: 'code', client_id: reg2.client_id, redirect_uri: 'https://rules.example/cb', code_challenge: sha(b64url(randomBytes(32))), code_challenge_method: 'S256', state: 'z', ...extra });
  const ask = (extra) => alice.json('GET', `/api/oauth/request?${new URLSearchParams(Object.entries(q(extra)).filter(([, x]) => x !== undefined))}`);
  const r1 = await ask({ redirect_uri: 'https://rules.example/other' });
  check(!!r1.error && !r1.redirect, 'a redirect_uri it didn’t register exactly: shown here, never followed');
  const r2 = await ask({ code_challenge_method: 'plain' });
  check(!!r2.error && new URL(r2.redirect).searchParams.get('error') === 'invalid_request', 'PKCE with plain is refused (S256 only)');
  const r3 = await ask({ code_challenge: undefined });
  check(!!r3.error && new URL(r3.redirect ?? 'http://x').searchParams.get('error') === 'invalid_request', 'no code_challenge: refused');
  const r4 = await ask({ client_id: 'nope' });
  check(!!r4.error && !r4.redirect, 'an unknown app: refused, nothing followed');
  const r5 = await ask({ resource: 'https://elsewhere.example/mcp' });
  check(new URL(r5.redirect).searchParams.get('error') === 'invalid_target', 'a resource that isn’t this server: refused');
  const c1 = await handConnect(alice, 'w-acme', 'Verifier test');
  const wrong = await token({ grant_type: 'authorization_code', code: c1.code, redirect_uri: 'https://app.example/callback', client_id: c1.reg.client_id, code_verifier: b64url(randomBytes(32)) });
  check(wrong.status === 400 && wrong.error === 'invalid_grant', 'a code that was already swapped can’t be swapped again');
  const live = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${c1.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  check(live.status === 401, 'and using a code twice ends what the first use gave');
  const c2v = b64url(randomBytes(32));
  const c2q = { response_type: 'code', client_id: reg2.client_id, redirect_uri: 'https://rules.example/cb', code_challenge: sha(c2v), code_challenge_method: 'S256', state: 'q' };
  const c2 = new URL((await alice.json('POST', '/api/oauth/consent', { query: c2q, workspaceId: 'w-acme', allow: true })).redirect).searchParams.get('code');
  check((await token({ grant_type: 'authorization_code', code: c2, redirect_uri: 'https://rules.example/cb', client_id: reg2.client_id, code_verifier: b64url(randomBytes(32)) })).error === 'invalid_grant', 'a wrong code_verifier is refused');
  const c3v = b64url(randomBytes(32));
  const c3 = new URL((await alice.json('POST', '/api/oauth/consent', { query: { ...c2q, code_challenge: sha(c3v) }, workspaceId: 'w-acme', allow: true })).redirect).searchParams.get('code');
  check((await token({ grant_type: 'authorization_code', code: c3, redirect_uri: 'https://rules.example/other', client_id: reg2.client_id, code_verifier: c3v })).error === 'invalid_grant', 'a different redirect_uri at the token endpoint is refused');
  check((await token({ grant_type: 'password', username: 'a', password: 'b', client_id: reg2.client_id })).error === 'unsupported_grant_type', 'other grant types are refused');
  check((await token({ grant_type: 'authorization_code', code: 'x', client_id: 'nobody' })).status === 401, 'an unknown client at the token endpoint: 401');

  console.log('\n(refresh, revoke, expiry, wrong tokens)');
  const r = await handConnect(alice, 'w-acme', 'Refresh test');
  const fresh = await token({ grant_type: 'refresh_token', refresh_token: r.refresh_token, client_id: r.reg.client_id });
  check(!!fresh.access_token && fresh.refresh_token !== r.refresh_token, 'a refresh token gives new tokens (and a new refresh token)');
  const again = await token({ grant_type: 'refresh_token', refresh_token: r.refresh_token, client_id: r.reg.client_id });
  check(again.error === 'invalid_grant', 'an old refresh token used again is refused');
  check((await token({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token, client_id: r.reg.client_id })).error === 'invalid_grant', 'and that ended the whole connection (the copy can’t be used either)');
  const mcpStatus = (t, ip = '10.9.9.9') => fetch(`${base}/mcp`, { method: 'POST', headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': ip }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const wrongT = await mcpStatus('s2ga_not-a-real-token');
  check(wrongT.status === 401 && (wrongT.headers.get('www-authenticate') ?? '').includes('invalid_token'), 'a wrong token: 401 invalid_token');
  const e1 = await handConnect(alice, 'w-acme', 'Expiry test');
  db.prepare("UPDATE oauth_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE hash = ?").run(createHash('sha256').update(e1.access_token).digest('hex'));
  const exp = await mcpStatus(e1.access_token);
  check(exp.status === 401 && (await exp.json()).error.message.includes('expired'), 'an expired access token: 401');
  const rv = await handConnect(alice, 'w-acme', 'Revoke test');
  check((await mcpStatus(rv.access_token)).status === 200, 'a fresh connection works');
  await fetch(`${base}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: rv.refresh_token, client_id: rv.reg.client_id }) });
  check((await mcpStatus(rv.access_token)).status === 401, 'revoking the refresh token at /oauth/revoke ends the connection');

  console.log('\n(Connected apps in Settings, and the company switch)');
  const grants = await alice.json('GET', '/api/oauth/grants');
  const claude = grants.grants?.find((g) => g.app === 'Claude test');
  check(!!claude && claude.company === 'Acme' && !!claude.usedAt && grants.url === `${base}/mcp`, 'Settings lists her connected apps: the app, the company, when it was last used, and the address to add');
  check(!grants.grants.some((g) => g.app === 'Refresh test' || g.app === 'Revoke test'), 'ended connections aren’t listed');
  check((await bob.json('POST', '/api/oauth/grants/revoke', { id: claude.id })).status === 404, 'Bob can’t disconnect Alice’s app');
  const sec = db.prepare("SELECT detail FROM platform_events WHERE type = 'security.ai-app' AND workspace_id = 'w-acme'").all().map((x) => x.detail);
  check(sec.some((d) => d.startsWith('connected Claude test')), 'the company’s Security log says who connected which app');
  const ws = doc('workspaces', 'w-acme');
  check((await bob.sync('workspaces', [{ ...ws, aiApps: false }])).saved === 0 && doc('workspaces', 'w-acme').aiApps === undefined, 'a member can’t switch AI apps off');
  await alice.sync('workspaces', [{ ...ws, aiApps: false }]);
  let off = '';
  try {
    await a.client.callTool({ name: 'about_company', arguments: {} });
  } catch (e) {
    off = String(e?.message ?? e);
  }
  check(doc('workspaces', 'w-acme').aiApps === false && off.includes('switched off AI apps'), 'with “Let people connect AI apps” off, the company’s connections stop working and say why');
  check((await alice.json('POST', '/api/oauth/consent', { query: bobConn.query, workspaceId: 'w-acme', allow: true })).status === 403, 'and nobody can connect it');
  await alice.sync('workspaces', [{ ...doc('workspaces', 'w-acme'), aiApps: true }]);
  check(!(await A('about_company')).error, 'switched back on, it works again');
  await alice.post('/api/oauth/grants/revoke', { id: claude.id });
  let gone = '';
  try {
    await a.client.callTool({ name: 'about_company', arguments: {} });
  } catch (e) {
    gone = String(e?.message ?? e);
  }
  check(!!gone && !(await alice.json('GET', '/api/oauth/grants')).grants.some((g) => g.id === claude.id), 'Disconnect in Settings ends it at once');

  console.log('\n(the demo company)');
  const mk = await bob.json('POST', '/api/sandbox', {});
  const demoWs = mk.workspaceId;
  check(!!demoWs, 'Bob opens his own demo company');
  const bobAsk = await bob.json('GET', `/api/oauth/request?${new URLSearchParams(bobConn.query)}`);
  check(bobAsk.companies?.some((c) => c.id === demoWs && c.demo), 'it can be picked on the consent screen');
  const dConn = await handConnect(bob, demoWs, 'Demo app');
  const D = await withToken(dConn.access_token);
  const DC = (name, args) => call(D, name, args);
  const dAbout = await DC('about_company');
  check(dAbout.data?.company?.demo && dAbout.data.people.length > 3, 'tools see the demo company and its made-up people');
  const dTasks = await DC('list_tasks', { scope: 'everything' });
  check(dTasks.data?.tasks?.length > 3, 'its tasks are there');
  const realBefore = db.prepare('SELECT COUNT(*) AS n FROM docs').get().n;
  const auditBefore = db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
  const dct = await DC('create_task', { title: 'Demo durian task' });
  const dmail = await DC('draft_mail', { to: ['someone@outside.test'], subject: 'Demo', text: 'Hi' });
  check(!dct.error && !dmail.error && !!db.prepare("SELECT 1 FROM sandbox_docs WHERE owner = 'u-bob' AND data LIKE '%Demo durian task%'").get(), 'changes in it are saved in the demo company');
  check(db.prepare('SELECT COUNT(*) AS n FROM docs').get().n === realBefore && !db.prepare("SELECT 1 FROM docs WHERE data LIKE '%Demo durian task%'").get(), 'nothing of it reaches the real documents');
  check(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n === auditBefore, 'and nothing of it reaches the operators’ audit log');
  await bob.post('/api/sandbox/hide', {});
  const closed = await mcpStatus(dConn.access_token);
  check(closed.status === 403 && (await closed.json()).error.message.includes('demo company is closed'), 'a hidden demo company can’t be reached');

  console.log('\n(rate limits)');
  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const x = await register({ client_name: `Spam ${i}`, redirect_uris: ['https://spam.example/cb'] }, { 'x-forwarded-for': '10.1.1.1' });
    if (x.status === 429) limited++;
  }
  check(limited > 0, 'registering apps is rate limited per address');
  let slow = 0;
  for (let i = 0; i < 65; i++) if ((await token({ grant_type: 'refresh_token', refresh_token: 'x', client_id: reg2.client_id }, { 'x-forwarded-for': '10.2.2.2' })).status === 429) slow++;
  check(slow > 0, 'the token endpoint is rate limited per address');
  let bad = 0;
  for (let i = 0; i < 35; i++) if ((await mcpStatus('s2ga_guess-' + i, '10.3.3.3')).status === 429) bad++;
  check(bad > 0, 'guessing tokens at /mcp is slowed down');
  const busy = await handConnect(alice, 'w-acme', 'Busy app');
  let many = 0;
  for (let i = 0; i < 125; i++) if ((await mcpStatus(busy.access_token)).status === 429) many++;
  check(many > 0, 'one connection can make at most 120 requests a minute');

  console.log('\n(signing out everywhere)');
  const pw = await handConnect(alice, 'w-acme', 'Password test');
  check((await mcpStatus(pw.access_token)).status === 200, 'a connection works');
  await alice.post('/api/password', { current: password, next: password + 'x' });
  check((await mcpStatus(pw.access_token)).status === 401, 'changing the password disconnects her AI apps');
} catch (e) {
  console.log('FAIL', e?.stack ?? e);
  failed++;
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll connector checks passed');
finish(failed ? 1 : 0);
