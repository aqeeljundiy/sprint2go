import type { Industry, Repeat } from '../types';

/** A ready-made brief: the brief itself plus its tasks, spaced out in working days from the start date. */
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
    name: 'New client onboarding',
    description: 'Get a new client from signed to first campaign live: accounts, assets, kickoff and a first plan they approve.',
    builtIn: true,
    tasks: [
      { title: 'Send the welcome email and kickoff invite', days: 0 },
      { title: 'Collect logins and access', days: 1, checklist: ['Meta Business Manager', 'TikTok Ads', 'Google Analytics', 'Shopify or website admin', 'Brand drive folder'] },
      { title: 'Kickoff meeting with the client', days: 2, checklist: ['Goals and KPIs', 'Budget per month', 'Key products and offers', 'Who approves on their side'] },
      { title: 'Audit the current ads account', days: 4 },
      { title: 'Moodboard and creative direction', days: 5 },
      { title: 'First month plan for client approval', days: 7 },
      { title: 'Launch the first campaign', days: 10, checklist: ['Pixel and events checked', 'Naming convention', 'Budgets set', 'Client told it is live'] },
    ],
  },
  {
    id: 'tpl-launch',
    name: 'Campaign launch',
    description: 'One campaign from brief to live: concept, creatives, setup, client approval and the first check-in.',
    builtIn: true,
    tasks: [
      { title: 'Campaign concept and key message', days: 0 },
      { title: 'Design static ads', days: 2, checklist: ['Feed 1:1', 'Story 9:16', 'Copy variations'] },
      { title: 'Edit video cutdowns', days: 3, checklist: ['15s', '30s', 'Captions burned in'] },
      { title: 'Client approval on creatives', days: 4 },
      { title: 'Set up the campaign structure and audiences', days: 5 },
      { title: 'Go live and check delivery after 24 hours', days: 6 },
      { title: 'First performance report to the client', days: 11 },
    ],
  },
  {
    id: 'tpl-report',
    name: 'Monthly client report',
    description: 'The monthly report every client gets: numbers, what worked, what we change next month.',
    builtIn: true,
    tasks: [
      { title: 'Pull the numbers for the month', days: 0, repeat: 'monthly', checklist: ['Spend', 'ROAS', 'CPA', 'Top 3 ads'] },
      { title: 'Write the report and next month plan', days: 1, repeat: 'monthly' },
      { title: 'Send the report and book the review call', days: 2, repeat: 'monthly' },
    ],
  },
];

/* ---------- per industry: a few briefs that fit how that kind of company works ---------- */
const T = (id: string, industry: Industry, name: string, description: string, tasks: TaskTemplate['tasks']): TaskTemplate => ({ id, industry, name, description, builtIn: true, tasks });

export const INDUSTRY_TEMPLATES: TaskTemplate[] = [
  T('tpl-ec-launch', 'ecommerce', 'Product launch', 'Take a new product from samples to live on the store with a launch push.', [
    { title: 'Approve the final sample and pricing', days: 0 },
    { title: 'Product photos and video', days: 3, checklist: ['Packshots', 'Lifestyle', 'Short video'] },
    { title: 'Write the product page and FAQ', days: 4 },
    { title: 'Set up the product in the store and stock', days: 6 },
    { title: 'Launch email and social posts', days: 8 },
    { title: 'Go live and watch the first 48 hours', days: 10 },
  ]),
  T('tpl-ec-promo', 'ecommerce', 'Monthly promo', 'Plan, set up and report one promotion.', [
    { title: 'Pick the offer and the products', days: 0 },
    { title: 'Creatives and copy', days: 3 },
    { title: 'Set up discounts and landing page', days: 5 },
    { title: 'Promo live: check orders and ads daily', days: 7 },
    { title: 'Results and what to keep next time', days: 14 },
  ]),
  T('tpl-ec-supplier', 'ecommerce', 'New supplier onboarding', 'From first samples to a signed supplier with clear terms.', [
    { title: 'Request samples and price list', days: 0 },
    { title: 'Check samples and lead times', days: 7 },
    { title: 'Agree terms, MOQ and payment', days: 10 },
    { title: 'First purchase order', days: 12 },
  ]),
  T('tpl-co-proposal', 'consulting', 'Discovery to proposal', 'Understand the prospect’s problem and send a proposal they can say yes to.', [
    { title: 'Discovery call', days: 0, checklist: ['Goals', 'Constraints', 'Who decides', 'Budget range'] },
    { title: 'Write up what we heard', days: 1 },
    { title: 'Draft the proposal and quote', days: 4 },
    { title: 'Review internally', days: 5 },
    { title: 'Send and book the walkthrough', days: 6 },
  ]),
  T('tpl-co-kickoff', 'consulting', 'Engagement kickoff', 'Start an engagement with everyone clear on scope, people and cadence.', [
    { title: 'Kickoff meeting', days: 0 },
    { title: 'Scope and timeline agreed in writing', days: 2 },
    { title: 'Access to data and systems', days: 3 },
    { title: 'Weekly check-in set up', days: 3 },
    { title: 'First deliverable', days: 10 },
  ]),
  T('tpl-co-review', 'consulting', 'Monthly review', 'A short monthly report and call with the client.', [
    { title: 'Gather the numbers', days: 0 },
    { title: 'Write the review', days: 2 },
    { title: 'Review call', days: 3 },
    { title: 'Agree next month’s focus', days: 3 },
  ]),
  T('tpl-sw-release', 'software', 'Feature release', 'Ship one feature: from spec to announced.', [
    { title: 'Write the spec and acceptance criteria', days: 0 },
    { title: 'Design review', days: 2 },
    { title: 'Build', days: 7 },
    { title: 'Test and fix', days: 9, checklist: ['Happy path', 'Edge cases', 'Mobile', 'Accessibility'] },
    { title: 'Release notes and announce', days: 10 },
  ]),
  T('tpl-sw-onboard', 'software', 'Customer onboarding', 'A new customer from signed to using the product.', [
    { title: 'Welcome call and goals', days: 0 },
    { title: 'Set up their account and data', days: 2 },
    { title: 'Training session', days: 5 },
    { title: 'Check-in after two weeks', days: 14 },
  ]),
  T('tpl-sw-incident', 'software', 'Incident follow-up', 'After an outage or a serious bug: fix the cause, tell customers, learn.', [
    { title: 'Write the timeline', days: 0 },
    { title: 'Fix the root cause', days: 3 },
    { title: 'Customer update', days: 1 },
    { title: 'What we change so it doesn’t repeat', days: 5 },
  ]),
  T('tpl-ev-plan', 'events', 'Event from brief to day', 'Everything between the idea and the doors opening.', [
    { title: 'Brief: goal, audience, budget, date', days: 0 },
    { title: 'Venue shortlist and booking', days: 7 },
    { title: 'Vendors: catering, AV, decor', days: 14, checklist: ['Catering', 'AV', 'Decor', 'Photography'] },
    { title: 'Invitations and registrations', days: 21 },
    { title: 'Run sheet and roles for the day', days: 28 },
    { title: 'Event day', days: 35 },
  ]),
  T('tpl-ev-sponsors', 'events', 'Sponsor outreach', 'Find and close sponsors for an event.', [
    { title: 'Sponsor packages and deck', days: 0 },
    { title: 'Target list and first emails', days: 3 },
    { title: 'Follow-ups and calls', days: 10 },
    { title: 'Contracts and logos in', days: 20 },
  ]),
  T('tpl-ev-wrap', 'events', 'Post-event wrap', 'Close the event properly.', [
    { title: 'Thank-you emails to guests and sponsors', days: 1 },
    { title: 'Photos and recap post', days: 3 },
    { title: 'Final costs vs budget', days: 5 },
    { title: 'What to do differently next time', days: 7 },
  ]),
];

/** Built-in templates for a company: its industry's first, then the general ones. */
export const templatesFor = (industry?: Industry) => [...INDUSTRY_TEMPLATES.filter((t) => t.industry === industry), ...BUILT_IN_TEMPLATES.map((t) => ({ ...t, industry: 'agency' as Industry })), ...INDUSTRY_TEMPLATES.filter((t) => t.industry !== industry)];
