// sprint2go local server: the app, its database, logins, live updates and the AI router, on one port.
// Run:  npm run server   (after `npm run build`), then open http://localhost:8787
// In development, `npm run dev` proxies /api here, so run both.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, createWriteStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { extname, join, normalize } from 'node:path';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import * as db from './db.ts';
import * as ai from './ai.ts';
import { AIError, isModelGone, keyHint, testKey, type AIConfig } from './llm.ts';
import * as aiplan from './aiplan.ts';
import * as models from './models.ts';
import { defaultModelOf } from '../src/data/aiModels.ts';
import { seed, RECORD_KEYS, type CollectionKey } from '../src/seed.ts';
import { DEFAULT_PERMISSIONS, type CalEvent } from '../src/types.ts';
import { answerSeries } from '../src/repeat.ts';
import { JOBS, PROVIDERS } from '../src/data/aiCatalog.ts';
import { TOP_UP } from '../src/data/pricing.ts';
import { languageName, languagesText } from '../src/data/languages.ts';
import { hasBranding } from '../src/data/pricing.ts';
import * as tablesEngine from './tables.ts';
import { mailConfigured, simpleHtml } from './mail.ts';
import * as admin from './admin.ts';
import * as mailer from './mailer.ts';
import * as readTracking from './readTracking.ts';
import * as mailTeam from './mailTeam.ts';
import { wakeThread } from '../src/mailRules.ts';
import * as routing from './routing.ts';
import * as offsite from './offsite.ts';
import { certState } from './mailcert.ts';
import { ownership as domainOwnership } from './domains.ts';
import * as invites from './invites.ts';
import { buildReply } from './ics.ts';
import * as platform from './platform.ts';
import * as support from './support.ts';
import * as customDomains from './customDomains.ts';
import * as push from './push.ts';
import * as pushRules from './notifyPush.ts';
import * as turn from './turn.ts';
import * as feeds from './calendarFeeds.ts';
import * as calendarInvites from './calendarInvites.ts';
import { FetchError } from './safeFetch.ts';
import * as twostep from './twostep.ts';
import * as whatsapp from './whatsapp.ts';
import * as billing from './billing.ts';
import * as bimi from './bimi.ts';
import * as aiLimits from './aiLimits.ts';
import * as whitelist from './whitelist.ts';
import { gzipSync } from 'node:zlib';
import { accessFor, can, channelsFor, clientPeople, companyOf, filesFor, guestRow, guestTable, isFreemail, meetingsFor, tasksFor } from '../src/clientView.ts';
import { DEFAULT_STAGES, cleanStages, stageIdFor, stagesFrom } from '../src/stages.ts';
import * as autojoin from './autojoin.ts';
import * as summaries from './summaries.ts';
import * as chatLater from './chatLater.ts';
import * as taskFiles from './taskFiles.ts';
import * as digest from './digest.ts';
import * as retention from './retention.ts';
import * as sandbox from './sandbox.ts';
import * as imports from './imports.ts';
import { isSandboxId, sandboxWsId } from '../src/sandbox.ts';
import { companyTz, isZone } from '../src/jobTimes.ts';
import * as connector from './connector.ts';
import { eventReminders, reminderWords } from './eventReminders.ts';
import * as notesTrash from './notesTrash.ts';
import * as mailApps from './mailApps.ts';
import * as lang from './lang.ts';
import { mark, msg, phrase, t, textOf } from '../src/i18n/index.ts';
import { fmtDayLong, fmtMonth } from '../src/i18n/format.ts';

for (const f of ['.env', '.env.example']) if (existsSync(f)) process.loadEnvFile(f); // .env wins: values already set are kept
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1'; // localhost only, unless hosted (HOST=0.0.0.0 in the container)
const DIST = join(process.cwd(), 'dist');
const STARTED = Date.now();
/** Which build is running: dist/version.json, written by `npm run build` (scripts/build-stamp.mjs). */
const BUILD = (() => {
  try {
    return JSON.parse(readFileSync(join(DIST, 'version.json'), 'utf8')) as { builtAt: string; bundle: string | null; commit: string | null };
  } catch {
    return null;
  }
})();
/** Sign-ups waiting for their email code (in memory: a restart just means starting again). */
const signups = new Map<string, { name: string; hash: string; code: string; tries: number; until: number }>();

/** The task stages a task follows (src/stages.ts): its project's own, else its team's own, else its company's. */
const taskStagesOf = (t: any, w?: any) => stagesFrom({ client: t?.clientId ? (db.getDoc('clients', t.clientId) as any) : null, team: t?.teamId ? (db.getDoc('teams', t.teamId) as any) : null, workspace: w ?? (t?.workspaceId ? db.getDoc('workspaces', t.workspaceId) : null) });

/* ---------- first run: copy the demo company into the database ---------- */

const COLLS = Object.keys(seed()) as CollectionKey[];
const toDocs = (key: CollectionKey, value: unknown): db.Doc[] =>
  RECORD_KEYS.includes(key) ? Object.entries(value as Record<string, unknown>).map(([id, v]) => ({ id, value: v })) : (value as db.Doc[]);

if (db.isEmpty() && (process.env.S2G_DEMO === '1' || process.env.NODE_ENV !== 'production')) {
  const s = seed();
  const pw = process.env.SEED_PASSWORD;
  if (!pw) throw new Error('Set SEED_PASSWORD in .env (see .env.example) before the first run.');
  // Client people who already joined can sign in to their portal (same demo password).
  const known = new Set(s.users.map((u) => u.email.toLowerCase()));
  // People who already have a sign-in (e.g. Dimas at Elkiya) just get the portal on their existing account.
  const clientUsers = s.clients.flatMap((c) =>
    (c.people ?? []).filter((x) => x.status === 'joined' && !known.has(x.email.toLowerCase())).map((x) => ({ id: `cu-${x.email.split('@')[0]}-${c.id}`, name: x.name, email: x.email, title: c.name, color: c.color, clientOf: { workspaceId: c.workspaceId, clientId: c.id } })),
  );
  // Every demo password is hashed before anything is written, and the server only listens after this (top-level
  // await): a sign-in right after the first start never meets a login that isn't saved yet, and a start stopped
  // halfway leaves an empty database that seeds again next time.
  const people = [...s.users, ...clientUsers].map((u) => ({ id: u.id, email: u.email }));
  const hashes = await Promise.all(people.map(() => db.hashPassword(pw)));
  for (const k of COLLS) db.writeDocs(k, toDocs(k, s[k]), [], null);
  db.writeDocs('users', clientUsers as unknown as db.Doc[], [], null);
  db.setLoginHashes(people.map((u, i) => ({ userId: u.id, email: u.email, hash: hashes[i] })));
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
// The Whitelist tells owners, people and operators at 80% and 100% of its monthly limits (server/whitelist.ts).
whitelist.init({ notify: (ids, text, url, wsId) => notifyUsers(ids, text, url, wsId), operators: (kind, text, to) => admin.tellOperators(kind, text, to, notifyUsers) });
admin.loadPricing();
billing.rememberExistingTrials(); // trials companies had before "one per person" count too
// Companies that had "Require two-step sign-in" on before it did anything: their days start now, and people hear.
const clocksStarted = twostep.startClocks();
if (clocksStarted.length) setTimeout(() => clocksStarted.forEach((id) => tellTwoStepRequired(id, null)), 5_000);

// Once, on a production server and only when S2G_PURGE_DEMO=1 is set: the demo companies that a start-up top-up put
// into the live database by mistake go (with whatever was made inside them, and the demo people's sign-ins). A backup
// is taken first; real companies stay.
if (process.env.S2G_PURGE_DEMO === '1' && process.env.NODE_ENV === 'production' && process.env.S2G_DEMO !== '1' && !(platform.settings() as any).demoPurged) {
  void db
    .backup('before-demo-cleanup')
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

type Ws = { id: string; members: { userId: string; role: string }[]; accounts?: { id: string }[]; ai?: { jobs?: Record<string, { provider: string; model: string; fallback?: string; typed?: boolean }>; providers?: { id: string; status: string; model?: string }[]; payer?: string } };
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
/**
 * What a customer attaches to a ticket: files they uploaded themselves (Help uploads them), never another address,
 * since support opens what's on a ticket.
 */
const ticketFiles = (list: unknown, userId: string) =>
  (Array.isArray(list) ? list : [])
    .filter((a: any) => a && typeof a.url === 'string' && support.fileFitsTicket(db.fileInfo(/^\/api\/files\/([a-f0-9]{32})$/.exec(a.url)?.[1] ?? ''), userId, new Date().toISOString()))
    .slice(0, 10)
    .map((a: any) => ({ name: String(a.name ?? 'file').slice(0, 200), url: String(a.url), size: a.size ? String(a.size).slice(0, 20) : undefined }));
/**
 * Who may open which file, kept for two minutes once it was yes: a video seeks with many requests, and each check
 * looks through the documents that link the file. A no is never kept, so a file shared a moment ago opens at once.
 */
const fileOk = new Map<string, number>();
const fileOkFresh = (key: string) => (fileOk.get(key) ?? 0) > Date.now() - 2 * 60_000;
const fileOkNote = (key: string) => {
  fileOk.set(key, Date.now());
  if (fileOk.size > 5000) for (const [k, at] of fileOk) if (at < Date.now() - 2 * 60_000) fileOk.delete(k);
};
/** An operator opening the same ticket file again within ten minutes (a video seeking, a second tab) is one audit entry. */
const fileOpens = new Map<string, number>();
const firstOpenInAWhile = (key: string) => {
  const now = Date.now();
  if ((fileOpens.get(key) ?? 0) > now - 10 * 60_000) return false;
  fileOpens.set(key, now);
  if (fileOpens.size > 5000) for (const [k, at] of fileOpens) if (at < now - 10 * 60_000) fileOpens.delete(k);
  return true;
};
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
  // Everyone sees their own profile and settings, even a new account with no company and nothing shared yet (only
  // their demo company, say).
  const self = (coll: string, d: any) => ((coll === 'users' || coll === 'prefs' || coll === 'statuses') && d.id === userId ? d : null);
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
  // Tasks: owners and admins see all of a company's; members see their own work, their teams', the projects they're on
  // (every project when the company allows it) and their channels'. The same rule as the app's.
  // Built only when a task is checked (most live updates aren't tasks).
  let taskCtx: { adminOf: Set<string>; seeAll: Set<string>; myTeams: Set<string>; myProjects: Set<string> } | null = null;
  // Projects follow the same rule: owners and admins see every one, members the ones they're on (all of them when the
  // company allows "See every project"). Everything inside a project follows it: its channels and their messages, files,
  // notes, meetings, quotes, tables and their rows, and its guests' names. Built only when needed.
  let projects: Map<string, any> | null = null;
  const projectById = (id: string) => (projects ??= new Map((db.allDocs('clients') as any[]).map((c) => [String(c.id), c]))).get(id);
  const seesAll = new Set(ws.filter((w) => mine.has(w.id) && (w.members.some((m) => m.userId === userId && m.role !== 'member') || { ...DEFAULT_PERMISSIONS, ...((w as any).permissions ?? {}) }.seeAllProjects)).map((w) => w.id));
  const projectOk = (c: any) => {
    if (!c) return true; // no such project (not saved yet, or gone): nothing to hide
    if (!mine.has(c.workspaceId)) return false;
    if (seesAll.has(c.workspaceId) || c.ownerId === userId || (c.members ?? []).some((m: any) => m.userId === userId)) return true;
    return ctxOf().myProjects.has(c.id);
  };
  const inProject = (clientId: unknown) => !clientId || projectOk(projectById(String(clientId)));
  // Guests on the projects you see (some are people at other companies that use sprint2go): so their names and photos show.
  let guestSet: Set<string> | null = null;
  const guests = () => (guestSet ??= new Set((db.allDocs('clients') as any[]).filter((c) => mine.has(c.workspaceId) && projectOk(c)).flatMap((c) => (c.people ?? []).map((p: any) => String(p.email).toLowerCase()))));
  const isMember = (c: any) => (c.members ?? []).includes(userId);
  const channelOk = (c: any) => !!c && mine.has(c.workspaceId) && (isMember(c) || (!(c.private || c.kind === 'dm') && inProject(c.clientId)));
  let tables: Map<string, any> | null = null;
  // A file's project: its own, or its folder's (folders nest).
  let drive: Map<string, any> | null = null;
  const driveProject = (d: any): string | undefined => {
    drive ??= new Map((db.allDocs('drive') as any[]).map((x) => [String(x.id), x]));
    for (let cur = d, i = 0; cur && i < 20; cur = cur.parentId ? drive.get(String(cur.parentId)) : null, i++) if (cur.clientId) return cur.clientId;
    return undefined;
  };
  const doing = (t: any) => t.userId === userId || (t.assignees ?? []).includes(userId) || t.supervisorId === userId;
  const ctxOf = () =>
    (taskCtx ??= (() => {
      // The projects I'm on: I lead or am on it, I'm in one of its channels, or I'm doing one of its tasks (one pass each).
      const viaChannels = new Set([...channels.values()].filter((ch) => ch.clientId && (ch.members ?? []).includes(userId)).map((ch) => String(ch.clientId)));
      const viaTasks = new Set((db.allDocs('todos') as any[]).filter((t) => t.clientId && doing(t)).map((t) => String(t.clientId)));
      return {
        adminOf: new Set(ws.filter((w) => w.members.some((m) => m.userId === userId && m.role !== 'member')).map((w) => w.id)),
        seeAll: new Set(ws.filter((w) => mine.has(w.id) && ({ ...DEFAULT_PERMISSIONS, ...((w as any).permissions ?? {}) }).seeAllProjects).map((w) => w.id)),
        myTeams: new Set((db.allDocs('teams') as any[]).filter((t) => (t.members ?? []).includes(userId) || t.leadId === userId).map((t) => t.id)),
        myProjects: new Set(
          (db.allDocs('clients') as any[])
            .filter((c) => mine.has(c.workspaceId) && (c.ownerId === userId || (c.members ?? []).some((m: any) => m.userId === userId) || viaChannels.has(String(c.id)) || viaTasks.has(String(c.id))))
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
        // Yourself, your companies' people, and the guests of the projects you see.
        return d.id === userId || people.has(d.id) || (!!d.clientOf && mine.has(d.clientOf.workspaceId) && inProject(d.clientOf.clientId)) || guests().has(String(d.email ?? '').toLowerCase());
      case 'workspaces':
        return mine.has(d.id);
      case 'statuses':
        return people.has(d.id);
      case 'prefs':
        return d.id === userId; // your own settings only
      case 'notes':
        // Private notes: only their owner. A project's notes: the people who see the project (and whoever wrote them).
        return mine.has(d.workspaceId) && (d.visibility !== 'private' || d.ownerId === userId) && (d.ownerId === userId || inProject(d.clientId));
      case 'clients':
        return projectOk(d);
      case 'channels':
        return channelOk(d);
      case 'todos':
        return taskOk(d);
      case 'messages':
        // A message waiting for its send time is its author's alone (server/chatLater.ts).
        return channelOk(channels.get(d.channelId)) && !chatLater.hiddenFrom(d, userId);
      case 'drive': {
        const wsId = typeof d.workspaceId === 'string' ? d.workspaceId : firstWs;
        return mine.has(wsId) && (d.ownerId === userId || d.uploadedBy === userId || inProject(driveProject(d)) || (!!d.channelId && isMember(channels.get(String(d.channelId)) ?? {})));
      }
      case 'meetings':
        return mine.has(d.workspaceId) && (d.createdBy === userId || inProject(d.clientId) || (!!me?.name && (d.attendees ?? []).includes(me.name)));
      case 'quotes':
        return mine.has(d.workspaceId) && (d.createdBy === userId || inProject(d.clientId));
      case 'tables':
        return mine.has(d.workspaceId) && (d.createdBy === userId || inProject(d.clientId));
      case 'rows': {
        const t = (tables ??= new Map((db.allDocs('tables') as any[]).map((x) => [String(x.id), x]))).get(String(d.tableId));
        return !!t && mine.has(t.workspaceId) && (t.createdBy === userId || inProject(t.clientId));
      }
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
  // Outside calendars and their events: by who owns them and what they share (see calendarFeeds.ts).
  const calendarView = feeds.lensFor(userId, (other) => people.has(other), (wsId) => mine.has(wsId));
  return (coll, d) => {
    if (coll === 'calendars' || coll === 'events') {
      const shaped = calendarView(coll, d);
      if (shaped !== undefined) return shaped;
    }
    return ok(coll, d) ? d : null;
  };
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
        // Their access already worked out (company, project type and project settings), the company's word for the work,
        // and the task stages (ids and kinds only, the names stay with the team): the portal tells planned, in progress,
        // waiting on them and done.
        return d.id === workspaceId ? { id: d.id, name: d.name, color: d.color, logo: d.logo, domains: [], accounts: [], members: d.members.map((m: any) => ({ userId: m.userId, role: 'member' })), clientAccess: access, terms: d.terms, taskStages: Array.isArray(d.taskStages) ? d.taskStages.map((x: any) => ({ id: x.id, kind: x.kind })) : undefined, plan: d.plan ? { tier: d.plan.tier, track: d.plan.track, addons: d.plan.addons } : undefined } : null;
      case 'users':
        if (d.id === me.id || d.clientOf?.clientId === clientId || people.some((p) => p.email.toLowerCase() === String(d.email ?? '').toLowerCase()))
          return { id: d.id, name: d.name, email: d.email, color: d.color, title: d.title, photo: d.photo, clientOf: d.clientOf };
        if (!team.has(d.id)) return null;
        // Guest access, "Show who's doing the work": hidden names never leave the server, first names only when asked.
        if (access.teamNames === 'hide') return { id: d.id, name: `${w.name} team`, color: w.color, email: '' };
        return { id: d.id, name: access.teamNames === 'first' ? String(d.name ?? '').split(' ')[0] : d.name, color: d.color, title: d.title, photo: d.photo, email: '' };
      case 'clients':
        // A project's own task stages: ids and kinds only, like the company's.
        return d.id === clientId ? { ...d, taskStages: Array.isArray(d.taskStages) ? d.taskStages.map((x: any) => ({ id: x.id, kind: x.kind })) : undefined } : null;
      case 'teams':
        return d.workspaceId === workspaceId ? { id: d.id, workspaceId: d.workspaceId, name: d.name, color: d.color, leadId: d.leadId, members: d.members, taskStages: Array.isArray(d.taskStages) ? d.taskStages.map((x: any) => ({ id: x.id, kind: x.kind })) : undefined } : null;
      case 'channels':
        return myChannels.has(d.id) ? { id: d.id, workspaceId: d.workspaceId, kind: d.kind, name: d.name, topic: d.topic, clientId: d.clientId, category: d.category, members: [], guests: d.guests, materials: d.materials, bookmarks: d.bookmarks } : null;
      case 'messages':
        return myChannels.has(d.channelId) && !chatLater.scheduled(d) ? d : null;
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
  // Their own demo company (server/sandbox.ts), when they have one open: only ever theirs.
  if (demoOpen(userId)) for (const [k, docs] of Object.entries(sandbox.docsOf(userId))) if (out[k]) out[k].push(...docs);
  return out;
}

/**
 * Whether someone may open a demo company of their own: a real sign-in, in a company that lets its people (Settings,
 * Apps & chat; one is enough), or with no company yet and not someone's guest. Guests never see it.
 */
function demoAllowed(userId: string) {
  const u = personOf(userId) as any;
  if (!u || u.suspended || u.deletedAt || !db.hasLogin(userId)) return false;
  const mine = memberOf(userId) as any[];
  if (mine.length) return mine.some((w) => w.demoCompany !== false);
  return !u.clientOf && portalsOf(userId).length === 0;
}
/** Their demo company is made, shown, and still allowed. */
const demoOpen = (userId: string) => sandbox.info(userId)?.hidden === false && demoAllowed(userId);
/** A change in someone's demo company goes to their other open windows only (never to anyone else, never as a push). */
function broadcastSandbox(owner: string, coll: string, upserts: db.Doc[], deletes: string[], except?: string) {
  if (!upserts.length && !deletes.length) return;
  for (const [id, c] of clients) if (id !== except && c.userId === owner) c.res.write(`event: change\ndata: ${JSON.stringify({ coll, upserts, deletes })}\n\n`);
}
/** Their demo company was made again, hidden or shown: their other windows load everything again. */
function reloadWindows(owner: string, except?: string) {
  for (const [id, c] of clients) if (id !== except && c.userId === owner) c.res.write('event: reload\ndata: {}\n\n');
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
      // Changes asked on finished work: it goes back to the company's first "in progress" stage (by kind, whatever it's called).
      const reopen = approval !== before.approval && approval?.status === 'changes' && before.done ? { done: false, status: stageIdFor(before, 'active', taskStagesOf(before, w)), doneAt: undefined, doneBy: undefined } : {};
      // Files on their comments only where the project lets them add files (which files: server/taskFiles.ts).
      const filesOk = !!access.uploads && can(person, 'upload');
      const mine = (h: any) => {
        if (filesOk || !('files' in h)) return { ...h, toClient: true };
        const { files: _f, ...rest } = h;
        return { ...rest, toClient: true };
      };
      return { ...before, ...reopen, approval, history: [...(before.history ?? []), ...added.map(mine)] };
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
      // Marked as from a guest, so the team can choose to hear about guests' replies on their phones.
      return !before && d.workspaceId === workspaceId && (w.members.some((m: any) => m.userId === d.userId) || String(d.userId).startsWith('email:')) ? { ...d, fromGuest: true } : null;
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
/** Adds a Set-Cookie to the answer, keeping any set before it (the session and the remembered-device cookie can go together). */
const addCookie = (res: ServerResponse, c: string) => {
  const had = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(Array.isArray(had) ? had : had ? [String(had)] : []).filter((x) => !x.startsWith(c.split('=')[0] + '=')), c]);
};
const setSession = (res: ServerResponse, token: string | null) => addCookie(res, `s2g=${token ?? ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? 30 * 86400 : 0}${secureCookies() ? '; Secure' : ''}`);
/** The browser's remembered-device tokens (server/twostep.ts), for 30 days. */
const setDeviceCookie = (res: ServerResponse, value: string | null) => addCookie(res, `${twostep.DEVICE_COOKIE}=${value ?? ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${value ? twostep.DEVICE_DAYS * 86400 : 0}${secureCookies() ? '; Secure' : ''}`);
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
/** The largest single upload (S2G_MAX_UPLOAD_MB, 2 GB unless set); a company's storage left can lower it. */
const MAX_UPLOAD = Math.max(1, Number(process.env.S2G_MAX_UPLOAD_MB) || 2048) * 1024 * 1024;
const mb = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, Math.round(n / 1024 ** 2))} MB`);
/** A company's storage: its plan's pool (shared by everyone) and what its files and kept recordings take. */
const storageRoom = billing.storageRoom;
/** The brand people see at this address: an agency's name on its own (verified) domain, otherwise ours. */
function brandNameAt(req: IncomingMessage) {
  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
  const w = (db.allDocs('workspaces') as any[]).find((x) => x.whiteLabel?.enabled && ((x.whiteLabel.domain && x.whiteLabel.domain.toLowerCase() === host && customDomains.isLive(x)) || (x.whiteLabel.slug && `${x.whiteLabel.slug}.localhost` === host)));
  return String(w?.whiteLabel?.name || 'sprint2go');
}
/** A company now requires two-step sign-in: everyone without it hears when it applies, with a link to set it up. */
function tellTwoStepRequired(wsId: string, by: string | null) {
  const w = db.getDoc('workspaces', wsId) as any;
  if (!w?.security?.twoStep) return;
  const ids = (w.members ?? []).map((m: any) => m.userId as string).filter((id: string) => id !== by);
  const on = twostep.onAmong(ids);
  const missing = ids.filter((id: string) => !on.has(id));
  const due = new Date(twostep.deadline(w.security));
  if (missing.length)
    notifyUsers(
      missing,
      due.getTime() > Date.now() + 60_000
        ? msg('{company} now requires two-step sign-in. Turn it on by {date} in Settings, Account.', { company: w.name, date: lang.datePhrase(due, { tz: companyTz(w) }) })
        : msg('{company} now requires two-step sign-in. Turn it on now in Settings, Account.', { company: w.name }),
      '/settings/account',
      w.id,
    );
}
/** Signs someone out everywhere (or everywhere but one session) and closes their live connections. */
function kick(userId: string, keepToken?: string) {
  if (keepToken) twostep.endOtherSessions(userId, keepToken);
  else (db.endSessions(userId), connector.endAll(userId, 'signed out everywhere'), mailApps.endAll(userId));
  for (const [id, c] of clients) if (c.userId === userId && c.token !== keepToken) (c.res.end(), clients.delete(id));
}
/**
 * Six digits, sent by email: through Amazon SES when it's set up, else from no-reply@ our support domain through our
 * own mail engine. Only when neither can send (local development) the code goes to the log (and on screen outside
 * production).
 */
const codes = new Map<string, { code: string; tries: number; until: number; data?: any }>();
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
/** The code email, in `l` (the language of the screen that asked for it): to finish signing up or to set a new password. */
export function codeMail(what: 'signup' | 'reset', code: string, l: lang.Lang) {
  return lang.inLang(l, () => {
    const line = what === 'signup' ? t('{code} is your code to finish signing up.', { code }) : t('{code} is your code to set a new password.', { code });
    return { subject: t('{code} is your sprint2go code', { code }), text: `${line} ${t('It works for 15 minutes.')}`, html: simpleHtml('sprint2go', [line, t('It works for 15 minutes. If this wasn’t you, ignore this email.')]) };
  });
}
async function sendCode(to: string, what: 'signup' | 'reset', code: string, l: lang.Lang) {
  const m = codeMail(what, code, l);
  const sent = await mailer.sendNote(to, m.subject, m.text, m.html).catch((e) => (console.error('[mail]', e instanceof Error ? e.message : e), false));
  if (!sent) console.log(`Code for ${to} (${what === 'signup' ? 'finish signing up' : 'set a new password'}): ${code}`);
  return sent;
}

/** A notice for a guest, by email (guests don't live in the app): in the guest's language (theirs, else the company's). */
export function guestNoticeMail(n: { text: string; tr?: any; workspaceId: string }, to: string, brandName: string, origin: string) {
  return lang.inLang(lang.langOfEmail(to, n.workspaceId), () => {
    const said = textOf(n);
    const open = t('Open your shared space');
    return { subject: `${brandName}: ${said.slice(0, 80)}`, text: `${said}\n\n${t('Open your shared space: {link}', { link: origin })}`, html: simpleHtml(brandName, [said], { text: open, url: origin }) };
  });
}

/** The receipt for a ticket that came by email: in the language of the person who wrote (their account's, else English). */
function ticketReceipt(email: string, number: number) {
  return lang.inLang(lang.langOfEmail(email), () => t('Thanks, we have your message (ticket #{number}) and will reply here. Reply to this email to add anything.', { number }));
}
/** A JSON answer; its error (and any msg() at its top level) in the asker's language (server/lang.ts). */
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(lang.localize(res, data)));
};

/* ---------- live updates (server-sent events) ---------- */

/**
 * Open windows. `visible` and `seen` (the last time the person did something there) come from the app
 * (/api/presence); `desktop`: the Mac or Windows app, which shows our notifications itself (it can't take web push).
 */
const clients = new Map<string, { res: ServerResponse; userId: string; token?: string; visible: boolean; focused: boolean; seen: number; operator?: boolean; desktop?: boolean }>();
/** Using the app right now: a window in front of them where they did something in the last few minutes. */
const IDLE_MS = 5 * 60_000;
const activeNow = (userId: string) => [...clients.values()].some((c) => c.userId === userId && !c.operator && c.visible && Date.now() - c.seen < IDLE_MS);
const desktopsOf = (userId: string) => [...clients.values()].filter((c) => c.userId === userId && c.desktop && !c.operator);
pushRules.initPushRules({
  active: activeNow,
  // The desktop app shows it when its window isn't the one in front.
  desktop: { has: (userId) => desktopsOf(userId).length > 0, send: (userId, alert) => desktopsOf(userId).forEach((c) => !c.focused && c.res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`)) },
});
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
        notices.push({ id: randomBytes(8).toString('hex'), userId: c.ownerId, workspaceId: c.workspaceId, kind: 'team', ...msg('{name} left {company}, so their guest access to {project} ended', { name: p.name ?? p.email, company: gone.get(String(p.email).toLowerCase()) ?? '', project: c.name }), at: new Date().toISOString(), read: false, link: { app: 'projects', id: c.id } } as db.Doc);
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
  // New notices, guests' messages and arriving mail also go to the phones and computers of people who are away.
  pushRules.onBroadcast(coll, upserts);
  // Mail apps over IMAP (server/mailApps.ts) hear about changed mail and access at once.
  mailApps.changed(coll, upserts, deletes);
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
/** Whether our keys serve this company: the AI plan (or a trial, or free months on it), unless it pays for AI itself. */
const onOurAI = (ws: any) => !!ws && ws.ai?.payer !== 'own' && aiplan.planAI(ws).ok;
/**
 * Who runs a job for a company, in order: its own pick for the job (with its key), then our AI with the operators'
 * fallback (AI-plan companies only), else any key the company saved. Each one takes over when the one before fails.
 */
function aiFor(wsId: string, job: string): AIConfig[] {
  const ws = workspaces().find((w) => w.id === wsId);
  const pick = ws?.ai?.jobs?.[job];
  const chain: AIConfig[] = [];
  // Blocked providers are never called for this company (our AI's fallback included); a key at its cap rests.
  const may = aiLimits.allowed(ws as any);
  // The company's own key with the model it picked, exactly as the provider names it; then the job's fallback on its
  // own keys. A call that says the model isn't there has the provider's list read again (see `companyModels`).
  const own = (provider: string, model: string): AIConfig | null => {
    const k = db.loadKey(wsId, provider);
    return k && model ? { provider, model, apiKey: k.key, baseUrl: k.baseUrl, onFail: (e) => isModelGone(e) && recheckModels(wsId, provider) } : null;
  };
  if (pick && pick.provider !== 'included' && may(pick.provider)) {
    const first = own(pick.provider, pick.model);
    if (first) chain.push(first);
    const fb = ownFallback(ws!, pick, may);
    if (fb && !chain.some((c) => c.provider === fb.provider && c.model === fb.model)) {
      const next = own(fb.provider, fb.model);
      if (next) chain.push(next);
    }
  }
  if (onOurAI(ws)) chain.push(...aiplan.ourChain(job).filter((c) => may(c.provider, true)));
  if (chain.length) return chain;
  // Otherwise any key the company saved, with the model it uses by default (or that provider's model for this kind of job).
  const rec = JOBS.find((j) => j.id === job)?.rec;
  for (const p of ws?.ai?.providers ?? []) {
    const info = PROVIDERS.find((x) => x.id === p.id);
    if (!info || info.kind === 'speech' || !may(p.id)) continue;
    const wanted = p.model ?? [rec?.balanced, rec?.best, rec?.cheap].find((m) => info.models.some((x) => x.id === m));
    const c = own(p.id, wanted ?? info.models.find((m) => m.tier === 'balanced')?.id ?? info.models[0].id);
    if (c) return [c];
  }
  return [];
}

/**
 * A job's fallback on the company's own keys: the provider set as its fallback (with the model that key uses), else
 * the picked key's default model when the job uses another one. Null when there's none.
 */
function ownFallback(ws: Ws, pick: { provider: string; model: string; fallback?: string }, may: (provider: string) => boolean): { provider: string; model: string } | null {
  const conns = (ws.ai?.providers ?? []) as { id: string; status?: string; model?: string }[];
  const usable = (id: string) => conns.find((c) => c.id === id && c.status !== 'error' && may(id) && PROVIDERS.find((x) => x.id === id)?.kind !== 'speech');
  const fb = pick.fallback && pick.fallback !== pick.provider ? usable(pick.fallback) : undefined;
  if (fb) {
    const model = defaultModelOf(fb.id, fb.model, (ws.ai?.jobs ?? {}) as any);
    if (model) return { provider: fb.id, model };
  }
  const same = usable(pick.provider);
  return same?.model && same.model !== pick.model ? { provider: same.id, model: same.model } : null;
}

/* ---------- the models a company's keys can use (server/models.ts) ---------- */

/** The list for one of a company's keys (kept about an hour), with its jobs moved off models the provider dropped. */
async function companyModels(wsId: string, provider: string, force = false) {
  const list = await models.listFor(`ws:${wsId}`, provider, db.loadKey(wsId, provider), { force, priceOf: (id) => aiplan.priceOf(id) });
  if (list.source === 'live') moveOffGoneModels(wsId, provider, list);
  return list;
}
/** Jobs on a model the provider no longer offers go to the job's fallback, with a note in Settings, AI. */
function moveOffGoneModels(wsId: string, provider: string, list: Awaited<ReturnType<typeof models.listFor>>) {
  const ws = db.getDoc('workspaces', wsId) as any;
  if (!ws?.ai?.providers) return;
  const next = models.movesFor(ws.ai, provider, list);
  if (!next) return;
  const doc = { ...ws, ai: next };
  db.writeDocs('workspaces', [doc], [], null);
  broadcast('workspaces', [doc], []);
  console.log(`[ai] ${wsId}: ${next.notes?.[0]?.text ?? 'jobs moved to another model'}`);
}
/** After a call said the model isn't there: read that provider's list again (at most every five minutes per key). */
const rechecked = new Map<string, number>();
function recheckModels(wsId: string, provider: string) {
  const k = `${wsId}|${provider}`;
  if ((rechecked.get(k) ?? 0) > Date.now() - 5 * 60_000) return;
  rechecked.set(k, Date.now());
  void companyModels(wsId, provider, true).catch(() => {});
}

/**
 * Our AI only while the plan's allowance lasts. At the end of it: an automatic top-up when the company has them on
 * (the existing billing setting), else the company's own keys, else a message saying what to do.
 */
function withinAllowance(ws: any, chain: AIConfig[], userId?: string | null): { chain: AIConfig[]; message?: string } {
  // Unlimited with nothing to run on: a used-up month still says so, rather than "AI isn’t available".
  if (!ws || (!chain.some((c) => c.included) && !(whitelist.on(ws) && !chain.length))) return { chain };
  const g = aiplan.gate(ws, undefined, userId);
  if (g.state === 'ok') return { chain };
  if (g.state === 'topup') {
    const fresh = db.getDoc('workspaces', ws.id) as any;
    const next = { ...fresh, plan: { ...fresh.plan, topUps: (fresh.plan?.topUps ?? 0) + 1 } };
    db.writeDocs('workspaces', [next], [], null);
    broadcast('workspaces', [next], []);
    platform.event('ai.topup', ws.id, null, `automatic, ${next.plan.topUps} this month`);
    const admins = (fresh.members ?? []).filter((m: any) => m.role !== 'member').map((m: any) => m.userId);
    notifyUsers(admins, msg('The AI allowance for this month ran out, so a top-up was added automatically: {price} on the next invoice.', { price: `Rp ${TOP_UP.price.toLocaleString('id-ID')}` }), '/settings/billing', ws.id);
    return { chain };
  }
  const own = chain.filter((c) => !c.included);
  return own.length ? { chain: own } : { chain: [], message: g.message };
}
const NO_AI = mark('AI isn’t set up for this company yet. An admin can add an AI key in Settings, AI, or switch to the AI plan.');
/** After AI ran for a company: its admins hear at 50%, 80% and 100% of a limit (server/aiLimits.ts). */
const aiAlerts = (wsId: string, userId?: string | null) => {
  try {
    whitelist.checkAlerts(db.getDoc('workspaces', wsId), userId); // Unlimited: its monthly limit and the person's share
    aiLimits.checkAlerts(db.getDoc('workspaces', wsId) as any, (id) => spendRp(db.usageSince(id, new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()) as any), (ids, text, url, id) => notifyUsers(ids, text, url, id));
  } catch (e) {
    console.error('[ai alerts]', e instanceof Error ? e.message : e);
  }
};
const OUR_AI_DOWN = mark('AI isn’t available right now. We’ve been told; try again in a few minutes.');

/**
 * A company's plan as the app may save it. Free months, discounts and trials are ours: the app can end a trial (by
 * picking a plan) but never start or stretch one, since a trial runs on our AI. Top-ups: the app may add one at a
 * time, never lower the count or bring back a count the invoice run already reset (a page left open since then).
 */
function planFromApp(next: any, prev: any): { plan: any; why?: string; whyWords?: lang.Said } {
  if (!next) return { plan: prev };
  // Unlimited (the operators' Whitelist) is theirs alone: the app can't set it, end it or change that plan.
  if (prev?.unlimited) return { plan: prev };
  if (next.unlimited) next = { ...next, unlimited: undefined };
  // Cancelling keeps the plan until the end of the period that's paid for; "Keep the plan" undoes it.
  if (next.cancel === true && prev && prev.tier !== 'free') next = { ...next, tier: prev.tier, track: prev.track, cycle: prev.cycle };
  const max = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const trialEnds = !next.trialEnds ? undefined : prev ? prev.trialEnds : String(next.trialEnds) > max ? max : next.trialEnds;
  // A new company's trial is always Studio AI, whatever the app sent.
  if (trialEnds && !prev && trialEnds > new Date().toISOString()) Object.assign(next, { tier: 'studio', track: 'ai' });
  const had = prev?.topUps ?? 0;
  const topUps = (Number(next.topUps) || 0) === had + 1 ? had + 1 : had;
  // Add-ons are whole numbers (they're on the invoice); pausing has its own rules (server/billing.ts).
  const n = (v: unknown) => Math.max(0, Math.min(1000, Math.floor(Number(v) || 0)));
  const addons = { mailboxes: n(next.addons?.mailboxes), storage50: n(next.addons?.storage50), meetHours10: n(next.addons?.meetHours10), branding: !!next.addons?.branding };
  const pause = billing.pauseOnSave(next, prev);
  // A new tier or track is a new choice: a cancellation waiting for the end of the period no longer applies.
  const cancelAt =
    next.cancel === true && prev && prev.tier !== 'free' ? (prev.cancelAt ?? billing.periodEnd(prev)) : next.cancel === false ? undefined : prev?.cancelAt && next.tier === prev.tier && next.track === prev.track ? prev.cancelAt : undefined;
  // How the company pays is ours to record (bank transfer until a card processor exists); the app can't invent a card.
  const { cancel: _c, ...rest } = next;
  // Prorated switches are the server's (billing.adjustmentsOnSave adds a new one): the app can't add, change or drop them.
  return { plan: { ...rest, addons, comp: prev?.comp, discount: prev?.discount, trialEnds, topUps: topUps || undefined, payment: prev?.payment, paused: pause.paused, pauses: pause.pauses, cancelAt, adjustments: prev?.adjustments, trialRefused: next.tier === 'free' ? prev?.trialRefused : undefined }, why: pause.why, whyWords: pause.whyWords };
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
  const landingFile = /^\/(assets\/|favicon|apple-touch-icon|icon-|manifest\.webmanifest|robots\.txt|sw\.js$)/.test(p);
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
  const may = aiLimits.allowed(ws as any);
  for (const p of [languages.length > 1 ? 'sumopod' : null, pick, ...STT]) {
    if (!p || !STT.includes(p) || !may(p)) continue;
    const k = db.loadKey(ws.id, p);
    if (k) return { provider: p, apiKey: k.key, model: p === 'sumopod' ? 'gemini/gemini-3.5-flash' : null, languages, language: languages[0] ?? 'auto' };
  }
  // AI-plan companies without a speech key of their own: ours, as the operators picked (never a provider they blocked).
  const ours = onOurAI(ws) ? aiplan.ourSpeech((p) => may(p, true)) : null;
  return ours ? { ...ours, languages, language: languages[0] ?? 'auto' } : null;
}

function saveMeeting(m: db.Doc) {
  db.writeDocs('meetings', [m], [], null);
  broadcast('meetings', [m], []);
}
const meetLine = (message: string) => ({ message, at: new Date().toISOString() });

/**
 * Saves a meeting (queued) and asks the recorder to send the bot to it, from Meet or by itself from a calendar.
 * Null when it's on its way; otherwise why not (the meeting is then marked failed).
 */
async function dispatchBot(ws: any, doc: any): Promise<string | null> {
  saveMeeting(doc);
  const names = ws.members.map((x: any) => (db.getDoc('users', x.userId) as any)?.name).filter(Boolean);
  // The plan's meeting-bot hours this month: the bot leaves when they run out.
  const hours = billing.meetMinutes(ws);
  const sent = await recorder('/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Video when this kind of meeting keeps video (or might: it's filed after the meeting, and an unneeded video is deleted then).
    body: JSON.stringify({ id: doc.id, url: doc.url, botName: doc.botName, callback: `${PUBLIC_URL}/api/meet/recorder`, stt: sttFor(ws, doc.language), names, announce: ws.meetings?.announce !== false, video: (doc.clientId ? [ws.meetings?.clientMeetings] : [ws.meetings?.clientMeetings, ws.meetings?.internalMeetings]).includes('video'), ...(hours.left !== Infinity ? { maxMinutes: Math.floor(hours.left) } : {}) }),
  }).then(async (r) => (r.ok ? null : ((await r.json().catch(() => ({}))) as any).error ?? `Recorder said ${r.status}`), () => 'The recorder didn’t answer');
  if (sent) saveMeeting({ ...doc, status: 'failed', error: sent, log: [...(doc.log ?? []), meetLine(`Couldn’t send the bot: ${sent}`)] });
  return sent;
}

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
  // Settings, AI, Automatic jobs: "Meeting notes after each meeting" switched off means none are written by themselves.
  if (!again && ws.ai?.auto?.meetingNotes === false) return noNotes('Automatic meeting notes are off (Settings, AI), so only the transcript is kept. “Regenerate notes” writes them now');
  const route = withinAllowance(ws, aiFor(ws.id, 'meeting'));
  if (!route.chain.length) return noNotes(route.message ? 'The AI allowance for this month is used up, so only the transcript is kept' : onOurAI(ws) ? 'AI wasn’t available, so only the transcript is kept' : 'No AI is set up for meeting notes, so only the transcript is kept');
  try {
    const clients = (db.allDocs('clients') as any[]).filter((c) => c.workspaceId === ws.id && c.status !== 'ended');
    const members = ws.members.map((x: any) => String((db.getDoc('users', x.userId) as any)?.name ?? '').split(' ')[0]).filter(Boolean);
    const notes = await aiplan.runChain(
      route.chain,
      (cfg, inTokens, outTokens) => db.logUsage({ workspaceId: ws.id, userId: m.createdBy ?? '', job: 'meeting', provider: cfg.included ? 'included' : cfg.provider, via: cfg.provider, model: cfg.model, inTokens, outTokens }),
      () => ai.meetingNotes({ title: m.title, transcript: m.transcript, clientNames: clients.map((c) => c.name), members }),
    );
    aiAlerts(ws.id);
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
/** The company whose own address this request came to (its clients' door), if any: a live address, or <slug>.localhost to try it. */
function brandedHost(req: IncomingMessage): any {
  const host = hostOf(req);
  if (host.endsWith('.localhost')) return (db.allDocs('workspaces') as any[]).find((x) => x.whiteLabel?.enabled && x.whiteLabel.slug && `${x.whiteLabel.slug}.localhost` === host);
  return isOurHost(host) ? undefined : customDomains.liveAt(host);
}
const hostOf = (req: IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
/** Addresses that open the app itself: its own, the marketing site's, the mail name, local ones and APP_HOSTS. */
const OUR_HOSTS = new Set(
  [PUBLIC_URL, SITE_URL]
    .filter(Boolean)
    .map((u) => new URL(u).hostname.toLowerCase())
    .concat(SITE_DOMAIN ? [`www.${SITE_DOMAIN}`] : [], mailer.MAIL_HOST, (process.env.APP_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)),
);
const isOurHost = (host: string) => OUR_HOSTS.has(host) || host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1';
/**
 * Requests to an address that's neither ours nor a live agency address get a plain page, never the app. Only when the
 * app knows its own address (PUBLIC_URL); /api/health answers everywhere (the certificate check uses it).
 */
function strangerHost(req: IncomingMessage, res: ServerResponse, p: string) {
  if (!process.env.PUBLIC_URL || p === '/api/health') return false;
  const host = hostOf(req);
  if (!host || isOurHost(host) || customDomains.liveAt(host)) return false;
  const pending = customDomains.pendingAt(host);
  res.statusCode = pending ? 503 : 404;
  res.setHeader('cache-control', 'no-store');
  if (pending) res.setHeader('retry-after', '120');
  if (p.startsWith('/api/')) return (res.setHeader('content-type', 'application/json'), res.end(JSON.stringify(lang.localize(res, { error: mark('This address isn’t set up.') }))), true);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(req.method === 'HEAD' ? undefined : customDomains.notSetUpPage(pending));
  return true;
}
/** A company's own address and its state are the server's: a save from the app keeps what the server has. */
function ownAddress(next: any, before: any) {
  if (!next && !before?.domain) return next;
  const { domain, domainStatus, domainCheck } = before ?? {};
  return { ...(next ?? before), domain, domainStatus, domainCheck };
}
function serveStatic(req: IncomingMessage, res: ServerResponse, site = false) {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  // The marketing site has no service worker. One left from when the app lived at this address removes itself.
  if (site && path === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
    return res.end("self.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));\n");
  }
  const branded = brandedHost(req);
  // At a company's own address: its name on the install prompt and home-screen icon, never ours.
  if (path === '/manifest.webmanifest' && branded) {
    const wl = branded.whiteLabel;
    const icon = wl.logo ?? branded.logo;
    res.setHeader('content-type', 'application/manifest+json');
    return res.end(JSON.stringify({ name: wl.name, short_name: wl.name.slice(0, 12), id: '/', start_url: '/?source=app', scope: '/', display: 'standalone', background_color: '#f5f6f8', theme_color: wl.color ?? branded.color, share_target: { action: '/notes/new', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } }, icons: icon ? [{ src: '/brand-icon', sizes: '512x512', type: String(icon).slice(5, String(icon).indexOf(';')) || 'image/png', purpose: 'any' }] : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }));
  }
  // Ours, in Indonesian for a browser that asks for it (a manifest is fetched without cookies: Accept-Language only).
  if (path === '/manifest.webmanifest' && !site && lang.browserLang(req.headers['accept-language']) === 'id' && existsSync(join(DIST, 'manifest.webmanifest'))) {
    const m = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
    const words = lang.inLang('id', () => ({ description: t('Mail, chat, tasks, calendar, files, meetings and passwords for your team in one app.'), names: { Mail: t('Mail'), Chat: t('Chat'), Tasks: t('Tasks'), Calendar: t('Calendar') } as Record<string, string> }));
    res.setHeader('content-type', 'application/manifest+json');
    res.setHeader('vary', 'accept-language');
    return res.end(JSON.stringify({ ...m, lang: 'id', description: words.description, shortcuts: (m.shortcuts ?? []).map((s: any) => ({ ...s, name: words.names[s.name] ?? s.name })) }));
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
    const source = visitSource(req);
    if (path === '/' && req.method === 'GET') platform.countView('/', source);
    // Shared with the app's address (app.sprint2go.com) so sign-ups there know where the visit came from.
    if (source !== 'direct' && !cookie(req, 's2g_src')) res.setHeader('set-cookie', `s2g_src=${source}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax${SITE_DOMAIN ? `; Domain=${SITE_DOMAIN}` : ''}`);
  }
  else if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(DIST, 'index.html'); // single-page app
    // "Try it without signing up" (/try): the demo in the browser, with nothing saved here. Only the page view counts.
    if (/^\/try\/?$/.test(path) && req.method === 'GET' && !branded) platform.countView('/try', visitSource(req));
  }
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
/** Where a visit came from: ?utm_source= or ?ref=, else the site that linked here, else "direct". */
function visitSource(req: IncomingMessage) {
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const ref = String(req.headers.referer ?? '');
  let refHost = '';
  try {
    refHost = ref ? new URL(ref).hostname.replace(/^www\./, '') : '';
  } catch {
    /* not a URL */
  }
  const own = String(req.headers.host ?? '').split(':')[0];
  return (q.get('utm_source') || q.get('ref') || (refHost && refHost !== own ? refHost : '') || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 60) || 'direct';
}

/**
 * What usage rows cost in rupiah on the company's own keys, at the price list and dollar rate operators keep
 * (operator console, AI, Prices). Our AI ('included') counts as 0 here: the plan's allowance covers it.
 */
function spendRp(rows: { provider: string; model: string; inTokens: number; outTokens: number }[]) {
  return aiplan.costRp(rows.filter((r) => r.provider !== 'included'));
}

/**
 * Every change to the documents passes here, from the app (/api/sync) and from the AI apps people connect
 * (server/mcp.ts), so both follow one set of rules: who may see and change what, read-only companies, what Members
 * may do, and the demo company. `conn`: the window that sent it (it gets back what was stored differently);
 * `operator`: an operator signed in as `me` from the backend.
 */
function applySync(me: string, incoming: any, from: { conn?: string; operator?: string | null } = {}): { status: number; body: { saved?: number; why?: string; error?: string }; whyWords?: lang.Said } {
  const pset = platform.settings();
  const session = from.operator ? { operator: from.operator } : null;
  const opRecord = session ? null : platform.operator((personOf(me) as any)?.email);
  if (pset.maintenance.on && !opRecord) return { status: 503, body: { error: pset.maintenance.message || mark('Changes are paused for a few minutes while sprint2go is updated.') } };
  const coll = incoming?.coll;
  if (!COLLS.includes(coll)) return { status: 400, body: { error: mark('Unknown collection') } };
  // Their own demo company first (server/sandbox.ts): what belongs in it is saved there and goes to their other
  // windows only. The rest carries on as a real change. Nothing of the demo ever reaches the real documents.
  const conn0 = from.conn ?? '';
  const sbSender = clients.get(conn0)?.userId === me ? conn0 : undefined;
  let sbSaved = 0;
  let sbWhy: lang.Words | undefined;
  const allUpserts = (Array.isArray(incoming.upserts) ? incoming.upserts : []) as db.Doc[];
  const allDeletes = (Array.isArray(incoming.deletes) ? incoming.deletes : []).filter((x: unknown) => typeof x === 'string') as string[];
  const inDemo = (d: db.Doc) => !!d && typeof d.id === 'string' && (isSandboxId(d.id) || !!sandbox.info(me)) && sandbox.belongs(me, coll, d, !!db.getDoc(coll, d.id));
  const demoUps = allUpserts.filter(inDemo);
  const demoDels = allDeletes.filter((id) => !!sandbox.getDoc(me, coll, id));
  if (demoUps.length || demoDels.length) {
    if (demoOpen(me)) {
      const r = sandbox.write(me, coll, demoUps, demoDels);
      sbSaved = r.saved.length;
      sbWhy = r.why;
      broadcastSandbox(me, coll, r.saved, r.deleted, sbSender);
      // What wasn't kept goes back to this window as it's stored.
      const back = r.refused.map((id) => sandbox.getDoc(me, coll, id)).filter(Boolean) as db.Doc[];
      const gone = r.refused.filter((id) => !sandbox.getDoc(me, coll, id));
      if (sbSender && (back.length || gone.length)) clients.get(sbSender)?.res.write(`event: change\ndata: ${JSON.stringify({ coll, upserts: back, deletes: gone })}\n\n`);
    } else sbWhy = mark('The demo company is closed, so that wasn’t kept.');
  }
  const upserts = allUpserts.filter((d) => !demoUps.includes(d));
  const deletes = allDeletes.filter((id) => !demoDels.includes(id));
  if (!upserts.length && !deletes.length) return { status: 200, body: { saved: sbSaved, ...(sbWhy ? { why: lang.saved(sbWhy).text } : {}) }, whyWords: sbWhy ? lang.saved(sbWhy) : undefined };
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
  // Your own settings and status, whoever you are (someone with only a demo company has no company to write into).
  const ownRecord = (d: db.Doc) => (coll === 'prefs' || coll === 'statuses') && d.id === me;
  // Client changes (in a company where they're a client): only their own kinds, merged into what's stored.
  const ok = (upserts as db.Doc[])
    // Ids that start like a demo company's are the demo's own (src/sandbox.ts): never made as real documents.
    .filter((d) => d && typeof d.id === 'string' && !(isSandboxId(d.id) && !db.getDoc(coll, d.id)))
    .map((d) => ownProfile(d) ?? (ownRecord(d) || asTeam(d) ? d : (portals.map((pt) => clientWrite(pt, coll, d)).find(Boolean) ?? null)))
    .filter(Boolean)
    // Files on a task's comments: only your own uploads on the comments you add (server/taskFiles.ts).
    .map((d) => (coll === 'todos' && d ? taskFiles.keepCommentFiles(db.getDoc('todos', d.id) as any, d as any, me, db.fileInfo) : d))
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
    // Who's a guest is changed by admins, the project's lead, or Members allowed to invite guests ("Invite guests"),
    // whether on the project or in one of its channels: being listed is what opens the portal.
    if ((coll === 'clients' || coll === 'channels') && before && !p.inviteGuests) {
      const project = db.getDoc('clients', String(coll === 'clients' ? before.id : before.clientId ?? '')) as any;
      const leads = !!project && (project.ownerId === me || (project.members ?? []).some((m: any) => m.userId === me && m.role === 'lead'));
      const key = coll === 'clients' ? 'people' : 'guests';
      if (!leads && JSON.stringify((d as any)[key] ?? []) !== JSON.stringify(before[key] ?? [])) {
        say(mark('Only admins and the project’s Lead can change who its guests are here.'));
        return { ...d, [key]: before[key] } as db.Doc;
      }
    }
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
      // Rows and new choices yes; the columns themselves, the views everyone sees (their filters and sorts too: each
      // person's own are kept in their prefs), the row page's layout, row templates, automations and sharing stay as
      // they were.
      const fields = (before.fields ?? []).map((bf: any) => {
        const nf = ((d as any).fields ?? []).find((x: any) => x.id === bf.id);
        return nf && nf.type === bf.type ? { ...bf, options: nf.options ?? bf.options } : bf;
      });
      return { ...d, fields, views: before.views, page: before.page, templates: before.templates, rules: before.rules, intake: before.intake, signingSecret: before.signingSecret, share: before.share } as db.Doc;
    }
    return d;
  };
  const mayDelete = (before: any) => {
    // Someone else's chat message: its author, admins, or members allowed to delete things.
    if (coll === 'messages' && before && before.userId !== me) {
      const chan = db.getDoc('channels', String(before.channelId)) as any;
      return !!chan && (isAdminOf(me, chan.workspaceId) || permsOf(chan.workspaceId).deleteThings);
    }
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
  // Sign-in rules that changed (owners only), for the company's security log and the people they affect.
  const securityChanges: { wsId: string; text: string; required: boolean }[] = [];
  // Companies that just switched on deleting old chat messages (their admins get the week's notice).
  const retentionStarted: { wsId: string; from: string; period: retention.Period }[] = [];
  // Why something wasn't saved (or was saved differently), for the app to say.
  const why: lang.Words[] = [];
  const said = (w: lang.Words) => (typeof w === 'string' ? w : w.text);
  const say = (w: lang.Words | undefined | null) => void (w && said(w) && !why.some((x) => said(x) === said(w)) && why.push(w));
  /** The company of a document, as stored (or as sent, for a new one). */
  const wsOfDoc = (d: any, before: any) => (coll === 'workspaces' ? d.id : (d.workspaceId ?? before?.workspaceId ?? (coll === 'messages' ? (db.getDoc('channels', String(d.channelId ?? before?.channelId)) as any)?.workspaceId : undefined)));
  /** The rules every write passes: nothing moves between companies, settings are the admins', authors are real. */
  const guard = (d: db.Doc): db.Doc | null => {
    const before = db.getDoc(coll, d.id) as any;
    // A suspended or paused company is read-only for everyone in it (its guests too). A paused plan can still be
    // resumed (or changed) by an owner: the plan is all that changes.
    const wsId = wsOfDoc(d, before);
    const wsDoc = wsId ? (db.getDoc('workspaces', wsId) as any) : null;
    const ro = billing.readOnlyWords(wsDoc);
    if (ro) {
      const owner = (wsDoc?.members ?? []).some((m: any) => m.userId === me && m.role === 'owner');
      if (coll === 'workspaces' && before && !wsDoc.suspended && owner && JSON.stringify((d as any).plan) !== JSON.stringify(before.plan)) {
        const p = planFromApp((d as any).plan, before.plan);
        say(p.whyWords ?? p.why);
        return { ...before, plan: p.plan } as db.Doc;
      }
      say(ro);
      return null;
    }
    if (before && 'workspaceId' in before && d.workspaceId !== before.workspaceId) return null;
    // Outside calendars, calendar links and public holidays have their own rules.
    const cal = feeds.checkWrite(coll, d, me, DEMO);
    if (cal !== 'pass') return cal;
    if (coll === 'workspaces') {
      if (before) {
        if (!isAdminOf(me, d.id)) return null; // only admins change a company's settings and people
        // What the server and operators own stays as the server has it: readiness, credits, suspension, discounts,
        // the routing checks' results (the admins only switch the daily check on or off), the company's own address
        // with its state (changed through /api/white-label/domain only), the mail aliases (set through the server)
        // and WhatsApp (connected through the server: its number decides whose messages arrive here).
        const own = { mailReady: before.mailReady, mailCredits: before.mailCredits, mailCreditsNotified: before.mailCreditsNotified, suspended: before.suspended, createdAt: before.createdAt, mailAliases: before.mailAliases, whatsapp: before.whatsapp, bimi: before.bimi, ...(DEMO ? {} : { mailRouting: serverRouting((d as any).mailRouting, before.mailRouting) }) };
        // Boosted sending only where this server has it.
        if ((d as any).mailRoute === 'boosted' && before.mailRoute !== 'boosted' && !mailer.boostedAvailable()) (d as any).mailRoute = before.mailRoute;
        // Out of office belongs to each mailbox's people and is set through the server (/api/mail/away).
        if (Array.isArray((d as any).accounts)) (d as any).accounts = (d as any).accounts.map((a: any) => ({ ...a, away: (before.accounts ?? []).find((b: any) => b.id === a.id)?.away }));
        const owner = (before.members ?? []).some((m: any) => m.userId === me && m.role === 'owner');
        // The plan and billing are the owners' (the billing page says so); admins' saves keep it as it was.
        const asked = planFromApp((d as any).plan, before.plan);
        const planChanged = JSON.stringify((d as any).plan ?? null) !== JSON.stringify(before.plan ?? null);
        if (!owner && planChanged) say(mark('Only owners can change the plan and billing.'));
        // A switch of tier or track is prorated (server/billing.ts); a company without a plan keeps having none.
        const plan = owner ? (asked.plan ? { ...asked.plan, adjustments: billing.adjustmentsOnSave(before, before.plan, asked.plan) } : asked.plan) : before.plan;
        if (owner) say(asked.whyWords ?? asked.why);
        // An operator looking at the app as someone can't change the company's sign-in rules.
        const sec = session?.operator ? { security: before.security, changed: null } : twostep.securityOnSave(before.security, (d as any).security, owner, twostep.isOn(me));
        if (sec.changed) securityChanges.push({ wsId: d.id, text: sec.changed, required: !!sec.security?.twoStep && !before.security?.twoStep });
        // Task stages: only a list the app can work with (known kinds, at least one open and one done stage). A list
        // that isn't keeps what was there; an empty one means the usual stages.
        const askedStages = (d as any).taskStages;
        const clean = askedStages === undefined ? undefined : cleanStages(askedStages);
        const taskStages = clean === DEFAULT_STAGES ? (Array.isArray(askedStages) && askedStages.length ? before.taskStages : undefined) : clean;
        // Deleting old chat messages: the period is the admins'; when it starts (after a week's notice) is the server's.
        const chat = retention.chatOnSave((d as any).chat, before.chat);
        if (chat.started) retentionStarted.push({ wsId: d.id, ...chat.started });
        // Hosted mailboxes only as many as the plan has room for.
        const boxes = billing.mailboxesOnSave({ ...(d as any), plan }, before);
        say(boxes.whyWords ?? boxes.why);
        // The company's time zone: one the clock knows, else it stays as it was.
        const timeZone = isZone((d as any).timeZone) ? (d as any).timeZone : before.timeZone;
        return { ...d, ...own, timeZone, accounts: boxes.accounts, plan, taskStages, chat: chat.chat, whiteLabel: ownAddress((d as any).whiteLabel, before.whiteLabel), security: sec.security } as db.Doc;
      }
      const { mailReady: _r, mailCredits: _c, mailCreditsNotified: _n, suspended: _s, whatsapp: _wa, mailAliases: _al, bimi: _bimi, ...fresh } = d as any;
      if (!isZone(fresh.timeZone)) delete fresh.timeZone; // the creator's browser said one the clock doesn't know
      // One free trial per person and per company domain, as for /api/workspace.
      const trial = billing.trialOnCreate(planFromApp(fresh.plan, undefined).plan, { id: me, email: String(person.email ?? '') }, { id: String(fresh.id), name: String(fresh.name ?? ''), domains: fresh.domains });
      if (trial.why) say(fresh.name ? msg('{company} starts on Free. {why}', { company: fresh.name, why: lang.part(trial.whyWords ?? trial.why) }) : msg('The new company starts on Free. {why}', { why: lang.part(trial.whyWords ?? trial.why) }));
      const plan = trial.plan;
      if (!DEMO) fresh.mailRouting = serverRouting(fresh.mailRouting, undefined);
      const chat = retention.chatOnSave(fresh.chat, undefined);
      if (chat.started) retentionStarted.push({ wsId: d.id, ...chat.started });
      if (fresh.mailRoute === 'boosted' && !mailer.boostedAvailable()) fresh.mailRoute = 'own';
      const made = { ...fresh, plan, chat: chat.chat, whiteLabel: ownAddress(fresh.whiteLabel, undefined), security: twostep.securityOnSave(undefined, fresh.security, true, twostep.isOn(me)).security, createdAt: new Date().toISOString(), members: [{ userId: me, role: 'owner' }, ...((d.members ?? []) as any[]).filter((m) => m.userId !== me)] }; // whoever makes a company owns it
      return { ...made, accounts: billing.mailboxesOnSave(made, undefined).accounts } as db.Doc;
    }
    // A notice goes to someone in that company (or one of its guests), and only links inside the app.
    if (coll === 'notices' && !before) {
      const to = String((d as any).userId ?? '');
      const inWs = (wsDoc?.members ?? []).some((m: any) => m.userId === to);
      const guestOfWs = to.startsWith('email:') && (db.allDocs('clients') as any[]).some((c) => c.workspaceId === wsId && clientPeople(c, db.allDocs('channels') as any).some((x) => x.email.toLowerCase() === to.slice(6)));
      if (!inWs && !guestOfWs) return null;
      const url = (d as any).url;
      if (url !== undefined && !(typeof url === 'string' && url.startsWith('/') && !url.startsWith('//'))) return { ...d, url: undefined } as db.Doc;
    }
    // Someone else's chat message: reactions, votes, pins and the task made from it, never what it says.
    if (coll === 'messages' && before && before.userId !== me) {
      const { reactions, poll, pinned, taskId, alsoInChannel } = d as any;
      const votes = poll && before.poll ? { ...before.poll, options: before.poll.options.map((o: any, i: number) => ({ ...o, votes: Array.isArray(poll.options?.[i]?.votes) ? poll.options[i].votes : o.votes })) } : before.poll;
      return { ...before, reactions, poll: votes, pinned, taskId, alsoInChannel } as db.Doc;
    }
    if (coll === 'users') {
      if (d.id === me) return d; // own profile: already shaped
      if (before) return null; // nobody edits someone else's record
      if (!admin && mine.size) return null; // new people come in through invites, which admins send
      const { clientOf: _c, vaultKey: _v, ...rest } = d as any;
      return rest as db.Doc;
    }
    // A project's or team's own task stages: only a list the app can work with, set by those who run it (admins, the
    // project's owner or leads, the team's lead). Anyone else's save keeps what was there.
    if ((coll === 'clients' || coll === 'teams') && JSON.stringify((d as any).taskStages ?? null) !== JSON.stringify(before?.taskStages ?? null)) {
      const runs = isAdminOf(me, wsId) || (coll === 'clients' ? (before?.ownerId ?? (d as any).ownerId) === me || ((before ?? d) as any).members?.some((m: any) => m.userId === me && m.role === 'lead') : (before?.leadId ?? (d as any).leadId) === me);
      const asked = (d as any).taskStages;
      const clean = Array.isArray(asked) && asked.length ? cleanStages(asked) : null;
      const taskStages = !runs ? before?.taskStages : asked == null || (Array.isArray(asked) && !asked.length) ? undefined : clean && clean !== DEFAULT_STAGES ? clean : before?.taskStages;
      if (!runs) say(coll === 'clients' ? mark('Only admins and the project’s owner can change its stages.') : mark('Only admins and the team’s lead can change its stages.'));
      d = { ...d, taskStages } as db.Doc;
    }
    // Threads: opens and clicks, the Message-ID and the delivery state are the server's (readTracking.ts, mailer.ts);
    // comments, who handles it and snoozes follow the team mail rules (mailTeam.ts).
    if (coll === 'threads') {
      const acct = (db.allDocs('workspaces') as any[]).flatMap((w) => w.accounts ?? []).find((a: any) => a.id === (d as any).accountId);
      return mailTeam.guardTeamMail(readTracking.guardThread(mailer.guardDelivery(d, before), before, DEMO), before, me, acct, now);
    }
    // A channel's scheduled summaries and the server's last run stay, whatever an older copy in someone's app says.
    if (coll === 'channels' && before) return summaries.keepSummaries(d, before) as db.Doc;
    // Your own message: a send time only while it hasn't gone out (Send later, server/chatLater.ts).
    if (coll === 'messages' && before && before.userId === me) return chatLater.guardOwnMessage(d, before);
    // A reminder that went off stays done, whatever an older copy of your settings says.
    if (coll === 'prefs' && before) return chatLater.keepReminded(d, before);
    // Notes: view-only ones stay as their owner left them; sharing and Recently deleted follow who may (notesTrash.ts).
    if (coll === 'notes' && before) {
      const r = notesTrash.guardNote(d, before, me, mayDelete(before));
      say(r.why);
      return r.doc;
    }
    // Events: what went out to guests, their answers and the last reminder are the server's (calendarInvites.ts).
    if (coll === 'events' && before) return calendarInvites.guardEvent(d, before) as db.Doc;
    if (before) return d;
    // New things carry who made them.
    if (coll === 'todos') return { ...d, createdBy: me, ...(d.createdAt ? {} : { createdAt: now }) } as db.Doc;
    // Your own message; a guest's message is theirs when it carries their own email (checked by clientWrite too).
    if (coll === 'messages') return d.userId === me ? chatLater.guardOwnMessage(d, null) : d.userId === 'guest' && String((d as any).guestEmail ?? '').toLowerCase() === String(person.email ?? '').toLowerCase() ? d : null;
    if (coll === 'notes') return { ...d, ownerId: me } as db.Doc;
    if (coll === 'channels' && d.kind === 'channel' && !d.teamId && limited(d.workspaceId) && (db.getDoc('workspaces', String(d.workspaceId)) as any)?.chat?.whoCanCreate === 'admins') return null; // only admins start channels here
    if (coll === 'rows' || coll === 'tables' || coll === 'quotes' || coll === 'meetings') return { ...d, createdBy: me } as db.Doc;
    if (coll === 'drive') return { ...d, uploadedBy: (d as any).uploadedBy ?? me } as db.Doc;
    if (coll === 'events') return calendarInvites.guardEvent({ ...d, createdBy: (d as any).createdBy ?? me }, undefined) as db.Doc;
    return d;
  };
  for (let i = ok.length - 1; i >= 0; i--) {
    const d = ownProfile(ok[i]!) ? ok[i]! : mayWrite(ok[i]!);
    const g = d && (ownProfile(d) ? d : guard(d));
    if (g) ok[i] = g;
    else ok.splice(i, 1);
  }
  const dels = mine.size || ((coll === 'prefs' || coll === 'statuses') && (deletes as string[]).includes(me))
    ? (deletes as string[]).filter((id) => {
        const before = db.getDoc(coll, id) as any;
        if (!before) return true;
        if ((coll === 'prefs' || coll === 'statuses') && id === me) return true; // your own
        // Nothing in a read-only company is deleted either.
        const ro = billing.readOnlyWords(db.getDoc('workspaces', String(wsOfDoc(before, before) ?? '')));
        if (ro) return (say(ro), false);
        return see(coll, before) && mayDelete(before) && feeds.mayDelete(coll, before, me);
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
      ok[i] = { ...d, log: before.log, ruleRuns: before.ruleRuns, templateRuns: before.templateRuns, turns: before.turns, intake: d.intake ? { ...d.intake, sample: before.intake?.sample, testAt: before.intake?.testAt, listening, mapping: { ...(before.intake?.mapping ?? {}), ...(d.intake.mapping ?? {}) } } : d.intake } as db.Doc;
    }
  const leavers = coll === 'workspaces' ? leftCompany(ok) : [];
  // Public holidays switched on, off or to another country.
  const holidaysChanged = coll === 'workspaces' ? (ok as any[]).filter((d) => (db.getDoc('workspaces', d.id) as any)?.holidays?.country !== d.holidays?.country).map((d) => d.id) : [];
  // Email settings changed: check what really works again.
  const emailChanged =
    coll === 'workspaces'
      ? (ok as any[]).filter((d) => {
          const b = db.getDoc('workspaces', d.id) as any;
          const pick = (w: any) => JSON.stringify([w?.emailSetup, w?.domains, w?.mailRoute, w?.mailRouting, (w?.accounts ?? []).map((a: any) => [a.id, a.email, a.provider]), w?.plan?.tier, w?.plan?.addons?.mailboxes, w?.plan?.trialEnds]);
          return !b || pick(b) !== pick(d);
        }).map((d) => d.id)
      : [];
  // The branding add-on or the brand switch changed: the company's own address may go live (or pause) now.
  const addressChanged =
    coll === 'workspaces'
      ? (ok as any[]).filter((d) => {
          const b = db.getDoc('workspaces', d.id) as any;
          return b?.whiteLabel?.domain && (hasBranding(b.plan) !== hasBranding(d.plan) || !!b.whiteLabel.enabled !== !!d.whiteLabel?.enabled);
        }).map((d) => d.id)
      : [];
  db.writeDocs(coll, ok, dels, me);
  for (const id of emailChanged) soonReadiness(id);
  for (const id of addressChanged) customDomains.soon(id);
  for (const id of holidaysChanged) void feeds.syncHolidays(id).catch((e) => console.error('[holidays]', e instanceof Error ? e.message : e));
  for (const c of securityChanges) {
    platform.event('security.rules', c.wsId, me, c.text);
    if (c.required) tellTwoStepRequired(c.wsId, me);
  }
  if (leavers.length) endGuestAccess(leavers);
  for (const r of retentionStarted) {
    const w = db.getDoc('workspaces', r.wsId) as any;
    if (w) broadcast('workspaces', [w], []); // the admin who switched it on sees when it starts too
    if (w) tell((w.members ?? []).filter((m: any) => m.role !== 'member').map((m: any) => m.userId), w.id, 'team', retention.noticeWords(w.name, r.period, r.from, companyTz(w)), { app: 'settings', id: 'apps' });
    db.audit(String(person.email ?? me), 'chat.retention.on', r.wsId, `messages older than ${retention.periodWords(r.period)}, deleting from ${r.from.slice(0, 10)}`);
  }
  // Guests don't live in the app all day: a notice for them also goes out as an email (when this server can send).
  if (coll === 'notices' && mailer.systemMailPath() !== 'log')
    for (const n of ok as any[]) {
      if (!String(n.userId).startsWith('email:') || n.read) continue;
      const to = String(n.userId).slice(6);
      const w = db.getDoc('workspaces', n.workspaceId) as any;
      const brandName = w?.whiteLabel?.enabled ? w.whiteLabel.name : w?.name ?? 'sprint2go';
      const origin = customDomains.isLive(w) ? `https://${w.whiteLabel.domain}` : PUBLIC_URL;
      const m = guestNoticeMail(n, to, brandName, origin);
      void mailer.sendNote(to, m.subject, m.text, m.html, brandName).catch((e) => console.error('[mail]', e instanceof Error ? e.message : e));
    }
  const conn = from.conn ?? '';
  const sender = clients.get(conn)?.userId === me ? conn : undefined;
  broadcast(coll, ok, dels, sender, delDocs);
  // What the server saved differently from what this window sent goes back to it too, so it shows what's stored.
  if (sender) {
    const sent = new Map((upserts as db.Doc[]).filter((d) => d && typeof d.id === 'string').map((d) => [d.id, d]));
    // Only where something the window sent was stored differently (fields the server merely adds, like who made
    // it, don't need a round trip that could land on top of the next edit).
    const reshaped = ok.filter((d) => {
      const s = sent.get(d.id) as any;
      return !!s && Object.keys(s).some((k) => JSON.stringify(s[k]) !== JSON.stringify((d as any)[k]));
    });
    // Refused: changes go back to what's stored, refused new things go away, refused deletions come back.
    const refused = [...sent.keys()].filter((id) => !ok.some((d) => d.id === id));
    const kept = [...refused, ...(deletes as string[]).filter((id) => !dels.includes(id))].map((id) => db.getDoc(coll, id)).filter(Boolean) as db.Doc[];
    const see2 = lens(me);
    const back = [...reshaped, ...kept].map((d) => see2(coll, d)).filter(Boolean);
    const gone = refused.filter((id) => !db.getDoc(coll, id));
    if (back.length || gone.length) clients.get(sender)?.res.write(`event: change\ndata: ${JSON.stringify({ coll, upserts: back, deletes: gone })}\n\n`);
  }
  if (rowsBefore) tablesEngine.afterRowWrite(tablesEnv, rowsBefore as any, ok as any, me);
  feeds.afterSync(coll, ok, delDocs);
  // Invites to guests of events that send them: new ones, updates, cancellations (server/calendarInvites.ts).
  if (coll === 'events' && (ok.length || delDocs.length)) void calendarInvites.afterEventWrite(ok as any[], delDocs as any[], me);
  // A deleted meeting takes its recording with it.
  if (RECORDER_URL) for (const id of botAudio) recorder(`/recordings/${id}`, { method: 'DELETE' }).catch(() => {});
  if (sbWhy) say(sbWhy);
  // `why` in English for AI apps and mail apps; the app gets `whyWords` in the language its screen speaks (/api/sync).
  const whyWords = why.length ? lang.sentences(why) : undefined;
  return { status: 200, body: { saved: ok.length + sbSaved, ...(whyWords ? { why: whyWords.text } : {}) }, whyWords };
}

// AI apps people connect (server/connector.ts): they see through the same lens and save through the same rules.
connector.init({
  lens: teamLens,
  write: (userId, coll, upserts, deletes = []) => applySync(userId, { coll, upserts, deletes }),
  memberOf: (userId) => memberOf(userId) as any,
  demoOpen,
  event: (type, wsId, userId, detail) => platform.event(type, wsId, userId, detail),
  // The address AI apps use: PUBLIC_URL when it's set (https://app.sprint2go.com), else the one this request came to.
  origin: (req) => (process.env.PUBLIC_URL || !/^[\w.:[\]-]+$/.test(String(req.headers.host ?? '')) ? PUBLIC_URL : `http://${req.headers.host}`),
  ip: ipOf,
  tooMany,
});

/* ---------- routes ---------- */

createServer(async (req, res) => {
  lang.answering(req, res); // errors go back in the language the asker's screen speaks
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  // Headers on everything: no framing by other sites, no content sniffing, scripts and styles only from here.
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob: data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss: https:; frame-ancestors 'none'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'");
  if (secureCookies()) res.setHeader('strict-transport-security', 'max-age=15552000; includeSubDomains');
  if (siteRedirect(req, res, p)) return;
  if (strangerHost(req, res, p)) return;
  // Read tracking's picture and links in mail people sent (server/readTracking.ts): public, rate limited, and they
  // answer the same whatever happened.
  if (p.startsWith('/t/') && readTracking.serveTracking(req, res, url, ipOf(req), tooMany(`track:${ipOf(req)}`, 600, 60_000))) return;
  // Connected AI apps: /mcp and the sign-in addresses they expect (OAuth and /.well-known). /oauth/authorize is a page.
  if ((p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/oauth-') || p === '/.well-known/openid-configuration') && (await connector.handlePublic(req, res, url))) return;
  // Thunderbird's autoconfig for mail apps (server/mailApps.ts).
  if (mailApps.handlePublic(req, res, url)) return;
  // A company's BIMI logo (server/bimi.ts): public, at the same address for as long as it has one, never anything else.
  const bimiLogo = p.match(/^\/bimi\/([\w-]{1,64})\.svg$/);
  if (bimiLogo && (req.method === 'GET' || req.method === 'HEAD')) {
    const w = db.getDoc('workspaces', bimiLogo[1]) as any;
    const f = w?.bimi?.fileId ? db.fileInfo(w.bimi.fileId) : null;
    const data = f && f.workspaceId === w.id ? db.fileData(f.id) : null;
    if (!data) return (res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }), res.end('No logo here.'));
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'access-control-allow-origin': '*' });
    return res.end(req.method === 'HEAD' ? undefined : data);
  }
  if (!p.startsWith('/api/')) return serveStatic(req, res, !!SITE_HOST && String(req.headers.host ?? '').toLowerCase() === SITE_HOST);
  if (p === '/api/health') return json(res, 200, { ok: true, at: new Date().toISOString(), build: BUILD });
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
    if (!ok) return json(res, 403, { error: mark('Requests must come from the app.') });
  }
  try {
    // Sign in / out
    // WhatsApp (Meta Cloud API) webhook: Meta checks it once with the company's verify token, then posts every
    // incoming message, signed with the Meta app's secret. Unsigned or wrongly signed posts are never read
    // (server/whatsapp.ts); without a secret the webhook is off.
    if (p === '/api/whatsapp/webhook' && req.method === 'GET') {
      const c = whatsapp.challenge(url.searchParams, workspaces() as any);
      return c.status === 200 ? (res.writeHead(200, { 'content-type': 'text/plain' }), res.end(c.body)) : json(res, c.status, {});
    }
    if (p === '/api/whatsapp/webhook' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 3_000_000) return json(res, 413, {});
        chunks.push(chunk as Buffer);
      }
      const r = whatsapp.receive(Buffer.concat(chunks), String(req.headers['x-hub-signature-256'] ?? '') || undefined, workspaces() as any, broadcast);
      return json(res, r.status, {});
    }

    // White label: whose brand to show at this address (an agency's subdomain, or <slug>.localhost to try it locally).
    if (p === '/api/brand') {
      const w = brandedHost(req);
      return json(res, 200, { ...(w ? { name: w.whiteLabel.name, logo: w.whiteLabel.logo ?? w.logo, color: w.whiteLabel.color ?? w.color } : {}), mailHost: mailer.MAIL_HOST, mailIp: mailer.MAIL_IP || undefined, boosted: mailer.boostedAvailable() });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const { email, password } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      if (tooMany(`login:${ipOf(req)}`, 30, 15 * 60_000) || tooMany(`login:${mail}`, 10, 15 * 60_000)) return json(res, 429, { error: mark('Too many attempts. Wait a few minutes and try again.') });
      const login = mail && db.findLogin(mail);
      const good = login && typeof password === 'string' ? await db.checkPassword(password, login.pw_hash) : (await db.burnPasswordTime(String(password ?? '')), false);
      if (!good || !login) return json(res, 401, { error: mark('Wrong email or password.') });
      if ((db.getDoc('users', login.user_id) as any)?.suspended) return json(res, 403, { error: mark('This account is suspended. Contact support.') });
      const t = db.newSession(login.user_id);
      setSession(res, t);
      // Two-step sign-in: the session waits for its code (15 minutes), or for setting it up when a company requires it.
      // A device this person asked to remember (a signed token in its cookie, not forgotten, under 30 days) skips the code.
      let g = twostep.gate(login.user_id, t, null, workspaces() as any);
      if (g?.need === 'code') {
        const device = twostep.trustedDevice(cookie(req, twostep.DEVICE_COOKIE), login.user_id);
        if (device) {
          twostep.markPassed(t);
          twostep.deviceUsed(device.id);
          g = null;
        } else twostep.markWaiting(t);
      }
      return json(res, 200, { me: login.user_id, ...(g ? { twoStep: g.need, companies: g.need === 'setup' ? g.companies : undefined } : {}) });
    }
    // Sign-up: name, email and password, then a 6-digit code sent to the email. Until real email is wired up, the code
    // is printed in the server log and (outside production) shown on screen so the flow can be tried.
    if (p === '/api/signup' && req.method === 'POST') {
      const { name, email, password } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      if (String(name ?? '').trim().length < 2) return json(res, 400, { error: mark('Tell us your name.') });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return json(res, 400, { error: mark('That email doesn’t look right.') });
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: mark('Use at least 8 characters for the password.') });
      if (db.findLogin(mail)) return json(res, 409, { error: mark('There’s already an account with this email. Sign in instead.') });
      if (tooMany(`signup:${ipOf(req)}`, 10, 60 * 60_000)) return json(res, 429, { error: mark('Too many sign-ups from here. Try again later.') });
      const code = newCode();
      signups.set(mail, { name: String(name).trim().slice(0, 80), hash: await db.hashPassword(password), code, tries: 0, until: Date.now() + 15 * 60_000 });
      const sent = await sendCode(mail, 'signup', code, lang.requestLang(req));
      platform.event('signup.started', null, null, cookie(req, 's2g_src') || 'direct');
      return json(res, 200, { ok: true, sent, ...(process.env.NODE_ENV === 'production' || sent ? {} : { devCode: code }) });
    }
    if (p === '/api/signup/verify' && req.method === 'POST') {
      const { email, code } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      const s = signups.get(mail);
      if (!s || s.until < Date.now()) return json(res, 410, { error: mark('That code has expired. Start again.') });
      if (++s.tries > 5) return (signups.delete(mail), json(res, 429, { error: mark('Too many tries. Start again.') }));
      if (String(code ?? '').replace(/\D/g, '') !== s.code) return json(res, 400, { error: mark('That code isn’t right.') });
      if (db.findLogin(mail)) return json(res, 409, { error: mark('There’s already an account with this email. Sign in instead.') });
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
        push.forgetSession(t); // this device stops getting their notifications
        for (const [id, c] of clients) if (c.token === t) (c.res.end(), clients.delete(id));
      }
      setSession(res, null);
      return json(res, 200, {});
    }

    // Accepting an invite: the new person sets a password and is signed in.
    if (p === '/api/invite/check' && req.method === 'POST') {
      const inv = db.peekInvite(String((await body(req)).token ?? ''));
      return inv ? json(res, 200, { email: inv.email }) : json(res, 404, { error: mark('This invite link has expired or was already used.') });
    }
    if (p === '/api/invite/accept' && req.method === 'POST') {
      const { token, password } = await body(req);
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: mark('Use at least 8 characters.') });
      const inv = db.claimInvite(String(token ?? ''));
      if (!inv) return json(res, 404, { error: mark('This invite link has expired or was already used.') });
      // Never overwrite an existing sign-in (old links made before this check, or a colleague's invite to someone who already has an account).
      if (db.hasLogin(inv.user_id)) return json(res, 409, { error: mark('This account already has a password. Sign in instead.') });
      await db.setLogin(inv.user_id, inv.email, password);
      platform.event('invite.accepted', null, inv.user_id);
      setSession(res, db.newSession(inv.user_id));
      return json(res, 200, { me: inv.user_id });
    }

    // Forgot the password: a code by email, then a new password. Every session of that account ends.
    if (p === '/api/reset' && req.method === 'POST') {
      const mail = String((await body(req)).email ?? '').trim().toLowerCase();
      if (tooMany(`reset:${ipOf(req)}`, 10, 60 * 60_000)) return json(res, 429, { error: mark('Too many attempts. Try again later.') });
      const login = mail && db.findLogin(mail);
      // The answer is the same whether the email is known or not.
      if (login) {
        const code = newCode();
        codes.set(`reset:${mail}`, { code, tries: 0, until: Date.now() + 15 * 60_000 });
        const sent = await sendCode(mail, 'reset', code, lang.requestLang(req));
        return json(res, 200, { ok: true, ...(process.env.NODE_ENV === 'production' || sent ? {} : { devCode: code }) });
      }
      await db.burnPasswordTime('x');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/reset/verify' && req.method === 'POST') {
      const { email, code, password, twoStep } = await body(req);
      const mail = String(email ?? '').trim().toLowerCase();
      const c = codes.get(`reset:${mail}`);
      if (!c || c.until < Date.now()) return json(res, 410, { error: mark('That code has expired. Ask for a new one.') });
      if (++c.tries > 5) return (codes.delete(`reset:${mail}`), json(res, 429, { error: mark('Too many tries. Ask for a new code.') }));
      if (String(code ?? '').replace(/\D/g, '') !== c.code) return json(res, 400, { error: mark('That code isn’t right.') });
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: mark('Use at least 8 characters.') });
      const login = db.findLogin(mail);
      if (!login) return json(res, 404, { error: mark('No account with this email.') });
      // An email code alone doesn't get past two-step sign-in: the code from the app (or a backup code) comes first.
      const second = twostep.resetNeedsCode(login.user_id, twoStep);
      if (second) return json(res, second.status, second.body);
      codes.delete(`reset:${mail}`);
      await db.setLogin(login.user_id, mail, password);
      db.endSessions(login.user_id);
      connector.endAll(login.user_id, 'password reset'); // connected AI apps too: they connect again with the new password
      mailApps.endAll(login.user_id); // and mail apps' app passwords
      twostep.forgetDevices(login.user_id); // a new password: every remembered device asks for the code again
      const t = db.newSession(login.user_id);
      if (twostep.isOn(login.user_id)) twostep.markPassed(t);
      setSession(res, t);
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
        if (raw.length > 1_000_000) return json(res, 413, { error: mark('Too large') });
      }
      const type = String(req.headers['content-type'] ?? '');
      let payload: unknown;
      try {
        payload = type.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : raw ? JSON.parse(raw) : {};
      } catch {
        return json(res, 400, { error: mark('Send JSON or form data') });
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
    if (!me) return json(res, 401, { error: mark('Sign in first.') });
    if (db.touch(me)) {
      platform.activeDay(me);
      platform.noteSession(token!, String(req.headers['user-agent'] ?? ''), ipOf(req));
    }
    const meDoc = personOf(me) as any;
    // A suspended person can still see that they're suspended; nothing else.
    if (meDoc?.suspended) return p === '/api/me' ? json(res, 200, { me, suspended: meDoc.suspended }) : json(res, 403, { error: mark('This account is suspended.') });
    // Two-step sign-in still to do (a code, or setting it up): only that, and signing out.
    const gate = twostep.gate(me, token, session?.operator ?? null, workspaces() as any);
    if (gate) {
      if (p === '/api/me') return json(res, 200, { me, twoStep: gate.need, email: meDoc?.email, companies: gate.need === 'setup' ? gate.companies : undefined });
      if (!twostep.allowedWhileGated(gate, p, req.method ?? 'GET'))
        return json(res, gate.need === 'code' ? 401 : 403, { error: gate.need === 'code' ? 'Enter the code from your authenticator app first.' : 'Set up two-step sign-in first. Your company requires it.', twoStep: gate.need });
    }
    // An operator signed in as someone: every change they make is in the audit log, under the operator's own name.
    if (session?.operator && req.method !== 'GET' && p !== '/api/presence' && p !== '/api/client-error') db.audit(session.operator, 'person.signin-as.change', me, `${req.method} ${p}`);
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
        demo: sandbox.stateOf(me, demoAllowed(me)), // their own demo company: not made yet, open, or hidden
      });
    /* ---------- their own demo company (server/sandbox.ts) ---------- */
    // Open: made from the demo data the first time (in their time zone), shown again when it was hidden.
    if ((p === '/api/sandbox' || p === '/api/sandbox/reset') && req.method === 'POST') {
      if (!demoAllowed(me)) return json(res, 403, { error: mark('Your company switched the demo company off.') });
      if (session?.operator) return json(res, 403, { error: mark('That’s theirs to open: you’re signed in as them.') });
      if (tooMany(`sandbox:${me}`, 20, 60 * 60_000)) return json(res, 429, { error: mark('That’s a lot of demo companies in an hour. Try again later.') });
      const { tz } = await body(req);
      const row = sandbox.info(me);
      if (p === '/api/sandbox/reset' && !row) return json(res, 404, { error: mark('There’s no demo company to reset.') });
      if (!row || p === '/api/sandbox/reset') await sandbox.make(me, { name: String(meDoc?.name ?? '') }, typeof tz === 'string' ? tz : undefined);
      else if (row.hidden) sandbox.setHidden(me, false);
      reloadWindows(me, String(req.headers['x-conn'] ?? ''));
      return json(res, 200, { demo: sandbox.stateOf(me, true), workspaceId: sandboxWsId(me) });
    }
    if (p === '/api/sandbox/hide' && req.method === 'POST') {
      if (!sandbox.info(me)) return json(res, 404, { error: mark('There’s no demo company.') });
      sandbox.setHidden(me, true);
      reloadWindows(me, String(req.headers['x-conn'] ?? ''));
      return json(res, 200, { demo: sandbox.stateOf(me, demoAllowed(me)) });
    }
    // They're looking at it: it isn't "unused" (the cleanup takes demo companies nobody opened for a month).
    if (p === '/api/sandbox/seen' && req.method === 'POST') {
      if (demoOpen(me)) sandbox.touch(me);
      return json(res, 200, {});
    }
    // Back from "sign in as": the operator's own session again (still past their 2FA).
    if (p === '/api/admin/signin-as/stop' && req.method === 'POST') {
      if (!session?.operator) return json(res, 400, { error: mark('Not signed in as someone.') });
      const op = (db.allDocs('users') as any[]).find((u) => String(u.email ?? '').toLowerCase() === session.operator);
      db.endSession(token!);
      const t = op ? db.newSession(op.id) : null;
      if (t) (platform.markSessionVerified(t), twostep.markPassed(t)); // past both their own and the console's second step
      setSession(res, t);
      db.audit(session.operator, 'person.signin-as.stop', me);
      return json(res, 200, { ok: true });
    }
    // Two-step sign-in: each person's own (/api/2fa…), and what company admins see and do (/api/security…).
    if (p.startsWith('/api/2fa') || p.startsWith('/api/security')) {
      const handled = await twostep.handle(p, {
        req,
        res,
        url,
        me,
        token: token!,
        json,
        body,
        workspaces: workspaces as any,
        issuer: brandNameAt(req),
        deviceCookie: cookie(req, twostep.DEVICE_COOKIE),
        setDeviceCookie: (v) => setDeviceCookie(res, v),
        kick,
        operator: session?.operator ?? null,
        event: (type, wsId, userId, detail) => platform.event(type, wsId, userId, detail),
        eventsOf: (wsId) => platform.eventsOf(wsId, 300),
        notify: notifyUsers,
        mail: (to, subject, lines) => mailer.sendNote(to, subject, lines.join('\n\n'), simpleHtml(brandNameAt(req), lines), brandNameAt(req)),
      });
      if (handled) return;
    }
    if (p.startsWith('/api/admin/')) {
      if (!opRecord) return json(res, 403, { error: mark('Operators only.') });
      const handled = await admin.handleAdmin(p, {
        req,
        res,
        url,
        me,
        token: token!,
        // The console's answers: every msg() in them (labels deep in lists too) in the operator's console language.
        json: (r, status, data) => json(r, status, lang.localizeAll(opRecord.lang ?? lang.requestLang(req), data)),
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
      return handled ? undefined : json(res, 404, { error: mark('No such admin route.') });
    }
    // Connecting an AI app (the consent screen at /oauth/authorize) and each person's connected apps (Settings, Account).
    if (p.startsWith('/api/oauth/') && (await connector.handleApi(p, { req, res, url, me, operator: session?.operator ?? null, json, body }))) return;
    // Phone mail apps: app passwords, setup help, the Apple profile (Settings, Phone mail apps).
    if (p.startsWith('/api/mailapps') && (await mailApps.handleApi(p, { req, res, url, me, operator: session?.operator ?? null, json, body, tooMany }))) return;

    /* ---------- help and support, for everyone signed in ---------- */
    if (p === '/api/support' && req.method === 'GET') {
      const list = support.ticketsOfUser(me, String(meDoc?.email ?? ''));
      return json(res, 200, { tickets: list.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, updatedAt: t.updatedAt, createdAt: t.createdAt, unread: t.unreadForCustomer, rating: t.rating })), supportEmail: mailer.SUPPORT_EMAIL });
    }
    if (p === '/api/support' && req.method === 'POST') {
      if (tooMany(`support:${me}`, 10, 60 * 60_000)) return json(res, 429, { error: mark('That’s a lot of tickets in an hour. Reply on an open one, or write to ') + mailer.SUPPORT_EMAIL + '.' });
      const b = await body(req);
      const subject = String(b.subject ?? '').trim();
      const text = String(b.body ?? '').trim();
      if (!subject || !text) return json(res, 400, { error: mark('Tell us what it’s about and what happened.') });
      const ws = (memberOf(me).find((w: any) => w.id === b.workspaceId) ?? memberOf(me)[0]) as any;
      const paying = ws ? ['paying', 'unlimited'].includes(admin.mrrOf(ws, ws.members.length).state) : false; // Unlimited gets paying customers' support
      const attachments = ticketFiles(b.attachments, me);
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
        context: b.context && typeof b.context === 'object' ? { ...b.context, plan: ws?.plan ? (ws.plan.unlimited ? 'unlimited' : `${ws.plan.tier} ${ws.plan.track}`) : 'none', company: ws?.name ?? null } : undefined,
        attachments,
      });
      supportNotify(t, msg('New ticket #{number} from {name}: {subject}', { number: t.number, name: meDoc?.name ?? meDoc?.email ?? '', subject: t.subject.slice(0, 70) }));
      return json(res, 200, { id: t.id, number: t.number });
    }
    const supportReq = p.match(/^\/api\/support\/([\w-]+)(?:\/(reply|rate|seen))?$/);
    if (supportReq) {
      const t = support.ticket(supportReq[1]);
      const mine = t && (t.requester.userId === me || t.requester.email === String(meDoc?.email ?? '').toLowerCase());
      if (!t || !mine) return json(res, 404, { error: mark('No such ticket.') });
      if (!supportReq[2] && req.method === 'GET') {
        support.markSeenByCustomer(t.id);
        return json(res, 200, { ticket: { id: t.id, number: t.number, subject: t.subject, status: t.status, createdAt: t.createdAt, rating: t.rating }, messages: support.messagesOf(t.id, false).map((m) => ({ ...m, author: m.kind === 'operator' ? undefined : m.author })) });
      }
      if (supportReq[2] === 'reply' && req.method === 'POST') {
        const b = await body(req);
        const text = String(b.body ?? '').trim();
        if (!text) return json(res, 400, { error: mark('Write something first.') });
        const attachments = ticketFiles(b.attachments, me);
        support.addMessage(t.id, { kind: 'customer', author: String(meDoc?.email ?? '').toLowerCase(), authorName: meDoc?.name ?? null, body: text, internal: false, attachments });
        support.customerReplied(t.id);
        supportNotify(t, meDoc?.name ? msg('{name} replied on #{number}: {text}', { name: meDoc.name, number: t.number, text: text.slice(0, 70) }) : msg('A customer replied on #{number}: {text}', { number: t.number, text: text.slice(0, 70) }), true);
        return json(res, 200, { ok: true });
      }
      if (supportReq[2] === 'rate' && req.method === 'POST') {
        const b = await body(req);
        if (!['good', 'okay', 'bad'].includes(b.rating)) return json(res, 400, { error: mark('Pick one.') });
        support.rate(t.id, b.rating, b.note);
        if (b.rating === 'bad') supportNotify(t, b.note ? msg('#{number} was rated bad: {note}', { number: t.number, note: String(b.note).slice(0, 80) }) : msg('#{number} was rated bad', { number: t.number }), true);
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
        return a.audience === 'paying' ? states.includes('paying') || states.includes('unlimited') : states.includes('trial');
      });
      return json(res, 200, { announcements: list.map((a) => ({ id: a.id, text: a.text, link: a.link, kind: a.kind })) });
    }
    // A company's invoices and discount codes (owners and admins, or members allowed to see billing).
    if (p === '/api/billing/invoices' && req.method === 'GET') {
      const ws = memberOf(me).find((w: any) => w.id === url.searchParams.get('ws')) as any;
      if (!ws || !(isAdminOf(me, ws.id) || ws.permissions?.seeBilling)) return json(res, 403, { error: mark('Not allowed.') });
      // How to pay: only what's real. Bank transfer to the account in the operators' settings (none set: nothing to show),
      // and how many days after the due date an unpaid invoice makes the company read-only (0: never by itself).
      const s = platform.settings();
      const pay = { bank: s.billing.bank || null, payee: s.billing.name || null, graceDays: s.autoSuspendDays };
      // Who this month's invoice bills so far: the people on the team who signed in or used sprint2go this month.
      const active = billing.activePeople(ws);
      return json(res, 200, { pay, active: { people: active.active, team: active.team }, invoices: platform.invoices(ws.id).filter((i) => i.status !== 'draft').map((i) => ({ id: i.id, number: i.number, period: i.period, total: i.total, status: i.status, dueAt: i.dueAt, paidAt: i.paidAt, overdue: i.status === 'sent' && i.dueAt < new Date().toISOString(), credits: billing.isCreditInvoice(i.id) || undefined })) });
    }
    // Unlimited (the operators' Whitelist, server/whitelist.ts): its two monthly limits, what's used, and each person's
    // rules. Everyone on the team who may see billing reads it; owners and admins set the rules.
    if (p === '/api/unlimited' && req.method === 'GET') {
      const ws = memberOf(me).find((w: any) => w.id === url.searchParams.get('ws')) as any;
      if (!ws || !whitelist.on(ws)) return json(res, 404, { error: mark('This company isn’t on Unlimited.') });
      const manage = isAdminOf(me, ws.id);
      const room = storageRoom(ws.id);
      const v = whitelist.view(ws, room);
      if (!v) return json(res, 404, { error: mark('This company isn’t on Unlimited.') });
      // Members who may see billing see the company's limits; each person's rules are for owners and admins (and their own).
      return json(res, 200, { ...v, canManage: manage, rate: aiplan.config().rate, people: manage || ws.permissions?.seeBilling ? v.people : v.people.filter((x: any) => x.userId === me) });
    }
    if (p === '/api/unlimited/rules' && req.method === 'POST') {
      const b = await body(req);
      const ws = memberOf(me).find((w: any) => w.id === b.workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only owners and admins can set people’s rules.') });
      if (!whitelist.on(ws)) return json(res, 404, { error: mark('This company isn’t on Unlimited.') });
      const r = whitelist.saveRules(ws, b.rules, me, storageRoom(ws.id).total);
      if (!r.ok) return json(res, 400, { error: r.error });
      platform.event('unlimited.rules', ws.id, me, `${whitelist.rules(ws.id).length} people with rules`);
      return json(res, 200, { ok: true, ...whitelist.view(ws, storageRoom(ws.id)) });
    }
    if (p === '/api/billing/invoice' && req.method === 'GET') {
      const inv = platform.invoice(url.searchParams.get('id') ?? '');
      const ws = inv && (memberOf(me).find((w: any) => w.id === inv.workspaceId) as any);
      if (!inv || inv.status === 'draft' || !ws || !(isAdminOf(me, ws.id) || ws.permissions?.seeBilling)) return json(res, 404, { error: mark('No such invoice.') });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
      return res.end(admin.invoiceHtml(inv, ws.name, lang.requestLang(req)));
    }
    if (p === '/api/billing/coupon' && req.method === 'POST') {
      const b = await body(req);
      const ws = memberOf(me).find((w: any) => w.id === b.workspaceId) as any;
      // Billing is the owners' (the billing page says so).
      if (!ws || !ws.members.some((m: any) => m.userId === me && m.role === 'owner')) return json(res, 403, { error: mark('Only owners can add a code.') });
      if (tooMany(`coupon:${ws.id}`, 10, 60 * 60_000)) return json(res, 429, { error: mark('Too many tries. Try again later.') });
      if (!ws.plan) return json(res, 400, { error: mark('Pick a plan first.') });
      if (whitelist.on(ws)) return json(res, 409, { error: mark('Unlimited is never billed, so there’s nothing for a code to take off.') });
      if (ws.plan.discount || (ws.plan.comp?.note ?? '').startsWith('Code ')) return json(res, 409, { error: mark('This company already has a code.') });
      const ok = platform.couponUsable(String(b.code ?? ''));
      if (!ok.ok) return json(res, 400, { error: ok.error });
      const next = { ...ws, plan: admin.applyCoupon(ws.plan, ok.coupon) };
      db.writeDocs('workspaces', [next], [], me);
      broadcast('workspaces', [next], []);
      platform.useCoupon(ok.coupon.code);
      platform.event('coupon.used', ws.id, me, ok.coupon.code);
      return json(res, 200, { ok: true, coupon: { code: ok.coupon.code, kind: ok.coupon.kind, value: ok.coupon.value, months: ok.coupon.months } });
    }
    if (p === '/api/state') {
      // ?only=threads,workspaces: what Mail's refresh needs, without everything else.
      const only = (url.searchParams.get('only') ?? '').split(',').filter((k) => COLLS.includes(k as CollectionKey));
      const state = visibleState(me);
      return json(res, 200, only.length ? Object.fromEntries(only.map((k) => [k, state[k]])) : state);
    }

    /* ---------- the mail engine: a company's domain, records, route and sending ---------- */
    const monthStart = () => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    };
    if (p === '/api/mail/setup' && req.method === 'GET') {
      const saved = memberOf(me).find((w) => w.id === url.searchParams.get('ws')) as any;
      if (!saved) return json(res, 403, { error: mark('Not in this company.') });
      // The records follow what the screen shows: a choice made a moment ago may not be saved yet.
      const setupQ = url.searchParams.get('setup') ?? '';
      const providerQ = url.searchParams.get('provider') ?? '';
      const ws = { ...saved, ...(['keep', 'mix', 'hosted', 'none'].includes(setupQ) ? { emailSetup: setupQ } : {}), ...(['google', 'microsoft', 'zoho', 'imap'].includes(providerQ) ? { emailProvider: providerQ } : {}) };
      const domain = mailer.mailDomainOf(ws);
      const ownDomain = domain !== mailer.MAIL_HOST;
      const [records, health, dns] = await Promise.all([mailer.expectedRecords(ws), mailer.serverHealth(), ownDomain ? mailer.dnsHostOf(domain) : Promise.resolve({ dnsHost: null, nameservers: [] as string[] })]);
      // Whose domain it is (and the record that proves it), and for operators only the mail server's certificate.
      const ownership = ownDomain ? domainOwnership(ws, domain) : null;
      const cert = opRecord ? certState(mailer.MAIL_HOST) : undefined;
      // Boosted credits: what's waiting for payment, and why they can't be bought here (if so).
      const credits = { orders: billing.openOrders(saved.id), blocked: billing.creditsBlocked(mailer.boostedAvailable(), saved), bank: platform.settings().billing.bank || null };
      // Unlimited: Boosted sending has a monthly limit instead of credits.
      const wl = whitelist.on(saved) ? whitelist.entry(saved.id) : null;
      const unlimited = wl ? { limit: wl.sesLimit, used: whitelist.sesUsed(saved.id), mine: whitelist.featureOn(saved, me, 'boosted') } : null;
      return json(res, 200, { host: mailer.MAIL_HOST, ip: mailer.MAIL_IP, domain, ownDomain, route: ws.mailRoute ?? 'own', boostedAvailable: mailer.boostedAvailable(), credits: ws.mailCredits ?? 0, creditOrders: credits, unlimited, records, checks: ws.mailChecks ?? null, stats: mailer.mailStats(ws.id, monthStart()), health, dnsHost: dns.dnsHost, nameservers: dns.nameservers, ownership, cert });
    }
    if (p === '/api/mail/unsubscribe' && req.method === 'POST') {
      const { threadId } = await body(req);
      const t = db.getDoc('threads', String(threadId ?? '')) as any;
      const acct = t && (memberOf(me) as any[]).flatMap((w) => w.accounts ?? []).find((a: any) => a.id === t.accountId);
      if (!t || !acct || !(acct.users ?? []).includes(me)) return json(res, 403, { error: mark('Not your mailbox.') });
      const m = [...(t.messages ?? [])].reverse().find((x: any) => x.listUnsubscribe?.url);
      if (!m) return json(res, 400, { error: mark('This sender didn’t include an unsubscribe link.') });
      if (!m.listUnsubscribe.oneClick) return json(res, 200, { open: m.listUnsubscribe.url });
      const r = await mailer.oneClickUnsubscribe(String(m.listUnsubscribe.url));
      return r.ok ? json(res, 200, { done: true }) : json(res, 502, { error: r.why, open: r.safe ? m.listUnsubscribe.url : undefined });
    }
    if (p === '/api/mail/ready' && req.method === 'POST') {
      const { workspaceId } = await body(req);
      if (!memberOf(me).some((w) => w.id === workspaceId)) return json(res, 403, { error: mark('Not in this company.') });
      const ready = await mailer.refreshReadiness(String(workspaceId));
      const ws = db.getDoc('workspaces', String(workspaceId)) as any;
      // "Some of each": which hosted mailboxes at the company's domain really got mail, the proof that routing works.
      const arrivals = ws ? mailer.hostedArrivals(ws) : null;
      if (arrivals?.arrived.length) routing.noteRoutingWorks(String(workspaceId));
      return json(res, 200, { ...ready, routing: arrivals });
    }
    // "Some of each": the guide's "Send a test". We send to an address at the company's domain that only we know, and
    // the guide asks how it's doing until it arrives here (or the provider refuses it).
    if (p === '/api/mail/routing-test' && req.method === 'POST') {
      const { workspaceId } = await body(req);
      const ws = memberOf(me).find((w) => w.id === workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can send a routing test.') });
      if (tooMany(`routing-test:${ws.id}`, 10, 60 * 60_000)) return json(res, 429, { error: mark('That’s a lot of tests in an hour. Wait a little and try again.') });
      try {
        return json(res, 200, await routing.sendProbe(ws.id, 'manual'));
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'Could not send the test.' });
      }
    }
    if (p === '/api/mail/routing-test' && req.method === 'GET') {
      const wsId = url.searchParams.get('ws') ?? '';
      if (!memberOf(me).some((w) => w.id === wsId)) return json(res, 403, { error: mark('Not in this company.') });
      const st = routing.probeStatus(wsId, url.searchParams.get('token') ?? '');
      return st ? json(res, 200, st) : json(res, 404, { error: mark('No such test.') });
    }
    // White label: the company's own address for its guests. Setting it (or clearing it with an empty address) starts
    // the DNS check; "check" looks again now. The state lands on the workspace (whiteLabel.domainStatus/domainCheck).
    if ((p === '/api/white-label/domain' || p === '/api/white-label/check') && req.method === 'POST') {
      const b = await body(req);
      const wsId = String(b.workspaceId ?? '');
      const ws = db.getDoc('workspaces', wsId) as any;
      if (!ws || !isAdminOf(me, wsId)) return json(res, 403, { error: mark('Only admins can change the address.') });
      if (billing.readOnlyWords(ws)) return json(res, 403, { error: billing.readOnlyWords(ws) });
      if (tooMany(`domain:${wsId}`, 30, 10 * 60_000)) return json(res, 429, { error: mark('That’s a lot of checks. Wait a few minutes; we also check every hour by ourselves.') });
      if (p === '/api/white-label/check') {
        if (!ws.whiteLabel?.domain) return json(res, 400, { error: mark('Add an address first.') });
        await customDomains.check(wsId);
        return json(res, 200, { whiteLabel: (db.getDoc('workspaces', wsId) as any)?.whiteLabel ?? null });
      }
      const clear = b.domain === null || String(b.domain ?? '').trim() === '';
      if (!clear && !ws.whiteLabel?.enabled) return json(res, 400, { error: mark('Switch on your brand first.') });
      const c = clear ? { host: null } : customDomains.cleanHost(b.domain);
      if ('error' in c) return json(res, 400, { error: c.error });
      const owner = c.host ? customDomains.ownerOf(c.host) : undefined;
      if (owner && owner !== wsId) return json(res, 409, { error: mark('Another company already uses this address. If it’s yours, write to us and we’ll sort it out.') });
      platform.event('company.address', wsId, me, c.host ?? 'removed');
      await customDomains.setAddress(wsId, c.host);
      return json(res, 200, { whiteLabel: (db.getDoc('workspaces', wsId) as any)?.whiteLabel ?? null });
    }
    if (p === '/api/mail/check' && req.method === 'POST') {
      const { workspaceId } = await body(req);
      const ws = memberOf(me).find((w) => w.id === workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can check the records.') });
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
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can change how mail is sent.') });
      if (!['own', 'boosted'].includes(route)) return json(res, 400, { error: mark('Unknown route.') });
      if (route === 'boosted' && !mailer.boostedAvailable()) return json(res, 409, { error: mark('Boosted sending isn’t available on this server yet.') });
      const next = { ...ws, mailRoute: route, mailChecks: undefined };
      db.writeDocs('workspaces', [next], [], me);
      broadcast('workspaces', [next], []);
      soonReadiness(ws.id);
      return json(res, 200, { records: await mailer.expectedRecords(next) });
    }
    // Boosted sending credits: there's no card processor, so buying makes an invoice to pay by bank transfer, and the
    // credits arrive when an operator marks it paid (server/billing.ts). Nothing is added for free.
    if (p === '/api/mail/credits' && req.method === 'POST') {
      const { workspaceId, pack } = await body(req);
      const ws = memberOf(me).find((w) => w.id === workspaceId) as any;
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can buy credits.') });
      const blocked = billing.creditsBlocked(mailer.boostedAvailable(), ws) ?? billing.readOnlyWords(ws);
      if (blocked) return json(res, 409, { error: blocked });
      if (tooMany(`credits:${ws.id}`, 5, 60 * 60_000)) return json(res, 429, { error: mark('That’s a lot of orders in an hour. Pay the invoices that are waiting first.') });
      const r = billing.orderCredits(ws, Number(pack), me);
      if ('error' in r) return json(res, r.status, { error: r.error });
      // The invoice goes to the company's billing emails too (as the monthly ones do), with the bank details on it.
      const billTo = r.invoice.billTo?.emails?.length ? r.invoice.billTo.emails : [String((db.getDoc('users', me) as any)?.email ?? '')].filter((e) => e.includes('@'));
      const payee = platform.settings().billing.name || 'sprint2go';
      if (billTo.length && mailer.systemMailPath() !== 'log')
      {
        // In the company's language (Settings, General), else the billing contact's, else English.
        const l = lang.companyLang(ws.id) ?? lang.langOfEmail(billTo[0] ?? '', ws.id);
        if (billTo.length && mailer.systemMailPath() !== 'log') void mailer.sendSystemMail({ fromName: payee, to: billTo, ...admin.invoiceMail(r.invoice, payee, l, r.credits), attachments: [{ filename: `${r.invoice.number}.html`, content: Buffer.from(admin.invoiceHtml(r.invoice, ws.name, l)), contentType: 'text/html' }] }).catch(() => null);
      }
      // The operators who look after billing hear about it, so they watch for the transfer.
      const ops = platform.operators().filter((o) => !o.disabled && platform.permsOf(o.role).includes('billing')).map((o) => o.email);
      const opIds = (db.allDocs('users') as any[]).filter((u) => ops.includes(String(u.email ?? '').toLowerCase())).map((u) => u.id);
      notifyUsers(opIds, msg('{company} ordered {n} Boosted emails: invoice {number}, {total}. Mark it paid when the transfer arrives.', { company: ws.name, n: r.credits.toLocaleString('id-ID'), number: r.invoice.number, total: `Rp ${r.invoice.total.toLocaleString('id-ID')}` }), `/admin/money/invoices/${r.invoice.id}`);
      return json(res, 200, { invoice: { id: r.invoice.id, number: r.invoice.number, total: r.invoice.total, dueAt: r.invoice.dueAt }, credits: r.credits, bank: platform.settings().billing.bank, orders: billing.openOrders(ws.id) });
    }
    if (p === '/api/mail/send' && req.method === 'POST') {
      const b = await body(req);
      const ws = memberOf(me).find((w) => w.id === b.workspaceId) as any;
      const account = ws?.accounts?.find((a: any) => a.id === b.accountId);
      if (!ws || !account) return json(res, 403, { error: mark('Not your mailbox.') });
      if (account.provider && account.provider !== 'sprint2go') return json(res, 409, { error: mark('This mailbox is not hosted here.') });
      // Only from a mailbox that can really send; a fresh check first, so a record added a minute ago counts.
      if (!ws.mailReady?.mailboxes?.[account.id]?.send) {
        const r = await mailer.refreshReadiness(ws.id);
        const m = r?.mailboxes[account.id];
        if (!m?.send) return json(res, 409, { error: m?.sendWhy && !m.why ? m.sendWhy : m?.sendWhy || m?.why ? msg('Sending isn’t set up for {email} yet. {why}', { email: account.email, why: (m?.sendWhy ?? m?.why) as string }) : msg('Sending isn’t set up for {email} yet.', { email: account.email }) });
      }
      // A mailbox's own people send from it; a shared inbox also its company's admins. Never someone's personal mailbox.
      const users: string[] = Array.isArray(account.users) ? account.users : [];
      if (users.length ? !users.includes(me) && !(account.kind === 'shared' && isAdminOf(me, ws.id)) : account.kind !== 'shared' && !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Not your mailbox.') });
      const ro = billing.readOnlyWords(ws);
      if (ro) return json(res, 403, { error: ro });
      // The message lives in a thread of this mailbox (or a new one, saved a moment later); attachments are this company's files.
      const thread = b.threadId ? (db.getDoc('threads', String(b.threadId)) as any) : null;
      if (thread && thread.accountId !== account.id) return json(res, 403, { error: mark('That conversation is in another mailbox.') });
      const fileOk = (u: string) => {
        const id = u.match(/^\/api\/files\/([a-f0-9]{32})$/)?.[1];
        return id ? db.fileInfo(id)?.workspaceId === ws.id : u.startsWith('data:');
      };
      if ((Array.isArray(b.files) ? b.files : []).some((f: any) => f && typeof f.url === 'string' && !fileOk(f.url))) return json(res, 403, { error: mark('One of the attachments isn’t a file of this company.') });
      const people = (list: unknown) => (Array.isArray(list) ? list : []).filter((x: any) => x && typeof x.email === 'string' && x.email.includes('@')).map((x: any) => ({ name: String(x.name ?? '').slice(0, 120), email: String(x.email).trim().toLowerCase() }));
      try {
        platform.firstEvent('mail.first', ws.id, me);
        const email: mailer.Outgoing = {
          workspaceId: ws.id,
          accountId: account.id,
          threadId: String(b.threadId ?? ''),
          messageId: String(b.messageId ?? ''),
          from: { name: String(account.name || ws.name), email: String(account.email).toLowerCase() },
          to: people(b.to),
          cc: people(b.cc),
          bcc: people(b.bcc),
          subject: String(b.subject ?? '').slice(0, 500),
          text: String(b.text ?? ''),
          html: typeof b.html === 'string' && b.html ? b.html : undefined,
          files: (Array.isArray(b.files) ? b.files : []).filter((f: any) => f && typeof f.url === 'string').map((f: any) => ({ name: String(f.name ?? 'file').slice(0, 200), url: String(f.url) })),
          inReplyTo: typeof b.inReplyTo === 'string' ? b.inReplyTo : undefined,
          references: Array.isArray(b.references) ? b.references.filter((x: unknown) => typeof x === 'string') : undefined,
          // Read tracking for the outside recipients, when the sender asked and the company allows it.
          // "Remind me if no reply" comes with tracking (it's in the same menu): told once, by the server, after that many days.
          tracking: b.track === true ? { opens: b.trackOptions?.opens !== false, clicks: b.trackOptions?.clicks !== false, notify: b.trackOptions?.notify !== false, by: me, remindDays: Number(b.trackOptions?.remindDays) || 0 } : undefined,
        };
        // Undo send (Settings, Mail): the email waits here for the sender's window before anything leaves.
        const undo = Math.min(mailer.MAX_UNDO_SECONDS, Math.max(0, Math.round(Number(b.undoSeconds) || 0)));
        // A local server keeps mail for outside addresses on this computer; the toast says so instead of "sent".
        const kept = mailer.heldLocally(email);
        const note = kept.length ? `Held on this computer: a local sprint2go doesn’t send to ${kept.length === 1 ? kept[0] : 'outside addresses'}` : undefined;
        if (undo) {
          const held = mailer.holdSend(email, { userId: me, releaseAt: Date.now() + undo * 1000 });
          return json(res, 200, { held: true, until: held.until, undoMs: undo * 1000, note });
        }
        return json(res, 200, { ...(await mailer.queueSend(email)), note });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Could not send.' });
      }
    }
    // Undo send: an email still waiting comes back as a draft (a reply leaves its conversation). Nothing has left yet,
    // so nobody gets it. (A scheduled email isn't waiting here until its time; before then it's a draft to change.)
    if (p === '/api/mail/undo' && req.method === 'POST') {
      const { threadId, messageId } = await body(req);
      const tid = String(threadId ?? '');
      const t = db.getDoc('threads', tid) as any;
      const at = new Date().toISOString();
      // Only whoever sent it takes it back (checked with the waiting email itself, even before the thread is saved).
      const taken = mailer.cancelHeld(tid, String(messageId ?? ''), me);
      if (!taken.ok) return json(res, 409, { error: taken.why === 'not-yours' ? 'Only the person who sent it can take it back.' : 'Too late: it already went out.' });
      const rest = (t?.messages ?? []).filter((m: any) => m.id !== messageId);
      if (t) {
        // A new email goes back to Drafts; a reply leaves the conversation (the app puts it back in the reply box).
        const next = rest.length ? { ...t, messages: rest } : { ...t, location: 'drafts', messages: (t.messages ?? []).map((m: any) => ({ ...m, delivery: undefined, date: at })) };
        db.writeDocs('threads', [next], [], me);
        broadcast('threads', [next], []);
      }
      return json(res, 200, { draft: !rest.length, reply: !!rest.length, threadId: tid, email: { to: taken.email.to, cc: taken.email.cc, bcc: taken.email.bcc ?? [], subject: taken.email.subject, text: taken.email.text, html: taken.email.html, files: taken.email.files } });
    }

    /* ---------- mail: calendar invites, out of office, aliases, removing a mailbox ---------- */
    /** A hosted mailbox that can really send, checked afresh when the last check said no; else why not. */
    const sendBlock = async (ws: any, account: any): Promise<string | null> => {
      if (account.provider && account.provider !== 'sprint2go') return `${account.email} stays with ${account.provider === 'microsoft' ? 'Microsoft' : 'Google'}, so mail from it goes out there.`;
      // A local server keeps mail to outside addresses on this computer anyway (mailer.keepsMailLocal): nothing to wait for.
      if (ws.mailReady?.mailboxes?.[account.id]?.send || mailer.keepsMailLocal()) return null;
      const r = await mailer.refreshReadiness(ws.id);
      const m = r?.mailboxes[account.id];
      return m?.send ? null : `Sending isn’t set up for ${account.email} yet. ${m?.sendWhy ?? m?.why ?? ''}`.trim();
    };
    if (p === '/api/mail/invite' && req.method === 'POST') {
      // Yes, Maybe or No to an emailed invite: tells the organiser (an iCalendar REPLY from the mailbox) and puts the
      // event in this person's calendar, or takes it off. For one date of a repeating invite (`scope` one or
      // following, with the date's `occurrence`): the answer is for that date, or that date and the ones after it.
      const { threadId, messageId, answer, scope, occurrence } = await body(req);
      if (!invites.isRsvp(answer)) return json(res, 400, { error: mark('Answer yes, maybe or no.') });
      const t = db.getDoc('threads', String(threadId ?? '')) as any;
      const ws = t && (memberOf(me) as any[]).find((w) => (w.accounts ?? []).some((a: any) => a.id === t.accountId));
      const account = ws?.accounts.find((a: any) => a.id === t.accountId);
      if (!t || !account || !(account.users ?? []).includes(me)) return json(res, 403, { error: mark('Not your mailbox.') });
      if (billing.readOnlyWords(ws)) return json(res, 403, { error: billing.readOnlyWords(ws) });
      const inMail = (t.messages ?? []).find((m: any) => m.id === messageId);
      const inv = inMail?.invite as invites.StoredInvite | undefined;
      if (!inv || (inv.method !== 'REQUEST' && inv.method !== 'PUBLISH')) return json(res, 400, { error: mark('There’s no invite to answer in this email.') });
      // Some dates of a repeating invite: the date as our event writes it (an all-day one floats).
      const only = (scope === 'one' || scope === 'following') && inv.rrule && typeof occurrence === 'string' && !Number.isNaN(Date.parse(occurrence.length === 19 ? `${occurrence}Z` : occurrence)) ? { scope: scope as 'one' | 'following', occurrence: invites.dateOfInvite(inv, occurrence.length === 19 ? `${occurrence.slice(0, 10)}T12:00:00Z` : occurrence) } : null;
      const own = new Set<string>([String(account.email).toLowerCase(), ...(ws.accounts ?? []).map((a: any) => String(a.email).toLowerCase())]);
      const tell = inv.method === 'REQUEST' && !!inv.organizer?.email && !own.has(inv.organizer.email);
      const meName = String((db.getDoc('users', me) as any)?.name ?? account.name ?? '');
      const you = inv.you ?? String(account.email).toLowerCase();
      // A teammate's invite (from a mailbox of this company): no email between us, the answer goes straight onto their event.
      const teammateHears = () => {
        const box = !tell && inv.method === 'REQUEST' && inv.organizer?.email ? (ws.accounts ?? []).find((a: any) => String(a.email).toLowerCase() === inv.organizer!.email) : null;
        if (!box || (box.users ?? []).includes(me)) return false;
        const reply = { ...inv, method: 'REPLY' as const, attendees: [{ name: meName || String(account.name), email: you, status: answer }], recurrenceId: only?.occurrence, ...(only?.scope === 'following' ? { thisAndFuture: true } : { thisAndFuture: undefined }) };
        invites.applyReply(ws, box, reply, broadcast, notifyPeople);
        return true;
      };
      if (tell) {
        const blocked = await sendBlock(ws, account);
        if (blocked) return json(res, 409, { error: msg('Your answer can’t go out yet. {why}', { why: lang.part(blocked) }) });
        if (blocked) return json(res, 409, { error: `Your answer can’t go out yet. ${blocked}` });
        // (who answers: the address of ours that was invited)
        const name = account.kind === 'shared' ? String(account.name || ws.name) : meName || String(account.name);
        const said = answer === 'accepted' ? 'Accepted' : answer === 'tentative' ? 'Tentatively accepted' : 'Declined';
        // Which dates, in words: " on Tue 13 Oct" or " from Tue 13 Oct on".
        const day = only ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: inv.allDay ? 'UTC' : inv.tz && isZone(inv.tz) ? inv.tz : companyTz(ws) }).format(new Date(inv.allDay ? `${only.occurrence.slice(0, 10)}T12:00:00Z` : only.occurrence)) : '';
        const dates = only ? (only.scope === 'one' ? ` on ${day}` : ` from ${day} on`) : '';
        try {
          await mailer.queueSend({
            workspaceId: ws.id,
            accountId: account.id,
            threadId: t.id,
            messageId: 'rsvp-' + randomBytes(6).toString('hex'),
            from: { name, email: String(account.email).toLowerCase() },
            to: [inv.organizer!],
            cc: [],
            subject: `${said}: ${inv.title}${dates}`,
            text: `${name} ${answer === 'accepted' ? 'accepted' : answer === 'tentative' ? 'might come to' : 'declined'} “${inv.title}”${dates}.`,
            files: [],
            inReplyTo: inMail.mid,
            references: inMail.mid ? [inMail.mid] : undefined,
            ical: { method: 'REPLY', content: buildReply(inv, { name, email: you }, answer, Date.now(), only ? { recurrenceId: only.occurrence, following: only.scope === 'following' } : undefined) },
          });
        } catch (e) {
          return json(res, 400, { error: e instanceof Error ? e.message : 'Your answer could not be sent.' });
        }
      }
      const before = invites.eventsOf(inv.uid, ws.id, [me]);
      if (only) {
        // Some dates: the repeating event is on the calendar with this answer for them (the rest keep theirs, or wait
        // for one); a "No" date is off the calendar. The email's own answer stays the one for all of it.
        const cur = (before.find((e) => e.rrule) ?? invites.eventsFor(inv, { userId: me, workspaceId: ws.id, threadId: t.id, mine: [...own] }).docs[0]) as CalEvent;
        const next = answerSeries(cur, only.occurrence, answer, only.scope) as unknown as db.Doc;
        const gone = before.filter((e) => e.id !== next.id);
        db.writeDocs('events', [next], gone.map((e) => e.id), me);
        if (gone.length) broadcast('events', [], gone.map((e) => e.id), undefined, gone);
        broadcast('events', [next], []);
        const heard = teammateHears();
        return json(res, 200, { sent: tell || heard, events: [next.id], firstOnly: false });
      }
      // The answer, on the email (read fresh: the send may have touched the thread).
      const fresh = (db.getDoc('threads', t.id) as any) ?? t;
      const at = new Date().toISOString();
      const nextThread = { ...fresh, messages: fresh.messages.map((m: any) => (m.id === inMail.id ? { ...m, invite: { ...m.invite, answer: { status: answer, at, by: me, sent: tell } } } : m)) };
      db.writeDocs('threads', [nextThread], [], me);
      broadcast('threads', [nextThread], []);
      // This person's calendar: the event (one repeating event for a repeating invite), or none after No.
      const made = answer === 'declined' ? { docs: [] as db.Doc[], firstOnly: false } : invites.eventsFor(inv, { userId: me, workspaceId: ws.id, threadId: t.id, rsvp: answer, mine: [...own] });
      const docs = made.docs.map((d) => {
        const same = before.find((e) => e.rrule && (d as any).rrule) ?? before.find((e) => (e.occurrence ?? e.start) === ((d as any).occurrence ?? d.start));
        return same ? { ...d, id: same.id, ...(same.remind !== undefined ? { remind: same.remind } : {}), calendarId: same.calendarId ?? d.calendarId } : d;
      });
      const keep = new Set(docs.map((d) => d.id));
      const gone = before.filter((e) => !keep.has(e.id));
      db.writeDocs('events', docs, gone.map((e) => e.id), me);
      if (gone.length) broadcast('events', [], gone.map((e) => e.id), undefined, gone);
      if (docs.length) broadcast('events', docs, []);
      const heard = teammateHears();
      return json(res, 200, { sent: tell || heard, events: docs.map((d) => d.id), firstOnly: made.firstOnly });
    }
    if (p === '/api/mail/away' && req.method === 'POST') {
      // Out of office for one mailbox: its people (or an admin) set it; the server keeps it and answers mail with it.
      const { workspaceId, accountId, away } = await body(req);
      const ws = (memberOf(me) as any[]).find((w) => w.id === workspaceId);
      const account = ws?.accounts?.find((a: any) => a.id === accountId);
      if (!ws || !account || (!(account.users ?? []).includes(me) && !isAdminOf(me, ws.id))) return json(res, 403, { error: mark('Not your mailbox.') });
      if (billing.readOnlyWords(ws)) return json(res, 403, { error: billing.readOnlyWords(ws) });
      const a = away && typeof away === 'object' ? away : {};
      const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
      const instant = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
      const next = { on: !!a.on, from: day(a.from), until: day(a.until), fromAt: instant(a.fromAt), untilAt: instant(a.untilAt), subject: String(a.subject ?? '').slice(0, 200), message: String(a.message ?? '').slice(0, 5000) };
      if (next.on && !next.message.trim()) return json(res, 400, { error: mark('Write the message people get back.') });
      if (next.fromAt && next.untilAt && next.untilAt < next.fromAt) return json(res, 400, { error: mark('The last day is before the first.') });
      if (next.on) {
        const blocked = await sendBlock(ws, account);
        if (blocked) return json(res, 409, { error: msg('Out of office can’t answer yet. {why}', { why: lang.part(blocked) }) });
      }
      const prev = account.away ?? {};
      const same = prev.on && next.on && prev.subject === next.subject && prev.message === next.message && prev.fromAt === next.fromAt && prev.untilAt === next.untilAt;
      const saved = { ...next, since: next.on ? (same ? prev.since : new Date().toISOString()) : undefined };
      const latest = db.getDoc('workspaces', ws.id) as any;
      const nextWs = { ...latest, accounts: latest.accounts.map((x: any) => (x.id === account.id ? { ...x, away: saved } : x)) };
      db.writeDocs('workspaces', [nextWs], [], me);
      broadcast('workspaces', [nextWs], []);
      return json(res, 200, { away: saved });
    }
    // BIMI (Settings, Email delivery): the logo, its record and what DNS says. Admins only; the logo is checked here.
    if (p === '/api/mail/bimi') {
      const b = req.method === 'GET' ? { workspaceId: url.searchParams.get('ws') } : await body(req);
      const ws = (memberOf(me) as any[]).find((w) => w.id === b.workspaceId);
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can change the company’s logo in inboxes.') });
      const domain = mailer.mailDomainOf(ws);
      if (domain === mailer.MAIL_HOST) return json(res, 409, { error: mark('A logo in inboxes needs your own mail domain. Add it under General first.') });
      if (req.method === 'GET') return json(res, 200, await bimi.bimiState(ws, domain, PUBLIC_URL));
      const ro = billing.readOnlyWords(ws);
      if (ro) return json(res, 403, { error: ro });
      let next: any;
      if (req.method === 'DELETE') next = { ...ws, bimi: undefined };
      else if (req.method === 'POST') {
        const svg = String(b.svg ?? '');
        const problems = bimi.svgProblems(svg);
        if (problems.length) return json(res, 400, { error: mark('This logo can’t be used for BIMI yet.'), problems });
        const id = randomBytes(16).toString('hex');
        db.saveFile({ id, workspaceId: ws.id, by: me, name: String(b.name ?? 'logo.svg').slice(0, 120), type: 'image/svg+xml', size: Buffer.byteLength(svg) }, Buffer.from(svg));
        next = { ...ws, bimi: { fileId: id, name: String(b.name ?? 'logo.svg').slice(0, 120), at: new Date().toISOString(), by: me } };
      } else return json(res, 405, {});
      db.writeDocs('workspaces', [next], [], me);
      broadcast('workspaces', [next], []);
      platform.event(next.bimi ? 'mail.bimi-logo' : 'mail.bimi-removed', ws.id, me);
      return json(res, 200, await bimi.bimiState(next, domain, PUBLIC_URL));
    }
    if (p === '/api/mail/aliases' && req.method === 'POST') {
      // Extra addresses that deliver into mailboxes here. Checked here: at the company's own domain, not anyone's
      // mailbox already, and pointing at mailboxes hosted here.
      const { workspaceId, aliases } = await body(req);
      const ws = (memberOf(me) as any[]).find((w) => w.id === workspaceId);
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can change addresses.') });
      if (billing.readOnlyWords(ws)) return json(res, 403, { error: billing.readOnlyWords(ws) });
      if (ws.emailSetup !== 'hosted' && ws.emailSetup !== 'mix') return json(res, 409, { error: ws.emailSetup === 'keep' ? 'Your domain’s mail stays with your provider, so extra addresses are made there.' : 'Email is off for this company.' });
      const domains = (ws.domains ?? []).map((d: string) => d.toLowerCase());
      const hosted = new Set((ws.accounts ?? []).filter((a: any) => !a.temp && (!a.provider || a.provider === 'sprint2go')).map((a: any) => a.id));
      const taken = mailer.localAccounts();
      const out: { id: string; address: string; to: string[] }[] = [];
      for (const al of Array.isArray(aliases) ? aliases.slice(0, 200) : []) {
        const address = String(al?.address ?? '').trim().toLowerCase();
        const [local, domain] = address.split('@');
        if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(local ?? '') || !domains.includes(domain ?? '')) return json(res, 400, { error: address ? (domains.length ? msg('{address} isn’t an address at {domains}.', { address, domains: domains.join(' / ') }) : msg('{address} isn’t an address at your domain.', { address })) : domains.length ? msg('That address isn’t an address at {domains}.', { domains: domains.join(' / ') }) : msg('That address isn’t an address at your domain.') });
        const hit = taken.get(address);
        if ((hit && !(hit.alias && hit.ws.id === ws.id)) || out.some((x) => x.address === address)) return json(res, 409, { error: msg('{address} is already in use.', { address }) });
        const to = [...new Set<string>((Array.isArray(al?.to) ? al.to : []).map(String))].filter((id) => hosted.has(id));
        if (!to.length) return json(res, 400, { error: msg('Pick at least one mailbox for {address}.', { address }) });
        out.push({ id: typeof al?.id === 'string' && /^[\w-]{1,40}$/.test(al.id) ? al.id : randomBytes(6).toString('hex'), address, to });
      }
      const latest = db.getDoc('workspaces', ws.id) as any;
      const nextWs = { ...latest, mailAliases: out };
      db.writeDocs('workspaces', [nextWs], [], me);
      broadcast('workspaces', [nextWs], []);
      return json(res, 200, { aliases: out });
    }
    if (p === '/api/mail/mailbox/remove' && req.method === 'POST') {
      // Removing a mailbox: its mail moves to another mailbox or is deleted, its aliases let go of it, and new mail to
      // the address is refused.
      const { workspaceId, accountId, moveTo } = await body(req);
      const ws = (memberOf(me) as any[]).find((w) => w.id === workspaceId);
      if (!ws || !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can remove mailboxes.') });
      if (billing.readOnlyWords(ws)) return json(res, 403, { error: billing.readOnlyWords(ws) });
      const account = (ws.accounts ?? []).find((a: any) => a.id === accountId);
      if (!account) return json(res, 404, { error: mark('No such mailbox.') });
      const target = moveTo ? (ws.accounts ?? []).find((a: any) => a.id === moveTo && a.id !== account.id && !a.temp) : null;
      if (moveTo && !target) return json(res, 400, { error: mark('Pick a mailbox to move the mail to.') });
      const mail = (db.allDocs('threads') as any[]).filter((t) => t.accountId === account.id);
      // Deletions first, while the people on the mailbox can still see them.
      db.writeDocs('threads', [], mail.map((t) => t.id), me);
      broadcast('threads', [], mail.map((t) => t.id), undefined, mail);
      if (target) {
        const moved = mail.map((t) => ({ ...t, accountId: target.id, workspaceId: ws.id, assignee: target.kind === 'shared' ? t.assignee : undefined }));
        db.writeDocs('threads', moved, [], me);
        broadcast('threads', moved, []);
      }
      const latest = db.getDoc('workspaces', ws.id) as any;
      const nextWs = {
        ...latest,
        accounts: latest.accounts.filter((a: any) => a.id !== account.id),
        mailAliases: (latest.mailAliases ?? []).map((al: any) => ({ ...al, to: al.to.filter((id: string) => id !== account.id) })).filter((al: any) => al.to.length),
      };
      db.writeDocs('workspaces', [nextWs], [], me);
      broadcast('workspaces', [nextWs], []);
      soonReadiness(ws.id);
      return json(res, 200, { moved: target ? mail.length : 0, deleted: target ? 0 : mail.length });
    }

    // An operator signed in as someone never changes their password or deletes their account.
    if ((p === '/api/password' || p === '/api/account/delete') && session?.operator) return json(res, 403, { error: mark('That’s theirs to do: you’re signed in as them.') });
    if (p === '/api/password' && req.method === 'POST') {
      const { current, next } = await body(req);
      const u = db.getDoc('users', me) as { email?: string } | undefined;
      const login = u?.email && db.findLogin(u.email);
      if (!login || !(await db.checkPassword(String(current ?? ''), login.pw_hash))) return json(res, 400, { error: mark('Your current password is wrong.') });
      if (typeof next !== 'string' || next.length < 8) return json(res, 400, { error: mark('Use at least 8 characters.') });
      await db.setLogin(me, u.email!, next);
      // Everywhere else signs out, and every remembered device asks for the code again; this device gets a fresh
      // session (still past its second step).
      twostep.forgetDevices(me);
      setDeviceCookie(res, null);
      const passed = twostep.sessionPassed(cookie(req, 's2g'));
      db.endSessions(me);
      connector.endAll(me, 'password changed');
      mailApps.endAll(me);
      for (const [id, c] of clients) if (c.userId === me && c.token !== cookie(req, 's2g')) (c.res.end(), clients.delete(id));
      const fresh = db.newSession(me);
      if (passed) twostep.markPassed(fresh);
      setSession(res, fresh);
      return json(res, 200, {});
    }

    // Deleting the account: the sign-in, sessions and the person's record go; work they did stays with its company.
    if (p === '/api/account/delete' && req.method === 'POST') {
      const { password } = await body(req);
      const u = db.getDoc('users', me) as any;
      const login = u?.email && db.findLogin(String(u.email).toLowerCase());
      if (!login || !(await db.checkPassword(String(password ?? ''), login.pw_hash))) return json(res, 400, { error: mark('Your password is wrong.') });
      const owned = memberOf(me).filter((w) => w.members.some((m) => m.userId === me && m.role === 'owner') && !w.members.some((m) => m.userId !== me && m.role === 'owner'));
      if (owned.length) return json(res, 409, { error: msg('You’re the only owner of {companies}. Make someone else an owner first, in Settings, General.', { companies: owned.map((w: any) => w.name).join(', ') }) });
      const left = memberOf(me).map((w) => ({ ...w, members: w.members.filter((m) => m.userId !== me) }));
      if (left.length) (db.writeDocs('workspaces', left as any, [], me), broadcast('workspaces', left as any, []));
      db.deleteLogin(me);
      twostep.forget(me);
      db.endSessions(me);
      connector.endAll(me, 'account deleted');
      mailApps.endAll(me);
      feeds.forgetPerson(me); // their calendar links (private addresses) and the events read from them
      sandbox.remove(me); // their demo company, with everything in it
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || !String(name ?? '').trim()) return json(res, 400, { error: mark('Name and email, please.') });
      const client = db.getDoc('clients', String(clientId)) as any;
      const w = workspaces().find((x) => x.id === workspaceId) as any;
      if (!client || !w || client.workspaceId !== w.id) return json(res, 404, { error: mark('No such project.') });
      // Settings, Permissions, "Invite guests": a Member needs it, unless they lead this project.
      const leads = client.ownerId === me || (client.members ?? []).some((m: any) => m.userId === me && m.role === 'lead');
      if (memberOf(me).some((x) => x.id === w.id) && !isAdminOf(me, w.id) && !leads && !{ ...DEFAULT_PERMISSIONS, ...(w.permissions ?? {}) }.inviteGuests) return json(res, 403, { error: mark('Only admins and its Lead can invite guests here.') });
      // Only to a project the person can see, and not while the company is read-only.
      if (memberOf(me).some((x) => x.id === w.id) && !teamLens(me)('clients', client)) return json(res, 404, { error: mark('No such project.') });
      const roInvite = billing.readOnlyWords(w);
      if (roInvite) return json(res, 403, { error: roInvite });
      if (!memberOf(me).some((x) => x.id === w.id)) {
        // A client person inviting a colleague.
        const access = accessFor(w, client);
        // Their colleagues (same email domain as theirs, not gmail and the like) or people at the project's domain.
        const domainOf = (e: string) => e.split('@')[1]?.toLowerCase() ?? '';
        const own = domainOf(String(personOf(me)?.email ?? ''));
        const sameDomain = (!!own && !isFreemail(own) && domainOf(mail) === own) || (!!client.domain && domainOf(mail) === String(client.domain).toLowerCase());
        if (!portalsOf(me).some((pt) => pt.clientId === client.id) || access.invites !== 'direct' || !sameDomain) return json(res, 403, { error: mark('This needs the team’s approval.') });
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
      if (!w || typeof w.id !== 'string' || typeof w.name !== 'string' || !w.name.trim()) return json(res, 400, { error: mark('Give the company a name.') });
      if (db.getDoc('workspaces', w.id) || isSandboxId(w.id)) return json(res, 409, { error: mark('That workspace already exists.') });
      const taken = new Set((db.allDocs('users') as any[]).map((u) => String(u.email ?? '').toLowerCase()));
      const people = (invited as any[]).filter((u) => u && typeof u.id === 'string' && !isSandboxId(u.id) && !db.getDoc('users', u.id) && typeof u.email === 'string' && !taken.has(u.email.toLowerCase()));
      const ids = new Set(people.map((u) => u.id));
      const members = [{ userId: me, role: 'owner' }, ...((w.members ?? []) as any[]).filter((m) => ids.has(m.userId) && ['admin', 'member'].includes(m.role))];
      const accounts = ((w.accounts ?? []) as any[]).filter((a) => a && typeof a.email === 'string').map((a) => ({ id: String(a.id ?? randomBytes(6).toString('hex')), email: String(a.email).toLowerCase().slice(0, 200), name: String(a.name ?? '').slice(0, 80), kind: a.kind === 'shared' ? 'shared' : 'personal', connected: false, users: ((a.users ?? []) as any[]).filter((x) => x === me || ids.has(x)), provider: typeof a.provider === 'string' ? a.provider.slice(0, 20) : undefined }));
      const { mailReady: _r, mailCredits: _c, mailCreditsNotified: _n, suspended: _s, whatsapp: _wa, mailAliases: _al, bimi: _bimi, ...wClean } = w as any;
      if (!DEMO) wClean.mailRouting = serverRouting(wClean.mailRouting, undefined);
      if (wClean.mailRoute === 'boosted' && !mailer.boostedAvailable()) wClean.mailRoute = 'own';
      // One free trial per person and per company domain (server/billing.ts): otherwise the company starts on Free.
      const trial = billing.trialOnCreate(planFromApp(wClean.plan, undefined).plan, { id: me, email: String((db.getDoc('users', me) as any)?.email ?? '') }, { id: wClean.id, name: String(w.name).trim(), domains: wClean.domains });
      const draft = { ...wClean, plan: trial.plan, whiteLabel: ownAddress(wClean.whiteLabel, undefined), security: twostep.securityOnSave(undefined, wClean.security, true, twostep.isOn(me)).security, name: String(w.name).trim().slice(0, 80), members, accounts };
      // Hosted mailboxes beyond what the plan has room for aren't made (the trial has room for everyone it starts with).
      const ws = { ...draft, accounts: billing.mailboxesOnSave(draft, undefined).accounts ?? [] };
      const general = { id: 'ch-' + randomBytes(5).toString('hex'), workspaceId: ws.id, kind: 'channel', name: 'general', members: members.map((m) => m.userId), topic: 'Everyone at ' + ws.name };
      db.writeDocs('users', people, [], me);
      (ws as any).createdAt ??= new Date().toISOString();
      db.writeDocs('workspaces', [ws], [], me);
      db.writeDocs('channels', [general], [], me);
      platform.event('company.created', ws.id, me);
      if (trial.why) {
        platform.event('trial.refused', ws.id, me, trial.why.slice(0, 200));
        notifyUsers([me], msg('{company} starts on Free. {why}', { company: ws.name, why: lang.part(trial.whyWords ?? trial.why) }), '/settings/billing', ws.id);
      }
      soonReadiness(ws.id);
      if (people.length) platform.event('team.invited', ws.id, me, `${people.length} at creation`);
      broadcast('users', people, []);
      broadcast('workspaces', [ws], []);
      broadcast('channels', [general], []);
      return json(res, 200, { id: ws.id, ...(trial.why ? { trialRefused: trial.why } : {}) });
    }

    // An admin invites someone: they get a link to set their own password.
    if (p === '/api/invite' && req.method === 'POST') {
      const { userId, email } = await body(req);
      if (!memberOf(me).some((w) => isAdminOf(me, w.id))) return json(res, 403, { error: mark('Only admins can invite people.') });
      if (typeof email !== 'string' || !email.includes('@')) return json(res, 400, { error: mark('Invalid email') });
      const target = String(userId ?? '');
      if (!target) return json(res, 400, { error: 'Who?' });
      if (isSandboxId(target)) return json(res, 403, { error: mark('The people in the demo company are made up: nobody is invited from it.') });
      // An invite sets a password, so it can only be for someone who has never signed in: a new person (not saved yet,
      // their doc may still be on its way) or someone added to a company you run. Never an existing account.
      if (db.hasLogin(target)) return json(res, 409, { error: mark('They already have a sign-in.') });
      const existing = db.getDoc('users', target) as any;
      if (existing && !memberOf(me).some((w) => isAdminOf(me, w.id) && w.members.some((m: any) => m.userId === target))) return json(res, 403, { error: mark('Only their own company can invite them.') });
      // The sign-in goes to their own address, never one the inviter picks for them.
      if (existing?.email && String(existing.email).toLowerCase() !== email.trim().toLowerCase()) return json(res, 400, { error: mark('The invite goes to the address on their profile.') });
      const taken = db.findLogin(email);
      if (taken) return json(res, 409, { error: mark('Someone already uses that email.') });
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
      if (!t || (!team && !guest)) return json(res, 404, { error: mark('No such table.') });
      if (team && !teamLens(me)('tables', t)) return json(res, 404, { error: mark('No such table.') });
      const roT = billing.readOnlyWords(db.getDoc('workspaces', t.workspaceId) as any);
      if (roT) return json(res, 403, { error: roT });
      const f = (t.fields ?? []).find((x: any) => x.id === b.fieldId);
      if (team && f?.button?.who === 'admins' && !isAdminOf(me, t.workspaceId)) return json(res, 403, { error: mark('Only admins can press this button.') });
      const input = guest ? Object.fromEntries(Object.entries(b.input ?? {}).filter(([k]) => (t.share.edit ?? []).includes(k))) : (b.input ?? {});
      const out = await tablesEngine.runButton(tablesEnv, t.id, String(b.rowId ?? ''), String(b.fieldId ?? ''), me, input as any);
      // Guests see that it worked, not where the team's webhooks go or what the steps were.
      return json(res, 200, guest ? { ok: out.ok, results: [{ ok: out.ok, note: out.ok ? 'Done' : 'Didn’t work; the team can see why', ...(out.results.find((x) => x.open) ? { open: out.results.find((x) => x.open)!.open } : {}) }] } : out);
    }
    if (p === '/api/tables/import' && req.method === 'POST') {
      const b = await body(req);
      const t = db.getDoc('tables', String(b.tableId ?? '')) as any;
      if (!t || !memberOf(me).some((w) => w.id === t.workspaceId) || !teamLens(me)('tables', t)) return json(res, 404, { error: mark('No such table.') });
      const roI = billing.readOnlyWords(db.getDoc('workspaces', t.workspaceId) as any);
      if (roI) return json(res, 403, { error: roI });
      const out = tablesEngine.importRows(tablesEnv, t.id, me, b);
      return json(res, out.status, out.body);
    }
    if (p === '/api/tables/test-hook' && req.method === 'POST') {
      const b = await body(req);
      const t = db.getDoc('tables', String(b.tableId ?? '')) as any;
      if (!t || !memberOf(me).some((w) => w.id === t.workspaceId) || !teamLens(me)('tables', t)) return json(res, 404, { error: mark('No such table.') });
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
      // With ?ws=: the company's meeting-bot minutes this month (the plan's hours plus add-ons), for the send dialog.
      const hw = memberOf(me).find((w) => w.id === url.searchParams.get('ws')) as any;
      const m = hw ? billing.meetMinutes(hw) : null;
      return json(res, 200, { recorder: configured, reachable, ...(m ? { minutes: { used: m.used, left: m.left === Infinity ? null : m.left, total: m.allowance === Infinity ? null : m.allowance } } : {}) });
    }
    if (p === '/api/meet/bot' && req.method === 'POST') {
      const { meeting } = await body(req);
      const ws = workspaces().find((w) => w.id === meeting?.workspaceId) as any;
      if (!ws || !memberOf(me).some((w) => w.id === ws.id)) return json(res, 403, { error: mark('Not in this company.') });
      if (ws.meetings?.whoCanRecord === 'admins' && !isAdminOf(me, ws.id)) return json(res, 403, { error: mark('Only admins can send the notetaker here.') });
      const ro = billing.readOnlyWords(ws);
      if (ro) return json(res, 403, { error: ro });
      if (!whitelist.featureOn(ws, me, 'notetaker')) return json(res, 403, { error: whitelist.featureOff('notetaker'), reason: 'off' });
      if (!RECORDER_URL || !RECORDER_SECRET) return json(res, 409, { error: mark('The recorder isn’t set up on this server.') });
      if (typeof meeting.id !== 'string' || !/^[\w-]{4,80}$/.test(meeting.id)) return json(res, 400, { error: mark('Bad meeting.') });
      // An existing meeting only when it's this company's and this person may see it (never someone else's by its id).
      const existing = db.getDoc('meetings', meeting.id) as any;
      if (existing && (existing.workspaceId !== ws.id || !teamLens(me)('meetings', existing))) return json(res, 403, { error: mark('Not your meeting.') });
      if (meeting.clientId && !teamLens(me)('clients', db.getDoc('clients', String(meeting.clientId)) ?? { workspaceId: ws.id })) return json(res, 403, { error: mark('Not your project.') });
      // The plan's meeting-bot hours this month (plus the "10 more hours" add-on); the bot leaves when they run out.
      const hours = billing.meetMinutes(ws);
      if (hours.left !== Infinity && hours.left < 1)
        return json(res, 409, { error: isAdminOf(me, ws.id) ? msg('The notetaker’s {n} hours for this month are used up. Add 10 more hours in Settings, Plan & billing, Add-ons, or it starts again on the 1st.', { n: hours.hours }) : msg('The notetaker’s {n} hours for this month are used up. An owner can add 10 more hours in Settings, Plan & billing, or it starts again on the 1st.', { n: hours.hours }), reason: 'hours' });
      const doc = { ...meeting, bot: true, status: 'queued', createdBy: me, transcript: [], log: [...(meeting.log ?? []).slice(0, 5)] };
      const sent = await dispatchBot(ws, doc);
      return json(res, sent ? 502 : 200, sent ? { error: sent } : {});
    }
    const meetId = p.match(/^\/api\/meet\/(stop|audio|video|again)\/([\w-]+)$/);
    if (meetId) {
      const m = db.getDoc('meetings', meetId[2]) as any;
      // The team: people who can see the meeting (a project's meetings only for those who see the project).
      const staff = !!m?.bot && memberOf(me).some((w) => w.id === m.workspaceId) && !!teamLens(me)('meetings', m);
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
      if (!staff && !guestPlays()) return json(res, 404, { error: mark('No such meeting.') });
      if (!staff && meetId[1] !== 'audio' && meetId[1] !== 'video') return json(res, 404, { error: mark('No such meeting.') });
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
        const ro = billing.readOnlyWords(ws);
        if (ro) return json(res, 403, { error: ro });
        const only = typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : undefined;
        const stt = sttFor(ws, only);
        if (!stt) return json(res, 409, { error: mark('Add a speech-to-text key in Settings, AI first.') });
        if (!m.recording?.url) return json(res, 409, { error: mark('This meeting’s audio wasn’t kept.') });
        const names = ws.members.map((x: any) => (db.getDoc('users', x.userId) as any)?.name).filter(Boolean);
        const r = await recorder(`/recordings/${m.id}/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stt, names, callback: `${PUBLIC_URL}/api/meet/recorder` }) }).catch(() => null);
        if (!r?.ok) return json(res, 502, { error: mark('The recorder couldn’t start transcribing.') });
        saveMeeting({ ...m, ...(only ? { language: only } : {}), status: 'processing', log: [...(m.log ?? []), meetLine(`Transcribing again in ${only ? languageName(only) : languagesText(ws.meetings?.languages)}`)] });
        return json(res, 200, {});
      }
      if (meetId[1] === 'audio' || meetId[1] === 'video') {
        const watch = m.access?.watch ?? 'everyone';
        const me2 = (db.getDoc('users', me) as any)?.name;
        if (staff && ((watch === 'admins' && !isAdminOf(me, m.workspaceId)) || (watch === 'attendees' && !isAdminOf(me, m.workspaceId) && m.createdBy !== me && !(m.attendees ?? []).includes(me2)))) return json(res, 403, { error: mark('You can’t play this recording.') });
        const r = await recorder(`/recordings/${m.id}${meetId[1] === 'video' ? '/video' : ''}`, { headers: req.headers.range ? { range: String(req.headers.range) } : {} }).catch(() => null);
        if (!r?.ok || !r.body) return json(res, r?.status === 404 ? 404 : 502, { error: mark('Recording not available.') });
        const h: Record<string, string> = { 'cache-control': 'private, max-age=3600' };
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const v = r.headers.get(k);
          if (v) h[k] = v;
        }
        res.writeHead(r.status, h);
        return Readable.fromWeb(r.body as any).pipe(res);
      }
    }

    // Imports from Slack, Trello and Google Drive (Settings, Import; admins only): server/imports.ts.
    if (p === '/api/import' || p.startsWith('/api/import/')) {
      if (pset.maintenance.on && req.method !== 'GET' && !opRecord) return json(res, 503, { error: pset.maintenance.message || 'Changes are paused for a few minutes while sprint2go is updated.' });
      if (await imports.handle(p, { req, res, url, me, operator: session?.operator ?? null, json, body })) return;
    }

    // Files: uploads land on disk under data/files, served back to people in the same company (or guests of it).
    // Streamed to disk (big videos never sit in memory), up to the per-file limit and the company's storage left.
    if (p === '/api/upload' && req.method === 'POST') {
      const wsId = String(req.headers['x-workspace'] ?? '');
      const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')).slice(0, 200);
      const type = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].slice(0, 100);
      if (isSandboxId(wsId)) return json(res, 403, { error: mark('The demo company doesn’t keep files on our server.') });
      const team = memberOf(me).some((w) => w.id === wsId);
      // A guest uploads only on a project that's still going, with a role that adds things (files in the project's
      // folder, or attached to their messages): never a viewer, someone waiting for approval, or after the work ended.
      const guest =
        !team &&
        portalsOf(me).some((pt) => {
          if (pt.workspaceId !== wsId) return false;
          const client = db.getDoc('clients', pt.clientId) as any;
          if (!client || client.status === 'ended') return false;
          const person = clientPeople(client, db.allDocs('channels') as any).find((x) => x.email.toLowerCase() === String(personOf(me)?.email ?? '').toLowerCase());
          return !!person && person.status !== 'pending' && can(person, 'upload');
        });
      if (!team && !guest) return json(res, 403, { error: portalsOf(me).some((pt) => pt.workspaceId === wsId) ? 'You can’t add files here.' : 'Not in this company.' });
      const ro = billing.readOnlyWords(db.getDoc('workspaces', wsId));
      if (ro) return json(res, 403, { error: ro });
      const room = storageRoom(wsId, me);
      const cap = Math.min(MAX_UPLOAD, room.left);
      // Unlimited: the disk's safety reserve, or the person's own cap (server/whitelist.ts), with a plain message.
      const tooBig = (): lang.Words =>
        room.left >= MAX_UPLOAD ? `Files up to ${mb(MAX_UPLOAD)}.` : !room.unlimited ? `It doesn’t fit: the company has ${mb(room.left)} left of its ${mb(room.total)}. An admin can add more in Settings, Plan & billing.` : room.why === 'person' ? whitelist.personFull(room.cap ?? 0) : (whitelist.diskAlert(true), whitelist.DISK_FULL);
      if (Number(req.headers['content-length'] ?? 0) > cap) return json(res, 413, { error: tooBig() });
      const id = randomBytes(16).toString('hex');
      const path = db.filePath(id);
      const out = createWriteStream(path);
      let size = 0;
      let over = false;
      try {
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > cap) {
            over = true;
            break;
          }
          if (!out.write(c)) await once(out, 'drain');
        }
      } finally {
        await new Promise<void>((done) => out.end(done));
      }
      if (over) {
        rmSync(path, { force: true });
        return json(res, 413, { error: tooBig() });
      }
      db.recordFile({ id, workspaceId: wsId, by: me, name, type, size });
      if (room.unlimited) whitelist.checkStorage(db.getDoc('workspaces', wsId), me, room.mine + size);
      return json(res, 200, { id, url: `/api/files/${id}`, name, type, size });
    }
    // How much room a company has, and when to ask before an upload (Settings, Storage).
    if (p === '/api/storage' && req.method === 'GET') {
      const wsId = String(url.searchParams.get('workspaceId') ?? '');
      const team = memberOf(me).some((w) => w.id === wsId);
      if (!team && !portalsOf(me).some((pt) => pt.workspaceId === wsId)) return json(res, 403, { error: mark('Not in this company.') });
      const room = storageRoom(wsId, team ? me : null);
      const w = workspaces().find((x) => x.id === wsId) as any;
      return json(res, 200, { askOverMb: w?.storage?.askOver ?? 500, used: room.used, total: room.total, left: room.left, maxUpload: MAX_UPLOAD, ...(team ? { video: room.video, byPerson: room.byPerson } : {}) });
    }
    const fileReq = p.match(/^\/api\/files\/([a-f0-9]{32})$/);
    if (fileReq && req.method === 'GET') {
      const f = db.fileInfo(fileReq[1]);
      if (!f) return json(res, 404, { error: mark('No such file.') });
      // What links the file: the documents it's on (a Drive file, a message, a task, a row, a mail thread).
      const usedOn = () => db.db.prepare("SELECT coll, data FROM docs WHERE data LIKE ? ESCAPE '\\' LIMIT 500").all(`%/api/files/${f.id}%`) as { coll: string; data: string }[];
      // A teammate opens their own uploads, files on something they can see, and files not on anything yet. A file in
      // a project they can't see (or a private channel, someone's mailbox) stays closed, even with the address.
      const seen = `${me}:${f.id}`;
      const team =
        memberOf(me).some((w) => w.id === f.workspaceId) &&
        (f.by === me ||
          fileOkFresh(seen) ||
          (() => {
            const rows = usedOn();
            if (!rows.length) return true;
            const see = teamLens(me);
            return rows.some((r) => taskFiles.holdsFile(see(r.coll, JSON.parse(r.data)), f.id));
          })());
      // A guest opens their own uploads, and files on something they can see (a shared file, a message in their
      // channel, a request, a comment shared with them): never the rest of the company's files, even with the address.
      // What counts is their view of it: a file on a task's internal comment stays closed though the task is shared.
      const guest =
        !team &&
        portalsOf(me).some((pt) => pt.workspaceId === f.workspaceId) &&
        (f.by === me ||
          (() => {
            const see = lens(me);
            return usedOn().some((r) => taskFiles.holdsFile(see(r.coll, JSON.parse(r.data)), f.id));
          })());
      // Support tickets: the operators who work tickets (the support permission, past the console's two-step sign-in)
      // open what customers attached (their own uploads, or what came with their email), and each opening is in the
      // audit log. Whoever wrote in by email opens what they sent, in Help (those files belong to no company).
      // Only a file sent with its ticket counts: tickets from before 9 Oct could point at any file (support.fileFitsTicket).
      const tickets = !team && !guest ? (db.db.prepare("SELECT m.ticket_id AS ticketId, m.at, t.number, t.requester_user AS requesterUser, t.requester_email AS requesterEmail FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE m.kind = 'customer' AND m.attachments LIKE ? ESCAPE '\\' LIMIT 20").all(`%/api/files/${f.id}%`) as { ticketId: string; at: string; number: number; requesterUser: string | null; requesterEmail: string }[]).filter((t) => support.fileFitsTicket(f, t.requesterUser, t.at)) : [];
      const supportOp = !!tickets.length && !!opRecord && opRecord.totpOn && platform.permsOf(opRecord.role).includes('support') && platform.sessionVerified(token);
      const myEmail = String(meDoc?.email ?? '').toLowerCase();
      const requester = !supportOp && f.workspaceId === 'platform' && tickets.some((t) => t.requesterUser === me || (!!myEmail && t.requesterEmail === myEmail));
      if (!team && !guest && !supportOp && !requester) return json(res, 404, { error: mark('No such file.') });
      if (team && f.by !== me) fileOkNote(seen);
      if (supportOp && !/^bytes=[1-9]/.test(String(req.headers.range ?? '')) && firstOpenInAWhile(`${me}:${f.id}`)) db.audit(opRecord!.email, 'ticket.file-open', tickets[0].ticketId, `#${tickets[0].number}: ${String(f.name).slice(0, 120)}`);
      const path = db.filePath(f.id);
      if (!existsSync(path)) return json(res, 404, { error: mark('The file is gone.') });
      // Streamed, with ranges, so a long video plays and seeks without loading the whole file.
      const total = statSync(path).size;
      // The type is the uploader's word, so only kinds that can't run code open in the browser (images, video, audio, PDF,
      // plain text); anything else (HTML, scripts, documents) downloads as a plain file. What opens is sandboxed too, so
      // even an image format with scripts (SVG) can't act as the person who opened it.
      const base = String(f.type ?? '').split(';')[0].trim().toLowerCase();
      const viewable = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml|heic|heif)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/.test(base);
      const head = {
        'content-type': viewable ? f.type : 'application/octet-stream',
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=86400',
        'content-disposition': `${viewable ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        // The browser's own PDF viewer doesn't open inside a sandbox; a PDF can't run page scripts anyway.
        ...(base === 'application/pdf' ? {} : { 'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox" }),
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (range && total > 0) {
        const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        if (start > end || start >= total) return (res.writeHead(416, { 'content-range': `bytes */${total}` }), res.end());
        res.writeHead(206, { ...head, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${total}` });
        return createReadStream(path, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...head, 'content-length': total });
      return createReadStream(path).pipe(res);
    }

    if (p === '/api/sync' && req.method === 'POST') {
      const r = applySync(me, await body(req), { conn: String(req.headers['x-conn'] ?? ''), operator: session?.operator ?? null });
      return json(res, r.status, r.whyWords ? { ...r.body, why: lang.sayIn(lang.requestLang(req), r.whyWords) } : r.body);
    }

    // Huddles: where audio may travel. With a call relay (TURN_URLS, TURN_SECRET) each team member gets its addresses
    // and credentials that work for an hour; coturn checks them against the same secret, which stays here.
    if (p === '/api/ice' && req.method === 'GET') {
      if (!memberOf(me).length) return json(res, 403, { error: mark('Huddles are for the team.') }); // guests only see their portal
      const c = turn.credentials(me);
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, c ? { relay: true, iceServers: [{ urls: c.urls, username: c.username, credential: c.credential }], expiresAt: c.expiresAt } : { relay: false, iceServers: [] });
    }
    // Calendar links: a private .ics or webcal:// address, read on the server (now, every 30 minutes, and on demand).
    if (p === '/api/calendars/link' && req.method === 'POST') {
      if (pset.maintenance.on && !opRecord) return json(res, 503, { error: pset.maintenance.message || 'Changes are paused for a few minutes while sprint2go is updated.' });
      if (!memberOf(me).length) return json(res, 403, { error: mark('Calendars are for people in a company.') });
      if (tooMany(`callink:${me}`, 12, 10 * 60_000)) return json(res, 429, { error: mark('That’s a lot of links in a few minutes. Try again shortly.') });
      try {
        return json(res, 200, await feeds.addLink(me, await body(req)));
      } catch (e) {
        if (e instanceof FetchError) return json(res, 400, { error: e.message });
        throw e;
      }
    }
    // Whether a new company of this person gets the free trial (Onboarding says so before it's made).
    if (p === '/api/trial' && req.method === 'GET') {
      const c = billing.trialCheck(me, String(meDoc?.email ?? ''), [url.searchParams.get('domain') ?? ''].filter(Boolean));
      return json(res, 200, c.ok ? { available: true } : { available: false, why: c.why });
    }
    // A country's public holidays for someone who chose to see them (Calendar, Public holidays, "Countries you see").
    const holidayReq = p.match(/^\/api\/holidays\/([A-Z]{2})$/);
    if (holidayReq && req.method === 'GET') {
      if (!memberOf(me).length) return json(res, 403, { error: mark('Calendars are for people in a company.') });
      try {
        res.setHeader('cache-control', 'private, max-age=3600');
        return json(res, 200, await feeds.holidaysForPerson(holidayReq[1]));
      } catch (e) {
        if (e instanceof FetchError) return json(res, 400, { error: e.message });
        throw e;
      }
    }
    const calRefresh = p.match(/^\/api\/calendars\/([\w-]+)\/refresh$/);
    if (calRefresh && req.method === 'POST') {
      const cal = db.getDoc('calendars', calRefresh[1]) as any;
      const mineToRefresh = cal && ((cal.source === 'ics' && cal.ownerId === me) || (cal.source === 'holidays' && cal.workspaceId && memberOf(me).some((w) => w.id === cal.workspaceId)));
      if (!mineToRefresh) return json(res, 404, { error: mark('No such calendar.') });
      if (tooMany(`calsync:${me}`, 20, 10 * 60_000)) return json(res, 429, { error: mark('It was just updated. Try again in a few minutes.') });
      if (cal.source === 'holidays') {
        await feeds.syncHolidays(cal.workspaceId);
        const after = db.getDoc('calendars', cal.id) as any;
        return json(res, 200, { ok: !after?.error, error: after?.error });
      }
      return json(res, 200, await feeds.refreshLink(cal.id));
    }

    // Huddles: WebRTC offers, answers and candidates relayed to one person in a company you share. Audio goes
    // straight between browsers; the server only passes these notes along.
    if (p === '/api/signal' && req.method === 'POST') {
      const { to, data } = await body(req);
      const peers = new Set(memberOf(me).flatMap((w) => w.members.map((m) => m.userId)));
      if (typeof to !== 'string' || !peers.has(to)) return json(res, 403, { error: mark('Not someone you work with.') });
      for (const c of clients.values()) if (c.userId === to) c.res.write(`event: signal\ndata: ${JSON.stringify({ from: me, data })}\n\n`);
      return json(res, 200, {});
    }

    if (p === '/api/events') {
      const id = randomBytes(8).toString('hex');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ conn: id })}\n\n`);
      clients.set(id, { res, userId: me, token: cookie(req, 's2g'), visible: true, focused: true, seen: Date.now(), operator: !!session?.operator });
      req.on('close', () => clients.delete(id));
      return;
    }
    // The app says whether its window is in front and that someone is using it, so notifications go to phones
    // only when the person is away (sent on show and hide, and at most once a minute while they work).
    if (p === '/api/presence' && req.method === 'POST') {
      const b = await body(req);
      const c = clients.get(String(b.conn ?? ''));
      if (c && c.userId === me) {
        c.visible = b.visible !== false;
        c.focused = c.visible && b.focused !== false;
        if (c.visible) c.seen = Date.now();
        if (b.desktop === true) c.desktop = true;
      }
      return json(res, 200, {});
    }

    /* ---------- notifications on this device (web push) ---------- */
    if (p === '/api/push/key' && req.method === 'GET') return json(res, 200, { key: push.publicKey() });
    if (p === '/api/push/subscribe' && req.method === 'POST') {
      const b = await body(req);
      const sub = push.validSub(b.subscription);
      if (!sub) return json(res, 400, { error: mark('This browser’s notification address isn’t one we can send to.') });
      // Someone looking at the app as this person (support) never turns on their notifications.
      if (session?.operator) return b.refresh === true ? json(res, 200, { on: false }) : json(res, 403, { error: mark('Not while you’re looking at the app as someone else.') });
      const on = push.subscribe(me, token!, sub, String(b.device ?? ''), typeof b.replaces === 'string' ? b.replaces : undefined, b.refresh === true);
      return json(res, 200, { on });
    }
    if (p === '/api/push/subscribe' && req.method === 'DELETE') {
      const b = await body(req);
      if (typeof b.endpoint === 'string') push.unsubscribe(me, b.endpoint);
      return json(res, 200, { on: false });
    }
    if (p === '/api/push/test' && req.method === 'POST') {
      if (tooMany(`push-test:${me}`, 10, 10 * 60_000)) return json(res, 429, { error: mark('That’s a lot of tests. Try again in a few minutes.') });
      const b = await body(req);
      const ws = memberOf(me)[0] as any;
      const sent = await push.sendToDevice(me, String(b.endpoint ?? ''), { title: ws?.whiteLabel?.enabled ? ws.whiteLabel.name : 'sprint2go', body: lang.sayIn(lang.requestLang(req), mark('Notifications work on this device. You’ll get them when you’re away from the app.')), url: '/settings?id=notifications', tag: 'test', urgent: true, ttl: 300 });
      return sent ? json(res, 200, { ok: true }) : json(res, 502, { error: mark('The notification service didn’t take it. Turn notifications off and on again on this device.') });
    }

    // Vault: shared logins. Only people given access see an item; passwords and 2FA codes leave the server one at a time, logged.
    // WhatsApp Business: the token is kept here (like AI keys); the browser only sees that it's connected.
    if (p === '/api/whatsapp/connect' && req.method === 'POST') {
      const { workspaceId, phoneNumberId, token, displayPhone, appSecret } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: mark('Only admins can connect WhatsApp.') });
      if (session?.operator) return json(res, 403, { error: mark('Connecting WhatsApp is theirs to do: you’re signed in as them.') });
      const ro = billing.readOnlyWords(db.getDoc('workspaces', workspaceId));
      if (ro) return json(res, 403, { error: ro });
      // Meta signs each message with the app's secret; without one we can't tell its posts from anyone else's.
      const secret = typeof appSecret === 'string' ? appSecret.trim() : '';
      if (secret && !/^[a-f0-9]{32}$/i.test(secret)) return json(res, 400, { error: mark('That app secret doesn’t look right: Meta shows it as 32 letters and numbers, in App settings, Basic.') });
      // Already connected: the secret alone can be added (the number and its token stay).
      const was = db.getDoc('workspaces', workspaceId) as any;
      const kept = db.loadKey(workspaceId, 'whatsapp');
      if (secret && !token && was?.whatsapp?.connected && kept?.baseUrl) {
        db.saveKey(workspaceId, whatsapp.SECRET_KEY, secret, undefined, me);
        const doc = { ...was, whatsapp: { ...was.whatsapp, secured: whatsapp.secured(workspaceId) } };
        db.writeDocs('workspaces', [doc], [], me);
        broadcast('workspaces', [doc], []);
        return json(res, 200, { verifyToken: doc.whatsapp.verifyToken });
      }
      if (typeof phoneNumberId !== 'string' || !phoneNumberId.trim() || typeof token !== 'string' || token.trim().length < 20) return json(res, 400, { error: mark('Paste the phone number ID and a permanent access token from Meta.') });
      if (!secret && !whatsapp.platformSecretSet() && !db.loadKey(workspaceId, whatsapp.SECRET_KEY)) return json(res, 400, { error: mark('Paste the app secret too (Meta for Developers: your app, App settings, Basic). Without it, messages from Meta can’t be checked, so none are read.') });
      // One number, one company: its messages can only go to one place.
      if (workspaces().some((x: any) => x.id !== workspaceId && x.whatsapp?.connected && x.whatsapp.phoneNumberId === phoneNumberId.trim())) return json(res, 409, { error: mark('Another company already connected this number. If it’s yours, write to us and we’ll sort it out.') });
      db.saveKey(workspaceId, 'whatsapp', token.trim(), phoneNumberId.trim(), me);
      if (secret) db.saveKey(workspaceId, whatsapp.SECRET_KEY, secret, undefined, me);
      const w = db.getDoc('workspaces', workspaceId) as any;
      const verifyToken = w.whatsapp?.verifyToken ?? randomBytes(12).toString('hex');
      const doc = { ...w, whatsapp: { phoneNumberId: phoneNumberId.trim(), displayPhone: displayPhone ? String(displayPhone).slice(0, 30) : undefined, connected: true, verifyToken, secured: whatsapp.secured(workspaceId) } };
      db.writeDocs('workspaces', [doc], [], me);
      broadcast('workspaces', [doc], []);
      return json(res, 200, { verifyToken });
    }
    if (p === '/api/whatsapp/connect' && req.method === 'DELETE') {
      const { workspaceId } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, {});
      db.deleteKey(workspaceId, 'whatsapp');
      db.deleteKey(workspaceId, whatsapp.SECRET_KEY);
      const w = db.getDoc('workspaces', workspaceId) as any;
      const doc = { ...w, whatsapp: w.whatsapp ? { ...w.whatsapp, connected: false } : undefined };
      db.writeDocs('workspaces', [doc], [], me);
      broadcast('workspaces', [doc], []);
      return json(res, 200, {});
    }
    if (p === '/api/whatsapp/send' && req.method === 'POST') {
      const { workspaceId, to, text, channelId } = await body(req);
      if (!memberOf(me).some((w) => w.id === workspaceId)) return json(res, 403, {});
      const roWa = billing.readOnlyWords(db.getDoc('workspaces', String(workspaceId)) as any);
      if (roWa) return json(res, 403, { error: roWa });
      const key = db.loadKey(workspaceId, 'whatsapp');
      if (!key?.baseUrl) return json(res, 409, { error: mark('WhatsApp isn’t connected. Settings, Apps & chat.') });
      const number = String(to ?? '').replace(/\D/g, '');
      if (!number || typeof text !== 'string' || !text.trim()) return json(res, 400, { error: mark('A number and a message, please.') });
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
      // Changing or deleting a login: whoever added it while they're still in the company, or its admins.
      const canEdit = (it: db.VaultRow) => memberOf(me).some((w) => w.id === it.workspaceId) && (it.createdBy === me || isAdminOf(me, it.workspaceId));
      // Nothing new is saved in a paused or suspended company; reading what's there still works.
      const vaultRo = (wsId: string) => billing.readOnlyWords(db.getDoc('workspaces', wsId) as any);
      const m = p.match(/^\/api\/vault\/([\w-]+)(?:\/(reveal|code|log))?$/);
      if (p === '/api/vault' && req.method === 'GET') {
        if (!memberOf(me).some((w) => w.id === wsId)) return json(res, 403, {});
        return json(res, 200, { items: db.vaultList(wsId).filter(canSee).map((it) => ({ ...it, canEdit: canEdit(it) })) });
      }
      // Re-share: someone who holds a login's key wraps it for people who don't have it yet. Only keys change.
      const keysReq = p.match(/^\/api\/vault\/([\w-]+)\/keys$/);
      if (keysReq && req.method === 'POST') {
        const it = db.vaultGet(keysReq[1]);
        if (!it || !canSee(it)) return json(res, 404, { error: mark('No such login.') });
        if (!it.meta.keys?.[me] && !canEdit(it)) return json(res, 403, { error: mark('You don’t hold the key to this login.') });
        if (vaultRo(it.workspaceId)) return json(res, 403, { error: vaultRo(it.workspaceId) });
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
        if (before && !canEdit(before)) return json(res, 403, { error: mark('Only the person who added it, or an admin, can change it.') });
        const roV = vaultRo(before?.workspaceId ?? String(b.workspaceId));
        if (roV) return json(res, 403, { error: roV });
        if (b.totp && !String(b.totp).startsWith('enc:')) {
          try {
            db.totpCode(String(b.totp));
          } catch {
            return json(res, 400, { error: mark('That 2FA key doesn’t look right. Paste the setup key (letters and numbers) or the otpauth:// link.') });
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
      if (!m || !item || !canSee(item)) return json(res, 404, { error: mark('Not found.') });
      if (!m[2] && req.method === 'DELETE') {
        if (!canEdit(item)) return json(res, 403, { error: mark('Only the person who added it, or an admin, can delete it.') });
        if (vaultRo(item.workspaceId)) return json(res, 403, { error: vaultRo(item.workspaceId) });
        db.vaultDelete(item.id);
        return json(res, 200, {});
      }
      // An operator looking at the app as someone sees which logins exist, never their passwords or codes.
      if ((m[2] === 'reveal' || m[2] === 'code') && session?.operator) return json(res, 403, { error: mark('Passwords and codes stay with them: you’re signed in as them.') });
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
        if (!secret) return json(res, 404, { error: mark('No 2FA on this login.') });
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
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: mark('Only admins can add AI keys.') });
      if (session?.operator) return json(res, 403, { error: mark('AI keys are theirs to add: you’re signed in as them.') });
      if (aiLimits.blocked(db.getDoc('workspaces', workspaceId) as any).has(String(provider))) return json(res, 409, { error: mark('This provider is blocked for the company (Settings, AI, Blocked providers). Unblock it first.') });
      const info = PROVIDERS.find((x) => x.id === provider);
      if (!info || typeof key !== 'string' || key.trim().length < 8) return json(res, 400, { error: mark('That key looks too short.') });
      if (baseUrl !== undefined && typeof baseUrl !== 'string') return json(res, 400, { error: mark('That address doesn’t look right.') });
      // The provider's own list of models for this key: what the company picks from next, and which model to test with.
      const list = await models.listWith(provider, { key: key.trim(), baseUrl }, (id) => aiplan.priceOf(id));
      if (test && info.kind !== 'speech') {
        try {
          await testKey({ provider, model: models.testModelFor(provider, list), apiKey: key.trim(), baseUrl });
        } catch (e) {
          return json(res, 400, { error: e instanceof AIError ? e.message : (e as { status?: number }).status === 401 ? 'That key was rejected. Check it and try again.' : 'The key did not work.' });
        }
      }
      db.saveKey(workspaceId, provider, key.trim(), baseUrl, me);
      models.remember(`ws:${workspaceId}`, provider, list);
      // A replaced key may offer fewer models: jobs on one it doesn't move to their fallback.
      if (list.source === 'live') moveOffGoneModels(workspaceId, provider, list);
      return json(res, 200, { keyLast4: keyHint(provider, key), models: list });
    }
    if (p === '/api/ai/keys' && req.method === 'DELETE') {
      const { workspaceId, provider } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: mark('Only admins can remove AI keys.') });
      db.deleteKey(workspaceId, provider);
      models.forget(`ws:${workspaceId}`, String(provider ?? ''));
      return json(res, 200, {});
    }
    // The models a company's key can use, from the provider's own list (kept about an hour; refresh=1 reads it again).
    // Admins of that company only. Names, ids and prices: never the key.
    if (p === '/api/ai/models' && req.method === 'GET') {
      const wsId = url.searchParams.get('workspaceId') ?? '';
      const provider = url.searchParams.get('provider') ?? '';
      if (!isAdminOf(me, wsId)) return json(res, 403, { error: mark('Only admins can see the AI models.') });
      if (!PROVIDERS.some((x) => x.id === provider)) return json(res, 400, { error: mark('No such provider.') });
      const force = url.searchParams.get('refresh') === '1' && !tooMany(`models:${me}`, 10, 60_000);
      return json(res, 200, await companyModels(wsId, provider, force));
    }
    // One tiny call with a model on the company's key: a model id typed in (not on the provider's list), or "Run a sample".
    if (p === '/api/ai/models/check' && req.method === 'POST') {
      const { workspaceId, provider, model } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: mark('Only admins can try AI models.') });
      if (session?.operator) return json(res, 403, { error: mark('That would use their key: you’re signed in as them.') });
      if (tooMany(`modelcheck:${me}`, 20, 60_000)) return json(res, 429, { error: mark('That’s a lot of tries in one minute. Give it a moment.') });
      if (aiLimits.blocked(db.getDoc('workspaces', workspaceId) as any).has(String(provider))) return json(res, 409, { error: mark('This provider is blocked for the company.') });
      const k = typeof provider === 'string' ? db.loadKey(workspaceId, provider) : null;
      if (!k) return json(res, 409, { error: mark('Add a key for this provider first.') });
      const started = Date.now();
      const err = await models.checkModel(provider, String(model ?? '').trim(), k);
      return json(res, err ? 400 : 200, err ? { error: err } : { ok: true, ms: Date.now() - started });
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
      const w = workspaces().find((x) => x.id === wsId);
      const jobs = asClient ? ['ask'] : Array.from(new Set(Object.values(JOB_OF)));
      if (!asClient && !whitelist.featureOn(w, me, 'ai')) return json(res, 200, { live: false, why: 'off', message: whitelist.featureOff('ai') });
      const usedUp = onOurAI(w) && aiplan.gate(w, undefined, asClient ? null : me).state === 'out';
      const chains = jobs.map((j) => aiFor(wsId, j));
      const live = chains.some((c) => c.some((x) => !x.included || !usedUp));
      // Why it's off: the allowance is used up, our AI is down, or nothing is set up.
      const why = live ? null : usedUp && chains.some((c) => c.length) ? 'used-up' : onOurAI(w) ? 'down' : 'no-key';
      return json(res, 200, { live, why });
    }
    // Settings, AI: who handles the company's data for each job, and what's left of the plan's AI this month.
    if (p === '/api/ai/plan' && req.method === 'GET') {
      const wsId = url.searchParams.get('ws') ?? '';
      if (!memberOf(me).some((w) => w.id === wsId)) return json(res, 403, {});
      const w = workspaces().find((x) => x.id === wsId);
      // This month's real spend on each of the company's own keys, and which ones rest at their cap.
      return json(res, 200, { ...aiplan.companyView(w), spendUsd: aiLimits.spendUsd(wsId), capped: [...aiLimits.capped(w as any)] });
    }
    const action = p.match(/^\/api\/ai\/(\w+)$/)?.[1];
    if (action && routes[action] && req.method === 'POST') {
      const b = await body(req);
      // The demo company never uses anyone's AI (ours or a company's keys): the app answers with samples there.
      if (isSandboxId(b.workspaceId)) return json(res, 403, { error: mark('The demo company uses sample AI answers.') });
      const asClient = memberOf(me).some((w) => w.id === b.workspaceId) ? undefined : portalsOf(me).find((pt) => pt.workspaceId === b.workspaceId);
      if (asClient) {
        // Client people: only "Ask AI", only when the company switched it on, within the monthly limit.
        const w = workspaces().find((x) => x.id === asClient.workspaceId) as any;
        const client = db.getDoc('clients', asClient.clientId) as any;
        const access = w && client ? accessFor(w, client) : null;
        if (action !== 'askmeetings' || b.workspaceId !== asClient.workspaceId || !access?.ai) return json(res, 403, { error: mark('AI isn’t switched on for your portal.') });
        const ids = clientUserIds(asClient.clientId);
        if (db.monthlyUses(ids, 'ask') >= access.aiQuestions) return json(res, 429, { error: msg('You’ve used all {n} questions for this month.', { n: access.aiQuestions }) });
      } else if (!memberOf(me).some((w) => w.id === b.workspaceId)) return json(res, 403, { error: mark('Not in this workspace.') });
      if (tooMany(`ai:${me}`, 40, 60_000)) return json(res, 429, { error: mark('That’s a lot of AI in one minute. Give it a moment.') });
      // Monthly caps (Settings, AI): what the company, and each person, may spend on its own keys this month.
      const capWs = workspaces().find((w) => w.id === b.workspaceId) as any;
      const ro = billing.readOnlyWords(capWs);
      if (ro) return json(res, 403, { error: ro });
      const caps = capWs?.ai?.caps as { companyRp?: number; personRp?: number } | undefined;
      if (caps?.companyRp || caps?.personRp) {
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const rows = db.usageSince(b.workspaceId, monthStart) as { job: string; provider: string; model: string; inTokens: number; outTokens: number }[];
        if (caps.companyRp && spendRp(rows) >= caps.companyRp) return json(res, 429, { error: msg('The company’s AI budget for this month ({budget}) is used up. An admin can raise it in Settings, AI.', { budget: `Rp ${caps.companyRp.toLocaleString('id-ID')}` }) });
        if (caps.personRp && spendRp(db.usageSinceFor(b.workspaceId, me, monthStart) as any) >= caps.personRp) return json(res, 429, { error: msg('Your AI budget for this month ({budget}) is used up. An admin can raise it in Settings, AI.', { budget: `Rp ${caps.personRp.toLocaleString('id-ID')}` }) });
      }
      // Unlimited: an owner or admin can switch AI off for one person (Settings, Plan & billing).
      if (!asClient && !whitelist.featureOn(capWs, me, 'ai')) return json(res, 403, { error: whitelist.featureOff('ai'), reason: 'off' });
      whitelist.checkAlerts(capWs, asClient ? null : me); // Unlimited: 80% and 100% are told even when this one doesn't run
      const job = JOB_OF[action];
      const route = withinAllowance(capWs, aiFor(b.workspaceId, job), me);
      if (!route.chain.length) {
        if (route.message) return json(res, 429, { error: route.message, reason: 'used-up' });
        if (onOurAI(capWs)) return json(res, 503, { error: OUR_AI_DOWN });
        return json(res, 409, { error: 'no-key', message: msg(NO_AI) }); // message: in the asker's language
      }
      const log = (cfg: AIConfig, inTokens: number, outTokens: number) => db.logUsage({ workspaceId: b.workspaceId, userId: me, job, provider: cfg.included ? 'included' : cfg.provider, via: cfg.provider, model: cfg.model, inTokens, outTokens });
      const answer = await aiplan.runChain(route.chain, log, () => routes[action](b));
      aiAlerts(b.workspaceId, me);
      return json(res, 200, answer);
    }
    return json(res, 404, { error: mark('Not found') });
  } catch (err) {
    const status = err instanceof AIError ? err.status : (err as { status?: number }).status === 429 ? 503 : err instanceof SyntaxError ? 400 : 500;
    console.error(`[${new Date().toISOString()}] ${req.method} ${p}`, err instanceof Error ? (status === 500 ? err.stack : err.message) : err);
    if (status === 500) platform.recordError({ source: 'server', message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined, path: `${req.method} ${p}`, userId: db.sessionUser(cookie(req, 's2g')) });
    // Never leak keys or raw upstream errors.
    json(res, status, { error: err instanceof AIError ? err.message : status === 503 ? 'AI is busy, try again shortly.' : 'Something went wrong.' });
  }
}).listen(PORT, HOST, () => {
  const mailPath = mailer.systemMailPath();
  console.log(`sprint2go on http://localhost:${PORT}${mailPath === 'ses' ? ' (email through Amazon SES)' : mailPath === 'own' ? ` (email from ${mailer.NOREPLY} through our mail server)` : ' (no email: codes go to this log)'}`);
  mailer.startMailer({ publicUrl: PUBLIC_URL, broadcast, log: (line) => console.log(line), notify: notifyPeople });
  // A company's tracked mail points at its own live address when it has one, so its clients never see ours.
  readTracking.initTracking({ broadcast: (c, u, d) => broadcast(c, u, d), origin: (wsId) => { const w = db.getDoc('workspaces', wsId) as any; return customDomains.isLive(w) ? `https://${w.whiteLabel.domain}` : PUBLIC_URL || `http://localhost:${PORT}`; } });
  routing.startRouting({ notify: notifyPeople, broadcast, log: (line) => console.log(line) });
  customDomains.start({
    broadcast,
    log: (line) => console.log(line),
    notifyAdmins: (wsId, text) => notifyUsers((workspaces().find((w) => w.id === wsId)?.members ?? []).filter((m) => m.role !== 'member').map((m) => m.userId), text, '/settings/agency', wsId),
  });
  feeds.startCalendarFeeds({ broadcast });
  calendarInvites.initInvites({ broadcast });
  // Phone mail apps (IMAP and SMTP submission): off unless IMAP_ENABLED=1 and the mail certificate is trusted.
  void mailApps.start({ write: (userId, coll, upserts, deletes) => applySync(userId, { coll, upserts, deletes }), memberOf: (userId) => memberOf(userId) as any, readOnlyWhy: (w) => billing.readOnlyWhy(w as any), log: (line) => console.log(line) });
}).requestTimeout = 60 * 60_000; // a big upload on a slow line can take a while (Node's own limit is 5 minutes)

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
    calendarLinks: true, // .ics and webcal:// links are read by this server (calendarFeeds.ts)
    payments: !!process.env.XENDIT_SECRET,
    relay: turn.configured, // huddles can fall back to our call relay (TURN) on networks that block direct calls
    // The desktop app: DESKTOP_URL when set, else the newest release on GitHub (its page, and each installer).
    desktopUrl: process.env.DESKTOP_URL || desktopRelease?.page || null,
    desktopMac: process.env.DESKTOP_URL ? null : (desktopRelease?.mac ?? null),
    desktopWin: process.env.DESKTOP_URL ? null : (desktopRelease?.windows ?? null),
    push: true, // notifications on phones and computers (web push)
    // Other ways to sign in. None is built yet (Google and Microsoft need their sign-in apps, SAML an identity
    // provider), so Settings shows them switched off with the reason instead of switches that do nothing.
    signIn: { google: false, microsoft: false, saml: false, googleApp: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), microsoftApp: !!((process.env.MICROSOFT_CLIENT_ID || process.env.MS_CLIENT_ID) && (process.env.MICROSOFT_CLIENT_SECRET || process.env.MS_CLIENT_SECRET)) },
    ownStorage: false, // files can't be saved to a company's own cloud yet
    maxUploadMb: Math.round(MAX_UPLOAD / 1024 ** 2),
    mailHost: mailer.MAIL_HOST,
    trustedCert: certState(mailer.MAIL_HOST).trusted, // providers may require a CA-signed certificate from our mail server
    routingCheck: process.env.MAIL_ENABLED !== '0' && mailer.systemMailPath() !== 'log', // the server can send "Some of each" routing tests
    customDomains: customDomains.dokployOn(), // agencies' own addresses get certificates (Dokploy is set up)
    customTarget: customDomains.TARGET, // what those addresses point at
    emailNotes: mailer.systemMailPath() !== 'log', // the server can email people (teammates' away emails, guests' notices)
    whatsappAppSecret: whatsapp.platformSecretSet(), // WhatsApp messages signed by sprint2go's own Meta app can be checked
  };
}
/**
 * A company's "Some of each" routing, as saved from the app: the admins choose the daily check; whether routing was
 * verified and the last check's result are the server's (server/routing.ts). The demo plays those in the app.
 */
function serverRouting(next: any, before: any) {
  if (!next && !before) return undefined;
  return { dailyCheck: typeof next?.dailyCheck === 'boolean' ? next.dailyCheck : (before?.dailyCheck ?? true), ...(before?.verifiedAt ? { verifiedAt: before.verifiedAt } : {}), ...(before?.lastCheck ? { lastCheck: before.lastCheck } : {}) };
}

/**
 * The newest desktop release on GitHub (DESKTOP_REPO, "owner/repo"), checked at start and every six hours, so the
 * landing page offers the download once a release with installers exists. A private repo or no release: nothing.
 */
const DESKTOP_REPO = process.env.DESKTOP_REPO ?? 'aqeeljundiy/sprint2go';
let desktopRelease: { page: string; mac?: string; windows?: string } | null = null;
async function checkDesktopRelease() {
  if (process.env.DESKTOP_URL || !/^[\w.-]+\/[\w.-]+$/.test(DESKTOP_REPO)) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'sprint2go-server' }, signal: AbortSignal.timeout(10_000) });
    if (r.status === 404) return void (desktopRelease = null);
    if (!r.ok) return; // rate limited or GitHub is down: keep what we had
    const rel = (await r.json()) as { html_url?: string; assets?: { name: string; browser_download_url: string }[] };
    const pick = (re: RegExp) => (rel.assets ?? []).find((a) => re.test(a.name))?.browser_download_url;
    const mac = pick(/\.dmg$/i);
    const windows = pick(/setup.*\.exe$/i) ?? pick(/\.exe$/i);
    desktopRelease = rel.html_url && (mac || windows) ? { page: rel.html_url, mac, windows } : null;
  } catch {
    /* offline: keep what we had */
  }
}
setTimeout(() => void checkDesktopRelease(), 15_000);
setInterval(() => void checkDesktopRelease(), 6 * 3600_000);
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

/**
 * A notice in the app's bell. Operators get theirs in our own company when they're in it; links into the backend open it.
 * `text`: a msg() (each reader sees it in their own language) or fixed text.
 */
function notifyUsers(userIds: string[], text: lang.Words, url?: string, workspaceId?: string) {
  const at = new Date().toISOString();
  const home = platform.settings().homeWorkspace;
  const notices = Array.from(new Set(userIds)).flatMap((userId) => {
    const mine = memberOf(userId);
    const ws = workspaceId && mine.some((w) => w.id === workspaceId) ? workspaceId : home && mine.some((w) => w.id === home) ? home : mine[0]?.id;
    if (!ws) return [];
    const link = url?.startsWith('/settings/') ? { app: 'settings', id: url.split('/')[2] } : undefined;
    return [{ id: `n-${randomBytes(6).toString('hex')}`, userId, workspaceId: ws, kind: 'team', ...noticeWords(text, 240), at, read: false, ...(link ? { link } : url ? { url } : {}) }];
  });
  if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
}

/** What a notice saves: the English `text` (cut to `max`) and `tr`, so each reader's app shows their own language. */
function noticeWords(words: lang.Words, max: number): { text: string; tr?: unknown } {
  const w = lang.saved(words);
  return w.tr ? { text: w.text.slice(0, max), tr: w.tr } : { text: w.text.slice(0, max) };
}

/** Tells the support team about a ticket: the assignee for replies, everyone on support for new ones. */
function supportNotify(t: support.Ticket, text: lang.Words, reply = false) {
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
    supportNotify(existing, msg('{name} replied by email on #{number}', { name: from?.name || email, number: existing.number }), true);
    return;
  }
  const u = (db.allDocs('users') as any[]).find((x) => String(x.email ?? '').toLowerCase() === email && !x.deletedAt);
  const ws = u ? (memberOf(u.id)[0] as any) : null;
  const tag = to.startsWith('abuse@') ? 'abuse' : to.startsWith('postmaster@') ? 'postmaster' : null;
  const t = support.createTicket({ subject: subject.replace(/^\s*((re|fwd?)\s*:\s*)+/i, '') || '(no subject)', body: text || '(empty)', channel: 'email', email, name: from?.name || u?.name || null, userId: u?.id ?? null, workspaceId: ws?.id ?? null, paying: ws ? ['paying', 'unlimited'].includes(admin.mrrOf(ws, ws.members.length).state) : false, priority: tag === 'abuse' ? 'high' : undefined, tags: tag ? [tag] : [], attachments, mid });
  supportNotify(t, msg('New ticket #{number} by email from {name}: {subject}', { number: t.number, name: from?.name || email, subject: t.subject.slice(0, 70) }));
  // A short receipt so they know it arrived (not for auto-replies).
  if (!parsed.headers.get('auto-submitted') && !/no-?reply|mailer-daemon/i.test(email))
    void mailer.sendSystemMail({ fromName: platform.settings().supportName, to: [email], subject: `Re: ${t.subject} [#${t.number}]`, text: ticketReceipt(email, t.number), inReplyTo: mid, references: [mid] }).catch(() => {});
});

/** A notice in these people's bell, of a kind (the push rules and Settings, Notifications go by it), opening `link`. */
function tell(userIds: string[], workspaceId: string, kind: string, text: lang.Words, link: { app: string; id?: string }) {
  const at = new Date().toISOString();
  const notices = Array.from(new Set(userIds)).map((userId) => ({ id: `n-${randomBytes(6).toString('hex')}`, userId, workspaceId, kind, ...noticeWords(text, 300), at, read: false, link })) as db.Doc[];
  if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
}

/** A notice for these people (the mail engine uses it for failures and credits). */
function notifyPeople(userIds: string[], workspaceId: string, text: lang.Words, link?: string) {
  const at = new Date().toISOString();
  // "/calendar?event=<id>": a guest's answer to an invite we sent opens that event (or that date of it).
  const event = link?.startsWith('/calendar') ? new URLSearchParams(link.split('?')[1] ?? '').get('event') : null;
  const notices = Array.from(new Set(userIds)).map((userId) => ({ id: `n-${randomBytes(6).toString('hex')}`, userId, workspaceId, kind: event ? 'meeting' : 'mail', ...noticeWords(text, 1000), at, read: false, link: link?.startsWith('/settings') ? { app: 'settings', id: link.split('/')[2] } : event ? { app: 'calendar', id: event } : { app: 'mail' } }));
  if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
}

// Once a day: expired sessions go, and a copy of the database lands in data/backups (the last 14 are kept), with a
// gzipped copy off this server when S3_* is set (the last 30 there).
const housekeeping = () => {
  try {
    db.purgeSessions();
    push.prune();
  } catch (e) {
    console.error('[sessions]', e);
  }
  // Demo companies nobody opened for a month go; the next time they open it, it's made again, fresh.
  try {
    const gone = sandbox.cleanup();
    if (gone.length) console.log(`[sandbox] ${gone.length} unused demo companies removed`);
  } catch (e) {
    console.error('[sandbox]', e instanceof Error ? e.message : e);
  }
  db.backup()
    .then(async (f) => {
      console.log(`Backup: ${f}`);
      if (!offsite.offsiteConfigured()) return;
      const up = await offsite.uploadBackup(f);
      console.log(`Backup copied off-site: ${up.file}, ${Math.round(up.bytes / 1024)} KB`);
    })
    .catch((e) => console.error('[backup]', e instanceof Error ? e.message : e));
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
        if (!ws || ws.suspended || whitelist.on(ws)) continue; // Unlimited is never billed, so never suspended for it
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

/* ---------- every hour: plans keep their promises (server/billing.ts) ---------- */
// A pause past the year's 3 months ends by itself (billed again from then), and a cancelled plan moves to Free when
// the period that was paid for ends.
const planClock = () => {
  try {
    const save = (ws: any) => (db.writeDocs('workspaces', [ws], [], null), broadcast('workspaces', [ws], []));
    const tell = (ids: string[], text: lang.Words, wsId: string) => notifyUsers(ids, text, '/settings/billing', wsId);
    billing.resumeExpiredPauses(save, tell);
    billing.endCancelled(save, tell);
    // Unlimited: usage nobody asked for (meeting notes, summaries) still reaches its 80% and 100% alerts.
    for (const w of workspaces()) if (whitelist.on(w as any)) whitelist.checkAlerts(w);
  } catch (e) {
    console.error('[plans]', e instanceof Error ? e.message : e);
  }
};
setTimeout(planClock, 30_000);
setInterval(planClock, 60 * 60_000);

/* ---------- background jobs: scheduled mail, snoozes, task reminders ---------- */

// Tables' scheduled rules: checked every minute, each runs once on the days it's due.
setInterval(() => tablesEngine.runSchedules(tablesEnv), 60_000);

// Calendar reminders ten minutes ahead (for people who keep "Meetings and events" on): a notice in the bell, and on
// their phone when they're away.
push.setSubject(PUBLIC_URL, mailer.SUPPORT_EMAIL);
setInterval(() => {
  try {
    const due = pushRules.eventReminders();
    if (due.length) (db.writeDocs('notices', due, [], null), broadcast('notices', due, []));
  } catch (e) {
    console.error('[reminders]', e instanceof Error ? e.message : e);
  }
}, 60_000);

/* ---------- jobs the settings promise (each in its own module, which says what it does) ---------- */

// The notetaker joins by itself (Meet, Upcoming, "Bot joins automatically"): checked every minute.
const autoJoinDeps: autojoin.AutoJoinDeps = { recorderUp: () => recorderUp, send: dispatchBot, notify: (ids, wsId, text, link) => tell(ids, wsId, 'meeting', text, link) };
setInterval(() => void autojoin.runAutoJoin(autoJoinDeps).catch((e) => console.error('[autojoin]', e instanceof Error ? e.message : e)), 60_000);

// Channel summaries on their schedule, with the company's AI (its keys, or the plan's allowance).
const summaryDeps: summaries.SummaryDeps = {
  broadcast,
  write: async (ws, input) => {
    const route = withinAllowance(ws, aiFor(ws.id, 'summary'));
    if (!route.chain.length) {
      if (route.message) return { off: route.message };
      if (onOurAI(ws)) return { failed: 'AI wasn’t available' }; // ours is down: tried again later
      return { off: 'AI isn’t set up for this company. An admin can add an AI key in Settings, AI, or switch to the AI plan.' };
    }
    try {
      const text = await aiplan.runChain(route.chain, (cfg, inTokens, outTokens) => db.logUsage({ workspaceId: ws.id, userId: '', job: 'summary', provider: cfg.included ? 'included' : cfg.provider, via: cfg.provider, model: cfg.model, inTokens, outTokens }), () => ai.channelSummary(input));
      return { text };
    } catch (e) {
      return { failed: e instanceof AIError ? e.message : 'the AI service failed' };
    }
  },
};
setTimeout(() => void summaries.runSummaries(summaryDeps).catch((e) => console.error('[summaries]', e instanceof Error ? e.message : e)), 45_000);
setInterval(() => void summaries.runSummaries(summaryDeps).catch((e) => console.error('[summaries]', e instanceof Error ? e.message : e)), 10 * 60_000);

// Email for teammates who are away (Settings, Notifications), through the system mail; only when it can send. Away
// means no window in use and no request (opening the app from a notification is one) for a while.
setInterval(() => {
  if (mailer.systemMailPath() === 'log') return;
  const seen = db.lastSeen();
  const deps: digest.DigestDeps = {
    publicUrl: PUBLIC_URL,
    lastActive: (userId) => {
      const live = [...clients.values()].filter((c) => c.userId === userId && !c.operator);
      if (live.some((c) => c.visible && Date.now() - c.seen < IDLE_MS)) return Date.now();
      return Math.max(Date.parse(seen.get(userId) ?? '') || 0, ...live.map((c) => c.seen));
    },
    send: (to, subject, text, html, fromName) => mailer.sendNote(to, subject, text, html, fromName),
  };
  void digest.runDigests(deps).catch((e) => console.error('[digest]', e instanceof Error ? e.message : e));
}, 10 * 60_000);

// "Remind me if no reply" on email sent with tracking: when its day comes and nobody wrote back, the sender hears once.
setInterval(() => {
  try {
    readTracking.runReplyReminders();
  } catch (e) {
    console.error('[reminders]', e instanceof Error ? e.message : e);
  }
}, 5 * 60_000);

// Deleting old chat messages (Settings, Apps & chat): looked at every hour, run once a day per company.
const retentionDeps: retention.RetentionDeps = { broadcast, notify: (ids, wsId, text, link) => tell(ids, wsId, 'team', text, link) };
const retentionTick = () => {
  try {
    for (const r of retention.runRetention(retentionDeps)) if (!r.noticeOnly) console.log(`[retention] ${r.workspaceId}: ${r.deleted} old chat messages deleted, ${r.files} files kept in Drive`);
  } catch (e) {
    console.error('[retention]', e instanceof Error ? e.message : e);
  }
};
setTimeout(retentionTick, 2 * 60_000);
setInterval(retentionTick, 60 * 60_000);

// Imports (Slack, Trello, Google Drive): the ones a restart stopped are closed (Undo still works), old uploads go.
imports.init({ broadcast, tell, maxUpload: MAX_UPLOAD });

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
    const woke = wakeThread(t, now); // snoozed mail comes back (or not, when "only if no reply" saw a reply)
    return woke ? [woke] : [];
  });
  if (threads.length) {
    db.writeDocs('threads', threads, [], null);
    broadcast('threads', threads, []);
  }
  // "Send later" mail goes out for real now, the same way as any email: through the wait in the outbox (its time has
  // come, so it leaves straight away), where a failure is marked on the email and told to its mailbox's people.
  for (const t of sendNow) {
    const ws = workspaces().find((w) => (w.accounts ?? []).some((a: any) => a.id === t.accountId)) as any;
    const account = ws?.accounts?.find((a: any) => a.id === t.accountId);
    const m = t.messages[t.messages.length - 1];
    if (!ws || !account || !m || (account.provider && account.provider !== 'sprint2go')) continue;
    mailer.holdSend({ workspaceId: ws.id, accountId: account.id, threadId: t.id, messageId: m.id, from: { name: account.name || ws.name, email: String(account.email).toLowerCase() }, to: m.to ?? [], cc: [], bcc: m.bcc ?? [], subject: t.subject, text: m.body ?? '', html: m.html, files: (m.attachments ?? []).filter((a: any) => a.url).map((a: any) => ({ name: a.name, url: a.url })), tracking: m.trackOptions && m.tracking ? { opens: m.trackOptions.opens !== false, clicks: m.trackOptions.clicks !== false, notify: m.trackOptions.notify !== false, by: null, remindDays: Number(m.trackOptions.remindDays) || 0 } : undefined }, { userId: null, releaseAt: Date.parse(t.sendAt) });
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
        ...(t.due ? msg('Reminder: “{title}”, due {due}', { title: t.title, due: /^\d{4}-\d{2}-\d{2}$/.test(String(t.due)) ? lang.datePhrase(`${t.due}T12:00:00Z`, { tz: 'UTC' }) : String(t.due) }) : msg('Reminder: “{title}”', { title: t.title })),
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
  // Event reminders ("10 minutes before"): one notification to the event's owner, sent again if the event moves.
  const ring = eventReminders(db.allDocs('events') as any[], Date.parse(now));
  if (ring.length) {
    // One date of a repeating event marks its series (the notice opens that date).
    const events = ring.map((e) => ({ ...((e.seriesId ? db.getDoc('events', e.seriesId) : e) as any), remindedFor: e.start })).filter((e) => e.id);
    const notices = ring.map((e) => ({ id: randomBytes(6).toString('hex'), userId: e.userId, workspaceId: e.workspaceId ?? '', kind: 'meeting', ...reminderWords(e, Date.parse(now)), at: now, read: false, link: { app: 'calendar', id: e.id } }));
    db.writeDocs('events', events, [], null);
    db.writeDocs('notices', notices, [], null);
    broadcast('events', events, []);
    broadcast('notices', notices, []);
  }
  // Chat: messages sent later go out, and reminders on saved messages come (server/chatLater.ts).
  try {
    const sent = chatLater.publishDue();
    if (sent.messages.length) (db.writeDocs('messages', sent.messages, [], null), broadcast('messages', sent.messages, []));
    const rem = chatLater.remindersDue(Date.now(), (userId, m) => !!lens(userId)('messages', m));
    if (rem.prefs.length) (db.writeDocs('prefs', rem.prefs, [], null), broadcast('prefs', rem.prefs, []));
    const told = [...sent.notices, ...rem.notices];
    if (told.length) (db.writeDocs('notices', told, [], null), broadcast('notices', told, []));
  } catch (e) {
    console.error('[chat later]', e instanceof Error ? e.message : e);
  }
}, 30_000);

// Notes in Recently deleted for more than 30 days are deleted for good.
const purgeNotes = () => {
  const gone = notesTrash.expiredNotes(db.allDocs('notes') as any[]);
  if (!gone.length) return;
  db.writeDocs('notes', [], gone.map((n) => n.id), null);
  broadcast('notes', [], gone.map((n) => n.id), undefined, gone);
};
setTimeout(purgeNotes, 20_000);
setInterval(purgeNotes, 6 * 3_600_000);
