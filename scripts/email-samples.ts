// Every system email sprint2go sends, rendered with sample data in one language. Used by scripts/email-previews.mjs
// (HTML files and screenshots for the owner) and by the unit tests (each goes through the shared layout and has a text
// version). Seeds a few sample companies and people, so only run it on a throwaway data folder (S2G_DATA).
import * as db from '../server/db.ts';
import * as lang from '../server/lang.ts';
import { msg } from '../src/i18n/index.ts';

export type Sample = { id: string; name: string; subject: string; html: string; text: string; page?: boolean };

const WS_EN = { id: 'w-sample-en', name: 'Northwind Studio', color: '#0f766e', language: 'en', members: [{ userId: 'u-sample-en', role: 'owner' }] };
const WS_ID = { id: 'w-sample-id', name: 'Kopi Nusantara', color: '#c2410c', language: 'id', members: [{ userId: 'u-sample-id', role: 'owner' }] };

/** Seeds the sample companies and people. `logo`: a data URL for Kopi Nusantara's logo (a company with one). */
export function seed(logo?: string) {
  db.writeDocs('workspaces', [{ ...WS_EN, accounts: [], domains: ['northwind.example'] }, { ...WS_ID, accounts: [], domains: ['kopi.example'], ...(logo ? { logo } : {}) }] as any, [], null);
  db.writeDocs('users', [{ id: 'u-sample-en', name: 'Ann Lee', email: 'ann@northwind.example' }, { id: 'u-sample-id', name: 'Budi Santoso', email: 'budi@kopi.example' }] as any, [], null);
  db.writeDocs('prefs', [{ id: 'u-sample-en', value: { 'pm-settings:u-sample-en': { language: 'en' } } }, { id: 'u-sample-id', value: { 'pm-settings:u-sample-id': { language: 'id' } } }] as any, [], null);
}

export async function allEmails(l: lang.Lang): Promise<Sample[]> {
  const { codeMail, guestNoticeMail, ticketReceipt } = await import('../server/systemEmails.ts');
  const admin = await import('../server/admin.ts');
  const twostep = await import('../server/twostep.ts');
  const digest = await import('../server/digest.ts');
  const routing = await import('../server/routing.ts');
  const { confidentialCodeMail } = await import('../server/mailConfidential.ts');
  const { fileCodeMail } = await import('../server/mailFiles.ts');
  const { forwardingConfirmMail } = await import('../server/mailFilters.ts');

  const id = l === 'id';
  const ws = db.getDoc('workspaces', id ? WS_ID.id : WS_EN.id) as any; // as saved, logo and all
  const user = id ? 'u-sample-id' : 'u-sample-en';
  const email = id ? 'budi@kopi.example' : 'ann@northwind.example';
  const url = (process.env.PUBLIC_URL ?? 'https://app.sprint2go.com').replace(/\/$/, '');
  const inv = {
    id: 'inv-1', number: 'S2G-2026-0142', workspaceId: ws.id, period: '2026-09',
    lines: [{ text: 'Team plan: 8 of 9 people active', amount: 312000 }, { text: 'Boosted sending add-on', amount: 49000 }],
    subtotal: 361000, discount: 0, tax: 39710, total: 400710, status: 'sent' as const, method: null, dueAt: '2026-10-24T00:00:00Z', sentAt: '2026-10-10T00:00:00Z', paidAt: null, note: null, createdAt: '2026-10-10T00:00:00Z',
    billTo: { company: ws.name, address: id ? 'Jl. Kemang Raya 12\nJakarta Selatan' : '21 Harbour Street\nSingapore', emails: [email] },
  };
  const credits = { ...inv, number: 'S2G-2026-0143', lines: [{ text: 'Boosted sending: 5,000 emails', amount: 150000 }], subtotal: 150000, tax: 16500, total: 166500 };
  const item = (k: string, group: string, words: any, path: string) => ({ key: k, group, ...words, url: `${url}${path}`, at: new Date().toISOString(), workspaceId: ws.id });
  const items = [
    item('a', 'messages', msg('{name} messaged you: {quote}', { name: 'Nadia', quote: '“Can you check the brief before 3?”' }), '/chat'),
    item('b', 'messages', msg('{name} messaged you: {quote}', { name: 'Raka', quote: '“Lunch at the usual place?”' }), '/chat'),
    item('c', 'tasks', msg('{name} assigned you {task}', { name: 'Nadia', task: '“Send the October invoices”' }), '/tasks'),
    item('d', 'replies', msg('{name} replied: {subject}', { name: 'Maya at Acme', subject: 'Re: Quote for the new site' }), '/mail'),
  ];
  const said = msg('{name} shared {file} with you', { name: 'Nadia', file: '“Brand guidelines v3.pdf”' });
  const out: Sample[] = [];
  const add = (sid: string, name: string, m: { subject: string; html: string; text: string }) => out.push({ id: sid, name, subject: m.subject, html: m.html, text: m.text });

  add('signup-code', 'Sign-up code', codeMail('signup', '482913', l));
  add('reset-code', 'Password reset code', codeMail('reset', '071356', l));
  const tw = twostep.resetMail(user, ws, 'Nadia Putri');
  add('two-step-reset', 'Two-step reset (by an admin)', tw);
  add('two-step-reset-support', 'Two-step reset (by support)', lang.inLang(l, () => admin.supportResetMail(id ? 'Budi Santoso' : 'Ann Lee')));
  add('confidential-code', 'Confidential email code', confidentialCodeMail('Nadia Putri', '915204', ws.id));
  add('file-code', 'Shared file code', fileCodeMail('Brand guidelines v3.pdf', '330187', ws));
  add('forwarding-confirm', 'Forwarding confirmation', forwardingConfirmMail(`nadia@${ws.domains?.[0] ?? 'northwind.example'}`, ws, 'nadia.personal@gmail.example', `${url}/api/mail/forwarding/confirm?token=abc123`));
  add('guest-notice', 'Guest notice', guestNoticeMail({ ...said, workspaceId: ws.id }, id ? 'tamu@client.example' : 'guest@client.example', ws.name, url));
  add('digest', 'Away digest', digest.compose(id ? 'Budi Santoso' : 'Ann Lee', ws.name, items as any, url, l, ws));
  add('routing-alert', 'Routing alert', lang.inLang(l, () => routing.routingAlertMail(ws, ws.name, 'northwind.example', lang.inLang(l, () => (id ? 'Perutean email untuk northwind.example gagal di dua pemeriksaan terakhir.' : 'Mail routing for northwind.example failed its last two checks, so mail to Northwind Studio mailboxes at northwind.example may not be arriving. Check the routing at Google Workspace in Settings, Email delivery.')), id ? 'Jawaban terakhir: 550 5.1.1 alamat tidak dikenal' : 'Last answer: 550 5.1.1 address not found')));
  add('routing-test', 'Routing test', routing.routingProbeMail(ws, ws.name, 'northwind.example'));
  add('invoice', 'Invoice', admin.invoiceMail(inv as any, 'sprint2go', l));
  add('credits-invoice', 'Credits invoice', admin.invoiceMail(credits as any, 'sprint2go', l, 5000));
  const rec = ticketReceipt(email, 1042, 'Hi, our shared inbox stopped receiving mail this morning.\nCould you take a look?');
  add('ticket-receipt', 'Ticket receipt', { subject: 'Re: Shared inbox stopped receiving mail [#1042]', ...rec });
  const reply = admin.supportReplyText(id ? 'Halo Budi,\n\nKami sudah memperbaiki perutean untuk kotak masuk bersama Anda. Email baru seharusnya masuk lagi sekarang.' : 'Hi Ann,\n\nWe fixed the routing for your shared inbox. New mail should arrive again now.', 'Rina from sprint2go Support', [{ at: '2026-10-09T08:12:00Z', authorName: id ? 'Budi Santoso' : 'Ann Lee', author: email, body: 'Hi, our shared inbox stopped receiving mail this morning.\nCould you take a look?' }], l);
  add('ticket-reply', 'Ticket reply', { subject: 'Re: Shared inbox stopped receiving mail [#1042]', ...reply });
  add('broadcast', 'Owner broadcast', admin.broadcastMail('New in sprint2go: shared inbox rules', 'Shared inboxes can now assign mail by rule, so the right person picks it up straight away.\n\nOpen Settings, Mail, Filters to try it. Reply to this email if you have questions.', l));
  add('operator-alert', 'Operator alert', lang.inLang(l, () => admin.alertMail(id ? 'Disk hampir penuh: 4,2 GB tersisa.' : 'Disk nearly full: 4.2 GB free.', `${url}/admin/platform`, 'high')));
  out.push({ id: 'invoice-page', name: 'Invoice (attached page)', subject: '', html: admin.invoiceHtml(inv as any, ws.name, l), text: '', page: true });
  return out;
}
