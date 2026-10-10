// Mail for teams: the app's side of /api/mail/... (server/mailPlus.ts). Each call answers with the server's data or
// throws an Error with the server's words (already in the reader's language) or a plain fallback.
import type { MailDelegate, MailGroup, MailPolicy } from '../../types';
import { t } from '../../i18n';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error(t('There’s no connection. Try again when you’re back online.'));
  }
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(d.error ? t(d.error) : t('Something went wrong. Try again.')), { status: r.status, data: d });
  return d;
}
export const getJson = <T>(path: string) => call<T>('GET', path);
export const postJson = <T>(path: string, body: unknown) => call<T>('POST', path, body);

export type Keep = 'keep' | 'read' | 'archive' | 'trash';
export interface Forwarding {
  addresses: { address: string; verified: boolean; addedAt: string; waiting: boolean }[];
  on: boolean;
  address: string | null;
  keep: Keep;
  blocked: boolean;
}
export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  accountId: string | null;
  detail: string | null;
}
export interface AccessInfo {
  mailboxes: { id: string; email: string; name: string; kind: 'personal' | 'shared'; mine: boolean; delegable: boolean; delegates: MailDelegate[]; forwarding: Forwarding | null; held: boolean }[];
  delegatedToMe: { id: string; email: string; name: string; owners: string[]; send: 'as' | 'behalf' }[];
  pop: { on: boolean; missing: 'switch' | 'certificate' | 'ports' | null; ports: { pop3: number; pop3s: number }; host: string; prefs: { on: boolean; after: Keep; since: string | null } };
  forwardOutside: boolean;
  domains: string[];
  log: AuditEntry[];
}
export const loadAccess = (wsId: string) => getJson<AccessInfo>(`/api/mail/access?ws=${encodeURIComponent(wsId)}`);

export interface GroupsInfo {
  groups: MailGroup[];
  admin: boolean;
  domains: string[];
  hosted: boolean;
}
export const loadGroups = (wsId: string) => getJson<GroupsInfo>(`/api/mail/groups?ws=${encodeURIComponent(wsId)}`);
export const saveGroups = (wsId: string, groups: Partial<MailGroup>[]) => postJson<{ groups: MailGroup[] }>('/api/mail/groups', { workspaceId: wsId, groups });

export const loadPolicy = (wsId: string) => getJson<{ policy: MailPolicy; log: AuditEntry[]; noticeDays: number }>(`/api/mail/policy?ws=${encodeURIComponent(wsId)}`);
export const savePolicy = (wsId: string, policy: MailPolicy) => postJson<{ policy: MailPolicy; log: AuditEntry[] }>('/api/mail/policy', { workspaceId: wsId, policy });

export interface StorageInfo {
  mailboxes: { id: string; email: string; bytes: number; attachments: number }[];
  total: number;
  largest: { threadId: string; accountId: string; subject: string; from: string; date: string; bytes: number; location: string }[];
  attachments: { threadId: string; accountId: string; name: string; bytes: number; subject: string; date: string }[];
  spam: { count: number; bytes: number };
  trash: { count: number; bytes: number };
  company: { used: number; total: number; mail: number };
  held: string[];
}
export const loadStorage = (wsId: string) => getJson<StorageInfo>(`/api/mail/storage?ws=${encodeURIComponent(wsId)}`);

export interface Contact {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  company?: string;
  title?: string;
  notes?: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Frequent {
  name: string;
  email: string;
  sent: number;
  received: number;
  lastAt: string;
}
export interface ContactsInfo {
  contacts: Contact[];
  frequent: Frequent[];
  team: { userId: string; name: string; email: string; title: string }[];
  duplicates: string[][];
}
export const loadContacts = (wsId: string) => getJson<ContactsInfo>(`/api/mail/contacts?ws=${encodeURIComponent(wsId)}`);

/** What the server says about an email the company's data loss rules stopped (from /api/mail/send's 409). */
export interface DlpStop {
  action: 'warn' | 'block';
  rules: { id: string; name: string; kind: 'card' | 'nik' | 'words' }[];
}
/** The data loss rules' answer in a sentence, in the reader's language. */
export function dlpWords(d: DlpStop): string {
  const kinds = [...new Set(d.rules.map((r) => r.kind))];
  const what = kinds.map((k) => (k === 'card' ? t('card numbers') : k === 'nik' ? t('NIK (KTP) numbers') : t('words your company flags')));
  const list = what.length > 1 ? t('{a} and {b}', { a: what.slice(0, -1).join(', '), b: what[what.length - 1] }) : what[0];
  return d.action === 'block' ? t('This email can’t be sent: it looks like it has {what}, which your company doesn’t allow in email.', { what: list }) : t('This email looks like it has {what}. Check it before it goes.', { what: list });
}
