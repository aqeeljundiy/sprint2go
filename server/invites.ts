// Calendar invites that arrive by email: which part of the email is the invite, the calendar events an answer puts in
// sprint2go Calendar, and what an update or a cancellation from the organiser does to them.
import type { ParsedMail } from 'mailparser';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { occurrences, parseInvite, type IcsEvent } from './ics.ts';

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

/**
 * The events an invite becomes in one person's calendar: one per occurrence for the next six months (at most 60), or
 * just the first one when the repeat is one we don't read. `firstOnly` says that happened.
 */
export function eventsFor(inv: StoredInvite, o: { userId: string; workspaceId: string; threadId: string; rsvp: Rsvp; mine: string[] }): { docs: db.Doc[]; firstOnly: boolean } {
  const now = Date.now();
  const occ = inv.rrule ? occurrences(inv, now - 86_400_000, now + 183 * 86_400_000, 60) : [{ start: inv.start, end: inv.end }];
  const list = occ ?? [{ start: inv.start, end: inv.end }];
  const me = new Set(o.mine.map((x) => x.toLowerCase()));
  const guests = [...(inv.organizer ? [inv.organizer] : []), ...inv.attendees]
    .filter((p, i, all) => !me.has(p.email) && all.findIndex((x) => x.email === p.email) === i)
    .map((p) => ({ name: p.name, email: p.email }))
    .slice(0, 50);
  const docs = list.map((x) => ({
    id: 'ev-' + hex(),
    title: inv.title,
    calendarId: 'work',
    start: x.start,
    end: x.end,
    ...(inv.allDay ? { allDay: true } : {}),
    ...(inv.location ? { location: inv.location } : {}),
    ...(inv.url ? { meetingUrl: inv.url } : {}),
    ...(guests.length ? { guests } : {}),
    ...(inv.description ? { notes: inv.description } : {}),
    threadId: o.threadId,
    workspaceId: o.workspaceId,
    userId: o.userId,
    createdBy: o.userId,
    inviteUid: inv.uid,
    sequence: inv.sequence,
    ...('recurrenceId' in x && x.recurrenceId ? { occurrence: x.recurrenceId } : inv.recurrenceId ? { occurrence: inv.recurrenceId } : {}),
    rsvp: o.rsvp,
    ...(inv.organizer ? { organizer: inv.organizer } : {}),
  }));
  return { docs, firstOnly: !!inv.rrule && !occ };
}

/** This person's events from an invite, in one company. */
export const eventsOf = (uid: string, workspaceId: string, userIds: string[]) =>
  (db.allDocs('events') as any[]).filter((e) => e.inviteUid === uid && e.workspaceId === workspaceId && userIds.includes(e.userId));

type Broadcast = (coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) => void;
type Notify = (userIds: string[], workspaceId: string, text: string, link?: string) => void;

/**
 * An invite email for an event people here already answered: an update moves their events (a newer version only),
 * a cancellation takes them off the calendar. Either way they're told.
 */
export function applyInbound(ws: { id: string }, account: Account, inv: StoredInvite, threadId: string, broadcast: Broadcast, notify: Notify) {
  const evs = eventsOf(inv.uid, ws.id, account.users ?? []);
  if (!evs.length) return;
  const who = inv.organizer?.name ?? 'The organiser';
  if (inv.method === 'CANCEL' || inv.cancelled) {
    const gone = inv.recurrenceId ? evs.filter((e) => (e.occurrence ?? e.start) === inv.recurrenceId) : evs;
    if (!gone.length) return;
    db.writeDocs('events', [], gone.map((e) => e.id), null);
    broadcast('events', [], gone.map((e) => e.id), undefined, gone);
    notify([...new Set(gone.map((e) => e.userId as string))], ws.id, `${who} cancelled “${inv.title}”${inv.recurrenceId ? ' on one of its dates' : ''}. It’s off your calendar.`, '/mail');
    return;
  }
  if (inv.method !== 'REQUEST' && inv.method !== 'PUBLISH') return;
  const known = Math.max(...evs.map((e) => Number(e.sequence) || 0));
  if (inv.sequence < known) return; // an older copy arriving late
  const changed: string[] = [];
  for (const userId of new Set(evs.map((e) => e.userId as string))) {
    const mine = evs.filter((e) => e.userId === userId);
    const rsvp: Rsvp = isRsvp(mine[0].rsvp) ? mine[0].rsvp : 'accepted';
    let next: db.Doc[];
    let drop: any[];
    if (inv.recurrenceId && !inv.rrule) {
      // One date of a repeating event moved.
      const one = mine.find((e) => (e.occurrence ?? e.start) === inv.recurrenceId);
      if (!one) continue;
      next = [{ ...one, title: inv.title, start: inv.start, end: inv.end, location: inv.location, meetingUrl: inv.url ?? one.meetingUrl, sequence: inv.sequence }];
      drop = [];
    } else {
      next = eventsFor(inv, { userId, workspaceId: ws.id, threadId: mine[0].threadId ?? threadId, rsvp, mine: [account.email, inv.you ?? ''] }).docs;
      drop = mine;
      // Keep the ids of dates that are still there (a single event: always), so an open event stays open.
      next = next.map((d) => {
        const same = !inv.rrule && mine.length === 1 && next.length === 1 ? mine[0] : mine.find((e) => (e.occurrence ?? e.start) === ((d as any).occurrence ?? d.start));
        return same ? { ...d, id: same.id } : d;
      });
    }
    const sig = (list: any[]) => JSON.stringify(list.map((e) => [e.title, e.start, e.end, e.location ?? '', e.meetingUrl ?? '']).sort());
    if (sig(next) === sig(inv.recurrenceId && !inv.rrule ? mine.filter((e) => (e.occurrence ?? e.start) === inv.recurrenceId) : mine)) continue;
    const keepIds = new Set(next.map((d) => d.id));
    const deletes = drop.filter((e) => !keepIds.has(e.id));
    db.writeDocs('events', next, deletes.map((e) => e.id), null);
    if (deletes.length) broadcast('events', [], deletes.map((e) => e.id), undefined, deletes);
    broadcast('events', next, []);
    changed.push(userId);
  }
  if (changed.length) notify(changed, ws.id, `${who} changed “${inv.title}”. Your calendar has the new details.`, '/mail');
}
