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
- **WhatsApp**: a Meta Business number and its app secret.
- **Desktop app**: push a `v0.x` tag to build the first release; Mac auto-update also needs an Apple Developer ID to sign the app.
- **Decisions**: whether the GitHub repo stays public (it is, with no secrets in it; its description still says "Open source meeting platform"), whether the app gets Indonesian, the in-app word for "Shared space", and the live company name "spring2go".

## In progress (started 9 Oct)

- **One design system**: one person row with a proper badge pill, one empty state, the title column's menu, Search, filter and Grouped by on one line, one look for every tab bar, our own date and time pickers in the event editor, and a responsive sweep of every screen at 375, 768, 1024 and 1440 in both themes. More screenshots from Aqeel go here.
- **Jobs the settings promise**: the notetaker joining calls by itself, channel summaries on their schedule, a real Undo send, email digests for teammates who are away, and deleting old chat messages when a company asks for it.
- **Security and billing**: WhatsApp webhook signatures, project visibility on the server, add-ons and pausing enforced, no free Boosted credits, no invented card on the billing page, the AI caps and alerts, DKIM on every message we send, one iCalendar parser, and a check of every route's permissions.
- **Read tracking that's real**: a pixel and signed link redirects per recipient, honest about Apple's and Gmail's automatic opens.

## Later

- **Company logo in Gmail (BIMI)**: once the logo has been in use for 12 months (CMC) or is a registered trademark (VMC); needs the SVG, a `default._bimi` record and the certificate.
- **Imports**: Slack export, Trello boards, Google Drive, so switching is easy.
- **Phone mail apps (IMAP)**: decide whether sprint2go mail should open in other apps.
- **Task stages per project or team**, if someone asks.
- **The app in Indonesian**, if decided.
- **Smaller follow-ups**: trial limits so one person can't collect many trials; "remember this device" for two-step; spotting the same calendar link added twice; choosing which regions' holidays show; rare repeat rules in invites; all-day invites in time zones beyond plus or minus 11 hours.

## Done

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
