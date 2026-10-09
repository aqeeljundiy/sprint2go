// Calendar invites that arrive by email: which part of the email is the invite, the calendar events an answer puts in
// sprint2go Calendar, and what an update or a cancellation from the organiser does to them.
import type { ParsedMail } from 'mailparser';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { parseInvite, parseRRule, type IcsEvent } from './ics.ts';
import { inviteCalendarTimes, inviteSeries } from '../src/inviteTimes.ts';
import { occId } from '../src/repeat.ts';
import { mark, msg, phrase } from '../src/i18n/index.ts';
import { datePhrase, type Said } from './lang.ts';

type Att = ParsedMail['attachments'][number];
export type StoredInvite = IcsEvent & { you?: string; answer?: { status: Rsvp; at: string; by: string; sent: boolean } };
export type Rsvp = 'accepted' | 'tentative' | 'declined';
type Account = { id: string; email: string; users?: string[] };

const isCalendar = (a: Att) => /^(text\/calendar|application\/ics)\b/i.test(a.contentType ?? '') || /\.ics$/i.test(a.filename ?? '');

/**
 * The invite in an email, and the attachments worth listing. Calendars send the invite twice: as an unnamed part next
 * to the text (that one carries the method) and as invite.ics. Only one .ics stays in the list.
 */
export function readInvite(attachments: Att[], to: string[]): { invite: StoredInvite | null; attachments: Att[] } {
  const cals = attachments.filter(isCalendar);
  if (!cals.length) return { invite: null, attachments };
  let invite: IcsEvent | null = null;
  for (const a of [...cals].sort((x, y) => Number(!/^text\/calendar/i.test(x.contentType)) - Number(!/^text\/calendar/i.test(y.contentType)))) {
    invite = parseInvite(a.content);
    if (invite) break;
  }
  if (!invite) return { invite: null, attachments };
  const keep = cals.find((a) => a.filename) ?? cals[0];
  if (!keep.filename) keep.filename = 'invite.ics';
  const mine = new Set(to.map((x) => x.toLowerCase()));
  const you = invite.attendees.find((a) => mine.has(a.email))?.email;
  return { invite: { ...invite, description: cleanDescription(invite.description), ...(you ? { you } : {}) }, attachments: attachments.filter((a) => !isCalendar(a) || a === keep) };
}

/** Drops the joining instructions calendars paste into the description (the card has a Join button). */
export function cleanDescription(d: string | undefined): string | undefined {
  if (!d) return d;
  const out = d
    .replace(/-::~[:~]*::-[\s\S]*?(-::~[:~]*::-|$)/g, '') // Google's "Please do not edit this section" block
    .replace(/_{20,}[\s\S]*?(Microsoft Teams|Join the meeting|Join on your computer)[\s\S]*?(_{20,}|$)/gi, '') // Teams
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out ? out.slice(0, 1000) : undefined;
}

const hex = () => randomBytes(6).toString('hex');
export const isRsvp = (v: unknown): v is Rsvp => v === 'accepted' || v === 'tentative' || v === 'declined';

/** A date of an invite (an ISO start, noon UTC for an all-day one) the way our event writes its dates. */
export const dateOfInvite = (inv: Pick<StoredInvite, 'allDay'>, iso: string) => (inv.allDay ? `${new Date(Date.parse(iso)).toISOString().slice(0, 10)}T00:00:00` : new Date(Date.parse(iso)).toISOString());

/**
 * The event an invite becomes in one person's calendar: one event, and for a repeating invite one repeating event (its
 * rule, the organiser's zone, the skipped and the changed dates: src/inviteTimes.ts inviteSeries), not a copy per
 * date. A repeat calendars don't use for events (hourly and finer) puts only the first date there: `firstOnly`.
 * `rsvp`: the answer for all of it (none yet when only some dates were answered).
 */
export function eventsFor(inv: StoredInvite, o: { userId: string; workspaceId: string; threadId: string; rsvp?: Rsvp; mine: string[] }): { docs: db.Doc[]; firstOnly: boolean } {
  const firstOnly = !!inv.rrule && !parseRRule(inv.rrule);
  const me = new Set(o.mine.map((x) => x.toLowerCase()));
  const guests = [...(inv.organizer ? [inv.organizer] : []), ...inv.attendees]
    .filter((p, i, all) => !me.has(p.email) && all.findIndex((x) => x.email === p.email) === i)
    .map((p) => ({ name: p.name, email: p.email }))
    .slice(0, 50);
  const repeats = !!inv.rrule && !firstOnly;
  const doc = {
    id: 'ev-' + hex(),
    title: inv.title,
    calendarId: 'work',
    ...inviteCalendarTimes(inv, inv.allDay), // all-day: floating dates, so the day never shifts with the viewer's zone
    ...(inv.allDay ? { allDay: true } : {}),
    ...(repeats ? inviteSeries(inv) : {}),
    ...(inv.location ? { location: inv.location } : {}),
    ...(inv.url ? { meetUrl: inv.url } : {}),
    ...(guests.length ? { guests } : {}),
    ...(inv.description ? { notes: inv.description } : {}),
    threadId: o.threadId,
    workspaceId: o.workspaceId,
    userId: o.userId,
    createdBy: o.userId,
    inviteUid: inv.uid,
    sequence: inv.sequence,
    // Which date of the invite a single event is (its original start, as the invite writes it): one date of a series
    // the organiser invited us to, or an all-day event's own day (its start on the calendar floats, so matching uses this).
    ...(repeats ? {} : inv.recurrenceId ? { occurrence: inv.recurrenceId } : inv.allDay ? { occurrence: inv.start } : {}),
    ...(o.rsvp ? { rsvp: o.rsvp } : {}),
    ...(inv.organizer ? { organizer: inv.organizer } : {}),
  };
  return { docs: [doc], firstOnly };
}

/** This person's events from an invite, in one company. */
export const eventsOf = (uid: string, workspaceId: string, userIds: string[]) =>
  (db.allDocs('events') as any[]).filter((e) => e.inviteUid === uid && e.workspaceId === workspaceId && userIds.includes(e.userId));

type Broadcast = (coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) => void;
type Notify = (userIds: string[], workspaceId: string, text: Said, link?: string) => void; // msg(): each reader's language

/**
 * An invite email for an event people here already answered: an update moves their events (a newer version only),
 * a cancellation takes them off the calendar. Either way they're told. A repeating invite is one repeating event here:
 * a change or cancellation of one of its dates changes or leaves out that date, and what each person answered for
 * which dates stays. A REPLY is a guest answering an invite we sent (applyReply).
 */
export function applyInbound(ws: { id: string }, account: Account, inv: StoredInvite, threadId: string, broadcast: Broadcast, notify: Notify) {
  if (inv.method === 'REPLY') return applyReply(ws, account, inv, broadcast, notify);
  const evs = eventsOf(inv.uid, ws.id, account.users ?? []);
  if (!evs.length) return;
  const who = inv.organizer?.name ?? phrase('The organiser');
  const write = (next: db.Doc[], gone: any[]) => {
    db.writeDocs('events', next, gone.map((e) => e.id), null);
    if (gone.length) broadcast('events', [], gone.map((e) => e.id), undefined, gone);
    if (next.length) broadcast('events', next, []);
  };
  if (inv.method === 'CANCEL' || inv.cancelled) {
    if (inv.recurrenceId) {
      // One date off: a series leaves it out; a copy of that one date (from before series) goes.
      const at = dateOfInvite(inv, inv.recurrenceId);
      const series = evs.filter((e) => e.rrule);
      const next = series.map((s) => ({ ...s, exdates: [...new Set([...(s.exdates ?? []), at])], overrides: (s.overrides ?? []).filter((o: any) => Date.parse(o.occurrence) !== Date.parse(at)) }));
      const gone = evs.filter((e) => !e.rrule && (e.occurrence ?? e.start) === inv.recurrenceId);
      if (!next.length && !gone.length) return;
      write(next, gone);
      notify([...new Set([...series, ...gone].map((e) => e.userId as string))], ws.id, msg('{name} cancelled “{title}” on one of its dates. It’s off your calendar.', { name: who, title: inv.title }), '/mail');
      return;
    }
    write([], evs);
    notify([...new Set(evs.map((e) => e.userId as string))], ws.id, msg('{name} cancelled “{title}”. It’s off your calendar.', { name: who, title: inv.title }), '/mail');
    return;
  }
  if (inv.method !== 'REQUEST' && inv.method !== 'PUBLISH') return;
  const known = Math.max(...evs.map((e) => Number(e.sequence) || 0));
  if (inv.sequence < known) return; // an older copy arriving late
  const changed: string[] = [];
  const sig = (list: any[]) => JSON.stringify(list.map((e) => [e.title, e.start, e.end, e.location ?? '', e.meetUrl ?? '', e.rrule ?? '', e.exdates ?? [], (e.overrides ?? []).map((o: any) => [o.occurrence, o.start, o.end, o.title ?? ''])]).sort());
  for (const userId of new Set(evs.map((e) => e.userId as string))) {
    const mine = evs.filter((e) => e.userId === userId);
    const series = mine.find((e) => e.rrule);
    let next: db.Doc[];
    let drop: any[];
    if (inv.recurrenceId && !inv.rrule && series) {
      // One date of the repeating event moved or changed: that date gets its own times and details.
      const at = dateOfInvite(inv, inv.recurrenceId);
      const times = inviteCalendarTimes(inv, inv.allDay ?? series.allDay);
      const others = (series.overrides ?? []).filter((o: any) => Date.parse(o.occurrence) !== Date.parse(at));
      const own = (series.overrides ?? []).find((o: any) => Date.parse(o.occurrence) === Date.parse(at));
      const o = {
        ...own,
        occurrence: at,
        ...(Date.parse(times.start) !== Date.parse(at) || Date.parse(times.end) - Date.parse(times.start) !== Date.parse(series.end) - Date.parse(series.start) ? times : {}),
        ...(inv.title !== series.title ? { title: inv.title } : {}),
        ...((inv.location ?? '') !== (series.location ?? '') ? { location: inv.location ?? null } : {}),
        ...((inv.url ?? '') !== (series.meetUrl ?? '') ? { meetUrl: inv.url ?? null } : {}),
      };
      next = [{ ...series, overrides: [...others, o], sequence: inv.sequence }];
      drop = [];
      if (sig([series]) === sig(next)) continue;
    } else if (inv.recurrenceId && !inv.rrule) {
      // One date of a repeating event, from before repeating invites were one event: that copy moves.
      const one = mine.find((e) => (e.occurrence ?? e.start) === inv.recurrenceId);
      if (!one) continue;
      next = [{ ...one, title: inv.title, ...inviteCalendarTimes(inv, inv.allDay ?? one.allDay), location: inv.location, meetUrl: inv.url ?? one.meetUrl, sequence: inv.sequence }];
      drop = [];
      if (sig([one]) === sig(next)) continue;
    } else {
      // The whole event again: what this person did with it stays (their answers, reminder, which calendar it's in,
      // the id an open event has), for the dates that are still there.
      const keep = series ?? (!inv.rrule && mine.length === 1 ? mine[0] : undefined);
      const made = eventsFor(inv, { userId, workspaceId: ws.id, threadId: mine[0].threadId ?? threadId, rsvp: keep ? keep.rsvp : isRsvp(mine[0].rsvp) ? mine[0].rsvp : 'accepted', mine: [account.email, inv.you ?? ''] }).docs[0] as any;
      if (keep) {
        const answered = (keep.overrides ?? []).filter((o: any) => o.rsvp).map((o: any) => ({ occurrence: o.occurrence, rsvp: o.rsvp }));
        const overrides = [...(made.overrides ?? [])];
        for (const a of answered) {
          const same = overrides.find((o: any) => Date.parse(o.occurrence) === Date.parse(a.occurrence));
          if (same) same.rsvp = a.rsvp;
          else overrides.push(a);
        }
        Object.assign(made, {
          id: keep.id,
          ...(keep.rsvpFrom ? { rsvpFrom: keep.rsvpFrom } : {}),
          ...(overrides.length ? { overrides } : {}),
          ...(keep.remind !== undefined ? { remind: keep.remind } : {}),
          ...(keep.remindedFor ? { remindedFor: keep.remindedFor } : {}),
          calendarId: keep.calendarId ?? made.calendarId,
        });
      } else {
        // Copies of each date from before: the new event takes the place of all of them.
        const first = mine.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)))[0];
        if (!inv.rrule && first) made.id = first.id;
      }
      next = [made];
      drop = mine;
      if (sig(mine) === sig(next)) continue;
    }
    const keepIds = new Set(next.map((d) => d.id));
    write(next, drop.filter((e) => !keepIds.has(e.id)));
    changed.push(userId);
  }
  if (changed.length) notify(changed, ws.id, inv.recurrenceId && !inv.rrule ? msg('{name} changed “{title}” on one of its dates. Your calendar has the new details.', { name: who, title: inv.title }) : msg('{name} changed “{title}”. Your calendar has the new details.', { name: who, title: inv.title }), '/mail');
}

// The owner's notice, in each reader's language: one sentence per answer, with the dates when it's about some of them.
const ANSWERED: Record<string, [string, string]> = {
  accepted: [mark('{name} is going to “{title}”.'), mark('{name} is going to “{title}” {when}.')],
  tentative: [mark('{name} might come to “{title}”.'), mark('{name} might come to “{title}” {when}.')],
  declined: [mark('{name} can’t come to “{title}”.'), mark('{name} can’t come to “{title}” {when}.')],
  delegated: [mark('{name} sent someone else to “{title}”.'), mark('{name} sent someone else to “{title}” {when}.')],
};

/**
 * A guest answered an invite we sent (an iTIP REPLY): the answer goes on the event, for all of it, for the one date
 * they answered (RECURRENCE-ID), or for that date and the ones after it (RANGE=THISANDFUTURE). Only from a guest of the
 * event, to the mailbox of its owner. The owner hears about it.
 */
export function applyReply(ws: { id: string }, account: Account, inv: StoredInvite, broadcast: Broadcast, notify: Notify) {
  const ev = (db.allDocs('events') as any[]).find((e) => e.invite?.uid === inv.uid && e.workspaceId === ws.id && (account.users ?? []).includes(e.userId));
  const a = inv.attendees[0];
  if (!ev || !a) return;
  const email = a.email.toLowerCase();
  if (!(ev.guests ?? []).some((g: any) => String(g.email).toLowerCase() === email)) return;
  let next: any;
  let on: ReturnType<typeof phrase> | null = null;
  let open = ev.id; // the notice opens the event, or the date answered
  if (inv.recurrenceId && ev.rrule) {
    // Which date: the series' own way of writing it (an all-day one floats), by the same instant or day.
    const at = isFloatingIso(ev.start) ? `${new Date(Date.parse(inv.recurrenceId)).toISOString().slice(0, 10)}T00:00:00` : new Date(Date.parse(inv.recurrenceId)).toISOString();
    const dayWords = datePhrase(isFloatingIso(at) ? `${at}Z` : at, { weekday: true, tz: ev.timeZone && !isFloatingIso(ev.start) ? ev.timeZone : 'UTC' });
    open = occId(ev.id, at);
    if (inv.thisAndFuture) {
      next = { ...ev, answersFrom: [...(ev.answersFrom ?? []).filter((x: any) => !(x.email === email && Date.parse(x.from) >= Date.parse(at))), { from: at, email, status: a.status }], ...(ev.overrides ? { overrides: forget(ev.overrides, email, Date.parse(at)) } : {}) };
      on = phrase('from {day} on', { day: dayWords });
    } else {
      const own = (ev.overrides ?? []).find((o: any) => Date.parse(o.occurrence) === Date.parse(at));
      const others = (ev.overrides ?? []).filter((o: any) => o !== own);
      next = { ...ev, overrides: [...others, { ...own, occurrence: own?.occurrence ?? at, answers: { ...own?.answers, [email]: a.status } }] };
      on = phrase('on {day}', { day: dayWords });
    }
  } else next = { ...ev, answers: { ...ev.answers, [email]: a.status }, ...(ev.answersFrom ? { answersFrom: ev.answersFrom.filter((x: any) => x.email !== email) } : {}), ...(ev.overrides ? { overrides: forget(ev.overrides, email, -Infinity) } : {}) };
  db.writeDocs('events', [next], [], null);
  broadcast('events', [next], []);
  const name = (ev.guests ?? []).find((g: any) => String(g.email).toLowerCase() === email)?.name || a.name;
  if (ANSWERED[a.status]) notify([ev.userId], ws.id, on ? msg(ANSWERED[a.status][1], { name, title: ev.title, when: on }) : msg(ANSWERED[a.status][0], { name, title: ev.title }), `/calendar?event=${encodeURIComponent(open)}`);
}
const isFloatingIso = (s: string) => !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s);
/** A guest's answers for single dates from `from` on go: a wider answer covers them now. Dates left with nothing of their own go too. */
function forget(overrides: any[], email: string, from: number) {
  return overrides
    .map((o) => {
      if (!o.answers?.[email] || Date.parse(o.occurrence) < from) return o;
      const { [email]: _, ...answers } = o.answers;
      const { answers: _a, ...rest } = o;
      return Object.keys(answers).length ? { ...rest, answers } : rest;
    })
    .filter((o) => Object.keys(o).some((k) => k !== 'occurrence'));
}
