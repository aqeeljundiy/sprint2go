import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { CalendarDays, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, CopyPlus, Layers, Link2, Mail, Pencil, Plus, SkipForward, Trash2, Video, X } from 'lucide-react';
import type { CalEvent, CalendarDef, Person, RsvpStatus, User } from '../types';
import { addDays, eventsOn, monthGrid, sameDay, startOfDay } from '../calendarUtils';
import { expandEvents, findEvent, type Scope } from '../repeat';
import { askScope, type ScopeAt } from './calendar/RepeatScope';
import { useCreateAction, useTitleMenu } from '../mobile/chrome';
import { usePhone } from '../mobile/media';
import { meetingLinkOf, MEETING_NAME } from '../meetingLinks';
import { toast } from '../toast';
import { ActionSheet, type SheetAction } from './ui/ActionSheet';
import { Select } from './ui/Select';
import { Sheet } from './ui/Sheet';
import { type CalView, eventLink, gridDays, isPending, shownView, stepOf, viewLabel, WEEK_MIN } from './calendar/calTools';
import { EventCard, type CardKit } from './calendar/EventCard';
import { EventDetail, type GuestAnswer } from './calendar/EventDetail';
import { MonthDrop } from './calendar/MonthDrop';
import { MonthView } from './calendar/MonthView';
import { QuickCreate } from './calendar/QuickCreate';
import { ScheduleView, type DueTask } from './calendar/ScheduleView';
import { TimeGrid } from './calendar/TimeGrid';
import { UpNext } from './calendar/UpNext';
import { t, tx } from '../i18n';
import { fmtDate, fmtWeekday, fmtWeekdayLong } from '../i18n/format';

export type { CalView } from './calendar/calTools';

interface Props {
  /** Stored events: a repeating one once, as its series (each view draws its dates for the range on screen). */
  events: CalEvent[];
  calendars: CalendarDef[]; // every calendar on screen (for colours)
  addTo: CalendarDef[]; // the ones new events can go in
  cursor: Date;
  view: CalView;
  selected: CalEvent | null;
  onCursor: (d: Date) => void;
  onView: (v: CalView) => void;
  onSelect: (id: string | null) => void;
  /** Desktop: the New event dialog at this time. */
  onCreate: (start: Date) => void;
  /** Phones: the quick-create sheet's Save. */
  onSave: (e: Omit<CalEvent, 'id'>, kind: 'event' | 'task') => void;
  onEdit: (id: string) => void;
  /** `at`: where to ask which dates, for one date of a repeating event. */
  onDelete: (id: string, at?: ScopeAt) => void;
  onDuplicate: (id: string) => void;
  onOpenThread: (threadId: string) => void;
  /** Move or resize an event (drag it, or drag its bottom edge). One date of a repeating event comes with which dates. */
  onMove?: (id: string, start: Date, end: Date, scope?: Scope) => void;
  /** A task dropped on the calendar: block time for it. */
  onSchedule?: (taskId: string, start: Date) => void;
  canEdit?: (e: CalEvent) => boolean;
  /** Time blocks for tasks: the panel offers Extend, Tomorrow and Done. */
  taskOf?: (e: CalEvent) => { title: string; done: boolean } | null;
  onExtend?: (id: string, minutes: number) => void;
  onTomorrow?: (id: string) => void;
  onTaskDone?: (e: CalEvent) => void;
  /** Send the meeting notetaker to this event's Meet or Zoom call. */
  onNotetaker?: (e: CalEvent) => void;
  /** The notetaker was already sent to this event: opens its meeting. */
  sentBot?: (e: CalEvent) => (() => void) | undefined;
  /** The real notetaker joins by itself: whether it will join this event, and changing that for this one event. */
  botWillJoin?: (e: CalEvent) => boolean;
  onBotJoin?: (e: CalEvent, join: boolean) => void;
  /** Invites: Yes, Maybe or No (`at`: where to ask which dates, for one date of a repeating invite). */
  onRsvp?: (e: CalEvent, s: RsvpStatus, at?: ScopeAt) => void;
  answersOf?: (e: CalEvent) => Record<string, GuestAnswer> | undefined;
  /** For the guest picker. */
  team: User[];
  contacts: Person[];
  me: string;
  /** Schedule: my tasks due each day, with their checkbox. */
  dueTasks?: DueTask[];
  onToggleTask?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  /** The side panel's contents (calendars on and off, teammates, holidays, connect, tasks to plan): a sheet on phones. */
  calendarsPanel?: ReactNode;
  /** A dialog from the panel is open (Add a calendar, holidays): the Calendars sheet makes way for it. */
  dialogOpen?: boolean;
  /** Shown instead of what happened to an emailed invite (the demo: nothing is emailed). */
  inviteNote?: string;
}

/** The next half hour from now if `day` is today, otherwise 9:00 on that day. */
function nextSlot(day: Date) {
  const now = new Date();
  if (sameDay(day, now)) {
    const d = new Date(now);
    d.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
    return d;
  }
  const d = startOfDay(day);
  d.setHours(9);
  return d;
}

/** "October 2026", "9 to 11 Oct", "Fri, 9 October". */
function titleOf(view: CalView, cursor: Date, days: Date[], phone: boolean) {
  if (view === 'day' && !phone) return fmtDate(cursor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if ((view === 'week' || view === '3day') && days[0].getMonth() !== days[days.length - 1].getMonth())
    return t('{first} to {last}', { first: fmtDate(days[0], { month: 'short' }), last: fmtDate(days[days.length - 1], { month: 'short', year: phone ? undefined : 'numeric' }) });
  return fmtDate(cursor, { month: 'long', year: phone && cursor.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function CalendarView(props: Props) {
  const { calendars, cursor, selected, events } = props;
  const phone = usePhone();
  const pane = useRef<HTMLElement>(null);
  // Week needs a wide pane (not only a wide window): the pane's own width decides.
  const [paneW, setPaneW] = useState(() => (phone ? 375 : 1000));
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setPaneW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const canWeek = !phone && paneW >= WEEK_MIN;
  const narrow = !phone && paneW < 720; // a tablet beside the panel: the views go in a dropdown
  const view = shownView(props.view, canWeek);
  const views: CalView[] = canWeek ? ['schedule', 'day', '3day', 'week', 'month'] : ['schedule', 'day', '3day', 'month'];
  const days = useMemo(() => gridDays(view, cursor), [view, cursor]);
  const color = (id: string) => calendars.find((c) => c.id === id)?.color ?? '#888';
  const step = (dir: 1 | -1) => props.onCursor(stepOf(view, cursor, dir));

  /* ---------- repeating events: their dates for the range on screen ---------- */
  // Schedule and Up next draw their own (Schedule's range grows as it scrolls).
  const shown = useMemo(() => {
    if (view === 'schedule') return events;
    const from = view === 'month' ? monthGrid(cursor)[0] : days[0];
    const to = view === 'month' ? addDays(monthGrid(cursor)[41], 1) : addDays(days[days.length - 1], 1);
    return expandEvents(events, from.getTime(), to.getTime());
  }, [events, view, cursor, days]);
  // A date of a repeating event dragged somewhere stays there while the question is asked.
  const [held, setHeld] = useState<{ id: string; start: Date; end: Date } | null>(null);
  const onScreen = held ? shown.map((e) => (e.id === held.id ? { ...e, start: held.start.toISOString(), end: held.end.toISOString() } : e)) : shown;
  const moveTo = async (id: string, start: Date, end: Date, at?: ScopeAt) => {
    const e = shown.find((x) => x.id === id) ?? findEvent(events, id);
    if (!e?.seriesId) return props.onMove?.(id, start, end);
    setHeld({ id, start, end });
    const scope = await askScope(e, t('Move a repeating event'), at);
    setHeld(null);
    if (scope) props.onMove?.(id, start, end, scope);
  };

  /* ---------- phones: quick create over the grid ---------- */
  const [quick, setQuick] = useState<{ start: Date; end: Date } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  /** Starts a new one at `start`; on phones the title takes focus within the tap, so the keyboard comes up. */
  const startQuick = (start: Date) => {
    const len = quick ? quick.end.getTime() - quick.start.getTime() : 60 * 60_000;
    props.onSelect(null);
    flushSync(() => setQuick({ start, end: new Date(start.getTime() + len) }));
    if (!quick) titleRef.current?.focus();
  };
  const create = (start: Date) => (phone ? startQuick(start) : props.onCreate(start));
  useCreateAction('calendar', { label: t('New event'), icon: CalendarPlus, run: () => create(nextSlot(cursor)) });

  /* ---------- the title's switcher: views, then the calendars ---------- */
  const [calsOpen, setCalsOpen] = useState(false);
  useEffect(() => {
    if (props.dialogOpen) setCalsOpen(false);
  }, [props.dialogOpen]);
  useTitleMenu('calendar', {
    label: t('Calendar'),
    value: view,
    options: [
      ...views.map((v) => ({ value: v, label: viewLabel(v), group: tx('cal', 'View') })),
      ...(props.calendarsPanel ? [{ value: 'calendars', label: t('Calendars'), hint: t('Show or hide, teammates, holidays, tasks to plan'), group: t('Calendars'), icon: <Layers size={18} /> }] : []),
    ],
    onChange: (v) => (v === 'calendars' ? setCalsOpen(true) : props.onView(v as CalView)),
  });

  /* ---------- the month title folds a mini month down ---------- */
  const [drop, setDrop] = useState(false);
  // Days with something on them, for the month the mini month shows (worked out once per month).
  const busyOf = useMemo(() => {
    const seen = new Map<string, Set<string>>();
    return (month: Date) => {
      const key = `${month.getFullYear()}-${month.getMonth()}`;
      let s = seen.get(key);
      if (!s) {
        const g = monthGrid(month);
        seen.set(key, (s = new Set(expandEvents(events, g[0].getTime(), addDays(g[41], 1).getTime()).map((e) => new Date(e.start).toDateString()))));
      }
      return s;
    };
  }, [events]);

  // Calendar shortcuts: T today, ←/→ step, A schedule, D/W/M views, C new event, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.modal-scrim:not(.is-leaving), .sheet-scrim:not(.is-leaving), .pop:not(.is-leaving)')) return;
      const map: Record<string, () => void> = {
        t: () => props.onCursor(new Date()),
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        a: () => props.onView('schedule'),
        d: () => props.onView('day'),
        w: () => props.onView('week'),
        m: () => props.onView('month'),
        c: () => create(nextSlot(cursor)),
        Escape: () => (drop ? setDrop(false) : props.onSelect(null)),
      };
      if (map[e.key]) {
        e.preventDefault();
        map[e.key]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A link to an event (Copy link): /calendar?event=… opens it.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('event');
    if (!id) return;
    const e = findEvent(events, id);
    if (e) {
      props.onCursor(new Date(e.start));
      props.onSelect(e.id);
    }
    history.replaceState(null, '', location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- the long-press (and right-click) menu ---------- */
  const [menu, setMenu] = useState<{ e: CalEvent; x: number; y: number } | null>(null);
  // A choice from the menu that asks which dates asks where the menu was.
  const menuAt = menu ? { x: menu.x, y: menu.y } : undefined;
  const editable = (e: CalEvent) => !isPending(e) && (props.canEdit?.(e) ?? true);
  const actionsFor = (e: CalEvent): SheetAction[] => {
    const link = meetingLinkOf(e);
    const ended = new Date(e.end).getTime() < Date.now();
    const copy = (text: string, done: string) =>
      navigator.clipboard?.writeText(text).then(
        () => toast({ text: done }),
        () => toast({ text: t('Couldn’t copy it here. Open the event and copy from there.') }),
      );
    if (isPending(e))
      return [
        ...(props.onRsvp
          ? (
              [
                ['accepted', t('Yes, I’m going'), Check],
                ['tentative', t('Maybe'), CalendarDays],
                ['declined', t('No'), X],
              ] as const
            ).map(([s, label, icon]) => ({ label, icon, run: () => props.onRsvp!(e, s, menuAt) }))
          : []),
        ...(e.threadId ? [{ label: t('Open the invite'), icon: Mail, group: 'more', run: () => props.onOpenThread(e.threadId!) }] : []),
      ];
    return [
      ...(link && !ended ? [{ label: t('Join {app}', { app: MEETING_NAME[link.kind] }), icon: Video, run: () => window.open(link.url, '_blank', 'noopener,noreferrer') }] : []),
      ...(editable(e)
        ? [
            { label: t('Edit'), icon: Pencil, run: () => props.onEdit(e.id) },
            { label: t('Duplicate'), icon: CopyPlus, run: () => props.onDuplicate(e.id) },
            { label: t('Move to tomorrow'), icon: SkipForward, run: () => void moveTo(e.id, addDays(new Date(e.start), 1), addDays(new Date(e.end), 1), menuAt) },
          ]
        : []),
      { label: link ? t('Copy call link') : t('Copy link'), icon: link ? Copy : Link2, group: 'copy', run: () => void copy(link ? link.url : eventLink(e.id), link ? t('Call link copied') : t('Link copied')) },
      ...(editable(e) ? [{ label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => props.onDelete(e.id, menuAt) }] : []),
    ];
  };

  const select = (id: string | null) => {
    setQuick(null);
    setDrop(false);
    props.onSelect(id);
  };
  const kit: CardKit = {
    color,
    selectedId: selected?.id,
    onSelect: (id) => select(id),
    onMenu: (e, x, y) => setMenu({ e, x, y }),
    taskOf: props.taskOf,
    onTaskDone: props.onTaskDone,
    botWillJoin: props.botWillJoin,
  };

  /* ---------- "+N" all-day events of one day ---------- */
  const [allDayOf, setAllDayOf] = useState<Date | null>(null);

  const today = new Date();
  const todayShown = view === 'month' ? cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear() : view === 'schedule' ? sameDay(cursor, today) : days.some((d) => sameDay(d, today));
  const title = titleOf(view, cursor, days, phone || narrow);
  const toToday = () => {
    setDrop(false);
    props.onCursor(new Date());
  };

  return (
    <section className={`cal-pane view-${view}${phone ? ' is-phone' : ''}`} ref={pane}>
      <header className="cal-header">
        <button type="button" className={`cal-title${drop ? ' open' : ''}`} onClick={() => setDrop((o) => !o)} aria-expanded={drop} aria-label={t('{title}. Pick a date', { title })}>
          <h1>{title}</h1>
          <ChevronDown size={18} className="cal-title-chev" />
        </button>
        {phone ? (
          <button type="button" className={`cal-today${todayShown ? '' : ' away'}`} onClick={toToday} aria-label={t('Today, {date}', { date: fmtWeekdayLong(today) })} title={t('Today (T)')}>
            <span>{today.getDate()}</span>
          </button>
        ) : (
          <>
            <div className="cal-nav">
              {narrow ? (
                <button type="button" className={`cal-today${todayShown ? '' : ' away'}`} onClick={toToday} aria-label={t('Today')} title={t('Today (T)')}>
                  <span>{today.getDate()}</span>
                </button>
              ) : (
                <button className="ghost-btn outline sm" onClick={toToday} title={t('Today (T)')}>
                  {t('Today')}
                </button>
              )}
              <button className="icon-btn" onClick={() => step(-1)} aria-label={t('Previous')}>
                <ChevronLeft size={18} />
              </button>
              <button className="icon-btn" onClick={() => step(1)} aria-label={t('Next')}>
                <ChevronRight size={18} />
              </button>
            </div>
            {narrow ? (
              <Select<CalView> value={view} onChange={props.onView} options={views.map((v) => ({ value: v, label: viewLabel(v) }))} label={tx('cal', 'View')} className="cal-view-sel" width={180} />
            ) : (
              <div className="segmented cal-views">
                {views.map((v) => (
                  <button key={v} className={view === v ? 'on' : ''} onClick={() => props.onView(v)}>
                    {viewLabel(v)}
                  </button>
                ))}
              </div>
            )}
            <button className="primary-btn cal-new" onClick={() => props.onCreate(nextSlot(cursor))} title={t('New event (C)')}>
              <Plus size={15} /> <span>{t('New event')}</span>
            </button>
          </>
        )}
      </header>
      <MonthDrop
        open={drop}
        cursor={cursor}
        busyOf={busyOf}
        months={view === 'month'}
        onPick={(d) => {
          setDrop(false);
          props.onCursor(d);
        }}
      />
      <UpNext events={events} color={color} onOpen={(id) => select(id)} botWill={props.botWillJoin} />

      {view === 'schedule' ? (
        <ScheduleView events={events} cursor={cursor} kit={kit} dueTasks={props.dueTasks} onToggleTask={props.onToggleTask} onOpenTask={props.onOpenTask} onEmptyDay={(d) => create(nextSlot(d))} />
      ) : view === 'month' ? (
        <MonthView
          cursor={cursor}
          events={onScreen}
          phone={phone}
          kit={kit}
          onCursor={props.onCursor}
          onDay={(d) => (props.onCursor(d), props.onView('day'))}
          onCreate={create}
          onStep={step}
        />
      ) : (
        <TimeGrid
          days={days}
          events={onScreen}
          phone={phone}
          hour={phone ? 60 : 52}
          color={color}
          selectedId={selected?.id ?? null}
          canEdit={editable}
          onMove={props.onMove ? (id, s, e, at) => void moveTo(id, s, e, at) : undefined}
          onSelect={(id) => select(id)}
          onSlot={(start) => create(start)}
          onDay={(d) => (props.onCursor(d), props.onView('day'))}
          onMenu={(e, x, y) => setMenu({ e, x, y })}
          onSchedule={props.onSchedule}
          taskOf={props.taskOf}
          onTaskDone={props.onTaskDone}
          botWillJoin={props.botWillJoin}
          quick={phone ? quick : null}
          onQuick={(start, end) => setQuick({ start, end })}
          onAllDay={setAllDayOf}
          onStep={phone ? step : undefined}
        />
      )}

      {selected && (
        <EventDetail
          key={selected.id}
          phone={phone}
          event={selected}
          calendar={calendars.find((c) => c.id === selected.calendarId)}
          onClose={() => props.onSelect(null)}
          onDelete={(at) => props.onDelete(selected.id, at)}
          onEdit={() => props.onEdit(selected.id)}
          readOnly={!editable(selected)}
          onNotetaker={props.onNotetaker ? () => props.onNotetaker!(selected) : undefined}
          onOpenThread={props.onOpenThread}
          task={props.taskOf?.(selected) ?? null}
          onExtend={(m) => props.onExtend?.(selected.id, m)}
          onTomorrow={() => props.onTomorrow?.(selected.id)}
          onTaskDone={() => props.onTaskDone?.(selected)}
          sentBot={props.sentBot?.(selected)}
          botWill={props.onBotJoin ? !!props.botWillJoin?.(selected) : undefined}
          onBotJoin={props.onBotJoin ? (join) => props.onBotJoin!(selected, join) : undefined}
          onRsvp={props.onRsvp ? (s, at) => props.onRsvp!(selected, s, at) : undefined}
          answers={props.answersOf?.(selected)}
          inviteNote={props.inviteNote}
        />
      )}

      {quick && phone && (
        <QuickCreate
          quick={quick}
          onTimes={(start, end) => setQuick({ start, end })}
          calendars={props.addTo}
          team={props.team}
          contacts={props.contacts}
          me={props.me}
          titleRef={titleRef}
          onSave={(e, kind) => {
            setQuick(null);
            props.onSave(e, kind);
          }}
          onClose={() => setQuick(null)}
        />
      )}

      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.e.title} actions={menu ? actionsFor(menu.e) : []} at={menu && !phone ? { x: menu.x, y: menu.y } : null} className="cal-menu-sheet" />

      {calsOpen && props.calendarsPanel && (
        <Sheet title={t('Calendars')} onClose={() => setCalsOpen(false)} size="tall" className="cal-sheet">
          {/* Picking a task to plan hands over to its Schedule sheet: one sheet at a time. */}
          <div className="cal-sheet-in" onClickCapture={(e) => (e.target as Element).closest('.plan-task') && setTimeout(() => setCalsOpen(false))}>
            {props.calendarsPanel}
          </div>
        </Sheet>
      )}

      {allDayOf && (
        <Sheet title={t('All day, {day}', { day: fmtWeekday(allDayOf) })} onClose={() => setAllDayOf(null)} className="allday-sheet">
          <div className="allday-list">
            {eventsOn(shown, allDayOf)
              .filter((e) => e.allDay)
              .map((e) => (
                <EventCard key={e.id} e={e} kit={{ ...kit, onSelect: (id) => (setAllDayOf(null), select(id)) }} now={Date.now()} />
              ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}
