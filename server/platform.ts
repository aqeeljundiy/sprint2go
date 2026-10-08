// What the people who run sprint2go need to keep: operators and their roles, platform settings, a timeline of what
// happened to each company, internal notes, invoices, coupons, MRR snapshots, grouped errors and simple page counts.
// Everything here is operator-side; none of it is synced to the app's collections.
import { createHash, randomBytes } from 'node:crypto';
import { db, newTotpSecret, totpStep } from './db.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS operators (email TEXT PRIMARY KEY, role TEXT NOT NULL, added_by TEXT, added_at TEXT NOT NULL, totp TEXT, totp_on INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, alerts INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS platform_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, workspace_id TEXT, user_id TEXT, detail TEXT);
  CREATE INDEX IF NOT EXISTS platform_events_ws ON platform_events (workspace_id, at);
  CREATE INDEX IF NOT EXISTS platform_events_type ON platform_events (type, at);
  CREATE TABLE IF NOT EXISTS op_notes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, by TEXT NOT NULL, text TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL, period TEXT NOT NULL, lines TEXT NOT NULL, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, tax INTEGER NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL, method TEXT, due_at TEXT NOT NULL, sent_at TEXT, paid_at TEXT, note TEXT, created_by TEXT, created_at TEXT NOT NULL, bill_to TEXT);
  CREATE INDEX IF NOT EXISTS invoices_ws ON invoices (workspace_id, period);
  CREATE TABLE IF NOT EXISTS coupons (code TEXT PRIMARY KEY, kind TEXT NOT NULL, value REAL NOT NULL, months INTEGER, max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, expires_at TEXT, note TEXT, created_by TEXT, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS mrr_snapshots (day TEXT NOT NULL, workspace_id TEXT NOT NULL, mrr INTEGER NOT NULL, PRIMARY KEY (day, workspace_id));
  CREATE TABLE IF NOT EXISTS error_groups (fingerprint TEXT PRIMARY KEY, source TEXT NOT NULL, message TEXT NOT NULL, sample TEXT, path TEXT, count INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, users TEXT NOT NULL DEFAULT '[]', workspaces TEXT NOT NULL DEFAULT '[]', resolved_at TEXT);
  CREATE TABLE IF NOT EXISTS page_views (day TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, path, source));
  CREATE TABLE IF NOT EXISTS activity_days (user_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, day));
  CREATE TABLE IF NOT EXISTS alerts_sent (kind TEXT PRIMARY KEY, at TEXT NOT NULL, text TEXT NOT NULL);
`);
for (const col of ['op_ok TEXT', 'ua TEXT', 'ip TEXT', 'last_at TEXT']) {
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`);
  } catch {
    /* already there */
  }
}

const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);

/* ---------- operators ---------- */

export type OpRole = 'owner' | 'admin' | 'support' | 'finance' | 'readonly';
export const ROLES: OpRole[] = ['owner', 'admin', 'support', 'finance', 'readonly'];
export type Perm = 'view' | 'support' | 'impersonate' | 'customers' | 'billing' | 'product' | 'platform' | 'team' | 'danger';
const PERMS: Record<OpRole, Perm[]> = {
  owner: ['view', 'support', 'impersonate', 'customers', 'billing', 'product', 'platform', 'team', 'danger'],
  admin: ['view', 'support', 'impersonate', 'customers', 'billing', 'product', 'platform', 'team'],
  support: ['view', 'support', 'impersonate'],
  finance: ['view', 'billing'],
  readonly: ['view'],
};
export const permsOf = (role: OpRole) => PERMS[role] ?? [];
export interface Operator {
  email: string;
  role: OpRole;
  addedBy: string | null;
  addedAt: string;
  totpOn: boolean;
  disabled: boolean;
  alerts: boolean;
}
const opRow = (r: any): Operator => ({ email: r.email, role: r.role, addedBy: r.added_by, addedAt: r.added_at, totpOn: !!r.totp_on, disabled: !!r.disabled, alerts: !!r.alerts });
export const operators = () => (db.prepare('SELECT * FROM operators ORDER BY added_at').all() as any[]).map(opRow);
export function operator(email: string | undefined | null): Operator | null {
  if (!email) return null;
  const r = db.prepare('SELECT * FROM operators WHERE email = ? AND disabled = 0').get(email.toLowerCase());
  return r ? opRow(r) : null;
}
/** S2G_OPERATORS bootstraps the team; its first address is always kept as an owner (the way back in). */
export function bootstrapOperators() {
  const env = (process.env.S2G_OPERATORS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const empty = !(db.prepare('SELECT 1 FROM operators LIMIT 1').get() as unknown);
  env.forEach((email, i) => {
    const cur = db.prepare('SELECT role, disabled FROM operators WHERE email = ?').get(email) as { role: string; disabled: number } | undefined;
    if (!cur && (empty || i === 0)) db.prepare('INSERT INTO operators (email, role, added_by, added_at) VALUES (?, ?, ?, ?)').run(email, i === 0 ? 'owner' : 'admin', 'S2G_OPERATORS', now());
    else if (cur && i === 0 && (cur.role !== 'owner' || cur.disabled)) db.prepare("UPDATE operators SET role = 'owner', disabled = 0 WHERE email = ?").run(email);
  });
}
export function saveOperator(email: string, role: OpRole, by: string) {
  const e = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM operators WHERE email = ?').get(e)) db.prepare('UPDATE operators SET role = ?, disabled = 0 WHERE email = ?').run(role, e);
  else db.prepare('INSERT INTO operators (email, role, added_by, added_at) VALUES (?, ?, ?, ?)').run(e, role, by, now());
}
export const removeOperator = (email: string) => db.prepare('UPDATE operators SET disabled = 1, totp = NULL, totp_on = 0 WHERE email = ?').run(email.toLowerCase());
export const setOperatorAlerts = (email: string, on: boolean) => db.prepare('UPDATE operators SET alerts = ? WHERE email = ?').run(on ? 1 : 0, email.toLowerCase());
export const resetOperator2fa = (email: string) => db.prepare('UPDATE operators SET totp = NULL, totp_on = 0 WHERE email = ?').run(email.toLowerCase());

/* ---------- operator two-step sign-in (TOTP) ---------- */

// The TOTP itself (secrets, codes, clock drift) is shared with everyone's own two-step sign-in (db.ts, twostep.ts).
/** A new secret (kept until it's confirmed with a code). */
export function startTotp(email: string) {
  const secret = newTotpSecret();
  db.prepare('UPDATE operators SET totp = ?, totp_on = 0 WHERE email = ?').run(secret, email.toLowerCase());
  return secret;
}
/** Checks a code against the secret, allowing one step of clock drift either way. */
export function checkTotp(email: string, code: string) {
  const r = db.prepare('SELECT totp FROM operators WHERE email = ?').get(email.toLowerCase()) as { totp: string | null } | undefined;
  if (!r?.totp) return false;
  return totpStep(r.totp, String(code ?? '')) !== null;
}
export const confirmTotp = (email: string) => db.prepare('UPDATE operators SET totp_on = 1 WHERE email = ?').run(email.toLowerCase());

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
export const markSessionVerified = (token: string) => db.prepare('UPDATE sessions SET op_ok = ? WHERE token = ?').run(now(), tokenHash(token));
export function sessionVerified(token: string | undefined) {
  if (!token) return false;
  const r = db.prepare('SELECT op_ok FROM sessions WHERE token = ?').get(tokenHash(token)) as { op_ok: string | null } | undefined;
  return !!r?.op_ok && r.op_ok > new Date(Date.now() - 12 * 3600_000).toISOString(); // asked again every 12 hours
}
export function noteSession(token: string, ua: string, ip: string) {
  db.prepare('UPDATE sessions SET ua = COALESCE(ua, ?), ip = ?, last_at = ? WHERE token = ?').run(ua.slice(0, 200), ip.slice(0, 60), now(), tokenHash(token));
}
export const sessionsOf = (userId: string) =>
  (db.prepare('SELECT token, created_at, expires_at, ua, ip, last_at, operator FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_at, created_at) DESC').all(userId, now()) as any[]).map((r) => ({
    id: String(r.token).slice(0, 16),
    createdAt: r.created_at,
    lastAt: r.last_at ?? r.created_at,
    ua: r.ua ?? null,
    ip: r.ip ?? null,
    actingAs: r.operator ?? null,
  }));
export const endSessionById = (userId: string, id: string) => db.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(token, 1, 16) = ?").run(userId, id);

/* ---------- platform settings ---------- */

export interface PlatformSettings {
  homeWorkspace: string | null; // sprint2go's own company: internal, and where operators get their notices
  internal: string[]; // companies left out of revenue and growth numbers (ours, tests)
  slaHours: { urgent: number; paid: number; other: number };
  autoSuspendDays: number; // 0 = never; else read-only this many days after an invoice is overdue
  maintenance: { on: boolean; message: string };
  supportName: string;
  flags: Record<string, { description: string; mode: 'off' | 'on' | 'list' | 'percent'; companies: string[]; percent: number }>;
  announcements: { id: string; text: string; link?: string; kind: 'news' | 'warning'; audience: 'all' | 'owners' | 'paying' | 'trial' | 'list'; companies: string[]; from: string; until?: string; createdBy: string }[];
  pricing?: unknown; // an override of src/data/pricing.ts, set from the backend
  dataRequests: { id: string; workspaceId: string; kind: 'delete'; requestedBy: string; at: string; runAt: string; done?: string; cancelled?: string }[];
  broadcasts: { id: string; subject: string; audience: string; sent: number; at: string; by: string }[];
  billing: { name: string; address: string; npwp: string; bank: string; email: string }; // printed on invoices
  backupTest: { at: string; file: string; ok: boolean; detail: string } | null;
}
const DEFAULTS: PlatformSettings = {
  homeWorkspace: null,
  internal: [],
  slaHours: { urgent: 1, paid: 2, other: 8 },
  autoSuspendDays: 0,
  maintenance: { on: false, message: '' },
  supportName: 'sprint2go Support',
  flags: {},
  announcements: [],
  dataRequests: [],
  broadcasts: [],
  billing: { name: 'sprint2go', address: '', npwp: '', bank: '', email: '' },
  backupTest: null,
};
export function settings(): PlatformSettings {
  const rows = db.prepare('SELECT key, value FROM platform_settings').all() as { key: string; value: string }[];
  const s: any = { ...DEFAULTS };
  for (const r of rows) {
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {
      /* skip a bad row */
    }
  }
  return s as PlatformSettings;
}
export function setSetting<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
  db.prepare('INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
export const isInternal = (wsId: string) => {
  const s = settings();
  return s.homeWorkspace === wsId || s.internal.includes(wsId);
};

/* ---------- what happened, when ---------- */

export function event(type: string, workspaceId: string | null, userId: string | null, detail?: string) {
  db.prepare('INSERT INTO platform_events (at, type, workspace_id, user_id, detail) VALUES (?, ?, ?, ?, ?)').run(now(), type, workspaceId, userId, detail ?? null);
}
/** An event only the first time it happens for this company (first email, first task…). */
export function firstEvent(type: string, workspaceId: string, userId: string | null, detail?: string) {
  if (db.prepare('SELECT 1 FROM platform_events WHERE type = ? AND workspace_id = ? LIMIT 1').get(type, workspaceId)) return;
  event(type, workspaceId, userId, detail);
}
export const eventsOf = (workspaceId: string, limit = 200) =>
  db.prepare('SELECT id, at, type, user_id AS userId, detail FROM platform_events WHERE workspace_id = ? ORDER BY id DESC LIMIT ?').all(workspaceId, limit) as { id: number; at: string; type: string; userId: string | null; detail: string | null }[];
export const eventsSince = (since: string, types?: string[]) =>
  (types?.length
    ? db.prepare(`SELECT at, type, workspace_id AS workspaceId, user_id AS userId, detail FROM platform_events WHERE at >= ? AND type IN (${types.map(() => '?').join(',')})`).all(since, ...types)
    : db.prepare('SELECT at, type, workspace_id AS workspaceId, user_id AS userId, detail FROM platform_events WHERE at >= ?').all(since)) as { at: string; type: string; workspaceId: string | null; userId: string | null; detail: string | null }[];

/* ---------- internal notes on a company ---------- */

export const notesOf = (workspaceId: string) =>
  (db.prepare('SELECT * FROM op_notes WHERE workspace_id = ? ORDER BY pinned DESC, at DESC').all(workspaceId) as any[]).map((r) => ({ id: r.id, by: r.by, text: r.text, pinned: !!r.pinned, at: r.at }));
export function addNote(workspaceId: string, by: string, text: string) {
  const id = 'on-' + randomBytes(5).toString('hex');
  db.prepare('INSERT INTO op_notes (id, workspace_id, by, text, at) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, by, text.slice(0, 4000), now());
  return id;
}
export const pinNote = (id: string, pinned: boolean) => db.prepare('UPDATE op_notes SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
export const deleteNote = (id: string) => db.prepare('DELETE FROM op_notes WHERE id = ?').run(id);

/* ---------- invoices (bank transfer now; the payment provider marks them paid later) ---------- */

export interface Invoice {
  id: string;
  number: string;
  workspaceId: string;
  period: string; // YYYY-MM
  lines: { text: string; amount: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'void';
  method: string | null;
  dueAt: string;
  sentAt: string | null;
  paidAt: string | null;
  note: string | null;
  createdAt: string;
  billTo: { company: string; npwp?: string; address?: string; emails: string[] } | null;
}
const invRow = (r: any): Invoice => ({
  id: r.id,
  number: r.number,
  workspaceId: r.workspace_id,
  period: r.period,
  lines: JSON.parse(r.lines),
  subtotal: r.subtotal,
  discount: r.discount,
  tax: r.tax,
  total: r.total,
  status: r.status,
  method: r.method,
  dueAt: r.due_at,
  sentAt: r.sent_at,
  paidAt: r.paid_at,
  note: r.note,
  createdAt: r.created_at,
  billTo: r.bill_to ? JSON.parse(r.bill_to) : null,
});
export const TAX_RATE = 0.11; // PPN
export const invoices = (workspaceId?: string) =>
  (workspaceId ? db.prepare('SELECT * FROM invoices WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId) : db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all()).map(invRow);
export const invoice = (id: string) => {
  const r = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  return r ? invRow(r) : null;
};
export function createInvoice(i: { workspaceId: string; period: string; lines: { text: string; amount: number }[]; discount: number; dueDays: number; billTo: Invoice['billTo']; by: string; note?: string }) {
  const subtotal = Math.round(i.lines.reduce((n, l) => n + l.amount, 0));
  const discount = Math.min(subtotal, Math.round(i.discount));
  const tax = Math.round((subtotal - discount) * TAX_RATE);
  const seq = (db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE substr(created_at, 1, 4) = ?").get(now().slice(0, 4)) as { n: number }).n + 1;
  const number = `S2G-${now().slice(0, 4)}-${String(seq).padStart(4, '0')}`;
  const id = 'inv-' + randomBytes(6).toString('hex');
  db.prepare('INSERT INTO invoices (id, number, workspace_id, period, lines, subtotal, discount, tax, total, status, due_at, note, created_by, created_at, bill_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    number,
    i.workspaceId,
    i.period,
    JSON.stringify(i.lines),
    subtotal,
    discount,
    tax,
    subtotal - discount + tax,
    'draft',
    new Date(Date.now() + i.dueDays * 86_400_000).toISOString(),
    i.note ?? null,
    i.by,
    now(),
    i.billTo ? JSON.stringify(i.billTo) : null,
  );
  return invoice(id)!;
}
export function setInvoiceStatus(id: string, status: Invoice['status'], method?: string) {
  const at = now();
  if (status === 'sent') db.prepare("UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = ? WHERE id = ?").run(at, id);
  else if (status === 'paid') db.prepare("UPDATE invoices SET status = 'paid', paid_at = ?, method = ? WHERE id = ?").run(at, method ?? 'bank transfer', id);
  else db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, id);
  return invoice(id);
}
export const overdueInvoices = () => invoices().filter((i) => i.status === 'sent' && i.dueAt < now());

/* ---------- coupons ---------- */

export interface Coupon {
  code: string;
  kind: 'percent' | 'amount' | 'months';
  value: number; // percent off, rupiah off per month, or free months
  months: number | null; // how many months a percent or amount discount lasts (null: forever)
  maxUses: number | null;
  used: number;
  expiresAt: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
}
const couponRow = (r: any): Coupon => ({ code: r.code, kind: r.kind, value: r.value, months: r.months, maxUses: r.max_uses, used: r.used, expiresAt: r.expires_at, note: r.note, active: !!r.active, createdAt: r.created_at });
export const coupons = () => (db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all() as any[]).map(couponRow);
export const coupon = (code: string) => {
  const r = db.prepare('SELECT * FROM coupons WHERE code = ?').get(code.trim().toUpperCase());
  return r ? couponRow(r) : null;
};
export function saveCoupon(c: Omit<Coupon, 'used' | 'createdAt' | 'active'> & { active?: boolean }, by: string) {
  const code = c.code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!code) throw new Error('Give the code some letters or numbers.');
  db.prepare(
    'INSERT INTO coupons (code, kind, value, months, max_uses, expires_at, note, created_by, created_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET kind = excluded.kind, value = excluded.value, months = excluded.months, max_uses = excluded.max_uses, expires_at = excluded.expires_at, note = excluded.note, active = excluded.active',
  ).run(code, c.kind, c.value, c.months, c.maxUses, c.expiresAt, c.note, by, now(), c.active === false ? 0 : 1);
  return coupon(code)!;
}
/** Whether a code can still be used; returns why not when it can't. */
export function couponUsable(code: string): { ok: true; coupon: Coupon } | { ok: false; error: string } {
  const c = coupon(code);
  if (!c || !c.active) return { ok: false, error: 'That code doesn’t exist.' };
  if (c.expiresAt && c.expiresAt < now()) return { ok: false, error: 'That code has expired.' };
  if (c.maxUses && c.used >= c.maxUses) return { ok: false, error: 'That code has been used up.' };
  return { ok: true, coupon: c };
}
export const useCoupon = (code: string) => db.prepare('UPDATE coupons SET used = used + 1 WHERE code = ?').run(code.toUpperCase());

/* ---------- MRR over time ---------- */

export function snapshotMrr(rows: { id: string; mrr: number }[]) {
  const d = today();
  const ins = db.prepare('INSERT INTO mrr_snapshots (day, workspace_id, mrr) VALUES (?, ?, ?) ON CONFLICT(day, workspace_id) DO UPDATE SET mrr = excluded.mrr');
  for (const r of rows) ins.run(d, r.id, Math.round(r.mrr));
}
/** The last snapshot on or before each month's end, per company. */
export function mrrByMonth(months: string[]) {
  const out: Record<string, Map<string, number>> = {};
  for (const m of months) {
    const end = `${m}-31`;
    const rows = db.prepare('SELECT s.workspace_id AS ws, s.mrr AS mrr FROM mrr_snapshots s JOIN (SELECT workspace_id, MAX(day) AS day FROM mrr_snapshots WHERE day <= ? GROUP BY workspace_id) last ON last.workspace_id = s.workspace_id AND last.day = s.day').all(end) as { ws: string; mrr: number }[];
    out[m] = new Map(rows.map((r) => [r.ws, r.mrr]));
  }
  return out;
}

/* ---------- errors, grouped ---------- */

export function recordError(e: { source: 'server' | 'client'; message: string; stack?: string; path?: string; userId?: string | null; workspaceId?: string | null }) {
  const firstFrame = (e.stack ?? '').split('\n').find((l) => /^\s+at /.test(l))?.trim().replace(/\?[^:)]*/, '').replace(/:\d+:\d+\)?$/, '') ?? '';
  const message = e.message.replace(/\b[0-9a-f]{8,}\b/g, '…').replace(/\d{4,}/g, '…').slice(0, 300);
  const fingerprint = createHash('sha1').update(`${e.source}|${message}|${firstFrame}`).digest('hex').slice(0, 20);
  const cur = db.prepare('SELECT users, workspaces FROM error_groups WHERE fingerprint = ?').get(fingerprint) as { users: string; workspaces: string } | undefined;
  const add = (json: string | undefined, v: string | null | undefined) => {
    const set = new Set<string>(json ? JSON.parse(json) : []);
    if (v && set.size < 200) set.add(v);
    return JSON.stringify(Array.from(set));
  };
  if (cur)
    db.prepare('UPDATE error_groups SET count = count + 1, last_at = ?, sample = ?, path = COALESCE(?, path), users = ?, workspaces = ?, resolved_at = NULL WHERE fingerprint = ?').run(now(), (e.stack ?? e.message).slice(0, 4000), e.path ?? null, add(cur.users, e.userId), add(cur.workspaces, e.workspaceId), fingerprint);
  else db.prepare('INSERT INTO error_groups (fingerprint, source, message, sample, path, count, first_at, last_at, users, workspaces) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)').run(fingerprint, e.source, message, (e.stack ?? e.message).slice(0, 4000), e.path ?? null, now(), now(), add(undefined, e.userId), add(undefined, e.workspaceId));
}
export const errorGroups = () =>
  (db.prepare('SELECT * FROM error_groups ORDER BY resolved_at IS NOT NULL, last_at DESC LIMIT 300').all() as any[]).map((r) => ({
    id: r.fingerprint,
    source: r.source,
    message: r.message,
    sample: r.sample,
    path: r.path,
    count: r.count,
    firstAt: r.first_at,
    lastAt: r.last_at,
    users: JSON.parse(r.users).length,
    workspaces: JSON.parse(r.workspaces) as string[],
    resolvedAt: r.resolved_at,
  }));
export const resolveError = (id: string) => db.prepare('UPDATE error_groups SET resolved_at = ? WHERE fingerprint = ?').run(now(), id);

/* ---------- landing visits (counted on the server, no cookies needed) and activity history ---------- */

export function countView(path: string, source: string) {
  db.prepare('INSERT INTO page_views (day, path, source, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, path, source) DO UPDATE SET n = n + 1').run(today(), path.slice(0, 60), source.slice(0, 80) || 'direct');
}
export const viewsSince = (since: string) => db.prepare('SELECT day, path, source, n FROM page_views WHERE day >= ?').all(since.slice(0, 10)) as { day: string; path: string; source: string; n: number }[];
export const activeDay = (userId: string) => db.prepare('INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)').run(userId, today());
export const activeDaysSince = (since: string) => db.prepare('SELECT user_id AS userId, day FROM activity_days WHERE day >= ?').all(since.slice(0, 10)) as { userId: string; day: string }[];

/* ---------- alerts: at most one of each kind every few hours ---------- */

export function alertDue(kind: string, text: string, everyHours = 6) {
  const r = db.prepare('SELECT at FROM alerts_sent WHERE kind = ?').get(kind) as { at: string } | undefined;
  if (r && r.at > new Date(Date.now() - everyHours * 3600_000).toISOString()) return false;
  db.prepare('INSERT INTO alerts_sent (kind, at, text) VALUES (?, ?, ?) ON CONFLICT(kind) DO UPDATE SET at = excluded.at, text = excluded.text').run(kind, now(), text);
  return true;
}
export const recentAlerts = () => db.prepare('SELECT kind, at, text FROM alerts_sent ORDER BY at DESC LIMIT 50').all() as { kind: string; at: string; text: string }[];

/* ---------- sign-ups worth a look ---------- */

const DISPOSABLE = /(^|\.)(mailinator|guerrillamail|guerrillamailblock|sharklasers|10minutemail|tempmail|temp-mail|yopmail|trashmail|getnada|dispostable|maildrop|throwawaymail|fakeinbox|mintemail|mohmal|emailondeck|moakt|tempr|spamgourmet|mailnesia|burnermail)\.[a-z.]+$/i;
export const isDisposable = (email: string) => DISPOSABLE.test(email.split('@')[1] ?? '');
