// Where huddle audio may travel: public STUN servers find each browser's outside address, and our call relay (TURN),
// when the server has one, carries the audio when two browsers can't reach each other directly. Relay credentials
// come from GET /api/ice and work for an hour; they're fetched again before they run out.
import { t } from './i18n';
import { fmtList } from './i18n/format';

export const STUN: RTCIceServer = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

export interface Ice {
  config: RTCConfiguration;
  relay: boolean; // the relay is in the list
}

const EARLY = 10 * 60_000; // ask for new credentials when fewer than ten minutes are left
let last: { ice: Ice; until: number } | null = null;
let pending: Promise<Ice> | null = null;

export function iceConfig(): Promise<Ice> {
  if (last && Date.now() < last.until) return Promise.resolve(last.ice);
  return (pending ??= fetch('/api/ice', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (b: { relay?: boolean; iceServers?: RTCIceServer[]; expiresAt?: number } | null) => {
        const relay = !!b?.relay && !!b.iceServers?.length;
        const ice: Ice = { config: { iceServers: [STUN, ...(relay ? b!.iceServers! : [])] }, relay };
        if (b) last = { ice, until: relay && b.expiresAt ? b.expiresAt - EARLY : Date.now() + EARLY };
        return ice;
      },
      () => ({ config: { iceServers: [STUN] }, relay: false }), // no server (the demo) or offline: direct only
    )
    .finally(() => (pending = null)));
}

/** The config with relay passwords masked, for logs. */
export const redacted = (c: RTCConfiguration) => ({ ...c, iceServers: c.iceServers?.map((s) => (s.credential ? { ...s, credential: `(${String(s.credential).length} characters)` } : s)) });

/**
 * For operators: can this browser get an address on the relay? Asks for relay candidates only, the way a huddle
 * would through it, so it checks the whole chain: the address, the ports, the external IP and the shared secret.
 */
export async function testRelay(): Promise<{ ok: boolean; text: string }> {
  const r = await fetch('/api/ice', { cache: 'no-store' }).catch(() => null);
  if (r?.status === 403) return { ok: false, text: t('This account isn’t in a company, so it gets no relay credentials. Run the test signed in as a team member.') };
  const b = (r?.ok ? await r.json().catch(() => null) : null) as { relay?: boolean; iceServers?: RTCIceServer[] } | null;
  if (!b?.relay || !b.iceServers?.length) return { ok: false, text: t('The relay isn’t set up on this server.') };
  const pc = new RTCPeerConnection({ iceServers: b.iceServers, iceTransportPolicy: 'relay' });
  const got = new Set<string>();
  const unreachable = new Set<string>();
  let refused = false;
  const transport = (url?: string | null) => (url?.startsWith('turns:') ? 'TLS' : /transport=tcp/i.test(url ?? '') ? 'TCP' : 'UDP');
  pc.addEventListener('icecandidateerror', (e) => {
    const { errorCode, url } = e as RTCPeerConnectionIceErrorEvent;
    if (errorCode === 401) refused = true;
    else if (errorCode === 701) unreachable.add(transport(url));
  });
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 8000);
    pc.addEventListener('icecandidate', (e) => {
      if (!e.candidate) return (clearTimeout(timer), resolve());
      if (e.candidate.type === 'relay') got.add(transport((e as RTCPeerConnectionIceEvent & { url?: string | null }).url));
    });
  });
  pc.createDataChannel('relay-test');
  await pc.setLocalDescription(await pc.createOffer());
  await done;
  pc.close();
  if (got.size) return { ok: true, text: t('It works: this browser got a relay address over {how}.', { how: fmtList([...got]) }) };
  if (refused) return { ok: false, text: t('The relay refused our credentials. TURN_SECRET here must match static-auth-secret in coturn.') };
  const check = t('Check that coturn is running and that UDP 3478 and its relay ports are open on the server.');
  if (unreachable.size) return { ok: false, text: t('No relay address came back (no answer over {how}). {check}', { how: fmtList([...unreachable]), check }) };
  return { ok: false, text: t('No relay address came back. {check}', { check }) };
}
