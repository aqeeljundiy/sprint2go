// The server's rules for direct and group messages (index.ts applySync calls them for every team member's save):
//  - A direct or group message holds you and up to 8 others, all on the company's team. Guests only when they're
//    already in (joined) one project's people, that project is still going, and you may invite guests there (an admin,
//    the project's lead, or "Invite guests" in Settings, Permissions).
//  - Its people stay as they were: adding someone makes a new group message (Slack); the only change is leaving it.
//  - "Convert to a private channel": one of its people turns it into a private channel with a name, keeping
//    everyone (more people may come in), as long as the company lets them start channels.
//  - A thread's follow choices (src/chatFollow.ts): each person changes only their own.
import { mark } from '../src/i18n/index.ts';
import { clientPeople } from '../src/clientView.ts';
import { GROUP_MAX, ownFollow } from '../src/chatFollow.ts';
import * as db from './db.ts';

type Doc = db.Doc;
type Ctx = { me: string; isAdmin: boolean; perms: { inviteGuests?: boolean } };
export type Verdict = { doc: Doc | null; why?: string };

const uniq = (a: unknown): string[] => (Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === 'string' && !!x))] : []);
const lower = (s: unknown) => String(s ?? '').toLowerCase();

/** A new direct or group message, as it may be saved (or null, with why). */
function newDm(d: any, c: Ctx): Verdict {
  const ws = db.getDoc('workspaces', String(d.workspaceId)) as any;
  const team = new Set<string>((ws?.members ?? []).map((m: any) => m.userId));
  const members = uniq(d.members);
  if (!members.includes(c.me)) return { doc: null };
  const guests = Array.isArray(d.guests) ? d.guests : [];
  if (members.length + guests.length < 2) return { doc: null };
  if (members.length + guests.length > GROUP_MAX) return { doc: null, why: mark('A group message holds up to 9 people. For more, make a channel.') };
  if (members.some((id) => !team.has(id))) return { doc: null, why: mark('Only people on the team can be in a group message. Invite guests from a project.') };
  if (!guests.length) {
    const { guests: _g, clientId: _c, ...rest } = d;
    return { doc: { ...rest, name: '', members } as Doc };
  }
  // Guests: one project's people who already joined, a project still going, and someone who may invite guests there.
  const project = db.getDoc('clients', String(d.clientId ?? '')) as any;
  if (!project || project.workspaceId !== d.workspaceId) return { doc: null, why: mark('Guests in a group message come from one project.') };
  if (project.status === 'ended') return { doc: null, why: mark('That project has ended, so its guests can’t be messaged here.') };
  const leads = project.ownerId === c.me || (project.members ?? []).some((m: any) => m.userId === c.me && m.role === 'lead');
  if (!c.isAdmin && !leads && !c.perms.inviteGuests) return { doc: null, why: mark('Only admins and the project’s Lead can message its guests here.') };
  const joined = new Map(clientPeople(project, db.allDocs('channels') as any).filter((p) => p.status === 'joined').map((p) => [lower(p.email), p]));
  const picked: string[] = [...new Set<string>(guests.map((g: any) => lower(g?.email)))];
  if (!picked.length || picked.some((e) => !joined.has(e))) return { doc: null, why: mark('Only guests who already joined the project can be in a group message.') };
  const now = new Date().toISOString();
  return { doc: { ...d, name: '', members, clientId: project.id, guests: picked.map((e) => ({ email: joined.get(e)!.email, name: joined.get(e)!.name, status: 'joined', invitedBy: c.me, at: now })) } as Doc };
}

/**
 * A team member's save of a conversation that is (or was) a direct or group message. Returns 'pass' for anything else
 * (channels have their own rules in index.ts).
 */
export function guardDm(d: any, before: any, c: Ctx & { mayCreateChannel: boolean }): Verdict | 'pass' {
  if (!before) return d.kind === 'dm' ? newDm(d, c) : 'pass';
  if (before.kind !== 'dm') return 'pass';
  if (!(before.members ?? []).includes(c.me)) return { doc: null };
  // Convert to a private channel: everyone stays (more may come in), with a name.
  if (d.kind === 'channel') {
    if (!c.mayCreateChannel) return { doc: null, why: mark('Only admins start channels here.') };
    const name = String(d.name ?? '').trim();
    if (!name) return { doc: null };
    const ws = db.getDoc('workspaces', String(before.workspaceId)) as any;
    const team = new Set<string>((ws?.members ?? []).map((m: any) => m.userId));
    const members = [...new Set([...(before.members ?? []), ...uniq(d.members).filter((id) => team.has(id))])];
    return { doc: { ...d, kind: 'channel', private: true, name, members, ownerId: c.me, workspaceId: before.workspaceId, clientId: before.clientId, guests: before.guests, createdAt: d.createdAt ?? new Date().toISOString() } as Doc };
  }
  // Still a direct message: the same people, or the same less you (you left it).
  const asked = uniq(d.members);
  const left = !asked.includes(c.me) && (before.members ?? []).filter((x: string) => x !== c.me).every((x: string) => asked.includes(x));
  const members = left ? (before.members ?? []).filter((x: string) => x !== c.me) : before.members;
  return { doc: { ...d, kind: 'dm', name: '', members, clientId: before.clientId, guests: before.guests } as Doc };
}

/** A save of a message: each person sets only their own follow choice on a thread. */
export function guardFollow(d: Doc, before: any, me: string): Doc {
  const follow = ownFollow(before?.follow, (d as any).follow, me);
  const { follow: _f, ...rest } = d as any;
  return (follow ? { ...rest, follow } : rest) as Doc;
}
