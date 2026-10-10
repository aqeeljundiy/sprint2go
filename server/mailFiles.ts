// Mail attachments on the server: what Gmail does with files, here.
//   - Safety: the file types Gmail refuses (src/mailAttachments.ts BLOCKED_EXTS), also inside a zip (and a zip in a
//     zip), and programs renamed to look like something else, are refused on the way in and on the way out. Incoming
//     files are checked for viruses by ClamAV when one runs next to the server (CLAMD_HOST, see the Dockerfile), and
//     marked "not scanned" otherwise. A refused file isn't kept: the email lists it with the reason.
//   - Pictures inside an email (cid images) are kept as files and shown in place, not listed with the attachments;
//     pictures pasted into an email here go out as cid images.
//   - Previews (server/officePreview.ts) for Word, Excel, PowerPoint, CSV and text, as a sandboxed HTML page.
//   - Download all as one zip, streamed as it's made.
//   - Save to Drive (one file or all of them, into a folder): a copy that's the person's own, within the company's storage.
//   - Big files as links: files too big for an email are shared with a link instead, for anyone with the link or only
//     the people the email went to (they confirm their address with a code first).
//   - Every attachment across someone's mail, for the Files view and for search (`has:attachment`, `filename:`).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { copyFile, open as openFile } from 'node:fs/promises';
import { once } from 'node:events';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { crc32, createDeflateRaw } from 'node:zlib';
import { simpleParser, type ParsedMail } from 'mailparser';
import * as db from './db.ts';
import { readZip, openEntry } from './zip.ts';
import { preview as makePreview } from './officePreview.ts';
import { BLOCKED_EXTS, extOf, fileIdOf, fileKind, filenameMatches, fitsInEmail, isBlockedName, mailFiles, type FileFilter, type FileKind } from '../src/mailAttachments.ts';
import { kindOf } from '../src/data/drive.ts';
import { mark } from '../src/i18n/index.ts';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Att = ParsedMail['attachments'][number];

/** Sentences people read (src/i18n/id/mail.files.ts has them in Indonesian, keyed by these exact words). */
export const WHY = {
  type: mark('Blocked: this kind of file can run programs, so it wasn’t kept.'),
  inZip: mark('Blocked: the zip holds a file that can run programs, so it wasn’t kept.'),
  program: mark('Blocked: it’s a program with another name, so it wasn’t kept.'),
  virus: mark('Blocked: a virus was found in it, so it wasn’t kept.'),
  sendType: mark('This kind of file can’t be sent, because it can run programs (as in Gmail). Put it in Drive and send a link, or ask the person to get it another way.'),
  sendZip: mark('One of the zips holds a file that can run programs, so it can’t be sent (as in Gmail).'),
  sendProgram: mark('One of the files is a program with another name, so it can’t be sent.'),
  tooBig: mark('This email is over 25 MB with its files. Send the big files as Drive links instead.'),
};

/* ---------- what's dangerous ---------- */

/** A Windows program, whatever its name says: "MZ" and a PE header where the MZ header says it is. */
export function isProgram(head: Buffer): boolean {
  if (head.length < 64 || head[0] !== 0x4d || head[1] !== 0x5a) return false;
  const at = head.readUInt32LE(0x3c);
  return at > 0 && at + 4 <= head.length && head.readUInt32LE(at) === 0x00004550;
}

/** Names inside a zip that can run programs (one zip deep inside another is opened too). Null when it's not a zip we can read. */
async function blockedInZip(path: string, depth = 0): Promise<string | null | false> {
  let entries;
  try {
    entries = await readZip(path, { maxFiles: 50000, maxTotal: Number.MAX_SAFE_INTEGER });
  } catch {
    return null;
  }
  for (const e of entries) if (!e.dir && isBlockedName(e.name)) return e.name;
  if (depth >= 2) return false;
  for (const e of entries) {
    if (e.dir || extOf(e.name) !== 'zip' || e.encrypted || e.size > 50 * 1024 * 1024) continue;
    const tmp = join(tmpdir(), `s2g-zip-${randomBytes(8).toString('hex')}`);
    try {
      const s = await openEntry(path, e, 50 * 1024 * 1024);
      const chunks: Buffer[] = [];
      for await (const c of s) chunks.push(c as Buffer);
      writeFileSync(tmp, Buffer.concat(chunks));
      const inner = await blockedInZip(tmp, depth + 1);
      if (inner) return `${e.name}/${inner}`;
    } catch {
      /* a damaged inner zip: nothing more to read in it */
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  return false;
}

/** Why a file is refused (incoming wording), or null. Reads the file at `path`. */
export async function refusal(name: string, path: string): Promise<string | null> {
  if (isBlockedName(name)) return WHY.type;
  const fh = await openFile(path, 'r').catch(() => null);
  if (!fh) return null;
  const head = Buffer.alloc(4096);
  try {
    await fh.read(head, 0, 4096, 0);
  } finally {
    await fh.close();
  }
  if (isProgram(head)) return WHY.program;
  // A zip by its name or its first bytes (never a document: Word, Excel and PowerPoint files are zips too).
  const zipLike = extOf(name) === 'zip' || (head.readUInt32LE(0) === 0x04034b50 && !['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'epub', 'apk', 'jar'].includes(extOf(name)));
  if (zipLike && (await blockedInZip(path))) return WHY.inZip;
  return null;
}

/* ---------- virus scanning (ClamAV's clamd, when there is one) ---------- */

/** Where clamd listens: CLAMD_HOST as "host", "host:port" (3310 by default) or a socket path ("/run/clamav/clamd.sock"). */
const clamdAt = () => {
  const v = String(process.env.CLAMD_HOST ?? '').trim();
  if (!v) return null;
  if (v.startsWith('/')) return { path: v, host: '', port: 0 };
  const [host, port] = v.split(':');
  return { path: '', host: host || '127.0.0.1', port: Number(port) || 3310 };
};
export const scanning = () => !!clamdAt();

/** 'clean', 'unscanned' (no scanner, it didn't answer, or the file is over its limit) or the virus's name. */
export async function scan(data: Buffer, timeoutMs = 20_000): Promise<{ state: 'clean' | 'unscanned' } | { state: 'infected'; virus: string }> {
  const at = clamdAt();
  if (!at) return { state: 'unscanned' };
  return new Promise((done) => {
    const sock = at.path ? connect(at.path) : connect(at.port, at.host);
    let reply = '';
    let settled = false;
    const finish = (r: Awaited<ReturnType<typeof scan>>) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      done(r);
    };
    sock.setTimeout(timeoutMs, () => finish({ state: 'unscanned' }));
    sock.on('error', () => finish({ state: 'unscanned' }));
    sock.on('data', (b) => {
      reply += b.toString('utf8');
      if (reply.includes('\0') || reply.includes('\n')) {
        const r = reply.replace(/\0/g, '').trim();
        const found = /^(?:stream|\d+):\s*(.+)\s+FOUND$/i.exec(r);
        finish(found ? { state: 'infected', virus: found[1] } : /:\s*OK$/i.test(r) ? { state: 'clean' } : { state: 'unscanned' });
      }
    });
    sock.on('end', () => finish({ state: 'unscanned' }));
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < data.length; i += 64 * 1024) {
        const part = data.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        sock.write(len);
        sock.write(part);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

/* ---------- mail arriving ---------- */

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
const cleanCid = (s: string | undefined) => String(s ?? '').replace(/^<|>$/g, '').trim();

/**
 * The files of an email arriving in a company (from outside, or from one of our own mailboxes): each checked, scanned
 * and kept as one of the company's files, and the pictures inside its HTML pointed at their files instead of cid: links.
 * `list`: which attachments to keep (a calendar's .ics may already be taken out). Returns what goes on the message.
 */
export async function storeIncoming(raw: Buffer, parsed: ParsedMail, workspaceId: string, list: Att[] = parsed.attachments, by = 'mail'): Promise<{ attachments: Doc[]; html?: string }> {
  // Pictures the HTML shows by cid: the HTML with its cid: links kept (mailparser turns them into data: links otherwise).
  const related = list.filter((a) => a.contentId && (a.related || a.contentDisposition === 'inline') && /^image\//i.test(a.contentType ?? ''));
  const withCids = related.length && parsed.html ? await simpleParser(raw, { keepCidLinks: true }).catch(() => null) : null;
  let html = withCids?.html || undefined;
  const out: Doc[] = [];
  for (const a of list) {
    const cid = cleanCid(a.contentId);
    const inline = !!html && !!cid && html.includes(`cid:${cid}`) && related.includes(a);
    const name = String(a.filename ?? (inline ? 'image' : 'attachment')).slice(0, 200);
    const type = a.contentType ?? 'application/octet-stream';
    const id = randomBytes(16).toString('hex');
    const path = db.filePath(id);
    writeFileSync(path, a.content);
    const blocked = await refusal(name, path);
    const scanned = blocked ? null : await scan(a.content);
    if (blocked || scanned?.state === 'infected') {
      rmSync(path, { force: true });
      out.push({ name, size: fmtSize(a.size), type, blocked: blocked ?? WHY.virus });
      if (inline && html) html = html.split(`cid:${cid}`).join('');
      continue;
    }
    db.recordFile({ id, workspaceId, by, name, type, size: a.size });
    const url = `/api/files/${id}`;
    if (inline && html) html = html.split(`cid:${cid}`).join(url);
    out.push({ name, size: fmtSize(a.size), url, type, scan: scanned?.state === 'clean' ? 'clean' : 'unscanned', ...(inline ? { inline: true } : {}) });
  }
  return { attachments: out, html };
}

/* ---------- mail going out ---------- */

/** Why these files can't go out in an email, or null: a refused type, one inside a zip, a renamed program, or too big. */
export async function checkOutgoing(files: { name: string; url: string; cid?: string }[], workspaceId: string, bodyBytes = 0): Promise<string | null> {
  const sizes: number[] = [];
  for (const f of files) {
    if (isBlockedName(f.name)) return WHY.sendType;
    const id = fileIdOf(f.url);
    if (!id) {
      const d = /^data:[^;]*;base64,(.+)$/.exec(f.url);
      if (d) sizes.push(Math.floor((d[1].length * 3) / 4));
      continue;
    }
    const info = db.fileInfo(id);
    if (!info || info.workspaceId !== workspaceId) continue; // queueSend leaves out what isn't the company's
    sizes.push(info.size);
    const why = await refusal(f.name, db.filePath(id));
    if (why === WHY.type) return WHY.sendType;
    if (why === WHY.inZip) return WHY.sendZip;
    if (why === WHY.program) return WHY.sendProgram;
  }
  return fitsInEmail(sizes, bodyBytes) ? null : WHY.tooBig;
}

/**
 * Pictures pasted into an email here are company files shown by their address (/api/files/…): on the way out they
 * become cid images inside the email, so the person reading it sees them without signing in anywhere.
 */
export function inlineForSend(html: string | undefined, files: { name: string; url: string; cid?: string }[], workspaceId: string) {
  if (!html) return { html, files };
  const extra: { name: string; url: string; cid: string }[] = [];
  const out = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])\/api\/files\/([a-f0-9]{32})\2/gi, (m, pre: string, q: string, id: string) => {
    const info = db.fileInfo(id);
    if (!info || info.workspaceId !== workspaceId || fileKind(info.name, info.type) !== 'image') return m;
    const cid = `${id}@sprint2go`;
    if (!extra.some((x) => x.cid === cid)) extra.push({ name: info.name, url: `/api/files/${id}`, cid });
    return `${pre}${q}cid:${cid}${q}`;
  });
  return { html: out, files: [...files, ...extra] };
}

/* ---------- who may see what ---------- */

const workspaces = () => db.allDocs('workspaces') as Doc[];
/** The mailbox's company, when this person opens the mailbox (the same rule as the app's: its people). */
function threadFor(userId: string, threadId: string): { thread: Doc; ws: Doc } | null {
  const thread = db.getDoc('threads', threadId) as Doc | undefined;
  if (!thread) return null;
  for (const w of workspaces()) {
    if (!(w.members ?? []).some((m: Doc) => m.userId === userId)) continue;
    const a = (w.accounts ?? []).find((x: Doc) => x.id === thread.accountId);
    if (a && (a.users ?? []).includes(userId)) return { thread, ws: w };
  }
  return null;
}
/** Every conversation of this person in a company (or all of theirs). */
function threadsOf(userId: string, workspaceId?: string): Doc[] {
  const boxes = new Set<string>();
  for (const w of workspaces()) {
    if (workspaceId && w.id !== workspaceId) continue;
    if (!(w.members ?? []).some((m: Doc) => m.userId === userId)) continue;
    for (const a of w.accounts ?? []) if ((a.users ?? []).includes(userId)) boxes.add(a.id);
  }
  return (db.allDocs('threads') as Doc[]).filter((t) => boxes.has(t.accountId));
}

/**
 * For search (`has:attachment`, `filename:`) and the Files view: every attachment in this person's mail that matches,
 * newest first. Refused files and pictures inside emails stay out.
 */
export function searchAttachments(userId: string, filter: FileFilter & { workspaceId?: string } = {}) {
  return mailFiles(threadsOf(userId, filter.workspaceId) as never, filter).filter((f) => !f.att.blocked);
}
/** `has:attachment` and `filename:` for one conversation, for the search builder. */
export const threadMatches = (thread: Doc, q: { hasAttachment?: boolean; filename?: string }) =>
  (thread.messages ?? []).some((m: Doc) => (m.attachments ?? []).some((a: Doc) => !a.inline && !a.blocked && (!q.filename || filenameMatches(a.name, q.filename)))) || (!q.hasAttachment && !q.filename);

/* ---------- download all as a zip ---------- */

/** Writes a zip of these files to `res` as it reads them (deflated, sizes after each file, so nothing waits in memory). */
export async function streamZip(res: ServerResponse, entries: { name: string; path: string }[]) {
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const write = async (b: Buffer) => {
    offset += b.length;
    if (!res.write(b)) await once(res, 'drain');
  };
  const used = new Set<string>();
  for (const e of entries) {
    // The same name twice gets " (2)", and nothing in a name can point outside the folder it's unpacked to.
    const clean = e.name.replace(/[\\/:*?"<>|\0]/g, '_').replace(/^\.+/, '_') || 'file';
    let name = clean;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = clean.replace(/(\.[^.]*)?$/, ` (${i})$1`);
    used.add(name.toLowerCase());
    const nameBuf = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0808, 6); // sizes after the data, names in UTF-8
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt16LE(nameBuf.length, 26);
    const at = offset;
    await write(Buffer.concat([head, nameBuf]));
    let crc = 0;
    let size = 0;
    let csize = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _e, cb) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        cb(null, chunk);
      },
    });
    const squeezed = /^(image|video|audio|archive|pdf)$/.test(fileKind(e.name)) ? 1 : 6;
    const deflate = createDeflateRaw({ level: squeezed });
    const src = createReadStream(e.path);
    src.on('error', (err) => deflate.destroy(err));
    src.pipe(tap).pipe(deflate);
    for await (const c of deflate) {
      csize += (c as Buffer).length;
      await write(c as Buffer);
    }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(csize, 8);
    desc.writeUInt32LE(size, 12);
    await write(desc);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0808, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(csize, 20);
    cen.writeUInt32LE(size, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(at, 42);
    central.push(cen, nameBuf);
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(cd);
  await write(end);
  res.end();
}

/* ---------- links for big files ---------- */

db.db.exec(`CREATE TABLE IF NOT EXISTS mail_links (token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, file_id TEXT NOT NULL, drive_id TEXT, name TEXT NOT NULL, access TEXT NOT NULL, recipients TEXT NOT NULL, secret TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`);
type LinkRow = { token: string; workspace_id: string; file_id: string; drive_id: string | null; name: string; access: 'anyone' | 'recipients'; recipients: string; secret: string; created_by: string; created_at: string };
const linkRow = (token: string) => (/^[a-f0-9]{40}$/.test(token) ? (db.db.prepare('SELECT * FROM mail_links WHERE token = ?').get(token) as LinkRow | undefined) : undefined);

/** The Drive folder files sent as links go into (made the first time). */
const LINK_FOLDER = 'Sent as links from Mail';

/* ---------- the routes ---------- */

export interface Deps {
  publicUrl: () => string;
  broadcast: (coll: string, upserts: Doc[], deletes: string[]) => void;
  storageRoom: (wsId: string, userId: string) => { left: number; total: number; unlimited: boolean };
  readOnly: (ws: Doc) => string | null | undefined;
  /** Sends the code that opens a "recipients only" link; false when there's no way to send mail here (it's logged then). */
  sendCode: (to: string, subject: string, text: string) => Promise<boolean>;
  /** Who's signed in on this request (their sign-in email), for links: none for people outside. */
  whoIs: (req: IncomingMessage) => { userId: string; email: string } | null;
  tooMany: (key: string, max: number, windowMs: number) => boolean;
  ipOf: (req: IncomingMessage) => string;
}
let deps: Deps | null = null;
export const init = (d: Deps) => void (deps = d);

const json = (res: ServerResponse, status: number, body: unknown) => (res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }), res.end(JSON.stringify(body)));
async function readBody(req: IncomingMessage, max = 256 * 1024): Promise<Doc> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw new Error('too big');
    chunks.push(c as Buffer);
  }
  const s = Buffer.concat(chunks).toString('utf8');
  if (String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(s));
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

/** A message's files that are kept here (not refused): with their file on disk. */
function messageFiles(thread: Doc, messageId: string | null, wsId: string) {
  const msgs = (thread.messages ?? []).filter((m: Doc) => !messageId || m.id === messageId);
  return msgs.flatMap((m: Doc) =>
    (m.attachments ?? [])
      .filter((a: Doc) => !a.inline && !a.blocked)
      .map((a: Doc) => ({ a, m, id: fileIdOf(a.url) }))
      .filter((x: Doc) => x.id && db.fileInfo(x.id)?.workspaceId === wsId && existsSync(db.filePath(x.id))),
  ) as { a: Doc; m: Doc; id: string }[];
}

/** The signed-in routes: /api/mail/zip, /api/mail/files (list), /api/mail/files/drive, /api/mail/links. True when handled. */
export async function handle(req: IncomingMessage, res: ServerResponse, url: URL, me: string): Promise<boolean> {
  const p = url.pathname;
  if (!deps) return false;
  // Download all: one zip of a message's files (or the whole conversation's).
  if (p === '/api/mail/zip' && req.method === 'GET') {
    const hit = threadFor(me, String(url.searchParams.get('threadId') ?? ''));
    if (!hit) return (json(res, 404, { error: mark('No such email.') }), true);
    const files = messageFiles(hit.thread, url.searchParams.get('messageId'), hit.ws.id);
    if (!files.length) return (json(res, 404, { error: mark('There are no files to download in this email.') }), true);
    const base = String(hit.thread.subject || 'Attachments').replace(/[^\p{L}\p{N} _.-]+/gu, ' ').trim().slice(0, 80) || 'Attachments';
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(base)}.zip`, 'cache-control': 'private, no-store' });
    await streamZip(res, files.map((f) => ({ name: f.a.name, path: db.filePath(f.id) })));
    return true;
  }
  // All attachments in this person's mail, for the Files view and search.
  if (p === '/api/mail/files' && req.method === 'GET') {
    const kinds = String(url.searchParams.get('kinds') ?? '').split(',').filter(Boolean) as FileKind[];
    const list = searchAttachments(me, { workspaceId: url.searchParams.get('workspaceId') ?? undefined, q: url.searchParams.get('q') ?? undefined, from: url.searchParams.get('from') ?? undefined, after: url.searchParams.get('after') ?? undefined, before: url.searchParams.get('before') ?? undefined, kinds });
    return (json(res, 200, { files: list.slice(0, 500).map((f) => ({ threadId: f.threadId, messageId: f.messageId, name: f.att.name, size: f.att.size, url: f.att.url, kind: f.kind, from: f.from, date: f.date, subject: f.subject, scan: f.att.scan ?? 'unscanned' })), more: list.length > 500 }), true);
  }
  // Save to Drive: copies of the files, the person's own, into a folder of theirs (or My Drive).
  if (p === '/api/mail/files/drive' && req.method === 'POST') {
    const b = await readBody(req);
    const hit = threadFor(me, String(b.threadId ?? ''));
    if (!hit) return (json(res, 404, { error: mark('No such email.') }), true);
    const ro = deps.readOnly(hit.ws);
    if (ro) return (json(res, 403, { error: ro }), true);
    const want = Array.isArray(b.urls) ? new Set(b.urls.map(String)) : null;
    const files = messageFiles(hit.thread, b.messageId ? String(b.messageId) : null, hit.ws.id).filter((f) => !want || want.has(f.a.url));
    if (!files.length) return (json(res, 404, { error: mark('There are no files to save in this email.') }), true);
    const folderId = b.folderId ? String(b.folderId) : null;
    const folder = folderId ? (db.getDoc('drive', folderId) as Doc | undefined) : null;
    if (folderId && (!folder || folder.kind !== 'folder' || folder.trashed || folder.workspaceId !== hit.ws.id)) return (json(res, 404, { error: mark('That folder isn’t in Drive any more.') }), true);
    const bytes = files.reduce((n, f) => n + (db.fileInfo(f.id)?.size ?? 0), 0);
    const room = deps.storageRoom(hit.ws.id, me);
    if (bytes > room.left) return (json(res, 413, { error: room.unlimited ? 'There’s no room left for these files.' : 'They don’t fit: the company’s storage is full. An admin can add more in Settings, Plan & billing.' }), true);
    const now = new Date().toISOString();
    const items: Doc[] = [];
    for (const f of files) {
      const info = db.fileInfo(f.id)!;
      const id = randomBytes(16).toString('hex');
      await copyFile(db.filePath(f.id), db.filePath(id));
      db.recordFile({ id, workspaceId: hit.ws.id, by: me, name: info.name, type: info.type, size: info.size });
      items.push({ id: `d-${randomBytes(6).toString('hex')}`, name: String(f.a.name).slice(0, 200), kind: kindOf({ name: f.a.name, type: info.type }), parentId: folder?.id ?? null, size: info.size, modified: now, threadId: hit.thread.id, workspaceId: hit.ws.id, url: `/api/files/${id}`, uploadedBy: me, ...(folder?.clientId ? { clientId: folder.clientId } : {}) });
    }
    db.writeDocs('drive', items as db.Doc[], [], me);
    deps.broadcast('drive', items, []);
    return (json(res, 200, { items }), true);
  }
  // Big files as links: a Drive copy of each (in "Sent as links from Mail") and a link for the email.
  if (p === '/api/mail/links' && req.method === 'POST') {
    const b = await readBody(req);
    const ws = workspaces().find((w) => w.id === b.workspaceId && (w.members ?? []).some((m: Doc) => m.userId === me));
    if (!ws) return (json(res, 403, { error: mark('Not in this company.') }), true);
    const ro = deps.readOnly(ws);
    if (ro) return (json(res, 403, { error: ro }), true);
    const access = b.access === 'recipients' ? 'recipients' : 'anyone';
    const recipients = (Array.isArray(b.recipients) ? b.recipients : []).map((e: unknown) => String(e).trim().toLowerCase()).filter((e: string) => e.includes('@')).slice(0, 200);
    if (access === 'recipients' && !recipients.length) return (json(res, 400, { error: mark('Add who the email is for first.') }), true);
    const list = (Array.isArray(b.files) ? b.files : []).slice(0, 50);
    const out: Doc[] = [];
    const drive: Doc[] = [];
    let folder = (db.allDocs('drive') as Doc[]).find((d) => d.workspaceId === ws.id && d.kind === 'folder' && !d.parentId && !d.trashed && d.name === LINK_FOLDER && (d.uploadedBy === me || d.ownerId === me));
    const now = new Date().toISOString();
    for (const f of list) {
      const id = fileIdOf(String(f?.url ?? ''));
      const info = id ? db.fileInfo(id) : null;
      // Only the company's files, and only ones this person put there or could already see (their upload, or one in Drive).
      if (!id || !info || info.workspaceId !== ws.id) return (json(res, 403, { error: mark('One of the files isn’t a file of this company.') }), true);
      const inDrive = (db.allDocs('drive') as Doc[]).find((d) => d.workspaceId === ws.id && d.url === `/api/files/${id}` && !d.trashed);
      if (info.by !== me && !inDrive) return (json(res, 403, { error: mark('One of the files isn’t a file of this company.') }), true);
      if (isBlockedName(String(f.name ?? info.name))) return (json(res, 400, { error: WHY.sendType }), true);
      let driveId = inDrive?.id ?? null;
      if (!inDrive) {
        if (!folder) {
          folder = { id: `d-${randomBytes(6).toString('hex')}`, name: LINK_FOLDER, kind: 'folder', parentId: null, size: 0, modified: now, workspaceId: ws.id, uploadedBy: me };
          drive.push(folder);
        }
        const item = { id: `d-${randomBytes(6).toString('hex')}`, name: String(f.name ?? info.name).slice(0, 200), kind: kindOf({ name: info.name, type: info.type }), parentId: folder.id, size: info.size, modified: now, workspaceId: ws.id, url: `/api/files/${id}`, uploadedBy: me };
        drive.push(item);
        driveId = item.id;
      }
      const token = randomBytes(20).toString('hex');
      db.db.prepare('INSERT INTO mail_links (token, workspace_id, file_id, drive_id, name, access, recipients, secret, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(token, ws.id, id, driveId, String(f.name ?? info.name).slice(0, 200), access, JSON.stringify(recipients), randomBytes(24).toString('hex'), me, now);
      out.push({ name: String(f.name ?? info.name), size: info.size, href: `${deps.publicUrl()}/f/${token}`, access });
    }
    if (drive.length) {
      db.writeDocs('drive', drive as db.Doc[], [], me);
      deps.broadcast('drive', drive, []);
    }
    return (json(res, 200, { links: out }), true);
  }
  return false;
}

/* ---------- previews ---------- */

const previews = new Map<string, { at: number; body: string; none?: boolean }>();
/** /api/files/<id>/preview, once the file route has checked who may open it: an HTML page, or why there's none. */
export async function servePreview(res: ServerResponse, f: { id: string; name: string; type: string }, url: URL) {
  const dark = url.searchParams.get('theme') === 'dark';
  const key = `${f.id}:${dark ? 'd' : 'l'}`;
  let hit = previews.get(key);
  if (!hit) {
    const r = await makePreview(db.filePath(f.id), f.name, f.type, dark);
    hit = 'html' in r ? { at: Date.now(), body: r.html } : { at: Date.now(), body: r.none, none: true };
    previews.set(key, hit);
    if (previews.size > 40) previews.delete(previews.keys().next().value!);
  }
  if (hit.none) return json(res, 415, { error: hit.body });
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, max-age=600',
    // Only its own styles and data: pictures, no scripts, nothing from elsewhere; in a sandbox even when opened alone.
    'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff',
  });
  res.end(hit.body);
}

/* ---------- the public link pages (/f/<token>) ---------- */

const pageCss = `body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;color:#1f2328}main{max-width:440px;margin:48px auto;padding:0 16px}.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 4px;overflow-wrap:anywhere}p{margin:8px 0;color:#4b5563}.size{color:#6b7280;font-size:13px}form{margin:16px 0 0;display:grid;gap:8px}input{font:inherit;font-size:16px;padding:12px;border:1px solid #d1d5db;border-radius:10px}button,.btn{display:inline-block;font:inherit;font-weight:600;padding:12px 16px;border-radius:10px;border:0;background:#1f2328;color:#fff;text-decoration:none;text-align:center;cursor:pointer;min-height:44px}.note{font-size:13px;color:#6b7280;margin-top:16px}.err{color:#b42318}`;
const escH = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function linkPage(res: ServerResponse, status: number, title: string, inner: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex', ...extra });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escH(title)}</title><style>${pageCss}</style></head><body><main><div class="card">${inner}</div></main></body></html>`);
}

const codes = new Map<string, { code: string; until: number; tries: number }>();
const signed = (row: LinkRow, email: string, until: number) => createHmac('sha256', row.secret).update(`${email}\n${until}`).digest('hex');
/** The cookie that opens a "recipients only" link after the code: whose it is, until when, signed with the link's secret. */
function cookieOk(req: IncomingMessage, row: LinkRow): boolean {
  const raw = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`s2gf=`))?.slice(5);
  if (!raw) return false;
  const [email, until, sig] = decodeURIComponent(raw).split('|');
  if (!email || !sig || Number(until) < Date.now()) return false;
  const want = Buffer.from(signed(row, email, Number(until)), 'hex');
  const got = Buffer.from(sig, 'hex');
  return got.length === want.length && timingSafeEqual(got, want) && (JSON.parse(row.recipients) as string[]).includes(email);
}

/** /f/<token>: a file sent with a link. True when handled. */
export async function handlePublic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const m = /^\/f\/([a-f0-9]{40})(\/download|\/code|\/open)?$/.exec(url.pathname);
  if (!m || !deps) return false;
  const row = linkRow(m[1]);
  const info = row ? db.fileInfo(row.file_id) : null;
  const ws = row ? (db.getDoc('workspaces', row.workspace_id) as Doc | undefined) : undefined;
  if (!row || !info || !existsSync(db.filePath(info.id)) || ws?.suspended) return (linkPage(res, 404, 'Link not found', '<h1>This link doesn’t work any more</h1><p>The file was removed, or the link was mistyped. Ask the person who sent it for a new one.</p>'), true);
  const recipients = JSON.parse(row.recipients) as string[];
  const who = deps.whoIs(req);
  const allowed = row.access === 'anyone' || cookieOk(req, row) || (!!who && (recipients.includes(who.email) || (ws?.members ?? []).some((x: Doc) => x.userId === who.userId)));
  const head = `<h1>${escH(row.name)}</h1><p class="size">${escH(fmtSize(info.size))}${ws?.name ? ` · ${escH(`Sent from ${ws.name}`)}` : ''}</p>`;
  const action = m[2];
  if (action === '/download') {
    if (!allowed) return (res.writeHead(303, { location: `/f/${row.token}` }), res.end(), true);
    if (deps.tooMany(`flink:${deps.ipOf(req)}`, 120, 60 * 60_000)) return (linkPage(res, 429, 'Try again later', '<h1>Too many downloads</h1><p>Try again in a while.</p>'), true);
    const size = statSync(db.filePath(info.id)).size;
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'private, no-store' });
    createReadStream(db.filePath(info.id)).pipe(res);
    return true;
  }
  if (action === '/code' && req.method === 'POST') {
    const b = await readBody(req, 4096);
    const email = String(b.email ?? '').trim().toLowerCase();
    if (deps.tooMany(`flinkcode:${row.token}:${deps.ipOf(req)}`, 5, 15 * 60_000)) return (linkPage(res, 429, 'Try again later', `${head}<p class="err">That’s a lot of codes in a few minutes. Try again in 15 minutes.</p>`), true);
    // The same answer whether or not the address got the email, so nobody can find out who it went to.
    if (recipients.includes(email)) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      codes.set(`${row.token}\n${email}`, { code, until: Date.now() + 15 * 60_000, tries: 0 });
      const sent = await deps.sendCode(email, `Your code to open ${row.name}`, `Your code to open ${row.name}${ws?.name ? `, sent to you from ${ws.name}` : ''}: ${code}\n\nIt works for 15 minutes. If you didn't ask for it, you can ignore this email.`).catch(() => false);
      if (!sent) console.log(`[mail links] Code for ${email} to open ${row.name}: ${code}`);
    }
    return (linkPage(res, 200, row.name, `${head}<p>If ${escH(email)} is one of the addresses this file was sent to, a 6-digit code is on its way there. Enter it here.</p><form method="post" action="/f/${row.token}/open"><input type="hidden" name="email" value="${escH(email)}"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required maxlength="6"><button type="submit">Open the file</button></form>`), true);
  }
  if (action === '/open' && req.method === 'POST') {
    const b = await readBody(req, 4096);
    const email = String(b.email ?? '').trim().toLowerCase();
    const key = `${row.token}\n${email}`;
    const c = codes.get(key);
    if (!c || c.until < Date.now() || ++c.tries > 5 || c.code !== String(b.code ?? '').trim()) {
      if (c && c.tries > 5) codes.delete(key);
      return (linkPage(res, 400, row.name, `${head}<p class="err">That code isn’t right, or it’s too old. Ask for a new one.</p><form method="post" action="/f/${row.token}/code"><input type="email" name="email" value="${escH(email)}" required><button type="submit">Send a new code</button></form>`), true);
    }
    codes.delete(key);
    const until = Date.now() + 7 * 86_400_000;
    const value = encodeURIComponent(`${email}|${until}|${signed(row, email, until)}`);
    const secure = deps.publicUrl().startsWith('https://') ? '; Secure' : '';
    res.writeHead(303, { location: `/f/${row.token}`, 'set-cookie': `s2gf=${value}; Path=/f/${row.token}; Max-Age=${7 * 86400}; HttpOnly; SameSite=Lax${secure}` });
    res.end();
    return true;
  }
  if (allowed) return (linkPage(res, 200, row.name, `${head}<p>Shared with you by email.</p><a class="btn" href="/f/${row.token}/download">Download</a><p class="note">${scanning() ? '' : 'This file wasn’t checked for viruses. Open it only if you trust who sent it.'}</p>`), true);
  return (linkPage(res, 200, row.name, `${head}<p>Only the people this email went to can open this file. Enter your email address and we’ll send you a code.</p><form method="post" action="/f/${row.token}/code"><input type="email" name="email" placeholder="you@example.com" autocomplete="email" required><button type="submit">Send me a code</button></form>`), true);
}

/** For tests and the docs: the refused types. */
export { BLOCKED_EXTS };
