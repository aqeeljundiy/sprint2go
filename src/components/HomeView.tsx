import { ProjectBadge } from './ProjectBadge';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { term } from '../terms';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, FileText, GripVertical, Hash, Inbox, LayoutGrid, ListChecks, Maximize2, Menu, Mic, Minimize2, PartyPopper, Plus, Settings2, Sparkles, Users, Video, X, Search, Megaphone } from 'lucide-react';
import type { CalEvent, Client, HomeTemplateId, Meeting, Notice, Team, Thread, Todo, User } from '../types';
import { fmtDay, fmtTime, fmtWeekday, fmtWeekdayLong } from '../i18n/format';
import { mark, t, textOf, tn, tx } from '../i18n';
import { tj } from '../i18n/tj';
import { useLang } from '../i18n/useLang';
import { isMine } from '../identity';
import { usePersisted } from '../settings';
import { relative, localDay } from '../utils';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { Sheet } from './ui/Sheet';
import { doers, dueLabel, isBrief, peopleOptions } from './TasksView';
import { kindOf } from '../stages';
import { EmptyState } from './ui/EmptyState';
import { useAppSettings, useCreateAction } from '../mobile/chrome';
import { usePhone } from '../mobile/media';
import { needsYou, updatesOf } from '../needsYou';
import { addDays } from '../taskDates';
import { CustomiseList, LiveCalls, MeetingStrip, NeedsList, TodayBlock, Updates } from './home/HomeParts';

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

/** A name and a hint, read in the person's language each time they're shown (mark() lets the check find the words). */
const named = (name: string, hint: string) => ({
  get name() {
    return t(name);
  },
  get hint() {
    return t(hint);
  },
});

const CARD_INFO: Record<CardId, { name: string; hint: string }> = {
  briefing: named(mark('Briefing'), mark('A short summary of your day')),
  dump: named(mark('Brain dump'), mark('Type what’s on your mind')),
  pulse: named(mark('Company numbers'), mark('Late, not picked up, done this week')),
  risk: { get name() { return t('{Projects} at risk', { projects: term.many }); }, get hint() { return t('Late or stuck work per {project}', { project: term.one }); } },
  lateByTeam: named(mark('Teams'), mark('Open and late work per team')),
  workload: named(mark('Workload'), mark('How busy each person is')),
  waiting: named(mark('Waiting on you'), mark('Already at the top, in Needs you')),
  teamQueue: named(mark('Team queue'), mark('Tasks nobody has picked up yet')),
  briefs: named(mark('Briefs'), mark('Bigger jobs and their progress')),
  mytasks: named(mark('My tasks'), mark('Your queue, in order')),
  today: named(mark('Today'), mark('Your next meetings')),
  unread: named(mark('Unread mail'), mark('Mail waiting for you')),
  foryou: named(mark('For you'), mark('Mentions and assignments')),
  meetings: named(mark('From meetings'), mark('Action items without an owner')),
  clients: { get name() { return term.Many; }, get hint() { return t('Every {project} at a glance', { project: term.one }); } },
  wins: named(mark('Wins this week'), mark('What the team finished')),
};

const TEMPLATES: Record<HomeTemplateId, { name: string; hint: string; cards: [CardId, Size][] }> = {
  founder: {
    get name() { return t('Founder / C-level'); },
    get hint() { return t('What’s happening across the whole company'); },
    cards: [['risk', 'm'], ['lateByTeam', 'm'], ['workload', 'm'], ['briefs', 'm']],
  },
  lead: {
    get name() { return t('Team lead'); },
    get hint() { return t('Your team’s queue and who is busy'); },
    cards: [['mytasks', 'm'], ['workload', 'm'], ['today', 'm'], ['briefs', 'm']],
  },
  maker: {
    get name() { return t('Designer / Editor'); },
    get hint() { return t('Your queue and the briefs behind it'); },
    cards: [['mytasks', 'l'], ['briefs', 'm'], ['today', 'm']],
  },
  account: {
    get name() { return t('Account manager'); },
    get hint() { return t('Your {projects}, their emails and meetings', { projects: term.many }); },
    cards: [['clients', 'l'], ['unread', 'm'], ['meetings', 'm']],
  },
  finance: {
    get name() { return t('Finance / Admin'); },
    get hint() { return t('Payments, invoices and deadlines'); },
    cards: [['mytasks', 'l'], ['unread', 'm'], ['today', 'm']],
  },
};
export const HOME_TEMPLATES = TEMPLATES;

const fromTemplate = (tpl: HomeTemplateId): Layout => ({ template: tpl, cards: TEMPLATES[tpl].cards.map(([id, size]) => ({ id, size })) });

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
  ai?: boolean; // AI is on for the company: Brain dump is Home's create button on phones
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
  /** At the top of Home: the demo company's "Try this" list, or the invitation to look around it first. */
  top?: ReactNode;
  onStart: (taskId: string) => void; // a guest request: start it
  onReschedule: (taskId: string, day: string) => void; // '' clears the date
  onReadNotices: (ids: string[]) => void;
  onAllNotices: () => void; // phones: every notification, read and unread
  /** Huddles going on in your channels, and joining one. */
  calls?: { id: string; name: string; people: User[] }[];
  onJoinHuddle?: (channelId: string) => void;
  /** The notetaker for the meeting about to start: on or off when it joins by itself, else sent from here. */
  botWillJoin?: (e: CalEvent) => boolean;
  onBotJoin?: (e: CalEvent, join: boolean) => void;
  onSendNotetaker?: (e: CalEvent) => void;
  notetakerSent?: Record<string, string>;
}

/** The template that fits a person: owners get the company view, team leads the team view, then by team. */
function guessTemplate(p: Props): HomeTemplateId {
  if (p.defaultTemplate) return p.defaultTemplate;
  if (p.isOwner) return 'founder';
  if (p.teams.some((tm) => tm.leadId === p.me.id)) return 'lead';
  const team = p.teams.find((x) => x.members.includes(p.me.id))?.name.toLowerCase() ?? '';
  if (/finance|admin|ops/.test(team)) return 'finance';
  if (/account|client|sales/.test(team)) return 'account';
  return 'maker';
}

export function HomeView(p: Props) {
  useCreateAction('home', p.ai !== false && { label: t('Brain dump'), icon: Sparkles, run: () => p.onDump() });
  const lang = useLang(); // the memos below write words
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
  // English: morning until 11, afternoon until 15, evening until 19, then working late. Indonesian has its own split
  // (pagi, siang, sore until 18, malam): from 18 to 19 English still says evening while Indonesian says malam.
  const name = p.firstName;
  const greeting =
    hour < 11
      ? t('Good morning, {name}.', { name })
      : hour < 15
        ? t('Good afternoon, {name}.', { name })
        : hour < 18
          ? t('Good evening, {name}.', { name })
          : hour < 19
            ? tx('after 6 pm', 'Good evening, {name}.', { name })
            : t('Working late, {name}.', { name });

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
      ...queue.map((tk) => ({ key: 'q' + tk.id, text: t('Pick someone for “{title}”', { title: tk.title }), sub: p.teams.find((x) => x.id === tk.teamId)?.name ?? t('Team queue'), run: () => p.onOpenTask(tk.id) })),
      ...work
        .filter((tk) => tk.createdBy === p.me.id && tk.userId && tk.userId !== p.me.id && late(tk))
        .map((tk) => {
          const who = p.users.find((u) => u.id === tk.userId)?.name.split(' ')[0];
          return { key: 'l' + tk.id, text: t('“{title}” is late', { title: tk.title }), sub: who ? t('with {name}', { name: who }) : t('with someone'), run: () => p.onOpenTask(tk.id), tone: 'warn' as const };
        }),
      ...briefs
        .filter((b) => b.userId === p.me.id && work.filter((tk) => tk.briefId === b.id).length > 0 && work.filter((tk) => tk.briefId === b.id).every((tk) => tk.done))
        .map((b) => ({ key: 'b' + b.id, text: t('All tasks done in “{title}”', { title: b.title }), sub: t('Review and close the brief'), run: () => p.onOpenTask(b.id) })),
      ...mine.filter((tk) => tk.priority === 'high' && tk.due && tk.due <= today).map((tk) => ({ key: 'm' + tk.id, text: tk.title, sub: t('High priority, due now'), run: () => p.onOpenTask(tk.id), tone: 'warn' as const })),
    ];
    return { open, late, mine, briefs, myBriefs, doneWeek, unread, todayEvents, pendingActions, risk, byTeam, people, queue, waiting, myTeams };
  }, [p.tasks, p.threads, p.events, p.meetings, p.clients, p.teams, p.users, p.me.id, p.isOwner, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Needs you: the same rules as the Home badge and the AI connector (src/needsYou.ts). It looks again every half
  // minute, so the meeting strip comes and goes on time.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClock((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const needs = useMemo(
    () =>
      needsYou({
        me: p.me.id,
        today,
        now: Date.now(),
        tasks: p.tasks,
        stageKind: (tk) => kindOf(tk as Todo),
        teams: p.teams,
        clients: p.clients,
        isOwner: p.isOwner,
        firstName: (id) => p.users.find((u) => u.id === id)?.name.split(' ')[0] ?? '',
        events: p.events,
        threads: p.threads,
        mine: isMine,
        notices: p.notices,
        dayWords: (day) => (day === addDays(today, -1) ? t('yesterday') : fmtDay(day)), // "Was due yesterday", "Was due 6 Oct"
        minutes: (iso) => fmtTime(iso),
      }),
    [p.tasks, p.events, p.threads, p.notices, p.teams, p.clients, p.users, p.me.id, p.isOwner, clock, today, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const strip = needs.filter((x) => x.group === 'now');
  const needList = needs.filter((x) => x.group === 'needs');
  const dueToday = needs.filter((x) => x.group === 'today').map((x) => p.tasks.find((t) => t.id === x.taskId)).filter((t): t is Todo => !!t);
  const updates = updatesOf(p.notices, needs);
  const laterToday = d.todayEvents.filter((e) => !strip.some((x) => x.eventId === e.id));
  const phone = usePhone();
  const [customising, setCustomising] = useState(false);

  // A short, plain-language briefing built from the numbers (no AI call needed).
  const brief: string[] = [];
  const myLate = d.mine.filter(d.late);
  const myToday = d.mine.filter((t) => t.due === today);
  if (layout.template === 'founder') {
    const late = d.open.filter(d.late).length;
    if (late)
      brief.push(
        d.risk[0]
          ? tn(late, '{n} task is late across the company, most at {project}.', '{n} tasks are late across the company, most at {project}.', { project: d.risk[0].c.name })
          : tn(late, '{n} task is late across the company.', '{n} tasks are late across the company.'),
      );
    if (d.queue.length) brief.push(tn(d.queue.length, '{n} task waiting for someone to pick up.', '{n} tasks waiting for someone to pick up.'));
    if (d.doneWeek.length) brief.push(tn(d.doneWeek.length, 'The team finished {n} this week.', 'The team finished {n} this week.'));
  } else {
    if (myLate.length) brief.push(tn(myLate.length, '{n} of your tasks is overdue, starting with “{title}”.', '{n} of your tasks are overdue, starting with “{title}”.', { title: myLate[0].title }));
    if (myToday.length) brief.push(tn(myToday.length, '{n} due today.', '{n} due today.'));
    if (d.myTeams.length && d.queue.length) brief.push(tn(d.queue.length, '{n} in your team’s queue without a person.', '{n} in your team’s queue without a person.'));
  }
  if (d.unread.length) brief.push(tn(d.unread.length, '{n} unread email.', '{n} unread emails.'));
  if (d.todayEvents.length) brief.push(t('Next up: {title} at {time}.', { title: d.todayEvents[0].title, time: fmtTime(d.todayEvents[0].start) }));
  if (!brief.length) brief.push(t('Nothing urgent. A good day to get ahead.'));

  const taskRow = (tk: Todo) => {
    const due = tk.due ? dueLabel(tk.due) : null;
    const c = p.clients.find((c) => c.id === tk.clientId);
    const br = p.tasks.find((x) => x.id === tk.briefId);
    return (
      <li key={tk.id} className="home-task">
        <button className="todo-check" onClick={() => p.onToggleTask(tk.id)} aria-label={t('Mark done')} />
        <button className="ht-title" onClick={() => p.onOpenTask(tk.id)}>
          {tk.title}
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
  const empty = (text: string) => <EmptyState compact text={text} />;

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
          <input id="home-dump" value={dump} onChange={(e) => setDump(e.target.value)} placeholder={t('What’s on your mind? {Projects}, who does what, by when…', { projects: term.many })} />
          <button className="primary-btn sm" type="submit">
            <Sparkles size={14} /> {t('Brain dump')}
          </button>
        </form>
      ),
    },
    pulse: {
      icon: <LayoutGrid size={15} />,
      link: [t('{Projects} × teams', { projects: term.many }), p.onOpenGrid],
      body: () => (
        <div className="pulse">
          {(
            [
              [t('Late'), d.open.filter(d.late).length, 'warn', p.onOpenGrid],
              [t('Not picked up'), d.open.filter((tk) => !tk.userId).length, '', p.onOpenGrid],
              [t('Done this week'), d.doneWeek.length, 'go', p.onOpenTasks],
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
          empty(t('No {project} has late or stuck work.', { project: term.one }))
        ) : (
          <ul className="home-list">
            {d.risk.slice(0, 5).map(({ c, late, waiting }) => (
              <li key={c.id}>
                <button className="risk-row" onClick={() => p.onOpenClient(c.id)}>
                  <ProjectBadge p={c} kind="client-dot sm" />
                  <strong>{c.name}</strong>
                  <span className="risk-why">
                    {late ? <b className="late">{tn(late, '{n} late', '{n} late')}</b> : null}
                    {late && waiting ? ' · ' : ''}
                    {waiting ? tn(waiting, '{n} not picked up', '{n} not picked up') : ''}
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
          empty(t('No team has late or unassigned work.'))
        ) : (
        <ul className="home-list">
          {d.byTeam.filter((x) => x.late || x.waiting).map(({ tm, late, waiting }) => (
            <li key={tm.id}>
              <button className="team-row" onClick={() => p.onOpenTeam(tm.id)}>
                <span className="team-square" style={{ background: tm.color }} />
                <span className="tr-name">{tm.name}</span>
                <span className="tr-num">
                  {late ? <b className="late">{tn(late, '{n} late', '{n} late')}</b> : null}
                  {late && waiting ? ' · ' : ''}
                  {waiting ? <em>{tn(waiting, '{n} not picked up', '{n} not picked up')}</em> : null}
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
                  <strong>{u.id === p.me.id ? t('You') : u.name.split(' ')[0]}</strong>
                  {bar(open, max, late > 0)}
                  <small>{late ? t('{open} open · {week} this week · {late} late', { open, week, late }) : t('{open} open · {week} this week', { open, week })}</small>
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
          empty(t('Nothing is waiting on you.'))
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
          empty(t('Every task has a person. Nice.'))
        ) : (
          <ul className="home-list">
            {d.queue.slice(0, 6).map((tk) => {
              const tm = p.teams.find((x) => x.id === tk.teamId);
              return (
                <li key={tk.id} className="queue-row">
                  <button className="ht-title" onClick={() => p.onOpenTask(tk.id)}>
                    {tk.title}
                    <small className="ht-brief">
                      {tm?.name}
                      {tk.due ? ` · ${dueLabel(tk.due).text}` : ''}
                    </small>
                  </button>
                  <Select
                    value=""
                    options={peopleOptions(p.users.filter((u) => !tm || tm.members.includes(u.id)), p.me.id, false)}
                    onChange={(v) => p.onAssign(tk.id, v)}
                    label={t('Assign')}
                    placeholder={t('Assign')}
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
      link: [t('All briefs'), p.onOpenBriefs],
      body: () => {
        const list = layout.template === 'founder' ? d.briefs : d.myBriefs;
        return list.length === 0 ? (
          empty(t('No open briefs.'))
        ) : (
          <ul className="home-list">
            {list.slice(0, 4).map((b) => {
              const subs = p.tasks.filter((tk) => tk.briefId === b.id);
              const done = subs.filter((tk) => tk.done).length;
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
      link: [t('All tasks'), p.onOpenTasks],
      show: p.enabled.has('tasks'),
      body: () => (d.mine.length === 0 ? empty(t('Nothing on your plate. 🎉')) : <ul className="home-list">{d.mine.slice(0, 7).map(taskRow)}</ul>),
    },
    today: {
      icon: <CalendarDays size={15} />,
      link: [t('Calendar'), () => p.onOpenCalendar()],
      show: p.enabled.has('calendar'),
      body: () =>
        d.todayEvents.length === 0 ? (
          empty(t('No more meetings today.'))
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
      link: [t('Inbox'), p.onOpenMail],
      show: p.enabled.has('mail'),
      body: () =>
        d.unread.length === 0 ? (
          empty(t('Inbox zero.'))
        ) : (
          <ul className="home-list">
            {d.unread.slice(0, 5).map((th) => {
              const last = th.messages[th.messages.length - 1];
              return (
                <li key={th.id}>
                  <button className="home-mail" onClick={() => p.onOpenThread(th.id)}>
                    <Avatar person={last.from} size={26} />
                    <span>
                      <strong>{last.from.name}</strong>
                      <small>{th.subject}</small>
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
          empty(t('You’re all caught up.'))
        ) : (
          <ul className="home-list">
            {fresh.map((n) => (
              <li key={n.id}>
                <button className="home-notice" onClick={() => p.onNotice(n)}>
                  <span>{textOf(n)}</span>
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
          empty(t('Every meeting action item has an owner.'))
        ) : (
          <ul className="home-list">
            {d.pendingActions.slice(0, 4).map(({ m, a }, i) => (
              <li key={i}>
                <button className="home-notice" onClick={() => p.onOpenMeeting(m.id)}>
                  <span>
                    {a.title} <em className="muted">· {a.owner ?? t('no owner')}</em>
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
            const open = d.open.filter((tk) => tk.clientId === c.id);
            const late = open.filter(d.late).length;
            return (
              <button key={c.id} className="client-tile" onClick={() => p.onOpenClient(c.id)}>
                <ProjectBadge p={c} kind="client-badge" />
                <span className="ctl-text">
                  <strong>{c.name}</strong>
                  <small>
                    {late ? (
                      <b className="late">{tn(late, '{n} late', '{n} late')}</b>
                    ) : open.length ? (
                      (() => {
                        const next = open.filter((tk) => tk.due).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))[0] ?? open[0];
                        return next.due ? t('Next: {title}, {when}', { title: next.title, when: dueWord(next.due) }) : t('Next: {title}', { title: next.title });
                      })()
                    ) : c.status === 'lead' ? (
                      t('Lead: nothing scheduled')
                    ) : (
                      t('Nothing open')
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
          empty(t('Nothing finished yet this week.'))
        ) : (
          <ul className="home-list">
            {p.kudos.slice(0, 3).map((k) => {
              const to = p.users.find((u) => u.id === k.to);
              const from = p.users.find((u) => u.id === k.from);
              return (
                <li key={k.id} className="win kudos-win">
                  <span className="kudos-emoji sm">🙌</span>
                  <span className="ht-title">
                    {to?.id === p.me.id ? t('Kudos to you') : t('Kudos to {name}', { name: to ? to.name.split(' ')[0] : t('someone') })}
                    <small className="ht-brief">
                      {k.text ? `“${k.text}” · ` : ''}
                      {from?.id === p.me.id ? t('from you') : t('from {name}', { name: from ? from.name.split(' ')[0] : t('someone') })} · {relative(k.at)}
                    </small>
                  </span>
                </li>
              );
            })}
            {d.doneWeek.slice(0, 5).map((tk) => {
              const who = p.users.find((u) => u.id === (tk.doneBy ?? tk.userId));
              return (
                <li key={tk.id} className="win">
                  {who && <Avatar person={who} size={22} />}
                  <button className="ht-title" onClick={() => p.onOpenTask(tk.id)}>
                    {tk.title}
                    <small className="ht-brief">
                      {who ? (who.id === p.me.id ? t('You') : who.name.split(' ')[0]) : t('Someone')} · {tk.doneAt ? relative(tk.doneAt) : ''}
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

  // Customise on a phone: a list to show, hide and move cards (from the title or the end of Home).
  const customise = (
    <CustomiseList
      cards={[...visible.map((c) => c.id), ...missing].map((id) => ({ id, name: CARD_INFO[id].name, hint: CARD_INFO[id].hint, on: visible.some((c) => c.id === id) }))}
      onToggle={(id) => {
        const cid = id as CardId;
        setLayout(layout.cards.some((c) => c.id === cid) ? { ...layout, cards: layout.cards.filter((c) => c.id !== cid) } : { ...layout, cards: [...layout.cards, { id: cid, size: 'm' }] });
      }}
      onMove={(id, by) => {
        const shown = visible.map((c) => c.id);
        const i = shown.indexOf(id as CardId);
        const target = shown[i + by];
        if (target) move(id as CardId, layout.cards.findIndex((c) => c.id === target));
      }}
      template={
        <Select<HomeTemplateId>
          value={layout.template}
          options={(Object.keys(TEMPLATES) as HomeTemplateId[]).map((id) => ({ value: id, label: TEMPLATES[id].name, hint: TEMPLATES[id].hint }))}
          onChange={(tpl) => setLayout(fromTemplate(tpl))}
          label={t('Start from')}
          renderValue={(o) => <span className="sel-text">{tj('Start from: {template}', { template: <b>{o?.label}</b> })}</span>}
        />
      }
      onReset={() => setSaved(null)}
    />
  );
  useAppSettings('home', { id: 'customise', label: t('Customise Home'), hint: t('Which cards show, and in what order'), render: () => <HomeCustomise storageKey={`s2g-home:${p.me.id}:${p.workspaceId}`} fallback={guessTemplate(p)} enabled={p.enabled} /> });

  // Finish setting up (admins): only what's left to do.
  const todo = (p.setup ?? []).filter((x) => !x.done);
  const setupCard = todo.length > 0 && (
    <section className="setup-card">
      <h2>{t('Finish setting up')}</h2>
      <ul>
        {todo.map((x) => (
          <li key={x.key}>
            <span className="setup-mark" />
            <button type="button" className="setup-text" onClick={x.onOpen}>
              <strong>{x.label}</strong>
              <small>{x.hint}</small>
            </button>
            <button type="button" className="ghost-btn sm" onClick={x.onOpen}>
              {t('Set up')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <section className="home-pane view-enter">
      <div className="home-scroll">
        <header className="home-head">
          <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label={t('Open menu')}>
            <Menu size={18} />
          </button>
          <div className="home-head-text">
            <p className="home-date">{fmtWeekdayLong(new Date())}</p>
            <h1>{greeting}</h1>
          </div>
          <button className={`ghost-btn sm customise-btn ${editing ? 'on' : ''}`} onClick={() => setEditing((e) => !e)}>
            {editing ? <Check size={14} /> : <Settings2 size={14} />} {editing ? t('Done') : t('Customise')}
          </button>
        </header>

        <SmoothHeight>
        {editing && (
          <div className="home-edit">
            <div className="he-row">
              <span className="he-label">{t('Start from')}</span>
              <Select<HomeTemplateId>
                value={layout.template}
                options={(Object.keys(TEMPLATES) as HomeTemplateId[]).map((id) => ({ value: id, label: TEMPLATES[id].name, hint: TEMPLATES[id].hint }))}
                onChange={(tpl) => setLayout(fromTemplate(tpl))}
                label={t('Home template')}
                width={300}
              />
              <Select<CardId>
                value={null}
                options={missing.map((id) => ({ value: id, label: CARD_INFO[id].name, hint: CARD_INFO[id].hint, icon: <Plus size={14} /> }))}
                onChange={(id) => setLayout({ ...layout, cards: [...layout.cards, { id, size: 'm' }] })}
                placeholder={missing.length ? t('Add a card') : t('All cards added')}
                disabled={!missing.length}
                label={t('Add a card')}
                width={300}
              />
              <button className="link-btn" onClick={() => setSaved(null)}>
                {t('Reset')}
              </button>
            </div>
            <p className="muted small">{t('Drag cards to reorder, or use the arrows. Make a card wide or narrow, or remove it. Only your Home changes.')}</p>
          </div>
        )}
        </SmoothHeight>

        <button className="home-search" onClick={p.onSearch}>
          <Search size={16} />
          <span>{t('Jump to a {project}, task, person or file, or ask anything', { project: term.one })}</span>
          <kbd>⌘K</kbd>
        </button>

        {p.news?.map((n) => (
          <div key={n.id} className={`news-card ${n.kind}`} role="status">
            {n.kind === 'warning' ? <AlertTriangle size={16} /> : <Megaphone size={16} />}
            <span>
              {n.text}
              {n.link && (
                <a href={n.link} target="_blank" rel="noreferrer">
                  {t('Read more')}
                </a>
              )}
            </span>
            {p.onDismissNews && (
              <button
                type="button"
                className="icon-btn sm"
                aria-label={t('Dismiss')}
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

        {p.top}

        {!phone && setupCard}

        <MeetingStrip items={strip} events={p.events} botWillJoin={p.botWillJoin} onBotJoin={p.onBotJoin} onSendNotetaker={p.onSendNotetaker} sent={p.notetakerSent} onOpen={(id) => p.onOpenCalendar(id)} />
        {p.calls && p.onJoinHuddle && <LiveCalls calls={p.calls} onJoin={p.onJoinHuddle} />}

        <div className="home-top">
          <section className={`hsec needs${needList.length ? '' : ' clear'}`} aria-label={t('Needs you')}>
            <h2 className="hsec-h">
              <span>{needList.length ? t('Needs you') : t('You’re clear for now')}</span>
            </h2>
            <SmoothHeight>
              {needList.length ? (
                <NeedsList
                  items={needList}
                  a={{
                    me: p.me.id,
                    users: p.users,
                    teams: p.teams,
                    tasks: p.tasks,
                    notices: p.notices,
                    today,
                    onDone: p.onToggleTask,
                    onStart: p.onStart,
                    onAssign: p.onAssign,
                    onNudge: p.onNudge,
                    onReschedule: p.onReschedule,
                    onOpenTask: p.onOpenTask,
                    onOpenThread: p.onOpenThread,
                    onNotice: p.onNotice,
                    onRead: p.onReadNotices,
                  }}
                />
              ) : (
                <p className="hsec-empty">
                  {laterToday[0]
                    ? t('Next: {title} at {time}.', { title: laterToday[0].title, time: fmtTime(laterToday[0].start) })
                    : (() => {
                        const next = d.mine.find((tk) => tk.due && tk.due > today);
                        return next ? t('Next on your list: “{title}”, {when}.', { title: next.title, when: dueWord(next.due!) }) : t('Nothing waiting on you. A good time to get ahead.');
                      })()}
                </p>
              )}
            </SmoothHeight>
          </section>
          {(dueToday.length > 0 || laterToday.length > 0) && (
            <TodayBlock
              tasks={dueToday}
              events={laterToday}
              clients={p.clients}
              today={today}
              onTick={p.onToggleTask}
              onReschedule={p.onReschedule}
              onOpenTask={p.onOpenTask}
              onOpenEvent={(id) => p.onOpenCalendar(id)}
              onOpenCalendar={p.enabled.has('calendar') ? () => p.onOpenCalendar() : undefined}
            />
          )}
        </div>

        {phone && <Updates notices={updates} onOpen={p.onNotice} onRead={p.onReadNotices} onAll={p.onAllNotices} />}
        {phone && setupCard}
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
                      <button className="icon-btn sm phone-only" onClick={() => move(c.id, i - 1)} disabled={i === 0} aria-label={t('Move up')}>
                        <ArrowUp size={14} />
                      </button>
                      <button className="icon-btn sm phone-only" onClick={() => move(c.id, i + 1)} disabled={i === visible.length - 1} aria-label={t('Move down')}>
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="icon-btn sm hide-phone"
                        onClick={() => setLayout({ ...layout, cards: layout.cards.map((x) => (x.id === c.id ? { ...x, size: x.size === 'l' ? 'm' : 'l' } : x)) })}
                        title={c.size === 'l' ? t('Make narrow') : t('Make wide')}
                      >
                        {c.size === 'l' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                      </button>
                      <button className="icon-btn sm" onClick={() => setLayout({ ...layout, cards: layout.cards.filter((x) => x.id !== c.id) })} title={t('Remove card')}>
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
        {phone && (
          <button type="button" className="ghost-btn home-customise" onClick={() => setCustomising(true)}>
            <Settings2 size={16} /> {t('Customise Home')}
          </button>
        )}
      </div>
      {customising && (
        <Sheet onClose={() => setCustomising(false)} title={t('Customise Home')} size="tall" head={<button type="button" className="primary-btn sm" onClick={() => setCustomising(false)}>{t('Done')}</button>}>
          {customise}
        </Sheet>
      )}
    </section>
  );
}

/** A due day read mid-sentence ("Next: Logo, tomorrow"): "today", "tomorrow", "overdue", else the date ("Thu 8 Oct"). */
const dueWord = (day: string) => {
  const today = localDay();
  if (day < today) return t('overdue');
  if (day === today) return t('today');
  if (day === addDays(today, 1)) return t('tomorrow');
  return fmtWeekday(day);
};
const NEEDS_APP: Partial<Record<CardId, string>> = { dump: 'tasks', mytasks: 'tasks', today: 'calendar', unread: 'mail', meetings: 'meet' };

/** Customise Home, opened full screen from the title on a phone. It keeps the same saved layout as Home itself. */
function HomeCustomise({ storageKey, fallback, enabled }: { storageKey: string; fallback: HomeTemplateId; enabled: Set<string> }) {
  const [saved, setSaved] = usePersisted<Layout | null>(storageKey, null);
  const layout = saved ?? fromTemplate(fallback);
  const allowed = (id: CardId) => !NEEDS_APP[id] || enabled.has(NEEDS_APP[id]!);
  const shown = layout.cards.filter((c) => allowed(c.id)).map((c) => c.id);
  const hidden = (Object.keys(CARD_INFO) as CardId[]).filter((id) => allowed(id) && !shown.includes(id));
  return (
    <div className="hcust-page">
      <CustomiseList
        cards={[...shown, ...hidden].map((id) => ({ id, name: CARD_INFO[id].name, hint: CARD_INFO[id].hint, on: shown.includes(id) }))}
        onToggle={(id) => {
          const cid = id as CardId;
          setSaved(layout.cards.some((c) => c.id === cid) ? { ...layout, cards: layout.cards.filter((c) => c.id !== cid) } : { ...layout, cards: [...layout.cards, { id: cid, size: 'm' }] });
        }}
        onMove={(id, by) => {
          const i = shown.indexOf(id as CardId);
          const target = shown[i + by];
          if (!target) return;
          const list = [...layout.cards];
          const from = list.findIndex((c) => c.id === id);
          const to = list.findIndex((c) => c.id === target);
          const [x] = list.splice(from, 1);
          list.splice(to, 0, x);
          setSaved({ ...layout, cards: list });
        }}
        template={
          <Select<HomeTemplateId>
            value={layout.template}
            options={(Object.keys(TEMPLATES) as HomeTemplateId[]).map((id) => ({ value: id, label: TEMPLATES[id].name, hint: TEMPLATES[id].hint }))}
            onChange={(tpl) => setSaved(fromTemplate(tpl))}
            label={t('Start from')}
            renderValue={(o) => <span className="sel-text">{tj('Start from: {template}', { template: <b>{o?.label}</b> })}</span>}
          />
        }
        onReset={() => setSaved(null)}
      />
    </div>
  );
}
