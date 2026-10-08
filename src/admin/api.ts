/** The operator backend's calls. Every error becomes a thrown Error carrying the server's message (and its status). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}
async function read(r: Response) {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${r.status})`, r.status, data as Record<string, unknown>);
  return data;
}
export const get = <T = any>(path: string): Promise<T> => fetch(`/api/admin/${path}`).then(read);
export const post = <T = any>(path: string, body: unknown = {}): Promise<T> => fetch(`/api/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(read);

export const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
/** Short money: Rp 1,2 jt, Rp 340 rb. */
export const rpShort = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : Math.abs(n) >= 1e3 ? `Rp ${Math.round(n / 1e3)} rb` : rp(n));
export const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
export const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '');
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const monthName = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
export const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});
export const duration = (mins: number | null) => (mins === null ? 'none yet' : mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${(mins / 60).toFixed(mins < 600 ? 1 : 0)} h` : `${Math.round(mins / 1440)} days`);

export type State = 'free' | 'trial' | 'paused' | 'comp' | 'paying' | 'suspended';
export type Perm = 'view' | 'support' | 'impersonate' | 'customers' | 'billing' | 'product' | 'platform' | 'team' | 'danger';
export type OpRole = 'owner' | 'admin' | 'support' | 'finance' | 'readonly';
export interface Health {
  score: number;
  label: 'healthy' | 'watch' | 'risk';
  parts: { key: string; label: string; score: number; max: number }[];
}
export interface PlanInfo {
  tier: string;
  track: string;
  cycle: string;
  trialEnds: string | null;
  paused: boolean;
  comp: { until: string; note?: string } | null;
  discount: { code: string; kind: string; value: number; until?: string } | null;
  addons: { mailboxes: number; storage50: number; meetHours10: number; branding: boolean };
  billing: { company: string; npwp?: string; address?: string; emails: string[] } | null;
}
export interface CompanyRow {
  id: string;
  name: string;
  color: string;
  plan: PlanInfo | null;
  mrr: number;
  state: State;
  after?: number;
  discount: number;
  people: number;
  guests: number;
  projects: number;
  owner: { id: string; name: string; email: string } | null;
  lastActive: string | null;
  aiRp: number;
  aiIncludedUses: number;
  storageBytes: number;
  since: string | null;
  suspended: { at: string; by: string; reason: string; why?: string } | null;
  internal: boolean;
  home: boolean;
  industry: string | null;
  domains: string[];
  openTickets: number;
  overdue: number;
  health: Health;
}
export interface PersonRow {
  id: string;
  name: string;
  email: string;
  title: string;
  color: string;
  companies: { id: string; name: string; role: string }[];
  guestOf: string[];
  lastSeen: string | null;
  hasLogin: boolean;
  suspended: { at: string; by: string; reason: string } | null;
  operator: OpRole | null;
  disposable: boolean;
}
export type TicketStatus = 'new' | 'open' | 'waiting' | 'resolved' | 'closed';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export interface TicketRow {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: Priority;
  channel: 'app' | 'email' | 'crash';
  requester: { email: string; name: string | null; userId: string | null };
  workspaceId: string | null;
  company: string | null;
  assignee: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  firstReplyAt: string | null;
  resolvedAt: string | null;
  rating: 'good' | 'okay' | 'bad' | null;
  ratingNote: string | null;
  breaching: boolean;
  context?: Record<string, unknown> | null;
}

export const STATE_LABEL: Record<State, string> = { free: 'Free', trial: 'Trial', paused: 'Paused', comp: 'Free months', paying: 'Paying', suspended: 'Suspended' };
export const STATUS_LABEL: Record<TicketStatus, string> = { new: 'New', open: 'Open', waiting: 'Waiting on them', resolved: 'Resolved', closed: 'Closed' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const ROLE_LABEL: Record<OpRole, string> = { owner: 'Owner', admin: 'Admin', support: 'Support', finance: 'Finance', readonly: 'Read-only' };
export const ROLE_HINT: Record<OpRole, string> = {
  owner: 'Everything, including deleting companies and managing owners',
  admin: 'Everything except deleting companies and owners',
  support: 'Tickets, notes, reset codes and signing in as customers',
  finance: 'Plans, prices, coupons and invoices',
  readonly: 'Sees everything, changes nothing',
};
export const planLabel = (p: PlanInfo | null) => (!p || p.tier === 'free' ? 'Free' : `${p.tier[0].toUpperCase()}${p.tier.slice(1)}${p.track === 'ai' ? ' AI' : ''}${p.cycle === 'yearly' ? ' · yearly' : ''}`);
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

/** "3 min ago" for the past, "in 2 hours" for the future. */
export function rel(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  const fmt = (m: number) => (m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} hour${Math.round(m / 60) > 1 ? 's' : ''}` : `${Math.round(m / 1440)} days`);
  if (mins > 0) return `in ${fmt(mins)}`;
  if (mins > -1) return 'just now';
  return `${fmt(-mins)} ago`;
}
