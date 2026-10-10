import type { DataTable, TableRow } from '../types';

/** Demo tables for sprint2go demo: a client's leads (the lead-gen work) and the team's content pipeline. */
const at = (daysAgo: number) => new Date(Date.UTC(2026, 9, 8 - daysAgo, 3)).toISOString();

const S = { new: 'o-new', contacted: 'o-contacted', qualified: 'o-qualified', won: 'o-won', lost: 'o-lost' };
const SRC = { fb: 'o-fb', ig: 'o-ig', web: 'o-web', ref: 'o-ref' };

export const TABLES: DataTable[] = [
  {
    id: 'tb-brightleaf-leads',
    workspaceId: 'pnp',
    name: 'Brightleaf leads',
    color: '#a855f7',
    clientId: 'c-brightleaf',
    description: 'Leads from the Brightleaf launch ads. New ones arrive from the ad forms.',
    fields: [
      { id: 'f-name', name: 'Name', type: 'text' },
      { id: 'f-email', name: 'Email', type: 'email' },
      { id: 'f-phone', name: 'Phone', type: 'phone' },
      { id: 'f-source', name: 'Source', type: 'select', options: [ { id: SRC.fb, label: 'Facebook Ads', color: '#3b82f6' }, { id: SRC.ig, label: 'Instagram', color: '#ec4899' }, { id: SRC.web, label: 'Website', color: '#10b981' }, { id: SRC.ref, label: 'Referral', color: '#f59e0b' } ] },
      { id: 'f-status', name: 'Status', type: 'select', options: [ { id: S.new, label: 'New', color: '#3b82f6' }, { id: S.contacted, label: 'Contacted', color: '#f59e0b' }, { id: S.qualified, label: 'Qualified', color: '#8b5cf6' }, { id: S.won, label: 'Won', color: '#10b981' }, { id: S.lost, label: 'Lost', color: '#64748b' } ] },
      { id: 'f-value', name: 'Value', type: 'money', currency: 'IDR' },
      { id: 'f-owner', name: 'Owner', type: 'person' },
      { id: 'f-follow', name: 'Follow-up', type: 'date' },
      { id: 'f-notes', name: 'Notes', type: 'longtext' },
    ],
    views: [
      { id: 'v-grid', name: 'All leads', kind: 'grid' },
      { id: 'v-board', name: 'Pipeline', kind: 'board', groupBy: 'f-status' },
    ],
    createdBy: 'u-sophie',
    createdAt: at(12),
  },
  {
    id: 'tb-content',
    workspaceId: 'pnp',
    name: 'Content pipeline',
    color: '#f59e0b',
    description: 'Every video and post for clients, from idea to posted.',
    fields: [
      { id: 'c-title', name: 'Title', type: 'text' },
      { id: 'c-stage', name: 'Stage', type: 'select', options: [ { id: 'o-idea', label: 'Idea', color: '#64748b' }, { id: 'o-script', label: 'Script', color: '#0ea5e9' }, { id: 'o-shoot', label: 'Shooting', color: '#f59e0b' }, { id: 'o-edit', label: 'Editing', color: '#f97316' }, { id: 'o-review', label: 'Review', color: '#8b5cf6' }, { id: 'o-posted', label: 'Posted', color: '#10b981' } ] },
      { id: 'c-platform', name: 'Platform', type: 'multi', options: [ { id: 'o-insta', label: 'Instagram', color: '#ec4899' }, { id: 'o-tiktok', label: 'TikTok', color: '#0f172a' }, { id: 'o-yt', label: 'YouTube', color: '#ef4444' } ] },
      { id: 'c-owner', name: 'Owner', type: 'person' },
      { id: 'c-due', name: 'Due', type: 'date' },
      { id: 'c-brief', name: 'Brief', type: 'longtext' },
    ],
    views: [
      { id: 'v-cboard', name: 'Board', kind: 'board', groupBy: 'c-stage' },
      { id: 'v-cgrid', name: 'All content', kind: 'grid' },
    ],
    createdBy: 'u-james',
    createdAt: at(20),
  },
];

const lead = (n: number, name: string, email: string, phone: string, source: string, status: string, value: number | null, owner: string, follow: string | null, notes = '', daysAgo = n): TableRow => ({
  id: `r-gk-${n}`,
  workspaceId: 'pnp',
  tableId: 'tb-brightleaf-leads',
  values: { 'f-name': name, 'f-email': email, 'f-phone': phone, 'f-source': source, 'f-status': status, 'f-value': value, 'f-owner': owner, 'f-follow': follow, 'f-notes': notes },
  order: n,
  createdBy: 'u-sophie',
  createdAt: at(daysAgo),
  updatedAt: at(Math.max(0, daysAgo - 1)),
});

const post = (n: number, title: string, stage: string, platform: string[], owner: string, due: string | null, brief = ''): TableRow => ({
  id: `r-ct-${n}`,
  workspaceId: 'pnp',
  tableId: 'tb-content',
  values: { 'c-title': title, 'c-stage': stage, 'c-platform': platform, 'c-owner': owner, 'c-due': due, 'c-brief': brief },
  order: n,
  createdBy: 'u-james',
  createdAt: at(15 - n),
  updatedAt: at(Math.max(0, 10 - n)),
});

export const ROWS: TableRow[] = [
  lead(1, 'Nina Sasmita', 'nina.k@example.com', '+62 812 3456 7801', SRC.fb, S.qualified, 4_500_000, 'u-sophie', '2026-10-09', 'Wants the bundle for her clinic. Asked for a price list.'),
  lead(2, 'Diana King', 'diana.king@example.com', '+62 813 2233 4410', SRC.ig, S.contacted, 1_200_000, 'u-owen', '2026-10-10'),
  lead(3, 'Paige Adams', 'paige.ang@example.com', '+62 857 1100 2299', SRC.fb, S.new, null, 'u-owen', null),
  lead(4, 'Sarah Reynolds', 'sarah@beautyhaus.example', '+62 811 9090 1212', SRC.web, S.won, 9_800_000, 'u-sophie', null, 'Reseller, 3 stores in Bandung.'),
  lead(5, 'Amy Lewis', 'amy.lewis@example.com', '+62 878 5544 3322', SRC.ig, S.new, null, 'u-owen', '2026-10-08'),
  lead(6, 'Laura Hughes', 'laura.h@example.com', '+62 812 7766 5544', SRC.ref, S.qualified, 3_000_000, 'u-sophie', '2026-10-12', 'Referred by Sarah.'),
  lead(7, 'Maya Sinta', 'maya.sinta@example.com', '+62 815 3322 1100', SRC.fb, S.lost, null, 'u-owen', null, 'Price too high for now.'),
  lead(8, 'Lia Permata', 'lia.permata@example.com', '+62 819 8877 6655', SRC.fb, S.new, null, 'u-owen', null, '', 0),
  post(1, 'Kopinara: barista day in the life', 'o-edit', ['o-insta', 'o-tiktok'], 'u-jack', '2026-10-10', 'Morning rush, 30s, hook in the first 2s.'),
  post(2, 'Selara: serum before and after', 'o-review', ['o-insta'], 'u-emma', '2026-10-09'),
  post(3, 'Brightleaf launch: 3 hooks', 'o-script', ['o-insta', 'o-tiktok'], 'u-jack', '2026-10-18'),
  post(4, 'Teduh: room tour', 'o-idea', ['o-yt'], 'u-james', null),
  post(5, 'Kopinara: new menu carousel', 'o-posted', ['o-insta'], 'u-emma', '2026-10-03'),
  post(6, 'Selara: dermatologist Q&A', 'o-shoot', ['o-yt', 'o-insta'], 'u-jack', '2026-10-14'),
];
