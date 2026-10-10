// What mail really takes (it counts toward the company's storage, with Drive): each email's kept source
// (server/mailRaw.ts, compressed as stored), the conversation as the app keeps it, and its attachments (the company's
// files, already counted with the files). Measured per mailbox, for the company's storage and for Settings, Mail
// storage, where people see their largest emails and attachments, Spam and Trash, and clean up (like Google's storage
// manager). Cached for a minute: it reads every conversation.
import * as db from './db.ts';

const CACHE_MS = 60_000;
let cache: { at: number; byAccount: Map<string, { messages: number; threads: number }> } | null = null;

/** Bytes per mailbox: the kept sources and the conversations themselves (attachments are files, counted there). */
function measure() {
  if (cache && cache.at > Date.now() - CACHE_MS) return cache.byAccount;
  const byAccount = new Map<string, { messages: number; threads: number }>();
  for (const r of db.db.prepare("SELECT json_extract(data, '$.accountId') AS acc, length(data) AS n FROM docs WHERE coll = 'threads'").all() as { acc: string | null; n: number }[]) {
    if (!r.acc) continue;
    const x = byAccount.get(r.acc) ?? { messages: 0, threads: 0 };
    x.threads += r.n;
    byAccount.set(r.acc, x);
  }
  for (const r of db.db.prepare("SELECT json_extract(d.data, '$.accountId') AS acc, SUM(length(r.data)) AS n FROM mail_raw r JOIN docs d ON d.coll = 'threads' AND d.id = r.thread_id GROUP BY acc").all() as { acc: string | null; n: number }[]) {
    if (!r.acc) continue;
    const x = byAccount.get(r.acc) ?? { messages: 0, threads: 0 };
    x.messages += r.n;
    byAccount.set(r.acc, x);
  }
  cache = { at: Date.now(), byAccount };
  return byAccount;
}
/** Forget the measurement (after a cleanup, so the numbers follow at once). */
export const changed = () => void (cache = null);

/** What a company's mail takes beyond its attachments (which are files, counted with Drive's), in bytes. */
export function mailBytes(ws: { accounts?: { id: string }[] } | undefined | null) {
  const m = measure();
  return (ws?.accounts ?? []).reduce((n, a) => n + (m.get(a.id)?.messages ?? 0) + (m.get(a.id)?.threads ?? 0), 0);
}

const SIZE_RE = /^([\d.]+)\s*(B|KB|MB|GB)$/i;
const parseSize = (s: unknown) => {
  const m = SIZE_RE.exec(String(s ?? '').trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return Math.round(n * ({ b: 1, kb: 1e3, mb: 1e6, gb: 1e9 } as Record<string, number>)[m[2].toLowerCase()]);
};
/** The real size of an attachment: its file when it's one of ours, else what the email said. */
const fileSize = (url: string | undefined, said: unknown) => {
  const id = /^\/api\/files\/([a-f0-9]{32})$/.exec(url ?? '')?.[1];
  const f = id ? db.fileInfo(id) : null;
  return f ? f.size : parseSize(said);
};

export interface StorageReport {
  mailboxes: { id: string; email: string; bytes: number; attachments: number }[];
  total: number;
  largest: { threadId: string; accountId: string; subject: string; from: string; date: string; bytes: number; location: string }[];
  attachments: { threadId: string; accountId: string; name: string; bytes: number; subject: string; date: string }[];
  spam: { count: number; bytes: number };
  trash: { count: number; bytes: number };
}

/** One person's mail in a company: their mailboxes' sizes, the biggest emails and attachments, Spam and Trash. */
export function report(accounts: { id: string; email: string }[]): StorageReport {
  const m = measure();
  const rawSize = db.db.prepare('SELECT SUM(length(data)) AS n FROM mail_raw WHERE thread_id = ?');
  const out: StorageReport = { mailboxes: [], total: 0, largest: [], attachments: [], spam: { count: 0, bytes: 0 }, trash: { count: 0, bytes: 0 } };
  for (const a of accounts) {
    let att = 0;
    for (const r of db.db.prepare("SELECT id, data, length(data) AS n FROM docs WHERE coll = 'threads' AND json_extract(data, '$.accountId') = ?").all(a.id) as { id: string; data: string; n: number }[]) {
      const t = JSON.parse(r.data);
      let files = 0;
      const last = (t.messages ?? []).at(-1);
      for (const msg of t.messages ?? [])
        for (const f of msg.attachments ?? []) {
          const b = fileSize(f.url, f.size);
          files += b;
          if (b >= 100_000) out.attachments.push({ threadId: t.id, accountId: a.id, name: String(f.name ?? 'file'), bytes: b, subject: String(t.subject ?? ''), date: String(msg.date ?? '') });
        }
      att += files;
      const bytes = r.n + Number((rawSize.get(t.id) as { n: number | null })?.n ?? 0) + files;
      out.largest.push({ threadId: t.id, accountId: a.id, subject: String(t.subject ?? ''), from: String(last?.from?.name || last?.from?.email || ''), date: String(last?.date ?? ''), bytes, location: String(t.location) });
      if (t.location === 'spam') (out.spam.count++, (out.spam.bytes += bytes));
      if (t.location === 'trash') (out.trash.count++, (out.trash.bytes += bytes));
    }
    const own = (m.get(a.id)?.messages ?? 0) + (m.get(a.id)?.threads ?? 0);
    out.mailboxes.push({ id: a.id, email: a.email, bytes: own + att, attachments: att });
    out.total += own + att;
  }
  out.largest = out.largest.sort((x, y) => y.bytes - x.bytes).slice(0, 40);
  out.attachments = out.attachments.sort((x, y) => y.bytes - x.bytes).slice(0, 40);
  return out;
}
