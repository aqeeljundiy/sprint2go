import type { AISettings, MeetingSettings, Plan, User, Workspace } from '../types';

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

export const DEFAULT_MEETINGS: MeetingSettings = {
  keep: 'video',
  clientMeetings: 'video',
  internalMeetings: 'notes',
  downgradeAfter: 60,
  whoCanRecord: 'everyone',
  shareNotesWithClient: false,
  autoJoin: true,
  joinMode: 'accepted',
  autoTasks: true,
  botName: 'Sprint2go Notetaker',
  announce: true,
};

/** New companies start with 14 days of Studio AI, then drop to Free. */
export const trialPlan = (company: string, email: string): Plan => ({
  track: 'ai',
  tier: 'studio',
  cycle: 'monthly',
  trialEnds: days(14),
  addons: { mailboxes: 0, storage50: 0, meetHours10: 0, branding: false },
  billing: { company, emails: [email] },
  since: new Date().toISOString(),
});

export const defaultAI = (own: boolean): AISettings => ({ payer: own ? 'own' : 'sprint2go', providers: [], preset: 'balanced', jobs: {}, auto: { meetingNotes: true, emailTodos: true, digests: false }, blocked: [], alerts: true });

/** P&P's four-square pixel mark. */
const PNP_LOGO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111111"/><rect x="16" y="16" width="14" height="14" rx="2" fill="#83B271"/><rect x="34" y="16" width="14" height="14" rx="2" fill="#EE6351"/><rect x="16" y="34" width="14" height="14" rx="2" fill="#EE6351"/><rect x="34" y="34" width="14" height="14" rx="2" fill="#83B271"/></svg>`,
)}`;

export const USERS: User[] = [
  { id: 'u-aqeel', name: 'Aqeel', email: 'aqeel@pixelandprofits.com', title: 'COO · Pixel & Profits', color: '#5b5bf6' },
  { id: 'u-rizky', name: 'Rizky Pratama', email: 'rizky@pixelandprofits.com', title: 'Performance Marketer', color: '#10b981', nicknames: ['Kiki'] },
  { id: 'u-faisal', name: 'Faisal Tirtonady', email: 'faisal@pixelandprofits.com', title: 'CEO · Pixel & Profits', color: '#f59e0b', nicknames: ['Ical'] },
  { id: 'u-aditya', name: 'Aditya Aisar', email: 'aditya@pixelandprofits.com', title: 'Co-Founder · Pixel & Profits', color: '#0ea5e9', nicknames: ['Adit'] },
  { id: 'u-nanda', name: 'Nanda Putra', email: 'nanda@pixelandprofits.com', title: 'Video Editor', color: '#f97316' },
  { id: 'u-sekar', name: 'Sekar Ayu', email: 'sekar@pixelandprofits.com', title: 'Graphic Designer', color: '#8b5cf6' },
  { id: 'u-dewi', name: 'Dewi Lestari', email: 'dewi@pixelandprofits.com', title: 'Finance & Ops', color: '#d946ef' },
  { id: 'u-dimas', name: 'Dimas Prakoso', email: 'dimas@elkiyagroup.com', title: 'Brand Manager', color: '#14b8a6' },
  { id: 'u-bayu', name: 'Bayu Saputra', email: 'bayu@elkiyagroup.com', title: 'Web & Systems', color: '#ef4444' },
];

/** People signed in on this device when the demo first opens. */
export const SIGNED_IN_DEFAULT = ['u-aqeel', 'u-rizky'];

/** Elkiya's diamond on Elkiya blue. */
const ELKIYA_LOGO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7bff"/><stop offset="1" stop-color="#0158cb"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M32 12 52 32 32 52 12 32Z" fill="none" stroke="#fff" stroke-width="4.2" stroke-linejoin="round"/><path d="M32 25 39 32 32 39 25 32Z" fill="#fff"/></svg>`,
)}`;

export const WORKSPACES: Workspace[] = [
  {
    id: 'elk',
    name: 'Elkiya Group',
    color: '#0158cb',
    logo: ELKIYA_LOGO,
    domains: ['elkiyagroup.com'],
    members: [
      { userId: 'u-aqeel', role: 'owner' },
      { userId: 'u-dimas', role: 'member' },
      { userId: 'u-bayu', role: 'admin' },
    ],
    emailSetup: 'hosted',
    plan: { ...trialPlan('Elkiya Group', 'aqeel@elkiyagroup.com'), trialEnds: days(9), since: days(-5) },
    ai: defaultAI(false),
    meetings: DEFAULT_MEETINGS,
    storage: { askOver: 500 },
    accounts: [
      { id: 'elk-dimas', email: 'dimas@elkiyagroup.com', name: 'Dimas Prakoso', kind: 'personal', connected: true, users: ['u-dimas'] },
      { id: 'elk-bayu', email: 'bayu@elkiyagroup.com', name: 'Bayu Saputra', kind: 'personal', connected: true, users: ['u-bayu'] },
      { id: 'elk-aqeel', email: 'aqeel@elkiyagroup.com', name: 'Aqeel', kind: 'personal', connected: true, users: ['u-aqeel'] },
      { id: 'elk-connect', email: 'connect@elkiyagroup.com', name: 'Elkiya Group', kind: 'shared', connected: true, users: ['u-aqeel'] },
    ],
  },
  {
    id: 'pnp',
    name: 'Pixel & Profits',
    color: '#EE6351',
    logo: PNP_LOGO,
    domains: ['pixelandprofits.com'],
    members: [
      { userId: 'u-aqeel', role: 'owner' },
      { userId: 'u-faisal', role: 'owner' },
      { userId: 'u-aditya', role: 'admin' },
      { userId: 'u-rizky', role: 'member' },
      { userId: 'u-dewi', role: 'member' },
      { userId: 'u-nanda', role: 'member' },
      { userId: 'u-sekar', role: 'member' },
    ],
    // Pixel & Profits keeps its domain on Google Workspace and moves some people to Sprint2go.
    emailSetup: 'mix',
    plan: {
      track: 'own',
      tier: 'small',
      cycle: 'monthly',
      addons: { mailboxes: 2, storage50: 0, meetHours10: 1, branding: false },
      payment: { method: 'va', label: 'BCA virtual account' },
      billing: { company: 'Pixel & Profits', npwp: '', address: 'Jakarta Selatan', emails: ['dewi@pixelandprofits.com', 'aqeel@pixelandprofits.com'] },
      since: '2026-07-01T00:00:00.000Z',
    },
    ai: {
      payer: 'own',
      providers: [
        { id: 'sumopod', keyLast4: '9F2a', addedAt: '2026-10-01T03:00:00.000Z', addedBy: 'u-aqeel', status: 'ok', capUsd: 25, spentUsd: 4.1 },
        { id: 'anthropic', keyLast4: 'x7Qe', addedAt: '2026-10-02T03:00:00.000Z', addedBy: 'u-faisal', status: 'ok', capUsd: 40, spentUsd: 6.8 },
      ],
      preset: 'custom',
      jobs: {
        braindump: { provider: 'anthropic', model: 'claude-opus-5-5' },
        ask: { provider: 'anthropic', model: 'claude-sonnet-5-5', fallback: 'sumopod' },
        meeting: { provider: 'sumopod', model: 'deepseek-v4-pro', fallback: 'anthropic' },
        draft: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
        summary: { provider: 'sumopod', model: 'claude-haiku-4-5' },
        digest: { provider: 'sumopod', model: 'deepseek-v4-flash' },
        replies: { provider: 'sumopod', model: 'deepseek-v4-flash' },
        todos: { provider: 'sumopod', model: 'deepseek-v4-flash' },
        sorting: { provider: 'sumopod', model: 'deepseek-v4-flash' },
        translate: { provider: 'sumopod', model: 'qwen3.7-plus' },
        speech: { provider: 'custom', model: 'browser' },
      },
      auto: { meetingNotes: true, emailTodos: true, digests: false },
      blocked: [],
      alerts: true,
    },
    meetings: { ...DEFAULT_MEETINGS, shareNotesWithClient: true, botName: 'P&P Notetaker' },
    meetingRules: [
      { id: 'r1', kind: 'domain', value: 'kopikita.co.id', clientId: 'c-kopikita' },
      { id: 'r2', kind: 'keyword', value: 'Lumina', clientId: 'c-lumina' },
      { id: 'r3', kind: 'participant', value: 'Rina', clientId: 'c-glowkind' },
    ],
    storage: { askOver: 500, own: { provider: 'gdrive', account: 'footage@pixelandprofits.com', forFilesOver: 1000 } },
    emailProvider: 'google',
    meetUrl: 'https://meet.pixelandprofits.com',
    accounts: [
      { id: 'pnp-aqeel', email: 'aqeel@pixelandprofits.com', name: 'Aqeel', kind: 'personal', connected: true, users: ['u-aqeel'] },
      { id: 'pnp-hello', email: 'hello@pixelandprofits.com', name: 'Pixel & Profits', kind: 'shared', connected: true, users: ['u-aqeel', 'u-rizky', 'u-aditya', 'u-faisal'] },
      { id: 'pnp-rizky', email: 'rizky@pixelandprofits.com', name: 'Rizky Pratama', kind: 'personal', connected: true, users: ['u-rizky'] },
      { id: 'pnp-faisal', email: 'faisal@pixelandprofits.com', name: 'Faisal Tirtonady', kind: 'personal', connected: true, users: ['u-faisal'], provider: 'google' },
      { id: 'pnp-aditya', email: 'aditya@pixelandprofits.com', name: 'Aditya Aisar', kind: 'personal', connected: true, users: ['u-aditya'], provider: 'google' },
      { id: 'pnp-dewi', email: 'dewi@pixelandprofits.com', name: 'Dewi Lestari', kind: 'personal', connected: true, users: ['u-dewi'] },
    ],
  },
];

export const WORKSPACE_COLORS = ['#0158cb', '#EE6351', '#83B271', '#0ea5e9', '#0f766e', '#f59e0b', '#d946ef', '#111827'];
