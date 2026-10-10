/**
 * Sliding selection for every tab bar and segmented control in the app, in one place.
 *
 * Each bar gets one highlight that glides to the selected tab, instead of the selection jumping. It takes the selected
 * tab's shape; every bar has the same look (system.css: a 32px round pill tinted with the accent), so tabs and
 * segmented controls read as one family. Screens don't need to do anything: any container matching BARS gets it.
 */
const BARS = '.segmented, .client-tabs, .chan-tabs, .cs-tabs';

type Ink = HTMLSpanElement & { _kind?: 'pill' | 'line' };

// A tab whose label changes width (a translation arriving, a count, a font) moves the tabs after it without any DOM
// change on the bar itself, so every bar's tabs are watched for size changes too.
let sizes: ResizeObserver | null = null;
const watched = new WeakSet<Element>();
function watch(bar: HTMLElement, again: (b: HTMLElement) => void) {
  if (typeof ResizeObserver === 'undefined') return;
  sizes ??= new ResizeObserver((entries) => {
    for (const e of entries) {
      const b = (e.target as HTMLElement).closest<HTMLElement>(BARS);
      if (b) again(b);
    }
  });
  for (const el of [bar, ...Array.from(bar.children)]) {
    if (watched.has(el) || el.classList.contains('tab-ink')) continue;
    watched.add(el);
    sizes.observe(el);
  }
}
let requeue: (b: HTMLElement) => void = () => {};

function place(bar: HTMLElement) {
  watch(bar, requeue);
  const on = bar.querySelector<HTMLElement>(':scope > button.on, :scope > [role="tab"][aria-selected="true"]');
  let ink = bar.querySelector<Ink>(':scope > .tab-ink');
  if (!on || on.offsetParent === null) {
    if (ink?.classList.contains('show')) ink.classList.remove('show');
    return;
  }
  if (!ink) {
    // Copy the selected tab's own look before its background is handed over to the highlight.
    const cs = getComputedStyle(on);
    ink = document.createElement('span') as Ink;
    ink.className = 'tab-ink';
    ink.setAttribute('aria-hidden', 'true');
    const underlined = cs.borderBottomWidth !== '0px' && cs.borderBottomColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor === 'rgba(0, 0, 0, 0)';
    ink._kind = underlined ? 'line' : 'pill';
    // Shape comes from the tab; colours come from CSS (polish.css), so light and dark both stay right.
    if (underlined) ink.style.height = cs.borderBottomWidth;
    else ink.style.borderRadius = cs.borderRadius;
    ink.style.transition = 'none';
    bar.prepend(ink);
    bar.classList.add('inked', underlined ? 'inked-line' : 'inked-pill');
  }
  // React resets the bar's classes when it re-renders: put the markers back (only if missing, see below).
  const marks = ['inked', ink._kind === 'line' ? 'inked-line' : 'inked-pill'];
  if (marks.some((m) => !bar.classList.contains(m))) bar.classList.add(...marks);
  ink.style.transform = `translate(${on.offsetLeft}px, ${ink._kind === 'line' ? on.offsetTop + on.offsetHeight - ink.offsetHeight : on.offsetTop}px)`;
  ink.style.width = `${on.offsetWidth}px`;
  if (ink._kind === 'pill') ink.style.height = `${on.offsetHeight}px`;
  // Only touch the class when it changes: classList.add records a change even when nothing changes, which would loop.
  if (!ink.classList.contains('show')) ink.classList.add('show');
  if (ink.style.transition === 'none') requestAnimationFrame(() => requestAnimationFrame(() => ink && (ink.style.transition = '')));
}

export function startSlidingTabs() {
  if (typeof MutationObserver === 'undefined') return;
  const pending = new Set<HTMLElement>();
  let queued = false;
  let budget = 0; // safety: never more than a few hundred placements in a burst
  setInterval(() => (budget = 0), 1000);
  const flush = () => {
    queued = false;
    if ((budget += pending.size) > 400) {
      pending.clear();
      return;
    }
    pending.forEach((b) => b.isConnected && place(b));
    pending.clear();
  };
  const queue = (b: HTMLElement | null) => {
    if (!b) return;
    pending.add(b);
    if (!queued) {
      queued = true;
      queueMicrotask(flush);
    }
  };
  requeue = queue;
  const scan = (root: ParentNode) => root.querySelectorAll<HTMLElement>(BARS).forEach(queue);
  new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target as HTMLElement;
      if (t.classList?.contains('tab-ink')) continue; // our own highlight
      if (r.type === 'characterData') {
        queue((t.parentElement?.closest?.(BARS) as HTMLElement | null) ?? null); // a label's text changed in place
        continue;
      }
      if (r.type === 'attributes') queue(t.matches?.(BARS) ? t : t.parentElement?.matches(BARS) ? t.parentElement : null);
      else {
        if (t.matches?.(BARS)) queue(t);
        // Something inside a tab changed (a count arrived, a label switched): its width did too.
        else queue((t.closest?.(BARS) as HTMLElement | null) ?? null);
        r.addedNodes.forEach((n) => n instanceof HTMLElement && (n.matches(BARS) ? queue(n) : scan(n)));
      }
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
  // Labels change width (counts, translations) and windows resize: keep the highlight on its tab.
  addEventListener('resize', () => scan(document));
  // The web font arrives after the first layout and makes every label a little wider.
  void document.fonts?.ready.then(() => scan(document));
  scan(document);
}
