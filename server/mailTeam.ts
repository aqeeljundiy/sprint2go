// Team mail on the server: comments, who handles an email, and snoozes, as the app saves them (through /api/sync, the
// same rules for the app and for connected AI apps).
// - Comments: everyone writes their own. A new comment carries the person who saved it; nobody changes or removes
//   someone else's (their author can edit or delete their own).
// - Who handles it: only someone who can open the mailbox, or nobody. The server notes who gave it to them.
// - Snooze: a real time, and "only if no reply" only with a snooze.
import type * as db from './db.ts';

type Note = { id: string; by: string; text: string; at: string };
type Account = { id: string; users?: string[] };

const MAX_NOTE = 4000;
const isTime = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_NOTE) : '');

export function guardTeamMail(d: db.Doc, before: db.Doc | undefined, me: string, account: Account | undefined, now = new Date().toISOString()): db.Doc {
  const t = { ...(d as any) };
  const b = (before ?? {}) as any;

  // Comments.
  const asked: Note[] = Array.isArray(t.notes) ? t.notes.filter((n: any) => n && typeof n.id === 'string') : [];
  const had: Note[] = Array.isArray(b.notes) ? b.notes : [];
  const askedById = new Map(asked.map((n) => [n.id, n]));
  const notes: Note[] = [];
  for (const n of had) {
    const a = askedById.get(n.id);
    if (!a) {
      if (n.by !== me) notes.push(n); // only its author removes a comment
      continue;
    }
    const text = n.by === me ? clean(a.text) : '';
    notes.push(n.by === me && text ? { ...n, text } : n);
  }
  const hadIds = new Set(had.map((n) => n.id));
  for (const a of asked) {
    if (hadIds.has(a.id) || a.by !== me) continue; // nobody writes in someone else's name
    const text = clean(a.text);
    if (!text || a.id.length > 64) continue;
    notes.push({ id: a.id, by: me, text, at: isTime(a.at) ? a.at : now });
  }
  if (notes.length) t.notes = notes;
  else delete t.notes;

  // Who handles it.
  const users = new Set(account?.users ?? []);
  const want = typeof t.assignee === 'string' && t.assignee ? t.assignee : undefined;
  if (want !== (b.assignee || undefined)) {
    if (want && !users.has(want)) {
      if (b.assignee) t.assignee = b.assignee;
      else delete t.assignee;
      if (b.assignedBy) t.assignedBy = b.assignedBy;
      else delete t.assignedBy;
    } else if (want) t.assignedBy = me;
    else {
      delete t.assignee;
      delete t.assignedBy;
    }
  } else if (b.assignedBy) t.assignedBy = b.assignedBy;
  else delete t.assignedBy;

  // Snooze.
  if (!isTime(t.snoozedUntil)) delete t.snoozedUntil;
  if (!t.snoozedUntil || typeof t.snoozeIfNoReply !== 'string' || t.snoozeIfNoReply.length > 64) delete t.snoozeIfNoReply;
  return t as db.Doc;
}
