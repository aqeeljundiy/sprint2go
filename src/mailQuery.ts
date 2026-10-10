// Gmail's search operators, read the same way in the app, on the server (/api/mail/search, the AI connector) and for
// mail apps (IMAP SEARCH X-GM-RAW). No imports beyond types: the server loads this file as it is.
//
//   from: to: cc: bcc: subject: has:attachment has:userlabels has:nouserlabels filename: larger: smaller:
//   before: after: older_than: newer_than: label: in:inbox|sent|drafts|archive|spam|trash|snoozed|starred|anywhere
//   is:unread|read|starred|important|snoozed|muted category:primary|promotions|social|updates|forums list:
//   rfc822msgid: "a phrase", OR (also |), {a b} (any of), -exclude, (groups), field:(a b)
import type { Message, Thread } from './types';

export type Category = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
export const CATEGORIES: Category[] = ['primary', 'promotions', 'social', 'updates', 'forums'];

export type QNode =
  | { k: 'and'; c: QNode[] }
  | { k: 'or'; c: QNode[] }
  | { k: 'not'; c: QNode }
  | { k: 'term'; field: string; value: string; exact?: boolean };

/** The operators this reads (anything else before a colon is plain text, as Gmail does). */
export const FIELDS = ['from', 'to', 'cc', 'bcc', 'subject', 'has', 'filename', 'larger', 'smaller', 'size', 'before', 'after', 'older', 'newer', 'older_than', 'newer_than', 'label', 'in', 'is', 'category', 'list', 'rfc822msgid', 'deliveredto'];

type Tok = { t: '(' | ')' | '{' | '}' | 'or' | 'neg' } | { t: 'term'; field: string; value: string; exact: boolean } | { t: 'field('; field: string };

function tokenize(q: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = q;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      out.push({ t: ch });
      i++;
      continue;
    }
    if (ch === '|') {
      out.push({ t: 'or' });
      i++;
      continue;
    }
    if (ch === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      out.push({ t: 'neg' });
      i++;
      continue;
    }
    if (ch === '"' || ch === '“' || ch === '”') {
      const end = s.slice(i + 1).search(/["“”]/);
      const value = end < 0 ? s.slice(i + 1) : s.slice(i + 1, i + 1 + end);
      i = end < 0 ? s.length : i + end + 2;
      if (value.trim()) out.push({ t: 'term', field: '', value: value.trim(), exact: true });
      continue;
    }
    // A word, maybe field:value, field:"phrase" or field:(group).
    let j = i;
    while (j < s.length && !/[\s(){}"“”]/.test(s[j])) j++;
    const word = s.slice(i, j);
    const m = word.match(/^([a-z_0-9]+):(.*)$/i);
    if (m && FIELDS.includes(m[1].toLowerCase())) {
      const field = m[1].toLowerCase();
      if (m[2]) {
        out.push({ t: 'term', field, value: m[2], exact: false });
        i = j;
      } else if (s[j] === '(') {
        out.push({ t: 'field(', field });
        i = j + 1;
      } else if (s[j] === '"' || s[j] === '“' || s[j] === '”') {
        const end = s.slice(j + 1).search(/["“”]/);
        const value = end < 0 ? s.slice(j + 1) : s.slice(j + 1, j + 1 + end);
        out.push({ t: 'term', field, value: value.trim(), exact: true });
        i = end < 0 ? s.length : j + end + 2;
      } else i = j; // "from:" with nothing after: ignored
      continue;
    }
    if (word === 'OR') out.push({ t: 'or' });
    else if (word === 'AND') {
      /* the default */
    } else if (word) out.push({ t: 'term', field: '', value: word, exact: false });
    i = j || i + 1;
  }
  return out;
}

/** Reads a search into a tree, or null when there's nothing to look for. Never throws: odd input reads as words. */
export function parseQuery(q: string): QNode | null {
  const toks = tokenize(String(q ?? '').slice(0, 1000));
  let pos = 0;
  const peek = () => toks[pos];
  const withField = (n: QNode, field: string): QNode =>
    n.k === 'term' ? (n.field ? n : { ...n, field }) : n.k === 'not' ? { k: 'not', c: withField(n.c, field) } : { k: n.k, c: n.c.map((x) => withField(x, field)) };
  const simplify = (k: 'and' | 'or', c: QNode[]): QNode | null => (c.length === 0 ? null : c.length === 1 ? c[0] : { k, c });

  function orExpr(close?: ')' | '}'): QNode | null {
    const parts: QNode[] = [];
    let cur = andExpr(close);
    if (cur) parts.push(cur);
    while (peek()?.t === 'or') {
      pos++;
      cur = andExpr(close);
      if (cur) parts.push(cur);
    }
    return simplify('or', parts);
  }
  function andExpr(close?: ')' | '}'): QNode | null {
    const parts: QNode[] = [];
    for (;;) {
      const tk = peek();
      if (!tk || tk.t === 'or' || tk.t === ')' || tk.t === '}') break;
      const u = unary();
      if (u) parts.push(u);
    }
    void close;
    return simplify('and', parts);
  }
  function unary(): QNode | null {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === 'neg') {
      pos++;
      const u = unary();
      return u ? { k: 'not', c: u } : null;
    }
    return atom();
  }
  function atom(): QNode | null {
    const tk = toks[pos++];
    if (!tk) return null;
    if (tk.t === 'term') return { k: 'term', field: tk.field, value: tk.value, exact: tk.exact || undefined };
    if (tk.t === '(' || tk.t === 'field(') {
      const inner = orExpr(')');
      if (peek()?.t === ')') pos++;
      if (!inner) return null;
      return tk.t === 'field(' ? withField(inner, tk.field) : inner;
    }
    if (tk.t === '{') {
      const parts: QNode[] = [];
      while (peek() && peek()!.t !== '}') {
        const u = unary();
        if (u) parts.push(u);
        else if (peek()?.t === 'or' || peek()?.t === ')') pos++;
      }
      if (peek()?.t === '}') pos++;
      return simplify('or', parts);
    }
    return null; // a stray ) } or OR
  }
  const parts: QNode[] = [];
  while (pos < toks.length) {
    const n = orExpr();
    if (n) parts.push(n);
    else pos++; // skip what can't start anything
  }
  return simplify('and', parts);
}

/** Back to text (chips and saved searches show it; the round trip reads the same). */
export function queryText(n: QNode | null): string {
  if (!n) return '';
  const val = (v: string, exact?: boolean) => (exact || /\s/.test(v) ? `"${v}"` : v);
  switch (n.k) {
    case 'term':
      return n.field ? `${n.field}:${val(n.value, n.exact)}` : val(n.value, n.exact);
    case 'not':
      return `-${n.c.k === 'term' ? queryText(n.c) : `(${queryText(n.c)})`}`;
    case 'and':
      return n.c.map((x) => (x.k === 'or' ? `(${queryText(x)})` : queryText(x))).join(' ');
    case 'or':
      return n.c.map((x) => (x.k === 'and' ? `(${queryText(x)})` : queryText(x))).join(' OR ');
  }
}

/** Every term in the tree with whether it's wanted (true) or excluded (false). */
export function termsOf(n: QNode | null, want = true, out: { field: string; value: string; want: boolean }[] = []) {
  if (!n) return out;
  if (n.k === 'term') out.push({ field: n.field, value: n.value, want });
  else if (n.k === 'not') termsOf(n.c, !want, out);
  else for (const c of n.c) termsOf(c, want, out);
  return out;
}

/** Plain words that every match must contain (for a full-text index to narrow the candidates first). */
export function requiredWords(n: QNode | null): string[] {
  if (!n) return [];
  if (n.k === 'term') return !n.field ? [n.value] : n.field === 'subject' || n.field === 'filename' ? [n.value] : [];
  if (n.k === 'and') return n.c.flatMap(requiredWords);
  return [];
}

/** Whether the search names a place itself (otherwise Spam and Trash are left out, as in Gmail). */
export function namesPlace(n: QNode | null): boolean {
  return termsOf(n).some((x) => x.field === 'in' && x.want);
}

/* ---------- matching ---------- */

export interface QueryCtx {
  now?: number;
  /** Your own addresses (from:me, to:me, and "sent"). */
  isMine?: (email: string) => boolean;
  /** A label's name by its id. */
  labelName?: (id: string) => string | undefined;
}

const lower = (s: unknown) => String(s ?? '').toLowerCase();
const norm = (s: string) => lower(s).replace(/[-_]+/g, ' ').trim();

/** "10M", "500K", "2MB", "1048576" as bytes. */
export function sizeOf(v: string): number {
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i);
  if (!m) return NaN;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return Math.round(n * (unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1));
}
/** "1.2 MB" (as attachments carry it) as bytes. */
const attSize = (s: string | undefined) => {
  const m = String(s ?? '').match(/([\d.,]+)\s*(B|KB|MB|GB)/i);
  if (!m) return 0;
  const n = Number(m[1].replace(',', '.'));
  const u = m[2].toUpperCase();
  return Math.round(n * (u === 'GB' ? 1024 ** 3 : u === 'MB' ? 1024 ** 2 : u === 'KB' ? 1024 : 1));
};
/** A message's rough size on the wire: its text and its files. */
export const messageSize = (m: Pick<Message, 'body' | 'html' | 'attachments'>) => (m.body?.length ?? 0) + (m.html?.length ?? 0) + (m.attachments ?? []).reduce((s, a) => s + attSize(a.size), 0);

/** 2026/10/08, 2026-10-08, 10/08/2026 as the start of that day (local), or a timestamp in seconds. */
export function dayOf(v: string): number {
  const s = String(v).trim();
  if (/^\d{9,11}$/.test(s)) return Number(s) * 1000;
  let m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
  return NaN;
}
/** "2d", "3m", "1y", "12h" as milliseconds. */
export function spanOf(v: string): number {
  const m = String(v).trim().match(/^(\d+)\s*([hdwmy])$/i);
  if (!m) return NaN;
  const n = Number(m[1]);
  return n * { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 }[m[2].toLowerCase() as 'h']!;
}

const people = (ps: { name?: string; email?: string }[] | undefined) => (ps ?? []).map((p) => `${lower(p.name)} <${lower(p.email)}>`).join(' ');
const plain = (html?: string) => (html ?? '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
/** What a plain word looks through: the subject, the people, the text and the file names. */
const allText = (t: Pick<Thread, 'subject'>, m: Message) => lower(`${t.subject} ${people([m.from])} ${people(m.to)} ${m.body ?? ''} ${m.html && !m.body ? plain(m.html) : ''} ${(m.attachments ?? []).map((a) => a.name).join(' ')}`);
/** A word matches at a word start or anywhere (Gmail matches whole words; people expect parts too). */
const has = (hay: string, needle: string) => !!needle && hay.includes(lower(needle));
const personMatch = (ps: { name?: string; email?: string }[] | undefined, v: string, ctx: QueryCtx) => {
  const want = lower(v);
  if (want === 'me') return (ps ?? []).some((p) => !!ctx.isMine?.(p.email ?? ''));
  return has(people(ps), want);
};

export type MatchThread = Pick<Thread, 'subject' | 'location' | 'starred' | 'unread' | 'labels' | 'messages'> & Partial<Pick<Thread, 'snoozedUntil' | 'sendAt' | 'category' | 'important' | 'muted'>>;

function termHit(n: Extract<QNode, { k: 'term' }>, t: MatchThread, m: Message, ctx: QueryCtx): boolean {
  const v = n.value;
  const lv = lower(v);
  const now = ctx.now ?? Date.now();
  const at = Date.parse(m.date);
  const snoozed = !!t.snoozedUntil && Date.parse(t.snoozedUntil) > now;
  switch (n.field) {
    case '':
      return n.exact ? lower(allText(t, m).replace(/\s+/g, ' ')).includes(lv.replace(/\s+/g, ' ')) : has(allText(t, m), lv);
    case 'from':
      return personMatch([m.from], v, ctx);
    case 'to':
    case 'cc': // received mail keeps Cc with To
    case 'deliveredto':
      return personMatch(m.to, v, ctx);
    case 'bcc':
      return personMatch(m.bcc, v, ctx);
    case 'subject':
      return has(lower(t.subject), lv);
    case 'filename':
      return (m.attachments ?? []).some((a) => has(lower(a.name), lv) || lower(a.name).endsWith('.' + lv));
    case 'has':
      if (lv === 'attachment' || lv === 'attachments' || lv === 'file' || lv === 'files') return !!m.attachments?.length;
      if (lv === 'userlabels') return t.labels.length > 0;
      if (lv === 'nouserlabels') return t.labels.length === 0;
      if (lv === 'invite') return !!m.invite;
      if (lv === 'unsubscribe' || lv === 'list') return !!m.listUnsubscribe || !!m.listId;
      return false;
    case 'larger':
    case 'size':
      return messageSize(m) > sizeOf(v);
    case 'smaller':
      return messageSize(m) < sizeOf(v);
    case 'before':
      return at < dayOf(v);
    case 'after':
      return at >= dayOf(v);
    case 'older_than':
    case 'older':
      return at < now - spanOf(v);
    case 'newer_than':
    case 'newer':
      return at >= now - spanOf(v);
    case 'label': {
      const want = norm(v);
      return t.labels.some((id) => norm(id) === want || norm(ctx.labelName?.(id) ?? '') === want);
    }
    case 'in':
      switch (lv) {
        case 'anywhere':
        case 'all':
          return true;
        case 'inbox':
          return t.location === 'inbox' && !snoozed;
        case 'sent':
          return !!ctx.isMine?.(m.from.email) && t.location !== 'drafts';
        case 'drafts':
        case 'draft':
          return t.location === 'drafts';
        case 'archive':
          return t.location === 'archive';
        case 'spam':
          return t.location === 'spam';
        case 'trash':
          return t.location === 'trash';
        case 'snoozed':
          return snoozed;
        case 'starred':
          return t.starred;
        case 'important':
          return !!t.important;
        case 'scheduled':
          return !!t.sendAt;
        default:
          return t.labels.some((id) => norm(id) === norm(v) || norm(ctx.labelName?.(id) ?? '') === norm(v));
      }
    case 'is':
      switch (lv) {
        case 'unread':
          return t.unread;
        case 'read':
          return !t.unread;
        case 'starred':
          return t.starred;
        case 'important':
          return !!t.important;
        case 'snoozed':
          return snoozed;
        case 'muted':
          return !!t.muted;
        default:
          return false;
      }
    case 'category':
      return (t.category ?? 'primary') === (lv === 'personal' ? 'primary' : lv);
    case 'list':
      return has(lower(m.listId ?? ''), lv) || has(lower(m.listUnsubscribe?.url ?? ''), lv);
    case 'rfc822msgid':
      return lower(m.mid ?? '').replace(/[<>]/g, '') === lv.replace(/[<>]/g, '');
    default:
      return false;
  }
}

/** Whether one message (in its conversation) matches. IMAP asks per message; the app per conversation. */
export function matchMessage(n: QNode | null, t: MatchThread, m: Message, ctx: QueryCtx = {}): boolean {
  if (!n) return true;
  switch (n.k) {
    case 'term':
      return termHit(n, t, m, ctx);
    case 'not':
      return !matchMessage(n.c, t, m, ctx);
    case 'and':
      return n.c.every((c) => matchMessage(c, t, m, ctx));
    case 'or':
      return n.c.some((c) => matchMessage(c, t, m, ctx));
  }
}

/**
 * Whether a conversation matches: one of its messages matches the whole search. Spam and Trash only when the search
 * names them (in:spam, in:trash, in:anywhere), as Gmail does.
 */
export function matchThread(n: QNode | null, t: MatchThread, ctx: QueryCtx = {}): boolean {
  if (!n) return true;
  if ((t.location === 'spam' || t.location === 'trash') && !namesPlace(n)) return false;
  return t.messages.some((m) => matchMessage(n, t, m, ctx));
}

/** Parses and matches in one go (for callers with a string). */
export function threadMatches(q: string, t: MatchThread, ctx: QueryCtx = {}) {
  return matchThread(parseQuery(q), t, ctx);
}

/* ---------- building a search from the options panel and the chips ---------- */

export interface SearchForm {
  from: string;
  to: string;
  subject: string;
  words: string; // has the words
  without: string; // doesn't have
  size: { op: 'larger' | 'smaller'; n: string; unit: 'MB' | 'KB' } | null;
  within: '' | '1d' | '3d' | '7d' | '14d' | '1m' | '2m' | '6m' | '1y';
  in: '' | 'inbox' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash' | 'starred' | 'anywhere' | 'unread';
  attachment: boolean;
  unread: boolean;
  starred: boolean;
  important: boolean;
  category: '' | Category;
}
export const EMPTY_FORM: SearchForm = { from: '', to: '', subject: '', words: '', without: '', size: null, within: '', in: '', attachment: false, unread: false, starred: false, important: false, category: '' };

const q1 = (field: string, v: string) => {
  const s = v.trim();
  if (!s) return '';
  return /\s/.test(s) ? `${field}:(${s})` : `${field}:${s}`;
};

/** The options panel as a search (what goes in the box). */
export function formToQuery(f: SearchForm): string {
  const parts = [
    f.words.trim(),
    q1('from', f.from),
    q1('to', f.to),
    q1('subject', f.subject),
    ...f.without
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `-${w}`),
    f.size && f.size.n.trim() && Number(f.size.n) > 0 ? `${f.size.op}:${f.size.n.trim()}${f.size.unit === 'MB' ? 'M' : 'K'}` : '',
    f.within ? `newer_than:${f.within}` : '',
    f.in === 'unread' ? 'is:unread' : f.in ? `in:${f.in}` : '',
    f.attachment ? 'has:attachment' : '',
    f.unread && f.in !== 'unread' ? 'is:unread' : '',
    f.starred ? 'is:starred' : '',
    f.important ? 'is:important' : '',
    f.category ? `category:${f.category}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

/** A search back into the options panel (what it can show; the rest stays as words). */
export function queryToForm(q: string): SearchForm {
  const f: SearchForm = { ...EMPTY_FORM };
  const n = parseQuery(q);
  if (!n) return f;
  const top = n.k === 'and' ? n.c : [n];
  const words: string[] = [];
  const without: string[] = [];
  const add = (cur: string, v: string) => (cur ? `${cur} ${v}` : v);
  for (const x of top) {
    if (x.k === 'not' && x.c.k === 'term' && !x.c.field) without.push(x.c.value);
    else if (x.k === 'term') {
      const v = x.value;
      switch (x.field) {
        case 'from':
          f.from = add(f.from, v);
          break;
        case 'to':
          f.to = add(f.to, v);
          break;
        case 'subject':
          f.subject = add(f.subject, v);
          break;
        case 'larger':
        case 'smaller': {
          const b = sizeOf(v);
          f.size = b >= 1024 * 1024 ? { op: x.field, n: String(Math.round((b / 1024 / 1024) * 10) / 10), unit: 'MB' } : { op: x.field, n: String(Math.round(b / 1024)), unit: 'KB' };
          break;
        }
        case 'newer_than':
          f.within = (['1d', '3d', '7d', '14d', '1m', '2m', '6m', '1y'].includes(v) ? v : '') as SearchForm['within'];
          break;
        case 'in':
          f.in = (['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash', 'starred', 'anywhere'].includes(v) ? v : '') as SearchForm['in'];
          break;
        case 'has':
          if (v === 'attachment') f.attachment = true;
          break;
        case 'is':
          if (v === 'unread') f.unread = true;
          if (v === 'starred') f.starred = true;
          if (v === 'important') f.important = true;
          break;
        case 'category':
          if ((CATEGORIES as string[]).includes(v)) f.category = v as Category;
          break;
        case '':
          words.push(x.exact ? `"${v}"` : v);
          break;
        default:
          words.push(queryText(x));
      }
    } else if (x.k === 'and' || x.k === 'or') {
      // field:(a b) comes back as a group of one field
      const fields = new Set(termsOf(x).map((tm) => tm.field));
      const vals = termsOf(x).map((tm) => tm.value).join(' ');
      if (x.k === 'and' && fields.size === 1 && ['from', 'to', 'subject'].includes([...fields][0])) {
        const fl = [...fields][0] as 'from' | 'to' | 'subject';
        f[fl] = add(f[fl], vals);
      } else words.push(`(${queryText(x)})`);
    } else words.push(queryText(x));
  }
  f.words = words.join(' ');
  f.without = without.join(' ');
  return f;
}

/** Sets or clears one simple operator in a search (the chips): `is:unread`, `has:attachment`, `from:x`. */
export function toggleTerm(q: string, field: string, value: string | null): string {
  const n = parseQuery(q);
  const top = !n ? [] : n.k === 'and' ? n.c : [n];
  const kept = top.filter((x) => !(x.k === 'term' && x.field === field && (field === 'is' || field === 'has' || field === 'in' ? lower(x.value) === lower(value ?? x.value) : true)));
  const had = kept.length !== top.length;
  const next = [...kept];
  if (value !== null && !(had && (field === 'is' || field === 'has' || field === 'in'))) next.push({ k: 'term', field, value });
  return queryText(next.length ? { k: 'and', c: next } : null);
}

/** Whether a search has this operator at the top level (a chip is on). */
export function hasTerm(q: string, field: string, value?: string): string | null {
  const n = parseQuery(q);
  const top = !n ? [] : n.k === 'and' ? n.c : [n];
  const hit = top.find((x) => x.k === 'term' && x.field === field && (value === undefined || lower(x.value) === lower(value)));
  return hit && hit.k === 'term' ? hit.value : null;
}
