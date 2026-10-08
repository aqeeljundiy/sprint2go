import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import type { AIJobId, AISettings, Plan, ProviderId } from '../../types';
import { JOBS, PROVIDERS, providerOf } from '../../data/aiCatalog';
import { ALLOWANCE, TOP_UP, options, priceFor, rp, seatsFor, TIER_NAME } from '../../data/pricing';
import { server } from '../../sync';
import { brand as product } from '../../terms';

const USD = 17_500; // rupiah per US$, same rate as the AI catalogue

interface Row {
  job: AIJobId;
  provider: string;
  model: string;
  uses: number;
  inTokens: number;
  outTokens: number;
}

/** List price of a model in US$ per million tokens (in, out). Gateways resell the same models, so any provider's listing counts. */
function priceOf(provider: string, model: string): [number, number] | null {
  const own = providerOf(provider as ProviderId)?.models.find((m) => m.id === model)?.price;
  if (own) return own;
  const bare = model.split('/').pop()!;
  for (const p of PROVIDERS) {
    const m = p.models.find((x) => x.price && (x.id === model || x.id.split('/').pop() === bare));
    if (m?.price) return m.price;
  }
  return null;
}
const usdOf = (r: { inTokens: number; outTokens: number }, price: [number, number]) => (r.inTokens * price[0] + r.outTokens * price[1]) / 1e6;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** What one setup would cost for the same work: each job priced on the model that setup uses for it. */
function costWith(rows: Row[], pick: (job: AIJobId, row: Row) => { provider: string; model: string } | null) {
  let usd = 0;
  let unpriced = 0;
  for (const r of rows) {
    const m = pick(r.job, r);
    const price = m && priceOf(m.provider, m.model);
    if (price) usd += usdOf(r, price);
    else unpriced += r.uses;
  }
  return { rp: usd * USD, usd, unpriced };
}

/**
 * Spending: tokens and estimated cost per job on your own keys (from the server's log of every AI call),
 * and the same work priced on other setups and on Sprint2go's "AI included" plan.
 */
export function AISpend({ ws, ai, plan, people, typical }: { ws: string; ai: AISettings; plan?: Plan; people: number; typical: Partial<Record<AIJobId, number>> }) {
  const [real, setReal] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!server.on) return;
    void fetch(`/api/ai/usage?ws=${encodeURIComponent(ws)}&days=30`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: Row[] }) => setReal(d.rows));
  }, [ws]);

  const measured = !!real?.length;
  /** The model a job uses on your keys: the one picked in Setup, or the balanced choice when none is picked yet. */
  const mapped = (job: AIJobId) => {
    const p = ai.jobs[job];
    return p && p.provider !== 'included' && p.model && p.model !== 'browser' ? { provider: p.provider as string, model: p.model } : { provider: '', model: JOBS.find((j) => j.id === job)!.rec.balanced };
  };
  const hasKeys = ai.providers.some((p) => p.status === 'ok');
  // No calls logged yet: estimate from typical use for a company this size.
  const rows: Row[] = measured
    ? real!
    : JOBS.filter((j) => typical[j.id]).map((j) => {
        const uses = typical[j.id]!;
        return { job: j.id, ...mapped(j.id), uses, inTokens: uses * j.tokens[0], outTokens: uses * j.tokens[1] };
      });
  const byJob = JOBS.map((j) => {
    const rs = rows.filter((r) => r.job === j.id);
    if (!rs.length) return null;
    const uses = rs.reduce((s, r) => s + r.uses, 0);
    const inT = rs.reduce((s, r) => s + r.inTokens, 0);
    const outT = rs.reduce((s, r) => s + r.outTokens, 0);
    const priced = rs.map((r) => ({ r, price: r.provider === 'included' ? null : priceOf(r.provider, r.model) }));
    const usd = priced.reduce((s, x) => s + (x.price ? usdOf(x.r, x.price) : 0), 0);
    const nameOf = (model: string) => PROVIDERS.flatMap((p) => p.models).find((m) => m.id === model || m.id.split('/').pop() === model.split('/').pop())?.name ?? model;
    const models = [...new Set(rs.map((r) => (r.provider === 'included' ? `${product.name}` : nameOf(r.model))))];
    return { job: j, uses, inT, outT, usd, models, included: rs.every((r) => r.provider === 'included'), unpriced: priced.some((x) => !x.price && x.r.provider !== 'included') };
  }).filter(Boolean) as { job: (typeof JOBS)[number]; uses: number; inT: number; outT: number; usd: number; models: string[]; included: boolean; unpriced: boolean }[];

  const totalIn = byJob.reduce((s, x) => s + x.inT, 0);
  const totalOut = byJob.reduce((s, x) => s + x.outT, 0);
  const totalUses = byJob.reduce((s, x) => s + x.uses, 0);

  // The same work on each setup.
  const now = costWith(rows, (job, r) => (r.provider === 'included' ? mapped(job) : r));
  const cheap = costWith(rows, (job) => ({ provider: '', model: JOBS.find((j) => j.id === job)!.rec.cheap }));
  const best = costWith(rows, (job) => ({ provider: '', model: JOBS.find((j) => j.id === job)!.rec.best }));

  // Sprint2go "AI included": the difference between the two plan tracks for the same team, plus top-ups if the allowance runs out.
  const tier = plan && plan.tier !== 'free' ? plan.tier : (options('own', people)[0]?.tier ?? 'studio');
  const ownPrice = priceFor('own', tier, people) ?? 0;
  const aiPrice = priceFor('ai', tier, people) ?? 0;
  const seats = seatsFor(tier, people);
  const perTopUp = { braindump: 120, ask: 110, meeting: 50, summary: 600, draft: 600 } as Record<string, number>;
  const pool = { braindump: ALLOWANCE.braindump * seats, ask: ALLOWANCE.ask * seats, meeting: ALLOWANCE.meetingHours * seats, summary: ALLOWANCE.summary * seats, draft: ALLOWANCE.draft * seats } as Record<string, number>;
  const over = byJob.reduce((s, x) => s + (pool[x.job.id] !== undefined ? Math.max(0, x.uses - pool[x.job.id]) / perTopUp[x.job.id] : 0), 0);
  const topUps = Math.ceil(over);
  const included = aiPrice - ownPrice + topUps * TOP_UP.price;

  const cards = [
    { id: 'now', name: hasKeys ? 'Your keys, setup now' : 'Your keys, balanced', rp: now.rp, note: now.unpriced ? `${now.unpriced} uses on models without a listed price` : 'List prices of the models you picked' },
    { id: 'cheap', name: 'Your keys, lowest cost', rp: cheap.rp, note: 'DeepSeek and Flash models where they fit' },
    { id: 'best', name: 'Your keys, best quality', rp: best.rp, note: 'Top models for every job' },
    { id: 'included', name: `${product.name} AI included`, rp: included, note: `${TIER_NAME[tier]} AI vs ${TIER_NAME[tier]} for ${people} people${topUps ? ` + ${topUps} top-up${topUps > 1 ? 's' : ''}` : ', within the allowance'}` },
  ];
  const cheapest = cards.reduce((a, b) => (b.rp < a.rp ? b : a));
  const diff = Math.abs(now.rp - included);

  return (
    <div className="set-block spend">
      <h3>
        <Coins size={15} /> Spending
        <span className={`spend-src ${measured ? 'real' : ''}`}>{measured ? 'Measured, last 30 days' : 'Estimate from typical use'}</span>
      </h3>
      <p className="muted small">
        {measured
          ? 'Every AI call on your keys is counted here: tokens in and out, priced at the provider’s list price. Your provider’s bill is the final number.'
          : 'Nothing measured yet, so this uses typical monthly use for a company your size. Once your keys are in use, the real numbers replace it.'}
      </p>

      <div className="spend-lead">
        <b>{rp(now.rp)}</b>
        <span>a month on {hasKeys ? 'your keys' : 'your own keys'}, about US${now.usd.toFixed(2)}</span>
      </div>
      <p className="spend-verdict">
        {now.rp <= included
          ? `Your own keys cost about ${rp(diff)} a month less than ${product.name} AI included, for this much use. You manage the keys and the provider bills.`
          : `${product.name} AI included costs about ${rp(diff)} a month less than your own keys, for this much use, and there are no keys or provider bills to manage.`}
      </p>
      <h4 className="spend-sub">The same work, a month, on each setup</h4>
      <div className="spend-compare">
        {cards.map((c) => (
          <div key={c.id} className={`spend-card ${c.id === cheapest.id ? 'best' : ''} ${c.id === (ai.payer === 'sprint2go' ? 'included' : 'now') ? 'current' : ''}`}>
            <span className="sc-name">{c.name}</span>
            <b>{rp(c.rp)}</b>
            <small>{c.note}</small>
            {c.id === cheapest.id && <em>Cheapest</em>}
          </div>
        ))}
      </div>
      <details className="spend-details">
        <summary>Where it goes: each job, uses and tokens</summary>
      <div className="spend-totals">
        <div>
          <b>{totalUses.toLocaleString('id-ID')}</b>
          <span>AI uses</span>
        </div>
        <div>
          <b>{tokens(totalIn)}</b>
          <span>tokens in</span>
        </div>
        <div>
          <b>{tokens(totalOut)}</b>
          <span>tokens out</span>
        </div>
      </div>

      <table className="spend-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Uses</th>
            <th>Tokens in / out</th>
            <th>Model</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {byJob.map((x) => (
            <tr key={x.job.id}>
              <td>{x.job.name}</td>
              <td>{x.uses.toLocaleString('id-ID')}</td>
              <td>
                {tokens(x.inT)} / {tokens(x.outT)}
              </td>
              <td className="muted">{x.models.join(', ')}</td>
              <td>{x.included ? <span className="muted">in plan</span> : x.unpriced && !x.usd ? <span className="muted">no list price</span> : rp(x.usd * USD)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </details>
    </div>
  );
}
