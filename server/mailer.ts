// sprint2go's own mail engine: receives mail for the companies' addresses over SMTP, sends their mail straight to the
// world (signed with DKIM) or, when a company chose "Boosted sending", through Amazon on our account. Everything lands in
// the same `threads` documents the Mail app already uses, so the app needs no second store.
//
// Env: MAIL_HOST (this server's mail name, default: the app's host), MAIL_IP (its public address, for the PTR check),
// MAIL_PORT (inbound SMTP, default 25 in production and 2525 otherwise), MAIL_RELAY_URL (optional smtp:// relay for the
// "own" route), MAIL_TLS_KEY / MAIL_TLS_CERT or CF_DNS_TOKEN for a trusted certificate (see server/mailcert.ts).
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { authenticate, dkimSign } from 'mailauth';
import { promises as dns } from 'node:dns';
import { connect, isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { mailConfigured, sendMail, sendRaw, sesIdentity } from './mail.ts';
import { domainKey, mayUse, ownership, ownersMap, settle as settleDomain, type Ownership } from './domains.ts';
import { loadTls, onCertChange, startCertKeeper } from './mailcert.ts';
import { applyInbound, readInvite } from './invites.ts';
import { maybeAnswer, type Away } from './away.ts';
export { domainKey };

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_domains (domain TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, selector TEXT NOT NULL, private_key TEXT NOT NULL, public_key TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT, thread_id TEXT, message_id TEXT, route TEXT NOT NULL, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, raw BLOB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS outbox_due ON outbox (state, next_at);
  CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, direction TEXT NOT NULL, route TEXT, addr TEXT, bytes INTEGER, state TEXT, error TEXT, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS mail_log_ws ON mail_log (workspace_id, at);
`);

type Person = { name: string; email: string };
type Account = { id: string; email: string; name: string; kind: string; users: string[]; provider?: string; connected?: boolean; away?: Away };
type Alias = { id: string; address: string; to: string[] };
type Ws = { id: string; name: string; domains?: string[]; accounts?: Account[]; members: { userId: string; role: string }[]; emailSetup?: string; emailProvider?: string; mailRoute?: 'own' | 'boosted'; mailCredits?: number; mailCreditsNotified?: boolean; mailAliases?: Alias[] };

export interface MailerDeps {
  publicUrl: string;
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
  notify: (userIds: string[], workspaceId: string, text: string, link?: string) => void;
  log: (line: string) => void;
}
let deps: MailerDeps;
const production = process.env.NODE_ENV === 'production';
export const MAIL_HOST = (process.env.MAIL_HOST ?? (process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).hostname : 'localhost')).toLowerCase();
export const MAIL_IP = process.env.MAIL_IP ?? '';
const MAIL_PORT = Number(process.env.MAIL_PORT ?? (production ? 25 : 2525));
const SELECTOR = 's2g';
const MAX_SIZE = 25 * 1024 * 1024;
const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const now = () => new Date().toISOString();
const lower = (s: string) => String(s ?? '').trim().toLowerCase();

/* ---------- who has which address ---------- */

const workspaces = () => db.allDocs('workspaces') as unknown as Ws[];
/**
 * Every mailbox on this server, by address. A domain's addresses belong only to the company that holds the domain
 * (server/domains.ts); an address at our own name stays with the company that had it first.
 */
export function localAccounts() {
  const map = new Map<string, { ws: Ws; account: Account; alias?: { address: string; accounts: Account[] } }>();
  const all = workspaces();
  const owner = ownersMap(all);
  for (const ws of all) {
    const slug = lower(ws.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
    for (const a of ws.accounts ?? []) {
      if (!a.email) continue;
      const addr = lower(a.email);
      const domain = addr.split('@')[1] ?? '';
      if (!a.provider || a.provider === 'sprint2go') {
        if (domain === MAIL_HOST ? map.has(addr) : owner(domain)?.id !== ws.id) continue;
        map.set(addr, { ws, account: a });
      }
      // A mailbox that stays with Google or Microsoft gets a forwarding address here: a copy of its mail lands in the app.
      // A shared address (gmail.com) has no holder; a company domain's copies go to the company that holds it.
      else {
        const holder = owner(domain);
        if (holder && holder.id !== ws.id) continue;
        map.set(`${addr.split('@')[0]}.${slug}@${MAIL_HOST}`, { ws, account: a });
      }
    }
    // Aliases: another address at the company's domain that delivers into one or more of its mailboxes here.
    for (const al of ws.mailAliases ?? []) {
      const addr = lower(al.address);
      const boxes = (ws.accounts ?? []).filter((a) => al.to?.includes(a.id) && a.email && (!a.provider || a.provider === 'sprint2go'));
      const aliasDomain = addr.split('@')[1] ?? '';
      if (boxes.length && (ws.domains ?? []).map(lower).includes(aliasDomain) && owner(aliasDomain)?.id === ws.id && !map.has(addr)) map.set(addr, { ws, account: boxes[0], alias: { address: addr, accounts: boxes } });
    }
  }
  return map;
}
export const accountFor = (email: string) => localAccounts().get(lower(email)) ?? null;

/** Addresses that become support tickets instead of landing in a mailbox. */
export const SUPPORT_EMAIL = lower(process.env.SUPPORT_EMAIL ?? `support@${MAIL_HOST}`);
export const supportAddresses = () => [SUPPORT_EMAIL, `abuse@${MAIL_HOST}`, `postmaster@${MAIL_HOST}`];
export type SupportMail = { to: string; parsed: ParsedMail; mid: string; refs: string[]; spam: boolean; attachments: { name: string; url: string; size: string }[] };
let supportHandler: ((m: SupportMail) => Promise<void>) | null = null;
export const onSupportMail = (fn: (m: SupportMail) => Promise<void>) => (supportHandler = fn);
/** The company's own mail domain (its first domain), else addresses live at this server's name. */
export const mailDomainOf = (ws: Ws) => lower(ws.domains?.[0] ?? '') || MAIL_HOST;
export const boostedAvailable = () => mailConfigured();

/* ---------- DKIM keys, one per domain (kept with who holds the domain, in server/domains.ts) ---------- */

export const dkimRecord = (domain: string, workspaceId: string) => `v=DKIM1; k=rsa; p=${domainKey(domain, workspaceId).publicKey}`;

/* ---------- the DNS records a company needs, and whether they're there ---------- */

export interface DnsRecord {
  type: 'MX' | 'TXT' | 'CNAME';
  host: string;
  value: string;
  note: string;
  key: string; // which check it belongs to
}
/** The SPF include each provider publishes, for companies whose mail also goes out from Google, Microsoft or Zoho. */
const PROVIDER_SPF: Record<string, string> = { google: 'include:_spf.google.com', microsoft: 'include:spf.protection.outlook.com', zoho: 'include:zohomail.com' };
const PROVIDER_NAME: Record<string, string> = { google: 'Google Workspace', microsoft: 'Microsoft 365', zoho: 'Zoho Mail' };
/** The part of the SPF record that lets mail from here through: our address, or Amazon's when sending is Boosted. */
const spfOurs = (route: 'own' | 'boosted') => (route === 'boosted' ? 'include:amazonses.com' : MAIL_IP ? `ip4:${MAIL_IP}` : `a:${MAIL_HOST}`);
/** Whether an SPF record lists a mechanism as a pass, whatever else is in it (ip4:1.2.3.4 also matches ip4:1.2.3.4/32). */
const spfHas = (spf: string, want: string) => {
  const w = want.toLowerCase();
  return spf.toLowerCase().split(/\s+/).some((t) => {
    const m = t.replace(/^\+/, '');
    return m === w || m === `${w}/32`;
  });
};
/** A domain must have exactly one SPF record; with two, receivers treat it as broken. */
const spfRecords = (all: string[]) => all.filter((t) => /^v=spf1(\s|$)/i.test(t.trim()));

/** The record that proves a domain is this company's, while another company holds it. */
const takeoverRecord = (own: Ownership): DnsRecord => ({
  type: 'TXT',
  host: '@',
  value: own.record.value,
  note: `Proves ${own.domain} is yours: once it’s there, the domain moves to you and the other records show here. Keep it afterwards.`,
  key: 'verify',
});

export async function expectedRecords(ws: Ws): Promise<DnsRecord[]> {
  const domain = mailDomainOf(ws);
  if (domain === MAIL_HOST) return []; // addresses at our own name need nothing
  const own = ownership(ws, domain);
  if (own.state === 'held' || own.state === 'taken') return [takeoverRecord(own)];
  const mode = ws.emailSetup ?? 'none';
  const route = ws.mailRoute ?? 'own';
  const out: DnsRecord[] = [];
  if (mode === 'hosted') out.push({ type: 'MX', host: '@', value: MAIL_HOST, note: 'Priority 10. Mail for the domain comes here.', key: 'mx' });
  if (mode === 'mix') out.push({ type: 'MX', host: '@', value: '(stays with your provider)', note: 'Your provider keeps the MX and passes unknown addresses to ' + MAIL_HOST + ' (see the routing steps).', key: 'mx' });
  const ours = spfOurs(route);
  const shared = mode === 'mix' || mode === 'keep';
  const provider = ws.emailProvider || 'google';
  const theirs = shared ? PROVIDER_SPF[provider] : undefined;
  if (theirs)
    out.push({ type: 'TXT', host: '@', value: `v=spf1 ${theirs} ${ours} ~all`, note: `Lets ${PROVIDER_NAME[provider]} and us send as ${domain}. A domain has one SPF record: if ${domain} already has one, change it to this and keep any other include: it lists.`, key: 'spf' });
  else if (shared)
    out.push({ type: 'TXT', host: '@', value: `v=spf1 ${ours} ~all`, note: `Your mail provider most likely has an SPF record for ${domain} already. Don’t add a second one: put ${ours} into it, before the ~all or -all.`, key: 'spf' });
  else out.push({ type: 'TXT', host: '@', value: `v=spf1 ${ours} ~all`, note: 'Who may send as your domain. Merge with an SPF record you already have.', key: 'spf' });
  if (route === 'boosted') {
    const ses = await sesIdentity(domain).catch(() => null);
    for (const t of ses?.tokens ?? []) out.push({ type: 'CNAME', host: `${t}._domainkey`, value: `${t}.dkim.amazonses.com`, note: 'Signs mail sent through Boosted sending.', key: 'dkim' });
    if (!ses?.tokens?.length) out.push({ type: 'CNAME', host: '(3 records)', value: 'given once Amazon knows the domain', note: 'Signs mail sent through Boosted sending.', key: 'dkim' });
  } else out.push({ type: 'TXT', host: `${SELECTOR}._domainkey`, value: dkimRecord(domain, ws.id), note: 'Signs mail sent from sprint2go so Gmail and Outlook trust it.', key: 'dkim' });
  out.push({ type: 'TXT', host: '_dmarc', value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, note: `Tells receivers what to do with mail that fails the checks. If ${domain} already has a DMARC record, keep yours.`, key: 'dmarc' });
  return out;
}

/**
 * Who runs a domain's DNS, from its nameservers: that's where the records go, which is often not the mail provider.
 * `where` is the path to its record editor, as the company's own screens name it. Cached for 10 minutes.
 */
type DnsHost = { name: string; where: string };
const sameHost = (name: string) => (d: string) => `sign in to ${name}, open ${d} and find its DNS records (often called DNS management or Zone editor)`;
const DNS_HOSTS: { re: RegExp; name: string; where: (d: string) => string }[] = [
  { re: /\.ns\.cloudflare\.com$/, name: 'Cloudflare', where: (d) => `dash.cloudflare.com, ${d}, DNS, Records, Add record` },
  { re: /(^|\.)(dns-parking\.com|hostinger\.[a-z.]+)$/, name: 'Hostinger', where: (d) => `hPanel, Domains, ${d}, DNS / Nameservers, DNS records, Add record` },
  { re: /(^|\.)domaincontrol\.com$/, name: 'GoDaddy', where: (d) => `GoDaddy, Domain Portfolio, ${d}, DNS, Add New Record` },
  { re: /(^|\.)registrar-servers\.com$/, name: 'Namecheap', where: (d) => `Namecheap, Domain List, Manage next to ${d}, Advanced DNS, Add New Record` },
  { re: /(^|\.)awsdns-\d+\.(com|net|org|co\.uk)$/, name: 'Amazon Route 53', where: (d) => `the AWS console, Route 53, Hosted zones, ${d}, Create record` },
  { re: /(^|\.)squarespacedns\.com$/, name: 'Squarespace', where: (d) => `Squarespace, Domains, ${d}, DNS, Custom records` },
  { re: /(^|\.)googledomains\.com$/, name: 'Google Cloud DNS or Squarespace', where: (d) => `Squarespace (Domains, ${d}, DNS) if the domain came from Google Domains, otherwise Google Cloud, Cloud DNS, the zone for ${d}` },
  { re: /(^|\.)bdm\.microsoftonline\.com$/, name: 'Microsoft 365', where: (d) => `admin.microsoft.com, Settings, Domains, ${d}, DNS records` },
  { re: /(^|\.)azure-dns\.(com|net|org|info)$/, name: 'Azure DNS', where: (d) => `the Azure portal, DNS zones, ${d}, Recordsets` },
  { re: /(^|\.)digitalocean\.com$/, name: 'DigitalOcean', where: (d) => `DigitalOcean, Networking, Domains, ${d}` },
  { re: /niagahoster/, name: 'Niagahoster', where: sameHost('Niagahoster') },
  { re: /domainesia/, name: 'DomaiNesia', where: sameHost('DomaiNesia') },
  { re: /rumahweb/, name: 'Rumahweb', where: sameHost('Rumahweb') },
  { re: /idcloudhost/, name: 'IDCloudHost', where: sameHost('IDCloudHost') },
  { re: /jagoanhosting/, name: 'Jagoan Hosting', where: sameHost('Jagoan Hosting') },
];
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'or', 'web', 'my', 'go', 'sch', 'gov', 'edu', 'biz']);
const dnsHostCache = new Map<string, { at: number; value: { dnsHost: DnsHost | null; nameservers: string[]; zone: string } }>();
/** `zone` is the domain whose records hold this name (portal.agency.com lives in agency.com's records). */
export async function dnsHostOf(domain: string): Promise<{ dnsHost: DnsHost | null; nameservers: string[]; zone: string }> {
  const d = lower(domain);
  const hit = dnsHostCache.get(d);
  if (hit && hit.at > Date.now() - 10 * 60_000) return hit.value;
  // A subdomain has no nameservers of its own: ask its parents, but never a shared suffix like co.id.
  let name = d;
  let ns: string[] = [];
  for (;;) {
    ns = await pub.resolveNs(name).then((r) => r.map(lower).sort(), () => [] as string[]);
    const labels = name.split('.');
    if (ns.length || labels.length <= 2 || (labels.length === 3 && SECOND_LEVEL.has(labels[1]))) break;
    name = labels.slice(1).join('.');
  }
  const known = DNS_HOSTS.find((h) => ns.some((n) => h.re.test(n.replace(/\.$/, ''))));
  const value = { dnsHost: known ? { name: known.name, where: known.where(name) } : null, nameservers: ns, zone: name };
  dnsHostCache.set(d, { at: Date.now(), value });
  return value;
}

export interface DnsCheck {
  key: string;
  ok: boolean;
  found: string;
  want: string;
}
/** Checks ask public resolvers, not the server's own cache: that's what Gmail and Outlook see, and new records show at once. */
const pub = new dns.Resolver({ timeout: 4000, tries: 2 });
pub.setServers(['1.1.1.1', '8.8.8.8']);
const txt = (host: string) => pub.resolveTxt(host).then((r) => r.map((x) => x.join('')), () => [] as string[]);
export async function checkDomain(ws: Ws): Promise<{ domain: string; at: string; checks: DnsCheck[]; allOk: boolean }> {
  const domain = mailDomainOf(ws);
  const checks: DnsCheck[] = [];
  if (domain === MAIL_HOST) return { domain, at: now(), checks, allOk: true };
  const mode = ws.emailSetup ?? 'none';
  const route = ws.mailRoute ?? 'own';
  const mx = await pub.resolveMx(domain).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => lower(x.exchange)), () => [] as string[]);
  const apex = await txt(domain);
  const rec = (await txt(`${SELECTOR}._domainkey.${domain}`)).find((t) => t.includes('p=')) ?? '';
  // Whose domain is it? The same lookups prove it (MX here, our DKIM key, or the company's verify record).
  const own = settleDomain(ws, domain, { mxHere: mx[0] === MAIL_HOST, dkim: rec, txt: apex });
  if (own.state === 'held' || own.state === 'taken') {
    checks.push({ key: 'verify', ok: false, found: apex.some((t) => t.startsWith('sprint2go-verify=')) ? 'a different sprint2go-verify record' : 'none', want: own.record.value });
    return { domain, at: now(), checks, allOk: false };
  }
  if (mode === 'hosted') checks.push({ key: 'mx', ok: mx[0] === MAIL_HOST, found: mx.join(', ') || 'none', want: MAIL_HOST });
  else if (mode === 'mix' || mode === 'keep') checks.push({ key: 'mx', ok: mx.length > 0 && mx[0] !== MAIL_HOST, found: mx.join(', ') || 'none', want: 'your provider' });
  // Only our part has to be there; whatever else the record lists (the provider's include, a CRM) is theirs to keep.
  const spfs = spfRecords(apex);
  const spf = spfs[0] ?? '';
  const spfWant = spfOurs(route);
  const spfUs = spfHas(spf, spfWant) || (route === 'own' && !!MAIL_IP && spfHas(spf, `a:${MAIL_HOST}`));
  checks.push({ key: 'spf', ok: spfs.length === 1 && spfUs, found: spfs.length > 1 ? `${spfs.length} SPF records, and a domain may only have one. Merge them: ${spfs.join(' | ')}` : spf || 'none', want: spfWant });
  if (route === 'boosted') {
    const ses = await sesIdentity(domain).catch(() => null);
    const tokens = ses?.tokens ?? [];
    const results = await Promise.all(tokens.map((t) => pub.resolveCname(`${t}._domainkey.${domain}`).then((r) => lower(r[0] ?? '') === `${t}.dkim.amazonses.com`, () => false)));
    checks.push({ key: 'dkim', ok: tokens.length > 0 && results.every(Boolean), found: tokens.length ? `${results.filter(Boolean).length} of ${tokens.length} records` : 'Amazon has no identity for this domain yet', want: '3 CNAME records' });
  } else {
    const want = domainKey(domain, ws.id).publicKey;
    checks.push({ key: 'dkim', ok: rec.replace(/\s/g, '').includes(`p=${want}`), found: rec ? 'a DKIM record' + (rec.replace(/\s/g, '').includes(`p=${want}`) ? '' : ' with a different key') : 'none', want: `${SELECTOR}._domainkey TXT` });
  }
  const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => t.toLowerCase().startsWith('v=dmarc1')) ?? '';
  checks.push({ key: 'dmarc', ok: !!dmarc, found: dmarc || 'none', want: 'v=DMARC1; p=quarantine' });
  return { domain, at: now(), checks, allOk: checks.every((c) => c.ok) };
}

/** This server's own sending health: reverse DNS, its A record and whether port 25 is open outward. Cached 10 min. */
let healthCache: { at: number; value: { ptr: DnsCheck; a: DnsCheck; port25: DnsCheck; inbound: DnsCheck } } | null = null;
export async function serverHealth() {
  if (healthCache && healthCache.at > Date.now() - 10 * 60_000) return healthCache.value;
  const ptrNames = MAIL_IP ? await pub.reverse(MAIL_IP).catch(() => [] as string[]) : [];
  const a = await pub.resolve4(MAIL_HOST).catch(() => [] as string[]);
  const port25 = await new Promise<boolean>((res) => {
    const s = connect({ host: 'gmail-smtp-in.l.google.com', port: 25, timeout: 6000 });
    s.once('connect', () => (s.destroy(), res(true)));
    s.once('timeout', () => (s.destroy(), res(false)));
    s.once('error', () => res(false));
  });
  const value = {
    ptr: { key: 'ptr', ok: ptrNames.map(lower).includes(MAIL_HOST), found: ptrNames.join(', ') || (MAIL_IP ? 'none' : 'MAIL_IP not set'), want: MAIL_HOST },
    a: { key: 'a', ok: !MAIL_IP || a.includes(MAIL_IP), found: a.join(', ') || 'none', want: MAIL_IP || 'an A record' },
    port25: { key: 'port25', ok: port25, found: port25 ? 'open' : 'blocked or no answer', want: 'open' },
    inbound: { key: 'inbound', ok: listening, found: listening ? `listening on ${MAIL_PORT}` : 'not listening', want: `port ${MAIL_PORT}` },
  };
  healthCache = { at: Date.now(), value };
  return value;
}

/* ---------- receiving ---------- */

let listening = false;

/** "Some of each" routing tests (server/routing.ts): their addresses are accepted, then swallowed. */
type ProbeHook = { accepts: (address: string) => boolean; arrived: (address: string) => void };
let probeHook: ProbeHook | null = null;
export const onRoutingProbe = (hook: ProbeHook) => (probeHook = hook);

export function startMailer(d: MailerDeps) {
  deps = d;
  // Mail kept back for Undo (or its scheduled time) goes out when its wait is over, after a restart too.
  recoverHolds();
  setInterval(() => void releaseHeld(), 5_000).unref?.();
  void releaseHeld();
  if (process.env.MAIL_ENABLED === '0') return;
  const loaded = loadTls(MAIL_HOST);
  const tls = loaded ? { key: loaded.key, cert: loaded.cert } : null;
  const server = new SMTPServer({
    name: MAIL_HOST,
    banner: 'sprint2go mail',
    size: MAX_SIZE,
    disabledCommands: ['AUTH'],
    hideSTARTTLS: !tls,
    ...(tls ?? {}),
    onRcptTo(address, _session, cb) {
      if (accountFor(address.address) || supportAddresses().includes(lower(address.address)) || probeHook?.accepts(lower(address.address))) return cb();
      cb(Object.assign(new Error('No such mailbox here'), { responseCode: 550 }));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        if ((stream as any).sizeExceeded) return cb(Object.assign(new Error('Message too large'), { responseCode: 552 }));
        receive(Buffer.concat(chunks), session).then(
          () => cb(),
          (e) => (deps.log(`[mail] inbound failed: ${e instanceof Error ? e.message : e}`), cb(Object.assign(new Error('Could not store the message, try again later'), { responseCode: 451 }))),
        );
      });
    },
  });
  server.on('error', (e) => deps.log(`[mail] ${e.message}`));
  // A renewed or newly trusted certificate goes in without a restart.
  onCertChange((next) => {
    server.updateSecureContext({ key: next.key, cert: next.cert });
    server.options.hideSTARTTLS = false;
  });
  startCertKeeper(MAIL_HOST, deps.log);
  server.listen(MAIL_PORT, '0.0.0.0', () => {
    listening = true;
    deps.log(`Mail: receiving for ${MAIL_HOST} on port ${MAIL_PORT}${tls ? ` (STARTTLS, ${loaded!.source} certificate)` : ''}; sending ${process.env.MAIL_RELAY_URL ? 'through the relay' : 'direct'}${boostedAvailable() ? ', Boosted available' : ''}`);
  });
  setInterval(() => void pump(), 30_000);
  void pump();
}

const cleanSubject = (s: string) => String(s ?? '').replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim();
const person = (v: { name?: string; address?: string } | undefined): Person => ({ name: v?.name || (v?.address ?? '').split('@')[0], email: lower(v?.address ?? '') });

/** Who may vouch for forwarded mail with an ARC seal: Google, Microsoft and Zoho (the providers "Some of each" uses). */
export const ARC_SEALERS = ['google.com', 'microsoft.com', 'zohomail.com', 'zohomail.eu', 'zohomail.in', 'zoho.com'];
/**
 * mailauth's ARC result, read: the chain must validate, its newest seal must come from a trusted provider, and what
 * that provider saw (its ARC-Authentication-Results) must be a pass and not a DMARC fail.
 */
export function arcVerdict(arc: unknown): { trusted: boolean; sealer: string; result: string } {
  const a = arc as { status?: { result?: string }; signature?: { signingDomain?: string } | false; authenticationResults?: Record<string, any> } | undefined;
  const result = String(a?.status?.result ?? 'none');
  const sealer = lower((a?.signature && a.signature.signingDomain) || '');
  const known = ARC_SEALERS.some((d) => sealer === d || sealer.endsWith(`.${d}`));
  const aar = a?.authenticationResults ?? {};
  const passed = aar.dmarc?.result === 'pass' || aar.spf?.result === 'pass' || (Array.isArray(aar.dkim) && aar.dkim.some((x: { result?: string }) => x.result === 'pass'));
  return { trusted: result === 'pass' && known && passed && aar.dmarc?.result !== 'fail', sealer, result };
}

async function receive(raw: Buffer, session: SMTPServerSession) {
  const parsed = await simpleParser(raw);
  const sender = session.envelope.mailFrom ? session.envelope.mailFrom.address : '';
  let spam = false;
  let authSummary = '';
  try {
    const auth = await authenticate(raw, { ip: session.remoteAddress, helo: session.hostNameAppearsAs, sender, mta: MAIL_HOST });
    const dmarc = (auth.dmarc as any)?.status?.result as string | undefined;
    const spf = (auth.spf as any)?.status?.result as string | undefined;
    const dkimPass = (auth.dkim?.results ?? []).some((r: any) => r.status?.result === 'pass');
    // Forwarded by Google, Microsoft or Zoho ("Some of each", forwarding): our own SPF and DMARC see their servers, not
    // the sender's, so they fail. A valid ARC seal from them saying the original passed there is good enough.
    const arc = arcVerdict(auth.arc);
    spam = !arc.trusted && (dmarc === 'fail' || (spf === 'fail' && !dkimPass));
    authSummary = `spf=${spf ?? '-'} dkim=${dkimPass ? 'pass' : 'none'} dmarc=${dmarc ?? '-'}${arc.sealer ? ` arc=${arc.result}(${arc.sealer})` : ''}`;
  } catch {
    /* no verdict: treat as ordinary mail */
  }
  const mid = parsed.messageId ?? `<${randomBytes(8).toString('hex')}@${MAIL_HOST}>`;
  const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])].filter(Boolean) as string[];
  const addrs = (v: ParsedMail['to']) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.value).map(person);
  const html = parsed.html || undefined;
  const trackers = html ? (html.match(/<img[^>]+(width|height)\s*=\s*["']?1\b/gi) ?? []).length : 0;
  // mailparser folds List-* headers into one 'list' object; the raw header line is the fallback.
  const list = parsed.headers.get('list') as { unsubscribe?: { url?: string | string[] }; 'unsubscribe-post'?: unknown } | undefined;
  const rawUnsub = parsed.headerLines.find((h) => h.key === 'list-unsubscribe')?.line ?? '';
  const unsubUrl = ([] as string[]).concat(list?.unsubscribe?.url ?? []).find((u) => /^https?:\/\//i.test(u)) ?? rawUnsub.match(/<(https?:[^>]+)>/i)?.[1];
  const unsubOneClick = !!list?.['unsubscribe-post'] || parsed.headerLines.some((h) => h.key === 'list-unsubscribe-post');
  // An alias delivers a copy to each of its mailboxes; a mailbox reached twice (directly and through an alias) gets one.
  type Target = { rcpt: (typeof session.envelope.rcptTo)[number]; found: { ws: Ws; account: Account } | null; shared: boolean };
  const targets = session.envelope.rcptTo
    .flatMap((rcpt): Target[] => {
      const found = accountFor(rcpt.address);
      return found?.alias ? found.alias.accounts.map((account) => ({ rcpt, found: { ws: found.ws, account }, shared: found.alias!.accounts.length > 1 })) : [{ rcpt, found, shared: false }];
    })
    .filter((t, i, all) => !t.found || all.findIndex((x) => x.found?.account.id === t.found!.account.id) === i);
  for (const { rcpt, found, shared } of targets) {
    // A routing test: it proves the provider passed it on, and nobody ever sees it.
    if (probeHook?.accepts(lower(rcpt.address))) {
      probeHook.arrived(lower(rcpt.address));
      continue;
    }
    if (supportAddresses().includes(lower(rcpt.address)) && supportHandler) {
      const attachments = parsed.attachments.map((a) => {
        const id = randomBytes(16).toString('hex');
        db.saveFile({ id, workspaceId: 'platform', by: 'mail', name: a.filename ?? 'attachment', type: a.contentType ?? 'application/octet-stream', size: a.size }, a.content);
        return { name: a.filename ?? 'attachment', size: fmtSize(a.size), url: `/api/files/${id}` };
      });
      await supportHandler({ to: lower(rcpt.address), parsed, mid, refs, spam, attachments });
      db.db.prepare('INSERT INTO mail_log (workspace_id, direction, route, addr, bytes, state, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('platform', 'in', spam ? 'spam' : 'support', lower(rcpt.address), raw.length, 'stored', authSummary || null, now());
      continue;
    }
    const hit = found;
    if (!hit) continue;
    const { ws, account } = hit;
    // A calendar invite: read it, and list its .ics once (calendars attach it twice).
    const cal = readInvite(parsed.attachments, [lower(rcpt.address), lower(account.email)]);
    const attachments = cal.attachments.map((a) => {
      const id = randomBytes(16).toString('hex');
      db.saveFile({ id, workspaceId: ws.id, by: 'mail', name: a.filename ?? 'attachment', type: a.contentType ?? 'application/octet-stream', size: a.size }, a.content);
      return { name: a.filename ?? 'attachment', size: fmtSize(a.size), url: `/api/files/${id}` };
    });
    const msg = {
      id: 'm-' + randomBytes(6).toString('hex'),
      mid,
      from: person(parsed.from?.value?.[0]),
      to: [...addrs(parsed.to), ...addrs(parsed.cc)],
      date: (parsed.date ?? new Date()).toISOString(),
      body: (parsed.text ?? '').trim(),
      html,
      attachments: attachments.length ? attachments : undefined,
      trackersBlocked: trackers || undefined,
      listUnsubscribe: unsubUrl ? { url: unsubUrl, oneClick: unsubOneClick } : undefined,
      auth: authSummary || undefined,
      invite: cal.invite ?? undefined,
    };
    const threads = (db.allDocs('threads') as any[]).filter((t) => t.accountId === account.id);
    const existing = refs.length ? threads.find((t) => (t.messages ?? []).some((m: any) => m.mid && refs.includes(m.mid))) : undefined;
    const thread = existing
      ? { ...existing, unread: true, location: existing.location === 'trash' || existing.location === 'archive' ? 'inbox' : existing.location, snoozedUntil: undefined, messages: [...existing.messages, msg] }
      : { id: 't-' + randomBytes(6).toString('hex'), accountId: account.id, subject: cleanSubject(parsed.subject ?? '') || '(no subject)', location: spam ? 'spam' : 'inbox', starred: false, unread: true, labels: [], messages: [msg], workspaceId: ws.id };
    db.writeDocs('threads', [thread], [], null);
    deps.broadcast('threads', [thread], []);
    db.db.prepare('INSERT INTO mail_log (workspace_id, direction, route, addr, bytes, state, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(ws.id, 'in', spam ? 'spam' : 'inbox', lower(rcpt.address), raw.length, 'stored', authSummary || null, now());
    // The first message for a mailbox that wasn't receiving yet unlocks it straight away.
    if (!(ws as any).mailReady?.mailboxes?.[account.id]?.receive) void refreshReadiness(ws.id).catch(() => {});
    // An update or cancellation of an invite people here answered moves or removes their events.
    if (cal.invite && !spam) applyInbound(ws, account, cal.invite, thread.id, deps.broadcast, deps.notify);
    // Out of office (not for addresses that reach several mailboxes: someone else is around).
    if (!shared) void maybeAnswer({ workspaceId: ws.id, account, canSend: !!(ws as any).mailReady?.mailboxes?.[account.id]?.send, parsed, envelopeFrom: sender, mid, refs, spam, send: queueSend, log: deps.log });
  }
}

/* ---------- sending ---------- */

export interface Outgoing {
  workspaceId: string;
  accountId: string;
  threadId: string;
  messageId: string;
  from: Person;
  to: Person[];
  cc: Person[];
  subject: string;
  text: string;
  html?: string;
  files: { name: string; url: string }[];
  inReplyTo?: string;
  references?: string[];
  ical?: { method: string; content: string }; // a calendar part, e.g. the REPLY to an invite
  headers?: Record<string, string>; // extra headers (Auto-Submitted on an out-of-office answer)
}

const fileBuffer = (url: string): Buffer | null => {
  const m = url.match(/^\/api\/files\/([a-f0-9]{32})$/);
  if (m) return db.fileData(m[1]);
  const d = url.match(/^data:[^;]*;base64,(.+)$/);
  return d ? Buffer.from(d[1], 'base64') : null;
};

/** Builds the message, signs it and queues one delivery per outside recipient; our own mailboxes get it at once. */
export async function queueSend(o: Outgoing): Promise<{ mid: string; queued: number; local: number; route: 'own' | 'boosted' }> {
  const ws = workspaces().find((w) => w.id === o.workspaceId);
  if (!ws) throw new Error('No such company');
  const acct = (ws.accounts ?? []).find((a) => a.id === o.accountId) as (Account & { sendPaused?: { reason: string } }) | undefined;
  if (acct?.sendPaused) throw new Error(`Sending from this mailbox is paused: ${acct.sendPaused.reason} Ask your admin or sprint2go support.`);
  const recipientsCount = [...o.to, ...o.cc].length;
  const sentLastHour = (db.db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE account_id = ? AND created_at >= ?').get(o.accountId, new Date(Date.now() - 3600_000).toISOString()) as { n: number }).n;
  const sentLastDay = (db.db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE account_id = ? AND created_at >= ?').get(o.accountId, new Date(Date.now() - 86_400_000).toISOString()) as { n: number }).n;
  if (sentLastHour + recipientsCount > LIMITS.hour || sentLastDay + recipientsCount > LIMITS.day)
    throw new Error(`This mailbox has reached its sending limit (${LIMITS.hour} an hour, ${LIMITS.day} a day). Try again later, or use Boosted sending for bigger sends.`);
  const domain = lower(o.from.email.split('@')[1] ?? '');
  if (domain && domain !== MAIL_HOST && !mayUse(ws, domain)) throw new Error(`Another company uses ${domain}, so mail can’t be sent from it here. An admin can prove it’s yours in Settings, Email delivery.`);
  const mid = `<${randomBytes(12).toString('hex')}@${domain || MAIL_HOST}>`;
  let route: 'own' | 'boosted' = ws.mailRoute === 'boosted' && boostedAvailable() ? 'boosted' : 'own';
  const recipients = [...o.to, ...o.cc].map((p) => ({ ...p, email: lower(p.email) })).filter((p, i, all) => p.email && all.findIndex((x) => x.email === p.email) === i);
  const mine = localAccounts();
  const local = recipients.filter((p) => mine.has(p.email));
  const remote = recipients.filter((p) => !mine.has(p.email));
  if (route === 'boosted' && (ws.mailCredits ?? 0) < remote.length) {
    route = 'own';
    if (!ws.mailCreditsNotified) {
      const admins = ws.members.filter((m) => m.role !== 'member').map((m) => m.userId);
      deps.notify(admins, ws.id, 'Boosted sending has no credits left; mail goes out from the sprint2go server until you top up.', '/settings/email');
      db.writeDocs('workspaces', [{ ...(ws as any), mailCreditsNotified: true }], [], null);
    }
  }
  const composer = new MailComposer({
    from: { name: o.from.name, address: o.from.email },
    to: o.to.map((p) => ({ name: p.name, address: p.email })),
    cc: o.cc.length ? o.cc.map((p) => ({ name: p.name, address: p.email })) : undefined,
    subject: o.subject,
    text: o.text,
    html: o.html,
    messageId: mid,
    inReplyTo: o.inReplyTo,
    references: o.references,
    attachments: o.files.map((f) => ({ filename: f.name, content: fileBuffer(f.url) ?? Buffer.alloc(0) })),
    icalEvent: o.ical ? { method: o.ical.method, content: o.ical.content, filename: 'invite.ics' } : undefined,
    headers: { 'X-Mailer': 'sprint2go', ...(o.headers ?? {}) },
  });
  let raw: Buffer = await composer.compile().build();
  if (route === 'own' && domain && domain !== MAIL_HOST) {
    const key = domainKey(domain, ws.id);
    const { signatures } = await dkimSign(raw, { signingDomain: domain, selector: key.selector, privateKey: key.privateKey, canonicalization: 'relaxed/relaxed' });
    raw = Buffer.concat([Buffer.from(signatures), raw]);
  }
  // Our own mailboxes get a copy straight away (an alias: each of its mailboxes), here or in other companies; never the
  // mailbox it was sent from.
  let localCount = 0;
  const localBoxes = local
    .flatMap((p) => {
      const found = mine.get(p.email)!;
      return (found.alias?.accounts ?? [found.account]).map((account) => ({ hit: { ws: found.ws, account }, shared: (found.alias?.accounts.length ?? 1) > 1 }));
    })
    .filter((x, i, all) => all.findIndex((y) => y.hit.account.id === x.hit.account.id) === i);
  for (const { hit, shared } of localBoxes) {
    if (hit.account.id === o.accountId) continue;
    const parsed = await simpleParser(raw);
    const msg = { id: 'm-' + randomBytes(6).toString('hex'), mid, from: o.from, to: recipients, date: now(), body: o.text, html: o.html, attachments: parsed.attachments.length ? o.files.map((f, i) => ({ name: f.name, size: fmtSize(parsed.attachments[i]?.size ?? 0), url: f.url })) : undefined };
    const thread = { id: 't-' + randomBytes(6).toString('hex'), accountId: hit.account.id, subject: o.subject || '(no subject)', location: 'inbox', starred: false, unread: true, labels: [], messages: [msg], workspaceId: hit.ws.id };
    db.writeDocs('threads', [thread], [], null);
    deps.broadcast('threads', [thread], []);
    localCount++;
    // A colleague away gets to answer too (their answer carries Auto-Submitted, so it never answers back).
    if (!shared) void maybeAnswer({ workspaceId: hit.ws.id, account: hit.account, canSend: !!(hit.ws as any).mailReady?.mailboxes?.[hit.account.id]?.send, parsed, envelopeFrom: o.from.email, mid, refs: o.references ?? [], spam: false, send: queueSend, log: deps.log });
  }
  const ins = db.db.prepare('INSERT INTO outbox (id, workspace_id, account_id, thread_id, message_id, route, from_addr, to_addr, raw, attempts, next_at, state, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)');
  for (const p of remote) ins.run(randomBytes(8).toString('hex'), ws.id, o.accountId, o.threadId, o.messageId, route, lower(o.from.email), p.email, raw, now(), 'queued', now());
  if (route === 'boosted' && remote.length) {
    db.writeDocs('workspaces', [{ ...(ws as any), mailCredits: Math.max(0, (ws.mailCredits ?? 0) - remote.length) }], [], null);
    deps.broadcast('workspaces', [db.getDoc('workspaces', ws.id)!], []);
  }
  markDelivery(o.threadId, o.messageId, mid, remote.length ? 'sending' : 'sent');
  void pump();
  return { mid, queued: remote.length, local: localCount, route };
}

/** Writes the delivery state on the message inside its thread, so the app can show "sending", "sent" or "failed". */
function markDelivery(threadId: string, messageId: string, mid: string | null, state: 'held' | 'sending' | 'sent' | 'failed', error?: string, until?: string) {
  const t = db.getDoc('threads', threadId) as any;
  if (!t) return;
  const messages = (t.messages ?? []).map((m: any) => (m.id === messageId ? { ...m, mid: mid ?? m.mid, delivery: { state, at: now(), ...(error ? { error } : {}), ...(until ? { until } : {}) } } : m));
  const next = { ...t, messages };
  db.writeDocs('threads', [next], [], null);
  deps?.broadcast('threads', [next], []);
}

/* ---------- Undo send: mail waits here for its sender's undo window (scheduled mail too, from its time) ---------- */

db.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_hold (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, user_id TEXT, payload TEXT NOT NULL, release_at TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS mail_hold_due ON mail_hold (state, release_at);
  CREATE INDEX IF NOT EXISTS mail_hold_msg ON mail_hold (thread_id, message_id);
`);
/** The longest undo window anyone can pick (Settings, Mail). */
export const MAX_UNDO_SECONDS = 30;

/**
 * Keeps an email back until `releaseAt`: nothing leaves, and none of our own mailboxes get a copy, before then. Undo
 * (`cancelHeld`) takes it back while it waits; then `releaseHeld` hands it to `queueSend` like any other email.
 */
export function holdSend(o: Outgoing, opts: { userId: string | null; releaseAt: number }) {
  const until = new Date(opts.releaseAt).toISOString();
  // One wait per message: the same message sent again replaces one that's still waiting.
  db.db.prepare("UPDATE mail_hold SET state = 'cancelled' WHERE thread_id = ? AND message_id = ? AND state = 'held'").run(o.threadId, o.messageId);
  const id = randomBytes(8).toString('hex');
  db.db.prepare('INSERT INTO mail_hold (id, workspace_id, account_id, thread_id, message_id, user_id, payload, release_at, state, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)').run(id, o.workspaceId, o.accountId, o.threadId, o.messageId, opts.userId, JSON.stringify(o), until, 'held', now());
  const wait = opts.releaseAt - Date.now();
  if (wait > 0) markDelivery(o.threadId, o.messageId, null, 'held', undefined, until);
  setTimeout(() => void releaseHeld(), Math.max(0, wait) + 50).unref?.();
  return { id, until };
}

/** Undo: takes back an email that's still waiting. Only the person who sent it can; a sent one can't come back. */
export function cancelHeld(threadId: string, messageId: string, userId: string): { ok: true; email: Outgoing } | { ok: false; why: 'gone' | 'not-yours' } {
  const h = db.db.prepare('SELECT id, user_id, payload, state FROM mail_hold WHERE thread_id = ? AND message_id = ? ORDER BY created_at DESC LIMIT 1').get(threadId, messageId) as { id: string; user_id: string | null; payload: string; state: string } | undefined;
  if (!h || h.state !== 'held') return { ok: false, why: 'gone' };
  if (h.user_id !== userId) return { ok: false, why: 'not-yours' };
  // Taken in one step: if the release got it first, it's gone.
  if (!db.db.prepare("UPDATE mail_hold SET state = 'cancelled' WHERE id = ? AND state = 'held'").run(h.id).changes) return { ok: false, why: 'gone' };
  return { ok: true, email: JSON.parse(h.payload) as Outgoing };
}

/** Whether a message is waiting to go out, and until when. */
export const heldUntil = (threadId: string, messageId: string) =>
  (db.db.prepare("SELECT release_at FROM mail_hold WHERE thread_id = ? AND message_id = ? AND state = 'held'").get(threadId, messageId) as { release_at: string } | undefined)?.release_at ?? null;

let releasing: Promise<{ id: string; state: 'sent' | 'failed'; error?: string }[]> | null = null;
/** Hands every email whose wait is over to the outbox. `at` can be set for tests. */
export function releaseHeld(at = Date.now()): Promise<{ id: string; state: 'sent' | 'failed'; error?: string }[]> {
  if (releasing) return releasing.then(() => releaseHeld(at));
  releasing = (async (): Promise<{ id: string; state: 'sent' | 'failed'; error?: string }[]> => {
    const out: { id: string; state: 'sent' | 'failed'; error?: string }[] = [];
    const due = db.db.prepare("SELECT * FROM mail_hold WHERE state = 'held' AND release_at <= ? ORDER BY release_at LIMIT 50").all(new Date(at).toISOString()) as any[];
    for (const h of due) {
      if (!db.db.prepare("UPDATE mail_hold SET state = 'releasing' WHERE id = ? AND state = 'held'").run(h.id).changes) continue; // undone a moment ago
      try {
        await queueSend(JSON.parse(h.payload) as Outgoing);
        db.db.prepare("UPDATE mail_hold SET state = 'sent', payload = '' WHERE id = ?").run(h.id);
        out.push({ id: h.id, state: 'sent' });
      } catch (e) {
        const why = e instanceof Error ? e.message : 'It could not be sent.';
        db.db.prepare("UPDATE mail_hold SET state = 'failed', error = ? WHERE id = ?").run(why.slice(0, 300), h.id);
        markDelivery(h.thread_id, h.message_id, null, 'failed', why);
        const ws = workspaces().find((w) => w.id === h.workspace_id);
        const who = h.user_id ? [h.user_id] : ((ws?.accounts ?? []).find((a) => a.id === h.account_id)?.users ?? []);
        if (who.length) deps?.notify(who, h.workspace_id, `Your email could not be sent: ${why.slice(0, 160)}`, '/mail');
        out.push({ id: h.id, state: 'failed', error: why });
      }
    }
    return out;
  })().finally(() => (releasing = null));
  return releasing;
}

/** After a restart: an email caught halfway (handed over or not) is settled by what's in the outbox and the thread. */
function recoverHolds() {
  for (const h of db.db.prepare("SELECT id, thread_id, message_id FROM mail_hold WHERE state = 'releasing'").all() as { id: string; thread_id: string; message_id: string }[]) {
    const queued = db.db.prepare('SELECT 1 FROM outbox WHERE thread_id = ? AND message_id = ? LIMIT 1').get(h.thread_id, h.message_id);
    const marked = ((db.getDoc('threads', h.thread_id) as any)?.messages ?? []).find((m: any) => m.id === h.message_id)?.delivery?.state;
    db.db.prepare('UPDATE mail_hold SET state = ? WHERE id = ?').run(queued || marked === 'sending' || marked === 'sent' ? 'sent' : 'held', h.id);
  }
  db.db.prepare("DELETE FROM mail_hold WHERE state IN ('sent', 'cancelled') AND created_at < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString());
}

const BACKOFF = [60, 300, 900, 3600, 4 * 3600, 8 * 3600];
/** Per mailbox: protects the server's reputation from one runaway or hacked account. */
export const LIMITS = { hour: Number(process.env.MAIL_LIMIT_HOUR ?? 200), day: Number(process.env.MAIL_LIMIT_DAY ?? 1000) };

/** After a failure: a mailbox whose recent mail mostly bounces is paused, and its company is told. */
function watchBounces(row: any) {
  if (!row.account_id || row.workspace_id === 'platform') return;
  if (String(row.message_id ?? '').startsWith('auto-')) return; // out-of-office answers go to whoever wrote, valid or not
  const recent = db.db.prepare("SELECT state FROM outbox WHERE account_id = ? AND state IN ('sent', 'failed') AND COALESCE(message_id, '') NOT LIKE 'auto-%' ORDER BY created_at DESC LIMIT 50").all(row.account_id) as { state: string }[];
  const failed = recent.filter((r) => r.state === 'failed').length;
  if (recent.length < 20 || failed / recent.length < 0.1) return;
  const ws = db.getDoc('workspaces', row.workspace_id) as any;
  const acct = ws?.accounts?.find((a: any) => a.id === row.account_id);
  if (!ws || !acct || acct.sendPaused) return;
  const reason = `${failed} of the last ${recent.length} emails bounced, which can get the server blocked.`;
  const next = { ...ws, accounts: ws.accounts.map((a: any) => (a.id === acct.id ? { ...a, sendPaused: { at: now(), reason } } : a)) };
  db.writeDocs('workspaces', [next], [], null);
  deps.broadcast('workspaces', [next], []);
  deps.notify(ws.members.filter((m: any) => m.role !== 'member').map((m: any) => m.userId), ws.id, `Sending from ${acct.email} is paused: ${reason} Check the addresses, then ask support to lift it.`, '/settings/email');
  onPaused?.(ws, acct, reason);
}
let onPaused: ((ws: any, account: any, reason: string) => void) | null = null;
export const onMailboxPaused = (fn: (ws: any, account: any, reason: string) => void) => (onPaused = fn);
export function unpauseMailbox(workspaceId: string, accountId: string) {
  const ws = db.getDoc('workspaces', workspaceId) as any;
  if (!ws) return false;
  const next = { ...ws, accounts: (ws.accounts ?? []).map((a: any) => (a.id === accountId ? { ...a, sendPaused: undefined } : a)) };
  db.writeDocs('workspaces', [next], [], null);
  deps.broadcast('workspaces', [next], []);
  return true;
}
export const pausedMailboxes = () =>
  workspaces().flatMap((w) => (w.accounts ?? []).filter((a: any) => a.sendPaused).map((a: any) => ({ workspaceId: w.id, company: w.name, accountId: a.id, email: a.email, ...a.sendPaused })));
let pumping = false;
/** Delivers what's due in the outbox: one SMTP conversation per recipient, retried with backoff for about a day. */
export async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const due = db.db.prepare("SELECT * FROM outbox WHERE state = 'queued' AND next_at <= ? ORDER BY created_at LIMIT 20").all(now()) as any[];
    for (const row of due) {
      try {
        if (row.route === 'boosted') await sendRaw([row.to_addr], row.raw as Buffer, row.from_addr);
        else await deliverDirect(row.from_addr, row.to_addr, row.raw as Buffer);
        db.db.prepare("UPDATE outbox SET state = 'sent', error = NULL, raw = x'' WHERE id = ?").run(row.id);
        db.db.prepare('INSERT INTO mail_log (workspace_id, direction, route, addr, bytes, state, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(row.workspace_id, 'out', row.route, row.to_addr, (row.raw as Buffer).length, 'sent', null, now());
        settle(row);
      } catch (e) {
        const err = e as Error & { responseCode?: number };
        const permanent = (err.responseCode ?? 0) >= 500 && (err.responseCode ?? 0) < 600;
        const attempts = row.attempts + 1;
        if (permanent || attempts > BACKOFF.length) {
          db.db.prepare("UPDATE outbox SET state = 'failed', attempts = ?, error = ?, raw = x'' WHERE id = ?").run(attempts, err.message.slice(0, 300), row.id);
          db.db.prepare('INSERT INTO mail_log (workspace_id, direction, route, addr, bytes, state, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(row.workspace_id, 'out', row.route, row.to_addr, (row.raw as Buffer).length, 'failed', err.message.slice(0, 300), now());
          settle(row, err.message);
          watchBounces(row);
        } else {
          db.db.prepare("UPDATE outbox SET attempts = ?, next_at = ?, error = ? WHERE id = ?").run(attempts, new Date(Date.now() + BACKOFF[attempts - 1] * 1000).toISOString(), err.message.slice(0, 300), row.id);
        }
        deps.log(`[mail] to ${row.to_addr} (${row.route}, try ${attempts}): ${err.message}`);
      }
    }
  } finally {
    pumping = false;
  }
}

/** When every recipient of a message is settled, the message shows sent or failed, and failures tell the sender. */
function settle(row: any, error?: string) {
  if (row.workspace_id === 'platform') return;
  if (String(row.message_id ?? '').startsWith('auto-')) return; // an out-of-office answer: nobody to tell
  const open = db.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE thread_id = ? AND message_id = ? AND state = 'queued'").get(row.thread_id, row.message_id) as { n: number };
  if (open.n) return;
  const failed = db.db.prepare("SELECT to_addr, error FROM outbox WHERE thread_id = ? AND message_id = ? AND state = 'failed'").all(row.thread_id, row.message_id) as { to_addr: string; error: string }[];
  markDelivery(row.thread_id, row.message_id, null, failed.length ? 'failed' : 'sent', failed.length ? `${failed.map((f) => f.to_addr).join(', ')}: ${failed[0].error}` : undefined);
  if (failed.length || error) {
    const ws = workspaces().find((w) => w.id === row.workspace_id);
    const account = ws?.accounts?.find((a) => a.id === row.account_id);
    const who = account?.users?.length ? account.users : (ws?.members ?? []).map((m) => m.userId);
    deps.notify(who, row.workspace_id, `Your email to ${failed.map((f) => f.to_addr).join(', ') || row.to_addr} could not be delivered: ${(failed[0]?.error ?? error ?? '').slice(0, 140)}`, '/mail');
  }
}

async function deliverDirect(from: string, to: string, raw: Buffer) {
  const relay = process.env.MAIL_RELAY_URL;
  if (relay) {
    const t = nodemailer.createTransport({ url: relay, name: MAIL_HOST } as Parameters<typeof nodemailer.createTransport>[0]);
    await t.sendMail({ envelope: { from, to: [to] }, raw });
    return;
  }
  const domain = to.split('@')[1];
  const mx = await dns.resolveMx(domain).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => x.exchange)).catch(() => [] as string[]);
  const hosts = mx.length ? mx : [domain];
  let last: Error | null = null;
  for (const host of hosts.slice(0, 3)) {
    try {
      const t = nodemailer.createTransport({ host, port: 25, secure: false, name: MAIL_HOST, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000, tls: { rejectUnauthorized: false } });
      await t.sendMail({ envelope: { from, to: [to] }, raw });
      return;
    } catch (e) {
      last = e as Error;
      if ((e as any).responseCode >= 500) throw e; // the receiver refused for good
    }
  }
  throw last ?? new Error('No mail server answered');
}

/* ---------- numbers for Settings and the operator backend ---------- */

export function mailStats(workspaceId: string, since: string) {
  const rows = db.db.prepare('SELECT direction, route, state, COUNT(*) AS n, SUM(bytes) AS bytes FROM mail_log WHERE workspace_id = ? AND at >= ? GROUP BY direction, route, state').all(workspaceId, since) as { direction: string; route: string; state: string; n: number; bytes: number }[];
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((n, r) => n + r.n, 0);
  return { received: sum((r) => r.direction === 'in'), spam: sum((r) => r.direction === 'in' && r.route === 'spam'), sent: sum((r) => r.direction === 'out' && r.state === 'sent'), boosted: sum((r) => r.direction === 'out' && r.route === 'boosted' && r.state === 'sent'), failed: sum((r) => r.direction === 'out' && r.state === 'failed'), queued: (db.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE workspace_id = ? AND state = 'queued'").get(workspaceId) as { n: number }).n };
}
export const mailStatsAll = (since: string) =>
  db.db.prepare('SELECT workspace_id AS workspaceId, direction, route, state, COUNT(*) AS n FROM mail_log WHERE at >= ? GROUP BY workspace_id, direction, route, state').all(since) as { workspaceId: string; direction: string; route: string; state: string; n: number }[];

/* ---------- mail from sprint2go itself (support replies, invoices, alerts, broadcasts) ---------- */

type SystemMail = { fromName: string; from?: string; to: string[]; subject: string; text: string; html?: string; inReplyTo?: string; references?: string[]; attachments?: { filename: string; content: Buffer; contentType?: string }[] };
export async function sendSystemMail(m: SystemMail) {
  return (await queueSystemMail(m)).mid;
}
/** The same, also returning the outbox rows it made (one per recipient), for callers that follow the delivery. */
export async function queueSystemMail(m: SystemMail) {
  const from = lower(m.from ?? SUPPORT_EMAIL);
  const domain = from.split('@')[1] ?? MAIL_HOST;
  const mid = `<${randomBytes(12).toString('hex')}@${domain}>`;
  const composer = new MailComposer({ from: { name: m.fromName, address: from }, to: m.to, subject: m.subject, text: m.text, html: m.html, messageId: mid, inReplyTo: m.inReplyTo, references: m.references, attachments: m.attachments, headers: { 'X-Mailer': 'sprint2go' } });
  let raw: Buffer = await composer.compile().build();
  const route: 'own' | 'boosted' = mailConfigured() ? 'boosted' : 'own';
  if (route === 'own') {
    const key = domainKey(domain, 'platform');
    const { signatures } = await dkimSign(raw, { signingDomain: domain, selector: key.selector, privateKey: key.privateKey, canonicalization: 'relaxed/relaxed' });
    raw = Buffer.concat([Buffer.from(signatures), raw]);
  }
  const ins = db.db.prepare('INSERT INTO outbox (id, workspace_id, account_id, thread_id, message_id, route, from_addr, to_addr, raw, attempts, next_at, state, error, created_at) VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, 0, ?, ?, NULL, ?)');
  const ids = m.to.map((to) => {
    const id = randomBytes(8).toString('hex');
    ins.run(id, 'platform', route, from, lower(to), raw, now(), 'queued', now());
    return id;
  });
  void pump();
  return { mid, ids };
}
/** Where an outbox row stands: still trying, delivered, or given up (with the receiving server's last answer). */
export const outboxState = (id: string) => db.db.prepare('SELECT state, error, attempts FROM outbox WHERE id = ?').get(id) as { state: 'queued' | 'sent' | 'failed'; error: string | null; attempts: number } | undefined;

/* ---------- the app's own notes (sign-up codes, guest notices): Amazon SES when set up, else our own engine ---------- */

/** The address notes come from: no-reply at the support domain, whose DKIM key the platform already publishes. */
export const NOREPLY = `no-reply@${SUPPORT_EMAIL.split('@')[1] ?? MAIL_HOST}`;
const realDomain = (d: string) => d.includes('.') && !/(^|\.)(localhost|local|test|invalid|example|internal)$/.test(d);
/**
 * How the app's own notes go out: 'ses' when Amazon SES is configured, 'own' when this server can send them itself
 * (the mail engine is on and the support domain is a real one), else 'log' (local development: codes go to the log).
 */
export function systemMailPath(): 'ses' | 'own' | 'log' {
  if (mailConfigured()) return 'ses';
  if (process.env.MAIL_ENABLED !== '0' && realDomain(NOREPLY.split('@')[1])) return 'own';
  return 'log';
}
/**
 * Sends one note (text and HTML as given). True when it's on its way. False when no path works: no SES, and our own
 * engine can't get mail out (local development, or port 25 blocked without a relay); the caller logs instead.
 */
export async function sendNote(to: string, subject: string, text: string, html?: string, fromName = 'sprint2go'): Promise<boolean> {
  const path = systemMailPath();
  if (path === 'ses') return sendMail(to, subject, text, html);
  if (path === 'log') return false;
  if (!process.env.MAIL_RELAY_URL && !(await serverHealth()).port25.ok) return false;
  await sendSystemMail({ fromName, from: NOREPLY, to: [to], subject, text, html });
  return true;
}

export const queue = (state: 'queued' | 'failed', limit = 200) =>
  db.db.prepare('SELECT id, workspace_id AS workspaceId, account_id AS accountId, route, from_addr AS fromAddr, to_addr AS toAddr, attempts, next_at AS nextAt, error, created_at AS createdAt FROM outbox WHERE state = ? ORDER BY created_at DESC LIMIT ?').all(state, limit) as {
    id: string;
    workspaceId: string;
    accountId: string | null;
    route: string;
    fromAddr: string;
    toAddr: string;
    attempts: number;
    nextAt: string;
    error: string | null;
    createdAt: string;
  }[];
export function retryNow(id: string) {
  const r = db.db.prepare("UPDATE outbox SET next_at = ? WHERE id = ? AND state = 'queued'").run(now(), id);
  void pump();
  return r.changes > 0;
}
export const dropQueued = (id: string) => db.db.prepare("UPDATE outbox SET state = 'failed', error = 'Dropped by an operator', raw = x'' WHERE id = ? AND state = 'queued'").run(id).changes > 0;

/** Whether the server's address is on the big blocklists. 'unknown' when a list refuses to answer (public resolvers). */
export async function blocklists(): Promise<{ list: string; listed: boolean | 'unknown' }[]> {
  if (!MAIL_IP) return [];
  const rev = MAIL_IP.split('.').reverse().join('.');
  const lists = ['zen.spamhaus.org', 'b.barracudacentral.org', 'bl.spamcop.net', 'dnsbl.sorbs.net'];
  return Promise.all(
    lists.map(async (list) => {
      try {
        const a = await dns.resolve4(`${rev}.${list}`);
        if (a.some((x) => x.startsWith('127.255.255.'))) return { list, listed: 'unknown' as const };
        return { list, listed: a.length > 0 };
      } catch (e) {
        return { list, listed: (e as { code?: string }).code === 'ENOTFOUND' ? false : ('unknown' as const) };
      }
    }),
  );
}

/* ---------- readiness: can this company (and each mailbox) really receive and send? ---------- */

export interface MailReady {
  at: string;
  receive: boolean; // at least one mailbox receives
  send: boolean; // at least one mailbox sends
  why: { receive?: string; send?: string };
  mailboxes: Record<string, { receive: boolean; send: boolean; why?: string; sendWhy?: string }>;
}
const receivedAt = (addr: string) =>
  !!db.db.prepare("SELECT 1 FROM mail_log WHERE direction = 'in' AND addr = ? AND at >= ? LIMIT 1").get(lower(addr), new Date(Date.now() - 60 * 86_400_000).toISOString());

/**
 * "Some of each": the mailboxes hosted here at the company's own domain, and which of them really received mail. Their
 * MX stays with the provider, so mail at one of these addresses proves the provider's routing passes mail on.
 */
export function hostedArrivals(ws: Ws): { hosted: string[]; arrived: string[] } {
  const own = new Set((ws.domains ?? []).map(lower));
  const hosted = (ws.accounts ?? [])
    .filter((a) => a.email && !(a as { temp?: boolean }).temp && (!a.provider || a.provider === 'sprint2go') && own.has(lower(a.email.split('@')[1] ?? '')))
    .map((a) => lower(a.email));
  return { hosted, arrived: hosted.filter(receivedAt) };
}

/** Worked out from the real state: DNS seen by public resolvers, the server's ports, and mail that actually arrived. */
export async function mailReadiness(ws: Ws & { mailRouting?: { verifiedAt?: string }; whiteLabel?: unknown }): Promise<MailReady> {
  const at = now();
  const setup = ws.emailSetup ?? 'none';
  const accounts = (ws.accounts ?? []).filter((a) => a.email);
  if (setup === 'none' || !accounts.length)
    return { at, receive: false, send: false, why: { receive: setup === 'none' ? 'Email is off for this company.' : 'There are no mailboxes yet.', send: setup === 'none' ? 'Email is off for this company.' : 'There are no mailboxes yet.' }, mailboxes: {} };
  const health = await serverHealth();
  const route = ws.mailRoute ?? 'own';
  const slug = lower(ws.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
  // One DNS check per domain the mailboxes use.
  const domains = new Map<string, { mxHere: boolean; signs: boolean; why?: string; taken?: string }>();
  for (const d of new Set(accounts.map((a) => lower(a.email.split('@')[1] ?? '')))) {
    if (d === MAIL_HOST) {
      domains.set(d, { mxHere: true, signs: true });
      continue;
    }
    const mx = await pub.resolveMx(d).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => lower(x.exchange)), () => [] as string[]);
    const apex = await txt(d);
    const dkim = (await txt(`${SELECTOR}._domainkey.${d}`)).find((t) => t.includes('p=')) ?? '';
    // Another company holds the domain: none of its mail comes here or goes out for this company.
    const own = settleDomain(ws, d, { mxHere: mx[0] === MAIL_HOST, dkim, txt: apex });
    if (own.state === 'held' || own.state === 'taken') {
      domains.set(d, { mxHere: false, signs: false, taken: `Another company uses ${d}. An admin can prove it’s yours in Settings, Email delivery.` });
      continue;
    }
    let signs = false;
    let why: string | undefined;
    if (route === 'boosted') {
      const ses = mailConfigured() ? await sesIdentity(d).catch(() => null) : null;
      signs = !!ses?.dkimVerified;
      why = !mailConfigured() ? 'Boosted sending isn’t available yet.' : signs ? undefined : 'Amazon hasn’t verified the signing records yet.';
    } else {
      const spfs = spfRecords(apex);
      const spfOk = spfs.length === 1 && (spfHas(spfs[0], spfOurs('own')) || spfHas(spfs[0], `a:${MAIL_HOST}`));
      const dkimOk = dkim.replace(/\s/g, '').includes(`p=${domainKey(d, ws.id).publicKey}`);
      signs = spfOk && dkimOk;
      why = signs ? undefined : !spfOk && !dkimOk ? `The SPF and DKIM records for ${d} are missing.` : !spfOk ? (spfs.length > 1 ? `${d} has ${spfs.length} SPF records; merge them into one.` : `The SPF record for ${d} doesn’t include our server.`) : `The DKIM record for ${d} is missing or different.`;
    }
    domains.set(d, { mxHere: mx[0] === MAIL_HOST, signs, why });
  }
  const mailboxes: MailReady['mailboxes'] = {};
  for (const a of accounts) {
    const d = lower(a.email.split('@')[1] ?? '');
    const dom = domains.get(d)!;
    const hosted = !a.provider || a.provider === 'sprint2go';
    const portOut = route === 'boosted' || health.port25.ok;
    if (dom.taken) mailboxes[a.id] = { receive: false, send: false, why: dom.taken, sendWhy: dom.taken };
    else if (hosted) {
      const receive = health.inbound.ok && (dom.mxHere || !!ws.mailRouting?.verifiedAt || receivedAt(a.email));
      const send = portOut && dom.signs;
      const prov = PROVIDER_NAME[ws.emailProvider || 'google'] ?? 'your mail provider';
      const why = !receive
        ? setup === 'mix'
          ? `Nothing has arrived for ${a.email} yet. Set up routing at ${prov} (the steps are under Mail routing), make sure the address doesn’t exist there, then send it a test.`
          : `Mail for ${d} still goes elsewhere: point the MX record to ${MAIL_HOST}.`
        : !send
          ? (dom.why ?? 'Outgoing mail is blocked on the server.')
          : undefined;
      mailboxes[a.id] = { receive, send, why, sendWhy: send ? undefined : !portOut ? 'Outgoing mail is blocked on the server.' : dom.why };
    } else {
      // Stays with Google or Microsoft: a copy arrives here once forwarding is on; sending stays in their app for now.
      const fwd = `${lower(a.email).split('@')[0]}.${slug}@${MAIL_HOST}`;
      const receive = health.inbound.ok && receivedAt(fwd);
      const app = a.provider === 'microsoft' ? 'Outlook' : 'Gmail';
      mailboxes[a.id] = {
        receive,
        send: false,
        why: receive
          ? `Replies go out from ${app} for now.`
          : dom.mxHere
            ? `Mail for ${d} already comes to this server, but ${a.email} is set to stay with ${a.provider === 'microsoft' ? 'Microsoft' : 'Google'}. Move the mailbox over in Settings, Email delivery, to get it here.`
            : `Turn on forwarding to ${fwd} in ${app}; it unlocks when the first copy arrives.`,
        sendWhy: `${a.email} stays with ${a.provider === 'microsoft' ? 'Microsoft' : 'Google'}, so replies go out from ${app}. Move the mailbox over in Settings, Email delivery, to send from here.`,
      };
    }
  }
  const list = Object.values(mailboxes);
  const firstWhy = (k: 'receive' | 'send') => (k === 'send' ? list.find((m) => !m.send)?.sendWhy : list.find((m) => !m.receive)?.why);
  return { at, receive: list.some((m) => m.receive), send: list.some((m) => m.send), why: { receive: list.some((m) => m.receive) ? undefined : firstWhy('receive'), send: list.some((m) => m.send) ? undefined : firstWhy('send') }, mailboxes };
}

/** Recomputes and saves a company's readiness when it changed; returns it. */
export async function refreshReadiness(wsId: string) {
  const ws = db.getDoc('workspaces', wsId) as any;
  if (!ws) return null;
  const r = await mailReadiness(ws);
  const cur = ws.mailReady;
  const same = cur && JSON.stringify({ ...cur, at: '' }) === JSON.stringify({ ...r, at: '' });
  if (!same) {
    const fresh = db.getDoc('workspaces', wsId) as any;
    const next = { ...fresh, mailReady: r };
    db.writeDocs('workspaces', [next], [], null);
    deps?.broadcast('workspaces', [next], []);
  }
  return r;
}

/* ---------- one-click unsubscribe (RFC 8058) ---------- */

/** Loopback, private, link-local, carrier-grade NAT and unique-local addresses: never called from here. */
function privateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  if (isIP(v) === 6) return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/.test(v);
}

/**
 * Tells a sender to stop, the way RFC 8058 asks: one POST to the link from their List-Unsubscribe header. The link
 * comes from incoming mail, so only https on the usual port, to a host whose addresses are all public.
 */
export async function oneClickUnsubscribe(link: string): Promise<{ ok: boolean; why?: string; safe?: boolean }> {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return { ok: false, why: 'The sender’s unsubscribe link is broken.' };
  }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return { ok: false, why: 'The sender’s unsubscribe link isn’t a safe web address.' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : [...(await dns.resolve4(host).catch(() => [] as string[])), ...(await dns.resolve6(host).catch(() => [] as string[]))];
  if (!addrs.length) return { ok: false, why: 'The sender’s unsubscribe address doesn’t exist.' };
  if (addrs.some(privateIp)) return { ok: false, why: 'The sender’s unsubscribe link isn’t a safe web address.' };
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': `${MAIL_HOST} unsubscribe` },
    body: 'List-Unsubscribe=One-Click',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!r) return { ok: false, safe: true, why: 'The sender’s server didn’t answer.' };
  return r.status < 400 ? { ok: true, safe: true } : { ok: false, safe: true, why: `The sender’s server refused (${r.status}).` };
}
