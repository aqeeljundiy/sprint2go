// What a client can see and do. One set of rules for the client app, "View as client" and the local server.
import { kindOf } from './stages';
import { hasBranding } from './data/pricing';
import { mark, t } from './i18n/index'; // the full path: the server imports this file too (docs/i18n.md)
import { DEFAULT_CLIENT_ACCESS, type Channel, type Client, type ClientAccess, type ClientPerson, type DataTable, type DriveItem, type Meeting, type TableRow, type Todo, type User, type Workspace } from './types';

/** A project's guest settings: the company's, then its type's (e.g. Partners see more), then the project's own changes. */
export const accessFor = (ws: Pick<Workspace, 'clientAccess' | 'plan'> & { clientAccessByType?: Workspace['clientAccessByType'] }, client: Pick<Client, 'access'> & { type?: string }): ClientAccess => {
  const byType = client.type ? ws.clientAccessByType?.[client.type] : undefined;
  const a = { ...DEFAULT_CLIENT_ACCESS, ...(ws.clientAccess ?? {}), ...(byType ?? {}), ...(client.access ?? {}) };
  // Hiding "Made with sprint2go" needs the branding add-on (Business includes it), as the billing page says.
  return { ...a, hideBranding: a.hideBranding && hasBranding(ws.plan) };
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
const isClient = (task: Todo, client: Client) => task.clientId === client.id;

/** Briefs, tasks and requests the client can see. */
export const tasksFor = (client: Client, tasks: Todo[]) => tasks.filter((task) => isClient(task, client) && (task.visibleToClient || task.source === 'request'));

/** Shared channels this person is in, and group messages the team started with them (src/chatFollow.ts). */
export const channelsFor = (email: string, clientId: string, channels: Channel[], includeArchived = false) =>
  channels.filter((c) => (c.kind === 'channel' || c.kind === 'dm') && (includeArchived || !c.archived) && c.clientId === clientId && c.guests?.some((g) => g.email.toLowerCase() === email.toLowerCase()));

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
  if (!u || access.teamNames === 'hide') return t('{company} team', { company: companyName });
  return access.teamNames === 'first' ? u.name.split(' ')[0] : u.name;
}

/** After the work ends: their people can only read and download (if the company kept read-only access). */
export function afterEnd(client: Client, person: ClientPerson, access: ClientAccess): { person: ClientPerson; access: ClientAccess } {
  if (client.status !== 'ended') return { person, access };
  return { person: { ...person, role: 'viewer' }, access: { ...access, requests: false, uploads: false, ai: false, invites: 'off' } };
}

/**
 * A request's status in the client's words: from the kind of stage it's in, whatever the company calls its stages.
 * The label is English: show it with t(label); a notice saves it as phrase(label), so each reader gets their language.
 */
export function requestStatus(task: Todo): { label: string; cls: string } {
  const kind = kindOf(task);
  if (kind === 'done') return { label: mark('Done'), cls: 'done' };
  if (kind === 'waiting') return { label: mark('Waiting on you'), cls: 'waiting' };
  if (kind === 'active' || kind === 'review') return { label: mark('In progress'), cls: 'doing' };
  return { label: mark('New'), cls: 'new' };
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
    .filter((c) => !memberOf.includes(c.workspaceId) && workspaces.some((w) => w.id === c.workspaceId) && !(c.status === 'ended' && c.portalAfterEnd !== 'readonly'))
    .map((c) => ({ client: c, ws: workspaces.find((w) => w.id === c.workspaceId)!, person: clientPeople(c, channels).find((p) => p.email.toLowerCase() === mail) }))
    .filter((x): x is { client: Client; ws: Workspace; person: ClientPerson } => !!x.person && x.person.status !== 'pending')
    .map((x) => ({ ...x, key: `${x.ws.id}:${x.client.id}` }));
}

/** Personal mail (gmail and the like): its domain says nothing about the company. */
export const isFreemail = (domain: string) => FREEMAIL.includes(domain.toLowerCase().split('.')[0]);

const FREEMAIL = ['gmail', 'googlemail', 'yahoo', 'outlook', 'hotmail', 'icloud', 'live', 'proton', 'protonmail', 'me', 'aol', 'ymail'];

/** Where a guest works, for "Name · Company": as given at the invite, the project's name if the email matches its domain, or the email's domain. */
export function companyOf(email: string, company?: string, client?: Pick<Client, 'name' | 'domain'>): string | undefined {
  if (company?.trim()) return company.trim();
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return undefined;
  if (client?.domain && (domain === client.domain.toLowerCase() || domain.endsWith('.' + client.domain.toLowerCase()))) return client.name;
  const first = domain.split('.')[0];
  if (FREEMAIL.includes(first)) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * A table as a project's guests see it: only shared tables of their project, only the shared fields, buttons
 * without their inner workings, and none of the team's settings (rules, webhook addresses, secrets, log).
 */
export function guestTable(client: Pick<Client, 'id'>, tb: DataTable): DataTable | null {
  if (tb.clientId !== client.id || !tb.share?.enabled) return null;
  const share = tb.share;
  const visible = new Set([tb.fields[0]?.id, ...share.fields, ...share.buttons]);
  const fields = tb.fields
    .filter((f) => visible.has(f.id) && (f.type !== 'button' || share.buttons.includes(f.id)) && (f.type !== 'link'))
    .map((f) => (f.type === 'button' ? { id: f.id, name: f.name, type: f.type, button: { label: f.button?.label ?? f.name, color: f.button?.color, confirm: f.button?.confirm, ask: f.button?.ask?.filter((x) => share.edit.includes(x)), actions: [] } } : f));
  const ids = new Set(fields.map((f) => f.id));
  const has = (id: string | undefined) => (id && ids.has(id) ? id : undefined);
  // Nothing in a view may point at a field they don't see (a filter's value, a colour rule, a sort would give it away).
  const views = tb.views.map((v) => ({
    ...v,
    hidden: v.hidden?.filter((x) => ids.has(x)),
    filters: v.filters?.filter((x) => ids.has(x.fieldId)),
    filterGroups: v.filterGroups?.map((g) => ({ ...g, filters: g.filters.filter((x) => ids.has(x.fieldId)) })).filter((g) => g.filters.length),
    colors: v.colors?.filter((x) => ids.has(x.when.fieldId)),
    sort: v.sort && ids.has(v.sort.fieldId) ? v.sort : undefined,
    sorts: v.sorts?.filter((x) => ids.has(x.fieldId)),
    groupBy: has(v.groupBy),
    subGroupBy: has(v.subGroupBy),
    dateField: has(v.dateField),
    endField: has(v.endField),
    cardFields: v.cardFields?.filter((x) => ids.has(x)),
    order: v.order?.filter((x) => ids.has(x)),
  }));
  // The row page's pinned fields and main button, among what they see (sections and templates stay with the team).
  const page = tb.page ? { pinned: tb.page.pinned?.filter((x) => ids.has(x)), main: share.buttons.includes(tb.page.main ?? '') ? tb.page.main : undefined, order: tb.page.order?.filter((x) => ids.has(x)), hideEmpty: tb.page.hideEmpty } : undefined;
  return { id: tb.id, workspaceId: tb.workspaceId, name: tb.name, color: tb.color, clientId: tb.clientId, description: tb.description, fields, views, page, createdBy: tb.createdBy, createdAt: tb.createdAt, share };
}

/** A row as guests see it: shared fields only, no comments, history of shared fields only. */
export function guestRow(tb: DataTable, r: TableRow): TableRow {
  const ids = new Set(tb.fields.map((f) => f.id));
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    tableId: r.tableId,
    order: r.order,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    values: Object.fromEntries(Object.entries(r.values).filter(([k]) => ids.has(k))),
    history: (r.history ?? []).filter((h) => ids.has(h.fieldId)).slice(-20),
  };
}
