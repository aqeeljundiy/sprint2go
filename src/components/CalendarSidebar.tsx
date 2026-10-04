import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { CalendarDef } from '../types';
import { addMonths, monthGrid, sameDay, startOfWeek } from '../calendarUtils';

interface Props {
  cursor: Date;
  calendars: CalendarDef[];
  hidden: Set<string>;
  busyDays: Set<string>;
  onCursor: (d: Date) => void;
  onToggle: (id: string) => void;
  onNew: () => void;
}

export function CalendarSidebar({ cursor, calendars, hidden, busyDays, onCursor, onToggle, onNew }: Props) {
  const cells = monthGrid(cursor);
  const today = new Date();
  const week = startOfWeek(cursor).getTime();

  return (
    <>
      <button className="compose-btn" onClick={onNew} title="New event (C)">
        <Plus size={16} />
        <span className="sb-label">New event</span>
        <kbd className="sb-label">C</kbd>
      </button>

      <div className="mini">
        <div className="mini-head">
          <span>{cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
          <div>
            <button className="icon-btn sm" onClick={() => onCursor(addMonths(cursor, -1))} aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <button className="icon-btn sm" onClick={() => onCursor(addMonths(cursor, 1))} aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="mini-grid">
          {cells.slice(0, 7).map((d) => (
            <span key={`h${d.getDay()}`} className="mini-dow">
              {d.toLocaleDateString([], { weekday: 'narrow' })}
            </span>
          ))}
          {cells.map((d) => (
            <button
              key={d.toISOString()}
              className={[
                'mini-day',
                d.getMonth() !== cursor.getMonth() && 'out',
                sameDay(d, today) && 'today',
                sameDay(d, cursor) && 'sel',
                startOfWeek(d).getTime() === week && 'in-week',
                busyDays.has(d.toDateString()) && 'busy',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onCursor(d)}
            >
              {d.getDate()}
            </button>
          ))}
        </div>
      </div>

      <div className="nav-heading sb-label">Calendars</div>
      <nav className="nav">
        {calendars.map((c) => {
          const on = !hidden.has(c.id);
          return (
            <button key={c.id} className="nav-item" onClick={() => onToggle(c.id)} title={c.name}>
              <span className={`cal-check ${on ? 'on' : ''}`} style={{ ['--c' as string]: c.color }}>
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="sb-label">{c.name}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
