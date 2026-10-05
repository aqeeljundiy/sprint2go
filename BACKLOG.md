# Sprint2go backlog

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

## Rename "client" access to cover partners too (agreed 6 Oct)
- People from outside: **Guests**. Their area: **Shared space**. The other company gets a **type**: Client, Partner, Vendor, Freelancer, Collaborator (Client by default).
- Workspace switcher section: "Shared with you". Channel category "With client" becomes "Shared". Settings "Client access" becomes "Guest access", with defaults per type.

## Principle audit: "what do I need to do now?" (6 Oct)
Rule: every number or card must pass "so what, now what?" for this person today, or go to a report. Exceptions over totals, hide zeros, the action next to the thing.
- Home Company pulse: drop "Open" and "Clients" counts; keep Late / Not picked up only as links that open the fix.
- AI Spending: tokens in/out under Advanced; lead with monthly cost and the verdict.
- Workload card only on lead and founder Homes.
- Cards that only link elsewhere: let you act, or remove.
- Ideas: "Up next" ranked list at the top of Home (approvals, late, replies owed, requests, next meeting) with inline actions; inline row actions everywhere (approve, assign, snooze, reply); search as the main way to move around; notifications land on and highlight the exact item; empty states that name the next step.
