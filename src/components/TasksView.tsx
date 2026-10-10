import { TabBar } from './ui/TabBar';
import { ProjectPeople } from './ProjectPeople';
import { ProjectBadge, ProjectPhotoButton } from './ProjectBadge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { TabPane } from './ui/Smooth';
import { PROJECT_TYPES, term } from '../terms';
import { Archive, RotateCcw, Inbox, X, Brain, CheckCircle2, Clock, Columns3, Eye, EyeOff, FileText, Hash, LayoutGrid, LayoutTemplate, Mail, Menu, MessagesSquare, Plus, Sparkles, Users, Video, type LucideIcon, FolderInput, ChevronRight, MessageCircle, CalendarCheck2, CalendarRange, ListTodo, Send, Layers, SlidersHorizontal, Settings2, BarChart3, LayoutDashboard } from 'lucide-react';
import type { Channel, ChatMessage, Client, DriveItem, Meeting, TaskStatus, Team, Thread, Todo, User, ClientPerson, Workspace, Note, DataTable, TableRow } from '../types';
import { kindOf, stageOf, stagesFor, stagesForScope, toneOf } from '../stages';
import { OwnStages } from './admin/TaskStages';
import { Layer } from './ui/Layer';
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
import { useCreateAction } from '../mobile/chrome';
import { TopBar, TopBarBack } from '../mobile/TopBar';
import { usePhone } from '../mobile/media';
import { Sheet } from './ui/Sheet';
import type { SheetAction } from './ui/ActionSheet';
import type { TopSettingsRow } from './MobileTop';
import { TaskViews, type SavedTaskView, type PhoneBar } from './tasks/TaskViews';
import { TasksBrowse, type BrowseGroup } from './tasks/TasksBrowse';
import { QuickAdd } from './tasks/QuickAdd';
import type { NewTask, TaskOps } from './tasks/taskOps';
import { saveDisplay } from './tasks/display';
import { projectTabIcon, projectTabs, ProjectSections, useProjectParts, useProjectPhone, type ProjectTab } from './ProjectPhone';
import { t, textOf, tn, tx } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtDate, fmtDay, fmtNumber, fmtWeekday } from '../i18n/format';
import type { TaskEvent } from '../types';

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

// A guest's role and what it allows, in the reader's language.
export const ROLE_NAME: Record<ClientPerson['role'], string> = {
  get viewer() {
    return t('Viewer');
  },
  get collaborator() {
    return t('Collaborator');
  },
  get approver() {
    return t('Approver');
  },
};
export const ROLE_HINT: Record<ClientPerson['role'], string> = {
  get viewer() {
    return t('Reads only');
  },
  get collaborator() {
    return t('Comments, uploads, sends requests');
  },
  get approver() {
    return t('Also approves work');
  },
};
export const SOURCE: Record<Todo['source'], { icon: LucideIcon; label: string }> = {
  ai: { icon: Mail, get label() { return t('From email'); } },
  manual: { icon: Plus, get label() { return t('Added by hand'); } },
  braindump: { icon: Brain, get label() { return t('From a brain dump'); } },
  chat: { icon: MessagesSquare, get label() { return t('From chat'); } },
  meeting: { icon: Video, get label() { return t('From a meeting'); } },
  request: { icon: Inbox, get label() { return t('{Who} request', { who: term.who }); } },
  import: { icon: FolderInput, get label() { return t('Imported'); } },
};
/**
 * A line of a task's history in the reader's language: what the app wrote since it keeps a `tr` (msg()); older lines
 * as saved, translated when they're one of the app's fixed words ("marked it done"). Comments are what people typed.
 */
export const historyText = (h: Pick<TaskEvent, 'kind' | 'text' | 'tr'>) => (h.kind === 'comment' ? h.text : h.tr ? textOf(h) : t(h.text));
/** A task's stage id (one of its company's stages; see src/stages.ts). */
export const statusOf = (t: Todo): TaskStatus => stageOf(t).id;
/** A stage's colour dot: filled when done, hollow when not started. */
export const StageDot = ({ t, className = '' }: { t: Pick<Todo, 'status' | 'done' | 'workspaceId'> & Partial<Pick<Todo, 'clientId' | 'teamId'>>; className?: string }) => {
  const s = stageOf(t);
  return <span className={`stage-dot k-${s.kind} tone-${toneOf(s)} ${className}`} />;
};
/** Everyone doing a task (older tasks only have userId). */
export const doers = (t: Todo) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
export const isBrief = (t: Todo) => t.kind === 'brief';

const dayStr = (d: Date) => localDay(d);
const enDay = (due: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(due + 'T12:00'));
/** A due date's words and colour class. `text` is in the reader's language; `en` is the English, for words saved in a msg(). */
export function dueLabel(due: string) {
  const today = dayStr(new Date());
  const tomorrow = dayStr(new Date(Date.now() + 86_400_000));
  if (due < today) return { text: tx('due', 'Overdue'), en: 'Overdue', cls: 'overdue' };
  if (due === today) return { text: t('Today'), en: 'Today', cls: 'today' };
  if (due === tomorrow) return { text: t('Tomorrow'), en: 'Tomorrow', cls: 'soon' };
  return { text: fmtWeekday(due), en: enDay(due), cls: '' };
}
const late = (t: Todo) => !t.done && !!t.due && t.due < dayStr(new Date());
const byDue = (a: Todo, b: Todo) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0);

/** Options for "who": teammates, plus "Not assigned" (the team's queue). */
export function peopleOptions(users: User[], me: string, unassigned = true): Option[] {
  return [
    ...(unassigned ? [{ value: '', label: t('Not assigned'), hint: t('Waits in the team’s queue'), icon: <span className="avatar-empty sm">?</span> }] : []),
    ...users.map((u) => ({ ...personOption(u), label: u.id === me ? t('{name} (me)', { name: u.name }) : u.name, hint: u.title, icon: <Avatar person={u} size={22} /> })),
  ];
}
export const teamOptions = (teams: Team[]): Option[] => [{ value: '', label: t('No team'), icon: <Dot color="var(--text-3)" /> }, ...teams.map((tm) => ({ value: tm.id, label: tm.name, icon: <Dot color={tm.color} /> }))];
/** Clients to pick from: past clients only when it's the one already set. */
export const clientOptions = (clients: Client[], current?: string): Option[] => [
  { value: '', label: t('No {project}', { project: term.one }), icon: <Dot color="var(--text-3)" /> },
  ...clients.filter((c) => c.status !== 'ended' || c.id === current).map((c) => ({ value: c.id, label: c.name, hint: c.status === 'lead' ? tx('status', 'Lead') : c.status === 'ended' ? t('Past {project}', { project: term.one }) : undefined, icon: <Dot color={c.color} /> })),
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
  onOpenProject?: (id: string, tab?: ProjectTab) => void; // a project's own page (the Projects app), at one of its parts
  onPastProjects?: () => void;
  /** Phones: which app's top bar this fills (a project's page lives in Projects). */
  app?: 'tasks' | 'projects';
  /** Phones: Browse, the root of the Tasks stack (Todoist's Browse), instead of a view. */
  browse?: boolean;
  onBrowse?: (on: boolean) => void;
  /** Phones: this app's settings (Swipe actions, Task stages), listed at the end of Browse. */
  settings?: TopSettingsRow[];
  onNewProject?: () => void;
}

/** A sub-screen's name in the phone's top bar, after the back arrow: 17/600. */
function BarTitle({ text }: { text: string }) {
  return (
    <h1 className="mt-title plain small">
      <span className="mt-title-text">{text}</span>
    </h1>
  );
}

export function TasksView(p: Props) {
  const [briefsOpen, setBriefsOpen] = usePersisted('s2g-briefs-open', true);
  const [views, setViews] = usePersisted<SavedTaskView[]>('s2g-task-views', []);
  const [clientTab, setClientTab] = useState<'overview' | 'tasks' | 'workload' | 'quotes' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'tables' | 'logins' | 'portal'>('overview');
  const [writingOv, setWritingOv] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false); // the project's own task stages (a dialog from its header)
  const scopeId = 'id' in p.scope ? p.scope.id : '';
  const phone = usePhone();
  // From Tasks a project opens on its tasks (Todoist's project screen); from Projects on its hub, the overview with
  // every part as a row (a project is more than its task list). Back from a part returns to that home.
  const homeTab = phone && (p.app ?? 'tasks') === 'tasks' ? 'tasks' : 'overview';
  useEffect(() => {
    if (p.scope.kind === 'client') setClientTab(p.scope.teamId ? 'tasks' : (p.clientTab ?? homeTab));
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
  const client = scope.kind === 'client' ? p.clients.find((c) => c.id === scope.id) : undefined;
  const project = scope.kind === 'project' ? p.clients.find((c) => c.id === scope.id) : undefined;
  const team = scope.kind === 'team' ? p.teams.find((t) => t.id === scope.id) : undefined;
  // The board's columns and stage groups: the project's or team's own stages on its page, else the company's. Each
  // task's own row (its stage, Start, Approve) follows its own stages (src/stages.ts, stagesForTask).
  const stages = stagesForScope(p.workspace.id, { clientId: client?.id ?? project?.id, teamId: team?.id ?? (scope.kind === 'client' ? scope.teamId : undefined) });
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
  // Phones: Browse, every place in Tasks as Todoist's grouped cards, with what's worth acting on at the right.
  const app = p.app ?? 'tasks';
  const go = (s: TaskScope) => (p.onBrowse?.(false), p.onScope(s));
  const browseGroups: BrowseGroup[] = [
    {
      id: 'mine',
      rows: [
        { id: 'today', label: t('Today'), icon: <CalendarCheck2 size={22} />, hint: lateMine ? tn(lateMine, '{n} late', '{n} late') : todayMine ? tn(todayMine, '{n} to do', '{n} to do') : undefined, tone: lateMine ? 'danger' : undefined, run: () => go({ kind: 'today' }) },
        { id: 'upcoming', label: t('Upcoming'), icon: <CalendarRange size={22} />, run: () => go({ kind: 'upcoming' }) },
        { id: 'mine', label: t('My tasks'), icon: <ListTodo size={22} />, run: () => go({ kind: 'mine' }) },
      ],
    },
    {
      id: 'team',
      title: t('Team'),
      rows: [
        { id: 'supervising', label: t('Supervising'), icon: <Eye size={22} />, hint: toReview ? tn(toReview, '{n} to review', '{n} to review') : undefined, tone: 'accent' as const, run: () => go({ kind: 'supervising' }) },
        { id: 'delegated', label: t('Assigned by me'), icon: <Send size={22} />, run: () => go({ kind: 'delegated' }) },
        ...myTeams.map((tm) => {
          const n = workAll.filter((x) => x.teamId === tm.id && !doers(x).length).length;
          return { id: `team:${tm.id}`, label: tm.name, icon: <span className="tbr-hash" style={{ color: tm.color }}>#</span>, hint: n ? tn(n, '{n} not assigned', '{n} not assigned') : undefined, run: () => go({ kind: 'team', id: tm.id }) };
        }),
        { id: 'briefs', label: t('Briefs'), icon: <FileText size={22} />, run: () => go({ kind: 'briefs' }) },
        ...(p.canManage ? [{ id: 'all', label: t('Everything'), icon: <Layers size={22} />, run: () => go({ kind: 'all' }) }] : []),
      ],
    },
    {
      id: 'projects',
      title: term.Many,
      add: p.onNewProject ? { label: t('New {project}', { project: term.one }), run: p.onNewProject } : undefined,
      rows: [
        ...myProjects.map((c) => {
          const n = workAll.filter((x) => x.clientId === c.id && late(x)).length;
          return {
            id: `project:${c.id}`,
            label: c.name,
            icon: <span className="tbr-hash" style={{ color: c.color }}>#</span>,
            hint: n ? tn(n, '{n} late', '{n} late') : c.status === 'lead' ? tx('status', 'Lead') : undefined,
            tone: n ? ('danger' as const) : undefined,
            run: () => go({ kind: 'project', id: c.id }),
            menu: p.onOpenProject
              ? [
                  { label: t('Open overview'), icon: LayoutDashboard, run: () => p.onOpenProject!(c.id, 'overview') },
                  ...(p.canManage || c.ownerId === p.me ? [{ label: t('End work'), icon: Archive, danger: true, group: 'end', run: () => p.onEndClient(c.id) }] : []),
                ]
              : undefined,
          };
        }),
        ...(p.onPastProjects ? [{ id: 'past', label: t('Past {projects}', { projects: term.many }), icon: <Archive size={22} />, muted: true, run: () => p.onPastProjects!() }] : []),
      ],
    },
    {
      id: 'views',
      title: t('Your views'),
      rows: views.map((v) => ({
        id: `view:${v.id}`,
        label: v.name,
        icon: <SlidersHorizontal size={22} />,
        run: () => {
          if (v.display) saveDisplay(v.scope.kind, v.display);
          go(v.scope as TaskScope);
        },
        menu: [{ label: t('Delete view'), icon: X, danger: true, run: () => setViews(views.filter((x) => x.id !== v.id)) }],
      })),
    },
    {
      id: 'settings',
      title: t('Settings'),
      rows: (p.settings ?? []).map((s) => ({ id: s.id, label: s.label, icon: <Settings2 size={22} />, run: s.run })),
    },
  ];
  // Browse's create button: Quick Add for My tasks, straight from the tap (iPhone only opens the keyboard for focus
  // given during the tap).
  const [browseAdd, setBrowseAdd] = useState(false);
  const browseField = useRef<HTMLTextAreaElement>(null);
  const showBrowse = phone && !!p.browse && app === 'tasks';
  useCreateAction('tasks', showBrowse && { label: t('New task'), icon: Plus, run: () => (flushSync(() => setBrowseAdd(true)), browseField.current?.focus()), more: [{ label: t('Brain dump'), icon: Sparkles, run: p.onBrainDump }] });
  const [workloadOpen, setWorkloadOpen] = useState(false);

  const heading =
    scope.kind === 'today'
      ? t('Today')
      : scope.kind === 'upcoming'
        ? t('Upcoming')
        : scope.kind === 'project'
          ? (project?.name ?? term.One)
          : scope.kind === 'supervising'
      ? t('Supervising')
      : scope.kind === 'myteams'
        ? t('My teams')
        : scope.kind === 'myclients'
          ? t('My {projects}', { projects: term.many })
          : scope.kind === 'mine'
      ? t('My tasks')
      : scope.kind === 'delegated'
        ? t('Assigned by me')
        : scope.kind === 'all'
          ? t('All tasks')
          : scope.kind === 'briefs'
            ? t('Briefs')
            : scope.kind === 'grid'
              ? t('{Projects} × teams', { projects: term.many })
              : scope.kind === 'team'
                ? (team?.name ?? t('Team'))
                : `${client?.name ?? term.One}${cellTeam ? ` · ${cellTeam.name}` : ''}`;

  const briefCard = (b: Todo) => {
    const subs = p.tasks.filter((x) => x.briefId === b.id);
    const doneN = subs.filter((x) => x.done).length;
    const owner = person(b.userId);
    const c = clientOf(b.clientId);
    const pct = subs.length ? Math.round((doneN / subs.length) * 100) : 0;
    const teamsIn = [...new Set(subs.map((s) => s.teamId).filter(Boolean))].map((id) => teamOf(id)!).filter(Boolean);
    return (
      <button key={b.id} className={`brief-card ${b.done ? 'done' : ''}`} onClick={() => p.onOpenTask(b.id)}>
        <div className="bc-top">
          <span className="brief-badge">
            <FileText size={12} /> {t('Brief')}
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
              <Avatar person={owner} size={20} /> {owner.id === p.me ? t('You’re in charge') : t('{name} in charge', { name: owner.name.split(' ')[0] })}
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
    const subs = p.tasks.filter((x) => x.briefId === b.id);
    const doneN = subs.filter((x) => x.done).length;
    const next = subs.filter((x) => !x.done).sort((a, c) => (a.due ?? '9').localeCompare(c.due ?? '9'))[0];
    const c = clientOf(b.clientId);
    const owner = person(b.userId);
    return (
      <button key={b.id} className={`brief-row ${b.done ? 'done' : ''}`} onClick={() => p.onOpenTask(b.id)}>
        <FileText size={14} className="br-icon" />
        <span className="br-text">
          <strong>{b.title}</strong>
          <small className="muted">
            {[c && scope.kind !== 'client' ? c.name : '', next ? (next.due ? t('Next: {title} · {due}', { title: next.title, due: dueLabel(next.due).text }) : t('Next: {title}', { title: next.title })) : subs.length ? t('All tasks done') : t('No tasks yet')].filter(Boolean).join(' · ')}
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
                    <span className="muted">{t('No team')}</span>
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
                      <span className="muted">{t('Internal')}</span>
                    )}
                  </th>
                  {cols.map((tm) => {
                    const items = cell(c?.id ?? null, tm?.id ?? null);
                    const l = items.filter(late).length;
                    return (
                      <td key={tm?.id ?? 'none'}>
                        {items.length ? (
                          <button className={`cell ${l ? 'has-late' : ''}`} onClick={() => c && p.onScope({ kind: 'client', id: c.id, teamId: tm?.id })} disabled={!c}>
                            {tj('{n} open', { n: <b>{fmtNumber(items.length)}</b> })}
                            {l ? <em>{tn(l, '{n} late', '{n} late')}</em> : null}
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

  const clientThreads = client?.domain ? p.threads.filter((t) => t.messages.some((m) => [m.from, ...m.to, ...(m.cc ?? [])].some((x) => x.email.endsWith('@' + client.domain)))) : [];
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
  const nobodyOn = open.filter((x) => !x.userId).length;
  const dueToday = open.filter((x) => x.due === localDay()).length;
  const subtitle = client
    ? [
        client.status === 'lead' ? tx('status', 'Lead') : client.status === 'paused' ? t('Paused') : client.status === 'ended' ? [t('Past {project}', { project: term.one }), client.endReason ? t(client.endReason) : ''].filter(Boolean).join(' · ') : t('Active'),
        client.domain ? `@${client.domain}` : '',
        t('owner {name}', { name: person(client.ownerId)?.name ?? t('not set') }),
      ]
        .filter(Boolean)
        .join(' · ')
    : team
      ? [t('Lead: {name}', { name: person(team.leadId)?.name ?? t('not set') }), overdue ? tn(overdue, '{n} late', '{n} late') : '', nobodyOn ? tn(nobodyOn, '{n} nobody on it yet', '{n} nobody on it yet') : ''].filter(Boolean).join(' · ')
      : scope.kind === 'grid'
        ? t('Open work for every {project}, split by team. Click a cell to open it.', { project: term.one })
        : scope.kind === 'briefs'
          ? t('Bigger pieces of work with one person in charge and tasks for others')
          : [overdue ? tn(overdue, '{n} late', '{n} late') : '', dueToday ? tn(dueToday, '{n} due today', '{n} due today') : ''].filter(Boolean).join(' · ') || (open.length ? t('Nothing late or due today') : t('Nothing open'));

  // A project's parts: tabs on desktop; on phones its tasks first, the rest in its "…" (ProjectPhone.tsx).
  const tabItems = projectTabs({ late: overdue, unreadMail: clientThreads.filter((t) => t.unread).length, quotes: !!p.onQuote, quoteWaiting: !!client && (p.quotes ?? []).some((q) => q.clientId === client.id && q.status === 'sent'), tables: !!p.onOpenTable });
  useProjectPhone({ client, tab: clientTab, home: homeTab, onTab: setClientTab });
  const parts = useProjectParts(tabItems);

  // Admins, the owner and the project's Leads manage a project: its status, people, guests and their access.
  const projectManage = !!client && (p.canManage || client.ownerId === p.me || (client.members ?? []).some((m) => m.userId === p.me && m.role === 'lead'));

  /* ---------- Phones: the top bar (Todoist: "‹ Tasks", the view's name, one "…"; a project's people and layout) ---------- */
  const proj = client ?? project;
  const openPart = (tab: ProjectTab) => (client ? setClientTab(tab) : proj && (p.onOpenProject ? p.onOpenProject(proj.id, tab) : p.onScope({ kind: 'client', id: proj.id })));
  const projectMenu: SheetAction[] = proj
    ? [
        { label: t('Overview'), icon: LayoutDashboard, run: () => openPart('overview') },
        ...(client || p.onOpenProject
          ? parts
              .filter((x) => x.id !== 'overview' && x.id !== 'tasks')
              .map((x) => ({ label: x.name ?? x.id, icon: projectTabIcon(x.id), hint: x.note, group: 'parts', run: () => openPart(x.id as ProjectTab) }))
          : []),
        ...(client && projectManage ? [{ label: t('Stages'), icon: Columns3, group: 'manage', run: () => setStagesOpen(true) }] : []),
        ...(client && client.status !== 'ended' ? [{ label: t('Start from a template'), icon: LayoutTemplate, group: 'manage', run: p.onTemplate }] : []),
        ...(client && projectManage && client.status !== 'ended' ? [{ label: t('End work'), icon: Archive, danger: true, group: 'end', run: () => p.onEndClient(client.id) }] : []),
      ]
    : [];
  const teamMenu: SheetAction[] = team
    ? [
        { label: t('Workload'), icon: BarChart3, run: () => setWorkloadOpen(true) },
        ...(teamChannel ? [{ label: `#${teamChannel.name}`, icon: Hash, run: () => p.onOpenChannel(teamChannel.id) }] : []),
      ]
    : [];
  const projManage = !!proj && (p.canManage || proj.ownerId === p.me || (proj.members ?? []).some((m) => m.userId === p.me && m.role === 'lead'));
  const people = proj && (
    <ProjectPeople compact client={proj} users={p.users} me={p.me} canEdit={projManage} canInvite={projManage || !!p.canInviteGuests} onPatch={(x) => p.onPatchClient(proj.id, x)} onGuests={() => openPart('portal')} />
  );
  // Phones: Today, Upcoming, My tasks and Browse are the app's own bar (App's useAppSections) with the bar's own
  // "Tasks"; anything opened from Browse is a sub-screen: the back arrow and its name at 17/600.
  const root = phone && app === 'tasks' && !!p.onBrowse && (showBrowse || scope.kind === 'today' || scope.kind === 'upcoming' || scope.kind === 'mine');
  const sub = phone && !root;
  const backToBrowse = sub && app === 'tasks' && p.onBrowse ? <TopBarBack onClick={() => p.onBrowse!(true)} /> : undefined;
  const partName = client && clientTab !== 'tasks' ? (clientTab === 'overview' ? client.name : (tabItems.find((x) => x.id === clientTab)?.name ?? client.name)) : '';
  const phoneBar: PhoneBar | undefined = phone ? { app, lead: backToBrowse, title: sub ? <BarTitle text={heading} /> : undefined, people: app === 'tasks' ? undefined : people || undefined /* Tasks: the name keeps its room; people are on the project's hub */, more: [...projectMenu, ...teamMenu], stages: client && projectManage ? () => setStagesOpen(true) : undefined } : undefined;

  if (showBrowse)
    return (
      <>
        <TasksBrowse groups={browseGroups.filter((g) => g.id !== 'mine')} />
        {browseAdd && <QuickAdd ops={ops} defaults={{}} mode="sheet" where={t('My tasks')} inputRef={browseField} onClose={() => setBrowseAdd(false)} />}
      </>
    );

  if (scope.kind === 'past')
    return <PastClients clients={p.clients} tasks={p.tasks} canManage={p.canManage} onOpen={(id) => p.onScope({ kind: 'client', id })} onReactivate={p.onReactivateClient} />;

  return (
    <section className={`tasks-pane view-enter scope-${scope.kind}${client ? ` project-pane tab-${clientTab}` : ''}${showTaskList ? ' has-list' : ''}`}>
      {phone && !showTaskList && <TopBar app={app} lead={backToBrowse} title={sub ? <BarTitle text={partName || heading} /> : undefined} />}
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label={t('Open menu')}>
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
                label={t('Type')}
                className="sel-flat type-sel"
                options={[{ value: '', label: t('No type'), hint: t('A label to filter by') }, ...PROJECT_TYPES.map((ty) => ({ value: ty, label: t(ty) }))]}
              />
            ) : (
              client?.type && <em className="type-tag">{t(client.type)}</em>
            )}
            {subtitle}
          </p>
        </div>
        {client &&
          (client.status === 'ended' ? (
            <span className="client-ended">
              <span className="ended-chip">
                <Archive size={12} /> {client.endedAt ? t('Ended {date}', { date: fmtDate(client.endedAt, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('Ended')}
              </span>
              {projectManage && (
                <button className="ghost-btn sm" onClick={() => p.onReactivateClient(client.id)}>
                  <RotateCcw size={13} /> {t('Work with them again')}
                </button>
              )}
            </span>
          ) : (
            projectManage && (
              <span className="client-status">
                <Select<'lead' | 'active' | 'paused'>
                  value={client.status as 'lead' | 'active' | 'paused'}
                  onChange={(v) => p.onPatchClient(client.id, { status: v, ...(v === 'active' && !client.since ? { since: new Date().toISOString() } : {}) })}
                  label={t('Status')}
                  className="sel-flat"
                  options={[
                    { value: 'lead', label: tx('status', 'Lead'), hint: t('Not working together yet') },
                    { value: 'active', label: t('Active'), hint: t('Working together') },
                    { value: 'paused', label: t('Paused'), hint: t('On hold for now') },
                  ]}
                />
                <button className="ghost-btn sm" onClick={() => setStagesOpen(true)} title={t('This {project}’s task stages: the company’s, or its own', { project: term.one })}>
                  <Columns3 size={13} /> {t('Stages')}
                </button>
                <button className="ghost-btn sm" onClick={() => p.onEndClient(client.id)}>
                  {t('End work')}
                </button>
              </span>
            )
          ))}
        {client && stagesOpen && (
          <Layer>
            <div className="modal-scrim" onMouseDown={() => setStagesOpen(false)}>
              <div className="modal stages-modal" role="dialog" aria-label={t('Task stages for {name}', { name: client.name })} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop, .modal-scrim + .modal-scrim') && setStagesOpen(false)}>
                <header className="modal-head">
                  <span className="dump-title">
                    <Columns3 size={15} /> {t('Task stages for {name}', { name: client.name })}
                  </span>
                  <button type="button" className="icon-btn sm" onClick={() => setStagesOpen(false)} aria-label={t('Close')}>
                    <X size={15} />
                  </button>
                </header>
                <div className="modal-body">
                  <OwnStages
                    what="project"
                    name={client.name}
                    own={client.taskStages}
                    inherited={stagesFor(p.workspace.id)}
                    inheritedFrom={p.workspace.name || t('the company')}
                    canManage={projectManage}
                    tasks={p.tasks.filter((x) => x.clientId === client.id)}
                    teams={p.teams}
                    me={p.me}
                    wordsKey={p.workspace.terms?.word ?? ''}
                    onStages={(taskStages) => p.onPatchClient(client.id, { taskStages })}
                    onMoveTasks={(moves) => moves.forEach((m) => p.onPatch(m.id, m.patch))}
                  />
                </div>
                <footer className="modal-foot">
                  <button type="button" className="primary-btn sm" onClick={() => setStagesOpen(false)}>
                    {t('Done')}
                  </button>
                </footer>
              </div>
            </div>
          </Layer>
        )}
        {client && <ProjectPeople client={client} users={p.users} me={p.me} canEdit={projectManage} canInvite={projectManage || !!p.canInviteGuests} onPatch={(x) => p.onPatchClient(client.id, x)} onGuests={() => setClientTab('portal')} />}
        {/* The task list's own actions (layout, Display, New task) sit here, on the title's row (TaskViews). */}
        <span className="tq-head-slot" id="tq-head-slot" />
        <button className="ghost-btn sm tpl-btn" onClick={p.onTemplate} title={t('Start from a template')}>
          <LayoutTemplate size={14} /> <span>{t('Template')}</span>
        </button>
        {!p.dumpInSidebar && (
          <button className={`${showTaskList ? 'ghost-btn' : 'primary-btn'} sm brain-btn`} onClick={p.onBrainDump}>
            <Sparkles size={14} /> {t('Brain dump')}
          </button>
        )}
        {project && p.onOpenProject && (
          <button className="ghost-btn sm" onClick={() => p.onOpenProject!(project.id)}>
            {t('Open the {project}', { project: term.one })} <ChevronRight size={14} />
          </button>
        )}
      </header>

      {client && (
        <TabBar
          storageKey="project-tabs"
          value={clientTab}
          onSelect={(id) => setClientTab(id as typeof clientTab)}
          fixed={['overview']}
          className="client-tabs project-tabs"
          items={tabItems}
          extra={
            cellTeam && (
              <button className="on soft" onClick={() => p.onScope({ kind: 'client', id: client.id })}>
                {t('{team} only · show all teams', { team: cellTeam.name })}
              </button>
            )
          }
        />
      )}

      <div className="tracking-scroll" key={`${JSON.stringify(scope)}:${clientTab}`}>
        {team && !phone && (
          <div className="workload">
            {workload.map((w) => (
              <button key={w.u.id} className="wl" onClick={() => p.onScope({ kind: 'team', id: team.id })}>
                <Avatar person={w.u} size={28} />
                <span className="wl-text">
                  <strong>
                    {w.u.id === p.me ? t('You') : w.u.name.split(' ')[0]}
                    {w.u.id === team.leadId && <em> {t('lead')}</em>}
                  </strong>
                  <span className="bar">
                    <span style={{ width: `${(w.open / maxLoad) * 100}%` }} className={w.late ? 'warn' : ''} />
                  </span>
                  <small>{[tn(w.open, '{n} open', '{n} open'), tn(w.week, '{n} this week', '{n} this week'), w.late ? tn(w.late, '{n} late', '{n} late') : ''].filter(Boolean).join(' · ')}</small>
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
              {t('Briefs')} <span className="muted">{briefs.length}</span>
            </button>
            <div className={`fold ${briefsOpen ? 'open' : ''}`}>
              <div className="fold-in">{briefs.map(briefRow)}</div>
            </div>
          </div>
        )}
        {scope.kind === 'briefs' && briefs.length === 0 && (
          <EmptyState
            icon={<FileText size={22} />}
            title={t('No briefs yet')}
            text={t('In a brain dump, choose “Brief” to turn a bigger job into a brief with tasks for each person.')}
          />
        )}

        {showTaskList && (
          <TaskViews
            ops={ops}
            kind={scope.kind}
            scopeId={'id' in scope ? scope.id : undefined}
            tasks={scoped}
            label={scope.kind === 'team' ? t('{team} queue', { team: team?.name ?? t('Team') }) : heading}
            canAdd
            addDefaults={addDefaults}
            addKey={p.addKey}
            onBrainDump={p.onBrainDump}
            views={views}
            onViews={setViews}
            onScope={(s) => p.onScope(s as TaskScope)}
            triage={scope.kind === 'team' || scope.kind === 'myteams'}
            bar={phoneBar}
          />
        )}
        {team && workloadOpen && (
          <Sheet title={t('Workload')} onClose={() => setWorkloadOpen(false)}>
            <div className="workload wl-sheet">
              {workload.map((w) => (
                <div key={w.u.id} className="wl">
                  <Avatar person={w.u} size={32} />
                  <span className="wl-text">
                    <strong>
                      {w.u.id === p.me ? t('You') : w.u.name.split(' ')[0]}
                      {w.u.id === team.leadId && <em> {t('lead')}</em>}
                    </strong>
                    <span className="bar">
                      <span style={{ width: `${(w.open / maxLoad) * 100}%` }} className={w.late ? 'warn' : ''} />
                    </span>
                    <small>{[tn(w.open, '{n} open', '{n} open'), tn(w.week, '{n} this week', '{n} this week'), w.late ? tn(w.late, '{n} late', '{n} late') : ''].filter(Boolean).join(' · ')}</small>
                  </span>
                </div>
              ))}
            </div>
          </Sheet>
        )}

        <TabPane key={clientTab}>
        {client && clientTab === 'overview' && (
          <div className="hub-overview">
            {(() => {
              // What needs doing for this client, not how much there is.
              const today = localDay();
              const items: { key: string; text: string; sub: string; run: () => void; tone?: string }[] = [
                ...open.filter((x) => x.due && x.due < today).map((x) => {
                  const who = person(x.userId)?.name.split(' ')[0];
                  return { key: 'l' + x.id, text: x.title, sub: who ? t('Late, {name} on it', { name: who }) : t('Late, nobody on it'), run: () => p.onOpenTask(x.id), tone: 'warn' };
                }),
                ...open.filter((x) => x.source === 'request' && kindOf(x) === 'open').map((x) => ({ key: 'r' + x.id, text: x.title, sub: t('New request from the {who}', { who: term.who }), run: () => p.onOpenTask(x.id) })),
                ...open.filter((x) => x.approval?.status === 'changes').map((x) => ({ key: 'c' + x.id, text: x.title, sub: x.approval?.note ? t('{Who} asked for changes: “{note}”', { who: term.who, note: x.approval.note }) : t('{Who} asked for changes', { who: term.who }), run: () => p.onOpenTask(x.id), tone: 'warn' })),
                ...open.filter((x) => !x.userId).map((x) => ({ key: 'u' + x.id, text: x.title, sub: t('Nobody on it yet'), run: () => p.onOpenTask(x.id) })),
                ...clientThreads.filter((th) => th.unread).map((th) => ({ key: 'm' + th.id, text: th.subject, sub: t('Unread email'), run: () => p.onOpenThread(th.id) })),
              ];
              return (
                <div className="side-card needs-card">
                  <h3>{t('Needs attention')}</h3>
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
                    <EmptyState compact text={[t('Nothing needs you for {name}.', { name: client.name }), clientMeetings[0] ? t('Last meeting {when}.', { when: relative(clientMeetings[0].at) }) : ''].filter(Boolean).join(' ')} />
                  )}
                </div>
              );
            })()}
            <ProjectSections items={tabItems} onTab={setClientTab} actions={client.status === 'ended' ? [] : [{ id: 'template', label: t('Start from a template'), run: p.onTemplate }, ...(projectManage ? [{ id: 'end', label: t('End work'), danger: true, run: () => p.onEndClient(client.id) }] : [])]} />
            <div className="side-card client-notes-card">
              <h3>
                {t('Notes')}
                <button className="ghost-btn sm" onClick={() => p.onNewNote(client.id)}>
                  <Plus size={13} /> {t('New note')}
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
                          <span>{n.title || t('Untitled')}</span>
                          <time>{relative(n.updatedAt)}</time>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <EmptyState compact text={t('No notes for {name} yet. Meeting prep, preferences, who’s who: write it once, the whole team sees it here.', { name: client.name })} />
              )}
            </div>
            <div className="side-card overview-card">
              <h3>
                {client.overview?.headline ?? t('Where things stand')}
                <button className="ghost-btn sm" disabled={writingOv || (!clientMeetings.length && !open.length)} onClick={async () => (setWritingOv(true), await p.onWriteOverview(client.id), setWritingOv(false))}>
                  <Sparkles size={13} /> {writingOv ? t('Writing…') : client.overview ? t('Refresh') : t('Write overview')}
                </button>
              </h3>
              {client.overview ? (
                <>
                  <p className="muted small">{tn(client.overview.from, 'Written by AI from {n} meeting · {when}', 'Written by AI from {n} meetings · {when}', { when: relative(client.overview.at) })}</p>
                  <p>{client.overview.summary}</p>
                  <p>
                    <b>{t('Progress:')}</b> {client.overview.progress}
                  </p>
                  <div className="ov-cols">
                    {(
                      [
                        [t('Wins'), client.overview.wins, t('Nothing yet')],
                        [t('Risks'), client.overview.risks, t('None flagged')],
                        [t('Next steps'), client.overview.next, t('None')],
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
                <p className="muted small">{t('AI writes a one-page view of this {project} from its meetings, tasks and emails. Only when you click.', { project: term.one })}</p>
              )}
            </div>
            <div className="hub-two">
              <div className="side-card">
                <h3>{t('Next up')}</h3>
                <ul className="home-list">
                  {open.slice(0, 5).map((x) => (
                    <li key={x.id}>
                      <button className="home-notice" onClick={() => p.onOpenTask(x.id)}>
                        <span>{x.title}</span>
                        <time>{x.due ? dueLabel(x.due).text : ''}</time>
                      </button>
                    </li>
                  ))}
                  {!open.length && <EmptyState compact text={t('Nothing open. Add a task on the Tasks tab, or start a brief from a template.')} />}
                </ul>
              </div>
              <div className="side-card">
                <h3>{t('Recent')}</h3>
                <ul className="home-list">
                  {[
                    ...clientThreads.slice(0, 3).map((th) => ({ k: 'e' + th.id, text: t('Email: {subject}', { subject: th.subject }), at: th.messages[th.messages.length - 1].date, run: () => p.onOpenThread(th.id) })),
                    ...clientMeetings.slice(0, 2).map((m) => ({ k: 'm' + m.id, text: t('Meeting: {title}', { title: m.title }), at: m.at, run: () => p.onOpenMeeting(m.id) })),
                    ...clientMsgs.slice(-3).map((m) => ({ k: 'c' + m.id, text: t('Chat: {text}', { text: m.text.slice(0, 70) }), at: m.at, run: () => clientChannel && p.onOpenChannel(clientChannel.id) })),
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

        {client && clientTab === 'workload' && <ProjectWorkload tasks={p.tasks.filter((x) => x.clientId === client.id && !isBrief(x))} people={[...new Set([client.ownerId, ...(client.members ?? []).map((m) => m.userId)].filter(Boolean) as string[])]} users={p.users} me={p.me} onOpenTask={p.onOpenTask} />}
        {client && clientTab === 'chat' && (
          <div className="hub-chat">
            {clientChannel ? (
              <>
                <div className="hub-msgs">
                  {clientMsgs.slice(-12).map((m) => {
                    const g = m.guestEmail ? clientChannel.guests?.find((x) => x.email === m.guestEmail) : undefined;
                    const u = m.guestEmail ? undefined : person(m.userId);
                    const who = g ? { name: g.name, email: g.email } : u ? u : { name: t('Someone'), email: '' };
                    return (
                      <div key={m.id} className="hub-msg">
                        <Avatar person={who} size={28} />
                        <div className="hm-body">
                          <div className="hm-head">
                            <b>{who.name.split(' ')[0]}</b>
                            {g && <Badge small tone="warn">{term.Who}</Badge>}
                            <time>{relative(m.at)}</time>
                          </div>
                          <p>{m.text || (m.voice ? t('Voice note') : m.files ? m.files.map((f) => f.name).join(', ') : '')}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <footer className="hub-chat-foot">
                  <span className="muted small">{t('#{channel} · latest messages', { channel: clientChannel.name })}</span>
                  <button className="primary-btn sm" onClick={() => p.onOpenChannel(clientChannel.id)}>
                    <Hash size={13} /> {t('Open the channel')}
                  </button>
                </footer>
              </>
            ) : (
              <EmptyState compact text={t('{name} has no channel yet. Create one in Chat and pick “{project} (internal)” or “Shared”.', { name: client.name, project: term.One })} />
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
                  <small>{[`${fmtNumber(f.size / 1e6, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`, relative(f.modified), f.sharedWithClient ? t('visible to {whos}', { whos: term.whos }) : ''].filter(Boolean).join(' · ')}</small>
                </span>
              </div>
            ))}
            {!clientFiles.length && <EmptyState compact text={t('No files for {name} yet. Files shared in its channel and saved in its Drive folder show here.', { name: client.name })} />}
          </div>
        )}

        {client && clientTab === 'emails' && (
          <div className="te-list">
            {clientThreads.length === 0 && <EmptyState compact text={client.domain ? t('No emails with @{domain} yet. They show up here as soon as someone there writes.', { domain: client.domain }) : t('Add {name}’s email domain to see their emails here.', { name: client.name })} />}
            {clientThreads.map((th) => {
              const last = th.messages[th.messages.length - 1];
              return (
                <button key={th.id} className="te-row simple" onClick={() => p.onOpenThread(th.id)}>
                  <Avatar person={last.from} size={30} />
                  <div className="te-main">
                    <strong>{th.subject}</strong>
                    <small>
                      {last.from.name} · {relative(last.date)}
                    </small>
                  </div>
                  {th.unread && <span className="te-status seen">{t('New')}</span>}
                </button>
              );
            })}
          </div>
        )}

        {client && clientTab === 'meetings' && (
          <div className="te-list">
            {clientMeetings.length === 0 && <EmptyState compact text={t('No recorded meetings with {name} yet. Send the notetaker to your next call with them (Meet, Send bot).', { name: client.name })} />}
            {clientMeetings.map((m) => (
              <button key={m.id} className="te-row simple" onClick={() => p.onOpenMeeting(m.id)}>
                <span className="kpi-icon">
                  <Video size={15} />
                </span>
                <div className="te-main">
                  <strong>{m.title}</strong>
                  <small>{[relative(m.at), tn(m.minutes, '{n} min', '{n} min'), tn(m.actions.length, '{n} action item', '{n} action items')].join(' · ')}</small>
                </div>
              </button>
            ))}
          </div>
        )}
        {client && clientTab === 'notes' && (
          <div className="tracking-scroll proj-tab">
            <div className="proj-tab-head">
              <p className="muted small">{t('Prep, preferences, who’s who: notes linked to {name}. Private notes stay yours.', { name: client.name })}</p>
              <button className="primary-btn sm" onClick={() => p.onNewNote(client.id)}>
                <Plus size={14} /> {t('New note')}
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
                        <strong>{n.title || t('Untitled')}</strong>
                        <small>{n.visibility === 'private' ? t('Only you · {when}', { when: relative(n.updatedAt) }) : relative(n.updatedAt)}</small>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState compact text={t('No notes for {name} yet.', { name: client.name })} />
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
            <ProjectTables tables={(p.tables ?? []).filter((tb) => tb.clientId === client.id)} rows={p.tableRows ?? []} onOpen={(id) => p.onOpenTable?.(id)} onNew={() => p.onNewTable?.(client.id)} />
          </div>
        )}
        {client && clientTab === 'logins' && (
          <div className="tracking-scroll proj-tab">
            <div className="proj-tab-head">
              <p className="muted small">{t('Shared passwords and 2FA codes for {name}. You only see the ones you were given; every reveal is logged.', { name: client.name })}</p>
              <button className="primary-btn sm" onClick={() => p.onNewLogin?.(client.id)}>
                <Plus size={14} /> {t('New login')}
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
                          {[l.username, l.url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], l.hasTotp ? '2FA' : ''].filter(Boolean).join(' · ') || t('Login')}
                        </small>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyState compact text={t('No logins for {name} yet. Add the ad accounts, social logins and tools you share with the team.', { name: client.name })} />
            )}
          </div>
        )}
        {client && clientTab === 'portal' && (() => {
          const access = accessFor(p.workspace, client);
          const company = accessFor(p.workspace, { type: client.type }); // what this project would have without its own changes
          const people = clientPeople(client, p.channels);
          const visible = p.tasks.filter((x) => x.clientId === client.id && (x.visibleToClient || x.source === 'request'));
          const waiting = visible.filter((x) => x.approval?.status === 'waiting');
          const files = p.files.filter((f) => (f.clientId === client.id || (f.parentId && p.files.find((x) => x.id === f.parentId)?.clientId === client.id)) && f.kind !== 'folder' && !f.trashed);
          const mts = p.meetings.filter((m) => m.clientId === client.id);
          const candidates = p.tasks.filter((x) => x.clientId === client.id && !x.done && x.source !== 'request').slice(0, 12);
          const setPeople = (list: ClientPerson[]) => p.onPatchClient(client.id, { people: list });
          const viewAs = previewAs && people.some((x) => x.email === previewAs) ? previewAs : people.find((x) => x.status !== 'pending')?.email;
          return (
            <div className="portal-admin">
              <div className="pa-hero">
                <div>
                  <h3>{t('What {name} sees', { name: client.name })}</h3>
                  <p className="muted">
                    {t('Hidden until you share it.')}{' '}
                    {[tn(visible.length, '{n} item shared', '{n} items shared'), tn(waiting.length, '{n} waiting for approval', '{n} waiting for approval'), tn(people.filter((x) => x.status !== 'pending').length, '{n} person with access', '{n} people with access')].join(', ')}.
                  </p>
                </div>
                <div className="pa-preview">
                  {people.length > 0 && (
                    <Select
                      value={viewAs ?? ''}
                      onChange={setPreviewAs}
                      label={t('View as')}
                      options={people.filter((x) => x.status !== 'pending').map((g) => ({ value: g.email, label: g.name, hint: ROLE_NAME[g.role] }))}
                    />
                  )}
                  <button className="primary-btn sm" disabled={!viewAs} onClick={() => viewAs && p.onViewAs(client.id, viewAs)}>
                    <Eye size={14} /> {t('View as {who}', { who: term.who })}
                  </button>
                </div>
              </div>

              <div className="pa-grid">
                <section>
                  <h4>{t('Tasks and briefs')}</h4>
                  {candidates.length === 0 && <p className="muted small">{t('No open tasks for {name}.', { name: client.name })}</p>}
                  {candidates.map((tk) => (
                    <div key={tk.id} className="pa-row">
                      <button className={`eye ${tk.visibleToClient ? 'on' : ''}`} onClick={() => p.onPatch(tk.id, { visibleToClient: !tk.visibleToClient })} title={tk.visibleToClient ? t('Visible to {whos}', { whos: term.whos }) : t('Internal only')}>
                        {tk.visibleToClient ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button className="pa-title" onClick={() => p.onOpenTask(tk.id)}>
                        {isBrief(tk) && <FileText size={12} />} {tk.title}
                      </button>
                      {tk.approval?.status === 'waiting' && (
                        <span className="ap-tag waiting">
                          <Clock size={11} /> {t('Waiting')}
                        </span>
                      )}
                      {tk.approval?.status === 'approved' && (
                        <span className="ap-tag approved">
                          <CheckCircle2 size={11} /> {t('Approved')}
                        </span>
                      )}
                    </div>
                  ))}
                  <h4>{t('Files')}</h4>
                  {files.length === 0 && <p className="muted small">{t('No files for {name} in Drive yet.', { name: client.name })}</p>}
                  {files.map((f) => (
                    <div key={f.id} className="pa-row">
                      <button className={`eye ${f.sharedWithClient || f.uploadedBy ? 'on' : ''}`} disabled={!!f.uploadedBy} onClick={() => p.onShareFile(f.id, !f.sharedWithClient)} title={f.uploadedBy ? t('Uploaded by the {who}', { who: term.who }) : f.sharedWithClient ? t('Visible to {whos}', { whos: term.whos }) : t('Internal only')}>
                        {f.sharedWithClient || f.uploadedBy ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <span className="pa-title">
                        {f.name}
                        {f.uploadedBy && (
                          <small className="muted">
                            {' '}
                            {(() => {
                              const from = people.find((x) => x.email === f.uploadedBy)?.name.split(' ')[0];
                              return from ? t('from {name}', { name: from }) : t('from the {who}', { who: term.who });
                            })()}
                          </small>
                        )}
                      </span>
                    </div>
                  ))}
                  <h4>{t('Meeting notes')}</h4>
                  {access.meetingNotes === 'auto' && <p className="muted small">{t('Notes of meetings {name} attended are shared automatically. Share others here.', { name: client.name })}</p>}
                  {mts.length === 0 && <p className="muted small">{t('No meetings with {name} yet.', { name: client.name })}</p>}
                  {mts.map((m) => {
                    const auto = access.meetingNotes === 'auto' && people.some((x) => m.attendees.some((a) => a.toLowerCase() === x.name.toLowerCase() || a.split(' ')[0].toLowerCase() === x.name.split(' ')[0].toLowerCase()));
                    const on = auto || !!m.sharedWithClient;
                    return (
                      <div key={m.id} className="pa-row">
                        <button className={`eye ${on ? 'on' : ''}`} disabled={auto} onClick={() => p.onShareMeeting(m.id, !m.sharedWithClient)} title={auto ? t('Shared automatically: they attended') : on ? t('Visible to {whos}', { whos: term.whos }) : t('Internal only')}>
                          {on ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <span className="pa-title">
                          {m.title}
                          {auto && <small className="muted"> {t('they attended')}</small>}
                        </span>
                      </div>
                    );
                  })}
                </section>
                <section>
                  <h4>{t('Guests')}</h4>
                  {people.length === 0 && <p className="muted small">{t('Nobody yet. Invite the people you work with on {name}. They get a free account.', { name: client.name })}</p>}
                  {people.map((g) => (
                    <div key={g.email} className="pa-row person-row">
                      <PersonCell person={{ name: g.name, email: g.email, color: client.color }} sub={[companyOf(g.email, g.company, client), g.email].filter(Boolean).join(' · ')} />
                      {g.status === 'pending' ? (
                        <>
                          <Badge tone="warn">{t('Asked to join')}</Badge>
                          {projectManage && (
                            <button className="primary-btn sm" onClick={() => p.onApproveClientPerson(client.id, g.email)}>
                              {t('Approve')}
                            </button>
                          )}
                        </>
                      ) : (
                        <Badge tone={g.status === 'joined' ? 'good' : 'neutral'}>{g.status === 'joined' ? t('Joined') : t('Invited')}</Badge>
                      )}
                      {p.workspace.whatsapp?.connected && g.phone && (
                        <button type="button" className="icon-btn sm wa-btn" title={`WhatsApp ${g.phone}`} aria-label={`WhatsApp ${g.name}`} onClick={() => setWaTo(g)}>
                          <MessageCircle size={14} />
                        </button>
                      )}
                      <Select<ClientPerson['role']>
                        value={g.role}
                        onChange={(role) => setPeople(people.map((x) => (x.email === g.email ? { ...x, role } : x)))}
                        label={t('Role')}
                        className="sel-flat"
                        disabled={!projectManage}
                        options={(['viewer', 'collaborator', 'approver'] as const).map((r) => ({ value: r, label: ROLE_NAME[r], hint: ROLE_HINT[r] }))}
                      />
                      {projectManage && (
                        <button className="icon-btn sm" aria-label={t('Remove access')} title={t('Remove access')} onClick={() => setPeople(people.filter((x) => x.email !== g.email))}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {(projectManage || p.canInviteGuests) ? (
                  <div className="pa-invite">
                    <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder={t('Name')} />
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder={client.domain ? t('name@{domain}', { domain: client.domain }) : t('name@company.com')} />
                    <input value={inviteCompany} onChange={(e) => setInviteCompany(e.target.value)} placeholder={companyOf(inviteEmail.trim(), undefined, client) ?? t('Company (optional)')} />
                    {p.workspace.whatsapp?.connected && <input value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder={t('WhatsApp, e.g. +62 812…')} />}
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
                      <Plus size={13} /> {t('Invite')}
                    </button>
                  </div>
                  ) : (
                    <p className="muted small">{t('Only this {project}’s lead or an admin can invite {whos}.', { project: term.one, whos: term.whos })}</p>
                  )}

                  {waTo && <WhatsAppDialog to={waTo} workspaceId={p.workspace.id} channelId={p.channels.find((c) => c.clientId === client.id && c.category === 'shared' && !c.archived)?.id} onClose={() => setWaTo(null)} />}
                  <h4>{t('Settings for {name}', { name: client.name })}</h4>
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
  const open = tasks.filter((x) => !x.done);
  const doers = (x: Todo) => (x.assignees?.length ? x.assignees : x.userId ? [x.userId] : []);
  const ids = [...new Set([...people, ...open.flatMap(doers)])];
  const rows = ids
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean)
    .map((u) => {
      const mine = open.filter((x) => doers(x).includes(u!.id)).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
      return { u: u!, mine, late: mine.filter((x) => x.due && x.due < today).length, soon: mine.filter((x) => x.due && x.due >= today && x.due <= week).length };
    })
    .sort((a, b) => b.late - a.late || b.mine.length - a.mine.length);
  const nobody = open.filter((x) => !doers(x).length);
  const most = Math.max(1, ...rows.map((r) => r.mine.length));
  const list = (items: Todo[]) => (
    <div className="team-load-list">
      {items.length === 0 && <p className="muted small">{t('Nothing open.')}</p>}
      {items.map((x) => (
        <button key={x.id} type="button" className="team-mini" onClick={() => onOpenTask(x.id)}>
          <span>{x.title}</span>
          {x.due && <small className={x.due < today ? 'bad' : 'muted'}>{fmtDay(x.due)}</small>}
        </button>
      ))}
    </div>
  );
  return (
    <div className="team-sec proj-workload">
      <p className="muted small">{t('This {project}’s open work, per person. Late work first; open someone to see their list.', { project: term.one })}</p>
      <div className="team-block">
        {rows.map(({ u, mine, late, soon }) => (
          <div key={u.id} className="team-load">
            <button type="button" className="team-row" onClick={() => setOpenId(openId === u.id ? null : u.id)} aria-expanded={openId === u.id}>
              <PersonCell person={u} badges={u.id === me && <Badge tone="accent">{t('You')}</Badge>} sub={[late && tn(late, '{n} late', '{n} late'), soon && tn(soon, '{n} due this week', '{n} due this week'), !mine.length && t('Nothing open here')].filter(Boolean).join(' · ') || tn(mine.length, '{n} open', '{n} open')} />
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
                <strong>{t('Not picked up yet')}</strong>
                <small className="muted">{t('Nobody is doing these')}</small>
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
    if (!r.ok) return setErr(t(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t send.'));
    onClose();
  };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={`WhatsApp ${to.name}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span>
            <MessageCircle size={14} /> {t('WhatsApp to {name} · {phone}', { name: to.name, phone: to.phone ?? '' })}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Your message')} />
          {err && <p className="err small">{err}</p>}
          <p className="muted small">{[t('Sent from the company’s WhatsApp number.'), channelId ? t('A copy stays in the shared channel.') : '', t('Outside a 24-hour conversation, Meta only allows approved templates.')].filter(Boolean).join(' ')}</p>
        </div>
        <footer className="modal-foot">
          <button className="ghost-btn sm" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn sm" disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? t('Sending…') : t('Send')}
          </button>
        </footer>
      </div>
    </div>
  );
}
