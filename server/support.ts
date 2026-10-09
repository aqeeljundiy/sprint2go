// The support desk: tickets from the app's Help screen, from the crash screen and from email to support@ (and abuse@,
// postmaster@). Customers see their own tickets in Settings, Help; operators work them in the backend.
import { randomBytes } from 'node:crypto';
import { db } from './db.ts';
import * as platform from './platform.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, subject TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, channel TEXT NOT NULL, requester_email TEXT NOT NULL, requester_name TEXT, requester_user TEXT, workspace_id TEXT, assignee TEXT, tags TEXT NOT NULL DEFAULT '[]', context TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, due_at TEXT, first_reply_at TEXT, resolved_at TEXT, rating TEXT, rating_note TEXT, merged_into TEXT, last_mid TEXT, unread_for_customer INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status, updated_at);
  CREATE INDEX IF NOT EXISTS tickets_requester ON tickets (requester_user);
  CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, author TEXT NOT NULL, author_name TEXT, body TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0, attachments TEXT, mid TEXT);
  CREATE INDEX IF NOT EXISTS ticket_messages_t ON ticket_messages (ticket_id, at);
  CREATE TABLE IF NOT EXISTS macros (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, by TEXT, at TEXT NOT NULL);
`);

const now = () => new Date().toISOString();
export type Status = 'new' | 'open' | 'waiting' | 'resolved' | 'closed';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export interface Ticket {
  id: string;
  number: number;
  subject: string;
  status: Status;
  priority: Priority;
  channel: 'app' | 'email' | 'crash';
  requester: { email: string; name: string | null; userId: string | null };
  workspaceId: string | null;
  assignee: string | null;
  tags: string[];
  context: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  firstReplyAt: string | null;
  resolvedAt: string | null;
  rating: 'good' | 'okay' | 'bad' | null;
  ratingNote: string | null;
  mergedInto: string | null;
  lastMid: string | null;
  unreadForCustomer: boolean;
}
export interface TicketMessage {
  id: string;
  at: string;
  kind: 'customer' | 'operator' | 'system';
  author: string;
  authorName: string | null;
  body: string;
  internal: boolean;
  attachments: { name: string; url: string; size?: string }[];
}
const row = (r: any): Ticket => ({
  id: r.id,
  number: r.number,
  subject: r.subject,
  status: r.status,
  priority: r.priority,
  channel: r.channel,
  requester: { email: r.requester_email, name: r.requester_name, userId: r.requester_user },
  workspaceId: r.workspace_id,
  assignee: r.assignee,
  tags: JSON.parse(r.tags || '[]'),
  context: r.context ? JSON.parse(r.context) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  dueAt: r.due_at,
  firstReplyAt: r.first_reply_at,
  resolvedAt: r.resolved_at,
  rating: r.rating,
  ratingNote: r.rating_note,
  mergedInto: r.merged_into,
  lastMid: r.last_mid,
  unreadForCustomer: !!r.unread_for_customer,
});
const msgRow = (r: any): TicketMessage => ({ id: r.id, at: r.at, kind: r.kind, author: r.author, authorName: r.author_name, body: r.body, internal: !!r.internal, attachments: r.attachments ? JSON.parse(r.attachments) : [] });

/* ---------- what a ticket's attachments may open ---------- */

/** What operators see instead of an attachment that wasn't sent with its ticket (tickets from before 9 Oct). */
export const OLD_ATTACHMENT = 'Attachment from before 9 Oct, ask the person to send it again';
/** How long before a message a customer's own upload still counts as sent with it (Help uploads while they write). */
const UPLOAD_WINDOW = 24 * 3600_000;
type FileFacts = { workspaceId: string; by: string; at?: string | null };
/**
 * Whether a file was sent with this ticket message, so support may open it: an upload of the ticket's own requester
 * made while they wrote it (Help uploads files as they're added), or a file that came with the email to support (kept
 * by the mail engine as the message arrived). Tickets made before 9 Oct could point at any file at all; theirs fail
 * this and show OLD_ATTACHMENT instead of opening.
 */
export function fileFitsTicket(f: FileFacts | null | undefined, requesterUser: string | null, messageAt: string) {
  if (!f?.at) return false;
  const at = Date.parse(f.at);
  const msg = Date.parse(messageAt);
  if (!Number.isFinite(at) || !Number.isFinite(msg)) return false;
  if (f.workspaceId === 'platform' && f.by === 'mail') return Math.abs(msg - at) <= 5 * 60_000;
  return !!requesterUser && f.by === requesterUser && at <= msg + 60_000 && at >= msg - UPLOAD_WINDOW;
}
const fileIdOf = (url: string) => /^\/api\/files\/([a-f0-9]{32})$/.exec(String(url ?? ''))?.[1] ?? '';
/** A ticket's messages for operators: a customer's attachment that wasn't sent with its ticket says so instead of linking. */
export function messagesForOperators(t: Ticket, fileInfo: (id: string) => FileFacts | null) {
  return messagesOf(t.id, true).map((m) =>
    m.kind !== 'customer'
      ? m
      : { ...m, attachments: m.attachments.map((a) => (fileFitsTicket(fileInfo(fileIdOf(a.url)), t.requester.userId, m.at) ? a : { name: a.name, url: '', size: a.size, blocked: OLD_ATTACHMENT })) },
  );
}

export const ticket = (id: string) => {
  const r = db.prepare('SELECT * FROM tickets WHERE id = ? OR number = ?').get(id, Number(id) || -1);
  return r ? row(r) : null;
};
export const tickets = () => (db.prepare('SELECT * FROM tickets ORDER BY updated_at DESC LIMIT 2000').all() as any[]).map(row);
export const ticketsOfUser = (userId: string, email: string) =>
  (db.prepare('SELECT * FROM tickets WHERE (requester_user = ? OR requester_email = ?) AND merged_into IS NULL ORDER BY updated_at DESC').all(userId, email.toLowerCase()) as any[]).map(row);
export const ticketsOfWorkspace = (wsId: string) => (db.prepare('SELECT * FROM tickets WHERE workspace_id = ? ORDER BY updated_at DESC').all(wsId) as any[]).map(row);
export const messagesOf = (ticketId: string, withInternal: boolean) =>
  (db.prepare(`SELECT * FROM ticket_messages WHERE ticket_id = ? ${withInternal ? '' : 'AND internal = 0'} ORDER BY at`).all(ticketId) as any[]).map(msgRow);
export const ticketByMid = (mid: string) => {
  const r = db.prepare('SELECT t.* FROM tickets t JOIN ticket_messages m ON m.ticket_id = t.id WHERE m.mid = ? LIMIT 1').get(mid) ?? db.prepare('SELECT * FROM tickets WHERE last_mid = ?').get(mid);
  return r ? row(r) : null;
};

/** When the first reply is due: urgent tickets and paying companies sooner. */
function dueFor(priority: Priority, paying: boolean) {
  const h = platform.settings().slaHours;
  const hours = priority === 'urgent' ? h.urgent : paying ? h.paid : h.other;
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function createTicket(t: { subject: string; body: string; channel: Ticket['channel']; email: string; name?: string | null; userId?: string | null; workspaceId?: string | null; paying: boolean; priority?: Priority; tags?: string[]; context?: Record<string, unknown>; attachments?: TicketMessage['attachments']; mid?: string }) {
  const number = ((db.prepare('SELECT MAX(number) AS n FROM tickets').get() as { n: number | null }).n ?? 1000) + 1;
  const id = 't-' + randomBytes(6).toString('hex');
  const priority = t.priority ?? (t.channel === 'crash' ? 'high' : 'normal');
  const at = now();
  db.prepare(
    'INSERT INTO tickets (id, number, subject, status, priority, channel, requester_email, requester_name, requester_user, workspace_id, tags, context, created_at, updated_at, due_at, last_mid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, number, t.subject.slice(0, 200) || '(no subject)', 'new', priority, t.channel, t.email.toLowerCase(), t.name ?? null, t.userId ?? null, t.workspaceId ?? null, JSON.stringify(t.tags ?? []), t.context ? JSON.stringify(t.context) : null, at, at, dueFor(priority, t.paying), t.mid ?? null);
  addMessage(id, { kind: 'customer', author: t.email.toLowerCase(), authorName: t.name ?? null, body: t.body, internal: false, attachments: t.attachments, mid: t.mid });
  if (t.workspaceId) platform.event('ticket.opened', t.workspaceId, t.userId ?? null, `#${number} ${t.subject.slice(0, 80)}`);
  return ticket(id)!;
}

export function addMessage(ticketId: string, m: { kind: TicketMessage['kind']; author: string; authorName?: string | null; body: string; internal: boolean; attachments?: TicketMessage['attachments']; mid?: string }) {
  const id = 'tm-' + randomBytes(6).toString('hex');
  db.prepare('INSERT INTO ticket_messages (id, ticket_id, at, kind, author, author_name, body, internal, attachments, mid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    ticketId,
    now(),
    m.kind,
    m.author,
    m.authorName ?? null,
    m.body.slice(0, 50_000),
    m.internal ? 1 : 0,
    m.attachments?.length ? JSON.stringify(m.attachments) : null,
    m.mid ?? null,
  );
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), ticketId);
  return id;
}

/** A customer wrote again: the ticket opens again (a resolved one too). */
export function customerReplied(ticketId: string) {
  db.prepare("UPDATE tickets SET status = CASE WHEN status IN ('new') THEN 'new' ELSE 'open' END, resolved_at = NULL, rating = NULL WHERE id = ?").run(ticketId);
}
/** An operator answered in public: the clock stops and the ticket waits on the customer. */
export function operatorReplied(ticketId: string, nextStatus: Status, mid: string | null) {
  db.prepare("UPDATE tickets SET first_reply_at = COALESCE(first_reply_at, ?), status = ?, resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN ? ELSE NULL END, last_mid = COALESCE(?, last_mid), unread_for_customer = 1 WHERE id = ?").run(now(), nextStatus, nextStatus, now(), mid, ticketId);
}
export function update(ticketId: string, p: { status?: Status; priority?: Priority; assignee?: string | null; tags?: string[]; subject?: string; workspaceId?: string | null }) {
  const t = ticket(ticketId);
  if (!t) return null;
  if (p.status) db.prepare("UPDATE tickets SET status = ?, resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, ?) ELSE NULL END WHERE id = ?").run(p.status, p.status, now(), t.id);
  if (p.priority) db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(p.priority, t.id);
  if ('assignee' in p) db.prepare('UPDATE tickets SET assignee = ? WHERE id = ?').run(p.assignee ?? null, t.id);
  if (p.tags) db.prepare('UPDATE tickets SET tags = ? WHERE id = ?').run(JSON.stringify(p.tags.slice(0, 20)), t.id);
  if (p.subject) db.prepare('UPDATE tickets SET subject = ? WHERE id = ?').run(p.subject.slice(0, 200), t.id);
  if ('workspaceId' in p) db.prepare('UPDATE tickets SET workspace_id = ? WHERE id = ?').run(p.workspaceId ?? null, t.id);
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
  return ticket(t.id);
}
export const markSeenByCustomer = (ticketId: string) => db.prepare('UPDATE tickets SET unread_for_customer = 0 WHERE id = ?').run(ticketId);
export function rate(ticketId: string, rating: 'good' | 'okay' | 'bad', note?: string) {
  db.prepare('UPDATE tickets SET rating = ?, rating_note = ? WHERE id = ?').run(rating, note?.slice(0, 1000) ?? null, ticketId);
}
/** Moves every message of one ticket into another and closes it. */
export function merge(fromId: string, intoId: string) {
  db.prepare('UPDATE ticket_messages SET ticket_id = ? WHERE ticket_id = ?').run(intoId, fromId);
  db.prepare("UPDATE tickets SET merged_into = ?, status = 'closed', resolved_at = ? WHERE id = ?").run(intoId, now(), fromId);
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), intoId);
}
/** Resolved for a week without a word: closed. */
export const closeStale = () => db.prepare("UPDATE tickets SET status = 'closed' WHERE status = 'resolved' AND resolved_at < ?").run(new Date(Date.now() - 7 * 86_400_000).toISOString());

/* ---------- saved replies ---------- */

export const macros = () => db.prepare('SELECT id, title, body, by, at FROM macros ORDER BY title').all() as { id: string; title: string; body: string; by: string; at: string }[];
export function saveMacro(m: { id?: string; title: string; body: string }, by: string) {
  const id = m.id || 'mc-' + randomBytes(5).toString('hex');
  db.prepare('INSERT INTO macros (id, title, body, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body').run(id, m.title.slice(0, 120), m.body.slice(0, 10_000), by, now());
  return id;
}
export const deleteMacro = (id: string) => db.prepare('DELETE FROM macros WHERE id = ?').run(id);

/* ---------- numbers ---------- */

export function stats(since: string) {
  const rows = db.prepare('SELECT created_at, first_reply_at, rating, status FROM tickets WHERE created_at >= ? AND merged_into IS NULL').all(since) as { created_at: string; first_reply_at: string | null; rating: string | null; status: string }[];
  const replyMins = rows.filter((r) => r.first_reply_at).map((r) => (Date.parse(r.first_reply_at!) - Date.parse(r.created_at)) / 60_000).sort((a, b) => a - b);
  const rated = rows.filter((r) => r.rating);
  return {
    opened: rows.length,
    medianFirstReplyMin: replyMins.length ? Math.round(replyMins[Math.floor(replyMins.length / 2)]) : null,
    satisfaction: rated.length ? Math.round((rated.filter((r) => r.rating === 'good').length / rated.length) * 100) : null,
    rated: rated.length,
  };
}
export const openCount = () => (db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status IN ('new', 'open') AND merged_into IS NULL").get() as { n: number }).n;
