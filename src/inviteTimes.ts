// How an emailed invite's times go on a calendar (the server's invites.ts and the demo in the app use the same rule).

const DAY = 86_400_000;

/**
 * An invite's times as a calendar event's. All-day invites are kept at noon UTC on their dates (the invite card shows
 * them in UTC, so the dates read the same everywhere). On the calendar they become floating dates, "2026-10-20T00:00:00"
 * to midnight after the last day, which every browser reads as its own midnight: the day stays put even at +14
 * (Kiritimati), +13 (Tonga), -11 (Pago Pago) or -12, where noon UTC is already another date.
 */
export function inviteCalendarTimes(x: { start: string; end: string }, allDay?: boolean): { start: string; end: string } {
  if (!allDay) return { start: x.start, end: x.end };
  const first = new Date(Date.parse(x.start)).toISOString().slice(0, 10);
  const last = new Date(Math.max(Date.parse(x.start), Date.parse(x.end) - 60_000)).toISOString().slice(0, 10);
  const after = new Date(Date.parse(`${last}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  return { start: `${first}T00:00:00`, end: `${after}T00:00:00` };
}
