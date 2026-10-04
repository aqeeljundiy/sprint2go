import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  FileText,
  GripVertical,
  Hash,
  Inbox,
  LayoutGrid,
  ListChecks,
  Maximize2,
  Menu,
  Mic,
  Minimize2,
  PartyPopper,
  Plus,
  Settings2,
  Sparkles,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { CalEvent, Client, HomeTemplateId, Meeting, Notice, Team, Thread, Todo, User } from '../types';
import { fmtTime } from '../calendarUtils';
import { isMine } from '../identity';
import { usePersisted } from '../settings';
import { relative, localDay } from '../utils';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { dueLabel, isBrief, peopleOptions } from './TasksView';

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
  pulse: { name: 'Company pulse', hint: 'Open, late, done, briefs' },
  risk: { name: 'Clients at risk', hint: 'Late or stuck work per client' },
  lateByTeam: { name: 'Teams', hint: 'Open and late work per team' },
  workload: { name: 'Workload', hint: 'How busy each person is' },
  waiting: { name: 'Waiting on you', hint: 'Decisions and work only you can unblock' },
  teamQueue: { name: 'Team queue', hint: 'Tasks nobody has picked up yet' },
  briefs: { name: 'Briefs', hint: 'Bigger jobs and their progress' },
  mytasks: { name: 'My tasks', hint: 'Your queue, in order' },
  today: { name: 'Today', hint: 'Your next meetings' },
  unread: { name: 'Unread mail', hint: 'Mail waiting for you' },
  foryou: { name: 'For you', hint: 'Mentions and assignments' },
  meetings: { name: 'From meetings', hint: 'Action items without an owner' },
  clients: { name: 'Clients', hint: 'Every client at a glance' },
  wins: { name: 'Wins this week', hint: 'What the team finished' },
};

const TEMPLATES: Record<HomeTemplateId, { name: string; hint: string; cards: [CardId, Size][] }> = {
  founder: {
    name: 'Founder / C-level',
    hint: 'What’s happening across the whole company',
    cards: [['pulse', 'l'], ['briefing', 'm'], ['waiting', 'm'], ['risk', 'm'], ['workload', 'm']],
  },
  lead: {
    name: 'Team lead',
    hint: 'Your team’s queue and who is busy',
    cards: [['briefing', 'l'], ['teamQueue', 'm'], ['workload', 'm'], ['mytasks', 'm'], ['today', 'm']],
  },
  maker: {
    name: 'Designer / Editor',
    hint: 'Your queue and the briefs behind it',
    cards: [['mytasks', 'l'], ['briefs', 'm'], ['today', 'm'], ['foryou', 'm'], ['unread', 'm']],
  },
  account: {
    name: 'Account manager',
    hint: 'Your clients, their emails and meetings',
    cards: [['briefing', 'l'], ['clients', 'l'], ['unread', 'm'], ['mytasks', 'm'], ['meetings', 'm']],
  },
  finance: {
    name: 'Finance / Admin',
    hint: 'Payments, invoices and deadlines',
    cards: [['mytasks', 'l'], ['unread', 'm'], ['today', 'm'], ['foryou', 'm'], ['waiting', 'm']],
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
    const mine = open.filter((t) => t.userId === p.me.id).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
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
    return { open, late, mine, briefs, myBriefs, doneWeek, unread, todayEvents, pendingActions, risk, byTeam, people, queue, waiting, myTeams };
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
          <input id="home-dump" value={dump} onChange={(e) => setDump(e.target.value)} placeholder="What’s on your mind? Clients, who does what, by when…" />
          <button className="primary-btn sm" type="submit">
            <Sparkles size={14} /> Brain dump
          </button>
        </form>
      ),
    },
    pulse: {
      icon: <LayoutGrid size={15} />,
      link: ['Clients × teams', p.onOpenGrid],
      body: () => (
        <div className="pulse">
          {(
            [
              ['Open', d.open.length, ''],
              ['Late', d.open.filter(d.late).length, d.open.filter(d.late).length ? 'warn' : ''],
              ['Not picked up', d.open.filter((t) => !t.userId).length, ''],
              ['Done this week', d.doneWeek.length, 'go'],
              ['Active briefs', d.briefs.length, ''],
              ['Clients', p.clients.filter((c) => c.status === 'active').length, ''],
            ] as const
          ).map(([l, n, cls]) => (
            <div key={l} className={`pulse-num ${cls}`}>
              <b>{n}</b>
              <span>{l}</span>
            </div>
          ))}
        </div>
      ),
    },
    risk: {
      icon: <AlertTriangle size={15} />,
      body: () =>
        d.risk.length === 0 ? (
          empty('No client has late or stuck work.')
        ) : (
          <ul className="home-list">
            {d.risk.slice(0, 5).map(({ c, open, late, waiting }) => (
              <li key={c.id}>
                <button className="risk-row" onClick={() => p.onOpenClient(c.id)}>
                  <span className="client-dot sm" style={{ background: c.color }}>
                    {c.name.charAt(0)}
                  </span>
                  <strong>{c.name}</strong>
                  <span className="risk-why">
                    {late ? <b className="late">{late} late</b> : null}
                    {late && waiting ? ' · ' : ''}
                    {waiting ? `${waiting} not picked up` : ''}
                    <em> of {open}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ),
    },
    lateByTeam: {
      icon: <Users size={15} />,
      body: () => (
        <ul className="home-list">
          {d.byTeam.map(({ tm, open, late, waiting }) => (
            <li key={tm.id}>
              <button className="team-row" onClick={() => p.onOpenTeam(tm.id)}>
                <span className="team-square" style={{ background: tm.color }} />
                <span className="tr-name">{tm.name}</span>
                {bar(open, Math.max(...d.byTeam.map((x) => x.open)), late > 0)}
                <span className="tr-num">
                  {open}
                  {late ? <b className="late"> · {late} late</b> : null}
                  {waiting ? <em> · {waiting} waiting</em> : null}
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
                <span className="client-badge" style={{ background: c.color }}>
                  {c.name.charAt(0)}
                </span>
                <span className="ctl-text">
                  <strong>{c.name}</strong>
                  <small>
                    {open.length} open{late ? ' · ' : ''}
                    {late ? <b className="late">{late} late</b> : null}
                    {c.status === 'lead' ? ' · lead' : ''}
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
                  {editing && <GripVertical size={15} className="grip" />}
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
