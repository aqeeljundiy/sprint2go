// Imports (Settings, Import, admins only): a Slack export, a Trello board or a Google Takeout of Drive becomes
// channels and messages, a project with tasks, or folders and files in Drive.
//  1. Upload: streamed to data/imports, capped in size. Refused in the demo company, in read-only companies, and for
//     anyone who isn't an owner or admin there.
//  2. Reading (in the background): the server looks through the upload and works out a preview: what would be
//     made, who's matched to a member here, and what still needs a choice (people, stages, big files).
//  3. The admin picks and starts it. It runs in the background with its progress kept here, so they can leave.
//  4. When it's done (or stopped), they get a notification. For 24 hours, Undo removes exactly what it made: every
//     document, file and membership is recorded as it's made (import_items), before it's written.
// The sources themselves are in importSlack.ts, importTrello.ts and importDrive.ts; zips are read by zip.ts.
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';
import * as billing from './billing.ts';
import * as platform from './platform.ts';
import { ZipError } from './zip.ts';
import { ImportError, limits, mbText, membersOf, roomOf, seatsLeft, type RunCtx } from './importKit.ts';
import { isSandboxId } from '../src/sandbox.ts';
import { SOURCE_NAME, UNDO_HOURS, type ImportChoices, type ImportJob, type ImportPreview, type ImportProgress, type ImportSource, type ImportStatus, type ImportSummary } from '../src/importTypes.ts';
import * as slack from './importSlack.ts';
import * as trello from './importTrello.ts';
import * as drive from './importDrive.ts';
import * as mail from './importMail.ts'; // Gmail (Takeout) or mbox into a mailbox (Mail for teams)
import { mark, msg, phrase, type Msg } from '../src/i18n/index.ts';
import { part, type Said } from './lang.ts';

const MB = 1024 * 1024;
const HOUR = 3_600_000;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, undone_at TEXT, file_name TEXT NOT NULL, file_size INTEGER NOT NULL, preview TEXT, choices TEXT, progress TEXT, summary TEXT, error TEXT);
  CREATE INDEX IF NOT EXISTS imports_ws ON imports (workspace_id, created_at);
  CREATE TABLE IF NOT EXISTS import_items (import_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, extra TEXT);
  CREATE INDEX IF NOT EXISTS import_items_job ON import_items (import_id);
`);

const dir = () => {
  const d = join(db.dataDir, 'imports');
  mkdirSync(d, { recursive: true });
  return d;
};
const uploadPath = (id: string) => join(dir(), id);

/* ---------- what index.ts lends us ---------- */

export interface ImportDeps {
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) => void;
  tell: (userIds: string[], workspaceId: string, kind: string, text: Said, link: { app: string; id?: string }) => void;
  maxUpload: number; // the largest single file (S2G_MAX_UPLOAD_MB)
}
let deps: ImportDeps;

/** At start-up: imports the server was in the middle of are closed (their Undo still works), and old uploads go. */
export function init(d: ImportDeps) {
  deps = d;
  const now = new Date().toISOString();
  db.db.prepare("UPDATE imports SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'").run('The server restarted during the import, so it stopped. Undo removes what it made so far.', now);
  db.db.prepare("UPDATE imports SET status = 'failed', error = ?, finished_at = ? WHERE status = 'reading'").run('The server restarted while reading the file. Upload it again.', now);
  cleanup();
  setInterval(cleanup, HOUR).unref();
}

/** Uploads nobody will use again, previews left for a day, and the records of imports that can't be undone any more. */
export function cleanup() {
  const dayAgo = new Date(Date.now() - 24 * HOUR).toISOString();
  db.db.prepare("UPDATE imports SET status = 'cancelled' WHERE status = 'ready' AND created_at < ?").run(dayAgo);
  const keep = new Set((db.db.prepare("SELECT id FROM imports WHERE status IN ('reading', 'ready', 'running')").all() as { id: string }[]).map((r) => r.id));
  try {
    for (const f of readdirSync(dir())) {
      if (keep.has(f.replace(/\.part$/, ''))) continue;
      // An upload still arriving has no record yet: left alone unless it stopped hours ago.
      if (f.endsWith('.part') && statSync(join(dir(), f)).mtimeMs > Date.now() - 6 * HOUR) continue;
      rmSync(join(dir(), f), { force: true });
    }
  } catch {
    /* nothing there yet */
  }
  const twoDays = new Date(Date.now() - 48 * HOUR).toISOString();
  db.db.prepare("DELETE FROM import_items WHERE import_id IN (SELECT id FROM imports WHERE status IN ('undone', 'cancelled') OR (finished_at IS NOT NULL AND finished_at < ?))").run(twoDays);
  db.db.prepare('DELETE FROM imports WHERE created_at < ?').run(new Date(Date.now() - 30 * 24 * HOUR).toISOString());
}

/* ---------- the record of an import ---------- */

interface Row {
  id: string;
  workspace_id: string;
  source: ImportSource;
  status: ImportStatus;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  undone_at: string | null;
  file_name: string;
  file_size: number;
  preview: string | null;
  choices: string | null;
  progress: string | null;
  summary: string | null;
  error: string | null;
}
const rowOf = (id: string) => db.db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as Row | undefined;
const parse = <T>(s: string | null): T | undefined => (s ? (JSON.parse(s) as T) : undefined);
function setRow(id: string, patch: Partial<Record<keyof Row, string | number | null>>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.db.prepare(`UPDATE imports SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => (patch as any)[k]), id);
}
const undoUntil = (r: Row) => (r.finished_at ? new Date(Date.parse(r.finished_at) + UNDO_HOURS * HOUR).toISOString() : undefined);
const canUndo = (r: Row) => (r.status === 'done' || r.status === 'failed') && !!r.finished_at && Date.parse(undoUntil(r)!) > Date.now() && itemCount(r.id) > 0;
const itemCount = (id: string) => (db.db.prepare('SELECT COUNT(*) AS n FROM import_items WHERE import_id = ?').get(id) as { n: number }).n;

/** What the app sees of an import. The room is worked out again while it waits, so the preview says what's true now. */
function jobOf(r: Row): ImportJob {
  const preview = parse<ImportPreview>(r.preview);
  if (preview && r.status === 'ready') preview.room = roomOf(r.workspace_id);
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    source: r.source,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    undoneAt: r.undone_at ?? undefined,
    fileName: r.file_name,
    fileSize: r.file_size,
    preview,
    choices: parse<ImportChoices>(r.choices),
    progress: parse<ImportProgress>(r.progress),
    summary: parse<ImportSummary>(r.summary),
    error: r.error ?? undefined,
    undoUntil: canUndo(r) ? undoUntil(r) : undefined,
  };
}

const COLORS = ['#5b5bf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

/* ---------- the run: everything a source needs to make things, recorded for Undo ---------- */

const MISSING_LISTED = 300;

async function run(id: string) {
  const r = rowOf(id)!;
  const ws = db.getDoc('workspaces', r.workspace_id) as any;
  const preview = parse<ImportPreview>(r.preview)!;
  const choices = parse<ImportChoices>(r.choices)!;
  const summary: ImportSummary = { made: [], missing: [], missingMore: 0, invited: [] };
  let lastSave = 0;
  const saveProgress = (p: ImportProgress, force = false) => {
    if (!force && Date.now() - lastSave < 400) return;
    lastSave = Date.now();
    setRow(id, { progress: JSON.stringify(p) });
  };
  const record = db.db.prepare('INSERT INTO import_items (import_id, kind, ref, extra) VALUES (?, ?, ?, ?)');
  const items = (list: [string, string, string | null][]) => {
    db.db.exec('BEGIN');
    try {
      for (const [kind, ref, extra] of list) record.run(id, kind, ref, extra);
      db.db.exec('COMMIT');
    } catch (e) {
      db.db.exec('ROLLBACK');
      throw e;
    }
  };
  const ctx: RunCtx = {
    id,
    ws,
    me: r.created_by,
    file: uploadPath(id),
    preview,
    choices,
    people: new Map(),
    add: (coll, docs) => {
      if (!docs.length) return;
      items(docs.map((d) => ['doc', `${coll}\t${d.id}`, null]));
      db.writeDocs(coll, docs, [], r.created_by);
      deps.broadcast(coll, docs, []);
    },
    addFile: (f) => {
      items([['file', f.id, null]]);
      db.recordFile({ id: f.id, workspaceId: ws.id, by: r.created_by, name: f.name, type: f.type, size: f.size });
    },
    progress: (phase, done, total) => saveProgress({ phase, done, total }),
    missing: (name, where, why, kind) => {
      if (summary.missing.length < MISSING_LISTED) summary.missing.push({ name: name.slice(0, 200), where: where.slice(0, 120), why, ...(kind ? { kind } : {}) });
      else summary.missingMore++;
    },
    made: (what, n) => {
      if (n < 0) return; // 0: just keeps its place in the list (the order things are made in)
      const had = summary.made.find((m) => m.what === what);
      if (had) had.n += n;
      else summary.made.push({ what, n });
    },
    room: () => billing.storageRoom(ws.id).left,
    maxFile: () => deps.maxUpload,
    breathe: () => new Promise((res) => setImmediate(res)),
  };
  try {
    // People first: members to invite join now, so what they wrote is theirs.
    resolvePeople(ctx, summary, items);
    if (r.source === 'slack') await slack.run(ctx);
    else if (r.source === 'trello') await trello.run(ctx);
    else if (r.source === 'mail') await mail.run(ctx);
    else await drive.run(ctx);
    setRow(id, { status: 'done', finished_at: new Date().toISOString(), summary: JSON.stringify(summary), progress: null });
    const made = summary.made.filter((m) => m.what !== 'people invited' && m.n > 0);
    const what = made.map((m) => `${m.n.toLocaleString('en')} ${inWords(m.n === 1 ? singular(m.what) : m.what, ws)}`);
    // Each reader sees the counts in their language ("3 channels", "3 channel"): phrases translated when read.
    const counted = made.map((m) => countPhrase(m.n, inWords(m.what, ws)));
    deps.tell([r.created_by], ws.id, 'team', counted.length ? msg('Your {source} import is done: {what}.', { source: SOURCE_NAME[r.source], what: listPhrase(counted) }) : msg('Your {source} import is done.', { source: SOURCE_NAME[r.source] }), { app: 'settings', id: 'import' });
    platform.event('import.done', ws.id, r.created_by, `${r.source}: ${what.join(', ')}`);
  } catch (e) {
    const failure = e instanceof ImportError || e instanceof ZipError ? e.message : mark('Something went wrong on our side.');
    if (!(e instanceof ImportError || e instanceof ZipError)) console.error('[import]', e);
    setRow(id, { status: 'failed', finished_at: new Date().toISOString(), summary: JSON.stringify(summary), error: failure, progress: null });
    const partial = itemCount(id) > 0;
    const why = e instanceof ImportError || e instanceof ZipError ? e.message : phrase('Something went wrong on our side.');
    deps.tell([r.created_by], ws.id, 'team', partial ? msg('Your {source} import stopped: {why} Undo removes what it made so far.', { source: SOURCE_NAME[r.source], why }) : msg('Your {source} import stopped: {why}', { source: SOURCE_NAME[r.source], why }), { app: 'settings', id: 'import' });
  } finally {
    rmSync(uploadPath(id), { force: true });
  }
}

const singular = (w: string) => ({ channels: 'channel', messages: 'message', files: 'file', tasks: 'task', folders: 'folder', projects: 'project', 'direct messages': 'direct message' })[w] ?? w;
/** "project" in the company's own word (Clients, for agencies that say so). */
const inWords = (w: string, ws: any) => (ws?.terms?.word === 'client' ? w.replace(/^project/, 'client') : w);
/** "3 channels" as a phrase translated when read; a word we don't know stays as it is. */
const COUNTED: Record<string, [string, string]> = {
  channels: [mark('1 channel'), mark('{n} channels')],
  messages: [mark('1 message'), mark('{n} messages')],
  files: [mark('1 file'), mark('{n} files')],
  folders: [mark('1 folder'), mark('{n} folders')],
  tasks: [mark('1 task'), mark('{n} tasks')],
  projects: [mark('1 project'), mark('{n} projects')],
  clients: [mark('1 client'), mark('{n} clients')],
  'direct messages': [mark('1 direct message'), mark('{n} direct messages')],
};
const countPhrase = (n: number, words: string): Msg | string => (COUNTED[words] ? phrase(COUNTED[words][n === 1 ? 0 : 1], { n: n.toLocaleString('en') }) : `${n.toLocaleString('en')} ${words}`);
/** "a, b and c" as a phrase: each language joins a list its own way. */
function listPhrase(items: (Msg | string)[]): Msg | string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return phrase('{a} and {b}', { a: items[0], b: items[1] });
  return phrase('{a}, {b}', { a: items[0], b: listPhrase(items.slice(1)) });
}

/**
 * The people choices made real. Matched people are members already. "Invite": a new person joins as a member and
 * gets an invite link (the usual one: valid 7 days, works once); someone who already signs in just joins. "Map":
 * a member picked by the admin. Otherwise their name stays on what they wrote.
 */
function resolvePeople(ctx: RunCtx, summary: ImportSummary, items: (list: [string, string, string | null][]) => void) {
  const ws = db.getDoc('workspaces', ctx.ws.id) as any;
  const memberIds = new Set((ws.members ?? []).map((m: any) => m.userId as string));
  const users = db.allDocs('users') as any[];
  const joining: { userId: string; isNew: boolean }[] = [];
  const newUsers: db.Doc[] = [];
  for (const p of ctx.preview.people) {
    const pick = ctx.choices.people?.[p.key];
    const action = pick?.action ?? (p.match ? 'map' : 'former');
    const mapped = action === 'map' ? (pick?.userId ?? p.match) : undefined;
    if (mapped && memberIds.has(mapped)) {
      ctx.people.set(p.key, { userId: mapped, name: p.name });
      continue;
    }
    if (action === 'invite' && p.canInvite && p.email) {
      const email = p.email.toLowerCase();
      const existing = users.find((u) => String(u.email ?? '').toLowerCase() === email && !u.deletedAt);
      if (existing && memberIds.has(existing.id)) {
        ctx.people.set(p.key, { userId: existing.id, name: existing.name });
        continue;
      }
      if (existing) {
        joining.push({ userId: existing.id, isNew: false });
        summary.invited.push({ name: existing.name, email, link: null });
        ctx.people.set(p.key, { userId: existing.id, name: existing.name });
      } else {
        const u = { id: `u-${randomBytes(6).toString('hex')}`, name: p.name.slice(0, 80) || email.split('@')[0], email, title: '', color: COLORS[newUsers.length % COLORS.length] };
        newUsers.push(u);
        joining.push({ userId: u.id, isNew: true });
        ctx.people.set(p.key, { userId: u.id, name: u.name });
      }
      memberIds.add(ctx.people.get(p.key)!.userId);
      continue;
    }
    ctx.people.set(p.key, { name: p.name });
  }
  if (!joining.length) return;
  const seats = seatsLeft(ws);
  if (seats !== null && joining.length > seats)
    throw new ImportError(`Free covers 5 people, so ${seats === 0 ? 'nobody else' : `only ${seats} more`} can join. Keep the others as names or match them to members, or pick a plan in Settings, Plan & billing.`);
  // Recorded before anything is saved, so Undo always knows.
  items([...newUsers.map((u): [string, string, string | null] => ['user', u.id, null]), ...joining.map((j): [string, string, string | null] => ['member', j.userId, j.isNew ? 'new' : 'existing'])]);
  if (newUsers.length) {
    db.writeDocs('users', newUsers, [], ctx.me);
    deps.broadcast('users', newUsers, []);
  }
  const fresh = db.getDoc('workspaces', ws.id) as any;
  const next = { ...fresh, members: [...fresh.members, ...joining.filter((j) => !fresh.members.some((m: any) => m.userId === j.userId)).map((j) => ({ userId: j.userId, role: 'member' }))] };
  db.writeDocs('workspaces', [next], [], ctx.me);
  deps.broadcast('workspaces', [next], []);
  ctx.ws = next;
  for (const u of newUsers as any[]) summary.invited.push({ name: u.name, email: u.email, link: `/?invite=${db.newInvite(u.id, u.email)}` });
  summary.made.push({ what: 'people invited', n: joining.length });
  platform.event('team.invited', ws.id, ctx.me, `${joining.length} from an import`);
}

/* ---------- undo ---------- */

/** What Undo would also take: things people added since inside what the import made (messages, tasks, files). */
function addedSince(id: string): { coll: string; id: string }[] {
  const docs = (db.db.prepare("SELECT ref FROM import_items WHERE import_id = ? AND kind = 'doc'").all(id) as { ref: string }[]).map((r) => r.ref.split('\t'));
  const mine = new Set(docs.map(([c, i]) => `${c}\t${i}`));
  const channels = new Set(docs.filter(([c]) => c === 'channels').map(([, i]) => i));
  const projects = new Set(docs.filter(([c]) => c === 'clients').map(([, i]) => i));
  const folders = new Set(docs.filter(([c, i]) => c === 'drive' && (db.getDoc('drive', i) as any)?.kind === 'folder').map(([, i]) => i));
  const out: { coll: string; id: string }[] = [];
  if (channels.size) for (const m of db.allDocs('messages') as any[]) if (channels.has(m.channelId) && !mine.has(`messages\t${m.id}`)) out.push({ coll: 'messages', id: m.id });
  if (projects.size) for (const t of db.allDocs('todos') as any[]) if (projects.has(t.clientId) && !mine.has(`todos\t${t.id}`)) out.push({ coll: 'todos', id: t.id });
  if (folders.size) {
    const all = db.allDocs('drive') as any[];
    const byId = new Map(all.map((d) => [String(d.id), d]));
    const under = (d: any) => {
      for (let cur = d, i = 0; cur && i < 40; cur = cur.parentId ? byId.get(String(cur.parentId)) : null, i++) if (cur.parentId && folders.has(String(cur.parentId))) return true;
      return false;
    };
    for (const d of all) if (!mine.has(`drive\t${d.id}`) && under(d)) out.push({ coll: 'drive', id: d.id });
  }
  return out;
}

function undo(id: string, by: string): ImportSummary {
  const r = rowOf(id)!;
  const items = db.db.prepare('SELECT kind, ref, extra FROM import_items WHERE import_id = ?').all(id) as { kind: string; ref: string; extra: string | null }[];
  const since = addedSince(id);
  const byColl = new Map<string, string[]>();
  for (const it of items)
    if (it.kind === 'doc') {
      const [coll, docId] = it.ref.split('\t');
      (byColl.get(coll) ?? byColl.set(coll, []).get(coll)!).push(docId);
    }
  for (const s of since) (byColl.get(s.coll) ?? byColl.set(s.coll, []).get(s.coll)!).push(s.id);
  let removed = 0;
  // Messages, tasks and files first, then the channels, projects and folders that held them.
  const order = ['messages', 'todos', 'drive', 'channels', 'clients'];
  const colls = [...byColl.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  // Files that came with the import, and files on what's removed now (attachments of messages added since).
  const fileIds = new Set(items.filter((it) => it.kind === 'file').map((it) => it.ref));
  for (const coll of colls) {
    const ids = byColl.get(coll)!;
    for (let i = 0; i < ids.length; i += 500) {
      const docs = ids
        .slice(i, i + 500)
        .map((x) => db.getDoc(coll, x))
        .filter(Boolean) as db.Doc[];
      if (!docs.length) continue;
      db.writeDocs(
        coll,
        [],
        docs.map((d) => d.id),
        by,
      );
      deps.broadcast(
        coll,
        [],
        docs.map((d) => d.id),
        undefined,
        docs,
      );
      removed += docs.length;
    }
  }
  for (const f of fileIds) {
    db.db.prepare('DELETE FROM files WHERE id = ? AND workspace_id = ?').run(f, r.workspace_id);
    rmSync(db.filePath(f), { force: true });
  }
  // People: memberships the import added go, and new people who haven't signed in yet go with their invite links.
  // Someone who already accepted is kept (they're using the app now).
  const kept: string[] = [];
  const leave = new Set<string>();
  const goneUsers: db.Doc[] = [];
  for (const it of items.filter((x) => x.kind === 'member')) {
    const u = db.getDoc('users', it.ref) as any;
    if (it.extra === 'new' && db.hasLogin(it.ref)) {
      kept.push(String(u?.name ?? 'Someone'));
      continue;
    }
    leave.add(it.ref);
    if (it.extra === 'new' && u && items.some((x) => x.kind === 'user' && x.ref === it.ref)) {
      goneUsers.push(u);
      db.db.prepare('DELETE FROM invites WHERE user_id = ?').run(it.ref);
    }
  }
  if (leave.size) {
    const ws = db.getDoc('workspaces', r.workspace_id) as any;
    if (ws) {
      const next = { ...ws, members: ws.members.filter((m: any) => !leave.has(m.userId) || m.role === 'owner') };
      db.writeDocs('workspaces', [next], [], by);
      deps.broadcast('workspaces', [next], []);
    }
  }
  if (goneUsers.length) {
    db.writeDocs(
      'users',
      [],
      goneUsers.map((u) => u.id),
      by,
    );
    deps.broadcast(
      'users',
      [],
      goneUsers.map((u) => u.id),
      undefined,
      goneUsers,
    );
  }
  const summary = { ...(parse<ImportSummary>(r.summary) ?? { made: [], missing: [], missingMore: 0, invited: [] }), removed: removed + fileIds.size, kept };
  setRow(id, { status: 'undone', undone_at: new Date().toISOString(), summary: JSON.stringify(summary) });
  db.db.prepare('DELETE FROM import_items WHERE import_id = ?').run(id);
  platform.event('import.undone', r.workspace_id, by, `${r.source}: ${removed} removed`);
  return summary;
}

/* ---------- the routes ---------- */

export interface HandleCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  me: string;
  operator: string | null;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: (req: IncomingMessage) => Promise<any>;
}

const SOURCES: ImportSource[] = ['slack', 'trello', 'drive', 'mail'];

/** Who may import into a company: its owners and admins, never in the demo company, never while it's read-only. */
function allowed(me: string, wsId: string, change: boolean, operator: string | null): { ws: any } | { status: number; error: string } {
  if (isSandboxId(wsId)) return { status: 403, error: mark('The demo company doesn’t take imports: nothing is uploaded there. Import into your real company.') };
  const ws = db.getDoc('workspaces', wsId) as any;
  const role = ws?.members?.find((m: any) => m.userId === me)?.role;
  if (!ws || !role) return { status: 404, error: mark('No such company.') };
  if (role === 'member') return { status: 403, error: mark('Only owners and admins can import.') };
  if (change && operator) return { status: 403, error: mark('That’s theirs to do: you’re signed in as them.') };
  const ro = change ? billing.readOnlyWhy(ws) : null;
  if (ro) return { status: 403, error: ro };
  return { ws };
}

export async function handle(p: string, c: HandleCtx): Promise<boolean> {
  if (p !== '/api/import' && !p.startsWith('/api/import/')) return false;
  const { req, res, url, me, json } = c;
  const deny = (a: { status: number; error: string }) => (json(res, a.status, { error: a.error }), true);

  // The company's imports from the last two weeks (the one going on first).
  if (p === '/api/import' && req.method === 'GET') {
    const wsId = String(url.searchParams.get('workspaceId') ?? '');
    const a = allowed(me, wsId, false, c.operator);
    if ('error' in a) return deny(a);
    const since = new Date(Date.now() - 14 * 24 * HOUR).toISOString();
    const rows = db.db.prepare("SELECT * FROM imports WHERE workspace_id = ? AND created_at > ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 12").all(wsId, since) as unknown as Row[];
    json(res, 200, { jobs: rows.map(jobOf), limits: { upload: limits().upload, json: limits().json } });
    return true;
  }

  // The upload: streamed to disk, capped, then read in the background.
  if (p === '/api/import/upload' && req.method === 'POST') {
    const wsId = String(url.searchParams.get('workspaceId') ?? '');
    const source = String(url.searchParams.get('source') ?? '') as ImportSource;
    const a = allowed(me, wsId, true, c.operator);
    if ('error' in a) return (req.resume(), deny(a));
    if (!SOURCES.includes(source)) return (req.resume(), json(res, 400, { error: mark('Import from Slack, Trello, Google Drive or Gmail.') }), true);
    const busy = db.db.prepare("SELECT id FROM imports WHERE workspace_id = ? AND status IN ('reading', 'running')").get(wsId);
    if (busy) return (req.resume(), json(res, 409, { error: mark('Another import is going on in this company. Wait for it to finish, then start this one.') }), true);
    const cap = source === 'trello' ? Math.min(limits().upload, limits().json) : limits().upload;
    const capText = `Exports up to ${Math.round(cap / MB).toLocaleString('en')} MB.`;
    if (Number(req.headers['content-length'] ?? 0) > cap) return (req.resume(), json(res, 413, { error: `That file is too big. ${capText}` }), true);
    const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'export')).slice(0, 200);
    const id = randomBytes(12).toString('hex');
    const part = `${uploadPath(id)}.part`;
    const out = createWriteStream(part);
    let size = 0;
    let over = false;
    try {
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > cap) {
          over = true;
          break;
        }
        if (!out.write(chunk)) await once(out, 'drain');
      }
    } catch {
      over = true;
    } finally {
      await new Promise<void>((done) => out.end(done));
    }
    if (over || !size) {
      rmSync(part, { force: true });
      json(res, over ? 413 : 400, { error: over ? `That file is too big. ${capText}` : 'That file is empty.' });
      return true;
    }
    renameSync(part, uploadPath(id));
    // A preview nobody started gives way to the new upload.
    for (const old of db.db.prepare("SELECT id FROM imports WHERE workspace_id = ? AND status = 'ready'").all(wsId) as { id: string }[]) {
      setRow(old.id, { status: 'cancelled' });
      rmSync(uploadPath(old.id), { force: true });
    }
    const now = new Date().toISOString();
    db.db
      .prepare('INSERT INTO imports (id, workspace_id, source, status, created_by, created_at, file_name, file_size, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, wsId, source, 'reading', me, now, name, size, JSON.stringify({ phase: 'Reading the file', done: 0, total: 1 }));
    void read(id);
    json(res, 200, { job: jobOf(rowOf(id)!) });
    return true;
  }

  const m = p.match(/^\/api\/import\/([a-f0-9]{24})(?:\/(start|cancel|undo))?$/);
  if (!m) return (json(res, 404, { error: mark('No such import.') }), true);
  const r = rowOf(m[1]);
  // Someone who isn't an admin of its company finds nothing here.
  const a = r ? allowed(me, r.workspace_id, req.method !== 'GET', c.operator) : null;
  if (!r || !a || ('error' in a && a.status === 404)) return (json(res, 404, { error: mark('No such import.') }), true);
  if ('error' in a) return deny(a);

  if (!m[2] && req.method === 'GET') return (json(res, 200, { job: jobOf(r) }), true);

  if (m[2] === 'cancel' && req.method === 'POST') {
    if (r.status !== 'ready' && r.status !== 'reading') return (json(res, 409, { error: r.status === 'running' ? 'It’s already running. Wait for it to finish, then undo it.' : 'It isn’t waiting to start.' }), true);
    setRow(r.id, { status: 'cancelled' });
    rmSync(uploadPath(r.id), { force: true });
    return (json(res, 200, { job: jobOf(rowOf(r.id)!) }), true);
  }

  if (m[2] === 'start' && req.method === 'POST') {
    if (r.status !== 'ready') return (json(res, 409, { error: r.status === 'running' ? 'It’s already running.' : 'This import can’t start again. Upload the file again.' }), true);
    const busy = db.db.prepare("SELECT id FROM imports WHERE workspace_id = ? AND status = 'running'").get(r.workspace_id);
    if (busy) return (json(res, 409, { error: mark('Another import is going on in this company. Wait for it to finish.') }), true);
    if (!existsSync(uploadPath(r.id))) return (json(res, 409, { error: mark('The uploaded file is gone. Upload it again.') }), true);
    const b = await c.body(req);
    let choices: ImportChoices;
    try {
      choices = checkChoices(a.ws, parse<ImportPreview>(r.preview)!, b?.choices);
    } catch (e) {
      return (json(res, 400, { error: e instanceof ImportError ? e.message : 'Those choices don’t work.' }), true);
    }
    setRow(r.id, { status: 'running', started_at: new Date().toISOString(), choices: JSON.stringify(choices), progress: JSON.stringify({ phase: 'Starting', done: 0, total: 1 }) });
    void run(r.id);
    return (json(res, 200, { job: jobOf(rowOf(r.id)!) }), true);
  }

  if (m[2] === 'undo' && req.method === 'GET') return (json(res, 200, { since: canUndo(r) ? addedSince(r.id).length : 0 }), true);
  if (m[2] === 'undo' && req.method === 'POST') {
    if (!canUndo(r))
      return (
        json(res, 409, {
          error: r.status === 'undone' ? 'It was already undone.' : r.status === 'running' ? 'It’s still running. Undo it once it’s done.' : `Imports can be undone for ${UNDO_HOURS} hours after they finish.`,
        }),
        true
      );
    undo(r.id, me);
    return (json(res, 200, { job: jobOf(rowOf(r.id)!) }), true);
  }
  json(res, 404, { error: mark('No such import.') });
  return true;
}

/** Reading the upload into a preview, in the background. */
async function read(id: string) {
  const r = rowOf(id)!;
  const ws = db.getDoc('workspaces', r.workspace_id) as any;
  const progress = (phase: string, done: number, total: number) => setRow(id, { progress: JSON.stringify({ phase, done, total }) });
  try {
    const at = { file: uploadPath(id), ws, me: r.created_by, progress, members: membersOf(ws), seats: seatsLeft(ws), room: roomOf(ws.id) };
    const preview = r.source === 'slack' ? await slack.analyze(at) : r.source === 'trello' ? await trello.analyze(at) : r.source === 'mail' ? await mail.analyze(at) : await drive.analyze(at);
    if (rowOf(id)?.status !== 'reading') return; // cancelled meanwhile
    setRow(id, { status: 'ready', preview: JSON.stringify(preview), progress: null });
  } catch (e) {
    const msg = e instanceof ImportError || e instanceof ZipError ? e.message : 'We couldn’t read this file. Check it’s the export itself, not a different file.';
    if (!(e instanceof ImportError || e instanceof ZipError)) console.error('[import read]', e);
    setRow(id, { status: 'failed', error: msg, progress: null, finished_at: new Date().toISOString() });
    rmSync(uploadPath(id), { force: true });
  }
}

/** The admin's choices, cleaned: only members, stages, projects and keys that exist; nothing else gets through. */
function checkChoices(ws: any, preview: ImportPreview, raw: any): ImportChoices {
  const memberIds = new Set((ws.members ?? []).map((m: any) => m.userId as string));
  const people: ImportChoices['people'] = {};
  let invites = 0;
  for (const p of preview.people) {
    const c = raw?.people?.[p.key];
    const action = c?.action === 'invite' || c?.action === 'map' || c?.action === 'former' ? c.action : p.match ? 'map' : p.suggested;
    if (action === 'map') {
      const userId = typeof c?.userId === 'string' ? c.userId : p.match;
      if (!userId || !memberIds.has(userId)) throw new ImportError(`Pick who ${p.name} is here, or keep them as a name.`);
      people[p.key] = { action, userId };
    } else if (action === 'invite') {
      if (!p.canInvite) throw new ImportError(`${p.name} can’t be invited: there’s no email for them in the export.`);
      people[p.key] = { action };
      invites++;
    } else people[p.key] = { action: 'former' };
  }
  const seats = seatsLeft(ws);
  if (seats !== null && invites > seats)
    throw new ImportError(`Free covers 5 people, so ${seats === 0 ? 'nobody else' : `only ${seats} more`} can join. Keep the others as names or match them to members, or pick a plan in Settings, Plan & billing.`);
  const out: ImportChoices = { people, big: !!raw?.big };
  if (preview.source === 'slack') {
    const keys = new Set((preview.channels ?? []).map((ch) => ch.key));
    out.leaveOut = Array.isArray(raw?.leaveOut) ? raw.leaveOut.filter((k: unknown) => typeof k === 'string' && keys.has(k)) : [];
    if (out.leaveOut!.length === keys.size && keys.size) throw new ImportError('Pick at least one channel to bring in.');
  }
  if (preview.source === 'trello') {
    const stages = trello.stagesOf(ws);
    const ids = new Set(stages.map((s) => s.id));
    out.stages = {};
    for (const l of preview.lists ?? []) {
      const s = raw?.stages?.[l.key];
      out.stages[l.key] = typeof s === 'string' && ids.has(s) ? s : ids.has(l.suggested) ? l.suggested : stages[0].id;
    }
    const pid = typeof raw?.projectId === 'string' ? raw.projectId : '';
    if (pid) {
      const pr = db.getDoc('clients', pid) as any;
      if (!pr || pr.workspaceId !== ws.id) throw new ImportError(`That ${ws.terms?.word === 'client' ? 'client' : 'project'} isn’t in this company any more. Pick another, or make a new one.`);
      out.projectId = pid;
    }
    out.archived = !!raw?.archived;
  }
  if (preview.source === 'mail') {
    const id = typeof raw?.mailbox === 'string' ? raw.mailbox : '';
    if (!preview.mail?.mailboxes.some((m) => m.id === id) || !(ws.accounts ?? []).some((a: any) => a.id === id)) throw new ImportError('Pick the mailbox the mail goes into.');
    out.mailbox = id;
  }
  if (preview.source === 'drive') {
    const d = preview.drive!;
    const need = d.bytes - (out.big ? 0 : d.bigBytes);
    const room = roomOf(ws.id);
    if (need > room.left)
      throw new ImportError(
        `It doesn’t fit: these files take ${mbText(need)} and the company has ${mbText(room.left)} left of its ${mbText(room.total)}. ${d.big && out.big ? 'Leave out the big files, or a' : 'A'}n owner can add more in Settings, Plan & billing.`,
      );
  }
  return out;
}
