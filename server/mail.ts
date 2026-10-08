// Outgoing email through Amazon SES (the v2 API, signed by hand so there's no SDK to carry).
// Configured with SES_KEY, SES_SECRET, SES_REGION and MAIL_FROM. Without them nothing is sent and callers
// fall back to what they did before (the code in the server log, a link to copy).
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

/** Sends one email. Returns true when SES accepted it, false when mail isn't configured; throws on a refusal. */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const c = cfg();
  if (!c) return false;
  const host = `email.${c.region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const payload = JSON.stringify({
    FromEmailAddress: c.from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' }, ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}) } } },
  });
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${c.region}/ses/aws4_request`;
  const headers: Record<string, string> = { host, 'content-type': 'application/json', 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = ['POST', path, '', ...Object.keys(headers).sort().map((h) => `${h}:${headers[h]}`), '', signedHeaders, sha(payload)].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const kDate = hmac(`AWS4${c.secret}`, day);
  const kRegion = hmac(kDate, c.region);
  const kService = hmac(kRegion, 'ses');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const r = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${c.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    body: payload,
  });
  if (!r.ok) throw new Error(`SES refused the email (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return true;
}

/** A plain, branded email body: a greeting, a few lines, one link. */
export function simpleHtml(brand: string, lines: string[], link?: { text: string; url: string }) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#16161d;max-width:560px">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${link ? `<p><a href="${esc(link.url)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#2448ff;color:#fff;text-decoration:none">${esc(link.text)}</a></p><p style="color:#6b6f7b;font-size:13px">${esc(link.url)}</p>` : ''}<p style="color:#6b6f7b;font-size:13px">${esc(brand)}</p></div>`;
}
