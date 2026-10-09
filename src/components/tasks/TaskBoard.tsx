import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ChevronDown, MessageSquare, Plus, Repeat as RepeatIcon } from 'lucide-react';
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

type Drag = { id: string; x: number; y: number; dx: number; dy: number; w: number; on: boolean; over: string | null };

/** A touch screen without a mouse: cards move by hold-and-drag there, not by the browser's own drag and drop. */
const touchFirst = () => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/**
 * The board: one column per stage. On a computer the columns sit side by side and cards drag with the mouse. On a
 * phone one column fills most of the width with the next one peeking, it snaps as you swipe, and a strip of stage names
 * jumps between them. A card moves by holding it and dragging (the board scrolls when you reach its edge), by "Move to"
 * in its menu, or by tapping its stage.
 */
export function TaskBoard({
  ops,
  tasks,
  look,
  menu,
  onStage,
  onAdd,
}: {
  ops: TaskOps;
  tasks: Todo[];
  look: RowLook;
  menu: (t: Todo) => SheetAction[];
  onStage: (t: Todo) => void; // the stage pill: pick a stage
  onAdd: (stageId: string) => void;
}) {
  const phone = usePhone();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [mouseDrag, setMouseDrag] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  // The page's columns (a project's or team's own stages on its page, else the company's); a task with stages of its
  // own sits in its own stage when the board has it, else the column of the same kind.
  const cols = ops.stages.map((s) => ({ s, items: tasks.filter((t) => columnOf(t, ops.stages).id === s.id) }));

  const colAt = (x: number, y: number) => (document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.classList.contains('tcol')) as HTMLElement | undefined)?.dataset.stage ?? null;
  const moveTo = (t: Todo, colId: string) => {
    const col = ops.stages.find((s) => s.id === colId);
    if (!col) return;
    const from = stageOf(t).id;
    const to = ownStageForColumn(t, col); // its own stage of that kind when its stages differ from the board's
    if (from === to.id) return;
    ops.status(t.id, to.id, true);
    toastUndo(`${quoted(t.title)} moved to ${stageName(to)}`, () => ops.status(t.id, from, true));
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

  // Phones: which column is in view, for the strip.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !phone) return;
    const on = () => {
      const col = el.querySelector<HTMLElement>('.tcol');
      if (!col) return;
      const w = col.offsetWidth + 12;
      setCurrent(Math.max(0, Math.min(cols.length - 1, Math.round(el.scrollLeft / w))));
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [phone, cols.length]);
  const jump = (i: number) => {
    const el = scroller.current;
    const col = el?.querySelectorAll<HTMLElement>('.tcol')[i];
    if (el && col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft - 16, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  // The strip keeps the current stage in view.
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const b = strip.current?.children[current] as HTMLElement | undefined;
    b?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  const dragged = drag ? tasks.find((t) => t.id === drag.id) : undefined;
  return (
    <div className={`tboard-wrap${drag?.on ? ' dragging' : ''}`}>
      {phone && (
        <div className="tboard-strip" ref={strip} role="tablist" aria-label="Stages">
          {cols.map(({ s, items }, i) => (
            <button key={s.id} type="button" role="tab" aria-selected={i === current} className={i === current ? 'on' : ''} onClick={() => jump(i)}>
              <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} />
              {stageName(s)}
              <b>{items.length}</b>
            </button>
          ))}
        </div>
      )}
      <div className="tboard" ref={scroller} style={{ ['--cols' as string]: cols.length }}>
        {cols.map(({ s, items }) => (
          <section
            key={s.id}
            className={`tcol${drag?.on && drag.over === s.id ? ' over' : ''}${mouseDrag ? ' droppable' : ''}`}
            data-stage={s.id}
            aria-label={stageName(s)}
            onDragOver={(e) => mouseDrag && e.preventDefault()}
            onDrop={() => {
              const t = tasks.find((x) => x.id === mouseDrag);
              if (t) moveTo(t, s.id);
              setMouseDrag(null);
            }}
          >
            <header className="tcol-head">
              <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} />
              <span className="tcol-name">{stageName(s)}</span>
              <span className="tcol-n">{items.length}</span>
            </header>
            <div className="tcol-cards">
              {items.map((t) => (
                <BoardCard
                  key={t.id}
                  t={t}
                  ops={ops}
                  look={look}
                  menu={() => menu(t)}
                  dragging={drag?.on && drag.id === t.id}
                  onStage={() => onStage(t)}
                  onMouseDrag={setMouseDrag}
                  onLift={(x, y, r) => setDrag({ id: t.id, x, y, dx: x - r.left, dy: y - r.top, w: r.width, on: false, over: null })}
                  onMove={(x, y) => setDrag((d) => d && { ...d, x, y, on: true, over: colAt(x, y) })}
                  onDrop={(x, y) => {
                    const over = colAt(x, y);
                    setDrag(null);
                    if (over) moveTo(t, over);
                  }}
                  onCancel={() => setDrag(null)}
                />
              ))}
              {!items.length && <p className="tcol-empty">{phone ? 'Nothing here' : 'Drop tasks here'}</p>}
            </div>
            <button type="button" className="tcol-add" onClick={() => onAdd(s.id)}>
              <Plus size={16} /> Add task
            </button>
          </section>
        ))}
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
  t,
  ops,
  look,
  menu,
  dragging,
  onStage,
  onMouseDrag,
  onLift,
  onMove,
  onDrop,
  onCancel,
}: {
  t: Todo;
  ops: TaskOps;
  look: RowLook;
  menu: () => SheetAction[];
  dragging?: boolean;
  onStage: () => void;
  onMouseDrag: (id: string | null) => void;
  onLift: (x: number, y: number, r: DOMRect) => void;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const m = useActionMenu(menu, { title: t.title });
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
  const st = stageOf(t);
  const tone = t.due && !t.done ? dateTone(t.due, ops.today) : null;
  const cl = t.checklist ?? [];
  const comments = (t.history ?? []).filter((h) => h.kind === 'comment').length;
  const c = look.project ? ops.clients.find((x) => x.id === t.clientId) : undefined;
  return (
    <>
      <div
        ref={ref}
        className={`tcard lp${t.priority === 'high' && look.show('priority') ? ' high' : ''}${dragging ? ' dragging' : ''}${t.done ? ' done' : ''}`}
        draggable={!touchFirst()}
        onDragStart={() => onMouseDrag(t.id)}
        onDragEnd={() => onMouseDrag(null)}
        onClick={(e) => !(e.target as HTMLElement).closest('button') && ops.open(t.id)}
        {...press}
        onContextMenu={(e) => {
          press.onContextMenu(e);
          if (e.defaultPrevented) return;
          e.preventDefault();
          m.openAt(e.clientX, e.clientY);
        }}
      >
        <div className="tcard-top">
          <button type="button" className="tcard-title" onClick={() => ops.open(t.id)}>
            {t.priority === 'high' && look.show('priority') && <i className="tcard-high" aria-label="High priority" />}
            {t.title}
          </button>
          {look.show('assignee') && <Doer t={t} ops={ops} />}
        </div>
        <div className="tcard-meta">
          {look.show('due') && t.due && !t.done && (
            <span className={`tm due-${tone}`}>
              {t.repeat && <RepeatIcon size={12} />}
              {dueText(t.due, ops.today)}
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
        <button type="button" className={`tcard-stage tone-${toneOf(st)}`} onClick={onStage} aria-label={`Stage: ${stageName(st)}. Move to another stage`}>
          <span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />
          {stageName(st)}
          <ChevronDown size={13} />
        </button>
      </div>
      {m.menu}
    </>
  );
}
