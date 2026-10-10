// The models a key can use, end to end, against fake providers on this machine (no real keys, nothing leaves it):
// a company adds a SumoPod key and gets SumoPod's own model list, picks a model that isn't in our catalogue, a job runs
// with exactly that id, SumoPod drops it, the job falls back and moves to the job's fallback with a note in Settings.
// Anthropic's and Gemini's own list formats come through too, and the operator console picks our models from the
// provider's list, sees one go missing and fills in a missing price.
//   node scripts/ai-models-e2e.mjs
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('..', import.meta.url).pathname;
const freePort = () =>
  new Promise((res, rej) => {
    const s = netServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- the fake providers ---------- */

const sumo = {
  listed: ['claude-opus-5-5', 'claude-haiku-4-5', 'deepseek-v4-flash', 'kimi-k2-0905', 'glm-4.6', 'text-embedding-3-small', 'whisper-large-v3'],
  hidden: ['secret-model-1'], // answers, but isn't on the list (a model id typed in)
};
const calls = []; // { provider, model, key }
const keyOk = (k) => /^(sk-test-|sk-ant-test-|AIza-test-)/.test(k ?? '');
const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const fake = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const body = raw ? JSON.parse(raw) : {};
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (u.pathname === '/sumopod/v1/models' && req.method === 'GET') {
      if (!keyOk(bearer)) return send(res, 401, { error: { message: 'Invalid API key' } });
      return send(res, 200, { object: 'list', data: sumo.listed.map((id) => ({ id, object: 'model', created: 1760000000, owned_by: 'sumopod' })) });
    }
    if (u.pathname === '/sumopod/v1/chat/completions' && req.method === 'POST') {
      if (!keyOk(bearer)) return send(res, 401, { error: { message: 'Invalid API key' } });
      calls.push({ provider: 'sumopod', model: body.model, key: bearer });
      if (!sumo.listed.includes(body.model) && !sumo.hidden.includes(body.model)) return send(res, 404, { error: { message: `The model \`${body.model}\` does not exist`, code: 'model_not_found' } });
      const content = body.response_format ? JSON.stringify({ summary: `Answered by ${body.model}.`, asks: [], replies: ['Monday works', 'Let me check', 'Yes'] }) : 'ok';
      return send(res, 200, { id: 'c1', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5 } });
    }
    if (u.pathname === '/anthropic/v1/models' && req.method === 'GET') {
      if (!keyOk(req.headers['x-api-key'])) return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      return send(res, 200, {
        data: [
          { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' },
          { type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
          { type: 'model', id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5', created_at: '2025-09-29T00:00:00Z' },
        ],
        has_more: false,
        first_id: 'claude-opus-5-5',
        last_id: 'claude-sonnet-4-5-20250929',
      });
    }
    if (u.pathname === '/anthropic/v1/messages' && req.method === 'POST') {
      if (!keyOk(req.headers['x-api-key'])) return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      calls.push({ provider: 'anthropic', model: body.model, key: req.headers['x-api-key'] });
      return send(res, 200, { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } });
    }
    if (u.pathname === '/gemini/v1beta/models' && req.method === 'GET') {
      if (!keyOk(req.headers['x-goog-api-key']) || u.searchParams.get('key')) return send(res, 403, { error: { message: 'API key not valid' } });
      return send(res, 200, {
        models: [
          { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/gemini-3.1-pro', displayName: 'Gemini 3.1 Pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
        ],
      });
    }
    if (u.pathname === '/gemini/v1beta/openai/chat/completions' && req.method === 'POST') {
      if (!keyOk(bearer)) return send(res, 401, { error: { message: 'API key not valid' } });
      calls.push({ provider: 'google', model: body.model, key: bearer });
      return send(res, 200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    }
    send(res, 404, { error: { message: 'no such route' } });
  });
});
const fakePort = await freePort();
await new Promise((r) => fake.listen(fakePort, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fakePort}`;

/* ---------- the app ---------- */

const dir = mkdtempSync(join(tmpdir(), 's2g-aimodels-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
const env = {
  ...process.env,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  MAIL_ENABLED: '0',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  S2G_OPERATORS: 'raka@demo.sprint2go.com',
  ANTHROPIC_API_KEY: '',
  SES_KEY: '',
  SES_SECRET: '',
  S3_BUCKET: '',
  CF_DNS_TOKEN: '',
  PUBLIC_URL: '',
  RECORDER_URL: '',
  S2G_AI_TEST_BASES: JSON.stringify({ sumopod: `${FAKE}/sumopod/v1`, anthropic: `${FAKE}/anthropic`, google: `${FAKE}/gemini/v1beta/openai`, 'google-native': `${FAKE}/gemini/v1beta` }),
};
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const finish = (code) => {
  server.kill('SIGTERM');
  fake.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the server may still hold a file for a moment */
  }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 120_000).unref();

/** The 6-digit code for a base32 secret (RFC 6238), like an authenticator app. */
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = secret.replace(/[\s=-]/g, '').toUpperCase().split('').map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

try {
  for (let i = 0; i < 300 && !/sprint2go on http/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  check(/sprint2go on http/.test(log), 'the server starts');
  if (!/sprint2go on http/.test(log)) finish(1);

  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const base = `http://127.0.0.1:${httpPort}`;
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const waitFor = async (fn, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      const v = await fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  };
  const signIn = async (email) => {
    // The demo's passwords are hashed in the background on the first run: a moment after "listening", they're all there.
    const login = () => fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.SEED_PASSWORD }) });
    let r = await login();
    for (let i = 0; i < 30 && r.status === 401; i++) (await sleep(200), (r = await login()));
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = async (r) => ({ status: r.status, text: await r.clone().text(), ...(await r.json().catch(() => ({}))) });
    return {
      ok: r.ok && cookie.startsWith('s2g='),
      why: r.ok ? '' : `${r.status} ${await r.clone().text()}`,
      get: (path) => call('GET', path).then(j),
      post: (path, body) => call('POST', path, body).then(j),
      sync: (coll, upserts) => call('POST', '/api/sync', { coll, upserts, deletes: [] }).then(j),
    };
  };
  const raka = await signIn('raka@demo.sprint2go.com');
  const intan = await signIn('intan@demo.sprint2go.com');
  check(raka.ok && intan.ok, `the owner and a member sign in (${raka.why} ${intan.why})`);

  /* ---------- a company adds a SumoPod key and picks from SumoPod's own list ---------- */
  const bad = await raka.post('/api/ai/keys', { workspaceId: 'pnp', provider: 'sumopod', key: 'sk-wrong-000000000000' });
  check(bad.status === 400 && /rejected the key/.test(bad.error ?? ''), `a key the provider rejects isn’t saved (${bad.error})`);
  const SUMO_KEY = 'sk-test-sumopod-key-0001';
  const added = await raka.post('/api/ai/keys', { workspaceId: 'pnp', provider: 'sumopod', key: SUMO_KEY });
  check(added.status === 200 && added.keyLast4 === '0001', 'the key is tested and saved; only its last 4 come back');
  check(!added.text.includes(SUMO_KEY), 'the key never comes back to the browser');
  const ids = (l) => (l?.models ?? []).map((m) => m.id);
  check(added.models?.source === 'live' && ids(added.models).includes('kimi-k2-0905') && ids(added.models).includes('glm-4.6'), 'saving returns SumoPod’s own list, models outside our catalogue included');
  check(!ids(added.models).some((id) => /embedding/.test(id)), 'no embeddings in it');
  const opus = added.models.models.find((m) => m.id === 'claude-opus-5-5');
  const kimi = added.models.models.find((m) => m.id === 'kimi-k2-0905');
  check(added.models.models[0].id === 'claude-opus-5-5' && opus.name === 'Claude Opus 5.5' && opus.price?.[0] === 4, 'catalogue models first, with their names and prices');
  check(kimi.name === 'Kimi K2 0905' && kimi.price === null && !kimi.recommended, 'the rest get a readable name and no price');
  check(calls.some((c) => c.provider === 'sumopod' && c.model === 'claude-haiku-4-5'), 'the key was tested on a model SumoPod offers');

  const denied = await intan.get('/api/ai/models?workspaceId=pnp&provider=sumopod');
  check(denied.status === 403, 'a member can’t read the company’s model lists');
  const listed = await raka.get('/api/ai/models?workspaceId=pnp&provider=sumopod');
  check(listed.status === 200 && listed.source === 'live' && ids(listed).includes('kimi-k2-0905') && !listed.text.includes(SUMO_KEY), 'an admin reads the list (kept on the server), without the key');

  const typedOk = await raka.post('/api/ai/models/check', { workspaceId: 'pnp', provider: 'sumopod', model: 'secret-model-1' });
  check(typedOk.status === 200 && typedOk.ok, 'a model id typed in is tried with one call and works');
  const typedBad = await raka.post('/api/ai/models/check', { workspaceId: 'pnp', provider: 'sumopod', model: 'no-such-model' });
  check(typedBad.status === 400 && /doesn’t offer/.test(typedBad.error ?? ''), `one that isn’t there says so (${typedBad.error})`);
  const typedJunk = await raka.post('/api/ai/models/check', { workspaceId: 'pnp', provider: 'sumopod', model: 'https://evil.example/x?y' });
  check(typedJunk.status === 400 && !calls.some((c) => /evil/.test(c.model)), 'something that isn’t a model id is never sent');
  check((await intan.post('/api/ai/models/check', { workspaceId: 'pnp', provider: 'sumopod', model: 'kimi-k2-0905' })).status === 403, 'a member can’t try models on the company’s key');

  // The admin picks Kimi K2 (not in our catalogue) for summaries, DeepSeek V4 Flash as the key's model, and a typed id for replies.
  const pnp = doc('workspaces', 'pnp');
  const ai = {
    ...pnp.ai,
    payer: 'own',
    preset: 'custom',
    providers: [{ id: 'sumopod', keyLast4: '0001', addedAt: new Date().toISOString(), addedBy: 'u-raka', status: 'ok', spentUsd: 0, model: 'deepseek-v4-flash' }],
    jobs: { ...pnp.ai.jobs, summary: { provider: 'sumopod', model: 'kimi-k2-0905' }, replies: { provider: 'sumopod', model: 'secret-model-1', typed: true } },
  };
  await raka.sync('workspaces', [{ ...pnp, ai }]);
  check(doc('workspaces', 'pnp').ai.jobs.summary.model === 'kimi-k2-0905', 'the pick is saved');
  const thread = { id: 't1', subject: 'Launch', messages: [{ from: 'budi@client.example', to: 'raka@demo.sprint2go.com', date: new Date().toISOString(), body: 'Can we launch Monday?' }] };
  calls.length = 0;
  const s1 = await raka.post('/api/ai/summarize', { workspaceId: 'pnp', thread });
  check(s1.status === 200 && /kimi-k2-0905/.test(s1.summary ?? ''), 'the job runs');
  check(calls.length === 1 && calls[0].model === 'kimi-k2-0905' && calls[0].key === SUMO_KEY, `with exactly the model id picked, on the company’s key (${calls.map((c) => c.model).join(', ')})`);
  calls.length = 0;
  await raka.post('/api/ai/replies', { workspaceId: 'pnp', thread, me: 'raka@demo.sprint2go.com' });
  check(calls[0]?.model === 'secret-model-1', 'a typed model id is sent as typed');

  // SumoPod stops offering Kimi K2.
  sumo.listed = sumo.listed.filter((m) => m !== 'kimi-k2-0905');
  calls.length = 0;
  const s2 = await raka.post('/api/ai/summarize', { workspaceId: 'pnp', thread });
  check(s2.status === 200 && calls.map((c) => c.model).join(',') === 'kimi-k2-0905,deepseek-v4-flash', `the job still answers, on its fallback (${calls.map((c) => c.model).join(', ')})`);
  const moved = await waitFor(() => {
    const a = doc('workspaces', 'pnp').ai;
    return a.jobs.summary.model === 'deepseek-v4-flash' && a.notes?.length ? a : null;
  });
  check(!!moved, 'the job moves to its fallback once SumoPod’s list says Kimi K2 is gone');
  check(/^SumoPod no longer offers Kimi K2 0905; summaries & catch me up moved to DeepSeek V4 Flash\.$/.test(moved?.notes?.[0]?.text ?? ''), `with a note for Settings: “${moved?.notes?.[0]?.text}”`);
  check(moved?.jobs.replies.model === 'secret-model-1', 'a typed model id isn’t on lists, so it stays');
  calls.length = 0;
  await raka.post('/api/ai/summarize', { workspaceId: 'pnp', thread });
  check(calls.map((c) => c.model).join(',') === 'deepseek-v4-flash', 'the next run goes straight to the new model');

  /* ---------- Anthropic's and Gemini's own lists ---------- */
  const ant = await raka.post('/api/ai/keys', { workspaceId: 'pnp', provider: 'anthropic', key: 'sk-ant-test-anthropic-0002' });
  check(ant.status === 200 && ant.models?.source === 'live' && ids(ant.models).join(',') === 'claude-opus-5-5,claude-haiku-4-5,claude-sonnet-4-5-20250929', `Anthropic’s list (${ids(ant.models).join(', ')})`);
  check(ant.models?.models[2]?.name === 'Claude Sonnet 4.5', 'with Anthropic’s own names');
  const gem = await raka.post('/api/ai/keys', { workspaceId: 'pnp', provider: 'google', key: 'AIza-test-gemini-key-0003' });
  check(gem.status === 200 && gem.models?.source === 'live' && ids(gem.models).join(',') === 'gemini-3.1-pro,gemini-3.5-flash', `Gemini’s list, only models that write text (${ids(gem.models).join(', ')})`);

  /* ---------- the operator console: our keys ---------- */
  const setup = await raka.post('/api/admin/2fa/setup', {});
  const verified = await raka.post('/api/admin/2fa/verify', { code: totp(setup.secret ?? '') });
  check(verified.status === 200, 'the operator confirms two-step sign-in');
  sumo.listed.push('kimi-k2-0905');
  const ourKey = await raka.post('/api/admin/ai/key', { provider: 'sumopod', key: 'sk-test-ours-0004' });
  check(ourKey.status === 200 && ourKey.last4 === '0004', 'an operator adds our SumoPod key');
  let ov = await raka.get('/api/admin/ai');
  const sumoOpts = (ov.options?.text ?? []).filter((o) => o.provider === 'sumopod').map((o) => o.model);
  check(sumoOpts.includes('glm-4.6') && sumoOpts.includes('kimi-k2-0905') && !sumoOpts.includes('qwen3.7-plus'), 'Models per job offers SumoPod’s own list for our key, not the catalogue');
  check(ov.lists?.some((l) => l.provider === 'sumopod' && l.source === 'live'), 'and says where the list came from');
  const notOffered = await raka.post('/api/admin/ai/job', { job: 'summary', primary: { provider: 'sumopod', model: 'qwen3.7-plus' }, fallback: null });
  check(notOffered.status === 400, 'a model SumoPod doesn’t offer our key can’t be picked');
  const picked = await raka.post('/api/admin/ai/job', { job: 'summary', primary: { provider: 'sumopod', model: 'glm-4.6' }, fallback: { provider: 'sumopod', model: 'deepseek-v4-flash' } });
  check(picked.status === 200, 'GLM 4.6 (not in the catalogue) is picked for summaries');
  ov = await raka.get('/api/admin/ai');
  const glm = ov.prices?.find((p) => p.model === 'glm-4.6');
  check(!!glm && glm.price === null && glm.usedBy.includes('summary'), 'it shows in the price list without a price');
  check(ov.problems?.some((p) => p.kind === 'ai-prices' && /No price for .*(GLM 4\.6|more)/.test(p.text)), 'and the AI page asks for the missing prices');
  const kimiRow = ov.prices?.find((p) => p.model === 'kimi-k2-0905');
  check(!!kimiRow && kimiRow.uses > 0 && kimiRow.price === null, 'a model companies used this month without a price is listed for operators too');
  const priced = await raka.post('/api/admin/ai/prices', { prices: { 'glm-4.6': [0.6, 2.2] } });
  ov = await raka.get('/api/admin/ai');
  check(priced.status === 200 && JSON.stringify(ov.prices.find((p) => p.model === 'glm-4.6')?.price) === '[0.6,2.2]', 'an operator fills in its price');
  // SumoPod stops offering GLM 4.6 to our key.
  sumo.listed = sumo.listed.filter((m) => m !== 'glm-4.6');
  await raka.post('/api/admin/ai/models/refresh', {});
  ov = await raka.get('/api/admin/ai');
  const sj = ov.jobs?.find((j) => j.id === 'summary');
  check(sj?.state === 'fallback' && /SumoPod no longer offers GLM 4\.6/.test(sj?.gone ?? ''), `summaries run on their fallback (${sj?.state}: ${sj?.gone})`);
  check(ov.problems?.some((p) => p.kind === 'ai-gone:summary' && p.to === '/admin/ai/models'), 'and the AI page says so');
  check(!JSON.stringify(ov).includes('sk-test-ours-0004'), 'our key never comes back either');

  finish(failed ? 1 : 0);
} catch (e) {
  console.log(`FAIL ${e instanceof Error ? e.stack : e}`);
  finish(1);
}
