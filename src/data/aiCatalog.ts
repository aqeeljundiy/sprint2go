import type { AIJobId, ProviderId } from '../types';
// The full path: the server imports this file, and Node can't import a folder (server/register.mjs only adds ".ts").
import { t } from '../i18n/index';

/**
 * Every AI provider a company can plug in. Prices are list prices per million tokens (in / out), checked October 2026;
 * null = see the provider. Words people read (hints, notes, warnings) are getters, in the reader's language (the server
 * reads them in English); names and ids are compared and stay as they are.
 */
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
    get keyHint() {
      return t('sk-ant-… from console.anthropic.com → API keys');
    },
    get note() {
      return t('Recommended for heavy jobs: brain dump, briefs, writing');
    },
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
    get keyHint() {
      return t('sk-… from platform.openai.com → API keys');
    },
    get note() {
      return t('All-rounder; also speech to text');
    },
    models: [
      { id: 'gpt-5', name: 'GPT-5', tier: 'best' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', tier: 'fast' },
    ],
  },
  {
    id: 'google',
    name: 'Gemini (Google)',
    kind: 'direct',
    get keyHint() {
      return t('from aistudio.google.com → API keys');
    },
    get note() {
      return t('Long meetings and documents; Flash is very cheap');
    },
    models: [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', tier: 'best' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', tier: 'fast' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'direct',
    get keyHint() {
      return t('sk-… from platform.deepseek.com');
    },
    get note() {
      return t('Lowest cost for light and medium jobs');
    },
    get warn() {
      return t('Data is processed in China. Check this is fine for your clients before choosing it.');
    },
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', tier: 'balanced', price: [1.74, 3.48] },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tier: 'fast', price: [0.14, 0.28] },
    ],
  },
  {
    id: 'qwen',
    name: 'Qwen (Alibaba Cloud)',
    kind: 'direct',
    get keyHint() {
      return t('from Model Studio (international)');
    },
    get note() {
      return t('Low cost, strong in Asian languages');
    },
    models: [{ id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', tier: 'balanced' }],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'direct',
    get keyHint() {
      return t('from console.mistral.ai');
    },
    get note() {
      return t('Data stays in the EU');
    },
    models: [
      { id: 'mistral-large', name: 'Mistral Large', tier: 'balanced' },
      { id: 'mistral-small', name: 'Mistral Small', tier: 'fast' },
    ],
  },
  {
    id: 'sumopod',
    name: 'SumoPod',
    kind: 'gateway',
    get keyHint() {
      return t('sk-… from sumopod.com → AI → API keys');
    },
    get note() {
      return t('One key for Claude, GPT, Gemini, DeepSeek and Qwen. Indonesian, pay in rupiah');
    },
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
    get keyHint() {
      return t('sk-or-… from openrouter.ai/keys');
    },
    get note() {
      return t('Hundreds of models with one key, international card');
    },
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
    get keyHint() {
      return t('Access key + region of your AWS account');
    },
    get note() {
      return t('Claude in your own AWS account and region');
    },
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
    get keyHint() {
      return t('Service account JSON of your Google Cloud project');
    },
    get note() {
      return t('Gemini in your own Google Cloud project');
    },
    needsUrl: true,
    models: [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro on Vertex', tier: 'best' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash on Vertex', tier: 'fast' },
    ],
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    kind: 'cloud',
    get keyHint() {
      return t('Key + endpoint of your Azure resource');
    },
    get note() {
      return t('Your own Azure subscription. Uses the model of your deployment');
    },
    needsUrl: true,
    models: [{ id: 'gpt-5', name: 'GPT-5 on Azure', tier: 'best' }],
  },
  {
    id: 'custom',
    get name() {
      return t('Any OpenAI-compatible server');
    },
    kind: 'private',
    get keyHint() {
      return t('Base URL (and key if it has one): Ollama, vLLM, LM Studio');
    },
    get note() {
      return t('AI on your own server, nothing leaves the company');
    },
    needsUrl: true,
    models: [
      {
        id: 'custom',
        get name() {
          return t('Your model');
        },
        tier: 'balanced',
      },
    ],
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    kind: 'speech',
    get keyHint() {
      return t('from console.deepgram.com');
    },
    get note() {
      return t('Voice notes and meeting audio');
    },
    models: [{ id: 'nova-3', name: 'Nova 3', tier: 'best' }],
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'speech',
    get keyHint() {
      return t('gsk_… from console.groq.com');
    },
    get note() {
      return t('Fast speech to text');
    },
    models: [{ id: 'whisper-large-v3', name: 'Whisper large v3', tier: 'balanced' }],
  },
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
 * the server keeps them encrypted together. `url` names the field shown next to the key afterwards. Labels, help and
 * worded placeholders are getters, in the reader's language; the keys are sent as they are.
 */
export const CRED_FIELDS: Partial<Record<ProviderId, { fields: CredField[]; url: string; help: string }>> = {
  bedrock: {
    url: 'region',
    get help() {
      return t('An IAM user or role with bedrock-mantle:CreateInference on the Claude models, and model access switched on in the Bedrock console.');
    },
    fields: [
      {
        key: 'region',
        get label() {
          return t('AWS region');
        },
        placeholder: 'us-east-1',
      },
      {
        key: 'accessKeyId',
        get label() {
          return t('Access key ID');
        },
        placeholder: 'AKIA…',
      },
      {
        key: 'secretAccessKey',
        get label() {
          return t('Secret access key');
        },
        secret: true,
      },
    ],
  },
  vertex: {
    url: 'region',
    get help() {
      return t('A service account with the Vertex AI User role. In Google Cloud: IAM, Service accounts, Keys, Add key, JSON.');
    },
    fields: [
      {
        key: 'region',
        get label() {
          return t('Region');
        },
        get placeholder() {
          return t('global, or e.g. asia-southeast2');
        },
        optional: true,
      },
      {
        key: 'serviceAccount',
        get label() {
          return t('Service account key (the JSON file)');
        },
        placeholder: '{ "type": "service_account", … }',
        secret: true,
        multiline: true,
      },
    ],
  },
  azure: {
    url: 'endpoint',
    get help() {
      return t('From Azure AI Foundry: the resource endpoint, the name you gave the deployment, and one of the resource’s keys.');
    },
    fields: [
      {
        key: 'endpoint',
        get label() {
          return t('Endpoint');
        },
        placeholder: 'https://your-resource.openai.azure.com',
      },
      {
        key: 'deployment',
        get label() {
          return t('Deployment name');
        },
        placeholder: 'gpt-5',
      },
      {
        key: 'apiVersion',
        get label() {
          return t('API version');
        },
        placeholder: 'v1',
        optional: true,
      },
      {
        key: 'apiKey',
        get label() {
          return t('API key');
        },
        secret: true,
      },
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

/** Every AI job. Names and hints are getters, in the reader's language (the server reads them in English). */
export const JOBS: JobInfo[] = [
  {
    id: 'braindump',
    get name() {
      return t('Brain dump & briefs');
    },
    get hint() {
      return t('People, clients, dates');
    },
    weight: 'Heavy', accuracy: 'High', tokens: [4000, 1500], rec: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', cheap: 'deepseek-v4-pro' }, when: 'click',
  },
  {
    id: 'ask',
    get name() {
      return t('Ask AI');
    },
    get hint() {
      return t('Questions across all apps');
    },
    weight: 'Heavy', accuracy: 'High', tokens: [8000, 1000], rec: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', cheap: 'deepseek-v4-pro' }, when: 'click',
  },
  {
    id: 'meeting',
    get name() {
      return t('Meeting notes');
    },
    get hint() {
      return t('Per hour of transcript');
    },
    weight: 'Heavy', accuracy: 'High', tokens: [15000, 2500], rec: { best: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', cheap: 'gemini-3.5-flash' }, when: 'auto',
  },
  {
    id: 'draft',
    get name() {
      return t('Write & rewrite email');
    },
    get hint() {
      return t('Drafts in your voice');
    },
    weight: 'Medium', accuracy: 'Medium', tokens: [2000, 500], rec: { best: 'claude-sonnet-5-5', balanced: 'claude-haiku-4-5', cheap: 'deepseek-v4-flash' }, when: 'click',
  },
  {
    id: 'summary',
    get name() {
      return t('Summaries & catch me up');
    },
    get hint() {
      return t('Threads and channels');
    },
    weight: 'Medium', accuracy: 'Medium', tokens: [3000, 300], rec: { best: 'claude-sonnet-5-5', balanced: 'claude-haiku-4-5', cheap: 'deepseek-v4-flash' }, when: 'click',
  },
  {
    id: 'digest',
    get name() {
      return t('Daily channel digest');
    },
    get hint() {
      return t('Opt-in per channel');
    },
    weight: 'Medium', accuracy: 'Low', tokens: [5000, 400], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'deepseek-v4-flash' }, when: 'opt-in',
  },
  {
    id: 'replies',
    get name() {
      return t('Suggest replies');
    },
    get hint() {
      return t('Three short options');
    },
    weight: 'Light', accuracy: 'Low', tokens: [2000, 200], rec: { best: 'claude-haiku-4-5', balanced: 'gpt-5-mini', cheap: 'deepseek-v4-flash' }, when: 'click',
  },
  {
    id: 'todos',
    get name() {
      return t('To-dos from email');
    },
    get hint() {
      return t('Client emails only, batched');
    },
    weight: 'Light', accuracy: 'Medium', tokens: [1500, 150], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'deepseek-v4-flash' }, when: 'auto',
  },
  {
    id: 'sorting',
    get name() {
      return t('Sorting & filing');
    },
    get hint() {
      return t('Client match, folders');
    },
    weight: 'Light', accuracy: 'Medium', tokens: [800, 100], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'deepseek-v4-flash' }, when: 'auto',
  },
  {
    id: 'translate',
    get name() {
      return t('Translate');
    },
    get hint() {
      return t('Messages and emails');
    },
    weight: 'Light', accuracy: 'Medium', tokens: [1000, 800], rec: { best: 'claude-haiku-4-5', balanced: 'gemini-3.5-flash', cheap: 'qwen3.7-plus' }, when: 'click',
  },
  {
    id: 'speech',
    get name() {
      return t('Voice notes & meeting audio');
    },
    get hint() {
      return t('Speech to text');
    },
    weight: 'Speech', accuracy: 'High', tokens: [0, 0], rec: { best: 'nova-3', balanced: 'whisper-large-v3', cheap: 'browser' }, when: 'click',
  },
];

/** Rough cost of 100 uses in rupiah (null when the model's price isn't known). US$1 = Rp 17.500. `price`: what the provider's list said. */
export function costPer100(job: JobInfo, providerId: ProviderId | 'included', modelId: string, price?: [number, number] | null): number | null {
  if (providerId === 'included') return 0;
  const p = providerOf(providerId)?.models.find((x) => x.id === modelId)?.price ?? price;
  if (!p) return null;
  const usd = (job.tokens[0] * p[0] + job.tokens[1] * p[1]) / 1e6;
  return usd * 100 * 17_500;
}

/**
 * Fill every job from the connected providers, following a preset. Falls back to "included" when nothing fits.
 * `models`: what each provider really offers (its own list) and the model each key uses by default, when known;
 * a catalogue model the provider doesn't offer is never picked.
 */
export function presetJobs(preset: 'best' | 'balanced' | 'cheap', connected: ProviderId[], allowIncluded: boolean, models?: { live?: Partial<Record<string, string[] | undefined>>; defaults?: Partial<Record<string, string | undefined>> }) {
  const out: Partial<Record<AIJobId, { provider: ProviderId | 'included'; model: string }>> = {};
  const offers = (p: ProviderId, id: string) => !models?.live?.[p] || models.live[p]!.includes(id);
  for (const job of JOBS) {
    if (job.id === 'speech') {
      const sp = connected.find((p) => p === 'deepgram' || p === 'groq');
      out.speech = sp ? { provider: sp, model: providerOf(sp)!.models[0].id } : allowIncluded ? { provider: 'included', model: 'included' } : { provider: 'custom', model: 'browser' };
      continue;
    }
    const want = job.rec[preset];
    const fits = (p: ProviderId) => providerOf(p)?.models.find((m) => (m.id === want || m.id.endsWith(want)) && offers(p, m.id));
    const exact = connected.find((p) => fits(p));
    if (exact) {
      out[job.id] = { provider: exact, model: fits(exact)!.id };
      continue;
    }
    // Nearest tier on any connected provider, else the model that key uses by default, else the first one it offers.
    const tier = preset === 'best' ? 'best' : preset === 'balanced' ? 'balanced' : 'fast';
    const near = connected
      .filter((p) => providerOf(p)?.kind !== 'speech')
      .map((p) => {
        const ms = (providerOf(p)?.models ?? []).filter((m) => offers(p, m.id));
        return { p, m: ms.find((m) => m.tier === tier)?.id ?? models?.defaults?.[p] ?? ms[0]?.id ?? models?.live?.[p]?.[0] };
      })
      .find((x) => x.m);
    out[job.id] = near ? { provider: near.p, model: near.m! } : allowIncluded ? { provider: 'included', model: 'included' } : { provider: connected[0] ?? 'anthropic', model: '' };
  }
  return out;
}
