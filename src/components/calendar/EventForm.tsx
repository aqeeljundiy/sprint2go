import { useState, type RefObject } from 'react';
import { AlarmClock, CalendarCheck, CalendarDays, Check, ChevronDown, MapPin, StickyNote, Sun, Video } from 'lucide-react';
import type { CalEvent, CalendarDef, Person, User } from '../../types';
import { toDateInput, toTimeInput } from '../../calendarUtils';
import { DatePicker, TimePicker } from '../ui/DatePicker';
import { Select } from '../ui/Select';
import { SmoothHeight } from '../ui/Smooth';
import { GuestPicker } from './GuestPicker';

/** What the event editor and the phone's quick create hold while someone types. */
export interface Draft {
  kind: 'event' | 'task';
  title: string;
  date: string; // YYYY-MM-DD
  from: string; // HH:MM
  to: string;
  allDay: boolean;
  calendarId: string;
  guests: Person[];
  location: string;
  meetUrl: string;
  notes: string;
  remind: number | null; // minutes before the start
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function draftOf(start: Date, end: Date, calendarId: string, e?: CalEvent): Draft {
  return {
    kind: 'event',
    title: e?.title ?? '',
    date: toDateInput(start),
    from: toTimeInput(start),
    to: toTimeInput(end),
    allDay: !!e?.allDay,
    calendarId: e?.calendarId ?? calendarId,
    guests: e?.guests ?? [],
    location: e?.location && e.location !== e.meetUrl ? e.location : '',
    meetUrl: e?.meetUrl ?? '',
    notes: e?.notes ?? '',
    remind: e?.remind ?? null,
  };
}

/** The draft's start and end (an all-day event ends the next midnight). */
export function draftTimes(d: Draft) {
  const start = new Date(`${d.date}T${d.allDay ? '00:00' : d.from}`);
  let end = new Date(`${d.date}T${d.allDay ? '00:00' : d.to}`);
  if (d.allDay) end = new Date(start.getTime() + 86_400_000);
  return { start, end, ok: !isNaN(start.getTime()) && end > start };
}

/** The event fields a draft turns into (the caller adds id, owner and company). */
export function draftEvent(d: Draft): Omit<CalEvent, 'id'> {
  const { start, end } = draftTimes(d);
  const link = d.meetUrl.trim();
  return {
    title: d.title.trim(),
    calendarId: d.calendarId,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: d.allDay || undefined,
    location: d.location.trim() || undefined,
    meetUrl: link ? (/^https?:\/\//i.test(link) ? link : `https://${link}`) : undefined,
    notes: d.notes.trim() || undefined,
    guests: d.guests.length ? d.guests : undefined,
    remind: d.remind ?? undefined,
  };
}

const REMIND: { value: string; label: string }[] = [
  { value: '0', label: 'When it starts' },
  { value: '5', label: '5 minutes before' },
  { value: '10', label: '10 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' },
];
export const remindWords = (m: number) => REMIND.find((r) => r.value === String(m))?.label ?? `${m} minutes before`;

type Extra = 'location' | 'meet' | 'notes' | 'remind' | 'calendar';

/**
 * The fields of an event: title, Event or Task, when, guests; then the optional ones as quiet words (All day, Video
 * call, Location, Reminder, Notes, Calendar) that open into a field when tapped. A field that has something stays open.
 * `compact` (the phone's quick create) keeps the quiet words behind "More options" until asked.
 */
export function EventForm({
  draft,
  set,
  calendars,
  team,
  contacts,
  me,
  kindSwitch,
  compact,
  onMore,
  titleRef,
  autoFocus,
  onSubmit,
}: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  calendars: CalendarDef[];
  team: User[];
  contacts: Person[];
  me: string;
  kindSwitch?: boolean; // new ones: Event or Task
  compact?: boolean;
  onMore?: () => void;
  titleRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  onSubmit: () => void;
}) {
  const [opened, setOpened] = useState<Set<Extra>>(() => new Set());
  const open = (x: Extra) => setOpened((s) => new Set(s).add(x));
  const shows = (x: Extra) => opened.has(x) || (x === 'location' && !!draft.location) || (x === 'meet' && !!draft.meetUrl) || (x === 'notes' && !!draft.notes) || (x === 'remind' && draft.remind !== null);
  const task = draft.kind === 'task';
  // Moving the start keeps the length (a 1 hour meeting stays 1 hour), the way calendars do.
  const moveStart = (v: string) => {
    const len = Math.max(15, toMin(draft.to) - toMin(draft.from));
    set({ from: v, to: hhmm(Math.min(23 * 60 + 45, toMin(v) + len)) });
  };
  const cal = calendars.find((c) => c.id === draft.calendarId) ?? calendars[0];
  const quiet: { id: Extra | 'allday'; label: string; icon: typeof Sun; on?: boolean }[] = [
    { id: 'allday', label: 'All day', icon: Sun, on: draft.allDay },
    ...(!task
      ? ([
          { id: 'meet', label: 'Video call', icon: Video },
          { id: 'location', label: 'Location', icon: MapPin },
        ] as const)
      : []),
    { id: 'remind', label: 'Reminder', icon: AlarmClock },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    ...(!task && calendars.length > 1 ? [{ id: 'calendar' as const, label: cal ? cal.name : 'Calendar', icon: CalendarDays }] : []),
  ];
  const tokens = quiet.filter((q) => q.id === 'allday' || !shows(q.id as Extra));
  return (
    <div className="ev-form">
      <input
        ref={titleRef}
        autoFocus={autoFocus}
        className="title-input ev-form-title"
        value={draft.title}
        onChange={(e) => set({ title: e.target.value })}
        // Enter saves once (⌘ Enter in a dialog would reach its own shortcut too, and save it twice).
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.stopPropagation(), e.preventDefault(), onSubmit())}
        placeholder={task ? 'What needs doing' : 'Add title'}
        aria-label="Title"
        enterKeyHint="done"
      />
      {kindSwitch && (
        <div className="segmented ev-kind" role="tablist" aria-label="Event or task">
          <button type="button" role="tab" aria-selected={!task} className={!task ? 'on' : ''} onClick={() => set({ kind: 'event' })}>
            <CalendarDays size={14} /> Event
          </button>
          <button type="button" role="tab" aria-selected={task} className={task ? 'on' : ''} onClick={() => set({ kind: 'task' })}>
            <CalendarCheck size={14} /> Task
          </button>
        </div>
      )}
      <div className="field-row ev-when">
        <DatePicker value={draft.date} onChange={(v) => v && set({ date: v })} clearable={false} label="Date" />
        {!draft.allDay && (
          <span className="ev-times">
            <TimePicker value={draft.from} onChange={moveStart} label="Starts" />
            <span className="muted">to</span>
            <TimePicker value={draft.to} onChange={(v) => set({ to: v })} label="Ends" />
          </span>
        )}
      </div>
      {!task && <GuestPicker value={draft.guests} onChange={(guests) => set({ guests })} team={team} contacts={contacts} me={me} />}
      <SmoothHeight>
        {quiet.some((q) => q.id !== 'allday' && shows(q.id as Extra)) && (
          <div className="ev-extras">
            {!task && shows('meet') && (
              <label className="ev-extra">
                <Video size={16} />
                <input autoFocus={opened.has('meet') && !draft.meetUrl} value={draft.meetUrl} onChange={(e) => set({ meetUrl: e.target.value })} placeholder="Paste a Meet, Zoom or Teams link" inputMode="url" aria-label="Video call link" />
              </label>
            )}
            {!task && shows('location') && (
              <label className="ev-extra">
                <MapPin size={16} />
                <input autoFocus={opened.has('location') && !draft.location} value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Where" aria-label="Location" />
              </label>
            )}
            {shows('remind') && (
              <div className="ev-extra">
                <AlarmClock size={16} />
                <Select<string>
                  value={draft.remind === null ? '' : String(draft.remind)}
                  onChange={(v) => set({ remind: v === 'none' ? null : Number(v) })}
                  options={[...REMIND, { value: 'none', label: 'No reminder' }]}
                  label="Reminder"
                  title="Remind me"
                  placeholder="Remind me…"
                  className="sel-flat"
                />
              </div>
            )}
            {shows('notes') && (
              <label className="ev-extra top">
                <StickyNote size={16} />
                <textarea autoFocus={opened.has('notes') && !draft.notes} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes" rows={3} aria-label="Notes" />
              </label>
            )}
            {!task && shows('calendar') && (
              <div className="cal-pick" role="radiogroup" aria-label="Calendar">
                {calendars.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={draft.calendarId === c.id} className={draft.calendarId === c.id ? 'on' : ''} style={{ ['--c' as string]: c.color }} onClick={() => set({ calendarId: c.id })}>
                    <span className="dot" style={{ background: c.color }} />
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </SmoothHeight>
      {compact ? (
        <button type="button" className="link-btn ev-more" onClick={() => onMore?.()}>
          More options <ChevronDown size={14} />
        </button>
      ) : (
        tokens.length > 0 && (
          <div className="ev-quiet" aria-label="More details">
            {tokens.map((q) => (
              <button
                key={q.id}
                type="button"
                className={`ev-token${q.on ? ' on' : ''}`}
                aria-pressed={q.id === 'allday' ? !!q.on : undefined}
                onClick={() => (q.id === 'allday' ? set({ allDay: !draft.allDay }) : open(q.id))}
              >
                {q.on ? <Check size={14} /> : <q.icon size={14} />}
                {q.label}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}
