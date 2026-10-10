// Forwarding all mail of a mailbox (Settings, Mailbox access), as Gmail does it. One forwarding system with filters
// (server/mailFilters.ts): the same forwarding addresses, confirmed once by the link they're emailed (or ready at once
// when they're the company's own), and the same company rule (Settings, Mail: "Automatic forwarding": off, company
// only, or confirmed addresses). This file adds only the mailbox's own switch: forward everything that arrives to one
// confirmed address, and what happens to the copy here (kept, marked read, archived or moved to Trash).
//  - Spam isn't forwarded; mail that already went through this mailbox (X-S2G-Forwarded, the header filters use too)
//    isn't sent round again; at most 500 a day leave per mailbox. Every change is in the mail log.
//  - A rule that changes (forwarding switched off, or company only) stops it at once; nothing is deleted.
import * as db from './db.ts';
import * as audit from './mailAudit.ts';
import { forwardWhy } from './mailFilters.ts';
import { mark } from '../src/i18n/index.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_fwd (account_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, address TEXT NOT NULL, on_ INTEGER NOT NULL, keep TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL);
`);

export type Keep = 'keep' | 'read' | 'archive' | 'trash';
export const KEEPS: Keep[] = ['keep', 'read', 'archive', 'trash'];
const DAILY = 500;
const LOOP = 'X-S2G-Forwarded';
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const now = () => new Date().toISOString();

export interface Deps {
  /** Queues a message from a mailbox to one outside address (mailer.queueRaw). */
  queueRaw: (o: { workspaceId: string; accountId: string; from: string; to: string; raw: Buffer; tag: string }) => Promise<string>;
  log: (line: string) => void;
}
let deps: Deps;
export const init = (d: Deps) => void (deps = d);

type Ws = { id: string; name?: string; domains?: string[]; members: { userId: string; role: string }[]; accounts?: { id: string; email?: string }[]; mailForwarding?: 'off' | 'company' | 'verified' };

/** Why this mailbox can't forward to this address now (the company rule, a confirmation still missing), or null. */
export const blockedWhy = (ws: Ws, accountId: string, address: string) => forwardWhy(ws as any, accountId, address);

/* ---------- reading ---------- */

export interface FwdState {
  addresses: { address: string; verified: boolean; addedAt: string }[];
  on: boolean;
  address: string | null;
  keep: Keep;
  blocked: boolean; // on, but the company rule (or a removed address) stops it now
  policy: 'off' | 'company' | 'verified';
}
export function stateOf(ws: Ws, accountId: string): FwdState {
  const addrs = db.db.prepare('SELECT address, verified_at, asked_at FROM mail_forward_addrs WHERE account_id = ? ORDER BY asked_at').all(accountId) as { address: string; verified_at: string | null; asked_at: string }[];
  const f = db.db.prepare('SELECT * FROM mail_fwd WHERE account_id = ?').get(accountId) as { address: string; on_: number; keep: Keep } | undefined;
  const policy = ws.mailForwarding === 'off' || ws.mailForwarding === 'company' ? ws.mailForwarding : 'verified';
  return {
    addresses: addrs.map((a) => ({ address: a.address, verified: !blockedWhy(ws, accountId, a.address), addedAt: a.asked_at })),
    on: !!f?.on_,
    address: f?.address ?? null,
    keep: f?.keep ?? 'keep',
    blocked: !!f?.on_ && !!blockedWhy(ws, accountId, f.address),
    policy,
  };
}

/* ---------- changing ---------- */

export class FwdError extends Error {}

/** Forwarding on (to a confirmed address, with what happens to the copy here) or off. */
export function setForwarding(ws: Ws, accountId: string, o: { on: boolean; address?: string; keep?: string }, me: string) {
  const keep: Keep = KEEPS.includes(o.keep as Keep) ? (o.keep as Keep) : 'keep';
  if (!o.on) {
    const had = db.db.prepare('SELECT on_ FROM mail_fwd WHERE account_id = ?').get(accountId) as { on_: number } | undefined;
    db.db.prepare('UPDATE mail_fwd SET on_ = 0, updated_by = ?, updated_at = ? WHERE account_id = ?').run(me, now(), accountId);
    if (had?.on_) audit.log(ws.id, me, 'forward.off', accountId);
    return;
  }
  const a = lower(o.address);
  const why = blockedWhy(ws, accountId, a);
  if (why) throw new FwdError(why);
  db.db.prepare('INSERT INTO mail_fwd (account_id, workspace_id, address, on_, keep, updated_by, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET address = excluded.address, on_ = 1, keep = excluded.keep, updated_by = excluded.updated_by, updated_at = excluded.updated_at').run(accountId, ws.id, a, keep, me, now());
  audit.log(ws.id, me, 'forward.on', accountId, `to ${a}, copy here: ${keep}`);
}

/* ---------- forwarding mail ---------- */

const sentToday = (accountId: string) => (db.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE account_id = ? AND message_id LIKE 'auto-fwd-%' AND created_at >= ?").get(accountId, new Date(Date.now() - 86_400_000).toISOString()) as { n: number }).n;
const headOf = (raw: Buffer) => raw.subarray(0, Math.min(raw.length, 64 * 1024)).toString('latin1').split(/\r?\n\r?\n/)[0];

/**
 * One email, as it arrived, on to `to` from this mailbox, under the forwarding rules. The original headers stay
 * (From, Subject, Message-ID), so replies go to the person who wrote it.
 */
export async function forwardMessage(o: { workspaceId: string; accountId: string; to: string; raw: Buffer }): Promise<{ ok: true } | { ok: false; why: string }> {
  const ws = db.getDoc('workspaces', o.workspaceId) as unknown as Ws | undefined;
  const box = ws?.accounts?.find((a) => a.id === o.accountId);
  const to = lower(o.to);
  if (!ws || !box?.email) return { ok: false, why: mark('No such mailbox.') };
  const why = blockedWhy(ws, o.accountId, to);
  if (why) return { ok: false, why };
  const seen = [...headOf(o.raw).matchAll(new RegExp(`^${LOOP}:\\s*(.+)$`, 'gim'))].map((m) => lower(m[1]));
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
 * The mail engine's hook (mailer.onDelivered): an email just arrived for a mailbox. When forwarding is on and allowed,
 * a copy goes on, and the thread changes as the person chose. Returns the change for the thread, or null.
 */
export function onDelivered(d: { ws: any; account: any; threadId: string; raw: Buffer }): Record<string, unknown> | null {
  const f = db.db.prepare('SELECT address, on_, keep FROM mail_fwd WHERE account_id = ?').get(d.account.id) as { address: string; on_: number; keep: Keep } | undefined;
  if (!f?.on_ || blockedWhy(d.ws, d.account.id, f.address)) return null;
  if (new RegExp(`^${LOOP}:\\s*${lower(d.account.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im').test(headOf(d.raw))) return null;
  void forwardMessage({ workspaceId: d.ws.id, accountId: d.account.id, to: f.address, raw: d.raw }).then((r) => {
    if (!r.ok) deps.log(`[forwarding] ${d.account.email} to ${f.address}: ${typeof r.why === 'string' ? r.why : ''}`);
  });
  return f.keep === 'read' ? { unread: false } : f.keep === 'archive' ? { location: 'archive' } : f.keep === 'trash' ? { location: 'trash', unread: false } : null;
}

/** A mailbox removed: its forwarding goes with it (and its forwarding addresses). */
export function forget(accountId: string) {
  db.db.prepare('DELETE FROM mail_fwd WHERE account_id = ?').run(accountId);
  db.db.prepare('DELETE FROM mail_forward_addrs WHERE account_id = ?').run(accountId);
}
