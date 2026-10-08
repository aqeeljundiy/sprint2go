// Who a mail domain belongs to. A domain belongs to one company: only that company receives and sends mail for it here,
// and only it gets the domain's DKIM key. The first company that claimed a domain holds it (that's how it always
// worked, so nothing live changes) until a company proves control of its DNS:
//  - the domain's MX points to this server, or its s2g._domainkey record has the key we gave that company (only the
//    company holding the domain can prove it this way), or
//  - a TXT record "sprint2go-verify=<token>" with the company's own token (any company can, which is how the rightful
//    owner takes over a domain someone else claimed first).
// A verified domain stays with its company; another company that adds it sees "Another company uses this domain".
import { generateKeyPairSync } from 'node:crypto';
import * as db from './db.ts';

db.db.exec('CREATE TABLE IF NOT EXISTS mail_domains (domain TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, selector TEXT NOT NULL, private_key TEXT NOT NULL, public_key TEXT NOT NULL, created_at TEXT NOT NULL);');
// Added later: who proved control, and how. Only added when missing, so older databases keep their rows.
{
  const cols = new Set((db.db.prepare('PRAGMA table_info(mail_domains)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('verified_at')) db.db.exec('ALTER TABLE mail_domains ADD COLUMN verified_at TEXT');
  if (!cols.has('verified_how')) db.db.exec('ALTER TABLE mail_domains ADD COLUMN verified_how TEXT');
}

const SELECTOR = 's2g';
const lower = (s: string) => String(s ?? '').trim().toLowerCase();
const now = () => new Date().toISOString();

type Acct = { email?: string; provider?: string; temp?: boolean };
export type DomainWs = { id: string; domains?: string[]; accounts?: Acct[] };
type Row = { domain: string; workspace_id: string; selector: string; private_key: string; public_key: string; verified_at: string | null; verified_how: string | null };
const rowOf = (d: string) => db.db.prepare('SELECT * FROM mail_domains WHERE domain = ?').get(lower(d)) as Row | undefined;
const allWs = () => db.allDocs('workspaces') as unknown as DomainWs[];

/** A company claims a domain by listing it, or by hosting a mailbox at it here. */
export function claims(ws: DomainWs | undefined, domain: string) {
  if (!ws) return false;
  const d = lower(domain);
  return (ws.domains ?? []).some((x) => lower(x) === d) || (ws.accounts ?? []).some((a) => !!a.email && !a.temp && (!a.provider || a.provider === 'sprint2go') && lower(a.email.split('@')[1] ?? '') === d);
}

export interface Owner {
  id: string;
  verifiedAt: string | null;
  how: string | null;
}
/**
 * Who holds a domain now: the company in its row (it got the key, and maybe proved control) while it still claims the
 * domain, else the first company that claims it. Null when nobody does.
 */
export function ownerOf(domain: string, wss: DomainWs[] = allWs()): Owner | null {
  const d = lower(domain);
  const row = rowOf(d);
  if (row && claims(wss.find((w) => w.id === row.workspace_id), d)) return { id: row.workspace_id, verifiedAt: row.verified_at, how: row.verified_how };
  const first = wss.find((w) => claims(w, d));
  return first ? { id: first.id, verifiedAt: null, how: null } : null;
}
/** Owners of many domains at once (the inbound address map asks for every domain on each message). */
export function ownersMap(wss: DomainWs[] = allWs()) {
  const cache = new Map<string, Owner | null>();
  return (domain: string) => {
    const d = lower(domain);
    if (!cache.has(d)) cache.set(d, ownerOf(d, wss));
    return cache.get(d)!;
  };
}

/** This company's own token for the TXT record that proves a domain is theirs. Only this server can make it. */
export const verifyToken = (workspaceId: string, domain: string) => db.keyedHash(`domain-verify:${workspaceId}:${lower(domain)}`).slice(0, 32);
export const verifyRecord = (workspaceId: string, domain: string) => `sprint2go-verify=${verifyToken(workspaceId, domain)}`;

export type OwnershipState = 'verified' | 'pending' | 'held' | 'taken';
export interface Ownership {
  domain: string;
  /** verified: proven ours. pending: ours (claimed first), not proven yet. held: another company claimed it first, not proven. taken: another company proved it. */
  state: OwnershipState;
  at: string | null;
  how: string | null;
  record: { type: 'TXT'; host: '@'; value: string };
}
export function ownership(ws: DomainWs, domain: string, wss: DomainWs[] = allWs()): Ownership {
  const d = lower(domain);
  const o = ownerOf(d, wss.some((w) => w.id === ws.id) ? wss : [...wss, ws]);
  const record = { type: 'TXT' as const, host: '@' as const, value: verifyRecord(ws.id, d) };
  if (!o || o.id === ws.id) return { domain: d, state: o?.verifiedAt ? 'verified' : 'pending', at: o?.verifiedAt ?? null, how: o?.how ?? null, record };
  return { domain: d, state: o.verifiedAt ? 'taken' : 'held', at: null, how: null, record };
}
/** Whether this company may receive and send for the domain right now. */
export const mayUse = (ws: DomainWs, domain: string, wss?: DomainWs[]) => {
  const s = ownership(ws, domain, wss).state;
  return s === 'verified' || s === 'pending';
};

/**
 * The domain's DKIM key, made the first time it's asked for. The key belongs to the domain's holder; a company that
 * doesn't hold the domain never gets it (callers check `mayUse` first), and the platform signs its own mail with it.
 */
export function domainKey(domain: string, workspaceId: string) {
  const d = lower(domain);
  let row = rowOf(d);
  if (!row) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const holder = ownerOf(d)?.id ?? workspaceId;
    db.db.prepare('INSERT INTO mail_domains (domain, workspace_id, selector, private_key, public_key, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(d, holder, SELECTOR, db.seal(privateKey), publicKey.toString('base64'), now());
    row = rowOf(d)!;
  }
  return { selector: row.selector, privateKey: db.unseal(row.private_key), publicKey: row.public_key };
}

/** What the domain's DNS shows, as read by the record check or the readiness check. */
export interface Proof {
  mxHere: boolean; // its first MX is this server
  dkim: string; // the s2g._domainkey TXT record ('' when none)
  txt: string[]; // the TXT records at the domain itself
}
/**
 * Settles who holds a domain from what its DNS shows, and saves a proof. Returns this company's ownership after.
 * Never takes a verified domain away from its company unless another company's own token is there and theirs isn't.
 */
export function settle(ws: DomainWs, domain: string, proof: Proof): Ownership {
  const d = lower(domain);
  const wss = allWs();
  const cur = ownership(ws, d, wss);
  if (cur.state === 'verified' || !claims(ws, d)) return cur;
  const hasToken = (id: string) => proof.txt.some((t) => t.replace(/\s/g, '') === verifyRecord(id, d));
  const mine = hasToken(ws.id);
  let how: string | null = null;
  if (cur.state === 'pending') {
    // Pending means the key is this company's: it holds the row, or the row's company no longer claims the domain.
    const row = rowOf(d);
    const dkimOk = !!row && proof.dkim.replace(/\s/g, '').includes(`p=${row.public_key}`);
    how = mine ? 'txt' : proof.mxHere ? 'mx' : dkimOk ? 'dkim' : null;
  } else if (mine) {
    // Another company holds it. Our own token takes it over, unless it was proven theirs and their token is there too.
    const holder = ownerOf(d, wss);
    if (cur.state === 'held' || !holder || !hasToken(holder.id)) how = 'txt';
  }
  if (!how) return cur;
  domainKey(d, ws.id); // makes sure the row exists
  db.db.prepare('UPDATE mail_domains SET workspace_id = ?, verified_at = ?, verified_how = ? WHERE domain = ?').run(ws.id, now(), how, d);
  return ownership(ws, d);
}
