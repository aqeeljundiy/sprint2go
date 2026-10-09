// The sprint2go connector: people add sprint2go to Claude (Settings, Connectors, Add custom connector), ChatGPT and
// other apps that speak MCP. The AI runs on their own plan; sprint2go only answers.
//  - /mcp: the MCP server (Streamable HTTP, one request at a time, no sessions kept here). Tools: server/mcpTools.ts.
//  - Sign-in: OAuth 2.1 with PKCE (server/oauth.ts). The consent screen is the app's own page at /oauth/authorize
//    (src/components/ConnectApp.tsx), which calls /api/oauth/request and /api/oauth/consent here, signed in.
//  - Settings, Account lists a person's connections (/api/oauth/grants) and disconnects them.
// Every tool sees what that person sees in the company they picked, and every change goes through the same rules as
// the app's own saves (index.ts applySync). A company's admins can switch it off (Security & data); its connections
// stop working at once.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as db from './db.ts';
import * as oauth from './oauth.ts';
import * as sandbox from './sandbox.ts';
import { isSandboxId, sandboxWsId } from '../src/sandbox.ts';
import { registerTools, type ToolDeps, type ToolCtx } from './mcpTools.ts';
import { mark } from '../src/i18n/index.ts';

export interface ConnectorDeps extends ToolDeps {
  origin: (req: IncomingMessage) => string;
  ip: (req: IncomingMessage) => string;
  tooMany: (key: string, max: number, windowMs: number) => boolean;
  /** The companies this person is on the team of (guests' portals don't count). */
  memberOf: (userId: string) => { id: string; name?: string; color?: string; logo?: string; members: { userId: string; role: string }[]; aiApps?: boolean; suspended?: unknown }[];
  /** Their own demo company is made and shown. */
  demoOpen: (userId: string) => boolean;
  /** For the company's Security log. */
  event: (type: string, workspaceId: string, userId: string, detail: string) => void;
}
let deps: ConnectorDeps;
export const init = (d: ConnectorDeps) => void (deps = d);

/** The person can still use connected apps: their account exists, isn't suspended or deleted, and can sign in. */
export function personOk(userId: string) {
  const u = db.getDoc('users', userId) as { suspended?: unknown; deletedAt?: string } | undefined;
  return !!u && !u.suspended && !u.deletedAt && db.hasLogin(userId);
}
const oauthDeps = (): oauth.Deps => ({ origin: deps.origin, ip: deps.ip, tooMany: deps.tooMany, personOk });

/** Every connection of a person ends (password changed or reset, signed out everywhere, account deleted). */
export const endAll = (userId: string, why: string) => oauth.revokeAll(userId, why);

/** A company someone may connect an app to, as the consent screen and Settings show it. */
interface Company {
  id: string;
  name: string;
  color?: string;
  logo?: string;
  demo?: boolean;
  off?: boolean; // its admins switched AI apps off
}
function companiesOf(userId: string): Company[] {
  const out: Company[] = deps.memberOf(userId).map((w) => ({ id: w.id, name: String(w.name ?? 'Company'), color: w.color, logo: w.logo, off: w.aiApps === false || undefined }));
  if (deps.demoOpen(userId)) {
    const w = sandbox.getDoc(userId, 'workspaces', sandboxWsId(userId)) as { name?: string; color?: string } | undefined;
    if (w) out.push({ id: sandboxWsId(userId), name: String(w.name ?? 'Demo company'), color: w.color, demo: true });
  }
  return out;
}

/** Whether a connection may be used right now, and if not, why (in words the AI can pass on). */
function access(g: oauth.Grant): { ok: true; ctx: Omit<ToolCtx, 'origin'> } | { ok: false; status: number; why: string } {
  if (isSandboxId(g.workspaceId)) {
    if (g.workspaceId !== sandboxWsId(g.userId) || !deps.demoOpen(g.userId)) return { ok: false, status: 403, why: 'Your demo company is closed. Open it again in sprint2go (the company switcher), then try again.' };
    const w = sandbox.getDoc(g.userId, 'workspaces', g.workspaceId) as { name?: string } | undefined;
    return { ok: true, ctx: { userId: g.userId, wsId: g.workspaceId, demo: true, app: g.app, grantId: g.id, company: String(w?.name ?? 'Demo company') } };
  }
  const w = deps.memberOf(g.userId).find((x) => x.id === g.workspaceId);
  if (!w) return { ok: false, status: 403, why: 'You’re no longer on the team of the company this connection was made for. Connect again and pick another company.' };
  if (w.aiApps === false) return { ok: false, status: 403, why: `${w.name ?? 'This company'} switched off AI apps. An admin can switch them back on in sprint2go, Settings, Security & data.` };
  return { ok: true, ctx: { userId: g.userId, wsId: w.id, demo: false, app: g.app, grantId: g.id, company: String(w.name ?? 'Company') } };
}

/** Words for a header: plain ASCII, no quotes (a header can't carry ’ or “). */
const headerSafe = (s: string) => s.replace(/[’‘]/g, "'").replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '');
const rpcError = (res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
};

/** /mcp, and the sign-in addresses AI apps use. True when it answered. */
export async function handlePublic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  try {
    if (await oauth.handle(req, res, url, oauthDeps())) return true;
    if (url.pathname !== '/mcp') return false;
    await handleMcp(req, res);
    return true;
  } catch (e) {
    console.error('[connector]', e instanceof Error ? e.stack : e);
    if (!res.headersSent) rpcError(res, 500, -32603, 'Something went wrong in sprint2go. Try again.');
    else res.end();
    return true;
  }
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  oauth.cors(res);
  if (req.method === 'OPTIONS') return void (res.writeHead(204), res.end());
  const origin = deps.origin(req);
  const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
  if (!bearer) return rpcError(res, 401, -32001, 'Sign in to sprint2go first.', { 'www-authenticate': `Bearer resource_metadata="${metadata}", scope="${oauth.SCOPE}"` });
  const found = oauth.verify(bearer, origin);
  if ('error' in found) {
    // Guessing tokens from one address is slowed down.
    if (deps.tooMany(`mcp-bad:${deps.ip(req)}`, 30, 10 * 60_000)) return rpcError(res, 429, -32001, 'Too many tries with tokens that don’t work. Wait a few minutes.', { 'retry-after': '600' });
    return rpcError(res, 401, -32001, found.error, { 'www-authenticate': `Bearer error="invalid_token", error_description="${headerSafe(found.error)}", resource_metadata="${metadata}"` });
  }
  const g = found.grant;
  if (!personOk(g.userId)) {
    oauth.revokeGrant(g.id, 'the account can’t sign in any more');
    return rpcError(res, 401, -32001, 'This account can’t use connected apps any more.', { 'www-authenticate': `Bearer error="invalid_token", resource_metadata="${metadata}"` });
  }
  const ok = access(g);
  if (!ok.ok) return rpcError(res, ok.status, -32001, ok.why);
  if (deps.tooMany(`mcp:${g.id}`, 120, 60_000)) return rpcError(res, 429, -32001, 'That’s a lot of requests in a minute. Wait a moment and try again.', { 'retry-after': '30' });
  oauth.touch(g.id);
  // One request, one answer: no sessions and no open streams to keep (works the same behind any proxy).
  if (req.method !== 'POST') return rpcError(res, 405, -32000, 'Use POST.', { allow: 'POST, OPTIONS' });
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) return rpcError(res, 413, -32600, 'That request is too large.');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(res, 400, -32700, 'That isn’t JSON.');
  }
  const ctx: ToolCtx = { ...ok.ctx, origin };
  const server = new McpServer({ name: 'sprint2go', title: 'sprint2go', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: instructionsFor(ctx) });
  registerTools(server, deps, ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function instructionsFor(ctx: ToolCtx) {
  const me = db.getDoc('users', ctx.userId) as { name?: string } | undefined;
  const first = String(me?.name ?? 'the person').split(' ')[0];
  return [
    `sprint2go is where ${first} works with their team at ${ctx.company}${ctx.demo ? ' (their private demo company: made-up data, nothing in it is real)' : ''}: mail, chat, tasks, projects, calendar, notes and tables.`,
    `Every tool sees exactly what ${first} sees in sprint2go and changes things as ${first}, under the same rules as the app.`,
    'Start with needs_me for what to do now, or about_company for the people, projects, task stages and mailboxes (and their ids).',
    `Nothing leaves the company from here: email and messages to guests are saved as drafts that ${first} checks and sends in sprint2go. Say so when you make one.`,
    'Each result has a link that opens the item in sprint2go; share it when it helps.',
  ].join(' ');
}

/* ---------- the consent screen and Settings (the app's own pages, signed in) ---------- */

export interface ApiCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  me: string;
  operator: string | null;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: (req: IncomingMessage) => Promise<any>;
}
export async function handleApi(p: string, c: ApiCtx): Promise<boolean> {
  const { req, res, url, me, json } = c;
  const origin = deps.origin(req);
  if (p === '/api/oauth/request' && req.method === 'GET') {
    const r = oauth.checkAsk(Object.fromEntries(url.searchParams), origin);
    if (!r.ok) return (json(res, 200, { error: r.error, redirect: r.redirect }), true);
    const u = db.getDoc('users', me) as { name?: string; email?: string } | undefined;
    return (json(res, 200, { app: { name: r.ask.client.name, host: oauth.hostOf(r.ask.redirectUri) }, me: { name: u?.name ?? '', email: u?.email ?? '' }, companies: companiesOf(me) }), true);
  }
  if (p === '/api/oauth/consent' && req.method === 'POST') {
    if (c.operator) return (json(res, 403, { error: mark('That’s theirs to do: you’re signed in as them.') }), true);
    const b = await c.body(req);
    const r = oauth.checkAsk(b?.query && typeof b.query === 'object' ? b.query : {}, origin);
    if (!r.ok) return (json(res, 400, { error: r.error, redirect: r.redirect }), true);
    if (b.allow !== true) return (json(res, 200, { redirect: oauth.deny(r.ask, origin) }), true);
    if (deps.tooMany(`oauth-consent:${me}`, 30, 60 * 60_000)) return (json(res, 429, { error: mark('That’s a lot of connections in an hour. Try again later.') }), true);
    const company = companiesOf(me).find((w) => w.id === b.workspaceId);
    if (!company) return (json(res, 400, { error: mark('Pick one of your companies.') }), true);
    if (company.off) return (json(res, 403, { error: `${company.name} switched off AI apps. An admin can switch them on in Settings, Security & data.` }), true);
    if (!company.demo) deps.event('security.ai-app', company.id, me, `connected ${r.ask.client.name}${oauth.hostOf(r.ask.redirectUri) ? ` (${oauth.hostOf(r.ask.redirectUri)})` : ''}`);
    return (json(res, 200, { redirect: oauth.allow(r.ask, me, company.id, origin) }), true);
  }
  if (p === '/api/oauth/grants' && req.method === 'GET') {
    const companies = new Map(companiesOf(me).map((w) => [w.id, w]));
    const grants = oauth.grantsOf(me).map((g) => {
      const w = companies.get(g.workspaceId);
      return { id: g.id, app: g.app, host: g.host, workspaceId: g.workspaceId, company: w?.name ?? (isSandboxId(g.workspaceId) ? 'Demo company' : 'A company you left'), demo: isSandboxId(g.workspaceId) || undefined, off: !w || w.off || undefined, createdAt: g.createdAt, usedAt: g.usedAt };
    });
    return (json(res, 200, { url: oauth.resourceOf(origin), grants }), true);
  }
  if (p === '/api/oauth/grants/revoke' && req.method === 'POST') {
    if (c.operator) return (json(res, 403, { error: mark('That’s theirs to do: you’re signed in as them.') }), true);
    const { id } = await c.body(req);
    const g = typeof id === 'string' ? oauth.grant(id) : null;
    if (!g || g.userId !== me) return (json(res, 404, { error: mark('No such connection.') }), true);
    oauth.revokeGrant(g.id, 'disconnected in Settings');
    if (!isSandboxId(g.workspaceId)) deps.event('security.ai-app', g.workspaceId, me, `disconnected ${g.app}`);
    return (json(res, 200, { ok: true }), true);
  }
  return false;
}
