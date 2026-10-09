import { useSyncExternalStore } from 'react';

/**
 * The on-screen keyboard, from `visualViewport`. While someone types on a phone the keyboard takes the bottom of the
 * screen without the page knowing; this measures it and tells the CSS:
 *   --kb      on <html>: how much of the bottom the keyboard covers (0px when it's closed)
 *   .kb-open  on <html>: while it's open (the tab bar and the create button step aside)
 * Anything fixed to the bottom (a composer, a sheet, a Send bar) uses `bottom: var(--kb)` or
 * `padding-bottom: var(--kb)` to ride above it. Components that need to know use `useKeyboard()`.
 */
type Kb = { open: boolean; inset: number };
let state: Kb = { open: false, inset: 0 };
const subs = new Set<() => void>();

const TYPING = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', '']);
/** Something that brings the keyboard up. */
export function isTyping(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && TYPING.has(el.type);
  return false;
}

let started = false;
export function startKeyboard() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  root.style.setProperty('--kb', '0px');
  let raf = 0;
  const measure = () => {
    raf = 0;
    // A pinch-zoomed page also has a smaller visual viewport: only count it as the keyboard at normal zoom.
    const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const open = covered > 120 && Math.abs(vv.scale - 1) < 0.05 && isTyping(document.activeElement);
    const inset = open ? covered : 0;
    if (inset === state.inset && open === state.open) return;
    root.style.setProperty('--kb', `${inset}px`);
    if (open !== state.open) root.classList.toggle('kb-open', open);
    state = { open, inset };
    subs.forEach((f) => f());
  };
  const later = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  vv.addEventListener('resize', later);
  vv.addEventListener('scroll', later);
  window.addEventListener('focusin', later);
  // Focus leaving a field closes the keyboard; the viewport resize that follows confirms it.
  window.addEventListener('focusout', () => setTimeout(later, 60));
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const snapshot = () => state;

/** `{ open, inset }`: whether the phone's keyboard is up, and how many pixels of the bottom it covers. */
export function useKeyboard(): Kb {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
