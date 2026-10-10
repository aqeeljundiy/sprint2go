// Mail for teams, the HTTP side: delegation, forwarding, POP, export, contacts, groups and shared inboxes, retention,
// legal hold and data loss rules, mail storage. index.ts hands every /api/mail/... request here first (one line);
// what isn't ours falls through. The rules themselves live in the files named below.
//
//  GET  /api/mail/access?ws=                 your mailboxes: delegates, forwarding, POP, what's logged about them
//  POST /api/mail/delegates                  { workspaceId, accountId, delegates: [{ userId, send: 'as'|'behalf' }] }
//  POST /api/mail/forwarding/address         { workspaceId, accountId, address }  sends a code to it
//  POST /api/mail/forwarding/verify          { workspaceId, accountId, address, code }
//  POST /api/mail/forwarding/remove          { workspaceId, accountId, address }
//  POST /api/mail/forwarding                 { workspaceId, accountId, on, address, keep }
//  POST /api/mail/pop                        { on, after, from: 'all'|'now' }
//  GET  /api/mail/export?ws=&account=        the mailbox as an mbox in a zip
//  GET  /api/mail/contacts?ws=               saved contacts, everyone you've emailed, the team, duplicates
//  POST /api/mail/contacts                   { workspaceId, contact }
//  POST /api/mail/contacts/delete|merge      { workspaceId, ids }
//  POST /api/mail/contacts/import            { workspaceId, format: 'vcf'|'csv', text, label? }
//  GET  /api/mail/contacts/export?ws=&format=vcf|csv&label=
//  GET  /api/mail/groups?ws=   POST /api/mail/groups { workspaceId, groups }
//  GET  /api/mail/policy?ws=   POST /api/mail/policy { workspaceId, policy }   (admins)
//  GET  /api/mail/storage?ws=                your mail's size, largest emails and attachments, Spam and Trash
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';
import * as billing from './billing.ts';
import * as mailer from './mailer.ts';
import * as mailApps from './mailApps.ts';
import * as audit from './mailAudit.ts';
import * as delegation from './mailDelegation.ts';
import * as forwarding from './mailForwarding.ts';
import * as compliance from './mailCompliance.ts';
import * as groups from './mailGroups.ts';
import * as contacts from './mailContacts.ts';
import * as storage from './mailStorage.ts';
import * as pop3 from './pop3.ts';
import { mbox, writeZip } from './mailExport.ts';
import { mark, msg } from '../src/i18n/index.ts';
import type { Said } from './lang.ts';

type Json = (res: ServerResponse, status: number, data: unknown) => void;
export interface PlusDeps {
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[], except?: string, deleted?: db.Doc[]) => void;
  notify: (userIds: string[], workspaceId: string, text: Said, link?: string) => void;
  log: (line: string) => void;
}
let deps: PlusDeps;

/** At start-up: forwarding's hooks into the mail engine, and retention once a day. */
export function start(d: PlusDeps) {
  deps = d;
  forwarding.init({
    sendCode: (to, mailbox, code) => mailer.sendNote(to, `${code} is your code to forward mail from ${mailbox}`, `Someone using sprint2go wants to forward the mail of ${mailbox} to ${to}.\n\nTo allow it, type this code in sprint2go: ${code}\n\nIt works for 30 minutes. If you don't know about this, ignore this email: nothing is forwarded without the code.`),
    queueRaw: (o) => mailer.queueRaw(o),
    isLocal: (address) => !!mailer.accountFor(address),
    log: d.log,
  });
  mailer.onDelivered((x) => forwarding.onDelivered(x));
  const runDaily = () => {
    try {
      const done = compliance.runRetention({ broadcast: d.broadcast });
      for (const r of done) if (r.deleted) storage.changed();
    } catch (e) {
      d.log(`[mail retention] ${e instanceof Error ? e.message : e}`);
    }
  };
  // Every few hours (each company at most once a day); tests make it quicker with S2G_MAIL_RETENTION_MS.
  const every = Number(process.env.S2G_MAIL_RETENTION_MS) || 3 * 3600_000;
  setTimeout(runDaily, Math.min(60_000, every)).unref?.();
  setInterval(runDaily, every).unref?.();
}

/* ---------- helpers ---------- */

type Ws = any;
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const wsFor = (me: string, id: unknown): Ws | null => {
  const ws = db.getDoc('workspaces', String(id ?? '')) as Ws | undefined;
  return ws && (ws.members ?? []).some((m: any) => m.userId === me) ? ws : null;
};
const isAdmin = (ws: Ws, me: string) => (ws.members ?? []).some((m: any) => m.userId === me && m.role !== 'member');
/** Saves the company with these changes on top of what's stored now, and tells everyone in it. */
function saveWs(wsId: string, patch: (latest: Ws) => Ws, by: string) {
  const latest = db.getDoc('workspaces', wsId) as Ws;
  const next = patch(latest);
  db.writeDocs('workspaces', [next], [], by);
  deps.broadcast('workspaces', [next], []);
  return next;
}
/** Mailboxes someone may change forwarding for: their own; shared inboxes for admins (never someone else's own). */
const mayForward = (ws: Ws, a: any, me: string) => !!a && (!a.provider || a.provider === 'sprint2go') && !a.temp && (a.kind === 'personal' ? (a.users ?? []).includes(me) : isAdmin(ws, me));
const errWords = (e: unknown, fallback: string) => (e instanceof Error ? ((e as Error & { words?: Said }).words ?? e.message) : fallback);

export async function handleApi(
  p: string,
  c: { req: IncomingMessage; res: ServerResponse; url: URL; me: string; operator: string | null; json: Json; body: (req: IncomingMessage) => Promise<any>; tooMany: (key: string, max: number, windowMs: number) => boolean },
): Promise<boolean> {
  if (!p.startsWith('/api/mail/')) return false;
  const { req, res, url, me, json } = c;
  const get = req.method === 'GET';
  const post = req.method === 'POST';
  const deny = (status: number, error: unknown) => (json(res, status, { error }), true);
  const ro = (ws: Ws) => billing.readOnlyWords(ws);
  /** Things only the person does (an operator looking at the app as them can't). */
  const own = () => (c.operator ? deny(403, mark('That’s theirs to do: you’re signed in as them.')) : false);

  /* ---------- your mailboxes: delegation, forwarding, POP ---------- */
  if (p === '/api/mail/access' && get) {
    const ws = wsFor(me, url.searchParams.get('ws'));
    if (!ws) return deny(403, mark('Not in this company.'));
    const accounts = (ws.accounts ?? []) as any[];
    const mine = accounts.filter((a) => (a.users ?? []).includes(me) && !a.temp);
    const manage = accounts.filter((a) => !a.temp && (mine.includes(a) || (isAdmin(ws, me) && (!a.provider || a.provider === 'sprint2go'))));
    const pst = mailApps.popStatus();
    json(res, 200, {
      mailboxes: manage.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        kind: a.kind,
        mine: mine.includes(a),
        delegable: delegation.delegable(a) && delegation.mayManage(ws, a, me),
        delegates: delegation.delegatesOf(a),
        forwarding: mayForward(ws, a, me) ? forwarding.stateOf(ws, a.id) : null,
        held: compliance.mailboxHeld(ws, a.id),
      })),
      delegatedToMe: accounts.filter((a) => delegation.delegateOf(a, me)).map((a) => ({ id: a.id, email: a.email, name: a.name, owners: a.users ?? [], send: delegation.delegateOf(a, me)!.send })),
      pop: { ...pst, host: mailer.MAIL_HOST, prefs: pop3.prefsOf(me) },
      forwardOutside: compliance.policyOf(ws).forwardOutside !== false,
      domains: ws.domains ?? [],
      log: audit.forAccounts(ws.id, manage.map((a) => a.id), 60),
    });
    return true;
  }
  if (p === '/api/mail/delegates' && post) {
    if (own()) return true;
    const b = await c.body(req);
    const ws = wsFor(me, b.workspaceId);
    if (!ws) return deny(403, mark('Not in this company.'));
    if (ro(ws)) return deny(403, ro(ws));
    try {
      const r = delegation.setDelegates(ws, String(b.accountId ?? ''), b.delegates, me);
      const next = saveWs(ws.id, (w) => ({ ...w, accounts: (w.accounts ?? []).map((a: any) => (a.id === r.account.id ? { ...a, delegates: r.account.delegates } : a)) }), me);
      delegation.logChanges(ws.id, r.account.id, me, r.changes);
      // The people given access hear about it (and where to find the mailbox).
      const added = r.changes.filter((x) => x.action === 'delegate.grant').map((x) => x.detail.split(' ')[0]);
      const owner = String((db.getDoc('users', me) as any)?.name ?? '');
      if (added.length) deps.notify(added, ws.id, msg('{name} gave you access to {email}. Pick it in Mail’s list of inboxes.', { name: owner, email: r.account.email ?? '' }), '/mail');
      json(res, 200, { delegates: (next.accounts ?? []).find((a: any) => a.id === r.account.id)?.delegates ?? [] });
    } catch (e) {
      deny(400, errWords(e, 'That couldn’t be saved.'));
    }
    return true;
  }
  if (p.startsWith('/api/mail/forwarding') && post) {
    if (own()) return true;
    const b = await c.body(req);
    const ws = wsFor(me, b.workspaceId);
    const a = ws?.accounts?.find((x: any) => x.id === b.accountId);
    if (!ws || !mayForward(ws, a, me)) return deny(403, mark('Not your mailbox.'));
    if (ro(ws)) return deny(403, ro(ws));
    try {
      if (p === '/api/mail/forwarding/address') {
        if (c.tooMany(`fwd-code:${me}`, 10, 3600_000)) return deny(429, mark('Too many codes asked for. Try again in an hour.'));
        const r = await forwarding.addAddress(ws, a.id, String(b.address ?? ''), me);
        json(res, 200, { ...r, forwarding: forwarding.stateOf(ws, a.id) });
      } else if (p === '/api/mail/forwarding/verify') {
        if (c.tooMany(`fwd-verify:${me}`, 30, 3600_000)) return deny(429, mark('Too many tries. Try again in an hour.'));
        forwarding.verify(ws, a.id, String(b.address ?? ''), String(b.code ?? ''), me);
        json(res, 200, { forwarding: forwarding.stateOf(ws, a.id) });
      } else if (p === '/api/mail/forwarding/remove') {
        forwarding.removeAddress(ws, a.id, String(b.address ?? ''), me);
        json(res, 200, { forwarding: forwarding.stateOf(ws, a.id) });
      } else if (p === '/api/mail/forwarding') {
        forwarding.setForwarding(ws, a.id, { on: !!b.on, address: b.address, keep: b.keep }, me);
        json(res, 200, { forwarding: forwarding.stateOf(ws, a.id) });
      } else return deny(404, mark('Not found.'));
    } catch (e) {
      deny(400, errWords(e, 'That couldn’t be saved.'));
    }
    return true;
  }
  if (p === '/api/mail/pop' && post) {
    if (own()) return true;
    const b = await c.body(req);
    const before = pop3.prefsOf(me);
    const prefs = pop3.setPrefs(me, { on: typeof b.on === 'boolean' ? b.on : undefined, after: b.after, from: b.from === 'all' || b.from === 'now' ? b.from : undefined });
    if (before.on && !prefs.on) pop3.endFor((u) => u === me);
    json(res, 200, { prefs });
    return true;
  }

  /* ---------- export ---------- */
  if (p === '/api/mail/export' && get) {
    const ws = wsFor(me, url.searchParams.get('ws'));
    const a = ws?.accounts?.find((x: any) => x.id === url.searchParams.get('account'));
    // Your own mailboxes and the shared inboxes you're on; admins any mailbox here. Never a delegate.
    if (!ws || !a || !((a.users ?? []).includes(me) || isAdmin(ws, me))) return deny(403, mark('Not your mailbox.'));
    if (c.operator) return deny(403, mark('That’s theirs to do: you’re signed in as them.'));
    const day = new Date().toISOString().slice(0, 10);
    const name = `${lower(a.email).replace(/[^a-z0-9@._-]/g, '_')}-${day}`;
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}.zip"`, 'cache-control': 'no-store' });
    let n = 0;
    try {
      await writeZip(res, [{ name: `${name}.mbox`, data: mbox(ws, a, (x) => (n = x)) }]);
      audit.log(ws.id, me, 'mailbox.export', a.id, `${n} email${n === 1 ? '' : 's'} exported as mbox`);
    } catch (e) {
      deps.log(`[mail export] ${a.email}: ${e instanceof Error ? e.message : e}`);
      res.destroy();
      return true;
    }
    res.end();
    return true;
  }

  /* ---------- contacts ---------- */
  if (p.startsWith('/api/mail/contacts')) {
    const wsId = get ? url.searchParams.get('ws') : null;
    const b = post ? await c.body(req) : {};
    const ws = wsFor(me, wsId ?? b.workspaceId);
    if (!ws) return deny(403, mark('Not in this company.'));
    try {
      if (p === '/api/mail/contacts' && get) {
        const boxes = (ws.accounts ?? []).filter((a: any) => (a.users ?? []).includes(me) || delegation.delegateOf(a, me));
        const meDoc = db.getDoc('users', me) as any;
        const mine = new Set<string>([lower(meDoc?.email), ...boxes.map((a: any) => lower(a.email)), ...(ws.mailAliases ?? []).filter((al: any) => (al.to ?? []).some((id: string) => boxes.some((a: any) => a.id === id))).map((al: any) => lower(al.address))]);
        const saved = contacts.list(me, ws.id);
        const team = (ws.members ?? [])
          .map((m: any) => db.getDoc('users', m.userId) as any)
          .filter((u: any) => u && !u.deletedAt && u.id !== me)
          .map((u: any) => {
            const box = (ws.accounts ?? []).find((a: any) => a.kind === 'personal' && (a.users ?? []).includes(u.id) && !a.temp);
            return { userId: u.id, name: u.name, email: lower(box?.email ?? u.email), title: u.title ?? '' };
          });
        json(res, 200, { contacts: saved, frequent: contacts.frequent(boxes.map((a: any) => a.id), mine), team, duplicates: contacts.duplicates(saved) });
        return true;
      }
      if (p === '/api/mail/contacts/export' && get) {
        const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'vcf';
        const label = url.searchParams.get('label');
        const list = contacts.list(me, ws.id).filter((x) => !label || x.labels.includes(label));
        const body = format === 'csv' ? contacts.toCsv(list) : contacts.toVcf(list);
        res.writeHead(200, { 'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/vcard; charset=utf-8', 'content-disposition': `attachment; filename="contacts${label ? `-${label.replace(/[^\w-]/g, '_')}` : ''}.${format}"`, 'cache-control': 'no-store' });
        res.end(body);
        return true;
      }
      if (!post) return deny(405, mark('Not allowed.'));
      if (ro(ws)) return deny(403, ro(ws));
      if (p === '/api/mail/contacts') return (json(res, 200, { contact: contacts.save(me, ws.id, b.contact) }), true);
      if (p === '/api/mail/contacts/delete') return (json(res, 200, { removed: contacts.remove(me, ws.id, Array.isArray(b.ids) ? b.ids.map(String) : []) }), true);
      if (p === '/api/mail/contacts/merge') return (json(res, 200, { contact: contacts.merge(me, ws.id, Array.isArray(b.ids) ? b.ids.map(String) : []) }), true);
      if (p === '/api/mail/contacts/import') {
        const text = String(b.text ?? '');
        if (text.length > 20 * 1024 * 1024) return deny(413, mark('That file is too big. Contacts files up to 20 MB.'));
        const list = b.format === 'csv' ? contacts.parseCsv(text) : contacts.parseVcf(text);
        if (!list.length) return deny(400, b.format === 'csv' ? mark('No contacts in that file. A CSV needs a header row with Name and E-mail columns.') : mark('No contacts in that file. A vCard file starts with BEGIN:VCARD.'));
        return (json(res, 200, contacts.importContacts(me, ws.id, list, typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 40) : undefined)), true);
      }
      return deny(404, mark('Not found.'));
    } catch (e) {
      return deny(400, errWords(e, 'That couldn’t be saved.'));
    }
  }

  /* ---------- groups and shared inboxes ---------- */
  if (p === '/api/mail/groups') {
    const b = post ? await c.body(req) : {};
    const ws = wsFor(me, get ? url.searchParams.get('ws') : b.workspaceId);
    if (!ws) return deny(403, mark('Not in this company.'));
    const admin = isAdmin(ws, me);
    if (get) {
      const list = groups.groupsOf(ws).filter((g) => admin || groups.everyone(g).includes(me));
      json(res, 200, { groups: list, admin, domains: ws.domains ?? [], hosted: ws.emailSetup === 'hosted' || ws.emailSetup === 'mix' });
      return true;
    }
    if (!post) return deny(405, mark('Not allowed.'));
    if (ro(ws)) return deny(403, ro(ws));
    if (ws.emailSetup !== 'hosted' && ws.emailSetup !== 'mix') return deny(409, ws.emailSetup === 'keep' ? mark('Your domain’s mail stays with your provider, so groups are made there.') : mark('Email is off for this company.'));
    const taken = mailer.localAccounts();
    try {
      const r = groups.save(ws, b.groups, me, admin, (address, gid) => {
        const hit = taken.get(address);
        if (!hit) return false;
        if (hit.ws.id !== ws.id) return true;
        // Its own address (a group's list, or its shared inbox) isn't "taken".
        const g = groups.groupsOf(ws).find((x) => x.id === gid);
        return !(g && g.address === address);
      });
      const next = saveWs(ws.id, (w) => ({ ...w, mailGroups: r.groups.length ? r.groups : undefined, accounts: r.accounts }), me);
      for (const ch of r.changes) audit.log(ws.id, me, ch.action, ch.accountId, ch.detail);
      json(res, 200, { groups: groups.groupsOf(next).filter((g) => admin || groups.everyone(g).includes(me)) });
    } catch (e) {
      deny(400, errWords(e, 'That couldn’t be saved.'));
    }
    return true;
  }

  /* ---------- retention, legal hold, data loss rules (admins) ---------- */
  if (p === '/api/mail/policy') {
    const b = post ? await c.body(req) : {};
    const ws = wsFor(me, get ? url.searchParams.get('ws') : b.workspaceId);
    if (!ws || !isAdmin(ws, me)) return deny(403, mark('Only admins can change the company’s mail rules.'));
    if (get) return (json(res, 200, { policy: compliance.policyOf(ws), log: audit.list(ws.id, 200), noticeDays: compliance.NOTICE_DAYS }), true);
    if (!post) return deny(405, mark('Not allowed.'));
    if (c.operator) return deny(403, mark('That’s theirs to do: you’re signed in as them.'));
    if (ro(ws)) return deny(403, ro(ws));
    const r = compliance.clean(ws, b.policy, me);
    const next = saveWs(ws.id, (w) => ({ ...w, mailPolicy: r.policy }), me);
    for (const line of r.changes) audit.log(ws.id, me, 'policy.change', null, line);
    if (r.started) {
      const admins = (ws.members ?? []).filter((m: any) => m.role !== 'member').map((m: any) => m.userId);
      deps.notify(admins, ws.id, msg('Mail retention is on for {company}: from {date}, old mail is deleted every day as set in Settings, Mail retention & rules. People on legal hold keep everything.', { company: ws.name, date: r.started.slice(0, 10) }), '/settings/mailrules');
    }
    // People whose forwarding the new rule stops hear it from their Settings (it shows as stopped).
    json(res, 200, { policy: compliance.policyOf(next), log: audit.list(ws.id, 200) });
    return true;
  }

  /* ---------- storage ---------- */
  if (p === '/api/mail/storage' && get) {
    const ws = wsFor(me, url.searchParams.get('ws'));
    if (!ws) return deny(403, mark('Not in this company.'));
    const boxes = (ws.accounts ?? []).filter((a: any) => (a.users ?? []).includes(me));
    const room = billing.storageRoom(ws.id, me);
    json(res, 200, { ...storage.report(boxes.map((a: any) => ({ id: a.id, email: a.email }))), company: { used: room.used, total: room.total, mail: room.mail }, held: boxes.filter((a: any) => compliance.mailboxHeld(ws, a.id)).map((a: any) => a.id) });
    return true;
  }
  return false;
}
