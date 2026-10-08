import type { AIJobId, ProviderId } from '../types';

/** Every AI provider a company can plug in. Prices are list prices per million tokens (in / out), checked October 2026; null = see the provider. */
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  kind: 'direct' | 'gateway' | 'cloud' | 'private' | 'speech';
  models: { id: string; name: string; tier: 'best' | 'balanced' | 'fast'; price?: [number, number] }[];
  keyHint: string;
  note?: string;
  warn?: string; // shown before someone picks it
  needsUrl?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    kind: 'direct',
    keyHint: 'sk-ant-… from console.anthropic.com → API keys',
    note: 'Recommended for heavy jobs: brain dump, briefs, writing',
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', tier: 'best', price: [4, 20] },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', tier: 'balanced', price: [2, 10] },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'fast', price: [1, 5] },
    ],
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    kind: 'direct',
    keyHint: 'sk-… from platform.openai.com → API keys',
    note: 'All-rounder; also speech to text',
    models: [
      { id: 'gpt-5', name: 'GPT-5', tier: 'best' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', tier: 'fast' },
    ],
  },
  {
    id: 'google',
    name: 'Gemini (Google)',
    kind: 'direct',
    keyHint: 'from aistudio.google.com → API keys',
    note: 'Long meetings and documents; Flash is very cheap',
    models: [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', tier: 'best' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', tier: 'fast' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'direct',
    keyHint: 'sk-… from platform.deepseek.com',
    note: 'Lowest cost for light and medium jobs',
    warn: 'Data is processed in China. Check this is fine for your clients before choosing it.',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', tier: 'balanced', price: [1.74, 3.48] },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tier: 'fast', price: [0.14, 0.28] },
    ],
  },
  { id: 'qwen', name: 'Qwen (Alibaba Cloud)', kind: 'direct', keyHint: 'from Model Studio (international)', note: 'Low cost, strong in Asian languages', models: [{ id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', tier: 'balanced' }] },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'direct',
    keyHint: 'from console.mistral.ai',
    note: 'Data stays in the EU',
    models: [
      { id: 'mistral-large', name: 'Mistral Large', tier: 'balanced' },
      { id: 'mistral-small', name: 'Mistral Small', tier: 'fast' },
    ],
  },
  {
    id: 'sumopod',
    name: 'SumoPod',
    kind: 'gateway',
    keyHint: 'sk-… from sumopod.com → AI → API keys',
    note: 'One key for Claude, GPT, Gemini, DeepSeek and Qwen. Indonesian, pay in rupiah',
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', tier: 'best', price: [4, 20] },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', tier: 'balanced' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'fast', price: [1, 5] },
      { id: 'gpt-5', name: 'GPT-5', tier: 'best' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', tier: 'fast' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', tier: 'balanced', price: [1.74, 3.48] },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tier: 'fast', price: [0.14, 0.28] },
      { id: 'gemini/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', tier: 'best' },
      { id: 'gemini/gemini-3.5-flash', name: 'Gemini 3.5 Flash', tier: 'fast' },
      { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', tier: 'balanced' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'gateway',
    keyHint: 'sk-or-… from openrouter.ai/keys',
    note: 'Hundreds of models with one key, international card',
    models: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', tier: 'balanced', price: [2, 10] },
      { id: 'openai/gpt-5-mini', name: 'GPT-5 mini', tier: 'fast' },
      { id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash', tier: 'fast' },
    ],
  },
  {
    id: 'bedrock',
    name: 'AWS Bedrock',
    kind: 'cloud',
    keyHint: 'Access key + region of your AWS account',
    note: 'Claude in your own AWS account and region',
    needsUrl: true,
    models: [
      { id: 'anthropic.claude-sonnet-5-5', name: 'Claude Sonnet 5.5 on Bedrock', tier: 'balanced', price: [2, 10] },
      { id: 'anthropic.claude-haiku-4-5', name: 'Claude Haiku 4.5 on Bedrock', tier: 'fast' },
    ],
  },
  {
    id: 'vertex',
    name: 'Google Vertex AI',
    kind: 'cloud',
    keyHint: 'Service account JSON of your Google Cloud project',
    note: 'Gemini in your own Google Cloud project',
    needsUrl: true,
    models: [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro on Vertex', tier: 'best' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash on Vertex', tier: 'fast' },
    ],
  },
  { id: 'azure', name: 'Azure OpenAI', kind: 'cloud', keyHint: 'Key + endpoint of your Azure resource', note: 'Your own Azure subscription. Uses the model of your deployment', needsUrl: true, models: [{ id: 'gpt-5', name: 'GPT-5 on Azure', tier: 'best' }] },
  { id: 'custom', name: 'Any OpenAI-compatible server', kind: 'private', keyHint: 'Base URL (and key if it has one): Ollama, vLLM, LM Studio', note: 'AI on your own server, nothing leaves the company', needsUrl: true, models: [{ id: 'custom', name: 'Your model', tier: 'balanced' }] },
  { id: 'deepgram', name: 'Deepgram', kind: 'speech', keyHint: 'from console.deepgram.com', note: 'Voice notes and meeting audio', models: [{ id: 'nova-3', name: 'Nova 3', tier: 'best' }] },
  { id: 'groq', name: 'Groq', kind: 'speech', keyHint: 'gsk_… from console.groq.com', note: 'Fast speech to text', models: [{ id: 'whisper-large-v3', name: 'Whisper large v3', tier: 'balanced' }] },
];

export const providerOf = (id: ProviderId | 'included') => PROVIDERS.find((p) => p.id === id);

/** A field of a company cloud account (instead of one key). */
export interface CredField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
  optional?: boolean;
}
/**
 * Company cloud accounts need more than one key. The form shows these fields and sends them as JSON in the key, so
 * the server keeps them encrypted together. `url` names the field shown next to the key afterwards.
 */
export const CRED_FIELDS: Partial<Record<ProviderId, { fields: CredField[]; url: string; help: string }>> = {
  bedrock: {
    url: 'region',
    help: 'An IAM user or role with bedrock-mantle:CreateInference on the Claude models, and model access switched on in the Bedrock console.',
    fields: [
      { key: 'region', label: 'AWS region', placeholder: 'us-east-1' },
      { key: 'accessKeyId', label: 'Access key ID', placeholder: 'AKIA…' },
      { key: 'secretAccessKey', label: 'Secret access key', secret: true },
    ],
  },
  vertex: {
    url: 'region',
    help: 'A service account with the Vertex AI User role. In Google Cloud: IAM, Service accounts, Keys, Add key, JSON.',
    fields: [
      { key: 'region', label: 'Region', placeholder: 'global, or e.g. asia-southeast2', optional: true },
      { key: 'serviceAccount', label: 'Service account key (the JSON file)', placeholder: '{ "type": "service_account", … }', secret: true, multiline: true },
    ],
  },
  azure: {
    url: 'endpoint',
    help: 'From Azure AI Foundry: the resource endpoint, the name you gave the deployment, and one of the resource’s keys.',
    fields: [
      { key: 'endpoint', label: 'Endpoint', placeholder: 'https://your-resource.openai.azure.com' },
      { key: 'deployment', label: 'Deployment name', placeholder: 'gpt-5' },
      { key: 'apiVersion', label: 'API version', placeholder: 'v1', optional: true },
      { key: 'apiKey', label: 'API key', secret: true },
    ],
  },
};

export interface JobInfo {
  id: AIJobId;
  name: string;
  hint: string;
  weight: 'Heavy' | 'Medium' | 'Light' | 'Speech';
  accuracy: 'High' | 'Medium' | 'Low';
  tokens: [number, number]; // typical in / out per use
  rec: { best: string; balanced: string; cheap: string };
  when: 'click' | 'auto' | 'opt-in';
}

export const JOBS: JobInfo[] = [
  { id: 'braindump', name: 'Brain dump & briefs', hint: 'People, clients, dates', weight: 'Heavy', accuracy: 'High', tokens: [4000, 1500], rec: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', cheap: 'deepseek-v4-pro' }, when: 'click' },
  { id: 'ask', name: 'Ask AI', hint: 'Questions across all apps', weight: 'Heavy', accuracy: 'High', tokens: [8000, 1000], rec: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', cheap: 'deepseek-v4-pro' }, when: 'click' },
  { id: 'meeting', name: 'Meeting notes', hint: 'Per hour of transcript', weight: 'Heavy', accuracy: 'High', tokens: [15000, 2500], rec: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', cheap: 'gemini-3.5-flash' }, when: 'auto' },
  { id: 'draft', name: 'Write & rewrite email', hint: 'Drafts in your voice', weight: 'Medium', accuracy: 'Medium', tokens: [2000, 500], rec: { best: 'claude-sonnet-5-5', balanced: 'claude-haiku-4-5', cheap: 'deepseek-v4-flash' }, when: 'click' },
  { id: 'summary', name: 'Summaries & catch me up', hint: 'Threads and channels', weight: 'Medium', accuracy: 'Medium', tokens: [3000, 300], rec: { best: 'claude-sonnet-5-5', balanced: 'claude-haiku-4-5', cheap: 'deepseek-v4-flash' }, when: 'click' },
  { id: 'digest', name: 'Daily channel digest', hint: 'Opt-in per channel', weight: 'Medium', accuracy: 'Low', tokens: [5000, 400], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'deepseek-v4-flash' }, when: 'opt-in' },
  { id: 'replies', name: 'Suggest replies', hint: 'Three short options', weight: 'Light', accuracy: 'Low', tokens: [2000, 200], rec: { best: 'claude-haiku-4-5', balanced: 'gpt-5-mini', cheap: 'deepseek-v4-flash' }, when: 'click' },
  { id: 'todos', name: 'To-dos from email', hint: 'Client emails only, batched', weight: 'Light', accuracy: 'Medium', tokens: [1500, 150], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'deepseek-v4-flash' }, when: 'auto' },
  { id: 'sorting', name: 'Sorting & filing', hint: 'Client match, folders', weight: 'Light', accuracy: 'Medium', tokens: [800, 100], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'deepseek-v4-flash' }, when: 'auto' },
  { id: 'translate', name: 'Translate', hint: 'Messages and emails', weight: 'Light', accuracy: 'Medium', tokens: [1000, 800], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'qwen3.7-plus' }, when: 'click' },
  { id: 'speech', name: 'Voice notes & meeting audio', hint: 'Speech to text', weight: 'Speech', accuracy: 'High', tokens: [0, 0], rec: { best: 'nova-3', balanced: 'whisper-large-v3', cheap: 'browser' }, when: 'click' },
];

/** Rough cost of 100 uses in rupiah (null when the model's price isn't in our table). US$1 = Rp 17.500. */
export function costPer100(job: JobInfo, providerId: ProviderId | 'included', modelId: string): number | null {
  if (providerId === 'included') return 0;
  const m = providerOf(providerId)?.models.find((x) => x.id === modelId);
  if (!m?.price) return null;
  const usd = (job.tokens[0] * m.price[0] + job.tokens[1] * m.price[1]) / 1e6;
  return usd * 100 * 17_500;
}

/** Fill every job from the connected providers, following a preset. Falls back to "included" when nothing fits. */
export function presetJobs(preset: 'best' | 'balanced' | 'cheap', connected: ProviderId[], allowIncluded: boolean) {
  const out: Partial<Record<AIJobId, { provider: ProviderId | 'included'; model: string }>> = {};
  for (const job of JOBS) {
    if (job.id === 'speech') {
      const sp = connected.find((p) => p === 'deepgram' || p === 'groq');
      out.speech = sp ? { provider: sp, model: providerOf(sp)!.models[0].id } : allowIncluded ? { provider: 'included', model: 'included' } : { provider: 'custom', model: 'browser' };
      continue;
    }
    const want = job.rec[preset];
    const exact = connected.find((p) => providerOf(p)?.models.some((m) => m.id === want || m.id.endsWith(want)));
    if (exact) {
      out[job.id] = { provider: exact, model: providerOf(exact)!.models.find((m) => m.id === want || m.id.endsWith(want))!.id };
      continue;
    }
    // Nearest tier on any connected provider.
    const tier = preset === 'best' ? 'best' : preset === 'balanced' ? 'balanced' : 'fast';
    const near = connected.map((p) => ({ p, m: providerOf(p)?.models.find((m) => m.tier === tier) ?? providerOf(p)?.models[0] })).find((x) => x.m && providerOf(x.p)?.kind !== 'speech');
    out[job.id] = near ? { provider: near.p, model: near.m!.id } : allowIncluded ? { provider: 'included', model: 'included' } : { provider: connected[0] ?? 'anthropic', model: '' };
  }
  return out;
}
