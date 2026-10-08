import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const PHONE = '(max-width: 760px)';

/**
 * A floating panel anchored to a trigger. On phones it becomes a bottom sheet.
 * Closes on outside click, Escape, scroll of the page behind it, and resize.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  width,
  title,
  align = 'start',
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  title?: string; // shown on the phone sheet
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const sheet = typeof window !== 'undefined' && window.matchMedia(PHONE).matches;

  useLayoutEffect(() => {
    if (!open || sheet) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = window.innerHeight - a.bottom;
      const up = below < h + 12 && a.top > below;
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setPos({ top: up ? a.top - h - 6 : a.bottom + 6, left, up });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, sheet, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      // A picker opened from inside this one (a dropdown in a popover) isn't "outside".
      const other = (t as Element).closest?.('.pop, .pop-scrim'); // (its own sheet scrim closes it by itself)
      if (other && other !== ref.current && !other.classList.contains('is-leaving')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      // Escape closes only the top one.
      const all = [...document.querySelectorAll('.pop:not(.is-leaving)')];
      if (e.key === 'Escape' && all.length && all[all.length - 1] !== ref.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;

  if (sheet) {
    return createPortal(
      <div className="pop-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className="pop pop-sheet" role="dialog" aria-label={title}>
          <div className="pop-grab" />
          {title && <div className="pop-title">{title}</div>}
          {children}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={ref}
      className={`pop ${pos?.up ? 'up' : ''}`}
      role="dialog"
      aria-label={title}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
