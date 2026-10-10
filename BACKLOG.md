# sprint2go backlog

Updated 10 Oct 2026. Four lists: what waits on Aqeel (an account, a key or a decision), what's being built now, what's for later, and what's done. The full history before this split is in docs/backlog-archive.md.

## Waiting on you

Each of these is built and switched off until its key or account exists; the app says so instead of pretending.

- **Trusted mail certificate**: a Cloudflare API token with Zone DNS Edit for sprint2go.com, as `CF_DNS_TOKEN` in Dokploy. Our mail server then gets a Let's Encrypt certificate and renews it. Afterwards, tick "Require CA signed certificate" and "Validate certificate hostname" in Elkiya's Google host route.
- **Off-site backups**: a bucket on Cloudflare R2, Backblaze B2 or AWS S3, as `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_KEY`, `S3_SECRET`. Today the daily backups sit on the same server as the data.
- **Call relay for huddles**: a coturn container on Dokploy and `TURN_URLS`, `TURN_SECRET` (steps in docs/turn.md). Without it, calls fail on many mobile and office networks and say so.
- **Agencies' own addresses**: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_APP_ID` and an A record `custom.sprint2go.com` to 178.212.35.85, DNS only (steps in docs/custom-domains.md).
- **Our AI keys**: add them in /admin, AI, and fill the missing model prices (Gemini, Qwen, Mistral). Until then the AI plan has no AI; companies on their own keys work.
- **Boosted sending (Amazon SES)**: an AWS account with SES out of the sandbox, and `SES_KEY`, `SES_SECRET`, `SES_REGION`.
- **Google and Microsoft**: sign-in with Google/Microsoft and two-way calendar and mailbox sync need their OAuth apps. Calendar links (.ics) work without them.
- **Payments**: a Xendit or Midtrans account. Bank transfer invoices work today.
- **WhatsApp**: a Meta Business number and its app secret (`WHATSAPP_APP_SECRET`, or each company's own app secret in Settings).
- **Desktop app**: push a `v0.x` tag to build the first release; Mac auto-update also needs an Apple Developer ID to sign the app.
- **Decisions**: whether the GitHub repo stays public (it is, with no secrets in it; its description still says "Open source meeting platform"), the in-app word for "Shared space", the live company name "spring2go", whether the public demo keeps "Aqeel" at "Pixel & Profits", whether people who pick Indonesian get an Indonesian demo company, and the Indonesian word choices the translators flagged (docs/i18n.md).
- **Going live with the 10 Oct local build**: say when to push. After deploying: the DKIM record for mail.sprint2go.com (value in /admin, Platform, Mail), ports 993, 143, 587 and 465 in Dokploy plus `IMAP_ENABLED=1` once the trusted certificate exists, then check on a real iPhone and Android phone (keyboard, safe areas, swipes, motion), add the connector in real Claude, and send a repeating invite to Google, Outlook and Apple calendars.

## In progress

Nothing running. The 10 Oct local build (below) is on local main, not pushed or deployed.

## Later

- **Company logo in Gmail (BIMI)**: the upload and record are built; Gmail also needs a VMC or CMC certificate (12 months of logo use or a registered trademark) and DMARC at quarantine or reject.
- **Still English on purpose**: the demo company's content, audit and activity logs, meeting logs, "Re:"/"Fwd:", and the reply email to an outside organiser.
- **Not checkable without real traffic or keys**: Outlook.com's image proxy detection; model lists with real SumoPod, Anthropic and Gemini keys (Bedrock needs `bedrock:ListFoundationModels`).

## Done

**10 Oct, evening, local:** Calendar Day, Week and 3 days show all-day events and timed ones of a day or more as one bar across their days (Month's layout), square where they go on past the view, "+N" when a day is full; Task stages fit the Settings pane at every width.

**10 Oct, afternoon, live:** the sprint2go system on every phone screen (one type scale, spacing, rows, top bar; drift check in CI); the Whitelist (operator console, Customers: unlimited companies with monthly AI and Boosted limits, 80% alerts, per-person shares, out of revenue numbers); group DMs, following threads, camera and screen share in huddles; multi-day bars in Month and an end date in the editor; files on task comments; every Settings section in the iOS pattern on phones; Home greeting with the name when it fits; fixes from Aqeel's review (chat jump, tab highlight, task panel alignment, Tasks calendar days and actions row, the brand font's digits, sidebar titles).

**10 Oct, the phone fix (docs/mobile-fix-plan.md), local only:** every phone screen rebuilt to copy one reference app, checked side by side (research/mobile/fix/*/after/): the shell (plain bar, floating create button, app-owned top bars, left drawers, toasts at the bottom) and Home with its greeting; Mail as Gmail; Chat as Slack; Tasks and Projects as Todoist; Calendar and Meet as Google; Vault as Apple Passwords, Drive as Google Drive, Notes as Apple Notes, Tables as Notion, Settings as iOS Settings, Teams as Slack's people list. Known gaps: group DMs, per-thread follow, Compose button colour, Settings sections other than General still restyled rather than rebuilt, multi-day bars in Month, a Back button inside an open table.

**10 Oct, the local build (docs/mobile-plan.md), not live yet:**
- sprint2go on phones: a new shell (labelled bar, docked create button, one-row top bar, More sheet, Edit the bar, admin defaults per team), touch pieces (long-press, swipes with Undo, bottom sheets, pushed screens, the keyboard), 44 px taps and 16 px fields, and every app redone: Home as "Needs you"; Tasks the Todoist way (Quick Add in English and Indonesian, Plan my day, a touch board, select many); Chat (huddle bar, Catch up, long-press menus, drafts, Send later, offline retry); Mail (title switcher, swipes, snooze, bottom actions, quick reply, assign and comments); Calendar (Schedule view, Calendars sheet, long-press drag, repeating events with invites as one series); Notes (keyboard bar, Make a task, Recently deleted, share target); Tables (cards, filter sheet, row pages, bulk edit, plus personal filters, filter groups, colour rules, templates, layouts, sub-groups and a timeline on desktop); Settings as a list; Projects, Meet, Drive, onboarding, the guest portal and the operator console.
- Connect sprint2go to Claude and other AI apps (an MCP connector with OAuth; mail is always a draft).
- Imports from Slack, Trello and Google Takeout, with Undo for 24 hours.
- Phone mail apps over IMAP with app passwords (off until the certificate and ports exist).
- The whole app, its notices and its emails in Indonesian, chosen per person, per company and per guest.
- The backlog fixes: prorated plan switches, MRR on active people, trial limits, remember this device, holiday regions, duplicate calendar links, rare repeat rules, far time zones, stages per project or team, BIMI plumbing, DKIM for mail.sprint2go.com, operator-made companies' time zones, old ticket attachments, local mail held on the computer, and the database waiting on a lock instead of crashing.

**9 Oct, demo company and no-signup demo, live:**
- Everyone can open their own demo company (Pixel & Profits sample, made fresh in their time zone), kept apart on the server: no job, mail or operator number sees it, and AI, sending, uploads, invites and the notetaker refuse it. A bar with Reset and Hide, a "Try this" list of 8 things, a Demo badge in the switcher, and admins can turn it off for their people. Unused copies go after 30 days.
- app.sprint2go.com/try runs the demo in the browser with no account and nothing saved on our server; sprint2go.com/try goes there and the landing page has "Try it without signing up".
- A "Make a task" button on every email. New events no longer save twice with Cmd+Enter.
- Local servers show sign-in and reset codes on screen instead of emailing real people.

**9 Oct, after Aqeel's SumoPod note, live:**
- Adding an AI key asks which model to use, from the provider's own list (SumoPod, OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, Mistral, Qwen, Groq, Bedrock, your own server), with "Other model id"; each key's row and every job picker show the full list; a model the provider drops falls back and Settings says so. The operator console works the same for our keys.

**9 Oct, fourth round, live:**
- One design system: `PersonCell` and `Badge`, `EmptyState`, one look for every tab bar, toolbars on one line, the title column's menu, our own time picker, dialogs never trapped inside panes, and a responsive sweep of every screen (40 px tap targets on phones, phone titles, calendar and reader bars).
- Server jobs: the notetaker joins Meet and Zoom calls from calendars by itself, channel summaries on their schedule, a real Undo send (mail waits for the undo window), email digests for teammates who are away, and deleting old chat messages with a week's notice.
- Security and billing: WhatsApp webhook signatures, project visibility on the server, add-ons and pausing enforced, Boosted credits only through a paid invoice, no invented card, AI caps, alerts and blocked providers enforced, one iCalendar parser, and a dozen access holes closed (checked by scripts/security-tests.mjs in CI).
- DKIM: every message we send is really signed (mailauth 7 only reads `signatureData`; before, signatures came back empty).
- Read tracking for real: a picture and signed links per outside recipient, honest about Gmail's, Outlook's and Apple's automatic opens, a company switch, tracked replies and "remind me if no reply" on the server.
- Follow-ups: members open only files they can see, operators open ticket attachments (audited), invoices bill active people only, a refused send goes back to Drafts, a company time zone.

**9 Oct, third round (the "do everything" pass), live:**
- Sign-up and reset codes and guest notices go out from no-reply@sprint2go.com through our own mail server.
- A mail domain belongs to one company, proven by MX, DKIM or a TXT record.
- Labelled one-off backups outside the rotation; off-site copies ready for S3.
- Trusted certificate support for the mail server (Let's Encrypt over Cloudflare DNS, or certificate files), shown in the operator console.
- Forwarded mail sealed by Google, Microsoft or Zoho (ARC) no longer lands in spam.
- A real daily "Some of each" routing check with "Send a test", and the "Check every day" switch back.
- The running build on /api/health and in the operator console.
- GitHub Actions: typechecks, build, a guard that demo-only code can't run on live, unit tests, a mail smoke test, and an uptime check every 10 minutes that opens an issue when the site is down.
- Task stages per company (rename, add, reorder, colour, remove with a move), a "New task" button, and a settings gear in every app.
- The AI plan backend: our keys and models per job in the operator console, fallbacks, prices and the dollar rate, the "are we losing money" verdict, who handles each company's data, caps tied to the plan, and Bedrock, Vertex and Azure working.
- Mail: refresh and pull to refresh, calendar invites with a card, real Yes/Maybe/No replies and the events in the calendar, mailboxes and aliases in Email delivery, out of office, the notetaker using the event's real link.
- Calendar links (.ics and webcal) read on the server every 30 minutes, public holidays for 17 countries, Join from events.
- An installable app, push notifications on phones and computers only while people are away, a 10-minute event reminder, and desktop auto-update (Windows now; Mac once signed).
- Two-step sign-in for everyone, a company switch that requires it, backup codes, and resets by admins and operators; Google, Microsoft, SAML and own storage say "Not yet" instead of pretending; "Ask before saving big files" works with real storage numbers.
- Huddles: call relay support, recovery when a connection drops, and a plain message when a network blocks calls.
- Agencies' own addresses: DNS check, certificates through Dokploy, and a plain page for addresses that aren't set up.
- Uploaded files can't run code (only safe kinds open in the browser, sandboxed).
- The demo data removed from live; live holds only Aqeel's account and companies.

**9 Oct, earlier:**
- Real mail: our own mail server on port 25, sending direct with DKIM, sprint2go.com and app.sprint2go.com live with Let's Encrypt, the "Some of each" guide with the real Google, Microsoft and Zoho screens, Elkiya Group receiving and sending through Google split delivery.
- Gating: features that can't work are hidden, explained or disabled (Compose, Reply, AI, notetaker, calendars, payments, downloads), no pretend sends, opens or chat replies on live, real Unsubscribe.
- The operator console with roles, two-step, tickets, money, growth, product and platform pages.
