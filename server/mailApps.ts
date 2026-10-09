// "Phone mail apps": sprint2go mail in iPhone Mail, Gmail and Outlook on Android, Thunderbird and the rest, over IMAP
// (server/imap.ts) and SMTP submission (server/submission.ts).
//  - Off unless IMAP_ENABLED=1 and the mail certificate is trusted (server/mailcert.ts): mail apps refuse a self-signed
//    one, and nobody should type a password over a line they can't check. IMAP_TEST_TLS=1 counts a self-signed one as
//    trusted, but only for a test host (MAIL_HOST localhost, *.localhost or *.test).
//  - Signing in: app passwords only. Each person makes named ones in Settings, Phone mail apps; they're shown once and
//    kept as a keyed hash. Their normal password never works here, so two-step sign-in stays meaningful. Failures are
//    limited per address and per username like the web sign-in, and a changed password, "sign out everywhere" or a
//    deleted account ends every app password.
//  - A company's admins can switch other mail apps off (workspace.mailApps = false); its mailboxes leave the mail apps.
//  - Thunderbird finds the settings at /.well-known/autoconfig/mail/config-v1.1.xml, Apple devices get a profile
//    (.mobileconfig) with everything but the password.
// Ports: IMAP_PORT (143, STARTTLS), IMAPS_PORT (993), SUBMISSION_PORT (587, STARTTLS), SUBMISSIONS_PORT (465); outside
// production 1143, 1993, 1587 and 1465. See docs/imap.md.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { createSecureContext, type SecureContext } from 'node:tls';
import * as db from './db.ts';
import { certState, currentTls, loadTls, onCertChange, acmeConfigured } from './mailcert.ts';
import { MAIL_HOST, refreshReadiness } from './mailer.ts';
import * as imap from './imap.ts';
import * as submission from './submission.ts';
import * as store from './imapStore.ts';
import * as raws from './mailRaw.ts';
import { companyTz } from '../src/jobTimes.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS app_passwords (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used_at TEXT, last_used_by TEXT);
  CREATE INDEX IF NOT EXISTS app_passwords_user ON app_passwords (user_id);
`);

type Account = { id: string; email?: string; name?: string; kind?: string; users?: string[]; provider?: string };
type Ws = { id: string; name?: string; accounts?: Account[]; members: { userId: string; role: string }[]; mailAliases?: { address: string; to?: string[] }[]; mailApps?: boolean; timeZone?: string; suspended?: unknown; plan?: { paused?: unknown }; mailReady?: { mailboxes?: Record<string, { send?: boolean }> } };

export interface MailAppsDeps {
  /** Saves documents through the app's rules (index.ts applySync). */
  write: (userId: string, coll: string, upserts: unknown[], deletes: string[]) => { status: number; body: { saved?: number; why?: string; error?: string } };
  /** The companies this person is on the team of. */
  memberOf: (userId: string) => Ws[];
  readOnlyWhy: (ws: Ws) => string | null;
  log: (line: string) => void;
}
let deps: MailAppsDeps;

const production = process.env.NODE_ENV === 'production';
const port = (name: string, prod: number, dev: number) => Number(process.env[name] ?? (production ? prod : dev));
export const PORTS = { imap: port('IMAP_PORT', 143, 1143), imaps: port('IMAPS_PORT', 993, 1993), submission: port('SUBMISSION_PORT', 587, 1587), submissions: port('SUBMISSIONS_PORT', 465, 1465) };
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const now = () => new Date().toISOString();

/* ---------- on or off ---------- */

const enabledByEnv = () => process.env.IMAP_ENABLED === '1';
const testHost = () => MAIL_HOST === 'localhost' || /\.(localhost|test)$/.test(MAIL_HOST);
/** The certificate mail apps will accept: publicly trusted for MAIL_HOST (or, in tests only, any). */
const trustedNow = () => !!currentTls() && (certState(MAIL_HOST).trusted || (process.env.IMAP_TEST_TLS === '1' && testHost()));
let started = false;
let starting = false;
let portError: string | null = null;

export type Missing = 'switch' | 'certificate' | 'ports' | null;
export function status(): { on: boolean; missing: Missing; detail: string | null } {
  if (!enabledByEnv()) return { on: false, missing: 'switch', detail: null };
  if (!trustedNow()) {
    const c = certState(MAIL_HOST);
    return { on: false, missing: 'certificate', detail: c.error?.message ?? (acmeConfigured() ? 'Let’s Encrypt hasn’t issued it yet.' : 'CF_DNS_TOKEN (the Cloudflare token) isn’t set, so Let’s Encrypt can’t issue it.') };
  }
  if (!started) return { on: false, missing: 'ports', detail: portError };
  return { on: true, missing: null, detail: null };
}

/* ---------- app passwords ---------- */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** Four groups of four letters (about 75 bits), easy to type on a phone. */
const newSecret = () => Array.from({ length: 16 }, () => LETTERS[randomInt(26)]).join('');
const shown = (s: string) => s.match(/.{4}/g)!.join('-');
const normal = (pw: string) => String(pw ?? '').toLowerCase().replace(/[^a-z]/g, '');
const hashOf = (secret: string) => db.keyedHash(`app-password:${secret}`);
type Row = { id: string; user_id: string; name: string; hash: string; created_at: string; last_used_at: string | null; last_used_by: string | null };

export const passwordsOf = (userId: string) =>
  (db.db.prepare('SELECT id, name, created_at, last_used_at, last_used_by FROM app_passwords WHERE user_id = ? ORDER BY created_at DESC').all(userId) as Omit<Row, 'user_id' | 'hash'>[]).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at, lastUsedBy: r.last_used_by }));
const MAX_PASSWORDS = 20;

export function createPassword(userId: string, name: string) {
  const id = randomBytes(8).toString('hex');
  const secret = newSecret();
  db.db.prepare('INSERT INTO app_passwords (id, user_id, name, hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, name, hashOf(secret), now());
  return { id, name, password: shown(secret), createdAt: now() };
}
export function removePassword(userId: string, id: string) {
  const gone = db.db.prepare('DELETE FROM app_passwords WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  if (gone) imap.endFor((u, p) => u === userId && p === id);
  return gone;
}
/** Every app password of a person ends (password changed or reset, signed out everywhere, account deleted). */
export function endAll(userId: string) {
  db.db.prepare('DELETE FROM app_passwords WHERE user_id = ?').run(userId);
  imap.endFor((u) => u === userId);
}

/** The person can still sign in at all: there, not suspended or deleted, with a sign-in of their own. */
function personOk(userId: string) {
  const u = db.getDoc('users', userId) as { suspended?: unknown; deletedAt?: string } | undefined;
  return !!u && !u.suspended && !u.deletedAt && db.hasLogin(userId);
}
export const stillOk = (userId: string, passwordId: string) => personOk(userId) && !!db.db.prepare('SELECT 1 FROM app_passwords WHERE id = ? AND user_id = ?').get(passwordId, userId);

// Failed sign-ins in a sliding window, per address and per username: like the web sign-in (30 and 10 in 15 minutes).
// Only failures count, since mail apps sign in again many times a day.
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
const failed = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW);
const note = (key: string) => {
  failures.set(key, [...failed(key), Date.now()]);
  if (failures.size > 10_000) for (const [k, v] of failures) if (!v.some((t) => Date.now() - t < WINDOW)) failures.delete(k);
};

const NOT_APP_PASSWORD = 'Use an app password from sprint2go (Settings, Phone mail apps). Your sprint2go password does not work in mail apps.';
export async function login(username: string, password: string, ip: string): Promise<{ ok: true; userId: string; passwordId: string } | { ok: false; why: string }> {
  const user = lower(username);
  if (failed(`ip:${ip}`).length >= 30 || failed(`user:${user}`).length >= 10) return { ok: false, why: 'Too many attempts. Wait 15 minutes and try again.' };
  const fail = (why = NOT_APP_PASSWORD) => (note(`ip:${ip}`), note(`user:${user}`), { ok: false as const, why });
  const secret = normal(password);
  if (secret.length !== 16 || !user) return fail();
  const row = db.db.prepare('SELECT * FROM app_passwords WHERE hash = ?').get(hashOf(secret)) as Row | undefined;
  if (!row || !personOk(row.user_id)) return fail();
  // The username is the person's sign-in email or one of their mailboxes' addresses.
  const email = lower((db.getDoc('users', row.user_id) as { email?: string } | undefined)?.email);
  if (user !== email && !mailboxesFor(row.user_id, user).some((mb) => mb.addresses.has(user))) return fail('That username doesn’t go with this app password. Use your sprint2go email address.');
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000) db.db.prepare('UPDATE app_passwords SET last_used_at = ? WHERE id = ?').run(now(), row.id);
  return { ok: true, userId: row.user_id, passwordId: row.id };
}
const usedBy = (passwordId: string, what: 'imap' | 'smtp') => db.db.prepare('UPDATE app_passwords SET last_used_by = ? WHERE id = ? AND COALESCE(last_used_by, \'\') != ?').run(what, passwordId, what);

/* ---------- which mailboxes ---------- */

/** Companies where other mail apps are allowed (admins can switch them off). */
const allowed = (w: Ws) => w.mailApps !== false;

/**
 * The mailboxes a person may open in a mail app: those they're on in sprint2go (their own and shared inboxes), in
 * companies that allow mail apps. The one the username names comes first (INBOX…); the others are folder trees.
 */
export function mailboxesFor(userId: string, username = ''): store.Mailbox[] {
  const out: store.Mailbox[] = [];
  for (const w of deps.memberOf(userId)) {
    if (!allowed(w)) continue;
    for (const a of w.accounts ?? []) {
      if (!a.email || !(a.users ?? []).includes(userId)) continue;
      const aliases = (w.mailAliases ?? []).filter((al) => (al.to ?? []).includes(a.id)).map((al) => lower(al.address));
      out.push({ id: a.id, email: lower(a.email), name: a.name || w.name || 'Mail', kind: a.kind ?? 'personal', wsId: w.id, wsName: w.name ?? '', hosted: !a.provider || a.provider === 'sprint2go', addresses: new Set([lower(a.email), ...aliases]), tz: companyTz(w), primary: false });
    }
  }
  if (!out.length) return out;
  const u = lower(username);
  const email = lower((db.getDoc('users', userId) as { email?: string } | undefined)?.email);
  const top = out.find((m) => m.email === u) ?? out.find((m) => m.addresses.has(u)) ?? out.find((m) => m.email === email) ?? out.find((m) => m.kind === 'personal') ?? out[0];
  top.primary = true;
  return out;
}
/** Who someone may send as from a mail app: their mailboxes here and the aliases that deliver into them. */
export function sendersFor(userId: string): submission.Sender[] {
  const out: submission.Sender[] = [];
  for (const mb of mailboxesFor(userId)) for (const address of mb.addresses) if (!out.some((s) => s.address === address)) out.push({ address, mailbox: mb });
  return out;
}

const writer: store.Writer = {
  write(userId, upserts, deletes) {
    const a = upserts.length ? deps.write(userId, 'threads', upserts, []) : { status: 200, body: { saved: 0 } as { saved?: number; why?: string; error?: string } };
    const b = deletes.length ? deps.write(userId, 'threads', [], deletes) : { status: 200, body: {} as { saved?: number; why?: string; error?: string } };
    const ok = a.status === 200 && (a.body.saved ?? 0) >= upserts.length && b.status === 200 && deletes.every((id) => !db.getDoc('threads', id));
    return { ok, why: ok ? undefined : a.body.why ?? a.body.error ?? b.body.why ?? b.body.error ?? 'You can’t change that here.' };
  },
};

/** Why a mailbox can't send now (as /api/mail/send checks it), or null. */
async function blocked(mb: store.Mailbox): Promise<string | null> {
  const w = db.getDoc('workspaces', mb.wsId) as Ws | undefined;
  if (!w) return 'That company is gone.';
  const ro = deps.readOnlyWhy(w);
  if (ro) return ro;
  if (!allowed(w)) return `${w.name} switched other mail apps off.`;
  if (w.mailReady?.mailboxes?.[mb.id]?.send) return null;
  const r = await refreshReadiness(w.id).catch(() => null);
  const m = r?.mailboxes[mb.id];
  return m?.send ? null : `Sending isn’t set up for ${mb.email} yet. ${m?.sendWhy ?? m?.why ?? ''}`.trim();
}

/* ---------- starting ---------- */

let ctxCache: SecureContext | null = null;
const secureContext = () => {
  const t = currentTls();
  if (!t) throw new Error('No certificate');
  return (ctxCache ??= createSecureContext({ key: t.key, cert: t.cert }));
};
const bindHost = () => process.env.IMAP_BIND ?? (production ? '0.0.0.0' : process.env.HOST ?? '127.0.0.1');

async function tryStart() {
  if (started || starting || !enabledByEnv()) return;
  if (!trustedNow()) return deps.log(`Phone mail apps: waiting for a trusted certificate for ${MAIL_HOST} (${status().detail ?? 'none yet'})`);
  starting = true;
  try {
    await imap.start(
      {
        secureContext,
        keyCert: () => currentTls()!,
        login: async (u, p, ip) => {
          const r = await login(u, p, ip);
          if (r.ok) usedBy(r.passwordId, 'imap');
          return r;
        },
        mailboxes: (userId, username) => mailboxesFor(userId, username),
        stillOk,
        writer,
        log: deps.log,
      },
      { imap: PORTS.imap, imaps: PORTS.imaps },
      bindHost(),
    );
    await submission.start(
      {
        tls: () => currentTls()!,
        login: async (u, p, ip) => {
          const r = await login(u, p, ip);
          if (r.ok) usedBy(r.passwordId, 'smtp');
          return r;
        },
        stillOk,
        senders: sendersFor,
        writer,
        blocked,
        log: deps.log,
      },
      { submission: PORTS.submission, submissions: PORTS.submissions },
      bindHost(),
    );
    started = true;
    portError = null;
    deps.log(`Phone mail apps: IMAP on ${PORTS.imaps} (TLS) and ${PORTS.imap} (STARTTLS), sending on ${PORTS.submissions} (TLS) and ${PORTS.submission} (STARTTLS), for ${MAIL_HOST}`);
  } catch (e) {
    portError = e instanceof Error ? e.message : String(e);
    deps.log(`Phone mail apps: couldn't open the ports (${portError})`);
    await imap.stop().catch(() => {});
    await submission.stop().catch(() => {});
  } finally {
    starting = false;
  }
}

export async function start(d: MailAppsDeps) {
  deps = d;
  // Old sources and folder rows of deleted conversations and mailboxes go once an hour.
  setInterval(() => {
    try {
      raws.sweep();
      store.sweepBoxes(new Set((db.allDocs('workspaces') as unknown as Ws[]).flatMap((w) => (w.accounts ?? []).map((a) => a.id))));
    } catch (e) {
      d.log(`[mail apps] sweep: ${e instanceof Error ? e.message : e}`);
    }
  }, 3600_000).unref?.();
  if (!enabledByEnv()) return;
  if (!currentTls()) loadTls(MAIL_HOST);
  onCertChange((tls) => {
    ctxCache = null;
    imap.updateContext(tls);
    submission.updateContext(tls);
    void tryStart();
  });
  await tryStart();
}

/** A change anywhere in the app (index.ts broadcast): mail apps watching that mail hear about it. */
export function changed(coll: string, upserts: unknown[], deletes: string[]) {
  if (started) imap.changed(coll, upserts as { id: string }[], deletes);
}

/* ---------- setup help: Thunderbird and Apple ---------- */

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Thunderbird's autoconfig (the same for every address, so it tells nobody who has a mailbox here). */
export function autoconfig(email: string) {
  const domain = lower(email.split('@')[1] ?? '') || MAIL_HOST;
  const server = (type: string, p: number, socket: string) => `    <${type === 'smtp' ? 'outgoingServer' : 'incomingServer'} type="${type}">
      <hostname>${xml(MAIL_HOST)}</hostname>
      <port>${p}</port>
      <socketType>${socket}</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </${type === 'smtp' ? 'outgoingServer' : 'incomingServer'}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="${xml(MAIL_HOST)}">
    <domain>${xml(domain)}</domain>
    <displayName>sprint2go</displayName>
    <displayShortName>sprint2go</displayShortName>
${server('imap', PORTS.imaps, 'SSL')}
${server('imap', PORTS.imap, 'STARTTLS')}
${server('smtp', PORTS.submissions, 'SSL')}
${server('smtp', PORTS.submission, 'STARTTLS')}
  </emailProvider>
</clientConfig>
`;
}

/** A UUID that stays the same for the same person and mailbox, so installing the profile again replaces it. */
const stableUuid = (seed: string) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
};
/** An Apple configuration profile for one mailbox: Mail asks for the app password while it installs. */
export function mobileconfig(userId: string, mb: { email: string; name: string }, username: string, displayName: string) {
  const id = `com.sprint2go.mail.${createHash('sha256').update(`${userId} ${mb.email}`).digest('hex').slice(0, 12)}`;
  const s = (k: string, v: string) => `      <key>${k}</key>\n      <string>${xml(v)}</string>`;
  const n = (k: string, v: number) => `      <key>${k}</key>\n      <integer>${v}</integer>`;
  const b = (k: string, v: boolean) => `      <key>${k}</key>\n      <${v}/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
${s('EmailAccountDescription', `sprint2go ${mb.email}`)}
${s('EmailAccountName', displayName)}
${s('EmailAccountType', 'EmailTypeIMAP')}
${s('EmailAddress', mb.email)}
${s('IncomingMailServerAuthentication', 'EmailAuthPassword')}
${s('IncomingMailServerHostName', MAIL_HOST)}
${n('IncomingMailServerPortNumber', PORTS.imaps)}
${b('IncomingMailServerUseSSL', true)}
${s('IncomingMailServerUsername', username)}
${s('OutgoingMailServerAuthentication', 'EmailAuthPassword')}
${s('OutgoingMailServerHostName', MAIL_HOST)}
${n('OutgoingMailServerPortNumber', PORTS.submissions)}
${b('OutgoingMailServerUseSSL', true)}
${s('OutgoingMailServerUsername', username)}
${b('OutgoingPasswordSameAsIncomingPassword', true)}
${s('PayloadDescription', 'Adds your sprint2go mail to Mail. Enter an app password from sprint2go Settings, Phone mail apps.')}
${s('PayloadDisplayName', `sprint2go mail (${mb.email})`)}
${s('PayloadIdentifier', `${id}.account`)}
${s('PayloadType', 'com.apple.mail.managed')}
${s('PayloadUUID', stableUuid(`${id}.account`))}
${n('PayloadVersion', 1)}
${b('PreventAppSheet', false)}
${b('PreventMove', false)}
${b('SMIMEEnabled', false)}
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>${xml(`Adds ${mb.email} to Mail on this iPhone, iPad or Mac.`)}</string>
  <key>PayloadDisplayName</key>
  <string>${xml(`sprint2go mail (${mb.email})`)}</string>
  <key>PayloadIdentifier</key>
  <string>${xml(id)}</string>
  <key>PayloadOrganization</key>
  <string>sprint2go</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${stableUuid(id)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

/* ---------- the HTTP side ---------- */

type Json = (res: ServerResponse, status: number, data: unknown) => void;

/** Public: Thunderbird's autoconfig. Only while mail apps really work here. */
export function handlePublic(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const p = url.pathname;
  if (p !== '/.well-known/autoconfig/mail/config-v1.1.xml' && p !== '/mail/config-v1.1.xml') return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!status().on) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Mail apps aren’t available on this server.');
    return true;
  }
  res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
  res.end(req.method === 'HEAD' ? undefined : autoconfig(url.searchParams.get('emailaddress') ?? ''));
  return true;
}

/**
 * Signed in: Settings, Phone mail apps.
 *  GET  /api/mailapps                         what works, the mailboxes, the app passwords
 *  POST /api/mailapps/passwords               { name, password } a new app password (shown once)
 *  POST /api/mailapps/passwords/remove        { id }
 *  GET  /api/mailapps/profile?mailbox=…       the Apple configuration profile
 */
export async function handleApi(
  p: string,
  c: { req: IncomingMessage; res: ServerResponse; url: URL; me: string; operator: string | null; json: Json; body: (req: IncomingMessage) => Promise<any>; tooMany: (key: string, max: number, windowMs: number) => boolean },
): Promise<boolean> {
  const { req, res, url, me, json } = c;
  if (!p.startsWith('/api/mailapps')) return false;
  const person = db.getDoc('users', me) as { email?: string; name?: string } | undefined;
  const username = lower(person?.email);
  if (p === '/api/mailapps' && req.method === 'GET') {
    const st = status();
    const boxes = mailboxesFor(me, username);
    const off = deps.memberOf(me).filter((w) => !allowed(w) && (w.accounts ?? []).some((a) => (a.users ?? []).includes(me))).map((w) => ({ id: w.id, name: w.name ?? 'Company' }));
    return (
      json(res, 200, {
        on: st.on,
        missing: st.missing,
        detail: st.detail,
        host: MAIL_HOST,
        ports: { imap: PORTS.imaps, imapStarttls: PORTS.imap, smtp: PORTS.submissions, smtpStarttls: PORTS.submission },
        username,
        mailboxes: boxes.map((m) => ({ email: m.email, name: m.name, shared: m.kind === 'shared', company: m.wsName, top: m.primary, sends: m.hosted })),
        passwords: passwordsOf(me),
        off,
      }),
      true
    );
  }
  if (p === '/api/mailapps/passwords' && req.method === 'POST') {
    if (c.operator) return (json(res, 403, { error: 'That’s theirs to do: you’re signed in as them.' }), true);
    if (c.tooMany(`mailapps:${me}`, 10, 15 * 60_000)) return (json(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' }), true);
    const b = await c.body(req);
    const name = String(b?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) return (json(res, 400, { error: 'Give it a name, like “iPhone” or “Work laptop”.' }), true);
    // Your sprint2go password first: someone at an unlocked computer can't quietly add a way into your mail.
    const login = db.findLogin(username);
    const good = login && typeof b?.password === 'string' ? await db.checkPassword(b.password, login.pw_hash) : (await db.burnPasswordTime(String(b?.password ?? '')), false);
    if (!good) return (json(res, 401, { error: 'That isn’t your sprint2go password.' }), true);
    if (passwordsOf(me).length >= MAX_PASSWORDS) return (json(res, 409, { error: `You have ${MAX_PASSWORDS} app passwords. Remove one you don’t use first.` }), true);
    return (json(res, 200, createPassword(me, name)), true);
  }
  if (p === '/api/mailapps/passwords/remove' && req.method === 'POST') {
    if (c.operator) return (json(res, 403, { error: 'That’s theirs to do: you’re signed in as them.' }), true);
    const b = await c.body(req);
    return (removePassword(me, String(b?.id ?? '')) ? json(res, 200, {}) : json(res, 404, { error: 'That app password is already gone.' }), true);
  }
  if (p === '/api/mailapps/profile' && req.method === 'GET') {
    const boxes = mailboxesFor(me, username);
    const want = lower(url.searchParams.get('mailbox'));
    const mb = boxes.find((m) => m.email === want) ?? boxes.find((m) => m.primary);
    if (!mb) return (json(res, 404, { error: 'There’s no mailbox here you can open in a mail app.' }), true);
    // The mailbox's address is the username, so it opens at the top of that account (the others show as folders).
    const body = mobileconfig(me, mb, mb.email, mb.kind === 'shared' ? mb.name : String(person?.name ?? mb.name));
    res.writeHead(200, { 'content-type': 'application/x-apple-aspen-config', 'content-disposition': `attachment; filename="sprint2go-mail-${mb.email.replace(/[^a-z0-9.@_-]/g, '')}.mobileconfig"`, 'cache-control': 'no-store' });
    res.end(body);
    return true;
  }
  return (json(res, 404, { error: 'Not found' }), true);
}
