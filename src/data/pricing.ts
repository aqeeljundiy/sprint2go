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
  branding: { name: 'Remove “Made with Sprint2go” from shared spaces', price: 49_000, unit: 'per month' },
} as const;

export const TOP_UP = { price: 99_000, gives: 'about 50 meeting hours, or 110 Ask AI questions, or 120 brain dumps, or 600 email summaries' };

/** What each person adds to the company's shared AI allowance on "AI included" plans (per month). */
export const ALLOWANCE = { braindump: 10, ask: 20, meetingHours: 6, summary: 50, draft: 30 };

export const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

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
  free: ['5 people, 1 team', 'AI with your own keys, plus a small monthly taste', '90 days of visible history', '5 GB storage, 2 meeting-bot hours', '1 guest'],
  small: ['For 1 to 9 people', 'Every app, hosted email', 'Guests and shared spaces', '20 GB storage per person'],
  studio: ['10 people included', 'Hosted email, every app', 'Guests and shared spaces', '250 GB shared storage'],
  agency: ['30 people included', '1 TB shared storage', 'Permissions and retention rules'],
  business: ['80 people included', '3 TB shared storage', 'SSO, audit log, priority support', 'Unlimited meeting bot'],
};
