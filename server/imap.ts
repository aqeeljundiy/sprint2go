// IMAP for phone and desktop mail apps (iPhone and iPad Mail, Gmail and Outlook on Android, Thunderbird): IMAP4rev1
// (RFC 3501) with IDLE, UIDPLUS, MOVE, NAMESPACE, SPECIAL-USE, LITERAL+, ENABLE, ID, UNSELECT, CHILDREN, CONDSTORE
// and APPENDLIMIT. Implicit TLS on one port and STARTTLS on another, with the mail engine's certificate; signing in
// (LOGIN, AUTHENTICATE PLAIN) only once the line is encrypted, and only with an app password (server/mailApps.ts).
// What's in the folders and what changes do: server/imapStore.ts. Live pushes (IDLE, and between commands) come from
// the app's own change events (index.ts broadcast).
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import { createServer as createTlsServer, TLSSocket, type SecureContext, type Server as TlsServer } from 'node:tls';
import { randomBytes } from 'node:crypto';
import * as store from './imapStore.ts';
import { bodystructure, envelope, join, list, nstring, parse, parseSection, sectionBytes, toBuffer, headerValues, type Chunk, type Part, type Section } from './imapMime.ts';

export interface ImapDeps {
  /** The certificate, as it is now (it can be renewed while running). */
  secureContext: () => SecureContext;
  keyCert: () => { key: Buffer; cert: Buffer };
  /** Checks an app password; `why` is said to the mail app when it fails. */
  login: (username: string, password: string, ip: string) => Promise<{ ok: true; userId: string; passwordId: string } | { ok: false; why: string }>;
  /** The mailboxes this person may open in a mail app right now (empty: none, or the company switched it off). */
  mailboxes: (userId: string, username: string) => store.Mailbox[];
  /** Whether this sign-in still works (app password not removed, person not suspended). */
  stillOk: (userId: string, passwordId: string) => boolean;
  writer: store.Writer;
  log: (line: string) => void;
}
let deps: ImapDeps;

const MAX_LINE = 64 * 1024;
export const APPEND_LIMIT = 25 * 1024 * 1024;
const MAX_LITERAL = APPEND_LIMIT + 1024;
const IDLE_LOGOUT = 31 * 60_000; // RFC 3501: at least 30 minutes
const PREAUTH_LOGOUT = 60_000;
const MAX_PER_USER = 40;
const MAX_TOTAL = 3000;

/* ---------- names: modified UTF-7 (RFC 3501 5.1.3) ---------- */

export function utf7Encode(s: string): string {
  let out = '';
  let run = '';
  const flush = () => {
    if (!run) return;
    const b = Buffer.alloc(run.length * 2);
    for (let i = 0; i < run.length; i++) b.writeUInt16BE(run.charCodeAt(i), i * 2);
    out += '&' + b.toString('base64').replace(/=+$/, '').replace(/\//g, ',') + '-';
    run = '';
  };
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e && ch.length === 1) {
      flush();
      out += ch === '&' ? '&-' : ch;
    } else run += ch;
  }
  flush();
  return out;
}
export function utf7Decode(s: string): string {
  return s.replace(/&([^-]*)-/g, (_m, b64: string) => {
    if (!b64) return '&';
    const b = Buffer.from(b64.replace(/,/g, '/'), 'base64');
    let r = '';
    for (let i = 0; i + 1 < b.length; i += 2) r += String.fromCharCode(b.readUInt16BE(i));
    return r;
  });
}

/* ---------- reading commands ---------- */

type Tok = { atom: string } | { str: string } | { lit: Buffer } | { list: Tok[] };
const isAtom = (t: Tok | undefined): t is { atom: string } => !!t && 'atom' in t;
/** A string argument (atom, quoted or literal), as latin1 text. */
const strOf = (t: Tok | undefined): string | null => (!t ? null : 'atom' in t ? t.atom : 'str' in t ? t.str : 'lit' in t ? t.lit.toString('latin1') : null);
/** A string argument's bytes read as UTF-8 (search words). */
const utf8Of = (t: Tok | undefined): string | null => {
  const s = strOf(t);
  return s === null ? null : Buffer.from(s, 'latin1').toString('utf8');
};

class Bad extends Error {}

/** Splits a command into tokens. Literals sit in the text as \0n\0 (their index in `lits`). */
function tokenize(s: string, lits: Buffer[]): Tok[] {
  let i = 0;
  const readList = (close: string | null): Tok[] => {
    const out: Tok[] = [];
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') {
        i++;
        continue;
      }
      if (close && c === close) {
        i++;
        return out;
      }
      if (c === '(') {
        i++;
        out.push({ list: readList(')') });
        continue;
      }
      if (c === ')') throw new Bad('Unexpected )');
      if (c === '"') {
        i++;
        let v = '';
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && i + 1 < s.length) i++;
          v += s[i++];
        }
        if (s[i] !== '"') throw new Bad('Unterminated string');
        i++;
        out.push({ str: v });
        continue;
      }
      if (c === '\0') {
        const end = s.indexOf('\0', i + 1);
        out.push({ lit: lits[Number(s.slice(i + 1, end))] ?? Buffer.alloc(0) });
        i = end + 1;
        continue;
      }
      let a = '';
      while (i < s.length && !' ()"\0'.includes(s[i])) {
        if (s[i] === '[') {
          // A section (BODY[HEADER.FIELDS (DATE FROM)]) is part of its atom, spaces and brackets included.
          let depth = 0;
          do {
            if (s[i] === '[') depth++;
            else if (s[i] === ']') depth--;
            a += s[i++];
          } while (i < s.length && depth > 0);
          continue;
        }
        a += s[i++];
      }
      out.push({ atom: a });
    }
    if (close) throw new Bad('Missing )');
    return out;
  };
  return readList(null);
}

interface Command {
  tag: string;
  name: string;
  args: Tok[];
  text: string;
  cont?: { promise: Promise<string | null>; resolve: (line: string | null) => void };
}
const deferred = () => {
  let resolve!: (line: string | null) => void;
  const promise = new Promise<string | null>((r) => (resolve = r));
  return { promise, resolve };
};

/* ---------- sequence sets ---------- */

/** The positions (0-based, in order) a sequence set picks out of a list of `n` messages (or of UIDs). */
function pick(set: string, values: number[], byUid: boolean): number[] {
  if (!/^[\d*:,]+$/.test(set)) throw new Bad('Invalid sequence set');
  const max = byUid ? (values.length ? values[values.length - 1] : 0) : values.length;
  const out = new Set<number>();
  for (const part of set.split(',')) {
    const [a, b] = part.split(':');
    const num = (x: string) => {
      if (x === '*') return max;
      const n = Number(x);
      if (!Number.isInteger(n) || n < 1) throw new Bad('Invalid sequence set');
      return n;
    };
    let lo = num(a);
    let hi = b === undefined ? lo : num(b);
    if (lo > hi) [lo, hi] = [hi, lo];
    if (byUid) {
      // UIDs: binary search the first one at or above lo.
      let l = 0;
      let r = values.length;
      while (l < r) {
        const m = (l + r) >> 1;
        if (values[m] < lo) l = m + 1;
        else r = m;
      }
      for (let k = l; k < values.length && values[k] <= hi; k++) out.add(k);
    } else for (let k = lo; k <= Math.min(hi, values.length); k++) out.add(k - 1);
  }
  return [...out].sort((x, y) => x - y);
}
/** A list of numbers as a set (1:3,7), in the order given when `ordered`. */
function setOf(nums: number[], ordered = false) {
  if (ordered) return nums.join(',');
  const s = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}:${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return out.join(',');
}

/* ---------- dates ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const internalDate = (iso: string) => {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date(0) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `"${p(t.getUTCDate())}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())} +0000"`;
};
/** A search date (1-Feb-2026) as YYYY-MM-DD. */
function searchDay(s: string | null): string {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s ?? '').trim());
  const mon = m ? MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) : -1;
  if (!m || mon < 0) throw new Bad('Invalid date');
  return `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
/** An APPEND date ("09-Oct-2026 14:12:31 +0700"). */
function appendDate(s: string): Date | null {
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  if (mon < 0) return null;
  const utc = Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6]) - (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60_000;
  return new Date(utc);
}

/* ---------- a parsed message, kept for a little while (FETCH asks for parts of the same message many times) ---------- */

const parsedCache = new Map<string, { raw: Buffer; root: Part }>();
async function parsedOf(t: store.Thread, m: store.Msg, mb: store.Mailbox) {
  const key = `${t.id} ${m.id}`;
  const hit = parsedCache.get(key);
  if (hit) {
    parsedCache.delete(key);
    parsedCache.set(key, hit);
    return hit;
  }
  const raw = await store.source(t, m, mb);
  const v = { raw, root: parse(raw) };
  parsedCache.set(key, v);
  let total = 0;
  for (const x of parsedCache.values()) total += x.raw.length;
  for (const k of parsedCache.keys()) {
    if (parsedCache.size <= 4 || (parsedCache.size <= 200 && total < 64 * 1024 * 1024)) break;
    total -= parsedCache.get(k)!.raw.length;
    parsedCache.delete(k);
  }
  return v;
}

/* ---------- a connection ---------- */

interface Info {
  tid: string;
  mid: string;
  flags: string[];
  modseq: number;
}
interface Selected {
  folder: store.Folder;
  readOnly: boolean;
  uidvalidity: number;
  uids: number[];
  info: Map<number, Info>;
  modseq: number;
}

const sessions = new Set<Session>();
const ascii = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, '');

class Session {
  socket: Socket;
  secure: boolean;
  ip: string;
  buf: Buffer = Buffer.alloc(0);
  text = '';
  lits: Buffer[] = [];
  need: { n: number; skip: boolean } | null = null;
  tooBig = false;
  queue: Command[] = [];
  running = false;
  contFor: Command | null = null;
  halted = false;
  closed = false;
  userId: string | null = null;
  username = '';
  passwordId = '';
  sel: Selected | null = null;
  condstore = false;
  idling = false;
  dirty = false;
  pushTimer: NodeJS.Timeout | null = null;
  logoutTimer: NodeJS.Timeout | null = null;
  /** Threads read for the last command, reused for a moment (mail apps ask STATUS of every folder in a row). */
  shared: { ctx: store.Ctx; at: number } | null = null;
  ctx() {
    if (!this.shared || Date.now() - this.shared.at > 1500) this.shared = { ctx: new store.Ctx(), at: Date.now() };
    return this.shared.ctx;
  }
  constructor(socket: Socket, secure: boolean) {
    this.socket = socket;
    this.secure = secure;
    this.ip = String(socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    this.attach(socket);
    this.touch();
  }
  attach(sock: Socket) {
    sock.on('data', (d: Buffer) => this.onData(d));
    sock.on('error', () => this.close());
    sock.on('close', () => this.close());
  }
  touch() {
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    this.logoutTimer = setTimeout(() => void this.bye('Autologout; idle for too long'), this.userId ? IDLE_LOGOUT : PREAUTH_LOGOUT);
    this.logoutTimer.unref?.();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    sessions.delete(this);
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.contFor?.cont?.resolve(null);
    this.queue.forEach((c) => c.cont?.resolve(null));
    this.socket.destroy();
  }
  async bye(text: string) {
    if (this.closed) return;
    await this.write(`* BYE ${ascii(text)}\r\n`).catch(() => {});
    this.socket.end();
    setTimeout(() => this.close(), 2000).unref?.();
  }
  write(data: string | Buffer | Chunk[]): Promise<void> {
    if (this.closed) return Promise.resolve();
    const buf = typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.isBuffer(data) ? data : toBuffer(data);
    if (this.socket.write(buf)) return Promise.resolve();
    return new Promise((res) => {
      const done = () => (this.socket.off('drain', done), this.socket.off('close', done), res());
      this.socket.once('drain', done);
      this.socket.once('close', done);
    });
  }
  line(chunks: Chunk[] | string) {
    return this.write(typeof chunks === 'string' ? chunks + '\r\n' : [...chunks, '\r\n']);
  }

  /* ----- reading ----- */
  onData(d: Buffer) {
    if (this.halted || this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    this.touch();
    this.read();
  }
  read() {
    while (!this.halted && !this.closed) {
      if (this.need) {
        if (this.buf.length < this.need.n) return;
        const lit = this.buf.subarray(0, this.need.n);
        this.buf = this.buf.subarray(this.need.n);
        if (!this.need.skip) {
          this.text += `\0${this.lits.length}\0`;
          this.lits.push(Buffer.from(lit));
        }
        this.need = null;
        continue;
      }
      const nl = this.buf.indexOf('\r\n');
      if (nl < 0) {
        if (this.buf.length > MAX_LINE) {
          void this.line('* BAD Line too long').then(() => this.close());
          this.halted = true;
        }
        return;
      }
      const lineText = this.buf.toString('latin1', 0, nl);
      this.buf = this.buf.subarray(nl + 2);
      // A continuation someone is waiting for (AUTHENTICATE's answer, IDLE's DONE).
      if (this.contFor && !this.text) {
        const c = this.contFor;
        this.contFor = null;
        c.cont!.resolve(lineText);
        continue;
      }
      const lit = /\{(\d+)(\+?)\}$/.exec(lineText);
      if (lit) {
        const n = Number(lit[1]);
        const sync = !lit[2];
        this.text += lineText.slice(0, lit.index);
        if (n > MAX_LITERAL || this.text.length > MAX_LINE) {
          this.tooBig = true;
          if (sync) {
            // The mail app waits for our go-ahead, so it never sends it: answer now and forget the command.
            const tag = this.text.split(' ')[0] || '*';
            this.text = '';
            this.lits = [];
            this.tooBig = false;
            void this.line(`${tag} NO [TOOBIG] That's too big`);
            continue;
          }
          this.need = { n, skip: true };
          continue;
        }
        if (sync) void this.write('+ Ready for literal data\r\n');
        this.need = { n, skip: false };
        continue;
      }
      this.text += lineText;
      const text = this.text;
      const lits = this.lits;
      this.text = '';
      this.lits = [];
      if (this.tooBig) {
        this.tooBig = false;
        void this.line(`${text.split(' ')[0] || '*'} NO [TOOBIG] That's too big`);
        continue;
      }
      this.enqueue(text, lits);
    }
  }
  enqueue(text: string, lits: Buffer[]) {
    let toks: Tok[];
    try {
      toks = tokenize(text, lits);
    } catch (e) {
      const tag = text.split(' ')[0] || '*';
      void this.line(`${/^[\x21-\x7e]+$/.test(tag) ? tag : '*'} BAD ${e instanceof Bad ? e.message : 'Could not read that command'}`);
      return;
    }
    const tag = strOf(toks[0]) ?? '';
    const name = (strOf(toks[1]) ?? '').toUpperCase();
    if (!tag || !name || !isAtom(toks[0])) {
      void this.line(`* BAD Expected a tag and a command`);
      return;
    }
    const cmd: Command = { tag, name, args: toks.slice(2), text };
    // Commands that read another line from the mail app get it before anything queued after them.
    const plainAuth = name === 'AUTHENTICATE' && toks.length < 4 && this.secure && !this.userId && (strOf(toks[2]) ?? '').toUpperCase() === 'PLAIN';
    if ((name === 'IDLE' && this.userId) || plainAuth) {
      cmd.cont = deferred();
      this.contFor = cmd;
    }
    if (name === 'STARTTLS') {
      // Nothing sent after STARTTLS (before the handshake) is read: it could have been put there by someone in between.
      this.halted = true;
      this.buf = Buffer.alloc(0);
    }
    this.queue.push(cmd);
    void this.pump();
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.closed) {
        const cmd = this.queue.shift()!;
        try {
          await this.run(cmd);
        } catch (e) {
          if (e instanceof Bad) await this.line(`${cmd.tag} BAD ${ascii(e.message)}`);
          else {
            deps.log(`[imap] ${cmd.name} failed: ${e instanceof Error ? e.stack ?? e.message : e}`);
            await this.line(`${cmd.tag} NO [SERVERBUG] Something went wrong on our side`);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  /* ----- what we can do ----- */
  caps(): string {
    const base = ['IMAP4rev1', 'LITERAL+', 'ID', 'ENABLE', 'IDLE', 'NAMESPACE', 'UIDPLUS', 'MOVE', 'SPECIAL-USE', 'CHILDREN', 'UNSELECT', 'CONDSTORE', `APPENDLIMIT=${APPEND_LIMIT}`];
    if (!this.secure) return [...base, 'STARTTLS', 'LOGINDISABLED'].join(' ');
    return this.userId ? base.join(' ') : [...base, 'SASL-IR', 'AUTH=PLAIN'].join(' ');
  }

  mailboxes() {
    return this.userId ? deps.mailboxes(this.userId, this.username) : [];
  }
  folders() {
    return store.foldersOf(this.mailboxes());
  }
  folderNamed(name: string): store.Folder | null {
    const n = utf7Decode(name);
    const all = this.folders();
    return all.find((f) => f.name === n) ?? (n.toUpperCase() === 'INBOX' ? all.find((f) => f.name === 'INBOX') ?? null : null);
  }

  /* ----- keeping a selected folder up to date ----- */
  mark() {
    this.dirty = true;
    this.shared = null;
    if (this.idling && !this.pushTimer) {
      this.pushTimer = setTimeout(() => {
        this.pushTimer = null;
        void this.refresh(true).catch((e) => deps.log(`[imap] push failed: ${e instanceof Error ? e.message : e}`));
      }, 40);
    }
  }
  /**
   * Tells the mail app what changed in the selected folder: new messages (EXISTS), changed flags (FETCH) and, when
   * allowed, removed ones (EXPUNGE). `uidIn`: say UIDs in FETCH lines. Returns the folder's state.
   */
  async refresh(allowExpunge: boolean, force = false, ctx = new store.Ctx(), quiet?: Set<number>) {
    const sel = this.sel;
    if (!sel || (!this.dirty && !force)) return null;
    this.dirty = false;
    const state = store.sync(sel.folder, ctx);
    if (state.uidvalidity !== sel.uidvalidity) {
      await this.bye('The folder was reset; please open it again');
      return null;
    }
    const now = new Map(state.entries.map((e) => [e.uid, e]));
    const out: Chunk[][] = [];
    if (allowExpunge) {
      for (let i = sel.uids.length - 1; i >= 0; i--) {
        if (now.has(sel.uids[i])) continue;
        out.push([`* ${i + 1} EXPUNGE`]);
        sel.info.delete(sel.uids[i]);
        sel.uids.splice(i, 1);
      }
    }
    const max = sel.uids.length ? sel.uids[sel.uids.length - 1] : 0;
    const before = sel.uids.length;
    for (const e of state.entries) if (e.uid > max) (sel.uids.push(e.uid), sel.info.set(e.uid, { tid: e.tid, mid: e.mid, flags: e.flags, modseq: e.modseq }));
    if (sel.uids.length !== before || out.length) out.push([`* ${sel.uids.length} EXISTS`]);
    sel.uids.forEach((uid, i) => {
      const e = now.get(uid);
      const known = sel.info.get(uid);
      if (!e || !known || uid > max) return;
      if (e.flags.join(' ') === known.flags.join(' ') && !quiet?.has(uid)) return;
      known.flags = e.flags;
      known.modseq = e.modseq;
      if (quiet?.has(uid)) return;
      out.push([`* ${i + 1} FETCH (UID ${uid} FLAGS (${e.flags.join(' ')})${this.condstore ? ` MODSEQ (${e.modseq})` : ''})`]);
    });
    sel.modseq = state.modseq;
    for (const l of out) await this.line(l);
    return state;
  }

  /* ----- commands ----- */
  async run(cmd: Command) {
    const { tag, name } = cmd;
    const ok = (text: string) => this.line(`${tag} OK ${ascii(text)}`);
    const no = (text: string) => this.line(`${tag} NO ${ascii(text)}`);
    if (this.userId && !deps.stillOk(this.userId, this.passwordId)) return this.bye('This app password was removed or no longer works');
    // Anything state-dependent is checked first.
    const any = ['CAPABILITY', 'NOOP', 'LOGOUT', 'ID', 'ENABLE'];
    const preauth = ['STARTTLS', 'LOGIN', 'AUTHENTICATE'];
    const authed = ['SELECT', 'EXAMINE', 'CREATE', 'DELETE', 'RENAME', 'SUBSCRIBE', 'UNSUBSCRIBE', 'LIST', 'LSUB', 'STATUS', 'APPEND', 'NAMESPACE', 'IDLE', 'XLIST'];
    const selected = ['CHECK', 'CLOSE', 'UNSELECT', 'EXPUNGE', 'SEARCH', 'FETCH', 'STORE', 'COPY', 'MOVE', 'UID'];
    if (preauth.includes(name) && this.userId) return this.line(`${tag} BAD Already signed in`);
    if ((authed.includes(name) || selected.includes(name)) && !this.userId) return this.line(`${tag} BAD Sign in first`);
    if (selected.includes(name) && !this.sel) return this.line(`${tag} BAD Select a folder first`);
    if (![...any, ...preauth, ...authed, ...selected].includes(name)) return this.line(`${tag} BAD Unknown command`);
    // An open folder that isn't theirs any more (removed from a shared inbox, mail apps switched off).
    if (this.sel && !this.folders().some((f) => f.box === this.sel!.folder.box)) return this.bye('You no longer have this mailbox in sprint2go');

    switch (name) {
      case 'CAPABILITY':
        await this.line(`* CAPABILITY ${this.caps()}`);
        return ok('CAPABILITY completed');
      case 'NOOP':
      case 'CHECK':
        await this.refresh(true);
        return ok(`${name} completed`);
      case 'LOGOUT':
        await this.line('* BYE sprint2go signing off');
        await ok('LOGOUT completed');
        this.socket.end();
        setTimeout(() => this.close(), 1000).unref?.();
        return;
      case 'ID':
        await this.line('* ID ("name" "sprint2go" "vendor" "sprint2go")');
        return ok('ID completed');
      case 'ENABLE': {
        const want = cmd.args.map((a) => (strOf(a) ?? '').toUpperCase());
        const on = want.filter((w) => w === 'CONDSTORE');
        if (!this.userId) return this.line(`${tag} BAD Sign in first`);
        if (on.length) this.condstore = true;
        await this.line(`* ENABLED${on.length ? ' CONDSTORE' : ''}`);
        return ok('ENABLE completed');
      }
      case 'STARTTLS':
        return this.starttls(cmd);
      case 'LOGIN': {
        if (!this.secure) return this.line(`${tag} NO [PRIVACYREQUIRED] Use an encrypted connection (STARTTLS) first`);
        const user = strOf(cmd.args[0]);
        const pass = strOf(cmd.args[1]);
        if (user === null || pass === null) throw new Bad('LOGIN needs a username and a password');
        return this.signIn(tag, Buffer.from(user, 'latin1').toString('utf8'), Buffer.from(pass, 'latin1').toString('utf8'));
      }
      case 'AUTHENTICATE': {
        const mech = (strOf(cmd.args[0]) ?? '').toUpperCase();
        if (!this.secure) return this.line(`${tag} NO [PRIVACYREQUIRED] Use an encrypted connection (STARTTLS) first`);
        if (mech !== 'PLAIN') return no('Only PLAIN is supported');
        let resp = strOf(cmd.args[1]);
        if (resp === null) {
          await this.write('+ \r\n');
          resp = await cmd.cont!.promise;
          if (resp === null) return;
        }
        if (resp.trim() === '*') return this.line(`${tag} BAD Cancelled`);
        const parts = Buffer.from(resp.trim() === '=' ? '' : resp.trim(), 'base64').toString('utf8').split('\0');
        if (parts.length !== 3) return this.line(`${tag} BAD That isn't a PLAIN answer`);
        return this.signIn(tag, parts[1], parts[2]);
      }
      case 'NAMESPACE':
        await this.line('* NAMESPACE (("" "/")) NIL NIL');
        return ok('NAMESPACE completed');
      case 'LIST':
      case 'LSUB':
      case 'XLIST':
        return this.list(cmd);
      case 'SUBSCRIBE':
      case 'UNSUBSCRIBE':
        return ok(`${name} completed`);
      case 'CREATE': {
        const n = strOf(cmd.args[0]) ?? '';
        if (this.folderNamed(n.replace(/\/$/, ''))) return this.line(`${tag} NO [ALREADYEXISTS] That folder is already there`);
        return this.line(`${tag} NO [CANNOT] Folders come from sprint2go: its places and its labels`);
      }
      case 'DELETE':
      case 'RENAME':
        return this.line(`${tag} NO [CANNOT] Folders come from sprint2go and can't be ${name === 'DELETE' ? 'deleted' : 'renamed'} here`);
      case 'STATUS':
        return this.status(cmd);
      case 'SELECT':
      case 'EXAMINE':
        return this.select(cmd, name === 'EXAMINE');
      case 'APPEND':
        return this.append(cmd);
      case 'IDLE':
        return this.idle(cmd);
      case 'CLOSE':
      case 'UNSELECT': {
        const sel = this.sel!;
        if (name === 'CLOSE' && !sel.readOnly) store.expunge(deps.writer, this.userId!, sel.folder, new store.Ctx());
        this.sel = null;
        return ok(`${name} completed`);
      }
      case 'EXPUNGE':
        return this.expunge(cmd, null);
      case 'SEARCH':
        return this.search(cmd, cmd.args, false);
      case 'FETCH':
        return this.fetch(cmd, cmd.args, false);
      case 'STORE':
        return this.storeCmd(cmd, cmd.args, false);
      case 'COPY':
      case 'MOVE':
        return this.copy(cmd, cmd.args, false, name === 'MOVE');
      case 'UID': {
        const sub = (strOf(cmd.args[0]) ?? '').toUpperCase();
        const rest = cmd.args.slice(1);
        if (sub === 'FETCH') return this.fetch(cmd, rest, true);
        if (sub === 'SEARCH') return this.search(cmd, rest, true);
        if (sub === 'STORE') return this.storeCmd(cmd, rest, true);
        if (sub === 'COPY' || sub === 'MOVE') return this.copy(cmd, rest, true, sub === 'MOVE');
        if (sub === 'EXPUNGE') return this.expunge(cmd, strOf(rest[0]));
        throw new Bad('Unknown UID command');
      }
    }
  }

  async starttls(cmd: Command) {
    if (this.secure) {
      this.halted = false;
      return this.line(`${cmd.tag} BAD Already encrypted`);
    }
    await this.line(`${cmd.tag} OK Begin TLS negotiation now`);
    const raw = this.socket;
    raw.removeAllListeners('data');
    raw.removeAllListeners('error');
    raw.removeAllListeners('close');
    const tls = new TLSSocket(raw, { isServer: true, secureContext: deps.secureContext() });
    this.socket = tls;
    this.secure = true;
    this.buf = Buffer.alloc(0);
    this.text = '';
    this.lits = [];
    this.halted = false;
    this.attach(tls);
  }

  async signIn(tag: string, username: string, password: string) {
    const r = await deps.login(username.trim(), password, this.ip);
    if (!r.ok) {
      // A short wait after a wrong password slows down guessing.
      await new Promise((res) => setTimeout(res, 800));
      return this.line(`${tag} NO [AUTHENTICATIONFAILED] ${ascii(r.why)}`);
    }
    const mine = deps.mailboxes(r.userId, username.trim());
    if (!mine.length) return this.line(`${tag} NO [AUTHORIZATIONFAILED] There's no mailbox here you can open in a mail app. Your company may have switched other mail apps off.`);
    const count = [...sessions].filter((s) => s.userId === r.userId).length;
    if (count >= MAX_PER_USER) return this.line(`${tag} NO [LIMIT] Too many connections at once; close some mail apps and try again`);
    this.userId = r.userId;
    this.username = username.trim();
    this.passwordId = r.passwordId;
    this.touch();
    return this.line(`${tag} OK [CAPABILITY ${this.caps()}] Signed in`);
  }

  async list(cmd: Command) {
    let args = cmd.args;
    let specialOnly = false;
    // LIST (SPECIAL-USE) "" "*" and LIST "" "*" RETURN (...): the extended forms mail apps send.
    if (args[0] && 'list' in args[0]) {
      specialOnly = args[0].list.some((t) => (strOf(t) ?? '').toUpperCase() === 'SPECIAL-USE');
      args = args.slice(1);
    }
    const ret = args.findIndex((t) => isAtom(t) && t.atom.toUpperCase() === 'RETURN');
    if (ret >= 0) args = args.slice(0, ret);
    const ref = utf7Decode(strOf(args[0]) ?? '');
    const patterns = args[1] && 'list' in args[1] ? args[1].list.map((t) => strOf(t) ?? '') : [strOf(args[1]) ?? ''];
    const word = cmd.name === 'LSUB' ? 'LSUB' : cmd.name === 'XLIST' ? 'XLIST' : 'LIST';
    if (patterns.length === 1 && patterns[0] === '') {
      await this.line(`* ${word} (\\Noselect) "/" ""`);
      return this.line(`${cmd.tag} OK ${word} completed`);
    }
    const folders = this.folders();
    const parents = [...new Set(folders.filter((f) => !f.mailbox.primary).map((f) => f.mailbox.email))];
    const rows: { name: string; attrs: string[] }[] = [
      ...folders.map((f) => ({ name: f.name, attrs: ['\\HasNoChildren', ...(f.special ? [f.special] : []), ...(cmd.name === 'XLIST' && f.name === 'INBOX' ? ['\\Inbox'] : [])] })),
      ...parents.map((p) => ({ name: p, attrs: ['\\Noselect', '\\HasChildren'] })),
    ];
    const res = patterns.map((pt) => {
      const full = utf7Decode(pt).startsWith('/') ? utf7Decode(pt) : ref + utf7Decode(pt);
      const rx = new RegExp('^' + full.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '[^/]*') + '$', /^inbox$/i.test(full) ? 'i' : '');
      return rx;
    });
    for (const r of rows) {
      if (!res.some((rx) => rx.test(r.name))) continue;
      if (specialOnly && !r.attrs.some((a) => ['\\Sent', '\\Drafts', '\\Archive', '\\Trash', '\\Junk'].includes(a))) continue;
      await this.line([`* ${word} (${r.attrs.join(' ')}) "/" `, nstring(utf7Encode(r.name))]);
    }
    return this.line(`${cmd.tag} OK ${word} completed`);
  }

  async status(cmd: Command) {
    const f = this.folderNamed(strOf(cmd.args[0]) ?? '');
    if (!f) return this.line(`${cmd.tag} NO [NONEXISTENT] No such folder`);
    const items = cmd.args[1] && 'list' in cmd.args[1] ? cmd.args[1].list.map((t) => (strOf(t) ?? '').toUpperCase()) : [];
    const st = store.sync(f, this.ctx());
    const out: string[] = [];
    for (const it of items) {
      if (it === 'MESSAGES') out.push(`MESSAGES ${st.entries.length}`);
      else if (it === 'RECENT') out.push('RECENT 0');
      else if (it === 'UIDNEXT') out.push(`UIDNEXT ${st.uidnext}`);
      else if (it === 'UIDVALIDITY') out.push(`UIDVALIDITY ${st.uidvalidity}`);
      else if (it === 'UNSEEN') out.push(`UNSEEN ${st.entries.filter((e) => !e.flags.includes('\\Seen')).length}`);
      else if (it === 'HIGHESTMODSEQ') out.push(`HIGHESTMODSEQ ${st.modseq}`);
      else if (it === 'SIZE' || it === 'APPENDLIMIT') continue;
      else throw new Bad(`Unknown status item ${it}`);
    }
    await this.line(['* STATUS ', nstring(utf7Encode(f.name)), ` (${out.join(' ')})`]);
    if (this.sel?.folder.box === f.box) this.dirty = true;
    return this.line(`${cmd.tag} OK STATUS completed`);
  }

  async select(cmd: Command, readOnly: boolean) {
    this.sel = null;
    const f = this.folderNamed(strOf(cmd.args[0]) ?? '');
    if (!f) return this.line(`${cmd.tag} NO [NONEXISTENT] No such folder`);
    const opts = cmd.args[1] && 'list' in cmd.args[1] ? cmd.args[1].list.map((t) => (strOf(t) ?? '').toUpperCase()) : [];
    if (opts.includes('CONDSTORE')) this.condstore = true;
    const st = store.sync(f, new store.Ctx());
    this.sel = { folder: f, readOnly, uidvalidity: st.uidvalidity, uids: st.entries.map((e) => e.uid), info: new Map(st.entries.map((e) => [e.uid, { tid: e.tid, mid: e.mid, flags: e.flags, modseq: e.modseq }])), modseq: st.modseq };
    this.dirty = false;
    const firstUnseen = st.entries.findIndex((e) => !e.flags.includes('\\Seen'));
    await this.line('* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)');
    await this.line(`* OK [PERMANENTFLAGS (${readOnly ? '' : '\\Answered \\Flagged \\Deleted \\Seen \\*'})] Flags you can change`);
    await this.line(`* ${st.entries.length} EXISTS`);
    await this.line('* 0 RECENT');
    if (firstUnseen >= 0) await this.line(`* OK [UNSEEN ${firstUnseen + 1}] First unseen`);
    await this.line(`* OK [UIDVALIDITY ${st.uidvalidity}] UIDs valid`);
    await this.line(`* OK [UIDNEXT ${st.uidnext}] Predicted next UID`);
    if (this.condstore) await this.line(`* OK [HIGHESTMODSEQ ${st.modseq}] Highest`);
    return this.line(`${cmd.tag} OK [${readOnly ? 'READ-ONLY' : 'READ-WRITE'}] ${readOnly ? 'EXAMINE' : 'SELECT'} completed`);
  }

  async append(cmd: Command) {
    const f = this.folderNamed(strOf(cmd.args[0]) ?? '');
    let i = 1;
    let flags: string[] = [];
    let date: Date | null = null;
    if (cmd.args[i] && 'list' in cmd.args[i]) flags = (cmd.args[i++] as { list: Tok[] }).list.map((t) => strOf(t) ?? '');
    if (cmd.args[i] && 'str' in cmd.args[i]) date = appendDate((cmd.args[i++] as { str: string }).str);
    const data = cmd.args[i];
    if (!data || !('lit' in data)) throw new Bad('APPEND needs the message as a literal');
    if (!f) return this.line(`${cmd.tag} NO [TRYCREATE] No such folder`);
    if (data.lit.length > APPEND_LIMIT) return this.line(`${cmd.tag} NO [TOOBIG] Messages can be up to 25 MB`);
    const ctx = new store.Ctx();
    const r = await store.append(deps.writer, this.userId!, f, ctx, data.lit, flags, date);
    if (!r.ok) return this.line(`${cmd.tag} NO [CANNOT] ${ascii(r.why ?? 'It could not be saved')}`);
    const st = store.sync(f, new store.Ctx());
    const e = r.tid ? store.entryFor(st, r.tid, r.mid!) : null;
    if (this.sel?.folder.box === f.box) {
      this.dirty = true;
      await this.refresh(true);
    }
    return this.line(`${cmd.tag} OK ${e ? `[APPENDUID ${st.uidvalidity} ${e.uid}] ` : ''}APPEND completed`);
  }

  async idle(cmd: Command) {
    await this.write('+ idling\r\n');
    this.idling = true;
    await this.refresh(true);
    const line = await cmd.cont!.promise;
    this.idling = false;
    if (this.pushTimer) (clearTimeout(this.pushTimer), (this.pushTimer = null));
    if (line === null) return;
    if (line.trim().toUpperCase() !== 'DONE') return this.line(`${cmd.tag} BAD Expected DONE`);
    await this.refresh(true);
    return this.line(`${cmd.tag} OK IDLE terminated`);
  }

  async expunge(cmd: Command, uidSet: string | null) {
    const sel = this.sel!;
    if (sel.readOnly) return this.line(`${cmd.tag} NO [READ-ONLY] Opened read-only`);
    const uids = uidSet !== null ? new Set(pick(uidSet, sel.uids, true).map((k) => sel.uids[k])) : undefined;
    const r = store.expunge(deps.writer, this.userId!, sel.folder, new store.Ctx(), uids);
    await this.refresh(true, true);
    return r.ok ? this.line(`${cmd.tag} OK EXPUNGE completed`) : this.line(`${cmd.tag} NO [CANNOT] ${ascii(r.why ?? 'Not everything could be removed')}`);
  }

  /** The messages a set picks: their sequence number, UID and what they are. */
  picked(set: string, byUid: boolean) {
    const sel = this.sel!;
    return pick(set, sel.uids, byUid).map((k) => ({ seq: k + 1, uid: sel.uids[k], ...sel.info.get(sel.uids[k])! }));
  }

  async storeCmd(cmd: Command, args: Tok[], byUid: boolean) {
    const sel = this.sel!;
    if (sel.readOnly) return this.line(`${cmd.tag} NO [READ-ONLY] Opened read-only`);
    const set = strOf(args[0]);
    let i = 1;
    let unchangedSince: number | null = null;
    if (args[i] && 'list' in args[i]) {
      const mods = (args[i++] as { list: Tok[] }).list;
      if ((strOf(mods[0]) ?? '').toUpperCase() === 'UNCHANGEDSINCE') unchangedSince = Number(strOf(mods[1]));
      if (unchangedSince !== null && !Number.isFinite(unchangedSince)) throw new Bad('Invalid UNCHANGEDSINCE');
      if (unchangedSince !== null) this.condstore = true;
    }
    const what = (strOf(args[i++]) ?? '').toUpperCase();
    const m = /^([+-]?)FLAGS(\.SILENT)?$/.exec(what);
    if (!set || !m) throw new Bad('STORE needs a set, FLAGS and a list of flags');
    const flagTok = args[i];
    const flags = flagTok && 'list' in flagTok ? flagTok.list.map((t) => strOf(t) ?? '') : args.slice(i).map((t) => strOf(t) ?? '');
    const items = this.picked(set, byUid);
    // CONDSTORE: messages changed since the mail app last looked are left alone and named.
    const ctx = new store.Ctx();
    await this.refresh(false, false, ctx);
    const modified = unchangedSince !== null ? items.filter((it) => (sel.info.get(it.uid)?.modseq ?? 0) > unchangedSince!) : [];
    const todo = items.filter((it) => !modified.includes(it));
    const r = store.store(deps.writer, this.userId!, sel.folder, ctx, todo, (m[1] || '=') as '+' | '-' | '=', flags);
    // The flags as they are now, for the messages stored (unless .SILENT) and anything else that changed.
    const silent = !!m[2] && !this.condstore;
    const quiet = new Set(todo.map((t) => t.uid));
    await this.refresh(false, true, new store.Ctx(), quiet);
    if (!silent || unchangedSince !== null)
      for (const it of todo) {
        const seq = sel.uids.indexOf(it.uid) + 1;
        const info = sel.info.get(it.uid);
        if (!seq || !info) continue;
        await this.line(`* ${seq} FETCH (${byUid ? `UID ${it.uid} ` : ''}FLAGS (${info.flags.join(' ')})${this.condstore ? ` MODSEQ (${info.modseq})` : ''})`);
      }
    if (!r.ok) return this.line(`${cmd.tag} NO [CANNOT] ${ascii(r.why ?? 'It could not be changed')}`);
    if (modified.length) return this.line(`${cmd.tag} OK [MODIFIED ${setOf(modified.map((x) => (byUid ? x.uid : x.seq)))}] Conditional STORE failed for some`);
    return this.line(`${cmd.tag} OK STORE completed`);
  }

  async copy(cmd: Command, args: Tok[], byUid: boolean, move: boolean) {
    const sel = this.sel!;
    const set = strOf(args[0]);
    const target = this.folderNamed(strOf(args[1]) ?? '');
    if (!set || args[1] === undefined) throw new Bad(`${move ? 'MOVE' : 'COPY'} needs a set and a folder`);
    if (!target) return this.line(`${cmd.tag} NO [TRYCREATE] No such folder`);
    if (move && sel.readOnly) return this.line(`${cmd.tag} NO [READ-ONLY] Opened read-only`);
    if (target.mailbox.id !== sel.folder.mailbox.id) return this.line(`${cmd.tag} NO [CANNOT] Mail stays in its own mailbox in sprint2go; it can't move to another one`);
    const items = this.picked(set, byUid);
    if (!items.length) return this.line(`${cmd.tag} OK ${move ? 'MOVE' : 'COPY'} completed (nothing to do)`);
    const r = store.copyMove(deps.writer, this.userId!, sel.folder, target, new store.Ctx(), items, move);
    if (!r.ok) return this.line(`${cmd.tag} NO [CANNOT] ${ascii(r.why ?? 'It could not be moved')}`);
    const st = target.box === sel.folder.box ? null : store.sync(target, new store.Ctx());
    const pairs = items.map((it) => [it.uid, (st ? store.entryFor(st, it.tid, it.mid)?.uid : it.uid) ?? 0] as const).filter(([, d]) => d > 0);
    const copyuid = st && pairs.length ? `[COPYUID ${st.uidvalidity} ${setOf(pairs.map((p) => p[0]), true)} ${setOf(pairs.map((p) => p[1]), true)}] ` : '';
    if (move) {
      if (copyuid) await this.line(`* OK ${copyuid}Moved`);
      await this.refresh(true, true);
      return this.line(`${cmd.tag} OK MOVE completed`);
    }
    if (this.sel) this.dirty = true;
    await this.refresh(false);
    return this.line(`${cmd.tag} OK ${copyuid}COPY completed`);
  }

  async fetch(cmd: Command, args: Tok[], byUid: boolean) {
    const sel = this.sel!;
    const set = strOf(args[0]);
    if (!set || !args[1]) throw new Bad('FETCH needs a set and what to fetch');
    let want: string[] = 'list' in args[1] ? args[1].list.map((t) => strOf(t) ?? '') : [strOf(args[1]) ?? ''];
    let changedSince: number | null = null;
    if (args[2] && 'list' in args[2]) {
      const mods = args[2].list;
      if ((strOf(mods[0]) ?? '').toUpperCase() === 'CHANGEDSINCE') changedSince = Number(strOf(mods[1]));
      if (changedSince !== null && !Number.isFinite(changedSince)) throw new Bad('Invalid CHANGEDSINCE');
      if (changedSince !== null) this.condstore = true;
    }
    const macros: Record<string, string[]> = { ALL: ['FLAGS', 'INTERNALDATE', 'RFC822.SIZE', 'ENVELOPE'], FAST: ['FLAGS', 'INTERNALDATE', 'RFC822.SIZE'], FULL: ['FLAGS', 'INTERNALDATE', 'RFC822.SIZE', 'ENVELOPE', 'BODY'] };
    want = want.flatMap((w) => macros[w.toUpperCase()] ?? [w]);
    type Item = { kind: string; section?: Section; label?: string; partial?: [number, number] | null; peek?: boolean };
    const items: Item[] = want.map((w) => {
      const u = w.toUpperCase();
      const b = /^(BODY(?:\.PEEK)?)\[([^\]]*)\](?:<(\d+)\.(\d+)>)?$/i.exec(w);
      if (b) {
        const section = parseSection(b[2]);
        if (!section) throw new Bad(`Invalid section ${b[2]}`);
        return { kind: 'BODY[]', section, peek: b[1].toUpperCase() === 'BODY.PEEK', label: `BODY[${b[2].toUpperCase()}]`, partial: b[3] !== undefined ? [Number(b[3]), Number(b[4])] : null };
      }
      if (['UID', 'FLAGS', 'INTERNALDATE', 'RFC822.SIZE', 'ENVELOPE', 'BODYSTRUCTURE', 'BODY', 'RFC822', 'RFC822.HEADER', 'RFC822.TEXT', 'MODSEQ'].includes(u)) return { kind: u };
      throw new Bad(`Can't fetch ${w}`);
    });
    if (items.some((x) => x.kind === 'MODSEQ')) this.condstore = true;
    const ctx = new store.Ctx();
    await this.refresh(false, false, ctx);
    let picked = this.picked(set, byUid);
    if (changedSince !== null) picked = picked.filter((p) => (sel.info.get(p.uid)?.modseq ?? 0) > changedSince!);
    // Reading a message (BODY[], RFC822, RFC822.TEXT) marks it read, as in any mail app.
    const marks = !sel.readOnly && items.some((x) => (x.kind === 'BODY[]' && !x.peek) || x.kind === 'RFC822' || x.kind === 'RFC822.TEXT');
    const unseen = marks ? picked.filter((p) => !(sel.info.get(p.uid)?.flags ?? []).includes('\\Seen')) : [];
    if (unseen.length) {
      store.store(deps.writer, this.userId!, sel.folder, ctx, unseen, '+', ['\\Seen']);
      await this.refresh(false, true, new store.Ctx(), new Set(unseen.map((u) => u.uid)));
    }
    const seenNow = new Set(unseen.map((u) => u.uid));
    const readCtx = new store.Ctx();
    for (const p of picked) {
      const info = sel.info.get(p.uid);
      if (!info) continue;
      const hit = store.lookup(readCtx, sel.folder.mailbox, info.tid, info.mid);
      const out: Chunk[][] = [];
      if (byUid || items.some((x) => x.kind === 'UID')) out.push([`UID ${p.uid}`]);
      if (items.some((x) => x.kind === 'FLAGS') || seenNow.has(p.uid)) out.push([`FLAGS (${info.flags.join(' ')})`]);
      if (this.condstore && (changedSince !== null || items.some((x) => x.kind === 'MODSEQ'))) out.push([`MODSEQ (${info.modseq})`]);
      if (!hit) {
        if (out.length) await this.line([`* ${this.sel!.uids.indexOf(p.uid) + 1} FETCH `, ...list(out)]);
        continue;
      }
      const needSource = items.some((x) => ['ENVELOPE', 'BODYSTRUCTURE', 'BODY', 'BODY[]', 'RFC822', 'RFC822.HEADER', 'RFC822.TEXT'].includes(x.kind));
      const src = needSource ? await parsedOf(hit.t, hit.m, sel.folder.mailbox) : null;
      for (const it of items) {
        switch (it.kind) {
          case 'INTERNALDATE':
            out.push([`INTERNALDATE ${internalDate(hit.m.date)}`]);
            break;
          case 'RFC822.SIZE':
            out.push([`RFC822.SIZE ${src ? src.raw.length : await store.sizeOf(readCtx, hit.t, hit.m, sel.folder.mailbox)}`]);
            break;
          case 'ENVELOPE':
            out.push(['ENVELOPE ', ...envelope(src!.root)]);
            break;
          case 'BODYSTRUCTURE':
          case 'BODY':
            out.push([`${it.kind} `, ...bodystructure(src!.raw, src!.root, it.kind === 'BODYSTRUCTURE')]);
            break;
          case 'RFC822':
            out.push(['RFC822 ', { literal: src!.raw }]);
            break;
          case 'RFC822.HEADER':
            out.push(['RFC822.HEADER ', { literal: sectionBytes(src!.raw, src!.root, { path: [], text: 'HEADER', fields: [] }) }]);
            break;
          case 'RFC822.TEXT':
            out.push(['RFC822.TEXT ', { literal: sectionBytes(src!.raw, src!.root, { path: [], text: 'TEXT', fields: [] }) }]);
            break;
          case 'BODY[]': {
            let bytes = sectionBytes(src!.raw, src!.root, it.section!);
            let label = it.label!;
            if (it.partial) {
              const [start, len] = it.partial;
              bytes = start >= bytes.length ? Buffer.alloc(0) : bytes.subarray(start, start + len);
              label += `<${start}>`;
            }
            out.push([`${label} `, { literal: bytes }]);
            break;
          }
        }
      }
      const seq = this.sel!.uids.indexOf(p.uid) + 1;
      if (seq) await this.line([`* ${seq} FETCH `, ...list(out)]);
    }
    return this.line(`${cmd.tag} OK FETCH completed`);
  }

  async search(cmd: Command, args: Tok[], byUid: boolean) {
    const sel = this.sel!;
    let rest = args;
    if (isAtom(rest[0]) && rest[0].atom.toUpperCase() === 'CHARSET') {
      const cs = (strOf(rest[1]) ?? '').toUpperCase();
      if (!['UTF-8', 'US-ASCII', 'UTF8'].includes(cs)) return this.line(`${cmd.tag} NO [BADCHARSET (UTF-8 US-ASCII)] Use UTF-8`);
      rest = rest.slice(2);
    }
    const ctx = new store.Ctx();
    await this.refresh(false, false, ctx);
    const mb = sel.folder.mailbox;
    let usedModseq = false;
    interface Cand {
      seq: number;
      uid: number;
      info: Info;
    }
    type Pred = (c: Cand) => boolean | Promise<boolean>;
    const hitOf = (c: Cand) => store.lookup(ctx, mb, c.info.tid, c.info.mid);
    const contains = (hay: string, needle: string | null) => needle !== null && hay.toLowerCase().includes(needle.toLowerCase());
    const people = (ps: store.P[] | undefined) => (ps ?? []).map((p) => `${p.name} <${p.email}>`).join(', ');
    const day = (iso: string) => (iso || '').slice(0, 10);
    const plain = (html?: string) => (html ?? '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    const allOf = (preds: Pred[]): Pred => async (c) => {
      for (const p of preds) if (!(await p(c))) return false;
      return true;
    };
    type Cursor = { list: Tok[]; pos: number };
    const group = (list: Tok[]): Pred => {
      const cur: Cursor = { list, pos: 0 };
      const preds: Pred[] = [];
      while (cur.pos < list.length) preds.push(key(cur));
      if (!preds.length) throw new Bad('Empty search group');
      return allOf(preds);
    };
    const key = (cur: Cursor): Pred => {
      const t = cur.list[cur.pos++];
      if (!t) throw new Bad('Missing search key');
      if ('list' in t) return group(t.list);
      const k = (strOf(t) ?? '').toUpperCase();
      const arg = () => {
        const a = cur.list[cur.pos++];
        if (a === undefined || 'list' in a) throw new Bad(`${k} needs a value`);
        return a;
      };
      const flag = (f: string, want: boolean): Pred => (c) => c.info.flags.includes(f) === want;
      const text = (get: (h: { t: store.Thread; m: store.Msg }) => string): Pred => {
        const v = utf8Of(arg());
        return (c) => {
          const h = hitOf(c);
          return !!h && contains(get(h), v);
        };
      };
      switch (k) {
        case 'ALL':
          return () => true;
        case 'ANSWERED':
          return flag('\\Answered', true);
        case 'UNANSWERED':
          return flag('\\Answered', false);
        case 'DELETED':
          return flag('\\Deleted', true);
        case 'UNDELETED':
          return flag('\\Deleted', false);
        case 'DRAFT':
          return flag('\\Draft', true);
        case 'UNDRAFT':
          return flag('\\Draft', false);
        case 'FLAGGED':
          return flag('\\Flagged', true);
        case 'UNFLAGGED':
          return flag('\\Flagged', false);
        case 'SEEN':
        case 'OLD':
          return flag('\\Seen', true);
        case 'UNSEEN':
          return flag('\\Seen', false);
        case 'NEW':
        case 'RECENT':
          return () => false;
        case 'KEYWORD': {
          const w = strOf(arg()) ?? '';
          return (c) => c.info.flags.includes(w);
        }
        case 'UNKEYWORD': {
          const w = strOf(arg()) ?? '';
          return (c) => !c.info.flags.includes(w);
        }
        case 'FROM':
          return text((h) => people([h.m.from]));
        case 'TO':
        case 'CC':
          return text((h) => people(h.m.to));
        case 'BCC':
          return text((h) => people(h.m.bcc));
        case 'BODY':
          return text((h) => `${h.m.body ?? ''} ${plain(h.m.html)}`);
        case 'TEXT':
          return text((h) => `${h.t.subject} ${people([h.m.from])} ${people(h.m.to)} ${h.m.body ?? ''} ${plain(h.m.html)}`);
        case 'SUBJECT': {
          const v = utf8Of(arg());
          return async (c) => {
            const h = hitOf(c);
            if (!h) return false;
            const src = await parsedOf(h.t, h.m, mb);
            return contains(headerValues(src.root, 'subject').join(' ') || h.t.subject, v);
          };
        }
        case 'HEADER': {
          const field = (strOf(arg()) ?? '').toLowerCase();
          const v = utf8Of(arg());
          return async (c) => {
            const h = hitOf(c);
            if (!h) return false;
            const vals = headerValues((await parsedOf(h.t, h.m, mb)).root, field);
            return vals.length > 0 && (!v || vals.some((x) => contains(x, v)));
          };
        }
        case 'LARGER':
        case 'SMALLER': {
          const n = Number(strOf(arg()));
          if (!Number.isFinite(n)) throw new Bad(`${k} needs a number`);
          return async (c) => {
            const h = hitOf(c);
            if (!h) return false;
            const size = await store.sizeOf(ctx, h.t, h.m, mb);
            return k === 'LARGER' ? size > n : size < n;
          };
        }
        case 'BEFORE':
        case 'SENTBEFORE': {
          const d = searchDay(strOf(arg()));
          return (c) => day(hitOf(c)?.m.date ?? '') < d;
        }
        case 'ON':
        case 'SENTON': {
          const d = searchDay(strOf(arg()));
          return (c) => day(hitOf(c)?.m.date ?? '') === d;
        }
        case 'SINCE':
        case 'SENTSINCE': {
          const d = searchDay(strOf(arg()));
          return (c) => day(hitOf(c)?.m.date ?? '') >= d;
        }
        case 'UID': {
          const set = new Set(pick(strOf(arg()) ?? '', sel.uids, true).map((i) => sel.uids[i]));
          return (c) => set.has(c.uid);
        }
        case 'NOT': {
          const p = key(cur);
          return async (c) => !(await p(c));
        }
        case 'OR': {
          const a = key(cur);
          const b = key(cur);
          return async (c) => (await a(c)) || (await b(c));
        }
        case 'MODSEQ': {
          // MODSEQ ["/flags/\\Seen" all] 1234: only the number counts here.
          let v = strOf(arg());
          if (cur.list[cur.pos] && /^(all|shared|priv)$/i.test(strOf(cur.list[cur.pos]) ?? '')) (cur.pos++, (v = strOf(arg())));
          const n = Number(v);
          if (!Number.isFinite(n)) throw new Bad('MODSEQ needs a number');
          usedModseq = true;
          this.condstore = true;
          return (c) => c.info.modseq >= n;
        }
        default:
          if (/^[\d*:,]+$/.test(k)) {
            const set = new Set(pick(k, sel.uids, false));
            return (c) => set.has(c.seq - 1);
          }
          throw new Bad(`Unknown search key ${k}`);
      }
    };
    const pred = group(rest);
    const found: Cand[] = [];
    for (let i = 0; i < sel.uids.length; i++) {
      const c: Cand = { seq: i + 1, uid: sel.uids[i], info: sel.info.get(sel.uids[i])! };
      if (await pred(c)) found.push(c);
    }
    const nums = found.map((c) => (byUid ? c.uid : c.seq));
    const highest = usedModseq && found.length ? Math.max(...found.map((c) => c.info.modseq)) : 0;
    await this.line(`* SEARCH${nums.length ? ' ' + nums.join(' ') : ''}${highest ? ` (MODSEQ ${highest})` : ''}`);
    return this.line(`${cmd.tag} OK SEARCH completed`);
  }
}

/* ---------- the listeners ---------- */

let servers: (NetServer | TlsServer)[] = [];
export const listening = () => servers.length > 0;

export function start(d: ImapDeps, ports: { imap: number; imaps: number }, host = '0.0.0.0'): Promise<void> {
  deps = d;
  const accept = (secure: boolean) => (socket: Socket) => {
    if (sessions.size >= MAX_TOTAL) return void socket.end('* BYE Too busy, try again shortly\r\n');
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60_000);
    const s = new Session(socket, secure);
    sessions.add(s);
    void s.line(`* OK [CAPABILITY ${s.caps()}] sprint2go IMAP ready`);
  };
  const plain = createNetServer(accept(false));
  const tls = createTlsServer({ ...d.keyCert(), minVersion: 'TLSv1.2' }, accept(true) as (s: TLSSocket) => void);
  tls.on('tlsClientError', () => {});
  const listen = (s: NetServer | TlsServer, port: number) =>
    new Promise<void>((res, rej) => {
      s.once('error', rej);
      s.listen(port, host, () => (s.off('error', rej), s.on('error', (e) => d.log(`[imap] ${e.message}`)), res()));
    });
  servers = [plain, tls];
  return Promise.all([listen(plain, ports.imap), listen(tls, ports.imaps)]).then(() => undefined);
}
/** A renewed certificate: new connections use it at once. */
export function updateContext(ctx: { key: Buffer; cert: Buffer }) {
  for (const s of servers) if ('setSecureContext' in s) (s as TlsServer).setSecureContext({ key: ctx.key, cert: ctx.cert });
}
export async function stop() {
  for (const s of sessions) await s.bye('sprint2go mail apps were switched off');
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null)))));
  servers = [];
}

/** Something changed in sprint2go: the open folders it touches get told (at once while IDLE, else with the next command). */
export function changed(coll: string, upserts: { id: string; accountId?: string; members?: unknown; suspended?: unknown; deletedAt?: unknown }[], deletes: string[]) {
  if (!sessions.size) return;
  if (coll === 'threads') {
    const accounts = new Set(upserts.map((t) => t.accountId).filter(Boolean));
    for (const s of sessions) {
      const sel = s.sel;
      if (!sel) continue;
      const hit = accounts.has(sel.folder.mailbox.id) || deletes.some((id) => [...sel.info.values()].some((i) => i.tid === id));
      if (hit) s.mark();
    }
  } else if (coll === 'workspaces' || coll === 'users') {
    // Access may have changed (removed from a mailbox, mail apps switched off, someone suspended).
    for (const s of sessions) {
      if (!s.userId) continue;
      if (!deps.stillOk(s.userId, s.passwordId)) void s.bye('This sign-in no longer works');
      else if (s.sel && !s.folders().some((f) => f.box === s.sel!.folder.box)) void s.bye('You no longer have this mailbox in sprint2go');
      else if (!s.mailboxes().length) void s.bye('Your company switched off other mail apps');
    }
  }
}
/** An app password was removed (or all of someone's): its connections end now. */
export function endFor(match: (userId: string, passwordId: string) => boolean) {
  for (const s of sessions) if (s.userId && match(s.userId, s.passwordId)) void s.bye('This app password was removed');
}
export const sessionCount = () => sessions.size;
export const newSessionId = () => randomBytes(4).toString('hex');
