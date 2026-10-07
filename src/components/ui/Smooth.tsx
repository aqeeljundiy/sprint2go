import { useLayoutEffect, useRef, type ReactNode } from 'react';

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
      for (const k of ['display', 'flexDirection', 'flexWrap', 'gap', 'rowGap', 'columnGap', 'alignItems', 'justifyItems', 'alignContent', 'gridTemplateColumns'] as const) i.style[k] = ps[k];
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
