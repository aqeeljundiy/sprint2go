// Mail that sorts itself, on the server: inbox categories, the Important marker, the spam filter (with what Report spam
// and Not spam teach), phishing signs, muted conversations, Spam and Trash emptied after 30 days, and search with
// Gmail's operators over a full-text index (src/mailQuery.ts reads the operators; the app, the AI connector and IMAP
// share it).
//
// Everything here runs without paid AI: headers (List-Unsubscribe, List-Id, Precedence, Auto-Submitted), who the
// sender is, what the mailbox's people did with their earlier mail, and what each company reported. Learning is kept
// per mailbox (categories, importance) and per company (spam).
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import * as db from './db.ts';
import type { Message, MailWarning, Thread } from '../src/types.ts';
import { matchThread, parseQuery, requiredWords, type Category, type QueryCtx } from '../src/mailQuery.ts';
import { authOf, baseDomain, domainOfEmail, linkMismatches, lookalikeOf, TRUSTED, warningsFor } from '../src/mailSafety.ts';
import { fromPerson } from '../src/mailRules.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_cat_teach (account_id TEXT NOT NULL, sender TEXT NOT NULL, category TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (account_id, sender));
  CREATE TABLE IF NOT EXISTS mail_rep (workspace_id TEXT NOT NULL, key TEXT NOT NULL, spam INTEGER NOT NULL DEFAULT 0, ham INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, key));
  CREATE TABLE IF NOT EXISTS mail_tokens (workspace_id TEXT NOT NULL, token TEXT NOT NULL, spam INTEGER NOT NULL DEFAULT 0, ham INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, token));
  CREATE TABLE IF NOT EXISTS mail_engage (account_id TEXT NOT NULL, sender TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, opened INTEGER NOT NULL DEFAULT 0, replied INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0, marked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, sender));
  CREATE VIRTUAL TABLE IF NOT EXISTS mail_fts USING fts5(thread_id UNINDEXED, account_id UNINDEXED, subject, people, body, files, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS mail_fts_state (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL);
`);

const lower = (s: unknown) => String(s ?? '').toLowerCase().trim();
const now = () => new Date().toISOString();
const DAY = 86_400_000;
/** Spam and Trash keep mail this long, then it's deleted for good (as in Gmail). */
export const KEEP_DAYS = 30;

type Ws = { id: string; name?: string; domain?: string; accounts?: { id: string; email: string; users?: string[] }[]; members?: { userId: string }[] };
type Doc = Record<string, any>;

/* ---------- categories ---------- */

const SOCIAL = ['facebookmail.com', 'facebook.com', 'linkedin.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'pinterest.com', 'youtube.com', 'reddit.com', 'redditmail.com', 'quora.com', 'snapchat.com', 'discord.com', 'meetup.com', 'strava.com', 'threads.net', 'whatsapp.com', 'telegram.org'];
const FORUM_HOSTS = ['googlegroups.com', 'groups.io', 'discoursemail.com', 'freelists.org', 'lists.', 'mailman', 'groups.google.com', 'github.com'];
const PROMO_WORDS = /\b(sale|% ?off|discount|promo|deal|deals|offer|offers|coupon|voucher|diskon|gratis|cashback|flash sale|limited time|shop now|buy now|newsletter|webinar|free shipping|new arrivals|save \d+|exclusive|special price|best price|black friday|cyber monday|harbolnas)\b/i;
const UPDATE_WORDS = /\b(receipt|invoice|order|your order|confirmation|confirmed|statement|shipped|shipping|delivery|delivered|password|security alert|sign-?in|login|verification|verify|code|otp|your account|payment|paid|booking|reservation|ticket|itinerary|reminder|subscription|renewal|bill|tagihan|pembayaran|pesanan|struk|kode)\b/i;
const ESP_HEADERS = ['x-mailchimp', 'x-mc-user', 'x-campaign', 'x-campaignid', 'x-sg-eid', 'x-mailgun-tag', 'x-klaviyo', 'x-sendinblue', 'x-mailjet-campaign', 'x-hs-campaign', 'x-marketo'];

/** What arrived, in the words the classifier reads (built from the parsed mail by the mail engine). */
export interface Arrival {
  from: { name: string; email: string };
  subject: string;
  text: string;
  html?: string;
  headers: Record<string, string>; // lower-case names, first value
  listId?: string;
}

/** What the classifier reads, from a parsed email (mailparser) and the message the engine built. */
export function arrivalOf(parsed: { headerLines?: readonly { key: string; line: string }[]; subject?: string }, msg: { from: { name: string; email: string }; body?: string; html?: string }): Arrival {
  const headers: Record<string, string> = {};
  for (const h of parsed.headerLines ?? []) {
    const k = lower(h.key);
    if (headers[k] === undefined) headers[k] = String(h.line ?? '').replace(/^[^:]*:\s*/, '').replace(/\r?\n\s+/g, ' ').slice(0, 500);
  }
  const listRaw = headers['list-id'] ?? '';
  const listId = (listRaw.match(/<([^>]+)>/)?.[1] ?? listRaw).trim().toLowerCase() || undefined;
  return { from: msg.from, subject: parsed.subject ?? headers['subject'] ?? '', text: msg.body ?? '', html: msg.html, headers, listId };
}

/** A sender's tab taught by moving their mail, else null. */
export function taughtCategory(accountId: string, sender: string): Category | null {
  const e = lower(sender);
  const r = (db.db.prepare('SELECT category FROM mail_cat_teach WHERE account_id = ? AND sender IN (?, ?) ORDER BY length(sender) DESC').get(accountId, e, '@' + domainOfEmail(e)) as { category: string } | undefined)?.category;
  return (r as Category) ?? null;
}

/**
 * The inbox tab for a new email. What a person taught for the sender wins; then the headers and the sender say it.
 * `knownPerson`: the mailbox wrote to this sender before (always Primary).
 */
export function classify(a: Arrival, o: { accountId?: string; knownPerson?: boolean; internal?: boolean } = {}): Category {
  if (o.accountId) {
    const taught = taughtCategory(o.accountId, a.from.email);
    if (taught) return taught;
  }
  if (o.internal || o.knownPerson) return 'primary';
  const h = a.headers;
  const dom = domainOfEmail(a.from.email);
  const base = baseDomain(dom);
  const listId = lower(a.listId ?? h['list-id']);
  const subject = a.subject ?? '';
  const words = `${subject} ${(a.text ?? '').slice(0, 2000)}`;
  if (SOCIAL.some((d) => base === d || dom.endsWith('.' + d))) return 'social';
  const discussion = !!h['list-post'] || /\b(mailman|discourse|groups\.io|googlegroups|sympa|listserv)\b/i.test(`${h['x-mailer'] ?? ''} ${listId} ${h['list-help'] ?? ''}`);
  if (listId && (discussion || FORUM_HOSTS.some((x) => listId.includes(x)))) return 'forums';
  const bulk = !!h['list-unsubscribe'] || /bulk|list/i.test(h['precedence'] ?? '') || ESP_HEADERS.some((x) => h[x] !== undefined) || /campaign|newsletter|marketing/i.test(h['feedback-id'] ?? '');
  const automated = !fromPerson({ from: a.from, listUnsubscribe: undefined }) || /auto-(generated|replied|notified)/i.test(h['auto-submitted'] ?? '');
  if (UPDATE_WORDS.test(subject) && (automated || !PROMO_WORDS.test(subject))) {
    if (automated || bulk) return 'updates';
  }
  if (bulk && PROMO_WORDS.test(words)) return 'promotions';
  if (bulk) return automated || /\bnews|digest|weekly|monthly\b/i.test(subject) ? 'promotions' : 'updates';
  if (automated) return UPDATE_WORDS.test(words) ? 'updates' : 'updates';
  return 'primary';
}

/** A person moved an email to another tab: this sender's mail goes there from now on (in this mailbox). */
export function teachCategory(accountId: string, sender: string, category: Category) {
  const e = lower(sender);
  if (!e.includes('@')) return;
  db.db.prepare('INSERT INTO mail_cat_teach (account_id, sender, category, at) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, sender) DO UPDATE SET category = excluded.category, at = excluded.at').run(accountId, e, category, now());
}

/* ---------- spam ---------- */

const SPAM_PATTERNS: [RegExp, string][] = [
  [/\b(viagra|cialis|casino|lottery|loterie|jackpot|slot gacor|judi online|togel)\b/i, 'gambling or pills'],
  [/\b(you (have )?won|claim your (prize|reward)|congratulations,? you|selamat anda (memenangkan|mendapatkan))\b/i, 'prize'],
  [/\b(inheritance|beneficiary|next of kin|barrister|diplomatic (bag|courier)|million (us )?dollars|usd ?\d{1,3}(,\d{3}){2,})\b/i, 'money offer'],
  [/\b(wire transfer|western union|moneygram|bitcoin (wallet|doubling)|crypto (giveaway|doubling)|investment opportunity|guaranteed (profit|returns))\b/i, 'money transfer'],
  [/\b(dear (friend|beneficiary|customer|sir\/madam)|urgent (response|reply) (needed|required))\b/i, 'form letter'],
  [/\b(pinjaman online|pinjol|dana cepat tanpa jaminan)\b/i, 'loan offer'],
  [/\b(verify your account (now|immediately)|account (will be )?(suspended|closed|locked)|unusual sign-?in activity|confirm your (password|identity))\b/i, 'account scare'],
];

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]{2,24}/gu;
export function tokens(s: string): string[] {
  const out = new Set<string>();
  for (const m of lower(s).slice(0, 6000).matchAll(TOKEN_RE)) if (!/^\d+$/.test(m[0])) out.add(m[0]);
  return [...out].slice(0, 300);
}

function rep(workspaceId: string, key: string): { spam: number; ham: number } {
  return (db.db.prepare('SELECT spam, ham FROM mail_rep WHERE workspace_id = ? AND key = ?').get(workspaceId, key) as { spam: number; ham: number } | undefined) ?? { spam: 0, ham: 0 };
}

/** The share of spam among mail like this one, from what the company reported (0.5 when it hasn't seen enough). */
function bayes(workspaceId: string, toks: string[]): number {
  const tot = rep(workspaceId, '__messages__');
  if (tot.spam < 3 || tot.ham < 3) return 0.5;
  const q = db.db.prepare('SELECT spam, ham FROM mail_tokens WHERE workspace_id = ? AND token = ?');
  const probs: number[] = [];
  for (const t of toks) {
    const r = q.get(workspaceId, t) as { spam: number; ham: number } | undefined;
    if (!r || r.spam + r.ham < 2) continue;
    const ps = r.spam / tot.spam;
    const ph = r.ham / tot.ham;
    probs.push(Math.min(0.99, Math.max(0.01, ps / (ps + ph))));
  }
  if (!probs.length) return 0.5;
  // The 15 strongest signs either way (Graham's "plan for spam").
  const top = probs.sort((a, b) => Math.abs(b - 0.5) - Math.abs(a - 0.5)).slice(0, 15);
  const logS = top.reduce((s, p) => s + Math.log(p), 0);
  const logH = top.reduce((s, p) => s + Math.log(1 - p), 0);
  return 1 / (1 + Math.exp(logH - logS));
}

export interface SpamInput {
  workspaceId: string;
  from: { name: string; email: string };
  subject: string;
  text: string;
  html?: string;
  auth?: string;
  /** The sender's address is one of this company's (or a colleague's). */
  internal?: boolean;
  /** Someone here wrote to this sender before. */
  known?: boolean;
  /** The sending server is on a DNS blocklist. */
  listed?: boolean;
  /** Phishing signs already found (they add to the score). */
  warn?: MailWarning[];
}

/** How spammy an email looks (5 or more goes to Spam) and the reasons, in a few words each. */
export function scoreSpam(i: SpamInput): { score: number; spam: boolean; why: string[] } {
  if (i.internal) return { score: -10, spam: false, why: [] };
  let score = 0;
  const why: string[] = [];
  const add = (n: number, w: string) => ((score += n), n > 0 && !why.includes(w) && why.push(w));
  const a = authOf(i.auth);
  if (!a.arc) {
    if (a.dmarc === 'fail') add(5, 'failed DMARC');
    else if (a.spf === 'fail' && a.dkim !== 'pass') add(4, 'failed SPF');
    else if (a.spf === 'softfail' && a.dkim !== 'pass') add(1.5, 'weak SPF');
  }
  if (i.listed) add(5, 'sender on a blocklist');
  const text = `${i.subject} ${i.text}`;
  let pat = 0;
  for (const [re, w] of SPAM_PATTERNS) if (re.test(text) && pat < 6) (add(2, w), (pat += 2));
  const letters = i.subject.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 12 && letters === letters.toUpperCase()) add(1, 'shouting subject');
  if (/[!$]{3,}/.test(i.subject)) add(1, 'shouting subject');
  if (i.html && !i.text.trim() && /<img/i.test(i.html)) add(1, 'only a picture');
  if (i.html && /href=["']https?:\/\/\d{1,3}(\.\d{1,3}){3}/i.test(i.html)) add(2, 'links to bare addresses');
  if (linkMismatches(i.html).length) add(1.5, 'links that hide where they go');
  for (const w of i.warn ?? []) {
    if (w.kind === 'lookalike') add(3, 'lookalike sender');
    if (w.kind === 'spoof') add(3, 'pretends to be a colleague');
  }
  // What the company taught: this sender, its domain, and words like these.
  const s = rep(i.workspaceId, 'a:' + lower(i.from.email));
  const d = rep(i.workspaceId, 'd:' + baseDomain(domainOfEmail(i.from.email)));
  const learned = (s.spam * 5 - s.ham * 5) + (d.spam * 2 - d.ham * 2);
  if (learned > 0) add(Math.min(learned, 8), 'reported before');
  else if (learned < 0) score += Math.max(learned, -8);
  const p = bayes(i.workspaceId, tokens(text));
  if (p > 0.9) add((p - 0.5) * 8, 'looks like reported spam');
  else if (p < 0.2) score -= (0.5 - p) * 6;
  if (i.known) score -= 5;
  score = Math.round(score * 10) / 10;
  return { score, spam: score >= 5, why };
}

/** Report spam (or phishing, which counts heavier) and Not spam: the company's filter learns from it. */
export function learn(workspaceId: string, m: { from: { email: string }; subject: string; text: string }, spam: boolean, weight = 1) {
  const col = spam ? 'spam' : 'ham';
  const up = db.db.prepare(`INSERT INTO mail_rep (workspace_id, key, ${col}) VALUES (?, ?, ?) ON CONFLICT (workspace_id, key) DO UPDATE SET ${col} = ${col} + excluded.${col}`);
  up.run(workspaceId, 'a:' + lower(m.from.email), weight);
  up.run(workspaceId, 'd:' + baseDomain(domainOfEmail(m.from.email)), weight);
  up.run(workspaceId, '__messages__', 1);
  const tok = db.db.prepare(`INSERT INTO mail_tokens (workspace_id, token, ${col}) VALUES (?, ?, 1) ON CONFLICT (workspace_id, token) DO UPDATE SET ${col} = ${col} + 1`);
  db.db.exec('BEGIN');
  try {
    for (const t of tokens(`${m.subject} ${m.text}`)) tok.run(workspaceId, t);
    db.db.exec('COMMIT');
  } catch (e) {
    db.db.exec('ROLLBACK');
    throw e;
  }
}

const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc|fd|fe80)/i;
/**
 * Whether the sending server is on Spamhaus ZEN (a DNS blocklist). Live servers only (MAIL_DNSBL=0 turns it off; a
 * local server checks only with MAIL_DNSBL=1), private addresses never, and a slow answer counts as not listed.
 */
export async function dnsblListed(ip: string | undefined): Promise<boolean> {
  const on = process.env.MAIL_DNSBL ? process.env.MAIL_DNSBL === '1' : process.env.NODE_ENV === 'production';
  const addr = String(ip ?? '').replace(/^::ffff:/, '');
  if (!on || isIP(addr) !== 4 || PRIVATE.test(addr)) return false;
  const q = addr.split('.').reverse().join('.') + '.' + (process.env.MAIL_DNSBL_ZONE || 'zen.spamhaus.org');
  try {
    const r = await Promise.race([dns.resolve4(q), new Promise<string[]>((_, no) => setTimeout(() => no(new Error('slow')), 1500))]);
    // 127.255.255.x are the list's own errors (refused queries), not a listing.
    return r.some((x) => x.startsWith('127.0.0.') || x.startsWith('127.0.1.'));
  } catch {
    return false;
  }
}

/* ---------- importance ---------- */

function engage(accountId: string, sender: string) {
  return (db.db.prepare('SELECT seen, opened, replied, starred, marked FROM mail_engage WHERE account_id = ? AND sender = ?').get(accountId, lower(sender)) as { seen: number; opened: number; replied: number; starred: number; marked: number } | undefined) ?? { seen: 0, opened: 0, replied: 0, starred: 0, marked: 0 };
}
export function noteEngage(accountId: string, sender: string, what: 'seen' | 'opened' | 'replied' | 'starred' | 'marked', by = 1) {
  const e = lower(sender);
  if (!e.includes('@')) return;
  db.db.prepare(`INSERT INTO mail_engage (account_id, sender, ${what}) VALUES (?, ?, ?) ON CONFLICT (account_id, sender) DO UPDATE SET ${what} = ${what} + excluded.${what}`).run(accountId, e, by);
}

/**
 * Whether a new email is Important: what this mailbox's people did with this sender's mail (opened, replied, starred,
 * marked), whether it's addressed to them directly, and whether a person (not a system) wrote it.
 */
export function predictImportant(accountId: string, m: { from: { name: string; email: string }; listUnsubscribe?: unknown }, o: { direct: boolean; category: Category; internal?: boolean }): boolean {
  const e = engage(accountId, m.from.email);
  if (e.marked > 0) return true;
  if (e.marked < 0) return false;
  const person = fromPerson({ from: m.from, listUnsubscribe: m.listUnsubscribe as never });
  if (o.category !== 'primary' && e.replied === 0 && e.starred === 0) return false;
  if (e.replied > 0 && person) return true;
  if (e.starred > 0) return true;
  const rate = e.seen > 0 ? (e.opened + 2 * e.replied) / e.seen : 0;
  if (e.seen >= 2 && rate >= 0.7 && person) return true;
  return person && o.direct && !!o.internal;
}

/* ---------- on arrival ---------- */

/** The company's own domains and its people, for the phishing checks. */
function companyOf(ws: Ws) {
  const own = new Set<string>();
  for (const a of ws.accounts ?? []) if (a.email) own.add(domainOfEmail(a.email));
  if (ws.domain) own.add(lower(ws.domain));
  const ids = new Set((ws.members ?? []).map((m) => m.userId));
  const users = (db.allDocs('users') as Doc[]).filter((u) => ids.has(u.id));
  const colleagues = users.map((u) => ({ name: String(u.name ?? ''), email: lower(u.email) })).filter((u) => u.name);
  for (const u of colleagues) if (u.email) own.add(domainOfEmail(u.email));
  own.delete('');
  return { ownDomains: [...own], colleagues };
}

/** Senders and recipients this company's mailboxes have seen (for "first time" and "known"). */
function history(accountIds: Set<string>, sender: string, skipThread?: string) {
  const e = lower(sender);
  const ours = new Set((db.allDocs('workspaces') as Doc[]).flatMap((w) => (w.accounts ?? []).map((a: Doc) => lower(a.email))));
  let received = false;
  let wroteTo = false;
  for (const t of db.allDocs('threads') as Doc[]) {
    if (!accountIds.has(t.accountId) || t.id === skipThread) continue;
    for (const m of t.messages ?? []) {
      const from = lower(m.from?.email);
      if (from === e) received = true;
      else if (ours.has(from) && (m.to ?? []).some((p: Doc) => lower(p.email) === e)) wroteTo = true;
      if (received && wroteTo) return { received, wroteTo };
    }
  }
  return { received, wroteTo };
}

export interface ArriveCtx {
  ws: Ws;
  accountId: string;
  accountEmail: string;
  arrival: Arrival;
  /** What the mail engine's own checks said (DMARC or SPF failed without a trusted ARC seal). */
  authSpam: boolean;
  /** The sending server's address (for the blocklist), when it came from outside. */
  ip?: string;
  /** Addresses in the To header (not Cc): who it's addressed to directly. */
  directTo: string[];
  /** The conversation it joins, as it was before (null for a new one). */
  existing: Doc | null;
  /** Sent by a mailbox of ours (team mail delivered on this server). */
  internal?: boolean;
}

/**
 * Sorts a new email before it's saved: its tab, Important, Spam (with the reasons), phishing signs on the message, and
 * a muted conversation that stays out of the inbox. Takes the thread as the mail engine built it (with the new
 * message last) and returns it as it should be saved.
 */
export async function arrive<T extends Doc>(thread: T, ctx: ArriveCtx): Promise<T> {
  const t: Doc = { ...thread, messages: [...(thread.messages ?? [])] };
  const msg: Doc = { ...t.messages[t.messages.length - 1] };
  t.messages[t.messages.length - 1] = msg;
  const { ws, arrival } = ctx;
  const accounts = new Set((ws.accounts ?? []).map((a) => a.id));
  const company = companyOf(ws);
  const sender = lower(arrival.from.email);
  const internal = !!ctx.internal || company.ownDomains.includes(domainOfEmail(sender));
  const seenBefore = ctx.internal ? { received: true, wroteTo: true } : history(accounts, sender, t.id);
  if (arrival.listId) msg.listId = arrival.listId.slice(0, 200);

  // Phishing signs (never on our own team's mail).
  if (!ctx.internal) {
    const warn = warningsFor({ from: arrival.from, auth: msg.auth, html: arrival.html, body: arrival.text }, { ...company, firstTime: !seenBefore.received });
    if (warn.length) msg.warn = warn;
    else delete msg.warn;
  }

  // Spam: the engine's own verdict, the blocklist, the patterns and what this company taught.
  const listed = ctx.internal ? false : await dnsblListed(ctx.ip);
  const score = scoreSpam({ workspaceId: ws.id, from: arrival.from, subject: arrival.subject, text: arrival.text, html: arrival.html, auth: msg.auth, internal, known: seenBefore.wroteTo, listed, warn: msg.warn });
  const spam = !internal && (ctx.authSpam || score.spam);

  // Its tab and Important.
  const category = classify(arrival, { accountId: ctx.accountId, knownPerson: seenBefore.wroteTo, internal });
  const direct = ctx.directTo.map(lower).includes(lower(ctx.accountEmail));
  noteEngage(ctx.accountId, sender, 'seen');
  const ex = ctx.existing;
  if (!ex) {
    t.category = category;
    t.important = predictImportant(ctx.accountId, { from: arrival.from, listUnsubscribe: msg.listUnsubscribe }, { direct, category, internal });
  } else if (ex.importantBy !== 'you' && !ex.important) {
    // A reply can make a conversation important (never the other way round by itself).
    if (predictImportant(ctx.accountId, { from: arrival.from, listUnsubscribe: msg.listUnsubscribe }, { direct, category: ex.category ?? 'primary', internal })) t.important = true;
  }
  if (!t.important) delete t.important;

  if (spam && (!ex || ex.location !== 'inbox' || score.score >= 8)) {
    t.location = 'spam';
    t.spamAt = now();
    t.spamWhy = ctx.authSpam ? ['failed sender checks', ...score.why.filter((w) => !/^failed/.test(w))].slice(0, 4) : score.why.slice(0, 4);
  } else if (ex?.location === 'spam') {
    // A reply in a conversation already in Spam stays there.
    t.location = 'spam';
  }

  // Muted: new replies skip the inbox unless this mailbox is in To again (then it's unmuted and comes back).
  if (ex?.muted && t.location !== 'spam') {
    if (direct) delete t.muted;
    else {
      t.location = ex.location === 'trash' ? 'trash' : ex.location === 'inbox' ? 'archive' : ex.location;
      t.muted = true;
    }
  }
  if (t.location !== 'trash') delete t.trashedAt;
  return t as T;
}

/* ---------- what people do in the app teaches it ---------- */

const incomingOf = (t: Doc, mine: (e: string) => boolean) => [...(t.messages ?? [])].reverse().find((m: Doc) => m?.from?.email && !mine(m.from.email));

/**
 * A thread saved by the app (or a connected AI app, or a mail app over IMAP): the server keeps its own fields and
 * learns from the change. Report spam / Not spam teach the company's filter; moving it to another tab teaches its
 * sender's tab; opening, replying, starring and marking teach Important.
 */
export function guardSmart(d: db.Doc, before: db.Doc | undefined, workspaceId: string | undefined): db.Doc {
  const t = { ...(d as Doc) };
  const b = (before ?? null) as Doc | null;
  const at = now();
  const mineSet = new Set((db.allDocs('workspaces') as Doc[]).flatMap((w) => (w.accounts ?? []).map((a: Doc) => lower(a.email))));
  const mine = (e: string) => mineSet.has(lower(e));
  // Where it lives: the 30 days start when it goes to Spam or Trash, and stop when it leaves.
  if (t.location === 'spam') t.spamAt = b?.location === 'spam' ? (b.spamAt ?? at) : at;
  else delete t.spamAt;
  if (t.location === 'trash') t.trashedAt = b?.location === 'trash' ? (b.trashedAt ?? at) : at;
  else delete t.trashedAt;
  if (t.location !== 'spam') delete t.spamWhy;
  if (!b) return t as db.Doc;
  // Fields only the server sets stay when an older copy comes back without them: the tab, the list, the phishing signs.
  if (!t.category && b.category) t.category = b.category;
  const had = new Map(((b.messages ?? []) as Doc[]).map((m) => [m.id, m]));
  t.messages = ((t.messages ?? []) as Doc[]).map((m) => {
    const o = had.get(m?.id);
    if (!o) return m;
    const keep: Doc = {};
    if (o.warn && !m.warn) keep.warn = o.warn;
    if (o.listId && !m.listId) keep.listId = o.listId;
    return Object.keys(keep).length ? { ...m, ...keep } : m;
  });
  const inc = incomingOf(t, mine);
  const ws = workspaceId ?? (db.allDocs('workspaces') as Doc[]).find((w) => (w.accounts ?? []).some((a: Doc) => a.id === t.accountId))?.id;
  if (inc && ws) {
    const m = { from: inc.from, subject: String(t.subject ?? ''), text: String(inc.body ?? '') };
    if (t.location === 'spam' && b.location !== 'spam') learn(ws, m, true, (t.spamWhy ?? []).includes('phishing') ? 3 : 1);
    if (b.location === 'spam' && t.location !== 'spam' && t.location !== 'trash') learn(ws, m, false);
  }
  if (t.location === 'spam' && (t.spamWhy ?? []).includes('phishing') && !(b.spamWhy ?? []).includes('phishing') && inc) {
    // Reported as phishing: the reader shows it, and the sender's later mail is scored as such.
    t.messages = (t.messages ?? []).map((m: Doc) => (m.id === inc.id ? { ...m, warn: [...(m.warn ?? []).filter((w: Doc) => w.kind !== 'reported'), { kind: 'reported' }] } : m));
  }
  if (inc) {
    const sender = String(inc.from.email);
    if (t.category && t.category !== (b.category ?? 'primary')) teachCategory(String(t.accountId), sender, t.category);
    if (b.unread && !t.unread) noteEngage(String(t.accountId), sender, 'opened');
    if (!b.starred && t.starred) noteEngage(String(t.accountId), sender, 'starred');
    const newMine = (t.messages ?? []).length > (b.messages ?? []).length && (t.messages ?? []).slice((b.messages ?? []).length).some((m: Doc) => mine(m?.from?.email ?? ''));
    if (newMine && t.location !== 'drafts') noteEngage(String(t.accountId), sender, 'replied');
    if (!!t.important !== !!b.important) {
      t.importantBy = 'you';
      noteEngage(String(t.accountId), sender, 'marked', t.important ? 1 : -1);
    }
  }
  if (!t.important) delete t.important;
  if (t.importantBy !== 'you') delete t.importantBy;
  if (!t.muted) delete t.muted;
  return t as db.Doc;
}

/* ---------- Spam and Trash empty after 30 days ---------- */

/** Mail in Spam or Trash for 30 days is deleted for good. Returns the ids removed. */
export function sweepOld(nowMs = Date.now()): { removed: string[]; removedDocs: Doc[]; started: Doc[] } {
  const cut = new Date(nowMs - KEEP_DAYS * DAY).toISOString();
  const removed: string[] = [];
  const removedDocs: Doc[] = [];
  const started: Doc[] = [];
  for (const t of db.allDocs('threads') as Doc[]) {
    if (t.location === 'spam') {
      if (!t.spamAt) started.push({ ...t, spamAt: new Date(nowMs).toISOString() });
      else if (t.spamAt < cut) (removed.push(t.id), removedDocs.push(t));
    } else if (t.location === 'trash') {
      if (!t.trashedAt) started.push({ ...t, trashedAt: new Date(nowMs).toISOString() });
      else if (t.trashedAt < cut) (removed.push(t.id), removedDocs.push(t));
    }
  }
  if (removed.length || started.length) db.writeDocs('threads', started as db.Doc[], removed, null);
  if (removed.length) db.db.prepare(`DELETE FROM mail_fts WHERE thread_id IN (${removed.map(() => '?').join(',')})`).run(...removed);
  return { removed, removedDocs, started };
}

/* ---------- search ---------- */

/** Brings the full-text index up to date with the threads saved since it last looked. */
export function syncIndex() {
  const last = (db.db.prepare('SELECT at FROM mail_fts_state WHERE id = 1').get() as { at: string } | undefined)?.at ?? '';
  const rows = db.db.prepare("SELECT id, data, updated_at FROM docs WHERE coll = 'threads' AND updated_at >= ? ORDER BY updated_at").all(last) as { id: string; data: string; updated_at: string }[];
  if (!rows.length) return 0;
  const del = db.db.prepare('DELETE FROM mail_fts WHERE thread_id = ?');
  const ins = db.db.prepare('INSERT INTO mail_fts (thread_id, account_id, subject, people, body, files) VALUES (?, ?, ?, ?, ?, ?)');
  let max = last;
  db.db.exec('BEGIN');
  try {
    for (const r of rows) {
      const t = JSON.parse(r.data) as Doc;
      del.run(r.id);
      const ms = (t.messages ?? []) as Doc[];
      const people = ms.flatMap((m) => [m.from, ...(m.to ?? []), ...(m.bcc ?? [])]).filter(Boolean).map((p: Doc) => `${p.name ?? ''} ${p.email ?? ''}`).join(' ');
      const body = ms.map((m) => String(m.body || String(m.html ?? '').replace(/<[^>]+>/g, ' '))).join('\n').slice(0, 200_000);
      const files = ms.flatMap((m) => (m.attachments ?? []).map((a: Doc) => a.name)).join(' ');
      ins.run(r.id, String(t.accountId ?? ''), String(t.subject ?? ''), people, body, files);
      if (r.updated_at > max) max = r.updated_at;
    }
    db.db.prepare('INSERT INTO mail_fts_state (id, at) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at').run(max);
    db.db.exec('COMMIT');
  } catch (e) {
    db.db.exec('ROLLBACK');
    throw e;
  }
  return rows.length;
}

/** Words as an FTS query: each word's parts as a phrase, the last part as a prefix ("inv" finds "invoice"). */
export function ftsQuery(words: string[]): string {
  const parts = words
    .map((w) => (lower(w).match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8))
    .filter((p) => p.length)
    .map((p) => `"${p.join(' ')}" *`);
  return parts.join(' AND ');
}

/**
 * Conversations in these mailboxes that match a search with Gmail's operators, newest first. Plain words narrow the
 * candidates through the full-text index first; every candidate is then checked against the whole search.
 */
export function search(q: string, accountIds: string[], o: { limit?: number; ctx?: QueryCtx } = {}): Thread[] {
  const node = parseQuery(q);
  const ids = new Set(accountIds);
  if (!ids.size) return [];
  syncIndex();
  const words = requiredWords(node);
  let list: Doc[];
  const fq = ftsQuery(words);
  if (fq) {
    const marks = accountIds.map(() => '?').join(',');
    const hit = db.db.prepare(`SELECT DISTINCT thread_id FROM mail_fts WHERE mail_fts MATCH ? AND account_id IN (${marks}) LIMIT 5000`).all(fq, ...accountIds) as { thread_id: string }[];
    list = hit.map((h) => db.getDoc('threads', h.thread_id) as Doc | undefined).filter((t): t is Doc => !!t && ids.has(t.accountId));
  } else list = (db.allDocs('threads') as Doc[]).filter((t) => ids.has(t.accountId));
  const mineSet = new Set((db.allDocs('workspaces') as Doc[]).flatMap((w) => (w.accounts ?? []).filter((a: Doc) => ids.has(a.id)).map((a: Doc) => lower(a.email))));
  const ctx: QueryCtx = { isMine: (e) => mineSet.has(lower(e)), ...o.ctx };
  const last = (t: Doc) => String(t.messages?.[t.messages.length - 1]?.date ?? '');
  return list
    .filter((t) => matchThread(node, t as Thread, ctx))
    .sort((a, b) => last(b).localeCompare(last(a)))
    .slice(0, o.limit ?? 200) as Thread[];
}

/** For the reader on arrival-less mail (older threads): the same signs, worked out now. */
export function warningsNow(ws: Ws, m: Message): MailWarning[] {
  return warningsFor({ from: m.from, auth: m.auth, html: m.html, body: m.body }, companyOf(ws));
}

export { lookalikeOf, TRUSTED };
