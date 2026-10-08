// sprint2go local server: the app, its database, logins, live updates and the AI router, on one port.
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
import { mailConfigured, sendMail, simpleHtml } from './mail.ts';
import * as admin from './admin.ts';
import * as mailer from './mailer.ts';
import { ownership as domainOwnership } from './domains.ts';
import * as platform from './platform.ts';
import * as support from './support.ts';
import { gzipSync } from 'node:zlib';
import { accessFor, can, channelsFor, clientPeople, companyOf, filesFor, guestRow, guestTable, isFreemail, meetingsFor, tasksFor } from '../src/clientView.ts';

for (const f of ['.env', '.env.example']) if (existsSync(f)) process.loadEnvFile(f); // .env wins: values already set are kept
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1'; // localhost only, unless hosted (HOST=0.0.0.0 in the container)
const DIST = join(process.cwd(), 'dist');
const STARTED = Date.now();
/** Sign-ups waiting for their email code (in memory: a restart just means starting again). */
const signups = new Map<string, { name: string; hash: string; code: string; tries: number; until: number }>();

/* ---------- first run: copy the demo company into the database ---------- */

const COLLS = Object.keys(seed()) as CollectionKey[];
const toDocs = (key: CollectionKey, value: unknown): db.Doc[] =>
  RECORD_KEYS.includes(key) ? Object.entries(value as Record<string, unknown>).map(([id, v]) => ({ id, value: v })) : (value as db.Doc[]);

if (db.isEmpty() && (process.env.S2G_DEMO === '1' || process.env.NODE_ENV !== 'production')) {
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

// A collection added after the database was made (e.g. notes) starts with its demo data. Demo databases only:
// in production this refilled a freshly emptied database with the demo companies.
if (process.env.S2G_DEMO === '1' || process.env.NODE_ENV !== 'production') {
  const s0 = seed();
  for (const k of COLLS) if (!db.allDocs(k).length && toDocs(k, s0[k]).length) db.writeDocs(k, toDocs(k, s0[k]), [], null);
}

platform.bootstrapOperators();
admin.loadPricing();

// Once, on a production server and only when S2G_PURGE_DEMO=1 is set: the demo companies that a start-up top-up put
// into the live database by mistake go (with whatever was made inside them, and the demo people's sign-ins). A backup
// is taken first; real companies stay.
if (process.env.S2G_PURGE_DEMO === '1' && process.env.NODE_ENV === 'production' && process.env.S2G_DEMO !== '1' && !(platform.settings() as any).demoPurged) {
  void db
    .backup()
    .then((file) => {
      const s = seed();
      const demoWsIds = new Set((s.workspaces as any[]).map((w) => w.id));
      // The demo people, and the guests of the demo's projects.
      const userIds = new Set([...(s.users as any[]).map((u) => u.id), ...(db.allDocs('users') as any[]).filter((u) => u.clientOf && demoWsIds.has(u.clientOf.workspaceId)).map((u) => u.id)]);
      const counts: Record<string, number> = {};
      const drop = (coll: string, ids: string[]) => {
        const there = ids.filter((id) => db.getDoc(coll, id));
        if (!there.length) return;
        db.writeDocs(coll, [], there, null);
        counts[coll] = (counts[coll] ?? 0) + there.length;
      };
      const demoWs = (s.workspaces as any[]).map((w) => db.getDoc('workspaces', w.id) as any).filter(Boolean);
      const accounts = new Set(demoWs.flatMap((w: any) => (w.accounts ?? []).map((a: any) => a.id)));
      // Everything that lives inside a demo company, found by its company, channel, table or mailbox.
      const channels = new Set((db.allDocs('channels') as any[]).filter((c) => demoWs.some((w: any) => w.id === c.workspaceId)).map((c) => c.id));
      const tables = new Set((db.allDocs('tables') as any[]).filter((t) => demoWs.some((w: any) => w.id === t.workspaceId)).map((t) => t.id));
      drop('messages', (db.allDocs('messages') as any[]).filter((m) => channels.has(m.channelId)).map((m) => m.id));
      drop('rows', (db.allDocs('rows') as any[]).filter((r) => tables.has(r.tableId)).map((r) => r.id));
      drop('threads', (db.allDocs('threads') as any[]).filter((t) => accounts.has(t.accountId)).map((t) => t.id));
      for (const w of demoWs) for (const [coll, ids] of Object.entries(db.deleteWorkspaceDocs(w.id, true))) counts[coll] = (counts[coll] ?? 0) + ids.length;
      // The demo's own documents by id (people, their calendars, statuses, prefs, notices).
      for (const k of COLLS) drop(k, toDocs(k, s[k]).map((d) => d.id));
      drop('prefs', [...userIds]);
      drop('statuses', [...userIds]);
      drop('notices', (db.allDocs('notices') as any[]).filter((n) => userIds.has(n.userId)).map((n) => n.id));
      for (const id of userIds) (db.deleteLogin(id), db.endSessions(id));
      drop('users', [...userIds]);
      // Anyone left with no company, no sign-in and no real company to be a guest of was part of the demo too.
      const realWs = new Set((db.allDocs('workspaces') as any[]).map((w) => w.id));
      const inRealWs = new Set((db.allDocs('workspaces') as any[]).flatMap((w) => (w.members ?? []).map((m: any) => m.userId)));
      drop('users', (db.allDocs('users') as any[]).filter((u) => !inRealWs.has(u.id) && !db.findLogin(String(u.email ?? '')) && !(u.clientOf && realWs.has(u.clientOf.workspaceId))).map((u) => u.id));
      // A demo person added to a real company leaves it.
      for (const w of db.allDocs('workspaces') as any[]) if ((w.members ?? []).some((m: any) => userIds.has(m.userId))) db.writeDocs('workspaces', [{ ...w, members: w.members.filter((m: any) => !userIds.has(m.userId)) }], [], null);
      // The operator numbers: revenue history, invoices, sign-up and growth events, mail logs, tickets and activity of
      // the demo, so the backend shows only what really happened.
      const wsList = [...demoWsIds];
      const userList = [...userIds];
      const marks = (n: number) => Array(n).fill('?').join(',');
      const sweep = (label: string, sql: string, params: string[]) => {
        if (!params.length) return;
        const n = Number(db.db.prepare(sql).run(...params).changes ?? 0);
        if (n) counts[label] = (counts[label] ?? 0) + n;
      };
      const demoTickets = (db.db.prepare(`SELECT id FROM tickets WHERE workspace_id IN (${marks(wsList.length)}) OR requester_user IN (${marks(userList.length || 1)})`).all(...wsList, ...(userList.length ? userList : [''])) as { id: string }[]).map((t) => t.id);
      sweep('ticket messages', `DELETE FROM ticket_messages WHERE ticket_id IN (${marks(demoTickets.length)})`, demoTickets);
      sweep('tickets', `DELETE FROM tickets WHERE id IN (${marks(demoTickets.length)})`, demoTickets);
      for (const t of ['invoices', 'mrr_snapshots', 'op_notes', 'outbox', 'mail_log']) sweep(t.replace('_', ' '), `DELETE FROM ${t} WHERE workspace_id IN (${marks(wsList.length)})`, wsList);
      sweep('events', `DELETE FROM platform_events WHERE workspace_id IN (${marks(wsList.length)})`, wsList);
      sweep('events', `DELETE FROM platform_events WHERE user_id IN (${marks(userList.length)})`, userList);
      for (const t of ['activity', 'activity_days', 'invites']) sweep(t.replace('_', ' '), `DELETE FROM ${t} WHERE user_id IN (${marks(userList.length)})`, userList);
      // A domain's signing key belongs to the domain: if a real company uses the same domain, it keeps the key (its DNS
      // record already has it); otherwise the key goes.
      const realDomains = new Map<string, string>();
      for (const w of db.allDocs('workspaces') as any[]) for (const d of w.domains ?? []) realDomains.set(String(d).toLowerCase(), w.id);
      for (const r of db.db.prepare(`SELECT domain FROM mail_domains WHERE workspace_id IN (${marks(wsList.length)})`).all(...wsList) as { domain: string }[]) {
        const keeper = realDomains.get(r.domain.toLowerCase());
        if (keeper) db.db.prepare('UPDATE mail_domains SET workspace_id = ? WHERE domain = ?').run(keeper, r.domain);
        else sweep('signing keys', 'DELETE FROM mail_domains WHERE domain = ?', [r.domain]);
      }
      const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing';
      platform.setSetting('demoPurged' as any, { at: new Date().toISOString(), backup: file.split('/').pop(), removed: summary } as any);
      db.audit('system', 'system.demo-purge', null, `${summary}; backup ${file.split('/').pop()}`);
      console.log(`Demo data removed (${summary}); backup ${file}`);
    })
    .catch((e) => console.error('[demo purge]', e instanceof Error ? e.message : e));
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
  // Guests on your projects (some are people at other companies that use sprint2go): so their names and photos show.
  const guests = new Set((db.allDocs('clients') as any[]).filter((c) => mine.has(c.workspaceId)).flatMap((c) => (c.people ?? []).map((p: any) => String(p.email).toLowerCase())));
  const channelOk = (c: any) => !!c && mine.has(c.workspaceId) && (!(c.private || c.kind === 'dm') || (c.members ?? []).includes(userId));
  // Tasks: owners and admins see all of a company's; members see their own work, their teams', the projects they're on
  // (every project when the company allows it) and their channels'. The same rule as the app's.
  // Built only when a task is checked (most live updates aren't tasks).
  let taskCtx: { adminOf: Set<string>; seeAll: Set<string>; myTeams: Set<string>; myProjects: Set<string> } | null = null;
  const doing = (t: any) => t.userId === userId || (t.assignees ?? []).includes(userId) || t.supervisorId === userId;
  const ctxOf = () =>
    (taskCtx ??= (() => {
      const allTodos = db.allDocs('todos') as any[];
      return {
        adminOf: new Set(ws.filter((w) => w.members.some((m) => m.userId === userId && m.role !== 'member')).map((w) => w.id)),
        seeAll: new Set(ws.filter((w) => mine.has(w.id) && ({ ...DEFAULT_PERMISSIONS, ...((w as any).permissions ?? {}) }).seeAllProjects).map((w) => w.id)),
        myTeams: new Set((db.allDocs('teams') as any[]).filter((t) => (t.members ?? []).includes(userId) || t.leadId === userId).map((t) => t.id)),
        myProjects: new Set(
          (db.allDocs('clients') as any[])
            .filter((c) => mine.has(c.workspaceId) && (c.ownerId === userId || (c.members ?? []).some((m: any) => m.userId === userId) || [...channels.values()].some((ch) => ch.clientId === c.id && (ch.members ?? []).includes(userId)) || allTodos.some((t) => t.clientId === c.id && doing(t))))
            .map((c) => c.id),
        ),
      };
    })());
  const taskOk = (t: any) => {
    const wsId = typeof t.workspaceId === 'string' ? t.workspaceId : firstWs;
    if (!mine.has(wsId)) return false;
    if (doing(t) || (t.followers ?? []).includes(userId) || t.createdBy === userId) return true;
    const c = ctxOf();
    if (c.adminOf.has(wsId)) return true;
    return (t.teamId && c.myTeams.has(t.teamId)) || (t.clientId && (c.seeAll.has(wsId) || c.myProjects.has(t.clientId))) || (t.channelId && (channels.get(t.channelId)?.members ?? []).includes(userId));
  };
  const ok = (coll: string, d: any): boolean => {
    switch (coll) {
      case 'users':
        // Yourself, your companies' people, and the client people of your companies.
        return d.id === userId || people.has(d.id) || (!!d.clientOf && mine.has(d.clientOf.workspaceId)) || guests.has(String(d.email ?? '').toLowerCase());
      case 'workspaces':
        return mine.has(d.id);
      case 'statuses':
        return people.has(d.id);
      case 'prefs':
        return d.id === userId; // your own settings only
      case 'notes':
        return mine.has(d.workspaceId) && (d.visibility !== 'private' || d.ownerId === userId); // private notes: only their owner
      case 'channels':
        return channelOk(d);
      case 'todos':
        return taskOk(d);
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
  const listed = people.find((x) => x.email.toLowerCase() === email);
  if (!listed || listed.status === 'pending') return () => null; // not (or no longer) a guest here
  const myChannels = new Set(channelsFor(email, clientId, channels as any, client.status === 'ended').map((c) => c.id));
  const meetings = new Map(meetingsFor(client, people, db.allDocs('meetings') as any, access).map((x) => [x.meeting.id, x.notes]));
  const files = new Set(filesFor(client, db.allDocs('drive') as any).map((f) => f.id));
  const tasks = new Set(tasksFor(client, db.allDocs('todos') as any).map((t) => t.id));
  const team = new Set(w.members.map((m: any) => m.userId));
  return (coll: string, d: any): any | null => {
    switch (coll) {
      case 'prefs':
        return d.id === me.id ? d : null;
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
      case 'quotes':
        return d.clientId === clientId && d.status !== 'draft' ? d : null; // what was sent to them, never drafts
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
    case 'quotes': {
      // A guest with approval rights answers a quote that was sent: accepted with their name, or declined with a note.
      if (!before || before.clientId !== clientId || before.status !== 'sent' || !can(person, 'approve')) return null;
      if (d.status !== 'accepted' && d.status !== 'declined') return null;
      if (before.validUntil && before.validUntil < new Date().toISOString().slice(0, 10)) return null;
      return { ...before, status: d.status, decidedAt: new Date().toISOString(), decidedBy: email, signature: d.status === 'accepted' ? String(d.signature ?? person.name).slice(0, 120) : undefined, note: d.status === 'declined' && d.note ? String(d.note).slice(0, 500) : undefined };
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
/** The session cookie: only over https when the app is served over https (behind Dokploy's proxy). */
const secureCookies = () => PUBLIC_URL.startsWith('https://');
const setSession = (res: ServerResponse, token: string | null) => res.setHeader('set-cookie', `s2g=${token ?? ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? 30 * 86400 : 0}${secureCookies() ? '; Secure' : ''}`);
/** Attempts per key (an address and an email) in a sliding window: sign-in and codes can't be guessed in bulk. */
const attempts = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > max;
}
const ipOf = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
/** Six digits, sent by email when mail is set up; otherwise in the log (and on screen outside production). */
const codes = new Map<string, { code: string; tries: number; until: number; data?: any }>();
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
async function sendCode(to: string, what: string, code: string) {
  const sent = await sendMail(to, `${code} is your sprint2go code`, `${code} is your code to ${what}. It works for 15 minutes.`, simpleHtml('sprint2go', [`${code} is your code to ${what}.`, 'It works for 15 minutes. If this wasn’t you, ignore this email.'])).catch((e) => (console.error('[mail]', e instanceof Error ? e.message : e), false));
  if (!sent) console.log(`Code for ${to} (${what}): ${code}`);
  return sent;
}
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
};

/* ---------- live updates (server-sent events) ---------- */

const clients = new Map<string, { res: ServerResponse; userId: string; token?: string }>();
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

function broadcast(coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) {
  if (!upserts.length && !deletes.length) return;
  const views = new Map<string, ReturnType<typeof lens>>();
  for (const [id, c] of clients) {
    if (id === except) continue;
    if (!views.has(c.userId)) views.set(c.userId, lens(c.userId));
    const see = views.get(c.userId)!;
    const mine = upserts.map((d) => see(coll, d)).filter(Boolean);
    // A deletion goes only to people who could see the document (when we still have it to check).
    const gone = deleted ? deletes.filter((did) => { const d = deleted.find((x) => x.id === did); return !d || !!see(coll, d); }) : deletes;
    if (mine.length || gone.length) c.res.write(`event: change\ndata: ${JSON.stringify({ coll, upserts: mine, deletes: gone })}\n\n`);
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
  // Included AI (sprint2go pays): the server's own Claude key.
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

// sprint2go asks the recorder to send a bot; the bot reports back to /api/meet/recorder.
// The audio stays on the recorder and people play it through /api/meet/audio/:id.
const RECORDER_URL = process.env.RECORDER_URL?.replace(/\/$/, '');
const RECORDER_SECRET = process.env.RECORDER_SECRET ?? '';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
/** The marketing site (e.g. https://sprint2go.com) when it lives apart from the app (https://app.sprint2go.com). */
const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/$/, '');
const SITE_HOST = SITE_URL ? new URL(SITE_URL).host.toLowerCase() : '';
const SITE_DOMAIN = SITE_URL ? new URL(SITE_URL).hostname.toLowerCase() : '';
/** At the marketing address: the landing page and its files only; www goes to the bare domain; the rest goes to the app. */
function siteRedirect(req: IncomingMessage, res: ServerResponse, p: string) {
  if (!SITE_HOST) return false;
  const host = String(req.headers.host ?? '').toLowerCase();
  const to = (url: string) => (res.writeHead(301, { location: url, 'cache-control': 'max-age=3600' }), res.end(), true);
  if (host === `www.${SITE_HOST}`) return to(`${SITE_URL}${req.url ?? '/'}`);
  if (host !== SITE_HOST) return false;
  const landingFile = /^\/(assets\/|favicon|apple-touch-icon|icon-|manifest\.webmanifest|robots\.txt)/.test(p);
  if (p === '/' || p === '/welcome' || landingFile || p === '/api/pricing' || p === '/api/health') return false;
  return to(`${PUBLIC_URL}${req.url ?? '/'}`);
}
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
/** The company whose own address this request came to (its clients' door), if any. */
function brandedHost(req: IncomingMessage) {
  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
  return (db.allDocs('workspaces') as any[]).find((x) => x.whiteLabel?.enabled && ((x.whiteLabel.domain && x.whiteLabel.domain.toLowerCase() === host && x.whiteLabel.domainStatus === 'verified') || (x.whiteLabel.slug && `${x.whiteLabel.slug}.localhost` === host)));
}
function serveStatic(req: IncomingMessage, res: ServerResponse, site = false) {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  const branded = brandedHost(req);
  // At a company's own address: its name on the install prompt and home-screen icon, never ours.
  if (path === '/manifest.webmanifest' && branded) {
    const wl = branded.whiteLabel;
    const icon = wl.logo ?? branded.logo;
    res.setHeader('content-type', 'application/manifest+json');
    return res.end(JSON.stringify({ name: wl.name, short_name: wl.name.slice(0, 12), id: '/', start_url: '/?source=app', scope: '/', display: 'standalone', background_color: '#f5f6f8', theme_color: wl.color ?? branded.color, icons: icon ? [{ src: '/brand-icon', sizes: '512x512', type: String(icon).slice(5, String(icon).indexOf(';')) || 'image/png', purpose: 'any' }] : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }));
  }
  if (path === '/brand-icon' && branded) {
    const icon: string | undefined = branded.whiteLabel.logo ?? branded.logo;
    const m = icon?.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (m) return (res.setHeader('content-type', m[1]), res.end(Buffer.from(m[2], 'base64')));
  }
  // The front door: people who aren't signed in see the landing page; /welcome always shows it.
  // At a company's own address there's no landing page: its clients go straight to the branded sign-in.
  const signedIn = !!db.sessionUser(cookie(req, 's2g'));
  // With a separate marketing site, the app's own address opens on sign-in, not the landing page.
  if (((path === '/' && (site || (!SITE_HOST && !signedIn))) || path === '/welcome') && !branded) {
    file = join(DIST, 'landing.html');
    // Counted here (no tracking script): where visitors came from, kept in a first-party cookie until they sign up.
    const q = new URL(req.url ?? '/', 'http://x').searchParams;
    const ref = String(req.headers.referer ?? '');
    let refHost = '';
    try {
      refHost = ref ? new URL(ref).hostname.replace(/^www\./, '') : '';
    } catch {
      /* not a URL */
    }
    const own = String(req.headers.host ?? '').split(':')[0];
    const source = (q.get('utm_source') || q.get('ref') || (refHost && refHost !== own ? refHost : '') || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 60) || 'direct';
    if (path === '/' && req.method === 'GET') platform.countView('/', source);
    // Shared with the app's address (app.sprint2go.com) so sign-ups there know where the visit came from.
    if (source !== 'direct' && !cookie(req, 's2g_src')) res.setHeader('set-cookie', `s2g_src=${source}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax${SITE_DOMAIN ? `; Domain=${SITE_DOMAIN}` : ''}`);
  }
  else if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // single-page app
  if (!existsSync(file)) {
    res.statusCode = 404;
    return res.end('Build the app first: npm run build');
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.setHeader('content-type', type);
  // Built assets have a hash in their name: cached for a year. Pages are checked every time.
  res.setHeader('cache-control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  const data = readFileSync(file);
  if (/^(text\/|application\/(javascript|json|manifest))/.test(type) && String(req.headers['accept-encoding'] ?? '').includes('gzip') && data.length > 1024) {
    const stamp = statSync(file).mtimeMs;
    let z = gzipped.get(file);
    if (!z || z.size !== data.length || z.stamp !== stamp) (z = { size: data.length, stamp, body: gzipSync(data) }), gzipped.set(file, z);
    res.setHeader('content-encoding', 'gzip');
    res.setHeader('vary', 'accept-encoding');
    return res.end(z.body);
  }
  res.end(data);
}
const gzipped = new Map<string, { size: number; stamp: number; body: Buffer }>();

/** What usage rows cost in rupiah at list prices (own keys); included AI counts as 0 here, the plan's allowance covers it. */
function spendRp(rows: { provider: string; model: string; inTokens: number; outTokens: number }[]) {
  let usd = 0;
  for (const r of rows) {
    if (r.provider === 'included') continue;
    const m = PROVIDERS.find((x) => x.id === r.provider)?.models.find((x) => x.id === r.model);
    if (m?.price) usd += (r.inTokens * m.price[0] + r.outTokens * m.price[1]) / 1e6;
  }
  return usd * 17_500;
}

/* ---------- routes ---------- */

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  // Headers on everything: no framing by other sites, no content sniffing, scripts and styles only from here.
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob: data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss: https:; frame-ancestors 'none'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'");
  if (secureCookies()) res.setHeader('strict-transport-security', 'max-age=15552000; includeSubDomains');
  if (siteRedirect(req, res, p)) return;
  if (!p.startsWith('/api/')) return serveStatic(req, res, !!SITE_HOST && String(req.headers.host ?? '').toLowerCase() === SITE_HOST);
  if (p === '/api/health') return json(res, 200, { ok: true, at: new Date().toISOString() });
  if (p === '/api/pricing' && req.method === 'GET') return json(res, 200, { pricing: platform.settings().pricing ?? null });
  // What this server can really do. The app hides or disables what depends on something that isn't there.
  if (p === '/api/caps' && req.method === 'GET') return json(res, 200, caps());
  // Our own DKIM public key (it's published in DNS anyway), so the record can be added without signing in.
  if (p === '/api/mail/dkim' && req.method === 'GET') {
    const domain = mailer.SUPPORT_EMAIL.split('@')[1];
    return json(res, 200, { domain, host: `s2g._domainkey.${domain}`, value: mailer.dkimRecord(domain, 'platform') });
  }
  // Requests that change things must come from this app, not from another site a signed-in person is looking at.
  if (req.method !== 'GET' && req.headers.origin && !/^\/api\/(hooks\/|whatsapp\/webhook|meet\/recorder)/.test(p)) {
    const o = String(req.headers.origin).replace(/^https?:\/\//, '').toLowerCase();
    const ok = o === String(req.headers.host ?? '').toLowerCase() || o === PUBLIC_URL.replace(/^https?:\/\//, '').toLowerCase() || o.endsWith('.localhost' + (PORT ? `:${PORT}` : ''));
    if (!ok) return json(res, 403, { error: 'Requests must come from the app.' });
  }
  try {
    // Sign in / out
    // WhatsApp (Meta Cloud API) webhook: Meta checks it once with a token, then posts every incoming message.
    if (p === '/api/whatsapp/webhook' && req.method === 'GET') {
      const token = url.searchParams.get('hub.verify_token');
      const w = workspaces().find((x: any) => x.whatsapp?.verifyToken && x.whatsapp.verifyToken === token) as any;
      if (url.searchParams.get('hub.mode') === 'subscribe' && w) return (res.writeHead(200, { 'content-type': 'text/plain' }), res.end(url.searchParams.get('hub.challenge') ?? ''));
      return json(res, 403, {});
    }
    if (p === '/api/whatsapp/webhook' && req.method === 'POST') {
      const b = await body(req).catch(() => ({}));
      const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
      for (const entry of b.entry ?? [])
        for (const ch of entry.changes ?? []) {
          const v = ch.value ?? {};
          const w = workspaces().find((x: any) => x.whatsapp?.connected && x.whatsapp.phoneNumberId === v.metadata?.phone_number_id) as any;
          if (!w) continue;
          const names = new Map((v.contacts ?? []).map((c: any) => [digits(c.wa_id), c.profile?.name]));
          for (const m of v.messages ?? []) {
            const from = digits(m.from);
            const text = m.type === 'text' ? String(m.text?.body ?? '') : `[${m.type}]`;
            // Whose number is it? One of a project's guests → their project's shared channel.
            const channels = db.allDocs('channels') as any[];
            const hit = (db.allDocs('clients') as any[])
              .filter((c) => c.workspaceId === w.id)
              .flatMap((c) => clientPeople(c, channels).filter((pp) => pp.phone && digits(pp.phone) === from).map((pp) => ({ c, pp })))[0];
            const at = new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString();
            if (hit) {
              const chan = channels.find((x) => x.clientId === hit.c.id && x.category === 'shared' && !x.archived) ?? channels.find((x) => x.clientId === hit.c.id && !x.archived);
              if (chan) {
                const doc = { id: randomBytes(8).toString('hex'), channelId: chan.id, userId: 'guest', guestEmail: hit.pp.email, text, at, via: 'whatsapp' } as db.Doc;
                db.writeDocs('messages', [doc], [], null);
                broadcast('messages', [doc], []);
                const notices = (chan.members ?? []).map((uid: string) => ({ id: randomBytes(8).toString('hex'), userId: uid, workspaceId: w.id, kind: 'mention', text: `${hit.pp.name} (WhatsApp): ${text.slice(0, 80)}`, at, read: false, link: { app: 'chat', id: chan.id, msg: doc.id } })) as db.Doc[];
                if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
                continue;
              }
            }
            // Unknown number: admins get it, with the number, so they can add the person to a project.
            const admins = (w.members ?? []).filter((x: any) => x.role !== 'member').map((x: any) => x.userId);
            const notices = admins.map((uid: string) => ({ id: randomBytes(8).toString('hex'), userId: uid, workspaceId: w.id, kind: 'mention', text: `WhatsApp from ${names.get(from) ? `${names.get(from)} (+${from})` : '+' + from}: ${text.slice(0, 80)}`, at, read: false, link: { app: 'settings', id: 'apps' } })) as db.Doc[];
            if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
          }
        }
      return json(res, 200, {});
    }

    // White label: whose brand to show at this address (an agency's subdomain, or <slug>.localhost to try it locally).
    if (p === '/api/brand') {
      const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
      const w = (db.allDocs('workspaces') as any[]).find((x) => x.whiteLabel?.enabled && ((x.whiteLabel.domain && x.whiteLabel.domain.toLowerCase() === host && x.whiteLabel.domainStatus === 'verified') || (x.whiteLabel.slug && `${x.whiteLabel.slug}.localhost` === host)));
      return json(res, 200, { ...(w ? { name: w.whiteLabel.name, logo: w.whiteLabel.logo ?? w.logo, color: w.whiteLabel.color ?? w.color } : {}), mailHost: mailer.MAIL_HOST, mailIp: mailer.MAIL_IP || undefined, boosted: mailer.boostedAvailable() });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const { email, password } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      if (tooMany(`login:${ipOf(req)}`, 30, 15 * 60_000) || tooMany(`login:${mail}`, 10, 15 * 60_000)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
      const login = mail && db.findLogin(mail);
      const good = login && typeof password === 'string' ? await db.checkPassword(password, login.pw_hash) : (await db.burnPasswordTime(String(password ?? '')), false);
      if (!good || !login) return json(res, 401, { error: 'Wrong email or password.' });
      if ((db.getDoc('users', login.user_id) as any)?.suspended) return json(res, 403, { error: 'This account is suspended. Contact support.' });
      setSession(res, db.newSession(login.user_id));
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
      if (tooMany(`signup:${ipOf(req)}`, 10, 60 * 60_000)) return json(res, 429, { error: 'Too many sign-ups from here. Try again later.' });
      const code = newCode();
      signups.set(mail, { name: String(name).trim().slice(0, 80), hash: await db.hashPassword(password), code, tries: 0, until: Date.now() + 15 * 60_000 });
      const sent = await sendCode(mail, 'finish signing up', code);
      platform.event('signup.started', null, null, cookie(req, 's2g_src') || 'direct');
      return json(res, 200, { ok: true, sent, ...(process.env.NODE_ENV === 'production' || sent ? {} : { devCode: code }) });
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
      platform.event('signup.verified', null, user.id, cookie(req, 's2g_src') || 'direct');
      setSession(res, db.newSession(user.id));
      return json(res, 200, { me: user.id });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const t = cookie(req, 's2g');
      if (t) {
        db.endSession(t);
        for (const [id, c] of clients) if (c.token === t) (c.res.end(), clients.delete(id));
      }
      setSession(res, null);
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
      await db.setLogin(inv.user_id, inv.email, password);
      platform.event('invite.accepted', null, inv.user_id);
      setSession(res, db.newSession(inv.user_id));
      return json(res, 200, { me: inv.user_id });
    }

    // Forgot the password: a code by email, then a new password. Every session of that account ends.
    if (p === '/api/reset' && req.method === 'POST') {
      const mail = String((await body(req)).email ?? '').trim().toLowerCase();
      if (tooMany(`reset:${ipOf(req)}`, 10, 60 * 60_000)) return json(res, 429, { error: 'Too many attempts. Try again later.' });
      const login = mail && db.findLogin(mail);
      // The answer is the same whether the email is known or not.
      if (login) {
        const code = newCode();
        codes.set(`reset:${mail}`, { code, tries: 0, until: Date.now() + 15 * 60_000 });
        const sent = await sendCode(mail, 'set a new password', code);
        return json(res, 200, { ok: true, ...(process.env.NODE_ENV === 'production' || sent ? {} : { devCode: code }) });
      }
      await db.burnPasswordTime('x');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/reset/verify' && req.method === 'POST') {
      const { email, code, password } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      const c = codes.get(`reset:${mail}`);
      if (!c || c.until < Date.now()) return json(res, 410, { error: 'That code has expired. Ask for a new one.' });
      if (++c.tries > 5) return (codes.delete(`reset:${mail}`), json(res, 429, { error: 'Too many tries. Ask for a new code.' }));
      if (String(code ?? '').replace(/\D/g, '') !== c.code) return json(res, 400, { error: 'That code isn’t right.' });
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      const login = db.findLogin(mail);
      if (!login) return json(res, 404, { error: 'No account with this email.' });
      codes.delete(`reset:${mail}`);
      await db.setLogin(login.user_id, mail, password);
      db.endSessions(login.user_id);
      setSession(res, db.newSession(login.user_id));
      return json(res, 200, { me: login.user_id });
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

    const token = cookie(req, 's2g');
    const session = db.sessionInfo(token);
    const me = session?.userId ?? null;
    if (!me) return json(res, 401, { error: 'Sign in first.' });
    if (db.touch(me)) {
      platform.activeDay(me);
      platform.noteSession(token!, String(req.headers['user-agent'] ?? ''), ipOf(req));
    }
    const meDoc = personOf(me) as any;
    // A suspended person can still see that they're suspended; nothing else.
    if (meDoc?.suspended) return p === '/api/me' ? json(res, 200, { me, suspended: meDoc.suspended }) : json(res, 403, { error: 'This account is suspended.' });
    const opRecord = session?.operator ? null : platform.operator(meDoc?.email);
    const pset = platform.settings();

    if (p === '/api/me')
      return json(res, 200, {
        me,
        actingAs: session?.operator ?? undefined, // an operator looking at the app as this person
        operator: opRecord ? opRecord.role : undefined,
        suspendedIn: memberOf(me)
          .filter((w: any) => w.suspended)
          .map((w: any) => ({ id: w.id, name: w.name, reason: w.suspended.reason })),
        maintenance: pset.maintenance.on ? pset.maintenance.message || 'sprint2go is being updated. You can read everything; changes are paused for a few minutes.' : undefined,
        flags: flagsFor(memberOf(me).map((w: any) => w.id), pset.flags),
      });
    // Back from "sign in as": the operator's own session again (still past their 2FA).
    if (p === '/api/admin/signin-as/stop' && req.method === 'POST') {
      if (!session?.operator) return json(res, 400, { error: 'Not signed in as someone.' });
      const op = (db.allDocs('users') as any[]).find((u) => String(u.email ?? '').toLowerCase() === session.operator);
      db.endSession(token!);
      const t = op ? db.newSession(op.id) : null;
      if (t) platform.markSessionVerified(t);
      setSession(res, t);
      db.audit(session.operator, 'person.signin-as.stop', me);
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/api/admin/')) {
      if (!opRecord) return json(res, 403, { error: 'Operators only.' });
      const handled = await admin.handleAdmin(p, {
        req,
        res,
        url,
        me,
        token: token!,
        json,
        body,
        broadcast,
        signups,
        codes,
        newCode,
        mailOn: mailConfigured(),
        publicUrl: PUBLIC_URL,
        recorder: recorderInfo,
        spendRp,
        setSession,
        sseClients: () => clients.size,
        startedAt: STARTED,
        notifyUsers,
      });
      return handled ? undefined : json(res, 404, { error: 'No such admin route.' });
    }

    /* ---------- help and support, for everyone signed in ---------- */
    if (p === '/api/support' && req.method === 'GET') {
      const list = support.ticketsOfUser(me, String(meDoc?.email ?? ''));
      return json(res, 200, { tickets: list.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, updatedAt: t.updatedAt, createdAt: t.createdAt, unread: t.unreadForCustomer, rating: t.rating })), supportEmail: mailer.SUPPORT_EMAIL });
    }
    if (p === '/api/support' && req.method === 'POST') {
      if (tooMany(`support:${me}`, 10, 60 * 60_000)) return json(res, 429, { error: 'That’s a lot of tickets in an hour. Reply on an open one, or write to ' + mailer.SUPPORT_EMAIL + '.' });
      const b = await body(req);
      const subject = String(b.subject ?? '').trim();
      const text = String(b.body ?? '').trim();
      if (!subject || !text) return json(res, 400, { error: 'Tell us what it’s about and what happened.' });
      const ws = (memberOf(me).find((w: any) => w.id === b.workspaceId) ?? memberOf(me)[0]) as any;
      const paying = ws ? admin.mrrOf(ws, ws.members.length).state === 'paying' : false;
      const attachments = (Array.isArray(b.attachments) ? b.attachments : []).filter((a: any) => a && typeof a.url === 'string' && /^\/api\/files\/[a-f0-9]{32}$/.test(a.url)).map((a: any) => ({ name: String(a.name ?? 'file').slice(0, 200), url: a.url, size: a.size ? String(a.size) : undefined }));
      const t = support.createTicket({
        subject,
        body: text,
        channel: b.channel === 'crash' ? 'crash' : 'app',
        email: String(meDoc?.email ?? ''),
        name: meDoc?.name ?? null,
        userId: me,
        workspaceId: ws?.id ?? null,
        paying,
        priority: b.urgent ? 'urgent' : undefined,
        tags: b.channel === 'crash' ? ['crash'] : [],
        context: b.context && typeof b.context === 'object' ? { ...b.context, plan: ws?.plan ? `${ws.plan.tier} ${ws.plan.track}` : 'none', company: ws?.name ?? null } : undefined,
        attachments,
      });
      supportNotify(t, `New ticket #${t.number} from ${meDoc?.name ?? meDoc?.email}: ${t.subject.slice(0, 70)}`);
      return json(res, 200, { id: t.id, number: t.number });
    }
    const supportReq = p.match(/^\/api\/support\/([\w-]+)(?:\/(reply|rate|seen))?$/);
    if (supportReq) {
      const t = support.ticket(supportReq[1]);
      const mine = t && (t.requester.userId === me || t.requester.email === String(meDoc?.email ?? '').toLowerCase());
      if (!t || !mine) return json(res, 404, { error: 'No such ticket.' });
      if (!supportReq[2] && req.method === 'GET') {
        support.markSeenByCustomer(t.id);
        return json(res, 200, { ticket: { id: t.id, number: t.number, subject: t.subject, status: t.status, createdAt: t.createdAt, rating: t.rating }, messages: support.messagesOf(t.id, false).map((m) => ({ ...m, author: m.kind === 'operator' ? undefined : m.author })) });
      }
      if (supportReq[2] === 'reply' && req.method === 'POST') {
        const b = await body(req);
        const text = String(b.body ?? '').trim();
        if (!text) return json(res, 400, { error: 'Write something first.' });
        const attachments = (Array.isArray(b.attachments) ? b.attachments : []).filter((a: any) => a && typeof a.url === 'string' && /^\/api\/files\/[a-f0-9]{32}$/.test(a.url)).map((a: any) => ({ name: String(a.name ?? 'file').slice(0, 200), url: a.url }));
        support.addMessage(t.id, { kind: 'customer', author: String(meDoc?.email ?? '').toLowerCase(), authorName: meDoc?.name ?? null, body: text, internal: false, attachments });
        support.customerReplied(t.id);
        supportNotify(t, `${meDoc?.name ?? 'A customer'} replied on #${t.number}: ${text.slice(0, 70)}`, true);
        return json(res, 200, { ok: true });
      }
      if (supportReq[2] === 'rate' && req.method === 'POST') {
        const b = await body(req);
        if (!['good', 'okay', 'bad'].includes(b.rating)) return json(res, 400, { error: 'Pick one.' });
        support.rate(t.id, b.rating, b.note);
        if (b.rating === 'bad') supportNotify(t, `#${t.number} was rated bad${b.note ? `: ${String(b.note).slice(0, 80)}` : ''}`, true);
        return json(res, 200, { ok: true });
      }
    }
    // Errors from the app in someone's browser, grouped in the backend.
    if (p === '/api/client-error' && req.method === 'POST') {
      if (tooMany(`cerr:${me}`, 30, 60 * 60_000)) return json(res, 200, {});
      const b = await body(req);
      platform.recordError({ source: 'client', message: String(b.message ?? 'Unknown error').slice(0, 500), stack: String(b.stack ?? '').slice(0, 4000), path: String(b.path ?? '').slice(0, 200), userId: me, workspaceId: memberOf(me)[0]?.id ?? null });
      return json(res, 200, {});
    }
    // News and warnings from sprint2go for this person's companies.
    if (p === '/api/announcements' && req.method === 'GET') {
      const at = new Date().toISOString();
      const mine = memberOf(me) as any[];
      const list = pset.announcements.filter((a) => a.from <= at && (!a.until || a.until > at)).filter((a) => {
        if (a.audience === 'all') return true;
        if (a.audience === 'list') return mine.some((w) => a.companies.includes(w.id));
        if (a.audience === 'owners') return mine.some((w) => w.members.some((m: any) => m.userId === me && m.role === 'owner'));
        const states = mine.map((w) => admin.mrrOf(w, w.members.length).state);
        return a.audience === 'paying' ? states.includes('paying') : states.includes('trial');
      });
      return json(res, 200, { announcements: list.map((a) => ({ id: a.id, text: a.text, link: a.link, kind: a.kind })) });
    }
    // A company's invoices and discount codes (owners and admins, or members allowed to see billing).
    if (p === '/api/billing/invoices' && req.method === 'GET') {
      const ws = memberOf(me).find((w: any) => w.id === url.searchParams.get('ws')) as any;
      if (!ws || !(isAdminOf(me, ws.id) || ws.permissions?.seeBilling)) return json(res, 403, { error: 'Not allowed.' });
      return json(res, 200, { invoices: platform.invoices(ws.id).filter((i) => i.status !== 'draft').map((i) => ({ id: i.id, number: i.number, period: i.period, total: i.total, status: i.status, dueAt: i.dueAt, paidAt: i.paidAt, overdue: i.status === 'sent' && i.dueAt < new Date().toISOString() })) });
    }
    if (p === '/api/billing/invoice' && req.method === 'GET') {
      const inv = platform.invoice(url.searchParams.get('id') ?? '');
      const ws = inv && (memberOf(me).find((w: any) => w.id === inv.workspaceId) as any);
      if (!inv || inv.status === 'draft' || !ws || !(isAdminOf(me, ws.id) || ws.permissions?.seeBilling)) return json(res, 404, { error: 'No such invoice.' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
      return res.end(admin.invoiceHtml(inv, ws.name));
    }
    if (p === '/api/billing/coupon' && req.method === 'POST') {
      const b = await body(req);
      const ws = memberOf(me).find((w: any) => w.id === b.workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: 'Only owners and admins can add a code.' });
      if (tooMany(`coupon:${ws.id}`, 10, 60 * 60_000)) return json(res, 429, { error: 'Too many tries. Try again later.' });
      if (!ws.plan) return json(res, 400, { error: 'Pick a plan first.' });
      if (ws.plan.discount || (ws.plan.comp?.note ?? '').startsWith('Code ')) return json(res, 409, { error: 'This company already has a code.' });
      const ok = platform.couponUsable(String(b.code ?? ''));
      if (!ok.ok) return json(res, 400, { error: ok.error });
      const next = { ...ws, plan: admin.applyCoupon(ws.plan, ok.coupon) };
      db.writeDocs('workspaces', [next], [], me);
      broadcast('workspaces', [next], []);
      platform.useCoupon(ok.coupon.code);
      platform.event('coupon.used', ws.id, me, ok.coupon.code);
      return json(res, 200, { ok: true, coupon: { code: ok.coupon.code, kind: ok.coupon.kind, value: ok.coupon.value, months: ok.coupon.months } });
    }
    if (p === '/api/state') return json(res, 200, visibleState(me));

    /* ---------- the mail engine: a company's domain, records, route and sending ---------- */
    const monthStart = () => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    };
    if (p === '/api/mail/setup' && req.method === 'GET') {
      const saved = memberOf(me).find((w) => w.id === url.searchParams.get('ws')) as any;
      if (!saved) return json(res, 403, { error: 'Not in this company.' });
      // The records follow what the screen shows: a choice made a moment ago may not be saved yet.
      const setupQ = url.searchParams.get('setup') ?? '';
      const providerQ = url.searchParams.get('provider') ?? '';
      const ws = { ...saved, ...(['keep', 'mix', 'hosted', 'none'].includes(setupQ) ? { emailSetup: setupQ } : {}), ...(['google', 'microsoft', 'zoho', 'imap'].includes(providerQ) ? { emailProvider: providerQ } : {}) };
      const domain = mailer.mailDomainOf(ws);
      const ownDomain = domain !== mailer.MAIL_HOST;
      const [records, health, dns] = await Promise.all([mailer.expectedRecords(ws), mailer.serverHealth(), ownDomain ? mailer.dnsHostOf(domain) : Promise.resolve({ dnsHost: null, nameservers: [] as string[] })]);
      // Whose domain it is, and the record that proves it.
      const ownership = ownDomain ? domainOwnership(ws, domain) : null;
      return json(res, 200, { host: mailer.MAIL_HOST, ip: mailer.MAIL_IP, domain, ownDomain, route: ws.mailRoute ?? 'own', boostedAvailable: mailer.boostedAvailable(), credits: ws.mailCredits ?? 0, records, checks: ws.mailChecks ?? null, stats: mailer.mailStats(ws.id, monthStart()), health, dnsHost: dns.dnsHost, nameservers: dns.nameservers, ownership });
    }
    if (p === '/api/mail/unsubscribe' && req.method === 'POST') {
      const { threadId } = await body(req);
      const t = db.getDoc('threads', String(threadId ?? '')) as any;
      const acct = t && (memberOf(me) as any[]).flatMap((w) => w.accounts ?? []).find((a: any) => a.id === t.accountId);
      if (!t || !acct || !(acct.users ?? []).includes(me)) return json(res, 403, { error: 'Not your mailbox.' });
      const m = [...(t.messages ?? [])].reverse().find((x: any) => x.listUnsubscribe?.url);
      if (!m) return json(res, 400, { error: 'This sender didn’t include an unsubscribe link.' });
      if (!m.listUnsubscribe.oneClick) return json(res, 200, { open: m.listUnsubscribe.url });
      const r = await mailer.oneClickUnsubscribe(String(m.listUnsubscribe.url));
      return r.ok ? json(res, 200, { done: true }) : json(res, 502, { error: r.why, open: r.safe ? m.listUnsubscribe.url : undefined });
    }
    if (p === '/api/mail/ready' && req.method === 'POST') {
      const { workspaceId } = await body(req);
      if (!memberOf(me).some((w) => w.id === workspaceId)) return json(res, 403, { error: 'Not in this company.' });
      const ready = await mailer.refreshReadiness(String(workspaceId));
      const ws = db.getDoc('workspaces', String(workspaceId)) as any;
      // "Some of each": which hosted mailboxes at the company's domain really got mail, the proof that routing works.
      return json(res, 200, { ...ready, routing: ws ? mailer.hostedArrivals(ws) : null });
    }
    if (p === '/api/mail/check' && req.method === 'POST') {
      const { workspaceId } = await body(req);
      const ws = memberOf(me).find((w) => w.id === workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: 'Only admins can check the records.' });
      const result = await mailer.checkDomain(ws);
      soonReadiness(ws.id);
      const own = result.domain === mailer.MAIL_HOST;
      const next = { ...ws, mailChecks: { at: result.at, allOk: result.allOk, checks: result.checks }, accounts: (ws.accounts ?? []).map((a: any) => (!a.provider || a.provider === 'sprint2go' ? { ...a, connected: own || result.allOk || result.checks.filter((c) => c.key !== 'dmarc').every((c) => c.ok) } : a)) };
      db.writeDocs('workspaces', [next], [], me);
      broadcast('workspaces', [next], []);
      return json(res, 200, result);
    }
    if (p === '/api/mail/route' && req.method === 'POST') {
      const { workspaceId, route } = await body(req);
      const ws = memberOf(me).find((w) => w.id === workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: 'Only admins can change how mail is sent.' });
      if (!['own', 'boosted'].includes(route)) return json(res, 400, { error: 'Unknown route.' });
      if (route === 'boosted' && !mailer.boostedAvailable()) return json(res, 409, { error: 'Boosted sending isn’t available on this server yet.' });
      const next = { ...ws, mailRoute: route, mailChecks: undefined };
      db.writeDocs('workspaces', [next], [], me);
      broadcast('workspaces', [next], []);
      soonReadiness(ws.id);
      return json(res, 200, { records: await mailer.expectedRecords(next) });
    }
    if (p === '/api/mail/credits' && req.method === 'POST') {
      const { workspaceId, add } = await body(req);
      const ws = memberOf(me).find((w) => w.id === workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: 'Only admins can buy credits.' });
      const n = Math.max(0, Math.min(100_000, Number(add) || 0));
      const next = { ...ws, mailCredits: (ws.mailCredits ?? 0) + n, mailCreditsNotified: false };
      db.writeDocs('workspaces', [next], [], me);
      broadcast('workspaces', [next], []);
      return json(res, 200, { credits: next.mailCredits });
    }
    if (p === '/api/mail/send' && req.method === 'POST') {
      const b = await body(req);
      const ws = memberOf(me).find((w) => w.id === b.workspaceId) as any;
      const account = ws?.accounts?.find((a: any) => a.id === b.accountId);
      if (!ws || !account) return json(res, 403, { error: 'Not your mailbox.' });
      if (account.provider && account.provider !== 'sprint2go') return json(res, 409, { error: 'This mailbox is not hosted here.' });
      // Only from a mailbox that can really send; a fresh check first, so a record added a minute ago counts.
      if (!ws.mailReady?.mailboxes?.[account.id]?.send) {
        const r = await mailer.refreshReadiness(ws.id);
        const m = r?.mailboxes[account.id];
        if (!m?.send) return json(res, 409, { error: `Sending isn’t set up for ${account.email} yet. ${m?.why ?? ''}`.trim() });
      }
      if (Array.isArray(account.users) && account.users.length && !account.users.includes(me) && !isAdminOf(me, ws.id)) return json(res, 403, { error: 'Not your mailbox.' });
      const people = (list: unknown) => (Array.isArray(list) ? list : []).filter((x: any) => x && typeof x.email === 'string' && x.email.includes('@')).map((x: any) => ({ name: String(x.name ?? '').slice(0, 120), email: String(x.email).trim().toLowerCase() }));
      try {
        platform.firstEvent('mail.first', ws.id, me);
        const r = await mailer.queueSend({
          workspaceId: ws.id,
          accountId: account.id,
          threadId: String(b.threadId ?? ''),
          messageId: String(b.messageId ?? ''),
          from: { name: String(account.name || ws.name), email: String(account.email).toLowerCase() },
          to: people(b.to),
          cc: people(b.cc),
          subject: String(b.subject ?? '').slice(0, 500),
          text: String(b.text ?? ''),
          html: typeof b.html === 'string' && b.html ? b.html : undefined,
          files: (Array.isArray(b.files) ? b.files : []).filter((f: any) => f && typeof f.url === 'string').map((f: any) => ({ name: String(f.name ?? 'file').slice(0, 200), url: String(f.url) })),
          inReplyTo: typeof b.inReplyTo === 'string' ? b.inReplyTo : undefined,
          references: Array.isArray(b.references) ? b.references.filter((x: unknown) => typeof x === 'string') : undefined,
        });
        return json(res, 200, r);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Could not send.' });
      }
    }

    if (p === '/api/password' && req.method === 'POST') {
      const { current, next } = await body(req);
      const u = db.getDoc('users', me) as { email?: string } | undefined;
      const login = u?.email && db.findLogin(u.email);
      if (!login || !(await db.checkPassword(String(current ?? ''), login.pw_hash))) return json(res, 400, { error: 'Your current password is wrong.' });
      if (typeof next !== 'string' || next.length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      await db.setLogin(me, u.email!, next);
      // Everywhere else signs out; this device gets a fresh session.
      db.endSessions(me);
      for (const [id, c] of clients) if (c.userId === me && c.token !== cookie(req, 's2g')) (c.res.end(), clients.delete(id));
      setSession(res, db.newSession(me));
      return json(res, 200, {});
    }

    // Deleting the account: the sign-in, sessions and the person's record go; work they did stays with its company.
    if (p === '/api/account/delete' && req.method === 'POST') {
      const { password } = await body(req);
      const u = db.getDoc('users', me) as any;
      const login = u?.email && db.findLogin(String(u.email).toLowerCase());
      if (!login || !(await db.checkPassword(String(password ?? ''), login.pw_hash))) return json(res, 400, { error: 'Your password is wrong.' });
      const owned = memberOf(me).filter((w) => w.members.some((m) => m.userId === me && m.role === 'owner') && !w.members.some((m) => m.userId !== me && m.role === 'owner'));
      if (owned.length) return json(res, 409, { error: `You’re the only owner of ${owned.map((w: any) => w.name).join(', ')}. Make someone else an owner first, in Settings, General.` });
      const left = memberOf(me).map((w) => ({ ...w, members: w.members.filter((m) => m.userId !== me) }));
      if (left.length) (db.writeDocs('workspaces', left as any, [], me), broadcast('workspaces', left as any, []));
      db.deleteLogin(me);
      db.endSessions(me);
      for (const [id, c] of clients) if (c.userId === me) (c.res.end(), clients.delete(id));
      const gone = { ...u, name: 'Deleted account', email: '', title: '', photo: undefined, hiddenApps: undefined, vaultKey: undefined, deletedAt: new Date().toISOString() };
      db.writeDocs('users', [gone], [], me);
      broadcast('users', [gone], []);
      setSession(res, null);
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
      // Someone who already signs in (e.g. a teammate at a company that uses sprint2go) just gets access, no link.
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
      const accounts = ((w.accounts ?? []) as any[]).filter((a) => a && typeof a.email === 'string').map((a) => ({ id: String(a.id ?? randomBytes(6).toString('hex')), email: String(a.email).toLowerCase().slice(0, 200), name: String(a.name ?? '').slice(0, 80), kind: a.kind === 'shared' ? 'shared' : 'personal', connected: false, users: ((a.users ?? []) as any[]).filter((x) => x === me || ids.has(x)), provider: typeof a.provider === 'string' ? a.provider.slice(0, 20) : undefined }));
      const { mailReady: _r, mailCredits: _c, mailCreditsNotified: _n, suspended: _s, ...wClean } = w as any;
      const ws = { ...wClean, plan: wClean.plan ? { ...wClean.plan, comp: undefined, discount: undefined } : wClean.plan, name: String(w.name).trim().slice(0, 80), members, accounts };
      const general = { id: 'ch-' + randomBytes(5).toString('hex'), workspaceId: ws.id, kind: 'channel', name: 'general', members: members.map((m) => m.userId), topic: 'Everyone at ' + ws.name };
      db.writeDocs('users', people, [], me);
      (ws as any).createdAt ??= new Date().toISOString();
      db.writeDocs('workspaces', [ws], [], me);
      db.writeDocs('channels', [general], [], me);
      platform.event('company.created', ws.id, me);
      soonReadiness(ws.id);
      if (people.length) platform.event('team.invited', ws.id, me, `${people.length} at creation`);
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
    if (p === '/api/meet/status') {
      const configured = !!RECORDER_URL && !!RECORDER_SECRET;
      // "reachable" says whether the recorder service answers right now, not just whether it's configured.
      const reachable = configured ? await recorder('/health', { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false) : false;
      return json(res, 200, { recorder: configured, reachable });
    }
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

    // Files: uploads land on disk under data/files, served back to people in the same company (or guests of it).
    if (p === '/api/upload' && req.method === 'POST') {
      const wsId = String(req.headers['x-workspace'] ?? '');
      const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')).slice(0, 200);
      const type = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].slice(0, 100);
      const team = memberOf(me).some((w) => w.id === wsId);
      const guest = !team && portalsOf(me).some((pt) => pt.workspaceId === wsId);
      if (!team && !guest) return json(res, 403, { error: 'Not in this company.' });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 25 * 1024 * 1024) return json(res, 413, { error: 'Files up to 25 MB.' });
        chunks.push(c as Buffer);
      }
      const id = randomBytes(16).toString('hex');
      db.saveFile({ id, workspaceId: wsId, by: me, name, type, size }, Buffer.concat(chunks));
      return json(res, 200, { id, url: `/api/files/${id}`, name, type, size });
    }
    const fileReq = p.match(/^\/api\/files\/([a-f0-9]{32})$/);
    if (fileReq && req.method === 'GET') {
      const f = db.fileInfo(fileReq[1]);
      if (!f) return json(res, 404, { error: 'No such file.' });
      const team = memberOf(me).some((w) => w.id === f.workspaceId);
      const guest = !team && portalsOf(me).some((pt) => pt.workspaceId === f.workspaceId);
      if (!team && !guest) return json(res, 404, { error: 'No such file.' });
      const data = db.fileData(f.id);
      if (!data) return json(res, 404, { error: 'The file is gone.' });
      res.writeHead(200, { 'content-type': f.type, 'content-length': data.length, 'cache-control': 'private, max-age=86400', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
      return res.end(data);
    }

    if (p === '/api/sync' && req.method === 'POST') {
      if (pset.maintenance.on && !opRecord) return json(res, 503, { error: pset.maintenance.message || 'Changes are paused for a few minutes while sprint2go is updated.' });
      const { coll, upserts = [], deletes = [] } = await body(req);
      if (!COLLS.includes(coll)) return json(res, 400, { error: 'Unknown collection' });
      if (['todos', 'messages', 'events', 'rows', 'notes', 'drive'].includes(coll) && upserts.length) {
        const wsId = (upserts as any[]).find((d) => d?.workspaceId)?.workspaceId;
        if (wsId && memberOf(me).some((w) => w.id === wsId) && !db.getDoc(coll, upserts[0].id)) platform.firstEvent('first.use', wsId, me, coll);
      }
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
        // The vault key pair: a public key anyone may read, and the private key locked by the passphrase (only its owner can open it).
        const dk = d.vaultKey as any;
        const vk = dk && typeof dk === 'object' && typeof dk.wrapped === 'string' && typeof dk.salt === 'string' && typeof dk.iv === 'string' && dk.pub && typeof dk.pub === 'object' ? { pub: dk.pub, wrapped: String(dk.wrapped).slice(0, 4000), salt: String(dk.salt).slice(0, 64), iv: String(dk.iv).slice(0, 64) } : before.vaultKey;
        return { ...before, name: String(d.name ?? before.name).slice(0, 80) || before.name, title: String(d.title ?? '').slice(0, 80), color: typeof d.color === 'string' ? d.color.slice(0, 20) : before.color, photo, hiddenApps, vaultKey: vk };
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
      const admin = memberOf(me).some((w) => isAdminOf(me, w.id));
      const now = new Date().toISOString();
      /** The rules every write passes: nothing moves between companies, settings are the admins', authors are real. */
      const guard = (d: db.Doc): db.Doc | null => {
        const before = db.getDoc(coll, d.id) as any;
        // A suspended company is read-only for everyone in it.
        const wsId = coll === 'workspaces' ? d.id : ((d as any).workspaceId ?? before?.workspaceId);
        if (wsId && (db.getDoc('workspaces', wsId) as any)?.suspended) return null;
        if (before && 'workspaceId' in before && d.workspaceId !== before.workspaceId) return null;
        if (coll === 'workspaces') {
          if (before) {
            if (!isAdminOf(me, d.id)) return null; // only admins change a company's settings and people
            // What the server and operators own stays as the server has it: readiness, credits, suspension, discounts.
            const own = { mailReady: before.mailReady, mailCredits: before.mailCredits, mailCreditsNotified: before.mailCreditsNotified, suspended: before.suspended, createdAt: before.createdAt };
            const plan = (d as any).plan ? { ...(d as any).plan, comp: before.plan?.comp, discount: before.plan?.discount } : (d as any).plan;
            return { ...d, ...own, plan } as db.Doc;
          }
          const { mailReady: _r, mailCredits: _c, mailCreditsNotified: _n, suspended: _s, ...fresh } = d as any;
          const plan = fresh.plan ? { ...fresh.plan, comp: undefined, discount: undefined } : fresh.plan;
          return { ...fresh, plan, createdAt: new Date().toISOString(), members: [{ userId: me, role: 'owner' }, ...((d.members ?? []) as any[]).filter((m) => m.userId !== me)] } as db.Doc; // whoever makes a company owns it
        }
        if (coll === 'users') {
          if (d.id === me) return d; // own profile: already shaped
          if (before) return null; // nobody edits someone else's record
          if (!admin && mine.size) return null; // new people come in through invites, which admins send
          const { clientOf: _c, vaultKey: _v, ...rest } = d as any;
          return rest as db.Doc;
        }
        if (before) return d;
        // New things carry who made them.
        if (coll === 'todos') return { ...d, createdBy: me, ...(d.createdAt ? {} : { createdAt: now }) } as db.Doc;
        if (coll === 'messages') return d.userId === me ? d : null;
        if (coll === 'notes') return { ...d, ownerId: me } as db.Doc;
        if (coll === 'rows' || coll === 'tables' || coll === 'quotes' || coll === 'meetings') return { ...d, createdBy: me } as db.Doc;
        if (coll === 'drive') return { ...d, uploadedBy: (d as any).uploadedBy ?? me } as db.Doc;
        if (coll === 'events') return { ...d, createdBy: (d as any).createdBy ?? me } as db.Doc;
        return d;
      };
      for (let i = ok.length - 1; i >= 0; i--) {
        const d = ownProfile(ok[i]!) ? ok[i]! : mayWrite(ok[i]!);
        const g = d && (ownProfile(d) ? d : guard(d));
        if (g) ok[i] = g;
        else ok.splice(i, 1);
      }
      const dels = mine.size
        ? (deletes as string[]).filter((id) => {
            const before = db.getDoc(coll, id);
            return !before || (see(coll, before) && mayDelete(before));
          })
        : [];
      const delDocs = dels.map((id) => db.getDoc(coll, id)).filter(Boolean) as db.Doc[];
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
      // Email settings changed: check what really works again.
      const emailChanged =
        coll === 'workspaces'
          ? (ok as any[]).filter((d) => {
              const b = db.getDoc('workspaces', d.id) as any;
              const pick = (w: any) => JSON.stringify([w?.emailSetup, w?.domains, w?.mailRoute, w?.mailRouting, (w?.accounts ?? []).map((a: any) => [a.id, a.email, a.provider])]);
              return !b || pick(b) !== pick(d);
            }).map((d) => d.id)
          : [];
      db.writeDocs(coll, ok, dels, me);
      for (const id of emailChanged) soonReadiness(id);
      if (leavers.length) endGuestAccess(leavers);
      // Guests don't live in the app all day: a notice for them also goes out as an email (when mail is set up).
      if (coll === 'notices' && mailConfigured())
        for (const n of ok as any[]) {
          if (!String(n.userId).startsWith('email:') || n.read) continue;
          const to = String(n.userId).slice(6);
          const w = db.getDoc('workspaces', n.workspaceId) as any;
          const brandName = w?.whiteLabel?.enabled ? w.whiteLabel.name : w?.name ?? 'sprint2go';
          const origin = w?.whiteLabel?.enabled && w.whiteLabel.domain && w.whiteLabel.domainStatus === 'verified' ? `https://${w.whiteLabel.domain}` : PUBLIC_URL;
          void sendMail(to, `${brandName}: ${String(n.text).slice(0, 80)}`, `${n.text}\n\nOpen your shared space: ${origin}`, simpleHtml(brandName, [String(n.text)], { text: 'Open your shared space', url: origin })).catch((e) => console.error('[mail]', e instanceof Error ? e.message : e));
        }
      const conn = String(req.headers['x-conn'] ?? '');
      broadcast(coll, ok, dels, clients.get(conn)?.userId === me ? conn : undefined, delDocs);
      if (rowsBefore) tablesEngine.afterRowWrite(tablesEnv, rowsBefore as any, ok as any, me);
      // A deleted meeting takes its recording with it.
      if (RECORDER_URL) for (const id of botAudio) recorder(`/recordings/${id}`, { method: 'DELETE' }).catch(() => {});
      return json(res, 200, { saved: ok.length });
    }

    // Huddles: WebRTC offers, answers and candidates relayed to one person in a company you share. Audio goes
    // straight between browsers; the server only passes these notes along.
    if (p === '/api/signal' && req.method === 'POST') {
      const { to, data } = await body(req);
      const peers = new Set(memberOf(me).flatMap((w) => w.members.map((m) => m.userId)));
      if (typeof to !== 'string' || !peers.has(to)) return json(res, 403, { error: 'Not someone you work with.' });
      for (const c of clients.values()) if (c.userId === to) c.res.write(`event: signal\ndata: ${JSON.stringify({ from: me, data })}\n\n`);
      return json(res, 200, {});
    }

    if (p === '/api/events') {
      const id = randomBytes(8).toString('hex');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ conn: id })}\n\n`);
      clients.set(id, { res, userId: me, token: cookie(req, 's2g') });
      req.on('close', () => clients.delete(id));
      return;
    }

    // Vault: shared logins. Only people given access see an item; passwords and 2FA codes leave the server one at a time, logged.
    // WhatsApp Business: the token is kept here (like AI keys); the browser only sees that it's connected.
    if (p === '/api/whatsapp/connect' && req.method === 'POST') {
      const { workspaceId, phoneNumberId, token, displayPhone } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: 'Only admins can connect WhatsApp.' });
      if (typeof phoneNumberId !== 'string' || !phoneNumberId.trim() || typeof token !== 'string' || token.trim().length < 20) return json(res, 400, { error: 'Paste the phone number ID and a permanent access token from Meta.' });
      db.saveKey(workspaceId, 'whatsapp', token.trim(), phoneNumberId.trim(), me);
      const w = db.getDoc('workspaces', workspaceId) as any;
      const verifyToken = w.whatsapp?.verifyToken ?? randomBytes(12).toString('hex');
      const doc = { ...w, whatsapp: { phoneNumberId: phoneNumberId.trim(), displayPhone: displayPhone ? String(displayPhone).slice(0, 30) : undefined, connected: true, verifyToken } };
      db.writeDocs('workspaces', [doc], [], me);
      broadcast('workspaces', [doc], []);
      return json(res, 200, { verifyToken });
    }
    if (p === '/api/whatsapp/connect' && req.method === 'DELETE') {
      const { workspaceId } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, {});
      db.deleteKey(workspaceId, 'whatsapp');
      const w = db.getDoc('workspaces', workspaceId) as any;
      const doc = { ...w, whatsapp: w.whatsapp ? { ...w.whatsapp, connected: false } : undefined };
      db.writeDocs('workspaces', [doc], [], me);
      broadcast('workspaces', [doc], []);
      return json(res, 200, {});
    }
    if (p === '/api/whatsapp/send' && req.method === 'POST') {
      const { workspaceId, to, text, channelId } = await body(req);
      if (!memberOf(me).some((w) => w.id === workspaceId)) return json(res, 403, {});
      const key = db.loadKey(workspaceId, 'whatsapp');
      if (!key?.baseUrl) return json(res, 409, { error: 'WhatsApp isn’t connected. Settings, Apps & chat.' });
      const number = String(to ?? '').replace(/\D/g, '');
      if (!number || typeof text !== 'string' || !text.trim()) return json(res, 400, { error: 'A number and a message, please.' });
      const r = await fetch(`https://graph.facebook.com/v21.0/${key.baseUrl}/messages`, { method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'text', text: { body: text.trim().slice(0, 4000) } }) }).catch(() => null);
      if (!r?.ok) return json(res, 502, { error: ((await r?.json().catch(() => null)) as any)?.error?.message ?? 'WhatsApp didn’t accept the message.' });
      if (typeof channelId === 'string') {
        const chan = db.getDoc('channels', channelId) as any;
        if (chan && (chan.members ?? []).includes(me)) {
          const doc = { id: randomBytes(8).toString('hex'), channelId, userId: me, text: text.trim(), at: new Date().toISOString(), via: 'whatsapp' } as db.Doc;
          db.writeDocs('messages', [doc], [], me);
          broadcast('messages', [doc], []);
        }
      }
      return json(res, 200, {});
    }

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
      // Re-share: someone who holds a login's key wraps it for people who don't have it yet. Only keys change.
      const keysReq = p.match(/^\/api\/vault\/([\w-]+)\/keys$/);
      if (keysReq && req.method === 'POST') {
        const it = db.vaultGet(keysReq[1]);
        if (!it || !canSee(it)) return json(res, 404, { error: 'No such login.' });
        if (!it.meta.keys?.[me] && !canEdit(it)) return json(res, 403, { error: 'You don’t hold the key to this login.' });
        const b = await body(req);
        const added = Object.fromEntries(Object.entries((b.keys ?? {}) as Record<string, any>).filter(([, k]) => k && typeof k.ct === 'string' && typeof k.iv === 'string' && k.epk));
        db.vaultSave({ id: it.id, workspaceId: it.workspaceId, meta: { ...it.meta, keys: { ...(it.meta.keys ?? {}), ...added } }, by: me });
        db.vaultLog(it.id, me, `re-shared with ${Object.keys(added).length} people`);
        return json(res, 200, { ok: true, added: Object.keys(added).length });
      }
      if (p === '/api/vault' && req.method === 'POST') {
        const b = await body(req);
        if (!memberOf(me).some((w) => w.id === b.workspaceId)) return json(res, 403, {});
        const id = typeof b.id === 'string' && b.id ? b.id : 'v-' + randomBytes(6).toString('hex');
        const before = db.vaultGet(id);
        if (before && !canEdit(before)) return json(res, 403, { error: 'Only the person who added it, or an admin, can change it.' });
        if (b.totp && !String(b.totp).startsWith('enc:')) {
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
          // End-to-end: the item key wrapped for each person who may open it. The server can't use these.
          keys: b.meta?.keys && typeof b.meta.keys === 'object' ? Object.fromEntries(Object.entries(b.meta.keys as Record<string, any>).filter(([, k]) => k && typeof k.ct === 'string' && typeof k.iv === 'string' && k.epk).slice(0, 500)) : undefined,
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
        // The 2FA secret leaves the server only to someone who can edit the login (to move it to end-to-end), or
        // already encrypted end-to-end (then it's unreadable here anyway).
        if (field !== 'password' && field !== 'notes' && !(field === 'totp' && (canEdit(item) || item.meta.keys))) return json(res, 400, {});
        db.vaultLog(item.id, me, field === 'password' ? 'copied the password' : field === 'totp' ? 'used a 2FA code' : 'read the notes');
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
      if (tooMany(`ai:${me}`, 40, 60_000)) return json(res, 429, { error: 'That’s a lot of AI in one minute. Give it a moment.' });
      // Monthly caps (Settings, AI): what the company, and each person, may spend on its own keys this month.
      const capWs = workspaces().find((w) => w.id === b.workspaceId) as any;
      const caps = capWs?.ai?.caps as { companyRp?: number; personRp?: number } | undefined;
      if (caps?.companyRp || caps?.personRp) {
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const rows = db.usageSince(b.workspaceId, monthStart) as { job: string; provider: string; model: string; inTokens: number; outTokens: number }[];
        if (caps.companyRp && spendRp(rows) >= caps.companyRp) return json(res, 429, { error: `The company’s AI budget for this month (Rp ${caps.companyRp.toLocaleString('id-ID')}) is used up. An admin can raise it in Settings, AI.` });
        if (caps.personRp && spendRp(db.usageSinceFor(b.workspaceId, me, monthStart) as any) >= caps.personRp) return json(res, 429, { error: `Your AI budget for this month (Rp ${caps.personRp.toLocaleString('id-ID')}) is used up. An admin can raise it in Settings, AI.` });
      }
      const cfg = aiFor(b.workspaceId, JOB_OF[action]);
      if (!cfg) return json(res, 409, { error: 'no-key' });
      cfg.onUsage = (inTokens, outTokens) => db.logUsage({ workspaceId: b.workspaceId, userId: me, job: JOB_OF[action], provider: cfg.included ? 'included' : cfg.provider, model: cfg.model, inTokens, outTokens });
      return json(res, 200, await withAI(cfg, () => routes[action](b)));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err instanceof AIError ? err.status : (err as { status?: number }).status === 429 ? 503 : err instanceof SyntaxError ? 400 : 500;
    console.error(`[${new Date().toISOString()}] ${req.method} ${p}`, err instanceof Error ? (status === 500 ? err.stack : err.message) : err);
    if (status === 500) platform.recordError({ source: 'server', message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined, path: `${req.method} ${p}`, userId: db.sessionUser(cookie(req, 's2g')) });
    // Never leak keys or raw upstream errors.
    json(res, status, { error: err instanceof AIError ? err.message : status === 503 ? 'AI is busy, try again shortly.' : 'Something went wrong.' });
  }
}).listen(PORT, HOST, () => {
  console.log(`sprint2go on http://localhost:${PORT}${mailConfigured() ? ' (email on)' : ' (no email: codes go to this log)'}`);
  mailer.startMailer({ publicUrl: PUBLIC_URL, broadcast, log: (line) => console.log(line), notify: notifyPeople });
});

/** Whether the meeting recorder answers, checked every few minutes (the app asks often). */
let recorderUp = false;
const pollRecorder = () => (RECORDER_URL && RECORDER_SECRET ? recorder('/health').then((r) => (recorderUp = r.ok), () => (recorderUp = false)) : Promise.resolve((recorderUp = false)));
setTimeout(() => void pollRecorder(), 5_000);
setInterval(() => void pollRecorder(), 3 * 60_000);
const DEMO = process.env.S2G_DEMO === '1' || process.env.NODE_ENV !== 'production';
function caps() {
  return {
    demo: DEMO, // demo stand-ins (AI answers, a pretend notetaker, pretend calendar connections) are allowed
    recorder: recorderUp,
    boosted: mailer.boostedAvailable(),
    googleCalendar: !!process.env.GOOGLE_CLIENT_ID,
    microsoftCalendar: !!process.env.MS_CLIENT_ID,
    calendarLinks: false, // .ics links aren't fetched by the server yet
    payments: !!process.env.XENDIT_SECRET,
    desktopUrl: process.env.DESKTOP_URL || null,
    mailHost: mailer.MAIL_HOST,
  };
}
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** A company's email changed: check again shortly (several saves in a row count once). */
function soonReadiness(wsId: string) {
  clearTimeout(refreshTimers.get(wsId));
  refreshTimers.set(wsId, setTimeout(() => (refreshTimers.delete(wsId), void mailer.refreshReadiness(wsId).catch(() => {})), 3000));
}
const recorderInfo = { configured: !!RECORDER_URL && !!RECORDER_SECRET, health: () => recorder('/health').then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean; bots?: number }>) : null), () => null) };

/** Which feature flags are on for any of these companies. */
function flagsFor(wsIds: string[], flags: platform.PlatformSettings['flags']) {
  const bucket = (id: string) => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 100, 7);
  return Object.entries(flags)
    .filter(([, f]) => f.mode === 'on' || (f.mode === 'list' && wsIds.some((id) => f.companies.includes(id))) || (f.mode === 'percent' && wsIds.some((id) => bucket(id) < f.percent)))
    .map(([k]) => k);
}

/** A notice in the app's bell. Operators get theirs in our own company when they're in it; links into the backend open it. */
function notifyUsers(userIds: string[], text: string, url?: string, workspaceId?: string) {
  const at = new Date().toISOString();
  const home = platform.settings().homeWorkspace;
  const notices = Array.from(new Set(userIds)).flatMap((userId) => {
    const mine = memberOf(userId);
    const ws = workspaceId && mine.some((w) => w.id === workspaceId) ? workspaceId : home && mine.some((w) => w.id === home) ? home : mine[0]?.id;
    if (!ws) return [];
    const link = url?.startsWith('/settings/') ? { app: 'settings', id: url.split('/')[2] } : undefined;
    return [{ id: `n-${randomBytes(6).toString('hex')}`, userId, workspaceId: ws, kind: 'team', text: text.slice(0, 240), at, read: false, ...(link ? { link } : url ? { url } : {}) }];
  });
  if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
}

/** Tells the support team about a ticket: the assignee for replies, everyone on support for new ones. */
function supportNotify(t: support.Ticket, text: string, reply = false) {
  const users = db.allDocs('users') as any[];
  const emails = reply && t.assignee ? [t.assignee] : platform.operators().filter((o) => !o.disabled && platform.permsOf(o.role).includes('support')).map((o) => o.email);
  const ids = emails.map((e) => users.find((u) => String(u.email ?? '').toLowerCase() === e)?.id).filter(Boolean) as string[];
  notifyUsers(ids, text, `/admin/tickets/${t.id}`);
}

// Mail to support@, abuse@ and postmaster@ becomes a ticket, or a reply on one.
mailer.onSupportMail(async ({ to, parsed, mid, refs, spam, attachments }) => {
  const from = parsed.from?.value?.[0];
  const email = String(from?.address ?? '').toLowerCase();
  if (!email || spam) return;
  const text = (parsed.text ?? '').split(/\n(?:On .+ wrote:|-----Original Message-----|>)/)[0].trim() || (parsed.text ?? '').trim();
  const subject = String(parsed.subject ?? '').trim();
  const num = subject.match(/\[#(\d+)\]/)?.[1];
  const existing = (num && support.ticket(num)) || refs.map((r) => support.ticketByMid(r)).find(Boolean) || null;
  if (existing && existing.requester.email === email) {
    support.addMessage(existing.id, { kind: 'customer', author: email, authorName: from?.name || null, body: text, internal: false, attachments, mid });
    support.customerReplied(existing.id);
    supportNotify(existing, `${from?.name || email} replied by email on #${existing.number}`, true);
    return;
  }
  const u = (db.allDocs('users') as any[]).find((x) => String(x.email ?? '').toLowerCase() === email && !x.deletedAt);
  const ws = u ? (memberOf(u.id)[0] as any) : null;
  const tag = to.startsWith('abuse@') ? 'abuse' : to.startsWith('postmaster@') ? 'postmaster' : null;
  const t = support.createTicket({ subject: subject.replace(/^\s*((re|fwd?)\s*:\s*)+/i, '') || '(no subject)', body: text || '(empty)', channel: 'email', email, name: from?.name || u?.name || null, userId: u?.id ?? null, workspaceId: ws?.id ?? null, paying: ws ? admin.mrrOf(ws, ws.members.length).state === 'paying' : false, priority: tag === 'abuse' ? 'high' : undefined, tags: tag ? [tag] : [], attachments, mid });
  supportNotify(t, `New ticket #${t.number} by email from ${from?.name || email}: ${t.subject.slice(0, 70)}`);
  // A short receipt so they know it arrived (not for auto-replies).
  if (!parsed.headers.get('auto-submitted') && !/no-?reply|mailer-daemon/i.test(email))
    void mailer.sendSystemMail({ fromName: platform.settings().supportName, to: [email], subject: `Re: ${t.subject} [#${t.number}]`, text: `Thanks, we have your message (ticket #${t.number}) and will reply here. Reply to this email to add anything.`, inReplyTo: mid, references: [mid] }).catch(() => {});
});

/** A notice for these people (the mail engine uses it for failures and credits). */
function notifyPeople(userIds: string[], workspaceId: string, text: string, link?: string) {
  const at = new Date().toISOString();
  const notices = Array.from(new Set(userIds)).map((userId) => ({ id: `n-${randomBytes(6).toString('hex')}`, userId, workspaceId, kind: 'mail', text, at, read: false, link: link?.startsWith('/settings') ? { app: 'settings', id: link.split('/')[2] } : { app: 'mail' } }));
  if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
}

// Once a day: expired sessions go, and a copy of the database lands in data/backups (the last 14 are kept).
const housekeeping = () => {
  try {
    db.purgeSessions();
  } catch (e) {
    console.error('[sessions]', e);
  }
  db.backup().then((f) => console.log(`Backup: ${f}`)).catch((e) => console.error('[backup]', e instanceof Error ? e.message : e));
};
setTimeout(housekeeping, 60_000);
setInterval(housekeeping, 24 * 60 * 60_000);

/* ---------- every hour: what the operator backend keeps an eye on ---------- */
const adminDeps = () =>
  ({ spendRp, publicUrl: PUBLIC_URL, recorder: recorderInfo, sseClients: () => clients.size, startedAt: STARTED, notifyUsers, mailOn: mailConfigured() }) as unknown as admin.AdminCtx;
const hourly = async () => {
  try {
    support.closeStale();
    admin.snapshot(adminDeps());
    const at = new Date().toISOString();
    const s = platform.settings();
    // Deletion requests whose waiting time is over.
    let changed = false;
    const requests = s.dataRequests.map((r) => {
      if (r.done || r.cancelled || r.runAt > at) return r;
      const gone = db.deleteWorkspaceDocs(r.workspaceId, true);
      for (const [coll, ids] of Object.entries(gone)) broadcast(coll, [], ids);
      db.audit('system', 'company.delete-request.run', r.workspaceId, `requested by ${r.requestedBy}`);
      changed = true;
      return { ...r, done: at };
    });
    if (changed) platform.setSetting('dataRequests', requests);
    // Overdue invoices: read-only after the grace period, when that's switched on.
    if (s.autoSuspendDays > 0) {
      for (const inv of platform.overdueInvoices()) {
        if (inv.dueAt > new Date(Date.now() - s.autoSuspendDays * 86_400_000).toISOString()) continue;
        const ws = db.getDoc('workspaces', inv.workspaceId) as any;
        if (!ws || ws.suspended) continue;
        const next = { ...ws, suspended: { at, by: 'system', reason: `Invoice ${inv.number} is ${s.autoSuspendDays} days overdue. Pay it to carry on.`, why: 'unpaid' } };
        db.writeDocs('workspaces', [next], [], null);
        broadcast('workspaces', [next], []);
        platform.event('company.suspended', ws.id, null, `unpaid: ${inv.number}`);
        db.audit('system', 'company.suspend', ws.id, `unpaid ${inv.number}`);
      }
    }
    // Once a month: open the newest backup and check it.
    if (!s.backupTest || s.backupTest.at < new Date(Date.now() - 30 * 86_400_000).toISOString()) admin.testLatestBackup();
    for (const w of workspaces()) await mailer.refreshReadiness(w.id).catch(() => null);
    await admin.checkAlerts(adminDeps());
  } catch (e) {
    console.error('[hourly]', e instanceof Error ? e.message : e);
  }
};
setTimeout(() => void hourly(), 90_000);
// Readiness right after a start, so a deploy doesn't leave mail locked for an hour.
setTimeout(() => void Promise.all(workspaces().map((w) => mailer.refreshReadiness(w.id).catch(() => null))), 20_000);
setInterval(() => void hourly(), 60 * 60_000);

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
  const sendNow: any[] = [];
  const threads = (db.allDocs('threads') as any[]).flatMap((t) => {
    if (t.sendAt && t.sendAt <= now) return (sendNow.push(t), [{ ...t, sendAt: undefined, location: 'archive', messages: t.messages.map((m: any) => ({ ...m, date: now })) }]);
    if (t.snoozedUntil && t.snoozedUntil <= now) return [{ ...t, snoozedUntil: undefined, unread: true }];
    return [];
  });
  if (threads.length) {
    db.writeDocs('threads', threads, [], null);
    broadcast('threads', threads, []);
  }
  // "Send later" mail goes out for real now.
  for (const t of sendNow) {
    const ws = workspaces().find((w) => (w.accounts ?? []).some((a: any) => a.id === t.accountId)) as any;
    const account = ws?.accounts?.find((a: any) => a.id === t.accountId);
    const m = t.messages[t.messages.length - 1];
    if (!ws || !account || !m || (account.provider && account.provider !== 'sprint2go')) continue;
    void mailer
      .queueSend({ workspaceId: ws.id, accountId: account.id, threadId: t.id, messageId: m.id, from: { name: account.name || ws.name, email: String(account.email).toLowerCase() }, to: m.to ?? [], cc: [], subject: t.subject, text: m.body ?? '', html: m.html, files: (m.attachments ?? []).filter((a: any) => a.url).map((a: any) => ({ name: a.name, url: a.url })) })
      .catch((e) => console.error('[mail] scheduled send', e instanceof Error ? e.message : e));
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
