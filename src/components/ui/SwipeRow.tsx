import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { haptic } from './useLongPress';
import { toastUndo } from '../../toast';

export interface SwipeAction {
  id: string;
  label: string; // shown under the icon while swiping ("Done")
  icon: LucideIcon;
  tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'neutral';
  /** Does it. Return a function that undoes it to get an Undo toast. */
  run: () => void | (() => void);
  /** The row leaves the list (Done, Delete, Move): it slides out, then folds away (render the list with useLeaving). */
  removes?: boolean;
  /** The toast's words, past tense ("Marked done"). Defaults to the label. */
  done?: string;
}

const FIRST = 72; // px: the first action is armed
const SECOND = 0.55; // of the row's width: the second action takes over

/**
 * A list row you can swipe on a touch screen, with up to two actions per side, chosen by each app.
 * `start` actions sit on the left and come with a swipe to the right; `end` actions sit on the right. Past the first
 * mark the first action is armed (its colour fills in and the phone ticks); further on, the second one. Let go to do
 * it. Actions that return an undo function get an Undo toast. A plain vertical move always scrolls, and on desktop
 * nothing happens: give the same actions a "…" menu (useActionMenu) so they're reachable everywhere.
 *
 *   const rows = useLeaving(tasks, (t) => t.id);
 *   rows.map(({ item, leaving }) => (
 *     <SwipeRow key={item.id} leaving={leaving} start={[done(item)]} end={[schedule(item)]}>…</SwipeRow>
 *   ))
 */
export function SwipeRow({
  start = [],
  end = [],
  leaving,
  disabled,
  className = '',
  children,
}: {
  start?: SwipeAction[];
  end?: SwipeAction[];
  leaving?: boolean; // from useLeaving: the row folds away
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [armed, setArmed] = useState<SwipeAction | null>(null);
  const [gone, setGone] = useState<0 | 1 | -1>(0); // slid out after an action that removes the row
  const [moving, setMoving] = useState(false);
  const g = useRef({ id: -1, x: 0, y: 0, dx: 0, lock: '' as '' | 'x' | 'y', armed: null as SwipeAction | null });
  const acts = useRef({ start, end });
  acts.current = { start, end };

  // A row that came back (Undo) slides back in.
  useEffect(() => {
    if (!leaving && gone) (setGone(0), setArmed(null));
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (d: number, width: number): SwipeAction | null => {
    const side = d > 0 ? acts.current.start : acts.current.end;
    const a = Math.abs(d);
    if (!side.length || a < FIRST) return null;
    return side.length > 1 && a > width * SECOND ? side[1] : side[0];
  };

  const finish = () => {
    const a = g.current.armed;
    g.current.armed = null;
    setMoving(false);
    if (!a?.removes) setArmed(null); // a row sliding out keeps its action's colour until it's gone
    if (!a) return setDx(0);
    const doIt = () => {
      const undo = a.run();
      if (typeof undo === 'function') toastUndo(a.done ?? a.label, undo);
    };
    if (a.removes) {
      setGone(g.current.dx > 0 ? 1 : -1);
      setDx(0);
      setTimeout(doIt, 180); // after it slides out; the list then folds the row away
    } else {
      setDx(0);
      doIt();
    }
  };

  const on = !disabled && (start.length > 0 || end.length > 0);
  const tone = armed?.tone ?? 'neutral';
  const side = gone || (dx > 0 ? 1 : dx < 0 ? -1 : 0);
  const shown = side > 0 ? (armed && start.includes(armed) ? armed : start[0]) : side < 0 ? (armed && end.includes(armed) ? armed : end[0]) : null;
  const Icon = shown?.icon;
  return (
    <div ref={box} className={`swipe-row ${className}${leaving ? ' row-leaving' : ''}${on ? ' can-swipe' : ''}`}>
      {side !== 0 && shown && (
        <div className={`swipe-under ${side > 0 ? 'from-start' : 'from-end'} tone-${armed || gone ? tone : 'neutral'}${armed ? ' armed' : ''}`} aria-hidden="true">
          {Icon && <Icon size={20} />}
          <span>{shown.label}</span>
        </div>
      )}
      <div
        ref={face}
        className={`swipe-face${moving ? ' moving' : ''}${gone ? ' gone' : ''}`}
        style={{ transform: gone ? `translateX(${gone * 105}%)` : dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={(e) => {
          if (!on || e.pointerType === 'mouse' || leaving) return;
          g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, lock: '', armed: null };
        }}
        onPointerMove={(e) => {
          const s = g.current;
          // Switched off mid-gesture (a long-press that started selecting): the finger moving on is no swipe.
          if (e.pointerId !== s.id || !on) return;
          const ddx = e.clientX - s.x;
          const ddy = e.clientY - s.y;
          if (!s.lock) {
            if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;
            s.lock = Math.abs(ddx) > Math.abs(ddy) * 1.3 ? 'x' : 'y';
            if (s.lock === 'x') {
              setMoving(true);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* already gone */
              }
            }
          }
          if (s.lock !== 'x') return;
          const width = box.current?.offsetWidth ?? 360;
          // Only toward a side that has actions; past the last mark it gets heavier.
          let d = ddx > 0 && !acts.current.start.length ? 0 : ddx < 0 && !acts.current.end.length ? 0 : ddx;
          const max = width * 0.85;
          if (Math.abs(d) > max) d = Math.sign(d) * (max + (Math.abs(d) - max) * 0.25);
          const a = pick(d, width);
          if (a !== s.armed) {
            if (a) haptic(10);
            s.armed = a;
            setArmed(a);
          }
          s.dx = d;
          setDx(d);
        }}
        onPointerUp={(e) => e.pointerId === g.current.id && g.current.lock === 'x' && finish()}
        onPointerCancel={() => {
          g.current.armed = null;
          setArmed(null);
          setMoving(false);
          setDx(0);
        }}
        onClickCapture={(e) => {
          // The tap that ends a swipe isn't a tap on the row.
          if (g.current.lock === 'x') {
            e.preventDefault();
            e.stopPropagation();
            g.current.lock = '';
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
