import type { Channel, ChatMessage, Client, Meeting, Notice, Team, Todo } from '../types';
import { localDay } from '../utils';

// Sample clients, tasks, chat and meetings for the two demo companies.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDay(d);
};

export const CLIENTS: Client[] = [
  {
    id: 'c-kopinara', type: 'Client', workspaceId: 'pnp', name: 'Kopinara', domain: 'kopinara.example', color: '#b45309', status: 'active', ownerId: 'u-raka', since: '2026-03-02T03:00:00.000Z',
    people: [
      { email: 'laras@kopinara.example', name: 'Laras Anindita', role: 'approver', status: 'joined', invitedBy: 'u-raka', at: '2026-09-20T03:00:00.000Z' },
      { email: 'gilang@kopinara.example', name: 'Gilang Pradana', role: 'viewer', status: 'invited', invitedBy: 'laras@kopinara.example', at: '2026-10-02T03:00:00.000Z' },
    ],
  },
  {
    id: 'c-selara', type: 'Client', workspaceId: 'pnp', name: 'Selara Skin', domain: 'selaraskin.example', color: '#ec4899', status: 'active', ownerId: 'u-hendra', since: '2026-05-18T03:00:00.000Z',
    people: [{ email: 'hannah@selaraskin.example', name: 'Hannah Koh', role: 'collaborator', status: 'joined', invitedBy: 'u-hendra', at: '2026-09-12T03:00:00.000Z' }],
  },
  { id: 'c-teduh', type: 'Client', workspaceId: 'pnp', name: 'Teduh Hotels', domain: 'teduhhotels.example', color: '#0ea5e9', status: 'lead', ownerId: 'u-raka' },
  { id: 'c-brightleaf', type: 'Client', workspaceId: 'pnp', name: 'Brightleaf', domain: 'brightleaf.example', color: '#a855f7', status: 'lead', ownerId: 'u-sofia' },
  {
    // Rimba runs its own Sprint2go workspace and is also a client of sprint2go demo: Yusuf signs in once and has both.
    id: 'c-rimba', type: 'Client', workspaceId: 'pnp', name: 'Rimba Group', domain: 'rimbagroup.example', color: '#0f766e', status: 'active', ownerId: 'u-sofia', since: '2026-09-21T03:00:00.000Z',
    people: [{ email: 'yusuf@rimbagroup.example', name: 'Yusuf Halim', role: 'approver', status: 'joined', invitedBy: 'u-sofia', at: '2026-09-25T03:00:00.000Z' }],
  },
  // A past client: the work ended in August.
  { id: 'c-batik', type: 'Client', workspaceId: 'pnp', name: 'Batik Purnama', domain: 'batikpurnama.example', color: '#7c3aed', status: 'ended', ownerId: 'u-hendra', since: '2026-01-12T03:00:00.000Z', endedAt: '2026-08-28T05:00:00.000Z', endReason: 'Project finished', portalAfterEnd: 'readonly' },
  { id: 'c-pnp-site', type: 'Internal', workspaceId: 'pnp', name: 'Studio website refresh', color: '#64748b', status: 'active', ownerId: 'u-raka', since: '2026-09-01T03:00:00.000Z' },
  { id: 'c-lerengcoffee', type: 'Client', workspaceId: 'elk', name: 'Lereng Coffee', domain: 'lerengcoffee.example', color: '#92400e', status: 'lead', ownerId: 'u-raka' },
  { id: 'c-supplements', type: 'Internal', workspaceId: 'elk', name: 'Supplements brand', color: '#16a34a', status: 'active', ownerId: 'u-yusuf' },
];

export const TEAMS: Team[] = [
  { id: 't-account', workspaceId: 'pnp', name: 'Account management', color: '#0ea5e9', leadId: 'u-sofia', members: ['u-raka', 'u-sofia'], keywords: ['follow up', 'call', 'proposal', 'retainer', 'report', 'meeting', 'brief the client', 'onboard'] },
  { id: 't-perf', workspaceId: 'pnp', name: 'Performance', color: '#10b981', leadId: 'u-hendra', members: ['u-hendra', 'u-bima'], keywords: ['ads', 'ad ', 'campaign', 'meta', 'roas', 'retargeting', 'budget', 'structure', 'scaling', 'audience'] },
  { id: 't-video', workspaceId: 'pnp', name: 'Video editing', color: '#f97316', leadId: 'u-joko', members: ['u-joko', 'u-bima'], keywords: ['video', 'reel', 'storyboard', 'edit', 'footage', 'cutdown', 'short-form', 'tiktok', 'shoot'] },
  { id: 't-design', workspaceId: 'pnp', name: 'Graphic design', color: '#8b5cf6', leadId: 'u-emma', review: true, members: ['u-emma', 'u-raka'], keywords: ['design', 'static', 'visual', 'concept', 'moodboard', 'banner', 'logo', 'deck', 'carousel', 'key visual'] },
  { id: 't-finance', workspaceId: 'pnp', name: 'Finance', color: '#d946ef', leadId: 'u-intan', members: ['u-intan'], keywords: ['invoice', 'payment', 'timesheet', 'contract', 'tax', 'payroll'] },
  { id: 't-growth', workspaceId: 'elk', name: 'Growth', color: '#14b8a6', leadId: 'u-yusuf', members: ['u-yusuf', 'u-raka'], keywords: ['orders', 'reorder', 'campaign', 'bundle', 'proposal'] },
  { id: 't-web', workspaceId: 'elk', name: 'Web & systems', color: '#ef4444', leadId: 'u-tomas', members: ['u-tomas'], keywords: ['landing', 'website', 'page', 'dns', 'domain', 'checkout'] },
];

let n = 0;
const task = (t: Omit<Todo, 'id' | 'createdAt' | 'done'> & { done?: boolean; id?: string }): Todo => ({
  id: t.id ?? `task-${++n}`,
  createdAt: ago(60 * 24 * (n % 5)),
  done: !!t.done,
  status: t.done ? 'done' : t.status ?? 'todo',
  ...t,
});

export const TASKS: Todo[] = [
  task({ visibleToClient: true, title: 'Supplements launch: first Meta ad set live', clientId: 'c-rimba', teamId: 't-perf', userId: 'u-bima', createdBy: 'u-sofia', due: day(3), priority: 'high', source: 'manual', workspaceId: 'pnp', status: 'doing' }),
  task({ visibleToClient: true, approval: { status: 'waiting', askedBy: 'u-sofia', askedAt: ago(60 * 2) }, title: 'Three hooks for the launch ads', clientId: 'c-rimba', teamId: 't-perf', userId: 'u-bima', createdBy: 'u-sofia', due: day(1), priority: 'normal', source: 'manual', workspaceId: 'pnp', status: 'review' }),
  task({ visibleToClient: true, approval: { status: 'approved', askedBy: 'u-raka', askedAt: ago(60 * 30), by: 'laras@kopinara.example', at: ago(60 * 20), note: 'Love direction 2 and 3!' }, title: 'Finish four Q4 concept directions', teamId: 't-design', briefId: 'brief-kopinara', clientId: 'c-kopinara', userId: 'u-raka', createdBy: 'u-raka', due: day(2), priority: 'high', source: 'manual', workspaceId: 'pnp', status: 'doing' }),
  task({ title: 'Storyboard the "morning ritual" short-form video', teamId: 't-video', briefId: 'brief-kopinara', clientId: 'c-kopinara', userId: 'u-bima', createdBy: 'u-raka', due: day(3), priority: 'normal', source: 'meeting', workspaceId: 'pnp' }),
  task({ title: 'Send October invoice to Laras', teamId: 't-finance', clientId: 'c-kopinara', userId: 'u-intan', createdBy: 'u-raka', due: day(-1), priority: 'high', source: 'braindump', workspaceId: 'pnp' }),
  task({ title: 'Build 11.11 campaign structure in Meta', teamId: 't-perf', clientId: 'c-selara', userId: 'u-bima', createdBy: 'u-hendra', due: day(1), priority: 'high', source: 'chat', workspaceId: 'pnp', status: 'doing' }),
  task({ title: 'Prepare 12.12 budget scenarios', teamId: 't-perf', clientId: 'c-selara', userId: 'u-hendra', createdBy: 'u-hendra', due: day(4), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-lkv', title: 'Selara 11.11 key visual', teamId: 't-design', clientId: 'c-selara', userId: 'u-emma', createdBy: 'u-hendra', due: day(-2), priority: 'normal', source: 'manual', workspaceId: 'pnp', done: true, doneBy: 'u-emma', doneAt: ago(60 * 20) }),
  task({ title: 'September report to Hannah', teamId: 't-account', clientId: 'c-selara', userId: 'u-raka', createdBy: 'u-raka', due: day(-3), priority: 'normal', source: 'manual', workspaceId: 'pnp', done: true }),
  task({ title: 'Follow up with Yusuf on the Q1 retainer', teamId: 't-account', clientId: 'c-teduh', userId: 'u-raka', createdBy: 'u-raka', due: day(5), priority: 'normal', source: 'braindump', workspaceId: 'pnp' }),
  task({ title: 'Book discovery call with Nina', teamId: 't-account', clientId: 'c-brightleaf', userId: 'u-sofia', createdBy: 'u-raka', due: day(0), priority: 'high', source: 'manual', workspaceId: 'pnp' }),
  task({ title: 'Shortlist top 3 performance marketer candidates', userId: 'u-raka', createdBy: 'u-hendra', due: day(3), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-reel', visibleToClient: true, title: 'Edit the 30s "morning ritual" reel', teamId: 't-video', briefId: 'brief-kopinara', clientId: 'c-kopinara', userId: 'u-joko', createdBy: 'u-raka', due: day(5), priority: 'high', source: 'braindump', workspaceId: 'pnp' }),
  task({ id: 'task-cut', title: 'Cut 15s and 6s versions of the reel', teamId: 't-video', briefId: 'brief-kopinara', clientId: 'c-kopinara', userId: '', createdBy: 'u-raka', due: day(7), priority: 'normal', source: 'braindump', workspaceId: 'pnp' }),
  task({ id: 'task-statics', visibleToClient: true, approval: { status: 'waiting', askedBy: 'u-emma', askedAt: ago(60 * 5) }, title: 'Design four Q4 statics', teamId: 't-design', briefId: 'brief-kopinara', clientId: 'c-kopinara', userId: 'u-emma', createdBy: 'u-raka', due: day(4), priority: 'normal', source: 'braindump', workspaceId: 'pnp' }),
  task({ id: 'task-teaser', title: 'Selara 12.12 teaser video', teamId: 't-video', clientId: 'c-selara', userId: 'u-joko', createdBy: 'u-hendra', due: day(9), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-carousel', title: 'Retargeting carousel for Selara bundles', teamId: 't-design', clientId: 'c-selara', userId: '', createdBy: 'u-bima', due: day(2), priority: 'high', source: 'chat', workspaceId: 'pnp' }),
  task({ id: 'task-deck', title: 'Teduh pitch deck visuals', teamId: 't-design', clientId: 'c-teduh', userId: 'u-emma', createdBy: 'u-sofia', due: day(-1), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-glow', title: 'Brightleaf launch video, 3 hooks', teamId: 't-video', clientId: 'c-brightleaf', userId: 'u-joko', createdBy: 'u-sofia', due: day(12), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-recap', title: 'Kopinara September performance recap', teamId: 't-perf', clientId: 'c-kopinara', userId: 'u-bima', createdBy: 'u-raka', due: day(-4), priority: 'normal', source: 'manual', workspaceId: 'pnp', done: true, doneBy: 'u-bima', doneAt: ago(60 * 30) }),
  {
    id: 'brief-kopinara',
    kind: 'brief',
    title: 'Kopinara Q4 "morning ritual" campaign',
    visibleToClient: true,
    context:
      'Goal: launch the Q4 campaign around the "morning ritual" angle that Laras’s CEO loved.\n\nDeliverables: 4 concept directions, a 30s hero reel with 15s and 6s cutdowns, 4 statics.\n\nBackground: Q3 ads that showed the product in a home routine had the best ROAS (3.8). Keep the warm, slow style.\n\nReview call Thursday 2pm WIB. Assets in Drive › Clients › Kopinara › Q4.',
    clientId: 'c-kopinara',
    userId: 'u-raka',
    createdBy: 'u-raka',
    due: day(10),
    priority: 'high',
    source: 'braindump',
    workspaceId: 'pnp',
    done: false,
    status: 'doing',
    createdAt: ago(60 * 26),
  },
  task({ id: 'task-timesheets', title: 'Submit October timesheets', channelId: 'ch-general', userId: 'u-raka', createdBy: 'u-intan', due: day(4), priority: 'normal', source: 'chat', workspaceId: 'pnp' }),
  task({ id: 'task-lunch', title: 'Book Friday team lunch', channelId: 'ch-general', userId: 'u-sofia', createdBy: 'u-hendra', due: day(3), priority: 'normal', source: 'chat', workspaceId: 'pnp' }),
  task({ id: 'task-wifi', title: 'Fix the office wifi password sign', channelId: 'ch-general', userId: 'u-intan', createdBy: 'u-hendra', priority: 'normal', source: 'chat', workspaceId: 'pnp', done: true, doneBy: 'u-intan', doneAt: ago(60 * 26) }),
  task({ title: 'Prepare growth partner proposal for Lereng Coffee', teamId: 't-growth', clientId: 'c-lerengcoffee', userId: 'u-raka', createdBy: 'u-raka', due: day(2), priority: 'high', source: 'manual', workspaceId: 'elk' }),
  task({ title: 'Review November reorder plan', teamId: 't-growth', clientId: 'c-supplements', userId: 'u-raka', createdBy: 'u-yusuf', due: day(4), priority: 'normal', source: 'manual', workspaceId: 'elk' }),
  task({ title: 'Launch bundle landing page', teamId: 't-web', clientId: 'c-supplements', userId: 'u-tomas', createdBy: 'u-raka', due: day(1), priority: 'normal', source: 'manual', workspaceId: 'elk', status: 'doing' }),
];

export const CHANNELS: Channel[] = [
  { id: 'ch-general', workspaceId: 'pnp', kind: 'channel', name: 'general', members: ['u-raka', 'u-hendra', 'u-sofia', 'u-bima', 'u-intan', 'u-joko', 'u-emma'], topic: 'Company-wide news and questions', category: 'team', ownerId: 'u-hendra' },
  { id: 'ch-random', workspaceId: 'pnp', kind: 'channel', name: 'random', members: ['u-raka', 'u-hendra', 'u-sofia', 'u-bima', 'u-intan', 'u-joko', 'u-emma'], topic: 'Lunch, memes, weekend plans', category: 'social', ownerId: 'u-sofia' },
  { id: 'ch-kopinara', workspaceId: 'pnp', kind: 'channel', name: 'kopinara', members: ['u-raka', 'u-bima', 'u-intan', 'u-joko', 'u-emma'], clientId: 'c-kopinara', topic: 'Q4 creative + retainer', category: 'client', ownerId: 'u-raka',
    summary: {
      schedule: 'monthly',
      post: false,
      history: [
        { id: 'sum-kk-sep', period: 'September 2026', at: '2026-10-01T01:00:00.000Z', auto: true, text: 'September: Kopinara signed the Q4 retainer. The team delivered the September performance recap (ROAS 3.8 on home-routine ads). Laras joined as a guest and asked for four Q4 concept directions. Open: whether the Q4 budget is final.' },
        { id: 'sum-kk-aug', period: 'August 2026', at: '2026-09-01T01:00:00.000Z', auto: true, text: 'August: the café-shot campaign ended above target. Kopinara asked for a proposal for Q4. Invoices for July and August were paid.' },
      ],
    },
    bookmarks: [
      { id: 'bm1', title: 'Q4 brief (Google Doc)', url: 'https://docs.google.com/document/d/kopinara-q4-brief', addedBy: 'u-raka', at: '2026-09-28T03:00:00.000Z' },
      { id: 'bm2', title: 'Kopinara brand guidelines', url: 'https://kopinara.example/brand', addedBy: 'u-emma', at: '2026-09-20T03:00:00.000Z' },
    ], },
  { id: 'ch-kopinara-shared', workspaceId: 'pnp', kind: 'channel', name: 'kopinara-x-studio', members: ['u-raka', 'u-emma', 'u-bima'], clientId: 'c-kopinara', topic: 'With the Kopinara team: previews, approvals, dates', category: 'shared', ownerId: 'u-raka',
    guests: [{ email: 'laras@kopinara.example', name: 'Laras Anindita', status: 'joined', invitedBy: 'u-raka', at: '2026-09-20T03:00:00.000Z' }] },
  { id: 'ch-rimba-shared', workspaceId: 'pnp', kind: 'channel', name: 'rimba-x-studio', members: ['u-raka', 'u-sofia', 'u-bima'], clientId: 'c-rimba', topic: 'Supplements launch ads with the Rimba team', category: 'shared', ownerId: 'u-sofia', guests: [{ email: 'yusuf@rimbagroup.example', name: 'Yusuf Halim', status: 'joined', invitedBy: 'u-sofia', at: '2026-09-25T03:00:00.000Z' }] },
  { id: 'ch-selara', workspaceId: 'pnp', kind: 'channel', name: 'selara-skin', members: ['u-raka', 'u-hendra', 'u-bima', 'u-emma', 'u-joko'], clientId: 'c-selara', topic: '11.11 and 12.12 push', category: 'client', ownerId: 'u-hendra' },
  { id: 'ch-teduh', workspaceId: 'pnp', kind: 'channel', name: 'teduh-hotels', members: ['u-raka', 'u-sofia'], clientId: 'c-teduh', topic: 'New business', category: 'client', ownerId: 'u-sofia', private: true },
  { id: 'ch-video', workspaceId: 'pnp', kind: 'channel', name: 'video-editing', members: ['u-joko', 'u-bima', 'u-raka'], teamId: 't-video', topic: 'Edits, cuts, feedback rounds', category: 'team', ownerId: 'u-joko' },
  { id: 'ch-design', workspaceId: 'pnp', kind: 'channel', name: 'graphic-design', members: ['u-emma', 'u-raka'], teamId: 't-design', topic: 'Statics, key visuals, decks', category: 'team', ownerId: 'u-emma' },
  { id: 'ch-q4', workspaceId: 'pnp', kind: 'channel', name: 'q4-planning', members: ['u-raka', 'u-hendra', 'u-sofia'], topic: 'Agency goals and hiring for Q4', category: 'project', ownerId: 'u-hendra', private: true },
  { id: 'dm-raka-bima', workspaceId: 'pnp', kind: 'dm', name: '', members: ['u-raka', 'u-bima'] },
  { id: 'dm-raka-hendra', workspaceId: 'pnp', kind: 'dm', name: '', members: ['u-raka', 'u-hendra'] },
  { id: 'ch-elk-general', workspaceId: 'elk', kind: 'channel', name: 'general', members: ['u-raka', 'u-yusuf', 'u-tomas'], topic: 'Rimba Group', category: 'team', ownerId: 'u-raka' },
  { id: 'ch-supplements', workspaceId: 'elk', kind: 'channel', name: 'supplements', members: ['u-raka', 'u-yusuf', 'u-tomas'], clientId: 'c-supplements', category: 'client', ownerId: 'u-yusuf' },
  { id: 'dm-raka-yusuf', workspaceId: 'elk', kind: 'dm', name: '', members: ['u-raka', 'u-yusuf'] },
];

let m = 0;
const msg = (channelId: string, userId: string, minutesAgo: number, text: string, taskId?: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `msg-${++m}`,
  channelId,
  userId,
  at: ago(minutesAgo),
  text,
  taskId,
  ...extra,
});

export const MESSAGES: ChatMessage[] = [
  { id: 'msg-elk-1', channelId: 'ch-rimba-shared', userId: 'u-sofia', at: ago(60 * 5), text: 'Yusuf, the three hooks for the supplements launch are ready for your approval in the portal.' },
  { id: 'msg-elk-2', channelId: 'ch-rimba-shared', userId: 'guest', guestEmail: 'yusuf@rimbagroup.example', at: ago(60 * 4), text: 'Great, I’ll check them this afternoon.' },
  msg('ch-general', 'u-hendra', 60 * 26, 'Morning team. Big week: Selara 11.11 prep and the Kopinara concepts are both due.', undefined, { pinned: true }),
  msg('ch-general', 'u-intan', 60 * 27, 'Office wifi: PNP-Office / password on the fridge. Client wifi is PNP-Guest.', undefined, { pinned: true }),
  msg('ch-general', 'u-sofia', 60 * 25, 'Brightleaf reached out through hello@. I’ll take the first call.'),
  msg('ch-general', 'u-intan', 60 * 5, 'Reminder: timesheets for October by Friday please 🙏'),
  msg('ch-general', 'u-hendra', 60 * 3, 'for turning the Selara key visual around in one day', undefined, { kind: 'kudos', kudosFor: 'u-emma', reactions: { '🙌': ['u-raka', 'u-bima', 'u-joko'] } }),
  msg('ch-random', 'u-joko', 60 * 30, 'Anyone else watching the F1 this weekend? 🏎️', undefined, { reactions: { '🔥': ['u-bima', 'u-emma'], '😂': ['u-sofia'] } }),
  msg('ch-video', 'u-joko', 60 * 6, 'First cut of the Kopinara reel is in Drive. 32s, need to trim 2s.', undefined, { files: [{ name: 'Kopinara_morning_ritual_v1.mp4', size: 48_200_000, type: 'video/mp4' }] }),
  msg('ch-video', 'u-bima', 60 * 5.5, 'Love the slow pour shot. Maybe open on that?', undefined, { reactions: { '👍': ['u-joko', 'u-raka'] } }),
  msg('ch-design', 'u-emma', 60 * 9, 'Moodboard for Brightleaf, clean and science-y like Nina asked', undefined, { files: [{ name: 'Brightleaf_moodboard.pdf', size: 6_400_000, type: 'application/pdf' }] }),
  msg('ch-q4', 'u-hendra', 60 * 28, 'Goal for Q4: 3 new retainers, hire one performance marketer.'),
  msg('ch-kopinara', 'u-raka', 60 * 4, 'Laras’s CEO loved the “morning ritual” angle. Let’s make one of the four directions lean into it.', undefined, { id: 'msg-kk-root', reactions: { '🔥': ['u-bima', 'u-emma'], '🙌': ['u-joko'] } }),
  { id: 'msg-kk-r1', channelId: 'ch-kopinara', userId: 'u-emma', at: ago(60 * 3.9), text: 'Love it. I can do the statics in warm morning light, soft shadows.', parentId: 'msg-kk-root' },
  { id: 'msg-kk-r2', channelId: 'ch-kopinara', userId: 'u-joko', at: ago(60 * 3.8), text: 'For the reel I’ll shoot the slow pour as the hero moment.', parentId: 'msg-kk-root' },
  { id: 'msg-kk-g', channelId: 'ch-kopinara-shared', userId: 'u-raka', at: ago(60 * 3.7), text: 'Laras, sharing the direction here so you can follow along 🙏', guestEmail: undefined },
  { id: 'msg-kk-n', channelId: 'ch-kopinara-shared', userId: 'guest', guestEmail: 'laras@kopinara.example', at: ago(60 * 3.2), text: 'Thanks! Our CEO is excited. Can we see a first look before Thursday?' },
  msg('ch-kopinara', 'u-bima', 60 * 3.6, 'On it. I’ll storyboard a 30s short-form version first.', 'task-2'),
  msg('ch-kopinara', 'u-raka', 50, '@Bima can you also pull last quarter’s top 3 ads for reference?'),
  msg('ch-kopinara', 'u-emma', 40, 'Moodboard for the morning ritual statics: https://www.figma.com/file/kk-morning-ritual'),
  msg('ch-kopinara', 'u-joko', 30, 'Reference for the slow pour, love the pacing here https://www.youtube.com/watch?v=coffee-pour-ref'),
  msg('ch-selara', 'u-hendra', 60 * 8, 'Hannah approved scaling for 11.11. @Bima please build the campaign structure by tomorrow.', 'task-4'),
  msg('ch-selara', 'u-bima', 60 * 7.5, 'Will do. Bundles + retargeting first.'),
  msg('ch-teduh', 'u-sofia', 60 * 30, 'Proposal went out yesterday. No reply yet.'),
  msg('dm-raka-bima', 'u-bima', 35, 'Hey, quick one: do we keep Thursday 2pm for the Kopinara review?'),
  msg('dm-raka-bima', 'u-bima', 33, '', undefined, { voice: { seconds: 14, transcript: 'Also, Laras asked if we can send a first look before Thursday. I think Joko’s cut is close, can I share it?' } }),
  msg('dm-raka-hendra', 'u-hendra', 60 * 20, 'Can you look at the shortlist before Friday?', 'task-9'),
  msg('ch-elk-general', 'u-tomas', 60 * 6, 'DNS for rimbagroup.example is ready whenever you are.'),
  msg('ch-supplements', 'u-yusuf', 60 * 2, 'October closed at 1,240 orders, +18% MoM. Reorder plan is in Drive.'),
];

const sec = (m: number, s = 0) => (m * 60 + s) * 1000;
const tx = (lines: [number, number, string, string][]) => lines.map(([m, s2, speaker, text]) => ({ at: sec(m, s2), speaker, text }));
const log = (minutesAgo: number, ...msgs: string[]) => msgs.map((message, i) => ({ message, at: ago(minutesAgo - i * 0.3) }));

export const MEETINGS: Meeting[] = [
  {
    id: 'mt-kopinara',
    workspaceId: 'pnp',
    title: 'Kopinara weekly sync',
    at: ago(60 * 22),
    minutes: 34,
    clientId: 'c-kopinara',
    filedBy: 'rule',
    sharedWithClient: true,
    status: 'done',
    platform: 'meet',
    url: 'https://meet.google.com/kpk-wkly-syn',
    type: 'client',
    tags: ['q4', 'creative', 'video'],
    attendees: ['Raka', 'Bima', 'Laras Anindita'],
    summary: 'Laras’s CEO wants one of the four Q4 directions to lean into the “morning ritual” angle. Short-form video comes first, statics second. The review call moves to Thursday 2pm WIB.',
    keyPoints: ['The CEO loved the “morning ritual” angle from the first round', 'Short-form video is the priority for Q4, statics come after', 'Last quarter’s home-routine ads had the best ROAS (3.8)'],
    decisions: ['One of the four directions will be built around the morning ritual', 'Review call moves to Thursday 2pm WIB'],
    openQuestions: ['Can Kopinara share raw footage from their own shoot?', 'Is the Q4 budget final or still with finance?'],
    topics: [
      { name: 'First round feedback', at: sec(0, 40) },
      { name: 'Morning ritual angle', at: sec(6, 10) },
      { name: 'Video before statics', at: sec(14, 30) },
      { name: 'Timeline and review call', at: sec(26, 5) },
    ],
    transcript: tx([
      [0, 12, 'Raka', 'Morning Laras, thanks for making time. Shall we start with the feedback on the four directions?'],
      [0, 40, 'Laras Anindita', 'Yes. Honestly our CEO loved one thing most, the morning ritual idea.'],
      [1, 5, 'Laras Anindita', 'The slow pour, the steam, someone starting their day. That felt like Kopinara.'],
      [6, 10, 'Raka', 'Great. Then let’s make one of the four directions lean fully into the morning ritual.'],
      [6, 42, 'Bima', 'That fits the data too. The home-routine ads last quarter had our best ROAS, about 3.8.'],
      [9, 30, 'Laras Anindita', 'Could you also share last quarter’s top three ads? I want to show the CEO why.'],
      [9, 51, 'Bima', 'Sure, I’ll pull those together for you.'],
      [14, 30, 'Raka', 'For production, we’d do short-form video first and the statics second.'],
      [15, 2, 'Laras Anindita', 'Agreed. TikTok and Reels matter most for us in Q4.'],
      [18, 20, 'Bima', 'I’ll storyboard a thirty-second version of the morning ritual by Thursday.'],
      [22, 48, 'Laras Anindita', 'Can we get raw footage from our own shoot into this? We have some nice café shots.'],
      [23, 15, 'Raka', 'Yes please, send it over and we’ll see what fits.'],
      [26, 5, 'Raka', 'Let’s move the review call to Thursday at 2pm Jakarta time. Does that work?'],
      [26, 20, 'Laras Anindita', 'Thursday 2pm works.'],
      [33, 40, 'Raka', 'Perfect, thanks everyone. Notes and tasks will be in sprint2go.'],
    ]),
    log: log(60 * 22 + 36, 'Sent from Google Calendar: Kopinara weekly sync', 'Joining Google Meet as “Studio Notetaker”', 'Waiting to be let in', 'Let in by Raka', 'Recording', 'Everyone else left', 'Writing notes with DeepSeek V4 Pro (SumoPod)', 'Filed in Kopinara by rule: domain kopinara.example', 'Done'),
    actions: [
      { title: 'Storyboard the "morning ritual" short-form video', owner: 'Bima', due: 'Thu', taskId: 'task-2', saidAt: sec(18, 20) },
      { title: 'Move the review call to Thursday 2pm WIB', owner: 'Raka', due: 'Thu', saidAt: sec(26, 5) },
      { title: 'Share last quarter’s top 3 ads with Laras', owner: 'Bima', saidAt: sec(9, 51) },
    ],
    recording: { keep: 'video', sizeMb: 620 },
    share: { token: 'kp7Qw2', transcript: true, video: false },
    access: { watch: 'everyone', download: false, transcript: 'everyone' },
    createdBy: 'u-raka',
  },
  {
    id: 'mt-selara',
    workspaceId: 'pnp',
    title: 'Selara Skin monthly review',
    at: ago(60 * 50),
    minutes: 47,
    clientId: 'c-selara',
    filedBy: 'ai',
    status: 'done',
    platform: 'zoom',
    url: 'https://zoom.us/j/9384110223',
    type: 'client',
    tags: ['performance', '11.11', 'budget'],
    attendees: ['Hendra', 'Raka', 'Bima', 'Hannah Koh'],
    summary: 'Blended ROAS rose to 4.1 from 3.2 and new-customer revenue grew 38%. Hannah approved scaling for 11.11 and wants 12.12 budget scenarios next week.',
    keyPoints: ['Blended ROAS 4.1, up from 3.2', 'New-customer revenue up 38%', 'Bundles drove most of the growth'],
    decisions: ['Scale spend for 11.11', 'Prepare three 12.12 budget scenarios'],
    openQuestions: ['Will Selara restock the bundle SKUs in time for 12.12?'],
    topics: [
      { name: 'September results', at: sec(1, 0) },
      { name: '11.11 plan', at: sec(18, 0) },
      { name: '12.12 budget', at: sec(36, 0) },
    ],
    transcript: tx([
      [1, 0, 'Hendra', 'Let’s start with September. Blended ROAS came in at 4.1, up from 3.2.'],
      [2, 30, 'Hannah Koh', 'That’s great. And new customers?'],
      [2, 45, 'Hendra', 'New-customer revenue grew 38 percent, mostly from the bundles.'],
      [18, 0, 'Bima', 'For 11.11 I’d build the campaign structure around bundles plus retargeting.'],
      [19, 20, 'Hannah Koh', 'Approved. Please scale for 11.11.'],
      [36, 0, 'Hannah Koh', 'For 12.12, can you send me budget scenarios next week?'],
      [36, 30, 'Hendra', 'Yes, I’ll prepare three scenarios.'],
    ]),
    log: log(60 * 50 + 49, 'Joining Zoom as “Studio Notetaker”', 'Recording', 'Writing notes', 'Filed in Selara Skin by AI', 'Done'),
    actions: [
      { title: 'Build 11.11 campaign structure in Meta', owner: 'Bima', due: 'Tomorrow', taskId: 'task-4', saidAt: sec(18, 0) },
      { title: 'Prepare 12.12 budget scenarios', owner: 'Hendra', due: 'Next week', taskId: 'task-5', saidAt: sec(36, 30) },
    ],
    recording: { keep: 'audio', sizeMb: 38 },
    access: { watch: 'attendees', download: false, transcript: 'everyone' },
    createdBy: 'u-hendra',
  },
  {
    id: 'mt-standup',
    workspaceId: 'pnp',
    title: 'Daily standup',
    at: ago(60 * 5),
    minutes: 14,
    status: 'done',
    platform: 'meet',
    type: 'internal',
    tags: ['standup'],
    attendees: ['Raka', 'Hendra', 'Bima', 'Joko', 'Emma'],
    summary: 'Joko is cutting the Kopinara reel; Emma is on the Brightleaf moodboard and four Q4 statics; Bima flagged the Selara carousel has no owner yet.',
    keyPoints: ['Kopinara reel first cut is 32s, needs trimming', 'Brightleaf moodboard shared in #graphic-design', 'Selara retargeting carousel needs a designer'],
    decisions: [],
    openQuestions: ['Who takes the Selara carousel?'],
    topics: [{ name: 'Round the table', at: sec(0, 30) }],
    transcript: tx([
      [0, 30, 'Joko', 'Reel first cut is in Drive, 32 seconds, I need to trim two.'],
      [3, 10, 'Emma', 'Brightleaf moodboard is shared. Starting the Q4 statics today.'],
      [6, 40, 'Bima', 'The Selara retargeting carousel still has no designer on it.'],
    ]),
    log: log(60 * 5 + 15, 'Recording', 'Writing notes', 'Kept notes and transcript only (internal meeting)', 'Done'),
    actions: [{ title: 'Pick a designer for the Selara carousel', owner: 'Hendra', saidAt: sec(6, 40) }],
    recording: { keep: 'notes', sizeMb: 0.4 },
    createdBy: 'u-hendra',
  },
  {
    id: 'mt-brightleaf',
    workspaceId: 'pnp',
    title: 'Brightleaf discovery call',
    at: ago(12),
    minutes: 12,
    clientId: 'c-brightleaf',
    filedBy: 'rule',
    status: 'recording',
    platform: 'meet',
    url: 'https://meet.google.com/glw-disc-ovr',
    type: 'sales',
    attendees: ['Sofia', 'Nina'],
    summary: '',
    transcript: tx([
      [0, 20, 'Sofia', 'Hi Nina, thanks for jumping on. Tell me about the launch.'],
      [0, 55, 'Nina', 'We launch our serum line in November. We want 500 pre-orders before 11.11.'],
      [2, 10, 'Sofia', 'And how do you want it to feel?'],
      [2, 30, 'Nina', 'Clean, science-y, but warm. Not cold clinical.'],
    ]),
    log: log(13, 'Sent from Google Calendar: Brightleaf discovery call', 'Joining Google Meet as “Studio Notetaker”', 'Let in by Sofia', 'Recording'),
    actions: [],
    createdBy: 'u-sofia',
  },
  {
    id: 'mt-teduh',
    workspaceId: 'pnp',
    title: 'Teduh Hotels intro',
    at: ago(60 * 27),
    minutes: 0,
    clientId: 'c-teduh',
    filedBy: 'user',
    status: 'failed',
    error: 'Nobody let the bot in',
    platform: 'zoom',
    url: 'https://zoom.us/j/5521093384',
    attendees: ['Sofia', 'Yusuf'],
    summary: '',
    log: log(60 * 27 + 11, 'Joining Zoom as “Studio Notetaker”', 'Waiting to be let in', 'Nobody let the bot in after 10 minutes'),
    actions: [],
    createdBy: 'u-sofia',
  },
  {
    id: 'mt-supp',
    workspaceId: 'elk',
    title: 'Supplements brand weekly',
    at: ago(60 * 28),
    minutes: 25,
    clientId: 'c-supplements',
    filedBy: 'ai',
    status: 'done',
    platform: 'meet',
    type: 'client',
    attendees: ['Raka', 'Yusuf', 'Tomas'],
    summary: 'October beat target. The bundle launch lifted repeat rate. The new landing page goes live this week.',
    keyPoints: ['October closed at 1,240 orders, +18% month on month', 'Bundles lifted the repeat rate'],
    decisions: ['Launch the bundle landing page this week'],
    openQuestions: [],
    transcript: tx([[1, 0, 'Yusuf', 'October closed at 1,240 orders, up 18 percent.'], [5, 0, 'Tomas', 'The bundle landing page goes live this week.']]),
    log: log(60 * 28 + 26, 'Recording', 'Writing notes', 'Done'),
    actions: [
      { title: 'Launch bundle landing page', owner: 'Tomas', taskId: 'task-12', saidAt: sec(5, 0) },
      { title: 'Review November reorder plan', owner: 'Raka', taskId: 'task-11' },
    ],
    recording: { keep: 'video', sizeMb: 470 },
    createdBy: 'u-raka',
  },
];

/** Lines the demo bot "hears" when you send it to a new meeting (the real bot reads the meeting's captions). */
export const DEMO_SCRIPT: { speaker: string; text: string }[] = [
  { speaker: 'You', text: 'Thanks for joining. Quick agenda: results, next campaign, and who does what.' },
  { speaker: 'Client', text: 'Sounds good. Results first, please.' },
  { speaker: 'You', text: 'Orders are up 22 percent and cost per order is down a little.' },
  { speaker: 'Client', text: 'Great. For the next campaign we want more video.' },
  { speaker: 'You', text: 'Then let’s plan three short videos. Joko can edit them by next Friday.' },
  { speaker: 'Client', text: 'Can you also send a proposal with the budget?' },
  { speaker: 'You', text: 'Yes, I’ll send the proposal by Wednesday.' },
  { speaker: 'Client', text: 'Perfect, talk soon.' },
];

export const NOTICES: Notice[] = [
  { id: 'nt-1', userId: 'u-raka', workspaceId: 'pnp', kind: 'task', text: 'Hendra assigned you “Shortlist top 3 performance marketer candidates”', at: ago(60 * 20), read: false, link: { app: 'tasks', id: 'task-9' } },
  { id: 'nt-2', userId: 'u-raka', workspaceId: 'pnp', kind: 'meeting', text: 'Notes are ready for “Kopinara weekly sync” · 3 action items', at: ago(60 * 21), read: false, link: { app: 'meet', id: 'mt-kopinara' } },
  { id: 'nt-3', userId: 'u-raka', workspaceId: 'pnp', kind: 'mention', text: 'Bima messaged you: “do we keep Thursday 2pm for the Kopinara review?”', at: ago(35), read: false, link: { app: 'chat', id: 'dm-raka-bima' } },
  { id: 'nt-4', userId: 'u-bima', workspaceId: 'pnp', kind: 'mention', text: 'Raka mentioned you in #kopinara', at: ago(50), read: false, link: { app: 'chat', id: 'ch-kopinara' } },
  { id: 'nt-5', userId: 'u-bima', workspaceId: 'pnp', kind: 'task', text: 'Hendra assigned you “Build 11.11 campaign structure in Meta”', at: ago(60 * 8), read: false, link: { app: 'tasks', id: 'task-4' } },
  { id: 'nt-6', userId: 'u-raka', workspaceId: 'elk', kind: 'task', text: 'Yusuf assigned you “Review November reorder plan”', at: ago(60 * 2), read: false, link: { app: 'tasks', id: 'task-11' } },
];

// Tasks that came from a meeting remember which one, and the moment they were said.
for (const m of MEETINGS)
  for (const a of m.actions) {
    const t = a.taskId ? TASKS.find((x) => x.id === a.taskId) : undefined;
    if (t) Object.assign(t, { meetingId: m.id, saidAt: a.saidAt });
  }

// Everyone on a task: who does it, who supervises (whoever assigned it), and a history that starts at creation.
const SRC_WORD: Record<Todo['source'], string> = { ai: 'from an email', manual: '', braindump: 'from a brain dump', chat: 'from chat', meeting: 'from a meeting', request: 'from a client request', import: 'from an import' };
for (const t of TASKS) {
  t.assignees = t.userId ? [t.userId] : [];
  t.supervisorId = t.createdBy;
  t.history = [{ id: `${t.id}-c`, at: t.createdAt, by: t.createdBy ?? t.userId, kind: 'created', text: `created this ${SRC_WORD[t.source]}`.trim() }];
}
const T = (id: string) => TASKS.find((t) => t.id === id)!;
// Two people on the reel, with a conversation in its history.
Object.assign(T('task-reel'), { assignees: ['u-joko', 'u-bima'], followers: ['u-emma'] });
T('task-reel').history!.push(
  { id: 'h-r1', at: ago(60 * 5), by: 'u-raka', kind: 'assigned', text: 'added Bima to help with the cutdowns' },
  { id: 'h-r2', at: ago(60 * 4), by: 'u-joko', kind: 'comment', text: 'First cut is 32s. Trimming 2s today, can you check the pour shot @Raka?' },
  { id: 'h-r3', at: ago(60 * 3), by: 'u-raka', kind: 'comment', text: 'Pour shot is perfect. Open on it.' },
);
// Emma finished the Teduh deck; Design has the review step on, so it waits for Sofia.
Object.assign(T('task-deck'), { status: 'review' });
T('task-deck').history!.push({ id: 'h-d1', at: ago(60 * 2), by: 'u-emma', kind: 'review', text: 'finished it and sent it for review' });
// Brightleaf call: the ball is in the client's court.
Object.assign(T('task-8'), { status: 'waiting' });
T('task-8').history!.push({ id: 'h-g1', at: ago(60 * 6), by: 'u-sofia', kind: 'status', text: 'set it to Waiting on client: Nina is picking a time' });
