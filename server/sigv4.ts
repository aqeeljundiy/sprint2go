// AWS Signature Version 4 for one request, signed by hand (same algorithm as the SES calls in mail.ts), so there's
// no AWS SDK to carry. Used for Claude in Amazon Bedrock.
import { createHash, createHmac } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();

/** The headers to send (host excluded: fetch sets it from the URL), with the signature. Paths without a query string. */
export function sigv4(r: {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  headers?: Record<string, string>;
  now?: Date;
}) {
  const amzDate = (r.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${r.region}/${r.service}/aws4_request`;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) headers[k.toLowerCase()] = String(v).trim();
  headers.host = r.host;
  headers['x-amz-date'] = amzDate;
  if (r.sessionToken) headers['x-amz-security-token'] = r.sessionToken;
  const names = Object.keys(headers).sort();
  const signed = names.join(';');
  const path = r.path.split('/').map((s) => encodeURIComponent(decodeURIComponent(s))).join('/');
  const canonical = [r.method, path, '', ...names.map((h) => `${h}:${headers[h]}`), '', signed, sha(r.body)].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${r.secretAccessKey}`, day), r.region), r.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _h, ...send } = headers;
  return { ...send, authorization: `AWS4-HMAC-SHA256 Credential=${r.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}
