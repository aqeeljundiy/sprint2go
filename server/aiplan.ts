// The AI plan. Companies on "AI included" (or on a trial, or given free months on that track) run on our keys;
// everyone else brings their own. Operators keep our keys here (sealed with the server's key, like the companies'),
// pick the model for each job with a fallback, keep the price list and the dollar rate, and see whether AI pays for itself.
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';
import * as platform from './platform.ts';
import { activePeople } from './billing.ts';
import { AIError, canCall, isModelGone, keyHint, testKey, withAI, type AIConfig } from './llm.ts';
import * as models from './models.ts';
import { CRED_FIELDS, JOBS, PROVIDERS, type JobInfo } from '../src/data/aiCatalog.ts';
import { MODEL_ID, prettyModelName } from '../src/data/aiModels.ts';
import { ALLOWANCE, TOP_UP, discountOf, monthlyTotal, planName, priceFor, seatsFor } from '../src/data/pricing.ts';
import type { Plan } from '../src/types.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS platform_ai_keys (provider TEXT PRIMARY KEY, sealed TEXT NOT NULL, base_url TEXT, last4 TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, added_by TEXT, added_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS platform_ai_health (id TEXT PRIMARY KEY, tested_at TEXT, test_ok INTEGER, test_error TEXT, used_at TEXT, failed_at TEXT, fail_error TEXT);
`);

const DAY = 86_400_000;
const now = () => new Date().toISOString();
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};
const rp = (n: number) => 'Rp\u00a0' + Math.round(n).toLocaleString('id-ID'); // never split from its number
export const DEFAULT_RATE = 17_500; // rupiah per US$, the catalogue's rate

/* ---------- what the operators chose ---------- */

export interface Choice {
  provider: string;
  model: string;
}
export interface Route {
  primary: Choice;
  fallback: Choice | null;
}
interface Saved {
  jobs?: Record<string, Route>;
  prices?: Record<string, [number, number]>; // model id → US$ per million tokens in / out, where it differs from the catalogue
  rate?: number;
  envOff?: boolean; // the Claude key in the server settings is switched off
}
const SETTING = 'aiPlan';
function saved(): Saved {
  const r = db.db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(SETTING) as { value: string } | undefined;
  try {
    return r ? (JSON.parse(r.value) as Saved) : {};
  } catch {
    return {};
  }
}
function save(next: Saved) {
  db.db.prepare('INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(SETTING, JSON.stringify(next));
}

/** Speech to text runs on the meeting recorder, which knows these four. */
export const SPEECH_CHOICES: (Choice & { name: string })[] = [
  { provider: 'groq', model: 'whisper-large-v3', name: 'Whisper large v3' },
  { provider: 'deepgram', model: 'nova-3', name: 'Nova 3' },
  { provider: 'openai', model: 'whisper-1', name: 'Whisper' },
  { provider: 'sumopod', model: 'gemini/gemini-3.5-flash', name: 'Gemini 3.5 Flash (audio)' },
];
const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;
/** Short name for sentences: "Anthropic", "Google", "OpenAI". */
export const companyName = (id: string) => {
  const n = providerName(id);
  return n.match(/\(([^)]+)\)/)?.[1] ?? n;
};
/** Our keys' model lists are kept under this scope (server/models.ts). */
export const PLATFORM = 'platform';
const modelName = (provider: string, model: string) =>
  SPEECH_CHOICES.find((c) => c.provider === provider && c.model === model)?.name ??
  PROVIDERS.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.name ??
  models.cachedList(PLATFORM, provider)?.models.find((m) => m.id === model)?.name ??
  anyName(model);
/** A job's name inside a sentence: "brain dump & briefs", but "Ask AI" stays a name. */
const inSentence = (name: string) => (/^Ask AI/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));
/** A model's name without knowing the provider: the catalogue's, else one made from its id. */
const anyName = (model: string) => PROVIDERS.flatMap((p) => p.models).find((m) => m.id === model)?.name ?? prettyModelName(model);

/** Providers our server can call for text jobs ("custom" is for a company's own server, not ours). */
const TEXT_OK = (id: string) => id !== 'custom' && canCall(id) && PROVIDERS.find((p) => p.id === id)?.kind !== 'speech';
const NOT_FOR_US: Record<string, string> = { custom: 'For a company’s own server. Not used for our keys.' };
const supported = (id: string) => !NOT_FOR_US[id];

/** Today's recommendation for a job, whatever keys exist: the model it was designed around, another company as the fallback. */
function recommendedRoute(job: JobInfo): Route {
  if (job.id === 'speech') return { primary: { provider: 'groq', model: 'whisper-large-v3' }, fallback: { provider: 'deepgram', model: 'nova-3' } };
  const model = job.rec.balanced;
  const provider = PROVIDERS.find((p) => p.kind === 'direct' && p.models.some((m) => m.id === model))?.id ?? 'anthropic';
  const heavy = job.weight === 'Heavy';
  const fallback = provider === 'anthropic' ? { provider: 'google', model: heavy ? 'gemini-3.1-pro' : 'gemini-3.5-flash' } : { provider: 'anthropic', model: heavy ? 'claude-sonnet-5-5' : 'claude-haiku-4-5' };
  return { primary: { provider, model }, fallback };
}

/* Matching a wanted model to the keys we have: "claude-sonnet-5-5", "anthropic/claude-sonnet-5.5" and SumoPod's
   "claude-sonnet-5" are the same family, so a job designed around Claude Sonnet runs on whichever key offers it. */
const normId = (id: string) => id.toLowerCase().replace(/^[\w.-]+\//, '').replace(/[._]/g, '-');
const familyOf = (id: string) => normId(id).replace(/-(preview|latest|exp)$/, '').replace(/-\d{6,8}$/, '').replace(/\d+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
const versionOf = (id: string) => (normId(id).match(/\d+/g) ?? []).map(Number);
const newer = (a: string, b: string) => {
  const x = versionOf(a), y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};
/** The text models a provider offers our key: its own list when it has been read, else our catalogue. */
function offeredIds(provider: string): string[] {
  const l = models.cachedList(PLATFORM, provider);
  if (l && l.source === 'live') return l.models.filter((m) => m.kind === 'text').map((m) => m.id);
  return PROVIDERS.find((p) => p.id === provider)?.models.map((m) => m.id) ?? [];
}
const KIND_ORDER: Record<string, number> = { direct: 0, gateway: 1, cloud: 2 };
/** Where a wanted model runs on our keys: the same model on a direct key first, then the same or the newest of its family anywhere. */
function resolveOn(model: string, keyed: string[]): Choice | null {
  const order = [...keyed].sort((a, b) => (KIND_ORDER[PROVIDERS.find((p) => p.id === a)?.kind ?? ''] ?? 9) - (KIND_ORDER[PROVIDERS.find((p) => p.id === b)?.kind ?? ''] ?? 9));
  for (const p of order) {
    const hit = offeredIds(p).find((id) => normId(id) === normId(model));
    if (hit) return { provider: p, model: hit };
  }
  const fam = familyOf(model);
  for (const p of order) {
    const hit = offeredIds(p).filter((id) => familyOf(id) === fam).sort(newer)[0];
    if (hit) return { provider: p, model: hit };
  }
  return null;
}
/** Without a family match: a catalogue model of the right weight on any key we have. */
function byTier(keyed: string[], heavy: boolean, not?: Choice | null): Choice | null {
  const tiers = heavy ? ['best', 'balanced', 'fast'] : ['fast', 'balanced', 'best'];
  for (const t of tiers)
    for (const p of keyed) {
      const offered = new Set(offeredIds(p).map(normId));
      const m = PROVIDERS.find((x) => x.id === p)?.models.find((mm) => mm.tier === t && offered.has(normId(mm.id)) && !(not && not.provider === p && normId(not.model) === normId(mm.id)));
      if (m) return { provider: p, model: offeredIds(p).find((id) => normId(id) === normId(m.id)) ?? m.id };
    }
  return null;
}
/** Providers with a working key of ours, for text jobs. */
function keyedText(c: Pick<Config, 'envOff'>) {
  return PROVIDERS.filter((p) => TEXT_OK(p.id) && keyFor(p.id, c)).map((p) => p.id);
}

/**
 * The model a job runs on until operators pick one: today's recommendation on the keys we have. With only SumoPod, the
 * jobs designed around Claude run on SumoPod's Claude, and so on. With no key at all it's the plain recommendation.
 */
function defaultRoute(job: JobInfo, c: Pick<Config, 'envOff'>): Route {
  const rec = recommendedRoute(job);
  if (job.id === 'speech') {
    const avail = SPEECH_CHOICES.filter((x) => keyFor(x.provider, c)).map(({ provider, model }) => ({ provider, model }));
    return avail.length ? { primary: avail[0], fallback: avail[1] ?? null } : rec;
  }
  const keyed = keyedText(c);
  if (!keyed.length) return rec;
  const heavy = job.weight === 'Heavy';
  const wants = [rec.primary.model, rec.fallback?.model, job.rec.balanced, job.rec.best, job.rec.cheap].filter((m): m is string => !!m && m !== 'browser');
  const found = wants.map((m) => resolveOn(m, keyed)).filter((x): x is Choice => !!x);
  const primary = found[0] ?? byTier(keyed, heavy);
  if (!primary) return rec;
  const differs = (x: Choice) => x.provider !== primary.provider || familyOf(x.model) !== familyOf(primary.model);
  const fallback = found.find(differs) ?? byTier(keyed, heavy, primary) ?? null;
  return { primary, fallback: fallback && differs(fallback) ? fallback : null };
}
/** Whether a saved choice is one this job can use: any model id the provider could offer (new picks are checked by `offeredChoice`). */
function validChoice(job: string, c: unknown): c is Choice {
  if (!c || typeof c !== 'object') return false;
  const { provider, model } = c as Choice;
  if (typeof provider !== 'string' || typeof model !== 'string') return false;
  if (job === 'speech') return SPEECH_CHOICES.some((x) => x.provider === provider && x.model === model);
  return TEXT_OK(provider) && MODEL_ID.test(model);
}
/** A new pick: on the provider's own list for our key, or (when there's no list) in our catalogue. */
function offeredChoice(job: string, c: unknown): c is Choice {
  if (!validChoice(job, c)) return false;
  if (job === 'speech') return true;
  const live = models.offered(PLATFORM, c.provider, c.model);
  return live ?? !!PROVIDERS.find((p) => p.id === c.provider)?.models.some((m) => m.id === c.model);
}
/** A model the provider stopped offering our key (its list, as last read, doesn't have it). */
const goneForUs = (x: Choice | null) => !!x && models.offered(PLATFORM, x.provider, x.model) === false;

/** Reads our key's list again soon after a call said the model isn't there (at most every five minutes per provider). */
const recheck = new Map<string, number>();
function recheckOurs(provider: string) {
  if ((recheck.get(provider) ?? 0) > Date.now() - 5 * 60_000) return;
  recheck.set(provider, Date.now());
  const c = config();
  const k = keyFor(provider, c);
  if (k) void models.listFor(PLATFORM, provider, k, { force: true, priceOf: (id) => priceOf(id, c) }).catch(() => {});
}
/** Our keys' lists, read (or kept) before the AI page shows the models to pick from. */
export async function warmLists(force = false) {
  const c = config();
  const provs = PROVIDERS.filter((p) => TEXT_OK(p.id) && keyFor(p.id, c)).map((p) => p.id);
  if (force) for (const p of provs) models.forget(PLATFORM, p);
  await Promise.all(provs.map((p) => models.listFor(PLATFORM, p, keyFor(p, c), { priceOf: (id) => priceOf(id, c) })));
}

export function config() {
  const s = saved();
  const keyCtx = { envOff: !!s.envOff };
  const jobs: Record<string, Route> = {};
  for (const j of JOBS) {
    const r = s.jobs?.[j.id];
    jobs[j.id] = r && validChoice(j.id, r.primary) ? { primary: r.primary, fallback: validChoice(j.id, r.fallback) ? r.fallback : null } : defaultRoute(j, keyCtx);
  }
  return { jobs, prices: s.prices ?? {}, rate: s.rate && s.rate > 0 ? s.rate : DEFAULT_RATE, envOff: !!s.envOff };
}
type Config = ReturnType<typeof config>;

/* ---------- prices ---------- */

/**
 * List prices we're sure of for models the catalogue has no price for (US$ per million tokens, in / out).
 * Everything else starts empty: operators fill it in, and the AI page says which ones are missing.
 */
const KNOWN: Record<string, [number, number]> = { 'gpt-5': [1.25, 10], 'gpt-5-mini': [0.25, 2], 'openai/gpt-5-mini': [0.25, 2], 'claude-sonnet-5': [2, 10] };
/** Every text model in the catalogue, once (gateways list the same model under the same id). */
export const PRICE_MODELS = Array.from(new Set(PROVIDERS.filter((p) => p.kind !== 'speech' && p.id !== 'custom').flatMap((p) => p.models.map((m) => m.id))));
/** Models used this month by anyone (on our keys or a company's), how often, and through which provider. */
function usedThisMonth() {
  return db.db
    .prepare("SELECT model, CASE WHEN via IS NOT NULL THEN via WHEN provider = 'included' THEN 'anthropic' ELSE provider END AS prov, COUNT(*) AS uses FROM ai_usage WHERE at >= ? GROUP BY model, prov")
    .all(monthStart()) as { model: string; prov: string; uses: number }[];
}
/** Every model the price list shows: the catalogue's, the ones our jobs use, ones with a price, and ones used this month. */
function priceModelIds(c: Pick<Config, 'jobs' | 'prices'>): string[] {
  const ids = new Set(PRICE_MODELS);
  for (const j of JOBS) if (j.id !== 'speech') for (const x of [c.jobs[j.id].primary, c.jobs[j.id].fallback]) if (x) ids.add(x.model);
  for (const id of Object.keys(c.prices)) ids.add(id);
  for (const r of usedThisMonth()) if (MODEL_ID.test(r.model)) ids.add(r.model);
  return Array.from(ids);
}
export const catalogPrice = (model: string): [number, number] | null => PROVIDERS.flatMap((p) => p.models).find((m) => m.id === model && m.price)?.price ?? KNOWN[model] ?? null;
const norm = (m: string) => m.split('/').pop()!.replace(/\./g, '-').replace(/^anthropic-/, '');
export function priceOf(model: string, c: Pick<Config, 'prices'> = config()): [number, number] | null {
  const own = c.prices[model] ?? catalogPrice(model);
  if (own) return own;
  // The same model under a gateway's name ("anthropic/claude-sonnet-5.5" is Claude Sonnet 5.5).
  const n = norm(model);
  for (const id of PRICE_MODELS) if (id !== model && norm(id) === n) {
    const p = c.prices[id] ?? catalogPrice(id);
    if (p) return p;
  }
  return null;
}
type UsageRow = { model: string; inTokens: number; outTokens: number; uses?: number };
/** What usage rows cost in rupiah at the operators' prices and rate; uses on models without a price are counted apart. */
export function costOf(rows: UsageRow[], c: Pick<Config, 'prices' | 'rate'> = config()) {
  let usd = 0;
  let unpriced = 0;
  for (const r of rows) {
    const p = priceOf(r.model, c);
    if (p) usd += ((r.inTokens || 0) * p[0] + (r.outTokens || 0) * p[1]) / 1e6;
    else unpriced += r.uses ?? 1;
  }
  return { rp: usd * c.rate, usd, unpriced };
}
export const costRp = (rows: UsageRow[]) => costOf(rows).rp;

/** Typical cost of one use of a job (the catalogue's typical tokens), on the model that would run it. */
function perUseRp(jobId: string, c: Config) {
  const job = JOBS.find((j) => j.id === jobId);
  const r = c.jobs[jobId];
  if (!job || !r || jobId === 'speech') return 0;
  for (const x of [r.primary, r.fallback]) {
    const p = x && priceOf(x.model, c);
    if (p) return ((job.tokens[0] * p[0] + job.tokens[1] * p[1]) / 1e6) * c.rate;
  }
  return 0;
}

/* ---------- our keys ---------- */

type KeyDb = { provider: string; sealed: string; base_url: string | null; last4: string; enabled: number; added_by: string | null; added_at: string };
type HealthDb = { id: string; tested_at: string | null; test_ok: number | null; test_error: string | null; used_at: string | null; failed_at: string | null; fail_error: string | null };
const keyRow = (provider: string) => db.db.prepare('SELECT * FROM platform_ai_keys WHERE provider = ?').get(provider) as KeyDb | undefined;
const health = (id: string) => db.db.prepare('SELECT * FROM platform_ai_health WHERE id = ?').get(id) as HealthDb | undefined;
const ENV_ID = 'env:anthropic';
const envKey = () => process.env.ANTHROPIC_API_KEY?.trim() || '';

/** The key our server uses for a provider right now: a saved one that's on, else the Claude key from the server settings. */
export function keyFor(provider: string, c: Pick<Config, 'envOff'> = config()): { key: string; baseUrl?: string; id: string } | null {
  const r = keyRow(provider);
  if (r?.enabled) return { key: db.unseal(r.sealed), baseUrl: r.base_url ?? undefined, id: provider };
  if (provider === 'anthropic' && envKey() && !c.envOff) return { key: envKey(), id: ENV_ID };
  return null;
}

const lastUsedWrite = new Map<string, number>();
/** Remembers how our keys are doing: the last success (at most every few minutes) and the last failure. */
export function noteResult(provider: string, err: unknown) {
  const id = keyFor(provider)?.id ?? provider;
  db.db.prepare('INSERT OR IGNORE INTO platform_ai_health (id) VALUES (?)').run(id);
  if (!err) {
    if ((lastUsedWrite.get(id) ?? 0) > Date.now() - 5 * 60_000) return;
    lastUsedWrite.set(id, Date.now());
    db.db.prepare('UPDATE platform_ai_health SET used_at = ? WHERE id = ?').run(now(), id);
    return;
  }
  db.db.prepare('UPDATE platform_ai_health SET failed_at = ?, fail_error = ? WHERE id = ?').run(now(), plainError(err, provider), id);
}
/** An error from a provider in a short sentence (never the key, never the raw response). */
function plainError(e: unknown, provider: string) {
  const name = companyName(provider);
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 401 || status === 403 || /rejected the key/i.test(msg)) return `${name} rejected the key.`;
  if (status === 429) return `${name} says too many requests, or the account has no credit left.`;
  if (status === 404) return `${name} doesn’t know this model.`;
  if (e instanceof AIError) return msg.replace(/^AI is busy, try again shortly\.$/, `${name} is busy or down.`).slice(0, 200);
  if (status) return `${name} answered with an error (${status}).`;
  return `${name} didn’t answer.`;
}

/** A tiny real request with this key. Null when it works, else what went wrong. */
async function tryKey(provider: string, key: string, baseUrl?: string): Promise<string | null> {
  const name = companyName(provider);
  if (provider === 'deepgram' || provider === 'groq') {
    const url = provider === 'deepgram' ? 'https://api.deepgram.com/v1/projects' : 'https://api.groq.com/openai/v1/models';
    const r = await fetch(url, { headers: { authorization: provider === 'deepgram' ? `Token ${key}` : `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!r) return `${name} didn’t answer.`;
    return r.ok ? null : r.status === 401 || r.status === 403 ? `${name} rejected the key.` : `${name} answered with an error (${r.status}).`;
  }
  // The provider's own list says which model to test with (the catalogue's fast one when it's offered).
  const list = await models.listWith(provider, { key, baseUrl });
  const model = models.testModelFor(provider, list);
  try {
    await testKey({ provider, model, apiKey: key, baseUrl });
    return null;
  } catch (e) {
    // A reasoning model can spend 16 tokens thinking and return no text: the key still worked.
    if (e instanceof AIError && /returned no answer/.test(e.message)) return null;
    return plainError(e, provider);
  }
}
async function testAndRecord(id: string, provider: string, key: string, baseUrl?: string) {
  const err = await tryKey(provider, key, baseUrl);
  db.db.prepare('INSERT OR IGNORE INTO platform_ai_health (id) VALUES (?)').run(id);
  db.db.prepare('UPDATE platform_ai_health SET tested_at = ?, test_ok = ?, test_error = ? WHERE id = ?').run(now(), err ? 0 : 1, err, id);
  return err;
}

/* ---------- who gets our AI ---------- */

export type Why = 'plan' | 'trial' | 'comp';
/** Our keys serve a company only on the AI plan, in an active trial, or with free months on the AI plan. */
export function planAI(ws: any): { ok: boolean; why: Why | null; until: string | null } {
  const plan: Plan | undefined = ws?.plan;
  const no = { ok: false, why: null, until: null };
  if (!plan || ws.suspended) return no;
  const at = now();
  if (plan.trialEnds && plan.trialEnds > at) return { ok: true, why: 'trial', until: plan.trialEnds };
  if (plan.track !== 'ai' || plan.tier === 'free' || plan.paused) return no;
  if (plan.comp?.until && plan.comp.until > at) return { ok: true, why: 'comp', until: plan.comp.until };
  return { ok: true, why: 'plan', until: null };
}

/** Our AI for one job, in order: the operators' pick, then their fallback (each only with a key that's on). */
export function ourChain(job: string): AIConfig[] {
  const c = config();
  const r = c.jobs[job];
  if (!r || job === 'speech') return [];
  const out: AIConfig[] = [];
  for (const x of [r.primary, r.fallback]) {
    if (!x || !TEXT_OK(x.provider) || out.some((o) => o.provider === x.provider && o.model === x.model)) continue;
    // A model the provider no longer offers: the fallback runs instead (the AI page says so).
    if (goneForUs(x)) continue;
    const k = keyFor(x.provider, c);
    if (k) out.push({ provider: x.provider, model: x.model, apiKey: k.key, baseUrl: k.baseUrl, included: true, onFail: (e) => isModelGone(e) && recheckOurs(x.provider) });
  }
  return out;
}
/** Our speech to text for the meeting recorder (AI-plan companies without a speech key of their own), skipping providers the company blocked. */
export function ourSpeech(may: (provider: string) => boolean = () => true) {
  const c = config();
  const r = c.jobs.speech;
  for (const x of [r.primary, r.fallback]) {
    const k = x && may(x.provider) && keyFor(x.provider, c);
    if (x && k) return { provider: x.provider, apiKey: k.key, model: x.provider === 'sumopod' ? x.model : null };
  }
  return null;
}

/**
 * Runs one AI job down a chain of providers: the next one takes over when one fails (a refusal stays a refusal).
 * Every call's tokens are logged; our own keys' results are remembered for the AI page.
 */
export async function runChain<T>(chain: AIConfig[], log: (cfg: AIConfig, inTokens: number, outTokens: number) => void, fn: () => Promise<T>): Promise<T> {
  let last: unknown = new AIError('No AI is set up for this job.', 409);
  for (const cfg of chain) {
    cfg.onUsage = (i, o) => log(cfg, i, o);
    try {
      const out = await withAI(cfg, fn);
      if (cfg.included) noteResult(cfg.provider, null);
      return out;
    } catch (e) {
      last = e;
      if (cfg.included) noteResult(cfg.provider, e);
      try {
        cfg.onFail?.(e);
      } catch {
        /* only a hint */
      }
      if (e instanceof AIError && /declined/.test(e.message)) throw e;
      if (cfg !== chain[chain.length - 1]) console.error(`[ai] ${cfg.included ? 'our ' : ''}${cfg.provider} failed, trying the next one:`, e instanceof Error ? e.message : e);
    }
  }
  // Our own keys failing is our problem, not something the company can fix in its settings.
  if (chain.length && chain[chain.length - 1].included && !(last instanceof SyntaxError)) throw new AIError('AI isn’t available right now. We’ve been told; try again in a few minutes.', 503);
  throw last;
}

/* ---------- the plan's allowance ---------- */

const ALLOWANCE_JOBS: [keyof typeof ALLOWANCE, string][] = [
  ['braindump', 'braindump'],
  ['ask', 'ask'],
  ['meetingHours', 'meeting'],
  ['summary', 'summary'],
  ['draft', 'draft'],
];
/** What one top-up gives (TOP_UP.gives): about this many of each. */
const TOP_UP_GIVES: Record<string, number> = { meeting: 50, ask: 110, braindump: 120, summary: 600 };

/** People on the team (guests don't count). */
export function teamSize(ws: any) {
  return (ws.members ?? []).filter((m: any) => {
    const u = db.getDoc('users', m.userId) as any;
    return u && !u.clientOf && !u.deletedAt;
  }).length;
}
const includedRows = (since: string, wsId?: string) =>
  (wsId
    ? db.db.prepare("SELECT workspace_id AS workspaceId, job, COALESCE(via, 'anthropic') AS prov, model, COUNT(*) AS uses, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE provider = 'included' AND at >= ? AND workspace_id = ? GROUP BY workspace_id, job, prov, model").all(since, wsId)
    : db.db.prepare("SELECT workspace_id AS workspaceId, job, COALESCE(via, 'anthropic') AS prov, model, COUNT(*) AS uses, SUM(in_tokens) AS inTokens, SUM(out_tokens) AS outTokens FROM ai_usage WHERE provider = 'included' AND at >= ? GROUP BY workspace_id, job, prov, model").all(since)) as { workspaceId: string; job: string; prov: string; model: string; uses: number; inTokens: number; outTokens: number }[];

/**
 * The monthly allowance of a company on our AI: the plan's included uses per seat, priced on the models operators
 * picked, plus the top-ups it bought this month (paying companies only: trials and free months aren't invoiced).
 */
export function allowanceOf(ws: any, people = teamSize(ws), c = config()) {
  const plan: Plan = ws.plan;
  const why = planAI(ws).why;
  const seats = seatsFor(plan?.tier ?? 'free', people);
  const unit = Object.fromEntries(JOBS.map((j) => [j.id, perUseRp(j.id, c)])) as Record<string, number>;
  const perSeatRp = ALLOWANCE_JOBS.reduce((n, [k, job]) => n + ALLOWANCE[k] * unit[job], 0);
  const gives = Object.entries(TOP_UP_GIVES).map(([job, n]) => n * unit[job]).filter((v) => v > 0);
  const topUpRp = gives.length ? gives.reduce((a, b) => a + b, 0) / gives.length : 0;
  const topUps = why === 'plan' ? plan.topUps ?? 0 : 0;
  const capRp = seats * perSeatRp + topUps * topUpRp;
  const rows = includedRows(monthStart(), ws.id);
  const usedRp = costOf(rows, c).rp;
  const uses: Record<string, number> = {};
  for (const r of rows) uses[r.job] = (uses[r.job] ?? 0) + r.uses;
  return { seats, unit, perSeatRp, topUpRp, topUps, capRp, usedRp, uses, unlimited: capRp <= 0 };
}

/** Before a job on our AI: fine, fine after adding an automatic top-up, or used up (with what to do). */
export function gate(ws: any, people = teamSize(ws)): { state: 'ok' } | { state: 'topup' } | { state: 'out'; message: string } {
  const a = allowanceOf(ws, people);
  if (a.unlimited || a.usedRp < a.capRp) return { state: 'ok' };
  const why = planAI(ws).why;
  if (why === 'plan') {
    const auto = ws.plan.autoTopUp as Plan['autoTopUp'];
    if (auto?.on && ((ws.plan.topUps ?? 0) + 1) * TOP_UP.price <= auto.limit) return { state: 'topup' };
    return {
      state: 'out',
      message: auto?.on
        ? 'The company’s AI allowance for this month is used up, and automatic top-ups reached their monthly limit. An admin can raise the limit or add a top-up in Settings, Plan & billing.'
        : 'The company’s AI allowance for this month is used up. An admin can add a top-up in Settings, Plan & billing.',
    };
  }
  if (why === 'trial') return { state: 'out', message: 'The AI that comes with the trial is used up for this month. An admin can pick a plan in Settings, Plan & billing, or add an AI key in Settings, AI.' };
  return { state: 'out', message: 'The AI allowance for this month is used up. It starts again on the 1st, or an admin can add an AI key in Settings, AI.' };
}

/** For the company's Settings, AI: who handles its data for each job, and how much of the allowance is left. */
export function companyView(ws: any) {
  const c = config();
  const elig = planAI(ws);
  const route = JOBS.map((j) => {
    const r = c.jobs[j.id];
    const live = [r.primary, r.fallback].find((x) => x && (j.id === 'speech' ? !!keyFor(x.provider, c) : TEXT_OK(x.provider) && !goneForUs(x) && !!keyFor(x.provider, c))) ?? null;
    const backup = live && r.fallback && live === r.primary && keyFor(r.fallback.provider, c) ? r.fallback : null;
    const pick = (x: Choice | null) => (x ? { provider: x.provider, providerName: companyName(x.provider), model: x.model, modelName: modelName(x.provider, x.model), warn: PROVIDERS.find((p) => p.id === x.provider)?.warn ?? null } : null);
    return { job: j.id, name: j.name, run: pick(live), backup: pick(backup) };
  });
  let allowance = null;
  if (elig.ok) {
    const a = allowanceOf(ws, teamSize(ws), c);
    const leftRp = Math.max(0, a.capRp - a.usedRp);
    const left = Object.fromEntries(ALLOWANCE_JOBS.map(([, job]) => [job, a.unit[job] > 0 ? Math.floor(leftRp / a.unit[job]) : null]));
    const pool = Object.fromEntries(ALLOWANCE_JOBS.map(([k, job]) => [job, ALLOWANCE[k] * a.seats]));
    const d = new Date();
    allowance = { unlimited: a.unlimited, share: a.unlimited ? 0 : Math.min(1, a.usedRp / a.capRp), left, pool, uses: a.uses, seats: a.seats, topUps: a.topUps, resets: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString() };
  }
  return { eligible: elig.ok, why: elig.why, until: elig.until, route, allowance };
}

/* ---------- does AI pay for itself ---------- */

/** What the AI plan earns from a company a month: its AI-plan price minus the own-keys price for the same plan, plus top-ups. */
export function aiEarnings(plan: Plan, people: number) {
  if (plan.tier === 'free') return 0;
  const ai = priceFor('ai', plan.tier, people) ?? 0;
  const own = priceFor('own', plan.tier, people) ?? 0;
  let premium = Math.max(0, ai - own);
  const gross = monthlyTotal(plan, people).total;
  if (gross > 0) premium *= 1 - discountOf(plan, gross) / gross;
  if (plan.cycle === 'yearly') premium *= 10 / 12;
  return premium + (plan.topUps ?? 0) * TOP_UP.price;
}

type MrrOf = (ws: any, people: number) => { state: string };
export function money(mrrOf: MrrOf, c = config()) {
  const start = monthStart();
  const d = new Date();
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const days = (end - Date.parse(start)) / DAY;
  const elapsed = Math.min(1, Math.max(1 / days, (Date.now() - Date.parse(start)) / (end - Date.parse(start))));
  const rows = includedRows(start);
  const set = platform.settings();
  const byWs = new Map<string, typeof rows>();
  for (const r of rows) byWs.set(r.workspaceId, [...(byWs.get(r.workspaceId) ?? []), r]);
  const earning: { id: string; name: string; plan: string; earned: number; cost: number; forecast: number }[] = [];
  const other: { id: string; name: string; why: 'trial' | 'comp' | 'internal' | 'other'; cost: number }[] = [];
  for (const ws of db.allDocs('workspaces') as any[]) {
    const people = activePeople(ws).active; // what the invoice bills: the people active this month
    const cost = costOf(byWs.get(ws.id) ?? [], c).rp;
    const internal = set.homeWorkspace === ws.id || set.internal.includes(ws.id);
    const elig = planAI(ws);
    const paying = !internal && ws.plan?.track === 'ai' && mrrOf(ws, people).state === 'paying';
    if (paying) earning.push({ id: ws.id, name: ws.name, plan: planName(ws.plan), earned: aiEarnings(ws.plan, people), cost, forecast: cost / elapsed });
    else if (cost > 0) other.push({ id: ws.id, name: ws.name, why: internal ? 'internal' : elig.why === 'trial' ? 'trial' : elig.why === 'comp' ? 'comp' : 'other', cost });
  }
  const sum = (xs: { [k: string]: any }[], k: string) => xs.reduce((n, x) => n + (x[k] as number), 0);
  const earned = sum(earning, 'earned');
  const cost = sum(earning, 'cost');
  const forecast = cost / elapsed;
  const losing = earning.filter((x) => x.forecast > x.earned && x.cost > 0).sort((a, b) => b.forecast - b.earned - (a.forecast - a.earned));
  const jobs = JOBS.map((j) => {
    const rs = rows.filter((r) => r.job === j.id);
    const uses = rs.reduce((n, r) => n + r.uses, 0);
    const k = costOf(rs, c);
    return { job: j.id, name: j.name, uses, cost: k.rp, perUse: uses ? k.rp / uses : 0, models: Array.from(new Set(rs.map((r) => modelName(r.prov, r.model)))) };
  })
    .filter((x) => x.uses > 0)
    .sort((a, b) => b.cost - a.cost);
  const unpricedUses = new Map<string, number>();
  for (const r of rows) if (!priceOf(r.model, c)) unpricedUses.set(r.model, (unpricedUses.get(r.model) ?? 0) + r.uses);
  return {
    month: start.slice(0, 7),
    elapsed,
    daysLeft: Math.max(0, Math.ceil((end - Date.now()) / DAY)),
    companies: earning.length,
    earned,
    cost,
    forecast,
    margin: earned - forecast,
    losing,
    other: other.sort((a, b) => b.cost - a.cost),
    otherCost: sum(other, 'cost'),
    jobs,
    unpriced: Array.from(unpricedUses, ([model, uses]) => ({ model, name: anyName(model), uses })),
  };
}

/** The headline: lead with whether AI pays for itself. */
function verdict(m: ReturnType<typeof money>) {
  const n = m.losing.length;
  if (!m.companies && !m.otherCost) return { tone: 'neutral' as const, text: 'No AI-plan companies are using AI yet this month.' };
  if (!m.companies) return { tone: 'neutral' as const, text: `Nobody pays for the AI plan yet: trials, free months and our own companies used ${rp(m.otherCost)} of AI this month.` };
  if (m.margin < 0) return { tone: 'bad' as const, text: `AI costs more than it earns: ${rp(-m.margin)} short by the end of the month${n ? `, and ${n} ${n === 1 ? 'company costs' : 'companies cost'} more than ${n === 1 ? 'it pays' : 'they pay'}` : ''}.` };
  if (n) return { tone: 'warn' as const, text: `${n} ${n === 1 ? 'company costs' : 'companies cost'} more than ${n === 1 ? 'it pays' : 'they pay'}. Overall AI still pays for itself: margin ${rp(m.margin)}.` };
  return { tone: 'good' as const, text: `AI is paying for itself: margin ${rp(m.margin)} this month.` };
}

/** Problems with our AI, for Today and the alerts (worst first). */
export function problems(mrrOf: MrrOf): { kind: string; text: string; level: 'high' | 'normal'; to: string }[] {
  const c = config();
  const out: { kind: string; text: string; level: 'high' | 'normal'; to: string }[] = [];
  const served = (db.allDocs('workspaces') as any[]).some((w) => planAI(w).ok);
  const dead = JOBS.filter((j) => j.id !== 'speech' && !ourChain(j.id).length);
  if (served && dead.length)
    out.push({ kind: 'ai-keys', level: 'high', text: dead.length === JOBS.length - 1 ? 'Our AI has no working key: AI-plan companies can’t use AI.' : `Our AI has no working key for ${dead.slice(0, 2).map((j) => inSentence(j.name)).join(' and ')}${dead.length > 2 ? ` and ${dead.length - 2} more` : ''}.`, to: '/admin/ai/keys' });
  const inUse = new Set(Object.values(c.jobs).flatMap((r) => [r.primary, r.fallback]).filter(Boolean).map((x) => x!.provider));
  for (const p of inUse) {
    const k = keyFor(p, c);
    const h = k && health(k.id);
    if (h?.failed_at && (!h.used_at || h.failed_at > h.used_at) && h.failed_at > new Date(Date.now() - DAY).toISOString()) out.push({ kind: `ai-fail:${p}`, level: 'normal', text: `Our ${companyName(p)} key failed: ${h.fail_error ?? 'no answer'}`, to: '/admin/ai/keys' });
  }
  const m = money(mrrOf, c);
  if (m.cost > 0 && m.margin < 0) out.push({ kind: 'ai-margin', level: 'normal', text: `AI costs more than the AI plan earns: ${rp(-m.margin)} short by the end of the month.`, to: '/admin/ai' });
  else if (m.losing.length) out.push({ kind: 'ai-losing', level: 'normal', text: `${m.losing.length} ${m.losing.length === 1 ? 'company’s AI costs' : 'companies’ AI costs'} more than ${m.losing.length === 1 ? 'it pays' : 'they pay'}.`, to: '/admin/ai' });
  // A model a provider stopped offering our key: the job runs on its fallback (or not at all).
  for (const j of JOBS.filter((x) => x.id !== 'speech')) {
    const r = c.jobs[j.id];
    if (!goneForUs(r.primary)) continue;
    const fb = r.fallback && !goneForUs(r.fallback) && keyFor(r.fallback.provider, c) ? r.fallback : null;
    out.push({ kind: `ai-gone:${j.id}`, level: fb ? 'normal' : 'high', text: `${companyName(r.primary.provider)} no longer offers ${modelName(r.primary.provider, r.primary.model)}: ${inSentence(j.name)} ${fb ? `runs on its fallback, ${modelName(fb.provider, fb.model)}` : 'has nothing to run on'}. Pick another model.`, to: '/admin/ai/models' });
  }
  // Models that ran this month (on our keys or a company's), or would run now (they have a key), without a price.
  const routed = JOBS.filter((j) => j.id !== 'speech').flatMap((j) => [c.jobs[j.id].primary, c.jobs[j.id].fallback]);
  const missing = new Set([...m.unpriced.map((u) => u.model), ...usedThisMonth().filter((u) => MODEL_ID.test(u.model) && !priceOf(u.model, c)).map((u) => u.model), ...routed.filter((y) => y && keyFor(y.provider, c) && !priceOf(y.model, c)).map((y) => y!.model)]);
  if (missing.size) {
    const names = Array.from(missing).map(anyName);
    out.push({ kind: 'ai-prices', level: 'normal', text: `No price for ${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}: their AI cost isn’t counted.`, to: '/admin/ai/prices' });
  }
  return out;
}

/* ---------- the operator console's routes (/api/admin/ai...) ---------- */

export interface AdminBits {
  req: IncomingMessage;
  res: ServerResponse;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  body: (req: IncomingMessage) => Promise<any>;
  may: (perm: platform.Perm) => boolean;
  deny: (perm: platform.Perm) => boolean;
  log: (action: string, target: string | null, detail?: string) => void;
  email: string;
  mrrOf: MrrOf;
}

function overview(x: AdminBits) {
  const c = config();
  const m = money(x.mrrOf, c);
  const users = db.allDocs('users') as any[];
  const who = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? id : null);
  const hRow = (id: string) => {
    const h = health(id);
    return { testedAt: h?.tested_at ?? null, testOk: h?.test_ok === null || h?.test_ok === undefined ? null : !!h.test_ok, testError: h?.test_error ?? null, usedAt: h?.used_at ?? null, failedAt: h?.failed_at ?? null, failError: h?.fail_error ?? null };
  };
  const rowsDb = db.db.prepare('SELECT provider, base_url, last4, enabled, added_by, added_at FROM platform_ai_keys').all() as Omit<KeyDb, 'sealed'>[];
  const used = (provider: string) => JOBS.filter((j) => [c.jobs[j.id].primary, c.jobs[j.id].fallback].some((y) => y?.provider === provider)).map((j) => j.id);
  const keys = [
    ...rowsDb.map((r) => ({ id: r.provider, provider: r.provider, name: providerName(r.provider), source: 'saved' as const, last4: r.last4, on: !!r.enabled, inUse: !!r.enabled, baseUrl: r.base_url, addedBy: who(r.added_by), addedAt: r.added_at, jobs: used(r.provider), ...hRow(r.provider) })),
    ...(envKey() ? [{ id: ENV_ID, provider: 'anthropic', name: providerName('anthropic'), source: 'server' as const, last4: envKey().slice(-4), on: !c.envOff, inUse: !c.envOff && !rowsDb.some((r) => r.provider === 'anthropic' && r.enabled), baseUrl: null, addedBy: null, addedAt: null, jobs: used('anthropic'), ...hRow(ENV_ID) }] : []),
  ];
  const option = (provider: string, model: string, name: string, recommended = true, gone = false) => ({ provider, providerName: providerName(provider), model, name, price: priceOf(model, c), hasKey: !!keyFor(provider, c), recommended, gone });
  // Each provider's own list for our key when it could be read (catalogue models first), else our catalogue.
  const lists = PROVIDERS.filter((p) => TEXT_OK(p.id)).map((p) => ({ id: p.id, list: models.cachedList(PLATFORM, p.id) }));
  const text = lists.flatMap(({ id, list }) =>
    list && list.source === 'live' ? list.models.filter((mm) => mm.kind === 'text').map((mm) => option(id, mm.id, mm.name, mm.recommended)) : PROVIDERS.find((p) => p.id === id)!.models.map((mm) => option(id, mm.id, mm.name)),
  );
  // What jobs use now stays pickable, even when the provider stopped offering it.
  for (const j of JOBS.filter((x) => x.id !== 'speech'))
    for (const y of [c.jobs[j.id].primary, c.jobs[j.id].fallback])
      if (y && !text.some((o) => o.provider === y.provider && o.model === y.model)) text.push(option(y.provider, y.model, `${modelName(y.provider, y.model)}${goneForUs(y) ? ' (no longer offered)' : ''}`, false, goneForUs(y)));
  const speech = SPEECH_CHOICES.map((s) => ({ ...option(s.provider, s.model, s.name), price: null }));
  const jobs = JOBS.map((j) => {
    const r = c.jobs[j.id];
    const ok = (y: Choice | null) => !!y && !!keyFor(y.provider, c) && (j.id === 'speech' || (TEXT_OK(y.provider) && !goneForUs(y)));
    const p = j.id === 'speech' ? null : priceOf(r.primary.model, c);
    const gone = j.id !== 'speech' && goneForUs(r.primary);
    return {
      id: j.id,
      name: j.name,
      hint: j.hint,
      weight: j.weight,
      tokens: j.tokens,
      primary: r.primary,
      fallback: r.fallback,
      state: ok(r.primary) ? 'ok' : ok(r.fallback) ? 'fallback' : 'none',
      gone: gone ? `${companyName(r.primary.provider)} no longer offers ${modelName(r.primary.provider, r.primary.model)}.` : null,
      per100: p ? ((j.tokens[0] * p[0] + j.tokens[1] * p[1]) / 1e6) * c.rate * 100 : null,
      isDefault: !saved().jobs?.[j.id],
    };
  });
  const monthUse = usedThisMonth();
  const prices = priceModelIds(c).map((id) => {
    const provs = PROVIDERS.filter((p) => p.kind !== 'speech' && p.models.some((mm) => mm.id === id)).map((p) => p.id);
    const routes = JOBS.filter((j) => j.id !== 'speech').flatMap((j) => [c.jobs[j.id].primary, c.jobs[j.id].fallback]).filter((y) => y?.model === id).map((y) => y!.provider);
    const via = monthUse.filter((u) => u.model === id);
    const usedBy = JOBS.filter((j) => j.id !== 'speech' && [c.jobs[j.id].primary, c.jobs[j.id].fallback].some((y) => y?.model === id)).map((j) => j.id);
    const where = Array.from(new Set([...provs, ...routes, ...via.map((u) => u.prov)]));
    return { model: id, name: modelName(where[0] ?? '', id), providers: where.map(providerName), price: priceOf(id, c), own: c.prices[id] ?? null, catalog: catalogPrice(id), usedBy, uses: via.reduce((n, u) => n + u.uses, 0) };
  });
  return {
    can: x.may('platform'),
    verdict: verdict(m),
    money: m,
    keys,
    providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, kind: p.kind, keyHint: p.keyHint, needsUrl: !!p.needsUrl, warn: p.warn ?? null, supported: supported(p.id), why: NOT_FOR_US[p.id] ?? null, saved: rowsDb.some((r) => r.provider === p.id) })),
    jobs,
    options: { text, speech },
    lists: lists.filter((l) => l.list && keyFor(l.id, c)).map(({ id, list }) => ({ provider: id, name: providerName(id), source: list!.source, fetchedAt: list!.fetchedAt, note: list!.note })),
    prices,
    rate: c.rate,
    defaultRate: DEFAULT_RATE,
    problems: problems(x.mrrOf),
  };
}

export async function handleAdmin(sub: string, x: AdminBits): Promise<boolean> {
  const { req, res, json, body } = x;
  const done = (data: unknown, status = 200) => (json(res, status, data), true);
  if (sub === 'ai' && req.method === 'GET') {
    await warmLists().catch(() => {});
    return done(overview(x));
  }
  if (req.method !== 'POST' || !sub.startsWith('ai/')) return false;
  if (x.deny('platform')) return true;
  const b = await body(req);
  const provider = String(b.provider ?? '');
  const info = PROVIDERS.find((p) => p.id === provider);

  // Read our keys' model lists from the providers again (they're otherwise kept about an hour).
  if (sub === 'ai/models/refresh') {
    await warmLists(true).catch(() => {});
    return done({ ok: true });
  }

  if (sub === 'ai/key') {
    if (!info) return done({ error: 'Pick a provider.' }, 400);
    if (!supported(provider)) return done({ error: NOT_FOR_US[provider] }, 400);
    const key = String(b.key ?? '').trim();
    const baseUrl = String(b.baseUrl ?? '').trim() || undefined;
    if (key.length < 8) return done({ error: 'That key looks too short.' }, 400);
    if (info.needsUrl && !CRED_FIELDS[info.id] && !baseUrl) return done({ error: 'Add the endpoint address too.' }, 400);
    const err = await testAndRecord(provider, provider, key, baseUrl);
    if (err) return done({ error: `${err} Nothing was saved.` }, 400);
    const before = keyRow(provider);
    db.db
      .prepare('INSERT INTO platform_ai_keys (provider, sealed, base_url, last4, enabled, added_by, added_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(provider) DO UPDATE SET sealed = excluded.sealed, base_url = excluded.base_url, last4 = excluded.last4, enabled = 1, added_by = excluded.added_by, added_at = excluded.added_at')
      .run(provider, db.seal(key), baseUrl ?? null, keyHint(provider, key), (db.allDocs('users') as any[]).find((u) => String(u.email ?? '').toLowerCase() === x.email)?.id ?? x.email, now());
    db.db.prepare('UPDATE platform_ai_health SET used_at = NULL, failed_at = NULL, fail_error = NULL WHERE id = ?').run(provider);
    models.forget(PLATFORM, provider); // the new key's own list is read next time
    x.log(before ? 'ai.key.rotate' : 'ai.key.add', provider, `${providerName(provider)} •••• ${keyHint(provider, key)}${before ? ` (was •••• ${before.last4})` : ''}`);
    return done({ last4: keyHint(provider, key) });
  }
  if (sub === 'ai/key/test') {
    const server = b.source === 'server';
    const k = server ? (envKey() ? { key: envKey(), baseUrl: undefined } : null) : (() => {
      const r = keyRow(provider);
      return r ? { key: db.unseal(r.sealed), baseUrl: r.base_url ?? undefined } : null;
    })();
    if (!k || (server && provider !== 'anthropic')) return done({ error: 'No such key.' }, 404);
    const err = await testAndRecord(server ? ENV_ID : provider, provider, k.key, k.baseUrl);
    return done({ ok: !err, error: err });
  }
  if (sub === 'ai/key/switch') {
    const on = !!b.on;
    if (b.source === 'server') {
      if (!envKey()) return done({ error: 'No key in the server settings.' }, 404);
      save({ ...saved(), envOff: !on });
      x.log(on ? 'ai.key.on' : 'ai.key.off', 'anthropic', 'the key from the server settings');
      return done({ ok: true });
    }
    if (!keyRow(provider)) return done({ error: 'No such key.' }, 404);
    db.db.prepare('UPDATE platform_ai_keys SET enabled = ? WHERE provider = ?').run(on ? 1 : 0, provider);
    x.log(on ? 'ai.key.on' : 'ai.key.off', provider, providerName(provider));
    return done({ ok: true });
  }
  if (sub === 'ai/key/remove') {
    const r = keyRow(provider);
    if (!r) return done({ error: 'No such key.' }, 404);
    db.db.prepare('DELETE FROM platform_ai_keys WHERE provider = ?').run(provider);
    db.db.prepare('DELETE FROM platform_ai_health WHERE id = ?').run(provider);
    models.forget(PLATFORM, provider);
    x.log('ai.key.remove', provider, `${providerName(provider)} •••• ${r.last4}`);
    return done({ ok: true });
  }
  if (sub === 'ai/job') {
    const job = JOBS.find((j) => j.id === b.job);
    if (!job) return done({ error: 'No such job.' }, 400);
    // A new pick must be on the provider's list for our key (or in our catalogue when there's no list); what the job
    // already uses may stay, so the other choice can change.
    const cur = config().jobs[job.id];
    const same = (a: Choice | null | undefined, y: unknown) => !!a && !!y && a.provider === (y as Choice).provider && a.model === (y as Choice).model;
    const okPick = (y: unknown): y is Choice => offeredChoice(job.id, y) || ((same(cur.primary, y) || same(cur.fallback, y)) && validChoice(job.id, y));
    if (!okPick(b.primary)) return done({ error: 'Pick a model this job can use.' }, 400);
    const fallback = b.fallback ? (okPick(b.fallback) ? { provider: b.fallback.provider, model: b.fallback.model } : undefined) : null;
    if (fallback === undefined) return done({ error: 'Pick a fallback this job can use, or none.' }, 400);
    const s = saved();
    const next: Route = { primary: { provider: b.primary.provider, model: b.primary.model }, fallback };
    save({ ...s, jobs: { ...s.jobs, [job.id]: next } });
    const say = (y: Choice | null) => (y ? `${modelName(y.provider, y.model)} on ${companyName(y.provider)}` : 'no fallback');
    x.log('ai.job', job.id, `${job.name}: ${say(next.primary)}, then ${say(next.fallback)}`);
    return done({ ok: true });
  }
  if (sub === 'ai/jobs/reset') {
    // Only the jobs set to a provider we have no working key for, or every job: back to automatic, which follows our keys.
    if (b.noKeyOnly) {
      const s0 = saved();
      const c = config();
      const stuck = Object.keys(s0.jobs ?? {}).filter((id) => {
        const r = s0.jobs![id];
        return !r || !keyFor(r.primary.provider, c);
      });
      if (!stuck.length) return done({ ok: true, moved: 0 });
      const jobs = { ...s0.jobs };
      for (const id of stuck) delete jobs[id];
      save({ ...s0, jobs });
      x.log('ai.jobs.reset', null, `${stuck.length} job${stuck.length === 1 ? '' : 's'} without a working key back to automatic`);
      return done({ ok: true, moved: stuck.length });
    }
    const { jobs: _j, ...rest } = saved();
    save(rest);
    x.log('ai.jobs.reset', null, 'every job back to automatic: the recommended models on the keys we have');
    return done({ ok: true });
  }
  // One model for every text job (picked right after adding a key, or from a key's menu). The fallback stays what each
  // job would use otherwise, when that's a different model.
  if (sub === 'ai/key/assign') {
    const pick = { provider, model: String(b.model ?? '') };
    if (!keyFor(provider)) return done({ error: 'Add a working key for this provider first.' }, 400);
    if (!offeredChoice('ask', pick)) return done({ error: 'Pick a model this key offers.' }, 400);
    const s0 = saved();
    const c = config();
    const jobs = { ...s0.jobs };
    let n = 0;
    for (const j of JOBS) {
      if (j.id === 'speech') continue;
      const cur = c.jobs[j.id];
      const fb = [cur.primary, cur.fallback, defaultRoute(j, c).fallback].find((y) => y && keyFor(y.provider, c) && !(y.provider === pick.provider && y.model === pick.model)) ?? null;
      jobs[j.id] = { primary: pick, fallback: fb };
      n++;
    }
    save({ ...s0, jobs });
    x.log('ai.jobs.assign', provider, `${n} jobs: ${modelName(provider, pick.model)} on ${companyName(provider)}`);
    return done({ ok: true, jobs: n });
  }
  if (sub === 'ai/prices') {
    const s = saved();
    const prices: Record<string, [number, number]> = { ...s.prices };
    const changes: string[] = [];
    const num = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 10_000 ? Math.round(v * 10_000) / 10_000 : null);
    const listed = new Set(priceModelIds(config()));
    for (const [model, v] of Object.entries((b.prices ?? {}) as Record<string, unknown>)) {
      if (!listed.has(model)) continue;
      const before = priceOf(model, { prices: s.prices ?? {} });
      const pair = Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null ? ([num(v[0])!, num(v[1])!] as [number, number]) : null;
      const cat = catalogPrice(model);
      if (!pair || (cat && cat[0] === pair[0] && cat[1] === pair[1])) delete prices[model];
      else prices[model] = pair;
      const after = prices[model] ?? cat;
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push(`${model} ${after ? `$${after[0]} / $${after[1]}` : 'no price'}`);
    }
    let rate = s.rate && s.rate > 0 ? s.rate : DEFAULT_RATE;
    if (b.rate !== undefined) {
      const r = Number(b.rate);
      if (!(r >= 1000 && r <= 100_000)) return done({ error: 'The rate should be rupiah for one US dollar, e.g. 17.500.' }, 400);
      if (Math.round(r) !== rate) changes.push(`US$1 = Rp ${Math.round(r).toLocaleString('id-ID')}`);
      rate = Math.round(r);
    }
    save({ ...s, prices, rate });
    if (changes.length) x.log('ai.prices', null, changes.join('; ').slice(0, 900));
    return done({ ok: true, changed: changes.length });
  }
  if (sub === 'ai/prices/reset') {
    const { prices: _p, rate: _r, ...rest } = saved();
    save(rest);
    x.log('ai.prices.reset', null, 'catalogue prices and Rp 17.500 to the dollar');
    return done({ ok: true });
  }
  return false;
}
