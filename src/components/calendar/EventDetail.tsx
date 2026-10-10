import { useRef, useState, type ReactNode } from 'react';
import { AlarmClock, Bell, Check, CircleHelp, Clock, Copy, EllipsisVertical, Globe, Lock, Mail, MapPin, Mic, Pencil, Repeat, Send, StickyNote, TextAlignStart, Trash2, Users, Video, X } from 'lucide-react';
import type { CalEvent, CalendarDef, GuestAnswer, RsvpStatus } from '../../types';
import { MEETING_NAME, meetingLinkOf, notetakerJoins } from '../../meetingLinks';
import { Avatar } from '../Avatar';
import { Badge, type BadgeTone } from '../ui/Person';
import { Sheet } from '../ui/Sheet';
import { ActionSheet, type SheetAction } from '../ui/ActionSheet';
import { toast } from '../../toast';
import { fromWall, isPending, placeOf, startsIn, wallIn, whenLine, zoneCity } from './calTools';
import { deviceTz, isZone } from '../../jobTimes';
import { remindWords } from './EventForm';
import { repeatWords } from '../../repeat';
import { mark, t, tn, tx } from '../../i18n';
import { fmtDate, fmtTime } from '../../i18n/format';
import { fmtTimeRange, sameDay, addDays } from '../../calendarUtils';
import { calLabel } from '../../data/calendar';

export type { GuestAnswer };

export interface DetailProps {
  event: CalEvent;
  calendar?: CalendarDef;
  readOnly?: boolean;
  phone: boolean;
  onClose: () => void;
  onDelete: (at?: Element) => void; // `at`: the button (where to ask which dates of a repeating event)
  onEdit?: () => void;
  onOpenThread: (id: string) => void;
  task?: { title: string; done: boolean } | null;
  onExtend?: (minutes: number) => void;
  onTomorrow?: () => void;
  onTaskDone?: () => void;
  onNotetaker?: () => void;
  sentBot?: () => void;
  botWill?: boolean; // set when the notetaker joins by itself (the real one): whether it will join this event
  onBotJoin?: (join: boolean) => void;
  /** Invites: answer Yes, Maybe or No (pinned to the bottom). */
  onRsvp?: (s: RsvpStatus, at?: Element) => void;
  /** The guests' answers, when the invite says them (by email). */
  answers?: Record<string, GuestAnswer>;
  /** Instead of the invite's state (the demo: nothing is emailed). */
  inviteNote?: string;
  /** Phones: the ⋮ menu (Duplicate, Move to tomorrow, Copy link, Delete), the one home for them. */
  more?: SheetAction[];
}

const ANSWER: Record<GuestAnswer, { label: string; tone: BadgeTone }> = {
  accepted: { label: mark('Going'), tone: 'good' },
  tentative: { label: mark('Maybe'), tone: 'warn' },
  declined: { label: mark('Not going'), tone: 'bad' },
  'needs-action': { label: mark('No answer yet'), tone: 'neutral' },
  delegated: { label: mark('Sent someone'), tone: 'neutral' },
};

/**
 * One event, open: Join comes first when there's a call, then the notetaker, the guests with their answers and the
 * notes. Invites keep Yes / Maybe / No at the bottom. A bottom sheet on phones (grab handle, swipe down to close), a
 * card beside the grid on wider screens.
 */
export function EventDetail(p: DetailProps) {
  const { event } = p;
  const pending = isPending(event);
  const rsvp = p.onRsvp && (pending || !!event.inviteUid) ? <Rsvp value={pending ? undefined : event.rsvp} onPick={p.onRsvp} /> : null;
  const actions = (
    <div className="ev-actions">
      {!p.readOnly && p.onEdit && (
        <button className="icon-btn" onClick={p.onEdit} aria-label={t('Edit event')} title={t('Edit')}>
          <Pencil size={17} />
        </button>
      )}
      {!p.readOnly && (
        <button className="icon-btn" onClick={(e) => p.onDelete(e.currentTarget)} aria-label={t('Delete event')} title={t('Delete')}>
          <Trash2 size={17} />
        </button>
      )}
      {!p.phone && (
        <button className="icon-btn" onClick={p.onClose} aria-label={t('Close')} title={t('Close (Esc)')}>
          <X size={17} />
        </button>
      )}
    </div>
  );
  if (p.phone) return <PhoneDetail {...p} rsvp={p.onRsvp && (pending || !!event.inviteUid) ? <Rsvp value={pending ? undefined : event.rsvp} onPick={p.onRsvp} phone /> : null} />;
  return (
    <aside className="ev-detail" style={{ ['--c' as string]: p.calendar?.color }} aria-label={event.title}>
      {actions}
      <DetailBody {...p} />
      {rsvp}
    </aside>
  );
}

function Rsvp({ value, onPick, phone }: { value?: RsvpStatus; onPick: (s: RsvpStatus, at?: Element) => void; phone?: boolean }) {
  // Google's order on phones: Yes, No, Maybe.
  const opts: [RsvpStatus, string][] = phone
    ? [
        ['accepted', t('Yes')],
        ['declined', t('No')],
        ['tentative', t('Maybe')],
      ]
    : [
        ['accepted', t('Yes')],
        ['tentative', t('Maybe')],
        ['declined', t('No')],
      ];
  return (
    <div className={`ev-rsvp${phone ? ' phone' : ''}`} role="group" aria-label={t('Going?')}>
      <span className="ev-rsvp-q">{t('Going?')}</span>
      {opts.map(([v, l]) => (
        <button key={v} type="button" className={`ev-rsvp-btn${value === v ? ' on' : ''}`} aria-pressed={value === v} onClick={(e) => onPick(v, e.currentTarget)}>
          {value === v && <Check size={14} />}
          {l}
        </button>
      ))}
    </div>
  );
}

/** What happened to the invite we email to guests (the server keeps it on the event). */
function inviteWords(e: CalEvent) {
  const inv = e.invite;
  if (!inv) return t('The invite is on its way to the guests');
  if (inv.error) return t('The invite couldn’t go out: {why}', { why: t(inv.error) });
  if (inv.held?.length) return t('Emailed to guests here. Held on this computer for {who}: a local sprint2go doesn’t send mail out', { who: inv.held.length === 1 ? inv.held[0] : tn(inv.held.length, '{n} outside guest', '{n} outside guests') });
  return inv.sequence > 0 ? t('Guests have the latest changes by email') : t('Invite emailed to the guests');
}

function Row({ icon, children, muted, top }: { icon: ReactNode; children: ReactNode; muted?: boolean; top?: boolean }) {
  return (
    <div className={`ev-row${muted ? ' muted' : ''}${top ? ' top' : ''}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

function DetailBody(p: DetailProps) {
  const { event, calendar, task } = p;
  const link = meetingLinkOf(event);
  const now = Date.now();
  const ended = new Date(event.end).getTime() < now;
  const startMs = new Date(event.start).getTime();
  const soon = !ended && startMs - now < 30 * 60_000;
  const startsSoon = startMs - now < 15 * 60_000;
  const guests = event.guests ?? [];
  return (
    <div className="ev-body" style={{ ['--c' as string]: calendar?.color }}>
      <div className="ev-title">
        <span className="ev-swatch" />
        <h3>{event.title}</h3>
      </div>
      <Row icon={<Clock size={16} />}>
        {whenLine(new Date(event.start), new Date(event.end), event.allDay)}
        {soon && !event.allDay && <em className="ev-soon">{startMs <= now ? t('Now') : startsIn(event, now)}</em>}
      </Row>
      {event.timeZone && isZone(event.timeZone) && event.timeZone !== deviceTz() && !event.allDay && (
        <Row icon={<Globe size={16} />} muted>
          {(() => {
            // The same moments on the clock where it was set.
            const s = wallIn(new Date(event.start), event.timeZone);
            const e = wallIn(new Date(event.end), event.timeZone);
            const at = (w: { date: string; time: string }) => fmtTime(fromWall(w.date, w.time, null));
            return t('{first} to {last} in {city}', { first: at(s), last: at(e), city: zoneCity(event.timeZone) });
          })()}
        </Row>
      )}
      {event.rrule && (
        <Row icon={<Repeat size={16} />} muted>
          {repeatWords({ rrule: event.rrule, start: event.occurrence ?? event.start, timeZone: event.timeZone })}
        </Row>
      )}
      {link && !ended && (
        <div className="ev-join">
          <a className="primary-btn ev-join-btn" href={link.url} target="_blank" rel="noopener noreferrer">
            <Video size={16} /> {t('Join {app}', { app: MEETING_NAME[link.kind] })}
          </a>
          {p.sentBot ? (
            <button type="button" className="link-btn small" onClick={p.sentBot}>
              {t('The notetaker is on its way. Open the meeting')}
            </button>
          ) : !notetakerJoins(link.kind) ? null : p.botWill ? (
            <span className="ev-bot-note">
              <Mic size={14} aria-hidden /> {t('The notetaker will join')}
              <button type="button" className="link-btn small" onClick={() => p.onBotJoin?.(false)}>
                {t('Don’t record')}
              </button>
            </span>
          ) : p.onBotJoin && !startsSoon ? (
            <button className="ghost-btn sm" onClick={() => p.onBotJoin!(true)}>
              <Mic size={14} /> {t('Record this meeting')}
            </button>
          ) : (
            p.onNotetaker && (
              <button className="ghost-btn sm" onClick={p.onNotetaker}>
                <Mic size={14} /> {t('Send notetaker')}
              </button>
            )
          )}
        </div>
      )}
      {event.location && event.location !== link?.url && <Row icon={<MapPin size={16} />}>{event.location}</Row>}
      {(event.organizer || event.inviteUid) && (
        <Row icon={<Mail size={16} />} muted>
          {[event.organizer ? t('Invited by {name}', { name: event.organizer.name }) : t('From an invite'), isPending(event) ? t('You haven’t answered yet') : event.rsvp === 'tentative' ? t('You said maybe') : event.rsvp === 'accepted' ? t('You’re going') : ''].filter(Boolean).join('. ')}
        </Row>
      )}
      {guests.length > 0 && (
        <div className="ev-row top">
          <Users size={16} />
          <div className="ev-guests">
            <span>{tn(guests.length + 1, '{n} person', '{n} people')}</span>
            {guests.map((g) => {
              const a = p.answers?.[g.email.toLowerCase()];
              return (
                <div key={g.email} className="ev-guest">
                  <Avatar person={g} size={24} />
                  <span className="ev-guest-name">{g.name}</span>
                  {a && (
                    <Badge tone={ANSWER[a].tone} small>
                      {t(ANSWER[a].label)}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {event.sendInvites && guests.length > 0 && !event.inviteUid && (
        <Row icon={<Send size={16} />} muted>
          {p.inviteNote ?? inviteWords(event)}
        </Row>
      )}
      {typeof event.remind === 'number' && <Row icon={<AlarmClock size={16} />} muted>{t('Reminder: {when}', { when: remindWords(event.remind) })}</Row>}
      {event.notes && (
        <div className="ev-row top">
          <StickyNote size={16} />
          <span className="ev-notes">{event.notes}</span>
        </div>
      )}
      {calendar && (
        <div className="ev-row muted">
          <span className="dot" style={{ background: calendar.color, margin: '0 4px' }} />
          <span>{calLabel(calendar)}</span>
        </div>
      )}
      {event.feed && (
        <Row icon={<Lock size={14} />} muted>
          {event.feed === 'holidays' ? (event.workspaceId ? t('Public holiday, shown to everyone in the company.') : t('Public holiday in a country you chose to see. Just on your calendar.')) : t('Read only. Change it in the calendar it comes from; this copy updates every 30 minutes.')}
        </Row>
      )}
      {task && (
        <div className="ev-task">
          <span className="muted small">{task.done ? t('Task done') : t('Time blocked for a task')}</span>
          {!task.done && (
            <div className="ev-task-btns">
              <button className="ghost-btn sm" onClick={() => p.onExtend?.(30)}>
                {t('Extend 30 min')}
              </button>
              <button className="ghost-btn sm" onClick={p.onTomorrow}>
                {t('Move to tomorrow')}
              </button>
              <button className="primary-btn sm" onClick={p.onTaskDone}>
                {t('Mark task done')}
              </button>
            </div>
          )}
        </div>
      )}
      {event.threadId && (
        <button className="ghost-btn outline ev-thread" onClick={() => p.onOpenThread(event.threadId!)}>
          <Mail size={15} /> {isPending(event) ? t('Open the invite') : t('Open related email')}
        </button>
      )}
    </div>
  );
}

/** "Mon 12 Oct · 09:30 to 09:45" (all day: "Mon 12 Oct", or "Mon 12 to Wed 14 Oct"). */
function whenWords(e: CalEvent) {
  const s = new Date(e.start);
  const end = new Date(e.end);
  const day = (d: Date) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
  if (e.allDay) {
    const last = addDays(end, -1);
    return sameDay(s, last) || last < s ? day(s) : t('{first} to {last}', { first: day(s), last: day(last) });
  }
  return sameDay(s, end) ? `${day(s)} · ${fmtTimeRange(s, end)}` : t('{first} to {last}', { first: `${day(s)} · ${fmtTime(s)}`, last: `${day(end)} · ${fmtTime(end)}` });
}

const BADGE: Record<GuestAnswer, { icon: typeof Check; tone: string }> = {
  accepted: { icon: Check, tone: 'yes' },
  declined: { icon: X, tone: 'no' },
  tentative: { icon: CircleHelp, tone: 'maybe' },
  'needs-action': { icon: CircleHelp, tone: 'wait' },
  delegated: { icon: CircleHelp, tone: 'wait' },
};

/** A row of the phone details: the icon in the 56 px column, then its text. */
function DRow({ icon, children, onClick, end, className = '' }: { icon: ReactNode; children: ReactNode; onClick?: () => void; end?: ReactNode; className?: string }) {
  const body = (
    <>
      <span className="dr-icon">{icon}</span>
      <span className="dr-text">{children}</span>
    </>
  );
  return (
    <div className={`dr-row ${className}`}>
      {onClick ? (
        <button type="button" className="dr-main" onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="dr-main">{body}</div>
      )}
      {end}
    </div>
  );
}

/**
 * Phones: Google Calendar's details page, full screen. X, the pencil and ⋮ at the top; the colour, title and when;
 * then rows: Join, the notetaker, the place, the reminder, the guests with their answers, notes, the calendar. An
 * invite has Yes, No and Maybe in a bar at the bottom.
 */
function PhoneDetail(p: DetailProps & { rsvp: ReactNode }) {
  const { event, calendar, task } = p;
  const link = meetingLinkOf(event);
  const now = Date.now();
  const ended = new Date(event.end).getTime() < now;
  const startMs = new Date(event.start).getTime();
  const startsSoon = startMs - now < 15 * 60_000;
  const guests = event.guests ?? [];
  const place = placeOf(event, link?.url);
  const pending = isPending(event);
  const [menu, setMenu] = useState(false);
  const dots = useRef<HTMLButtonElement>(null);
  const answers = guests.map((g) => p.answers?.[g.email.toLowerCase()]);
  const tally = (s: GuestAnswer) => answers.filter((a) => a === s).length;
  const yes = tally('accepted');
  const no = tally('declined');
  const maybe = tally('tentative');
  const waiting = guests.length - yes - no - maybe;
  const people = [event.organizer && !guests.some((g) => g.email.toLowerCase() === event.organizer!.email.toLowerCase()) ? { ...event.organizer, organiser: true } : null, ...guests.map((g) => ({ ...g, organiser: !!event.organizer && g.email.toLowerCase() === event.organizer.email.toLowerCase() }))].filter(Boolean) as (typeof guests[number] & { organiser: boolean })[];
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast({ text: t('Call link copied') }),
      () => toast({ text: t('Couldn’t copy it here. Open the event and copy from there.') }),
    );
  const zone = event.timeZone && isZone(event.timeZone) && event.timeZone !== deviceTz() && !event.allDay;
  const canEdit = !p.readOnly && !!p.onEdit && !event.feed;
  return (
    <>
      <Sheet
        onClose={p.onClose}
        label={event.title}
        size="full"
        className="ev-page ev-detail-page"
        footer={
          p.rsvp ||
          (canEdit ? (
            <button type="button" className="primary-btn ev-dp-edit" onClick={p.onEdit}>
              <Pencil size={16} /> {t('Edit event')}
            </button>
          ) : undefined)
        }
        head={
          <>
            <button type="button" className="icon-btn ev-page-x" onClick={p.onClose} aria-label={t('Close')}>
              <X size={22} />
            </button>
            <span className="spacer" />
            {!p.readOnly && p.onEdit && (
              <button type="button" className="icon-btn ev-page-act" onClick={p.onEdit} aria-label={t('Edit event')}>
                <Pencil size={20} />
              </button>
            )}
            {!!p.more?.length && (
              <button ref={dots} type="button" className="icon-btn ev-page-act" onClick={() => setMenu(true)} aria-label={t('More')}>
                <EllipsisVertical size={20} />
              </button>
            )}
          </>
        }
      >
        <div className="ev-dp" style={{ ['--c' as string]: calendar?.color }}>
          <div className="ev-dp-title">
            <span className="ev-dp-swatch" aria-hidden />
            <div>
              <h2>{event.title}</h2>
              <p>{whenWords(event)}</p>
              {event.rrule && <p>{repeatWords({ rrule: event.rrule, start: event.occurrence ?? event.start, timeZone: event.timeZone })}</p>}
              {zone && (
                <p>
                  {(() => {
                    const s = wallIn(new Date(event.start), event.timeZone!);
                    const e = wallIn(new Date(event.end), event.timeZone!);
                    const at = (w: { date: string; time: string }) => fmtTime(fromWall(w.date, w.time, null));
                    return t('{first} to {last} in {city}', { first: at(s), last: at(e), city: zoneCity(event.timeZone!) });
                  })()}
                </p>
              )}
            </div>
          </div>

          {link && !ended && (
            <div className="dr-row dr-join">
              <a className="dr-main" href={link.url} target="_blank" rel="noopener noreferrer">
                <span className="dr-icon">
                  <Video size={20} />
                </span>
                <span className="dr-text">
                  <strong>{t('Join {app}', { app: MEETING_NAME[link.kind] })}</strong>
                  <small>{link.url.replace(/^https?:\/\//, '')}</small>
                </span>
              </a>
              <button type="button" className="icon-btn dr-end" onClick={() => void copy(link.url)} aria-label={t('Copy call link')}>
                <Copy size={18} />
              </button>
            </div>
          )}
          {link && !ended && notetakerJoins(link.kind) && (p.sentBot || p.botWill !== undefined || p.onNotetaker) && (
            p.sentBot ? (
              <DRow icon={<Mic size={20} />} onClick={p.sentBot}>
                {t('The notetaker is on its way. Open the meeting')}
              </DRow>
            ) : p.botWill !== undefined && (p.botWill || !startsSoon) ? (
              <DRow
                icon={<Mic size={20} />}
                onClick={() => p.onBotJoin?.(!p.botWill)}
                end={
                  <span className={`switch dr-switch ${p.botWill ? 'on' : ''}`} aria-hidden>
                    <span />
                  </span>
                }
              >
                {t('Notetaker joins')}
              </DRow>
            ) : (
              p.onNotetaker && (
                <DRow icon={<Mic size={20} />} onClick={p.onNotetaker}>
                  {t('Send notetaker')}
                </DRow>
              )
            )
          )}
          {place && <DRow icon={<MapPin size={20} />}>{place}</DRow>}
          {typeof event.remind === 'number' && <DRow icon={<Bell size={20} />}>{remindWords(event.remind)}</DRow>}
          {/* Google's rows even when empty: what this event could have, each one tap from the editor. */}
          {canEdit && !place && !link && (
            <DRow icon={<MapPin size={20} />} onClick={p.onEdit}>
              <span className="dr-muted">{t('Add a place or a call link')}</span>
            </DRow>
          )}
          {canEdit && typeof event.remind !== 'number' && (
            <DRow icon={<Bell size={20} />} onClick={p.onEdit}>
              <span className="dr-muted">{tx('event', 'No reminder')}</span>
            </DRow>
          )}
          {canEdit && !people.length && (
            <DRow icon={<Users size={20} />} onClick={p.onEdit}>
              <span className="dr-muted">{t('Add guests')}</span>
            </DRow>
          )}

          {people.length > 0 && (
            <div className="dr-guests">
              <DRow icon={<Users size={20} />}>
                <span>{tn(people.length, '{n} guest', '{n} guests')}</span>
                {p.answers && (
                  <small>
                    {[yes && t('{n} yes', { n: yes }), no && t('{n} no', { n: no }), maybe && t('{n} maybe', { n: maybe }), waiting && t('{n} awaiting', { n: waiting })].filter(Boolean).join(', ')}
                  </small>
                )}
                {event.sendInvites && guests.length > 0 && !event.inviteUid && <small>{p.inviteNote ?? inviteWords(event)}</small>}
              </DRow>
              {people.map((g) => {
                const a = p.answers?.[g.email.toLowerCase()];
                const B = a ? BADGE[a] : null;
                return (
                  <div key={g.email} className="dr-guest">
                    <span className="dr-guest-av">
                      <Avatar person={g} size={32} />
                      {B && (
                        <i className={`dr-badge ${B.tone}`} aria-label={t(ANSWER[a!].label)}>
                          <B.icon size={9} strokeWidth={3.5} />
                        </i>
                      )}
                    </span>
                    <span className="dr-guest-text">
                      <span>{g.name}</span>
                      {g.organiser && <small>{t('Organiser')}</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {event.notes ? (
            <DRow icon={<TextAlignStart size={20} />} className="top">
              <span className="dr-notes">{event.notes}</span>
            </DRow>
          ) : (
            canEdit && (
              <DRow icon={<TextAlignStart size={20} />} onClick={p.onEdit}>
                <span className="dr-muted">{t('Add a description')}</span>
              </DRow>
            )
          )}
          {calendar && (
            <DRow icon={<span className="dr-cal-dot" style={{ background: calendar.color }} />}>
              <span className="dr-muted">{calLabel(calendar)}</span>
            </DRow>
          )}
          {event.feed && (
            <DRow icon={<Lock size={18} />}>
              <span className="dr-muted">
                {event.feed === 'holidays' ? (event.workspaceId ? t('Public holiday, shown to everyone in the company.') : t('Public holiday in a country you chose to see. Just on your calendar.')) : t('Read only. Change it in the calendar it comes from; this copy updates every 30 minutes.')}
              </span>
            </DRow>
          )}
          {task && (
            <div className="dr-task">
              <DRow icon={<Clock size={20} />}>{task.done ? t('Task done') : t('Time blocked for a task')}</DRow>
              {!task.done && (
                <div className="dr-chips">
                  <button className="dr-chip" onClick={() => p.onExtend?.(30)}>
                    {t('Extend 30 min')}
                  </button>
                  <button className="dr-chip" onClick={p.onTomorrow}>
                    {t('Tomorrow')}
                  </button>
                  <button className="dr-chip" onClick={p.onTaskDone}>
                    {t('Mark done')}
                  </button>
                </div>
              )}
            </div>
          )}
          {event.threadId && (
            <DRow icon={<Mail size={20} />} onClick={() => p.onOpenThread(event.threadId!)}>
              {pending ? t('Open the invite email') : t('Open related email')}
            </DRow>
          )}
        </div>
      </Sheet>
      <ActionSheet open={menu} onClose={() => setMenu(false)} title={event.title} actions={p.more ?? []} anchor={dots} menu />
    </>
  );
}
