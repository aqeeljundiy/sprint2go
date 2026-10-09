// What IMAP needs to know about a message's MIME structure: where each part's headers and body sit in the source, the
// ENVELOPE and BODYSTRUCTURE answers (RFC 3501), and the bytes of a BODY[section]<partial>. Header text is handled as
// latin1 so 8-bit headers keep their exact bytes. Used by server/imap.ts.
import addressparser from 'nodemailer/lib/addressparser';

export interface Header {
  key: string; // lower case
  raw: string; // the whole field as written, folded lines and the final CRLF included (latin1)
  value: string; // the value, unfolded (latin1)
}
export interface Part {
  start: number; // where the part's headers start in the source
  bodyStart: number; // where its body starts (after the blank line)
  end: number; // where its body ends (exclusive)
  headers: Header[];
  type: string; // lower case
  subtype: string; // lower case
  params: [string, string][];
  encoding: string;
  id: string | null;
  description: string | null;
  md5: string | null;
  disposition: { type: string; params: [string, string][] } | null;
  language: string[] | null;
  location: string | null;
  children?: Part[];
  message?: Part; // a message/rfc822 part: the message inside
}

const CRLF = Buffer.from('\r\n');
const MAX_DEPTH = 24;
const MAX_PARTS = 2000;

/** Splits a header block into fields (latin1). */
function parseHeaders(text: string): Header[] {
  const out: Header[] = [];
  const lines = text.split('\r\n');
  let cur: string[] = [];
  const flush = () => {
    if (!cur.length) return;
    const raw = cur.join('\r\n') + '\r\n';
    const i = cur[0].indexOf(':');
    if (i > 0) out.push({ key: cur[0].slice(0, i).trim().toLowerCase(), raw, value: raw.slice(i + 1).replace(/\r\n(?=[ \t])/g, '').replace(/\r\n$/, '').trim() });
    cur = [];
  };
  for (const line of lines) {
    if (line === '') continue;
    if ((line[0] === ' ' || line[0] === '\t') && cur.length) cur.push(line);
    else (flush(), cur.push(line));
  }
  flush();
  return out;
}

/** `value; a=b; c="d"` as the value and its parameters (names lower case, values unquoted). */
function parseParams(v: string): { value: string; params: [string, string][] } {
  const params: [string, string][] = [];
  let i = 0;
  const readToken = (stops: string) => {
    let s = '';
    while (i < v.length && !stops.includes(v[i])) s += v[i++];
    return s.trim();
  };
  const value = readToken(';');
  while (i < v.length) {
    if (v[i] === ';') i++;
    while (i < v.length && /\s/.test(v[i])) i++;
    const name = readToken('=;').toLowerCase();
    let val = '';
    if (v[i] === '=') {
      i++;
      while (i < v.length && /\s/.test(v[i])) i++;
      if (v[i] === '"') {
        i++;
        while (i < v.length && v[i] !== '"') {
          if (v[i] === '\\' && i + 1 < v.length) i++;
          val += v[i++];
        }
        i++;
        readToken(';');
      } else val = readToken(';');
    }
    if (name) params.push([name, val]);
  }
  return { value, params };
}

const header = (hs: Header[], key: string) => hs.find((h) => h.key === key)?.value ?? null;

/** The MIME structure of a message (or of a part, from `start` to `end`). */
export function parse(raw: Buffer, start = 0, end = raw.length, depth = 0, count = { n: 0 }, defaultType = 'text/plain'): Part {
  count.n++;
  // The header block ends at the first empty line; a part may start with one (no headers at all).
  let bodyStart: number;
  if (raw[start] === 13 && raw[start + 1] === 10) bodyStart = start + 2;
  else {
    const blank = raw.indexOf('\r\n\r\n', start);
    bodyStart = blank >= 0 && blank + 4 <= end ? blank + 4 : end;
  }
  const headers = parseHeaders(raw.toString('latin1', start, Math.min(bodyStart, end)));
  const ct = parseParams(header(headers, 'content-type') ?? defaultType);
  let [type, subtype] = ct.value.toLowerCase().split('/').map((s) => s.trim());
  let params = ct.params;
  if (!type || !subtype || !/^[a-z0-9!#$&^_.+-]+$/.test(type + subtype)) [type, subtype, params] = ['text', 'plain', [['charset', 'us-ascii']]];
  if (type === 'text' && !params.some(([k]) => k === 'charset')) params = [['charset', 'us-ascii'], ...params];
  const disp = header(headers, 'content-disposition');
  const dp = disp ? parseParams(disp) : null;
  const lang = header(headers, 'content-language');
  const part: Part = {
    start,
    bodyStart,
    end,
    headers,
    type,
    subtype,
    params,
    encoding: (header(headers, 'content-transfer-encoding') ?? '7bit').trim() || '7bit',
    id: header(headers, 'content-id'),
    description: header(headers, 'content-description'),
    md5: header(headers, 'content-md5'),
    disposition: dp && dp.value ? { type: dp.value, params: dp.params } : null,
    language: lang ? lang.split(',').map((x) => x.trim()).filter(Boolean) : null,
    location: header(headers, 'content-location'),
  };
  if (depth >= MAX_DEPTH || count.n > MAX_PARTS) return part;
  if (type === 'multipart') {
    const boundary = params.find(([k]) => k === 'boundary')?.[1];
    part.children = boundary ? splitMultipart(raw, bodyStart, end, boundary).map((r) => parse(raw, r[0], r[1], depth + 1, count, subtype === 'digest' ? 'message/rfc822' : 'text/plain')) : [];
    if (!part.children.length) part.children = [parse(raw, bodyStart, bodyStart, depth + 1, count)];
  } else if (type === 'message' && subtype === 'rfc822') part.message = parse(raw, bodyStart, end, depth + 1, count);
  return part;
}

/** Where each part of a multipart body sits (between its delimiter lines). */
function splitMultipart(raw: Buffer, from: number, to: number, boundary: string): [number, number][] {
  const delim = Buffer.from(`--${boundary}`, 'latin1');
  const marks: { at: number; after: number; close: boolean }[] = [];
  // A delimiter starts a line: at the very start of the body, or after a CRLF (which belongs to the delimiter).
  const check = (lineStart: number, crlfBefore: number) => {
    if (lineStart + delim.length > to || raw.compare(delim, 0, delim.length, lineStart, lineStart + delim.length) !== 0) return;
    let p = lineStart + delim.length;
    const close = raw[p] === 45 && raw[p + 1] === 45;
    if (close) p += 2;
    while (p < to && (raw[p] === 32 || raw[p] === 9)) p++;
    if (p < to && !(raw[p] === 13 && raw[p + 1] === 10)) return;
    marks.push({ at: crlfBefore, after: Math.min(to, p + 2), close });
  };
  check(from, from);
  let i = from;
  for (;;) {
    const j = raw.indexOf(CRLF, i);
    if (j < 0 || j >= to) break;
    check(j + 2, j);
    if (marks.length && marks[marks.length - 1].close) break;
    i = j + 2;
  }
  const out: [number, number][] = [];
  for (let k = 0; k < marks.length - 1 && !marks[k].close; k++) out.push([marks[k].after, Math.max(marks[k].after, marks[k + 1].at)]);
  // No closing delimiter: the last part runs to the end.
  const last = marks[marks.length - 1];
  if (last && !last.close) out.push([last.after, to]);
  return out;
}

/* ---------- writing IMAP data ---------- */

/** A piece of an IMAP response: text (latin1) or bytes sent as a literal. */
export type Chunk = string | { literal: Buffer };

/** A string as IMAP wants it: quoted when it can be, else a literal; NIL for nothing. */
export function nstring(s: string | null | undefined): Chunk {
  if (s === null || s === undefined) return 'NIL';
  if (s.length < 1000 && !/[\r\n\0\x80-\xff]/.test(s)) return `"${s.replace(/[\\"]/g, (c) => '\\' + c)}"`;
  return { literal: Buffer.from(s, 'latin1') };
}
export const astring = (s: string): Chunk => nstring(s);

/** Joins chunks, merging neighbouring text. */
export function join(parts: (Chunk | Chunk[])[], sep = ' '): Chunk[] {
  const flat: Chunk[] = [];
  parts.forEach((p, i) => {
    if (i > 0 && sep) flat.push(sep);
    if (Array.isArray(p)) flat.push(...p);
    else flat.push(p);
  });
  return flat;
}
export const list = (parts: (Chunk | Chunk[])[]): Chunk[] => ['(', ...join(parts), ')'];

/** The bytes of chunks, literals with their {n} prefix. */
export function toBuffer(chunks: Chunk[]): Buffer {
  return Buffer.concat(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c, 'latin1') : Buffer.concat([Buffer.from(`{${c.literal.length}}\r\n`), c.literal]))));
}

function addresses(v: string | null): Chunk[] | 'NIL' {
  if (!v) return 'NIL';
  let parsed: ReturnType<typeof addressparser>;
  try {
    parsed = addressparser(v);
  } catch {
    return 'NIL';
  }
  const out: Chunk[][] = [];
  const one = (name: string, address: string) => {
    const at = address.lastIndexOf('@');
    const mailbox = at > 0 ? address.slice(0, at) : address;
    const host = at > 0 ? address.slice(at + 1) : null;
    out.push(list([nstring(name || null), 'NIL', nstring(mailbox || null), nstring(host)]));
  };
  for (const a of parsed) {
    if ('group' in a && a.group) {
      out.push(list(['NIL', 'NIL', nstring(a.name || ''), 'NIL']));
      for (const g of a.group) if (!('group' in g && g.group)) one(g.name, (g as { address: string }).address);
      out.push(list(['NIL', 'NIL', 'NIL', 'NIL']));
    } else one(a.name, (a as { address: string }).address ?? '');
  }
  return out.length ? ['(', ...out.flat(), ')'] : 'NIL';
}

/** ENVELOPE of a message (the root, or the message inside a message/rfc822 part). */
export function envelope(msg: Part): Chunk[] {
  const h = (k: string) => header(msg.headers, k);
  const from = addresses(h('from'));
  const sender = h('sender') ? addresses(h('sender')) : from;
  const replyTo = h('reply-to') ? addresses(h('reply-to')) : from;
  const items: (Chunk | Chunk[])[] = [nstring(h('date')), nstring(h('subject')), from, sender, replyTo, addresses(h('to')), addresses(h('cc')), addresses(h('bcc')), nstring(h('in-reply-to')), nstring(h('message-id'))];
  return list(items);
}

const paramList = (ps: [string, string][]): Chunk[] | 'NIL' => (ps.length ? list(ps.flatMap(([k, v]) => [nstring(k.toUpperCase()), nstring(v)])) : 'NIL');
function lineCount(raw: Buffer, from: number, to: number) {
  let n = 0;
  for (let i = from; i < to; i++) if (raw[i] === 10) n++;
  if (to > from && raw[to - 1] !== 10) n++;
  return n;
}

/** BODYSTRUCTURE (`extended`) or BODY of a part. */
export function bodystructure(raw: Buffer, p: Part, extended: boolean): Chunk[] {
  if (p.children) {
    const kids = p.children.map((c) => bodystructure(raw, c, extended));
    const parts: Chunk[] = ['(', ...kids.flat(), ' ', nstring(p.subtype.toUpperCase())];
    if (extended) parts.push(' ', ...[paramList(p.params)].flat(), ' ', ...disposition(p), ' ', ...language(p), ' ', nstring(p.location));
    parts.push(')');
    return parts;
  }
  const size = p.end - p.bodyStart;
  const items: (Chunk | Chunk[])[] = [nstring(p.type.toUpperCase()), nstring(p.subtype.toUpperCase()), paramList(p.params), nstring(p.id), nstring(p.description), nstring(p.encoding.toUpperCase()), String(size)];
  if (p.type === 'message' && p.subtype === 'rfc822' && p.message) items.push(envelope(p.message), bodystructure(raw, p.message, extended), String(lineCount(raw, p.bodyStart, p.end)));
  else if (p.type === 'text') items.push(String(lineCount(raw, p.bodyStart, p.end)));
  if (extended) items.push(nstring(p.md5), disposition(p), language(p), nstring(p.location));
  return list(items);
}
const disposition = (p: Part): Chunk[] => (p.disposition ? list([nstring(p.disposition.type.toUpperCase()), paramList(p.disposition.params)]) : ['NIL']);
const language = (p: Part): Chunk[] => (!p.language?.length ? ['NIL'] : p.language.length === 1 ? [nstring(p.language[0])] : list(p.language.map((l) => nstring(l))));

/* ---------- BODY[section]<partial> ---------- */

export interface Section {
  path: number[];
  text: '' | 'HEADER' | 'HEADER.FIELDS' | 'HEADER.FIELDS.NOT' | 'TEXT' | 'MIME';
  fields: string[]; // upper case
}

/** Reads `1.2.HEADER.FIELDS (FROM TO)` (what's inside the brackets). Null when it isn't a section. */
export function parseSection(spec: string): Section | null {
  const all = spec.trim();
  let s = all;
  const path: number[] = [];
  while (/^\d/.test(s)) {
    const m = /^(\d+)(\.|$)/.exec(s);
    if (!m || Number(m[1]) < 1 || m[1].length > 6) return null;
    path.push(Number(m[1]));
    s = s.slice(m[0].length);
    if (m[2] === '.' && !s) return null; // "1." ends with nothing after the dot
    if (!m[2]) break;
  }
  if (!s) return { path, text: '', fields: [] };
  const m = /^(HEADER\.FIELDS\.NOT|HEADER\.FIELDS|HEADER|TEXT|MIME)(?:\s*\(([^)]*)\))?$/i.exec(s);
  if (!m) return null;
  const text = m[1].toUpperCase() as Section['text'];
  const withFields = text === 'HEADER.FIELDS' || text === 'HEADER.FIELDS.NOT';
  const fields = (m[2] ?? '').trim() ? m[2].trim().split(/\s+/).map((f) => f.replace(/^"|"$/g, '').toUpperCase()) : [];
  if (withFields !== (m[2] !== undefined) || (withFields && !fields.length)) return null;
  if (text === 'MIME' && !path.length) return null;
  return { path, text, fields };
}

/** The part a section number points at (RFC 3501 6.4.5), or null. */
function resolve(root: Part, path: number[]): Part | null {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    const n = path[i];
    const body = i > 0 && cur.message ? cur.message : cur;
    if (body.children) {
      const next = body.children[n - 1];
      if (!next) return null;
      cur = next;
    } else if (n === 1) cur = body;
    else return null;
  }
  return cur;
}

/** The bytes of a section (empty when it doesn't exist, as servers answer). */
export function sectionBytes(raw: Buffer, root: Part, s: Section): Buffer {
  const target = s.path.length ? resolve(root, s.path) : root;
  if (!target) return Buffer.alloc(0);
  const msgOf = (p: Part) => (s.path.length ? p.message ?? null : p);
  switch (s.text) {
    case '':
      return s.path.length ? raw.subarray(target.bodyStart, target.end) : raw;
    case 'MIME':
      return raw.subarray(target.start, target.bodyStart);
    case 'TEXT': {
      const m = msgOf(target);
      return m ? raw.subarray(m.bodyStart, m.end) : Buffer.alloc(0);
    }
    case 'HEADER': {
      const m = msgOf(target);
      return m ? raw.subarray(m.start, m.bodyStart) : Buffer.alloc(0);
    }
    case 'HEADER.FIELDS':
    case 'HEADER.FIELDS.NOT': {
      const m = msgOf(target);
      if (!m) return Buffer.alloc(0);
      const want = new Set(s.fields.map((f) => f.toLowerCase()));
      const keep = m.headers.filter((h) => want.has(h.key) === (s.text === 'HEADER.FIELDS'));
      return Buffer.from(keep.map((h) => h.raw).join('') + '\r\n', 'latin1');
    }
  }
}

/* ---------- words in headers, for SEARCH ---------- */

const decoderFor = (cs: string) => {
  try {
    return new TextDecoder(cs.toLowerCase() === 'utf8' ? 'utf-8' : cs);
  } catch {
    return new TextDecoder('utf-8');
  }
};
/** A header value with its =?charset?B/Q?...?= words decoded (raw 8-bit read as UTF-8). */
export function decodeWords(v: string): string {
  const bytes = Buffer.from(v, 'latin1');
  const text = /[\x80-\xff]/.test(v) ? bytes.toString('utf8') : v;
  return text.replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bqBQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_all, cs: string, enc: string, data: string) => {
    try {
      const buf = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return decoderFor(cs).decode(buf);
    } catch {
      return data;
    }
  });
}
export const headerValues = (p: Part, key: string) => p.headers.filter((h) => h.key === key).map((h) => decodeWords(h.value));
