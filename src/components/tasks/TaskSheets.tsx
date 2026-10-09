import { useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, CalendarX2, Check, Clock, Flag, Moon, Sofa, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { PeopleList } from '../ui/PeopleList';
import { Avatar } from '../Avatar';
import { dayChoices, dueText, reschedule, snoozeChoices, type DayChoice } from '../../taskDates';
import { stageName, stageOf, toneOf } from '../../stages';
import { term } from '../../terms';
import { toast, toastUndo } from '../../toast';
import { MonthGrid } from './MonthGrid';
import { doersOf, quoted, type TaskOps } from './taskOps';
import type { TaskStatus, Todo } from '../../types';

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
  const list = s ? (s.ids.map((id) => ops.tasks.find((t) => t.id === id)).filter(Boolean) as Todo[]) : [];
  const one = list.length === 1 ? list[0] : null;
  const count = `${list.length} task${list.length === 1 ? '' : 's'}`;
  const finish = () => (close(), opts.onDone?.());

  const schedule = (day: string) => {
    const r = reschedule(list, day);
    r.patches.forEach((p) => ops.patch(p.id, { due: p.due }));
    finish();
    if (!r.patches.length) return;
    const n = r.patches.length;
    toastUndo(`${one ? quoted(one.title) : `${n} task${n === 1 ? '' : 's'}`} moved to ${dayWords(day, ops.today)}`, () => r.undo.forEach((u) => ops.patch(u.id, { due: u.due })));
  };
  const toStage = (id: TaskStatus) => {
    const before = list.map((t) => ({ id: t.id, s: stageOf(t, ops.stages).id }));
    const moving = before.filter((b) => b.s !== id);
    moving.forEach((b) => ops.status(b.id, id, true));
    finish();
    const st = ops.stages.find((x) => x.id === id);
    if (moving.length && st) toastUndo(`${one ? quoted(one.title) : `${moving.length} task${moving.length === 1 ? '' : 's'}`} moved to ${stageName(st)}`, () => moving.forEach((b) => ops.status(b.id, b.s, true)));
  };
  const toProject = (clientId: string) => {
    const before = list.map((t) => ({ id: t.id, c: t.clientId }));
    list.forEach((t) => ops.patch(t.id, { clientId: clientId || undefined }));
    finish();
    const c = ops.clients.find((x) => x.id === clientId);
    toastUndo(`${one ? quoted(one.title) : count} moved to ${c ? c.name : `no ${term.one}`}`, () => before.forEach((b) => ops.patch(b.id, { clientId: b.c })));
  };
  const toPriority = (priority: 'high' | 'normal') => {
    const before = list.map((t) => ({ id: t.id, p: t.priority }));
    list.forEach((t) => ops.patch(t.id, { priority }));
    finish();
    if (list.length > 1) toastUndo(`${count}: ${priority === 'high' ? 'high priority' : 'normal priority'}`, () => before.forEach((b) => ops.patch(b.id, { priority: b.p })));
  };

  let node: ReactNode = null;
  if (s && list.length) {
    const sub = one ? <p className="ts-sub">{one.title}</p> : null;
    if (s.kind === 'schedule')
      node = (
        <Sheet onClose={close} title={one ? 'Schedule' : `Schedule ${count}`} className="task-sheet">
          {sub}
          <DayPicker today={ops.today} value={one?.due} onPick={schedule} busy={opts.busy} noDate={list.some((t) => t.due)} />
        </Sheet>
      );
    else if (s.kind === 'move' || s.kind === 'stage') {
      const cur = new Set(list.map((t) => stageOf(t, ops.stages).id));
      const curP = new Set(list.map((t) => t.clientId ?? ''));
      node = (
        <Sheet onClose={close} title={one ? 'Move to' : `Move ${count}`} className="task-sheet" size={s.kind === 'move' && ops.clients.length > 6 ? 'tall' : 'auto'}>
          {sub}
          <div className="as-group">Stage</div>
          <div className="as-list">
            {ops.stages.map((st) => (
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
                {[{ id: '', name: `No ${term.one}`, color: 'var(--text-3)' }, ...ops.clients.filter((c) => c.status !== 'ended' || curP.has(c.id))].map((c) => (
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
      const all = new Set(list.map((t) => t.priority));
      node = (
        <Sheet onClose={close} title={one ? 'Priority' : `Priority for ${count}`} className="task-sheet">
          {sub}
          <div className="as-list">
            {(
              [
                ['high', 'High', 'Red ring, first in its day'],
                ['normal', 'Normal', ''],
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
        <Sheet onClose={close} title="Who’s doing it" size="tall" className="task-sheet" head={<button type="button" className="primary-btn sm" onClick={close}>Done</button>}>
          {sub}
          <PeopleList
            users={ops.users}
            me={ops.me}
            selected={doersOf(one)}
            onPick={(id) => {
              const cur = doersOf(ops.tasks.find((t) => t.id === one.id) ?? one);
              const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
              ops.patch(one.id, { assignees: next, userId: next[0] ?? '' });
            }}
          />
        </Sheet>
      ) : (
        <Sheet onClose={close} title={`Assign ${count}`} size="tall" className="task-sheet">
          <PeopleList
            users={ops.users}
            me={ops.me}
            selected={[]}
            extra={[{ value: '', label: 'Not assigned', hint: 'Back to the team’s queue', icon: <span className="avatar-empty sm">?</span> }]}
            onPick={(id) => {
              const before = list.map((t) => ({ id: t.id, a: doersOf(t) }));
              list.forEach((t) => ops.patch(t.id, { assignees: id ? [id] : [], userId: id }));
              finish();
              const u = ops.users.find((x) => x.id === id);
              toastUndo(`${count} ${u ? `assigned to ${u.id === ops.me ? 'you' : u.name.split(' ')[0]}` : 'back in the queue'}`, () => before.forEach((b) => ops.patch(b.id, { assignees: b.a, userId: b.a[0] ?? '' })));
            }}
          />
        </Sheet>
      );
    } else if (s.kind === 'snooze') {
      node = (
        <Sheet onClose={close} title={one ? 'Snooze until' : `Snooze ${count} until`} className="task-sheet">
          {sub}
          <p className="ts-note">Hidden from this queue for you until then. The team still sees it.</p>
          <div className="as-list">
            {snoozeChoices(new Date()).map((c) => (
              <button
                key={c.id}
                type="button"
                className="as-item"
                onClick={() => {
                  opts.snooze?.(list.map((t) => t.id), c.at);
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
export function Doer({ t, ops, size = 22 }: { t: Todo; ops: Pick<TaskOps, 'users'>; size?: number }) {
  const ids = doersOf(t);
  const u = ops.users.find((x) => x.id === ids[0]);
  if (!u)
    return (
      <span className="avatar-empty sm" title="Nobody on it yet" aria-label="Nobody on it yet">
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
export const toastAdded = (text: string, undo: () => void, open: () => void) => toast({ text, action: { label: 'Undo', run: undo }, also: { label: 'Open', run: open }, ms: 6000 });

/** "today", "tomorrow", "Monday", "13 Oct", "no date": a day mid-sentence. */
export function dayWords(day: string, today: string) {
  if (!day) return 'no date';
  const w = dueText(day, today);
  return /^(Today|Tomorrow|Yesterday)$/.test(w) ? w.toLowerCase() : w;
}
