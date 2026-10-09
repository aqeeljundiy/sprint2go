// Calendar reminders: an event's owner chose "Remind me 10 minutes before" (the event's `remind`, in minutes). The
// server's half-minute tick sends one notification (and so a push to their phone when they're away) and marks the
// start it reminded for in `remindedFor`, so an event moved to another time reminds again. A repeating event reminds
// for each of its dates: `remindedFor` on the series holds the date it last reminded for.
import { expandSeries } from '../src/repeat.ts';
import type { CalEvent } from '../src/types.ts';
import { msg } from '../src/i18n/index.ts';

type Ev = { id: string; title?: string; start: string; end: string; allDay?: boolean; remind?: unknown; remindedFor?: string; userId?: string; workspaceId?: string; feed?: string; rrule?: string; seriesId?: string };

const LATE = 6 * 3_600_000; // a reminder more than six hours late (the server was down) isn't sent any more

const due = (e: Ev, remindedFor: string | undefined, now: number) => {
  if (typeof e.remind !== 'number' || e.remind < 0 || remindedFor === e.start) return false;
  const at = Date.parse(e.start) - e.remind * 60_000;
  return at <= now && now - at < LATE && Date.parse(e.end) > now;
};

/**
 * The reminders due at `now` that haven't gone out for their start: events, and for a repeating event the one date
 * whose reminder is due (with `seriesId` saying which stored event to mark).
 */
export function eventReminders<T extends Ev>(events: T[], now: number): T[] {
  const out: T[] = [];
  for (const e of events) {
    if (typeof e.remind !== 'number' || e.remind < 0 || !e.userId || e.feed) continue;
    if (!e.rrule) {
      if (due(e, e.remindedFor, now)) out.push(e);
      continue;
    }
    // The dates whose reminder could be due now (a date may have a reminder of its own); the latest one goes.
    const dates = expandSeries(e as unknown as CalEvent, now - LATE, now + Math.max(e.remind, 1440) * 60_000 + 60_000) as unknown as T[];
    const hit = dates.filter((d) => due(d, e.remindedFor, now)).sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
    if (hit) out.push(hit);
  }
  return out;
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
