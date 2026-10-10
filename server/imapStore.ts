// sprint2go mail as IMAP folders (server/imap.ts serves them). sprint2go keeps conversations (threads) with one place
// each (inbox, Done/archive, trash, spam, drafts), snoozing, a star, read state and labels; IMAP wants folders of
// single messages with flags and UIDs that never change. This file is the bridge:
//  - Each message of a thread shows in one home folder: Sent when this mailbox wrote it, otherwise the thread's place
//    (INBOX, Archive, Snoozed while snoozed, Trash, Spam, Drafts), plus a folder per label.
//  - Flags come from the thread: unread means its newest incoming message is unseen (and any the mail app marked
//    unread itself), a star flags it (and any the mail app flagged), a later message from this mailbox is \Answered.
//  - Folder contents are worked out from the threads each time, and UIDs, UIDVALIDITY and MODSEQ are kept in the
//    database per mailbox and folder, so they survive restarts. A message that leaves a folder and comes back gets a
//    new UID, as IMAP requires.
//  - Changes from a mail app (read, flagged, moved, deleted, appended) are saved through the app's own rules
//    (index.ts applySync), so they show in sprint2go at once and the other way round.
import { createHash, randomBytes } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser, type ParsedMail } from 'mailparser';
import * as db from './db.ts';
import * as raws from './mailRaw.ts';
import * as filters from './mailFilters.ts';
import { labelPath, labelsFor, type MailLabel } from '../src/mailFilterMatch.ts';
import { addDays, companyTz, localParts, zonedTime } from '../src/jobTimes.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS imap_boxes (box TEXT PRIMARY KEY, uidvalidity INTEGER NOT NULL, uidnext INTEGER NOT NULL, modseq INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS imap_msgs (box TEXT NOT NULL, uid INTEGER NOT NULL, mkey TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, flags TEXT NOT NULL, kw TEXT NOT NULL DEFAULT '', modseq INTEGER NOT NULL, PRIMARY KEY (box, uid));
  CREATE INDEX IF NOT EXISTS imap_msgs_thread ON imap_msgs (thread_id);
  CREATE INDEX IF NOT EXISTS docs_threads_account ON docs (json_extract(data, '$.accountId')) WHERE coll = 'threads';
`);

/* ---------- what threads look like here ---------- */

export type P = { name: string; email: string };
export type Msg = { id: string; mid?: string; from: P; to: P[]; bcc?: P[]; date: string; body?: string; html?: string; attachments?: { name: string; size?: string; url?: string }[]; delivery?: { state?: string } };
export type Thread = { id: string; accountId: string; workspaceId?: string; subject: string; location: string; starred?: boolean; unread?: boolean; labels?: string[]; messages: Msg[]; snoozedUntil?: string; sendAt?: string };

/** A mailbox someone may open in a mail app, as this file needs it. */
export interface Mailbox {
  id: string; // the account id
  email: string;
  name: string;
  kind: string;
  wsId: string;
  wsName: string;
  hosted: boolean; // lives here (not a forwarded copy of a Google or Microsoft mailbox)
  addresses: Set<string>; // its address and the aliases that deliver into it
  tz: string;
  primary: boolean; // shown at the top level (INBOX…); the others are folder trees under their address
}

export type FolderId = 'inbox' | 'sent' | 'drafts' | 'archive' | 'snoozed' | 'trash' | 'spam' | `label:${string}`;
export interface Folder {
  name: string; // as the mail app sees it (before modified UTF-7)
  box: string; // its key in the database
  id: FolderId;
  mailbox: Mailbox;
  special: string | null; // \Sent, \Drafts…
}

const LOCATION_FOLDERS: { id: FolderId; top: string; sub: string; special: string | null }[] = [
  { id: 'inbox', top: 'INBOX', sub: 'Inbox', special: null },
  { id: 'sent', top: 'Sent', sub: 'Sent', special: '\\Sent' },
  { id: 'drafts', top: 'Drafts', sub: 'Drafts', special: '\\Drafts' },
  { id: 'archive', top: 'Archive', sub: 'Archive', special: '\\Archive' },
  { id: 'snoozed', top: 'Snoozed', sub: 'Snoozed', special: null },
  { id: 'trash', top: 'Trash', sub: 'Trash', special: '\\Trash' },
  { id: 'spam', top: 'Spam', sub: 'Spam', special: '\\Junk' },
];
const RESERVED = new Set(LOCATION_FOLDERS.flatMap((f) => [f.top.toLowerCase(), f.sub.toLowerCase()]));

/** The labels a mailbox has (its own and the company's: server/mailFilters.ts), read once per call. */
export const labelsOf = (mb: Pick<Mailbox, 'id' | 'wsId'>, all = db.allDocs('mailLabels') as unknown as MailLabel[]) => labelsFor(all, mb.wsId, mb.id);
/** A label's folder name: its path ("Clients/KopiKita"), with a top level that would clash with a place renamed. */
export function labelFolderName(l: MailLabel, all: MailLabel[]) {
  const path = labelPath(l, all);
  const [top, ...rest] = path.split('/');
  return [RESERVED.has(top.toLowerCase()) ? `Label ${top}` : top, ...rest].join('/');
}

/** Every folder of these mailboxes, in the order mail apps list them. Labels nest with "/" (Clients/KopiKita). */
export function foldersOf(mailboxes: Mailbox[]): Folder[] {
  const out: Folder[] = [];
  const all = db.allDocs('mailLabels') as unknown as MailLabel[];
  for (const mb of [...mailboxes].sort((a, b) => Number(b.primary) - Number(a.primary))) {
    const prefix = mb.primary ? '' : `${mb.email}/`;
    for (const f of LOCATION_FOLDERS) out.push({ name: prefix + (mb.primary ? f.top : f.sub), box: `${mb.id}/${f.id}`, id: f.id, mailbox: mb, special: mb.primary ? f.special : null });
    const mine = labelsOf(mb, all);
    for (const l of mine) out.push({ name: prefix + labelFolderName(l, mine), box: `${mb.id}/label:${l.id}`, id: `label:${l.id}`, mailbox: mb, special: null });
  }
  return out;
}

/* ---------- reading threads ---------- */

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** One command's view of the threads: each mailbox read once, fresh for the next command. */
export class Ctx {
  private threads = new Map<string, Thread[]>();
  private rawKinds = new Map<string, Map<string, { kind: string; fp: string; size: number }>>();
  threadsOf(accountId: string): Thread[] {
    let t = this.threads.get(accountId);
    if (!t) {
      t = (db.db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND json_extract(data, '$.accountId') = ?").all(accountId) as { data: string }[]).map((r) => JSON.parse(r.data) as Thread).filter((x) => Array.isArray(x.messages));
      this.threads.set(accountId, t);
    }
    return t;
  }
  kept(accountId: string) {
    let k = this.rawKinds.get(accountId);
    if (!k) this.rawKinds.set(accountId, (k = raws.sizes(this.threadsOf(accountId).map((t) => t.id))));
    return k;
  }
  forget(accountId: string) {
    this.threads.delete(accountId);
    this.rawKinds.delete(accountId);
  }
}

const isFrom = (mb: Mailbox, m: Msg) => mb.addresses.has(lower(m.from?.email));
const snoozedNow = (t: Thread) => !!t.snoozedUntil && t.snoozedUntil > new Date().toISOString();

/** The folders one message shows in. Mail waiting out its sender's Undo hasn't been sent yet, so it shows nowhere. */
export function homesOf(t: Thread, m: Msg, mb: Mailbox, labelIds: Set<string> = new Set(labelsOf(mb).map((l) => l.id))): FolderId[] {
  if (m.delivery?.state === 'held') return [];
  if (t.location === 'drafts') return t.sendAt ? [] : ['drafts'];
  if (t.location === 'trash') return ['trash'];
  if (t.location === 'spam') return ['spam'];
  const out: FolderId[] = [isFrom(mb, m) ? 'sent' : snoozedNow(t) ? 'snoozed' : t.location === 'archive' ? 'archive' : 'inbox'];
  for (const l of t.labels ?? []) if (labelIds.has(l)) out.push(`label:${l}`);
  return out;
}

/** The message that carries the thread's unread state and star: its newest incoming one (else its newest). */
function leadOf(t: Thread, mb: Mailbox): Msg | undefined {
  const shown = t.messages.filter((m) => m.delivery?.state !== 'held');
  const incoming = shown.filter((m) => !isFrom(mb, m));
  return (incoming.length ? incoming : shown).at(-1);
}

/** What a draft says, so a draft changed in sprint2go becomes a new message in the mail app (IMAP messages never change). */
const fingerprint = (t: Thread, m: Msg) => createHash('sha256').update(JSON.stringify([t.subject, m.from, m.to, m.bcc, m.body, m.html, (m.attachments ?? []).map((a) => [a.name, a.url])])).digest('hex').slice(0, 16);

function keyOf(t: Thread, m: Msg, kept: Map<string, { kind: string }>) {
  const base = `${t.id} ${m.id}`;
  if (kept.get(base)?.kind === 'raw') return `${base} r`;
  return t.location === 'drafts' ? `${base} d${fingerprint(t, m)}` : base;
}

/** Flags as the mail app sees them. `kw`: what the mail app set itself on this copy. */
export function flagsOf(t: Thread, m: Msg, mb: Mailbox, kw: Set<string>): string[] {
  const lead = leadOf(t, mb);
  const out: string[] = [];
  if (!(t.unread && (m === lead || kw.has('\\Unseen')))) out.push('\\Seen');
  if (t.starred && (m === lead || kw.has('\\Flagged'))) out.push('\\Flagged');
  const i = t.messages.indexOf(m);
  if (kw.has('\\Answered') || t.messages.slice(i + 1).some((x) => isFrom(mb, x) && x.delivery?.state !== 'held')) out.push('\\Answered');
  if (t.location === 'drafts') out.push('\\Draft');
  if (kw.has('\\Deleted')) out.push('\\Deleted');
  for (const k of kw) if (!k.startsWith('\\')) out.push(k);
  return out;
}
const kwSet = (kw: string) => new Set(kw.split(' ').filter(Boolean));

/* ---------- a folder's state ---------- */

export interface Entry {
  uid: number;
  key: string;
  tid: string;
  mid: string;
  flags: string[];
  modseq: number;
}
export interface BoxState {
  uidvalidity: number;
  uidnext: number;
  modseq: number;
  entries: Entry[]; // by UID
}

function boxRow(box: string) {
  let r = db.db.prepare('SELECT uidvalidity, uidnext, modseq FROM imap_boxes WHERE box = ?').get(box) as { uidvalidity: number; uidnext: number; modseq: number } | undefined;
  if (!r) {
    // A new value each time a folder is made, so a mail app never mixes up two folders that had the same name.
    const last = (db.db.prepare('SELECT MAX(uidvalidity) AS v FROM imap_boxes').get() as { v: number | null }).v ?? 0;
    r = { uidvalidity: Math.max(last + 1, Math.floor(Date.now() / 1000)), uidnext: 1, modseq: 1 };
    db.db.prepare('INSERT INTO imap_boxes (box, uidvalidity, uidnext, modseq) VALUES (?, ?, ?, ?)').run(box, r.uidvalidity, r.uidnext, r.modseq);
  }
  return r;
}

/**
 * Brings a folder's UIDs up to date with the threads: new messages get the next UIDs (oldest first), messages that
 * left lose theirs, changed flags get a new MODSEQ. One transaction.
 */
export function sync(f: Folder, ctx: Ctx): BoxState {
  const mb = f.mailbox;
  const threads = ctx.threadsOf(mb.id);
  const kept = ctx.kept(mb.id);
  const want: { key: string; t: Thread; m: Msg }[] = [];
  const labelIds = new Set(labelsOf(mb).map((l) => l.id));
  for (const t of threads) for (const m of t.messages) if (m && homesOf(t, m, mb, labelIds).includes(f.id)) want.push({ key: keyOf(t, m, kept), t, m });
  db.db.exec('BEGIN IMMEDIATE');
  try {
    const box = boxRow(f.box);
    const rows = db.db.prepare('SELECT uid, mkey, thread_id, message_id, flags, kw, modseq FROM imap_msgs WHERE box = ?').all(f.box) as { uid: number; mkey: string; thread_id: string; message_id: string; flags: string; kw: string; modseq: number }[];
    const byKey = new Map(rows.map((r) => [r.mkey, r]));
    const wanted = new Map(want.map((w) => [w.key, w]));
    const del = db.db.prepare('DELETE FROM imap_msgs WHERE box = ? AND uid = ?');
    for (const r of rows) if (!wanted.has(r.mkey)) del.run(f.box, r.uid);
    const upd = db.db.prepare('UPDATE imap_msgs SET flags = ?, modseq = ? WHERE box = ? AND uid = ?');
    const ins = db.db.prepare('INSERT INTO imap_msgs (box, uid, mkey, thread_id, message_id, flags, kw, modseq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const entries: Entry[] = [];
    for (const r of rows) {
      const w = wanted.get(r.mkey);
      if (!w) continue;
      const flags = flagsOf(w.t, w.m, mb, kwSet(r.kw));
      let modseq = r.modseq;
      if (flags.join(' ') !== r.flags) (modseq = ++box.modseq), upd.run(flags.join(' '), modseq, f.box, r.uid);
      entries.push({ uid: r.uid, key: r.mkey, tid: w.t.id, mid: w.m.id, flags, modseq });
    }
    const fresh = want.filter((w) => !byKey.has(w.key)).sort((a, b) => (a.m.date < b.m.date ? -1 : a.m.date > b.m.date ? 1 : 0));
    for (const w of fresh) {
      const flags = flagsOf(w.t, w.m, mb, new Set());
      const e: Entry = { uid: box.uidnext++, key: w.key, tid: w.t.id, mid: w.m.id, flags, modseq: ++box.modseq };
      ins.run(f.box, e.uid, e.key, e.tid, e.mid, flags.join(' '), '', e.modseq);
      entries.push(e);
    }
    db.db.prepare('UPDATE imap_boxes SET uidnext = ?, modseq = ? WHERE box = ?').run(box.uidnext, box.modseq, f.box);
    db.db.exec('COMMIT');
    entries.sort((a, b) => a.uid - b.uid);
    return { uidvalidity: box.uidvalidity, uidnext: box.uidnext, modseq: box.modseq, entries };
  } catch (e) {
    db.db.exec('ROLLBACK');
    throw e;
  }
}

/** The thread and message behind an entry, as they are now (null when the thread is gone). */
export function lookup(ctx: Ctx, mb: Mailbox, tid: string, mid: string): { t: Thread; m: Msg } | null {
  const t = ctx.threadsOf(mb.id).find((x) => x.id === tid) ?? (db.getDoc('threads', tid) as Thread | undefined);
  const m = t?.messages?.find((x) => x.id === mid);
  return t && m && t.accountId === mb.id ? { t, m } : null;
}

/* ---------- the source of a message ---------- */

const midOf = (t: Thread, m: Msg) => m.mid || `<${m.id}.${t.id}@sprint2go>`;
const fileBuffer = (url: string | undefined, wsId: string): Buffer | null => {
  const f = /^\/api\/files\/([a-f0-9]{32})$/.exec(url ?? '');
  if (f) return db.fileInfo(f[1])?.workspaceId === wsId ? db.fileData(f[1]) : null;
  const d = /^data:[^;,]*;base64,(.+)$/.exec(url ?? '');
  return d ? Buffer.from(d[1], 'base64') : null;
};

/**
 * The RFC 822 source of a message: kept as it was received or sent, else rebuilt from the thread (and kept, so it
 * reads the same every time).
 */
export async function source(t: Thread, m: Msg, mb: Mailbox): Promise<Buffer> {
  const have = raws.rawOf(t.id, m.id);
  const fp = fingerprint(t, m);
  if (have && (have.kind === 'raw' || have.fp === fp)) return have.data;
  const i = t.messages.indexOf(m);
  const before = t.messages.slice(0, Math.max(0, i)).map((x) => midOf(t, x));
  const subject = i > 0 && !/^\s*(re|fwd?)\s*:/i.test(t.subject) ? `Re: ${t.subject}` : t.subject;
  const files = (m.attachments ?? []).map((a) => ({ filename: a.name, content: fileBuffer(a.url, mb.wsId) })).filter((a): a is { filename: string; content: Buffer } => !!a.content);
  const built: Buffer = await new MailComposer({
    from: { name: m.from?.name ?? '', address: m.from?.email ?? '' },
    to: (m.to ?? []).map((p) => ({ name: p.name ?? '', address: p.email })),
    bcc: m.bcc?.length ? m.bcc.map((p) => ({ name: p.name ?? '', address: p.email })) : undefined,
    subject: subject || '(no subject)',
    text: m.body ?? '',
    html: m.html || undefined,
    date: new Date(m.date || Date.now()),
    messageId: midOf(t, m),
    inReplyTo: before.at(-1),
    references: before.length ? before : undefined,
    attachments: files,
    baseBoundary: createHash('sha256').update(`${t.id} ${m.id}`).digest('hex').slice(0, 16),
    keepBcc: true,
    headers: { 'X-Mailer': 'sprint2go' },
  } as ConstructorParameters<typeof MailComposer>[0])
    .compile()
    .build();
  raws.keepBuilt(t.id, m.id, fp, built);
  return raws.crlf(built);
}

/** RFC822.SIZE without building again when the source is kept. */
export async function sizeOf(ctx: Ctx, t: Thread, m: Msg, mb: Mailbox): Promise<number> {
  const k = ctx.kept(mb.id).get(`${t.id} ${m.id}`);
  if (k && (k.kind === 'raw' || k.fp === fingerprint(t, m))) return k.size;
  return (await source(t, m, mb)).length;
}

/* ---------- changes from mail apps ---------- */

export interface Writer {
  /** Saves threads through the app's own rules (index.ts applySync); `why` when not everything was kept. */
  write: (userId: string, upserts: Thread[], deletes: string[]) => { ok: boolean; why?: string };
  /** Saves labels the same way (a mail app making, renaming or deleting a folder). */
  labels?: (userId: string, upserts: MailLabel[], deletes: string[]) => { ok: boolean; why?: string };
}

/* ---------- label folders made, renamed and deleted from a mail app ---------- */

/** Which mailbox a new folder name belongs to, and its path inside it ("Clients/KopiKita"). */
function placeOf(name: string, mailboxes: Mailbox[]): { mb: Mailbox; parts: string[] } | null {
  const other = mailboxes.find((m) => !m.primary && name.toLowerCase().startsWith(`${m.email.toLowerCase()}/`));
  const mb = other ?? mailboxes.find((m) => m.primary);
  if (!mb) return null;
  const rest = other ? name.slice(other.email.length + 1) : name;
  const parts = rest.split('/').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.some((x) => x.length > 80)) return null;
  if (RESERVED.has(parts[0].toLowerCase()) || parts[0].toUpperCase() === 'INBOX') return null;
  return { mb, parts };
}
/** CREATE: makes the label (and any parents it needs) in that mailbox. */
export function createLabelFolder(w: Writer, userId: string, name: string, mailboxes: Mailbox[]): { ok: boolean; why?: string } {
  const at = placeOf(name, mailboxes);
  if (!at || !w.labels) return { ok: false, why: "Folders here are sprint2go's places and labels; that name can't be a label." };
  const all = db.allDocs('mailLabels') as unknown as MailLabel[];
  const mine = labelsOf(at.mb, all);
  const made: MailLabel[] = [];
  let parent: MailLabel | null = null;
  for (const part of at.parts) {
    const pool: MailLabel[] = [...mine, ...made];
    const found: MailLabel | undefined = pool.find((l) => (l.parentId ?? null) === (parent?.id ?? null) && l.name.toLowerCase() === part.toLowerCase());
    if (found) {
      parent = found;
      continue;
    }
    // Nested under a company label only by an admin, in sprint2go: here the new part is this mailbox's own.
    if (parent && parent.accountId === null) return { ok: false, why: 'Sub-labels of a company label are made by admins in sprint2go.' };
    const l: MailLabel = { id: newId('lb-'), workspaceId: at.mb.wsId, accountId: at.mb.id, name: part, parentId: parent?.id ?? null, color: '#64748b', show: 'show', order: Date.now() };
    made.push(l);
    parent = l;
  }
  if (!made.length) return { ok: false, why: 'That folder is already there.' };
  return w.labels(userId, made, []);
}
/** RENAME: a label folder gets its new name (and place, when the path changes). */
export function renameLabelFolder(w: Writer, userId: string, f: Folder, to: string, mailboxes: Mailbox[]): { ok: boolean; why?: string } {
  if (!f.id.startsWith('label:') || !w.labels) return { ok: false, why: 'Only labels can be renamed here.' };
  const at = placeOf(to, mailboxes);
  if (!at || at.mb.id !== f.mailbox.id) return { ok: false, why: 'A label stays in its own mailbox.' };
  const all = db.allDocs('mailLabels') as unknown as MailLabel[];
  const label = all.find((l) => l.id === f.id.slice(6));
  if (!label) return { ok: false, why: "That label isn't there any more." };
  const mine = labelsOf(f.mailbox, all);
  let parent: MailLabel | null = null;
  for (const part of at.parts.slice(0, -1)) {
    parent = mine.find((l) => (l.parentId ?? null) === (parent?.id ?? null) && l.name.toLowerCase() === part.toLowerCase()) ?? null;
    if (!parent) return { ok: false, why: 'Make the folder it goes in first.' };
  }
  return w.labels(userId, [{ ...label, name: at.parts[at.parts.length - 1], parentId: parent?.id ?? null }], []);
}
/** DELETE: the label goes (its mail stays, in sprint2go's other places). */
export function deleteLabelFolder(w: Writer, userId: string, f: Folder): { ok: boolean; why?: string } {
  if (!f.id.startsWith('label:') || !w.labels) return { ok: false, why: 'Only labels can be deleted here.' };
  return w.labels(userId, [], [f.id.slice(6)]);
}

const setKw = (box: string, uid: number, fn: (k: Set<string>) => void) => {
  const r = db.db.prepare('SELECT kw FROM imap_msgs WHERE box = ? AND uid = ?').get(box, uid) as { kw: string } | undefined;
  if (!r) return;
  const k = kwSet(r.kw);
  fn(k);
  db.db.prepare('UPDATE imap_msgs SET kw = ? WHERE box = ? AND uid = ?').run([...k].join(' '), box, uid);
};
/** Keywords a mail app may keep on a message ($Forwarded, $Junk…): a sane name, a few per message. */
export const keywordOk = (k: string) => /^[A-Za-z$][A-Za-z0-9$_.-]{0,63}$/.test(k);

/** Saves changed threads. Unchanged ones aren't written. */
function save(w: Writer, userId: string, before: Map<string, Thread>, after: Map<string, Thread | null>) {
  const ups: Thread[] = [];
  const dels: string[] = [];
  for (const [id, next] of after) {
    if (next === null) dels.push(id);
    else if (JSON.stringify(next) !== JSON.stringify(before.get(id))) ups.push(next);
  }
  if (!ups.length && !dels.length) return { ok: true } as { ok: boolean; why?: string };
  return w.write(userId, ups, dels);
}

/**
 * STORE: \Seen and \Flagged change the thread (read, starred) for everyone; \Answered, \Deleted and keywords stay on
 * this copy. `op`: '+' adds, '-' removes, '=' replaces.
 */
export function store(w: Writer, userId: string, f: Folder, ctx: Ctx, items: { uid: number; tid: string; mid: string }[], op: '+' | '-' | '=', flags: string[]): { ok: boolean; why?: string } {
  const want = new Set(flags.map((x) => (x.startsWith('\\') ? x[0] + x[1].toUpperCase() + x.slice(2).toLowerCase() : x)));
  const touches = (flag: string) => op === '=' || want.has(flag);
  const before = new Map<string, Thread>();
  const after = new Map<string, Thread | null>();
  for (const it of items) {
    const hit = lookup(ctx, f.mailbox, it.tid, it.mid);
    if (!hit) continue;
    const { t } = hit;
    if (!before.has(t.id)) (before.set(t.id, t), after.set(t.id, { ...t }));
    const next = after.get(t.id)!;
    const on = (flag: string) => (op === '-' ? false : op === '+' ? true : want.has(flag));
    if (touches('\\Seen')) {
      next.unread = !on('\\Seen');
      setKw(f.box, it.uid, (k) => (on('\\Seen') ? k.delete('\\Unseen') : k.add('\\Unseen')));
    }
    if (touches('\\Flagged')) {
      next.starred = on('\\Flagged');
      setKw(f.box, it.uid, (k) => (on('\\Flagged') ? k.add('\\Flagged') : k.delete('\\Flagged')));
    }
    for (const flag of ['\\Answered', '\\Deleted']) if (touches(flag)) setKw(f.box, it.uid, (k) => (on(flag) ? k.add(flag) : k.delete(flag)));
    // Keywords: what the mail app set, kept on this copy.
    setKw(f.box, it.uid, (k) => {
      const kws = [...want].filter((x) => !x.startsWith('\\') && keywordOk(x));
      if (op === '=') for (const x of [...k]) if (!x.startsWith('\\')) k.delete(x);
      for (const x of kws) op === '-' ? k.delete(x) : k.size < 32 && k.add(x);
    });
  }
  return save(w, userId, before, after);
}

/** Tomorrow at 9:00 where the company is, as "Snooze" in sprint2go does. */
function tomorrowMorning(tz: string) {
  const today = localParts(Date.now(), tz).day;
  return new Date(zonedTime(addDays(today, 1), 9, tz)).toISOString();
}

/**
 * COPY and MOVE inside one mailbox. A thread has one place, so copying it to INBOX, Archive, Trash or Spam moves it
 * there; a label folder adds the label (and moving out of one takes it off). Sent and Drafts only fill themselves.
 */
export function copyMove(w: Writer, userId: string, from: Folder, to: Folder, ctx: Ctx, items: { tid: string; mid: string }[], move: boolean): { ok: boolean; why?: string } {
  if (to.id === 'sent' || to.id === 'drafts') return { ok: false, why: `${to.name} fills itself: mail you send shows in Sent, drafts in Drafts.` };
  const before = new Map<string, Thread>();
  const after = new Map<string, Thread | null>();
  for (const it of items) {
    const hit = lookup(ctx, from.mailbox, it.tid, it.mid);
    if (!hit || before.has(hit.t.id)) continue;
    const t = hit.t;
    before.set(t.id, t);
    const next: Thread = { ...t, labels: [...(t.labels ?? [])] };
    if (to.id === 'inbox' || to.id === 'archive' || to.id === 'trash' || to.id === 'spam') {
      if (from.id !== to.id) (next.location = to.id), (next.snoozedUntil = undefined);
    } else if (to.id === 'snoozed') {
      next.snoozedUntil = tomorrowMorning(to.mailbox.tz);
      if (next.location !== 'inbox' && next.location !== 'archive') next.location = 'inbox';
    } else if (to.id.startsWith('label:')) {
      const label = to.id.slice(6);
      if (!next.labels!.includes(label)) next.labels!.push(label);
      if (next.location === 'trash' || next.location === 'spam' || next.location === 'drafts') next.location = 'archive';
      if (move && (from.id === 'inbox' || from.id === 'snoozed')) (next.location = 'archive'), (next.snoozedUntil = undefined);
    }
    if (move && from.id.startsWith('label:') && from.id !== to.id) next.labels = next.labels!.filter((l) => l !== from.id.slice(6));
    after.set(t.id, next);
  }
  return save(w, userId, before, after);
}

/**
 * EXPUNGE: messages marked \Deleted leave the folder. In INBOX, Archive, Snoozed, Spam and Sent the conversation goes to
 * Trash (as Delete does in sprint2go); in a label folder the label comes off; in Trash and Drafts it's deleted for good.
 */
export function expunge(w: Writer, userId: string, f: Folder, ctx: Ctx, uids?: Set<number>): { ok: boolean; why?: string } {
  const rows = (db.db.prepare('SELECT uid, thread_id, message_id, kw FROM imap_msgs WHERE box = ?').all(f.box) as { uid: number; thread_id: string; message_id: string; kw: string }[]).filter((r) => kwSet(r.kw).has('\\Deleted') && (!uids || uids.has(r.uid)));
  const before = new Map<string, Thread>();
  const after = new Map<string, Thread | null>();
  for (const r of rows) {
    const hit = lookup(ctx, f.mailbox, r.thread_id, r.message_id);
    if (!hit || before.has(hit.t.id)) continue;
    const t = hit.t;
    before.set(t.id, t);
    if (f.id === 'trash' || f.id === 'drafts') after.set(t.id, null);
    else if (f.id.startsWith('label:')) after.set(t.id, { ...t, labels: (t.labels ?? []).filter((l) => l !== f.id.slice(6)) });
    else after.set(t.id, { ...t, location: 'trash', snoozedUntil: undefined });
  }
  return save(w, userId, before, after);
}

/* ---------- new mail from a mail app (APPEND, and mail sent through SMTP submission) ---------- */

const person = (v: { name?: string; address?: string } | undefined): P => ({ name: v?.name || (v?.address ?? '').split('@')[0], email: lower(v?.address) });
const addrs = (v: ParsedMail['to']) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.value).flatMap((a) => (a.group ? a.group : [a])).map(person).filter((p) => p.email);
const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const newId = (p: string) => p + randomBytes(6).toString('hex');

export interface Read {
  parsed: ParsedMail;
  from: P;
  to: P[];
  cc: P[];
  bcc: P[];
  mid: string | null;
  refs: string[];
}
/** Reads a message once (inline pictures become data: links, as for received mail). */
export async function read(raw: Buffer): Promise<Read> {
  const parsed = await simpleParser(raw);
  const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])].filter((x): x is string => !!x);
  const mid = parsed.messageId && /^<[^<>\s]+@[^<>\s]+>$/.test(parsed.messageId) ? parsed.messageId : null;
  return { parsed, from: person(parsed.from?.value?.[0]), to: addrs(parsed.to), cc: addrs(parsed.cc), bcc: addrs(parsed.bcc), mid, refs };
}

/** Attachments become files of the company (they count towards its storage, as uploads do); pictures shown inside the text stay in it. */
export function saveAttachments(parsed: ParsedMail, wsId: string, by: string) {
  return parsed.attachments
    .filter((a) => !(a.related && a.contentId)) // pictures inside the HTML are already in it (as data: links)
    .map((a) => {
      const id = randomBytes(16).toString('hex');
      db.saveFile({ id, workspaceId: wsId, by, name: a.filename ?? 'attachment', type: a.contentType ?? 'application/octet-stream', size: a.size }, a.content);
      return { name: a.filename ?? 'attachment', size: fmtSize(a.size), url: `/api/files/${id}` };
    });
}

/** A message of this mailbox with this Message-ID (a sent copy appended after sending, or sent after appending). */
export function findByMid(ctx: Ctx, mb: Mailbox, mid: string | null): { t: Thread; m: Msg } | null {
  if (!mid) return null;
  for (const t of ctx.threadsOf(mb.id)) for (const m of t.messages) if (m.mid === mid && t.location !== 'trash') return { t, m };
  return null;
}
/** The conversation a message answers, by its references. */
export function threadFor(ctx: Ctx, mb: Mailbox, refs: string[]): Thread | null {
  if (!refs.length) return null;
  return ctx.threadsOf(mb.id).find((t) => t.location !== 'drafts' && t.messages.some((m) => m.mid && refs.includes(m.mid))) ?? null;
}
const cleanSubject = (s: string) => String(s ?? '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim();

/**
 * APPEND: a draft becomes a draft conversation, a copy of sent mail lands in Sent once (the same Message-ID already there
 * counts), anything else is filed where it was put (INBOX, Archive, Trash, Spam or a label). Returns the new message.
 */
export async function append(w: Writer, userId: string, f: Folder, ctx: Ctx, rawIn: Buffer, flags: string[], date: Date | null): Promise<{ ok: boolean; why?: string; tid?: string; mid?: string }> {
  const mb = f.mailbox;
  if (f.id === 'snoozed') return { ok: false, why: 'Snoozed only holds mail you snooze. Move mail there instead.' };
  const raw = raws.crlf(rawIn);
  const r = await read(raw);
  const mine = mb.addresses.has(r.from.email);
  if (f.id === 'sent' && !mine) return { ok: false, why: `Only mail from ${mb.email} goes in Sent.` };
  const dup = f.id === 'sent' ? findByMid(ctx, mb, r.mid) : null;
  if (dup) return { ok: true, tid: dup.t.id, mid: dup.m.id };
  const has = (x: string) => flags.some((y) => y.toLowerCase() === x.toLowerCase());
  const msg: Msg = {
    id: newId('m-'),
    mid: r.mid ?? `<${randomBytes(12).toString('hex')}@sprint2go>`,
    from: r.from.email ? r.from : { name: mb.name, email: mb.email },
    to: [...r.to, ...r.cc],
    ...(r.bcc.length ? { bcc: r.bcc } : {}),
    date: (date ?? r.parsed.date ?? new Date()).toISOString(),
    body: (r.parsed.text ?? '').trim(),
    html: r.parsed.html || undefined,
  };
  const files = saveAttachments(r.parsed, mb.wsId, userId);
  if (files.length) msg.attachments = files;
  const subject = cleanSubject(r.parsed.subject ?? '') || '(no subject)';
  let thread: Thread;
  if (f.id === 'drafts') thread = { id: newId('t-'), accountId: mb.id, workspaceId: mb.wsId, subject, location: 'drafts', starred: has('\\Flagged'), unread: false, labels: [], messages: [msg] };
  else {
    const label = f.id.startsWith('label:') ? f.id.slice(6) : null;
    const place = f.id === 'sent' || label ? null : f.id;
    const existing = threadFor(ctx, mb, r.refs);
    const labels = [...new Set([...(existing?.labels ?? []), ...(label ? [label] : [])])];
    thread = existing
      ? { ...existing, location: place ?? (existing.location === 'trash' || existing.location === 'spam' ? 'archive' : existing.location), labels, messages: [...existing.messages, msg], unread: mine ? !!existing.unread : !has('\\Seen'), starred: existing.starred || has('\\Flagged') }
      : { id: newId('t-'), accountId: mb.id, workspaceId: mb.wsId, subject, location: place ?? 'archive', starred: has('\\Flagged'), unread: !mine && !has('\\Seen'), labels, messages: [msg] };
  }
  // Mail moved in from elsewhere (an import by dragging into INBOX) runs through the mailbox's filters and blocked
  // senders, as arriving mail does: the marks only, nothing is forwarded or answered (server/mailFilters.ts).
  if (f.id === 'inbox' && !mine) {
    const hit = filters.accountOf(mb.id);
    if (hit) thread = filters.onArrival(thread, msg, { ws: hit.ws, account: hit.account, spam: false, importing: true, listId: filters.listIdOf(r.parsed) }).thread;
  }
  raws.keepRaw(thread.id, msg.id, raw);
  const saved = w.write(userId, [thread], []);
  if (!saved.ok) return { ok: false, why: saved.why ?? 'It couldn’t be saved.' };
  ctx.forget(mb.id);
  return { ok: true, tid: thread.id, mid: msg.id };
}

/** The entry a message has in a folder now (after a sync), for APPENDUID and COPYUID. */
export const entryFor = (state: BoxState, tid: string, mid: string) => state.entries.find((e) => e.tid === tid && e.mid === mid) ?? null;

/** Rows of mailboxes and folders that no longer exist go, once in a while. */
export function sweepBoxes(liveAccounts: Set<string>) {
  const boxes = db.db.prepare('SELECT box FROM imap_boxes').all() as { box: string }[];
  for (const { box } of boxes) {
    if (liveAccounts.has(box.slice(0, box.indexOf('/')))) continue;
    db.db.prepare('DELETE FROM imap_msgs WHERE box = ?').run(box);
    db.db.prepare('DELETE FROM imap_boxes WHERE box = ?').run(box);
  }
}
