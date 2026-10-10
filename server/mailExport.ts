// A mailbox as an mbox file in a zip (Settings, Mailbox access, Export), and reading mbox files back (the Mail import,
// server/importMail.ts). mbox is what Google Takeout, Thunderbird and Apple Mail use: each message's source, one after
// another, each starting with a "From " line. Lines inside a message that start with "From " get a ">" (mboxrd), so
// they can't start a new message; reading takes it off again.
// Each message keeps its real source (server/mailRaw.ts, or rebuilt the way mail apps see it), with an X-Gmail-Labels
// header saying where it was (Inbox, Sent, Archived, Spam, Trash, Starred, Unread and labels), the header Google
// Takeout uses, so an export comes back in the same places here or in Gmail.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createDeflateRaw, crc32 } from 'node:zlib';
import type { Writable, Readable } from 'node:stream';
import * as db from './db.ts';
import * as store from './imapStore.ts';
import { companyTz } from '../src/jobTimes.ts';

/* ---------- writing a zip, streamed (no temp file, no size known ahead) ---------- */

const dosTime = (d: Date) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d: Date) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
const write = (out: Writable, b: Buffer) => (out.write(b) ? Promise.resolve() : new Promise<void>((r) => out.once('drain', () => r())));

/**
 * Writes a zip of these entries to `out`, each deflated as its bytes come (sizes and checksums after the data, as zip
 * allows). Up to 4 GB per entry. Doesn't end `out`.
 */
export async function writeZip(out: Writable, entries: { name: string; data: AsyncIterable<Buffer> }[], at = new Date()) {
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0808, 6); // sizes after the data; UTF-8 names
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime(at), 10);
    head.writeUInt16LE(dosDate(at), 12);
    head.writeUInt16LE(name.length, 26);
    const start = offset;
    await write(out, Buffer.concat([head, name]));
    offset += 30 + name.length;
    let crc = 0;
    let size = 0;
    let csize = 0;
    const deflate = createDeflateRaw({ level: 6 });
    const pumped = (async () => {
      for await (const c of deflate as AsyncIterable<Buffer>) {
        csize += c.length;
        await write(out, c);
      }
    })();
    for await (const chunk of e.data) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      if (!deflate.write(chunk)) await new Promise<void>((r) => deflate.once('drain', () => r()));
    }
    deflate.end();
    await pumped;
    if (size > 0xffffffff || csize > 0xffffffff) throw new Error('This mailbox is over 4 GB, too big for one export.');
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(csize, 8);
    desc.writeUInt32LE(size, 12);
    await write(out, desc);
    offset += csize + 16;
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0808, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime(at), 12);
    cen.writeUInt16LE(dosDate(at), 14);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(csize, 20);
    cen.writeUInt32LE(size, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(start, 42);
    central.push(cen, name);
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(out, Buffer.concat([dir, end]));
}

/* ---------- a mailbox as mbox ---------- */

type Account = { id: string; email: string; name?: string; kind?: string };
type Ws = { id: string; name?: string; timeZone?: string; mailAliases?: { address: string; to?: string[] }[] };
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const ASCTIME = (d: Date) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
};
/** Where a message was, as Gmail's labels (Takeout's X-Gmail-Labels). */
function labelsOf(t: store.Thread, m: store.Msg, mine: Set<string>) {
  const out: string[] = [];
  const sent = mine.has(lower(m.from?.email));
  if (t.location === 'drafts') out.push('Drafts');
  else if (t.location === 'trash') out.push('Trash');
  else if (t.location === 'spam') out.push('Spam');
  else if (sent) out.push('Sent');
  else out.push(t.location === 'archive' ? 'Archived' : 'Inbox');
  if (t.starred) out.push('Starred');
  out.push(t.unread && !sent ? 'Unread' : 'Opened');
  for (const l of t.labels ?? []) out.push(l);
  return out.join(',');
}

/** The threads of a mailbox, oldest first. */
export const threadsOf = (accountId: string) =>
  (db.db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND json_extract(data, '$.accountId') = ?").all(accountId) as { data: string }[])
    .map((r) => JSON.parse(r.data) as store.Thread)
    .filter((t) => Array.isArray(t.messages) && t.messages.length)
    .sort((a, b) => String(a.messages[0].date).localeCompare(String(b.messages[0].date)));

/** Every message of a mailbox as mbox text, a message at a time. `count` is told how many went in. */
export async function* mbox(ws: Ws, a: Account, count?: (n: number) => void): AsyncGenerator<Buffer> {
  const mb: store.Mailbox = { id: a.id, email: lower(a.email), name: a.name ?? '', kind: a.kind ?? 'personal', wsId: ws.id, wsName: ws.name ?? '', hosted: true, addresses: new Set([lower(a.email), ...(ws.mailAliases ?? []).filter((al) => (al.to ?? []).includes(a.id)).map((al) => lower(al.address))]), tz: companyTz(ws as any), primary: true };
  let n = 0;
  for (const t of threadsOf(a.id)) {
    for (const m of t.messages) {
      if (m.delivery?.state === 'held') continue;
      const raw = (await store.source(t, m, mb)).toString('latin1').replace(/\r\n/g, '\n');
      const sender = lower(m.from?.email) || 'MAILER-DAEMON';
      const quoted = raw.replace(/^(>*From )/gm, '>$1');
      const body = `X-Gmail-Labels: ${labelsOf(t, m, mb.addresses)}\n${quoted}`;
      yield Buffer.from(`From ${sender.replace(/\s/g, '')} ${ASCTIME(new Date(m.date || Date.now()))}\n${body}${body.endsWith('\n') ? '' : '\n'}\n`, 'latin1');
      n++;
    }
  }
  count?.(n);
}

/* ---------- reading mbox ---------- */

export interface MboxMessage {
  raw: Buffer;
  labels: string[]; // Gmail's (X-Gmail-Labels), lower case
}
/**
 * The messages of an mbox stream, one at a time (a Takeout's "All mail" can be many gigabytes: never all in memory).
 * Each message is capped at `max` bytes; bigger ones are skipped and counted in `skipped`.
 */
export async function* readMbox(src: Readable, max = 30 * 1024 * 1024, skipped?: { n: number }): AsyncGenerator<MboxMessage> {
  // Bytes as they are (8-bit bodies stay intact): latin1 maps each byte to one character and back.
  src.setEncoding('latin1');
  const lines = createInterface({ input: src, crlfDelay: Infinity });
  let parts: Buffer[] = [];
  let size = 0;
  let over = false;
  let started = false;
  const finish = (): MboxMessage | null => {
    if (!started) return null;
    if (over) {
      if (skipped) skipped.n++;
      return null;
    }
    // The blank line before the next "From " belongs to the separator.
    while (parts.length && parts[parts.length - 1].length === 2) parts.pop();
    const raw = Buffer.concat(parts);
    const head = raw.subarray(0, Math.min(raw.length, 32 * 1024)).toString('latin1');
    const end = head.search(/\r\n\r\n/);
    const top = (end < 0 ? head : head.slice(0, end)).replace(/\r\n[ \t]+/g, ' ');
    const labels = (/^X-Gmail-Labels:\s*(.*)$/im.exec(top)?.[1] ?? '')
      .split(',')
      .map((l) => l.trim().replace(/^"|"$/g, '').toLowerCase())
      .filter(Boolean);
    return raw.length ? { raw, labels } : null;
  };
  for await (const line of lines as AsyncIterable<string>) {
    if (/^From \S*/.test(line) && (!started || parts.length === 0 || parts[parts.length - 1].length === 2)) {
      const done = finish();
      if (done) yield done;
      parts = [];
      size = 0;
      over = false;
      started = true;
      continue;
    }
    if (!started) continue;
    if (over) continue;
    const text = /^>+From /.test(line) ? line.slice(1) : line;
    const b = Buffer.from(`${text}\r\n`, 'latin1');
    size += b.length;
    if (size > max) {
      over = true;
      parts = [];
      continue;
    }
    parts.push(b);
  }
  const last = finish();
  if (last) yield last;
}
/** Whether a file starts like an mbox. */
export async function looksLikeMbox(path: string) {
  const s = createReadStream(path, { start: 0, end: 4095, encoding: 'latin1' });
  let head = '';
  for await (const c of s) head += c;
  return /^From \S+/.test(head.replace(/^﻿/, ''));
}
