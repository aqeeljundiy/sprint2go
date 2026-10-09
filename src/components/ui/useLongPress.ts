import { useEffect, useRef } from 'react';

/** A short tick on phones that can (Android); quietly nothing elsewhere (iPhone Safari has no vibration). */
export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed here */
  }
}

export type PressPoint = { x: number; y: number; target: HTMLElement };
export type DragPoint = { x: number; y: number; dx: number; dy: number };

export interface LongPressOptions {
  ms?: number; // how long to hold (350 ms)
  slop?: number; // how far a finger may wander before it counts as a scroll (8 px)
  mouse?: boolean; // also for a held mouse button (off: on desktop, right-click is the long-press)
  disabled?: boolean;
  /** Long-press then move drags: called with each move once the hold fired. Scrolling is held off while dragging. */
  onDrag?: (p: DragPoint) => void;
  onDragEnd?: (p: DragPoint) => void;
}

/**
 * Long-press on touch: hold 350 ms without moving and `onLongPress` runs, the element lifts a little (`.lp-lifted`)
 * and the phone ticks where it can. Moving the finger first is a normal scroll, always. The click that follows a
 * long-press is swallowed, so a row doesn't also open. With `onDrag`, keep the finger down after the hold and move it
 * to drag (reordering, moving a card).
 *
 *   const press = useLongPress((p) => openMenu(p));
 *   <div className="lp" {...press}>…</div>         // `lp` stops the phone's own text selection and callout
 */
export function useLongPress(onLongPress: (p: PressPoint) => void, opts: LongPressOptions = {}) {
  const { ms = 350, slop = 8, mouse = false, disabled = false } = opts;
  const cb = useRef(onLongPress);
  cb.current = onLongPress;
  const o = useRef(opts);
  o.current = opts;
  const st = useRef<{ timer: number; x: number; y: number; el: HTMLElement | null; fired: boolean; id: number; swallow: boolean }>({ timer: 0, x: 0, y: 0, el: null, fired: false, id: -1, swallow: false });

  // While dragging after a hold, the page mustn't scroll under the finger (only a non-passive touchmove can stop it).
  const holdScroll = useRef<((e: TouchEvent) => void) | null>(null);
  const release = () => {
    if (holdScroll.current) document.removeEventListener('touchmove', holdScroll.current);
    holdScroll.current = null;
  };
  useEffect(() => () => (clearTimeout(st.current.timer), release()), []);

  const reset = () => {
    const s = st.current;
    clearTimeout(s.timer);
    s.timer = 0;
    s.el?.classList.remove('lp-lifted');
    s.el = null;
    s.id = -1;
    release();
  };

  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      st.current.swallow = false; // a new press: only the click that ends a long-press is swallowed, never a later one
      if (disabled || (e.pointerType === 'mouse' && !mouse) || e.button > 0) return;
      const s = st.current;
      reset();
      s.x = e.clientX;
      s.y = e.clientY;
      s.el = e.currentTarget;
      s.id = e.pointerId;
      s.fired = false;
      s.swallow = false;
      const target = e.target as HTMLElement;
      s.timer = window.setTimeout(() => {
        s.timer = 0;
        s.fired = true;
        s.swallow = true;
        s.el?.classList.add('lp-lifted');
        haptic();
        if (o.current.onDrag) {
          holdScroll.current = (ev: TouchEvent) => ev.cancelable && ev.preventDefault();
          document.addEventListener('touchmove', holdScroll.current, { passive: false });
          try {
            s.el?.setPointerCapture(s.id);
          } catch {
            /* the pointer already went */
          }
        }
        cb.current({ x: s.x, y: s.y, target });
      }, ms);
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const s = st.current;
      if (e.pointerId !== s.id) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (s.timer && Math.hypot(dx, dy) > slop) reset(); // a scroll, not a hold
      else if (s.fired && o.current.onDrag) o.current.onDrag({ x: e.clientX, y: e.clientY, dx, dy });
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const s = st.current;
      if (e.pointerId !== s.id) return;
      if (s.fired && o.current.onDragEnd) o.current.onDragEnd({ x: e.clientX, y: e.clientY, dx: e.clientX - s.x, dy: e.clientY - s.y });
      // Some browsers send no click after a long-press: don't leave the swallow waiting for someone's next click.
      if (s.swallow) window.setTimeout(() => (st.current.swallow = false), 400);
      reset();
    },
    onPointerCancel() {
      const s = st.current;
      if (s.fired && o.current.onDragEnd) o.current.onDragEnd({ x: s.x, y: s.y, dx: 0, dy: 0 });
      reset();
    },
    onClickCapture(e: React.MouseEvent) {
      if (!st.current.swallow) return;
      st.current.swallow = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu(e: React.MouseEvent) {
      // A phone's own long-press menu (Android) would open on top of ours.
      if (st.current.fired || st.current.timer) e.preventDefault();
    },
  };
}
