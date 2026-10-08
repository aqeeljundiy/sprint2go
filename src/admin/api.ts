/** The operator backend's calls. Every error becomes a thrown Error with the server's message. */
async function read(r: Response) {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
  return data;
}
export const get = <T = any>(path: string): Promise<T> => fetch(`/api/admin/${path}`).then(read);
export const post = <T = any>(path: string, body: unknown = {}): Promise<T> => fetch(`/api/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(read);

export const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
export const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
export const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '');
export const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

export type State = 'free' | 'trial' | 'paused' | 'comp' | 'paying' | 'suspended';
export interface CompanyRow {
  id: string;
  name: string;
  color: string;
  plan: { tier: string; track: string; cycle: string; trialEnds?: string; paused: boolean; comp: { until: string; note?: string } | null; addons: { mailboxes: number; storage50: number; meetHours10: number; branding: boolean } } | null;
  mrr: number;
  state: State;
  after?: number;
  people: number;
  guests: number;
  projects: number;
  owner: { id: string; name: string; email: string } | null;
  lastActive: string | null;
  aiRp: number;
  aiIncludedUses: number;
  storageBytes: number;
  since: string | null;
  suspended: { at: string; by: string; reason: string } | null;
  industry: string | null;
  domains: string[];
}
export interface PersonRow {
  id: string;
  name: string;
  email: string;
  title: string;
  color: string;
  photo: boolean;
  companies: { id: string; name: string; role: string }[];
  guestOf: string | string[] | null;
  lastSeen: string | null;
  hasLogin: boolean;
  suspended: { at: string; by: string; reason: string } | null;
  operator: boolean;
}
export const STATE_LABEL: Record<State, string> = { free: 'Free', trial: 'Trial', paused: 'Paused', comp: 'Free months', paying: 'Paying', suspended: 'Suspended' };
export const planLabel = (p: CompanyRow['plan']) => (!p || p.tier === 'free' ? 'Free' : `${p.tier[0].toUpperCase()}${p.tier.slice(1)}${p.track === 'ai' ? ' AI' : ''}${p.cycle === 'yearly' ? ', yearly' : ''}`);
