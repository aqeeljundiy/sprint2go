import { useState } from 'react';
import { CalendarCheck, CalendarPlus, ChevronRight, Loader2, Video } from 'lucide-react';
import type { CalEvent, InviteGuest, MailInvite, RsvpStatus } from '../types';
import { Avatar } from './Avatar';
import { MEETING_NAME, findMeetingLink } from '../meetingLinks';
import { isMine } from '../identity';
import { repeatWords } from '../repeat';
import { t, tn } from '../i18n';
import { fmtDate, fmtList } from '../i18n/format';

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
const day = (iso: string, tz?: string) => fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
const time = (iso: string, tz?: string) => fmtDate(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
const dateKey = (iso: string, tz?: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });

/** "Tuesday 14 October · 10:00 to 11:00", in a zone (the viewer's by default). All-day dates are the same everywhere. */
export function inviteWhen(inv: Pick<MailInvite, 'start' | 'end' | 'allDay'>, tz?: string) {
  if (inv.allDay) {
    const last = new Date(Date.parse(inv.end) - 60_000).toISOString();
    return dateKey(inv.start, 'UTC') === dateKey(last, 'UTC') ? t('{day} · All day', { day: day(inv.start, 'UTC') }) : t('{first} to {last} · All day', { first: day(inv.start, 'UTC'), last: day(last, 'UTC') });
  }
  return dateKey(inv.start, tz) === dateKey(inv.end, tz)
    ? `${day(inv.start, tz)} · ${t('{first} to {last}', { first: time(inv.start, tz), last: time(inv.end, tz) })}`
    : t('{first} to {last}', { first: `${day(inv.start, tz)} ${time(inv.start, tz)}`, last: `${day(inv.end, tz)} ${time(inv.end, tz)}` });
}

/** "Every week on Monday and Wednesday, until 31 Dec 2026", in the reader's language (the calendar's own repeat words). */
export function describeRepeat(rrule: string, start: string, tz?: string): string {
  return repeatWords({ rrule, start, timeZone: tz }) ?? t('Repeats');
}

/** A guest's answer, on the guest list. */
const statusWord = (s: InviteGuest['status']) =>
  s === 'accepted' ? t('Going') : s === 'tentative' ? t('Maybe') : s === 'declined' ? t('Not going') : s === 'delegated' ? t('Sent someone else') : t('No answer yet');
/** "You said yes", "Isabel said maybe" (a teammate answered on a shared inbox). */
const saidWords = (s: RsvpStatus, who?: string) =>
  who
    ? s === 'accepted'
      ? t('{name} said yes', { name: who })
      : s === 'tentative'
        ? t('{name} said maybe', { name: who })
        : t('{name} said no', { name: who })
    : s === 'accepted'
      ? t('You said yes')
      : s === 'tentative'
        ? t('You said maybe')
        : t('You said no');
const city = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');
const first = (name: string) => name.split(/[\s@]/)[0] || name;

/** A calendar invite in an email: when (in your time and the organiser's), who, the meeting link, and Yes, Maybe or No. */
export function InviteCard({ invite: inv, state, conflicts, answerOff, onAnswerOff, onAnswer, onOpenCalendar }: Props) {
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const org = inv.organizer;
  const orgName = org ? first(org.name) : null;
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
          <div className="invite-kicker">{t('Answer to your invite')}</div>
          <div className="invite-title">
            {!who
              ? t('An answer about “{title}”', { title: inv.title })
              : who.status === 'accepted'
                ? t('{name} is going to “{title}”', { name: who.name, title: inv.title })
                : who.status === 'tentative'
                  ? t('{name} might come to “{title}”', { name: who.name, title: inv.title })
                  : who.status === 'declined'
                    ? t('{name} isn’t going to “{title}”', { name: who.name, title: inv.title })
                    : t('{name} answered “{title}”', { name: who.name, title: inv.title })}
          </div>
          <div className="invite-when">{inviteWhen(inv)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`mail-invite ${cancelled ? 'cancelled' : ''} ${answered && !cancelled ? `said-${answered}` : ''}`}>
      <div className="invite-date" aria-hidden>
        <span>{fmtDate(inv.start, { month: 'short', timeZone: tile })}</span>
        <strong>{fmtDate(inv.start, { day: 'numeric', timeZone: tile })}</strong>
      </div>
      <div className="mi-main">
        <div className="invite-kicker">
          {cancelled
            ? orgName
              ? t('Cancelled by {name}', { name: orgName })
              : t('Cancelled')
            : inv.method === 'PUBLISH'
              ? t('Event')
              : inv.sequence > 0
                ? orgName
                  ? t('Updated invitation from {name}', { name: orgName })
                  : t('Updated invitation')
                : orgName
                  ? t('Invitation from {name}', { name: orgName })
                  : t('Invitation')}
        </div>
        <div className="invite-title">{inv.title}</div>
        <div className="invite-when">{inviteWhen(inv)}</div>
        {theirs && (
          <div className="mi-sub">
            {orgName ? t('{time} in {city}, {name}’s time', { time: inviteWhen(inv, theirs).split(' · ').pop() ?? '', city: city(theirs), name: orgName }) : t('{time} in {city}', { time: inviteWhen(inv, theirs).split(' · ').pop() ?? '', city: city(theirs) })}
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
              <span className="mi-names">{t('With {names}', { names: others.length <= 3 ? fmtList(others.map((g) => first(g.name))) : fmtList([...others.slice(0, 2).map((g) => first(g.name)), tn(others.length - 2, '{n} more', '{n} more')]) })}</span>
              <ChevronRight size={14} className={`rot-chev ${guestsOpen ? 'open' : ''}`} />
            </button>
            <div className={`fold ${guestsOpen ? 'open' : ''}`}>
              <div className="fold-in">
                <ul className="mi-guest-list">
                  {guests.map((g) => (
                    <li key={g.email}>
                      <Avatar person={g} size={24} />
                      <span className="mi-g-name">
                        {g.you ? t('You') : g.name}
                        <small>{g.email}</small>
                      </span>
                      <span className={`mi-g-status ${g.organizer ? '' : g.status}`}>{g.organizer ? t('Organiser') : statusWord(g.status)}</span>
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
                <span className="mi-ask">{t('Going?')}</span>
                <div className={`segmented rsvp ${answerOff ? 'off' : ''}`} role="group" aria-label={t('Your answer')}>
                  {(['accepted', 'tentative', 'declined'] as const).map((s) => (
                    <button key={s} type="button" className={answered === s ? 'on' : ''} aria-pressed={answered === s} aria-disabled={answerOff ? true : undefined} title={answerOff} disabled={!!busy && busy !== s} onClick={() => void answer(s)}>
                      {busy === s ? <Loader2 size={13} className="spin" /> : null}
                      {s === 'accepted' ? t('Yes') : s === 'tentative' ? t('Maybe') : t('No')}
                    </button>
                  ))}
                </div>
              </>
            )}
            {canAnswer && inv.method === 'PUBLISH' && !state.onCalendar && (
              <button type="button" className="ghost-btn outline sm" disabled={!!busy} onClick={() => void answer('accepted')}>
                {busy ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />} {t('Add to calendar')}
              </button>
            )}
            {inv.url && !cancelled && !past && !state.newer && (
              <a className="ghost-btn outline sm mi-join" href={inv.url} target="_blank" rel="noreferrer">
                <Video size={14} /> {kind ? t('Join {app}', { app: MEETING_NAME[kind] }) : t('Join the call')}
              </a>
            )}
          </div>
        )}

        <div className={`invite-status ${!answered && !cancelled && conflicts.length ? 'warn' : ''} ${cancelled || past || state.newer ? 'quiet' : ''}`}>
          {cancelled ? (
            state.onCalendar ? t('Cancelled, but still on your calendar.') : answered && answered !== 'declined' ? t('It’s off your calendar.') : t('It wasn’t on your calendar.')
          ) : state.newer ? (
            <>
              {t('There’s a newer version of this invite.')}{' '}
              <button type="button" className="link-btn small" onClick={state.newer}>
                {t('Open it')}
              </button>
            </>
          ) : past ? (
            t('This has already happened.')
          ) : answered ? (
            <>
              {inv.method === 'PUBLISH' ? t('Added') : saidWords(answered, state.answer?.who)}
              {state.answer?.sent ? `. ${orgName ? t('{name} knows', { name: orgName }) : t('The organiser knows')}` : ''}
              {state.onCalendar && (
                <>
                  .{' '}
                  <button type="button" className="link-btn small" onClick={onOpenCalendar}>
                    <CalendarCheck size={13} /> {t('On your calendar')}
                  </button>
                </>
              )}
            </>
          ) : conflicts.length ? (
            conflicts.length > 1 ? tn(conflicts.length - 1, 'Overlaps with “{title}” and {n} more', 'Overlaps with “{title}” and {n} more', { title: conflicts[0].title }) : t('Overlaps with “{title}”', { title: conflicts[0].title })
          ) : (
            t('You’re free then')
          )}
        </div>
      </div>
    </div>
  );
}
