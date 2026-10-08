// Calendar invites in email (iCalendar, RFC 5545 and iTIP, RFC 5546): reads the invite a Google, Outlook or Apple
// calendar puts in an email, works out its times in UTC (TZID names, Outlook's Windows names, or the VTIMEZONE rules in
// the file), finds the meeting link, expands simple repeats, and writes the REPLY that answers an invite.
// No dependencies: the whole format we need is small, and the tests in ics.test.ts pin it down.

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
  exdates?: string[]; // ISO starts of skipped occurrences
  recurrenceId?: string; // ISO original start, when this is one changed occurrence of a series
  overrides?: { recurrenceId: string; start: string; end: string; cancelled?: boolean }[]; // changed occurrences sent along with the series
  cancelled?: boolean; // STATUS:CANCELLED
}

/* ---------- reading the format ---------- */

export interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}
export interface IcsComponent {
  type: string;
  props: IcsProp[];
  children: IcsComponent[];
}

/** Long lines are folded: a line break followed by a space or tab continues the line. Done on bytes, so a fold in the middle of a multi-byte character still joins. */
function unfold(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const out: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 0x0d && buf[i + 1] === 0x0a && (buf[i + 2] === 0x20 || buf[i + 2] === 0x09)) {
      i += 2;
      continue;
    }
    if (c === 0x0a && (buf[i + 1] === 0x20 || buf[i + 1] === 0x09)) {
      i += 1;
      continue;
    }
    out.push(c);
  }
  return Buffer.from(out).toString('utf8').replace(/^\uFEFF/, '');
}

/** NAME;PARAM=a;PARAM2="b:c":value, with quotes protecting ; : and , inside parameter values. */
function parseLine(line: string): IcsProp | null {
  let i = 0;
  let quoted = false;
  const parts: string[] = [];
  let cur = '';
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === ';' || ch === ':')) {
      parts.push(cur);
      cur = '';
      if (ch === ':') break;
      continue;
    }
    cur += ch;
  }
  if (i >= line.length) return null; // no value
  const [name, ...rawParams] = parts;
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.trim().toUpperCase(), params, value: line.slice(i + 1) };
}

export function parseIcs(input: Buffer | string): IcsComponent | null {
  const lines = unfold(input).split(/\r?\n|\r/);
  const root: IcsComponent = { type: 'ROOT', props: [], children: [] };
  const stack: IcsComponent[] = [root];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === 'BEGIN') {
      const c: IcsComponent = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else top.props.push(p);
  }
  return root.children.find((c) => c.type === 'VCALENDAR') ?? null;
}

const prop = (c: IcsComponent, name: string) => c.props.find((p) => p.name === name);
const props = (c: IcsComponent, name: string) => c.props.filter((p) => p.name === name);
/** TEXT values escape newlines, commas, semicolons and backslashes. */
export const unescapeText = (v: string) => v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
const escapeText = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const mailto = (v: string) => v.replace(/^mailto:/i, '').trim().toLowerCase();

/* ---------- time zones ---------- */

const zoneOk = new Map<string, boolean>();
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
/** Outlook names its zones the Windows way; these are the ones people meet in most. */
const WINDOWS_ZONES: Record<string, string> = {
  'SE Asia Standard Time': 'Asia/Jakarta',
  'Singapore Standard Time': 'Asia/Singapore',
  'Malay Peninsula Standard Time': 'Asia/Kuala_Lumpur',
  'Taipei Standard Time': 'Asia/Taipei',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'India Standard Time': 'Asia/Kolkata',
  'Arabian Standard Time': 'Asia/Dubai',
  'W. Australia Standard Time': 'Australia/Perth',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kyiv',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};
/** A TZID as an IANA name we can use, if it is one (or names one). */
export function ianaOf(tzid: string | undefined): string | undefined {
  if (!tzid) return undefined;
  const t = tzid.trim().replace(/^"|"$/g, '');
  if (isZone(t)) return t;
  if (WINDOWS_ZONES[t]) return WINDOWS_ZONES[t];
  // "/mozilla.org/20050126_1/America/New_York" and similar prefixes
  const tail = t.match(/([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/)?.[1];
  return tail && isZone(tail) ? tail : undefined;
}

/** How far a zone is ahead of UTC at an instant, in minutes. */
export function zoneOffset(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000);
}
/**
 * A wall-clock time in a zone, as a UTC instant. As RFC 5545 asks: a time that happens twice (clocks go back) is the
 * first one, and a time that doesn't exist (clocks go forward) uses the offset from before the change.
 */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const wall = Date.UTC(y, mo, d, h, mi, s);
  const before = zoneOffset(tz, wall - 86_400_000);
  const after = zoneOffset(tz, wall + 86_400_000);
  const tBefore = wall - before * 60_000;
  const tAfter = wall - after * 60_000;
  const okBefore = zoneOffset(tz, tBefore) === before;
  const okAfter = zoneOffset(tz, tAfter) === after;
  if (okBefore && okAfter) return Math.min(tBefore, tAfter);
  if (okAfter) return tAfter;
  return tBefore;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };
const offsetMin = (v: string) => {
  const m = v.trim().match(/^([+-])(\d\d)(\d\d)(\d\d)?$/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
};
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** The day of the month of the nth (or nth-from-last, n < 0) weekday in a month. */
function nthWeekday(y: number, mo: number, wd: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(y, mo, 1)).getUTCDay();
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, mo, lastDay)).getUTCDay();
  return lastDay - ((last - wd + 7) % 7) + (n + 1) * 7;
}
/** A zone only described by the VTIMEZONE in the file: its STANDARD and DAYLIGHT rules, as offsets. */
function vtimezoneOffset(vtz: IcsComponent, w: Wall): number {
  const local = Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s);
  let best: { at: number; off: number } | null = null;
  let latest: { at: number; off: number } | null = null;
  for (const c of vtz.children.filter((x) => x.type === 'STANDARD' || x.type === 'DAYLIGHT')) {
    const off = offsetMin(prop(c, 'TZOFFSETTO')?.value ?? '+0000');
    const ds = parseWall(prop(c, 'DTSTART')?.value ?? '');
    if (!ds) continue;
    const rule = ruleParts(prop(c, 'RRULE')?.value ?? '');
    const onsets: number[] = [];
    if (rule.FREQ === 'YEARLY' && rule.BYMONTH && rule.BYDAY) {
      const mo = Number(rule.BYMONTH) - 1;
      const m = rule.BYDAY.match(/^([+-]?\d)?([A-Z]{2})$/);
      if (m) for (const y of [w.y - 1, w.y]) onsets.push(Date.UTC(y, mo, nthWeekday(y, mo, DAYS.indexOf(m[2]), Number(m[1] ?? 1)), ds.h, ds.mi, ds.s));
    } else onsets.push(Date.UTC(ds.y, ds.mo, ds.d, ds.h, ds.mi, ds.s));
    for (const at of onsets) {
      if (at <= local && (!best || at > best.at)) best = { at, off };
      if (!latest || at > latest.at) latest = { at, off };
    }
  }
  return (best ?? latest)?.off ?? 0;
}

function parseWall(v: string): (Wall & { utc: boolean; date: boolean }) | null {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0), utc: !!m[7], date: !m[4] };
}

interface Ctx {
  zones: Map<string, IcsComponent>;
  defaultTz?: string; // X-WR-TIMEZONE, for floating times
}
/** A DTSTART-like property as a UTC instant; dates are all-day. */
function instant(p: IcsProp | undefined, ctx: Ctx): { at: number; date: boolean; tz?: string } | null {
  if (!p) return null;
  const w = parseWall(p.value);
  if (!w) return null;
  if (w.date || p.params.VALUE === 'DATE') return { at: Date.UTC(w.y, w.mo, w.d, 12, 0, 0), date: true };
  if (w.utc) return { at: Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s), date: false };
  const tzid = p.params.TZID;
  const iana = ianaOf(tzid);
  if (tzid && !isZone(tzid.trim()) && ctx.zones.has(tzid)) {
    // The file's own rules are the most faithful for a zone with a made-up name; the IANA guess is for display.
    return { at: Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s) - vtimezoneOffset(ctx.zones.get(tzid)!, w) * 60_000, date: false, tz: iana };
  }
  const tz = iana ?? ianaOf(ctx.defaultTz);
  if (tz) return { at: zonedToUtc(w.y, w.mo, w.d, w.h, w.mi, w.s, tz), date: false, tz };
  return { at: Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s), date: false };
}

/** PT1H30M, P1D, P2W, -PT15M */
export function durationMs(v: string): number | null {
  const m = v.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = (((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 60 + +(m[5] ?? 0)) * 60_000 + +(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/* ---------- the meeting link ---------- */

const LINK_RE = /https:\/\/(?:meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}|(?:[\w-]+\.)?zoom\.us\/(?:j|my|w|s)\/[^\s<>"'),]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')]+|teams\.live\.com\/meet\/[^\s<>"')]+|[\w-]+\.webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s<>"')]*)/i;
/** The first Google Meet, Zoom, Teams or Webex link in some text. */
export const findMeetingLink = (text: string | undefined): string | undefined => text?.match(LINK_RE)?.[0]?.replace(/[.,;]+$/, '');

/* ---------- the invite ---------- */

const PARTSTAT: Record<string, PartStat> = { ACCEPTED: 'accepted', DECLINED: 'declined', TENTATIVE: 'tentative', 'NEEDS-ACTION': 'needs-action', DELEGATED: 'delegated' };
const person = (p: IcsProp): IcsPerson => {
  const email = mailto(p.value);
  const cn = unescapeText(p.params.CN ?? '').trim();
  return { name: cn && !cn.includes('@') ? cn : email.split('@')[0], email }; // Google puts the address in CN when there's no name
};

function readEvent(ve: IcsComponent, ctx: Ctx) {
  const s = instant(prop(ve, 'DTSTART'), ctx);
  if (!s) return null;
  const endProp = prop(ve, 'DTEND') ?? prop(ve, 'DUE');
  let e = instant(endProp, ctx);
  const dur = prop(ve, 'DURATION') ? durationMs(prop(ve, 'DURATION')!.value) : null;
  let end = e?.at ?? (dur != null ? s.at + dur : s.at + (s.date ? 86_400_000 : 3_600_000));
  if (s.date) {
    // DTEND of an all-day event is the day after the last one.
    const lastDay = Math.max(s.at, (e?.at ?? end) - 86_400_000);
    end = lastDay + 60_000;
    e = null;
  }
  if (end < s.at) end = s.at;
  return { start: s.at, end, allDay: s.date, tz: s.tz };
}

const iso = (t: number) => new Date(t).toISOString();
const textOf = (ve: IcsComponent, name: string, max = 2000) => {
  const v = prop(ve, name)?.value;
  return v ? unescapeText(v).trim().slice(0, max) || undefined : undefined;
};

/** The invite in an email's calendar part: the main event of the series (changed single occurrences ride along). */
export function parseInvite(input: Buffer | string): IcsEvent | null {
  const cal = parseIcs(input);
  if (!cal) return null;
  const method = (prop(cal, 'METHOD')?.value.trim().toUpperCase() || 'PUBLISH') as string;
  if (!['REQUEST', 'CANCEL', 'REPLY', 'PUBLISH'].includes(method)) return null;
  const ctx: Ctx = { zones: new Map(cal.children.filter((c) => c.type === 'VTIMEZONE').map((c) => [prop(c, 'TZID')?.value ?? '', c])), defaultTz: prop(cal, 'X-WR-TIMEZONE')?.value };
  const events = cal.children.filter((c) => c.type === 'VEVENT');
  if (!events.length) return null;
  const main = events.find((v) => !prop(v, 'RECURRENCE-ID')) ?? events[0];
  const t = readEvent(main, ctx);
  const uid = prop(main, 'UID')?.value.trim();
  if (!t || !uid) return null;
  const description = textOf(main, 'DESCRIPTION');
  const location = textOf(main, 'LOCATION', 500);
  // Only links to the calls we know become the Join button: the invite comes from outside, so any other address
  // stays a plain link in the email.
  const conference = ['X-GOOGLE-CONFERENCE', 'X-MICROSOFT-SKYPETEAMSMEETINGURL', 'X-MICROSOFT-ONLINEMEETINGCONFLINK', 'URL'].map((n) => findMeetingLink(prop(main, n)?.value.trim())).find(Boolean);
  const url = conference ?? findMeetingLink(location) ?? findMeetingLink(description);
  const org = prop(main, 'ORGANIZER');
  const recId = instant(prop(main, 'RECURRENCE-ID'), ctx);
  const exdates = props(main, 'EXDATE').flatMap((p) => p.value.split(',').map((v) => instant({ ...p, value: v }, ctx)).filter(Boolean).map((x) => iso(x!.at)));
  const overrides = events
    .filter((v) => v !== main && prop(v, 'RECURRENCE-ID') && prop(v, 'UID')?.value.trim() === uid)
    .map((v) => {
      const r = instant(prop(v, 'RECURRENCE-ID'), ctx)!;
      const x = readEvent(v, ctx);
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
    ...(org ? { organizer: person(org) } : {}),
    attendees: props(main, 'ATTENDEE')
      .map((a) => ({ ...person(a), status: PARTSTAT[(a.params.PARTSTAT ?? 'NEEDS-ACTION').toUpperCase()] ?? 'needs-action', ...(a.params.RSVP?.toUpperCase() === 'TRUE' ? { rsvp: true } : {}), ...(a.params.ROLE?.toUpperCase() === 'OPT-PARTICIPANT' ? { optional: true } : {}) }))
      .filter((a) => a.email.includes('@'))
      .slice(0, 200),
    ...(prop(main, 'RRULE') ? { rrule: prop(main, 'RRULE')!.value.trim() } : {}),
    ...(exdates.length ? { exdates } : {}),
    ...(recId ? { recurrenceId: iso(recId.at) } : {}),
    ...(overrides.length ? { overrides } : {}),
    ...(prop(main, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED' ? { cancelled: true } : {}),
  };
}

/* ---------- repeats ---------- */

export const ruleParts = (rrule: string): Record<string, string> =>
  Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((kv) => kv.split('='))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
  );

/** Wall-clock parts of an instant in a zone (UTC when none). */
function wallOf(at: number, tz?: string): Wall {
  const shifted = at + (tz ? zoneOffset(tz, at) : 0) * 60_000;
  const d = new Date(shifted);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
const toInstant = (w: Wall, tz?: string) => (tz ? zonedToUtc(w.y, w.mo, w.d, w.h, w.mi, w.s, tz) : Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s));

/**
 * The occurrences of an event between two instants (most `max`), keeping the organiser's wall-clock time across
 * daylight saving. Handles the repeats calendars send almost always: every N days, weeks (on some weekdays), months
 * (on a day, or the 2nd Tuesday, last Friday...) or years, ending by a count or a date. Anything fancier returns null,
 * and the caller keeps only the first occurrence.
 */
export function occurrences(ev: Pick<IcsEvent, 'start' | 'end' | 'rrule' | 'exdates' | 'overrides' | 'tz' | 'allDay'>, from: number, until: number, max = 60): { start: string; end: string; recurrenceId?: string }[] | null {
  const start = Date.parse(ev.start);
  const len = Date.parse(ev.end) - start;
  if (!ev.rrule) return start + len >= from && start <= until ? [{ start: ev.start, end: ev.end }] : [];
  const r = ruleParts(ev.rrule);
  const freq = r.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  if (r.BYSETPOS || r.BYWEEKNO || r.BYYEARDAY || r.BYHOUR || r.BYMINUTE || r.BYSECOND) return null;
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const untilAt = r.UNTIL ? (() => {
    const w = parseWall(r.UNTIL);
    if (!w) return Infinity;
    return w.date ? Date.UTC(w.y, w.mo, w.d, 23, 59, 59) : w.utc ? Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s) : toInstant(w, ev.tz);
  })() : Infinity;
  const tz = ev.allDay ? undefined : ev.tz;
  const base = wallOf(start, tz);
  const byDay = (r.BYDAY ?? '').split(',').filter(Boolean).map((x) => x.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/)).filter((m): m is RegExpMatchArray => !!m);
  if (r.BYDAY && byDay.length !== r.BYDAY.split(',').length) return null;
  const byMonthDay = (r.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number);
  const byMonth = (r.BYMONTH ?? '').split(',').filter(Boolean).map((n) => Number(n) - 1);
  if (freq === 'WEEKLY' && byDay.some((m) => m[1])) return null;
  if (freq === 'MONTHLY' && byDay.some((m) => !m[1])) return null; // every Tuesday of the month and similar
  if ((freq === 'DAILY' || freq === 'WEEKLY') && byMonthDay.length) return null;

  // Candidate days, period by period, in order.
  const days = function* (): Generator<Wall> {
    for (let p = 0; p < 5000; p++) {
      const list: Wall[] = [];
      if (freq === 'DAILY') {
        const d = new Date(Date.UTC(base.y, base.mo, base.d + p * interval));
        if (!byDay.length || byDay.some((m) => DAYS.indexOf(m[2]) === d.getUTCDay())) list.push({ ...base, y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() });
      } else if (freq === 'WEEKLY') {
        // Weeks start on Monday (WKST=MO, what calendars send).
        const baseDow = (new Date(Date.UTC(base.y, base.mo, base.d)).getUTCDay() + 6) % 7;
        const monday = Date.UTC(base.y, base.mo, base.d - baseDow + p * 7 * interval);
        const wds = byDay.length ? byDay.map((m) => (DAYS.indexOf(m[2]) + 6) % 7).sort((a, b) => a - b) : [baseDow];
        for (const wd of wds) {
          const d = new Date(monday + wd * 86_400_000);
          list.push({ ...base, y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() });
        }
      } else if (freq === 'MONTHLY') {
        const m0 = new Date(Date.UTC(base.y, base.mo + p * interval, 1));
        const y = m0.getUTCFullYear();
        const mo = m0.getUTCMonth();
        const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        const ds = byDay.length
          ? byDay.map((m) => (m[1] ? nthWeekday(y, mo, DAYS.indexOf(m[2]), Number(m[1])) : NaN)).filter((n) => !Number.isNaN(n))
          : (byMonthDay.length ? byMonthDay : [base.d]).map((n) => (n < 0 ? dim + n + 1 : n));
        for (const d of ds.filter((d) => d >= 1 && d <= dim).sort((a, b) => a - b)) list.push({ ...base, y, mo, d });
      } else {
        const y = base.y + p * interval;
        const months = byMonth.length ? byMonth : [base.mo];
        for (const mo of months.sort((a, b) => a - b)) {
          const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
          const ds = byDay.length && byDay.every((m) => m[1]) ? byDay.map((m) => nthWeekday(y, mo, DAYS.indexOf(m[2]), Number(m[1]))) : byMonthDay.length ? byMonthDay : [base.d];
          for (const d of ds.filter((d) => d >= 1 && d <= dim)) list.push({ ...base, y, mo, d });
        }
      }
      for (const w of list) yield w;
    }
  };
  if (freq === 'YEARLY' && byDay.length && !byDay.every((m) => m[1])) return null;

  const skip = new Set((ev.exdates ?? []).map((x) => Date.parse(x)));
  const moved = new Map((ev.overrides ?? []).map((o) => [Date.parse(o.recurrenceId), o]));
  const out: { start: string; end: string; recurrenceId?: string }[] = [];
  let n = 0;
  for (const w of days()) {
    const at = ev.allDay ? Date.UTC(w.y, w.mo, w.d, 12) : toInstant(w, tz);
    if (at < start) continue; // before the series begins (other weekdays in the first week)
    if (at > untilAt || n >= count) break;
    n++;
    if (skip.has(at)) continue;
    const o = moved.get(at);
    if (o?.cancelled) continue;
    const s = o ? Date.parse(o.start) : at;
    const e = o ? Date.parse(o.end) : at + len;
    if (e >= from && s <= until) out.push({ start: iso(s), end: iso(e), recurrenceId: iso(at) });
    if (s > until || out.length >= max) break;
  }
  return out;
}

/* ---------- answering ---------- */

const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
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
  const when = (iso: string, name: string) => (ev.allDay ? `${name};VALUE=DATE:${dateOnly(iso)}` : `${name}:${stamp(Date.parse(iso))}`);
  // All-day: the stored end is a minute past noon on the last day; DTEND is the day after it.
  const endIso = ev.allDay ? new Date(Date.parse(ev.end) - 60_000 + 86_400_000).toISOString() : ev.end;
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
