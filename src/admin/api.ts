import { t, tn, tx } from '../i18n';
import { fmtDate, fmtDay, fmtNumber } from '../i18n/format';

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
  if (!r.ok) throw new ApiError((data as { error?: string }).error ?? t('Request failed ({status})', { status: r.status }), r.status, data as Record<string, unknown>);
  return data;
}
export const get = <T = any>(path: string): Promise<T> => fetch(`/api/admin/${path}`).then(read);
export const post = <T = any>(path: string, body: unknown = {}): Promise<T> => fetch(`/api/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(read);

export const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
/** Short money: Rp 1,2 jt, Rp 340 rb. */
export const rpShort = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : Math.abs(n) >= 1e3 ? `Rp ${Math.round(n / 1e3)} rb` : rp(n));
const one = (n: number) => fmtNumber(n, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const bytes = (n: number) => (n >= 1e9 ? `${one(n / 1e9)} GB` : n >= 1e6 ? `${one(n / 1e6)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
/** "8 Oct" (with the year when it isn't this one), in the console's language. */
export const day = (iso?: string | null) => (iso ? fmtDay(iso) : '');
/** "8 Oct, 14:30". */
export const dateTime = (iso?: string | null) => (iso ? fmtDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '');
/** "Oct 26" for a month written 2026-10. */
export const monthName = (ym: string) => fmtDate(new Date(ym + '-01T00:00:00Z'), { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});
export const duration = (mins: number | null) =>
  mins === null ? t('none yet') : mins < 60 ? t('{n} min', { n: mins }) : mins < 48 * 60 ? t('{n} h', { n: fmtNumber(mins / 60, { maximumFractionDigits: mins < 600 ? 1 : 0, minimumFractionDigits: mins < 600 ? 1 : 0 }) }) : tn(Math.round(mins / 1440), '{n} day', '{n} days');

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
  /** People on the team who signed in or used sprint2go this month: what the plan bills, and what `mrr` counts. */
  active: number;
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

// Labels in the console's language: getters, so each read gives the words of the moment (docs/i18n.md).
export const STATE_LABEL: Record<State, string> = {
  get free() { return t('Free'); },
  get trial() { return t('Trial'); },
  get paused() { return t('Paused'); },
  get comp() { return t('Free months'); },
  get paying() { return t('Paying'); },
  get suspended() { return t('Suspended'); },
};
export const STATUS_LABEL: Record<TicketStatus, string> = {
  get new() { return tx('ticket', 'New'); },
  get open() { return tx('ticket', 'Open'); },
  get waiting() { return t('Waiting on them'); },
  get resolved() { return t('Resolved'); },
  get closed() { return tx('ticket', 'Closed'); },
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  get low() { return tx('priority', 'Low'); },
  get normal() { return tx('priority', 'Normal'); },
  get high() { return tx('priority', 'High'); },
  get urgent() { return tx('priority', 'Urgent'); },
};
export const ROLE_LABEL: Record<OpRole, string> = {
  get owner() { return t('Owner'); },
  get admin() { return t('Admin'); },
  get support() { return tx('role', 'Support'); },
  get finance() { return tx('role', 'Finance'); },
  get readonly() { return t('Read-only'); },
};
export const ROLE_HINT: Record<OpRole, string> = {
  get owner() { return t('Everything, including deleting companies and managing owners'); },
  get admin() { return t('Everything except deleting companies and owners'); },
  get support() { return t('Tickets, notes, reset codes and signing in as customers'); },
  get finance() { return t('Plans, prices, coupons and invoices'); },
  get readonly() { return t('Sees everything, changes nothing'); },
};
/** "Studio AI · yearly": the plan's name stays as it is (a product name), the rest is translated. */
export const planLabel = (p: PlanInfo | null) => {
  if (!p || p.tier === 'free') return t('Free');
  const name = `${p.tier[0].toUpperCase()}${p.tier.slice(1)}${p.track === 'ai' ? ' AI' : ''}`;
  return p.cycle === 'yearly' ? t('{plan} · yearly', { plan: name }) : name;
};
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
  const m = Math.abs(mins);
  const hours = Math.round(m / 60);
  const days = Math.round(m / 1440);
  if (mins > 0) return m < 60 ? t('in {n} min', { n: m }) : m < 48 * 60 ? tn(hours, 'in {n} hour', 'in {n} hours') : tn(days, 'in {n} day', 'in {n} days');
  if (mins > -1) return t('just now');
  return m < 60 ? tn(m, '{n} min ago', '{n} min ago') : m < 48 * 60 ? tn(hours, '{n} hour ago', '{n} hours ago') : tn(days, '{n} day ago', '{n} days ago');
}
