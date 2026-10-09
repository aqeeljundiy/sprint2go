import { server } from '../../sync';
import { TabPane } from '../ui/Smooth';
import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, CreditCard, Download, Minus, PauseCircle, Plus, Sparkles, Users, XCircle } from 'lucide-react';
import type { Plan, PlanAdjustment, Tier, Track, Workspace } from '../../types';
import { ADDONS, ALLOWANCE, PAUSE_DAYS_A_YEAR, PLAN_FEATURES, PRICES, TIER_NAME, TOP_UP, TRACK_NAME, addAdjustment, billingPeriod, countedMailboxes, mailboxRoom, meetHours, monthlyTotal, options, pauseDaysLeft, planName, priceFor, prorate, rp, seatsFor, storageGB } from '../../data/pricing';
import { trialPlan } from '../../data/workspaces';
import { Select } from '../ui/Select';
import { brand as product } from '../../terms';
import { getLang, mark, t, tn, tx } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtDate, fmtNumber } from '../../i18n/format';

interface Props {
  ws: Workspace;
  people: number; // everyone on the team (the server says how many were active this month)
  isOwner: boolean;
  onPlan: (p: Plan) => void;
  onExport: () => void;
  toast: (text: string) => void;
}

/** "8 Oct 2026" / "8 Okt 2026". */
const fullDay = (iso: string) => fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });

/** English month names, to read the dates in a switch's saved text ("9 October"). */
const EN_MONTHS = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2000, i, 15)));
/** "9 October" (as the server writes it) in the reader's language. */
const dayIn = (s: string) => {
  const m = /^(\d{1,2}) (\S+)$/.exec(s);
  const i = m ? EN_MONTHS.indexOf(m[2]) : -1;
  return m && i >= 0 ? fmtDate(Date.UTC(2000, i, Number(m[1])), { day: 'numeric', month: 'long', timeZone: 'UTC' }) : s;
};
/** "October" in the reader's language. */
const monthIn = (s: string) => {
  const i = EN_MONTHS.indexOf(s);
  return i >= 0 ? fmtDate(Date.UTC(2000, i, 15), { month: 'long', timeZone: 'UTC' }) : s;
};
/**
 * A prorated switch as the server saved it (in English, as on the invoice) in the reader's language: the same sentences
 * as adjustmentText and addAdjustment (src/data/pricing.ts), read back into their parts. Anything else shows as saved.
 */
function adjustmentLine(text: string): string {
  if (getLang() === 'en') return text;
  let m: RegExpExecArray | null;
  if ((m = /^Plan changes on (.+), back to (.+)$/.exec(text))) return t('Plan changes on {date}, back to {plan}', { date: dayIn(m[1]), plan: m[2] });
  if ((m = /^(.+) instead of (.+) from (.+): the rest of (.+) \((\d+) of (\d+) days\)$/.exec(text)))
    return t('{to} instead of {from} from {date}: {span} ({left} of {days} days)', { to: m[1], from: m[2], date: dayIn(m[3]), span: m[4] === 'the year' ? t('the rest of the year') : t('the rest of {month}', { month: monthIn(m[4]) }), left: m[5], days: m[6] });
  if ((m = /^(.+) instead of (.+) until (.+) \((\d+) of (\d+) days\)$/.exec(text))) return t('{from} instead of {to} until {date} ({before} of {days} days)', { from: m[1], to: m[2], date: dayIn(m[3]), before: m[4], days: m[5] });
  if ((m = /^(.+) from the start of the period$/.exec(text))) return t('{plan} from the start of the period', { plan: m[1] });
  if ((m = /^(.+) from (.+) to (.+), then back to (.+)$/.exec(text))) return t('{plan} from {start} to {end}, then back to {back}', { plan: m[1], start: dayIn(m[2]), end: dayIn(m[3]), back: m[4] });
  if ((m = /^(.+) to (.+) on (.+), then (.+) on (.+), prorated by the days on each$/.exec(text)))
    return t('{from} to {mid} on {date}, then {to} on {then}, prorated by the days on each', { from: m[1], mid: m[2], date: dayIn(m[3]), to: m[4], then: dayIn(m[5]) });
  return text;
}

/** Workspace settings → Billing: the company's own sprint2go subscription. */
export function BillingSection({ ws, people, isOwner, onPlan, onExport, toast }: Props) {
  // `cancel` is a one-time ask to the server (it answers with cancelAt): never carried into the next change.
  const plan: Plan = { ...(ws.plan ?? trialPlan(ws.name, '')), cancel: undefined };
  const [track, setTrack] = useState<Track>(plan.track);
  const [n, setN] = useState(Math.max(1, people));
  const [cycle, setCycle] = useState(plan.cycle);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const set = (p: Partial<Plan>) => onPlan({ ...plan, ...p });
  // Only active people are billed (signed in or used the app this month); the server counts them. Without it: everyone.
  const [active, setActive] = useState<{ people: number; team: number } | null>(null);
  const billed = active?.people ?? people;
  const now = monthlyTotal(plan, billed);
  const trialDays = plan.trialEnds ? Math.max(0, Math.ceil((new Date(plan.trialEnds).getTime() - Date.now()) / 86_400_000)) : 0;
  const opts = options(track, n);
  const best = opts[0];
  const yearly = (m: number) => m * 10;
  const nextInvoice = new Date();
  nextInvoice.setMonth(nextInvoice.getMonth() + 1, 1);

  // Real invoices from the server, and how to pay them (only what's real: our bank details, or nothing yet); the demo
  // (no server) shows a sample history.
  const [real, setReal] = useState<{ id: string; number: string; period: string; total: number; status: string; dueAt: string; paidAt: string | null; overdue: boolean; credits?: boolean }[] | null>(null);
  const [pay, setPay] = useState<{ bank: string | null; payee: string | null; graceDays: number } | null>(null);
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  useEffect(() => {
    if (!server.on) return;
    fetch(`/api/billing/invoices?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : { invoices: [] }))
      .then((d: { invoices: typeof real; pay?: typeof pay; active?: typeof active }) => (setReal(d.invoices ?? []), setPay(d.pay ?? null), setActive(d.active ?? null)), () => setReal([]));
  }, [ws.id, plan.cancelAt, plan.tier]);
  // What the plan has room for, and what's used: hosted mailboxes (here), meeting-bot hours (from the server).
  const room = mailboxRoom(plan, people);
  const boxesUsed = countedMailboxes(ws.accounts ?? [], room.sharedFree);
  const [botMinutes, setBotMinutes] = useState<{ used: number; total: number | null } | null>(null);
  useEffect(() => {
    if (!server.on) return;
    void fetch(`/api/meet/status?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { minutes?: { used: number; total: number | null } } | null) => setBotMinutes(d?.minutes ?? null), () => {});
  }, [ws.id]);
  // The last switches shown stay while their block folds away.
  const lastAdjustments = useRef<PlanAdjustment[]>([]);
  if (plan.adjustments?.length) lastAdjustments.current = plan.adjustments;
  const shownAdjustments = plan.adjustments?.length ? plan.adjustments : lastAdjustments.current;
  const pauseLeft = Math.ceil(pauseDaysLeft(plan.pauses));
  const trialOn = !!plan.trialEnds && plan.trialEnds > new Date().toISOString();
  const applyCode = async () => {
    setCodeBusy(true);
    const r = await fetch('/api/billing/coupon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, code }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setCodeBusy(false);
    const error = (d as { error?: string }).error;
    if (!r?.ok) return toast(error ? t(error) : t('That code didn’t work.'));
    setCode('');
    toast(t('Code applied. You’ll see it on your next invoice.'));
  };
  const sample = server.on ? [] : plan.tier === 'free' || plan.trialEnds
    ? []
    : [0, 1, 2].map((i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i, 1);
        return { no: `S2G-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${ws.id.toUpperCase()}`, date: d.toISOString(), amount: now.total * (plan.cycle === 'yearly' ? 10 : 1), status: mark('Paid') };
      });

  const choose = (tier: Tier) => {
    onPlan({ ...plan, track, tier, cycle, trialEnds: undefined, paused: false });
    toast(switchToast(tier));
  };
  /**
   * What the toast says about money after a switch: the same proration the server records (src/data/pricing.ts), with
   * any earlier switch this period folded in, so switching back says nothing changes.
   */
  const switchToast = (tier: Tier) => {
    const name = planName({ track, tier });
    const period = billingPeriod(plan);
    const invoiced = !!real?.some((i) => i.period === period.key && !i.credits && i.status !== 'void');
    const a = prorate(plan, { track, tier, cycle }, billed, new Date(), invoiced);
    if (!a)
      return `${cycle === 'yearly' ? t('Switched to {plan}, billed yearly.', { plan: name }) : t('Switched to {plan}.', { plan: name })} ${cycle !== plan.cycle ? t('The new price starts with the next invoice.') : t('The new price is on the next invoice.')}`;
    const net = addAdjustment(plan.adjustments, a, 'preview')?.find((x) => x.period === a.period && x.invoiced === a.invoiced);
    const month = fmtDate(period.start, { month: 'long', timeZone: 'UTC' });
    if (!net || !net.amount) return t('Switched back to {plan}. Nothing changes on your next invoice.', { plan: name });
    if (!invoiced)
      return net.amount < 0
        ? t('Switched to {plan}. {month}’s invoice bills {plan}, less {amount} for the days before the switch.', { plan: name, month, amount: rp(-net.amount) })
        : t('Switched to {plan}. {month}’s invoice bills {plan}, plus {amount} for the days before the switch.', { plan: name, month, amount: rp(net.amount) });
    return net.amount > 0
      ? t('Switched to {plan}. {amount} for the rest of {month} goes on your next invoice.', { plan: name, amount: rp(net.amount), month })
      : t('Switched to {plan}. A credit of {amount} for the rest of {month} goes on your next invoice.', { plan: name, amount: rp(-net.amount), month });
  };
  const stepper = (key: 'mailboxes' | 'storage50' | 'meetHours10') => (
    <span className="stepper">
      <button type="button" className="icon-btn sm" disabled={!plan.addons[key]} onClick={() => set({ addons: { ...plan.addons, [key]: Math.max(0, plan.addons[key] - 1) } })} aria-label={tx('stepper', 'Less')}>
        <Minus size={13} />
      </button>
      <b>{plan.addons[key]}</b>
      <button type="button" className="icon-btn sm" onClick={() => set({ addons: { ...plan.addons, [key]: plan.addons[key] + 1 } })} aria-label={tx('stepper', 'More')}>
        <Plus size={13} />
      </button>
    </span>
  );

  return (
    <>
      <h2>{t('Billing')}</h2>
      <p className="set-intro">{t('Your company’s {product} subscription: plan, people, add-ons, payment and invoices.', { product: product.name })}</p>
      {!isOwner && <p className="modal-note">{t('Only owners can change billing. You can see the plan and invoices.')}</p>}

      <div className="plan-card">
        <div className="pc-main">
          <span className="pc-kicker">{plan.trialEnds ? tn(trialDays, 'Free trial · {n} day left', 'Free trial · {n} days left') : plan.paused ? t('Paused') : t('Current plan')}</span>
          <h3>
            {planName(plan)} <span className="pc-track">{plan.tier === 'free' ? t('your own AI keys') : TRACK_NAME[plan.track]}</span>
          </h3>
          <p className="muted">
            {[
              active && active.team > billed ? t('{n} of {team} people active this month', { n: billed, team: active.team }) : tn(billed, '{n} active person', '{n} active people'),
              ...(plan.tier !== 'free' && plan.tier !== 'small' ? [t('{n} included', { n: PRICES[plan.track][plan.tier].included })] : []),
              t('{size} storage', { size: storageGB(plan, people) >= 1024 ? `${fmtNumber(Math.round(storageGB(plan, people) / 1024))} TB` : `${fmtNumber(storageGB(plan, people))} GB` }),
              meetHours(plan, people) === Infinity ? t('unlimited meeting-bot hours') : tn(meetHours(plan, people), '{n} meeting-bot hour', '{n} meeting-bot hours'),
            ].join(' · ')}
          </p>
        </div>
        <div className="pc-price">
          {plan.trialEnds ? (
            <>
              <b>Rp 0</b>
              <small>{t('until {date}, then Free unless you pick a plan', { date: fullDay(plan.trialEnds) })}</small>
            </>
          ) : (
            <>
              <b>{rp(plan.cycle === 'yearly' ? yearly(now.total) : now.total)}</b>
              <small>
                {plan.cycle === 'yearly' ? t('per year') : t('per month')}
                {now.addons ? ` ${t('(plan {base} + add-ons {addons})', { base: rp(now.base), addons: rp(now.addons) })}` : ''}
                {plan.tier !== 'free' ? ` · ${t('next invoice {date}', { date: fullDay(nextInvoice.toISOString()) })}` : ''}
              </small>
            </>
          )}
        </div>
      </div>
      {/* Prorated switches waiting for the next invoice: folds open and closed (a switch back leaves nothing). */}
      <div className={`fold ${plan.adjustments?.length ? 'open' : ''}`}>
        <div>
          {!!shownAdjustments.length && (
            <div className="next-invoice">
              <span className="ni-head">{t('On your next invoice')}</span>
              {shownAdjustments.map((a) => (
                <div key={a.id} className="ni-row">
                  <span>{adjustmentLine(a.text)}</span>
                  <b className={a.amount < 0 ? 'credit' : ''}>{a.amount < 0 ? t('−{amount} credit', { amount: rp(-a.amount) }) : rp(a.amount)}</b>
                </div>
              ))}
              <small>{t('Plan switches are prorated: you pay each plan only for the days you had it.')}</small>
            </div>
          )}
        </div>
      </div>
      {plan.tier === 'free' && plan.trialRefused && (
        <p className="trial-note">
          <Sparkles size={14} /> {t('{company} started on Free instead of a trial.', { company: ws.name })} {plan.trialRefused}
        </p>
      )}
      {plan.trialEnds && (
        <p className="trial-note">
          <Sparkles size={14} /> {t('You’re trying Studio AI: every feature and the full AI allowance. When the trial ends nothing is deleted. You move to Free, and anything beyond Free waits for an upgrade.')}
        </p>
      )}

      <fieldset className="plain" disabled={!isOwner}>
        <div className="set-block">
          <h3>{t('Choose a plan')}</h3>
          <div className="plan-controls">
            <div className="segmented">
              {(['own', 'ai'] as Track[]).map((tr) => (
                <button key={tr} type="button" className={track === tr ? 'on' : ''} onClick={() => setTrack(tr)}>
                  {TRACK_NAME[tr]}
                </button>
              ))}
            </div>
            <div className="segmented">
              <button type="button" className={cycle === 'monthly' ? 'on' : ''} onClick={() => setCycle('monthly')}>
                {t('Monthly')}
              </button>
              <button type="button" className={cycle === 'yearly' ? 'on' : ''} onClick={() => setCycle('yearly')}>
                {t('Yearly · 2 months free')}
              </button>
            </div>
          </div>
          <label className="people-slider">
            <Users size={15} />
            <span>
              <b>{fmtNumber(n)}</b> {tn(n, 'person', 'people')}
            </span>
            <input type="range" min={1} max={120} value={n} onChange={(e) => setN(Number(e.target.value))} />
          </label>
          <p className="muted small">
            {track === 'own'
              ? t('Your AI provider bills you directly; {product} costs less.', { product: product.name })
              : t('AI included: per person about {braindumps} brain dumps, {questions} questions, {hours} meeting hours, {summaries} summaries and {drafts} drafts a month, shared by everyone.', {
                  braindumps: ALLOWANCE.braindump,
                  questions: ALLOWANCE.ask,
                  hours: ALLOWANCE.meetingHours,
                  summaries: ALLOWANCE.summary,
                  drafts: ALLOWANCE.draft,
                })}
            {track === 'own' && n <= 5 ? ` ${t('Up to 5 people can also use Free.')}` : ''}
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
                    {isBest && <em>{t('Cheapest for {n}', { n: fmtNumber(n) })}</em>}
                  </span>
                  <b>{price === null ? t('Up to 9 people') : rp(cycle === 'yearly' ? yearly(price) : price)}</b>
                  <small>
                    {price === null ? t('Too many people for this one') : cycle === 'yearly' ? t('per year') : t('per month')}
                    {' · '}
                    {tier === 'small' ? t('{price} per person', { price: rp(p.base) }) : t('{n} included, then {price} each', { n: p.included, price: rp(p.extra) })}
                  </small>
                  <ul>
                    {PLAN_FEATURES[tier].map((f) => (
                      <li key={f}>{t(f)}</li>
                    ))}
                  </ul>
                  {current ? (
                    <span className="tier-current">
                      <CheckCircle2 size={14} /> {t('Your plan')}
                    </span>
                  ) : (
                    <button type="button" className={isBest ? 'primary-btn sm' : 'ghost-btn sm'} disabled={price === null} onClick={() => choose(tier)}>
                      {t('Switch to {plan}', { plan: planName({ track, tier }) })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            {t('You never pay more than the next package: if extra people make a bigger package cheaper, we move you to it and tell you. Only active people are billed. Guests and shared inboxes are always free.')}
          </p>
          {plan.tier !== 'free' && (
            <button type="button" className="link-btn" onClick={() => (onPlan({ ...plan, tier: 'free', track: 'own', trialEnds: undefined }), toast(t('Moved to Free. Nothing was deleted')))}>
              {t('Downgrade to Free')}
            </button>
          )}
        </div>

        {plan.track === 'ai' && plan.tier !== 'free' && (
          <div className="set-block">
            <h3>{t('AI top-ups')}</h3>
            <div className="set-row">
              <span>
                <strong>{t('{price} adds {gives}', { price: rp(TOP_UP.price), gives: TOP_UP.gives })}</strong>
                <small>{t('For busy months. Light jobs (reply suggestions, email to-dos) keep working on a cheap model even when the allowance runs out.')}</small>
              </span>
              <button type="button" className="ghost-btn sm" onClick={() => (set({ topUps: (plan.topUps ?? 0) + 1 }), toast(t('Top-up added. {price} on the next invoice', { price: rp(TOP_UP.price) })))}>
                {t('Buy a top-up')}
              </button>
            </div>
            <label className="set-row toggle-row">
              <span>
                <strong>{t('Top up automatically')}</strong>
                <small>{t('When the allowance runs out, up to a monthly limit')}</small>
              </span>
              <button type="button" role="switch" aria-checked={!!plan.autoTopUp?.on} className={`switch ${plan.autoTopUp?.on ? 'on' : ''}`} onClick={() => set({ autoTopUp: { on: !plan.autoTopUp?.on, limit: plan.autoTopUp?.limit ?? 297_000 } })}>
                <span />
              </button>
            </label>
            {plan.autoTopUp?.on && (
              <div className="set-row">
                <span>
                  <strong>{t('Monthly limit')}</strong>
                </span>
                <Select value={String(plan.autoTopUp.limit)} onChange={(v) => set({ autoTopUp: { on: true, limit: Number(v) } })} label={t('Monthly limit')} options={[1, 3, 5, 10].map((k) => ({ value: String(k * TOP_UP.price), label: `${rp(k * TOP_UP.price)} (${tn(k, '{n} top-up', '{n} top-ups')})` }))} />
              </div>
            )}
          </div>
        )}

        <div className="set-block">
          <h3>{t('Add-ons')}</h3>
          {(['mailboxes', 'storage50', 'meetHours10'] as const).map((k) => (
            <div key={k} className="set-row">
              <span>
                <strong>{ADDONS[k].name}</strong>
                <small>
                  {rp(ADDONS[k].price)} {ADDONS[k].unit}
                  {plan.addons[k] ? ` · ${t('{price} a month', { price: rp(plan.addons[k] * ADDONS[k].price) })}` : ''}
                </small>
                {k === 'mailboxes' && (
                  <small className={`use-line ${boxesUsed > room.total ? 'over' : ''}`}>
                    {room.sharedFree
                      ? tn(room.total, '{used} of {n} hosted mailbox in use ({included} come with the plan; shared inboxes are free)', '{used} of {n} hosted mailboxes in use ({included} come with the plan; shared inboxes are free)', { used: boxesUsed, included: room.included })
                      : tn(room.total, '{used} of {n} hosted mailbox in use (on Free, every hosted mailbox is an add-on)', '{used} of {n} hosted mailboxes in use (on Free, every hosted mailbox is an add-on)', { used: boxesUsed })}
                    {boxesUsed > room.total ? `. ${tn(boxesUsed - room.total, '{n} receives mail but can’t send until there’s room', '{n} receive mail but can’t send until there’s room')}` : ''}
                  </small>
                )}
                {k === 'meetHours10' && botMinutes?.total != null && (
                  <small className={`use-line ${botMinutes.used >= botMinutes.total ? 'over' : ''}`}>
                    {botMinutes.used >= botMinutes.total
                      ? t('{used} of {total} notetaker hours used this month: the notetaker waits until the 1st or more hours', { used: fmtNumber(Math.round(botMinutes.used / 6) / 10), total: fmtNumber(botMinutes.total / 60) })
                      : t('{used} of {total} notetaker hours used this month', { used: fmtNumber(Math.round(botMinutes.used / 6) / 10), total: fmtNumber(botMinutes.total / 60) })}
                  </small>
                )}
              </span>
              {stepper(k)}
            </div>
          ))}
          <label className="set-row toggle-row">
            <span>
              <strong>{ADDONS.branding.name}</strong>
              <small>
                {t('{price} a month', { price: rp(ADDONS.branding.price) })} · {plan.tier === 'business' ? t('your logo only (included in Business)') : t('your logo only')}
              </small>
            </span>
            <button type="button" role="switch" aria-checked={plan.addons.branding} className={`switch ${plan.addons.branding ? 'on' : ''}`} onClick={() => set({ addons: { ...plan.addons, branding: !plan.addons.branding } })}>
              <span />
            </button>
          </label>
        </div>

        {server.on ? (
          // A real server shows only what's real: bank transfer to our account (from the operators' settings), or
          // nothing until those details exist. There's no card processor, so no card or wallet to pick.
          pay?.bank ? (
            <div className="set-block">
              <h3>{t('Payment')}</h3>
              <div className="set-row">
                <span>
                  <strong>
                    <CreditCard size={14} /> {t('Bank transfer')}
                  </strong>
                  <small>
                    {pay.payee
                      ? t('To {payee}, {bank}. Use the invoice number as the reference. Each invoice also goes to the emails below.', { payee: pay.payee, bank: pay.bank })
                      : t('To {bank}. Use the invoice number as the reference. Each invoice also goes to the emails below.', { bank: pay.bank })}
                  </small>
                </span>
              </div>
              <p className="muted small">
                {pay.graceDays > 0
                  ? tn(pay.graceDays, 'An invoice still unpaid {n} day after it’s due makes the workspace read-only until it’s paid. Nothing is ever deleted for a late payment.', 'An invoice still unpaid {n} days after it’s due makes the workspace read-only until it’s paid. Nothing is ever deleted for a late payment.')
                  : t('Nothing is ever deleted for a late payment.')}
              </p>
            </div>
          ) : null
        ) : (
          // DEMO ONLY: a pretend payment method, to show where it will go; never on a real server (!server.on).
          !server.on && (
            <div className="set-block">
              <h3>{t('Payment')}</h3>
              <div className="set-row">
                <span>
                  <strong>
                    <CreditCard size={14} /> {plan.payment?.label ? t(plan.payment.label) : t('No payment method yet')}
                  </strong>
                  <small>{t('QRIS, bank virtual accounts, GoPay, OVO, DANA and cards through Xendit. Cards from abroad through Paddle.')}</small>
                </span>
                <Select
                  value={plan.payment?.method ?? null}
                  onChange={(m) => set({ payment: { method: m, label: { qris: 'QRIS', va: mark('BCA virtual account'), card: mark('Visa ending 4242'), ewallet: 'GoPay' }[m] } })}
                  placeholder={t('Choose')}
                  label={t('Payment method')}
                  options={[
                    { value: 'qris', label: 'QRIS', hint: t('Scan with any bank or e-wallet app') },
                    { value: 'va', label: t('Bank virtual account'), hint: 'BCA, Mandiri, BNI, BRI' },
                    { value: 'ewallet', label: t('E-wallet'), hint: 'GoPay, OVO, DANA' },
                    { value: 'card', label: t('Card'), hint: 'Visa, Mastercard, JCB' },
                  ]}
                />
              </div>
              <p className="muted small">{t('If a payment fails we retry and remind you for 14 days, then the workspace becomes read-only. Nothing is ever deleted for a late payment.')}</p>
            </div>
          )
        )}

        <div className="set-block">
          <h3>{t('Invoice details')}</h3>
          <div className="field-grid">
            <label className="field">
              <span>{t('Company name')}</span>
              <input value={plan.billing.company} onChange={(e) => set({ billing: { ...plan.billing, company: e.target.value } })} />
            </label>
            <label className="field">
              <span>NPWP</span>
              <input value={plan.billing.npwp ?? ''} onChange={(e) => set({ billing: { ...plan.billing, npwp: e.target.value } })} placeholder="00.000.000.0-000.000" />
            </label>
            <label className="field wide">
              <span>{t('Address')}</span>
              <input value={plan.billing.address ?? ''} onChange={(e) => set({ billing: { ...plan.billing, address: e.target.value } })} />
            </label>
            <label className="field wide">
              <span>{t('Send invoices to')}</span>
              <input value={plan.billing.emails.join(', ')} onChange={(e) => set({ billing: { ...plan.billing, emails: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} placeholder={t('finance@company.com')} />
            </label>
          </div>
          <p className="muted small">{t('PPN is shown on every invoice.')}</p>
        </div>
      </fieldset>

      <div className="set-block">
        <h3>{t('Invoices')}</h3>
        {isOwner && plan.tier !== 'free' && (
          <div className="bill-code">
            {plan.discount ? (
              <span className="small">
                {tj('Code {code}: {off}', {
                  code: <strong>{plan.discount.code}</strong>,
                  off:
                    plan.discount.kind === 'percent'
                      ? plan.discount.until
                        ? t('{value}% off until {date}', { value: plan.discount.value, date: fullDay(plan.discount.until) })
                        : t('{value}% off', { value: plan.discount.value })
                      : plan.discount.until
                        ? t('{amount} off a month until {date}', { amount: rp(plan.discount.value), date: fullDay(plan.discount.until) })
                        : t('{amount} off a month', { amount: rp(plan.discount.value) }),
                })}
              </span>
            ) : plan.comp?.until && plan.comp.until > new Date().toISOString() ? (
              <span className="small">
                {t('Free until {date}', { date: fullDay(plan.comp.until) })}
                {plan.comp.note ? ` (${plan.comp.note})` : ''}
              </span>
            ) : (
              <>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('Have a code?')} aria-label={t('Discount code')} onKeyDown={(e) => e.key === 'Enter' && code.trim() && void applyCode()} />
                <button type="button" className="ghost-btn sm" disabled={!code.trim() || codeBusy || !server.on} onClick={() => void applyCode()}>
                  {t('Apply')}
                </button>
              </>
            )}
          </div>
        )}
        {server.on && real === null ? (
          <p className="muted small">{t('Loading invoices…')}</p>
        ) : server.on && real ? (
          real.length === 0 ? (
            <p className="muted small">{plan.trialEnds ? t('No invoices yet (you’re on the free trial).') : t('No invoices yet.')}</p>
          ) : (
            <div className="inv-table">
              {real.map((i) => (
                <div key={i.id} className="inv-row">
                  <span>{fullDay(i.period + '-01')}</span>
                  <span className="mono">{i.number}</span>
                  <span>{rp(i.total)}</span>
                  <span className={`ap-tag ${i.status === 'paid' ? 'approved' : i.overdue ? 'changes' : ''}`}>{i.status === 'paid' ? t('Paid') : i.overdue ? t('Overdue') : i.status === 'void' ? t('Void') : t('Due {date}', { date: fmtDate(i.dueAt, { day: 'numeric', month: 'short' }) })}</span>
                  <a className="icon-btn sm" title={t('Open the invoice')} aria-label={t('Open the invoice')} href={`/api/billing/invoice?id=${encodeURIComponent(i.id)}`} target="_blank" rel="noreferrer">
                    <Download size={14} />
                  </a>
                </div>
              ))}
            </div>
          )
        ) : sample.length === 0 ? (
          <p className="muted small">{plan.trialEnds ? t('No invoices yet (you’re on the free trial).') : t('No invoices yet.')}</p>
        ) : (
          <div className="inv-table">
            {sample.map((i) => (
              <div key={i.no} className="inv-row">
                <span>{fullDay(i.date)}</span>
                <span className="mono">{i.no}</span>
                <span>{rp(i.amount)}</span>
                <span className="ap-tag approved">{t(i.status)}</span>
                <button type="button" className="icon-btn sm" title={t('Download PDF')} onClick={() => toast(t('The PDF invoice downloads here once billing is live'))}>
                  <Download size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* A paid plan only: during the trial there's nothing billed to pause, and "Downgrade to Free" is the way out. */}
      {isOwner && plan.tier !== 'free' && !trialOn && (
        <div className="set-block">
          <h3>{t('Pause or cancel')}</h3>
          <div className="set-row">
            <span>
              <strong>
                <PauseCircle size={14} /> {t('Pause the plan')}
              </strong>
              <small>
                {plan.paused
                  ? t('Paused: the workspace is read-only and not billed. {left} of this year’s {total} days are left; when they run out, the plan resumes by itself.', { left: pauseLeft, total: PAUSE_DAYS_A_YEAR })
                  : pauseLeft < 1
                      ? t('Up to 3 months a year, and this year’s {total} days are used up.', { total: PAUSE_DAYS_A_YEAR })
                      : tn(pauseLeft, 'For quiet months: up to 3 months a year ({n} day left this year). The workspace becomes read-only and you’re not billed.', 'For quiet months: up to 3 months a year ({n} days left this year). The workspace becomes read-only and you’re not billed.')}
              </small>
            </span>
            <button type="button" className="ghost-btn sm" disabled={!plan.paused && pauseLeft < 1} onClick={() => (set({ paused: !plan.paused }), toast(plan.paused ? t('Plan resumed') : t('Plan paused. Everyone can still read and export everything')))}>
              {plan.paused ? t('Resume') : t('Pause')}
            </button>
          </div>
          <TabPane key={plan.cancelAt ? 'cancelled' : 'running'}>
          {plan.cancelAt ? (
            <div className="set-row">
              <span>
                <strong>
                  <XCircle size={14} /> {t('Cancelled')}
                </strong>
                <small>{t('Moves to Free on {date}. Until then everything works as it does now, and nothing is deleted after.', { date: fullDay(plan.cancelAt) })}</small>
              </span>
              <button type="button" className="ghost-btn sm" onClick={() => (onPlan({ ...plan, cancel: false, cancelAt: undefined }), toast(t('The plan stays as it is')))}>
                {t('Keep the plan')}
              </button>
            </div>
          ) : (
            <div className="set-row">
              <span>
                <strong>
                  <XCircle size={14} /> {tx('plan', 'Cancel')}
                </strong>
                <small>{t('Takes effect at the end of the period that’s paid for. Download everything first if you’d like a copy.')}</small>
              </span>
              {confirmCancel ? (
                <span className="cancel-confirm">
                  <button type="button" className="ghost-btn sm" onClick={onExport}>
                    <Download size={13} /> {t('Export everything')}
                  </button>
                  <button type="button" className="danger-btn sm" onClick={() => (onPlan({ ...plan, cancel: true, cancelAt: plan.cancelAt ?? nextInvoice.toISOString() }), setConfirmCancel(false), toast(t('Cancelled. You’ll move to Free at the end of the period')))}>
                    {t('Cancel plan')}
                  </button>
                </span>
              ) : (
                <button type="button" className="ghost-btn sm" onClick={() => setConfirmCancel(true)}>
                  {t('Cancel…')}
                </button>
              )}
            </div>
          )}
          </TabPane>
        </div>
      )}
      <p className="muted small">{t('Seats billed: {n}.', { n: fmtNumber(seatsFor(plan.tier, billed)) })}</p>
    </>
  );
}
