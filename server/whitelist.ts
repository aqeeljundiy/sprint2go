// The Whitelist: companies operators give everything to, with no plan limits and no bills (investors, partners,
// friends; the app only ever calls it "Unlimited"). Kept on the server:
//  - the entry: an operator's note, and two monthly limits for what costs us real money: AI on our keys (US$ or
//    rupiah, priced like the AI plan, server/aiplan.ts) and Boosted sending emails (Amazon SES). The plan the company
//    had before is kept here, and comes back when it's taken off the list
//  - the plan: Business AI with every add-on and `unlimited: true`, which every limit reads (server/billing.ts,
//    src/data/pricing.ts): no cap on people, mailboxes, notetaker hours or imports; Drive storage is the server's free
//    disk minus a safety reserve; no invoices, trials, pauses or upsells
//  - each person's rules, set by the company's owners and admins: a share of the AI limit, a storage cap, and the
//    notetaker, Boosted sending and AI on or off. People without a rule share what's left
//  - alerts: at 80% of a monthly limit operators and the company's owners hear it; at 100% that one thing pauses
//    until the 1st. The same for a person's own share (they and their admins hear it)
import { statfsSync } from 'node:fs';
import { join } from 'node:path';
import * as db from './db.ts';
import * as aiplan from './aiplan.ts';
import type { Plan } from '../src/types.ts';
import { mark, msg, phrase, type Msg } from '../src/i18n/index.ts';
import type { Said } from './lang.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS whitelist (workspace_id TEXT PRIMARY KEY, note TEXT, ai_unit TEXT NOT NULL, ai_limit REAL NOT NULL, ses_limit INTEGER NOT NULL, prev_plan TEXT, added_by TEXT NOT NULL, added_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS whitelist_rules (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, ai REAL, storage_gb REAL, ai_on INTEGER NOT NULL DEFAULT 1, notetaker INTEGER NOT NULL DEFAULT 1, boosted INTEGER NOT NULL DEFAULT 1, by TEXT, at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id));
  CREATE TABLE IF NOT EXISTS whitelist_alerts (workspace_id TEXT NOT NULL, month TEXT NOT NULL, meter TEXT NOT NULL, level INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY (workspace_id, month, meter, level));
`);

const now = () => new Date().toISOString();
const monthStart = (at = new Date()) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
const nextMonth = (at = new Date()) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)).toISOString();
const GB = 1024 ** 3;

export type Unit = 'usd' | 'rp';
export interface Entry {
  workspaceId: string;
  note: string;
  aiUnit: Unit;
  aiLimit: number; // per month, in aiUnit
  sesLimit: number; // Boosted emails per month
  prevPlan: Plan | null;
  addedBy: string;
  addedAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}
export interface Rule {
  userId: string;
  ai: number | null; // this person's AI a month, in the company's unit; null: shares the pool
  storageGB: number | null; // this person's storage cap; null: shares the pool
  aiOn: boolean;
  notetaker: boolean;
  boosted: boolean;
}
export type Feature = 'ai' | 'notetaker' | 'boosted';

type Row = { workspace_id: string; note: string | null; ai_unit: string; ai_limit: number; ses_limit: number; prev_plan: string | null; added_by: string; added_at: string; updated_by: string | null; updated_at: string | null };
const entryOf = (r: Row): Entry => ({
  workspaceId: r.workspace_id,
  note: r.note ?? '',
  aiUnit: r.ai_unit === 'rp' ? 'rp' : 'usd',
  aiLimit: r.ai_limit,
  sesLimit: r.ses_limit,
  prevPlan: r.prev_plan ? (JSON.parse(r.prev_plan) as Plan) : null,
  addedBy: r.added_by,
  addedAt: r.added_at,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});
type RuleRow = { user_id: string; ai: number | null; storage_gb: number | null; ai_on: number; notetaker: number; boosted: number };
const ruleOf = (r: RuleRow): Rule => ({ userId: r.user_id, ai: r.ai, storageGB: r.storage_gb, aiOn: !!r.ai_on, notetaker: !!r.notetaker, boosted: !!r.boosted });

/* ---------- the list ---------- */

/** Whether a company is on the Whitelist: its plan says so (the plan is the server's; the app can't set it). */
export const on = (ws: { plan?: { unlimited?: boolean } | null } | undefined | null) => !!ws?.plan?.unlimited;
export const entry = (wsId: string) => {
  const r = db.db.prepare('SELECT * FROM whitelist WHERE workspace_id = ?').get(wsId) as Row | undefined;
  return r ? entryOf(r) : null;
};
export const entries = () => (db.db.prepare('SELECT * FROM whitelist ORDER BY added_at DESC').all() as Row[]).map(entryOf);

/** What a whitelisted company runs on: the top plan with every add-on, billed to nobody. */
export function unlimitedPlan(prev: Plan | undefined | null, name: string): Plan {
  return {
    track: 'ai',
    tier: 'business',
    cycle: 'monthly',
    unlimited: true,
    addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: true },
    billing: prev?.billing ?? { company: name, emails: [] },
    since: now(),
  };
}
/** The plan a company goes back to when it leaves the list: the one it had (Free when it had none). */
export function restoredPlan(e: Entry | null, name: string): Plan {
  if (e?.prevPlan) return { ...e.prevPlan, unlimited: undefined };
  return { track: 'own', tier: 'free', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: name, emails: [] }, since: now() };
}

const clean = (n: unknown, max: number) => Math.max(0, Math.min(max, Number(n) || 0));
/** The limits as an operator typed them: the AI limit in US$ or rupiah, Boosted emails a month. */
export function limitsFrom(b: any): { aiUnit: Unit; aiLimit: number; sesLimit: number } {
  const aiUnit: Unit = b?.aiUnit === 'rp' ? 'rp' : 'usd';
  return { aiUnit, aiLimit: Math.round(clean(b?.aiLimit, aiUnit === 'rp' ? 10_000_000_000 : 1_000_000) * 100) / 100, sesLimit: Math.floor(clean(b?.sesLimit, 100_000_000)) };
}
export function add(wsId: string, prev: Plan | undefined | null, b: any, by: string) {
  const l = limitsFrom(b);
  db.db.prepare('INSERT INTO whitelist (workspace_id, note, ai_unit, ai_limit, ses_limit, prev_plan, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(wsId, String(b?.note ?? '').trim().slice(0, 200), l.aiUnit, l.aiLimit, l.sesLimit, prev ? JSON.stringify(prev) : null, by, now());
  return entry(wsId)!;
}
/** A change of note or limits. A raised (or lowered) limit applies at once, and its alerts count again from there. */
export function update(wsId: string, b: any, by: string) {
  const was = entry(wsId);
  if (!was) return null;
  const l = limitsFrom({ aiUnit: b?.aiUnit ?? was.aiUnit, aiLimit: 'aiLimit' in (b ?? {}) ? b.aiLimit : was.aiLimit, sesLimit: 'sesLimit' in (b ?? {}) ? b.sesLimit : was.sesLimit });
  const note = 'note' in (b ?? {}) ? String(b.note ?? '').trim().slice(0, 200) : was.note;
  db.db.prepare('UPDATE whitelist SET note = ?, ai_unit = ?, ai_limit = ?, ses_limit = ?, updated_by = ?, updated_at = ? WHERE workspace_id = ?').run(note, l.aiUnit, l.aiLimit, l.sesLimit, by, now(), wsId);
  const month = monthStart().slice(0, 7);
  if (l.aiLimit !== was.aiLimit || l.aiUnit !== was.aiUnit) db.db.prepare("DELETE FROM whitelist_alerts WHERE workspace_id = ? AND month = ? AND meter = 'ai'").run(wsId, month);
  if (l.sesLimit !== was.sesLimit) db.db.prepare("DELETE FROM whitelist_alerts WHERE workspace_id = ? AND month = ? AND meter = 'ses'").run(wsId, month);
  // A unit switch keeps people's shares in proportion.
  if (l.aiUnit !== was.aiUnit && was.aiLimit > 0) db.db.prepare('UPDATE whitelist_rules SET ai = ROUND(ai * ?, 2) WHERE workspace_id = ? AND ai IS NOT NULL').run(l.aiLimit / was.aiLimit, wsId);
  return { was, now: entry(wsId)! };
}
export function remove(wsId: string) {
  const was = entry(wsId);
  db.db.prepare('DELETE FROM whitelist WHERE workspace_id = ?').run(wsId);
  db.db.prepare('DELETE FROM whitelist_rules WHERE workspace_id = ?').run(wsId);
  db.db.prepare('DELETE FROM whitelist_alerts WHERE workspace_id = ?').run(wsId);
  return was;
}

/* ---------- what it costs us this month ---------- */

/** AI on our keys this month, in the entry's unit (and both): the company's, or one person's. */
export function aiUsed(wsId: string, unit: Unit, userId?: string) {
  const rows = (
    userId
      ? db.db.prepare("SELECT model, COUNT(*) AS uses, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE workspace_id = ? AND user_id = ? AND provider = 'included' AND at >= ? GROUP BY model").all(wsId, userId, monthStart())
      : db.db.prepare("SELECT model, COUNT(*) AS uses, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE workspace_id = ? AND provider = 'included' AND at >= ? GROUP BY model").all(wsId, monthStart())
  ) as { model: string; uses: number; inTokens: number; outTokens: number }[];
  const c = aiplan.costOf(rows);
  return unit === 'rp' ? c.rp : c.usd;
}
/** Boosted emails this month (each outside recipient of a Boosted send is one). */
export const sesUsed = (wsId: string) => (db.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE workspace_id = ? AND route = 'boosted' AND created_at >= ?").get(wsId, monthStart()) as { n: number }).n;

/* ---------- the server's disk: Drive storage for whitelisted companies ---------- */

const DIR = process.env.S2G_DATA ?? join(process.cwd(), 'data');
/**
 * The disk the data lives on. Outside production a test can stand in for it (S2G_FAKE_DISK="total,free" in bytes),
 * since nobody can fill a real disk in a test.
 */
export function disk(): { total: number; free: number } {
  const fake = process.env.NODE_ENV !== 'production' ? process.env.S2G_FAKE_DISK : undefined;
  if (fake) {
    const [total, free] = fake.split(',').map(Number);
    if (total > 0 && free >= 0) return { total, free };
  }
  try {
    const s = statfsSync(DIR);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return { total: 0, free: 0 };
  }
}
/** Kept free whatever happens: 10% of the disk or 20 GB, whichever is larger. */
export const reserve = (total: number) => Math.max(total * 0.1, 20 * GB);
/** What uploads may still take before the reserve: the room every whitelisted company draws on. */
export function diskRoom() {
  const d = disk();
  return { ...d, reserve: reserve(d.total), room: Math.max(0, d.free - reserve(d.total)) };
}

/* ---------- each person's rules ---------- */

export const rules = (wsId: string) => (db.db.prepare('SELECT * FROM whitelist_rules WHERE workspace_id = ?').all(wsId) as RuleRow[]).map(ruleOf);
export const rule = (wsId: string, userId: string | null | undefined) => {
  if (!userId) return null;
  const r = db.db.prepare('SELECT * FROM whitelist_rules WHERE workspace_id = ? AND user_id = ?').get(wsId, userId) as RuleRow | undefined;
  return r ? ruleOf(r) : null;
};
/** Whether this person may use a feature here: always, unless their company is whitelisted and switched it off for them. */
export function featureOn(ws: any, userId: string | null | undefined, f: Feature) {
  if (!on(ws) || !userId) return true;
  const r = rule(ws.id, userId);
  if (!r) return true;
  return f === 'ai' ? r.aiOn : f === 'notetaker' ? r.notetaker : r.boosted;
}
/** What switching a feature off says to the person who tries it. */
export const featureOff = (f: Feature) =>
  f === 'ai' ? mark('AI is switched off for you here. Ask your admin.') : f === 'notetaker' ? mark('The notetaker is switched off for you here. Ask your admin.') : mark('Boosted sending is switched off for you here. Ask your admin.');

/**
 * Saves the rules owners and admins set (one person at a time or all). They can only split what the company was
 * given: shares of AI add up to at most the AI limit, storage caps to at most the room there is. A rule with nothing
 * set (no share, no cap, everything on) is no rule.
 */
export function saveRules(ws: any, list: any[], by: string, storageTotalBytes: number): { ok: true } | { ok: false; error: Said | string } {
  const e = entry(ws.id);
  if (!e) return { ok: false, error: mark('This company isn’t on Unlimited.') };
  const team = new Set((ws.members ?? []).map((m: any) => m.userId));
  const next = new Map(rules(ws.id).map((r) => [r.userId, r]));
  for (const x of Array.isArray(list) ? list : []) {
    const userId = String(x?.userId ?? '');
    if (!team.has(userId)) return { ok: false, error: mark('That person isn’t on the team.') };
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.round(Number(v) * 100) / 100));
    const r: Rule = { userId, ai: num(x.ai), storageGB: num(x.storageGB), aiOn: x.aiOn !== false, notetaker: x.notetaker !== false, boosted: x.boosted !== false };
    if ([r.ai, r.storageGB].some((v) => v !== null && !Number.isFinite(v))) return { ok: false, error: mark('Use plain numbers.') };
    if (r.ai === null && r.storageGB === null && r.aiOn && r.notetaker && r.boosted) next.delete(userId);
    else next.set(userId, r);
  }
  const all = Array.from(next.values());
  const aiTotal = all.reduce((n, r) => n + (r.ai ?? 0), 0);
  if (aiTotal > e.aiLimit + 1e-9) return { ok: false, error: msg('People’s AI shares add up to {total}, more than the company’s {limit} a month. Lower a share first.', { total: money(aiTotal, e.aiUnit), limit: money(e.aiLimit, e.aiUnit) }) };
  const storageTotal = all.reduce((n, r) => n + (r.storageGB ?? 0), 0);
  if (storageTotal * GB > storageTotalBytes) return { ok: false, error: msg('People’s storage caps add up to {total} GB, more than the {room} GB there is. Lower a cap first.', { total: Math.round(storageTotal), room: Math.floor(storageTotalBytes / GB) }) };
  db.db.prepare('DELETE FROM whitelist_rules WHERE workspace_id = ?').run(ws.id);
  const ins = db.db.prepare('INSERT INTO whitelist_rules (workspace_id, user_id, ai, storage_gb, ai_on, notetaker, boosted, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of all) ins.run(ws.id, r.userId, r.ai, r.storageGB, r.aiOn ? 1 : 0, r.notetaker ? 1 : 0, r.boosted ? 1 : 0, by, now());
  // A share that changed counts its alerts again from there.
  db.db.prepare("DELETE FROM whitelist_alerts WHERE workspace_id = ? AND month = ? AND meter LIKE 'person:%'").run(ws.id, monthStart().slice(0, 7));
  return { ok: true };
}

/** "US$25" or "Rp 400.000". */
export const money = (n: number, unit: Unit) => (unit === 'rp' ? 'Rp ' + Math.round(n).toLocaleString('id-ID') : 'US$' + (Math.round(n * 100) / 100).toLocaleString('en-US'));

/* ---------- the gates: before AI runs, before a Boosted send ---------- */

/** AI on our keys for this company (and person) right now: fine, or used up with the plain message. */
export function aiGate(ws: any, userId?: string | null): { ok: true } | { ok: false; message: string; who: 'company' | 'person' } {
  const e = entry(ws.id);
  if (!e) return { ok: false, message: mark('This month’s AI is used up. Ask your admin.'), who: 'company' };
  if (aiUsed(ws.id, e.aiUnit) >= e.aiLimit) return { ok: false, message: mark('This month’s AI is used up. Ask your admin.'), who: 'company' };
  const r = rule(ws.id, userId);
  if (userId && r?.ai !== null && r?.ai !== undefined && aiUsed(ws.id, e.aiUnit, userId) >= r.ai) return { ok: false, message: mark('Your AI for this month is used up. Ask your admin.'), who: 'person' };
  // People without a share draw on what the shares leave.
  if (userId && (r?.ai === null || r?.ai === undefined)) {
    const shared = rules(ws.id).filter((x) => x.ai !== null);
    if (shared.length) {
      const set = shared.reduce((n, x) => n + (x.ai ?? 0), 0);
      const pool = Math.max(0, e.aiLimit - set);
      const poolUsed = aiUsed(ws.id, e.aiUnit) - shared.reduce((n, x) => n + Math.min(x.ai ?? 0, aiUsed(ws.id, e.aiUnit, x.userId)), 0);
      if (poolUsed >= pool) return { ok: false, message: mark('This month’s AI is used up. Ask your admin.'), who: 'company' };
    }
  }
  return { ok: true };
}
/** Whether a Boosted send of `n` outside emails fits this month's limit (and this person may use Boosted sending). */
export function sesGate(ws: any, n: number, userId?: string | null): { ok: true } | { ok: false; why: 'used-up' | 'off' } {
  if (!featureOn(ws, userId, 'boosted')) return { ok: false, why: 'off' };
  const e = entry(ws.id);
  if (!e || sesUsed(ws.id) + n > e.sesLimit) return { ok: false, why: 'used-up' };
  return { ok: true };
}

/* ---------- alerts: 80% and 100%, once a month per meter ---------- */

export interface Deps {
  notify: (userIds: string[], text: Said, url: string, wsId: string) => void;
  /** The operators' alert channel (the bell and their email), as the hourly alerts use it. */
  operators: (kind: string, text: Said, to: string) => void;
}
let deps: Deps | null = null;
export const init = (d: Deps) => void (deps = d);

const fresh = (wsId: string, meter: string, level: number) => {
  const month = monthStart().slice(0, 7);
  const added = db.db.prepare('INSERT OR IGNORE INTO whitelist_alerts (workspace_id, month, meter, level, at) VALUES (?, ?, ?, ?, ?)').run(wsId, month, meter, level, now()).changes > 0;
  // A jump straight to 100% is one message.
  if (level === 100) db.db.prepare('INSERT OR IGNORE INTO whitelist_alerts (workspace_id, month, meter, level, at) VALUES (?, ?, ?, 80, ?)').run(wsId, month, meter, now());
  return added;
};
const levelOf = (used: number, limit: number) => (limit <= 0 ? 100 : used / limit >= 1 ? 100 : used / limit >= 0.8 ? 80 : 0);

/**
 * After AI ran or a Boosted send went out: the company's meters and the person's share, told once at 80% and once
 * at 100% this month. Operators and the company's owners hear the company's; the person and their admins hear theirs.
 */
export function checkAlerts(ws: any, userId?: string | null, opts: { sesFull?: boolean } = {}) {
  if (!on(ws) || !deps) return;
  const e = entry(ws.id);
  if (!e) return;
  const owners = (ws.members ?? []).filter((m: any) => m.role === 'owner').map((m: any) => m.userId);
  const admins = (ws.members ?? []).filter((m: any) => m.role !== 'member').map((m: any) => m.userId);
  const resets = nextMonth().slice(0, 10);
  const meters: { key: string; used: number; limit: number; what: Msg; url: string }[] = [
    { key: 'ai', used: aiUsed(ws.id, e.aiUnit), limit: e.aiLimit, what: phrase('AI ({limit} a month)', { limit: money(e.aiLimit, e.aiUnit) }), url: '/settings/billing' },
    { key: 'ses', used: sesUsed(ws.id), limit: e.sesLimit, what: phrase('Boosted sending ({limit} emails a month)', { limit: e.sesLimit.toLocaleString('id-ID') }), url: '/settings/billing' },
  ];
  for (const m of meters) {
    // A send that didn't fit what's left counts as the limit reached.
    const level = m.key === 'ses' && opts.sesFull ? 100 : levelOf(m.used, m.limit);
    if (!level || !fresh(ws.id, m.key, level)) continue;
    const forCompany =
      level === 100
        ? m.key === 'ai'
          ? msg('{company}: this month’s {what} is used up, so AI is paused until the 1st. Everything else keeps working.', { company: ws.name, what: m.what })
          : msg('{company}: this month’s {what} is used up, so mail goes out from the sprint2go server until the 1st.', { company: ws.name, what: m.what })
        : msg('{company}: 80% of this month’s {what} is used.', { company: ws.name, what: m.what });
    deps.notify(owners, forCompany, m.url, ws.id);
    deps.operators(`unlimited:${ws.id}:${m.key}:${level}:${resets}`, level === 100 ? msg('Unlimited: {company} used all of this month’s {what}. Raise it on the Whitelist page if it should go on.', { company: ws.name, what: m.what }) : msg('Unlimited: {company} used 80% of this month’s {what}.', { company: ws.name, what: m.what }), '/admin/whitelist');
  }
  // The person's own share.
  const r = rule(ws.id, userId);
  if (userId && r?.ai !== null && r?.ai !== undefined) {
    const level = levelOf(aiUsed(ws.id, e.aiUnit, userId), r.ai);
    if (level && fresh(ws.id, `person:${userId}:ai`, level)) {
      const name = String((db.getDoc('users', userId) as any)?.name ?? '');
      const share = money(r.ai, e.aiUnit);
      deps.notify([userId], level === 100 ? msg('Your AI for this month ({share}) is used up. Ask your admin.', { share }) : msg('80% of your AI for this month ({share}) is used.', { share }), '/settings/billing', ws.id);
      const others = admins.filter((id: string) => id !== userId);
      if (others.length) deps.notify(others, level === 100 ? msg('{name} used all of their AI for this month ({share}).', { name, share }) : msg('{name} used 80% of their AI for this month ({share}).', { name, share }), '/settings/billing', ws.id);
    }
  }
}
/** After an upload: the person's storage cap at 80% and 100% (once a month each), and the disk's reserve for operators. */
export function checkStorage(ws: any, userId: string | null | undefined, usedByPerson: number) {
  if (!on(ws) || !deps) return;
  const r = rule(ws.id, userId);
  if (userId && r?.storageGB) {
    const level = levelOf(usedByPerson, r.storageGB * GB);
    if (level && fresh(ws.id, `person:${userId}:storage`, level)) {
      const name = String((db.getDoc('users', userId) as any)?.name ?? '');
      const cap = `${r.storageGB} GB`;
      deps.notify([userId], level === 100 ? msg('Your storage ({cap}) is full. Ask your admin.', { cap }) : msg('80% of your storage ({cap}) is used.', { cap }), '/settings/storage', ws.id);
      const admins = (ws.members ?? []).filter((m: any) => m.role !== 'member' && m.userId !== userId).map((m: any) => m.userId);
      if (admins.length) deps.notify(admins, level === 100 ? msg('{name}’s storage ({cap}) is full.', { name, cap }) : msg('{name} used 80% of their storage ({cap}).', { name, cap }), '/settings/billing', ws.id);
    }
  }
  diskAlert();
}
/**
 * The disk's reserve reached, or an upload refused because it would eat into it: operators hear it (every 6 hours
 * at most). Uploads to Unlimited companies stop at the reserve.
 */
export function diskAlert(refused = false) {
  const d = diskRoom();
  if ((d.room <= 0 || refused) && deps) deps.operators('unlimited:disk', msg('The disk is close to its safety reserve ({n} GB free): uploads to Unlimited companies are being refused. Free some space or add disk.', { n: Math.round(d.free / GB) }), '/admin/platform');
}
/** The upload refusal when the disk's reserve is reached. */
export const DISK_FULL = mark('The server is nearly full, so uploads are stopped for now. We’ve been told and are making room.');
/** The upload refusal when a person's cap is reached. */
export const personFull = (cap: number) => msg('That’s more than your storage allows ({cap} GB). Ask your admin.', { cap });

/* ---------- what the company sees (Settings, Plan & billing) and operators see ---------- */

/** The two limits, what's used of each, and each person's share and use; for the company's page and the console. */
export function view(ws: any, storage: { used: number; total: number; byPerson: { userId: string; bytes: number }[] }) {
  const e = entry(ws.id);
  if (!e) return null;
  const rs = rules(ws.id);
  const team = (ws.members ?? []).map((m: any) => m.userId);
  const resets = nextMonth();
  const aiUse = aiUsed(ws.id, e.aiUnit);
  const ses = sesUsed(ws.id);
  return {
    aiUnit: e.aiUnit,
    ai: { limit: e.aiLimit, used: aiUse, paused: aiUse >= e.aiLimit },
    ses: { limit: e.sesLimit, used: ses, paused: ses >= e.sesLimit },
    storage: { used: storage.used, total: storage.total, reserveReached: diskRoom().room <= 0 },
    resets,
    people: team.map((userId: string) => {
      const r = rs.find((x) => x.userId === userId);
      return { userId, rule: r ?? null, aiUsed: aiUsed(ws.id, e.aiUnit, userId), storageUsed: storage.byPerson.find((x) => x.userId === userId)?.bytes ?? 0 };
    }),
  };
}

/** Everything an operator page lists: each entry with its company's name and what's used. */
export function consoleRows() {
  const wss = new Map((db.allDocs('workspaces') as any[]).map((w) => [w.id, w]));
  return entries().map((e) => {
    const ws = wss.get(e.workspaceId);
    const owner = (ws?.members ?? []).find((m: any) => m.role === 'owner');
    const o = owner ? (db.getDoc('users', owner.userId) as any) : null;
    const ai = aiUsed(e.workspaceId, e.aiUnit);
    const ses = sesUsed(e.workspaceId);
    return {
      workspaceId: e.workspaceId,
      name: ws?.name ?? '(deleted)',
      color: ws?.color ?? null,
      owner: o ? { name: o.name, email: o.email } : null,
      people: (ws?.members ?? []).length,
      note: e.note,
      aiUnit: e.aiUnit,
      aiLimit: e.aiLimit,
      aiUsed: ai,
      sesLimit: e.sesLimit,
      sesUsed: ses,
      prevPlan: e.prevPlan ? { tier: e.prevPlan.tier, track: e.prevPlan.track } : null,
      addedBy: e.addedBy,
      addedAt: e.addedAt,
      updatedAt: e.updatedAt,
      resets: nextMonth(),
    };
  });
}
