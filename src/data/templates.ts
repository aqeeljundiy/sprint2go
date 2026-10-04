import type { Repeat } from '../types';

/** A ready-made brief: the brief itself plus its tasks, spaced out in working days from the start date. */
export interface TaskTemplate {
  id: string;
  name: string;
  description: string; // becomes the brief's context
  builtIn?: boolean;
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
