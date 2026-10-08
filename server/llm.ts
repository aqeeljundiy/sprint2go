// One entry point for every AI call, whatever provider the company picked for that job:
// Claude through the Anthropic SDK, everything else through the OpenAI-compatible Chat Completions API.
import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';

export interface AIConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  included?: boolean; // sprint2go's own key (the plan's allowance), not the company's
  onUsage?: (inTokens: number, outTokens: number) => void; // every call reports its tokens (for the cost estimate)
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
/** Providers that follow a JSON schema exactly; the rest get the schema in the instructions and JSON mode. */
const STRICT_SCHEMA = new Set(['openai', 'openrouter', 'sumopod', 'google']);

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

export async function complete(prompt: string, opts: { system: string; schema?: Record<string, unknown>; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }): Promise<string> {
  const ai = current.getStore();
  if (!ai) throw new AIError('No AI is set up for this job.', 409);
  if (ai.provider === 'anthropic') return anthropic(ai, prompt, opts);
  return openaiCompatible(ai, prompt, opts);
}

async function anthropic(ai: AIConfig, prompt: string, opts: { system: string; schema?: Record<string, unknown>; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }) {
  const client = new Anthropic({ apiKey: ai.apiKey });
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

async function openaiCompatible(ai: AIConfig, prompt: string, opts: { system: string; schema?: Record<string, unknown>; maxTokens?: number }, plainJson = false): Promise<string> {
  const base = (ai.baseUrl || BASE_URLS[ai.provider] || '').replace(/\/$/, '');
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
  if (!base) throw new AIError(`${ai.provider} isn't supported yet. Pick another provider for this job.`, 400);
  const strict = !!opts.schema && STRICT_SCHEMA.has(ai.provider) && !plainJson;
  const system = opts.schema && !strict ? `${opts.system}\n\nReply with a single JSON object that matches this JSON Schema exactly:\n${JSON.stringify(opts.schema)}` : opts.system;
  const body = {
    model: ai.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    ...(opts.schema ? { response_format: strict ? { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: opts.schema } } : { type: 'json_object' } } : {}),
    ...(ai.provider === 'openai' ? { max_completion_tokens: opts.maxTokens ?? 16000 } : { max_tokens: Math.min(opts.maxTokens ?? 8000, 8000) }),
  };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  if (data.usage) ai.onUsage?.(data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0);
  // Gateways route to many models and not all accept a JSON schema: retry once in plain JSON mode.
  if (!res.ok && strict && res.status === 400 && /response_format|json_schema|schema/i.test(JSON.stringify(data))) return openaiCompatible(ai, prompt, opts, true);
  if (res.status === 401 || res.status === 403) throw new AIError(`${ai.provider} rejected the key. Check it in Settings, AI.`, 400);
  if (res.status === 429 || res.status >= 500) throw new AIError('AI is busy, try again shortly.', 503);
  if (!res.ok) throw new AIError(`${ai.provider}: ${data.error?.message ?? `HTTP ${res.status}`}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AIError(`${ai.provider} returned no answer (${data.choices?.[0]?.finish_reason ?? 'empty'}).`);
  return opts.schema ? text.replace(/^```(?:json)?\s*|\s*```$/g, '') : text;
}

/** A tiny request to check that a key works before saving it. */
export async function testKey(cfg: AIConfig): Promise<void> {
  await withAI(cfg, () => complete('Reply with the single word: ok', { system: 'You are a connection test.', maxTokens: 16 }));
}
