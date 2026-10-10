# Mail attachments

How files in Mail work, on the server (`server/mailFiles.ts`, `server/officePreview.ts`) and in the app
(`src/mailAttachments.ts`, `src/components/mail/Attach*.tsx`, `src/components/mail/FilesView.tsx`).
Tests: `node --import ./server/register.mjs scripts/mail-files-tests.mjs` (in CI).

## What happens to a file

- **Sending.** Compose, the reply box and the phone reply upload each file as soon as it's added (`/api/upload`), so a
  draft, a scheduled email and the sent copy keep the file's address. Pictures pasted or dropped into the words are
  uploaded too and go out as cid images (`inlineForSend`). An email can carry 25 MB in all, counted as it's packed
  (base64); a file that doesn't fit becomes a link (below), with a note in Compose.
- **Arriving.** Each file is checked (`storeIncoming`): the types Gmail refuses (`BLOCKED_EXTS` in
  `src/mailAttachments.ts`), a zip (or a zip in a zip) holding one, and Windows programs with another name are listed
  with the reason and not kept. Pictures the email shows by cid are kept as files and shown in place.
- **Virus scanning.** With `CLAMD_HOST` set (`host`, `host:port`, port 3310 by default, or a socket path), every
  incoming file goes to ClamAV's clamd (INSTREAM) first: a virus means the file isn't kept. Without it, or when clamd
  doesn't answer within 20 seconds, files are kept and marked **Not scanned** in the reader. ClamAV is not a required
  dependency. To run it next to sprint2go (Docker, Dokploy):

  ```yaml
  clamav:
    image: clamav/clamav:stable   # ~1.5 GB memory for the signatures; it updates them itself (freshclam)
    restart: unless-stopped
  # and on sprint2go: CLAMD_HOST=clamav:3310
  ```

- **Unusual types** (web pages, SVG, documents with macros, scripts, double names like `invoice.pdf.html`) are allowed
  and get a warning before they open.

## Reading

- **Preview without downloading**: images in a gallery (arrows, keys, swipe on phones), PDF in the app with pdf.js
  (no scripts), video and audio in the browser's player, Word, Excel, PowerPoint, CSV and text converted on the server
  to a plain HTML page (`GET /api/files/<id>/preview`, served with `sandbox` and no scripts, shown in a sandboxed
  frame). Old `.doc`, `.xls`, `.ppt` and anything else: the viewer says there's no preview and offers Download.
- **Download all**: `GET /api/mail/zip?threadId=&messageId=` streams one zip of the message's kept files.
- **Save to Drive** (one file, or all): `POST /api/mail/files/drive { threadId, messageId?, urls?, folderId? }` makes a
  copy that's the person's own, in the folder they pick, within the company's storage.

## Big files as links

`POST /api/mail/links { workspaceId, files: [{ name, url }], access: 'anyone' | 'recipients', recipients }` puts each
file in Drive ("Sent as links from Mail") and returns a link per file (`/f/<token>`), which Compose adds to the email.

- **Anyone with the link** downloads from a plain page.
- **Only the recipients**: a signed-in teammate of the sender, or a recipient signed in to sprint2go, opens it straight
  away; anyone else enters their address and gets a 6-digit code by email (the same answer whoever asks, so nobody
  learns who it went to), then the file opens on that browser for 7 days.

## For search

`searchAttachments(userId, { workspaceId, q, kinds, from, after, before })` and `threadMatches(thread, { hasAttachment,
filename })` in `server/mailFiles.ts` (and `mailFiles`, `threadHasAttachment`, `filenameMatches` in
`src/mailAttachments.ts` for the app) are what `has:attachment` and `filename:` call. `GET /api/mail/files` answers the
same over HTTP. Pictures inside the words and refused files never count.
