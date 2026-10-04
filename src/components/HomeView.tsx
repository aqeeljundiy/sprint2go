import { useState } from 'react';
import { ArrowRight, CalendarDays, Hash, Inbox, ListChecks, Menu, Mic, Sparkles, Video } from 'lucide-react';
import type { CalEvent, Client, Meeting, Notice, Thread, Todo, User } from '../types';
import { fmtTime } from '../calendarUtils';
import { isMine } from '../identity';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { dueLabel } from './TasksView';

interface Props {
  me: User;
  firstName: string;
  tasks: Todo[]; // workspace tasks
  clients: Client[];
  threads: Thread[]; // my inbox in this workspace
  events: CalEvent[]; // my calendar
  meetings: Meeting[];
  notices: Notice[];
  enabled: Set<string>;
  onDump: (text?: string) => void;
  onToggleTask: (id: string) => void;
  onOpenTasks: () => void;
  onOpenThread: (id: string) => void;
  onOpenMail: () => void;
  onOpenCalendar: (eventId?: string) => void;
  onOpenClient: (id: string) => void;
  onOpenMeeting: (id: string) => void;
  onNotice: (n: Notice) => void;
  onMenu: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function HomeView(p: Props) {
  const [dump, setDump] = useState('');
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Good morning' : hour < 15 ? 'Good afternoon' : hour < 19 ? 'Good evening' : 'Working late';

  const mine = p.tasks.filter((t) => t.userId === p.me.id && !t.done).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const overdue = mine.filter((t) => t.due && t.due < today());
  const dueToday = mine.filter((t) => t.due === today());
  const upcoming = mine.filter((t) => !t.due || t.due > today()).slice(0, 5);
  const unread = p.threads.filter((t) => t.location === 'inbox' && t.unread && !isMine(t.messages[t.messages.length - 1].from.email));
  const end = new Date();
  end.setHours(23, 59, 59);
  const todayEvents = p.events
    .filter((e) => !e.allDay && new Date(e.end) > new Date() && new Date(e.start) < end)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5);
  const waitingOnOthers = p.tasks.filter((t) => t.createdBy === p.me.id && t.userId !== p.me.id && !t.done);
  const lateOthers = waitingOnOthers.filter((t) => t.due && t.due < today());
  const fresh = p.notices.filter((n) => !n.read).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
  const pendingActions = p.meetings.flatMap((m) => m.actions.filter((a) => !a.taskId).map((a) => ({ m, a })));

  // A short, plain-language briefing built from the numbers (no AI call needed).
  const brief: string[] = [];
  if (overdue.length) brief.push(`${overdue.length} of your task${overdue.length > 1 ? 's are' : ' is'} overdue, starting with “${overdue[0].title}”.`);
  if (dueToday.length) brief.push(`${dueToday.length} due today.`);
  if (lateOthers.length) brief.push(`${lateOthers.length} task${lateOthers.length > 1 ? 's' : ''} you assigned ${lateOthers.length > 1 ? 'are' : 'is'} late (${p.clients.find((c) => c.id === lateOthers[0].clientId)?.name ?? 'internal'}).`);
  if (unread.length) brief.push(`${unread.length} unread email${unread.length > 1 ? 's' : ''}.`);
  if (todayEvents.length) brief.push(`Next up: ${todayEvents[0].title} at ${fmtTime(todayEvents[0].start)}.`);
  if (pendingActions.length) brief.push(`${pendingActions.length} meeting action item${pendingActions.length > 1 ? 's' : ''} still need an owner.`);
  if (!brief.length) brief.push('Nothing urgent. A good day to get ahead.');

  const clientStats = p.clients
    .map((c) => {
      const open = p.tasks.filter((t) => t.clientId === c.id && !t.done);
      return { c, open: open.length, late: open.filter((t) => t.due && t.due < today()).length };
    })
    .sort((a, b) => b.late - a.late || b.open - a.open);

  const taskRow = (t: Todo) => {
    const d = t.due ? dueLabel(t.due) : null;
    const c = p.clients.find((x) => x.id === t.clientId);
    return (
      <li key={t.id} className="home-task">
        <button className="todo-check" onClick={() => p.onToggleTask(t.id)} aria-label="Mark done" />
        <span className="ht-title">{t.title}</span>
        {c && (
          <span className="client-chip" style={{ ['--c' as string]: c.color }}>
            {c.name}
          </span>
        )}
        {d && <span className={`due ${d.cls}`}>{d.text}</span>}
      </li>
    );
  };

  return (
    <section className="home-pane view-enter">
      <div className="home-scroll">
        <header className="home-head">
          <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div>
            <p className="home-date">{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>
              {greeting}, {p.firstName}.
            </h1>
          </div>
        </header>

        <div className="home-brief">
          <span className="ai-orb">
            <Sparkles size={15} />
          </span>
          <p>{brief.join(' ')}</p>
        </div>

        {p.enabled.has('tasks') && (
          <form
            className="home-dump"
            onSubmit={(e) => {
              e.preventDefault();
              p.onDump(dump);
              setDump('');
            }}
          >
            <Mic size={18} />
            <input id="home-dump" value={dump} onChange={(e) => setDump(e.target.value)} placeholder="What’s on your mind? Clients, who does what, by when…" />
            <button className="primary-btn sm" type="submit">
              <Sparkles size={14} /> Brain dump
            </button>
          </form>
        )}

        <div className="home-grid">
          {p.enabled.has('tasks') && (
            <div className="side-card home-card wide">
              <h3>
                <ListChecks size={15} /> Your tasks
                <button className="link-btn" onClick={p.onOpenTasks}>
                  All tasks <ArrowRight size={13} />
                </button>
              </h3>
              {mine.length === 0 ? (
                <p className="te-empty">Nothing on your plate. 🎉</p>
              ) : (
                <ul className="home-list">
                  {overdue.map(taskRow)}
                  {dueToday.map(taskRow)}
                  {upcoming.map(taskRow)}
                </ul>
              )}
              {waitingOnOthers.length > 0 && (
                <p className="home-foot">
                  Waiting on others: {waitingOnOthers.length}
                  {lateOthers.length ? `, ${lateOthers.length} late` : ''}
                </p>
              )}
            </div>
          )}

          {p.enabled.has('calendar') && (
            <div className="side-card home-card">
              <h3>
                <CalendarDays size={15} /> Today
                <button className="link-btn" onClick={() => p.onOpenCalendar()}>
                  Calendar <ArrowRight size={13} />
                </button>
              </h3>
              {todayEvents.length === 0 ? (
                <p className="te-empty">No more meetings today.</p>
              ) : (
                <ul className="home-list">
                  {todayEvents.map((e) => (
                    <li key={e.id}>
                      <button className="home-event" onClick={() => p.onOpenCalendar(e.id)}>
                        <time>{fmtTime(e.start)}</time>
                        <span>{e.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {p.enabled.has('mail') && (
            <div className="side-card home-card">
              <h3>
                <Inbox size={15} /> Unread mail
                <button className="link-btn" onClick={p.onOpenMail}>
                  Inbox <ArrowRight size={13} />
                </button>
              </h3>
              {unread.length === 0 ? (
                <p className="te-empty">Inbox zero.</p>
              ) : (
                <ul className="home-list">
                  {unread.slice(0, 5).map((t) => {
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
              )}
            </div>
          )}

          {fresh.length > 0 && (
            <div className="side-card home-card">
              <h3>
                <Hash size={15} /> For you
              </h3>
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
            </div>
          )}

          {p.enabled.has('meet') && pendingActions.length > 0 && (
            <div className="side-card home-card">
              <h3>
                <Video size={15} /> From your meetings
              </h3>
              <ul className="home-list">
                {pendingActions.slice(0, 4).map(({ m, a }, i) => (
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
            </div>
          )}

          {p.enabled.has('tasks') && clientStats.length > 0 && (
            <div className="side-card home-card wide">
              <h3>Clients</h3>
              <div className="client-tiles">
                {clientStats.map(({ c, open, late }) => (
                  <button key={c.id} className="client-tile" onClick={() => p.onOpenClient(c.id)}>
                    <span className="client-badge" style={{ background: c.color }}>
                      {c.name.charAt(0)}
                    </span>
                    <span className="ctl-text">
                      <strong>{c.name}</strong>
                      <small>
                        {open} open{late ? ` · ` : ''}
                        {late ? <b className="late">{late} late</b> : null}
                        {c.status === 'lead' ? ' · lead' : ''}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
