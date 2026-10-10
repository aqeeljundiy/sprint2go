// Sending from mail apps: SMTP submission on 587 (STARTTLS) and 465 (implicit TLS). AUTH PLAIN or LOGIN only once the
// line is encrypted, only with an app password (server/mailApps.ts). The From must be an address the person may send
// as (their mailboxes and the aliases that deliver into them); then the email takes the same path as one sent in
// sprint2go: it's saved in its conversation (or a new one, which shows in Sent), handed to the mail engine's queue
// (server/mailer.ts queueSend: DKIM, the outbox, sending limits, the local "held on this computer" rule) and its
// delivery state shows in the app. Read tracking stays off for these. Mail apps have their own Undo send, so there's no
// second wait here.
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { randomBytes } from 'node:crypto';
import * as store from './imapStore.ts';
import * as raws from './mailRaw.ts';
import { queueSend, MAIL_HOST, type Outgoing } from './mailer.ts';

export interface Sender {
  address: string;
  mailbox: store.Mailbox;
}
export interface SubmissionDeps {
  tls: () => { key: Buffer; cert: Buffer };
  login: (username: string, password: string, ip: string) => Promise<{ ok: true; userId: string; passwordId: string } | { ok: false; why: string }>;
  stillOk: (userId: string, passwordId: string) => boolean;
  /** Who this person may send as, and from which mailbox. */
  senders: (userId: string) => Sender[];
  writer: store.Writer;
  /** Why this mailbox can't send right now (company read-only, sending not set up), or null. */
  blocked: (mb: store.Mailbox) => Promise<string | null>;
  log: (line: string) => void;
}
let deps: SubmissionDeps;

const MAX_SIZE = 25 * 1024 * 1024;
const MAX_RCPT = 100;
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const err = (message: string, responseCode: number) => Object.assign(new Error(message.replace(/[’‘]/g, "'").replace(/[^\x20-\x7e]/g, '')), { responseCode });
type Who = { userId: string; passwordId: string };
const whoOf = (s: SMTPServerSession): Who | null => {
  try {
    return s.user ? (JSON.parse(s.user) as Who) : null;
  } catch {
    return null;
  }
};

/** One email from a mail app, start to finish. Returns why it wasn't taken (an SMTP error), or nothing. */
export async function submit(who: Who, envelope: { from: string; to: string[] }, rawIn: Buffer): Promise<void> {
  if (!deps.stillOk(who.userId, who.passwordId)) throw err('This app password no longer works', 535);
  const raw = raws.crlf(rawIn);
  const r = await store.read(raw);
  const senders = deps.senders(who.userId);
  const as = (addr: string) => senders.find((s) => s.address === lower(addr));
  const fromHeader = r.from.email || lower(envelope.from);
  const sender = as(fromHeader);
  if (!sender) throw err(`You can't send as ${fromHeader || 'that address'}. Send from one of your sprint2go addresses: ${senders.map((s) => s.address).slice(0, 6).join(', ')}`, 553);
  if (!as(envelope.from)) throw err(`The envelope sender ${envelope.from} isn't one of your addresses`, 553);
  const mb = sender.mailbox;
  if (!mb.hosted) throw err(`${mb.email} stays with its own mail provider, so mail from it goes out there`, 550);
  const why = await deps.blocked(mb);
  if (why) throw err(why, 550);
  // Who gets it: the envelope decides; the To and Cc lines say who was named, everyone else was a Bcc.
  const rcpt = [...new Set(envelope.to.map(lower))];
  const named = new Set([...r.to, ...r.cc].map((p) => p.email));
  const keep = (ps: store.P[]) => ps.filter((p, i) => rcpt.includes(p.email) && ps.findIndex((x) => x.email === p.email) === i);
  const to = keep(r.to);
  const cc = keep(r.cc).filter((p) => !to.some((x) => x.email === p.email));
  const bcc = rcpt.filter((e) => !named.has(e)).map((email) => r.bcc.find((p) => p.email === email) ?? { name: email.split('@')[0], email });
  if (!to.length && !cc.length && !bcc.length) throw err('No recipients', 554);
  const subject = String(r.parsed.subject ?? '').slice(0, 500);
  const ctx = new store.Ctx();
  // Sent twice (a mail app trying again after a dropped line), or appended to Sent first: one copy, sent once.
  const same = store.findByMid(ctx, mb, r.mid);
  if (same && ['held', 'sending', 'sent', 'local'].includes(String(same.m.delivery?.state ?? ''))) return;
  const files = store.saveAttachments(r.parsed, mb.wsId, who.userId);
  const fromName = r.parsed.from?.value?.[0]?.name || mb.name;
  let tid: string;
  let mid: string;
  let made: 'thread' | 'message' | null = null;
  if (same) {
    tid = same.t.id;
    mid = same.m.id;
  } else {
    const msg: store.Msg = {
      id: 'm-' + randomBytes(6).toString('hex'),
      mid: r.mid ?? `<${randomBytes(12).toString('hex')}@${sender.address.split('@')[1] || MAIL_HOST}>`,
      from: { name: fromName, email: sender.address },
      to,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      date: new Date().toISOString(),
      body: (r.parsed.text ?? '').trim(),
      html: r.parsed.html || undefined,
      ...(files.length ? { attachments: files } : {}),
    };
    // A reply lands in its conversation; anything else starts one (it shows in Sent, as mail sent in sprint2go does).
    const existing = store.threadFor(ctx, mb, r.refs);
    const thread: store.Thread = existing
      ? { ...existing, messages: [...existing.messages, msg] }
      : { id: 't-' + randomBytes(6).toString('hex'), accountId: mb.id, workspaceId: mb.wsId, subject: subject.replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, '').trim() || '(no subject)', location: 'archive', starred: false, unread: false, labels: [], messages: [msg] };
    raws.keepRaw(thread.id, msg.id, raw);
    const saved = deps.writer.write(who.userId, [thread], []);
    if (!saved.ok) throw err(saved.why ?? 'It could not be saved', 550);
    tid = thread.id;
    mid = msg.id;
    made = existing ? 'message' : 'thread';
  }
  // Pictures inside the text go along as inline parts (the copy kept in sprint2go has them in its HTML already).
  const withCids = r.parsed.attachments.some((a) => a.related && a.contentId) ? await simpleParser(raw, { keepCidLinks: true }) : null;
  const inline = (withCids?.attachments ?? []).filter((a) => a.related && a.contentId).map((a) => ({ name: a.filename ?? 'image', url: `data:${a.contentType};base64,${a.content.toString('base64')}`, cid: String(a.contentId).replace(/^<|>$/g, '') }));
  const email: Outgoing = {
    workspaceId: mb.wsId,
    accountId: mb.id,
    threadId: tid,
    messageId: mid,
    mid: r.mid ?? undefined,
    from: { name: fromName, email: sender.address },
    to,
    cc,
    bcc,
    subject,
    text: r.parsed.text ?? '',
    html: (withCids?.html || r.parsed.html) || undefined,
    files: [...files.map((f) => ({ name: f.name, url: f.url })), ...inline],
    inReplyTo: r.parsed.inReplyTo || undefined,
    references: Array.isArray(r.parsed.references) ? r.parsed.references : r.parsed.references ? [r.parsed.references] : undefined,
  };
  try {
    await queueSend(email);
  } catch (e) {
    // Not sent: the copy doesn't stay in Sent as if it had gone.
    const t = store.lookup(new store.Ctx(), mb, tid, mid)?.t;
    if (t && made === 'thread') deps.writer.write(who.userId, [], [tid]);
    else if (t && made === 'message') deps.writer.write(who.userId, [{ ...t, messages: t.messages.filter((m) => m.id !== mid) }], []);
    throw err(e instanceof Error ? e.message : 'It could not be sent', 550);
  }
}

let servers: SMTPServer[] = [];
export const listening = () => servers.length > 0;

export function start(d: SubmissionDeps, ports: { submission: number; submissions: number }, host = '0.0.0.0'): Promise<void> {
  deps = d;
  const make = (secure: boolean) => {
    const tls = d.tls();
    const server: SMTPServer = new SMTPServer({
      name: MAIL_HOST,
      banner: 'sprint2go mail submission',
      secure,
      key: tls.key,
      cert: tls.cert,
      size: MAX_SIZE,
      authMethods: ['PLAIN', 'LOGIN'],
      authOptional: false,
      allowInsecureAuth: false,
      maxClients: 500,
      socketTimeout: 5 * 60_000,
      logger: false,
      disabledCommands: secure ? ['STARTTLS'] : [],
      onAuth(auth, session, cb) {
        if (!session.secure) return cb(err('Use an encrypted connection (STARTTLS) first', 538));
        void d.login(auth.username ?? '', auth.password ?? '', String(session.remoteAddress ?? '').replace(/^::ffff:/, '')).then((r) => {
          if (!r.ok) return setTimeout(() => cb(err(r.why, 535)), 800);
          cb(null, { user: JSON.stringify({ userId: r.userId, passwordId: r.passwordId }) as unknown as string });
        }, () => cb(err('Signing in failed, try again', 454)));
      },
      onMailFrom(address, session, cb) {
        const who = whoOf(session);
        if (!who || !d.stillOk(who.userId, who.passwordId)) return cb(err('Sign in first', 530));
        if (!d.senders(who.userId).some((s) => s.address === lower(address.address))) return cb(err(`You can't send as ${address.address || 'an empty address'}`, 553));
        cb();
      },
      onRcptTo(address, session, cb) {
        if (session.envelope.rcptTo.length >= MAX_RCPT) return cb(err(`At most ${MAX_RCPT} recipients per email`, 452));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.address)) return cb(err("That address doesn't look right", 553));
        cb();
      },
      onData(stream, session, cb) {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          if ((stream as unknown as { sizeExceeded?: boolean }).sizeExceeded) return cb(err('Emails can be up to 25 MB', 552));
          const who = whoOf(session);
          if (!who) return cb(err('Sign in first', 530));
          const env = { from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((x) => x.address) };
          submit(who, env, Buffer.concat(chunks)).then(
            () => cb(),
            (e: Error & { responseCode?: number }) => {
              if (!e.responseCode) d.log(`[submission] failed: ${e.stack ?? e.message}`);
              cb(e.responseCode ? e : err('It could not be sent, try again later', 451));
            },
          );
        });
      },
    });
    server.on('error', (e) => d.log(`[submission] ${e.message}`));
    return server;
  };
  const a = make(false);
  const b = make(true);
  servers = [a, b];
  const listen = (s: SMTPServer, port: number) =>
    new Promise<void>((res, rej) => {
      s.server.once('error', rej);
      s.listen(port, host, () => (s.server.off('error', rej), res()));
    });
  return Promise.all([listen(a, ports.submission), listen(b, ports.submissions)]).then(() => undefined);
}
export function updateContext(tls: { key: Buffer; cert: Buffer }) {
  for (const s of servers) s.updateSecureContext({ key: tls.key, cert: tls.cert });
}
export async function stop() {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null)))));
  servers = [];
}
