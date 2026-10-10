# The phone kit: how to build a screen for phones

For the Wave 2 builders (one per app). Phase 0 of `docs/mobile-plan.md` is in: the phone shell, the touch pieces and one
phone CSS layer. This page says how to use them. CLAUDE.md's bar still applies to everything here.

## 0. The system (read first)

One set of values for every phone screen (approved 10 Oct 2026; research/mobile/consistency/audit.md). Tokens live in
`src/tokens.css` only; the shared roles (icons, top bar, pushed screens, section headers, segmented controls, badges,
buttons, empty states) are in `src/mobile/system.css`, loaded last. `node scripts/ui-tokens-check.mjs` (in CI) fails on
any size in the phone layer that isn't a token or an allowed value; a real exception says why on its line:
`/* system: <reason> */`. `research/mobile/consistency/measure.mjs` re-measures the 44 screens and lists what's off.

| Role | Token | Size / weight | Use |
|---|---|---|---|
| Display | `--t-display` | 24/30, 700 | the root screen's title in the top bar, an item's title on its own screen |
| Title | `--t-title` | 17/22, 600 | pushed screen, sheet and dialog titles |
| Heading | `--t-heading` | 15/20, 600 | section headers (sentence case, primary), unread row titles |
| Body | `--t-body`, `--t-para` | 15/20 (22 in paragraphs), 400 | row titles, messages, values |
| Label | `--t-label` | 15/20, 600 | buttons and text buttons |
| Secondary | `--t-secondary`, `--t-segment` | 13/18, 400 (600 for segmented) | second lines, hints, footers |
| Caption | `--t-caption`, `--t-chip` | 12/16, 400 for times, 600 for chips, badges, tab labels | |
| Field | `--t-field` | 16, 400 | every input (iPhone zooms under 16) |

- **Spacing**: 4, 8, 12, 16, 24, 32, 48 only. `--gutter` 16 on every screen; cards at 16 from the edge with their rows'
  text at 32; 24 above a section header and 8 below it; 12 from a leading picture to its text; lists end with
  `var(--fab-space)`.
- **Rows**: `--row-compact` 44 (one line, no picture or a 20 icon), `--row-1` 48 (one line with a 32 picture or a value),
  `--row-2` 64 (two lines, 40 picture), `--row-3` 80 (three lines). A wrapped title may grow a row, nothing shrinks it.
- **Dividers**: 1 px `var(--line)` from the row's text to the right edge, none after the last row, none in message
  streams, schedules or card layouts. Bars get a line only when content scrolls under them.
- **Shapes**: `--r-tile` 10 (tiles, thumbnails, events, framed fields), `--r-card` 16 (cards, sheets, drawers),
  `--r-pill` for anything you press (buttons, chips, segmented, search, tags, the create button), `--r-round` for
  people and dots. Cards only for grouped lists and real objects (note cards, board cards, the brief in a task).
- **Icons and pictures**: icons 16 inline, 20 in rows, 24 in bars (Lucide's `size` is snapped by `system.css`);
  avatars and company logos 24, 32, 40, 56 (`Avatar` and `WorkspaceLogo` snap on phones).
- **Top bar**: 52 px, the page's colour (white for Mail, Chat, Drive, Calendar, Meet; grey for grouped screens). A main
  screen: the square company logo (no badge), its title at 24/700, up to two 24 icons. A sub-screen: the back arrow
  alone and its name at 17/600 (`<TopBarBack />` and `<h1 className="mt-title plain small">`). A sheet: 17/600 and X.
  No large title rows: the title is the bar's.
- **One accent**: the company colour only on the create button, primary buttons, selected states, links and text
  buttons, the unread dot, focus rings and switches that are on. As text it is `var(--accent-text)` (worked out per
  company to read at 4.5:1). Icons are `--text-2`, never accent. Red, amber and green mean late, waiting and done; a
  project's or calendar's colour is a dot or a fill, never text. Badges carry a number or a word, never a dot alone.
- **Switches under the bar**: an app with parts uses one segmented control under the bar (Chat: Home, DMs, Activity;
  Tasks: Today, Upcoming, My tasks, Browse). Chips are 32 tall pills that wrap; nothing runs off the edge.

## 1. Where phone CSS goes

`src/mobile/` is loaded last, after `src/system.css` (`src/mobile/index.css` imports the files in order). A rule there
wins over the old ones with the same selector, so it never needs `!important`.

| File | Owner |
|---|---|
| `kit.css` | the touch pieces below (Phase 0) |
| `shell.css` | top bar, each app's bottom bar, create button, search, keyboard, device basics (Phase 0) |
| `launcher.css` | the launcher, the launcher button, Edit apps, each app's colour (research/launcher/plan.md) |
| `home.css` | Home |
| `tasks.css` | Tasks |
| `chat.css` | Chat |
| `mail.css` | Mail |
| `calendar.css` | Calendar |
| `notes.css` | Notes |
| `tables.css` | Tables |
| `system.css` | the system's shared roles (section 0), loaded last: change it for every app at once |
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
- `var(--fab-space)`: 88 px on every phone, the room a list keeps at its end so its last row scrolls clear of the
  floating create button. Add it to the bottom padding of your list's scroll area if it's not one of `.rows`,
  `.home-scroll`, `.drive-scroll`, `.tracking-scroll`, `.mobile-list`.

## 3. The shell: what your app tells it

The shell (10 Oct 2026; the launcher from research/launcher/plan.md) copies Teams, Gojek and Gmail:

- **Launcher** (`/` on phones, `src/mobile/Launcher.tsx`): the company, search, Ask AI, the bell and you on top; three
  rows of Needs you with "See all" (the full Home at `/home`); "Continue where you left off"; then the person's apps in
  four columns with counts for what's theirs. Long-press a tile: Open, New…, Hide, Edit apps. Its + opens New (Brain
  dump first). Edit apps (`EditApps.tsx`) arranges and hides; admins set the company's order in Settings, Apps on
  phones (`BarDefaults.tsx`, kept in `tabDefaults.bar` and `bar:<team id>`).
- **The app's own bottom bar** (`AppBar`): 56 px plus the home bar, the app's two to four sections, labelled, a pill
  that slides between them, counts per section. An app registers it with `useAppSections` (below); Tables, Vault and
  Settings have none. The URL carries the section (`/tasks/upcoming`) and the thing open (`/tasks/upcoming/<id>`),
  `src/route.ts`; Back walks pushed screens, sections, then the launcher.
- **Launcher button**: top left in every app (where the logo was), with a red dot when another app has something new;
  a swipe from the left edge on a section's first screen does the same.
- **Create button**: floats 16 px above the bar at the right, 56 px, owned by the app on screen (below).
- **Top bar**: one row, 52 px plus the status bar: the company logo with your avatar on its corner (you, your status,
  your companies with a tick on this one, Add a company, Settings), the title (24/700), search. No line under it until
  the content scrolls under it. An app can take over parts of it (below).
- **Toasts** sit at the bottom, above the bar and above the create button when it shows; never over the top bar or a
  sheet's header. Quiet ones (`quiet: true`) last 4 s.
- **Notifications**: Home's Needs you and Updates, and "All notifications" opens a full screen (All, Unread, Mentions).

All the hooks are in `src/mobile/chrome.ts`, the components in `src/mobile/TopBar.tsx`. Call them in your app's own
component, before any early `return`. Registrations last while the component is mounted; the shell shows the ones for
the app on screen. Apps that register nothing keep the default bar and no create button.

**Create button**:

```tsx
useCreateAction('tasks', canAdd && { label: t('New task'), icon: Plus, run: openQuickAdd, more: [{ label: t('Brain dump'), icon: Sparkles, run: dump }] });
useCreateAction('mail', { label: t('Compose'), icon: PenLine, run: compose, extended: true });   // Gmail's Compose
useCreateAction('mail', { …, hidden: selecting });                                               // out of sight for now
```

Pass `null`/`false` when there's none. Round with the icon by default (Teams, Slack, Things); `extended` shows the
label too and shrinks to the round form while a list scrolls down, growing back on the way up and at the top (Gmail);
`hidden` scales it away without unregistering. `more` is what a long-press (or right-click) offers. It steps aside on
focused screens, with the keyboard and on the launcher. Lists keep `var(--fab-space)` (88 px) at their end. If `run`
must focus a field, focus it during the tap (see TasksView's `openAdd` with `flushSync`): iPhone only opens the keyboard
for focus given in the tap itself.

**The top bar's parts** (`<TopBar>`): render it anywhere in your app's tree; what it holds stays live with your state.
Parts you leave out keep the default.

```tsx
// Calendar: ☰ and the month instead of the logo and the title, Today after search.
<TopBar app="calendar" lead={<TopBarButton icon={Menu} label={t('Menu')} onClick={openDrawer} />} title={<MonthButton />} actions={<TodayButton />} />
// Mail: the whole row is Gmail's search pill (the shell keeps the safe area, the sticky position and the hairline).
<TopBar app="mail" replace={<MailSearchPill />} />
// A sub-screen (a team's tasks, a table): the back arrow alone and its name at 17/600.
<TopBar app="tasks" lead={<TopBarBack onClick={toBrowse} />} title={<h1 className="mt-title plain small"><span className="mt-title-text">{name}</span></h1>} />
```

`lead` replaces the logo (or a focused screen's Back), `title` the title, `actions` sit before search, `search={false}`
drops search, `replace` takes the whole row. `TopBarButton` (a 44 px icon button) and `TopBarBack` (the chevron, with
or without the screen's name) are ready-made parts. The company sheet stays reachable: put it in your drawer's header
(Calendar) or behind your own avatar (Mail's pill) with the shell's `CompanySheet` (`src/components/MobileTop.tsx`).

**No large titles.** A screen's title is the bar's (24/700 on a main screen, 17/600 on a sub-screen); Home's bar says
the greeting. `LargeTitle` is gone.

**Worked example, Tasks** (Todoist's lists on the system): Today, Upcoming, My tasks and Browse sit in one switch under
the bar (`TasksSwitch` in TasksView), with the bar's own logo and "Tasks". Browse (`TasksBrowse`) is grouped cards;
anything opened from it (a team, a project, Assigned by me) is a sub-screen with `<TopBarBack />` and its name. Tapping
Tasks in the bar again opens Browse (App's `onApp`). The same Browse shows the Projects app's list on phones.

**A left drawer**: Mail opens the desktop `Sidebar` as a drawer with `useSidebarDrawer(phone)` and App's `sidebarOpen`
(the shell gives `.sidebar.open` the drawer look, scrim and motion on phones only while this is on). Any other app uses
`SideDrawer` and `useEdgeSwipe` (section 4).

**Title switcher** (the screen title, with a chevron, opens a sheet). For apps that haven't moved to a drawer or their
own title yet:

```tsx
useTitleMenu('calendar', { label: 'Calendars', value: view, options: [{ value: 'week', label: 'Week', group: 'View' }, …], onChange: setView });
```

Options are the `Select` options (`group`, `hint`, `icon`). More than 10 get a search field. Meet, Projects and Drive
still get theirs from `mobileSwitcher` in `App.tsx`; a registered menu wins over it. Home has none.

**Settings at the bottom of the title switcher** (opened full screen over the app; Back returns to it):

```tsx
useAppSettings('tasks', { id: 'swipes', label: 'Swipe actions', hint: 'What a swipe right and left do', render: () => <SwipeSettings /> });
```

The company sections an app has (`appSettingsLinks` in `AppSettings.tsx`) are listed there already. An app that drops
its title switcher puts these in its drawer's or its "…" menu's Settings row instead.

**Focused screens** (a mail, a channel, a note, a record, a project): the tab bar and create button step aside.

```tsx
useFocusedScreen(open);                    // the screen has its own Back
useFocusedScreen(open, () => close());     // no Back of its own: one appears in the top bar, where the logo was
```

Wired today: mail reader (App.tsx), chat channel (ChatView), note editor (NoteEditor), table record (RecordDrawer),
project page (App.tsx, with Back), and every PushScreen.

**Badges**: only what's yours to act on (`badgeOf` in App.tsx): unread mail, Chat's direct messages and mentions, your
tasks due today or late, table replies for you. The launcher's tiles and each app's sections show them; Meet's tile gets
a green dot while the notetaker is live.

**Sections** (each app's own bar):

```tsx
useAppSections('tasks', { sections: [{ id: 'today', label: t('Today'), icon: Sun, badge: due }, …], current, onChange, onReselect });
```

Section ids are the URL's (`SECTIONS` in `src/route.ts`); a section with `run` acts instead (Search).

**Toasts with two actions**: `toast({ text, action, also })` shows a second button (Quick Add's Undo and Open).

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
title row (a Done button). `aboveBar` keeps the tab bar showing under it. Lists inside use `.as-list` /
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

A new `group` starts after a divider; keep Delete last. `header` puts something above the list (a row of reactions). `className` goes on the phone's sheet (Tasks' `task-menu` puts each value on the right of its action, one line each).

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

`iconBack` makes Back Gmail's arrow alone (the mail reader, Notifications); `backLabel` is then only read out.
`cancel` puts "Cancel" in words where Back was (an edit screen).

**Settings rows (iOS Settings)**: `src/components/ui/Grouped.tsx`. On phones a setting is a row with its value on the
right; text opens a screen of its own with Cancel and Save, a choice opens a sheet with a tick, a thing in a list (a
member, a mailbox, a stage) opens its own `PushScreen` with what can be done to it, and a setup with steps is a pushed
screen too. Desktop keeps its forms (branch on `usePhone()`).

```tsx
<Group title={t('Invoice details')} footer={t('PPN is shown on every invoice.')}>
  <TextRow label={t('Company name')} value={b.company} allowEmpty={false} onSave={(v) => save({ company: v })} />
  <ChoiceRow label={t('Who can record')} value={m.who} options={[…]} onChange={(v) => set({ who: v })} />
  <SwitchRow label={t('Announce recording')} on={m.announce} onChange={(v) => set({ announce: v })} />
  <GRow label={t('Remove account')} danger onClick={remove} />
</Group>
```

`TextRow` takes `validate`, `multiline`, `inputMode`, `shown` (what the row shows when it isn't the value) and
`footer`; `EditScreen` with `GField`s is the same screen for several fields (a password, a key); `onSave` returns an
error to keep the screen open with it. `ChoiceSheet` is the sheet alone (one model for every job, a project to add).

**SideDrawer**: a modal drawer from the left (Gmail's folders, Google Calendar's views and calendars): over a dimmed page
and the bar, closed by a tap on the page, Escape or a swipe to the left that follows the finger; it slides out on close.
Open it from the top bar's left button and, on a list, with a swipe in from the left edge.

```tsx
const [drawer, setDrawer] = useState(false);
useEdgeSwipe(() => setDrawer(true), !readerOpen);   // not where the edge swipe means Back
<TopBar app="calendar" lead={<TopBarButton icon={Menu} label={t('Menu')} onClick={() => setDrawer(true)} />} />
{drawer && <SideDrawer label={t('Calendars')} onClose={() => setDrawer(false)}>…</SideDrawer>}
```

Rows inside: 48 px, icon in a 56 px column, the current one on an `--accent-soft` pill (see the Mail and Calendar specs).

**Dropdown menus on phones**: actions open as a sheet on phones, except a short overflow list from a button (Gmail's
"⋮" in the reader): `useActionMenu(actions, { menu: true })` and `menu.openFrom(button)` drop a menu by the button,
right-aligned. `<Popover menu>` does the same for a popover. Long-press still opens the sheet.

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
by its group (`GROUP_APP`), or set `app` on it. On phones it's Gmail's search: Back on the left, a short placeholder
("Search", "Search Mail"), recent searches and recently opened before typing (no create actions: each app has its own
button), 56 px rows with a second line, and no highlight on the first row. Pulling a list down from its top opens the
same search (`usePullToSearch`, lists: `.mobile-list`, `.home-scroll`, `.tracking-scroll`, `.drive-scroll`,
`.meet-list`; Mail's list pulls to refresh instead). An app with its own search screen (Mail's) can open it from its
own top bar and call the shared one only for "All apps".

## 6. Things that bit us

- The click that ends a long-press lands on whatever is now under the finger. Sheets ignore it (they only close for a
  tap that started on the dimmed page); anything else you open from a long-press must do the same.
- Hooks before early returns (several screens return early for empty states).
- `useFocusedScreen` and `useCreateAction` work on desktop too but change nothing there; don't wrap them in `isPhone()`.
- The browser pane and headless browsers have no on-screen keyboard: test `--kb` by redefining `visualViewport.height`
  in the page and firing its `resize` event while a field has focus, and on a real phone.
- Tap and long-press need a touch device to test: Chrome's device mode or Playwright with `hasTouch`, sending
  `Input.dispatchTouchEvent` through CDP for swipes.
