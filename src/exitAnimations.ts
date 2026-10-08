/**
 * Closing animations for every overlay in the app, in one place.
 *
 * React removes a dialog, menu, sheet or drawer the instant it closes, which looks like a hard cut. Here, when one of
 * these leaves the page, a copy is put back for a moment (not clickable, hidden from screen readers) and plays its
 * exit animation, then goes. Screens don't need to do anything: anything matching LEAVING gets this.
 * The animations themselves live in polish.css (".is-leaving").
 */
const LEAVING = [
  '.modal-scrim',
  '.drawer-scrim',
  '.palette-scrim',
  '.pop-scrim',
  '.install-scrim',
  '.pop',
  '.account-menu',
  '.ws-menu',
  '.notices',
  '.toast',
  '.more-sheet',
  '.chat-side',
  '.ask-drawer',
  '.ask-pill',
  '.later-menu',
  '.track-menu',
  '.tb-popup',
  '.mention-pop',
  '.recip-suggest',
  '.lightbox',
  '.ev-detail',
  '.inline-sheet',
  '.fab',
].join(',');

const MS = 200;

export function startExitAnimations() {
  if (typeof MutationObserver === 'undefined') return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  new MutationObserver((records) => {
    if (reduced.matches) return;
    for (const r of records) {
      r.removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement) || !node.matches(LEAVING) || node.classList.contains('is-leaving')) return;
        if (!r.target.isConnected) return; // the whole area went away (e.g. switching screens): nothing to animate in
        const ghost = node.cloneNode(true) as HTMLElement;
        ghost.classList.add('is-leaving');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        // Where it was (fixed overlays don't depend on it, menus anchored in place do).
        const next = r.nextSibling && r.nextSibling.parentNode === r.target ? r.nextSibling : null;
        r.target.insertBefore(ghost, next);
        setTimeout(() => ghost.remove(), MS + 40);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}
