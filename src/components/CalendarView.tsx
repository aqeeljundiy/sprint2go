import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Lock, Mail, MapPin, Menu, Mic, Plus, StickyNote, Trash2, Users, Video, X } from 'lucide-react';
import type { CalEvent, CalendarDef } from '../types';
import {
  addDays,
  addMonths,
  eventsOn,
  fmtRange,
  fmtTime,
  hourLabel,
  layoutDay,
  minutesIntoDay,
  monthGrid,
  sameDay,
  startOfDay,
  startOfWeek,
} from '../calendarUtils';
import { Avatar } from './Avatar';
import { CalendarPlus } from 'lucide-react';
import { useCreateAction } from '../mobile/chrome';
import { MEETING_NAME, meetingLinkOf, notetakerJoins } from '../meetingLinks';

export type CalView = 'day' | 'week' | 'month';

const HOUR = 52; // px per hour in the time grid

interface Props {
  events: CalEvent[];
  calendars: CalendarDef[];
  cursor: Date;
  view: CalView;
  selected: CalEvent | null;
  onCursor: (d: Date) => void;
  onView: (v: CalView) => void;
  onSelect: (id: string | null) => void;
  onCreate: (start: Date, allDay?: boolean) => void;
  onDelete: (id: string) => void;
  onOpenThread: (threadId: string) => void;
  onMenu: () => void;
  /** Move or resize an event (drag it, or drag its bottom edge). */
  onMove?: (id: string, start: Date, end: Date) => void;
  /** A task dropped on the calendar: block time for it. */
  onSchedule?: (taskId: string, start: Date) => void;
  canEdit?: (e: CalEvent) => boolean;
  /** Time blocks for tasks: the panel offers Extend, Tomorrow and Done. */
  taskOf?: (e: CalEvent) => { title: string; done: boolean } | null;
  onExtend?: (id: string, minutes: number) => void;
  onTomorrow?: (id: string) => void;
  onTaskDone?: (e: CalEvent) => void;
  /** Send the meeting notetaker to this event's Meet or Zoom call. */
  onNotetaker?: (e: CalEvent) => void;
  /** The notetaker was already sent to this event: opens its meeting. */
  sentBot?: (e: CalEvent) => (() => void) | undefined;
  /** The real notetaker joins by itself: whether it will join this event, and changing that for this one event. */
  botWillJoin?: (e: CalEvent) => boolean;
  onBotJoin?: (e: CalEvent, join: boolean) => void;
}

export function CalendarView(props: Props) {
  const { calendars, cursor, view, selected } = props;
  // Phones: New event is the create button, at the next whole hour of the day on screen.
  useCreateAction('calendar', {
    label: 'New event',
    icon: CalendarPlus,
    run: () => {
      const d = new Date(props.cursor);
      d.setHours(new Date().getHours() + 1, 0, 0, 0);
      props.onCreate(d);
    },
  });
  const color = (id: string) => calendars.find((c) => c.id === id)?.color ?? '#888';

  const step = (dir: 1 | -1) => {
    if (view === 'month') props.onCursor(addMonths(cursor, dir));
    else props.onCursor(addDays(cursor, dir * (view === 'week' ? 7 : 1)));
  };

  // Calendar shortcuts: T today, ←/→ step, D/W/M switch view, C new event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, () => void> = {
        t: () => props.onCursor(new Date()),
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        d: () => props.onView('day'),
        w: () => props.onView('week'),
        m: () => props.onView('month'),
        Escape: () => props.onSelect(null),
      };
      if (map[e.key]) {
        e.preventDefault();
        map[e.key]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(cursor)];
    const s = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [cursor, view]);

  const title =
    view === 'day'
      ? cursor.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : view === 'week' && days[0].getMonth() !== days[6].getMonth()
        ? `${days[0].toLocaleDateString([], { month: 'short' })} – ${days[6].toLocaleDateString([], { month: 'short', year: 'numeric' })}`
        : cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <section className="cal-pane">
      <header className="cal-header">
        <button className="icon-btn menu-btn" onClick={props.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <h1>{title}</h1>
        <div className="cal-nav">
          <button className="ghost-btn outline sm" onClick={() => props.onCursor(new Date())}>
            Today
          </button>
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="segmented">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => props.onView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button className="primary-btn cal-new" onClick={() => props.onCreate(nextSlot(cursor))}>
          <Plus size={15} /> <span>New event</span>
        </button>
      </header>

      {view === 'month' ? (
        <MonthGrid {...props} color={color} />
      ) : (
        <TimeGrid {...props} days={days} color={color} />
      )}

      {selected && (
        <EventDetail
          event={selected}
          calendar={calendars.find((c) => c.id === selected.calendarId)}
          onClose={() => props.onSelect(null)}
          onDelete={() => props.onDelete(selected.id)}
          readOnly={!(props.canEdit?.(selected) ?? true)}
          onNotetaker={props.onNotetaker ? () => props.onNotetaker!(selected) : undefined}
          onOpenThread={props.onOpenThread}
          task={props.taskOf?.(selected) ?? null}
          onExtend={(m) => props.onExtend?.(selected.id, m)}
          onTomorrow={() => props.onTomorrow?.(selected.id)}
          onTaskDone={() => props.onTaskDone?.(selected)}
          sentBot={props.sentBot?.(selected)}
          botWill={props.onBotJoin ? !!props.botWillJoin?.(selected) : undefined}
          onBotJoin={props.onBotJoin ? (join) => props.onBotJoin!(selected, join) : undefined}
        />
      )}
    </section>
  );
}

/** The next half hour from now if `day` is today, otherwise 9:00 on that day. */
function nextSlot(day: Date) {
  const now = new Date();
  if (sameDay(day, now)) {
    const d = new Date(now);
    d.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
    return d;
  }
  const d = startOfDay(day);
  d.setHours(9);
  return d;
}

/* ---------------- Day / week ---------------- */

function TimeGrid(props: Props & { days: Date[]; color: (id: string) => string }) {
  const { days, events, color, selected } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Open scrolled to 7:30 like most calendars.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR * 7.5;
  }, []);

  // Dragging: move an event (also to another day) or drag its bottom edge to change how long it is. Snaps to 15 minutes.
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; x: number; y: number; start: Date; end: Date; curStart: Date; curEnd: Date; moved: boolean } | null>(null);
  const colsRef = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef(drag); // the latest drag, for the pointer-up handler
  dragRef.current = drag;
  const dayAt = (clientX: number) => {
    const i = colsRef.current.findIndex((c) => {
      const r = c?.getBoundingClientRect();
      return r && clientX >= r.left && clientX < r.right;
    });
    return i;
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const mins = Math.round((((e.clientY - drag.y) / HOUR) * 60) / 15) * 15;
      if (drag.mode === 'resize') {
        const end = new Date(Math.max(drag.start.getTime() + 15 * 60_000, drag.end.getTime() + mins * 60_000));
        setDrag((d) => d && { ...d, curEnd: end, moved: d.moved || Math.abs(e.clientY - d.y) > 3 });
      } else {
        const from = days.findIndex((d) => sameDay(d, drag.start));
        const to = dayAt(e.clientX);
        const dayShift = to >= 0 && from >= 0 ? to - from : 0;
        const shift = (mins + dayShift * 24 * 60) * 60_000;
        setDrag((d) => d && { ...d, curStart: new Date(d.start.getTime() + shift), curEnd: new Date(d.end.getTime() + shift), moved: d.moved || Math.abs(e.clientY - d.y) > 3 || Math.abs(e.clientX - d.x) > 3 });
      }
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.moved) props.onMove?.(d.id, d.curStart, d.curEnd);
      else if (d) props.onSelect(d.id);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag?.id, drag?.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = drag ? events.map((e) => (e.id === drag.id ? { ...e, start: drag.curStart.toISOString(), end: drag.curEnd.toISOString() } : e)) : events;

  // A task dropped on a column becomes a time block at that spot.
  const dropTask = (day: Date, e: React.DragEvent<HTMLDivElement>) => {
    const id = e.dataTransfer.getData('text/s2g-task');
    if (!id) return;
    e.preventDefault();
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const start = startOfDay(day);
    start.setMinutes(Math.round(((y / HOUR) * 60) / 15) * 15);
    props.onSchedule?.(id, start);
  };

  const allDay = days.map((d) => eventsOn(events, d).filter((e) => e.allDay));
  const hasAllDay = allDay.some((a) => a.length);

  const slotClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const mins = Math.floor((y / HOUR) * 2) * 30; // snap to 30 min
    const start = startOfDay(day);
    start.setMinutes(mins);
    props.onCreate(start);
  };

  return (
    <div className="tg" style={{ ['--cols' as string]: days.length }}>
      <div className="tg-head">
        <div className="tg-gutter" />
        {days.map((d) => (
          <button
            key={d.toISOString()}
            className={`tg-day ${sameDay(d, now) ? 'today' : ''}`}
            onClick={() => {
              props.onCursor(d);
              props.onView('day');
            }}
          >
            <span className="tg-dow">{d.toLocaleDateString([], { weekday: 'short' })}</span>
            <span className="tg-num">{d.getDate()}</span>
          </button>
        ))}
      </div>

      {hasAllDay && (
        <div className="tg-allday">
          <div className="tg-gutter">all-day</div>
          {allDay.map((list, i) => (
            <div key={i} className="tg-allday-cell">
              {list.map((e) => (
                <button
                  key={e.id}
                  className={`pill-event ${selected?.id === e.id ? 'picked' : ''}`}
                  style={{ ['--c' as string]: color(e.calendarId) }}
                  onClick={() => props.onSelect(e.id)}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ height: HOUR * 24 }}>
          <div className="tg-gutter tg-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR }}>
                {h > 0 ? hourLabel(h) : ''}
              </span>
            ))}
          </div>
          {days.map((d, di) => {
            const timed = eventsOn(live, d).filter((e) => !e.allDay);
            const isToday = sameDay(d, now);
            return (
              <div
                key={d.toISOString()}
                ref={(el) => {
                  colsRef.current[di] = el;
                }}
                className={`tg-col ${isToday ? 'today' : ''}`}
                onClick={(e) => !drag && slotClick(d, e)}
                onDragOver={(e) => e.dataTransfer.types.includes('text/s2g-task') && e.preventDefault()}
                onDrop={(e) => dropTask(d, e)}
              >
                {layoutDay(timed).map(({ ev, col, cols }) => {
                  const s = new Date(ev.start);
                  const e = new Date(ev.end);
                  const top = (minutesIntoDay(s) / 60) * HOUR;
                  const height = Math.max(((e.getTime() - s.getTime()) / 3_600_000) * HOUR - 2, 20);
                  const editable = !!props.onMove && (props.canEdit?.(ev) ?? true);
                  const dragging = drag?.id === ev.id;
                  return (
                    <button
                      key={ev.id}
                      className={`block-event ${height < 40 ? 'short' : ''} ${e < now ? 'past' : ''} ${selected?.id === ev.id ? 'picked' : ''} ${editable ? 'editable' : ''} ${dragging ? 'dragging' : ''}`}
                      onPointerDown={(pe) => {
                        if (!editable || pe.button !== 0) return;
                        pe.stopPropagation();
                        const st = new Date(events.find((x) => x.id === ev.id)!.start);
                        const en = new Date(events.find((x) => x.id === ev.id)!.end);
                        setDrag({ id: ev.id, mode: (pe.target as HTMLElement).closest('.be-resize') ? 'resize' : 'move', x: pe.clientX, y: pe.clientY, start: st, end: en, curStart: st, curEnd: en, moved: false });
                      }}
                      style={{
                        ['--c' as string]: color(ev.calendarId),
                        top,
                        height,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                      }}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        if (!editable) props.onSelect(ev.id); // editable ones select on pointer up (unless dragged)
                      }}
                    >
                      <span className="be-title">{ev.title}</span>
                      <span className="be-time">
                        {props.botWillJoin?.(ev) && <Mic size={11} className="be-bot" aria-label="The notetaker will join" />}
                        {fmtTime(s)}
                        {(height >= 40 || dragging) && ` – ${fmtTime(e)}`}
                      </span>
                      {editable && <span className="be-resize" aria-hidden />}
                    </button>
                  );
                })}
                {isToday && (
                  <div className="now-line" style={{ top: (minutesIntoDay(now) / 60) * HOUR }}>
                    <span />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Month ---------------- */

function MonthGrid(props: Props & { color: (id: string) => string }) {
  const { cursor, events, color, selected } = props;
  const cells = monthGrid(cursor);
  const today = new Date();

  return (
    <div className="mg">
      <div className="mg-head">
        {cells.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{d.toLocaleDateString([], { weekday: 'short' })}</span>
        ))}
      </div>
      <div className="mg-body">
        {cells.map((d) => {
          const list = eventsOn(events, d).sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start.localeCompare(b.start));
          const extra = list.length - 3;
          return (
            <div
              key={d.toISOString()}
              className={`mg-cell ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''}`}
              onClick={() => {
                const s = startOfDay(d);
                s.setHours(9);
                props.onCreate(s);
              }}
            >
              <button
                className="mg-num"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onCursor(d);
                  props.onView('day');
                }}
              >
                {d.getDate()}
              </button>
              {list.slice(0, 3).map((e) => (
                <button
                  key={e.id}
                  className={`${e.allDay ? 'pill-event' : 'dot-event'} ${selected?.id === e.id ? 'picked' : ''}`}
                  style={{ ['--c' as string]: color(e.calendarId) }}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    props.onSelect(e.id);
                  }}
                >
                  {!e.allDay && <i />}
                  {!e.allDay && <span className="de-time">{fmtTime(e.start)}</span>}
                  <span className="de-title">{e.title}</span>
                </button>
              ))}
              {extra > 0 && (
                <button
                  className="mg-more"
                  onClick={(evt) => {
                    evt.stopPropagation();
                    props.onCursor(d);
                    props.onView('day');
                  }}
                >
                  +{extra} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Event detail ---------------- */

function EventDetail({
  event,
  calendar,
  onClose,
  onDelete,
  onOpenThread,
  task,
  onExtend,
  onTomorrow,
  onTaskDone,
  readOnly,
  onNotetaker,
  sentBot,
  botWill,
  onBotJoin,
}: {
  event: CalEvent;
  calendar?: CalendarDef;
  onClose: () => void;
  onDelete: () => void;
  readOnly?: boolean;
  onNotetaker?: () => void;
  onOpenThread: (id: string) => void;
  task?: { title: string; done: boolean } | null;
  onExtend?: (minutes: number) => void;
  onTomorrow?: () => void;
  onTaskDone?: () => void;
  sentBot?: () => void;
  botWill?: boolean; // set when the notetaker joins by itself (the real one): whether it will join this event
  onBotJoin?: (join: boolean) => void;
}) {
  const link = meetingLinkOf(event);
  const ended = new Date(event.end).getTime() < Date.now();
  const startsSoon = new Date(event.start).getTime() - Date.now() < 15 * 60_000;
  return (
    <aside className="ev-detail" style={{ ['--c' as string]: calendar?.color }}>
      <div className="ev-actions">
        {!readOnly && (
          <button className="icon-btn sm" onClick={onDelete} title="Delete event">
            <Trash2 size={15} />
          </button>
        )}
        <button className="icon-btn sm" onClick={onClose} title="Close (Esc)">
          <X size={15} />
        </button>
      </div>
      <div className="ev-title">
        <span className="ev-swatch" />
        <h3>{event.title}</h3>
      </div>
      <div className="ev-row">
        <Clock size={16} />
        <span>{fmtRange(event)}</span>
      </div>
      {link && !ended && (
        <div className="ev-join">
          <a className="primary-btn sm" href={link.url} target="_blank" rel="noopener noreferrer">
            <Video size={14} /> Join {MEETING_NAME[link.kind]}
          </a>
          {sentBot ? (
            <button type="button" className="link-btn small" onClick={sentBot}>
              The notetaker is on its way. Open the meeting
            </button>
          ) : !notetakerJoins(link.kind) ? null : botWill ? (
            <span className="ev-bot-note">
              <Mic size={14} aria-hidden /> The notetaker will join
              <button type="button" className="link-btn small" onClick={() => onBotJoin?.(false)}>
                Don’t record
              </button>
            </span>
          ) : onBotJoin && !startsSoon ? (
            <button className="ghost-btn sm" onClick={() => onBotJoin(true)}>
              <Mic size={14} /> Record this meeting
            </button>
          ) : (
            onNotetaker && (
              <button className="ghost-btn sm" onClick={onNotetaker}>
                <Mic size={14} /> Send notetaker
              </button>
            )
          )}
        </div>
      )}
      {event.location && event.location !== link?.url && (
        <div className="ev-row">
          <MapPin size={16} />
          <span>{event.location}</span>
        </div>
      )}
      {(event.organizer || event.rsvp) && (
        <div className="ev-row muted">
          <Mail size={16} />
          <span>
            {event.organizer ? `Invited by ${event.organizer.name}` : 'From an invite'}
            {event.rsvp === 'tentative' ? '. You said maybe' : event.rsvp === 'accepted' ? '. You’re going' : ''}
          </span>
        </div>
      )}
      {event.guests?.length ? (
        <div className="ev-row top">
          <Users size={16} />
          <div className="ev-guests">
            <span>{event.guests.length + 1} people</span>
            {event.guests.map((g) => (
              <div key={g.email} className="ev-guest">
                <Avatar person={g} size={24} />
                <span>{g.name}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {event.notes && (
        <div className="ev-row top">
          <StickyNote size={16} />
          <span className="ev-notes">{event.notes}</span>
        </div>
      )}
      <div className="ev-row muted">
        <span className="dot" style={{ background: calendar?.color, margin: '0 4px' }} />
        <span>{calendar?.name}</span>
      </div>
      {event.feed && (
        <div className="ev-row muted small">
          <Lock size={14} />
          <span>{event.feed === 'holidays' ? (event.workspaceId ? 'Public holiday, shown to everyone in the company.' : 'Public holiday in a country you chose to see. Just on your calendar.') : 'Read only. Change it in the calendar it comes from; this copy updates every 30 minutes.'}</span>
        </div>
      )}
      {task && (
        <div className="ev-task">
          <span className="muted small">{task.done ? 'Task done' : 'Time blocked for a task'}</span>
          {!task.done && (
            <div className="ev-task-btns">
              <button className="ghost-btn sm" onClick={() => onExtend?.(30)}>
                Extend 30 min
              </button>
              <button className="ghost-btn sm" onClick={onTomorrow}>
                Move to tomorrow
              </button>
              <button className="primary-btn sm" onClick={onTaskDone}>
                Mark task done
              </button>
            </div>
          )}
        </div>
      )}
      {event.threadId && (
        <button className="ghost-btn outline ev-thread" onClick={() => onOpenThread(event.threadId!)}>
          <Mail size={15} /> Open related email
        </button>
      )}
    </aside>
  );
}
