// Sign-in for AI apps (Claude, ChatGPT and other apps that speak MCP), the way they expect it: OAuth 2.1.
//  - Each app registers itself (dynamic client registration) and sends the person to /oauth/authorize, where our own
//    app asks them to sign in (with two-step sign-in), pick a company and allow it (src/components/ConnectApp.tsx).
//  - The app swaps the code for tokens at /oauth/token, proving it started the sign-in (PKCE, S256 only).
//  - Access tokens last an hour; refresh tokens 30 days and are swapped for new ones each time they're used. A refresh
//    token used twice means someone copied it: the whole connection ends.
//  - Only hashes of codes, tokens and client secrets are stored, so a copy of the database can't be used to sign in.
// A "grant" is one connection: an app, a person and the company they picked. Settings, Account lists them.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, secret_hash TEXT, name TEXT NOT NULL, uris TEXT NOT NULL, auth_method TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT);
  CREATE TABLE IF NOT EXISTS oauth_codes (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT, expires_at TEXT NOT NULL, used_at TEXT, grant_id TEXT);
  CREATE TABLE IF NOT EXISTS oauth_grants (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, app TEXT NOT NULL, host TEXT, scope TEXT NOT NULL, resource TEXT, created_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, revoked_why TEXT);
  CREATE INDEX IF NOT EXISTS oauth_grants_user ON oauth_grants (user_id);
  CREATE TABLE IF NOT EXISTS oauth_tokens (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at TEXT NOT NULL, spent_at TEXT);
  CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);
`);

export const SCOPE = 'sprint2go';
const ACCESS_MS = 60 * 60_000;
const REFRESH_MS = 30 * 86_400_000;
const CODE_MS = 10 * 60_000;
const now = () => new Date().toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;

/* ---------- what each app registered ---------- */

export interface Client {
  id: string;
  name: string;
  uris: string[];
  authMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  secretHash: string | null;
}
type ClientRow = { id: string; secret_hash: string | null; name: string; uris: string; auth_method: string; created_at: string; used_at: string | null };
export function client(id: string): Client | null {
  const r = db.db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(String(id ?? '')) as ClientRow | undefined;
  return r ? { id: r.id, name: r.name, uris: JSON.parse(r.uris), authMethod: r.auth_method as Client['authMethod'], secretHash: r.secret_hash } : null;
}

const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
/**
 * Where an app may ask to be sent back to: https, http only on the same computer (desktop apps listen there), or an
 * app's own address (cursor://, vscode://). Never a script, a file or a page with a #part. Null when it's fine.
 */
export function badRedirect(u: unknown): string | null {
  if (typeof u !== 'string' || u.length > 500) return 'isn’t an address';
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return 'isn’t an address';
  }
  if (url.hash || u.includes('#')) return 'can’t have a # part';
  if (url.username || url.password) return 'can’t carry a password';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') return loopback(url.hostname) ? null : 'must use https (plain http only on this computer)';
  if (/^(javascript|data|file|vbscript|about|blob|ftp|ws|wss|mailto|tel|sms|chrome|view-source):$/i.test(url.protocol)) return 'isn’t allowed';
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol) ? null : 'isn’t an address';
}
/** Where the app sends people back to, in words: its website, "this computer" for desktop apps, or its own address. */
export function hostOf(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') return url.hostname;
    if (url.protocol === 'http:') return 'this computer';
    return url.protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}
/** An app's name as it gave it, made safe to show: one line, no control characters, at most 60 characters. */
const cleanName = (s: unknown) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

/* ---------- the protocol: metadata, registration, tokens, revocation ---------- */

export interface Deps {
  origin: (req: IncomingMessage) => string; // https://app.sprint2go.com
  ip: (req: IncomingMessage) => string;
  tooMany: (key: string, max: number, windowMs: number) => boolean;
  /** A connection's person may still use it (signed in, not suspended): checked before new tokens are given. */
  personOk: (userId: string) => boolean;
}
export const resourceOf = (origin: string) => `${origin}/mcp`;

/** Other sites' apps (an MCP inspector in a browser) may call these: they carry no cookies, only tokens. */
export function cors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id');
  res.setHeader('access-control-expose-headers', 'www-authenticate, mcp-session-id, mcp-protocol-version');
  res.setHeader('access-control-max-age', '600');
}
const send = (res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', ...headers });
  res.end(JSON.stringify(data));
};
const fail = (res: ServerResponse, status: number, error: string, description: string, headers: Record<string, string> = {}) => send(res, status, { error, error_description: description }, headers);

async function form(req: IncomingMessage): Promise<Record<string, string> | null> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) return null;
  }
  const type = String(req.headers['content-type'] ?? '');
  try {
    const parsed = type.includes('application/json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceOf(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'sprint2go',
    resource_documentation: `${origin}/welcome`,
  };
}
export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

/** The app proves it's itself: its id (apps without a secret), or its id and secret (in the body or a Basic header). */
function authenticate(req: IncomingMessage, b: Record<string, string>): { client: Client } | { error: string } {
  let id = typeof b.client_id === 'string' ? b.client_id : '';
  let secret = typeof b.client_secret === 'string' ? b.client_secret : '';
  const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
  if (basic) {
    const [u, p = ''] = Buffer.from(basic, 'base64').toString('utf8').split(':');
    id = decodeURIComponent(u ?? '');
    secret = decodeURIComponent(p);
  }
  const c = id ? client(id) : null;
  if (!c) return { error: 'This app isn’t registered here.' };
  if (c.authMethod !== 'none' && !(secret && c.secretHash && sameHash(hash(secret), c.secretHash))) return { error: 'The app’s secret is wrong.' };
  return { client: c };
}

/**
 * The protocol's own addresses. True when it answered; GET /oauth/authorize is the app's page (the server serves it
 * like any other page), so it isn't answered here.
 */
export async function handle(req: IncomingMessage, res: ServerResponse, url: URL, deps: Deps): Promise<boolean> {
  const p = url.pathname;
  const ours = p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp' || p === '/.well-known/oauth-authorization-server' || p === '/oauth/register' || p === '/oauth/token' || p === '/oauth/revoke';
  if (!ours) {
    // Other sign-in addresses apps may look for (OpenID, other paths): a plain "not here", never the app's page.
    if (p === '/oauth/authorize' || !(p.startsWith('/oauth/') || p.startsWith('/.well-known/'))) return false;
    cors(res);
    return (fail(res, 404, 'not_found', 'Nothing here. See /.well-known/oauth-authorization-server.'), true);
  }
  cors(res);
  if (req.method === 'OPTIONS') return (res.writeHead(204), res.end(), true);
  const origin = deps.origin(req);
  if (p.startsWith('/.well-known/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return (fail(res, 405, 'invalid_request', 'Use GET.'), true);
    res.setHeader('cache-control', 'public, max-age=300');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(p.includes('authorization-server') ? authServerMetadata(origin) : protectedResourceMetadata(origin)));
    return true;
  }
  if (req.method !== 'POST') return (fail(res, 405, 'invalid_request', 'Use POST.'), true);
  const ip = deps.ip(req);

  if (p === '/oauth/register') {
    if (deps.tooMany(`oauth-reg:${ip}`, 20, 60 * 60_000)) return (fail(res, 429, 'temporarily_unavailable', 'Too many apps registered from here. Try again later.'), true);
    const b = (await form(req)) as Record<string, unknown> | null;
    if (!b) return (fail(res, 400, 'invalid_client_metadata', 'Send the app’s details as JSON.'), true);
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (!uris.length || uris.length > 10) return (fail(res, 400, 'invalid_redirect_uri', 'Give between 1 and 10 redirect_uris.'), true);
    for (const u of uris) {
      const why = badRedirect(u);
      if (why) return (fail(res, 400, 'invalid_redirect_uri', `${String(u).slice(0, 100)} ${why}.`), true);
    }
    const method = b.token_endpoint_auth_method === undefined ? 'none' : String(b.token_endpoint_auth_method);
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) return (fail(res, 400, 'invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.'), true);
    const grants = Array.isArray(b.grant_types) ? b.grant_types.map(String) : ['authorization_code', 'refresh_token'];
    if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) return (fail(res, 400, 'invalid_client_metadata', 'Only authorization_code and refresh_token are supported.'), true);
    const responses = Array.isArray(b.response_types) ? b.response_types.map(String) : ['code'];
    if (responses.some((r) => r !== 'code')) return (fail(res, 400, 'invalid_client_metadata', 'Only the code response type is supported.'), true);
    const id = `s2gc_${randomBytes(16).toString('hex')}`;
    const secret = method === 'none' ? null : token('s2gcs');
    const name = cleanName(b.client_name) || 'An AI app';
    const at = now();
    db.db.prepare('INSERT INTO oauth_clients (id, secret_hash, name, uris, auth_method, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, secret ? hash(secret) : null, name, JSON.stringify(uris), method, at);
    send(res, 201, {
      client_id: id,
      client_id_issued_at: Math.floor(Date.parse(at) / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: SCOPE,
    });
    return true;
  }

  if (p === '/oauth/token') {
    if (deps.tooMany(`oauth-token:${ip}`, 60, 60_000)) return (fail(res, 429, 'temporarily_unavailable', 'Too many tries. Wait a minute.'), true);
    const b = await form(req);
    if (!b) return (fail(res, 400, 'invalid_request', 'Send the request as a form.'), true);
    const who = authenticate(req, b);
    if ('error' in who) return (fail(res, 401, 'invalid_client', who.error, { 'www-authenticate': 'Basic realm="sprint2go"' }), true);
    const c = who.client;
    db.db.prepare('UPDATE oauth_clients SET used_at = ? WHERE id = ?').run(now(), c.id);
    const resource = typeof b.resource === 'string' && b.resource ? b.resource.replace(/\/$/, '') : '';
    if (resource && resource !== resourceOf(origin)) return (fail(res, 400, 'invalid_target', `Tokens here are for ${resourceOf(origin)}.`), true);

    if (b.grant_type === 'authorization_code') {
      const code = String(b.code ?? '');
      const row = code ? (db.db.prepare('SELECT * FROM oauth_codes WHERE hash = ?').get(hash(code)) as CodeRow | undefined) : undefined;
      if (!row || row.client_id !== c.id) return (fail(res, 400, 'invalid_grant', 'That code isn’t valid. Connect again.'), true);
      // A code used twice: someone copied it. What the first use gave ends too.
      if (row.used_at) {
        if (row.grant_id) revokeGrant(row.grant_id, 'the sign-in code was used twice');
        return (fail(res, 400, 'invalid_grant', 'That code was already used. Connect again.'), true);
      }
      db.db.prepare('UPDATE oauth_codes SET used_at = ? WHERE hash = ?').run(now(), row.hash);
      if (row.expires_at < now()) return (fail(res, 400, 'invalid_grant', 'That code has expired. Connect again.'), true);
      // Exactly the address the sign-in started with (it may be left out only by an app that registered just one).
      if (b.redirect_uri !== undefined ? String(b.redirect_uri) !== row.redirect_uri : c.uris.length !== 1) return (fail(res, 400, 'invalid_grant', 'redirect_uri doesn’t match the one the sign-in started with.'), true);
      const verifier = String(b.code_verifier ?? '');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return (fail(res, 400, 'invalid_grant', 'code_verifier is missing or not valid.'), true);
      if (!sameHash(createHash('sha256').update(verifier).digest('base64url'), row.challenge)) return (fail(res, 400, 'invalid_grant', 'code_verifier doesn’t match the code_challenge.'), true);
      if (row.resource && resource && row.resource !== resource) return (fail(res, 400, 'invalid_target', 'resource doesn’t match the one the sign-in started with.'), true);
      if (!deps.personOk(row.user_id)) return (fail(res, 400, 'invalid_grant', 'This account can’t connect apps right now.'), true);
      const grantId = `g_${randomBytes(12).toString('hex')}`;
      db.db
        .prepare('INSERT INTO oauth_grants (id, client_id, user_id, workspace_id, app, host, scope, resource, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(grantId, c.id, row.user_id, row.workspace_id, c.name, hostOf(row.redirect_uri), row.scope, row.resource ?? resourceOf(origin), now());
      db.db.prepare('UPDATE oauth_codes SET grant_id = ? WHERE hash = ?').run(grantId, row.hash);
      send(res, 200, issue(grantId, row.scope));
      return true;
    }

    if (b.grant_type === 'refresh_token') {
      const rt = String(b.refresh_token ?? '');
      const row = rt ? (db.db.prepare("SELECT t.hash, t.expires_at, t.spent_at, g.* FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = ? AND t.kind = 'refresh'").get(hash(rt)) as (GrantRow & { hash: string; expires_at: string; spent_at: string | null }) | undefined) : undefined;
      if (!row || row.client_id !== c.id) return (fail(res, 400, 'invalid_grant', 'That refresh token isn’t valid. Connect again.'), true);
      if (row.revoked_at) return (fail(res, 400, 'invalid_grant', 'This connection was ended. Connect again.'), true);
      // Each refresh token works once; a second use means it was copied, so the connection ends for everyone.
      if (row.spent_at) {
        revokeGrant(row.id, 'a refresh token was used twice');
        return (fail(res, 400, 'invalid_grant', 'That refresh token was already used, so the connection was ended. Connect again.'), true);
      }
      if (row.expires_at < now()) return (fail(res, 400, 'invalid_grant', 'This connection wasn’t used for 30 days. Connect again.'), true);
      if (!deps.personOk(row.user_id)) {
        revokeGrant(row.id, 'the account can’t sign in any more');
        return (fail(res, 400, 'invalid_grant', 'This account can’t use connected apps any more.'), true);
      }
      db.db.prepare('UPDATE oauth_tokens SET spent_at = ? WHERE hash = ?').run(now(), row.hash);
      send(res, 200, issue(row.id, row.scope));
      return true;
    }
    return (fail(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.'), true);
  }

  // Revocation (RFC 7009): always "fine", whether or not the token was known. A refresh token ends the connection.
  if (p === '/oauth/revoke') {
    if (deps.tooMany(`oauth-revoke:${ip}`, 60, 60_000)) return (fail(res, 429, 'temporarily_unavailable', 'Too many tries. Wait a minute.'), true);
    const b = await form(req);
    if (!b) return (fail(res, 400, 'invalid_request', 'Send the request as a form.'), true);
    const who = authenticate(req, b);
    if ('error' in who) return (fail(res, 401, 'invalid_client', who.error), true);
    const t = String(b.token ?? '');
    const row = t ? (db.db.prepare('SELECT t.hash, t.kind, g.id AS grant_id, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = ?').get(hash(t)) as { hash: string; kind: string; grant_id: string; client_id: string } | undefined) : undefined;
    if (row && row.client_id === who.client.id) {
      if (row.kind === 'refresh') revokeGrant(row.grant_id, 'the app disconnected');
      else db.db.prepare('DELETE FROM oauth_tokens WHERE hash = ?').run(row.hash);
    }
    send(res, 200, {});
    return true;
  }
  return false;
}

/** A new access token and refresh token for a connection. */
function issue(grantId: string, scope: string) {
  const access = token('s2ga');
  const refresh = token('s2gr');
  const add = db.db.prepare('INSERT INTO oauth_tokens (hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)');
  add.run(hash(access), grantId, 'access', later(ACCESS_MS));
  add.run(hash(refresh), grantId, 'refresh', later(REFRESH_MS));
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_MS / 1000, refresh_token: refresh, scope };
}

/* ---------- the consent screen (the app's own page calls these, signed in) ---------- */

type CodeRow = { hash: string; client_id: string; user_id: string; workspace_id: string; redirect_uri: string; challenge: string; scope: string; resource: string | null; expires_at: string; used_at: string | null; grant_id: string | null };
export interface Ask {
  client: Client;
  redirectUri: string;
  state?: string;
  challenge: string;
  scope: string;
  resource: string | null;
}
/** Adds query parameters to the app's own address (which may already have some). */
export function backTo(uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}
/**
 * Checks what an app asked for at /oauth/authorize, in the order the standard wants: an unknown app or a return address
 * it never registered is shown here (never followed); anything else wrong goes back to the app as an error.
 */
export function checkAsk(q: Record<string, unknown>, origin: string): { ok: true; ask: Ask } | { ok: false; error: string; redirect?: string } {
  const c = client(String(q.client_id ?? ''));
  if (!c) return { ok: false, error: 'This app isn’t registered with sprint2go, or it was a while ago. Go back to the app and connect again.' };
  const asked = typeof q.redirect_uri === 'string' && q.redirect_uri ? q.redirect_uri : c.uris.length === 1 ? c.uris[0] : '';
  if (!asked || !c.uris.includes(asked)) return { ok: false, error: `${c.name} asked to be sent back to an address it didn’t register. Nothing was shared. Go back to the app and connect again.` };
  const state = typeof q.state === 'string' ? q.state.slice(0, 500) : undefined;
  const back = (error: string, description: string) => ({ ok: false as const, error: description, redirect: backTo(asked, { error, error_description: description, state, iss: origin }) });
  if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  const challenge = typeof q.code_challenge === 'string' ? q.code_challenge : '';
  if (!challenge) return back('invalid_request', 'PKCE is required: send a code_challenge.');
  if (q.code_challenge_method !== 'S256') return back('invalid_request', 'Only the S256 code_challenge_method is supported.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back('invalid_request', 'code_challenge isn’t an S256 challenge.');
  const resource = typeof q.resource === 'string' && q.resource ? q.resource.replace(/\/$/, '') : null;
  if (resource && resource !== resourceOf(origin)) return back('invalid_target', `This server is ${resourceOf(origin)}.`);
  return { ok: true, ask: { client: c, redirectUri: asked, state, challenge, scope: SCOPE, resource } };
}
/** The person allowed it: a code the app swaps for tokens within ten minutes. Returns where to send them back. */
export function allow(ask: Ask, userId: string, workspaceId: string, origin: string) {
  const code = token('s2gk');
  db.db.prepare('INSERT INTO oauth_codes (hash, client_id, user_id, workspace_id, redirect_uri, challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(hash(code), ask.client.id, userId, workspaceId, ask.redirectUri, ask.challenge, ask.scope, ask.resource, later(CODE_MS));
  return backTo(ask.redirectUri, { code, state: ask.state, iss: origin });
}
export const deny = (ask: Ask, origin: string) => backTo(ask.redirectUri, { error: 'access_denied', error_description: 'The person cancelled.', state: ask.state, iss: origin });

/* ---------- connections ---------- */

type GrantRow = { id: string; client_id: string; user_id: string; workspace_id: string; app: string; host: string | null; scope: string; resource: string | null; created_at: string; used_at: string | null; revoked_at: string | null; revoked_why: string | null };
export interface Grant {
  id: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  app: string;
  host: string;
  createdAt: string;
  usedAt: string | null;
}
const grantOf = (r: GrantRow): Grant => ({ id: r.id, clientId: r.client_id, userId: r.user_id, workspaceId: r.workspace_id, app: r.app, host: r.host ?? '', createdAt: r.created_at, usedAt: r.used_at });

/** Who a bearer token belongs to: a live access token of a connection that wasn't ended. */
export function verify(bearer: string, origin: string): { grant: Grant } | { error: string } {
  if (!bearer) return { error: 'Sign in first.' };
  const r = db.db.prepare("SELECT t.expires_at, g.* FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = ? AND t.kind = 'access'").get(hash(bearer)) as (GrantRow & { expires_at: string }) | undefined;
  if (!r) return { error: 'This token isn’t valid.' };
  if (r.revoked_at) return { error: 'This connection was ended.' };
  if (r.expires_at < now()) return { error: 'This token has expired.' };
  if (r.resource && r.resource !== resourceOf(origin)) return { error: 'This token is for another server.' };
  return { grant: grantOf(r) };
}
const usedMarks = new Map<string, number>();
/** Remembers when a connection was last used (at most once a minute), for "Last used" in Settings. */
export function touch(grantId: string) {
  const t = Date.now();
  if ((usedMarks.get(grantId) ?? 0) > t - 60_000) return;
  usedMarks.set(grantId, t);
  db.db.prepare('UPDATE oauth_grants SET used_at = ? WHERE id = ?').run(new Date(t).toISOString(), grantId);
}
/** A person's connections that still work (not ended, refresh token not expired), newest first. */
export function grantsOf(userId: string): Grant[] {
  return (
    db.db
      .prepare("SELECT g.* FROM oauth_grants g WHERE g.user_id = ? AND g.revoked_at IS NULL AND EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.grant_id = g.id AND t.kind = 'refresh' AND t.spent_at IS NULL AND t.expires_at > ?) ORDER BY g.created_at DESC")
      .all(userId, now()) as GrantRow[]
  ).map(grantOf);
}
export function grant(id: string): Grant | null {
  const r = db.db.prepare('SELECT * FROM oauth_grants WHERE id = ?').get(id) as GrantRow | undefined;
  return r ? grantOf(r) : null;
}
/** Ends a connection: its tokens stop working at once. */
export function revokeGrant(id: string, why: string) {
  db.db.prepare('UPDATE oauth_grants SET revoked_at = ?, revoked_why = ? WHERE id = ? AND revoked_at IS NULL').run(now(), why.slice(0, 200), id);
  db.db.prepare('DELETE FROM oauth_tokens WHERE grant_id = ?').run(id);
}
/** Every connection of a person ends (password changed or reset, signed out everywhere, account deleted). */
export function revokeAll(userId: string, why: string) {
  for (const r of db.db.prepare('SELECT id FROM oauth_grants WHERE user_id = ? AND revoked_at IS NULL').all(userId) as { id: string }[]) revokeGrant(r.id, why);
}

/** Once a day: expired codes and tokens go; ended connections after 90 days; apps nobody connected after 30 days. */
export function cleanup() {
  const t = now();
  db.db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(new Date(Date.now() - 86_400_000).toISOString());
  db.db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').run(t);
  db.db.prepare("DELETE FROM oauth_tokens WHERE kind = 'refresh' AND spent_at IS NOT NULL AND spent_at < ?").run(new Date(Date.now() - 86_400_000).toISOString());
  db.db.prepare('DELETE FROM oauth_grants WHERE revoked_at IS NOT NULL AND revoked_at < ?').run(new Date(Date.now() - 90 * 86_400_000).toISOString());
  const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
  db.db.prepare('DELETE FROM oauth_clients WHERE COALESCE(used_at, created_at) < ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id AND g.revoked_at IS NULL)').run(month);
}
setInterval(cleanup, 24 * 3600_000).unref();
