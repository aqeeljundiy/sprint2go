import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronLeft } from 'lucide-react';
import { useFocusedScreen } from '../../mobile/chrome';
import { t } from '../../i18n';

/**
 * A full screen pushed over the current one, with Back: a channel's details, a thread, an app's settings. It slides in
 * from the right and back out to the right (the exit comes from src/exitAnimations.ts, `.push-screen` is in its list).
 * On touch screens, swiping from the left edge takes it back with the finger. While it's open the tab bar steps aside.
 *
 *   {details && <PushScreen title="Details" onBack={() => setDetails(false)}>…</PushScreen>}
 */
export function PushScreen({
  title,
  onBack,
  backLabel,
  actions,
  footer,
  children,
  className = '',
  iconBack = false,
}: {
  title: ReactNode;
  onBack: () => void;
  backLabel?: string; // the screen it goes back to ("Mail"), else "Back"
  actions?: ReactNode; // up to two icon buttons on the right of the header
  footer?: ReactNode; // the screen's own bottom bar
  children: ReactNode;
  className?: string;
  iconBack?: boolean; // Gmail's back: an arrow alone (backLabel is still read out to screen readers)
}) {
  useFocusedScreen(true);
  const ref = useRef<HTMLDivElement>(null);
  const backRef = useRef(onBack);
  backRef.current = onBack;

  // Escape goes back (desktop and keyboards), unless a menu or sheet on top of it takes it first.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.pop:not(.is-leaving), .sheet-scrim:not(.is-leaving), .modal-scrim:not(.is-leaving)')) return;
      const all = document.querySelectorAll('.push-screen:not(.is-leaving)');
      if (all[all.length - 1] !== ref.current) return;
      backRef.current();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  // Swipe from the left edge to go back.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let lastX = 0;
    let lastT = 0;
    let speed = 0;
    let state: '' | 'maybe' | 'drag' = '';
    let alive = true;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      state = e.touches.length === 1 && t.clientX < 24 ? 'maybe' : '';
      x0 = lastX = t.clientX;
      y0 = t.clientY;
      lastT = performance.now();
      dx = speed = 0;
    };
    const move = (e: TouchEvent) => {
      if (!state) return;
      const t = e.touches[0];
      const ddx = t.clientX - x0;
      if (state === 'maybe') {
        if (Math.abs(t.clientY - y0) > 10 && Math.abs(t.clientY - y0) > ddx) return void (state = '');
        if (ddx < 10) return;
        state = 'drag';
      }
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      speed = (t.clientX - lastX) / Math.max(1, now - lastT);
      lastX = t.clientX;
      lastT = now;
      dx = Math.max(0, ddx);
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
    };
    const end = () => {
      if (state !== 'drag') return void (state = '');
      state = '';
      if (dx > el.offsetWidth * 0.35 || speed > 0.5) {
        backRef.current(); // the closing copy carries on to the right from here
        setTimeout(() => alive && snap(), 80);
      } else snap();
    };
    const snap = () => {
      el.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
      el.style.transform = '';
      setTimeout(() => alive && (el.style.transition = ''), 220);
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
    };
  }, []);

  // A plain Back (an arrow alone) unless it names the screen it goes back to.
  const named = backLabel && backLabel !== 'Back' && backLabel !== t('Back') ? backLabel : null;
  return createPortal(
    <div ref={ref} className={`push-screen ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <header className="push-head">
        <button type="button" className={`push-back${iconBack ? ' icon-only' : ''}`} onClick={() => backRef.current()} aria-label={named ? t('Back to {screen}', { screen: named }) : t('Back')}>
          {iconBack ? <ArrowLeft size={22} /> : <ChevronLeft size={22} />}
          {named && !iconBack && <span>{named}</span>}
        </button>
        <h1 className="push-title">{title}</h1>
        <div className="push-actions">{actions}</div>
      </header>
      <div className="push-body">{children}</div>
      {footer && <footer className="push-foot">{footer}</footer>}
    </div>,
    document.body,
  );
}
