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
// in any zone (or as dates, or periods), moved or cancelled single occurrences (RECURRENCE-ID), cancelled events, and
// Outlook's all-day events written as midnight times (X-MICROSOFT-CDO-ALLDAYEVENT).
// The repeat rules themselves live in src/recurrence.ts (shared with the app). ics.test.ts pins it down.
import { DAY, floating, isZone, occurrences, pad, parseRRule, parseTime, wallOccurrences, wallOf, zoneOffset, zonedToUtc, type ICalTime, type RRule } from '../src/recurrence.ts';
export { isZone, occurrences, parseRRule, wallOccurrences, zoneOffset, zonedToUtc, type ICalTime, type RRule, type SeriesTimes } from '../src/recurrence.ts';

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


/* ---------- time zones ---------- */


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
/**
 * Outlook marks an all-day event with X-MICROSOFT-CDO-ALLDAYEVENT and may write it as midnight in a zone: read as the
 * date it names, so a day written in Kiritimati (+14) or Pago Pago (-11) doesn't move to another date.
 */
const outlookAllDay = (c: Component) => /^TRUE$/i.test(prop(c, 'X-MICROSOFT-CDO-ALLDAYEVENT')?.value.trim() ?? '');
const asDate = (p: Prop | undefined): Prop | undefined => {
  const t = p && parseTime(p.value, p.params);
  return t && !t.date && !t.utc && t.h === 0 && t.mi === 0 && t.s === 0 ? { ...p!, value: p!.value.trim().slice(0, 8), params: { VALUE: 'DATE' } } : p;
};

/** Reads a calendar file. Throws Error('not-ics') when it isn't one. */
export function parseCalendar(input: string | Uint8Array): ICalendar {
  const cal = parseTree(input);
  const events: ICalEvent[] = [];
  for (const c of cal.children) {
    if (c.type !== 'VEVENT') continue;
    const whole = outlookAllDay(c);
    const st = whole ? asDate(prop(c, 'DTSTART')) : prop(c, 'DTSTART');
    const start = st && parseTime(st.value, st.params);
    if (!start) continue;
    const en = whole && start.date ? asDate(prop(c, 'DTEND')) : prop(c, 'DTEND');
    const rid = whole && start.date ? asDate(prop(c, 'RECURRENCE-ID')) : prop(c, 'RECURRENCE-ID');
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
  /** A time of this event: Outlook's all-day events written as midnight are the date they name. */
  const timeOf = (ve: Component, name: string) => (outlookAllDay(ve) ? asDate(prop(ve, name)) : prop(ve, name));
  const readEvent = (ve: Component) => {
    const s = at(timeOf(ve, 'DTSTART'));
    if (!s) return null;
    const e = at(timeOf(ve, 'DTEND') ?? prop(ve, 'DUE'));
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
  const recId = at(timeOf(main, 'RECURRENCE-ID'));
  // Skipped and extra dates, in whatever zone each was written. A date-only EXDATE on a timed event skips that day; a
  // date-only RDATE adds that day at the event's own time.
  const firstStart = prop(main, 'DTSTART');
  const first = firstStart && parseTime(firstStart.value, firstStart.params);
  const eachValue = (name: string) => props(main, name).flatMap((p) => listValues(p).map((v) => (t.allDay && outlookAllDay(main) ? asDate({ ...p, value: v })! : { ...p, value: v })));
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
      const r = at(timeOf(v, 'RECURRENCE-ID'));
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
