import { useEffect, useState } from 'react';
import { term, brand as product } from '../../terms';
import { server } from '../../sync';
import { AISpend } from './AISpend';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Play, Plus, ShieldOff, Sparkles, Trash2 } from 'lucide-react';
import type { AIJobId, AISettings, ProviderConn, ProviderId, User, Workspace } from '../../types';
import { CRED_FIELDS, JOBS, PROVIDERS, costPer100, presetJobs, providerOf } from '../../data/aiCatalog';
import { ALLOWANCE, TOP_UP, planName, rp, seatsFor } from '../../data/pricing';
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

type RoutePick = { provider: string; providerName: string; model: string; modelName: string; warn: string | null };
/** What the server says about this company and our AI (GET /api/ai/plan). */
interface PlanView {
  eligible: boolean;
  why: 'plan' | 'trial' | 'comp' | null;
  until: string | null;
  route: { job: string; name: string; run: RoutePick | null; backup: RoutePick | null }[];
  allowance: { unlimited: boolean; share: number; left: Record<string, number | null>; pool: Record<string, number>; uses: Record<string, number>; seats: number; topUps: number; resets: string } | null;
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
  const [adding, setAdding] = useState<{ id: ProviderId | null; key: string; url: string; fields?: Record<string, string>; state: 'idle' | 'testing' | 'error'; message?: string } | null>(null);
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
    const save = (keyLast4: string) => {
      const conn: ProviderConn = { id: adding.id!, keyLast4, addedAt: new Date().toISOString(), addedBy: me, status: 'ok', baseUrl: url || undefined, spentUsd: 0 };
      const providers = [...ai.providers.filter((p) => p.id !== conn.id), conn];
      const jobs = ai.preset === 'custom' ? ai.jobs : presetJobs(ai.preset === 'best' ? 'best' : ai.preset === 'cheap' ? 'cheap' : 'balanced', providers.map((p) => p.id), allowIncluded);
      onAI({ ...ai, providers, jobs, payer: ai.payer === 'sprint2go' ? 'both' : ai.payer });
      setAdding(null);
      toast(`${info.name} connected. The key is encrypted and only the last 4 characters are kept`);
    };
    // With the local server the key is tested with a tiny real request, then stored encrypted there.
    if (!server.on) return void setTimeout(() => save((cred ? fields.accessKeyId || fields.apiKey || '····' : key).slice(-4)), 900);
    void fetch('/api/ai/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, provider: adding.id, key, baseUrl: url || undefined }) })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { keyLast4?: string; error?: string };
        if (r.ok && d.keyLast4) save(d.keyLast4);
        else setAdding((a) => a && { ...a, state: 'error', message: d.error });
      })
      .catch(() => setAdding((a) => a && { ...a, state: 'error', message: 'Could not reach the server.' }));
  };

  const jobOptions = (): Option[] => [
    ...(allowIncluded ? [{ value: 'included|included', label: `${product.name} (included in your plan)`, group: 'Included', icon: <Sparkles size={14} /> }] : []),
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
  // With the server: this month's real uses and what's left of the shared allowance. Without one: the demo's sample.
  const allowance = view?.allowance;
  const usedShare = allowance ? allowance.share : Math.min(0.95, usage.reduce((s, [, n, k]) => s + n / (pool[k] || 1), 0) / usage.length);
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
            {allowance?.unlimited ? null : (
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
            <div className="usage-grid">
              {usage.map(([l, n, k]) => (
                <div key={k}>
                  <b>{allowance ? allowance.uses[k] ?? 0 : n}</b>
                  <span>{allowance ? (k === 'meeting' ? 'Meetings with notes' : l) : l} {allowance ? <em>this month</em> : <em>of {pool[k]}</em>}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="set-block">
          <h3>{ai.payer === 'sprint2go' ? 'Providers' : 'Your AI keys'}</h3>
          {ai.providers.length === 0 && <p className="muted small">No keys yet. {included && ai.payer !== 'own' ? `${product.name}’s AI is used for everything.` : 'Add a key to switch the AI on, then pick which model does each job below.'}</p>}
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
                    {(() => {
                      const uses = JOBS.filter((j) => ai.jobs[j.id]?.provider === c.id);
                      return (
                        <span className="prov-uses">
                          {uses.length ? (
                            <>
                              Used for{' '}
                              {uses.map((j) => (
                                <em key={j.id}>{j.name}</em>
                              ))}
                            </>
                          ) : (
                            <span className="muted">Not used for any job yet. Pick it below.</span>
                          )}
                        </span>
                      );
                    })()}
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
                        const refill = presetJobs(ai.preset === 'custom' ? 'balanced' : ai.preset, providers.filter((x) => x.status === 'ok').map((x) => x.id), allowIncluded);
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
                  {providerOf(adding.id)!.needsUrl && <input value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} placeholder={adding.id === 'custom' ? 'https://ai.your-server.com/v1' : 'Endpoint'} />}
                  <input type="password" autoComplete="off" value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value, state: 'idle' })} placeholder={providerOf(adding.id)!.keyHint} />
                  {adding.state === 'error' && <p className="err">{adding.message ?? `That doesn’t look like a valid key${providerOf(adding.id)!.needsUrl ? ' and address' : ''}.`}</p>}
                </>
              )}
              {adding.id && (
                <>
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

        {(() => {
          const own = ai.payer !== 'sprint2go';
          const row = (job: (typeof JOBS)[number]) => {
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
                <div className="job-pick">
                  <Select
                    value={cur ? `${cur.provider}|${cur.model}` : null}
                    onChange={(v) => {
                      const [provider, model] = v.split('|') as [ProviderId | 'included', string];
                      set({ preset: 'custom', jobs: { ...ai.jobs, [job.id]: { provider, model } } });
                    }}
                    options={jobOptions().filter((o) => (job.id === 'speech' ? providerOf(String(o.value).split('|')[0] as ProviderId)?.kind === 'speech' || String(o.value).startsWith('custom|browser') : !String(o.value).startsWith('custom|browser') && providerOf(String(o.value).split('|')[0] as ProviderId)?.kind !== 'speech'))}
                    placeholder={connected.length || allowIncluded ? 'Choose a model' : 'Add a key first'}
                    label={job.name}
                    width={320}
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
                <span className="job-cost">{cur?.provider === 'included' ? 'In your plan' : cost !== null && cost !== undefined ? `≈ ${rp(cost)} / 100 uses` : cur ? 'See provider prices' : ''}</span>
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
          };
          const groups: [string, AIJobId[]][] = [
            ['Meetings', ['meeting', 'speech']],
            ['Asking and planning', ['ask', 'braindump']],
            ['Email', ['draft', 'summary', 'replies', 'todos']],
            ['Behind the scenes', ['sorting', 'digest', 'translate']],
          ];
          const textModels = jobOptions().filter((o) => !String(o.value).startsWith('custom|browser') && providerOf(String(o.value).split('|')[0] as ProviderId)?.kind !== 'speech');
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
                {textModels.length > 0 && (
                  <Select<string>
                    value={null}
                    onChange={(v) => {
                      const [provider, model] = v.split('|') as [ProviderId | 'included', string];
                      const jobs = { ...ai.jobs };
                      for (const j of JOBS) if (j.id !== 'speech') jobs[j.id] = { provider, model };
                      set({ preset: 'custom', jobs });
                      toast(`Every text job now uses ${textModels.find((o) => o.value === v)?.label ?? 'that model'}`);
                    }}
                    options={textModels}
                    placeholder="One model for everything…"
                    label="One model for everything"
                    className="sel-flat"
                    width={300}
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
              <p className="muted small">Spend on the jobs that assign people and talk to {term.whos}; save on the ones nobody reads twice. Each job only uses the key you pick for it.</p>
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
              <small>Of the allowance or a provider’s cap. At the cap, automatic jobs pause and buttons ask first</small>
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
