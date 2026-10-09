// iCalendar (RFC 5545) and its invites (iTIP, RFC 5546), read in one place: the file, its times and zones, and repeats.
// Two things in sprint2go use it:
//  - calendar links and public holidays (calendarFeeds.ts): parseCalendar() and expand() turn a whole calendar into
//    dated occurrences. All-day and floating times stay floating ("2026-08-17T00:00:00"): the browser reads them as local.
//  - invites that arrive by email (invites.ts): parseInvite() reads the invite a Google, Outlook or Apple calendar puts in
//    an email (times in UTC, the organiser's zone, the meeting link), occurrences() expands its repeats, buildReply()
//    writes the REPLY that answers it.
// What it reads: folded lines (split multi-byte characters too), escaped text, all-day, UTC, floating and TZID times
// (IANA names, Outlook's Windows names, path-style names, the file's own VTIMEZONE, "(UTC+07:00)" names), DTEND or
// DURATION, RRULE (daily, weekly, monthly, yearly with INTERVAL, COUNT, UNTIL, BYDAY with ordinals counted from the
// start or the end, BYMONTHDAY from the start or the end, BYMONTH, BYWEEKNO, BYYEARDAY, BYSETPOS, WKST), RDATE and EXDATE
// in any zone (or as dates, or periods), moved or cancelled single occurrences (RECURRENCE-ID) and cancelled events.
// No dependencies; ics.test.ts pins it down.

/* ---------- reading the file ---------- */

export interface Prop {
  name: string; // upper case, e.g. DTSTART
  params: Record<string, string>; // upper-case keys, e.g. { TZID: 'Asia/Jakarta' }
  value: string; // raw (not unescaped)
}
export interface Component {
  type: string; // VCALENDAR, VEVENT, VTIMEZONE, STANDARD…
  props: Prop[];
  children: Component[];
}
/** The names the invite side used; the same shapes. */
export type IcsProp = Prop;
export type IcsComponent = Component;

/** Long lines are folded: a line break and a space (or tab) continue the line. Done on bytes, so a fold inside a multi-byte character still joins. */
function unfold(input: string | Uint8Array): string[] {
  const latin = typeof input === 'string' ? Buffer.from(input, 'utf8').toString('latin1') : Buffer.from(input).toString('latin1');
  const joined = latin.replace(/\r?\n[ \t]/g, '');
  return Buffer.from(joined, 'latin1').toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n|\r/);
}

/** NAME;PARAM=a;PARAM2="b:c":value, with quotes protecting ; : and , inside parameter values. */
function parseLine(line: string): Prop | null {
  let i = 0;
  let quoted = false;
  let nameEnd = -1;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === ';' || c === ':')) {
      if (nameEnd < 0) nameEnd = i;
      if (c === ':') break;
    }
  }
  if (i >= line.length || nameEnd <= 0) return null; // no value
  const name = line.slice(0, nameEnd).trim().toUpperCase();
  const params: Record<string, string> = {};
  const rawParams = line.slice(nameEnd, i); // ";A=b;C="d:e""
  const re = /;([^=;]+)=((?:"[^"]*"|[^;"])*)/g;
  for (let m; (m = re.exec(rawParams)); ) params[m[1].trim().toUpperCase()] = m[2].replace(/^"(.*)"$/, '$1');
  return { name, params, value: line.slice(i + 1) };
}

/** The whole file as a tree of components. Throws Error('not-ics') when it isn't a calendar at all. */
export function parseTree(input: string | Uint8Array): Component {
  const root: Component = { type: 'ROOT', props: [], children: [] };
  const stack: Component[] = [root];
  for (const line of unfold(input)) {
    if (!line.trim()) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const c: Component = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      stack[stack.length - 1].children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      // A missing END is forgiven: close up to the matching BEGIN.
      const at = stack.map((c) => c.type).lastIndexOf(p.value.trim().toUpperCase());
      if (at > 0) stack.length = at;
    } else stack[stack.length - 1].props.push(p);
  }
  const cal = root.children.find((c) => c.type === 'VCALENDAR');
  if (!cal) throw new Error('not-ics');
  return cal;
}
/** The calendar in a file, or null when it isn't one. */
export function parseIcs(input: string | Uint8Array): Component | null {
  try {
    return parseTree(input);
  } catch {
    return null;
  }
}

const prop = (c: Component, name: string) => c.props.find((p) => p.name === name);
const props = (c: Component, name: string) => c.props.filter((p) => p.name === name);
/** TEXT values escape newlines, commas, semicolons and backslashes. */
export const unescapeText = (v: string) => v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
const escapeText = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const text = (c: Component, name: string) => {
  const p = prop(c, name);
  return p ? unescapeText(p.value).trim() : undefined;
};

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

function parseTime(value: string, params: Record<string, string> = {}): ICalTime | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i);
  if (!m) return null;
  const date = !m[4] || params.VALUE === 'DATE';
  return { y: +m[1], m: +m[2], d: +m[3], h: date ? 0 : +m[4], mi: date ? 0 : +m[5], s: date ? 0 : +(m[6] ?? 0), date, utc: !!m[7], tz: m[7] ? undefined : params.TZID };
}

/** Wall-clock fields as one number (milliseconds, as if the wall clock were UTC): easy, DST-free date arithmetic. */
const wallOf = (t: { y: number; m: number; d: number; h: number; mi: number; s: number }) => Date.UTC(t.y, t.m - 1, t.d, t.h, t.mi, t.s);
const DAY = 86_400_000;

/* ---------- time zones ---------- */

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

// Outlook and Exchange write Windows zone names. The common ones, to their IANA names (Indonesia first where a Windows
// zone covers it: most of the people we meet are there).
const WINDOWS: Record<string, string> = {
  'dateline standard time': 'Etc/GMT+12',
  'utc-11': 'Etc/GMT+11',
  'hawaiian standard time': 'Pacific/Honolulu',
  'alaskan standard time': 'America/Anchorage',
  'pacific standard time': 'America/Los_Angeles',
  'pacific standard time (mexico)': 'America/Tijuana',
  'us mountain standard time': 'America/Phoenix',
  'mountain standard time': 'America/Denver',
  'central standard time': 'America/Chicago',
  'central america standard time': 'America/Guatemala',
  'central standard time (mexico)': 'America/Mexico_City',
  'canada central standard time': 'America/Regina',
  'eastern standard time': 'America/New_York',
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'sa pacific standard time': 'America/Bogota',
  'atlantic standard time': 'America/Halifax',
  'venezuela standard time': 'America/Caracas',
  'sa western standard time': 'America/La_Paz',
  'pacific sa standard time': 'America/Santiago',
  'newfoundland standard time': 'America/St_Johns',
  'e. south america standard time': 'America/Sao_Paulo',
  'argentina standard time': 'America/Argentina/Buenos_Aires',
  'sa eastern standard time': 'America/Cayenne',
  'utc-02': 'Etc/GMT+2',
  'azores standard time': 'Atlantic/Azores',
  utc: 'UTC',
  'coordinated universal time': 'UTC',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'morocco standard time': 'Africa/Casablanca',
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'romance standard time': 'Europe/Paris',
  'central european standard time': 'Europe/Warsaw',
  'w. central africa standard time': 'Africa/Lagos',
  'gtb standard time': 'Europe/Bucharest',
  'e. europe standard time': 'Europe/Chisinau',
  'egypt standard time': 'Africa/Cairo',
  'south africa standard time': 'Africa/Johannesburg',
  'fle standard time': 'Europe/Kyiv',
  'israel standard time': 'Asia/Jerusalem',
  'turkey standard time': 'Europe/Istanbul',
  'arabic standard time': 'Asia/Baghdad',
  'arab standard time': 'Asia/Riyadh',
  'russian standard time': 'Europe/Moscow',
  'e. africa standard time': 'Africa/Nairobi',
  'iran standard time': 'Asia/Tehran',
  'arabian standard time': 'Asia/Dubai',
  'afghanistan standard time': 'Asia/Kabul',
  'pakistan standard time': 'Asia/Karachi',
  'west asia standard time': 'Asia/Tashkent',
  'india standard time': 'Asia/Kolkata',
  'sri lanka standard time': 'Asia/Colombo',
  'nepal standard time': 'Asia/Kathmandu',
  'bangladesh standard time': 'Asia/Dhaka',
  'myanmar standard time': 'Asia/Yangon',
  'se asia standard time': 'Asia/Jakarta',
  'china standard time': 'Asia/Shanghai',
  'singapore standard time': 'Asia/Singapore',
  'malay peninsula standard time': 'Asia/Kuala_Lumpur',
  'w. australia standard time': 'Australia/Perth',
  'taipei standard time': 'Asia/Taipei',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'cen. australia standard time': 'Australia/Adelaide',
  'aus central standard time': 'Australia/Darwin',
  'e. australia standard time': 'Australia/Brisbane',
  'aus eastern standard time': 'Australia/Sydney',
  'west pacific standard time': 'Pacific/Port_Moresby',
  'tasmania standard time': 'Australia/Hobart',
  'new zealand standard time': 'Pacific/Auckland',
  'fiji standard time': 'Pacific/Fiji',
  'tonga standard time': 'Pacific/Tongatapu',
};

/** A TZID as an IANA name we can use, if it is one or names one (Windows names, "/mozilla.org/…/America/New_York"). */
export function ianaOf(tzid: string | undefined): string | undefined {
  if (!tzid) return undefined;
  const id = tzid.trim().replace(/^"|"$/g, '');
  if (isZone(id)) return id;
  const win = WINDOWS[id.toLowerCase()];
  if (win && isZone(win)) return win;
  const segs = id.split('/').filter(Boolean);
  for (let i = 1; i < segs.length; i++) {
    const cand = segs.slice(i).join('/');
    if (cand.includes('/') && isZone(cand)) return cand;
  }
  return undefined;
}

/** How far a zone is ahead of UTC at an instant, in minutes. */
export function zoneOffset(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
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

/** A file's own zone definition (STANDARD and DAYLIGHT parts), for TZIDs we can't name. */
export interface VZone {
  parts: { start: ICalTime; from: number; to: number; rule?: RRule; rdates: ICalTime[] }[];
}
function parseOffset(v: string | undefined) {
  const m = v?.trim().match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
  return m ? (m[1] === '-' ? -1 : 1) * ((+m[2] * 60 + +m[3]) * 60 + +(m[4] ?? 0)) * 1000 : 0;
}
function parseVZone(c: Component): VZone {
  return {
    parts: c.children
      .filter((s) => s.type === 'STANDARD' || s.type === 'DAYLIGHT')
      .map((s) => {
        const st = prop(s, 'DTSTART');
        const rr = prop(s, 'RRULE');
        return {
          start: (st && parseTime(st.value, st.params)) || { y: 1970, m: 1, d: 1, h: 0, mi: 0, s: 0, date: false, utc: false },
          from: parseOffset(prop(s, 'TZOFFSETFROM')?.value),
          to: parseOffset(prop(s, 'TZOFFSETTO')?.value),
          rule: rr ? parseRRule(rr.value) ?? undefined : undefined,
          rdates: s.props.filter((p) => p.name === 'RDATE').flatMap((p) => p.value.split(',').map((v) => parseTime(v, p.params)).filter(Boolean) as ICalTime[]),
        };
      }),
  };
}
const zonesOf = (cal: Component) => {
  const zones = new Map<string, VZone>();
  for (const z of cal.children.filter((c) => c.type === 'VTIMEZONE')) {
    const id = prop(z, 'TZID')?.value.trim();
    if (id) zones.set(id, parseVZone(z));
  }
  return zones;
};
/** Where each part of a VTIMEZONE starts in one year (wall ms), worked out once per zone and year. */
const onsetCache = new WeakMap<VZone, Map<number, { at: number; to: number }[]>>();
function onsetsIn(z: VZone, year: number) {
  let byYear = onsetCache.get(z);
  if (!byYear) onsetCache.set(z, (byYear = new Map()));
  let list = byYear.get(year);
  if (!list) {
    const from = Date.UTC(year, 0, 1);
    const to = Date.UTC(year + 1, 0, 1) - 1;
    list = z.parts.flatMap((p) => {
      const ats = [wallOf(p.start), ...p.rdates.map(wallOf)].filter((at) => at >= from && at <= to);
      if (p.rule) ats.push(...wallOccurrences(p.start, p.rule, from, to));
      return ats.map((at) => ({ at, to: p.to }));
    });
    byYear.set(year, list);
  }
  return list;
}
/** The offset a VTIMEZONE gives at a wall-clock time: the part whose latest start is before it. */
function vzoneOffset(z: VZone, wall: number) {
  const year = new Date(wall).getUTCFullYear();
  let best: { at: number; to: number } | null = null;
  for (let y = year; y >= year - 1 && !best; y--) for (const o of onsetsIn(z, y)) if (o.at <= wall && (!best || o.at > best.at)) best = o;
  if (best) return best.to;
  // Before anything the zone defines (or a zone with no yearly rule): its earliest part's offset.
  let earliest: { at: number; from: number; to: number } | null = null;
  for (const p of z.parts) if (!earliest || wallOf(p.start) < earliest.at) earliest = { at: wallOf(p.start), from: p.from, to: p.to };
  if (!earliest) return 0;
  return wall < earliest.at ? earliest.from : z.parts.filter((p) => wallOf(p.start) <= wall).sort((a, b) => wallOf(b.start) - wallOf(a.start))[0]?.to ?? earliest.to;
}

/** A TZID made computable: an IANA name, the file's own VTIMEZONE, or nothing (read as UTC, or floating). */
export type Zone = { iana: string } | { vzone: VZone } | null;
export function resolveZone(tzid: string | undefined, zones: Map<string, VZone>): Zone {
  if (!tzid) return null;
  const id = tzid.trim().replace(/^"|"$/g, '');
  const iana = ianaOf(id);
  if (iana) return { iana };
  const own = zones.get(id);
  if (own) return { vzone: own };
  // "(UTC+07:00) Bangkok, Hanoi, Jakarta" style: a fixed offset.
  const off = id.match(/(?:UTC|GMT)\s*([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (off) {
    const ms = (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +(off[3] ?? 0)) * 60_000;
    return { vzone: { parts: [{ start: { y: 1970, m: 1, d: 1, h: 0, mi: 0, s: 0, date: false, utc: false }, from: ms, to: ms, rdates: [] }] } };
  }
  return null;
}
/** A wall-clock time in a zone, to the real instant (ms since epoch). */
export function wallToUtc(wall: number, zone: Zone) {
  if (!zone) return wall;
  if ('vzone' in zone) return wall - vzoneOffset(zone.vzone, wall);
  const d = new Date(wall);
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), zone.iana);
}
/** The real instant, to wall-clock fields in a zone. */
function utcToWall(utc: number, zone: Zone) {
  if (!zone || !Number.isFinite(utc)) return utc;
  if ('vzone' in zone) return utc + vzoneOffset(zone.vzone, utc);
  return utc + zoneOffset(zone.iana, utc) * 60_000;
}

/** PT1H30M, P1D, P2W, -PT15M, in ms (null when it isn't a duration). */
export function durationMs(v: string | undefined): number | null {
  const m = v?.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const ms = (((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 60 + +(m[5] ?? 0)) * 60_000 + +(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/* ---------- recurrence ---------- */

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
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

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const weekday = (wall: number) => new Date(wall).getUTCDay();
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

/* ---------- calendar links: whole calendars, as dated occurrences ---------- */

export interface ICalAttendee {
  email: string;
  name?: string;
  status?: string; // PARTSTAT: ACCEPTED, DECLINED, TENTATIVE, NEEDS-ACTION
}
/** One VEVENT as written (a recurring master, an override of one occurrence, or a single event). */
export interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  conference?: string; // X-GOOGLE-CONFERENCE and the like
  status?: string; // CONFIRMED, TENTATIVE, CANCELLED
  transparent: boolean; // TRANSP:TRANSPARENT (shows as free)
  start: ICalTime;
  end?: ICalTime;
  duration?: number; // ms
  rrule?: RRule;
  rdates: ICalTime[];
  exdates: ICalTime[];
  recurrenceId?: ICalTime;
  sequence: number;
  organizer?: ICalAttendee;
  attendees: ICalAttendee[];
}
export interface ICalendar {
  name?: string; // X-WR-CALNAME
  timezone?: string; // X-WR-TIMEZONE: how floating times are read
  method?: string; // PUBLISH, REQUEST (an invite), REPLY, CANCEL
  events: ICalEvent[];
  zones: Map<string, VZone>;
}

const attendeeOf = (p: Prop | undefined): ICalAttendee | undefined => {
  if (!p) return undefined;
  const email = p.value.replace(/^mailto:/i, '').trim().toLowerCase();
  return email.includes('@') ? { email, name: p.params.CN ? unescapeText(p.params.CN) : undefined, status: p.params.PARTSTAT?.toUpperCase() } : undefined;
};
/** RDATE and EXDATE values: one or more times (a PERIOD, start/end or start/duration, counts from its start). */
const listValues = (p: Prop) => p.value.split(',').map((v) => v.split('/')[0].trim()).filter(Boolean);
const times = (c: Component, name: string) => c.props.filter((p) => p.name === name).flatMap((p) => listValues(p).map((v) => parseTime(v, p.params)).filter(Boolean) as ICalTime[]);

/** Reads a calendar file. Throws Error('not-ics') when it isn't one. */
export function parseCalendar(input: string | Uint8Array): ICalendar {
  const cal = parseTree(input);
  const events: ICalEvent[] = [];
  for (const c of cal.children) {
    if (c.type !== 'VEVENT') continue;
    const st = prop(c, 'DTSTART');
    const start = st && parseTime(st.value, st.params);
    if (!start) continue;
    const en = prop(c, 'DTEND');
    const rid = prop(c, 'RECURRENCE-ID');
    const rr = prop(c, 'RRULE');
    events.push({
      uid: prop(c, 'UID')?.value.trim() || `${st!.value}-${text(c, 'SUMMARY') ?? ''}`,
      summary: text(c, 'SUMMARY') || '(No title)',
      description: text(c, 'DESCRIPTION'),
      location: text(c, 'LOCATION'),
      url: prop(c, 'URL')?.value.trim(),
      conference: prop(c, 'X-GOOGLE-CONFERENCE')?.value.trim() || prop(c, 'X-MICROSOFT-SKYPETEAMSMEETINGURL')?.value.trim(),
      status: prop(c, 'STATUS')?.value.trim().toUpperCase(),
      transparent: prop(c, 'TRANSP')?.value.trim().toUpperCase() === 'TRANSPARENT',
      start,
      end: (en && parseTime(en.value, en.params)) || undefined,
      duration: durationMs(prop(c, 'DURATION')?.value) ?? undefined,
      rrule: rr ? parseRRule(rr.value) ?? undefined : undefined,
      rdates: times(c, 'RDATE'),
      exdates: times(c, 'EXDATE'),
      recurrenceId: (rid && parseTime(rid.value, rid.params)) || undefined,
      sequence: +(prop(c, 'SEQUENCE')?.value ?? 0) || 0,
      organizer: attendeeOf(prop(c, 'ORGANIZER')),
      attendees: c.props.filter((p) => p.name === 'ATTENDEE').map(attendeeOf).filter(Boolean) as ICalAttendee[],
    });
  }
  return { name: text(cal, 'X-WR-CALNAME'), timezone: prop(cal, 'X-WR-TIMEZONE')?.value.trim(), method: prop(cal, 'METHOD')?.value.trim().toUpperCase(), events, zones: zonesOf(cal) };
}

/** One dated occurrence, ready to store. All-day and floating times have no zone ("2026-08-17T00:00:00"). */
export interface Occurrence {
  uid: string;
  key: string; // stable per occurrence: uid plus its original start
  title: string;
  description?: string;
  location?: string;
  url?: string;
  conference?: string;
  start: string;
  end: string;
  allDay: boolean;
  transparent: boolean;
  organizer?: ICalAttendee;
  attendees: ICalAttendee[];
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** Wall ms to "YYYY-MM-DDTHH:MM:SS" with no zone: the browser reads it as local time. */
const floating = (wall: number) => {
  const d = new Date(wall);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

/**
 * Every occurrence that overlaps [from, to] (real ms), with recurring events expanded, overrides applied, and
 * cancelled ones left out. Sorted by start; at most `max`.
 */
export function expand(cal: ICalendar, from: number, to: number, max = 4000): Occurrence[] {
  const floatZone = resolveZone(cal.timezone, cal.zones);
  const zoneFor = (t: ICalTime): Zone => (t.date ? null : t.utc ? null : t.tz ? resolveZone(t.tz, cal.zones) ?? floatZone : floatZone);
  const isFloating = (t: ICalTime) => t.date || (!t.utc && !t.tz && !floatZone);
  /** The real instant of a time, for comparing (all-day and floating read as UTC). */
  const instant = (t: ICalTime) => (t.utc ? wallOf(t) : wallToUtc(wallOf(t), zoneFor(t)));
  const iso = (wall: number, t: ICalTime, zone: Zone) => (isFloating(t) ? floating(wall) : new Date(t.utc ? wall : wallToUtc(wall, zone)).toISOString());

  // Overrides of single occurrences, by uid and the original start they replace.
  const overrides = new Map<string, ICalEvent>();
  for (const e of cal.events) if (e.recurrenceId) overrides.set(`${e.uid}|${instant(e.recurrenceId)}`, e);
  const masters = new Map<string, ICalEvent>();
  for (const e of cal.events) {
    if (e.recurrenceId) continue;
    const had = masters.get(e.uid);
    if (!had || e.sequence >= had.sequence) masters.set(e.uid, e);
  }

  const out: Occurrence[] = [];
  const lengthOf = (e: ICalEvent) => {
    // Same zone: wall-clock length, so "9 to 10" stays an hour across a DST change. Different zones (a flight): real time.
    if (e.end && !e.start.date && (e.end.tz !== e.start.tz || e.end.utc !== e.start.utc)) return Math.max(0, instant(e.end) - instant(e.start));
    if (e.end) return Math.max(0, wallOf(e.end) - wallOf(e.start)) || (e.start.date ? DAY : 0);
    if (e.duration !== undefined) return Math.max(0, e.duration);
    return e.start.date ? DAY : 0;
  };
  const push = (e: ICalEvent, startWall: number, key: string) => {
    const zone = zoneFor(e.start);
    const len = lengthOf(e);
    const endWall = startWall + len;
    const s = e.start.utc ? startWall : isFloating(e.start) ? startWall : wallToUtc(startWall, zone);
    const en = e.start.utc ? endWall : isFloating(e.start) ? endWall : wallToUtc(endWall, zone);
    if (en < from || s > to || (en === from && s < from)) return; // ends exactly as the window starts: not in it
    out.push({
      uid: e.uid,
      key,
      title: e.summary,
      description: e.description,
      location: e.location,
      url: e.url,
      conference: e.conference,
      start: iso(startWall, e.start, zone),
      end: iso(endWall, e.start, zone),
      allDay: e.start.date,
      transparent: e.transparent,
      organizer: e.organizer,
      attendees: e.attendees,
    });
  };

  for (const e of masters.values()) {
    if (e.status === 'CANCELLED') continue;
    const zone = zoneFor(e.start);
    if (!e.rrule && !e.rdates.length) {
      push(e, wallOf(e.start), `${e.uid}|${instant(e.start)}`);
      continue;
    }
    const len = lengthOf(e);
    // The window in this event's own wall clock, a day wider on each side for zone offsets.
    const wFrom = utcToWall(from, zone) - len - DAY;
    const wTo = utcToWall(to, zone) + DAY;
    let untilWall: number | undefined;
    if (e.rrule?.until) {
      const u = e.rrule.until;
      untilWall = u.date ? wallOf(u) + DAY - 1 : u.utc ? utcToWall(wallOf(u), zone) : wallOf(u);
    }
    const starts = new Set<number>(e.rrule ? wallOccurrences(e.start, e.rrule, wFrom, wTo, untilWall, max * 2) : [wallOf(e.start)]);
    // RDATE: a date gets the event's own time; a time in UTC or another zone is moved to the event's wall clock.
    for (const r of e.rdates) {
      const w = r.date && !e.start.date ? Date.UTC(r.y, r.m - 1, r.d) + (wallOf(e.start) - Date.UTC(e.start.y, e.start.m - 1, e.start.d)) : r.utc || (r.tz && r.tz !== e.start.tz) ? utcToWall(instant(r), zone) : wallOf(r);
      if (w >= wFrom && w <= wTo) starts.add(w);
    }
    const ex = new Set(e.exdates.map((x) => (x.date ? `d${x.y}${pad(x.m)}${pad(x.d)}` : `t${instant(x)}`)));
    for (const w of [...starts].sort((a, b) => a - b)) {
      const d = new Date(w);
      const real = wallToUtc(w, zone);
      if (ex.has(`t${real}`) || ex.has(`d${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`)) continue;
      const key = `${e.uid}|${real}`;
      const o = overrides.get(key);
      if (o) {
        overrides.delete(key);
        if (o.status !== 'CANCELLED') push(o, wallOf(o.start), key);
        continue;
      }
      push(e, w, key);
      if (out.length > max * 2) break;
    }
  }
  // Overrides whose original occurrence fell outside the window (moved into it), or of a master we didn't get.
  for (const [key, o] of overrides) if (o.status !== 'CANCELLED' && !(masters.get(o.uid)?.status === 'CANCELLED')) push(o, wallOf(o.start), key);

  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out.slice(0, max);
}

/* ---------- invites in email ---------- */

export type PartStat = 'accepted' | 'declined' | 'tentative' | 'needs-action' | 'delegated';
export interface IcsPerson {
  name: string;
  email: string;
}
export interface IcsAttendee extends IcsPerson {
  status: PartStat;
  rsvp?: boolean;
  optional?: boolean;
}
export type IcsMethod = 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH';
export interface IcsEvent {
  method: IcsMethod;
  uid: string;
  sequence: number;
  title: string;
  start: string; // ISO, UTC. All-day: noon UTC on the first day, so it lands on the same date everywhere
  end: string; // ISO, UTC. All-day: one minute past noon UTC on the last day
  allDay?: boolean;
  tz?: string; // the organiser's time zone (IANA), when the invite says
  location?: string;
  description?: string;
  url?: string; // the meeting link: Google Meet, Zoom, Teams, Webex
  organizer?: IcsPerson;
  attendees: IcsAttendee[];
  rrule?: string; // e.g. FREQ=WEEKLY;BYDAY=MO
  rdates?: string[]; // ISO starts of extra occurrences (RDATE, in whatever zone it was written)
  exdates?: string[]; // ISO starts of skipped occurrences, or a date ("2026-10-28") that skips that day in the event's zone
  recurrenceId?: string; // ISO original start, when this is one changed occurrence of a series
  overrides?: { recurrenceId: string; start: string; end: string; cancelled?: boolean }[]; // changed occurrences sent along with the series
  cancelled?: boolean; // STATUS:CANCELLED
}

const LINK_RE = /https:\/\/(?:meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}|(?:[\w-]+\.)?zoom\.us\/(?:j|my|w|s)\/[^\s<>"'),]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')]+|teams\.live\.com\/meet\/[^\s<>"')]+|[\w-]+\.webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s<>"')]*)/i;
/** The first Google Meet, Zoom, Teams or Webex link in some text. */
export const findMeetingLink = (s: string | undefined): string | undefined => s?.match(LINK_RE)?.[0]?.replace(/[.,;]+$/, '');

const PARTSTAT: Record<string, PartStat> = { ACCEPTED: 'accepted', DECLINED: 'declined', TENTATIVE: 'tentative', 'NEEDS-ACTION': 'needs-action', DELEGATED: 'delegated' };
const mailto = (v: string) => v.replace(/^mailto:/i, '').trim().toLowerCase();
const inviteePerson = (p: Prop): IcsPerson => {
  const email = mailto(p.value);
  const cn = unescapeText(p.params.CN ?? '').trim();
  return { name: cn && !cn.includes('@') ? cn : email.split('@')[0], email }; // Google puts the address in CN when there's no name
};
const iso = (t: number) => new Date(t).toISOString();

/** An invite's DTSTART-like property as a UTC instant (dates: noon UTC), with the organiser's zone when it names one. */
function inviteInstant(p: Prop | undefined, zones: Map<string, VZone>, defaultTz: string | undefined): { at: number; date: boolean; tz?: string } | null {
  if (!p) return null;
  const t = parseTime(p.value, p.params);
  if (!t) return null;
  if (t.date) return { at: Date.UTC(t.y, t.m - 1, t.d, 12, 0, 0), date: true };
  if (t.utc) return { at: wallOf(t), date: false };
  const zone = resolveZone(t.tz, zones) ?? resolveZone(defaultTz, zones);
  const tz = ianaOf(t.tz) ?? (t.tz ? undefined : ianaOf(defaultTz));
  return { at: wallToUtc(wallOf(t), zone), date: false, tz };
}

/** The invite in an email's calendar part: the main event of the series (changed single occurrences ride along). */
export function parseInvite(input: Buffer | string): IcsEvent | null {
  const cal = parseIcs(input);
  if (!cal) return null;
  const method = (prop(cal, 'METHOD')?.value.trim().toUpperCase() || 'PUBLISH') as string;
  if (!['REQUEST', 'CANCEL', 'REPLY', 'PUBLISH'].includes(method)) return null;
  const zones = zonesOf(cal);
  const defaultTz = prop(cal, 'X-WR-TIMEZONE')?.value.trim();
  const at = (p: Prop | undefined) => inviteInstant(p, zones, defaultTz);
  const readEvent = (ve: Component) => {
    const s = at(prop(ve, 'DTSTART'));
    if (!s) return null;
    const e = at(prop(ve, 'DTEND') ?? prop(ve, 'DUE'));
    const dur = durationMs(prop(ve, 'DURATION')?.value);
    let end = e?.at ?? (dur != null ? s.at + dur : s.at + (s.date ? DAY : 3_600_000));
    // All-day: DTEND is the day after the last one; stored as a minute past noon on the last day.
    if (s.date) end = Math.max(s.at, end - DAY) + 60_000;
    if (end < s.at) end = s.at;
    return { start: s.at, end, allDay: s.date, tz: s.tz };
  };
  const events = cal.children.filter((c) => c.type === 'VEVENT');
  if (!events.length) return null;
  const main = events.find((v) => !prop(v, 'RECURRENCE-ID')) ?? events[0];
  const t = readEvent(main);
  const uid = prop(main, 'UID')?.value.trim();
  if (!t || !uid) return null;
  const textOf = (ve: Component, name: string, max = 2000) => {
    const v = prop(ve, name)?.value;
    return v ? unescapeText(v).trim().slice(0, max) || undefined : undefined;
  };
  const description = textOf(main, 'DESCRIPTION');
  const location = textOf(main, 'LOCATION', 500);
  // Only links to the calls we know become the Join button: the invite comes from outside, so any other address
  // stays a plain link in the email.
  const conference = ['X-GOOGLE-CONFERENCE', 'X-MICROSOFT-SKYPETEAMSMEETINGURL', 'X-MICROSOFT-ONLINEMEETINGCONFLINK', 'URL'].map((n) => findMeetingLink(prop(main, n)?.value.trim())).find(Boolean);
  const url = conference ?? findMeetingLink(location) ?? findMeetingLink(description);
  const org = prop(main, 'ORGANIZER');
  const recId = at(prop(main, 'RECURRENCE-ID'));
  // Skipped and extra dates, in whatever zone each was written. A date-only EXDATE on a timed event skips that day; a
  // date-only RDATE adds that day at the event's own time.
  const firstStart = prop(main, 'DTSTART');
  const first = firstStart && parseTime(firstStart.value, firstStart.params);
  const eachValue = (name: string) => props(main, name).flatMap((p) => listValues(p).map((v) => ({ ...p, value: v })));
  const exdates = eachValue('EXDATE').flatMap((p) => {
    const x = parseTime(p.value, p.params);
    if (x?.date && !t.allDay) return [`${x.y}-${pad(x.m)}-${pad(x.d)}`];
    const i = at(p);
    return i ? [iso(i.at)] : [];
  });
  const rdates = eachValue('RDATE').flatMap((p) => {
    const x = parseTime(p.value, p.params);
    if (x?.date && !t.allDay && first && !first.date) return [iso(inviteInstant({ ...firstStart!, value: `${x.y}${pad(x.m)}${pad(x.d)}T${pad(first.h)}${pad(first.mi)}${pad(first.s)}${first.utc ? 'Z' : ''}` }, zones, defaultTz)!.at)];
    const i = at(p);
    return i ? [iso(i.at)] : [];
  });
  const overrides = events
    .filter((v) => v !== main && prop(v, 'RECURRENCE-ID') && prop(v, 'UID')?.value.trim() === uid)
    .map((v) => {
      const r = at(prop(v, 'RECURRENCE-ID'));
      const x = readEvent(v);
      return r && x ? { recurrenceId: iso(r.at), start: iso(x.start), end: iso(x.end), ...(prop(v, 'STATUS')?.value.toUpperCase() === 'CANCELLED' ? { cancelled: true } : {}) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return {
    method: method as IcsMethod,
    uid,
    sequence: Number(prop(main, 'SEQUENCE')?.value) || 0,
    title: textOf(main, 'SUMMARY', 300) ?? '(no title)',
    start: iso(t.start),
    end: iso(t.end),
    ...(t.allDay ? { allDay: true } : {}),
    ...(t.tz ? { tz: t.tz } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    ...(org ? { organizer: inviteePerson(org) } : {}),
    attendees: props(main, 'ATTENDEE')
      .map((a) => ({ ...inviteePerson(a), status: PARTSTAT[(a.params.PARTSTAT ?? 'NEEDS-ACTION').toUpperCase()] ?? 'needs-action', ...(a.params.RSVP?.toUpperCase() === 'TRUE' ? { rsvp: true } : {}), ...(a.params.ROLE?.toUpperCase() === 'OPT-PARTICIPANT' ? { optional: true } : {}) }))
      .filter((a) => a.email.includes('@'))
      .slice(0, 200),
    ...(prop(main, 'RRULE') ? { rrule: prop(main, 'RRULE')!.value.trim() } : {}),
    ...(rdates.length ? { rdates } : {}),
    ...(exdates.length ? { exdates } : {}),
    ...(recId ? { recurrenceId: iso(recId.at) } : {}),
    ...(overrides.length ? { overrides } : {}),
    ...(prop(main, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED' ? { cancelled: true } : {}),
  };
}

/**
 * The occurrences of an invite between two instants (at most `max`), keeping the organiser's wall-clock time across
 * daylight saving, with skipped dates left out and moved ones moved. Null when the repeat isn't one calendars use for
 * events (hourly and finer): the caller keeps only the first occurrence.
 */
export function occurrences(ev: Pick<IcsEvent, 'start' | 'end' | 'rrule' | 'rdates' | 'exdates' | 'overrides' | 'tz' | 'allDay'>, from: number, until: number, max = 60): { start: string; end: string; recurrenceId?: string }[] | null {
  const start = Date.parse(ev.start);
  const len = Date.parse(ev.end) - start;
  if (!ev.rrule && !ev.rdates?.length) return start + len >= from && start <= until ? [{ start: ev.start, end: ev.end }] : [];
  const r = ev.rrule ? parseRRule(ev.rrule) : { freq: 'DAILY' as const, interval: 1, count: 1, wkst: 1 }; // RDATE alone: the first date, plus those
  if (!r) return null;
  const zone: Zone = ev.allDay || !ev.tz || !isZone(ev.tz) ? null : { iana: ev.tz };
  const w0 = utcToWall(start, zone);
  const d0 = new Date(w0);
  const first: ICalTime = { y: d0.getUTCFullYear(), m: d0.getUTCMonth() + 1, d: d0.getUTCDate(), h: d0.getUTCHours(), mi: d0.getUTCMinutes(), s: d0.getUTCSeconds(), date: false, utc: false };
  let untilWall: number | undefined;
  if (r.until) untilWall = r.until.date ? wallOf(r.until) + DAY - 1 : r.until.utc ? utcToWall(wallOf(r.until), zone) : wallOf(r.until);
  const skip = new Set((ev.exdates ?? []).filter((x) => x.length > 10).map((x) => Date.parse(x)));
  const skipDays = new Set((ev.exdates ?? []).filter((x) => x.length === 10)); // a whole day, in the event's own zone
  const moved = new Map((ev.overrides ?? []).map((o) => [Date.parse(o.recurrenceId), o]));
  const wFrom = Number.isFinite(from) ? utcToWall(from, zone) - len - DAY : -Infinity;
  const wTo = Number.isFinite(until) ? utcToWall(until, zone) + DAY : Infinity;
  const walls = wallOccurrences(first, r, wFrom, wTo, untilWall, max + skip.size + skipDays.size + moved.size);
  // RDATE: extra dates on top of the rule (each already an instant, whatever zone it was written in).
  for (const x of ev.rdates ?? []) {
    const w = utcToWall(Date.parse(x), zone);
    if (Number.isFinite(w) && w >= wFrom && w <= wTo && !walls.includes(w)) walls.push(w);
  }
  walls.sort((a, b) => a - b);
  const out: { start: string; end: string; recurrenceId?: string }[] = [];
  for (const w of walls) {
    const at = wallToUtc(w, zone);
    if (skip.has(at) || skipDays.has(floating(w).slice(0, 10))) continue;
    const o = moved.get(at);
    if (o?.cancelled) continue;
    const s = o ? Date.parse(o.start) : at;
    const e = o ? Date.parse(o.end) : at + len;
    if (e >= from && s <= until) out.push({ start: iso(s), end: iso(e), recurrenceId: iso(at) });
    if (s > until || out.length >= max) break;
  }
  return out;
}

/* ---------- answering an invite ---------- */

const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (s: string) => s.slice(0, 10).replace(/-/g, '');
/** Lines longer than 75 octets fold onto the next line, which starts with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const cn = (name: string) => `"${name.replace(/"/g, "'")}"`;

/** The iTIP REPLY that tells the organiser's calendar who answered and how. */
export function buildReply(ev: IcsEvent, attendee: IcsPerson, status: 'accepted' | 'tentative' | 'declined', now = Date.now()): string {
  const when = (s: string, name: string) => (ev.allDay ? `${name};VALUE=DATE:${dateOnly(s)}` : `${name}:${stamp(Date.parse(s))}`);
  // All-day: the stored end is a minute past noon on the last day; DTEND is the day after it.
  const endIso = ev.allDay ? new Date(Date.parse(ev.end) - 60_000 + DAY).toISOString() : ev.end;
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//sprint2go//Mail//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `SEQUENCE:${ev.sequence}`,
    `DTSTAMP:${stamp(now)}`,
    when(ev.start, 'DTSTART'),
    when(endIso, 'DTEND'),
    ...(ev.recurrenceId ? [when(ev.recurrenceId, 'RECURRENCE-ID')] : []),
    ...(ev.organizer ? [`ORGANIZER;CN=${cn(ev.organizer.name)}:mailto:${ev.organizer.email}`] : []),
    `ATTENDEE;PARTSTAT=${status.toUpperCase()};CN=${cn(attendee.name)}:mailto:${attendee.email}`,
    `SUMMARY:${escapeText(ev.title)}`,
    `REQUEST-STATUS:2.0;Success`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
