import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, KeyRound, Plus, RotateCcw, Sparkles, TrendingDown } from 'lucide-react';
import { Select, type Option } from '../../components/ui/Select';
import { CRED_FIELDS } from '../../data/aiCatalog';
import { ApiError, day, post, rel, rp, rpShort } from '../api';
import { Badge, Confirm, Dialog, Empty, Failed, Field, Loading, Menu, MoneyInput, Page, Section, Stat, Stats, Tabs, useAct, useAdmin, useApi } from '../ui';

interface Choice {
  provider: string;
  model: string;
}
interface Opt extends Choice {
  providerName: string;
  name: string;
  price: [number, number] | null;
  hasKey: boolean;
}
interface KeyRow {
  id: string;
  provider: string;
  name: string;
  source: 'saved' | 'server';
  last4: string;
  on: boolean;
  inUse: boolean;
  baseUrl: string | null;
  addedBy: string | null;
  addedAt: string | null;
  jobs: string[];
  testedAt: string | null;
  testOk: boolean | null;
  testError: string | null;
  usedAt: string | null;
  failedAt: string | null;
  failError: string | null;
}
interface JobRow {
  id: string;
  name: string;
  hint: string;
  primary: Choice;
  fallback: Choice | null;
  state: 'ok' | 'fallback' | 'none';
  per100: number | null;
  isDefault: boolean;
}
interface PriceRow {
  model: string;
  name: string;
  providers: string[];
  price: [number, number] | null;
  own: [number, number] | null;
  catalog: [number, number] | null;
  usedBy: string[];
}
interface Money {
  month: string;
  elapsed: number;
  daysLeft: number;
  companies: number;
  earned: number;
  cost: number;
  forecast: number;
  margin: number;
  losing: { id: string; name: string; plan: string; earned: number; cost: number; forecast: number }[];
  other: { id: string; name: string; why: 'trial' | 'comp' | 'internal' | 'other'; cost: number }[];
  otherCost: number;
  jobs: { job: string; name: string; uses: number; cost: number; perUse: number; models: string[] }[];
  unpriced: { model: string; name: string; uses: number }[];
}
interface AIData {
  can: boolean;
  verdict: { tone: 'good' | 'warn' | 'bad' | 'neutral'; text: string };
  money: Money;
  keys: KeyRow[];
  providers: { id: string; name: string; kind: string; keyHint: string; needsUrl: boolean; warn: string | null; supported: boolean; why: string | null; saved: boolean }[];
  jobs: JobRow[];
  options: { text: Opt[]; speech: Opt[] };
  prices: PriceRow[];
  rate: number;
  defaultRate: number;
  problems: { kind: string; text: string; level: 'high' | 'normal'; to: string }[];
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
const list = (xs: string[], max = 3) => (xs.length <= max ? xs.join(xs.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, ' and $1') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** A job's name inside a sentence: "brain dump & briefs", but "Ask AI" stays a name. */
const jobWord = (name: string) => (/^Ask AI/.test(name) ? name : lower(name));
/** The company behind a provider, for its mark: "Claude (Anthropic)" is A. */
const markOf = (name: string) => (name.match(/\(([^)]+)\)/)?.[1] ?? name).charAt(0);

/** Operator console, AI: our keys, the model for each job, the price list, and whether the AI plan pays for itself. */
export function AIPage({ tab }: { tab: string }) {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<AIData>('ai');
  const keyIssues = data?.problems.filter((p) => p.to === '/admin/ai/keys').length ?? 0;
  const priceIssues = data ? data.problems.filter((p) => p.to === '/admin/ai/prices').length : 0;
  return (
    <Page title="AI" sub="Our keys, the model for each job, and whether the AI plan pays for itself. Only AI-plan companies, trials and free months use our keys.">
      <Tabs
        value={tab}
        onChange={(t) => go(`/admin/ai/${t}`)}
        items={[
          { id: 'margin', label: 'Margin' },
          { id: 'keys', label: 'Our keys', count: keyIssues },
          { id: 'models', label: 'Models per job' },
          { id: 'prices', label: 'Prices', count: priceIssues },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {error ? <Failed error={error} retry={reload} /> : !data ? <Loading rows={6} /> : tab === 'keys' ? <Keys d={data} reload={reload} /> : tab === 'models' ? <Models d={data} reload={reload} /> : tab === 'prices' ? <Prices d={data} reload={reload} /> : <Margin d={data} />}
      </div>
    </Page>
  );
}

/* ---------- margin: lead with the verdict ---------- */

const WHY_LABEL = { trial: 'Trial', comp: 'Free months', internal: 'Ours', other: 'Not on the AI plan' } as const;
function Margin({ d }: { d: AIData }) {
  const { go } = useAdmin();
  const m = d.money;
  const down = d.problems.find((p) => p.kind === 'ai-keys');
  const [y, mo] = m.month.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const today = Math.min(days, days - m.daysLeft + 1);
  const VerdictIcon = d.verdict.tone === 'good' ? CheckCircle2 : d.verdict.tone === 'neutral' ? Sparkles : TrendingDown;
  return (
    <>
      {down && (
        <div className="adm-banner bad">
          <AlertTriangle size={16} />
          <span>{down.text}</span>
          <button className="ghost-btn sm" onClick={() => go('/admin/ai/keys')}>
            Add a key
          </button>
        </div>
      )}
      <div className={`adm-banner ${d.verdict.tone === 'neutral' ? 'note' : d.verdict.tone} adm-ai-verdict`}>
        <VerdictIcon size={18} />
        <span>{d.verdict.text}</span>
      </div>
      {(m.companies > 0 || m.cost > 0) && (
        <Stats>
          <Stat i={0} label="The AI plan earns" value={rpShort(m.earned)} hint={`this month, from ${m.companies} paying ${m.companies === 1 ? 'company' : 'companies'}`} />
          <Stat i={1} label="Their AI cost so far" value={rpShort(m.cost)} hint={`day ${today} of ${days}`} />
          <Stat i={2} label="By the end of the month" value={rpShort(m.forecast)} hint="at the pace so far" />
          <Stat
            i={3}
            label="Margin"
            value={m.margin < 0 ? `−${rpShort(-m.margin)}` : rpShort(m.margin)}
            tone={m.margin < 0 ? 'bad' : undefined}
            hint={!m.earned ? 'nothing earned yet' : m.margin >= 0 ? `${Math.round((m.margin / m.earned) * 100)}% of what it earns` : `AI costs ${(m.forecast / m.earned).toLocaleString('id-ID', { maximumFractionDigits: 1 })}× what it earns`}
          />
        </Stats>
      )}
      {m.losing.length > 0 && (
        <Section title="Costing more than they pay" hint="At the pace so far this month">
          <div className="adm-mini-list">
            {m.losing.map((c) => (
              <button key={c.id} type="button" className="adm-ai-line" onClick={() => go(`/admin/companies/${c.id}`)}>
                <span className="grow adm-ai-two">
                  <strong>{c.name}</strong>
                  <small>
                    {c.plan} · pays {rp(c.earned)} for AI, AI heading for {rp(c.forecast)}
                  </small>
                </span>
                <Badge tone="bad">{rpShort(c.forecast - c.earned)} short</Badge>
              </button>
            ))}
          </div>
        </Section>
      )}
      {m.unpriced.length > 0 && (
        <div className="adm-banner warn">
          <AlertTriangle size={16} />
          <span>
            {list(m.unpriced.map((u) => u.name))} ran {m.unpriced.reduce((n, u) => n + u.uses, 0).toLocaleString('id-ID')} times this month without a price, so that cost isn’t counted above.
          </span>
          <button className="ghost-btn sm" onClick={() => go('/admin/ai/prices')}>
            Add prices
          </button>
        </div>
      )}
      {m.jobs.length > 0 && (
        <Section title="Cost per job" hint="This month, everyone on our AI">
          <div className="adm-mini-list">
            {m.jobs.map((j) => (
              <div key={j.job} className="adm-mini-row">
                <span className="grow adm-ai-two">
                  <strong>{j.name}</strong>
                  <small>
                    {j.uses.toLocaleString('id-ID')} {j.uses === 1 ? 'use' : 'uses'} · {j.models.join(', ')}
                    {j.cost > 0 ? ` · ${rp(j.perUse)} each` : ''}
                  </small>
                </span>
                <span className="adm-num-r">{j.cost > 0 ? rp(j.cost) : <span className="muted">no price</span>}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {m.other.length > 0 && (
        <Section title="Not paying for AI yet" hint={`${rp(m.otherCost)} of AI this month with nothing earned`}>
          <div className="adm-mini-list">
            {m.other.map((c) => (
              <button key={c.id} type="button" className="adm-ai-line" onClick={() => go(`/admin/companies/${c.id}`)}>
                <span className="grow">
                  <strong>{c.name}</strong>
                </span>
                <Badge tone={c.why === 'trial' ? 'accent' : 'neutral'}>{WHY_LABEL[c.why]}</Badge>
                <span className="adm-num-r">{rp(c.cost)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/* ---------- our keys ---------- */

function Keys({ d, reload }: { d: AIData; reload: () => void }) {
  const { toast } = useAdmin();
  const act = useAct();
  const [adding, setAdding] = useState<{ provider: string | null; rotate?: boolean } | null>(null);
  const [removing, setRemoving] = useState<KeyRow | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const jobName = (id: string) => d.jobs.find((j) => j.id === id)?.name ?? id;
  // Providers a job is set to use, with no key that's on: what to add next.
  const needed = useMemo(() => {
    const out = new Map<string, { name: string; jobs: string[] }>();
    const allOpts = [...d.options.text, ...d.options.speech];
    for (const j of d.jobs)
      for (const c of [j.primary, j.fallback]) {
        if (!c) continue;
        const o = allOpts.find((x) => x.provider === c.provider && x.model === c.model);
        if (!o || o.hasKey) continue;
        const cur = out.get(c.provider) ?? { name: o.providerName, jobs: [] };
        if (!cur.jobs.includes(j.name)) cur.jobs.push(j.name);
        out.set(c.provider, cur);
      }
    return Array.from(out, ([id, v]) => ({ id, ...v }));
  }, [d]);
  const test = (k: KeyRow) => {
    setTesting(k.id);
    void post<{ ok: boolean; error: string | null }>('ai/key/test', { provider: k.provider, source: k.source })
      .then((r) => toast(r.ok ? `${k.name} key works` : `${k.name} key failed: ${r.error}`), (e: Error) => toast(e.message))
      .finally(() => (setTesting(null), reload()));
  };
  return (
    <>
      <Section
        title="Our keys"
        hint="Encrypted on the server; only the last 4 characters come back"
        actions={
          d.can && (
            <button className="primary-btn sm" onClick={() => setAdding({ provider: null })}>
              <Plus size={13} /> Add a key
            </button>
          )
        }
      >
        {d.keys.length === 0 ? (
          <Empty title="No keys yet" text="AI-plan companies can’t use AI until a job has a working key. Start with the provider most jobs use." />
        ) : (
          <div className="adm-mini-list">
            {d.keys.map((k) => {
              const failing = !!k.failedAt && (!k.usedAt || k.failedAt > k.usedAt);
              const state = !k.on ? 'Switched off' : k.source === 'server' && !k.inUse ? 'Standby: the saved Claude key goes first' : failing ? `Failed ${rel(k.failedAt!)}: ${k.failError}` : k.usedAt ? `Last answered ${rel(k.usedAt)}` : 'Not used yet';
              const tested = k.testedAt ? (k.testOk ? `tested ${rel(k.testedAt)}` : `test failed ${rel(k.testedAt)}: ${k.testError}`) : null;
              return (
                <div key={k.id} className={`adm-mini-row adm-ai-key ${leaving === k.id ? 'leaving' : ''} ${k.on ? '' : 'off'}`}>
                  <span className="adm-ai-mark" aria-hidden>
                    {markOf(k.name)}
                  </span>
                  <span className="grow adm-ai-two">
                    <strong>
                      {k.name} <span className="adm-ai-last4">•••• {k.last4}</span>
                      {k.source === 'server' && <Badge tone="info">From the server settings</Badge>}
                    </strong>
                    <small className={failing && k.on ? 'adm-ai-bad' : ''}>
                      {state}
                      {tested ? ` · ${tested}` : ''}
                    </small>
                    <small>
                      {k.jobs.length ? `Picked for ${list(k.jobs.map((j) => jobWord(jobName(j))))}` : 'Not picked for any job'}
                      {k.addedBy ? ` · added by ${k.addedBy.split(' ')[0]} ${day(k.addedAt)}` : ''}
                    </small>
                  </span>
                  {d.can && (
                    <span className="adm-ai-acts">
                      <button className="ghost-btn sm" disabled={testing === k.id} onClick={() => test(k)}>
                        {testing === k.id ? 'Testing…' : 'Test'}
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={k.on}
                        aria-label={`${k.name} key ${k.on ? 'on' : 'off'}`}
                        title={k.on ? 'Switch off' : 'Switch on'}
                        className={`switch ${k.on ? 'on' : ''}`}
                        onClick={() => void act(() => post('ai/key/switch', { provider: k.provider, source: k.source, on: !k.on }), k.on ? `${k.name} key switched off` : `${k.name} key switched on`)}
                      >
                        <span />
                      </button>
                      {k.source === 'saved' && (
                        <Menu
                          label="More"
                          items={[
                            { label: 'Replace the key', hint: 'Test a new one, then swap', run: () => setAdding({ provider: k.provider, rotate: true }) },
                            { label: 'Remove', danger: true, run: () => setRemoving(k) },
                          ]}
                        />
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {d.keys.some((k) => k.source === 'server') && <p className="adm-note">The key from the server settings (ANTHROPIC_API_KEY) can be tested and switched off here. To remove it, take it out of the server settings; a saved Claude key goes first anyway.</p>}
      </Section>
      {needed.length > 0 && (
        <Section title="Picked for a job, but no key" hint="Those jobs use their fallback, or don’t run">
          <div className="adm-mini-list">
            {needed.map((n) => (
              <div key={n.id} className="adm-mini-row">
                <KeyRound size={15} />
                <span className="grow adm-ai-two">
                  <strong>{n.name}</strong>
                  <small>For {list(n.jobs.map(jobWord))}</small>
                </span>
                {d.can &&
                  (d.keys.some((k) => k.provider === n.id && k.source === 'saved' && !k.on) ? (
                    <button className="ghost-btn sm" onClick={() => void act(() => post('ai/key/switch', { provider: n.id, source: 'saved', on: true }), `${n.name} key switched on`)}>
                      Switch on
                    </button>
                  ) : (
                    <button className="ghost-btn sm" onClick={() => setAdding({ provider: n.id })}>
                      Add key
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </Section>
      )}
      {adding && (
        <AddKey
          d={d}
          initial={adding.provider}
          rotate={!!adding.rotate}
          onClose={() => setAdding(null)}
          onDone={(text) => {
            setAdding(null);
            toast(text);
            reload();
          }}
        />
      )}
      {removing && (
        <Confirm
          title={`Remove the ${removing.name} key?`}
          text={removing.jobs.length ? `${list(removing.jobs.map(jobName))} will use their fallback, or stop for AI-plan companies until there’s another key.` : 'No job uses it right now.'}
          action="Remove key"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const k = removing;
            const done = await act(() => post('ai/key/remove', { provider: k.provider }));
            setRemoving(null);
            if (!done) return;
            setLeaving(k.id);
            toast(`${k.name} key removed`);
            setTimeout(() => (setLeaving(null), reload()), 200);
          }}
        />
      )}
    </>
  );
}

function AddKey({ d, initial, rotate, onClose, onDone }: { d: AIData; initial: string | null; rotate: boolean; onClose: () => void; onDone: (text: string) => void }) {
  const [provider, setProvider] = useState<string | null>(initial);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = d.providers.find((p) => p.id === provider);
  const cred = provider ? CRED_FIELDS[provider as keyof typeof CRED_FIELDS] : undefined;
  const ready = !!info && (cred ? cred.fields.every((f) => f.optional || fields[f.key]?.trim()) : key.trim().length >= 8 && (!info.needsUrl || !!url.trim()));
  const KIND = { direct: 'Direct', gateway: 'One key, many models', cloud: 'Cloud account', private: 'Private', speech: 'Speech to text' } as Record<string, string>;
  const options: Option[] = d.providers.filter((p) => p.supported).map((p) => ({ value: p.id, label: p.name, hint: p.saved ? 'has a key' : undefined, group: KIND[p.kind] ?? p.kind }));
  const save = () => {
    if (!ready || !info) return;
    setBusy(true);
    setErr(null);
    const packed = cred ? JSON.stringify(Object.fromEntries(cred.fields.map((f) => [f.key, (fields[f.key] ?? '').trim()]))) : key.trim();
    void post<{ last4: string }>('ai/key', { provider, key: packed, baseUrl: cred ? (fields[cred.url] ?? '').trim() || undefined : url.trim() || undefined })
      .then((r) => onDone(`${info.name} key ${rotate ? 'replaced' : 'added'} (•••• ${r.last4}). It worked on a test call.`), (e: ApiError) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog
      title={rotate && info ? `Replace the ${info.name} key` : 'Add a key'}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!ready || busy} onClick={save}>
            {busy ? 'Testing…' : 'Test and save'}
          </button>
        </>
      }
    >
      <form
        className="adm-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!rotate && (
          <Field label="Provider">
            <Select value={provider} options={options} onChange={(v) => (setProvider(v), setErr(null), setFields({}), setKey(''), setUrl(''))} placeholder="Choose a provider" label="Provider" searchable width={340} />
          </Field>
        )}
        {info?.warn && (
          <p className="adm-ai-warn">
            <AlertTriangle size={14} /> {info.warn}
          </p>
        )}
        {info && cred && (
          <>
            {cred.fields.map((f) => (
              <Field key={f.key} label={f.label + (f.optional ? ' (optional)' : '')}>
                {f.multiline ? (
                  <textarea rows={5} spellCheck={false} autoComplete="off" value={fields[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => (setFields({ ...fields, [f.key]: e.target.value }), setErr(null))} className="adm-ai-secret-area" />
                ) : (
                  <input type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={fields[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => (setFields({ ...fields, [f.key]: e.target.value }), setErr(null))} />
                )}
              </Field>
            ))}
            <p className="adm-note">{cred.help}</p>
          </>
        )}
        {info && !cred && (
          <>
            {info.needsUrl && (
              <Field label="Address" hint="Must start with https://">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" />
              </Field>
            )}
            <Field label="Key" hint={info.keyHint}>
              <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => (setKey(e.target.value), setErr(null))} autoFocus={rotate} />
            </Field>
          </>
        )}
        {err && <p className="err">{err}</p>}
        {info && <p className="adm-note">We send one tiny request with it first. It’s saved only if that works, encrypted, and only the last 4 characters are shown again.</p>}
      </form>
    </Dialog>
  );
}

/* ---------- the model for each job ---------- */

const GROUPS: [string, string[]][] = [
  ['Meetings', ['meeting', 'speech']],
  ['Asking and planning', ['ask', 'braindump']],
  ['Email', ['draft', 'summary', 'replies', 'todos']],
  ['Behind the scenes', ['sorting', 'digest', 'translate']],
];
function Models({ d, reload }: { d: AIData; reload: () => void }) {
  const act = useAct();
  const opts = (speech: boolean): Option[] =>
    (speech ? d.options.speech : d.options.text).map((o) => ({
      value: `${o.provider}|${o.model}`,
      label: o.name,
      hint: !o.hasKey ? 'no key yet' : speech ? undefined : o.price ? `${usd(o.price[0])} / ${usd(o.price[1])}` : 'no price yet',
      group: o.providerName,
      keywords: o.providerName,
    }));
  const pick = (v: string): Choice => {
    const [provider, model] = v.split('|');
    return { provider, model };
  };
  const save = (j: JobRow, primary: Choice, fallback: Choice | null) => void act(() => post('ai/job', { job: j.id, primary, fallback }), `${j.name}: saved`).then(reload);
  // The chosen model with its provider: the same model is sold by several gateways.
  const shown = (o: Option | undefined) => (
    <>
      <span className="sel-text">
        {o?.label ?? 'Choose'}
        {o?.group && <em className="adm-ai-selprov"> · {o.group.match(/\(([^)]+)\)/)?.[1] ?? o.group}</em>}
      </span>
      <ChevronDown size={14} className="sel-chev" />
    </>
  );
  const custom = d.jobs.some((j) => !j.isDefault);
  return (
    <Section
      title="Which model does each job"
      hint="For AI-plan companies. The fallback takes over when the first one fails or has no key."
      actions={
        d.can &&
        custom && (
          <button className="ghost-btn sm" onClick={() => void act(() => post('ai/jobs/reset'), 'Every job is back on the recommended models').then(reload)}>
            <RotateCcw size={13} /> Back to recommended
          </button>
        )
      }
    >
      <div className="adm-ai-groups">
        {GROUPS.map(([g, ids]) => (
          <div key={g} className="adm-ai-group">
            <h3>{g}</h3>
            <div className="adm-mini-list">
              {ids.map((id) => {
                const j = d.jobs.find((x) => x.id === id);
                if (!j) return null;
                const o = opts(j.id === 'speech');
                return (
                  <div key={j.id} className="adm-mini-row adm-ai-job">
                    <span className="adm-ai-two adm-ai-job-name">
                      <strong>{j.name}</strong>
                      <small>{j.hint}</small>
                    </span>
                    <span className="adm-ai-pick">
                      <small>First</small>
                      <Select className="sel-flat" value={`${j.primary.provider}|${j.primary.model}`} options={o} onChange={(v) => save(j, pick(v), j.fallback)} renderValue={shown} disabled={!d.can} searchable width={320} label={`${j.name}: first choice`} title={`${j.name}: first choice`} />
                    </span>
                    <span className="adm-ai-pick">
                      <small>If it fails</small>
                      <Select
                        className="sel-flat"
                        value={j.fallback ? `${j.fallback.provider}|${j.fallback.model}` : 'none'}
                        options={[{ value: 'none', label: 'No fallback' }, ...o.filter((x) => x.value !== `${j.primary.provider}|${j.primary.model}`)]}
                        onChange={(v) => save(j, j.primary, v === 'none' ? null : pick(v))}
                        renderValue={shown}
                        disabled={!d.can}
                        searchable
                        width={320}
                        label={`${j.name}: fallback`}
                        title={`${j.name}: fallback`}
                      />
                    </span>
                    <span className="adm-ai-job-state">
                      {j.state === 'none' ? (
                        <Badge tone="bad">No key</Badge>
                      ) : j.state === 'fallback' ? (
                        <Badge tone="warn">Fallback in use</Badge>
                      ) : j.id === 'speech' ? (
                        <small>per audio minute, not counted yet</small>
                      ) : j.per100 !== null ? (
                        <small>{j.id === 'meeting' ? `≈ ${rp(j.per100 / 100)} per meeting hour` : `≈ ${rp(j.per100)} per 100 uses`}</small>
                      ) : (
                        <Badge tone="warn">No price</Badge>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- prices and the dollar rate ---------- */

type Draft = { rate: number; prices: Record<string, [string, string]> };
const draftOf = (d: AIData): Draft => ({ rate: d.rate, prices: Object.fromEntries(d.prices.map((p) => [p.model, p.price ? [String(p.price[0]), String(p.price[1])] : ['', '']])) });
function Prices({ d, reload }: { d: AIData; reload: () => void }) {
  const act = useAct();
  const [draft, setDraft] = useState<Draft>(() => draftOf(d));
  useEffect(() => setDraft(draftOf(d)), [d]);
  const base = useMemo(() => draftOf(d), [d]);
  const changed = JSON.stringify(draft) !== JSON.stringify(base);
  const jobName = (id: string) => d.jobs.find((j) => j.id === id)?.name ?? id;
  // Models a job uses first; otherwise the catalogue's order, so nothing moves when a price is filled in.
  const rows = [...d.prices].sort((a, b) => Number(b.usedBy.length > 0) - Number(a.usedBy.length > 0));
  const custom = d.prices.some((p) => p.own) || d.rate !== d.defaultRate;
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const save = () => {
    const prices: Record<string, [number, number] | null> = {};
    for (const [model, [i, o]] of Object.entries(draft.prices)) {
      if (JSON.stringify(base.prices[model]) === JSON.stringify([i, o])) continue;
      const a = num(i);
      const b = num(o);
      prices[model] = a !== null && b !== null && a >= 0 && b >= 0 ? [a, b] : null;
    }
    void act(() => post('ai/prices', { prices, rate: draft.rate }), 'Prices saved: costs and allowances use them now').then(reload);
  };
  return (
    <>
      <Section
        title="Dollar rate"
        hint="Every cost in rupiah uses it"
        actions={
          d.can &&
          custom && (
            <button className="ghost-btn sm" onClick={() => void act(() => post('ai/prices/reset'), 'Back to list prices and Rp 17.500').then(reload)}>
              <RotateCcw size={13} /> List prices
            </button>
          )
        }
      >
        <div className="adm-inline">
          <span>US$1 =</span>
          <span className="adm-ai-rate">
            <MoneyInput value={draft.rate} disabled={!d.can} onChange={(n) => setDraft({ ...draft, rate: n })} label="Rupiah per US dollar" />
          </span>
          <span className="muted">rupiah</span>
        </div>
      </Section>
      <Section title="Model prices" hint="US$ per million tokens. List prices to start with; change one when the bill says otherwise.">
        <div className="adm-ai-prices" role="table">
          <div className="adm-ai-price head" role="row">
            <span role="columnheader">Model</span>
            <span role="columnheader">In</span>
            <span role="columnheader">Out</span>
          </div>
          {rows.map((p) => {
            const [i, o] = draft.prices[p.model] ?? ['', ''];
            const missing = !p.price && p.usedBy.length > 0;
            return (
              <div key={p.model} className="adm-ai-price" role="row">
                <span className="adm-ai-two" role="cell">
                  <strong>
                    {p.name} {missing ? <Badge tone="warn">No price</Badge> : p.own && p.catalog ? <Badge>Changed</Badge> : null}
                  </strong>
                  <small>
                    {p.providers.join(', ')}
                    {p.usedBy.length ? ` · ${list(p.usedBy.map((j) => jobWord(jobName(j))), 2)}` : ''}
                    {p.own && p.catalog ? ` · list ${usd(p.catalog[0])} / ${usd(p.catalog[1])}` : ''}
                  </small>
                </span>
                <span role="cell" className="adm-ai-usd">
                  <input inputMode="decimal" value={i} placeholder="none" disabled={!d.can} aria-label={`${p.name} (${p.providers[0]}): US$ per million tokens in`} onChange={(e) => setDraft({ ...draft, prices: { ...draft.prices, [p.model]: [e.target.value.replace(/[^\d.,]/g, ''), o] } })} />
                </span>
                <span role="cell" className="adm-ai-usd">
                  <input inputMode="decimal" value={o} placeholder="none" disabled={!d.can} aria-label={`${p.name} (${p.providers[0]}): US$ per million tokens out`} onChange={(e) => setDraft({ ...draft, prices: { ...draft.prices, [p.model]: [i, e.target.value.replace(/[^\d.,]/g, '')] } })} />
                </span>
              </div>
            );
          })}
        </div>
      </Section>
      {d.can && (
        <div className={`adm-savebar ${changed ? 'show' : ''}`} aria-hidden={!changed}>
          <span>Unsaved prices</span>
          <button className="ghost-btn sm" onClick={() => setDraft(base)}>
            Undo
          </button>
          <button className="primary-btn sm" onClick={save}>
            Save
          </button>
        </div>
      )}
    </>
  );
}
