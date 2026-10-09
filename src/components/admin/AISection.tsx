import { useEffect, useState } from 'react';
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

const KIND_NAME = { direct: 'Direct', gateway: 'One key, many models', cloud: 'Company cloud account', private: 'Private', speech: 'Speech to text' } as const;
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
const jobWord = (name: string) => (/^Ask AI/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));
const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

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
        On {product.name}’s AI, these companies process what each job sends them. We choose the models{both ? '; jobs you set to your own keys use those first' : ''}. This list always shows what runs today.
      </p>
      {Array.from(groups.values()).map((g) => (
        <div key={`${g.pick.provider}|${g.pick.model}`} className="set-row">
          <span>
            <strong>
              {g.pick.providerName} ({g.pick.modelName})
            </strong>
            <small>For {joinAnd(g.jobs)}</small>
          </span>
        </div>
      ))}
      {backups.length > 0 && <p className="muted small">If one of them is down, {joinAnd(backups.map((b) => `${b.providerName} (${b.modelName})`))} takes over for that job.</p>}
      {down.length > 0 && (
        <p className="muted small">
          Not available on {product.name}’s AI right now: {joinAnd(down)}. To use {down.length === 1 ? 'it' : 'them'} now, add your own key below.
        </p>
      )}
      {warns.map((w) => (
        <p key={w.provider} className="warn-note">
          <AlertTriangle size={14} /> {w.providerName}: {w.warn}
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
    toast(`Every job now uses the ${preset === 'cheap' ? 'lowest cost' : preset} setup`);
  };

  /** One tiny call with a model on a saved key: an id typed in, before it's used. */
  const checkModel = (provider: ProviderId) => async (id: string): Promise<string | null> => {
    // DEMO ONLY: no provider to ask, so an id that looks right is taken
    if (!server.on) return new Promise((r) => setTimeout(() => r(MODEL_ID.test(id) ? null : 'That doesn’t look like a model id: letters, numbers and . _ : / - only.'), 700));
    const r = await fetch('/api/ai/models/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider, model: id }) }).catch(() => null);
    if (!r) return 'Could not reach the server.';
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? null : d.error ?? 'That model didn’t answer.';
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
    toast(`${shortName(c.id)} now uses ${modelLabel(id, lists[c.id])}${moved ? `. ${moved} job${moved === 1 ? '' : 's'} moved to it` : ''}`);
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
    toast(a.scope === 'all' ? `Every text job now uses ${name}` : n ? `${shortName(id)} now uses ${name} for ${n} job${n === 1 ? '' : 's'}` : `${shortName(id)} uses ${name}. No job picked it yet: choose it for a job below`);
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
        toast(`${info.name} connected. The key is encrypted and only the last 4 characters are kept`);
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
    const out: Option[] = allowIncluded && !speech ? [{ value: 'included|included', label: `${product.name} (included in your plan)`, group: 'Included', icon: <Sparkles size={14} /> }] : [];
    for (const c of ai.providers) {
      if (c.status !== 'ok' || ai.blocked.includes(c.id)) continue;
      const info = providerOf(c.id)!;
      const list = lists[c.id] ?? catalogList(c.id);
      const ms = list.models.filter((m) => (speech ? m.kind === 'speech' || (info.kind === 'speech' && list.source === 'catalog') : m.kind === 'text' && !(info.kind === 'speech' && list.source === 'catalog')));
      for (const m of ms) {
        const cost = speech ? null : costPer100(job, c.id, m.id, m.price);
        out.push({ value: `${c.id}|${m.id}`, label: m.name, hint: speech ? info.name : cost !== null ? `≈ ${rp(cost)} / 100 uses` : 'Price unknown', group: info.name, keywords: `${m.id} ${m.family}` });
      }
      // A model id typed in for this key, and whatever the job uses now, stay pickable.
      if (!speech && c.typed && c.model && !ms.some((m) => m.id === c.model)) out.push({ value: `${c.id}|${c.model}`, label: c.model, hint: 'Your model id', group: info.name });
    }
    const cur = ai.jobs[job.id];
    if (cur && cur.provider !== 'included' && cur.model && cur.model !== 'browser' && !out.some((o) => o.value === `${cur.provider}|${cur.model}`) && ai.providers.some((p) => p.id === cur.provider)) {
      out.push({ value: `${cur.provider}|${cur.model}`, label: modelLabel(cur.model, lists[cur.provider]), hint: cur.typed ? 'Your model id' : 'Not on the provider’s list', group: providerOf(cur.provider)?.name ?? cur.provider });
    }
    if (speech) out.push({ value: 'custom|browser', label: 'Browser speech (free)', hint: 'Chrome and Safari only', group: 'Free' });
    return out;
  };

  const usage = [
    ['Brain dumps', 41, 'braindump'],
    ['Ask AI questions', 118, 'ask'],
    ['Meeting notes (hours)', 22, 'meeting'],
    ['Email summaries', 236, 'summary'],
    ['Drafts and rewrites', 97, 'draft'],
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

  return (
    <>
      <h2>AI</h2>
      <p className="set-intro">Pick who pays for AI and which model does each job. AI only runs when someone clicks, or once in the background for the jobs you allow.</p>
      {!canManage && <p className="modal-note">Only owners and admins can change AI settings.</p>}
      <fieldset className="plain" disabled={!canManage}>
        <div className="set-block">
          <h3>Who pays for AI</h3>
          <div className="payer-pick">
            {(
              [
                ['sprint2go', `${product.name}`, included ? `Included in ${planName(plan!)}: shared allowance for the whole company` : 'Needs an “AI included” plan'],
                ['own', 'Our own keys', 'Your providers bill you directly. Cheapest plans'],
                ['both', 'Both', 'Your keys first; the plan’s allowance as backup'],
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
              You’re on {plan ? planName(plan) : 'Free'} with your own keys.{' '}
              <button type="button" className="link-btn" onClick={onBilling}>
                Switch to AI included
              </button>{' '}
              if you’d rather not manage keys.
            </p>
          )}
        </div>

        {plan?.tier === 'free' && !included && (
          <div className="set-block">
            <h3>AI on Free</h3>
            <p className="muted small">
              Free doesn’t include AI from {product.name}. Add your own key above and it works right away, with no limit from us, or{' '}
              <button type="button" className="link-btn" onClick={onBilling}>
                pick a plan with AI included
              </button>
              .
            </p>
          </div>
        )}
        {included && ai.payer !== 'own' && view && (
          <div className="set-block">
            <h3>Who handles your data</h3>
            <DataRoute view={view} both={ai.payer === 'both'} />
          </div>
        )}
        {included && ai.payer !== 'own' && (
          <div className="set-block">
            <h3>Left this month</h3>
            {allowance?.unlimited || !showUsage ? null : (
              <div className="allow-meter">
                <span className="bar wide">
                  <span style={{ width: `${Math.min(1, usedShare) * 100}%` }} className={usedShare > 0.8 ? 'warn' : ''} />
                </span>
                {usedUp ? (
                  <p>
                    <b>Used up for this month.</b>{' '}
                    {view?.why === 'trial' ? (
                      <>
                        The trial’s AI starts again on the 1st.{' '}
                        <button type="button" className="link-btn" onClick={onBilling}>
                          Pick a plan
                        </button>{' '}
                        or add your own key above to carry on now.
                      </>
                    ) : view?.why === 'comp' ? (
                      'It starts again on the 1st. Add your own key above to carry on now.'
                    ) : plan?.autoTopUp?.on ? (
                      <>
                        Automatic top-ups reached their monthly limit.{' '}
                        <button type="button" className="link-btn" onClick={onBilling}>
                          Raise the limit or add a top-up
                        </button>
                        .
                      </>
                    ) : (
                      <>
                        <button type="button" className="link-btn" onClick={onBilling}>
                          Add a top-up
                        </button>{' '}
                        ({rp(TOP_UP.price)}) to carry on, or turn on automatic top-ups.
                      </>
                    )}
                  </p>
                ) : (
                  <p>
                    About <b>{leftOf('meeting') ?? 0} meeting hours</b>, or <b>{leftOf('ask') ?? 0} questions</b>, or <b>{leftOf('braindump') ?? 0} brain dumps</b> left, shared by the whole company
                    {allowance?.topUps ? `, with ${allowance.topUps} top-up${allowance.topUps === 1 ? '' : 's'} this month` : ''}.
                  </p>
                )}
              </div>
            )}
            {showUsage ? (
              <div className="usage-grid">
                {usage.map(([l, n, k]) => (
                  <div key={k}>
                    <b>{allowance ? allowance.uses[k] ?? 0 : n}</b>
                    <span>{allowance ? (k === 'meeting' ? 'Meetings with notes' : l) : l} {allowance ? <em>this month</em> : <em>of {pool[k]}</em>}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="lazy-wait" aria-hidden />
            )}
          </div>
        )}

        <div className="set-block">
          <h3>{ai.payer === 'sprint2go' ? 'Providers' : 'Your AI keys'}</h3>
          {notes.length > 0 && (
            <div className="ai-notes">
              {notes.map(({ item: n, leaving }) => (
                <p key={n.id} className={`warn-note ai-note ${leaving ? 'row-leaving' : ''}`}>
                  <AlertTriangle size={14} />
                  <span>{n.text}</span>
                  <button type="button" className="icon-btn sm" title="Got it" aria-label="Dismiss" onClick={() => set({ notes: (ai.notes ?? []).filter((x) => x.id !== n.id) })}>
                    <X size={14} />
                  </button>
                </p>
              ))}
            </div>
          )}
          {ai.providers.length === 0 && <p className="muted small">No keys yet. {included && ai.payer !== 'own' ? `${product.name}’s AI is used for everything.` : 'Add a key to switch the AI on, then pick which model does each job below.'}</p>}
          <div className="prov-list">
            {ai.providers.map((c) => {
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
                      <KeyRound size={11} /> •••• {c.keyLast4} · added by {users.find((u) => u.id === c.addedBy)?.name.split(' ')[0] ?? 'someone'}
                    </small>
                    {picksModel(c.id) && c.status === 'ok' ? (
                      <span className="prov-model">
                        <ModelPicker list={list} value={current || null} typed={c.typed} onPick={(id, typed) => changeModel(c, id, typed)} check={checkModel(c.id)} label={`${info.name}: model`} flat width={360} disabled={!canManage} />
                        <span className="prov-uses muted">{uses ? `${uses} job${uses === 1 ? ' uses' : 's use'} it` : 'No job uses it yet'}</span>
                      </span>
                    ) : (
                      <span className="prov-uses muted">{c.id === 'azure' ? 'Runs the model of your Azure deployment' : uses ? `${uses} job${uses === 1 ? ' uses' : 's use'} it` : 'No job uses it yet'}</span>
                    )}
                    <span className="prov-spend">
                      <span className="bar wide">
                        <span style={{ width: `${pct}%` }} className={pct > 80 ? 'warn' : ''} />
                      </span>
                      about US${spent.toFixed(2)} this month{c.capUsd ? ` of US$${c.capUsd} cap` : ''}
                      {resting ? '. At its cap: it rests until the 1st' : ''}
                    </span>
                  </span>
                  <span className="prov-cap">
                    <label>Monthly cap US$</label>
                    <input type="number" min={0} value={c.capUsd ?? ''} placeholder="none" onChange={(e) => set({ providers: ai.providers.map((x) => (x.id === c.id ? { ...x, capUsd: e.target.value ? Number(e.target.value) : undefined } : x)) })} />
                  </span>
                  <span className="prov-acts">
                    <button type="button" className="ghost-btn sm outline" onClick={() => setAdding({ id: c.id, key: '', url: c.baseUrl ?? '', state: 'idle' })}>
                      <KeyRound size={13} /> Replace key
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm"
                      title="Remove key"
                      onClick={() => {
                        if (server.on) void fetch('/api/ai/keys', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: c.id }) });
                        const providers = ai.providers.filter((x) => x.id !== c.id);
                        // Jobs that used this key move to the best match among the keys that are left.
                        const moved = JOBS.filter((j) => ai.jobs[j.id]?.provider === c.id);
                        const refill = presetJobs(ai.preset === 'custom' ? 'balanced' : ai.preset, providers.filter((x) => x.status === 'ok').map((x) => x.id), allowIncluded, known());
                        const jobs = { ...ai.jobs };
                        for (const j of moved) {
                          if (refill[j.id]) jobs[j.id] = refill[j.id];
                          else delete jobs[j.id];
                        }
                        set({ providers, jobs });
                        toast(`${info.name} key removed${moved.length ? `. ${moved.length} job${moved.length === 1 ? '' : 's'} moved to another model` : ''}`);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <SmoothHeight>
            <TabPane key={adding ? adding.step ?? 'form' : 'closed'}>
              {adding?.step === 'model' && adding.id && adding.list ? (
                <div className="add-prov add-model">
                  <p className="add-model-done">
                    <CheckCircle2 size={14} className="ok" /> {providerOf(adding.id)!.name} is connected. The key is encrypted; only its last 4 characters are kept.
                  </p>
                  <p className="add-model-q" id="add-model-q">
                    Which model should {shortName(adding.id)} use?
                  </p>
                  <ModelPicker list={adding.list} value={adding.model ?? null} typed={adding.typed} onPick={(model, typed) => setAdding((a) => a && { ...a, model, typed })} check={checkModel(adding.id)} label={`Which model should ${shortName(adding.id)} use?`} width={380} />
                  <p className="muted small">
                    {!textModels(adding.list).length
                      ? 'Open the list and choose Other model id: type the id exactly as your server names it. We try it with one tiny call.'
                      : adding.list.source === 'live'
                      ? `From ${shortName(adding.id)}’s own list for this key. Recommended ones first; search by name or id.`
                      : adding.list.note ?? (server.on ? `${shortName(adding.id)} doesn’t share a list, so these are the models we know.` : 'Demo: these are the models we know. With the server, the provider’s own list shows here.')}
                  </p>
                  <div className="model-scope" role="radiogroup" aria-label="Which jobs use this model">
                    {(
                      [
                        ['all', 'Use it for every job', 'Every text job runs on this model. Voice notes keep their speech service.'],
                        ['fit', 'Only where it fits', `Jobs keep the ${ai.preset === 'custom' ? 'models you picked' : `${ai.preset === 'cheap' ? 'lowest cost' : ai.preset} setup`}; where that uses ${shortName(adding.id)}, they use this model.`],
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
                        toast(`${providerOf(id)!.name} connected. Pick its model any time on its row`);
                      }}
                    >
                      Later
                    </button>
                    <button type="button" className="primary-btn sm" disabled={!adding.model} onClick={applyModel}>
                      <CheckCircle2 size={14} /> Use this model
                    </button>
                  </div>
                </div>
              ) : adding ? (
                <div className="add-prov">
                  <Select<ProviderId>
                    value={adding.id}
                    onChange={(id) => setAdding({ ...adding, id, state: 'idle' })}
                    placeholder="Choose a provider"
                    label="Provider"
                    width={340}
                    searchable
                    options={PROVIDERS.map((p) => ({ value: p.id, label: p.name, hint: p.note, group: KIND_NAME[p.kind], icon: <span className="prov-mark sm">{p.name.charAt(0)}</span> }))}
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
                            placeholder={`${f.label}${f.optional ? ' (optional)' : ''}${f.placeholder ? `: ${f.placeholder}` : ''}`}
                          />
                        ),
                      )}
                      <p className="muted small">{CRED_FIELDS[adding.id]!.help}</p>
                      {adding.state === 'error' && <p className="err">{adding.message ?? 'Fill in every field.'}</p>}
                    </>
                  )}
                  {adding.id && !CRED_FIELDS[adding.id] && (
                    <>
                      {providerOf(adding.id)!.needsUrl && <input value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} placeholder={adding.id === 'custom' ? 'https://ai.your-server.com/v1' : 'Endpoint'} aria-label="Address" />}
                      <input type="password" autoComplete="off" value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value, state: 'idle' })} placeholder={providerOf(adding.id)!.keyHint} aria-label="Key" />
                      {adding.state === 'error' && <p className="err">{adding.message ?? `That doesn’t look like a valid key${providerOf(adding.id)!.needsUrl ? ' and address' : ''}.`}</p>}
                    </>
                  )}
                  {adding.id && (
                    <p className="muted small">
                      {server.on ? 'We test the key with one tiny request, then store it encrypted. Only the last 4 characters are shown again.' : 'Demo: the key is only checked for its shape. With the local server it’s tested with the provider and stored encrypted.'}
                      {picksModel(adding.id) ? ' Then you pick its model.' : ''}
                    </p>
                  )}
                  <div className="add-prov-foot">
                    <button type="button" className="ghost-btn sm" onClick={() => setAdding(null)}>
                      Cancel
                    </button>
                    <button type="button" className="primary-btn sm" disabled={!adding.id || (!CRED_FIELDS[adding.id] && !adding.key) || adding.state === 'testing'} onClick={addProvider}>
                      {adding.state === 'testing' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {adding.state === 'testing' ? 'Testing…' : 'Test and save'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="ghost-btn sm add-prov-open" onClick={() => setAdding({ id: null, key: '', url: '', state: 'idle' })}>
                  <Plus size={14} /> Add a provider
                </button>
              )}
            </TabPane>
          </SmoothHeight>
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
                setTested((t) => ({ ...t, [job.id]: { ok: true, text: `${(0.6 + Math.random() * 2.4).toFixed(1)}s · sample looked fine` } }));
              }, 1100);
            const name = modelLabel(cur.model, lists[cur.provider]);
            void fetch('/api/ai/models/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: cur.provider, model: cur.model }) })
              .then(async (r) => {
                const d = (await r.json().catch(() => ({}))) as { ms?: number; error?: string };
                setTested((t) => ({ ...t, [job.id]: r.ok ? { ok: true, text: `${name} answered in ${((d.ms ?? 0) / 1000).toFixed(1)}s` } : { ok: false, text: d.error ?? `${name} didn’t answer.` } }));
              })
              .catch(() => setTested((t) => ({ ...t, [job.id]: { ok: false, text: 'Could not reach the server.' } })))
              .finally(() => setTesting(null));
          };
          const row = (job: (typeof JOBS)[number]) => {
            const cur = ai.jobs[job.id] ?? (allowIncluded ? { provider: 'included' as const, model: 'included' } : undefined);
            const entry = cur && cur.provider !== 'included' ? lists[cur.provider]?.models.find((m) => m.id === cur.model) : undefined;
            const cost = cur ? costPer100(job, cur.provider, cur.model, entry?.price) : null;
            const recModel = (preset: 'best' | 'balanced' | 'cheap') => PROVIDERS.flatMap((p) => p.models).find((m) => m.id === job.rec[preset] || m.id.endsWith(job.rec[preset]))?.name ?? (job.rec[preset] === 'browser' ? 'Browser' : job.rec[preset]);
            // A real one-call try on the server (not on our AI, browser speech or speech services); a pretend one in the demo.
            const canTry = !!cur && (!server.on || (cur.provider !== 'included' && job.id !== 'speech' && cur.model !== 'browser' && ai.providers.some((x) => x.id === cur.provider)));
            const t = tested[job.id];
            return (
              <div key={job.id} className="job-row">
                <div className="job-name">
                  <strong>{job.name}</strong>
                  <small>
                    {job.hint} · {job.when === 'click' ? 'on click' : job.when === 'auto' ? 'automatic, once' : 'opt-in'}
                  </small>
                </div>
                <div className="job-pick">
                  <Select
                    value={cur ? `${cur.provider}|${cur.model}` : null}
                    onChange={(v) => set({ preset: 'custom', jobs: { ...ai.jobs, [job.id]: pickFor(job.id, v) } })}
                    options={jobOptions(job)}
                    placeholder={connected.length || allowIncluded ? 'Choose a model' : 'Add a key first'}
                    label={job.name}
                    title={job.name}
                    width={360}
                    searchable
                  />
                  <small className="muted">
                    {cur && cur.provider !== 'included' && ai.providers.some((x) => x.id === cur.provider) ? (
                      <>
                        Uses your {providerOf(cur.provider)!.name} key •••• {ai.providers.find((x) => x.id === cur.provider)!.keyLast4} ·{' '}
                      </>
                    ) : cur?.provider === 'included' ? (
                      `${product.name}’s AI · `
                    ) : null}
                    Suggested: {recModel('balanced')}, cheapest {recModel('cheap')}
                  </small>
                </div>
                <span className="job-cost">{cur?.provider === 'included' ? 'In your plan' : cur?.model === 'browser' ? 'Free' : cost !== null && cost !== undefined ? `≈ ${rp(cost)} / 100 uses` : cur ? 'See provider prices' : ''}</span>
                <button type="button" className="icon-btn sm" title={server.on ? 'Try it with one tiny call' : 'Run a sample'} aria-label={`Try ${job.name}`} disabled={!canTry || testing === job.id} onClick={() => cur && sample(job, cur)}>
                  {testing === job.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                </button>
                {t && <small className={`job-test ${t.ok ? '' : 'bad'}`}>{t.text}</small>}
              </div>
            );
          };
          const groups: [string, AIJobId[]][] = [
            ['Meetings', ['meeting', 'speech']],
            ['Asking and planning', ['ask', 'braindump']],
            ['Email', ['draft', 'summary', 'replies', 'todos']],
            ['Behind the scenes', ['sorting', 'digest', 'translate']],
          ];
          // Every text model of every key (costs differ per job, so none are shown here).
          const everything = jobOptions(JOBS.find((j) => j.id === 'ask')!).map((o) => ({ ...o, hint: o.hint === 'Your model id' ? o.hint : undefined }));
          const board = (
            <>
              <div className="job-tools">
                <span className="muted small">Fill in for me:</span>
                <div className="segmented">
                  {(
                    [
                      ['best', 'Best quality'],
                      ['balanced', 'Balanced'],
                      ['cheap', 'Lowest cost'],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} type="button" className={ai.preset === v ? 'on' : ''} onClick={() => pickPreset(v)}>
                      {l}
                    </button>
                  ))}
                </div>
                {everything.length > 0 && (
                  <Select<string>
                    value={null}
                    onChange={(v) => {
                      const jobs = { ...ai.jobs };
                      for (const j of JOBS) if (j.id !== 'speech') jobs[j.id] = pickFor(j.id, v);
                      set({ preset: 'custom', jobs });
                      toast(`Every text job now uses ${everything.find((o) => o.value === v)?.label ?? 'that model'}`);
                    }}
                    options={everything}
                    placeholder="One model for everything…"
                    label="One model for everything"
                    className="sel-flat"
                    width={360}
                    searchable
                  />
                )}
              </div>
              {ai.preset === 'custom' && <p className="muted small">Your own mix. Pick a setup above to start over.</p>}
              {groups.map(([g, ids]) => (
                <div key={g} className="job-group">
                  <h4>{g}</h4>
                  <div className="jobs-table">{ids.map((id) => row(JOBS.find((j) => j.id === id)!))}</div>
                </div>
              ))}
            </>
          );
          return own ? (
            <div className="set-block">
              <h3>Which AI does each job</h3>
              <p className="muted small">Spend on the jobs that assign people and talk to {term.whos}; save on the ones nobody reads twice. Each job only uses the key you pick for it, with the model exactly as the provider names it.</p>
              {board}
            </div>
          ) : (
            <details className="set-block advanced">
              <summary>
                <h3>Which AI does each job</h3>
                <small className="muted">{product.name} picks good models for you. Open this to choose your own.</small>
              </summary>
              {board}
            </details>
          );
        })()}

        <div className="set-block">
          <h3>Automatic jobs</h3>
          <p className="muted small">These run once in the background on a cheap model, in batches. Everything else waits for a click.</p>
          {(
            [
              ['meetingNotes', 'Meeting notes after each meeting', 'Summary, decisions and action items'],
              ['emailTodos', `To-dos from ${term.who} emails`, `Only emails from ${term.whos} and known contacts. Skips newsletters, receipts and no-reply`],
              ['digests', 'Daily channel digests', 'Only for channels that switch it on'],
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
          <h3>Guardrails</h3>
          <label className="set-row toggle-row">
            <span>
              <strong>Alert admins at 50%, 80% and 100%</strong>
              <small>Of the plan’s allowance, the company’s limit and each key’s cap. A key at its cap rests until the 1st</small>
            </span>
            <button type="button" role="switch" aria-checked={ai.alerts} className={`switch ${ai.alerts ? 'on' : ''}`} onClick={() => set({ alerts: !ai.alerts })}>
              <span />
            </button>
          </label>
          <div className="set-row">
            <span>
              <strong>Monthly limit for the company</strong>
              <small>On your own keys, at list prices. AI stops for everyone when it’s reached. Empty: no limit.</small>
            </span>
            <input type="number" className="cap-input" min={0} step={50000} value={ai.caps?.companyRp ?? ''} placeholder="Rp" onChange={(e) => set({ caps: { ...ai.caps, companyRp: e.target.value ? Number(e.target.value) : undefined } })} aria-label="Company limit in rupiah" />
          </div>
          <div className="set-row">
            <span>
              <strong>Monthly limit per person</strong>
              <small>Each person stops at this amount; admins raise it here.</small>
            </span>
            <input type="number" className="cap-input" min={0} step={10000} value={ai.caps?.personRp ?? ''} placeholder="Rp" onChange={(e) => set({ caps: { ...ai.caps, personRp: e.target.value ? Number(e.target.value) : undefined } })} aria-label="Limit per person in rupiah" />
          </div>
          <div className="set-row">
            <span>
              <strong>Blocked providers</strong>
              <small>Nobody in the company can use these, for example if a {term.who} doesn’t allow data in China</small>
            </span>
          </div>
          <div className="chip-pick">
            {PROVIDERS.filter((p) => p.kind !== 'speech').map((p) => (
              <button key={p.id} type="button" className={ai.blocked.includes(p.id) ? 'on' : ''} onClick={() => set({ blocked: ai.blocked.includes(p.id) ? ai.blocked.filter((x) => x !== p.id) : [...ai.blocked, p.id] })}>
                {ai.blocked.includes(p.id) && <ShieldOff size={12} />} {p.name}
              </button>
            ))}
          </div>
        </div>
      </fieldset>
    </>
  );
}
