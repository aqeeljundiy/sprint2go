import { useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, AtSign, Bell, Check, CheckCheck, CircleCheck, Clock, FileText, Headphones, Inbox, ListChecks, Mail, MessageCircle, Play, Repeat, Sunrise, Users, Video, type LucideIcon } from 'lucide-react';
import { SwipeRow, type SwipeAction } from '../ui/SwipeRow';
import { useLeaving, SmoothHeight } from '../ui/Smooth';
import { Select } from '../ui/Select';
import { Avatar } from '../Avatar';
import { peopleOptions } from '../TasksView';
import { meetingLinkOf } from '../../meetingLinks';
import { fmtTime } from '../../i18n/format';
import { mark, t, textOf, tn, tx } from '../../i18n';
import { relative } from '../../utils';
import { addDays } from '../../taskDates';
import type { Need, NeedKind } from '../../needsYou';
import type { CalEvent, Client, Notice, Team, Todo, User } from '../../types';

const ICON: Record<NeedKind, LucideIcon> = {
  meeting: Video,
  review: Check,
  changes: AlertTriangle,
  request: Inbox,
  mention: AtSign,
  guest: MessageCircle,
  assigned: ListChecks,
  late: AlertTriangle,
  queue: Users,
  delegated: Clock,
  mail: Mail,
  brief: FileText,
  today: ListChecks,
};

export interface NeedActions {
  me: string;
  users: User[];
  teams: Team[];
  tasks: Todo[];
  notices: Notice[];
  onDone: (taskId: string) => void; // tick it (Approve for a review, Close for a brief)
  onStart: (taskId: string) => void;
  onAssign: (taskId: string, userId: string) => void;
  onNudge: (taskId: string) => void;
  onReschedule: (taskId: string, day: string) => void;
  onOpenTask: (id: string) => void;
  onOpenThread: (id: string) => void;
  onNotice: (n: Notice) => void; // opens what a notification is about (and marks it read)
  onRead: (noticeIds: string[]) => void; // marks notifications read
  today: string;
}

/**
 * Needs you: what to act on now, across apps, most urgent first, each with its one action right on the row. On phones
 * the rows swipe too: right does the action, left moves a task to tomorrow or puts a notification away.
 */
export function NeedsList({ items, a }: { items: Need[]; a: NeedActions }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 6);
  const rows = useLeaving(shown, (x) => x.key);
  const task = (x: Need) => (x.taskId ? a.tasks.find((t) => t.id === x.taskId) : undefined);
  const read = (x: Need) => x.noticeIds.length && a.onRead(x.noticeIds);
  const notice = (x: Need) => a.notices.find((n) => n.id === x.noticeIds[0]);
  const open = (x: Need) => {
    if (x.taskId) return (read(x), a.onOpenTask(x.taskId));
    if (x.threadId) return (read(x), a.onOpenThread(x.threadId));
    const n = notice(x);
    if (n) a.onNotice(n);
  };
  const mine = (x: Need) => {
    const tk = task(x);
    return !!tk && (tk.assignees?.length ? tk.assignees : tk.userId ? [tk.userId] : []).includes(a.me);
  };
  // The row's one action: [label, what it does, does the row leave]. The label stays English here (the swipes below
  // compare it) and is translated where it's shown.
  const primary = (x: Need): { label: string; icon: LucideIcon; run: () => void } | null => {
    switch (x.kind) {
      case 'review':
        return { label: mark('Approve'), icon: Check, run: () => (read(x), a.onDone(x.taskId!)) };
      case 'request':
        return { label: mark('Start'), icon: Play, run: () => (read(x), a.onStart(x.taskId!)) };
      case 'late':
      case 'today':
        return { label: mark('Done'), icon: Check, run: () => (read(x), a.onDone(x.taskId!)) };
      case 'assigned':
        return mine(x) ? { label: mark('Done'), icon: Check, run: () => (read(x), a.onDone(x.taskId!)) } : { label: mark('Open'), icon: ListChecks, run: () => open(x) };
      case 'brief':
        return { label: mark('Close brief'), icon: CircleCheck, run: () => a.onDone(x.taskId!) };
      case 'delegated':
        return { label: mark('Remind'), icon: Bell, run: () => a.onNudge(x.taskId!) };
      case 'mention':
      case 'guest':
      case 'mail':
        return { label: mark('Reply'), icon: MessageCircle, run: () => open(x) };
      case 'changes':
        return { label: mark('Open'), icon: ListChecks, run: () => open(x) };
      default:
        return null;
    }
  };
  const swipes = (x: Need): { start: SwipeAction[]; end: SwipeAction[] } => {
    const p = primary(x);
    const start: SwipeAction[] = p && ['Approve', 'Done', 'Close brief', 'Remind', 'Start'].includes(p.label) ? [{ id: 'act', label: t(p.label), icon: p.icon, tone: 'ok', removes: p.label !== 'Remind', run: p.run }] : [];
    const end: SwipeAction[] = [];
    if ((x.kind === 'late' || x.kind === 'today' || (x.kind === 'assigned' && mine(x))) && x.taskId)
      end.push({ id: 'tomorrow', label: t('Tomorrow'), icon: Sunrise, tone: 'warn', removes: true, done: t('Moved to tomorrow'), run: () => {
        const before = task(x)?.due;
        read(x);
        a.onReschedule(x.taskId!, addDays(a.today, 1));
        return () => a.onReschedule(x.taskId!, before ?? '');
      } });
    else if (x.noticeIds.length) end.push({ id: 'seen', label: t('Seen'), icon: CheckCheck, tone: 'neutral', removes: true, done: t('Marked as seen'), run: () => void a.onRead(x.noticeIds) });
    return { start, end };
  };
  const action = (x: Need): ReactNode => {
    if (x.kind === 'queue' && x.taskId) {
      const tm = a.teams.find((team) => team.id === task(x)?.teamId);
      return <Select value="" options={peopleOptions(a.users.filter((u) => !tm || tm.members.includes(u.id)), a.me, false)} onChange={(v) => a.onAssign(x.taskId!, v)} label={t('Assign')} placeholder={t('Assign')} className="sel-flat ny-assign" />;
    }
    const p = primary(x);
    return (
      p && (
        <button type="button" className={`ny-btn${x.kind === 'review' ? ' primary' : ''}`} onClick={p.run}>
          {t(p.label)}
        </button>
      )
    );
  };
  return (
    <div className="ny-list">
      {rows.map(({ item: x, leaving }) => {
        const Icon = ICON[x.kind];
        const sw = swipes(x);
        return (
          <SwipeRow key={x.key} start={sw.start} end={sw.end} leaving={leaving} className="ny-swipe">
            <div className={`ny-row k-${x.kind}${x.tone ? ` ${x.tone}` : ''}`}>
              <span className="ny-icon">
                <Icon size={16} />
              </span>
              <button type="button" className="ny-text" onClick={() => open(x)}>
                <strong>{x.text}</strong>
                <small>
                  {x.sub}
                  {x.at && x.kind !== 'late' ? ` · ${relative(x.at)}` : ''}
                </small>
              </button>
              <span className="ny-act">{action(x)}</span>
            </div>
          </SwipeRow>
        );
      })}
      {items.length > 6 && (
        <button type="button" className="link-btn small ny-more" onClick={() => setAll((v) => !v)}>
          {all ? t('Show fewer') : tn(items.length - 6, 'Show {n} more', 'Show {n} more')}
        </button>
      )}
    </div>
  );
}

/** A meeting that starts within 30 minutes: Join, and the notetaker on or off. Gone 5 minutes after it starts. */
export function MeetingStrip({
  items,
  events,
  botWillJoin,
  onBotJoin,
  onSendNotetaker,
  sent,
  onOpen,
}: {
  items: Need[];
  events: CalEvent[];
  botWillJoin?: (e: CalEvent) => boolean;
  onBotJoin?: (e: CalEvent, join: boolean) => void;
  onSendNotetaker?: (e: CalEvent) => void;
  sent?: Record<string, string>;
  onOpen: (eventId: string) => void;
}) {
  return (
    <>
      {items.map((x) => {
        const e = events.find((ev) => ev.id === x.eventId);
        if (!e) return null;
        const link = meetingLinkOf(e);
        const joins = botWillJoin?.(e);
        return (
          <section key={x.key} className="upn" aria-label={t('Up next')}>
            <span className="upn-icon">
              <Video size={18} />
            </span>
            <button type="button" className="upn-text" onClick={() => onOpen(e.id)}>
              <strong>
                {e.title}
                {e.rrule && <Repeat size={13} className="h-repeat" aria-label={t('Repeats')} />}
              </strong>
              <small>{x.sub}</small>
            </button>
            {onBotJoin && link ? (
              <button type="button" role="switch" aria-checked={!!joins} className="upn-bot" onClick={() => onBotJoin(e, !joins)} title={joins ? t('The notetaker will join') : t('The notetaker won’t join')}>
                <span className={`switch ${joins ? 'on' : ''}`} aria-hidden="true">
                  <span />
                </span>
                {t('Notetaker')}
              </button>
            ) : onSendNotetaker && link && !sent?.[e.id] ? (
              <button type="button" className="ghost-btn sm upn-send" onClick={() => onSendNotetaker(e)}>
                {t('Send notetaker')}
              </button>
            ) : sent?.[e.id] ? (
              <small className="upn-sent">{t('Notetaker on the way')}</small>
            ) : null}
            {link ? (
              <a className="primary-btn sm upn-join" href={link.url} target="_blank" rel="noopener noreferrer">
                {t('Join')}
              </a>
            ) : (
              <button type="button" className="ghost-btn sm" onClick={() => onOpen(e.id)}>
                {t('Open')}
              </button>
            )}
          </section>
        );
      })}
    </>
  );
}

/** A huddle going on in one of your channels, with who's in it. */
export function LiveCalls({ calls, onJoin }: { calls: { id: string; name: string; people: User[] }[]; onJoin: (channelId: string) => void }) {
  if (!calls.length) return null;
  return (
    <>
      {calls.map((c) => (
        <section key={c.id} className="hcall" aria-label={t('Huddle in #{channel}', { channel: c.name })}>
          <span className="hcall-icon">
            <Headphones size={17} />
            <i className="hcall-live" aria-hidden="true" />
          </span>
          <span className="hcall-text">
            <strong>{t('Huddle in #{channel}', { channel: c.name })}</strong>
            <small>{c.people.length ? c.people.map((u) => u.name.split(' ')[0]).join(', ') : tx('huddle', 'Starting')}</small>
          </span>
          <span className="hcall-faces" aria-hidden="true">
            {c.people.slice(0, 3).map((u) => (
              <Avatar key={u.id} person={u} size={24} />
            ))}
          </span>
          <button type="button" className="primary-btn sm" onClick={() => onJoin(c.id)}>
            {t('Join')}
          </button>
        </section>
      ))}
    </>
  );
}

const NOTE_ICON: Record<Notice['kind'], LucideIcon> = { task: ListChecks, mention: AtSign, meeting: Video, mail: Mail, done: CircleCheck, team: Users };

/** On phones the bell lives here: news to read (not to act on), with the full list one tap away. */
export function Updates({ notices, onOpen, onRead, onAll }: { notices: Notice[]; onOpen: (n: Notice) => void; onRead: (ids: string[]) => void; onAll: () => void }) {
  const shown = notices.slice(0, 5);
  const rows = useLeaving(shown, (n) => n.id);
  return (
    <section className="hsec hupd" aria-label={t('Updates')}>
      <h2 className="hsec-h">
        <span>{t('Updates')}</span>
        {notices.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => onRead(notices.map((n) => n.id))}>
            {t('Mark all read')}
          </button>
        )}
      </h2>
      <SmoothHeight>
        {notices.length === 0 ? (
          <p className="hsec-empty">{t('Nothing new.')}</p>
        ) : (
          <div className="hupd-list">
            {rows.map(({ item: n, leaving }) => {
              const Icon = NOTE_ICON[n.kind] ?? Bell;
              return (
                <SwipeRow key={n.id} leaving={leaving} end={[{ id: 'seen', label: t('Seen'), icon: CheckCheck, tone: 'neutral', removes: true, run: () => onRead([n.id]) }]} className="ny-swipe">
                  <button type="button" className="hupd-row" onClick={() => onOpen(n)}>
                    <span className={`nt-icon k-${n.kind}`}>
                      <Icon size={14} />
                    </span>
                    <span className="hupd-text">
                      {textOf(n)}
                      <time>{relative(n.at)}</time>
                    </span>
                  </button>
                </SwipeRow>
              );
            })}
          </div>
        )}
      </SmoothHeight>
      <button type="button" className="hsec-all" onClick={onAll}>
        <Bell size={16} /> {t('All notifications')}
      </button>
    </section>
  );
}

/** Today: your tasks due today (tick them here) and what's left of today's calendar. */
export function TodayBlock({
  tasks,
  events,
  clients,
  today,
  onTick,
  onReschedule,
  onOpenTask,
  onOpenEvent,
  onOpenCalendar,
}: {
  tasks: Todo[];
  events: CalEvent[];
  clients: Client[];
  today: string;
  onTick: (id: string) => void;
  onReschedule: (id: string, day: string) => void;
  onOpenTask: (id: string) => void;
  onOpenEvent: (id: string) => void;
  onOpenCalendar?: () => void;
}) {
  const rows = useLeaving(tasks, (tk) => tk.id);
  const [ticking, setTicking] = useState<string[]>([]);
  const tick = (id: string) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return onTick(id);
    setTicking((x) => [...x, id]);
    setTimeout(() => (onTick(id), setTicking((x) => x.filter((y) => y !== id))), 300);
  };
  if (!tasks.length && !events.length) return null;
  return (
    <section className="hsec htoday" aria-label={t('Today')}>
      <h2 className="hsec-h">
        <span>{t('Today')}</span>
        {onOpenCalendar && events.length > 0 && (
          <button type="button" className="link-btn small" onClick={onOpenCalendar}>
            {t('Calendar')}
          </button>
        )}
      </h2>
      {events.length > 0 && (
        <div className="htd-events">
          {events.map((e) => {
            const link = meetingLinkOf(e);
            return (
              <div key={e.id} className="htd-ev">
                <time>{fmtTime(e.start)}</time>
                <button type="button" className="htd-ev-title" onClick={() => onOpenEvent(e.id)}>
                  {e.title}
                  {e.rrule && <Repeat size={12} className="h-repeat" aria-label={t('Repeats')} />}
                </button>
                {link && (
                  <a className="ghost-btn sm" href={link.url} target="_blank" rel="noopener noreferrer">
                    {t('Join')}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        <div className="htd-tasks">
          {rows.map(({ item: tk, leaving }) => {
            const c = clients.find((x) => x.id === tk.clientId);
            return (
              <SwipeRow
                key={tk.id}
                leaving={leaving}
                className="ny-swipe"
                start={[{ id: 'done', label: t('Done'), icon: Check, tone: 'ok', removes: true, run: () => onTick(tk.id) }]}
                end={[{ id: 'tomorrow', label: t('Tomorrow'), icon: Sunrise, tone: 'warn', removes: true, done: t('Moved to tomorrow'), run: () => (onReschedule(tk.id, addDays(today, 1)), () => onReschedule(tk.id, today)) }]}
              >
                <div className={`htd-task${ticking.includes(tk.id) ? ' ticking' : ''}`}>
                  <button type="button" className={`trow-check${tk.priority === 'high' ? ' p-high' : ''}${ticking.includes(tk.id) ? ' on' : ''}`} onClick={() => tick(tk.id)} aria-label={t('Mark “{title}” done', { title: tk.title })}>
                    <span className="ring">{ticking.includes(tk.id) && <Check size={13} strokeWidth={3} />}</span>
                  </button>
                  <button type="button" className="htd-title" onClick={() => onOpenTask(tk.id)}>
                    {tk.title}
                    {c && (
                      <small>
                        <i style={{ background: c.color }} />
                        {c.name}
                      </small>
                    )}
                  </button>
                </div>
              </SwipeRow>
            );
          })}
        </div>
      )}
    </section>
  );
}

export interface CardRow {
  id: string;
  name: string;
  hint: string;
  on: boolean;
}

/** Customise Home on a phone: show or hide each card, and move it up or down. No dragging. */
export function CustomiseList({ cards, onToggle, onMove, template, onReset }: { cards: CardRow[]; onToggle: (id: string) => void; onMove: (id: string, by: -1 | 1) => void; template: ReactNode; onReset: () => void }) {
  const shown = cards.filter((c) => c.on);
  return (
    <div className="hcust">
      <div className="hcust-tpl">{template}</div>
      <div className="as-group">{t('On your Home')}</div>
      <div className="hcust-list">
        {cards.map((c) => {
          const i = shown.findIndex((x) => x.id === c.id);
          return (
            <div key={c.id} className={`hcust-row${c.on ? '' : ' off'}`}>
              <button type="button" role="switch" aria-checked={c.on} className="hcust-toggle" onClick={() => onToggle(c.id)}>
                <span className={`switch ${c.on ? 'on' : ''}`} aria-hidden="true">
                  <span />
                </span>
                <span className="hcust-name">
                  {c.name}
                  <small>{c.hint}</small>
                </span>
              </button>
              {c.on && (
                <span className="hcust-moves">
                  <button type="button" className="icon-btn" onClick={() => onMove(c.id, -1)} disabled={i <= 0} aria-label={t('Move {name} up', { name: c.name })}>
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => onMove(c.id, 1)} disabled={i === shown.length - 1} aria-label={t('Move {name} down', { name: c.name })}>
                    <ArrowDown size={16} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="link-btn small hcust-reset" onClick={onReset}>
        {t('Back to the usual for my role')}
      </button>
    </div>
  );
}

