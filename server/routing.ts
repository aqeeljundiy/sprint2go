// "Some of each": a real check that a company's provider still passes unknown addresses on to us. We send a short test
// from our system address to s2g-check-<token>@<the company's domain>, an address the provider doesn't know, so its
// routing sends it here; the mail engine accepts that address and swallows the message (nobody ever sees it).
// Daily for companies with "Check every day" on, once routing has worked; on demand from the guide's "Check it works"
// step. When two checks in a row fail, the company's admins hear about it in the app and by email.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import * as mailer from './mailer.ts';
import { mayUse } from './domains.ts';
import { simpleHtml } from './mail.ts';
import { msg, phrase, t, textOf } from '../src/i18n/index.ts';
import { inLang, langOf } from './lang.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS routing_probes (token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, domain TEXT NOT NULL, kind TEXT NOT NULL, outbox_id TEXT, state TEXT NOT NULL, why TEXT, sent_at TEXT NOT NULL, done_at TEXT, notified INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS routing_probes_ws ON routing_probes (workspace_id, sent_at);
`);

type State = 'sent' | 'arrived' | 'failed' | 'unsent';
type Probe = { token: string; workspace_id: string; domain: string; kind: 'daily' | 'manual'; outbox_id: string | null; state: State; why: string | null; sent_at: string; done_at: string | null; notified: number };
type Ws = { id: string; name: string; domains?: string[]; accounts?: { email: string; provider?: string }[]; members: { userId: string; role: string }[]; emailSetup?: string; emailProvider?: string; suspended?: unknown; whiteLabel?: { enabled?: boolean; name?: string }; mailRouting?: { dailyCheck?: boolean; verifiedAt?: string; lastCheck?: { at: string; ok: boolean } } };

export interface RoutingDeps {
  notify: (userIds: string[], workspaceId: string, text: { text: string; tr?: any }, link?: string) => void; // msg()
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
  log: (line: string) => void;
}
let deps: RoutingDeps | null = null;

const WAIT_MS = 30 * 60_000; // delivered to the provider but not back here in 30 minutes: routing failed
const GIVE_UP_MS = 6 * 3600_000; // couldn't even leave our server in 6 hours: no verdict either way
const DAILY_MS = 23.5 * 3600_000;
const PROVIDER: Record<string, string> = { google: 'Google Workspace', microsoft: 'Microsoft 365', zoho: 'Zoho Mail', imap: 'your mail provider' };
const now = () => new Date().toISOString();
const lower = (s: string) => String(s ?? '').trim().toLowerCase();
const brandOf = (ws: Ws) => (ws.whiteLabel?.enabled && ws.whiteLabel.name) || 'sprint2go';

export const probeAddress = (token: string, domain: string) => `s2g-check-${token}@${domain}`;
const parse = (address: string) => {
  const m = /^s2g-check-([a-f0-9]{24})@([a-z0-9.-]+)$/.exec(lower(address));
  return m ? { token: m[1], domain: m[2] } : null;
};
const get = (token: string) => db.db.prepare('SELECT * FROM routing_probes WHERE token = ?').get(token) as Probe | undefined;
const wsOf = (id: string) => db.getDoc('workspaces', id) as unknown as Ws | undefined;

/** The domain a company's routing is checked on, or why it can't be checked. */
export function probeDomain(ws: Ws): { domain: string } | { why: string } {
  if (ws.emailSetup !== 'mix') return { why: 'Routing is checked only for “Some of each”.' };
  const domain = lower(ws.domains?.[0] ?? '');
  if (!domain || domain === mailer.MAIL_HOST) return { why: 'Add your company’s domain first.' };
  if (!mayUse(ws, domain)) return { why: `Another company uses ${domain}. Prove it’s yours in Settings, Email delivery, first.` };
  if (mailer.systemMailPath() === 'log') return { why: 'This server can’t send mail yet, so it can’t send the test.' };
  return { domain };
}

/** Sends one test. Throws with the reason when the company's routing can't be checked. */
export async function sendProbe(wsId: string, kind: 'daily' | 'manual') {
  const ws = wsOf(wsId);
  if (!ws) throw new Error('No such company.');
  const d = probeDomain(ws);
  if ('why' in d) throw new Error(d.why);
  const token = randomBytes(12).toString('hex');
  const address = probeAddress(token, d.domain);
  db.db.prepare("INSERT INTO routing_probes (token, workspace_id, domain, kind, state, sent_at) VALUES (?, ?, ?, ?, 'sent', ?)").run(token, ws.id, d.domain, kind, now());
  const brand = brandOf(ws);
  const { ids } = await mailer.queueSystemMail({
    fromName: brand,
    from: mailer.NOREPLY,
    to: [address],
    subject: `${brand} routing check for ${d.domain}`,
    text: `An automatic test that ${PROVIDER[ws.emailProvider || 'google'] ?? 'your mail provider'} still passes mail for ${d.domain} on to ${brand}. It never shows up in anyone's inbox.`,
  });
  db.db.prepare('UPDATE routing_probes SET outbox_id = ? WHERE token = ?').run(ids[0] ?? null, token);
  return { token, address };
}

/** Saves the verdict, writes it on the company (mailRouting.lastCheck) and, after two failures in a row, tells its admins. */
function settle(p: Probe, state: Exclude<State, 'sent'>, why?: string) {
  db.db.prepare('UPDATE routing_probes SET state = ?, why = ?, done_at = ? WHERE token = ?').run(state, why ?? null, now(), p.token);
  if (state === 'unsent') return deps?.log(`[routing] test for ${p.domain} never left this server`);
  const ws = wsOf(p.workspace_id);
  if (!ws) return;
  const at = now();
  const ok = state === 'arrived';
  const routing = { dailyCheck: ws.mailRouting?.dailyCheck ?? true, ...(ws.mailRouting ?? {}), lastCheck: { at, ok }, ...(ok && !ws.mailRouting?.verifiedAt ? { verifiedAt: at } : {}) };
  const next = { ...(ws as unknown as db.Doc), mailRouting: routing } as db.Doc;
  db.writeDocs('workspaces', [next], [], null);
  deps?.broadcast('workspaces', [next], []);
  if (!ok) alertIfStreak(ws, p);
}

/** Two failures in a row, after routing worked once: the admins hear it once per run of failures. */
function alertIfStreak(ws: Ws, p: Probe) {
  if (!ws.mailRouting?.verifiedAt) return; // still being set up: the guide shows the result
  const recent = db.db.prepare("SELECT token, state, notified, why FROM routing_probes WHERE workspace_id = ? AND state IN ('arrived', 'failed') ORDER BY sent_at DESC LIMIT 20").all(ws.id) as Pick<Probe, 'token' | 'state' | 'notified' | 'why'>[];
  const firstOk = recent.findIndex((r) => r.state !== 'failed');
  const streak = firstOk === -1 ? recent : recent.slice(0, firstOk);
  if (streak.length < 2 || streak.some((r) => r.notified)) return;
  db.db.prepare('UPDATE routing_probes SET notified = 1 WHERE token = ?').run(p.token);
  const brand = brandOf(ws);
  const prov = PROVIDER[ws.emailProvider || 'google'] ?? phrase('your mail provider');
  const said = msg('Mail routing for {domain} failed its last two checks, so mail to {brand} mailboxes at {domain} may not be arriving. Check the routing at {provider} in Settings, Email delivery.', { domain: p.domain, brand, provider: prov });
  const admins = ws.members.filter((m) => m.role !== 'member').map((m) => m.userId);
  deps?.notify(admins, ws.id, said, '/settings/email');
  // Each admin's email in their own language (theirs, else the company's).
  for (const id of admins) {
    const to = String((db.getDoc('users', id) as { email?: string } | undefined)?.email ?? '');
    if (!to.includes('@')) continue;
    const m = inLang(langOf(id, ws.id), () => {
      const text = textOf(said);
      const last = streak[0]?.why ? t('Last answer: {why}', { why: streak[0].why }) : '';
      return { subject: t('{brand}: mail routing for {domain} stopped working', { brand, domain: p.domain }), text: last ? `${text} ${last}` : text, html: simpleHtml(brand, [text, ...(last ? [last] : [])]) };
    });
    void mailer.sendNote(to, m.subject, m.text, m.html, brand).catch(() => false);
  }
}

/** A test's verdict from its delivery: refused by the provider at once, or delivered there and not back after a while. */
function judge(p: Probe): boolean {
  const ob = p.outbox_id ? mailer.outboxState(p.outbox_id) : undefined;
  const age = Date.now() - Date.parse(p.sent_at);
  if (ob?.state === 'local') {
    settle(p, 'unsent', 'A local sprint2go keeps mail on this computer, so the test never left. Set MAIL_RELAY_URL to try it.');
    return true;
  }
  if (ob?.state === 'failed') {
    settle(p, 'failed', `${p.domain}’s mail server refused the test: ${(ob.error ?? 'no reason given').slice(0, 200)}`);
    return true;
  }
  if (ob?.state === 'sent' && age > WAIT_MS) {
    settle(p, 'failed', `${p.domain}’s mail server took the test but didn’t pass it on here.`);
    return true;
  }
  if (ob?.state !== 'sent' && age > GIVE_UP_MS) {
    settle(p, 'unsent');
    return true;
  }
  return false;
}

/** For the guide's "Send a test": where this company's test is now. */
export function probeStatus(wsId: string, token: string): { state: State; why?: string; leaving?: boolean } | null {
  const p = get(String(token));
  if (!p || p.workspace_id !== wsId) return null;
  if (p.state === 'sent' && judge(p)) return probeStatus(wsId, token);
  if (p.state !== 'sent') return { state: p.state, why: p.why ?? undefined };
  const ob = p.outbox_id ? mailer.outboxState(p.outbox_id) : undefined;
  return { state: 'sent', leaving: ob?.state === 'queued' };
}

/** Verdicts for open tests, then today's tests for the companies that want them. */
async function tick() {
  for (const p of db.db.prepare("SELECT * FROM routing_probes WHERE state = 'sent'").all() as Probe[]) judge(p);
  if (mailer.systemMailPath() === 'log') return;
  for (const ws of db.allDocs('workspaces') as unknown as Ws[]) {
    if (ws.suspended || !(ws.mailRouting?.dailyCheck ?? true) || !ws.mailRouting?.verifiedAt || 'why' in probeDomain(ws)) continue;
    const last = db.db.prepare('SELECT sent_at FROM routing_probes WHERE workspace_id = ? ORDER BY sent_at DESC LIMIT 1').get(ws.id) as { sent_at: string } | undefined;
    if (last && Date.now() - Date.parse(last.sent_at) < DAILY_MS) continue;
    await sendProbe(ws.id, 'daily').catch((e) => deps?.log(`[routing] ${ws.name}: ${e instanceof Error ? e.message : e}`));
  }
}

export function startRouting(d: RoutingDeps) {
  deps = d;
  mailer.onRoutingProbe({
    accepts: (address) => {
      const a = parse(address);
      const p = a && get(a.token);
      return !!p && p.domain === a.domain && Date.now() - Date.parse(p.sent_at) < 3 * 86_400_000;
    },
    arrived: (address) => {
      const a = parse(address);
      const p = a && get(a.token);
      if (p && p.state !== 'arrived') settle(p, 'arrived');
    },
  });
  setTimeout(() => void tick().catch(() => {}), 2 * 60_000);
  setInterval(() => void tick().catch(() => {}), 5 * 60_000);
}

/**
 * "I sent it": mail that reached one of the company's mailboxes at its domain proves routing works too. Recorded on
 * the server, since the company's own copy can't set it (it's server-owned).
 */
export function noteRoutingWorks(wsId: string) {
  const ws = wsOf(wsId);
  if (!ws || ws.emailSetup !== 'mix' || ws.mailRouting?.verifiedAt) return;
  const at = now();
  const next = { ...(ws as unknown as db.Doc), mailRouting: { dailyCheck: ws.mailRouting?.dailyCheck ?? true, ...(ws.mailRouting ?? {}), verifiedAt: at } } as db.Doc;
  db.writeDocs('workspaces', [next], [], null);
  deps?.broadcast('workspaces', [next], []);
}
