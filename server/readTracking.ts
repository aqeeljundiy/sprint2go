// Read tracking for mail sent through our own engine (server/mailer.ts). When someone sends with "Track opens" on, each
// outside recipient gets their own copy: a 1x1 picture only their copy has (/t/o/<token>.gif) and, with link clicks on,
// links that pass through /t/c/<token>?u=<address>&s=<signature> first. The signature is made with the server key, so
// the click address can't send anyone anywhere we didn't write ourselves.
//
// What comes back is honest about what it can know. Apple Mail Privacy Protection loads every picture by itself, often
// right after delivery, and security filters do the same: those opens show as "maybe automatic" and don't count. Gmail
// and Yahoo load pictures through their own servers, which hide the device: those show as "via Gmail". No IP address
// is kept; a place is shown only when the proxy in front of us names the country (GEO_COUNTRY_HEADER), never guessed.
//
// Teammates and the company's own addresses are never tracked, and a company can switch tracking off for everyone
// (Settings, Security & data). The opens and clicks live here; the thread's message carries a copy the app can't write.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_track (token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, recipient TEXT NOT NULL, opens INTEGER NOT NULL, clicks INTEGER NOT NULL, notify INTEGER NOT NULL, by_user TEXT, links TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS mail_track_msg ON mail_track (thread_id, message_id);
  CREATE TABLE IF NOT EXISTS mail_track_events (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, device TEXT, place TEXT, auto TEXT, via TEXT, url TEXT, label TEXT);
  CREATE INDEX IF NOT EXISTS mail_track_events_token ON mail_track_events (token, at);
`);

type Doc = db.Doc;
export type Open = { at: string; device: string; place?: string; auto?: 'apple' | 'scanner'; via?: 'gmail' | 'yahoo' };
export type Click = { at: string; label: string; url: string; auto?: 'scanner' };
export type Tracking = Record<string, { opens: Open[]; clicks: Click[] }>;
type Row = { token: string; workspace_id: string; account_id: string | null; thread_id: string; message_id: string; recipient: string; opens: number; clicks: number; notify: number; by_user: string | null; links: string | null; created_at: string };

let deps: { origin: (workspaceId: string) => string; broadcast: (coll: string, upserts: Doc[], deletes: string[]) => void } = {
  origin: () => (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, ''),
  broadcast: () => {},
};
/** `origin`: where a company's picture and links point (its own live address, or the app's). */
export const initTracking = (d: Partial<typeof deps>) => void (deps = { ...deps, ...d });

const now = () => new Date().toISOString();
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const MAX_EVENTS = 60; // per recipient on the message; older ones stay in the table

/* ---------- who may be tracked ---------- */

/** Off only when an admin switched it off (Settings, Security & data). */
export const allowedFor = (ws: any) => !!ws && ws.readTracking !== false;

/** Teammates and the company's own addresses: its domains, its mailboxes and aliases, and the people in it. */
export function isInternal(ws: any, email: string) {
  const e = lower(email);
  const domain = e.split('@')[1] ?? '';
  if ((ws?.domains ?? []).map(lower).includes(domain)) return true;
  if ((ws?.accounts ?? []).some((a: any) => lower(a.email) === e)) return true;
  if ((ws?.mailAliases ?? []).some((a: any) => lower(a.address) === e)) return true;
  return (ws?.members ?? []).some((m: any) => lower((db.getDoc('users', m.userId) as any)?.email) === e);
}

/* ---------- the copy each tracked recipient gets ---------- */

const sigOf = (token: string, url: string) => db.keyedHash(`track-click:${token}:${url}`).slice(0, 32);
/** Whether the click address is one this server wrote for this token. */
export function validSig(token: string, url: string, sig: string) {
  const want = Buffer.from(sigOf(token, url));
  const got = Buffer.from(String(sig ?? ''));
  return got.length === want.length && timingSafeEqual(got, want);
}
const decode = (s: string) =>
  s
    .replace(/&#0*38;|&#x0*26;/gi, '&')
    .replace(/&quot;|&#0*34;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const shortUrl = (u: URL) => (u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)).slice(0, 80);

/**
 * Web addresses typed as plain text become links, as the recipient's mail app would make them anyway (so their clicks
 * count too). Only in text: never inside a tag or an existing link.
 */
export function linkify(html: string) {
  return html
    .split(/(<a\b[\s\S]*?<\/a\s*>)/i)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split(/(<[^>]*>)/)
            // Ends at a space, a tag, a quote, or an entity for one (&nbsp; &lt; &gt; &quot;); &amp; is part of it.
            .map((bit, j) => (j % 2 ? bit : bit.replace(/\bhttps?:\/\/(?:(?!&(?:nbsp|#160|#xa0|lt|gt|quot|#34|#39|apos);)[^\s<>"'])+/gi, (m) => {
              const url = m.replace(/[.,;:!?)\]]+$/, '');
              return `<a href="${attr(decode(url))}">${url}</a>${m.slice(url.length)}`;
            })))
            .join(''),
    )
    .join('');
}

/**
 * One recipient's HTML: links go through /t/c/ (when `clicks`), and the picture only their copy has goes at the end
 * (when `opens`). Mail and phone links, and links that are already ours, stay as they are.
 */
export function instrument(html: string, token: string, base: string, opts: { opens: boolean; clicks: boolean }) {
  const links: { u: string; l: string }[] = [];
  let out = html;
  if (opts.clicks)
    out = linkify(out).replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, attrs: string, inner: string) => {
      const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
      if (!m) return whole;
      const url = decode((m[1] ?? m[2] ?? m[3] ?? '').trim());
      if (!/^https?:\/\//i.test(url) || url.startsWith(`${base}/t/`)) return whole;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return whole;
      }
      const text = decode(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      const label = !text || text === url || /^https?:\/\//i.test(text) ? shortUrl(parsed) : text.slice(0, 80);
      if (links.length < 100 && !links.some((x) => x.u === url)) links.push({ u: url, l: label });
      const via = `${base}/t/c/${token}?u=${encodeURIComponent(url)}&s=${sigOf(token, url)}`;
      return `<a${attrs.slice(0, m.index)}href="${attr(via)}"${attrs.slice(m.index + m[0].length)}>${inner}</a>`;
    });
  if (opts.opens) {
    const img = `<img src="${base}/t/o/${token}.gif" width="1" height="1" alt="" style="width:1px;height:1px;border:0;margin:0;padding:0;display:block">`;
    out = /<\/body\s*>/i.test(out) ? out.replace(/<\/body\s*>/i, `${img}$&`) : out + img;
  }
  return { html: out, links };
}

/**
 * Makes a token and the HTML for each outside recipient of a message sent with tracking on. Nobody, when the company
 * switched tracking off, the message has no HTML, or everyone is a teammate. Returns recipient → their HTML.
 */
export function prepare(p: { ws: any; accountId: string; threadId: string; messageId: string; by: string | null; html: string | undefined; recipients: string[]; opens: boolean; clicks: boolean; notify: boolean }) {
  const out = new Map<string, string>();
  if (!allowedFor(p.ws) || !p.html || !p.threadId || !p.messageId || (!p.opens && !p.clicks)) return out;
  const base = deps.origin(p.ws.id).replace(/\/$/, '');
  const ins = db.db.prepare('INSERT INTO mail_track (token, workspace_id, account_id, thread_id, message_id, recipient, opens, clicks, notify, by_user, links, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of p.recipients.map(lower)) {
    if (!r.includes('@') || out.has(r) || isInternal(p.ws, r)) continue;
    const token = randomBytes(16).toString('hex');
    const { html, links } = instrument(p.html, token, base, p);
    ins.run(token, p.ws.id, p.accountId, p.threadId, p.messageId, r, Number(p.opens), Number(p.clicks), Number(p.notify), p.by, JSON.stringify(links), now());
    out.set(r, html);
  }
  return out;
}

/* ---------- who opened it, on what (from the request, nothing kept but the answer) ---------- */

const SCANNER =
  /bot\b|crawler|spider|scanner|python|curl\/|wget|go-http-client|java\/|okhttp|axios|node-fetch|undici|libwww|httpclient|headless|phantomjs|barracuda|mimecast|proofpoint|symantec|messagelabs|trend ?micro|forcepoint|ironport|fireeye|sophos|zscaler|existence discovery/i;
/** Apple's own network (17.0.0.0/8): Mail Privacy Protection fetches come from it. */
const appleIp = (ip: string) => /^(::ffff:)?17\./.test(ip);

/** A rough device from the user agent: "iPhone · Apple Mail", "Windows PC · Outlook". Empty when it can't tell. */
export function deviceOf(ua: string) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Windows/.test(ua) ? 'Windows PC' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux PC' : '';
  const app = /Outlook|Microsoft Office|MSOffice|ms-office/i.test(ua)
    ? 'Outlook'
    : /Thunderbird/i.test(ua)
      ? 'Thunderbird'
      : /iPhone|iPad|Macintosh/.test(ua) && /AppleWebKit/.test(ua) && !/Safari|CriOS|FxiOS|Chrome|Firefox|EdgiOS/.test(ua)
        ? 'Apple Mail'
        : /Chrome|Firefox|Safari|Edg\//.test(ua)
          ? 'browser'
          : '';
  return os ? (app ? `${os} · ${app}` : os) : '';
}

/**
 * What a request for the picture (or a link) says about who made it. `via`: a mail provider loaded it for a person and
 * hid the device. `auto`: maybe nobody looked (Apple Mail Privacy Protection, a security filter, a script).
 */
export function readAgent(userAgent: string, ip = ''): { device: string; auto?: 'apple' | 'scanner'; via?: 'gmail' | 'yahoo' } {
  const ua = String(userAgent ?? '').trim();
  if (/GoogleImageProxy|ggpht\.com/i.test(ua)) return { device: '', via: 'gmail' };
  if (/YahooMailProxy/i.test(ua)) return { device: '', via: 'yahoo' };
  if (ua === 'Mozilla/5.0' || appleIp(ip)) return { device: '', auto: 'apple' };
  if (!ua || SCANNER.test(ua)) return { device: '', auto: 'scanner' };
  return { device: deviceOf(ua) };
}

/** The country, only when a proxy we trust in front of us names it (GEO_COUNTRY_HEADER, e.g. cf-ipcountry). */
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
function countryOf(headers: Record<string, string | string[] | undefined>) {
  const name = lower(process.env.GEO_COUNTRY_HEADER);
  if (!name) return undefined;
  const code = String(headers[name] ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return undefined;
  return regionNames?.of(code) ?? code;
}

/* ---------- recording, and the copy on the thread ---------- */

const rowOf = (token: string) => db.db.prepare('SELECT * FROM mail_track WHERE token = ?').get(token) as Row | undefined;
const recentCount = db.db.prepare('SELECT COUNT(*) AS n FROM mail_track_events WHERE token = ? AND at >= ?');
const lastEvent = db.db.prepare('SELECT * FROM mail_track_events WHERE token = ? AND kind = ? ORDER BY id DESC LIMIT 1');
const addEvent = db.db.prepare('INSERT INTO mail_track_events (token, kind, at, device, place, auto, via, url, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

/** A token still worth recording for: it exists, its company allows tracking, and its thread is still there. */
function live(token: string) {
  const row = /^[a-f0-9]{32}$/.test(token) ? rowOf(token) : undefined;
  if (!row) return null;
  const ws = db.getDoc('workspaces', row.workspace_id) as any;
  if (!allowedFor(ws) || !db.getDoc('threads', row.thread_id)) return null;
  // No more than 100 things a day for one copy: a loop or a flood can't fill the database.
  if ((recentCount.get(token, new Date(Date.now() - 86_400_000).toISOString()) as { n: number }).n >= 100) return null;
  return { row, ws };
}

type Req = { userAgent: string; ip: string; headers: Record<string, string | string[] | undefined> };

/** The picture was loaded. True when it was recorded. */
export function recordOpen(token: string, req: Req) {
  const hit = live(token);
  if (!hit || !hit.row.opens) return false;
  const who = readAgent(req.userAgent, req.ip);
  // The same app loading the picture again within a minute (a redraw, a second fetch) is the same open.
  const prev = lastEvent.get(token, 'open') as any;
  if (prev && Date.now() - Date.parse(prev.at) < 60_000 && (prev.device ?? '') === who.device && (prev.auto ?? '') === (who.auto ?? '') && (prev.via ?? '') === (who.via ?? '')) return false;
  const firstReal = !who.auto && !db.db.prepare("SELECT 1 FROM mail_track_events WHERE token = ? AND kind = 'open' AND auto IS NULL LIMIT 1").get(token);
  const place = who.auto || who.via ? undefined : countryOf(req.headers);
  addEvent.run(token, 'open', now(), who.device || null, place ?? null, who.auto ?? null, who.via ?? null, null, null);
  syncMessage(hit.row.thread_id, hit.row.message_id);
  if (firstReal) tellSender(hit.row, hit.ws, who.via);
  return true;
}

/** A tracked link was followed: the address it goes to, or null when the link isn't one we made. */
export function recordClick(token: string, url: string, sig: string, req: Req): string | null {
  if (!/^[a-f0-9]{32}$/.test(token) || !/^https?:\/\//i.test(url) || !validSig(token, url, sig)) return null;
  const hit = live(token);
  if (!hit || !hit.row.clicks) return url;
  const who = readAgent(req.userAgent, req.ip);
  const prev = lastEvent.get(token, 'click') as any;
  if (prev && prev.url === url && Date.now() - Date.parse(prev.at) < 10_000) return url;
  let links: { u: string; l: string }[] = [];
  try {
    links = JSON.parse(hit.row.links ?? '[]');
  } catch {
    /* keep none */
  }
  let label = links.find((x) => x.u === url)?.l;
  if (!label)
    try {
      label = shortUrl(new URL(url));
    } catch {
      label = url.slice(0, 80);
    }
  // A link checked by a filter (or a script) is noted, not counted. Gmail's picture proxy never follows links.
  const auto = who.auto ? 'scanner' : null;
  addEvent.run(token, 'click', now(), who.device || null, null, auto, null, url, label);
  syncMessage(hit.row.thread_id, hit.row.message_id);
  return url;
}

/** Every tracked message in a thread, as the app shows it: message id → recipient → opens and clicks. */
export function trackingOf(threadId: string): Map<string, Tracking> {
  const rows = db.db.prepare('SELECT token, message_id, recipient FROM mail_track WHERE thread_id = ? ORDER BY created_at').all(threadId) as { token: string; message_id: string; recipient: string }[];
  const out = new Map<string, Tracking>();
  if (!rows.length) return out;
  const events = db.db.prepare(`SELECT * FROM mail_track_events WHERE token IN (${rows.map(() => '?').join(',')}) ORDER BY id`).all(...rows.map((r) => r.token)) as any[];
  for (const r of rows) {
    const mine = events.filter((e) => e.token === r.token);
    const opens: Open[] = mine
      .filter((e) => e.kind === 'open')
      .slice(-MAX_EVENTS)
      .map((e) => ({ at: e.at, device: e.device ?? '', ...(e.place ? { place: e.place } : {}), ...(e.auto ? { auto: e.auto } : {}), ...(e.via ? { via: e.via } : {}) }));
    const clicks: Click[] = mine
      .filter((e) => e.kind === 'click')
      .slice(-MAX_EVENTS)
      .map((e) => ({ at: e.at, label: e.label ?? '', url: e.url ?? '', ...(e.auto ? { auto: e.auto } : {}) }));
    const t = out.get(r.message_id) ?? {};
    t[r.recipient] = { opens, clicks };
    out.set(r.message_id, t);
  }
  return out;
}

/** Decisions made before the app saved the message (it saves a moment after asking to send): nobody is tracked. */
const untracked = new Map<string, number>();
const key = (threadId: string, messageId: string) => `${threadId} ${messageId}`;

/**
 * Writes the server's tracking onto the message in its thread and tells everyone who can see it. `requested`: the
 * sender asked for tracking, so a message with nobody tracked loses the app's placeholder.
 */
export function syncMessage(threadId: string, messageId: string, requested = false) {
  const tracking = trackingOf(threadId).get(messageId);
  if (!tracking && requested) {
    untracked.set(key(threadId, messageId), Date.now());
    for (const [k, at] of untracked) if (Date.now() - at > 30 * 60_000) untracked.delete(k);
  }
  const t = db.getDoc('threads', threadId) as any;
  if (!t || !(t.messages ?? []).some((m: any) => m.id === messageId)) return;
  if (!tracking && !requested) return;
  const messages = t.messages.map((m: any) => (m.id === messageId ? { ...m, tracking } : m));
  if (JSON.stringify(messages) === JSON.stringify(t.messages)) return;
  const next = { ...t, messages };
  db.writeDocs('threads', [next], [], null);
  deps.broadcast('threads', [next], []);
}

/**
 * The sync guard for threads: opens and clicks are the server's. A message the server tracks shows what the server
 * has; an earlier message keeps what it had; a new one may only name its recipients, nothing seen yet. The demo
 * (no tracking on the server for that message) may write its own, so its pretend open still works.
 */
export function guardThread(d: Doc, before: Doc | undefined, demo: boolean): Doc {
  const list = (d as any).messages;
  if (!Array.isArray(list)) return d;
  const server = trackingOf(d.id);
  const prev = new Map(((before as any)?.messages ?? []).map((m: any) => [m?.id, m]));
  const messages = list.map((m: any) => {
    if (!m || typeof m !== 'object') return m;
    const b = prev.get(m.id) as any;
    const own = server.get(m.id);
    // A new message the server already sent: the app that saved it gets the server's version back.
    if (!b && (own || untracked.has(key(d.id, m.id))) && JSON.stringify(own) !== JSON.stringify(m.tracking)) echoSoon(d.id);
    if (own) return { ...m, tracking: own };
    if (untracked.has(key(d.id, m.id))) return { ...m, tracking: undefined };
    if (demo) return m;
    if (b) return { ...m, tracking: b.tracking };
    if (!m.tracking || typeof m.tracking !== 'object') return { ...m, tracking: undefined };
    const names = Object.keys(m.tracking).filter((e) => e.includes('@')).slice(0, 50);
    return { ...m, tracking: names.length ? Object.fromEntries(names.map((e) => [lower(e), { opens: [], clicks: [] }])) : undefined };
  });
  return { ...d, messages } as Doc;
}

/** Once the save is written: the thread as stored goes to everyone, the app that saved it too. */
const echoing = new Set<string>();
function echoSoon(threadId: string) {
  if (echoing.has(threadId)) return;
  echoing.add(threadId);
  setTimeout(() => {
    echoing.delete(threadId);
    const t = db.getDoc('threads', threadId);
    if (t) deps.broadcast('threads', [t], []);
  }, 0);
}

/* ---------- telling the sender ---------- */

const wantsOpens = (userId: string) => ((db.getDoc('prefs', userId) as any)?.value?.[`pm-settings:${userId}`]?.notifyOpens ?? true) !== false;

/** The first time a person (not a machine) opens it: a notice for whoever sent it, if they want those. */
function tellSender(row: Row, ws: any, via?: string) {
  if (!row.notify) return;
  const account = (ws.accounts ?? []).find((a: any) => a.id === row.account_id);
  // Sent from the app: the person who pressed Send. Sent later by the server: a personal mailbox's owner.
  const who: string[] = row.by_user ? [row.by_user] : account && account.kind !== 'shared' ? (account.users ?? []) : [];
  const t = db.getDoc('threads', row.thread_id) as any;
  const msg = (t?.messages ?? []).find((m: any) => m.id === row.message_id);
  const name = (msg?.to ?? []).find((p: any) => lower(p.email) === row.recipient)?.name || row.recipient;
  const subject = String(t?.subject ?? '').slice(0, 120) || '(no subject)';
  const at = now();
  const notices = who
    .filter((u) => wantsOpens(u) && (ws.members ?? []).some((m: any) => m.userId === u))
    .map((userId) => ({ id: `n-${randomBytes(6).toString('hex')}`, userId, workspaceId: ws.id, kind: 'mail', event: 'opened', text: `${name} opened “${subject}”${via === 'gmail' ? ' in Gmail' : via === 'yahoo' ? ' in Yahoo Mail' : ''}`, at, read: false, link: { app: 'mail', id: row.thread_id } }));
  if (!notices.length) return;
  db.writeDocs('notices', notices as Doc[], [], null);
  deps.broadcast('notices', notices as Doc[], []);
}

/* ---------- the two public addresses ---------- */

/** A transparent 1x1 GIF. */
export const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * /t/o/<token>.gif and /t/c/<token>: public, and they answer the same whatever happened (a wrong token, tracking off,
 * too many requests): the picture, or the link's own address. `flooded`: this address asked too often, so nothing is
 * recorded. False when the path isn't one of ours.
 */
export function serveTracking(req: IncomingMessage, res: ServerResponse, url: URL, ip: string, flooded: boolean) {
  const p = url.pathname;
  if (!p.startsWith('/t/o/') && !p.startsWith('/t/c/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return (res.writeHead(405, { allow: 'GET, HEAD' }), res.end(), true);
  const seen: Req = { userAgent: String(req.headers['user-agent'] ?? ''), ip, headers: req.headers };
  const record = req.method === 'GET' && !flooded; // a HEAD is a filter checking the link, never a person
  const noCache = { 'cache-control': 'no-store, no-cache, must-revalidate, private, max-age=0', pragma: 'no-cache', expires: '0', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' };
  if (p.startsWith('/t/o/')) {
    const token = /^\/t\/o\/([a-f0-9]{32})\.gif$/.exec(p)?.[1];
    if (token && record) {
      try {
        recordOpen(token, seen);
      } catch (e) {
        console.error('[tracking]', e instanceof Error ? e.message : e);
      }
    }
    res.writeHead(200, { ...noCache, 'content-type': 'image/gif', 'content-length': GIF.length });
    return (res.end(req.method === 'HEAD' ? undefined : GIF), true);
  }
  const token = /^\/t\/c\/([a-f0-9]{32})$/.exec(p)?.[1] ?? '';
  const target = url.searchParams.get('u') ?? '';
  const sig = url.searchParams.get('s') ?? '';
  let to: string | null = null;
  try {
    to = record ? recordClick(token, target, sig, seen) : validSig(token, target, sig) && /^https?:\/\//i.test(target) ? target : null;
  } catch (e) {
    console.error('[tracking]', e instanceof Error ? e.message : e);
    to = /^[a-f0-9]{32}$/.test(token) && /^https?:\/\//i.test(target) && validSig(token, target, sig) ? target : null;
  }
  if (!to) {
    res.writeHead(400, { ...noCache, 'content-type': 'text/plain; charset=utf-8' });
    return (res.end('This link doesn’t work. Ask whoever sent it for the address.'), true);
  }
  res.writeHead(302, { ...noCache, location: to });
  return (res.end(), true);
}
