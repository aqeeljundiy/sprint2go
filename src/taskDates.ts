// Dates for tasks, as days (YYYY-MM-DD in the person's own time): what a due date means today (its colour), the short
// words a row shows, the days people pick when they reschedule, and the exact times a snooze lands on. No React and no
// browser here, so the server and the unit tests use the same rules (scripts/unit-tests.mjs). The words come in the
// person's language (docs/i18n.md); the server and the unit tests get English.
import { t, tx } from './i18n/index'; // full paths: the server and the unit tests import this file
import { fmtDate, fmtTime, weekdayName } from './i18n/format';

export type DateTone = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';

// English names, for reading what people type (Quick Add). On screen, days and months come from src/i18n/format.ts.
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON_SHORT = MONTHS.map((m) => m.slice(0, 3));

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date as its local day. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A day at local noon (safe from daylight-saving edges). */
export const dayDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const addDays = (day: string, n: number) => {
  const d = dayDate(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
/** The same day n months on, kept inside the month (31 Jan + 1 month is 28 or 29 Feb). */
export const addMonths = (day: string, n: number) => {
  const d = dayDate(day);
  const want = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(want, last));
  return isoDay(d);
};
/** 0 is Sunday. */
export const weekdayOf = (day: string) => dayDate(day).getDay();
/** Days from a to b (b later is positive). */
export const daysBetween = (a: string, b: string) => Math.round((dayDate(b).getTime() - dayDate(a).getTime()) / 86_400_000);
/** The first day on or after `day` that falls on weekday `wd` (0 Sunday). */
export const onOrAfter = (day: string, wd: number) => addDays(day, (wd - weekdayOf(day) + 7) % 7);
/** The first day strictly after `day` on weekday `wd`. */
export const nextOn = (day: string, wd: number) => addDays(day, (wd - weekdayOf(day) + 7) % 7 || 7);
/** The Monday of the week `day` is in (weeks start on Monday). */
export const weekStart = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));

/**
 * What a due date means today, as a colour: red overdue, green today, amber tomorrow, purple within the week,
 * grey later. Rows, cards, the task panel and Home all colour dates this way.
 */
export function dateTone(due: string, today: string): DateTone {
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due === addDays(today, 1)) return 'tomorrow';
  if (due <= addDays(today, 6)) return 'week';
  return 'later';
}

const sameYear = (day: string, today: string) => day.slice(0, 4) === today.slice(0, 4);
/** "13 Oct" / "13 Okt", with the year when it isn't this one. */
export function shortDay(day: string, today: string) {
  return sameYear(day, today) ? fmtDate(day, { day: 'numeric', month: 'short' }) : fmtDate(day, { day: 'numeric', month: 'short', year: 'numeric' });
}
/** "Fri 9 Oct" / "Jum, 9 Okt", with the year when it isn't this one. */
export function weekdayDay(day: string, today: string) {
  return fmtDate(day, sameYear(day, today) ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** The words for a due date on a row: Yesterday, Today, Tomorrow, the weekday within a week, else "13 Oct". */
export function dueText(due: string, today: string): string {
  const n = daysBetween(today, due);
  if (n === -1) return t('Yesterday');
  if (n === 0) return t('Today');
  if (n === 1) return t('Tomorrow');
  if (n > 1 && n <= 6) return weekdayName(weekdayOf(due));
  return shortDay(due, today);
}

/** A day heading in Upcoming and the date sections: "Today · Fri 9 Oct", "Mon 12 Oct". */
export function dayHeading(day: string, today: string) {
  const date = weekdayDay(day, today);
  const n = daysBetween(today, day);
  return n === 0 ? t('Today · {date}', { date }) : n === 1 ? t('Tomorrow · {date}', { date }) : n === -1 ? t('Yesterday · {date}', { date }) : date;
}

export interface DayChoice {
  id: 'today' | 'tomorrow' | 'weekend' | 'nextweek' | 'none';
  label: string;
  day: string; // '' for no date
  hint: string; // the day it lands on ("Sat 10 Oct")
}

/** The quick choices for a new due date: Today, Tomorrow, This weekend, Next week, and No date. */
export function dayChoices(today: string, current?: string): DayChoice[] {
  const hint = (day: string) => fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short' });
  const tomorrow = addDays(today, 1);
  const sat = onOrAfter(today, 6);
  const wd = weekdayOf(today);
  const out: DayChoice[] = [
    { id: 'today', label: t('Today'), day: today, hint: hint(today) },
    { id: 'tomorrow', label: t('Tomorrow'), day: tomorrow, hint: hint(tomorrow) },
  ];
  // This weekend only makes sense on a weekday (and isn't tomorrow already).
  if (wd >= 1 && wd <= 4) out.push({ id: 'weekend', label: t('This weekend'), day: sat, hint: hint(sat) });
  const mon = nextOn(today, 1);
  if (mon !== tomorrow) out.push({ id: 'nextweek', label: t('Next week'), day: mon, hint: hint(mon) });
  if (current) out.push({ id: 'none', label: t('No date'), day: '', hint: '' });
  return out;
}

/** "09:00", in 24 hours (the app's own clock style): for code and what's saved. On screen: clockText. */
export const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** A time on screen: "09:00" / "09.00". */
export const clockText = (d: Date) => fmtTime(d);
/** "15:00" (as Quick Add keeps a time) on screen: "15:00" / "15.00". */
export const hhmmText = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2026, 0, 1, h, m);
  return fmtTime(d);
};

export interface SnoozeChoice {
  id: 'hour' | 'evening' | 'tomorrow' | 'nextweek';
  label: string;
  at: Date;
  hint: string; // the exact time it comes back ("Tomorrow, 09:00")
}

/** Snooze a team-queue task until: In an hour, This evening, Tomorrow morning, Next week. Each says exactly when. */
export function snoozeChoices(now: Date): SnoozeChoice[] {
  const today = isoDay(now);
  const at = (day: string, h: number, m = 0) => {
    const d = dayDate(day);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const hour = new Date(now.getTime() + 60 * 60_000);
  hour.setSeconds(0, 0);
  const minutes = hour.getMinutes();
  if (minutes % 5) hour.setMinutes(minutes + (5 - (minutes % 5))); // round up to five minutes
  const tomorrow = addDays(today, 1);
  const monday = nextOn(today, 1);
  const say = (d: Date) => {
    const day = isoDay(d);
    const n = daysBetween(today, day);
    const when = n === 0 ? t('Today') : n === 1 ? t('Tomorrow') : fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
    return t('{day}, {time}', { day: when, time: fmtTime(d) });
  };
  const out: SnoozeChoice[] = [{ id: 'hour', label: t('In an hour'), at: hour, hint: say(hour) }];
  const evening = at(today, 18);
  if (now.getTime() < evening.getTime() - 90 * 60_000) out.push({ id: 'evening', label: t('This evening'), at: evening, hint: say(evening) });
  out.push({ id: 'tomorrow', label: t('Tomorrow morning'), at: at(tomorrow, 9), hint: say(at(tomorrow, 9)) });
  out.push({ id: 'nextweek', label: t('Next week'), at: at(monday, 9), hint: say(at(monday, 9)) });
  return out;
}

/**
 * Moving several tasks to one day ("Reschedule all", Plan my day, a bulk Date): the changes to make, and the
 * changes that put everything back for Undo. Tasks already on that day are left alone.
 */
export function reschedule<T extends { id: string; due?: string }>(tasks: T[], day: string) {
  const moved = tasks.filter((t) => (t.due ?? '') !== day);
  return {
    patches: moved.map((t) => ({ id: t.id, due: day || undefined })),
    undo: moved.map((t) => ({ id: t.id, due: t.due })),
  };
}

/** Which date section a task sits in on My tasks: Overdue, Today, Tomorrow, This week, Later, No date. */
export type DateGroup = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';
/** The sections, with their names in the reader's language. */
export const DATE_GROUPS: { id: DateGroup; label: string }[] = [
  {
    id: 'overdue',
    get label() {
      return tx('due', 'Overdue');
    },
  },
  {
    id: 'today',
    get label() {
      return t('Today');
    },
  },
  {
    id: 'tomorrow',
    get label() {
      return t('Tomorrow');
    },
  },
  {
    id: 'week',
    get label() {
      return t('This week');
    },
  },
  {
    id: 'later',
    get label() {
      return t('Later');
    },
  },
  {
    id: 'none',
    get label() {
      return t('No date');
    },
  },
];
export const dateGroup = (due: string | undefined, today: string): DateGroup => (due ? dateTone(due, today) : 'none');
