// Mail from an mbox file or a Google Takeout of Gmail (Settings, Import, "Gmail or mbox"), into one mailbox here: how a
// team brings its Gmail history. Runs inside the import framework (server/imports.ts): the admin uploads, checks the
// preview and picks the mailbox, it runs in the background, and Undo removes exactly what it made for 24 hours.
//  - A Takeout zip: every .mbox under Takeout/Mail ("All mail Including Spam and Trash.mbox"); other Takeout parts are
//    named and left out. A plain .mbox works too (Thunderbird, Apple Mail, our own export).
//  - Each message keeps its source (server/mailRaw.ts, so mail apps see it exactly as it was) and lands where Gmail had
//    it (X-Gmail-Labels): Inbox, Sent, Archived, Spam, Trash, Starred, Unread. Replies join their conversation; Chats
//    are left out. A message already in the mailbox (same Message-ID) isn't brought in twice.
//  - Attachments become the company's files and count toward its storage; when the storage is full the email still
//    comes, without them, and the summary lists what was left out.
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import * as db from './db.ts';
import * as store from './imapStore.ts';
import * as raws from './mailRaw.ts';
import { readZip, openEntry, type ZipEntry } from './zip.ts';
import { ImportError, fileId, limits, typeOf, type AnalyzeCtx, type RunCtx } from './importKit.ts';
import { looksLikeMbox, readMbox } from './mailExport.ts';
import type { ImportPreview } from '../src/importTypes.ts';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const MAX_MESSAGE = 30 * 1024 * 1024;
const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);

/** The mbox files in the upload: the zip's .mbox entries (a Takeout's Mail part), or the upload itself. */
async function sources(file: string): Promise<{ zip: ZipEntry[] | null; other: string[] }> {
  if (await looksLikeMbox(file)) return { zip: null, other: [] };
  let entries: ZipEntry[];
  try {
    entries = await readZip(file, { maxFiles: limits().files, maxTotal: limits().unzipped });
  } catch {
    throw new ImportError('That isn’t an mbox file or a zip. Export Gmail at takeout.google.com (Mail only), or export an mbox from your mail app.');
  }
  const mboxes = entries.filter((e) => !e.dir && /\.mbox$/i.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name));
  const other = [...new Set(entries.filter((e) => e.name.startsWith('Takeout/') && !/^Takeout\/(Mail|E-mail|Gmail)\//i.test(e.name)).map((e) => e.name.split('/')[1]).filter((x) => x && !/\.html?$/i.test(x)))];
  if (!mboxes.length) throw new ImportError(other.length ? `This Takeout has no Mail in it (it has ${other.slice(0, 4).join(', ')}). At takeout.google.com, pick Mail and export again.` : 'This zip has no .mbox file in it.');
  return { zip: mboxes, other };
}
async function* allMessages(file: string, zip: ZipEntry[] | null, skipped: { n: number }) {
  if (!zip) {
    yield* readMbox(createReadStream(file), MAX_MESSAGE, skipped);
    return;
  }
  for (const e of zip) yield* readMbox((await openEntry(file, e)) as Readable, MAX_MESSAGE, skipped);
}

const hostedBoxes = (ws: any) => ((ws.accounts ?? []) as any[]).filter((a) => a.email && !a.temp && (!a.provider || a.provider === 'sprint2go'));

export async function analyze(ctx: AnalyzeCtx): Promise<ImportPreview> {
  ctx.progress('Reading the mail', 0, 1);
  const { zip, other } = await sources(ctx.file);
  const boxes = hostedBoxes(ctx.ws);
  if (!boxes.length) throw new ImportError('There’s no mailbox here to bring mail into. Add one in Settings, Email delivery first.');
  const addrs = new Map(boxes.map((a) => [lower(a.email), a.id]));
  const hits = new Map<string, number>();
  let messages = 0;
  let bytes = 0;
  const skipped = { n: 0 };
  for await (const m of allMessages(ctx.file, zip, skipped)) {
    if (m.labels.includes('chat')) continue;
    messages++;
    bytes += m.raw.length;
    // Which of our mailboxes it was for: the addresses in its headers.
    const head = m.raw.subarray(0, Math.min(m.raw.length, 16 * 1024)).toString('latin1').toLowerCase();
    for (const [addr, id] of addrs) if (head.includes(addr)) hits.set(id, (hits.get(id) ?? 0) + 1);
    if (messages % 500 === 0) ctx.progress('Reading the mail', messages, messages + 1);
  }
  if (!messages) throw new ImportError(skipped.n ? 'Every email in this file is over 30 MB, too big to bring in.' : 'There are no emails in this file.');
  const suggested = [...hits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    source: 'mail',
    title: zip ? 'Gmail' : 'mbox',
    people: [],
    mail: { messages, bytes, mboxes: zip ? zip.map((e) => e.name.split('/').pop()!) : [], tooBig: skipped.n, otherParts: other, mailboxes: boxes.map((a) => ({ id: a.id, email: a.email, name: a.name ?? '', shared: a.kind === 'shared' })), suggested },
    room: ctx.room,
    seatsLeft: null,
  };
}

type Place = 'inbox' | 'archive' | 'spam' | 'trash' | 'drafts';
const placeOf = (labels: string[], mine: boolean): Place => (labels.includes('trash') ? 'trash' : labels.includes('spam') ? 'spam' : labels.includes('drafts') || labels.includes('draft') ? 'drafts' : labels.includes('inbox') && !mine ? 'inbox' : 'archive');
const RANK: Record<Place, number> = { inbox: 4, archive: 3, drafts: 2, spam: 1, trash: 0 };
const cleanSubject = (s: string) => String(s ?? '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim();

export async function run(ctx: RunCtx) {
  const ws = ctx.ws;
  const box = hostedBoxes(ws).find((a) => a.id === ctx.choices.mailbox);
  if (!box) throw new ImportError('That mailbox isn’t in this company any more. Pick another and start again.');
  const { zip } = await sources(ctx.file);
  const total = ctx.preview.mail?.messages ?? 0;
  const mineAddrs = new Set([lower(box.email), ...((ws.mailAliases ?? []) as any[]).filter((al) => (al.to ?? []).includes(box.id)).map((al) => lower(al.address))]);
  // Message-IDs already in the mailbox: not brought in twice.
  const known = new Set<string>();
  for (const r of db.db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND json_extract(data, '$.accountId') = ?").all(box.id) as { data: string }[]) for (const m of JSON.parse(r.data).messages ?? []) if (m.mid) known.add(m.mid);
  const threads = new Map<string, any>(); // made by this import, by id
  const byMid = new Map<string, string>(); // Message-ID to thread id (this import's threads only)
  const dirty = new Set<string>();
  let done = 0;
  let made = 0;
  let files = 0;
  const skipped = { n: 0 };
  const flush = () => {
    if (!dirty.size) return;
    ctx.add('threads', [...dirty].map((id) => threads.get(id)));
    dirty.clear();
  };
  for await (const m of allMessages(ctx.file, zip, skipped)) {
    if (m.labels.includes('chat')) continue;
    done++;
    let r: Awaited<ReturnType<typeof store.read>>;
    try {
      r = await store.read(m.raw);
    } catch {
      ctx.missing(`#${done}`, 'mail', 'it couldn’t be read', 'conversation');
      continue;
    }
    if (r.mid && known.has(r.mid)) {
      continue;
    }
    if (r.mid) known.add(r.mid);
    const mine = mineAddrs.has(r.from.email);
    // Attachments, while there's room (pictures inside the HTML are already in it).
    const attachments: { name: string; size: string; url: string }[] = [];
    for (const a of r.parsed.attachments) {
      if (a.related && a.contentId) continue;
      const name = a.filename ?? 'attachment';
      if (a.size > ctx.maxFile() || a.size > ctx.room()) {
        ctx.missing(name, cleanSubject(r.parsed.subject ?? '') || '(no subject)', a.size > ctx.maxFile() ? 'too big' : 'no storage left');
        continue;
      }
      const id = fileId();
      writeFileSync(db.filePath(id), a.content);
      ctx.addFile({ id, name, type: typeOf(name, a.contentType), size: a.size });
      attachments.push({ name, size: fmtSize(a.size), url: `/api/files/${id}` });
      files++;
    }
    const msg = {
      id: `m-${randomBytes(6).toString('hex')}`,
      mid: r.mid ?? `<${randomBytes(12).toString('hex')}@import.sprint2go>`,
      from: r.from.email ? r.from : { name: box.name ?? '', email: lower(box.email) },
      to: [...r.to, ...r.cc],
      ...(r.bcc.length && mine ? { bcc: r.bcc } : {}),
      date: (r.parsed.date ?? new Date()).toISOString(),
      body: (r.parsed.text ?? '').trim().slice(0, 200_000),
      html: r.parsed.html ? String(r.parsed.html).slice(0, 1_000_000) : undefined,
      ...(attachments.length ? { attachments } : {}),
    };
    const place = placeOf(m.labels, mine);
    const parentId = r.refs.map((x) => byMid.get(x)).find(Boolean);
    const t = parentId ? threads.get(parentId) : null;
    if (t) {
      t.messages = [...t.messages, msg].sort((a: any, b: any) => a.date.localeCompare(b.date));
      if (RANK[place] > RANK[t.location as Place]) t.location = place;
      t.unread = t.unread || (m.labels.includes('unread') && !mine);
      t.starred = t.starred || m.labels.includes('starred');
      dirty.add(t.id);
      byMid.set(msg.mid, t.id);
    } else {
      const id = `t-${randomBytes(6).toString('hex')}`;
      threads.set(id, { id, accountId: box.id, workspaceId: ws.id, subject: cleanSubject(r.parsed.subject ?? '') || '(no subject)', location: place, starred: m.labels.includes('starred'), unread: m.labels.includes('unread') && !mine, labels: [], messages: [msg] });
      byMid.set(msg.mid, id);
      dirty.add(id);
    }
    // The source as it was, for mail apps (kept before the thread is saved; a thread that's undone sweeps it).
    raws.keepRaw(byMid.get(msg.mid)!, msg.id, m.raw);
    made++;
    if (dirty.size >= 200) flush();
    if (done % 50 === 0) {
      ctx.progress(box.email, done, total);
      await ctx.breathe();
    }
  }
  flush();
  if (skipped.n) ctx.missing(skipped.n === 1 ? '1 email' : `${skipped.n} emails`, box.email, 'over 30 MB', 'conversation');
  ctx.made('messages', made);
  ctx.made('files', files);
  ctx.progress('Done', total, total);
}
