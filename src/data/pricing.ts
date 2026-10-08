import type { Plan, Tier, Track } from '../types';

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
export const TRACK_NAME: Record<Track, string> = { own: 'Own AI keys', ai: 'AI included' };
export const planName = (p: Pick<Plan, 'track' | 'tier'>) => (p.tier === 'free' ? 'Free' : `${TIER_NAME[p.tier]}${p.track === 'ai' ? ' AI' : ''}`);

export const ADDONS = {
  mailboxes: { name: 'Hosted mailbox (10 GB)', price: 15_000, unit: 'per mailbox' },
  storage50: { name: 'Extra 50 GB storage', price: 39_000, unit: 'per 50 GB' },
  meetHours10: { name: 'Meeting bot, 10 more hours', price: 49_000, unit: 'per 10 hours' },
  branding: { name: 'Remove “Made with sprint2go” from shared spaces', price: 49_000, unit: 'per month' },
} as const;

/** The branding add-on, or Business, which includes it. A company's own address for its guests goes live only with it. */
export const hasBranding = (plan?: { tier?: string; addons?: { branding?: boolean } } | null) => plan?.tier === 'business' || !!plan?.addons?.branding;

export const TOP_UP = { price: 99_000, gives: 'about 50 meeting hours, or 110 Ask AI questions, or 120 brain dumps, or 600 email summaries' };

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
  for (const t of Object.keys(o.prices ?? {}) as Track[]) for (const tier of Object.keys(o.prices![t] ?? {}) as Exclude<Tier, 'free'>[]) Object.assign(PRICES[t][tier], o.prices![t]![tier]);
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

export const PLAN_FEATURES: Record<Tier, string[]> = {
  free: ['5 people, 1 team', 'AI with your own keys', '90 days of visible history', '5 GB storage, 2 meeting-bot hours', '1 guest'],
  small: ['For 1 to 9 people', 'Every app, hosted email', 'Guests and shared spaces', '20 GB storage per person'],
  studio: ['10 people included', 'Hosted email, every app', 'Guests and shared spaces', '250 GB shared storage'],
  agency: ['30 people included', '1 TB shared storage', 'Permissions and retention rules'],
  business: ['80 people included', '3 TB shared storage', 'SSO, audit log, priority support', 'Unlimited meeting bot'],
};
