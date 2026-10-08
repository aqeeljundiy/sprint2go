// When the server's scheduled jobs run, in local time: channel summaries (daily, weekly, monthly) and the email
// digest. Shared by the server, which runs them, and the app, which says when the next one comes.

/** The company's time zone for its scheduled jobs (companies don't pick one yet; sprint2go starts in Indonesia). */
export const COMPANY_TZ = 'Asia/Jakarta';
/** Scheduled channel summaries are written from this local hour on the day they're due. */
export const SUMMARY_HOUR = 6;
/** A summary missed while the server was down is still written this many days late, never later. */
const CATCH_UP_DAYS = 2;
/** The daily email digest goes out from this local hour (until noon, then that day is skipped). */
export const DIGEST_HOUR = 9;

export type SummarySchedule = 'off' | 'daily' | 'weekly' | 'monthly';
export type DigestEvery = 'off' | 'hourly' | 'daily';

const fmts = new Map<string, Intl.DateTimeFormat>();
const make = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    try {
      f = make(tz);
    } catch {
      f = make(COMPANY_TZ); // an unknown zone counts as the company's
    }
    fmts.set(tz, f);
  }
  return f;
}

/** A moment as a calendar day (YYYY-MM-DD), hour, minute and weekday (0 = Sunday) in a time zone. */
export function localParts(at: number, tz = COMPANY_TZ) {
  const p = Object.fromEntries(fmtFor(tz).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** The moment it's this hour on this local day in a time zone. */
export function zonedTime(day: string, hour: number, tz = COMPANY_TZ) {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  const offset = (at: number) => {
    const p = localParts(at, tz);
    const [py, pm, pd] = p.day.split('-').map(Number);
    return Date.UTC(py, pm - 1, pd, p.hour, p.minute) - Math.floor(at / 60_000) * 60_000;
  };
  const first = wall - offset(wall);
  const second = wall - offset(first);
  return second;
}

export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const spoken = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** The latest day, up to and including `day`, that a summary on this schedule is written: every day, Mondays, the 1st. */
export function runDayOn(schedule: Exclude<SummarySchedule, 'off'>, day: string) {
  if (schedule === 'daily') return day;
  if (schedule === 'weekly') return addDays(day, -((weekdayOf(day) + 6) % 7));
  return `${day.slice(0, 8)}01`;
}

export interface SummaryPeriod {
  key: string; // the same period always has the same key, so it's written once
  from: string; // first day (local)
  to: string; // the day after the last one (local)
  label: string; // "Thursday 8 October", "Week of 28 September", "September 2026"
}
/** What a summary written on this run day covers: the day, the week (Monday to Sunday) or the month before. */
export function summaryPeriod(schedule: Exclude<SummarySchedule, 'off'>, runDay: string): SummaryPeriod {
  if (schedule === 'daily') {
    const from = addDays(runDay, -1);
    return { key: `daily:${from}`, from, to: runDay, label: `${DAYS[weekdayOf(from)]} ${spoken(from)}` };
  }
  if (schedule === 'weekly') {
    const from = addDays(runDay, -7);
    return { key: `weekly:${from}`, from, to: runDay, label: `Week of ${spoken(from)}` };
  }
  const from = `${addDays(runDay, -1).slice(0, 8)}01`;
  return { key: `monthly:${from.slice(0, 7)}`, from, to: runDay, label: `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` };
}

/**
 * The summary to write now, if one is due and wasn't written (or skipped) yet. `catchUp`: the schedule ran before, so
 * a run missed in the last couple of days (the server was down) is still owed. A schedule that never ran starts on
 * its next run day, so switching one on (or a new server) never writes a pile of old summaries at once.
 */
export function summaryDue(schedule: SummarySchedule | undefined, lastKey: string | undefined, now: number, tz = COMPANY_TZ, catchUp = lastKey !== undefined): SummaryPeriod | null {
  if (!schedule || schedule === 'off') return null;
  const { day, hour } = localParts(now, tz);
  // The latest run that has started: today's from the hour, else the one before.
  const run = runDayOn(schedule, hour >= SUMMARY_HOUR ? day : addDays(day, -1));
  if (run !== day && (!catchUp || daysBetween(run, day) > CATCH_UP_DAYS)) return null;
  const p = summaryPeriod(schedule, run);
  return p.key === lastKey ? null : p;
}

/**
 * A channel's summary schedule. Channels start on Monthly (as the channel dialog says); direct messages get none
 * unless someone switches it on. `digest` is the old name for Daily.
 */
export const channelSchedule = (c: { kind?: string; digest?: boolean; summary?: { schedule?: SummarySchedule } }): SummarySchedule =>
  c.summary?.schedule ?? (c.digest ? 'daily' : c.kind === 'dm' ? 'off' : 'monthly');

export const SUMMARY_TRIES = 6;
/** What the server last did for a channel's schedule. A failed run is tried again for a few hours, then left. */
export interface SummaryRun {
  key: string; // the period (SummaryPeriod.key)
  state: 'done' | 'nothing' | 'off' | 'failed';
  at: string;
  label?: string; // the period in words
  why?: string; // 'off' and 'failed': what's missing or what went wrong
  tries?: number;
  retryAt?: string;
}
/** The period last settled (written, skipped, or given up on): the next one is due after it. */
export const settledKey = (last: SummaryRun | undefined) => (last && (last.state !== 'failed' || (last.tries ?? 0) >= SUMMARY_TRIES) ? last.key : undefined);

/** The local day the next scheduled summary is written: today when it's due (or due later today), else the next run day. */
export function nextSummaryDay(schedule: SummarySchedule | undefined, lastKey: string | undefined, now: number, tz = COMPANY_TZ, catchUp = lastKey !== undefined): string | null {
  if (!schedule || schedule === 'off') return null;
  const { day, hour } = localParts(now, tz);
  if (summaryDue(schedule, lastKey, now, tz, catchUp)) return day;
  if (runDayOn(schedule, day) === day && hour < SUMMARY_HOUR && summaryPeriod(schedule, day).key !== lastKey) return day;
  let d = addDays(day, 1);
  while (runDayOn(schedule, d) !== d) d = addDays(d, 1);
  return d;
}
