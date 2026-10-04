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
  { id: 'c-kopikita', workspaceId: 'pnp', name: 'KopiKita', domain: 'kopikita.co.id', color: '#b45309', status: 'active', ownerId: 'u-aqeel' },
  { id: 'c-lumina', workspaceId: 'pnp', name: 'Lumina Skin', domain: 'luminaskin.sg', color: '#ec4899', status: 'active', ownerId: 'u-faisal' },
  { id: 'c-arunika', workspaceId: 'pnp', name: 'Arunika Hotels', domain: 'arunikahotels.id', color: '#0ea5e9', status: 'lead', ownerId: 'u-aqeel' },
  { id: 'c-glowkind', workspaceId: 'pnp', name: 'Glowkind', domain: 'glowkind.id', color: '#a855f7', status: 'lead', ownerId: 'u-aditya' },
  { id: 'c-kopiharian', workspaceId: 'elk', name: 'Kopi Harian', domain: 'kopiharian.id', color: '#92400e', status: 'lead', ownerId: 'u-aqeel' },
  { id: 'c-supplements', workspaceId: 'elk', name: 'Supplements brand', color: '#16a34a', status: 'active', ownerId: 'u-dimas' },
];

export const TEAMS: Team[] = [
  { id: 't-account', workspaceId: 'pnp', name: 'Account management', color: '#0ea5e9', leadId: 'u-aditya', members: ['u-aqeel', 'u-aditya'], keywords: ['follow up', 'call', 'proposal', 'retainer', 'report', 'meeting', 'brief the client', 'onboard'] },
  { id: 't-perf', workspaceId: 'pnp', name: 'Performance', color: '#10b981', leadId: 'u-faisal', members: ['u-faisal', 'u-rizky'], keywords: ['ads', 'ad ', 'campaign', 'meta', 'roas', 'retargeting', 'budget', 'structure', 'scaling', 'audience'] },
  { id: 't-video', workspaceId: 'pnp', name: 'Video editing', color: '#f97316', leadId: 'u-nanda', members: ['u-nanda', 'u-rizky'], keywords: ['video', 'reel', 'storyboard', 'edit', 'footage', 'cutdown', 'short-form', 'tiktok', 'shoot'] },
  { id: 't-design', workspaceId: 'pnp', name: 'Graphic design', color: '#8b5cf6', leadId: 'u-sekar', review: true, members: ['u-sekar', 'u-aqeel'], keywords: ['design', 'static', 'visual', 'concept', 'moodboard', 'banner', 'logo', 'deck', 'carousel', 'key visual'] },
  { id: 't-finance', workspaceId: 'pnp', name: 'Finance', color: '#d946ef', leadId: 'u-dewi', members: ['u-dewi'], keywords: ['invoice', 'payment', 'timesheet', 'contract', 'tax', 'payroll'] },
  { id: 't-growth', workspaceId: 'elk', name: 'Growth', color: '#14b8a6', leadId: 'u-dimas', members: ['u-dimas', 'u-aqeel'], keywords: ['orders', 'reorder', 'campaign', 'bundle', 'proposal'] },
  { id: 't-web', workspaceId: 'elk', name: 'Web & systems', color: '#ef4444', leadId: 'u-bayu', members: ['u-bayu'], keywords: ['landing', 'website', 'page', 'dns', 'domain', 'checkout'] },
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
  task({ visibleToClient: true, approval: { status: 'approved', askedBy: 'u-aqeel', askedAt: ago(60 * 30), by: 'nadia@kopikita.co.id', at: ago(60 * 20), note: 'Love direction 2 and 3!' }, title: 'Finish four Q4 concept directions', teamId: 't-design', briefId: 'brief-kopikita', clientId: 'c-kopikita', userId: 'u-aqeel', createdBy: 'u-aqeel', due: day(2), priority: 'high', source: 'manual', workspaceId: 'pnp', status: 'doing' }),
  task({ title: 'Storyboard the "morning ritual" short-form video', teamId: 't-video', briefId: 'brief-kopikita', clientId: 'c-kopikita', userId: 'u-rizky', createdBy: 'u-aqeel', due: day(3), priority: 'normal', source: 'meeting', workspaceId: 'pnp' }),
  task({ title: 'Send October invoice to Nadia', teamId: 't-finance', clientId: 'c-kopikita', userId: 'u-dewi', createdBy: 'u-aqeel', due: day(-1), priority: 'high', source: 'braindump', workspaceId: 'pnp' }),
  task({ title: 'Build 11.11 campaign structure in Meta', teamId: 't-perf', clientId: 'c-lumina', userId: 'u-rizky', createdBy: 'u-faisal', due: day(1), priority: 'high', source: 'chat', workspaceId: 'pnp', status: 'doing' }),
  task({ title: 'Prepare 12.12 budget scenarios', teamId: 't-perf', clientId: 'c-lumina', userId: 'u-faisal', createdBy: 'u-faisal', due: day(4), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-lkv', title: 'Lumina 11.11 key visual', teamId: 't-design', clientId: 'c-lumina', userId: 'u-sekar', createdBy: 'u-faisal', due: day(-2), priority: 'normal', source: 'manual', workspaceId: 'pnp', done: true, doneBy: 'u-sekar', doneAt: ago(60 * 20) }),
  task({ title: 'September report to Sarah', teamId: 't-account', clientId: 'c-lumina', userId: 'u-aqeel', createdBy: 'u-aqeel', due: day(-3), priority: 'normal', source: 'manual', workspaceId: 'pnp', done: true }),
  task({ title: 'Follow up with Dimas on the Q1 retainer', teamId: 't-account', clientId: 'c-arunika', userId: 'u-aqeel', createdBy: 'u-aqeel', due: day(5), priority: 'normal', source: 'braindump', workspaceId: 'pnp' }),
  task({ title: 'Book discovery call with Rina', teamId: 't-account', clientId: 'c-glowkind', userId: 'u-aditya', createdBy: 'u-aqeel', due: day(0), priority: 'high', source: 'manual', workspaceId: 'pnp' }),
  task({ title: 'Shortlist top 3 performance marketer candidates', userId: 'u-aqeel', createdBy: 'u-faisal', due: day(3), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-reel', visibleToClient: true, title: 'Edit the 30s "morning ritual" reel', teamId: 't-video', briefId: 'brief-kopikita', clientId: 'c-kopikita', userId: 'u-nanda', createdBy: 'u-aqeel', due: day(5), priority: 'high', source: 'braindump', workspaceId: 'pnp' }),
  task({ id: 'task-cut', title: 'Cut 15s and 6s versions of the reel', teamId: 't-video', briefId: 'brief-kopikita', clientId: 'c-kopikita', userId: '', createdBy: 'u-aqeel', due: day(7), priority: 'normal', source: 'braindump', workspaceId: 'pnp' }),
  task({ id: 'task-statics', visibleToClient: true, approval: { status: 'waiting', askedBy: 'u-sekar', askedAt: ago(60 * 5) }, title: 'Design four Q4 statics', teamId: 't-design', briefId: 'brief-kopikita', clientId: 'c-kopikita', userId: 'u-sekar', createdBy: 'u-aqeel', due: day(4), priority: 'normal', source: 'braindump', workspaceId: 'pnp' }),
  task({ id: 'task-teaser', title: 'Lumina 12.12 teaser video', teamId: 't-video', clientId: 'c-lumina', userId: 'u-nanda', createdBy: 'u-faisal', due: day(9), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-carousel', title: 'Retargeting carousel for Lumina bundles', teamId: 't-design', clientId: 'c-lumina', userId: '', createdBy: 'u-rizky', due: day(2), priority: 'high', source: 'chat', workspaceId: 'pnp' }),
  task({ id: 'task-deck', title: 'Arunika pitch deck visuals', teamId: 't-design', clientId: 'c-arunika', userId: 'u-sekar', createdBy: 'u-aditya', due: day(-1), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-glow', title: 'Glowkind launch video, 3 hooks', teamId: 't-video', clientId: 'c-glowkind', userId: 'u-nanda', createdBy: 'u-aditya', due: day(12), priority: 'normal', source: 'manual', workspaceId: 'pnp' }),
  task({ id: 'task-recap', title: 'KopiKita September performance recap', teamId: 't-perf', clientId: 'c-kopikita', userId: 'u-rizky', createdBy: 'u-aqeel', due: day(-4), priority: 'normal', source: 'manual', workspaceId: 'pnp', done: true, doneBy: 'u-rizky', doneAt: ago(60 * 30) }),
  {
    id: 'brief-kopikita',
    kind: 'brief',
    title: 'KopiKita Q4 "morning ritual" campaign',
    visibleToClient: true,
    context:
      'Goal: launch the Q4 campaign around the "morning ritual" angle that Nadia’s CEO loved.\n\nDeliverables: 4 concept directions, a 30s hero reel with 15s and 6s cutdowns, 4 statics.\n\nBackground: Q3 ads that showed the product in a home routine had the best ROAS (3.8). Keep the warm, slow style.\n\nReview call Thursday 2pm WIB. Assets in Drive › Clients › KopiKita › Q4.',
    clientId: 'c-kopikita',
    userId: 'u-aqeel',
    createdBy: 'u-aqeel',
    due: day(10),
    priority: 'high',
    source: 'braindump',
    workspaceId: 'pnp',
    done: false,
    status: 'doing',
    createdAt: ago(60 * 26),
  },
  task({ id: 'task-timesheets', title: 'Submit October timesheets', channelId: 'ch-general', userId: 'u-aqeel', createdBy: 'u-dewi', due: day(4), priority: 'normal', source: 'chat', workspaceId: 'pnp' }),
  task({ id: 'task-lunch', title: 'Book Friday team lunch', channelId: 'ch-general', userId: 'u-aditya', createdBy: 'u-faisal', due: day(3), priority: 'normal', source: 'chat', workspaceId: 'pnp' }),
  task({ id: 'task-wifi', title: 'Fix the office wifi password sign', channelId: 'ch-general', userId: 'u-dewi', createdBy: 'u-faisal', priority: 'normal', source: 'chat', workspaceId: 'pnp', done: true, doneBy: 'u-dewi', doneAt: ago(60 * 26) }),
  task({ title: 'Prepare growth partner proposal for Kopi Harian', teamId: 't-growth', clientId: 'c-kopiharian', userId: 'u-aqeel', createdBy: 'u-aqeel', due: day(2), priority: 'high', source: 'manual', workspaceId: 'elk' }),
  task({ title: 'Review November reorder plan', teamId: 't-growth', clientId: 'c-supplements', userId: 'u-aqeel', createdBy: 'u-dimas', due: day(4), priority: 'normal', source: 'manual', workspaceId: 'elk' }),
  task({ title: 'Launch bundle landing page', teamId: 't-web', clientId: 'c-supplements', userId: 'u-bayu', createdBy: 'u-aqeel', due: day(1), priority: 'normal', source: 'manual', workspaceId: 'elk', status: 'doing' }),
];

export const CHANNELS: Channel[] = [
  { id: 'ch-general', workspaceId: 'pnp', kind: 'channel', name: 'general', members: ['u-aqeel', 'u-faisal', 'u-aditya', 'u-rizky', 'u-dewi', 'u-nanda', 'u-sekar'], topic: 'Company-wide news and questions', category: 'team', ownerId: 'u-faisal' },
  { id: 'ch-random', workspaceId: 'pnp', kind: 'channel', name: 'random', members: ['u-aqeel', 'u-faisal', 'u-aditya', 'u-rizky', 'u-dewi', 'u-nanda', 'u-sekar'], topic: 'Lunch, memes, weekend plans', category: 'social', ownerId: 'u-aditya' },
  { id: 'ch-kopikita', workspaceId: 'pnp', kind: 'channel', name: 'kopikita', members: ['u-aqeel', 'u-rizky', 'u-dewi', 'u-nanda', 'u-sekar'], clientId: 'c-kopikita', topic: 'Q4 creative + retainer', category: 'client', ownerId: 'u-aqeel',
    summary: {
      schedule: 'monthly',
      post: false,
      history: [
        { id: 'sum-kk-sep', period: 'September 2026', at: '2026-10-01T01:00:00.000Z', auto: true, text: 'September: KopiKita signed the Q4 retainer. The team delivered the September performance recap (ROAS 3.8 on home-routine ads). Nadia joined as a guest and asked for four Q4 concept directions. Open: whether the Q4 budget is final.' },
        { id: 'sum-kk-aug', period: 'August 2026', at: '2026-09-01T01:00:00.000Z', auto: true, text: 'August: the café-shot campaign ended above target. KopiKita asked for a proposal for Q4. Invoices for July and August were paid.' },
      ],
    },
    bookmarks: [
      { id: 'bm1', title: 'Q4 brief (Google Doc)', url: 'https://docs.google.com/document/d/kopikita-q4-brief', addedBy: 'u-aqeel', at: '2026-09-28T03:00:00.000Z' },
      { id: 'bm2', title: 'KopiKita brand guidelines', url: 'https://kopikita.co.id/brand', addedBy: 'u-sekar', at: '2026-09-20T03:00:00.000Z' },
    ],
    guests: [{ email: 'nadia@kopikita.co.id', name: 'Nadia Putri', status: 'joined', invitedBy: 'u-aqeel', at: '2026-09-20T03:00:00.000Z' }] },
  { id: 'ch-lumina', workspaceId: 'pnp', kind: 'channel', name: 'lumina-skin', members: ['u-aqeel', 'u-faisal', 'u-rizky', 'u-sekar', 'u-nanda'], clientId: 'c-lumina', topic: '11.11 and 12.12 push', category: 'client', ownerId: 'u-faisal' },
  { id: 'ch-arunika', workspaceId: 'pnp', kind: 'channel', name: 'arunika-hotels', members: ['u-aqeel', 'u-aditya'], clientId: 'c-arunika', topic: 'New business', category: 'client', ownerId: 'u-aditya', private: true },
  { id: 'ch-video', workspaceId: 'pnp', kind: 'channel', name: 'video-editing', members: ['u-nanda', 'u-rizky', 'u-aqeel'], teamId: 't-video', topic: 'Edits, cuts, feedback rounds', category: 'team', ownerId: 'u-nanda' },
  { id: 'ch-design', workspaceId: 'pnp', kind: 'channel', name: 'graphic-design', members: ['u-sekar', 'u-aqeel'], teamId: 't-design', topic: 'Statics, key visuals, decks', category: 'team', ownerId: 'u-sekar' },
  { id: 'ch-q4', workspaceId: 'pnp', kind: 'channel', name: 'q4-planning', members: ['u-aqeel', 'u-faisal', 'u-aditya'], topic: 'Agency goals and hiring for Q4', category: 'project', ownerId: 'u-faisal', private: true },
  { id: 'dm-aqeel-rizky', workspaceId: 'pnp', kind: 'dm', name: '', members: ['u-aqeel', 'u-rizky'] },
  { id: 'dm-aqeel-faisal', workspaceId: 'pnp', kind: 'dm', name: '', members: ['u-aqeel', 'u-faisal'] },
  { id: 'ch-elk-general', workspaceId: 'elk', kind: 'channel', name: 'general', members: ['u-aqeel', 'u-dimas', 'u-bayu'], topic: 'Elkiya Group', category: 'team', ownerId: 'u-aqeel' },
  { id: 'ch-supplements', workspaceId: 'elk', kind: 'channel', name: 'supplements', members: ['u-aqeel', 'u-dimas', 'u-bayu'], clientId: 'c-supplements', category: 'client', ownerId: 'u-dimas' },
  { id: 'dm-aqeel-dimas', workspaceId: 'elk', kind: 'dm', name: '', members: ['u-aqeel', 'u-dimas'] },
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
  msg('ch-general', 'u-faisal', 60 * 26, 'Morning team. Big week: Lumina 11.11 prep and the KopiKita concepts are both due.', undefined, { pinned: true }),
  msg('ch-general', 'u-dewi', 60 * 27, 'Office wifi: PNP-Office / password on the fridge. Client wifi is PNP-Guest.', undefined, { pinned: true }),
  msg('ch-general', 'u-aditya', 60 * 25, 'Glowkind reached out through hello@. I’ll take the first call.'),
  msg('ch-general', 'u-dewi', 60 * 5, 'Reminder: timesheets for October by Friday please 🙏'),
  msg('ch-general', 'u-faisal', 60 * 3, 'for turning the Lumina key visual around in one day', undefined, { kind: 'kudos', kudosFor: 'u-sekar', reactions: { '🙌': ['u-aqeel', 'u-rizky', 'u-nanda'] } }),
  msg('ch-random', 'u-nanda', 60 * 30, 'Anyone else watching the F1 this weekend? 🏎️', undefined, { reactions: { '🔥': ['u-rizky', 'u-sekar'], '😂': ['u-aditya'] } }),
  msg('ch-video', 'u-nanda', 60 * 6, 'First cut of the KopiKita reel is in Drive. 32s, need to trim 2s.', undefined, { files: [{ name: 'KopiKita_morning_ritual_v1.mp4', size: 48_200_000, type: 'video/mp4' }] }),
  msg('ch-video', 'u-rizky', 60 * 5.5, 'Love the slow pour shot. Maybe open on that?', undefined, { reactions: { '👍': ['u-nanda', 'u-aqeel'] } }),
  msg('ch-design', 'u-sekar', 60 * 9, 'Moodboard for Glowkind, clean and science-y like Rina asked', undefined, { files: [{ name: 'Glowkind_moodboard.pdf', size: 6_400_000, type: 'application/pdf' }] }),
  msg('ch-q4', 'u-faisal', 60 * 28, 'Goal for Q4: 3 new retainers, hire one performance marketer.'),
  msg('ch-kopikita', 'u-aqeel', 60 * 4, 'Nadia’s CEO loved the “morning ritual” angle. Let’s make one of the four directions lean into it.', undefined, { id: 'msg-kk-root', reactions: { '🔥': ['u-rizky', 'u-sekar'], '🙌': ['u-nanda'] } }),
  { id: 'msg-kk-r1', channelId: 'ch-kopikita', userId: 'u-sekar', at: ago(60 * 3.9), text: 'Love it. I can do the statics in warm morning light, soft shadows.', parentId: 'msg-kk-root' },
  { id: 'msg-kk-r2', channelId: 'ch-kopikita', userId: 'u-nanda', at: ago(60 * 3.8), text: 'For the reel I’ll shoot the slow pour as the hero moment.', parentId: 'msg-kk-root' },
  { id: 'msg-kk-g', channelId: 'ch-kopikita', userId: 'u-aqeel', at: ago(60 * 3.7), text: 'Nadia, sharing the direction here so you can follow along 🙏', guestEmail: undefined },
  { id: 'msg-kk-n', channelId: 'ch-kopikita', userId: 'guest', guestEmail: 'nadia@kopikita.co.id', at: ago(60 * 3.2), text: 'Thanks! Our CEO is excited. Can we see a first look before Thursday?' },
  msg('ch-kopikita', 'u-rizky', 60 * 3.6, 'On it. I’ll storyboard a 30s short-form version first.', 'task-2'),
  msg('ch-kopikita', 'u-aqeel', 50, '@Rizky can you also pull last quarter’s top 3 ads for reference?'),
  msg('ch-kopikita', 'u-sekar', 40, 'Moodboard for the morning ritual statics: https://www.figma.com/file/kk-morning-ritual'),
  msg('ch-kopikita', 'u-nanda', 30, 'Reference for the slow pour, love the pacing here https://www.youtube.com/watch?v=coffee-pour-ref'),
  msg('ch-lumina', 'u-faisal', 60 * 8, 'Sarah approved scaling for 11.11. @Rizky please build the campaign structure by tomorrow.', 'task-4'),
  msg('ch-lumina', 'u-rizky', 60 * 7.5, 'Will do. Bundles + retargeting first.'),
  msg('ch-arunika', 'u-aditya', 60 * 30, 'Proposal went out yesterday. No reply yet.'),
  msg('dm-aqeel-rizky', 'u-rizky', 35, 'Hey, quick one: do we keep Thursday 2pm for the KopiKita review?'),
  msg('dm-aqeel-rizky', 'u-rizky', 33, '', undefined, { voice: { seconds: 14, transcript: 'Also, Nadia asked if we can send a first look before Thursday. I think Nanda’s cut is close, can I share it?' } }),
  msg('dm-aqeel-faisal', 'u-faisal', 60 * 20, 'Can you look at the shortlist before Friday?', 'task-9'),
  msg('ch-elk-general', 'u-bayu', 60 * 6, 'DNS for elkiyagroup.com is ready whenever you are.'),
  msg('ch-supplements', 'u-dimas', 60 * 2, 'October closed at 1,240 orders, +18% MoM. Reorder plan is in Drive.'),
];

const sec = (m: number, s = 0) => (m * 60 + s) * 1000;
const tx = (lines: [number, number, string, string][]) => lines.map(([m, s2, speaker, text]) => ({ at: sec(m, s2), speaker, text }));
const log = (minutesAgo: number, ...msgs: string[]) => msgs.map((message, i) => ({ message, at: ago(minutesAgo - i * 0.3) }));

export const MEETINGS: Meeting[] = [
  {
    id: 'mt-kopikita',
    workspaceId: 'pnp',
    title: 'KopiKita weekly sync',
    at: ago(60 * 22),
    minutes: 34,
    clientId: 'c-kopikita',
    filedBy: 'rule',
    sharedWithClient: true,
    status: 'done',
    platform: 'meet',
    url: 'https://meet.google.com/kpk-wkly-syn',
    type: 'client',
    tags: ['q4', 'creative', 'video'],
    attendees: ['Aqeel', 'Rizky', 'Nadia Putri'],
    summary: 'Nadia’s CEO wants one of the four Q4 directions to lean into the “morning ritual” angle. Short-form video comes first, statics second. The review call moves to Thursday 2pm WIB.',
    keyPoints: ['The CEO loved the “morning ritual” angle from the first round', 'Short-form video is the priority for Q4, statics come after', 'Last quarter’s home-routine ads had the best ROAS (3.8)'],
    decisions: ['One of the four directions will be built around the morning ritual', 'Review call moves to Thursday 2pm WIB'],
    openQuestions: ['Can KopiKita share raw footage from their own shoot?', 'Is the Q4 budget final or still with finance?'],
    topics: [
      { name: 'First round feedback', at: sec(0, 40) },
      { name: 'Morning ritual angle', at: sec(6, 10) },
      { name: 'Video before statics', at: sec(14, 30) },
      { name: 'Timeline and review call', at: sec(26, 5) },
    ],
    transcript: tx([
      [0, 12, 'Aqeel', 'Morning Nadia, thanks for making time. Shall we start with the feedback on the four directions?'],
      [0, 40, 'Nadia Putri', 'Yes. Honestly our CEO loved one thing most, the morning ritual idea.'],
      [1, 5, 'Nadia Putri', 'The slow pour, the steam, someone starting their day. That felt like KopiKita.'],
      [6, 10, 'Aqeel', 'Great. Then let’s make one of the four directions lean fully into the morning ritual.'],
      [6, 42, 'Rizky', 'That fits the data too. The home-routine ads last quarter had our best ROAS, about 3.8.'],
      [9, 30, 'Nadia Putri', 'Could you also share last quarter’s top three ads? I want to show the CEO why.'],
      [9, 51, 'Rizky', 'Sure, I’ll pull those together for you.'],
      [14, 30, 'Aqeel', 'For production, we’d do short-form video first and the statics second.'],
      [15, 2, 'Nadia Putri', 'Agreed. TikTok and Reels matter most for us in Q4.'],
      [18, 20, 'Rizky', 'I’ll storyboard a thirty-second version of the morning ritual by Thursday.'],
      [22, 48, 'Nadia Putri', 'Can we get raw footage from our own shoot into this? We have some nice café shots.'],
      [23, 15, 'Aqeel', 'Yes please, send it over and we’ll see what fits.'],
      [26, 5, 'Aqeel', 'Let’s move the review call to Thursday at 2pm Jakarta time. Does that work?'],
      [26, 20, 'Nadia Putri', 'Thursday 2pm works.'],
      [33, 40, 'Aqeel', 'Perfect, thanks everyone. Notes and tasks will be in Sprint2go.'],
    ]),
    log: log(60 * 22 + 36, 'Sent from Google Calendar: KopiKita weekly sync', 'Joining Google Meet as “P&P Notetaker”', 'Waiting to be let in', 'Let in by Aqeel', 'Recording', 'Everyone else left', 'Writing notes with DeepSeek V4 Pro (SumoPod)', 'Filed in KopiKita by rule: domain kopikita.co.id', 'Done'),
    actions: [
      { title: 'Storyboard the "morning ritual" short-form video', owner: 'Rizky', due: 'Thu', taskId: 'task-2', saidAt: sec(18, 20) },
      { title: 'Move the review call to Thursday 2pm WIB', owner: 'Aqeel', due: 'Thu', saidAt: sec(26, 5) },
      { title: 'Share last quarter’s top 3 ads with Nadia', owner: 'Rizky', saidAt: sec(9, 51) },
    ],
    recording: { keep: 'video', sizeMb: 620 },
    share: { token: 'kp7Qw2', transcript: true, video: false },
    access: { watch: 'everyone', download: false, transcript: 'everyone' },
    createdBy: 'u-aqeel',
  },
  {
    id: 'mt-lumina',
    workspaceId: 'pnp',
    title: 'Lumina Skin monthly review',
    at: ago(60 * 50),
    minutes: 47,
    clientId: 'c-lumina',
    filedBy: 'ai',
    status: 'done',
    platform: 'zoom',
    url: 'https://zoom.us/j/9384110223',
    type: 'client',
    tags: ['performance', '11.11', 'budget'],
    attendees: ['Faisal', 'Aqeel', 'Rizky', 'Sarah Lim'],
    summary: 'Blended ROAS rose to 4.1 from 3.2 and new-customer revenue grew 38%. Sarah approved scaling for 11.11 and wants 12.12 budget scenarios next week.',
    keyPoints: ['Blended ROAS 4.1, up from 3.2', 'New-customer revenue up 38%', 'Bundles drove most of the growth'],
    decisions: ['Scale spend for 11.11', 'Prepare three 12.12 budget scenarios'],
    openQuestions: ['Will Lumina restock the bundle SKUs in time for 12.12?'],
    topics: [
      { name: 'September results', at: sec(1, 0) },
      { name: '11.11 plan', at: sec(18, 0) },
      { name: '12.12 budget', at: sec(36, 0) },
    ],
    transcript: tx([
      [1, 0, 'Faisal', 'Let’s start with September. Blended ROAS came in at 4.1, up from 3.2.'],
      [2, 30, 'Sarah Lim', 'That’s great. And new customers?'],
      [2, 45, 'Faisal', 'New-customer revenue grew 38 percent, mostly from the bundles.'],
      [18, 0, 'Rizky', 'For 11.11 I’d build the campaign structure around bundles plus retargeting.'],
      [19, 20, 'Sarah Lim', 'Approved. Please scale for 11.11.'],
      [36, 0, 'Sarah Lim', 'For 12.12, can you send me budget scenarios next week?'],
      [36, 30, 'Faisal', 'Yes, I’ll prepare three scenarios.'],
    ]),
    log: log(60 * 50 + 49, 'Joining Zoom as “P&P Notetaker”', 'Recording', 'Writing notes', 'Filed in Lumina Skin by AI', 'Done'),
    actions: [
      { title: 'Build 11.11 campaign structure in Meta', owner: 'Rizky', due: 'Tomorrow', taskId: 'task-4', saidAt: sec(18, 0) },
      { title: 'Prepare 12.12 budget scenarios', owner: 'Faisal', due: 'Next week', taskId: 'task-5', saidAt: sec(36, 30) },
    ],
    recording: { keep: 'audio', sizeMb: 38 },
    access: { watch: 'attendees', download: false, transcript: 'everyone' },
    createdBy: 'u-faisal',
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
    attendees: ['Aqeel', 'Faisal', 'Rizky', 'Nanda', 'Sekar'],
    summary: 'Nanda is cutting the KopiKita reel; Sekar is on the Glowkind moodboard and four Q4 statics; Rizky flagged the Lumina carousel has no owner yet.',
    keyPoints: ['KopiKita reel first cut is 32s, needs trimming', 'Glowkind moodboard shared in #graphic-design', 'Lumina retargeting carousel needs a designer'],
    decisions: [],
    openQuestions: ['Who takes the Lumina carousel?'],
    topics: [{ name: 'Round the table', at: sec(0, 30) }],
    transcript: tx([
      [0, 30, 'Nanda', 'Reel first cut is in Drive, 32 seconds, I need to trim two.'],
      [3, 10, 'Sekar', 'Glowkind moodboard is shared. Starting the Q4 statics today.'],
      [6, 40, 'Rizky', 'The Lumina retargeting carousel still has no designer on it.'],
    ]),
    log: log(60 * 5 + 15, 'Recording', 'Writing notes', 'Kept notes and transcript only (internal meeting)', 'Done'),
    actions: [{ title: 'Pick a designer for the Lumina carousel', owner: 'Faisal', saidAt: sec(6, 40) }],
    recording: { keep: 'notes', sizeMb: 0.4 },
    createdBy: 'u-faisal',
  },
  {
    id: 'mt-glowkind',
    workspaceId: 'pnp',
    title: 'Glowkind discovery call',
    at: ago(12),
    minutes: 12,
    clientId: 'c-glowkind',
    filedBy: 'rule',
    status: 'recording',
    platform: 'meet',
    url: 'https://meet.google.com/glw-disc-ovr',
    type: 'sales',
    attendees: ['Aditya', 'Rina'],
    summary: '',
    transcript: tx([
      [0, 20, 'Aditya', 'Hi Rina, thanks for jumping on. Tell me about the launch.'],
      [0, 55, 'Rina', 'We launch our serum line in November. We want 500 pre-orders before 11.11.'],
      [2, 10, 'Aditya', 'And how do you want it to feel?'],
      [2, 30, 'Rina', 'Clean, science-y, but warm. Not cold clinical.'],
    ]),
    log: log(13, 'Sent from Google Calendar: Glowkind discovery call', 'Joining Google Meet as “P&P Notetaker”', 'Let in by Aditya', 'Recording'),
    actions: [],
    createdBy: 'u-aditya',
  },
  {
    id: 'mt-arunika',
    workspaceId: 'pnp',
    title: 'Arunika Hotels intro',
    at: ago(60 * 27),
    minutes: 0,
    clientId: 'c-arunika',
    filedBy: 'user',
    status: 'failed',
    error: 'Nobody let the bot in',
    platform: 'zoom',
    url: 'https://zoom.us/j/5521093384',
    attendees: ['Aditya', 'Dimas'],
    summary: '',
    log: log(60 * 27 + 11, 'Joining Zoom as “P&P Notetaker”', 'Waiting to be let in', 'Nobody let the bot in after 10 minutes'),
    actions: [],
    createdBy: 'u-aditya',
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
    attendees: ['Aqeel', 'Dimas', 'Bayu'],
    summary: 'October beat target. The bundle launch lifted repeat rate. The new landing page goes live this week.',
    keyPoints: ['October closed at 1,240 orders, +18% month on month', 'Bundles lifted the repeat rate'],
    decisions: ['Launch the bundle landing page this week'],
    openQuestions: [],
    transcript: tx([[1, 0, 'Dimas', 'October closed at 1,240 orders, up 18 percent.'], [5, 0, 'Bayu', 'The bundle landing page goes live this week.']]),
    log: log(60 * 28 + 26, 'Recording', 'Writing notes', 'Done'),
    actions: [
      { title: 'Launch bundle landing page', owner: 'Bayu', taskId: 'task-12', saidAt: sec(5, 0) },
      { title: 'Review November reorder plan', owner: 'Aqeel', taskId: 'task-11' },
    ],
    recording: { keep: 'video', sizeMb: 470 },
    createdBy: 'u-aqeel',
  },
];

/** Lines the demo bot "hears" when you send it to a new meeting (the real bot reads the meeting's captions). */
export const DEMO_SCRIPT: { speaker: string; text: string }[] = [
  { speaker: 'You', text: 'Thanks for joining. Quick agenda: results, next campaign, and who does what.' },
  { speaker: 'Client', text: 'Sounds good. Results first, please.' },
  { speaker: 'You', text: 'Orders are up 22 percent and cost per order is down a little.' },
  { speaker: 'Client', text: 'Great. For the next campaign we want more video.' },
  { speaker: 'You', text: 'Then let’s plan three short videos. Nanda can edit them by next Friday.' },
  { speaker: 'Client', text: 'Can you also send a proposal with the budget?' },
  { speaker: 'You', text: 'Yes, I’ll send the proposal by Wednesday.' },
  { speaker: 'Client', text: 'Perfect, talk soon.' },
];

export const NOTICES: Notice[] = [
  { id: 'nt-1', userId: 'u-aqeel', workspaceId: 'pnp', kind: 'task', text: 'Faisal assigned you “Shortlist top 3 performance marketer candidates”', at: ago(60 * 20), read: false, link: { app: 'tasks', id: 'task-9' } },
  { id: 'nt-2', userId: 'u-aqeel', workspaceId: 'pnp', kind: 'meeting', text: 'Notes are ready for “KopiKita weekly sync” · 3 action items', at: ago(60 * 21), read: false, link: { app: 'meet', id: 'mt-kopikita' } },
  { id: 'nt-3', userId: 'u-aqeel', workspaceId: 'pnp', kind: 'mention', text: 'Rizky messaged you: “do we keep Thursday 2pm for the KopiKita review?”', at: ago(35), read: false, link: { app: 'chat', id: 'dm-aqeel-rizky' } },
  { id: 'nt-4', userId: 'u-rizky', workspaceId: 'pnp', kind: 'mention', text: 'Aqeel mentioned you in #kopikita', at: ago(50), read: false, link: { app: 'chat', id: 'ch-kopikita' } },
  { id: 'nt-5', userId: 'u-rizky', workspaceId: 'pnp', kind: 'task', text: 'Faisal assigned you “Build 11.11 campaign structure in Meta”', at: ago(60 * 8), read: false, link: { app: 'tasks', id: 'task-4' } },
  { id: 'nt-6', userId: 'u-aqeel', workspaceId: 'elk', kind: 'task', text: 'Dimas assigned you “Review November reorder plan”', at: ago(60 * 2), read: false, link: { app: 'tasks', id: 'task-11' } },
];

// Tasks that came from a meeting remember which one, and the moment they were said.
for (const m of MEETINGS)
  for (const a of m.actions) {
    const t = a.taskId ? TASKS.find((x) => x.id === a.taskId) : undefined;
    if (t) Object.assign(t, { meetingId: m.id, saidAt: a.saidAt });
  }

// Everyone on a task: who does it, who supervises (whoever assigned it), and a history that starts at creation.
const SRC_WORD: Record<Todo['source'], string> = { ai: 'from an email', manual: '', braindump: 'from a brain dump', chat: 'from chat', meeting: 'from a meeting' };
for (const t of TASKS) {
  t.assignees = t.userId ? [t.userId] : [];
  t.supervisorId = t.createdBy;
  t.history = [{ id: `${t.id}-c`, at: t.createdAt, by: t.createdBy ?? t.userId, kind: 'created', text: `created this ${SRC_WORD[t.source]}`.trim() }];
}
const T = (id: string) => TASKS.find((t) => t.id === id)!;
// Two people on the reel, with a conversation in its history.
Object.assign(T('task-reel'), { assignees: ['u-nanda', 'u-rizky'], followers: ['u-sekar'] });
T('task-reel').history!.push(
  { id: 'h-r1', at: ago(60 * 5), by: 'u-aqeel', kind: 'assigned', text: 'added Rizky to help with the cutdowns' },
  { id: 'h-r2', at: ago(60 * 4), by: 'u-nanda', kind: 'comment', text: 'First cut is 32s. Trimming 2s today, can you check the pour shot @Aqeel?' },
  { id: 'h-r3', at: ago(60 * 3), by: 'u-aqeel', kind: 'comment', text: 'Pour shot is perfect. Open on it.' },
);
// Sekar finished the Arunika deck; Design has the review step on, so it waits for Aditya.
Object.assign(T('task-deck'), { status: 'review' });
T('task-deck').history!.push({ id: 'h-d1', at: ago(60 * 2), by: 'u-sekar', kind: 'review', text: 'finished it and sent it for review' });
// Glowkind call: the ball is in the client's court.
Object.assign(T('task-8'), { status: 'waiting' });
T('task-8').history!.push({ id: 'h-g1', at: ago(60 * 6), by: 'u-aditya', kind: 'status', text: 'set it to Waiting on client: Rina is picking a time' });
