# Sprint2go game plan

Updated 5 October 2026. One app for a team's whole workday (mail, chat, tasks, calendar, files, meetings), organised around clients, with any AI the company wants.

## 1. Where we are
- **Phase 1 done:** clickable prototype (Home, Mail, Chat, Tasks + Clients, brain dump, Meet, notifications, ⌘K, onboarding, phone layout), sample data only.
- **Next:** Round 2 of the prototype, then the real backend.

## 2. Round 2 build (prototype, in order)

**Step 1: Tasks, teams, Home, controls**
- Briefs: one owner, context (goal, background, deliverables, links), subtasks for others. Brain dump offers "Brief" or "Separate tasks".
- Name check: names and nicknames first, then client context, then a "Who is Andi?" chip (pick teammate, mark as client contact, or invite). Remembers answers.
- Teams (departments) on people and tasks. Views: by client, by team (e.g. the video editing backlog across all clients), and a client by team grid. Tasks can go to a team before a person. Team workload for leads. A channel per team.
- Done tasks: "Done · Undo", then a Done section. Filters Open / Done / All.
- Home made of cards, drag to arrange, templates per role: Founder (whole company pulse), Team lead, Designer / Editor, Account manager, Finance. Admin sets default per team; each person can change theirs. Desktop grid, tablet 2 columns, phone 1 column.
- Own dropdowns, date picker and checkboxes everywhere; bottom sheets on phones. No plain browser controls.

**Step 2: Chat**
- Info panel per channel (replaces the jump to tasks): about (category, team, owner, brief), files (auto-saved to the client's Drive folder), emails with the client, people and contacts, tasks, "Catch me up".
- Sidebar grouped by category (Clients, Team, Projects, Social), plus Starred and your own sections.
- New channel window: name, purpose, category, client, public or private, members, guests, who can post, who can invite.
- Threads, reactions and custom emoji, voice notes, confetti when work is done, polls, /commands, GIFs (admin switch), kudos, status from the calendar.

**Step 3: Clients inside**
- Guests by email, only see what you allow. Shared channels between two Sprint2go companies.
- Client portal: internal by default, "Visible to client" per task, brief, file or meeting note; approvals.

**Step 4: Outside calendars**
- Google, Outlook, iCloud, calendar links, Indonesian holidays. Colour layers, on/off. Teammates see "Busy" only.

**Step 5: Workspace admin, AI, billing, storage**
- AI settings (section 3), plans and billing (sections 4 to 6), storage meter and choices (section 5).

**Step 6: Meet**
- Every feature of the P&P meetings app inside Sprint2go (its feature list is the checklist).
- Recording choices per meeting (section 5).

## 3. Bring any AI
In Workspace settings → AI:
1. Who pays: Sprint2go (AI included plans), own keys, or both.
2. Connect providers: key tested on save, stored encrypted, only last 4 characters shown.
3. Preset: Best quality, Balanced, Lowest cost.
4. Per job: provider and model, sample test, cost per 100 uses, backup provider.
5. Limits: spend cap per provider, alerts at 50 / 80 / 100%, switch per automatic job.

Providers: Claude, ChatGPT, Gemini, DeepSeek (data note: China), Qwen, Mistral, SumoPod (rupiah), OpenRouter, AWS Bedrock / Google Vertex / Azure, any OpenAI-compatible server. Speech: browser built-in, OpenAI, Deepgram, Groq.

**The guide**

| Job | Weight | Best | Balanced | Cheapest |
|---|---|---|---|---|
| Brain dump & briefs | Heavy | Claude Opus | Claude Sonnet, GPT-5 | DeepSeek Pro, Gemini Flash |
| Ask AI | Heavy | Claude Opus | Claude Sonnet | DeepSeek Pro |
| Meeting notes | Heavy | Claude Opus, Gemini Pro | Claude Sonnet | Gemini Flash |
| Write / rewrite email | Medium | Claude Sonnet | GPT-5 mini, Haiku | DeepSeek Flash |
| Summary / catch me up | Medium | Claude Sonnet | Haiku, Gemini Flash | DeepSeek Flash |
| Suggest replies | Light | Haiku | GPT-5 mini | DeepSeek Flash |
| To-dos from email | Light | Haiku | Gemini Flash | DeepSeek Flash |
| Sorting & filing | Light | Haiku | Gemini Flash | DeepSeek Flash |
| Voice notes | Speech | Deepgram, OpenAI | Groq | Browser (free) |

**AI cost rules**
- AI never runs because someone opened a screen.
- Free, no AI: Home briefing, sorting, names, dates, newsletters, search, reply templates.
- On click: summarise, replies, drafts, catch me up, transcribe, Ask AI, brain dump.
- Automatic, once, switchable: meeting notes; to-dos only from real client emails (cheap model, batched).
- Save every answer, trim text before sending, prompt caching, batch at half price, cost log on every call.

## 4. Pricing (rupiah, per month)

**Two tracks.** Own AI keys (they pay their AI provider) or AI included (we pay).

| People | Own AI keys | AI included |
|---|---|---|
| 1 to 5 | **Free** (limits in section 6) | |
| 1 to 9 | **Small**: Rp 39.000 per person | **Small AI**: Rp 89.000 per person |
| 10 included | **Studio** Rp 399.000, extra person Rp 39.000 | **Studio AI** Rp 899.000, extra Rp 89.000 |
| 30 included | **Agency** Rp 999.000, extra Rp 35.000 | **Agency AI** Rp 2.499.000, extra Rp 79.000 |
| 80 included | **Business** Rp 2.499.000, extra Rp 29.000 | **Business AI** Rp 6.499.000, extra Rp 79.000 |

Business (both tracks) adds SSO, audit log, priority support. Yearly = 2 months free.

**Fairness rules**
- Never pay more than the next package (we switch automatically and tell you).
- Only active people are billed. Clients, guests and shared inboxes are always free.
- Switch tracks any time, pause up to 3 months a year, no lock-in, export always free.

**AI included, in outputs (no credits).** Shared by the company, per person per month roughly:
10 brain dumps, 20 Ask AI questions, 6 meeting hours, 50 email summaries, 30 drafts; reply suggestions and email to-dos unlimited.
Shown as "Left this month: about 120 meeting hours, or 400 questions". When it runs out: light jobs continue on a cheap model, top-up Rp 99.000 (about 50 meeting hours, or 110 questions, or 120 brain dumps, or 600 summaries), or switch to own keys.

**Margins** (after server, storage, AI and 3% payment fees; before salaries)

| Package | Typical use | Everyone maxes AI |
|---|---|---|
| Small / Studio / Agency / Business (own keys) | 84% / 84% / 82% / 81% | same |
| Small AI / Studio AI | 71% | 49% |
| Agency AI / Business AI | 69% | 45% / 44% |
| Extra person AI (Rp 79.000 to 89.000) | 68% to 71% | 43% to 49% |
| Top-up Rp 99.000 | 47% | |

Example: 50 paying companies (mostly small) bring about Rp 29,4 juta revenue and Rp 21,8 juta gross profit a month; about Rp 19,3 juta after 100 free workspaces. With Rp 30 juta monthly running costs, break-even is about 75 paying companies. Each Agency or Business customer lowers that a lot.

## 5. Storage and meeting recordings

**Unit costs:** Contabo object storage Rp 209 / GB, Backblaze B2 Rp 122 / GB. Main copy plus a backup with a different provider = **Rp 331 / GB / month**.

**Storage is pooled per package** (a heavy editor uses the team's pool):

| Package | Team storage | Margin if completely full |
|---|---|---|
| Free | 5 GB | n/a |
| Small | 20 GB per person | about 70% |
| Studio | 250 GB | 71% |
| Agency | 1 TB | 58% |
| Business | 3 TB | 51% |

Most teams fill 20 to 40%, so real margins stay near 80%.

**Use your own storage.** Connect Google Drive, Dropbox or Backblaze for raw footage and big files. They show on the client page; Sprint2go keeps finals and previews.

**Big file prompt.** Uploading a big file asks: "This file is 4.2 GB. Save it to your connected Google Drive, keep it here (uses 4.2 GB of your 250 GB), or cancel."

**Meeting recordings: you choose what to keep.** One hour of recording is about:

| Keep | Size per hour | Storage cost per hour, per month |
|---|---|---|
| Video + audio + transcript + notes | about 1.1 GB | about Rp 370 |
| Audio + transcript + notes | about 30 to 60 MB | about Rp 15 |
| Transcript + notes only | under 1 MB | almost nothing |

- **Before each meeting** (or as a default): "Keep video / Audio only / Notes only". The bot still records while the meeting runs, so notes are accurate; it deletes what you didn't choose to keep once notes are ready.
- **Workspace default** set by the admin, with rules: e.g. client meetings keep video, internal standups keep notes only.
- **Auto-downgrade:** video becomes audio after 30, 60 or 90 days (admin choice). Free plan: video kept 90 days, transcript and notes forever.
- **Size warning after long meetings:** "This 2-hour recording is 2.2 GB. Keep the video, or keep audio and notes only?"
- **Recordings count toward team storage.**
- **Permissions per meeting:** who can record, who can watch or download the recording, who can see the transcript, and whether a client guest can see notes. Clients only ever see what is marked "Visible to client".
- **Consent:** the bot announces itself; the host can stop recording at any time, and that part is never stored.

## 6. Free plan and upgrade gates

**New workspaces start with 14 days of Studio AI** (all features, up to 10 people, full allowance), then drop to Free. No card needed.

**Free:**
- 5 people, 1 team
- AI unlimited with your own key, plus a monthly taste without a key (good model): 5 brain dumps, 10 Ask AI questions, 2 meeting hours, 20 summaries, 10 drafts, 30 reply suggestions
- 90 days of visible history (everything kept)
- 5 GB storage, 2 meeting-bot hours a month, video kept 90 days
- Connect your own email (hosted mailboxes are an add-on)
- 1 client guest and 1 shared channel, portal shows "Made with Sprint2go"
- Read tracking: opened yes / no

**Growth levers (cross-gates).** Their AI key pays for AI; they pay us for what grows with the business and what we host:
1. Team size (6th person, second team)
2. Memory (history older than 90 days)
3. Things we host (storage, meeting-bot hours, hosted email)
4. Clients inside (more guests, portal, own branding)
5. Control (permissions, audit log, SSO, retention)

**Put down roots early:** onboarding nudges free teams to connect email, add clients, invite one client, upload files, record a meeting.

**Rules:** never block daily work, never delete data, let them finish what they started, show the exact price at the moment ("Add Dewi for Rp 39.000"), show each gate once, members can "Ask the owner to upgrade".

**Add-ons for free and paid teams:**

| Add-on | Price / month | Margin |
|---|---|---|
| Hosted mailbox (10 GB) | Rp 15.000 per mailbox | about 68% |
| Extra 50 GB storage | Rp 39.000 | 55% full, about 72% typical |
| Meeting bot, 10 more hours | Rp 49.000 | about 60% (recordings count as storage) |
| Remove portal branding | Rp 49.000 | about 95% |

**Cost of free:** up to about Rp 25.000 per workspace a month for servers and storage, plus up to Rp 13.000 AI taste if no own key. Trial about Rp 42.000 once (worst Rp 89.000). Inactive workspaces archived after 60 days. If 8 of 100 trials convert, the trials pay back in about 6 weeks.

**Clients become customers:** guests see "Your team could use this too"; the agency gets a free month for every client company that signs up, and so does the client.

## 7. Billing menu (Workspace settings)
- Overview: plan, people, next invoice, AI and storage meters.
- Plan: two tracks, people slider with live price, auto switch to the cheaper package, monthly or yearly, pause.
- People: billed for the rest of the period when invited; inactive people not billed.
- AI usage: by job, person and provider; caps, alerts, top-ups.
- Storage: by app and by person, biggest files, recordings, connect own storage, add-ons.
- Payment: Xendit (QRIS, bank virtual accounts, GoPay, OVO, DANA, cards); Paddle for international.
- Invoices: PDF, company, NPWP, PPN, billing contacts.
- Late payment: retries, 14 days grace, then read-only. Nothing deleted.
- Cancel or downgrade in two clicks, full export.

## 8. Workspace admin
General · People and teams · Apps · Email · Calendars · Meetings (recording defaults, permissions, retention) · AI · Storage · Billing · Security (2-step login, SSO, audit log) · Data (export, retention)

## 9. Bigger revenue later
1. Buy a domain during onboarding (resale margin, email set up automatically).
2. Quotes and contracts that turn into briefs and tasks when signed.
3. White-label client portal for Business.
4. Templates per industry, later a marketplace.

## 10. Technology
- Web app (installable on phones): the React prototype grown up.
- API: Node and TypeScript; Postgres with each company's data kept apart by the database; live updates over WebSockets.
- AI router: one entry point for every AI job; picks provider and model, applies caps, logs cost, falls back (grown from the meetings app's llm.mjs).
- Storage: Contabo object storage plus Backblaze backup; connectors for Google Drive, Dropbox, Backblaze.
- Connectors: Stalwart mail (sending via Amazon SES), Google, Microsoft, Zoho, iCloud, calendar links, the meetings app, Xendit, Paddle.
- Hosting: Dokploy on Contabo, its own server once customers arrive, nightly off-site backups, staging.sprint2go.com.

## 11. Roadmap

| Phase | Weeks | What | Done when |
|---|---|---|---|
| Phase 1 | done | Clickable prototype | Done 5 Oct |
| Round 2 | done 5 Oct | Steps 1 to 6 above, built and tested on sample data | Ready to demo; UI polish pass is next (BACKLOG.md) |
| Phase 2 | 3 to 9 | Real backend: accounts, teams, tasks, chat, AI router, cost log | Elkiya and P&P use tasks and chat daily |
| Phase 3 | 9 to 13 | Real email: Google, Microsoft, Zoho, hosted mail, SES | One person per company runs only on Sprint2go mail |
| Phase 4 | 13 to 18 | Calendars, Drive and own storage, the meetings app joined in | A client call ends and tasks, notes and recording land on the client page |
| Phase 5 | 18 to 22 | Billing, gates, trial, security pass, beta with 5 to 10 companies | A company you don't know signs up and pays alone |

## 11b. Backlog
See BACKLOG.md: UI polish pass (fewer boxes and grey, no nested inputs, a deliberate dark palette with colour meanings, layout stability when panels open, spacing and radius system).

## 12. Assumptions behind the numbers
- US$1 = Rp 17.500 (forecast; recheck at launch).
- Claude Sonnet 5.5 US$2 / 10, Haiku 4.5 US$1 / 5, Opus 5.5 US$4 / 20 per million tokens in / out; DeepSeek V4 Flash US$0.14 / 0.28.
- AI per person per month: typical Rp 18.000, full allowance Rp 38.000.
- Server time Rp 1.500 to 2.000 per person; average storage 8 GB per person; Rp 5.000 per person total for normal teams.
- Meeting bot about Rp 1.400 per bot hour (one Rp 300.000 server runs about 4 bots at once).
- Payment fees 3%.
- Server sizing is an estimate; measured for real in Phase 2.

## 13. Risks
- Heavy AI users on best models: allowance in outputs, cap, push to own keys.
- Video teams filling storage: pooled storage, own storage, recording choices.
- Customer keys leaking: encrypted, never shown again, admin only, logged, instant revoke.
- Cheap models making mistakes: guide warnings, previews on anything that assigns people or reaches clients.
- Data with providers clients wouldn't accept: data notes, admins can block providers.
- Gmail approval (CASA), email landing in spam, scope of 8 apps, the "Sprint" trademark.

## 14. Decisions
- Free teams can buy add-ons and full plans. (decided)
- Referral: 1 free month for both sides. (decided)
- Meet keeps every feature of the P&P meetings app; onboarding asks the default for what meetings keep (video, audio, notes only); admin can change it. (decided)
- Dropped: billing clients from the client page. The billing menu is only for the company's own Sprint2go subscription (plan, invoice history, payment method, usage).
- Open: which PT bills customers during the beta (recommend an existing PT for beta, PT Sprint2go before public launch); Paddle added when the first foreign customer appears.
