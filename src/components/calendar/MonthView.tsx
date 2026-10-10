import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Repeat } from 'lucide-react';
import type { CalEvent } from '../../types';
import { eventsOn, fmtTime, monthGrid, sameDay, startOfDay } from '../../calendarUtils';
import { EventCard } from './EventCard';
import type { CardKit } from './EventCard';
import { isPending, onColor } from './calTools';
import { monthLayout, type MonthPiece } from './monthLayout';
import { useSwipeNav } from './useSwipeNav';
import { t, tn } from '../../i18n';
import { fmtDate, fmtMonth, fmtWeekdayLong } from '../../i18n/format';

/** The heights the lanes are worked out from (px): the date's row, one lane, the room left under the last one. */
const ROOM = { phone: { num: 32, lane: 17, end: 2 }, desk: { num: 34, lane: 22, end: 4 } };

/**
 * How many lanes fit in a week's row (Google's month fills the screen on phones; on a computer the rows are at least
 * 96 px and the grid scrolls). Measured on the first week; every week has the same height.
 */
function useLanes(body: RefObject<HTMLDivElement | null>, phone: boolean) {
  const room = phone ? ROOM.phone : ROOM.desk;
  const [fit, setFit] = useState(phone ? 4 : 3);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      const week = el.querySelector<HTMLElement>('.mg-week');
      const h = week?.clientHeight ?? el.clientHeight / 6;
      const n = Math.max(1, Math.floor((h - room.num - room.end) / room.lane));
      setFit((was) => (was === n ? was : n));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [body, room]);
  return fit;
}

/**
 * Month: six weeks, each a row with lanes under the dates (Google Calendar's). An event over several days is one bar
 * across them, carried on in the next row at the week's end; a day with more than fits says "+N". On a computer: click a
 * day for a new event at 9:00, its date or "+N" for the day, an event to open it. On a phone: the events as small solid
 * chips and bars, tap a day for that day, swipe for other months.
 */
export function MonthView({
  cursor,
  events,
  phone,
  kit,
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
  if (phone) return <PhoneMonth cursor={cursor} events={events} kit={kit} onDay={onDay} onCreate={onCreate} onStep={onStep} />;
  return <GridMonth cursor={cursor} events={events} phone={phone} kit={kit} onDay={onDay} onCreate={onCreate} onStep={onStep} />;
}

/**
 * Phones (iOS Calendar's month): the dates with up to three coloured dots under each, no text in the cells, and the
 * picked day's events listed under the grid. Tap a day to pick it, tap it again to open it; swipe for other months.
 */
function PhoneMonth({ cursor, events, kit, onDay, onCreate, onStep }: { cursor: Date; events: CalEvent[]; kit: CardKit; onDay: (d: Date) => void; onCreate: (start: Date) => void; onStep: (dir: 1 | -1) => void }) {
  const grid = useRef<HTMLDivElement>(null);
  useSwipeNav(grid, onStep, false);
  const cells = useMemo(() => monthGrid(cursor), [cursor]);
  const today = new Date();
  const inMonth = (d: Date) => d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
  const [picked, setPicked] = useState<Date>(() => (inMonth(today) ? today : new Date(cursor.getFullYear(), cursor.getMonth(), 1)));
  // Another month on screen: pick today there, else its first day.
  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
  const [shownKey, setShownKey] = useState(monthKey);
  if (shownKey !== monthKey) {
    setShownKey(monthKey);
    setPicked(inMonth(today) ? today : new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  }
  const dayList = eventsOn(events, picked).sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start.localeCompare(b.start));
  const nine = new Date(startOfDay(picked));
  nine.setHours(9);
  return (
    <div className="mp">
      <div className="mp-head" aria-hidden>
        {cells.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{fmtDate(d, { weekday: 'narrow' })}</span>
        ))}
      </div>
      <div className="mp-grid" ref={grid} role="grid" aria-label={fmtMonth(cursor)} key={monthKey}>
        {cells.map((d) => {
          const list = eventsOn(events, d);
          const on = sameDay(d, picked);
          return (
            <button
              key={d.toDateString()}
              type="button"
              className={`mp-day${inMonth(d) ? '' : ' out'}${sameDay(d, today) ? ' today' : ''}${on ? ' on' : ''}`}
              onClick={() => (on ? onDay(d) : setPicked(d))}
              aria-pressed={on}
              aria-label={list.length ? tn(list.length, '{day}, {n} event', '{day}, {n} events', { day: fmtWeekdayLong(d) }) : fmtWeekdayLong(d)}
            >
              <span className="mp-num">{d.getDate()}</span>
              <span className="mp-dots" aria-hidden>
                {list.slice(0, 3).map((e) => (
                  <i key={e.id} style={{ background: kit.color(e.calendarId) }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mp-list">
        <h2 className="mp-list-head">{fmtWeekdayLong(picked)}</h2>
        {dayList.length ? (
          dayList.map((e) => <EventCard key={e.id} e={e} kit={kit} now={Date.now()} />)
        ) : (
          <button type="button" className="sch-free mp-free" onClick={() => onCreate(nine)}>
            {sameDay(picked, today) ? t('Nothing planned today') : t('Nothing planned')}
          </button>
        )}
      </div>
    </div>
  );
}

function GridMonth({ cursor, events, phone, kit, onDay, onCreate, onStep }: { cursor: Date; events: CalEvent[]; phone: boolean; kit: CardKit; onDay: (d: Date) => void; onCreate: (start: Date) => void; onStep: (dir: 1 | -1) => void }) {
  const body = useRef<HTMLDivElement>(null);
  useSwipeNav(body, onStep, !phone);
  const cells = useMemo(() => monthGrid(cursor), [cursor]);
  const fit = useLanes(body, phone);
  const weeks = useMemo(() => monthLayout(events, cells, fit), [events, cells, fit]);
  const today = new Date();
  const nine = (d: Date) => {
    const s = startOfDay(d);
    s.setHours(9);
    return s;
  };
  const rows = { gridTemplateRows: `var(--mg-num) repeat(${fit}, var(--mg-lane)) minmax(0, 1fr)` } as CSSProperties;
  const place = (p: Pick<MonthPiece, 'from' | 'to' | 'lane'>) => ({ gridColumn: `${p.from + 1} / ${p.to + 2}`, gridRow: p.lane + 2 });
  const out = (d: Date) => d.getMonth() !== cursor.getMonth();

  return (
    <div className={`mg mg-lanes${phone ? ' mg-chips' : ''}`}>
      <div className="mg-head" aria-hidden={phone || undefined}>
        {cells.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{fmtDate(d, { weekday: phone ? 'narrow' : 'short' })}</span>
        ))}
      </div>
      <div className="mg-body" ref={body} role={phone ? 'grid' : undefined} aria-label={phone ? fmtMonth(cursor) : undefined} key={phone ? `${cursor.getFullYear()}-${cursor.getMonth()}` : undefined}>
        {weeks.map((wk, w) => (
          <div key={w} className="mg-week" style={rows}>
            {cells.slice(w * 7, w * 7 + 7).map((d, c) => {
              const cls = `mg-cell${out(d) ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}`;
              const n = wk.byDay[c].length;
              return phone ? (
                <button key={c} type="button" className={cls} style={{ gridColumn: c + 1 }} onClick={() => onDay(d)} aria-label={n ? tn(n, '{day}, {n} event', '{day}, {n} events', { day: fmtWeekdayLong(d) }) : fmtWeekdayLong(d)}>
                  <span className="mg-num">{d.getDate()}</span>
                </button>
              ) : (
                <div key={c} className={cls} style={{ gridColumn: c + 1 }} onClick={() => onCreate(nine(d))}>
                  <button
                    className="mg-num"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDay(d);
                    }}
                    aria-label={fmtWeekdayLong(d)}
                  >
                    {d.getDate()}
                  </button>
                </div>
              );
            })}
            {wk.pieces.map((p) => (phone ? <PhoneChip key={`${p.e.id}:${p.from}`} p={p} kit={kit} style={place(p)} /> : <DeskItem key={`${p.e.id}:${p.from}`} p={p} kit={kit} style={place(p)} />))}
            {wk.more.map((m) =>
              phone ? (
                <span key={`m${m.col}`} className="mg-more-n" style={place({ from: m.col, to: m.col, lane: fit - 1 })} aria-hidden="true">
                  +{m.n}
                </span>
              ) : (
                <button key={`m${m.col}`} className="mg-more" style={place({ from: m.col, to: m.col, lane: fit - 1 })} onClick={() => onDay(cells[w * 7 + m.col])}>
                  {tn(m.n, '+{n} more', '+{n} more')}
                </button>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const edges = (p: MonthPiece) => `${p.before ? ' mg-go-l' : ''}${p.after ? ' mg-go-r' : ''}`;

/** Phones: a solid chip with its title; a bar across its days. Taps go through to the day under the finger. */
function PhoneChip({ p, kit, style }: { p: MonthPiece; kit: CardKit; style: CSSProperties }) {
  const c = kit.color(p.e.calendarId);
  return (
    <span className={`mg-chip${p.bar && p.to > p.from ? ' mg-span' : ''}${edges(p)}${isPending(p.e) ? ' pending' : ''}`} style={{ ...style, ['--c' as string]: c, ['--on' as string]: onColor(c) }} aria-hidden="true">
      {p.e.title}
    </span>
  );
}

/** Computers: a bar for all-day and multi-day events (its time on the first day when it has one), a dot and the time for the rest. */
function DeskItem({ p, kit, style }: { p: MonthPiece; kit: CardKit; style: CSSProperties }) {
  const e = p.e;
  const timedBar = p.bar && !e.allDay;
  return (
    <button
      className={`${p.bar ? 'pill-event mg-bar' : 'dot-event'}${edges(p)} ${kit.selectedId === e.id ? 'picked' : ''} ${isPending(e) ? 'pending' : ''}`}
      style={{ ...style, ['--c' as string]: kit.color(e.calendarId) }}
      onClick={(evt) => {
        evt.stopPropagation();
        kit.onSelect(e.id);
      }}
      onContextMenu={(m) => kit.onMenu && (m.preventDefault(), m.stopPropagation(), kit.onMenu(e, m.clientX, m.clientY))}
      title={p.bar ? e.title : undefined}
    >
      {!p.bar && <i />}
      {(!p.bar || (timedBar && p.first)) && <span className="de-time">{fmtTime(e.start)}</span>}
      <span className="de-title">{e.title}</span>
      {e.rrule && <Repeat size={11} className="de-repeat" aria-label={t('Repeats')} />}
    </button>
  );
}
