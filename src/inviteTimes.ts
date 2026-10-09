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

/** What a repeating invite says about its dates (the invite card's MailInvite, the server's IcsEvent). */
export interface InviteRepeat {
  start: string;
  end: string;
  allDay?: boolean;
  tz?: string;
  rrule?: string;
  rdates?: string[];
  exdates?: string[];
  overrides?: { recurrenceId: string; start: string; end: string; cancelled?: boolean }[];
}
/** The series fields of a calendar event (src/repeat.ts) a repeating invite becomes. */
export interface InviteSeries {
  rrule?: string;
  timeZone?: string;
  exdates?: string[];
  rdates?: string[];
  overrides?: { occurrence: string; start: string; end: string }[];
}

/**
 * A repeating invite as one repeating event: its rule, the organiser's zone (so the dates keep their clock time), the
 * skipped dates and the dates changed on their own (cancelled ones are skipped). All-day invites keep floating dates,
 * as inviteCalendarTimes writes them. Nothing for an invite that doesn't repeat.
 */
export function inviteSeries(inv: InviteRepeat): InviteSeries {
  if (!inv.rrule && !inv.rdates?.length) return {};
  // All-day: the invite writes noon UTC on each date; the event has floating midnights.
  const day = (iso: string) => (iso.length === 10 ? iso : new Date(Date.parse(iso)).toISOString().slice(0, 10));
  const at = (iso: string) => (inv.allDay ? `${day(iso)}T00:00:00` : iso);
  const moved = (inv.overrides ?? []).filter((o) => !o.cancelled);
  const exdates = [...(inv.exdates ?? []).map((x) => (inv.allDay ? day(x) : x)), ...(inv.overrides ?? []).filter((o) => o.cancelled).map((o) => at(o.recurrenceId))];
  return {
    // RDATE alone (no rule): its first date plus those.
    rrule: inv.rrule ?? 'FREQ=DAILY;COUNT=1',
    ...(inv.tz && !inv.allDay ? { timeZone: inv.tz } : {}),
    ...(exdates.length ? { exdates } : {}),
    ...(inv.rdates?.length ? { rdates: inv.rdates.map(at) } : {}),
    ...(moved.length ? { overrides: moved.map((o) => ({ occurrence: at(o.recurrenceId), ...inviteCalendarTimes(o, inv.allDay) })) } : {}),
  };
}
