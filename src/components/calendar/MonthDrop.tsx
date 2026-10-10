import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, monthGrid, sameDay } from '../../calendarUtils';
import { useSwipeNav } from './useSwipeNav';
import { fmtDate, fmtMonth, fmtWeekdayLong } from '../../i18n/format';

/**
 * The mini month that folds down from the calendar's title: tap a day to go there (it folds back up), swipe it or use
 * the arrows for other months. Days with something on them have a dot.
 *
 * `bare` (phones, Google Calendar's): no heading and no arrows (the top bar's title says the month shown, `onMonth`
 * tells it), and a row of month chips under the grid to jump further; swiping slides the grid to the next month.
 */
export function MonthDrop({
  open,
  cursor,
  busyOf,
  months,
  bare,
  onMonth,
  onPick,
}: {
  open: boolean;
  cursor: Date;
  busyOf: (month: Date) => Set<string>;
  months?: boolean;
  bare?: boolean;
  onMonth?: (month: Date | null) => void;
  onPick: (d: Date) => void;
}) {
  const [month, setMonthRaw] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const [slide, setSlide] = useState<'' | 'next' | 'prev'>('');
  const setMonth = (m: Date) => {
    setSlide(m > month ? 'next' : m < month ? 'prev' : '');
    setMonthRaw(m);
  };
  // Each time it opens, it starts on the month on screen.
  useEffect(() => {
    if (open) {
      setSlide('');
      setMonthRaw(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onMonth?.(open ? month : null), [open, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const grid = useRef<HTMLDivElement>(null);
  const by = months ? 12 : 1; // Month view: a year of months to pick from
  useSwipeNav(grid, (dir) => setMonth(addMonths(month, dir * by)), !open);
  const cells = monthGrid(month);
  const busy = useMemo(() => busyOf(month), [busyOf, month]);
  const today = new Date();
  const pickMonth = (i: number) => {
    const last = new Date(month.getFullYear(), i + 1, 0).getDate();
    onPick(new Date(month.getFullYear(), i, Math.min(cursor.getDate(), last)));
  };

  // Phones: the month chips, a year either side of today, with the year as its own chip where it turns.
  const chips = useMemo(() => {
    const out: { key: string; label: string; month?: Date }[] = [];
    const from = new Date(today.getFullYear() - 1, today.getMonth(), 1);
    for (let i = 0; i < 37; i++) {
      const m = addMonths(from, i);
      if (m.getMonth() === 0) out.push({ key: `y${m.getFullYear()}`, label: String(m.getFullYear()) });
      out.push({ key: `${m.getFullYear()}-${m.getMonth()}`, label: fmtDate(m, { month: 'short' }), month: m });
    }
    return out;
  }, [today.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const chipRow = useRef<HTMLDivElement>(null);
  // The month shown sits in the middle of the chips.
  useLayoutEffect(() => {
    const row = chipRow.current;
    const on = row?.querySelector<HTMLElement>('.md-chip.on');
    if (!row || !on || !open) return;
    const left = on.offsetLeft - row.clientWidth / 2 + on.offsetWidth / 2;
    row.scrollTo({ left, behavior: row.dataset.placed && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    row.dataset.placed = '1';
  }, [open, month]);

  const days = (
    <div className="md-swipe" ref={grid}>
    <div className={`md-grid${slide ? ` slide-${slide}` : ''}`} key={bare ? `${month.getFullYear()}-${month.getMonth()}` : undefined}>
      {cells.slice(0, 7).map((d) => (
        <span key={`h${d.getDay()}`} className="md-dow" aria-hidden>
          {fmtDate(d, { weekday: 'narrow' })}
        </span>
      ))}
      {cells.map((d) =>
        bare && d.getMonth() !== month.getMonth() ? (
          <span key={d.toISOString()} className="md-day blank" aria-hidden />
        ) : (
          <button
            key={d.toISOString()}
            type="button"
            className={['md-day', d.getMonth() !== month.getMonth() && 'out', sameDay(d, today) && 'today', sameDay(d, cursor) && 'picked', busy.has(d.toDateString()) && 'busy'].filter(Boolean).join(' ')}
            onClick={() => onPick(d)}
            aria-label={fmtWeekdayLong(d)}
          >
            <span>{d.getDate()}</span>
          </button>
        ),
      )}
    </div>
    </div>
  );

  if (bare)
    return (
      <div className={`fold month-drop bare${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="fold-in">
          <div className="md-wrap">
            {days}
            <div className="md-chips" ref={chipRow}>
              {chips.map((c) =>
                c.month ? (
                  <button key={c.key} type="button" tabIndex={open ? 0 : -1} className={`md-chip${c.month.getTime() === month.getTime() ? ' on' : ''}`} onClick={() => setMonth(c.month!)} aria-label={fmtMonth(c.month)}>
                    {c.label}
                  </button>
                ) : (
                  <span key={c.key} className="md-chip year" aria-hidden>
                    {c.label}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className={`fold month-drop${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="fold-in">
        <div className="md-wrap">
          <div className="md-head">
            <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -by))} aria-label={months ? 'Previous year' : 'Previous month'}>
              <ChevronLeft size={18} />
            </button>
            <span className="md-title">{months ? month.getFullYear() : fmtMonth(month)}</span>
            <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, by))} aria-label={months ? 'Next year' : 'Next month'}>
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
                  {fmtDate(new Date(2000, i, 1), { month: 'short' })}
                </button>
              ))}
            </div>
          ) : (
            days
          )}
        </div>
      </div>
    </div>
  );
}
