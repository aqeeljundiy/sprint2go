// What a company's plan allows, enforced on the server (the billing page promises it; the app only shows it):
//  - a paused or suspended company is read-only: everyone reads and exports; nothing new is saved, sent or asked of AI
//  - pausing: up to 3 months in any year, then the plan resumes by itself
//  - hosted mailboxes: one per person on paid plans (shared inboxes free), each extra one an add-on; Free: add-ons only
//  - the storage pool: the plan's, plus storage and mailbox add-ons; uploaded files and kept recordings use it
//  - meeting-bot hours a month: the plan's, plus the "10 more hours" add-on
//  - Boosted sending credits: bought with an invoice paid by bank transfer, added when an operator marks it paid
import * as db from './db.ts';
import * as platform from './platform.ts';
import { randomBytes } from 'node:crypto';
import { MAIL_PACKS, PAUSE_DAYS_A_YEAR, addAdjustment, billingPeriod, countedMailboxes, mailboxRoom, meetHours, pauseDaysLeft, pauseDaysUsed, prorate, rp, storageGB } from '../src/data/pricing.ts';
import type { Plan, PlanAdjustment } from '../src/types.ts';

const DAY = 86_400_000;
const now = () => new Date().toISOString();
const monthStart = (at = new Date()) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();

type Ws = { id: string; name?: string; members?: { userId: string; role: string }[]; accounts?: any[]; plan?: Plan & { pauses?: { from: string; to?: string }[] }; suspended?: { reason?: string } };

/** No plan saved yet: the Studio trial a new company starts on. */
export const planOf = (ws: Ws | undefined): Plan =>
  ws?.plan ?? ({ track: 'ai', tier: 'studio', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: ws?.name ?? '', emails: [] }, since: now() } as Plan);
/** People on the team (guests don't count), at least one. */
export const teamSize = (ws: Ws | undefined) =>
  Math.max(
    1,
    (ws?.members ?? []).filter((m) => {
      const u = db.getDoc('users', m.userId) as any;
      return !u || (!u.clientOf && !u.deletedAt);
    }).length,
  );

/**
 * Who a month's invoice bills (the billing page promises "only active people are billed"): people on the team
 * (guests don't count) who signed in or used sprint2go during that month (YYYY-MM), at least one. `team` is everyone
 * on the team, for the invoice to say how many of them were active.
 */
export function activePeople(ws: Ws | undefined, period = now().slice(0, 7)): { active: number; team: number; period: string } {
  const team = (ws?.members ?? []).filter((m) => {
    const u = db.getDoc('users', m.userId) as any;
    return !u || (!u.clientOf && !u.deletedAt);
  });
  const seen = platform.activeInMonth(period);
  return { active: Math.max(1, team.filter((m) => seen.has(m.userId)).length), team: Math.max(1, team.length), period };
}

/* ---------- plan switches, prorated ---------- */

/** Whether a period's plan invoice was already made for this company (an invoice for Boosted credits doesn't count). */
const periodInvoiced = (wsId: string, period: string) => platform.invoices(wsId).some((i) => i.period === period && i.status !== 'void' && !isCreditInvoice(i.id));
/**
 * A plan saved with another tier or track: the switch is prorated for the rest of its period (src/data/pricing.ts,
 * prorate) and waits on the plan for the next invoice, with any earlier switch of the same period folded in. The
 * people it's priced for are the ones active this month, like the invoice.
 */
export function adjustmentsOnSave(ws: Ws, prev: Plan | undefined, next: Plan, at = new Date()): PlanAdjustment[] | undefined {
  const kept = prev?.adjustments?.length ? prev.adjustments : undefined;
  if (!prev || !next || (prev.tier === next.tier && prev.track === next.track && prev.cycle === next.cycle)) return kept;
  const period = billingPeriod(prev, at).key;
  const a = prorate(prev, next, activePeople(ws, at.toISOString().slice(0, 7)).active, at, periodInvoiced(ws.id, period));
  return a ? addAdjustment(kept, a, 'adj-' + randomBytes(5).toString('hex')) : kept;
}
/** The invoice lines for switches waiting on a plan (a credit is a negative amount). */
export const adjustmentLines = (plan: Plan | undefined) => (plan?.adjustments ?? []).filter((a) => a.amount).map((a) => ({ text: a.text, amount: a.amount }));

/* ---------- read-only: paused or suspended ---------- */

/** Why nothing can be changed in this company right now, or null. Reading and exporting always work. */
export function readOnlyWhy(ws: Ws | undefined | null): string | null {
  if (!ws) return null;
  if (ws.suspended) return `${ws.name ?? 'This company'} is read-only for now${ws.suspended.reason ? `: ${ws.suspended.reason}` : '.'}`;
  if (ws.plan?.paused) return `${ws.name ?? 'This company'} is paused, so it’s read-only: everyone can read and export everything. An owner can resume the plan in Settings, Plan & billing.`;
  return null;
}

/* ---------- pausing: up to 3 months a year ---------- */

type Pause = { from: string; to?: string };
export { pauseDaysLeft, pauseDaysUsed };

/**
 * The pause part of a plan saved from the app: the app asks to pause or resume; when it started and how long it
 * has been paused this year are the server's. A pause past this year's days, or of a plan nobody pays for, doesn't
 * happen (`why` says so).
 */
export function pauseOnSave(next: any, prev: any): { paused: boolean | undefined; pauses: Pause[] | undefined; why?: string } {
  const pauses: Pause[] = (prev?.pauses ?? []).filter((p: Pause) => !p.to || Date.parse(p.to) > Date.now() - 400 * DAY);
  const was = !!prev?.paused;
  const want = !!next?.paused;
  if (want === was) return { paused: was || undefined, pauses: pauses.length ? pauses : undefined };
  if (!want) return { paused: undefined, pauses: pauses.map((p) => (p.to ? p : { ...p, to: now() })) };
  const tier = next?.tier ?? prev?.tier;
  const trial = !!(prev?.trialEnds && prev.trialEnds > now());
  if (tier === 'free' || trial) return { paused: undefined, pauses: pauses.length ? pauses : undefined, why: 'Only a paid plan can be paused: there’s nothing to stop billing on Free or during the trial.' };
  if (pauseDaysLeft(pauses) <= 0) return { paused: undefined, pauses, why: `A plan can be paused up to 3 months a year, and this year’s ${PAUSE_DAYS_A_YEAR} days are used up.` };
  return { paused: true, pauses: [...pauses, { from: now() }] };
}

/**
 * Hourly: a pause that used up the year's days ends by itself (the company is billed again from then), and its
 * owners hear it. Returns the companies it resumed.
 */
export function resumeExpiredPauses(save: (ws: any) => void, tell: (userIds: string[], text: string, wsId: string) => void) {
  const out: string[] = [];
  for (const ws of db.allDocs('workspaces') as any[]) {
    if (!ws.plan?.paused || pauseDaysLeft(ws.plan.pauses) > 0) continue;
    const pauses = (ws.plan.pauses ?? []).map((p: Pause) => (p.to ? p : { ...p, to: now() }));
    save({ ...ws, plan: { ...ws.plan, paused: undefined, pauses } });
    platform.event('plan.resumed', ws.id, null, `pause limit of ${PAUSE_DAYS_A_YEAR} days reached`);
    const owners = (ws.members ?? []).filter((m: any) => m.role === 'owner').map((m: any) => m.userId);
    tell(owners, `${ws.name}’s plan was paused for ${PAUSE_DAYS_A_YEAR} days this year, the most a year allows, so it’s running again and billed from today.`, ws.id);
    out.push(ws.id);
  }
  return out;
}

/* ---------- cancelling: at the end of the period that's paid for ---------- */

/** When the period that's paid for ends: the 1st of next month, or the plan's yearly anniversary. */
export function periodEnd(plan: Pick<Plan, 'cycle' | 'since'>, at = new Date()) {
  if (plan.cycle === 'yearly' && plan.since) {
    const s = new Date(plan.since);
    let y = at.getUTCFullYear();
    let end = Date.UTC(y, s.getUTCMonth(), s.getUTCDate());
    if (end <= at.getTime()) end = Date.UTC(++y, s.getUTCMonth(), s.getUTCDate());
    return new Date(end).toISOString();
  }
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)).toISOString();
}
/** Hourly: cancelled plans whose period ended move to Free (nothing is deleted), and their owners hear it. */
export function endCancelled(save: (ws: any) => void, tell: (userIds: string[], text: string, wsId: string) => void) {
  const out: string[] = [];
  for (const ws of db.allDocs('workspaces') as any[]) {
    const at = ws.plan?.cancelAt;
    if (!at || at > now()) continue;
    save({ ...ws, plan: { ...ws.plan, tier: 'free', track: 'own', cancelAt: undefined, paused: undefined, autoTopUp: undefined, topUps: undefined } });
    platform.event('plan.cancelled', ws.id, null, 'moved to Free at the end of the period');
    const owners = (ws.members ?? []).filter((m: any) => m.role === 'owner').map((m: any) => m.userId);
    tell(owners, `${ws.name} is on Free now, as you asked when you cancelled. Nothing was deleted; pick a plan any time in Settings, Plan & billing.`, ws.id);
    out.push(ws.id);
  }
  return out;
}

/* ---------- hosted mailboxes ---------- */

/** The company's hosted mailboxes against its room for them. */
export function mailboxes(ws: Ws) {
  const room = mailboxRoom(planOf(ws), teamSize(ws));
  return { ...room, used: countedMailboxes(ws.accounts ?? [], room.sharedFree) };
}
/**
 * A save that adds hosted mailboxes beyond the plan's room keeps the mailboxes as they were. Mailboxes already over
 * (after a downgrade) keep working: nothing that receives mail is ever switched off.
 */
export function mailboxesOnSave(next: Ws, before: Ws | undefined): { accounts: any[] | undefined; why?: string } {
  const room = mailboxRoom(planOf(next), teamSize(next));
  const after = countedMailboxes(next.accounts ?? [], room.sharedFree);
  const was = before ? countedMailboxes(before.accounts ?? [], mailboxRoom(planOf(before), teamSize(before)).sharedFree) : 0;
  if (after <= room.total || after <= was) return { accounts: next.accounts };
  const kind = room.sharedFree ? 'personal hosted mailboxes' : 'hosted mailboxes';
  return {
    accounts: before?.accounts ?? (next.accounts ?? []).filter((a) => !(!!a.email && !a.temp && (!a.provider || a.provider === 'sprint2go') && !(room.sharedFree && a.kind === 'shared'))),
    why: `The plan has room for ${room.total} ${kind}${room.included ? ` (${room.included} with the plan${room.addon ? `, ${room.addon} added` : ''})` : ''}. An owner can add more in Settings, Plan & billing, Add-ons.`,
  };
}

/**
 * Hosted mailboxes beyond the plan's room (after a downgrade, the trial ending, or fewer add-ons): they keep
 * receiving, but nothing goes out from them until there's room again ("anything beyond Free waits for an upgrade").
 * The ones added last wait first.
 */
export function overRoom(ws: Ws): Set<string> {
  const room = mailboxRoom(planOf(ws), teamSize(ws));
  const counted = (ws.accounts ?? []).filter((a) => !!a.email && !a.temp && (!a.provider || a.provider === 'sprint2go') && !(room.sharedFree && a.kind === 'shared'));
  return new Set(counted.slice(room.total).map((a) => String(a.id)));
}
export const overRoomWhy = (ws: Ws) => {
  const room = mailboxRoom(planOf(ws), teamSize(ws));
  return `The plan has room for ${room.total} hosted mailbox${room.total === 1 ? '' : 'es'}, so this one receives mail but can’t send. An owner can add a mailbox in Settings, Plan & billing, Add-ons.`;
};

/* ---------- storage ---------- */

/** What a company's kept meeting recordings take, in bytes (they live on the recorder but count here). */
export function recordingsBytes(wsId: string) {
  let mb = 0;
  for (const m of db.allDocs('meetings') as any[]) if (m.workspaceId === wsId && m.recording && m.recording.keep !== 'notes') mb += (Number(m.recording.sizeMb) || 0) + (Number(m.recording.videoMb) || 0);
  return Math.round(mb * 1024 * 1024);
}
/** A company's storage: its plan's pool (shared by everyone) and what its files and kept recordings take. */
export function storageRoom(wsId: string) {
  const ws = db.getDoc('workspaces', wsId) as Ws | undefined;
  const total = storageGB(planOf(ws), teamSize(ws)) * 1024 ** 3;
  const files = db.storageOf(wsId);
  const recordings = recordingsBytes(wsId);
  const used = files.used + recordings;
  return { total, used, video: files.video, byPerson: files.byPerson, recordings, left: Math.max(0, total - used) };
}

/* ---------- meeting-bot hours ---------- */

const LIVE = new Set(['queued', 'joining', 'waiting_room', 'recording', 'stopping']);
/** This month's meeting-bot minutes: what the plan allows, what finished and running bots used, what's left. */
export function meetMinutes(ws: Ws, at = new Date()) {
  const hours = meetHours(planOf(ws), teamSize(ws));
  const allowance = hours === Infinity ? Infinity : hours * 60;
  const since = monthStart(at);
  let used = 0;
  for (const m of db.allDocs('meetings') as any[]) {
    if (m.workspaceId !== ws.id || !m.bot || !m.at || m.at < since) continue;
    if (LIVE.has(m.status) && m.status !== 'queued') used += Math.max(0, (at.getTime() - Date.parse(m.at)) / 60_000);
    else used += Number(m.minutes) || 0;
  }
  used = Math.round(used);
  return { allowance, used, left: allowance === Infinity ? Infinity : Math.max(0, allowance - used), hours };
}

/* ---------- Boosted sending credits, by invoice ---------- */

db.db.exec('CREATE TABLE IF NOT EXISTS credit_orders (invoice_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, credits INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, applied_at TEXT, cancelled_at TEXT)');
type OrderRow = { invoice_id: string; workspace_id: string; credits: number; created_by: string; created_at: string; applied_at: string | null; cancelled_at: string | null };
const order = (invoiceId: string) => db.db.prepare('SELECT * FROM credit_orders WHERE invoice_id = ?').get(invoiceId) as OrderRow | undefined;
/** Whether an invoice is for credits (the monthly plan invoice run doesn't count it as the month's invoice). */
export const isCreditInvoice = (invoiceId: string) => !!order(invoiceId);
/** Credits ordered and not paid yet, newest first. */
export function openOrders(wsId: string) {
  const rows = db.db.prepare('SELECT * FROM credit_orders WHERE workspace_id = ? AND applied_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC').all(wsId) as OrderRow[];
  return rows
    .map((r) => ({ r, inv: platform.invoice(r.invoice_id) }))
    .filter((x) => x.inv && x.inv.status !== 'void' && x.inv.status !== 'paid')
    .map(({ r, inv }) => ({ invoiceId: r.invoice_id, number: inv!.number, credits: r.credits, total: inv!.total, dueAt: inv!.dueAt, at: r.created_at }));
}
/** Why credits can't be bought here right now, or null. */
export function creditsBlocked(boosted: boolean): string | null {
  if (!boosted) return 'Boosted sending isn’t available on this server, so there are no credits to buy.';
  if (!platform.settings().billing?.bank?.trim()) return `Credits are paid by bank transfer, and our bank details aren’t set up yet. Write to support to buy credits.`;
  return null;
}
/**
 * Credits ordered: an invoice to pay by bank transfer (due in 7 days), sent to the company's billing emails. The
 * credits are added when an operator marks it paid (invoicePaid), never before.
 */
export function orderCredits(ws: any, packN: number, by: string): { error: string; status: number } | { invoice: platform.Invoice; credits: number } {
  const pack = MAIL_PACKS.find((p) => p.n === packN);
  if (!pack) return { error: 'Pick one of the packs.', status: 400 };
  if (openOrders(ws.id).length >= 3) return { error: 'There are already 3 credit invoices waiting for payment. Pay one (Settings, Plan & billing, Invoices), or ask us to cancel one, first.', status: 409 };
  const billTo = ws.plan?.billing ?? { company: ws.name, emails: [] };
  const inv = platform.createInvoice({ workspaceId: ws.id, period: now().slice(0, 7), lines: [{ text: `Boosted sending: ${pack.n.toLocaleString('id-ID')} emails`, amount: pack.price }], discount: 0, dueDays: 7, billTo, by, note: `The ${pack.n.toLocaleString('id-ID')} emails are added to Boosted sending as soon as this invoice is paid.` });
  db.db.prepare('INSERT INTO credit_orders (invoice_id, workspace_id, credits, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(inv.id, ws.id, pack.n, by, now());
  const sent = platform.setInvoiceStatus(inv.id, 'sent') ?? inv;
  platform.event('credits.ordered', ws.id, by, `${pack.n} emails, ${inv.number} ${rp(inv.total)}`);
  return { invoice: sent, credits: pack.n };
}
/**
 * An invoice was marked paid: when it's a credits invoice, its credits go to the company (once). Returns the
 * company's new balance, or null when it wasn't one.
 */
export function invoicePaid(invoiceId: string, save: (ws: any) => void, tell: (userIds: string[], text: string, wsId: string) => void): number | null {
  const o = order(invoiceId);
  if (!o || o.applied_at || o.cancelled_at) return null;
  const ws = db.getDoc('workspaces', o.workspace_id) as any;
  if (!ws) return null;
  db.db.prepare('UPDATE credit_orders SET applied_at = ? WHERE invoice_id = ? AND applied_at IS NULL').run(now(), invoiceId);
  const next = { ...ws, mailCredits: (ws.mailCredits ?? 0) + o.credits, mailCreditsNotified: false };
  save(next);
  platform.event('credits.added', ws.id, null, `${o.credits} emails, invoice ${platform.invoice(invoiceId)?.number ?? invoiceId}`);
  const admins = (ws.members ?? []).filter((m: any) => m.role !== 'member').map((m: any) => m.userId);
  tell(admins, `Payment received: ${o.credits.toLocaleString('id-ID')} emails added to Boosted sending.`, ws.id);
  return next.mailCredits;
}
/** A credits invoice was voided: its order is cancelled (nothing was added). */
export function invoiceVoided(invoiceId: string) {
  db.db.prepare('UPDATE credit_orders SET cancelled_at = ? WHERE invoice_id = ? AND applied_at IS NULL').run(now(), invoiceId);
}
