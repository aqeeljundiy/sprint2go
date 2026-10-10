import { useEffect, useState } from 'react';
import { usePhone } from '../../mobile/media';
import { ChoiceRow, ChoiceSheet, GRow, Group, SwitchRow, TextRow } from '../ui/Grouped';
import { PushScreen } from '../ui/PushScreen';
import { term, brand as product } from '../../terms';
import { server } from '../../sync';
import { AISpend } from './AISpend';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Play, Plus, ShieldOff, Sparkles, Trash2, X } from 'lucide-react';
import type { AIJobId, AISettings, ProviderConn, ProviderId, User, Workspace } from '../../types';
import { CRED_FIELDS, JOBS, PROVIDERS, costPer100, presetJobs, providerOf } from '../../data/aiCatalog';
import { MODEL_ID, catalogList, defaultModelOf, modelLabel, type ModelList } from '../../data/aiModels';
import { ALLOWANCE, TOP_UP, planName, rp, seatsFor } from '../../data/pricing';
import { defaultAI } from '../../data/workspaces';
import { Select, type Option } from '../ui/Select';
import { SmoothHeight, TabPane, useLeaving } from '../ui/Smooth';
import { ModelPicker, keepModels, textModels, useModelLists } from './AIModels';
import { mark, t, tn, tx } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtList, fmtNumber } from '../../i18n/format';

interface Props {
  ws: Workspace;
  people: number;
  users: User[];
  me: string;
  canManage: boolean;
  onAI: (a: AISettings) => void;
  onBilling: () => void;
  toast: (text: string) => void;
}

/** Shown with t(). */
const KIND_NAME = { direct: mark('Direct'), gateway: mark('One key, many models'), cloud: mark('Company cloud account'), private: mark('Private'), speech: mark('Speech to text') };
/** The provider's name in sentences: "Claude (Anthropic)" is Anthropic. */
const shortName = (id: string) => {
  const n = providerOf(id as ProviderId)?.name ?? id;
  return n.match(/\(([^)]+)\)/)?.[1] ?? n;
};
/** Keys whose model is picked (speech services and Azure's deployment pick their own). */
const picksModel = (id: ProviderId) => providerOf(id)?.kind !== 'speech' && id !== 'azure';
/** "provider|model" back to its parts (model ids never hold a "|"). */
const split = (v: string) => {
  const i = v.indexOf('|');
  return [v.slice(0, i), v.slice(i + 1)] as [ProviderId | 'included', string];
};

type Adding = {
  id: ProviderId | null;
  key: string;
  url: string;
  fields?: Record<string, string>;
  state: 'idle' | 'testing' | 'error';
  message?: string;
  // After "Test and save": which model the new key uses, and for which jobs.
  step?: 'model';
  list?: ModelList;
  model?: string | null;
  typed?: boolean;
  scope?: 'all' | 'fit';
};

type RoutePick = { provider: string; providerName: string; model: string; modelName: string; warn: string | null };
/** What the server says about this company and our AI (GET /api/ai/plan). */
interface PlanView {
  eligible: boolean;
  why: 'plan' | 'trial' | 'comp' | null;
  until: string | null;
  route: { job: string; name: string; run: RoutePick | null; backup: RoutePick | null }[];
  allowance: { unlimited: boolean; share: number; left: Record<string, number | null>; pool: Record<string, number>; uses: Record<string, number>; seats: number; topUps: number; resets: string } | null;
  spendUsd?: Record<string, number>; // this month, on each of the company's own keys (list prices)
  capped?: string[]; // keys resting at their monthly cap until the 1st
}
/** A job's name (the server sends it in English) inside a sentence, in the reader's language: "brain dump & briefs", but "Ask AI". */
const jobWord = (name: string) => {
  const n = t(name);
  return /^(Ask AI|Tanya AI)/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1);
};
/** US$ with cents, the local way: US$12.50 / US$12,50. */
const dollars = (n: number) => `US$${fmtNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Seconds with one decimal: 1.4 / 1,4. */
const secs = (ms: number) => fmtNumber(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** The toast after a preset: one whole sentence each. */
const presetToast = (preset: 'best' | 'balanced' | 'cheap') =>
  preset === 'best' ? t('Every job now uses the best setup') : preset === 'balanced' ? t('Every job now uses the balanced setup') : t('Every job now uses the lowest cost setup');
/** "Only where it fits": what the jobs keep. */
const keepHint = (preset: string, provider: string) =>
  preset === 'custom'
    ? t('Jobs keep the models you picked; where that uses {provider}, they use this model.', { provider })
    : preset === 'best'
      ? t('Jobs keep the best setup; where that uses {provider}, they use this model.', { provider })
      : preset === 'cheap'
        ? t('Jobs keep the lowest cost setup; where that uses {provider}, they use this model.', { provider })
        : t('Jobs keep the balanced setup; where that uses {provider}, they use this model.', { provider });

/** "Who handles your data": each company that processes a job on our AI, in plain words, as the operators set it. */
function DataRoute({ view, both }: { view: PlanView; both: boolean }) {
  const groups = new Map<string, { pick: RoutePick; jobs: string[] }>();
  for (const r of view.route) {
    if (!r.run) continue;
    const k = `${r.run.provider}|${r.run.model}`;
    const g = groups.get(k) ?? { pick: r.run, jobs: [] };
    g.jobs.push(jobWord(r.name));
    groups.set(k, g);
  }
  const backups = Array.from(new Map(view.route.flatMap((r) => (r.backup ? [[`${r.backup.provider}|${r.backup.model}`, r.backup] as const] : []))).values()).filter((b) => !groups.has(`${b.provider}|${b.model}`));
  const down = view.route.filter((r) => !r.run).map((r) => jobWord(r.name));
  const warns = Array.from(new Map([...Array.from(groups.values()).map((g) => g.pick), ...backups].filter((x) => x.warn).map((x) => [x.provider, x])).values());
  return (
    <>
      <p className="muted small">
        {both
          ? t('On {product}’s AI, these companies process what each job sends them. We choose the models; jobs you set to your own keys use those first. This list always shows what runs today.', { product: product.name })
          : t('On {product}’s AI, these companies process what each job sends them. We choose the models. This list always shows what runs today.', { product: product.name })}
      </p>
      {Array.from(groups.values()).map((g) => (
        <div key={`${g.pick.provider}|${g.pick.model}`} className="set-row">
          <span>
            <strong>
              {g.pick.providerName} ({g.pick.modelName})
            </strong>
            <small>{t('For {jobs}', { jobs: fmtList(g.jobs) })}</small>
          </span>
        </div>
      ))}
      {backups.length > 0 && <p className="muted small">{t('If one of them is down, {backups} takes over for that job.', { backups: fmtList(backups.map((b) => `${b.providerName} (${b.modelName})`)) })}</p>}
      {down.length > 0 && (
        <p className="muted small">
          {tn(down.length, 'Not available on {product}’s AI right now: {jobs}. To use it now, add your own key below.', 'Not available on {product}’s AI right now: {jobs}. To use them now, add your own key below.', { product: product.name, jobs: fmtList(down) })}
        </p>
      )}
      {warns.map((w) => (
        <p key={w.provider} className="warn-note">
          <AlertTriangle size={14} /> {w.providerName}: {t(w.warn ?? '')}
        </p>
      ))}
    </>
  );
}

/** Workspace settings → AI: who pays, providers and keys, presets, per-job routing with the guide, limits, usage. */
export function AISection({ ws, people, users, me, canManage, onAI, onBilling, toast }: Props) {
  const ai = ws.ai ?? defaultAI(ws.plan?.track === 'own');
  const plan = ws.plan;
  // Whether our AI serves this company comes from the server (the AI plan, a trial, or free months on it);
  // until it answers, the plan says it.
  const [view, setView] = useState<PlanView | null>(null);
  useEffect(() => {
    if (!server.on) return;
    let on = true;
    void fetch(`/api/ai/plan?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PlanView | null) => on && setView(d), () => {});
    return () => {
      on = false;
    };
  }, [ws.id, plan?.track, plan?.tier, plan?.trialEnds, plan?.topUps, ai.payer]);
  const included = view ? view.eligible : plan?.track === 'ai' && plan.tier !== 'free';
  const set = (p: Partial<AISettings>) => onAI({ ...ai, ...p });
  const [adding, setAdding] = useState<Adding | null>(null);
  const [testing, setTesting] = useState<AIJobId | null>(null);
  const [tested, setTested] = useState<Partial<Record<AIJobId, { ok: boolean; text: string }>>>({});
  const connected = ai.providers.filter((p) => p.status === 'ok').map((p) => p.id);
  const allowIncluded = included && ai.payer !== 'own';
  // What each connected key can use: the provider's own list (the catalogue until it arrives, and in the demo).
  const { lists } = useModelLists(ws.id, connected);
  /** For the presets: what the providers really offer, and each key's own model. */
  const known = (extra?: { id: ProviderId; list: ModelList; model?: string }) => ({
    live: Object.fromEntries([...connected.map((p) => [p, lists[p]] as const), ...(extra ? [[extra.id, extra.list] as const] : [])].map(([p, l]) => [p, l?.source === 'live' ? l.models.map((m) => m.id) : undefined])),
    defaults: Object.fromEntries([...ai.providers.map((p) => [p.id, p.model] as const), ...(extra ? [[extra.id, extra.model] as const] : [])]),
  });
  const notes = useLeaving(ai.notes ?? [], (n) => n.id);

  const pickPreset = (preset: 'best' | 'balanced' | 'cheap') => {
    set({ preset, jobs: presetJobs(preset, connected, allowIncluded, known()) });
    toast(presetToast(preset));
  };

  /** One tiny call with a model on a saved key: an id typed in, before it's used. */
  const checkModel = (provider: ProviderId) => async (id: string): Promise<string | null> => {
    // DEMO ONLY: no provider to ask, so an id that looks right is taken
    if (!server.on) return new Promise((r) => setTimeout(() => r(MODEL_ID.test(id) ? null : t('That doesn’t look like a model id: letters, numbers and . _ : / - only.')), 700));
    const r = await fetch('/api/ai/models/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider, model: id }) }).catch(() => null);
    if (!r) return t('Could not reach the server.');
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? null : d.error ? t(d.error) : t('That model didn’t answer.');
  };

  /** A key's default model changes: the jobs that used the old one move with it. */
  const changeModel = (c: ProviderConn, id: string, typed: boolean) => {
    const before = defaultModelOf(c.id, c.model, ai.jobs, lists[c.id]);
    if (id === before && !!c.typed === typed) return;
    const jobs = { ...ai.jobs };
    let moved = 0;
    for (const j of JOBS) {
      const p = jobs[j.id];
      if (j.id === 'speech' || p?.provider !== c.id || p.model !== before) continue;
      jobs[j.id] = { provider: c.id, model: id, ...(p.fallback ? { fallback: p.fallback } : {}), ...(typed ? { typed: true } : {}) };
      moved++;
    }
    set({ providers: ai.providers.map((x) => (x.id === c.id ? { ...x, model: id, typed: typed || undefined } : x)), jobs, ...(moved ? { preset: 'custom' as const } : {}) });
    const vars = { provider: shortName(c.id), model: modelLabel(id, lists[c.id]) };
    toast(moved ? tn(moved, '{provider} now uses {model}. {n} job moved to it', '{provider} now uses {model}. {n} jobs moved to it', vars) : t('{provider} now uses {model}', vars));
  };

  /** After "Test and save": the key's model, for every text job or only where the setup already picked this provider. */
  const applyModel = () => {
    const a = adding;
    if (!a?.id || !a.model) return;
    const id = a.id;
    const model = a.model;
    const jobs = { ...ai.jobs };
    let n = 0;
    for (const j of JOBS) {
      if (j.id === 'speech' || (a.scope !== 'all' && jobs[j.id]?.provider !== id)) continue;
      const fallback = jobs[j.id]?.fallback;
      jobs[j.id] = { provider: id, model, ...(fallback && fallback !== id ? { fallback } : {}), ...(a.typed ? { typed: true } : {}) };
      n++;
    }
    onAI({ ...ai, providers: ai.providers.map((p) => (p.id === id ? { ...p, model, typed: a.typed || undefined } : p)), jobs, ...(n ? { preset: 'custom' as const } : {}) });
    setAdding(null);
    const name = modelLabel(model, a.list);
    toast(
      a.scope === 'all'
        ? t('Every text job now uses {model}', { model: name })
        : n
          ? tn(n, '{provider} now uses {model} for {n} job', '{provider} now uses {model} for {n} jobs', { provider: shortName(id), model: name })
          : t('{provider} uses {model}. No job picked it yet: choose it for a job below', { provider: shortName(id), model: name }),
    );
  };

  const addProvider = () => {
    if (!adding?.id) return;
    const info = providerOf(adding.id)!;
    // Company cloud accounts (Bedrock, Vertex, Azure) send their details together, as JSON, in the key.
    const cred = CRED_FIELDS[adding.id];
    const fields = adding.fields ?? {};
    const key = cred ? JSON.stringify(Object.fromEntries(cred.fields.map((f) => [f.key, (fields[f.key] ?? '').trim()]))) : adding.key.trim();
    const url = cred ? (fields[cred.url] ?? '').trim() : adding.url.trim();
    if (cred ? !cred.fields.every((f) => f.optional || fields[f.key]?.trim()) : key.length < 16 || (info.needsUrl && !/^https?:\/\//.test(url) && adding.id === 'custom')) {
      setAdding({ ...adding, state: 'error' });
      return;
    }
    setAdding({ ...adding, state: 'testing' });
    const id = adding.id;
    const save = (keyLast4: string, sent?: ModelList) => {
      const list = sent && Array.isArray(sent.models) ? sent : catalogList(id);
      if (sent) keepModels(ws.id, id, list);
      // The model to suggest: the setup's tier on the provider's list, else its first recommended model.
      const text = textModels(list);
      const tier = ai.preset === 'best' ? 'best' : ai.preset === 'cheap' ? 'fast' : 'balanced';
      // A replaced key keeps the model it used, when the provider still offers it.
      const before = ai.providers.find((p) => p.id === id);
      const was = before ? defaultModelOf(id, before.model, ai.jobs) : null;
      const kept = was && (before?.typed || list.models.some((m) => m.id === was)) ? was : null;
      const suggest = kept ?? (text.find((m) => m.recommended && m.tier === tier) ?? text.find((m) => m.recommended) ?? text[0])?.id ?? null;
      const conn: ProviderConn = { id, keyLast4, addedAt: new Date().toISOString(), addedBy: me, status: 'ok', baseUrl: url || undefined, spentUsd: 0, ...(before?.capUsd ? { capUsd: before.capUsd } : {}), ...(suggest ? { model: suggest } : {}), ...(kept && before?.typed ? { typed: true } : {}) };
      // A replaced key stays where it was in the list.
      const providers = before ? ai.providers.map((p) => (p.id === id ? conn : p)) : [...ai.providers, conn];
      const jobs = ai.preset === 'custom' ? ai.jobs : presetJobs(ai.preset === 'best' ? 'best' : ai.preset === 'cheap' ? 'cheap' : 'balanced', providers.map((p) => p.id), allowIncluded, known({ id, list, model: suggest ?? undefined }));
      onAI({ ...ai, providers, jobs, payer: ai.payer === 'sprint2go' ? 'both' : ai.payer });
      // A company's own server has nothing in our catalogue: its model is typed in when its list can't be read.
      if (!picksModel(id) || (!text.length && id !== 'custom')) {
        setAdding(null);
        toast(t('{provider} connected. The key is encrypted and only the last 4 characters are kept', { provider: info.name }));
        return;
      }
      // Next: which model it uses.
      setAdding({ id, key: '', url: '', state: 'idle', step: 'model', list, model: suggest, typed: !!conn.typed, scope: 'fit' });
    };
    // With the local server the key is tested with a tiny real request, then stored encrypted there.
    if (!server.on) return void setTimeout(() => save((cred ? fields.accessKeyId || fields.apiKey || '····' : key).slice(-4)), 900);
    void fetch('/api/ai/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: id, key, baseUrl: url || undefined }) })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { keyLast4?: string; error?: string; models?: ModelList };
        if (r.ok && d.keyLast4) save(d.keyLast4, d.models);
        else setAdding((a) => a && { ...a, state: 'error', message: d.error });
      })
      .catch(() => setAdding((a) => a && { ...a, state: 'error', message: 'Could not reach the server.' }));
  };

  /**
   * What a job can pick: our AI (when the plan has it), then each connected key's models as the provider lists them
   * (recommended first), grouped by provider, with the cost of 100 uses of this job where the price is known.
   */
  const jobOptions = (job: (typeof JOBS)[number]): Option[] => {
    const speech = job.id === 'speech';
    const out: Option[] = allowIncluded && !speech ? [{ value: 'included|included', label: t('{product} (included in your plan)', { product: product.name }), group: t('Included'), icon: <Sparkles size={14} /> }] : [];
    for (const c of ai.providers) {
      if (c.status !== 'ok' || ai.blocked.includes(c.id)) continue;
      const info = providerOf(c.id)!;
      const list = lists[c.id] ?? catalogList(c.id);
      const ms = list.models.filter((m) => (speech ? m.kind === 'speech' || (info.kind === 'speech' && list.source === 'catalog') : m.kind === 'text' && !(info.kind === 'speech' && list.source === 'catalog')));
      for (const m of ms) {
        const cost = speech ? null : costPer100(job, c.id, m.id, m.price);
        out.push({ value: `${c.id}|${m.id}`, label: m.name, hint: speech ? info.name : cost !== null ? t('≈ {cost} / 100 uses', { cost: rp(cost) }) : t('Price unknown'), group: info.name, keywords: `${m.id} ${m.family}` });
      }
      // A model id typed in for this key, and whatever the job uses now, stay pickable.
      if (!speech && c.typed && c.model && !ms.some((m) => m.id === c.model)) out.push({ value: `${c.id}|${c.model}`, label: c.model, hint: t('Your model id'), group: info.name });
    }
    const cur = ai.jobs[job.id];
    if (cur && cur.provider !== 'included' && cur.model && cur.model !== 'browser' && !out.some((o) => o.value === `${cur.provider}|${cur.model}`) && ai.providers.some((p) => p.id === cur.provider)) {
      out.push({ value: `${cur.provider}|${cur.model}`, label: modelLabel(cur.model, lists[cur.provider]), hint: cur.typed ? t('Your model id') : t('Not on the provider’s list'), group: providerOf(cur.provider)?.name ?? cur.provider });
    }
    if (speech) out.push({ value: 'custom|browser', label: t('Browser speech (free)'), hint: t('Chrome and Safari only'), group: tx('price', 'Free') });
    return out;
  };

  const usage = [
    [t('Brain dumps'), 41, 'braindump'],
    [t('Ask AI questions'), 118, 'ask'],
    [t('Meeting notes (hours)'), 22, 'meeting'],
    [t('Email summaries'), 236, 'summary'],
    [t('Drafts and rewrites'), 97, 'draft'],
  ] as const;
  const seats = plan ? seatsFor(plan.tier, people) : people;
  const pool = { braindump: ALLOWANCE.braindump * seats, ask: ALLOWANCE.ask * seats, meeting: ALLOWANCE.meetingHours * seats, summary: ALLOWANCE.summary * seats, draft: ALLOWANCE.draft * seats } as Record<string, number>;
  // With the server: this month's real uses and what's left of the shared allowance. Without one: the demo's sample.
  const allowance = view?.allowance;
  // On a server the numbers are the server's; the sample numbers are for the demo only (none while they load).
  const showUsage = !!allowance || !server.on;
  const usedShare = allowance ? allowance.share : server.on ? 0 : Math.min(0.95, usage.reduce((s, [, n, k]) => s + n / (pool[k] || 1), 0) / usage.length);
  const leftOf = (k: string) => (allowance ? allowance.left[k] : Math.round(pool[k] * (1 - usedShare)));
  const usedUp = !!allowance && !allowance.unlimited && allowance.share >= 1;

  // Adding a key: the form, then (for providers with a list) its model. In place on desktop, its own screen on phones.
  const addFlow =
    adding?.step === 'model' && adding.id && adding.list ? (
                <div className="add-prov add-model">
                  <p className="add-model-done">
                    <CheckCircle2 size={14} className="ok" /> {t('{provider} is connected. The key is encrypted; only its last 4 characters are kept.', { provider: providerOf(adding.id)!.name })}
                  </p>
                  <p className="add-model-q" id="add-model-q">
                    {t('Which model should {provider} use?', { provider: shortName(adding.id) })}
                  </p>
                  <ModelPicker list={adding.list} value={adding.model ?? null} typed={adding.typed} onPick={(model, typed) => setAdding((a) => a && { ...a, model, typed })} check={checkModel(adding.id)} label={t('Which model should {provider} use?', { provider: shortName(adding.id) })} width={380} />
                  <p className="muted small">
                    {!textModels(adding.list).length
                      ? t('Open the list and choose Other model id: type the id exactly as your server names it. We try it with one tiny call.')
                      : adding.list.source === 'live'
                      ? t('From {provider}’s own list for this key. Recommended ones first; search by name or id.', { provider: shortName(adding.id) })
                      : adding.list.note
                        ? t(adding.list.note)
                        : server.on
                          ? t('{provider} doesn’t share a list, so these are the models we know.', { provider: shortName(adding.id) })
                          : t('Demo: these are the models we know. With the server, the provider’s own list shows here.')}
                  </p>
                  <div className="model-scope" role="radiogroup" aria-label={t('Which jobs use this model')}>
                    {(
                      [
                        ['all', t('Use it for every job'), t('Every text job runs on this model. Voice notes keep their speech service.')],
                        ['fit', t('Only where it fits'), keepHint(ai.preset, shortName(adding.id))],
                      ] as const
                    ).map(([v, l, h]) => (
                      <button key={v} type="button" role="radio" aria-checked={adding.scope === v} className={adding.scope === v ? 'on' : ''} onClick={() => setAdding((a) => a && { ...a, scope: v })}>
                        <span className="model-scope-dot" aria-hidden />
                        <span>
                          <strong>{l}</strong>
                          <small>{h}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="add-prov-foot">
                    <button
                      type="button"
                      className="ghost-btn sm"
                      onClick={() => {
                        const id = adding.id!;
                        setAdding(null);
                        toast(t('{provider} connected. Pick its model any time on its row', { provider: providerOf(id)!.name }));
                      }}
                    >
                      {t('Later')}
                    </button>
                    <button type="button" className="primary-btn sm" disabled={!adding.model} onClick={applyModel}>
                      <CheckCircle2 size={14} /> {t('Use this model')}
                    </button>
                  </div>
                </div>
              ) : adding ? (
                <div className="add-prov">
                  <Select<ProviderId>
                    value={adding.id}
                    onChange={(id) => setAdding({ ...adding, id, state: 'idle' })}
                    placeholder={t('Choose a provider')}
                    label={t('Provider')}
                    width={340}
                    searchable
                    options={PROVIDERS.map((p) => ({ value: p.id, label: p.name, hint: p.note, group: t(KIND_NAME[p.kind]), icon: <span className="prov-mark sm">{p.name.charAt(0)}</span> }))}
                  />
                  {adding.id && providerOf(adding.id)?.warn && (
                    <p className="warn-note">
                      <AlertTriangle size={14} /> {providerOf(adding.id)!.warn}
                    </p>
                  )}
                  {adding.id && CRED_FIELDS[adding.id] && (
                    <>
                      {CRED_FIELDS[adding.id]!.fields.map((f) =>
                        f.multiline ? (
                          <textarea
                            key={f.key}
                            rows={4}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label={f.label}
                            value={adding.fields?.[f.key] ?? ''}
                            onChange={(e) => setAdding({ ...adding, fields: { ...adding.fields, [f.key]: e.target.value }, state: 'idle' })}
                            placeholder={`${f.label}: ${f.placeholder ?? ''}`}
                          />
                        ) : (
                          <input
                            key={f.key}
                            type={f.secret ? 'password' : 'text'}
                            autoComplete="off"
                            spellCheck={false}
                            aria-label={f.label}
                            value={adding.fields?.[f.key] ?? ''}
                            onChange={(e) => setAdding({ ...adding, fields: { ...adding.fields, [f.key]: e.target.value }, state: 'idle' })}
                            placeholder={`${f.optional ? t('{label} (optional)', { label: f.label }) : f.label}${f.placeholder ? `: ${f.placeholder}` : ''}`}
                          />
                        ),
                      )}
                      <p className="muted small">{CRED_FIELDS[adding.id]!.help}</p>
                      {adding.state === 'error' && <p className="err">{adding.message ? t(adding.message) : t('Fill in every field.')}</p>}
                    </>
                  )}
                  {adding.id && !CRED_FIELDS[adding.id] && (
                    <>
                      {providerOf(adding.id)!.needsUrl && <input value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} placeholder={adding.id === 'custom' ? 'https://ai.your-server.com/v1' : t('Endpoint')} aria-label={t('Address')} />}
                      <input type="password" autoComplete="off" value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value, state: 'idle' })} placeholder={providerOf(adding.id)!.keyHint} aria-label={t('Key')} />
                      {adding.state === 'error' && <p className="err">{adding.message ? t(adding.message) : providerOf(adding.id)!.needsUrl ? t('That doesn’t look like a valid key and address.') : t('That doesn’t look like a valid key.')}</p>}
                    </>
                  )}
                  {adding.id && (
                    <p className="muted small">
                      {server.on ? t('We test the key with one tiny request, then store it encrypted. Only the last 4 characters are shown again.') : t('Demo: the key is only checked for its shape. With the local server it’s tested with the provider and stored encrypted.')}
                      {picksModel(adding.id) ? ` ${t('Then you pick its model.')}` : ''}
                    </p>
                  )}
                  <div className="add-prov-foot">
                    <button type="button" className="ghost-btn sm" onClick={() => setAdding(null)}>
                      {t('Cancel')}
                    </button>
                    <button type="button" className="primary-btn sm" disabled={!adding.id || (!CRED_FIELDS[adding.id] && !adding.key) || adding.state === 'testing'} onClick={addProvider}>
                      {adding.state === 'testing' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {adding.state === 'testing' ? t('Testing…') : t('Test and save')}
                    </button>
                  </div>
                </div>
    ) : null;
  /** Removes a key; jobs that used it move to the best match among the keys that are left. */
  const removeKey = (c: (typeof ai.providers)[number]) => {
    const info = providerOf(c.id)!;
    if (server.on) void fetch('/api/ai/keys', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: c.id }) });
    const providers = ai.providers.filter((x) => x.id !== c.id);
    const moved = JOBS.filter((j) => ai.jobs[j.id]?.provider === c.id);
    const refill = presetJobs(ai.preset === 'custom' ? 'balanced' : ai.preset, providers.filter((x) => x.status === 'ok').map((x) => x.id), allowIncluded, known());
    const jobs = { ...ai.jobs };
    for (const j of moved) {
      if (refill[j.id]) jobs[j.id] = refill[j.id];
      else delete jobs[j.id];
    }
    set({ providers, jobs });
    toast(moved.length ? tn(moved.length, '{provider} key removed. {n} job moved to another model', '{provider} key removed. {n} jobs moved to another model', { provider: info.name }) : t('{provider} key removed', { provider: info.name }));
  };
  const phone = usePhone();
  const [openKey, setOpenKey] = useState<ProviderId | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [allJobs, setAllJobs] = useState(false);
  return (
    <>
      <h2>AI</h2>
      <p className="set-intro">{t('Pick who pays for AI and which model does each job. AI only runs when someone clicks, or once in the background for the jobs you allow.')}</p>
      {!canManage && <p className="modal-note">{t('Only owners and admins can change AI settings.')}</p>}
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>{t('Who pays for AI')}</h3>
          <div className="payer-pick">
            {(
              [
                ['sprint2go', `${product.name}`, included ? t('Included in {plan}: shared allowance for the whole company', { plan: planName(plan!) }) : t('Needs an “AI included” plan')],
                ['own', t('Our own keys'), t('Your providers bill you directly. Cheapest plans')],
                ['both', t('Both'), t('Your keys first; the plan’s allowance as backup')],
              ] as const
            ).map(([v, l, h]) => (
              <button key={v} type="button" className={ai.payer === v ? 'on' : ''} disabled={(v === 'sprint2go' || v === 'both') && !included} onClick={() => set({ payer: v, jobs: v === 'own' ? presetJobs(ai.preset === 'custom' ? 'balanced' : ai.preset, connected, false) : ai.jobs })}>
                <strong>{l}</strong>
                <small>{h}</small>
              </button>
            ))}
          </div>
          {!included && (
            <p className="muted small">
              {tj('You’re on {plan} with your own keys. {link} if you’d rather not manage keys.', {
                plan: plan ? planName(plan) : 'Free',
                link: (
                  <button type="button" className="link-btn" onClick={onBilling}>
                    {t('Switch to AI included')}
                  </button>
                ),
              })}
            </p>
          )}
        </div>

        {plan?.tier === 'free' && !included && (
          <div className="set-block">
            <h3>{t('AI on Free')}</h3>
            <p className="muted small">
              {tj('Free doesn’t include AI from {product}. Add your own key above and it works right away, with no limit from us, or {link}.', {
                product: product.name,
                link: (
                  <button type="button" className="link-btn" onClick={onBilling}>
                    {t('pick a plan with AI included')}
                  </button>
                ),
              })}
            </p>
          </div>
        )}
        {included && ai.payer !== 'own' && view && (
          <div className="set-block">
            <h3>{t('Who handles your data')}</h3>
            <DataRoute view={view} both={ai.payer === 'both'} />
          </div>
        )}
        {included && ai.payer !== 'own' && (
          <div className="set-block">
            <h3>{t('Left this month')}</h3>
            {allowance?.unlimited || !showUsage ? null : (
              <div className="allow-meter">
                <span className="bar wide">
                  <span style={{ width: `${Math.min(1, usedShare) * 100}%` }} className={usedShare > 0.8 ? 'warn' : ''} />
                </span>
                {usedUp ? (
                  <p>
                    <b>{t('Used up for this month.')}</b>{' '}
                    {view?.why === 'trial'
                      ? tj('The trial’s AI starts again on the 1st. {link} or add your own key above to carry on now.', {
                          link: (
                            <button type="button" className="link-btn" onClick={onBilling}>
                              {t('Pick a plan')}
                            </button>
                          ),
                        })
                      : view?.why === 'comp'
                        ? t('It starts again on the 1st. Add your own key above to carry on now.')
                        : plan?.autoTopUp?.on
                          ? tj('Automatic top-ups reached their monthly limit. {link}.', {
                              link: (
                                <button type="button" className="link-btn" onClick={onBilling}>
                                  {t('Raise the limit or add a top-up')}
                                </button>
                              ),
                            })
                          : tj('{link} ({price}) to carry on, or turn on automatic top-ups.', {
                              link: (
                                <button type="button" className="link-btn" onClick={onBilling}>
                                  {t('Add a top-up')}
                                </button>
                              ),
                              price: rp(TOP_UP.price),
                            })}
                  </p>
                ) : (
                  <p>
                    {(() => {
                      const parts = {
                        hours: <b>{tn(leftOf('meeting') ?? 0, '{n} meeting hour', '{n} meeting hours')}</b>,
                        questions: <b>{tn(leftOf('ask') ?? 0, '{n} question', '{n} questions')}</b>,
                        dumps: <b>{tn(leftOf('braindump') ?? 0, '{n} brain dump', '{n} brain dumps')}</b>,
                      };
                      return allowance?.topUps
                        ? tj('About {hours}, or {questions}, or {dumps} left, shared by the whole company, with {topUps} this month.', { ...parts, topUps: tn(allowance.topUps, '{n} top-up', '{n} top-ups') })
                        : tj('About {hours}, or {questions}, or {dumps} left, shared by the whole company.', parts);
                    })()}
                  </p>
                )}
              </div>
            )}
            {showUsage ? (
              <div className="usage-grid">
                {usage.map(([l, n, k]) => (
                  <div key={k}>
                    <b>{allowance ? allowance.uses[k] ?? 0 : n}</b>
                    <span>
                      {allowance ? (k === 'meeting' ? t('Meetings with notes') : l) : l} {allowance ? <em>{t('this month')}</em> : <em>{t('of {total}', { total: fmtNumber(pool[k]) })}</em>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="lazy-wait" aria-hidden />
            )}
          </div>
        )}

        <div className="set-block">
          <h3>{ai.payer === 'sprint2go' ? t('Providers') : t('Your AI keys')}</h3>
          {notes.length > 0 && (
            <div className="ai-notes">
              {notes.map(({ item: n, leaving }) => (
                <p key={n.id} className={`warn-note ai-note ${leaving ? 'row-leaving' : ''}`}>
                  <AlertTriangle size={14} />
                  <span>{n.text}</span>
                  <button type="button" className="icon-btn sm" title={t('Got it')} aria-label={t('Dismiss')} onClick={() => set({ notes: (ai.notes ?? []).filter((x) => x.id !== n.id) })}>
                    <X size={14} />
                  </button>
                </p>
              ))}
            </div>
          )}
          {ai.providers.length === 0 && (
            <p className="muted small">
              {included && ai.payer !== 'own' ? t('No keys yet. {product}’s AI is used for everything.', { product: product.name }) : t('No keys yet. Add a key to switch the AI on, then pick which model does each job below.')}
            </p>
          )}
          {phone && (
            <>
              {ai.providers.map((c) => {
                const info = providerOf(c.id)!;
                const spent = server.on ? view?.spendUsd?.[c.id] ?? 0 : c.spentUsd;
                return (
                  <GRow
                    key={c.id}
                    pic={<span className="prov-mark">{info.name.charAt(0)}</span>}
                    label={info.name}
                    sub={`•••• ${c.keyLast4} · ${c.capUsd ? t('about {spent} this month of {cap} cap', { spent: dollars(spent), cap: `US$${fmtNumber(c.capUsd)}` }) : t('about {spent} this month', { spent: dollars(spent) })}`}
                    value={c.status === 'ok' ? (ai.blocked.includes(c.id) ? t('Blocked') : undefined) : t('Not working')}
                    onClick={() => setOpenKey(c.id)}
                  />
                );
              })}
              <GRow icon={Plus} plainIcon action label={t('Add a provider')} onClick={canManage ? () => setAdding({ id: null, key: '', url: '', state: 'idle' }) : undefined} />
            </>
          )}
          <div className="prov-list">
            {!phone && ai.providers.map((c) => {
              const info = providerOf(c.id)!;
              // This month's spend: the server's count of every call on this key (the demo keeps a sample).
              const spent = server.on ? view?.spendUsd?.[c.id] ?? 0 : c.spentUsd;
              const resting = !!view?.capped?.includes(c.id);
              const pct = c.capUsd ? Math.min(100, (spent / c.capUsd) * 100) : 0;
              const uses = JOBS.filter((j) => ai.jobs[j.id]?.provider === c.id).length;
              const list = lists[c.id] ?? catalogList(c.id);
              const current = defaultModelOf(c.id, c.model, ai.jobs, list);
              return (
                <div key={c.id} className={`prov ${ai.blocked.includes(c.id) ? 'blocked' : ''}`}>
                  <span className="prov-mark">{info.name.charAt(0)}</span>
                  <span className="prov-main">
                    <strong>
                      {info.name} {c.status === 'ok' ? <CheckCircle2 size={13} className="ok" /> : <AlertTriangle size={13} className="bad" />}
                    </strong>
                    <small>
                      <KeyRound size={11} /> •••• {c.keyLast4} · {t('added by {name}', { name: users.find((u) => u.id === c.addedBy)?.name.split(' ')[0] ?? t('someone') })}
                    </small>
                    {picksModel(c.id) && c.status === 'ok' ? (
                      <span className="prov-model">
                        <ModelPicker list={list} value={current || null} typed={c.typed} onPick={(id, typed) => changeModel(c, id, typed)} check={checkModel(c.id)} label={t('{provider}: model', { provider: info.name })} flat width={360} disabled={!canManage} />
                        <span className="prov-uses muted">{uses ? tn(uses, '{n} job uses it', '{n} jobs use it') : t('No job uses it yet')}</span>
                      </span>
                    ) : (
                      <span className="prov-uses muted">{c.id === 'azure' ? t('Runs the model of your Azure deployment') : uses ? tn(uses, '{n} job uses it', '{n} jobs use it') : t('No job uses it yet')}</span>
                    )}
                    <span className="prov-spend">
                      <span className="bar wide">
                        <span style={{ width: `${pct}%` }} className={pct > 80 ? 'warn' : ''} />
                      </span>
                      {c.capUsd ? t('about {spent} this month of {cap} cap', { spent: dollars(spent), cap: `US$${fmtNumber(c.capUsd)}` }) : t('about {spent} this month', { spent: dollars(spent) })}
                      {resting ? `. ${t('At its cap: it rests until the 1st')}` : ''}
                    </span>
                  </span>
                  <span className="prov-cap">
                    <label>{t('Monthly cap US$')}</label>
                    <input type="number" min={0} value={c.capUsd ?? ''} placeholder={tx('cap', 'none')} onChange={(e) => set({ providers: ai.providers.map((x) => (x.id === c.id ? { ...x, capUsd: e.target.value ? Number(e.target.value) : undefined } : x)) })} />
                  </span>
                  <span className="prov-acts">
                    <button type="button" className="ghost-btn sm outline" onClick={() => setAdding({ id: c.id, key: '', url: c.baseUrl ?? '', state: 'idle' })}>
                      <KeyRound size={13} /> {t('Replace key')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm"
                      title={t('Remove key')}
                      onClick={() => removeKey(c)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          {!phone && (
          <SmoothHeight>
            <TabPane key={adding ? adding.step ?? 'form' : 'closed'}>
              {addFlow ?? (
                <button type="button" className="ghost-btn sm add-prov-open" onClick={() => setAdding({ id: null, key: '', url: '', state: 'idle' })}>
                  <Plus size={14} /> {t('Add a provider')}
                </button>
              )}
            </TabPane>
          </SmoothHeight>
          )}
        </div>

        <AISpend ws={ws.id} ai={ai} plan={plan} people={people} typical={{ braindump: 41, ask: 118, meeting: 22, summary: 236, draft: 97, replies: 180, todos: 420, sorting: 300 }} listPrice={(p, m) => lists[p]?.models.find((x) => x.id === m)?.price ?? null} />

        {(() => {
          // On its own keys the company picks a model per job, in plain sight; on ours alone the choice is folded away.
          const own = ai.payer !== 'sprint2go' || connected.length > 0;
          /** A pick from the list: a model id typed in for a key stays marked as typed, and the job keeps its fallback. */
          const pickFor = (jobId: AIJobId, v: string) => {
            const [provider, model] = split(v);
            const was = ai.jobs[jobId];
            const conn = ai.providers.find((p) => p.id === provider);
            const typed = (!!conn?.typed && conn.model === model) || (!!was?.typed && was.provider === provider && was.model === model);
            return { provider, model, ...(was?.fallback ? { fallback: was.fallback } : {}), ...(typed ? { typed: true } : {}) };
          };
          const sample = (job: (typeof JOBS)[number], cur: { provider: ProviderId | 'included'; model: string }) => {
            setTesting(job.id);
            // DEMO ONLY: no provider to ask, so the sample is pretend
            if (!server.on)
              return void setTimeout(() => {
                setTesting(null);
                setTested((prev) => ({ ...prev, [job.id]: { ok: true, text: t('{secs}s · sample looked fine', { secs: secs((0.6 + Math.random() * 2.4) * 1000) }) } }));
              }, 1100);
            const name = modelLabel(cur.model, lists[cur.provider]);
            void fetch('/api/ai/models/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: cur.provider, model: cur.model }) })
              .then(async (r) => {
                const d = (await r.json().catch(() => ({}))) as { ms?: number; error?: string };
                setTested((prev) => ({ ...prev, [job.id]: r.ok ? { ok: true, text: t('{model} answered in {secs}s', { model: name, secs: secs(d.ms ?? 0) }) } : { ok: false, text: d.error ? t(d.error) : t('{model} didn’t answer.', { model: name }) } }));
              })
              .catch(() => setTested((prev) => ({ ...prev, [job.id]: { ok: false, text: t('Could not reach the server.') } })))
              .finally(() => setTesting(null));
          };
          const row = (job: (typeof JOBS)[number]) => {
            const cur = ai.jobs[job.id] ?? (allowIncluded ? { provider: 'included' as const, model: 'included' } : undefined);
            const entry = cur && cur.provider !== 'included' ? lists[cur.provider]?.models.find((m) => m.id === cur.model) : undefined;
            const cost = cur ? costPer100(job, cur.provider, cur.model, entry?.price) : null;
            const recModel = (preset: 'best' | 'balanced' | 'cheap') => PROVIDERS.flatMap((p) => p.models).find((m) => m.id === job.rec[preset] || m.id.endsWith(job.rec[preset]))?.name ?? (job.rec[preset] === 'browser' ? t('Browser') : job.rec[preset]);
            // A real one-call try on the server (not on our AI, browser speech or speech services); a pretend one in the demo.
            const canTry = !!cur && (!server.on || (cur.provider !== 'included' && job.id !== 'speech' && cur.model !== 'browser' && ai.providers.some((x) => x.id === cur.provider)));
            const result = tested[job.id];
            const costWord = cur?.provider === 'included' ? t('In your plan') : cur?.model === 'browser' ? tx('price', 'Free') : cost !== null && cost !== undefined ? t('≈ {cost} / 100 uses', { cost: rp(cost) }) : cur ? t('See provider prices') : '';
            if (phone)
              return (
                <ChoiceRow
                  key={job.id}
                  label={job.name}
                  sub={[costWord, result?.text].filter(Boolean).join(' · ') || job.hint}
                  value={cur ? `${cur.provider}|${cur.model}` : ''}
                  shown={cur ? jobOptions(job).find((o) => o.value === `${cur.provider}|${cur.model}`)?.label ?? modelLabel(cur.model, cur.provider === 'included' ? undefined : lists[cur.provider]) : connected.length || allowIncluded ? t('Choose a model') : t('Add a key first')}
                  options={jobOptions(job).map((o) => ({ value: o.value, label: o.label, hint: o.hint, group: o.group }))}
                  onChange={(v) => set({ preset: 'custom', jobs: { ...ai.jobs, [job.id]: pickFor(job.id, v) } })}
                  disabled={!canManage}
                />
              );
            return (
              <div key={job.id} className="job-row">
                <div className="job-name">
                  <strong>{job.name}</strong>
                  <small>
                    {job.hint} · {job.when === 'click' ? t('on click') : job.when === 'auto' ? t('automatic, once') : t('opt-in')}
                  </small>
                </div>
                <div className="job-pick">
                  <Select
                    value={cur ? `${cur.provider}|${cur.model}` : null}
                    onChange={(v) => set({ preset: 'custom', jobs: { ...ai.jobs, [job.id]: pickFor(job.id, v) } })}
                    options={jobOptions(job)}
                    placeholder={connected.length || allowIncluded ? t('Choose a model') : t('Add a key first')}
                    label={job.name}
                    title={job.name}
                    width={360}
                    searchable
                  />
                  <small className="muted">
                    {cur && cur.provider !== 'included' && ai.providers.some((x) => x.id === cur.provider) ? (
                      <>{t('Uses your {provider} key •••• {last4}', { provider: providerOf(cur.provider)!.name, last4: ai.providers.find((x) => x.id === cur.provider)!.keyLast4 })} · </>
                    ) : cur?.provider === 'included' ? (
                      <>{t('{product}’s AI', { product: product.name })} · </>
                    ) : null}
                    {t('Suggested: {balanced}, cheapest {cheap}', { balanced: recModel('balanced'), cheap: recModel('cheap') })}
                  </small>
                </div>
                <span className="job-cost">{cur?.provider === 'included' ? t('In your plan') : cur?.model === 'browser' ? tx('price', 'Free') : cost !== null && cost !== undefined ? t('≈ {cost} / 100 uses', { cost: rp(cost) }) : cur ? t('See provider prices') : ''}</span>
                <button type="button" className="icon-btn sm" title={server.on ? t('Try it with one tiny call') : t('Run a sample')} aria-label={t('Try {job}', { job: job.name })} disabled={!canTry || testing === job.id} onClick={() => cur && sample(job, cur)}>
                  {testing === job.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                </button>
                {result && <small className={`job-test ${result.ok ? '' : 'bad'}`}>{result.text}</small>}
              </div>
            );
          };
          const groups: [string, AIJobId[]][] = [
            [t('Meetings'), ['meeting', 'speech']],
            [t('Asking and planning'), ['ask', 'braindump']],
            [t('Email'), ['draft', 'summary', 'replies', 'todos']],
            [t('Behind the scenes'), ['sorting', 'digest', 'translate']],
          ];
          // Every text model of every key (costs differ per job, so none are shown here).
          const typedHint = t('Your model id');
          const everything = jobOptions(JOBS.find((j) => j.id === 'ask')!).map((o) => ({ ...o, hint: o.hint === typedHint ? o.hint : undefined }));
          const board = (
            <>
              <div className="job-tools">
                <span className="muted small">{t('Fill in for me:')}</span>
                <div className="segmented">
                  {(
                    [
                      ['best', t('Best quality')],
                      ['balanced', t('Balanced')],
                      ['cheap', t('Lowest cost')],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} type="button" className={ai.preset === v ? 'on' : ''} onClick={() => pickPreset(v)}>
                      {l}
                    </button>
                  ))}
                </div>
                {everything.length > 0 && phone && (
                  <button type="button" className="link-btn small ai-all-jobs" onClick={() => setAllJobs(true)}>
                    {t('One model for everything…')}
                  </button>
                )}
                {allJobs && (
                  <ChoiceSheet<string>
                    title={t('One model for everything')}
                    value=""
                    options={everything.map((o) => ({ value: o.value, label: o.label, hint: o.hint, group: o.group }))}
                    onClose={() => setAllJobs(false)}
                    onPick={(v) => {
                      setAllJobs(false);
                      const jobs = { ...ai.jobs };
                      for (const j of JOBS) if (j.id !== 'speech') jobs[j.id] = pickFor(j.id, v);
                      set({ preset: 'custom', jobs });
                      const model = everything.find((o) => o.value === v)?.label;
                      toast(model ? t('Every text job now uses {model}', { model }) : t('Every text job now uses that model'));
                    }}
                  />
                )}
                {everything.length > 0 && !phone && (
                  <Select<string>
                    value={null}
                    onChange={(v) => {
                      const jobs = { ...ai.jobs };
                      for (const j of JOBS) if (j.id !== 'speech') jobs[j.id] = pickFor(j.id, v);
                      set({ preset: 'custom', jobs });
                      const model = everything.find((o) => o.value === v)?.label;
                      toast(model ? t('Every text job now uses {model}', { model }) : t('Every text job now uses that model'));
                    }}
                    options={everything}
                    placeholder={t('One model for everything…')}
                    label={t('One model for everything')}
                    className="sel-flat"
                    width={360}
                    searchable
                  />
                )}
              </div>
              {ai.preset === 'custom' && <p className="muted small">{t('Your own mix. Pick a setup above to start over.')}</p>}
              {groups.map(([g, ids]) => (
                <div key={g} className="job-group">
                  <h4>{g}</h4>
                  {phone ? <div className="g-card ai-jobs">{ids.map((id) => row(JOBS.find((j) => j.id === id)!))}</div> : <div className="jobs-table">{ids.map((id) => row(JOBS.find((j) => j.id === id)!))}</div>}
                </div>
              ))}
            </>
          );
          return own ? (
            <div className="set-block">
              <h3>{t('Which AI does each job')}</h3>
              <p className="muted small">
                {t('Spend on the jobs that assign people and talk to {guests}; save on the ones nobody reads twice. Each job only uses the key you pick for it, with the model exactly as the provider names it.', { guests: term.whos })}
              </p>
              {board}
            </div>
          ) : (
            <details className="set-block advanced">
              <summary>
                <h3>{t('Which AI does each job')}</h3>
                <small className="muted">{t('{product} picks good models for you. Open this to choose your own.', { product: product.name })}</small>
              </summary>
              {board}
            </details>
          );
        })()}

        <div className="set-block">
          <h3>{t('Automatic jobs')}</h3>
          <p className="muted small">{t('These run once in the background on a cheap model, in batches. Everything else waits for a click.')}</p>
          {(
            [
              ['meetingNotes', t('Meeting notes after each meeting'), t('Summary, decisions and action items')],
              ['emailTodos', t('To-dos from {guest} emails', { guest: term.who }), t('Only emails from {guests} and known contacts. Skips newsletters, receipts and no-reply', { guests: term.whos })],
              ['digests', t('Daily channel digests'), t('Only for channels that switch it on')],
            ] as const
          ).map(([k, l, h]) => (
            <label key={k} className="set-row toggle-row">
              <span>
                <strong>{l}</strong>
                <small>{h}</small>
              </span>
              <button type="button" role="switch" aria-checked={ai.auto[k]} className={`switch ${ai.auto[k] ? 'on' : ''}`} onClick={() => set({ auto: { ...ai.auto, [k]: !ai.auto[k] } })}>
                <span />
              </button>
            </label>
          ))}
        </div>

        <div className="set-block">
          <h3>{t('Guardrails')}</h3>
          <label className="set-row toggle-row">
            <span>
              <strong>{t('Alert admins at 50%, 80% and 100%')}</strong>
              <small>{t('Of the plan’s allowance, the company’s limit and each key’s cap. A key at its cap rests until the 1st')}</small>
            </span>
            <button type="button" role="switch" aria-checked={ai.alerts} className={`switch ${ai.alerts ? 'on' : ''}`} onClick={() => set({ alerts: !ai.alerts })}>
              <span />
            </button>
          </label>
          {phone ? (
            <>
              <TextRow
                label={t('Monthly limit for the company')}
                sub={t('On your own keys, at list prices. AI stops for everyone when it’s reached. Empty: no limit.')}
                value={ai.caps?.companyRp ? String(ai.caps.companyRp) : ''}
                shown={ai.caps?.companyRp ? rp(ai.caps.companyRp) : t('No limit')}
                inputMode="numeric"
                placeholder="Rp"
                disabled={!canManage}
                footer={t('Empty: no limit.')}
                validate={(v) => (/^\d+$/.test(v.replace(/[.,\s]/g, '')) ? null : t('A whole number of rupiah'))}
                onSave={(v) => set({ caps: { ...ai.caps, companyRp: v ? Number(v.replace(/[.,\s]/g, '')) : undefined } })}
              />
              <TextRow
                label={t('Monthly limit per person')}
                sub={t('Each person stops at this amount; admins raise it here.')}
                value={ai.caps?.personRp ? String(ai.caps.personRp) : ''}
                shown={ai.caps?.personRp ? rp(ai.caps.personRp) : t('No limit')}
                inputMode="numeric"
                placeholder="Rp"
                disabled={!canManage}
                footer={t('Empty: no limit.')}
                validate={(v) => (/^\d+$/.test(v.replace(/[.,\s]/g, '')) ? null : t('A whole number of rupiah'))}
                onSave={(v) => set({ caps: { ...ai.caps, personRp: v ? Number(v.replace(/[.,\s]/g, '')) : undefined } })}
              />
              <GRow
                label={t('Blocked providers')}
                sub={t('Nobody in the company can use these, for example if a {guest} doesn’t allow data in China', { guest: term.who })}
                value={ai.blocked.length ? fmtList(ai.blocked.map((id) => providerOf(id)?.name ?? id)) : t('None')}
                onClick={canManage ? () => setBlocking(true) : undefined}
              />
            </>
          ) : (
          <>
          <div className="set-row">
            <span>
              <strong>{t('Monthly limit for the company')}</strong>
              <small>{t('On your own keys, at list prices. AI stops for everyone when it’s reached. Empty: no limit.')}</small>
            </span>
            <input type="number" className="cap-input" min={0} step={50000} value={ai.caps?.companyRp ?? ''} placeholder="Rp" onChange={(e) => set({ caps: { ...ai.caps, companyRp: e.target.value ? Number(e.target.value) : undefined } })} aria-label={t('Company limit in rupiah')} />
          </div>
          <div className="set-row">
            <span>
              <strong>{t('Monthly limit per person')}</strong>
              <small>{t('Each person stops at this amount; admins raise it here.')}</small>
            </span>
            <input type="number" className="cap-input" min={0} step={10000} value={ai.caps?.personRp ?? ''} placeholder="Rp" onChange={(e) => set({ caps: { ...ai.caps, personRp: e.target.value ? Number(e.target.value) : undefined } })} aria-label={t('Limit per person in rupiah')} />
          </div>
          <div className="set-row">
            <span>
              <strong>{t('Blocked providers')}</strong>
              <small>{t('Nobody in the company can use these, for example if a {guest} doesn’t allow data in China', { guest: term.who })}</small>
            </span>
          </div>
          <div className="chip-pick">
            {PROVIDERS.filter((p) => p.kind !== 'speech').map((p) => (
              <button key={p.id} type="button" className={ai.blocked.includes(p.id) ? 'on' : ''} onClick={() => set({ blocked: ai.blocked.includes(p.id) ? ai.blocked.filter((x) => x !== p.id) : [...ai.blocked, p.id] })}>
                {ai.blocked.includes(p.id) && <ShieldOff size={12} />} {p.name}
              </button>
            ))}
          </div>
          </>
          )}
        </div>
      </fieldset>
      {phone && blocking && (
        <PushScreen title={t('Blocked providers')} onBack={() => setBlocking(false)} className="g-page g-edit">
          <div className="g-body">
            <Group footer={t('Nobody in the company can use these, for example if a {guest} doesn’t allow data in China', { guest: term.who })}>
              {PROVIDERS.filter((x) => x.kind !== 'speech').map((x) => (
                <SwitchRow key={x.id} label={x.name} on={ai.blocked.includes(x.id)} onChange={(on) => set({ blocked: on ? [...ai.blocked, x.id] : ai.blocked.filter((y) => y !== x.id) })} />
              ))}
            </Group>
          </div>
        </PushScreen>
      )}
      {phone && adding && (
        <PushScreen title={adding.id ? providerOf(adding.id)!.name : t('Add a provider')} onBack={() => setAdding(null)} className="g-page ts-push ai-add-push">
          <div className="ts-push-body">{addFlow}</div>
        </PushScreen>
      )}
      {phone && openKey && (() => {
        const c = ai.providers.find((x) => x.id === openKey);
        if (!c) return null;
        const info = providerOf(c.id)!;
        const spent = server.on ? view?.spendUsd?.[c.id] ?? 0 : c.spentUsd;
        const uses = JOBS.filter((j) => ai.jobs[j.id]?.provider === c.id).length;
        const list = lists[c.id] ?? catalogList(c.id);
        const current = defaultModelOf(c.id, c.model, ai.jobs, list);
        return (
          <PushScreen title={info.name} onBack={() => setOpenKey(null)} className="g-page g-edit">
            <div className="g-body">
              <Group footer={uses ? tn(uses, '{n} job uses it', '{n} jobs use it') : t('No job uses it yet')}>
                <GRow label={t('Key')} value={`•••• ${c.keyLast4}`} />
                <GRow label={t('Added by')} value={users.find((u) => u.id === c.addedBy)?.name ?? t('someone')} />
                <GRow label={t('Status')} value={c.status === 'ok' ? t('Working') : t('Not working')} />
                {picksModel(c.id) && c.status === 'ok' && (
                  <GRow label={t('Model')} accessory={<span className="g-inline"><ModelPicker list={list} value={current || null} typed={c.typed} onPick={(id, typed) => changeModel(c, id, typed)} check={checkModel(c.id)} label={t('{provider}: model', { provider: info.name })} flat disabled={!canManage} /></span>} />
                )}
              </Group>
              <Group footer={t('about {spent} this month', { spent: dollars(spent) })}>
                <TextRow
                  label={t('Monthly cap US$')}
                  value={c.capUsd ? String(c.capUsd) : ''}
                  shown={c.capUsd ? `US$${fmtNumber(c.capUsd)}` : tx('cap', 'none')}
                  inputMode="decimal"
                  disabled={!canManage}
                  footer={t('Empty: no limit.')}
                  validate={(v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? null : t('A number'))}
                  onSave={(v) => set({ providers: ai.providers.map((x) => (x.id === c.id ? { ...x, capUsd: v ? Number(v) : undefined } : x)) })}
                />
              </Group>
              {canManage && (
                <Group>
                  <GRow label={t('Replace key')} action onClick={() => (setOpenKey(null), setAdding({ id: c.id, key: '', url: c.baseUrl ?? '', state: 'idle' }))} />
                  <GRow label={t('Remove key')} danger onClick={() => (setOpenKey(null), removeKey(c))} />
                </Group>
              )}
            </div>
          </PushScreen>
        );
      })()}
    </>
  );
}
