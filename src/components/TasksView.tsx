import { useEffect, useMemo, useState } from 'react';
import { Brain, CalendarPlus, CheckCircle2, Clock, Columns3, Eye, EyeOff, FileText, Hash, LayoutGrid, LayoutTemplate, List, Mail, Menu, MessagesSquare, Plus, Sparkles, Trash2, Users, Video, type LucideIcon } from 'lucide-react';
import type { Channel, ChatMessage, Client, DriveItem, Meeting, TaskStatus, Team, Thread, Todo, User } from '../types';
import { usePersisted } from '../settings';
import { relative, localDay } from '../utils';
import { Avatar } from './Avatar';
import { Dot, Select, type Option } from './ui/Select';
import { DatePicker } from './ui/DatePicker';
import { PeoplePicker } from './ui/PeoplePicker';

export type TaskScope =
  | { kind: 'mine' }
  | { kind: 'supervising' }
  | { kind: 'myteams' }
  | { kind: 'myclients' }
  | { kind: 'all' }
  | { kind: 'delegated' }
  | { kind: 'briefs' }
  | { kind: 'grid' }
  | { kind: 'client'; id: string; teamId?: string }
  | { kind: 'team'; id: string };

export const SOURCE: Record<Todo['source'], { icon: LucideIcon; label: string }> = {
  ai: { icon: Mail, label: 'From email' },
  manual: { icon: Plus, label: 'Added by hand' },
  braindump: { icon: Brain, label: 'From a brain dump' },
  chat: { icon: MessagesSquare, label: 'From chat' },
  meeting: { icon: Video, label: 'From a meeting' },
};
const COLUMNS: { id: TaskStatus; name: string }[] = [
  { id: 'todo', name: 'To do' },
  { id: 'doing', name: 'In progress' },
  { id: 'waiting', name: 'Waiting on client' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
];
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', waiting: 'Waiting on client', review: 'Waiting for review', done: 'Done' };

export const statusOf = (t: Todo): TaskStatus => (t.done ? 'done' : t.status && t.status !== 'done' ? t.status : 'todo');
/** Everyone doing a task (older tasks only have userId). */
export const doers = (t: Todo) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
export const isBrief = (t: Todo) => t.kind === 'brief';

const dayStr = (d: Date) => localDay(d);
export function dueLabel(due: string) {
  const today = dayStr(new Date());
  const tomorrow = dayStr(new Date(Date.now() + 86_400_000));
  if (due < today) return { text: 'Overdue', cls: 'overdue' };
  if (due === today) return { text: 'Today', cls: 'today' };
  if (due === tomorrow) return { text: 'Tomorrow', cls: 'soon' };
  return { text: new Date(due + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), cls: '' };
}
const late = (t: Todo) => !t.done && !!t.due && t.due < dayStr(new Date());
const byDue = (a: Todo, b: Todo) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0);

/** Options for "who": teammates, plus "Not assigned" (the team's queue). */
export function peopleOptions(users: User[], me: string, unassigned = true): Option[] {
  return [
    ...(unassigned ? [{ value: '', label: 'Not assigned', hint: 'Waits in the team’s queue', icon: <span className="avatar-empty sm">?</span> }] : []),
    ...users.map((u) => ({ value: u.id, label: u.id === me ? `${u.name} (me)` : u.name, hint: u.title, icon: <Avatar person={u} size={22} /> })),
  ];
}
export const teamOptions = (teams: Team[]): Option[] => [{ value: '', label: 'No team', icon: <Dot color="var(--text-3)" /> }, ...teams.map((t) => ({ value: t.id, label: t.name, icon: <Dot color={t.color} /> }))];
export const clientOptions = (clients: Client[]): Option[] => [
  { value: '', label: 'No client (internal)', icon: <Dot color="var(--text-3)" /> },
  ...clients.map((c) => ({ value: c.id, label: c.name, hint: c.status === 'lead' ? 'Lead' : undefined, icon: <Dot color={c.color} /> })),
];

type GroupBy = 'client' | 'team' | 'person' | 'none';
type Filter = 'open' | 'done' | 'all';

interface Props {
  scope: TaskScope;
  tasks: Todo[]; // this workspace's tasks and briefs
  clients: Client[];
  teams: Team[];
  users: User[]; // workspace members
  me: string;
  threads: Thread[];
  channels: Channel[];
  meetings: Meeting[];
  files: DriveItem[];
  onPreviewPortal: (clientId: string, guestEmail?: string) => void;
  onShareMeeting: (id: string, shared: boolean) => void;
  onShareFile: (id: string, shared: boolean) => void;
  onScope: (s: TaskScope) => void;
  onOpenTask: (id: string) => void;
  myTeamIds: string[];
  myClientIds: string[];
  onAdd: (t: { title: string; clientId?: string; teamId?: string; userId: string; due?: string }) => void;
  onStatus: (id: string, s: TaskStatus) => void;
  onPatch: (id: string, p: Partial<Todo>) => void;
  onDelete: (id: string) => void;
  onToCalendar: (t: Todo) => void;
  onOpenThread: (id: string) => void;
  onOpenChannel: (id: string) => void;
  messages: ChatMessage[]; // this workspace's chat, for the client page's Chat tab
  clientTab?: 'overview' | 'tasks' | 'chat' | 'emails' | 'meetings' | 'files' | 'portal';
  onWriteOverview: (clientId: string) => Promise<void>;
  onOpenMeeting: (id: string) => void;
  onBrainDump: () => void;
  onTemplate: () => void;
  onMenu: () => void;
}

export function TasksView(p: Props) {
  const [layout, setLayout] = usePersisted<'list' | 'board'>('s2g-task-layout', 'list');
  const [groupPref, setGroupBy] = usePersisted<GroupBy>('s2g-task-group', 'client');
  const [filter, setFilter] = useState<Filter>('open');
  const [showDone, setShowDone] = useState(true);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [teamPick, setTeamPick] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<'overview' | 'tasks' | 'chat' | 'emails' | 'meetings' | 'files' | 'portal'>('overview');
  const [writingOv, setWritingOv] = useState(false);
  const scopeId = 'id' in p.scope ? p.scope.id : '';
  useEffect(() => {
    if (p.scope.kind === 'client') setClientTab(p.scope.teamId ? 'tasks' : (p.clientTab ?? 'overview'));
  }, [scopeId, p.clientTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [previewAs, setPreviewAs] = useState<string | null>(null);

  const scope = p.scope;
  const client = scope.kind === 'client' ? p.clients.find((c) => c.id === scope.id) : undefined;
  const team = scope.kind === 'team' ? p.teams.find((t) => t.id === scope.id) : undefined;
  const cellTeam = scope.kind === 'client' && scope.teamId ? p.teams.find((t) => t.id === scope.teamId) : undefined;
  const person = (id?: string) => p.users.find((u) => u.id === id);
  const clientOf = (id?: string) => p.clients.find((c) => c.id === id);
  const teamOf = (id?: string) => p.teams.find((t) => t.id === id);
  const briefOf = (id?: string) => p.tasks.find((t) => t.id === id && isBrief(t));

  // What this page is about (briefs are shown as cards, not rows).
  const inScope = useMemo(() => {
    const work = p.tasks.filter((t) => !isBrief(t));
    switch (scope.kind) {
      case 'mine':
        return work.filter((t) => doers(t).includes(p.me));
      case 'supervising':
        return work.filter((t) => t.supervisorId === p.me && !doers(t).includes(p.me));
      case 'myteams':
        return work.filter((t) => t.teamId && p.myTeamIds.includes(t.teamId));
      case 'myclients':
        return work.filter((t) => t.clientId && p.myClientIds.includes(t.clientId));
      case 'delegated':
        return work.filter((t) => t.createdBy === p.me && t.userId !== p.me);
      case 'client':
        return work.filter((t) => t.clientId === scope.id && (!scope.teamId || t.teamId === scope.teamId));
      case 'team':
        return work.filter((t) => t.teamId === scope.id);
      default:
        return work;
    }
  }, [p.tasks, scope, p.me]);

  const briefs = useMemo(() => {
    const all = p.tasks.filter(isBrief);
    switch (scope.kind) {
      case 'mine':
        return all.filter((b) => !b.done && (b.userId === p.me || inScope.some((t) => t.briefId === b.id)));
      case 'delegated':
        return all.filter((b) => !b.done && b.createdBy === p.me);
      case 'client':
        return all.filter((b) => b.clientId === scope.id);
      case 'team':
        return all.filter((b) => !b.done && inScope.some((t) => t.briefId === b.id));
      case 'briefs':
        return all;
      default:
        return all.filter((b) => !b.done);
    }
  }, [p.tasks, scope, p.me, inScope]);

  const open = inScope.filter((t) => !t.done).sort((a, b) => (scope.kind === 'supervising' ? Number(statusOf(b) === 'review') - Number(statusOf(a) === 'review') : 0) || byDue(a, b));
  const done = inScope.filter((t) => t.done).sort((a, b) => (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt));
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const recentDone = done.filter((t) => (t.doneAt ?? t.createdAt) > weekAgo);
  const overdue = open.filter(late).length;
  const shown = filter === 'open' ? open : filter === 'done' ? done : [...open, ...done];

  const groupBy: GroupBy = scope.kind === 'team' ? 'person' : scope.kind === 'client' ? (scope.teamId ? 'none' : 'team') : groupPref;

  const heading =
    scope.kind === 'supervising'
      ? 'Supervising'
      : scope.kind === 'myteams'
        ? 'My teams'
        : scope.kind === 'myclients'
          ? 'My clients'
          : scope.kind === 'mine'
      ? 'My tasks'
      : scope.kind === 'delegated'
        ? 'Assigned by me'
        : scope.kind === 'all'
          ? 'All tasks'
          : scope.kind === 'briefs'
            ? 'Briefs'
            : scope.kind === 'grid'
              ? 'Clients × teams'
              : scope.kind === 'team'
                ? (team?.name ?? 'Team')
                : `${client?.name ?? 'Client'}${cellTeam ? ` · ${cellTeam.name}` : ''}`;

  // Add-task defaults follow the page: a team page adds to that team's queue.
  const defaultAssignee = scope.kind === 'team' ? '' : p.me;
  const addAssignee = assignee ?? defaultAssignee;
  const addTeam = teamPick ?? (scope.kind === 'team' ? scope.id : scope.kind === 'client' ? (scope.teamId ?? '') : '');
  const add = () => {
    if (!title.trim()) return;
    p.onAdd({ title: title.trim(), clientId: client?.id, teamId: addTeam || undefined, userId: addAssignee, due: due || undefined });
    setTitle('');
    setDue('');
  };

  const groups: { key: string; label: React.ReactNode; items: Todo[]; extra?: React.ReactNode }[] = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null, items: shown }];
    const map = new Map<string, Todo[]>();
    const keyOf = (t: Todo) => (groupBy === 'client' ? (t.clientId ?? '') : groupBy === 'team' ? (t.teamId ?? '') : t.userId);
    for (const t of shown) map.set(keyOf(t), [...(map.get(keyOf(t)) ?? []), t]);
    const out = [...map.entries()].map(([k, items]) => {
      if (groupBy === 'client') {
        const c = clientOf(k);
        return { key: k, sort: c ? c.name : '~', label: c ? <><span className="dot" style={{ background: c.color }} />{c.name}</> : 'Internal (no client)', items };
      }
      if (groupBy === 'team') {
        const tm = teamOf(k);
        return { key: k, sort: tm ? tm.name : '~', label: tm ? <><span className="dot" style={{ background: tm.color }} />{tm.name}</> : 'No team', items };
      }
      const u = person(k);
      return { key: k, sort: u ? (u.id === p.me ? '!' : u.name) : ' ', label: u ? <><Avatar person={u} size={18} />{u.id === p.me ? 'You' : u.name}</> : <><span className="avatar-empty sm">?</span>Not assigned yet</>, items };
    });
    return out.sort((a, b) => a.sort.localeCompare(b.sort));
  }, [shown, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (t: Todo) => {
    const d = t.due ? dueLabel(t.due) : null;
    const src = SOURCE[t.source];
    const c = clientOf(t.clientId);
    const tm = teamOf(t.teamId);
    const br = briefOf(t.briefId);
    return (
      <div
        key={t.id}
        className={`task ${t.done ? 'done' : ''} ${t.priority === 'high' ? 'high' : ''} ${statusOf(t) === 'doing' ? 'doing' : ''}`}
        onClick={(e) => !(e.target as HTMLElement).closest('button, input, .sel') && p.onOpenTask(t.id)}
      >
        <button className="todo-check" onClick={() => p.onStatus(t.id, t.done ? 'todo' : 'done')} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
          {t.done && <span>✓</span>}
        </button>
        <div className="task-main">
          <button className="task-title-btn" onClick={() => p.onOpenTask(t.id)}>
            {t.title}
          </button>
          <div className="task-meta">
            {statusOf(t) === 'doing' && <span className="due doing">In progress</span>}
            {statusOf(t) === 'waiting' && <span className="due waiting">Waiting on client</span>}
            {statusOf(t) === 'review' && <span className="due review">Waiting for review</span>}
            {d && !t.done && <span className={`due ${d.cls}`}>{d.text}</span>}
            {t.done && (
              <span className="done-info">
                Done {t.doneBy ? `by ${t.doneBy === p.me ? 'you' : (person(t.doneBy)?.name.split(' ')[0] ?? 'someone')} ` : ''}
                {t.doneAt ? relative(t.doneAt) : ''}
              </span>
            )}
            {c && scope.kind !== 'client' && (
              <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                {c.name}
              </span>
            )}
            {tm && groupBy !== 'team' && scope.kind !== 'team' && (
              <span className="team-chip" style={{ ['--c' as string]: tm.color }}>
                {tm.name}
              </span>
            )}
            {br && (
              <button className="brief-chip" onClick={() => p.onOpenTask(br.id)} title="Open the brief">
                <FileText size={11} /> {br.title}
              </button>
            )}
            <span className="src" title={src.label}>
              <src.icon size={12} />
            </span>
            {t.threadId && (
              <button className="todo-src" onClick={() => p.onOpenThread(t.threadId!)}>
                Open email
              </button>
            )}
            {t.createdBy && t.createdBy !== t.userId && t.userId && <span className="src">from {t.createdBy === p.me ? 'you' : person(t.createdBy)?.name.split(' ')[0]}</span>}
          </div>
        </div>
        <PeoplePicker compact value={doers(t)} users={p.users} me={p.me} label="Doing it" onChange={(ids) => p.onPatch(t.id, { assignees: ids, userId: ids[0] ?? '' })} />
        <div className="todo-actions">
          {!t.done && (
            <button className="icon-btn sm" title={statusOf(t) === 'doing' ? 'Move back to To do' : 'Start (In progress)'} onClick={() => p.onStatus(t.id, statusOf(t) === 'doing' ? 'todo' : 'doing')}>
              <Columns3 size={15} />
            </button>
          )}
          {!t.done && (
            <button className="icon-btn sm" title="Add to calendar" onClick={() => p.onToCalendar(t)}>
              <CalendarPlus size={15} />
            </button>
          )}
          <button className="icon-btn sm" title="Delete" onClick={() => p.onDelete(t.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  };

  const briefCard = (b: Todo) => {
    const subs = p.tasks.filter((t) => t.briefId === b.id);
    const doneN = subs.filter((t) => t.done).length;
    const owner = person(b.userId);
    const c = clientOf(b.clientId);
    const pct = subs.length ? Math.round((doneN / subs.length) * 100) : 0;
    const teamsIn = [...new Set(subs.map((s) => s.teamId).filter(Boolean))].map((id) => teamOf(id)!).filter(Boolean);
    return (
      <button key={b.id} className={`brief-card ${b.done ? 'done' : ''}`} onClick={() => p.onOpenTask(b.id)}>
        <div className="bc-top">
          <span className="brief-badge">
            <FileText size={12} /> Brief
          </span>
          {c && scope.kind !== 'client' && (
            <span className="client-chip" style={{ ['--c' as string]: c.color }}>
              {c.name}
            </span>
          )}
          {b.due && !b.done && <span className={`due ${dueLabel(b.due).cls}`}>{dueLabel(b.due).text}</span>}
        </div>
        <strong className="bc-title">{b.title}</strong>
        {b.context && <p className="bc-context">{b.context.split('\n')[0]}</p>}
        <div className="bc-foot">
          {owner && (
            <span className="bc-owner">
              <Avatar person={owner} size={20} /> {owner.id === p.me ? 'You' : owner.name.split(' ')[0]} in charge
            </span>
          )}
          <span className="bc-teams">
            {teamsIn.map((tm) => (
              <span key={tm.id} className="team-chip" style={{ ['--c' as string]: tm.color }}>
                {tm.name}
              </span>
            ))}
          </span>
          <span className="bc-progress">
            <span className="bar">
              <span style={{ width: `${pct}%` }} />
            </span>
            {doneN}/{subs.length}
          </span>
        </div>
      </button>
    );
  };

  // ---------- Team page header: workload per person ----------
  const workload = team
    ? team.members
        .map((id) => {
          const u = person(id);
          const mine = open.filter((t) => t.userId === id);
          return u ? { u, open: mine.length, late: mine.filter(late).length, week: mine.filter((t) => t.due && t.due <= dayStr(new Date(Date.now() + 7 * 86_400_000))).length } : null;
        })
        .filter(Boolean) as { u: User; open: number; late: number; week: number }[]
    : [];
  const maxLoad = Math.max(1, ...workload.map((w) => w.open));

  // ---------- Grid ----------
  const gridView = () => {
    const work = p.tasks.filter((t) => !isBrief(t) && !t.done);
    const cols = [...p.teams, null];
    const rows = [...p.clients, null];
    const cell = (cid: string | null, tid: string | null) => work.filter((t) => (t.clientId ?? null) === cid && (t.teamId ?? null) === tid);
    return (
      <div className="grid-wrap">
        <table className="cxt">
          <thead>
            <tr>
              <th />
              {cols.map((tm) => (
                <th key={tm?.id ?? 'none'}>
                  {tm ? (
                    <button onClick={() => p.onScope({ kind: 'team', id: tm.id })}>
                      <span className="dot" style={{ background: tm.color }} />
                      {tm.name}
                    </button>
                  ) : (
                    <span className="muted">No team</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const any = cols.some((tm) => cell(c?.id ?? null, tm?.id ?? null).length);
              if (!c && !any) return null;
              return (
                <tr key={c?.id ?? 'internal'}>
                  <th>
                    {c ? (
                      <button onClick={() => p.onScope({ kind: 'client', id: c.id })}>
                        <span className="client-dot sm" style={{ background: c.color }}>
                          {c.name.charAt(0)}
                        </span>
                        {c.name}
                      </button>
                    ) : (
                      <span className="muted">Internal</span>
                    )}
                  </th>
                  {cols.map((tm) => {
                    const items = cell(c?.id ?? null, tm?.id ?? null);
                    const l = items.filter(late).length;
                    return (
                      <td key={tm?.id ?? 'none'}>
                        {items.length ? (
                          <button className={`cell ${l ? 'has-late' : ''}`} onClick={() => c && p.onScope({ kind: 'client', id: c.id, teamId: tm?.id })} disabled={!c}>
                            <b>{items.length}</b> open
                            {l ? <em>{l} late</em> : null}
                          </button>
                        ) : (
                          <span className="cell empty">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const clientThreads = client?.domain ? p.threads.filter((t) => t.messages.some((m) => [m.from, ...m.to].some((x) => x.email.endsWith('@' + client.domain)))) : [];
  const clientChannel = client ? (p.channels.find((c) => c.clientId === client.id && c.category !== 'shared') ?? p.channels.find((c) => c.clientId === client.id)) : undefined;
  const clientMeetings = client ? p.meetings.filter((m) => m.clientId === client.id).sort((a, b) => b.at.localeCompare(a.at)) : [];
  const clientMsgs = clientChannel ? p.messages.filter((m) => m.channelId === clientChannel.id && !m.parentId).sort((a, b) => a.at.localeCompare(b.at)) : [];
  const clientFiles = client ? p.files.filter((f) => f.kind !== 'folder' && !f.trashed && (f.clientId === client.id || (!!f.parentId && p.files.find((x) => x.id === f.parentId)?.clientId === client.id))) : [];
  const teamChannel = team ? p.channels.find((c) => c.name === team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) : undefined;

  const showTaskList = scope.kind !== 'grid' && scope.kind !== 'briefs' && (!client || clientTab === 'tasks');
  const subtitle = client
    ? `${client.status === 'lead' ? 'Lead' : client.status === 'paused' ? 'Paused' : 'Active client'}${client.domain ? ` · @${client.domain}` : ''} · owner ${person(client.ownerId)?.name ?? 'not set'}`
    : team
      ? `Lead: ${person(team.leadId)?.name ?? 'not set'} · ${open.length} open${overdue ? ` · ${overdue} late` : ''} · ${open.filter((t) => !t.userId).length} not assigned`
      : scope.kind === 'grid'
        ? 'Open work for every client, split by team. Click a cell to open it.'
        : scope.kind === 'briefs'
          ? 'Bigger pieces of work with one person in charge and tasks for others'
          : `${open.length} open${overdue ? ` · ${overdue} overdue` : ''} · ${recentDone.length} done this week`;

  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        {client && (
          <span className="client-badge" style={{ background: client.color }}>
            {client.name.charAt(0)}
          </span>
        )}
        {team && (
          <span className="client-badge" style={{ background: team.color }}>
            <Users size={16} />
          </span>
        )}
        {scope.kind === 'grid' && (
          <span className="client-badge" style={{ background: 'var(--accent)' }}>
            <LayoutGrid size={16} />
          </span>
        )}
        <div className="th-text">
          <h1>{heading}</h1>
          <p>{subtitle}</p>
        </div>
        <button className="ghost-btn sm tpl-btn" onClick={p.onTemplate} title="Start from a template">
          <LayoutTemplate size={14} /> <span>Template</span>
        </button>
        <button className="primary-btn sm brain-btn" onClick={p.onBrainDump}>
          <Sparkles size={14} /> Brain dump
        </button>
        {showTaskList && (
          <div className="segmented icon-seg">
            <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')} title="List">
              <List size={15} />
            </button>
            <button className={layout === 'board' ? 'on' : ''} onClick={() => setLayout('board')} title="Board">
              <Columns3 size={15} />
            </button>
          </div>
        )}
      </header>

      {client && (
        <div className="client-tabs">
          {(
            [
              ['overview', 'Overview'],
              ['tasks', `Tasks · ${open.length}`],
              ['chat', 'Chat'],
              ['emails', `Mail · ${clientThreads.length}`],
              ['meetings', `Meetings · ${clientMeetings.length}`],
              ['files', `Files · ${clientFiles.length}`],
              ['portal', 'Portal'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={clientTab === id ? 'on' : ''} onClick={() => setClientTab(id)}>
              {label}
            </button>
          ))}
          {cellTeam && (
            <button className="on soft" onClick={() => p.onScope({ kind: 'client', id: client.id })}>
              {cellTeam.name} only · show all teams
            </button>
          )}
        </div>
      )}

      <div className="tracking-scroll" key={`${JSON.stringify(scope)}:${layout}:${clientTab}`}>
        {team && (
          <div className="workload">
            {workload.map((w) => (
              <button key={w.u.id} className="wl" onClick={() => p.onScope({ kind: 'team', id: team.id })}>
                <Avatar person={w.u} size={28} />
                <span className="wl-text">
                  <strong>
                    {w.u.id === p.me ? 'You' : w.u.name.split(' ')[0]}
                    {w.u.id === team.leadId && <em> lead</em>}
                  </strong>
                  <span className="bar">
                    <span style={{ width: `${(w.open / maxLoad) * 100}%` }} className={w.late ? 'warn' : ''} />
                  </span>
                  <small>
                    {w.open} open · {w.week} this week{w.late ? ` · ${w.late} late` : ''}
                  </small>
                </span>
              </button>
            ))}
            {teamChannel && (
              <button className="wl wl-chan" onClick={() => p.onOpenChannel(teamChannel.id)}>
                <Hash size={16} /> {teamChannel.name}
              </button>
            )}
          </div>
        )}

        {scope.kind === 'grid' && gridView()}

        {briefs.length > 0 && (!client || clientTab === 'tasks') && scope.kind !== 'grid' && (
          <div className="brief-list">{briefs.map(briefCard)}</div>
        )}
        {scope.kind === 'briefs' && briefs.length === 0 && (
          <div className="empty">
            <div className="empty-art">
              <FileText size={22} />
            </div>
            <p className="empty-title">No briefs yet</p>
            <p className="empty-sub">In a brain dump, choose “Brief” to turn a bigger job into a brief with tasks for each person.</p>
          </div>
        )}

        {showTaskList && (
          <>
            <div className="todo-add task-add">
              <Plus size={16} />
              <input
                id="new-task"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder={client ? `Add a task for ${client.name}…` : team ? `Add to ${team.name}’s queue…` : 'Add a task…'}
              />
              <Select value={addAssignee} options={peopleOptions(p.users, p.me)} onChange={setAssignee} label="Assign to" className="sel-flat" />
              <Select value={addTeam} options={teamOptions(p.teams)} onChange={setTeamPick} label="Team" className="sel-flat hide-sm" />
              <DatePicker value={due} onChange={setDue} label="Due date" placeholder="Due" className="sel-flat" />
              <button className="primary-btn sm" onClick={add} disabled={!title.trim()}>
                Add
              </button>
            </div>

            {layout === 'list' && (
              <div className="list-tools">
                <div className="segmented">
                  {(
                    [
                      ['open', `Open ${open.length}`],
                      ['done', `Done ${done.length}`],
                      ['all', 'All'],
                    ] as const
                  ).map(([id, l]) => (
                    <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                      {l}
                    </button>
                  ))}
                </div>
                {!['team', 'client'].includes(scope.kind) && (
                  <Select<GroupBy>
                    value={groupPref}
                    onChange={setGroupBy}
                    label="Group by"
                    className="sel-flat"
                    renderValue={(o) => <span className="sel-text">Group: {o?.label}</span>}
                    options={[
                      { value: 'client', label: 'Client' },
                      { value: 'team', label: 'Team' },
                      { value: 'person', label: 'Person' },
                      { value: 'none', label: 'None' },
                    ]}
                  />
                )}
              </div>
            )}

            {layout === 'board' ? (
              <div className="board">
                {COLUMNS.map((col) => {
                  const items = inScope.filter((t) => statusOf(t) === col.id).sort(byDue);
                  return (
                    <div
                      key={col.id}
                      className={`board-col ${dragging ? 'droppable' : ''}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragging) p.onStatus(dragging, col.id);
                        setDragging(null);
                      }}
                    >
                      <div className="board-head">
                        {col.name} <span>{items.length}</span>
                      </div>
                      {items.map((t) => {
                        const c = clientOf(t.clientId);
                        const tm = teamOf(t.teamId);
                        const d = t.due ? dueLabel(t.due) : null;
                        const owner = person(t.userId);
                        return (
                          <div
                            key={t.id}
                            className={`card-task ${t.priority === 'high' ? 'high' : ''}`}
                            draggable
                            onDragStart={() => setDragging(t.id)}
                            onDragEnd={() => setDragging(null)}
                            onClick={() => p.onOpenTask(t.id)}
                          >
                            <div className="ct-title">{t.title}</div>
                            <div className="ct-meta">
                              {c && scope.kind !== 'client' && (
                                <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                                  {c.name}
                                </span>
                              )}
                              {tm && scope.kind !== 'team' && (
                                <span className="team-chip" style={{ ['--c' as string]: tm.color }}>
                                  {tm.name}
                                </span>
                              )}
                              {d && col.id !== 'done' && <span className={`due ${d.cls}`}>{d.text}</span>}
                              <span className="spacer" />
                              {owner ? <Avatar person={owner} size={22} /> : <span className="avatar-empty sm">?</span>}
                            </div>
                          </div>
                        );
                      })}
                      {items.length === 0 && <div className="board-empty">Drop tasks here</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {shown.length === 0 && (
                  <div className="empty">
                    <div className="empty-art">✓</div>
                    <p className="empty-title">{filter === 'done' ? 'Nothing finished yet' : 'Nothing open'}</p>
                    <p className="empty-sub">Add a task above, or use Brain dump to turn your thoughts into tasks.</p>
                  </div>
                )}
                {groups.map((g) => (
                  <div key={g.key || 'none'} className="todo-group">
                    {g.label && (
                      <div className="d-heading">
                        {g.label} <span>{g.items.length}</span>
                      </div>
                    )}
                    {g.items.map(row)}
                  </div>
                ))}
                {filter === 'open' && recentDone.length > 0 && (
                  <div className="todo-group done-group">
                    <button className="d-heading done-toggle" onClick={() => setShowDone((s) => !s)}>
                      Done this week <span>{recentDone.length}</span> {showDone ? '▾' : '▸'}
                    </button>
                    {showDone && recentDone.map(row)}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {client && clientTab === 'overview' && (
          <div className="hub-overview">
            <div className="stat-cards">
              <div>
                <b>{open.length}</b>
                <span>Open tasks{overdue ? ` · ${overdue} late` : ''}</span>
              </div>
              <div>
                <b>{briefs.filter((b) => !b.done).length}</b>
                <span>Active briefs</span>
              </div>
              <div>
                <b>{clientMeetings.length}</b>
                <span>Meetings{clientMeetings[0] ? ` · last ${relative(clientMeetings[0].at)}` : ''}</span>
              </div>
              <div>
                <b>{clientThreads.filter((t) => t.unread).length}</b>
                <span>Unread emails</span>
              </div>
            </div>
            <div className="side-card overview-card">
              <h3>
                {client.overview?.headline ?? 'Where things stand'}
                <button className="ghost-btn sm" disabled={writingOv || (!clientMeetings.length && !open.length)} onClick={async () => (setWritingOv(true), await p.onWriteOverview(client.id), setWritingOv(false))}>
                  <Sparkles size={13} /> {writingOv ? 'Writing…' : client.overview ? 'Refresh' : 'Write overview'}
                </button>
              </h3>
              {client.overview ? (
                <>
                  <p className="muted small">Written by AI from {client.overview.from} meeting{client.overview.from === 1 ? '' : 's'} · {relative(client.overview.at)}</p>
                  <p>{client.overview.summary}</p>
                  <p>
                    <b>Progress:</b> {client.overview.progress}
                  </p>
                  <div className="ov-cols">
                    {(
                      [
                        ['Wins', client.overview.wins, 'Nothing yet'],
                        ['Risks', client.overview.risks, 'None flagged'],
                        ['Next steps', client.overview.next, 'None'],
                      ] as const
                    ).map(([h, l, e]) => (
                      <div key={h}>
                        <h4>{h}</h4>
                        {l.length ? (
                          <ul>
                            {l.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted small">{e}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted small">AI writes a one-page view of this client from its meetings, tasks and emails. Only when you click.</p>
              )}
            </div>
            <div className="hub-two">
              <div className="side-card">
                <h3>Next up</h3>
                <ul className="home-list">
                  {open.slice(0, 5).map((t) => (
                    <li key={t.id}>
                      <button className="home-notice" onClick={() => p.onOpenTask(t.id)}>
                        <span>{t.title}</span>
                        <time>{t.due ? dueLabel(t.due).text : ''}</time>
                      </button>
                    </li>
                  ))}
                  {!open.length && <p className="te-empty">Nothing open.</p>}
                </ul>
              </div>
              <div className="side-card">
                <h3>Recent</h3>
                <ul className="home-list">
                  {[
                    ...clientThreads.slice(0, 3).map((t) => ({ k: 'e' + t.id, text: `Email: ${t.subject}`, at: t.messages[t.messages.length - 1].date, run: () => p.onOpenThread(t.id) })),
                    ...clientMeetings.slice(0, 2).map((m) => ({ k: 'm' + m.id, text: `Meeting: ${m.title}`, at: m.at, run: () => p.onOpenMeeting(m.id) })),
                    ...clientMsgs.slice(-3).map((m) => ({ k: 'c' + m.id, text: `Chat: ${m.text.slice(0, 70)}`, at: m.at, run: () => clientChannel && p.onOpenChannel(clientChannel.id) })),
                  ]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .slice(0, 6)
                    .map((r) => (
                      <li key={r.k}>
                        <button className="home-notice" onClick={r.run}>
                          <span>{r.text}</span>
                          <time>{relative(r.at)}</time>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {client && clientTab === 'chat' && (
          <div className="te-list hub-chat">
            {clientChannel ? (
              <>
                {clientMsgs.slice(-12).map((m) => (
                  <div key={m.id} className="hub-msg">
                    <b>{m.guestEmail ? (clientChannel.guests?.find((g) => g.email === m.guestEmail)?.name ?? 'Guest') : (person(m.userId)?.name.split(' ')[0] ?? 'Someone')}</b>
                    <span>{m.text || (m.voice ? 'Voice note' : m.files ? m.files.map((f) => f.name).join(', ') : '')}</span>
                    <time>{relative(m.at)}</time>
                  </div>
                ))}
                <button className="primary-btn sm" onClick={() => p.onOpenChannel(clientChannel.id)}>
                  <Hash size={13} /> Open #{clientChannel.name}
                </button>
              </>
            ) : (
              <p className="te-empty">{client.name} has no channel yet. Create one in Chat and pick “Client”.</p>
            )}
          </div>
        )}

        {client && clientTab === 'files' && (
          <div className="te-list">
            {clientFiles.map((f) => (
              <div key={f.id} className="chat-file flat">
                <span className="cf-icon">{f.kind === 'video' ? <Video size={16} /> : <FileText size={16} />}</span>
                <span className="cf-text">
                  <strong>{f.name}</strong>
                  <small>
                    {(f.size / 1e6).toFixed(1)} MB · {relative(f.modified)}
                    {f.sharedWithClient ? ' · visible to client' : ''}
                  </small>
                </span>
              </div>
            ))}
            {!clientFiles.length && <p className="te-empty">No files for {client.name} yet. Files shared in its channel and saved in its Drive folder show here.</p>}
          </div>
        )}

        {client && clientTab === 'emails' && (
          <div className="te-list">
            {clientThreads.length === 0 && <p className="te-empty">No emails with @{client.domain ?? 'this client'} yet.</p>}
            {clientThreads.map((t) => {
              const last = t.messages[t.messages.length - 1];
              return (
                <button key={t.id} className="te-row simple" onClick={() => p.onOpenThread(t.id)}>
                  <Avatar person={last.from} size={30} />
                  <div className="te-main">
                    <strong>{t.subject}</strong>
                    <small>
                      {last.from.name} · {relative(last.date)}
                    </small>
                  </div>
                  {t.unread && <span className="te-status seen">New</span>}
                </button>
              );
            })}
          </div>
        )}

        {client && clientTab === 'meetings' && (
          <div className="te-list">
            {clientMeetings.length === 0 && <p className="te-empty">No recorded meetings with {client.name} yet.</p>}
            {clientMeetings.map((m) => (
              <button key={m.id} className="te-row simple" onClick={() => p.onOpenMeeting(m.id)}>
                <span className="kpi-icon">
                  <Video size={15} />
                </span>
                <div className="te-main">
                  <strong>{m.title}</strong>
                  <small>
                    {relative(m.at)} · {m.minutes} min · {m.actions.length} action items
                  </small>
                </div>
              </button>
            ))}
          </div>
        )}
        {client && clientTab === 'portal' && (() => {
          const guests = [...new Map(p.channels.filter((c) => c.clientId === client.id).flatMap((c) => c.guests ?? []).map((g) => [g.email, g])).values()];
          const visible = p.tasks.filter((t) => t.clientId === client.id && t.visibleToClient);
          const waiting = visible.filter((t) => t.approval?.status === 'waiting');
          const files = p.files.filter((f) => (f.clientId === client.id || f.parentId && p.files.find((x) => x.id === f.parentId)?.clientId === client.id) && f.kind !== 'folder' && !f.trashed);
          const mts = p.meetings.filter((m) => m.clientId === client.id);
          const candidates = p.tasks.filter((t) => t.clientId === client.id && !t.done).slice(0, 12);
          return (
            <div className="portal-admin">
              <div className="pa-hero">
                <div>
                  <h3>What {client.name} sees</h3>
                  <p className="muted">
                    Everything is internal until you mark it visible. {visible.length} item{visible.length === 1 ? '' : 's'} shared, {waiting.length} waiting for approval.
                  </p>
                  <p className="muted small">
                    Portal address: <b>portal.sprint2go.com/{client.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}</b> · guests sign in with their email
                  </p>
                </div>
                <div className="pa-preview">
                  <Select
                    value={previewAs ?? guests[0]?.email ?? ''}
                    onChange={setPreviewAs}
                    label="Preview as"
                    options={guests.length ? guests.map((g) => ({ value: g.email, label: g.name, hint: g.email })) : [{ value: '', label: `Someone at ${client.name}` }]}
                  />
                  <button className="primary-btn sm" onClick={() => p.onPreviewPortal(client.id, (previewAs ?? guests[0]?.email) || undefined)}>
                    <Eye size={14} /> Preview portal
                  </button>
                </div>
              </div>

              <div className="pa-grid">
                <section>
                  <h4>Tasks and briefs</h4>
                  {candidates.map((t) => (
                    <div key={t.id} className="pa-row">
                      <button className={`eye ${t.visibleToClient ? 'on' : ''}`} onClick={() => p.onPatch(t.id, { visibleToClient: !t.visibleToClient })} title={t.visibleToClient ? 'Visible to client' : 'Internal only'}>
                        {t.visibleToClient ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button className="pa-title" onClick={() => p.onOpenTask(t.id)}>
                        {isBrief(t) && <FileText size={12} />} {t.title}
                      </button>
                      {t.approval?.status === 'waiting' && (
                        <span className="ap-tag waiting">
                          <Clock size={11} /> Waiting
                        </span>
                      )}
                      {t.approval?.status === 'approved' && (
                        <span className="ap-tag approved">
                          <CheckCircle2 size={11} /> Approved
                        </span>
                      )}
                    </div>
                  ))}
                </section>
                <section>
                  <h4>Files</h4>
                  {files.length === 0 && <p className="muted small">No files for {client.name} in Drive yet.</p>}
                  {files.map((f) => (
                    <div key={f.id} className="pa-row">
                      <button className={`eye ${f.sharedWithClient ? 'on' : ''}`} onClick={() => p.onShareFile(f.id, !f.sharedWithClient)} title={f.sharedWithClient ? 'Visible to client' : 'Internal only'}>
                        {f.sharedWithClient ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <span className="pa-title">{f.name}</span>
                    </div>
                  ))}
                  <h4>Meeting notes</h4>
                  {mts.length === 0 && <p className="muted small">No meetings with {client.name} yet.</p>}
                  {mts.map((m) => (
                    <div key={m.id} className="pa-row">
                      <button className={`eye ${m.sharedWithClient ? 'on' : ''}`} onClick={() => p.onShareMeeting(m.id, !m.sharedWithClient)} title={m.sharedWithClient ? 'Visible to client' : 'Internal only'}>
                        {m.sharedWithClient ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <span className="pa-title">{m.title}</span>
                    </div>
                  ))}
                  <h4>People with access</h4>
                  {guests.length === 0 && <p className="muted small">No client guests yet. Invite them from the client’s channel settings.</p>}
                  {guests.map((g) => (
                    <div key={g.email} className="pa-row">
                      <span className="guest-av">{g.name.charAt(0)}</span>
                      <span className="pa-title">
                        {g.name} <small className="muted">{g.email}</small>
                      </span>
                      <span className={`guest-status ${g.status}`}>{g.status === 'joined' ? 'Joined' : 'Invited'}</span>
                    </div>
                  ))}
                </section>
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
