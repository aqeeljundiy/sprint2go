// The real source (RFC 822) of each email, for mail apps over IMAP (server/imap.ts). Mail that arrives and mail the
// mail engine sends is kept exactly as it was on the wire; older mail (from before this was kept, or the demo's) is
// rebuilt once from what the thread holds and kept too, so every later read gives the same bytes. Keyed by thread and
// message, compressed. A copy whose thread is gone is swept away.
import { gunzipSync, gzipSync } from 'node:zlib';
import * as db from './db.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_raw (thread_id TEXT NOT NULL, message_id TEXT NOT NULL, kind TEXT NOT NULL, fp TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL, data BLOB NOT NULL, at TEXT NOT NULL, PRIMARY KEY (thread_id, message_id));
`);

const pack = (raw: Buffer) => gzipSync(raw, { level: raw.length > 1_000_000 ? 1 : 6 });
const now = () => new Date().toISOString();

/** Lines end in CRLF, as IMAP and SMTP want them (a bare LF becomes CRLF). */
export function crlf(raw: Buffer): Buffer {
  let bare = false;
  for (let i = 0; i < raw.length; i++) if (raw[i] === 10 && (i === 0 || raw[i - 1] !== 13)) (bare = true), (i = raw.length);
  if (!bare) return raw;
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 10 && (i === 0 || raw[i - 1] !== 13)) out.push(13);
    out.push(raw[i]);
  }
  return Buffer.from(out);
}

/**
 * Keeps the source of a message as it was received or sent. The first one kept stays (a message's bytes never change
 * once a mail app may have read them); it replaces a rebuilt copy.
 */
export function keepRaw(threadId: string, messageId: string, raw: Buffer) {
  if (!threadId || !messageId || !raw?.length) return;
  const have = db.db.prepare('SELECT kind FROM mail_raw WHERE thread_id = ? AND message_id = ?').get(threadId, messageId) as { kind: string } | undefined;
  if (have?.kind === 'raw') return;
  const data = crlf(raw);
  db.db.prepare('INSERT INTO mail_raw (thread_id, message_id, kind, fp, size, data, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (thread_id, message_id) DO UPDATE SET kind = excluded.kind, fp = excluded.fp, size = excluded.size, data = excluded.data, at = excluded.at').run(threadId, messageId, 'raw', '', data.length, pack(data), now());
}

/** Keeps a rebuilt copy (`fp` says what it was built from), unless the real source is there. */
export function keepBuilt(threadId: string, messageId: string, fp: string, raw: Buffer) {
  const data = crlf(raw);
  db.db.prepare("INSERT INTO mail_raw (thread_id, message_id, kind, fp, size, data, at) VALUES (?, ?, 'built', ?, ?, ?, ?) ON CONFLICT (thread_id, message_id) DO UPDATE SET fp = excluded.fp, size = excluded.size, data = excluded.data, at = excluded.at WHERE mail_raw.kind = 'built'").run(threadId, messageId, fp, data.length, pack(data), now());
}

export function rawOf(threadId: string, messageId: string): { kind: 'raw' | 'built'; fp: string; size: number; data: Buffer } | null {
  const r = db.db.prepare('SELECT kind, fp, size, data FROM mail_raw WHERE thread_id = ? AND message_id = ?').get(threadId, messageId) as { kind: 'raw' | 'built'; fp: string; size: number; data: Uint8Array } | undefined;
  if (!r) return null;
  try {
    return { kind: r.kind, fp: r.fp, size: r.size, data: gunzipSync(r.data) };
  } catch {
    return null;
  }
}

/** Which messages of these threads have their real source kept (as `threadId message`). */
export function rawKeys(threadIds: string[]): Set<string> {
  const out = new Set<string>();
  const q = db.db.prepare("SELECT message_id FROM mail_raw WHERE thread_id = ? AND kind = 'raw'");
  for (const t of threadIds) for (const r of q.all(t) as { message_id: string }[]) out.add(`${t} ${r.message_id}`);
  return out;
}

/** Sizes of what's kept, for RFC822.SIZE without unpacking (`threadId message` to bytes). */
export function sizes(threadIds: string[]): Map<string, { kind: string; fp: string; size: number }> {
  const out = new Map<string, { kind: string; fp: string; size: number }>();
  const q = db.db.prepare('SELECT message_id, kind, fp, size FROM mail_raw WHERE thread_id = ?');
  for (const t of threadIds) for (const r of q.all(t) as { message_id: string; kind: string; fp: string; size: number }[]) out.set(`${t} ${r.message_id}`, { kind: r.kind, fp: r.fp, size: r.size });
  return out;
}

/** Copies whose thread or message is gone (deleted for good, a company removed). Fresh ones wait: the app may save the thread a moment after the mail engine kept its source. */
export function sweep() {
  const rows = db.db.prepare('SELECT thread_id, message_id FROM mail_raw WHERE at < ?').all(new Date(Date.now() - 3600_000).toISOString()) as { thread_id: string; message_id: string }[];
  const byThread = new Map<string, string[]>();
  for (const r of rows) (byThread.get(r.thread_id) ?? byThread.set(r.thread_id, []).get(r.thread_id)!).push(r.message_id);
  const del = db.db.prepare('DELETE FROM mail_raw WHERE thread_id = ? AND message_id = ?');
  let n = 0;
  for (const [tid, mids] of byThread) {
    const t = db.getDoc('threads', tid) as { messages?: { id: string }[] } | undefined;
    const have = new Set((t?.messages ?? []).map((m) => m.id));
    for (const mid of mids) if (!have.has(mid)) (del.run(tid, mid), n++);
  }
  return n;
}
