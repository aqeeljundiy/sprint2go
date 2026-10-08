// The operator backend (/admin): the people who run Sprint2go look after companies, people, money and the server.
// Operators are listed in S2G_OPERATORS (emails, comma-separated); the first one is the superadmin.
// Every action here is written to the audit table.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { monthlyTotal } from '../src/data/pricing.ts';
import { mailStats, mailStatsAll } from './mailer.ts';
import type { Plan, Tier, Track } from '../src/types.ts';

export const OPERATORS = (process.env.S2G_OPERATORS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
export const isOperatorEmail = (email: string | undefined) => !!email && OPERATORS.includes(email.toLowerCase());
export const isSuperadminEmail = (email: string | undefined) => !!email && OPERATORS[0] === email.toLowerCase();

export interface AdminCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  me: string; // the operator's user id
  email: string; // the operator's email (audit entries carry it)
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: (req: IncomingMessage) => Promise<any>;
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
  signups: Map<string, { name: string; code: string; until: number }>;
  codes: Map<string, { code: string; until: number }>;
  newCode: () => string;
  mailOn: boolean;
  publicUrl: string;
  recorder: { configured: boolean; health: () => Promise<{ ok: boolean; bots?: number } | null> };
  spendRp: (rows: { provider: string; model: string; inTokens: number; outTokens: number }[]) => number;
  setSession: (res: ServerResponse, token: string | null) => void;
  sseClients: () => number;
  startedAt: number;
  backup: () => Promise<string>;
  endSessionsOfWorkspace?: (wsId: string) => void;
}

const DAY = 86_400_000;
const monthStart = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
const emailOf = (u: any) => String(u?.email ?? '').toLowerCase();
const isTeamUser = (u: any) => u && !u.clientOf && !u.deletedAt;

/** The company's monthly revenue as booked: 0 on Free, during a trial, while paused or while comped. */
export function mrrOf(ws: any, people: number): { mrr: number; state: 'free' | 'trial' | 'paused' | 'comp' | 'paying' | 'suspended'; after?: number } {
  const plan: Plan | undefined = ws.plan;
  if (ws.suspended) return { mrr: 0, state: 'suspended' };
  if (!plan || plan.tier === 'free') return { mrr: 0, state: 'free' };
  const full = monthlyTotal(plan, people).total * (plan.cycle === 'yearly' ? 10 / 12 : 1);
  if (plan.paused) return { mrr: 0, state: 'paused', after: full };
  const now = new Date().toISOString();
  if ((plan as any).comp?.until && (plan as any).comp.until > now) return { mrr: 0, state: 'comp', after: full };
  if (plan.trialEnds && plan.trialEnds > now) return { mrr: 0, state: 'trial', after: full };
  return { mrr: full, state: 'paying' };
}

function companyRows(ctx: AdminCtx) {
  const users = db.allDocs('users') as any[];
  const byId = new Map(users.map((u) => [u.id, u]));
  const seen = db.lastSeen();
  const storage = db.storageByWorkspace();
  const usage = db.usageByWorkspace(monthStart());
  const clients = db.allDocs('clients') as any[];
  return (db.allDocs('workspaces') as any[]).map((ws) => {
    const members = (ws.members ?? []).filter((m: any) => isTeamUser(byId.get(m.userId)));
    const people = members.length;
    const owner = byId.get(members.find((m: any) => m.role === 'owner')?.userId);
    const lastActive = members.map((m: any) => seen.get(m.userId) ?? '').sort().pop() || null;
    const rows = usage.filter((u) => u.workspaceId === ws.id);
    const money = mrrOf(ws, people);
    const projects = clients.filter((c) => c.workspaceId === ws.id);
    const guests = projects.reduce((n, c) => n + (c.people ?? []).filter((p: any) => p.status === 'joined').length, 0);
    return {
      id: ws.id,
      name: ws.name,
      color: ws.color,
      logo: ws.logo ? true : false,
      plan: ws.plan ? { tier: ws.plan.tier, track: ws.plan.track, cycle: ws.plan.cycle, trialEnds: ws.plan.trialEnds, paused: !!ws.plan.paused, comp: ws.plan.comp ?? null, addons: ws.plan.addons } : null,
      ...money,
      people,
      guests,
      projects: projects.length,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      lastActive,
      aiRp: ctx.spendRp(rows),
      aiIncludedUses: rows.filter((r) => r.provider === 'included').reduce((n, r) => n + r.uses, 0),
      storageBytes: storage.get(ws.id) ?? 0,
      since: ws.createdAt ?? ws.plan?.since ?? null,
      suspended: ws.suspended ?? null,
      industry: ws.industry ?? null,
      domains: ws.domains ?? [],
    };
  });
}

const monthKey = (iso: string) => iso.slice(0, 7);
const lastMonths = (n: number) => {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
};

function systemInfo(ctx: AdminCtx) {
  const dir = db.dataDir;
  let disk: { free: number; total: number } | null = null;
  try {
    const s = statfsSync(dir);
    disk = { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
  } catch {
    /* not available on this platform */
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
  const flags = ['PUBLIC_URL', 'S2G_OPERATORS', 'S2G_DEMO', 'SES_KEY', 'SES_SECRET', 'SES_REGION', 'MAIL_FROM', 'RECORDER_URL', 'RECORDER_SECRET', 'S2G_SEAL_KEY', 'ANTHROPIC_API_KEY'].map((k) => ({ key: k, set: !!process.env[k] }));
  return {
    version,
    commit: process.env.SOURCE_COMMIT ?? process.env.S2G_COMMIT ?? null,
    built,
    node: process.version,
    uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
    production: process.env.NODE_ENV === 'production',
    publicUrl: ctx.publicUrl,
    https: ctx.publicUrl.startsWith('https://'),
    disk,
    dbBytes: existsSync(db.dbPath) ? statSync(db.dbPath).size : 0,
    backups: backups.slice(0, 20),
    lastBackupAt: backups[0]?.at ?? null,
    mailOn: ctx.mailOn,
    recorder: { configured: ctx.recorder.configured },
    liveConnections: ctx.sseClients(),
    sessions: db.sessionCount(),
    flags,
    operators: OPERATORS,
  };
}

/** Handles /api/admin/* for a signed-in operator. Returns false when the path isn't ours. */
export async function handleAdmin(p: string, ctx: AdminCtx): Promise<boolean> {
  const { req, res, url, json, body } = ctx;
  const sub = p.slice('/api/admin/'.length);
  const superadmin = isSuperadminEmail(ctx.email);
  const log = (action: string, target: string | null, detail?: string) => db.audit(ctx.email, action, target, detail);
  const wsById = (id: string) => db.getDoc('workspaces', id) as any;
  const saveWs = (ws: any) => {
    db.writeDocs('workspaces', [ws], [], ctx.me);
    ctx.broadcast('workspaces', [ws], []);
  };

  if (sub === 'me') return (json(res, 200, { operator: true, superadmin, email: ctx.email }), true);

  if (sub === 'overview' && req.method === 'GET') {
    const companies = companyRows(ctx);
    const users = (db.allDocs('users') as any[]).filter(isTeamUser);
    const now = Date.now();
    const soon = new Date(now + 7 * DAY).toISOString();
    const nowIso = new Date(now).toISOString();
    const quiet = companies.filter((c) => !c.suspended && c.since && c.since < new Date(now - 14 * DAY).toISOString() && (!c.lastActive || c.lastActive < new Date(now - 14 * DAY).toISOString()));
    const sys = systemInfo(ctx);
    const warnings: { kind: string; text: string }[] = [];
    if (sys.disk && sys.disk.free / sys.disk.total < 0.1) warnings.push({ kind: 'disk', text: `Disk nearly full: ${(sys.disk.free / 1e9).toFixed(1)} GB free.` });
    if (!sys.lastBackupAt || sys.lastBackupAt < new Date(now - 36 * 3600_000).toISOString()) warnings.push({ kind: 'backup', text: sys.lastBackupAt ? 'The last backup is older than a day.' : 'No backup yet.' });
    if (!sys.mailOn) warnings.push({ kind: 'mail', text: 'Email is off: sign-up and reset codes only appear here and in the log.' });
    if (!sys.https && sys.production) warnings.push({ kind: 'https', text: 'The app runs over http. Add the real domain and a certificate.' });
    if (ctx.recorder.configured) {
      const h = await ctx.recorder.health();
      if (!h?.ok) warnings.push({ kind: 'recorder', text: 'The meeting recorder does not answer.' });
    } else warnings.push({ kind: 'recorder', text: 'No meeting recorder is set up.' });
    // Sign-ups per day for the last 30 days, from when people were first seen (a new person is "seen" at sign-up).
    const seen = db.lastSeen();
    const days: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) days[new Date(now - i * DAY).toISOString().slice(0, 10)] = 0;
    for (const c of companies) if (c.since && c.since.slice(0, 10) in days) days[c.since.slice(0, 10)]++;
    return (
      json(res, 200, {
        counts: {
          companies: companies.filter((c) => !c.suspended).length,
          people: users.length,
          guests: companies.reduce((n, c) => n + c.guests, 0),
          paying: companies.filter((c) => c.state === 'paying').length,
          trials: companies.filter((c) => c.state === 'trial').length,
          mrr: companies.reduce((n, c) => n + c.mrr, 0),
          aiRp: companies.reduce((n, c) => n + c.aiRp, 0),
          online: Array.from(seen.values()).filter((at) => at > new Date(now - 15 * 60_000).toISOString()).length,
        },
        queue: {
          signups: Array.from(ctx.signups.entries())
            .filter(([, s]) => s.until > now)
            .map(([email, s]) => ({ email, name: s.name, code: s.code, until: new Date(s.until).toISOString() })),
          codes: Array.from(ctx.codes.entries())
            .filter(([, c]) => c.until > now)
            .map(([key, c]) => ({ key, code: c.code, until: new Date(c.until).toISOString() })),
          trialsEnding: companies.filter((c) => c.state === 'trial' && c.plan?.trialEnds && c.plan.trialEnds < soon).map((c) => ({ id: c.id, name: c.name, trialEnds: c.plan!.trialEnds, after: c.after ?? 0 })),
          trialsEnded: companies.filter((c) => c.plan?.trialEnds && c.plan.trialEnds < nowIso && c.state === 'paying' && !c.plan.paused).map((c) => ({ id: c.id, name: c.name, trialEnds: c.plan!.trialEnds, mrr: c.mrr })),
          suspended: companies.filter((c) => c.suspended).map((c) => ({ id: c.id, name: c.name, ...c.suspended })),
          quiet: quiet.map((c) => ({ id: c.id, name: c.name, lastActive: c.lastActive, people: c.people })),
          warnings,
        },
        newCompaniesByDay: days,
      }),
      true
    );
  }

  if (sub === 'companies' && req.method === 'GET') return (json(res, 200, { companies: companyRows(ctx) }), true);

  if (sub === 'company' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    const ws = wsById(id);
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    const row = companyRows(ctx).find((c) => c.id === id)!;
    const users = db.allDocs('users') as any[];
    const seen = db.lastSeen();
    const members = (ws.members ?? [])
      .map((m: any) => {
        const u = users.find((x) => x.id === m.userId);
        return u ? { id: u.id, name: u.name, email: u.email, title: u.title, color: u.color, photo: !!u.photo, role: m.role, lastSeen: seen.get(u.id) ?? null, hasLogin: db.hasLogin(u.id), suspended: u.suspended ?? null, deleted: !!u.deletedAt } : null;
      })
      .filter(Boolean);
    const usage = db.usageSince(id, monthStart());
    const since = ws.createdAt ?? ws.plan?.since;
    // Booked invoices: one per month since the plan started, at today's price (real invoices come with payments).
    const invoices: { month: string; amount: number; state: string }[] = [];
    if (ws.plan && ws.plan.tier !== 'free' && since) {
      const start = new Date(since);
      const n = Math.min(24, (new Date().getUTCFullYear() - start.getUTCFullYear()) * 12 + new Date().getUTCMonth() - start.getUTCMonth() + 1);
      for (let i = 0; i < n; i++) {
        const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).toISOString().slice(0, 7);
        const trial = ws.plan.trialEnds && m <= monthKey(ws.plan.trialEnds);
        invoices.push({ month: m, amount: trial ? 0 : (row.mrr || row.after || 0), state: trial ? 'trial' : row.state === 'comp' ? 'comp' : 'booked' });
      }
    }
    return (
      json(res, 200, {
        company: { ...row, mail: mailStats(id, monthStart()), accounts: (ws.accounts ?? []).map((a: any) => ({ id: a.id, email: a.email, kind: a.kind, users: a.users?.length ?? 0 })), apps: ws.apps ?? null, emailSetup: ws.emailSetup ?? null, whiteLabel: ws.whiteLabel?.enabled ? { name: ws.whiteLabel.name, domain: ws.whiteLabel.domain ?? null } : null, members, usage: usage.map((u) => ({ ...u, rp: ctx.spendRp([u]) })), invoices: invoices.reverse(), audit: db.auditList(50, id) },
      }),
      true
    );
  }

  if (sub === 'company/create' && req.method === 'POST') {
    const b = await body(req);
    const name = String(b.name ?? '').trim();
    const email = String(b.ownerEmail ?? '').trim().toLowerCase();
    const ownerName = String(b.ownerName ?? '').trim() || email.split('@')[0];
    if (name.length < 2) return (json(res, 400, { error: 'Give the company a name.' }), true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (json(res, 400, { error: 'That email doesn’t look right.' }), true);
    const users = db.allDocs('users') as any[];
    let owner = users.find((u) => emailOf(u) === email && !u.deletedAt);
    if (owner?.clientOf) return (json(res, 409, { error: 'That person is a guest somewhere; ask them to start their own workspace from "Shared with you".' }), true);
    const colors = ['#5b5bf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    if (!owner) {
      owner = { id: 'u-' + randomBytes(6).toString('hex'), name: ownerName, email, title: '', color: colors[Math.floor(Math.random() * colors.length)] };
      db.writeDocs('users', [owner], [], ctx.me);
      ctx.broadcast('users', [owner], []);
    }
    const tier = (['free', 'small', 'studio', 'agency', 'business'] as Tier[]).includes(b.tier) ? (b.tier as Tier) : 'studio';
    const track: Track = b.track === 'own' ? 'own' : 'ai';
    const trialDays = Number(b.trialDays ?? 14);
    const plan: Plan = {
      track,
      tier,
      cycle: 'monthly',
      trialEnds: tier !== 'free' && trialDays > 0 ? new Date(Date.now() + trialDays * DAY).toISOString() : undefined,
      addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false },
      billing: { company: name, emails: [email] },
      since: new Date().toISOString(),
    };
    const ws = { id: 'ws-' + randomBytes(5).toString('hex'), name, color: colors[Math.floor(Math.random() * colors.length)], domains: isFree(email) ? [] : [email.split('@')[1]], accounts: [], members: [{ userId: owner.id, role: 'owner' }], plan, createdAt: new Date().toISOString(), createdBy: 'operator' };
    saveWs(ws);
    const link = db.hasLogin(owner.id) ? null : `${ctx.publicUrl}/?invite=${db.newInvite(owner.id, email)}`;
    log('company.create', ws.id, `${name} for ${email}, ${tier} ${track}${plan.trialEnds ? `, trial ${trialDays} days` : ''}`);
    return (json(res, 200, { id: ws.id, link, ownerId: owner.id, existing: !link }), true);
  }

  if (sub === 'company/plan' && req.method === 'POST') {
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    const plan: any = { ...(ws.plan ?? { track: 'own', tier: 'free', cycle: 'monthly', addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false }, billing: { company: ws.name, emails: [] }, since: new Date().toISOString() }) };
    const changes: string[] = [];
    if (b.tier && ['free', 'small', 'studio', 'agency', 'business'].includes(b.tier) && b.tier !== plan.tier) (changes.push(`tier ${plan.tier} → ${b.tier}`), (plan.tier = b.tier));
    if (b.track && ['own', 'ai'].includes(b.track) && b.track !== plan.track) (changes.push(`track ${plan.track} → ${b.track}`), (plan.track = b.track));
    if (b.cycle && ['monthly', 'yearly'].includes(b.cycle) && b.cycle !== plan.cycle) (changes.push(`cycle ${b.cycle}`), (plan.cycle = b.cycle));
    if ('trialEnds' in b) (changes.push(`trial until ${b.trialEnds ?? 'none'}`), (plan.trialEnds = b.trialEnds || undefined));
    if ('paused' in b) (changes.push(b.paused ? 'paused' : 'resumed'), (plan.paused = !!b.paused || undefined));
    if ('comp' in b) (changes.push(b.comp ? `free until ${b.comp.until}: ${b.comp.note ?? ''}` : 'comp removed'), (plan.comp = b.comp ? { until: b.comp.until, note: String(b.comp.note ?? '').slice(0, 200), by: ctx.email } : undefined));
    if (b.addons && typeof b.addons === 'object') (changes.push(`add-ons ${JSON.stringify(b.addons)}`), (plan.addons = { ...plan.addons, ...b.addons }));
    if (!changes.length) return (json(res, 200, { ok: true }), true);
    saveWs({ ...ws, plan });
    log('company.plan', ws.id, changes.join('; '));
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/suspend' && req.method === 'POST') {
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    if (b.on === false) {
      saveWs({ ...ws, suspended: undefined });
      log('company.unsuspend', ws.id, ws.name);
    } else {
      const reason = String(b.reason ?? '').trim().slice(0, 300);
      saveWs({ ...ws, suspended: { at: new Date().toISOString(), by: ctx.email, reason } });
      log('company.suspend', ws.id, `${ws.name}: ${reason || 'no reason given'}`);
    }
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/delete' && req.method === 'POST') {
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    if (String(b.confirm ?? '') !== ws.name) return (json(res, 400, { error: 'Type the company name exactly to confirm.' }), true);
    const gone = db.deleteWorkspaceDocs(ws.id, true);
    for (const [coll, ids] of Object.entries(gone)) ctx.broadcast(coll, [], ids);
    ctx.endSessionsOfWorkspace?.(ws.id);
    log('company.delete', ws.id, `${ws.name}: ${Object.entries(gone).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'company/reset' && req.method === 'POST') {
    if (!superadmin) return (json(res, 403, { error: 'Only the superadmin can reset a company.' }), true);
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

  if (sub === 'company/person' && req.method === 'POST') {
    const b = await body(req);
    const ws = wsById(String(b.id ?? ''));
    if (!ws) return (json(res, 404, { error: 'No such company.' }), true);
    const email = String(b.email ?? '').trim().toLowerCase();
    const name = String(b.name ?? '').trim() || email.split('@')[0];
    const role = ['owner', 'admin', 'member'].includes(b.role) ? b.role : 'member';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (json(res, 400, { error: 'That email doesn’t look right.' }), true);
    const users = db.allDocs('users') as any[];
    let u = users.find((x) => emailOf(x) === email && !x.deletedAt);
    if (u?.clientOf) return (json(res, 409, { error: 'That person is a guest; they can’t join a team with the same account.' }), true);
    if (!u) {
      u = { id: 'u-' + randomBytes(6).toString('hex'), name, email, title: '', color: '#5b5bf6' };
      db.writeDocs('users', [u], [], ctx.me);
      ctx.broadcast('users', [u], []);
    }
    if ((ws.members ?? []).some((m: any) => m.userId === u.id)) return (json(res, 409, { error: 'Already in this company.' }), true);
    saveWs({ ...ws, members: [...(ws.members ?? []), { userId: u.id, role }] });
    const link = db.hasLogin(u.id) ? null : `${ctx.publicUrl}/?invite=${db.newInvite(u.id, email)}`;
    log('company.person', ws.id, `${email} added as ${role} to ${ws.name}`);
    return (json(res, 200, { link, userId: u.id }), true);
  }

  if (sub === 'people' && req.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const seen = db.lastSeen();
    const wss = db.allDocs('workspaces') as any[];
    const clients = db.allDocs('clients') as any[];
    const people = (db.allDocs('users') as any[])
      .filter((u) => !u.deletedAt)
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        title: u.title,
        color: u.color,
        photo: !!u.photo,
        companies: wss.filter((w) => (w.members ?? []).some((m: any) => m.userId === u.id)).map((w) => ({ id: w.id, name: w.name, role: w.members.find((m: any) => m.userId === u.id).role })),
        guestOf: u.clientOf ? wss.find((w) => w.id === u.clientOf.workspaceId)?.name ?? null : clients.filter((c) => (c.people ?? []).some((p: any) => p.email?.toLowerCase() === emailOf(u) && p.status === 'joined')).map((c) => wss.find((w) => w.id === c.workspaceId)?.name).filter(Boolean),
        lastSeen: seen.get(u.id) ?? null,
        hasLogin: db.hasLogin(u.id),
        suspended: u.suspended ?? null,
        operator: isOperatorEmail(emailOf(u)),
      }))
      .filter((u) => !q || `${u.name} ${u.email} ${u.title} ${u.companies.map((c) => c.name).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.name.localeCompare(b.name));
    return (json(res, 200, { people: people.slice(0, 300), total: people.length }), true);
  }

  if (sub === 'person/reset-code' && req.method === 'POST') {
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u?.email) return (json(res, 404, { error: 'No such person.' }), true);
    if (!db.hasLogin(u.id)) return (json(res, 409, { error: 'They have no sign-in yet; send an invite link instead.' }), true);
    const code = ctx.newCode();
    const mail = emailOf(u);
    ctx.codes.set(`reset:${mail}`, { code, until: Date.now() + 15 * 60_000 } as any);
    log('person.reset-code', u.id, mail);
    return (json(res, 200, { code, email: mail, until: new Date(Date.now() + 15 * 60_000).toISOString() }), true);
  }

  if (sub === 'person/invite' && req.method === 'POST') {
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u?.email) return (json(res, 404, { error: 'No such person.' }), true);
    if (db.hasLogin(u.id)) return (json(res, 409, { error: 'They already sign in; send a reset code instead.' }), true);
    const link = `${ctx.publicUrl}/?invite=${db.newInvite(u.id, emailOf(u))}`;
    log('person.invite', u.id, emailOf(u));
    return (json(res, 200, { link }), true);
  }

  if (sub === 'person/suspend' && req.method === 'POST') {
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u) return (json(res, 404, { error: 'No such person.' }), true);
    if (isOperatorEmail(emailOf(u))) return (json(res, 403, { error: 'Operators can’t be suspended here; remove them from S2G_OPERATORS.' }), true);
    const next = b.on === false ? { ...u, suspended: undefined } : { ...u, suspended: { at: new Date().toISOString(), by: ctx.email, reason: String(b.reason ?? '').slice(0, 300) } };
    db.writeDocs('users', [next], [], ctx.me);
    ctx.broadcast('users', [next], []);
    if (b.on !== false) db.endSessions(u.id);
    log(b.on === false ? 'person.unsuspend' : 'person.suspend', u.id, `${emailOf(u)}${b.reason ? `: ${b.reason}` : ''}`);
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'person/owner' && req.method === 'POST') {
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

  if (sub === 'person/signin-as' && req.method === 'POST') {
    const b = await body(req);
    const u = db.getDoc('users', String(b.userId ?? '')) as any;
    if (!u || u.deletedAt) return (json(res, 404, { error: 'No such person.' }), true);
    if (u.suspended) return (json(res, 409, { error: 'That account is suspended.' }), true);
    ctx.setSession(res, db.newSession(u.id, ctx.email));
    log('person.signin-as', u.id, `${emailOf(u)} (${u.name})`);
    return (json(res, 200, { ok: true }), true);
  }

  if (sub === 'revenue' && req.method === 'GET') {
    const companies = companyRows(ctx);
    const months = lastMonths(6);
    const audit = db.auditList(5000);
    const series = months.map((m) => ({
      month: m,
      newCompanies: companies.filter((c) => c.since && monthKey(c.since) === m).length,
      churned: audit.filter((a) => (a.action === 'company.delete' || a.action === 'company.suspend') && monthKey(a.at) === m).length,
    }));
    const byTier: Record<string, { companies: number; mrr: number }> = {};
    for (const c of companies) {
      const key = c.plan ? `${c.plan.tier}${c.plan.track === 'ai' ? ' AI' : ''}` : 'free';
      byTier[key] ??= { companies: 0, mrr: 0 };
      byTier[key].companies++;
      byTier[key].mrr += c.mrr;
    }
    const addons = companies.reduce((n, c) => (c.state === 'paying' && c.plan ? n + monthlyTotal({ ...(wsById(c.id).plan as Plan) }, c.people).addons : n), 0);
    const trialsAfter = companies.filter((c) => c.state === 'trial').reduce((n, c) => n + (c.after ?? 0), 0);
    return (
      json(res, 200, {
        mrr: companies.reduce((n, c) => n + c.mrr, 0),
        arr: companies.reduce((n, c) => n + c.mrr, 0) * 12,
        paying: companies.filter((c) => c.state === 'paying').length,
        trials: { count: companies.filter((c) => c.state === 'trial').length, after: trialsAfter },
        comped: companies.filter((c) => c.state === 'comp').length,
        paused: companies.filter((c) => c.state === 'paused').length,
        addons,
        byTier,
        series,
        companies: companies.filter((c) => c.mrr > 0 || c.after).sort((a, b) => b.mrr - a.mrr || (b.after ?? 0) - (a.after ?? 0)),
        paymentsLive: false,
      }),
      true
    );
  }

  if (sub === 'usage' && req.method === 'GET') {
    const companies = companyRows(ctx);
    const meetings = (db.allDocs('meetings') as any[]).filter((m) => m.at >= monthStart());
    const mail = mailStatsAll(monthStart());
    const rows = companies
      .map((c) => {
        const minutes = meetings.filter((m) => m.workspaceId === c.id && m.recording).reduce((n, m) => n + (m.minutes ?? 0), 0);
        const included = c.plan?.track === 'ai';
        const m = mail.filter((x) => x.workspaceId === c.id);
        const mailOut = m.filter((x) => x.direction === 'out' && x.state === 'sent').reduce((n, x) => n + x.n, 0);
        const mailIn = m.filter((x) => x.direction === 'in').reduce((n, x) => n + x.n, 0);
        const boosted = m.filter((x) => x.direction === 'out' && x.route === 'boosted' && x.state === 'sent').reduce((n, x) => n + x.n, 0);
        return { id: c.id, name: c.name, state: c.state, mrr: c.mrr, aiRp: c.aiRp, aiIncludedUses: c.aiIncludedUses, included, storageBytes: c.storageBytes, recorderMinutes: minutes, people: c.people, margin: c.mrr - (included ? c.aiRp : 0) - boosted * 2, mailOut, mailIn, boosted };
      })
      .sort((a, b) => b.aiRp - a.aiRp);
    return (json(res, 200, { month: monthStart().slice(0, 7), companies: rows, totals: { aiRp: rows.reduce((n, r) => n + r.aiRp, 0), storageBytes: rows.reduce((n, r) => n + r.storageBytes, 0), recorderMinutes: rows.reduce((n, r) => n + r.recorderMinutes, 0), mailOut: rows.reduce((n, r) => n + r.mailOut, 0), mailIn: rows.reduce((n, r) => n + r.mailIn, 0), boosted: rows.reduce((n, r) => n + r.boosted, 0) } }), true);
  }

  if (sub === 'system' && req.method === 'GET') {
    const info = systemInfo(ctx);
    const health = ctx.recorder.configured ? await ctx.recorder.health() : null;
    return (json(res, 200, { ...info, recorder: { configured: ctx.recorder.configured, reachable: !!health?.ok, bots: health?.bots ?? null } }), true);
  }

  if (sub === 'backup/now' && req.method === 'POST') {
    const file = await ctx.backup();
    log('system.backup', null, file);
    return (json(res, 200, { file: file.split('/').pop() }), true);
  }

  if (sub === 'backup' && req.method === 'GET') {
    const file = (url.searchParams.get('file') ?? '').replace(/[^a-z0-9._-]/gi, '');
    const path = join(db.dataDir, 'backups', file);
    if (!file || !existsSync(path)) return (json(res, 404, { error: 'No such backup.' }), true);
    log('system.backup-download', null, file);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${file}"`, 'content-length': statSync(path).size });
    res.end(readFileSync(path));
    return true;
  }

  if (sub === 'audit' && req.method === 'GET') {
    const limit = Math.min(1000, Number(url.searchParams.get('limit') ?? 200));
    return (json(res, 200, { entries: db.auditList(limit, url.searchParams.get('target') || undefined) }), true);
  }

  return false;
}

const FREEMAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|proton|protonmail|aol|ymail|mail)\.com$|^yahoo\.|^outlook\.|^hotmail\./i;
const isFree = (email: string) => FREEMAIL.test(email.split('@')[1] ?? '');
