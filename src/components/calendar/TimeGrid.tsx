import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Mic, Repeat } from 'lucide-react';
import type { CalEvent } from '../../types';
import { eventsOn, fmtTime, hourLabel, layoutDay, minutesIntoDay, sameDay, startOfDay } from '../../calendarUtils';
import { haptic, useLongPress } from '../ui/useLongPress';
import { isMaybe, isPending } from './calTools';
import { swipeLock, useSwipeNav } from './useSwipeNav';

const Q = 15 * 60_000;

export interface GridProps {
  days: Date[];
  events: CalEvent[];
  phone: boolean;
  hour: number; // px per hour
  color: (calendarId: string) => string;
  selectedId: string | null;
  canEdit: (e: CalEvent) => boolean;
  onMove?: (id: string, start: Date, end: Date, at?: { x: number; y: number }) => void; // `at`: where it was let go
  onSelect: (id: string) => void;
  onSlot: (start: Date, touch: boolean) => void; // an empty slot tapped or clicked
  onDay: (d: Date) => void; // a day's heading: that day on its own
  onMenu: (e: CalEvent, x: number, y: number) => void;
  onSchedule?: (taskId: string, start: Date) => void; // a task dropped on the grid (desktop)
  taskOf?: (e: CalEvent) => { title: string; done: boolean } | null;
  onTaskDone?: (e: CalEvent) => void;
  botWillJoin?: (e: CalEvent) => boolean;
  /** The block being made (the phone's quick create): drawn with handles to set its time. */
  quick: { start: Date; end: Date } | null;
  onQuick: (start: Date, end: Date) => void;
  onAllDay: (d: Date) => void; // "+N": that day's all-day list
  onStep?: (dir: 1 | -1) => void; // swiping sideways (phones)
}

type Drag = { id: string; mode: 'move' | 'resize'; x: number; y: number; scroll0: number; start: Date; end: Date; curStart: Date; curEnd: Date; moved: boolean; touch: boolean };

/**
 * Day, 3 Day and Week: hours down the side, a column per day. Events can be moved and their length changed:
 * with a mouse by dragging (the bottom edge for the length), on a touch screen by holding one for a moment until it
 * lifts and then moving it; letting go without moving opens its menu. Everything snaps to 15 minutes, and the move
 * can be undone from the toast. On phones a tap on an empty slot starts a new event there, drawn with handles.
 */
export function TimeGrid(p: GridProps) {
  const { days, events, hour, color } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useSwipeNav(rootRef, (dir) => p.onStep?.(dir), !p.onStep);

  // Open with "now" a third of the way down when today is on screen, else at 7:30.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const today = days.some((d) => sameDay(d, new Date()));
    el.scrollTop = today ? Math.max(0, (minutesIntoDay(new Date()) / 60) * hour - el.clientHeight / 3) : hour * 7.5;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The block being made sits in the upper part of the screen, above the sheet.
  const quickKey = p.quick ? p.quick.start.getTime() : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !p.quick || !p.phone) return;
    const top = (minutesIntoDay(p.quick.start) / 60) * hour;
    const want = top - Math.min(80, el.clientHeight * 0.15);
    if (top < el.scrollTop + 8 || top > el.scrollTop + el.clientHeight * 0.35) el.scrollTo({ top: Math.max(0, want), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [quickKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- moving and resizing ---------- */

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dayAt = (clientX: number) =>
    colsRef.current.findIndex((c) => {
      const r = c?.getBoundingClientRect();
      return r && clientX >= r.left && clientX < r.right;
    });
  /** Where the dragged event is now, for a pointer at x, y (the grid may have scrolled under it). */
  const follow = (d: Drag, x: number, y: number): Drag => {
    const scrolled = (scrollRef.current?.scrollTop ?? 0) - d.scroll0;
    const mins = Math.round((((y - d.y + scrolled) / hour) * 60) / 15) * 15;
    const moved = d.moved || Math.abs(y - d.y + scrolled) > 4 || Math.abs(x - d.x) > 4;
    if (d.mode === 'resize') return { ...d, curEnd: new Date(Math.max(d.start.getTime() + Q, d.end.getTime() + mins * 60_000)), moved };
    const from = days.findIndex((dd) => sameDay(dd, d.start));
    const to = dayAt(x);
    const shift = (mins + (to >= 0 && from >= 0 ? to - from : 0) * 24 * 60) * 60_000;
    return { ...d, curStart: new Date(d.start.getTime() + shift), curEnd: new Date(d.end.getTime() + shift), moved };
  };
  const finish = (d: Drag | null, x: number, y: number) => {
    swipeLock.on = false;
    dragRef.current = null; // once: the block's own release and the page's can both arrive
    setDrag(null);
    if (!d) return;
    if (d.moved && (d.curStart.getTime() !== d.start.getTime() || d.curEnd.getTime() !== d.end.getTime())) p.onMove?.(d.id, d.curStart, d.curEnd, { x, y });
    else if (d.touch && !d.moved) {
      const ev = events.find((e) => e.id === d.id);
      if (ev) p.onMenu(ev, x, y);
    } else if (!d.touch) p.onSelect(d.id);
  };

  // Mouse: drag straight away.
  useEffect(() => {
    if (!drag || drag.touch) return;
    const move = (e: PointerEvent) => setDrag((d) => d && follow(d, e.clientX, e.clientY));
    const up = (e: PointerEvent) => finish(dragRef.current, e.clientX, e.clientY);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag?.id, drag?.mode, drag?.touch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch: while a lifted event is held near the top or bottom edge, the grid scrolls.
  const lastPoint = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!drag?.touch) return;
    let raf = 0;
    const tick = () => {
      const el = scrollRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const { x, y } = lastPoint.current;
        const edge = y < r.top + 48 ? -1 : y > r.bottom - 48 ? 1 : 0;
        if (edge) {
          el.scrollTop += edge * 6;
          setDrag((d) => d && follow(d, x, y));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag?.id, drag?.touch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch: the page follows the finger too. A block that moves past another event or into another day's column moves
  // in the page, and its pointer capture goes with it; the drag still follows and ends where the finger lets go.
  useEffect(() => {
    if (!drag?.touch) return;
    const move = (e: PointerEvent) => {
      lastPoint.current = { x: e.clientX, y: e.clientY };
      setDrag((d) => d && follow(d, e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => finish(dragRef.current && follow(dragRef.current, e.clientX, e.clientY), e.clientX, e.clientY);
    // Taken away (a call, the system): it goes back to where it was.
    const cancel = () => finish(dragRef.current && follow(dragRef.current, dragRef.current.x, dragRef.current.y), lastPoint.current.x, lastPoint.current.y);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [drag?.id, drag?.touch]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = drag ? events.map((e) => (e.id === drag.id ? { ...e, start: drag.curStart.toISOString(), end: drag.curEnd.toISOString() } : e)) : events;

  /* ---------- making a new one ---------- */

  const lastPointer = useRef<string>('mouse');
  const slotAt = (day: Date, clientY: number, el: HTMLElement) => {
    const y = clientY - el.getBoundingClientRect().top;
    const start = startOfDay(day);
    start.setMinutes(Math.floor((y / hour) * 2) * 30); // the half hour that was tapped
    return start;
  };
  // A task dropped on a column becomes a time block at that spot (desktop: drag from "Plan your tasks").
  const dropTask = (day: Date, e: React.DragEvent<HTMLDivElement>) => {
    const id = e.dataTransfer.getData('text/s2g-task');
    if (!id) return;
    e.preventDefault();
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const start = startOfDay(day);
    start.setMinutes(Math.round(((y / hour) * 60) / 15) * 15);
    p.onSchedule?.(id, start);
  };

  const allDay = days.map((d) => eventsOn(events, d).filter((e) => e.allDay));
  const hasAllDay = allDay.some((a) => a.length);
  const perDay = p.phone ? 1 : 2;
  const today = days.findIndex((d) => sameDay(d, now));

  return (
    <div className="tg" ref={rootRef} style={{ ['--cols' as string]: days.length, ['--hour' as string]: `${hour}px` }}>
      <div className="tg-head">
        <div className="tg-gutter" />
        {days.map((d) => (
          <button key={d.toISOString()} className={`tg-day ${sameDay(d, now) ? 'today' : ''}`} onClick={() => p.onDay(d)} aria-label={d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}>
            <span className="tg-dow">{d.toLocaleDateString([], { weekday: 'short' })}</span>
            <span className="tg-num">{d.getDate()}</span>
          </button>
        ))}
      </div>

      {hasAllDay && (
        <div className="tg-allday">
          <div className="tg-gutter">all day</div>
          {allDay.map((list, i) => (
            <div key={i} className="tg-allday-cell">
              {list.slice(0, perDay).map((e) => (
                <button key={e.id} className={`pill-event ${p.selectedId === e.id ? 'picked' : ''} ${isPending(e) ? 'pending' : ''}`} style={{ ['--c' as string]: color(e.calendarId) }} onClick={() => p.onSelect(e.id)}>
                  {e.rrule && <Repeat size={11} className="pe-repeat" aria-label="Repeats" />}
                  {e.title}
                </button>
              ))}
              {list.length > perDay && (
                <button className="tg-allday-more" onClick={() => p.onAllDay(days[i])} aria-label={`${list.length - perDay} more all-day events`}>
                  +{list.length - perDay}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ height: hour * 24 }}>
          <div className="tg-gutter tg-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * hour }} className={today >= 0 && Math.abs(minutesIntoDay(now) - h * 60) < 20 ? 'near-now' : ''}>
                {h > 0 ? hourLabel(h) : ''}
              </span>
            ))}
            {today >= 0 && (
              <span className="now-label" style={{ top: (minutesIntoDay(now) / 60) * hour }}>
                {fmtTime(now).replace(/\s?[AP]M$/i, '')}
              </span>
            )}
          </div>
          {days.map((d, di) => {
            const timed = eventsOn(live, d).filter((e) => !e.allDay);
            const isToday = sameDay(d, now);
            const ghost = p.quick && sameDay(p.quick.start, d) ? p.quick : null;
            return (
              <div
                key={d.toISOString()}
                ref={(el) => {
                  colsRef.current[di] = el;
                }}
                className={`tg-col ${isToday ? 'today' : ''}`}
                onPointerDown={(e) => (lastPointer.current = e.pointerType)}
                onClick={(e) => !drag && p.onSlot(slotAt(d, e.clientY, e.currentTarget), lastPointer.current !== 'mouse')}
                onDragOver={(e) => e.dataTransfer.types.includes('text/s2g-task') && e.preventDefault()}
                onDrop={(e) => dropTask(d, e)}
              >
                {layoutDay(timed).map(({ ev, col, cols }) => (
                  <Block
                    key={ev.id}
                    ev={ev}
                    col={col}
                    cols={cols}
                    hour={hour}
                    now={now}
                    color={color(ev.calendarId)}
                    picked={p.selectedId === ev.id}
                    editable={!!p.onMove && p.canEdit(ev)}
                    dragging={drag?.id === ev.id}
                    task={p.taskOf?.(ev) ?? null}
                    bot={!!p.botWillJoin?.(ev)}
                    onTaskDone={() => p.onTaskDone?.(ev)}
                    onSelect={() => p.onSelect(ev.id)}
                    onMenu={(x, y) => p.onMenu(ev, x, y)}
                    onMouseDrag={(mode, x, y) => {
                      const orig = events.find((x2) => x2.id === ev.id)!;
                      const st = new Date(orig.start);
                      const en = new Date(orig.end);
                      setDrag({ id: ev.id, mode, x, y, scroll0: scrollRef.current?.scrollTop ?? 0, start: st, end: en, curStart: st, curEnd: en, moved: false, touch: false });
                    }}
                    onLift={(x, y) => {
                      const orig = events.find((x2) => x2.id === ev.id)!;
                      const st = new Date(orig.start);
                      const en = new Date(orig.end);
                      swipeLock.on = true;
                      lastPoint.current = { x, y };
                      setDrag({ id: ev.id, mode: 'move', x, y, scroll0: scrollRef.current?.scrollTop ?? 0, start: st, end: en, curStart: st, curEnd: en, moved: false, touch: true });
                    }}
                    onTouchMove={(x, y) => {
                      lastPoint.current = { x, y };
                      setDrag((dd) => dd && follow(dd, x, y));
                    }}
                    onTouchEnd={(x, y) => finish(dragRef.current && follow(dragRef.current, x, y), x, y)}
                  />
                ))}
                {ghost && <Ghost q={ghost} hour={hour} onChange={p.onQuick} />}
                {isToday && (
                  <div className="now-line" style={{ top: (minutesIntoDay(now) / 60) * hour }}>
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

/** One event in the grid. */
function Block(b: {
  ev: CalEvent;
  col: number;
  cols: number;
  hour: number;
  now: Date;
  color: string;
  picked: boolean;
  editable: boolean;
  dragging: boolean;
  task: { title: string; done: boolean } | null;
  bot: boolean;
  onTaskDone: () => void;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onMouseDrag: (mode: 'move' | 'resize', x: number, y: number) => void;
  onLift: (x: number, y: number) => void;
  onTouchMove: (x: number, y: number) => void;
  onTouchEnd: (x: number, y: number) => void;
}) {
  const { ev, hour } = b;
  // Touch: hold to lift it (then move it, or let go for its menu). Read-only ones open the menu straight away.
  const press = useLongPress(
    (pt) => {
      if (b.editable) b.onLift(pt.x, pt.y);
      else b.onMenu(pt.x, pt.y);
    },
    b.editable ? { onDrag: (d) => b.onTouchMove(d.x, d.y), onDragEnd: (d) => b.onTouchEnd(d.x, d.y) } : {},
  );
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  const top = (minutesIntoDay(s) / 60) * hour;
  const height = Math.max(((e.getTime() - s.getTime()) / 3_600_000) * hour - 2, 20);
  const short = height < 40;
  const cls = [
    'block-event',
    'lp',
    short && 'short',
    e < b.now && 'past',
    b.picked && 'picked',
    b.editable && 'editable',
    b.dragging && 'dragging',
    isPending(ev) && 'pending',
    isMaybe(ev) && 'maybe',
    b.task && 'is-task',
    b.task?.done && 'done',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${ev.title}, ${fmtTime(s)} to ${fmtTime(e)}${ev.rrule ? ', repeats' : ''}`}
      className={cls}
      {...press}
      onPointerDown={(pe) => {
        if (pe.pointerType !== 'mouse') return press.onPointerDown(pe);
        if (!b.editable || pe.button !== 0) return;
        pe.stopPropagation();
        b.onMouseDrag((pe.target as HTMLElement).closest('.be-resize') ? 'resize' : 'move', pe.clientX, pe.clientY);
      }}
      onContextMenu={(m) => {
        press.onContextMenu(m);
        m.preventDefault();
        b.onMenu(m.clientX, m.clientY);
      }}
      onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), b.onSelect())}
      style={{
        ['--c' as string]: b.color,
        top,
        height,
        left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
        width: `calc(${100 / b.cols}% - 4px)`,
      }}
      onClick={(evt) => {
        evt.stopPropagation();
        // Mouse on an editable one: it opens on pointer up unless it was dragged.
        if (!b.editable || (evt.nativeEvent as PointerEvent).pointerType !== 'mouse') b.onSelect();
      }}
    >
      {b.task && (
        <button
          type="button"
          className={`ev-check sm${b.task.done ? ' on' : ''}`}
          aria-label={b.task.done ? 'Done' : 'Mark the task done'}
          onPointerDown={(x) => x.stopPropagation()}
          onClick={(x) => (x.stopPropagation(), !b.task!.done && (haptic(), b.onTaskDone()))}
        >
          {b.task.done && <Check size={11} strokeWidth={3} />}
        </button>
      )}
      <span className="be-title">{ev.title}</span>
      <span className="be-time">
        {b.bot && <Mic size={11} className="be-bot" aria-label="The notetaker will join" />}
        {ev.rrule && <Repeat size={11} className="be-repeat" aria-label="Repeats" />}
        {fmtTime(s)}
        {(!short || b.dragging) && ` to ${fmtTime(e)}`}
      </span>
      {b.editable && <span className="be-resize" aria-hidden />}
    </div>
  );
}

/** The new event's block, with a handle at the top and the bottom to set its time (and the middle to move it). */
function Ghost({ q, hour, onChange }: { q: { start: Date; end: Date }; hour: number; onChange: (s: Date, e: Date) => void }) {
  const st = useRef<{ mode: 'start' | 'end' | 'move'; y: number; s: number; e: number; id: number } | null>(null);
  const top = (minutesIntoDay(q.start) / 60) * hour;
  const height = Math.max(((q.end.getTime() - q.start.getTime()) / 3_600_000) * hour, 15);
  const down = (mode: 'start' | 'end' | 'move') => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    st.current = { mode, y: e.clientY, s: q.start.getTime(), e: q.end.getTime(), id: e.pointerId };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* gone */
    }
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const g = st.current;
    if (!g || e.pointerId !== g.id) return;
    const mins = Math.round((((e.clientY - g.y) / hour) * 60) / 15) * 15 * 60_000;
    const day0 = startOfDay(new Date(g.s)).getTime();
    const dayEnd = day0 + 24 * 3_600_000;
    let s = g.s;
    let en = g.e;
    if (g.mode === 'start') s = Math.min(g.e - Q, Math.max(day0, g.s + mins));
    else if (g.mode === 'end') en = Math.max(g.s + Q, Math.min(dayEnd, g.e + mins));
    else {
      const len = g.e - g.s;
      s = Math.min(dayEnd - len, Math.max(day0, g.s + mins));
      en = s + len;
    }
    if (s !== q.start.getTime() || en !== q.end.getTime()) {
      haptic(4);
      onChange(new Date(s), new Date(en));
    }
  };
  const up = () => (st.current = null);
  return (
    <div className="ghost-block" style={{ top, height }} onClick={(e) => e.stopPropagation()} onPointerDown={down('move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="gh-handle top" onPointerDown={down('start')} aria-label="Drag to change the start" role="slider" aria-valuenow={minutesIntoDay(q.start)} aria-valuetext={fmtTime(q.start)} />
      <span className="gh-time">
        {fmtTime(q.start)} to {fmtTime(q.end)}
      </span>
      <span className="gh-handle bottom" onPointerDown={down('end')} aria-label="Drag to change the end" role="slider" aria-valuenow={minutesIntoDay(q.end)} aria-valuetext={fmtTime(q.end)} />
    </div>
  );
}
