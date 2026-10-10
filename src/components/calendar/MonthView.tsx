import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Repeat } from 'lucide-react';
import type { CalEvent } from '../../types';
import { eventsOn, fmtTime, monthGrid, sameDay, startOfDay } from '../../calendarUtils';
import type { CardKit } from './EventCard';
import { isPending, onColor } from './calTools';
import { useSwipeNav } from './useSwipeNav';
import { t, tn } from '../../i18n';
import { fmtDate, fmtMonth, fmtWeekdayLong } from '../../i18n/format';

/**
 * Month. On a wide screen: the grid with each day's first events. On a phone: Google Calendar's grid, six weeks filling
 * the screen with each day's events as small solid chips with their titles ("+N" when they don't fit); tap a day for
 * that day, swipe for other months.
 */
export function MonthView({
  cursor,
  events,
  phone,
  kit,
  onCursor,
  onDay,
  onCreate,
  onStep,
}: {
  cursor: Date;
  events: CalEvent[];
  phone: boolean;
  kit: CardKit;
  onCursor: (d: Date) => void;
  onDay: (d: Date) => void; // a day on its own (Day view)
  onCreate: (start: Date) => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  useSwipeNav(grid, onStep, !phone);
  const cells = monthGrid(cursor);
  const today = new Date();
  const sorted = (d: Date) => eventsOn(events, d).sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start.localeCompare(b.start));
  const nine = (d: Date) => {
    const s = startOfDay(d);
    s.setHours(9);
    return s;
  };

  if (phone) return <PhoneMonth cursor={cursor} cells={cells} sorted={sorted} kit={kit} onDay={onDay} grid={grid} />;

  return (
    <div className="mg">
      <div className="mg-head">
        {cells.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{fmtDate(d, { weekday: 'short' })}</span>
        ))}
      </div>
      <div className="mg-body">
        {cells.map((d) => {
          const list = sorted(d);
          const extra = list.length - 3;
          return (
            <div key={d.toISOString()} className={`mg-cell ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''}`} onClick={() => onCreate(nine(d))}>
              <button
                className="mg-num"
                onClick={(e) => {
                  e.stopPropagation();
                  onDay(d);
                }}
              >
                {d.getDate()}
              </button>
              {list.slice(0, 3).map((e) => (
                <button
                  key={e.id}
                  className={`${e.allDay ? 'pill-event' : 'dot-event'} ${kit.selectedId === e.id ? 'picked' : ''} ${isPending(e) ? 'pending' : ''}`}
                  style={{ ['--c' as string]: kit.color(e.calendarId) }}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    kit.onSelect(e.id);
                  }}
                  onContextMenu={(m) => kit.onMenu && (m.preventDefault(), m.stopPropagation(), kit.onMenu(e, m.clientX, m.clientY))}
                >
                  {!e.allDay && <i />}
                  {!e.allDay && <span className="de-time">{fmtTime(e.start)}</span>}
                  <span className="de-title">{e.title}</span>
                  {e.rrule && <Repeat size={11} className="de-repeat" aria-label={t('Repeats')} />}
                </button>
              ))}
              {extra > 0 && (
                <button
                  className="mg-more"
                  onClick={(evt) => {
                    evt.stopPropagation();
                    onDay(d);
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

const CHIP = 17; // a chip and its gap (px)

/** Phones: the month as Google draws it. */
function PhoneMonth({ cursor, cells, sorted, kit, onDay, grid }: { cursor: Date; cells: Date[]; sorted: (d: Date) => CalEvent[]; kit: CardKit; onDay: (d: Date) => void; grid: RefObject<HTMLDivElement | null> }) {
  // How many chips fit in a day: the rows share the height between the bar and the tab bar.
  const [fit, setFit] = useState(4);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setFit(Math.max(1, Math.floor((el.clientHeight / 6 - 22) / CHIP)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid]);
  const today = new Date();
  return (
    <div className="mg mg-chips">
      <div className="mg-head" aria-hidden>
        {cells.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{fmtDate(d, { weekday: 'narrow' })}</span>
        ))}
      </div>
      <div className="mg-body" ref={grid} role="grid" aria-label={fmtMonth(cursor)} key={`${cursor.getFullYear()}-${cursor.getMonth()}`}>
        {cells.map((d) => {
          const evs = sorted(d);
          // The last line says how many more when they don't all fit.
          const shown = evs.length > fit ? evs.slice(0, fit - 1) : evs;
          const more = evs.length - shown.length;
          return (
            <button
              key={d.toISOString()}
              type="button"
              className={`mg-cell ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''}`}
              onClick={() => onDay(d)}
              aria-label={evs.length ? tn(evs.length, '{day}, {n} event', '{day}, {n} events', { day: fmtWeekdayLong(d) }) : fmtWeekdayLong(d)}
            >
              <span className="mg-num">{d.getDate()}</span>
              {shown.map((e) => {
                const c = kit.color(e.calendarId);
                return (
                  <span key={e.id} className={`mg-chip${isPending(e) ? ' pending' : ''}`} style={{ ['--c' as string]: c, ['--on' as string]: onColor(c) }}>
                    {e.title}
                  </span>
                );
              })}
              {more > 0 && <span className="mg-more-n">+{more}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
