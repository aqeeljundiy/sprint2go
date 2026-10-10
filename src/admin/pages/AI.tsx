import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, KeyRound, Plus, RefreshCw, RotateCcw, Sparkles, TrendingDown } from 'lucide-react';
import { Select, type Option } from '../../components/ui/Select';
import { CRED_FIELDS, PROVIDERS } from '../../data/aiCatalog';
import { ApiError, STATE_LABEL, day, get, post, rel, rp, rpShort } from '../api';
import { Badge, Confirm, Dialog, Empty, Failed, Field, Loading, Menu, MoneyInput, Page, Section, Stat, Stats, Tabs, useAct, useAdmin, useApi } from '../ui';
import { t, tn, tx } from '../../i18n';
import { fmtList, fmtNumber, fmtPercent } from '../../i18n/format';

interface Choice {
  provider: string;
  model: string;
}
interface Opt extends Choice {
  providerName: string;
  name: string;
  price: [number, number] | null;
  hasKey: boolean;
  recommended?: boolean; // in our catalogue
  gone?: boolean; // the provider no longer offers it to our key
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
  gone: string | null; // "SumoPod no longer offers X."
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
  uses: number; // this month, by everyone (our keys and companies' own)
}
interface ListInfo {
  provider: string;
  name: string;
  source: 'live' | 'catalog';
  fetchedAt: string | null;
  note: string | null;
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
  unlimited?: { id: string; name: string; cost: number }[]; // the Whitelist: never in the verdict
  unlimitedCost?: number;
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
  lists: ListInfo[];
  prices: PriceRow[];
  rate: number;
  defaultRate: number;
  problems: { kind: string; text: string; level: 'high' | 'normal'; to: string }[];
}

const usd = (n: number) => `$${fmtNumber(n, { maximumFractionDigits: 4 })}`;
/** "a, b and c", or "a, b, c and 2 more" past `max`, in the console's language. */
const list = (xs: string[], max = 3) => (xs.length <= max ? fmtList(xs) : t('{names} and {n} more', { names: xs.slice(0, max).join(', '), n: xs.length - max }));
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** A job's name inside a sentence: "brain dump & briefs", but "Ask AI" (in either language) stays a name. */
const jobWord = (name: string) => (/^Ask AI/.test(name) || name.startsWith(t('Ask AI')) ? name : lower(name));
/** The company behind a provider, for its mark: "Claude (Anthropic)" is A. */
const markOf = (name: string) => (name.match(/\(([^)]+)\)/)?.[1] ?? name).charAt(0);

/** Operator console, AI: our keys, the model for each job, the price list, and whether the AI plan pays for itself. */
export function AIPage({ tab }: { tab: string }) {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<AIData>('ai');
  const keyIssues = data?.problems.filter((p) => p.to === '/admin/ai/keys').length ?? 0;
  const modelIssues = data?.problems.filter((p) => p.to === '/admin/ai/models').length ?? 0;
  const priceIssues = data ? data.problems.filter((p) => p.to === '/admin/ai/prices').length : 0;
  return (
    <Page title={t('AI')} sub={t('Our keys, the model for each job, and whether the AI plan pays for itself. Only AI-plan companies, trials and free months use our keys.')}>
      <Tabs
        value={tab}
        onChange={(id) => go(`/admin/ai/${id}`)}
        items={[
          { id: 'margin', label: t('Margin') },
          { id: 'keys', label: t('Our keys'), count: keyIssues },
          { id: 'models', label: t('Models per job'), count: modelIssues },
          { id: 'prices', label: t('Prices'), count: priceIssues },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {error ? <Failed error={error} retry={reload} /> : !data ? <Loading rows={6} /> : tab === 'keys' ? <Keys d={data} reload={reload} /> : tab === 'models' ? <Models d={data} reload={reload} /> : tab === 'prices' ? <Prices d={data} reload={reload} /> : <Margin d={data} />}
      </div>
    </Page>
  );
}

/* ---------- margin: lead with the verdict ---------- */

/** Why a company uses our AI without paying for it: getters, so each read gives the console's language. */
const WHY_LABEL: Record<'trial' | 'comp' | 'internal' | 'other', string> = {
  get trial() { return STATE_LABEL.trial; },
  get comp() { return STATE_LABEL.comp; },
  get internal() { return tx('company', 'Ours'); },
  get other() { return t('Not on the AI plan'); },
};
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
            {t('Add a key')}
          </button>
        </div>
      )}
      <div className={`adm-banner ${d.verdict.tone === 'neutral' ? 'note' : d.verdict.tone} adm-ai-verdict`}>
        <VerdictIcon size={18} />
        <span>{d.verdict.text}</span>
      </div>
      {(m.companies > 0 || m.cost > 0) && (
        <Stats>
          <Stat i={0} label={t('The AI plan earns')} value={rpShort(m.earned)} hint={tn(m.companies, 'this month, from {n} paying company', 'this month, from {n} paying companies')} />
          <Stat i={1} label={t('Their AI cost so far')} value={rpShort(m.cost)} hint={t('day {day} of {days}', { day: today, days })} />
          <Stat i={2} label={t('By the end of the month')} value={rpShort(m.forecast)} hint={t('at the pace so far')} />
          <Stat
            i={3}
            label={t('Margin')}
            value={m.margin < 0 ? `−${rpShort(-m.margin)}` : rpShort(m.margin)}
            tone={m.margin < 0 ? 'bad' : undefined}
            hint={!m.earned ? t('nothing earned yet') : m.margin >= 0 ? t('{share} of what it earns', { share: fmtPercent(m.margin / m.earned) }) : t('AI costs {times}× what it earns', { times: fmtNumber(m.forecast / m.earned, { maximumFractionDigits: 1 }) })}
          />
        </Stats>
      )}
      {m.losing.length > 0 && (
        <Section title={t('Costing more than they pay')} hint={t('At the pace so far this month')}>
          <div className="adm-mini-list">
            {m.losing.map((c) => (
              <button key={c.id} type="button" className="adm-ai-line" onClick={() => go(`/admin/companies/${c.id}`)}>
                <span className="grow adm-ai-two">
                  <strong>{c.name}</strong>
                  <small>{t('{plan} · pays {earned} for AI, AI heading for {forecast}', { plan: c.plan, earned: rp(c.earned), forecast: rp(c.forecast) })}</small>
                </span>
                <Badge tone="bad">{t('{amount} short', { amount: rpShort(c.forecast - c.earned) })}</Badge>
              </button>
            ))}
          </div>
        </Section>
      )}
      {m.unpriced.length > 0 && (
        <div className="adm-banner warn">
          <AlertTriangle size={16} />
          <span>
            {tn(
              m.unpriced.reduce((n, u) => n + u.uses, 0),
              '{models} ran {n} time this month without a price, so that cost isn’t counted above.',
              '{models} ran {n} times this month without a price, so that cost isn’t counted above.',
              { models: list(m.unpriced.map((u) => u.name)) },
            )}
          </span>
          <button className="ghost-btn sm" onClick={() => go('/admin/ai/prices')}>
            {t('Add prices')}
          </button>
        </div>
      )}
      {m.jobs.length > 0 && (
        <Section title={t('Cost per job')} hint={t('This month, everyone on our AI')}>
          <div className="adm-mini-list">
            {m.jobs.map((j) => (
              <div key={j.job} className="adm-mini-row">
                <span className="grow adm-ai-two">
                  <strong>{j.name}</strong>
                  <small>
                    {tn(j.uses, '{n} use', '{n} uses')} · {j.models.join(', ')}
                    {j.cost > 0 ? ` · ${t('{price} each', { price: rp(j.perUse) })}` : ''}
                  </small>
                </span>
                <span className="adm-num-r">{j.cost > 0 ? rp(j.cost) : <span className="muted">{t('no price')}</span>}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {m.other.length > 0 && (
        <Section title={t('Not paying for AI yet')} hint={t('{amount} of AI this month with nothing earned', { amount: rp(m.otherCost) })}>
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
      {!!m.unlimited?.length && (
        <Section title={t('Unlimited')} hint={t('{amount} of AI this month on the Whitelist, left out of the margin above', { amount: rp(m.unlimitedCost ?? 0) })}>
          <div className="adm-mini-list">
            {m.unlimited.map((c) => (
              <button key={c.id} type="button" className="adm-ai-line" onClick={() => go('/admin/whitelist')}>
                <span className="grow">
                  <strong>{c.name}</strong>
                </span>
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
  const [choosing, setChoosing] = useState<string | null>(null); // the provider whose model is being chosen
  const jobName = (id: string) => d.jobs.find((j) => j.id === id)?.name ?? id;
  const isText = (provider: string) => d.providers.find((p) => p.id === provider)?.kind !== 'speech';
  const textKeyOn = d.keys.some((k) => k.on && isText(k.provider));
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
      .then((r) => toast(r.ok ? t('{provider} key works', { provider: k.name }) : t('{provider} key failed: {error}', { provider: k.name, error: r.error ?? t('no answer') })), (e: Error) => toast(e.message))
      .finally(() => (setTesting(null), reload()));
  };
  return (
    <>
      <Section
        title={t('Our keys')}
        hint={t('Encrypted on the server; only the last 4 characters come back')}
        actions={
          d.can && (
            <button className="primary-btn sm" onClick={() => setAdding({ provider: null })}>
              <Plus size={13} /> {t('Add a key')}
            </button>
          )
        }
      >
        {d.keys.length === 0 ? (
          <Empty title={t('No keys yet')} text={t('AI-plan companies can’t use AI until a job has a working key. Start with the provider most jobs use.')} />
        ) : (
          <div className="adm-mini-list">
            {d.keys.map((k) => {
              const failing = !!k.failedAt && (!k.usedAt || k.failedAt > k.usedAt);
              const state = !k.on ? t('Switched off') : k.source === 'server' && !k.inUse ? t('Standby: the saved Claude key goes first') : failing ? t('Failed {when}: {error}', { when: rel(k.failedAt!), error: k.failError ?? t('no answer') }) : k.usedAt ? t('Last answered {when}', { when: rel(k.usedAt) }) : t('Not used yet');
              const tested = k.testedAt ? (k.testOk ? t('tested {when}', { when: rel(k.testedAt) }) : t('test failed {when}: {error}', { when: rel(k.testedAt), error: k.testError ?? t('no answer') })) : null;
              return (
                <div key={k.id} className={`adm-mini-row adm-ai-key ${leaving === k.id ? 'leaving' : ''} ${k.on ? '' : 'off'}`}>
                  <span className="adm-ai-mark" aria-hidden>
                    {markOf(k.name)}
                  </span>
                  <span className="grow adm-ai-two">
                    <strong>
                      {k.name} <span className="adm-ai-last4">•••• {k.last4}</span>
                      {k.source === 'server' && <Badge tone="info">{t('From the server settings')}</Badge>}
                    </strong>
                    <small className={failing && k.on ? 'adm-ai-bad' : ''}>
                      {state}
                      {tested ? ` · ${tested}` : ''}
                    </small>
                    <small>
                      {k.jobs.length ? t('Picked for {jobs}', { jobs: list(k.jobs.map((j) => jobWord(jobName(j)))) }) : t('Not picked for any job')}
                      {k.addedBy ? ` · ${t('added by {name} {date}', { name: k.addedBy.split(' ')[0], date: day(k.addedAt) })}` : ''}
                    </small>
                  </span>
                  {d.can && (
                    <span className="adm-ai-acts">
                      <button className="ghost-btn sm" disabled={testing === k.id} onClick={() => test(k)}>
                        {testing === k.id ? t('Testing…') : tx('verb', 'Test')}
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={k.on}
                        aria-label={k.on ? t('{provider} key on', { provider: k.name }) : t('{provider} key off', { provider: k.name })}
                        title={k.on ? t('Switch off') : t('Switch on')}
                        className={`switch ${k.on ? 'on' : ''}`}
                        onClick={() => void act(() => post('ai/key/switch', { provider: k.provider, source: k.source, on: !k.on }), k.on ? t('{provider} key switched off', { provider: k.name }) : t('{provider} key switched on', { provider: k.name }))}
                      >
                        <span />
                      </button>
                      {k.source === 'saved' && (
                        <Menu
                          label={t('More')}
                          items={[
                            ...(isText(k.provider) ? [{ label: t('Choose its model'), hint: t('For every job, or the best match for each'), run: () => setChoosing(k.provider) }] : []),
                            { label: t('Replace the key'), hint: t('Test a new one, then swap'), run: () => setAdding({ provider: k.provider, rotate: true }) },
                            { label: t('Remove'), danger: true, run: () => setRemoving(k) },
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
        {d.keys.some((k) => k.source === 'server') && <p className="adm-note">{t('The key from the server settings (ANTHROPIC_API_KEY) can be tested and switched off here. To remove it, take it out of the server settings; a saved Claude key goes first anyway.')}</p>}
      </Section>
      {needed.length > 0 && (
        <Section
          title={t('Picked for a job, but no key')}
          hint={t('Those jobs use their fallback, or don’t run')}
          actions={
            d.can &&
            textKeyOn && (
              <button className="ghost-btn sm" onClick={() => void act(() => post('ai/jobs/reset', { noKeyOnly: true }), t('Those jobs now use the best match on our keys')).then(reload)}>
                {t('Use our keys for these')}
              </button>
            )
          }
        >
          <div className="adm-mini-list">
            {needed.map((n) => (
              <div key={n.id} className="adm-mini-row">
                <KeyRound size={15} />
                <span className="grow adm-ai-two">
                  <strong>{n.name}</strong>
                  <small>{t('For {jobs}', { jobs: list(n.jobs.map(jobWord)) })}</small>
                </span>
                {d.can &&
                  (d.keys.some((k) => k.provider === n.id && k.source === 'saved' && !k.on) ? (
                    <button className="ghost-btn sm" onClick={() => void act(() => post('ai/key/switch', { provider: n.id, source: 'saved', on: true }), t('{provider} key switched on', { provider: n.name }))}>
                      {t('Switch on')}
                    </button>
                  ) : (
                    <button className="ghost-btn sm" onClick={() => setAdding({ provider: n.id })}>
                      {t('Add key')}
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
          onDone={(text, provider) => {
            const rotated = !!adding.rotate;
            setAdding(null);
            toast(text);
            reload();
            // A new key for text jobs: which of its models to use comes next.
            if (provider && !rotated && isText(provider)) setChoosing(provider);
          }}
        />
      )}
      {choosing && <ChooseModel provider={choosing} name={d.providers.find((p) => p.id === choosing)?.name ?? choosing} onClose={() => setChoosing(null)} onDone={(text) => (setChoosing(null), toast(text), reload())} />}
      {removing && (
        <Confirm
          title={t('Remove the {provider} key?', { provider: removing.name })}
          text={removing.jobs.length ? t('{Jobs} will use their fallback, or stop for AI-plan companies until there’s another key.', { jobs: list(removing.jobs.map(jobName)) }) : t('No job uses it right now.')}
          action={t('Remove key')}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const k = removing;
            const done = await act(() => post('ai/key/remove', { provider: k.provider }));
            setRemoving(null);
            if (!done) return;
            setLeaving(k.id);
            toast(t('{provider} key removed', { provider: k.name }));
            setTimeout(() => (setLeaving(null), reload()), 200);
          }}
        />
      )}
    </>
  );
}

function AddKey({ d, initial, rotate, onClose, onDone }: { d: AIData; initial: string | null; rotate: boolean; onClose: () => void; onDone: (text: string, provider?: string) => void }) {
  const [provider, setProvider] = useState<string | null>(initial);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = d.providers.find((p) => p.id === provider);
  const cred = provider ? CRED_FIELDS[provider as keyof typeof CRED_FIELDS] : undefined;
  const ready = !!info && (cred ? cred.fields.every((f) => f.optional || fields[f.key]?.trim()) : key.trim().length >= 8 && (!info.needsUrl || !!url.trim()));
  const KIND = { direct: t('Direct'), gateway: t('One key, many models'), cloud: t('Cloud account'), private: t('Private'), speech: t('Speech to text') } as Record<string, string>;
  const options: Option[] = d.providers.filter((p) => p.supported).map((p) => ({ value: p.id, label: p.name, hint: p.saved ? t('has a key') : undefined, group: KIND[p.kind] ?? p.kind }));
  const save = () => {
    if (!ready || !info) return;
    setBusy(true);
    setErr(null);
    const packed = cred ? JSON.stringify(Object.fromEntries(cred.fields.map((f) => [f.key, (fields[f.key] ?? '').trim()]))) : key.trim();
    void post<{ last4: string }>('ai/key', { provider, key: packed, baseUrl: cred ? (fields[cred.url] ?? '').trim() || undefined : url.trim() || undefined })
      .then((r) => onDone(rotate ? t('{provider} key replaced (•••• {last4}). It worked on a test call.', { provider: info.name, last4: r.last4 }) : t('{provider} key added (•••• {last4}). It worked on a test call.', { provider: info.name, last4: r.last4 }), provider ?? undefined), (e: ApiError) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog
      title={rotate && info ? t('Replace the {provider} key', { provider: info.name }) : t('Add a key')}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!ready || busy} onClick={save}>
            {busy ? t('Testing…') : t('Test and save')}
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
          <Field label={t('Provider')}>
            <Select value={provider} options={options} onChange={(v) => (setProvider(v), setErr(null), setFields({}), setKey(''), setUrl(''))} placeholder={t('Choose a provider')} label={t('Provider')} searchable width={340} />
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
              <Field key={f.key} label={f.optional ? t('{label} (optional)', { label: f.label }) : f.label}>
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
              <Field label={t('Address')} hint={t('Must start with https://')}>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" />
              </Field>
            )}
            <Field label={t('Key')} hint={info.keyHint}>
              <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => (setKey(e.target.value), setErr(null))} autoFocus={rotate} />
            </Field>
          </>
        )}
        {err && <p className="err">{err}</p>}
        {info && <p className="adm-note">{t('We send one tiny request with it first. It’s saved only if that works, encrypted, and only the last 4 characters are shown again.')}</p>}
      </form>
    </Dialog>
  );
}

/**
 * Right after a key is added (or from its menu): which of its models our jobs use. Either the best match for each job
 * (the recommended model, or its family, on our keys) or one model for every job, from the provider's own list.
 */
function ChooseModel({ provider, name, onClose, onDone }: { provider: string; name: string; onClose: () => void; onDone: (text: string) => void }) {
  const act = useAct();
  const [data, setData] = useState<AIData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [mode, setMode] = useState<'auto' | 'one'>('auto');
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Reading the page data also reads the new key's own model list.
    void get<AIData>('ai').then(setData, (e: Error) => setFailed(e.message));
  }, []);
  const mine = (data?.options.text ?? []).filter((o) => o.provider === provider && !o.gone);
  const options: Option[] = mine.map((o) => ({ value: o.model, label: o.name, hint: o.price ? t('{in} / {out} per million', { in: usd(o.price[0]), out: usd(o.price[1]) }) : t('price unknown'), group: o.recommended ? t('Recommended') : t('More models'), keywords: o.model }));
  const onThis = (data?.jobs ?? []).filter((j) => j.id !== 'speech' && j.primary.provider === provider);
  const save = async () => {
    setBusy(true);
    const ok =
      mode === 'one'
        ? await act(() => post('ai/key/assign', { provider, model }))
        : await act(() => post('ai/jobs/reset', { noKeyOnly: true }));
    setBusy(false);
    if (!ok) return;
    const label = mine.find((o) => o.model === model)?.name ?? model;
    onDone(mode === 'one' ? t('Every job now uses {model} on {provider}', { model: label ?? '', provider: name }) : t('Each job uses the best match on our keys'));
  };
  return (
    <Dialog
      title={t('Which model should {provider} use?', { provider: name })}
      onClose={onClose}
      foot={
        <>
          <button className="ghost-btn" onClick={onClose}>
            {t('Not now')}
          </button>
          <button className="primary-btn" disabled={busy || !data || (mode === 'one' && !model)} onClick={() => void save()}>
            {busy ? t('Saving…') : t('Save')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        {failed ? (
          <p className="err">{failed}</p>
        ) : !data ? (
          <Loading rows={3} />
        ) : (
          <>
            <div className="segmented sm" role="tablist" aria-label={t('How jobs pick a model')}>
              <button type="button" role="tab" aria-selected={mode === 'auto'} className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>
                {t('Best match for each job')}
              </button>
              <button type="button" role="tab" aria-selected={mode === 'one'} className={mode === 'one' ? 'on' : ''} onClick={() => setMode('one')}>
                {t('One model for every job')}
              </button>
            </div>
            {mode === 'auto' ? (
              <>
                <p className="adm-note">
                  {t('Each job runs on the model it was made for, or the closest one our keys have, with a strong model for heavy jobs like Ask AI and a fast one for light jobs. Jobs set by hand to a provider we have no key for move too.')}
                </p>
                {onThis.length > 0 && (
                  <div className="adm-mini-list">
                    {onThis.map((j) => (
                      <div key={j.id} className="adm-mini-row">
                        <span className="grow">{j.name}</span>
                        <small className="muted">{mine.find((o) => o.model === j.primary.model)?.name ?? j.primary.model}</small>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Field label={t('Model')} hint={mine.length ? tn(mine.length, '{n} model from {provider}’s own list', '{n} models from {provider}’s own list', { provider: name }) : t('{provider} didn’t list its models; try again in a minute', { provider: name })}>
                <Select value={model} options={options} onChange={setModel} placeholder={t('Choose a model')} label={t('Model')} searchable width={420} />
              </Field>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ---------- the model for each job ---------- */

/** The jobs in groups; a function, so the names are in the console's language when it's drawn. */
const groups = (): { id: string; name: string; jobs: string[] }[] => [
  { id: 'meetings', name: t('Meetings'), jobs: ['meeting', 'speech'] },
  { id: 'asking', name: t('Asking and planning'), jobs: ['ask', 'braindump'] },
  { id: 'email', name: t('Email'), jobs: ['draft', 'summary', 'replies', 'todos'] },
  { id: 'behind', name: t('Behind the scenes'), jobs: ['sorting', 'digest', 'translate'] },
];
function Models({ d, reload }: { d: AIData; reload: () => void }) {
  const act = useAct();
  const [refreshing, setRefreshing] = useState(false);
  // Each provider's own list for our key (recommended ones first), grouped by provider; the catalogue where there's no list.
  // Only models we have a working key for (and whatever a job uses now, so it still shows); with no key at all, the
  // catalogue, so the page isn't empty before the first key.
  const anyKey = (speech: boolean) => (speech ? d.options.speech : d.options.text).some((o) => o.hasKey);
  const inUse = new Set(d.jobs.flatMap((j) => [j.primary, j.fallback].filter(Boolean).map((c) => `${c!.provider}|${c!.model}`)));
  const opts = (speech: boolean): Option[] =>
    (speech ? d.options.speech : d.options.text).filter((o) => o.hasKey || !anyKey(speech) || inUse.has(`${o.provider}|${o.model}`)).map((o) => ({
      value: `${o.provider}|${o.model}`,
      label: o.name,
      hint: o.gone ? t('no longer offered: pick another') : !o.hasKey ? t('no key yet') : speech ? undefined : o.price ? `${usd(o.price[0])} / ${usd(o.price[1])}` : t('no price yet'),
      group: o.providerName,
      keywords: `${o.providerName} ${o.model}`,
    }));
  const live = d.lists.filter((l) => l.source === 'live');
  const oldest = live.map((l) => l.fetchedAt).filter(Boolean).sort()[0] ?? null;
  const notListed = d.lists.filter((l) => l.source !== 'live' && l.note);
  const gone = d.jobs.filter((j) => j.gone);
  const refresh = () => {
    setRefreshing(true);
    void act(() => post('ai/models/refresh'), t('Read the providers’ model lists again'))
      .then(reload)
      .finally(() => setRefreshing(false));
  };
  const pick = (v: string): Choice => {
    const [provider, model] = v.split('|');
    return { provider, model };
  };
  const save = (j: JobRow, primary: Choice, fallback: Choice | null) => void act(() => post('ai/job', { job: j.id, primary, fallback }), t('{job}: saved', { job: j.name })).then(reload);
  // The chosen model with its provider: the same model is sold by several gateways.
  const shown = (o: Option | undefined) => (
    <>
      <span className="sel-text">
        {o?.label ?? t('Choose')}
        {o?.group && <em className="adm-ai-selprov"> · {o.group.match(/\(([^)]+)\)/)?.[1] ?? o.group}</em>}
      </span>
      <ChevronDown size={14} className="sel-chev" />
    </>
  );
  const custom = d.jobs.some((j) => !j.isDefault);
  return (
    <Section
      title={t('Which model does each job')}
      hint={t('For AI-plan companies. Until you pick, each job uses the recommended model on the keys we have. The fallback takes over when the first one fails.')}
      actions={
        d.can && (
          <>
            {d.lists.length > 0 && (
              <button className="ghost-btn sm" disabled={refreshing} onClick={refresh} title={t('Read each provider’s model list again')}>
                <RefreshCw size={13} className={refreshing ? 'spin' : ''} /> {refreshing ? t('Reading lists…') : t('Check for new models')}
              </button>
            )}
            {custom && (
              <button className="ghost-btn sm" onClick={() => void act(() => post('ai/jobs/reset'), t('Every job is back to automatic: the recommended model on our keys')).then(reload)}>
                <RotateCcw size={13} /> {t('Back to automatic')}
              </button>
            )}
          </>
        )
      }
    >
      {Array.from(new Set(gone.map((j) => j.gone!))).map((text) => {
        const js = gone.filter((j) => j.gone === text);
        const jobs = list(js.map((j) => jobWord(j.name)));
        const fallback = js.every((j) => j.state === 'fallback');
        return (
          <div key={text} className="adm-banner warn">
            <AlertTriangle size={16} />
            <span>
              {text}{' '}
              {fallback
                ? tn(js.length, '{Jobs} runs on its fallback. Pick another model below.', '{Jobs} run on their fallbacks. Pick another model below.', { jobs })
                : js.length === 1
                  ? t('{Jobs} has nothing to run on. Pick another model below.', { jobs })
                  : t('{Jobs} run on a fallback where they have one. Pick another model below.', { jobs })}
            </span>
          </div>
        );
      })}
      {(live.length > 0 || notListed.length > 0) && (
        <p className="adm-note adm-ai-lists">
          {live.length > 0 &&
            `${
              oldest
                ? tn(live.length, 'Models for {providers} come from its own list for our key, read {when}.', 'Models for {providers} come from their own lists for our keys, read {when}.', { providers: list(live.map((l) => l.name)), when: rel(oldest) })
                : tn(live.length, 'Models for {providers} come from its own list for our key.', 'Models for {providers} come from their own lists for our keys.', { providers: list(live.map((l) => l.name)) })
            } `}
          {notListed.map((l) => `${l.name}: ${l.note}`).join(' ')}
        </p>
      )}
      <div className="adm-ai-groups">
        {groups().map((g) => (
          <div key={g.id} className="adm-ai-group">
            <h3>{g.name}</h3>
            <div className="adm-mini-list">
              {g.jobs.map((id) => {
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
                      <small>{t('First')}</small>
                      <Select className="sel-flat" value={`${j.primary.provider}|${j.primary.model}`} options={o} onChange={(v) => save(j, pick(v), j.fallback)} renderValue={shown} disabled={!d.can} searchable width={320} label={t('{job}: first choice', { job: j.name })} title={t('{job}: first choice', { job: j.name })} />
                    </span>
                    <span className="adm-ai-pick">
                      <small>{t('If it fails')}</small>
                      <Select
                        className="sel-flat"
                        value={j.fallback ? `${j.fallback.provider}|${j.fallback.model}` : 'none'}
                        options={[{ value: 'none', label: t('No fallback') }, ...o.filter((x) => x.value !== `${j.primary.provider}|${j.primary.model}`)]}
                        onChange={(v) => save(j, j.primary, v === 'none' ? null : pick(v))}
                        renderValue={shown}
                        disabled={!d.can}
                        searchable
                        width={320}
                        label={t('{job}: fallback', { job: j.name })}
                        title={t('{job}: fallback', { job: j.name })}
                      />
                    </span>
                    <span className="adm-ai-job-state">
                      {j.gone ? (
                        <Badge tone={j.state === 'fallback' ? 'warn' : 'bad'}>{j.state === 'fallback' ? t('Model gone, fallback runs') : t('Model gone')}</Badge>
                      ) : j.state === 'none' ? (
                        <Badge tone="bad">{t('No key')}</Badge>
                      ) : j.state === 'fallback' ? (
                        <Badge tone="warn">{t('Fallback in use')}</Badge>
                      ) : j.id === 'speech' ? (
                        <small>{t('per audio minute, not counted yet')}</small>
                      ) : j.per100 !== null ? (
                        <small>{j.id === 'meeting' ? t('≈ {price} per meeting hour', { price: rp(j.per100 / 100) }) : t('≈ {price} per 100 uses', { price: rp(j.per100) })}</small>
                      ) : (
                        <Badge tone="warn">{t('No price')}</Badge>
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
  // Models in use first (by our jobs, or by anyone this month); otherwise the catalogue's order, so nothing moves when a price is filled in.
  const inUse = (p: PriceRow) => p.usedBy.length > 0 || p.uses > 0;
  const rows = [...d.prices].sort((a, b) => Number(inUse(b)) - Number(inUse(a)));
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
    void act(() => post('ai/prices', { prices, rate: draft.rate }), t('Prices saved: costs and allowances use them now')).then(reload);
  };
  return (
    <>
      <Section
        title={t('Dollar rate')}
        hint={t('Every cost in rupiah uses it')}
        actions={
          d.can &&
          custom && (
            <button className="ghost-btn sm" onClick={() => void act(() => post('ai/prices/reset'), t('Back to list prices and {rate}', { rate: rp(d.defaultRate) })).then(reload)}>
              <RotateCcw size={13} /> {t('List prices')}
            </button>
          )
        }
      >
        <div className="adm-inline">
          <span>US$1 =</span>
          <span className="adm-ai-rate">
            <MoneyInput value={draft.rate} disabled={!d.can} onChange={(n) => setDraft({ ...draft, rate: n })} label={t('Rupiah per US dollar')} />
          </span>
          <span className="muted">rupiah</span>
        </div>
      </Section>
      <Section title={t('Model prices')} hint={t('US$ per million tokens. List prices to start with; change one when the bill says otherwise.')}>
        <div className="adm-ai-prices" role="table">
          <div className="adm-ai-price head" role="row">
            <span role="columnheader">{t('Model')}</span>
            <span role="columnheader">{tx('tokens', 'In')}</span>
            <span role="columnheader">{tx('tokens', 'Out')}</span>
          </div>
          {rows.map((p) => {
            const [i, o] = draft.prices[p.model] ?? ['', ''];
            const missing = !p.price && inUse(p);
            return (
              <div key={p.model} className="adm-ai-price" role="row">
                <span className="adm-ai-two" role="cell">
                  <strong>
                    {p.name} {missing ? <Badge tone="warn">{t('No price')}</Badge> : p.own && p.catalog ? <Badge>{t('Changed')}</Badge> : null}
                  </strong>
                  <small>
                    {p.providers.join(', ')}
                    {!PROVIDERS.some((pr) => pr.models.some((m) => m.id === p.model)) ? ` · ${p.model}` : ''}
                    {p.usedBy.length ? ` · ${list(p.usedBy.map((j) => jobWord(jobName(j))), 2)}` : ''}
                    {p.uses ? ` · ${tn(p.uses, '{n} use this month', '{n} uses this month')}` : ''}
                    {p.own && p.catalog ? ` · ${t('list {in} / {out}', { in: usd(p.catalog[0]), out: usd(p.catalog[1]) })}` : ''}
                  </small>
                </span>
                <span role="cell" className="adm-ai-usd">
                  <input inputMode="decimal" value={i} placeholder={t('none')} disabled={!d.can} aria-label={t('{model} ({provider}): US$ per million tokens in', { model: p.name, provider: p.providers[0] ?? '' })} onChange={(e) => setDraft({ ...draft, prices: { ...draft.prices, [p.model]: [e.target.value.replace(/[^\d.,]/g, ''), o] } })} />
                </span>
                <span role="cell" className="adm-ai-usd">
                  <input inputMode="decimal" value={o} placeholder={t('none')} disabled={!d.can} aria-label={t('{model} ({provider}): US$ per million tokens out', { model: p.name, provider: p.providers[0] ?? '' })} onChange={(e) => setDraft({ ...draft, prices: { ...draft.prices, [p.model]: [i, e.target.value.replace(/[^\d.,]/g, '')] } })} />
                </span>
              </div>
            );
          })}
        </div>
      </Section>
      {d.can && (
        <div className={`adm-savebar ${changed ? 'show' : ''}`} aria-hidden={!changed}>
          <span>{t('Unsaved prices')}</span>
          <button className="ghost-btn sm" onClick={() => setDraft(base)}>
            {t('Undo')}
          </button>
          <button className="primary-btn sm" onClick={save}>
            {t('Save')}
          </button>
        </div>
      )}
    </>
  );
}
