import type { DriveItem, DriveKind } from '../types';

// Sample Drive. This gets replaced by Stalwart's file storage (WebDAV) later.

export const QUOTA = 50 * 1024 ** 3; // 50 GB
export const MAIL_USAGE = 1.3 * 1024 ** 3; // what the mailbox itself uses

/** Abstract "photo" thumbnails as inline SVG, so the prototype needs no image files. */
export function artThumb(seed: number) {
  const palettes = [
    ['#ff9a8b', '#ff6a88', '#ffd3a5'],
    ['#5b5bf6', '#9f7aea', '#f6d365'],
    ['#0ea5e9', '#22d3ee', '#a7f3d0'],
    ['#10b981', '#065f46', '#fde68a'],
    ['#f59e0b', '#ef4444', '#fef3c7'],
    ['#1e293b', '#6366f1', '#f472b6'],
    ['#84cc16', '#14b8a6', '#ecfccb'],
    ['#d946ef', '#7c3aed', '#fbcfe8'],
  ];
  const [a, b, c] = palettes[seed % palettes.length];
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<filter id="f"><feGaussianBlur stdDeviation="28"/></filter></defs>
<rect width="400" height="300" fill="url(#g)"/>
<g filter="url(#f)" opacity=".85">
<circle cx="${60 + r(1) * 280}" cy="${40 + r(2) * 200}" r="${60 + r(3) * 60}" fill="${c}"/>
<circle cx="${60 + r(4) * 280}" cy="${60 + r(5) * 200}" r="${40 + r(6) * 70}" fill="${a}"/>
</g>
<path d="M0 ${210 + r(7) * 40} Q 120 ${170 + r(8) * 40} 220 ${215 + r(9) * 30} T 400 ${200 + r(10) * 40} V300 H0Z" fill="#000" opacity=".18"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const MB = 1024 ** 2;
const ago = (days: number, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3_600_000).toISOString();

let n = 0;
const item = (name: string, kind: DriveKind, parentId: string | null, size: number, modified: string, extra: Partial<DriveItem> = {}): DriveItem => ({
  id: `d${++n}`,
  name,
  kind,
  parentId,
  size,
  modified,
  ...extra,
});

const clients = item('Clients', 'folder', null, 0, ago(1));
const brand = item('Brand assets', 'folder', null, 0, ago(3));
const finance = item('Finance', 'folder', null, 0, ago(6));
const shoot = item('Office launch shoot', 'folder', null, 0, ago(2));
const kopikita = item('KopiKita', 'folder', clients.id, 0, ago(1), { clientId: 'c-kopikita', workspaceId: 'pnp' });
const lumina = item('Lumina Skin', 'folder', clients.id, 0, ago(4), { clientId: 'c-lumina', workspaceId: 'pnp' });

export const DRIVE: DriveItem[] = [
  clients,
  brand,
  finance,
  shoot,
  kopikita,
  lumina,
  item('Q4 proposal.pdf', 'pdf', null, 2.4 * MB, ago(0, 5), { starred: true }),
  item('Content calendar October.xlsx', 'sheet', null, 0.3 * MB, ago(0, 9)),
  item('Pitch deck v3.pptx', 'slides', null, 18.2 * MB, ago(2)),
  item('Team photo.jpg', 'image', null, 4.1 * MB, ago(5), { thumb: artThumb(5) }),
  item('Brand guidelines 2026.pdf', 'pdf', brand.id, 9.8 * MB, ago(3), { starred: true }),
  item('Logo pack.zip', 'zip', brand.id, 42 * MB, ago(9)),
  item('Hero background.png', 'image', brand.id, 6.3 * MB, ago(3), { thumb: artThumb(1) }),
  item('Pattern study.png', 'image', brand.id, 3.2 * MB, ago(8), { thumb: artThumb(7) }),
  item('Brand film 30s.mp4', 'video', brand.id, 186 * MB, ago(4), { thumb: artThumb(3), duration: '0:30' }),
  item('Contabo invoices 2026.pdf', 'pdf', finance.id, 1.1 * MB, ago(6)),
  item('Budget 2027 draft.xlsx', 'sheet', finance.id, 0.6 * MB, ago(12)),
  ...Array.from({ length: 8 }, (_, i) =>
    item(`DSC_0${412 + i}.jpg`, 'image', shoot.id, (5 + (i % 3)) * MB, ago(2, i), { thumb: artThumb(i + 10) }),
  ),
  item('Behind the scenes.mov', 'video', shoot.id, 312 * MB, ago(2), { thumb: artThumb(21), duration: '2:14' }),
  item('Office tour.mp4', 'video', shoot.id, 148 * MB, ago(2, 3), { thumb: artThumb(22), duration: '1:05' }),
  item('Morning ritual moodboard.png', 'image', kopikita.id, 7.4 * MB, ago(1), { thumb: artThumb(4), clientId: 'c-kopikita', workspaceId: 'pnp', sharedWithClient: true }),
  item('KopiKita brief.docx', 'doc', kopikita.id, 0.2 * MB, ago(1, 4), { clientId: 'c-kopikita', workspaceId: 'pnp' }),
  item('KopiKita Q4 concepts v2.pdf', 'pdf', kopikita.id, 12.6 * MB, ago(0, 6), { clientId: 'c-kopikita', workspaceId: 'pnp', sharedWithClient: true }),
  item('Lumina Sep report.pdf', 'pdf', lumina.id, 1.1 * MB, ago(1), { threadId: 't5', clientId: 'c-lumina', workspaceId: 'pnp', sharedWithClient: true }),
  item('Voice note Sarah.m4a', 'audio', lumina.id, 2.2 * MB, ago(4), { clientId: 'c-lumina', workspaceId: 'pnp' }),
  item('Old logo.png', 'image', null, 0.8 * MB, ago(20), { trashed: true, thumb: artThumb(30) }),
];

export function kindOf(file: { name: string; type?: string }): DriveKind {
  const t = file.type ?? '';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (t.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return 'image';
  if (t.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
  if (t.startsWith('audio/') || ['mp3', 'm4a', 'wav'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
  if (['zip', 'rar', '7z'].includes(ext)) return 'zip';
  return 'other';
}

export function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "1.1 MB" → bytes, for attachment sizes written as text. */
export function parseSize(s: string) {
  const m = /([\d.]+)\s*(B|KB|MB|GB)/i.exec(s);
  if (!m) return 0;
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2].toUpperCase() as 'B'];
  return parseFloat(m[1]) * mult;
}
