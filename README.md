# sprint2go

One app for a team's whole workday: mail, chat, tasks and clients, calendar, drive, meetings and one AI assistant.

## Run it on your computer

```
npm install
npm run build
npm run server
```

Open http://localhost:8787 and sign in with any demo person's email (for example aqeel@pixelandprofits.com). The first-run password is `SEED_PASSWORD` in `.env.example`; copy it to `.env` to change it before the first run, and change your own password in Settings, Account.

- Everything is saved in `data/sprint2go.db` (SQLite). Delete the `data` folder to start again from the demo company.
- Open the app in two windows (or two browsers as two people) and changes show up live in both.
- The server only listens on this computer (127.0.0.1).

While changing the code, run `npm run server` and `npm run dev` together: the dev app on its own port talks to the server.

## Clients

Clients sign in to their own portal at the same address. In the demo, Nadia Putri (KopiKita, approver) and Sarah Lim (Lumina Skin) can sign in with their emails and the same demo password.

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

## The demo file

`npm run standalone` writes `dist/sprint2go.html`, a single file that opens without a server. Data there resets when you reload.
