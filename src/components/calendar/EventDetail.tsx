import type { ReactNode } from 'react';
import { AlarmClock, Check, Clock, Globe, Lock, Mail, MapPin, Mic, Pencil, Repeat, StickyNote, Trash2, Users, Video, X } from 'lucide-react';
import type { CalEvent, CalendarDef, RsvpStatus } from '../../types';
import { MEETING_NAME, meetingLinkOf, notetakerJoins } from '../../meetingLinks';
import { Avatar } from '../Avatar';
import { Badge, type BadgeTone } from '../ui/Person';
import { Sheet } from '../ui/Sheet';
import { fromWall, isPending, startsIn, wallIn, whenLine, zoneCity } from './calTools';
import { deviceTz, isZone } from '../../jobTimes';
import { remindWords } from './EventForm';
import { repeatWords } from '../../repeat';

export type GuestAnswer = RsvpStatus | 'needs-action' | 'delegated';

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
}

const ANSWER: Record<GuestAnswer, { label: string; tone: BadgeTone }> = {
  accepted: { label: 'Going', tone: 'good' },
  tentative: { label: 'Maybe', tone: 'warn' },
  declined: { label: 'Not going', tone: 'bad' },
  'needs-action': { label: 'No answer yet', tone: 'neutral' },
  delegated: { label: 'Sent someone', tone: 'neutral' },
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
        <button className="icon-btn" onClick={p.onEdit} aria-label="Edit event" title="Edit">
          <Pencil size={17} />
        </button>
      )}
      {!p.readOnly && (
        <button className="icon-btn" onClick={(e) => p.onDelete(e.currentTarget)} aria-label="Delete event" title="Delete">
          <Trash2 size={17} />
        </button>
      )}
      {!p.phone && (
        <button className="icon-btn" onClick={p.onClose} aria-label="Close" title="Close (Esc)">
          <X size={17} />
        </button>
      )}
    </div>
  );
  if (p.phone)
    return (
      <Sheet onClose={p.onClose} label={event.title} head={actions} footer={rsvp} className="ev-sheet" size="auto">
        <DetailBody {...p} />
      </Sheet>
    );
  return (
    <aside className="ev-detail" style={{ ['--c' as string]: p.calendar?.color }} aria-label={event.title}>
      {actions}
      <DetailBody {...p} />
      {rsvp}
    </aside>
  );
}

function Rsvp({ value, onPick }: { value?: RsvpStatus; onPick: (s: RsvpStatus, at?: Element) => void }) {
  const opts: [RsvpStatus, string][] = [
    ['accepted', 'Yes'],
    ['tentative', 'Maybe'],
    ['declined', 'No'],
  ];
  return (
    <div className="ev-rsvp" role="group" aria-label="Going?">
      <span className="ev-rsvp-q">Going?</span>
      {opts.map(([v, l]) => (
        <button key={v} type="button" className={`ev-rsvp-btn${value === v ? ' on' : ''}`} aria-pressed={value === v} onClick={(e) => onPick(v, e.currentTarget)}>
          {value === v && <Check size={14} />}
          {l}
        </button>
      ))}
    </div>
  );
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
        {soon && !event.allDay && <em className="ev-soon">{startMs <= now ? 'Now' : startsIn(event, now)}</em>}
      </Row>
      {event.timeZone && isZone(event.timeZone) && event.timeZone !== deviceTz() && !event.allDay && (
        <Row icon={<Globe size={16} />} muted>
          {(() => {
            // The same moments on the clock where it was set.
            const s = wallIn(new Date(event.start), event.timeZone);
            const e = wallIn(new Date(event.end), event.timeZone);
            const t = (w: { date: string; time: string }) => fromWall(w.date, w.time, null).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            return `${t(s)} to ${t(e)} in ${zoneCity(event.timeZone)}`;
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
            <Video size={16} /> Join {MEETING_NAME[link.kind]}
          </a>
          {p.sentBot ? (
            <button type="button" className="link-btn small" onClick={p.sentBot}>
              The notetaker is on its way. Open the meeting
            </button>
          ) : !notetakerJoins(link.kind) ? null : p.botWill ? (
            <span className="ev-bot-note">
              <Mic size={14} aria-hidden /> The notetaker will join
              <button type="button" className="link-btn small" onClick={() => p.onBotJoin?.(false)}>
                Don’t record
              </button>
            </span>
          ) : p.onBotJoin && !startsSoon ? (
            <button className="ghost-btn sm" onClick={() => p.onBotJoin!(true)}>
              <Mic size={14} /> Record this meeting
            </button>
          ) : (
            p.onNotetaker && (
              <button className="ghost-btn sm" onClick={p.onNotetaker}>
                <Mic size={14} /> Send notetaker
              </button>
            )
          )}
        </div>
      )}
      {event.location && event.location !== link?.url && <Row icon={<MapPin size={16} />}>{event.location}</Row>}
      {(event.organizer || event.inviteUid) && (
        <Row icon={<Mail size={16} />} muted>
          {event.organizer ? `Invited by ${event.organizer.name}` : 'From an invite'}
          {isPending(event) ? '. You haven’t answered yet' : event.rsvp === 'tentative' ? '. You said maybe' : event.rsvp === 'accepted' ? '. You’re going' : ''}
        </Row>
      )}
      {guests.length > 0 && (
        <div className="ev-row top">
          <Users size={16} />
          <div className="ev-guests">
            <span>{guests.length + 1} people</span>
            {guests.map((g) => {
              const a = p.answers?.[g.email.toLowerCase()];
              return (
                <div key={g.email} className="ev-guest">
                  <Avatar person={g} size={24} />
                  <span className="ev-guest-name">{g.name}</span>
                  {a && (
                    <Badge tone={ANSWER[a].tone} small>
                      {ANSWER[a].label}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {typeof event.remind === 'number' && <Row icon={<AlarmClock size={16} />} muted>Reminder {remindWords(event.remind).toLowerCase()}</Row>}
      {event.notes && (
        <div className="ev-row top">
          <StickyNote size={16} />
          <span className="ev-notes">{event.notes}</span>
        </div>
      )}
      {calendar && (
        <div className="ev-row muted">
          <span className="dot" style={{ background: calendar.color, margin: '0 4px' }} />
          <span>{calendar.name}</span>
        </div>
      )}
      {event.feed && (
        <Row icon={<Lock size={14} />} muted>
          {event.feed === 'holidays' ? (event.workspaceId ? 'Public holiday, shown to everyone in the company.' : 'Public holiday in a country you chose to see. Just on your calendar.') : 'Read only. Change it in the calendar it comes from; this copy updates every 30 minutes.'}
        </Row>
      )}
      {task && (
        <div className="ev-task">
          <span className="muted small">{task.done ? 'Task done' : 'Time blocked for a task'}</span>
          {!task.done && (
            <div className="ev-task-btns">
              <button className="ghost-btn sm" onClick={() => p.onExtend?.(30)}>
                Extend 30 min
              </button>
              <button className="ghost-btn sm" onClick={p.onTomorrow}>
                Move to tomorrow
              </button>
              <button className="primary-btn sm" onClick={p.onTaskDone}>
                Mark task done
              </button>
            </div>
          )}
        </div>
      )}
      {event.threadId && (
        <button className="ghost-btn outline ev-thread" onClick={() => p.onOpenThread(event.threadId!)}>
          <Mail size={15} /> {isPending(event) ? 'Open the invite' : 'Open related email'}
        </button>
      )}
    </div>
  );
}
