// The mail server's certificate for STARTTLS. Google Workspace routes with "Require CA signed certificate" and Microsoft
// connectors that want a trusted certificate refuse a self-signed one, so we prefer, in this order:
//  1. MAIL_TLS_CERT / MAIL_TLS_KEY: certificate files you manage (full chain + key). Re-read twice a day.
//  2. Let's Encrypt, when CF_DNS_TOKEN is set (a Cloudflare API token with Zone DNS Edit for MAIL_HOST's zone): a
//     certificate for MAIL_HOST through the ACME DNS-01 challenge, kept in data/acme and renewed with 30 days left.
//     CF_ZONE_ID skips looking the zone up; ACME_STAGING=1 uses Let's Encrypt's test service.
//  3. Self-signed, made once with openssl: still encrypted, just not trusted.
// A new certificate goes into the running SMTP server without a restart (`onCertChange`).
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createSecureContext, rootCertificates } from 'node:tls';
import { join } from 'node:path';
import * as db from './db.ts';

export type CertSource = 'file' | 'acme' | 'self-signed';
export interface Tls {
  key: Buffer;
  cert: Buffer;
  source: CertSource;
}
export interface CertState {
  source: CertSource | 'none';
  issuer: string | null;
  validTo: string | null;
  daysLeft: number | null;
  /** Signed by a public authority, for this host, not expired: providers that require a CA-signed certificate accept it. */
  trusted: boolean;
  /** Let's Encrypt is set up (CF_DNS_TOKEN). */
  acme: boolean;
  /** The last attempt to get or renew it, when it failed. */
  error: { at: string; message: string } | null;
}

const ACME_DIR = join(db.dataDir, 'acme');
const acmeFiles = { key: join(ACME_DIR, 'mail-key.pem'), cert: join(ACME_DIR, 'mail-cert.pem'), account: join(ACME_DIR, 'account-key.pem') };
const selfFiles = { key: join(db.dataDir, 'mail-key.pem'), cert: join(db.dataDir, 'mail-cert.pem') };
export const acmeConfigured = () => !!process.env.CF_DNS_TOKEN;
const fileConfigured = () => !!process.env.MAIL_TLS_CERT && !!process.env.MAIL_TLS_KEY;

let current: Tls | null = null;
let fileStamp = 0;
let lastError: CertState['error'] = null;
// The SMTP server (mailer.ts) and the mail apps' servers (mailApps.ts) each take a renewed certificate.
const listeners: ((tls: Tls) => void)[] = [];
export const onCertChange = (fn: (tls: Tls) => void) => void listeners.push(fn);
const tell = (tls: Tls) => listeners.forEach((fn) => fn(tls));
/** The certificate being served now (null before loadTls, or without openssl). */
export const currentTls = () => current;

/** The leaf and what it says about itself, or null when the PEM doesn't parse. */
function inspect(certPem: Buffer | string, host: string) {
  try {
    const pems = String(certPem).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    const chain = pems.map((p) => new X509Certificate(p));
    const leaf = chain[0];
    if (!leaf) return null;
    const validTo = new Date(leaf.validTo);
    const selfSigned = leaf.issuer === leaf.subject;
    // Each certificate signed by the next; the last one by a root this machine trusts (Node's own list).
    let chained = !selfSigned && chain.every((c, i) => i === chain.length - 1 || (c.checkIssued(chain[i + 1]) && c.verify(chain[i + 1].publicKey)));
    if (chained) {
      const top = chain[chain.length - 1];
      chained = rootCertificates.some((r) => {
        try {
          const root = new X509Certificate(r);
          return top.checkIssued(root) && top.verify(root.publicKey);
        } catch {
          return false;
        }
      });
    }
    const forHost = !!leaf.checkHost(host);
    const issuer = /(?:^|\n)O=([^\n]+)/.exec(leaf.issuer)?.[1] ?? /(?:^|\n)CN=([^\n]+)/.exec(leaf.issuer)?.[1] ?? leaf.issuer;
    return { validTo, issuer: selfSigned ? 'self-signed' : issuer, trusted: chained && forHost && validTo.getTime() > Date.now(), forHost, selfSigned };
  } catch {
    return null;
  }
}
const daysLeft = (d: Date) => Math.floor((d.getTime() - Date.now()) / 86_400_000);
/** A key and certificate that really belong together: a broken pair would stop the SMTP server from starting. */
const usable = (key: Buffer | string, cert: Buffer | string) => {
  try {
    createSecureContext({ key, cert });
    return true;
  } catch {
    return false;
  }
};

/** The certificate to serve now. Made self-signed once when there's nothing better (null without openssl). */
export function loadTls(host: string): Tls | null {
  if (fileConfigured()) {
    const k = process.env.MAIL_TLS_KEY!, c = process.env.MAIL_TLS_CERT!;
    if (existsSync(k) && existsSync(c)) {
      fileStamp = Math.max(statSync(k).mtimeMs, statSync(c).mtimeMs);
      const key = readFileSync(k), cert = readFileSync(c);
      if (usable(key, cert)) return (current = { key, cert, source: 'file' });
      lastError = { at: new Date().toISOString(), message: 'MAIL_TLS_CERT and MAIL_TLS_KEY don’t make a usable pair.' };
    }
  }
  if (existsSync(acmeFiles.key) && existsSync(acmeFiles.cert)) {
    const cert = readFileSync(acmeFiles.cert);
    const info = inspect(cert, host);
    const key = readFileSync(acmeFiles.key);
    if (info?.forHost && info.validTo.getTime() > Date.now() && usable(key, cert)) return (current = { key, cert, source: 'acme' });
  }
  if (!existsSync(selfFiles.key) || !existsSync(selfFiles.cert)) {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', selfFiles.key, '-out', selfFiles.cert, '-days', '3650', '-subj', `/CN=${host}`], { stdio: 'ignore' });
    } catch {
      return (current = null); // no openssl: plain SMTP only
    }
  }
  return (current = { key: readFileSync(selfFiles.key), cert: readFileSync(selfFiles.cert), source: 'self-signed' });
}

export function certState(host: string): CertState {
  const info = current ? inspect(current.cert, host) : null;
  return {
    source: current?.source ?? 'none',
    issuer: info?.issuer ?? null,
    validTo: info ? info.validTo.toISOString() : null,
    daysLeft: info ? daysLeft(info.validTo) : null,
    trusted: !!info?.trusted,
    acme: acmeConfigured(),
    error: lastError,
  };
}

/* ---------- Let's Encrypt over Cloudflare DNS ---------- */

async function cf<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${process.env.CF_DNS_TOKEN}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] };
  if (!r.ok || !j.success) throw new Error(`Cloudflare refused (${r.status}): ${j.errors?.map((e) => e.message).join('; ') || 'no reason given'}`);
  return j.result as T;
}
/** The Cloudflare zone a name lives in: CF_ZONE_ID, else the longest parent name the token can see. */
export async function zoneFor(name: string): Promise<string> {
  if (process.env.CF_ZONE_ID) return process.env.CF_ZONE_ID;
  const labels = name.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const zones = await cf<{ id: string }[]>(`/zones?name=${encodeURIComponent(labels.slice(i).join('.'))}`);
    if (zones.length) return zones[0].id;
  }
  throw new Error(`No Cloudflare zone for ${name} that CF_DNS_TOKEN can see.`);
}

let renewing = false;
/** Gets or renews the Let's Encrypt certificate when it's missing, not for this host, or under 30 days from expiry. */
export async function ensureAcme(host: string, log: (line: string) => void, force = false): Promise<boolean> {
  if (!acmeConfigured() || fileConfigured() || renewing) return false;
  if (host === 'localhost' || !host.includes('.')) return false;
  const have = existsSync(acmeFiles.cert) ? inspect(readFileSync(acmeFiles.cert), host) : null;
  if (!force && have?.forHost && daysLeft(have.validTo) > 30) return false;
  renewing = true;
  const created: { zone: string; id: string }[] = [];
  try {
    const acme = await import('acme-client'); // loaded only when Let's Encrypt is set up
    mkdirSync(ACME_DIR, { recursive: true });
    if (!existsSync(acmeFiles.account)) writeFileSync(acmeFiles.account, await acme.crypto.createPrivateKey(), { mode: 0o600 });
    const client = new acme.Client({
      directoryUrl: process.env.ACME_STAGING === '1' ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
      accountKey: readFileSync(acmeFiles.account),
    });
    const [key, csr] = await acme.crypto.createCsr({ commonName: host });
    const email = process.env.SUPPORT_EMAIL;
    const cert = await client.auto({
      csr,
      ...(email ? { email } : {}),
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'dns-01') throw new Error('Only DNS challenges are set up here.');
        const zone = await zoneFor(authz.identifier.value);
        const rec = await cf<{ id: string }>(`/zones/${zone}/dns_records`, { method: 'POST', body: JSON.stringify({ type: 'TXT', name: `_acme-challenge.${authz.identifier.value}`, content: keyAuthorization, ttl: 60 }) });
        created.push({ zone, id: rec.id });
      },
      challengeRemoveFn: async () => {
        for (const r of created.splice(0)) await cf(`/zones/${r.zone}/dns_records/${r.id}`, { method: 'DELETE' }).catch(() => {});
      },
    });
    if (!usable(key, cert)) throw new Error('Let’s Encrypt sent a certificate that doesn’t match its key.');
    writeFileSync(acmeFiles.key, key, { mode: 0o600 });
    writeFileSync(acmeFiles.cert, cert);
    lastError = null;
    current = { key: Buffer.from(key), cert: Buffer.from(cert), source: 'acme' };
    tell(current);
    const info = inspect(cert, host);
    log(`[mail] New certificate for ${host} from Let's Encrypt${info ? `, valid until ${info.validTo.toISOString().slice(0, 10)}` : ''}`);
    return true;
  } catch (e) {
    lastError = { at: new Date().toISOString(), message: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    log(`[mail] Let's Encrypt certificate for ${host} failed: ${lastError.message}`);
    for (const r of created.splice(0)) await cf(`/zones/${r.zone}/dns_records/${r.id}`, { method: 'DELETE' }).catch(() => {});
    return false;
  } finally {
    renewing = false;
  }
}

/** Picks up a renewed MAIL_TLS_CERT file (e.g. from certbot or the proxy) without a restart. */
function rereadFiles(host: string) {
  if (!fileConfigured()) return;
  const k = process.env.MAIL_TLS_KEY!, c = process.env.MAIL_TLS_CERT!;
  if (!existsSync(k) || !existsSync(c)) return;
  if (Math.max(statSync(k).mtimeMs, statSync(c).mtimeMs) <= fileStamp) return;
  const next = loadTls(host);
  if (next) tell(next);
}

/** Checks the certificate soon after the start and twice a day. Without CF_DNS_TOKEN or the files it does nothing. */
export function startCertKeeper(host: string, log: (line: string) => void) {
  const run = () => {
    rereadFiles(host);
    void ensureAcme(host, log);
  };
  setTimeout(run, 15_000);
  setInterval(run, 12 * 3600_000);
}
