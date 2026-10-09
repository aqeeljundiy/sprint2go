// Invites we send. An event of yours with guests and "Email the invite to guests" on: they get it by email from your
// mailbox (an iCalendar REQUEST: Google, Outlook and Apple show it with Yes / Maybe / No), an update when what they see
// changes (a new SEQUENCE), and a cancellation when it's deleted or they're taken off it. A repeating event goes as one
// series: its rule, its left-out dates and its dates changed on their own (server/ics.ts buildInvite); splitting it
// ("this and following") updates the first part and sends the second as an invite of its own. Their answers come back
// as REPLY emails and land on the event (invites.ts applyReply). Mail to outside addresses from a local server is held
// on this computer, as all mail is there (mailer.keepsMailLocal).
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import * as mailer from './mailer.ts';
import { buildInvite, type InviteOut } from './ics.ts';
import { repeatWords } from '../src/repeat.ts';
import { companyTz } from '../src/jobTimes.ts';

type Ev = Record<string, any>;
type Broadcast = (coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) => void;
let broadcast: Broadcast = () => {};
export const initInvites = (d: { broadcast: Broadcast }) => void (broadcast = d.broadcast);

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The fields of an event only the server sets: what went out (and to whom), guests' answers, the last reminder. */
export function guardEvent(d: Ev, before: Ev | undefined): Ev {
  if (!before) {
    // A new one (a copy, or the second part of a split) hasn't been sent to anyone yet.
    const { invite: _i, remindedFor: _r, ...rest } = d;
    return rest;
  }
  const out: Ev = { ...d };
  for (const k of ['invite', 'remindedFor', 'answers', 'answersFrom']) {
    if (before[k] === undefined) delete out[k];
    else out[k] = before[k];
  }
  // A date's guests' answers stay with that date while it's still changed on its own.
  if (Array.isArray(out.overrides))
    out.overrides = out.overrides.map((o: Ev) => {
      const was = (before.overrides ?? []).find((b: Ev) => b?.occurrence && o?.occurrence && Date.parse(b.occurrence) === Date.parse(o.occurrence));
      const { answers: _a, ...rest } = o ?? {};
      return was?.answers ? { ...rest, answers: was.answers } : rest;
    });
  return out;
}

/** Who gets it: the guests with an address, never the owner's own addresses. */
function recipients(e: Ev, ownerEmails: Set<string>) {
  return (Array.isArray(e.guests) ? e.guests : [])
    .filter((g: Ev) => g && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(g.email)) && !ownerEmails.has(lower(g.email)))
    .map((g: Ev) => ({ name: String(g.name || lower(g.email).split('@')[0]).slice(0, 120), email: lower(g.email) }))
    .filter((g: Ev, i: number, all: Ev[]) => all.findIndex((x) => x.email === g.email) === i)
    .slice(0, 50);
}

/** What guests see of an event: when this changes, they get the update. */
export function inviteSig(e: Ev) {
  const o = (e.overrides ?? []).map((x: Ev) => [x.occurrence, x.start ?? '', x.end ?? '', x.title ?? '', x.location ?? '', x.notes ?? '', x.meetUrl ?? '']);
  return JSON.stringify([e.title, e.start, e.end, !!e.allDay, e.timeZone ?? '', e.rrule ?? '', e.exdates ?? [], o, e.location ?? '', e.meetUrl ?? '', e.notes ?? '']);
}

/** The words of the email around the invite: when, how it repeats, where, the call link, the notes. */
function emailText(e: Ev, tz: string, organizer: string) {
  const when = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...(e.allDay ? {} : { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }), timeZone: tz }).format(new Date(e.start));
  const repeats = e.rrule ? repeatWords({ rrule: e.rrule, start: e.start, timeZone: tz }) : null;
  return [
    `${organizer} invited you to “${e.title}”.`,
    '',
    `When: ${when}${e.allDay ? ', all day' : ''}`,
    ...(repeats ? [`Repeats: ${repeats}`] : []),
    ...(e.location ? [`Where: ${e.location}`] : []),
    ...(e.meetUrl ? [`Join: ${e.meetUrl}`] : []),
    ...(e.notes ? ['', String(e.notes).slice(0, 4000)] : []),
    '',
    'Answer with the Yes, Maybe or No your calendar shows for this invite.',
  ].join('\n');
}

/** The invite for an event, as guests get it. */
export function inviteFor(e: Ev, o: { method: 'REQUEST' | 'CANCEL'; uid: string; sequence: number; organizer: { name: string; email: string }; attendees: { name: string; email: string }[]; tz: string }): string {
  const description = [e.notes, e.meetUrl ? `Join: ${e.meetUrl}` : ''].filter(Boolean).join('\n\n') || undefined;
  const out: InviteOut = {
    method: o.method,
    uid: o.uid,
    sequence: o.sequence,
    organizer: o.organizer,
    attendees: o.attendees.map((a) => ({ ...a, status: (e.answers?.[a.email] as any) ?? 'needs-action' })),
    title: String(e.title || 'Event'),
    start: e.start,
    end: e.end,
    allDay: !!e.allDay,
    tz: e.timeZone || o.tz,
    rrule: e.rrule,
    exdates: e.exdates,
    overrides: (e.overrides ?? []).filter((x: Ev) => x.start || x.title !== undefined || x.location !== undefined || x.notes !== undefined).map((x: Ev) => ({ occurrence: x.occurrence, start: x.start, end: x.end, title: x.title, location: x.location, description: x.notes })),
    location: e.location || e.meetUrl || undefined,
    description,
    url: e.meetUrl || undefined,
  };
  return buildInvite(out);
}

/**
 * After events are saved (from the app, or an AI app through the same rules): invites and their updates go out for the
 * ones with "Email the invite to guests" on, cancellations for deleted ones and for guests taken off. What went out is
 * kept on the event (`invite`): the uid, the sequence, what it said and to whom, and anything held or wrong.
 */
export async function afterEventWrite(saved: Ev[], deleted: Ev[], me: string) {
  for (const e of saved) {
    if (!e?.sendInvites || e.userId !== me || e.feed || e.inviteUid) continue;
    await sendFor(e, me).catch((err) => console.error('[invites]', err instanceof Error ? err.message : err));
  }
  for (const e of deleted) {
    if (!e?.invite?.to?.length || e.userId !== me) continue;
    await sendFor(e, me, true).catch((err) => console.error('[invites]', err instanceof Error ? err.message : err));
  }
}

async function sendFor(e: Ev, me: string, gone = false) {
  const ws = (db.allDocs('workspaces') as Ev[]).find((w) => w.id === e.workspaceId && (w.members ?? []).some((m: Ev) => m.userId === me));
  const user = db.getDoc('users', me) as Ev | undefined;
  if (!ws || !user) return;
  const boxes = (ws.accounts ?? []).filter((a: Ev) => (a.users ?? []).includes(me) && (!a.provider || a.provider === 'sprint2go'));
  const box = boxes.find((a: Ev) => a.kind === 'personal') ?? boxes[0];
  const ownerEmails = new Set<string>([lower(user.email), ...boxes.map((a: Ev) => lower(a.email))]);
  const prev = e.invite as Ev | undefined;
  const guests = gone ? [] : recipients(e, ownerEmails);
  const sentTo: string[] = prev?.to ?? [];
  const removed = sentTo.filter((x) => !guests.some((g) => g.email === x));
  const sig = inviteSig(e);
  const changed = !prev || prev.sig !== sig;
  const added = guests.filter((g) => !sentTo.includes(g.email));
  if (!gone && !changed && !added.length && !removed.length) return;
  const uid = prev?.uid ?? `${e.id}@${mailer.MAIL_HOST}`;
  const sequence = prev ? prev.sequence + (changed || removed.length ? 1 : 0) : 0;
  const save = (invite: Ev) => {
    if (gone) return;
    const now = db.getDoc('events', e.id) as Ev | undefined;
    if (!now) return;
    const next = { ...now, invite } as unknown as db.Doc;
    db.writeDocs('events', [next], [], null);
    broadcast('events', [next], []);
  };
  const fail = (error: string) => save({ ...(prev ?? {}), uid, sequence: prev?.sequence ?? 0, sig: prev?.sig, to: sentTo, error });
  if (!box) return fail(`There’s no mailbox of yours in ${ws.name} to send it from.`);
  // Outside addresses from a local server stay here anyway; elsewhere the mailbox has to be able to send.
  if (!mailer.keepsMailLocal() && !ws.mailReady?.mailboxes?.[box.id]?.send) {
    const r = await mailer.refreshReadiness(ws.id);
    if (!r?.mailboxes[box.id]?.send) return fail(`Sending isn’t set up for ${box.email} yet.`);
  }
  const organizer = { name: String(user.name || box.name || ''), email: lower(box.email) };
  const tz = e.timeZone || companyTz(ws);
  const send = async (method: 'REQUEST' | 'CANCEL', to: { name: string; email: string }[], all: { name: string; email: string }[]) => {
    if (!to.length) return { held: [] as string[] };
    const r = await mailer.queueSend({
      workspaceId: ws.id,
      accountId: box.id,
      threadId: '',
      messageId: 'inv-' + randomBytes(6).toString('hex'),
      from: organizer,
      to,
      cc: [],
      subject: method === 'CANCEL' ? `Cancelled: ${e.title}` : prev ? `Updated invitation: ${e.title}` : `Invitation: ${e.title}`,
      text: method === 'CANCEL' ? `${organizer.name} cancelled “${e.title}”${gone ? '' : ' for you'}.` : emailText(e, tz, organizer.name),
      files: [],
      ical: { method, content: inviteFor(e, { method, uid, sequence, organizer, attendees: all, tz }) },
    });
    return { held: r.held ?? [] };
  };
  try {
    const held: string[] = [];
    if (gone) held.push(...(await send('CANCEL', sentTo.map((email) => ({ name: email.split('@')[0], email })), sentTo.map((email) => ({ name: email.split('@')[0], email })))).held);
    else {
      // Everyone gets a changed invite; when only guests were added, just they get it.
      held.push(...(await send('REQUEST', changed ? guests : added, guests)).held);
      if (removed.length) {
        const off = removed.map((email) => ({ name: email.split('@')[0], email }));
        held.push(...(await send('CANCEL', off, off)).held);
      }
    }
    save({ uid, sequence, sig, to: guests.map((g) => g.email), sentAt: new Date().toISOString(), ...(held.length ? { held: [...new Set(held)] } : {}) });
  } catch (err) {
    fail(err instanceof Error ? err.message : 'The invite couldn’t be sent.');
  }
}
