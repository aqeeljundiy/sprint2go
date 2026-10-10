// Chat things that happen later, on the server, plus the rules that keep them honest:
//  - Send later: a message saved with `sendAt` waits, seen only by its author, until its time comes. Then it goes out
//    for real (its time becomes now) and the people it's for hear about it, the same way as a message sent there and
//    then (direct messages, mentions, replies to their message).
//  - Remind me: each person's saved messages live in their own settings (prefs, `s2g-chat-saved:<id>`). One with a
//    reminder time becomes a notice in their bell (and on their phone) when that time comes, once.
//  - Mute: whether someone muted a conversation (prefs, `s2g-chat-muted:<id>`), for the push rules.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { msg, phrase, type Msg } from '../src/i18n/index.ts';
import { chatRecipients, isGroupDm, type NoticeWhy } from '../src/chatFollow.ts';

type Doc = db.Doc;
const MAX_AHEAD = 120 * 86_400_000; // a message can wait up to 120 days
const iso = (t: number) => new Date(t).toISOString();
export const savedKey = (userId: string) => `s2g-chat-saved:${userId}`;
export const mutedKey = (userId: string) => `s2g-chat-muted:${userId}`;

// Waiting messages are looked up often (every 30 seconds) and are few: a small index finds them without reading the rest.
db.db.exec("CREATE INDEX IF NOT EXISTS docs_msg_send_at ON docs (json_extract(data, '$.sendAt')) WHERE coll = 'messages' AND json_extract(data, '$.sendAt') IS NOT NULL");
const dueMessages = db.db.prepare("SELECT data FROM docs WHERE coll = 'messages' AND json_extract(data, '$.sendAt') IS NOT NULL AND json_extract(data, '$.sendAt') <= ?");
const prefsWithReminders = db.db.prepare("SELECT data FROM docs WHERE coll = 'prefs' AND instr(data, 'remindAt') > 0");

/** A message still waiting to be sent (Send later). */
export const scheduled = (m: any) => !!m && typeof m.sendAt === 'string' && m.sendAt !== '';
/** Waiting messages are their author's alone until they go out. */
export const hiddenFrom = (m: any, userId: string) => scheduled(m) && m.userId !== userId;

/**
 * Someone's own message as they save it: a send time only on a message that hasn't gone out yet, never more than
 * 120 days off. A time that has passed stays: the next round sends it (with its notices) within half a minute.
 */
export function guardOwnMessage(d: Doc, before: any, now = Date.now()): Doc {
  const want = (d as any).sendAt;
  if (want === undefined || want === null || want === '') {
    if (!('sendAt' in d)) return d;
    const { sendAt: _s, ...rest } = d as any;
    return rest as Doc;
  }
  const { sendAt: _s, ...rest } = d as any;
  if (before && !scheduled(before)) return rest as Doc; // it went out already: it can't be taken back to wait again
  const t = Date.parse(String(want));
  if (!Number.isFinite(t)) return rest as Doc;
  return { ...rest, sendAt: iso(Math.min(t, now + MAX_AHEAD)) } as Doc;
}

const firstName = (users: Map<string, any>, id: string) => String(users.get(id)?.name ?? 'Someone').split(' ')[0];
const quote = (text: string) => `“${text.replace(/\s+/g, ' ').trim().slice(0, 80)}”`;
/** A notice saved with msg(): the English `text`, and `tr` so each reader sees it in their own language. */
const notice = (userId: string, workspaceId: string, kind: string, words: { text: string; tr?: unknown }, link: Record<string, string>, at: string): Doc => ({ id: `n-${randomBytes(6).toString('hex')}`, userId, workspaceId, kind, text: words.text.slice(0, 300), ...(words.tr ? { tr: words.tr } : {}), at, read: false, link });

const repliesOf = db.db.prepare("SELECT data FROM docs WHERE coll = 'messages' AND json_extract(data, '$.parentId') = ?");

/** Who hears about a message that just went out: the others in a direct or group message, people it mentions, and a thread's followers (src/chatFollow.ts). */
export function noticesFor(m: any, at: string, users: Map<string, any>): Doc[] {
  const ch = db.getDoc('channels', String(m.channelId)) as any;
  if (!ch) return [];
  const who = firstName(users, m.userId);
  const where = whereOf(ch);
  const body = String(m.text ?? '') || (m.voice ? 'a voice note' : m.files?.length ? 'a file' : '');
  // What a message without words is, in the reader's language ("a voice note"); its own words stay as written.
  const said = String(m.text ?? '') ? quote(body) : body ? phrase('“{what}”', { what: phrase(body) }) : quote(body);
  const link = { app: 'chat', id: String(ch.id), msg: String(m.id) };
  const root = m.parentId ? (db.getDoc('messages', String(m.parentId)) as any) : null;
  const replies = root ? (repliesOf.all(String(root.id)) as { data: string }[]).map((r) => JSON.parse(r.data)).filter((x) => x.id !== m.id && !scheduled(x)) : [];
  return chatRecipients(m, { kind: ch.kind, members: ch.members ?? [], guests: ch.guests }, root ? { root, replies } : null, (id) => firstName(users, id)).map(({ id, why }) =>
    notice(id, ch.workspaceId, 'mention', noticeWords(why, who, where, said), link, at),
  );
}
/** Where a message was, as a notice says it: "#design", "a message" (a DM) or "a group message". */
export const whereOf = (ch: { kind: string; name?: string; members?: string[]; guests?: unknown[] }) => (ch.kind === 'dm' ? (isGroupDm(ch as any) ? phrase('a group message') : phrase('a message')) : `#${ch.name}`);
/** A chat notice's words for each reason (chatRecipients), saved with msg() so each reader sees their own language. */
export function noticeWords(why: NoticeWhy, who: string, where: string | Msg, said: string | Msg) {
  switch (why) {
    case 'dm':
      return msg('{name} messaged you: {quote}', { name: who, quote: said });
    case 'group':
      return msg('{name} in a group message: {quote}', { name: who, quote: said });
    case 'mention':
      return msg('{name} mentioned you in {channel}: {quote}', { name: who, channel: where, quote: said });
    case 'reply':
      return msg('{name} replied to your message in {where}: {quote}', { name: who, where, quote: said });
    case 'thread':
      return msg('{name} replied in a thread you follow in {where}: {quote}', { name: who, where, quote: said });
  }
}

/** Messages whose time has come: they go out now, with the notices they bring. */
export function publishDue(now = Date.now()): { messages: Doc[]; notices: Doc[] } {
  const due = (dueMessages.all(iso(now)) as { data: string }[]).map((r) => JSON.parse(r.data));
  if (!due.length) return { messages: [], notices: [] };
  const at = iso(now);
  const users = new Map((db.allDocs('users') as any[]).map((u) => [String(u.id), u]));
  const messages = due.map((m) => {
    const { sendAt: _s, ...rest } = m;
    return { ...rest, at } as Doc;
  });
  return { messages, notices: messages.flatMap((m) => noticesFor(m, at, users)) };
}

type Saved = { id: string; channelId?: string; at?: string; remindAt?: string; reminded?: boolean };

/**
 * Saved messages whose reminder time has come: a notice for their person, and the reminder marked as done in their
 * settings (so it never comes twice). `canSee` says whether they can still read the message; if not, the notice
 * doesn't quote it.
 */
export function remindersDue(now: number, canSee: (userId: string, m: any) => boolean): { prefs: Doc[]; notices: Doc[] } {
  const prefs: Doc[] = [];
  const notices: Doc[] = [];
  const at = iso(now);
  let users: Map<string, any> | null = null;
  for (const row of prefsWithReminders.all() as { data: string }[]) {
    const p = JSON.parse(row.data);
    const key = savedKey(String(p.id));
    const list = p.value?.[key];
    if (!Array.isArray(list)) continue;
    const due = (list as Saved[]).filter((x) => x && typeof x.remindAt === 'string' && !x.reminded && Date.parse(x.remindAt) <= now);
    if (!due.length) continue;
    for (const x of due) {
      const m = db.getDoc('messages', String(x.id)) as any;
      const ch = db.getDoc('channels', String(m?.channelId ?? x.channelId ?? '')) as any;
      if (!ch) continue; // the conversation is gone: nothing to land on
      users ??= new Map((db.allDocs('users') as any[]).map((u) => [String(u.id), u]));
      const visible = !!m && canSee(String(p.id), m);
      const author = m?.guestEmail ? String((ch.guests ?? []).find((g: any) => g.email === m.guestEmail)?.name ?? 'A guest') : firstName(users, String(m?.userId ?? ''));
      const where = ch.kind === 'dm' ? phrase('a direct message') : `#${ch.name}`;
      const text = visible ? msg('Reminder: {name} in {where}: {quote}', { name: author, where, quote: String(m.text ?? '') ? quote(String(m.text)) : phrase('“{what}”', { what: phrase('a file') }) }) : msg('Reminder: a message you saved');
      notices.push(notice(String(p.id), ch.workspaceId, 'task', text, { app: 'chat', id: String(ch.id), msg: String(x.id) }, at));
    }
    const done = new Set(due);
    prefs.push({ ...p, value: { ...p.value, [key]: (list as Saved[]).map((x) => (done.has(x) ? { ...x, reminded: true } : x)) } });
  }
  return { prefs, notices };
}

/**
 * Someone's settings saved from an app that hadn't heard yet that a reminder went off: it stays done, so the same
 * reminder isn't sent again. A new time on the same message is a new reminder.
 */
export function keepReminded(d: Doc, before: any): Doc {
  const key = savedKey(String(d.id));
  const was = before?.value?.[key];
  const now = (d as any).value?.[key];
  if (!Array.isArray(was) || !Array.isArray(now)) return d;
  const done = new Set(was.filter((x: Saved) => x?.reminded).map((x: Saved) => `${x.id}|${x.remindAt}`));
  if (!done.size) return d;
  const list = now.map((x: Saved) => (x && !x.reminded && done.has(`${x.id}|${x.remindAt}`) ? { ...x, reminded: true } : x));
  return { ...d, value: { ...(d as any).value, [key]: list } } as Doc;
}

/** Whether this person muted this conversation (for an hour, until tomorrow, or for good). */
export function mutedFor(prefsValue: Record<string, any> | undefined, userId: string, channelId: string, now = Date.now()) {
  const m = prefsValue?.[mutedKey(userId)]?.[channelId];
  return m === 'always' || (typeof m === 'string' && Date.parse(m) > now);
}
