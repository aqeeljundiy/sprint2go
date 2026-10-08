import { ProjectBadge } from './ProjectBadge';
import { useMemo, useState, type ReactNode } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { term } from '../terms';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, FileText, GripVertical, Hash, Inbox, LayoutGrid, ListChecks, Maximize2, Menu, Mic, Minimize2, PartyPopper, Plus, Settings2, Sparkles, Users, Video, X, Search, Megaphone } from 'lucide-react';
import type { CalEvent, Client, HomeTemplateId, Meeting, Notice, Team, Thread, Todo, User } from '../types';
import { fmtTime } from '../calendarUtils';
import { meetingLinkOf } from '../meetingLinks';
import { isMine } from '../identity';
import { usePersisted } from '../settings';
import { relative, localDay } from '../utils';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { doers, dueLabel, isBrief, peopleOptions } from './TasksView';
import { kindOf } from '../stages';

type CardId =
  | 'briefing'
  | 'dump'
  | 'pulse'
  | 'risk'
  | 'lateByTeam'
  | 'workload'
  | 'waiting'
  | 'teamQueue'
  | 'briefs'
  | 'mytasks'
  | 'today'
  | 'unread'
  | 'foryou'
  | 'meetings'
  | 'clients'
  | 'wins';
type Size = 'm' | 'l';
interface Layout {
  template: HomeTemplateId;
  cards: { id: CardId; size: Size }[];
}

const CARD_INFO: Record<CardId, { name: string; hint: string }> = {
  briefing: { name: 'Briefing', hint: 'A short summary of your day' },
  dump: { name: 'Brain dump', hint: 'Type what’s on your mind' },
  pulse: { name: 'Company numbers', hint: 'Late, not picked up, done this week' },
  risk: { get name() { return `${term.Many} at risk`; }, get hint() { return `Late or stuck work per ${term.one}`; } },
  lateByTeam: { name: 'Teams', hint: 'Open and late work per team' },
  workload: { name: 'Workload', hint: 'How busy each person is' },
  waiting: { name: 'Waiting on you', hint: 'Already at the top, in Up next' },
  teamQueue: { name: 'Team queue', hint: 'Tasks nobody has picked up yet' },
  briefs: { name: 'Briefs', hint: 'Bigger jobs and their progress' },
  mytasks: { name: 'My tasks', hint: 'Your queue, in order' },
  today: { name: 'Today', hint: 'Your next meetings' },
  unread: { name: 'Unread mail', hint: 'Mail waiting for you' },
  foryou: { name: 'For you', hint: 'Mentions and assignments' },
  meetings: { name: 'From meetings', hint: 'Action items without an owner' },
  clients: { get name() { return `${term.Many}`; }, get hint() { return `Every ${term.one} at a glance`; } },
  wins: { name: 'Wins this week', hint: 'What the team finished' },
};

const TEMPLATES: Record<HomeTemplateId, { name: string; hint: string; cards: [CardId, Size][] }> = {
  founder: {
    name: 'Founder / C-level',
    hint: 'What’s happening across the whole company',
    cards: [['risk', 'm'], ['lateByTeam', 'm'], ['workload', 'm'], ['briefs', 'm']],
  },
  lead: {
    name: 'Team lead',
    hint: 'Your team’s queue and who is busy',
    cards: [['mytasks', 'm'], ['workload', 'm'], ['today', 'm'], ['briefs', 'm']],
  },
  maker: {
    name: 'Designer / Editor',
    hint: 'Your queue and the briefs behind it',
    cards: [['mytasks', 'l'], ['briefs', 'm'], ['today', 'm']],
  },
  account: {
    name: 'Account manager',
    get hint() { return `Your ${term.many}, their emails and meetings`; },
    cards: [['clients', 'l'], ['unread', 'm'], ['meetings', 'm']],
  },
  finance: {
    name: 'Finance / Admin',
    hint: 'Payments, invoices and deadlines',
    cards: [['mytasks', 'l'], ['unread', 'm'], ['today', 'm']],
  },
};
export const HOME_TEMPLATES = TEMPLATES;

const fromTemplate = (t: HomeTemplateId): Layout => ({ template: t, cards: TEMPLATES[t].cards.map(([id, size]) => ({ id, size })) });

interface Props {
  me: User;
  firstName: string;
  isOwner: boolean;
  workspaceId: string;
  defaultTemplate?: HomeTemplateId; // from the person's team, set by an admin
  tasks: Todo[]; // workspace tasks and briefs
  clients: Client[];
  teams: Team[];
  users: User[];
  threads: Thread[]; // my inbox in this workspace
  events: CalEvent[]; // my calendar
  meetings: Meeting[];
  notices: Notice[];
  kudos: { id: string; to: string; from: string; text: string; at: string }[]; // this week
  enabled: Set<string>;
  onDump: (text?: string) => void;
  onToggleTask: (id: string) => void;
  onAssign: (taskId: string, userId: string) => void;
  onNudge: (taskId: string) => void; // remind the person doing a late task
  onSearch: () => void;
  onOpenTask: (id: string) => void;
  onOpenTasks: () => void;
  onOpenTeam: (id: string) => void;
  onOpenBriefs: () => void;
  onOpenGrid: () => void;
  onOpenThread: (id: string) => void;
  onOpenMail: () => void;
  onOpenCalendar: (eventId?: string) => void;
  onOpenClient: (id: string) => void;
  onOpenMeeting: (id: string) => void;
  onNotice: (n: Notice) => void;
  onMenu: () => void;
  /** News and warnings from the sprint2go team, until they end or this person dismisses them. */
  news?: { id: string; text: string; link?: string; kind: 'news' | 'warning' }[];
  onDismissNews?: (id: string) => void;
  /** What the company hasn't set up yet (admins only): each row opens the right place. */
  setup?: { key: string; label: string; hint: string; done: boolean; onOpen: () => void }[];
}

/** The template that fits a person: owners get the company view, team leads the team view, then by team. */
function guessTemplate(p: Props): HomeTemplateId {
  if (p.defaultTemplate) return p.defaultTemplate;
  if (p.isOwner) return 'founder';
  if (p.teams.some((t) => t.leadId === p.me.id)) return 'lead';
  const t = p.teams.find((x) => x.members.includes(p.me.id))?.name.toLowerCase() ?? '';
  if (/finance|admin|ops/.test(t)) return 'finance';
  if (/account|client|sales/.test(t)) return 'account';
  return 'maker';
}

export function HomeView(p: Props) {
  const [dump, setDump] = useState('');
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<CardId | null>(null);
  const [saved, setSaved] = usePersisted<Layout | null>(`s2g-home:${p.me.id}:${p.workspaceId}`, null);
  const layout = saved ?? fromTemplate(guessTemplate(p));
  const setLayout = (l: Layout) => setSaved(l);

  const today = localDay();
  const weekAhead = localDay(new Date(Date.now() + 7 * 86_400_000));
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Good morning' : hour < 15 ? 'Good afternoon' : hour < 19 ? 'Good evening' : 'Working late';

  const d = useMemo(() => {
    const work = p.tasks.filter((t) => !isBrief(t));
    const open = work.filter((t) => !t.done);
    const late = (t: Todo) => !t.done && !!t.due && t.due < today;
    const mine = open.filter((t) => doers(t).includes(p.me.id)).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
    const myTeams = p.teams.filter((t) => t.leadId === p.me.id);
    const briefs = p.tasks.filter((t) => isBrief(t) && !t.done);
    const myBriefs = briefs.filter((b) => b.userId === p.me.id || work.some((t) => t.briefId === b.id && t.userId === p.me.id));
    const doneWeek = work.filter((t) => t.done && (t.doneAt ?? '') > weekAgo).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    const unread = p.threads.filter((t) => t.location === 'inbox' && t.unread && !isMine(t.messages[t.messages.length - 1].from.email));
    const end = new Date();
    end.setHours(23, 59, 59);
    const todayEvents = p.events
      .filter((e) => !e.allDay && new Date(e.end) > new Date() && new Date(e.start) < end)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 5);
    const pendingActions = p.meetings.flatMap((m) => m.actions.filter((a) => !a.taskId).map((a) => ({ m, a })));
    const risk = p.clients
      .map((c) => {
        const o = open.filter((t) => t.clientId === c.id);
        return { c, open: o.length, late: o.filter(late).length, waiting: o.filter((t) => !t.userId).length };
      })
      .filter((x) => x.late || x.waiting)
      .sort((a, b) => b.late - a.late || b.waiting - a.waiting);
    const byTeam = p.teams.map((tm) => {
      const o = open.filter((t) => t.teamId === tm.id);
      return { tm, open: o.length, late: o.filter(late).length, waiting: o.filter((t) => !t.userId).length };
    });
    const people = (myTeams.length && !p.isOwner ? p.users.filter((u) => myTeams.some((t) => t.members.includes(u.id))) : p.users).map((u) => {
      const o = open.filter((t) => t.userId === u.id);
      return { u, open: o.length, late: o.filter(late).length, week: o.filter((t) => t.due && t.due <= weekAhead).length };
    });
    const queue = open.filter((t) => !t.userId && (p.isOwner || myTeams.some((tm) => tm.id === t.teamId)));
    const waiting: { key: string; text: string; sub: string; run: () => void; tone?: 'warn' }[] = [
      ...queue.map((t) => ({ key: 'q' + t.id, text: `Pick someone for “${t.title}”`, sub: p.teams.find((x) => x.id === t.teamId)?.name ?? 'Team queue', run: () => p.onOpenTask(t.id) })),
      ...work
        .filter((t) => t.createdBy === p.me.id && t.userId && t.userId !== p.me.id && late(t))
        .map((t) => ({ key: 'l' + t.id, text: `“${t.title}” is late`, sub: `with ${p.users.find((u) => u.id === t.userId)?.name.split(' ')[0] ?? 'someone'}`, run: () => p.onOpenTask(t.id), tone: 'warn' as const })),
      ...briefs
        .filter((b) => b.userId === p.me.id && work.filter((t) => t.briefId === b.id).length > 0 && work.filter((t) => t.briefId === b.id).every((t) => t.done))
        .map((b) => ({ key: 'b' + b.id, text: `All tasks done in “${b.title}”`, sub: 'Review and close the brief', run: () => p.onOpenTask(b.id) })),
      ...mine.filter((t) => t.priority === 'high' && t.due && t.due <= today).map((t) => ({ key: 'm' + t.id, text: t.title, sub: 'High priority, due now', run: () => p.onOpenTask(t.id), tone: 'warn' as const })),
    ];
    // Up next: everything that needs this person, across apps, most urgent first, each with its action.
    type Next = { key: string; rank: number; kind: 'meeting' | 'review' | 'request' | 'late' | 'today' | 'queue' | 'delegated' | 'mail' | 'brief'; text: string; sub: string; task?: Todo; thread?: Thread; event?: CalEvent };
    const soon = Date.now() + 45 * 60_000;
    const upnext = ([
      ...todayEvents.filter((e) => new Date(e.start).getTime() <= soon).map((e) => ({ key: 'e' + e.id, rank: 100, kind: 'meeting' as const, text: e.title, sub: new Date(e.start).getTime() <= Date.now() ? 'Happening now' : `Starts at ${fmtTime(e.start)}`, event: e })),
      ...open.filter((t) => kindOf(t) === 'review' && t.supervisorId === p.me.id).map((t) => ({ key: 'r' + t.id, rank: 90, kind: 'review' as const, text: t.title, sub: `${p.users.find((u) => u.id === doers(t)[0])?.name.split(' ')[0] ?? 'Someone'} finished it, waiting for your review`, task: t })),
      ...open.filter((t) => t.source === 'request' && kindOf(t) === 'open' && (doers(t).includes(p.me.id) || (!t.userId && p.teams.some((tm) => tm.id === t.teamId && tm.leadId === p.me.id)))).map((t) => ({ key: 'q' + t.id, rank: 85, kind: 'request' as const, text: t.title, sub: `New request from ${p.clients.find((c) => c.id === t.clientId)?.name ?? 'a client'}`, task: t })),
      ...mine.filter(late).map((t) => ({ key: 'l' + t.id, rank: 80, kind: 'late' as const, text: t.title, sub: `Late: was due ${new Date(t.due! + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}`, task: t })),
      ...mine.filter((t) => t.due === today && kindOf(t) !== 'review').map((t) => ({ key: 't' + t.id, rank: 70, kind: 'today' as const, text: t.title, sub: 'Due today', task: t })),
      ...queue.map((t) => ({ key: 'u' + t.id, rank: 60, kind: 'queue' as const, text: t.title, sub: `${p.teams.find((x) => x.id === t.teamId)?.name ?? 'Team'} queue, nobody on it yet`, task: t })),
      ...work.filter((t) => t.createdBy === p.me.id && t.userId && !doers(t).includes(p.me.id) && late(t)).map((t) => ({ key: 'd' + t.id, rank: 50, kind: 'delegated' as const, text: t.title, sub: `Late with ${p.users.find((u) => u.id === t.userId)?.name.split(' ')[0] ?? 'someone'}`, task: t })),
      ...unread.filter((t) => p.clients.some((c) => c.domain && t.messages[t.messages.length - 1].from.email.toLowerCase().endsWith('@' + c.domain))).map((t) => ({ key: 'm' + t.id, rank: 45, kind: 'mail' as const, text: t.subject, sub: `${t.messages[t.messages.length - 1].from.name} is waiting for a reply`, thread: t })),
      ...briefs.filter((b) => b.userId === p.me.id && work.some((t) => t.briefId === b.id) && work.filter((t) => t.briefId === b.id).every((t) => t.done)).map((b) => ({ key: 'b' + b.id, rank: 30, kind: 'brief' as const, text: b.title, sub: 'Every task is done, close the brief', task: b })),
    ] as Next[]).sort((a, b) => b.rank - a.rank || (a.task?.due ?? '').localeCompare(b.task?.due ?? ''));
    return { open, late, mine, briefs, myBriefs, doneWeek, unread, todayEvents, pendingActions, risk, byTeam, people, queue, waiting, myTeams, upnext };
  }, [p.tasks, p.threads, p.events, p.meetings, p.clients, p.teams, p.users, p.me.id, p.isOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  // A short, plain-language briefing built from the numbers (no AI call needed).
  const brief: string[] = [];
  const myLate = d.mine.filter(d.late);
  const myToday = d.mine.filter((t) => t.due === today);
  if (layout.template === 'founder') {
    const late = d.open.filter(d.late).length;
    if (late) brief.push(`${late} task${late > 1 ? 's are' : ' is'} late across the company${d.risk[0] ? `, most at ${d.risk[0].c.name}` : ''}.`);
    if (d.queue.length) brief.push(`${d.queue.length} task${d.queue.length > 1 ? 's' : ''} waiting for someone to pick up.`);
    if (d.doneWeek.length) brief.push(`The team finished ${d.doneWeek.length} this week.`);
  } else {
    if (myLate.length) brief.push(`${myLate.length} of your task${myLate.length > 1 ? 's are' : ' is'} overdue, starting with “${myLate[0].title}”.`);
    if (myToday.length) brief.push(`${myToday.length} due today.`);
    if (d.myTeams.length && d.queue.length) brief.push(`${d.queue.length} in your team’s queue without a person.`);
  }
  if (d.unread.length) brief.push(`${d.unread.length} unread email${d.unread.length > 1 ? 's' : ''}.`);
  if (d.todayEvents.length) brief.push(`Next up: ${d.todayEvents[0].title} at ${fmtTime(d.todayEvents[0].start)}.`);
  if (!brief.length) brief.push('Nothing urgent. A good day to get ahead.');

  const taskRow = (t: Todo) => {
    const due = t.due ? dueLabel(t.due) : null;
    const c = p.clients.find((c) => c.id === t.clientId);
    const br = p.tasks.find((x) => x.id === t.briefId);
    return (
      <li key={t.id} className="home-task">
        <button className="todo-check" onClick={() => p.onToggleTask(t.id)} aria-label="Mark done" />
        <button className="ht-title" onClick={() => p.onOpenTask(t.id)}>
          {t.title}
          {br && <small className="ht-brief">{br.title}</small>}
        </button>
        {c && (
          <span className="client-chip" style={{ ['--c' as string]: c.color }}>
            {c.name}
          </span>
        )}
        {due && <span className={`due ${due.cls}`}>{due.text}</span>}
      </li>
    );
  };
  const bar = (n: number, max: number, warn?: boolean) => (
    <span className="bar wide">
      <span style={{ width: `${Math.min(100, (n / Math.max(1, max)) * 100)}%` }} className={warn ? 'warn' : ''} />
    </span>
  );
  const empty = (text: string) => <p className="te-empty">{text}</p>;

  const cards: Record<CardId, { icon: ReactNode; link?: [string, () => void]; body: () => ReactNode; show?: boolean }> = {
    briefing: {
      icon: <Sparkles size={15} />,
      body: () => <p className="brief-text">{brief.join(' ')}</p>,
    },
    dump: {
      icon: <Mic size={15} />,
      show: p.enabled.has('tasks'),
      body: () => (
        <form
          className="home-dump"
          onSubmit={(e) => {
            e.preventDefault();
            p.onDump(dump);
            setDump('');
          }}
        >
          <input id="home-dump" value={dump} onChange={(e) => setDump(e.target.value)} placeholder={`What’s on your mind? ${term.Many}, who does what, by when…`} />
          <button className="primary-btn sm" type="submit">
            <Sparkles size={14} /> Brain dump
          </button>
        </form>
      ),
    },
    pulse: {
      icon: <LayoutGrid size={15} />,
      link: [`${term.Many} × teams`, p.onOpenGrid],
      body: () => (
        <div className="pulse">
          {(
            [
              ['Late', d.open.filter(d.late).length, 'warn', p.onOpenGrid],
              ['Not picked up', d.open.filter((t) => !t.userId).length, '', p.onOpenGrid],
              ['Done this week', d.doneWeek.length, 'go', p.onOpenTasks],
            ] as const
          )
            .filter(([, n]) => n > 0)
            .map(([l, n, cls, go]) => (
              <button key={l} className={`pulse-num ${cls}`} onClick={go}>
                <b>{n}</b>
                <span>{l}</span>
              </button>
            ))}
        </div>
      ),
    },
    risk: {
      icon: <AlertTriangle size={15} />,
      body: () =>
        d.risk.length === 0 ? (
          empty(`No ${term.one} has late or stuck work.`)
        ) : (
          <ul className="home-list">
            {d.risk.slice(0, 5).map(({ c, late, waiting }) => (
              <li key={c.id}>
                <button className="risk-row" onClick={() => p.onOpenClient(c.id)}>
                  <ProjectBadge p={c} kind="client-dot sm" />
                  <strong>{c.name}</strong>
                  <span className="risk-why">
                    {late ? <b className="late">{late} late</b> : null}
                    {late && waiting ? ' · ' : ''}
                    {waiting ? `${waiting} not picked up` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ),
    },
    lateByTeam: {
      icon: <Users size={15} />,
      body: () =>
        d.byTeam.every((x) => !x.late && !x.waiting) ? (
          empty('No team has late or unassigned work.')
        ) : (
        <ul className="home-list">
          {d.byTeam.filter((x) => x.late || x.waiting).map(({ tm, late, waiting }) => (
            <li key={tm.id}>
              <button className="team-row" onClick={() => p.onOpenTeam(tm.id)}>
                <span className="team-square" style={{ background: tm.color }} />
                <span className="tr-name">{tm.name}</span>
                <span className="tr-num">
                  {late ? <b className="late">{late} late</b> : null}
                  {late && waiting ? ' · ' : ''}
                  {waiting ? <em>{waiting} not picked up</em> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
        ),
    },
    workload: {
      icon: <Users size={15} />,
      body: () => {
        const max = Math.max(1, ...d.people.map((x) => x.open));
        return (
          <div className="load-grid">
            {d.people.map(({ u, open, late, week }) => (
              <div key={u.id} className="load">
                <Avatar person={u} size={26} />
                <span className="load-text">
                  <strong>{u.id === p.me.id ? 'You' : u.name.split(' ')[0]}</strong>
                  {bar(open, max, late > 0)}
                  <small>
                    {open} open · {week} this week{late ? ` · ${late} late` : ''}
                  </small>
                </span>
              </div>
            ))}
          </div>
        );
      },
    },
    waiting: {
      icon: <AlertTriangle size={15} />,
      body: () =>
        d.waiting.length === 0 ? (
          empty('Nothing is waiting on you.')
        ) : (
          <ul className="home-list">
            {d.waiting.slice(0, 6).map((w) => (
              <li key={w.key}>
                <button className={`home-notice ${w.tone ?? ''}`} onClick={w.run}>
                  <span>{w.text}</span>
                  <time>{w.sub}</time>
                </button>
              </li>
            ))}
          </ul>
        ),
    },
    teamQueue: {
      icon: <Inbox size={15} />,
      body: () =>
        d.queue.length === 0 ? (
          empty('Every task has a person. Nice.')
        ) : (
          <ul className="home-list">
            {d.queue.slice(0, 6).map((t) => {
              const tm = p.teams.find((x) => x.id === t.teamId);
              return (
                <li key={t.id} className="queue-row">
                  <button className="ht-title" onClick={() => p.onOpenTask(t.id)}>
                    {t.title}
                    <small className="ht-brief">
                      {tm?.name}
                      {t.due ? ` · ${dueLabel(t.due).text}` : ''}
                    </small>
                  </button>
                  <Select
                    value=""
                    options={peopleOptions(p.users.filter((u) => !tm || tm.members.includes(u.id)), p.me.id, false)}
                    onChange={(v) => p.onAssign(t.id, v)}
                    label="Assign"
                    placeholder="Assign"
                    className="sel-flat"
                  />
                </li>
              );
            })}
          </ul>
        ),
    },
    briefs: {
      icon: <FileText size={15} />,
      link: ['All briefs', p.onOpenBriefs],
      body: () => {
        const list = layout.template === 'founder' ? d.briefs : d.myBriefs;
        return list.length === 0 ? (
          empty('No open briefs.')
        ) : (
          <ul className="home-list">
            {list.slice(0, 4).map((b) => {
              const subs = p.tasks.filter((t) => t.briefId === b.id);
              const done = subs.filter((t) => t.done).length;
              const owner = p.users.find((u) => u.id === b.userId);
              return (
                <li key={b.id}>
                  <button className="brief-row" onClick={() => p.onOpenTask(b.id)}>
                    <span className="br-title">{b.title}</span>
                    <span className="br-meta">
                      {owner && <Avatar person={owner} size={18} />}
                      {bar(done, subs.length || 1)}
                      {done}/{subs.length}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        );
      },
    },
    mytasks: {
      icon: <ListChecks size={15} />,
      link: ['All tasks', p.onOpenTasks],
      show: p.enabled.has('tasks'),
      body: () => (d.mine.length === 0 ? empty('Nothing on your plate. 🎉') : <ul className="home-list">{d.mine.slice(0, 7).map(taskRow)}</ul>),
    },
    today: {
      icon: <CalendarDays size={15} />,
      link: ['Calendar', () => p.onOpenCalendar()],
      show: p.enabled.has('calendar'),
      body: () =>
        d.todayEvents.length === 0 ? (
          empty('No more meetings today.')
        ) : (
          <ul className="home-list">
            {d.todayEvents.map((e) => (
              <li key={e.id}>
                <button className="home-event" onClick={() => p.onOpenCalendar(e.id)}>
                  <time>{fmtTime(e.start)}</time>
                  <span>{e.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ),
    },
    unread: {
      icon: <Inbox size={15} />,
      link: ['Inbox', p.onOpenMail],
      show: p.enabled.has('mail'),
      body: () =>
        d.unread.length === 0 ? (
          empty('Inbox zero.')
        ) : (
          <ul className="home-list">
            {d.unread.slice(0, 5).map((t) => {
              const last = t.messages[t.messages.length - 1];
              return (
                <li key={t.id}>
                  <button className="home-mail" onClick={() => p.onOpenThread(t.id)}>
                    <Avatar person={last.from} size={26} />
                    <span>
                      <strong>{last.from.name}</strong>
                      <small>{t.subject}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ),
    },
    foryou: {
      icon: <Hash size={15} />,
      body: () => {
        const fresh = p.notices.filter((n) => !n.read).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
        return fresh.length === 0 ? (
          empty('You’re all caught up.')
        ) : (
          <ul className="home-list">
            {fresh.map((n) => (
              <li key={n.id}>
                <button className="home-notice" onClick={() => p.onNotice(n)}>
                  <span>{n.text}</span>
                  <time>{relative(n.at)}</time>
                </button>
              </li>
            ))}
          </ul>
        );
      },
    },
    meetings: {
      icon: <Video size={15} />,
      show: p.enabled.has('meet'),
      body: () =>
        d.pendingActions.length === 0 ? (
          empty('Every meeting action item has an owner.')
        ) : (
          <ul className="home-list">
            {d.pendingActions.slice(0, 4).map(({ m, a }, i) => (
              <li key={i}>
                <button className="home-notice" onClick={() => p.onOpenMeeting(m.id)}>
                  <span>
                    {a.title} <em className="muted">· {a.owner ?? 'no owner'}</em>
                  </span>
                  <time>{m.title}</time>
                </button>
              </li>
            ))}
          </ul>
        ),
    },
    clients: {
      icon: <LayoutGrid size={15} />,
      body: () => (
        <div className="client-tiles">
          {p.clients.map((c) => {
            const open = d.open.filter((t) => t.clientId === c.id);
            const late = open.filter(d.late).length;
            return (
              <button key={c.id} className="client-tile" onClick={() => p.onOpenClient(c.id)}>
                <ProjectBadge p={c} kind="client-badge" />
                <span className="ctl-text">
                  <strong>{c.name}</strong>
                  <small>
                    {late ? (
                      <b className="late">{late} late</b>
                    ) : open.length ? (
                      (() => {
                        const next = open.filter((t) => t.due).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))[0] ?? open[0];
                        return `Next: ${next.title}${next.due ? `, ${dueWord(next.due)}` : ''}`;
                      })()
                    ) : c.status === 'lead' ? (
                      'Lead: nothing scheduled'
                    ) : (
                      'Nothing open'
                    )}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      ),
    },
    wins: {
      icon: <PartyPopper size={15} />,
      body: () =>
        d.doneWeek.length === 0 && p.kudos.length === 0 ? (
          empty('Nothing finished yet this week.')
        ) : (
          <ul className="home-list">
            {p.kudos.slice(0, 3).map((k) => {
              const to = p.users.find((u) => u.id === k.to);
              const from = p.users.find((u) => u.id === k.from);
              return (
                <li key={k.id} className="win kudos-win">
                  <span className="kudos-emoji sm">🙌</span>
                  <span className="ht-title">
                    Kudos to {to ? (to.id === p.me.id ? 'you' : to.name.split(' ')[0]) : 'someone'}
                    <small className="ht-brief">
                      {k.text ? `“${k.text}” · ` : ''}from {from ? (from.id === p.me.id ? 'you' : from.name.split(' ')[0]) : 'someone'} · {relative(k.at)}
                    </small>
                  </span>
                </li>
              );
            })}
            {d.doneWeek.slice(0, 5).map((t) => {
              const who = p.users.find((u) => u.id === (t.doneBy ?? t.userId));
              return (
                <li key={t.id} className="win">
                  {who && <Avatar person={who} size={22} />}
                  <button className="ht-title" onClick={() => p.onOpenTask(t.id)}>
                    {t.title}
                    <small className="ht-brief">
                      {who ? (who.id === p.me.id ? 'You' : who.name.split(' ')[0]) : 'Someone'} · {t.doneAt ? relative(t.doneAt) : ''}
                    </small>
                  </button>
                  <Check size={14} className="win-check" />
                </li>
              );
            })}
          </ul>
        ),
    },
  };

  const visible = layout.cards.filter((c) => cards[c.id] && cards[c.id].show !== false);
  const missing = (Object.keys(CARD_INFO) as CardId[]).filter((id) => !layout.cards.some((c) => c.id === id) && cards[id].show !== false);
  const move = (id: CardId, to: number) => {
    const list = [...layout.cards];
    const from = list.findIndex((c) => c.id === id);
    if (from < 0 || to < 0 || to >= list.length) return;
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
    setLayout({ ...layout, cards: list });
  };

  return (
    <section className="home-pane view-enter">
      <div className="home-scroll">
        <header className="home-head">
          <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="home-head-text">
            <p className="home-date">{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>
              {greeting}, {p.firstName}.
            </h1>
          </div>
          <button className={`ghost-btn sm customise-btn ${editing ? 'on' : ''}`} onClick={() => setEditing((e) => !e)}>
            {editing ? <Check size={14} /> : <Settings2 size={14} />} {editing ? 'Done' : 'Customise'}
          </button>
        </header>

        <SmoothHeight>
        {editing && (
          <div className="home-edit">
            <div className="he-row">
              <span className="he-label">Start from</span>
              <Select<HomeTemplateId>
                value={layout.template}
                options={(Object.keys(TEMPLATES) as HomeTemplateId[]).map((id) => ({ value: id, label: TEMPLATES[id].name, hint: TEMPLATES[id].hint }))}
                onChange={(t) => setLayout(fromTemplate(t))}
                label="Home template"
                width={300}
              />
              <Select<CardId>
                value={null}
                options={missing.map((id) => ({ value: id, label: CARD_INFO[id].name, hint: CARD_INFO[id].hint, icon: <Plus size={14} /> }))}
                onChange={(id) => setLayout({ ...layout, cards: [...layout.cards, { id, size: 'm' }] })}
                placeholder={missing.length ? 'Add a card' : 'All cards added'}
                disabled={!missing.length}
                label="Add a card"
                width={300}
              />
              <button className="link-btn" onClick={() => setSaved(null)}>
                Reset
              </button>
            </div>
            <p className="muted small">Drag cards to reorder, or use the arrows. Make a card wide or narrow, or remove it. Only your Home changes.</p>
          </div>
        )}
        </SmoothHeight>

        <button className="home-search" onClick={p.onSearch}>
          <Search size={16} />
          <span>Jump to a {term.one}, task, person or file, or ask anything</span>
          <kbd>⌘K</kbd>
        </button>

        {p.news?.map((n) => (
          <div key={n.id} className={`news-card ${n.kind}`} role="status">
            {n.kind === 'warning' ? <AlertTriangle size={16} /> : <Megaphone size={16} />}
            <span>
              {n.text}
              {n.link && (
                <a href={n.link} target="_blank" rel="noreferrer">
                  Read more
                </a>
              )}
            </span>
            {p.onDismissNews && (
              <button
                type="button"
                className="icon-btn sm"
                aria-label="Dismiss"
                onClick={(e) => {
                  const card = (e.currentTarget as HTMLElement).closest('.news-card');
                  card?.classList.add('leaving');
                  setTimeout(() => p.onDismissNews!(n.id), 180);
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}

        {p.setup && p.setup.some((x) => !x.done) && (
          <section className="setup-card">
            <h2>Finish setting up</h2>
            <ul>
              {p.setup.map((x) => (
                <li key={x.key} className={x.done ? 'done' : ''}>
                  <span className="setup-mark">{x.done ? <Check size={13} /> : null}</span>
                  <button type="button" className="setup-text" onClick={x.onOpen} disabled={x.done}>
                    <strong>{x.label}</strong>
                    <small>{x.hint}</small>
                  </button>
                  {!x.done && (
                    <button type="button" className="ghost-btn sm" onClick={x.onOpen}>
                      Set up
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <UpNext
          items={d.upnext}
          mine={d.mine}
          events={d.todayEvents}
          users={p.users}
          teams={p.teams}
          me={p.me.id}
          onDone={p.onToggleTask}
          onAssign={p.onAssign}
          onNudge={p.onNudge}
          onOpenTask={p.onOpenTask}
          onOpenThread={p.onOpenThread}
          onOpenEvent={(id) => p.onOpenCalendar(id)}
        />

        <div className={`home-grid cards ${editing ? 'editing' : ''}`}>
          {visible.map((c, i) => {
            const card = cards[c.id];
            const info = CARD_INFO[c.id];
            return (
              <div
                key={c.id}
                className={`side-card home-card ${c.size === 'l' ? 'wide' : ''} ${dragId === c.id ? 'dragging' : ''}`}
                draggable={editing}
                onDragStart={(e) => {
                  setDragId(c.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnter={() => dragId && dragId !== c.id && move(dragId, layout.cards.findIndex((x) => x.id === c.id))}
                onDragOver={(e) => editing && e.preventDefault()}
                onDragEnd={() => setDragId(null)}
              >
                <h3>
                  <GripVertical size={15} className={`home-grip ${editing ? 'on' : ''}`} aria-hidden={!editing} />
                  {card.icon} {info.name}
                  {!editing && card.link && (
                    <button className="link-btn" onClick={card.link[1]}>
                      {card.link[0]} <ArrowRight size={13} />
                    </button>
                  )}
                  {editing && (
                    <span className="card-tools">
                      <button className="icon-btn sm phone-only" onClick={() => move(c.id, i - 1)} disabled={i === 0} aria-label="Move up">
                        <ArrowUp size={14} />
                      </button>
                      <button className="icon-btn sm phone-only" onClick={() => move(c.id, i + 1)} disabled={i === visible.length - 1} aria-label="Move down">
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="icon-btn sm hide-phone"
                        onClick={() => setLayout({ ...layout, cards: layout.cards.map((x) => (x.id === c.id ? { ...x, size: x.size === 'l' ? 'm' : 'l' } : x)) })}
                        title={c.size === 'l' ? 'Make narrow' : 'Make wide'}
                      >
                        {c.size === 'l' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                      </button>
                      <button className="icon-btn sm" onClick={() => setLayout({ ...layout, cards: layout.cards.filter((x) => x.id !== c.id) })} title="Remove card">
                        <X size={14} />
                      </button>
                    </span>
                  )}
                </h3>
                <div className={editing ? 'card-body dim' : 'card-body'}>{card.body()}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** "today", "tomorrow" read lower-case mid-sentence; dates keep their capitals. */
const dueWord = (d: string) => {
  const t = dueLabel(d).text;
  return /^[A-Z][a-z]{2},/.test(t) ? t : t.toLowerCase();
};
type NextItem = ReturnType<typeof nextShape>;
const nextShape = (x: { key: string; rank: number; kind: 'meeting' | 'review' | 'request' | 'late' | 'today' | 'queue' | 'delegated' | 'mail' | 'brief'; text: string; sub: string; task?: Todo; thread?: Thread; event?: CalEvent }) => x;

/** The top of Home: what needs you now, across apps, with the action right there. No counts. */
function UpNext(p: {
  items: NextItem[];
  mine: Todo[];
  events: CalEvent[];
  users: User[];
  teams: Team[];
  me: string;
  onDone: (id: string) => void;
  onAssign: (taskId: string, userId: string) => void;
  onNudge: (taskId: string) => void;
  onOpenTask: (id: string) => void;
  onOpenThread: (id: string) => void;
  onOpenEvent: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [gone, setGone] = useState<string[]>([]); // acted on: folds away, then leaves the list
  const [leaving, setLeaving] = useState<string[]>([]);
  const items = p.items.filter((x) => !gone.includes(x.key));
  const shown = all ? items : items.slice(0, 6);
  const act = (key: string, fn: () => void) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return (setGone((g) => [...g, key]), fn());
    setLeaving((l) => [...l, key]);
    setTimeout(() => {
      setGone((g) => [...g, key]);
      setLeaving((l) => l.filter((k) => k !== key));
      fn();
    }, 240);
  };
  const open = (x: NextItem) => (x.task ? p.onOpenTask(x.task.id) : x.thread ? p.onOpenThread(x.thread.id) : x.event ? p.onOpenEvent(x.event.id) : undefined);
  const action = (x: NextItem) => {
    const t = x.task;
    switch (x.kind) {
      case 'meeting': {
        // A call link: join it from here.
        const link = x.event && meetingLinkOf(x.event);
        return link ? (
          <a className="primary-btn sm" href={link.url} target="_blank" rel="noopener noreferrer">
            <Video size={14} /> Join
          </a>
        ) : (
          <button className="primary-btn sm" onClick={() => open(x)}>
            Open
          </button>
        );
      }
      case 'review':
        return (
          <button className="primary-btn sm" onClick={() => act(x.key, () => p.onDone(t!.id))}>
            <Check size={14} /> Approve
          </button>
        );
      case 'late':
      case 'today':
        return (
          <button className="ghost-btn sm" onClick={() => act(x.key, () => p.onDone(t!.id))}>
            <Check size={14} /> Done
          </button>
        );
      case 'queue': {
        const tm = p.teams.find((m) => m.id === t!.teamId);
        return (
          <Select
            value=""
            options={peopleOptions(p.users.filter((u) => !tm || tm.members.includes(u.id)), p.me, false)}
            onChange={(v) => act(x.key, () => p.onAssign(t!.id, v))}
            label="Assign"
            placeholder="Assign"
            className="sel-flat"
          />
        );
      }
      case 'delegated':
        return (
          <button className="ghost-btn sm" onClick={() => act(x.key, () => p.onNudge(t!.id))}>
            Remind
          </button>
        );
      case 'mail':
        return (
          <button className="ghost-btn sm" onClick={() => open(x)}>
            Reply
          </button>
        );
      case 'brief':
        return (
          <button className="ghost-btn sm" onClick={() => act(x.key, () => p.onDone(t!.id))}>
            Close brief
          </button>
        );
      default:
        return (
          <button className="ghost-btn sm" onClick={() => open(x)}>
            Open
          </button>
        );
    }
  };
  const ICON: Record<NextItem['kind'], ReactNode> = {
    meeting: <Video size={15} />,
    review: <Check size={15} />,
    request: <Inbox size={15} />,
    late: <AlertTriangle size={15} />,
    today: <ListChecks size={15} />,
    queue: <Users size={15} />,
    delegated: <AlertTriangle size={15} />,
    mail: <Inbox size={15} />,
    brief: <FileText size={15} />,
  };

  if (!items.length) {
    // Clear: say what comes next instead of an empty box.
    const nextTask = p.mine.find((t) => t.due);
    const nextEvent = p.events[0];
    return (
      <section className="up-next clear">
        <h2>
          <Check size={16} /> You’re clear for now
        </h2>
        <p className="muted">
          {nextEvent ? `Next: ${nextEvent.title} at ${fmtTime(nextEvent.start)}.` : nextTask ? `Next on your list: “${nextTask.title}”, ${dueWord(nextTask.due!)}.` : 'Nothing scheduled. A good time to get ahead.'}
        </p>
      </section>
    );
  }
  return (
    <section className="up-next">
      <h2>Up next</h2>
      <SmoothHeight>
      <ul>
        {shown.map((x) => (
          <li key={x.key} className={`un-row k-${x.kind} ${leaving.includes(x.key) ? 'leaving' : ''}`}>
            <span className="un-icon">{ICON[x.kind]}</span>
            <button className="un-text" onClick={() => open(x)}>
              <strong>{x.text}</strong>
              <small>{x.sub}</small>
            </button>
            <span className="un-act">{action(x)}</span>
          </li>
        ))}
      </ul>
      </SmoothHeight>
      {items.length > 6 && (
        <button className="link-btn un-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show less' : `Show ${items.length - 6} more`}
        </button>
      )}
    </section>
  );
}
