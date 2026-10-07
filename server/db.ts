// The local database: one SQLite file in ./data. Every app collection (threads, todos, channels…) is stored as JSON documents.
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const got = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
export function setLogin(userId: string, email: string, pw: string) {
  db.prepare('INSERT INTO logins (user_id, email, pw_hash) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, pw_hash = excluded.pw_hash').run(userId, email, hashPassword(pw));
}
export const hasLogin = (userId: string) => !!db.prepare('SELECT 1 FROM logins WHERE user_id = ?').get(userId);
export function findLogin(email: string) {
  return db.prepare('SELECT user_id, pw_hash FROM logins WHERE email = ?').get(email) as { user_id: string; pw_hash: string } | undefined;
}

const DAY = 86_400_000;
export function newSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, new Date().toISOString(), new Date(Date.now() + 30 * DAY).toISOString());
  return token;
}
export function sessionUser(token: string | undefined): string | null {
  if (!token) return null;
  const r = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as { user_id: string; expires_at: string } | undefined;
  if (!r || r.expires_at < new Date().toISOString()) return null;
  return r.user_id;
}
export const endSession = (token: string) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token);

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
  title: string;
  url?: string;
  username?: string;
  clientId?: string;
  access: { everyone: boolean; userIds: string[]; teamIds: string[] };
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
