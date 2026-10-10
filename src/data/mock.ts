import type { Label, Person, Thread } from '../types';
import type { MailFilterRule, MailLabel } from '../mailFilterMatch';
import { nextWeekday } from './calendar';
import { DEFAULT_TRACK_OPTIONS as OPTS } from '../tracking';

// Sample mailbox. This gets replaced by a real JMAP connection to Stalwart later.

export const ME: Person = { name: 'Raka', email: 'raka@demo.sprint2go.com' };

export const LABELS: Label[] = [
  { id: 'lb-clients', name: 'Clients', color: '#10b981' },
  { id: 'lb-team', name: 'Team', color: '#5b5bf6' },
  { id: 'lb-infra', name: 'Infra', color: '#f59e0b' },
  { id: 'lb-finance', name: 'Finance', color: '#ef4444' },
];

/** The demo company's labels (src/mailFilterMatch.ts): the four above as company labels, one nested, one of Raka's own. */
export const DEMO_MAIL_LABELS: MailLabel[] = [
  ...LABELS.map((l, i) => ({ id: l.id, workspaceId: 'pnp', accountId: null, name: l.name, parentId: null, color: l.color, show: 'show' as const, order: i })),
  { id: 'lb-kopinara', workspaceId: 'pnp', accountId: null, name: 'Kopinara', parentId: 'lb-clients', color: '#10b981', show: 'show', order: 0 },
  { id: 'lb-receipts', workspaceId: 'pnp', accountId: 'pnp-raka', name: 'Receipts', parentId: null, color: '#64748b', show: 'unread', order: 10 },
];
/** And two filters, so the Filters screen shows what they look like. */
export const DEMO_MAIL_FILTERS: MailFilterRule[] = [
  { id: 'flt-infra', workspaceId: 'pnp', accountId: 'pnp-raka', name: 'Server alerts', enabled: true, order: 0, criteria: { from: '@dokploy.com, @contabo.com' }, actions: { labels: ['lb-infra'] }, createdBy: 'u-raka', hits: 0 },
  { id: 'flt-receipts', workspaceId: 'pnp', accountId: 'pnp-raka', name: 'Receipts', enabled: true, order: 1, criteria: { hasWords: 'invoice OR receipt', hasAttachment: true }, actions: { labels: ['lb-receipts'], archive: true }, createdBy: 'u-raka', hits: 0 },
];

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const p = (name: string, email: string): Person => ({ name, email });

const hendra = p('Hendra Wijaya', 'hendra@demo.sprint2go.com');
const sofia = p('Sofia Ramadhani', 'sofia@demo.sprint2go.com');
const laras = p('Laras Anindita', 'laras@kopinara.example');
const dokploy = p('Dokploy', 'notifications@dokploy.com');
const contabo = p('Contabo Billing', 'billing@contabo.com');
const aws = p('Amazon Web Services', 'no-reply@aws.amazon.com');
const bima = p('Bima Anggara', 'bima@demo.sprint2go.com');
const hannah = p('Hannah Koh', 'hannah@selaraskin.example');
const github = p('GitHub', 'noreply@github.com');
const figma = p('Figma Billing', 'billing@figma.com');
const yusuf = p('Arif Nugroho', 'yusuf@teduhhotels.example');
const maya = p('Maya Santoso', 'maya@studiolokal.example');

export const THREADS: Thread[] = [
  {
    id: 't1',
    accountId: 'pnp-raka',
    subject: 'Q4 creative direction: first round of concepts',
    location: 'inbox',
    starred: true,
    unread: true,
    labels: ['lb-clients'],
    invite: {
      title: 'Kopinara Q4 concepts review',
      start: nextWeekday(4, 14),
      end: nextWeekday(4, 15),
      location: 'Google Meet',
    },
    messages: [
      {
        id: 'm1a',
        from: laras,
        to: [ME],
        date: ago(240),
        body: `Hi Raka,\n\nThanks for the kickoff call last week. As promised, I've attached our brand guidelines and last quarter's top performing ads so the team has something to react against.\n\nWe'd love to see 3–4 directions before the 10th if possible.\n\nLaras`,
        attachments: [{ name: 'Kopinara-brand-guide.pdf', size: '4.2 MB' }],
      },
      {
        id: 'm1b',
        from: ME,
        to: [laras],
        date: ago(180),
        body: `Hi Laras,\n\nGot it, thank you. We'll have four directions over to you by Wednesday.\n\nRaka`,
        trackOptions: OPTS,
        tracking: {
          [laras.email]: {
            opens: [
              { at: ago(176), device: 'iPhone · Gmail', place: 'Jakarta, ID' },
              { at: ago(95), device: 'Mac · Chrome', place: 'Jakarta, ID' },
              { at: ago(20), device: 'iPhone · Gmail', place: 'Jakarta, ID' },
            ],
            clicks: [],
          },
        },
      },
      {
        id: 'm1c',
        from: laras,
        to: [ME],
        date: ago(12),
        body: `Amazing, thank you!\n\nOne more thing: our CEO really liked the "morning ritual" angle from the pitch deck. Could one of the four lean into that? Short-form video first, statics second.\n\nAlso, can we push the review call to Thursday 2pm WIB? Wednesday got busy on our side.\n\nLaras`,
      },
    ],
  },
  {
    id: 't-invite',
    accountId: 'pnp-raka',
    subject: 'Invitation: Selara launch check-in',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['lb-clients'],
    messages: [
      {
        id: 'm-invite',
        from: p('Hannah Koh', 'hannah@selaraskin.example'),
        to: [ME],
        date: ago(55),
        body: `Hannah Koh has invited you to Selara launch check-in.\n\nA quick check on the launch ads before they go live: what's approved, what's still waiting.\n\nJoin with Google Meet: https://meet.google.com/lum-ainv-kin`,
        attachments: [{ name: 'invite.ics', size: '2 KB' }],
        invite: {
          method: 'REQUEST',
          uid: 'selara-launch-checkin@google.com',
          sequence: 0,
          title: 'Selara launch check-in',
          start: nextWeekday(3, 15),
          end: new Date(Date.parse(nextWeekday(3, 15)) + 30 * 60_000).toISOString(),
          tz: 'Asia/Singapore',
          url: 'https://meet.google.com/lum-ainv-kin',
          description: 'A quick check on the launch ads before they go live: what’s approved, what’s still waiting.',
          organizer: hannah,
          attendees: [
            { ...hannah, status: 'accepted' },
            { ...ME, email: 'raka@demo.sprint2go.com', status: 'needs-action' },
            { ...hendra, status: 'tentative' },
          ],
          you: 'raka@demo.sprint2go.com',
        },
      },
    ],
  },
  {
    id: 't2',
    accountId: 'pnp-raka',
    subject: 'Deployment succeeded: website (staging)',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['lb-infra'],
    messages: [
      {
        id: 'm2',
        from: dokploy,
        to: [ME],
        date: ago(38),
        body: `Your application "Website (staging)" was deployed successfully.\n\nProject: sprint2go Studio website\nEnvironment: staging\nBuild time: 1m 42s\nDomain: https://staging.demo.sprint2go.com\n\n— Dokploy`,
      },
    ],
  },
  {
    id: 't3',
    accountId: 'pnp-raka',
    subject: 'Hiring: shortlist for the performance marketer role',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['lb-team'],
    messages: [
      {
        id: 'm3',
        from: hendra,
        to: [ME, sofia],
        date: ago(95),
        body: `Team,\n\nI've gone through the 23 applications. Five stand out, see the attached sheet with my notes.\n\nCan we each pick our top 3 by Friday? I'd like to start first interviews next week.\n\nHendra`,
        attachments: [{ name: 'shortlist-perf-marketer.xlsx', size: '38 KB' }],
      },
    ],
  },
  {
    id: 't4',
    accountId: 'pnp-raka',
    subject: 'Your SES account is now out of the sandbox',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['lb-infra'],
    messages: [
      {
        id: 'm4',
        from: aws,
        to: [ME],
        date: ago(300),
        body: `Hello,\n\nThank you for submitting your request to increase your sending limits. Your new sending quota is 50,000 messages per day. Your maximum send rate is now 14 messages per second.\n\nYou can now send email to any recipient, whether or not the address or domain is verified.\n\nAmazon Web Services`,
      },
    ],
  },
  {
    id: 't5',
    accountId: 'pnp-raka',
    subject: 'Re: Selara Skin September results',
    location: 'inbox',
    starred: true,
    unread: false,
    labels: ['lb-clients'],
    messages: [
      {
        id: 'm5a',
        from: ME,
        to: [hannah],
        date: ago(60 * 26),
        body: `Hi Hannah,\n\nSeptember report attached. Headline: blended ROAS up to 4.1 from 3.2, with new-customer revenue up 38%.\n\nThe live dashboard is here: Selara performance dashboard\n\nHappy to walk through it on a call.\n\nRaka`,
        html: `<p>Hi Hannah,</p><p>September report attached. Headline: <b>blended ROAS up to 4.1 from 3.2</b>, with new-customer revenue up 38%.</p><p>The live dashboard is here: <a href="https://dash.demo.sprint2go.com/selara">Selara performance dashboard</a></p><p>Happy to walk through it on a call.</p><p>Raka</p>`,
        attachments: [{ name: 'Selara-Sep-2026-report.pdf', size: '1.1 MB' }],
        trackOptions: OPTS,
        tracking: {
          [hannah.email]: {
            opens: [
              { at: ago(60 * 25.8), device: 'Mac · Apple Mail', place: 'Singapore, SG', auto: 'apple' },
              { at: ago(60 * 22), device: 'Mac · Outlook', place: 'Singapore, SG' },
              { at: ago(60 * 21.5), device: 'Mac · Outlook', place: 'Singapore, SG' },
              { at: ago(60 * 20.2), device: 'iPhone · Outlook', place: 'Singapore, SG' },
              { at: ago(60 * 3), device: 'Windows · Outlook', place: 'Kuala Lumpur, MY' },
            ],
            docs: [
              { at: ago(60 * 21.3), file: 'Selara-Sep-2026-report.pdf', seconds: 252, pages: '8 of 8' },
              { at: ago(60 * 2.8), file: 'Selara-Sep-2026-report.pdf', seconds: 95, pages: '3 of 8' },
            ],
            clicks: [
              { at: ago(60 * 21.4), label: 'Selara performance dashboard', url: 'https://dash.demo.sprint2go.com/selara' },
              { at: ago(60 * 2.9), label: 'Selara performance dashboard', url: 'https://dash.demo.sprint2go.com/selara' },
            ],
          },
        },
      },
      {
        id: 'm5b',
        from: hannah,
        to: [ME],
        date: ago(60 * 20),
        body: `This is brilliant, the team is thrilled. Let's talk about scaling budget for 11.11 and 12.12. Does Monday work?\n\nHannah`,
      },
    ],
  },
  {
    id: 't6',
    accountId: 'pnp-raka',
    subject: 'Invoice #CT-2026-09-81442 is available',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['lb-finance'],
    messages: [
      {
        id: 'm6',
        from: contabo,
        to: [ME],
        date: ago(60 * 30),
        trackersBlocked: 1,
        body: `Dear customer,\n\nyour invoice for Cloud VPS 3 (October 2026) is now available in the customer control panel.\n\nAmount: EUR 14.99\nDue: 10 October 2026\n\nKind regards,\nContabo`,
        attachments: [{ name: 'invoice-CT-2026-09-81442.pdf', size: '92 KB' }],
      },
    ],
  },
  {
    id: 't7',
    accountId: 'pnp-raka',
    subject: 'Lunch Friday? 🍜',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['lb-team'],
    messages: [
      {
        id: 'm7',
        from: bima,
        to: [ME],
        date: ago(60 * 47),
        body: `Bakmi place near the office reopened. Friday 12:30? I'll book for 6.`,
      },
    ],
  },
  {
    id: 't8',
    accountId: 'pnp-raka',
    subject: '[pixel-and-profits] PR #42: Results slider on mobile',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'm8',
        from: github,
        to: [ME],
        date: ago(60 * 52),
        body: `bima-p requested your review on #42.\n\nReplaces the 2-column brand picker with a horizontal slider so the full case fits in one screen on mobile.\n\n3 files changed, +214 −131`,
      },
    ],
  },
  {
    id: 't9',
    accountId: 'pnp-raka',
    subject: 'Your team plan renews in 7 days',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['lb-finance'],
    messages: [
      {
        id: 'm9',
        from: figma,
        to: [ME],
        date: ago(60 * 24 * 4),
        trackersBlocked: 3,
        listUnsubscribe: { url: 'https://figma.com/unsubscribe/abc', oneClick: true },
        body: `Hi Raka,\n\nJust a heads-up that your Figma Professional plan (3 seats) renews on 9 October.\n\nNo action is needed if you'd like to continue.\n\nDina`,
      },
    ],
  },
  {
    id: 't13',
    accountId: 'pnp-raka',
    subject: 'Proposal: Q1 performance retainer',
    location: 'archive',
    starred: false,
    unread: false,
    labels: ['lb-clients'],
    messages: [
      {
        id: 'm13',
        from: ME,
        to: [yusuf],
        date: ago(60 * 28),
        body: `Hi Yusuf,\n\nGreat meeting you at the hospitality summit. As promised, here's our proposal for a Q1 performance retainer: paid social plus search, with weekly creative testing.\n\nHappy to adjust scope to your budget.\n\nRaka`,
        attachments: [{ name: 'Teduh-Q1-proposal.pdf', size: '2.8 MB' }],
        trackOptions: OPTS,
        tracking: { [yusuf.email]: { opens: [], clicks: [] } },
      },
    ],
  },
  {
    id: 't14',
    accountId: 'pnp-raka',
    subject: 'Collab idea: content day at your studio?',
    location: 'archive',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'm14',
        from: ME,
        to: [maya],
        date: ago(60 * 6),
        body: `Hi Maya,\n\nLove what Studio Lokal is doing. Would you be open to a joint content day at your space next month? We'd bring two brands and a small crew.\n\nRaka`,
        trackOptions: OPTS,
        tracking: {
          [maya.email]: { opens: [{ at: ago(60 * 6 - 1), device: 'iPhone · Apple Mail', auto: 'apple' }], clicks: [] },
        },
      },
    ],
  },
  {
    id: 't10',
    accountId: 'pnp-raka',
    subject: 'Brand workshop notes',
    location: 'archive',
    starred: false,
    unread: false,
    labels: ['lb-team'],
    messages: [
      {
        id: 'm10',
        from: sofia,
        to: [ME, hendra],
        date: ago(60 * 24 * 9),
        body: `Notes from Tuesday are in the shared drive. Key decision: keep the sage + coral palette, retire the gradient.\n\nSofia`,
      },
    ],
  },
  {
    id: 't11',
    accountId: 'pnp-raka',
    subject: 'Proposal draft: Kopinara retainer',
    location: 'drafts',
    starred: false,
    unread: false,
    labels: ['lb-clients'],
    messages: [
      {
        id: 'm11',
        from: ME,
        to: [laras],
        date: ago(60 * 5),
        body: `Hi Laras,\n\nFollowing our call, here's how we'd structure the retainer for Q4:\n\n`,
      },
    ],
  },
  {
    id: 't12',
    accountId: 'pnp-raka',
    subject: 'You have WON $5,000,000!!! Claim now',
    location: 'spam',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'm12',
        from: p('Prize Department', 'winner@claim-prize-now.example'),
        to: [ME],
        date: ago(60 * 7),
        body: `Congratulations!! Send your bank details to claim.`,
        trackersBlocked: 5,
      },
    ],
  },

  // Shared team inbox: hello@demo.sprint2go.com
  {
    id: 'h1',
    accountId: 'pnp-hello',
    assignee: 'u-sofia',
    notes: [{ id: 'n1', by: 'u-sofia', text: 'I’ll take this one. Brightleaf looks like a good fit for our skincare work.', at: new Date(Date.now() - 50 * 60_000).toISOString() }],
    subject: 'Enquiry: paid social for a new skincare brand',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['lb-clients'],
    messages: [
      {
        id: 'mh1',
        from: p('Nina Kurnia', 'nina@brightleaf.example'),
        to: [p('sprint2go Studio', 'hello@demo.sprint2go.com')],
        date: ago(55),
        body: `Hello,\n\nWe're launching a skincare line in January and are looking for an agency to run Meta and TikTok ads. Budget around IDR 150m per month to start.\n\nCould we book a call next week?\n\nNina`,
      },
    ],
  },
  {
    id: 'h2',
    accountId: 'pnp-hello',
    subject: 'Partnership: creator network in SEA',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'mh2',
        from: p('Kevin Tan', 'kevin@creatorloop.example'),
        to: [p('sprint2go Studio', 'hello@demo.sprint2go.com')],
        date: ago(60 * 30),
        body: `Hi team,\n\nWe manage 400+ creators across ID, MY and PH. Open to a referral partnership for UGC production?\n\nKevin`,
      },
    ],
  },
  // Rimba Group workspace
  {
    id: 'e1',
    accountId: 'elk-raka',
    subject: 'October board pack',
    location: 'inbox',
    starred: true,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'me1',
        from: p('Hana Rimba', 'hana@rimbagroup.example'),
        to: [p('Raka', 'raka@rimbagroup.example')],
        date: ago(80),
        body: `Hi Raka,\n\nAttached is the October board pack. Please review the portfolio section before Thursday.\n\nHana`,
        attachments: [{ name: 'Rimba-board-pack-Oct.pdf', size: '3.4 MB' }],
      },
    ],
  },
  {
    id: 'e2',
    accountId: 'elk-raka',
    subject: 'Website launch checklist',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'me2',
        from: p('Tomas Reyes', 'tomas@rimbagroup.example'),
        to: [p('Raka', 'raka@rimbagroup.example')],
        date: ago(60 * 5),
        body: `DNS is ready on our side. Once you give the go-ahead we'll point rimbagroup.example to the new server.\n\nTomas`,
      },
    ],
  },
  {
    id: 'e3',
    accountId: 'elk-raka',
    subject: 'Thanks for the Q3 investor update',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'me3',
        from: p('Daniel Lee', 'daniel@harbourcap.example'),
        to: [p('Raka', 'raka@rimbagroup.example')],
        date: ago(60 * 50),
        body: `Thanks for the clear update, Raka. Looking forward to the Q4 numbers.\n\nDaniel`,
      },
    ],
  },

  // Bima's own mailbox
  {
    id: 'r1',
    accountId: 'pnp-bima',
    subject: 'Ad account access for Selara',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['lb-clients'],
    messages: [
      {
        id: 'mr1',
        from: hendra,
        to: [bima],
        date: ago(42),
        body: `Hi Bima,\n\nHannah granted us admin on Selara's Meta ad account. Can you set up the 11.11 campaign structure by Wednesday?\n\nHendra`,
      },
    ],
  },
  {
    id: 'r2',
    accountId: 'pnp-bima',
    subject: 'Creative feedback, round 2',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'mr2',
        from: laras,
        to: [bima],
        date: ago(60 * 20),
        body: `Hi Bima,\n\nVersions B and D are our favourites. Could we try D with a warmer colour grade?\n\nLaras`,
      },
    ],
  },

  // Newsletters & promotions (for unsubscribe / block)
  {
    id: 'n1',
    accountId: 'pnp-raka',
    subject: 'Growth Digest #212: 9 creative-testing frameworks',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'mn1',
        from: p('Growth Digest', 'news@growthdigest.example'),
        to: [ME],
        date: ago(60 * 3),
        trackersBlocked: 4,
        listUnsubscribe: { url: 'https://growthdigest.example/u/3f9a', oneClick: true },
        body: `This week: nine creative-testing frameworks the best DTC brands use, plus a teardown of a 7-figure UGC funnel.\n\nRead online · Manage preferences`,
      },
    ],
  },
  {
    id: 'n2',
    accountId: 'pnp-raka',
    subject: '⚡ FLASH SALE: 70% off everything, 6 hours only',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'mn2',
        from: p('ShopMart Deals', 'deals@shopmart.example'),
        to: [ME],
        date: ago(60 * 9),
        trackersBlocked: 6,
        listUnsubscribe: { url: 'https://shopmart.example/unsub?id=88', oneClick: false },
        body: `Don't miss out! Everything 70% off for the next 6 hours. Shop now before it's gone!`,
      },
    ],
  },
  {
    id: 'n3',
    accountId: 'pnp-raka',
    subject: 'Your cart misses you 🛒',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'mn3',
        from: p('ShopMart Deals', 'promo@shopmart.example'),
        to: [ME],
        date: ago(60 * 30),
        trackersBlocked: 5,
        listUnsubscribe: { url: 'https://shopmart.example/unsub?id=88', oneClick: false },
        body: `You left something behind! Complete your order today and get free shipping.`,
      },
    ],
  },

  // Rimba Group — more mail
  {
    id: 'e4',
    accountId: 'elk-connect',
    subject: 'Founder intro: subscription coffee brand looking for a growth partner',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'me4',
        from: p('Kirana Utami', 'kirana@lerengcoffee.example'),
        to: [p('Rimba Group', 'connect@rimbagroup.example')],
        date: ago(35),
        body: `Hi Rimba team,\n\nWe run a subscription coffee brand doing about IDR 900m a month, profitable, but growth has stalled. We're looking for a partner who can help us grow rather than just an agency.\n\nCould we set up a call on Tuesday 10am?\n\nKirana`,
      },
    ],
  },
  {
    id: 'e5',
    accountId: 'elk-raka',
    subject: 'Supplements brand: October numbers',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'me5',
        from: p('Yusuf Halim', 'yusuf@rimbagroup.example'),
        to: [p('Raka', 'raka@rimbagroup.example')],
        date: ago(60 * 2),
        body: `Hi Raka,\n\nOctober closed at 1,240 orders (+18% MoM), contribution margin 31%. Repeat rate is up after the bundle launch.\n\nPlease review the reorder plan for the November promo by Friday.\n\nYusuf`,
        attachments: [{ name: 'Supplements-Oct-2026.xlsx', size: '210 KB' }],
      },
    ],
  },
  {
    id: 'e6',
    accountId: 'elk-connect',
    subject: 'Mentorship: 1:1 session request',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'me6',
        from: p('Reza Maulana', 'reza.maulana@example.com'),
        to: [p('Rimba Group', 'connect@rimbagroup.example')],
        date: ago(60 * 26),
        body: `Hello,\n\nI'm a marketer two years into my career and I'd love a 1:1 mentorship session about running paid social for e-commerce. Is there availability next week?\n\nThank you,\nReza`,
      },
    ],
  },
  {
    id: 'e7',
    accountId: 'elk-raka',
    subject: 'Your Shopify payout is on the way',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'me7',
        from: p('Shopify', 'no-reply@shopify.com'),
        to: [p('Raka', 'raka@rimbagroup.example')],
        date: ago(60 * 40),
        trackersBlocked: 2,
        body: `A payout of US$18,420.55 is on its way to your bank account and should arrive within 2 business days.`,
      },
    ],
  },
];
