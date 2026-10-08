// Amazon SES (the v2 API, signed by hand so there's no SDK to carry). Used for two things:
// - "Boosted sending": a company's mail goes out through Amazon on our account (better delivery, paid in credits)
// - the app's own notes when nothing else is set up (sign-up codes, guest notices)
// Configured with SES_KEY, SES_SECRET, SES_REGION and MAIL_FROM. Without them nothing is sent and callers fall back to
// what they did before (the code in the server log, a link to copy).
import { createHash, createHmac } from 'node:crypto';

const cfg = () => {
  const key = process.env.SES_KEY;
  const secret = process.env.SES_SECRET;
  const region = process.env.SES_REGION ?? 'ap-southeast-1';
  const from = process.env.MAIL_FROM;
  return key && secret && from ? { key, secret, region, from } : null;
};
export const mailConfigured = () => !!cfg();

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();

/** One signed call to the SES v2 API. Throws with Amazon's message on a refusal. */
async function ses<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const c = cfg();
  if (!c) throw new Error('Amazon SES is not configured');
  const host = `email.${c.region}.amazonaws.com`;
  const payload = body === undefined ? '' : JSON.stringify(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${c.region}/ses/aws4_request`;
  const headers: Record<string, string> = { host, 'x-amz-date': amzDate, ...(payload ? { 'content-type': 'application/json' } : {}) };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [method, path, '', ...Object.keys(headers).sort().map((h) => `${h}:${headers[h]}`), '', signedHeaders, sha(payload)].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, day), c.region), 'ses'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const r = await fetch(`https://${host}${path}`, { method, headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${c.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, body: payload || undefined });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Amazon refused (${r.status}): ${text.slice(0, 300)}`), { status: r.status });
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Sends one plain note from our own address. Returns true when SES accepted it, false when mail isn't configured. */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const c = cfg();
  if (!c) return false;
  await ses('POST', '/v2/email/outbound-emails', {
    FromEmailAddress: c.from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' }, ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}) } } },
  });
  return true;
}

/** Sends a finished message (as built by the mail engine) to these addresses, through Amazon. Boosted sending. */
export async function sendRaw(to: string[], raw: Buffer, from?: string) {
  await ses('POST', '/v2/email/outbound-emails', {
    ...(from ? { FromEmailAddress: from } : {}),
    Destination: { ToAddresses: to },
    Content: { Raw: { Data: raw.toString('base64') } },
  });
}

/** Amazon's view of a company's domain: creates the identity the first time, then returns its DKIM tokens and status. */
export async function sesIdentity(domain: string): Promise<{ tokens: string[]; verified: boolean; dkimVerified: boolean }> {
  const d = domain.toLowerCase();
  const read = async () => {
    const r = await ses<any>('GET', `/v2/email/identities/${encodeURIComponent(d)}`);
    return { tokens: r.DkimAttributes?.Tokens ?? [], verified: !!r.VerifiedForSendingStatus, dkimVerified: r.DkimAttributes?.Status === 'SUCCESS' };
  };
  try {
    return await read();
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
    await ses('POST', '/v2/email/identities', { EmailIdentity: d });
    return read();
  }
}

/** A plain, branded email body: a greeting, a few lines, one link. */
export function simpleHtml(brand: string, lines: string[], link?: { text: string; url: string }) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#16161d;max-width:560px">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${link ? `<p><a href="${esc(link.url)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#2448ff;color:#fff;text-decoration:none">${esc(link.text)}</a></p><p style="color:#6b6f7b;font-size:13px">${esc(link.url)}</p>` : ''}<p style="color:#6b6f7b;font-size:13px">${esc(brand)}</p></div>`;
}
