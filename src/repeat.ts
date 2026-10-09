// sprint2go's own repeating events. One event holds the whole series: the repeat (`rrule`, RFC 5545), the dates left out
// (`exdates`) and the dates changed on their own (`overrides`). Every view draws the dates for the range on screen
// (expandEvents); each date is an event of its own with an id that says which date it is (`<series id>~<date>`).
// Changing one date asks This event, This and following, or All events: changeSeries, answerSeries and removeFromSeries
// make those changes, splitting the series in two for "This and following". The dates come from src/recurrence.ts,
// the same rules that read invites and calendar links, on the clock of the event's own time zone, so a 9:00 meeting in
// London stays at 9:00 across daylight saving.

import type { CalEvent, EventOverride, RsvpStatus } from './types';
import { DAY, floating, isZone, occurrences, pad, parseRRule, utcFromWall, wallFromUtc, wallOccurrences, WEEKDAYS, type ICalTime, type SeriesTimes } from './recurrence';

/* ---------- the clock of a series ---------- */

const ZONED = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
/** A time with no zone ("2026-10-20T00:00:00"): an invite's all-day dates, the same date wherever you are. */
export const isFloating = (s: string) => !ZONED.test(s);
/** Floating times read as if UTC, for date arithmetic on the wall clock. */
const asUtc = (s: string) => (isFloating(s) ? `${s.length === 10 ? `${s}T00:00:00` : s}Z` : s);
/** A time as milliseconds: real ones as the instant, floating ones as their wall clock. */
export const msOf = (s: string) => Date.parse(asUtc(s));
const sameTime = (a: string, b: string) => msOf(a) === msOf(b);

/** How a series reads its times: its zone (null for floating dates, or a series without one: UTC). */
export interface Clock {
  floating: boolean;
  tz: string | null;
  /** A time as wall-clock ms in the series' zone. */
  wall: (s: string) => number;
  /** Wall-clock ms back to a time written the way the series writes them. */
  iso: (wall: number) => string;
}
export function clockOf(e: Pick<CalEvent, 'start' | 'timeZone'>): Clock {
  const fl = isFloating(e.start);
  const tz = !fl && e.timeZone && isZone(e.timeZone) ? e.timeZone : null;
  return {
    floating: fl,
    tz,
    wall: (s) => (fl ? msOf(s) : wallFromUtc(Date.parse(s), tz)),
    iso: (w) => (fl ? floating(w) : new Date(utcFromWall(w, tz)).toISOString()),
  };
}
/** A moment written the way a series writes its times: a floating series (an invite's all-day dates) on this device's clock. */
export const timeLike = (series: Pick<CalEvent, 'start'>, d: Date) =>
  isFloating(series.start) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00` : d.toISOString();

/** How long a date of the series is on the clock (an all-day date stays a day when the clocks change). */
const wallLen = (e: Pick<CalEvent, 'start' | 'end' | 'timeZone'>) => {
  const c = clockOf(e);
  return c.wall(e.end) - c.wall(e.start);
};
/** Where a date starting at `s` ends: as long on the clock as the series' own first date (or `len`). */
const endAt = (e: Pick<CalEvent, 'start' | 'end' | 'timeZone'>, s: string, len = wallLen(e)) => {
  const c = clockOf(e);
  return c.iso(c.wall(s) + len);
};

/** The series in the shape the repeat rules read (floating times as UTC wall clock). */
function seriesTimes(e: CalEvent): SeriesTimes {
  const fl = isFloating(e.start);
  const c = (s: string) => (fl ? asUtc(s) : s);
  return {
    start: c(e.start),
    end: c(e.end),
    rrule: e.rrule,
    tz: clockOf(e).tz ?? undefined,
    rdates: e.rdates?.map(c),
    exdates: e.exdates?.map((x) => (x.length === 10 ? x : c(x))),
    overrides: e.overrides?.filter((o) => o.start && o.end).map((o) => ({ recurrenceId: c(o.occurrence), start: c(o.start!), end: c(o.end ?? endAt(e, o.start!)) })),
  };
}

/* ---------- ids: one date of a series ---------- */

/** "20261012T080000Z": the part of an occurrence's id that says which date it is. */
const keyOf = (s: string) => s.replace(/\.\d+/, '').replace(/[-:]/g, '');
/** The id of one date of a series. */
export const occId = (seriesId: string, occurrence: string) => `${seriesId}~${keyOf(occurrence)}`;
/** The series and date an occurrence's id names, or null for any other id. */
export function parseOccId(id: string): { seriesId: string; occurrence: string } | null {
  const i = id.lastIndexOf('~');
  if (i <= 0) return null;
  const m = id.slice(i + 1).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  return m ? { seriesId: id.slice(0, i), occurrence: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? '.000Z' : ''}` } : null;
}

/* ---------- drawing the dates ---------- */

/** The fields one date can have of its own (besides its times and answers). */
export const OVERRIDABLE = ['title', 'calendarId', 'location', 'meetUrl', 'notes', 'guests', 'remind'] as const;

export const overrideOf = (e: CalEvent, occurrence: string) => e.overrides?.find((o) => sameTime(o.occurrence, occurrence));

/** My answer for one date of an invite: its own, else the "this and following" answer that covers it, else the series'. */
function rsvpAt(e: CalEvent, occurrence: string, o?: EventOverride): RsvpStatus | undefined {
  if (o?.rsvp) return o.rsvp;
  const at = msOf(occurrence);
  const from = (e.rsvpFrom ?? []).filter((r) => msOf(r.from) <= at).sort((a, b) => msOf(b.from) - msOf(a.from))[0];
  return from?.rsvp ?? e.rsvp;
}

/** One date of a series as an event of its own: the series' fields, that date's changes, its own id. */
export function occurrenceOf(e: CalEvent, occurrence: string, start?: string, end?: string): CalEvent {
  const o = overrideOf(e, occurrence);
  const s = start ?? o?.start ?? occurrence;
  const en = end ?? o?.end ?? endAt(e, s);
  const { overrides: _o, exdates: _x, rdates: _r, rsvpFrom: _f, remindedFor: _m, rsvp: _a, answersFrom: _af, ...base } = e;
  const occ: CalEvent = { ...base, id: occId(e.id, occurrence), seriesId: e.id, occurrence, start: s, end: en };
  if (o) for (const k of OVERRIDABLE) if (k in o) (occ as unknown as Record<string, unknown>)[k] = o[k] ?? undefined;
  // Guests' answers: for the series, then "this and following" ones up to this date, then this date's own.
  const from = (e.answersFrom ?? []).filter((x) => msOf(x.from) <= msOf(occurrence)).sort((a, b) => msOf(a.from) - msOf(b.from));
  if (from.length || o?.answers) occ.answers = { ...e.answers, ...Object.fromEntries(from.map((x) => [x.email, x.status])), ...o?.answers };
  const rsvp = rsvpAt(e, occurrence, o);
  if (rsvp) occ.rsvp = rsvp;
  return occ;
}

/** Whether `occurrence` (an original start) is one of the series' dates, and not left out. */
export function isDateOf(e: CalEvent, occurrence: string): boolean {
  if (!e.rrule) return sameTime(e.start, occurrence);
  const at = msOf(occurrence);
  const list = occurrences({ ...seriesTimes(e), overrides: undefined }, at, at, 4);
  return !!list?.some((x) => Date.parse(x.recurrenceId ?? x.start) === at);
}

/**
 * The dates of a series that touch [from, to] (ms), as events: changed dates changed, left-out dates left out, and dates
 * of an invite I said no to left off (as an invite I declined is). At most `max`.
 */
export function expandSeries(e: CalEvent, from: number, to: number, max = 1500): CalEvent[] {
  const fl = isFloating(e.start);
  // Floating dates fall on a day wherever you are: a day's margin on each side, the views place them.
  const f = fl ? from - DAY : from;
  const t = fl ? to + DAY : to;
  const st = seriesTimes(e);
  const back = (s: string) => (fl ? floating(Date.parse(s)) : new Date(Date.parse(s)).toISOString());
  const list: { occ: string; start: string; end?: string }[] = (occurrences(st, f, t, max) ?? (Date.parse(st.end) >= f && Date.parse(st.start) <= t ? [{ start: st.start, end: st.end, recurrenceId: st.start }] : [])).map((x) => {
    const occ = back(x.recurrenceId ?? x.start);
    // A moved date keeps its own end; the others are as long on the clock as the first (a day stays a day).
    return { occ, start: back(x.start), end: overrideOf(e, occ)?.end };
  });
  // A date moved into the range from further away than the rules look.
  for (const o of e.overrides ?? []) {
    if (!o.start || !o.end || msOf(o.end) < f || msOf(o.start) > t) continue;
    if (list.some((x) => sameTime(x.occ, o.occurrence)) || !isDateOf(e, o.occurrence)) continue;
    list.push({ occ: o.occurrence, start: o.start, end: o.end });
  }
  return list
    .sort((a, b) => msOf(a.start) - msOf(b.start))
    .map((x) => occurrenceOf(e, x.occ, x.start, x.end))
    .filter((x) => !(x.inviteUid && x.rsvp === 'declined'));
}

/** Every event for [from, to] (ms): repeating ones as their dates in that range, the rest as they are. */
export function expandEvents(events: CalEvent[], from: number, to: number): CalEvent[] {
  if (!events.some((e) => e.rrule)) return events;
  return events.flatMap((e) => (e.rrule ? expandSeries(e, from, to) : [e]));
}

/** An event by id: a stored one, or one date of a repeating one (the id says which). Null when it's gone. */
export function findEvent(events: CalEvent[], id: string | null | undefined): CalEvent | null {
  if (!id) return null;
  const hit = events.find((e) => e.id === id);
  // A series by its own id: its first date.
  if (hit) return hit.rrule && !hit.seriesId ? occurrenceOf(hit, hit.start) : hit;
  const p = parseOccId(id);
  const s = p && events.find((e) => e.id === p.seriesId && e.rrule);
  if (!p || !s) return null;
  const occurrence = isFloating(s.start) ? floating(msOf(p.occurrence)) : p.occurrence;
  return isDateOf(s, occurrence) ? occurrenceOf(s, occurrence) : null;
}

/** Whether there's any date left in a series (all of them left out, or a finished one cut to nothing: none). */
export function hasDates(e: CalEvent) {
  return (occurrences(seriesTimes(e), -Infinity, Infinity, 1) ?? [1]).length > 0;
}

/* ---------- the rule, in words and as choices ---------- */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
/** A repeat as the picker shows it. Everything else (rare rules from invites) is kept as written and shown in words. */
export interface RepeatSpec {
  freq: Freq;
  interval: number; // every n days, weeks, months or years
  days?: number[]; // WEEKLY: weekdays, 0 Sunday to 6 Saturday
  monthly?: 'date' | 'nth' | 'last' | 'lastWeekday'; // the 12th, the 2nd Tuesday, the last day, the last Tuesday
  until?: string; // the last day it may happen, YYYY-MM-DD in the event's zone
  count?: number; // or this many times
}

/** What a date is, on the wall clock: its weekday, day, month, which of its weekday in the month, the last week or day. */
export function dateFacts(wall: number) {
  const d = new Date(wall);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, day, wd: d.getUTCDay(), nth: Math.ceil(day / 7), lastWeek: day + 7 > len, lastDay: day === len };
}

const ruleParts = (r: string) =>
  r
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((p) => p.includes('='))
    .map((p) => [p.slice(0, p.indexOf('=')).trim().toUpperCase(), p.slice(p.indexOf('=') + 1).trim()] as [string, string]);
/** The rule with one part set (or taken out when `value` is undefined). */
export function withPart(rule: string, key: string, value?: string) {
  const parts = ruleParts(rule).filter(([k]) => k !== key);
  if (value !== undefined) parts.push([key, value]);
  return parts.map(([k, v]) => `${k}=${v}`).join(';');
}
const partOf = (rule: string, key: string) => ruleParts(rule).find(([k]) => k === key)?.[1];
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dayStr = (wall: number) => floating(wall).slice(0, 10);

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
/** A spec as a rule for a series starting at `startWall` (wall ms in `clock`'s zone). */
export function specToRule(spec: RepeatSpec, startWall: number, clock: Pick<Clock, 'floating' | 'tz'>): string {
  const f = dateFacts(startWall);
  const parts = [`FREQ=${spec.freq}`];
  if (spec.interval > 1) parts.push(`INTERVAL=${Math.min(999, Math.round(spec.interval))}`);
  if (spec.freq === 'WEEKLY') {
    const days = spec.days?.length ? [...new Set(spec.days)] : [f.wd];
    parts.push(`BYDAY=${MONDAY_FIRST.filter((d) => days.includes(d)).map((d) => WEEKDAYS[d]).join(',')}`);
  } else if (spec.freq === 'MONTHLY') {
    const mode = spec.monthly ?? 'date';
    if (mode === 'date') parts.push(`BYMONTHDAY=${f.day}`);
    else if (mode === 'last') parts.push('BYMONTHDAY=-1');
    else if (mode === 'nth') parts.push(`BYDAY=${Math.min(5, f.nth)}${WEEKDAYS[f.wd]}`);
    else parts.push(`BYDAY=-1${WEEKDAYS[f.wd]}`);
  } else if (spec.freq === 'YEARLY') parts.push(`BYMONTH=${f.m}`, `BYMONTHDAY=${f.day}`);
  if (spec.count && spec.count > 0) parts.push(`COUNT=${Math.min(999, Math.round(spec.count))}`);
  else if (spec.until && /^\d{4}-\d{2}-\d{2}$/.test(spec.until)) {
    const [y, m, d] = spec.until.split('-').map(Number);
    // The whole last day counts. With a zone, UNTIL is in UTC (RFC 5545); floating dates use a date.
    parts.push(`UNTIL=${clock.floating ? spec.until.replace(/-/g, '') : stamp(utcFromWall(Date.UTC(y, m - 1, d, 23, 59, 59), clock.tz))}`);
  }
  return parts.join(';');
}

/** The picker's view of a rule for a series starting at `startWall`, or null when the picker can't show it (kept as is). */
export function ruleToSpec(rrule: string | undefined, startWall: number, clock: Pick<Clock, 'tz'>): RepeatSpec | null {
  const r = rrule ? parseRRule(rrule) : null;
  if (!r || r.byWeekNo || r.byYearDay || r.bySetPos || /BY(HOUR|MINUTE|SECOND)=/i.test(rrule!)) return null;
  const f = dateFacts(startWall);
  const spec: RepeatSpec = { freq: r.freq, interval: r.interval };
  if (r.count) spec.count = r.count;
  else if (r.until) spec.until = r.until.date || !r.until.utc ? `${r.until.y}-${pad(r.until.m)}-${pad(r.until.d)}` : dayStr(wallFromUtc(Date.UTC(r.until.y, r.until.m - 1, r.until.d, r.until.h, r.until.mi, r.until.s), clock.tz));
  if (r.freq === 'DAILY') return r.byDay || r.byMonthDay || r.byMonth ? null : spec;
  if (r.freq === 'WEEKLY') {
    if (r.byMonthDay || r.byMonth || r.byDay?.some((b) => b.n)) return null;
    spec.days = r.byDay ? [...new Set(r.byDay.map((b) => b.wd))] : [f.wd];
    return spec;
  }
  if (r.freq === 'MONTHLY') {
    if (r.byMonth || (r.byDay && r.byMonthDay)) return null;
    if (r.byMonthDay) {
      if (r.byMonthDay.length !== 1) return null;
      if (r.byMonthDay[0] === -1) spec.monthly = 'last';
      else if (r.byMonthDay[0] === f.day) spec.monthly = 'date';
      else return null;
    } else if (r.byDay) {
      const b = r.byDay[0];
      if (r.byDay.length !== 1 || b.wd !== f.wd) return null;
      if (b.n === -1 && f.lastWeek) spec.monthly = 'lastWeekday';
      else if (b.n === f.nth) spec.monthly = 'nth';
      else return null;
    } else spec.monthly = 'date';
    return spec;
  }
  if (r.byDay || (r.byMonth && (r.byMonth.length !== 1 || r.byMonth[0] !== f.m)) || (r.byMonthDay && (r.byMonthDay.length !== 1 || r.byMonthDay[0] !== f.day))) return null;
  return spec;
}

/** The repeats the picker offers by name; anything else is Custom. */
export type RepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly-date' | 'monthly-nth' | 'monthly-last' | 'monthly-lastWeekday' | 'yearly' | 'custom';
export function presetOf(spec: RepeatSpec | null): RepeatPreset {
  if (!spec) return 'none';
  if (spec.count || spec.until) return 'custom';
  const one = spec.interval === 1;
  if (spec.freq === 'DAILY') return one ? 'daily' : 'custom';
  if (spec.freq === 'WEEKLY') {
    const days = [...(spec.days ?? [])].sort().join();
    if (one && days === '1,2,3,4,5') return 'weekdays';
    return one ? 'weekly' : spec.interval === 2 ? 'biweekly' : 'custom';
  }
  if (spec.freq === 'MONTHLY') return one ? (`monthly-${spec.monthly ?? 'date'}` as RepeatPreset) : 'custom';
  return one ? 'yearly' : 'custom';
}
/** A preset as a spec, for a series starting at `startWall`. */
export function presetSpec(p: RepeatPreset, startWall: number, days?: number[]): RepeatSpec | null {
  const wd = dateFacts(startWall).wd;
  switch (p) {
    case 'daily':
      return { freq: 'DAILY', interval: 1 };
    case 'weekdays':
      return { freq: 'WEEKLY', interval: 1, days: [1, 2, 3, 4, 5] };
    case 'weekly':
      return { freq: 'WEEKLY', interval: 1, days: days?.length ? days : [wd] };
    case 'biweekly':
      return { freq: 'WEEKLY', interval: 2, days: days?.length ? days : [wd] };
    case 'monthly-date':
    case 'monthly-nth':
    case 'monthly-last':
    case 'monthly-lastWeekday':
      return { freq: 'MONTHLY', interval: 1, monthly: p.slice(8) as RepeatSpec['monthly'] };
    case 'yearly':
      return { freq: 'YEARLY', interval: 1 };
    default:
      return null;
  }
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const every = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);

/** "on the 2nd Tuesday", "on the 12th", "on the last day": where a monthly repeat falls. */
export function monthlyWords(mode: RepeatSpec['monthly'], startWall: number) {
  const f = dateFacts(startWall);
  if (mode === 'last') return 'on the last day';
  if (mode === 'nth') return `on the ${ordinal(Math.min(5, f.nth))} ${DAY_NAMES[f.wd]}`;
  if (mode === 'lastWeekday') return `on the last ${DAY_NAMES[f.wd]}`;
  return `on the ${ordinal(f.day)}`;
}

/** A repeat in plain words: "Every week on Monday and Wednesday", "Every month on the 2nd Tuesday, until 31 Dec 2026". */
export function specWords(spec: RepeatSpec, startWall: number, ends = true): string {
  const f = dateFacts(startWall);
  let s: string;
  if (spec.freq === 'DAILY') s = every(spec.interval, 'day');
  else if (spec.freq === 'WEEKLY') {
    const days = MONDAY_FIRST.filter((d) => (spec.days?.length ? spec.days : [f.wd]).includes(d));
    s = spec.interval === 1 && days.join() === '1,2,3,4,5' ? 'Every weekday' : spec.interval === 1 && days.length === 7 ? 'Every day' : `${every(spec.interval, 'week')} on ${list(days.map((d) => DAY_NAMES[d]))}`;
  } else if (spec.freq === 'MONTHLY') s = `${every(spec.interval, 'month')} ${monthlyWords(spec.monthly, startWall)}`;
  else s = `${every(spec.interval, 'year')} on ${f.day} ${MONTH_NAMES[f.m - 1]}`;
  if (ends && spec.count) s += spec.count === 1 ? ', once' : `, ${spec.count} times`;
  else if (ends && spec.until) {
    const [y, m, d] = spec.until.split('-').map(Number);
    s += `, until ${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
  }
  return s;
}

/** How an event repeats, in words ("Every weekday"), or null when it doesn't. */
export function repeatWords(e: Pick<CalEvent, 'rrule' | 'start' | 'timeZone'>): string | null {
  if (!e.rrule) return null;
  const clock = clockOf(e);
  const spec = ruleToSpec(e.rrule, clock.wall(e.start), clock);
  if (spec) return specWords(spec, clock.wall(e.start));
  const r = parseRRule(e.rrule);
  return r ? `Repeats ${{ DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[r.freq]}` : 'Repeats';
}

/**
 * The rule moved with its date (a date dragged from Monday to Tuesday, "All events"): weekly days shift with it, a
 * monthly or yearly date follows it. Rules the picker can't show stay as written.
 */
export function rebaseRule(rrule: string, fromWall: number, toWall: number, clock: Pick<Clock, 'floating' | 'tz'>): string {
  const shift = Math.round((Math.floor(toWall / DAY) * DAY - Math.floor(fromWall / DAY) * DAY) / DAY);
  if (!shift) return rrule;
  const spec = ruleToSpec(rrule, fromWall, clock);
  if (!spec) return rrule;
  const to = dateFacts(toWall);
  if (spec.freq === 'WEEKLY') spec.days = [...new Set((spec.days ?? []).map((d) => (((d + shift) % 7) + 7) % 7))];
  if (spec.freq === 'MONTHLY') {
    if (spec.monthly === 'last' && !to.lastDay) spec.monthly = 'date';
    else if (spec.monthly === 'nth' && to.nth === 5) spec.monthly = 'lastWeekday';
    else if (spec.monthly === 'lastWeekday' && !to.lastWeek) spec.monthly = 'nth';
  }
  // The end stays exactly as it was written.
  const rule = specToRule({ ...spec, until: undefined, count: undefined }, toWall, clock);
  const until = partOf(rrule, 'UNTIL');
  const count = partOf(rrule, 'COUNT');
  return count ? withPart(rule, 'COUNT', count) : until ? withPart(rule, 'UNTIL', until) : rule;
}

/**
 * Where a series with a new rule starts: the first date of the rule on or after `notBefore`, keeping the rhythm the rule
 * has around `anchor` (a date the person picked it on, so "every 2 weeks" stays on that date's weeks). `anchor` when
 * nothing comes earlier and it's a date of the rule.
 */
export function alignStart(rrule: string, anchor: number, notBefore: number): number {
  const r = parseRRule(rrule);
  if (!r || notBefore > anchor) return anchor;
  const a = new Date(anchor);
  const hms = [a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds()] as const;
  let back: number;
  if (r.freq === 'DAILY' || r.freq === 'WEEKLY') {
    const period = r.interval * (r.freq === 'DAILY' ? 1 : 7) * DAY;
    back = anchor - (Math.ceil((anchor - notBefore) / period) + 1) * period;
  } else {
    const months = r.freq === 'MONTHLY' ? r.interval : 12 * r.interval;
    const n = new Date(notBefore);
    const gap = (a.getUTCFullYear() - n.getUTCFullYear()) * 12 + a.getUTCMonth() - n.getUTCMonth();
    const k = (Math.ceil(gap / months) + 1) * months;
    // The day comes from the rule's parts; a plain monthly or yearly rule keeps the anchor's day.
    const plain = !r.byDay && !r.byMonthDay && !r.byYearDay && !r.byWeekNo;
    back = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - k, plain ? Math.min(a.getUTCDate(), 28) : 1, ...hms);
  }
  const b = new Date(back);
  const first: ICalTime = { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate(), h: hms[0], mi: hms[1], s: hms[2], date: false, utc: false };
  // (The anchor itself may not be a date of the rule: weekly on Monday and Wednesday, picked on a Friday. Then the next one.)
  const to = anchor + (r.freq === 'YEARLY' ? r.interval * 366 + 31 : 400) * DAY;
  return wallOccurrences(first, { ...r, count: undefined, until: undefined }, notBefore, to, undefined, 1)[0] ?? anchor;
}

/**
 * A new repeating event on its first date: a start that isn't a date of its rule (weekly on Monday and Wednesday, made
 * on a Friday) moves to the next one that is, keeping its length, so the Friday doesn't become an extra date.
 */
export function startOnRule<T extends Pick<CalEvent, 'start' | 'end' | 'rrule' | 'timeZone'>>(e: T): T {
  if (!e.rrule) return e;
  const c = clockOf(e);
  const w = c.wall(e.start);
  const first = alignStart(e.rrule, w, w);
  if (first === w) return e;
  return { ...e, start: c.iso(first), end: endAt(e, c.iso(first)) };
}

/* ---------- changing a series ---------- */

/** Which dates a change is for. */
export type Scope = 'one' | 'following' | 'all';
/** What a change does to the stored events. */
export interface SeriesChange {
  upserts: CalEvent[];
  deletes: string[];
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const same = (a: unknown, b: unknown) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
/** No undefined fields and no empty lists: what's stored stays tidy. */
function tidy(e: CalEvent): CalEvent {
  const out = { ...e } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined || (Array.isArray(out[k]) && !(out[k] as unknown[]).length && ['exdates', 'rdates', 'overrides', 'rsvpFrom', 'answersFrom'].includes(k))) delete out[k];
  return out as unknown as CalEvent;
}
const hasChanges = (o: EventOverride) => Object.keys(o).some((k) => k !== 'occurrence' && (o as unknown as Record<string, unknown>)[k] !== undefined);
const isFirst = (e: CalEvent, occurrence: string) => sameTime(e.start, occurrence);

/** Two rules for a series starting at `startWall` that repeat the same way (however they're written). */
export function sameRule(a: string | undefined, b: string | undefined, startWall: number, clock: Pick<Clock, 'tz'>): boolean {
  if ((a ?? '') === (b ?? '')) return true;
  if (!a || !b) return false;
  const x = ruleToSpec(a, startWall, clock);
  const y = ruleToSpec(b, startWall, clock);
  const norm = (s: RepeatSpec) => JSON.stringify({ ...s, days: s.days ? [...s.days].sort() : undefined });
  return !!x && !!y && norm(x) === norm(y);
}

/**
 * Whether a patch from the editor changes how the series repeats (then "This event" alone can't take it): all day,
 * another time zone, or another rule. `rrule` is only in the patch when the repeat was picked again (null: no repeat).
 */
export function changesRule(series: CalEvent, occurrence: string, patch: Partial<CalEvent>): boolean {
  const clock = clockOf(series);
  if (('allDay' in patch && !!patch.allDay !== !!series.allDay) || (patch.timeZone && clock.tz && patch.timeZone !== clock.tz)) return true;
  if (!('rrule' in patch) || patch.rrule === undefined) return false;
  if (!patch.rrule) return true;
  const cur = occurrenceOf(series, occurrence);
  const ns = patch.start ?? cur.start;
  const moved = !sameTime(ns, cur.start) ? rebaseRule(series.rrule!, clock.wall(occurrence), clock.wall(ns), clock) : series.rrule!;
  return !sameRule(patch.rrule, moved, clock.wall(ns), clock);
}

/** The dates of a series before `occurrence` (left-out ones too: COUNT counts them), for cutting a COUNT rule in two. */
function datesBefore(e: CalEvent, occurrence: string) {
  const st = { ...seriesTimes(e), exdates: undefined, overrides: undefined, rdates: undefined };
  const at = msOf(occurrence);
  return (occurrences(st, -Infinity, at - 1, 100_000) ?? []).filter((x) => Date.parse(x.recurrenceId ?? x.start) < at).length;
}

/** The series cut to end just before `occurrence`: its rule stops there, and later dates' changes go. Null when nothing's left. */
function endBefore(series: CalEvent, occurrence: string): CalEvent | null {
  const at = msOf(occurrence);
  const count = parseRRule(series.rrule!)?.count;
  const rule = count
    ? withPart(series.rrule!, 'COUNT', String(datesBefore(series, occurrence)))
    : withPart(withPart(series.rrule!, 'COUNT'), 'UNTIL', isFloating(series.start) ? dayStr(at - DAY).replace(/-/g, '') : stamp(at - 1000));
  const cut = tidy({
    ...series,
    rrule: rule,
    exdates: series.exdates?.filter((x) => msOf(x) < at),
    overrides: series.overrides?.filter((o) => msOf(o.occurrence) < at),
    rsvpFrom: series.rsvpFrom?.filter((r) => msOf(r.from) < at),
    answersFrom: series.answersFrom?.filter((r) => msOf(r.from) < at),
  });
  return hasDates(cut) ? cut : null;
}

/** The rest of a series from `occurrence` on, as a new series with its own id (the first half of a split is endBefore). */
function fromOn(series: CalEvent, occurrence: string, id: string): CalEvent {
  const at = msOf(occurrence);
  const count = parseRRule(series.rrule!)?.count;
  const o = overrideOf(series, occurrence);
  const { remindedFor: _r, invite: _i, ...rest } = series;
  return tidy({
    ...rest,
    id,
    start: occurrence,
    end: endAt(series, occurrence),
    rrule: count ? withPart(series.rrule!, 'COUNT', String(Math.max(1, count - datesBefore(series, occurrence)))) : series.rrule,
    exdates: series.exdates?.filter((x) => msOf(x) >= at),
    overrides: series.overrides?.filter((x) => msOf(x.occurrence) >= at),
    // An invite answered for some dates: the answer this date had is where the new part starts. The same for guests'
    // answers to one we sent (the new part goes out as a new invite, so they're only what was known).
    rsvp: rsvpAt(series, occurrence, o),
    rsvpFrom: series.rsvpFrom?.filter((r) => msOf(r.from) > at),
    answers: series.answers || series.answersFrom ? { ...series.answers, ...Object.fromEntries((series.answersFrom ?? []).filter((x) => msOf(x.from) <= at).sort((a, b) => msOf(a.from) - msOf(b.from)).map((x) => [x.email, x.status])) } : undefined,
    answersFrom: series.answersFrom?.filter((r) => msOf(r.from) > at),
  });
}

/**
 * Changes to one date of a series, for that date only, this and the following dates, or all of them. `patch` holds
 * the fields as they should be on that date (its start and end too); only what differs from the date as it was counts.
 * "This and following" splits the series: the first part ends the day before, a new series (id from `newId`) starts
 * on this date. A date moved with "All events" moves the whole series by the same amount on the clock.
 */
export function changeSeries(series: CalEvent, occurrence: string, patch: Partial<CalEvent>, scope: Scope, newId: () => string): SeriesChange {
  const cur = occurrenceOf(series, occurrence);
  const clock = clockOf(series);
  const ns = patch.start ?? cur.start;
  const ne = patch.end ?? cur.end;
  const timesChanged = !sameTime(ns, cur.start) || !sameTime(ne, cur.end);
  const changed = (k: keyof CalEvent) => k in patch && !same(patch[k], cur[k]);

  if (scope === 'one') {
    const o: EventOverride = { ...overrideOf(series, occurrence), occurrence: overrideOf(series, occurrence)?.occurrence ?? occurrence };
    if (timesChanged) {
      if (sameTime(ns, occurrence) && sameTime(ne, endAt(series, occurrence))) (delete o.start, delete o.end);
      else Object.assign(o, { start: ns, end: ne });
    }
    for (const k of OVERRIDABLE) {
      if (!changed(k)) continue;
      if (same(patch[k], series[k])) delete o[k];
      else (o as unknown as Record<string, unknown>)[k] = patch[k] ?? null;
    }
    const others = (series.overrides ?? []).filter((x) => !sameTime(x.occurrence, occurrence));
    return { upserts: [tidy({ ...series, overrides: hasChanges(o) ? [...others, o] : others })], deletes: [] };
  }

  if (scope === 'following' && !isFirst(series, occurrence)) {
    const head = endBefore(series, occurrence);
    const tail = fromOn(series, occurrence, newId());
    const next = changeSeries(tail, occurrence, patch, 'all', newId);
    return { upserts: [...(head ? [head] : []), ...next.upserts], deletes: [...(head ? [] : [series.id]), ...next.deletes] };
  }

  // All events (or "this and following" from the first date, which is the same).
  let next: CalEvent = { ...series };
  let overrides = [...(series.overrides ?? [])];
  let exdates = [...(series.exdates ?? [])];
  const ruleChange = changesRule(series, occurrence, patch);

  // No longer repeating: it becomes one event, on the date being changed.
  if (ruleChange && 'rrule' in patch && !patch.rrule) {
    const { rrule: _r, exdates: _x, overrides: _o, rdates: _d, rsvpFrom: _f, remindedFor: _m, ...single } = series;
    const one: CalEvent = { ...single, start: ns, end: ne };
    for (const k of [...OVERRIDABLE, 'allDay', 'timeZone', 'sendInvites'] as (keyof CalEvent)[]) if (k in patch) (one as unknown as Record<string, unknown>)[k] = patch[k];
    if (cur.rsvp) one.rsvp = cur.rsvp;
    return { upserts: [tidy(one)], deletes: [] };
  }

  if (timesChanged) {
    // Moved on the clock by as much as this date moved from where the repeat puts it.
    const delta = clock.wall(ns) - clock.wall(occurrence);
    const newLen = clock.wall(ne) - clock.wall(ns);
    next.start = clock.iso(clock.wall(series.start) + delta);
    next.end = endAt(next, next.start, newLen);
    overrides = overrides.map((o) => (sameTime(o.occurrence, occurrence) ? { ...o, start: undefined, end: undefined } : o));
    if (delta) {
      // Left-out and changed dates keep pointing at the same dates of the series.
      const days = Math.round(delta / DAY);
      exdates = exdates.map((x) => (x.length === 10 ? dayStr(msOf(x) + days * DAY) : clock.iso(clock.wall(x) + delta)));
      overrides = overrides.map((o) => ({ ...o, occurrence: clock.iso(clock.wall(o.occurrence) + delta) }));
      next.rrule = rebaseRule(series.rrule!, clock.wall(occurrence), clock.wall(ns), clock);
    }
  }
  if (ruleChange && patch.rrule) {
    // A new rule, picked on this date: the series starts on its first date from where it started before.
    next.rrule = patch.rrule;
    const newLen = wallLen(next);
    next.start = clock.iso(alignStart(patch.rrule, clock.wall(ns), clock.wall(next.start)));
    next.end = endAt(next, next.start, newLen);
  }
  for (const k of [...OVERRIDABLE, 'allDay', 'timeZone', 'sendInvites'] as const) {
    if (!changed(k)) continue;
    (next as unknown as Record<string, unknown>)[k] = patch[k];
    if ((OVERRIDABLE as readonly string[]).includes(k)) overrides = overrides.map((o) => ({ ...o, [k]: undefined }));
  }
  next = tidy({ ...next, overrides: overrides.map((o) => JSON.parse(JSON.stringify(o)) as EventOverride).filter(hasChanges), exdates });
  // A new rule: only the left-out and changed dates that are still its dates stay.
  if (ruleChange) next = tidy({ ...next, exdates: next.exdates?.filter((x) => x.length === 10 || isDateOf({ ...next, exdates: undefined }, x)), overrides: next.overrides?.filter((o) => isDateOf(next, o.occurrence)) });
  return { upserts: [next], deletes: [] };
}

/** Deleting one date, this and the following ones, or the whole series. */
export function removeFromSeries(series: CalEvent, occurrence: string, scope: Scope): SeriesChange {
  if (scope === 'all' || (scope === 'following' && isFirst(series, occurrence))) return { upserts: [], deletes: [series.id] };
  if (scope === 'following') {
    const head = endBefore(series, occurrence);
    return head ? { upserts: [head], deletes: [] } : { upserts: [], deletes: [series.id] };
  }
  const o = overrideOf(series, occurrence);
  const next = tidy({ ...series, exdates: [...(series.exdates ?? []), o?.occurrence ?? occurrence], overrides: series.overrides?.filter((x) => !sameTime(x.occurrence, occurrence)) });
  return hasDates(next) ? { upserts: [next], deletes: [] } : { upserts: [], deletes: [series.id] };
}

/** An answer to an invite for one date, this and the following ones, or all of them. */
export function answerSeries(series: CalEvent, occurrence: string, rsvp: RsvpStatus, scope: Scope): CalEvent {
  const at = msOf(occurrence);
  if (scope === 'one') {
    const o = overrideOf(series, occurrence);
    const others = (series.overrides ?? []).filter((x) => !sameTime(x.occurrence, occurrence));
    return tidy({ ...series, overrides: [...others, { ...o, occurrence: o?.occurrence ?? occurrence, rsvp }] });
  }
  const clear = (list: EventOverride[] | undefined, keep: (o: EventOverride) => boolean) => list?.map((o) => (keep(o) ? o : { ...o, rsvp: undefined })).map((o) => JSON.parse(JSON.stringify(o)) as EventOverride).filter(hasChanges);
  if (scope === 'all' || isFirst(series, occurrence)) return tidy({ ...series, rsvp, rsvpFrom: undefined, overrides: clear(series.overrides, () => false) });
  return tidy({
    ...series,
    rsvpFrom: [...(series.rsvpFrom ?? []).filter((r) => msOf(r.from) < at), { from: occurrence, rsvp }],
    overrides: clear(series.overrides, (o) => msOf(o.occurrence) < at),
  });
}
