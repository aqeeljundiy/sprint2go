import { useEffect, useMemo, useState } from 'react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { PROJECT_TYPES, term } from '../terms';
import { Archive, RotateCcw, Inbox, X, Brain, CalendarPlus, CheckCircle2, Clock, Columns3, Eye, EyeOff, FileText, Hash, LayoutGrid, LayoutTemplate, List, Mail, Menu, MessagesSquare, Plus, Sparkles, Trash2, Users, Video, type LucideIcon, ChevronRight } from 'lucide-react';
import type { Channel, ChatMessage, Client, DriveItem, Meeting, TaskStatus, Team, Thread, Todo, User, ClientPerson, Workspace, Note } from '../types';
import { ClientAccessForm } from './admin/ClientAccessForm';
import { PastClients } from './PastClients';
import { accessFor, clientPeople, companyOf } from '../clientView';
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
  | { kind: 'team'; id: string }
  | { kind: 'past' } // past clients and clients over time
  | { kind: 'projects' }; // every project (the Projects app's home)

export const ROLE_NAME: Record<ClientPerson['role'], string> = { viewer: 'Viewer', collaborator: 'Collaborator', approver: 'Approver' };
export const ROLE_HINT: Record<ClientPerson['role'], string> = { viewer: 'Reads only', collaborator: 'Comments, uploads, sends requests', approver: 'Also approves work' };
export const SOURCE: Record<Todo['source'], { icon: LucideIcon; label: string }> = {
  ai: { icon: Mail, label: 'From email' },
  manual: { icon: Plus, label: 'Added by hand' },
  braindump: { icon: Brain, label: 'From a brain dump' },
  chat: { icon: MessagesSquare, label: 'From chat' },
  meeting: { icon: Video, label: 'From a meeting' },
  request: { icon: Inbox, get label() { return `${term.Who} request`; } },
};
const COLUMNS: { id: TaskStatus; name: string }[] = [
  { id: 'todo', name: 'To do' },
  { id: 'doing', name: 'In progress' },
  { id: 'waiting', get name() { return `Waiting on ${term.who}`; } },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
];
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', get waiting() { return `Waiting on ${term.who}`; }, review: 'Waiting for review', done: 'Done' };

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
/** Clients to pick from: past clients only when it's the one already set. */
export const clientOptions = (clients: Client[], current?: string): Option[] => [
  { value: '', label: `No ${term.one}`, icon: <Dot color="var(--text-3)" /> },
  ...clients.filter((c) => c.status !== 'ended' || c.id === current).map((c) => ({ value: c.id, label: c.name, hint: c.status === 'lead' ? 'Lead' : c.status === 'ended' ? `Past ${term.one}` : undefined, icon: <Dot color={c.color} /> })),
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
  workspace: Workspace;
  canManage: boolean; // admins change client access
  onViewAs: (clientId: string, email: string) => void;
  onPatchClient: (id: string, patch: Partial<Client>) => void;
  onInviteClientPerson: (clientId: string, person: { name: string; email: string; role: ClientPerson['role']; company?: string }) => void;
  onApproveClientPerson: (clientId: string, email: string) => void;
  onEndClient: (id: string) => void;
  notes: Note[];
  onOpenNote: (id: string) => void;
  onNewNote: (clientId: string) => void;
  onReactivateClient: (id: string) => void;
  /** Vault logins for this project (only the ones you can see); open them in Vault, or add one there. */
  logins?: { id: string; title: string; url?: string; username?: string; clientId?: string; hasTotp?: boolean }[];
  onOpenLogins?: (clientId: string) => void;
  onNewLogin?: (clientId: string) => void;
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
  clientTab?: 'overview' | 'tasks' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'logins' | 'portal';
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
  const [clientTab, setClientTab] = useState<'overview' | 'tasks' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'logins' | 'portal'>('overview');
  const [writingOv, setWritingOv] = useState(false);
  const scopeId = 'id' in p.scope ? p.scope.id : '';
  useEffect(() => {
    if (p.scope.kind === 'client') setClientTab(p.scope.teamId ? 'tasks' : (p.clientTab ?? 'overview'));
  }, [scopeId, p.clientTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [previewAs, setPreviewAs] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteCompany, setInviteCompany] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

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
          ? `My ${term.many}`
          : scope.kind === 'mine'
      ? 'My tasks'
      : scope.kind === 'delegated'
        ? 'Assigned by me'
        : scope.kind === 'all'
          ? 'All tasks'
          : scope.kind === 'briefs'
            ? 'Briefs'
            : scope.kind === 'grid'
              ? `${term.Many} × teams`
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
        return { key: k, sort: c ? c.name : '~', label: c ? <><span className="dot" style={{ background: c.color }} />{c.name}</> : `No ${term.one}`, items };
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

  // Ticking a task: show the tick, let the row fold away, then move it (instead of it jumping between groups).
  const [ticking, setTicking] = useState<Set<string>>(new Set());
  const tick = (t: Todo) => {
    if (t.done || matchMedia('(prefers-reduced-motion: reduce)').matches) return p.onStatus(t.id, t.done ? 'todo' : 'done');
    setTicking((s) => new Set(s).add(t.id));
    setTimeout(() => {
      p.onStatus(t.id, 'done');
      setTicking((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }, 380);
  };
  const row = (t: Todo) => {
    const d = t.due ? dueLabel(t.due) : null;
    const src = SOURCE[t.source];
    const c = clientOf(t.clientId);
    const tm = teamOf(t.teamId);
    const br = briefOf(t.briefId);
    return (
      <div
        key={t.id}
        className={`task ${t.done || ticking.has(t.id) ? 'done' : ''} ${ticking.has(t.id) ? 'leaving' : ''} ${t.priority === 'high' ? 'high' : ''} ${statusOf(t) === 'doing' ? 'doing' : ''}`}
        onClick={(e) => !(e.target as HTMLElement).closest('button, input, .sel') && p.onOpenTask(t.id)}
      >
        <button className="todo-check" onClick={() => tick(t)} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
          {(t.done || ticking.has(t.id)) && <span>✓</span>}
        </button>
        <div className="task-main">
          <button className="task-title-btn" onClick={() => p.onOpenTask(t.id)}>
            {t.title}
          </button>
          <div className="task-meta">
            {t.source === 'request' && (
              <span className="req-chip" title={`Request from ${t.requestedBy}`}>
                <Inbox size={11} /> Request
              </span>
            )}
            {statusOf(t) === 'doing' && <span className="due doing">In progress</span>}
            {statusOf(t) === 'waiting' && <span className="due waiting">Waiting on {term.who}</span>}
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
            {t.createdBy && t.createdBy !== t.userId && t.userId && <span className="src">from {t.createdBy === p.me ? 'you' : t.createdBy.includes('@') ? (p.clients.flatMap((c) => c.people ?? []).find((x) => x.email === t.createdBy)?.name.split(' ')[0] ?? `the ${term.who}`) : person(t.createdBy)?.name.split(' ')[0]}</span>}
          </div>
        </div>
        {(() => {
          // The one thing this row needs, right on it.
          if (t.done) return null;
          if (statusOf(t) === 'review' && t.supervisorId === p.me)
            return (
              <button className="row-act primary" onClick={() => p.onStatus(t.id, 'done')}>
                Approve
              </button>
            );
          if (t.source === 'request' && statusOf(t) === 'todo')
            return (
              <button className="row-act" onClick={() => p.onStatus(t.id, 'doing')}>
                Start
              </button>
            );
          if (d?.cls === 'overdue' && doers(t).includes(p.me))
            return (
              <button className="row-act" title="Move the due date to tomorrow" onClick={() => p.onPatch(t.id, { due: localDay(new Date(Date.now() + 86_400_000)) })}>
                Tomorrow
              </button>
            );
          return null;
        })()}
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
    const rows = [...p.clients.filter((c) => c.status !== 'ended'), null];
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
    ? `${client.status === 'lead' ? 'Lead' : client.status === 'paused' ? 'Paused' : client.status === 'ended' ? `Past ${term.one}${client.endReason ? ` · ${client.endReason}` : ''}` : 'Active'}${client.domain ? ` · @${client.domain}` : ''} · owner ${person(client.ownerId)?.name ?? 'not set'}`
    : team
      ? [`Lead: ${person(team.leadId)?.name ?? 'not set'}`, overdue ? `${overdue} late` : '', open.filter((t) => !t.userId).length ? `${open.filter((t) => !t.userId).length} nobody on it yet` : ''].filter(Boolean).join(' · ')
      : scope.kind === 'grid'
        ? `Open work for every ${term.one}, split by team. Click a cell to open it.`
        : scope.kind === 'briefs'
          ? 'Bigger pieces of work with one person in charge and tasks for others'
          : [overdue ? `${overdue} late` : '', open.filter((t) => t.due === localDay()).length ? `${open.filter((t) => t.due === localDay()).length} due today` : ''].filter(Boolean).join(' · ') || (open.length ? 'Nothing late or due today' : 'Nothing open');

  if (scope.kind === 'past')
    return <PastClients clients={p.clients} tasks={p.tasks} canManage={p.canManage} onOpen={(id) => p.onScope({ kind: 'client', id })} onReactivate={p.onReactivateClient} />;

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
          <p>
            {client && (p.canManage || client.ownerId === p.me) ? (
              <Select<string>
                value={client.type ?? ''}
                onChange={(v) => p.onPatchClient(client.id, { type: v || undefined })}
                label="Type"
                className="sel-flat type-sel"
                options={[{ value: '', label: 'No type', hint: 'A label to filter by' }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]}
              />
            ) : (
              client?.type && <em className="type-tag">{client.type}</em>
            )}
            {subtitle}
          </p>
        </div>
        {client &&
          (client.status === 'ended' ? (
            <span className="client-ended">
              <span className="ended-chip">
                <Archive size={12} /> Ended{client.endedAt ? ` ${new Date(client.endedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </span>
              {(p.canManage || client.ownerId === p.me) && (
                <button className="ghost-btn sm" onClick={() => p.onReactivateClient(client.id)}>
                  <RotateCcw size={13} /> Work with them again
                </button>
              )}
            </span>
          ) : (
            (p.canManage || client.ownerId === p.me) && (
              <span className="client-status">
                <Select<'lead' | 'active' | 'paused'>
                  value={client.status as 'lead' | 'active' | 'paused'}
                  onChange={(v) => p.onPatchClient(client.id, { status: v, ...(v === 'active' && !client.since ? { since: new Date().toISOString() } : {}) })}
                  label="Status"
                  className="sel-flat"
                  options={[
                    { value: 'lead', label: 'Lead', hint: 'Not working together yet' },
                    { value: 'active', label: 'Active', hint: 'Working together' },
                    { value: 'paused', label: 'Paused', hint: 'On hold for now' },
                  ]}
                />
                <button className="ghost-btn sm" onClick={() => p.onEndClient(client.id)}>
                  End work
                </button>
              </span>
            )
          ))}
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
              ['tasks', overdue ? `Tasks · ${overdue} late` : 'Tasks'],
              ['chat', 'Chat'],
              ['emails', clientThreads.filter((t) => t.unread).length ? `Mail · ${clientThreads.filter((t) => t.unread).length} unread` : 'Mail'],
              ['meetings', 'Meetings'],
              ['files', 'Files'],
              ['notes', 'Notes'],
              ['logins', 'Logins'],
              ['portal', 'Guests'],
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
                      { value: 'client', label: `${term.One}` },
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
                            <div className="ct-top">
                              <div className="ct-title">
                                {t.priority === 'high' && <i className="ct-high" title="High priority" />}
                                {t.title}
                              </div>
                              {owner ? <Avatar person={owner} size={22} /> : <span className="avatar-empty sm" title="Nobody on it yet">?</span>}
                            </div>
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
                      Done this week <span>{recentDone.length}</span> <ChevronRight size={14} className={`rot-chev ${showDone ? 'open' : ''}`} />
                    </button>
                    <SmoothHeight>{showDone && recentDone.map(row)}</SmoothHeight>
                  </div>
                )}
              </>
            )}
          </>
        )}

        <TabPane key={clientTab}>
        {client && clientTab === 'overview' && (
          <div className="hub-overview">
            {(() => {
              // What needs doing for this client, not how much there is.
              const today = localDay();
              const items: { key: string; text: string; sub: string; run: () => void; tone?: string }[] = [
                ...open.filter((t) => t.due && t.due < today).map((t) => ({ key: 'l' + t.id, text: t.title, sub: `Late, ${person(t.userId)?.name.split(' ')[0] ?? 'nobody'} on it`, run: () => p.onOpenTask(t.id), tone: 'warn' })),
                ...open.filter((t) => t.source === 'request' && statusOf(t) === 'todo').map((t) => ({ key: 'r' + t.id, text: t.title, sub: `New request from the ${term.who}`, run: () => p.onOpenTask(t.id) })),
                ...open.filter((t) => t.approval?.status === 'changes').map((t) => ({ key: 'c' + t.id, text: t.title, sub: `${term.Who} asked for changes${t.approval?.note ? `: “${t.approval.note}”` : ''}`, run: () => p.onOpenTask(t.id), tone: 'warn' })),
                ...open.filter((t) => !t.userId).map((t) => ({ key: 'u' + t.id, text: t.title, sub: 'Nobody on it yet', run: () => p.onOpenTask(t.id) })),
                ...clientThreads.filter((t) => t.unread).map((t) => ({ key: 'm' + t.id, text: t.subject, sub: 'Unread email', run: () => p.onOpenThread(t.id) })),
              ];
              return (
                <div className="side-card needs-card">
                  <h3>Needs attention</h3>
                  {items.length ? (
                    <ul className="home-list">
                      {items.slice(0, 6).map((x) => (
                        <li key={x.key}>
                          <button className={`home-notice ${x.tone ?? ''}`} onClick={x.run}>
                            <span>{x.text}</span>
                            <time>{x.sub}</time>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="te-empty">Nothing needs you for {client.name}.{clientMeetings[0] ? ` Last meeting ${relative(clientMeetings[0].at)}.` : ''}</p>
                  )}
                </div>
              );
            })()}
            <div className="side-card client-notes-card">
              <h3>
                Notes
                <button className="link-btn" onClick={() => p.onNewNote(client.id)}>
                  <Plus size={13} /> New note
                </button>
              </h3>
              {p.notes.filter((n) => n.clientId === client.id).length ? (
                <ul className="home-list">
                  {p.notes
                    .filter((n) => n.clientId === client.id)
                    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
                    .map((n) => (
                      <li key={n.id}>
                        <button className="home-notice" onClick={() => p.onOpenNote(n.id)}>
                          <span>{n.title || 'Untitled'}</span>
                          <time>{relative(n.updatedAt)}</time>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="te-empty">No notes for {client.name} yet. Meeting prep, preferences, who’s who: write it once, the whole team sees it here.</p>
              )}
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
                <p className="muted small">AI writes a one-page view of this {term.one} from its meetings, tasks and emails. Only when you click.</p>
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
                  {!open.length && <p className="te-empty">Nothing open. Add a task on the Tasks tab, or start a brief from a template.</p>}
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
          <div className="hub-chat">
            {clientChannel ? (
              <>
                <div className="hub-msgs">
                  {clientMsgs.slice(-12).map((m) => {
                    const g = m.guestEmail ? clientChannel.guests?.find((x) => x.email === m.guestEmail) : undefined;
                    const u = m.guestEmail ? undefined : person(m.userId);
                    const who = g ? { name: g.name, email: g.email } : u ? u : { name: 'Someone', email: '' };
                    return (
                      <div key={m.id} className="hub-msg">
                        <Avatar person={who} size={28} />
                        <div className="hm-body">
                          <div className="hm-head">
                            <b>{who.name.split(' ')[0]}</b>
                            {g && <em className="ext-tag">{term.who}</em>}
                            <time>{relative(m.at)}</time>
                          </div>
                          <p>{m.text || (m.voice ? 'Voice note' : m.files ? m.files.map((f) => f.name).join(', ') : '')}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <footer className="hub-chat-foot">
                  <span className="muted small">#{clientChannel.name} · latest messages</span>
                  <button className="primary-btn sm" onClick={() => p.onOpenChannel(clientChannel.id)}>
                    <Hash size={13} /> Open the channel
                  </button>
                </footer>
              </>
            ) : (
              <p className="te-empty">{client.name} has no channel yet. Create one in Chat and pick “{term.One} (internal)” or “Shared”.</p>
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
                    {f.sharedWithClient ? ` · visible to ${term.whos}` : ''}
                  </small>
                </span>
              </div>
            ))}
            {!clientFiles.length && <p className="te-empty">No files for {client.name} yet. Files shared in its channel and saved in its Drive folder show here.</p>}
          </div>
        )}

        {client && clientTab === 'emails' && (
          <div className="te-list">
            {clientThreads.length === 0 && <p className="te-empty">{client.domain ? `No emails with @${client.domain} yet. They show up here as soon as someone there writes.` : `Add ${client.name}’s email domain to see their emails here.`}</p>}
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
            {clientMeetings.length === 0 && <p className="te-empty">No recorded meetings with {client.name} yet. Send the notetaker to your next call with them (Meet, Send bot).</p>}
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
        {client && clientTab === 'notes' && (
          <div className="tracking-scroll proj-tab">
            <div className="proj-tab-head">
              <p className="muted small">Prep, preferences, who’s who: notes linked to {client.name}. Private notes stay yours.</p>
              <button className="primary-btn sm" onClick={() => p.onNewNote(client.id)}>
                <Plus size={14} /> New note
              </button>
            </div>
            {p.notes.filter((n) => n.clientId === client.id).length ? (
              <ul className="proj-list">
                {p.notes
                  .filter((n) => n.clientId === client.id)
                  .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
                  .map((n) => (
                    <li key={n.id}>
                      <button onClick={() => p.onOpenNote(n.id)}>
                        <strong>{n.title || 'Untitled'}</strong>
                        <small>
                          {n.visibility === 'private' ? 'Only you · ' : ''}
                          {relative(n.updatedAt)}
                        </small>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="te-empty">No notes for {client.name} yet.</p>
            )}
          </div>
        )}
        {client && clientTab === 'logins' && (
          <div className="tracking-scroll proj-tab">
            <div className="proj-tab-head">
              <p className="muted small">Shared passwords and 2FA codes for {client.name}. You only see the ones you were given; every reveal is logged.</p>
              <button className="primary-btn sm" onClick={() => p.onNewLogin?.(client.id)}>
                <Plus size={14} /> New login
              </button>
            </div>
            {(p.logins ?? []).filter((l) => l.clientId === client.id).length ? (
              <ul className="proj-list">
                {(p.logins ?? [])
                  .filter((l) => l.clientId === client.id)
                  .map((l) => (
                    <li key={l.id}>
                      <button onClick={() => p.onOpenLogins?.(client.id)}>
                        <strong>{l.title}</strong>
                        <small>
                          {[l.username, l.url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], l.hasTotp ? '2FA' : ''].filter(Boolean).join(' · ') || 'Login'}
                        </small>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="te-empty">No logins for {client.name} yet. Add the ad accounts, social logins and tools you share with the team.</p>
            )}
          </div>
        )}
        {client && clientTab === 'portal' && (() => {
          const access = accessFor(p.workspace, client);
          const company = accessFor(p.workspace, {});
          const people = clientPeople(client, p.channels);
          const visible = p.tasks.filter((t) => t.clientId === client.id && (t.visibleToClient || t.source === 'request'));
          const waiting = visible.filter((t) => t.approval?.status === 'waiting');
          const files = p.files.filter((f) => (f.clientId === client.id || (f.parentId && p.files.find((x) => x.id === f.parentId)?.clientId === client.id)) && f.kind !== 'folder' && !f.trashed);
          const mts = p.meetings.filter((m) => m.clientId === client.id);
          const candidates = p.tasks.filter((t) => t.clientId === client.id && !t.done && t.source !== 'request').slice(0, 12);
          const setPeople = (list: ClientPerson[]) => p.onPatchClient(client.id, { people: list });
          const viewAs = previewAs && people.some((x) => x.email === previewAs) ? previewAs : people.find((x) => x.status !== 'pending')?.email;
          return (
            <div className="portal-admin">
              <div className="pa-hero">
                <div>
                  <h3>What {client.name} sees</h3>
                  <p className="muted">
                    Hidden until you share it. {visible.length} item{visible.length === 1 ? '' : 's'} shared, {waiting.length} waiting for approval, {people.filter((x) => x.status !== 'pending').length} people with access.
                  </p>
                </div>
                <div className="pa-preview">
                  {people.length > 0 && (
                    <Select
                      value={viewAs ?? ''}
                      onChange={setPreviewAs}
                      label="View as"
                      options={people.filter((x) => x.status !== 'pending').map((g) => ({ value: g.email, label: g.name, hint: ROLE_NAME[g.role] }))}
                    />
                  )}
                  <button className="primary-btn sm" disabled={!viewAs} onClick={() => viewAs && p.onViewAs(client.id, viewAs)}>
                    <Eye size={14} /> View as guest
                  </button>
                </div>
              </div>

              <div className="pa-grid">
                <section>
                  <h4>Tasks and briefs</h4>
                  {candidates.length === 0 && <p className="muted small">No open tasks for {client.name}.</p>}
                  {candidates.map((t) => (
                    <div key={t.id} className="pa-row">
                      <button className={`eye ${t.visibleToClient ? 'on' : ''}`} onClick={() => p.onPatch(t.id, { visibleToClient: !t.visibleToClient })} title={t.visibleToClient ? `Visible to ${term.whos}` : 'Internal only'}>
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
                  <h4>Files</h4>
                  {files.length === 0 && <p className="muted small">No files for {client.name} in Drive yet.</p>}
                  {files.map((f) => (
                    <div key={f.id} className="pa-row">
                      <button className={`eye ${f.sharedWithClient || f.uploadedBy ? 'on' : ''}`} disabled={!!f.uploadedBy} onClick={() => p.onShareFile(f.id, !f.sharedWithClient)} title={f.uploadedBy ? `Uploaded by the ${term.who}` : f.sharedWithClient ? `Visible to ${term.whos}` : 'Internal only'}>
                        {f.sharedWithClient || f.uploadedBy ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <span className="pa-title">
                        {f.name}
                        {f.uploadedBy && <small className="muted"> from {people.find((x) => x.email === f.uploadedBy)?.name.split(' ')[0] ?? `the ${term.who}`}</small>}
                      </span>
                    </div>
                  ))}
                  <h4>Meeting notes</h4>
                  {access.meetingNotes === 'auto' && <p className="muted small">Notes of meetings {client.name} attended are shared automatically. Share others here.</p>}
                  {mts.length === 0 && <p className="muted small">No meetings with {client.name} yet.</p>}
                  {mts.map((m) => {
                    const auto = access.meetingNotes === 'auto' && people.some((x) => m.attendees.some((a) => a.toLowerCase() === x.name.toLowerCase() || a.split(' ')[0].toLowerCase() === x.name.split(' ')[0].toLowerCase()));
                    const on = auto || !!m.sharedWithClient;
                    return (
                      <div key={m.id} className="pa-row">
                        <button className={`eye ${on ? 'on' : ''}`} disabled={auto} onClick={() => p.onShareMeeting(m.id, !m.sharedWithClient)} title={auto ? 'Shared automatically: they attended' : on ? `Visible to ${term.whos}` : 'Internal only'}>
                          {on ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <span className="pa-title">
                          {m.title}
                          {auto && <small className="muted"> they attended</small>}
                        </span>
                      </div>
                    );
                  })}
                </section>
                <section>
                  <h4>Guests</h4>
                  {people.length === 0 && <p className="muted small">Nobody yet. Invite the people you work with on {client.name}. They get a free account.</p>}
                  {people.map((g) => (
                    <div key={g.email} className="pa-row person-row">
                      <span className="guest-av">{g.name.charAt(0)}</span>
                      <span className="pa-title">
                        {g.name}
                        {companyOf(g.email, g.company, client) && <span className="muted"> · {companyOf(g.email, g.company, client)}</span>} <small className="muted">{g.email}</small>
                      </span>
                      {g.status === 'pending' ? (
                        <>
                          <span className="guest-status invited">Asked to join</span>
                          {p.canManage && (
                            <button className="primary-btn sm" onClick={() => p.onApproveClientPerson(client.id, g.email)}>
                              Approve
                            </button>
                          )}
                        </>
                      ) : (
                        <span className={`guest-status ${g.status}`}>{g.status === 'joined' ? 'Joined' : 'Invited'}</span>
                      )}
                      <Select<ClientPerson['role']>
                        value={g.role}
                        onChange={(role) => setPeople(people.map((x) => (x.email === g.email ? { ...x, role } : x)))}
                        label="Role"
                        className="sel-flat"
                        disabled={!p.canManage}
                        options={(['viewer', 'collaborator', 'approver'] as const).map((r) => ({ value: r, label: ROLE_NAME[r], hint: ROLE_HINT[r] }))}
                      />
                      {p.canManage && (
                        <button className="icon-btn sm" aria-label="Remove access" title="Remove access" onClick={() => setPeople(people.filter((x) => x.email !== g.email))}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="pa-invite">
                    <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Name" />
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={client.domain ? `name@${client.domain}` : 'name@company.com'} />
                    <input value={inviteCompany} onChange={(e) => setInviteCompany(e.target.value)} placeholder={companyOf(inviteEmail.trim(), undefined, client) ?? 'Company (optional)'} />
                    <button
                      className="ghost-btn sm"
                      disabled={!inviteName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim()) || people.some((x) => x.email.toLowerCase() === inviteEmail.trim().toLowerCase())}
                      onClick={() => {
                        p.onInviteClientPerson(client.id, { name: inviteName.trim(), email: inviteEmail.trim().toLowerCase(), role: 'collaborator', company: inviteCompany.trim() || undefined });
                        setInviteName('');
                        setInviteCompany('');
                        setInviteEmail('');
                      }}
                    >
                      <Plus size={13} /> Invite
                    </button>
                  </div>

                  <h4>Settings for {client.name}</h4>
                  <ClientAccessForm
                    value={access}
                    company={company}
                    overrides={client.access}
                    teams={p.teams}
                    canManage={p.canManage}
                    brandingAvailable={!!p.workspace.plan?.addons.branding}
                    onChange={(patch) => p.onPatchClient(client.id, { access: { ...(client.access ?? {}), ...patch } })}
                    onReset={(k) => {
                      const next = { ...(client.access ?? {}) };
                      delete next[k];
                      p.onPatchClient(client.id, { access: next });
                    }}
                  />
                </section>
              </div>
            </div>
          );
        })()}
        </TabPane>
      </div>
    </section>
  );
}
