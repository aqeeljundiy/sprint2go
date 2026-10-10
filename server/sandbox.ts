// Everyone's own demo company (src/sandbox.ts says what it is). Kept apart from the real companies on purpose: its
// documents live in their own table, keyed by the person they belong to, so nothing that reads the real documents
// (db.allDocs: the jobs, the mail engine, digests, summaries, push, retention, billing, every operator number) ever
// sees them. Only their owner reads and writes them, through /api/state, /api/sync and /api/sandbox.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as db from './db.ts';
import { seed, type CollectionKey } from '../src/seed.ts';
import { buildSandbox, isSandboxId, sandboxWsId, TRY_KEYS, type DemoState, type SandboxMark } from '../src/sandbox.ts';
import { isZone } from '../src/jobTimes.ts';
import { mark } from '../src/i18n/index.ts';

type Doc = db.Doc;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS sandbox_docs (owner TEXT NOT NULL, coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner, coll, id));
  CREATE TABLE IF NOT EXISTS sandboxes (owner TEXT PRIMARY KEY, created_at TEXT NOT NULL, used_at TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
`);

/** A demo company nobody opened for this long goes (it's made again, fresh, the next time they open it). */
export const KEEP_DAYS = 30;
/** One document (a voice note or a small file kept inline) and a whole demo company, at most. */
const MAX_DOC = 3_000_000;
const MAX_TOTAL = 25_000_000;
const DAY = 86_400_000;

export interface SandboxRow {
  owner: string;
  createdAt: string;
  usedAt: string;
  hidden: boolean;
}

export function info(owner: string): SandboxRow | null {
  const r = db.db.prepare('SELECT owner, created_at, used_at, hidden FROM sandboxes WHERE owner = ?').get(owner) as { owner: string; created_at: string; used_at: string; hidden: number } | undefined;
  return r ? { owner: r.owner, createdAt: r.created_at, usedAt: r.used_at, hidden: !!r.hidden } : null;
}

/** Where someone's demo company stands, for the app. */
export function stateOf(owner: string, allowed: boolean): DemoState {
  const row = info(owner);
  return { allowed, state: !row ? 'none' : row.hidden ? 'hidden' : 'on' };
}

/** All of someone's demo company, by collection (records like statuses as { id, value } documents, as stored). */
export function docsOf(owner: string): Record<string, Doc[]> {
  const out: Record<string, Doc[]> = {};
  for (const r of db.db.prepare('SELECT coll, data FROM sandbox_docs WHERE owner = ? ORDER BY rowid').all(owner) as { coll: string; data: string }[]) (out[r.coll] ??= []).push(JSON.parse(r.data));
  return out;
}
export function getDoc(owner: string, coll: string, id: string): Doc | undefined {
  const r = db.db.prepare('SELECT data FROM sandbox_docs WHERE owner = ? AND coll = ? AND id = ?').get(owner, coll, id) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
const bytesOf = (owner: string) => Number((db.db.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM sandbox_docs WHERE owner = ?').get(owner) as { n: number }).n);

const upsert = db.db.prepare('INSERT INTO sandbox_docs (owner, coll, id, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at');
const remove1 = db.db.prepare('DELETE FROM sandbox_docs WHERE owner = ? AND coll = ? AND id = ?');
function tx(fn: () => void) {
  db.db.exec('BEGIN');
  try {
    fn();
    db.db.exec('COMMIT');
  } catch (e) {
    db.db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * The demo data made right now in the person's time zone: a short-lived process (server/sandboxSeed.ts) with only TZ
 * and PATH in its environment. If that can't run, the data this server made when it started (its dates are older).
 */
let running = 0;
function freshSeed(tz: string): Promise<ReturnType<typeof seed>> {
  const fallback = () => seed();
  if (running >= 3) return Promise.resolve(fallback());
  running++;
  return new Promise<ReturnType<typeof seed>>((resolve) => {
    const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./register.mjs', import.meta.url)), fileURLToPath(new URL('./sandboxSeed.ts', import.meta.url))], {
      env: { PATH: process.env.PATH ?? '', TZ: tz, NODE_ENV: process.env.NODE_ENV ?? '' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let done = false;
    const end = (value: ReturnType<typeof seed> | null) => {
      if (done) return;
      done = true;
      running--;
      clearTimeout(timer);
      if (!value) console.error('[sandbox] the demo data could not be made fresh; using the copy from start-up');
      resolve(value ?? fallback());
    };
    const timer = setTimeout(() => (child.kill('SIGKILL'), end(null)), 20_000);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', () => end(null));
    child.on('close', (code) => {
      if (code !== 0) return end(null);
      try {
        end(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        end(null);
      }
    });
  });
}

const making = new Map<string, Promise<void>>();
/** Makes (or makes again, for Reset) someone's demo company from the demo data. Shown in their switcher. */
export function make(owner: string, person: { name: string }, tz?: string): Promise<void> {
  const busy = making.get(owner);
  if (busy) return busy;
  const job = (async () => {
    const data = await freshSeed(isZone(tz) ? tz : 'UTC');
    const now = new Date().toISOString();
    const built = buildSandbox(data, { id: owner, name: person.name || 'You' }, now);
    tx(() => {
      db.db.prepare('DELETE FROM sandbox_docs WHERE owner = ?').run(owner);
      for (const [coll, docs] of Object.entries(built)) for (const d of docs) upsert.run(owner, coll, String(d.id), JSON.stringify(d), now);
      db.db.prepare('INSERT INTO sandboxes (owner, created_at, used_at, hidden) VALUES (?, ?, ?, 0) ON CONFLICT (owner) DO UPDATE SET created_at = excluded.created_at, used_at = excluded.used_at, hidden = 0').run(owner, now, now);
    });
  })().finally(() => making.delete(owner));
  making.set(owner, job);
  return job;
}

/**
 * Demo companies copied from older demo data (the sample used a real agency's names until 10 Oct 2026): made again from
 * today's data, so nobody keeps seeing the old names. Returns how many were remade.
 */
export function refreshStale(nameOf: (owner: string) => { name: string; tz?: string }): number {
  const stale = db.db.prepare("SELECT DISTINCT owner FROM sandbox_docs WHERE (coll = 'workspaces' AND (data LIKE '%Pixel & Profits%' OR data LIKE '%pixelandprofits%' OR data LIKE '%Elkiya%' OR data LIKE '%sprint2go Studio%')) OR (coll IN ('users', 'clients') AND (data LIKE '%Hartono%' OR data LIKE '%Anindita%' OR data LIKE '%Kusnadi%'))").all() as { owner: string }[];
  for (const { owner } of stale) {
    const p = nameOf(owner);
    void make(owner, { name: p.name }, p.tz).catch((e) => console.error('[sandbox]', e instanceof Error ? e.message : e));
  }
  return stale.length;
}

/** Gone, with everything in it (account deleted, or cleaned up). */
export function remove(owner: string) {
  tx(() => {
    db.db.prepare('DELETE FROM sandbox_docs WHERE owner = ?').run(owner);
    db.db.prepare('DELETE FROM sandboxes WHERE owner = ?').run(owner);
  });
}

/** Hidden: out of the switcher, kept until the cleanup. Shown again: back, as it was. */
export function setHidden(owner: string, hidden: boolean) {
  db.db.prepare('UPDATE sandboxes SET hidden = ?, used_at = ? WHERE owner = ?').run(hidden ? 1 : 0, new Date().toISOString(), owner);
}

const touched = new Map<string, number>();
/** Someone used their demo company (at most one write every ten minutes). */
export function touch(owner: string) {
  const now = Date.now();
  if ((touched.get(owner) ?? 0) > now - 10 * 60_000) return;
  touched.set(owner, now);
  db.db.prepare('UPDATE sandboxes SET used_at = ? WHERE owner = ?').run(new Date(now).toISOString(), owner);
}

/** Demo companies nobody opened for `days` go. Returns whose went. */
export function cleanup(days = KEEP_DAYS): string[] {
  const before = new Date(Date.now() - days * DAY).toISOString();
  const old = (db.db.prepare('SELECT owner FROM sandboxes WHERE used_at < ?').all(before) as { owner: string }[]).map((r) => r.owner);
  for (const owner of old) remove(owner);
  return old;
}

/** For the operators' Platform page only: how many there are, how many were used this week, and the room they take. */
export function stats() {
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const r = db.db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN used_at >= ? THEN 1 ELSE 0 END), 0) AS week FROM sandboxes').get(weekAgo) as { total: number; week: number };
  const bytes = Number((db.db.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM sandbox_docs').get() as { n: number }).n);
  return { total: Number(r.total), activeWeek: Number(r.week), bytes, keepDays: KEEP_DAYS };
}

/**
 * Whether a document someone's app sent belongs in their demo company: one already there, or a new one inside it (by
 * its company, or its channel, table, mailbox or calendar there). Real documents with the same id never do.
 */
export function belongs(owner: string, coll: string, d: Doc, realExists: boolean): boolean {
  if (getDoc(owner, coll, d.id)) return true;
  if (realExists) return false;
  const wsId = sandboxWsId(owner);
  const any = d as Record<string, unknown>;
  if (coll === 'workspaces') return d.id === wsId;
  if (any.workspaceId === wsId) return true;
  if (coll === 'messages') return !!getDoc(owner, 'channels', String(any.channelId ?? ''));
  if (coll === 'rows') return !!getDoc(owner, 'tables', String(any.tableId ?? ''));
  if (coll === 'events') return !!getDoc(owner, 'calendars', String(any.calendarId ?? ''));
  if (coll === 'threads') {
    const ws = getDoc(owner, 'workspaces', wsId) as { accounts?: { id: string }[] } | undefined;
    return !!ws?.accounts?.some((a) => a.id === any.accountId);
  }
  // A new person or anything else with a demo id belongs nowhere else either (and isn't made here).
  return isSandboxId(d.id) && d.id.startsWith(`${wsId}-`);
}

/**
 * The owner changes anything inside their demo company. What stays the server's: whose it is and when it was made,
 * the owner's own seat, that nothing moves out of it into a real company, no new people, and its size.
 */
export function write(owner: string, coll: CollectionKey | string, upserts: Doc[], deletes: string[]): { saved: Doc[]; deleted: string[]; refused: string[]; why?: string } {
  const wsId = sandboxWsId(owner);
  const saved: Doc[] = [];
  const refused: string[] = [];
  let why: string | undefined;
  let room = MAX_TOTAL - bytesOf(owner);
  const now = new Date().toISOString();
  for (const raw of upserts) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length > 200) continue;
    const before = getDoc(owner, coll, raw.id) as Record<string, unknown> | undefined;
    let d = raw as Record<string, unknown>;
    if (coll === 'workspaces') {
      if (raw.id !== wsId || !before) {
        refused.push(raw.id);
        continue;
      }
      const was = before.sandbox as SandboxMark;
      const asked = (d.sandbox ?? {}) as Partial<SandboxMark>;
      const tried = Array.isArray(asked.tried) ? [...new Set(asked.tried.filter((k) => TRY_KEYS.includes(k)))] : was.tried;
      const members = (Array.isArray(d.members) ? (d.members as { userId: string; role: string }[]) : []).filter((m) => m && typeof m.userId === 'string' && m.userId !== owner);
      d = { ...d, sandbox: { owner, createdAt: was.createdAt, tried, listOff: !!asked.listOff }, members: [{ userId: owner, role: 'owner' }, ...members], createdAt: before.createdAt };
    } else if (coll === 'users' && !before) {
      refused.push(raw.id); // the people in it are the demo's own; nobody new comes in
      continue;
    } else if ((before && 'workspaceId' in before && d.workspaceId !== before.workspaceId) || (!before && typeof d.workspaceId === 'string' && d.workspaceId !== wsId)) {
      refused.push(raw.id); // nothing moves between the demo company and a real one
      continue;
    }
    const json = JSON.stringify(d);
    const grow = json.length - (before ? JSON.stringify(before).length : 0);
    if (json.length > MAX_DOC || grow > room) {
      why = mark('The demo company keeps only small files. Reset it from the bar at the top to start fresh.');
      refused.push(raw.id);
      continue;
    }
    room -= grow;
    saved.push(d as Doc);
  }
  const deleted = deletes.filter((id) => typeof id === 'string' && !(coll === 'workspaces' && id === wsId) && !!getDoc(owner, coll, id));
  tx(() => {
    for (const d of saved) upsert.run(owner, coll, d.id, JSON.stringify(d), now);
    for (const id of deleted) remove1.run(owner, coll, id);
  });
  if (saved.length || deleted.length) touch(owner);
  return { saved, deleted, refused, why };
}
