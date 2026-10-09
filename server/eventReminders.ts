// Calendar reminders: an event's owner chose "Remind me 10 minutes before" (the event's `remind`, in minutes). The
// server's half-minute tick sends one notification (and so a push to their phone when they're away) and marks the
// start it reminded for in `remindedFor`, so an event moved to another time reminds again.

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

/** “Design review” starts in 10 minutes. */
export function reminderText(e: Ev, now: number) {
  const title = `“${String(e.title ?? 'Event').slice(0, 120)}”`;
  const mins = Math.round((Date.parse(e.start) - now) / 60_000);
  if (e.allDay) return `${title} is ${mins > 12 * 60 ? 'tomorrow' : 'today'}`;
  if (mins <= 1) return `${title} is starting now`;
  if (mins < 60) return `${title} starts in ${mins} minutes`;
  if (mins < 90) return `${title} starts in an hour`;
  if (mins < 20 * 60) return `${title} starts in ${Math.round(mins / 60)} hours`;
  return `${title} is tomorrow`;
}
