# Sprint2go: how we build UI

Every change has to pass this bar before it's called done. It isn't optional polish: a screen that works but feels clunky is not finished.

## The bar

1. **Animated, both ways.** Things appear and disappear with motion, never a hard cut.
   - Overlays (dialogs, drawers, sheets, menus, popovers, toasts): entrance animation in CSS. The exit comes from `src/exitAnimations.ts`; add any new overlay class to its `LEAVING` list and give it an `.is-leaving` rule in `polish.css`.
   - Tabs and steps: wrap the switching content in `<TabPane key={tab}>`. Anything whose height changes (dialog bodies, steps, sections that open) goes in `<SmoothHeight>` (`src/components/ui/Smooth.tsx`). Every `.modal-body` already has it.
   - State changes (selected, on/off, hover, expanded): transition color, background, border, transform, 150 to 250 ms.
   - Lists: new rows fade or slide in; removed rows collapse rather than vanish.
2. **Smooth, no jumps.** Nothing resizes or shifts abruptly.
   - Tabbed areas keep one height (stack the panels) or animate it.
   - Reserve space for things that load. Hover and selected states must not change size (no bold-on-select width shifts, no borders appearing without space for them).
3. **Fast.** Enter 150 to 300 ms with ease-out; exit 150 to 200 ms with ease-in. Motion never makes anyone wait for their next click.
4. **Calm.** Nothing moves by itself: no loops, auto-advancing carousels or tours, or bobbing decorations. The exception is live status (a recording dot, a progress bar). Motion answers what the person did.
5. **Clean.** Spacing on a 4/8 px scale, consistent radii, one primary action per area, aligned edges and baselines. Centered things are actually centered: check for class clashes like the old `.sel`, which is the Select component's class.
6. **Responsive.** Check at 375, 768, 1024 and 1440 px wide.
   - No horizontal scroll, and tap targets of at least 40 px on phones.
   - Popovers become bottom sheets on phones.
   - Panes react to their own width (container queries), not just the window's.
7. **Balanced.** Even visual weight across columns. Headings don't leave one orphan word on a line. Floating or decorative bits never cover content.
8. **Both themes.** The app works in light and dark; the landing page is light only.
9. **Reduced motion.** Every animation has a `prefers-reduced-motion` fallback.

## Checking it

- Look at it in the browser at phone and desktop widths, and go through the interaction: open, switch, close, resize.
- The Browser pane pauses animations, `ResizeObserver` and `requestAnimationFrame` while it's hidden. When that happens, check the logic in code and say plainly what couldn't be watched.
- Hunt for the details nobody asked about: the closing animation, the empty state, the long name that wraps, the phone layout. Fix them without being asked.

## Words

- No em dashes.
- Plain, specific copy.
- Screens answer "what do I need to do now?". No counts nobody acts on.
- In the app, the work is called Projects (or Clients, per company), and outside people are Guests.
