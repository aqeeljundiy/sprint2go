import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A list whose removed items stay a moment so their row can fold away (give it the `row-leaving` class) instead of
 * vanishing, whichever screen or dialog removed them. Items that come back simply stay. Reduced motion: no delay.
 */
export function useLeaving<T>(items: T[], key: (t: T) => string, ms = 240): { item: T; leaving: boolean }[] {
  const [, bump] = useState(0);
  const prev = useRef<T[]>(items);
  const gone = useRef(new Map<string, { item: T; at: number }>());
  const now = new Set(items.map(key));
  const still = typeof matchMedia === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prev.current !== items) {
    prev.current.forEach((t, i) => {
      const k = key(t);
      if (now.has(k) || gone.current.has(k) || still) return;
      gone.current.set(k, { item: t, at: i });
      setTimeout(() => {
        gone.current.delete(k);
        bump((n) => n + 1);
      }, ms);
    });
    prev.current = items;
  }
  for (const k of [...gone.current.keys()]) if (now.has(k)) gone.current.delete(k);
  const out = items.map((item) => ({ item, leaving: false }));
  [...gone.current.values()].sort((a, b) => a.at - b.at).forEach(({ item, at }) => out.splice(Math.min(at, out.length), 0, { item, leaving: true }));
  return out;
}

/**
 * Animates its own height when what's inside changes size (a tab switch, a step, a section opening), instead of
 * snapping. Height is only pinned while it animates; the rest of the time it's auto, so it can never get stuck.
 * Overflow is only clipped while moving, so focus rings and menus aren't cut off.
 */
export function SmoothHeight({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current!;
    const i = inner.current!;
    // Take the parent's layout (a dialog body is usually a grid or a flex column with a gap), so wrapping changes nothing.
    const ps = o.parentElement && getComputedStyle(o.parentElement);
    if (ps && (ps.display.includes('grid') || ps.display.includes('flex'))) {
      for (const k of ['display', 'flexDirection', 'flexWrap', 'gap', 'rowGap', 'columnGap', 'alignItems', 'justifyItems', 'alignContent', 'gridTemplateColumns'] as const) {
        // Computed columns come back in pixels. One column is the default anyway, and freezing it at today's width would
        // keep it that wide after the window narrows (a phone turned, a pane resized), so only real multi-column grids copy.
        if (k === 'gridTemplateColumns' && !/\S\s+\S/.test(ps[k].trim())) continue;
        i.style[k] = ps[k];
      }
    }
    let last = i.offsetHeight;
    const settle = (e?: TransitionEvent) => {
      if (e && (e.target !== o || e.propertyName !== 'height')) return;
      o.classList.remove('moving');
      o.style.height = '';
    };
    const ro = new ResizeObserver(() => {
      const h = i.offsetHeight;
      if (h === last) return;
      const from = o.classList.contains('moving') ? o.getBoundingClientRect().height : last;
      last = h;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      o.classList.add('moving');
      o.style.height = `${from}px`;
      void o.offsetHeight; // start from where it is now
      o.style.height = `${h}px`;
    });
    ro.observe(i);
    o.addEventListener('transitionend', settle);
    return () => (ro.disconnect(), o.removeEventListener('transitionend', settle));
  }, []);
  return (
    <div ref={outer} className={`smooth-h ${className ?? ''}`}>
      <div ref={inner} className="smooth-h-in">
        {children}
      </div>
    </div>
  );
}

/**
 * The content of one tab. Give it `key={tab}`: switching tabs fades the new content in. It adds no box of its own
 * (display: contents), so layouts built on the parent's flex or grid keep working.
 */
export function TabPane({ children }: { children: ReactNode }) {
  return <div className="tab-pane">{children}</div>;
}
