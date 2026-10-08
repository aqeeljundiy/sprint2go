// Sprint2go local server: the app, its database, logins, live updates and the AI router, on one port.
// Run:  npm run server   (after `npm run build`), then open http://localhost:8787
// In development, `npm run dev` proxies /api here, so run both.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import * as db from './db.ts';
import * as ai from './ai.ts';
import { AIError, testKey, withAI, type AIConfig } from './llm.ts';
import { seed, RECORD_KEYS, type CollectionKey } from '../src/seed.ts';
import { DEFAULT_PERMISSIONS } from '../src/types.ts';
import { JOBS, PROVIDERS } from '../src/data/aiCatalog.ts';
import { languageName, languagesText } from '../src/data/languages.ts';
import * as tablesEngine from './tables.ts';
import { accessFor, can, channelsFor, clientPeople, companyOf, filesFor, guestRow, guestTable, isFreemail, meetingsFor, tasksFor } from '../src/clientView.ts';

for (const f of ['.env', '.env.example']) if (existsSync(f)) process.loadEnvFile(f); // .env wins: values already set are kept
const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1'; // localhost only
const DIST = join(process.cwd(), 'dist');
/** Sign-ups waiting for their email code (in memory: a restart just means starting again). */
const signups = new Map<string, { name: string; hash: string; code: string; tries: number; until: number }>();

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

// An app added after a company chose its apps (Tables) starts switched on, once; they can turn it off after.
for (const w of db.allDocs('workspaces') as any[]) {
  if (!Array.isArray(w.apps) || w.apps.includes('tables') || (w.appsAdded ?? []).includes('tables')) continue;
  db.writeDocs('workspaces', [{ ...w, apps: [...w.apps, 'tables'], appsAdded: [...(w.appsAdded ?? []), 'tables'] }], [], null);
}

// A collection added after the database was made (e.g. notes) starts with its demo data.
{
  const s0 = seed();
  for (const k of COLLS) if (!db.allDocs(k).length && toDocs(k, s0[k]).length) db.writeDocs(k, toDocs(k, s0[k]), [], null);
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
  // Everyone sees their own profile, even a new account with no company and nothing shared yet.
  const self = (coll: string, d: any) => (coll === 'users' && d.id === userId ? d : null);
  if (!portals.length) return (coll, d) => team(coll, d) ?? self(coll, d);
  return (coll, d) => team(coll, d) ?? portals.map((l) => l(coll, d)).find(Boolean) ?? self(coll, d);
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
  // Guests on your projects (some are people at other companies that use Sprint2go): so their names and photos show.
  const guests = new Set((db.allDocs('clients') as any[]).filter((c) => mine.has(c.workspaceId)).flatMap((c) => (c.people ?? []).map((p: any) => String(p.email).toLowerCase())));
  const channelOk = (c: any) => !!c && mine.has(c.workspaceId) && (!(c.private || c.kind === 'dm') || (c.members ?? []).includes(userId));
  const ok = (coll: string, d: any): boolean => {
    switch (coll) {
      case 'users':
        // Yourself, your companies' people, and the client people of your companies.
        return d.id === userId || people.has(d.id) || (!!d.clientOf && mine.has(d.clientOf.workspaceId)) || guests.has(String(d.email ?? '').toLowerCase());
      case 'workspaces':
        return mine.has(d.id);
      case 'statuses':
        return people.has(d.id);
      case 'notes':
        return mine.has(d.workspaceId) && (d.visibility !== 'private' || d.ownerId === userId); // private notes: only their owner
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
        if (d.id === me.id || d.clientOf?.clientId === clientId || people.some((p) => p.email.toLowerCase() === String(d.email ?? '').toLowerCase()))
          return { id: d.id, name: d.name, email: d.email, color: d.color, title: d.title, photo: d.photo, clientOf: d.clientOf };
        return team.has(d.id) ? { id: d.id, name: d.name, color: d.color, title: d.title, photo: d.photo, email: '' } : null;
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
        // The recording only when the guest settings allow it, and only as the server's playback links.
        const rec = d.bot && d.recording?.url && access.recordings !== 'off' ? { url: `/api/meet/audio/${d.id}`, ...(access.recordings === 'video' && d.recording.videoUrl ? { videoUrl: `/api/meet/video/${d.id}` } : {}) } : undefined;
        const base = { id: d.id, workspaceId: d.workspaceId, title: d.title, at: d.at, minutes: d.minutes, clientId: d.clientId, attendees: d.attendees, status: d.status, sharedWithClient: d.sharedWithClient, actions: [] as any[], summary: '', ...(rec ? { bot: true, recording: rec } : {}) };
        return notes ? { ...base, summary: d.summary, decisions: d.decisions, keyPoints: d.keyPoints, actions: (d.actions ?? []).map((a: any) => ({ title: a.title, due: a.due })) } : base;
      }
      case 'drive':
        return files.has(d.id) || (d.kind === 'folder' && d.clientId === clientId) ? d : null;
      case 'notices':
        return d.userId === me.id || d.userId === `email:${email}` ? d : null;
      case 'tables':
        return guestTable(client, d);
      case 'rows': {
        const t = db.getDoc('tables', d.tableId) as any;
        const g = t && guestTable(client, t);
        return g ? guestRow(g, d) : null;
      }
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
    case 'rows': {
      // A shared table: guests change only the fields the team opened up, and add rows only if allowed.
      const t = db.getDoc('tables', String((before ?? d).tableId)) as any;
      const share = t?.clientId === clientId && t.share?.enabled ? t.share : null;
      if (!share || !can(person, 'comment')) return null;
      const editable = new Set<string>(share.edit ?? []);
      const pick = (vals: any) => Object.fromEntries(Object.entries(vals ?? {}).filter(([k]) => editable.has(k)));
      const at = new Date().toISOString();
      if (!before) {
        if (!share.add) return null;
        return { id: d.id, workspaceId: t.workspaceId, tableId: t.id, values: { ...pick(d.values), ...(d.values?.[t.fields[0].id] != null ? { [t.fields[0].id]: d.values[t.fields[0].id] } : {}) }, order: Number(d.order) || Date.now(), createdBy: email, createdAt: at, updatedAt: at };
      }
      const changes = Object.entries(pick(d.values)).filter(([k, v]) => JSON.stringify(before.values?.[k] ?? null) !== JSON.stringify(v));
      if (!changes.length) return null;
      const history = [...(before.history ?? []), ...changes.map(([k, v]) => ({ by: email, at, fieldId: k, from: before.values?.[k] ?? null, to: v }))].slice(-50);
      return { ...before, values: { ...before.values, ...Object.fromEntries(changes) }, updatedAt: at, history };
    }
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

/**
 * People removed from a company, at the company's own domain: their guest access to other companies' projects
 * ends too (the company vouches for its domain; a personal gmail address isn't theirs to end).
 */
function leftCompany(updated: db.Doc[]): { email: string; company: string }[] {
  const out: { email: string; company: string }[] = [];
  for (const w of updated as any[]) {
    const before = db.getDoc('workspaces', w.id) as any;
    if (!before) continue;
    const now = new Set((w.members ?? []).map((m: any) => m.userId));
    for (const m of before.members ?? []) {
      if (now.has(m.userId)) continue;
      const email = String((db.getDoc('users', m.userId) as any)?.email ?? '').toLowerCase();
      const domain = email.split('@')[1];
      if (domain && (before.domains ?? []).map((d: string) => d.toLowerCase()).includes(domain)) out.push({ email, company: String(before.name ?? 'their company') });
    }
  }
  return out;
}
function endGuestAccess(leavers: { email: string; company: string }[]) {
  const gone = new Map(leavers.map((l) => [l.email, l.company]));
  const clients: db.Doc[] = [];
  const channels: db.Doc[] = [];
  const notices: db.Doc[] = [];
  for (const c of db.allDocs('clients') as any[]) {
    const out = (c.people ?? []).filter((p: any) => gone.has(String(p.email).toLowerCase()));
    if (!out.length) continue;
    clients.push({ ...c, people: c.people.filter((p: any) => !gone.has(String(p.email).toLowerCase())) });
    for (const p of out)
      if (c.ownerId)
        notices.push({ id: randomBytes(8).toString('hex'), userId: c.ownerId, workspaceId: c.workspaceId, kind: 'team', text: `${p.name ?? p.email} left ${gone.get(String(p.email).toLowerCase())}, so their guest access to ${c.name} ended`, at: new Date().toISOString(), read: false, link: { app: 'projects', id: c.id } } as db.Doc);
  }
  for (const ch of db.allDocs('channels') as any[]) {
    if (!(ch.guests ?? []).some((g: any) => gone.has(String(g.email).toLowerCase()))) continue;
    channels.push({ ...ch, guests: ch.guests.filter((g: any) => !gone.has(String(g.email).toLowerCase())) });
  }
  if (clients.length) (db.writeDocs('clients', clients, [], null), broadcast('clients', clients, []));
  if (channels.length) (db.writeDocs('channels', channels, [], null), broadcast('channels', channels, []));
  if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
}

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

/** Tables' engine (buttons, rules, webhooks) saves through here, so everyone sees the result live. */
const tablesEnv: tablesEngine.Env = { broadcast: (c, u, d) => broadcast(c, u, d) };

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

/* ---------- the meeting recorder (recorder/, its own service) ---------- */

// Sprint2go asks the recorder to send a bot; the bot reports back to /api/meet/recorder.
// The audio stays on the recorder and people play it through /api/meet/audio/:id.
const RECORDER_URL = process.env.RECORDER_URL?.replace(/\/$/, '');
const RECORDER_SECRET = process.env.RECORDER_SECRET ?? '';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const BOT_LIVE = new Set(['queued', 'joining', 'waiting_room', 'recording', 'stopping', 'processing']);
/** What only the bot writes while it's in a meeting; the app's own saves can't overwrite these. */
const BOT_FIELDS = ['status', 'error', 'log', 'transcript', 'recording', 'minutes', 'at'];
const STT = ['groq', 'deepgram', 'sumopod', 'openai'];

const recorder = (path: string, init: RequestInit = {}) =>
  fetch(`${RECORDER_URL}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${RECORDER_SECRET}` }, signal: AbortSignal.timeout(15_000) });

const sameSecret = (got: string) => {
  const a = Buffer.from(got), b = Buffer.from(RECORDER_SECRET);
  return !!RECORDER_SECRET && a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Speech to text for a company's meetings, in the company's meeting languages (main first), or one language
 * picked for this meeting. Mixed languages go to Gemini (through SumoPod) when the company has that key,
 * since it copes with two languages in one sentence; otherwise the service picked for meeting audio, else any speech key.
 */
function sttFor(ws: Ws & { meetings?: { languages?: string[] } }, only?: string) {
  const languages = only ? [only] : (ws.meetings?.languages ?? []).slice(0, 4);
  const pick = ws.ai?.jobs?.speech?.provider;
  for (const p of [languages.length > 1 ? 'sumopod' : null, pick, ...STT]) {
    if (!p || !STT.includes(p)) continue;
    const k = db.loadKey(ws.id, p);
    if (k) return { provider: p, apiKey: k.key, model: p === 'sumopod' ? 'gemini/gemini-3.5-flash' : null, languages, language: languages[0] ?? 'auto' };
  }
  return null;
}

function saveMeeting(m: db.Doc) {
  db.writeDocs('meetings', [m], [], null);
  broadcast('meetings', [m], []);
}
const meetLine = (message: string) => ({ message, at: new Date().toISOString() });

/** Which project a meeting belongs to: the company's first matching rule, else the project the AI named. */
function fileMeeting(ws: any, m: any, aiFolder: string, clients: any[]) {
  const speakers = (m.transcript ?? []).map((l: any) => String(l.speaker).toLowerCase());
  const text = `${m.title} ${m.summary}`.toLowerCase();
  const rule = (ws.meetingRules ?? []).find((r: any) =>
    r.kind === 'participant' ? speakers.includes(r.value.toLowerCase()) : r.kind === 'domain' ? (m.url ?? '').includes(r.value) || (m.attendees ?? []).some((a: string) => a.toLowerCase().includes(r.value.split('.')[0])) : text.includes(r.value.toLowerCase()),
  );
  if (rule) return { clientId: rule.clientId, filedBy: 'rule', by: 'rule' };
  const c = clients.find((x) => x.name.toLowerCase() === aiFolder.toLowerCase());
  return c ? { clientId: c.id, filedBy: 'ai', by: 'AI' } : { clientId: undefined, filedBy: undefined, by: '' };
}

/**
 * Keep only what the company chose for this kind of meeting, deleting the rest on the recorder.
 * Without notes (no transcript, or no AI) the audio always stays, so the meeting can be transcribed again later.
 */
async function trimRecording(cur: any, ws: any, clientId: string | undefined, haveNotes: boolean) {
  const settings = ws.meetings ?? {};
  const wanted = (clientId ? settings.clientMeetings : settings.internalMeetings) ?? settings.keep ?? 'audio';
  const keep = wanted === 'video' && cur.recording?.videoUrl ? 'video' : wanted === 'notes' && haveNotes ? 'notes' : 'audio';
  if (!cur.recording?.url) return { recording: cur.recording, line: [] as string[] };
  const what = haveNotes ? 'notes' : 'transcript';
  if (keep === 'notes') {
    await recorder(`/recordings/${cur.id}`, { method: 'DELETE' }).catch(() => {});
    return { recording: { keep: 'notes', sizeMb: 0 }, line: ['Kept: notes and transcript only (the recording was deleted)'] };
  }
  if (keep === 'audio' && cur.recording.videoUrl) {
    await recorder(`/recordings/${cur.id}?only=video`, { method: 'DELETE' }).catch(() => {});
    return { recording: { ...cur.recording, keep: 'audio', videoUrl: undefined, videoMb: undefined }, line: [`Kept: audio and ${what} (the video was deleted)`] };
  }
  return { recording: { ...cur.recording, keep }, line: [keep === 'video' ? `Kept: video, audio and ${what}` : `Kept: audio and ${what}`] };
}

/** After the bot has the transcript: notes with the company's "Meeting notes" AI, filing, what to keep. Again = a new transcript of the same meeting. */
async function writeMeetingNotes(id: string, again = false) {
  const m = db.getDoc('meetings', id) as any;
  const ws = workspaces().find((w) => w.id === m?.workspaceId) as any;
  if (!m || !ws) return;
  const finish = (extra: Record<string, unknown>, ...lines: string[]) => {
    const cur = db.getDoc('meetings', id) as any;
    if (cur) saveMeeting({ ...cur, ...extra, status: 'done', log: [...(cur.log ?? []), ...lines.map(meetLine), meetLine('Done')] });
  };
  const noNotes = async (why: string) => {
    if (again) return finish({}, why);
    const t = await trimRecording(m, ws, m.clientId, false);
    finish({ recording: t.recording }, why, ...t.line);
  };
  if (!m.transcript?.length) return noNotes('No transcript, so no notes');
  const cfg = aiFor(ws.id, 'meeting');
  if (!cfg) return noNotes('No AI is set up for meeting notes, so only the transcript is kept');
  cfg.onUsage = (inTokens, outTokens) => db.logUsage({ workspaceId: ws.id, userId: m.createdBy ?? '', job: 'meeting', provider: cfg.included ? 'included' : cfg.provider, model: cfg.model, inTokens, outTokens });
  try {
    const clients = (db.allDocs('clients') as any[]).filter((c) => c.workspaceId === ws.id && c.status !== 'ended');
    const members = ws.members.map((x: any) => String((db.getDoc('users', x.userId) as any)?.name ?? '').split(' ')[0]).filter(Boolean);
    const notes = await withAI(cfg, () => ai.meetingNotes({ title: m.title, transcript: m.transcript, clientNames: clients.map((c) => c.name), members }));
    const cur = db.getDoc('meetings', id) as any;
    // Transcribing again keeps the filing and the recording as they are.
    const filed = again || cur.filedBy === 'user' ? { clientId: cur.clientId, filedBy: cur.filedBy, by: '' } : fileMeeting(ws, { ...cur, summary: notes.summary }, notes.folder, clients);
    const kept = again ? { recording: cur.recording, line: [] as string[] } : await trimRecording(cur, ws, filed.clientId, true);
    const name = clients.find((c) => c.id === filed.clientId)?.name;
    finish(
      {
        title: cur.title || notes.title,
        summary: notes.summary,
        keyPoints: notes.keyPoints,
        decisions: notes.decisions,
        openQuestions: notes.openQuestions,
        topics: notes.topics,
        type: cur.type ?? notes.type,
        tags: notes.tags,
        actions: notes.actions,
        clientId: filed.clientId,
        filedBy: filed.filedBy,
        sharedWithClient: cur.sharedWithClient ?? (filed.clientId ? !!ws.meetings?.shareNotesWithClient : false),
        recording: kept.recording,
        needsTasks: true,
      },
      again ? 'Notes written again from the new transcript' : 'Notes written',
      ...(filed.by && name ? [`Filed in ${name} by ${filed.by}`] : []),
      ...kept.line,
    );
  } catch (err) {
    finish({}, `Could not write notes: ${err instanceof AIError ? err.message : 'the AI service failed'}. Try "Regenerate notes" later.`);
  }
}

/* ---------- the app itself ---------- */

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp' };
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  // The front door: people who aren't signed in see the landing page; /welcome always shows it.
  const signedIn = !!db.sessionUser(cookie(req, 's2g'));
  if ((path === '/' && !signedIn) || path === '/welcome') file = join(DIST, 'landing.html');
  else if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // single-page app
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
    // Sign-up: name, email and password, then a 6-digit code sent to the email. Until real email is wired up, the code
    // is printed in the server log and (outside production) shown on screen so the flow can be tried.
    if (p === '/api/signup' && req.method === 'POST') {
      const { name, email, password } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      if (String(name ?? '').trim().length < 2) return json(res, 400, { error: 'Tell us your name.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return json(res, 400, { error: 'That email doesn’t look right.' });
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: 'Use at least 8 characters for the password.' });
      if (db.findLogin(mail)) return json(res, 409, { error: 'There’s already an account with this email. Sign in instead.' });
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      signups.set(mail, { name: String(name).trim().slice(0, 80), hash: db.hashPassword(password), code, tries: 0, until: Date.now() + 15 * 60_000 });
      console.log(`Sign-up code for ${mail}: ${code}`);
      return json(res, 200, { ok: true, ...(process.env.NODE_ENV === 'production' ? {} : { devCode: code }) });
    }
    if (p === '/api/signup/verify' && req.method === 'POST') {
      const { email, code } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      const s = signups.get(mail);
      if (!s || s.until < Date.now()) return json(res, 410, { error: 'That code has expired. Start again.' });
      if (++s.tries > 5) return (signups.delete(mail), json(res, 429, { error: 'Too many tries. Start again.' }));
      if (String(code ?? '').replace(/\D/g, '') !== s.code) return json(res, 400, { error: 'That code isn’t right.' });
      if (db.findLogin(mail)) return json(res, 409, { error: 'There’s already an account with this email. Sign in instead.' });
      signups.delete(mail);
      // Someone already invited somewhere (a guest without a password yet) keeps their person; otherwise a new one.
      const known = (db.allDocs('users') as any[]).find((u) => String(u.email).toLowerCase() === mail && !db.hasLogin(u.id));
      const user = known ?? { id: 'u-' + randomBytes(6).toString('hex'), name: s.name, email: mail, title: '', color: ['#5b5bf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#d946ef'][randomInt(0, 6)] };
      if (!known) {
        db.writeDocs('users', [user], [], user.id);
        broadcast('users', [user], []);
      }
      db.setLoginHash(user.id, mail, s.hash);
      res.setHeader('set-cookie', `s2g=${db.newSession(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
      return json(res, 200, { me: user.id });
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
      // Never overwrite an existing sign-in (old links made before this check, or a colleague's invite to someone who already has an account).
      if (db.hasLogin(inv.user_id)) return json(res, 409, { error: 'This account already has a password. Sign in instead.' });
      db.setLogin(inv.user_id, inv.email, password);
      res.setHeader('set-cookie', `s2g=${db.newSession(inv.user_id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
      return json(res, 200, { me: inv.user_id });
    }

    // A table's own address: forms, ads, Zapier or scripts post rows here (no session: the secret is in the URL).
    const hook = p.match(/^\/api\/hooks\/([A-Za-z0-9_-]{16,64})$/);
    if (hook) {
      res.setHeader('access-control-allow-origin', '*');
      if (req.method === 'OPTIONS') {
        res.setHeader('access-control-allow-headers', 'content-type');
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET') return json(res, 200, { ok: true, hint: 'POST JSON or form data here to add a row.' });
      if (req.method !== 'POST') return json(res, 405, {});
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1_000_000) return json(res, 413, { error: 'Too large' });
      }
      const type = String(req.headers['content-type'] ?? '');
      let payload: unknown;
      try {
        payload = type.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : raw ? JSON.parse(raw) : {};
      } catch {
        return json(res, 400, { error: 'Send JSON or form data' });
      }
      const out = tablesEngine.intake(tablesEnv, hook[1], payload);
      return json(res, out.status, out.body);
    }

    // The recorder reporting on a bot (no session: it signs with the shared secret).
    if (p === '/api/meet/recorder' && req.method === 'POST') {
      if (!sameSecret(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))) return json(res, 401, {});
      const b = await body(req);
      const m = db.getDoc('meetings', String(b.id ?? '')) as any;
      if (!m?.bot) return json(res, 404, {});
      const next = { ...m };
      if (Array.isArray(b.log) && b.log.length) next.log = [...(m.log ?? []), ...b.log].slice(-300);
      if (Array.isArray(b.utterances) && b.utterances.length) next.transcript = [...(m.transcript ?? []), ...b.utterances];
      if (b.startedAt) next.at = b.startedAt;
      if (b.error) next.error = String(b.error).slice(0, 300);
      if (b.status === 'recorded') {
        if (Array.isArray(b.transcript)) next.transcript = b.transcript;
        if (b.recording) {
          next.minutes = Math.max(1, Math.round(b.recording.seconds / 60));
          const video = b.recording.videoMb ? { videoUrl: `/api/meet/video/${m.id}`, videoMb: b.recording.videoMb } : {};
          next.recording = { keep: b.recording.videoMb ? 'video' : 'audio', sizeMb: b.recording.sizeMb, seconds: b.recording.seconds, url: `/api/meet/audio/${m.id}`, ...video };
        }
        next.status = 'processing';
        next.log = [...(next.log ?? []), meetLine('Writing notes')];
      } else if (b.status === 'again-failed') next.status = 'done';
      else if (typeof b.status === 'string' && (BOT_LIVE.has(b.status) || ['failed', 'stopped'].includes(b.status))) next.status = b.status;
      saveMeeting(next);
      if (b.status === 'recorded') void writeMeetingNotes(m.id, !!b.again);
      return json(res, 200, {});
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
      if (!client || !w || client.workspaceId !== w.id) return json(res, 404, { error: 'No such project.' });
      if (!memberOf(me).some((x) => x.id === w.id)) {
        // A client person inviting a colleague.
        const access = accessFor(w, client);
        // Their colleagues (same email domain as theirs, not gmail and the like) or people at the project's domain.
        const domainOf = (e: string) => e.split('@')[1]?.toLowerCase() ?? '';
        const own = domainOf(String(personOf(me)?.email ?? ''));
        const sameDomain = (!!own && !isFreemail(own) && domainOf(mail) === own) || (!!client.domain && domainOf(mail) === String(client.domain).toLowerCase());
        if (!portalsOf(me).some((pt) => pt.clientId === client.id) || access.invites !== 'direct' || !sameDomain) return json(res, 403, { error: 'This needs the team’s approval.' });
      }
      // Someone who already signs in (e.g. a teammate at a company that uses Sprint2go) just gets access, no link.
      const existing = db.findLogin(mail);
      let user = (db.allDocs('users') as any[]).find((u) => String(u.email).toLowerCase() === mail);
      if (!user) {
        user = { id: 'cu-' + randomBytes(5).toString('hex'), name: String(name).trim(), email: mail, color: client.color ?? '#64748b', title: client.name, clientOf: { workspaceId: w.id, clientId: client.id } };
        db.writeDocs('users', [user], [], me);
        broadcast('users', [user], []);
      }
      // On the client's people list, and a guest in its shared channels.
      const people = client.people ?? [];
      const known = people.find((x: any) => String(x.email).toLowerCase() === mail);
      // A guest's colleague works where they do: "Name · Company" from the start.
      const inviter = people.find((x: any) => String(x.email).toLowerCase() === String(personOf(me)?.email ?? '').toLowerCase());
      const sameAsInviter = !!inviter && mail.split('@')[1] === String(inviter.email).split('@')[1]?.toLowerCase();
      const company = sameAsInviter ? companyOf(inviter.email, inviter.company, client) : undefined;
      const status = existing ? 'joined' : 'invited'; // already signs in: nothing to accept
      const nextClient = { ...client, people: known ? people.map((x: any) => (String(x.email).toLowerCase() === mail && x.status !== 'joined' ? { ...x, status, ...(company && !x.company ? { company } : {}) } : x)) : [...people, { email: mail, name: String(name).trim(), role: 'collaborator', status, invitedBy: me, at: new Date().toISOString(), ...(company ? { company } : {}) }] };
      db.writeDocs('clients', [nextClient], [], me);
      broadcast('clients', [nextClient], []);
      const chans = (db.allDocs('channels') as any[]).filter((c) => c.clientId === client.id && c.category === 'shared' && !(c.guests ?? []).some((g: any) => String(g.email).toLowerCase() === mail));
      const withGuest = chans.map((c) => ({ ...c, guests: [...(c.guests ?? []), { email: mail, name: String(name).trim(), status, invitedBy: me, at: new Date().toISOString() }] }));
      if (withGuest.length) {
        db.writeDocs('channels', withGuest, [], me);
        broadcast('channels', withGuest, []);
      }
      return json(res, 200, { link: existing ? null : `/?invite=${db.newInvite(user.id, mail)}` });
    }

    // Anyone signed in (a guest too) can start their own company, free: they're its owner. Guests can't write
    // workspaces through sync (they're in no company yet), so it's made here.
    if (p === '/api/workspace' && req.method === 'POST') {
      const { workspace: w, users: invited = [] } = await body(req);
      if (!w || typeof w.id !== 'string' || typeof w.name !== 'string' || !w.name.trim()) return json(res, 400, { error: 'Give the company a name.' });
      if (db.getDoc('workspaces', w.id)) return json(res, 409, { error: 'That workspace already exists.' });
      const taken = new Set((db.allDocs('users') as any[]).map((u) => String(u.email ?? '').toLowerCase()));
      const people = (invited as any[]).filter((u) => u && typeof u.id === 'string' && !db.getDoc('users', u.id) && typeof u.email === 'string' && !taken.has(u.email.toLowerCase()));
      const ids = new Set(people.map((u) => u.id));
      const members = [{ userId: me, role: 'owner' }, ...((w.members ?? []) as any[]).filter((m) => ids.has(m.userId) && ['admin', 'member'].includes(m.role))];
      const ws = { ...w, name: String(w.name).trim().slice(0, 80), members };
      const general = { id: 'ch-' + randomBytes(5).toString('hex'), workspaceId: ws.id, kind: 'channel', name: 'general', members: members.map((m) => m.userId), topic: 'Everyone at ' + ws.name };
      db.writeDocs('users', people, [], me);
      db.writeDocs('workspaces', [ws], [], me);
      db.writeDocs('channels', [general], [], me);
      broadcast('users', people, []);
      broadcast('workspaces', [ws], []);
      broadcast('channels', [general], []);
      return json(res, 200, { id: ws.id });
    }

    // An admin invites someone: they get a link to set their own password.
    if (p === '/api/invite' && req.method === 'POST') {
      const { userId, email } = await body(req);
      if (!memberOf(me).some((w) => isAdminOf(me, w.id))) return json(res, 403, { error: 'Only admins can invite people.' });
      if (typeof email !== 'string' || !email.includes('@')) return json(res, 400, { error: 'Invalid email' });
      const target = String(userId ?? '');
      if (!target) return json(res, 400, { error: 'Who?' });
      // An invite sets a password, so it can only be for someone who has never signed in: a new person (not saved yet,
      // their doc may still be on its way) or someone added to a company you run. Never an existing account.
      if (db.hasLogin(target)) return json(res, 409, { error: 'They already have a sign-in.' });
      const existing = db.getDoc('users', target);
      if (existing && !memberOf(me).some((w) => isAdminOf(me, w.id) && w.members.some((m: any) => m.userId === target))) return json(res, 403, { error: 'Only their own company can invite them.' });
      const taken = db.findLogin(email);
      if (taken) return json(res, 409, { error: 'Someone already uses that email.' });
      return json(res, 200, { link: `/?invite=${db.newInvite(target, email)}` });
    }

    // Saves changes and tells everyone else who has the app open.
    /* Tables: press a button; send a test webhook */
    if (p === '/api/tables/run' && req.method === 'POST') {
      const b = await body(req);
      const t = db.getDoc('tables', String(b.tableId ?? '')) as any;
      const team = !!t && memberOf(me).some((w) => w.id === t.workspaceId);
      // Guests may press the buttons the team shared with them, on their own project's table, and fill only fields they can edit.
      const guest = !team && !!t && t.share?.enabled && (t.share.buttons ?? []).includes(b.fieldId) && portalsOf(me).some((pt) => pt.clientId === t.clientId);
      if (!t || (!team && !guest)) return json(res, 404, { error: 'No such table.' });
      const f = (t.fields ?? []).find((x: any) => x.id === b.fieldId);
      if (team && f?.button?.who === 'admins' && !isAdminOf(me, t.workspaceId)) return json(res, 403, { error: 'Only admins can press this button.' });
      const input = guest ? Object.fromEntries(Object.entries(b.input ?? {}).filter(([k]) => (t.share.edit ?? []).includes(k))) : (b.input ?? {});
      const out = await tablesEngine.runButton(tablesEnv, t.id, String(b.rowId ?? ''), String(b.fieldId ?? ''), me, input as any);
      // Guests see that it worked, not where the team's webhooks go or what the steps were.
      return json(res, 200, guest ? { ok: out.ok, results: [{ ok: out.ok, note: out.ok ? 'Done' : 'Didn’t work; the team can see why', ...(out.results.find((x) => x.open) ? { open: out.results.find((x) => x.open)!.open } : {}) }] } : out);
    }
    if (p === '/api/tables/import' && req.method === 'POST') {
      const b = await body(req);
      const t = db.getDoc('tables', String(b.tableId ?? '')) as any;
      if (!t || !memberOf(me).some((w) => w.id === t.workspaceId)) return json(res, 404, { error: 'No such table.' });
      const out = tablesEngine.importRows(tablesEnv, t.id, me, b);
      return json(res, out.status, out.body);
    }
    if (p === '/api/tables/test-hook' && req.method === 'POST') {
      const b = await body(req);
      const t = db.getDoc('tables', String(b.tableId ?? '')) as any;
      if (!t || !memberOf(me).some((w) => w.id === t.workspaceId)) return json(res, 404, { error: 'No such table.' });
      const a = { kind: 'webhook' as const, url: String(b.url ?? ''), fields: b.fields };
      const payload = tablesEngine.testPayload(t, a);
      const out = await tablesEngine.sendHook(t, a.url, payload);
      return json(res, 200, { ...out, payload, reply: typeof out.reply === 'string' ? out.reply.slice(0, 500) : out.reply });
    }

    /* Meetings: send the recorder bot, stop it, play its audio */
    if (p === '/api/meet/status') return json(res, 200, { recorder: !!RECORDER_URL && !!RECORDER_SECRET });
    if (p === '/api/meet/bot' && req.method === 'POST') {
      const { meeting } = await body(req);
      const ws = workspaces().find((w) => w.id === meeting?.workspaceId) as any;
      if (!ws || !memberOf(me).some((w) => w.id === ws.id)) return json(res, 403, { error: 'Not in this company.' });
      if (ws.meetings?.whoCanRecord === 'admins' && !isAdminOf(me, ws.id)) return json(res, 403, { error: 'Only admins can send the notetaker here.' });
      if (!RECORDER_URL || !RECORDER_SECRET) return json(res, 409, { error: 'The recorder isn’t set up on this server.' });
      if (typeof meeting.id !== 'string' || !/^[\w-]{4,80}$/.test(meeting.id)) return json(res, 400, { error: 'Bad meeting.' });
      const doc = { ...meeting, bot: true, status: 'queued', createdBy: me, transcript: [], log: [...(meeting.log ?? []).slice(0, 5)] };
      saveMeeting(doc);
      const names = ws.members.map((x: any) => (db.getDoc('users', x.userId) as any)?.name).filter(Boolean);
      const sent = await recorder('/bots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Video when this kind of meeting keeps video (or might: it's filed after the meeting, and an unneeded video is deleted then).
        body: JSON.stringify({ id: doc.id, url: doc.url, botName: doc.botName, callback: `${PUBLIC_URL}/api/meet/recorder`, stt: sttFor(ws, doc.language), names, announce: ws.meetings?.announce !== false, video: (doc.clientId ? [ws.meetings?.clientMeetings] : [ws.meetings?.clientMeetings, ws.meetings?.internalMeetings]).includes('video') }),
      }).then(async (r) => (r.ok ? null : ((await r.json().catch(() => ({}))) as any).error ?? `Recorder said ${r.status}`), () => 'The recorder didn’t answer');
      if (sent) saveMeeting({ ...doc, status: 'failed', error: sent, log: [...doc.log, meetLine(`Couldn’t send the bot: ${sent}`)] });
      return json(res, sent ? 502 : 200, sent ? { error: sent } : {});
    }
    const meetId = p.match(/^\/api\/meet\/(stop|audio|video|again)\/([\w-]+)$/);
    if (meetId) {
      const m = db.getDoc('meetings', meetId[2]) as any;
      const staff = !!m?.bot && memberOf(me).some((w) => w.id === m.workspaceId);
      // A guest may play a recording of their project's meeting when its guest settings allow recordings.
      const guestPlays = () => {
        if (!m?.bot || !m.clientId || (meetId[1] !== 'audio' && meetId[1] !== 'video')) return false;
        if (!portalsOf(me).some((pt) => pt.workspaceId === m.workspaceId && pt.clientId === m.clientId)) return false;
        const w = workspaces().find((x) => x.id === m.workspaceId) as any;
        const client = db.getDoc('clients', m.clientId) as any;
        if (!w || !client) return false;
        const access = accessFor(w, client);
        if (access.recordings === 'off' || (meetId[1] === 'video' && access.recordings !== 'video')) return false;
        const people = clientPeople(client, db.allDocs('channels') as any[]);
        return meetingsFor(client, people, [m], access).length > 0;
      };
      if (!staff && !guestPlays()) return json(res, 404, { error: 'No such meeting.' });
      if (!staff && meetId[1] !== 'audio' && meetId[1] !== 'video') return json(res, 404, { error: 'No such meeting.' });
      if (meetId[1] === 'stop' && req.method === 'POST') {
        const r = await recorder(`/bots/${m.id}/stop`, { method: 'POST' }).catch(() => null);
        // Not running any more (the recorder restarted, say): close it here so it doesn't spin forever.
        const gone = !r || r.status === 404;
        saveMeeting({ ...m, status: gone ? (m.status === 'recording' ? 'failed' : 'stopped') : 'stopping', log: [...(m.log ?? []), meetLine(gone ? 'The bot was no longer running' : 'Asked to leave')] });
        return json(res, 200, {});
      }
      if (meetId[1] === 'again' && req.method === 'POST') {
        // Transcribe the kept audio again, in another language or with the company's languages, then rewrite the notes.
        const { language } = await body(req);
        const ws = workspaces().find((w) => w.id === m.workspaceId) as any;
        const only = typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : undefined;
        const stt = sttFor(ws, only);
        if (!stt) return json(res, 409, { error: 'Add a speech-to-text key in Settings → AI first.' });
        if (!m.recording?.url) return json(res, 409, { error: 'This meeting’s audio wasn’t kept.' });
        const names = ws.members.map((x: any) => (db.getDoc('users', x.userId) as any)?.name).filter(Boolean);
        const r = await recorder(`/recordings/${m.id}/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stt, names, callback: `${PUBLIC_URL}/api/meet/recorder` }) }).catch(() => null);
        if (!r?.ok) return json(res, 502, { error: 'The recorder couldn’t start transcribing.' });
        saveMeeting({ ...m, ...(only ? { language: only } : {}), status: 'processing', log: [...(m.log ?? []), meetLine(`Transcribing again in ${only ? languageName(only) : languagesText(ws.meetings?.languages)}`)] });
        return json(res, 200, {});
      }
      if (meetId[1] === 'audio' || meetId[1] === 'video') {
        const watch = m.access?.watch ?? 'everyone';
        const me2 = (db.getDoc('users', me) as any)?.name;
        if (staff && ((watch === 'admins' && !isAdminOf(me, m.workspaceId)) || (watch === 'attendees' && !isAdminOf(me, m.workspaceId) && m.createdBy !== me && !(m.attendees ?? []).includes(me2)))) return json(res, 403, { error: 'You can’t play this recording.' });
        const r = await recorder(`/recordings/${m.id}${meetId[1] === 'video' ? '/video' : ''}`, { headers: req.headers.range ? { range: String(req.headers.range) } : {} }).catch(() => null);
        if (!r?.ok || !r.body) return json(res, r?.status === 404 ? 404 : 502, { error: 'Recording not available.' });
        const h: Record<string, string> = { 'cache-control': 'private, max-age=3600' };
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const v = r.headers.get(k);
          if (v) h[k] = v;
        }
        res.writeHead(r.status, h);
        return Readable.fromWeb(r.body as any).pipe(res);
      }
    }

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
      // Your own profile: name, title, colour and photo (a small image), whoever you are. Nothing else on it.
      const ownProfile = (d: db.Doc) => {
        if (coll !== 'users' || d.id !== me) return null;
        const before = db.getDoc('users', me);
        if (!before) return null;
        const photo = typeof d.photo === 'string' && d.photo.startsWith('data:image/') && d.photo.length < 300_000 ? d.photo : undefined;
        const hiddenApps = Array.isArray(d.hiddenApps) ? d.hiddenApps.filter((a: unknown) => typeof a === 'string' && /^[a-z]{2,12}$/.test(a)).slice(0, 12) : undefined;
        return { ...before, name: String(d.name ?? before.name).slice(0, 80) || before.name, title: String(d.title ?? '').slice(0, 80), color: typeof d.color === 'string' ? d.color.slice(0, 20) : before.color, photo, hiddenApps };
      };
      // Client changes (in a company where they're a client): only their own kinds, merged into what's stored.
      const ok = (upserts as db.Doc[])
        .filter((d) => d && typeof d.id === 'string')
        .map((d) => ownProfile(d) ?? (asTeam(d) ? d : (portals.map((pt) => clientWrite(pt, coll, d)).find(Boolean) ?? null)))
        .filter(Boolean)
        .map((d) => {
          // A project's picture: a small image only (like profile photos).
          if (coll === 'clients' && d && 'photo' in d && d.photo != null && !(typeof d.photo === 'string' && d.photo.startsWith('data:image/') && d.photo.length < 300_000)) return { ...d, photo: undefined };
          // A meeting the recorder bot is still in: the bot's fields come from the bot, not from an older copy in someone's app.
          const before = coll === 'meetings' ? (db.getDoc(coll, d!.id) as any) : null;
          // Keeping less of a finished recording deletes it on the recorder, so the storage really comes back.
          if (before?.recording?.url && !BOT_LIVE.has(before.status) && RECORDER_URL) {
            const keep = (d as any).recording?.keep;
            if (keep === 'notes') {
              void recorder(`/recordings/${d!.id}`, { method: 'DELETE' }).catch(() => {});
              return { ...d, recording: { keep: 'notes', sizeMb: 0 } };
            }
            if (keep === 'audio' && before.recording.videoUrl) {
              void recorder(`/recordings/${d!.id}?only=video`, { method: 'DELETE' }).catch(() => {});
              return { ...d, recording: { ...before.recording, keep: 'audio', videoUrl: undefined, videoMb: undefined } };
            }
          }
          if (!before?.bot || !BOT_LIVE.has(before.status)) return d;
          return { ...d, bot: true, ...Object.fromEntries(BOT_FIELDS.filter((k) => k in before).map((k) => [k, before[k]])) };
        }) as db.Doc[];
      // What Members may do (Settings > Permissions); owners and admins can do everything.
      const permsOf = (wsId: string) => ({ ...DEFAULT_PERMISSIONS, ...((db.getDoc('workspaces', wsId) as any)?.permissions ?? {}) });
      const limited = (wsId: unknown) => typeof wsId === 'string' && mine.has(wsId) && !isAdminOf(me, wsId);
      const mayWrite = (d: db.Doc): db.Doc | null => {
        const wsId = d.workspaceId as string;
        if (!limited(wsId)) return d;
        const p = permsOf(wsId);
        const before = db.getDoc(coll, d.id) as any;
        if (coll === 'clients' && !before && !p.createProjects) return null;
        if (coll === 'teams') {
          if (!before) return p.createTeams ? d : null;
          if (before.leadId === me) return d;
          // Anyone else changes only themselves: in or out (in only when the team is open), or asking to join.
          const wasIn = (before.members ?? []).includes(me);
          const nowIn = ((d as any).members ?? []).includes(me);
          const others = (before.members ?? []).filter((x: string) => x !== me);
          const members = nowIn && !wasIn && before.join !== 'open' ? before.members ?? [] : [...others, ...(nowIn ? [me] : [])];
          const ask = ((d as any).requests ?? []).find((x: any) => x?.userId === me);
          const requests = [...(before.requests ?? []).filter((x: any) => x.userId !== me), ...(ask && !members.includes(me) ? [{ userId: me, at: String(ask.at ?? new Date().toISOString()) }] : [])];
          return { ...before, members, requests } as db.Doc;
        }
        if (coll === 'tables' && before && !p.editTables && before.createdBy !== me) {
          // Rows and new choices yes; the columns themselves, automations and sharing stay as they were.
          const fields = (before.fields ?? []).map((bf: any) => {
            const nf = ((d as any).fields ?? []).find((x: any) => x.id === bf.id);
            return nf && nf.type === bf.type ? { ...bf, options: nf.options ?? bf.options } : bf;
          });
          return { ...d, fields, rules: before.rules, intake: before.intake, signingSecret: before.signingSecret, share: before.share } as db.Doc;
        }
        return d;
      };
      const mayDelete = (before: any) => {
        if (!before || !limited(before.workspaceId)) return true;
        if (coll === 'teams') return false; // only admins delete teams
        if (permsOf(before.workspaceId).deleteThings) return true;
        if (coll === 'clients') return false;
        if (coll === 'tables') return before.createdBy === me;
        if (coll === 'channels') return before.kind === 'dm' || before.ownerId === me;
        if (coll === 'notes' || coll === 'drive') return before.ownerId === me;
        return true;
      };
      for (let i = ok.length - 1; i >= 0; i--) {
        const d = mayWrite(ok[i]!);
        if (d) ok[i] = d;
        else ok.splice(i, 1);
      }
      const dels = mine.size
        ? (deletes as string[]).filter((id) => {
            const before = db.getDoc(coll, id);
            return !before || (see(coll, before) && mayDelete(before));
          })
        : [];
      const botAudio = coll === 'meetings' ? dels.filter((id: string) => (db.getDoc(coll, id) as any)?.recording?.url) : [];
      // Rows: remember them as they were, so rules can tell what was added or changed.
      const rowsBefore = coll === 'rows' ? new Map(ok.map((d) => [d!.id, db.getDoc('rows', d!.id) as any])) : null;
      // Tables: the delivery log and the last sample are the server's; mappings merge (a key set to "" means skip it).
      if (coll === 'tables')
        for (let i = 0; i < ok.length; i++) {
          const before = db.getDoc('tables', ok[i]!.id) as any;
          if (!before) continue;
          const d = ok[i] as any;
          // listening: once a test arrives the server switches it off; an older copy can't switch it back on unless it asks afresh.
          const listening = !!d.intake?.listening && String(d.intake?.listenFrom ?? '') > String(before.intake?.testAt ?? '');
          ok[i] = { ...d, log: before.log, ruleRuns: before.ruleRuns, turns: before.turns, intake: d.intake ? { ...d.intake, sample: before.intake?.sample, testAt: before.intake?.testAt, listening, mapping: { ...(before.intake?.mapping ?? {}), ...(d.intake.mapping ?? {}) } } : d.intake } as db.Doc;
        }
      const leavers = coll === 'workspaces' ? leftCompany(ok) : [];
      db.writeDocs(coll, ok, dels, me);
      if (leavers.length) endGuestAccess(leavers);
      broadcast(coll, ok, dels, req.headers['x-conn'] as string | undefined);
      if (rowsBefore) tablesEngine.afterRowWrite(tablesEnv, rowsBefore as any, ok as any, me);
      // A deleted meeting takes its recording with it.
      if (RECORDER_URL) for (const id of botAudio) recorder(`/recordings/${id}`, { method: 'DELETE' }).catch(() => {});
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

    // Vault: shared logins. Only people given access see an item; passwords and 2FA codes leave the server one at a time, logged.
    if (p.startsWith('/api/vault')) {
      const wsId = url.searchParams.get('ws') ?? '';
      const teamsOf = (uid: string) => (db.allDocs('teams') as any[]).filter((t) => (t.members ?? []).includes(uid)).map((t) => t.id);
      const canSee = (it: db.VaultRow) =>
        memberOf(me).some((w) => w.id === it.workspaceId) &&
        (it.createdBy === me || isAdminOf(me, it.workspaceId) || it.meta.access.everyone || it.meta.access.userIds.includes(me) || it.meta.access.teamIds.some((t) => teamsOf(me).includes(t)));
      const canEdit = (it: db.VaultRow) => it.createdBy === me || isAdminOf(me, it.workspaceId);
      const m = p.match(/^\/api\/vault\/([\w-]+)(?:\/(reveal|code|log))?$/);
      if (p === '/api/vault' && req.method === 'GET') {
        if (!memberOf(me).some((w) => w.id === wsId)) return json(res, 403, {});
        return json(res, 200, { items: db.vaultList(wsId).filter(canSee).map((it) => ({ ...it, canEdit: canEdit(it) })) });
      }
      if (p === '/api/vault' && req.method === 'POST') {
        const b = await body(req);
        if (!memberOf(me).some((w) => w.id === b.workspaceId)) return json(res, 403, {});
        const id = typeof b.id === 'string' && b.id ? b.id : 'v-' + randomBytes(6).toString('hex');
        const before = db.vaultGet(id);
        if (before && !canEdit(before)) return json(res, 403, { error: 'Only the person who added it, or an admin, can change it.' });
        if (b.totp) {
          try {
            db.totpCode(String(b.totp));
          } catch {
            return json(res, 400, { error: 'That 2FA key doesn’t look right. Paste the setup key (letters and numbers) or the otpauth:// link.' });
          }
        }
        const meta: db.VaultMeta = {
          title: String(b.meta?.title ?? '').slice(0, 120) || 'Login',
          url: b.meta?.url ? String(b.meta.url).slice(0, 300) : undefined,
          username: b.meta?.username ? String(b.meta.username).slice(0, 200) : undefined,
          clientId: b.meta?.clientId || undefined,
          access: { everyone: !!b.meta?.access?.everyone, userIds: (b.meta?.access?.userIds ?? []).map(String), teamIds: (b.meta?.access?.teamIds ?? []).map(String) },
        };
        db.vaultSave({ id, workspaceId: before?.workspaceId ?? b.workspaceId, meta, password: b.password, totp: b.totp, notes: b.notes, by: me });
        db.vaultLog(id, me, before ? 'changed it' : 'added it');
        return json(res, 200, { id });
      }
      const item = m ? db.vaultGet(m[1]) : undefined;
      if (!m || !item || !canSee(item)) return json(res, 404, { error: 'Not found.' });
      if (!m[2] && req.method === 'DELETE') {
        if (!canEdit(item)) return json(res, 403, { error: 'Only the person who added it, or an admin, can delete it.' });
        db.vaultDelete(item.id);
        return json(res, 200, {});
      }
      if (m[2] === 'reveal' && req.method === 'POST') {
        const { field } = await body(req);
        if (field !== 'password' && field !== 'notes') return json(res, 400, {});
        db.vaultLog(item.id, me, field === 'password' ? 'copied the password' : 'read the notes');
        return json(res, 200, { value: db.vaultSecret(item.id, field) ?? '' });
      }
      if (m[2] === 'code' && req.method === 'POST') {
        const secret = db.vaultSecret(item.id, 'totp');
        if (!secret) return json(res, 404, { error: 'No 2FA on this login.' });
        db.vaultLog(item.id, me, 'used a 2FA code');
        return json(res, 200, db.totpCode(secret));
      }
      if (m[2] === 'log' && req.method === 'GET') {
        if (!canEdit(item)) return json(res, 403, {});
        return json(res, 200, { log: db.vaultLogFor(item.id) });
      }
      return json(res, 404, {});
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

// Tables' scheduled rules: checked every minute, each runs once on the days it's due.
setInterval(() => tablesEngine.runSchedules(tablesEnv), 60_000);

// Old meeting video becomes audio after the company's "Turn old video into audio" setting (the audio file stays).
setInterval(() => {
  if (!RECORDER_URL) return;
  const now = Date.now();
  for (const m of db.allDocs('meetings') as any[]) {
    if (!m.recording?.videoUrl) continue;
    const days = (workspaces().find((w) => w.id === m.workspaceId) as any)?.meetings?.downgradeAfter ?? 60;
    if (!days || now - Date.parse(m.at) < days * 86_400_000) continue;
    void recorder(`/recordings/${m.id}?only=video`, { method: 'DELETE' }).then(
      () => saveMeeting({ ...m, recording: { ...m.recording, keep: 'audio', videoUrl: undefined, videoMb: undefined }, log: [...(m.log ?? []), meetLine(`Video turned into audio after ${days} days`)] }),
      () => {},
    );
  }
}, 3_600_000);

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
