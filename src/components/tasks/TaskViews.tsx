import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { CalendarDays, CalendarPlus, Check, CheckSquare, Clock, Columns3, Copy, Flag, Hand, LayoutList, Link2, Plus, SlidersHorizontal, Sparkles, Trash2, UserRound, CalendarRange, ChevronRight, Wand2 } from 'lucide-react';
import { useLeaving } from '../ui/Smooth';
import { EmptyState } from '../ui/EmptyState';
import { TabBar } from '../ui/TabBar';
import type { SwipeAction } from '../ui/SwipeRow';
import type { SheetAction } from '../ui/ActionSheet';
import { Avatar } from '../Avatar';
import { useAppSettings, useCreateAction } from '../../mobile/chrome';
import { usePhone } from '../../mobile/media';
import { usePersisted } from '../../settings';
import { DATE_GROUPS, clock, dateGroup, dueText, isoDay } from '../../taskDates';
import { firstOf, stageIdFor, stageName, stageOf, toneOf } from '../../stages';
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

export type SwipeChoice = 'complete' | 'schedule' | 'none';
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
}) {
  const phone = usePhone();
  const [d, setD, resetD] = useDisplay(kind === 'client' ? 'client' : kind);
  const layouts: Layout[] = kind === 'upcoming' ? ['calendar'] : kind === 'today' ? ['list', 'board'] : ['list', 'board', 'calendar'];
  const layout: Layout = layouts.includes(d.layout) ? d.layout : layouts[0];
  const [fieldsPref, setFieldsPref] = usePersisted<{ list: string[]; board: string[] }>('s2g-task-fields', { list: LIST_FIELDS, board: BOARD_FIELDS });
  const fields = (layout === 'board' ? fieldsPref.board : fieldsPref.list) ?? (layout === 'board' ? BOARD_FIELDS : LIST_FIELDS);
  const show = (f: string) => fields.includes(f);
  const [swipes, setSwipes] = usePersisted<{ right: SwipeChoice; left: SwipeChoice }>('s2g-task-swipes', { right: 'complete', left: 'schedule' });
  const [snoozed, setSnoozed] = usePersisted<Record<string, string>>(`s2g-queue-snooze:${ops.me}`, {});
  const kindOf = (t: Todo) => stageOf(t, ops.stages).kind;
  const today = ops.today;

  /* ---------- which tasks, in which order ---------- */
  const nowIso = new Date().toISOString();
  const isQueue = (t: Todo) => !!triage && !t.done && !doersOf(t).length;
  const sleeping = (t: Todo) => isQueue(t) && !!snoozed[t.id] && snoozed[t.id] > nowIso;
  const filtered = useMemo(() => applyFilters(tasks, d, ops.me, today, kindOf), [tasks, d, ops.me, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => sortTasks(filtered.filter((t) => !t.done && !sleeping(t)), d.sort), [filtered, d.sort, snoozed]); // eslint-disable-line react-hooks/exhaustive-deps
  const asleep = filtered.filter(sleeping);
  const doneList = useMemo(() => filtered.filter((t) => t.done).sort((a, b) => (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt)), [filtered]);
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

  const busy = useMemo(() => new Set(ops.tasks.filter((t) => !t.done && t.due && doersOf(t).includes(ops.me)).map((t) => t.due!)), [ops.tasks, ops.me]);
  const sheets = useTaskSheets(ops, {
    onDone: stopSelecting,
    busy,
    snooze: (ids, until) => {
      const before = { ...snoozed };
      setSnoozed({ ...Object.fromEntries(Object.entries(snoozed).filter(([, v]) => v > nowIso)), ...Object.fromEntries(ids.map((id) => [id, until.toISOString()])) });
      const t = ops.tasks.find((x) => x.id === ids[0]);
      const sameDay = isoDay(until) === today;
      toastUndo(`${ids.length === 1 && t ? quoted(t.title) : `${ids.length} tasks`} snoozed until ${sameDay ? clock(until) : `${dayWords(isoDay(until), today)}, ${clock(until)}`}`, () => setSnoozed(before));
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
  useCreateAction('tasks', canAdd && { label: 'New task', icon: Plus, run: () => openAdd(), more: onBrainDump ? [{ label: 'Brain dump', icon: Sparkles, run: onBrainDump }] : undefined });
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
    label: 'Swipe actions',
    hint: 'What a swipe right and a swipe left do on a task',
    render: () => <SwipeSettings value={swipes} onChange={setSwipes} />,
  });
  const done = (t: Todo) => stageIdFor(t, 'done', ops.stages);
  const [ticking, setTicking] = useState<string[]>([]);
  const tick = (t: Todo) => {
    if (t.done || matchMedia('(prefers-reduced-motion: reduce)').matches) return ops.status(t.id, stageIdFor(t, t.done ? 'open' : 'done', ops.stages));
    setTicking((x) => [...x, t.id]);
    setTimeout(() => {
      ops.status(t.id, done(t));
      setTicking((x) => x.filter((id) => id !== t.id));
    }, 320);
  };
  const swipeOf = (which: SwipeChoice, t: Todo): SwipeAction | null => {
    if (which === 'complete') {
      const review = kindOf(t) === 'review' && t.supervisorId === ops.me;
      if (t.done) return { id: 'reopen', label: 'Reopen', icon: Check, tone: 'neutral', run: () => ops.status(t.id, stageIdFor(t, 'open', ops.stages)) };
      return { id: 'done', label: review ? 'Approve' : 'Done', icon: Check, tone: 'ok', removes: !d.completed, run: () => ops.status(t.id, done(t)) };
    }
    if (which === 'schedule') return { id: 'schedule', label: 'Schedule', icon: CalendarDays, tone: 'warn', run: () => sheets.open('schedule', [t.id]) };
    return null;
  };
  const swipesFor = (t: Todo) => {
    if (isQueue(t))
      return {
        start: [{ id: 'take', label: 'Take it', icon: Hand, tone: 'accent' as const, removes: true, done: 'Yours now', run: () => (ops.patch(t.id, { assignees: [ops.me], userId: ops.me }), () => ops.patch(t.id, { assignees: [], userId: '' })) }],
        end: [{ id: 'snooze', label: 'Snooze', icon: Clock, tone: 'warn' as const, run: () => sheets.open('snooze', [t.id]) }],
      };
    const a = swipeOf(swipes.right, t);
    const b = swipeOf(swipes.left, t);
    return { start: a ? [a] : [], end: b ? [b] : [] };
  };
  const menuFor = (t: Todo, board = false): SheetAction[] => {
    const st = stageOf(t, ops.stages);
    const who = doersOf(t).map((id) => (id === ops.me ? 'You' : ops.users.find((u) => u.id === id)?.name.split(' ')[0])).filter(Boolean);
    return [
      ...(!board && layout === 'list' ? [{ label: 'Select', icon: CheckSquare, run: () => toggle(t.id) }] : []),
      { label: 'Schedule', icon: CalendarDays, hint: t.due ? dueText(t.due, today) : 'No date', run: () => sheets.open('schedule', [t.id]) },
      { label: 'Move to', icon: Columns3, hint: stageName(st), run: () => sheets.open('move', [t.id]) },
      { label: 'Priority', icon: Flag, hint: t.priority === 'high' ? 'High' : 'Normal', run: () => sheets.open('priority', [t.id]) },
      { label: 'Assign', icon: UserRound, hint: who.join(', ') || 'Nobody yet', run: () => sheets.open('assign', [t.id]) },
      ...(isQueue(t) ? [{ label: 'Snooze', icon: Clock, run: () => sheets.open('snooze', [t.id]) }] : []),
      { label: 'Add to calendar', icon: CalendarPlus, group: 'more', run: () => ops.toCalendar(t) },
      { label: 'Duplicate', icon: Copy, group: 'more', run: () => {
        const id = ops.add(duplicateOf(t));
        toast({ text: `Duplicated ${quoted(t.title)}`, action: { label: 'Open', run: () => ops.open(id) } });
      } },
      { label: 'Copy link', icon: Link2, group: 'more', run: () => void copyTaskLink(ops.wsId, t.id) },
      { label: 'Delete', icon: Trash2, danger: true, group: 'end', run: () => ops.remove([t.id]) },
    ];
  };

  /* ---------- rows ---------- */
  const cross = !['project', 'client'].includes(kind);
  const look: RowLook = { show, project: cross, team: !['team'].includes(kind) && !phone, stage: d.group !== 'stage', avatar: !!triage || kind === 'team' || kind === 'myteams' || kind === 'all' || kind === 'project' || kind === 'client' };
  const act = (t: Todo) => {
    if (t.done) return null;
    const st = stageOf(t, ops.stages);
    if (st.kind === 'review' && t.supervisorId === ops.me)
      return (
        <button type="button" className="row-act primary" onClick={() => ops.status(t.id, done(t))}>
          Approve
        </button>
      );
    if (isQueue(t))
      return (
        <button type="button" className="row-act" onClick={() => (ops.patch(t.id, { assignees: [ops.me], userId: ops.me }), toastUndo(`${quoted(t.title)} is yours now`, () => ops.patch(t.id, { assignees: [], userId: '' })))}>
          Take it
        </button>
      );
    const active = firstOf('active', ops.stages);
    if (t.source === 'request' && st.kind === 'open' && active)
      return (
        <button type="button" className="row-act" onClick={() => ops.status(t.id, active.id)}>
          Start
        </button>
      );
    return null;
  };
  const row = (t: Todo, leaving = false, note?: string, group?: string) => {
    const sw = swipesFor(t);
    return (
      <TaskRow
        key={t.id}
        t={t}
        ops={ops}
        look={group === 'today' || group === 'tomorrow' ? { ...look, dueWords: false } : look}
        selecting={selecting}
        selected={selected.includes(t.id)}
        onSelect={toggle}
        ticking={ticking.includes(t.id)}
        onTick={tick}
        leaving={leaving}
        start={sw.start}
        end={sw.end}
        menu={() => menuFor(t)}
        act={act(t)}
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
      for (const t of open) {
        const k = dateGroup(t.due, today);
        by.set(k, [...(by.get(k) ?? []), t]);
      }
      return DATE_GROUPS.filter((x) => by.has(x.id)).map((x) => ({ key: x.id, label: x.label as ReactNode, items: by.get(x.id)!, reschedule: x.id === 'overdue' }));
    }
    const keyOf = (t: Todo) => (g === 'client' ? (t.clientId ?? '') : g === 'team' ? (t.teamId ?? '') : g === 'stage' ? stageOf(t, ops.stages).id : (doersOf(t)[0] ?? ''));
    const by = new Map<string, Todo[]>();
    for (const t of open) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
    const out = [...by.entries()].map(([k, items]) => {
      if (g === 'client') {
        const c = ops.clients.find((x) => x.id === k);
        return { key: k, sort: c ? c.name : '~', label: c ? <><span className="dot" style={{ background: c.color }} />{c.name}</> : `No ${term.one}`, items, reschedule: false };
      }
      if (g === 'team') {
        const tm = ops.teams.find((x) => x.id === k);
        return { key: k, sort: tm ? tm.name : '~', label: tm ? <><span className="dot" style={{ background: tm.color }} />{tm.name}</> : 'No team', items, reschedule: false };
      }
      if (g === 'stage') {
        const i = ops.stages.findIndex((x) => x.id === k);
        const st = ops.stages[i];
        return { key: k, sort: String(i).padStart(3, '0'), label: st ? <><span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />{stageName(st)}</> : 'Other', items, reschedule: false };
      }
      const u = ops.users.find((x) => x.id === k);
      return { key: k || 'nobody', sort: u ? (u.id === ops.me ? '!' : u.name) : ' ', label: u ? <><Avatar person={u} size={18} />{u.id === ops.me ? 'You' : u.name}</> : <><span className="avatar-empty sm">?</span>Not assigned yet</>, items, reschedule: false };
    });
    return out.sort((a, b) => a.sort.localeCompare(b.sort));
  }, [open, d.group, layout, today, ops.clients, ops.teams, ops.users, ops.stages, ops.me]);

  /* ---------- Plan my day ---------- */
  const [planning, setPlanning] = useState(false);
  const planList = useMemo(
    () => sortTasks(ops.tasks.filter((t) => t.kind !== 'brief' && !t.done && doersOf(t).includes(ops.me) && !!t.due && t.due <= today), 'smart'),
    [ops.tasks, ops.me, today],
  );
  const canPlan = (kind === 'mine' || kind === 'today' || kind === 'upcoming') && planList.length > 0;

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
  const words = filterWords(d, (id) => ops.users.find((u) => u.id === id)?.name.split(' ')[0] ?? '', 'Waiting');
  const waiting = ops.stages.filter((s) => s.kind === 'waiting');
  const groupsFor: GroupBy[] = kind === 'today' ? ['date', 'client', 'stage', 'none'] : kind === 'client' ? ['team', 'person', 'stage', 'none'] : kind === 'project' ? ['stage', 'person', 'date', 'team', 'none'] : kind === 'team' ? ['person', 'date', 'stage', 'client', 'none'] : ['date', 'client', 'team', 'person', 'stage', 'none'];
  const overdueMine = open.filter((t) => t.due && t.due < today);

  const empty = (() => {
    if (open.length || asleep.length) return null;
    const filteredOut = tasks.some((t) => !t.done) && words.length > 0;
    const action = canAdd && (
      <button type="button" className="primary-btn sm" onClick={() => openAdd()}>
        <Plus size={14} /> New task
      </button>
    );
    if (filteredOut)
      return <EmptyState icon={<SlidersHorizontal size={22} />} title="Nothing matches these filters" text={`Showing: ${words.join(', ')}.`} action={<button type="button" className="ghost-btn sm" onClick={() => setD({ ...d, who: 'any', people: [], only: [] })}>Clear filters</button>} />;
    if (kind === 'today') return <EmptyState icon="✓" title="Nothing due today" text="Plan ahead in Upcoming, or add something for today." action={<button type="button" className="ghost-btn sm" onClick={() => onScope({ kind: 'upcoming' })}>Open Upcoming</button>} />;
    if (kind === 'supervising') return <EmptyState icon="✓" title="Nothing to check" text="When someone finishes work you supervise, it waits here for you." />;
    if (triage) return <EmptyState icon="✓" title="The queue is empty" text="Every task in this team has someone on it." action={action} />;
    return <EmptyState icon="✓" title="Nothing open" text="Add one, or use Brain dump to turn your thoughts into tasks." action={action} />;
  })();

  const listBody =
    layout === 'board' ? (
      <TaskBoard
        ops={ops}
        tasks={[...open, ...(d.completed ? doneList : doneList.filter((t) => (t.doneAt ?? '') > new Date(Date.now() - 14 * 86_400_000).toISOString()))]}
        look={{ ...look, show: (f) => fieldsPref.board?.includes(f) ?? BOARD_FIELDS.includes(f) }}
        menu={(t) => menuFor(t, true)}
        onStage={(t) => sheets.open('stage', [t.id])}
        onAdd={(status) => openAdd({ status })}
      />
    ) : layout === 'calendar' ? (
      <TaskCalendar
        tasks={open.filter((t) => t.due && t.due >= today)}
        today={today}
        row={(t) => row(t)}
        onAdd={(due) => openAdd({ due })}
        head={
          overdueMine.length > 0 && (
            <div className="t-group">
              <div className="t-heading late">
                <span className="t-h-label">Overdue</span>
                <b>{overdueMine.length}</b>
                <button type="button" className="link-btn small t-resched" onClick={() => sheets.open('schedule', overdueMine.map((t) => t.id))}>
                  Reschedule
                </button>
              </div>
              <Rows items={overdueMine} row={row} />
            </div>
          )
        }
        undated={
          open.some((t) => !t.due) ? (
            <Fold title="No date" count={open.filter((t) => !t.due).length}>
              <Rows items={open.filter((t) => !t.due)} row={row} />
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
                {g.reschedule && (
                  <button type="button" className="link-btn small t-resched" onClick={() => sheets.open('schedule', g.items.map((t) => t.id))}>
                    Reschedule
                  </button>
                )}
              </div>
            )}
            <Rows items={g.items} row={(t, l) => row(t, l, undefined, d.group === 'date' ? g.key : undefined)} />
          </div>
        ))}
        {asleep.length > 0 && (
          <Fold title="Snoozed" count={asleep.length}>
            <Rows items={asleep} row={(t, l) => row(t, l, `Back ${(() => { const at = new Date(snoozed[t.id]); return isoDay(at) === today ? `at ${clock(at)}` : `${dueText(isoDay(at), today).toLowerCase()} ${clock(at)}`; })()}`)} />
          </Fold>
        )}
      </>
    );

  return (
    <div className={`tq${selecting ? ' is-selecting' : ''}`}>
      {!phone && views.length > 0 && (
        <TabBar storageKey="task-views" className="client-tabs task-view-tabs" value={activeView?.id ?? ''} onSelect={(id) => { const v = views.find((x) => x.id === id); if (v) applyView(v); }} items={views.map((v) => ({ id: v.id, name: v.name, label: v.name }))} />
      )}
      <div className="tq-bar">
        {canPlan && (
          <button type="button" className="ghost-btn sm tq-plan" onClick={() => setPlanning(true)}>
            <Wand2 size={15} /> Plan my day
          </button>
        )}
        {words.length > 0 && (
          <span className="tq-filters">
            <span className="tq-f-text">{words.join(', ')}</span>
            <button type="button" className="link-btn small" onClick={() => setD({ ...d, who: 'any', people: [], only: [] })}>
              Clear
            </button>
          </span>
        )}
        <span className="spacer" />
        {layouts.length > 1 && (
          <div className="segmented icon-seg tq-layout" role="radiogroup" aria-label="Layout">
            {layouts.map((l) => {
              const Icon = l === 'list' ? LayoutList : l === 'board' ? Columns3 : CalendarRange;
              const name = l === 'list' ? 'List' : l === 'board' ? 'Board' : 'Calendar';
              return (
                <button key={l} type="button" role="radio" aria-checked={layout === l} className={layout === l ? 'on' : ''} onClick={() => setD({ ...d, layout: l })} title={name} aria-label={name}>
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
        )}
        <button ref={displayBtn} type="button" className={`icon-btn tq-display${words.length || d.completed || activeView ? ' on' : ''}`} onClick={() => setDisplayOpen((o) => !o)} aria-label={`Display${words.length ? `, ${words.length} filter${words.length === 1 ? '' : 's'} on` : ''}`} title="Display">
          <SlidersHorizontal size={17} />
          {words.length > 0 && <i>{words.length}</i>}
        </button>
        {canAdd && !phone && (
          <button type="button" className="primary-btn sm tq-new" onClick={() => (inline ? setInline(false) : openAdd())} aria-expanded={inline} title="New task (N)">
            <Plus size={14} /> New task <kbd>N</kbd>
          </button>
        )}
      </div>
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
              <span>Completed</span>
              <b>{doneList.length}</b>
            </div>
            <Rows items={doneMore ? doneList : doneList.slice(0, 20)} row={row} />
            {doneList.length > 20 && (
              <button type="button" className="link-btn small t-more" onClick={() => setDoneMore((x) => !x)}>
                {doneMore ? 'Show fewer' : `Show ${doneList.length - 20} more`}
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
        waitingWord={waiting.length ? (waiting.length === 1 ? stageName(waiting[0]) : `Waiting on ${term.who}`) : undefined}
        fields={fields}
        onFields={(ids) => setFieldsPref({ ...fieldsPref, [layout === 'board' ? 'board' : 'list']: ids })}
        views={views.filter(sameScope)}
        activeView={activeView?.id}
        onSaveView={(name) => onViews([...views, { id: Date.now().toString(36), name, scope: scopeNow, display: { ...d, layout } }])}
        onDeleteView={(id) => onViews(views.filter((v) => v.id !== id))}
      />
      {sheets.node}
      {quick && <QuickAdd ops={ops} defaults={quick} mode="sheet" where={label} inputRef={quickField} onClose={() => setQuick(null)} />}
      {planning && <PlanMyDay ops={ops} tasks={planList} onClose={() => setPlanning(false)} />}
      {selecting && (
        <BulkBar
          count={selected.length}
          all={selected.length === open.length && open.length > 0}
          onAll={() => setSelected(selected.length === open.length ? [] : open.map((t) => t.id))}
          onCancel={stopSelecting}
          onDate={() => sheets.open('schedule', selected)}
          onMove={() => sheets.open('move', selected)}
          onAssign={() => sheets.open('assign', selected)}
          onPriority={() => sheets.open('priority', selected)}
          onComplete={() => {
            const list = selected.map((id) => ops.tasks.find((t) => t.id === id)).filter((t): t is Todo => !!t && !t.done);
            const before = list.map((t) => ({ id: t.id, s: stageOf(t, ops.stages).id }));
            list.forEach((t) => ops.status(t.id, done(t), true));
            stopSelecting();
            const text = `${list.length} task${list.length === 1 ? '' : 's'} done`;
            if (list.some((t) => t.repeat)) toast({ text });
            else toastUndo(text, () => before.forEach((b) => ops.status(b.id, b.s, true)));
          }}
          onDelete={() => (ops.remove(selected), stopSelecting())}
        />
      )}
    </div>
  );
}

/** Rows that fold away when they leave (ticked, moved, taken). */
function Rows({ items, row }: { items: Todo[]; row: (t: Todo, leaving: boolean) => ReactNode }) {
  const list = useLeaving(items, (t) => t.id);
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
    ['complete', 'Done', 'Approve, when it waits for your review'],
    ['schedule', 'Schedule', 'Pick a new day'],
    ['none', 'Nothing', 'So nothing happens by accident'],
  ];
  return (
    <div className="swipe-settings">
      {(['right', 'left'] as const).map((side) => (
        <section key={side}>
          <h3 className="as-group">{side === 'right' ? 'Swipe right' : 'Swipe left'}</h3>
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
      <p className="muted small swipe-note">A team’s queue always swipes right to take a task and left to snooze it.</p>
    </div>
  );
}
