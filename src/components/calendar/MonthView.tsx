import { useRef } from 'react';
import { Plus, Repeat } from 'lucide-react';
import type { CalEvent } from '../../types';
import { eventsOn, fmtTime, monthGrid, sameDay, startOfDay } from '../../calendarUtils';
import { EventCard, type CardKit } from './EventCard';
import { isPending } from './calTools';
import { useSwipeNav } from './useSwipeNav';

/**
 * Month. On a wide screen: the grid with each day's first events. On a phone: a compact grid with a dot per event
 * (up to three) and the tapped day's events listed under it; swipe the grid for other months.
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

  if (phone) {
    const list = sorted(cursor);
    const now = Date.now();
    return (
      <div className="mg mg-phone">
        <div className="mg-top" ref={grid}>
          <div className="mg-head" aria-hidden>
            {cells.slice(0, 7).map((d) => (
              <span key={d.getDay()}>{d.toLocaleDateString([], { weekday: 'narrow' })}</span>
            ))}
          </div>
          <div className="mg-body" role="grid" aria-label={cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}>
            {cells.map((d) => {
              const evs = sorted(d);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  className={`mg-cell ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''} ${sameDay(d, cursor) ? 'picked' : ''}`}
                  onClick={() => onCursor(d)}
                  aria-label={`${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}${evs.length ? `, ${evs.length} ${evs.length === 1 ? 'event' : 'events'}` : ''}`}
                  aria-pressed={sameDay(d, cursor)}
                >
                  <span className="mg-num">{d.getDate()}</span>
                  <span className="mg-dots" aria-hidden>
                    {evs.slice(0, 3).map((e) => (
                      <i key={e.id} className={isPending(e) ? 'pending' : ''} style={{ ['--c' as string]: kit.color(e.calendarId) }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mg-list" key={cursor.toDateString()}>
          <div className="mg-list-head">
            <h2>{cursor.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <button type="button" className="ghost-btn sm" onClick={() => onDay(cursor)}>
              Open day
            </button>
          </div>
          {list.map((e) => (
            <EventCard key={e.id} e={e} kit={kit} now={now} />
          ))}
          {!list.length && (
            <button type="button" className="sch-free" onClick={() => onCreate(nine(cursor))}>
              <Plus size={15} /> Nothing planned. Add an event
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mg">
      <div className="mg-head">
        {cells.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{d.toLocaleDateString([], { weekday: 'short' })}</span>
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
                  onContextMenu={(m) => (m.preventDefault(), m.stopPropagation(), kit.onMenu(e, m.clientX, m.clientY))}
                >
                  {!e.allDay && <i />}
                  {!e.allDay && <span className="de-time">{fmtTime(e.start)}</span>}
                  <span className="de-title">{e.title}</span>
                  {e.rrule && <Repeat size={11} className="de-repeat" aria-label="Repeats" />}
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
