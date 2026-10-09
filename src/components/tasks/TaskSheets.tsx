import { useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, CalendarX2, Check, Clock, Flag, Moon, Sofa, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { PeopleList } from '../ui/PeopleList';
import { Avatar } from '../Avatar';
import { dayChoices, daysBetween, dueText, reschedule, snoozeChoices, type DayChoice } from '../../taskDates';
import { columnOf, ownStageForColumn, stageName, stageOf, stagesForTask, toneOf } from '../../stages';
import { term } from '../../terms';
import { toast, toastUndo } from '../../toast';
import { MonthGrid } from './MonthGrid';
import { doersOf, quoted, type TaskOps } from './taskOps';
import type { TaskStatus, Todo } from '../../types';
import { t, tn } from '../../i18n';

export type SheetKind = 'schedule' | 'move' | 'stage' | 'priority' | 'assign' | 'snooze';

const DAY_ICON: Record<DayChoice['id'], LucideIcon> = { today: Sun, tomorrow: Sunrise, weekend: Sofa, nextweek: ArrowRight, none: CalendarX2 };

/** The list of quick days and a month to pick from: used by Schedule and by Plan my day's "Pick a date". */
export function DayPicker({ today, value, onPick, busy, noDate = true }: { today: string; value?: string; onPick: (day: string) => void; busy?: Set<string>; noDate?: boolean }) {
  const choices = dayChoices(today, noDate ? value : undefined);
  return (
    <div className="day-pick">
      <div className="as-list">
        {choices.map((c) => {
          const Icon = DAY_ICON[c.id];
          return (
            <button key={c.id} type="button" className={`as-item${c.day === (value ?? '') && c.id !== 'none' ? ' on' : ''}`} onClick={() => onPick(c.day)}>
              <Icon size={18} className={`as-icon day-ic-${c.id}`} />
              <span className="as-label">{c.label}</span>
              {c.hint && <span className="as-hint">{c.hint}</span>}
            </button>
          );
        })}
      </div>
      <MonthGrid value={value} today={today} onPick={onPick} busy={busy} />
    </div>
  );
}

/**
 * The sheets a task (or several) opens: Schedule, Move to (stage and project), Priority, Assign, Snooze. One place, so
 * a row's swipe, its long-press menu, the board's stage pill and the select-many bar all do the same thing.
 */
export function useTaskSheets(ops: TaskOps, opts: { onDone?: () => void; snooze?: (ids: string[], until: Date) => void; busy?: Set<string> } = {}) {
  const [s, setS] = useState<{ kind: SheetKind; ids: string[] } | null>(null);
  const close = () => setS(null);
  const list = s ? (s.ids.map((id) => ops.tasks.find((task) => task.id === id)).filter(Boolean) as Todo[]) : [];
  const one = list.length === 1 ? list[0] : null;
  const count = tn(list.length, '{n} task', '{n} tasks');
  const finish = () => (close(), opts.onDone?.());

  const schedule = (day: string) => {
    const r = reschedule(list, day);
    r.patches.forEach((p) => ops.patch(p.id, { due: p.due }));
    finish();
    if (!r.patches.length) return;
    const n = r.patches.length;
    const what = one ? quoted(one.title) : tn(n, '{n} task', '{n} tasks');
    toastUndo(day ? t('{what} moved to {day}', { what, day: dayWords(day, ops.today) }) : t('{what}: no date now', { what }), () => r.undo.forEach((u) => ops.patch(u.id, { due: u.due })));
  };
  // One task: its own stages. Several: their stages when they share them, else the page's, each going to its own
  // stage of that kind (tasks from projects with stages of their own).
  const stageList = (() => {
    if (!list.length) return ops.stages;
    const lists = list.map((task) => stagesForTask(task));
    return lists.every((l) => l === lists[0]) ? lists[0] : ops.stages;
  })();
  const toStage = (id: TaskStatus) => {
    const col = stageList.find((x) => x.id === id);
    if (!col) return;
    const before = list.map((task) => ({ id: task.id, s: stageOf(task).id, to: ownStageForColumn(task, col).id }));
    const moving = before.filter((b) => b.s !== b.to);
    moving.forEach((b) => ops.status(b.id, b.to, true));
    finish();
    if (moving.length) toastUndo(t('{what} moved to {stage}', { what: one ? quoted(one.title) : tn(moving.length, '{n} task', '{n} tasks'), stage: stageName(col) }), () => moving.forEach((b) => ops.status(b.id, b.s, true)));
  };
  const toProject = (clientId: string) => {
    const before = list.map((task) => ({ id: task.id, c: task.clientId }));
    list.forEach((task) => ops.patch(task.id, { clientId: clientId || undefined }));
    finish();
    const c = ops.clients.find((x) => x.id === clientId);
    const what = one ? quoted(one.title) : count;
    toastUndo(c ? t('{what} moved to {name}', { what, name: c.name }) : t('{what}: no {project} now', { what, project: term.one }), () => before.forEach((b) => ops.patch(b.id, { clientId: b.c })));
  };
  const toPriority = (priority: 'high' | 'normal') => {
    const before = list.map((task) => ({ id: task.id, p: task.priority }));
    list.forEach((task) => ops.patch(task.id, { priority }));
    finish();
    if (list.length > 1) toastUndo(priority === 'high' ? t('{what}: high priority', { what: count }) : t('{what}: normal priority', { what: count }), () => before.forEach((b) => ops.patch(b.id, { priority: b.p })));
  };

  let node: ReactNode = null;
  if (s && list.length) {
    const sub = one ? <p className="ts-sub">{one.title}</p> : null;
    if (s.kind === 'schedule')
      node = (
        <Sheet onClose={close} title={one ? t('Schedule') : t('Schedule {what}', { what: count })} className="task-sheet">
          {sub}
          <DayPicker today={ops.today} value={one?.due} onPick={schedule} busy={opts.busy} noDate={list.some((task) => task.due)} />
        </Sheet>
      );
    else if (s.kind === 'move' || s.kind === 'stage') {
      const cur = new Set(list.map((task) => columnOf(task, stageList).id));
      const curP = new Set(list.map((task) => task.clientId ?? ''));
      node = (
        <Sheet onClose={close} title={one ? t('Move to') : t('Move {what}', { what: count })} className="task-sheet" size={s.kind === 'move' && ops.clients.length > 6 ? 'tall' : 'auto'}>
          {sub}
          <div className="as-group">{t('Stage')}</div>
          <div className="as-list">
            {stageList.map((st) => (
              <button key={st.id} type="button" className={`as-item${cur.size === 1 && cur.has(st.id) ? ' on' : ''}`} onClick={() => toStage(st.id)}>
                <span className="as-icon ts-dot">
                  <span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />
                </span>
                <span className="as-label">{stageName(st)}</span>
                {cur.size === 1 && cur.has(st.id) && <Check size={16} className="as-check" />}
              </button>
            ))}
          </div>
          {s.kind === 'move' && (
            <>
              <div className="as-group">{term.One}</div>
              <div className="as-list">
                {[{ id: '', name: t('No {project}', { project: term.one }), color: 'var(--text-3)' }, ...ops.clients.filter((c) => c.status !== 'ended' || curP.has(c.id))].map((c) => (
                  <button key={c.id || 'none'} type="button" className={`as-item${curP.size === 1 && curP.has(c.id) ? ' on' : ''}`} onClick={() => toProject(c.id)}>
                    <span className="as-icon ts-dot">
                      <span className="dot" style={{ background: c.color }} />
                    </span>
                    <span className="as-label">
                      <span className="more-ellipsis">{c.name}</span>
                    </span>
                    {curP.size === 1 && curP.has(c.id) && <Check size={16} className="as-check" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </Sheet>
      );
    } else if (s.kind === 'priority') {
      const all = new Set(list.map((task) => task.priority));
      node = (
        <Sheet onClose={close} title={one ? t('Priority') : t('Priority for {what}', { what: count })} className="task-sheet">
          {sub}
          <div className="as-list">
            {(
              [
                ['high', t('High'), t('Red ring, first in its day')],
                ['normal', t('Normal'), ''],
              ] as const
            ).map(([v, l, h]) => (
              <button key={v} type="button" className={`as-item${all.size === 1 && all.has(v) ? ' on' : ''}`} onClick={() => toPriority(v)}>
                <Flag size={18} className={`as-icon prio-ic-${v}`} />
                <span className="as-label">
                  {l}
                  {h && <small>{h}</small>}
                </span>
                {all.size === 1 && all.has(v) && <Check size={16} className="as-check" />}
              </button>
            ))}
          </div>
        </Sheet>
      );
    } else if (s.kind === 'assign') {
      node = one ? (
        <Sheet onClose={close} title={t('Who’s doing it')} size="tall" className="task-sheet" head={<button type="button" className="primary-btn sm" onClick={close}>{t('Done')}</button>}>
          {sub}
          <PeopleList
            users={ops.users}
            me={ops.me}
            selected={doersOf(one)}
            onPick={(id) => {
              const cur = doersOf(ops.tasks.find((task) => task.id === one.id) ?? one);
              const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
              ops.patch(one.id, { assignees: next, userId: next[0] ?? '' });
            }}
          />
        </Sheet>
      ) : (
        <Sheet onClose={close} title={t('Assign {what}', { what: count })} size="tall" className="task-sheet">
          <PeopleList
            users={ops.users}
            me={ops.me}
            selected={[]}
            extra={[{ value: '', label: t('Not assigned'), hint: t('Back to the team’s queue'), icon: <span className="avatar-empty sm">?</span> }]}
            onPick={(id) => {
              const before = list.map((task) => ({ id: task.id, a: doersOf(task) }));
              list.forEach((task) => ops.patch(task.id, { assignees: id ? [id] : [], userId: id }));
              finish();
              const u = ops.users.find((x) => x.id === id);
              toastUndo(u ? t('{what} assigned to {name}', { what: count, name: u.id === ops.me ? t('you') : u.name.split(' ')[0] }) : t('{what} back in the queue', { what: count }), () => before.forEach((b) => ops.patch(b.id, { assignees: b.a, userId: b.a[0] ?? '' })));
            }}
          />
        </Sheet>
      );
    } else if (s.kind === 'snooze') {
      node = (
        <Sheet onClose={close} title={one ? t('Snooze until') : t('Snooze {what} until', { what: count })} className="task-sheet">
          {sub}
          <p className="ts-note">{t('Hidden from this queue for you until then. The team still sees it.')}</p>
          <div className="as-list">
            {snoozeChoices(new Date()).map((c) => (
              <button
                key={c.id}
                type="button"
                className="as-item"
                onClick={() => {
                  opts.snooze?.(list.map((task) => task.id), c.at);
                  finish();
                }}
              >
                {c.id === 'evening' ? <Moon size={18} className="as-icon" /> : c.id === 'hour' ? <Clock size={18} className="as-icon" /> : c.id === 'tomorrow' ? <Sunrise size={18} className="as-icon" /> : <CalendarDays size={18} className="as-icon" />}
                <span className="as-label">{c.label}</span>
                <span className="as-hint">{c.hint}</span>
              </button>
            ))}
          </div>
        </Sheet>
      );
    }
  }
  return { open: (kind: SheetKind, ids: string[]) => setS({ kind, ids }), close, node, isOpen: !!s };
}

/** A person's face for a row or card (or the empty circle when nobody's on it). */
export function Doer({ task, ops, size = 22 }: { task: Todo; ops: Pick<TaskOps, 'users'>; size?: number }) {
  const ids = doersOf(task);
  const u = ops.users.find((x) => x.id === ids[0]);
  if (!u)
    return (
      <span className="avatar-empty sm" title={t('Nobody on it yet')} aria-label={t('Nobody on it yet')}>
        ?
      </span>
    );
  return (
    <span className="doer" title={ids.map((id) => ops.users.find((x) => x.id === id)?.name).filter(Boolean).join(', ')}>
      <Avatar person={u} size={size} />
      {ids.length > 1 && <i className="doer-more">+{ids.length - 1}</i>}
    </span>
  );
}

/** Sends a toast that also offers Open (used after adding a task). */
export const toastAdded = (text: string, undo: () => void, open: () => void) => toast({ text, action: { label: t('Undo'), run: undo }, also: { label: t('Open'), run: open }, ms: 6000 });

/** "today", "tomorrow", "Monday", "13 Oct", "no date": a day mid-sentence, in the reader's language. */
export function dayWords(day: string, today: string) {
  if (!day) return t('no date');
  const n = daysBetween(today, day);
  return n === 0 ? t('today') : n === 1 ? t('tomorrow') : n === -1 ? t('yesterday') : dueText(day, today);
}
