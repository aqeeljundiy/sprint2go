// What a client can see and do. One set of rules for the client app, "View as client" and the local server.
import { DEFAULT_CLIENT_ACCESS, type Channel, type Client, type ClientAccess, type ClientPerson, type DriveItem, type Meeting, type Todo, type User, type Workspace } from './types';

/** The client's settings: the company's Client access settings, with this client's own changes on top. */
export const accessFor = (ws: Pick<Workspace, 'clientAccess' | 'plan'>, client: Pick<Client, 'access'>): ClientAccess => {
  const a = { ...DEFAULT_CLIENT_ACCESS, ...(ws.clientAccess ?? {}), ...(client.access ?? {}) };
  // Hiding "Made with Sprint2go" needs the branding add-on.
  return { ...a, hideBranding: a.hideBranding && !!ws.plan?.addons.branding };
};

/** Everyone at the client who can sign in: the client's people, plus guests already in its shared channels. */
export function clientPeople(client: Client, channels: Channel[]): ClientPerson[] {
  const out = new Map<string, ClientPerson>((client.people ?? []).map((p) => [p.email.toLowerCase(), p]));
  for (const c of channels)
    if (c.clientId === client.id)
      for (const g of c.guests ?? [])
        if (!out.has(g.email.toLowerCase())) out.set(g.email.toLowerCase(), { email: g.email, name: g.name, role: 'collaborator', status: g.status, invitedBy: g.invitedBy, at: g.at });
  return [...out.values()];
}

const firstName = (n: string) => n.split(' ')[0].toLowerCase();
const isClient = (t: Todo, client: Client) => t.clientId === client.id;

/** Briefs, tasks and requests the client can see. */
export const tasksFor = (client: Client, tasks: Todo[]) => tasks.filter((t) => isClient(t, client) && (t.visibleToClient || t.source === 'request'));

/** Shared channels this person is in. */
export const channelsFor = (email: string, clientId: string, channels: Channel[]) =>
  channels.filter((c) => c.kind === 'channel' && !c.archived && c.clientId === clientId && c.guests?.some((g) => g.email.toLowerCase() === email.toLowerCase()));

/** Meetings with this client that their people were in, or that the team shared. */
export function meetingsFor(client: Client, people: ClientPerson[], meetings: Meeting[], access: ClientAccess) {
  const names = new Set(people.flatMap((p) => [p.name.toLowerCase(), firstName(p.name)]));
  return meetings
    .filter((m) => m.clientId === client.id && (m.status === undefined || m.status === 'done'))
    .filter((m) => m.sharedWithClient || m.attendees.some((a) => names.has(a.toLowerCase()) || names.has(firstName(a))))
    .map((m) => ({ meeting: m, notes: access.meetingNotes === 'auto' || !!m.sharedWithClient }));
}

/** Files the client can see: anything the team shared, and what the client uploaded. */
export function filesFor(client: Client, drive: DriveItem[]) {
  const folders = new Set(drive.filter((d) => d.kind === 'folder' && d.clientId === client.id).map((d) => d.id));
  return drive.filter((d) => !d.trashed && d.kind !== 'folder' && (d.clientId === client.id || (d.parentId && folders.has(d.parentId))) && (d.sharedWithClient || !!d.uploadedBy));
}

/** How a team member's name shows to clients. */
export function teamLabel(u: Pick<User, 'name'> | undefined, access: ClientAccess, companyName: string) {
  if (!u || access.teamNames === 'hide') return `${companyName} team`;
  return access.teamNames === 'first' ? u.name.split(' ')[0] : u.name;
}

/** A request's status in the client's words. */
export function requestStatus(t: Todo): { label: string; cls: string } {
  if (t.done || t.status === 'done') return { label: 'Done', cls: 'done' };
  if (t.status === 'waiting') return { label: 'Waiting on you', cls: 'waiting' };
  if (t.status === 'doing' || t.status === 'review') return { label: 'In progress', cls: 'doing' };
  return { label: 'New', cls: 'new' };
}

/** What a role allows. */
export const can = (p: Pick<ClientPerson, 'role'>, what: 'comment' | 'upload' | 'request' | 'approve') => (what === 'approve' ? p.role === 'approver' : p.role !== 'viewer');

/** "Email:" notice address for client people (they may not have an account id yet). */
export const clientInbox = (email: string) => `email:${email.toLowerCase()}`;

export const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * The client portals a signed-in person has: every client (in a company they're not part of) that lists their email.
 * Someone can run their own workspace and be a client of another company with the same sign-in.
 */
export function portalsFor(email: string, memberOf: string[], workspaces: Workspace[], clients: Client[], channels: Channel[]) {
  const mail = email.toLowerCase();
  return clients
    .filter((c) => !memberOf.includes(c.workspaceId) && workspaces.some((w) => w.id === c.workspaceId))
    .map((c) => ({ client: c, ws: workspaces.find((w) => w.id === c.workspaceId)!, person: clientPeople(c, channels).find((p) => p.email.toLowerCase() === mail) }))
    .filter((x): x is { client: Client; ws: Workspace; person: ClientPerson } => !!x.person && x.person.status !== 'pending')
    .map((x) => ({ ...x, key: `${x.ws.id}:${x.client.id}` }));
}
