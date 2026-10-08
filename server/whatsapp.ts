// WhatsApp Business (Meta Cloud API): the webhook that brings guests' messages in. Meta checks the address once with
// the company's verify token (GET), then posts every message signed with the Meta app's secret: X-Hub-Signature-256
// is "sha256=" and the HMAC-SHA256 of the raw body. A post is only read when that signature checks out, against
// sprint2go's own Meta app (WHATSAPP_APP_SECRET) or the app secret the company saved when it connected its number.
// With neither secret, the webhook is off: Meta's check fails and posts are refused, nothing is read.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as db from './db.ts';
import { clientPeople } from '../src/clientView.ts';

type Ws = { id: string; members: { userId: string; role: string }[]; whatsapp?: { phoneNumberId?: string; connected?: boolean; verifyToken?: string; secured?: boolean } };
type Broadcast = (coll: string, upserts: db.Doc[], deletes: string[]) => void;

/** Where a company's app secret is kept (sealed, like its access token). */
export const SECRET_KEY = 'whatsapp-secret';
/** sprint2go's own Meta app, when companies connect through it. */
const platformSecret = () => process.env.WHATSAPP_APP_SECRET?.trim() || '';
export const platformSecretSet = () => !!platformSecret();
/** A company's app secret, if it saved one. */
const companySecret = (wsId: string) => db.loadKey(wsId, SECRET_KEY)?.key ?? '';
/** Whether posts for this company can be checked at all (and so are read). */
export const secured = (wsId: string) => !!platformSecret() || !!companySecret(wsId);

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
/** X-Hub-Signature-256 against one secret, in constant time. */
export function signatureOk(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const want = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return same(String(header).trim().toLowerCase(), want);
}

/**
 * Meta's check when the webhook is added: hub.mode=subscribe with a company's verify token. Answered with the
 * challenge only for a connected company whose posts can be checked.
 */
export function challenge(params: URLSearchParams, workspaces: Ws[]): { status: number; body: string } {
  const token = params.get('hub.verify_token') ?? '';
  if (params.get('hub.mode') !== 'subscribe' || !token) return { status: 403, body: '' };
  const w = workspaces.find((x) => !!x.whatsapp?.verifyToken && same(x.whatsapp.verifyToken, token));
  if (!w || !w.whatsapp?.connected || !secured(w.id)) return { status: 403, body: '' };
  return { status: 200, body: String(params.get('hub.challenge') ?? '').slice(0, 200) };
}

/**
 * A post from Meta. Each change names the phone number it's for; it's read only for the company with that number,
 * and only when the signature matches that company's secret (or ours). Returns how many changes were read.
 */
export function receive(raw: Buffer, signature: string | undefined, workspaces: Ws[], broadcast: Broadcast): { status: number; read: number } {
  let b: any;
  try {
    b = JSON.parse(raw.toString('utf8'));
  } catch {
    return { status: 400, read: 0 };
  }
  const ours = signatureOk(raw, signature, platformSecret());
  const trusted = new Map<string, boolean>();
  const trustedFor = (w: Ws) => {
    if (!trusted.has(w.id)) trusted.set(w.id, ours || signatureOk(raw, signature, companySecret(w.id)));
    return trusted.get(w.id)!;
  };
  let read = 0;
  let refused = 0;
  for (const entry of Array.isArray(b?.entry) ? b.entry : [])
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      const w = workspaces.find((x) => x.whatsapp?.connected && !!x.whatsapp.phoneNumberId && x.whatsapp.phoneNumberId === v.metadata?.phone_number_id);
      if (!w) continue;
      if (!trustedFor(w)) {
        refused++;
        continue;
      }
      read++;
      takeMessages(w, v, broadcast);
    }
  // Signed by nobody we know: Meta never sends that, so it's someone else.
  if (!read && (refused || !ours)) return { status: 401, read: 0 };
  return { status: 200, read };
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** The messages in one change: a guest's lands in their project's shared channel; an unknown number goes to admins. */
function takeMessages(w: Ws, v: any, broadcast: Broadcast) {
  const names = new Map((Array.isArray(v.contacts) ? v.contacts : []).map((c: any) => [digits(c?.wa_id), String(c?.profile?.name ?? '').slice(0, 80)]));
  for (const m of Array.isArray(v.messages) ? v.messages.slice(0, 50) : []) {
    const from = digits(m?.from);
    if (!from) continue;
    const text = (m.type === 'text' ? String(m.text?.body ?? '') : `[${String(m.type ?? 'message').slice(0, 20)}]`).slice(0, 4000);
    // Whose number is it? One of a project's guests: their project's shared channel.
    const channels = db.allDocs('channels') as any[];
    const hit = (db.allDocs('clients') as any[])
      .filter((c) => c.workspaceId === w.id)
      .flatMap((c) => clientPeople(c, channels).filter((pp) => pp.phone && digits(pp.phone) === from).map((pp) => ({ c, pp })))[0];
    const at = new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString();
    if (hit) {
      const chan = channels.find((x) => x.clientId === hit.c.id && x.category === 'shared' && !x.archived) ?? channels.find((x) => x.clientId === hit.c.id && !x.archived);
      if (chan) {
        const doc = { id: randomBytes(8).toString('hex'), channelId: chan.id, userId: 'guest', guestEmail: hit.pp.email, text, at, via: 'whatsapp' } as db.Doc;
        db.writeDocs('messages', [doc], [], null);
        broadcast('messages', [doc], []);
        const notices = (chan.members ?? []).map((uid: string) => ({ id: randomBytes(8).toString('hex'), userId: uid, workspaceId: w.id, kind: 'mention', text: `${hit.pp.name} (WhatsApp): ${text.slice(0, 80)}`, at, read: false, link: { app: 'chat', id: chan.id, msg: doc.id } })) as db.Doc[];
        if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
        continue;
      }
    }
    // Unknown number: admins get it, with the number, so they can add the person to a project.
    const admins = (w.members ?? []).filter((x) => x.role !== 'member').map((x) => x.userId);
    const name = names.get(from);
    const notices = admins.map((uid: string) => ({ id: randomBytes(8).toString('hex'), userId: uid, workspaceId: w.id, kind: 'mention', text: `WhatsApp from ${name ? `${name} (+${from})` : '+' + from}: ${text.slice(0, 80)}`, at, read: false, link: { app: 'settings', id: 'apps' } })) as db.Doc[];
    if (notices.length) (db.writeDocs('notices', notices, [], null), broadcast('notices', notices, []));
  }
}
