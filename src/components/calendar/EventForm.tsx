import { useState, type RefObject } from 'react';
import { AlarmClock, CalendarCheck, CalendarDays, Check, ChevronDown, Globe, MapPin, Repeat, StickyNote, Sun, Video } from 'lucide-react';
import type { CalEvent, CalendarDef, Person, User } from '../../types';
import { deviceTz, isZone } from '../../jobTimes';
import { addDays } from '../../calendarUtils';
import { clockOf, dateFacts, repeatWords, ruleToSpec, specToRule } from '../../repeat';
import { zoneOptions } from '../ui/zones';
import { fromWall, wallIn } from './calTools';
import { DatePicker, TimePicker } from '../ui/DatePicker';
import { Select } from '../ui/Select';
import { SmoothHeight } from '../ui/Smooth';
import { GuestPicker } from './GuestPicker';
import { RepeatField, RepeatToken, type RepeatDraft } from './RepeatField';

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
  tz: string | null; // the times are in this time zone (null: this device's)
  repeat: RepeatDraft;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** No repeat. */
export const NO_REPEAT: RepeatDraft = { spec: null, raw: null, touched: false };
/** The draft's date and start on its own clock (as if UTC): what a repeat is worked out from (its weekday, its day). */
export const draftWall = (d: Pick<Draft, 'date' | 'from' | 'allDay'>) => {
  const [y, m, day] = d.date.split('-').map(Number);
  return Date.UTC(y, m - 1, day, d.allDay ? 0 : toMin(d.from) / 60, d.allDay ? 0 : toMin(d.from) % 60);
};
/** The repeat of an event (one date of a series: the series' rule, read on that date's original day). */
function repeatOf(e?: CalEvent): RepeatDraft {
  if (!e?.rrule) return NO_REPEAT;
  const clock = clockOf(e);
  const spec = ruleToSpec(e.rrule, clock.wall(e.occurrence ?? e.start), clock);
  return spec ? { spec, raw: null, touched: false } : { spec: null, raw: e.rrule, rawWords: repeatWords({ ...e, start: e.occurrence ?? e.start }) ?? undefined, touched: false };
}

export function draftOf(start: Date, end: Date, calendarId: string, e?: CalEvent): Draft {
  const tz = e?.timeZone && isZone(e.timeZone) && e.timeZone !== deviceTz() ? e.timeZone : null;
  const s = wallIn(start, tz);
  return {
    kind: 'event',
    title: e?.title ?? '',
    date: s.date,
    from: s.time,
    to: wallIn(end, tz).time,
    allDay: !!e?.allDay,
    calendarId: e?.calendarId ?? calendarId,
    guests: e?.guests ?? [],
    location: e?.location && e.location !== e.meetUrl ? e.location : '',
    meetUrl: e?.meetUrl ?? '',
    notes: e?.notes ?? '',
    remind: e?.remind ?? null,
    tz,
    repeat: repeatOf(e),
  };
}

/** The draft's start and end (an all-day event ends the next midnight; times in another zone are read in it). */
export function draftTimes(d: Draft) {
  const start = d.allDay ? new Date(`${d.date}T00:00`) : fromWall(d.date, d.from, d.tz);
  const end = d.allDay ? addDays(start, 1) : fromWall(d.date, d.to, d.tz);
  return { start, end, ok: !isNaN(start.getTime()) && end > start };
}

/**
 * The event fields a draft turns into (the caller adds id, owner and company). A repeating one always keeps its time
 * zone (its dates keep that clock time); its rule goes along only when the repeat was picked in this edit ('' for none).
 */
export function draftEvent(d: Draft): Omit<CalEvent, 'id'> {
  const { start, end } = draftTimes(d);
  const link = d.meetUrl.trim();
  const repeats = !!(d.repeat.spec || d.repeat.raw);
  const tz = d.tz ?? deviceTz();
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
    timeZone: repeats ? tz : d.tz && !d.allDay ? d.tz : undefined,
    ...(d.repeat.touched ? { rrule: d.repeat.spec ? specToRule(d.repeat.spec, draftWall(d), { floating: false, tz }) : (d.repeat.raw ?? '') } : {}),
  };
}

const SOURCE: Record<string, string> = { google: 'Google', microsoft: 'Outlook', icloud: 'iCloud', ics: 'link' };
/** A calendar's name, with where it lives when another one has the same name ("Personal" and "Personal, Google"). */
export const calName = (c: CalendarDef, all: CalendarDef[]) => (c.source && SOURCE[c.source] && all.some((x) => x !== c && x.name === c.name) ? `${c.name}, ${SOURCE[c.source]}` : c.name);

const REMIND: { value: string; label: string }[] = [
  { value: '0', label: 'When it starts' },
  { value: '5', label: '5 minutes before' },
  { value: '10', label: '10 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' },
];
export const remindWords = (m: number) => REMIND.find((r) => r.value === String(m))?.label ?? `${m} minutes before`;

type Extra = 'location' | 'meet' | 'notes' | 'remind' | 'calendar' | 'tz' | 'repeat';

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
  const shows = (x: Extra) =>
    (x !== 'repeat' && opened.has(x)) ||
    (x === 'location' && !!draft.location) ||
    (x === 'meet' && !!draft.meetUrl) ||
    (x === 'notes' && !!draft.notes) ||
    (x === 'remind' && draft.remind !== null) ||
    (x === 'tz' && !!draft.tz && !draft.allDay) ||
    (x === 'repeat' && !!(draft.repeat.spec || draft.repeat.raw));
  const task = draft.kind === 'task';
  // Custom repeat opened (its panel stays open while the choice is still one of the named ones).
  const [custom, setCustom] = useState(false);
  const wall = draftWall(draft);
  /** A new date: a weekly repeat on that one weekday follows it. */
  const moveDate = (date: string) => {
    const r = draft.repeat;
    const was = dateFacts(wall).wd;
    const now = dateFacts(draftWall({ ...draft, date })).wd;
    const follow = r.spec?.freq === 'WEEKLY' && r.spec.days?.length === 1 && r.spec.days[0] === was && now !== was;
    set({ date, ...(follow ? { repeat: { ...r, spec: { ...r.spec!, days: [now] } } } : {}) });
  };
  // Moving the start keeps the length (a 1 hour meeting stays 1 hour), the way calendars do.
  const moveStart = (v: string) => {
    const len = Math.max(15, toMin(draft.to) - toMin(draft.from));
    set({ from: v, to: hhmm(Math.min(23 * 60 + 45, toMin(v) + len)) });
  };
  const cal = calendars.find((c) => c.id === draft.calendarId) ?? calendars[0];
  const quiet: { id: Extra | 'allday'; label: string; icon: typeof Sun; on?: boolean }[] = [
    { id: 'allday', label: 'All day', icon: Sun, on: draft.allDay },
    ...(!task ? [{ id: 'repeat' as const, label: 'Repeat', icon: Repeat }] : []),
    ...(!task
      ? ([
          { id: 'meet', label: 'Video call', icon: Video },
          { id: 'location', label: 'Location', icon: MapPin },
        ] as const)
      : []),
    ...(!draft.allDay ? [{ id: 'tz' as const, label: 'Time zone', icon: Globe }] : []),
    { id: 'remind', label: 'Reminder', icon: AlarmClock },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    ...(!task && calendars.length > 1 ? [{ id: 'calendar' as const, label: cal ? calName(cal, calendars) : 'Calendar', icon: CalendarDays }] : []),
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
        <DatePicker value={draft.date} onChange={(v) => v && moveDate(v)} clearable={false} label="Date" />
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
            {!task && shows('repeat') && (
              <RepeatField
                value={draft.repeat}
                startWall={wall}
                startDay={draft.date}
                custom={custom}
                onCustom={setCustom}
                onChange={(repeat) => {
                  if (!repeat.spec && !repeat.raw) setCustom(false);
                  set({ repeat });
                }}
              />
            )}
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
            {shows('tz') && !draft.allDay && (
              <div className="ev-extra">
                <Globe size={16} />
                <Select<string>
                  value={draft.tz ?? deviceTz()}
                  // The same clock times, now in the chosen zone ("10:00, Singapore time").
                  onChange={(v) => set({ tz: v === deviceTz() ? null : v })}
                  options={zoneOptions(draft.tz ?? deviceTz())}
                  label="Time zone"
                  title="The times are in"
                  searchable
                  className="sel-flat"
                />
              </div>
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
                    {calName(c, calendars)}
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
            {tokens.map((q) =>
              q.id === 'repeat' ? (
                // Repeat picks straight away: the word opens the list of repeats.
                <RepeatToken
                  key={q.id}
                  startWall={wall}
                  onPick={(spec, isCustom) => {
                    setCustom(isCustom);
                    set({ repeat: { spec, raw: null, touched: true } });
                  }}
                />
              ) : (
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
              ),
            )}
          </div>
        )
      )}
    </div>
  );
}
