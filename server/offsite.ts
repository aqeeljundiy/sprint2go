// An off-site copy of each daily backup, gzipped, in S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO),
// so losing this server doesn't lose the data. The last 30 are kept there.
// Env: S3_BUCKET, S3_KEY, S3_SECRET, and S3_ENDPOINT (R2: https://<account>.r2.cloudflarestorage.com, B2:
// https://s3.<region>.backblazeb2.com; leave it out for AWS) and/or S3_REGION (R2: auto). Optional S3_PREFIX (default
// "sprint2go/"). Without them nothing is uploaded and the operator console says so.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCb } from 'node:zlib';
import { canonicalQuery, sha256Hex, signV4, uriEncode } from './sigv4.ts';
import * as platform from './platform.ts';

const gzip = promisify(gzipCb);
const KEEP = 30;

export function s3Config() {
  const { S3_BUCKET: bucket, S3_KEY: key, S3_SECRET: secret } = process.env;
  const endpoint = (process.env.S3_ENDPOINT ?? '').replace(/\/+$/, '');
  if (!bucket || !key || !secret || (!endpoint && !process.env.S3_REGION)) return null;
  const region = process.env.S3_REGION || (endpoint ? 'auto' : 'us-east-1');
  const prefix = (process.env.S3_PREFIX ?? 'sprint2go/').replace(/^\/+/, '');
  // AWS: the bucket's own host. Everyone else: path style on their endpoint.
  const base = endpoint ? new URL(endpoint) : new URL(`https://${bucket}.s3.${region}.amazonaws.com`);
  const pathStyle = !!endpoint;
  const where = pathStyle ? `${base.host}/${bucket}/${prefix}` : `s3://${bucket}/${prefix}`;
  return { bucket, key, secret, region, prefix, where, host: base.host, origin: base.origin, root: `${base.pathname.replace(/\/+$/, '')}${pathStyle ? `/${uriEncode(bucket)}` : ''}` };
}
export const offsiteConfigured = () => !!s3Config();

type Cfg = NonNullable<ReturnType<typeof s3Config>>;
async function s3(c: Cfg, method: 'GET' | 'PUT' | 'DELETE', objectKey: string, opts: { body?: Buffer; query?: Record<string, string>; type?: string } = {}) {
  const path = objectKey ? `${c.root}/${uriEncode(objectKey, true)}` : c.root || '/';
  const query = opts.query ? canonicalQuery(opts.query) : '';
  const payloadHash = sha256Hex(opts.body ?? '');
  const signed = signV4({ method, host: c.host, path, query, headers: { 'x-amz-content-sha256': payloadHash, ...(opts.type ? { 'content-type': opts.type } : {}) }, payloadHash, region: c.region, service: 's3', key: c.key, secret: c.secret });
  const r = await fetch(`${c.origin}${path}${query ? `?${query}` : ''}`, { method, headers: signed.headers, body: opts.body ? new Uint8Array(opts.body) : undefined, signal: AbortSignal.timeout(10 * 60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${objectKey || '(list)'} refused (${r.status}): ${(/<Message>([^<]*)<\/Message>/.exec(text)?.[1] ?? text).slice(0, 200)}`);
  return text;
}
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
async function list(c: Cfg) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const xml = await s3(c, 'GET', '', { query: { 'list-type': '2', prefix: c.prefix, ...(token ? { 'continuation-token': token } : {}) } });
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(unxml(m[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || undefined : undefined;
  } while (token);
  return keys;
}

export interface OffsiteState {
  at: string; // last upload
  file: string;
  bytes: number;
  kept: number;
  error?: { at: string; message: string } | null; // the last attempt, when it failed
}
const saved = () => platform.settings().offsite ?? null;
const save = (s: OffsiteState) => platform.setSetting('offsite', s);

/** Gzips one backup, uploads it, and keeps the newest 30 daily copies there. The result is saved for the console. */
export async function uploadBackup(file: string): Promise<OffsiteState> {
  const c = s3Config();
  if (!c) throw new Error('Off-site copies aren’t set up (S3_* is missing).');
  const prev = saved();
  try {
    const body = await gzip(readFileSync(file));
    const name = `${basename(file)}.gz`;
    await s3(c, 'PUT', `${c.prefix}${name}`, { body, type: 'application/gzip' });
    const daily = (await list(c)).filter((k) => /sprint2go-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(k)).sort();
    for (const k of daily.slice(0, -KEEP)) await s3(c, 'DELETE', k);
    const state: OffsiteState = { at: new Date().toISOString(), file: name, bytes: body.length, kept: Math.min(daily.length, KEEP), error: null };
    save(state);
    return state;
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    save({ ...(prev ?? { at: '', file: '', bytes: 0, kept: 0 }), error: { at: new Date().toISOString(), message } });
    throw e;
  }
}

/** What the operator console shows: not set up, the last upload, and the last failure if the newest attempt failed. */
export function offsiteState() {
  const c = s3Config();
  const s = saved();
  return { configured: !!c, where: c?.where ?? null, last: s?.at ? { at: s.at, file: s.file, bytes: s.bytes, kept: s.kept } : null, error: s?.error ?? null };
}
