// Confidential mode (Gmail's): an email that can be read until a date, and not forwarded, copied, printed or downloaded.
//  - The words stay on this server (sealed with the server key). What leaves is a notice: people outside sprint2go get
//    a link of their own (/c/<token>) that shows it on our page; with "Ask for a code", that page first emails them a
//    one-time code (SMS is not offered), so a forwarded link alone doesn't open it.
//  - Mailboxes on sprint2go get the notice too (their mail apps over IMAP and the AI connector see only that); the app
//    opens the words from /api/mail/confidential/<id> while access lasts, with the same limits.
//  - The sender keeps their own copy, sees until when it lasts, and can remove access early.
// Nothing here stops a screenshot; the page and the app say so plainly.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';
import { codeEmail, companyBrand } from './emailLayout.ts';
import { inLang } from './lang.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_confidential (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, by_user TEXT, from_name TEXT NOT NULL, from_email TEXT NOT NULL, subject TEXT NOT NULL, sealed TEXT NOT NULL, expires_at TEXT NOT NULL, passcode INTEGER NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS mail_confidential_msg ON mail_confidential (thread_id, message_id);
  CREATE TABLE IF NOT EXISTS mail_confidential_access (token TEXT PRIMARY KEY, conf_id TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL, account_id TEXT, thread_id TEXT, code_hash TEXT, code_at TEXT, code_tries INTEGER NOT NULL DEFAULT 0, opened_at TEXT);
  CREATE INDEX IF NOT EXISTS mail_confidential_access_conf ON mail_confidential_access (conf_id);
  CREATE TABLE IF NOT EXISTS mail_confidential_pass (id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL);
`);

export type Meta = { id: string; expiresAt: string; passcode: boolean; revokedAt?: string; sender?: boolean };
type Row = { id: string; workspace_id: string; account_id: string; thread_id: string; message_id: string; by_user: string | null; from_name: string; from_email: string; subject: string; sealed: string; expires_at: string; passcode: number; revoked_at: string | null; created_at: string };
type Access = { token: string; conf_id: string; email: string; kind: 'remote' | 'local'; account_id: string | null; thread_id: string | null; code_hash: string | null; code_at: string | null; code_tries: number; opened_at: string | null };
export type Content = { subject: string; from: { name: string; email: string }; date: string; html: string; text: string; files: { name: string; url: string; type?: string }[] };

type Deps = {
  origin: (workspaceId: string) => string;
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
  /** Emails a code to an outside recipient. False when no mail path works (local development: it goes to the log). */
  sendCode: (to: string, subject: string, text: string, html?: string) => Promise<boolean>; // html: server/emailLayout.ts
  log: (line: string) => void;
};
let deps: Deps = {
  origin: () => (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, ''),
  broadcast: () => {},
  sendCode: async () => false,
  log: (line) => console.log(line),
};
export const initConfidential = (d: Partial<Deps>) => void (deps = { ...deps, ...d });

const now = () => new Date().toISOString();
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hash = (token: string, code: string) => createHash('sha256').update(`${token}:${code}`).digest('hex');
const MAX_DAYS = 5 * 365; // Gmail's longest is 5 years
const CODE_MINUTES = 10;
const PASS_HOURS = 12; // a verified browser keeps it open this long (never past the expiry)

/** What the app asks for, cleaned: a future time within five years, and whether outside people need a code. */
export function parseOptions(v: unknown, by: string | null): { expiresAt: string; passcode: boolean; by: string | null } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { expiresAt?: unknown; passcode?: unknown };
  const at = typeof o.expiresAt === 'string' ? Date.parse(o.expiresAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const clamped = Math.min(Math.max(at, Date.now() + 60_000), Date.now() + MAX_DAYS * 86_400_000);
  return { expiresAt: new Date(clamped).toISOString(), passcode: o.passcode === true, by };
}

const state = (r: Pick<Row, 'expires_at' | 'revoked_at'>, at = Date.now()): 'open' | 'expired' | 'revoked' => (r.revoked_at ? 'revoked' : Date.parse(r.expires_at) <= at ? 'expired' : 'open');
const rowOf = (id: string) => db.db.prepare('SELECT * FROM mail_confidential WHERE id = ?').get(id) as Row | undefined;
const metaOf = (r: Row): Meta => ({ id: r.id, expiresAt: r.expires_at, passcode: !!r.passcode, ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}) });
const dateWords = (iso: string) => new Date(iso).toUTCString().replace(/:\d\d GMT$/, ' UTC');

/** The notice that stands in for the words, in mail and in every copy kept on our side. */
function notice(r: { from_name: string; expires_at: string }, link?: string, passcode?: boolean) {
  const lines = [
    `${r.from_name} sent you a confidential email.`,
    link ? `Open it here: ${link}` : 'Open it in sprint2go.',
    `It can be opened until ${dateWords(r.expires_at)}. It can't be forwarded, copied, printed or downloaded.`,
    ...(link && passcode ? ['You will get a code by email before it opens.'] : []),
  ];
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;max-width:560px"><p><b>${esc(r.from_name)}</b> sent you a confidential email.</p>${link ? `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#2448ff;color:#fff;text-decoration:none">View the email</a></p>` : '<p>Open it in sprint2go.</p>'}<p style="color:#6b6f7b;font-size:13px">It can be opened until ${esc(dateWords(r.expires_at))}. It can't be forwarded, copied, printed or downloaded.${link && passcode ? ' You will get a code by email before it opens.' : ''}</p></div>`;
  return { text: lines.join('\n\n'), html };
}

type Prepared = { meta: Meta; text: string; html: string; forRemote: (email: string) => { text: string; html: string } | null };

/**
 * Keeps the words of a confidential email (called by the mail engine as it sends) and returns what goes out instead:
 * the notice for our own mailboxes and the sender's raw copy, and a notice with their own link for each outside person.
 */
export function prepare(o: { workspaceId: string; accountId: string; threadId: string; messageId: string; from: { name: string; email: string }; subject: string; text: string; html?: string; files: { name: string; url: string }[]; confidential?: { expiresAt: string; passcode: boolean; by: string | null } }, who: { mid: string; local: string[]; remote: string[] }): Prepared {
  const c = o.confidential!;
  // One per message: sent again (a retry) it keeps the first.
  const had = db.db.prepare('SELECT * FROM mail_confidential WHERE thread_id = ? AND message_id = ?').get(o.threadId, o.messageId) as Row | undefined;
  const id = had?.id ?? 'c-' + randomBytes(9).toString('hex');
  if (!had)
    db.db
      .prepare('INSERT INTO mail_confidential (id, workspace_id, account_id, thread_id, message_id, by_user, from_name, from_email, subject, sealed, expires_at, passcode, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .run(id, o.workspaceId, o.accountId, o.threadId, o.messageId, c.by, o.from.name, lower(o.from.email), o.subject, db.seal(JSON.stringify({ html: o.html ?? '', text: o.text, files: o.files })), c.expiresAt, c.passcode ? 1 : 0, now());
  const r = rowOf(id)!;
  const tokens = new Map<string, string>();
  const ins = db.db.prepare('INSERT INTO mail_confidential_access (token, conf_id, email, kind) VALUES (?, ?, ?, ?)');
  for (const email of who.remote) {
    const have = db.db.prepare("SELECT token FROM mail_confidential_access WHERE conf_id = ? AND email = ? AND kind = 'remote'").get(id, lower(email)) as { token: string } | undefined;
    const token = have?.token ?? randomBytes(24).toString('base64url');
    if (!have) ins.run(token, id, lower(email), 'remote');
    tokens.set(lower(email), token);
  }
  const base = notice(r);
  return {
    meta: metaOf(r),
    ...base,
    forRemote: (email) => {
      const token = tokens.get(lower(email));
      return token ? notice(r, `${deps.origin(o.workspaceId)}/c/${token}`, !!r.passcode) : null;
    },
  };
}

/** A copy landed in one of our own mailboxes (its people open the words in the app). */
export function deliveredTo(id: string, accountId: string, threadId: string) {
  db.db.prepare("INSERT INTO mail_confidential_access (token, conf_id, email, kind, account_id, thread_id) VALUES (?, ?, '', 'local', ?, ?)").run(randomBytes(24).toString('base64url'), id, accountId, threadId);
}

/* ---------- the meta on messages: the server's, never the app's ---------- */

const early = new Map<string, { meta: Meta; at: number }>();
/** Puts the meta on the sender's copy (or keeps it for a moment, when the app hasn't saved the thread yet). */
export function markSender(threadId: string, messageId: string, meta: Meta) {
  const m = { ...meta, sender: true };
  const t = db.getDoc('threads', threadId) as any;
  if (!t || !(t.messages ?? []).some((x: any) => x.id === messageId)) {
    early.set(`${threadId} ${messageId}`, { meta: m, at: Date.now() });
    for (const [k, v] of early) if (Date.now() - v.at > 30 * 60_000) early.delete(k);
    return;
  }
  setMeta(t, messageId, m);
}
function setMeta(t: any, messageId: string, meta: Meta) {
  const next = { ...t, messages: (t.messages ?? []).map((x: any) => (x.id === messageId ? { ...x, confidential: meta } : x)) };
  db.writeDocs('threads', [next], [], null);
  deps.broadcast('threads', [next], []);
}

/** The sync guard for threads: a message's confidential meta is the server's (kept as it was; the app can't add or change it). */
export function guardThread(d: db.Doc, before: db.Doc | undefined): db.Doc {
  const list = (d as any).messages;
  if (!Array.isArray(list)) return d;
  const prev = new Map(((before as any)?.messages ?? []).map((m: any) => [m?.id, m]));
  let changed = false;
  const messages = list.map((m: any) => {
    if (!m || typeof m !== 'object') return m;
    const b = prev.get(m.id) as any;
    const e = early.get(`${d.id} ${m.id}`);
    const want = b?.confidential ?? e?.meta;
    if (e) early.delete(`${d.id} ${m.id}`);
    if (JSON.stringify(want ?? null) === JSON.stringify(m.confidential ?? null)) return m;
    changed = true;
    const { confidential: _c, ...rest } = m;
    return want ? { ...rest, confidential: want } : rest;
  });
  return changed ? ({ ...d, messages } as db.Doc) : d;
}

/* ---------- reading it ---------- */

function content(r: Row, fileUrl: (i: number) => string): Content {
  const words = JSON.parse(db.unseal(r.sealed)) as { html: string; text: string; files: { name: string; url: string }[] };
  return {
    subject: r.subject,
    from: { name: r.from_name, email: r.from_email },
    date: r.created_at,
    html: words.html,
    text: words.text,
    files: (words.files ?? []).map((f, i) => ({ name: f.name, url: fileUrl(i), type: typeOfFile(f.url, r.workspace_id) })),
  };
}
const typeOfFile = (url: string, wsId: string) => {
  const id = url.match(/^\/api\/files\/([a-f0-9]{32})$/)?.[1];
  const f = id ? db.fileInfo(id) : null;
  return f && f.workspaceId === wsId ? f.type : url.match(/^data:([^;,]+)/)?.[1];
};
function fileOf(r: Row, i: number): { data: Buffer; type: string; name: string } | null {
  const words = JSON.parse(db.unseal(r.sealed)) as { files: { name: string; url: string }[] };
  const f = words.files?.[i];
  if (!f) return null;
  const id = f.url.match(/^\/api\/files\/([a-f0-9]{32})$/)?.[1];
  if (id) {
    const info = db.fileInfo(id);
    const data = info && info.workspaceId === r.workspace_id ? db.fileData(id) : null;
    return data ? { data, type: info!.type, name: f.name } : null;
  }
  const d = f.url.match(/^data:([^;,]*);base64,(.+)$/);
  return d ? { data: Buffer.from(d[2], 'base64'), type: d[1] || 'application/octet-stream', name: f.name } : null;
}

/** Who may open it in the app: the people of a mailbox it was delivered to, and the people of the mailbox it was sent from. */
function mayRead(r: Row, userId: string, canOpen: (accountId: string) => boolean) {
  if (r.by_user === userId || canOpen(r.account_id)) return 'sender' as const;
  const boxes = db.db.prepare("SELECT account_id FROM mail_confidential_access WHERE conf_id = ? AND kind = 'local'").all(r.id) as { account_id: string }[];
  return boxes.some((b) => canOpen(b.account_id)) ? ('recipient' as const) : null;
}

/** /api/mail/confidential/<id>[/file/<i>] for people signed in; POST /api/mail/confidential/revoke for the sender. */
export async function handleApi(p: string, req: IncomingMessage, res: ServerResponse, ctx: { me: string; canOpen: (accountId: string) => boolean; json: (res: ServerResponse, status: number, data: unknown) => void; body: () => Promise<any> }): Promise<boolean> {
  if (p === '/api/mail/confidential/revoke' && req.method === 'POST') {
    const b = await ctx.body();
    const r = rowOf(String(b.id ?? ''));
    if (!r || mayRead(r, ctx.me, ctx.canOpen) !== 'sender') return (ctx.json(res, 404, { error: 'No such confidential email.' }), true);
    if (!r.revoked_at) db.db.prepare('UPDATE mail_confidential SET revoked_at = ? WHERE id = ?').run(now(), r.id);
    const fresh = rowOf(r.id)!;
    spreadMeta(fresh);
    return (ctx.json(res, 200, { meta: metaOf(fresh) }), true);
  }
  const m = p.match(/^\/api\/mail\/confidential\/(c-[a-f0-9]{18})(?:\/file\/(\d{1,3}))?$/);
  if (!m || req.method !== 'GET') return false;
  const r = rowOf(m[1]);
  const who = r ? mayRead(r, ctx.me, ctx.canOpen) : null;
  if (!r || !who) return (ctx.json(res, 404, { error: 'No such confidential email.' }), true);
  // The sender always sees their own; a recipient only while it lasts.
  const s = state(r);
  if (who === 'recipient' && s !== 'open') return (ctx.json(res, 410, { state: s, meta: metaOf(r) }), true);
  if (m[2] !== undefined) {
    const f = fileOf(r, Number(m[2]));
    if (!f) return (ctx.json(res, 404, {}), true);
    // Pictures only, shown in place: nothing here is offered as a download.
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(f.type)) return (ctx.json(res, 403, { error: 'Files in a confidential email can’t be downloaded.' }), true);
    res.writeHead(200, { 'content-type': f.type, 'cache-control': 'private, no-store', 'content-disposition': 'inline', 'x-content-type-options': 'nosniff' });
    res.end(f.data);
    return true;
  }
  res.setHeader('cache-control', 'private, no-store');
  ctx.json(res, 200, { state: s, meta: metaOf(r), content: content(r, (i) => `/api/mail/confidential/${r.id}/file/${i}`) });
  return true;
}

/** After the sender removed access: every copy on our side shows it (the sender's and our mailboxes'). */
function spreadMeta(r: Row) {
  const meta = metaOf(r);
  const sender = db.getDoc('threads', r.thread_id) as any;
  if (sender) setMeta(sender, r.message_id, { ...meta, sender: true });
  const copies = db.db.prepare("SELECT thread_id FROM mail_confidential_access WHERE conf_id = ? AND kind = 'local'").all(r.id) as { thread_id: string }[];
  for (const c of copies) {
    const t = db.getDoc('threads', c.thread_id) as any;
    const m = (t?.messages ?? []).find((x: any) => x.confidential?.id === r.id);
    if (t && m) setMeta(t, m.id, meta);
  }
}

/** Where a confidential email stands, for tests and the operator: its state and its outside links. */
export function info(threadId: string, messageId: string) {
  const r = db.db.prepare('SELECT * FROM mail_confidential WHERE thread_id = ? AND message_id = ?').get(threadId, messageId) as Row | undefined;
  if (!r) return null;
  return { ...metaOf(r), state: state(r) };
}

/* ---------- the page for people outside sprint2go: /c/<token> ---------- */

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const passCookie = (token: string) => `s2gc_${token.slice(0, 12)}`;
const cookieOf = (req: IncomingMessage, name: string) => req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);

function page(res: ServerResponse, status: number, title: string, inner: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--text:#16161d;--muted:#6b6f7b;--line:#e3e5ea;--accent:#2448ff}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--card:#16191e;--text:#eceef2;--muted:#9aa0ab;--line:#2a2e35;--accent:#6b84ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
main{max-width:720px;margin:0 auto;padding:32px 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:20px;line-height:1.3;margin:0 0 8px;font-weight:700}.meta{color:var(--muted);font-size:13px;margin:0 0 16px}.lock{display:inline-flex;gap:8px;align-items:center;font-size:13px;color:var(--muted);margin-bottom:16px}
.body{border-top:1px solid var(--line);padding-top:16px;overflow-wrap:anywhere}.body img{max-width:100%;height:auto}.body a{color:var(--accent)}
.files{margin-top:16px;display:flex;flex-wrap:wrap;gap:8px}.file{border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:13px;color:var(--muted)}
form{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}input{font:inherit;font-size:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);min-width:0;flex:1 1 160px;letter-spacing:.2em}
button{font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;border:0;background:var(--accent);color:#fff;cursor:pointer;min-height:44px}.link{background:none;color:var(--accent);padding:10px 0}
.note{color:var(--muted);font-size:13px;margin-top:16px}.err{color:#d93025;font-size:13px;margin-top:8px}
@media print{body *{display:none!important}body::after{content:"Printing is turned off for confidential email.";display:block!important;padding:24px}}
</style></head><body><main><div class="card">${inner}</div><p class="note">Sent with sprint2go confidential mode. It can't be forwarded, copied, printed or downloaded here; nothing can stop a screenshot.</p></main></body></html>`);
  return true;
}

const shut = (res: ServerResponse, r: Row) =>
  state(r) === 'revoked'
    ? page(res, 410, 'Access removed', `<h1>Access removed</h1><p>${esc(r.from_name)} removed access to this email.</p>`)
    : page(res, 410, 'This email expired', `<h1>This email expired</h1><p>It could be opened until ${esc(dateWords(r.expires_at))}. Ask ${esc(r.from_name)} to send it again if you still need it.</p>`);

/** Whether this browser proved it has the code (a pass made after the code was right, for this token only). */
function passed(req: IncomingMessage, a: Access) {
  const id = cookieOf(req, passCookie(a.token));
  if (!id) return false;
  const pass = db.db.prepare('SELECT token, expires_at FROM mail_confidential_pass WHERE id = ?').get(createHash('sha256').update(id).digest('hex')) as { token: string; expires_at: string } | undefined;
  return !!pass && pass.token === a.token && pass.expires_at > now();
}

/** The public page and its actions. `tooMany` limits codes per address. Returns false for addresses it doesn't own. */
export async function handlePublic(req: IncomingMessage, res: ServerResponse, p: string, opts: { tooMany: (key: string, max: number, windowMs: number) => boolean; form: () => Promise<URLSearchParams>; secure: boolean }): Promise<boolean> {
  const m = p.match(/^\/c\/([A-Za-z0-9_-]{32})(?:\/(code|verify|file\/(\d{1,3})))?$/);
  if (!m) return false;
  const a = db.db.prepare("SELECT * FROM mail_confidential_access WHERE token = ? AND kind = 'remote'").get(m[1]) as Access | undefined;
  const r = a ? rowOf(a.conf_id) : undefined;
  if (!a || !r) return page(res, 404, 'Link not found', '<h1>This link doesn’t work</h1><p>Check that you copied the whole link from the email.</p>');
  if (state(r) !== 'open') return shut(res, r);
  const masked = a.email.replace(/^(.)(.*)(@.*)$/, (_x, f: string, mid: string, d: string) => f + '•'.repeat(Math.min(6, Math.max(1, mid.length))) + d);
  const back = (q = '') => (res.writeHead(303, { location: `/c/${a.token}${q}`, 'cache-control': 'no-store' }), res.end(), true);
  const ok = !r.passcode || passed(req, a);

  if (m[2] === 'code' && req.method === 'POST') {
    if (!r.passcode) return back();
    if (opts.tooMany(`conf-code:${a.token}`, 5, 3600_000)) return back('?e=many');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    db.db.prepare('UPDATE mail_confidential_access SET code_hash = ?, code_at = ?, code_tries = 0 WHERE token = ?').run(hash(a.token, code), now(), a.token);
    const m = confidentialCodeMail(r.from_name, code, r.workspace_id);
    const sent = await deps.sendCode(a.email, m.subject, m.text, m.html).catch(() => false);
    if (!sent) deps.log(`[confidential] code for ${a.email}: ${code}`);
    return back('?sent=1');
  }
  if (m[2] === 'verify' && req.method === 'POST') {
    if (!r.passcode) return back();
    const f = await opts.form();
    const code = String(f.get('code') ?? '').replace(/\D/g, '');
    const fresh = a.code_hash && a.code_at && Date.parse(a.code_at) > Date.now() - CODE_MINUTES * 60_000 && a.code_tries < 5;
    db.db.prepare('UPDATE mail_confidential_access SET code_tries = code_tries + 1 WHERE token = ?').run(a.token);
    const right = !!fresh && code.length === 6 && timingSafeEqual(Buffer.from(hash(a.token, code)), Buffer.from(a.code_hash!));
    if (!right) return back(fresh ? '?sent=1&e=wrong' : '?e=old');
    const id = randomBytes(24).toString('base64url');
    const until = new Date(Math.min(Date.parse(r.expires_at), Date.now() + PASS_HOURS * 3600_000)).toISOString();
    db.db.prepare('INSERT INTO mail_confidential_pass (id, token, expires_at) VALUES (?, ?, ?)').run(createHash('sha256').update(id).digest('hex'), a.token, until);
    db.db.prepare('UPDATE mail_confidential_access SET code_hash = NULL WHERE token = ?').run(a.token);
    res.setHeader('set-cookie', `${passCookie(a.token)}=${id}; HttpOnly; SameSite=Lax; Path=/c/${a.token}; Max-Age=${Math.max(60, Math.round((Date.parse(until) - Date.now()) / 1000))}${opts.secure ? '; Secure' : ''}`);
    return back();
  }
  if (m[3] !== undefined && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!ok) return (res.writeHead(403), res.end(), true);
    const f = fileOf(r, Number(m[3]));
    if (!f || !/^image\/(png|jpe?g|gif|webp)$/i.test(f.type)) return (res.writeHead(404), res.end(), true);
    res.writeHead(200, { 'content-type': f.type, 'cache-control': 'private, no-store', 'content-disposition': 'inline', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : f.data);
    return true;
  }
  if (m[2] || (req.method !== 'GET' && req.method !== 'HEAD')) return back();

  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  if (!ok) {
    const sentNow = q.get('sent') === '1';
    const err = q.get('e') === 'wrong' ? 'That code isn’t right. Check the newest email and try again.' : q.get('e') === 'old' ? 'That code has run out. Ask for a new one.' : q.get('e') === 'many' ? 'That’s a lot of codes in an hour. Try again later.' : '';
    return page(
      res,
      200,
      'Confidential email',
      `<div class="lock">Confidential email from ${esc(r.from_name)}</div><h1>Confirm it’s you</h1><p>${sentNow ? `We emailed a code to ${esc(masked)}. Type it here.` : `To open it, we’ll email a code to ${esc(masked)}.`}</p>${
        sentNow
          ? `<form method="post" action="/c/${a.token}/verify"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" aria-label="Code" required><button type="submit">Open</button></form><form method="post" action="/c/${a.token}/code"><button class="link" type="submit">Send a new code</button></form>`
          : `<form method="post" action="/c/${a.token}/code"><button type="submit">Send me a code</button></form>`
      }${err ? `<p class="err">${esc(err)}</p>` : ''}`,
    );
  }
  if (!a.opened_at) db.db.prepare('UPDATE mail_confidential_access SET opened_at = ? WHERE token = ?').run(now(), a.token);
  const c = content(r, (i) => `/c/${a.token}/file/${i}`);
  const pics = c.files.map((f, i) => ({ ...f, i })).filter((f) => /^image\/(png|jpe?g|gif|webp)$/i.test(f.type ?? ''));
  const body = c.html ? cleanHtml(c.html) : c.text.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  return page(
    res,
    200,
    c.subject || 'Confidential email',
    `<div class="lock">Confidential: can be opened until ${esc(dateWords(r.expires_at))}</div><h1>${esc(c.subject || '(no subject)')}</h1><p class="meta">${esc(c.from.name)} &lt;${esc(c.from.email)}&gt;, ${esc(dateWords(c.date))}</p><div class="body">${body}${pics.map((f) => `<p><img src="${esc(f.url)}" alt="${esc(f.name)}"></p>`).join('')}</div>${c.files.length ? `<div class="files">${c.files.map((f) => `<span class="file">${esc(f.name)}</span>`).join('')}</div><p class="note">Attachments can’t be downloaded from a confidential email.</p>` : ''}`,
  );
}

/**
 * The words as HTML for our own page: no scripts, no handlers, no forms or frames, no outside pictures (the page's CSP
 * blocks scripts and outside loads anyway; this keeps the markup tidy too).
 */
export function cleanHtml(html: string) {
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, '$1="#"');
}

/** Words of confidential email that closed a month ago go (the sender keeps their own copy); old passes go. */
export function sweep() {
  const before = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const gone = db.db.prepare("SELECT id FROM mail_confidential WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?").all(before, before) as { id: string }[];
  for (const g of gone) db.db.prepare("UPDATE mail_confidential SET sealed = ? WHERE id = ?").run(db.seal(JSON.stringify({ html: '', text: '', files: [] })), g.id);
  db.db.prepare('DELETE FROM mail_confidential_pass WHERE expires_at < ?').run(now());
  return gone.length;
}

/** The passcode email for a confidential message (English, as before), in the sender's company colours. */
export function confidentialCodeMail(fromName: string, code: string, workspaceId: string) {
  return inLang('en', () => {
    const subject = `Your code for ${fromName}'s confidential email`;
    const m = codeEmail({ brand: companyBrand(workspaceId), title: `Your code for ${fromName}'s email`, lead: 'Enter this code on the page you asked from to read the confidential email.', preheader: `Your code is ${code}`, code, minutes: CODE_MINUTES, footer: ["It works only on the page you asked from. If you didn't ask for it, you can ignore this email."] });
    return { subject, ...m };
  });
}
