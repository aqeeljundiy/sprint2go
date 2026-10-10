import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AlarmClock, Bell, CalendarCheck, CalendarDays, Check, Clock, Globe, MapPin, Repeat, StickyNote, Sun, TextAlignStart, Users, Video, X } from 'lucide-react';
import type { CalEvent, CalendarDef, Person, User } from '../../types';
import { deviceTz, isZone } from '../../jobTimes';
import { addDays } from '../../calendarUtils';
import { clockOf, dateFacts, repeatWords, ruleToSpec, specToRule } from '../../repeat';
import { zoneOptions } from '../ui/zones';
import { fromWall, wallIn } from './calTools';
import { DatePicker, shortDate, TimePicker } from '../ui/DatePicker';
import { Select } from '../ui/Select';
import { SmoothHeight } from '../ui/Smooth';
import { GuestPicker } from './GuestPicker';
import { RepeatField, RepeatRow, RepeatToken, type RepeatDraft } from './RepeatField';
import { t, tn, tx } from '../../i18n';
import { calLabel } from '../../data/calendar';

/** What the event editor and the phone's quick create hold while someone types. */
export interface Draft {
  kind: 'event' | 'task' | 'ooo'; // ooo: out of office (an all-day event of its own kind on phones)
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
  sendInvites: boolean | null; // email the invite to the guests (null: an invite we got, not ours to send)
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
    // New events with guests send the invite; older ones only when it was switched on.
    sendInvites: e?.inviteUid ? null : e ? !!e.sendInvites : true,
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
    sendInvites: d.sendInvites && d.guests.length ? true : undefined,
    remind: d.remind ?? undefined,
    timeZone: repeats ? tz : d.tz && !d.allDay ? d.tz : undefined,
    ...(d.repeat.touched ? { rrule: d.repeat.spec ? specToRule(d.repeat.spec, draftWall(d), { floating: false, tz }) : (d.repeat.raw ?? '') } : {}),
  };
}

const SOURCE: Record<string, string> = { google: 'Google', microsoft: 'Outlook', icloud: 'iCloud', ics: 'link' };
/** A calendar's name, with where it lives when another one has the same name ("Personal" and "Personal, Google"). */
export const calName = (c: CalendarDef, all: CalendarDef[]) => (c.source && SOURCE[c.source] && all.some((x) => x !== c && x.name === c.name) ? `${calLabel(c)}, ${c.source === 'ics' ? t('link') : SOURCE[c.source]}` : calLabel(c));

/** The reminder choices, in the person's language. */
const remindOptions = (): { value: string; label: string }[] => [
  { value: '0', label: t('When it starts') },
  { value: '5', label: t('5 minutes before') },
  { value: '10', label: t('10 minutes before') },
  { value: '30', label: t('30 minutes before') },
  { value: '60', label: t('1 hour before') },
  { value: '1440', label: t('1 day before') },
];
export const remindWords = (m: number) => remindOptions().find((r) => r.value === String(m))?.label ?? tn(m, '{n} minute before', '{n} minutes before');

type Extra = 'location' | 'meet' | 'notes' | 'remind' | 'calendar' | 'tz' | 'repeat';

/**
 * The fields of an event: title, Event or Task, when, guests; then the optional ones as quiet words (All day, Video
 * call, Location, Reminder, Notes, Calendar) that open into a field when tapped. A field that has something stays open.
 * Desktop's dialog; phones use EventRows (below).
 */
export function EventForm({
  draft,
  set,
  calendars,
  team,
  contacts,
  me,
  kindSwitch,
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
    { id: 'allday', label: t('All day'), icon: Sun, on: draft.allDay },
    ...(!task ? [{ id: 'repeat' as const, label: t('Repeat'), icon: Repeat }] : []),
    ...(!task
      ? ([
          { id: 'meet', label: t('Video call'), icon: Video },
          { id: 'location', label: t('Location'), icon: MapPin },
        ] as const)
      : []),
    ...(!draft.allDay ? [{ id: 'tz' as const, label: t('Time zone'), icon: Globe }] : []),
    { id: 'remind', label: t('Reminder'), icon: AlarmClock },
    { id: 'notes', label: t('Notes'), icon: StickyNote },
    ...(!task && calendars.length > 1 ? [{ id: 'calendar' as const, label: cal ? calName(cal, calendars) : t('Calendar'), icon: CalendarDays }] : []),
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
        placeholder={task ? t('What needs doing') : t('Add title')}
        aria-label={tx('event', 'Title')}
        enterKeyHint="done"
      />
      {kindSwitch && (
        <div className="segmented ev-kind" role="tablist" aria-label={t('Event or task')}>
          <button type="button" role="tab" aria-selected={!task} className={!task ? 'on' : ''} onClick={() => set({ kind: 'event' })}>
            <CalendarDays size={14} /> {t('Event')}
          </button>
          <button type="button" role="tab" aria-selected={task} className={task ? 'on' : ''} onClick={() => set({ kind: 'task' })}>
            <CalendarCheck size={14} /> {t('Task')}
          </button>
        </div>
      )}
      <div className="field-row ev-when">
        <DatePicker value={draft.date} onChange={(v) => v && moveDate(v)} clearable={false} label={t('Date')} />
        {!draft.allDay && (
          <span className="ev-times">
            <TimePicker value={draft.from} onChange={moveStart} label={t('Starts')} />
            <span className="muted">{tx('time', 'to')}</span>
            <TimePicker value={draft.to} onChange={(v) => set({ to: v })} label={tx('time', 'Ends')} />
          </span>
        )}
      </div>
      {!task && <GuestPicker value={draft.guests} onChange={(guests) => set({ guests })} team={team} contacts={contacts} me={me} />}
      <SmoothHeight>
        {!task && draft.guests.length > 0 && draft.sendInvites !== null && (
          // Guests get it by email (a calendar invite with Yes / Maybe / No), and its updates.
          <div className="ev-invite">
            <span>{t('Email the invite to guests')}</span>
            <button type="button" role="switch" aria-checked={draft.sendInvites} aria-label={t('Email the invite to guests')} className={`switch ${draft.sendInvites ? 'on' : ''}`} onClick={() => set({ sendInvites: !draft.sendInvites })}>
              <span />
            </button>
          </div>
        )}
      </SmoothHeight>
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
                <input autoFocus={opened.has('meet') && !draft.meetUrl} value={draft.meetUrl} onChange={(e) => set({ meetUrl: e.target.value })} placeholder={t('Paste a Meet, Zoom or Teams link')} inputMode="url" aria-label={t('Video call link')} />
              </label>
            )}
            {!task && shows('location') && (
              <label className="ev-extra">
                <MapPin size={16} />
                <input autoFocus={opened.has('location') && !draft.location} value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder={t('Where')} aria-label={t('Location')} />
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
                  label={t('Time zone')}
                  title={t('The times are in')}
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
                  options={[...remindOptions(), { value: 'none', label: tx('remind', 'No reminder') }]}
                  label={t('Reminder')}
                  title={t('Remind me')}
                  placeholder={t('Remind me…')}
                  className="sel-flat"
                />
              </div>
            )}
            {shows('notes') && (
              <label className="ev-extra top">
                <StickyNote size={16} />
                <textarea autoFocus={opened.has('notes') && !draft.notes} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={t('Notes')} rows={3} aria-label={t('Notes')} />
              </label>
            )}
            {!task && shows('calendar') && (
              <div className="cal-pick" role="radiogroup" aria-label={t('Calendar')}>
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
      {tokens.length > 0 && (
          <div className="ev-quiet" aria-label={t('More details')}>
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
      )}
    </div>
  );
}

/** A row of the phone editor: the icon in the 56 px column, then what it holds. */
function ERow({ icon, children, className = '', top }: { icon?: React.ReactNode; children: React.ReactNode; className?: string; top?: boolean }) {
  return (
    <div className={`er-row${top ? ' top' : ''} ${className}`}>
      <span className="er-icon">{icon}</span>
      <div className="er-body">{children}</div>
    </div>
  );
}

/** A text box that grows with what's typed (notes). */
function GrowText({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} className="er-input er-notes" rows={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />;
}

/**
 * The phone editor's fields (Google Calendar's): the title, the kind (new ones), then one fixed list of rows in the
 * same order every time: calendar, all day, start, end, time zone, repeat, guests, video call, location, reminder,
 * notes. A filled row shows its value instead of its placeholder; nothing moves as rows fill.
 */
export function EventRows({
  draft,
  set,
  calendars,
  team,
  contacts,
  me,
  kinds,
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
  kinds?: boolean; // new ones: Event, Task or Out of office
  titleRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  onSubmit: () => void;
}) {
  const task = draft.kind === 'task';
  const ooo = draft.kind === 'ooo';
  const wall = draftWall(draft);
  const { ok } = draftTimes(draft);
  const moveDate = (date: string) => {
    const r = draft.repeat;
    const was = dateFacts(wall).wd;
    const now = dateFacts(draftWall({ ...draft, date })).wd;
    const follow = r.spec?.freq === 'WEEKLY' && r.spec.days?.length === 1 && r.spec.days[0] === was && now !== was;
    set({ date, ...(follow ? { repeat: { ...r, spec: { ...r.spec!, days: [now] } } } : {}) });
  };
  const moveStart = (v: string) => {
    const len = Math.max(15, toMin(draft.to) - toMin(draft.from));
    set({ from: v, to: hhmm(Math.min(23 * 60 + 45, toMin(v) + len)) });
  };
  const pickKind = (k: Draft['kind']) => {
    if (k === draft.kind) return;
    const was = draft.kind === 'ooo' && draft.title === t('Out of office');
    set({ kind: k, ...(k === 'ooo' ? { allDay: true, title: draft.title.trim() ? draft.title : t('Out of office') } : was ? { title: '', allDay: false } : {}) });
  };
  const zone = draft.tz ?? deviceTz();
  const zoneLabel = zoneOptions(zone).find((o) => o.value === zone)?.label ?? zone;
  return (
    <div className="ev-rows">
      <ERow className="er-title-row">
        <input
          ref={titleRef}
          autoFocus={autoFocus}
          className="er-title"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.stopPropagation(), e.preventDefault(), onSubmit())}
          placeholder={task ? t('What needs doing') : t('Add title')}
          aria-label={tx('event', 'Title')}
          enterKeyHint="done"
        />
      </ERow>
      {kinds && (
        <ERow className="er-kinds-row">
          <div className="er-kinds" role="radiogroup" aria-label={t('Event, task or out of office')}>
            {(
              [
                ['event', t('Event')],
                ['task', t('Task')],
                ['ooo', t('Out of office')],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={draft.kind === k} className={`er-chip${draft.kind === k ? ' on' : ''}`} onClick={() => pickKind(k)}>
                {l}
              </button>
            ))}
          </div>
        </ERow>
      )}

      {!task && calendars.length > 1 && (
        <div className="er-group">
          <ERow icon={<CalendarDays size={20} />} className="er-cal-row">
            <div className="er-cals" role="radiogroup" aria-label={t('Calendar')}>
              {calendars.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={draft.calendarId === c.id} className={`er-chip er-cal${draft.calendarId === c.id ? ' on' : ''}`} onClick={() => set({ calendarId: c.id })}>
                  <span className="dot" style={{ background: c.color }} />
                  {calName(c, calendars)}
                </button>
              ))}
            </div>
          </ERow>
        </div>
      )}

      <div className="er-group">
        <ERow icon={<Clock size={20} />}>
          <button type="button" className="er-line" role="switch" aria-checked={draft.allDay} disabled={ooo} onClick={() => set({ allDay: !draft.allDay })}>
            <span>{t('All day')}</span>
            <span className={`switch ${draft.allDay ? 'on' : ''}`} aria-hidden>
              <span />
            </span>
          </button>
        </ERow>
        <ERow>
          <div className="er-when">
            <DatePicker value={draft.date} onChange={(v) => v && moveDate(v)} clearable={false} label={t('Starts')} className="er-pick" />
            {!draft.allDay && <TimePicker value={draft.from} onChange={moveStart} label={t('Starts')} className="er-pick er-time" />}
          </div>
        </ERow>
        {!draft.allDay && (
          <ERow className={ok ? '' : 'bad'}>
            <div className="er-when">
              <span className="er-date-text">{shortDate(draft.date)}</span>
              <TimePicker value={draft.to} onChange={(v) => set({ to: v })} label={tx('time', 'Ends')} className="er-pick er-time" />
            </div>
            {!ok && <small className="er-error">{t('Ends before it starts')}</small>}
          </ERow>
        )}
        {!draft.allDay && (
          <ERow icon={<Globe size={20} />}>
            <Select<string>
              value={zone}
              onChange={(v) => set({ tz: v === deviceTz() ? null : v })}
              options={zoneOptions(zone)}
              label={t('Time zone')}
              title={t('The times are in')}
              searchable
              className="er-sel"
              renderValue={() => <span className="sel-text">{zoneLabel}</span>}
            />
          </ERow>
        )}
        {!task && (
          <ERow icon={<Repeat size={20} />}>
            <RepeatRow value={draft.repeat} startWall={wall} startDay={draft.date} onChange={(repeat) => set({ repeat })} />
          </ERow>
        )}
      </div>

      {!task && (
        <div className="er-group">
          <ERow icon={<Users size={20} />} top>
            <GuestPicker value={draft.guests} onChange={(guests) => set({ guests })} team={team} contacts={contacts} me={me} rows />
            {draft.guests.length > 0 && draft.sendInvites !== null && (
              <button type="button" className="er-line er-invite" role="switch" aria-checked={draft.sendInvites} onClick={() => set({ sendInvites: !draft.sendInvites })}>
                <span>{t('Email the invite to guests')}</span>
                <span className={`switch ${draft.sendInvites ? 'on' : ''}`} aria-hidden>
                  <span />
                </span>
              </button>
            )}
          </ERow>
        </div>
      )}

      {!task && !ooo && (
        <div className="er-group">
          <ERow icon={<Video size={20} />}>
            <span className="er-field">
              <input className="er-input" value={draft.meetUrl} onChange={(e) => set({ meetUrl: e.target.value })} placeholder={t('Add video call')} inputMode="url" aria-label={t('Video call link')} />
              {draft.meetUrl && (
                <button type="button" className="icon-btn er-clear" onClick={() => set({ meetUrl: '' })} aria-label={t('Remove the video call')}>
                  <X size={18} />
                </button>
              )}
            </span>
          </ERow>
          <ERow icon={<MapPin size={20} />}>
            <input className="er-input" value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder={t('Add location')} aria-label={t('Location')} />
          </ERow>
        </div>
      )}

      <div className="er-group">
        <ERow icon={<Bell size={20} />}>
          <Select<string>
            value={draft.remind === null ? 'none' : String(draft.remind)}
            onChange={(v) => set({ remind: v === 'none' ? null : Number(v) })}
            options={[{ value: 'none', label: tx('remind', 'No reminder') }, ...remindOptions()]}
            label={t('Reminder')}
            title={t('Remind me')}
            className={`er-sel${draft.remind === null ? ' er-empty' : ''}`}
          />
        </ERow>
        <ERow icon={<TextAlignStart size={20} />} top>
          <GrowText value={draft.notes} onChange={(notes) => set({ notes })} placeholder={t('Add notes')} label={t('Notes')} />
        </ERow>
      </div>
    </div>
  );
}
