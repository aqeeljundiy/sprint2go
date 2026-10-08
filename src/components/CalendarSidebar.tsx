import { useRef, useState } from 'react';
import { GripVertical, CalendarPlus, Check, ChevronLeft, ChevronRight, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { CalendarDef, User } from '../types';
import { addMonths, monthGrid, sameDay, startOfWeek } from '../calendarUtils';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { Popover } from './ui/Popover';
import { SourceMark } from './ConnectCalendar';

interface Props {
  cursor: Date;
  calendars: CalendarDef[]; // sprint2go calendars
  external: CalendarDef[]; // my connected calendars
  teammates: User[];
  shownMates: Set<string>;
  hidden: Set<string>;
  busyDays: Set<string>;
  onCursor: (d: Date) => void;
  onToggle: (id: string) => void;
  onToggleMate: (id: string) => void;
  onNew: () => void;
  onAddCalendar: () => void;
  onShare: (id: string, share: 'busy' | 'details' | 'private') => void;
  onSync: (id: string) => void;
  onRemove: (id: string) => void;
  /** My open tasks without a time block yet: drag one onto the calendar. */
  toPlan?: { id: string; title: string; sub?: string; late?: boolean }[];
  onPlan?: (id: string) => void; // no drag (phones): block the next free morning slot
}

export function CalendarSidebar({ cursor, calendars, external, teammates, shownMates, hidden, busyDays, onCursor, onToggle, onToggleMate, onNew, onAddCalendar, onShare, onSync, onRemove, toPlan = [], onPlan }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const menuCal = external.find((c) => c.id === menuFor);
  const accounts = [...new Set(external.map((c) => c.account ?? (c.source === 'holidays' ? 'Holidays' : 'Calendar links')))];
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
                sameDay(d, cursor) && 'picked',
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

      {toPlan.length > 0 && (
        <>
          <div className="nav-heading sb-label">Plan your tasks</div>
          <p className="muted small sb-label plan-hint">Drag a task onto the calendar to block time for it.</p>
          <nav className="nav plan-list">
            {toPlan.slice(0, 8).map((t) => (
              <div
                key={t.id}
                className={`plan-task sb-label ${t.late ? 'late' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/s2g-task', t.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title="Drag onto the calendar"
              >
                <GripVertical size={13} className="pt-grip" />
                <span className="pt-text">
                  <strong>{t.title}</strong>
                  {t.sub && <small>{t.sub}</small>}
                </span>
                {onPlan && (
                  <button className="icon-btn sm pt-add" title="Block time tomorrow morning" onClick={() => onPlan(t.id)}>
                    <CalendarPlus size={14} />
                  </button>
                )}
              </div>
            ))}
          </nav>
        </>
      )}

      <div className="nav-heading sb-label">My calendars</div>
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

      {accounts.map((acc) => (
        <div key={acc}>
          <div className="nav-heading sb-label cal-acc">
            {(() => {
              const first = external.find((c) => (c.account ?? (c.source === 'holidays' ? 'Holidays' : 'Calendar links')) === acc)!;
              return <SourceMark source={first.source ?? 'sprint2go'} size={14} />;
            })()}
            <span>{acc}</span>
          </div>
          <nav className="nav">
            {external
              .filter((c) => (c.account ?? (c.source === 'holidays' ? 'Holidays' : 'Calendar links')) === acc)
              .map((c) => {
                const on = !hidden.has(c.id);
                return (
                  <div key={c.id} className="nav-row">
                    <button className="nav-item" onClick={() => onToggle(c.id)} title={`${c.name}${c.syncedAt ? ` · synced ${relative(c.syncedAt)}` : ''}`}>
                      <span className={`cal-check ${on ? 'on' : ''}`} style={{ ['--c' as string]: c.color }}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="sb-label">
                        {c.name}
                        {c.share === 'busy' && <em className="cal-share">busy only</em>}
                        {c.share === 'private' && <em className="cal-share">private</em>}
                      </span>
                    </button>
                    <button
                      className="nav-more"
                      aria-label="Calendar options"
                      onClick={(e) => {
                        anchor.current = e.currentTarget;
                        setMenuFor(c.id);
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                );
              })}
          </nav>
        </div>
      ))}
      <nav className="nav">
        <button className="nav-item" onClick={onAddCalendar} title="Add a calendar">
          <Plus size={16} />
          <span className="sb-label">Add a calendar</span>
        </button>
      </nav>

      {teammates.length > 0 && (
        <>
          <div className="nav-heading sb-label">Teammates</div>
          <nav className="nav">
            {teammates.map((u) => {
              const on = shownMates.has(u.id);
              return (
                <button key={u.id} className={`nav-item ${on ? 'active' : ''}`} onClick={() => onToggleMate(u.id)} title={`Show when ${u.name.split(' ')[0]} is busy`}>
                  <Avatar person={u} size={20} />
                  <span className="sb-label">{u.name}</span>
                  {on && <Check size={14} className="mate-on" />}
                </button>
              );
            })}
          </nav>
        </>
      )}

      <Popover anchor={anchor} open={!!menuCal} onClose={() => setMenuFor(null)} width={260} title={menuCal?.name}>
        {menuCal && (
          <div className="sel-pop">
            <div className="sel-group">Teammates see</div>
            {(
              [
                ['busy', 'Busy only', 'A busy block, never the title'],
                ['details', 'Full details', 'Titles and places'],
                ['private', 'Nothing', 'Only you see these'],
              ] as const
            ).map(([v, l, h]) => (
              <button key={v} className="sel-opt" onClick={() => (onShare(menuCal.id, v), setMenuFor(null))}>
                <span className="sel-label">
                  {l}
                  <small>{h}</small>
                </span>
                {(menuCal.share ?? 'busy') === v && <Check size={14} className="sel-check" />}
              </button>
            ))}
            {!menuCal.readOnly || menuCal.source === 'ics' ? (
              <button className="sel-opt" onClick={() => (onSync(menuCal.id), setMenuFor(null))}>
                <RefreshCw size={14} /> Sync now
                {menuCal.syncedAt && <small className="muted">&nbsp;last {relative(menuCal.syncedAt)}</small>}
              </button>
            ) : null}
            <button className="sel-opt danger" onClick={() => (onRemove(menuCal.id), setMenuFor(null))}>
              <Trash2 size={14} /> Remove calendar
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}
