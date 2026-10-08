// The limits a company sets in Settings, AI, kept on the server (the app only shows them):
//  - blocked providers: never called for this company, not even by our own AI's fallback
//  - each key's monthly cap (US$, at list prices): the key rests until the 1st once it's reached
//  - alerts: admins hear when the plan's allowance, the company's monthly limit or a key's cap reaches 50%, 80% and 100%
import * as db from './db.ts';
import * as aiplan from './aiplan.ts';
import { PROVIDERS } from '../src/data/aiCatalog.ts';

db.db.exec('CREATE TABLE IF NOT EXISTS ai_alerts (workspace_id TEXT NOT NULL, month TEXT NOT NULL, meter TEXT NOT NULL, level INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY (workspace_id, month, meter, level))');

type Ws = { id: string; name?: string; members?: { userId: string; role: string }[]; ai?: { blocked?: string[]; alerts?: boolean; providers?: { id: string; capUsd?: number }[]; caps?: { companyRp?: number } } };
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};
const name = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/** Providers this company blocked (Settings, AI, Blocked providers). */
export const blocked = (ws: Ws | undefined) => new Set((ws?.ai?.blocked ?? []).map(String));

/** This month's spend on the company's own keys, per provider, in US$ at list prices. */
export function spendUsd(wsId: string): Record<string, number> {
  const rows = db.db.prepare("SELECT provider, model, COUNT(*) AS uses, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE workspace_id = ? AND at >= ? AND provider != 'included' GROUP BY provider, model").all(wsId, monthStart()) as { provider: string; model: string; uses: number; inTokens: number; outTokens: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.provider] = (out[r.provider] ?? 0) + aiplan.costOf([r]).usd;
  return out;
}
/** Keys that reached their monthly cap this month (they rest until the 1st). */
export function capped(ws: Ws | undefined): Set<string> {
  const caps = (ws?.ai?.providers ?? []).filter((p) => (p.capUsd ?? 0) > 0);
  if (!ws || !caps.length) return new Set();
  const spend = spendUsd(ws.id);
  return new Set(caps.filter((p) => (spend[p.id] ?? 0) >= p.capUsd!).map((p) => p.id));
}
/** Whether this company may use a provider for a job right now: not blocked, and its key not at its cap. */
export function allowed(ws: Ws | undefined) {
  const no = blocked(ws);
  const full = capped(ws);
  return (provider: string, included = false) => !no.has(provider) && (included || !full.has(provider));
}

/**
 * After AI ran: when one of the company's meters crossed 50%, 80% or 100% this month for the first time, its admins
 * hear it (unless the company switched alerts off). Each level once a month per meter.
 */
export function checkAlerts(ws: Ws | undefined, spendRp: (wsId: string) => number, notify: (userIds: string[], text: string, url: string, wsId: string) => void) {
  if (!ws || ws.ai?.alerts === false) return;
  const month = monthStart().slice(0, 7);
  const meters: { key: string; share: number; what: string }[] = [];
  if (aiplan.planAI(ws).ok) {
    const a = aiplan.allowanceOf(ws);
    if (!a.unlimited && a.capRp > 0) meters.push({ key: 'allowance', share: a.usedRp / a.capRp, what: 'the AI allowance for this month' });
  }
  const limit = ws.ai?.caps?.companyRp;
  if (limit && limit > 0) meters.push({ key: 'company', share: spendRp(ws.id) / limit, what: 'the company’s AI limit for this month' });
  const spend = spendUsd(ws.id);
  for (const p of ws.ai?.providers ?? []) if ((p.capUsd ?? 0) > 0) meters.push({ key: `key:${p.id}`, share: (spend[p.id] ?? 0) / p.capUsd!, what: `the ${name(p.id)} key’s monthly cap (US$${p.capUsd})` });
  const admins = (ws.members ?? []).filter((m) => m.role !== 'member').map((m) => m.userId);
  for (const m of meters) {
    const level = [100, 80, 50].find((l) => m.share * 100 >= l);
    if (!level) continue;
    const fresh = db.db.prepare('INSERT OR IGNORE INTO ai_alerts (workspace_id, month, meter, level, at) VALUES (?, ?, ?, ?, ?)').run(ws.id, month, m.key, level, new Date().toISOString()).changes > 0;
    // Lower levels count as told too, so a jump straight to 100% sends one message.
    for (const l of [50, 80].filter((x) => x < level)) db.db.prepare('INSERT OR IGNORE INTO ai_alerts (workspace_id, month, meter, level, at) VALUES (?, ?, ?, ?, ?)').run(ws.id, month, m.key, l, new Date().toISOString());
    if (!fresh || !admins.length) continue;
    const text =
      level >= 100
        ? m.key.startsWith('key:')
          ? `AI: ${m.what} is reached, so that key rests until the 1st. Raise the cap in Settings, AI.`
          : m.key === 'company'
            ? `AI: ${m.what} is reached, so AI stops for everyone until the 1st. Raise it in Settings, AI.`
            : `AI: ${m.what} is used up. Settings, Plan & billing has top-ups.`
        : `AI: ${level}% of ${m.what} is used.`;
    notify(admins, text, m.key === 'allowance' ? '/settings/billing' : '/settings/ai', ws.id);
  }
}
