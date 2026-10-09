import { useEffect, useRef, type RefObject } from 'react';

/** Set while an event is lifted and dragged: the grid mustn't also swipe to the next day. */
export const swipeLock = { on: false };

/**
 * Swipe the calendar sideways to go back or forward (replaces the arrows on phones). The content follows the finger,
 * slides out the way it was swiped and the next days slide in from the other side. A mostly vertical move scrolls as
 * always. Touch only: on desktop the arrows and the keyboard do this.
 */
export function useSwipeNav(ref: RefObject<HTMLElement | null>, onStep: (dir: 1 | -1) => void, disabled = false) {
  const step = useRef(onStep);
  step.current = onStep;
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let lastX = 0;
    let lastT = 0;
    let speed = 0;
    let state: '' | 'maybe' | 'x' = '';
    let alive = true;
    const set = (x: number, ms: number, ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)') => {
      el.style.transition = ms ? `transform ${ms}ms ${ease}, opacity ${ms}ms ${ease}` : 'none';
      el.style.transform = x ? `translateX(${x}px)` : '';
      el.style.opacity = x ? String(Math.max(0.35, 1 - Math.abs(x) / (el.offsetWidth * 1.2))) : '';
    };
    const clear = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
    };
    const start = (e: TouchEvent) => {
      state = '';
      if (e.touches.length !== 1 || swipeLock.on) return;
      if ((e.target as Element).closest('.no-swipe, input, textarea, [contenteditable="true"]')) return;
      const t = e.touches[0];
      x0 = lastX = t.clientX;
      y0 = t.clientY;
      lastT = performance.now();
      dx = speed = 0;
      state = 'maybe';
    };
    const move = (e: TouchEvent) => {
      if (!state || swipeLock.on) {
        if (state === 'x') set(0, 160);
        state = '';
        return;
      }
      const t = e.touches[0];
      const ddx = t.clientX - x0;
      const ddy = t.clientY - y0;
      if (state === 'maybe') {
        if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;
        if (Math.abs(ddx) < Math.abs(ddy) * 1.3) return void (state = '');
        state = 'x';
      }
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      speed = (t.clientX - lastX) / Math.max(1, now - lastT);
      lastX = t.clientX;
      lastT = now;
      dx = ddx;
      if (!still.matches) set(dx * 0.85, 0);
    };
    const end = () => {
      if (state !== 'x') return void (state = '');
      state = '';
      const go = Math.abs(dx) > 64 || Math.abs(speed) > 0.45;
      if (!go) return set(0, 200);
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      if (still.matches) return (clear(), step.current(dir));
      const w = el.offsetWidth;
      set(-dir * w * 0.35, 120, 'cubic-bezier(0.4, 0, 1, 1)');
      setTimeout(() => {
        if (!alive) return;
        step.current(dir);
        // The new days come in from the side the finger came from.
        set(dir * w * 0.25, 0);
        void el.offsetWidth;
        set(0, 220);
        setTimeout(() => alive && clear(), 240);
      }, 120);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      alive = false;
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      clear();
    };
  }, [ref, disabled]);
}
