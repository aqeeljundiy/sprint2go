import { useState } from 'react';
import { CheckCircle2, CreditCard, Download, Minus, PauseCircle, Plus, Sparkles, Users, XCircle } from 'lucide-react';
import type { Plan, Tier, Track, Workspace } from '../../types';
import { ADDONS, ALLOWANCE, PLAN_FEATURES, PRICES, TIER_NAME, TOP_UP, TRACK_NAME, meetHours, monthlyTotal, options, planName, priceFor, rp, seatsFor, storageGB } from '../../data/pricing';
import { trialPlan } from '../../data/workspaces';
import { Select } from '../ui/Select';
import { brand as product } from '../../terms';

interface Props {
  ws: Workspace;
  people: number; // active members
  isOwner: boolean;
  onPlan: (p: Plan) => void;
  onExport: () => void;
  toast: (text: string) => void;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/** Workspace settings → Billing: the company's own Sprint2go subscription. */
export function BillingSection({ ws, people, isOwner, onPlan, onExport, toast }: Props) {
  const plan = ws.plan ?? trialPlan(ws.name, '');
  const [track, setTrack] = useState<Track>(plan.track);
  const [n, setN] = useState(Math.max(1, people));
  const [cycle, setCycle] = useState(plan.cycle);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const set = (p: Partial<Plan>) => onPlan({ ...plan, ...p });
  const now = monthlyTotal(plan, people);
  const trialDays = plan.trialEnds ? Math.max(0, Math.ceil((new Date(plan.trialEnds).getTime() - Date.now()) / 86_400_000)) : 0;
  const opts = options(track, n);
  const best = opts[0];
  const yearly = (m: number) => m * 10;
  const nextInvoice = new Date();
  nextInvoice.setMonth(nextInvoice.getMonth() + 1, 1);

  // Sample invoice history (the backend creates these from Xendit payments).
  const invoices = plan.tier === 'free' || plan.trialEnds
    ? []
    : [0, 1, 2].map((i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i, 1);
        return { no: `S2G-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${ws.id.toUpperCase()}`, date: d.toISOString(), amount: now.total * (plan.cycle === 'yearly' ? 10 : 1), status: 'Paid' };
      });

  const choose = (tier: Tier) => {
    onPlan({ ...plan, track, tier, cycle, trialEnds: undefined, paused: false });
    toast(`Switched to ${planName({ track, tier })}${cycle === 'yearly' ? ', billed yearly' : ''}. The difference is charged for the rest of this period only`);
  };
  const stepper = (key: 'mailboxes' | 'storage50' | 'meetHours10') => (
    <span className="stepper">
      <button type="button" className="icon-btn sm" disabled={!plan.addons[key]} onClick={() => set({ addons: { ...plan.addons, [key]: Math.max(0, plan.addons[key] - 1) } })} aria-label="Less">
        <Minus size={13} />
      </button>
      <b>{plan.addons[key]}</b>
      <button type="button" className="icon-btn sm" onClick={() => set({ addons: { ...plan.addons, [key]: plan.addons[key] + 1 } })} aria-label="More">
        <Plus size={13} />
      </button>
    </span>
  );

  return (
    <>
      <h2>Billing</h2>
      <p className="set-intro">Your company’s {product.name} subscription: plan, people, add-ons, payment and invoices.</p>
      {!isOwner && <p className="modal-note">Only owners can change billing. You can see the plan and invoices.</p>}

      <div className="plan-card">
        <div className="pc-main">
          <span className="pc-kicker">{plan.trialEnds ? `Free trial · ${trialDays} day${trialDays === 1 ? '' : 's'} left` : plan.paused ? 'Paused' : 'Current plan'}</span>
          <h3>
            {planName(plan)} <span className="pc-track">{plan.tier === 'free' ? 'your own AI keys' : TRACK_NAME[plan.track]}</span>
          </h3>
          <p className="muted">
            {people} active {people === 1 ? 'person' : 'people'}
            {plan.tier !== 'free' && plan.tier !== 'small' ? ` · ${PRICES[plan.track][plan.tier].included} included` : ''} · {storageGB(plan, people) >= 1024 ? `${(storageGB(plan, people) / 1024).toFixed(0)} TB` : `${storageGB(plan, people)} GB`} storage ·{' '}
            {meetHours(plan, people) === Infinity ? 'unlimited' : meetHours(plan, people)} meeting-bot hours
          </p>
        </div>
        <div className="pc-price">
          {plan.trialEnds ? (
            <>
              <b>Rp 0</b>
              <small>until {fmtDate(plan.trialEnds)}, then Free unless you pick a plan</small>
            </>
          ) : (
            <>
              <b>{rp(plan.cycle === 'yearly' ? yearly(now.total) : now.total)}</b>
              <small>
                per {plan.cycle === 'yearly' ? 'year' : 'month'}
                {now.addons ? ` (plan ${rp(now.base)} + add-ons ${rp(now.addons)})` : ''}
                {plan.tier !== 'free' ? ` · next invoice ${fmtDate(nextInvoice.toISOString())}` : ''}
              </small>
            </>
          )}
        </div>
      </div>
      {plan.trialEnds && (
        <p className="trial-note">
          <Sparkles size={14} /> You’re trying Studio AI: every feature and the full AI allowance. When the trial ends nothing is deleted. You move to Free, and anything beyond Free waits for an upgrade.
        </p>
      )}

      <fieldset className="plain" disabled={!isOwner}>
        <div className="set-block">
          <h3>Choose a plan</h3>
          <div className="plan-controls">
            <div className="segmented">
              {(['own', 'ai'] as Track[]).map((t) => (
                <button key={t} type="button" className={track === t ? 'on' : ''} onClick={() => setTrack(t)}>
                  {TRACK_NAME[t]}
                </button>
              ))}
            </div>
            <div className="segmented">
              <button type="button" className={cycle === 'monthly' ? 'on' : ''} onClick={() => setCycle('monthly')}>
                Monthly
              </button>
              <button type="button" className={cycle === 'yearly' ? 'on' : ''} onClick={() => setCycle('yearly')}>
                Yearly · 2 months free
              </button>
            </div>
          </div>
          <label className="people-slider">
            <Users size={15} />
            <span>
              <b>{n}</b> {n === 1 ? 'person' : 'people'}
            </span>
            <input type="range" min={1} max={120} value={n} onChange={(e) => setN(Number(e.target.value))} />
          </label>
          <p className="muted small">
            {track === 'own' ? `Your AI provider bills you directly; ${product.name} costs less.` : `AI included: per person about ${ALLOWANCE.braindump} brain dumps, ${ALLOWANCE.ask} questions, ${ALLOWANCE.meetingHours} meeting hours, ${ALLOWANCE.summary} summaries and ${ALLOWANCE.draft} drafts a month, shared by everyone.`}
            {track === 'own' && n <= 5 ? ' Up to 5 people can also use Free.' : ''}
          </p>
          <div className="tier-grid">
            {(['small', 'studio', 'agency', 'business'] as Tier[]).map((tier) => {
              const price = priceFor(track, tier, n);
              const isBest = best?.tier === tier;
              const current = !plan.trialEnds && plan.tier === tier && plan.track === track;
              const p = PRICES[track][tier as Exclude<Tier, 'free'>];
              return (
                <div key={tier} className={`tier ${isBest ? 'best' : ''} ${price === null ? 'na' : ''} ${current ? 'current' : ''}`}>
                  <span className="tier-name">
                    {TIER_NAME[tier]}
                    {track === 'ai' ? ' AI' : ''}
                    {isBest && <em>Cheapest for {n}</em>}
                  </span>
                  <b>{price === null ? 'Up to 9 people' : rp(cycle === 'yearly' ? yearly(price) : price)}</b>
                  <small>
                    {price === null ? 'Too many people for this one' : `per ${cycle === 'yearly' ? 'year' : 'month'}`}
                    {tier === 'small' ? ` · ${rp(p.base)} per person` : ` · ${p.included} included, then ${rp(p.extra)} each`}
                  </small>
                  <ul>
                    {PLAN_FEATURES[tier].map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {current ? (
                    <span className="tier-current">
                      <CheckCircle2 size={14} /> Your plan
                    </span>
                  ) : (
                    <button type="button" className={isBest ? 'primary-btn sm' : 'ghost-btn sm'} disabled={price === null} onClick={() => choose(tier)}>
                      Switch to {TIER_NAME[tier]}
                      {track === 'ai' ? ' AI' : ''}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            You never pay more than the next package: if extra people make a bigger package cheaper, we move you to it and tell you. Only active people are billed. Guests and shared inboxes are always free.
          </p>
          {plan.tier !== 'free' && (
            <button type="button" className="link-btn" onClick={() => (onPlan({ ...plan, tier: 'free', track: 'own', trialEnds: undefined }), toast('Moved to Free. Nothing was deleted'))}>
              Downgrade to Free
            </button>
          )}
        </div>

        {plan.track === 'ai' && plan.tier !== 'free' && (
          <div className="set-block">
            <h3>AI top-ups</h3>
            <div className="set-row">
              <span>
                <strong>{rp(TOP_UP.price)} adds {TOP_UP.gives}</strong>
                <small>For busy months. Light jobs (reply suggestions, email to-dos) keep working on a cheap model even when the allowance runs out.</small>
              </span>
              <button type="button" className="ghost-btn sm" onClick={() => (set({ topUps: (plan.topUps ?? 0) + 1 }), toast(`Top-up added. ${rp(TOP_UP.price)} on the next invoice`))}>
                Buy a top-up
              </button>
            </div>
            <label className="set-row toggle-row">
              <span>
                <strong>Top up automatically</strong>
                <small>When the allowance runs out, up to a monthly limit</small>
              </span>
              <button type="button" role="switch" aria-checked={!!plan.autoTopUp?.on} className={`switch ${plan.autoTopUp?.on ? 'on' : ''}`} onClick={() => set({ autoTopUp: { on: !plan.autoTopUp?.on, limit: plan.autoTopUp?.limit ?? 297_000 } })}>
                <span />
              </button>
            </label>
            {plan.autoTopUp?.on && (
              <div className="set-row">
                <span>
                  <strong>Monthly limit</strong>
                </span>
                <Select value={String(plan.autoTopUp.limit)} onChange={(v) => set({ autoTopUp: { on: true, limit: Number(v) } })} label="Monthly limit" options={[1, 3, 5, 10].map((k) => ({ value: String(k * TOP_UP.price), label: `${rp(k * TOP_UP.price)} (${k} top-up${k > 1 ? 's' : ''})` }))} />
              </div>
            )}
          </div>
        )}

        <div className="set-block">
          <h3>Add-ons</h3>
          {(['mailboxes', 'storage50', 'meetHours10'] as const).map((k) => (
            <div key={k} className="set-row">
              <span>
                <strong>{ADDONS[k].name}</strong>
                <small>
                  {rp(ADDONS[k].price)} {ADDONS[k].unit}
                  {plan.addons[k] ? ` · ${rp(plan.addons[k] * ADDONS[k].price)} a month` : ''}
                </small>
              </span>
              {stepper(k)}
            </div>
          ))}
          <label className="set-row toggle-row">
            <span>
              <strong>{ADDONS.branding.name}</strong>
              <small>
                {rp(ADDONS.branding.price)} a month · your logo only{plan.tier === 'business' ? ' (included in Business)' : ''}
              </small>
            </span>
            <button type="button" role="switch" aria-checked={plan.addons.branding} className={`switch ${plan.addons.branding ? 'on' : ''}`} onClick={() => set({ addons: { ...plan.addons, branding: !plan.addons.branding } })}>
              <span />
            </button>
          </label>
        </div>

        <div className="set-block">
          <h3>Payment</h3>
          <div className="set-row">
            <span>
              <strong>
                <CreditCard size={14} /> {plan.payment?.label ?? 'No payment method yet'}
              </strong>
              <small>QRIS, bank virtual accounts, GoPay, OVO, DANA and cards through Xendit. Cards from abroad through Paddle.</small>
            </span>
            <Select
              value={plan.payment?.method ?? null}
              onChange={(m) => set({ payment: { method: m, label: { qris: 'QRIS', va: 'BCA virtual account', card: 'Visa ending 4242', ewallet: 'GoPay' }[m] } })}
              placeholder="Choose"
              label="Payment method"
              options={[
                { value: 'qris', label: 'QRIS', hint: 'Scan with any bank or e-wallet app' },
                { value: 'va', label: 'Bank virtual account', hint: 'BCA, Mandiri, BNI, BRI' },
                { value: 'ewallet', label: 'E-wallet', hint: 'GoPay, OVO, DANA' },
                { value: 'card', label: 'Card', hint: 'Visa, Mastercard, JCB' },
              ]}
            />
          </div>
          <p className="muted small">If a payment fails we retry and remind you for 14 days, then the workspace becomes read-only. Nothing is ever deleted for a late payment.</p>
        </div>

        <div className="set-block">
          <h3>Invoice details</h3>
          <div className="field-grid">
            <label className="field">
              <span>Company name</span>
              <input value={plan.billing.company} onChange={(e) => set({ billing: { ...plan.billing, company: e.target.value } })} />
            </label>
            <label className="field">
              <span>NPWP</span>
              <input value={plan.billing.npwp ?? ''} onChange={(e) => set({ billing: { ...plan.billing, npwp: e.target.value } })} placeholder="00.000.000.0-000.000" />
            </label>
            <label className="field wide">
              <span>Address</span>
              <input value={plan.billing.address ?? ''} onChange={(e) => set({ billing: { ...plan.billing, address: e.target.value } })} />
            </label>
            <label className="field wide">
              <span>Send invoices to</span>
              <input value={plan.billing.emails.join(', ')} onChange={(e) => set({ billing: { ...plan.billing, emails: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} placeholder="finance@company.com" />
            </label>
          </div>
          <p className="muted small">PPN is shown on every invoice.</p>
        </div>
      </fieldset>

      <div className="set-block">
        <h3>Invoices</h3>
        {invoices.length === 0 ? (
          <p className="muted small">No invoices yet{plan.trialEnds ? ' (you’re on the free trial)' : ''}.</p>
        ) : (
          <div className="inv-table">
            {invoices.map((i) => (
              <div key={i.no} className="inv-row">
                <span>{fmtDate(i.date)}</span>
                <span className="mono">{i.no}</span>
                <span>{rp(i.amount)}</span>
                <span className="ap-tag approved">{i.status}</span>
                <button type="button" className="icon-btn sm" title="Download PDF" onClick={() => toast('The PDF invoice downloads here once billing is live')}>
                  <Download size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {isOwner && plan.tier !== 'free' && (
        <div className="set-block">
          <h3>Pause or cancel</h3>
          <div className="set-row">
            <span>
              <strong>
                <PauseCircle size={14} /> Pause the plan
              </strong>
              <small>For quiet months: up to 3 months a year. The workspace becomes read-only and you’re not billed.</small>
            </span>
            <button type="button" className="ghost-btn sm" onClick={() => (set({ paused: !plan.paused }), toast(plan.paused ? 'Plan resumed' : 'Plan paused. Everyone can still read everything'))}>
              {plan.paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          <div className="set-row">
            <span>
              <strong>
                <XCircle size={14} /> Cancel
              </strong>
              <small>Takes effect at the end of the period. Download everything first if you’d like a copy.</small>
            </span>
            {confirmCancel ? (
              <span className="cancel-confirm">
                <button type="button" className="ghost-btn sm" onClick={onExport}>
                  <Download size={13} /> Export everything
                </button>
                <button type="button" className="danger-btn sm" onClick={() => (onPlan({ ...plan, tier: 'free', track: 'own' }), setConfirmCancel(false), toast('Cancelled. You’ll move to Free at the end of the period'))}>
                  Cancel plan
                </button>
              </span>
            ) : (
              <button type="button" className="ghost-btn sm" onClick={() => setConfirmCancel(true)}>
                Cancel…
              </button>
            )}
          </div>
        </div>
      )}
      <p className="muted small">Seats billed: {seatsFor(plan.tier, people)}.</p>
    </>
  );
}
