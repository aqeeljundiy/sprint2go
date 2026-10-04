import type { Person, Thread } from './types';
import { isMine } from './identity';

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

export function listDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function relative(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function fullDate(iso: string) {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const lastMessage = (t: Thread) => t.messages[t.messages.length - 1];

export const snippet = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 140);

/** Names shown in the list row, e.g. "Nadia Putri, me (3)". */
export function participants(t: Thread, me: Person) {
  const seen: string[] = [];
  for (const m of t.messages) {
    const n = isMine(m.from.email) ? 'me' : m.from.name.split(' ')[0];
    if (!seen.includes(n)) seen.push(n);
  }
  if (seen.length === 1 && seen[0] !== 'me') return t.messages[0].from.name;
  if (seen.length === 1) return `To: ${t.messages[0].to.map((p) => p.name.split(' ')[0]).join(', ')}`;
  return seen.join(', ');
}

/** Unique-enough id. (crypto.randomUUID only exists on HTTPS/localhost pages.) */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** A date as YYYY-MM-DD in the user's own time zone (toISOString would give UTC, which is yesterday in Jakarta at night). */
export const localDay = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
