# Fixing sprint2go on phones

10 Oct 2026. The phone redesign of 9 to 10 Oct followed research "lessons" but no screen looks like the app it was meant to follow. This plan fixes that by copying one reference app per screen, whole. Six side-by-side studies (our screen next to the real app, measured element by element) are in research/mobile/fix/ (git-ignored; competitor images stay out of the repo):

| Area | Copy | Study |
|---|---|---|
| Home and the shell | Teams bar, Gmail selected tab, Things/Apple large title, Slack Home | fix/home-shell/spec.md |
| Mail | Gmail | fix/mail/spec.md |
| Chat | Slack (iOS 26 version) | fix/chat/spec.md |
| Tasks and Projects | Todoist | fix/tasks/spec.md |
| Calendar and Meet | Google Calendar, Google Meet | fix/calendar/spec.md |
| Notes, Tables, Drive, Settings, Vault, Teams | Apple Notes, Notion, Google Drive, iOS Settings, Apple Passwords, Slack people | fix/other/spec.md |

Each spec has the measured target for every element, the files to change, what to delete and a numbered build order. This file is the summary and the order across them.

## How it gets built this time

1. **One app at a time, one builder, in order.** No fleet of parallel builders on looks.
2. **Every step is checked by its side-by-side image**, re-shot with the scripts in each study folder. A step isn't done until ours reads like the reference at the same scale, in light and dark, at 375 and 390.
3. **Aqeel sees the side-by-side images for each app before the next app starts.**
4. **Desktop doesn't change** unless a spec says so. Everything stays local until Aqeel says push.
5. **Indonesian stays complete:** new words go through t() and `node scripts/i18n-check.mjs --strict` keeps passing.

## Step 0. The shell (everything else depends on it)

- **Bottom bar:** a plain full-width bar (Teams, Gmail with Workspace), 56 px plus the home bar, five labelled tabs (Home, Mail, Chat, Tasks, More), 24 px icons, a small pill behind the selected icon only, red counts on Mail and Chat only. Replaces the floating rounded pill.
- **Create button:** a 56 px round button floating 16 px above the bar on the right, owned by each app (Gmail's "Compose" with a label that shrinks on scroll in Mail; "+" elsewhere). Replaces the docked circle beside the pill.
- **Top bar slots:** an app can own the left button and the title (Mail's search pill, Calendar's ☰ and month, Tasks' large title and back). The default stays: company logo with your avatar on its corner, title, search.
- **Left drawer on phones:** the shell lets an app open its own drawer from the left (Mail's folders, Calendar's views and calendars, Meet). Today shell.css hides drawers on phones on purpose.
- **Toasts at the bottom,** above the bar, never over the top bar or sheet headers.
- **More:** a Teams-style sheet: "More" with Edit, a four-column grid of the other apps in their colours, then Ask AI and Settings. Search and the New row leave More (search lives in the top bar; each app has its own create button).
- **Company switcher:** you and your status, your companies with a tick on the current one, Add a company, Settings.
- **Notifications:** a full screen with All, Unread and Mentions, with the person's photo on each row.

## Step 1. Home

The date, then "Good afternoon, Aqeel" at 28 px (the greeting is back), then one line on what needs you. A tinted box only when a meeting or huddle is live or about to start. Then plain sections, no cards: Needs you, Today, Updates. Each task appears once; empty sections don't show. Set-up and "Try the demo" become one row each at the bottom. The dashboard cards and Customise Home go away on phones. Create is "+" with Brain dump first.

## Step 2. Mail, as Gmail

- The Mail list's top is Gmail's search pill (☰, "Search in mail", avatar that switches companies). No title, no chip row.
- ☰ opens the left drawer from the existing desktop Sidebar: All inboxes, shared inboxes and Assigned to me where Gmail lists accounts; Inbox, Starred, Snoozed, Sent, Drafts, Done; projects where Gmail lists labels; Mail settings last.
- Rows are Gmail's three lines: bold for unread (no dot), time on the right, star at the end of the snippet line, no dividers, no project chips or "Seen 3x" in the list.
- Selecting shows actions in a top bar, not a bottom bar.
- The reader: back, Archive, Delete, Mark unread, More at the top; Reply, Reply all, Forward at the end of the thread. Assign lives in More and as a chip after the subject; internal comments stay inline with a round Comment button beside Reply.
- One full-screen compose. "Compose" floats above the bar and shrinks on scroll. Snooze is Gmail's centred dialog of tiles with "Only if no reply" as a switch.
- The filter chips move into Mail's search screen.
- Fix: Out of office in Pixel & Profits lists Elkiya Group addresses.

## Step 3. Chat, as Slack

- One bottom bar (the suite's). Under Chat's top bar, a sliding Home / DMs / Activity switch, each with an unread dot.
- Home: Slack's tiles (Catch up, Threads, Huddles), restyled to Slack's size; a "Tap to join the huddle" banner; one-line 46 px rows, bold when unread with a count pill; sentence-case section titles with the fold arrow on the right. No previews, times or boxed icons on Home rows.
- DMs: two-line rows, newest first. Activity: mentions, thread replies and DMs to you, Slack's layout, swipe left to clear with Undo.
- Channel: Slack's sizes (36 px square avatars, 17 px names and text, grey reaction pills); the flat composer with +, Aa, emoji, @, ... and a split Send whose second half schedules; the mic moves into the + sheet.
- Create: tap for New message with "To:"; long-press for New channel, Start a huddle, Browse channels, Drafts and sent.
- Huddle: full-screen call with a red Leave pill; the green bar is the minimised call.

## Step 4. Tasks and Projects, as Todoist

- The Tasks tab reopens the last list (Today the first time). Back, or tapping Tasks again, goes to Browse: Todoist's grouped cards with Today, Upcoming, My tasks; a Team group (Supervising, Assigned by me, team queues, Briefs); Projects; saved views.
- Each list: a 32 px bold title and one "..." (layout, Display, Select, Plan my day). The toolbar row goes.
- Rows at Todoist's sizes (~74 px, 17 px title, 14 px detail with a calendar icon before the date, "Project #" in the project colour, dividers starting at the title). Approve and Take it only in Supervising and team queues; the doer as a small avatar top right.
- The task sheet: filled fields as icon-and-value rows without labels, empty fields as one sideways row of chips, comment field pinned at the bottom. The "Internal only" box goes.
- Projects open straight on their tasks; overview, Chat, Mail, Files and the rest move into the project's "..."; the projects list becomes rows. The board shows each stage once.
- Fixes: a project opened from Tasks shows "Tasks" as its title; Plan my day shows on Upcoming.

## Step 5. Calendar and Meet, as Google

- One 56 px bar: ☰, the month name with ▾ (drops a mini month with month chips), search, today. The Up next strip goes; a Join pill shows on events about to start.
- The drawer holds the views (Schedule, Day, 3 days, Week, Month), calendars, accounts, holidays and teammates, Add a calendar, Settings last, and the company switcher in its header.
- "+" offers Event, Task, Out of office. One full-screen editor with fixed rows that never move. Tapping an empty slot opens a short sheet (X and Save, title, time, guests).
- Solid event colours with white text in every view. Week comes back on phones. Month is Google's chip grid with titles.
- Event details are a full page: X, pencil and ⋮ at the top, Join as a row, Yes / No / Maybe pills in a bar at the bottom. No long-press menu.
- Meet: the same drawer; home shows "Coming up" above "Past meetings"; "+" becomes "Take notes".

## Step 6. The other apps

- **Vault (fix first: can't add or open a login on a phone):** Apple Passwords' two-line rows; a detail screen with copy for username, password and the code; "+" adds a login; the lock screen reworded for phones.
- **Drive (can't make a folder on a phone):** list by default, 64 px rows with "You uploaded · date · size", folders first, a search pill; "+" opens Upload, Take a photo, Make a folder; the file menu gains Download, Move to folder, Details. No "drag files here".
- **Notes:** Apple Notes' grouped cards with date sections; 17 px title and one 15 px line with time and first line; filters in the title menu; Share and ••• in the editor bar, Undo and Done while typing; the keyboard bar as a floating 48 px capsule.
- **Tables:** Notion's List view (title line, fields line, no boxes); the row page as label-and-value rows without previous/next; Notion's single filter menu with live results.
- **Settings:** iOS Settings: an account card first, short groups, coloured 30 px icons, values on the right, switches and footers, text fields on their own screen. The fake "Compose" button in General goes.
- **Teams:** search, then Your teams and Other teams as plain rows; status only when something needs action; member actions on the member's profile.

## After each step

Re-shoot the side-by-side images, run every CI check, show Aqeel the images for that app, then start the next. When all are done: one pass on a real iPhone and Android phone before going live.
