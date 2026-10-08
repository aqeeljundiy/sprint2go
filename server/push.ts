// Notifications on phones and computers (Web Push). The browser gives us a subscription when someone turns
// notifications on for a device; we keep it here, bound to their session, and send the notices they act on while
// they're away from the app. Our VAPID keys are made once and kept in the database (the private one sealed).
import webpush from 'web-push';
import { createHash } from 'node:crypto';
import { db, seal, unseal } from './db.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS push_vapid (id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, session TEXT, device TEXT, created_at TEXT NOT NULL, ok_at TEXT, fails INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
  CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, at TEXT NOT NULL);
`);

const now = () => new Date().toISOString();

/* ---------- our keys ---------- */

function loadKeys(): { publicKey: string; privateKey: string } {
  const r = db.prepare('SELECT public_key, private_key FROM push_vapid WHERE id = 1').get() as { public_key: string; private_key: string } | undefined;
  if (r) {
    try {
      return { publicKey: r.public_key, privateKey: unseal(r.private_key) };
    } catch {
      // The master key changed (a new S2G_SECRET): the old pair can't be opened, and every subscription was made
      // for it, so they go too. People turn notifications on again.
      console.error('[push] the saved keys could not be opened; making new ones (devices need to turn notifications on again)');
      db.exec('DELETE FROM push_subs');
    }
  }
  const k = webpush.generateVAPIDKeys();
  db.prepare('INSERT INTO push_vapid (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET public_key = excluded.public_key, private_key = excluded.private_key, created_at = excluded.created_at').run(k.publicKey, seal(k.privateKey), now());
  return k;
}
const KEYS = loadKeys();
export const publicKey = () => KEYS.publicKey;

let subject = 'mailto:support@localhost';
/** Who push services can contact about our pushes: the app's https address, or the support mailbox. */
export function setSubject(publicUrl: string, supportEmail: string) {
  subject = publicUrl.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(publicUrl) ? publicUrl : `mailto:${supportEmail}`;
}

/* ---------- subscriptions ---------- */

// Browsers only hand out endpoints at these push services. Anything else is refused, so the server never posts to an
// address someone made up (an internal one, say).
const SERVICES = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

export type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
export function validSub(s: unknown): Sub | null {
  const x = s as Sub | null;
  if (!x || typeof x.endpoint !== 'string' || x.endpoint.length > 1000 || typeof x.keys?.p256dh !== 'string' || typeof x.keys?.auth !== 'string') return null;
  let u: URL;
  try {
    u = new URL(x.endpoint);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !SERVICES.some((r) => r.test(u.hostname))) return null;
  if (!b64url.test(x.keys.p256dh) || x.keys.p256dh.length > 200 || !b64url.test(x.keys.auth) || x.keys.auth.length > 100) return null;
  return { endpoint: x.endpoint, keys: { p256dh: x.keys.p256dh, auth: x.keys.auth } };
}

/** Who this device's subscription belongs to now, if anyone. */
export const ownerOf = (endpoint: string) => (db.prepare('SELECT user_id FROM push_subs WHERE endpoint = ?').get(endpoint) as { user_id: string } | undefined)?.user_id ?? null;

/**
 * Saves a device for this person and their current session. `refresh`: the app checking in on start; it only
 * renews a device that's already theirs, so signing in as someone else never quietly takes over another person's
 * notifications (they turn them on themselves).
 */
export function subscribe(userId: string, sessionToken: string, s: Sub, device: string, replaces?: string, refresh = false) {
  if (refresh && ownerOf(s.endpoint) !== userId && !(replaces && ownerOf(replaces) === userId)) return false;
  // A renewed address (the browser replaced it) keeps the device's name.
  const before = replaces ? (db.prepare('SELECT device FROM push_subs WHERE endpoint = ? AND user_id = ?').get(replaces, userId) as { device: string | null } | undefined) : undefined;
  if (replaces && replaces !== s.endpoint) db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(replaces, userId);
  const name = (device || before?.device || '').slice(0, 80);
  db.prepare(
    "INSERT INTO push_subs (endpoint, user_id, p256dh, auth, session, device, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, session = excluded.session, device = CASE WHEN excluded.device = '' THEN push_subs.device ELSE excluded.device END, fails = 0",
  ).run(s.endpoint, userId, s.keys.p256dh, s.keys.auth, tokenHash(sessionToken), name, now());
  return true;
}
export const unsubscribe = (userId: string, endpoint: string) => db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
/** Someone signed out on a device: it stops getting their notifications. */
export const forgetSession = (sessionToken: string) => db.prepare('DELETE FROM push_subs WHERE session = ?').run(tokenHash(sessionToken));
export const devicesOf = (userId: string) => (db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(userId) as { n: number }).n;

/* ---------- sending ---------- */

/** True the first time a key is seen: each notice, message or reminder is sent once, even across restarts. */
export function once(key: string) {
  return Number(db.prepare('INSERT OR IGNORE INTO push_sent (key, at) VALUES (?, ?)').run(key, now()).changes) === 1;
}

export interface Push {
  title: string;
  body: string;
  /** Where a tap goes, inside the app (/chat?ws=…&id=…). */
  url: string;
  /** One notification per tag on the device: a newer one replaces it (a conversation, a task). */
  tag: string;
  notice?: string; // the notice it came from, marked read when opened
  badge?: number; // unread count for the app icon
  ttl?: number; // seconds the push service keeps it for an offline device
  urgent?: boolean;
}

const alive = db.prepare('SELECT 1 FROM sessions WHERE token = ? AND expires_at > ?');
const okRow = db.prepare('UPDATE push_subs SET ok_at = ?, fails = 0 WHERE endpoint = ?');
const failRow = db.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?');
const dropRow = db.prepare('DELETE FROM push_subs WHERE endpoint = ?');

async function deliver(row: { endpoint: string; p256dh: string; auth: string }, p: Push) {
  const payload = JSON.stringify({ title: p.title.slice(0, 80), body: p.body.slice(0, 240), url: p.url, tag: p.tag, notice: p.notice, badge: p.badge });
  try {
    await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, {
      vapidDetails: { subject, publicKey: KEYS.publicKey, privateKey: KEYS.privateKey },
      TTL: p.ttl ?? 12 * 3600,
      urgency: p.urgent ? 'high' : 'normal',
      // The push service keeps only the newest per tag for a phone that's offline.
      topic: createHash('sha256').update(p.tag).digest('base64url').slice(0, 32),
      timeout: 10_000,
    });
    okRow.run(now(), row.endpoint);
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    // Gone (unsubscribed, app removed), or made for other keys: this device won't take pushes any more.
    if (status === 404 || status === 410 || status === 403) dropRow.run(row.endpoint);
    else {
      failRow.run(row.endpoint);
      if (status !== 429 && status < 500) console.error('[push]', status || '', e instanceof Error ? e.message.slice(0, 160) : e);
    }
    return false;
  }
}

/** Sends to every device of this person that's still signed in. */
export async function sendTo(userId: string, p: Push) {
  const rows = db.prepare('SELECT endpoint, p256dh, auth, session FROM push_subs WHERE user_id = ?').all(userId) as { endpoint: string; p256dh: string; auth: string; session: string | null }[];
  const at = now();
  // A device whose sign-in ended (signed out elsewhere, new password, expired) gets nothing until they sign in again.
  const live = rows.filter((r) => r.session && alive.get(r.session, at));
  await Promise.all(live.map((r) => deliver(r, p)));
  return live.length;
}

/** Just this device (the "Send a test" button), whether or not they're active. */
export async function sendToDevice(userId: string, endpoint: string, p: Push) {
  const row = db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE endpoint = ? AND user_id = ?').get(endpoint, userId) as { endpoint: string; p256dh: string; auth: string } | undefined;
  return row ? deliver(row, p) : false;
}

/**
 * Old send records, devices that keep failing, and devices nobody has signed in on for half a year. (A device whose
 * sign-in merely expired stays: signing in again there picks its notifications back up.)
 */
export function prune() {
  const day = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
  db.prepare('DELETE FROM push_sent WHERE at < ?').run(ago(3));
  db.prepare('DELETE FROM push_subs WHERE fails >= 20 AND (ok_at IS NULL OR ok_at < ?)').run(ago(7));
  db.prepare('DELETE FROM push_subs WHERE created_at < ? AND COALESCE(ok_at, created_at) < ? AND (session IS NULL OR session NOT IN (SELECT token FROM sessions WHERE expires_at > ?))').run(ago(180), ago(180), now());
}
