// Sprint2go local server: the app, its database, logins, live updates and the AI router, on one port.
// Run:  npm run server   (after `npm run build`), then open http://localhost:8787
// In development, `npm run dev` proxies /api here, so run both.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import * as ai from './ai.ts';
import { AIError, testKey, withAI, type AIConfig } from './llm.ts';
import { seed, RECORD_KEYS, type CollectionKey } from '../src/seed.ts';
import { JOBS, PROVIDERS } from '../src/data/aiCatalog.ts';

for (const f of ['.env', '.env.example']) if (existsSync(f)) process.loadEnvFile(f); // .env wins: values already set are kept
const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1'; // localhost only
const DIST = join(process.cwd(), 'dist');

/* ---------- first run: copy the demo company into the database ---------- */

const COLLS = Object.keys(seed()) as CollectionKey[];
const toDocs = (key: CollectionKey, value: unknown): db.Doc[] =>
  RECORD_KEYS.includes(key) ? Object.entries(value as Record<string, unknown>).map(([id, v]) => ({ id, value: v })) : (value as db.Doc[]);

if (db.isEmpty()) {
  const s = seed();
  for (const k of COLLS) db.writeDocs(k, toDocs(k, s[k]), [], null);
  const pw = process.env.SEED_PASSWORD;
  if (!pw) throw new Error('Set SEED_PASSWORD in .env (see .env.example) before the first run.');
  for (const u of s.users) db.setLogin(u.id, u.email, pw);
  console.log(`Seeded the demo company: ${s.users.length} people can sign in with the password in .env / .env.example.`);
}

/* ---------- helpers ---------- */

type Ws = { id: string; members: { userId: string; role: string }[]; accounts?: { id: string }[]; ai?: { jobs?: Record<string, { provider: string; model: string }>; providers?: { id: string; status: string }[]; payer?: string } };
const workspaces = () => db.allDocs('workspaces') as unknown as Ws[];
const memberOf = (userId: string) => workspaces().filter((w) => w.members.some((m) => m.userId === userId));
const isAdminOf = (userId: string, wsId: string) => workspaces().some((w) => w.id === wsId && w.members.some((m) => m.userId === userId && m.role !== 'member'));

/**
 * What one person may see. Workspaces they're not in, mailboxes they're not on, private channels and DMs they're
 * not in (and those messages), and other people's notifications stay on the server.
 */
function viewer(userId: string) {
  const ws = workspaces();
  const mine = new Set(ws.filter((w) => w.members.some((m) => m.userId === userId)).map((w) => w.id));
  const accounts = new Map(ws.flatMap((w) => ((w.accounts ?? []) as { id: string; users?: string[] }[]).map((a) => [a.id, { ws: w.id, users: a.users ?? [] }] as const)));
  const channels = new Map((db.allDocs('channels') as any[]).map((c) => [String(c.id), c]));
  const channelOk = (c: any) => !!c && mine.has(c.workspaceId) && (!(c.private || c.kind === 'dm') || (c.members ?? []).includes(userId));
  return (coll: string, d: any): boolean => {
    switch (coll) {
      case 'users':
        return true;
      case 'workspaces':
        return mine.has(d.id);
      case 'channels':
        return channelOk(d);
      case 'messages':
        return channelOk(channels.get(d.channelId));
      case 'notices':
        return d.userId === userId;
      case 'threads': {
        const a = accounts.get(d.accountId);
        return !!a && mine.has(a.ws) && a.users.includes(userId);
      }
      default:
        return typeof d.workspaceId !== 'string' || mine.has(d.workspaceId);
    }
  };
}
function visibleState(userId: string) {
  const canSee = viewer(userId);
  const out: Record<string, db.Doc[]> = {};
  for (const k of COLLS) out[k] = db.allDocs(k).filter((d) => canSee(k, d));
  return out;
}

const cookie = (req: IncomingMessage, name: string) => req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);
async function body(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000_000) throw new AIError('Too large', 413);
  }
  return raw ? JSON.parse(raw) : {};
}
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
};

/* ---------- live updates (server-sent events) ---------- */

const clients = new Map<string, { res: ServerResponse; userId: string }>();
/** Sends a change to every open window, each getting only what that person may see. */
function broadcast(coll: string, upserts: db.Doc[], deletes: string[], except?: string) {
  if (!upserts.length && !deletes.length) return;
  const views = new Map<string, ReturnType<typeof viewer>>();
  for (const [id, c] of clients) {
    if (id === except) continue;
    if (!views.has(c.userId)) views.set(c.userId, viewer(c.userId));
    const canSee = views.get(c.userId)!;
    const mine = upserts.filter((d) => canSee(coll, d));
    if (mine.length || deletes.length) c.res.write(`event: change\ndata: ${JSON.stringify({ coll, upserts: mine, deletes })}\n\n`);
  }
}
setInterval(() => clients.forEach((c) => c.res.write(': ping\n\n')), 25_000);

/* ---------- AI: which provider and model does each job ---------- */

const JOB_OF: Record<string, string> = {
  summarize: 'summary',
  catchup: 'summary',
  folderoverview: 'summary',
  replies: 'replies',
  draft: 'draft',
  rewrite: 'draft',
  todos: 'todos',
  assistant: 'ask',
  askmeetings: 'ask',
  braindump: 'braindump',
  meetingnotes: 'meeting',
};
function aiFor(wsId: string, job: string): AIConfig | null {
  const ws = workspaces().find((w) => w.id === wsId);
  const pick = ws?.ai?.jobs?.[job];
  const rec = JOBS.find((j) => j.id === job)?.rec;
  if (pick && pick.provider !== 'included') {
    const k = db.loadKey(wsId, pick.provider);
    if (k) return { provider: pick.provider, model: pick.model, apiKey: k.key, baseUrl: k.baseUrl };
  }
  // Included AI (Sprint2go pays): the server's own Claude key.
  if (process.env.ANTHROPIC_API_KEY && ws?.ai?.payer !== 'own') return { provider: 'anthropic', model: rec?.balanced?.startsWith('claude') ? rec.balanced : 'claude-sonnet-5-5', apiKey: process.env.ANTHROPIC_API_KEY };
  // Otherwise any key the company saved, with that provider's model for this kind of job.
  for (const p of ws?.ai?.providers ?? []) {
    const k = db.loadKey(wsId, p.id);
    const info = PROVIDERS.find((x) => x.id === p.id);
    if (!k || !info || info.kind === 'speech') continue;
    const wanted = [rec?.balanced, rec?.best, rec?.cheap].find((m) => info.models.some((x) => x.id === m));
    return { provider: p.id, model: wanted ?? info.models.find((m) => m.tier === 'balanced')?.id ?? info.models[0].id, apiKey: k.key, baseUrl: k.baseUrl };
  }
  return null;
}

const routes: Record<string, (b: any) => Promise<unknown>> = {
  summarize: (b) => ai.summarize(b.thread),
  replies: (b) => ai.replies(b.thread, b.me),
  draft: (b) => ai.draft(b),
  rewrite: (b) => ai.rewrite(b.text, b.style),
  todos: (b) => ai.todos(b.thread, b.me, b.today),
  assistant: (b) => ai.assistant(b.question, b.threads, b.me, b.today),
  braindump: (b) => ai.braindump(b),
  catchup: (b) => ai.catchUp(b),
  meetingnotes: (b) => ai.meetingNotes(b),
  folderoverview: (b) => ai.folderOverview(b),
  askmeetings: (b) => ai.askMeetings(b),
};

/* ---------- the app itself ---------- */

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // single-page app
  if (!existsSync(file)) {
    res.statusCode = 404;
    return res.end('Build the app first: npm run build');
  }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}

/* ---------- routes ---------- */

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(req, res);
  try {
    // Sign in / out
    if (p === '/api/login' && req.method === 'POST') {
      const { email, password } = await body(req);
      const login = typeof email === 'string' && db.findLogin(email.trim());
      if (!login || typeof password !== 'string' || !db.checkPassword(password, login.pw_hash)) return json(res, 401, { error: 'Wrong email or password.' });
      const token = db.newSession(login.user_id);
      res.setHeader('set-cookie', `s2g=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
      return json(res, 200, { me: login.user_id });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const t = cookie(req, 's2g');
      if (t) db.endSession(t);
      res.setHeader('set-cookie', 's2g=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return json(res, 200, {});
    }

    // Accepting an invite: the new person sets a password and is signed in.
    if (p === '/api/invite/check' && req.method === 'POST') {
      const inv = db.peekInvite(String((await body(req)).token ?? ''));
      return inv ? json(res, 200, { email: inv.email }) : json(res, 404, { error: 'This invite link has expired or was already used.' });
    }
    if (p === '/api/invite/accept' && req.method === 'POST') {
      const { token, password } = await body(req);
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      const inv = db.claimInvite(String(token ?? ''));
      if (!inv) return json(res, 404, { error: 'This invite link has expired or was already used.' });
      db.setLogin(inv.user_id, inv.email, password);
      res.setHeader('set-cookie', `s2g=${db.newSession(inv.user_id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
      return json(res, 200, { me: inv.user_id });
    }

    const me = db.sessionUser(cookie(req, 's2g'));
    if (!me) return json(res, 401, { error: 'Sign in first.' });

    if (p === '/api/me') return json(res, 200, { me });
    if (p === '/api/state') return json(res, 200, visibleState(me));

    if (p === '/api/password' && req.method === 'POST') {
      const { current, next } = await body(req);
      const u = db.getDoc('users', me) as { email?: string } | undefined;
      const login = u?.email && db.findLogin(u.email);
      if (!login || !db.checkPassword(String(current ?? ''), login.pw_hash)) return json(res, 400, { error: 'Your current password is wrong.' });
      if (typeof next !== 'string' || next.length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });
      db.setLogin(me, u.email!, next);
      return json(res, 200, {});
    }

    // An admin invites someone: they get a link to set their own password.
    if (p === '/api/invite' && req.method === 'POST') {
      const { userId, email } = await body(req);
      if (!memberOf(me).some((w) => isAdminOf(me, w.id))) return json(res, 403, { error: 'Only admins can invite people.' });
      if (typeof email !== 'string' || !email.includes('@')) return json(res, 400, { error: 'Invalid email' });
      const taken = db.findLogin(email);
      if (taken && taken.user_id !== userId) return json(res, 409, { error: 'Someone already uses that email.' });
      return json(res, 200, { link: `/?invite=${db.newInvite(String(userId), email)}` });
    }

    // Saves changes and tells everyone else who has the app open.
    if (p === '/api/sync' && req.method === 'POST') {
      const { coll, upserts = [], deletes = [] } = await body(req);
      if (!COLLS.includes(coll)) return json(res, 400, { error: 'Unknown collection' });
      const mine = new Set(memberOf(me).map((w) => w.id));
      const canSee = viewer(me);
      // Nobody can write into a workspace they're not in, or change or delete something they can't see.
      const ok = (upserts as db.Doc[]).filter((d) => {
        if (!d || typeof d.id !== 'string') return false;
        const before = db.getDoc(coll, d.id);
        if (before && !canSee(coll, before)) return false;
        return coll !== 'workspaces' ? typeof d.workspaceId !== 'string' || mine.has(d.workspaceId) : mine.has(d.id) || !before;
      });
      const dels = (deletes as string[]).filter((id) => {
        const before = db.getDoc(coll, id);
        return !before || canSee(coll, before);
      });
      db.writeDocs(coll, ok, dels, me);
      broadcast(coll, ok, dels, req.headers['x-conn'] as string | undefined);
      return json(res, 200, { saved: ok.length });
    }

    if (p === '/api/events') {
      const id = randomBytes(8).toString('hex');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ conn: id })}\n\n`);
      clients.set(id, { res, userId: me });
      req.on('close', () => clients.delete(id));
      return;
    }

    // AI keys: kept encrypted here; the browser only ever sees the last 4 characters.
    if (p === '/api/ai/keys' && req.method === 'POST') {
      const { workspaceId, provider, key, baseUrl, test = true } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: 'Only admins can add AI keys.' });
      const info = PROVIDERS.find((x) => x.id === provider);
      if (!info || typeof key !== 'string' || key.trim().length < 8) return json(res, 400, { error: 'That key looks too short.' });
      if (test && info.kind !== 'speech') {
        try {
          await testKey({ provider, model: info.models.find((m) => m.tier === 'fast')?.id ?? info.models[0].id, apiKey: key.trim(), baseUrl });
        } catch (e) {
          return json(res, 400, { error: e instanceof AIError ? e.message : (e as { status?: number }).status === 401 ? 'That key was rejected. Check it and try again.' : 'The key did not work.' });
        }
      }
      db.saveKey(workspaceId, provider, key.trim(), baseUrl, me);
      return json(res, 200, { keyLast4: key.trim().slice(-4) });
    }
    if (p === '/api/ai/keys' && req.method === 'DELETE') {
      const { workspaceId, provider } = await body(req);
      if (!isAdminOf(me, workspaceId)) return json(res, 403, { error: 'Only admins can remove AI keys.' });
      db.deleteKey(workspaceId, provider);
      return json(res, 200, {});
    }
    if (p === '/api/ai/status') {
      const wsId = url.searchParams.get('ws') ?? '';
      if (!memberOf(me).some((w) => w.id === wsId)) return json(res, 403, {});
      return json(res, 200, { live: Object.values(JOB_OF).some((j) => !!aiFor(wsId, j)) });
    }
    const action = p.match(/^\/api\/ai\/(\w+)$/)?.[1];
    if (action && routes[action] && req.method === 'POST') {
      const b = await body(req);
      if (!memberOf(me).some((w) => w.id === b.workspaceId)) return json(res, 403, { error: 'Not in this workspace.' });
      const cfg = aiFor(b.workspaceId, JOB_OF[action]);
      if (!cfg) return json(res, 409, { error: 'no-key' });
      return json(res, 200, await withAI(cfg, () => routes[action](b)));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err instanceof AIError ? err.status : (err as { status?: number }).status === 429 ? 503 : 500;
    console.error(`[${p}]`, err instanceof Error ? err.message : err);
    // Never leak keys or raw upstream errors.
    json(res, status, { error: err instanceof AIError ? err.message : status === 503 ? 'AI is busy, try again shortly.' : 'Something went wrong.' });
  }
}).listen(PORT, HOST, () => console.log(`Sprint2go on http://localhost:${PORT}`));

/* ---------- background jobs: scheduled mail, snoozes, task reminders ---------- */

setInterval(() => {
  const now = new Date().toISOString();
  const threads = (db.allDocs('threads') as any[]).flatMap((t) => {
    if (t.sendAt && t.sendAt <= now) return [{ ...t, sendAt: undefined, location: 'archive', messages: t.messages.map((m: any) => ({ ...m, date: now })) }];
    if (t.snoozedUntil && t.snoozedUntil <= now) return [{ ...t, snoozedUntil: undefined, unread: true }];
    return [];
  });
  if (threads.length) {
    db.writeDocs('threads', threads, [], null);
    broadcast('threads', threads, []);
  }
  const due = (db.allDocs('todos') as any[]).filter((t) => t.remindAt && !t.reminded && !t.done && t.remindAt <= now);
  if (due.length) {
    const todos = due.map((t) => ({ ...t, reminded: true }));
    const notices = due.flatMap((t) =>
      (t.assignees?.length ? t.assignees : [t.userId || t.createdBy]).filter(Boolean).map((who: string) => ({
        id: randomBytes(6).toString('hex'),
        userId: who,
        workspaceId: t.workspaceId ?? '',
        kind: 'task',
        text: `Reminder: “${t.title}”${t.due ? `, due ${t.due}` : ''}`,
        at: now,
        read: false,
        link: { app: 'tasks', id: t.id },
      })),
    );
    db.writeDocs('todos', todos, [], null);
    db.writeDocs('notices', notices, [], null);
    broadcast('todos', todos, []);
    broadcast('notices', notices, []);
  }
}, 30_000);
