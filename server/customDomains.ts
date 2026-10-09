// An agency's own address (portal.agency.com) where its guests sign in. The agency adds one DNS record; we check it
// with public resolvers, then ask Dokploy to route the address to this app with a Let's Encrypt certificate, and mark
// it live once https://<address>/api/health answers with a valid certificate.
//
// States on the workspace (whiteLabel.domainStatus): waiting (for the record) → found → issuing (the certificate) → live.
// The server owns them: the app can't set them through sync.
//
// Env: DOKPLOY_URL, DOKPLOY_API_KEY, DOKPLOY_APP_ID (all three turn certificates on; see docs/custom-domains.md),
// CUSTOM_DOMAIN_TARGET (the CNAME target, default custom.sprint2go.com), CUSTOM_DOMAIN_IP (this server's public IPv4,
// for addresses that need an A record; otherwise the target's own A record).
// Tests only: S2G_DNS_SERVERS (resolvers to ask instead of 1.1.1.1 and 8.8.8.8), CUSTOM_DOMAIN_PROBE_ADDR (host:port the
// https check connects to instead of the address's own DNS; the certificate is still checked for the address).
import { promises as dns } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import * as db from './db.ts';
import { dnsHostOf, MAIL_IP } from './mailer.ts';
import { hasBranding } from '../src/data/pricing.ts';
import type { DomainCheck, DomainStatus } from '../src/types.ts';
import { mark, msg } from '../src/i18n/index.ts';
import type { Said } from './lang.ts';

db.db.exec(`CREATE TABLE IF NOT EXISTS custom_domains (host TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, dokploy_id TEXT, created_at TEXT NOT NULL)`);

export const TARGET = (process.env.CUSTOM_DOMAIN_TARGET ?? 'custom.sprint2go.com').trim().toLowerCase().replace(/\.$/, '');
const DOKPLOY_URL = (process.env.DOKPLOY_URL ?? '').trim().replace(/\/+$/, '');
const DOKPLOY_KEY = (process.env.DOKPLOY_API_KEY ?? '').trim();
const DOKPLOY_APP = (process.env.DOKPLOY_APP_ID ?? '').trim();
const APP_PORT = Number(process.env.PORT ?? 8787); // where Traefik sends the address: this server's own port in the container
/** Certificates can be asked for: all three Dokploy settings are there. */
export const dokployOn = () => !!(DOKPLOY_URL && DOKPLOY_KEY && DOKPLOY_APP);

type WL = { enabled?: boolean; name?: string; domain?: string; domainStatus?: DomainStatus | 'verified'; domainCheck?: DomainCheck };
type Ws = { id: string; whiteLabel?: WL; plan?: { tier?: string; addons?: { branding?: boolean } } };

const lower = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\.$/, '');
const now = () => new Date().toISOString();

/** Live: checked, certified and paid for (the branding add-on). Only then does the address open this company's door. */
export const isLive = (ws: Ws | undefined) => !!ws?.whiteLabel?.enabled && !!ws.whiteLabel.domain && ws.whiteLabel.domainStatus === 'live' && hasBranding(ws.plan);

/* ---------- the address itself ---------- */

/** Hosts that are ours and can't be an agency's address (the app, the site, the CNAME target and their parents). */
function ownDomains() {
  const out = new Set<string>([TARGET]);
  for (const u of [process.env.PUBLIC_URL, process.env.SITE_URL])
    try {
      if (u) out.add(new URL(u).hostname.toLowerCase());
    } catch {
      /* not a URL */
    }
  // Their registrable parent too (sprint2go.com), so nobody claims a name under it.
  for (const h of [...out]) {
    const l = h.split('.');
    if (l.length > 2) out.add(l.slice(-2).join('.'));
  }
  return out;
}
/** A clean host name from what someone typed ("https://Portal.Agency.com/login" → "portal.agency.com"), or an error. */
export function cleanHost(input: unknown): { host: string } | { error: string } {
  let raw = String(input ?? '').trim();
  if (!raw) return { error: mark('Type the address, for example portal.youragency.com.') };
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `http://${raw}`;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return { error: mark('That doesn’t look like an address. Try something like portal.youragency.com.') };
  }
  if (isIP(host) || host.startsWith('[')) return { error: mark('Use a name like portal.youragency.com, not an IP address.') };
  const labels = host.split('.');
  if (labels.length < 2 || host.length > 253 || !labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) || !/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1]))
    return { error: mark('That doesn’t look like an address. Try something like portal.youragency.com.') };
  if (labels[labels.length - 1] === 'localhost' || host.endsWith('.local')) return { error: mark('Use a public address, like portal.youragency.com.') };
  for (const own of ownDomains()) if (host === own || host.endsWith(`.${own}`)) return { error: mark(`That address belongs to us. Use one on your own domain, like portal.youragency.com.`) };
  return { host };
}
/** Which company already has this address, if any (one address, one company). */
export function ownerOf(host: string): string | undefined {
  return (db.allDocs('workspaces') as unknown as Ws[]).find((w) => lower(w.whiteLabel?.domain ?? '') === host)?.id;
}

/* ---------- DNS ---------- */

const resolver = new dns.Resolver({ timeout: 4000, tries: 2 });
resolver.setServers((process.env.S2G_DNS_SERVERS ?? '1.1.1.1,8.8.8.8').split(',').map((s) => s.trim()).filter(Boolean));
const NONE = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN']);
/** A lookup that tells "no such record" (an answer) apart from "couldn't ask" (try later). */
const ask = <T>(p: Promise<T[]>): Promise<T[] | null> => p.then((r) => r, (e: NodeJS.ErrnoException) => (NONE.has(String(e?.code)) ? [] : null));

/** This server's public addresses: what an A record must say. */
async function ourIps() {
  const v4 = new Set<string>((process.env.CUSTOM_DOMAIN_IP ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  for (const ip of (await ask(resolver.resolve4(TARGET))) ?? []) v4.add(ip);
  if (MAIL_IP && isIP(MAIL_IP) === 4) v4.add(MAIL_IP);
  const v6 = new Set<string>((await ask(resolver.resolve6(TARGET))) ?? []);
  return { v4, v6 };
}

/** Whether the address reaches us: a CNAME to the target (directly or through a chain), or A records with our IP. */
export async function pointsHere(host: string, cloudflare = false): Promise<{ ok: boolean; sure: boolean; found: string; problem?: string }> {
  // Follow CNAMEs a few steps (portal.agency.com → app.agency.com → custom.sprint2go.com is fine too).
  let name = host;
  let first = '';
  for (let i = 0; i < 4; i++) {
    const c = await ask(resolver.resolveCname(name));
    if (c === null) return { ok: false, sure: false, found: 'unknown', problem: 'We couldn’t reach DNS just now. We’ll try again shortly.' };
    if (!c.length) break;
    name = lower(c[0]);
    first ||= name;
    if (name === TARGET) return { ok: true, sure: true, found: `CNAME ${first}` };
  }
  const [a, aaaa] = await Promise.all([ask(resolver.resolve4(host)), ask(resolver.resolve6(host))]);
  if (a === null) return { ok: false, sure: false, found: 'unknown', problem: 'We couldn’t reach DNS just now. We’ll try again shortly.' };
  const ours = await ourIps();
  if (first && !a.length) return { ok: false, sure: true, found: `CNAME ${first}`, problem: `It points to ${first}. Change it to ${TARGET}.` };
  if (!a.length) return { ok: false, sure: true, found: 'nothing yet' };
  const found = first ? `CNAME ${first}` : `A ${a.join(', ')}`;
  if (!ours.v4.size) return { ok: false, sure: false, found, problem: `We couldn’t look up ${TARGET} just now. We’ll try again shortly.` };
  if (!a.every((ip) => ours.v4.has(ip))) {
    if (cloudflare && !first) return { ok: false, sure: true, found, problem: 'Cloudflare’s proxy is on for this record. In Cloudflare, set it to DNS only (the grey cloud).' };
    return { ok: false, sure: true, found, problem: first ? `It points to ${first}. Change it to ${TARGET}.` : `It points to ${a.join(', ')}. Change it to the record below.` };
  }
  // An AAAA record elsewhere breaks the certificate: Let's Encrypt tries IPv6 first.
  const stray = (aaaa ?? []).filter((ip) => !ours.v6.has(ip));
  if (stray.length) return { ok: false, sure: true, found: `${found}, AAAA ${stray.join(', ')}`, problem: `It also has an AAAA (IPv6) record, ${stray.join(', ')}. Remove it: the certificate can’t be issued while it’s there.` };
  return { ok: true, sure: true, found };
}

/** The one record to add, and where: a CNAME for a subdomain; an A record when the address is the domain itself. */
async function recordFor(host: string) {
  const info = await dnsHostOf(host).catch(() => ({ dnsHost: null, nameservers: [] as string[], zone: host.split('.').slice(-2).join('.') }));
  const zone = info.zone || host.split('.').slice(-2).join('.');
  const apex = host === zone;
  const ip = apex ? [...(await ourIps()).v4][0] : '';
  const record = apex ? { type: 'A' as const, host: '@', value: ip || 'ask us for the address' } : { type: 'CNAME' as const, host: host.endsWith(`.${zone}`) ? host.slice(0, -zone.length - 1) : host, value: TARGET };
  return { record, zone, dnsHost: info.dnsHost, nameservers: info.nameservers };
}

/* ---------- Dokploy ---------- */

async function dokploy(method: 'GET' | 'POST', path: string, input: Record<string, unknown>) {
  const url = `${DOKPLOY_URL}/api/${path}${method === 'GET' ? `?${new URLSearchParams(input as Record<string, string>)}` : ''}`;
  const r = await fetch(url, { method, headers: { 'x-api-key': DOKPLOY_KEY, accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, body: method === 'POST' ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    const msg = String(j?.message ?? j?.error?.message ?? j?.error ?? text ?? '').replace(/\s+/g, ' ').slice(0, 160);
    throw Object.assign(new Error(`Dokploy ${path} answered ${r.status}${msg ? `: ${msg}` : ''}`), { status: r.status });
  }
  // REST answers are the output itself; tRPC-shaped answers wrap it.
  return j?.result?.data?.json ?? j?.result?.data ?? j;
}
/** Dokploy's id for this address on our app, if it already has one (an earlier try whose answer got lost). */
async function existingDomain(host: string): Promise<string | null> {
  const list = await dokploy('GET', 'domain.byApplicationId', { applicationId: DOKPLOY_APP }).catch(() => null);
  const hit = Array.isArray(list) ? list.find((d: any) => lower(d?.host) === host) : null;
  return hit?.domainId ? String(hit.domainId) : null;
}
async function createDomain(host: string): Promise<string> {
  const had = await existingDomain(host);
  if (had) return had;
  const d = await dokploy('POST', 'domain.create', { applicationId: DOKPLOY_APP, host, port: APP_PORT, https: true, certificateType: 'letsencrypt', path: '/', domainType: 'application' });
  if (!d?.domainId) throw new Error('Dokploy made the domain but didn’t say its id.');
  return String(d.domainId);
}
async function deleteDomain(domainId: string) {
  await dokploy('POST', 'domain.delete', { domainId }).catch((e: Error & { status?: number }) => {
    if (e.status === 404 || /not found/i.test(e.message)) return; // already gone
    throw e;
  });
}
const rowOf = (host: string) => db.db.prepare('SELECT host, workspace_id, dokploy_id FROM custom_domains WHERE host = ?').get(host) as { host: string; workspace_id: string; dokploy_id: string | null } | undefined;

/**
 * Addresses Dokploy still routes for us that no company has any more (changed, removed, or the company deleted): taken
 * out of Dokploy. Without the Dokploy settings they wait for the next run.
 */
export async function sweep(log: (line: string) => void = console.log) {
  if (!dokployOn()) return;
  const rows = db.db.prepare('SELECT host, workspace_id, dokploy_id FROM custom_domains').all() as { host: string; workspace_id: string; dokploy_id: string | null }[];
  for (const r of rows) {
    const ws = db.getDoc('workspaces', r.workspace_id) as unknown as Ws | undefined;
    if (ws && lower(ws.whiteLabel?.domain ?? '') === r.host) continue;
    try {
      if (r.dokploy_id) await deleteDomain(r.dokploy_id);
      db.db.prepare('DELETE FROM custom_domains WHERE host = ?').run(r.host);
      log(`[domains] ${r.host} removed from Dokploy`);
    } catch (e) {
      log(`[domains] couldn’t remove ${r.host} from Dokploy: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/* ---------- the https check ---------- */

/** Whether https://<host>/api/health answers us with a certificate the world trusts. */
export function probe(host: string): Promise<{ ok: boolean; why?: string }> {
  const via = process.env.CUSTOM_DOMAIN_PROBE_ADDR?.trim();
  const [addr, port] = via ? [via.slice(0, via.lastIndexOf(':')), Number(via.slice(via.lastIndexOf(':') + 1))] : [host, 443];
  return new Promise((resolve) => {
    const req = request({ host: addr, port, servername: host, path: '/api/health', method: 'GET', headers: { host, accept: 'application/json' }, timeout: 8000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => data.length < 10_000 && (data += c));
      res.on('end', () => {
        let ok = false;
        try {
          ok = res.statusCode === 200 && JSON.parse(data)?.ok === true;
        } catch {
          /* not ours */
        }
        resolve(ok ? { ok } : { ok, why: `answered ${res.statusCode}` });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('no answer'), { code: 'ETIMEDOUT' })));
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ ok: false, why: e.code ?? e.message }));
    req.end();
  });
}

/* ---------- checking and moving through the states ---------- */

export interface Deps {
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
  log: (line: string) => void;
  notifyAdmins: (wsId: string, text: Said) => void; // a notice in the bell of the company's owners and admins (msg())
}
let deps: Deps = { broadcast: () => {}, log: (l) => console.log(l), notifyAdmins: () => {} };
let hostIndex: { at: number; map: Map<string, string> } | null = null;
/** Saves the server's part of the white label (the address's state) onto the latest copy of the company. */
function save(wsId: string, host: string, patch: Partial<WL>) {
  const ws = db.getDoc('workspaces', wsId) as any;
  if (!ws?.whiteLabel || lower(ws.whiteLabel.domain ?? '') !== host) return null; // the address changed meanwhile
  const next = { ...ws, whiteLabel: { ...ws.whiteLabel, ...patch } };
  db.writeDocs('workspaces', [next], [], null);
  deps.broadcast('workspaces', [next], []);
  hostIndex = null;
  return next;
}

const running = new Map<string, Promise<unknown>>();
const lastProbe = new Map<string, number>();
/** Checks one company's address now and moves it on as far as it can go. Runs once at a time per company. */
export function check(wsId: string): Promise<unknown> {
  const busy = running.get(wsId);
  if (busy) return busy;
  const p = checkNow(wsId).finally(() => running.delete(wsId));
  running.set(wsId, p);
  return p;
}
async function checkNow(wsId: string) {
  const ws = db.getDoc('workspaces', wsId) as unknown as Ws | undefined;
  const wl = ws?.whiteLabel;
  const host = lower(wl?.domain ?? '');
  if (!ws || !wl || !host) return null;
  const [rec, before] = [await recordFor(host), wl.domainCheck];
  const dnsRes = await pointsHere(host, rec.dnsHost?.name === 'Cloudflare');
  const base: DomainCheck = { ...rec, at: now(), found: dnsRes.found, ...(dnsRes.problem ? { problem: dnsRes.problem } : {}) };
  // 'verified' was set by older versions without any check: it starts again from the record.
  const status = wl.domainStatus === 'verified' ? 'waiting' : wl.domainStatus;
  if (!dnsRes.ok) {
    // Couldn't ask DNS: everything stays as it was (a live address stays live through a resolver hiccup).
    if (!dnsRes.sure && status && status !== 'waiting') return null;
    return save(wsId, host, { domainStatus: 'waiting', domainCheck: base });
  }
  // The record is right. Going live needs the branding add-on and the Dokploy settings.
  if (!hasBranding(ws.plan)) return save(wsId, host, { domainStatus: status === 'live' ? 'live' : 'found', domainCheck: { ...base, blocked: 'addon', liveAt: before?.liveAt } });
  if (!dokployOn()) return save(wsId, host, { domainStatus: status === 'live' ? 'live' : 'found', domainCheck: { ...base, blocked: 'off', liveAt: before?.liveAt } });
  let row = rowOf(host);
  if (row && row.workspace_id !== wsId) {
    // Left over from a company that had this address before: theirs goes first.
    if (row.dokploy_id) await deleteDomain(row.dokploy_id).catch(() => {});
    db.db.prepare('DELETE FROM custom_domains WHERE host = ?').run(host);
    row = undefined;
  }
  if (!row?.dokploy_id) {
    try {
      const id = await createDomain(host);
      db.db.prepare('INSERT INTO custom_domains (host, workspace_id, dokploy_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (host) DO UPDATE SET workspace_id = excluded.workspace_id, dokploy_id = excluded.dokploy_id').run(host, wsId, id, now());
      deps.log(`[domains] ${host}: asked Dokploy for a certificate (domain ${id})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log(`[domains] ${host}: ${msg}`);
      return save(wsId, host, { domainStatus: 'found', domainCheck: { ...base, certError: 'We couldn’t ask for the certificate just now. We try again within the hour.' } });
    }
  }
  const since = status === 'issuing' || status === 'live' ? before?.since ?? now() : now();
  const r = await probe(host);
  lastProbe.set(host, Date.now());
  if (r.ok) {
    if (status !== 'live') (deps.log(`[domains] ${host}: live`), deps.notifyAdmins(wsId, msg('{host} is live. Invite links for your guests now use it.', { host })));
    return save(wsId, host, { domainStatus: 'live', domainCheck: { ...base, since, liveAt: before?.liveAt ?? now() } });
  }
  // Not answering yet. A live address that stops answering is our problem to fix, not the agency's: it stays live.
  if (status === 'live') {
    deps.log(`[domains] ${host}: live, but https doesn’t answer (${r.why})`);
    return save(wsId, host, { domainCheck: { ...base, since, liveAt: before?.liveAt } });
  }
  const slow = Date.now() - Date.parse(since) > 60 * 60_000;
  return save(wsId, host, { domainStatus: 'issuing', domainCheck: { ...base, since, ...(slow ? { problem: 'The certificate is taking longer than usual. We keep trying every hour; nothing to do on your side while the record stays as it is.' } : {}) } });
}

/** A new address (or none): the old one is let go in Dokploy, the new one starts waiting and is checked at once. */
export async function setAddress(wsId: string, host: string | null) {
  const ws = db.getDoc('workspaces', wsId) as any;
  if (!ws?.whiteLabel) return null;
  const old = lower(ws.whiteLabel.domain ?? '');
  if (old === (host ?? '')) return host ? check(wsId) : null;
  const next = { ...ws, whiteLabel: { ...ws.whiteLabel, domain: host ?? undefined, domainStatus: host ? 'waiting' : undefined, domainCheck: undefined } };
  db.writeDocs('workspaces', [next], [], null);
  deps.broadcast('workspaces', [next], []);
  hostIndex = null;
  if (old) void sweep(deps.log);
  if (host) await check(wsId);
  return db.getDoc('workspaces', wsId);
}

/* ---------- which company an address belongs to ---------- */

/** Agency addresses → company, kept for a few seconds (every request to a foreign address asks). */
function index() {
  if (hostIndex && hostIndex.at > Date.now() - 10_000) return hostIndex.map;
  const map = new Map<string, string>();
  for (const w of db.allDocs('workspaces') as unknown as Ws[]) if (w.whiteLabel?.domain) map.set(lower(w.whiteLabel.domain), w.id);
  hostIndex = { at: Date.now(), map };
  return map;
}
/** The company whose live address this is, if any. */
export function liveAt(host: string): Ws | undefined {
  const id = index().get(lower(host));
  const ws = id ? (db.getDoc('workspaces', id) as unknown as Ws | undefined) : undefined;
  return isLive(ws) ? ws : undefined;
}
/** A company's address that reaches us and is on its way to live (the record is right; the certificate is coming). */
export function pendingAt(host: string) {
  const id = index().get(lower(host));
  const wl = id ? (db.getDoc('workspaces', id) as unknown as Ws | undefined)?.whiteLabel : undefined;
  return !!wl?.enabled && (wl.domainStatus === 'found' || wl.domainStatus === 'issuing');
}

/* ---------- running in the background ---------- */

/**
 * Every hour: every address is checked again (the ones still waiting move on as soon as the record is right) and
 * leftovers leave Dokploy. While a certificate is being issued, its address is tried often: every 20 seconds for the
 * first 10 minutes, every 2 minutes for the first hour, then with the hourly round.
 */
export function start(d: Deps) {
  deps = d;
  const all = async () => {
    for (const w of db.allDocs('workspaces') as unknown as Ws[]) if (w.whiteLabel?.domain) await check(w.id).catch((e) => d.log(`[domains] ${w.whiteLabel?.domain}: ${e instanceof Error ? e.message : e}`));
    await sweep(d.log).catch(() => {});
  };
  setTimeout(() => void all(), 30_000);
  setInterval(() => void all(), 60 * 60_000);
  setInterval(() => {
    for (const w of db.allDocs('workspaces') as unknown as Ws[]) {
      const wl = w.whiteLabel;
      if (wl?.domainStatus !== 'issuing' || !wl.domain) continue;
      const age = Date.now() - Date.parse(wl.domainCheck?.since ?? now());
      const every = age < 10 * 60_000 ? 20_000 : age < 60 * 60_000 ? 2 * 60_000 : Infinity;
      if (Date.now() - (lastProbe.get(lower(wl.domain)) ?? 0) >= every) void check(w.id).catch(() => {});
    }
  }, 10_000);
}
/** Something that decides going live changed (the add-on, the brand switched on): check again shortly. */
const soonTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function soon(wsId: string) {
  clearTimeout(soonTimers.get(wsId));
  soonTimers.set(wsId, setTimeout(() => (soonTimers.delete(wsId), void check(wsId).catch(() => {})), 2000));
}

/** The plain page an address gets when it isn't one of ours, or not ready yet. No product name: it may be an agency's. */
export function notSetUpPage(pending: boolean) {
  const [title, line] = pending
    ? ['This address is almost ready', 'Its secure connection is still being set up. Try again in a few minutes.']
    : ['This address isn’t set up', 'Nothing is published here. If you expected a sign-in page, check the address you were given.'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>
:root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--text:#16181d;--muted:#5d6472;--line:#e3e6eb}
@media (prefers-color-scheme:dark){:root{--bg:#111317;--card:#191c21;--text:#eceef2;--muted:#9aa1ad;--line:#2a2e35}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;width:100%;padding:28px 24px;border:1px solid var(--line);border-radius:16px;background:var(--card);animation:in .24s ease-out backwards}
h1{margin:0 0 8px;font-size:19px;line-height:1.3;text-wrap:balance}p{margin:0;color:var(--muted)}
@keyframes in{from{opacity:0;transform:translateY(6px)}}@media (prefers-reduced-motion:reduce){main{animation:none}}
</style></head><body><main><h1>${title}</h1><p>${line}</p></main></body></html>`;
}
