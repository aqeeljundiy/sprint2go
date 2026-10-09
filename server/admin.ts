// The operator backend's API (/api/admin/*). Who may do what comes from the operator's role (server/platform.ts);
// every change is written to the audit table. Operators sign in like everyone else, then confirm a 2FA code.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import * as platform from './platform.ts';
import * as support from './support.ts';
import * as mailer from './mailer.ts';
import * as aiplan from './aiplan.ts';
import * as billing from './billing.ts';
import { offsiteState } from './offsite.ts';
import { certState } from './mailcert.ts';
import * as turn from './turn.ts';
import * as twostep from './twostep.ts';
import * as sandbox from './sandbox.ts';
import { applyPricing, DEFAULT_PRICES, discountOf, monthlyTotal, planName, PRICES, ADDONS, TOP_UP } from '../src/data/pricing.ts';
import type { Plan, Tier, Track } from '../src/types.ts';

export interface AdminCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  me: string; // the operator's user id
  token: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: (req: IncomingMessage) => Promise<any>;
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
  signups: Map<string, { name: string; code: string; until: number }>;
  codes: Map<string, { code: string; until: number }>;
  newCode: () => string;
  publicUrl: string;
  recorder: { configured: boolean; health: () => Promise<{ ok: boolean; bots?: number } | null> };
  spendRp: (rows: { provider: string; model: string; inTokens: number; outTokens: number }[]) => number;
  setSession: (res: ServerResponse, token: string | null) => void;
  sseClients: () => number;
  startedAt: number;
  notifyUsers: (userIds: string[], text: string, url?: string, workspaceId?: string) => void;
  mailOn: boolean;
}

const DAY = 86_400_000;
const now = () => new Date().toISOString();
const monthStart = (offset = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString();
};
const lastMonths = (n: number) => Array.from({ length: n }, (_, i) => monthStart(i - n + 1).slice(0, 7));
const emailOf = (u: any) => String(u?.email ?? '').toLowerCase();
const isTeamUser = (u: any) => u && !u.clientOf && !u.deletedAt;
const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The pricing override saved from the backend, applied at start. */
export function loadPricing() {
  applyPricing(platform.settings().pricing as any);
}
export const isOperatorEmail = (email: string | undefined) => !!platform.operator(email);

/* ---------- money per company ---------- */

export type State = 'free' | 'trial' | 'paused' | 'comp' | 'paying' | 'suspended';
export function mrrOf(ws: any, people: number): { mrr: number; state: State; after?: number; discount: number } {
  const plan: Plan | undefined = ws.plan;
  if (ws.suspended) return { mrr: 0, state: 'suspended', discount: 0 };
  // A cancelled plan whose period ended is Free, even before the hourly clock moves it.
  const ended = !!plan?.cancelAt && plan.cancelAt <= now();
  // Free with add-ons pays for the add-ons (Free teams can buy them; they're on the invoice).
  if (!plan || ((plan.tier === 'free' || ended) && !monthlyTotal({ ...plan, tier: 'free' }, people).addons)) return { mrr: 0, state: 'free', discount: 0 };
  const gross = monthlyTotal(ended ? { ...plan, tier: 'free' } : plan, people).total;
  const discount = discountOf(plan, gross);
  const full = (gross - discount) * (plan.cycle === 'yearly' ? 10 / 12 : 1);
  if (plan.paused) return { mrr: 0, state: 'paused', after: full, discount };
  const at = now();
  if (plan.comp?.until && plan.comp.until > at) return { mrr: 0, state: 'comp', after: full, discount };
  if (plan.trialEnds && plan.trialEnds > at) return { mrr: 0, state: 'trial', after: full, discount };
  return { mrr: full, state: 'paying', discount };
}

/** 0 to 100, with the parts it's made of. Below 40 is "at risk". */
function healthOf(c: { lastActive: string | null; people: number; state: State; openTickets: number; overdue: number; setupDone: number; setupTotal: number }) {
  const ago = c.lastActive ? (Date.now() - Date.parse(c.lastActive)) / DAY : Infinity;
  const parts = [
    { key: 'activity', label: 'Active lately', score: ago <= 3 ? 30 : ago <= 7 ? 20 : ago <= 14 ? 10 : 0, max: 30 },
    { key: 'team', label: 'Team using it', score: c.people >= 5 ? 20 : c.people >= 2 ? 12 : 4, max: 20 },
    { key: 'setup', label: 'Set up', score: Math.round((c.setupDone / Math.max(1, c.setupTotal)) * 20), max: 20 },
    { key: 'support', label: 'No open problems', score: Math.max(0, 15 - c.openTickets * 5), max: 15 },
    { key: 'billing', label: 'Billing in order', score: c.state === 'suspended' || c.overdue ? 0 : c.state === 'paying' || c.state === 'comp' ? 15 : c.state === 'trial' ? 10 : 8, max: 15 },
  ];
  const score = parts.reduce((n, p) => n + p.score, 0);
  return { score, label: score >= 70 ? 'healthy' : score >= 40 ? 'watch' : 'risk', parts } as const;
}

function companyRows(ctx: AdminCtx) {
  const users = db.allDocs('users') as any[];
  const byId = new Map(users.map((u) => [u.id, u]));
  const seen = db.lastSeen();
  const storage = db.storageByWorkspace();
  const usage = db.usageByWorkspace(monthStart());
  const clients = db.allDocs('clients') as any[];
  const set = platform.settings();
  const tix = support.tickets().filter((t) => !t.mergedInto && (t.status === 'new' || t.status === 'open' || t.status === 'waiting'));
  const overdue = platform.overdueInvoices();
  return (db.allDocs('workspaces') as any[]).map((ws) => {
    const members = (ws.members ?? []).filter((m: any) => isTeamUser(byId.get(m.userId)));
    const people = members.length;
    const owner = byId.get(members.find((m: any) => m.role === 'owner')?.userId);
    const lastActive = members.map((m: any) => seen.get(m.userId) ?? '').sort().pop() || null;
    const money = mrrOf(ws, people);
    const projects = clients.filter((c) => c.workspaceId === ws.id);
    const guests = projects.reduce((n, c) => n + (c.people ?? []).filter((p: any) => p.status === 'joined').length, 0);
    const openTickets = tix.filter((t) => t.workspaceId === ws.id).length;
    const overdueCount = overdue.filter((i) => i.workspaceId === ws.id).length;
    const setup = [ws.emailSetup === 'none' || !ws.domains?.[0] || !!ws.mailChecks?.allOk, people > 1, !!ws.logo, !!ws.plan?.payment || ws.plan?.tier === 'free' || money.state === 'paying'];
    const health = healthOf({ lastActive, people, state: money.state, openTickets, overdue: overdueCount, setupDone: setup.filter(Boolean).length, setupTotal: setup.length });
    return {
      id: ws.id,
      name: ws.name,
      color: ws.color,
      plan: ws.plan ? { tier: ws.plan.tier, track: ws.plan.track, cycle: ws.plan.cycle, trialEnds: ws.plan.trialEnds ?? null, paused: !!ws.plan.paused, comp: ws.plan.comp ?? null, discount: ws.plan.discount ?? null, addons: ws.plan.addons, billing: ws.plan.billing ?? null } : null,
      ...money,
      people,
      guests,
      projects: projects.length,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      lastActive,
      aiRp: ctx.spendRp(usage.filter((u) => u.workspaceId === ws.id)),
      aiIncludedUses: usage.filter((u) => u.workspaceId === ws.id && u.provider === 'included').reduce((n, r) => n + r.uses, 0),
      storageBytes: storage.get(ws.id) ?? 0,
      since: ws.createdAt ?? ws.plan?.since ?? null,
      suspended: ws.suspended ?? null,
      internal: set.homeWorkspace === ws.id || set.internal.includes(ws.id),
      home: set.homeWorkspace === ws.id,
      industry: ws.industry ?? null,
      domains: ws.domains ?? [],
      openTickets,
      overdue: overdueCount,
      health,
    };
  });
}
export type CompanyRow = ReturnType<typeof companyRows>[number];

/** Daily: each company's MRR, so the movement report has history. */
export function snapshot(ctx: Pick<AdminCtx, 'spendRp'>) {
  platform.snapshotMrr(companyRows(ctx as AdminCtx).filter((c) => !c.internal).map((c) => ({ id: c.id, mrr: c.mrr })));
}

/* ---------- server facts ---------- */

function systemInfo(ctx: AdminCtx) {
  const dir = db.dataDir;
  let disk: { free: number; total: number } | null = null;
  try {
    const s = statfsSync(dir);
    disk = { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
  } catch {
    /* not available here */
  }
  const backupsDir = join(dir, 'backups');
  const backups = existsSync(backupsDir)
    ? readdirSync(backupsDir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => ({ file: f, bytes: statSync(join(backupsDir, f)).size, at: statSync(join(backupsDir, f)).mtime.toISOString() }))
        .sort((a, b) => (a.at < b.at ? 1 : -1))
    : [];
  let version = '0';
  try {
    version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version ?? '0';
  } catch {
    /* fine */
  }
  const built = existsSync(join(process.cwd(), 'dist', 'index.html')) ? statSync(join(process.cwd(), 'dist', 'index.html')).mtime.toISOString() : null;
  // The build stamp (scripts/build-stamp.mjs): when this build was made and from which commit, even without .git.
  let build: { builtAt: string; bundle: string | null; commit: string | null } | null = null;
  try {
    build = JSON.parse(readFileSync(join(process.cwd(), 'dist', 'version.json'), 'utf8'));
  } catch {
    /* built before the stamp existed */
  }
  const flags = ['PUBLIC_URL', 'S2G_OPERATORS', 'S2G_DEMO', 'MAIL_HOST', 'MAIL_IP', 'SUPPORT_EMAIL', 'SES_KEY', 'SES_SECRET', 'MAIL_FROM', 'RECORDER_URL', 'RECORDER_SECRET', 'S2G_SECRET', 'S3_BUCKET', 'CF_DNS_TOKEN', 'MAIL_TLS_CERT', 'TURN_URLS', 'TURN_SECRET'].map((k) => ({ key: k, set: !!process.env[k] }));
  return {
    version,
    commit: process.env.SOURCE_COMMIT ?? process.env.S2G_COMMIT ?? build?.commit ?? null,
    built: build?.builtAt ?? built,
    build,
    node: process.version,
    uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
    production: process.env.NODE_ENV === 'production',
    publicUrl: ctx.publicUrl,
    https: ctx.publicUrl.startsWith('https://'),
    disk,
    dbBytes: existsSync(db.dbPath) ? statSync(db.dbPath).size : 0,
    backups: backups.slice(0, 20),
    lastBackupAt: backups[0]?.at ?? null,
    offsite: offsiteState(),
    cert: certState(mailer.MAIL_HOST),
    systemMail: mailer.systemMailPath(),
    noreply: mailer.NOREPLY,
    mailOn: ctx.mailOn,
    mailHost: mailer.MAIL_HOST,
    supportEmail: mailer.SUPPORT_EMAIL,
    liveConnections: ctx.sseClients(),
    sessions: db.sessionCount(),
    flags,
    // People's own demo companies: only here, never in the business numbers (they're kept apart: server/sandbox.ts).
    demoCompanies: sandbox.stats(),
  };
}

/** Problems the platform has right now, worst first. Used by Today and by the alert job. */
async function warnings(ctx: AdminCtx) {
  const sys = systemInfo(ctx);
  const out: { kind: string; text: string; level: 'high' | 'normal'; to?: string }[] = [];
  if (sys.disk && sys.disk.free / sys.disk.total < 0.1) out.push({ kind: 'disk', level: 'high', text: `Disk nearly full: ${(sys.disk.free / 1e9).toFixed(1)} GB free.`, to: '/admin/platform' });
  if (!sys.lastBackupAt || sys.lastBackupAt < new Date(Date.now() - 36 * 3600_000).toISOString()) out.push({ kind: 'backup', level: 'high', text: sys.lastBackupAt ? 'The last backup is older than a day.' : 'No backup yet.', to: '/admin/platform/backups' });
  // The off-site copy: its last upload failed, or none for two days although it's set up.
  const off = sys.offsite;
  if (off.configured && off.error && (!off.last || off.error.at > off.last.at)) out.push({ kind: 'offsite', level: 'high', text: `The off-site backup copy failed: ${off.error.message}`, to: '/admin/platform/backups' });
  else if (off.configured && off.last && off.last.at < new Date(Date.now() - 48 * 3600_000).toISOString()) out.push({ kind: 'offsite', level: 'high', text: 'The last off-site backup copy is older than two days.', to: '/admin/platform/backups' });
  // The mail server's certificate: Let's Encrypt couldn't get or renew it, or a trusted one is close to expiring.
  const cert = sys.cert;
  if (cert.error) out.push({ kind: 'cert', level: cert.trusted ? 'normal' : 'high', text: cert.acme ? `Let’s Encrypt couldn’t ${cert.trusted ? 'renew' : 'issue'} the mail server’s certificate: ${cert.error.message}` : `The mail server’s certificate can’t be used: ${cert.error.message}`, to: '/admin/platform/mail' });
  else if (cert.source !== 'self-signed' && cert.daysLeft !== null && cert.daysLeft < 14) out.push({ kind: 'cert', level: 'high', text: `The mail server’s certificate expires in ${Math.max(0, cert.daysLeft)} days.`, to: '/admin/platform/mail' });
  if (ctx.recorder.configured) {
    const h = await ctx.recorder.health();
    if (!h?.ok) out.push({ kind: 'recorder', level: 'normal', text: 'The meeting recorder does not answer.', to: '/admin/platform' });
  }
  const relay = await turn.health();
  if (relay.configured && !relay.reachable) out.push({ kind: 'relay', level: 'normal', text: `The call relay doesn’t answer at ${relay.checked ?? 'its address'}: huddles fail on networks that block direct calls.`, to: '/admin/platform' });
  const health = await mailer.serverHealth();
  if (!health.port25.ok) out.push({ kind: 'port25', level: 'normal', text: 'Outgoing port 25 is blocked: mail to outside addresses stays queued.', to: '/admin/platform/mail' });
  if (!health.ptr.ok && mailer.MAIL_IP) out.push({ kind: 'ptr', level: 'normal', text: `Reverse DNS of ${mailer.MAIL_IP} isn’t ${mailer.MAIL_HOST}: Gmail and Outlook will distrust our mail.`, to: '/admin/platform/mail' });
  const lists = await mailer.blocklists();
  const listed = lists.filter((l) => l.listed === true);
  if (listed.length) out.push({ kind: 'blocklist', level: 'high', text: `Our mail server is on ${listed.map((l) => l.list).join(', ')}.`, to: '/admin/platform/mail' });
  for (const p of mailer.pausedMailboxes()) out.push({ kind: `paused:${p.accountId}`, level: 'normal', text: `Sending paused for ${p.email} (${p.company}): ${p.reason}`, to: `/admin/companies/${p.workspaceId}/email` });
  const fresh = platform.errorGroups().filter((e) => !e.resolvedAt && e.lastAt > new Date(Date.now() - DAY).toISOString() && e.count >= 3);
  if (fresh.length) out.push({ kind: 'errors', level: 'normal', text: `${fresh.length} error${fresh.length === 1 ? '' : 's'} happening repeatedly today.`, to: '/admin/platform/errors' });
  if (!sys.https && sys.production) out.push({ kind: 'https', level: 'normal', text: 'The app runs over http. Add the real domain and a certificate.', to: '/admin/platform' });
  out.push(...aiplan.problems(mrrOf)); // our AI keys, prices, and whether the AI plan pays for itself
  return out;
}

/** Hourly: tells operators (bell in the app, plus email) about what needs them. Each kind at most every 6 hours. */
export async function checkAlerts(ctx: AdminCtx) {
  const ops = platform.operators().filter((o) => !o.disabled && o.alerts);
  if (!ops.length) return;
  const users = db.allDocs('users') as any[];
  const ids = ops.map((o) => users.find((u) => emailOf(u) === o.email)?.id).filter(Boolean) as string[];
  const items = (await warnings(ctx)).filter((w) => w.level === 'high' || w.kind === 'blocklist' || w.kind.startsWith('paused:'));
  const breaching = support.tickets().filter((t) => !t.firstReplyAt && t.dueAt && t.dueAt < now() && (t.status === 'new' || t.status === 'open') && !t.mergedInto);
  if (breaching.length) items.push({ kind: 'sla', level: 'high', text: `${breaching.length} ticket${breaching.length === 1 ? ' is' : 's are'} past the reply target.`, to: '/admin/tickets' });
  for (const w of items) {
    if (!platform.alertDue(w.kind, w.text)) continue;
    ctx.notifyUsers(ids, w.text, w.to ?? '/admin');
    void mailer.sendSystemMail({ fromName: 'sprint2go alerts', to: ops.map((o) => o.email), subject: `sprint2go: ${w.text.slice(0, 90)}`, text: `${w.text}\n\nOpen the backend: ${ctx.publicUrl}${w.to ?? '/admin'}` }).catch(() => {});
  }
}

/* ---------- invoices ---------- */

/**
 * A month's invoice: the plan for the people who were active that month (signed in or used sprint2go; the billing
 * page promises only they are billed), and the add-ons. The plan line says how many were active, and of how many.
 */
function invoiceLinesFor(ws: any, period: string) {
  const plan: Plan = ws.plan;
  const { active: people, team } = billing.activePeople(ws, period);
  const t = monthlyTotal(plan, people);
  const month = new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const who = `${people} active ${people === 1 ? 'person' : 'people'}${team > people ? ` of ${team} on the team` : ''}`;
  // Free has no plan line: only the add-ons it bought.
  const lines: { text: string; amount: number }[] = plan.tier === 'free' ? [] : [{ text: `${planName(plan)} plan, ${who}${plan.cycle === 'yearly' ? ', yearly (10 months)' : ''}`, amount: plan.cycle === 'yearly' ? t.base * 10 : t.base }];
  const a = plan.addons;
  if (a.mailboxes) lines.push({ text: `${a.mailboxes} hosted mailbox${a.mailboxes === 1 ? '' : 'es'}`, amount: a.mailboxes * ADDONS.mailboxes.price });
  if (a.storage50) lines.push({ text: `${a.storage50 * 50} GB extra storage`, amount: a.storage50 * ADDONS.storage50.price });
  if (a.meetHours10) lines.push({ text: `${a.meetHours10 * 10} more meeting-bot hours`, amount: a.meetHours10 * ADDONS.meetHours10.price });
  if (a.branding) lines.push({ text: 'Branding add-on', amount: ADDONS.branding.price });
  if (plan.topUps) lines.push({ text: `${plan.topUps} AI top-up${plan.topUps === 1 ? '' : 's'}`, amount: plan.topUps * TOP_UP.price });
  const subtotal = lines.reduce((n, l) => n + l.amount, 0);
  const note = plan.tier === 'free' ? undefined : `Active people are those on your team who signed in or used sprint2go in ${month}. Guests and shared inboxes are free.`;
  return { lines, discount: discountOf(plan, subtotal), note };
}
export function invoiceHtml(inv: platform.Invoice, wsName: string) {
  const b = platform.settings().billing;
  const row = (l: { text: string; amount: number }) => `<tr><td>${esc(l.text)}</td><td class="r">${rp(l.amount)}</td></tr>`;
  const st = inv.status === 'paid' ? `<span class="paid">Paid ${esc(inv.paidAt?.slice(0, 10))}</span>` : inv.status === 'void' ? '<span class="void">Void</span>' : `Due ${esc(inv.dueAt.slice(0, 10))}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(inv.number)}</title><style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#16161d;background:#f5f6f8;margin:0;padding:24px}
.page{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 2px 20px rgba(0,0,0,.06)}
h1{font-size:22px;margin:0 0 4px}.muted{color:#6b6f7b;font-size:13px;line-height:1.5}.row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin:24px 0}
table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:10px 0;border-bottom:1px solid #eceef2;font-size:14px}.r{text-align:right;white-space:nowrap}
.tot td{border:0;padding:4px 0}.grand td{font-weight:700;font-size:16px;padding-top:10px}.paid{color:#15803d;font-weight:700}.void{color:#b91c1c;font-weight:700}
.print{display:inline-block;margin-top:24px;padding:10px 16px;border-radius:10px;background:#2448ff;color:#fff;text-decoration:none;font-size:14px;border:0;cursor:pointer}
@media print{body{background:#fff;padding:0}.page{box-shadow:none}.print{display:none}}
</style></head><body><div class="page">
<div class="row" style="margin-top:0"><div><h1>Invoice ${esc(inv.number)}</h1><div class="muted">${esc(new Date(inv.period + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))} · ${st}</div></div>
<div class="muted" style="text-align:right"><strong style="color:#16161d">${esc(b.name)}</strong><br>${esc(b.address).replace(/\n/g, '<br>')}${b.npwp ? `<br>NPWP ${esc(b.npwp)}` : ''}${b.email ? `<br>${esc(b.email)}` : ''}</div></div>
<div class="muted">Bill to</div><div><strong>${esc(inv.billTo?.company || wsName)}</strong></div><div class="muted">${esc(inv.billTo?.address ?? '').replace(/\n/g, '<br>')}${inv.billTo?.npwp ? `<br>NPWP ${esc(inv.billTo.npwp)}` : ''}</div>
<table>${inv.lines.map(row).join('')}</table>
<table class="tot"><tr><td class="r" style="width:70%">Subtotal</td><td class="r">${rp(inv.subtotal)}</td></tr>${inv.discount ? `<tr><td class="r">Discount</td><td class="r">−${rp(inv.discount)}</td></tr>` : ''}<tr><td class="r">PPN 11%</td><td class="r">${rp(inv.tax)}</td></tr><tr class="grand"><td class="r">Total</td><td class="r">${rp(inv.total)}</td></tr></table>
${b.bank && inv.status !== 'paid' ? `<p class="muted" style="margin-top:24px">Pay by bank transfer to <strong style="color:#16161d">${esc(b.bank)}</strong>, with ${esc(inv.number)} as the reference.</p>` : ''}
${inv.note ? `<p class="muted">${esc(inv.note)}</p>` : ''}
<button class="print" onclick="print()">Print or save as PDF</button></div></body></html>`;
}

/* ---------- the routes ---------- */

export async function handleAdmin(p: string, ctx: AdminCtx): Promise<boolean> {
  const { req, res, url, json, body } = ctx;
  const sub = p.slice('/api/admin/'.length);
  const meDoc = db.getDoc('users', ctx.me) as any;
  const email = emailOf(meDoc);
  const op = platform.operator(email)!;
  const perms = platform.permsOf(op.role);
  const may = (perm: platform.Perm) => perms.includes(perm);
  const deny = (perm: platform.Perm) => (may(perm) ? false : (json(res, 403, { error: `Your role (${op.role}) can’t do that.` }), true));
  const log = (action: string, target: string | null, detail?: string) => db.audit(email, action, target, detail);
  const wsById = (id: string) => db.getDoc('workspaces', id) as any;
  const saveWs = (ws: any) => {
    db.writeDocs('workspaces', [ws], [], ctx.me);
    ctx.broadcast('workspaces', [ws], []);
  };
  const GET = req.method === 'GET';
  const POST = req.method === 'POST';
  const verified = platform.sessionVerified(ctx.token);

  /* ----- who am I, and two-step ----- */
  if (sub === 'me') return (json(res, 200, { email, name: meDoc?.name, role: op.role, perms, totpOn: op.totpOn, verified, supportEmail: mailer.SUPPORT_EMAIL }), true);
  if (sub === '2fa/setup' && POST) {
    if (op.totpOn && !verified) return (json(res, 403, { error: 'Confirm your current code first.' }), true);
    return (json(res, 200, await twostep.totpSetup('sprint2go', email, platform.startTotp(email))), true);
  }
  if (sub === '2fa/verify' && POST) {
    const { code } = await body(req);
    if (!platform.checkTotp(email, String(code ?? ''))) return (json(res, 400, { error: 'That code isn’t right. Check the time on your phone and try the next one.' }), true);
    if (!op.totpOn) (platform.confirmTotp(email), log('team.2fa-on', email));
    platform.markSessionVerified(ctx.token);
    return (json(res, 200, { ok: true }), true);
  }
  // Everything else needs a confirmed second step in this session.
  if (!op.totpOn) return (json(res, 428, { error: 'Set up two-step sign-in first.', enroll: true }), true);
  if (!verified) return (json(res, 401, { error: 'Enter your 2FA code.', verify: true }), true);

  /* ----- AI: our keys, the model for each job, prices, and whether the AI plan pays (server/aiplan.ts) ----- */
  if (sub === 'ai' || sub.startsWith('ai/')) return aiplan.handleAdmin(sub, { req, res, json, body, may, deny, log, email, mrrOf });

  /* ----- Today ----- */
  if (sub === 'today' && GET) {
    const companies = companyRows(ctx);
    const real = companies.filter((c) => !c.internal);
    const users = (db.allDocs('users') as any[]).filter(isTeamUser);
    const t = Date.now();
    const soon = new Date(t + 7 * DAY).toISOString();
    const nowIso = now();
    const tix = support.tickets().filter((x) => !x.mergedInto);
    const open = tix.filter((x) => x.status === 'new' || x.status === 'open');
    const breaching = open.filter((x) => !x.firstReplyAt && x.dueAt && x.dueAt < nowIso);
    const unassigned = open.filter((x) => !x.assignee && !breaching.includes(x));
    const mine = open.filter((x) => x.assignee === email && !breaching.includes(x));
    const seenDays = platform.activeDaysSince(new Date(t - 14 * DAY).toISOString());
    const activeNow = new Set(seenDays.filter((d) => d.day >= new Date(t - 7 * DAY).toISOString().slice(0, 10)).map((d) => d.userId)).size;
    const activeBefore = new Set(seenDays.filter((d) => d.day < new Date(t - 7 * DAY).toISOString().slice(0, 10)).map((d) => d.userId)).size;
    const snaps = platform.mrrByMonth([monthStart(-1).slice(0, 7)]);
    const mrrLast = Array.from(snaps[monthStart(-1).slice(0, 7)]?.values() ?? []).reduce((n, v) => n + v, 0);
    const supportStats = support.stats(new Date(t - 30 * DAY).toISOString());
    const users2 = db.allDocs('users') as any[];
    const flagged = users2.filter((u) => !u.deletedAt && platform.isDisposable(emailOf(u))).slice(0, 20);
    const requests = platform.settings().dataRequests.filter((r) => !r.done && !r.cancelled);
    const name = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;
    return (
      json(res, 200, {
        kpis: {
          mrr: real.reduce((n, c) => n + c.mrr, 0),
          mrrLastMonth: mrrLast || null,
          companies: real.filter((c) => !c.suspended).length,
          newThisMonth: real.filter((c) => c.since && c.since >= monthStart()).length,
          active7: activeNow,
          activePrev7: activeBefore,
          people: users.length,
          openTickets: open.length,
          medianFirstReplyMin: supportStats.medianFirstReplyMin,
          satisfaction: supportStats.satisfaction,
        },
        queue: {
          breaching: breaching.map((x) => ({ id: x.id, number: x.number, subject: x.subject, company: name(x.workspaceId), requester: x.requester.email, dueAt: x.dueAt, priority: x.priority })),
          unassigned: unassigned.map((x) => ({ id: x.id, number: x.number, subject: x.subject, company: name(x.workspaceId), requester: x.requester.email, createdAt: x.createdAt, priority: x.priority })),
          mine: mine.map((x) => ({ id: x.id, number: x.number, subject: x.subject, company: name(x.workspaceId), requester: x.requester.email, updatedAt: x.updatedAt, priority: x.priority })),
          overdue: platform.overdueInvoices().map((i) => ({ id: i.id, number: i.number, workspaceId: i.workspaceId, company: name(i.workspaceId), total: i.total, dueAt: i.dueAt })),
          trialsEnding: real.filter((c) => c.state === 'trial' && c.plan?.trialEnds && c.plan.trialEnds < soon).map((c) => ({ id: c.id, name: c.name, trialEnds: c.plan!.trialEnds, after: c.after ?? 0 })),
          atRisk: real.filter((c) => c.health.label === 'risk' && !c.suspended && (c.state === 'paying' || c.state === 'trial')).map((c) => ({ id: c.id, name: c.name, score: c.health.score, mrr: c.mrr || c.after || 0, lastActive: c.lastActive })),
          // Sign-up and password codes open accounts: only roles that may sign in as people see them.
          signups: may('impersonate')
            ? Array.from(ctx.signups.entries())
                .filter(([, s]) => s.until > t)
                .map(([e, s]) => ({ email: e, name: s.name, code: s.code, until: new Date(s.until).toISOString(), disposable: platform.isDisposable(e) }))
            : [],
          codes: may('impersonate')
            ? Array.from(ctx.codes.entries())
                .filter(([, c]) => c.until > t)
                .map(([key, c]) => ({ key, code: c.code, until: new Date(c.until).toISOString() }))
            : [],
          deletions: requests.map((r) => ({ ...r, company: name(r.workspaceId) })),
          flagged: flagged.map((u) => ({ id: u.id, name: u.name, email: u.email })),
          warnings: await warnings(ctx),
        },
      }),
      true
    );
  }

  /* ----- search everything (⌘K) ----- */
  if (sub === 'search' && GET) {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    if (!q) return (json(res, 200, { results: [] }), true);
    const has = (...v: unknown[]) => v.some((x) => String(x ?? '').toLowerCase().includes(q));
    const wss = db.allDocs('workspaces') as any[];
    const out: { kind: string; id: string; title: string; sub: string; to: string }[] = [];
    for (const w of wss) if (has(w.name, ...(w.domains ?? []), w.id)) out.push({ kind: 'company', id: w.id, title: w.name, sub: (w.domains ?? []).join(', ') || w.id, to: `/admin/companies/${w.id}` });
    for (const u of db.allDocs('users') as any[]) if (!u.deletedAt && has(u.name, u.email)) out.push({ kind: 'person', id: u.id, title: u.name, sub: u.email, to: `/admin/people/${u.id}` });
    for (const t of support.tickets()) if (has(t.subject, t.requester.email, t.requester.name, `#${t.number}`, t.number)) out.push({ kind: 'ticket', id: t.id, title: `#${t.number} ${t.subject}`, sub: `${t.requester.email} · ${t.status}`, to: `/admin/tickets/${t.id}` });
    for (const i of platform.invoices()) if (has(i.number)) out.push({ kind: 'invoice', id: i.id, title: i.number, sub: `${rp(i.total)} · ${i.status}`, to: `/admin/money/invoices/${i.id}` });
    for (const w of wss) for (const a of w.accounts ?? []) if (has(a.email)) out.push({ kind: 'mailbox', id: `${w.id}:${a.id}`, title: a.email, sub: w.name, to: `/admin/companies/${w.id}/email` });
    return (json(res, 200, { results: out.slice(0, 40) }), true);
  }

  /* ----- companies ----- */
  if (sub === 'companies' && GET) return (json(res, 200, { companies: companyRows(ctx) }), true);

  if (sub === 'company' && GET) {
    const id = url.searchParams.get('id') ?? '';
    const ws = wsById(id);
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    const row = companyRows(ctx).find((c) => c.id === id)!;
    const users = db.allDocs('users') as any[];
    const seen = db.lastSeen();
    const members = (ws.members ?? [])
      .map((m: any) => {
        const u = users.find((x) => x.id === m.userId);
        return u ? { id: u.id, name: u.name, email: u.email, title: u.title, color: u.color, role: m.role, lastSeen: seen.get(u.id) ?? null, hasLogin: db.hasLogin(u.id), suspended: u.suspended ?? null, deleted: !!u.deletedAt } : null;
      })
      .filter(Boolean);
    const usage = db.usageSince(id, monthStart());
    // Which apps they actually use: documents touched in the last 30 days, by kind.
    const apps = db.db.prepare("SELECT coll, COUNT(*) AS n FROM docs WHERE json_extract(data, '$.workspaceId') = ? AND updated_at >= ? GROUP BY coll").all(id, new Date(Date.now() - 30 * DAY).toISOString()) as { coll: string; n: number }[];
    const timeline = [
      ...platform.eventsOf(id).map((e) => ({ at: e.at, kind: 'event', type: e.type, text: e.detail, by: e.userId ? users.find((u) => u.id === e.userId)?.name ?? null : null })),
      ...db.auditList(200, id).map((a) => ({ at: a.at, kind: 'operator', type: a.action, text: a.detail, by: a.operator })),
      ...(ws.createdAt ? [{ at: ws.createdAt, kind: 'event', type: 'company.created', text: null, by: null }] : []),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 150);
    return (
      json(res, 200, {
        company: {
          ...row,
          members,
          accounts: (ws.accounts ?? []).map((a: any) => ({ id: a.id, email: a.email, kind: a.kind, provider: a.provider ?? 'sprint2go', users: a.users?.length ?? 0, sendPaused: a.sendPaused ?? null })),
          apps: ws.apps ?? null,
          emailSetup: ws.emailSetup ?? null,
          mailRoute: ws.mailRoute ?? 'own',
          mailCredits: ws.mailCredits ?? 0,
          mailChecks: ws.mailChecks ?? null,
          whiteLabel: ws.whiteLabel?.enabled ? { name: ws.whiteLabel.name, domain: ws.whiteLabel.domain ?? null } : null,
          usage: usage.map((u) => ({ ...u, rp: ctx.spendRp([u]) })),
          appsUsed: apps,
          mail: mailer.mailStats(id, monthStart()),
          invoices: platform.invoices(id),
          tickets: support.ticketsOfWorkspace(id).map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, updatedAt: t.updatedAt, requester: t.requester.email })),
          notes: platform.notesOf(id),
          timeline,
          deletion: platform.settings().dataRequests.find((r) => r.workspaceId === id && !r.done && !r.cancelled) ?? null,
        },
      }),
      true
    );
  }

  if (sub === 'company/create' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    const name = String(b.name ?? '').trim();
    const mail = String(b.ownerEmail ?? '').trim().toLowerCase();
    const ownerName = String(b.ownerName ?? '').trim() || mail.split('@')[0];
    if (name.length < 2) return (json(res, 400, { error: 'Give the company a name.' }), true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return (json(res, 400, { error: 'That email doesn’t look right.' }), true);
    const users = db.allDocs('users') as any[];
    let owner = users.find((u) => emailOf(u) === mail && !u.deletedAt);
    if (owner?.clientOf) return (json(res, 409, { error: 'That person is a guest somewhere; ask them to start their own workspace from "Shared with you".' }), true);
    const colors = ['#5b5bf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    if (!owner) {
      owner = { id: 'u-' + randomBytes(6).toString('hex'), name: ownerName, email: mail, title: '', color: colors[Math.floor(Math.random() * colors.length)] };
      db.writeDocs('users', [owner], [], ctx.me);
      ctx.broadcast('users', [owner], []);
    }
    const tier = (['free', 'small', 'studio', 'agency', 'business'] as Tier[]).includes(b.tier) ? (b.tier as Tier) : 'studio';
    const track: Track = b.track === 'own' ? 'own' : 'ai';
    const trialDays = Number(b.trialDays ?? 14);
    const plan: Plan = { track, tier, cycle: 'monthly', trialEnds: tier !== 'free' && trialDays > 0 ? new Date(Date.now() + trialDays * DAY).toISOString() : undefined, addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: name, emails: [mail] }, since: now() };
    const ws = { id: 'ws-' + randomBytes(5).toString('hex'), name, color: colors[Math.floor(Math.random() * colors.length)], domains: [], accounts: [], members: [{ userId: owner.id, role: 'owner' }], plan, createdAt: now(), createdBy: 'operator' };
    saveWs(ws);
    platform.event('company.created', ws.id, owner.id, `by ${email}`);
    const link = db.hasLogin(owner.id) ? null : `${ctx.publicUrl}/?invite=${db.newInvite(owner.id, mail)}`;
    log('company.create', ws.id, `${name} for ${mail}, ${tier} ${track}${plan.trialEnds ? `, trial ${trialDays} days` : ''}`);
    return (json(res, 200, { id: ws.id, link, existing: !link }), true);
  }

  if (sub === 'company/plan' && POST) {
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    // Trials and free months are customer care; tiers, prices and add-ons are billing.
    const billingChange = ['tier', 'track', 'cycle', 'addons', 'discount'].some((k) => k in b);
    if (deny(billingChange ? 'billing' : 'customers')) return true;
    const plan: any = { ...(ws.plan ?? { track: 'own', tier: 'free', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: ws.name, emails: [] }, since: now() }) };
    const changes: string[] = [];
    if (b.tier && ['free', 'small', 'studio', 'agency', 'business'].includes(b.tier) && b.tier !== plan.tier) (changes.push(`plan ${plan.tier} → ${b.tier}`), (plan.tier = b.tier));
    if (b.track && ['own', 'ai'].includes(b.track) && b.track !== plan.track) (changes.push(`AI ${plan.track} → ${b.track}`), (plan.track = b.track));
    if (b.cycle && ['monthly', 'yearly'].includes(b.cycle) && b.cycle !== plan.cycle) (changes.push(`billed ${b.cycle}`), (plan.cycle = b.cycle));
    if ('trialEnds' in b) (changes.push(b.trialEnds ? `trial until ${String(b.trialEnds).slice(0, 10)}` : 'trial ended'), (plan.trialEnds = b.trialEnds || undefined));
    if ('paused' in b) (changes.push(b.paused ? 'paused' : 'resumed'), (plan.paused = !!b.paused || undefined));
    if ('comp' in b) (changes.push(b.comp ? `free until ${String(b.comp.until).slice(0, 10)}${b.comp.note ? `: ${b.comp.note}` : ''}` : 'free months removed'), (plan.comp = b.comp ? { until: b.comp.until, note: String(b.comp.note ?? '').slice(0, 200), by: email } : undefined));
    if ('discount' in b) (changes.push(b.discount ? `discount ${b.discount.code}` : 'discount removed'), (plan.discount = b.discount || undefined));
    if (b.addons && typeof b.addons === 'object') {
      const next = { ...plan.addons };
      for (const k of ['mailboxes', 'storage50', 'meetHours10']) if (k in b.addons) next[k] = Math.max(0, Math.min(1000, Number(b.addons[k]) || 0));
      if ('branding' in b.addons) next.branding = !!b.addons.branding;
      changes.push(`add-ons ${Object.entries(next).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      plan.addons = next;
    }
    if (b.billing && typeof b.billing === 'object') (changes.push('billing details'), (plan.billing = { company: String(b.billing.company ?? ws.name).slice(0, 120), npwp: String(b.billing.npwp ?? '').slice(0, 40) || undefined, address: String(b.billing.address ?? '').slice(0, 400) || undefined, emails: (Array.isArray(b.billing.emails) ? b.billing.emails : []).map(String).filter((e: string) => e.includes('@')).slice(0, 5) }));
    if (!changes.length) return (json(res, 200, { ok: true }), true);
    saveWs({ ...ws, plan });
    platform.event('plan.changed', ws.id, null, changes.join('; '));
    log('company.plan', ws.id, changes.join('; '));
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/suspend' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    if (b.on === false) {
      saveWs({ ...ws, suspended: undefined });
      platform.event('company.unsuspended', ws.id, null);
      log('company.unsuspend', ws.id, ws.name);
    } else {
      const reason = String(b.reason ?? '').trim().slice(0, 300);
      saveWs({ ...ws, suspended: { at: now(), by: email, reason, why: b.why ?? 'other' } });
      platform.event('company.suspended', ws.id, null, `${b.why ?? 'other'}: ${reason}`);
      log('company.suspend', ws.id, `${ws.name} (${b.why ?? 'other'}): ${reason || 'no reason given'}`);
    }
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/internal' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids : [String(b.id ?? '')];
    const s = platform.settings();
    const set = new Set(s.internal);
    for (const id of ids) b.on ? set.add(id) : set.delete(id);
    platform.setSetting('internal', Array.from(set));
    log(b.on ? 'company.internal' : 'company.external', ids.join(','), `${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}`);
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/extend-trial' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids : [String(b.id ?? '')];
    const days = Math.max(1, Math.min(180, Number(b.days ?? 14)));
    for (const id of ids) {
      const ws = wsById(id);
      if (!ws?.plan || ws.plan.tier === 'free') continue;
      const from = ws.plan.trialEnds && ws.plan.trialEnds > now() ? Date.parse(ws.plan.trialEnds) : Date.now();
      saveWs({ ...ws, plan: { ...ws.plan, trialEnds: new Date(from + days * DAY).toISOString() } });
      log('company.plan', id, `trial +${days} days`);
    }
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/delete' && POST) {
    if (deny('danger')) return true;
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    if (String(b.confirm ?? '') !== ws.name) return (json(res, 400, { error: 'Type the company name exactly to confirm.' }), true);
    const gone = db.deleteWorkspaceDocs(ws.id, true);
    for (const [coll, ids] of Object.entries(gone)) ctx.broadcast(coll, [], ids);
    platform.event('company.deleted', ws.id, null, `${b.why ?? 'other'}: ${ws.name}`);
    log('company.delete', ws.id, `${ws.name} (${b.why ?? 'other'}): ${Object.entries(gone).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/reset' && POST) {
    if (deny('danger')) return true;
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    if (String(b.confirm ?? '') !== 'RESET') return (json(res, 400, { error: 'Type RESET to confirm.' }), true);
    const gone = db.deleteWorkspaceDocs(ws.id, false);
    for (const [coll, ids] of Object.entries(gone)) ctx.broadcast(coll, [], ids);
    saveWs({ ...ws, accounts: [], aliases: undefined, tabDefaults: undefined });
    log('company.reset', ws.id, `${ws.name}: ${Object.entries(gone).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/export' && GET) {
    if (deny('customers')) return true;
    const id = url.searchParams.get('id') ?? '';
    const ws = wsById(id);
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    const rows = db.db.prepare("SELECT coll, data FROM docs WHERE json_extract(data, '$.workspaceId') = ?").all(id) as { coll: string; data: string }[];
    const byColl: Record<string, unknown[]> = {};
    for (const r of rows) (byColl[r.coll] ??= []).push(JSON.parse(r.data));
    const memberIds = new Set((ws.members ?? []).map((m: any) => m.userId));
    const people = (db.allDocs('users') as any[]).filter((u) => memberIds.has(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email, title: u.title }));
    const files = db.db.prepare('SELECT id, name, type, size, at FROM files WHERE workspace_id = ?').all(id);
    log('company.export', id, ws.name);
    res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${String(ws.name).replace(/[^\w-]+/g, '-')}-export.json"` });
    res.end(JSON.stringify({ exportedAt: now(), company: ws, people, ...byColl, files }, null, 2));
    return true;
  }

  if (sub === 'company/delete-request' && POST) {
    if (deny('danger')) return true;
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    const s = platform.settings();
    if (b.cancel) {
      platform.setSetting('dataRequests', s.dataRequests.map((r) => (r.workspaceId === ws.id && !r.done && !r.cancelled ? { ...r, cancelled: now() } : r)));
      log('company.delete-request.cancel', ws.id, ws.name);
    } else {
      const days = Math.max(1, Math.min(90, Number(b.days ?? 30)));
      platform.setSetting('dataRequests', [...s.dataRequests, { id: 'dr-' + randomBytes(4).toString('hex'), workspaceId: ws.id, kind: 'delete', requestedBy: String(b.requestedBy ?? email).slice(0, 120), at: now(), runAt: new Date(Date.now() + days * DAY).toISOString() }]);
      log('company.delete-request', ws.id, `${ws.name}: deleted in ${days} days`);
    }
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/person' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    const mail = String(b.email ?? '').trim().toLowerCase();
    const name = String(b.name ?? '').trim() || mail.split('@')[0];
    const role = ['owner', 'admin', 'member'].includes(b.role) ? b.role : 'member';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return (json(res, 400, { error: 'That email doesn’t look right.' }), true);
    let u = (db.allDocs('users') as any[]).find((x) => emailOf(x) === mail && !x.deletedAt);
    if (u?.clientOf) return (json(res, 409, { error: 'That person is a guest; they can’t join a team with the same account.' }), true);
    if (!u) {
      u = { id: 'u-' + randomBytes(6).toString('hex'), name, email: mail, title: '', color: '#5b5bf6' };
      db.writeDocs('users', [u], [], ctx.me);
      ctx.broadcast('users', [u], []);
    }
    if ((ws.members ?? []).some((m: any) => m.userId === u.id)) return (json(res, 409, { error: 'Already in this company.' }), true);
    saveWs({ ...ws, members: [...(ws.members ?? []), { userId: u.id, role }] });
    const link = db.hasLogin(u.id) ? null : `${ctx.publicUrl}/?invite=${db.newInvite(u.id, mail)}`;
    log('company.person', ws.id, `${mail} added as ${role}`);
    return (json(res, 200, { link, userId: u.id }), true);
  }

  if (sub === 'note' && POST) {
    if (deny('support')) return true;
    const b = await body(req);
    if (b.delete) platform.deleteNote(String(b.delete));
    else if (b.pin !== undefined) platform.pinNote(String(b.id), !!b.pin);
    else {
      const text = String(b.text ?? '').trim();
      if (!text) return (json(res, 400, { error: 'Write something first.' }), true);
      platform.addNote(String(b.workspaceId), email, text);
      log('company.note', String(b.workspaceId), text.slice(0, 80));
    }
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'mailbox/unpause' && POST) {
    if (deny('platform')) return true;
    const b = await body(req);
    mailer.unpauseMailbox(String(b.workspaceId), String(b.accountId));
    log('mail.unpause', String(b.workspaceId), String(b.accountId));
    return (json(res, 200, { ok: true }), true);
  }

  /* ----- people ----- */
  if (sub === 'people' && GET) {
    const seen = db.lastSeen();
    const wss = db.allDocs('workspaces') as any[];
    const clients = db.allDocs('clients') as any[];
    const ops = new Map(platform.operators().filter((o) => !o.disabled).map((o) => [o.email, o.role]));
    const people = (db.allDocs('users') as any[])
      .filter((u) => !u.deletedAt)
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        title: u.title,
        color: u.color,
        companies: wss.filter((w) => (w.members ?? []).some((m: any) => m.userId === u.id)).map((w) => ({ id: w.id, name: w.name, role: w.members.find((m: any) => m.userId === u.id).role })),
        guestOf: u.clientOf ? [wss.find((w) => w.id === u.clientOf.workspaceId)?.name].filter(Boolean) : clients.filter((c) => (c.people ?? []).some((p: any) => p.email?.toLowerCase() === emailOf(u) && p.status === 'joined')).map((c) => wss.find((w) => w.id === c.workspaceId)?.name).filter(Boolean),
        lastSeen: seen.get(u.id) ?? null,
        hasLogin: db.hasLogin(u.id),
        twoStep: twostep.isOn(u.id),
        suspended: u.suspended ?? null,
        operator: ops.get(emailOf(u)) ?? null,
        disposable: platform.isDisposable(emailOf(u)),
      }))
      .sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.name.localeCompare(b.name));
    return (json(res, 200, { people }), true);
  }

  if (sub === 'person' && GET) {
    const id = url.searchParams.get('id') ?? '';
    const u = db.getDoc('users', id) as any;
    if (!u) return (json(res, 404, { error: 'No such person.' }), true);
    const wss = db.allDocs('workspaces') as any[];
    return (
      json(res, 200, {
        person: {
          id: u.id,
          name: u.name,
          email: u.email,
          title: u.title,
          color: u.color,
          deleted: !!u.deletedAt,
          suspended: u.suspended ?? null,
          hasLogin: db.hasLogin(u.id),
          twoStep: twostep.isOn(u.id),
          lastSeen: db.lastSeen().get(u.id) ?? null,
          operator: platform.operator(emailOf(u))?.role ?? null,
          disposable: platform.isDisposable(emailOf(u)),
          guestOf: u.clientOf ? wss.find((w) => w.id === u.clientOf.workspaceId)?.name ?? null : null,
          companies: wss.filter((w) => (w.members ?? []).some((m: any) => m.userId === u.id)).map((w) => ({ id: w.id, name: w.name, role: w.members.find((m: any) => m.userId === u.id).role })),
          sessions: platform.sessionsOf(u.id),
          tickets: support.ticketsOfUser(u.id, emailOf(u)).map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, updatedAt: t.updatedAt })),
          audit: db.auditList(50, u.id),
        },
      }),
      true
    );
  }

  if (sub === 'person/reset-code' && POST) {
    if (deny('impersonate')) return true;
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u?.email) return (json(res, 404, { error: 'No such person.' }), true);
    if (!db.hasLogin(u.id)) return (json(res, 409, { error: 'They have no sign-in yet; send an invite link instead.' }), true);
    const code = ctx.newCode();
    ctx.codes.set(`reset:${emailOf(u)}`, { code, until: Date.now() + 15 * 60_000, tries: 0 } as any);
    log('person.reset-code', u.id, emailOf(u));
    return (json(res, 200, { code, until: new Date(Date.now() + 15 * 60_000).toISOString() }), true);
  }
  // Lost their phone and their backup codes: two-step sign-in comes off, they're signed out everywhere, and told by email.
  if (sub === 'person/2fa-reset' && POST) {
    if (deny('impersonate')) return true;
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u) return (json(res, 404, { error: 'No such person.' }), true);
    if (!twostep.isOn(u.id)) return (json(res, 409, { error: 'Two-step sign-in isn’t on for them.' }), true);
    twostep.forget(u.id);
    db.endSessions(u.id);
    log('person.2fa-reset', u.id, `${emailOf(u)}${b.reason ? `: ${b.reason}` : ''}`);
    for (const w of db.allDocs('workspaces') as any[]) if ((w.members ?? []).some((m: any) => m.userId === u.id)) platform.event('security.2fa-reset', w.id, null, `${platform.settings().supportName} reset two-step sign-in for ${u.name}`);
    if (u.email)
      void mailer
        .sendSystemMail({ fromName: platform.settings().supportName, to: [emailOf(u)], subject: 'Your two-step sign-in was reset', text: `Hi ${String(u.name ?? '').split(' ')[0]},\n\nWe reset two-step sign-in on your sprint2go account, as you asked, so it no longer asks for a code from your authenticator app. You can turn it on again in Settings, Account (your company may ask you to straight away).\n\nIf you didn’t ask for this, reply to this email now.` })
        .catch(() => {});
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'person/invite' && POST) {
    if (deny('impersonate')) return true;
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u?.email) return (json(res, 404, { error: 'No such person.' }), true);
    if (db.hasLogin(u.id)) return (json(res, 409, { error: 'They already sign in; send a reset code instead.' }), true);
    log('person.invite', u.id, emailOf(u));
    return (json(res, 200, { link: `${ctx.publicUrl}/?invite=${db.newInvite(u.id, emailOf(u))}` }), true);
  }
  if (sub === 'person/suspend' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u) return (json(res, 404, { error: 'No such person.' }), true);
    if (platform.operator(emailOf(u))) return (json(res, 403, { error: 'Remove them from the operator team first.' }), true);
    const next = b.on === false ? { ...u, suspended: undefined } : { ...u, suspended: { at: now(), by: email, reason: String(b.reason ?? '').slice(0, 300) } };
    db.writeDocs('users', [next], [], ctx.me);
    ctx.broadcast('users', [next], []);
    if (b.on !== false) db.endSessions(u.id);
    log(b.on === false ? 'person.unsuspend' : 'person.suspend', u.id, `${emailOf(u)}${b.reason ? `: ${b.reason}` : ''}`);
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'person/role' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!ws || !u) return (json(res, 404, { error: 'No such company or person.' }), true);
    const role = ['owner', 'admin', 'member'].includes(b.role) ? b.role : 'owner';
    const members = (ws.members ?? []).map((m: any) => (m.userId === u.id ? { ...m, role } : m));
    if (!members.some((m: any) => m.userId === u.id)) members.push({ userId: u.id, role });
    saveWs({ ...ws, members });
    log('person.role', u.id, `${emailOf(u)} is now ${role} of ${ws.name}`);
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'person/end-session' && POST) {
    if (deny('customers')) return true;
    const b = await body(req);
    platform.endSessionById(String(b.userId), String(b.sessionId));
    log('person.end-session', String(b.userId));
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'person/signin-as' && POST) {
    if (deny('impersonate')) return true;
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u || u.deletedAt) return (json(res, 404, { error: 'No such person.' }), true);
    if (u.suspended) return (json(res, 409, { error: 'That account is suspended.' }), true);
    if (platform.operator(emailOf(u)) && op.role !== 'owner') return (json(res, 403, { error: 'Only an owner can sign in as another operator.' }), true);
    ctx.setSession(res, db.newSession(u.id, email));
    log('person.signin-as', u.id, `${emailOf(u)} (${u.name})${b.ticket ? ` for ticket #${b.ticket}` : ''}`);
    return (json(res, 200, { ok: true }), true);
  }

  /* ----- tickets ----- */
  if (sub === 'tickets' && GET) {
    const wss = new Map((db.allDocs('workspaces') as any[]).map((w) => [w.id, w.name]));
    return (
      json(res, 200, {
        tickets: support
          .tickets()
          .filter((t) => !t.mergedInto)
          .map((t) => ({ ...t, company: t.workspaceId ? wss.get(t.workspaceId) ?? null : null, context: undefined, breaching: !t.firstReplyAt && !!t.dueAt && t.dueAt < now() && (t.status === 'new' || t.status === 'open') })),
        operators: platform.operators().filter((o) => !o.disabled && platform.permsOf(o.role).includes('support')).map((o) => o.email),
        stats: support.stats(new Date(Date.now() - 30 * DAY).toISOString()),
      }),
      true
    );
  }
  if (sub === 'ticket' && GET) {
    const t = support.ticket(url.searchParams.get('id') ?? '');
    if (!t) return (json(res, 404, { error: 'No such ticket.' }), true);
    const company = t.workspaceId ? companyRows(ctx).find((c) => c.id === t.workspaceId) ?? null : null;
    const others = support.ticketsOfUser(t.requester.userId ?? '', t.requester.email).filter((x) => x.id !== t.id).map((x) => ({ id: x.id, number: x.number, subject: x.subject, status: x.status, updatedAt: x.updatedAt }));
    const user = t.requester.userId ? (db.getDoc('users', t.requester.userId) as any) : (db.allDocs('users') as any[]).find((u) => emailOf(u) === t.requester.email);
    return (
      json(res, 200, {
        ticket: { ...t, breaching: !t.firstReplyAt && !!t.dueAt && t.dueAt < now() && (t.status === 'new' || t.status === 'open') },
        messages: support.messagesOf(t.id, true),
        company: company ? { id: company.id, name: company.name, color: company.color, plan: company.plan, state: company.state, mrr: company.mrr, after: company.after, people: company.people, health: company.health, lastActive: company.lastActive } : null,
        person: user ? { id: user.id, name: user.name, email: user.email, color: user.color, lastSeen: db.lastSeen().get(user.id) ?? null, companies: (db.allDocs('workspaces') as any[]).filter((w) => (w.members ?? []).some((m: any) => m.userId === user.id)).map((w) => ({ id: w.id, name: w.name })) } : null,
        others,
        macros: support.macros(),
        operators: platform.operators().filter((o) => !o.disabled && platform.permsOf(o.role).includes('support')).map((o) => o.email),
      }),
      true
    );
  }
  if (sub === 'ticket/reply' && POST) {
    if (deny('support')) return true;
    const b = await body(req);
    const t = support.ticket(String(b.id ?? ''));
    if (!t) return (json(res, 404, { error: 'No such ticket.' }), true);
    const text = String(b.body ?? '').trim();
    if (!text) return (json(res, 400, { error: 'Write a reply first.' }), true);
    const internal = !!b.internal;
    const attachments = (Array.isArray(b.attachments) ? b.attachments : []).filter((a: any) => a && typeof a.url === 'string').map((a: any) => ({ name: String(a.name ?? 'file').slice(0, 200), url: String(a.url), size: a.size ? String(a.size) : undefined }));
    let mid: string | null = null;
    if (!internal) {
      // By email when it came by email or they haven't been in the app since; always in the app's Help.
      const user = t.requester.userId ? (db.getDoc('users', t.requester.userId) as any) : null;
      const seen = user ? db.lastSeen().get(user.id) : null;
      const byEmail = t.channel === 'email' || !seen || seen < t.updatedAt;
      if (byEmail) {
        const thread = support.messagesOf(t.id, false);
        const refs = [t.lastMid].filter(Boolean) as string[];
        const quoted = thread
          .slice(-3)
          .reverse()
          .map((m) => `On ${m.at.slice(0, 16).replace('T', ' ')}, ${m.authorName ?? m.author} wrote:\n${m.body.split('\n').map((l) => `> ${l}`).join('\n')}`)
          .join('\n\n');
        mid = await mailer
          .sendSystemMail({ fromName: platform.settings().supportName, to: [t.requester.email], subject: `Re: ${t.subject} [#${t.number}]`, text: `${text}\n\n${meDoc?.name ?? 'sprint2go Support'}\n\n${quoted}`, inReplyTo: t.lastMid ?? undefined, references: refs })
          .catch(() => null);
      }
      if (user) ctx.notifyUsers([user.id], `Support replied to “${t.subject.slice(0, 60)}”`, '/settings/help');
    }
    support.addMessage(t.id, { kind: 'operator', author: email, authorName: meDoc?.name ?? email, body: text, internal, attachments, mid: mid ?? undefined });
    if (!internal) support.operatorReplied(t.id, (['open', 'waiting', 'resolved'].includes(b.status) ? b.status : 'waiting') as support.Status, mid);
    else if (b.status && ['new', 'open', 'waiting', 'resolved', 'closed'].includes(b.status)) support.update(t.id, { status: b.status });
    if (!t.assignee) support.update(t.id, { assignee: email });
    log(internal ? 'ticket.note' : 'ticket.reply', t.id, `#${t.number}`);
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'ticket/update' && POST) {
    if (deny('support')) return true;
    const b = await body(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids : [String(b.id ?? '')];
    const patch: any = {};
    if (b.status && ['new', 'open', 'waiting', 'resolved', 'closed'].includes(b.status)) patch.status = b.status;
    if (b.priority && ['low', 'normal', 'high', 'urgent'].includes(b.priority)) patch.priority = b.priority;
    if ('assignee' in b) patch.assignee = b.assignee || null;
    if (Array.isArray(b.tags)) patch.tags = b.tags.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean);
    if (typeof b.subject === 'string' && b.subject.trim()) patch.subject = b.subject.trim();
    if ('workspaceId' in b) patch.workspaceId = b.workspaceId || null;
    for (const id of ids) {
      const t = support.update(id, patch);
      if (t && patch.assignee && patch.assignee !== email) {
        const u = (db.allDocs('users') as any[]).find((x) => emailOf(x) === patch.assignee);
        if (u) ctx.notifyUsers([u.id], `${meDoc?.name ?? email} gave you ticket #${t.number}: ${t.subject.slice(0, 60)}`, `/admin/tickets/${t.id}`);
      }
    }
    log('ticket.update', ids.join(','), JSON.stringify(patch).slice(0, 200));
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'ticket/merge' && POST) {
    if (deny('support')) return true;
    const b = await body(req);
    const from = support.ticket(String(b.id ?? ''));
    const into = support.ticket(String(b.into ?? ''));
    if (!from || !into || from.id === into.id) return (json(res, 400, { error: 'Pick another ticket to merge into.' }), true);
    support.merge(from.id, into.id);
    log('ticket.merge', into.id, `#${from.number} into #${into.number}`);
    return (json(res, 200, { id: into.id }), true);
  }
  if (sub === 'ticket/create' && POST) {
    if (deny('support')) return true;
    const b = await body(req);
    const mail = String(b.email ?? '').trim().toLowerCase();
    if (!mail.includes('@') || !String(b.subject ?? '').trim()) return (json(res, 400, { error: 'An email and a subject, please.' }), true);
    const u = (db.allDocs('users') as any[]).find((x) => emailOf(x) === mail && !x.deletedAt);
    const ws = u ? (db.allDocs('workspaces') as any[]).find((w) => (w.members ?? []).some((m: any) => m.userId === u.id)) : null;
    const t = support.createTicket({ subject: String(b.subject), body: String(b.body ?? '').trim() || '(logged by support)', channel: 'email', email: mail, name: u?.name ?? null, userId: u?.id ?? null, workspaceId: ws?.id ?? null, paying: ws ? mrrOf(ws, 1).state === 'paying' : false, priority: b.priority });
    support.update(t.id, { assignee: email });
    log('ticket.create', t.id, `#${t.number} for ${mail}`);
    return (json(res, 200, { id: t.id }), true);
  }
  if (sub === 'macros' && GET) return (json(res, 200, { macros: support.macros() }), true);
  if (sub === 'macro' && POST) {
    if (deny('support')) return true;
    const b = await body(req);
    if (b.delete) support.deleteMacro(String(b.delete));
    else {
      if (!String(b.title ?? '').trim() || !String(b.body ?? '').trim()) return (json(res, 400, { error: 'A title and the reply, please.' }), true);
      support.saveMacro({ id: b.id, title: String(b.title).trim(), body: String(b.body) }, email);
    }
    log('macro.save', null, String(b.title ?? b.delete ?? '').slice(0, 80));
    return (json(res, 200, { ok: true }), true);
  }

  /* ----- money ----- */
  if (sub === 'revenue' && GET) {
    const companies = companyRows(ctx).filter((c) => !c.internal);
    const months = lastMonths(6);
    const snaps = platform.mrrByMonth(lastMonths(7));
    const movement = months.map((m, i) => {
      const prevKey = lastMonths(7)[i];
      const prev = snaps[prevKey] ?? new Map<string, number>();
      const cur = snaps[m] ?? new Map<string, number>();
      const mv = { month: m, mrr: 0, new: 0, expansion: 0, contraction: 0, churn: 0 };
      for (const id of new Set([...prev.keys(), ...cur.keys()])) {
        const a = prev.get(id) ?? 0,
          b = cur.get(id) ?? 0;
        mv.mrr += b;
        if (!a && b) mv.new += b;
        else if (a && !b) mv.churn += a;
        else if (b > a) mv.expansion += b - a;
        else if (b < a) mv.contraction += a - b;
      }
      return mv;
    });
    movement[movement.length - 1].mrr = companies.reduce((n, c) => n + c.mrr, 0);
    const byTier: Record<string, { companies: number; mrr: number }> = {};
    for (const c of companies) {
      const key = c.plan ? planName(c.plan as any) : 'Free';
      byTier[key] ??= { companies: 0, mrr: 0 };
      byTier[key].companies++;
      byTier[key].mrr += c.mrr;
    }
    const churnReasons: Record<string, number> = {};
    for (const e of platform.eventsSince(monthStart(-11), ['company.suspended', 'company.deleted'])) {
      const why = (e.detail ?? 'other').split(':')[0] || 'other';
      churnReasons[why] = (churnReasons[why] ?? 0) + 1;
    }
    const inv = platform.invoices();
    const thisMonth = inv.filter((i) => i.period === monthStart().slice(0, 7) && i.status !== 'void');
    return (
      json(res, 200, {
        mrr: companies.reduce((n, c) => n + c.mrr, 0),
        paying: companies.filter((c) => c.state === 'paying').length,
        trials: { count: companies.filter((c) => c.state === 'trial').length, after: companies.filter((c) => c.state === 'trial').reduce((n, c) => n + (c.after ?? 0), 0) },
        comped: companies.filter((c) => c.state === 'comp').length,
        paused: companies.filter((c) => c.state === 'paused').length,
        discounts: companies.reduce((n, c) => n + (c.discount ?? 0), 0),
        movement,
        byTier,
        churnReasons,
        invoiced: { month: monthStart().slice(0, 7), total: thisMonth.reduce((n, i) => n + i.total, 0), paid: thisMonth.filter((i) => i.status === 'paid').reduce((n, i) => n + i.total, 0), overdue: platform.overdueInvoices().reduce((n, i) => n + i.total, 0) },
        companies: companies.filter((c) => c.mrr > 0 || c.after).sort((a, b) => b.mrr - a.mrr || (b.after ?? 0) - (a.after ?? 0)),
        paymentsLive: false,
      }),
      true
    );
  }
  if (sub === 'invoices' && GET) {
    const names = new Map((db.allDocs('workspaces') as any[]).map((w) => [w.id, w.name]));
    return (json(res, 200, { invoices: platform.invoices().map((i) => ({ ...i, company: names.get(i.workspaceId) ?? '(deleted)', overdue: i.status === 'sent' && i.dueAt < now() })) }), true);
  }
  if (sub === 'invoice.html' && GET) {
    const inv = platform.invoice(url.searchParams.get('id') ?? '');
    if (!inv) return (json(res, 404, { error: 'No such invoice.' }), true);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
    res.end(invoiceHtml(inv, (wsById(inv.workspaceId) as any)?.name ?? ''));
    return true;
  }
  if (sub === 'invoice/create' && POST) {
    if (deny('billing')) return true;
    const b = await body(req);
    const ws = wsById(String(b.workspaceId ?? ''));
    if (!ws?.plan) return (json(res, 404, { error: 'No such company, or it has no plan.' }), true);
    const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.period ?? '')) ? String(b.period) : monthStart().slice(0, 7);
    const auto = invoiceLinesFor(ws, period);
    const custom = Array.isArray(b.lines) && b.lines.length;
    const lines = custom ? b.lines.map((l: any) => ({ text: String(l.text ?? '').slice(0, 200), amount: Math.round(Number(l.amount) || 0) })).filter((l: any) => l.text) : auto.lines;
    const inv = platform.createInvoice({ workspaceId: ws.id, period, lines, discount: 'discount' in b ? Number(b.discount) || 0 : auto.discount, dueDays: Number(b.dueDays ?? 14), billTo: ws.plan.billing ?? { company: ws.name, emails: [] }, by: email, note: b.note ?? (custom ? undefined : auto.note) });
    log('invoice.create', ws.id, `${inv.number} ${rp(inv.total)}`);
    return (json(res, 200, { id: inv.id }), true);
  }
  if (sub === 'invoice/generate' && POST) {
    if (deny('billing')) return true;
    const period = monthStart().slice(0, 7);
    // The month's plan invoice (an invoice for Boosted credits bought this month doesn't count as one).
    const done = new Set(platform.invoices().filter((i) => i.period === period && i.status !== 'void' && !billing.isCreditInvoice(i.id)).map((i) => i.workspaceId));
    let made = 0;
    for (const c of companyRows(ctx)) {
      if (c.internal || c.state !== 'paying' || done.has(c.id)) continue;
      const ws = wsById(c.id);
      const auto = invoiceLinesFor(ws, period);
      platform.createInvoice({ workspaceId: c.id, period, lines: auto.lines, discount: auto.discount, dueDays: 14, billTo: ws.plan.billing ?? { company: ws.name, emails: [] }, by: email, note: auto.note });
      if (ws.plan.topUps) saveWs({ ...ws, plan: { ...ws.plan, topUps: 0 } }); // invoiced: the count starts again
      made++;
    }
    log('invoice.generate', null, `${made} drafts for ${period}`);
    return (json(res, 200, { made }), true);
  }
  if (sub === 'invoice/status' && POST) {
    if (deny('billing')) return true;
    const b = await body(req);
    const inv = platform.invoice(String(b.id ?? ''));
    if (!inv) return (json(res, 404, { error: 'No such invoice.' }), true);
    if (b.status === 'sent') {
      const ws = wsById(inv.workspaceId);
      const to = inv.billTo?.emails?.length ? inv.billTo.emails : (ws?.members ?? []).filter((m: any) => m.role === 'owner').map((m: any) => emailOf(db.getDoc('users', m.userId))).filter(Boolean);
      if (!to.length) return (json(res, 400, { error: 'This company has no billing email. Add one on its Billing tab.' }), true);
      const html = invoiceHtml(inv, ws?.name ?? '');
      await mailer.sendSystemMail({ fromName: platform.settings().billing.name || 'sprint2go', to, subject: `Invoice ${inv.number} from ${platform.settings().billing.name || 'sprint2go'}: ${rp(inv.total)}`, text: `Hello,\n\nYour invoice ${inv.number} for ${rp(inv.total)} is attached, due ${inv.dueAt.slice(0, 10)}.\n\nThank you.`, attachments: [{ filename: `${inv.number}.html`, content: Buffer.from(html), contentType: 'text/html' }] }).catch(() => null);
      for (const m of (ws?.members ?? []).filter((x: any) => x.role !== 'member')) ctx.notifyUsers([m.userId], `Invoice ${inv.number}: ${rp(inv.total)}, due ${inv.dueAt.slice(0, 10)}`, '/settings/billing', ws.id);
    }
    const next = platform.setInvoiceStatus(inv.id, b.status, b.method);
    if (b.status === 'paid') platform.event('invoice.paid', inv.workspaceId, null, `${inv.number} ${rp(inv.total)}`);
    // A paid credits invoice adds its Boosted emails to the company (once); a voided one cancels the order.
    if (b.status === 'paid') {
      const added = billing.invoicePaid(inv.id, saveWs, (ids, text, wsId) => ctx.notifyUsers(ids, text, '/settings/email', wsId));
      if (added !== null) log('credits.added', inv.workspaceId, `${inv.number}: balance ${added}`);
    }
    if (b.status === 'void') billing.invoiceVoided(inv.id);
    log(`invoice.${b.status}`, inv.workspaceId, inv.number);
    return (json(res, 200, { invoice: next }), true);
  }
  if (sub === 'pricing' && GET) return (json(res, 200, { prices: PRICES, addons: Object.fromEntries(Object.entries(ADDONS).map(([k, v]) => [k, v.price])), topUp: TOP_UP.price, defaults: DEFAULT_PRICES, overridden: !!platform.settings().pricing }), true);
  if (sub === 'pricing' && POST) {
    if (deny('billing')) return true;
    const b = await body(req);
    if (b.reset) {
      platform.setSetting('pricing', undefined as any);
      applyPricing(DEFAULT_PRICES);
      log('pricing.reset', null);
    } else {
      const o = { prices: b.prices, addons: b.addons, topUp: b.topUp };
      platform.setSetting('pricing', o);
      applyPricing(o);
      log('pricing.save', null, JSON.stringify(o).slice(0, 300));
    }
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'coupons' && GET) return (json(res, 200, { coupons: platform.coupons() }), true);
  if (sub === 'coupon' && POST) {
    if (deny('billing')) return true;
    const b = await body(req);
    try {
      if (b.apply) {
        const ws = wsById(String(b.workspaceId ?? ''));
        if (!ws?.plan) return (json(res, 404, { error: 'No such company, or it has no plan.' }), true);
        const ok = platform.couponUsable(String(b.apply));
        if (!ok.ok) return (json(res, 400, { error: ok.error }), true);
        saveWs({ ...ws, plan: applyCoupon(ws.plan, ok.coupon) });
        platform.useCoupon(ok.coupon.code);
        log('coupon.apply', ws.id, ok.coupon.code);
      } else {
        const c = platform.saveCoupon({ code: String(b.code ?? ''), kind: ['percent', 'amount', 'months'].includes(b.kind) ? b.kind : 'percent', value: Number(b.value) || 0, months: b.months ? Number(b.months) : null, maxUses: b.maxUses ? Number(b.maxUses) : null, expiresAt: b.expiresAt || null, note: b.note || null, active: b.active !== false }, email);
        log('coupon.save', null, `${c.code} ${c.kind} ${c.value}`);
      }
    } catch (e) {
      return (json(res, 400, { error: e instanceof Error ? e.message : 'Could not save.' }), true);
    }
    return (json(res, 200, { ok: true }), true);
  }

  /* ----- growth ----- */
  if (sub === 'growth' && GET) {
    const days = Math.max(7, Math.min(365, Number(url.searchParams.get('days') ?? 30)));
    const since = new Date(Date.now() - days * DAY).toISOString();
    const internal = new Set([platform.settings().homeWorkspace, ...platform.settings().internal].filter(Boolean) as string[]);
    const ev = platform.eventsSince(since).filter((e) => !e.workspaceId || !internal.has(e.workspaceId));
    const count = (type: string) => ev.filter((e) => e.type === type).length;
    const views = platform.viewsSince(since);
    const visits = views.filter((v) => v.path === '/').reduce((n, v) => n + v.n, 0);
    const companies = companyRows(ctx).filter((c) => !c.internal);
    const created = companies.filter((c) => c.since && c.since >= since);
    const createdIds = new Set(created.map((c) => c.id));
    const evOf = (type: string) => new Set(platform.eventsSince(since, [type]).map((e) => e.workspaceId));
    const funnel = [
      { key: 'visits', label: 'Visited the landing page', n: visits },
      { key: 'started', label: 'Started signing up', n: count('signup.started') },
      { key: 'verified', label: 'Confirmed their email', n: count('signup.verified') },
      { key: 'company', label: 'Created a company', n: created.length },
      { key: 'invited', label: 'Invited their team', n: [...evOf('team.invited')].filter((id) => id && createdIds.has(id)).length },
      { key: 'used', label: 'Used it for real', n: [...evOf('first.use')].filter((id) => id && createdIds.has(id)).length },
      { key: 'paid', label: 'Paying', n: created.filter((c) => c.state === 'paying').length },
    ];
    const sources: Record<string, { visits: number; signups: number }> = {};
    for (const v of views.filter((x) => x.path === '/')) (sources[v.source] ??= { visits: 0, signups: 0 }).visits += v.n;
    for (const e of ev.filter((x) => x.type === 'signup.verified')) (sources[(e.detail ?? 'direct') || 'direct'] ??= { visits: 0, signups: 0 }).signups++;
    // Weekly cohorts of new companies: share with anyone active in each later week.
    const act = platform.activeDaysSince(new Date(Date.now() - 70 * DAY).toISOString());
    const wss = db.allDocs('workspaces') as any[];
    const weekStart = (d: Date) => {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      return x;
    };
    const cohorts = Array.from({ length: 8 }, (_, i) => {
      const start = weekStart(new Date(Date.now() - (7 - i) * 7 * DAY));
      const end = new Date(start.getTime() + 7 * DAY);
      const members = companies.filter((c) => c.since && c.since >= start.toISOString() && c.since < end.toISOString());
      const weeks = Array.from({ length: 8 - i }, (_, k) => {
        const ws0 = new Date(start.getTime() + k * 7 * DAY).toISOString().slice(0, 10);
        const ws1 = new Date(start.getTime() + (k + 1) * 7 * DAY).toISOString().slice(0, 10);
        if (!members.length) return null;
        const active = members.filter((c) => {
          const ids = new Set((wss.find((w) => w.id === c.id)?.members ?? []).map((m: any) => m.userId));
          return act.some((a) => ids.has(a.userId) && a.day >= ws0 && a.day < ws1);
        }).length;
        return Math.round((active / members.length) * 100);
      });
      return { week: start.toISOString().slice(0, 10), companies: members.length, weeks };
    });
    const appRows = db.db.prepare("SELECT coll, json_extract(data, '$.workspaceId') AS ws FROM docs WHERE updated_at >= ? AND json_extract(data, '$.workspaceId') IS NOT NULL GROUP BY coll, ws").all(new Date(Date.now() - 30 * DAY).toISOString()) as { coll: string; ws: string }[];
    const realIds = new Set(companies.map((c) => c.id));
    const APP: Record<string, string> = { threads: 'Mail', messages: 'Chat', todos: 'Tasks', clients: 'Projects', events: 'Calendar', drive: 'Drive', meetings: 'Meet', tables: 'Tables', notes: 'Notes', quotes: 'Quotes' };
    const apps = Object.entries(APP).map(([coll, label]) => ({ label, companies: new Set(appRows.filter((r) => r.coll === coll && realIds.has(r.ws)).map((r) => r.ws)).size }));
    const trialEnded = companies.filter((c) => c.plan?.trialEnds && c.plan.trialEnds < now() && c.plan.trialEnds >= since);
    return (
      json(res, 200, {
        days,
        funnel,
        sources: Object.entries(sources)
          .map(([source, v]) => ({ source, ...v }))
          .sort((a, b) => b.visits + b.signups * 10 - (a.visits + a.signups * 10)),
        cohorts,
        apps: { total: companies.length, rows: apps.sort((a, b) => b.companies - a.companies) },
        trials: { ended: trialEnded.length, converted: trialEnded.filter((c) => c.state === 'paying').length },
      }),
      true
    );
  }

  /* ----- product: announcements, flags, broadcasts, maintenance ----- */
  if (sub === 'product' && GET) {
    const s = platform.settings();
    return (json(res, 200, { announcements: s.announcements, flags: s.flags, broadcasts: s.broadcasts, maintenance: s.maintenance, companies: companyRows(ctx).map((c) => ({ id: c.id, name: c.name })) }), true);
  }
  if (sub === 'announcement' && POST) {
    if (deny('product')) return true;
    const b = await body(req);
    const s = platform.settings();
    if (b.delete) platform.setSetting('announcements', s.announcements.filter((a) => a.id !== b.delete));
    else {
      const a = { id: b.id || 'an-' + randomBytes(4).toString('hex'), text: String(b.text ?? '').slice(0, 300), link: b.link ? String(b.link).slice(0, 300) : undefined, kind: b.kind === 'warning' ? ('warning' as const) : ('news' as const), audience: ['all', 'owners', 'paying', 'trial', 'list'].includes(b.audience) ? b.audience : 'all', companies: Array.isArray(b.companies) ? b.companies.map(String) : [], from: b.from || now(), until: b.until || undefined, createdBy: email };
      if (!a.text) return (json(res, 400, { error: 'Write the announcement first.' }), true);
      platform.setSetting('announcements', [a, ...s.announcements.filter((x) => x.id !== a.id)]);
    }
    log('announcement.save', null, String(b.text ?? b.delete ?? '').slice(0, 80));
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'flag' && POST) {
    if (deny('product')) return true;
    const b = await body(req);
    const s = platform.settings();
    const flags = { ...s.flags };
    const key = String(b.key ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!key) return (json(res, 400, { error: 'Give the flag a name.' }), true);
    if (b.delete) delete flags[key];
    else flags[key] = { description: String(b.description ?? '').slice(0, 200), mode: ['off', 'on', 'list', 'percent'].includes(b.mode) ? b.mode : 'off', companies: Array.isArray(b.companies) ? b.companies.map(String) : [], percent: Math.max(0, Math.min(100, Number(b.percent) || 0)) };
    platform.setSetting('flags', flags);
    log('flag.save', null, `${key}: ${b.delete ? 'deleted' : flags[key].mode}`);
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'maintenance' && POST) {
    if (deny('product')) return true;
    const b = await body(req);
    platform.setSetting('maintenance', { on: !!b.on, message: String(b.message ?? '').slice(0, 300) });
    log(b.on ? 'maintenance.on' : 'maintenance.off', null, b.message);
    return (json(res, 200, { ok: true }), true);
  }
  if ((sub === 'broadcast/preview' || sub === 'broadcast/send') && POST) {
    if (deny('product')) return true;
    const b = await body(req);
    const companies = companyRows(ctx).filter((c) => !c.internal && !c.suspended && c.owner);
    const audience = String(b.audience ?? 'all');
    const picked = companies.filter((c) => (audience === 'paying' ? c.state === 'paying' : audience === 'trial' ? c.state === 'trial' : audience === 'risk' ? c.health.label === 'risk' : true));
    const to = Array.from(new Set(picked.map((c) => emailOf(c.owner))));
    if (sub === 'broadcast/preview') return (json(res, 200, { count: to.length, sample: to.slice(0, 5) }), true);
    const subject = String(b.subject ?? '').trim();
    const text = String(b.body ?? '').trim();
    if (!subject || !text) return (json(res, 400, { error: 'A subject and a message, please.' }), true);
    for (const addr of to) await mailer.sendSystemMail({ fromName: platform.settings().supportName, to: [addr], subject, text: `${text}\n\nYou get this because you own a company on sprint2go.` }).catch(() => null);
    const s = platform.settings();
    platform.setSetting('broadcasts', [{ id: 'bc-' + randomBytes(4).toString('hex'), subject, audience, sent: to.length, at: now(), by: email }, ...s.broadcasts].slice(0, 100));
    log('broadcast.send', null, `${subject} to ${to.length} owners (${audience})`);
    return (json(res, 200, { sent: to.length }), true);
  }

  /* ----- platform ----- */
  if (sub === 'system' && GET) {
    const info = systemInfo(ctx);
    const h = ctx.recorder.configured ? await ctx.recorder.health() : null;
    return (json(res, 200, { ...info, recorder: { configured: ctx.recorder.configured, reachable: !!h?.ok, bots: h?.bots ?? null }, relay: await turn.health(), warnings: await warnings(ctx), alerts: platform.recentAlerts(), backupTest: platform.settings().backupTest }), true);
  }
  if (sub === 'mail' && GET) {
    const names = new Map((db.allDocs('workspaces') as any[]).map((w) => [w.id, w.name]));
    const stats = mailer.mailStatsAll(monthStart());
    const sum = (f: (r: (typeof stats)[number]) => boolean) => stats.filter(f).reduce((n, r) => n + r.n, 0);
    return (
      json(res, 200, {
        host: mailer.MAIL_HOST,
        ip: mailer.MAIL_IP,
        supportEmail: mailer.SUPPORT_EMAIL,
        limits: mailer.LIMITS,
        health: await mailer.serverHealth(),
        cert: certState(mailer.MAIL_HOST),
        blocklists: await mailer.blocklists(),
        queued: mailer.queue('queued').map((q) => ({ ...q, company: names.get(q.workspaceId) ?? (q.workspaceId === 'platform' ? 'sprint2go' : q.workspaceId) })),
        failed: mailer.queue('failed', 100).map((q) => ({ ...q, company: names.get(q.workspaceId) ?? (q.workspaceId === 'platform' ? 'sprint2go' : q.workspaceId) })),
        paused: mailer.pausedMailboxes(),
        month: { in: sum((r) => r.direction === 'in'), out: sum((r) => r.direction === 'out' && r.state === 'sent'), failed: sum((r) => r.direction === 'out' && r.state === 'failed'), spam: sum((r) => r.direction === 'in' && r.route === 'spam'), boosted: sum((r) => r.direction === 'out' && r.route === 'boosted' && r.state === 'sent') },
      }),
      true
    );
  }
  if (sub === 'mail/retry' && POST) {
    if (deny('platform')) return true;
    const b = await body(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids : [String(b.id)];
    for (const id of ids) b.drop ? mailer.dropQueued(id) : mailer.retryNow(id);
    log(b.drop ? 'mail.drop' : 'mail.retry', null, `${ids.length} messages`);
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'errors' && GET) {
    const names = new Map((db.allDocs('workspaces') as any[]).map((w) => [w.id, w.name]));
    return (json(res, 200, { errors: platform.errorGroups().map((e) => ({ ...e, companies: e.workspaces.map((w) => names.get(w) ?? w).slice(0, 8), workspaces: e.workspaces.length })) }), true);
  }
  if (sub === 'error/resolve' && POST) {
    if (deny('platform')) return true;
    const b = await body(req);
    for (const id of Array.isArray(b.ids) ? b.ids : [b.id]) platform.resolveError(String(id));
    log('error.resolve', null, String(b.id ?? (b.ids ?? []).length));
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'backup/now' && POST) {
    if (deny('platform')) return true;
    const file = await db.backup(`manual-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`);
    log('system.backup', null, file.split('/').pop());
    return (json(res, 200, { file: file.split('/').pop() }), true);
  }
  if (sub === 'backup/test' && POST) {
    if (deny('platform')) return true;
    const result = testLatestBackup();
    log('system.backup-test', null, `${result.file}: ${result.ok ? 'ok' : result.detail}`);
    return (json(res, 200, result), true);
  }
  if (sub === 'backup' && GET) {
    if (deny('platform')) return true;
    const file = (url.searchParams.get('file') ?? '').replace(/[^a-z0-9._-]/gi, '');
    const path = join(db.dataDir, 'backups', file);
    if (!file || !existsSync(path)) return (json(res, 404, { error: 'No such backup.' }), true);
    log('system.backup-download', null, file);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${file}"`, 'content-length': statSync(path).size });
    res.end(readFileSync(path));
    return true;
  }

  /* ----- team, settings, audit ----- */
  if (sub === 'team' && GET) {
    const users = db.allDocs('users') as any[];
    const seen = db.lastSeen();
    return (
      json(res, 200, {
        operators: platform.operators().map((o) => {
          const u = users.find((x) => emailOf(x) === o.email);
          return { ...o, name: u?.name ?? null, userId: u?.id ?? null, color: u?.color ?? null, hasLogin: u ? db.hasLogin(u.id) : false, lastSeen: u ? seen.get(u.id) ?? null : null, sessions: u ? platform.sessionsOf(u.id).length : 0 };
        }),
        me: email,
        role: op.role,
      }),
      true
    );
  }
  if (sub === 'team/save' && POST) {
    if (deny('team')) return true;
    const b = await body(req);
    const mail = String(b.email ?? '').trim().toLowerCase();
    const role = (platform.ROLES.includes(b.role) ? b.role : 'support') as platform.OpRole;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return (json(res, 400, { error: 'That email doesn’t look right.' }), true);
    const cur = platform.operator(mail);
    if ((role === 'owner' || cur?.role === 'owner') && op.role !== 'owner') return (json(res, 403, { error: 'Only an owner can make or change owners.' }), true);
    if (cur?.role === 'owner' && role !== 'owner' && platform.operators().filter((o) => o.role === 'owner' && !o.disabled).length < 2) return (json(res, 409, { error: 'Keep at least one owner.' }), true);
    platform.saveOperator(mail, role, email);
    // They need an account in the app; new ones get an invite link, and join our own company if one is set.
    let u = (db.allDocs('users') as any[]).find((x) => emailOf(x) === mail && !x.deletedAt);
    if (!u) {
      u = { id: 'u-' + randomBytes(6).toString('hex'), name: String(b.name ?? '').trim() || mail.split('@')[0], email: mail, title: 'sprint2go', color: '#2448ff' };
      db.writeDocs('users', [u], [], ctx.me);
      ctx.broadcast('users', [u], []);
    }
    const home = platform.settings().homeWorkspace;
    const hws = home ? wsById(home) : null;
    if (hws && !(hws.members ?? []).some((m: any) => m.userId === u.id)) saveWs({ ...hws, members: [...hws.members, { userId: u.id, role: 'member' }] });
    const link = db.hasLogin(u.id) ? null : `${ctx.publicUrl}/?invite=${db.newInvite(u.id, mail)}`;
    log(cur ? 'team.role' : 'team.add', mail, role);
    return (json(res, 200, { link }), true);
  }
  if (sub === 'team/remove' && POST) {
    if (deny('team')) return true;
    const b = await body(req);
    const target = platform.operator(String(b.email ?? ''));
    if (!target) return (json(res, 404, { error: 'Not on the team.' }), true);
    if (target.role === 'owner' && op.role !== 'owner') return (json(res, 403, { error: 'Only an owner can remove an owner.' }), true);
    if (target.role === 'owner' && platform.operators().filter((o) => o.role === 'owner' && !o.disabled).length < 2) return (json(res, 409, { error: 'Keep at least one owner.' }), true);
    platform.removeOperator(target.email);
    log('team.remove', target.email);
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'team/2fa-reset' && POST) {
    if (deny('team')) return true;
    const b = await body(req);
    platform.resetOperator2fa(String(b.email ?? ''));
    log('team.2fa-reset', String(b.email ?? ''));
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'team/alerts' && POST) {
    const b = await body(req);
    const target = String(b.email ?? email).toLowerCase();
    if (target !== email && deny('team')) return true;
    platform.setOperatorAlerts(target, !!b.on);
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'team/sessions' && GET) {
    const u = (db.allDocs('users') as any[]).find((x) => emailOf(x) === String(url.searchParams.get('email') ?? email).toLowerCase());
    return (json(res, 200, { sessions: u ? platform.sessionsOf(u.id) : [], userId: u?.id ?? null }), true);
  }
  if (sub === 'settings' && GET) {
    const s = platform.settings();
    return (json(res, 200, { settings: { homeWorkspace: s.homeWorkspace, internal: s.internal, slaHours: s.slaHours, autoSuspendDays: s.autoSuspendDays, supportName: s.supportName, billing: s.billing }, companies: companyRows(ctx).map((c) => ({ id: c.id, name: c.name })), supportEmail: mailer.SUPPORT_EMAIL }), true);
  }
  if (sub === 'settings' && POST) {
    if (deny('platform')) return true;
    const b = await body(req);
    if ('homeWorkspace' in b) platform.setSetting('homeWorkspace', b.homeWorkspace || null);
    if (b.slaHours) platform.setSetting('slaHours', { urgent: Math.max(0.25, Number(b.slaHours.urgent) || 1), paid: Math.max(0.25, Number(b.slaHours.paid) || 2), other: Math.max(0.25, Number(b.slaHours.other) || 8) });
    if ('autoSuspendDays' in b) platform.setSetting('autoSuspendDays', Math.max(0, Math.min(180, Number(b.autoSuspendDays) || 0)));
    if (typeof b.supportName === 'string') platform.setSetting('supportName', b.supportName.slice(0, 80) || 'sprint2go Support');
    if (b.billing) platform.setSetting('billing', { name: String(b.billing.name ?? '').slice(0, 120), address: String(b.billing.address ?? '').slice(0, 400), npwp: String(b.billing.npwp ?? '').slice(0, 40), bank: String(b.billing.bank ?? '').slice(0, 200), email: String(b.billing.email ?? '').slice(0, 120) });
    log('settings.save', null, Object.keys(b).join(', '));
    return (json(res, 200, { ok: true }), true);
  }
  if (sub === 'audit' && GET) {
    const limit = Math.min(2000, Number(url.searchParams.get('limit') ?? 500));
    const names = new Map<string, string>([...(db.allDocs('workspaces') as any[]).map((w) => [w.id, w.name] as [string, string]), ...(db.allDocs('users') as any[]).map((u) => [u.id, u.name] as [string, string])]);
    for (const t of support.tickets()) names.set(t.id, `#${t.number}`);
    return (json(res, 200, { entries: db.auditList(limit).map((a) => ({ ...a, targetName: a.target ? names.get(a.target) ?? null : null })) }), true);
  }

  return false;
}

/** Applies a coupon to a plan: free months become comp, the rest a discount with an end date. */
export function applyCoupon(plan: Plan, c: platform.Coupon): Plan {
  if (c.kind === 'months') {
    const from = plan.comp?.until && plan.comp.until > now() ? Date.parse(plan.comp.until) : plan.trialEnds && plan.trialEnds > now() ? Date.parse(plan.trialEnds) : Date.now();
    return { ...plan, comp: { until: new Date(from + c.value * 30 * DAY).toISOString(), note: `Code ${c.code}` } };
  }
  return { ...plan, discount: { code: c.code, kind: c.kind, value: c.value, until: c.months ? new Date(Date.now() + c.months * 30 * DAY).toISOString() : undefined } };
}

/** Opens the newest backup read-only, checks its integrity and that it has data. */
export function testLatestBackup() {
  const dir = join(db.dataDir, 'backups');
  // The newest by time: labelled one-offs sort before the day's daily copy by name.
  const file = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.db')).sort((a, b) => statSync(join(dir, a)).mtimeMs - statSync(join(dir, b)).mtimeMs).pop() : undefined;
  let result: { at: string; file: string; ok: boolean; detail: string };
  if (!file) result = { at: now(), file: '', ok: false, detail: 'No backup to test.' };
  else {
    try {
      const b = new DatabaseSync(join(dir, file), { readOnly: true });
      const check = (b.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      const docs = (b.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number }).n;
      const logins = (b.prepare('SELECT COUNT(*) AS n FROM logins').get() as { n: number }).n;
      b.close();
      result = { at: now(), file, ok: check === 'ok', detail: check === 'ok' ? `${docs} documents, ${logins} sign-ins, intact` : check };
    } catch (e) {
      result = { at: now(), file, ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
  platform.setSetting('backupTest', result);
  return result;
}
