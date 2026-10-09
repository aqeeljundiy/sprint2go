# sprint2go on phones: the plan

9 Oct 2026. Built from seven research reports in `research/mobile/` (Slack, calendars, Notion databases, note apps, Todoist and task apps, mail apps and suites, and a phone audit of sprint2go with 157 issues). Nothing here is built yet. Audit issue numbers (G1, 15.1 and so on) point to `research/mobile/sprint2go-audit/audit.md`.

## What we're aiming for

People open a work app on their phone 15 to 20 times a day for 20 to 30 seconds (Slack's own numbers). So the phone app is built for **one job per visit**: see what needs me, answer it, move on. It is not a smaller desktop.

Seven rules every phone screen follows:

1. **Push, don't squeeze.** A list, then the item full screen with Back. No side panels, no sidebars, no 7-column grids at 375 px.
2. **Long-press replaces hover and right-click.** Every hover toolbar, right-click menu and drag has a touch path: long-press opens a menu, long-press then move drags.
3. **Swipes on rows, always with Undo.** Two actions per row at most, the same ones in every app where it makes sense.
4. **One create button per app, docked beside the tab bar.** It never covers content and always does the app's main job.
5. **The bottom belongs to the job.** On focused screens (a mail, a channel, a note, a record) the tab bar steps aside and the screen's own actions take the bottom.
6. **Phones run things, desktops set them up.** Automations, booking pages, calendar connections and the operator console stay desktop work. But anything you can edit on desktop stays editable on a phone.
7. **Built for thumbs.** 44 px tap targets, 16 px text in fields (so iPhone doesn't zoom), safe areas, the keyboard never covers Send.

Desktop keeps working as it does now. Several steps also improve desktop (previous/next on records, personal filters, Assign and comments in mail).

---

## Phase 0. Foundations (everything else stands on this)

The audit found the phone layout spread over 57 separate `@media` blocks in 17 CSS files, fighting each other with `!important`, and only 21 container queries. Each screen behaves differently because of that. Fixing screens one by one on top of it would keep breaking.

**0.1 Device basics** (fixes G7, G12, G15, part of G6)
- `viewport-fit=cover` in `index.html`, so the ~30 safe-area paddings actually work and the tab bar clears the iPhone home bar in the installed app. Status bar style for the installed app.
- Every field 16 px on phones (no zoom on focus).
- Tap targets 44 px on phones (up from 40). Rows about 48 px.
- Labels at least 12 px on phones.

**0.2 The keyboard** (fixes G11, 7.1)
- One `useKeyboard` hook reading `visualViewport`, giving a `--kb` inset. Composers, sheets and Send ride above the keyboard. The tab bar and create button hide while it's open.

**0.3 One phone layer**
- A new `mobile.css`, loaded last, owns phone layout. As each screen is redone in later phases, its old phone rules move there and the `!important` fights are deleted.
- Panes react to their own width (container queries), as CLAUDE.md already asks.
- One phone breakpoint (768 px) plus one narrow one (600 px) instead of nine.

**0.4 Touch pieces, shared** (added to CLAUDE.md's shared pieces)
- `useLongPress`: 350 ms hold without moving, a small lift, a haptic tick where the phone supports it. A plain touch-move always scrolls.
- `SwipeRow`: up to two actions per side, chosen per app, with an Undo toast.
- `ActionSheet`: the long-press menu on phones and the right-click / "..." menu on desktop, from one list of actions.
- `Sheet`: bottom sheet with grab handle, swipe down to close, animated in and out, reduced-motion fallback.
- `PushScreen`: full-screen push with Back and edge-swipe back.

**0.5 The shell** (fixes G1, G2, G3, G9, G13, 3.1, 3.3)
- **Bottom bar:** Home, Mail, Chat, Tasks, More, always labelled. Badges on Home (needs you), Mail (unread), Chat (unread DMs and mentions). People can still change their four.
- **Create button** docked at the right end of the bar row, a round button next to the tab pill. It runs the current app's main action: Brain dump on Home, Compose in Mail, New message in Chat, New task in Tasks, New event in Calendar, Upload in Drive, New note in Notes. It hides in readers, threads and while typing. Below 360 px it becomes a floating button and lists reserve space under it.
- **Top bar, one row:** company logo (switcher, with unread counts per company), the screen title as a switcher (mailbox in Mail, scope in Tasks, channel group in Chat, calendars in Calendar), and search. The app's settings move to the bottom of the title switcher, so a gear no longer throws you into global Settings. The bell moves into Home on phones.
- **More sheet:** "Search or jump to an app, project or person" on top, a New row (Email, Message, Task, Event, Note, Upload), the app grid (Calendar, Projects, Meet, Drive, Notes, Tables, Teams, Vault) with live badges (a meeting on now), Recent (last five projects, notes, tables), then Ask AI, Edit the bar, Account and settings.
- **Edit the bar:** a drag list with a live preview of the bar, also opened by long-pressing the bar. Admins can set a default bar per team in Settings.
- **Focused screens hide the tab bar:** mail reader and reply, chat channel and thread, note editor, record page, project page. Their own actions take the bottom.
- **Install prompt:** no longer 4 seconds after load; offered after a second visit or after someone finishes a task.
- **Tablets (768 px and up):** the existing left rail with the same four pinned on top. List and detail side by side from 1024 px.

**0.6 Search** (top of every app)
- Opens scoped to the current app with an "All apps" chip one tap away. Before typing: recents and chips (People, Projects, Files, Notes). Results grouped by app. Pull down on a list as a shortcut.

---

## Phase 1. Home becomes "Needs you"

(fixes 4.2, 4.3, lesson 2 of the navigation research)

- **Up next strip** at the top when a meeting starts within 30 minutes: title, "in 12 min", Join, notetaker on or off. Gone 5 minutes after it starts.
- **Live call banner** when a huddle is running in one of your channels, with who's in it.
- **Needs you list:** mentions, tasks assigned to you, guest replies, approvals waiting on you, overdue tasks, mail waiting for your reply. Each row has its one action (Reply, Done, Approve, Remind). This list is what the Home badge counts. The bell's contents fold in here on phones.
- Then today: your tasks due today and today's events.
- First actionable item above the fold at 375 px. Titles wrap to two lines instead of being cut mid-word.
- Customise Home on phones: a list with Move up / Move down and show/hide, not dragging cards.

---

## Phase 2. Tasks (the worst blocker today)

Model: Todoist, with Things 3, TickTick and Linear ideas. Fixes 15.1, 15.2, 14.x, 16.x.

**2.1 Scopes.** The title switcher lists My tasks, Today, Upcoming, Supervising, Assigned by me, each team queue (with "not assigned" counts), each project (with "late" counts), Brain dump, Past projects. The last one used is remembered per device.

**2.2 Rows.** At most three lines: a priority-coloured ring as the checkbox (40 px target), title, one meta line (date in a meaning colour: red overdue, green today, amber tomorrow, purple this week, grey later; repeat, checklist 2/5, comments, stage). Project name in cross-project scopes, assignee avatar in team scopes. Dividers, no boxes.

**2.3 Gestures.** Swipe right completes (Approve in Supervising). Swipe left schedules. Either can be set to None in settings. Long-press menu: Select, Schedule, Move to, Priority, Assign, Duplicate, Copy link, Delete.

**2.4 My tasks opens on what to do now.** Overdue first with one "Reschedule all" action, then Today, then the rest. Later: a guided "Plan my day" that walks overdue tasks one at a time.

**2.5 Upcoming.** A week strip with a dot on busy days (swipe for other weeks, month name opens a month picker), then one continuous day-by-day list, each day with its own Add row. Long-press a day to add a task due that day.

**2.6 Quick Add** (the create button in Tasks):
- A sheet glued to the keyboard that opens with only the title field. Chips appear after the first letter.
- It reads as you type and shows it twice, highlighted in the title and as a chip: `tomorrow 3pm`, `every Monday`, `#project`, `/stage`, `+person`, `p1`, `!reminder`. Tapping a highlight turns it back into plain text.
- After adding, it stays open in the same project and stage for the next task, with a toast offering Undo and Open.
- Long-press the create button for Brain dump (or voice).

**2.7 Task details: a bottom sheet** with grab handle, breadcrumb (Project, Stage), close and "...".
- **Filled fields become rows, empty fields stay as a scrolling row of chips.** Tapping a chip turns it into a row. A new task stays short; a busy one stays readable. (Todoist's best idea.)
- The comment bar is pinned to the bottom and says who will be notified ("Dewi and 2 others will be notified").

**2.8 Board on a phone.** One stage at a time, about 85% of the width with the next one peeking, snapping as you swipe. A strip of stage names with counts to jump. Each column ends with Add task. Cards move by long-press drag, by "Move to" in the long-press menu, or by tapping the stage pill. The List/Board switch is always visible, and the layout is remembered per device so a phone never gets stuck on the desktop's board.

**2.9 Select many.** Long-press, Select, then tap more. A bottom bar replaces the tab bar: Date, Move, Assign, Priority, Complete, Delete.

**2.10 Team queues** borrow Linear's triage: swipe right to take it, swipe left to dismiss, a Snooze sheet that prints the exact time ("Tomorrow, 09:00").

**2.11 Display sheet** per view: List / Board / Calendar as picture cards, Show completed, Group, Sort, Filter (Me, Me and unassigned, Unassigned, people). The icon changes when something is filtered.

---

## Phase 3. Chat

Model: Slack (its 2023 redesign and today), with Teams and Discord ideas. Fixes 9.x to 13.x.

**3.1 The huddle no longer covers the composer.** While in a huddle, a slim bar under the header shows who's talking with mute and leave; tapping it opens the full call screen (mic, camera, share, react, chat, a red Leave). The channel stays usable. (Audit blocker 2.)

**3.2 Chat list.** Each row shows the last message, time and unread state. On top, a strip of small tiles that show something to act on: Catch up ("3 new"), Threads, Drafts and sent, Saved, Live calls. Hidden or reordered by long-press. Then Unread DMs, Mentions, then your sections.

**3.3 Catch up.** Unread conversations one per card. Swipe right marks read and shows the next, swipe left skips, Undo, reply right on the card, hold for "Mark all read". The most phone-native thing Slack has.

**3.4 A channel, one header row:** Back, the channel name with "8 members" as one tap target to details, then two icons at most (huddle, AI summary). The channel's tabs (Summary, Files, Pins) move inside details. Details, threads and DMs are full-screen pushes, never side panels. The tab bar steps aside.

**3.5 Composer:** the field, then one icon row (+, Aa, emoji, @), Send on the right (long-press Send to schedule). + opens one sheet: recent photos, Library, Files, Camera, Voice clip, plus sprint2go things (a task, a note, a table row, a Drive file). Formatting hidden until Aa.

**3.6 Long-press a message:** six frequent reactions and +, then Reply in thread, Make a task, Save, Remind me, Mark unread, Copy link, Copy text, Forward, Pin, Edit, Delete (last, asks first). Tap a message to open its thread. Long-press a reaction to see who reacted.

**3.7 Long-press a channel row:** peek without marking read, Mark read, Mute (1 hour, until tomorrow, always), Copy link, Move to section, Leave.

**3.8 Never lose words.** Drafts kept per conversation and per thread with a small draft marker in the list. A "Connecting" or "Offline" line under the header; messages sent while offline show "Sending" and retry.

---

## Phase 4. Mail

Model: Superhuman, Front, Missive, Apple Mail, Outlook. Fixes 5.x to 8.x and the mail labels in G10.

**4.1 Mailboxes in the title switcher:** All inboxes, Assigned to me, each shared inbox with its count, Sent, Drafts, Snoozed, Scheduled, To-do, labels (today labels and To-do can't be reached on a phone). Under the title, a chip row: Unread, Needs reply, Assigned, Attachments.

**4.2 Rows:** avatar, sender (bold with a dot when unread) and time, subject, one-line snippet (or an AI one-liner), then one quiet status line: assignee for shared mail, comment count, reminder, attachment, labels. Shared-inbox mail gets a coloured left edge so private and team mail never look alike.

**4.3 Swipes:** right is Done, left is Snooze (a sheet of presets plus "only if no reply"). Both changeable. Undo for 5 seconds. Long-press or tap the avatar to select many; the bulk bar replaces the tab bar.

**4.4 Reader:** one header row with Back, previous and next, and the avatars of teammates on the thread. Older messages collapse into "3 earlier". A one-line AI summary above the thread (when AI is on). The actions sit in a bottom bar: Done, Reply, Snooze, Assign (shared mail), More. Today there are two header bars and 7 unlabelled icons that wrap, and Reply is only at the end of the thread.

**4.5 Reply and compose:**
- Reply opens a half-height quick reply that can grow to full screen.
- Compose is a full-screen sheet: From picker on top, recipient chips with suggestions, Cc/Bcc folded, Send top right, long-press Send for Send later. Attach, AI write and templates sit in the bar above the keyboard.
- Swipe the sheet down to park the draft as a pill at the bottom.
- Undo for 10 seconds after sending (the server already holds mail for undo).

**4.6 Team mail on a phone:** Assign opens a searchable sheet with Unassigned and Me first. Internal comments sit inside the thread with their own tint and their own Comment bar, separate from Reply, so a private note never goes to a client by mistake.

**4.7 Pushes:** only for people, assignments and mentions; held about 20 seconds and dropped if you already saw it on another device. A push opens the item inside its app with Back going to that app's list.

---

## Phase 5. Calendar

Model: Fantastical, Notion Calendar, Apple, Google, Outlook. Fixes 29.x, 30.x and the calendar sidebar in G10.

**5.1 Schedule view, the phone default:** days down the left (today in an accent circle), full-width event cards, tasks with their checkbox, a "now" line, month headers. The last view is remembered per device.

**5.2 Views on phones:** Schedule, Day, 3 Day, Month. Week (7 columns) only from 768 px. Month on phones shows dots, and the tapped day's events list below the grid.

**5.3 One header row:** the month title is the date picker (tap "October" and a mini month drops down, swipe for other months), a today button showing today's date number, search. The Day / Week / Month switch and New event button stop taking two extra rows; views move into a small sheet from the title. Swiping the grid replaces the arrows.

**5.4 The calendar's side panel on phones.** Calendars on and off, teammates' calendars, holidays, connect a calendar and tasks to plan become a "Calendars" sheet from the title switcher. Today they can't be reached on a phone at all.

**5.5 New event:** tap an empty slot, a block appears with handles to set the time, and a sheet rises over a third of the screen: title, Event or Task, time, guests (our people picker, not comma-separated emails), Save. Swipe up for all options. All day, Repeat, Time zone, Video call, Location, Reminder and Notes show as quiet words that open when tapped.

**5.6 Moving events:** long-press to lift (350 ms), drag snaps to 15 minutes, Undo afterwards. A plain swipe always scrolls. Long-press menu: Duplicate, Move to tomorrow, Copy link, Join, Delete.

**5.7 Event details:** Join first (full width, when there's a link), then notetaker, guests with their answers, notes. For invites, Yes / Maybe / No pinned to the bottom. Grab handle and swipe down to close.

**5.8 Tasks get a time by tapping** (dragging doesn't work on phones): "Schedule" on a task's swipe and in its details, pick 15 / 30 / 60 / 90 minutes, then the next free slots today and tomorrow as chips.

**5.9 Draw state, not labels:** dashed for unanswered invites, faded for past, a checkbox in task blocks, a mic for the notetaker. Day and 3 Day open with "now" a third of the way down.

---

## Phase 6. Tables

Model: Notion (its June 2025 phone toolbar), Airtable, ClickUp, monday. Fixes 23.x to 28.x.

**6.1 Cards, not a squeezed spreadsheet.** When the pane is under about 600 px, a grid view shows as a card list: the name, then two or three chosen fields, status as a coloured pill. The grid is one tap away; when shown, the name column is pinned and only the table body scrolls sideways.

**6.2 One toolbar row:** a view pill (`Pipeline ▾`) on the left, then Search, Filter, Settings and one + on the right (▾ for templates). Sort, group and fields live in the Settings sheet. The 5-line desktop tip doesn't show on phones. Desktop keeps tabs and the full toolbar.

**6.3 Filters you can see:** the filter sheet opens on values with counts ("Me (4)", "Overdue (3)"), with the rule builder underneath. When a filter is on: a count on the icon and a "2 filters · Clear" line.

**6.4 Personal filters, also on desktop.** Filtering and sorting is just for you until you press "Save for everyone". People who can't edit the view (and guests) can still filter for themselves. Today a filter changes the view for the whole team.

**6.5 A row on a phone is its own page:** fields label above value, three to five key fields pinned under the title, empty fields folded into "6 more fields", tabs for Fields / Activity / Files when long, and the main button (Approve, Move to Won) pinned at the bottom. Previous and next on phones and on desktop (desktop keeps the side panel, with ↑ ↓ and shortcuts).

**6.6 Editing a cell:** every editor is a bottom sheet (choices with search and "Create 'X'", dates with end date and time, people with avatars, links as a full-screen search, files camera first). Tapping a cell in the phone grid opens its editor directly. Numbers, phone and email get the right keyboard.

**6.7 Board:** one column at a time with the next peeking, a strip of column names with counts to jump, + in each column header, "Move to" in the card's long-press menu, and the status pill tappable in place.

**6.8 Calendar view on phones:** month of dots, tap a day for its list, an agenda mode, long-press a day to add a row there.

**6.9 Quick create:** the + asks for the name only, with "Create and add another".

**6.10 Select many on a phone:** long-press, then tap more rows, then change a field for all of them. None of Notion, Airtable, ClickUp or monday can do this on a phone.

**6.11 Run on phones, build on desktop:** buttons run, intake forms can be filled in and shared, rules show as a list with on/off switches. The Automations dialog stays a desktop job (just readable as one column on a phone). Guests on phones get a simple list, record and one main action.

**Desktop gaps for later** (not phone work): nested filter groups, colour rules per view, row templates (with repeat), record page layouts, sub-groups, field descriptions, a timeline view.

---

## Phase 7. Notes

Model: Apple Notes, Bear, Craft, Obsidian, Keep, Notion. Fixes 31.x.

**7.1 A stack, not a squeezed sidebar:** the notes list, then a full-screen note with Back. Private / Shared with me / projects as chips at the top of the list.

**7.2 New note:** the create button opens a note with the keyboard up. The first line is the title.

**7.3 Keyboard bar, at most 7 buttons, changing with the cursor:**
- normally: Checklist, Make task, Aa, @, Attach, Undo, and hide keyboard pinned at the right;
- in a list: Outdent, Indent, Move up, Move down come first;
- with text selected: Bold, Italic, Underline, Strike, Highlight, Link.

**7.4 Aa opens a sheet that takes the keyboard's place:** Title, Heading, Subheading, Body; B I U S; lists, quote, divider; highlight colours. On desktop the same panel is a popover.

**7.5 Make a task from a line**, three ways: the keyboard bar, long-press on the line, a checklist line's own menu. A toast with Undo and Open, and a small task pill stays on the line.

**7.6 Note rows:** swipe right to pin, swipe left to move or delete (Undo). Long-press menu: Pin, Move to project, Share or make private, Copy link, Duplicate, Delete.

**7.7 Search at the bottom of the list** with chips before typing (Pinned, Shared with me, Has tasks, projects, people). Results open the note at the match.

**7.8 "Linked from"** (notes and tasks that point here) at the bottom of the note on phones.

**7.9 Never lose a thought:** a local draft before any network call, a quiet "Saved" line, "Saved on this device, will sync" when offline, Done top right to close the keyboard, read-only view for viewers, Recently deleted for 30 days.

**7.10 Quick capture from anywhere:** "Note" in More's New row, and sharing a link or text from another phone app straight into a note (the installed app registers as a share target), with a Private or project chip.

---

## Phase 8. Everything else

- **Settings** (blocker 5): a list of sections, each a full-screen push with Back, instead of 21 sections in one sideways strip. Plan and billing stops scrolling sideways (invoice rows stack). Guest access options stop being cut off.
- **Projects** (19.1): the 12 tabs become a list on the project's home on phones (Overview first), plus a title switcher to jump between tabs. Project header one row.
- **Meet** (33.1): one header row; Summary / Transcript / Notes tabs at the top of the meeting, not 700 px down. Transcript text never under the create button.
- **Drive** (32.x): card actions in a long-press menu and an always-visible "...". Upload is the create button.
- **Onboarding** (2.1, 2.2): the step indicator stops overlapping itself; "Close preview" becomes a normal button.
- **Guest portal**: a short fixed bar of only what's shared with them (Home, Messages, Files, Approvals), no More if it fits.
- **Teams, Vault, Operator console**: the shared fixes from Phase 0 (tap targets, fields, sheets) are enough; the console stays desktop-first.
- **Demo company bar and toasts**: the demo toast that covers content on phones moves above the bar row; the demo bar takes one line on phones.

---

## Phase 9. Check on real phones

The research used a simulated iPhone in Chrome. Keyboard behaviour, safe areas, the installed app, haptics and the motion itself need a real iPhone and a real Android phone after Phases 0, 2 and 4 at least. This Mac has no Xcode, so no iPhone simulator; checks happen on your phone (on live, or on the local app over Wi-Fi).

Every phase is also checked at 375, 768, 1024 and 1440 px, light and dark, with sheets animating in and out and reduced motion.

---

## Track B. Connect sprint2go to Claude (and other AI apps)

Runs alongside the phone work (it's server work and touches no screens until the last step).

- **What it is:** a sprint2go connector (an MCP server) at `app.sprint2go.com/mcp`. People add it in Claude (Settings, Connectors, Add custom connector) on desktop, phone or web; ChatGPT and other apps that support the standard work too. The AI runs on their own Claude plan; sprint2go just answers.
- **Sign-in:** through sprint2go's own login (OAuth with PKCE), so Claude never sees a password. The person picks which company it can reach.
- **What it can do, first version:**
  - read: what needs me (the Home list), search everything, read mail threads, tasks, channels, calendar, notes, table rows;
  - do: make and update tasks, write notes, add table rows, post in team channels, add events, draft mail replies.
  - Anything that leaves the company (sending mail, messaging guests, inviting people) is drafted, and the person sends it in sprint2go or confirms it in Claude.
- **Rules:** it sees exactly what the person sees (the same server lenses and guards as the app). Every action is in the audit log as "via Claude". Company admins get "Let people connect AI apps" in Settings; each person sees connected apps in their own Settings and can disconnect them.
- **Demo company:** works there too, as a safe place to try it.
- **Not instead of the built-in AI:** Ask AI, summaries and the notetaker still use our keys or the company's keys.

---

## The rest of the backlog, in the same order

**Small fixes to fold into Phase 0** (all from BACKLOG.md "Later"):
- Mail written in a local app no longer tries real delivery unless a relay is set (system codes already don't).
- MRR in the operator console counts active people only, like invoices.
- Companies made by operators get a time zone.
- Mail from addresses at mail.sprint2go.com itself gets DKIM.
- Plan switches: say plainly that it's from the next invoice (no proration), or prorate. Your call (below).

**Waiting on you** (unchanged, nothing to build until each arrives): Cloudflare token for the trusted mail certificate, off-site backup bucket, call relay (TURN), Dokploy API key for agencies' own addresses, our AI keys (an Anthropic key from Claude Console, or SumoPod) and missing prices, Amazon SES, Google and Microsoft sign-in apps, Xendit or Midtrans, WhatsApp, the desktop release and Apple Developer ID.

**Later** (after the phone work): imports (Slack, Trello, Google Drive), Indonesian, phone mail apps over IMAP, BIMI logo in Gmail, task stages per project, the desktop Tables gaps above, "Plan my day".

## Order

| Step | What | Size |
|---|---|---|
| 1 | Phase 0 foundations + the small backlog fixes | L |
| 2 | Phase 1 Home + Phase 2 Tasks | L |
| 3 | Phase 3 Chat + Phase 4 Mail | L |
| 4 | Phase 5 Calendar + Phase 7 Notes | M |
| 5 | Phase 6 Tables | L |
| 6 | Phase 8 everything else | M |
| B | Connector, in parallel from step 2 | M |

Each step is merged, checked (CI, phone and desktop widths, both themes), deployed and verified like the 9 Oct rounds. Phase 9 checks on a real phone after steps 1, 2 and 3.

## Decisions (building with these defaults; any can change later)

Aqeel asked on 9 Oct to build all of it locally, every backlog item, so these defaults are used:

1. **Phone bar:** Home, Mail, Chat, Tasks, More, Calendar first in More.
2. **The bell:** folded into Home on phones.
3. **Tap size:** 44 px on phones.
4. **Connector:** anything that leaves the company is drafted; the person sends it in sprint2go. No sending from Claude in the first version.
5. **Plan switches:** prorated, as a credit or charge line on the next invoice.
6. **Demo naming:** unchanged until Aqeel decides.

Built locally only: committed on local main, not pushed, not deployed (a push to GitHub deploys).

## How it's built

- **Wave 1 (together):** Phase 0 foundations; Track B connector; the backlog fixes; imports (Slack export, Trello, Google Takeout for Drive).
- **Wave 2 (after Phase 0 is in):** Home and Tasks; Chat; Mail; Calendar and Notes; Tables (phone, then the desktop gaps); everything else (Settings, Projects, Meet, Drive, onboarding, guest portal, demo bar).
- **Wave 3:** phone mail apps over IMAP (off until the trusted certificate exists), then the app in Indonesian, last, once the screens stop changing.
- **Can't be built without you:** everything under "Waiting on you", BIMI's certificate, checks with real AI keys, Outlook proxy traffic, and the real-phone check.
