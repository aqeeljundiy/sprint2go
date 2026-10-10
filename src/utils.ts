import type { Person, Thread } from './types';
import { isMine } from './identity';
import { t, tn } from './i18n/index'; // the full path: the server imports this file too
import { fmtDate, fmtTime } from './i18n/format';

const AVATAR_COLORS = ['#5b5bf6', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#d946ef', '#14b8a6', '#f97316'];

export function avatarColor(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** A list row's date, in the person's language: the time today, "8 Oct" this year, "08/10/25" before. */
export function listDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(d);
  if (d.getFullYear() === now.getFullYear()) return fmtDate(d, { day: 'numeric', month: 'short' });
  return fmtDate(d, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** "just now", "5 min ago", "3 hours ago", "12 days ago", in the person's language. */
export function relative(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return t('just now');
  if (mins < 60) return tn(mins, '{n} min ago', '{n} min ago');
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return tn(hrs, '{n} hour ago', '{n} hours ago');
  const days = Math.round(hrs / 24);
  return tn(days, '{n} day ago', '{n} days ago');
}

/** "Thu 8 Oct, 14:30" / "Kam, 8 Okt, 14.30". */
export function fullDate(iso: string) {
  return fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export const lastMessage = (t: Thread) => t.messages[t.messages.length - 1];

export const snippet = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 140);

/** Names shown in the list row, e.g. "Laras Anindita, me (3)". */
const ME = '\u0000me'; // you, among the names (written "me" in the person's language)
export function participants(th: Thread, me: Person) {
  const seen: string[] = [];
  for (const m of th.messages) {
    const n = isMine(m.from.email) ? ME : m.from.name.split(' ')[0];
    if (!seen.includes(n)) seen.push(n);
  }
  if (seen.length === 1 && seen[0] !== ME) return th.messages[0].from.name;
  if (seen.length === 1) return t('To: {names}', { names: th.messages[0].to.map((p) => p.name.split(' ')[0]).join(', ') });
  return seen.map((n) => (n === ME ? t('me') : n)).join(', ');
}

/** Unique-enough id. (crypto.randomUUID only exists on HTTPS/localhost pages.) */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** A date as YYYY-MM-DD in the user's own time zone (toISOString would give UTC, which is yesterday in Jakarta at night). */
export const localDay = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The next due date for a repeating task (from its due date, or today). */
export function nextDue(due: string | undefined, repeat: 'daily' | 'weekdays' | 'weekly' | 'monthly'): string {
  const d = due ? new Date(due + 'T12:00:00') : new Date();
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  if (repeat === 'weekdays') do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  if (repeat === 'monthly') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return localDay(d);
}

/** Adds working days (skips weekends) to a YYYY-MM-DD date. */
export function addWorkdays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00');
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return localDay(d);
}
