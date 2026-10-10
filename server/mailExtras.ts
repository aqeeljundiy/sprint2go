// Mail's reading and writing extras on the server (Gmail's):
//  - Show original: a message's real source (as received or sent, server/mailRaw.ts), its headers, what SPF, DKIM and
//    DMARC said, and the .eml to download.
//  - Print: one message or the whole conversation on a clean page of its own (no app around it), printed straight away.
//  - Pictures in received mail through our own proxy (/api/mail/img): the sender never sees the reader's address, and
//    nothing loads from outside inside the app.
//  - What an email may carry when it's sent from the app: an alias as From, Reply-To, priority and confidential mode.
// Confidential mode itself lives in server/mailConfidential.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { simpleParser } from 'mailparser';
import * as db from './db.ts';
import * as store from './imapStore.ts';
import * as confidential from './mailConfidential.ts';
import { localAccounts } from './mailer.ts';
import { safeGet, FetchError } from './safeFetch.ts';

type Person = { name: string; email: string };
type Ctx = {
  me: string;
  /** Whether this person opens that mailbox (its people; the app's own rule for threads). */
  canOpen: (accountId: string) => boolean;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: () => Promise<any>;
  tooMany: (key: string, max: number, windowMs: number) => boolean;
};

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The company a mailbox belongs to (threads saved by the app don't always carry it). */
const wsOfAccount = (accountId: string) => (db.allDocs('workspaces') as any[]).find((w) => (w.accounts ?? []).some((a: any) => a.id === accountId));
const isEmail = (e: string) => /^[^\s@<>"]{1,64}@[^\s@<>"]{1,250}\.[^\s@<>"]{2,}$/.test(e);

/* ---------- sending: From (an alias), Reply-To, priority, confidential ---------- */

/** The addresses a mailbox can send as: its own, and the aliases at the company's domain that deliver into it. */
export function sendersOf(ws: any, account: any): string[] {
  const own = lower(account?.email);
  const mine = localAccounts();
  const aliases = (ws?.mailAliases ?? []).map((al: any) => lower(al.address)).filter((addr: string) => mine.get(addr)?.alias?.accounts.some((a: any) => a.id === account?.id));
  return [own, ...aliases].filter(Boolean);
}

const people = (list: unknown, max = 10): Person[] =>
  (Array.isArray(list) ? list : [])
    .filter((x: any) => x && typeof x.email === 'string' && isEmail(x.email.trim()))
    .slice(0, max)
    .map((x: any) => ({ name: String(x.name ?? '').slice(0, 120), email: lower(x.email) }));

/**
 * The extras an email asked for, checked: `fromAddress` must be one this mailbox sends as; Reply-To real addresses;
 * priority high or low; confidential a time within five years. Returns why not when the From isn't allowed.
 */
export function sendOptions(b: any, ws: any, account: any, me: string | null): { error?: string; from?: Person; replyTo?: Person[]; priority?: 'high' | 'low'; confidential?: { expiresAt: string; passcode: boolean; by: string | null } } {
  const out: ReturnType<typeof sendOptions> = {};
  const want = lower(b?.fromAddress);
  if (want && want !== lower(account.email)) {
    if (!sendersOf(ws, account).includes(want)) return { error: `${account.email} can’t send as ${want}. Pick one of its addresses.` };
    const al = (ws.mailAliases ?? []).find((x: any) => lower(x.address) === want);
    out.from = { name: String(al?.name || account.name || ws.name), email: want };
  }
  const replyTo = people(b?.replyTo, 5);
  if (replyTo.length) out.replyTo = replyTo;
  if (b?.priority === 'high' || b?.priority === 'low') out.priority = b.priority;
  const c = confidential.parseOptions(b?.confidential, me);
  if (c) out.confidential = c;
  return out;
}

/* ---------- show original ---------- */

/** A thread and message this person may open. */
function find(ctx: Ctx, threadId: string, messageId: string) {
  const t = db.getDoc('threads', threadId) as unknown as store.Thread | undefined;
  if (!t || !ctx.canOpen(t.accountId)) return null;
  const m = messageId ? t.messages.find((x) => x.id === messageId) : t.messages.at(-1);
  return m ? { t, m } : null;
}

/** What the checks said: from the message as stored (received mail), else from the Authentication-Results header. */
export function authOf(stored: string | undefined, headers: { key: string; line: string }[]) {
  const out: { spf?: string; dkim?: string; dmarc?: string } = {};
  const from = (s: string) => {
    for (const k of ['spf', 'dkim', 'dmarc'] as const) {
      const v = s.match(new RegExp(`\\b${k}=([a-z]+)`, 'i'))?.[1]?.toLowerCase();
      if (v && v !== '-' && !out[k]) out[k] = v;
    }
  };
  if (stored) from(stored);
  for (const h of headers.filter((x) => x.key === 'authentication-results')) from(h.line);
  return out;
}

async function original(ctx: Ctx, url: URL, res: ServerResponse) {
  const hit = find(ctx, String(url.searchParams.get('thread') ?? ''), String(url.searchParams.get('message') ?? ''));
  if (!hit) return ctx.json(res, 404, { error: 'No such email.' });
  const { t, m } = hit;
  const raw = await store.source(t, m, { wsId: t.workspaceId ?? wsOfAccount(t.accountId)?.id ?? '' } as store.Mailbox);
  if (url.searchParams.get('download') === '1') {
    const name = (t.subject || 'email').replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().slice(0, 80) || 'email';
    res.writeHead(200, { 'content-type': 'message/rfc822', 'content-disposition': `attachment; filename="${name.replace(/"/g, '')}.eml"; filename*=UTF-8''${encodeURIComponent(name)}.eml`, 'cache-control': 'private, no-store' });
    return res.end(raw);
  }
  const parsed = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  const lines = parsed.headerLines.map((h) => ({ key: h.key, line: h.line }));
  const dkimSig = lines.find((h) => h.key === 'dkim-signature')?.line ?? '';
  const signedBy = dkimSig.match(/\bd=([^;\s]+)/i)?.[1]?.toLowerCase();
  const head = raw.toString('utf8', 0, Math.min(raw.length, 2_000_000));
  const kept = (await import('./mailRaw.ts')).rawOf(t.id, m.id)?.kind ?? 'built';
  ctx.json(res, 200, {
    subject: parsed.subject ?? t.subject,
    messageId: parsed.messageId ?? m.mid ?? null,
    date: (parsed.date ?? new Date(m.date)).toISOString(),
    from: parsed.from?.text ?? `${m.from.name} <${m.from.email}>`,
    to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((x) => x.text).join(', ') : parsed.to.text) : '',
    cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map((x) => x.text).join(', ') : parsed.cc.text) : '',
    auth: authOf((m as { auth?: string }).auth, lines),
    signedBy: signedBy ?? null,
    // 'raw': exactly as it arrived or left; 'built': made from what the conversation holds (older mail, the demo's).
    kind: kept,
    size: raw.length,
    source: head,
    cut: raw.length > 2_000_000,
  });
}

/* ---------- print ---------- */

/** Pictures in mail go through our proxy; inline ones are already data: links; everything else is left out. */
export function printableHtml(html: string) {
  return confidential
    .cleanHtml(html)
    .replace(/\s(src)\s*=\s*("|')(https?:[^"']+)\2/gi, (_m, a, q, u) => ` ${a}=${q}/api/mail/img?u=${encodeURIComponent(u.replace(/&amp;/g, '&'))}${q}`)
    .replace(/\s(background)\s*=\s*("|')[^"']*\2/gi, '')
    .replace(/url\s*\(/gi, 'url-off(');
}

function printPage(ctx: Ctx, url: URL, res: ServerResponse) {
  const tid = String(url.searchParams.get('thread') ?? '');
  const t = db.getDoc('threads', tid) as any;
  if (!t || !ctx.canOpen(t.accountId)) return ctx.json(res, 404, { error: 'No such email.' });
  const only = String(url.searchParams.get('message') ?? '');
  const list = (t.messages ?? []).filter((m: any) => (!only || m.id === only) && m.delivery?.state !== 'held');
  if (!list.length) return ctx.json(res, 404, { error: 'No such email.' });
  const ws = wsOfAccount(t.accountId);
  const account = (ws?.accounts ?? []).find((a: any) => a.id === t.accountId);
  const who = (ps: Person[] | undefined) => (ps ?? []).map((p) => (p.name && p.name !== p.email ? `${esc(p.name)} &lt;${esc(p.email)}&gt;` : esc(p.email))).join(', ');
  const when = (iso: string) => new Date(iso).toUTCString().replace(/:\d\d GMT$/, ' UTC');
  const nonce = randomBytes(12).toString('base64');
  const one = (m: any) => {
    // A confidential email someone sent here: printing it is turned off (its sender's own copy prints).
    const shut = m.confidential && !m.confidential.sender;
    const body = shut ? '<p class="shut">This is a confidential email. Printing is turned off for it.</p>' : m.html ? printableHtml(m.html) : `<div class="plain">${esc(m.body ?? '')}</div>`;
    const files = shut ? [] : (m.attachments ?? []).filter((a: any) => !a.cid);
    return `<article><header><div class="from"><b>${esc(m.from?.name || m.from?.email)}</b> &lt;${esc(m.from?.email)}&gt;</div><div class="date">${esc(when(m.date))}</div>
<div class="to">To: ${who(m.to)}</div>${m.cc?.length ? `<div class="to">Cc: ${who(m.cc)}</div>` : ''}${m.replyTo?.length ? `<div class="to">Reply-To: ${who(m.replyTo)}</div>` : ''}</header><div class="body">${body}</div>${files.length ? `<div class="files">${files.map((a: any) => `<span>${esc(a.name)}${a.size ? ` (${esc(a.size)})` : ''}</span>`).join('')}</div>` : ''}</article>`;
  };
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-frame-options': 'SAMEORIGIN', // the app prints it from a hidden frame of its own
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
  });
  const auto = url.searchParams.get('auto') === '1';
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.subject || '(no subject)')}</title><base target="_blank"><style>
*{box-sizing:border-box}body{margin:0;padding:24px;color:#16161d;background:#fff;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:2px solid #16161d;padding-bottom:8px;margin-bottom:16px}.top b{font-size:13px}.top span{color:#555;font-size:12px}
h1{font-size:20px;line-height:1.3;margin:0 0 4px}.count{color:#555;font-size:12px;margin:0 0 16px}
article{padding:16px 0;border-top:1px solid #ccc;break-inside:auto}article:first-of-type{border-top:0}
header{margin-bottom:12px}.from{font-size:14px}.date{float:right;color:#555;font-size:12px;margin-top:-20px}.to{color:#555;font-size:12px}
.body{overflow-wrap:anywhere}.body img{max-width:100%;height:auto}.body table{max-width:100%}.plain{white-space:pre-wrap}.shut{color:#555;font-style:italic}
.files{margin-top:12px;color:#555;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 16px}.files span::before{content:"\\1F4CE  "}
@page{margin:16mm}@media print{body{padding:0}a{color:inherit}}
</style></head><body><div class="top"><b>${esc(account?.email ?? '')}</b><span>${esc(ws?.name ?? '')}</span></div><h1>${esc(t.subject || '(no subject)')}</h1>${list.length > 1 ? `<p class="count">${list.length} messages</p>` : ''}${list.map(one).join('')}${auto ? `<script nonce="${nonce}">addEventListener('load',function(){setTimeout(function(){print()},150)})</script>` : ''}</body></html>`);
}

/* ---------- pictures through our proxy ---------- */

const pics = new Map<string, { type: string; body: Buffer; at: number }>();
const PIC_TTL = 3600_000;
async function image(ctx: Ctx, url: URL, res: ServerResponse) {
  const u = String(url.searchParams.get('u') ?? '');
  if (!/^https?:\/\//i.test(u) || u.length > 4000) return (res.writeHead(400), res.end());
  if (ctx.tooMany(`mailimg:${ctx.me}`, 900, 60_000)) return (res.writeHead(429), res.end());
  const send = (p: { type: string; body: Buffer }) => {
    // Never a page of its own: an SVG opened straight from here can't run anything.
    res.writeHead(200, { 'content-type': p.type, 'cache-control': 'private, max-age=86400', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' });
    res.end(p.body);
  };
  const hit = pics.get(u);
  if (hit && Date.now() - hit.at < PIC_TTL) return send(hit);
  try {
    const got = await safeGet(u, { timeoutMs: 10_000, maxBytes: 8 * 1024 * 1024, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8' });
    const type = got.type.split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) return (res.writeHead(415), res.end());
    const p = { type, body: got.body, at: Date.now() };
    if (got.body.length < 1_500_000) {
      pics.set(u, p);
      if (pics.size > 300) for (const k of [...pics.keys()].slice(0, 50)) pics.delete(k);
    }
    send(p);
  } catch (e) {
    res.writeHead(e instanceof FetchError ? 404 : 502, { 'cache-control': 'private, max-age=300' });
    res.end();
  }
}

/** /api/mail/original, /api/mail/print, /api/mail/img and the confidential routes, for people signed in. */
export async function handleApi(p: string, req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (p.startsWith('/api/mail/confidential/')) return confidential.handleApi(p, req, res, ctx);
  if (req.method !== 'GET') return false;
  if (p === '/api/mail/original') return (await original(ctx, url, res), true);
  if (p === '/api/mail/print') return (printPage(ctx, url, res), true);
  if (p === '/api/mail/img') return (await image(ctx, url, res), true);
  return false;
}
