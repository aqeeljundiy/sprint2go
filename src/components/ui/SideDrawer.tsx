import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A modal drawer from the left on phones (Gmail's folders, Google Calendar's views): over a dimmed page and the bottom
 * bar, closed by a tap on the page, Escape, or a swipe to the left that follows the finger. Mount it while open, like
 * Sheet; it slides out on close (`.side-drawer-scrim` is in src/exitAnimations.ts). Open it from the top bar's left
 * button (<TopBar lead=…>) and, on a list, with `useEdgeSwipe`.
 *
 *   {drawer && <SideDrawer label={t('Calendars')} onClose={() => setDrawer(false)}>…</SideDrawer>}
 */
export function SideDrawer({ onClose, label, children, className = '' }: { onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.pop:not(.is-leaving), .sheet-scrim:not(.is-leaving), .modal-scrim:not(.is-leaving)')) return;
      close.current();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  // Swipe left to close: the panel follows the finger; past 30% of its width or a quick flick, it goes.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let lastX = 0;
    let lastT = 0;
    let speed = 0;
    let state: '' | 'maybe' | 'drag' = '';
    const start = (e: TouchEvent) => {
      const p = e.touches[0];
      state = e.touches.length === 1 ? 'maybe' : '';
      x0 = lastX = p.clientX;
      y0 = p.clientY;
      lastT = performance.now();
      dx = speed = 0;
    };
    const move = (e: TouchEvent) => {
      if (!state) return;
      const p = e.touches[0];
      const ddx = p.clientX - x0;
      if (state === 'maybe') {
        if (Math.abs(p.clientY - y0) > 10 && Math.abs(p.clientY - y0) > -ddx) return void (state = '');
        if (ddx > -10) return;
        state = 'drag';
      }
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      speed = (p.clientX - lastX) / Math.max(1, now - lastT);
      lastX = p.clientX;
      lastT = now;
      dx = Math.min(0, ddx);
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
    };
    const end = () => {
      if (state !== 'drag') return void (state = '');
      state = '';
      el.style.transition = '';
      if (-dx > el.offsetWidth * 0.3 || speed < -0.5) close.current();
      else el.style.transform = '';
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);
  return createPortal(
    <div className="side-drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <aside ref={panel} className={`side-drawer ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/** Swipe in from the left edge of the screen (on a list, not a pushed screen) to open the app's drawer. */
export function useEdgeSwipe(onOpen: () => void, on = true) {
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    if (!on) return;
    let x0 = -1;
    let y0 = 0;
    const start = (e: TouchEvent) => {
      const p = e.touches[0];
      const inMain = (e.target as HTMLElement | null)?.closest?.('.main');
      x0 = e.touches.length === 1 && p.clientX < 20 && inMain && !document.querySelector('.push-screen, .side-drawer-scrim, .sheet-scrim') ? p.clientX : -1;
      y0 = p.clientY;
    };
    const move = (e: TouchEvent) => {
      if (x0 < 0) return;
      const p = e.touches[0];
      if (Math.abs(p.clientY - y0) > 24) return void (x0 = -1);
      if (p.clientX - x0 > 32) {
        x0 = -1;
        open.current();
      }
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
    };
  }, [on]);
}
