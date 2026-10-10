// POP3 (RFC 1939, with CAPA, UIDL, TOP, STLS and SASL PLAIN), for mail apps and services that only fetch: an old
// desktop client, a CRM's "fetch mail" setting, another Gmail account's "Check mail from other accounts". Next to
// IMAP (server/imap.ts) and off by default the same way: POP3_ENABLED=1, the same trusted certificate and app passwords
// (server/mailApps.ts), never the sprint2go password, and only once the line is encrypted. Each person also switches
// it on for themselves (Settings, Mailbox access), as in Gmail.
//  - What it offers: the mail that arrived in the mailbox the user name names (their own by default): not Spam,
//    Trash or drafts, nothing they sent, only from the moment POP was switched on when they chose "from now on".
//  - As in Gmail, an email a POP app has fetched isn't offered again, and what happens to the copy here is the
//    person's choice: kept as it is, marked read, archived (Done) or moved to Trash. That happens at QUIT, for every
//    message the app downloaded (RETR) or deleted (DELE); a connection that drops changes nothing.
// Ports: POP3S_PORT (995, TLS) and POP3_PORT (110, STLS); outside production 1995 and 1110.
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import { TLSSocket, createServer as createTlsServer, type SecureContext, type Server as TlsServer } from 'node:tls';
import { createHash } from 'node:crypto';
import * as db from './db.ts';
import * as store from './imapStore.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS pop_prefs (user_id TEXT PRIMARY KEY, on_ INTEGER NOT NULL, after TEXT NOT NULL, since TEXT, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pop_seen (user_id TEXT NOT NULL, account_id TEXT NOT NULL, mkey TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (user_id, account_id, mkey));
`);

export type After = 'keep' | 'read' | 'archive' | 'trash';
export const AFTERS: After[] = ['keep', 'read', 'archive', 'trash'];
export interface PopPrefs {
  on: boolean;
  after: After;
  since: string | null; // "from now on": only mail that arrived after this
}
export function prefsOf(userId: string): PopPrefs {
  const r = db.db.prepare('SELECT on_, after, since FROM pop_prefs WHERE user_id = ?').get(userId) as { on_: number; after: After; since: string | null } | undefined;
  return { on: !!r?.on_, after: r?.after ?? 'keep', since: r?.since ?? null };
}
export function setPrefs(userId: string, p: { on?: boolean; after?: string; from?: 'all' | 'now' }) {
  const had = prefsOf(userId);
  const on = p.on ?? had.on;
  const after: After = AFTERS.includes(p.after as After) ? (p.after as After) : had.after;
  // "From now on" starts when it's chosen; "all mail" has no start.
  const since = p.from === 'all' ? null : p.from === 'now' ? (had.since && had.on ? had.since : new Date().toISOString()) : had.since;
  db.db.prepare('INSERT INTO pop_prefs (user_id, on_, after, since, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET on_ = excluded.on_, after = excluded.after, since = excluded.since, updated_at = excluded.updated_at').run(userId, on ? 1 : 0, after, since, new Date().toISOString());
  return prefsOf(userId);
}

export interface PopDeps {
  secureContext: () => SecureContext;
  login: (username: string, password: string, ip: string) => Promise<{ ok: true; userId: string; passwordId: string } | { ok: false; why: string }>;
  mailboxes: (userId: string, username: string) => store.Mailbox[];
  stillOk: (userId: string, passwordId: string) => boolean;
  writer: store.Writer;
  log: (line: string) => void;
}
let deps: PopDeps;

const MAX_LINE = 8 * 1024;
const IDLE = 10 * 60_000;
const MAX_PER_USER = 10;
const MAX_TOTAL = 1000;
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();

interface Item {
  t: store.Thread;
  m: store.Msg;
  key: string; // the stable id (UIDL)
  size: number;
}

/** What a mailbox offers over POP now: arrived mail not yet fetched by POP, oldest first. */
export async function maildrop(userId: string, mb: store.Mailbox, since: string | null): Promise<Item[]> {
  const ctx = new store.Ctx();
  const seen = new Set((db.db.prepare('SELECT mkey FROM pop_seen WHERE user_id = ? AND account_id = ?').all(userId, mb.id) as { mkey: string }[]).map((r) => r.mkey));
  const out: Item[] = [];
  for (const t of ctx.threadsOf(mb.id)) {
    if (t.location === 'spam' || t.location === 'trash' || t.location === 'drafts') continue;
    for (const m of t.messages) {
      if (mb.addresses.has(lower(m.from?.email)) || m.delivery?.state === 'held') continue;
      if (since && String(m.date) < since) continue;
      const key = createHash('sha256').update(`${t.id} ${m.id}`).digest('base64url').slice(0, 22);
      if (seen.has(key)) continue;
      out.push({ t, m, key, size: await store.sizeOf(ctx, t, m, mb) });
    }
  }
  return out.sort((a, b) => String(a.m.date).localeCompare(String(b.m.date)));
}

/** What happens to the copies a POP app took: kept, read, archived or in Trash; and they're not offered again. */
export function settle(userId: string, mb: store.Mailbox, items: Item[], after: After) {
  if (!items.length) return { ok: true as const };
  const put = db.db.prepare('INSERT OR IGNORE INTO pop_seen (user_id, account_id, mkey, at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  for (const it of items) put.run(userId, mb.id, it.key, now);
  if (after === 'keep') return { ok: true as const };
  const ids = [...new Set(items.map((i) => i.t.id))];
  const threads = ids.map((id) => db.getDoc('threads', id) as unknown as store.Thread | undefined).filter((t): t is store.Thread => !!t && t.accountId === mb.id);
  const next = threads.map((t) => (after === 'read' ? { ...t, unread: false } : after === 'archive' ? { ...t, location: t.location === 'inbox' ? 'archive' : t.location } : { ...t, location: 'trash', unread: false }));
  return deps.writer.write(userId, next, []);
}

/* ---------- the protocol ---------- */

type Sock = Socket | TLSSocket;
interface Conn {
  sock: Sock;
  tls: boolean;
  ip: string;
  state: 'auth' | 'trans' | 'done';
  user: string;
  userId?: string;
  passwordId?: string;
  mb?: store.Mailbox;
  items: Item[];
  deleted: Set<number>;
  fetched: Set<number>;
  buf: Buffer;
  timer?: NodeJS.Timeout;
}
const conns = new Set<Conn>();
const send = (c: Conn, line: string) => c.sock.writable && c.sock.write(`${line}\r\n`);
/** A multi-line answer: dot-stuffed, ending with a lone dot. */
function sendLines(c: Conn, first: string, body: Buffer) {
  const text = body.toString('latin1').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  c.sock.write(Buffer.from(`${first}\r\n${text}${text.endsWith('\r\n') || !text ? '' : '\r\n'}.\r\n`, 'latin1'));
}
const caps = (c: Conn) => ['TOP', 'UIDL', 'RESP-CODES', 'AUTH-RESP-CODE', 'PIPELINING', 'EXPIRE NEVER', 'IMPLEMENTATION sprint2go', ...(c.tls ? ['USER', 'SASL PLAIN'] : ['STLS'])];
const alive = (c: Conn) => {
  clearTimeout(c.timer);
  c.timer = setTimeout(() => (send(c, '-ERR [SYS/TEMP] Idle for too long, closing'), c.sock.end()), IDLE);
};

async function signIn(c: Conn, user: string, pass: string) {
  if (!c.tls) return send(c, '-ERR [AUTH] Use STLS first: passwords only go over an encrypted line');
  const r = await deps.login(user, pass, c.ip);
  if (!r.ok) return send(c, `-ERR [AUTH] ${r.why}`);
  if ([...conns].filter((x) => x.userId === r.userId).length >= MAX_PER_USER) return send(c, '-ERR [IN-USE] Too many POP connections for this account');
  const prefs = prefsOf(r.userId);
  if (!prefs.on) return send(c, '-ERR [AUTH] POP is off for this account. Switch it on in sprint2go, Settings, Mailbox access.');
  const boxes = deps.mailboxes(r.userId, user);
  const mb = boxes.find((b) => b.primary && b.hosted) ?? boxes.find((b) => b.hosted);
  if (!mb) return send(c, '-ERR [AUTH] There’s no mailbox here for this account');
  c.userId = r.userId;
  c.passwordId = r.passwordId;
  c.mb = mb;
  c.items = await maildrop(r.userId, mb, prefs.since);
  c.state = 'trans';
  send(c, `+OK ${mb.email} has ${c.items.length} message${c.items.length === 1 ? '' : 's'}`);
}

const num = (c: Conn, arg: string | undefined) => {
  const n = Number(arg);
  return Number.isInteger(n) && n >= 1 && n <= c.items.length && !c.deleted.has(n) ? n : null;
};

async function command(c: Conn, line: string) {
  const [verb0, ...args] = line.split(' ');
  const verb = verb0.toUpperCase();
  if (verb === 'QUIT') {
    if (c.state === 'trans' && c.userId && c.mb) {
      const taken = c.items.filter((_, i) => c.deleted.has(i + 1) || c.fetched.has(i + 1));
      const r = settle(c.userId, c.mb, taken, prefsOf(c.userId).after);
      send(c, r.ok ? '+OK Bye' : `-ERR [SYS/TEMP] ${r.why ?? 'Some changes couldn’t be saved'}`);
    } else send(c, '+OK Bye');
    c.state = 'done';
    return void c.sock.end();
  }
  if (verb === 'CAPA') return sendLines(c, '+OK Capability list follows', Buffer.from(caps(c).join('\r\n')));
  if (verb === 'NOOP') return send(c, c.state === 'trans' ? '+OK' : '-ERR Sign in first');
  if (c.state === 'auth') {
    if (verb === 'STLS') {
      if (c.tls) return send(c, '-ERR Already encrypted');
      send(c, '+OK Begin TLS');
      return startTls(c);
    }
    if (verb === 'USER') {
      if (!c.tls) return send(c, '-ERR [AUTH] Use STLS first: passwords only go over an encrypted line');
      c.user = args.join(' ');
      return send(c, '+OK Now the app password');
    }
    if (verb === 'PASS') {
      if (!c.user) return send(c, '-ERR USER first');
      return signIn(c, c.user, args.join(' '));
    }
    if (verb === 'AUTH') {
      if ((args[0] ?? '').toUpperCase() !== 'PLAIN') return send(c, '-ERR Only PLAIN');
      const take = (b64: string) => {
        const parts = Buffer.from(b64, 'base64').toString('utf8').split('\0');
        return signIn(c, parts[1] ?? '', parts[2] ?? '');
      };
      if (args[1]) return take(args[1]);
      send(c, '+ ');
      pendingAuth.set(c, take);
      return;
    }
    return send(c, '-ERR Sign in first');
  }
  // Signed in: the app password must still be there (removing one ends its connections).
  if (!c.userId || !c.passwordId || !deps.stillOk(c.userId, c.passwordId)) {
    send(c, '-ERR [AUTH] This sign-in no longer works');
    return void c.sock.end();
  }
  const live = () => c.items.map((it, i) => ({ it, n: i + 1 })).filter((x) => !c.deleted.has(x.n));
  switch (verb) {
    case 'STAT': {
      const l = live();
      return send(c, `+OK ${l.length} ${l.reduce((s, x) => s + x.it.size, 0)}`);
    }
    case 'LIST':
    case 'UIDL': {
      const show = (x: { it: Item; n: number }) => `${x.n} ${verb === 'LIST' ? x.it.size : x.it.key}`;
      if (args[0]) {
        const n = num(c, args[0]);
        return send(c, n ? `+OK ${show({ it: c.items[n - 1], n })}` : '-ERR No such message');
      }
      return sendLines(c, '+OK', Buffer.from(live().map(show).join('\r\n')));
    }
    case 'RETR':
    case 'TOP': {
      const n = num(c, args[0]);
      if (!n) return send(c, '-ERR No such message');
      const it = c.items[n - 1];
      let raw = await store.source(it.t, it.m, c.mb!);
      if (verb === 'TOP') {
        const lines = Number(args[1]);
        if (!Number.isInteger(lines) || lines < 0) return send(c, '-ERR TOP needs a number of lines');
        const s = raw.toString('latin1');
        const at = s.indexOf('\r\n\r\n');
        raw = Buffer.from(at < 0 ? s : s.slice(0, at + 4) + s.slice(at + 4).split('\r\n').slice(0, lines).join('\r\n'), 'latin1');
      } else c.fetched.add(n);
      return sendLines(c, `+OK ${raw.length} octets`, raw);
    }
    case 'DELE': {
      const n = num(c, args[0]);
      if (!n) return send(c, '-ERR No such message');
      c.deleted.add(n);
      return send(c, `+OK Message ${n} deleted`);
    }
    case 'RSET':
      c.deleted.clear();
      c.fetched.clear();
      return send(c, '+OK');
    default:
      return send(c, '-ERR Unknown command');
  }
}
const pendingAuth = new Map<Conn, (b64: string) => unknown>();

function feed(c: Conn, chunk: Buffer) {
  c.buf = Buffer.concat([c.buf, chunk]);
  if (c.buf.length > MAX_LINE && c.buf.indexOf('\n') < 0) {
    send(c, '-ERR Line too long');
    return void c.sock.destroy();
  }
  void drain(c);
}
let draining = new WeakSet<Conn>();
async function drain(c: Conn) {
  if (draining.has(c)) return;
  draining.add(c);
  try {
    for (let i = c.buf.indexOf('\n'); i >= 0 && c.state !== 'done'; i = c.buf.indexOf('\n')) {
      const line = c.buf.subarray(0, i).toString('utf8').replace(/\r$/, '');
      c.buf = c.buf.subarray(i + 1);
      alive(c);
      const pending = pendingAuth.get(c);
      if (pending) {
        pendingAuth.delete(c);
        await (line === '*' ? send(c, '-ERR Cancelled') : pending(line));
        continue;
      }
      try {
        await command(c, line);
      } catch (e) {
        deps.log(`[pop3] ${e instanceof Error ? e.message : e}`);
        send(c, '-ERR [SYS/TEMP] Something went wrong on our side');
      }
      if (!c.tls && c.state === 'auth' && (c as Conn & { upgrading?: boolean }).upgrading) break;
    }
  } finally {
    draining.delete(c);
  }
}

function startTls(c: Conn) {
  (c as Conn & { upgrading?: boolean }).upgrading = true;
  c.buf = Buffer.alloc(0); // anything sent with STLS before the handshake is thrown away
  const plain = c.sock as Socket;
  plain.removeAllListeners('data');
  const secure = new TLSSocket(plain, { isServer: true, secureContext: deps.secureContext() });
  secure.on('secure', () => {
    c.sock = secure;
    c.tls = true;
    (c as Conn & { upgrading?: boolean }).upgrading = false;
  });
  secure.on('data', (d: Buffer) => feed(c, d));
  secure.on('error', () => secure.destroy());
  secure.on('close', () => end(c));
}

function end(c: Conn) {
  clearTimeout(c.timer);
  pendingAuth.delete(c);
  conns.delete(c);
}
function accept(sock: Sock, tls: boolean) {
  if (conns.size >= MAX_TOTAL) return void sock.destroy();
  const c: Conn = { sock, tls, ip: sock.remoteAddress ?? '', state: 'auth', user: '', items: [], deleted: new Set(), fetched: new Set(), buf: Buffer.alloc(0) };
  conns.add(c);
  alive(c);
  sock.on('data', (d: Buffer) => feed(c, d));
  sock.on('error', () => sock.destroy());
  sock.on('close', () => end(c));
  send(c, '+OK sprint2go POP3 ready');
}

let servers: (NetServer | TlsServer)[] = [];
export async function start(d: PopDeps, ports: { pop3: number; pop3s: number }, host: string) {
  deps = d;
  draining = new WeakSet();
  const plain = createNetServer((s) => accept(s, false));
  const secure = createTlsServer({ SNICallback: (_n, cb) => cb(null, deps.secureContext()) }, (s) => accept(s, true));
  await Promise.all(
    ([
      [plain, ports.pop3],
      [secure, ports.pop3s],
    ] as const).map(([srv, port]) => new Promise<void>((res, rej) => (srv.once('error', rej), srv.listen(port, host, () => res())))),
  );
  servers = [plain, secure];
}
export async function stop() {
  for (const c of conns) c.sock.destroy();
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers = [];
}
/** Ends the connections of a removed app password, someone signed out everywhere, or POP switched off. */
export function endFor(match: (userId: string, passwordId: string) => boolean) {
  for (const c of conns) if (c.userId && c.passwordId && match(c.userId, c.passwordId)) c.sock.destroy();
}
export function updateContext() {
  /* each new connection asks deps.secureContext(), so a renewed certificate is used at once */
}
