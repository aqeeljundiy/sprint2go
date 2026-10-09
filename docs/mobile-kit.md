# The phone kit: how to build a screen for phones

For the Wave 2 builders (one per app). Phase 0 of `docs/mobile-plan.md` is in: the phone shell, the touch pieces and one
phone CSS layer. This page says how to use them. CLAUDE.md's bar still applies to everything here.

## 1. Where phone CSS goes

`src/mobile/` is loaded last, after `src/system.css` (`src/mobile/index.css` imports the files in order). A rule there
wins over the old ones with the same selector, so it never needs `!important`.

| File | Owner |
|---|---|
| `kit.css` | the touch pieces below (Phase 0) |
| `shell.css` | top bar, bottom bar, create button, More, search, keyboard, device basics (Phase 0) |
| `home.css` | Home |
| `tasks.css` | Tasks |
| `chat.css` | Chat |
| `mail.css` | Mail |
| `calendar.css` | Calendar |
| `notes.css` | Notes |
| `tables.css` | Tables |
| `settings.css`, `projects.css`, `meet.css`, `drive.css`, `misc.css` | Everything else (Settings, Projects, Meet, Drive; onboarding, guest portal, Teams, Vault, demo bar in `misc.css`) |

- Only edit your own file. If you need something in `shell.css` or `kit.css`, say so in your report instead.
- As you redo a screen, move its old phone rules (the `@media (max-width: 767px)` blocks in `src/*.css`) into your file
  and delete them where they were, together with any `!important` they needed.
- Breakpoints: phones `@media (max-width: 767px)`, narrow phones `(max-width: 599px)`, tiny phones `(max-width: 359px)`.
  Tablets (768 and up) get the left rail; list and detail sit side by side from 1024. In code: `PHONE`, `NARROW`, `TINY`,
  `TABLET`, `usePhone()`, `useMedia()` and `isPhone()` from `src/mobile/media.ts`. Don't write `760` or `768` by hand.
- A pane that changes with its own width uses `@container` on an inner wrapper, never on the pane: `container-type`,
  `transform` and `filter` trap `position: fixed` children (sheets, dialogs) inside it.

## 2. Device basics (already on, every screen)

- Safe areas work (`viewport-fit=cover`). Use `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` for anything
  you pin to an edge.
- Fields are 16 px on phones (no iPhone zoom), by one rule in `shell.css`. Nothing to do.
- Tap targets: `var(--tap)` is 44 px. Buttons, icon buttons and pickers already have it; give your own rows and controls
  `min-height: var(--tap)` (rows about 48 px).
- Labels at least 12 px on phones. The old small labels are raised in `shell.css`; new text starts at 12 px.
- `var(--bar-space)`: how much of the bottom the tab bar takes right now (bar plus home bar; just the home bar on a
  focused screen; the keyboard's height while typing). `.app` already keeps it free. Use it for anything you fix to the
  bottom of the screen (a docked pill, a toast, a bulk bar): `bottom: calc(var(--bar-space) + 12px)`.
- `var(--fab-space)`: 0, or 72 px on tiny phones where the create button floats. Add it to the bottom padding of your
  list's scroll area if it's not one of `.rows`, `.home-scroll`, `.drive-scroll`, `.tracking-scroll`, `.mobile-list`.

## 3. The shell: what your app tells it

All from `src/mobile/chrome.ts`. Call them in your app's own component, before any early `return`. Registrations last
while the component is mounted; the shell shows the ones for the app on screen.

**Create button** (round, at the end of the bar row; it hides on focused screens and while typing):

```tsx
useCreateAction('tasks', canAdd && { label: 'New task', icon: Plus, run: openQuickAdd, more: [{ label: 'Brain dump', icon: Sparkles, run: dump }] });
```

Pass `null`/`false` when there's none. `more` is what a long-press (or right-click) on the button offers. Every app
already registers one (Home Brain dump, Mail Compose, Chat New message, Tasks New task, Calendar New event, Drive Upload,
Notes New note, Projects New project, Tables New table, Meet Send the notetaker); change yours freely. If `run` must
focus a field, focus it during the tap (see TasksView's `openAdd` with `flushSync`): iPhone only opens the keyboard for
focus given in the tap itself.

**Title switcher** (the screen title, with a chevron, opens a sheet):

```tsx
useTitleMenu('calendar', { label: 'Calendars', value: view, options: [{ value: 'week', label: 'Week', group: 'View' }, …], onChange: setView });
```

Options are the `Select` options (`group`, `hint`, `icon`). More than 10 get a search field. Mail, Tasks, Meet,
Projects and Drive still get theirs from `mobileSwitcher` in `App.tsx`; a registered menu wins over it, so move yours
into your app when you redo the switcher.

**Settings at the bottom of the title switcher** (opened full screen over the app; Back returns to it):

```tsx
useAppSettings('tasks', { id: 'swipes', label: 'Swipe actions', hint: 'What a swipe right and left do', render: () => <SwipeSettings /> });
```

The company sections an app has (`appSettingsLinks` in `AppSettings.tsx`: Mail's Email delivery and Mail & signature,
Task stages…) are listed there already and open the same Settings section over the app.

**Focused screens** (a mail, a channel, a note, a record, a project): the tab bar and create button step aside.

```tsx
useFocusedScreen(open);                    // the screen has its own Back
useFocusedScreen(open, () => close());     // no Back of its own: one appears in the top bar, where the logo was
```

Wired today: mail reader (App.tsx), chat channel (ChatView), note editor (NoteEditor), table record (RecordDrawer),
project page (App.tsx, with Back), and every PushScreen.

**Badges**: Home, Mail and Chat (`barBadge` in App.tsx). Home counts unread notifications for now; the Home builder
replaces it with the "Needs you" count. Chat counts direct messages and mentions. More's grid shows the same counts and a
green dot with a word when something is live (Meet: Recording).

**More's "Notifications" row** is there until Home folds the bell's contents in (the bell is gone from the phone's top
bar; the guest portal keeps its own).

## 4. The touch pieces

All in `src/components/ui/`. Styles in `src/mobile/kit.css`; their closing animations are registered in
`src/exitAnimations.ts` with `.is-leaving` rules in `polish.css`.

**Sheet**: bottom sheet with grab handle and title; swipe it down (from the handle, the title, or the content when it's
scrolled to the top), tap the dimmed page or press Escape to close. Rides above the keyboard. A centred panel from 768 px.

```tsx
{open && (
  <Sheet title="Snooze" onClose={() => setOpen(false)} footer={<button className="primary-btn">Save</button>}>…</Sheet>
)}
```

`size`: `auto` (fits its content), `tall` (two thirds at least, for lists with search), `full`. `head` adds things to the
title row (a Done button). `aboveBar` keeps the tab bar showing under it (More uses it). Lists inside use `.as-list` /
`.as-item` rows (48 px) and `.sheet-search` for a search field.

**ActionSheet and useActionMenu**: one list of actions; a sheet on phones, a menu by the button or the pointer on desktop.
Long-press on phones and right-click or "…" on desktop open the same list.

```tsx
const menu = useActionMenu(() => [
  { label: 'Pin', icon: Pin, run: pin },
  { label: 'Delete', icon: Trash2, danger: true, group: 'end', run: remove },
], { title: note.title });
<div className="note-row lp" {...menu.bind}>…<button ref={dots} onClick={() => menu.openFrom(dots)}><MoreHorizontal /></button></div>
{menu.menu}
```

A new `group` starts after a divider; keep Delete last. `header` puts something above the list (a row of reactions).

**SwipeRow**: up to two actions per side; past 72 px the first is armed (its colour fills, the phone ticks), past 55% of
the row the second. A vertical move always scrolls; mouse does nothing (give the same actions a menu).

```tsx
const rows = useLeaving(threads, (t) => t.id);
rows.map(({ item, leaving }) => (
  <SwipeRow key={item.id} leaving={leaving}
    start={[{ id: 'done', label: 'Done', icon: Check, tone: 'ok', removes: true, done: 'Marked done', run: () => { markDone(item); return () => undo(item); } }]}
    end={[{ id: 'snooze', label: 'Snooze', icon: Clock, tone: 'warn', run: () => openSnooze(item) }]}>
    <ThreadRow t={item} />
  </SwipeRow>
))
```

`start` sits on the left (swipe right), `end` on the right. Return an undo function from `run` for an Undo toast.
`removes` slides the row out before `run`; render the list with `useLeaving` so it then folds away. The row face has
the surface background; give it your row's own background with `className` if it differs.

**useLongPress**: hold 350 ms without moving; the element gets `.lp-lifted`, the phone ticks, the following click is
swallowed. Give the element the `lp` class (no text selection or callout). With `onDrag`/`onDragEnd`, keep the finger down
and move to drag; the page doesn't scroll meanwhile.

```tsx
const press = useLongPress(() => startMove(card.id), { onDrag: (p) => moveBy(p.dy), onDragEnd: drop });
<div className="card lp" {...press}>…</div>
```

`EditBar` (`src/mobile/EditBar.tsx`) is a worked example of hold-then-drag with a list that makes room as you move.

**PushScreen**: full screen over the current one, with Back, swipe from the left edge to go back, slides in and out.
The tab bar steps aside while it's open.

```tsx
{details && <PushScreen title="Channel details" onBack={() => setDetails(false)} actions={<button className="icon-btn">…</button>}>…</PushScreen>}
```

`footer` is the screen's own bottom bar (it rides above the keyboard). Phones only: on desktop keep side panels and
dialogs.

**Keyboard**: `useKeyboard()` from `src/mobile/keyboard.ts` gives `{ open, inset }`. CSS gets `var(--kb)` and the
`.kb-open` class on `<html>`. Fixed composers and send bars use `bottom: var(--kb)` or `padding-bottom: var(--kb)`.
Sheets, dialogs, Compose and search already ride above it; the tab bar hides while it's open.

**Toasts from anywhere**: `toast({ text, action })` and `toastUndo(text, undo)` from `src/toast.ts` show the app's own
toast (App.tsx listens). Use them in shared pieces that aren't handed `showToast`.

## 5. Search

The top bar's search opens scoped to the app on screen (`SEARCHABLE` in `CommandPalette.tsx`) with an "All apps" chip;
People, Projects, Files and Notes chips narrow by kind. Results are grouped by app. A `PaletteItem` belongs to an app
by its group (`GROUP_APP`), or set `app` on it. Pulling a list down from its top opens the same search
(`usePullToSearch`, lists: `.mobile-list`, `.home-scroll`, `.tracking-scroll`, `.drive-scroll`, `.meet-list`; Mail's list
pulls to refresh instead).

## 6. Things that bit us

- The click that ends a long-press lands on whatever is now under the finger. Sheets ignore it (they only close for a
  tap that started on the dimmed page); anything else you open from a long-press must do the same.
- Hooks before early returns (several screens return early for empty states).
- `useFocusedScreen` and `useCreateAction` work on desktop too but change nothing there; don't wrap them in `isPhone()`.
- The browser pane and headless browsers have no on-screen keyboard: test `--kb` by redefining `visualViewport.height`
  in the page and firing its `resize` event while a field has focus, and on a real phone.
- Tap and long-press need a touch device to test: Chrome's device mode or Playwright with `hasTouch`, sending
  `Input.dispatchTouchEvent` through CDP for swipes.
