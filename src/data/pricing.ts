import type { Plan, PlanAdjustment, Tier, Track } from '../types';
// The full paths: the server imports this file, and Node can't import a folder (server/register.mjs only adds ".ts").
import { mark, t } from '../i18n/index';
import { fmtDate } from '../i18n/format';

/** Rupiah prices from PLAN.md. Per month; yearly = 10 months. */
export const PRICES: Record<Track, Record<Exclude<Tier, 'free'>, { base: number; included: number; extra: number; perPerson?: boolean }>> = {
  own: {
    small: { base: 39_000, included: 1, extra: 39_000, perPerson: true },
    studio: { base: 399_000, included: 10, extra: 39_000 },
    agency: { base: 999_000, included: 30, extra: 35_000 },
    business: { base: 2_499_000, included: 80, extra: 29_000 },
  },
  ai: {
    small: { base: 89_000, included: 1, extra: 89_000, perPerson: true },
    studio: { base: 899_000, included: 10, extra: 89_000 },
    agency: { base: 2_499_000, included: 30, extra: 79_000 },
    business: { base: 6_499_000, included: 80, extra: 79_000 },
  },
};

export const TIER_NAME: Record<Tier, string> = { free: 'Free', small: 'Small', studio: 'Studio', agency: 'Agency', business: 'Business' };
/** The two tracks in the reader's language (getters: read while rendering). */
export const TRACK_NAME: Record<Track, string> = {
  get own() {
    return t('Own AI keys');
  },
  get ai() {
    return t('AI included');
  },
};
export const planName = (p: Pick<Plan, 'track' | 'tier'>) => (p.tier === 'free' ? 'Free' : `${TIER_NAME[p.tier]}${p.track === 'ai' ? ' AI' : ''}`);

// Names and units are getters, in the reader's language (the server reads them in English).
export const ADDONS = {
  mailboxes: {
    get name() {
      return t('Hosted mailbox (10 GB)');
    },
    price: 15_000,
    get unit() {
      return t('per mailbox');
    },
  },
  storage50: {
    get name() {
      return t('Extra 50 GB storage');
    },
    price: 39_000,
    get unit() {
      return t('per 50 GB');
    },
  },
  meetHours10: {
    get name() {
      return t('Meeting bot, 10 more hours');
    },
    price: 49_000,
    get unit() {
      return t('per 10 hours');
    },
  },
  branding: {
    get name() {
      return t('Remove “Made with sprint2go” from shared spaces');
    },
    price: 49_000,
    get unit() {
      return t('per month');
    },
  },
} as const;

/** The branding add-on, or Business, which includes it. A company's own address for its guests goes live only with it. */
export const hasBranding = (plan?: { tier?: string; addons?: { branding?: boolean } } | null) => plan?.tier === 'business' || !!plan?.addons?.branding;

export const TOP_UP = {
  price: 99_000,
  get gives() {
    return t('about 50 meeting hours, or 110 Ask AI questions, or 120 brain dumps, or 600 email summaries');
  },
};

/** Boosted sending credits: one per email to an outside address. Paid by bank transfer until card payments exist. */
export const MAIL_PACKS = [
  { n: 1000, price: 15_000 },
  { n: 5000, price: 59_000 },
  { n: 25_000, price: 249_000 },
] as const;

/** A plan can be paused this many days in any 365 (the billing page says "up to 3 months a year"). */
export const PAUSE_DAYS_A_YEAR = 90;
/** Days paused in the 365 days before `at` (an open pause counts up to `at`). */
export function pauseDaysUsed(pauses: { from: string; to?: string }[] | undefined, at = Date.now()) {
  const start = at - 365 * 86_400_000;
  let ms = 0;
  for (const p of pauses ?? []) {
    const a = Math.max(start, Date.parse(p.from));
    const b = Math.min(at, p.to ? Date.parse(p.to) : at);
    if (b > a) ms += b - a;
  }
  return ms / 86_400_000;
}
export const pauseDaysLeft = (pauses: { from: string; to?: string }[] | undefined, at = Date.now()) => Math.max(0, PAUSE_DAYS_A_YEAR - pauseDaysUsed(pauses, at));

/**
 * Hosted mailboxes a plan has room for. Paid plans (and the trial) include one personal mailbox per person, and
 * shared inboxes are free; on Free every hosted mailbox is an add-on. Mailbox add-ons add to either.
 */
export function mailboxRoom(plan: Pick<Plan, 'tier' | 'addons' | 'trialEnds'>, people: number, at = new Date().toISOString()) {
  const trial = !!plan.trialEnds && plan.trialEnds > at;
  const free = plan.tier === 'free' && !trial;
  const included = free ? 0 : seatsFor(trial ? 'studio' : plan.tier, people);
  return { included, addon: plan.addons?.mailboxes ?? 0, total: included + (plan.addons?.mailboxes ?? 0), sharedFree: !free };
}
/** The hosted mailboxes that use that room (temporary addresses and mailboxes kept at Google or Microsoft don't). */
export const countedMailboxes = (accounts: { email?: string; kind?: string; provider?: string; temp?: unknown }[], sharedFree: boolean) =>
  accounts.filter((a) => !!a.email && !a.temp && (!a.provider || a.provider === 'sprint2go') && !(sharedFree && a.kind === 'shared')).length;

/** What each person adds to the company's shared AI allowance on "AI included" plans (per month). */
export const ALLOWANCE = { braindump: 10, ask: 20, meetingHours: 6, summary: 50, draft: 30 };

export const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

/** Prices can be changed from the operator backend without a release: the server and the app apply the same override. */
export interface PricingOverride {
  prices?: Partial<Record<Track, Partial<Record<Exclude<Tier, 'free'>, Partial<{ base: number; included: number; extra: number }>>>>>;
  addons?: Partial<Record<keyof typeof ADDONS, number>>;
  topUp?: number;
}
export const DEFAULT_PRICES = JSON.parse(JSON.stringify({ prices: PRICES, addons: Object.fromEntries(Object.entries(ADDONS).map(([k, v]) => [k, v.price])), topUp: TOP_UP.price }));
export function applyPricing(o: PricingOverride | null | undefined) {
  if (!o) return;
  for (const track of Object.keys(o.prices ?? {}) as Track[]) for (const tier of Object.keys(o.prices![track] ?? {}) as Exclude<Tier, 'free'>[]) Object.assign(PRICES[track][tier], o.prices![track]![tier]);
  for (const [k, v] of Object.entries(o.addons ?? {})) if (typeof v === 'number' && k in ADDONS) (ADDONS as unknown as Record<string, { price: number }>)[k].price = v;
  if (typeof o.topUp === 'number') (TOP_UP as { price: number }).price = o.topUp;
}

/** What a discount takes off a monthly total (a code applied by the company or given by Sprint2go). */
export function discountOf(plan: Plan, total: number, at = new Date().toISOString()) {
  const d = plan.discount;
  if (!d || (d.until && d.until < at)) return 0;
  return Math.min(total, d.kind === 'percent' ? Math.round((total * d.value) / 100) : d.value);
}

/** Price of one package for n people (null when the package can't hold them). */
export function priceFor(track: Track, tier: Tier, people: number): number | null {
  if (tier === 'free') return track === 'own' && people <= 5 ? 0 : null;
  const p = PRICES[track][tier];
  if (tier === 'small') return people <= 9 ? people * p.base : null;
  return p.base + Math.max(0, people - p.included) * p.extra;
}

/** Every package for n people, cheapest first. The "never pay more than the next package" rule picks the first. */
export function options(track: Track, people: number) {
  return (['small', 'studio', 'agency', 'business'] as Tier[])
    .map((tier) => ({ tier, price: priceFor(track, tier, people) }))
    .filter((o): o is { tier: Tier; price: number } => o.price !== null)
    .sort((a, b) => a.price - b.price);
}

/** People the package pays for (at least the included seats). */
export const seatsFor = (tier: Tier, people: number) => (tier === 'free' || tier === 'small' ? people : Math.max(people, PRICES.own[tier].included));

/** Storage pool in GB. */
export function storageGB(plan: Plan, people: number) {
  const base = plan.tier === 'free' ? 5 : plan.tier === 'small' ? 20 * people : plan.tier === 'studio' ? 250 : plan.tier === 'agency' ? 1024 : 3072;
  return base + plan.addons.storage50 * 50 + plan.addons.mailboxes * 10;
}

/** Meeting bot hours per month (Free 2; paid plans 10 per person on AI plans, unlimited on Business). */
export function meetHours(plan: Plan, people: number) {
  if (plan.tier === 'business') return Infinity;
  const base = plan.tier === 'free' ? 2 : plan.track === 'ai' ? 10 * seatsFor(plan.tier, people) : 4 * seatsFor(plan.tier, people);
  return base + plan.addons.meetHours10 * 10;
}

export function monthlyTotal(plan: Plan, people: number) {
  const base = priceFor(plan.track, plan.tier, people) ?? 0;
  const addons =
    plan.addons.mailboxes * ADDONS.mailboxes.price +
    plan.addons.storage50 * ADDONS.storage50.price +
    plan.addons.meetHours10 * ADDONS.meetHours10.price +
    (plan.addons.branding ? ADDONS.branding.price : 0);
  return { base, addons, total: base + addons };
}

/** English, as the landing page looks them up; the app shows them with t(f). */
export const PLAN_FEATURES: Record<Tier, string[]> = {
  free: [mark('5 people, 1 team'), mark('AI with your own keys'), mark('90 days of visible history'), mark('5 GB storage, 2 meeting-bot hours'), mark('1 guest')],
  small: [mark('For 1 to 9 people'), mark('Every app, hosted email'), mark('Guests and shared spaces'), mark('20 GB storage per person')],
  studio: [mark('10 people included'), mark('Hosted email, every app'), mark('Guests and shared spaces'), mark('250 GB shared storage')],
  agency: [mark('30 people included'), mark('1 TB shared storage'), mark('Permissions and retention rules')],
  business: [mark('80 people included'), mark('3 TB shared storage'), mark('SSO, audit log, priority support'), mark('Unlimited meeting bot')],
};


/* ---------- plan switches, prorated (the server records them; the billing page and the toast say the same) ---------- */

const DAY_MS = 86_400_000;
/** The period a plan's invoice covers at a moment: the calendar month, or (yearly) the year from its start date. */
export function billingPeriod(plan: Pick<Plan, 'cycle' | 'since'>, at = new Date()) {
  if (plan.cycle === 'yearly' && plan.since) {
    const s = new Date(plan.since);
    let y = at.getUTCFullYear();
    let start = Date.UTC(y, s.getUTCMonth(), s.getUTCDate());
    if (start > at.getTime()) start = Date.UTC(--y, s.getUTCMonth(), s.getUTCDate());
    return { start, end: Date.UTC(y + 1, s.getUTCMonth(), s.getUTCDate()), key: new Date(start).toISOString().slice(0, 7) };
  }
  const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  return { start, end: Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1), key: new Date(start).toISOString().slice(0, 7) };
}
/** What a plan costs for one whole period (the plan itself; add-ons are their own lines). */
const periodPrice = (plan: Pick<Plan, 'track' | 'tier' | 'cycle'>, people: number) => (priceFor(plan.track, plan.tier, people) ?? 0) * (plan.cycle === 'yearly' ? 10 : 1);
// In the reader's language; on the server (English) "9 October" and "October", as the invoices say.
const dayMonth = (ms: number) => fmtDate(ms, { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthName = (ms: number) => fmtDate(ms, { month: 'long', timeZone: 'UTC' });

/**
 * A plan switch prorated for the period it happens in, or null when nothing is: the old or the new plan is Free (a
 * cancellation waits for the period's end instead), the cycle changes (the new one starts with the next invoice), or
 * nothing was being paid (a trial, free months, a pause). The day of the switch counts as a day of the new plan.
 * `invoiced`: the period's invoice was already made at the old price.
 */
export function prorate(prev: Plan, next: Pick<Plan, 'track' | 'tier' | 'cycle'>, people: number, at = new Date(), invoiced = true): Omit<PlanAdjustment, 'id'> | null {
  const iso = at.toISOString();
  if (prev.tier === 'free' || next.tier === 'free' || prev.cycle !== next.cycle) return null;
  if (prev.tier === next.tier && prev.track === next.track) return null;
  if ((prev.trialEnds && prev.trialEnds > iso) || (prev.comp?.until && prev.comp.until > iso) || prev.paused) return null;
  const p = billingPeriod(prev, at);
  const days = Math.round((p.end - p.start) / DAY_MS);
  const daysBefore = Math.min(days, Math.max(0, Math.floor((at.getTime() - p.start) / DAY_MS)));
  const diff = periodPrice(next, people) - periodPrice(prev, people);
  const amount = Math.round(invoiced ? (diff * (days - daysBefore)) / days : (-diff * daysBefore) / days);
  const from = planName(prev);
  const to = planName(next);
  return { at: iso, period: p.key, invoiced, from, to, daysBefore, days, amount, text: adjustmentText({ invoiced, from, to, daysBefore, days, start: p.start, at: at.getTime(), yearly: prev.cycle === 'yearly' }) };
}
/**
 * How a prorated switch reads on the invoice and the billing page. The server writes it in English (t() has no other
 * language there); the billing page shows a saved one in the reader's language with the same sentences.
 */
export function adjustmentText(a: { invoiced: boolean; from: string; to: string; daysBefore: number; days: number; start: number; at: number; yearly?: boolean }) {
  const left = a.days - a.daysBefore;
  const span = a.yearly ? t('the rest of the year') : t('the rest of {month}', { month: monthName(a.start) });
  if (a.from === a.to) return t('Plan changes on {date}, back to {plan}', { date: dayMonth(a.at), plan: a.to });
  if (a.invoiced) return t('{to} instead of {from} from {date}: {span} ({left} of {days} days)', { to: a.to, from: a.from, date: dayMonth(a.at), span, left, days: a.days });
  return a.daysBefore
    ? t('{from} instead of {to} until {date} ({before} of {days} days)', { from: a.from, to: a.to, date: dayMonth(a.at - DAY_MS), before: a.daysBefore, days: a.days })
    : t('{plan} from the start of the period', { plan: a.to });
}
/**
 * Adds a switch to the ones waiting for the next invoice. Switches of the same period and kind become one line (a
 * same-day switch from Studio to Agency to Business is one switch from Studio to Business); one that ends where it
 * began on the same day leaves nothing.
 */
export function addAdjustment(list: PlanAdjustment[] | undefined, a: Omit<PlanAdjustment, 'id'>, id: string): PlanAdjustment[] | undefined {
  const all = list ?? [];
  const same = all.find((x) => x.period === a.period && x.invoiced === a.invoiced);
  if (!same) return a.amount ? [...all, { ...a, id }] : all.length ? all : undefined;
  const amount = same.amount + a.amount;
  const sameDay = same.at.slice(0, 10) === a.at.slice(0, 10);
  const rest = all.filter((x) => x !== same);
  if (same.from === a.to && (sameDay || !amount)) return rest.length ? rest : undefined; // switched back: nothing to bill
  const merged: PlanAdjustment = {
    ...same,
    to: a.to,
    amount,
    // Several switches in one period: one line that says what happened, with the total.
    text: sameDay
      ? adjustmentText({ ...a, from: same.from, start: Date.parse(`${a.period}-01T00:00:00Z`), at: Date.parse(same.at) })
      : same.from === a.to
        ? t('{plan} from {start} to {end}, then back to {back}', { plan: same.to, start: dayMonth(Date.parse(same.at)), end: dayMonth(Date.parse(a.at) - DAY_MS), back: a.to })
        : t('{from} to {mid} on {date}, then {to} on {then}, prorated by the days on each', { from: same.from, mid: same.to, date: dayMonth(Date.parse(same.at)), to: a.to, then: dayMonth(Date.parse(a.at)) }),
  };
  if (sameDay) merged.daysBefore = same.daysBefore;
  return [...rest, merged];
}
