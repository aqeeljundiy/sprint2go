// Sprint2go local server: the app, its database, logins, live updates and the AI router, on one port.
// Run:  npm run server   (after `npm run build`), then open http://localhost:8787
// In development, `npm run dev` proxies /api here, so run both.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import * as ai from './ai.ts';
import { AIError, testKey, withAI, type AIConfig } from './llm.ts';
import { seed, RECORD_KEYS, type CollectionKey } from '../src/seed.ts';
import { JOBS, PROVIDERS } from '../src/data/aiCatalog.ts';
import { accessFor, can, channelsFor, clientPeople, filesFor, meetingsFor, tasksFor } from '../src/clientView.ts';

for (const f of ['.env', '.env.example']) if (existsSync(f)) process.loadEnvFile(f); // .env wins: values already set are kept
const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1'; // localhost only
const DIST = join(process.cwd(), 'dist');

/* ---------- first run: copy the demo company into the database ---------- */

const COLLS = Object.keys(seed()) as CollectionKey[];
const toDocs = (key: CollectionKey, value: unknown): db.Doc[] =>
  RECORD_KEYS.includes(key) ? Object.entries(value as Record<string, unknown>).map(([id, v]) => ({ id, value: v })) : (value as db.Doc[]);

if (db.isEmpty()) {
  const s = seed();
  for (const k of COLLS) db.writeDocs(k, toDocs(k, s[k]), [], null);
  const pw = process.env.SEED_PASSWORD;
  if (!pw) throw new Error('Set SEED_PASSWORD in .env (see .env.example) before the first run.');
  for (const u of s.users) db.setLogin(u.id, u.email, pw);
  // Client people who already joined can sign in to their portal (same demo password).
  const known = new Set(s.users.map((u) => u.email.toLowerCase()));
  // People who already have a sign-in (e.g. Dimas at Elkiya) just get the portal on their existing account.
  const clientUsers = s.clients.flatMap((c) =>
    (c.people ?? []).filter((x) => x.status === 'joined' && !known.has(x.email.toLowerCase())).map((x) => ({ id: `cu-${x.email.split('@')[0]}-${c.id}`, name: x.name, email: x.email, title: c.name, color: c.color, clientOf: { workspaceId: c.workspaceId, clientId: c.id } })),
  );
  db.writeDocs('users', clientUsers as unknown as db.Doc[], [], null);
  for (const u of clientUsers) db.setLogin(u.id, u.email, pw);
  console.log(`Seeded the demo company: ${s.users.length} people and ${clientUsers.length} client people can sign in with the password in .env / .env.example.`);
}

/* ---------- helpers ---------- */

type Ws = { id: string; members: { userId: string; role: string }[]; accounts?: { id: string }[]; ai?: { jobs?: Record<string, { provider: string; model: string }>; providers?: { id: string; status: string }[]; payer?: string } };
const workspaces = () => db.allDocs('workspaces') as unknown as Ws[];
const memberOf = (userId: string) => workspaces().filter((w) => w.members.some((m) => m.userId === userId));
const isAdminOf = (userId: string, wsId: string) => workspaces().some((w) => w.id === wsId && w.members.some((m) => m.userId === userId && m.role !== 'member'));

/** The signed-in person: a team member, or someone at a client (client portal). */
type Person = { id: string; email?: string; name?: string; clientOf?: { workspaceId: string; clientId: string } };
const personOf = (userId: string) => db.getDoc('users', userId) as unknown as Person | undefined;

/**
 * What one person may see, shaped for them (null = not at all). Team members: their workspaces, mailboxes they're on,
 * channels and DMs they're in, their notifications. Client people: only what the company shares with their client.
 */
/**
 * The client portals someone has: clients (in companies they're not part of) that list their email. One sign-in can
 * be a team member in their own company and a client of another.
 */
function portalsOf(userId: string): { workspaceId: string; clientId: string }[] {
  const me = personOf(userId);
  if (!me?.email) return me?.clientOf ? [me.clientOf] : [];
  const email = String(me.email).toLowerCase();
  const mine = new Set(memberOf(userId).map((w) => w.id));
  const channels = db.allDocs('channels') as any[];
  const found = (db.allDocs('clients') as any[])
    .filter((c) => !mine.has(c.workspaceId) && clientPeople(c, channels).some((x) => x.email.toLowerCase() === email && x.status !== 'pending'))
    .map((c) => ({ workspaceId: c.workspaceId, clientId: c.id }));
  if (me.clientOf && !found.some((f) => f.clientId === me.clientOf!.clientId)) found.push(me.clientOf);
  return found;
}
/** Users (by id) who are people at this client, for the client's AI question limit. */
const clientUserIds = (clientId: string) => {
  const client = db.getDoc('clients', clientId) as any;
  const emails = new Set(clientPeople(client, db.allDocs('channels') as any).map((x) => x.email.toLowerCase()));
  return (db.allDocs('users') as any[]).filter((u) => emails.has(String(u.email).toLowerCase())).map((u) => u.id);
};

function lens(userId: string): (coll: string, d: any) => any | null {
  const me = personOf(userId);
  const portals = portalsOf(userId).map((pt) => clientLens({ ...me!, clientOf: pt }));
  const team = teamLens(userId);
  if (!portals.length) return team;
  return (coll, d) => team(coll, d) ?? portals.map((l) => l(coll, d)).find(Boolean) ?? null;
}

/** A team member's view: their workspaces, mailboxes they're on, channels and DMs they're in, their notifications. */
function teamLens(userId: string): (coll: string, d: any) => any | null {
  const me = personOf(userId);
  const ws = workspaces();
  const mine = new Set(ws.filter((w) => w.members.some((m) => m.userId === userId)).map((w) => w.id));
  if (!mine.size) return () => null; // someone at a client only
  const people = new Set(ws.filter((w) => mine.has(w.id)).flatMap((w) => w.members.map((m) => m.userId)));
  const firstWs = (ws.find((w) => w.id === 'pnp') ?? ws[0])?.id; // older documents without a workspace belong to the first one (as in the app)
  const accounts = new Map(ws.flatMap((w) => ((w.accounts ?? []) as { id: string; users?: string[] }[]).map((a) => [a.id, { ws: w.id, users: a.users ?? [] }] as const)));
  const channels = new Map((db.allDocs('channels') as any[]).map((c) => [String(c.id), c]));
  const channelOk = (c: any) => !!c && mine.has(c.workspaceId) && (!(c.private || c.kind === 'dm') || (c.members ?? []).includes(userId));
  const ok = (coll: string, d: any): boolean => {
    switch (coll) {
      case 'users':
        // Yourself, your companies' people, and the client people of your companies.
        return d.id === userId || people.has(d.id) || (!!d.clientOf && mine.has(d.clientOf.workspaceId));
      case 'workspaces':
        return mine.has(d.id);
      case 'statuses':
        return people.has(d.id);
      case 'channels':
        return channelOk(d);
      case 'messages':
        return channelOk(channels.get(d.channelId));
      case 'notices':
        // Your own, plus what the team sent to client people (so "View as client" shows it).
        return d.userId === userId || (String(d.userId).startsWith('email:') && mine.has(d.workspaceId)) || (!!me?.email && d.userId === `email:${String(me.email).toLowerCase()}`);
      case 'threads': {
        const a = accounts.get(d.accountId);
        return !!a && mine.has(a.ws) && a.users.includes(userId);
      }
      default:
        return mine.has(typeof d.workspaceId === 'string' ? d.workspaceId : firstWs);
    }
  };
  return (coll, d) => (ok(coll, d) ? d : null);
}

/** A client person's view: their client's shared work, shaped so internal details never leave the server. */
function clientLens(me: Person) {
  const { workspaceId, clientId } = me.clientOf!;
  const email = String(me.email ?? '').toLowerCase();
  const w = workspaces().find((x) => x.id === workspaceId) as any;
  const client = db.getDoc('clients', clientId) as any;
  if (!w || !client) return () => null;
  // Work ended: their people keep read-only access, or none at all.
  if (client.status === 'ended' && client.portalAfterEnd !== 'readonly') return () => null;
  const access = accessFor(w, client);
  const channels = db.allDocs('channels') as any[];
  const people = clientPeople(client, channels as any);
  const myChannels = new Set(channelsFor(email, clientId, channels as any, client.status === 'ended').map((c) => c.id));
  const meetings = new Map(meetingsFor(client, people, db.allDocs('meetings') as any, access).map((x) => [x.meeting.id, x.notes]));
  const files = new Set(filesFor(client, db.allDocs('drive') as any).map((f) => f.id));
  const tasks = new Set(tasksFor(client, db.allDocs('todos') as any).map((t) => t.id));
  const team = new Set(w.members.map((m: any) => m.userId));
  return (coll: string, d: any): any | null => {
    switch (coll) {
      case 'workspaces':
        return d.id === workspaceId ? { id: d.id, name: d.name, color: d.color, logo: d.logo, domains: [], accounts: [], members: d.members.map((m: any) => ({ userId: m.userId, role: 'member' })), clientAccess: d.clientAccess, plan: d.plan ? { tier: d.plan.tier, track: d.plan.track, addons: d.plan.addons } : undefined } : null;
      case 'users':
        if (d.id === me.id || (d.clientOf?.clientId === clientId)) return { id: d.id, name: d.name, email: d.email, color: d.color, clientOf: d.clientOf };
        return team.has(d.id) ? { id: d.id, name: d.name, color: d.color, title: d.title, email: '' } : null;
      case 'clients':
        return d.id === clientId ? d : null;
      case 'teams':
        return d.workspaceId === workspaceId ? { id: d.id, workspaceId: d.workspaceId, name: d.name, color: d.color, leadId: d.leadId, members: d.members } : null;
      case 'channels':
        return myChannels.has(d.id) ? { id: d.id, workspaceId: d.workspaceId, kind: d.kind, name: d.name, topic: d.topic, clientId: d.clientId, category: d.category, members: [], guests: d.guests, materials: d.materials, bookmarks: d.bookmarks } : null;
      case 'messages':
        return myChannels.has(d.channelId) ? d : null;
      case 'todos': {
        if (!tasks.has(d.id)) return null;
        const history = (d.history ?? []).filter((h: any) => h.toClient || String(h.by).includes('@') || (h.kind === 'created' && d.source === 'request'));
        const { notes: _notes, followers: _f, ...rest } = d;
        return { ...rest, history };
      }
      case 'meetings': {
        if (!meetings.has(d.id)) return null;
        const notes = meetings.get(d.id);
        const base = { id: d.id, workspaceId: d.workspaceId, title: d.title, at: d.at, minutes: d.minutes, clientId: d.clientId, attendees: d.attendees, status: d.status, sharedWithClient: d.sharedWithClient, actions: [] as any[], summary: '' };
        return notes ? { ...base, summary: d.summary, decisions: d.decisions, keyPoints: d.keyPoints, actions: (d.actions ?? []).map((a: any) => ({ title: a.title, due: a.due })) } : base;
      }
      case 'drive':
        return files.has(d.id) || (d.kind === 'folder' && d.clientId === clientId) ? d : null;
      case 'notices':
        return d.userId === me.id || d.userId === `email:${email}` ? d : null;
      default:
        return null; // mail, calendars, events, statuses, templates: never
    }
  };
}

function visibleState(userId: string) {
  const see = lens(userId);
  const out: Record<string, db.Doc[]> = {};
  for (const k of COLLS) out[k] = db.allDocs(k).map((d) => see(k, d)).filter(Boolean);
  return out;
}

/**
 * What a client person may change. Their changes are merged into the stored document so they can never remove or
 * overwrite the team's internal parts (comments, notes, assignments).
 */
function clientWrite(me: Person, coll: string, d: any): any | null {
  const { workspaceId, clientId } = me.clientOf!;
  const email = String(me.email ?? '').toLowerCase();
  const before = db.getDoc(coll, d.id) as any;
  const see = clientLens(me);
  const client = db.getDoc('clients', clientId) as any;
  const w = workspaces().find((x) => x.id === workspaceId) as any;
  const access = accessFor(w, client);
  const person = clientPeople(client, db.allDocs('channels') as any).find((x) => x.email.toLowerCase() === email);
  if (!person || person.status === 'pending') return null;
  if (client.status === 'ended') return null; // read only after the work ended
  switch (coll) {
    case 'messages':
      return !before && d.userId === 'guest' && String(d.guestEmail).toLowerCase() === email && see('messages', d) && can(person, 'comment') ? d : null;
    case 'todos': {
      if (!before)
        return access.requests && can(person, 'request') && d.source === 'request' && d.clientId === clientId && String(d.requestedBy).toLowerCase() === email && d.workspaceId === workspaceId ? { ...d, visibleToClient: true } : null;
      if (!see('todos', before)) return null;
      const known = new Set((before.history ?? []).map((h: any) => h.id));
      const added = (d.history ?? []).filter((h: any) => !known.has(h.id) && String(h.by).toLowerCase() === email && (h.kind === 'comment' || h.kind === 'review') && can(person, 'comment'));
      const approval = can(person, 'approve') && before.approval?.status === 'waiting' && d.approval && d.approval.status !== 'waiting' ? { ...before.approval, status: d.approval.status, by: email, at: new Date().toISOString(), note: d.approval.note } : before.approval;
      return { ...before, approval, history: [...(before.history ?? []), ...added.map((h: any) => ({ ...h, toClient: true }))] };
    }
    case 'drive':
      if (before) return null;
      if (d.kind === 'folder') return d.clientId === clientId && d.workspaceId === workspaceId ? d : null;
      return access.uploads && can(person, 'upload') && d.clientId === clientId && String(d.uploadedBy).toLowerCase() === email ? d : null;
    case 'notices':
      return !before && d.workspaceId === workspaceId && (w.members.some((m: any) => m.userId === d.userId) || String(d.userId).startsWith('email:')) ? d : null;
    case 'clients': {
      if (d.id !== clientId || !before) return null;
      const known = new Set((before.people ?? []).map((x: any) => x.email.toLowerCase()));
      const domain = String(before.domain ?? '').toLowerCase();
      const added =
        access.invites === 'off'
          ? []
          : (d.people ?? [])
              .filter((x: any) => !known.has(String(x.email).toLowerCase()) && String(x.invitedBy).toLowerCase() === email)
              .map((x: any) => ({ ...x, role: 'collaborator', status: access.invites === 'direct' && domain && String(x.email).toLowerCase().endsWith('@' + domain) ? 'invited' : 'pending' }));
      const month = new Date().toISOString().slice(0, 7);
      const aiUsage = d.aiUsage?.month === month && (!before.aiUsage || before.aiUsage.month !== month || d.aiUsage.count >= before.aiUsage.count) ? d.aiUsage : before.aiUsage;
      return { ...before, people: [...(before.people ?? []), ...added], aiUsage };
    }
    default:
      return null;
  }
}

const cookie = (req: IncomingMessage, name: string) => req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);
async function body(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000_000) throw new AIError('Too large', 413);
  }
  return raw ? JSON.parse(raw) : {};
}
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
};

/* ---------- live updates (server-sent events) ---------- */

const clients = new Map<string, { res: ServerResponse; userId: string }>();
/** Sends a change to every open window, each getting only what that person may see. */
function broadcast(coll: string, upserts: db.Doc[], deletes: string[], except?: string) {
  if (!upserts.length && !deletes.length) return;
  const views = new Map<string, ReturnType<typeof lens>>();
  for (const [id, c] of clients) {
    if (id === except) continue;
    if (!views.has(c.userId)) views.set(c.userId, lens(c.userId));
    const see = views.get(c.userId)!;
    const mine = upserts.map((d) => see(coll, d)).filter(Boolean);
    if (mine.length || deletes.length) c.res.write(`event: change\ndata: ${JSON.stringify({ coll, upserts: mine, deletes })}\n\n`);
  }
}
setInterval(() => clients.forEach((c) => c.res.write(': ping\n\n')), 25_000);

/* ---------- AI: which provider and model does each job ---------- */

const JOB_OF: Record<string, string> = {
  summarize: 'summary',
  catchup: 'summary',
  folderoverview: 'summary',
  replies: 'replies',
  draft: 'draft',
  rewrite: 'draft',
  todos: 'todos',
  assistant: 'ask',
  askmeetings: 'ask',
  braindump: 'braindump',
  meetingnotes: 'meeting',
};
function aiFor(wsId: string, job: string): AIConfig | null {
  const ws = workspaces().find((w) => w.id === wsId);
  const pick = ws?.ai?.jobs?.[job];
  const rec = JOBS.find((j) => j.id === job)?.rec;
  if (pick && pick.provider !== 'included') {
    const k = db.loadKey(wsId, pick.provider);
    if (k) return { provider: pick.provider, model: pick.model, apiKey: k.key, baseUrl: k.baseUrl };
  }
  // Included AI (Sprint2go pays): the server's own Claude key.
  if (process.env.ANTHROPIC_API_KEY && ws?.ai?.payer !== 'own') return { provider: 'anthropic', model: rec?.balanced?.startsWith('claude') ? rec.balanced : 'claude-sonnet-5-5', apiKey: process.env.ANTHROPIC_API_KEY, included: true };
  // Otherwise any key the company saved, with that provider's model for this kind of job.
  for (const p of ws?.ai?.providers ?? []) {
    const k = db.loadKey(wsId, p.id);
    const info = PROVIDERS.find((x) => x.id === p.id);
    if (!k || !info || info.kind === 'speech') continue;
    const wanted = [rec?.balanced, rec?.best, rec?.cheap].find((m) => info.models.some((x) => x.id === m));
    return { provider: p.id, model: wanted ?? info.models.find((m) => m.tier === 'balanced')?.id ?? info.models[0].id, apiKey: k.key, baseUrl: k.baseUrl };
  }
  return null;
}

const routes: Record<string, (b: any) => Promise<unknown>> = {
  summarize: (b) => ai.summarize(b.thread),
  replies: (b) => ai.replies(b.thread, b.me),
  draft: (b) => ai.draft(b),
  rewrite: (b) => ai.rewrite(b.text, b.style),
  todos: (b) => ai.todos(b.thread, b.me, b.today),
  assistant: (b) => ai.assistant(b.question, b.threads, b.me, b.today),
  braindump: (b) => ai.braindump(b),
  catchup: (b) => ai.catchUp(b),
  meetingnotes: (b) => ai.meetingNotes(b),
  folderoverview: (b) => ai.folderOverview(b),
  askmeetings: (b) => ai.askMeetings(b),
};

/* ---------- the app itself ---------- */

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // single-page app
  if (!existsSync(file)) {
    res.statusCode = 404;
    return res.end('Build the app first: npm run build');
  }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}

/* ---------- routes ---------- */

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(req, res);
  try {
    // Sign in / out
    if (p === '/api/login' && req.method === 'POST') {
      const { email, password } = await body(req);
      const login = typeof email === 'string' && db.findLogin(email.trim());
      if (!login || typeof password !== 'string' || !db.checkPassword(password, login.pw_hash)) return json(res, 401, { error: 'Wrong email or password.' });
      const token = db.newSession(login.user_id);
      res.setHeader('set-cookie', `s2g=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
      return json(res, 200, { me: login.user_id });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const t = cookie(req, 's2g');
      if (t) db.endSession(t);
      res.setHeader('set-cookie', 's2g=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return json(res, 200, {});
    }

    // Accepting an invite: the new person sets a password and is signed in.
    if (p === '/api/invite/check' && req.method === 'POST') {
      const inv = db.peekInvite(String((await body(req)).token ?? ''));
      return inv ? json(res, 200, { email: inv.email }) : json(res, 404, { error: 'This invite link has expired or was already used.' });
    }
    if (p === '/api/invite/accept' && req.method === 'POST') {
      const { token, password } = await body(req);
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      const inv = db.claimInvite(String(token ?? ''));
      if (!inv) return json(res, 404, { error: 'This invite link has expired or was already used.' });
      db.setLogin(inv.user_id, inv.email, password);
      res.setHeader('set-cookie', `s2g=${db.newSession(inv.user_id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
      return json(res, 200, { me: inv.user_id });
    }

    const me = db.sessionUser(cookie(req, 's2g'));
    if (!me) return json(res, 401, { error: 'Sign in first.' });

    if (p === '/api/me') return json(res, 200, { me });
    if (p === '/api/state') return json(res, 200, visibleState(me));

    if (p === '/api/password' && req.method === 'POST') {
      const { current, next } = await body(req);
      const u = db.getDoc('users', me) as { email?: string } | undefined;
      const login = u?.email && db.findLogin(u.email);
      if (!login || !db.checkPassword(String(current ?? ''), login.pw_hash)) return json(res, 400, { error: 'Your current password is wrong.' });
      if (typeof next !== 'string' || next.length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      db.setLogin(me, u.email!, next);
      return json(res, 200, {});
    }

    // Someone at a client gets a sign-in for their portal (an invite link to set a password).
    // The team can invite anyone; a client person only colleagues at their own domain, when the company allows it.
    if (p === '/api/client-invite' && req.method === 'POST') {
      const { workspaceId, clientId, name, email } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || !String(name ?? '').trim()) return json(res, 400, { error: 'Name and email, please.' });
      const client = db.getDoc('clients', String(clientId)) as any;
      const w = workspaces().find((x) => x.id === workspaceId) as any;
      if (!client || !w || client.workspaceId !== w.id) return json(res, 404, { error: 'No such client.' });
      if (!memberOf(me).some((x) => x.id === w.id)) {
        // A client person inviting a colleague.
        const access = accessFor(w, client);
        const sameDomain = !!client.domain && mail.endsWith('@' + String(client.domain).toLowerCase());
        if (!portalsOf(me).some((pt) => pt.clientId === client.id) || access.invites !== 'direct' || !sameDomain) return json(res, 403, { error: 'This needs the team’s approval.' });
      }
      const existing = db.findLogin(mail);
      if (existing) return json(res, 409, { error: 'They already have a sign-in.' });
      let user = (db.allDocs('users') as any[]).find((u) => String(u.email).toLowerCase() === mail);
      if (!user) {
        user = { id: 'cu-' + randomBytes(5).toString('hex'), name: String(name).trim(), email: mail, color: client.color ?? '#64748b', title: client.name, clientOf: { workspaceId: w.id, clientId: client.id } };
        db.writeDocs('users', [user], [], me);
        broadcast('users', [user], []);
      }
      // On the client's people list, and a guest in its shared channels.
      const people = client.people ?? [];
      const known = people.find((x: any) => String(x.email).toLowerCase() === mail);
      const nextClient = { ...client, people: known ? people.map((x: any) => (String(x.email).toLowerCase() === mail && x.status === 'pending' ? { ...x, status: 'invited' } : x)) : [...people, { email: mail, name: String(name).trim(), role: 'collaborator', status: 'invited', invitedBy: me, at: new Date().toISOString() }] };
      db.writeDocs('clients', [nextClient], [], me);
      broadcast('clients', [nextClient], []);
      const chans = (db.allDocs('channels') as any[]).filter((c) => c.clientId === client.id && c.category === 'shared' && !(c.guests ?? []).some((g: any) => String(g.email).toLowerCase() === mail));
      const withGuest = chans.map((c) => ({ ...c, guests: [...(c.guests ?? []), { email: mail, name: String(name).trim(), status: 'invited', invitedBy: me, at: new Date().toISOString() }] }));
      if (withGuest.length) {
        db.writeDocs('channels', withGuest, [], me);
        broadcast('channels', withGuest, []);
      }
      return json(res, 200, { link: `/?invite=${db.newInvite(user.id, mail)}` });
    }

    // An admin invites someone: they get a link to set their own password.
    if (p === '/api/invite' && req.method === 'POST') {
      const { userId, email } = await body(req);
      if (!memberOf(me).some((w) => isAdminOf(me, w.id))) return json(res, 403, { error: 'Only admins can invite people.' });
      if (typeof email !== 'string' || !email.includes('@')) return json(res, 400, { error: 'Invalid email' });
      const taken = db.findLogin(email);
      if (taken && taken.user_id !== userId) return json(res, 409, { error: 'Someone already uses that email.' });
      return json(res, 200, { link: `/?invite=${db.newInvite(String(userId), email)}` });
    }

    // Saves changes and tells everyone else who has the app open.
    if (p === '/api/sync' && req.method === 'POST') {
      const { coll, upserts = [], deletes = [] } = await body(req);
      if (!COLLS.includes(coll)) return json(res, 400, { error: 'Unknown collection' });
      const person = personOf(me)!;
      const mine = new Set(memberOf(me).map((w) => w.id));
      const see = teamLens(me);
      const portals = portalsOf(me).map((pt) => ({ ...person, clientOf: pt }));
      // Team changes: nobody can write into a workspace they're not in, or change or delete something they can't see.
      const asTeam = (d: db.Doc) => {
        if (!mine.size) return false;
        const before = db.getDoc(coll, d.id);
        if (before) return !!see(coll, before);
        // New: workspaces and people can be added; notices go to anyone in your companies; anything else must be
        // something you'd be able to see (e.g. a message in a channel you're in).
        if (coll === 'workspaces' || coll === 'users') return true;
        if (coll === 'notices') return mine.has(d.workspaceId as string);
        if (coll === 'statuses') return d.id === me;
        return !!see(coll, d);
      };
      // Client changes (in a company where they're a client): only their own kinds, merged into what's stored.
      const ok = (upserts as db.Doc[])
        .filter((d) => d && typeof d.id === 'string')
        .map((d) => (asTeam(d) ? d : (portals.map((pt) => clientWrite(pt, coll, d)).find(Boolean) ?? null)))
        .filter(Boolean);
      const dels = mine.size
        ? (deletes as string[]).filter((id) => {
            const before = db.getDoc(coll, id);
            return !before || see(coll, before);
          })
        : [];
      db.writeDocs(coll, ok, dels, me);
      broadcast(coll, ok, dels, req.headers['x-conn'] as string | undefined);
      return json(res, 200, { saved: ok.length });
    }

    if (p === '/api/events') {
      const id = randomBytes(8).toString('hex');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ conn: id })}\n\n`);
      clients.set(id, { res, userId: me });
      req.on('close', () => clients.delete(id));
      return;
    }

    // AI keys: kept encrypted here; the browser only ever sees the last 4 characters.
    if (p === '/api/ai/keys' && req.method === 'POST') {
      const { workspaceId, provider, key, baseUrl, test = true } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: 'Only admins can add AI keys.' });
      const info = PROVIDERS.find((x) => x.id === provider);
      if (!info || typeof key !== 'string' || key.trim().length < 8) return json(res, 400, { error: 'That key looks too short.' });
      if (test && info.kind !== 'speech') {
        try {
          await testKey({ provider, model: info.models.find((m) => m.tier === 'fast')?.id ?? info.models[0].id, apiKey: key.trim(), baseUrl });
        } catch (e) {
          return json(res, 400, { error: e instanceof AIError ? e.message : (e as { status?: number }).status === 401 ? 'That key was rejected. Check it and try again.' : 'The key did not work.' });
        }
      }
      db.saveKey(workspaceId, provider, key.trim(), baseUrl, me);
      return json(res, 200, { keyLast4: key.trim().slice(-4) });
    }
    if (p === '/api/ai/keys' && req.method === 'DELETE') {
      const { workspaceId, provider } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: 'Only admins can remove AI keys.' });
      db.deleteKey(workspaceId, provider);
      return json(res, 200, {});
    }
    if (p === '/api/ai/usage') {
      const wsId = url.searchParams.get('ws') ?? '';
      if (!isAdminOf(me, wsId)) return json(res, 403, {});
      const days = Math.min(365, Number(url.searchParams.get('days') ?? 30));
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      return json(res, 200, { days, since, rows: db.usageSince(wsId, since) });
    }
    if (p === '/api/ai/status') {
      const wsId = url.searchParams.get('ws') ?? '';
      const asClient = memberOf(me).some((w) => w.id === wsId) ? undefined : portalsOf(me).find((pt) => pt.workspaceId === wsId);
      if (!asClient && !memberOf(me).some((w) => w.id === wsId)) return json(res, 403, {});
      return json(res, 200, { live: asClient ? !!aiFor(wsId, 'ask') : Object.values(JOB_OF).some((j) => !!aiFor(wsId, j)) });
    }
    const action = p.match(/^\/api\/ai\/(\w+)$/)?.[1];
    if (action && routes[action] && req.method === 'POST') {
      const b = await body(req);
      const asClient = memberOf(me).some((w) => w.id === b.workspaceId) ? undefined : portalsOf(me).find((pt) => pt.workspaceId === b.workspaceId);
      if (asClient) {
        // Client people: only "Ask AI", only when the company switched it on, within the monthly limit.
        const w = workspaces().find((x) => x.id === asClient.workspaceId) as any;
        const client = db.getDoc('clients', asClient.clientId) as any;
        const access = w && client ? accessFor(w, client) : null;
        if (action !== 'askmeetings' || b.workspaceId !== asClient.workspaceId || !access?.ai) return json(res, 403, { error: 'AI isn’t switched on for your portal.' });
        const ids = clientUserIds(asClient.clientId);
        if (db.monthlyUses(ids, 'ask') >= access.aiQuestions) return json(res, 429, { error: `You’ve used all ${access.aiQuestions} questions for this month.` });
      } else if (!memberOf(me).some((w) => w.id === b.workspaceId)) return json(res, 403, { error: 'Not in this workspace.' });
      const cfg = aiFor(b.workspaceId, JOB_OF[action]);
      if (!cfg) return json(res, 409, { error: 'no-key' });
      cfg.onUsage = (inTokens, outTokens) => db.logUsage({ workspaceId: b.workspaceId, userId: me, job: JOB_OF[action], provider: cfg.included ? 'included' : cfg.provider, model: cfg.model, inTokens, outTokens });
      return json(res, 200, await withAI(cfg, () => routes[action](b)));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err instanceof AIError ? err.status : (err as { status?: number }).status === 429 ? 503 : 500;
    console.error(`[${p}]`, err instanceof Error ? err.message : err);
    // Never leak keys or raw upstream errors.
    json(res, status, { error: err instanceof AIError ? err.message : status === 503 ? 'AI is busy, try again shortly.' : 'Something went wrong.' });
  }
}).listen(PORT, HOST, () => console.log(`Sprint2go on http://localhost:${PORT}`));

/* ---------- background jobs: scheduled mail, snoozes, task reminders ---------- */

setInterval(() => {
  const now = new Date().toISOString();
  const threads = (db.allDocs('threads') as any[]).flatMap((t) => {
    if (t.sendAt && t.sendAt <= now) return [{ ...t, sendAt: undefined, location: 'archive', messages: t.messages.map((m: any) => ({ ...m, date: now })) }];
    if (t.snoozedUntil && t.snoozedUntil <= now) return [{ ...t, snoozedUntil: undefined, unread: true }];
    return [];
  });
  if (threads.length) {
    db.writeDocs('threads', threads, [], null);
    broadcast('threads', threads, []);
  }
  const due = (db.allDocs('todos') as any[]).filter((t) => t.remindAt && !t.reminded && !t.done && t.remindAt <= now);
  if (due.length) {
    const todos = due.map((t) => ({ ...t, reminded: true }));
    const notices = due.flatMap((t) =>
      (t.assignees?.length ? t.assignees : [t.userId || t.createdBy]).filter(Boolean).map((who: string) => ({
        id: randomBytes(6).toString('hex'),
        userId: who,
        workspaceId: t.workspaceId ?? '',
        kind: 'task',
        text: `Reminder: “${t.title}”${t.due ? `, due ${t.due}` : ''}`,
        at: now,
        read: false,
        link: { app: 'tasks', id: t.id },
      })),
    );
    db.writeDocs('todos', todos, [], null);
    db.writeDocs('notices', notices, [], null);
    broadcast('todos', todos, []);
    broadcast('notices', notices, []);
  }
}, 30_000);
