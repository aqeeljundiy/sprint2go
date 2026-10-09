// Talks to the local server (server/index.ts) when the app is served by it or proxied to it:
// loads everything on sign-in, saves each change as it happens, and applies other people's changes live.
// Without a server (the standalone demo file) none of this runs and data stays in memory.
import { RECORD_KEYS, type Collections, type CollectionKey } from './seed';
import { startPresence } from './presence';
import { askBigFile } from './components/BigFileDialog';
import { store } from './store';
import { isSandboxId, type DemoState } from './sandbox';
import { t } from './i18n';

type Doc = { id: string; [k: string]: unknown };

// operator: may open /admin; flags: features switched on from the backend; demo: this person's own demo company
// (src/sandbox.ts), null without a server.
export const server = { on: false, conn: '', operator: false, flags: [] as string[], demo: null as DemoState | null };
export const hasFlag = (key: string) => server.flags.includes(key);
/** This server's mail name and address (for the records a company adds), and whether Boosted sending exists here. */
export const mailInfo = { host: '', ip: '', boosted: false };
export const loadMailInfo = () =>
  fetch('/api/brand')
    .then((r) => (r.ok ? r.json() : {}))
    .then((b: { mailHost?: string; mailIp?: string; boosted?: boolean }) => Object.assign(mailInfo, { host: b.mailHost ?? '', ip: b.mailIp ?? '', boosted: !!b.boosted }))
    .catch(() => {});
/** What the server has, per collection, by id (object identity tells what changed locally). */
const synced: Partial<Record<CollectionKey, Map<string, unknown>>> = {};
const timers: Partial<Record<CollectionKey, ReturnType<typeof setTimeout>>> = {};
const latest: Partial<Record<CollectionKey, unknown>> = {};

const isRecord = (k: CollectionKey) => RECORD_KEYS.includes(k);
const toDocs = (k: CollectionKey, v: unknown): Doc[] => (isRecord(k) ? Object.entries(v as Record<string, unknown>).map(([id, value]) => ({ id, value })) : (v as Doc[]));
const fromDocs = (k: CollectionKey, docs: Doc[]) => (isRecord(k) ? Object.fromEntries(docs.map((d) => [d.id, d.value])) : docs);
const remember = (k: CollectionKey, docs: Doc[]) => (synced[k] = new Map(docs.map((d) => [d.id, d])));

/** Is there a local server, and is someone signed in? */
export interface Session {
  me: string;
  actingAs?: string; // an operator is looking at the app as this person
  operator?: boolean; // this person may open the operator backend
  suspended?: { at: string; by: string; reason: string }; // this account can't do anything
  suspendedIn?: { id: string; name: string; reason: string }[]; // companies that are read-only right now
  maintenance?: string; // changes are paused, with this message
  flags?: string[]; // feature flags on for this person's companies
  demo?: DemoState; // their own demo company: allowed, and not made yet, open or hidden
  /** Two-step sign-in still to do before the app opens: a code from the app, or setting it up (a company requires it). */
  twoStep?: 'code' | 'setup';
  email?: string; // shown on the two-step screen
  companies?: string[]; // the companies that require two-step sign-in
}
export async function probe(): Promise<'none' | 'signed-out' | Session> {
  if (!location.protocol.startsWith('http')) return 'none';
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) return 'signed-out';
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return 'none';
    return (await r.json()) as Session;
  } catch {
    return 'none';
  }
}

/** Password sign-in. The answer says when two-step sign-in comes next (a code, or setting it up). */
export async function signIn(email: string, password: string): Promise<{ error: string } | { me: string; twoStep?: 'code' | 'setup'; companies?: string[] }> {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const d = await r.json().catch(() => null);
  return r.ok && d ? d : { error: d?.error ?? 'Could not sign in.' };
}
/** This browser stops getting the person's notifications when they sign out (the next person turns their own on). */
const forgetPushDevice = () =>
  Promise.race([
    navigator.serviceWorker
      ?.getRegistration()
      .then((r) => r?.pushManager?.getSubscription())
      .then((s) => s?.unsubscribe()),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => {});
export const signOut = () => forgetPushDevice().then(() => fetch('/api/logout', { method: 'POST' })).then(() => location.reload());
export async function changePassword(current: string, next: string): Promise<string | null> {
  const r = await fetch('/api/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current, next }) });
  return r.ok ? null : ((await r.json().catch(() => null))?.error ?? 'Could not change the password.');
}

/** The live connection: whether it dropped, and when mail last came in fresh (a load, a refresh or a live change). */
export const live = { down: false, mailAt: 0 };
const liveChanged = () => window.dispatchEvent(new CustomEvent('s2g:live'));
let es: EventSource | null = null;
let reload: ((only?: CollectionKey[]) => Promise<void>) | null = null;
let listen: (() => void) | null = null;

/** Loads everything this person can see, then starts listening for changes. */
export async function connect(apply: <K extends CollectionKey>(k: K, v: Collections[K]) => void) {
  const load = async (only?: CollectionKey[]) => {
    const r = await fetch(only?.length ? `/api/state?only=${only.join(',')}` : '/api/state');
    if (r.status === 401) {
      window.dispatchEvent(new CustomEvent('s2g:signed-out'));
      throw new Error('Signed out');
    }
    if (!r.ok) throw new Error('Could not load');
    const state = (await r.json()) as Record<CollectionKey, Doc[]>;
    for (const k of Object.keys(state) as CollectionKey[]) {
      // Things made or changed here that never reached the server (written offline, or while the connection was
      // down) stay on screen and go up now, instead of being replaced by the server's older copy.
      const local = isRecord(k) ? [] : unsentDocs(k);
      remember(k, state[k]);
      const docs = local.length ? [...state[k].filter((d) => !local.some((x) => x.id === d.id)), ...local] : state[k];
      latest[k] = fromDocs(k, docs);
      apply(k, fromDocs(k, docs) as Collections[typeof k]);
      if (local.length) pushChange(k, latest[k] as Collections[typeof k]);
    }
    if (!only || only.includes('threads')) (live.mailAt = Date.now()), liveChanged();
  };
  reload = load;
  await load();
  server.on = true;
  listen = () => {
    es?.close();
    let first = true;
    const src = new EventSource('/api/events');
    es = src;
    src.addEventListener('hello', (e) => {
      server.conn = JSON.parse((e as MessageEvent).data).conn;
      startPresence(server.conn); // so notifications go to phones only while the person is away
      live.down = false;
      liveChanged();
      retryUnsent();
      if (!first) void load().catch(() => {}); // reconnected: catch up on anything missed
      first = false;
    });
    src.onerror = () => {
      if (es !== src || live.down) return;
      live.down = true; // the browser keeps retrying on its own; a refresh starts over
      liveChanged();
    };
    attach(src);
  };
  const attach = (src: EventSource) => {
  // The desktop app's notifications (it can't take web push): shown by the app itself (pushBridge.ts).
  src.addEventListener('alert', (e) => window.dispatchEvent(new CustomEvent('s2g:alert', { detail: JSON.parse((e as MessageEvent).data) })));
  src.addEventListener('signal', (e) => window.dispatchEvent(new CustomEvent('s2g:signal', { detail: JSON.parse((e as MessageEvent).data) })));
  // Their demo company was made again, hidden or shown in another window: load everything again.
  src.addEventListener('reload', () => void reloadAll().catch(() => {}));
  src.addEventListener('change', (e) => {
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
    if (coll === 'threads') (live.mailAt = Date.now()), liveChanged();
  });
  };
  listen();
}

/**
 * Mail's refresh: fetches the mailboxes again and, when the live connection dropped (or never came back), opens a
 * new one. Resolves when the fresh mail is in.
 */
export async function resync(only: CollectionKey[] = ['threads', 'workspaces']) {
  if (!server.on || !reload) return;
  if (!es || es.readyState !== EventSource.OPEN) listen?.();
  await reload(only);
}

/** Everything again (after the demo company was made, reset, hidden or shown), and where the demo company stands. */
export async function reloadAll() {
  if (!server.on || !reload) return;
  const me = await fetch('/api/me').then((r) => (r.ok ? (r.json() as Promise<Session>) : null), () => null);
  if (me?.demo) setDemo(me.demo);
  await reload();
}
/** The demo company's state changed: the switcher, Help and Settings follow. */
export function setDemo(d: DemoState | null) {
  server.demo = d;
  window.dispatchEvent(new CustomEvent('s2g:demo'));
}

/* ---------- changes that couldn't be sent yet ---------- */

/** Collections whose last save didn't reach the server (offline, the connection dropped), and since when. */
const failedAt: Partial<Record<CollectionKey, number>> = {};
const unsentChanged = () => window.dispatchEvent(new CustomEvent('s2g:unsent'));
/** Documents changed here that the server doesn't have yet (lists only). */
function unsentDocs(k: CollectionKey): Doc[] {
  const before = synced[k];
  if (!before || latest[k] === undefined || isRecord(k)) return [];
  return toDocs(k, latest[k]).filter((d) => before.get(d.id) !== d);
}
/**
 * Ids in a collection that are made or changed here but not on the server yet, and whether the last try failed
 * (then they wait for the connection; otherwise they're on their way). Listen to `s2g:unsent` for changes.
 */
export function unsent(k: CollectionKey): { ids: Set<string>; failed: boolean } {
  if (!server.on) return { ids: new Set(), failed: false };
  return { ids: new Set(unsentDocs(k).map((d) => d.id)), failed: !!failedAt[k] };
}
/** Sends again whatever couldn't be sent: when the phone is back online, the live connection is back, or on Retry. */
export function retryUnsent() {
  for (const k of Object.keys(failedAt) as CollectionKey[]) if (latest[k] !== undefined) pushChange(k, latest[k] as Collections[typeof k]);
}
if (typeof window !== 'undefined') window.addEventListener('online', () => retryUnsent());

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
    if (!upserts.length && !deletes.length) {
      if (failedAt[k]) (delete failedAt[k], unsentChanged());
      return;
    }
    unsentChanged();
    void fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-conn': server.conn }, body: JSON.stringify({ coll: k, upserts, deletes }) })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          // Two-step sign-in became due (a company now requires it): the app reloads into the setup screen.
          const d = (await r.clone().json().catch(() => ({}))) as { twoStep?: string };
          if (d.twoStep) return location.reload();
        }
        if (failedAt[k]) delete failedAt[k];
        unsentChanged();
        if (r.status === 401) return window.dispatchEvent(new CustomEvent('s2g:signed-out'));
        if (!r.ok) {
          synced[k] = before;
          // The server is restarting or busy: like being offline, it goes again with the connection.
          if (r.status >= 500) return void ((failedAt[k] = Date.now()), unsentChanged());
          window.dispatchEvent(new CustomEvent('s2g:save-failed', { detail: { coll: k, error: ((await r.json().catch(() => ({}))) as { error?: string }).error } }));
          return;
        }
        // The server may have kept fewer changes than were sent, or kept some differently (something it doesn't allow,
        // or a plan limit): say why. It sends back what it stored, so the screen shows that.
        const { saved, why } = (await r.json().catch(() => ({ saved: upserts.length }))) as { saved?: number; why?: string };
        if (why) window.dispatchEvent(new CustomEvent('s2g:save-failed', { detail: { coll: k, error: why } }));
        else if (typeof saved === 'number' && saved < upserts.length) window.dispatchEvent(new CustomEvent('s2g:save-failed', { detail: { coll: k, error: t('Part of that change isn’t allowed for your role, so it was left out.') } }));
      })
      .catch(() => {
        synced[k] = before; // tried again with the next change, when the connection is back, or on Retry
        failedAt[k] = Date.now();
        unsentChanged();
      });
  }, 250);
}

const signalQueue = new Map<string, Promise<unknown>>();
/**
 * Sends a huddle note (offer, answer, candidate) to one person; it reaches them through their live connection.
 * Notes to the same person go one after another, so an offer never arrives after its own candidates.
 */
export function sendSignal(to: string, data: unknown) {
  if (!server.on) return;
  const send = () => fetch('/api/signal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, data }) }).catch(() => {});
  signalQueue.set(to, (signalQueue.get(to) ?? Promise.resolve()).then(send));
}

/** Someone chose not to upload a big file (Settings, Storage: "Ask before saving big files"). Not an error to show. */
export class UploadSkipped extends Error {
  skipped = true;
  constructor(name: string) {
    super(`${name} wasn’t uploaded.`);
  }
}
export const wasSkipped = (e: unknown) => !!(e as { skipped?: boolean } | null)?.skipped;
const MB = 1024 * 1024;
const size = (n: number) => (n >= 1024 * MB ? `${+(n / (1024 * MB)).toFixed(1)} GB` : `${Math.max(0, Math.round(n / MB))} MB`);
/** The company's room and its "ask over" size, read from the server (only for files big enough to matter). */
async function roomFor(workspaceId: string): Promise<{ askOverMb: number; left: number; total: number; maxUpload: number } | null> {
  if (!server.on) {
    // The demo: the company's setting and plan, and the files in its Drive.
    const total = uploadPolicy.storageTotal;
    const used = store.drive.filter((d) => d.workspaceId === workspaceId && !d.trashed).reduce((n, d) => n + d.size, 0);
    return { askOverMb: uploadPolicy.askOverMb, total, left: Math.max(0, total - used), maxUpload: Infinity };
  }
  return fetch(`/api/storage?workspaceId=${encodeURIComponent(workspaceId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}
/** Set by the app for the company on screen (the demo has no server to ask). */
export const uploadPolicy = { askOverMb: 500, storageTotal: 0 };
/** The largest file the demo company keeps (inline, in its own documents). */
const SANDBOX_FILE = 2 * MB;
const asDataUrl = (file: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error(t('Couldn’t read the file')));
    r.readAsDataURL(file);
  });

/**
 * Puts a file on the server and returns where it lives. Without a server (the demo) the file stays in the browser
 * as a data URL, as before. A file over the company's "ask over" size asks first (UploadSkipped when they say no);
 * one that's over the limit or doesn't fit in the company's storage fails straight away, before anything is sent.
 */
export async function uploadFile(file: File | Blob, workspaceId: string, name = (file as File).name ?? 'file'): Promise<{ url: string; name: string; type: string; size: number }> {
  const type = file.type || 'application/octet-stream';
  // DEMO ONLY: the demo company keeps small files (a voice note, a screenshot) inside its own documents, never as
  // uploads on our server, so they count toward nobody's storage and go with a Reset.
  if (isSandboxId(workspaceId)) {
    if (file.size > SANDBOX_FILE) throw new Error(t('The demo company keeps files up to {size}, and nothing in it is saved as a real upload.', { size: size(SANDBOX_FILE) }));
    return { url: await asDataUrl(file), name, type, size: file.size };
  }
  if (file.size >= 10 * MB) {
    const room = await roomFor(workspaceId);
    if (room) {
      if (file.size > room.maxUpload) throw new Error(t('Files up to {size}.', { size: size(room.maxUpload) }));
      if (server.on && file.size > room.left) throw new Error(t('It doesn’t fit: the company has {left} left of its {total}. An admin can add more in Settings, Plan & billing.', { left: size(room.left), total: size(room.total) }));
      if (room.askOverMb > 0 && file.size > room.askOverMb * MB && !(await askBigFile({ name, size: file.size, left: room.total ? room.left : null, total: room.total || null }))) throw new UploadSkipped(name);
    }
  }
  if (!server.on) return { url: await asDataUrl(file), name, type, size: file.size };
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': type, 'x-file-name': encodeURIComponent(name), 'x-workspace': workspaceId }, body: file });
  if (!r.ok) {
    const why = ((await r.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(why ? t(why) : t('The upload failed.'));
  }
  const d = (await r.json()) as { url: string; name: string; type: string; size: number };
  return d;
}
