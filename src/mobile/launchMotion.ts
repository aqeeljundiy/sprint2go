// The launcher's motion on phones (research/launcher/plan.md, section 5): an app grows out of its tile (240 ms,
// ease-out) and shrinks back into it (220 ms, ease-in), while the launcher settles between 96% and 100% (launcher.css).
// Reduced motion: a 150 ms cross-fade. The transform is only there while the animation runs, so nothing fixed inside
// the app (its bar, a sheet) stays trapped by it.

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const app = () => document.querySelector<HTMLElement>('.app');

/** While it grows or shrinks, the app is lifted over the launcher (the launcher sits over the app's screen otherwise). */
function lift(el: HTMLElement, anim: Animation) {
  el.style.position = 'relative';
  el.style.zIndex = '41';
  const drop = () => (el.style.removeProperty('position'), el.style.removeProperty('z-index'));
  anim.addEventListener('finish', drop);
  anim.addEventListener('cancel', drop);
}

function fromTile(tile: Element | null | undefined) {
  const r = tile?.getBoundingClientRect();
  if (!r || !r.width) return null;
  const sq = (tile as HTMLElement).querySelector('.ln-sq')?.getBoundingClientRect() ?? r;
  const s = sq.width / innerWidth;
  return { transform: `translate(${sq.left + sq.width / 2 - innerWidth / 2}px, ${sq.top + sq.height / 2 - innerHeight / 2}px) scale(${s})`, radius: `${16 / s}px` };
}

/** An app opened from its tile. Called before the app shows; the animation starts on the next frame. */
export function launchGrow(tile: Element | null) {
  const from = fromTile(tile);
  requestAnimationFrame(() => {
    const el = app();
    if (!el || typeof el.animate !== 'function') return;
    if (reduced() || !from) return void el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
    lift(
      el,
      el.animate(
        [
          { transform: from.transform, borderRadius: from.radius, opacity: 0.4, overflow: 'hidden' },
          { transform: 'none', borderRadius: '0px', opacity: 1, overflow: 'hidden' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      ),
    );
  });
}

/** Back to the launcher: the app on screen shrinks into its tile. */
export function launchShrink(tile: Element | null) {
  const el = app();
  if (!el || typeof el.animate !== 'function') return;
  const to = fromTile(tile);
  if (reduced() || !to) return void el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in' });
  lift(
    el,
    el.animate(
      [
        { transform: 'none', borderRadius: '0px', opacity: 1, overflow: 'hidden' },
        { transform: to.transform, borderRadius: to.radius, opacity: 0, overflow: 'hidden' },
      ],
      { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
    ),
  );
}
