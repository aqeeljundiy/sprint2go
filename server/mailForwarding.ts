// Forwarding (Settings, Mailbox access): all mail of a mailbox goes on to another address, as Gmail does it.
//  - The address is added first and proved with a 6-digit code sent to it (valid 30 minutes, 5 tries), so nobody can
//    forward someone's mail to an address that didn't agree, or flood a stranger.
//  - Then forwarding is switched on for one verified address, with what happens to the copy here: kept, marked read,
//    archived (Done) or moved to Trash.
//  - Admins can block forwarding outside the company (Settings, Mail retention & rules): then only addresses at the
//    company's own domains work, and forwarding to anywhere else stops at once (nothing is deleted).
//  - Spam isn't forwarded, mail that already went through this mailbox's forwarding isn't sent round again, and at
//    most 500 a day leave per mailbox. Every change is in the mail log.
// Filters (server/mailFilters.ts) forward one email with `forwardMessage`, to a verified address, under the same rules.
import { createHash, randomInt } from 'node:crypto';
import * as db from './db.ts';
import * as audit from './mailAudit.ts';
import { policyOf } from './mailCompliance.ts';
import { mark } from '../src/i18n/index.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_fwd_addresses (account_id TEXT NOT NULL, address TEXT NOT NULL, workspace_id TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, verified_at TEXT, code_hash TEXT, code_until TEXT, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, address));
  CREATE TABLE IF NOT EXISTS mail_fwd (account_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, address TEXT NOT NULL, on_ INTEGER NOT NULL, keep TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL);
`);

export type Keep = 'keep' | 'read' | 'archive' | 'trash';
export const KEEPS: Keep[] = ['keep', 'read', 'archive', 'trash'];
const CODE_MINUTES = 30;
const MAX_TRIES = 5;
const DAILY = 500;
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const now = () => new Date().toISOString();
const hash = (accountId: string, address: string, code: string) => createHash('sha256').update(`${accountId}\n${address}\n${code}`).digest('hex');
export const validAddress = (s: string) => /^[^\s@<>"(),;:]{1,64}@[a-z0-9.-]{1,200}\.[a-z]{2,}$/i.test(s);

export interface Deps {
  /** Sends the code (a plain note from sprint2go). Returns false when this server can't send mail. */
  sendCode: (to: string, mailbox: string, code: string) => Promise<boolean>;
  /** Queues a message from a mailbox to one outside address (mailer.queueRaw). */
  queueRaw: (o: { workspaceId: string; accountId: string; from: string; to: string; raw: Buffer; tag: string }) => Promise<string>;
  /** Our own addresses: forwarding to one of them is delivered here instead (the engine does that), so it's allowed. */
  isLocal: (address: string) => boolean;
  log: (line: string) => void;
}
let deps: Deps;
export const init = (d: Deps) => void (deps = d);

type Ws = { id: string; name?: string; domains?: string[]; accounts?: { id: string; email?: string }[]; mailPolicy?: any };

/** Whether forwarding to this address is allowed by the company (outside the company only when it allows that). */
export function allowedByPolicy(ws: Ws, address: string) {
  if (policyOf(ws).forwardOutside !== false) return true;
  const d = lower(address).split('@')[1] ?? '';
  return (ws.domains ?? []).map(lower).includes(d);
}

/* ---------- reading ---------- */

export interface FwdState {
  addresses: { address: string; verified: boolean; addedAt: string; waiting: boolean }[];
  on: boolean;
  address: string | null;
  keep: Keep;
  blocked: boolean; // on, but the company now blocks this address
}
export function stateOf(ws: Ws, accountId: string): FwdState {
  const addrs = db.db.prepare('SELECT address, verified_at, added_at, code_until FROM mail_fwd_addresses WHERE account_id = ? ORDER BY added_at').all(accountId) as { address: string; verified_at: string | null; added_at: string; code_until: string | null }[];
  const f = db.db.prepare('SELECT * FROM mail_fwd WHERE account_id = ?').get(accountId) as { address: string; on_: number; keep: Keep } | undefined;
  return {
    addresses: addrs.map((a) => ({ address: a.address, verified: !!a.verified_at, addedAt: a.added_at, waiting: !a.verified_at && !!a.code_until && a.code_until > now() })),
    on: !!f?.on_,
    address: f?.address ?? null,
    keep: f?.keep ?? 'keep',
    blocked: !!f?.on_ && !allowedByPolicy(ws, f.address),
  };
}
const verified = (accountId: string, address: string) => !!(db.db.prepare('SELECT verified_at FROM mail_fwd_addresses WHERE account_id = ? AND address = ?').get(accountId, lower(address)) as { verified_at: string | null } | undefined)?.verified_at;

/* ---------- changing ---------- */

export class FwdError extends Error {}

/** Adds an address (or asks again) and sends it a code. */
export async function addAddress(ws: Ws, accountId: string, address: string, me: string) {
  const a = lower(address);
  const box = (ws.accounts ?? []).find((x) => x.id === accountId);
  if (!validAddress(a)) throw new FwdError(mark('That isn’t an email address.'));
  if (lower(box?.email) === a) throw new FwdError(mark('That’s this mailbox’s own address.'));
  if (!allowedByPolicy(ws, a)) throw new FwdError(mark('Your company only allows forwarding to its own addresses.'));
  const had = db.db.prepare('SELECT verified_at, code_until FROM mail_fwd_addresses WHERE account_id = ? AND address = ?').get(accountId, a) as { verified_at: string | null; code_until: string | null } | undefined;
  if (had?.verified_at) return { sent: false, verified: true };
  const count = (db.db.prepare('SELECT COUNT(*) AS n FROM mail_fwd_addresses WHERE account_id = ?').get(accountId) as { n: number }).n;
  if (!had && count >= 10) throw new FwdError(mark('A mailbox can have up to 10 forwarding addresses. Remove one first.'));
  // A new code at most once a minute.
  if (had?.code_until && Date.parse(had.code_until) - CODE_MINUTES * 60_000 > Date.now() - 60_000) throw new FwdError(mark('A code was just sent. Wait a minute before asking for another.'));
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const until = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  db.db.prepare('INSERT INTO mail_fwd_addresses (account_id, address, workspace_id, added_by, added_at, code_hash, code_until, tries) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT (account_id, address) DO UPDATE SET code_hash = excluded.code_hash, code_until = excluded.code_until, tries = 0').run(accountId, a, ws.id, me, now(), hash(accountId, a, code), until);
  const sent = await deps.sendCode(a, String(box?.email ?? ''), code).catch((e) => (deps.log(`[forwarding] code to ${a}: ${e instanceof Error ? e.message : e}`), false));
  if (!sent) deps.log(`[forwarding] this server can't send mail: the code for ${a} is ${code}`);
  audit.log(ws.id, me, 'forward.address-add', accountId, `${a}: code sent`);
  return { sent, verified: false };
}

/** The code from the email: right, and in time. */
export function verify(ws: Ws, accountId: string, address: string, code: string, me: string) {
  const a = lower(address);
  const r = db.db.prepare('SELECT code_hash, code_until, tries, verified_at FROM mail_fwd_addresses WHERE account_id = ? AND address = ?').get(accountId, a) as { code_hash: string | null; code_until: string | null; tries: number; verified_at: string | null } | undefined;
  if (!r) throw new FwdError(mark('Add the address first.'));
  if (r.verified_at) return true;
  if (!r.code_hash || !r.code_until || r.code_until < now()) throw new FwdError(mark('That code has run out. Send a new one.'));
  if (r.tries >= MAX_TRIES) throw new FwdError(mark('Too many wrong codes. Send a new one.'));
  const clean = String(code ?? '').replace(/\D/g, '');
  if (hash(accountId, a, clean) !== r.code_hash) {
    db.db.prepare('UPDATE mail_fwd_addresses SET tries = tries + 1 WHERE account_id = ? AND address = ?').run(accountId, a);
    throw new FwdError(mark('That code isn’t right. Check the email and try again.'));
  }
  db.db.prepare('UPDATE mail_fwd_addresses SET verified_at = ?, code_hash = NULL, code_until = NULL WHERE account_id = ? AND address = ?').run(now(), accountId, a);
  audit.log(ws.id, me, 'forward.address-verified', accountId, a);
  return true;
}

export function removeAddress(ws: Ws, accountId: string, address: string, me: string) {
  const a = lower(address);
  db.db.prepare('DELETE FROM mail_fwd_addresses WHERE account_id = ? AND address = ?').run(accountId, a);
  const f = db.db.prepare('SELECT address, on_ FROM mail_fwd WHERE account_id = ?').get(accountId) as { address: string; on_: number } | undefined;
  if (f?.address === a) db.db.prepare('DELETE FROM mail_fwd WHERE account_id = ?').run(accountId);
  audit.log(ws.id, me, 'forward.address-remove', accountId, `${a}${f?.address === a && f.on_ ? ' (forwarding stopped)' : ''}`);
}

/** Forwarding on (to a verified address, with what happens to the copy here) or off. */
export function setForwarding(ws: Ws, accountId: string, o: { on: boolean; address?: string; keep?: string }, me: string) {
  const keep: Keep = KEEPS.includes(o.keep as Keep) ? (o.keep as Keep) : 'keep';
  if (!o.on) {
    const had = db.db.prepare('SELECT on_ FROM mail_fwd WHERE account_id = ?').get(accountId) as { on_: number } | undefined;
    db.db.prepare('UPDATE mail_fwd SET on_ = 0, updated_by = ?, updated_at = ? WHERE account_id = ?').run(me, now(), accountId);
    if (had?.on_) audit.log(ws.id, me, 'forward.off', accountId);
    return;
  }
  const a = lower(o.address);
  if (!verified(accountId, a)) throw new FwdError(mark('Confirm the address with its code first.'));
  if (!allowedByPolicy(ws, a)) throw new FwdError(mark('Your company only allows forwarding to its own addresses.'));
  db.db.prepare('INSERT INTO mail_fwd (account_id, workspace_id, address, on_, keep, updated_by, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET address = excluded.address, on_ = 1, keep = excluded.keep, updated_by = excluded.updated_by, updated_at = excluded.updated_at').run(accountId, ws.id, a, keep, me, now());
  audit.log(ws.id, me, 'forward.on', accountId, `to ${a}, copy here: ${keep}`);
}

/* ---------- forwarding mail ---------- */

const sentToday = (accountId: string) => (db.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE account_id = ? AND message_id LIKE 'auto-fwd-%' AND created_at >= ?").get(accountId, new Date(Date.now() - 86_400_000).toISOString()) as { n: number }).n;
/** Mail this mailbox already forwarded (a loop between two forwarding mailboxes) carries this header with its address. */
const LOOP = 'X-sprint2go-Forwarded';

/**
 * One email, as it arrived, on to `to` from this mailbox. The original headers stay (From, Subject, Message-ID), with
 * a header saying it was forwarded, so replies go to the person who wrote it.
 */
export async function forwardMessage(o: { workspaceId: string; accountId: string; to: string; raw: Buffer; by?: string; threadId?: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  const ws = db.getDoc('workspaces', o.workspaceId) as unknown as Ws | undefined;
  const box = ws?.accounts?.find((a) => a.id === o.accountId);
  const to = lower(o.to);
  if (!ws || !box?.email) return { ok: false, why: 'No such mailbox.' };
  if (!verified(o.accountId, to)) return { ok: false, why: 'Forwarding needs an address confirmed with its code (Settings, Mailbox access).' };
  if (!allowedByPolicy(ws, to)) return { ok: false, why: 'Your company only allows forwarding to its own addresses.' };
  const head = o.raw.subarray(0, Math.min(o.raw.length, 64 * 1024)).toString('latin1');
  const seen = [...head.matchAll(new RegExp(`^${LOOP}:\\s*(.+)$`, 'gim'))].map((m) => lower(m[1]));
  if (seen.includes(lower(box.email))) return { ok: false, why: 'It already went through this mailbox’s forwarding.' };
  if (seen.length >= 5) return { ok: false, why: 'It has been forwarded too many times.' };
  if (sentToday(o.accountId) >= DAILY) return { ok: false, why: `This mailbox forwarded ${DAILY} emails today, the most in a day.` };
  const raw = Buffer.concat([Buffer.from(`${LOOP}: ${lower(box.email)}\r\nX-Forwarded-For: ${lower(box.email)} ${to}\r\nX-Forwarded-To: ${to}\r\n`, 'latin1'), o.raw]);
  try {
    await deps.queueRaw({ workspaceId: ws.id, accountId: o.accountId, from: lower(box.email), to, raw, tag: `auto-fwd-${Date.now().toString(36)}` });
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : 'It couldn’t be forwarded.' };
  }
}

/**
 * The mail engine's hook (mailer.onDelivered): an email just arrived for a mailbox. When forwarding is on, a copy goes
 * on, and the thread changes as the person chose. Returns the change for the thread, or null.
 */
export function onDelivered(d: { ws: any; account: any; threadId: string; raw: Buffer }): Record<string, unknown> | null {
  const f = db.db.prepare('SELECT address, on_, keep FROM mail_fwd WHERE account_id = ?').get(d.account.id) as { address: string; on_: number; keep: Keep } | undefined;
  if (!f?.on_ || !allowedByPolicy(d.ws, f.address)) return null;
  // The copy here only changes when the email really goes on.
  const head = d.raw.subarray(0, Math.min(d.raw.length, 64 * 1024)).toString('latin1');
  if (new RegExp(`^${LOOP}:\\s*${lower(d.account.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im').test(head)) return null;
  void forwardMessage({ workspaceId: d.ws.id, accountId: d.account.id, to: f.address, raw: d.raw, threadId: d.threadId }).then((r) => {
    if (!r.ok) deps.log(`[forwarding] ${d.account.email} to ${f.address}: ${r.why}`);
  });
  return f.keep === 'read' ? { unread: false } : f.keep === 'archive' ? { location: 'archive' } : f.keep === 'trash' ? { location: 'trash', unread: false } : null;
}

/** A mailbox removed: its forwarding goes with it. */
export function forget(accountId: string) {
  db.db.prepare('DELETE FROM mail_fwd WHERE account_id = ?').run(accountId);
  db.db.prepare('DELETE FROM mail_fwd_addresses WHERE account_id = ?').run(accountId);
}
