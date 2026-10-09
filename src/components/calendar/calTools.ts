import type { CalEvent } from '../../types';
import { addDays, eventsOn, sameDay, startOfDay, startOfWeek } from '../../calendarUtils';

/**
 * The calendar's views. Phones get Schedule, Day, 3 Day and Month; Week (seven columns) only when the pane is wide
 * enough for it (`canWeek`), otherwise it shows as 3 Day.
 */
export type CalView = 'schedule' | 'day' | '3day' | 'week' | 'month';

export const VIEW_LABEL: Record<CalView, string> = { schedule: 'Schedule', day: 'Day', '3day': '3 days', week: 'Week', month: 'Month' };

/** The pane width from which Week (seven time columns) fits. */
export const WEEK_MIN = 640;

/** Week on a narrow pane becomes 3 Day; everything else stays. */
export const shownView = (v: CalView, canWeek: boolean): CalView => (v === 'week' && !canWeek ? '3day' : v);

/** The days a time grid shows. */
export function gridDays(view: CalView, cursor: Date) {
  if (view === 'day') return [startOfDay(cursor)];
  if (view === '3day') return [0, 1, 2].map((i) => addDays(startOfDay(cursor), i));
  const s = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** How far one swipe or arrow moves in a view. */
export function stepOf(view: CalView, cursor: Date, dir: 1 | -1) {
  if (view === 'month') {
    const n = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
    return n;
  }
  return addDays(cursor, dir * (view === 'week' ? 7 : view === '3day' ? 3 : view === 'schedule' ? 7 : 1));
}

/** An invite waiting for an answer (from mail, not on the calendar yet): drawn dashed, with Yes / Maybe / No. */
export const isPending = (e: CalEvent) => e.id.startsWith('inv:');
/** Answered "maybe": drawn with a dashed edge. */
export const isMaybe = (e: CalEvent) => e.rsvp === 'tentative';
export const isPast = (e: CalEvent, now = Date.now()) => new Date(e.end).getTime() < now;

/** "in 12 min", "now", "in 1 h 5 min". */
export function startsIn(e: CalEvent, now = Date.now()) {
  const m = Math.round((new Date(e.start).getTime() - now) / 60_000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** The next meeting starting within 30 minutes (or started under 5 minutes ago): what the Up next strip shows. */
export function upNext(events: CalEvent[], now = Date.now()) {
  return events
    .filter((e) => !e.allDay && !e.busy && !e.calendarId.startsWith('mate-') && !e.taskId && e.rsvp !== 'declined')
    .filter((e) => {
      const s = new Date(e.start).getTime();
      return s - now <= 30 * 60_000 && now - s <= 5 * 60_000;
    })
    .sort((a, b) => a.start.localeCompare(b.start))[0];
}

/** "Fri 9 Oct, 10:00 to 10:30" (or "Fri 9 Oct, all day"). */
export function whenLine(start: Date, end: Date, allDay?: boolean) {
  const day = start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (allDay) {
    const last = addDays(end, -1);
    return sameDay(start, last) || last < start ? `${day}, all day` : `${day} to ${last.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, all day`;
  }
  const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay(start, end) ? `${day}, ${t(start)} to ${t(end)}` : `${day}, ${t(start)} to ${end.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${t(end)}`;
}

const Q = 15 * 60_000;

/** The free 15-minute-aligned slots of `minutes` today (from now) and tomorrow, between 08:00 and 19:00. */
export function freeSlots(events: CalEvent[], minutes: number, now = new Date(), perDay = 3) {
  const out: Date[][] = [];
  for (const offset of [0, 1]) {
    const day = addDays(startOfDay(now), offset);
    const busy = eventsOn(events, day)
      .filter((e) => !e.allDay && e.rsvp !== 'declined')
      .map((e) => [new Date(e.start).getTime(), new Date(e.end).getTime()] as const)
      .sort((a, b) => a[0] - b[0]);
    const found: Date[] = [];
    const from = new Date(day);
    from.setHours(8, 0, 0, 0);
    if (offset === 0 && now > from) from.setTime(Math.ceil((now.getTime() + 60_000) / Q) * Q);
    const last = new Date(day);
    last.setHours(19, 0, 0, 0);
    const len = minutes * 60_000;
    let t = from.getTime();
    while (t + len <= last.getTime() && found.length < perDay) {
      const end = t + len;
      const clash = busy.find(([s, e]) => s < end && e > t);
      // Something's in the way: try again when it ends (on the quarter hour).
      if (clash) {
        t = Math.ceil(clash[1] / Q) * Q;
        continue;
      }
      found.push(new Date(t));
      // The next suggestion: after the next thing on the calendar, or two hours on when the day is open.
      const next = busy.find(([s]) => s >= end);
      t = Math.max(end, next ? Math.min(t + 2 * 3_600_000, Math.ceil(next[1] / Q) * Q) : t + 2 * 3_600_000);
    }
    out.push(found);
  }
  return { today: out[0], tomorrow: out[1] };
}

/** Rounds a time to the nearest quarter hour. */
export const snap15 = (ms: number) => Math.round(ms / (15 * 60_000)) * 15 * 60_000;

/** The link to an event inside sprint2go (Copy link). */
export const eventLink = (id: string) => `${location.origin}/calendar?event=${encodeURIComponent(id)}`;
