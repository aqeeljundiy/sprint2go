import type { AISettings, MeetingSettings, Plan, User, Workspace } from '../types';

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

export const DEFAULT_MEETINGS: MeetingSettings = {
  keep: 'audio', // audio only for now: video recording comes later
  clientMeetings: 'audio',
  internalMeetings: 'notes',
  downgradeAfter: 60,
  whoCanRecord: 'everyone',
  shareNotesWithClient: false,
  autoJoin: true,
  joinMode: 'accepted',
  autoTasks: true,
  botName: 'sprint2go Notetaker',
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

/** The demo studio's made-up mark: two sprint bars on ink. */
const PNP_LOGO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f2937"/><rect x="14" y="20" width="36" height="9" rx="4.5" fill="#f97316"/><rect x="14" y="35" width="24" height="9" rx="4.5" fill="#fdba74"/></svg>`,
)}`;

export const USERS: User[] = [
  { id: 'u-raka', name: 'Raka Hartono', email: 'raka@demo.sprint2go.com', title: 'COO · sprint2go Studio', color: '#6366f1' },
  { id: 'u-bima', name: 'Bima Anggara', email: 'bima@demo.sprint2go.com', title: 'Performance Marketer', color: '#059669', nicknames: ['Bim'] },
  { id: 'u-hendra', name: 'Hendra Wijaya', email: 'hendra@demo.sprint2go.com', title: 'CEO · sprint2go Studio', color: '#d97706', nicknames: ['Hen'] },
  { id: 'u-sofia', name: 'Sofia Ramadhani', email: 'sofia@demo.sprint2go.com', title: 'Head of Accounts', color: '#0284c7', nicknames: ['Sofi'] },
  { id: 'u-joko', name: 'Joko Prasetyo', email: 'joko@demo.sprint2go.com', title: 'Video Editor', color: '#ea580c' },
  { id: 'u-emma', name: 'Emma Larsen', email: 'emma@demo.sprint2go.com', title: 'Graphic Designer', color: '#7c3aed' },
  { id: 'u-intan', name: 'Intan Kusnadi', email: 'intan@demo.sprint2go.com', title: 'Finance & Ops', color: '#c026d3' },
  { id: 'u-yusuf', name: 'Yusuf Halim', email: 'yusuf@rimbagroup.example', title: 'Brand Manager', color: '#0d9488' },
  { id: 'u-tomas', name: 'Tomas Reyes', email: 'tomas@rimbagroup.example', title: 'Web & Systems', color: '#dc2626' },
];

/** People signed in on this device when the demo first opens. */
export const SIGNED_IN_DEFAULT = ['u-raka', 'u-bima'];

/** Rimba Group's made-up mark: a leaf on forest green. */
const RIMBA_LOGO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#166534"/><path d="M18 46C18 28 30 17 47 17C47 35 36 46 18 46Z" fill="#bbf7d0"/><path d="M21 43 38 26" stroke="#166534" stroke-width="3" stroke-linecap="round"/></svg>`,
)}`;

export const WORKSPACES: Workspace[] = [
  {
    id: 'elk',
    name: 'Rimba Group',
    color: '#166534',
    logo: RIMBA_LOGO,
    domains: ['rimbagroup.example'],
    members: [
      { userId: 'u-raka', role: 'owner' },
      { userId: 'u-yusuf', role: 'member' },
      { userId: 'u-tomas', role: 'admin' },
    ],
    emailSetup: 'hosted',
    holidays: { country: 'ID' },
    plan: { ...trialPlan('Rimba Group', 'raka@rimbagroup.example'), trialEnds: days(9), since: days(-5) },
    ai: defaultAI(false),
    meetings: DEFAULT_MEETINGS,
    storage: { askOver: 500 },
    accounts: [
      { id: 'elk-yusuf', email: 'yusuf@rimbagroup.example', name: 'Yusuf Halim', kind: 'personal', connected: true, users: ['u-yusuf'] },
      { id: 'elk-tomas', email: 'tomas@rimbagroup.example', name: 'Tomas Reyes', kind: 'personal', connected: true, users: ['u-tomas'] },
      { id: 'elk-raka', email: 'raka@rimbagroup.example', name: 'Raka', kind: 'personal', connected: true, users: ['u-raka'] },
      { id: 'elk-connect', email: 'connect@rimbagroup.example', name: 'Rimba Group', kind: 'shared', connected: true, users: ['u-raka'] },
    ],
  },
  {
    id: 'pnp',
    name: 'sprint2go Studio',
    color: '#f97316',
    logo: PNP_LOGO,
    domains: ['demo.sprint2go.com'],
    members: [
      { userId: 'u-raka', role: 'owner' },
      { userId: 'u-hendra', role: 'owner' },
      { userId: 'u-sofia', role: 'admin' },
      { userId: 'u-bima', role: 'member' },
      { userId: 'u-intan', role: 'member' },
      { userId: 'u-joko', role: 'member' },
      { userId: 'u-emma', role: 'member' },
    ],
    // sprint2go Studio keeps its domain on Google Workspace and moves some people to Sprint2go.
    emailSetup: 'mix',
    holidays: { country: 'ID' },
    plan: {
      track: 'own',
      tier: 'small',
      cycle: 'monthly',
      addons: { mailboxes: 2, storage50: 0, meetHours10: 1, branding: false },
      payment: { method: 'va', label: 'BCA virtual account' },
      billing: { company: 'sprint2go Studio', npwp: '', address: 'Jakarta Selatan', emails: ['intan@demo.sprint2go.com', 'raka@demo.sprint2go.com'] },
      since: '2026-07-01T00:00:00.000Z',
    },
    ai: {
      payer: 'own',
      providers: [
        { id: 'sumopod', keyLast4: '9F2a', addedAt: '2026-10-01T03:00:00.000Z', addedBy: 'u-raka', status: 'ok', capUsd: 25, spentUsd: 4.1 },
        { id: 'anthropic', keyLast4: 'x7Qe', addedAt: '2026-10-02T03:00:00.000Z', addedBy: 'u-hendra', status: 'ok', capUsd: 40, spentUsd: 6.8 },
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
    meetings: { ...DEFAULT_MEETINGS, shareNotesWithClient: true, botName: 'Studio Notetaker' },
    meetingRules: [
      { id: 'r1', kind: 'domain', value: 'kopinara.example', clientId: 'c-kopinara' },
      { id: 'r2', kind: 'keyword', value: 'Selara', clientId: 'c-selara' },
      { id: 'r3', kind: 'participant', value: 'Nina', clientId: 'c-brightleaf' },
    ],
    storage: { askOver: 500, own: { provider: 'gdrive', account: 'footage@demo.sprint2go.com', forFilesOver: 1000 } },
    emailProvider: 'google',
    meetUrl: 'https://meet.demo.sprint2go.com',
    accounts: [
      { id: 'pnp-raka', email: 'raka@demo.sprint2go.com', name: 'Raka', kind: 'personal', connected: true, users: ['u-raka'] },
      { id: 'pnp-hello', email: 'hello@demo.sprint2go.com', name: 'sprint2go Studio', kind: 'shared', connected: true, users: ['u-raka', 'u-bima', 'u-sofia', 'u-hendra'] },
      { id: 'pnp-bima', email: 'bima@demo.sprint2go.com', name: 'Bima Anggara', kind: 'personal', connected: true, users: ['u-bima'] },
      { id: 'pnp-hendra', email: 'hendra@demo.sprint2go.com', name: 'Hendra Wijaya', kind: 'personal', connected: true, users: ['u-hendra'], provider: 'google' },
      { id: 'pnp-sofia', email: 'sofia@demo.sprint2go.com', name: 'Sofia Ramadhani', kind: 'personal', connected: true, users: ['u-sofia'], provider: 'google' },
      { id: 'pnp-intan', email: 'intan@demo.sprint2go.com', name: 'Intan Kusnadi', kind: 'personal', connected: true, users: ['u-intan'] },
    ],
  },
];

export const WORKSPACE_COLORS = ['#0158cb', '#EE6351', '#83B271', '#0ea5e9', '#0f766e', '#f59e0b', '#d946ef', '#111827'];
