// Talks to the local server (server/index.ts) when the app is served by it or proxied to it:
// loads everything on sign-in, saves each change as it happens, and applies other people's changes live.
// Without a server (the standalone demo file) none of this runs and data stays in memory.
import { RECORD_KEYS, type Collections, type CollectionKey } from './seed';

type Doc = { id: string; [k: string]: unknown };

export const server = { on: false, conn: '' };
/** What the server has, per collection, by id (object identity tells what changed locally). */
const synced: Partial<Record<CollectionKey, Map<string, unknown>>> = {};
const timers: Partial<Record<CollectionKey, ReturnType<typeof setTimeout>>> = {};
const latest: Partial<Record<CollectionKey, unknown>> = {};

const isRecord = (k: CollectionKey) => RECORD_KEYS.includes(k);
const toDocs = (k: CollectionKey, v: unknown): Doc[] => (isRecord(k) ? Object.entries(v as Record<string, unknown>).map(([id, value]) => ({ id, value })) : (v as Doc[]));
const fromDocs = (k: CollectionKey, docs: Doc[]) => (isRecord(k) ? Object.fromEntries(docs.map((d) => [d.id, d.value])) : docs);
const remember = (k: CollectionKey, docs: Doc[]) => (synced[k] = new Map(docs.map((d) => [d.id, d])));

/** Is there a local server, and is someone signed in? */
export async function probe(): Promise<'none' | 'signed-out' | { me: string }> {
  if (!location.protocol.startsWith('http')) return 'none';
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) return 'signed-out';
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return 'none';
    return (await r.json()) as { me: string };
  } catch {
    return 'none';
  }
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return r.ok ? null : ((await r.json().catch(() => null))?.error ?? 'Could not sign in.');
}
export const signOut = () => fetch('/api/logout', { method: 'POST' }).then(() => location.reload());
export async function changePassword(current: string, next: string): Promise<string | null> {
  const r = await fetch('/api/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current, next }) });
  return r.ok ? null : ((await r.json().catch(() => null))?.error ?? 'Could not change the password.');
}

/** Loads everything this person can see, then starts listening for changes. */
export async function connect(apply: <K extends CollectionKey>(k: K, v: Collections[K]) => void) {
  const load = async () => {
    const state = (await (await fetch('/api/state')).json()) as Record<CollectionKey, Doc[]>;
    for (const k of Object.keys(state) as CollectionKey[]) {
      remember(k, state[k]);
      apply(k, fromDocs(k, state[k]) as Collections[typeof k]);
    }
  };
  await load();
  server.on = true;
  let first = true;
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => {
    server.conn = JSON.parse((e as MessageEvent).data).conn;
    if (!first) void load(); // reconnected: catch up on anything missed
    first = false;
  });
  es.addEventListener('signal', (e) => window.dispatchEvent(new CustomEvent('s2g:signal', { detail: JSON.parse((e as MessageEvent).data) })));
  es.addEventListener('change', (e) => {
    const { coll, upserts, deletes } = JSON.parse((e as MessageEvent).data) as { coll: CollectionKey; upserts: Doc[]; deletes: string[] };
    const base = synced[coll] ?? new Map();
    // Start from what's on screen (it may hold local changes not sent yet).
    const current = new Map(toDocs(coll, latest[coll] ?? fromDocs(coll, [...base.values()] as Doc[])).map((d) => [d.id, d]));
    for (const d of upserts) {
      current.set(d.id, d);
      base.set(d.id, d);
    }
    for (const id of deletes) {
      current.delete(id);
      base.delete(id);
    }
    synced[coll] = base;
    const docs = [...current.values()];
    latest[coll] = fromDocs(coll, docs);
    apply(coll, latest[coll] as Collections[typeof coll]);
  });
}

/** Called on every local change: sends only what changed, a moment later (several quick edits go together). */
export function pushChange<K extends CollectionKey>(k: K, value: Collections[K]) {
  latest[k] = value;
  if (!server.on) return;
  clearTimeout(timers[k]);
  timers[k] = setTimeout(() => {
    const docs = toDocs(k, latest[k]);
    const before = synced[k] ?? new Map();
    const now = new Map(docs.map((d) => [d.id, d]));
    const upserts = docs.filter((d) => before.get(d.id) !== d && (!isRecord(k) || JSON.stringify(before.get(d.id)) !== JSON.stringify(d)));
    const deletes = [...before.keys()].filter((id) => !now.has(id));
    synced[k] = now;
    if (!upserts.length && !deletes.length) return;
    void fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-conn': server.conn }, body: JSON.stringify({ coll: k, upserts, deletes }) }).catch(() => {
      synced[k] = before; // try again with the next change
    });
  }, 250);
}

/** Sends a huddle note (offer, answer, candidate) to one person; it reaches them through their live connection. */
export function sendSignal(to: string, data: unknown) {
  if (!server.on) return;
  void fetch('/api/signal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, data }) }).catch(() => {});
}
