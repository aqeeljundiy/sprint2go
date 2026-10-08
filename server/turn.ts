// The call relay (TURN) for huddles. Browsers that can't reach each other directly (strict NATs on mobile carriers,
// office firewalls) send their audio through it instead. coturn checks short-lived credentials made from a secret we
// share with it (its "TURN REST API" scheme), so the secret itself never leaves this server. Setup: docs/turn.md.
import { createHmac, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { connect } from 'node:net';

const TTL = 3600; // seconds new connections may use a set of credentials

/** The relay's addresses: TURN_URLS, comma-separated turn: and turns: URLs. */
export const urls = (process.env.TURN_URLS ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter((u) => /^turns?:\S+$/i.test(u));
const secret = process.env.TURN_SECRET ?? '';
export const configured = urls.length > 0 && secret.length > 0;

/** Credentials for one person: username "expiry:userId", password base64(HMAC-SHA1(secret, username)). */
export function credentials(userId: string, now = Date.now()) {
  if (!configured) return null;
  const expires = Math.floor(now / 1000) + TTL;
  const username = `${expires}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential, expiresAt: expires * 1000 };
}

/** turn:host:port?transport=udp as its parts (turn: defaults to 3478 over UDP, turns: to 5349 over TLS). */
export function parse(url: string) {
  const m = /^(turns?):(\[[^\]]+\]|[^:?]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/i.exec(url.trim());
  if (!m) return null;
  const tls = m[1].toLowerCase() === 'turns';
  return { host: m[2].replace(/^\[|\]$/g, ''), port: Number(m[3] ?? (tls ? 5349 : 3478)), transport: tls ? 'tls' : ((m[4]?.toLowerCase() ?? 'udp') as 'udp' | 'tcp') };
}
type Target = NonNullable<ReturnType<typeof parse>>;

/** Does anything answer at this address? Over UDP: a STUN binding request, which coturn always answers. */
function answers(t: Target, wait = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      try {
        if (sock) sock.close();
        else tcp?.destroy();
      } catch {
        /* already closed */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), wait);
    let sock: ReturnType<typeof createSocket> | null = null;
    let tcp: ReturnType<typeof connect> | null = null;
    if (t.transport === 'udp') {
      const id = randomBytes(12);
      const msg = Buffer.alloc(20);
      msg.writeUInt16BE(0x0001, 0); // binding request, no attributes
      msg.writeUInt32BE(0x2112a442, 4); // magic cookie
      id.copy(msg, 8);
      sock = createSocket(t.host.includes(':') ? 'udp6' : 'udp4');
      sock.on('error', () => done(false));
      sock.on('message', (m) => m.length >= 20 && m.readUInt16BE(0) === 0x0101 && m.subarray(8, 20).equals(id) && done(true));
      sock.send(msg, t.port, t.host, (e) => e && done(false));
    } else {
      tcp = connect({ host: t.host, port: t.port }, () => done(true));
      tcp.on('error', () => done(false));
    }
  });
}

let last: { at: number; ok: Promise<boolean> } | null = null;
/** For the operator console: is the relay set up, and does it answer (checked at most every five minutes)? */
export async function health(): Promise<{ configured: boolean; addresses: string[]; reachable: boolean | null; checked: string | null }> {
  if (!configured) return { configured: false, addresses: [], reachable: null, checked: null };
  const targets = urls.map(parse).filter((t): t is Target => !!t);
  const t = targets.find((x) => x.transport === 'udp') ?? targets[0];
  const addresses = [...new Set(targets.map((x) => `${x.host}:${x.port} ${x.transport.toUpperCase()}`))];
  if (!t) return { configured: true, addresses, reachable: false, checked: null };
  if (!last || Date.now() - last.at > 5 * 60_000) last = { at: Date.now(), ok: answers(t) };
  return { configured: true, addresses, reachable: await last.ok, checked: `${t.host}:${t.port} ${t.transport.toUpperCase()}` };
}
