import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Mail, MapPin, Menu, Plus, StickyNote, Trash2, Users, X } from 'lucide-react';
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
}

export function CalendarView(props: Props) {
  const { calendars, cursor, view, selected } = props;
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
          onOpenThread={props.onOpenThread}
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
                  className={`pill-event ${selected?.id === e.id ? 'sel' : ''}`}
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
          {days.map((d) => {
            const timed = eventsOn(events, d).filter((e) => !e.allDay);
            const isToday = sameDay(d, now);
            return (
              <div key={d.toISOString()} className={`tg-col ${isToday ? 'today' : ''}`} onClick={(e) => slotClick(d, e)}>
                {layoutDay(timed).map(({ ev, col, cols }) => {
                  const s = new Date(ev.start);
                  const e = new Date(ev.end);
                  const top = (minutesIntoDay(s) / 60) * HOUR;
                  const height = Math.max(((e.getTime() - s.getTime()) / 3_600_000) * HOUR - 2, 20);
                  return (
                    <button
                      key={ev.id}
                      className={`block-event ${height < 40 ? 'short' : ''} ${e < now ? 'past' : ''} ${selected?.id === ev.id ? 'sel' : ''}`}
                      style={{
                        ['--c' as string]: color(ev.calendarId),
                        top,
                        height,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                      }}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        props.onSelect(ev.id);
                      }}
                    >
                      <span className="be-title">{ev.title}</span>
                      <span className="be-time">
                        {fmtTime(s)}
                        {height >= 40 && ` – ${fmtTime(e)}`}
                      </span>
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
                  className={`${e.allDay ? 'pill-event' : 'dot-event'} ${selected?.id === e.id ? 'sel' : ''}`}
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
}: {
  event: CalEvent;
  calendar?: CalendarDef;
  onClose: () => void;
  onDelete: () => void;
  onOpenThread: (id: string) => void;
}) {
  return (
    <aside className="ev-detail" style={{ ['--c' as string]: calendar?.color }}>
      <div className="ev-actions">
        <button className="icon-btn sm" onClick={onDelete} title="Delete event">
          <Trash2 size={15} />
        </button>
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
      {event.location && (
        <div className="ev-row">
          <MapPin size={16} />
          <span>{event.location}</span>
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
          <span>{event.notes}</span>
        </div>
      )}
      <div className="ev-row muted">
        <span className="dot" style={{ background: calendar?.color, margin: '0 4px' }} />
        <span>{calendar?.name}</span>
      </div>
      {event.threadId && (
        <button className="ghost-btn outline ev-thread" onClick={() => onOpenThread(event.threadId!)}>
          <Mail size={15} /> Open related email
        </button>
      )}
    </aside>
  );
}
