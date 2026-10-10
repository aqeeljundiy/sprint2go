import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { PHONE } from '../../mobile/media';

/**
 * Open popovers, each with the one it was opened from (its parent). Only one family is open at a time:
 * opening a popover closes every other one that isn't its parent (or grandparent), so menus never pile up.
 */
type Entry = { el: () => HTMLElement | null; parent: Entry | null; close: () => void };
const openPops = new Set<Entry>();
const lineage = (e: Entry | null) => {
  const s = new Set<Entry>();
  for (let x = e; x; x = x.parent) s.add(x);
  return s;
};
const entryOf = (el: Element | null) => (el ? [...openPops].find((e) => e.el() === el) ?? null : null);

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
  menu = false,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  title?: string; // shown on the phone sheet
  align?: 'start' | 'end';
  menu?: boolean; // stays a dropdown next to its button on phones too (Gmail's overflow menu), for short lists
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const entry = useRef<Entry | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; maxH?: number } | null>(null);
  const sheet = !menu && typeof window !== 'undefined' && window.matchMedia(PHONE).matches;

  useLayoutEffect(() => {
    if (!open) return;
    const me: Entry = { el: () => ref.current, parent: entryOf(anchor.current?.closest('.pop') ?? null), close: () => closeRef.current() };
    const keep = lineage(me);
    [...openPops].forEach((e) => !keep.has(e) && e.close());
    openPops.add(me);
    entry.current = me;
    return () => {
      openPops.delete(me);
      entry.current = null;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!open || sheet) return;
    let side: boolean | null = null; // above or below, decided once per opening so it never jumps sides
    let cap = Infinity; // the stylesheet's own max-height, read before any of ours is set
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      if (side === null) cap = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
      const w = el.offsetWidth;
      // Its whole height, even while a max-height of ours clips it (so a list that grows or shrinks is measured right).
      const h = Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, cap);
      const below = window.innerHeight - a.bottom;
      const up = side ?? (below < h + 12 && a.top > below);
      side = up;
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      // Taller than the room on its side (a long list near the bottom of a short window): it scrolls instead of
      // running off the screen.
      const room = (up ? a.top : below) - 14;
      const maxH = h > room ? Math.max(120, room) : undefined;
      const height = maxH ?? h;
      const next = { top: up ? Math.max(8, a.top - height - 6) : a.bottom + 6, left, up, maxH };
      setPos((p) => (p && p.top === next.top && p.left === next.left && p.up === next.up && p.maxH === next.maxH ? p : next));
    };
    place();
    window.addEventListener('resize', place);
    // A list that filters as you type changes height: one opened upwards stays against what it was opened from.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
    if (ref.current) ro?.observe(ref.current);
    return () => {
      window.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, [open, sheet, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      // A picker opened from inside this one (a dropdown in a popover) isn't "outside"; any other popover is.
      const other = (t as Element).closest?.('.pop');
      if (other && other !== ref.current && entry.current && lineage(entryOf(other)).has(entry.current)) return;
      if ((t as Element).closest?.('.pop-scrim') && !other) return; // a sheet's own scrim closes that sheet
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
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden', ...(pos?.maxH ? { maxHeight: pos.maxH } : {}) }}
    >
      {children}
    </div>,
    document.body,
  );
}
