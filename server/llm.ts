// One entry point for every AI call, whatever provider the company picked for that job:
// Claude through the Anthropic SDK; Claude in Amazon Bedrock (Messages API, SigV4); Gemini on Google Vertex AI
// (generateContent, with a service account); everything else, Azure OpenAI included, through Chat Completions.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSign } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { sigv4 } from './sigv4.ts';

export interface AIConfig {
  provider: string;
  model: string;
  apiKey: string; // for Bedrock, Vertex and Azure: their details as JSON (see CRED_FIELDS in src/data/aiCatalog.ts)
  baseUrl?: string;
  included?: boolean; // sprint2go's own key (the plan's allowance), not the company's
  onUsage?: (inTokens: number, outTokens: number) => void; // every call reports its tokens (for the cost estimate)
  onFail?: (e: unknown) => void; // told when this provider failed (e.g. to check whether it still offers the model)
}

/** OpenAI-compatible endpoints. Claude goes through the Anthropic SDK instead. */
export const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  sumopod: 'https://ai.sumopod.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
};
/** The providers' own APIs where they aren't OpenAI-compatible (their model lists). */
export const NATIVE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  'google-native': 'https://generativelanguage.googleapis.com/v1beta',
};
/**
 * Local testing only (never in production): S2G_AI_TEST_BASES, JSON like {"sumopod":"http://127.0.0.1:9000/v1"},
 * points providers at a fake server on this machine, so adding a key, its model list and a job can be tried end to end.
 */
const TEST_BASES: Record<string, string> = (() => {
  if (process.env.NODE_ENV === 'production' || !process.env.S2G_AI_TEST_BASES) return {};
  try {
    const m = JSON.parse(process.env.S2G_AI_TEST_BASES) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(v as string))) as Record<string, string>;
  } catch {
    return {};
  }
})();
/** Where a provider's API lives (a test base on a laptop, else the real one). */
export const apiBase = (provider: string) => TEST_BASES[provider] ?? BASE_URLS[provider] ?? NATIVE_URLS[provider] ?? '';
/** Company cloud accounts: their details come as JSON in the key. */
export const CLOUD = new Set(['bedrock', 'vertex', 'azure']);
/** Whether this server can call a provider for text. */
export const canCall = (provider: string) => provider === 'anthropic' || CLOUD.has(provider) || provider === 'custom' || provider in BASE_URLS;
/** Providers that follow a JSON schema exactly; the rest get the schema in the instructions and JSON mode. */
const STRICT_SCHEMA = new Set(['openai', 'openrouter', 'sumopod', 'google', 'azure']);

export class AIError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/** The AI for the request being handled (set per request with `withAI`). */
const current = new AsyncLocalStorage<AIConfig>();
export const withAI = <T>(cfg: AIConfig, fn: () => Promise<T>) => current.run(cfg, fn);

type Opts = { system: string; schema?: Record<string, unknown>; effort?: 'low' | 'medium' | 'high'; maxTokens?: number };

export async function complete(prompt: string, opts: Opts): Promise<string> {
  const ai = current.getStore();
  if (!ai) throw new AIError('No AI is set up for this job.', 409);
  if (ai.provider === 'anthropic') return anthropic(ai, prompt, opts);
  if (ai.provider === 'bedrock') return bedrock(ai, prompt, opts);
  if (ai.provider === 'vertex') return vertex(ai, prompt, opts);
  return openaiCompatible(ai, prompt, opts);
}

/** For providers without structured outputs: the schema goes in the instructions, and code fences come off the answer. */
const schemaInSystem = (opts: Opts) => (opts.schema ? `${opts.system}\n\nReply with a single JSON object that matches this JSON Schema exactly:\n${JSON.stringify(opts.schema)}` : opts.system);
const unfence = (text: string) => text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');

async function anthropic(ai: AIConfig, prompt: string, opts: Opts) {
  const client = new Anthropic({ apiKey: ai.apiKey, ...(TEST_BASES.anthropic ? { baseURL: TEST_BASES.anthropic } : {}) });
  const isHaiku = ai.model.startsWith('claude-haiku');
  const fallback = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(ai.model);
  const response = await client.beta.messages.create({
    model: ai.model,
    max_tokens: opts.maxTokens ?? 16000,
    ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    system: opts.system,
    output_config: {
      ...(isHaiku ? {} : { effort: opts.effort ?? 'low' }),
      ...(opts.schema ? { format: { type: 'json_schema' as const, schema: opts.schema } } : {}),
    },
    messages: [{ role: 'user', content: prompt }],
  });
  ai.onUsage?.(response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0), response.usage.output_tokens);
  if (response.stop_reason === 'refusal') throw new AIError('The request was declined.');
  return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

/* ---------- company cloud accounts ---------- */

/** The details a company entered for a cloud provider (JSON in the key). */
function cloud<T>(ai: AIConfig, name: string): T {
  try {
    const c = JSON.parse(ai.apiKey);
    if (c && typeof c === 'object') return c as T;
  } catch {
    /* below */
  }
  throw new AIError(`Enter the ${name} details again in Settings, AI.`, 400);
}
/** What to show for a saved key: its last 4 characters (for cloud accounts, of the key or key ID inside). */
export function keyHint(provider: string, key: string) {
  if (!CLOUD.has(provider)) return key.trim().slice(-4);
  try {
    const c = JSON.parse(key);
    const s = provider === 'bedrock' ? c.accessKeyId : provider === 'azure' ? c.apiKey : JSON.parse(c.serviceAccount).private_key_id;
    return String(s ?? '').slice(-4) || '····';
  } catch {
    return '····';
  }
}

/** The answer of a provider that failed, as a short error (never the raw response). */
function httpError(status: number, name: string, model: string, detail?: string): AIError {
  if (status === 401 || status === 403) return new AIError(`${name} rejected the key${status === 403 ? ', or it has no access to this model' : ''}. Check it in Settings, AI.`, 400);
  if (status === 404) return new AIError(`${name} doesn’t offer ${model} here, or the account has no access to it.`, 400);
  if (status === 429 || status >= 500) return new AIError('AI is busy, try again shortly.', 503);
  return new AIError(`${name}: ${String(detail ?? `HTTP ${status}`).slice(0, 200)}`);
}

/**
 * Claude in Amazon Bedrock: the Messages API at bedrock-mantle.{region}.api.aws, signed with the account's access key
 * (SigV4, service bedrock-mantle). Model IDs carry an "anthropic." prefix. Bedrock has no structured outputs and no
 * server-side fallback, so JSON is asked for in the instructions.
 */
async function bedrock(ai: AIConfig, prompt: string, opts: Opts) {
  const c = cloud<{ region?: string; accessKeyId?: string; secretAccessKey?: string }>(ai, 'Amazon Bedrock');
  const region = String(c.region ?? '').trim();
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) throw new AIError('The AWS region doesn’t look right. It looks like us-east-1 or ap-southeast-3.', 400);
  if (!c.accessKeyId || !c.secretAccessKey) throw new AIError('Add the access key ID and the secret access key.', 400);
  const body = JSON.stringify({
    model: ai.model,
    max_tokens: opts.maxTokens ?? 16000,
    system: schemaInSystem(opts),
    ...(/haiku-4/.test(ai.model) ? {} : { output_config: { effort: opts.effort ?? 'low' } }),
    messages: [{ role: 'user', content: prompt }],
  });
  const host = `bedrock-mantle.${region}.api.aws`;
  const path = '/anthropic/v1/messages';
  const headers = sigv4({ method: 'POST', host, path, region, service: 'bedrock-mantle', body, accessKeyId: String(c.accessKeyId).trim(), secretAccessKey: String(c.secretAccessKey).trim(), headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' } });
  const res = await fetch(`https://${host}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(180_000) }).catch(() => null);
  if (!res) throw new AIError('Amazon Bedrock didn’t answer. Check the region.', 503);
  const data = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; error?: { message?: string }; message?: string };
  if (data.usage) ai.onUsage?.((data.usage.input_tokens ?? 0) + (data.usage.cache_read_input_tokens ?? 0) + (data.usage.cache_creation_input_tokens ?? 0), data.usage.output_tokens ?? 0);
  if (!res.ok) throw httpError(res.status, 'Amazon Bedrock', ai.model, data.error?.message ?? data.message);
  if (data.stop_reason === 'refusal') throw new AIError('The request was declined.');
  const text = (data.content ?? []).flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('');
  return opts.schema ? unfence(text) : text;
}

/* Google Vertex AI: a service account signs a short JWT, swaps it for an access token (cached), then generateContent. */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'; // never the token_uri inside the file: the key is only ever sent here
type ServiceAccount = { client_email: string; private_key: string; private_key_id?: string; project_id: string };
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');
/** The signed assertion a service account trades for an access token (RS256, one hour). Exported for the tests. */
export function vertexJwt(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: GOOGLE_TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key).toString('base64url');
  return `${header}.${claims}.${signature}`;
}
const tokens = new Map<string, { token: string; until: number }>();
async function vertexToken(sa: ServiceAccount) {
  const id = `${sa.client_email}|${sa.private_key_id ?? ''}`;
  const hit = tokens.get(id);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  let assertion: string;
  try {
    assertion = vertexJwt(sa);
  } catch {
    throw new AIError('The service account’s private key can’t be read. Download a new JSON key and paste it again.', 400);
  }
  const res = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res) throw new AIError('Google didn’t answer.', 503);
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new AIError(`Google rejected the service account${data.error_description ? `: ${data.error_description.slice(0, 120)}` : ''}. Check it in Settings, AI.`, 400);
  tokens.set(id, { token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}
/** The service account and region a company entered, checked. */
export function vertexAccount(ai: Pick<AIConfig, 'apiKey'>): { sa: ServiceAccount; region: string } {
  const c = cloud<{ region?: string; serviceAccount?: string }>(ai as AIConfig, 'Google Vertex AI');
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(String(c.serviceAccount ?? ''));
  } catch {
    throw new AIError('Paste the whole service account key file (JSON) from Google Cloud.', 400);
  }
  if (!sa?.client_email || !sa.private_key || !sa.project_id) throw new AIError('That file isn’t a service account key: it needs client_email, private_key and project_id.', 400);
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(sa.project_id)) throw new AIError('The project ID in the key file doesn’t look right.', 400);
  const region = String(c.region ?? '').trim() || 'global';
  if (!/^(global|[a-z]+-[a-z]+\d+)$/.test(region)) throw new AIError('The region doesn’t look right. Use global, or one like us-central1 or asia-southeast2.', 400);
  return { sa, region };
}
async function vertex(ai: AIConfig, prompt: string, opts: Opts) {
  const { sa, region } = vertexAccount(ai);
  const token = await vertexToken(sa);
  const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${sa.project_id}/locations/${region}/publishers/google/models/${encodeURIComponent(ai.model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: schemaInSystem(opts) }] },
    generationConfig: { maxOutputTokens: opts.maxTokens ?? 16000, ...(opts.schema ? { responseMimeType: 'application/json' } : {}) },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) }).catch(() => null);
  if (!res) throw new AIError('Google Vertex AI didn’t answer.', 503);
  const data = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string }; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; error?: { message?: string } };
  if (data.usageMetadata) ai.onUsage?.(data.usageMetadata.promptTokenCount ?? 0, (data.usageMetadata.candidatesTokenCount ?? 0) + (data.usageMetadata.thoughtsTokenCount ?? 0));
  if (res.status === 401) tokens.delete(`${sa.client_email}|${sa.private_key_id ?? ''}`);
  if (!res.ok) throw httpError(res.status, 'Google Vertex AI', ai.model, data.error?.message);
  const cand = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') throw new AIError('The request was declined.');
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  if (!text) throw new AIError(`vertex returned no answer (${cand?.finishReason ?? 'empty'}).`);
  return opts.schema ? unfence(text) : text;
}

/** Where a Chat Completions request goes: Azure OpenAI by resource endpoint and deployment, the rest by base URL. */
function chatTarget(ai: AIConfig): { url: string; headers: Record<string, string>; model: string } {
  if (ai.provider === 'azure') {
    const c = cloud<{ endpoint?: string; deployment?: string; apiVersion?: string; apiKey?: string }>(ai, 'Azure OpenAI');
    let u: URL;
    try {
      u = new URL(String(c.endpoint ?? '').trim());
    } catch {
      throw new AIError('Add the endpoint of the Azure resource, like https://your-resource.openai.azure.com', 400);
    }
    if (u.protocol !== 'https:' || !/\.azure\.(com|us|cn)$/i.test(u.hostname)) throw new AIError('The endpoint must be your Azure resource, like https://your-resource.openai.azure.com', 400);
    const deployment = String(c.deployment ?? '').trim();
    if (!/^[\w.-]{1,64}$/.test(deployment)) throw new AIError('Add the deployment name from Azure AI Foundry.', 400);
    if (!c.apiKey) throw new AIError('Add the API key of the Azure resource.', 400);
    const version = String(c.apiVersion ?? '').trim() || 'v1';
    if (!/^(v1|\d{4}-\d{2}-\d{2}(-preview)?)$/.test(version)) throw new AIError('The API version should be v1, or a date like 2025-04-01-preview.', 400);
    // The v1 API takes the deployment as the model; dated versions put it in the path.
    const url = version === 'v1' ? `${u.origin}/openai/v1/chat/completions` : `${u.origin}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${version}`;
    return { url, headers: { 'api-key': String(c.apiKey).trim() }, model: deployment };
  }
  const { base, headers } = openaiBase(ai);
  return { url: `${base}/chat/completions`, headers, model: ai.model };
}

/** An OpenAI-compatible provider's base URL (checked when the company typed it) and its auth header. */
export function openaiBase(ai: Pick<AIConfig, 'provider' | 'apiKey' | 'baseUrl'>): { base: string; headers: Record<string, string> } {
  const base = (ai.baseUrl || apiBase(ai.provider) || '').replace(/\/$/, '');
  // A custom base URL must be a public https address: never this server, the network or a cloud metadata service.
  if (ai.baseUrl) {
    let h = '';
    try {
      const u = new URL(ai.baseUrl);
      h = u.hostname.toLowerCase();
      if (u.protocol !== 'https:') throw new Error();
    } catch {
      throw new AIError('The provider address must start with https://', 400);
    }
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) === false && !h.includes('.')) throw new AIError('That provider address points inside the network, which isn’t allowed.', 400);
  }
  if (!base || !(ai.provider in BASE_URLS || ai.provider === 'custom')) throw new AIError(`${ai.provider} isn't supported yet. Pick another provider for this job.`, 400);
  return { base, headers: ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {} };
}

/** Whether an error says the provider doesn't offer that model (any more), rather than being down or rejecting the key. */
export function isModelGone(e: unknown) {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/rejected the key|busy/i.test(msg)) return false;
  return status === 404 || /doesn.t offer|model.{0,40}(not found|does not exist|doesn.t exist|not available|unknown|invalid|not supported|no longer)|(unknown|invalid|no such) model/i.test(msg);
}

async function openaiCompatible(ai: AIConfig, prompt: string, opts: Opts, plainJson = false): Promise<string> {
  const target = chatTarget(ai);
  const strict = !!opts.schema && STRICT_SCHEMA.has(ai.provider) && !plainJson;
  const system = opts.schema && !strict ? schemaInSystem(opts) : opts.system;
  const body = {
    model: target.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    ...(opts.schema ? { response_format: strict ? { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: opts.schema } } : { type: 'json_object' } } : {}),
    ...(ai.provider === 'openai' || ai.provider === 'azure' ? { max_completion_tokens: opts.maxTokens ?? 16000 } : { max_tokens: Math.min(opts.maxTokens ?? 8000, 8000) }),
  };
  const res = await fetch(target.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...target.headers },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  if (data.usage) ai.onUsage?.(data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
  // Gateways route to many models and not all accept a JSON schema: retry once in plain JSON mode.
  if (!res.ok && strict && res.status === 400 && /response_format|json_schema|schema/i.test(JSON.stringify(data))) return openaiCompatible(ai, prompt, opts, true);
  if (res.status === 401 || res.status === 403) throw new AIError(`${ai.provider} rejected the key. Check it in Settings, AI.`, 400);
  if (res.status === 429 || res.status >= 500) throw new AIError('AI is busy, try again shortly.', 503);
  if (ai.provider === 'azure' && res.status === 404) throw new AIError('Azure doesn’t know that deployment. Check the deployment name and endpoint.', 400);
  if (res.status === 404) throw new AIError(`${ai.provider} doesn’t offer ${target.model}, or the key has no access to it.`, 400);
  if (!res.ok) throw new AIError(`${ai.provider}: ${String(data.error?.message ?? `HTTP ${res.status}`).slice(0, 200)}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AIError(`${ai.provider} returned no answer (${data.choices?.[0]?.finish_reason ?? 'empty'}).`);
  return opts.schema ? unfence(text) : text;
}

/** A tiny request to check that a key works before saving it. */
export async function testKey(cfg: AIConfig): Promise<void> {
  try {
    await withAI(cfg, () => complete('Reply with the single word: ok', { system: 'You are a connection test.', maxTokens: 16 }));
  } catch (e) {
    // A thinking model can spend 16 tokens thinking and answer no text. The provider accepted the key all the same.
    if (e instanceof AIError && /returned no answer/.test(e.message)) return;
    throw e;
  }
}
