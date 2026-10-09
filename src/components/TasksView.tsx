import { TabBar } from './ui/TabBar';
import { ProjectPeople } from './ProjectPeople';
import { ProjectBadge, ProjectPhotoButton } from './ProjectBadge';
import { useEffect, useMemo, useState } from 'react';
import { TabPane } from './ui/Smooth';
import { PROJECT_TYPES, term } from '../terms';
import { Archive, RotateCcw, Inbox, X, Brain, CheckCircle2, Clock, Eye, EyeOff, FileText, Hash, LayoutGrid, LayoutTemplate, Mail, Menu, MessagesSquare, Plus, Sparkles, Users, Video, type LucideIcon, FolderInput, ChevronRight, MessageCircle } from 'lucide-react';
import type { Channel, ChatMessage, Client, DriveItem, Meeting, TaskStatus, Team, Thread, Todo, User, ClientPerson, Workspace, Note, DataTable, TableRow } from '../types';
import { kindOf, stageOf, stagesFor, toneOf } from '../stages';
import { ProjectTables } from './tables/TablesApp';
import { ClientAccessForm } from './admin/ClientAccessForm';
import { PastClients } from './PastClients';
import { accessFor, clientPeople, companyOf } from '../clientView';
import { usePersisted } from '../settings';
import { relative, localDay } from '../utils';
import { Avatar } from './Avatar';
import { Badge, PersonCell } from './ui/Person';
import { EmptyState } from './ui/EmptyState';
import { Dot, Select, type Option } from './ui/Select';
import { personOption } from './ui/PeopleList';
import { QuotesTab } from './Quotes';
import type { Quote } from '../types';
import { useTitleMenu } from '../mobile/chrome';
import { TaskViews, type SavedTaskView } from './tasks/TaskViews';
import type { NewTask, TaskOps } from './tasks/taskOps';
import { saveDisplay } from './tasks/display';

export type TaskScope =
  | { kind: 'mine' }
  | { kind: 'today' } // my overdue tasks and today's, with Plan my day
  | { kind: 'upcoming' } // my tasks by day: a week strip and one list of days
  | { kind: 'project'; id: string } // one project's tasks, inside Tasks (its page lives in Projects)
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
  import: { icon: FolderInput, label: 'Imported' },
};
/** A task's stage id (one of its company's stages; see src/stages.ts). */
export const statusOf = (t: Todo): TaskStatus => stageOf(t).id;
/** A stage's colour dot: filled when done, hollow when not started. */
export const StageDot = ({ t, className = '' }: { t: Pick<Todo, 'status' | 'done' | 'workspaceId'>; className?: string }) => {
  const s = stageOf(t);
  return <span className={`stage-dot k-${s.kind} tone-${toneOf(s)} ${className}`} />;
};
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
    ...users.map((u) => ({ ...personOption(u), label: u.id === me ? `${u.name} (me)` : u.name, hint: u.title, icon: <Avatar person={u} size={22} /> })),
  ];
}
export const teamOptions = (teams: Team[]): Option[] => [{ value: '', label: 'No team', icon: <Dot color="var(--text-3)" /> }, ...teams.map((t) => ({ value: t.id, label: t.name, icon: <Dot color={t.color} /> }))];
/** Clients to pick from: past clients only when it's the one already set. */
export const clientOptions = (clients: Client[], current?: string): Option[] => [
  { value: '', label: `No ${term.one}`, icon: <Dot color="var(--text-3)" /> },
  ...clients.filter((c) => c.status !== 'ended' || c.id === current).map((c) => ({ value: c.id, label: c.name, hint: c.status === 'lead' ? 'Lead' : c.status === 'ended' ? `Past ${term.one}` : undefined, icon: <Dot color={c.color} /> })),
];


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
  canInviteGuests?: boolean; // Members may invite guests (company setting); a project's Lead always can
  quotes?: Quote[];
  onQuote?: { save: (q: Quote) => void; remove: (id: string) => void; send: (q: Quote) => void; brief: (q: Quote) => void };
  onViewAs: (clientId: string, email: string) => void;
  onPatchClient: (id: string, patch: Partial<Client>) => void;
  onInviteClientPerson: (clientId: string, person: { name: string; email: string; role: ClientPerson['role']; company?: string; phone?: string }) => void;
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
  /** Tables that belong to this project (leads, pipelines…); open one, or make one for it. */
  tables?: DataTable[];
  tableRows?: TableRow[];
  onOpenTable?: (id: string) => void;
  onNewTable?: (clientId: string) => void;
  onShareMeeting: (id: string, shared: boolean) => void;
  onShareFile: (id: string, shared: boolean) => void;
  onScope: (s: TaskScope) => void;
  onOpenTask: (id: string) => void;
  myTeamIds: string[];
  myClientIds: string[];
  onAdd: (t: NewTask) => string; // the new task's id
  onStatus: (id: string, s: TaskStatus, quiet?: boolean) => void;
  onPatch: (id: string, p: Partial<Todo>) => void;
  onDelete: (ids: string | string[], quiet?: boolean) => void;
  onToCalendar: (t: Todo) => void;
  onOpenThread: (id: string) => void;
  onOpenChannel: (id: string) => void;
  messages: ChatMessage[]; // this workspace's chat, for the client page's Chat tab
  clientTab?: 'overview' | 'tasks' | 'workload' | 'quotes' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'tables' | 'logins' | 'portal';
  onWriteOverview: (clientId: string) => Promise<void>;
  onOpenMeeting: (id: string) => void;
  onBrainDump: () => void;
  addKey?: number; // bump to open the new task field (New, Task in More)
  dumpInSidebar?: boolean; // the Tasks sidebar already has Brain dump at its top: no second one in the header
  onTemplate: () => void;
  onMenu: () => void;
  onOpenProject?: (id: string) => void; // a project's own page (the Projects app)
  onPastProjects?: () => void;
}

export function TasksView(p: Props) {
  const [briefsOpen, setBriefsOpen] = usePersisted('s2g-briefs-open', true);
  const [views, setViews] = usePersisted<SavedTaskView[]>('s2g-task-views', []);
  const [clientTab, setClientTab] = useState<'overview' | 'tasks' | 'workload' | 'quotes' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'tables' | 'logins' | 'portal'>('overview');
  const [writingOv, setWritingOv] = useState(false);
  const scopeId = 'id' in p.scope ? p.scope.id : '';
  useEffect(() => {
    if (p.scope.kind === 'client') setClientTab(p.scope.teamId ? 'tasks' : (p.clientTab ?? 'overview'));
  }, [scopeId, p.clientTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [previewAs, setPreviewAs] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteCompany, setInviteCompany] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [waTo, setWaTo] = useState<ClientPerson | null>(null); // a WhatsApp message being written to this guest
  const [inviteEmail, setInviteEmail] = useState('');

  // A team or project that's gone (deleted, or this device remembered one from another company): back to My tasks.
  const scopeRef = p.scope as { kind: string; id?: string };
  const gone = (scopeRef.kind === 'team' && !p.teams.some((t) => t.id === scopeRef.id)) || (scopeRef.kind === 'project' && !p.clients.some((c) => c.id === scopeRef.id));
  const scope: TaskScope = gone ? { kind: 'mine' } : p.scope;
  // The company's own stages: board columns, grouping, the Start button and what each row says.
  const stages = stagesFor(p.workspace.id);
  const client = scope.kind === 'client' ? p.clients.find((c) => c.id === scope.id) : undefined;
  const project = scope.kind === 'project' ? p.clients.find((c) => c.id === scope.id) : undefined;
  const team = scope.kind === 'team' ? p.teams.find((t) => t.id === scope.id) : undefined;
  const cellTeam = scope.kind === 'client' && scope.teamId ? p.teams.find((t) => t.id === scope.teamId) : undefined;
  const person = (id?: string) => p.users.find((u) => u.id === id);
  const clientOf = (id?: string) => p.clients.find((c) => c.id === id);
  const teamOf = (id?: string) => p.teams.find((t) => t.id === id);
  const today = localDay();

  // What this page is about (briefs are shown as cards, not rows).
  const scoped = useMemo(() => {
    const work = p.tasks.filter((t) => !isBrief(t));
    switch (scope.kind) {
      case 'mine':
        return work.filter((t) => doers(t).includes(p.me));
      case 'today':
        return work.filter((t) => doers(t).includes(p.me) && (t.done ? (t.doneAt ?? '').slice(0, 10) === today || t.due === today : !!t.due && t.due <= today));
      case 'upcoming':
        return work.filter((t) => doers(t).includes(p.me) && (!!t.due || t.done));
      case 'project':
        return work.filter((t) => t.clientId === scope.id);
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
  }, [p.tasks, scope, p.me, today]);

  const briefs = useMemo(() => {
    const all = p.tasks.filter(isBrief);
    switch (scope.kind) {
      case 'mine':
        return all.filter((b) => !b.done && (b.userId === p.me || scoped.some((t) => t.briefId === b.id)));
      case 'delegated':
        return all.filter((b) => !b.done && b.createdBy === p.me);
      case 'client':
      case 'project':
        return all.filter((b) => b.clientId === scope.id && (scope.kind === 'client' || !b.done));
      case 'team':
        return all.filter((b) => !b.done && scoped.some((t) => t.briefId === b.id));
      case 'briefs':
        return all;
      case 'today':
      case 'upcoming':
        return [];
      default:
        return all.filter((b) => !b.done);
    }
  }, [p.tasks, scope, p.me, scoped]);

  const open = scoped.filter((t) => !t.done).sort(byDue);
  const overdue = open.filter(late).length;

  // The phone's title switcher: every place in Tasks, with the counts worth acting on.
  const workAll = p.tasks.filter((t) => !isBrief(t) && !t.done);
  const lateMine = workAll.filter((t) => doers(t).includes(p.me) && late(t)).length;
  const todayMine = workAll.filter((t) => doers(t).includes(p.me) && t.due === today).length;
  const toReview = workAll.filter((t) => t.supervisorId === p.me && kindOf(t) === 'review').length;
  const myTeams = p.teams.filter((t) => p.canManage || p.myTeamIds.includes(t.id));
  const myProjects = p.clients.filter((c) => c.status !== 'ended' && (p.canManage || p.myClientIds.includes(c.id)));
  const scopeValue = scope.kind === 'team' || scope.kind === 'project' || scope.kind === 'client' ? `${scope.kind}:${scope.id}` : scope.kind;
  useTitleMenu('tasks', {
    label: 'Which tasks',
    value: scopeValue,
    options: [
      { value: 'mine', label: 'My tasks', hint: lateMine ? `${lateMine} late` : undefined, group: 'Tasks' },
      { value: 'today', label: 'Today', hint: todayMine + lateMine ? `${todayMine + lateMine} to do` : undefined, group: 'Tasks' },
      { value: 'upcoming', label: 'Upcoming', group: 'Tasks' },
      { value: 'supervising', label: 'Supervising', hint: toReview ? `${toReview} to review` : undefined, group: 'Tasks' },
      { value: 'delegated', label: 'Assigned by me', group: 'Tasks' },
      { value: 'briefs', label: 'Briefs', group: 'Tasks' },
      ...(p.canManage ? [{ value: 'all', label: 'Everything', group: 'Tasks' }] : []),
      ...myTeams.map((tm) => {
        const n = workAll.filter((t) => t.teamId === tm.id && !doers(t).length).length;
        return { value: `team:${tm.id}`, label: tm.name, hint: n ? `${n} not assigned` : undefined, icon: <span className="ts-dot"><Dot color={tm.color} /></span>, group: 'Team queues' };
      }),
      ...myProjects.map((c) => {
        const n = workAll.filter((t) => t.clientId === c.id && late(t)).length;
        return { value: `project:${c.id}`, label: c.name, hint: n ? `${n} late` : undefined, icon: <span className="ts-dot"><Dot color={c.color} /></span>, group: term.Many };
      }),
      { value: 'dump', label: 'Brain dump', hint: 'Turn notes into tasks', group: 'More' },
      ...(p.onPastProjects ? [{ value: 'past', label: `Past ${term.many}`, group: 'More' }] : []),
      ...views.map((v) => ({ value: `view:${v.id}`, label: v.name, group: 'Your views' })),
    ],
    onChange: (v) => {
      if (v === 'dump') return p.onBrainDump();
      if (v === 'past') return p.onPastProjects?.();
      if (v.startsWith('view:')) {
        const view = views.find((x) => x.id === v.slice(5));
        if (view?.display) saveDisplay(view.scope.kind, view.display);
        if (view) p.onScope(view.scope as TaskScope);
        return;
      }
      const [k, id] = v.split(':');
      p.onScope(id ? ({ kind: k, id } as TaskScope) : ({ kind: k } as TaskScope));
    },
  });

  const heading =
    scope.kind === 'today'
      ? 'Today'
      : scope.kind === 'upcoming'
        ? 'Upcoming'
        : scope.kind === 'project'
          ? (project?.name ?? term.One)
          : scope.kind === 'supervising'
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

  // A brief in a task list: one line (title, project, what's next, progress); the full card lives on the Briefs page.
  const briefRow = (b: Todo) => {
    const subs = p.tasks.filter((t) => t.briefId === b.id);
    const doneN = subs.filter((t) => t.done).length;
    const next = subs.filter((t) => !t.done).sort((a, c) => (a.due ?? '9').localeCompare(c.due ?? '9'))[0];
    const c = clientOf(b.clientId);
    const owner = person(b.userId);
    return (
      <button key={b.id} className={`brief-row ${b.done ? 'done' : ''}`} onClick={() => p.onOpenTask(b.id)}>
        <FileText size={14} className="br-icon" />
        <span className="br-text">
          <strong>{b.title}</strong>
          <small className="muted">
            {[c && scope.kind !== 'client' ? c.name : '', next ? `Next: ${next.title}${next.due ? ` · ${dueLabel(next.due).text}` : ''}` : subs.length ? 'All tasks done' : 'No tasks yet'].filter(Boolean).join(' · ')}
          </small>
        </span>
        <span className="bc-progress">
          <span className="bar">
            <span style={{ width: `${subs.length ? (doneN / subs.length) * 100 : 0}%` }} />
          </span>
          {doneN}/{subs.length}
        </span>
        {owner && <Avatar person={owner} size={22} />}
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
                        <ProjectBadge p={c} kind="client-dot sm" />
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
  // What the task screens can do: read and change tasks the way the rest of the app does.
  const ops: TaskOps = {
    me: p.me,
    today,
    wsId: p.workspace.id,
    tasks: p.tasks,
    users: p.users,
    clients: p.clients,
    teams: p.teams,
    stages,
    open: p.onOpenTask,
    status: p.onStatus,
    patch: p.onPatch,
    remove: (ids, quiet) => p.onDelete(ids, quiet),
    add: p.onAdd,
    toCalendar: p.onToCalendar,
  };
  const addDefaults =
    scope.kind === 'team'
      ? { userId: '', teamId: scope.id }
      : scope.kind === 'client'
        ? { clientId: scope.id, teamId: scope.teamId }
        : scope.kind === 'project'
          ? { clientId: scope.id }
          : scope.kind === 'today'
            ? { due: today }
            : {};
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

  // Admins, the owner and the project's Leads manage a project: its status, people, guests and their access.
  const projectManage = !!client && (p.canManage || client.ownerId === p.me || (client.members ?? []).some((m) => m.userId === p.me && m.role === 'lead'));
  return (
    <section className={`tasks-pane view-enter scope-${scope.kind}`}>
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        {client && <ProjectPhotoButton p={client} onChange={(photo) => p.onPatchClient(client.id, { photo })} />}
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
            {client && projectManage ? (
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
              {projectManage && (
                <button className="ghost-btn sm" onClick={() => p.onReactivateClient(client.id)}>
                  <RotateCcw size={13} /> Work with them again
                </button>
              )}
            </span>
          ) : (
            projectManage && (
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
        {client && <ProjectPeople client={client} users={p.users} me={p.me} canEdit={projectManage} canInvite={projectManage || !!p.canInviteGuests} onPatch={(x) => p.onPatchClient(client.id, x)} onGuests={() => setClientTab('portal')} />}
        <button className="ghost-btn sm tpl-btn" onClick={p.onTemplate} title="Start from a template">
          <LayoutTemplate size={14} /> <span>Template</span>
        </button>
        {!p.dumpInSidebar && (
          <button className={`${showTaskList ? 'ghost-btn' : 'primary-btn'} sm brain-btn`} onClick={p.onBrainDump}>
            <Sparkles size={14} /> Brain dump
          </button>
        )}
        {project && p.onOpenProject && (
          <button className="ghost-btn sm" onClick={() => p.onOpenProject!(project.id)}>
            Open the {term.one} <ChevronRight size={14} />
          </button>
        )}
      </header>

      {client && (
        <TabBar
          storageKey="project-tabs"
          value={clientTab}
          onSelect={(id) => setClientTab(id as typeof clientTab)}
          fixed={['overview']}
          items={(
            [
              ['overview', 'Overview', 'Overview'],
              ['tasks', overdue ? `Tasks · ${overdue} late` : 'Tasks', 'Tasks'],
              ['workload', 'Workload', 'Workload'],
              ...(p.onQuote ? ([['quotes', (p.quotes ?? []).some((q) => q.clientId === client.id && q.status === 'sent') ? 'Quotes · waiting' : 'Quotes', 'Quotes']] as const) : []),
              ['chat', 'Chat', 'Chat'],
              ['emails', clientThreads.filter((t) => t.unread).length ? `Mail · ${clientThreads.filter((t) => t.unread).length} unread` : 'Mail', 'Mail'],
              ['meetings', 'Meetings', 'Meetings'],
              ['files', 'Files', 'Files'],
              ['notes', 'Notes', 'Notes'],
              ...(p.onOpenTable ? ([['tables', 'Tables', 'Tables']] as const) : []),
              ['logins', 'Logins', 'Logins'],
              ['portal', 'Guests', 'Guests'],
            ] as const
          ).map(([id, label, name]) => ({ id, label, name }))}
          extra={
            cellTeam && (
              <button className="on soft" onClick={() => p.onScope({ kind: 'client', id: client.id })}>
                {cellTeam.name} only · show all teams
              </button>
            )
          }
        />
      )}

      <div className="tracking-scroll" key={`${JSON.stringify(scope)}:${clientTab}`}>
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

        {briefs.length > 0 && scope.kind === 'briefs' && <div className="brief-list">{briefs.map(briefCard)}</div>}
        {briefs.length > 0 && scope.kind !== 'briefs' && (!client || clientTab === 'tasks') && scope.kind !== 'grid' && (
          <div className="brief-rows">
            <button type="button" className="brief-rows-head" onClick={() => setBriefsOpen((x) => !x)} aria-expanded={briefsOpen}>
              <ChevronRight size={14} className={`rot-chev ${briefsOpen ? 'open' : ''}`} />
              Briefs <span className="muted">{briefs.length}</span>
            </button>
            <div className={`fold ${briefsOpen ? 'open' : ''}`}>
              <div className="fold-in">{briefs.map(briefRow)}</div>
            </div>
          </div>
        )}
        {scope.kind === 'briefs' && briefs.length === 0 && (
          <EmptyState
            icon={<FileText size={22} />}
            title="No briefs yet"
            text="In a brain dump, choose “Brief” to turn a bigger job into a brief with tasks for each person."
          />
        )}

        {showTaskList && (
          <TaskViews
            ops={ops}
            kind={scope.kind}
            scopeId={'id' in scope ? scope.id : undefined}
            tasks={scoped}
            label={scope.kind === 'team' ? `${team?.name ?? 'Team'} queue` : heading}
            canAdd
            addDefaults={addDefaults}
            addKey={p.addKey}
            onBrainDump={p.onBrainDump}
            views={views}
            onViews={setViews}
            onScope={(s) => p.onScope(s as TaskScope)}
            triage={scope.kind === 'team' || scope.kind === 'myteams'}
          />
        )}

        <TabPane key={clientTab}>
        {client && clientTab === 'overview' && (
          <div className="hub-overview">
            {(() => {
              // What needs doing for this client, not how much there is.
              const today = localDay();
              const items: { key: string; text: string; sub: string; run: () => void; tone?: string }[] = [
                ...open.filter((t) => t.due && t.due < today).map((t) => ({ key: 'l' + t.id, text: t.title, sub: `Late, ${person(t.userId)?.name.split(' ')[0] ?? 'nobody'} on it`, run: () => p.onOpenTask(t.id), tone: 'warn' })),
                ...open.filter((t) => t.source === 'request' && kindOf(t, stages) === 'open').map((t) => ({ key: 'r' + t.id, text: t.title, sub: `New request from the ${term.who}`, run: () => p.onOpenTask(t.id) })),
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
                    <EmptyState compact text={<>Nothing needs you for {client.name}.{clientMeetings[0] ? ` Last meeting ${relative(clientMeetings[0].at)}.` : ''}</>} />
                  )}
                </div>
              );
            })()}
            <div className="side-card client-notes-card">
              <h3>
                Notes
                <button className="ghost-btn sm" onClick={() => p.onNewNote(client.id)}>
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
                <EmptyState compact text={<>No notes for {client.name} yet. Meeting prep, preferences, who’s who: write it once, the whole team sees it here.</>} />
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
                  {!open.length && <EmptyState compact text="Nothing open. Add a task on the Tasks tab, or start a brief from a template." />}
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

        {client && clientTab === 'workload' && <ProjectWorkload tasks={p.tasks.filter((t) => t.clientId === client.id && !isBrief(t))} people={[...new Set([client.ownerId, ...(client.members ?? []).map((m) => m.userId)].filter(Boolean) as string[])]} users={p.users} me={p.me} onOpenTask={p.onOpenTask} />}
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
                            {g && <Badge small tone="warn">{term.Who}</Badge>}
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
              <EmptyState compact text={<>{client.name} has no channel yet. Create one in Chat and pick “{term.One} (internal)” or “Shared”.</>} />
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
            {!clientFiles.length && <EmptyState compact text={<>No files for {client.name} yet. Files shared in its channel and saved in its Drive folder show here.</>} />}
          </div>
        )}

        {client && clientTab === 'emails' && (
          <div className="te-list">
            {clientThreads.length === 0 && <EmptyState compact text={<>{client.domain ? `No emails with @${client.domain} yet. They show up here as soon as someone there writes.` : `Add ${client.name}’s email domain to see their emails here.`}</>} />}
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
            {clientMeetings.length === 0 && <EmptyState compact text={<>No recorded meetings with {client.name} yet. Send the notetaker to your next call with them (Meet, Send bot).</>} />}
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
              <EmptyState compact text={<>No notes for {client.name} yet.</>} />
            )}
          </div>
        )}
        {client && clientTab === 'quotes' && p.onQuote && (
          <div className="tracking-scroll proj-tab">
            <QuotesTab client={client} quotes={p.quotes ?? []} users={p.users} me={p.me} canEdit={projectManage} onSave={p.onQuote.save} onDelete={p.onQuote.remove} onSend={p.onQuote.send} onBrief={p.onQuote.brief} onOpenBrief={p.onOpenTask} />
          </div>
        )}
        {client && clientTab === 'tables' && (
          <div className="tracking-scroll proj-tab">
            <ProjectTables tables={(p.tables ?? []).filter((t) => t.clientId === client.id)} rows={p.tableRows ?? []} onOpen={(id) => p.onOpenTable?.(id)} onNew={() => p.onNewTable?.(client.id)} />
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
              <EmptyState compact text={<>No logins for {client.name} yet. Add the ad accounts, social logins and tools you share with the team.</>} />
            )}
          </div>
        )}
        {client && clientTab === 'portal' && (() => {
          const access = accessFor(p.workspace, client);
          const company = accessFor(p.workspace, { type: client.type }); // what this project would have without its own changes
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
                      <PersonCell person={{ name: g.name, email: g.email, color: client.color }} sub={[companyOf(g.email, g.company, client), g.email].filter(Boolean).join(' · ')} />
                      {g.status === 'pending' ? (
                        <>
                          <Badge tone="warn">Asked to join</Badge>
                          {projectManage && (
                            <button className="primary-btn sm" onClick={() => p.onApproveClientPerson(client.id, g.email)}>
                              Approve
                            </button>
                          )}
                        </>
                      ) : (
                        <Badge tone={g.status === 'joined' ? 'good' : 'neutral'}>{g.status === 'joined' ? 'Joined' : 'Invited'}</Badge>
                      )}
                      {p.workspace.whatsapp?.connected && g.phone && (
                        <button type="button" className="icon-btn sm wa-btn" title={`WhatsApp ${g.phone}`} aria-label={`WhatsApp ${g.name}`} onClick={() => setWaTo(g)}>
                          <MessageCircle size={14} />
                        </button>
                      )}
                      <Select<ClientPerson['role']>
                        value={g.role}
                        onChange={(role) => setPeople(people.map((x) => (x.email === g.email ? { ...x, role } : x)))}
                        label="Role"
                        className="sel-flat"
                        disabled={!projectManage}
                        options={(['viewer', 'collaborator', 'approver'] as const).map((r) => ({ value: r, label: ROLE_NAME[r], hint: ROLE_HINT[r] }))}
                      />
                      {projectManage && (
                        <button className="icon-btn sm" aria-label="Remove access" title="Remove access" onClick={() => setPeople(people.filter((x) => x.email !== g.email))}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {(projectManage || p.canInviteGuests) ? (
                  <div className="pa-invite">
                    <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Name" />
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={client.domain ? `name@${client.domain}` : 'name@company.com'} />
                    <input value={inviteCompany} onChange={(e) => setInviteCompany(e.target.value)} placeholder={companyOf(inviteEmail.trim(), undefined, client) ?? 'Company (optional)'} />
                    {p.workspace.whatsapp?.connected && <input value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder="WhatsApp, e.g. +62 812…" />}
                    <button
                      className="ghost-btn sm"
                      disabled={!inviteName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim()) || people.some((x) => x.email.toLowerCase() === inviteEmail.trim().toLowerCase())}
                      onClick={() => {
                        p.onInviteClientPerson(client.id, { name: inviteName.trim(), email: inviteEmail.trim().toLowerCase(), role: 'collaborator', company: inviteCompany.trim() || undefined, phone: invitePhone.trim() || undefined });
                        setInviteName('');
                        setInvitePhone('');
                        setInviteCompany('');
                        setInviteEmail('');
                      }}
                    >
                      <Plus size={13} /> Invite
                    </button>
                  </div>
                  ) : (
                    <p className="muted small">Only this {term.one}’s Lead or an admin can invite guests.</p>
                  )}

                  {waTo && <WhatsAppDialog to={waTo} workspaceId={p.workspace.id} channelId={p.channels.find((c) => c.clientId === client.id && c.category === 'shared' && !c.archived)?.id} onClose={() => setWaTo(null)} />}
                  <h4>Settings for {client.name}</h4>
                  <ClientAccessForm
                    value={access}
                    company={company}
                    overrides={client.access}
                    teams={p.teams}
                    canManage={projectManage}
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

/** Who on a project has how much of its open work: late first; open someone to see their list. */
function ProjectWorkload({ tasks, people, users, me, onOpenTask }: { tasks: Todo[]; people: string[]; users: User[]; me: string; onOpenTask: (id: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const today = dayStr(new Date());
  const week = dayStr(new Date(Date.now() + 7 * 86_400_000));
  const open = tasks.filter((t) => !t.done);
  const doers = (t: Todo) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
  const ids = [...new Set([...people, ...open.flatMap(doers)])];
  const rows = ids
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean)
    .map((u) => {
      const mine = open.filter((t) => doers(t).includes(u!.id)).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
      return { u: u!, mine, late: mine.filter((t) => t.due && t.due < today).length, soon: mine.filter((t) => t.due && t.due >= today && t.due <= week).length };
    })
    .sort((a, b) => b.late - a.late || b.mine.length - a.mine.length);
  const nobody = open.filter((t) => !doers(t).length);
  const most = Math.max(1, ...rows.map((r) => r.mine.length));
  const list = (items: Todo[]) => (
    <div className="team-load-list">
      {items.length === 0 && <p className="muted small">Nothing open.</p>}
      {items.map((t) => (
        <button key={t.id} type="button" className="team-mini" onClick={() => onOpenTask(t.id)}>
          <span>{t.title}</span>
          {t.due && <small className={t.due < today ? 'bad' : 'muted'}>{new Date(`${t.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>}
        </button>
      ))}
    </div>
  );
  return (
    <div className="team-sec proj-workload">
      <p className="muted small">This project’s open work, per person. Late work first; open someone to see their list.</p>
      <div className="team-block">
        {rows.map(({ u, mine, late, soon }) => (
          <div key={u.id} className="team-load">
            <button type="button" className="team-row" onClick={() => setOpenId(openId === u.id ? null : u.id)} aria-expanded={openId === u.id}>
              <PersonCell person={u} badges={u.id === me && <Badge tone="accent">You</Badge>} sub={[late && `${late} late`, soon && `${soon} due this week`, !mine.length && 'Nothing open here'].filter(Boolean).join(' · ') || `${mine.length} open`} />
              <span className="team-bar" aria-hidden>
                <i style={{ width: `${(mine.length / most) * 100}%` }} className={late ? 'bad' : ''} />
              </span>
              <span className="team-count">{mine.length}</span>
              <ChevronRight size={14} className={`rot-chev ${openId === u.id ? 'open' : ''}`} />
            </button>
            <div className={`fold ${openId === u.id ? 'open' : ''}`}>
              <div className="fold-in">{list(mine)}</div>
            </div>
          </div>
        ))}
        {nobody.length > 0 && (
          <div className="team-load">
            <button type="button" className="team-row" onClick={() => setOpenId(openId === '-' ? null : '-')} aria-expanded={openId === '-'}>
              <span className="avatar-empty">?</span>
              <span className="team-row-text">
                <strong>Not picked up yet</strong>
                <small className="muted">Nobody is doing these</small>
              </span>
              <span className="team-count">{nobody.length}</span>
              <ChevronRight size={14} className={`rot-chev ${openId === '-' ? 'open' : ''}`} />
            </button>
            <div className={`fold ${openId === '-' ? 'open' : ''}`}>
              <div className="fold-in">{list(nobody)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A WhatsApp message to one guest, sent through the company's number; it's kept in the project's shared channel too. */
function WhatsAppDialog({ to, workspaceId, channelId, onClose }: { to: ClientPerson; workspaceId: string; channelId?: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true);
    setErr('');
    const r = await fetch('/api/whatsapp/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, to: to.phone, text, channelId }) });
    setBusy(false);
    if (!r.ok) return setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t send.');
    onClose();
  };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={`WhatsApp ${to.name}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span>
            <MessageCircle size={14} /> WhatsApp to {to.name} · {to.phone}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your message" />
          {err && <p className="err small">{err}</p>}
          <p className="muted small">Sent from the company’s WhatsApp number. {channelId ? 'A copy stays in the shared channel.' : ''} Outside a 24-hour conversation, Meta only allows approved templates.</p>
        </div>
        <footer className="modal-foot">
          <button className="ghost-btn sm" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn sm" disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </footer>
      </div>
    </div>
  );
}
