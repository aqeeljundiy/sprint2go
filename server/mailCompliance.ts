// Mail retention, legal hold and data loss rules (Settings, Mail retention & rules; admins only). The company's
// `mailPolicy` is the server's: admins change it through /api/mail/policy, never through a sync, and every change is
// in the mail log (server/mailAudit.ts).
//  - Retention: keep mail forever (the default) or delete conversations whose last message is older than N days, for
//    the whole company or per mailbox. Once a day, after a week's notice from when it was switched on or shortened.
//  - Legal hold: named people whose mailboxes keep everything. Retention skips them, and nobody (they included) can
//    delete their mail for good while the hold is on. Moving to Trash still works; Trash just isn't emptied.
//  - Data loss rules: before an email leaves (the app, a mail app, scheduled mail), its subject, text and attachment
//    names are checked for card numbers (with the Luhn check), Indonesian NIK/KTP numbers (16 digits that read as a
//    real NIK: province code, birth date) or the company's own words. A rule warns (the sender confirms) or blocks.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import * as audit from './mailAudit.ts';

const DAY = 86_400_000;
export const NOTICE_DAYS = 7;

export type DlpKind = 'card' | 'nik' | 'words';
export interface DlpRule {
  id: string;
  name: string;
  kind: DlpKind;
  words?: string; // kind 'words': comma-separated words or phrases, any of which matches
  action: 'warn' | 'block';
  on: boolean;
}
export interface Hold {
  id: string;
  userId: string;
  reason: string;
  by: string;
  at: string;
}
export interface MailPolicy {
  retention?: { days: number; mailboxes?: Record<string, number>; deleteFrom?: string; lastRun?: { at: string; deleted: number } };
  holds?: Hold[];
  dlp?: DlpRule[];
}
type Ws = { id: string; name?: string; domains?: string[]; accounts?: { id: string; email?: string; kind?: string; users?: string[] }[]; members?: { userId: string; role: string }[]; mailPolicy?: MailPolicy };

export const policyOf = (ws: Ws | undefined | null): MailPolicy => (ws?.mailPolicy && typeof ws.mailPolicy === 'object' ? ws.mailPolicy : {});

/* ---------- legal hold ---------- */

/** The people on hold in a company. */
export const heldPeople = (ws: Ws | undefined | null) => new Set((policyOf(ws).holds ?? []).map((h) => h.userId));
/** Whether a mailbox keeps everything: it's the own mailbox of someone on hold. */
export function mailboxHeld(ws: Ws | undefined | null, accountId: string) {
  const held = heldPeople(ws);
  if (!held.size) return false;
  const a = (ws?.accounts ?? []).find((x) => x.id === accountId);
  // Someone's own mailboxes (shared inboxes are the team's, held on their own terms, like Google Groups).
  return !!a && a.kind !== 'shared' && (a.users ?? []).some((u) => held.has(u));
}
/** The company a mailbox belongs to (for checks that only have a thread). */
export function wsOfAccount(accountId: string): Ws | undefined {
  return (db.allDocs('workspaces') as unknown as Ws[]).find((w) => (w.accounts ?? []).some((a) => a.id === accountId));
}
export const threadHeld = (t: { accountId?: string } | undefined) => !!t?.accountId && mailboxHeld(wsOfAccount(t.accountId), t.accountId);
export const HOLD_WORDS = 'This mailbox is on legal hold, so its mail can’t be deleted for good.';

/* ---------- data loss rules ---------- */

/** Digits pass the Luhn check (card numbers). */
export function luhn(digits: string) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}
/** Card numbers: 13 to 19 digits, maybe in groups with spaces or dashes, that pass Luhn and start like a real card. */
export function findCards(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\d])(\d[ -]?){12,18}\d(?![\d])/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !/^[2-6]/.test(digits) || /^(\d)\1+$/.test(digits)) continue;
    if (luhn(digits)) out.push(digits);
  }
  return out;
}
/**
 * NIK (the number on a KTP): 16 digits. Province code 11 to 94, then regency and district, then the birth date
 * (DDMMYY, women add 40 to the day), then a serial that isn't 0000.
 */
export function findNiks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\d])(\d[ .-]?){15}\d(?![\d])/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length !== 16) continue;
    const prov = Number(d.slice(0, 2));
    let day = Number(d.slice(6, 8));
    const month = Number(d.slice(8, 10));
    if (day > 40) day -= 40;
    if (prov < 11 || prov > 94 || day < 1 || day > 31 || month < 1 || month > 12 || d.slice(12) === '0000') continue;
    out.push(d);
  }
  return out;
}
const wordList = (s: string | undefined) =>
  String(s ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2)
    .slice(0, 50);

export interface DlpHit {
  rule: DlpRule;
  found: number;
}
/** The rules an email breaks (on rules only). Card numbers and NIKs are never kept or logged, only how many. */
export function scan(policy: MailPolicy, email: { subject?: string; text?: string; html?: string; files?: { name: string }[] }): DlpHit[] {
  const rules = (policy.dlp ?? []).filter((r) => r.on);
  if (!rules.length) return [];
  const html = String(email.html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const all = [email.subject ?? '', email.text ?? '', html, ...(email.files ?? []).map((f) => f.name)].join('\n');
  const hits: DlpHit[] = [];
  for (const r of rules) {
    const found = r.kind === 'card' ? new Set(findCards(all)).size : r.kind === 'nik' ? new Set(findNiks(all)).size : wordList(r.words).filter((w) => all.toLowerCase().includes(w)).length;
    if (found) hits.push({ rule: r, found });
  }
  return hits;
}
export const blocking = (hits: DlpHit[]) => hits.filter((h) => h.rule.action === 'block');
export const KIND_WORDS: Record<DlpKind, string> = { card: 'card numbers', nik: 'NIK (KTP) numbers', words: 'words the company flags' };

/**
 * Checks an email against the company's rules and logs what it found. `ack`: the sender already confirmed a warning.
 * Returns what to do: send, ask the sender (warn), or refuse (block).
 */
export function checkOutgoing(ws: Ws, accountId: string, actor: string, email: { subject?: string; text?: string; html?: string; files?: { name: string }[] }, ack = false): { ok: true } | { ok: false; action: 'warn' | 'block'; rules: { id: string; name: string; kind: DlpKind }[]; why: string } {
  const hits = scan(policyOf(ws), email);
  if (!hits.length) return { ok: true };
  const block = blocking(hits);
  const names = (list: DlpHit[]) => list.map((h) => ({ id: h.rule.id, name: h.rule.name, kind: h.rule.kind }));
  const summary = (list: DlpHit[]) => list.map((h) => `${h.rule.name} (${h.found})`).join(', ');
  if (block.length) {
    audit.log(ws.id, actor, 'dlp.block', accountId, `Blocked: ${summary(block)}; subject “${String(email.subject ?? '').slice(0, 80)}”`);
    return { ok: false, action: 'block', rules: names(block), why: `This email can’t be sent: it looks like it has ${block.map((h) => KIND_WORDS[h.rule.kind]).filter((x, i, l) => l.indexOf(x) === i).join(' and ')}, which your company doesn’t allow in email (${block.map((h) => h.rule.name).join(', ')}).` };
  }
  if (ack) {
    audit.log(ws.id, actor, 'dlp.warn-sent', accountId, `Sent after a warning: ${summary(hits)}; subject “${String(email.subject ?? '').slice(0, 80)}”`);
    return { ok: true };
  }
  audit.log(ws.id, actor, 'dlp.warn', accountId, `Warned: ${summary(hits)}; subject “${String(email.subject ?? '').slice(0, 80)}”`);
  return { ok: false, action: 'warn', rules: names(hits), why: `This email looks like it has ${hits.map((h) => KIND_WORDS[h.rule.kind]).filter((x, i, l) => l.indexOf(x) === i).join(' and ')}. Check it before it goes.` };
}

/* ---------- saving the policy (admins, through the API) ---------- */

const cleanDays = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 36500) : 0;
};
/**
 * The admins' new policy, cleaned and merged with what the server keeps (when deleting starts, the last run, who put
 * a hold and when). Returns it with the lines for the mail log. `ws` is the company as stored.
 */
export function clean(ws: Ws, asked: any, me: string, now = Date.now()): { policy: MailPolicy; changes: string[]; started?: string } {
  const before = policyOf(ws);
  const changes: string[] = [];
  const members = new Set((ws.members ?? []).map((m) => m.userId));
  const accounts = new Set((ws.accounts ?? []).map((a) => a.id));
  // Retention.
  const days = cleanDays(asked?.retention?.days);
  const boxes: Record<string, number> = {};
  for (const [id, v] of Object.entries(asked?.retention?.mailboxes ?? {})) if (accounts.has(id) && v !== null && v !== undefined && v !== '') boxes[id] = cleanDays(v);
  const had = before.retention;
  const shortest = (r: { days: number; mailboxes?: Record<string, number> } | undefined) => {
    const all = [r?.days ?? 0, ...Object.values(r?.mailboxes ?? {})].filter((n) => n > 0);
    return all.length ? Math.min(...all) : 0;
  };
  const deletes = days > 0 || Object.values(boxes).some((n) => n > 0);
  let deleteFrom = had?.deleteFrom;
  let started: string | undefined;
  if (!deletes) deleteFrom = undefined;
  else if (!had?.deleteFrom || (shortest({ days, mailboxes: boxes }) < shortest(had) && shortest(had) > 0) || shortest(had) === 0) {
    // On, or shorter than before: a week's notice first, nothing is deleted before then.
    deleteFrom = new Date(now + NOTICE_DAYS * DAY).toISOString();
    started = deleteFrom;
  }
  const retention = deletes || days ? { days, mailboxes: Object.keys(boxes).length ? boxes : undefined, deleteFrom, lastRun: had?.lastRun } : undefined;
  if (JSON.stringify([had?.days ?? 0, had?.mailboxes ?? {}]) !== JSON.stringify([days, boxes])) changes.push(`retention: ${days ? `delete after ${days} days` : 'keep forever'}${Object.keys(boxes).length ? `; per mailbox ${Object.entries(boxes).map(([id, n]) => `${(ws.accounts ?? []).find((a) => a.id === id)?.email ?? id}: ${n ? `${n} days` : 'keep'}`).join(', ')}` : ''}`);
  // Legal holds: people in the company; who put one and when stay as they were.
  const holds: Hold[] = [];
  for (const h of Array.isArray(asked?.holds) ? asked.holds.slice(0, 500) : []) {
    const userId = String(h?.userId ?? '');
    if (!members.has(userId) || holds.some((x) => x.userId === userId)) continue;
    const old = (before.holds ?? []).find((x) => x.userId === userId);
    holds.push(old ? { ...old, reason: String(h?.reason ?? old.reason).slice(0, 200) } : { id: randomBytes(6).toString('hex'), userId, reason: String(h?.reason ?? '').slice(0, 200), by: me, at: new Date(now).toISOString() });
  }
  for (const h of holds) if (!(before.holds ?? []).some((x) => x.userId === h.userId)) changes.push(`legal hold on: ${h.userId}${h.reason ? ` (${h.reason})` : ''}`);
  for (const h of before.holds ?? []) if (!holds.some((x) => x.userId === h.userId)) changes.push(`legal hold off: ${h.userId}`);
  // Data loss rules.
  const dlp: DlpRule[] = [];
  for (const r of Array.isArray(asked?.dlp) ? asked.dlp.slice(0, 30) : []) {
    const kind: DlpKind = r?.kind === 'card' || r?.kind === 'nik' || r?.kind === 'words' ? r.kind : 'words';
    const words = kind === 'words' ? wordList(r?.words).join(', ') : undefined;
    if (kind === 'words' && !words) continue;
    dlp.push({ id: typeof r?.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : randomBytes(6).toString('hex'), name: String(r?.name ?? '').trim().slice(0, 80) || KIND_WORDS[kind], kind, ...(words ? { words } : {}), action: r?.action === 'block' ? 'block' : 'warn', on: r?.on !== false });
  }
  if (JSON.stringify(dlp) !== JSON.stringify(before.dlp ?? [])) changes.push(`data loss rules: ${dlp.length ? dlp.map((r) => `${r.name} (${r.kind}, ${r.action}${r.on ? '' : ', off'})`).join('; ') : 'none'}`);
  // (Forwarding outside the company is the filters' company rule, Settings, Mail: one rule for all forwarding.)
  return { policy: { retention, holds: holds.length ? holds : undefined, dlp: dlp.length ? dlp : undefined }, changes, started };
}

/* ---------- retention: the daily run ---------- */

export interface RetentionDeps {
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) => void;
}
const lastAt = (t: any) => (t.messages ?? []).reduce((m: string, x: any) => (typeof x.date === 'string' && x.date > m ? x.date : m), '');

/** Deletes what's due in every company (a mailbox on legal hold keeps everything). `now` can be set for tests. */
export function runRetention(deps: RetentionDeps, now = Date.now()) {
  const out: { workspaceId: string; deleted: number; kept: number }[] = [];
  for (const ws of db.allDocs('workspaces') as any[]) {
    const p = policyOf(ws);
    const r = p.retention;
    if (!r || ws.suspended) continue;
    const dayFor = (accountId: string) => (r.mailboxes && accountId in r.mailboxes ? r.mailboxes[accountId] : r.days) || 0;
    if (!(ws.accounts ?? []).some((a: any) => dayFor(a.id) > 0)) continue;
    if (!r.deleteFrom || now < Date.parse(r.deleteFrom)) continue;
    if (r.lastRun?.at && Date.parse(r.lastRun.at) > now - 20 * 3600_000) continue; // once a day
    const gone: any[] = [];
    let kept = 0;
    for (const a of ws.accounts ?? []) {
      const days = dayFor(a.id);
      if (!days) continue;
      const before = new Date(now - days * DAY).toISOString();
      const old = (db.db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND json_extract(data, '$.accountId') = ?").all(a.id) as { data: string }[]).map((x) => JSON.parse(x.data)).filter((t) => t.location !== 'drafts' && lastAt(t) && lastAt(t) < before);
      if (mailboxHeld(ws, a.id)) {
        kept += old.length;
        continue;
      }
      gone.push(...old);
    }
    for (let i = 0; i < gone.length; i += 500) {
      const part = gone.slice(i, i + 500);
      db.writeDocs('threads', [], part.map((t) => t.id), null);
      deps.broadcast('threads', [], part.map((t) => t.id), undefined, part);
    }
    const fresh = db.getDoc('workspaces', ws.id) as any;
    const next = { ...fresh, mailPolicy: { ...policyOf(fresh), retention: { ...policyOf(fresh).retention!, lastRun: { at: new Date(now).toISOString(), deleted: gone.length } } } };
    db.writeDocs('workspaces', [next], [], null);
    deps.broadcast('workspaces', [next], []);
    audit.log(ws.id, 'system', 'retention.run', null, `${gone.length} conversation${gone.length === 1 ? '' : 's'} deleted${kept ? `; ${kept} kept for people on legal hold` : ''}`);
    out.push({ workspaceId: ws.id, deleted: gone.length, kept });
  }
  return out;
}
