import type { CalEvent } from '../../types';
import { DAY_MS, startOfDay } from '../../calendarUtils';

/*
 * Month view's layout (Google Calendar's): each week is a row of seven days with numbered lanes under the dates. An
 * event that covers several days is one bar across them, cut where the week ends and carried on in the next row; the
 * rest sit one per lane on their day. Bars take the top lanes (earliest and longest first), single-day events fill
 * the lanes left. When a day has more than fits, its last lane says "+N" instead. No React and no browser here: the
 * unit tests read it (scripts/unit-tests.mjs).
 */

/** One piece of an event in one week: columns `from` to `to` (0 to 6, Monday first), on lane `lane`. */
export interface MonthPiece {
  e: CalEvent;
  from: number;
  to: number;
  lane: number;
  /** A bar (all day, or longer than a day) rather than a timed event on its day. */
  bar: boolean;
  /** It goes on before this piece (an earlier week, or a day that is hidden behind "+N") / after it. */
  before: boolean;
  after: boolean;
  /** This piece holds the event's start (where a timed bar shows its time). */
  first: boolean;
}

export interface MonthWeek {
  pieces: MonthPiece[];
  /** Days that don't fit: the day's column and how many of its events are hidden. */
  more: { col: number; n: number }[];
  /** Every event on each of the seven days (for the day's label), in lane order. */
  byDay: CalEvent[][];
}

/**
 * The first and last day (as indexes from `first`, the grid's first day) an event covers. An all-day event covers its
 * days up to the one before its end; a timed event one day, or every day it touches when it lasts a day or more
 * (a meeting from 22:00 to 01:00 stays on its first day, as in Google Calendar).
 */
export function eventSpan(e: Pick<CalEvent, 'start' | 'end' | 'allDay'>, first: Date): [number, number] {
  const f = startOfDay(first).getTime();
  const at = (d: Date) => Math.round((startOfDay(d).getTime() - f) / DAY_MS);
  const s = new Date(e.start);
  const en = new Date(e.end);
  const from = at(s);
  if (!(en.getTime() > s.getTime())) return [from, from];
  const long = e.allDay || en.getTime() - s.getTime() >= DAY_MS;
  return [from, long ? Math.max(from, at(new Date(en.getTime() - 1))) : from];
}

/**
 * The weeks of `days` (a multiple of seven, Monday first) with each event placed. `fit` is how many lanes a day has
 * room for: the last one turns into "+N" when a day has more.
 */
export function monthLayout(events: CalEvent[], days: Date[], fit: number): MonthWeek[] {
  const lanesFit = Math.max(1, Math.floor(fit));
  const spans = events.map((e) => ({ e, span: eventSpan(e, days[0]) }));
  const weeks: MonthWeek[] = [];
  for (let w = 0; w * 7 < days.length; w++) {
    const lo = w * 7;
    const hi = lo + 6;
    const segs = spans
      .filter(({ span }) => span[1] >= lo && span[0] <= hi)
      .map(({ e, span }) => ({
        e,
        from: Math.max(span[0], lo) - lo,
        to: Math.min(span[1], hi) - lo,
        bar: !!e.allDay || span[1] > span[0],
        before: span[0] < lo,
        after: span[1] > hi,
        startMs: new Date(e.start).getTime(),
        lane: -1,
      }))
      // Bars first: the earliest, then the longest, all-day before timed; then the day's timed events by their time.
      .sort(
        (a, b) =>
          Number(b.bar) - Number(a.bar) ||
          (a.bar ? a.from - b.from || b.to - b.from - (a.to - a.from) || Number(!!b.e.allDay) - Number(!!a.e.allDay) : 0) ||
          a.startMs - b.startMs ||
          a.e.title.localeCompare(b.e.title) ||
          a.e.id.localeCompare(b.e.id),
      );
    // Each one on the lowest lane that's free on all its days.
    const taken: boolean[][] = Array.from({ length: 7 }, () => []);
    for (const s of segs) {
      let lane = 0;
      while (taken.slice(s.from, s.to + 1).some((col) => col[lane])) lane++;
      s.lane = lane;
      for (let c = s.from; c <= s.to; c++) taken[c][lane] = true;
    }
    const covers = (c: number) => segs.filter((s) => s.from <= c && s.to >= c);
    const need = Array.from({ length: 7 }, (_, c) => covers(c).reduce((m, s) => Math.max(m, s.lane + 1), 0));
    const fits = (c: number) => need[c] <= lanesFit;
    const pieces: MonthPiece[] = [];
    for (const s of segs) {
      const piece = (from: number, to: number) => pieces.push({ e: s.e, from, to, lane: s.lane, bar: s.bar, before: from > s.from || s.before, after: to < s.to || s.after, first: from === s.from && !s.before });
      if (s.lane < lanesFit - 1) piece(s.from, s.to);
      else if (s.lane === lanesFit - 1) {
        // The last lane: shown on the days where everything fits, cut around the days that say "+N".
        let run = -1;
        for (let c = s.from; c <= s.to + 1; c++) {
          const ok = c <= s.to && fits(c);
          if (ok && run < 0) run = c;
          if (!ok && run >= 0) (piece(run, c - 1), (run = -1));
        }
      }
    }
    const more = Array.from({ length: 7 }, (_, col) => ({ col, n: fits(col) ? 0 : covers(col).filter((s) => s.lane >= lanesFit - 1).length })).filter((m) => m.n > 0);
    const byDay = Array.from({ length: 7 }, (_, c) => covers(c).sort((a, b) => a.lane - b.lane).map((s) => s.e));
    weeks.push({ pieces, more, byDay });
  }
  return weeks;
}
