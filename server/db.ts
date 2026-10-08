// The local database: one SQLite file in ./data. Every app collection (threads, todos, channels…) is stored as JSON documents.
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, n: number) => Promise<Buffer>;
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.S2G_DATA ?? join(process.cwd(), 'data');
mkdirSync(DIR, { recursive: true });

export const db = new DatabaseSync(join(DIR, 'sprint2go.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT, PRIMARY KEY (coll, id));
  CREATE TABLE IF NOT EXISTS logins (user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, pw_hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, user_id TEXT, job TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, in_tokens INTEGER NOT NULL, out_tokens INTEGER NOT NULL, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS ai_usage_ws_at ON ai_usage (workspace_id, at);
  CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, uploaded_by TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ai_keys (workspace_id TEXT NOT NULL, provider TEXT NOT NULL, sealed TEXT NOT NULL, base_url TEXT, added_by TEXT, added_at TEXT NOT NULL, PRIMARY KEY (workspace_id, provider));
`);

/* ---------- documents ---------- */

export type Doc = { id: string; [k: string]: unknown };

export function allDocs(coll: string): Doc[] {
  return (db.prepare('SELECT data FROM docs WHERE coll = ? ORDER BY rowid').all(coll) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function getDoc(coll: string, id: string): Doc | undefined {
  const r = db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : undefined;
}
const upsert = db.prepare('INSERT INTO docs (coll, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by');
const remove = db.prepare('DELETE FROM docs WHERE coll = ? AND id = ?');

export function writeDocs(coll: string, upserts: Doc[], deletes: string[], by: string | null) {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const d of upserts) upsert.run(coll, String(d.id), JSON.stringify(d), now, by);
    for (const id of deletes) remove.run(coll, id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export const isEmpty = () => !(db.prepare('SELECT 1 FROM docs LIMIT 1').get() as unknown);

/* ---------- logins ---------- */

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`;
}
export async function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const got = await scryptAsync(pw, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
/** Takes as long as a real check, so an unknown email can't be told from a wrong password by the clock. */
const DUMMY_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;
export const burnPasswordTime = (pw: string) => checkPassword(pw, DUMMY_HASH).catch(() => false);
/** For sign-up: the password was hashed when the code was sent, so it never waits around in plain text. */
export function setLoginHash(userId: string, email: string, hash: string) {
  db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?)').run(userId, email, hash);
}
export async function setLogin(userId: string, email: string, pw: string) {
  db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, pw_hash = excluded.pw_hash').run(userId, email, await hashPassword(pw));
}
export const deleteLogin = (userId: string) => db.prepare('DELETE FROM logins WHERE user_id = ?').run(userId);
export const hasLogin = (userId: string) => !!db.prepare('SELECT 1 FROM logins WHERE user_id = ?').get(userId);
export function findLogin(email: string) {
  return db.prepare('SELECT user_id, pw_hash FROM logins WHERE email = ?').get(email) as { user_id: string; pw_hash: string } | undefined;
}

const DAY = 86_400_000;
// Only a hash of the session token is stored: a copy of the database can't be used to sign in as anyone.
const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');
/** `operator`: an operator signed in as this person from the backend (shorter session, shown in the app, logged). */
export function newSession(userId: string, operator?: string) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, operator) VALUES (?, ?, ?, ?, ?)').run(tokenHash(token), userId, new Date().toISOString(), new Date(Date.now() + (operator ? 0.5 : 30) * DAY).toISOString(), operator ?? null);
  return token;
}
export function sessionUser(token: string | undefined): string | null {
  return sessionInfo(token)?.userId ?? null;
}
export function sessionInfo(token: string | undefined): { userId: string; operator: string | null } | null {
  if (!token) return null;
  const r = db.prepare('SELECT user_id, expires_at, operator FROM sessions WHERE token = ?').get(tokenHash(token)) as { user_id: string; expires_at: string; operator: string | null } | undefined;
  if (!r || r.expires_at < new Date().toISOString()) return null;
  return { userId: r.user_id, operator: r.operator };
}
export const endSession = (token: string) => db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash(token));
/** Everyone signed in as this person is signed out (after a password change or reset). */
export const endSessions = (userId: string) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
export const purgeSessions = () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());

/** A copy of the database into data/backups, keeping the last 14 (one a day). */
export async function backup() {
  const dir = join(DIR, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `sprint2go-${new Date().toISOString().slice(0, 10)}.db`);
  await sqliteBackup(db, file);
  const { readdirSync, unlinkSync } = await import('node:fs');
  readdirSync(dir)
    .filter((f) => f.startsWith('sprint2go-') && f.endsWith('.db'))
    .sort()
    .slice(0, -14)
    .forEach((f) => unlinkSync(join(dir, f)));
  return file;
}

/** An invite link lets a new person pick their own password (valid 7 days, works once). */
export function newInvite(userId: string, email: string) {
  const token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO invites (token, user_id, email, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, email, new Date(Date.now() + 7 * DAY).toISOString());
  return token;
}
export function claimInvite(token: string) {
  const r = db.prepare('SELECT user_id, email, expires_at FROM invites WHERE token = ?').get(token) as { user_id: string; email: string; expires_at: string } | undefined;
  if (!r || r.expires_at < new Date().toISOString()) return null;
  db.prepare('DELETE FROM invites WHERE token = ?').run(token);
  return r;
}
export const peekInvite = (token: string) => db.prepare('SELECT user_id, email FROM invites WHERE token = ? AND expires_at > ?').get(token, new Date().toISOString()) as { user_id: string; email: string } | undefined;

/* ---------- AI keys, encrypted at rest ---------- */

// The master key lives next to the database (or in S2G_SECRET). Losing it means re-entering the AI keys.
const MASTER = (() => {
  if (process.env.S2G_SECRET) return Buffer.from(process.env.S2G_SECRET, 'base64');
  const file = join(DIR, 'secret.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
})();

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', MASTER, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function unseal(sealed: string) {
  const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', MASTER, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
export function saveKey(workspaceId: string, provider: string, key: string, baseUrl: string | undefined, by: string) {
  db.prepare('INSERT INTO ai_keys (workspace_id, provider, sealed, base_url, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, provider) DO UPDATE SET sealed = excluded.sealed, base_url = excluded.base_url, added_by = excluded.added_by, added_at = excluded.added_at').run(
    workspaceId,
    provider,
    seal(key),
    baseUrl ?? null,
    by,
    new Date().toISOString(),
  );
}
export function loadKey(workspaceId: string, provider: string): { key: string; baseUrl?: string } | null {
  const r = db.prepare('SELECT sealed, base_url FROM ai_keys WHERE workspace_id = ? AND provider = ?').get(workspaceId, provider) as { sealed: string; base_url: string | null } | undefined;
  return r ? { key: unseal(r.sealed), baseUrl: r.base_url ?? undefined } : null;
}
export const deleteKey = (workspaceId: string, provider: string) => db.prepare('DELETE FROM ai_keys WHERE workspace_id = ? AND provider = ?').run(workspaceId, provider);

/* ---------- AI usage log (tokens per call, for the cost estimate in Settings, AI) ---------- */

export function logUsage(u: { workspaceId: string; userId: string; job: string; provider: string; model: string; inTokens: number; outTokens: number }) {
  db.prepare('INSERT INTO ai_usage (workspace_id, user_id, job, provider, model, in_tokens, out_tokens, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(u.workspaceId, u.userId, u.job, u.provider, u.model, u.inTokens, u.outTokens, new Date().toISOString());
}
export function usageSince(workspaceId: string, since: string) {
  return db
    .prepare('SELECT job, provider, model, COUNT(*) AS uses, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE workspace_id = ? AND at >= ? GROUP BY job, provider, model ORDER BY uses DESC')
    .all(workspaceId, since) as { job: string; provider: string; model: string; uses: number; inTokens: number; outTokens: number }[];
}

/** AI uses this month by these people for one job (the client portal's question limit). */
export function monthlyUses(userIds: string[], job: string) {
  if (!userIds.length) return 0;
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = db.prepare(`SELECT COUNT(*) AS n FROM ai_usage WHERE job = ? AND at >= ? AND user_id IN (${userIds.map(() => '?').join(',')})`).get(job, start.toISOString(), ...userIds) as { n: number };
  return r.n;
}

/* ---------- Vault: shared logins, encrypted at rest; secrets leave the server only when revealed (and that's logged) ---------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS vault_items (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, meta TEXT NOT NULL, password TEXT, totp TEXT, notes TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS vault_log (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, user_id TEXT NOT NULL, what TEXT NOT NULL, at TEXT NOT NULL);
`);

export interface VaultMeta {
  keys?: Record<string, unknown>; // end-to-end: the item key wrapped per person (opaque here)
  title: string;
  url?: string;
  username?: string;
  clientId?: string;
  access: { everyone: boolean; userIds: string[]; teamIds: string[]
  keys?: Record<string, unknown>; // end-to-end: the item key wrapped per person (opaque here)
};
}
export interface VaultRow {
  id: string;
  workspaceId: string;
  meta: VaultMeta;
  hasPassword: boolean;
  hasTotp: boolean;
  hasNotes: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const rowOf = (r: any): VaultRow => ({ id: r.id, workspaceId: r.workspace_id, meta: JSON.parse(r.meta), hasPassword: !!r.password, hasTotp: !!r.totp, hasNotes: !!r.notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
export const vaultList = (workspaceId: string) => (db.prepare('SELECT * FROM vault_items WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as any[]).map(rowOf);
export const vaultGet = (id: string) => {
  const r = db.prepare('SELECT * FROM vault_items WHERE id = ?').get(id) as any;
  return r ? rowOf(r) : undefined;
};
/** Saves an item. Secrets: a string sets it, '' clears it, undefined keeps what's there. */
export function vaultSave(v: { id: string; workspaceId: string; meta: VaultMeta; password?: string; totp?: string; notes?: string; by: string }) {
  const now = new Date().toISOString();
  const before = db.prepare('SELECT * FROM vault_items WHERE id = ?').get(v.id) as any;
  const keep = (val: string | undefined, old: string | null) => (val === undefined ? old : val ? seal(val) : null);
  if (before)
    db.prepare('UPDATE vault_items SET meta = ?, password = ?, totp = ?, notes = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(v.meta), keep(v.password, before.password), keep(v.totp, before.totp), keep(v.notes, before.notes), now, v.id);
  else
    db.prepare('INSERT INTO vault_items (id, workspace_id, meta, password, totp, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      v.id,
      v.workspaceId,
      JSON.stringify(v.meta),
      v.password ? seal(v.password) : null,
      v.totp ? seal(v.totp) : null,
      v.notes ? seal(v.notes) : null,
      v.by,
      now,
      now,
    );
}
export const vaultDelete = (id: string) => db.prepare('DELETE FROM vault_items WHERE id = ?').run(id);
export function vaultSecret(id: string, field: 'password' | 'totp' | 'notes'): string | null {
  const r = db.prepare(`SELECT ${field} AS v FROM vault_items WHERE id = ?`).get(id) as { v: string | null } | undefined;
  return r?.v ? unseal(r.v) : null;
}
export const vaultLog = (itemId: string, userId: string, what: string) => db.prepare('INSERT INTO vault_log (item_id, user_id, what, at) VALUES (?, ?, ?, ?)').run(itemId, userId, what, new Date().toISOString());
export const vaultLogFor = (itemId: string) => db.prepare('SELECT user_id AS userId, what, at FROM vault_log WHERE item_id = ? ORDER BY id DESC LIMIT 100').all(itemId) as { userId: string; what: string; at: string }[];

/** A 6-digit 2FA code (RFC 6238, 30 seconds) from a base32 secret. */
export function totpCode(secret: string, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.replace(/[\s=-]/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('Not a valid 2FA secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Math.floor(now / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return { code: String(n % 1_000_000).padStart(6, '0'), secondsLeft: 30 - (Math.floor(now / 1000) % 30) };
}

/* ---------- files on disk ---------- */

const FILES = join(DIR, 'files');
export function saveFile(f: { id: string; workspaceId: string; by: string; name: string; type: string; size: number }, data: Buffer) {
  mkdirSync(FILES, { recursive: true });
  writeFileSync(join(FILES, f.id), data);
  db.prepare('INSERT INTO files (id, workspace_id, uploaded_by, name, type, size, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(f.id, f.workspaceId, f.by, f.name, f.type, f.size, new Date().toISOString());
}
export function fileInfo(id: string) {
  const r = db.prepare('SELECT id, workspace_id, uploaded_by, name, type, size FROM files WHERE id = ?').get(id) as any;
  return r ? { id: r.id as string, workspaceId: r.workspace_id as string, by: r.uploaded_by as string, name: r.name as string, type: r.type as string, size: r.size as number } : null;
}
export function fileData(id: string): Buffer | null {
  const f = join(FILES, id);
  return existsSync(f) ? readFileSync(f) : null;
}
/** One person's usage this period (for their own monthly cap). */
export function usageSinceFor(workspaceId: string, userId: string, since: string) {
  return db.prepare('SELECT job, provider, model, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE workspace_id = ? AND user_id = ? AND at >= ? GROUP BY job, provider, model').all(workspaceId, userId, since);
}

/* ---------- the operator backend: who did what, who was here when ---------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, operator TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT);
  CREATE TABLE IF NOT EXISTS activity (user_id TEXT PRIMARY KEY, at TEXT NOT NULL);
`);
try {
  db.exec('ALTER TABLE sessions ADD COLUMN operator TEXT');
} catch {
  /* already there */
}

export const audit = (operator: string, action: string, target: string | null, detail?: string) =>
  db.prepare('INSERT INTO audit (at, operator, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(new Date().toISOString(), operator, action, target, detail ?? null);
export const auditList = (limit = 200, target?: string) =>
  (target
    ? db.prepare('SELECT id, at, operator, action, target, detail FROM audit WHERE target = ? ORDER BY id DESC LIMIT ?').all(target, limit)
    : db.prepare('SELECT id, at, operator, action, target, detail FROM audit ORDER BY id DESC LIMIT ?').all(limit)) as { id: number; at: string; operator: string; action: string; target: string | null; detail: string | null }[];

const touched = new Map<string, number>();
/** Remembers that this person was here (at most once every few minutes, so it costs nothing). */
export function touch(userId: string) {
  const now = Date.now();
  if ((touched.get(userId) ?? 0) > now - 5 * 60_000) return;
  touched.set(userId, now);
  db.prepare('INSERT INTO activity (user_id, at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET at = excluded.at').run(userId, new Date(now).toISOString());
}
export const lastSeen = () => new Map((db.prepare('SELECT user_id, at FROM activity').all() as { user_id: string; at: string }[]).map((r) => [r.user_id, r.at]));

/** Everyone's AI usage since a date, by company (the operator's cost view). */
export const usageByWorkspace = (since: string) =>
  db.prepare('SELECT workspace_id AS workspaceId, provider, model, COUNT(*) AS uses, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE at >= ? GROUP BY workspace_id, provider, model').all(since) as {
    workspaceId: string;
    provider: string;
    model: string;
    uses: number;
    inTokens: number;
    outTokens: number;
  }[];
/** Bytes of uploaded files per company. */
export const storageByWorkspace = () => new Map((db.prepare('SELECT workspace_id, SUM(size) AS bytes FROM files GROUP BY workspace_id').all() as { workspace_id: string; bytes: number }[]).map((r) => [r.workspace_id, r.bytes]));
export const sessionCount = () => (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').get(new Date().toISOString()) as { n: number }).n;
export const dbPath = join(DIR, 'sprint2go.db');
export const dataDir = DIR;
/** Removes every document of a company across all collections (the company itself included when `all`). */
export function deleteWorkspaceDocs(workspaceId: string, all: boolean) {
  const rows = db.prepare("SELECT coll, id, data FROM docs WHERE coll != 'users'").all() as { coll: string; id: string; data: string }[];
  const gone: Record<string, string[]> = {};
  for (const r of rows) {
    let d: any;
    try {
      d = JSON.parse(r.data);
    } catch {
      continue;
    }
    const inWs = r.coll === 'workspaces' ? r.id === workspaceId && all : d?.workspaceId === workspaceId || (r.coll === 'prefs' ? false : d?.value?.workspaceId === workspaceId);
    if (inWs) (gone[r.coll] ??= []).push(r.id);
  }
  const del = db.prepare('DELETE FROM docs WHERE coll = ? AND id = ?');
  for (const [coll, ids] of Object.entries(gone)) for (const id of ids) del.run(coll, id);
  db.prepare('DELETE FROM ai_usage WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM ai_keys WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM vault_items WHERE workspace_id = ?').run(workspaceId);
  for (const f of db.prepare('SELECT id FROM files WHERE workspace_id = ?').all(workspaceId) as { id: string }[]) {
    try {
      unlinkSync(join(FILES, f.id));
    } catch {
      /* gone already */
    }
  }
  db.prepare('DELETE FROM files WHERE workspace_id = ?').run(workspaceId);
  return gone;
}
