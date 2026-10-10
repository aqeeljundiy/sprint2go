// Delegation (Settings, Mailbox access): someone gives a teammate access to their own mailbox, as in Gmail. The
// teammate reads it, answers and sends from it, and picks it in the mailbox switcher. Sending shows as the mailbox
// itself ('as'), or as "sent by the teammate on behalf of" the owner ('behalf': a Sender header, which Gmail and
// Outlook show that way). The owner (or an admin) takes it back at any time; every grant, change, removal and every
// email a delegate sends is in the mail log.
// Delegates live on the account (`delegates`), set only here: a sync can't add or change them.
import * as audit from './mailAudit.ts';
import { mark } from '../src/i18n/index.ts';

export type SendMode = 'as' | 'behalf';
export interface Delegate {
  userId: string;
  send: SendMode;
  by: string;
  at: string;
}
type Account = { id: string; email?: string; name?: string; kind?: string; users?: string[]; provider?: string; temp?: unknown; groupId?: string; delegates?: Delegate[] };
type Ws = { id: string; members: { userId: string; role: string }[]; accounts?: Account[] };

export const delegatesOf = (a: Account | undefined | null): Delegate[] => (Array.isArray(a?.delegates) ? a!.delegates!.filter((d) => d && typeof d.userId === 'string') : []);
export const delegateOf = (a: Account | undefined | null, userId: string) => delegatesOf(a).find((d) => d.userId === userId);
/** Everyone who opens a mailbox: its own people and its delegates. */
export const openersOf = (a: Account | undefined | null) => [...new Set([...(a?.users ?? []), ...delegatesOf(a).map((d) => d.userId)])];

/** A mailbox that can be delegated: someone's own, hosted here, not a temporary address. */
export const delegable = (a: Account | undefined | null) => !!a && a.kind === 'personal' && !a.temp && (!a.provider || a.provider === 'sprint2go');
/** Who may give access to a mailbox: the people whose mailbox it is, and the company's admins. */
export const mayManage = (ws: Ws, a: Account, me: string) => (a.users ?? []).includes(me) || ws.members.some((m) => m.userId === me && m.role !== 'member');

export class DelegationError extends Error {}

/**
 * The mailbox's new delegates, checked: people of the company who aren't already on the mailbox, at most 25. Who gave
 * access and when stay as they were for someone already there. Returns the account and the lines for the mail log.
 */
export function setDelegates(ws: Ws, accountId: string, asked: unknown, me: string, now = new Date().toISOString()): { account: Account; changes: { action: string; detail: string }[] } {
  const a = (ws.accounts ?? []).find((x) => x.id === accountId);
  if (!a || !delegable(a)) throw new DelegationError(mark('Only someone’s own mailbox can be shared this way. Shared inboxes have their own people.'));
  if (!mayManage(ws, a, me)) throw new DelegationError(mark('Only the mailbox’s owner or an admin can give access to it.'));
  const members = new Set(ws.members.map((m) => m.userId));
  const before = delegatesOf(a);
  const out: Delegate[] = [];
  for (const d of (Array.isArray(asked) ? asked : []).slice(0, 25) as any[]) {
    const userId = String(d?.userId ?? '');
    if (!members.has(userId) || (a.users ?? []).includes(userId) || out.some((x) => x.userId === userId)) continue;
    const send: SendMode = d?.send === 'behalf' ? 'behalf' : 'as';
    const old = before.find((x) => x.userId === userId);
    out.push(old ? { ...old, send } : { userId, send, by: me, at: now });
  }
  const changes: { action: string; detail: string }[] = [];
  for (const d of out) {
    const old = before.find((x) => x.userId === d.userId);
    if (!old) changes.push({ action: 'delegate.grant', detail: `${d.userId} can read and send from ${a.email} (${d.send === 'behalf' ? 'on behalf of the owner' : 'as the mailbox'})` });
    else if (old.send !== d.send) changes.push({ action: 'delegate.change', detail: `${d.userId} now sends ${d.send === 'behalf' ? 'on behalf of the owner' : 'as the mailbox'}` });
  }
  for (const d of before) if (!out.some((x) => x.userId === d.userId)) changes.push({ action: 'delegate.revoke', detail: `${d.userId} no longer opens ${a.email}` });
  return { account: { ...a, delegates: out.length ? out : undefined }, changes };
}

/** Logs the changes (the caller saved the company). */
export const logChanges = (wsId: string, accountId: string, me: string, changes: { action: string; detail: string }[]) => changes.forEach((c) => audit.log(wsId, me, c.action, accountId, c.detail));

/** A sync of the company keeps the delegates (and a shared inbox's group) as the server has them. */
export function keepServerFields(accounts: unknown, before: Account[] | undefined): unknown {
  if (!Array.isArray(accounts)) return accounts;
  return accounts.map((a: any) => {
    if (!a || typeof a !== 'object') return a;
    const b = (before ?? []).find((x) => x.id === a.id);
    const { delegates: _d, groupId: _g, ...rest } = a;
    return { ...rest, ...(b?.delegates ? { delegates: b.delegates } : {}), ...(b?.groupId ? { groupId: b.groupId } : {}) };
  });
}

/** Someone who left the company stops being anyone's delegate. Returns the accounts, changed or not. */
export function dropLeavers(ws: Ws): { accounts: Account[]; changed: boolean } {
  const members = new Set(ws.members.map((m) => m.userId));
  let changed = false;
  const accounts = (ws.accounts ?? []).map((a) => {
    const list = delegatesOf(a);
    const keep = list.filter((d) => members.has(d.userId));
    if (keep.length === list.length) return a;
    changed = true;
    return { ...a, delegates: keep.length ? keep : undefined };
  });
  return { accounts, changed };
}
