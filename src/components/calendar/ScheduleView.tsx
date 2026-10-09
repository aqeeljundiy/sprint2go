import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronUp } from 'lucide-react';
import type { CalEvent } from '../../types';
import { addDays, eventsOn, sameDay, startOfDay, startOfWeek } from '../../calendarUtils';
import { EventCard, type CardKit } from './EventCard';
import { expandEvents } from '../../repeat';

export interface DueTask {
  id: string;
  title: string;
  due: string; // YYYY-MM-DD
  done: boolean;
}

const WEEKS = 26; // half a year at first; more as you scroll (up to two years)
const MAX_WEEKS = 104;

/**
 * Schedule: the days with something on them, one after another (the phone's default view). Each day has its weekday
 * and date on the left (today in an accent circle), its events as full-width cards and the tasks due that day with
 * their checkbox. Today always shows, with a "now" line between what's over and what's next. Month names head each
 * month. It opens on the day picked (today at first) and keeps going as you scroll.
 */
export function ScheduleView({
  events,
  cursor,
  kit,
  dueTasks = [],
  onToggleTask,
  onOpenTask,
  onEmptyDay,
}: {
  events: CalEvent[];
  cursor: Date;
  kit: CardKit;
  dueTasks?: DueTask[];
  onToggleTask?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  onEmptyDay?: (d: Date) => void; // "Nothing planned": tap to add something
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState(() => startOfWeek(cursor));
  const [weeks, setWeeks] = useState(WEEKS);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // A new date picked (the month title, Today): start from its week and scroll to it.
  const target = useRef<Date>(cursor);
  useEffect(() => {
    target.current = cursor;
    const inRange = cursor >= from && cursor < addDays(from, weeks * 7);
    if (!inRange) {
      setFrom(startOfWeek(cursor));
      setWeeks(WEEKS);
    } else jump(cursor);
  }, [cursor.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => jump(target.current, true), [from]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Scrolls so `d` (or the first day after it with something on it) is at the top. */
  function jump(d: Date, instant = false) {
    const box = scroll.current;
    if (!box) return;
    const rows = [...box.querySelectorAll<HTMLElement>('[data-day]')];
    const key = startOfDay(d).getTime();
    const row = rows.find((r) => Number(r.dataset.day) >= key);
    if (!row) return;
    // The month's name sticks to the top: the day goes just under it (or the name itself when the day starts a month).
    const opens = row.previousElementSibling?.classList.contains('sch-month');
    const sticky = opens ? 0 : (box.querySelector<HTMLElement>('.sch-month')?.offsetHeight ?? 0);
    const top = (opens ? (row.previousElementSibling as HTMLElement) : row).offsetTop - sticky;
    box.scrollTo({ top: Math.max(0, top), behavior: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // Repeating events: their dates in the weeks shown (more as it scrolls).
  const dated = useMemo(() => expandEvents(events, from.getTime(), addDays(from, weeks * 7).getTime()), [events, from, weeks]);
  const days = useMemo(() => {
    const out: { day: Date; list: CalEvent[]; tasks: DueTask[] }[] = [];
    const today = new Date(now);
    for (let i = 0; i < weeks * 7; i++) {
      const day = addDays(from, i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const list = eventsOn(dated, day).sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start.localeCompare(b.start));
      const tasks = dueTasks.filter((t) => t.due === key);
      if (list.length || tasks.length || sameDay(day, today) || sameDay(day, cursor)) out.push({ day, list, tasks });
    }
    return out;
  }, [dated, from, weeks, dueTasks, now, cursor]);

  // Near the bottom: four more weeks.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && setWeeks((w) => Math.min(w + 13, MAX_WEEKS)), { root: scroll.current, rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Quiet weeks add no rows, so the end stays in view: keep going until something shows up (or two years).
  useEffect(() => {
    const el = end.current;
    const box = scroll.current;
    if (!el || !box || weeks >= MAX_WEEKS) return;
    if (el.getBoundingClientRect().top < box.getBoundingClientRect().bottom + 400) setWeeks((w) => Math.min(w + 13, MAX_WEEKS));
  }, [weeks]);

  // Earlier weeks go on top without the list jumping under the finger.
  const earlier = () => {
    const box = scroll.current;
    const before = box ? box.scrollHeight - box.scrollTop : 0;
    setFrom((f) => addDays(f, -28));
    setWeeks((w) => w + 4);
    requestAnimationFrame(() => box && (box.scrollTop = box.scrollHeight - before));
  };

  const today = new Date(now);
  let month = -1;
  return (
    <div className="sch" ref={scroll}>
      <button type="button" className="sch-earlier" onClick={earlier}>
        <ChevronUp size={15} /> Earlier
      </button>
      {days.map(({ day, list, tasks }) => {
        const isToday = sameDay(day, today);
        const mh = day.getMonth() !== month ? day.toLocaleDateString([], { month: 'long', year: day.getFullYear() !== today.getFullYear() ? 'numeric' : undefined }) : null;
        month = day.getMonth();
        // Today: the "now" line goes before the first thing that hasn't ended.
        const nowAt = isToday ? list.findIndex((e) => !e.allDay && new Date(e.end).getTime() > now) : -2;
        return (
          <Fragment key={day.toDateString()}>
            {mh && <div className="sch-month">{mh}</div>}
            <section className={`sch-day${isToday ? ' today' : ''}`} data-day={startOfDay(day).getTime()} aria-label={day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}>
              <div className="sch-date" aria-hidden>
                <span className="sch-dow">{day.toLocaleDateString([], { weekday: 'short' })}</span>
                <span className="sch-num">{day.getDate()}</span>
              </div>
              <div className="sch-items">
                {tasks.map((t) => (
                  <div key={t.id} className={`sch-task${t.done ? ' done' : ''}`}>
                    <button type="button" className={`ev-check${t.done ? ' on' : ''}`} aria-label={t.done ? `${t.title}: done` : `Mark “${t.title}” done`} aria-pressed={t.done} onClick={() => onToggleTask?.(t.id)}>
                      {t.done && <Check size={13} strokeWidth={3} />}
                    </button>
                    <button type="button" className="sch-task-title" onClick={() => onOpenTask?.(t.id)}>
                      {t.title}
                    </button>
                  </div>
                ))}
                {list.map((e, i) => (
                  <Fragment key={e.id}>
                    {i === nowAt && <NowLine />}
                    <EventCard e={e} kit={kit} now={now} />
                  </Fragment>
                ))}
                {isToday && nowAt === -1 && list.length > 0 && <NowLine />}
                {!list.length && !tasks.length && (
                  <button type="button" className="sch-free" onClick={() => onEmptyDay?.(day)}>
                    {isToday ? 'Nothing planned today' : 'Nothing planned'}
                  </button>
                )}
              </div>
            </section>
          </Fragment>
        );
      })}
      <div ref={end} className="sch-end">
        Nothing planned after this
      </div>
    </div>
  );
}

function NowLine() {
  const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="sch-now" role="separator" aria-label={`Now, ${t}`}>
      <span />
    </div>
  );
}
