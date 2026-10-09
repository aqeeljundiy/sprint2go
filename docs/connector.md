# sprint2go in Claude (and other AI apps)

People can add sprint2go to Claude as a connector, and to ChatGPT and other AI apps that connect to remote MCP servers. Then they can ask their AI things like "what needs me today?", "draft a reply to Nadia saying Friday works" or "make a task for Dewi to send the invoice by Thursday", and the AI reads and works in sprint2go for them.

The AI runs on the person's own Claude (or ChatGPT) plan. sprint2go only answers its questions, so it costs sprint2go no AI credits. It doesn't replace the AI built into sprint2go: Ask AI, summaries, the brain dump and the notetaker still run on sprint2go's keys or the company's own keys (Settings, AI).

## Adding it in Claude

The address is **https://app.sprint2go.com/mcp**.

1. In Claude (web, desktop or phone), open **Settings, Connectors** and choose **Add custom connector**.
2. Name it sprint2go and paste the address. Leave the advanced settings empty.
3. Choose **Connect**. A sprint2go page opens: sign in as usual (with your two-step code, if it's on).
4. Pick the company Claude may reach, read what it can do, and choose **Allow**. You're sent back to Claude.

On Claude's Team and Enterprise plans an owner adds the connector once for the organisation, in Claude's admin settings; each person then connects it with their own sprint2go sign-in.

In ChatGPT and other apps, add a connector (or MCP server) with the same address; they sign in the same way.

Each person sees the address, ready to copy, in sprint2go under **Settings, Account, Connected AI apps**.

## What it can do

It reads, in the one company that was picked, exactly what that person sees in sprint2go:

- **What needs me**: the same list as Home's Up next (meetings about to start, work to review, guest requests, late tasks and tasks due today, team queues they run, client mail waiting for a reply), plus unread notifications.
- **Search** across tasks, mail, chat, notes, table rows, the calendar, projects, people, files and meeting notes.
- **Mail**: list and read conversations in their own mailboxes (and shared inboxes they're on).
- **Tasks**: list by scope (mine, today, overdue, upcoming, supervising, assigned by me, team queues, a project, a team) and read one in full.
- **Chat**: list channels and direct messages, read recent messages and threads.
- **Calendar**: their agenda for a range of days, or a teammate's as much as they share.
- **Notes** and **tables**: list and read them, and query table rows.

And it can do, as that person:

- make and update tasks (title, people, due date, stage, priority, notes, checklist, a comment),
- write notes (new ones are private unless shared with the team),
- add and change table rows,
- post in team channels and direct messages with teammates,
- add events to their calendar (with teammates as guests),
- draft emails and replies.

## What stays with the person

Nothing leaves the company from an AI app:

- **Email is always a draft.** It lands in the person's Drafts in sprint2go; they open it, check it and press Send. A drafted reply keeps the conversation's thread when it's sent.
- **Messages to guests are drafts.** In a channel that guests read, the message waits in that channel's message box (only the person sees it, on any device) until they send it or discard it.
- **No invitations.** It doesn't invite people or guests, and events only take teammates as guests.
- It doesn't delete anything, and it can't touch billing, settings, the Vault, files or mail delivery.

The AI is told this, and every result says plainly when something was only drafted.

## The rules it follows

- **It sees what the person sees.** Every tool reads through the same rules as the app: private mail stays private, a member never sees a project they aren't on, and a person who is only a guest somewhere has no company to connect. Guests themselves can't connect AI apps.
- **It changes things the way the app does.** Every change goes through the same server checks as the app's own saves (what Members may do, read-only companies, who can post where). Teammates get the same notifications as when the person does it in the app.
- **Everything is on record.** Each change is in the audit log as "via Claude" (or the app's name), and a task's history says it came via the app. Connecting or disconnecting an app shows in the company's Security log.
- **Admins decide.** Company admins can switch **Let people connect AI apps** off in Settings, Security & data (it's on by default). While it's off, every connection to that company stops working at once and nobody can make a new one.
- **People decide.** Each person sees their connected apps in Settings, Account, Connected AI apps: which app, which company, when it was last used, and Disconnect. Changing or resetting the password, or being signed out everywhere, disconnects them all.
- **The demo company works too.** Someone can connect their own demo company to try it safely: nothing in it is real and nothing leaves it.

## How it works (for whoever runs the server)

- `/mcp` is a Streamable HTTP MCP server (one request, one answer: no sessions kept, nothing streamed), so it works behind the same proxy as the rest of the app. In production the Dokploy domain for app.sprint2go.com sends every path to the app, which is what `/mcp`, `/oauth/*` and `/.well-known/oauth-*` need (a domain with a path set to anything but `/` would break them).
- Sign-in is OAuth 2.1: `/.well-known/oauth-protected-resource` (and `/mcp` under it) and `/.well-known/oauth-authorization-server` describe it; apps register themselves at `/oauth/register`, send the person to `/oauth/authorize` (the app's consent screen), and swap the code at `/oauth/token` with PKCE (S256 only). `/oauth/revoke` ends a connection.
- Redirect addresses must match what the app registered, exactly: https, or plain http only on the same computer (desktop apps), or an app's own address (`cursor://`, `vscode://`).
- Access tokens last an hour. Refresh tokens last 30 days and are replaced each time they're used; one used twice ends the whole connection. Codes last ten minutes and work once. Only hashes of tokens, codes and app secrets are stored.
- Rate limits: app registration, the token endpoint, wrong tokens at `/mcp`, and 120 requests a minute per connection.
- The addresses come from `PUBLIC_URL` (https://app.sprint2go.com). No new environment variables.
- `scripts/mcp-tests.mjs` (in CI) runs the whole thing against a production-like server with the official MCP SDK's client: sign-in, every tool, who sees what, drafts, the company switch, revocation, expired and wrong tokens and rate limits. Claude itself can't reach a local server, so a real Claude connection can only be tried once it's deployed.
