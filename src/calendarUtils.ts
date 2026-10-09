import type { CalEvent } from './types';
import { t } from './i18n/index'; // the full paths: the server loads this file (seed.ts, data/calendar.ts)
import { fmtTime as fmtClock, fmtWeekdayLong } from './i18n/format';

export const DAY_MS = 86_400_000;

export function startOfDay(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function addDays(d: Date, days: number) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

/** Weeks start on Monday. */
export function startOfWeek(d: Date) {
  const n = startOfDay(d);
  return addDays(n, -((n.getDay() + 6) % 7));
}

export function addMonths(d: Date, months: number) {
  const n = new Date(d.getFullYear(), d.getMonth() + months, 1);
  n.setDate(Math.min(d.getDate(), new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
  return n;
}

export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** 6 rows × 7 days covering the month of `d`. */
export function monthGrid(d: Date) {
  const first = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export const minutesIntoDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** "14:30" / "14.30", in the person's language. */
export const fmtTime = (d: Date | string) => fmtClock(d);

/** "09:00 to 10:30" / "09.00 sampai 10.30". */
export const fmtTimeRange = (a: Date | string, b: Date | string) => t('{first} to {last}', { first: fmtClock(a), last: fmtClock(b) });

export function fmtRange(e: CalEvent) {
  const day = fmtWeekdayLong(e.start);
  if (e.allDay) return t('{day} · All day', { day });
  return `${day} · ${fmtTimeRange(e.start, e.end)}`;
}

/** The time grid's hour marks: "09:00" / "09.00". */
export const hourLabel = (h: number) => fmtClock(new Date(2000, 0, 1, h));

/** Events that touch the given day. */
export function eventsOn(events: CalEvent[], day: Date) {
  const s = startOfDay(day).getTime();
  const e = s + DAY_MS;
  return events.filter((ev) => new Date(ev.start).getTime() < e && new Date(ev.end).getTime() > s);
}

/**
 * Side-by-side layout for overlapping timed events in one day column.
 * Returns each event with its column index and the column count of its overlap group.
 */
export function layoutDay(events: CalEvent[]) {
  const sorted = [...events].sort(
    (a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end),
  );
  const out: { ev: CalEvent; col: number; cols: number }[] = [];
  let group: { ev: CalEvent; col: number; cols: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = 0;

  const flush = () => {
    for (const g of group) g.cols = colEnds.length;
    out.push(...group);
    group = [];
    colEnds = [];
  };

  for (const ev of sorted) {
    const s = new Date(ev.start).getTime();
    const e = new Date(ev.end).getTime();
    if (group.length && s >= groupEnd) flush();
    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(e);
    } else colEnds[col] = e;
    group.push({ ev, col, cols: 0 });
    groupEnd = Math.max(groupEnd, e);
  }
  flush();
  return out;
}

/** "2026-10-08" for <input type=date>. */
export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "14:30" for <input type=time>. */
export const toTimeInput = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
