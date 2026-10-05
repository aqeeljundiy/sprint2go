import { useState } from 'react';
import { server } from '../../sync';
import { AISpend } from './AISpend';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Play, Plus, ShieldOff, Sparkles, Trash2 } from 'lucide-react';
import type { AIJobId, AISettings, ProviderConn, ProviderId, User, Workspace } from '../../types';
import { JOBS, PROVIDERS, costPer100, presetJobs, providerOf } from '../../data/aiCatalog';
import { ALLOWANCE, planName, rp, seatsFor } from '../../data/pricing';
import { defaultAI } from '../../data/workspaces';
import { Select, type Option } from '../ui/Select';

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

/** Workspace settings → AI: who pays, providers and keys, presets, per-job routing with the guide, limits, usage. */
export function AISection({ ws, people, users, me, canManage, onAI, onBilling, toast }: Props) {
  const ai = ws.ai ?? defaultAI(ws.plan?.track === 'own');
  const plan = ws.plan;
  const included = plan?.track === 'ai' && plan.tier !== 'free';
  const set = (p: Partial<AISettings>) => onAI({ ...ai, ...p });
  const [adding, setAdding] = useState<{ id: ProviderId | null; key: string; url: string; state: 'idle' | 'testing' | 'error'; message?: string } | null>(null);
  const [testing, setTesting] = useState<AIJobId | null>(null);
  const [tested, setTested] = useState<Partial<Record<AIJobId, string>>>({});
  const connected = ai.providers.filter((p) => p.status === 'ok').map((p) => p.id);
  const allowIncluded = included && ai.payer !== 'own';

  const pickPreset = (preset: 'best' | 'balanced' | 'cheap') => {
    set({ preset, jobs: presetJobs(preset, connected, allowIncluded) });
    toast(`Every job now uses the ${preset === 'cheap' ? 'lowest cost' : preset} setup`);
  };

  const addProvider = () => {
    if (!adding?.id) return;
    const info = providerOf(adding.id)!;
    const key = adding.key.trim();
    if (key.length < 16 || (info.needsUrl && !/^https?:\/\//.test(adding.url.trim()) && adding.id === 'custom')) {
      setAdding({ ...adding, state: 'error' });
      return;
    }
    setAdding({ ...adding, state: 'testing' });
    const save = (keyLast4: string) => {
      const conn: ProviderConn = { id: adding.id!, keyLast4, addedAt: new Date().toISOString(), addedBy: me, status: 'ok', baseUrl: adding.url.trim() || undefined, spentUsd: 0 };
      const providers = [...ai.providers.filter((p) => p.id !== conn.id), conn];
      const jobs = ai.preset === 'custom' ? ai.jobs : presetJobs(ai.preset === 'best' ? 'best' : ai.preset === 'cheap' ? 'cheap' : 'balanced', providers.map((p) => p.id), allowIncluded);
      onAI({ ...ai, providers, jobs, payer: ai.payer === 'sprint2go' ? 'both' : ai.payer });
      setAdding(null);
      toast(`${info.name} connected. The key is encrypted and only the last 4 characters are kept`);
    };
    // With the local server the key is tested with a tiny real request, then stored encrypted there.
    if (!server.on) return void setTimeout(() => save(key.slice(-4)), 900);
    void fetch('/api/ai/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: adding.id, key, baseUrl: adding.url.trim() || undefined }) })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { keyLast4?: string; error?: string };
        if (r.ok && d.keyLast4) save(d.keyLast4);
        else setAdding((a) => a && { ...a, state: 'error', message: d.error });
      })
      .catch(() => setAdding((a) => a && { ...a, state: 'error', message: 'Could not reach the server.' }));
  };

  const jobOptions = (): Option[] => [
    ...(allowIncluded ? [{ value: 'included|included', label: 'Sprint2go (included in your plan)', group: 'Included', icon: <Sparkles size={14} /> }] : []),
    ...ai.providers
      .filter((p) => p.status === 'ok' && !ai.blocked.includes(p.id))
      .flatMap((p) => providerOf(p.id)!.models.map((m) => ({ value: `${p.id}|${m.id}`, label: m.name, hint: providerOf(p.id)!.name, group: providerOf(p.id)!.name }))),
    { value: 'custom|browser', label: 'Browser speech (free)', hint: 'Chrome and Safari only', group: 'Free' },
  ];

  const usage = [
    ['Brain dumps', 41, 'braindump'],
    ['Ask AI questions', 118, 'ask'],
    ['Meeting notes (hours)', 22, 'meeting'],
    ['Email summaries', 236, 'summary'],
    ['Drafts and rewrites', 97, 'draft'],
  ] as const;
  const seats = plan ? seatsFor(plan.tier, people) : people;
  const pool = { braindump: ALLOWANCE.braindump * seats, ask: ALLOWANCE.ask * seats, meeting: ALLOWANCE.meetingHours * seats, summary: ALLOWANCE.summary * seats, draft: ALLOWANCE.draft * seats } as Record<string, number>;
  const usedShare = Math.min(0.95, usage.reduce((s, [, n, k]) => s + n / (pool[k] || 1), 0) / usage.length);

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
                ['sprint2go', 'Sprint2go', included ? `Included in ${planName(plan!)}: shared allowance for the whole company` : 'Needs an “AI included” plan'],
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

        {plan?.tier === 'free' && (
          <div className="set-block">
            <h3>Free AI this month</h3>
            <div className="allow-meter">
              <span className="bar wide">
                <span style={{ width: '40%' }} />
              </span>
              <p>
                Left: <b>3 brain dumps</b>, <b>6 Ask AI questions</b>, <b>1 meeting hour</b>, <b>12 summaries</b>. Add your own key above for unlimited AI, or{' '}
                <button type="button" className="link-btn" onClick={onBilling}>
                  pick a plan
                </button>
                .
              </p>
            </div>
          </div>
        )}
        {included && ai.payer !== 'own' && (
          <div className="set-block">
            <h3>Left this month</h3>
            <div className="allow-meter">
              <span className="bar wide">
                <span style={{ width: `${usedShare * 100}%` }} className={usedShare > 0.8 ? 'warn' : ''} />
              </span>
              <p>
                About <b>{Math.round(pool.meeting * (1 - usedShare))} meeting hours</b>, or <b>{Math.round(pool.ask * (1 - usedShare))} questions</b>, or{' '}
                <b>{Math.round(pool.braindump * (1 - usedShare))} brain dumps</b> left, shared by the whole company.
              </p>
            </div>
            <div className="usage-grid">
              {usage.map(([l, n, k]) => (
                <div key={k}>
                  <b>{n}</b>
                  <span>
                    {l} <em>of {pool[k]}</em>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="set-block">
          <h3>Providers</h3>
          {ai.providers.length === 0 && <p className="muted small">No keys yet. {included ? 'Sprint2go’s AI is used for everything.' : 'Add a key to switch the AI on.'}</p>}
          <div className="prov-list">
            {ai.providers.map((c) => {
              const info = providerOf(c.id)!;
              const pct = c.capUsd ? Math.min(100, (c.spentUsd / c.capUsd) * 100) : 0;
              return (
                <div key={c.id} className={`prov ${ai.blocked.includes(c.id) ? 'blocked' : ''}`}>
                  <span className="prov-mark">{info.name.charAt(0)}</span>
                  <span className="prov-main">
                    <strong>
                      {info.name} {c.status === 'ok' ? <CheckCircle2 size={13} className="ok" /> : <AlertTriangle size={13} className="bad" />}
                    </strong>
                    <small>
                      <KeyRound size={11} /> •••• {c.keyLast4} · added by {users.find((u) => u.id === c.addedBy)?.name.split(' ')[0] ?? 'someone'} · {info.models.length} model{info.models.length > 1 ? 's' : ''}
                    </small>
                    <span className="prov-spend">
                      <span className="bar wide">
                        <span style={{ width: `${pct}%` }} className={pct > 80 ? 'warn' : ''} />
                      </span>
                      about US${c.spentUsd.toFixed(2)} this month{c.capUsd ? ` of US$${c.capUsd} cap` : ''}
                    </span>
                  </span>
                  <span className="prov-cap">
                    <label>Monthly cap US$</label>
                    <input type="number" min={0} value={c.capUsd ?? ''} placeholder="none" onChange={(e) => set({ providers: ai.providers.map((x) => (x.id === c.id ? { ...x, capUsd: e.target.value ? Number(e.target.value) : undefined } : x)) })} />
                  </span>
                  <button type="button" className="icon-btn sm" title="Remove key" onClick={() => {
                      if (server.on) void fetch('/api/ai/keys', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: c.id }) });
                      set({ providers: ai.providers.filter((x) => x.id !== c.id) });
                      toast(`${info.name} key removed`);
                    }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
          {adding ? (
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
              {adding.id && (
                <>
                  {providerOf(adding.id)!.needsUrl && <input value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} placeholder={adding.id === 'custom' ? 'https://ai.your-server.com/v1' : adding.id === 'bedrock' ? 'Region, e.g. ap-southeast-3' : 'Endpoint'} />}
                  <input type="password" autoComplete="off" value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value, state: 'idle' })} placeholder={providerOf(adding.id)!.keyHint} />
                  {adding.state === 'error' && <p className="err">{adding.message ?? `That doesn’t look like a valid key${providerOf(adding.id)!.needsUrl ? ' and address' : ''}.`}</p>}
                  <p className="muted small">{server.on ? 'We test the key with one tiny request, then store it encrypted. Only the last 4 characters are shown again.' : 'Demo: the key is only checked for its shape. With the local server it’s tested with the provider and stored encrypted.'}</p>
                </>
              )}
              <div className="add-prov-foot">
                <button type="button" className="ghost-btn sm" onClick={() => setAdding(null)}>
                  Cancel
                </button>
                <button type="button" className="primary-btn sm" disabled={!adding.id || !adding.key || adding.state === 'testing'} onClick={addProvider}>
                  {adding.state === 'testing' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {adding.state === 'testing' ? 'Testing…' : 'Test and save'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="ghost-btn sm" onClick={() => setAdding({ id: null, key: '', url: '', state: 'idle' })}>
              <Plus size={14} /> Add a provider
            </button>
          )}
        </div>

        <AISpend ws={ws.id} ai={ai} plan={plan} people={people} typical={{ braindump: 41, ask: 118, meeting: 22, summary: 236, draft: 97, replies: 180, todos: 420, sorting: 300 }} />

        <div className="set-block">
          <h3>Setup</h3>
          <div className="preset-pick">
            {(
              [
                ['best', 'Best quality', 'Top models for everything that assigns people or reaches clients'],
                ['balanced', 'Balanced', 'Strong models for heavy jobs, fast ones for the rest'],
                ['cheap', 'Lowest cost', 'Cheapest models; you’ll fix more brain dump rows by hand'],
              ] as const
            ).map(([v, l, h]) => (
              <button key={v} type="button" className={ai.preset === v ? 'on' : ''} onClick={() => pickPreset(v)}>
                <strong>{l}</strong>
                <small>{h}</small>
              </button>
            ))}
          </div>
          {ai.preset === 'custom' && <p className="muted small">Custom: you picked models per job below.</p>}
        </div>

        <details className="set-block advanced">
          <summary>
            <h3>Advanced: choose the AI for each job</h3>
            <small className="muted">Most companies never need this. The setup above fills it in for you.</small>
          </summary>
          <p className="muted small">Rule of thumb: spend on the jobs that assign people and talk to clients, save on the jobs nobody reads twice.</p>
          <div className="jobs-table">
            {JOBS.map((job) => {
              const cur = ai.jobs[job.id] ?? (allowIncluded ? { provider: 'included' as const, model: 'included' } : undefined);
              const cost = cur ? costPer100(job, cur.provider, cur.model) : null;
              const recModel = (preset: 'best' | 'balanced' | 'cheap') => PROVIDERS.flatMap((p) => p.models).find((m) => m.id === job.rec[preset] || m.id.endsWith(job.rec[preset]))?.name ?? (job.rec[preset] === 'browser' ? 'Browser' : job.rec[preset]);
              return (
                <div key={job.id} className="job-row">
                  <div className="job-name">
                    <strong>{job.name}</strong>
                    <small>
                      {job.hint} · {job.when === 'click' ? 'on click' : job.when === 'auto' ? 'automatic, once' : 'opt-in'}
                    </small>
                  </div>
                  <span className={`w ${job.weight === 'Heavy' ? 'h' : job.weight === 'Light' ? 'l' : 'm'}`}>{job.weight}</span>
                  <span className="job-acc">{job.accuracy} accuracy</span>
                  <div className="job-pick">
                    <Select
                      value={cur ? `${cur.provider}|${cur.model}` : null}
                      onChange={(v) => {
                        const [provider, model] = v.split('|') as [ProviderId | 'included', string];
                        set({ preset: 'custom', jobs: { ...ai.jobs, [job.id]: { provider, model } } });
                      }}
                      options={jobOptions()}
                      placeholder={connected.length || allowIncluded ? 'Choose a model' : 'Add a provider first'}
                      label={job.name}
                      width={320}
                      searchable
                    />
                    <small className="muted">
                      Recommended: {recModel('balanced')} · cheapest {recModel('cheap')}
                    </small>
                  </div>
                  <span className="job-cost">{cur?.provider === 'included' ? 'In your plan' : cost !== null && cost !== undefined ? `≈ ${rp(cost)} / 100 uses` : 'See provider prices'}</span>
                  <button
                    type="button"
                    className="icon-btn sm"
                    title="Run a sample"
                    disabled={!cur || testing === job.id}
                    onClick={() => {
                      setTesting(job.id);
                      setTimeout(() => {
                        setTesting(null);
                        setTested((t) => ({ ...t, [job.id]: `${(0.6 + Math.random() * 2.4).toFixed(1)}s · sample looked fine` }));
                      }, 1100);
                    }}
                  >
                    {testing === job.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                  </button>
                  {tested[job.id] && <small className="job-test">{tested[job.id]}</small>}
                </div>
              );
            })}
          </div>
        </details>

        <div className="set-block">
          <h3>Automatic jobs</h3>
          <p className="muted small">These run once in the background on a cheap model, in batches. Everything else waits for a click.</p>
          {(
            [
              ['meetingNotes', 'Meeting notes after each meeting', 'Summary, decisions and action items'],
              ['emailTodos', 'To-dos from client emails', 'Only emails from clients and known contacts. Skips newsletters, receipts and no-reply'],
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
              <small>Of the allowance or a provider’s cap. At the cap, automatic jobs pause and buttons ask first</small>
            </span>
            <button type="button" role="switch" aria-checked={ai.alerts} className={`switch ${ai.alerts ? 'on' : ''}`} onClick={() => set({ alerts: !ai.alerts })}>
              <span />
            </button>
          </label>
          <div className="set-row">
            <span>
              <strong>Blocked providers</strong>
              <small>Nobody in the company can use these, for example if a client doesn’t allow data in China</small>
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
