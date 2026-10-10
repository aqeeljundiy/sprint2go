// Phishing signs in received mail, and links checked before they open. Shared by the mail engine (on arrival, stored
// on the message as `warn`) and the reader (the banner, and links clicked). No imports beyond types: the server loads
// this file as it is.
import type { MailWarning } from './types';

const lower = (s: unknown) => String(s ?? '').toLowerCase().trim();

const TWO_PART = /^(co|com|net|org|ac|go|or|web|my|sch|biz|gov|edu|mil|ne|gen)\.[a-z]{2}$/;
/** The part of a host a company owns: "mail.bank.co.id" is "bank.co.id", "a.b.example.com" is "example.com". */
export function baseDomain(host: string): string {
  const h = lower(host).replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return TWO_PART.test(last2) ? parts.slice(-3).join('.') : last2;
}
export const domainOfEmail = (email: string) => lower(email).split('@')[1] ?? '';

/** Names people trust that phishing likes to borrow (and the company's own domains are added to these). */
export const TRUSTED = ['google.com', 'gmail.com', 'microsoft.com', 'outlook.com', 'office.com', 'live.com', 'apple.com', 'icloud.com', 'amazon.com', 'paypal.com', 'facebook.com', 'instagram.com', 'whatsapp.com', 'linkedin.com', 'dropbox.com', 'docusign.com', 'netflix.com', 'stripe.com', 'shopify.com', 'xero.com', 'bca.co.id', 'klikbca.com', 'bankmandiri.co.id', 'bri.co.id', 'bni.co.id', 'tokopedia.com', 'shopee.co.id', 'gojek.com', 'grab.com', 'dana.id', 'ovo.id', 'sprint2go.com'];

/** Letters that look alike, folded so "paypa1" and "rnicrosoft" read as what they imitate. */
const fold = (s: string) => s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[0]/g, 'o').replace(/[1|]/g, 'l').replace(/[5]/g, 's').replace(/cl/g, 'd');

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * The trusted domain this one imitates ("paypa1.com", "pixelandprofit.com", "google.com.secure-login.net",
 * "xn--pypal-4ve.com"), or null. The same domain or one of its own subdomains is never a lookalike.
 */
export function lookalikeOf(host: string, trusted: string[]): string | null {
  const h = lower(host);
  if (!h) return null;
  const base = baseDomain(h);
  const list = Array.from(new Set(trusted.map(lower).filter(Boolean)));
  if (list.some((t) => base === baseDomain(t))) return null;
  const name = base.split('.')[0];
  for (const t of list) {
    const tb = baseDomain(t);
    const tn = tb.split('.')[0];
    if (tn.length < 4) continue;
    // Same name under another ending is only suspicious with tricks on top (bank.co vs bank.co.id is common enough).
    if (name === tn) {
      if (base !== tb && (h.startsWith('xn--') || /secure|login|verify|account|update/.test(h))) return tb;
      continue;
    }
    if (fold(name) === fold(tn)) return tb;
    if (tn.length >= 5 && distance(name, tn) === 1) return tb;
    if (tn.length >= 8 && distance(name, tn) === 2) return tb;
    // The trusted name dressed up inside another domain: "google.com.account-check.net", "paypal-secure.com".
    if (h.includes(`${tb}.`) || new RegExp(`(^|[.-])${tn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[-.](secure|login|verify|account|support|update|billing|service)`).test(h)) return tb;
  }
  if (base.split('.').some((p) => p.startsWith('xn--'))) return list.find((t) => distance(name.replace(/^xn--/, '').replace(/-[a-z0-9]+$/, ''), baseDomain(t).split('.')[0]) <= 2) ?? base;
  return null;
}

/** spf=fail dkim=none dmarc=fail …, read. `failed`: the sender couldn't be verified. */
export function authOf(auth: string | undefined): { spf: string; dkim: string; dmarc: string; arc: boolean; failed: boolean; none: boolean } {
  const a = lower(auth);
  const get = (k: string) => a.match(new RegExp(`${k}=([a-z-]+)`))?.[1] ?? '-';
  const spf = get('spf');
  const dkim = get('dkim');
  const dmarc = get('dmarc');
  const arc = /arc=pass/.test(a);
  const failed = !arc && (dmarc === 'fail' || (spf === 'fail' && dkim !== 'pass') || spf === 'softfail' && dkim !== 'pass' && dmarc !== 'pass');
  return { spf, dkim, dmarc, arc, failed, none: !auth || (spf === '-' && dkim !== 'pass' && dmarc === '-') };
}

/** Links whose words show one address and whose target is another ("www.bank.co.id" going to bank-login.ru). */
export function linkMismatches(html: string | undefined): { text: string; href: string }[] {
  if (!html) return [];
  const out: { text: string; href: string }[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 10) {
    const href = m[1].replace(/&amp;/g, '&').trim();
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    const shown = text.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?$/i)?.[1];
    if (!shown) continue;
    const target = hostOf(href);
    if (target && baseDomain(target) !== baseDomain(shown)) out.push({ text, href });
  }
  return out;
}

export function hostOf(href: string): string {
  try {
    return lower(new URL(href).hostname);
  } catch {
    return '';
  }
}

export interface SafetyCtx {
  /** The company's own domains (its mailboxes' and its people's). */
  ownDomains: string[];
  /** The people of the company, for display-name spoofing. */
  colleagues: { name: string; email: string }[];
  /** First email from this address to the company (worked out by the server from what's stored). */
  firstTime?: boolean;
}

/**
 * What looks wrong about one received message. Only real signs: a failed check, a lookalike domain, a colleague's
 * name on an outside address, links that hide where they go. "First time" is only added next to one of those (on its
 * own it's most new mail, and a banner on every first email teaches people to ignore banners).
 */
export function warningsFor(m: { from: { name: string; email: string }; auth?: string; html?: string; body?: string }, ctx: SafetyCtx): MailWarning[] {
  const out: MailWarning[] = [];
  const fromDomain = domainOfEmail(m.from.email);
  const own = ctx.ownDomains.map(lower);
  const ownSender = own.some((d) => baseDomain(d) === baseDomain(fromDomain));
  if (authOf(m.auth).failed) out.push({ kind: 'auth', detail: fromDomain });
  const looks = fromDomain && !ownSender ? lookalikeOf(fromDomain, [...own, ...TRUSTED]) : null;
  if (looks) out.push({ kind: 'lookalike', detail: looks });
  const name = lower(m.from.name).replace(/\s+/g, ' ');
  if (name && !ownSender) {
    const mate = ctx.colleagues.find((c) => {
      const cn = lower(c.name).replace(/\s+/g, ' ');
      return cn.length >= 3 && (cn === name || (cn.includes(' ') && name.startsWith(cn))) && lower(c.email) !== lower(m.from.email);
    });
    if (mate) out.push({ kind: 'spoof', detail: mate.name });
  }
  const bad = linkMismatches(m.html);
  if (bad.length) out.push({ kind: 'links', detail: hostOf(bad[0].href) });
  if (out.length && ctx.firstTime) out.push({ kind: 'first' });
  return out;
}

/** How bad the signs are: 'danger' (likely phishing) or 'caution', or null when there are none. */
export function warningLevel(w: MailWarning[] | undefined): 'danger' | 'caution' | null {
  if (!w?.length) return null;
  if (w.some((x) => x.kind === 'lookalike' || x.kind === 'spoof' || x.kind === 'reported')) return 'danger';
  if (w.some((x) => x.kind === 'auth') && w.some((x) => x.kind === 'links')) return 'danger';
  return 'caution';
}

export type LinkWhy = 'scheme' | 'ip' | 'punycode' | 'lookalike' | 'mismatch' | 'userinfo' | 'shortener';
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly', 's.id', 'shorturl.at', 'rb.gy'];

/**
 * A link about to open: why it looks unsafe, or [] when it looks fine. `text` is what the link said; `warned` is set
 * when the email itself already looked suspicious (then shortened links, which hide where they go, count too).
 */
export function checkLink(href: string, text: string, trusted: string[], warned = false): { why: LinkWhy[]; host: string; looks?: string } {
  const why: LinkWhy[] = [];
  const raw = String(href ?? '').trim();
  if (/^(javascript|data|vbscript|file):/i.test(raw)) return { why: ['scheme'], host: '' };
  if (/^(mailto|tel|sms|#|\/(?!\/))/i.test(raw)) return { why: [], host: '' };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { why: [], host: '' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { why: ['scheme'], host: u.hostname };
  const host = lower(u.hostname);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) why.push('ip');
  if (host.split('.').some((p) => p.startsWith('xn--'))) why.push('punycode');
  if (u.username || u.password) why.push('userinfo');
  const looks = lookalikeOf(host, [...trusted, ...TRUSTED]);
  if (looks) why.push('lookalike');
  const shown = String(text ?? '').trim().match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?$/i)?.[1];
  if (shown && baseDomain(shown) !== baseDomain(host)) why.push('mismatch');
  if (warned && SHORTENERS.includes(host)) why.push('shortener');
  return { why, host, looks: looks ?? undefined };
}
