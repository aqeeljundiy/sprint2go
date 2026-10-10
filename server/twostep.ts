// Two-step sign-in for everyone: after the password, a 6-digit code from an authenticator app (or a backup code).
// Each person turns it on for their own account (Settings, Account); a company can require it for its people, with a
// few days to set it up. Secrets are sealed with the server key; backup codes are shown once and kept only as hashes.
// Sessions are marked when they passed the second step. A session that hasn't (a password sign-in waiting for its
// code, or someone who must set it up first) can only finish that and sign out; everything else answers 401/403.
// The TOTP itself is shared with the operators' console (db.ts: newTotpSecret, totpStep; the QR here: totpSetup).
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import * as db from './db.ts';
import { mark, msg, t } from '../src/i18n/index.ts';
import { datePhrase, forUser, requestLang, sayIn, type Lang, type Said } from './lang.ts';
import { companyTz } from '../src/jobTimes.ts';
import { companyBrand, renderEmail } from './emailLayout.ts';

db.db.exec(`CREATE TABLE IF NOT EXISTS two_step (user_id TEXT PRIMARY KEY, secret TEXT, pending TEXT, on_at TEXT, last_step INTEGER NOT NULL DEFAULT 0, backup TEXT NOT NULL DEFAULT '[]')`);
db.db.exec('CREATE TABLE IF NOT EXISTS trusted_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT NOT NULL, expires_at TEXT NOT NULL)');
db.db.exec('CREATE INDEX IF NOT EXISTS trusted_devices_user ON trusted_devices (user_id)');
try {
  db.db.exec('ALTER TABLE sessions ADD COLUMN two_step TEXT');
} catch {
  /* already there */
}

const DAY = 86_400_000;
const now = () => new Date().toISOString();
const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
export const GRACE_DAYS = [0, 3, 7, 14] as const;
export const DEFAULT_GRACE = 7;

/** The QR code and key an authenticator app reads (operators' console and everyone's own setup). */
export async function totpSetup(issuer: string, account: string, secret: string) {
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6`;
  return { secret, otpauth, qr: await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }) };
}

/* ---------- one person's second step ---------- */

type Row = { user_id: string; secret: string | null; pending: string | null; on_at: string | null; last_step: number; backup: string };
const row = (userId: string) => db.db.prepare('SELECT * FROM two_step WHERE user_id = ?').get(userId) as Row | undefined;
export const isOn = (userId: string) => !!row(userId)?.on_at;
export function status(userId: string) {
  const r = row(userId);
  return { on: !!r?.on_at, since: r?.on_at ?? null, backupLeft: r?.on_at ? (JSON.parse(r.backup) as string[]).length : 0 };
}
/** Who among these people has it on. */
export function onAmong(userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = db.db.prepare(`SELECT user_id FROM two_step WHERE on_at IS NOT NULL AND user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds) as { user_id: string }[];
  return new Set(rows.map((r) => r.user_id));
}

// Backup codes: ten of them, 10 characters each from letters and digits that can't be mixed up, shown as xxxxx-xxxxx.
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const backupHash = (c: string) => createHash('sha256').update('s2g-backup:' + c.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
function makeBackups() {
  const codes = Array.from({ length: 10 }, () => {
    let s = '';
    for (let i = 0; i < 10; i++) s += ALPHA[randomInt(ALPHA.length)];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codes, hashes: codes.map(backupHash) };
}

/** A new secret waiting to be confirmed with a code (the current one, if any, keeps working until then). */
export function startSetup(userId: string) {
  const secret = db.newTotpSecret();
  db.db.prepare('INSERT INTO two_step (user_id, pending) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET pending = excluded.pending').run(userId, db.seal(secret));
  return secret;
}
/** Confirms the waiting secret with a code from the app: it's on, with fresh backup codes (returned once). */
export function enable(userId: string, code: string): string[] | null {
  const r = row(userId);
  if (!r?.pending) return null;
  const secret = db.unseal(r.pending);
  const step = db.totpStep(secret, code);
  if (step === null) return null;
  const { codes, hashes } = makeBackups();
  db.db.prepare('UPDATE two_step SET secret = ?, pending = NULL, on_at = ?, last_step = ?, backup = ? WHERE user_id = ?').run(db.seal(secret), now(), step, JSON.stringify(hashes), userId);
  return codes;
}
/** A code from the app (each works once) or a backup code (used up). Null when neither matches. */
export function check(userId: string, code: string): 'app' | 'backup' | null {
  const r = row(userId);
  if (!r?.on_at || !r.secret) return null;
  const raw = String(code ?? '').trim();
  if (/^[\d\s]+$/.test(raw)) {
    const step = db.totpStep(db.unseal(r.secret), raw, r.last_step);
    if (step === null) return null;
    db.db.prepare('UPDATE two_step SET last_step = ? WHERE user_id = ?').run(step, userId);
    return 'app';
  }
  const h = Buffer.from(backupHash(raw));
  const list = JSON.parse(r.backup) as string[];
  const i = list.findIndex((x) => x.length === h.length && timingSafeEqual(Buffer.from(x), h));
  if (i < 0) return null;
  list.splice(i, 1);
  db.db.prepare('UPDATE two_step SET backup = ? WHERE user_id = ?').run(JSON.stringify(list), userId);
  return 'backup';
}
/** New backup codes; the old ones stop working. */
export function newBackups(userId: string) {
  const { codes, hashes } = makeBackups();
  db.db.prepare('UPDATE two_step SET backup = ? WHERE user_id = ? AND on_at IS NOT NULL').run(JSON.stringify(hashes), userId);
  return codes;
}
/** Off (turned off by the person, reset by an admin or an operator, or the account deleted): remembered devices go too. */
export const forget = (userId: string) => {
  db.db.prepare('DELETE FROM two_step WHERE user_id = ?').run(userId);
  forgetDevices(userId);
};

/* ---------- "Remember this device": 30 days without the code, on one browser ---------- */

export const DEVICE_DAYS = 30;
/** The cookie that holds a browser's device tokens (one per person who asked it to remember them, at most 5). */
export const DEVICE_COOKIE = 's2g_dev';
type DeviceRow = { id: string; user_id: string; name: string; created_at: string; used_at: string; expires_at: string };
/** The token's signature: only this server can make it, and it's bound to the person, the device and its end. */
const deviceSig = (id: string, userId: string, exp: string) => db.keyedHash(`trusted-device:${id}:${userId}:${exp}`).slice(0, 40);
/** "Chrome on Mac", "Safari on iPhone": enough to tell devices apart in the list, from the browser's own words. */
export function deviceName(ua: string | undefined) {
  const u = String(ua ?? '');
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /CrOS/.test(u) ? 'Chromebook' : /Linux/.test(u) ? 'Linux' : '';
  const app = /sprint2go/i.test(u) && /Electron/.test(u) ? 'sprint2go app' : /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\/|FxiOS/.test(u) ? 'Firefox' : /Chrome\/|CriOS/.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  return app && os ? `${app} on ${os}` : app || os || 'A browser';
}
/** Remembers this browser for this person: a new device row, and the signed token for its cookie. */
export function rememberDevice(userId: string, ua: string | undefined) {
  const id = randomBytes(9).toString('hex');
  const expires = new Date(Date.now() + DEVICE_DAYS * DAY).toISOString();
  const exp = String(Math.floor(Date.parse(expires) / 1000));
  db.db.prepare('INSERT INTO trusted_devices (id, user_id, name, created_at, used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, userId, deviceName(ua).slice(0, 60), now(), now(), expires);
  return { id, token: `${id}.${exp}.${deviceSig(id, userId, exp)}`, expires };
}
/** The tokens in a browser's device cookie. */
export const deviceTokens = (cookieValue: string | undefined) => String(cookieValue ?? '').split('~').filter((t) => /^[a-f0-9]{18}\.\d{9,11}\.[a-f0-9]{40}$/.test(t)).slice(0, 5);
/** The device this browser's cookie proves for this person (signed, not expired, not forgotten), or null. */
export function trustedDevice(cookieValue: string | undefined, userId: string): DeviceRow | null {
  for (const t of deviceTokens(cookieValue)) {
    const [id, exp, sig] = t.split('.');
    const want = Buffer.from(deviceSig(id, userId, exp));
    if (!timingSafeEqual(want, Buffer.from(sig))) continue; // another person's token on the same browser, or forged
    if (Number(exp) * 1000 < Date.now()) continue;
    const row = db.db.prepare('SELECT * FROM trusted_devices WHERE id = ? AND user_id = ?').get(id, userId) as DeviceRow | undefined;
    if (!row || row.expires_at < now()) continue;
    return row;
  }
  return null;
}
/** A remembered device signed in without the code: noted for the list. */
export const deviceUsed = (id: string) => db.db.prepare('UPDATE trusted_devices SET used_at = ? WHERE id = ?').run(now(), id);
/** This person's remembered devices, newest first (`current`: the ones this browser's cookie holds). */
export function devices(userId: string, cookieValue?: string) {
  db.db.prepare('DELETE FROM trusted_devices WHERE expires_at < ?').run(now());
  const mine = new Set(deviceTokens(cookieValue).map((t) => t.split('.')[0]));
  return (db.db.prepare('SELECT * FROM trusted_devices WHERE user_id = ? ORDER BY created_at DESC').all(userId) as DeviceRow[]).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, usedAt: r.used_at, expiresAt: r.expires_at, current: mine.has(r.id) }));
}
/** Forget one remembered device (its next sign-in asks for the code again). */
export const forgetDevice = (userId: string, id: string) => db.db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
/** Forget them all: a password change or reset, "Sign out everywhere", or two-step sign-in turned off, reset or moved. */
export const forgetDevices = (userId: string) => db.db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId).changes;
/** The device cookie with this token added (another person's on the same browser stay), at most 5 kept. */
export const withDeviceToken = (cookieValue: string | undefined, token: string) => [token, ...deviceTokens(cookieValue)].slice(0, 5).join('~');

// Wrong codes: at most 5 in a row for one sign-in, and 10 an hour for one person, so codes can't be guessed.
const misses = new Map<string, number[]>();
function missed(userId: string) {
  const t = Date.now();
  const list = (misses.get(userId) ?? []).filter((x) => t - x < 3600_000);
  list.push(t);
  misses.set(userId, list);
}
const lockedOut = (userId: string) => (misses.get(userId) ?? []).filter((x) => Date.now() - x < 3600_000).length >= 10;
const sessionMisses = new Map<string, number>();

/* ---------- sessions ---------- */

export function sessionPassed(token: string | undefined) {
  if (!token) return false;
  const r = db.db.prepare('SELECT two_step FROM sessions WHERE token = ?').get(tokenHash(token)) as { two_step: string | null } | undefined;
  return !!r?.two_step;
}
/** Passed the second step: the session lasts the usual 30 days from now. */
export const markPassed = (token: string) => db.db.prepare('UPDATE sessions SET two_step = ?, expires_at = ? WHERE token = ?').run(now(), new Date(Date.now() + 30 * DAY).toISOString(), tokenHash(token));
/** A password sign-in waiting for its code: it lapses after 15 minutes. */
export const markWaiting = (token: string) => db.db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(new Date(Date.now() + 15 * 60_000).toISOString(), tokenHash(token));
/** Everyone else signed in as this person is signed out; this session stays. */
export const endOtherSessions = (userId: string, token: string) => db.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, tokenHash(token));

/* ---------- what a company requires ---------- */

export type Security = { twoStep?: boolean; graceDays?: number; twoStepSince?: string; google?: boolean; microsoft?: boolean; sso?: boolean };
type Ws = { id: string; name?: string; members: { userId: string; role: string }[]; security?: Security };
/** When a company's requirement starts to bite: switched on, plus the days it gave people to set it up. */
export const deadline = (s: Security) => new Date(Date.parse(s.twoStepSince ?? now()) + (s.graceDays ?? DEFAULT_GRACE) * DAY).toISOString();
/** The companies that require it of this person, and the earliest date it applies. Null when none does. */
export function requirement(userId: string, wss: Ws[]) {
  const req = wss.filter((w) => w.security?.twoStep && w.members.some((m) => m.userId === userId));
  if (!req.length) return null;
  const from = req.map((w) => deadline(w.security!)).sort()[0];
  return { from, companies: req.map((w) => w.name ?? 'Your company') };
}

/**
 * What this session still has to do before the app opens: enter a code ('code'), or set two-step sign-in up because a
 * company requires it and the days to do it are over ('setup'). Null: nothing. An operator looking at the app as
 * someone already passed their own second step.
 */
export type Gate = { need: 'code' } | { need: 'setup'; companies: string[] } | null;
export function gate(userId: string, token: string | undefined, operator: string | null, wss: Ws[]): Gate {
  if (operator) return null;
  if (isOn(userId)) return sessionPassed(token) ? null : { need: 'code' };
  const r = requirement(userId, wss);
  return r && r.from <= now() ? { need: 'setup', companies: r.companies } : null;
}
/** What a session waiting on its second step may still call. */
export function allowedWhileGated(g: NonNullable<Gate>, p: string, method: string) {
  if (p === '/api/me' || (p === '/api/2fa' && method === 'GET')) return true;
  if (method !== 'POST') return false;
  return g.need === 'code' ? p === '/api/2fa/verify' : p === '/api/2fa/setup' || p === '/api/2fa/enable';
}

/**
 * Saving a company: only owners change its sign-in rules, and only an owner who has two-step sign-in on can require it
 * (so nobody locks themselves out by switching it on). The date the requirement was switched on is the server's (it
 * starts the days people have to set it up). Returns the security to store and what changed, for the log.
 */
export function securityOnSave(before: Security | undefined, next: Security | undefined, owner: boolean, ownerHasIt: boolean): { security: Security | undefined; changed: string | null } {
  if (!owner) return { security: before, changed: null };
  if (!next) return { security: before, changed: null };
  const was = !!before?.twoStep;
  const on = !!next.twoStep && (was || ownerHasIt);
  const graceDays = (GRACE_DAYS as readonly number[]).includes(Number(next.graceDays)) ? Number(next.graceDays) : DEFAULT_GRACE;
  const security: Security = { ...next, twoStep: on, graceDays, twoStepSince: on ? (was ? before?.twoStepSince ?? now() : now()) : undefined };
  const changed = on && !was ? `required two-step sign-in (${graceDays ? `${graceDays} days to set it up` : 'right away'})` : !on && was ? 'stopped requiring two-step sign-in' : on && (before?.graceDays ?? DEFAULT_GRACE) !== graceDays ? `gave people ${graceDays ? `${graceDays} days` : 'no time'} to set up two-step sign-in` : null;
  return { security, changed };
}

/* ---------- the routes ---------- */

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  me: string;
  token: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: (req: IncomingMessage) => Promise<any>;
  workspaces: () => Ws[];
  issuer: string; // the name in the authenticator app (ours, or an agency's on its own address)
  /** This browser's device cookie (remembered devices), and a way to set it (null: clear it). */
  deviceCookie: string | undefined;
  setDeviceCookie: (value: string | null) => void;
  /** Signs this person out everywhere (or everywhere but this session) and closes their live connections. */
  kick: (userId: string, keepToken?: string) => void;
  operator: string | null; // an operator signed in as this person
  /** A security event in a company's log. */
  event: (type: string, workspaceId: string, userId: string | null, detail?: string) => void;
  eventsOf: (workspaceId: string) => { at: string; type: string; userId: string | null; detail: string | null }[];
  notify: (userIds: string[], text: Said, url?: string, workspaceId?: string) => void; // msg(): each reader's language
  mail: (to: string, subject: string, body: { html: string; text: string }) => Promise<unknown>; // body: server/emailLayout.ts
}

/** Handles /api/2fa* (everyone, their own account) and /api/security* (company admins). True when it answered. */
export async function handle(p: string, ctx: Ctx): Promise<boolean> {
  const { req, res, me, json } = ctx;
  const POST = req.method === 'POST';
  const send = (status: number, data: unknown) => (json(res, status, data), true);
  const user = db.getDoc('users', me) as { email?: string; name?: string } | undefined;
  const email = String(user?.email ?? '').toLowerCase();
  const mine = () => ctx.workspaces().filter((w) => w.members.some((m) => m.userId === me));
  const logAll = (type: string, detail?: string) => mine().forEach((w) => ctx.event(type, w.id, me, detail));
  /** A code from the app or a backup code, counting wrong ones. */
  const proof = (code: unknown): { error: string; status: number } | { error?: undefined; used: 'app' | 'backup' } => {
    if (lockedOut(me)) return { error: mark('Too many wrong codes. Wait an hour and try again.'), status: 429 };
    const used = check(me, String(code ?? ''));
    if (!used) {
      missed(me);
      return { error: mark('That code isn’t right, or it was already used. Wait for the next one in your app.'), status: 400 };
    }
    return { used };
  };

  if (ctx.operator && p.startsWith('/api/2fa/') && POST) return send(403, { error: mark('Two-step sign-in is theirs to change: you’re signed in as them.') });
  if (p === '/api/2fa' && req.method === 'GET') {
    const r = requirement(me, ctx.workspaces());
    return send(200, { ...status(me), required: r, devices: isOn(me) ? devices(me, ctx.deviceCookie) : [] });
  }
  // Remembered devices: forget one, or all of them.
  if (p === '/api/2fa/devices/forget' && POST) {
    const b = await ctx.body(req);
    if (b.all === true) {
      const n = forgetDevices(me);
      if (n) logAll('security.2fa-devices', `forgot ${n} remembered device${n === 1 ? '' : 's'}`);
      return send(200, { ok: true, forgotten: n });
    }
    const id = String(b.id ?? '');
    const name = devices(me).find((d) => d.id === id)?.name;
    if (!forgetDevice(me, id)) return send(404, { error: mark('That device was already forgotten.') });
    logAll('security.2fa-devices', `forgot a remembered device (${name ?? 'a browser'})`);
    return send(200, { ok: true });
  }
  // Sign out everywhere: every other session ends and every remembered device is forgotten; this one stays signed in.
  if (p === '/api/2fa/signout-everywhere' && POST) {
    ctx.kick(me, ctx.token);
    const n = forgetDevices(me);
    ctx.setDeviceCookie(null);
    logAll('security.signout-everywhere', `signed out everywhere else${n ? ` and forgot ${n} remembered device${n === 1 ? '' : 's'}` : ''}`);
    return send(200, { ok: true });
  }
  if (p === '/api/2fa/setup' && POST) {
    // Already on: setting it up again (a new phone) needs a code from the current one, or a backup code.
    if (isOn(me)) {
      const b = await ctx.body(req);
      const ok = proof(b.code);
      if (ok.error !== undefined) return send(ok.status, { error: ok.error });
    }
    return send(200, await totpSetup(ctx.issuer, email || me, startSetup(me)));
  }
  if (p === '/api/2fa/enable' && POST) {
    const b = await ctx.body(req);
    const again = isOn(me);
    const codes = enable(me, String(b.code ?? ''));
    if (!codes) return send(400, { error: mark('That code isn’t right. Check that the time on your phone is set automatically, then try the next code.') });
    markPassed(ctx.token);
    // Anyone else signed in as this person (with only the password) is signed out; a new phone also means devices
    // remembered with the old one ask for a code again.
    ctx.kick(me, ctx.token);
    if (again) forgetDevices(me);
    logAll(again ? 'security.2fa-moved' : 'security.2fa-on', again ? 'moved two-step sign-in to a new app' : 'turned on two-step sign-in');
    return send(200, { backupCodes: codes });
  }
  if (p === '/api/2fa/verify' && POST) {
    if (!isOn(me)) return send(400, { error: mark('Two-step sign-in isn’t on for this account.') });
    if (sessionPassed(ctx.token)) return send(200, { ok: true });
    const b = await ctx.body(req);
    const ok = proof(b.code);
    if (ok.error !== undefined) {
      // Five wrong codes on one sign-in: start again with the password.
      const n = (sessionMisses.get(ctx.token) ?? 0) + 1;
      sessionMisses.set(ctx.token, n);
      if (n >= 5) {
        sessionMisses.delete(ctx.token);
        db.endSession(ctx.token);
        return send(401, { error: mark('Too many wrong codes. Sign in again.'), restart: true });
      }
      return send(ok.status, { error: ok.error });
    }
    sessionMisses.delete(ctx.token);
    markPassed(ctx.token);
    if (ok.used === 'backup') logAll('security.2fa-backup', `signed in with a backup code (${status(me).backupLeft} left)`);
    // "Remember this device for 30 days": the next sign-ins here need only the password, until it's forgotten.
    let remembered: string | undefined;
    if (b.remember === true && !ctx.operator) {
      const d = rememberDevice(me, req.headers['user-agent']);
      ctx.setDeviceCookie(withDeviceToken(ctx.deviceCookie, d.token));
      remembered = d.expires;
      logAll('security.2fa-device', `asked ${deviceName(req.headers['user-agent'])} to remember them for ${DEVICE_DAYS} days`);
    }
    return send(200, { ok: true, used: ok.used, backupLeft: status(me).backupLeft, ...(remembered ? { rememberedUntil: remembered } : {}) });
  }
  if (p === '/api/2fa/backup' && POST) {
    const b = await ctx.body(req);
    const ok = proof(b.code);
    if (ok.error !== undefined) return send(ok.status, { error: ok.error });
    return send(200, { backupCodes: newBackups(me) });
  }
  if (p === '/api/2fa/off' && POST) {
    const r = requirement(me, ctx.workspaces());
    if (r) return send(409, { error: `${r.companies.join(' and ')} require${r.companies.length === 1 ? 's' : ''} two-step sign-in, so it stays on. To use another phone, set it up again.` });
    const b = await ctx.body(req);
    const login = email ? db.findLogin(email) : undefined;
    if (!login || !(await db.checkPassword(String(b.password ?? ''), login.pw_hash))) return send(400, { error: mark('Your password is wrong.') });
    const ok = proof(b.code);
    if (ok.error !== undefined) return send(ok.status, { error: ok.error });
    forget(me);
    logAll('security.2fa-off', 'turned off two-step sign-in');
    return send(200, { ok: true });
  }

  /* ----- company admins: who has it, reminders, resets, the log ----- */
  if (p.startsWith('/api/security')) {
    const b = POST ? await ctx.body(req) : {};
    const wsId = String(POST ? b.workspaceId ?? '' : ctx.url.searchParams.get('workspaceId') ?? '');
    const ws = ctx.workspaces().find((w) => w.id === wsId);
    const role = ws?.members.find((m) => m.userId === me)?.role;
    if (!ws || !role || role === 'member') return send(403, { error: mark('Only owners and admins can see this.') });
    const people = ws.members.map((m) => m.userId);
    if (p === '/api/security' && req.method === 'GET') {
      const on = onAmong(people);
      const sec = ws.security ?? {};
      return send(200, {
        people: ws.members.map((m) => ({ userId: m.userId, role: m.role, on: on.has(m.userId) })),
        required: sec.twoStep ? { since: sec.twoStepSince ?? null, from: deadline(sec), graceDays: sec.graceDays ?? DEFAULT_GRACE } : null,
        // Saved in English; the ones with names or numbers in them go back in the asker's language (the fixed ones the
        // app translates itself).
        log: ctx.eventsOf(ws.id).filter((e) => e.type.startsWith('security.')).slice(0, 30).map((e) => ({ ...e, detail: logLine(e.detail, requestLang(req)) })),
      });
    }
    if (p === '/api/security/remind' && POST) {
      const on = onAmong(people);
      const missing = people.filter((id) => !on.has(id) && id !== me);
      if (!missing.length) return send(200, { sent: 0 });
      const sec = ws.security ?? {};
      const when = sec.twoStep ? new Date(deadline(sec)) : null;
      const text = when && when.getTime() > Date.now() ? msg('{company} asks you to turn on two-step sign-in by {date}. It takes a minute in Settings, Account.', { company: String(ws.name ?? ''), date: datePhrase(when, { tz: companyTz(ws as any) }) }) : msg('{company} asks you to turn on two-step sign-in. It takes a minute in Settings, Account.', { company: String(ws.name ?? '') });
      ctx.notify(missing, text, '/settings/account', ws.id);
      ctx.event('security.2fa-remind', ws.id, me, `reminded ${missing.length} ${missing.length === 1 ? 'person' : 'people'} to turn on two-step sign-in`);
      return send(200, { sent: missing.length });
    }
    if (p === '/api/security/reset' && POST) {
      const target = String(b.userId ?? '');
      const theirs = ws.members.find((m) => m.userId === target);
      if (!theirs) return send(404, { error: mark('They aren’t in this company.') });
      if (target === me) return send(400, { error: mark('Use one of your backup codes, or ask another owner.') });
      if (theirs.role === 'owner' && role !== 'owner') return send(403, { error: mark('Only an owner can reset an owner’s two-step sign-in.') });
      if (!isOn(target)) return send(409, { error: mark('Two-step sign-in isn’t on for them.') });
      const them = db.getDoc('users', target) as { email?: string; name?: string } | undefined;
      forget(target);
      ctx.kick(target);
      db.audit(email || me, 'person.2fa-reset', target, `by ${role} of ${ws.name}`);
      ctx.event('security.2fa-reset', ws.id, me, `reset two-step sign-in for ${them?.name ?? 'someone'}`);
      if (them?.email)
        void (() => {
          const m = resetMail(target, ws, user?.name);
          return ctx.mail(them.email!, m.subject, m);
        })().catch(() => {});
      return send(200, { ok: true });
    }
    return send(404, { error: mark('No such route.') });
  }
  return false;
}

/**
 * The password-reset step for someone with two-step sign-in: the email code alone isn't enough. Returns null when
 * they may go on, or the answer to give.
 */
export function resetNeedsCode(userId: string, code: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!isOn(userId)) return null;
  if (code === undefined || code === null || String(code).trim() === '') return { status: 401, body: { error: mark('Enter the code from your authenticator app, or a backup code.'), twoStep: 'code' } };
  if (lockedOut(userId)) return { status: 429, body: { error: mark('Too many wrong codes. Wait an hour and try again.'), twoStep: 'code' } };
  if (!check(userId, String(code))) {
    missed(userId);
    return { status: 400, body: { error: mark('That code isn’t right, or it was already used. Wait for the next one in your app.'), twoStep: 'code' } };
  }
  return null;
}

/** Existing companies that already had the switch on before it did anything: their days to set it up start now. */
export function startClocks() {
  const started: string[] = [];
  for (const w of db.allDocs('workspaces') as any[]) {
    if (!w.security?.twoStep || w.security.twoStepSince) continue;
    db.writeDocs('workspaces', [{ ...w, security: { ...w.security, graceDays: w.security.graceDays ?? DEFAULT_GRACE, twoStepSince: now() } }], [], null);
    started.push(w.id);
  }
  return started;
}

/** The email to someone whose two-step sign-in an admin reset: in their language (theirs, else the company's). */
export function resetMail(userId: string, ws: { id: string; name?: string; security?: { twoStep?: boolean } }, by: string | undefined) {
  return forUser(userId, ws.id, () => {
    const subject = t('Your two-step sign-in was reset');
    const first = by ? t('{name} at {company} reset two-step sign-in on your account, so it no longer asks for a code from your authenticator app.', { name: by, company: ws.name ?? '' }) : t('An admin at {company} reset two-step sign-in on your account, so it no longer asks for a code from your authenticator app.', { company: ws.name ?? '' });
    const next = ws.security?.twoStep ? t('{company} requires it, so you’ll set it up again the next time you sign in.', { company: ws.name ?? '' }) : t('You can turn it on again in Settings, Account.');
    // The shared layout (server/emailLayout.ts) in the company's colours; the warning in a notice box.
    const body = renderEmail({ brand: companyBrand(ws), preheader: first, title: subject, blocks: [{ p: first }, { p: next }, { notice: t('If you didn’t ask for this, tell your admin straight away.') }], footer: [t('You get this because your sign-in settings changed.')] });
    return { subject, ...body };
  });
}

/** Security log lines with names or numbers in them, as the server writes them in English, and their words. */
const LOG_LINES: [RegExp, (m: RegExpMatchArray) => Said][] = [
  [/^required two-step sign-in \((\d+) days to set it up\)$/, (m) => msg('required two-step sign-in ({n} days to set it up)', { n: m[1] })],
  [/^required two-step sign-in \(right away\)$/, () => msg('required two-step sign-in (right away)')],
  [/^gave people (\d+) days to set up two-step sign-in$/, (m) => msg('gave people {n} days to set up two-step sign-in', { n: m[1] })],
  [/^gave people no time to set up two-step sign-in$/, () => msg('gave people no time to set up two-step sign-in')],
  [/^forgot 1 remembered device$/, () => msg('forgot 1 remembered device')],
  [/^forgot (\d+) remembered devices$/, (m) => msg('forgot {n} remembered devices', { n: m[1] })],
  [/^forgot a remembered device \((.+)\)$/, (m) => msg('forgot a remembered device ({device})', { device: m[1] })],
  [/^signed out everywhere else$/, () => msg('signed out everywhere else')],
  [/^signed out everywhere else and forgot 1 remembered device$/, () => msg('signed out everywhere else and forgot 1 remembered device')],
  [/^signed out everywhere else and forgot (\d+) remembered devices$/, (m) => msg('signed out everywhere else and forgot {n} remembered devices', { n: m[1] })],
  [/^signed in with a backup code \((\d+) left\)$/, (m) => msg('signed in with a backup code ({n} left)', { n: m[1] })],
  [/^asked (.+) to remember them for (\d+) days$/, (m) => msg('asked {device} to remember them for {n} days', { device: m[1], n: m[2] })],
  [/^reminded 1 person to turn on two-step sign-in$/, () => msg('reminded 1 person to turn on two-step sign-in')],
  [/^reminded (\d+) people to turn on two-step sign-in$/, (m) => msg('reminded {n} people to turn on two-step sign-in', { n: m[1] })],
  [/^reset two-step sign-in for (.+)$/, (m) => msg('reset two-step sign-in for {name}', { name: m[1] })],
  [/^(.+) reset two-step sign-in for (.+)$/, (m) => msg('{by} reset two-step sign-in for {name}', { by: m[1], name: m[2] })],
  [/^connected (.+) \(([^()]+)\)$/, (m) => msg('connected {app} ({host})', { app: m[1], host: m[2] })],
  [/^connected (.+)$/, (m) => msg('connected {app}', { app: m[1] })],
  [/^disconnected (.+)$/, (m) => msg('disconnected {app}', { app: m[1] })],
];
/** A saved security log line in `l` when it has names or numbers in it; fixed ones as saved (the app translates them). */
export function logLine(detail: string | null | undefined, l: Lang): string | null {
  if (!detail) return detail ?? null;
  for (const [re, said] of LOG_LINES) {
    const m = detail.match(re);
    if (m) return sayIn(l, said(m));
  }
  return detail;
}
