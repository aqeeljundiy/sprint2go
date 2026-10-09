import { Popover } from './ui/Popover';
import { holidayOn } from '../holidayDays';
import { TabBar } from './ui/TabBar';
import { ProjectPeople } from './ProjectPeople';
import { ProjectBadge, ProjectPhotoButton } from './ProjectBadge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { PROJECT_TYPES, term } from '../terms';
import { Archive, RotateCcw, Inbox, X, Brain, CalendarPlus, CheckCircle2, Clock, Columns3, Eye, EyeOff, FileText, Hash, LayoutGrid, LayoutTemplate, List, Mail, Menu, MessagesSquare, Plus, Sparkles, Trash2, Users, Video, type LucideIcon, FolderInput, ChevronDown, ChevronRight, SlidersHorizontal, Bookmark, MessageCircle } from 'lucide-react';
import type { Channel, ChatMessage, Client, DriveItem, Meeting, TaskStatus, Team, Thread, Todo, User, ClientPerson, Workspace, Note, DataTable, TableRow } from '../types';
import { firstOf, kindOf, stageBadge, stageIdFor, stageName, stageOf, stagesFor, toneOf } from '../stages';
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
import { DatePicker } from './ui/DatePicker';
import { PeoplePicker } from './ui/PeoplePicker';
import { personOption } from './ui/PeopleList';
import { QuotesTab } from './Quotes';
import type { Quote } from '../types';
import { useCreateAction } from '../mobile/chrome';
import { projectTabs, ProjectSections, useProjectPhone } from './ProjectPhone';

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

type GroupBy = 'client' | 'team' | 'person' | 'stage' | 'none';
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
  onAdd: (t: { title: string; clientId?: string; teamId?: string; userId: string; due?: string }) => void;
  onStatus: (id: string, s: TaskStatus) => void;
  onPatch: (id: string, p: Partial<Todo>) => void;
  onDelete: (id: string) => void;
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
}

/** What a task can show on its card (board) or row (list); each person picks, per layout. */
const TASK_FIELDS: { id: string; name: string }[] = [
  { id: 'due', name: 'Deadline' },
  { id: 'assignee', name: 'Who’s on it' },
  { id: 'project', name: 'Project' },
  { id: 'team', name: 'Team' },
  { id: 'brief', name: 'Brief' },
  { id: 'priority', name: 'High priority mark' },
  { id: 'checklist', name: 'Checklist progress' },
  { id: 'comments', name: 'Comments' },
  { id: 'source', name: 'Where it came from' },
  { id: 'updated', name: 'Last change' },
];
const FIELD_DEFAULTS = { list: ['due', 'project', 'team', 'brief', 'priority', 'checklist', 'source'], board: ['assignee', 'due', 'project', 'team', 'priority', 'checklist'] };

/** The last "New task" asked for from outside (More), so coming back to Tasks later doesn't open the field again. */
let handledAdd = 0;

export function TasksView(p: Props) {
  const [layout, setLayout] = usePersisted<'list' | 'board'>('s2g-task-layout', 'list');
  const [groupPref, setGroupBy] = usePersisted<GroupBy>('s2g-task-group', 'client');
  const [briefsOpen, setBriefsOpen] = usePersisted('s2g-briefs-open', true);
  const [projGroup, setProjGroup] = usePersisted<GroupBy>('s2g-project-group', 'team'); // a project's tasks: by team, person or not at all
  const [filter, setFilter] = useState<Filter>('open');
  const [showDone, setShowDone] = useState(true);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [teamPick, setTeamPick] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
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

  const scope = p.scope;
  // The company's own stages: board columns, grouping, the Start button and what each row says.
  const stages = stagesFor(p.workspace.id);
  const activeStage = firstOf('active', stages);
  const waitingStages = stages.filter((s) => s.kind === 'waiting');
  const client = scope.kind === 'client' ? p.clients.find((c) => c.id === scope.id) : undefined;
  const team = scope.kind === 'team' ? p.teams.find((t) => t.id === scope.id) : undefined;
  const cellTeam = scope.kind === 'client' && scope.teamId ? p.teams.find((t) => t.id === scope.teamId) : undefined;
  const person = (id?: string) => p.users.find((u) => u.id === id);
  const clientOf = (id?: string) => p.clients.find((c) => c.id === id);
  const teamOf = (id?: string) => p.teams.find((t) => t.id === id);
  const briefOf = (id?: string) => p.tasks.find((t) => t.id === id && isBrief(t));

  // What this page is about (briefs are shown as cards, not rows).
  // Quick filters on top of where you are: only late, only high priority, only waiting on the client, only nobody on it.
  const [quick, setQuick] = useState<string[]>([]);
  const scoped = useMemo(() => {
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
  const inScope = useMemo(
    () =>
      scoped.filter(
        (t) =>
          (!quick.includes('late') || (!t.done && late(t))) &&
          (!quick.includes('high') || t.priority === 'high') &&
          (!quick.includes('waiting') || kindOf(t) === 'waiting' || t.approval?.status === 'waiting') &&
          (!quick.includes('nobody') || (!t.userId && !(t.assignees?.length))),
      ),
    [scoped, quick],
  );

  /* Saved views: where you are, list or board, open or done, grouping and quick filters, under a name. Just yours. */
  type SavedView = { id: string; name: string; scope: TaskScope; layout: 'list' | 'board'; filter: Filter; groupBy: GroupBy; quick: string[] };
  const [views, setViews] = usePersisted<SavedView[]>('s2g-task-views', []);
  const [viewName, setViewName] = useState('');
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsBtn = useRef<HTMLButtonElement>(null);
  const nowState = { scope, layout, filter, groupBy: groupPref, quick: [...quick].sort() };
  const activeView = views.find((v) => JSON.stringify({ scope: v.scope, layout: v.layout, filter: v.filter, groupBy: v.groupBy, quick: [...v.quick].sort() }) === JSON.stringify(nowState));
  const applyView = (v: SavedView) => {
    p.onScope(v.scope);
    setLayout(v.layout);
    setFilter(v.filter);
    setGroupBy(v.groupBy);
    setQuick(v.quick);
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    setViews([...views, { id: Date.now().toString(36), name, ...nowState }]);
    setViewName('');
    setViewsOpen(false);
  };

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

  const open = inScope.filter((t) => !t.done).sort((a, b) => (scope.kind === 'supervising' ? Number(kindOf(b) === 'review') - Number(kindOf(a) === 'review') : 0) || byDue(a, b));
  const done = inScope.filter((t) => t.done).sort((a, b) => (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt));
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const recentDone = done.filter((t) => (t.doneAt ?? t.createdAt) > weekAgo);
  const overdue = open.filter(late).length;
  const shown = filter === 'open' ? open : filter === 'done' ? done : [...open, ...done];

  const groupBy: GroupBy = scope.kind === 'team' ? 'person' : scope.kind === 'client' ? (scope.teamId ? 'none' : projGroup) : groupPref;

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
    addInput.current?.focus(); // ready for the next one
  };
  // Quick capture: a "New task" button (or N) opens the field in place; Escape, or leaving it empty, folds it away.
  const [adding, setAdding] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);
  const addRow = useRef<HTMLDivElement>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  // Opened by a tap: the field shows and takes focus in the same tap, so a phone's keyboard comes up with it (iPhone only
  // opens the keyboard for focus given during the tap itself). From an effect it waits a frame instead.
  const openAdd = (now: unknown = true) => {
    const focus = () => (addInput.current?.focus(), addRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    if (now === false) return void (setAdding(true), requestAnimationFrame(focus));
    flushSync(() => setAdding(true));
    focus();
  };
  // Phones: New task is the create button by the tab bar. "New, Task" in More opens the field too (addKey bumps).
  useCreateAction('tasks', scope.kind !== 'grid' && scope.kind !== 'briefs' && !client && { label: 'New task', icon: Plus, run: openAdd });
  useEffect(() => {
    if (p.addKey && p.addKey !== handledAdd) {
      handledAdd = p.addKey;
      openAdd(false);
    }
  }, [p.addKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const onAddBlur = () =>
    setTimeout(() => {
      const a = document.activeElement;
      if (addRow.current?.contains(a) || a?.closest('.pop')) return; // still in the row, or picking who or when
      if (!addInput.current?.value.trim()) setAdding(false);
    }, 0);

  const groups: { key: string; label: React.ReactNode; items: Todo[]; extra?: React.ReactNode }[] = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null, items: shown }];
    const map = new Map<string, Todo[]>();
    const keyOf = (t: Todo) => (groupBy === 'client' ? (t.clientId ?? '') : groupBy === 'team' ? (t.teamId ?? '') : groupBy === 'stage' ? stageOf(t, stages).id : t.userId);
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
      if (groupBy === 'stage') {
        const i = stages.findIndex((x) => x.id === k);
        const st = stages[i];
        return { key: k, sort: String(i).padStart(3, '0'), label: st ? <><span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />{stageName(st)}</> : 'Other', items };
      }
      const u = person(k);
      return { key: k, sort: u ? (u.id === p.me ? '!' : u.name) : ' ', label: u ? <><Avatar person={u} size={18} />{u.id === p.me ? 'You' : u.name}</> : <><span className="avatar-empty sm">?</span>Not assigned yet</>, items };
    });
    return out.sort((a, b) => a.sort.localeCompare(b.sort));
  }, [shown, groupBy, stages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ticking a task: show the tick, let the row fold away, then move it (instead of it jumping between groups).
  const [ticking, setTicking] = useState<Set<string>>(new Set());
  const tick = (t: Todo) => {
    if (t.done || matchMedia('(prefers-reduced-motion: reduce)').matches) return p.onStatus(t.id, stageIdFor(t, t.done ? 'open' : 'done'));
    setTicking((s) => new Set(s).add(t.id));
    setTimeout(() => {
      p.onStatus(t.id, stageIdFor(t, 'done'));
      setTicking((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }, 380);
  };
  const [taskFields, setTaskFields] = usePersisted<{ list: string[]; board: string[] }>('s2g-task-fields', FIELD_DEFAULTS);
  const showF = (layoutName: 'list' | 'board', id: string) => (taskFields[layoutName] ?? FIELD_DEFAULTS[layoutName]).includes(id);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const fieldsBtn = useRef<HTMLButtonElement>(null);
  const extras = (t: Todo, l: 'list' | 'board') => {
    const comments = (t.history ?? []).filter((h) => h.kind === 'comment').length;
    const last = t.history?.at(-1)?.at ?? t.createdAt;
    const cl = t.checklist ?? [];
    return (
      <>
        {showF(l, 'checklist') && cl.length > 0 && (
          <span className={`meta-chip ${cl.every((x) => x.done) ? 'ok' : ''}`} title="Checklist">
            <CheckCircle2 size={11} /> {cl.filter((x) => x.done).length}/{cl.length}
          </span>
        )}
        {showF(l, 'comments') && comments > 0 && (
          <span className="meta-chip" title="Comments">
            <MessagesSquare size={11} /> {comments}
          </span>
        )}
        {showF(l, 'updated') && last && <span className="meta-chip muted">{relative(last)}</span>}
      </>
    );
  };
  const row = (t: Todo) => {
    const d = t.due ? dueLabel(t.due) : null;
    const st = stageOf(t, stages);
    const src = SOURCE[t.source];
    const c = clientOf(t.clientId);
    const tm = teamOf(t.teamId);
    const br = briefOf(t.briefId);
    return (
      <div
        key={t.id}
        className={`task ${t.done || ticking.has(t.id) ? 'done' : ''} ${ticking.has(t.id) ? 'leaving' : ''} ${t.priority === 'high' && showF('list', 'priority') ? 'high' : ''} ${st.kind === 'active' ? 'doing' : ''}`}
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
            {st.kind !== 'done' && st !== firstOf('open', stages) && groupBy !== 'stage' && <span className={`due stage-badge tone-${toneOf(st)}`}>{stageBadge(st)}</span>}
            {showF('list', 'due') && d && !t.done && <span className={`due ${d.cls}`}>{d.text}</span>}
            {showF('list', 'due') && !t.done && t.due && d?.cls !== 'overdue' && holidayOn(t.due) && (
              <span className="hol-chip" title={`Public holiday: ${holidayOn(t.due)}`}>
                Holiday
              </span>
            )}
            {showF('list', 'assignee') && person(t.userId) && (
              <span className="meta-chip person-chip">
                <Avatar person={person(t.userId)!} size={14} /> {person(t.userId)!.name.split(' ')[0]}
              </span>
            )}
            {t.done && (
              <span className="done-info">
                Done {t.doneBy ? `by ${t.doneBy === p.me ? 'you' : (person(t.doneBy)?.name.split(' ')[0] ?? 'someone')} ` : ''}
                {t.doneAt ? relative(t.doneAt) : ''}
              </span>
            )}
            {showF('list', 'project') && c && scope.kind !== 'client' && (
              <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                {c.name}
              </span>
            )}
            {showF('list', 'team') && tm && groupBy !== 'team' && scope.kind !== 'team' && (
              <span className="team-chip" style={{ ['--c' as string]: tm.color }}>
                {tm.name}
              </span>
            )}
            {showF('list', 'brief') && br && (
              <button className="brief-chip" onClick={() => p.onOpenTask(br.id)} title="Open the brief">
                <FileText size={11} /> {br.title}
              </button>
            )}
            {showF('list', 'source') && (
              <span className="src" title={src.label}>
                <src.icon size={12} />
              </span>
            )}
            {extras(t, 'list')}
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
          if (st.kind === 'review' && t.supervisorId === p.me)
            return (
              <button className="row-act primary" onClick={() => p.onStatus(t.id, stageIdFor(t, 'done', stages))}>
                Approve
              </button>
            );
          if (t.source === 'request' && st.kind === 'open' && activeStage)
            return (
              <button className="row-act" onClick={() => p.onStatus(t.id, activeStage.id)}>
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
          {!t.done && activeStage && (st.kind === 'open' || st.kind === 'active') && (
            <button
              className="icon-btn sm"
              title={st.kind === 'active' ? `Move back to ${stageName(firstOf('open', stages)!)}` : `Start (${stageName(activeStage)})`}
              onClick={() => p.onStatus(t.id, st.kind === 'active' ? stageIdFor(t, 'open', stages) : activeStage.id)}
            >
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
  useEffect(() => {
    if (!showTaskList) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'n' && e.key !== 'N') || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((document.activeElement as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('.modal-scrim:not(.is-leaving), .palette-scrim:not(.is-leaving), .pop:not(.is-leaving)')) return; // a dialog or menu is open
      e.preventDefault();
      openAdd();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [showTaskList]);
  const subtitle = client
    ? `${client.status === 'lead' ? 'Lead' : client.status === 'paused' ? 'Paused' : client.status === 'ended' ? `Past ${term.one}${client.endReason ? ` · ${client.endReason}` : ''}` : 'Active'}${client.domain ? ` · @${client.domain}` : ''} · owner ${person(client.ownerId)?.name ?? 'not set'}`
    : team
      ? [`Lead: ${person(team.leadId)?.name ?? 'not set'}`, overdue ? `${overdue} late` : '', open.filter((t) => !t.userId).length ? `${open.filter((t) => !t.userId).length} nobody on it yet` : ''].filter(Boolean).join(' · ')
      : scope.kind === 'grid'
        ? `Open work for every ${term.one}, split by team. Click a cell to open it.`
        : scope.kind === 'briefs'
          ? 'Bigger pieces of work with one person in charge and tasks for others'
          : [overdue ? `${overdue} late` : '', open.filter((t) => t.due === localDay()).length ? `${open.filter((t) => t.due === localDay()).length} due today` : ''].filter(Boolean).join(' · ') || (open.length ? 'Nothing late or due today' : 'Nothing open');

  // A project's parts: tabs on desktop; on phones a list on its home and the title switcher (ProjectPhone.tsx).
  const tabItems = projectTabs({ late: overdue, unreadMail: clientThreads.filter((t) => t.unread).length, quotes: !!p.onQuote, quoteWaiting: !!client && (p.quotes ?? []).some((q) => q.clientId === client.id && q.status === 'sent'), tables: !!p.onOpenTable });
  useProjectPhone({ client, items: tabItems, tab: clientTab, onTab: setClientTab, others: p.clients, onProject: (id) => p.onScope(id === null ? { kind: 'projects' } : id === 'past' ? { kind: 'past' } : { kind: 'client', id }) });

  if (scope.kind === 'past')
    return <PastClients clients={p.clients} tasks={p.tasks} canManage={p.canManage} onOpen={(id) => p.onScope({ kind: 'client', id })} onReactivate={p.onReactivateClient} />;

  // Admins, the owner and the project's Leads manage a project: its status, people, guests and their access.
  const projectManage = !!client && (p.canManage || client.ownerId === p.me || (client.members ?? []).some((m) => m.userId === p.me && m.role === 'lead'));
  return (
    <section className={`tasks-pane view-enter${client ? ' project-pane' : ''}`}>
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
        {showTaskList && (
          <button ref={newBtn} className="primary-btn sm new-task-btn" onClick={() => (adding ? setAdding(false) : openAdd())} aria-expanded={adding} title="New task (N)">
            <Plus size={14} /> New task <kbd>N</kbd>
          </button>
        )}
        {showTaskList && (
          <>
            <button ref={fieldsBtn} className="icon-btn" onClick={() => setFieldsOpen(true)} title={`What ${layout === 'board' ? 'cards' : 'rows'} show`} aria-label="Fields">
              <SlidersHorizontal size={16} />
            </button>
            <Popover anchor={fieldsBtn} open={fieldsOpen} onClose={() => setFieldsOpen(false)} width={240} align="end" title={`On each ${layout === 'board' ? 'card' : 'row'}`}>
              <div className="tab-edit-list">
                <p className="muted small">What each {layout === 'board' ? 'card on the board' : 'row in the list'} shows. Just for you.</p>
                {TASK_FIELDS.map((f) => (
                  <label key={f.id} className="check-row tb-field-toggle">
                    <input
                      type="checkbox"
                      checked={showF(layout === 'board' ? 'board' : 'list', f.id)}
                      onChange={(e) => {
                        const l = layout === 'board' ? 'board' : 'list';
                        const cur = taskFields[l] ?? FIELD_DEFAULTS[l];
                        setTaskFields({ ...taskFields, [l]: e.target.checked ? [...cur, f.id] : cur.filter((x) => x !== f.id) });
                      }}
                    />{' '}
                    {f.name}
                  </label>
                ))}
                <div className="tab-edit-foot">
                  <button type="button" className="link-btn small" onClick={() => setTaskFields({ ...taskFields, [layout === 'board' ? 'board' : 'list']: FIELD_DEFAULTS[layout === 'board' ? 'board' : 'list'] })}>
                    Back to the usual
                  </button>
                </div>
              </div>
            </Popover>
          </>
        )}
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
                {cellTeam.name} only · show all teams
              </button>
            )
          }
        />
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
          <>
            <button type="button" className={`new-task-slim ${adding ? 'gone' : ''}`} onClick={openAdd} aria-expanded={adding} tabIndex={adding ? -1 : 0}>
              <Plus size={16} /> New task
            </button>
            <div className={`fold task-add-fold ${adding ? 'open' : ''}`}>
              <div className="fold-in">
                <div className="todo-add task-add" ref={addRow} onBlur={onAddBlur}>
                  <Plus size={16} />
                  <input
                    ref={addInput}
                    id="new-task"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') add();
                      if (e.key === 'Escape') (e.preventDefault(), setAdding(false), newBtn.current?.offsetParent && newBtn.current.focus()); // focus goes back to the button
                    }}
                    placeholder={client ? `Add a task for ${client.name}…` : team ? `Add to ${team.name}’s queue…` : 'Add a task…'}
                    aria-label="New task"
                  />
                  <Select value={addAssignee} options={peopleOptions(p.users, p.me)} onChange={setAssignee} label="Assign to" className="sel-flat" />
                  <Select value={addTeam} options={teamOptions(p.teams)} onChange={setTeamPick} label="Team" className="sel-flat hide-sm" />
                  <DatePicker value={due} onChange={setDue} label="Due date" placeholder="Due" className="sel-flat" />
                  <button className="primary-btn sm" onClick={add} disabled={!title.trim()}>
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="task-views">
              {views.length > 0 && (
                <TabBar
                  storageKey="task-views"
                  className="client-tabs task-view-tabs"
                  value={activeView?.id ?? ''}
                  onSelect={(id) => {
                    const v = views.find((x) => x.id === id);
                    if (v) applyView(v);
                  }}
                  items={views.map((v) => ({ id: v.id, name: v.name, label: v.name }))}
                />
              )}
              <div className="tool-row task-toolbar">
                {layout === 'list' && (
                  <>
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
                    {scope.kind === 'client' && !scope.teamId && (
                      <Select<GroupBy>
                        value={projGroup}
                        onChange={setProjGroup}
                        label="Group by"
                        className="sel-flat"
                        renderValue={(o) => (
                          <>
                            <span className="sel-text">Group: {o?.label}</span>
                            <ChevronDown size={14} className="sel-chev" />
                          </>
                        )}
                        options={[
                          { value: 'team', label: 'Team' },
                          { value: 'person', label: 'Person' },
                          { value: 'stage', label: 'Stage' },
                          { value: 'none', label: 'None' },
                        ]}
                      />
                    )}
                    {!['team', 'client'].includes(scope.kind) && (
                      <Select<GroupBy>
                        value={groupPref}
                        onChange={setGroupBy}
                        label="Group by"
                        className="sel-flat"
                        renderValue={(o) => (
                          <>
                            <span className="sel-text">Group: {o?.label}</span>
                            <ChevronDown size={14} className="sel-chev" />
                          </>
                        )}
                        options={[
                          { value: 'client', label: `${term.One}` },
                          { value: 'team', label: 'Team' },
                          { value: 'person', label: 'Person' },
                          { value: 'stage', label: 'Stage' },
                          { value: 'none', label: 'None' },
                        ]}
                      />
                    )}
                  </>
                )}
                <div className="quick-chips" role="group" aria-label="Quick filters">
                  {(
                    [
                      ['late', 'Late'],
                      ['high', 'High priority'],
                      ...(firstOf('waiting', stages) || quick.includes('waiting') ? ([['waiting', waitingStages.length === 1 ? stageName(waitingStages[0]) : `Waiting on ${term.who}`]] as const) : []),
                      ['nobody', 'Nobody on it'],
                    ] as const
                  ).map(([id, l]) => (
                    <button key={id} className={quick.includes(id) ? 'on' : ''} aria-pressed={quick.includes(id)} onClick={() => setQuick((q) => (q.includes(id) ? q.filter((x) => x !== id) : [...q, id]))}>
                      {l}
                    </button>
                  ))}
                </div>
                <span className="spacer" />
                <button ref={viewsBtn} className="link-btn small" onClick={() => setViewsOpen(true)}>
                  <Bookmark size={13} /> {activeView ? activeView.name : 'Save as a view'}
                </button>
                <Popover anchor={viewsBtn} open={viewsOpen} onClose={() => setViewsOpen(false)} width={280} align="end" title="Your views">
                  <div className="tab-edit-list">
                    <p className="muted small">A view remembers where you are, list or board, what’s showing and these filters. Views are just yours and appear as tabs here.</p>
                    {!activeView && (
                      <div className="tb-act-row">
                        <input className="tb-native" autoFocus value={viewName} placeholder="Name, like “My late work”" onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveView()} />
                        <button className="primary-btn sm" disabled={!viewName.trim()} onClick={saveView}>
                          Save
                        </button>
                      </div>
                    )}
                    {views.map((v) => (
                      <div key={v.id} className="tab-edit-row">
                        <Bookmark size={13} className="muted" />
                        <button type="button" className="tab-edit-name link-like" onClick={() => (applyView(v), setViewsOpen(false))}>
                          {v.name}
                        </button>
                        <button type="button" className="icon-btn sm" aria-label={`Delete ${v.name}`} onClick={() => setViews(views.filter((x) => x.id !== v.id))}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </Popover>
              </div>
            </div>


            {layout === 'board' ? (
              <div className="board" style={{ ['--cols' as string]: stages.length }}>
                {stages.map((col) => {
                  const items = inScope.filter((t) => stageOf(t, stages).id === col.id).sort(byDue);
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
                        <span className={`stage-dot k-${col.kind} tone-${toneOf(col)}`} />
                        {stageName(col)} <span>{items.length}</span>
                      </div>
                      {items.map((t) => {
                        const c = clientOf(t.clientId);
                        const tm = teamOf(t.teamId);
                        const d = t.due ? dueLabel(t.due) : null;
                        const owner = person(t.userId);
                        return (
                          <div
                            key={t.id}
                            className={`card-task ${t.priority === 'high' && showF('board', 'priority') ? 'high' : ''}`}
                            draggable
                            onDragStart={() => setDragging(t.id)}
                            onDragEnd={() => setDragging(null)}
                            onClick={() => p.onOpenTask(t.id)}
                          >
                            <div className="ct-top">
                              <div className="ct-title">
                                {t.priority === 'high' && showF('board', 'priority') && <i className="ct-high" title="High priority" />}
                                {t.title}
                              </div>
                              {showF('board', 'assignee') && (owner ? <Avatar person={owner} size={22} /> : <span className="avatar-empty sm" title="Nobody on it yet">?</span>)}
                            </div>
                            <div className="ct-meta">
                              {showF('board', 'project') && c && scope.kind !== 'client' && (
                                <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                                  {c.name}
                                </span>
                              )}
                              {showF('board', 'team') && tm && scope.kind !== 'team' && (
                                <span className="team-chip" style={{ ['--c' as string]: tm.color }}>
                                  {tm.name}
                                </span>
                              )}
                              {showF('board', 'due') && d && col.kind !== 'done' && <span className={`due ${d.cls}`}>{d.text}</span>}
                              {showF('board', 'brief') && briefOf(t.briefId) && (
                                <span className="meta-chip">
                                  <FileText size={11} /> {briefOf(t.briefId)!.title}
                                </span>
                              )}
                              {showF('board', 'source') && (
                                <span className="src" title={SOURCE[t.source].label}>
                                  {(() => {
                                    const I = SOURCE[t.source].icon;
                                    return <I size={12} />;
                                  })()}
                                </span>
                              )}
                              {extras(t, 'board')}
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
                  <EmptyState
                    icon="✓"
                    title={filter === 'done' ? 'Nothing finished yet' : 'Nothing open'}
                    text="Add one, or use Brain dump to turn your thoughts into tasks."
                    action={
                      filter !== 'done' && (
                        <button type="button" className="primary-btn sm" onClick={openAdd}>
                          <Plus size={14} /> New task
                        </button>
                      )
                    }
                  />
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
            <ProjectSections items={tabItems} onTab={setClientTab} actions={client.status === 'ended' ? [] : [{ id: 'template', label: 'Start from a template', run: p.onTemplate }, ...(projectManage ? [{ id: 'end', label: 'End work', danger: true, run: () => p.onEndClient(client.id) }] : [])]} />
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
