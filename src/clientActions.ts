// Everything a client person can do in their portal. Used by "View as client" (inside the team app) and by a real
// client login, so both behave the same. The local server checks every change again (server/index.ts).
import type { Dispatch, SetStateAction } from 'react';
import { term } from './terms';
import { kindOf, stageIdFor } from './stages';
import type { Channel, ChatMessage, Client, ClientAccess, ClientPerson, DriveItem, Meeting, Notice, Team, Todo, User, Workspace } from './types';
import { channelsFor, clientInbox, clientPeople, companyOf, filesFor, isFreemail, meetingsFor, tasksFor, thisMonth } from './clientView';
import { ai } from './ai';
import type { MeetSource } from './ai/demo';
import { uploadFile } from './sync';

type Set<T> = Dispatch<SetStateAction<T>>;

export interface ClientCtx {
  ws: Workspace;
  client: Client;
  person: ClientPerson;
  access: ClientAccess;
  team: User[]; // the company's people
  teams: Team[];
  todos: Todo[];
  channels: Channel[];
  messages: ChatMessage[];
  meetings: Meeting[];
  drive: DriveItem[];
  setTodos: Set<Todo[]>;
  setMessages: Set<ChatMessage[]>;
  setDrive: Set<DriveItem[]>;
  setClients: Set<Client[]>;
  setNotices: Set<Notice[]>;
  setChannels: Set<Channel[]>;
  /** Makes an invite link for a new client person (local server), or null in the demo. */
  makeInvite?: (p: { name: string; email: string }) => Promise<string | null>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

export function clientActions(c: ClientCtx) {
  const first = c.person.name.split(' ')[0];
  const who = companyOf(c.person.email, c.person.company, c.client) ?? c.client.name; // their company, for the team's notifications
  const notice = (userId: string, text: string, link?: Notice['link']): Notice => ({ id: uid(), userId, workspaceId: c.ws.id, kind: 'task', text, at: now(), read: false, link });
  const tell = (userIds: (string | undefined)[], text: string, link?: Notice['link']) => {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (ids.length) c.setNotices((ns) => [...ids.map((id) => notice(id, text, link)), ...ns]);
  };
  const doers = (t: Todo) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
  const sharedChannel = () => channelsFor(c.person.email, c.client.id, c.channels)[0];

  /** The folder in the project's Drive where a guest's uploads go ("From KopiKita", "From Pixel & Profits"). */
  const uploadFolder = (): { id: string; create?: DriveItem } => {
    const base = c.drive.find((d) => d.kind === 'folder' && d.clientId === c.client.id && !c.drive.some((x) => x.id === d.parentId && x.clientId === c.client.id));
    const name = `From ${who}`;
    const found = c.drive.find((d) => d.kind === 'folder' && d.name === name && d.clientId === c.client.id);
    if (found) return { id: found.id };
    const id = uid();
    return { id, create: { id, name, kind: 'folder', parentId: base?.id ?? null, size: 0, modified: now(), workspaceId: c.ws.id, clientId: c.client.id, sharedWithClient: true } };
  };

  const readFiles = (files: File[]) => Promise.all(files.map((f) => uploadFile(f, c.ws.id).then((up) => ({ name: f.name, type: up.type, size: f.size, url: up.url }))));

  return {
    /** A message in a shared channel. */
    send(channelId: string, pl: { text: string; files?: ChatMessage['files']; parentId?: string; alsoInChannel?: boolean }) {
      const ch = c.channels.find((x) => x.id === channelId);
      const text = pl.text ?? '';
      if (!ch || (!text.trim() && !pl.files?.length)) return;
      const mid = uid();
      c.setMessages((ms) => [...ms, { id: mid, channelId, userId: 'guest', guestEmail: c.person.email, text: text.trim(), at: now(), files: pl.files, parentId: pl.parentId, alsoInChannel: pl.alsoInChannel }]);
      const mentioned = c.team.filter((u) => new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(text)).map((u) => u.id);
      tell(mentioned, `${c.person.name} (${who}) mentioned you in #${ch.name}`, { app: 'chat', id: channelId, msg: mid });
    },

    /** Approve work, or ask for changes. */
    decide(taskId: string, status: 'approved' | 'changes', note: string) {
      const t = c.todos.find((x) => x.id === taskId);
      if (!t) return;
      c.setTodos((ts) =>
        ts.map((x) =>
          x.id === taskId
            ? {
                ...x,
                approval: { ...(x.approval ?? { askedBy: c.client.ownerId, askedAt: now() }), status, by: c.person.email, at: now(), note: note || undefined },
                history: [...(x.history ?? []), { id: uid(), at: now(), by: c.person.email, kind: 'review', text: status === 'approved' ? `approved it${note ? `: “${note}”` : ''}` : `asked for changes: “${note}”`, toClient: true }],
                ...(status === 'changes' && x.done ? { done: false, status: stageIdFor(x, 'active'), doneAt: undefined, doneBy: undefined } : {}),
              }
            : x,
        ),
      );
      const ch = sharedChannel();
      if (ch) c.setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: 'guest', guestEmail: c.person.email, text: status === 'approved' ? `✅ Approved “${t.title}”${note ? `: ${note}` : ''}` : `✏️ Asked for changes on “${t.title}”: ${note}`, at: now(), taskId }]);
      tell([t.approval?.askedBy, ...doers(t), t.supervisorId, c.client.ownerId], `${first} (${who}) ${status === 'approved' ? 'approved' : 'asked for changes on'} “${t.title}”`, { app: 'tasks', id: taskId });
    },

    /** A comment the team sees, on a shared task or a request. */
    comment(taskId: string, text: string) {
      const t = c.todos.find((x) => x.id === taskId);
      if (!t || !text.trim()) return;
      c.setTodos((ts) => ts.map((x) => (x.id === taskId ? { ...x, history: [...(x.history ?? []), { id: uid(), at: now(), by: c.person.email, kind: 'comment', text: text.trim(), toClient: true }] } : x)));
      tell([...doers(t), t.supervisorId, c.client.ownerId], `${first} (${who}) commented on “${t.title}”: “${text.trim().slice(0, 80)}”`, { app: 'tasks', id: taskId });
    },

    /** A request (ticket): lands in the team's queue as a task. */
    async request(r: { title: string; details: string; due?: string; files: File[] }) {
      const queue = c.access.requestsTo !== 'owner' ? c.teams.find((t) => t.id === c.access.requestsTo) : undefined;
      const id = uid();
      const at = now();
      let attached = '';
      if (r.files.length) {
        const up = await this.upload(r.files, true);
        attached = `\n\nAttached: ${up.join(', ')}`;
      }
      const task: Todo = {
        id,
        title: r.title.trim(),
        clientId: c.client.id,
        teamId: queue?.id,
        userId: queue ? '' : c.client.ownerId,
        assignees: queue ? [] : [c.client.ownerId],
        supervisorId: c.client.ownerId,
        due: r.due || undefined,
        priority: 'normal',
        done: false,
        status: stageIdFor({ workspaceId: c.ws.id }, 'open'),
        source: 'request',
        requestedBy: c.person.email,
        visibleToClient: true,
        createdBy: c.person.email,
        workspaceId: c.ws.id,
        createdAt: at,
        history: [
          { id: uid(), at, by: c.person.email, kind: 'created', text: 'sent this request' },
          ...(r.details.trim() || attached ? [{ id: uid(), at, by: c.person.email, kind: 'comment' as const, text: (r.details.trim() + attached).trim(), toClient: true }] : []),
        ],
      };
      c.setTodos((ts) => [...ts, task]);
      tell(queue ? [queue.leadId, ...queue.members] : [c.client.ownerId], `New request from ${c.person.name} (${who}): “${task.title}”`, { app: 'tasks', id });
      return id;
    },

    /** Upload files into the "From <client>" folder. Returns the file names. */
    async upload(files: File[], quiet = false) {
      const read = await readFiles(files.filter((f) => f.size <= 8_000_000));
      if (!read.length) return [];
      const folder = uploadFolder();
      const kindOf = (t: string): DriveItem['kind'] => (t.startsWith('image') ? 'image' : t.startsWith('video') ? 'video' : t.includes('pdf') ? 'pdf' : 'doc');
      const items: DriveItem[] = read.map((f) => ({ id: uid(), name: f.name, kind: kindOf(f.type), parentId: folder.id, size: f.size, modified: now(), workspaceId: c.ws.id, clientId: c.client.id, url: f.url, uploadedBy: c.person.email }));
      c.setDrive((d) => [...(folder.create ? [folder.create] : []), ...items, ...d]);
      if (!quiet) tell([c.client.ownerId], `${first} (${who}) uploaded ${items.length === 1 ? items[0].name : `${items.length} files`}`, { app: 'drive' });
      return items.map((i) => i.name);
    },

    /** Invite a colleague, as the company's settings allow. Returns what happened. */
    async invite(p: { name: string; email: string }): Promise<{ ok: boolean; message: string; link?: string | null }> {
      const email = p.email.trim().toLowerCase();
      if (c.access.invites === 'off') return { ok: false, message: `${c.ws.name} adds new people for you. Ask your contact there.` };
      if (clientPeople(c.client, c.channels).some((x) => x.email.toLowerCase() === email)) return { ok: false, message: 'They already have access.' };
      // Same company: the inviter's own email domain (a partner's people can add their colleagues), or the project's.
      const domainOf = (e: string) => e.split('@')[1]?.toLowerCase() ?? '';
      const mine = domainOf(c.person.email);
      const sameCompany = (!!mine && !isFreemail(mine) && domainOf(email) === mine) || (!!c.client.domain && domainOf(email) === c.client.domain.toLowerCase());
      const pending = c.access.invites === 'approve' || !sameCompany;
      const company = domainOf(email) === mine ? companyOf(c.person.email, c.person.company, c.client) : undefined;
      const person: ClientPerson = { email, name: p.name.trim(), role: 'collaborator', status: pending ? 'pending' : 'invited', invitedBy: c.person.email, at: now(), ...(company ? { company } : {}) };
      if (pending) {
        c.setClients((cs) => cs.map((x) => (x.id === c.client.id ? { ...x, people: [...(x.people ?? []), person] } : x)));
        tell([c.client.ownerId], `${first} (${who}) asked to give ${person.name} (${email}) access. Approve it on the ${term.one} page`, { app: 'tasks' });
        return { ok: true, message: sameCompany ? `Sent to ${c.ws.name} to approve.` : `${email} isn’t at @${mine || 'your company'}, so ${c.ws.name} needs to approve it.` };
      }
      // Straight in: the server adds them to the people list and the shared channels (it knows if they already sign in).
      // Without a server (the demo), do it here.
      if (!c.makeInvite) {
        c.setClients((cs) => cs.map((x) => (x.id === c.client.id ? { ...x, people: [...(x.people ?? []), person] } : x)));
        c.setChannels((chs) => chs.map((ch) => (ch.clientId === c.client.id && ch.category === 'shared' ? { ...ch, guests: [...(ch.guests ?? []), { email, name: person.name, status: 'invited', invitedBy: c.person.email, at: now() }] } : ch)));
      }
      const link = (await c.makeInvite?.({ name: person.name, email })) ?? null;
      tell([c.client.ownerId], `${first} (${who}) invited ${person.name}`, { app: 'tasks' });
      return { ok: true, message: link ? `${person.name.split(' ')[0]} can join with the invite link.` : `${person.name.split(' ')[0]} has access now. They’ll find it under “Shared with you”.`, link };
    },

    /** Ask AI about what the client can see. Counts against the monthly limit. */
    async ask(question: string): Promise<string> {
      const month = thisMonth();
      const used = c.client.aiUsage?.month === month ? c.client.aiUsage.count : 0;
      if (!c.access.ai) return `AI isn’t switched on for your shared space.`;
      if (used >= c.access.aiQuestions) return `You’ve used all ${c.access.aiQuestions} questions for this month. They reset on the 1st.`;
      const people = clientPeople(c.client, c.channels);
      const sources: MeetSource[] = [
        ...meetingsFor(c.client, people, c.meetings, c.access)
          .filter((x) => x.notes)
          .map(({ meeting: m }) => ({ kind: 'M' as const, id: m.id, title: m.title, summary: [m.summary, ...(m.decisions ?? [])].join(' '), transcript: [], actions: m.actions.map((a) => ({ title: a.title, owner: a.owner, done: false })) })),
        {
          kind: 'T' as const,
          id: c.client.id,
          title: `${c.client.name} work`,
          summary: tasksFor(c.client, c.todos)
            .map((t) => `${t.title}: ${{ done: 'done', active: 'in progress', review: 'in progress', waiting: 'waiting on you', open: 'planned' }[kindOf(t)]}${t.due ? `, due ${t.due}` : ''}${t.approval ? `, ${t.approval.status === 'waiting' ? 'waiting for your approval' : t.approval.status === 'approved' ? 'approved' : 'changes asked'}` : ''}.`)
            .join(' '),
          transcript: [],
          actions: tasksFor(c.client, c.todos).map((t) => ({ title: `${t.title}${t.due ? ` (due ${t.due})` : ''}`, done: t.done })),
        },
        ...channelsFor(c.person.email, c.client.id, c.channels).map((ch) => ({
          kind: 'C' as const,
          id: ch.id,
          title: `#${ch.name}`,
          summary: c.messages
            .filter((m) => m.channelId === ch.id)
            .slice(-40)
            .map((m) => m.text)
            .join('\n'),
          transcript: [],
          actions: [],
        })),
      ];
      c.setClients((cs) => cs.map((x) => (x.id === c.client.id ? { ...x, aiUsage: { month, count: used + 1 } } : x)));
      return ai.askMeetings(question, sources);
    },

    /** What this person can see. */
    view() {
      const people = clientPeople(c.client, c.channels);
      return {
        people,
        tasks: tasksFor(c.client, c.todos),
        channels: channelsFor(c.person.email, c.client.id, c.channels, c.client.status === 'ended'),
        meetings: meetingsFor(c.client, people, c.meetings, c.access),
        files: filesFor(c.client, c.drive),
        inbox: clientInbox(c.person.email),
      };
    },
  };
}
export type ClientActions = ReturnType<typeof clientActions>;
