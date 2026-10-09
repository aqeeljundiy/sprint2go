import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { useLongPress } from '../ui/useLongPress';
import { addDays, dayDate, dayHeading, weekStart } from '../../taskDates';
import type { Todo } from '../../types';
import { MonthGrid } from './MonthGrid';
import { t, tn } from '../../i18n';
import { fmtDate, fmtWeekdayLong } from '../../i18n/format';

/**
 * Upcoming (and the Calendar layout of any task view): a week strip with a dot on busy days, then one continuous list
 * of days, each with its own Add row. Swipe the strip for other weeks, tap the month for a month picker, tap a day to
 * jump to it, hold a day to add a task due that day. The strip follows the list as it scrolls.
 */
export function TaskCalendar({
  tasks,
  today,
  row,
  onAdd,
  head,
  undated,
}: {
  tasks: Todo[]; // open tasks with a due date from today on
  today: string;
  row: (t: Todo) => ReactNode;
  onAdd: (day: string) => void;
  head?: ReactNode; // above the days (Overdue, with Reschedule)
  undated?: ReactNode; // after the days (No date)
}) {
  const [week, setWeek] = useState(() => weekStart(today));
  const [dir, setDir] = useState<'next' | 'prev' | ''>('');
  const [selected, setSelected] = useState(today);
  const [end, setEnd] = useState(() => addDays(weekStart(today), 27));
  const [months, setMonths] = useState(false);
  const busy = useMemo(() => new Set(tasks.map((t) => t.due!).filter(Boolean)), [tasks]);
  const byDay = useMemo(() => {
    const m = new Map<string, Todo[]>();
    for (const t of tasks) if (t.due && t.due >= today) m.set(t.due, [...(m.get(t.due) ?? []), t]);
    return m;
  }, [tasks, today]);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = today; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [today, end]);
  const later = tasks.filter((t) => t.due && t.due > end).length;
  const listRef = useRef<HTMLDivElement>(null);
  const userJump = useRef(0);

  const go = (day: string) => {
    if (day < today) return;
    if (day > end) setEnd(addDays(weekStart(day), 13));
    setSelected(day);
    setWeek(weekStart(day));
    userJump.current = Date.now();
    requestAnimationFrame(() => document.getElementById(`ucal-${day}`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };
  const shift = (n: number) => {
    setDir(n > 0 ? 'next' : 'prev');
    const w = addDays(week, n * 7);
    if (addDays(w, 6) < today) return;
    setWeek(w);
    if (w > selected || addDays(w, 6) < selected) {
      const first = w < today ? today : w;
      go(first);
    }
  };

  // The day at the top of the list is the one picked in the strip.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (Date.now() - userJump.current < 700) return; // the list is still moving to a day someone tapped
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const day = top?.target.getAttribute('data-day');
        if (day && day !== selected) {
          setSelected(day);
          const w = weekStart(day);
          if (w !== week) (setDir(w > week ? 'next' : 'prev'), setWeek(w));
        }
      },
      { rootMargin: '-140px 0px -65% 0px' },
    );
    list.querySelectorAll('.ucal-day').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [days.length, selected, week]);

  // Swipe the strip sideways for other weeks.
  const sw = useRef<{ x: number; y: number; id: number } | null>(null);
  const strip = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const m = dayDate(addDays(week, 3));
  return (
    <div className="ucal">
      <div className="ucal-top">
        <div className="ucal-bar">
          <button type="button" className="ucal-month" onClick={() => setMonths(true)} aria-haspopup="dialog">
            {fmtDate(m, m.getFullYear() !== dayDate(today).getFullYear() ? { month: 'long', year: 'numeric' } : { month: 'long' })}
            <ChevronDown size={16} />
          </button>
          <span className="spacer" />
          <button type="button" className="icon-btn hide-phone" onClick={() => shift(-1)} disabled={week <= weekStart(today)} aria-label={t('Previous week')}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="ghost-btn sm" onClick={() => (setDir(today < week ? 'prev' : ''), go(today))} disabled={selected === today && week === weekStart(today)}>
            {t('Today')}
          </button>
          <button type="button" className="icon-btn hide-phone" onClick={() => shift(1)} aria-label={t('Next week')}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div
          className="ucal-week"
          onPointerDown={(e) => e.pointerType !== 'mouse' && (sw.current = { x: e.clientX, y: e.clientY, id: e.pointerId })}
          onPointerUp={(e) => {
            const s = sw.current;
            sw.current = null;
            if (!s || s.id !== e.pointerId) return;
            const dx = e.clientX - s.x;
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) shift(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => (sw.current = null)}
        >
          <div key={week} className={`ucal-days7 ${dir}`}>
            {strip.map((d) => (
              <DayCell key={d} day={d} today={today} selected={selected} busy={busy.has(d)} onPick={go} onHold={onAdd} />
            ))}
          </div>
        </div>
      </div>
      {head}
      <div className="ucal-list" ref={listRef}>
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          return (
            <section key={d} id={`ucal-${d}`} data-day={d} className={`ucal-day${items.length ? '' : ' empty'}`}>
              <h3 className="t-heading">{dayHeading(d, today)}</h3>
              {items.map(row)}
              <button type="button" className="ucal-add" onClick={() => onAdd(d)}>
                <Plus size={16} /> {t('Add task')}
              </button>
            </section>
          );
        })}
        <button type="button" className="ghost-btn ucal-more" onClick={() => setEnd(addDays(end, 28))}>
          {later ? tn(later, 'Show the next four weeks ({n} task later)', 'Show the next four weeks ({n} tasks later)') : t('Show the next four weeks')}
        </button>
      </div>
      {undated}
      {months && (
        <Sheet onClose={() => setMonths(false)} title={t('Go to a day')} className="task-sheet">
          <MonthGrid value={selected} today={today} busy={busy} min={today} onPick={(d) => (setMonths(false), go(d))} />
        </Sheet>
      )}
    </div>
  );
}

function DayCell({ day, today, selected, busy, onPick, onHold }: { day: string; today: string; selected: string; busy: boolean; onPick: (d: string) => void; onHold: (d: string) => void }) {
  const past = day < today;
  const press = useLongPress(() => !past && onHold(day), { disabled: past });
  const d = dayDate(day);
  return (
    <button
      type="button"
      className={`ucal-cell lp${day === today ? ' today' : ''}${day === selected ? ' on' : ''}${past ? ' past' : ''}`}
      onClick={() => onPick(day)}
      disabled={past}
      aria-label={busy ? t('{day}, has tasks. Hold to add a task', { day: fmtWeekdayLong(d) }) : t('{day}. Hold to add a task', { day: fmtWeekdayLong(d) })}
      aria-current={day === selected ? 'date' : undefined}
      {...press}
    >
      <small>{fmtDate(d, { weekday: 'short' })}</small>
      <b>{d.getDate()}</b>
      <i className={busy ? 'dot on' : 'dot'} />
    </button>
  );
}
