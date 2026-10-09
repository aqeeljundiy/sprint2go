// Calendar reminders: an event's owner chose "Remind me 10 minutes before" (the event's `remind`, in minutes). The
// server's half-minute tick sends one notification (and so a push to their phone when they're away) and marks the
// start it reminded for in `remindedFor`, so an event moved to another time reminds again.
import { msg } from '../src/i18n/index.ts';

type Ev = { id: string; title?: string; start: string; end: string; allDay?: boolean; remind?: unknown; remindedFor?: string; userId?: string; workspaceId?: string; feed?: string };

const LATE = 6 * 3_600_000; // a reminder more than six hours late (the server was down) isn't sent any more

/** The events whose reminder is due at `now` and hasn't gone out for their current start. */
export function eventReminders<T extends Ev>(events: T[], now: number): T[] {
  return events.filter((e) => {
    if (typeof e.remind !== 'number' || e.remind < 0 || !e.userId || e.feed || e.remindedFor === e.start) return false;
    const start = Date.parse(e.start);
    const at = start - e.remind * 60_000;
    return at <= now && now - at < LATE && Date.parse(e.end) > now;
  });
}

/** “Design review” starts in 10 minutes: saved with msg(), so each reader sees it in their own language. */
export function reminderWords(e: Ev, now: number) {
  const title = String(e.title ?? 'Event').slice(0, 120);
  const mins = Math.round((Date.parse(e.start) - now) / 60_000);
  if (e.allDay) return mins > 12 * 60 ? msg('“{title}” is tomorrow', { title }) : msg('“{title}” is today', { title });
  if (mins <= 1) return msg('“{title}” is starting now', { title });
  if (mins < 60) return msg('“{title}” starts in {n} minutes', { title, n: mins });
  if (mins < 90) return msg('“{title}” starts in an hour', { title });
  if (mins < 20 * 60) return msg('“{title}” starts in {n} hours', { title, n: Math.round(mins / 60) });
  return msg('“{title}” is tomorrow', { title });
}
/** The same, in English. */
export const reminderText = (e: Ev, now: number) => reminderWords(e, now).text;
