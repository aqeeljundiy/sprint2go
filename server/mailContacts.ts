// Contacts (Mail, Contacts): each person's own address book in a company, like Google Contacts.
//  - Saved contacts: names, several emails and phones, company, title, notes and labels (groups), added by hand,
//    from someone you've emailed, or imported from a vCard (.vcf) or CSV file (Google, Outlook or Apple exports).
//  - Everyone you've emailed ("other contacts"): worked out from the mail you can open, with how often you wrote to
//    them, so compose suggests the people you write to most first.
//  - The team: the company's people.
//  - Duplicates (the same email, or the same name) are found and can be merged into one.
// Kept per person and company in their own table; nobody else sees someone's contacts.
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { mark } from '../src/i18n/index.ts';

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_contacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS mail_contacts_user ON mail_contacts (user_id, workspace_id);
`);

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
const MAX_CONTACTS = 20_000;
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const isEmail = (s: string) => /^[^\s@<>"(),;:]{1,64}@[^\s@<>"(),;:]{1,200}\.[a-z]{2,}$/i.test(s);
const str = (v: unknown, n: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);

/** A contact as asked, cleaned. Null when it has neither a name nor an email. */
export function cleanContact(raw: any, old?: Contact, now = new Date().toISOString()): Contact | null {
  const emails = [...new Set((Array.isArray(raw?.emails) ? raw.emails : [raw?.email]).map(lower).filter(isEmail))].slice(0, 10) as string[];
  const phones = [...new Set((Array.isArray(raw?.phones) ? raw.phones : [raw?.phone]).map((p: unknown) => str(p, 40)).filter((p: string) => /\d{3}/.test(p)))].slice(0, 10) as string[];
  const name = str(raw?.name, 120) || (emails[0] ? emails[0].split('@')[0] : '');
  if (!name && !emails.length) return null;
  const labels = [...new Set((Array.isArray(raw?.labels) ? raw.labels : []).map((l: unknown) => str(l, 40)).filter(Boolean))].slice(0, 20) as string[];
  return {
    id: old?.id ?? (typeof raw?.id === 'string' && /^ct-[a-f0-9]{12}$/.test(raw.id) ? raw.id : `ct-${randomBytes(6).toString('hex')}`),
    name,
    emails,
    phones,
    company: str(raw?.company, 120) || undefined,
    title: str(raw?.title, 120) || undefined,
    notes: String(raw?.notes ?? '').trim().slice(0, 4000) || undefined,
    labels,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
}

export const list = (userId: string, wsId: string): Contact[] => (db.db.prepare('SELECT data FROM mail_contacts WHERE user_id = ? AND workspace_id = ? ORDER BY updated_at DESC').all(userId, wsId) as { data: string }[]).map((r) => JSON.parse(r.data)).sort((a: Contact, b: Contact) => a.name.localeCompare(b.name));
const getOne = (userId: string, wsId: string, id: string) => {
  const r = db.db.prepare('SELECT data FROM mail_contacts WHERE id = ? AND user_id = ? AND workspace_id = ?').get(id, userId, wsId) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as Contact) : undefined;
};
const put = (userId: string, wsId: string, c: Contact) => db.db.prepare('INSERT INTO mail_contacts (id, user_id, workspace_id, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(c.id, userId, wsId, JSON.stringify(c), c.updatedAt);
const count = (userId: string, wsId: string) => (db.db.prepare('SELECT COUNT(*) AS n FROM mail_contacts WHERE user_id = ? AND workspace_id = ?').get(userId, wsId) as { n: number }).n;

export class ContactError extends Error {}

export function save(userId: string, wsId: string, raw: any): Contact {
  const old = typeof raw?.id === 'string' ? getOne(userId, wsId, raw.id) : undefined;
  const c = cleanContact(raw, old);
  if (!c) throw new ContactError(mark('Give the contact a name or an email.'));
  if (!old && count(userId, wsId) >= MAX_CONTACTS) throw new ContactError(mark('You have as many contacts as one person can keep. Remove some first.'));
  put(userId, wsId, c);
  return c;
}
export function remove(userId: string, wsId: string, ids: string[]) {
  const del = db.db.prepare('DELETE FROM mail_contacts WHERE id = ? AND user_id = ? AND workspace_id = ?');
  return ids.slice(0, 5000).reduce((n, id) => n + Number(del.run(String(id), userId, wsId).changes), 0);
}

/** Several contacts into the first: every email, phone and label kept, the longest name, notes joined. */
export function merge(userId: string, wsId: string, ids: string[]): Contact {
  const all = ids.map((id) => getOne(userId, wsId, String(id))).filter(Boolean) as Contact[];
  if (all.length < 2) throw new ContactError(mark('Pick at least two contacts to merge.'));
  const [first, ...rest] = all;
  const merged = cleanContact({
    ...first,
    name: all.map((c) => c.name).sort((a, b) => b.length - a.length)[0],
    emails: all.flatMap((c) => c.emails),
    phones: all.flatMap((c) => c.phones),
    company: all.find((c) => c.company)?.company,
    title: all.find((c) => c.title)?.title,
    notes: all.map((c) => c.notes).filter(Boolean).join('\n\n'),
    labels: all.flatMap((c) => c.labels),
  }, first)!;
  put(userId, wsId, merged);
  remove(userId, wsId, rest.map((c) => c.id));
  return merged;
}

/** Groups of contacts that look like the same person: a shared email, or the same name. */
export function duplicates(contacts: Contact[]): string[][] {
  const parent = new Map(contacts.map((c) => [c.id, c.id]));
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  const join = (a: string, b: string) => parent.set(find(a), find(b));
  const byKey = new Map<string, string>();
  for (const c of contacts)
    for (const k of [...c.emails.map((e) => `e:${e}`), ...(c.name.trim().split(/\s+/).length > 1 ? [`n:${c.name.toLowerCase().replace(/\s+/g, ' ').trim()}`] : [])]) {
      const had = byKey.get(k);
      if (had) join(had, c.id);
      else byKey.set(k, c.id);
    }
  const groups = new Map<string, string[]>();
  for (const c of contacts) (groups.get(find(c.id)) ?? groups.set(find(c.id), []).get(find(c.id))!).push(c.id);
  return [...groups.values()].filter((g) => g.length > 1);
}

/* ---------- everyone you've emailed ---------- */

export interface Frequent {
  name: string;
  email: string;
  sent: number; // emails you wrote to them
  received: number; // emails from them
  lastAt: string;
}
/**
 * People in the mail of these mailboxes (yours and the ones you open), most written-to first. `mine` are your own
 * addresses (they're left out).
 */
export function frequent(accountIds: string[], mine: Set<string>, limit = 2000): Frequent[] {
  const map = new Map<string, Frequent>();
  const q = db.db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND json_extract(data, '$.accountId') = ?");
  for (const id of accountIds)
    for (const r of q.all(id) as { data: string }[]) {
      const t = JSON.parse(r.data);
      if (t.location === 'spam' || t.location === 'trash') continue;
      for (const m of t.messages ?? []) {
        const from = lower(m.from?.email);
        const out = mine.has(from);
        const people = out ? [...(m.to ?? []), ...(m.bcc ?? [])] : [m.from];
        for (const p of people) {
          const e = lower(p?.email);
          if (!isEmail(e) || mine.has(e) || /^(no-?reply|mailer-daemon|postmaster|notifications?)@/.test(e)) continue;
          const f = map.get(e) ?? { name: '', email: e, sent: 0, received: 0, lastAt: '' };
          if (p?.name && p.name !== e.split('@')[0] && !f.name) f.name = String(p.name).slice(0, 120);
          if (out) f.sent++;
          else f.received++;
          if (typeof m.date === 'string' && m.date > f.lastAt) f.lastAt = m.date;
          map.set(e, f);
        }
      }
    }
  return [...map.values()]
    .map((f) => ({ ...f, name: f.name || f.email.split('@')[0] }))
    .sort((a, b) => b.sent * 3 + b.received - (a.sent * 3 + a.received) || b.lastAt.localeCompare(a.lastAt))
    .slice(0, limit);
}

/* ---------- vCard ---------- */

const unfold = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
const vUnescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const vEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
/** Quoted-printable values (old Outlook and Android exports). */
const qp = (s: string) => Buffer.from(s.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');

export function parseVcf(text: string): any[] {
  const out: any[] = [];
  for (const card of unfold(text).split(/^BEGIN:VCARD\s*$/im).slice(1)) {
    const body = card.split(/^END:VCARD\s*$/im)[0];
    const c: any = { emails: [], phones: [], labels: [] };
    for (const line of body.split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const head = line.slice(0, i);
      let value = line.slice(i + 1).trim();
      const [rawKey, ...params] = head.split(';');
      const key = rawKey.replace(/^item\d+\./i, '').toUpperCase();
      if (params.some((p) => /ENCODING=QUOTED-PRINTABLE/i.test(p))) value = qp(value);
      value = vUnescape(value);
      if (key === 'FN') c.name = value;
      else if (key === 'N' && !c.name) c.name = value.split(';').slice(0, 2).reverse().filter(Boolean).join(' ').trim();
      else if (key === 'EMAIL') c.emails.push(value);
      else if (key === 'TEL') c.phones.push(value);
      else if (key === 'ORG') c.company = value.split(';')[0];
      else if (key === 'TITLE') c.title = value;
      else if (key === 'NOTE') c.notes = value;
      else if (key === 'CATEGORIES') c.labels.push(...value.split(',').map((x) => x.trim()).filter((x) => x && !/^myContacts$|^starred$/i.test(x)));
    }
    out.push(c);
  }
  return out;
}
export function toVcf(list: Contact[]) {
  return list
    .map((c) =>
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${vEscape(c.name)}`,
        `N:${vEscape(c.name.split(' ').slice(1).join(' '))};${vEscape(c.name.split(' ')[0] ?? '')};;;`,
        ...c.emails.map((e, i) => `EMAIL;TYPE=INTERNET${i === 0 ? ',PREF' : ''}:${e}`),
        ...c.phones.map((p) => `TEL:${vEscape(p)}`),
        ...(c.company ? [`ORG:${vEscape(c.company)}`] : []),
        ...(c.title ? [`TITLE:${vEscape(c.title)}`] : []),
        ...(c.notes ? [`NOTE:${vEscape(c.notes)}`] : []),
        ...(c.labels.length ? [`CATEGORIES:${c.labels.map((l) => l.replace(/[,;\\]/g, ' ')).join(',')}`] : []),
        'END:VCARD',
      ].join('\r\n'),
    )
    .join('\r\n');
}

/* ---------- CSV (Google Contacts, Outlook, or a plain sheet) ---------- */

export function parseCsvRows(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  // The separator is whatever the header row uses most: commas, or semicolons and tabs (Excel in some countries).
  const firstLine = s.slice(0, s.search(/\r?\n|$/));
  const sep = ([',', ';', '\t'] as const).map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string): any[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: (string | RegExp)[]) => head.map((h, i) => (names.some((n) => (typeof n === 'string' ? h === n : n.test(h))) ? i : -1)).filter((i) => i >= 0);
  const name = col('name', 'full name', 'display name', 'nama');
  const first = col('first name', 'given name');
  const middle = col('middle name', 'additional name');
  const last = col('last name', 'family name', 'surname');
  const emails = col(/^e-?mail( address)?( \d+)?( - value)?$/, /^e-?mail \d+ - value$/, 'email');
  const phones = col(/^(phone|mobile phone|business phone|home phone|primary phone)( \d+)?( - value)?$/, /^phone \d+ - value$/, 'telepon');
  const company = col('company', 'organization 1 - name', 'organization name', 'organization');
  const title = col('job title', 'title', 'organization 1 - title');
  const notes = col('notes', 'note');
  const labels = col('labels', 'group membership', 'categories');
  const get = (r: string[], idx: number[]) => idx.map((i) => (r[i] ?? '').trim()).filter(Boolean);
  return rows.slice(1).map((r) => ({
    name: get(r, name)[0] || [get(r, first)[0], get(r, middle)[0], get(r, last)[0]].filter(Boolean).join(' '),
    emails: get(r, emails).flatMap((e) => e.split(/\s*:::\s*|\s*;\s*/)),
    phones: get(r, phones).flatMap((p) => p.split(/\s*:::\s*/)),
    company: get(r, company)[0],
    title: get(r, title)[0],
    notes: get(r, notes)[0],
    labels: get(r, labels)
      .flatMap((l) => l.split(/\s*:::\s*|\s*;\s*/))
      .map((l) => l.replace(/^\* /, ''))
      .filter((l) => l && !/^myContacts$|^starred$/i.test(l)),
  }));
}
const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function toCsv(list: Contact[]) {
  const head = ['Name', 'E-mail 1 - Value', 'E-mail 2 - Value', 'Phone 1 - Value', 'Phone 2 - Value', 'Organization 1 - Name', 'Organization 1 - Title', 'Notes', 'Labels'];
  const rows = list.map((c) => [c.name, c.emails[0] ?? '', c.emails.slice(1).join(' ::: '), c.phones[0] ?? '', c.phones.slice(1).join(' ::: '), c.company ?? '', c.title ?? '', c.notes ?? '', c.labels.join(' ::: ')].map(csvCell).join(','));
  return '\uFEFF' + [head.join(','), ...rows].join('\r\n');
}

/**
 * Imported contacts: one already here with the same email takes the new details (nothing it had is lost); the rest
 * are added. `label`: put on every imported contact. Returns how many were added and updated.
 */
export function importContacts(userId: string, wsId: string, raws: any[], label?: string) {
  const have = list(userId, wsId);
  const byEmail = new Map<string, Contact>();
  for (const c of have) for (const e of c.emails) byEmail.set(e, c);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  db.db.exec('BEGIN');
  try {
    for (const raw of raws.slice(0, MAX_CONTACTS)) {
      const fresh = cleanContact({ ...raw, labels: [...(raw.labels ?? []), ...(label ? [label] : [])] });
      if (!fresh) {
        skipped++;
        continue;
      }
      const old = fresh.emails.map((e) => byEmail.get(e)).find(Boolean);
      if (old) {
        const merged = cleanContact({ ...old, name: old.name || fresh.name, emails: [...old.emails, ...fresh.emails], phones: [...old.phones, ...fresh.phones], company: old.company || fresh.company, title: old.title || fresh.title, notes: [old.notes, fresh.notes].filter(Boolean).filter((x, i, l) => l.indexOf(x) === i).join('\n\n'), labels: [...old.labels, ...fresh.labels] }, old)!;
        put(userId, wsId, merged);
        for (const e of merged.emails) byEmail.set(e, merged);
        updated++;
      } else {
        if (have.length + added >= MAX_CONTACTS) break;
        put(userId, wsId, fresh);
        for (const e of fresh.emails) byEmail.set(e, fresh);
        added++;
      }
    }
    db.db.exec('COMMIT');
  } catch (e) {
    db.db.exec('ROLLBACK');
    throw e;
  }
  return { added, updated, skipped };
}
