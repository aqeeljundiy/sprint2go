import { useEffect, useRef } from 'react';

/** The lists where pulling down from the top opens search (Mail's list pulls to refresh instead). */
const LISTS = '.mobile-list, .home-scroll, .tracking-scroll, .drive-scroll, .meet-list, .ln-scroll';
const PULL = 72; // px to pull before letting go opens search

/**
 * Phones: pull a list down from its top and let go to search (like Superhuman and Slack). A pill under the top bar
 * says "Pull to search", then "Release to search". Only where a list already scrolls, and never while typing.
 */
export function usePullToSearch(onPull: () => void, on: boolean) {
  const cb = useRef(onPull);
  cb.current = onPull;
  useEffect(() => {
    if (!on) return;
    const pill = document.createElement('div');
    pill.className = 'pull-search';
    pill.setAttribute('aria-hidden', 'true');
    pill.textContent = 'Pull to search';
    document.body.appendChild(pill);
    let list: HTMLElement | null = null;
    let x0 = 0;
    let y0 = 0;
    let dy = 0;
    let pulling = false;
    const show = (p: number) => {
      pill.style.setProperty('--pull', String(p));
      const ready = p >= 1;
      if (pill.classList.contains('ready') !== ready) {
        pill.classList.toggle('ready', ready);
        pill.textContent = ready ? 'Release to search' : 'Pull to search';
      }
    };
    const start = (e: TouchEvent) => {
      const t = e.target as Element;
      list = e.touches.length === 1 && !t.closest('input, textarea, [contenteditable="true"], .sheet, .pop, .modal, .push-screen') ? (t.closest(LISTS) as HTMLElement | null) : null;
      if (!list || list.scrollTop > 0) return void (list = null);
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      dy = 0;
      pulling = false;
    };
    const move = (e: TouchEvent) => {
      if (!list) return;
      const t = e.touches[0];
      const ddy = t.clientY - y0;
      if (!pulling) {
        if (Math.abs(t.clientX - x0) > Math.abs(ddy) || ddy < 8 || list.scrollTop > 0) {
          if (Math.abs(ddy) > 8 || Math.abs(t.clientX - x0) > 8) list = null; // a scroll or a sideways swipe
          return;
        }
        pulling = true;
        pill.classList.add('on');
      }
      dy = Math.max(0, ddy);
      show(Math.min(1, dy / PULL));
    };
    const end = () => {
      if (pulling) {
        pill.classList.remove('on', 'ready');
        pill.textContent = 'Pull to search';
        if (dy >= PULL) cb.current();
      }
      pulling = false;
      list = null;
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
      pill.remove();
    };
  }, [on]);
}
