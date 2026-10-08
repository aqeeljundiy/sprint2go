// AWS Signature Version 4, signed by hand (no SDK). Enough for S3-compatible storage: AWS S3, Cloudflare R2,
// Backblaze B2 and MinIO all accept it. Checked against AWS's published examples in scripts/unit-tests.mjs.
import { createHash, createHmac } from 'node:crypto';

export const sha256Hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();
/** RFC 3986 encoding, as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ (and "/" in paths). */
export const uriEncode = (s: string, path = false) =>
  encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, path ? '/' : '%2F');
/** A query string in SigV4's canonical order; use it for the request too, so both match. */
export const canonicalQuery = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

export interface SignInput {
  method: string;
  host: string;
  path: string; // already encoded (uriEncode(key, true)); S3 doesn't normalise it further
  query?: string; // from canonicalQuery
  headers?: Record<string, string>; // any extra headers to sign (names in any case)
  payloadHash: string; // hex sha256 of the body, or 'UNSIGNED-PAYLOAD'
  region: string;
  service: string;
  key: string;
  secret: string;
  date?: Date;
}
/** The headers to send (host, x-amz-date, authorization and the extra ones), plus the pieces for checking. */
export function signV4(i: SignInput) {
  const amzDate = (i.date ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: i.host, 'x-amz-date': amzDate };
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = String(v);
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonical = [i.method.toUpperCase(), i.path || '/', i.query ?? '', ...names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, ' ')}`), '', signedHeaders, i.payloadHash].join('\n');
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secret}`, day), i.region), i.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${i.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const { host: _host, ...send } = headers; // fetch sets Host itself
  return { headers: { ...send, authorization }, authorization, signature, canonical, stringToSign };
}
