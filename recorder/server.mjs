// Sprint2go's meeting recorder. Sprint2go asks it to send a bot to a meeting; each bot is its own
// process (bot.mjs) that reports back to Sprint2go by HTTP. Recordings stay here and Sprint2go
// streams them through its own server, so people never talk to this service directly.
//
//   POST   /bots                 { id, url, botName, callback, stt?, names?, announce? }  start a bot
//   POST   /bots/:id/stop        ask the bot to leave (it still transcribes what it has)
//   GET    /recordings/:id       the audio (WebM/Opus), with Range support for seeking
//   DELETE /recordings/:id       remove the audio
//   GET    /health               { ok, bots }
//
// Every call needs  Authorization: Bearer $RECORDER_SECRET  (the same secret signs the callbacks).
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

if (existsSync('.env')) process.loadEnvFile('.env');
const PORT = Number(process.env.PORT || 4360);
const SECRET = process.env.RECORDER_SECRET || '';
const REC_DIR = process.env.REC_DIR || join(process.cwd(), 'data', 'recordings');
const MAX_BOTS = Number(process.env.MAX_BOTS || 4);
if (!SECRET) { console.error('Set RECORDER_SECRET'); process.exit(1); }
mkdirSync(REC_DIR, { recursive: true });

const bots = new Map();   // id -> child process
const safeId = (s) => /^[\w-]{4,80}$/.test(s || '');

function authed(req) {
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
}
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (d) => { s += d; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

function startBot(job) {
  // The job holds an API key, so it goes in a private file the bot deletes on start, not in argv or env.
  const file = join(tmpdir(), `s2g-job-${job.id}.json`);
  writeFileSync(file, JSON.stringify({ ...job, secret: SECRET, recDir: REC_DIR }), { mode: 0o600 });
  const child = fork(new URL('./bot.mjs', import.meta.url).pathname, [file], { stdio: 'inherit' });
  bots.set(job.id, child);
  child.on('exit', () => bots.delete(job.id));
}

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/health') return json(res, 200, { ok: true, bots: bots.size });
    if (!authed(req)) return json(res, 401, { error: 'Not allowed' });

    if (pathname === '/bots' && req.method === 'POST') {
      const b = await readBody(req);
      if (!safeId(b.id) || !/^https:\/\/(meet\.google\.com|([\w-]+\.)?zoom\.us)\//.test(b.url || '') || !/^https?:\/\//.test(b.callback || '')) return json(res, 400, { error: 'Needs an id, a Google Meet or Zoom link, and a callback' });
      if (bots.has(b.id)) return json(res, 409, { error: 'That bot is already running' });
      if (bots.size >= MAX_BOTS) return json(res, 503, { error: `All ${MAX_BOTS} bots are busy` });
      startBot({ id: b.id, url: b.url, botName: String(b.botName || 'Notetaker').slice(0, 60), callback: b.callback, stt: b.stt ?? null, names: b.names ?? [], announce: b.announce !== false });
      return json(res, 202, { ok: true });
    }

    const stop = pathname.match(/^\/bots\/([\w-]+)\/stop$/);
    if (stop && req.method === 'POST') {
      const child = bots.get(stop[1]);
      if (!child) return json(res, 404, { error: 'No bot running for that meeting' });
      child.send({ stop: true });
      return json(res, 200, { ok: true });
    }

    const rec = pathname.match(/^\/recordings\/([\w-]+)$/);
    if (rec && safeId(rec[1])) {
      const file = join(REC_DIR, `${rec[1]}.webm`);
      if (req.method === 'DELETE') { rmSync(file, { force: true }); return json(res, 200, { ok: true }); }
      if (req.method !== 'GET') return json(res, 405, {});
      let size;
      try { size = statSync(file).size; } catch { return json(res, 404, { error: 'No recording' }); }
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { 'content-type': 'audio/webm', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
        return createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'content-type': 'audio/webm', 'accept-ranges': 'bytes', 'content-length': size });
      return createReadStream(file).pipe(res);
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'Something went wrong' });
  }
}).listen(PORT, () => console.log(`Recorder on :${PORT}, recordings in ${REC_DIR}`));

// Let running bots finish their meeting when the service is asked to stop.
process.on('SIGTERM', () => {
  for (const child of bots.values()) child.send({ stop: true });
  setTimeout(() => process.exit(0), bots.size ? 60_000 : 0);
});
