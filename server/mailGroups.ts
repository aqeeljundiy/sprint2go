// Groups and collaborative inboxes (Settings, Groups & shared inboxes). An address at the company's domain, like
// sales@, that either
//  - delivers a copy to each member's own mailbox (a group, 'list'), or
//  - lands in one shared inbox the members open together, where a conversation can be given to one of them
//    ('inbox': a shared mailbox the server makes and keeps in step, `groupId` on it).
// Owners and members are people of the company; owners (and admins) change who's in it and who may post: anyone,
// only people at the company, or only its members. Mail from someone who may not post is refused when it arrives
// (550) and never delivered. Admins make and remove groups; the address is checked like an alias's.
import { randomBytes } from 'node:crypto';
import { msg, type Msg } from '../src/i18n/index.ts';

export type WhoCanPost = 'anyone' | 'company' | 'members';
export interface MailGroup {
  id: string;
  address: string;
  name: string;
  kind: 'list' | 'inbox';
  owners: string[];
  members: string[];
  whoCanPost: WhoCanPost;
  accountId?: string; // 'inbox': the shared mailbox it delivers into
  createdAt: string;
  createdBy: string;
}
type Account = { id: string; email: string; name: string; kind: string; users: string[]; provider?: string; connected?: boolean; temp?: unknown; groupId?: string };
type Ws = { id: string; name: string; domains?: string[]; accounts?: Account[]; members: { userId: string; role: string }[]; mailGroups?: MailGroup[]; mailAliases?: { address: string }[] };
type User = { id: string; email?: string };

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
export const groupsOf = (ws: Ws | undefined | null): MailGroup[] => (Array.isArray(ws?.mailGroups) ? ws!.mailGroups! : []);
export const groupForAddress = (ws: Ws | undefined | null, address: string) => groupsOf(ws).find((g) => g.address === lower(address));
export const groupOfAccount = (ws: Ws | undefined | null, accountId: string) => groupsOf(ws).find((g) => g.kind === 'inbox' && g.accountId === accountId);
const hosted = (a: Account) => !a.provider || a.provider === 'sprint2go';
export const everyone = (g: MailGroup) => [...new Set([...g.owners, ...g.members])];

/** A group's own mailboxes to deliver to: each member's personal mailbox here. */
export function listTargets(ws: Ws, g: MailGroup): Account[] {
  const people = new Set(everyone(g));
  const out: Account[] = [];
  for (const a of ws.accounts ?? []) if (a.kind === 'personal' && !a.temp && hosted(a) && a.email && a.users.some((u) => people.has(u)) && !out.some((x) => x.id === a.id)) out.push(a);
  return out;
}

/**
 * Whether someone may post to a group. `people` gives a user's sign-in email (members are known by their mailboxes
 * and sign-in addresses).
 */
export function mayPost(ws: Ws, g: MailGroup, sender: string, people: (id: string) => User | undefined): boolean {
  const from = lower(sender);
  if (g.whoCanPost === 'anyone') return true;
  if (!from) return false;
  const domain = from.split('@')[1] ?? '';
  const companyBoxes = new Set((ws.accounts ?? []).map((a) => lower(a.email)));
  if (g.whoCanPost === 'company') return (ws.domains ?? []).map(lower).includes(domain) || companyBoxes.has(from) || ws.members.some((m) => lower(people(m.userId)?.email) === from);
  const ids = new Set(everyone(g));
  return (ws.accounts ?? []).some((a) => lower(a.email) === from && a.users.some((u) => ids.has(u))) || [...ids].some((id) => lower(people(id)?.email) === from);
}
/** The same check by address: true when the address isn't a group, or the sender may post to it. */
export function mayPostTo(ws: Ws, address: string, sender: string, people: (id: string) => User | undefined) {
  const g = groupForAddress(ws, address) ?? (ws.accounts ?? []).filter((a) => lower(a.email) === lower(address)).map((a) => groupOfAccount(ws, a.id)).find(Boolean);
  return !g || mayPost(ws, g, sender, people);
}

/** A problem with what was asked, in words each reader sees in their language (`words`). */
export class GroupError extends Error {
  words: { text: string; tr?: Msg } | string;
  constructor(words: { text: string; tr?: Msg } | string) {
    super(typeof words === 'string' ? words : words.text);
    this.words = words;
  }
}

/**
 * The groups as asked, checked and merged with what's stored. Admins change anything; a group's owners only its
 * name, people and who may post. `taken(address)`: the address is already a mailbox or alias here (not this group's).
 * Returns the new list, the company's accounts with the shared inboxes kept in step, and lines for the mail log.
 */
export function save(ws: Ws, asked: unknown, me: string, admin: boolean, taken: (address: string, groupId: string) => boolean, now = new Date().toISOString()): { groups: MailGroup[]; accounts: Account[]; changes: { action: string; accountId: string | null; detail: string }[] } {
  const before = groupsOf(ws);
  const memberIds = new Set(ws.members.map((m) => m.userId));
  const domains = (ws.domains ?? []).map(lower);
  const list = Array.isArray(asked) ? asked.slice(0, 200) : [];
  const out: MailGroup[] = [];
  const changes: { action: string; accountId: string | null; detail: string }[] = [];
  let accounts = [...(ws.accounts ?? [])];
  const people = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String))].filter((id) => memberIds.has(id)).slice(0, 500);
  for (const raw of list as any[]) {
    const old = before.find((g) => g.id === raw?.id);
    if (!admin && !old) throw new GroupError('Only admins can make groups.');
    if (!admin && old && !old.owners.includes(me)) {
      out.push(old); // not theirs: as it was
      continue;
    }
    const address = admin ? lower(raw?.address) : old!.address;
    const [local, domain] = address.split('@');
    if (!/^[a-z0-9][a-z0-9._+-]{0,63}$/.test(local ?? '') || !domains.includes(domain ?? '')) throw new GroupError(domains.length ? (address ? msg('{address} isn’t an address at {domains}.', { address, domains: domains.join(' / ') }) : msg('That address isn’t an address at {domains}.', { domains: domains.join(' / ') })) : 'Add your domain under General first: a group’s address is at your domain.');
    if (out.some((g) => g.address === address) || taken(address, old?.id ?? '')) throw new GroupError(msg('{address} is already in use.', { address }));
    const kind: MailGroup['kind'] = admin ? (raw?.kind === 'inbox' ? 'inbox' : 'list') : old!.kind;
    const owners = people(raw?.owners);
    const members = people(raw?.members).filter((id) => !owners.includes(id));
    if (!owners.length) throw new GroupError(msg('Give {address} at least one owner.', { address }));
    const whoCanPost: WhoCanPost = raw?.whoCanPost === 'anyone' || raw?.whoCanPost === 'members' ? raw.whoCanPost : 'company';
    const g: MailGroup = {
      id: old?.id ?? `grp-${randomBytes(5).toString('hex')}`,
      address,
      name: String(raw?.name ?? '').trim().slice(0, 80) || local,
      kind,
      owners,
      members,
      whoCanPost,
      accountId: old?.accountId,
      createdAt: old?.createdAt ?? now,
      createdBy: old?.createdBy ?? me,
    };
    // A shared inbox: its mailbox follows the group (address, name, people); a group that stops being one leaves its
    // mailbox (and mail) as a plain shared inbox.
    if (kind === 'inbox') {
      const box = g.accountId ? accounts.find((a) => a.id === g.accountId) : undefined;
      const users = everyone(g);
      if (box) accounts = accounts.map((a) => (a.id === box.id ? { ...a, email: address, name: g.name, users, groupId: g.id, kind: 'shared' } : a));
      else {
        const id = `a-${randomBytes(5).toString('hex')}`;
        accounts.push({ id, email: address, name: g.name, kind: 'shared', connected: true, users, groupId: g.id });
        g.accountId = id;
      }
    } else if (old?.kind === 'inbox' && old.accountId) {
      accounts = accounts.map((a) => (a.id === old.accountId ? { ...a, groupId: undefined } : a));
      g.accountId = undefined;
    }
    out.push(g);
    if (!old) changes.push({ action: 'group.add', accountId: g.accountId ?? null, detail: `${g.address} (${g.kind === 'inbox' ? 'shared inbox' : 'group'}), ${everyone(g).length} people, posting: ${g.whoCanPost}` });
    else if (JSON.stringify(old) !== JSON.stringify(g)) changes.push({ action: 'group.change', accountId: g.accountId ?? null, detail: `${g.address}: ${[old.name !== g.name && `name ${g.name}`, JSON.stringify(everyone(old).sort()) !== JSON.stringify(everyone(g).sort()) && `${everyone(g).length} people`, JSON.stringify(old.owners.sort()) !== JSON.stringify([...g.owners].sort()) && 'owners changed', old.whoCanPost !== g.whoCanPost && `posting: ${g.whoCanPost}`, old.kind !== g.kind && `now a ${g.kind === 'inbox' ? 'shared inbox' : 'group'}`].filter(Boolean).join(', ') || 'changed'}` });
  }
  // Removed groups: only admins remove one. Their shared inbox stays, with its mail, as a plain shared inbox.
  for (const old of before) {
    if (out.some((g) => g.id === old.id)) continue;
    if (!admin) {
      out.push(old);
      continue;
    }
    if (old.accountId) accounts = accounts.map((a) => (a.id === old.accountId ? { ...a, groupId: undefined } : a));
    changes.push({ action: 'group.remove', accountId: old.accountId ?? null, detail: `${old.address}${old.accountId ? ' (its shared inbox stays, with its mail)' : ''}` });
  }
  return { groups: out, accounts, changes };
}
