# sprint2go backlog

Updated 9 Oct 2026. Four lists: what waits on Aqeel (an account, a key or a decision), what's being built now, what's for later, and what's done. The full history before this split is in docs/backlog-archive.md.

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
- **Decisions**: whether the GitHub repo stays public (it is, with no secrets in it; its description still says "Open source meeting platform"), whether the app gets Indonesian, the in-app word for "Shared space", and the live company name "spring2go".

## In progress

Nothing running. The 9 Oct "do everything" pass is merged and live; see Done.

## Later

- **Company logo in Gmail (BIMI)**: once the logo has been in use for 12 months (CMC) or is a registered trademark (VMC); needs the SVG, a `default._bimi` record and the certificate.
- **Imports**: Slack export, Trello boards, Google Drive, so switching is easy.
- **Phone mail apps (IMAP)**: decide whether sprint2go mail should open in other apps.
- **Task stages per project or team**, if someone asks.
- **The app in Indonesian**, if decided.
- **Smaller follow-ups**: trial limits so one person can't collect many trials; "remember this device" for two-step; spotting the same calendar link added twice; choosing which regions' holidays show; rare repeat rules in invites; all-day invites in time zones beyond plus or minus 11 hours.
- **Reported by the 9 Oct builders, not done yet**:
  - Plan switches aren't prorated (the toast says the new price is on the next invoice).
  - MRR in the operator console still counts every member; invoices and the billing page count active people only.
  - Mail from addresses at mail.sprint2go.com itself isn't DKIM-signed (no key published for that name).
  - Companies made by operators have no time zone, so they use Jakarta.
  - Tickets made before 9 Oct may point at any file; operators can open those.
  - Outlook.com's image proxy is detected by a commonly reported user agent, not verified against real traffic.
  - A demo toast ("Found 3 to-dos in your email") covers content for a few seconds on phones; mail rows overflow by 3 px.
  - Watch the motion itself (open and close animations) on a real device; builders checked layouts with animations off.
  - Model lists were tested against fake providers only; try them with real SumoPod, Anthropic and Gemini keys. Bedrock's list needs the `bedrock:ListFoundationModels` permission.
  - Right after the server seeds demo data, signing in can fail for a moment while the demo passwords are being saved (local only).
- **From the demo build, not checked yet**: the demo bar's closing fade and the slide when switching companies; Settings, Help and the first-run card at phone width and in dark mode; starting a huddle or a voice note inside the demo; the time-zone helper on the live server (if it fails, the demo uses start-up dates).
- **Demo naming**: the public demo greets "Aqeel" at "Pixel & Profits". Decide whether it should be a made-up company and person.
- **Local mail you write still tries real delivery** (system codes no longer do). Block it locally unless a relay is set.

## Done

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
