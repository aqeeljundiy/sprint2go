// The models a key can use, read from the provider itself: OpenAI-compatible GET /models (OpenAI, SumoPod, OpenRouter,
// DeepSeek, Mistral, Qwen, Groq and a company's own server), Anthropic's and Gemini's own lists, and Bedrock's
// foundation models (signed with SigV4). Lists are merged with our catalogue (src/data/aiModels.ts) and kept about an
// hour per company and provider. Keys never leave the server: lists carry ids, names and prices only.
// When a provider stops offering a model a company's jobs use, those jobs move to the job's fallback (movesFor).
import { AIError, apiBase, isModelGone, openaiBase, testKey } from './llm.ts';
import { canonicalQuery, sha256Hex, signV4 } from './sigv4.ts';
import { JOBS, PROVIDERS, presetJobs, providerOf } from '../src/data/aiCatalog.ts';
import { MODEL_ID, catalogList, defaultModelOf, mergeModels, modelLabel, type ModelList, type RawModel } from '../src/data/aiModels.ts';
import type { ProviderId } from '../src/types.ts';

const HOUR = 3_600_000;
/** Providers whose list is GET {base}/models in OpenAI's shape. */
export const OPENAI_LISTS = new Set(['openai', 'sumopod', 'openrouter', 'deepseek', 'mistral', 'qwen', 'groq', 'custom']);
/** Providers without a list we read: why our catalogue is shown. */
const NO_LIST: Record<string, string> = {
  azure: 'Azure runs the model of your deployment.',
  vertex: 'Showing our list for Vertex AI. You can type another model id.',
};
/** The company behind a provider, for sentences: "Claude (Anthropic)" is Anthropic. */
const nameOf = (provider: string) => {
  const n = PROVIDERS.find((p) => p.id === provider)?.name ?? provider;
  return n.match(/\(([^)]+)\)/)?.[1] ?? n;
};

/* ---------- the providers' list formats ---------- */

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
/**
 * OpenAI's shape: { data: [{ id, … }] }. OpenRouter adds a name, prices per token and what goes in and out; Mistral
 * says which models chat. Embeddings, images, speech and the like are dropped later by id (modelKind).
 */
export function parseOpenAIList(body: unknown): RawModel[] {
  const data = (body as { data?: unknown })?.data ?? (Array.isArray(body) ? body : null);
  if (!Array.isArray(data)) throw new Error('not a model list');
  const out: RawModel[] = [];
  for (const m of data as Record<string, any>[]) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    // Mistral: only models that chat.
    if (m.capabilities && typeof m.capabilities === 'object' && m.capabilities.completion_chat === false) continue;
    // OpenRouter: models that answer in text.
    const outs = m.architecture?.output_modalities;
    if (Array.isArray(outs) && !outs.includes('text')) continue;
    if (Array.isArray(outs) && outs.some((x: string) => x === 'image' || x === 'audio')) continue;
    if (m.active === false) continue; // Groq marks retired models
    const pin = num(m.pricing?.prompt);
    const pout = num(m.pricing?.completion);
    const price: [number, number] | null = isFinite(pin) && isFinite(pout) && pin >= 0 && pout >= 0 ? [round(pin * 1e6), round(pout * 1e6)] : null;
    const name = typeof m.name === 'string' && m.name.trim() && m.name !== id ? cleanName(m.name) : undefined;
    out.push({ id, name, price });
  }
  return out;
}
const round = (n: number) => Math.round(n * 10_000) / 10_000;
/** OpenRouter's names carry the company: "Anthropic: Claude Sonnet 4.5" is Claude Sonnet 4.5. */
const cleanName = (s: string) => s.replace(/^[^:]{1,40}:\s+/, '').trim().slice(0, 80);

/** Anthropic: { data: [{ type: 'model', id, display_name }], has_more, last_id }. */
export function parseAnthropicList(body: unknown): { models: RawModel[]; next: string | null } {
  const b = body as { data?: { id?: string; display_name?: string; type?: string }[]; has_more?: boolean; last_id?: string };
  if (!Array.isArray(b?.data)) throw new Error('not a model list');
  const models = b.data.filter((m) => typeof m?.id === 'string' && (!m.type || m.type === 'model')).map((m) => ({ id: m.id!, name: m.display_name?.trim() || undefined }));
  return { models, next: b.has_more && b.last_id ? b.last_id : null };
}

/** Gemini: { models: [{ name: 'models/…', displayName, supportedGenerationMethods }], nextPageToken }; only models that generateContent. */
export function parseGeminiList(body: unknown): { models: RawModel[]; next: string | null } {
  const b = body as { models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
  if (!Array.isArray(b?.models)) throw new Error('not a model list');
  const models = b.models
    .filter((m) => typeof m?.name === 'string' && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => ({ id: m.name!.replace(/^models\//, ''), name: m.displayName?.trim() || undefined }));
  return { models, next: b.nextPageToken || null };
}

/**
 * Bedrock's foundation models: { modelSummaries: [{ modelId, modelName, providerName, outputModalities, … }] }.
 * Our Bedrock calls are Claude's Messages API, so only Anthropic's models that answer in text, and still offered.
 */
export function parseBedrockList(body: unknown): RawModel[] {
  const b = body as { modelSummaries?: Record<string, any>[] };
  if (!Array.isArray(b?.modelSummaries)) throw new Error('not a model list');
  return b.modelSummaries
    .filter((m) => typeof m?.modelId === 'string' && (m.providerName === 'Anthropic' || m.modelId.startsWith('anthropic.')))
    .filter((m) => !Array.isArray(m.outputModalities) || m.outputModalities.includes('TEXT'))
    .filter((m) => m.modelLifecycle?.status !== 'LEGACY')
    .map((m) => ({ id: m.modelId, name: typeof m.modelName === 'string' ? `${m.modelName} on Bedrock` : undefined }));
}

/* ---------- reading a list ---------- */

class ListError extends Error {
  status: number;
  constructor(status: number) {
    super(`list ${status}`);
    this.status = status;
  }
}
async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(12_000), redirect: 'error' }).catch(() => null);
  if (!res) throw new ListError(0);
  if (!res.ok) throw new ListError(res.status);
  const text = await res.text();
  if (text.length > 8_000_000) throw new ListError(0);
  try {
    return JSON.parse(text);
  } catch {
    throw new ListError(0);
  }
}

export type Cred = { key: string; baseUrl?: string };
/** The provider's own list of models for this key, unmerged. Null: this provider has no list we read. Throws when it can't be read. */
export async function fetchModels(provider: string, cred: Cred): Promise<RawModel[] | null> {
  if (OPENAI_LISTS.has(provider)) {
    const { base, headers } = openaiBase({ provider, apiKey: cred.key, baseUrl: cred.baseUrl });
    return parseOpenAIList(await getJson(`${base}/models`, headers));
  }
  if (provider === 'anthropic') {
    const all: RawModel[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ limit: '1000', ...(after ? { after_id: after } : {}) });
      const r = parseAnthropicList(await getJson(`${apiBase('anthropic')}/v1/models?${q}`, { 'x-api-key': cred.key, 'anthropic-version': '2023-06-01' }));
      all.push(...r.models);
      if (!r.next) break;
      after = r.next;
    }
    return all;
  }
  if (provider === 'google') {
    const all: RawModel[] = [];
    let token: string | null = null;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ pageSize: '1000', ...(token ? { pageToken: token } : {}) });
      // The key goes in a header, never in the address (addresses end up in logs).
      const r = parseGeminiList(await getJson(`${apiBase('google-native')}/models?${q}`, { 'x-goog-api-key': cred.key }));
      all.push(...r.models);
      if (!r.next) break;
      token = r.next;
    }
    return all;
  }
  if (provider === 'bedrock') {
    let c: { region?: string; accessKeyId?: string; secretAccessKey?: string };
    try {
      c = JSON.parse(cred.key);
    } catch {
      throw new ListError(400);
    }
    const region = String(c.region ?? '').trim();
    if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region) || !c.accessKeyId || !c.secretAccessKey) throw new ListError(400);
    const host = `bedrock.${region}.amazonaws.com`;
    const path = '/foundation-models';
    const query = canonicalQuery({ byOutputModality: 'TEXT' });
    const signed = signV4({ method: 'GET', host, path, query, payloadHash: sha256Hex(''), region, service: 'bedrock', key: String(c.accessKeyId).trim(), secret: String(c.secretAccessKey).trim() });
    return parseBedrockList(await getJson(`https://${host}${path}?${query}`, signed.headers));
  }
  return null;
}

/** Why the provider's list couldn't be read, for the person picking a model. */
function listProblem(provider: string, e: unknown) {
  const name = nameOf(provider);
  const status = (e as { status?: number })?.status;
  if (status === 401 || status === 403) return provider === 'bedrock' ? `${name} didn’t let this key read its model list (it needs bedrock:ListFoundationModels). Showing our list; you can type a model id.` : `${name} didn’t let this key read its model list. Showing our list; you can type a model id.`;
  if (e instanceof AIError) return `${e.message} Showing our list.`;
  return `${name}’s model list couldn’t be read just now. Showing our list; you can type a model id.`;
}

/** The provider's list merged with the catalogue, or the catalogue with the reason. Never throws. */
export async function listWith(provider: string, cred: Cred | null, priceOf?: (id: string) => [number, number] | null): Promise<ModelList> {
  if (!cred) return catalogList(provider, 'No key is saved for it yet.', priceOf);
  try {
    const raw = await fetchModels(provider, cred);
    return raw ? mergeModels(provider, raw, priceOf) : catalogList(provider, NO_LIST[provider] ?? null, priceOf);
  } catch (e) {
    return catalogList(provider, listProblem(provider, e), priceOf);
  }
}

/* ---------- kept about an hour, per company (or our keys) and provider ---------- */

const cache = new Map<string, { at: number; list: ModelList }>();
const inflight = new Map<string, Promise<ModelList>>();
const ck = (scope: string, provider: string) => `${scope}|${provider}`;

/** The list for a scope ("ws:<id>" or "platform") and provider: kept an hour (a list that failed, five minutes). */
export async function listFor(scope: string, provider: string, cred: Cred | null, opts: { force?: boolean; priceOf?: (id: string) => [number, number] | null } = {}): Promise<ModelList> {
  const k = ck(scope, provider);
  const hit = cache.get(k);
  if (!opts.force && hit && Date.now() - hit.at < (hit.list.source === 'live' ? HOUR : 5 * 60_000)) return hit.list;
  const running = inflight.get(k);
  if (running) return running;
  const p = listWith(provider, cred, opts.priceOf)
    .then((list) => (remember(scope, provider, list), list))
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}
export const remember = (scope: string, provider: string, list: ModelList) => void cache.set(ck(scope, provider), { at: Date.now(), list });
export const cachedList = (scope: string, provider: string) => cache.get(ck(scope, provider))?.list ?? null;
/** Forgets a scope's lists (a key was replaced or removed). */
export function forget(scope: string, provider?: string) {
  for (const k of Array.from(cache.keys())) if (k === ck(scope, provider ?? '') || (!provider && k.startsWith(`${scope}|`))) cache.delete(k);
}
/** Whether the provider's own list (as last read) has this model. Null when there's no list to tell. */
export function offered(scope: string, provider: string, model: string): boolean | null {
  const l = cachedList(scope, provider);
  if (!l || l.source !== 'live') return null;
  return l.models.some((m) => m.id === model);
}

/* ---------- one model, checked ---------- */

/** One tiny call with a model id (typed in, or picked to try). Null when it answered, else what went wrong. */
export async function checkModel(provider: string, model: string, cred: Cred): Promise<string | null> {
  if (!MODEL_ID.test(model)) return 'That doesn’t look like a model id: letters, numbers and . _ : / - only.';
  try {
    await testKey({ provider, model, apiKey: cred.key, baseUrl: cred.baseUrl });
    return null;
  } catch (e) {
    if (isModelGone(e)) return `${nameOf(provider)} doesn’t offer “${model}” to this key. Check the id on the provider’s site.`;
    return e instanceof AIError ? e.message : `${nameOf(provider)} didn’t answer. Try again in a moment.`;
  }
}

/** The model to test a new key with: the catalogue's fast one when the provider offers it, else a small one it lists. */
export function testModelFor(provider: string, list: ModelList | null): string {
  const info = providerOf(provider as ProviderId);
  const fast = info?.models.find((m) => m.tier === 'fast')?.id ?? info?.models[0]?.id ?? '';
  if (!list || list.source !== 'live') return fast;
  const text = list.models.filter((m) => m.kind === 'text');
  if (!text.length || text.some((m) => m.id === fast)) return fast;
  const small = /mini|flash|haiku|small|lite|nano|[-_:]([1-9]|1[0-4])b\b/i;
  return (text.find((m) => m.recommended && m.tier === 'fast') ?? text.find((m) => small.test(m.id)) ?? text.find((m) => m.recommended) ?? text[0]).id;
}

/* ---------- a model the provider stopped offering ---------- */

type Pick = { provider: string; model: string; fallback?: string; typed?: boolean };
type Conn = { id: string; status?: string; model?: string; typed?: boolean };
export type AILike = { preset?: string; providers: Conn[]; jobs: Partial<Record<string, Pick>>; blocked?: string[]; notes?: { id: string; at: string; text: string }[] };

const jobWord = (name: string) => (/^Ask AI/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));
const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const shortName = nameOf;

/**
 * A company's AI settings after a fresh list from one provider: jobs on a model it no longer offers move to the job's
 * fallback (its fallback provider, else this key's default model, else what the preset picks, else the first model the
 * provider offers), with a note for Settings ("SumoPod no longer offers X; summaries moved to Y"). Models typed in by
 * hand aren't on lists and stay. Null when nothing changes.
 */
export function movesFor<T extends AILike>(ai: T, provider: string, list: ModelList, at = new Date().toISOString()): T | null {
  if (list.source !== 'live') return null;
  const text = list.models.filter((m) => m.kind === 'text');
  const conn = ai.providers.find((p) => p.id === provider);
  if (!conn || !text.length) return null;
  const live = new Set(list.models.map((m) => m.id));
  const gone = (id?: string) => !!id && !live.has(id);
  const moving = JOBS.filter((j) => j.id !== 'speech' && ai.jobs[j.id]?.provider === provider && !ai.jobs[j.id]!.typed && gone(ai.jobs[j.id]!.model));
  const defaultGone = !conn.typed && gone(conn.model);
  if (!moving.length && !defaultGone) return null;
  // The same tier on this provider, else the first recommended model, else the first one it offers.
  const like = (id?: string) => {
    const tier = providerOf(provider as ProviderId)?.models.find((m) => m.id === id)?.tier;
    return ((tier && text.find((m) => m.recommended && m.tier === tier)) || text.find((m) => m.recommended) || text[0]).id;
  };
  const newDefault = conn.model && !defaultGone ? conn.model : defaultGone ? like(conn.model) : undefined;
  const usable = ai.providers.filter((p) => p.status !== 'error' && !(ai.blocked ?? []).includes(p.id)).map((p) => p.id as ProviderId);
  const preset = ai.preset === 'best' || ai.preset === 'cheap' ? ai.preset : 'balanced';
  const fill = presetJobs(preset, usable, false, { live: { [provider]: Array.from(live) }, defaults: { [provider]: newDefault } });
  const instead = (jobId: string, pick: Pick): { provider: string; model: string } => {
    const fb = pick.fallback && pick.fallback !== provider && usable.includes(pick.fallback as ProviderId) ? ai.providers.find((p) => p.id === pick.fallback) : undefined;
    const fbModel = fb && defaultModelOf(fb.id, fb.model, ai.jobs as Record<string, Pick>);
    if (fb && fbModel) return { provider: fb.id, model: fbModel };
    if (newDefault && newDefault !== pick.model) return { provider, model: newDefault };
    const f = (fill as Record<string, { provider: string; model: string } | undefined>)[jobId];
    if (f?.model && f.provider !== 'included' && !(f.provider === provider && gone(f.model))) return f;
    return { provider, model: like(pick.model) };
  };
  const jobs = { ...ai.jobs };
  const groups = new Map<string, { from: string; to: { provider: string; model: string }; names: string[] }>();
  for (const j of moving) {
    const pick = ai.jobs[j.id]!;
    const to = instead(j.id, pick);
    jobs[j.id] = { provider: to.provider, model: to.model, ...(pick.fallback ? { fallback: pick.fallback } : {}) } as Pick;
    const key = `${pick.model}>${to.provider}|${to.model}`;
    const g = groups.get(key) ?? { from: pick.model, to, names: [] };
    g.names.push(jobWord(j.name));
    groups.set(key, g);
  }
  const who = shortName(provider);
  const label = (p: string, id: string) => modelLabel(id, p === provider ? list : null);
  const texts = Array.from(groups.values()).map((g) => `${who} no longer offers ${label(provider, g.from)}; ${joinAnd(g.names)} moved to ${label(g.to.provider, g.to.model)}${g.to.provider !== provider ? ` on ${shortName(g.to.provider)}` : ''}.`);
  if (defaultGone && !groups.has(`${conn.model}>${provider}|${newDefault}`) && newDefault) texts.push(`${who} no longer offers ${label(provider, conn.model!)}; the key now uses ${label(provider, newDefault)}.`);
  const stamp = Date.parse(at) || Date.now();
  return {
    ...ai,
    providers: ai.providers.map((p) => (p.id === provider && defaultGone ? { ...p, model: newDefault, typed: undefined } : p)),
    jobs,
    notes: [...texts.map((text, i) => ({ id: `gone-${stamp}-${i}`, at, text })), ...(ai.notes ?? [])].slice(0, 5),
  };
}
