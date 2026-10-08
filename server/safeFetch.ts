// Fetching an address someone pasted (a calendar link), carefully: only http(s), never into a private network
// (checked on the address actually connected to, so DNS tricks don't get around it, and again on every redirect),
// with a time limit and a size limit. Errors come back as plain sentences for the person who pasted the link.
import { lookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';

export class FetchError extends Error {}

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 (an IPv4 address inside)
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** Private, loopback, link-local and other non-public addresses (IPv4 inside IPv6 included). */
export function isPrivateAddress(address: string) {
  const v = isIP(address);
  if (!v) return true;
  if (v === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

/** Local testing only (never in production): S2G_ALLOW_PRIVATE_FETCH=1 lets links point at this machine. */
const allowPrivate = () => process.env.S2G_ALLOW_PRIVATE_FETCH === '1' && process.env.NODE_ENV !== 'production';

function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, cb: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void) {
  lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = allowPrivate() ? addrs : addrs.filter((a) => !isPrivateAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error('private address'), { code: 'S2G_PRIVATE' }));
    if (options?.all) cb(null, ok);
    else cb(null, ok[0].address, ok[0].family);
  });
}

/** A pasted address, cleaned up: webcal:// becomes https://. Throws a FetchError with what's wrong. */
export function normalizeUrl(raw: string) {
  let s = String(raw ?? '').trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new FetchError('That doesn’t look like a link. It should start with https:// or webcal://.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError('Only https://, http:// and webcal:// links work here.');
  if (u.username || u.password) throw new FetchError('Links with a name and password in them aren’t supported. Use the calendar’s private link instead.');
  u.hash = '';
  return u.toString();
}

export interface Fetched {
  body: Buffer;
  url: string; // where it ended up, after redirects
  type: string;
}

/**
 * GET a public address. `maxBytes` counts what arrives after decompressing. Up to 4 redirects, each checked like the
 * first. Rejects with a FetchError whose message can be shown as it is.
 */
export async function safeGet(raw: string, { timeoutMs = 15_000, maxBytes = 10 * 1024 * 1024, accept = '*/*' } = {}): Promise<Fetched> {
  let url = normalizeUrl(raw);
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= 4; hop++) {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isPrivateAddress(host) && !allowPrivate()) throw new FetchError('That link points inside a private network, so it can’t be used.');
    if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host) && !allowPrivate()) throw new FetchError('That link points inside a private network, so it can’t be used.');
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const left = deadline - Date.now();
      if (left <= 0) return reject(new FetchError('The calendar’s server took too long to answer. Try again in a few minutes.'));
      const req = (u.protocol === 'https:' ? https : http).request(
        u,
        {
          method: 'GET',
          lookup: guardedLookup as never,
          headers: { 'user-agent': 'sprint2go-calendar/1.0', accept, 'accept-encoding': 'gzip, deflate, br' },
          timeout: left,
        },
        resolve,
      );
      req.on('timeout', () => req.destroy(new FetchError('The calendar’s server took too long to answer. Try again in a few minutes.')));
      req.on('error', (e: NodeJS.ErrnoException) => reject(explain(e)));
      req.end();
    });
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = normalizeUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    if (status === 401 || status === 403) (res.resume(), fail('The calendar asks for a sign-in, so it can’t be read from a link. Use its private or public address instead.'));
    if (status === 404 || status === 410) (res.resume(), fail('That link doesn’t work any more. The calendar may have been removed, or its private address reset. Copy the link again.'));
    if (status === 429) (res.resume(), fail('The calendar’s server asked us to slow down. It will be tried again later.'));
    if (status < 200 || status >= 300) (res.resume(), fail(`The calendar’s server answered with an error (${status}). It will be tried again later.`));
    const length = Number(res.headers['content-length'] ?? 0);
    if (length > maxBytes) (res.resume(), fail(tooBig(maxBytes)));
    const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
    const stream: Readable = enc === 'gzip' || enc === 'x-gzip' ? res.pipe(createGunzip()) : enc === 'deflate' ? res.pipe(createInflate()) : enc === 'br' ? res.pipe(createBrotliDecompress()) : res;
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => (res.destroy(), reject(new FetchError('The calendar’s server took too long to send it. Try again in a few minutes.'))), Math.max(1, deadline - Date.now()));
      stream.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          clearTimeout(timer);
          res.destroy();
          reject(new FetchError(tooBig(maxBytes)));
        } else chunks.push(c);
      });
      stream.on('end', () => (clearTimeout(timer), resolve(Buffer.concat(chunks))));
      stream.on('error', (e) => (clearTimeout(timer), reject(e instanceof FetchError ? e : new FetchError('The calendar couldn’t be downloaded. Try again in a few minutes.'))));
    });
    return { body, url, type: String(res.headers['content-type'] ?? '') };
  }
  throw new FetchError('That link sends us round in circles (too many redirects).');
}

const fail = (msg: string): never => {
  throw new FetchError(msg);
};
const tooBig = (max: number) => `The calendar is too big to read (over ${Math.round(max / 1024 / 1024)} MB).`;

function explain(e: NodeJS.ErrnoException): FetchError {
  if (e instanceof FetchError) return e;
  switch (e.code) {
    case 'S2G_PRIVATE':
      return new FetchError('That link points inside a private network, so it can’t be used.');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new FetchError('We couldn’t find that address. Check the link for typos.');
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return new FetchError('The calendar’s server didn’t answer. It will be tried again later.');
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return new FetchError('The calendar’s server has a broken security certificate, so it isn’t safe to read.');
    default:
      return new FetchError('The calendar couldn’t be downloaded. Try again in a few minutes.');
  }
}
