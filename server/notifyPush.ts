// Which changes become a notification on someone's phone or computer, and for whom. Everything goes through what
// the app already writes: notices (the bell), guests' messages in project channels, and mail arriving in a mailbox.
// A push goes out only when the person isn't using the app right now, and only for the kinds they chose
// (Settings, Notifications). Calendar reminders are made here too, as notices, so they show in the bell as well.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import * as push from './push.ts';
import { clientPeople, companyOf } from '../src/clientView.ts';
import { mutedFor } from './chatLater.ts';
import { fromPerson } from '../src/mailRules.ts';
import { expandEvents } from '../src/repeat.ts';

/** What someone can switch on or off (Settings, Notifications); stored with their other settings. */
export type PushKind = 'messages' | 'mail' | 'tasks' | 'guests' | 'meetings' | 'other';
const FIELD: Record<PushKind, string> = { messages: 'notifyMessages', mail: 'notifyNewMail', tasks: 'notifyTasks', guests: 'notifyGuests', meetings: 'notifyEvents', other: 'notifyOther' };
const DEFAULT_ON: Record<PushKind, boolean> = { messages: true, mail: true, tasks: true, guests: true, meetings: true, other: false };

/** What the desktop app shows (it gets these over its live connection; web push doesn't reach it). */
export type DesktopAlert = { title: string; body: string; url: string; tag: string; notice?: string };
let deps: { active: (userId: string) => boolean; desktop: { has: (userId: string) => boolean; send: (userId: string, a: DesktopAlert) => void } } = {
  active: () => false,
  desktop: { has: () => false, send: () => {} },
};
/** `active`: whether the person has the app open and in use right now (then nothing buzzes). */
export function initPushRules(d: typeof deps) {
  deps = d;
}
/** Somewhere to send it: a phone or browser with notifications on, or the desktop app open. */
const reachable = (userId: string) => push.devicesOf(userId) > 0 || deps.desktop.has(userId);

const prefsOf = (userId: string) => ((db.getDoc('prefs', userId) as any)?.value ?? {}) as Record<string, any>;
export function wants(userId: string, kind: PushKind) {
  const v = prefsOf(userId)[`pm-settings:${userId}`]?.[FIELD[kind]];
  return typeof v === 'boolean' ? v : DEFAULT_ON[kind];
}
/** Senders this person blocked (Mail, Block): their mail never buzzes. */
function blockedBy(userId: string, email: string) {
  const rules = prefsOf(userId)[`pm-blocked:${userId}`];
  const e = email.toLowerCase();
  return Array.isArray(rules) && rules.some((b: any) => (b?.kind === 'address' ? b.value === e : typeof b?.value === 'string' && e.endsWith('@' + b.value)));
}

/**
 * A conversation this person muted (Chat, long-press a conversation, Mute): no buzz for a direct message there or a
 * guest writing in it. Mentions and replies to them still come, as in Slack.
 */
const muted = (userId: string, channelId: string) => mutedFor(prefsOf(userId), userId, channelId);

/** Only fresh things: an old notice saved again (read elsewhere, edited) never buzzes. Allows for a slow clock. */
const recent = (at: unknown) => {
  const t = Date.parse(String(at ?? ''));
  return Number.isFinite(t) && Date.now() - t < 2 * 3600_000;
};
const unread = db.db.prepare("SELECT COUNT(*) AS n FROM docs WHERE coll = 'notices' AND json_extract(data, '$.userId') = ? AND json_extract(data, '$.read') = 0");
const wsName = (id: string) => String((db.getDoc('workspaces', id) as any)?.name ?? '') || 'sprint2go';
const q = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : '';
};

/** One person, one push: their choice for this kind, not while they're in the app, with their unread count. */
function alert(userId: string, kind: PushKind, p: Omit<push.Push, 'badge'>) {
  if (!wants(userId, kind)) return;
  // The desktop app shows it right away when it's open but not in front; phones only when the person is away.
  deps.desktop.send(userId, { title: p.title, body: p.body, url: p.url, tag: p.tag, notice: p.notice });
  if (deps.active(userId) || !push.devicesOf(userId)) return;
  const badge = Number((unread.get(userId) as { n: number } | undefined)?.n ?? 0);
  void push.sendTo(userId, { ...p, badge }).catch((e) => console.error('[push]', e instanceof Error ? e.message : e));
}

/**
 * Mail pushes (new mail, an email given to you, a mention in a comment) wait about 20 seconds and go only if nobody saw
 * the email or the notice meanwhile, on another device or in the app (Front's rule). S2G_PUSH_HOLD_MS changes the wait.
 */
let HOLD_MS = process.env.S2G_PUSH_HOLD_MS ? Math.max(0, Number(process.env.S2G_PUSH_HOLD_MS) || 0) : 20_000;
export const setPushHold = (ms: number) => void (HOLD_MS = Math.max(0, ms));
function hold(fn: () => void) {
  if (!HOLD_MS) return fn();
  const t = setTimeout(() => {
    try {
      fn();
    } catch (e) {
      console.error('[push]', e instanceof Error ? e.message : e);
    }
  }, HOLD_MS);
  t.unref?.();
}

const kindOf = (n: any): PushKind => (n.fromGuest ? 'guests' : n.kind === 'mention' ? 'messages' : n.kind === 'mail' ? 'mail' : n.kind === 'task' ? 'tasks' : n.kind === 'meeting' ? 'meetings' : 'other');

/** New notices (the bell): the same words on the lock screen; a tap opens the exact item. */
function notices(docs: any[]) {
  for (const n of docs) {
    if (!n || n.read || typeof n.userId !== 'string' || n.userId.startsWith('email:') || !recent(n.at)) continue;
    const l = n.link ?? {};
    if (l.app === 'chat' && l.id && muted(n.userId, String(l.id)) && (db.getDoc('channels', String(l.id)) as any)?.kind === 'dm') continue;
    if (!reachable(n.userId) || !push.once(`n:${n.id}`)) continue;
    const url = n.url ? String(n.url) : `/${l.app ?? ''}${q({ ws: n.workspaceId, id: l.id, msg: l.msg, notice: n.id })}`;
    const tag = l.app === 'chat' && l.id ? `chat:${l.id}` : l.app === 'tasks' && l.id ? `task:${l.id}` : l.app === 'mail' && l.id ? `mail:${l.id}` : l.app === 'calendar' && l.id ? `event:${l.id}` : `n:${n.id}`;
    const kind = kindOf(n);
    const send = () => alert(n.userId, kind, { title: wsName(n.workspaceId), body: String(n.text ?? ''), url, tag, notice: n.id, urgent: kind === 'messages' || kind === 'guests' || l.app === 'calendar', ttl: l.app === 'calendar' ? 15 * 60 : undefined });
    // About an email (given to you, a mention in its comments): held, and dropped once the notice was read elsewhere.
    if (l.app === 'mail') hold(() => (db.getDoc('notices', n.id) as any)?.read === false && send());
    else send();
  }
}

/** A guest wrote in a project's channel (in the portal, or on WhatsApp): the team in that channel hears about it. */
function guestMessages(docs: any[]) {
  for (const m of docs) {
    if (!m || m.userId !== 'guest' || !recent(m.at)) continue;
    const ch = db.getDoc('channels', String(m.channelId)) as any;
    const team: string[] = (ch?.members ?? []).filter((id: string) => reachable(id) && !muted(id, String(ch.id)));
    if (!ch || !team.length || !push.once(`gm:${m.id}`)) continue;
    const client = ch.clientId ? (db.getDoc('clients', ch.clientId) as any) : null;
    const email = String(m.guestEmail ?? '').toLowerCase();
    const person = client ? clientPeople(client, db.allDocs('channels') as any).find((x) => x.email.toLowerCase() === email) : undefined;
    const company = client ? companyOf(email, person?.company, client) : undefined;
    const who = `${person?.name ?? email}${company ? ` (${company})` : ''}`;
    const body = String(m.text ?? '').trim() || (m.files?.length ? 'Sent a file' : m.voice ? 'Sent a voice note' : 'Sent a message');
    for (const uid of team) alert(uid, 'guests', { title: `${who} in #${ch.name}`, body, url: `/chat${q({ ws: ch.workspaceId, id: ch.id, msg: m.id })}`, tag: `chat:${ch.id}`, urgent: true });
  }
}

/**
 * Mail that arrived in someone's inbox: personal mailboxes tell their people; a shared inbox tells only the person
 * the email is assigned to. Only mail from people: never newsletters (they carry an unsubscribe link), notifications
 * and receipts from systems, spam, blocked senders, or mail sent by someone on the team to themselves. Each push waits
 * about 20 seconds and is dropped if the email was read meanwhile (or snoozed, moved, given to someone else).
 */
function mail(docs: any[]) {
  for (const t of docs) {
    if (!t || t.location !== 'inbox' || !t.unread || t.sendAt) continue;
    // Most thread saves are someone reading, moving or replying: only a message that just arrived matters.
    const fresh = (t.messages ?? []).filter((m: any) => recent(m.date) && m.from?.email && fromPerson(m));
    if (!fresh.length) continue;
    const ws = (db.allDocs('workspaces') as any[]).find((w) => (w.accounts ?? []).some((a: any) => a.id === t.accountId));
    const acct = ws?.accounts?.find((a: any) => a.id === t.accountId);
    if (!acct) continue;
    const people: string[] = acct.kind === 'shared' ? (t.assignee && acct.users?.includes(t.assignee) ? [t.assignee] : []) : (acct.users ?? []);
    if (!people.some(reachable)) continue;
    for (const m of fresh) {
      const from = String(m.from.email).toLowerCase();
      if (from === String(acct.email).toLowerCase()) continue;
      // Whoever on the team sent it (from one of their own mailboxes) doesn't get a buzz for their own email.
      const senders = new Set<string>((ws.accounts ?? []).filter((a: any) => String(a.email).toLowerCase() === from).flatMap((a: any) => a.users ?? []));
      const to = people.filter((u) => !senders.has(u) && !blockedBy(u, from));
      if (!to.length || !push.once(`mail:${m.id ?? m.mid}`)) continue;
      const line = String(m.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const still = (uid: string) => {
        const cur = db.getDoc('threads', t.id) as any;
        if (!cur || !cur.unread || cur.location !== 'inbox') return false;
        if (cur.snoozedUntil && cur.snoozedUntil > new Date().toISOString()) return false;
        return acct.kind !== 'shared' || cur.assignee === uid;
      };
      for (const uid of to) hold(() => still(uid) && alert(uid, 'mail', { title: m.from?.name || from, body: `${t.subject}${line ? `\n${line}` : ''}`, url: `/mail${q({ ws: ws.id, id: t.id })}`, tag: `mail:${t.id}` }));
    }
  }
}

/** Called with every change the server sends out live, so every path that writes notices, messages or mail is covered. */
export function onBroadcast(coll: string, upserts: db.Doc[]) {
  if (!upserts.length) return;
  try {
    if (coll === 'notices') notices(upserts);
    else if (coll === 'messages') guestMessages(upserts);
    else if (coll === 'threads') mail(upserts);
  } catch (e) {
    console.error('[push]', e instanceof Error ? e.message : e);
  }
}

/**
 * Calendar reminders, ten minutes before an event (Settings, Notifications, Meetings and events). Returned as notices
 * for the caller to save and send out; the push follows from that like any other notice.
 */
export function eventReminders(): db.Doc[] {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const out: db.Doc[] = [];
  // A repeating event: each of its dates (its id says which; the push opens that date).
  for (const e of expandEvents(db.allDocs('events') as any[], now, now + 10 * 60_000) as any[]) {
    if (e.allDay || !e.userId || !e.start) continue;
    const start = Date.parse(e.start);
    if (!(start > now && start - now <= 10 * 60_000)) continue;
    if (!wants(e.userId, 'meetings') || !push.once(`ev:${e.id}:${e.start}`)) continue;
    const wsId = e.workspaceId ?? (db.allDocs('workspaces') as any[]).find((w) => (w.members ?? []).some((m: any) => m.userId === e.userId))?.id;
    if (!wsId) continue;
    const mins = Math.max(1, Math.round((start - now) / 60_000));
    out.push({ id: `n-${randomBytes(6).toString('hex')}`, userId: e.userId, workspaceId: wsId, kind: 'meeting', text: `Starting in ${mins} minute${mins === 1 ? '' : 's'}: ${String(e.title ?? 'Event').slice(0, 120)}`, at, read: false, link: { app: 'calendar', id: e.id } });
  }
  return out;
}
