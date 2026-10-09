import { useCallback, useRef, useSyncExternalStore } from 'react';

/*
 * Where the huddle's slim bar sits on phones: in the open channel, right under its header; elsewhere, at the top of the
 * screen under the top bar (App.tsx puts an empty dock there). The newest dock on screen gets it, so it never covers
 * the message box or anything else: it takes its own row.
 */
let docks: HTMLElement[] = [];
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

/** A ref for an element the huddle bar can sit in. */
export function useDockRef() {
  const el = useRef<HTMLElement | null>(null);
  return useCallback((node: HTMLElement | null) => {
    if (el.current) docks = docks.filter((d) => d !== el.current);
    el.current = node;
    if (node) docks = [...docks, node];
    changed();
  }, []);
}

/** The dock the huddle bar goes in right now (null on wider screens, where the huddle is a card). */
export function useHuddleDock() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => docks[docks.length - 1] ?? null,
    () => null,
  );
}
