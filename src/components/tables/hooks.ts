import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { TableViewDef, TableViewTweak } from '../../types';
import { usePersisted } from '../../settings';
import { routeBase } from '../../tryOut';
import { tweakDiffers, withTweak } from './core';

/**
 * How wide a pane is, kept up to date (a ResizeObserver, so a Tables view in a narrow project pane on a laptop gets
 * the phone layout too). Starts from the window's width so the first paint is already right.
 */
export function usePaneWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setW(el.clientWidth || window.innerWidth);
    const ro = new ResizeObserver(([e]) => {
      const next = Math.round(e.contentRect.width);
      if (next) setW((x) => (Math.abs(x - next) > 1 ? next : x));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Under this pane width a table shows cards, one toolbar row and sheets: the phone layout. */
export const NARROW_PANE = 600;

/**
 * Each person's own filters and sorts per view, on top of what everyone sees, until they're saved for everyone.
 * Kept in the person's prefs (the key starts with `s2g-table-view:`, which follows them between devices; see
 * SYNCED in src/settings.ts), so a guest or a member who can't change the view can still filter for themselves.
 */
export function useTweaks(tableId: string) {
  const [all, setAll] = usePersisted<Record<string, TableViewTweak>>(`s2g-table-view:mine:${tableId}`, {});
  const of = (viewId: string) => all[viewId] ?? null;
  return {
    of,
    effective: (view: TableViewDef) => withTweak(view, of(view.id)),
    differs: (view: TableViewDef) => tweakDiffers(view, of(view.id)),
    set: (viewId: string, patch: TableViewTweak) => setAll((x) => ({ ...x, [viewId]: { ...(x[viewId] ?? {}), ...patch } })),
    /** Back to what everyone sees (folded groups stay as they are: they're only about how you look at it). */
    reset: (viewId: string) =>
      setAll((x) => {
        const keep = x[viewId]?.collapsed;
        const next = { ...x };
        if (keep) next[viewId] = { collapsed: keep };
        else delete next[viewId];
        return next;
      }),
  };
}

/**
 * Links to a table, a view or a row: /tables?t=<table>&v=<view>&r=<row>. Whatever screen of Tables is showing reads
 * it once, opens what it points at and tidies the address.
 */
export function readTableLink(): { t: string; v?: string; r?: string } | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const t = q.get('t');
  return t ? { t, v: q.get('v') ?? undefined, r: q.get('r') ?? undefined } : null;
}
export function clearTableLink() {
  try {
    const q = new URLSearchParams(location.search);
    ['t', 'v', 'r'].forEach((k) => q.delete(k));
    history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
  } catch {
    /* some previews forbid history changes */
  }
}
export const tableLink = (t: string, v?: string, r?: string) => `${location.origin}${routeBase}/tables?t=${encodeURIComponent(t)}${v ? `&v=${encodeURIComponent(v)}` : ''}${r ? `&r=${encodeURIComponent(r)}` : ''}`;

/** Opens the table a link points at (from the list of tables, or from another table). */
export function useTableLinkOpen(current: string | null, open: (id: string, rowId?: string) => void) {
  useEffect(() => {
    const l = readTableLink();
    if (!l || l.t === current) return;
    open(l.t, l.r);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
