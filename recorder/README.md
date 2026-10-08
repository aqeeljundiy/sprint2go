# Sprint2go meeting recorder

A bot that joins Google Meet or Zoom as a guest, records the meeting's audio, and reports back to Sprint2go: status, live captions, and at the end the transcript. Sprint2go writes the notes with the company's own "Meeting notes" AI.

Based on the open-source meeting app's bot (page.mjs, platforms.mjs and transcribe.mjs are copied from it). Audio only for now.

## Run it

- Locally: `npm install`, put `RECORDER_SECRET=...` in `recorder/.env`, then `npm start` (port 4360). It uses your installed Google Chrome. Install ffmpeg for seekable files and transcription from the audio; without ffmpeg the live captions are the transcript.
- On a server: build the Dockerfile here. It brings Chrome, a virtual screen, a virtual sound card and ffmpeg. Keep `/app/data` on a volume (the recordings live there).

Sprint2go needs the same secret, and where to find the recorder:

```
RECORDER_URL=http://localhost:4360
RECORDER_SECRET=the same long random string
PUBLIC_URL=https://your-sprint2go-address   # where the recorder can reach Sprint2go
```

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | 4360 | Port to listen on |
| `REC_DIR` | `./data/recordings` | Where the audio is kept |
| `MAX_BOTS` | 4 | Meetings at the same time |
| `ADMIT_TIMEOUT_MIN` | 10 | Give up if nobody lets the bot in |
| `ALONE_TIMEOUT_MIN` | 1 | Leave this long after everyone else has gone |
| `MAX_MEETING_MIN` | 180 | Longest meeting it records |

Transcription uses the company's speech key from Sprint2go (Groq, Deepgram, SumoPod Gemini or OpenAI). With none, the transcript comes from the meeting's live captions.
