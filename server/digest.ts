// Email notices for teammates. Guests get each notice by email; teammates have the bell and push, and when they
// haven't used sprint2go for a while (no window in use, no notification opened) they get one plain email about
// what's waiting: unread mentions and direct messages, tasks given to them, replies they're waiting on. Every hour,
// or daily at 9:00 their time (Settings, Notifications; daily unless they change it). Only the kinds they chose, and
// never anything they've already seen or that an earlier email already listed.
import * as db from './db.ts';
import { DIGEST_HOUR, companyTz, isZone, localParts, type DigestEvery } from '../src/jobTimes.ts';
import { wants, type PushKind } from './notifyPush.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS digest_state (user_id TEXT PRIMARY KEY, last_at TEXT, last_day TEXT);
  CREATE TABLE IF NOT EXISTS digest_items (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, at TEXT NOT NULL);
`);

export interface DigestDeps {
  /** When the person last used the app (a request, or a window in use), in ms; 0 when never. */
  lastActive: (userId: string) => number;
  /** Sends one email; false when it couldn't go out. */
  send: (to: string, subject: string, text: string, html: string, fromName: string) => Promise<boolean>;
  publicUrl: string;
}

/** Away at least this long before an email goes out. */
export const IDLE_MS = 60 * 60_000;
/** Nothing older than this goes in an email. */
const LOOK_BACK = 7 * 86_400_000;
/** The daily email waits until 9:00 and gives up on that day at noon (they're likely around by then). */
const DAILY_UNTIL = 12;
const MAX_LINES = 20;

export type Group = 'messages' | 'tasks' | 'replies' | 'guests' | 'mail';
export type DigestItem = { key: string; group: Group; text: string; url: string; at: string; workspaceId: string };
const GROUP_NAME: Record<Group, string> = { messages: 'Messages and mentions', tasks: 'Tasks', replies: 'Replies to your email', guests: 'From guests', mail: 'Email for you' };
const PUSH_KIND: Record<Group, PushKind> = { messages: 'messages', tasks: 'tasks', replies: 'mail', guests: 'guests', mail: 'mail' };

const prefsOf = (userId: string) => ((db.getDoc('prefs', userId) as any)?.value ?? {}) as Record<string, any>;
/**
 * How often someone gets the email, and their time zone: the one their device last told us (their settings), else
 * their company's (Settings, General; their first company when they're in several).
 */
export function digestPrefs(userId: string): { every: DigestEvery; tz: string } {
  const s = prefsOf(userId)[`pm-settings:${userId}`] ?? {};
  const company = (db.allDocs('workspaces') as any[]).find((w) => (w.members ?? []).some((m: any) => m.userId === userId));
  return { every: ['off', 'hourly', 'daily'].includes(s.emailDigest) ? s.emailDigest : 'daily', tz: isZone(s.timeZone) ? s.timeZone : companyTz(company) };
}

const q = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : '';
};

/**
 * What's waiting for someone that arrived after `since`: unread notices of the kinds that go in the email (messages,
 * tasks, guests, email given to them) and unread replies to email they sent. Chat they've read since is left out.
 */
export function itemsFor(userId: string, since: string, publicUrl: string): DigestItem[] {
  const prefs = prefsOf(userId);
  const read = (prefs[`s2g-read:${userId}`] ?? {}) as Record<string, string>;
  const out: DigestItem[] = [];
  const threadsInNotices = new Set<string>();
  for (const n of db.allDocs('notices') as any[]) {
    if (n.userId !== userId || n.read || typeof n.at !== 'string' || n.at <= since) continue;
    const group: Group | null = n.fromGuest ? 'guests' : n.kind === 'mention' ? 'messages' : n.kind === 'task' ? 'tasks' : n.kind === 'mail' ? 'mail' : null;
    if (!group || !wants(userId, PUSH_KIND[group])) continue;
    const l = n.link ?? {};
    // Read in chat since (the bell can stay unread while the conversation was seen).
    if (l.app === 'chat' && l.id && read[l.id] && read[l.id] >= n.at) continue;
    if (l.app === 'mail' && l.id) threadsInNotices.add(l.id);
    const url = n.url ? (String(n.url).startsWith('http') ? String(n.url) : `${publicUrl}${n.url}`) : `${publicUrl}/${l.app ?? ''}${q({ ws: n.workspaceId, id: l.id, msg: l.msg, notice: n.id })}`;
    out.push({ key: `n:${n.id}`, group, text: String(n.text ?? '').slice(0, 240), url, at: n.at, workspaceId: String(n.workspaceId ?? '') });
  }
  if (wants(userId, 'mail')) {
    // Replies they're waiting on: an unread answer in a conversation where they wrote, in a mailbox that's theirs.
    const boxes = new Map<string, { ws: any; acct: any }>();
    for (const w of db.allDocs('workspaces') as any[]) for (const a of w.accounts ?? []) if ((a.users ?? []).includes(userId)) boxes.set(a.id, { ws: w, acct: a });
    for (const t of db.allDocs('threads') as any[]) {
      const box = boxes.get(t.accountId);
      if (!box || !t.unread || t.location !== 'inbox' || threadsInNotices.has(t.id)) continue;
      if (box.acct.kind === 'shared' && t.assignee !== userId) continue;
      const own = String(box.acct.email).toLowerCase();
      const msgs = (t.messages ?? []) as any[];
      const last = msgs[msgs.length - 1];
      if (!last || last.listUnsubscribe || String(last.from?.email ?? '').toLowerCase() === own || typeof last.date !== 'string' || last.date <= since) continue;
      if (!msgs.slice(0, -1).some((m) => String(m.from?.email ?? '').toLowerCase() === own)) continue;
      out.push({ key: `t:${t.id}:${last.id ?? last.mid ?? last.date}`, group: 'replies', text: `${last.from?.name || last.from?.email} replied: ${String(t.subject ?? '(no subject)').slice(0, 160)}`, url: `${publicUrl}/mail${q({ ws: box.ws.id, id: t.id })}`, at: last.date, workspaceId: box.ws.id });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const emailed = (key: string) => !!db.db.prepare('SELECT 1 FROM digest_items WHERE key = ?').get(key);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email: grouped, one line and one link per item, plain text and simple HTML. */
export function compose(name: string, brand: string, items: DigestItem[], publicUrl: string) {
  const shown = items.slice(0, MAX_LINES);
  const more = items.length - shown.length;
  const groups = (Object.keys(GROUP_NAME) as Group[]).map((g) => [g, shown.filter((i) => i.group === g)] as const).filter(([, list]) => list.length);
  const subject = `${items.length} thing${items.length === 1 ? '' : 's'} waiting for you in ${brand}`;
  const settings = `${publicUrl}/settings?id=notifications`;
  const hello = `Hi ${name.split(' ')[0] || 'there'}, while you were away:`;
  const footer = `You get this email when you haven’t opened ${brand} for a while. Change how often in Settings, Notifications: ${settings}`;
  const text = [hello, '', ...groups.flatMap(([g, list]) => [GROUP_NAME[g], ...list.map((i) => `- ${i.text}\n  ${i.url}`), '']), ...(more ? [`And ${more} more in ${brand}: ${publicUrl}`, ''] : []), footer].join('\n');
  // Its own white card, so dark mail apps (and dark Mail here) never put dark text on a dark page.
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#16161d;background:#ffffff;max-width:560px;padding:20px 24px;border-radius:12px"><p style="margin-top:0">${esc(hello)}</p>${groups
    .map(([g, list]) => `<p style="margin:20px 0 6px;font-weight:600">${esc(GROUP_NAME[g])}</p>${list.map((i) => `<p style="margin:0 0 8px"><a href="${esc(i.url)}" style="color:#2448ff;text-decoration:none">${esc(i.text)}</a></p>`).join('')}`)
    .join('')}${more ? `<p style="margin-top:16px"><a href="${esc(publicUrl)}" style="color:#2448ff">And ${more} more in ${esc(brand)}</a></p>` : ''}<p style="margin-top:24px;color:#6b6f7b;font-size:13px">You get this email when you haven’t opened ${esc(brand)} for a while. <a href="${esc(settings)}" style="color:#6b6f7b">Change how often</a>.</p></div>`;
  return { subject, text, html };
}

let running = false;
/** Sends the emails that are due. `now` can be set for tests. Returns who got one and how many items it had. */
export async function runDigests(deps: DigestDeps, now = Date.now()): Promise<{ userId: string; items: number; sent: boolean }[]> {
  if (running) return [];
  running = true;
  const out: { userId: string; items: number; sent: boolean }[] = [];
  try {
    const wss = db.allDocs('workspaces') as any[];
    const teammates = new Set(wss.flatMap((w) => (w.members ?? []).map((m: any) => m.userId as string)));
    for (const userId of teammates) {
      const u = db.getDoc('users', userId) as any;
      if (!u?.email || u.clientOf || u.deletedAt || u.suspended || !db.hasLogin(userId)) continue;
      const { every, tz } = digestPrefs(userId);
      if (every === 'off') continue;
      const active = deps.lastActive(userId);
      if (now - active < IDLE_MS) continue;
      const state = db.db.prepare('SELECT last_at, last_day FROM digest_state WHERE user_id = ?').get(userId) as { last_at: string | null; last_day: string | null } | undefined;
      const local = localParts(now, tz);
      if (every === 'hourly' && state?.last_at && now - Date.parse(state.last_at) < 60 * 60_000 - 60_000) continue;
      if (every === 'daily' && (local.hour < DIGEST_HOUR || local.hour >= DAILY_UNTIL || state?.last_day === local.day)) continue;
      // Only what came after they were last here: anything before, they could have seen.
      const since = new Date(Math.max(active, now - LOOK_BACK)).toISOString();
      const items = itemsFor(userId, since, deps.publicUrl).filter((i) => !emailed(`${userId}|${i.key}`));
      if (!items.length) continue;
      // Named after the company it's all from (or their only one); several: sprint2go.
      const mine = wss.filter((w) => (w.members ?? []).some((m: any) => m.userId === userId));
      const from = new Set(items.map((i) => i.workspaceId));
      const one = from.size === 1 ? wss.find((w) => from.has(w.id)) : mine.length === 1 ? mine[0] : null;
      const brand = one?.name ? String(one.name) : 'sprint2go';
      const mail = compose(String(u.name ?? ''), brand, items, deps.publicUrl);
      const sent = await deps.send(String(u.email), mail.subject, mail.text, mail.html, brand).catch(() => false);
      if (sent) {
        const at = new Date(now).toISOString();
        const mark = db.db.prepare('INSERT OR IGNORE INTO digest_items (key, user_id, at) VALUES (?, ?, ?)');
        for (const i of items) mark.run(`${userId}|${i.key}`, userId, at);
        db.db.prepare('INSERT INTO digest_state (user_id, last_at, last_day) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET last_at = excluded.last_at, last_day = excluded.last_day').run(userId, at, local.day);
      }
      out.push({ userId, items: items.length, sent });
    }
    // What was emailed more than a month ago can't come back (it's older than the look-back), so it's forgotten.
    db.db.prepare('DELETE FROM digest_items WHERE at < ?').run(new Date(now - 30 * 86_400_000).toISOString());
  } finally {
    running = false;
  }
  return out;
}
