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
import { msg, phrase, t, tn, type Msg } from './i18n';

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
  // The team's notices: msg() keeps the English and lets each reader see it in their own language (docs/i18n.md).
  const notice = (userId: string, words: { text: string; tr: Msg }, link?: Notice['link']): Notice => ({ id: uid(), userId, workspaceId: c.ws.id, kind: 'task', ...words, at: now(), read: false, link });
  const tell = (userIds: (string | undefined)[], words: { text: string; tr: Msg }, link?: Notice['link']) => {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (ids.length) c.setNotices((ns) => [...ids.map((id) => notice(id, words, link)), ...ns]);
  };
  const doers = (task: Todo) => (task.assignees?.length ? task.assignees : task.userId ? [task.userId] : []);
  const sharedChannel = () => channelsFor(c.person.email, c.client.id, c.channels)[0];

  /** The folder in the project's Drive where a guest's uploads go ("From KopiKita", "From Pixel & Profits"). */
  const uploadFolder = (): { id: string; create?: DriveItem } => {
    const base = c.drive.find((d) => d.kind === 'folder' && d.clientId === c.client.id && !c.drive.some((x) => x.id === d.parentId && x.clientId === c.client.id));
    const name = `From ${who}`; // a folder name: data the team sees in Drive, and how it's found again, so always English
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
      tell(mentioned, msg('{name} ({company}) mentioned you in #{channel}', { name: c.person.name, company: who, channel: ch.name }), { app: 'chat', id: channelId, msg: mid });
    },

    /** Approve work, or ask for changes. */
    decide(taskId: string, status: 'approved' | 'changes', note: string) {
      const task = c.todos.find((x) => x.id === taskId);
      if (!task) return;
      c.setTodos((ts) =>
        ts.map((x) =>
          x.id === taskId
            ? {
                ...x,
                approval: { ...(x.approval ?? { askedBy: c.client.ownerId, askedAt: now() }), status, by: c.person.email, at: now(), note: note || undefined },
                // Saved with msg(): the English text, and a key each reader sees in their own language (docs/i18n.md).
                history: [...(x.history ?? []), { id: uid(), at: now(), by: c.person.email, kind: 'review', ...(status === 'approved' ? (note ? msg('approved it: “{note}”', { note }) : msg('approved it')) : msg('asked for changes: “{note}”', { note })), toClient: true }],
                ...(status === 'changes' && x.done ? { done: false, status: stageIdFor(x, 'active'), doneAt: undefined, doneBy: undefined } : {}),
              }
            : x,
        ),
      );
      const ch = sharedChannel();
      // A line in the shared channel, in English like chat's other system lines (chat's to-do in docs/i18n.md).
      if (ch) c.setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: 'guest', guestEmail: c.person.email, text: status === 'approved' ? `✅ Approved “${task.title}”${note ? `: ${note}` : ''}` : `✏️ Asked for changes on “${task.title}”: ${note}`, at: now(), taskId }]);
      tell([task.approval?.askedBy, ...doers(task), task.supervisorId, c.client.ownerId], status === 'approved' ? msg('{name} ({company}) approved “{title}”', { name: first, company: who, title: task.title }) : msg('{name} ({company}) asked for changes on “{title}”', { name: first, company: who, title: task.title }), { app: 'tasks', id: taskId });
    },

    /** A comment the team sees, on a shared task or a request. */
    comment(taskId: string, text: string) {
      const task = c.todos.find((x) => x.id === taskId);
      if (!task || !text.trim()) return;
      c.setTodos((ts) => ts.map((x) => (x.id === taskId ? { ...x, history: [...(x.history ?? []), { id: uid(), at: now(), by: c.person.email, kind: 'comment', text: text.trim(), toClient: true }] } : x)));
      tell([...doers(task), task.supervisorId, c.client.ownerId], msg('{name} ({company}) commented on “{title}”: “{text}”', { name: first, company: who, title: task.title, text: text.trim().slice(0, 80) }), { app: 'tasks', id: taskId });
    },

    /** A request (ticket): lands in the team's queue as a task. */
    async request(r: { title: string; details: string; due?: string; files: File[] }) {
      const queue = c.access.requestsTo !== 'owner' ? c.teams.find((tm) => tm.id === c.access.requestsTo) : undefined;
      const id = uid();
      const at = now();
      let attached = '';
      if (r.files.length) {
        const up = await this.upload(r.files, true);
        attached = `\n\n${t('Attached: {files}', { files: up.join(', ') })}`; // part of the guest's own comment, in their words
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
        status: stageIdFor({ workspaceId: c.ws.id, clientId: c.client.id }, 'open'),
        source: 'request',
        requestedBy: c.person.email,
        visibleToClient: true,
        createdBy: c.person.email,
        workspaceId: c.ws.id,
        createdAt: at,
        history: [
          { id: uid(), at, by: c.person.email, kind: 'created', ...msg('sent this request') },
          ...(r.details.trim() || attached ? [{ id: uid(), at, by: c.person.email, kind: 'comment' as const, text: (r.details.trim() + attached).trim(), toClient: true }] : []),
        ],
      };
      c.setTodos((ts) => [...ts, task]);
      tell(queue ? [queue.leadId, ...queue.members] : [c.client.ownerId], msg('New request from {name} ({company}): “{title}”', { name: c.person.name, company: who, title: task.title }), { app: 'tasks', id });
      return id;
    },

    /** Upload files into the "From <client>" folder. Returns the file names. */
    async upload(files: File[], quiet = false) {
      const read = await readFiles(files.filter((f) => f.size <= 8_000_000));
      if (!read.length) return [];
      const folder = uploadFolder();
      const kindOf = (type: string): DriveItem['kind'] => (type.startsWith('image') ? 'image' : type.startsWith('video') ? 'video' : type.includes('pdf') ? 'pdf' : 'doc');
      const items: DriveItem[] = read.map((f) => ({ id: uid(), name: f.name, kind: kindOf(f.type), parentId: folder.id, size: f.size, modified: now(), workspaceId: c.ws.id, clientId: c.client.id, url: f.url, uploadedBy: c.person.email }));
      c.setDrive((d) => [...(folder.create ? [folder.create] : []), ...items, ...d]);
      if (!quiet) tell([c.client.ownerId], items.length === 1 ? msg('{name} ({company}) uploaded {file}', { name: first, company: who, file: items[0].name }) : msg('{name} ({company}) uploaded {n} files', { name: first, company: who, n: items.length }), { app: 'drive' });
      return items.map((i) => i.name);
    },

    /** Invite a colleague, as the company's settings allow. Returns what happened. */
    async invite(p: { name: string; email: string }): Promise<{ ok: boolean; message: string; link?: string | null }> {
      const email = p.email.trim().toLowerCase();
      if (c.access.invites === 'off') return { ok: false, message: t('{company} adds new people for you. Ask your contact there.', { company: c.ws.name }) };
      if (clientPeople(c.client, c.channels).some((x) => x.email.toLowerCase() === email)) return { ok: false, message: t('They already have access.') };
      // Same company: the inviter's own email domain (a partner's people can add their colleagues), or the project's.
      const domainOf = (e: string) => e.split('@')[1]?.toLowerCase() ?? '';
      const mine = domainOf(c.person.email);
      const sameCompany = (!!mine && !isFreemail(mine) && domainOf(email) === mine) || (!!c.client.domain && domainOf(email) === c.client.domain.toLowerCase());
      const pending = c.access.invites === 'approve' || !sameCompany;
      const company = domainOf(email) === mine ? companyOf(c.person.email, c.person.company, c.client) : undefined;
      const person: ClientPerson = { email, name: p.name.trim(), role: 'collaborator', status: pending ? 'pending' : 'invited', invitedBy: c.person.email, at: now(), ...(company ? { company } : {}) };
      if (pending) {
        c.setClients((cs) => cs.map((x) => (x.id === c.client.id ? { ...x, people: [...(x.people ?? []), person] } : x)));
        tell([c.client.ownerId], msg('{name} ({company}) asked to give {person} ({email}) access. Approve it on the {project} page', { name: first, company: who, person: person.name, email, project: phrase(term.word === 'client' ? 'client' : 'project') }), { app: 'tasks' });
        return { ok: true, message: sameCompany ? t('Sent to {company} to approve.', { company: c.ws.name }) : mine ? t('{email} isn’t at @{domain}, so {company} needs to approve it.', { email, domain: mine, company: c.ws.name }) : t('{email} isn’t at your company, so {company} needs to approve it.', { email, company: c.ws.name }) };
      }
      // Straight in: the server adds them to the people list and the shared channels (it knows if they already sign in).
      // Without a server (the demo), do it here.
      if (!c.makeInvite) {
        c.setClients((cs) => cs.map((x) => (x.id === c.client.id ? { ...x, people: [...(x.people ?? []), person] } : x)));
        c.setChannels((chs) => chs.map((ch) => (ch.clientId === c.client.id && ch.category === 'shared' ? { ...ch, guests: [...(ch.guests ?? []), { email, name: person.name, status: 'invited', invitedBy: c.person.email, at: now() }] } : ch)));
      }
      const link = (await c.makeInvite?.({ name: person.name, email })) ?? null;
      tell([c.client.ownerId], msg('{name} ({company}) invited {person}', { name: first, company: who, person: person.name }), { app: 'tasks' });
      const them = person.name.split(' ')[0];
      return { ok: true, message: link ? t('{name} can join with the invite link.', { name: them }) : t('{name} has access now. They’ll find it under “Shared with you”.', { name: them }), link };
    },

    /** Ask AI about what the client can see. Counts against the monthly limit. */
    async ask(question: string): Promise<string> {
      const month = thisMonth();
      const used = c.client.aiUsage?.month === month ? c.client.aiUsage.count : 0;
      if (!c.access.ai) return t('AI isn’t switched on for your shared space.');
      if (used >= c.access.aiQuestions) return tn(c.access.aiQuestions, 'You’ve used your {n} question for this month. It resets on the 1st.', 'You’ve used all {n} questions for this month. They reset on the 1st.');
      // What the AI reads (titles, states, dates) stays English: it's the model's input, not text on screen.
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
            .map((tk) => `${tk.title}: ${{ done: 'done', active: 'in progress', review: 'in progress', waiting: 'waiting on you', open: 'planned' }[kindOf(tk)]}${tk.due ? `, due ${tk.due}` : ''}${tk.approval ? `, ${tk.approval.status === 'waiting' ? 'waiting for your approval' : tk.approval.status === 'approved' ? 'approved' : 'changes asked'}` : ''}.`)
            .join(' '),
          transcript: [],
          actions: tasksFor(c.client, c.todos).map((tk) => ({ title: `${tk.title}${tk.due ? ` (due ${tk.due})` : ''}`, done: tk.done })),
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
