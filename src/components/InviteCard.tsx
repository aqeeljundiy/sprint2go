import { useState } from 'react';
import { CalendarCheck, CalendarPlus, ChevronRight, Loader2, Video } from 'lucide-react';
import type { CalEvent, InviteGuest, MailInvite, RsvpStatus } from '../types';
import { Avatar } from './Avatar';
import { MEETING_NAME, findMeetingLink } from '../meetingLinks';
import { isMine } from '../identity';

/** What the app knows around one invite: answers given, the calendar, later versions. */
export interface InviteState {
  answer?: { status: RsvpStatus; sent: boolean; who?: string }; // the latest answer to this event, from any of its emails (who: a teammate, on a shared inbox)
  onCalendar: boolean;
  newer?: () => void; // a later version came: open it
  cancelled?: boolean; // the organiser cancelled it (in this email or a later one)
}

interface Props {
  invite: MailInvite;
  state: InviteState;
  conflicts: CalEvent[];
  /** Why an answer can't reach the organiser from this mailbox; the buttons then explain instead. */
  answerOff?: string;
  onAnswerOff: () => void;
  onAnswer: (status: RsvpStatus) => Promise<boolean>;
  onOpenCalendar: () => void;
}

const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const day = (iso: string, tz?: string) => new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
const time = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
const dateKey = (iso: string, tz?: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });

/** "Tuesday 14 October · 10:00 to 11:00", in a zone (the viewer's by default). All-day dates are the same everywhere. */
export function inviteWhen(inv: Pick<MailInvite, 'start' | 'end' | 'allDay'>, tz?: string) {
  if (inv.allDay) {
    const last = new Date(Date.parse(inv.end) - 60_000).toISOString();
    return dateKey(inv.start, 'UTC') === dateKey(last, 'UTC') ? `${day(inv.start, 'UTC')} · All day` : `${day(inv.start, 'UTC')} to ${day(last, 'UTC')} · All day`;
  }
  return dateKey(inv.start, tz) === dateKey(inv.end, tz) ? `${day(inv.start, tz)} · ${time(inv.start, tz)} to ${time(inv.end, tz)}` : `${day(inv.start, tz)} ${time(inv.start, tz)} to ${day(inv.end, tz)} ${time(inv.end, tz)}`;
}

const ORDINAL: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '5': 'fifth', '-1': 'last', '-2': 'second to last' };
const WEEKDAY: Record<string, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' };
const and = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0] ?? '');

/** "Every week on Monday and Wednesday, until 31 December". */
export function describeRepeat(rrule: string, start: string, tz?: string): string {
  const r = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')).filter((kv) => kv.length === 2).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]));
  const n = Math.max(1, Number(r.INTERVAL) || 1);
  const days = (r.BYDAY ?? '').split(',').filter(Boolean);
  const plain = days.map((d: string) => d.replace(/^[+-]?\d+/, ''));
  let text: string;
  if (r.FREQ === 'DAILY') text = plain.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => plain.includes(d)) ? 'Every weekday' : n > 1 ? `Every ${n} days` : 'Every day';
  else if (r.FREQ === 'WEEKLY') {
    const names = plain.length ? plain.map((d: string) => WEEKDAY[d] ?? d) : [new Date(start).toLocaleDateString('en-GB', { weekday: 'long', timeZone: tz })];
    text = `${n > 1 ? `Every ${n} weeks` : 'Every week'} on ${and(names)}`;
  } else if (r.FREQ === 'MONTHLY') {
    const nth = days[0]?.match(/^([+-]?\d+)([A-Z]{2})$/);
    const each = n > 1 ? `Every ${n} months` : 'Every month';
    text = nth ? `${each} on the ${ORDINAL[nth[1].replace('+', '')] ?? nth[1]} ${WEEKDAY[nth[2]]}` : `${each} on day ${r.BYMONTHDAY ?? new Date(start).toLocaleDateString('en-GB', { day: 'numeric', timeZone: tz })}`;
  } else if (r.FREQ === 'YEARLY') text = n > 1 ? `Every ${n} years` : 'Every year';
  else text = 'Repeats';
  if (r.COUNT) text += `, ${r.COUNT} times`;
  else if (r.UNTIL) {
    const u = r.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (u) text += `, until ${new Date(Date.UTC(+u[1], +u[2] - 1, +u[3], 12)).toLocaleDateString([], { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
  }
  return text;
}

const STATUS: Record<InviteGuest['status'], string> = { accepted: 'Going', tentative: 'Maybe', declined: 'Not going', 'needs-action': 'No answer yet', delegated: 'Sent someone else' };
const SAID: Record<RsvpStatus, string> = { accepted: 'yes', tentative: 'maybe', declined: 'no' };
const city = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');
const first = (name: string) => name.split(/[\s@]/)[0] || name;

/** A calendar invite in an email: when (in your time and the organiser's), who, the meeting link, and Yes, Maybe or No. */
export function InviteCard({ invite: inv, state, conflicts, answerOff, onAnswerOff, onAnswer, onOpenCalendar }: Props) {
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const org = inv.organizer;
  const orgName = org ? first(org.name) : 'The organiser';
  const cancelled = inv.method === 'CANCEL' || !!inv.cancelled || !!state.cancelled;
  const past = Date.parse(inv.end) < Date.now();
  const tile = inv.allDay ? 'UTC' : undefined;
  const kind = inv.url ? (findMeetingLink(inv.url)?.kind ?? null) : null;
  // The organiser's own time, when it differs from yours.
  const theirs = !inv.allDay && inv.tz && inv.tz !== viewerTz && inviteWhen(inv, inv.tz) !== inviteWhen(inv) ? inv.tz : null;
  const isYou = (email: string) => email === inv.you || isMine(email);
  const guests = [...(org ? [{ ...org, status: 'accepted' as const, organizer: true }] : []), ...inv.attendees.filter((a) => a.email !== org?.email).map((a) => ({ ...a, organizer: false }))].map((g) => ({ ...g, you: isYou(g.email) }));
  const others = guests.filter((g) => !g.you);
  const answered = state.answer?.status;
  const canAnswer = (inv.method === 'REQUEST' || inv.method === 'PUBLISH') && !cancelled && !past && !state.newer;
  const answer = async (s: RsvpStatus) => {
    if (busy) return;
    if (answerOff && inv.method === 'REQUEST') return onAnswerOff();
    setBusy(s);
    await onAnswer(s);
    setBusy(null);
  };

  if (inv.method === 'REPLY') {
    const who = inv.attendees[0];
    return (
      <div className="mail-invite reply">
        <div className="mi-main">
          <div className="invite-kicker">Answer to your invite</div>
          <div className="invite-title">
            {who ? `${who.name} ${who.status === 'accepted' ? 'is going to' : who.status === 'tentative' ? 'might come to' : who.status === 'declined' ? 'isn’t going to' : 'answered'}` : 'An answer about'} “{inv.title}”
          </div>
          <div className="invite-when">{inviteWhen(inv)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`mail-invite ${cancelled ? 'cancelled' : ''} ${answered && !cancelled ? `said-${answered}` : ''}`}>
      <div className="invite-date" aria-hidden>
        <span>{new Date(inv.start).toLocaleDateString([], { month: 'short', timeZone: tile })}</span>
        <strong>{new Date(inv.start).toLocaleDateString([], { day: 'numeric', timeZone: tile })}</strong>
      </div>
      <div className="mi-main">
        <div className="invite-kicker">{cancelled ? `Cancelled by ${orgName}` : inv.method === 'PUBLISH' ? 'Event' : inv.sequence > 0 ? `Updated invitation from ${orgName}` : `Invitation from ${orgName}`}</div>
        <div className="invite-title">{inv.title}</div>
        <div className="invite-when">{inviteWhen(inv)}</div>
        {theirs && (
          <div className="mi-sub">
            {inviteWhen(inv, theirs).split(' · ').pop()} in {city(theirs)}
            {org ? `, ${orgName}’s time` : ''}
          </div>
        )}
        {inv.rrule && <div className="mi-sub">{describeRepeat(inv.rrule, inv.start, inv.tz)}</div>}
        {inv.location && !/^https?:\/\//i.test(inv.location) && !(kind && /^(microsoft teams meeting|google meet|zoom( meeting)?)$/i.test(inv.location.trim())) && <div className="mi-sub">{inv.location}</div>}

        {others.length > 0 && (
          <>
            <button type="button" className="mi-guests" aria-expanded={guestsOpen} onClick={() => setGuestsOpen((o) => !o)}>
              <span className="mi-faces">
                {others.slice(0, 4).map((g) => (
                  <Avatar key={g.email} person={g} size={22} />
                ))}
              </span>
              <span className="mi-names">With {others.length <= 3 ? and(others.map((g) => first(g.name))) : and([...others.slice(0, 2).map((g) => first(g.name)), `${others.length - 2} more`])}</span>
              <ChevronRight size={14} className={`rot-chev ${guestsOpen ? 'open' : ''}`} />
            </button>
            <div className={`fold ${guestsOpen ? 'open' : ''}`}>
              <div className="fold-in">
                <ul className="mi-guest-list">
                  {guests.map((g) => (
                    <li key={g.email}>
                      <Avatar person={g} size={24} />
                      <span className="mi-g-name">
                        {g.you ? 'You' : g.name}
                        <small>{g.email}</small>
                      </span>
                      <span className={`mi-g-status ${g.organizer ? '' : g.status}`}>{g.organizer ? 'Organiser' : STATUS[g.status]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}

        {(canAnswer || (inv.url && !cancelled && !past && !state.newer)) && (
          <div className="mi-actions">
            {canAnswer && inv.method === 'REQUEST' && (
              <>
                <span className="mi-ask">Going?</span>
                <div className={`segmented rsvp ${answerOff ? 'off' : ''}`} role="group" aria-label="Your answer">
                  {(['accepted', 'tentative', 'declined'] as const).map((s) => (
                    <button key={s} type="button" className={answered === s ? 'on' : ''} aria-pressed={answered === s} aria-disabled={answerOff ? true : undefined} title={answerOff} disabled={!!busy && busy !== s} onClick={() => void answer(s)}>
                      {busy === s ? <Loader2 size={13} className="spin" /> : null}
                      {s === 'accepted' ? 'Yes' : s === 'tentative' ? 'Maybe' : 'No'}
                    </button>
                  ))}
                </div>
              </>
            )}
            {canAnswer && inv.method === 'PUBLISH' && !state.onCalendar && (
              <button type="button" className="ghost-btn outline sm" disabled={!!busy} onClick={() => void answer('accepted')}>
                {busy ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />} Add to calendar
              </button>
            )}
            {inv.url && !cancelled && !past && !state.newer && (
              <a className="ghost-btn outline sm mi-join" href={inv.url} target="_blank" rel="noreferrer">
                <Video size={14} /> Join {kind ? MEETING_NAME[kind] : 'the call'}
              </a>
            )}
          </div>
        )}

        <div className={`invite-status ${!answered && !cancelled && conflicts.length ? 'warn' : ''} ${cancelled || past || state.newer ? 'quiet' : ''}`}>
          {cancelled ? (
            state.onCalendar ? 'Cancelled, but still on your calendar.' : answered && answered !== 'declined' ? 'It’s off your calendar.' : 'It wasn’t on your calendar.'
          ) : state.newer ? (
            <>
              There’s a newer version of this invite.{' '}
              <button type="button" className="link-btn small" onClick={state.newer}>
                Open it
              </button>
            </>
          ) : past ? (
            'This has already happened.'
          ) : answered ? (
            <>
              {inv.method === 'PUBLISH' ? 'Added' : `${state.answer?.who ?? 'You'} said ${SAID[answered]}`}
              {state.answer?.sent ? `. ${orgName} knows` : ''}
              {state.onCalendar && (
                <>
                  .{' '}
                  <button type="button" className="link-btn small" onClick={onOpenCalendar}>
                    <CalendarCheck size={13} /> On your calendar
                  </button>
                </>
              )}
            </>
          ) : conflicts.length ? (
            `Overlaps with “${conflicts[0].title}”${conflicts.length > 1 ? ` and ${conflicts.length - 1} more` : ''}`
          ) : (
            'You’re free then'
          )}
        </div>
      </div>
    </div>
  );
}
