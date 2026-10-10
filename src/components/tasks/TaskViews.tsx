import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { CalendarDays, CalendarPlus, Check, CheckSquare, Clock, Columns3, Copy, Flag, Hand, LayoutList, Link2, MoreHorizontal, Plus, SlidersHorizontal, Sparkles, Trash2, UserRound, CalendarRange, ChevronRight, Wand2 } from 'lucide-react';
import { useLeaving } from '../ui/Smooth';
import { EmptyState } from '../ui/EmptyState';
import { TabBar } from '../ui/TabBar';
import type { SwipeAction } from '../ui/SwipeRow';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { TopBar } from '../../mobile/TopBar';
import { Avatar } from '../Avatar';
import { useAppSettings, useCreateAction } from '../../mobile/chrome';
import { usePhone } from '../../mobile/media';
import { useLang } from '../../i18n/useLang';
import { usePersisted } from '../../settings';
import { DATE_GROUPS, dateGroup, dueText, isoDay } from '../../taskDates';
import { columnOf, firstOf, stageIdFor, stageName, stageOf, stagesForTask, toneOf } from '../../stages';
import { term } from '../../terms';
import { toast, toastUndo } from '../../toast';
import type { Todo } from '../../types';
import { applyFilters, filterWords, saveDisplay, sortTasks, useDisplay, type Display, type GroupBy, type Layout } from './display';
import { DisplaySheet } from './DisplaySheet';
import { TaskRow, type RowLook } from './TaskRow';
import { TaskBoard } from './TaskBoard';
import { TaskCalendar } from './TaskCalendar';
import { QuickAdd, type QuickDefaults } from './QuickAdd';
import { PlanMyDay } from './PlanMyDay';
import { BulkBar } from './BulkBar';
import { dayWords, useTaskSheets } from './TaskSheets';
import { copyTaskLink, doersOf, duplicateOf, quoted, type TaskOps } from './taskOps';
import { t, tn } from '../../i18n';
import { fmtTime } from '../../i18n/format';

export type SwipeChoice = 'complete' | 'schedule' | 'delete' | 'none';
/** Phones: what the view puts in the top bar (Todoist's nav bar): Back to Browse, its name, a project's people, "…". */
export interface PhoneBar {
  app: 'tasks' | 'projects';
  lead?: ReactNode; // "‹ Tasks"
  title?: ReactNode; // the view's name, faded in once the large title scrolls away
  people?: ReactNode; // a project's people (with the layout button, Todoist's pill)
  more?: SheetAction[]; // the place's own items at the end of "…" (a project's overview and parts, a team's workload)
  stages?: () => void; // change the board's stages (a project's, for the people who manage it)
}
export interface SavedTaskView {
  id: string;
  name: string;
  scope: { kind: string; id?: string };
  display?: Display;
  // views saved before Display: kept readable
  layout?: 'list' | 'board';
  filter?: 'open' | 'done' | 'all';
  groupBy?: GroupBy;
  quick?: string[];
}

const LIST_FIELDS = ['due', 'project', 'team', 'brief', 'priority', 'checklist', 'comments', 'assignee'];
const BOARD_FIELDS = ['assignee', 'due', 'project', 'priority', 'checklist', 'comments'];

/**
 * A task view: the toolbar (Plan my day, the layout switch, Display, New task), then the tasks as a list, a board or a
 * calendar, with everything a task can do from where it is: tick it, swipe it, hold it for its menu, select many. The
 * scope (My tasks, Today, a team, a project…) decides which tasks; this decides how they show.
 */
export function TaskViews({
  ops,
  kind,
  scopeId,
  tasks,
  label,
  canAdd,
  addDefaults,
  addKey,
  onBrainDump,
  views,
  onViews,
  onScope,
  triage,
  top,
  bar,
}: {
  ops: TaskOps;
  kind: string; // the scope's kind: mine, today, upcoming, team, project, client…
  scopeId?: string;
  tasks: Todo[]; // every task in the scope (open and done, no briefs)
  label: string; // "My tasks", "Design", "Kopi Harian"
  canAdd: boolean;
  addDefaults: QuickDefaults;
  addKey?: number;
  onBrainDump?: () => void;
  views: SavedTaskView[];
  onViews: (v: SavedTaskView[]) => void;
  onScope: (s: { kind: string; id?: string }) => void;
  triage?: boolean; // a team's queue: swipe to take it or snooze it
  top?: ReactNode; // above the list (a team's workload)
  bar?: PhoneBar; // phones: the top bar's parts (the toolbar row is desktop only)
}) {
  const phone = usePhone();
  const lang = useLang();
  // A project's tasks look the same wherever they open on a phone (Tasks or the project's page): by stage.
  const dkind = kind === 'client' && phone ? 'project' : kind;
  const [d, setD, resetD] = useDisplay(dkind);
  const layouts: Layout[] = kind === 'upcoming' ? ['calendar'] : kind === 'today' ? ['list', 'board'] : ['list', 'board', 'calendar'];
  const layout: Layout = layouts.includes(d.layout) ? d.layout : layouts[0];
  const [fieldsPref, setFieldsPref] = usePersisted<{ list: string[]; board: string[] }>('s2g-task-fields', { list: LIST_FIELDS, board: BOARD_FIELDS });
  const fields = (layout === 'board' ? fieldsPref.board : fieldsPref.list) ?? (layout === 'board' ? BOARD_FIELDS : LIST_FIELDS);
  const show = (f: string) => fields.includes(f);
  const [swipes, setSwipes] = usePersisted<{ right: SwipeChoice; left: SwipeChoice }>('s2g-task-swipes', { right: 'complete', left: 'schedule' });
  const [snoozed, setSnoozed] = usePersisted<Record<string, string>>(`s2g-queue-snooze:${ops.me}`, {});
  const kindOf = (task: Todo) => stageOf(task).kind; // each task's own stages
  const today = ops.today;

  /* ---------- which tasks, in which order ---------- */
  const nowIso = new Date().toISOString();
  const isQueue = (task: Todo) => !!triage && !task.done && !doersOf(task).length;
  const sleeping = (task: Todo) => isQueue(task) && !!snoozed[task.id] && snoozed[task.id] > nowIso;
  const filtered = useMemo(() => applyFilters(tasks, d, ops.me, today, kindOf), [tasks, d, ops.me, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => sortTasks(filtered.filter((task) => !task.done && !sleeping(task)), d.sort), [filtered, d.sort, snoozed]); // eslint-disable-line react-hooks/exhaustive-deps
  const asleep = filtered.filter(sleeping);
  const doneList = useMemo(() => filtered.filter((task) => task.done).sort((a, b) => (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt)), [filtered]);
  const [doneMore, setDoneMore] = useState(false);

  /* ---------- selecting many ---------- */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => {
    setSelecting(true);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const stopSelecting = () => (setSelecting(false), setSelected([]));
  useEffect(() => {
    if (!selecting) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.pop:not(.is-leaving), .sheet-scrim:not(.is-leaving)') && stopSelecting();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [selecting]);
  useEffect(stopSelecting, [kind, scopeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = useMemo(() => new Set(ops.tasks.filter((task) => !task.done && task.due && doersOf(task).includes(ops.me)).map((task) => task.due!)), [ops.tasks, ops.me]);
  const sheets = useTaskSheets(ops, {
    onDone: stopSelecting,
    busy,
    snooze: (ids, until) => {
      const before = { ...snoozed };
      setSnoozed({ ...Object.fromEntries(Object.entries(snoozed).filter(([, v]) => v > nowIso)), ...Object.fromEntries(ids.map((id) => [id, until.toISOString()])) });
      const task = ops.tasks.find((x) => x.id === ids[0]);
      const sameDay = isoDay(until) === today;
      const when = sameDay ? fmtTime(until) : t('{day}, {time}', { day: dayWords(isoDay(until), today), time: fmtTime(until) });
      toastUndo(ids.length === 1 && task ? t('{title} snoozed until {when}', { title: quoted(task.title), when }) : tn(ids.length, '{n} task snoozed until {when}', '{n} tasks snoozed until {when}', { when }), () => setSnoozed(before));
    },
  });

  /* ---------- adding ---------- */
  const [quick, setQuick] = useState<QuickDefaults | null>(null); // the sheet (phones; board and calendar on desktop)
  const [inline, setInline] = useState(false); // desktop: the field above the list
  const quickField = useRef<HTMLTextAreaElement>(null);
  const inlineField = useRef<HTMLTextAreaElement>(null);
  const openAdd = (extra: QuickDefaults = {}, from: 'tap' | 'later' = 'tap') => {
    if (!canAdd) return;
    const defaults = { ...addDefaults, ...extra };
    const focus = (el: HTMLTextAreaElement | null) => el?.focus();
    if (!phone && layout === 'list' && !extra.due && !extra.status) {
      if (from === 'later') return void (setInline(true), requestAnimationFrame(() => focus(inlineField.current)));
      flushSync(() => setInline(true));
      return focus(inlineField.current);
    }
    // iPhone only brings the keyboard up for focus given during the tap itself.
    if (from === 'later') return void (setQuick(defaults), requestAnimationFrame(() => focus(quickField.current)));
    flushSync(() => setQuick(defaults));
    focus(quickField.current);
  };
  useCreateAction(bar?.app ?? 'tasks', canAdd && { label: t('New task'), icon: Plus, run: () => openAdd(), more: onBrainDump ? [{ label: t('Brain dump'), icon: Sparkles, run: onBrainDump }] : undefined, hidden: selecting });
  const handledAdd = useRef(addKey ?? 0);
  useEffect(() => {
    if (addKey && addKey !== handledAdd.current) {
      handledAdd.current = addKey;
      openAdd({}, 'later');
    }
  }, [addKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // N: new task (desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'n' && e.key !== 'N') || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((document.activeElement as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('.modal-scrim:not(.is-leaving), .palette-scrim:not(.is-leaving), .pop:not(.is-leaving), .sheet-scrim:not(.is-leaving)')) return;
      e.preventDefault();
      openAdd();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  /* ---------- swipes and menus ---------- */
  useAppSettings('tasks', {
    id: 'swipes',
    label: t('Swipe actions'),
    hint: t('What a swipe right and a swipe left do on a task'),
    render: () => <SwipeSettings value={swipes} onChange={setSwipes} />,
  });
  const done = (task: Todo) => stageIdFor(task, 'done');
  const [ticking, setTicking] = useState<string[]>([]);
  const tick = (task: Todo) => {
    if (task.done || matchMedia('(prefers-reduced-motion: reduce)').matches) return ops.status(task.id, stageIdFor(task, task.done ? 'open' : 'done'));
    setTicking((x) => [...x, task.id]);
    setTimeout(() => {
      ops.status(task.id, done(task));
      setTicking((x) => x.filter((id) => id !== task.id));
    }, 320);
  };
  const swipeOf = (which: SwipeChoice, task: Todo): SwipeAction | null => {
    if (which === 'complete') {
      const review = kindOf(task) === 'review' && task.supervisorId === ops.me;
      if (task.done) return { id: 'reopen', label: t('Reopen'), icon: Check, tone: 'neutral', run: () => ops.status(task.id, stageIdFor(task, 'open')) };
      return { id: 'done', label: review ? t('Approve') : t('Done'), icon: Check, tone: 'ok', removes: !d.completed, run: () => ops.status(task.id, done(task)) };
    }
    if (which === 'schedule') return { id: 'schedule', label: t('Schedule'), icon: CalendarDays, tone: 'warn', run: () => sheets.open('schedule', [task.id]) };
    if (which === 'delete') return { id: 'delete', label: t('Delete'), icon: Trash2, tone: 'danger', removes: true, run: () => ops.remove([task.id]) };
    return null;
  };
  const swipesFor = (task: Todo) => {
    if (isQueue(task))
      return {
        start: [{ id: 'take', label: t('Take it'), icon: Hand, tone: 'accent' as const, removes: true, done: t('Yours now'), run: () => (ops.patch(task.id, { assignees: [ops.me], userId: ops.me }), () => ops.patch(task.id, { assignees: [], userId: '' })) }],
        end: [{ id: 'snooze', label: t('Snooze'), icon: Clock, tone: 'warn' as const, run: () => sheets.open('snooze', [task.id]) }],
      };
    const a = swipeOf(swipes.right, task);
    const b = swipeOf(swipes.left, task);
    return { start: a ? [a] : [], end: b ? [b] : [] };
  };
  const menuFor = (task: Todo, board = false): SheetAction[] => {
    const st = stageOf(task);
    const who = doersOf(task).map((id) => (id === ops.me ? t('You') : ops.users.find((u) => u.id === id)?.name.split(' ')[0])).filter(Boolean);
    return [
      ...(!board && layout === 'list' ? [{ label: t('Select'), icon: CheckSquare, run: () => toggle(task.id) }] : []),
      { label: t('Schedule'), icon: CalendarDays, hint: task.due ? dueText(task.due, today) : t('No date'), run: () => sheets.open('schedule', [task.id]) },
      { label: t('Move to'), icon: Columns3, hint: stageName(st), run: () => sheets.open('move', [task.id]) },
      { label: t('Priority'), icon: Flag, hint: task.priority === 'high' ? t('High') : t('Normal'), run: () => sheets.open('priority', [task.id]) },
      { label: t('Assign'), icon: UserRound, hint: who.join(', ') || t('Nobody yet'), run: () => sheets.open('assign', [task.id]) },
      ...(isQueue(task) ? [{ label: t('Snooze'), icon: Clock, run: () => sheets.open('snooze', [task.id]) }] : []),
      { label: t('Duplicate'), icon: Copy, group: 'more', run: () => {
        const id = ops.add(duplicateOf(task));
        toast({ text: t('Duplicated {title}', { title: quoted(task.title) }), action: { label: t('Open'), run: () => ops.open(id) } });
      } },
      { label: t('Copy link'), icon: Link2, group: 'more', run: () => void copyTaskLink(ops.wsId, task.id) },
      { label: t('Add to calendar'), icon: CalendarPlus, group: 'more', run: () => ops.toCalendar(task) },
      { label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => ops.remove([task.id]) },
    ];
  };

  /* ---------- rows ---------- */
  const cross = !['project', 'client'].includes(kind);
  const look: RowLook = { show, project: cross, team: kind !== 'team' && d.group !== 'team' && !phone, stage: d.group !== 'stage', avatar: !!triage || kind === 'team' || kind === 'myteams' || kind === 'all' || kind === 'project' || kind === 'client' };
  const act = (task: Todo) => {
    if (task.done) return null;
    const st = stageOf(task);
    if (st.kind === 'review' && task.supervisorId === ops.me)
      return (
        <button type="button" className="row-act primary" onClick={() => ops.status(task.id, done(task))}>
          {t('Approve')}
        </button>
      );
    if (isQueue(task))
      return (
        <button type="button" className="row-act" onClick={() => (ops.patch(task.id, { assignees: [ops.me], userId: ops.me }), toastUndo(t('{title} is yours now', { title: quoted(task.title) }), () => ops.patch(task.id, { assignees: [], userId: '' })))}>
          {t('Take it')}
        </button>
      );
    const active = firstOf('active', stagesForTask(task));
    if (task.source === 'request' && st.kind === 'open' && active)
      return (
        <button type="button" className="row-act" onClick={() => ops.status(task.id, active.id)}>
          {t('Start')}
        </button>
      );
    return null;
  };
  const row = (task: Todo, leaving = false, note?: string, group?: string) => {
    const sw = swipesFor(task);
    return (
      <TaskRow
        key={task.id}
        task={task}
        ops={ops}
        look={group === 'today' || group === 'tomorrow' || group === 'day' ? { ...look, dueWords: false } : look}
        selecting={selecting}
        selected={selected.includes(task.id)}
        onSelect={toggle}
        ticking={ticking.includes(task.id)}
        onTick={tick}
        leaving={leaving}
        start={sw.start}
        end={sw.end}
        menu={() => menuFor(task)}
        act={act(task)}
        note={note}
      />
    );
  };

  /* ---------- groups ---------- */
  const groups = useMemo(() => {
    const g: GroupBy = d.group;
    if (g === 'none' || layout !== 'list') return [{ key: 'all', label: null as ReactNode, items: open, reschedule: false }];
    if (g === 'date') {
      const by = new Map<string, Todo[]>();
      for (const task of open) {
        const k = dateGroup(task.due, today);
        by.set(k, [...(by.get(k) ?? []), task]);
      }
      return DATE_GROUPS.filter((x) => by.has(x.id)).map((x) => ({ key: x.id, label: x.label as ReactNode, items: by.get(x.id)!, reschedule: x.id === 'overdue' }));
    }
    if (g === 'client' && kind === 'today') {
      const late = open.filter((task) => !!task.due && task.due < today);
      const rest = open.filter((task) => !late.includes(task));
      const ids = [...new Set(rest.map((task) => task.clientId ?? ''))];
      const out: { key: string; label: ReactNode; items: Todo[]; reschedule: boolean }[] = late.length ? [{ key: 'overdue', label: DATE_GROUPS[0].label, items: late, reschedule: true }] : [];
      if (ids.length < 2) return rest.length ? [...out, { key: 'today', label: DATE_GROUPS[1].label as ReactNode, items: rest, reschedule: false }] : out;
      const named = ids
        .map((id) => ({ id, c: ops.clients.find((x) => x.id === id) }))
        .sort((a, b) => (a.c ? a.c.name : '~').localeCompare(b.c ? b.c.name : '~'))
        .map(({ id, c }) => ({ key: `c:${id}`, label: c ? <><span className="dot" style={{ background: c.color }} />{c.name}</> : t('No {project}', { project: term.one }), items: rest.filter((task) => (task.clientId ?? '') === id), reschedule: false }));
      return [...out, ...named];
    }
    const keyOf = (task: Todo) => (g === 'client' ? (task.clientId ?? '') : g === 'team' ? (task.teamId ?? '') : g === 'stage' ? columnOf(task, ops.stages).id : (doersOf(task)[0] ?? ''));
    const by = new Map<string, Todo[]>();
    for (const task of open) by.set(keyOf(task), [...(by.get(keyOf(task)) ?? []), task]);
    const out = [...by.entries()].map(([k, items]) => {
      if (g === 'client') {
        const c = ops.clients.find((x) => x.id === k);
        return { key: k, sort: c ? c.name : '~', label: c ? <><span className="dot" style={{ background: c.color }} />{c.name}</> : t('No {project}', { project: term.one }), items, reschedule: false };
      }
      if (g === 'team') {
        const tm = ops.teams.find((x) => x.id === k);
        return { key: k, sort: tm ? tm.name : '~', label: tm ? <><span className="dot" style={{ background: tm.color }} />{tm.name}</> : t('No team'), items, reschedule: false };
      }
      if (g === 'stage') {
        const i = ops.stages.findIndex((x) => x.id === k);
        const st = ops.stages[i];
        return { key: k, sort: String(i).padStart(3, '0'), label: st ? <><span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />{stageName(st)}</> : t('Other'), items, reschedule: false };
      }
      const u = ops.users.find((x) => x.id === k);
      return { key: k || 'nobody', sort: u ? (u.id === ops.me ? '!' : u.name) : ' ', label: u ? <><Avatar person={u} size={18} />{u.id === ops.me ? t('You') : u.name}</> : <><span className="avatar-empty sm">?</span>{t('Not assigned yet')}</>, items, reschedule: false };
    });
    return out.sort((a, b) => a.sort.localeCompare(b.sort));
  }, [open, d.group, layout, today, ops.clients, ops.teams, ops.users, ops.stages, ops.me, lang, kind]); // the language: the groups' names

  /* ---------- Plan my day ---------- */
  const [planning, setPlanning] = useState(false);
  const planList = useMemo(
    () => sortTasks(ops.tasks.filter((task) => task.kind !== 'brief' && !task.done && doersOf(task).includes(ops.me) && !!task.due && task.due <= today), 'smart'),
    [ops.tasks, ops.me, today],
  );
  const canPlan = (kind === 'mine' || kind === 'today') && planList.length > 0;

  /* ---------- views ---------- */
  const scopeNow = { kind, ...(scopeId ? { id: scopeId } : {}) };
  const sameScope = (v: SavedTaskView) => v.scope.kind === kind && (v.scope.id ?? '') === (scopeId ?? '');
  const activeView = views.find((v) => sameScope(v) && v.display && JSON.stringify(v.display) === JSON.stringify(d));
  const applyView = (v: SavedTaskView) => {
    const nd: Display = v.display ?? { ...d, layout: v.layout ?? 'list', completed: v.filter === 'done' || v.filter === 'all', group: v.groupBy ?? d.group, only: (v.quick ?? []).filter((q): q is 'late' | 'high' | 'waiting' => q === 'late' || q === 'high' || q === 'waiting'), who: v.quick?.includes('nobody') ? 'none' : d.who };
    saveDisplay(v.scope.kind, nd); // the view's own scope keeps its display
    onScope(v.scope);
    if (v.scope.kind === kind) setD(nd);
  };

  const displayBtn = useRef<HTMLButtonElement>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const words = filterWords(d, (id) => ops.users.find((u) => u.id === id)?.name.split(' ')[0] ?? '', t('Waiting'));
  const waiting = ops.stages.filter((s) => s.kind === 'waiting');
  const groupsFor: GroupBy[] = kind === 'today' ? ['client', 'date', 'stage', 'none'] : dkind === 'client' ? ['team', 'person', 'stage', 'none'] : dkind === 'project' ? ['stage', 'person', 'date', 'team', 'none'] : kind === 'team' ? ['person', 'date', 'stage', 'client', 'none'] : ['date', 'client', 'team', 'person', 'stage', 'none'];
  const overdueMine = open.filter((task) => task.due && task.due < today);

  /* ---------- phones: the top bar ---------- */
  const dotsRef = useRef<HTMLButtonElement>(null);
  const LayoutIcon = layout === 'list' ? LayoutList : layout === 'board' ? Columns3 : CalendarRange;
  const dots = useActionMenu(
    () => [
      { label: t('Display'), icon: SlidersHorizontal, hint: words.length ? words.join(', ') : undefined, run: () => setDisplayOpen(true) },
      ...(layout !== 'board' && open.length ? [{ label: t('Select tasks'), icon: CheckSquare, run: () => setSelecting(true) }] : []),
      ...(canPlan ? [{ label: t('Plan my day'), icon: Wand2, run: () => setPlanning(true) }] : []),
      ...(onBrainDump && (kind === 'mine' || kind === 'today' || kind === 'upcoming') ? [{ label: t('Brain dump'), icon: Sparkles, run: onBrainDump }] : []),
      ...(bar?.more ?? []).map((a) => ({ ...a, group: a.group ? `place-${a.group}` : 'place' })),
    ],
    { menu: true, title: label },
  );
  const allOn = selected.length === open.length && open.length > 0;
  const phoneTop =
    phone && bar ? (
      selecting ? (
        <TopBar
          app={bar.app}
          lead={
            <button type="button" className="mt-text" onClick={() => setSelected(allOn ? [] : open.map((task) => task.id))}>
              {allOn ? t('Select none') : t('Select all')}
            </button>
          }
          title={
            <h1 className="mt-title plain small tv-sel-title" aria-live="polite">
              <span className="mt-title-text">{selected.length ? tn(selected.length, '{n} selected', '{n} selected') : t('Select tasks')}</span>
            </h1>
          }
          actions={
            <button type="button" className="mt-text strong" onClick={stopSelecting}>
              {t('Done')}
            </button>
          }
          search={false}
        />
      ) : (
        <TopBar
          app={bar.app}
          lead={bar.lead}
          title={bar.title}
          actions={
            <span className={`tv-actions${bar.people ? ' tv-pill' : ''}`}>
              {bar.people}
              {bar.people && layouts.length > 1 && (
                <button type="button" className={`icon-btn tv-pill-btn${words.length ? ' on' : ''}`} onClick={() => setDisplayOpen(true)} aria-label={t('Layout and display')} title={t('Display')}>
                  <LayoutIcon size={20} />
                </button>
              )}
              <button ref={dotsRef} type="button" className="icon-btn tv-dots" onClick={() => dots.openFrom(dotsRef)} aria-label={t('More')} title={t('More')}>
                <MoreHorizontal size={22} />
              </button>
            </span>
          }
        />
      )
    ) : null;

  const empty = (() => {
    if (open.length || asleep.length) return null;
    const filteredOut = tasks.some((task) => !task.done) && words.length > 0;
    const action = canAdd && (
      <button type="button" className="primary-btn sm" onClick={() => openAdd()}>
        <Plus size={14} /> {t('New task')}
      </button>
    );
    if (filteredOut)
      return <EmptyState icon={<SlidersHorizontal size={22} />} title={t('Nothing matches these filters')} text={t('Showing: {filters}.', { filters: words.join(', ') })} action={<button type="button" className="ghost-btn sm" onClick={() => setD({ ...d, who: 'any', people: [], only: [] })}>{t('Clear filters')}</button>} />;
    if (kind === 'today') return <EmptyState icon={<Check size={22} />} title={t('All done for today')} text={t('Plan ahead in Upcoming, or add something for today.')} action={<button type="button" className="link-btn" onClick={() => onScope({ kind: 'upcoming' })}>{t('See Upcoming')}</button>} />;
    if (kind === 'supervising') return <EmptyState icon="✓" title={t('Nothing to check')} text={t('When someone finishes work you supervise, it waits here for you.')} />;
    if (triage) return <EmptyState icon="✓" title={t('The queue is empty')} text={t('Every task in this team has someone on it.')} action={action} />;
    return <EmptyState icon="✓" title={t('Nothing open')} text={t('Add one, or use Brain dump to turn your thoughts into tasks.')} action={action} />;
  })();

  const listBody =
    layout === 'board' ? (
      <TaskBoard
        ops={ops}
        tasks={[...open, ...(d.completed ? doneList : doneList.filter((task) => (task.doneAt ?? '') > new Date(Date.now() - 14 * 86_400_000).toISOString()))]}
        look={{ ...look, show: (f) => fieldsPref.board?.includes(f) ?? BOARD_FIELDS.includes(f) }}
        menu={(task) => menuFor(task, true)}
        onStage={(task) => sheets.open('stage', [task.id])}
        onAdd={(status) => openAdd({ status })}
        onTick={tick}
        onEditStages={bar?.stages}
      />
    ) : layout === 'calendar' ? (
      <TaskCalendar
        tasks={open.filter((task) => task.due && task.due >= today)}
        today={today}
        row={(task) => row(task, false, undefined, 'day')}
        onAdd={(due) => openAdd({ due })}
        head={
          overdueMine.length > 0 && (
            <div className="t-group">
              <div className="t-heading late">
                <span className="t-h-label">{DATE_GROUPS[0].label}</span>
                <b>{overdueMine.length}</b>
                <button type="button" className="link-btn small t-resched" onClick={() => sheets.open('schedule', overdueMine.map((task) => task.id))}>
                  {t('Reschedule')}
                </button>
              </div>
              <Rows items={overdueMine} row={row} />
            </div>
          )
        }
        undated={
          open.some((task) => !task.due) ? (
            <Fold title={t('No date')} count={open.filter((task) => !task.due).length}>
              <Rows items={open.filter((task) => !task.due)} row={row} />
            </Fold>
          ) : undefined
        }
      />
    ) : (
      <>
        {empty}
        {groups.map((g) => (
          <div key={g.key} className="t-group">
            {g.label && (
              <div className={`t-heading${g.key === 'overdue' ? ' late' : ''}`}>
                <span className="t-h-label">{g.label}</span>
                <b>{g.items.length}</b>
                {g.reschedule && phone && canPlan && (
                  <button type="button" className="link-btn small t-resched t-plan" onClick={() => setPlanning(true)}>
                    {t('Plan')}
                  </button>
                )}
                {g.reschedule && (
                  <button type="button" className={`link-btn small t-resched${phone && canPlan ? ' t-resched-2' : ''}`} onClick={() => sheets.open('schedule', g.items.map((task) => task.id))}>
                    {t('Reschedule')}
                  </button>
                )}
              </div>
            )}
            <Rows items={g.items} row={(task, l) => row(task, l, undefined, d.group === 'date' ? g.key : undefined)} />
          </div>
        ))}
        {asleep.length > 0 && (
          <Fold title={t('Snoozed')} count={asleep.length}>
            <Rows items={asleep} row={(task, l) => row(task, l, (() => { const at = new Date(snoozed[task.id]); return isoDay(at) === today ? t('Back at {time}', { time: fmtTime(at) }) : t('Back {day}, {time}', { day: dayWords(isoDay(at), today), time: fmtTime(at) }); })())} />
          </Fold>
        )}
      </>
    );

  return (
    <div className={`tq${selecting ? ' is-selecting' : ''}`}>
      {!phone && views.length > 0 && (
        <TabBar storageKey="task-views" className="client-tabs task-view-tabs" value={activeView?.id ?? ''} onSelect={(id) => { const v = views.find((x) => x.id === id); if (v) applyView(v); }} items={views.map((v) => ({ id: v.id, name: v.name, label: v.name }))} />
      )}
      {phoneTop}
      {phone && words.length > 0 && (
        <div className="tq-chips">
          <span className="tq-filters">
            <span className="tq-f-text">{words.join(', ')}</span>
            <button type="button" className="link-btn small" onClick={() => setD({ ...d, who: 'any', people: [], only: [] })}>
              {t('Clear')}
            </button>
          </span>
        </div>
      )}
      {!phone && (
      <div className="tq-bar">
        {canPlan && (
          <button type="button" className="ghost-btn sm tq-plan" onClick={() => setPlanning(true)}>
            <Wand2 size={15} /> {t('Plan my day')}
          </button>
        )}
        {words.length > 0 && (
          <span className="tq-filters">
            <span className="tq-f-text">{words.join(', ')}</span>
            <button type="button" className="link-btn small" onClick={() => setD({ ...d, who: 'any', people: [], only: [] })}>
              {t('Clear')}
            </button>
          </span>
        )}
        <span className="spacer" />
        {layouts.length > 1 && (
          <div className="segmented icon-seg tq-layout" role="radiogroup" aria-label={t('Layout')}>
            {layouts.map((l) => {
              const Icon = l === 'list' ? LayoutList : l === 'board' ? Columns3 : CalendarRange;
              const name = l === 'list' ? t('List') : l === 'board' ? t('Board') : t('Calendar');
              return (
                <button key={l} type="button" role="radio" aria-checked={layout === l} className={layout === l ? 'on' : ''} onClick={() => setD({ ...d, layout: l })} title={name} aria-label={name}>
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
        )}
        <button ref={displayBtn} type="button" className={`icon-btn tq-display${words.length || d.completed || activeView ? ' on' : ''}`} onClick={() => setDisplayOpen((o) => !o)} aria-label={words.length ? tn(words.length, 'Display, {n} filter on', 'Display, {n} filters on') : t('Display')} title={t('Display')}>
          <SlidersHorizontal size={17} />
          {words.length > 0 && <i>{words.length}</i>}
        </button>
        {canAdd && (
          <button type="button" className="primary-btn sm tq-new" onClick={() => (inline ? setInline(false) : openAdd())} aria-expanded={inline} title={t('New task (N)')}>
            <Plus size={14} /> {t('New task')} <kbd>N</kbd>
          </button>
        )}
      </div>
      )}
      {top}
      {!phone && (
        <div className={`fold tq-inline ${inline ? 'open' : ''}`}>
          <div className="fold-in">{inline && <QuickAdd ops={ops} defaults={addDefaults} mode="inline" where={label} inputRef={inlineField} onClose={() => setInline(false)} />}</div>
        </div>
      )}
      <div className={`tq-body layout-${layout}`} key={layout}>
        {listBody}
        {d.completed && layout === 'list' && doneList.length > 0 && (
          <div className="t-group t-done">
            <div className="t-heading">
              <span>{t('Completed')}</span>
              <b>{doneList.length}</b>
            </div>
            <Rows items={doneMore ? doneList : doneList.slice(0, 20)} row={row} />
            {doneList.length > 20 && (
              <button type="button" className="link-btn small t-more" onClick={() => setDoneMore((x) => !x)}>
                {doneMore ? t('Show fewer') : tn(doneList.length - 20, 'Show {n} more', 'Show {n} more')}
              </button>
            )}
          </div>
        )}
      </div>

      <DisplaySheet
        anchor={displayBtn}
        open={displayOpen}
        onClose={() => setDisplayOpen(false)}
        d={{ ...d, layout }}
        set={setD}
        reset={resetD}
        layouts={layouts}
        groups={groupsFor}
        users={ops.users}
        me={ops.me}
        waitingWord={waiting.length ? (waiting.length === 1 ? stageName(waiting[0]) : t('Waiting on {who}', { who: term.who })) : undefined}
        fields={fields}
        onFields={(ids) => setFieldsPref({ ...fieldsPref, [layout === 'board' ? 'board' : 'list']: ids })}
        views={views.filter(sameScope)}
        activeView={activeView?.id}
        onSaveView={(name) => onViews([...views, { id: Date.now().toString(36), name, scope: scopeNow, display: { ...d, layout } }])}
        onDeleteView={(id) => onViews(views.filter((v) => v.id !== id))}
      />
      {sheets.node}
      {dots.menu}
      {quick && <QuickAdd ops={ops} defaults={quick} mode="sheet" where={label} inputRef={quickField} onClose={() => setQuick(null)} />}
      {planning && <PlanMyDay ops={ops} tasks={planList} onClose={() => setPlanning(false)} />}
      {selecting && (
        <BulkBar
          phone={phone && !!bar}
          count={selected.length}
          all={selected.length === open.length && open.length > 0}
          onAll={() => setSelected(selected.length === open.length ? [] : open.map((task) => task.id))}
          onCancel={stopSelecting}
          onDate={() => sheets.open('schedule', selected)}
          onMove={() => sheets.open('move', selected)}
          onAssign={() => sheets.open('assign', selected)}
          onPriority={() => sheets.open('priority', selected)}
          onComplete={() => {
            const list = selected.map((id) => ops.tasks.find((task) => task.id === id)).filter((task): task is Todo => !!task && !task.done);
            const before = list.map((task) => ({ id: task.id, s: stageOf(task).id }));
            list.forEach((task) => ops.status(task.id, done(task), true));
            stopSelecting();
            const text = tn(list.length, '{n} task done', '{n} tasks done');
            if (list.some((task) => task.repeat)) toast({ text });
            else toastUndo(text, () => before.forEach((b) => ops.status(b.id, b.s, true)));
          }}
          onDelete={() => (ops.remove(selected), stopSelecting())}
        />
      )}
    </div>
  );
}

/** Rows that fold away when they leave (ticked, moved, taken). */
function Rows({ items, row }: { items: Todo[]; row: (task: Todo, leaving: boolean) => ReactNode }) {
  const list = useLeaving(items, (task) => task.id);
  return <div className="t-rows">{list.map(({ item, leaving }) => row(item, leaving))}</div>;
}

function Fold({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="t-group t-fold">
      <button type="button" className="t-heading t-fold-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}</span>
        <b>{count}</b>
        <ChevronRight size={15} className={`rot-chev ${open ? 'open' : ''}`} />
      </button>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="fold-in">{open && children}</div>
      </div>
    </div>
  );
}

/** Settings, Swipe actions (opened from the title switcher on phones). */
function SwipeSettings({ value, onChange }: { value: { right: SwipeChoice; left: SwipeChoice }; onChange: (v: { right: SwipeChoice; left: SwipeChoice }) => void }) {
  const opts: [SwipeChoice, string, string][] = [
    ['complete', t('Done'), t('Approve, when it waits for your review')],
    ['schedule', t('Schedule'), t('Pick a new day')],
    ['delete', t('Delete'), t('With Undo, in case')],
    ['none', t('Nothing'), t('So nothing happens by accident')],
  ];
  return (
    <div className="swipe-settings">
      {(['right', 'left'] as const).map((side) => (
        <section key={side}>
          <h3 className="as-group">{side === 'right' ? t('Swipe right') : t('Swipe left')}</h3>
          <div className="as-list">
            {opts.map(([v, l, h]) => (
              <button key={v} type="button" className={`as-item${value[side] === v ? ' on' : ''}`} role="radio" aria-checked={value[side] === v} onClick={() => onChange({ ...value, [side]: v })}>
                <span className="as-label">
                  {l}
                  <small>{h}</small>
                </span>
                {value[side] === v && <Check size={16} className="as-check" />}
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small swipe-note">{t('A team’s queue always swipes right to take a task and left to snooze it.')}</p>
    </div>
  );
}
