// Mail offline (the installed app on a phone or a laptop with no connection):
//  - Reading: the latest conversations (OFFLINE_THREADS, not Spam or Trash) are kept on this device with what's needed
//    to open the app (who you are, your companies, your team), in the browser's Cache Storage. With no connection,
//    the app opens on that copy (sync.ts asks `offlineState`), and the service worker serves the app itself from its
//    cache (src/sw.js).
//  - Writing: an email sent while offline waits here (localStorage, per person) and goes out, in order, once the
//    connection is back; the list says so. Replies and changes to conversations already wait in sync.ts's own queue.
// Signing out clears both.
import type { Collections, CollectionKey } from '../../seed';
import { t } from '../../i18n';

export const OFFLINE_THREADS = 200;
const CACHE = 's2g-mail-offline';
const WHO = 's2g-offline-user';
const key = (userId: string) => `/__offline/${encodeURIComponent(userId)}`;
const outboxKey = (userId: string) => `s2g-mail-outbox:${userId}`;
const canCache = () => typeof caches !== 'undefined' && window.isSecureContext;

/** The session the server gave when the app opened (kept with the copy, so the app can open the same way offline). */
let session: unknown = null;
export const rememberSession = <T>(s: T): T => ((session = s), s);
export const currentSession = () => session;

/** Who the copy on this device belongs to (the last person signed in here). */
export function offlineUser(): string | null {
  try {
    return localStorage.getItem(WHO);
  } catch {
    return null;
  }
}

type Thread = Collections['threads'][number];
const lastAt = (th: Thread) => th.messages.reduce((m, x) => (x.date > m ? x.date : m), '');

/** Keeps the latest mail and what the app needs to open, for this person (called a moment after mail changes). */
export async function keepOffline(userId: string, state: Partial<Collections>) {
  if (!canCache() || !userId || !session) return;
  const threads = [...(state.threads ?? [])]
    .filter((th) => th.location !== 'trash' && th.location !== 'spam')
    .sort((a, b) => lastAt(b).localeCompare(lastAt(a)))
    .slice(0, OFFLINE_THREADS);
  const snap = { at: new Date().toISOString(), session, state: { ...pick(state), threads } };
  try {
    const c = await caches.open(CACHE);
    await c.put(key(userId), new Response(JSON.stringify(snap), { headers: { 'content-type': 'application/json' } }));
    localStorage.setItem(WHO, userId);
  } catch {
    /* storage full or blocked: the app simply needs a connection */
  }
}
/** Only what Mail and the shell need to open: people, companies, your settings. */
const KEEP: CollectionKey[] = ['users', 'workspaces', 'prefs', 'statuses'];
const pick = (state: Partial<Collections>) => Object.fromEntries(KEEP.filter((k) => k in state).map((k) => [k, state[k]]));

/** The copy kept on this device: when it was kept, the session to open with, and the collections. */
export async function offlineState(): Promise<{ at: string; session: any; state: Partial<Record<CollectionKey, unknown>> } | null> {
  const who = offlineUser();
  if (!canCache() || !who) return null;
  try {
    const r = await (await caches.open(CACHE)).match(key(who));
    return r ? await r.json() : null;
  } catch {
    return null;
  }
}
export async function clearOffline() {
  try {
    const who = offlineUser();
    if (who) localStorage.removeItem(outboxKey(who));
    localStorage.removeItem(WHO);
    if (canCache()) await caches.delete(CACHE);
  } catch {
    /* nothing kept */
  }
}

/* ---------- emails written offline ---------- */

type Waiting = { body: Record<string, unknown>; at: string };
const readBox = (userId: string): Waiting[] => {
  try {
    return JSON.parse(localStorage.getItem(outboxKey(userId)) ?? '[]');
  } catch {
    return [];
  }
};
const writeBox = (userId: string, list: Waiting[]) => {
  try {
    if (list.length) localStorage.setItem(outboxKey(userId), JSON.stringify(list));
    else localStorage.removeItem(outboxKey(userId));
  } catch {
    /* blocked: it stays in memory until the page closes */
  }
  window.dispatchEvent(new CustomEvent('s2g:mail-outbox'));
};
export const waitingCount = (userId: string) => readBox(userId).length;

/**
 * Sends an email through the mail engine (/api/mail/send). With no connection it waits on this device and the answer
 * says so (`queued`, and a `note` for the toast) instead of failing; it goes out once the connection is back.
 */
export async function sendMail(userId: string, body: Record<string, unknown>): Promise<Response> {
  const post = () => fetch('/api/mail/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (navigator.onLine) {
    try {
      return await post();
    } catch {
      if (navigator.onLine) throw new Error('offline'); // the server, not the connection: the caller says it didn't go
    }
  }
  // Undo send makes no sense for mail that hasn't left this device yet: it waits here instead.
  writeBox(userId, [...readBox(userId), { body: { ...body, undoSeconds: 0 }, at: new Date().toISOString() }]);
  return new Response(JSON.stringify({ queued: true, note: t('You’re offline. It goes out once you’re back online.') }), { status: 200, headers: { 'content-type': 'application/json' } });
}

let flushing = false;
/**
 * Sends what waited, oldest first, once the connection is back. `told` hears each result: sent, or why not (a data
 * loss warning or block, a mailbox that can't send).
 */
export async function flushOutbox(userId: string, told: (r: { subject: string; ok: boolean; why?: string; dlp?: unknown; body: Record<string, unknown> }) => void) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (let list = readBox(userId); list.length; list = readBox(userId)) {
      const w = list[0];
      let r: Response;
      try {
        r = await fetch('/api/mail/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(w.body) });
      } catch {
        return; // still no connection: try again later
      }
      if (r.status >= 500) return;
      writeBox(userId, readBox(userId).slice(1));
      const d = (await r.json().catch(() => ({}))) as { error?: string; dlp?: unknown };
      told({ subject: String(w.body.subject ?? ''), ok: r.ok, why: d.error, dlp: d.dlp, body: w.body });
    }
  } finally {
    flushing = false;
  }
}
