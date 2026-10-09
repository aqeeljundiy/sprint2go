import type { ProviderId } from '../types';
import { PROVIDERS, providerOf } from './aiCatalog';

// The models a provider really offers a key. The server reads each provider's own list (server/models.ts) and merges it
// with our catalogue here: catalogue models keep their friendly names, tiers and prices; the rest get a readable name
// from their id and no price. Without a server (the demo), or when a list can't be read, the catalogue is the list.

export type Tier = 'best' | 'balanced' | 'fast';
export interface ModelEntry {
  id: string; // exactly what the provider calls it, sent as is
  name: string;
  family: string; // Claude, GPT, Gemini…
  tier?: Tier;
  price: [number, number] | null; // US$ per million tokens in / out, when known
  recommended: boolean; // in our catalogue: checked by us
  kind: 'text' | 'speech';
}
export interface ModelList {
  provider: string;
  source: 'live' | 'catalog'; // the provider's own list, or our catalogue
  fetchedAt: string | null;
  note: string | null; // why our catalogue is shown instead of the provider's list
  models: ModelEntry[];
}
/** One model as a provider's list describes it. */
export interface RawModel {
  id: string;
  name?: string;
  price?: [number, number] | null;
  kind?: 'text' | 'speech' | 'other';
}

/** A model id a provider could accept: letters, digits and . _ : / @ + - (no spaces, no URLs). */
export const MODEL_ID = /^[\w][\w.:/@+-]{0,199}$/;

const FAMILIES: [RegExp, string][] = [
  [/claude/, 'Claude'],
  [/^(gpt|chatgpt|o\d|codex)|gpt-/, 'GPT'],
  [/gemini/, 'Gemini'],
  [/gemma/, 'Gemma'],
  [/deepseek/, 'DeepSeek'],
  [/qwen|qwq/, 'Qwen'],
  [/mistral|mixtral|codestral|ministral|magistral|pixtral|devstral|voxtral/, 'Mistral'],
  [/llama/, 'Llama'],
  [/grok/, 'Grok'],
  [/kimi|moonshot/, 'Kimi'],
  [/glm|chatglm/, 'GLM'],
  [/command|cohere|aya/, 'Cohere'],
  [/whisper/, 'Whisper'],
  [/^nova-\d/, 'Deepgram'],
  [/nova/, 'Nova'],
  [/phi-?\d/, 'Phi'],
  [/minimax/, 'MiniMax'],
];
/** The order families are listed in; anything else follows alphabetically. */
const FAMILY_ORDER = ['Claude', 'GPT', 'Gemini', 'DeepSeek', 'Qwen', 'Mistral', 'Llama', 'Grok', 'Kimi', 'GLM'];

/** The last part of an id, without gateway or cloud prefixes ("anthropic/…", "gemini/…", "us.anthropic.…"). */
const bare = (id: string) =>
  id
    .split('/')
    .pop()!
    .replace(/^models\//, '')
    .replace(/^(?:[a-z]{2}\.)?(?:anthropic|meta|amazon|mistral|cohere|ai21)\./, '')
    .replace(/-v\d+:\d+$/, ''); // Bedrock's version suffix

export function familyOf(id: string): string {
  const b = bare(id).toLowerCase();
  const hit = FAMILIES.find(([re]) => re.test(b));
  if (hit) return hit[1];
  const owner = id.includes('/') ? id.split('/')[0] : '';
  return owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : 'Other';
}

const WORDS: Record<string, string> = {
  gpt: 'GPT',
  deepseek: 'DeepSeek',
  qwq: 'QwQ',
  glm: 'GLM',
  vl: 'VL',
  mini: 'mini',
  nano: 'nano',
  it: 'IT',
  minimax: 'MiniMax',
  chatgpt: 'ChatGPT',
};
/** A readable name from a model id: "gpt-4o-mini" is GPT-4o mini, "claude-sonnet-4-5-20250929" is Claude Sonnet 4.5. */
export function prettyModelName(id: string): string {
  const parts = bare(id)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .filter((t) => !/^\d{8}$/.test(t) && t !== 'latest'); // dates and "latest" say nothing to a person
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    const low = t.toLowerCase();
    const prev = out[out.length - 1];
    // Version numbers split by dashes: claude-sonnet-4-5 is 4.5.
    if (/^\d{1,2}$/.test(t) && prev && /^\d{1,2}(\.\d{1,2})?$/.test(prev) && !prev.includes('.')) {
      out[out.length - 1] = `${prev}.${t}`;
      continue;
    }
    let w = WORDS[low] ?? (/^[a-z]\d/.test(low) && low.length <= 4 ? low.toUpperCase() : /^\d+(\.\d+)?[bkm]$/.test(low) ? low.toUpperCase() : /^\d+x\d+b$/.test(low) ? low.replace(/b$/, 'B') : /^[a-z]/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t);
    // OpenAI's names keep their dash: GPT-5, GPT-4o.
    if (prev === 'GPT' && /^\d/.test(t)) {
      out[out.length - 1] = `GPT-${t}`;
      continue;
    }
    if (low === 'o1' || low === 'o3' || low === 'o4') w = low;
    out.push(w);
  }
  return out.join(' ') || id;
}

/** What a model is for, from its id: chat and text, speech to text, or something we don't use (embeddings, images…). */
export function modelKind(id: string): 'text' | 'speech' | 'other' {
  const b = id.toLowerCase();
  if (/whisper|transcribe|paraformer|sensevoice|^nova-\d/.test(b)) return 'speech';
  if (/embed|moderation|tts|dall-?e|gpt-image|imagen|-image|image-|realtime|rerank|ocr|guard|sora|veo|davinci|babbage|text-similarity|audio|stable-diffusion|flux|lyria|cosyvoice|wanx|aqa|-live|computer-use|^gpt-3\.5-turbo-instruct/.test(b)) return 'other';
  return 'text';
}

const familyRank = (f: string) => {
  const i = FAMILY_ORDER.indexOf(f);
  return i < 0 ? FAMILY_ORDER.length : i;
};
/** Newer versions first within a family: "Claude Sonnet 5.5" before "Claude Sonnet 4.5". */
const byName = (a: ModelEntry, b: ModelEntry) => b.name.localeCompare(a.name, 'en', { numeric: true, sensitivity: 'base' });

/** Catalogue models a provider lists (the placeholder for a company's own server isn't one). */
const catalogModels = (provider: string) => (providerOf(provider as ProviderId)?.models ?? []).filter((m) => m.id !== 'custom');

/** Our catalogue as the list, when there's no server or the provider's list can't be read. */
export function catalogList(provider: string, note: string | null = null, priceOf?: (id: string) => [number, number] | null): ModelList {
  const kindOf = providerOf(provider as ProviderId)?.kind;
  return {
    provider,
    source: 'catalog',
    fetchedAt: null,
    note,
    models: catalogModels(provider).map((m) => ({ id: m.id, name: m.name, family: familyOf(m.id), tier: m.tier, price: m.price ?? priceOf?.(m.id) ?? null, recommended: true, kind: kindOf === 'speech' ? 'speech' : 'text' })),
  };
}

/**
 * The provider's list merged with the catalogue: only models the provider offers, recommended (catalogue) ones first in
 * the catalogue's order, then by family, newest first. Chat and speech models only.
 */
export function mergeModels(provider: string, raw: RawModel[], priceOf?: (id: string) => [number, number] | null, fetchedAt = new Date().toISOString()): ModelList {
  const cat = catalogModels(provider);
  const seen = new Set<string>();
  const rec: ModelEntry[] = [];
  const rest: ModelEntry[] = [];
  for (const r of raw) {
    if (!r?.id || seen.has(r.id) || !MODEL_ID.test(r.id)) continue;
    const kind = r.kind ?? modelKind(r.id);
    if (kind === 'other') continue;
    seen.add(r.id);
    const c = cat.find((m) => m.id === r.id);
    const entry: ModelEntry = c
      ? { id: r.id, name: c.name, family: familyOf(r.id), tier: c.tier, price: c.price ?? priceOf?.(r.id) ?? r.price ?? null, recommended: true, kind }
      : { id: r.id, name: r.name?.trim() || prettyModelName(r.id), family: familyOf(r.id), price: r.price ?? priceOf?.(r.id) ?? null, recommended: false, kind };
    (c ? rec : rest).push(entry);
  }
  if (!rec.length && !rest.length) return catalogList(provider, 'The provider’s list had no chat models, so ours is shown.', priceOf);
  rec.sort((a, b) => cat.findIndex((m) => m.id === a.id) - cat.findIndex((m) => m.id === b.id));
  rest.sort((a, b) => familyRank(a.family) - familyRank(b.family) || a.family.localeCompare(b.family) || byName(a, b));
  // Two ids with the same readable name (dated versions): the id tells them apart.
  const all = [...rec, ...rest];
  const count = new Map<string, number>();
  for (const m of all) count.set(m.name, (count.get(m.name) ?? 0) + 1);
  for (const m of all) if ((count.get(m.name) ?? 0) > 1 && !m.recommended) m.name = `${m.name} (${m.id.split('/').pop()})`;
  return { provider, source: 'live', fetchedAt, note: null, models: all };
}

/** "$2 / $10 per million tokens", or that the price isn't known. */
export const priceText = (p: [number, number] | null | undefined) => (p ? `US$${fmt(p[0])} in, US$${fmt(p[1])} out per million tokens` : 'price unknown');
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

/** The model a connected key uses by default: the one picked for it, else the one most of its jobs use, else the first recommended. */
export function defaultModelOf(provider: string, chosen: string | undefined, jobs: Record<string, { provider: string; model: string } | undefined>, list?: ModelList | null) {
  if (chosen) return chosen;
  const counts = new Map<string, number>();
  for (const j of Object.values(jobs)) if (j?.provider === provider && j.model && j.model !== 'browser') counts.set(j.model, (counts.get(j.model) ?? 0) + 1);
  const most = Array.from(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (most) return most;
  const text = (list?.models ?? catalogList(provider).models).filter((m) => m.kind === 'text');
  return text.find((m) => m.tier === 'balanced')?.id ?? text[0]?.id ?? '';
}

/** A model's name for sentences: the list's, the catalogue's, or one made from its id. */
export function modelLabel(id: string, list?: ModelList | null) {
  return list?.models.find((m) => m.id === id)?.name ?? PROVIDERS.flatMap((p) => p.models).find((m) => m.id === id)?.name ?? prettyModelName(id);
}
