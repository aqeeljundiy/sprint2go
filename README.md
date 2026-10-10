# sprint2go

One app for a team's whole workday: mail, chat, tasks and clients, calendar, drive, meetings and one AI assistant.

## Run it on your computer

```
npm install
npm run build
npm run server
```

Open http://localhost:8787 and sign in with any demo person's email (for example james@demo.sprint2go.com). The first-run password is `SEED_PASSWORD` in `.env.example`; copy it to `.env` to change it before the first run, and change your own password in Settings, Account.

- Everything is saved in `data/sprint2go.db` (SQLite). Delete the `data` folder to start again from the demo company.
- Open the app in two windows (or two browsers as two people) and changes show up live in both.
- The server only listens on this computer (127.0.0.1).

While changing the code, run `npm run server` and `npm run dev` together: the dev app on its own port talks to the server.

## Clients

Clients sign in to their own portal at the same address. In the demo, Laura Anderson (Kopinara, approver) and Hannah Koh (Selara Skin) can sign in with their emails and the same demo password.

- They only see what you share: their "With client" channels, briefs and tasks marked visible, files you share, notes of meetings they were in, and their own requests.
- What they can do is set in Settings, Client access (and per client on the client's Portal tab).
- To check what a client sees without signing out: open the client's page, Portal tab, "View as client".
- The server enforces all of it: a client sign-in never receives mail, internal comments, other clients or team channels.

## AI

Without a key the app uses a small built-in demo AI (marked "Demo AI").
To use a real AI, an admin adds a key in Settings, AI: Claude, ChatGPT, Gemini, DeepSeek, SumoPod, OpenRouter, Qwen, Mistral or any OpenAI-compatible server.
The key is tested with one tiny request, then stored encrypted in the database (the encryption key is `data/secret.key`); the browser only sees the last 4 characters.
Each AI job (brain dump, Ask AI, meeting notes, drafts, summaries…) uses the provider and model picked for it.
Optionally set `ANTHROPIC_API_KEY` in `.env` for the "included" AI that sprint2go pays for.

## Notifications on phones and computers

People turn them on per device in Settings, Notifications (on iPhone and iPad, after adding the app to the Home Screen). They go out only while the person is away from the app, for the kinds they picked: messages and mentions, email to them (never newsletters or spam), tasks, guests' replies, calendar reminders and meeting notes.

- Web push needs no setup: the server makes its keys on first start and keeps them in the database (the private one encrypted with `data/secret.key`). Changing that key means everyone turns notifications on again.
- It works on `localhost` and on https addresses; browsers refuse it on plain http elsewhere.
- The service worker (`src/sw.js`, built to `/sw.js`) only adds an offline page and notifications. Pages always come from the server, so a deploy shows at once.

## The desktop app

`desktop/` wraps the hosted app for Mac and Windows. Push a tag (`git tag v0.1.1 && git push --tags`) and `.github/workflows/desktop.yml` builds it and publishes a GitHub release with the installers and the update files, which installed apps check every few hours to update themselves.

- The landing page offers the download when `DESKTOP_URL` is set, or else when the newest release of `DESKTOP_REPO` (default `aqeeljundiy/sprint2go`) has installers. The repo must be public for that.
- Windows updates work unsigned. Mac updates need a signed and notarized app (an Apple Developer ID certificate); until then the Mac app doesn't look for updates, and people download new versions from the site.

## The demo file

`npm run standalone` writes `dist/sprint2go.html`, a single file that opens without a server. Data there resets when you reload.
