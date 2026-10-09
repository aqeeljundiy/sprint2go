import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, monthGrid, sameDay } from '../../calendarUtils';
import { useSwipeNav } from './useSwipeNav';

/**
 * The mini month that folds down from the calendar's title: tap a day to go there (it folds back up), swipe it or use
 * the arrows for other months. Days with something on them have a dot.
 */
export function MonthDrop({ open, cursor, busyOf, months, onPick }: { open: boolean; cursor: Date; busyOf: (month: Date) => Set<string>; months?: boolean; onPick: (d: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  // Each time it opens, it starts on the month on screen.
  useEffect(() => {
    if (open) setMonth(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const grid = useRef<HTMLDivElement>(null);
  const by = months ? 12 : 1; // Month view: a year of months to pick from
  useSwipeNav(grid, (dir) => setMonth((m) => addMonths(m, dir * by)), !open);
  const cells = monthGrid(month);
  const busy = useMemo(() => busyOf(month), [busyOf, month]);
  const today = new Date();
  const pickMonth = (i: number) => {
    const last = new Date(month.getFullYear(), i + 1, 0).getDate();
    onPick(new Date(month.getFullYear(), i, Math.min(cursor.getDate(), last)));
  };
  return (
    <div className={`fold month-drop${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="fold-in">
        <div className="md-wrap">
          <div className="md-head">
            <button type="button" className="icon-btn" onClick={() => setMonth((m) => addMonths(m, -by))} aria-label={months ? 'Previous year' : 'Previous month'}>
              <ChevronLeft size={18} />
            </button>
            <span className="md-title">{months ? month.getFullYear() : month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
            <button type="button" className="icon-btn" onClick={() => setMonth((m) => addMonths(m, by))} aria-label={months ? 'Next year' : 'Next month'}>
              <ChevronRight size={18} />
            </button>
          </div>
          {months ? (
            <div className="md-months" ref={grid}>
              {Array.from({ length: 12 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={['md-month', i === today.getMonth() && month.getFullYear() === today.getFullYear() && 'today', i === cursor.getMonth() && month.getFullYear() === cursor.getFullYear() && 'picked'].filter(Boolean).join(' ')}
                  onClick={() => pickMonth(i)}
                >
                  {new Date(2000, i, 1).toLocaleDateString([], { month: 'short' })}
                </button>
              ))}
            </div>
          ) : (
          <div className="md-grid" ref={grid}>
            {cells.slice(0, 7).map((d) => (
              <span key={`h${d.getDay()}`} className="md-dow" aria-hidden>
                {d.toLocaleDateString([], { weekday: 'narrow' })}
              </span>
            ))}
            {cells.map((d) => (
              <button
                key={d.toISOString()}
                type="button"
                className={['md-day', d.getMonth() !== month.getMonth() && 'out', sameDay(d, today) && 'today', sameDay(d, cursor) && 'picked', busy.has(d.toDateString()) && 'busy'].filter(Boolean).join(' ')}
                onClick={() => onPick(d)}
                aria-label={d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
              >
                {d.getDate()}
              </button>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
