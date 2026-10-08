// Sprint2go's own mail engine: receives mail for the companies' addresses over SMTP, sends their mail straight to the
// world (signed with DKIM) or, when a company chose "Boosted sending", through Amazon on our account. Everything lands in
// the same `threads` documents the Mail app already uses, so the app needs no second store.
//
// Env: MAIL_HOST (this server's mail name, default: the app's host), MAIL_IP (its public address, for the PTR check),
// MAIL_PORT (inbound SMTP, default 25 in production and 2525 otherwise), MAIL_RELAY_URL (optional smtp:// relay for the
// "own" route), MAIL_TLS_KEY / MAIL_TLS_CERT (optional; otherwise a self-signed pair is made once).
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { authenticate, dkimSign } from 'mailauth';
import { promises as dns } from 'node:dns';
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { mailConfigured, sendRaw, sesIdentity } from './mail.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_domains (domain TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, selector TEXT NOT NULL, private_key TEXT NOT NULL, public_key TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT, thread_id TEXT, message_id TEXT, route TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, raw BLOB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS outbox_due ON outbox (state, next_at);
  CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, direction TEXT NOT NULL, route TEXT, addr TEXT, bytes INTEGER, state TEXT, error TEXT, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS mail_log_ws ON mail_log (workspace_id, at);
`);

type Person = { name: string; email: string };
type Account = { id: string; email: string; name: string; kind: string; users: string[]; provider?: string; connected?: boolean };
type Ws = { id: string; name: string; domains?: string[]; accounts?: Account[]; members: { userId: string; role: string }[]; emailSetup?: string; mailRoute?: 'own' | 'boosted'; mailCredits?: number; mailCreditsNotified?: boolean };

export interface MailerDeps {
  publicUrl: string;
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
  notify: (userIds: string[], workspaceId: string, text: string, link?: string) => void;
  log: (line: string) => void;
}
let deps: MailerDeps;
const production = process.env.NODE_ENV === 'production';
export const MAIL_HOST = (process.env.MAIL_HOST ?? (process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).hostname : 'localhost')).toLowerCase();
export const MAIL_IP = process.env.MAIL_IP ?? '';
const MAIL_PORT = Number(process.env.MAIL_PORT ?? (production ? 25 : 2525));
const SELECTOR = 's2g';
const MAX_SIZE = 25 * 1024 * 1024;
const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const now = () => new Date().toISOString();
const lower = (s: string) => String(s ?? '').trim().toLowerCase();

/* ---------- who has which address ---------- */

const workspaces = () => db.allDocs('workspaces') as unknown as Ws[];
/** Every mailbox on this server, by address. */
export function localAccounts() {
  const map = new Map<string, { ws: Ws; account: Account }>();
  for (const ws of workspaces()) {
    const slug = lower(ws.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
    for (const a of ws.accounts ?? []) {
      if (!a.email) continue;
      if (!a.provider || a.provider === 'sprint2go') map.set(lower(a.email), { ws, account: a });
      // A mailbox that stays with Google or Microsoft gets a forwarding address here: a copy of its mail lands in the app.
      else map.set(`${lower(a.email).split('@')[0]}.${slug}@${MAIL_HOST}`, { ws, account: a });
    }
  }
  return map;
}
export const accountFor = (email: string) => localAccounts().get(lower(email)) ?? null;
/** The company's own mail domain (its first domain), else addresses live at this server's name. */
export const mailDomainOf = (ws: Ws) => lower(ws.domains?.[0] ?? '') || MAIL_HOST;
export const boostedAvailable = () => mailConfigured();

/* ---------- DKIM keys, one per domain ---------- */

export function domainKey(domain: string, workspaceId: string) {
  const d = lower(domain);
  let row = db.db.prepare('SELECT selector, private_key, public_key FROM mail_domains WHERE domain = ?').get(d) as { selector: string; private_key: string; public_key: string } | undefined;
  if (!row) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    row = { selector: SELECTOR, private_key: db.seal(privateKey), public_key: publicKey.toString('base64') };
    db.db.prepare('INSERT INTO mail_domains (domain, workspace_id, selector, private_key, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(d, workspaceId, row.selector, row.private_key, row.public_key, now());
  }
  return { selector: row.selector, privateKey: db.unseal(row.private_key), publicKey: row.public_key };
}
export const dkimRecord = (domain: string, workspaceId: string) => `v=DKIM1; k=rsa; p=${domainKey(domain, workspaceId).publicKey}`;

/* ---------- the DNS records a company needs, and whether they're there ---------- */

export interface DnsRecord {
  type: 'MX' | 'TXT' | 'CNAME';
  host: string;
  value: string;
  note: string;
  key: string; // which check it belongs to
}
export async function expectedRecords(ws: Ws): Promise<DnsRecord[]> {
  const domain = mailDomainOf(ws);
  if (domain === MAIL_HOST) return []; // addresses at our own name need nothing
  const mode = ws.emailSetup ?? 'none';
  const route = ws.mailRoute ?? 'own';
  const out: DnsRecord[] = [];
  if (mode === 'hosted') out.push({ type: 'MX', host: '@', value: MAIL_HOST, note: 'Priority 10. Mail for the domain comes here.', key: 'mx' });
  if (mode === 'mix') out.push({ type: 'MX', host: '@', value: '(stays with your provider)', note: 'Your provider keeps the MX and passes unknown addresses to ' + MAIL_HOST + ' (see the routing steps).', key: 'mx' });
  const spfParts = ['v=spf1'];
  if (mode === 'mix' || mode === 'keep') spfParts.push('(your provider’s include)');
  if (route === 'boosted') spfParts.push('include:amazonses.com');
  else spfParts.push(MAIL_IP ? `ip4:${MAIL_IP}` : `a:${MAIL_HOST}`);
  spfParts.push('~all');
  out.push({ type: 'TXT', host: '@', value: spfParts.join(' '), note: 'Who may send as your domain. Merge with an SPF record you already have.', key: 'spf' });
  if (route === 'boosted') {
    const ses = await sesIdentity(domain).catch(() => null);
    for (const t of ses?.tokens ?? []) out.push({ type: 'CNAME', host: `${t}._domainkey`, value: `${t}.dkim.amazonses.com`, note: 'Signs mail sent through Boosted sending.', key: 'dkim' });
    if (!ses?.tokens?.length) out.push({ type: 'CNAME', host: '(3 records)', value: 'given once Amazon knows the domain', note: 'Signs mail sent through Boosted sending.', key: 'dkim' });
  } else out.push({ type: 'TXT', host: `${SELECTOR}._domainkey`, value: dkimRecord(domain, ws.id), note: 'Signs mail sent from Sprint2go so Gmail and Outlook trust it.', key: 'dkim' });
  out.push({ type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, note: 'Tells receivers what to do with mail that fails the checks.', key: 'dmarc' });
  return out;
}

export interface DnsCheck {
  key: string;
  ok: boolean;
  found: string;
  want: string;
}
const txt = (host: string) => dns.resolveTxt(host).then((r) => r.map((x) => x.join('')), () => [] as string[]);
export async function checkDomain(ws: Ws): Promise<{ domain: string; at: string; checks: DnsCheck[]; allOk: boolean }> {
  const domain = mailDomainOf(ws);
  const checks: DnsCheck[] = [];
  if (domain === MAIL_HOST) return { domain, at: now(), checks, allOk: true };
  const mode = ws.emailSetup ?? 'none';
  const route = ws.mailRoute ?? 'own';
  const mx = await dns.resolveMx(domain).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => lower(x.exchange)), () => [] as string[]);
  if (mode === 'hosted') checks.push({ key: 'mx', ok: mx[0] === MAIL_HOST, found: mx.join(', ') || 'none', want: MAIL_HOST });
  else if (mode === 'mix' || mode === 'keep') checks.push({ key: 'mx', ok: mx.length > 0 && mx[0] !== MAIL_HOST, found: mx.join(', ') || 'none', want: 'your provider' });
  const spf = (await txt(domain)).find((t) => t.toLowerCase().startsWith('v=spf1')) ?? '';
  const spfWant = route === 'boosted' ? 'include:amazonses.com' : MAIL_IP ? `ip4:${MAIL_IP}` : `a:${MAIL_HOST}`;
  checks.push({ key: 'spf', ok: spf.toLowerCase().includes(spfWant.toLowerCase()) || (route === 'own' && !!MAIL_IP && spf.toLowerCase().includes(`a:${MAIL_HOST}`)), found: spf || 'none', want: spfWant });
  if (route === 'boosted') {
    const ses = await sesIdentity(domain).catch(() => null);
    const tokens = ses?.tokens ?? [];
    const results = await Promise.all(tokens.map((t) => dns.resolveCname(`${t}._domainkey.${domain}`).then((r) => lower(r[0] ?? '') === `${t}.dkim.amazonses.com`, () => false)));
    checks.push({ key: 'dkim', ok: tokens.length > 0 && results.every(Boolean), found: tokens.length ? `${results.filter(Boolean).length} of ${tokens.length} records` : 'Amazon has no identity for this domain yet', want: '3 CNAME records' });
  } else {
    const rec = (await txt(`${SELECTOR}._domainkey.${domain}`)).find((t) => t.includes('p=')) ?? '';
    const want = domainKey(domain, ws.id).publicKey;
    checks.push({ key: 'dkim', ok: rec.replace(/\s/g, '').includes(`p=${want}`), found: rec ? 'a DKIM record' + (rec.replace(/\s/g, '').includes(`p=${want}`) ? '' : ' with a different key') : 'none', want: `${SELECTOR}._domainkey TXT` });
  }
  const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => t.toLowerCase().startsWith('v=dmarc1')) ?? '';
  checks.push({ key: 'dmarc', ok: !!dmarc, found: dmarc || 'none', want: 'v=DMARC1; p=quarantine' });
  return { domain, at: now(), checks, allOk: checks.every((c) => c.ok) };
}

/** This server's own sending health: reverse DNS, its A record and whether port 25 is open outward. Cached 10 min. */
let healthCache: { at: number; value: { ptr: DnsCheck; a: DnsCheck; port25: DnsCheck; inbound: DnsCheck } } | null = null;
export async function serverHealth() {
  if (healthCache && healthCache.at > Date.now() - 10 * 60_000) return healthCache.value;
  const ptrNames = MAIL_IP ? await dns.reverse(MAIL_IP).catch(() => [] as string[]) : [];
  const a = await dns.resolve4(MAIL_HOST).catch(() => [] as string[]);
  const port25 = await new Promise<boolean>((res) => {
    const s = connect({ host: 'gmail-smtp-in.l.google.com', port: 25, timeout: 6000 });
    s.once('connect', () => (s.destroy(), res(true)));
    s.once('timeout', () => (s.destroy(), res(false)));
    s.once('error', () => res(false));
  });
  const value = {
    ptr: { key: 'ptr', ok: ptrNames.map(lower).includes(MAIL_HOST), found: ptrNames.join(', ') || (MAIL_IP ? 'none' : 'MAIL_IP not set'), want: MAIL_HOST },
    a: { key: 'a', ok: !MAIL_IP || a.includes(MAIL_IP), found: a.join(', ') || 'none', want: MAIL_IP || 'an A record' },
    port25: { key: 'port25', ok: port25, found: port25 ? 'open' : 'blocked or no answer', want: 'open' },
    inbound: { key: 'inbound', ok: listening, found: listening ? `listening on ${MAIL_PORT}` : 'not listening', want: `port ${MAIL_PORT}` },
  };
  healthCache = { at: Date.now(), value };
  return value;
}

/* ---------- receiving ---------- */

let listening = false;
function tlsOptions() {
  const key = process.env.MAIL_TLS_KEY, cert = process.env.MAIL_TLS_CERT;
  if (key && cert && existsSync(key) && existsSync(cert)) return { key: readFileSync(key), cert: readFileSync(cert) };
  const k = join(db.dataDir, 'mail-key.pem'), c = join(db.dataDir, 'mail-cert.pem');
  if (!existsSync(k) || !existsSync(c)) {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', k, '-out', c, '-days', '3650', '-subj', `/CN=${MAIL_HOST}`], { stdio: 'ignore' });
    } catch {
      return null; // no openssl: plain SMTP only
    }
  }
  return { key: readFileSync(k), cert: readFileSync(c) };
}

export function startMailer(d: MailerDeps) {
  deps = d;
  if (process.env.MAIL_ENABLED === '0') return;
  const tls = tlsOptions();
  const server = new SMTPServer({
    name: MAIL_HOST,
    banner: 'Sprint2go mail',
    size: MAX_SIZE,
    disabledCommands: ['AUTH'],
    hideSTARTTLS: !tls,
    ...(tls ?? {}),
    onRcptTo(address, _session, cb) {
      if (accountFor(address.address)) return cb();
      cb(Object.assign(new Error('No such mailbox here'), { responseCode: 550 }));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        if ((stream as any).sizeExceeded) return cb(Object.assign(new Error('Message too large'), { responseCode: 552 }));
        receive(Buffer.concat(chunks), session).then(
          () => cb(),
          (e) => (deps.log(`[mail] inbound failed: ${e instanceof Error ? e.message : e}`), cb(Object.assign(new Error('Could not store the message, try again later'), { responseCode: 451 }))),
        );
      });
    },
  });
  server.on('error', (e) => deps.log(`[mail] ${e.message}`));
  server.listen(MAIL_PORT, '0.0.0.0', () => {
    listening = true;
    deps.log(`Mail: receiving for ${MAIL_HOST} on port ${MAIL_PORT}${tls ? ' (STARTTLS)' : ''}; sending ${process.env.MAIL_RELAY_URL ? 'through the relay' : 'direct'}${boostedAvailable() ? ', Boosted available' : ''}`);
  });
  setInterval(() => void pump(), 30_000);
  void pump();
}

const cleanSubject = (s: string) => String(s ?? '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim();
const person = (v: { name?: string; address?: string } | undefined): Person => ({ name: v?.name || (v?.address ?? '').split('@')[0], email: lower(v?.address ?? '') });

async function receive(raw: Buffer, session: SMTPServerSession) {
  const parsed = await simpleParser(raw);
  const sender = session.envelope.mailFrom ? session.envelope.mailFrom.address : '';
  let spam = false;
  let authSummary = '';
  try {
    const auth = await authenticate(raw, { ip: session.remoteAddress, helo: session.hostNameAppearsAs, sender, mta: MAIL_HOST });
    const dmarc = (auth.dmarc as any)?.status?.result as string | undefined;
    const spf = (auth.spf as any)?.status?.result as string | undefined;
    const dkimPass = (auth.dkim?.results ?? []).some((r: any) => r.status?.result === 'pass');
    spam = dmarc === 'fail' || (spf === 'fail' && !dkimPass);
    authSummary = `spf=${spf ?? '-'} dkim=${dkimPass ? 'pass' : 'none'} dmarc=${dmarc ?? '-'}`;
  } catch {
    /* no verdict: treat as ordinary mail */
  }
  const mid = parsed.messageId ?? `<${randomBytes(8).toString('hex')}@${MAIL_HOST}>`;
  const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])].filter(Boolean) as string[];
  const addrs = (v: ParsedMail['to']) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.value).map(person);
  const html = parsed.html || undefined;
  const trackers = html ? (html.match(/<img[^>]+(width|height)\s*=\s*["']?1\b/gi) ?? []).length : 0;
  const unsub = parsed.headers.get('list-unsubscribe') as unknown as string | undefined;
  const unsubUrl = typeof unsub === 'string' ? unsub.match(/<(https?:[^>]+)>/)?.[1] : undefined;
  for (const rcpt of session.envelope.rcptTo) {
    const hit = accountFor(rcpt.address);
    if (!hit) continue;
    const { ws, account } = hit;
    const attachments = parsed.attachments.map((a) => {
      const id = randomBytes(16).toString('hex');
      db.saveFile({ id, workspaceId: ws.id, by: 'mail', name: a.filename ?? 'attachment', type: a.contentType ?? 'application/octet-stream', size: a.size }, a.content);
      return { name: a.filename ?? 'attachment', size: fmtSize(a.size), url: `/api/files/${id}` };
    });
    const msg = {
      id: 'm-' + randomBytes(6).toString('hex'),
      mid,
      from: person(parsed.from?.value?.[0]),
      to: [...addrs(parsed.to), ...addrs(parsed.cc)],
      date: (parsed.date ?? new Date()).toISOString(),
      body: (parsed.text ?? '').trim(),
      html,
      attachments: attachments.length ? attachments : undefined,
      trackersBlocked: trackers || undefined,
      listUnsubscribe: unsubUrl ? { url: unsubUrl, oneClick: !!parsed.headers.get('list-unsubscribe-post') } : undefined,
      auth: authSummary || undefined,
    };
    const threads = (db.allDocs('threads') as any[]).filter((t) => t.accountId === account.id);
    const existing = refs.length ? threads.find((t) => (t.messages ?? []).some((m: any) => m.mid && refs.includes(m.mid))) : undefined;
    const thread = existing
      ? { ...existing, unread: true, location: existing.location === 'trash' || existing.location === 'archive' ? 'inbox' : existing.location, snoozedUntil: undefined, messages: [...existing.messages, msg] }
      : { id: 't-' + randomBytes(6).toString('hex'), accountId: account.id, subject: cleanSubject(parsed.subject ?? '') || '(no subject)', location: spam ? 'spam' : 'inbox', starred: false, unread: true, labels: [], messages: [msg], workspaceId: ws.id };
    db.writeDocs('threads', [thread], [], null);
    deps.broadcast('threads', [thread], []);
    db.db.prepare('INSERT INTO mail_log (workspace_id, direction, route, addr, bytes, state, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ws.id, 'in', spam ? 'spam' : 'inbox', lower(rcpt.address), raw.length, 'stored', authSummary || null, now());
  }
}

/* ---------- sending ---------- */

export interface Outgoing {
  workspaceId: string;
  accountId: string;
  threadId: string;
  messageId: string;
  from: Person;
  to: Person[];
  cc: Person[];
  subject: string;
  text: string;
  html?: string;
  files: { name: string; url: string }[];
  inReplyTo?: string;
  references?: string[];
}

const fileBuffer = (url: string): Buffer | null => {
  const m = url.match(/^\/api\/files\/([a-f0-9]{32})$/);
  if (m) return db.fileData(m[1]);
  const d = url.match(/^data:[^;]*;base64,(.+)$/);
  return d ? Buffer.from(d[1], 'base64') : null;
};

/** Builds the message, signs it and queues one delivery per outside recipient; our own mailboxes get it at once. */
export async function queueSend(o: Outgoing): Promise<{ mid: string; queued: number; local: number; route: 'own' | 'boosted' }> {
  const ws = workspaces().find((w) => w.id === o.workspaceId);
  if (!ws) throw new Error('No such company');
  const domain = lower(o.from.email.split('@')[1] ?? '');
  const mid = `<${randomBytes(12).toString('hex')}@${domain || MAIL_HOST}>`;
  let route: 'own' | 'boosted' = ws.mailRoute === 'boosted' && boostedAvailable() ? 'boosted' : 'own';
  const recipients = [...o.to, ...o.cc].map((p) => ({ ...p, email: lower(p.email) })).filter((p, i, all) => p.email && all.findIndex((x) => x.email === p.email) === i);
  const mine = localAccounts();
  const local = recipients.filter((p) => mine.has(p.email));
  const remote = recipients.filter((p) => !mine.has(p.email));
  if (route === 'boosted' && (ws.mailCredits ?? 0) < remote.length) {
    route = 'own';
    if (!ws.mailCreditsNotified) {
      const admins = ws.members.filter((m) => m.role !== 'member').map((m) => m.userId);
      deps.notify(admins, ws.id, 'Boosted sending has no credits left; mail goes out from the Sprint2go server until you top up.', '/settings/email');
      db.writeDocs('workspaces', [{ ...(ws as any), mailCreditsNotified: true }], [], null);
    }
  }
  const composer = new MailComposer({
    from: { name: o.from.name, address: o.from.email },
    to: o.to.map((p) => ({ name: p.name, address: p.email })),
    cc: o.cc.length ? o.cc.map((p) => ({ name: p.name, address: p.email })) : undefined,
    subject: o.subject,
    text: o.text,
    html: o.html,
    messageId: mid,
    inReplyTo: o.inReplyTo,
    references: o.references,
    attachments: o.files.map((f) => ({ filename: f.name, content: fileBuffer(f.url) ?? Buffer.alloc(0) })),
    headers: { 'X-Mailer': 'Sprint2go' },
  });
  let raw: Buffer = await composer.compile().build();
  if (route === 'own' && domain && domain !== MAIL_HOST) {
    const key = domainKey(domain, ws.id);
    const { signatures } = await dkimSign(raw, { signingDomain: domain, selector: key.selector, privateKey: key.privateKey, canonicalization: 'relaxed/relaxed' });
    raw = Buffer.concat([Buffer.from(signatures), raw]);
  }
  // Our own mailboxes in other companies get a copy straight away (same-company copies are made by the app).
  let localCount = 0;
  for (const p of local) {
    const hit = mine.get(p.email)!;
    if (hit.ws.id === ws.id) continue;
    const parsed = await simpleParser(raw);
    const msg = { id: 'm-' + randomBytes(6).toString('hex'), mid, from: o.from, to: recipients, date: now(), body: o.text, html: o.html, attachments: parsed.attachments.length ? o.files.map((f, i) => ({ name: f.name, size: fmtSize(parsed.attachments[i]?.size ?? 0), url: f.url })) : undefined };
    const thread = { id: 't-' + randomBytes(6).toString('hex'), accountId: hit.account.id, subject: o.subject || '(no subject)', location: 'inbox', starred: false, unread: true, labels: [], messages: [msg], workspaceId: hit.ws.id };
    db.writeDocs('threads', [thread], [], null);
    deps.broadcast('threads', [thread], []);
    localCount++;
  }
  const ins = db.db.prepare('INSERT INTO outbox (id, workspace_id, account_id, thread_id, message_id, route, from_addr, to_addr, raw, attempts, next_at, state, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)');
  for (const p of remote) ins.run(randomBytes(8).toString('hex'), ws.id, o.accountId, o.threadId, o.messageId, route, lower(o.from.email), p.email, raw, now(), 'queued', now());
  if (route === 'boosted' && remote.length) {
    db.writeDocs('workspaces', [{ ...(ws as any), mailCredits: Math.max(0, (ws.mailCredits ?? 0) - remote.length) }], [], null);
    deps.broadcast('workspaces', [db.getDoc('workspaces', ws.id)!], []);
  }
  markDelivery(o.threadId, o.messageId, mid, remote.length ? 'sending' : 'sent');
  void pump();
  return { mid, queued: remote.length, local: localCount, route };
}

/** Writes the delivery state on the message inside its thread, so the app can show "sending", "sent" or "failed". */
function markDelivery(threadId: string, messageId: string, mid: string | null, state: 'sending' | 'sent' | 'failed', error?: string) {
  const t = db.getDoc('threads', threadId) as any;
  if (!t) return;
  const messages = (t.messages ?? []).map((m: any) => (m.id === messageId ? { ...m, mid: mid ?? m.mid, delivery: { state, at: now(), ...(error ? { error } : {}) } } : m));
  const next = { ...t, messages };
  db.writeDocs('threads', [next], [], null);
  deps.broadcast('threads', [next], []);
}

const BACKOFF = [60, 300, 900, 3600, 4 * 3600, 8 * 3600];
let pumping = false;
/** Delivers what's due in the outbox: one SMTP conversation per recipient, retried with backoff for about a day. */
export async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const due = db.db.prepare("SELECT * FROM outbox WHERE state = 'queued' AND next_at <= ? ORDER BY created_at LIMIT 20").all(now()) as any[];
    for (const row of due) {
      try {
        if (row.route === 'boosted') await sendRaw([row.to_addr], row.raw as Buffer, row.from_addr);
        else await deliverDirect(row.from_addr, row.to_addr, row.raw as Buffer);
        db.db.prepare("UPDATE outbox SET state = 'sent', error = NULL, raw = x'' WHERE id = ?").run(row.id);
        db.db.prepare('INSERT INTO mail_log (workspace_id, direction, route, addr, bytes, state, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(row.workspace_id, 'out', row.route, row.to_addr, (row.raw as Buffer).length, 'sent', null, now());
        settle(row);
      } catch (e) {
        const err = e as Error & { responseCode?: number };
        const permanent = (err.responseCode ?? 0) >= 500 && (err.responseCode ?? 0) < 600;
        const attempts = row.attempts + 1;
        if (permanent || attempts > BACKOFF.length) {
          db.db.prepare("UPDATE outbox SET state = 'failed', attempts = ?, error = ?, raw = x'' WHERE id = ?").run(attempts, err.message.slice(0, 300), row.id);
          db.db.prepare('INSERT INTO mail_log (workspace_id, direction, route, addr, bytes, state, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(row.workspace_id, 'out', row.route, row.to_addr, (row.raw as Buffer).length, 'failed', err.message.slice(0, 300), now());
          settle(row, err.message);
        } else {
          db.db.prepare("UPDATE outbox SET attempts = ?, next_at = ?, error = ? WHERE id = ?").run(attempts, new Date(Date.now() + BACKOFF[attempts - 1] * 1000).toISOString(), err.message.slice(0, 300), row.id);
        }
        deps.log(`[mail] to ${row.to_addr} (${row.route}, try ${attempts}): ${err.message}`);
      }
    }
  } finally {
    pumping = false;
  }
}

/** When every recipient of a message is settled, the message shows sent or failed, and failures tell the sender. */
function settle(row: any, error?: string) {
  const open = db.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE thread_id = ? AND message_id = ? AND state = 'queued'").get(row.thread_id, row.message_id) as { n: number };
  if (open.n) return;
  const failed = db.db.prepare("SELECT to_addr, error FROM outbox WHERE thread_id = ? AND message_id = ? AND state = 'failed'").all(row.thread_id, row.message_id) as { to_addr: string; error: string }[];
  markDelivery(row.thread_id, row.message_id, null, failed.length ? 'failed' : 'sent', failed.length ? `${failed.map((f) => f.to_addr).join(', ')}: ${failed[0].error}` : undefined);
  if (failed.length || error) {
    const ws = workspaces().find((w) => w.id === row.workspace_id);
    const account = ws?.accounts?.find((a) => a.id === row.account_id);
    const who = account?.users?.length ? account.users : (ws?.members ?? []).map((m) => m.userId);
    deps.notify(who, row.workspace_id, `Your email to ${failed.map((f) => f.to_addr).join(', ') || row.to_addr} could not be delivered: ${(failed[0]?.error ?? error ?? '').slice(0, 140)}`, '/mail');
  }
}

async function deliverDirect(from: string, to: string, raw: Buffer) {
  const relay = process.env.MAIL_RELAY_URL;
  if (relay) {
    const t = nodemailer.createTransport({ url: relay, name: MAIL_HOST } as Parameters<typeof nodemailer.createTransport>[0]);
    await t.sendMail({ envelope: { from, to: [to] }, raw });
    return;
  }
  const domain = to.split('@')[1];
  const mx = await dns.resolveMx(domain).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => x.exchange)).catch(() => [] as string[]);
  const hosts = mx.length ? mx : [domain];
  let last: Error | null = null;
  for (const host of hosts.slice(0, 3)) {
    try {
      const t = nodemailer.createTransport({ host, port: 25, secure: false, name: MAIL_HOST, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000, tls: { rejectUnauthorized: false } });
      await t.sendMail({ envelope: { from, to: [to] }, raw });
      return;
    } catch (e) {
      last = e as Error;
      if ((e as any).responseCode >= 500) throw e; // the receiver refused for good
    }
  }
  throw last ?? new Error('No mail server answered');
}

/* ---------- numbers for Settings and the operator backend ---------- */

export function mailStats(workspaceId: string, since: string) {
  const rows = db.db.prepare('SELECT direction, route, state, COUNT(*) AS n, SUM(bytes) AS bytes FROM mail_log WHERE workspace_id = ? AND at >= ? GROUP BY direction, route, state').all(workspaceId, since) as { direction: string; route: string; state: string; n: number; bytes: number }[];
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((n, r) => n + r.n, 0);
  return { received: sum((r) => r.direction === 'in'), spam: sum((r) => r.direction === 'in' && r.route === 'spam'), sent: sum((r) => r.direction === 'out' && r.state === 'sent'), boosted: sum((r) => r.direction === 'out' && r.route === 'boosted' && r.state === 'sent'), failed: sum((r) => r.direction === 'out' && r.state === 'failed'), queued: (db.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE workspace_id = ? AND state = 'queued'").get(workspaceId) as { n: number }).n };
}
export const mailStatsAll = (since: string) =>
  db.db.prepare('SELECT workspace_id AS workspaceId, direction, route, state, COUNT(*) AS n FROM mail_log WHERE at >= ? GROUP BY workspace_id, direction, route, state').all(since) as { workspaceId: string; direction: string; route: string; state: string; n: number }[];
