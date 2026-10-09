import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isTyping } from '../../mobile/keyboard';

/** Open sheets, newest last: Escape closes only the top one. */
const stack: { close: () => void }[] = [];

/** The nearest element between `el` and `stop` that has scrolled down from its top. */
function scrolledAbove(el: Element | null, stop: Element) {
  for (let x = el; x && x !== stop; x = x.parentElement) if (x.scrollTop > 0) return true;
  return false;
}

/**
 * A bottom sheet: grab handle, title, content, optional footer. Slides up on open and down on close (the close comes
 * from src/exitAnimations.ts, `.sheet-scrim` is in its list). Swipe it down to close: from the handle or the title, or
 * from the content when that's scrolled to the top. Tapping the dimmed page or pressing Escape closes it too. It rides
 * above the phone's keyboard (`--kb`). On wider screens it shows as a centred panel instead.
 *
 * Render it while it's open (`{open && <Sheet …/>}`) or pass `open`.
 */
export function Sheet({
  open = true,
  onClose,
  title,
  label,
  head,
  footer,
  children,
  className = '',
  size = 'auto',
  aboveBar,
}: {
  open?: boolean;
  onClose: () => void;
  title?: ReactNode;
  label?: string; // for screen readers when the title isn't plain text
  head?: ReactNode; // extra things in the title row (a Done button)
  footer?: ReactNode; // pinned under the content (a Save button)
  children: ReactNode;
  className?: string;
  size?: 'auto' | 'tall' | 'full'; // auto: as tall as its content; tall: at least two thirds; full: the whole screen
  aboveBar?: boolean; // phones: rise from above the tab bar and leave it showing (More)
}) {
  const scrim = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const downOnScrim = useRef(false);

  // Escape: only the top sheet, and only when no menu inside it is open (a menu closes first).
  useEffect(() => {
    if (!open) return;
    const me = { close: () => closeRef.current() };
    stack.push(me);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== me) return;
      e.stopPropagation();
      me.close();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      stack.splice(stack.indexOf(me), 1);
    };
  }, [open]);

  // Focus moves into the sheet (unless something in it took focus already) and back to where it was after.
  useLayoutEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    return () => {
      // Not back into a text field: on a phone that would bring the keyboard up again.
      if (before?.isConnected && before !== document.body && !isTyping(before)) before.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Swipe down to close.
  useEffect(() => {
    const sheet = ref.current;
    const shade = scrim.current;
    if (!open || !sheet || !shade) return;
    let startX = 0;
    let startY = 0;
    let dy = 0;
    let can = false;
    let decided = false;
    let dragging = false;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    let alive = true;
    const settle = () => {
      sheet.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
      sheet.style.transform = '';
      shade.style.removeProperty('--shade');
      setTimeout(() => alive && (sheet.style.transition = ''), 220);
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return (can = false);
      const t = e.touches[0];
      startX = t.clientX;
      startY = lastY = t.clientY;
      lastT = performance.now();
      dy = speed = 0;
      decided = dragging = false;
      const target = e.target as Element;
      // A field being typed in keeps its own gestures (selecting text); so does anything scrolled down.
      can = !!target.closest('.sheet-grab, .sheet-head') || (!scrolledAbove(target, sheet) && !target.closest('input, textarea, [contenteditable="true"]'));
    };
    const move = (e: TouchEvent) => {
      if (!can) return;
      const t = e.touches[0];
      const ddy = t.clientY - startY;
      const ddx = t.clientX - startX;
      if (!decided) {
        if (Math.abs(ddy) < 6 && Math.abs(ddx) < 6) return;
        decided = true;
        dragging = ddy > 0 && Math.abs(ddy) > Math.abs(ddx);
        if (!dragging) return void (can = false);
      }
      if (!dragging) return;
      if (e.cancelable) e.preventDefault(); // the sheet moves, the page doesn't
      const now = performance.now();
      speed = (t.clientY - lastY) / Math.max(1, now - lastT);
      lastY = t.clientY;
      lastT = now;
      dy = Math.max(0, ddy);
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${dy}px)`;
      shade.style.setProperty('--shade', String(Math.max(0, 1 - dy / Math.max(1, sheet.offsetHeight))));
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (dy > Math.min(140, sheet.offsetHeight * 0.3) || speed > 0.6) {
        closeRef.current(); // the closing copy carries on down from where the finger left it
        setTimeout(() => alive && settle(), 80); // still here: whoever owns it decided to keep it open
      } else settle();
    };
    sheet.addEventListener('touchstart', start, { passive: true });
    sheet.addEventListener('touchmove', move, { passive: false });
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
    return () => {
      alive = false;
      sheet.removeEventListener('touchstart', start);
      sheet.removeEventListener('touchmove', move);
      sheet.removeEventListener('touchend', end);
      sheet.removeEventListener('touchcancel', end);
    };
  }, [open]);

  if (!open) return null;
  // A tap on the dimmed page closes it, but only one that started there: the finger that long-pressed to open the
  // sheet lifts over the scrim, and the click the phone makes of it mustn't close the sheet straight away.
  return createPortal(
    <div
      ref={scrim}
      className={`sheet-scrim${aboveBar ? ' above-bar' : ''}`}
      onPointerDown={(e) => (downOnScrim.current = e.target === e.currentTarget)}
      onClick={(e) => e.target === e.currentTarget && downOnScrim.current && onClose()}
    >
      <div ref={ref} className={`sheet sheet-${size} ${className}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)} tabIndex={-1}>
        <div className="sheet-grab" aria-hidden="true" />
        {(title || head) && (
          <header className="sheet-head">
            {title && <h2 className="sheet-title">{title}</h2>}
            {head}
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
