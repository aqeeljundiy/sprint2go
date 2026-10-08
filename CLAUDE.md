# Sprint2go: how we build UI

Every change has to pass this bar before it's called done. It isn't optional polish: a screen that works but feels clunky is not finished.

## The bar

1. **Animated, both ways.** Things appear and disappear with motion, never a hard cut.
   - Overlays (dialogs, drawers, sheets, menus, popovers, toasts): entrance animation in CSS. The exit comes from `src/exitAnimations.ts`; add any new overlay class to its `LEAVING` list and give it an `.is-leaving` rule in `polish.css`.
   - Tabs and steps: wrap the switching content in `<TabPane key={tab}>`. Anything whose height changes (dialog bodies, steps, sections that open) goes in `<SmoothHeight>` (`src/components/ui/Smooth.tsx`). Every `.modal-body` already has it.
   - State changes (selected, on/off, hover, expanded): transition color, background, border, transform, 150 to 250 ms.
   - Lists: new rows fade or slide in; removed rows collapse rather than vanish (see `.task.leaving`, `.un-row.leaving`).
   - Tab bars and segmented controls: `src/slidingTabs.ts` gives every `.segmented`, `.client-tabs`, `.chan-tabs` and `.cs-tabs` a highlight that slides. A new kind of tab bar goes in its `BARS` list.
   - Sections that fold open and closed: `.fold` / `.fold.open` (grid rows), with one chevron that turns (`.rot-chev`).
   - Gotcha: in a `MutationObserver` loop, only call `classList.add` or `remove` when the class actually changes. It records a mutation even when nothing changes, and that froze the app once.
2. **Smooth, no jumps.** Nothing resizes or shifts abruptly.
   - Tabbed areas keep one height (stack the panels) or animate it.
   - Reserve space for things that load. Hover and selected states must not change size (no bold-on-select width shifts, no borders appearing without space for them).
3. **Fast.** Enter 150 to 300 ms with ease-out; exit 150 to 200 ms with ease-in. Motion never makes anyone wait for their next click.
4. **Calm.** Nothing moves by itself: no loops, auto-advancing carousels or tours, or bobbing decorations. The exception is live status (a recording dot, a progress bar). Motion answers what the person did.
5. **Clean.** Spacing on a 4/8 px scale, consistent radii, one primary action per area, aligned edges and baselines. **No box inside a box**: inside a bordered card or list, rows and controls have no border of their own (use a divider line, a hover background or plain spacing). A dropdown inside a form row is a plain field, not a framed button inside a frame. Centered things are actually centered: check for class clashes like the old `.sel`, which is the Select component's class.
6. **Responsive.** Check at 375, 768, 1024 and 1440 px wide.
   - No horizontal scroll, and tap targets of at least 40 px on phones.
   - Popovers become bottom sheets on phones.
   - Panes react to their own width (container queries), not just the window's.
7. **Balanced.** Even visual weight across columns. Headings don't leave one orphan word on a line. Floating or decorative bits never cover content.
8. **Both themes.** The app works in light and dark; the landing page is light only.
9. **Reduced motion.** Every animation has a `prefers-reduced-motion` fallback.

## Shared pieces (use these, don't make new versions)

- People: `PersonCell` and `Badge` (src/components/ui/Person.tsx). Avatar centred next to name and email; badges are pills on the name's line.
- Empty lists and screens: `EmptyState` (src/components/ui/EmptyState.tsx), with a compact form inside cards.
- A dialog opened from inside a pane: `Layer` (src/components/ui/Layer.tsx) puts it at page level so nothing traps it.
- Rows that leave: `useLeaving` (src/components/ui/Smooth.tsx). Times: `TimePicker` next to `DatePicker`.
- The shared styles for all of these live in src/system.css, loaded last.

## Which surface

Pick the surface by what the person is doing, not by habit. Not everything is a side panel.

- **Side panel** (`.drawer`): one item, looked at or edited next to the list it came from (a task, a table row). One at a time: every side panel calls `useOnePanel(onClose)` (`src/onePanel.ts`), so opening one closes the other.
- **Dialog** (`.modal`): a focused job with a start and an end (new table, share, import, delete). **Large dialog** (`.modal.big-modal` with `.big-nav` sections on the left): setup that has several parts (Automations). Anything with steps, options and conditions (a button's actions) gets a dialog, never a crammed popover.
- **Popover** (`Popover`): a quick pick or a few settings next to what was clicked (a column's menu, a filter, a date). Becomes a bottom sheet on phones.
- **Docked panel**: a companion you keep open while working (Ask AI), bottom-right, no scrim, can shrink to a pill.
- **Toast**: what just happened, with Undo when it can be undone.
- Stacking order is fixed by tokens in `styles.css`: page < `--z-panel` < `--z-dialog` < `--z-pop` < `--z-toast`. Never hard-code a z-index above 10 for an overlay.
- Nothing that holds a fixed overlay (a pane, a screen) may keep a `transform`, `filter` or `container-type`: they trap `position: fixed` children inside the pane. Put `container-type` on the inner element that needs it, and use `animation-fill-mode: backwards` for entrance animations.
- Our own dropdowns everywhere (`Select`, `PickSelect`, `PeoplePicker`, `DatePicker`), never a native `<select>` or date input.

## Checking it

- Look at it in the browser at phone and desktop widths, and go through the interaction: open, switch, close, resize.
- The Browser pane pauses animations, `ResizeObserver` and `requestAnimationFrame` while it's hidden. When that happens, check the logic in code and say plainly what couldn't be watched.
- Hunt for the details nobody asked about: the closing animation, the empty state, the long name that wraps, the phone layout. Fix them without being asked.

## Words

- No em dashes.
- Plain, specific copy.
- Screens answer "what do I need to do now?". No counts nobody acts on.
- In the app, the work is called Projects (or Clients, per company), and outside people are Guests.
