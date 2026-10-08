import type { Label, Person, Thread } from '../types';
import { nextWeekday } from './calendar';
import { DEFAULT_TRACK_OPTIONS as OPTS } from '../tracking';

// Sample mailbox. This gets replaced by a real JMAP connection to Stalwart later.

export const ME: Person = { name: 'Aqeel', email: 'aqeel@pixelandprofits.com' };

export const LABELS: Label[] = [
  { id: 'clients', name: 'Clients', color: '#10b981' },
  { id: 'team', name: 'Team', color: '#5b5bf6' },
  { id: 'infra', name: 'Infra', color: '#f59e0b' },
  { id: 'finance', name: 'Finance', color: '#ef4444' },
];

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const p = (name: string, email: string): Person => ({ name, email });

const faisal = p('Faisal Tirtonady', 'faisal@pixelandprofits.com');
const aditya = p('Aditya Aisar', 'aditya@pixelandprofits.com');
const nadia = p('Nadia Putri', 'nadia@kopikita.co.id');
const dokploy = p('Dokploy', 'notifications@dokploy.com');
const contabo = p('Contabo Billing', 'billing@contabo.com');
const aws = p('Amazon Web Services', 'no-reply@aws.amazon.com');
const rizky = p('Rizky Pratama', 'rizky@pixelandprofits.com');
const sarah = p('Sarah Lim', 'sarah@luminaskin.sg');
const github = p('GitHub', 'noreply@github.com');
const figma = p('Dina from Figma', 'dina@figma.com');
const dimas = p('Dimas Hartono', 'dimas@arunikahotels.id');
const maya = p('Maya Santoso', 'maya@studiolokal.co');

export const THREADS: Thread[] = [
  {
    id: 't1',
    accountId: 'pnp-aqeel',
    subject: 'Q4 creative direction: first round of concepts',
    location: 'inbox',
    starred: true,
    unread: true,
    labels: ['clients'],
    invite: {
      title: 'KopiKita Q4 concepts review',
      start: nextWeekday(4, 14),
      end: nextWeekday(4, 15),
      location: 'Google Meet',
    },
    messages: [
      {
        id: 'm1a',
        from: nadia,
        to: [ME],
        date: ago(240),
        body: `Hi Aqeel,\n\nThanks for the kickoff call last week. As promised, I've attached our brand guidelines and last quarter's top performing ads so the team has something to react against.\n\nWe'd love to see 3–4 directions before the 10th if possible.\n\nNadia`,
        attachments: [{ name: 'KopiKita-brand-guide.pdf', size: '4.2 MB' }],
      },
      {
        id: 'm1b',
        from: ME,
        to: [nadia],
        date: ago(180),
        body: `Hi Nadia,\n\nGot it, thank you. We'll have four directions over to you by Wednesday.\n\nAqeel`,
        trackOptions: OPTS,
        tracking: {
          [nadia.email]: {
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
        from: nadia,
        to: [ME],
        date: ago(12),
        body: `Amazing, thank you!\n\nOne more thing: our CEO really liked the "morning ritual" angle from the pitch deck. Could one of the four lean into that? Short-form video first, statics second.\n\nAlso, can we push the review call to Thursday 2pm WIB? Wednesday got busy on our side.\n\nNadia`,
      },
    ],
  },
  {
    id: 't-invite',
    accountId: 'pnp-aqeel',
    subject: 'Invitation: Lumina launch check-in',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['clients'],
    messages: [
      {
        id: 'm-invite',
        from: p('Sarah Lim', 'sarah@luminaskin.sg'),
        to: [ME],
        date: ago(55),
        body: `Sarah Lim has invited you to Lumina launch check-in.\n\nA quick check on the launch ads before they go live: what's approved, what's still waiting.\n\nJoin with Google Meet: https://meet.google.com/lum-ainv-kin`,
        attachments: [{ name: 'invite.ics', size: '2 KB' }],
        invite: {
          method: 'REQUEST',
          uid: 'lumina-launch-checkin@google.com',
          sequence: 0,
          title: 'Lumina launch check-in',
          start: nextWeekday(3, 15),
          end: new Date(Date.parse(nextWeekday(3, 15)) + 30 * 60_000).toISOString(),
          tz: 'Asia/Singapore',
          url: 'https://meet.google.com/lum-ainv-kin',
          description: 'A quick check on the launch ads before they go live: what’s approved, what’s still waiting.',
          organizer: sarah,
          attendees: [
            { ...sarah, status: 'accepted' },
            { ...ME, email: 'aqeel@pixelandprofits.com', status: 'needs-action' },
            { ...faisal, status: 'tentative' },
          ],
          you: 'aqeel@pixelandprofits.com',
        },
      },
    ],
  },
  {
    id: 't2',
    accountId: 'pnp-aqeel',
    subject: 'Deployment succeeded: website (staging)',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['infra'],
    messages: [
      {
        id: 'm2',
        from: dokploy,
        to: [ME],
        date: ago(38),
        body: `Your application "Website (staging)" was deployed successfully.\n\nProject: Pixel & Profits website\nEnvironment: staging\nBuild time: 1m 42s\nDomain: https://staging.pixelandprofits.com\n\n— Dokploy`,
      },
    ],
  },
  {
    id: 't3',
    accountId: 'pnp-aqeel',
    subject: 'Hiring: shortlist for the performance marketer role',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['team'],
    messages: [
      {
        id: 'm3',
        from: faisal,
        to: [ME, aditya],
        date: ago(95),
        body: `Team,\n\nI've gone through the 23 applications. Five stand out, see the attached sheet with my notes.\n\nCan we each pick our top 3 by Friday? I'd like to start first interviews next week.\n\nFaisal`,
        attachments: [{ name: 'shortlist-perf-marketer.xlsx', size: '38 KB' }],
      },
    ],
  },
  {
    id: 't4',
    accountId: 'pnp-aqeel',
    subject: 'Your SES account is now out of the sandbox',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['infra'],
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
    accountId: 'pnp-aqeel',
    subject: 'Re: Lumina Skin September results',
    location: 'inbox',
    starred: true,
    unread: false,
    labels: ['clients'],
    messages: [
      {
        id: 'm5a',
        from: ME,
        to: [sarah],
        date: ago(60 * 26),
        body: `Hi Sarah,\n\nSeptember report attached. Headline: blended ROAS up to 4.1 from 3.2, with new-customer revenue up 38%.\n\nThe live dashboard is here: Lumina performance dashboard\n\nHappy to walk through it on a call.\n\nAqeel`,
        html: `<p>Hi Sarah,</p><p>September report attached. Headline: <b>blended ROAS up to 4.1 from 3.2</b>, with new-customer revenue up 38%.</p><p>The live dashboard is here: <a href="https://dash.pixelandprofits.com/lumina">Lumina performance dashboard</a></p><p>Happy to walk through it on a call.</p><p>Aqeel</p>`,
        attachments: [{ name: 'Lumina-Sep-2026-report.pdf', size: '1.1 MB' }],
        trackOptions: OPTS,
        tracking: {
          [sarah.email]: {
            opens: [
              { at: ago(60 * 25.8), device: 'Mac · Apple Mail', place: 'Singapore, SG', auto: 'apple' },
              { at: ago(60 * 22), device: 'Mac · Outlook', place: 'Singapore, SG' },
              { at: ago(60 * 21.5), device: 'Mac · Outlook', place: 'Singapore, SG' },
              { at: ago(60 * 20.2), device: 'iPhone · Outlook', place: 'Singapore, SG' },
              { at: ago(60 * 3), device: 'Windows · Outlook', place: 'Kuala Lumpur, MY' },
            ],
            docs: [
              { at: ago(60 * 21.3), file: 'Lumina-Sep-2026-report.pdf', seconds: 252, pages: '8 of 8' },
              { at: ago(60 * 2.8), file: 'Lumina-Sep-2026-report.pdf', seconds: 95, pages: '3 of 8' },
            ],
            clicks: [
              { at: ago(60 * 21.4), label: 'Lumina performance dashboard', url: 'https://dash.pixelandprofits.com/lumina' },
              { at: ago(60 * 2.9), label: 'Lumina performance dashboard', url: 'https://dash.pixelandprofits.com/lumina' },
            ],
          },
        },
      },
      {
        id: 'm5b',
        from: sarah,
        to: [ME],
        date: ago(60 * 20),
        body: `This is brilliant, the team is thrilled. Let's talk about scaling budget for 11.11 and 12.12. Does Monday work?\n\nSarah`,
      },
    ],
  },
  {
    id: 't6',
    accountId: 'pnp-aqeel',
    subject: 'Invoice #CT-2026-09-81442 is available',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['finance'],
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
    accountId: 'pnp-aqeel',
    subject: 'Lunch Friday? 🍜',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['team'],
    messages: [
      {
        id: 'm7',
        from: rizky,
        to: [ME],
        date: ago(60 * 47),
        body: `Bakmi place near the office reopened. Friday 12:30? I'll book for 6.`,
      },
    ],
  },
  {
    id: 't8',
    accountId: 'pnp-aqeel',
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
        body: `rizky-p requested your review on #42.\n\nReplaces the 2-column brand picker with a horizontal slider so the full case fits in one screen on mobile.\n\n3 files changed, +214 −131`,
      },
    ],
  },
  {
    id: 't9',
    accountId: 'pnp-aqeel',
    subject: 'Your team plan renews in 7 days',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: ['finance'],
    messages: [
      {
        id: 'm9',
        from: figma,
        to: [ME],
        date: ago(60 * 24 * 4),
        trackersBlocked: 3,
        listUnsubscribe: { url: 'https://figma.com/unsubscribe/abc', oneClick: true },
        body: `Hi Aqeel,\n\nJust a heads-up that your Figma Professional plan (3 seats) renews on 9 October.\n\nNo action is needed if you'd like to continue.\n\nDina`,
      },
    ],
  },
  {
    id: 't13',
    accountId: 'pnp-aqeel',
    subject: 'Proposal: Q1 performance retainer',
    location: 'archive',
    starred: false,
    unread: false,
    labels: ['clients'],
    messages: [
      {
        id: 'm13',
        from: ME,
        to: [dimas],
        date: ago(60 * 28),
        body: `Hi Dimas,\n\nGreat meeting you at the hospitality summit. As promised, here's our proposal for a Q1 performance retainer: paid social plus search, with weekly creative testing.\n\nHappy to adjust scope to your budget.\n\nAqeel`,
        attachments: [{ name: 'Arunika-Q1-proposal.pdf', size: '2.8 MB' }],
        trackOptions: OPTS,
        tracking: { [dimas.email]: { opens: [], clicks: [] } },
      },
    ],
  },
  {
    id: 't14',
    accountId: 'pnp-aqeel',
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
        body: `Hi Maya,\n\nLove what Studio Lokal is doing. Would you be open to a joint content day at your space next month? We'd bring two brands and a small crew.\n\nAqeel`,
        trackOptions: OPTS,
        tracking: {
          [maya.email]: { opens: [{ at: ago(60 * 6 - 1), device: 'iPhone · Apple Mail', auto: 'apple' }], clicks: [] },
        },
      },
    ],
  },
  {
    id: 't10',
    accountId: 'pnp-aqeel',
    subject: 'Brand workshop notes',
    location: 'archive',
    starred: false,
    unread: false,
    labels: ['team'],
    messages: [
      {
        id: 'm10',
        from: aditya,
        to: [ME, faisal],
        date: ago(60 * 24 * 9),
        body: `Notes from Tuesday are in the shared drive. Key decision: keep the sage + coral palette, retire the gradient.\n\nAditya`,
      },
    ],
  },
  {
    id: 't11',
    accountId: 'pnp-aqeel',
    subject: 'Proposal draft: KopiKita retainer',
    location: 'drafts',
    starred: false,
    unread: false,
    labels: ['clients'],
    messages: [
      {
        id: 'm11',
        from: ME,
        to: [nadia],
        date: ago(60 * 5),
        body: `Hi Nadia,\n\nFollowing our call, here's how we'd structure the retainer for Q4:\n\n`,
      },
    ],
  },
  {
    id: 't12',
    accountId: 'pnp-aqeel',
    subject: 'You have WON $5,000,000!!! Claim now',
    location: 'spam',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'm12',
        from: p('Prize Department', 'winner@claim-prize-now.biz'),
        to: [ME],
        date: ago(60 * 7),
        body: `Congratulations!! Send your bank details to claim.`,
        trackersBlocked: 5,
      },
    ],
  },

  // Shared team inbox: hello@pixelandprofits.com
  {
    id: 'h1',
    accountId: 'pnp-hello',
    assignee: 'u-aditya',
    notes: [{ id: 'n1', by: 'u-aditya', text: 'I’ll take this one. Glowkind looks like a good fit for our skincare work.', at: new Date(Date.now() - 50 * 60_000).toISOString() }],
    subject: 'Enquiry: paid social for a new skincare brand',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['clients'],
    messages: [
      {
        id: 'mh1',
        from: p('Rina Wijaya', 'rina@glowkind.id'),
        to: [p('Pixel & Profits', 'hello@pixelandprofits.com')],
        date: ago(55),
        body: `Hello,\n\nWe're launching a skincare line in January and are looking for an agency to run Meta and TikTok ads. Budget around IDR 150m per month to start.\n\nCould we book a call next week?\n\nRina`,
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
        from: p('Kevin Tan', 'kevin@creatorloop.asia'),
        to: [p('Pixel & Profits', 'hello@pixelandprofits.com')],
        date: ago(60 * 30),
        body: `Hi team,\n\nWe manage 400+ creators across ID, MY and PH. Open to a referral partnership for UGC production?\n\nKevin`,
      },
    ],
  },
  // Elkiya Group workspace
  {
    id: 'e1',
    accountId: 'elk-aqeel',
    subject: 'October board pack',
    location: 'inbox',
    starred: true,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'me1',
        from: p('Hana Elkiya', 'hana@elkiyagroup.com'),
        to: [p('Aqeel', 'aqeel@elkiyagroup.com')],
        date: ago(80),
        body: `Hi Aqeel,\n\nAttached is the October board pack. Please review the portfolio section before Thursday.\n\nHana`,
        attachments: [{ name: 'Elkiya-board-pack-Oct.pdf', size: '3.4 MB' }],
      },
    ],
  },
  {
    id: 'e2',
    accountId: 'elk-aqeel',
    subject: 'Website launch checklist',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'me2',
        from: p('Bayu Saputra', 'bayu@elkiyagroup.com'),
        to: [p('Aqeel', 'aqeel@elkiyagroup.com')],
        date: ago(60 * 5),
        body: `DNS is ready on our side. Once you give the go-ahead we'll point elkiyagroup.com to the new server.\n\nBayu`,
      },
    ],
  },
  {
    id: 'e3',
    accountId: 'elk-aqeel',
    subject: 'Thanks for the Q3 investor update',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'me3',
        from: p('Daniel Lee', 'daniel@harbourcap.sg'),
        to: [p('Aqeel', 'aqeel@elkiyagroup.com')],
        date: ago(60 * 50),
        body: `Thanks for the clear update, Aqeel. Looking forward to the Q4 numbers.\n\nDaniel`,
      },
    ],
  },

  // Rizky's own mailbox
  {
    id: 'r1',
    accountId: 'pnp-rizky',
    subject: 'Ad account access for Lumina',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: ['clients'],
    messages: [
      {
        id: 'mr1',
        from: faisal,
        to: [rizky],
        date: ago(42),
        body: `Hi Rizky,\n\nSarah granted us admin on Lumina's Meta ad account. Can you set up the 11.11 campaign structure by Wednesday?\n\nFaisal`,
      },
    ],
  },
  {
    id: 'r2',
    accountId: 'pnp-rizky',
    subject: 'Creative feedback, round 2',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'mr2',
        from: nadia,
        to: [rizky],
        date: ago(60 * 20),
        body: `Hi Rizky,\n\nVersions B and D are our favourites. Could we try D with a warmer colour grade?\n\nNadia`,
      },
    ],
  },

  // Newsletters & promotions (for unsubscribe / block)
  {
    id: 'n1',
    accountId: 'pnp-aqeel',
    subject: 'Growth Digest #212: 9 creative-testing frameworks',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'mn1',
        from: p('Growth Digest', 'news@growthdigest.io'),
        to: [ME],
        date: ago(60 * 3),
        trackersBlocked: 4,
        listUnsubscribe: { url: 'https://growthdigest.io/u/3f9a', oneClick: true },
        body: `This week: nine creative-testing frameworks the best DTC brands use, plus a teardown of a 7-figure UGC funnel.\n\nRead online · Manage preferences`,
      },
    ],
  },
  {
    id: 'n2',
    accountId: 'pnp-aqeel',
    subject: '⚡ FLASH SALE: 70% off everything, 6 hours only',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'mn2',
        from: p('ShopMart Deals', 'deals@shopmart.co'),
        to: [ME],
        date: ago(60 * 9),
        trackersBlocked: 6,
        listUnsubscribe: { url: 'https://shopmart.co/unsub?id=88', oneClick: false },
        body: `Don't miss out! Everything 70% off for the next 6 hours. Shop now before it's gone!`,
      },
    ],
  },
  {
    id: 'n3',
    accountId: 'pnp-aqeel',
    subject: 'Your cart misses you 🛒',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'mn3',
        from: p('ShopMart Deals', 'promo@shopmart.co'),
        to: [ME],
        date: ago(60 * 30),
        trackersBlocked: 5,
        listUnsubscribe: { url: 'https://shopmart.co/unsub?id=88', oneClick: false },
        body: `You left something behind! Complete your order today and get free shipping.`,
      },
    ],
  },

  // Elkiya Group — more mail
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
        from: p('Kirana Dewi', 'kirana@kopiharian.id'),
        to: [p('Elkiya Group', 'connect@elkiyagroup.com')],
        date: ago(35),
        body: `Hi Elkiya team,\n\nWe run a subscription coffee brand doing about IDR 900m a month, profitable, but growth has stalled. We're looking for a partner who can help us grow rather than just an agency.\n\nCould we set up a call on Tuesday 10am?\n\nKirana`,
      },
    ],
  },
  {
    id: 'e5',
    accountId: 'elk-aqeel',
    subject: 'Supplements brand: October numbers',
    location: 'inbox',
    starred: false,
    unread: true,
    labels: [],
    messages: [
      {
        id: 'me5',
        from: p('Dimas Prakoso', 'dimas@elkiyagroup.com'),
        to: [p('Aqeel', 'aqeel@elkiyagroup.com')],
        date: ago(60 * 2),
        body: `Hi Aqeel,\n\nOctober closed at 1,240 orders (+18% MoM), contribution margin 31%. Repeat rate is up after the bundle launch.\n\nPlease review the reorder plan for the November promo by Friday.\n\nDimas`,
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
        from: p('Reza Maulana', 'reza.maulana@gmail.com'),
        to: [p('Elkiya Group', 'connect@elkiyagroup.com')],
        date: ago(60 * 26),
        body: `Hello,\n\nI'm a marketer two years into my career and I'd love a 1:1 mentorship session about running paid social for e-commerce. Is there availability next week?\n\nThank you,\nReza`,
      },
    ],
  },
  {
    id: 'e7',
    accountId: 'elk-aqeel',
    subject: 'Your Shopify payout is on the way',
    location: 'inbox',
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: 'me7',
        from: p('Shopify', 'no-reply@shopify.com'),
        to: [p('Aqeel', 'aqeel@elkiyagroup.com')],
        date: ago(60 * 40),
        trackersBlocked: 2,
        body: `A payout of US$18,420.55 is on its way to your bank account and should arrive within 2 business days.`,
      },
    ],
  },
];
