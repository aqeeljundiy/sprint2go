import type { Industry, Repeat } from '../types';
import { mark, t } from '../i18n/index';

/**
 * A ready-made brief: the brief itself plus its tasks, spaced out in working days from the start date. The built-in
 * ones are written by the app, so their words are mark()ed and come out in the person's language (tplText); a template a
 * company saved is what they typed.
 */
export interface TaskTemplate {
  id: string;
  name: string;
  description: string; // becomes the brief's context
  builtIn?: boolean;
  industry?: Industry; // built-in: which kind of company it's written for
  workspaceId?: string; // templates a company saves for itself
  tasks: { title: string; days: number; checklist?: string[]; repeat?: Repeat }[];
}

export const BUILT_IN_TEMPLATES: TaskTemplate[] = [
  {
    id: 'tpl-onboarding',
    name: mark('New client onboarding'),
    description: mark('Get a new client from signed to first campaign live: accounts, assets, kickoff and a first plan they approve.'),
    builtIn: true,
    tasks: [
      { title: mark('Send the welcome email and kickoff invite'), days: 0 },
      { title: mark('Collect logins and access'), days: 1, checklist: ['Meta Business Manager', 'TikTok Ads', 'Google Analytics', mark('Shopify or website admin'), mark('Brand drive folder')] },
      { title: mark('Kickoff meeting with the client'), days: 2, checklist: [mark('Goals and KPIs'), mark('Budget per month'), mark('Key products and offers'), mark('Who approves on their side')] },
      { title: mark('Audit the current ads account'), days: 4 },
      { title: mark('Moodboard and creative direction'), days: 5 },
      { title: mark('First month plan for client approval'), days: 7 },
      { title: mark('Launch the first campaign'), days: 10, checklist: [mark('Pixel and events checked'), mark('Naming convention'), mark('Budgets set'), mark('Client told it is live')] },
    ],
  },
  {
    id: 'tpl-launch',
    name: mark('Campaign launch'),
    description: mark('One campaign from brief to live: concept, creatives, setup, client approval and the first check-in.'),
    builtIn: true,
    tasks: [
      { title: mark('Campaign concept and key message'), days: 0 },
      { title: mark('Design static ads'), days: 2, checklist: [mark('Feed 1:1'), mark('Story 9:16'), mark('Copy variations')] },
      { title: mark('Edit video cutdowns'), days: 3, checklist: ['15s', '30s', mark('Captions burned in')] },
      { title: mark('Client approval on creatives'), days: 4 },
      { title: mark('Set up the campaign structure and audiences'), days: 5 },
      { title: mark('Go live and check delivery after 24 hours'), days: 6 },
      { title: mark('First performance report to the client'), days: 11 },
    ],
  },
  {
    id: 'tpl-report',
    name: mark('Monthly client report'),
    description: mark('The monthly report every client gets: numbers, what worked, what we change next month.'),
    builtIn: true,
    tasks: [
      { title: mark('Pull the numbers for the month'), days: 0, repeat: 'monthly', checklist: [mark('Spend'), 'ROAS', 'CPA', mark('Top 3 ads')] },
      { title: mark('Write the report and next month plan'), days: 1, repeat: 'monthly' },
      { title: mark('Send the report and book the review call'), days: 2, repeat: 'monthly' },
    ],
  },
];

/* ---------- per industry: a few briefs that fit how that kind of company works ---------- */
const T = (id: string, industry: Industry, name: string, description: string, tasks: TaskTemplate['tasks']): TaskTemplate => ({ id, industry, name, description, builtIn: true, tasks });

export const INDUSTRY_TEMPLATES: TaskTemplate[] = [
  T('tpl-ec-launch', 'ecommerce', mark('Product launch'), mark('Take a new product from samples to live on the store with a launch push.'), [
    { title: mark('Approve the final sample and pricing'), days: 0 },
    { title: mark('Product photos and video'), days: 3, checklist: [mark('Packshots'), mark('Lifestyle'), mark('Short video')] },
    { title: mark('Write the product page and FAQ'), days: 4 },
    { title: mark('Set up the product in the store and stock'), days: 6 },
    { title: mark('Launch email and social posts'), days: 8 },
    { title: mark('Go live and watch the first 48 hours'), days: 10 },
  ]),
  T('tpl-ec-promo', 'ecommerce', mark('Monthly promo'), mark('Plan, set up and report one promotion.'), [
    { title: mark('Pick the offer and the products'), days: 0 },
    { title: mark('Creatives and copy'), days: 3 },
    { title: mark('Set up discounts and landing page'), days: 5 },
    { title: mark('Promo live: check orders and ads daily'), days: 7 },
    { title: mark('Results and what to keep next time'), days: 14 },
  ]),
  T('tpl-ec-supplier', 'ecommerce', mark('New supplier onboarding'), mark('From first samples to a signed supplier with clear terms.'), [
    { title: mark('Request samples and price list'), days: 0 },
    { title: mark('Check samples and lead times'), days: 7 },
    { title: mark('Agree terms, MOQ and payment'), days: 10 },
    { title: mark('First purchase order'), days: 12 },
  ]),
  T('tpl-co-proposal', 'consulting', mark('Discovery to proposal'), mark('Understand the prospect’s problem and send a proposal they can say yes to.'), [
    { title: mark('Discovery call'), days: 0, checklist: [mark('Goals'), mark('Constraints'), mark('Who decides'), mark('Budget range')] },
    { title: mark('Write up what we heard'), days: 1 },
    { title: mark('Draft the proposal and quote'), days: 4 },
    { title: mark('Review internally'), days: 5 },
    { title: mark('Send and book the walkthrough'), days: 6 },
  ]),
  T('tpl-co-kickoff', 'consulting', mark('Engagement kickoff'), mark('Start an engagement with everyone clear on scope, people and cadence.'), [
    { title: mark('Kickoff meeting'), days: 0 },
    { title: mark('Scope and timeline agreed in writing'), days: 2 },
    { title: mark('Access to data and systems'), days: 3 },
    { title: mark('Weekly check-in set up'), days: 3 },
    { title: mark('First deliverable'), days: 10 },
  ]),
  T('tpl-co-review', 'consulting', mark('Monthly review'), mark('A short monthly report and call with the client.'), [
    { title: mark('Gather the numbers'), days: 0 },
    { title: mark('Write the review'), days: 2 },
    { title: mark('Review call'), days: 3 },
    { title: mark('Agree next month’s focus'), days: 3 },
  ]),
  T('tpl-sw-release', 'software', mark('Feature release'), mark('Ship one feature: from spec to announced.'), [
    { title: mark('Write the spec and acceptance criteria'), days: 0 },
    { title: mark('Design review'), days: 2 },
    { title: mark('Build'), days: 7 },
    { title: mark('Test and fix'), days: 9, checklist: [mark('Happy path'), mark('Edge cases'), mark('Mobile'), mark('Accessibility')] },
    { title: mark('Release notes and announce'), days: 10 },
  ]),
  T('tpl-sw-onboard', 'software', mark('Customer onboarding'), mark('A new customer from signed to using the product.'), [
    { title: mark('Welcome call and goals'), days: 0 },
    { title: mark('Set up their account and data'), days: 2 },
    { title: mark('Training session'), days: 5 },
    { title: mark('Check-in after two weeks'), days: 14 },
  ]),
  T('tpl-sw-incident', 'software', mark('Incident follow-up'), mark('After an outage or a serious bug: fix the cause, tell customers, learn.'), [
    { title: mark('Write the timeline'), days: 0 },
    { title: mark('Fix the root cause'), days: 3 },
    { title: mark('Customer update'), days: 1 },
    { title: mark('What we change so it doesn’t repeat'), days: 5 },
  ]),
  T('tpl-ev-plan', 'events', mark('Event from brief to day'), mark('Everything between the idea and the doors opening.'), [
    { title: mark('Brief: goal, audience, budget, date'), days: 0 },
    { title: mark('Venue shortlist and booking'), days: 7 },
    { title: mark('Vendors: catering, AV, decor'), days: 14, checklist: [mark('Catering'), 'AV', mark('Decor'), mark('Photography')] },
    { title: mark('Invitations and registrations'), days: 21 },
    { title: mark('Run sheet and roles for the day'), days: 28 },
    { title: mark('Event day'), days: 35 },
  ]),
  T('tpl-ev-sponsors', 'events', mark('Sponsor outreach'), mark('Find and close sponsors for an event.'), [
    { title: mark('Sponsor packages and deck'), days: 0 },
    { title: mark('Target list and first emails'), days: 3 },
    { title: mark('Follow-ups and calls'), days: 10 },
    { title: mark('Contracts and logos in'), days: 20 },
  ]),
  T('tpl-ev-wrap', 'events', mark('Post-event wrap'), mark('Close the event properly.'), [
    { title: mark('Thank-you emails to guests and sponsors'), days: 1 },
    { title: mark('Photos and recap post'), days: 3 },
    { title: mark('Final costs vs budget'), days: 5 },
    { title: mark('What to do differently next time'), days: 7 },
  ]),
];

/** Built-in templates for a company: its industry's first, then the general ones. */
export const templatesFor = (industry?: Industry) => [...INDUSTRY_TEMPLATES.filter((t) => t.industry === industry), ...BUILT_IN_TEMPLATES.map((t) => ({ ...t, industry: 'agency' as Industry })), ...INDUSTRY_TEMPLATES.filter((t) => t.industry !== industry)];

/** A template's words in the reader's language: the built-in ones are translated, a company's own are as typed. */
export const tplText = (tpl: Pick<TaskTemplate, 'builtIn'>, text: string) => (tpl.builtIn ? t(text) : text);
