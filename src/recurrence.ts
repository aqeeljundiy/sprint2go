// Repeats, in one place for the server and the app: RRULE (RFC 5545) read and expanded on wall-clock time in a zone, so
// "every Monday at 9:00 in London" stays at 9:00 across daylight saving. server/ics.ts reads calendar files and invites
// with it (and re-exports it); src/repeat.ts makes sprint2go's own repeating events from it. No dependencies.

/* ---------- times ---------- */

/** A time as written in the file. Wall-clock fields; `tz` says how to read them. */
export interface ICalTime {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
  date: boolean; // a whole day (VALUE=DATE)
  utc: boolean; // ends in Z
  tz?: string; // TZID
}

export function parseTime(value: string, params: Record<string, string> = {}): ICalTime | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i);
  if (!m) return null;
  const date = !m[4] || params.VALUE === 'DATE';
  return { y: +m[1], m: +m[2], d: +m[3], h: date ? 0 : +m[4], mi: date ? 0 : +m[5], s: date ? 0 : +(m[6] ?? 0), date, utc: !!m[7], tz: m[7] ? undefined : params.TZID };
}

/** Wall-clock fields as one number (milliseconds, as if the wall clock were UTC): easy, DST-free date arithmetic. */
export const wallOf = (t: { y: number; m: number; d: number; h: number; mi: number; s: number }) => Date.UTC(t.y, t.m - 1, t.d, t.h, t.mi, t.s);
export const DAY = 86_400_000;

/* ---------- time zones (IANA names) ---------- */

const zoneOk = new Map<string, boolean>();
/** Whether this is an IANA zone name we can compute with. */
export function isZone(tz: string) {
  if (!zoneOk.has(tz)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      zoneOk.set(tz, true);
    } catch {
      zoneOk.set(tz, false);
    }
  }
  return zoneOk.get(tz)!;
}

/** One formatter per zone: making them is the slow part, and a year of a daily repeat asks thousands of times. */
const clocks = new Map<string, Intl.DateTimeFormat>();
const clockOf = (tz: string) => {
  let f = clocks.get(tz);
  if (!f) clocks.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  return f;
};
/**
 * Offsets by zone and quarter hour: a zone's offset only changes on a quarter hour (UTC), so one answer holds for the
 * whole quarter. Drawing a year of a daily repeat asks thousands of times; this keeps it quick.
 */
const offsets = new Map<string, number>();
/** How far a zone is ahead of UTC at an instant, in minutes. */
export function zoneOffset(tz: string, at: number): number {
  const key = `${tz}|${Math.floor(at / 900_000)}`;
  const known = offsets.get(key);
  if (known !== undefined) return known;
  const parts = clockOf(tz).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  const off = Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
  if (offsets.size > 50_000) offsets.clear();
  offsets.set(key, off);
  return off;
}
/**
 * A wall-clock time in a zone (month 0-11), as a UTC instant. As RFC 5545 asks: a time that happens twice (clocks go
 * back) is the first one, and a time that doesn't exist (clocks go forward) uses the offset from before the change.
 */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const wall = Date.UTC(y, mo, d, h, mi, s);
  const before = zoneOffset(tz, wall - DAY);
  const after = zoneOffset(tz, wall + DAY);
  const tBefore = wall - before * 60_000;
  const tAfter = wall - after * 60_000;
  const okBefore = zoneOffset(tz, tBefore) === before;
  const okAfter = zoneOffset(tz, tAfter) === after;
  if (okBefore && okAfter) return Math.min(tBefore, tAfter);
  if (okAfter) return tAfter;
  return tBefore;
}
/** The wall clock in a zone (null: UTC, or floating), at an instant: wall ms, as if the wall clock were UTC. */
export const wallFromUtc = (utc: number, tz: string | null) => (!tz || !Number.isFinite(utc) ? utc : utc + zoneOffset(tz, utc) * 60_000);
/** A wall-clock time (wall ms) in a zone (null: UTC, or floating), as the real instant. */
export function utcFromWall(wall: number, tz: string | null) {
  if (!tz || !Number.isFinite(wall)) return wall;
  const d = new Date(wall);
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), tz);
}

export const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** Wall ms to "YYYY-MM-DDTHH:MM:SS" with no zone: the browser reads it as local time. */
export const floating = (wall: number) => {
  const d = new Date(wall);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/* ---------- recurrence ---------- */

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: ICalTime;
  byDay?: { n: number; wd: number }[]; // n = 0: every such weekday; -1: the last one
  byMonthDay?: number[]; // -1: the last day of the month
  byMonth?: number[];
  byWeekNo?: number[]; // weeks of the year (week 1 has at least 4 of its days in the year, weeks start on WKST); -1: the last
  byYearDay?: number[]; // days of the year; -1: 31 December
  bySetPos?: number[];
  wkst: number;
}
/** A repeat rule, or null for one calendars don't use for events (hourly and finer) or that isn't one. */
export function parseRRule(v: string): RRule | null {
  const parts = Object.fromEntries(
    v
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((x) => x.split('='))
      .filter((x) => x.length === 2)
      .map(([k, val]) => [k.trim().toUpperCase(), val.trim()]),
  );
  const freq = parts.FREQ?.toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const nums = (s?: string, max = 366) => {
    const list = s ? s.split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) <= max) : [];
    return list.length ? list : undefined;
  };
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(',')
        .map((x: string) => x.trim().toUpperCase().match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/))
        .filter((m: RegExpMatchArray | null): m is RegExpMatchArray => !!m)
        .map((m: RegExpMatchArray) => ({ n: m[1] ? +m[1] : 0, wd: WEEKDAYS.indexOf(m[2]) }))
    : undefined;
  return {
    freq: freq as RRule['freq'],
    interval: Math.max(1, Math.min(1000, +(parts.INTERVAL ?? 1) || 1)),
    count: parts.COUNT ? Math.max(1, +parts.COUNT || 1) : undefined,
    until: parts.UNTIL ? parseTime(parts.UNTIL) ?? undefined : undefined,
    byDay: byDay?.length ? byDay : undefined,
    byMonthDay: nums(parts.BYMONTHDAY, 31),
    byMonth: nums(parts.BYMONTH, 12)?.filter((n) => n >= 1),
    byWeekNo: nums(parts.BYWEEKNO, 53),
    byYearDay: nums(parts.BYYEARDAY, 366),
    bySetPos: nums(parts.BYSETPOS, 366),
    wkst: Math.max(0, WEEKDAYS.indexOf(String(parts.WKST ?? 'MO').toUpperCase())),
  };
}

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
export const weekday = (wall: number) => new Date(wall).getUTCDay();
const monthOf = (wall: number) => new Date(wall).getUTCMonth() + 1;
const dayOfMonth = (wall: number) => new Date(wall).getUTCDate();
const yearLength = (y: number) => (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY;
/** A position counted from the start (1) or the end (-1), as a 1-based position in a list of `n`. */
const fromEnd = (x: number, n: number) => (x > 0 ? x : n + x + 1);

/**
 * The days of `list` (wall ms at midnight, in order) that BYDAY picks. With ordinals, "2TU" is the second Tuesday of the
 * list and "-1FR" its last Friday (the list is a month or a year); without, every such weekday.
 */
function byDayIn(list: number[], byDay: { n: number; wd: number }[], ordinals = true) {
  const per: number[][] = [[], [], [], [], [], [], []];
  for (const d of list) per[weekday(d)].push(d);
  return list.filter((d) => {
    const same = per[weekday(d)];
    return byDay.some((b) => b.wd === weekday(d) && (!ordinals || b.n === 0 || same[fromEnd(b.n, same.length) - 1] === d));
  });
}
/** Where week 1 of a year starts: the first week (from WKST) with at least four of its days in that year. */
function weekOneStart(y: number, wkst: number) {
  const jan1 = Date.UTC(y, 0, 1);
  const off = (weekday(jan1) - wkst + 7) % 7;
  return off <= 3 ? jan1 - off * DAY : jan1 + (7 - off) * DAY;
}
/** A day's week number (in the year its week belongs to, which can be the year before or after) and that year's weeks. */
function weekNumber(d: number, wkst: number) {
  const y = new Date(d).getUTCFullYear();
  let wy = y;
  if (d < weekOneStart(y, wkst)) wy = y - 1;
  else if (d >= weekOneStart(y + 1, wkst)) wy = y + 1;
  const s = weekOneStart(wy, wkst);
  return { no: Math.floor((d - s) / (7 * DAY)) + 1, weeks: (weekOneStart(wy + 1, wkst) - s) / (7 * DAY) };
}
const inMonthDays = (d: number, list: number[]) => list.some((x) => fromEnd(x, daysInMonth(new Date(d).getUTCFullYear(), monthOf(d))) === dayOfMonth(d));
const inYearDays = (d: number, list: number[]) => {
  const y = new Date(d).getUTCFullYear();
  const doy = (d - Date.UTC(y, 0, 1)) / DAY + 1;
  return list.some((x) => fromEnd(x, yearLength(y)) === doy);
};
const inWeeks = (d: number, list: number[], wkst: number) => {
  const w = weekNumber(d, wkst);
  return list.some((x) => fromEnd(x, w.weeks) === w.no);
};

/** Days (wall ms at midnight) of one month that the rule picks, before BYSETPOS. */
function monthDays(y: number, m: number, r: RRule, dflt: number): number[] {
  const n = daysInMonth(y, m);
  const all = Array.from({ length: n }, (_, i) => Date.UTC(y, m - 1, i + 1));
  if (!r.byMonthDay && !r.byDay && !r.byYearDay) return dflt <= n ? [Date.UTC(y, m - 1, dflt)] : []; // 30 February doesn't happen
  let days = all;
  if (r.byMonthDay) days = days.filter((d) => inMonthDays(d, r.byMonthDay!));
  if (r.byYearDay) days = days.filter((d) => inYearDays(d, r.byYearDay!));
  if (r.byDay) {
    const picked = new Set(byDayIn(all, r.byDay)); // ordinals count within the month
    days = days.filter((d) => picked.has(d));
  }
  return days;
}

/**
 * Days (wall ms at midnight) of one year that a YEARLY rule picks, before BYSETPOS (RFC 5545, 3.3.10): BYMONTH,
 * BYWEEKNO, BYYEARDAY and BYMONTHDAY narrow the year's days; BYDAY then picks weekdays, its ordinals counted within
 * each month when BYMONTH is there, within the year when nothing else is, and ignored next to BYWEEKNO, BYYEARDAY or
 * BYMONTHDAY. With none of them, DTSTART's month and day (in BYMONTH's months when given).
 */
function yearDays(y: number, r: RRule, start: ICalTime): number[] {
  if (!r.byWeekNo && !r.byYearDay && !r.byMonthDay && !r.byDay) {
    return (r.byMonth ?? [start.m]).filter((m) => start.d <= daysInMonth(y, m)).map((m) => Date.UTC(y, m - 1, start.d));
  }
  const first = Date.UTC(y, 0, 1);
  const all = Array.from({ length: yearLength(y) }, (_, k) => first + k * DAY);
  let days = all;
  if (r.byMonth) days = days.filter((d) => r.byMonth!.includes(monthOf(d)));
  if (r.byWeekNo) days = days.filter((d) => inWeeks(d, r.byWeekNo!, r.wkst));
  if (r.byYearDay) days = days.filter((d) => inYearDays(d, r.byYearDay!));
  if (r.byMonthDay) days = days.filter((d) => inMonthDays(d, r.byMonthDay!));
  if (r.byDay) {
    let picked: Set<number>;
    if (r.byWeekNo || r.byYearDay || r.byMonthDay) picked = new Set(byDayIn(days, r.byDay, false));
    else if (r.byMonth) picked = new Set(r.byMonth.flatMap((m) => byDayIn(all.filter((d) => monthOf(d) === m), r.byDay!)));
    else picked = new Set(byDayIn(all, r.byDay));
    days = days.filter((d) => picked.has(d));
  }
  return days;
}
const setPos = (list: number[], pos?: number[]) => (pos ? [...new Set(pos.map((p) => list[fromEnd(p, list.length) - 1]).filter((x) => x !== undefined))].sort((a, b) => a - b) : list);

/**
 * Starts (wall ms) of a rule's occurrences between `from` and `to` (wall ms). DTSTART always counts as the first one
 * (RFC 5545, 3.3.10), and COUNT is honoured from it. At most `limit` are returned; loops are capped so a hostile rule
 * can't spin.
 */
export function wallOccurrences(start: ICalTime, r: RRule, from: number, to: number, untilWall?: number, limit = Infinity): number[] {
  const s0 = wallOf(start);
  const time = s0 - Date.UTC(start.y, start.m - 1, start.d);
  const out: number[] = [];
  let count = 0;
  const end = untilWall ?? (r.until ? wallOf(r.until) + (r.until.date ? DAY - 1 : 0) : Infinity);
  const take = (t: number) => {
    if (t < s0) return true;
    if (t > end || (r.count && count >= r.count) || out.length >= limit) return false;
    count++;
    if (t >= from && t <= to) out.push(t);
    return t <= to || !Number.isFinite(to) ? true : false;
  };
  if (!take(s0)) return out;
  const pick = (days: number[]) => {
    for (const d of days) {
      const t = d + time;
      if (t === s0) continue;
      if (!take(t)) return false;
    }
    return true;
  };
  const inMonth = (t: number) => !r.byMonth || r.byMonth.includes(monthOf(t));
  for (let i = 1, guard = 0; guard < 200_000; i++, guard++) {
    let days: number[] = [];
    let periodStart: number;
    if (r.freq === 'DAILY') {
      const d = Date.UTC(start.y, start.m - 1, start.d) + (i - 1) * r.interval * DAY;
      periodStart = d;
      // Every BY part only narrows a daily rule (BYDAY's ordinals mean nothing here).
      if (inMonth(d) && (!r.byMonthDay || inMonthDays(d, r.byMonthDay)) && (!r.byYearDay || inYearDays(d, r.byYearDay)) && (!r.byDay || r.byDay.some((b) => b.wd === weekday(d)))) days = setPos([d], r.bySetPos);
    } else if (r.freq === 'WEEKLY') {
      const first = Date.UTC(start.y, start.m - 1, start.d);
      const weekStart = first - ((weekday(first) - r.wkst + 7) % 7) * DAY + (i - 1) * r.interval * 7 * DAY;
      periodStart = weekStart;
      const wds = r.byDay ? r.byDay.map((b) => b.wd) : [weekday(first)];
      days = Array.from({ length: 7 }, (_, k) => weekStart + k * DAY).filter((d) => wds.includes(weekday(d)) && inMonth(d));
      days = setPos(days, r.bySetPos);
    } else if (r.freq === 'MONTHLY') {
      const mIdx = start.m - 1 + (i - 1) * r.interval;
      const y = start.y + Math.floor(mIdx / 12);
      const m = (mIdx % 12) + 1;
      periodStart = Date.UTC(y, m - 1, 1);
      days = inMonth(periodStart) ? setPos(monthDays(y, m, r, start.d), r.bySetPos) : [];
    } else {
      const y = start.y + (i - 1) * r.interval;
      periodStart = Date.UTC(y, 0, 1);
      days = setPos(yearDays(y, r, start), r.bySetPos);
    }
    if (periodStart > to + 32 * DAY || periodStart > end) break;
    if (!pick(days)) break;
  }
  return out;
}

/* ---------- a series: its dates between two instants ---------- */

/**
 * A repeating event's times: its first start and end (ISO), the rule, extra and skipped dates, and changed dates. The
 * shape of an invite (server/ics.ts IcsEvent) and of sprint2go's own repeating events (src/repeat.ts).
 */
export interface SeriesTimes {
  start: string;
  end: string;
  rrule?: string; // e.g. FREQ=WEEKLY;BYDAY=MO
  rdates?: string[]; // ISO starts of extra occurrences
  exdates?: string[]; // ISO starts of skipped occurrences, or a date ("2026-10-28") that skips that day in the zone
  overrides?: { recurrenceId: string; start: string; end: string; cancelled?: boolean }[]; // changed dates: original start, new times
  tz?: string; // the zone whose wall clock the repeats keep (IANA)
  allDay?: boolean; // dates at noon UTC (an invite's all-day event): read without a zone
}
const iso = (t: number) => new Date(t).toISOString();

/**
 * The occurrences of a series (an invite, or one of our own repeating events) between two instants (at most `max`),
 * keeping the wall-clock time of its zone across daylight saving, with skipped dates left out and moved ones moved.
 * Null when the repeat isn't one calendars use for events (hourly and finer): the caller keeps only the first one.
 */
export function occurrences(ev: SeriesTimes, from: number, until: number, max = 60): { start: string; end: string; recurrenceId?: string }[] | null {
  const start = Date.parse(ev.start);
  const len = Date.parse(ev.end) - start;
  if (!ev.rrule && !ev.rdates?.length) return start + len >= from && start <= until ? [{ start: ev.start, end: ev.end }] : [];
  const r = ev.rrule ? parseRRule(ev.rrule) : { freq: 'DAILY' as const, interval: 1, count: 1, wkst: 1 }; // RDATE alone: the first date, plus those
  if (!r) return null;
  const zone = ev.allDay || !ev.tz || !isZone(ev.tz) ? null : ev.tz;
  const w0 = wallFromUtc(start, zone);
  const d0 = new Date(w0);
  const first: ICalTime = { y: d0.getUTCFullYear(), m: d0.getUTCMonth() + 1, d: d0.getUTCDate(), h: d0.getUTCHours(), mi: d0.getUTCMinutes(), s: d0.getUTCSeconds(), date: false, utc: false };
  let untilWall: number | undefined;
  if (r.until) untilWall = r.until.date ? wallOf(r.until) + DAY - 1 : r.until.utc ? wallFromUtc(wallOf(r.until), zone) : wallOf(r.until);
  const skip = new Set((ev.exdates ?? []).filter((x) => x.length > 10).map((x) => Date.parse(x)));
  const skipDays = new Set((ev.exdates ?? []).filter((x) => x.length === 10)); // a whole day, in the event's own zone
  const moved = new Map((ev.overrides ?? []).map((o) => [Date.parse(o.recurrenceId), o]));
  const wFrom = Number.isFinite(from) ? wallFromUtc(from, zone) - len - DAY : -Infinity;
  const wTo = Number.isFinite(until) ? wallFromUtc(until, zone) + DAY : Infinity;
  const walls = wallOccurrences(first, r, wFrom, wTo, untilWall, max + skip.size + skipDays.size + moved.size);
  // RDATE: extra dates on top of the rule (each already an instant, whatever zone it was written in).
  for (const x of ev.rdates ?? []) {
    const w = wallFromUtc(Date.parse(x), zone);
    if (Number.isFinite(w) && w >= wFrom && w <= wTo && !walls.includes(w)) walls.push(w);
  }
  walls.sort((a, b) => a - b);
  const out: { start: string; end: string; recurrenceId?: string }[] = [];
  for (const w of walls) {
    const at = utcFromWall(w, zone);
    if (skip.has(at) || skipDays.has(floating(w).slice(0, 10))) continue;
    const o = moved.get(at);
    if (o?.cancelled) continue;
    const s = o ? Date.parse(o.start) : at;
    const e = o ? Date.parse(o.end) : at + len;
    if (e >= from && s <= until) out.push({ start: iso(s), end: iso(e), recurrenceId: iso(at) });
    // (A date moved past the end doesn't stop the ones after it.)
    if ((at > until && !o) || out.length >= max) break;
  }
  return out;
}
