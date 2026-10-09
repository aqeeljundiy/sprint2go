// Out of office: a mailbox's automatic answer (RFC 3834). Sent once per sender every 4 days, never to mailing lists,
// bulk mail, no-reply addresses, other robots or itself, and only from a mailbox that can really send.
import type { ParsedMail } from 'mailparser';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { t } from '../src/i18n/index.ts';
import { forUser } from './lang.ts';

db.db.exec(`CREATE TABLE IF NOT EXISTS mail_away_log (account_id TEXT NOT NULL, sender TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (account_id, sender));`);

export const AWAY_EVERY_MS = 4 * 86_400_000;
export interface Away {
  on: boolean;
  fromAt?: string;
  untilAt?: string;
  subject: string;
  message: string;
  since?: string;
}
type Account = { id: string; email: string; name: string; provider?: string; away?: Away; users?: string[] };
type Send = (o: {
  workspaceId: string;
  accountId: string;
  threadId: string;
  messageId: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  subject: string;
  text: string;
  files: { name: string; url: string }[];
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
}) => Promise<unknown>;

/** Whether the answer is on right now. */
export const awayNow = (a: Away | undefined, now = Date.now()) => !!a?.on && (!a.fromAt || Date.parse(a.fromAt) <= now) && (!a.untilAt || Date.parse(a.untilAt) >= now) && !!a.message.trim();

const ROBOT = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|automated|auto-?confirm|daemon)([+._=-]|$)/i;
const header = (parsed: ParsedMail, key: string) => {
  const v = parsed.headers.get(key);
  return v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.join(',') : typeof v === 'object' && 'value' in (v as object) ? String((v as { value: unknown }).value) : String(v);
};

/** Why this email gets no automatic answer, or null when it should get one. */
export function skipReason(parsed: ParsedMail, envelopeFrom: string, mailbox: string, spam: boolean): string | null {
  if (spam) return 'spam';
  const sender = envelopeFrom.trim().toLowerCase();
  if (!sender || !sender.includes('@')) return 'no return address';
  const from = (parsed.from?.value?.[0]?.address ?? '').toLowerCase();
  if (sender === mailbox || from === mailbox) return 'itself';
  if (ROBOT.test(sender.split('@')[0]) || ROBOT.test(from.split('@')[0])) return 'a robot address';
  const auto = header(parsed, 'auto-submitted').toLowerCase();
  if (auto && auto !== 'no') return 'automatic mail';
  if (/^(bulk|list|junk|auto_reply)$/i.test(header(parsed, 'precedence').trim())) return 'bulk mail';
  if (parsed.headers.has('list') || parsed.headerLines.some((h) => h.key === 'list-id' || h.key === 'list-unsubscribe' || h.key === 'list-post')) return 'a mailing list';
  if (/\b(oof|all|autoreply)\b/i.test(header(parsed, 'x-auto-response-suppress'))) return 'asked not to';
  if (parsed.headerLines.some((h) => h.key === 'x-autoreply' || h.key === 'x-autorespond' || h.key === 'x-auto-reply')) return 'automatic mail';
  return null;
}

/** Sends the mailbox's answer to whoever wrote, when it's on and they haven't had it in 4 days. */
export async function maybeAnswer(o: { workspaceId: string; account: Account; canSend: boolean; parsed: ParsedMail; envelopeFrom: string; mid: string; refs: string[]; spam: boolean; send: Send; log: (l: string) => void }) {
  const away = o.account.away;
  if (!awayNow(away) || !o.canSend) return;
  if (o.account.provider && o.account.provider !== 'sprint2go') return;
  const why = skipReason(o.parsed, o.envelopeFrom, o.account.email.toLowerCase(), o.spam);
  if (why) return;
  const sender = o.envelopeFrom.trim().toLowerCase();
  const last = db.db.prepare('SELECT at FROM mail_away_log WHERE account_id = ? AND sender = ?').get(o.account.id, sender) as { at: string } | undefined;
  if (last && Date.parse(last.at) > Date.now() - AWAY_EVERY_MS && (!away!.since || last.at >= away!.since)) return;
  db.db.prepare('INSERT OR REPLACE INTO mail_away_log (account_id, sender, at) VALUES (?, ?, ?)').run(o.account.id, sender, new Date().toISOString());
  // Their own subject as they wrote it; else ours, in the mailbox owner's language (theirs, else the company's).
  const about = (o.parsed.subject ?? '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim();
  const subject = away!.subject.trim() || forUser(o.account.users?.[0], o.workspaceId, () => (about ? t('Out of office: {subject}', { subject: about }) : t('Out of office: your email')));
  try {
    await o.send({
      workspaceId: o.workspaceId,
      accountId: o.account.id,
      threadId: '',
      messageId: 'auto-' + randomBytes(6).toString('hex'),
      from: { name: o.account.name, email: o.account.email.toLowerCase() },
      to: [{ name: o.parsed.from?.value?.[0]?.name ?? '', email: sender }],
      cc: [],
      subject,
      text: away!.message,
      files: [],
      inReplyTo: o.mid,
      references: [...o.refs, o.mid].slice(-20),
      headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
    });
  } catch (e) {
    o.log(`[mail] out of office for ${o.account.email} not sent: ${e instanceof Error ? e.message : e}`);
  }
}
