# Sprint2go backlog

## Working list (8 Oct 2026): everything asked so far, except going live

Done 8 Oct (this round): Tables polish (Title tag, editable row title, sort rows), our dropdowns everywhere, the "Some of each" email onboarding (split delivery guide, routing test, invite warning, Settings routing block), per-type guest settings, guests play recordings, leavers lose guest access, "Shared with you" in every switcher, narrow Guests tab.

Still to do, in order:
1. White-label for agencies, both sizes: a branded guest portal on the agency's subdomain, and full reselling (an Agency screen, client workspaces under the agency, the brand picked from the address). Plus an onboarding option ("We're an agency") and a landing page section. Certificates per subdomain, DNS checks and agency billing wait for going live.
2. Server rules per person: private channels and task visibility checked on the server; an AI cost log per job.
3. UI polish, second pass: fewer boxes and grey, no fields inside fields, a real dark palette with colour meanings, panels that don't make the page jump, one spacing scale.
4. Speed and code: split the bundle, break up App.tsx, keyboard support for clickable rows, settings and Ask AI history synced across devices.
5. New: smart search across everything, Huddles (voice in a channel), WhatsApp for guests (needs the WhatsApp Business API: built as far as it runs locally).
6. Revenue ideas: quotes and contracts that turn into briefs, templates per industry. (Buying domains in onboarding needs a registrar and waits for going live.)
7. Vault end-to-end encryption.
8. Mac and Windows app (outside the App Store), with a download on the landing page.
9. Landing page: About us (founded by Aqeel, Aqeel Group, AI systems, open source on GitHub), check the Indonesian version.
10. Push to GitHub.

Waiting on Aqeel: the word for clients and the Guest / Shared space naming (decide), trying drags and a Member login, the two "Untitled table"s, the screens to tidy.

Going live (not now): Dokploy deploy, real email (mail server and SES, connecting Google/Microsoft/Zoho mailboxes, the daily routing check sending for real), file storage, server write checks, AI cost caps, production setup, sign-up/reset/billing, security fixes, guest email notifications, external calendar sync, real payments.

## UI polish pass (asked 5 Oct 2026): first pass done 5 Oct, keep reviewing screen by screen

**1. Fewer boxes, lines and grey**
- Home cards have a grey header bar + a line + an outlined card, with outlined boxes inside (pulse numbers, workload tiles). Too many nested frames.
- Pick one container per idea: a card OR a divider, not both. Remove grey header strips; use spacing and type weight for hierarchy.
- No box inside a box (e.g. the brain dump input inside a card with its own border; workload tiles inside a bordered card).

**2. Nested inputs**
- The channel name field shows a rounded input inside a rounded wrapper ("# supplements"). The `.field input` style is applied on top of `.chan-name`. One rounded field with the # inside, no inner border.
- Check every form for the same issue (guest add, add provider, connect calendar, onboarding).

**3. Dark mode colours, chosen on purpose**
- Today dark mode is mostly the light palette inverted, with saturated coral, red, green and orange on near-black, which is harsh.
- Define a real dark palette: softer surfaces with small elevation steps, desaturated accents, red only for real problems, green only for done.
- Review colour meaning across the app (colour psychology):
  - **Red** = late or danger only.
  - **Amber** = waiting or needs attention.
  - **Green** = done.
  - **Brand accent** = actions.
  - **Neutral** = everything else.
- Too many colours compete now: team colours, client colours, status colours and the workspace accent.
- Check contrast (WCAG AA) for text on tinted chips in both themes.

**4. Layout stability**
- When a panel opens or grows (thread panel, info panel, a new tab, the composer growing), the content behind it reflows or jumps.
- Reserve space or overlay panels; fix widths of sidebars and side panels; avoid layout shifts from scrollbars (scrollbar-gutter: stable); animate with transform rather than width.

**5. Responsive and neat**
- Tidy spacing scale (4/8/12/16/24), consistent radii (one for cards, one for controls, pills), consistent heading sizes.
- Check every screen at phone, tablet and desktop after the pass.

## Channel extras (asked 5 Oct 2026): done 5 Oct
- **Links tab** on every channel: every link shared in the messages, collected automatically, plus links you pin by hand (bookmarks like the brief, the Figma file, the client's Drive).
- **Space used** per channel: how much storage its files take, shown on the Files tab and in Storage settings.
- **AI summary tab** per channel, on a schedule: Off, Weekly or Monthly (default Monthly), or Daily for busy channels. Chosen when creating the channel and changeable in settings. It uses the company's AI allowance (or its own keys); the cost per update is shown when you pick.
- Extra ideas, built with it:
  - Summary history: past summaries stay, so you can read "September" or "last week".
  - "Since my last visit": an on-click summary of only what you missed.
  - Optionally post each new summary into the channel.
  - The daily digest becomes the "Daily" option of the same schedule (one setting, not two).

## Done 5 Oct: agency essentials and the local server
- Repeating tasks, reminders, checklists, brief templates (built-in and saved by the team).
- Shared inbox assignment, internal notes, snooze, send later.
- Local server: database, sign-in, invite links, password change, live updates, encrypted AI keys, AI router per job. Scheduled mail, snoozes and reminders run on the server.

## Next, for the local server
- Server-side permissions per person (today the server separates workspaces; finer rules like private channels and task visibility are applied in the app).
- AI caps and a cost log per job.
- Files: Drive uploads are kept in the database for now; move them to disk or object storage.

## Later ideas (not now)
- WhatsApp for clients.
- Huddles (quick voice calls in a channel).
- Smart search across everything.

## Done 6 Oct: client access
- Settings, Client access (company) with per-client changes: team names, requests, meeting notes and recordings, inviting colleagues, uploads, AI with a monthly question limit, branding.
- The client's app: Home, Requests (tickets), Chat, Work (approve, comment), Files (upload), Meetings, Ask AI. "View as client" from the client page.
- Comments: internal by default, "Client can see this" to reply to the client.
- Client sign-ins on the local server, with the server shaping and checking everything a client receives and changes.

## Next, for clients
- Meeting recordings: playback once recordings are stored.
- Materials of shared channels in the client's Files.
- Email notifications to clients (needs real mail).

## Done 6 Oct: "Project" replaces "client"
- Words come from `src/terms.ts`. Settings, General, "What you call your work": **Projects** (default) or **Clients**. It switches live everywhere, including the Settings menu and chat sections.
- With Projects, outside people are **guests**; with Clients they stay "clients". Shared space, Shared channels, Guests tab, Past projects, Projects × teams.
- Chat sections: Projects, Shared, Teams, **Other** (the old "Projects" catch-all; still "Projects" for companies on Clients).
- Project **type** label (Client, Internal, Partner, Vendor, Event, Other): set on the project header or when adding; filter chips above the list once there are 2+ types. Demo: "P&P website refresh" is Internal.
- Guests show as **Name · Company**: company from the invite, else the project name when the email domain matches, else the email domain (gmail and the like are skipped).
- Guests with 2+ shared projects land on **Shared with you**, grouped by inviting company, saying what waits on them. "See everything shared with you" in the switcher.
- **Start your own workspace (free)** for guests: the usual onboarding, saved by `POST /api/workspace` (they're forced to owner). They keep their shared spaces in the switcher.

- **Guests bring their colleagues** (decided 6 Oct, instead of inviting whole companies): a guest can add people at their own email domain straight away (e.g. Faisal adds Rizky @pixelandprofits.com to Elkiya's project); other domains wait for the team's OK. Someone who already signs in gets access with no link. The new person gets the same company label; uploads go to "From <their company>"; the team's notifications say "Faisal (Pixel & Profits)". Admins can turn it off or require approval (Guest access, "Guests invite colleagues").
- Local demo: Elkiya's project "Q4 ads with Pixel & Profits" (Partner) with Faisal, Aditya and Rizky as guests. It lives in the local database only, not in the seed.

## Next, for projects
- When someone leaves a company, also end their guest access in other companies' projects (needs the company to vouch for its domain).
- Per-type defaults for guest access (e.g. Partners can see more than Clients).
- Narrow panes: the project page's Guests tab squeezes its two columns below about 900px.
- Mobile: a "Shared with you" entry in the phone switcher.

## Principle audit: "what do I need to do now?" (6 Oct): first pass done 6 Oct
Rule: every number or card must pass "so what, now what?" for this person today, or go to a report. Exceptions over totals, hide zeros, the action next to the thing.
- Home Company pulse: drop "Open" and "Clients" counts; keep Late / Not picked up only as links that open the fix.
- AI Spending: tokens in/out under Advanced; lead with monthly cost and the verdict.
- Workload card only on lead and founder Homes.
- Cards that only link elsewhere: let you act, or remove.
- Ideas: "Up next" ranked list at the top of Home (approvals, late, replies owed, requests, next meeting) with inline actions; inline row actions everywhere (approve, assign, snooze, reply); search as the main way to move around; notifications land on and highlight the exact item; empty states that name the next step.

### Audit pass done (6 Oct)
- Home: "Up next" at the top for everyone (reviews, client requests, late and due today, team queues with Assign, late work you handed out with Remind, client emails with Reply, finished briefs to close). Company pulse numbers removed from default Homes; Teams and Clients cards say what to fix ("1 late", "Next: …"), not how much exists.
- Sidebars and headers: numbers only for late, due today, waiting for your review, unread, unfiled meetings, nobody on it. Totals removed (My tasks, Everything, clients, folders, sections, channel tabs). Task headers say "2 late · 1 due today" or "Nothing late or due today".
- Client page: "Needs attention" list replaces the four total boxes; tabs show "1 late" / "2 unread" only.
- Drive: storage meter only at 80% full or more.
- AI Spending: monthly cost and verdict first; tokens under "Where it goes".
- Client portal: counts only for "Waiting on you" and "Needs approval".
- Kept on purpose: unread counts, the Workload card for leads and founders, Storage and AI allowance numbers in Settings (there the numbers are the decision).
- Second pass done (6 Oct): row actions (task rows show Approve / Start / Tomorrow when that's what they need; Snooze on mail rows; file unfiled meetings from the list), search as the main way around (Home search bar, empty search shows what needs you and recent places, every-word matching with client names, "Create task" and "Ask AI" from what you typed), notifications land on and highlight the exact chat message (opening its thread), mail notifications open the email, empty states name the next step.

## Done 6 Oct: calendar, clients over time, notes, vault
- Calendar: drag to move (also to another day), drag the bottom edge to resize, "Plan your tasks" (drag a task onto the calendar), task blocks offer Extend 30 min / Move to tomorrow / Mark done, a nudge when a block ends with the task unfinished.
- Clients: status on the client page, End work (archive channels, read-only or no portal, optionally close tasks), Past clients with "Clients over time", Work with them again.
- Notes app: private or shared, linked to a client (shown on the client page), pin, search, make a task from a selected line, new note from search.
- Vault: shared logins per person or team, passwords and 2FA secrets encrypted on the server and never in the synced data, 2FA codes made on the server, copy with clipboard clear after 30 s, access log for the owner and admins.

## Before going online (must)
- Vault: end-to-end encryption (keys derived on the person's device) so even the server can't read passwords; today they're encrypted at rest with the server's key.
- Choose the company's word for clients (Clients / Customers / Projects / Accounts), together with the Guest / Shared space rename.
