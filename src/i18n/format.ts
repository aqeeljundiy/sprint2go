// Dates, times, numbers and money in the person's language, through Intl ('en-GB' or 'id-ID'). Use these instead of
// hard-coded month and weekday names or toLocale…('en-GB'): "Thu 8 Oct, 14:30" becomes "Kam, 8 Okt, 14.30".
// No React here: the server and the unit tests can import it (they get English).
import { locale, onLang, t, tn } from './index';

type DateIn = Date | string | number;

/** Days written as YYYY-MM-DD are read at local noon (so a time zone never moves them to the day before). */
export const toDate = (d: DateIn): Date => (d instanceof Date ? d : typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d));

const dateFmts = new Map<string, Intl.DateTimeFormat>();
const numFmts = new Map<string, Intl.NumberFormat>();
onLang(() => (dateFmts.clear(), numFmts.clear()));

function dtf(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale() + JSON.stringify(opts);
  let f = dateFmts.get(key);
  if (!f) dateFmts.set(key, (f = new Intl.DateTimeFormat(locale(), opts)));
  return f;
}

/** Any date with Intl options, in the active language. The named helpers below cover most needs. */
export const fmtDate = (d: DateIn, opts: Intl.DateTimeFormatOptions) => dtf(opts).format(toDate(d));

const thisYear = (d: Date) => d.getFullYear() === new Date().getFullYear();

/** "8 Oct" / "8 Okt", with the year when it isn't this one ("8 Oct 2025"). */
export const fmtDay = (d: DateIn) => {
  const x = toDate(d);
  return fmtDate(x, thisYear(x) ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};
/** "8 October 2026" / "8 Oktober 2026". */
export const fmtDayLong = (d: DateIn) => fmtDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
/** "Thu 8 Oct" / "Kam, 8 Okt" (with the year when it isn't this one). */
export const fmtWeekday = (d: DateIn) => {
  const x = toDate(d);
  return fmtDate(x, thisYear(x) ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
/** "Thursday 8 October" / "Kamis, 8 Oktober": a heading for a day. */
export const fmtWeekdayLong = (d: DateIn) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
/** "October 2026" / "Oktober 2026". */
export const fmtMonth = (d: DateIn) => fmtDate(d, { month: 'long', year: 'numeric' });
/** "14:30" / "14.30" (24 hours, as the app's time fields). */
export const fmtTime = (d: DateIn) => fmtDate(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "Thu 8 Oct, 14:30" / "Kam, 8 Okt, 14.30". */
export const fmtDateTime = (d: DateIn) => {
  const x = toDate(d);
  return fmtDate(x, { weekday: 'short', day: 'numeric', month: 'short', ...(thisYear(x) ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};

/**
 * Weekday names, Monday first unless asked: long "Monday", short "Mon", narrow "M" (the date picker's column heads).
 * Indonesian: Senin, Sen, S.
 */
export function weekdayNames(width: 'long' | 'short' | 'narrow' = 'long', from: 'monday' | 'sunday' = 'monday'): string[] {
  const f = dtf({ weekday: width });
  // 4 January 2026 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 0, 4 + i + (from === 'monday' ? 1 : 0), 12)));
}
/** One weekday's name, 0 is Sunday (as Date.getDay()). */
export const weekdayName = (day: number, width: 'long' | 'short' | 'narrow' = 'long') => weekdayNames(width, 'sunday')[day];

/** Month names: long "January", short "Jan". Indonesian: Januari, Jan. */
export function monthNames(width: 'long' | 'short' = 'long'): string[] {
  const f = dtf({ month: width });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(2026, i, 15, 12)));
}

/** A number the local way: 1,234.5 / 1.234,5. */
export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  const key = locale() + JSON.stringify(opts ?? {});
  let f = numFmts.get(key);
  if (!f) numFmts.set(key, (f = new Intl.NumberFormat(locale(), opts)));
  return f.format(n);
}
/** A share: 0.42 → "42%". */
export const fmtPercent = (share: number, digits = 0) => fmtNumber(share, { style: 'percent', maximumFractionDigits: digits });

/**
 * Money. Rupiah is written "Rp 39.000" in both languages (as everywhere in the app and on the landing page); other
 * currencies the local way ("US$12.50" / "US$12,50").
 */
export function fmtMoney(amount: number, currency = 'IDR', opts?: Intl.NumberFormatOptions): string {
  if (currency === 'IDR') return 'Rp ' + Math.round(amount).toLocaleString('id-ID');
  return fmtNumber(amount, { style: 'currency', currency, ...opts });
}

/** "Laura, Thomas and Isabel" / "Laura, Thomas, dan Isabel". `or`: "Laura or Thomas" / "Laura atau Thomas". */
export function fmtList(items: string[], kind: 'and' | 'or' = 'and'): string {
  try {
    return new Intl.ListFormat(locale(), { type: kind === 'or' ? 'disjunction' : 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/** How long ago: "just now", "5 min ago", "3 hours ago", "2 days ago", then the date. */
export function fmtAgo(when: DateIn, now = Date.now()): string {
  const mins = Math.round((now - toDate(when).getTime()) / 60_000);
  if (mins < 1) return t('just now');
  if (mins < 60) return tn(mins, '{n} min ago', '{n} min ago');
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return tn(hrs, '{n} hour ago', '{n} hours ago');
  const days = Math.round(hrs / 24);
  if (days < 7) return tn(days, '{n} day ago', '{n} days ago');
  return fmtDay(when);
}

/** A day relative to today, for labels: Today, Tomorrow, Yesterday, else the weekday and date. */
export function fmtDayWord(day: DateIn, today = new Date()): string {
  const a = toDate(day);
  const b = toDate(today);
  const diff = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Tomorrow');
  if (diff === -1) return t('Yesterday');
  return fmtWeekday(a);
}
