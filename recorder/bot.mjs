// One bot = one process = one meeting. The recorder server forks this with the job in a file
// (deleted as soon as it's read) and tells it to stop over IPC. Everything the bot learns goes
// back to sprint2go by HTTP: status, log lines, live captions, and at the end the transcript.
// Audio only: the meeting's mixed sound, recorded as Opus in WebM.
import { chromium } from 'playwright';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platforms } from './bot/platforms.mjs';
import { stopRecorder, startCompositeRecorder, grabTabAudio, audioLevel, hookAudioTracks, captionSnapshot, CaptionAssembler } from './bot/page.mjs';
import { fixRecording, durationSec, transcribeRecording, LANGUAGES, TRANSCRIBERS } from './transcribe.mjs';

const jobFile = process.argv[2];
const job = JSON.parse(readFileSync(jobFile, 'utf8'));
rmSync(jobFile, { force: true });
const { id, callback, secret, recDir } = job;
const platform = platforms[/zoom\./i.test(job.url) ? 'zoom' : 'meet'];

const ADMIT_TIMEOUT_MS = Number(process.env.ADMIT_TIMEOUT_MIN || 10) * 60_000;
const MAX_MEETING_MS = Number(process.env.MAX_MEETING_MIN || 180) * 60_000;
const ALONE_TIMEOUT_MS = Number(process.env.ALONE_TIMEOUT_MIN || 1) * 60_000;
const HEADLESS = process.env.BOT_HEADLESS === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- talking to sprint2go ---------- */

// Log lines and captions are batched and sent every 2 seconds; status changes go at once.
let pending = { log: [], utterances: [] };
let sending = Promise.resolve();
function post(body) {
  sending = sending.then(async () => {
    for (let i = 0; i < 4; i++) {
      const ok = await fetch(callback, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify({ id, ...body }) })
        .then((r) => r.ok, () => false);
      if (ok) return;
      await sleep(1000 * 2 ** i);
    }
    console.error(`[${id}] Could not reach sprint2go`);
  });
  return sending;
}
function flush() {
  if (!pending.log.length && !pending.utterances.length) return sending;
  const body = pending;
  pending = { log: [], utterances: [] };
  return post(body);
}
const flushTimer = setInterval(flush, 2000);
const log = (message) => {
  console.log(`[${id}] ${message}`);
  pending.log.push({ message, at: new Date().toISOString() });
};
const setStatus = (status, error) => {
  log(`Status: ${status}${error ? ` (${error})` : ''}`);
  return flush().then(() => post({ status, ...(error ? { error } : {}) }));
};

let stopAsked = false;
process.on('message', (m) => { if (m?.stop) stopAsked = true; });

/* ---------- the browser ---------- */

let browser;
let chromeProc;
let profileDir;
let recStart = 0;
let recDone;
let videoDone;
// <id>.webm is always the audio (what gets transcribed and played); <id>.video.webm only when video was asked for.
const recFile = join(recDir, `${id}.webm`);
const videoFile = join(recDir, `${id}.video.webm`);
const wantVideo = job.video === true;

function chromePath() {
  return [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome']
    .find((p) => p && existsSync(p));
}

async function launchBrowser() {
  const flags = [
    '--auto-accept-this-tab-capture',
    '--autoplay-policy=no-user-gesture-required',
    // Keep timers and audio running even when the window is covered or in the background.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--no-first-run', '--no-default-browser-check',
    '--lang=en-US', '--accept-lang=en-US,en',
    process.platform === 'linux' ? '--kiosk' : '--window-size=1280,807',
    '--window-position=0,0',
    ...(process.platform === 'linux' ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    '--disable-extensions', '--disable-sync', '--disable-component-update', '--disable-default-apps',
    '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion,InterestFeedContentSuggestions',
    '--metrics-recording-only', '--no-pings',
  ];
  if (HEADLESS) flags.push('--headless=new');
  if (process.getuid?.() === 0) flags.push('--no-sandbox');
  if (process.platform === 'linux') flags.push('--disable-dev-shm-usage');
  const exe = chromePath() || chromium.executablePath();
  profileDir = mkdtempSync(join(tmpdir(), 's2g-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  chromeProc = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, ...flags, '--app=about:blank'], { stdio: 'ignore', env: { ...process.env, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US:en' } });
  for (let i = 0; i < 60 && !browser; i++) {
    await sleep(250);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) throw new Error('Could not start Chrome');
  const context = browser.contexts()[0];
  for (const origin of ['https://meet.google.com', 'https://app.zoom.us', 'https://zoom.us']) {
    await context.grantPermissions(['microphone', 'camera'], { origin }).catch(() => {});
  }
  return context;
}

/* ---------- the meeting ---------- */

const captions = [];

async function main() {
  await setStatus('joining');
  // Anonymous guest in a real Chrome attached over CDP: Google Meet turns away browsers that look automated.
  const context = await launchBrowser();
  const page = context.pages()[0] || (await context.newPage());

  // With video, the page's main recorder writes the video and a second, cheap one writes the audio,
  // so the sound survives even if the video stutters. Audio only: the main recorder is the audio.
  const audioOut = createWriteStream(recFile);
  let resolveRec, resolveVideo;
  recDone = new Promise((r) => { resolveRec = r; });
  videoDone = new Promise((r) => { resolveVideo = r; });
  if (wantVideo) {
    const videoOut = createWriteStream(videoFile);
    await page.exposeFunction('__mbChunk', (b64) => { videoOut.write(Buffer.from(b64, 'base64')); });
    await page.exposeFunction('__mbRecStopped', () => videoOut.end(resolveVideo));
    await page.exposeFunction('__mbAudioChunk', (b64) => { audioOut.write(Buffer.from(b64, 'base64')); });
    await page.exposeFunction('__mbAudioStopped', () => audioOut.end(resolveRec));
  } else {
    resolveVideo();
    await page.exposeFunction('__mbChunk', (b64) => { audioOut.write(Buffer.from(b64, 'base64')); });
    await page.exposeFunction('__mbRecStopped', () => audioOut.end(resolveRec));
  }
  await page.exposeFunction('__mbRecState', (state, detail) => log(`Recorder ${state}: ${detail}`));

  await page.addInitScript(hookAudioTracks);
  const url = platform.joinUrl(job.url);
  log(`Opening ${platform.name}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await platform.prejoin(page, job.botName, log);

  const admitDeadline = Date.now() + ADMIT_TIMEOUT_MS;
  let waitingSaid = false;
  for (;;) {
    if (stopAsked) return finish(page, 'stopped');
    const state = await platform.state(page);
    if (state === 'in_call') break;
    if (state === 'denied') throw new Error(platform === platforms.meet ? 'Google Meet refused the bot. Meetings hosted from a personal Gmail account block guests' : 'The meeting refused to let the bot in');
    if (state === 'ended') throw new Error('The meeting ended before the bot was let in');
    if (state === 'waiting' && !waitingSaid) { waitingSaid = true; await setStatus('waiting_room'); }
    if (Date.now() > admitDeadline) throw new Error('Nobody let the bot in');
    await platform.dismissDialogs?.(page, log);
    await sleep(2000);
  }

  log('Let in');
  await sleep(2000);
  // Meet's live captions in the company's main meeting language (they default to English).
  const lang = job.stt?.languages?.[0] || job.stt?.language || 'auto';
  await platform.afterJoin(page, log, { captionLanguage: LANGUAGES[lang]?.meet && lang !== 'en' ? { name: LANGUAGES[lang].label.split(' (')[0], pattern: LANGUAGES[lang].meet } : null });
  if (job.announce !== false) await platform.announce(page, `Hi, I'm ${job.botName}. I'm recording this meeting${wantVideo ? '' : "'s audio"} and taking notes.`, log);

  await grabTabAudio(page);
  const r = await startCompositeRecorder(page, { video: wantVideo });
  log(`Recording ${wantVideo ? 'video (cameras and screen shares) and audio' : 'audio'}; sound from ${r.tabAudio ? 'the tab' : `${r.audioTracks} call stream${r.audioTracks === 1 ? '' : 's'}`}`);
  setTimeout(async () => {
    const lvl = await audioLevel(page, 8000).catch(() => null);
    if (lvl != null) log(lvl > 0.002 ? 'Sound is coming through' : 'Silent so far (nobody talking yet, or no sound reaching the bot)');
  }, 20000);
  recStart = Date.now();
  await setStatus('recording');
  await post({ startedAt: new Date(recStart).toISOString() });

  const assembler = new CaptionAssembler((speaker, text, at) => {
    const line = { speaker, text, at: Math.max(0, at - recStart) };
    captions.push({ speaker, text, t_ms: line.at });
    pending.utterances.push(line);
  });

  let aloneSince = null;
  let tick = 0;
  for (;;) {
    await sleep(1000);
    tick++;
    let snapshot = null;
    for (const frame of page.frames()) {
      snapshot = await frame.evaluate(captionSnapshot, platform.captionSelectors).catch(() => null);
      if (snapshot) break;
    }
    assembler.push(snapshot, Date.now());

    if (stopAsked) { assembler.flush(); log('Asked to leave'); return finish(page); }
    if (tick % 5) continue;
    await platform.ensureMuted?.(page, log);
    await platform.dismissDialogs?.(page);
    const s = await platform.state(page);
    if (s === 'ended' || s === 'denied') { log('The meeting ended'); assembler.flush(); return finish(page); }
    if (Date.now() - recStart > MAX_MEETING_MS) { log('Hit the maximum meeting length'); assembler.flush(); return finish(page); }
    const n = await platform.participants(page);
    if (n !== null && n <= 1) {
      aloneSince ??= Date.now();
      if (Date.now() - aloneSince > ALONE_TIMEOUT_MS) { log('Everyone else left'); assembler.flush(); return finish(page); }
    } else aloneSince = null;
  }
}

async function finish(page, finalStatus) {
  if (recStart) {
    await stopRecorder(page);
    await Promise.race([Promise.all([recDone, videoDone]), sleep(15000)]);
  }
  await platform.leave(page).catch(() => {});
  log('Left the meeting');
  await browser.close().catch(() => {});
  if (finalStatus === 'stopped' && !recStart) return setStatus('stopped');
  await setStatus('processing');

  // Seekable file with the right length.
  // Without ffmpeg (a dev machine) the file is still fine to play; the meeting's own length stands in.
  const seconds = (await fixRecording(recFile).catch((e) => (log(`Could not tidy the recording: ${e.message}`), null))) ?? (await durationSec(recFile)) ?? (existsSync(recFile) ? (Date.now() - recStart) / 1000 : null);
  const mb = (f) => (existsSync(f) ? Math.round((statSync(f).size / 1048576) * 10) / 10 : 0);
  const sizeMb = mb(recFile);
  let videoMb = 0;
  if (wantVideo && existsSync(videoFile)) {
    await fixRecording(videoFile).catch(() => {});
    videoMb = mb(videoFile);
  }

  // Transcript: from the recording when a speech service is set (much better than captions outside
  // English); names come from the captions. Otherwise the live captions are the transcript.
  // Kept next to the audio so "Transcribe again" later still knows who spoke when.
  try { writeFileSync(join(recDir, `${id}.captions.json`), JSON.stringify(captions)); } catch {}
  let transcript = captions.map((c) => ({ speaker: c.speaker, text: c.text, at: c.t_ms }));
  const stt = job.stt;
  if (seconds && stt?.provider && stt.apiKey && TRANSCRIBERS[stt.provider]) {
    try {
      const lines = await transcribeRecording(recFile, stt, captions, { names: job.names ?? [], log });
      if (lines.length) {
        transcript = lines.map((l) => ({ speaker: l.speaker, text: l.text, at: l.t_ms }));
        log(`Transcribed with ${TRANSCRIBERS[stt.provider].short}`);
      } else log('The speech service heard no words; kept the live captions');
    } catch (e) {
      log(`Transcription failed (${e.message.slice(0, 160)}); kept the live captions`);
    }
  } else if (!transcript.length) log('No captions came through and no speech service is set, so there is no transcript');

  await flush();
  await post({ status: 'recorded', recording: seconds ? { seconds: Math.round(seconds), sizeMb, ...(videoMb ? { videoMb } : {}) } : null, transcript });
}

main()
  .catch(async (err) => {
    const page = browser?.contexts?.()[0]?.pages?.()[0];
    if (page) {
      const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (text) log(`Page said: ${text.replace(/\s+/g, ' ').slice(0, 600)}`);
    }
    await setStatus('failed', err.message.split('\n')[0]);
    console.error(err);
    await browser?.close().catch(() => {});
  })
  .finally(async () => {
    clearInterval(flushTimer);
    await flush();
    await sending;
    chromeProc?.kill();
    try { if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
    process.exit(0);
  });
