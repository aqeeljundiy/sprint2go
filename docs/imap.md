# Phone mail apps (IMAP, POP3 and SMTP submission)

People can read and send their sprint2go mail in iPhone and iPad Mail, Gmail and Outlook on Android, Outlook and Thunderbird. Everything stays in step with sprint2go: reading, flagging, moving and deleting in a mail app changes the same mail in the app, and the other way round, live (IDLE).

Code: `server/mailApps.ts` (switch, app passwords, settings API, autoconfig, Apple profile), `server/imap.ts` (the IMAP server), `server/imapStore.ts` (threads as folders, UIDs, flags, changes), `server/imapMime.ts` (ENVELOPE, BODYSTRUCTURE, sections), `server/submission.ts` (sending), `server/mailRaw.ts` (each message's source). Settings: `src/components/PhoneMailApps.tsx`. Tests: `scripts/imap-tests.mjs` (in CI).

## Turning it on

It stays off, and Settings, Phone mail apps says what's missing, until both are true:

1. **`IMAP_ENABLED=1`** in the sprint2go application's environment.
2. **A trusted certificate for `MAIL_HOST`** (mail.sprint2go.com), the same one the mail engine uses (`server/mailcert.ts`): Let's Encrypt once `CF_DNS_TOKEN` (the Cloudflare token) is set, or `MAIL_TLS_CERT` and `MAIL_TLS_KEY`. Mail apps refuse a self-signed certificate, and nobody should type a password over a line they can't check. A renewed certificate is picked up without a restart, and the mail app ports open by themselves once it's trusted.

**Ports (Dokploy, not done yet):** publish these TCP ports on the host to the sprint2go container, the same way port 25 is published for the mail engine:

| Port | What | Env (default in production) |
|---|---|---|
| 993 | IMAP over TLS | `IMAPS_PORT` (993) |
| 143 | IMAP with STARTTLS | `IMAP_PORT` (143) |
| 465 | Sending over TLS | `SUBMISSIONS_PORT` (465) |
| 587 | Sending with STARTTLS | `SUBMISSION_PORT` (587) |

The server's firewall must let them in. They listen on `0.0.0.0` in production (`IMAP_BIND` changes that). Outside production the defaults are 1993, 1143, 1465 and 1587, so a laptop never needs root.

**Optional DNS for companies:** SRV records help some mail apps find the server by themselves: `_imaps._tcp.<domain>` → `0 1 993 mail.sprint2go.com` and `_submissions._tcp.<domain>` → `0 1 465 mail.sprint2go.com`. Thunderbird also reads `https://<app host>/.well-known/autoconfig/mail/config-v1.1.xml`.

## Signing in

- **App passwords only.** Each person makes named ones in Settings, Phone mail apps (after typing their sprint2go password), sees when each was last used, and removes them. Shown once, four groups of four letters (about 75 bits); only a keyed hash (HMAC with the server's master key) is stored. Spaces and capitals don't matter.
- **Their normal password never works** over IMAP or SMTP, so two-step sign-in stays meaningful.
- **User name:** the person's sign-in email or the address of any mailbox they're on. That mailbox shows at the top of the account; the others they're on show as folder trees under their address.
- **Only after TLS:** port 143 offers `STARTTLS` and `LOGINDISABLED` until the line is encrypted; port 587 refuses AUTH before STARTTLS. Anything sent along with STARTTLS before the handshake is thrown away.
- **Limits:** failed sign-ins per address (30) and per user name (10) in 15 minutes, like the web sign-in (only failures count, since mail apps sign in many times a day), each with a short wait. At most 40 connections per person.
- **Ending access:** removing an app password ends its connections at once. Changing or resetting the sprint2go password, "Sign out everywhere" and deleting the account remove every app password. A suspended person, someone taken off a mailbox, or a company that switches other mail apps off ends the connections too.
- **Per company:** admins switch "Let people use other mail apps" in Settings, Phone mail apps (`workspace.mailApps = false`).

## Folders

| IMAP folder | What it holds | Moving a message there |
|---|---|---|
| INBOX | incoming messages of conversations in the inbox (not snoozed) | moves the conversation to the inbox |
| Sent (\Sent) | messages this mailbox wrote, outside Trash, Spam and Drafts | not allowed (fills itself) |
| Drafts (\Drafts) | drafts (scheduled ones excluded) | not allowed (APPEND a draft instead) |
| Archive (\Archive) | sprint2go's Done | marks the conversation Done |
| Snoozed | snoozed conversations | snoozes it until 9:00 tomorrow, company time |
| Trash (\Trash), Spam (\Junk) | those places | moves it there |
| Clients, Team, Infra, Finance | conversations with that label | adds the label (moving out takes it off) |

Shared inboxes and other mailboxes appear as `hello@company.com/Inbox` and so on, only for the people on them. Mail never moves between mailboxes.

sprint2go keeps conversations, so a change to one message changes its conversation: marking read or flagging changes the conversation's read state and star; moving or deleting moves the whole conversation. Unread means its newest incoming message is unseen (plus any the mail app marked unread itself); a star flags the newest one (plus any the mail app flagged). `\Answered`, `\Deleted` and keywords such as `$Forwarded` stay with the mail app's copy.

Deleting (\Deleted, then EXPUNGE) in INBOX, Archive, Snoozed, Spam or Sent moves the conversation to Trash; in a label folder it takes the label off; in Trash or Drafts it deletes for good (iPhone's "Remove deleted messages after a week" does that too).

UIDs, UIDVALIDITY and MODSEQ (CONDSTORE) are kept per mailbox and folder in the database (`imap_boxes`, `imap_msgs`) and survive restarts. A message that leaves a folder and comes back gets a new UID. A draft changed in sprint2go becomes a new message in the mail app.

## The messages themselves

New mail is kept exactly as it arrived, and mail the engine sends as it went out (`mail_raw`, compressed). Older mail (and the demo's) is rebuilt once from the thread with its Message-ID, date, recipients, text, HTML and attachments, and kept, so it reads the same every time. Sources of deleted conversations are swept once an hour.

## Sending from a mail app

The From (and the envelope sender) must be one of the person's mailboxes or an alias that delivers into one; anything else gets 553. Then it's the same path as sending in sprint2go: the email is saved in its conversation (or a new one, which shows in Sent), checked like `/api/mail/send` (read-only company, sending set up for the mailbox, sending limits), DKIM-signed and queued in the outbox; on a local server mail to outside addresses stays held on this computer. Read tracking stays off. Bcc works. The mail app's Message-ID is kept, so when the app also appends its copy to Sent there's one copy, not two. Mail apps have their own Undo send, so the server doesn't add a second wait.

## POP3

For mail apps and services that only fetch (an old desktop client, a CRM's "fetch mail", another Gmail account's
"Check mail from other accounts"). Code: `server/pop3.ts`, started by `server/mailApps.ts`; tests in
`scripts/mail-teams-tests.mjs`.

- **Off by default**, like IMAP: it needs **`POP3_ENABLED=1`** and the same trusted certificate for `MAIL_HOST`. Its
  own switch, so a server can offer IMAP without POP.
- **Ports:** 995 (POP3 over TLS, `POP3S_PORT`) and 110 (with STLS, `POP3_PORT`); outside production 1995 and 1110.
  Publish them on the host like the IMAP ports when it's switched on.
- **Signing in:** `USER`/`PASS` or `AUTH PLAIN`, with an **app password** (the same ones as IMAP), only once the line
  is encrypted: the plain port offers `STLS` and refuses a user name before it. Removing the app password, a changed
  password or "Sign out everywhere" ends POP connections too.
- **Each person switches it on** in Settings, Mailbox access (as in Gmail), for all mail or from now on, and picks what
  happens to the copy in sprint2go once a POP app has fetched it: kept, marked read, archived (Done) or moved to Trash.
- **What it offers:** the mail that arrived in the mailbox the user name names (their own by default): not Spam,
  Trash or drafts, nothing they sent. As in Gmail, a message a POP app fetched (`RETR`) or deleted (`DELE`) isn't
  offered again; the choice above is applied at `QUIT`, and a connection that drops changes nothing.
- Supports `CAPA`, `STAT`, `LIST`, `UIDL` (stable ids), `RETR`, `TOP`, `DELE`, `RSET`, `NOOP`, `QUIT`.

## Not done

- No QRESYNC, NOTIFY, COMPRESS, BINARY or SORT/THREAD extensions; mail apps don't need them.
- Folders can't be made, renamed or deleted from a mail app (sprint2go's places and labels are the folders).
- Copying a message to another mailbox isn't possible.
- Tested with imapflow and nodemailer (what iPhone, Gmail and Thunderbird do over the wire), not yet with the real apps against a live server: that needs the certificate and the ports above.
