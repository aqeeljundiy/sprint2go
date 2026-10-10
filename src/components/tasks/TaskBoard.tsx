import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, CheckCircle2, ChevronDown, Columns3, MessageSquare, MoreHorizontal, Plus, Repeat as RepeatIcon } from 'lucide-react';
import { useLongPress } from '../ui/useLongPress';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { dateTone, dueText } from '../../taskDates';
import { columnOf, ownStageForColumn, stageName, stageOf, toneOf } from '../../stages';
import { toastUndo } from '../../toast';
import { usePhone } from '../../mobile/media';
import type { Todo } from '../../types';
import { Doer } from './TaskSheets';
import { quoted, type TaskOps } from './taskOps';
import type { RowLook } from './TaskRow';
import { t } from '../../i18n';

type Drag = { id: string; x: number; y: number; dx: number; dy: number; w: number; on: boolean; over: string | null };

/** A touch screen without a mouse: cards move by hold-and-drag there, not by the browser's own drag and drop. */
const touchFirst = () => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/**
 * The board: one column per stage. On a computer the columns sit side by side and cards drag with the mouse. On a
 * phone (Todoist's board) one column fills most of the width with the next one peeking and it snaps as you swipe; each
 * stage shows once, in its column's header; cards have a ring to tick them. A card moves by holding it and dragging
 * (the board scrolls when you reach its edge), by "Move to" in its menu, or (computer) by tapping its stage.
 */
export function TaskBoard({
  ops,
  tasks,
  look,
  menu,
  onStage,
  onAdd,
  onTick,
  onEditStages,
}: {
  ops: TaskOps;
  tasks: Todo[];
  look: RowLook;
  menu: (task: Todo) => SheetAction[];
  onStage: (task: Todo) => void; // the stage pill: pick a stage
  onAdd: (stageId: string) => void;
  onTick?: (task: Todo) => void; // phones: the card's ring
  onEditStages?: () => void; // phones: a column's "…" and the "Add stage" column (people who manage the stages)
}) {
  const phone = usePhone();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [mouseDrag, setMouseDrag] = useState<string | null>(null);
  // The page's columns (a project's or team's own stages on its page, else the company's); a task with stages of its
  // own sits in its own stage when the board has it, else the column of the same kind.
  const cols = ops.stages.map((s) => ({ s, items: tasks.filter((task) => columnOf(task, ops.stages).id === s.id) }));

  const colAt = (x: number, y: number) => (document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.classList.contains('tcol')) as HTMLElement | undefined)?.dataset.stage ?? null;
  const moveTo = (task: Todo, colId: string) => {
    const col = ops.stages.find((s) => s.id === colId);
    if (!col) return;
    const from = stageOf(task).id;
    const to = ownStageForColumn(task, col); // its own stage of that kind when its stages differ from the board's
    if (from === to.id) return;
    ops.status(task.id, to.id, true);
    toastUndo(t('{title} moved to {stage}', { title: quoted(task.title), stage: stageName(to) }), () => ops.status(task.id, from, true));
  };

  // While a card is held at the board's edge, the board moves one column that way, then waits a moment before the
  // next, so the card can be dropped exactly where it's meant to go.
  useEffect(() => {
    if (!drag?.on) return;
    let raf = 0;
    let since = 0;
    let last = 0;
    const tick = (now: number) => {
      const d = dragRef.current;
      const el = scroller.current;
      if (d && el) {
        const r = el.getBoundingClientRect();
        const edge = 40;
        const dir = d.x < r.left + edge ? -1 : d.x > r.right - edge ? 1 : 0;
        if (!dir) since = 0;
        else if (!since) since = now;
        if (dir && now - since > 250 && now - last > 750) {
          last = now;
          const col = el.querySelector<HTMLElement>('.tcol');
          el.scrollBy({ left: dir * ((col?.offsetWidth ?? 300) + 12), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }
        const over = colAt(d.x, d.y);
        if (over !== d.over) setDrag({ ...d, over });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag?.on]); // eslint-disable-line react-hooks/exhaustive-deps

  const dragged = drag ? tasks.find((task) => task.id === drag.id) : undefined;
  return (
    <div className={`tboard-wrap${drag?.on ? ' dragging' : ''}`}>
      <div className="tboard" ref={scroller} style={{ ['--cols' as string]: cols.length }}>
        {cols.map(({ s, items }) => (
          <section
            key={s.id}
            className={`tcol${drag?.on && drag.over === s.id ? ' over' : ''}${mouseDrag ? ' droppable' : ''}`}
            data-stage={s.id}
            aria-label={stageName(s)}
            onDragOver={(e) => mouseDrag && e.preventDefault()}
            onDrop={() => {
              const task = tasks.find((x) => x.id === mouseDrag);
              if (task) moveTo(task, s.id);
              setMouseDrag(null);
            }}
          >
            <header className="tcol-head">
              <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} />
              <span className="tcol-name">{stageName(s)}</span>
              <span className="tcol-n">{items.length}</span>
              {phone && <ColumnMenu name={stageName(s)} onAdd={() => onAdd(s.id)} onEditStages={onEditStages} />}
            </header>
            <div className="tcol-cards">
              {items.map((task) => (
                <BoardCard
                  key={task.id}
                  task={task}
                  ops={ops}
                  look={look}
                  menu={() => menu(task)}
                  dragging={drag?.on && drag.id === task.id}
                  onStage={() => onStage(task)}
                  onTick={phone ? onTick : undefined}
                  onMouseDrag={setMouseDrag}
                  onLift={(x, y, r) => setDrag({ id: task.id, x, y, dx: x - r.left, dy: y - r.top, w: r.width, on: false, over: null })}
                  onMove={(x, y) => setDrag((d) => d && { ...d, x, y, on: true, over: colAt(x, y) })}
                  onDrop={(x, y) => {
                    const over = colAt(x, y);
                    setDrag(null);
                    if (over) moveTo(task, over);
                  }}
                  onCancel={() => setDrag(null)}
                />
              ))}
              {!items.length && <p className="tcol-empty">{phone ? t('Nothing here') : t('Drop tasks here')}</p>}
            </div>
            <button type="button" className="tcol-add" onClick={() => onAdd(s.id)}>
              <Plus size={16} /> {t('Add task')}
            </button>
          </section>
        ))}
        {phone && onEditStages && (
          <button type="button" className="tcol tcol-new" onClick={onEditStages}>
            <Plus size={18} /> {t('Add stage')}
          </button>
        )}
      </div>
      {drag?.on &&
        dragged &&
        createPortal(
          <div className="tcard tcard-ghost" style={{ width: drag.w, transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px) rotate(-2deg)` }} aria-hidden="true">
            <div className="tcard-top">
              <span className="tcard-title">{dragged.title}</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function BoardCard({
  task,
  ops,
  look,
  menu,
  dragging,
  onStage,
  onTick,
  onMouseDrag,
  onLift,
  onMove,
  onDrop,
  onCancel,
}: {
  task: Todo;
  ops: TaskOps;
  look: RowLook;
  menu: () => SheetAction[];
  dragging?: boolean;
  onStage: () => void;
  onTick?: (task: Todo) => void;
  onMouseDrag: (id: string | null) => void;
  onLift: (x: number, y: number, r: DOMRect) => void;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const m = useActionMenu(menu, { title: task.title, className: 'task-menu' });
  // Hold, then move: drag. Hold and let go without moving: the card's menu.
  const press = useLongPress(
    (p) => {
      moved.current = false;
      onLift(p.x, p.y, ref.current!.getBoundingClientRect());
    },
    {
      onDrag: (p) => {
        if (!moved.current && Math.hypot(p.dx, p.dy) < 8) return;
        moved.current = true;
        onMove(p.x, p.y);
      },
      onDragEnd: (p) => {
        if (moved.current) onDrop(p.x, p.y);
        else {
          onCancel();
          m.openAt(p.x - p.dx, p.y - p.dy);
        }
      },
    },
  );
  const st = stageOf(task);
  const tone = task.due && !task.done ? dateTone(task.due, ops.today) : null;
  const cl = task.checklist ?? [];
  const comments = (task.history ?? []).filter((h) => h.kind === 'comment').length;
  const c = look.project ? ops.clients.find((x) => x.id === task.clientId) : undefined;
  return (
    <>
      <div
        ref={ref}
        className={`tcard lp${task.priority === 'high' && look.show('priority') ? ' high' : ''}${dragging ? ' dragging' : ''}${task.done ? ' done' : ''}`}
        draggable={!touchFirst()}
        onDragStart={() => onMouseDrag(task.id)}
        onDragEnd={() => onMouseDrag(null)}
        onClick={(e) => !(e.target as HTMLElement).closest('button') && ops.open(task.id)}
        {...press}
        onContextMenu={(e) => {
          press.onContextMenu(e);
          if (e.defaultPrevented) return;
          e.preventDefault();
          m.openAt(e.clientX, e.clientY);
        }}
      >
        <div className="tcard-top">
          {onTick && (
            <button type="button" className={`trow-check tcard-check${task.priority === 'high' && look.show('priority') ? ' p-high' : ''}${task.done ? ' on' : ''}`} onClick={() => onTick(task)} aria-label={task.done ? t('Mark not done') : t('Mark “{title}” done', { title: task.title })}>
              <span className="ring">{task.done && <Check size={11} strokeWidth={3} />}</span>
            </button>
          )}
          <button type="button" className="tcard-title" onClick={() => ops.open(task.id)}>
            {task.priority === 'high' && look.show('priority') && <i className="tcard-high" aria-label={t('High priority')} />}
            {task.title}
          </button>
          {look.show('assignee') && <Doer task={task} ops={ops} />}
        </div>
        <div className="tcard-meta">
          {look.show('due') && task.due && !task.done && (
            <span className={`tm due-${tone}`}>
              {task.repeat && <RepeatIcon size={12} className="tm-rep" />}
              <CalendarDays size={12} className="tm-cal" aria-hidden="true" />
              {dueText(task.due, ops.today)}
            </span>
          )}
          {look.show('checklist') && cl.length > 0 && (
            <span className={`tm${cl.every((x) => x.done) ? ' ok' : ''}`}>
              <CheckCircle2 size={12} /> {cl.filter((x) => x.done).length}/{cl.length}
            </span>
          )}
          {look.show('comments') && comments > 0 && (
            <span className="tm">
              <MessageSquare size={12} /> {comments}
            </span>
          )}
          {c && look.show('project') && (
            <span className="tm proj" style={{ ['--c' as string]: c.color }}>
              <i />
              {c.name}
            </span>
          )}
        </div>
        {!onTick && (
        <button type="button" className={`tcard-stage tone-${toneOf(st)}`} onClick={onStage} aria-label={t('Stage: {stage}. Move to another stage', { stage: stageName(st) })}>
          <span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />
          {stageName(st)}
          <ChevronDown size={13} />
        </button>
        )}
      </div>
      {m.menu}
    </>
  );
}

/** Phones: a column's "…" (Todoist's section menu): add a task in this stage, or change the stages. */
function ColumnMenu({ name, onAdd, onEditStages }: { name: string; onAdd: () => void; onEditStages?: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const m = useActionMenu(() => [{ label: t('Add task here'), icon: Plus, run: onAdd }, ...(onEditStages ? [{ label: t('Edit stages'), icon: Columns3, run: onEditStages }] : [])], { title: name, menu: true });
  return (
    <>
      <button ref={btn} type="button" className="icon-btn tcol-more" onClick={() => m.openFrom(btn)} aria-label={t('More for {stage}', { stage: name })}>
        <MoreHorizontal size={18} />
      </button>
      {m.menu}
    </>
  );
}
