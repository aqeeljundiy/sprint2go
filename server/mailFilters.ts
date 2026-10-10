// Mail labels and filters on the server ("if it's this, it goes there"). Gmail's filters, as a team app needs them:
//  - Every email that arrives runs through here before anyone sees it (mail from outside over SMTP, forwarded copies,
//    mail between teammates, mail a mail app files into the inbox): blocked senders first (their mail goes to Trash),
//    then the company's filters, then the shared inbox's or the person's own, top to bottom, until one says stop.
//    Because the thread is changed before it's saved, the app, push, phone mail apps (IMAP) and AI apps all see the
//    same result.
//  - Labels (`mailLabels`) and filters (`mailFilters`) are synced documents; their write rules are here (who may
//    change what, what a filter may do), called from applySync in index.ts.
//  - Forwarding only to company addresses or to outside addresses that confirmed by email, and only as far as the
//    company allows (Settings, Mail, Filters: "Automatic forwarding").
//  - "Also apply to N matching conversations": the filter's marks (labels, skip inbox, read, star, important, spam,
//    trash, assign) on mail already here, with Undo. Forwarding, answers and tasks never run on old mail.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ParsedMail } from 'mailparser';
import * as db from './db.ts';
import type { Words } from './lang.ts';
import { mark, msg } from '../src/i18n/index.ts';
import { skipReason } from './away.ts';
import { addDays, companyTz, localParts, zonedTime } from '../src/jobTimes.ts';
import { LABEL_COLORS, MAX_FILTERS, MAX_LABELS, cleanLabelName, criteriaEmpty, factsOf, matches, subtree, type FilterActions, type FilterCriteria, type FiledBy, type MailFilterRule, type MailLabel, type MsgFacts } from '../src/mailFilterMatch.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_forward_addrs (account_id TEXT NOT NULL, address TEXT NOT NULL, token TEXT NOT NULL, asked_by TEXT, asked_at TEXT NOT NULL, verified_at TEXT, PRIMARY KEY (account_id, address));
  CREATE TABLE IF NOT EXISTS mail_filter_replies (filter_id TEXT NOT NULL, sender TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (filter_id, sender));
  CREATE TABLE IF NOT EXISTS mail_filter_undo (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
`);

type Doc = db.Doc;
type Person = { name: string; email: string };
type Ws = { id: string; name?: string; timeZone?: string; domains?: string[]; members: { userId: string; role: string }[]; accounts?: Account[]; mailAliases?: { address: string; to: string[] }[]; mailForwarding?: ForwardPolicy };
type Account = { id: string; email: string; name: string; kind: string; users?: string[]; provider?: string };
export type ForwardPolicy = 'off' | 'company' | 'verified';
type Said = Words;

export interface FilterDeps {
  broadcast: (coll: string, upserts: Doc[], deletes: string[], except?: string, deleted?: Doc[]) => void;
  notify: (userIds: string[], workspaceId: string, text: Said, link?: string) => void;
  send: (o: any) => Promise<unknown>;
  sendNote: (to: string, subject: string, text: string, html?: string, fromName?: string) => Promise<boolean>;
  publicUrl: () => string;
  log: (line: string) => void;
}
let deps: FilterDeps | null = null;
export const initFilters = (d: FilterDeps) => void (deps = d);

const now = () => new Date().toISOString();
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const newId = (p: string) => p + randomBytes(6).toString('hex');
const isEmail = (s: string) => /^[^\s@<>()",;]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) && s.length <= 254;
const workspaces = () => db.allDocs('workspaces') as unknown as Ws[];
const wsById = (id: unknown) => (typeof id === 'string' ? (db.getDoc('workspaces', id) as unknown as Ws | undefined) : undefined);
export function accountOf(accountId: unknown): { ws: Ws; account: Account } | null {
  for (const ws of workspaces()) {
    const account = (ws.accounts ?? []).find((a) => a.id === accountId);
    if (account) return { ws, account };
  }
  return null;
}
const isAdmin = (ws: Ws | undefined, userId: string) => !!ws?.members?.some((m) => m.userId === userId && m.role !== 'member');
const isMember = (ws: Ws | undefined, userId: string) => !!ws?.members?.some((m) => m.userId === userId);
const allLabels = () => db.allDocs('mailLabels') as unknown as MailLabel[];
const allFilters = () => db.allDocs('mailFilters') as unknown as MailFilterRule[];
export const labelsOfMailbox = (wsId: string, accountId: string) => allLabels().filter((l) => l.workspaceId === wsId && (l.accountId === null || l.accountId === accountId));

/* ---------- who sees and changes labels and filters ---------- */

/**
 * Who sees a label or filter: the company's (no mailbox) everyone in it; a mailbox's the people who open it; a shared
 * inbox's also the admins (they set its filters).
 */
export function visible(d: any, userId: string): boolean {
  const ws = wsById(d?.workspaceId);
  if (!ws || !isMember(ws, userId)) return false;
  if (d.accountId == null) return true;
  const account = (ws.accounts ?? []).find((a) => a.id === d.accountId);
  if (!account) return false;
  return (account.users ?? []).includes(userId) || (account.kind === 'shared' && isAdmin(ws, userId));
}

/** May this person change it? Company labels and filters, and a shared inbox's filters: admins. The rest: its people. */
function mayChange(coll: 'mailLabels' | 'mailFilters', d: { workspaceId?: unknown; accountId?: unknown }, userId: string): { ok: true; ws: Ws; account: Account | null } | { ok: false; why: string } {
  const ws = wsById(d.workspaceId);
  if (!ws || !isMember(ws, userId)) return { ok: false, why: mark('Not your company.') };
  if (d.accountId == null) return isAdmin(ws, userId) ? { ok: true, ws, account: null } : { ok: false, why: coll === 'mailLabels' ? mark('Only admins can change company labels.') : mark('Only admins can change company filters.') };
  const account = (ws.accounts ?? []).find((a) => a.id === d.accountId);
  if (!account) return { ok: false, why: mark('That mailbox isn’t here any more.') };
  const on = (account.users ?? []).includes(userId);
  // A shared inbox's labels are its team's; its filters are set by admins (everyone's mail runs through them).
  if (coll === 'mailFilters' && account.kind === 'shared') return isAdmin(ws, userId) ? { ok: true, ws, account } : { ok: false, why: mark('Only admins can change a shared inbox’s filters.') };
  return on ? { ok: true, ws, account } : { ok: false, why: mark('Not your mailbox.') };
}

/** The rules for saving a label. Returns what's stored, or null (with why). */
export function guardLabel(d: Doc, before: any, me: string, say: (w: Said) => void, batch: Doc[] = []): Doc | null {
  const asked = d as any;
  if (before && (asked.workspaceId !== before.workspaceId || (asked.accountId ?? null) !== (before.accountId ?? null))) return null; // a label stays in its mailbox
  const can = mayChange('mailLabels', before ?? asked, me);
  if (!can.ok) return (say(can.why), null);
  const accountId = (before ?? asked).accountId ?? null;
  const name = cleanLabelName(asked.name);
  if (!name) return (say(mark('Give the label a name.')), null);
  // Labels saved together (a label and the one it's nested in) count as there.
  const all = [...allLabels().filter((l) => !batch.some((b) => b.id === l.id)), ...(batch as unknown as MailLabel[]).filter((b) => b && typeof b.id === 'string')];
  const mine = all.filter((l) => l.workspaceId === can.ws.id && (l.accountId ?? null) === accountId);
  if (!before && mine.length >= MAX_LABELS) return (say(mark('That’s as many labels as one mailbox can have (500).')), null);
  // Nested under a label of the same mailbox (or both the company's), never under itself or its own sub-labels.
  let parentId: string | null = typeof asked.parentId === 'string' ? asked.parentId : null;
  if (parentId) {
    const parent = all.find((l) => l.id === parentId);
    if (!parent || parent.workspaceId !== can.ws.id || (parent.accountId ?? null) !== accountId || subtree(d.id, all).includes(parentId)) parentId = before?.parentId ?? null;
  }
  if (mine.some((l) => l.id !== d.id && (l.parentId ?? null) === parentId && l.name.toLowerCase() === name.toLowerCase())) return (say(mark('There’s already a label with that name there.')), null);
  const color = typeof asked.color === 'string' && /^#[0-9a-f]{6}$/i.test(asked.color) ? asked.color : before?.color ?? LABEL_COLORS[8];
  const show = asked.show === 'unread' || asked.show === 'hide' ? asked.show : 'show';
  return { id: d.id, workspaceId: can.ws.id, accountId, name, parentId, color, show, order: Number.isFinite(asked.order) ? Number(asked.order) : before?.order ?? Date.now(), createdBy: before?.createdBy ?? me, createdAt: before?.createdAt ?? now() };
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : '');
function cleanCriteria(c: any): FilterCriteria {
  const out: FilterCriteria = {};
  for (const k of ['from', 'to', 'subject', 'hasWords', 'notWords', 'attachment', 'list', 'deliveredTo'] as const) {
    const v = str(c?.[k]);
    if (v) out[k] = v;
  }
  const mb = Number(c?.size?.mb);
  if (Number.isFinite(mb) && mb > 0) out.size = { op: c.size.op === 'smaller' ? 'smaller' : 'larger', mb: Math.min(mb, 10_000) };
  if (c?.hasAttachment === true) out.hasAttachment = true;
  return out;
}

/** The company's addresses: its mailboxes, its aliases and anything at its own domains. */
export function companyAddress(ws: Ws, address: string) {
  const a = lower(address);
  const domain = a.split('@')[1] ?? '';
  return (ws.accounts ?? []).some((x) => lower(x.email) === a) || (ws.mailAliases ?? []).some((x) => lower(x.address) === a) || (ws.domains ?? []).some((d) => lower(d) === domain);
}
export const forwardPolicy = (ws: Ws | undefined): ForwardPolicy => (ws?.mailForwarding === 'off' || ws?.mailForwarding === 'company' ? ws.mailForwarding : 'verified');
const verifiedFor = (accountId: string, address: string) => !!(db.db.prepare('SELECT verified_at FROM mail_forward_addrs WHERE account_id = ? AND address = ?').get(accountId, lower(address)) as { verified_at: string | null } | undefined)?.verified_at;
/** Why this mailbox can't forward to this address now, or null when it can. A company filter forwards from each mailbox. */
export function forwardWhy(ws: Ws, accountId: string | null, address: string): string | null {
  const a = lower(address);
  if (!isEmail(a)) return mark('That isn’t an email address.');
  const policy = forwardPolicy(ws);
  if (policy === 'off') return mark('Your company has automatic forwarding switched off.');
  if (companyAddress(ws, a)) return null;
  if (policy === 'company') return mark('Your company only allows forwarding to its own addresses.');
  if (!accountId) return mark('Company filters forward only to the company’s own addresses.');
  return verifiedFor(accountId, a) ? null : mark('That address hasn’t confirmed yet. Add it under Forwarding addresses and open the link it gets.');
}

/** The rules for saving a filter. */
export function guardFilter(d: Doc, before: any, me: string, say: (w: Said) => void): Doc | null {
  const asked = d as any;
  if (before && (asked.workspaceId !== before.workspaceId || (asked.accountId ?? null) !== (before.accountId ?? null))) return null;
  const can = mayChange('mailFilters', before ?? asked, me);
  if (!can.ok) return (say(can.why), null);
  const accountId = can.account?.id ?? null;
  const criteria = cleanCriteria(asked.criteria);
  if (criteriaEmpty(criteria)) return (say(mark('A filter needs at least one thing to look for.')), null);
  if (!before && allFilters().filter((f) => f.workspaceId === can.ws.id && (f.accountId ?? null) === accountId).length >= MAX_FILTERS) return (say(mark('That’s as many filters as one mailbox can have (500).')), null);
  const a = asked.actions ?? {};
  const actions: FilterActions = {};
  // Labels of this mailbox (a company filter: the company's own labels, which every mailbox has).
  const labels = allLabels().filter((l) => l.workspaceId === can.ws.id && (l.accountId === null || (accountId && l.accountId === accountId)));
  if (Array.isArray(a.labels)) {
    const ok = a.labels.filter((id: unknown) => typeof id === 'string' && labels.some((l) => l.id === id)).slice(0, 50);
    if (ok.length < a.labels.length) say(mark('A label the filter applied isn’t in this mailbox, so it was left out.'));
    if (ok.length) actions.labels = [...new Set(ok)] as string[];
  }
  for (const k of ['archive', 'read', 'star', 'neverSpam', 'spam', 'trash'] as const) if (a[k] === true) actions[k] = true;
  if (actions.neverSpam && actions.spam) delete actions.spam;
  if (a.important === 'yes' || a.important === 'no') actions.important = a.important;
  if (typeof a.forward === 'string' && a.forward.trim()) {
    const why = forwardWhy(can.ws, accountId, a.forward);
    if (why) say(why);
    else actions.forward = lower(a.forward);
  }
  if (typeof a.assign === 'string' && a.assign) {
    if (can.account?.kind === 'shared' && (can.account.users ?? []).includes(a.assign)) actions.assign = a.assign;
    else say(mark('Only a shared inbox’s filters can assign, and only to people on it.'));
  }
  if (a.task && typeof a.task === 'object') {
    const assignee = typeof a.task.assignee === 'string' && isMember(can.ws, a.task.assignee) ? a.task.assignee : undefined;
    const due = Number(a.task.dueDays);
    actions.task = { ...(assignee ? { assignee } : {}), ...(Number.isInteger(due) && due >= 0 && due <= 365 ? { dueDays: due } : {}) };
  }
  if (a.reply && typeof a.reply === 'object' && str(a.reply.text, 5000)) actions.reply = { name: str(a.reply.name, 80) || mark('Template'), text: str(a.reply.text, 5000) };
  const snooze = Number(a.snoozeDays);
  if (Number.isInteger(snooze) && snooze >= 1 && snooze <= 60) actions.snoozeDays = snooze;
  if (!Object.keys(actions).length) return (say(mark('Choose at least one thing for the filter to do.')), null);
  return {
    id: d.id,
    workspaceId: can.ws.id,
    accountId,
    name: str(asked.name, 120) || undefined,
    enabled: asked.enabled !== false,
    order: Number.isFinite(asked.order) ? Number(asked.order) : before?.order ?? Date.now(),
    criteria,
    actions,
    stop: asked.stop === true || undefined,
    createdBy: before?.createdBy ?? me,
    createdAt: before?.createdAt ?? now(),
    updatedAt: now(),
    hits: before?.hits ?? 0,
    lastHitAt: before?.lastHitAt,
    // A saved edit clears what went wrong before (it's checked again on the next email).
    problem: JSON.stringify(before?.actions ?? null) === JSON.stringify(actions) && before?.enabled === (asked.enabled !== false) ? before?.problem : undefined,
  } as Doc;
}

/** Deleting: the same people who may change it. */
export function mayDelete(coll: string, before: any, me: string): boolean {
  if (coll !== 'mailLabels' && coll !== 'mailFilters') return true;
  return mayChange(coll, before, me).ok;
}

/**
 * Threads: labels added must be this mailbox's or the company's (others are dropped); what a filter did (`filed`) is
 * the server's.
 */
export function guardThread(d: Doc, before: any): Doc {
  const t = d as any;
  const had: string[] = Array.isArray(before?.labels) ? before.labels : [];
  const asked: string[] = Array.isArray(t.labels) ? t.labels.filter((x: unknown) => typeof x === 'string') : [];
  const added = asked.filter((x) => !had.includes(x));
  let labels = asked;
  if (added.length) {
    const hit = accountOf(t.accountId);
    const ok = new Set(hit ? labelsOfMailbox(hit.ws.id, hit.account.id).map((l) => l.id) : []);
    labels = asked.filter((x) => had.includes(x) || ok.has(x));
  }
  const out: any = { ...t, labels: [...new Set(labels)] };
  if (before?.filed) out.filed = before.filed;
  else delete out.filed;
  if (out.important !== undefined && typeof out.important !== 'boolean') delete out.important;
  return out as Doc;
}

/**
 * After labels are deleted: their sub-labels go too, the mail keeps everything but the label, and filters that applied
 * them say so ("needs attention").
 */
export function afterLabelWrite(deleted: Doc[], by: string | null) {
  if (!deleted.length) return;
  const all = allLabels();
  const gone = new Set<string>();
  for (const d of deleted) for (const id of subtree(d.id, [...all, d as unknown as MailLabel])) gone.add(id);
  const kids = all.filter((l) => gone.has(l.id));
  if (kids.length) {
    db.writeDocs('mailLabels', [], kids.map((l) => l.id), by);
    deps?.broadcast('mailLabels', [], kids.map((l) => l.id), undefined, kids as unknown as Doc[]);
  }
  const threads = (db.allDocs('threads') as any[]).filter((t) => (t.labels ?? []).some((l: string) => gone.has(l)));
  const changed = threads.map((t) => ({ ...t, labels: t.labels.filter((l: string) => !gone.has(l)) }));
  if (changed.length) {
    db.writeDocs('threads', changed, [], by);
    deps?.broadcast('threads', changed, []);
  }
  const filters = allFilters()
    .filter((f) => f.actions?.labels?.some((l) => gone.has(l)))
    .map((f) => {
      const labels = f.actions.labels!.filter((l) => !gone.has(l));
      return { ...f, actions: { ...f.actions, labels: labels.length ? labels : undefined }, problem: mark('A label it applied was deleted.') };
    });
  if (filters.length) {
    db.writeDocs('mailFilters', filters as unknown as Doc[], [], by);
    deps?.broadcast('mailFilters', filters as unknown as Doc[], []);
  }
}

/* ---------- running on arriving mail ---------- */

export interface Arrival {
  ws: Ws;
  account: Account;
  spam: boolean; // the server's verdict (SPF and DMARC)
  parsed?: ParsedMail; // the email as it came (for answers' robot checks and loop checks)
  envelopeFrom?: string;
  mid?: string;
  refs?: string[];
  listId?: string;
  deliveredTo?: string[];
  size?: number;
  importing?: boolean; // moved in from elsewhere (a mail app's APPEND): marks only, nothing forwarded, answered or made
}

const blockRules = (userId: string): { kind: string; value: string }[] => {
  const v = ((db.getDoc('prefs', userId) as any)?.value ?? {})[`pm-blocked:${userId}`];
  return Array.isArray(v) ? v : [];
};
/** Someone on a personal mailbox blocked this sender (Mail, Block): their mail goes straight to Trash. */
export function blockedFor(account: Account, email: string): boolean {
  if (account.kind === 'shared') return false; // one person's block doesn't throw away the team's mail
  const e = lower(email);
  return (account.users ?? []).some((u) => blockRules(u).some((b) => (b?.kind === 'address' ? lower(b.value) === e : typeof b?.value === 'string' && e.endsWith('@' + lower(b.value)))));
}

/** The filters that run for a mailbox, in order: the company's first, then the mailbox's own (a shared inbox's). */
export function filtersFor(wsId: string, accountId: string): MailFilterRule[] {
  const list = allFilters().filter((f) => f.enabled !== false && f.workspaceId === wsId && (f.accountId === null || f.accountId === accountId));
  return list.sort((a, b) => Number(a.accountId !== null) - Number(b.accountId !== null) || (a.order ?? 0) - (b.order ?? 0));
}

const header = (parsed: ParsedMail | undefined, key: string) => {
  const v = parsed?.headers.get(key);
  return v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.join(',') : typeof v === 'object' && 'value' in (v as object) ? String((v as { value: unknown }).value) : String(v);
};
/** The List-Id of an arriving email ("Acme News <news.acme.com>"). */
export function listIdOf(parsed: ParsedMail): string | undefined {
  const line = parsed.headerLines.find((h) => h.key === 'list-id')?.line;
  const id = line ? line.replace(/^list-id:\s*/i, '').trim() : String((parsed.headers.get('list') as any)?.id?.id ?? '');
  return id || undefined;
}

/** A morning N days from now, in the company's time zone. */
function morningIn(ws: Ws, days: number) {
  const tz = companyTz(ws);
  return new Date(zonedTime(addDays(localParts(Date.now(), tz).day, days), 8, tz)).toISOString();
}
const scopeOf = (f: MailFilterRule, account: Account): FiledBy['scope'] => (f.accountId === null ? 'company' : account.kind === 'shared' ? 'shared' : 'mine');

/** What the filters decided for one email: the thread changed, and what's left to do once it's saved. */
export function onArrival(thread: any, m: any, ctx: Arrival): { thread: any; after: () => void } {
  const facts: MsgFacts = factsOf(thread.subject ?? '', m, { listId: ctx.listId ?? factsOf('', m).listId, deliveredTo: ctx.deliveredTo, ...(ctx.size ? { size: ctx.size } : {}) });
  const own = lower(m.from?.email) === lower(ctx.account.email);
  const at = now();
  let t = { ...thread, labels: [...(thread.labels ?? [])] };
  const filed: FiledBy[] = [];
  // A blocked sender: Trash, and nothing else runs.
  if (!own && blockedFor(ctx.account, m.from?.email ?? '')) {
    t.location = 'trash';
    t.trashedAt = at;
    t.unread = false;
    filed.push({ filterId: 'block', name: lower(m.from?.email), scope: 'block', at, messageId: m.id });
    t.filed = [...(t.filed ?? []), ...filed].slice(-10);
    return { thread: t, after: () => {} };
  }
  if (own) return { thread: t, after: () => {} }; // our own mail in this mailbox (a sent copy) isn't filtered
  const hits: MailFilterRule[] = [];
  const todo: (() => void)[] = [];
  let place: 'trash' | 'spam' | null = null;
  let archive = false;
  let neverSpam = false;
  const valid = new Set(labelsOfMailbox(ctx.ws.id, ctx.account.id).map((l) => l.id));
  for (const f of filtersFor(ctx.ws.id, ctx.account.id)) {
    if (!matches(f.criteria, facts)) continue;
    const a = f.actions ?? {};
    hits.push(f);
    filed.push({ filterId: f.id, name: f.name || describe(f), scope: scopeOf(f, ctx.account), at, messageId: m.id });
    for (const l of a.labels ?? []) if (valid.has(l) && !t.labels.includes(l)) t.labels.push(l);
    if (a.read) t.unread = false;
    if (a.star) t.starred = true;
    if (a.important) t.important = a.important === 'yes';
    if (a.neverSpam) neverSpam = true;
    if (a.trash) place = 'trash';
    else if (a.spam && place !== 'trash') place = 'spam';
    if (a.archive) archive = true;
    if (a.assign && ctx.account.kind === 'shared' && (ctx.account.users ?? []).includes(a.assign)) {
      t.assignee = a.assign;
      t.assignedBy = f.createdBy;
    }
    if (a.snoozeDays) t.snoozedUntil = morningIn(ctx.ws, a.snoozeDays);
    todo.push(() => sideEffects(f, a, t, m, ctx));
    if (f.stop) break;
  }
  // Where it goes: the strongest wins (Trash, then Spam, then skipping the inbox). Never send to Spam beats the
  // server's verdict and a filter's Spam.
  const verdict = ctx.spam || t.location === 'spam';
  if (place === 'trash') t.location = 'trash';
  else if (place === 'spam' && !neverSpam) t.location = 'spam';
  else if (verdict && neverSpam) t.location = archive ? 'archive' : 'inbox';
  else if (archive && t.location === 'inbox') t.location = 'archive';
  // Spam and Trash keep 30 days from when mail went there (server/mailSmart.ts).
  if (t.location === 'spam' && thread.location !== 'spam') t.spamAt = at;
  if (t.location === 'trash' && thread.location !== 'trash') t.trashedAt = at;
  if (t.location !== 'spam') delete t.spamAt;
  if (filed.length) t.filed = [...(t.filed ?? []), ...filed].slice(-10);
  const spamNow = t.location === 'spam' || t.location === 'trash';
  return {
    thread: t,
    after: () => {
      if (!hits.length) return;
      const stamp = now();
      const counted = hits.map((f) => ({ ...(db.getDoc('mailFilters', f.id) ?? f), hits: ((db.getDoc('mailFilters', f.id) as any)?.hits ?? f.hits ?? 0) + 1, lastHitAt: stamp })) as Doc[];
      db.writeDocs('mailFilters', counted, [], null);
      deps?.broadcast('mailFilters', counted, []);
      // Forwarding, answers and tasks never for spam, mail sent to Trash, or mail moved in from elsewhere.
      if (!spamNow && !ctx.importing) for (const fn of todo) fn();
    },
  };
}

/** A filter's name in plain words when it has none ("From @dokploy.com"). */
export function describe(f: Pick<MailFilterRule, 'criteria'>): string {
  const c = f.criteria ?? {};
  return c.from ? `From ${c.from}` : c.to ? `To ${c.to}` : c.subject ? `Subject ${c.subject}` : c.list ? `List ${c.list}` : c.hasWords ? `Has ${c.hasWords}` : c.deliveredTo ? `Sent to ${c.deliveredTo}` : c.attachment ? `Files ${c.attachment}` : c.hasAttachment ? 'Has attachment' : 'Filter';
}

/** Forward, answer, make a task: after the email is saved. A failure turns into the filter's problem, never a lost email. */
function sideEffects(f: MailFilterRule, a: FilterActions, t: any, m: any, ctx: Arrival) {
  if (!deps) return;
  const problem = (why: string) => {
    const cur = db.getDoc('mailFilters', f.id) as any;
    if (!cur || cur.problem === why) return;
    const next = { ...cur, problem: why };
    db.writeDocs('mailFilters', [next], [], null);
    deps!.broadcast('mailFilters', [next], []);
  };
  const auto = lower(header(ctx.parsed, 'auto-submitted'));
  const looped = !!header(ctx.parsed, 'x-s2g-forwarded') || (auto && auto !== 'no');
  if (a.forward) {
    // Checked again now: the company's rule or the confirmation may have changed since the filter was saved.
    const why = forwardWhy(ctx.ws, f.accountId === null ? null : ctx.account.id, a.forward);
    const to = lower(a.forward);
    if (why) problem(why);
    else if (!looped && to !== lower(ctx.account.email) && to !== lower(m.from?.email)) {
      const lines = [`---------- Forwarded message ----------`, `From: ${m.from?.name ? `${m.from.name} <${m.from.email}>` : m.from?.email}`, `Date: ${m.date}`, `Subject: ${t.subject}`, `To: ${(m.to ?? []).map((p: Person) => p.email).join(', ')}`, '', m.body ?? ''];
      void deps
        .send({
          workspaceId: ctx.ws.id,
          accountId: ctx.account.id,
          threadId: '',
          messageId: 'fwd-' + randomBytes(6).toString('hex'),
          from: { name: ctx.account.name, email: lower(ctx.account.email) },
          to: [{ name: '', email: to }],
          cc: [],
          subject: t.subject,
          text: lines.join('\n'),
          html: m.html ? `<p style="color:#666">---------- Forwarded message ----------<br>From: ${escHtml(m.from?.name ?? '')} &lt;${escHtml(m.from?.email ?? '')}&gt;<br>Subject: ${escHtml(t.subject)}</p>${m.html}` : undefined,
          files: (m.attachments ?? []).filter((x: any) => typeof x.url === 'string').map((x: any) => ({ name: x.name, url: x.url })),
          headers: { 'X-S2G-Forwarded': lower(ctx.account.email), 'Reply-To': m.from?.email ?? '' },
        })
        .catch((e) => (deps!.log(`[filters] forward for ${ctx.account.email} not sent: ${e instanceof Error ? e.message : e}`), problem(mark('Forwarding failed. Check the address and the mailbox’s sending.'))));
    }
  }
  if (a.reply && ctx.parsed && ctx.envelopeFrom) {
    const sender = lower(ctx.envelopeFrom);
    const skip = skipReason(ctx.parsed, sender, lower(ctx.account.email), false);
    const last = db.db.prepare('SELECT at FROM mail_filter_replies WHERE filter_id = ? AND sender = ?').get(f.id, sender) as { at: string } | undefined;
    if (!skip && !(last && Date.parse(last.at) > Date.now() - 4 * 86_400_000)) {
      db.db.prepare('INSERT OR REPLACE INTO mail_filter_replies (filter_id, sender, at) VALUES (?, ?, ?)').run(f.id, sender, now());
      void deps
        .send({
          workspaceId: ctx.ws.id,
          accountId: ctx.account.id,
          threadId: '',
          messageId: 'auto-' + randomBytes(6).toString('hex'),
          from: { name: ctx.account.name, email: lower(ctx.account.email) },
          to: [{ name: m.from?.name ?? '', email: sender }],
          cc: [],
          subject: /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`,
          text: a.reply.text,
          files: [],
          inReplyTo: ctx.mid,
          references: [...(ctx.refs ?? []), ...(ctx.mid ? [ctx.mid] : [])].slice(-20),
          headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
        })
        .catch((e) => deps!.log(`[filters] answer for ${ctx.account.email} not sent: ${e instanceof Error ? e.message : e}`));
    }
  }
  if (a.task) {
    const doer = a.task.assignee ?? f.createdBy ?? '';
    const at = now();
    const due = a.task.dueDays != null ? addDays(localParts(Date.now(), companyTz(ctx.ws)).day, a.task.dueDays) : undefined;
    const task = {
      id: newId('tk-'),
      title: String(t.subject || '(no subject)').slice(0, 200),
      done: false,
      status: 'todo',
      priority: t.important ? 'high' : 'normal',
      threadId: t.id,
      source: 'manual',
      userId: doer,
      assignees: doer ? [doer] : [],
      workspaceId: ctx.ws.id,
      createdBy: f.createdBy,
      createdAt: at,
      ...(due ? { due } : {}),
      notes: `${m.from?.name || m.from?.email}: ${String(m.body ?? '').slice(0, 600)}`,
      history: [{ id: randomBytes(6).toString('hex'), at, by: f.createdBy ?? '', kind: 'created', text: `created this from an email, by the filter “${f.name || describe(f)}”` }],
    };
    db.writeDocs('todos', [task as unknown as Doc], [], null);
    deps.broadcast('todos', [task as unknown as Doc], []);
    if (doer && doer !== f.createdBy) deps.notify([doer], ctx.ws.id, msg('New task from an email: {task}', { task: task.title }));
  }
  if (a.assign && t.assignee === a.assign && a.assign !== f.createdBy) deps.notify([a.assign], ctx.ws.id, msg('{subject} was assigned to you by a filter', { subject: String(t.subject).slice(0, 120) }));
}
const escHtml = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/* ---------- applying to mail already here ---------- */

/** The conversations of these mailboxes that a filter matches (any message in them from someone else). */
export function matching(criteria: FilterCriteria, accountIds: Set<string>, wsId: string): any[] {
  const own = new Map<string, string>();
  for (const w of workspaces()) for (const a of w.accounts ?? []) own.set(a.id, lower(a.email));
  return (db.allDocs('threads') as any[]).filter(
    (t) =>
      accountIds.has(t.accountId) &&
      (t.workspaceId ?? wsId) === wsId &&
      t.location !== 'drafts' &&
      (t.messages ?? []).some((m: any) => m?.from && lower(m.from.email) !== own.get(t.accountId) && matches(criteria, factsOf(t.subject ?? '', m))),
  );
}
const MARKS = ['labels', 'location', 'unread', 'starred', 'important', 'assignee', 'assignedBy'] as const;
/** The filter's marks on one conversation already here (no forwarding, answers, tasks or snoozes). */
function markExisting(t: any, f: MailFilterRule, account: Account | undefined, valid: Set<string>) {
  const a = f.actions ?? {};
  const n = { ...t, labels: [...(t.labels ?? [])] };
  for (const l of a.labels ?? []) if (valid.has(l) && !n.labels.includes(l)) n.labels.push(l);
  if (a.read) n.unread = false;
  if (a.star) n.starred = true;
  if (a.important) n.important = a.important === 'yes';
  if (a.trash) n.location = 'trash';
  else if (a.spam && !a.neverSpam) n.location = 'spam';
  else if (a.neverSpam && n.location === 'spam') n.location = a.archive ? 'archive' : 'inbox';
  else if (a.archive && n.location === 'inbox') n.location = 'archive';
  if (a.assign && account?.kind === 'shared' && (account.users ?? []).includes(a.assign)) (n.assignee = a.assign), (n.assignedBy = f.createdBy);
  return MARKS.some((k) => JSON.stringify(n[k]) !== JSON.stringify(t[k])) ? n : null;
}

/* ---------- the API ---------- */

type Api = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  me: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: (req: IncomingMessage) => Promise<any>;
  seesThread: (t: any) => boolean;
};

/** /api/mail/filters/… and /api/mail/forwarding/…: previews, applying to existing mail, Undo, forwarding addresses. */
export async function handleApi(p: string, x: Api): Promise<boolean> {
  const { req, res, me, json } = x;
  if (p === '/api/mail/filters/preview' && req.method === 'POST') {
    // "N emails match": the conversations this person can see that the criteria fit (for a company filter, every
    // mailbox of theirs in the company).
    const b = await x.body(req);
    const ws = wsById(b.workspaceId);
    if (!ws || !isMember(ws, me)) return (json(res, 403, { error: mark('Not your company.') }), true);
    const criteria = cleanCriteria(b.criteria);
    if (criteriaEmpty(criteria)) return (json(res, 200, { count: 0, sample: [] }), true);
    const ids = new Set((ws.accounts ?? []).filter((a) => (b.accountId ? a.id === b.accountId : true) && (a.users ?? []).includes(me)).map((a) => a.id));
    const list = matching(criteria, ids, ws.id)
      .filter(x.seesThread)
      .sort((a, c) => String(c.messages.at(-1)?.date ?? '').localeCompare(String(a.messages.at(-1)?.date ?? '')));
    json(res, 200, { count: list.length, sample: list.slice(0, 5).map((t) => ({ id: t.id, subject: t.subject, from: t.messages.at(-1)?.from, date: t.messages.at(-1)?.date })) });
    return true;
  }
  if (p === '/api/mail/filters/apply' && req.method === 'POST') {
    const b = await x.body(req);
    const f = db.getDoc('mailFilters', String(b.id ?? '')) as unknown as MailFilterRule | undefined;
    if (!f || !visible(f, me)) return (json(res, 404, { error: mark('That filter isn’t there any more.') }), true);
    const can = mayChange('mailFilters', f, me);
    if (!can.ok) return (json(res, 403, { error: can.why }), true);
    const accounts = (can.ws.accounts ?? []).filter((a) => (f.accountId ? a.id === f.accountId : true));
    const before: any[] = [];
    const after: any[] = [];
    for (const t of matching(f.criteria, new Set(accounts.map((a) => a.id)), can.ws.id)) {
      const account = accounts.find((a) => a.id === t.accountId);
      const n = markExisting(t, f, account, new Set(labelsOfMailbox(can.ws.id, t.accountId).map((l) => l.id)));
      if (!n) continue;
      before.push(Object.fromEntries([['id', t.id], ...MARKS.map((k) => [k, t[k] ?? null])]));
      after.push({ ...n, filed: [...(t.filed ?? []), { filterId: f.id, name: f.name || describe(f), scope: account ? scopeOf(f, account) : 'company', at: now() }].slice(-10) });
    }
    if (after.length) {
      db.writeDocs('threads', after, [], me);
      deps?.broadcast('threads', after, []);
    }
    const undo = newId('u-');
    db.db.prepare('INSERT INTO mail_filter_undo (id, user_id, data, at) VALUES (?, ?, ?, ?)').run(undo, me, JSON.stringify(before), now());
    db.db.prepare('DELETE FROM mail_filter_undo WHERE at < ?').run(new Date(Date.now() - 86_400_000).toISOString());
    json(res, 200, { changed: after.length, undo: after.length ? undo : null });
    return true;
  }
  if (p === '/api/mail/filters/undo' && req.method === 'POST') {
    // Puts back exactly what applying changed, on the conversations that are still there.
    const b = await x.body(req);
    const row = db.db.prepare('SELECT data FROM mail_filter_undo WHERE id = ? AND user_id = ?').get(String(b.undo ?? ''), me) as { data: string } | undefined;
    if (!row) return (json(res, 404, { error: mark('That can’t be undone any more.') }), true);
    const back = (JSON.parse(row.data) as any[])
      .map((was) => {
        const t = db.getDoc('threads', was.id) as any;
        if (!t) return null;
        const n = { ...t };
        for (const k of MARKS) {
          if (was[k] === null) delete n[k];
          else n[k] = was[k];
        }
        return n;
      })
      .filter(Boolean) as Doc[];
    db.db.prepare('DELETE FROM mail_filter_undo WHERE id = ?').run(String(b.undo));
    if (back.length) {
      db.writeDocs('threads', back, [], me);
      deps?.broadcast('threads', back, []);
    }
    json(res, 200, { restored: back.length });
    return true;
  }
  if (p === '/api/mail/forwarding' && req.method === 'GET') {
    const hit = accountOf(x.url.searchParams.get('accountId'));
    if (!hit || !(hit.account.users ?? []).includes(me)) return (json(res, 403, { error: mark('Not your mailbox.') }), true);
    const rows = db.db.prepare('SELECT address, verified_at FROM mail_forward_addrs WHERE account_id = ? ORDER BY asked_at').all(hit.account.id) as { address: string; verified_at: string | null }[];
    json(res, 200, { policy: forwardPolicy(hit.ws), addresses: rows.map((r) => ({ address: r.address, verified: !!r.verified_at })) });
    return true;
  }
  if (p === '/api/mail/forwarding' && req.method === 'POST') {
    // A forwarding address: the company's own are ready at once; an outside one gets an email with a link to confirm.
    const b = await x.body(req);
    const hit = accountOf(b.accountId);
    if (!hit || !(hit.account.users ?? []).includes(me)) return (json(res, 403, { error: mark('Not your mailbox.') }), true);
    const address = lower(b.address);
    if (!isEmail(address)) return (json(res, 400, { error: mark('That isn’t an email address.') }), true);
    const policy = forwardPolicy(hit.ws);
    const inside = companyAddress(hit.ws, address);
    if (policy === 'off') return (json(res, 403, { error: mark('Your company has automatic forwarding switched off.') }), true);
    if (policy === 'company' && !inside) return (json(res, 403, { error: mark('Your company only allows forwarding to its own addresses.') }), true);
    const count = (db.db.prepare('SELECT COUNT(*) AS n FROM mail_forward_addrs WHERE account_id = ?').get(hit.account.id) as { n: number }).n;
    if (count >= 20) return (json(res, 400, { error: mark('A mailbox can forward to 20 addresses at most.') }), true);
    const token = randomBytes(18).toString('hex');
    db.db
      .prepare('INSERT INTO mail_forward_addrs (account_id, address, token, asked_by, asked_at, verified_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (account_id, address) DO UPDATE SET token = excluded.token, asked_by = excluded.asked_by, asked_at = excluded.asked_at, verified_at = COALESCE(mail_forward_addrs.verified_at, excluded.verified_at)')
      .run(hit.account.id, address, token, me, now(), inside ? now() : null);
    if (inside) return (json(res, 200, { address, verified: true }), true);
    const link = `${deps?.publicUrl() ?? ''}/api/mail/forwarding/confirm?token=${token}`;
    const text = `${hit.account.email} at ${hit.ws.name ?? 'sprint2go'} asked to forward email to ${address}.\n\nTo allow it, open this link:\n${link}\n\nIf you didn't expect this, ignore this email and nothing will be forwarded.`;
    const sent = await (deps?.sendNote(address, `Confirm forwarding from ${hit.account.email}`, text) ?? Promise.resolve(false)).catch(() => false);
    // No system mail here (a local server): the link goes to this log, like sign-up codes.
    deps?.log(sent ? `[filters] forwarding confirmation for ${hit.account.email} sent to ${address}` : `[filters] forwarding confirmation for ${hit.account.email} to ${address} (no system mail here): ${link}`);
    json(res, 200, { address, verified: false, sent });
    return true;
  }
  if (p === '/api/mail/forwarding/remove' && req.method === 'POST') {
    const b = await x.body(req);
    const hit = accountOf(b.accountId);
    if (!hit || !(hit.account.users ?? []).includes(me)) return (json(res, 403, { error: mark('Not your mailbox.') }), true);
    db.db.prepare('DELETE FROM mail_forward_addrs WHERE account_id = ? AND address = ?').run(hit.account.id, lower(b.address));
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}

/** The link in the confirmation email (no sign-in: the token is the proof). */
export function handlePublic(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (url.pathname !== '/api/mail/forwarding/confirm' || req.method !== 'GET') return false;
  const token = String(url.searchParams.get('token') ?? '');
  const row = /^[a-f0-9]{36}$/.test(token) ? (db.db.prepare('SELECT account_id, address FROM mail_forward_addrs WHERE token = ?').get(token) as { account_id: string; address: string } | undefined) : undefined;
  if (row) db.db.prepare('UPDATE mail_forward_addrs SET verified_at = COALESCE(verified_at, ?) WHERE token = ?').run(now(), token);
  const mailbox = row ? accountOf(row.account_id)?.account.email ?? '' : '';
  const say = row ? `Forwarding confirmed. Email from ${escHtml(mailbox)} can now be forwarded to ${escHtml(row.address)}.` : 'This link has expired or was already replaced. Ask for a new one from sprint2go.';
  res.writeHead(row ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>sprint2go</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#111"><p>${say}</p></body>`);
  return true;
}
