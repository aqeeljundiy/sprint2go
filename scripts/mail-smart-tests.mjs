// Mail that sorts itself (server/mailSmart.ts, src/mailQuery.ts, src/mailSafety.ts), checked two ways.
//  1. In this process, on a throwaway data folder: Gmail's search operators read and matched (fields, phrases, OR,
//     -exclude, groups, sizes, dates, places), the options panel's round trip; phishing signs (lookalike domains, a
//     colleague's name on an outside address, failed checks, links that hide where they go) and links checked on
//     click; inbox categories from the headers and what moving teaches; spam scoring and what Report spam and Not spam
//     teach; Important from what people do; muted conversations; Spam and Trash emptied after 30 days; search over
//     the full-text index.
//  2. End to end (the server on a throwaway folder and free ports, demo data): mail arriving over SMTP gets its tab, a
//     newsletter goes to Promotions, a lookalike sender is flagged, obvious spam goes to Spam, a muted conversation's
//     reply skips the inbox; Report spam through the app's sync teaches the filter; /api/mail/search answers with
//     operators and only for your own mailboxes.
//   node --import ./server/register.mjs scripts/mail-smart-tests.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('..', import.meta.url).pathname;
const unitDir = mkdtempSync(join(tmpdir(), 's2g-mailsmart-unit-'));
process.env.S2G_DATA = unitDir;
process.env.MAIL_DNSBL = '0';

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

/* ---------- 1. in this process ---------- */
{
  const q = await import('../src/mailQuery.ts');
  const safe = await import('../src/mailSafety.ts');
  const db = await import('../server/db.ts');
  const smart = await import('../server/mailSmart.ts');

  // The parser.
  const txt = (s) => q.queryText(q.parseQuery(s));
  check(txt('from:nadia has:attachment') === 'from:nadia has:attachment', 'reads field:value terms');
  check(JSON.stringify(q.parseQuery('"quarterly report"')) === JSON.stringify({ k: 'term', field: '', value: 'quarterly report', exact: true }), 'reads a quoted phrase');
  check(q.parseQuery('a OR b').k === 'or' && q.parseQuery('a | b').k === 'or', 'reads OR and |');
  check(q.parseQuery('-spam').k === 'not', 'reads -exclude');
  const grp = q.parseQuery('(from:a OR from:b) invoice');
  check(grp.k === 'and' && grp.c[0].k === 'or' && grp.c[1].value === 'invoice', 'reads parentheses');
  const fg = q.parseQuery('subject:(dinner movie)');
  check(fg.k === 'and' && fg.c.every((x) => x.field === 'subject'), 'field:(a b) gives each word the field');
  check(q.parseQuery('{from:a from:b}').k === 'or', '{a b} means any of them');
  check(q.parseQuery('') === null && q.parseQuery('   ') === null, 'an empty search is nothing');
  check(q.parseQuery('foo:bar').value === 'foo:bar', 'an unknown operator stays a word');
  check(!!q.parseQuery('((( OR ) -'), 'odd input never throws');
  check(q.sizeOf('10M') === 10 * 1024 * 1024 && q.sizeOf('500K') === 512000 && q.sizeOf('2MB') === 2 * 1024 * 1024, 'sizes: 10M, 500K, 2MB');
  check(q.spanOf('2d') === 2 * DAY && q.spanOf('1y') === 365 * DAY, 'spans: 2d, 1y');

  // Matching.
  const me = 'aqeel@pnp.test';
  const ctx = { isMine: (e) => e.toLowerCase() === me, labelName: (id) => ({ fin: 'Finance' })[id], now: Date.now() };
  const msg = (o) => ({ id: 'm' + Math.random(), from: { name: 'Nadia Rahma', email: 'nadia@kopikita.id' }, to: [{ name: 'Aqeel', email: me }], date: iso(DAY), body: 'Here is the quarterly report for Q3.', ...o });
  const th = (o, m = [msg()]) => ({ id: 't', subject: 'Q3 numbers', location: 'inbox', starred: false, unread: true, labels: [], messages: m, ...o });
  const t1 = th({ labels: ['fin'], category: 'primary', important: true }, [msg({ attachments: [{ name: 'report-q3.pdf', size: '2.4 MB' }] })]);
  const m = (s, t = t1) => q.threadMatches(s, t, ctx);
  check(m('from:nadia') && m('from:kopikita.id') && !m('from:faisal'), 'from: by name or address');
  check(m('to:me') && m('from:nadia to:me') && !m('from:me'), 'to:me and from:me');
  check(m('subject:q3') && !m('subject:report'), 'subject: looks only at the subject');
  check(m('quarterly report') && m('"quarterly report"') && !m('"report quarterly"'), 'words and exact phrases');
  check(m('has:attachment') && m('filename:pdf') && m('filename:report') && !m('filename:docx'), 'has:attachment and filename:');
  check(m('larger:2M') && m('smaller:3M') && !m('larger:5M'), 'larger: and smaller: use the files’ size');
  check(m('newer_than:2d') && !m('older_than:2d') && m('older_than:12h'), 'newer_than: and older_than:');
  const d = new Date(Date.now() - DAY);
  const day = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  check(m(`after:${day}`) && !m(`before:${day}`), 'after: and before: with a date');
  check(m('label:finance') && m('label:fin') && !m('label:team') && m('has:userlabels'), 'label: by name or id');
  check(m('in:inbox') && !m('in:sent') && m('is:unread') && !m('is:read') && m('is:important') && !m('is:starred'), 'in: and is:');
  check(m('category:primary') && !m('category:promotions'), 'category:');
  check(m('from:nadia OR from:faisal') && !m('from:zed OR from:yon'), 'OR');
  check(m('quarterly -invoice') && !m('quarterly -report'), '-exclude');
  check(m('(from:faisal OR subject:q3) has:attachment'), 'groups');
  const spamT = th({ location: 'spam' });
  check(!m('quarterly', spamT) && m('quarterly in:spam', spamT) && m('quarterly in:anywhere', spamT), 'Spam and Trash only when the search names them');
  const listT = th({}, [msg({ listId: 'news.shop.example', listUnsubscribe: { url: 'https://shop.example/u', oneClick: true } })]);
  check(m('list:shop.example', listT) && m('has:unsubscribe', listT), 'list:');
  check(m('is:muted', th({ muted: true })) && m('is:snoozed', th({ snoozedUntil: iso(-DAY) })), 'is:muted and is:snoozed');

  // The options panel and the chips.
  const form = { ...q.EMPTY_FORM, from: 'nadia', subject: 'q3 numbers', words: 'report', without: 'draft', size: { op: 'larger', n: '2', unit: 'MB' }, within: '7d', attachment: true };
  const built = q.formToQuery(form);
  check(built === 'report from:nadia subject:(q3 numbers) -draft larger:2M newer_than:7d has:attachment', `the options panel builds a search (${built})`);
  const back = q.queryToForm(built);
  check(back.from === 'nadia' && back.subject === 'q3 numbers' && back.words === 'report' && back.without === 'draft' && back.size?.n === '2' && back.within === '7d' && back.attachment, 'and reads it back');
  check(q.toggleTerm('invoice', 'is', 'unread') === 'invoice is:unread' && q.toggleTerm('invoice is:unread', 'is', 'unread') === 'invoice', 'a chip switches its operator on and off');
  check(q.toggleTerm('from:a x', 'from', 'b') === 'x from:b' && q.hasTerm('x from:b', 'from') === 'b', 'a person chip replaces the person');

  // Phishing signs.
  check(safe.lookalikeOf('paypa1.com', safe.TRUSTED) === 'paypal.com', 'paypa1.com imitates paypal.com');
  check(safe.lookalikeOf('rnicrosoft.com', safe.TRUSTED) === 'microsoft.com', 'rnicrosoft.com imitates microsoft.com');
  check(safe.lookalikeOf('pixelandprofit.com', ['pixelandprofits.com']) === 'pixelandprofits.com', 'a one-letter change of the company’s own domain');
  check(safe.lookalikeOf('google.com.account-check.net', safe.TRUSTED) === 'google.com', 'a trusted name dressed up inside another domain');
  check(safe.lookalikeOf('mail.google.com', safe.TRUSTED) === null && safe.lookalikeOf('kopikita.id', safe.TRUSTED) === null && safe.lookalikeOf('bca.co.id', safe.TRUSTED) === null, 'the real domains and unrelated ones are fine');
  check(safe.baseDomain('a.mail.bank.co.id') === 'bank.co.id' && safe.baseDomain('x.y.example.com') === 'example.com', 'the domain a company owns');
  const company = { ownDomains: ['pnp.test'], colleagues: [{ name: 'Faisal Tirtonady', email: 'faisal@pnp.test' }] };
  const w1 = safe.warningsFor({ from: { name: 'Faisal Tirtonady', email: 'faisal.t@gmail.com' }, body: 'Can you buy gift cards?' }, { ...company, firstTime: true });
  check(w1.some((x) => x.kind === 'spoof' && x.detail === 'Faisal Tirtonady') && w1.some((x) => x.kind === 'first'), 'a colleague’s name on an outside address (and first time)');
  check(safe.warningsFor({ from: { name: 'Faisal Tirtonady', email: 'faisal@pnp.test' }, body: 'hi' }, company).length === 0, 'the colleague themselves is fine');
  const w2 = safe.warningsFor({ from: { name: 'Bank', email: 'x@bank.example' }, auth: 'spf=fail dkim=none dmarc=fail', html: '<a href="https://bank-login.ru/x">www.bank.example</a>' }, company);
  check(w2.some((x) => x.kind === 'auth') && w2.some((x) => x.kind === 'links' && x.detail === 'bank-login.ru') && safe.warningLevel(w2) === 'danger', 'failed checks and a link that hides where it goes');
  check(safe.warningsFor({ from: { name: 'New person', email: 'hello@kopikita.id' }, auth: 'spf=pass dkim=pass dmarc=pass' }, { ...company, firstTime: true }).length === 0, 'a first email alone shows nothing');
  check(safe.authOf('spf=fail dkim=none dmarc=fail arc=pass(google.com)').failed === false, 'a trusted ARC seal counts as verified');
  check(safe.checkLink('javascript:alert(1)', '', []).why.includes('scheme'), 'links: javascript: is refused');
  check(safe.checkLink('http://192.168.4.4/login', 'Log in', []).why.includes('ip'), 'links: a bare address');
  check(safe.checkLink('https://xn--pypal-4ve.com/', 'PayPal', []).why.includes('punycode'), 'links: punycode');
  check(safe.checkLink('https://paypa1.com/x', 'PayPal', []).why.includes('lookalike'), 'links: a lookalike');
  check(safe.checkLink('https://evil.example/x', 'www.kopikita.id', []).why.includes('mismatch'), 'links: words and target differ');
  check(safe.checkLink('https://bit.ly/x', 'here', [], true).why.includes('shortener') && safe.checkLink('https://bit.ly/x', 'here', []).why.length === 0, 'links: a shortener only in a suspicious email');
  check(safe.checkLink('https://www.kopikita.id/menu', 'kopikita.id', []).why.length === 0 && safe.checkLink('mailto:a@b.c', '', []).why.length === 0, 'links: ordinary links open');

  // Categories.
  const arr = (o) => ({ from: { name: 'Shop', email: 'news@shop.example' }, subject: 'Hello', text: '', headers: {}, ...o });
  check(smart.classify(arr({ subject: 'Flash sale: 50% off everything', headers: { 'list-unsubscribe': '<https://shop.example/u>' } })) === 'promotions', 'a newsletter with an offer is Promotions');
  check(smart.classify(arr({ from: { name: 'Shop', email: 'no-reply@shop.example' }, subject: 'Your order #1234 has shipped' })) === 'updates', 'a shipping notice is Updates');
  check(smart.classify(arr({ from: { name: 'LinkedIn', email: 'messages-noreply@linkedin.com' }, subject: 'You appeared in 5 searches' })) === 'social', 'LinkedIn is Social');
  check(smart.classify(arr({ subject: '[dev] Re: build fails', headers: { 'list-id': 'Dev <dev.groups.io>', 'list-post': '<mailto:dev@groups.io>' }, listId: 'dev.groups.io' })) === 'forums', 'a discussion list is Forums');
  check(smart.classify(arr({ from: { name: 'Nadia', email: 'nadia@kopikita.id' }, subject: 'Lunch tomorrow?' })) === 'primary', 'a person writing is Primary');
  check(smart.classify(arr({ from: { name: 'Nadia', email: 'nadia@kopikita.id' }, subject: 'Promo' , headers: { 'list-unsubscribe': '<x>' } }), { knownPerson: true }) === 'primary', 'someone the mailbox wrote to stays Primary');
  smart.teachCategory('box1', 'news@shop.example', 'primary');
  check(smart.classify(arr({ subject: 'Flash sale: 50% off', headers: { 'list-unsubscribe': '<x>' } }), { accountId: 'box1' }) === 'primary', 'moving a sender’s email teaches its tab (that mailbox only)');
  check(smart.classify(arr({ subject: 'Flash sale: 50% off', headers: { 'list-unsubscribe': '<x>' } }), { accountId: 'box2' }) === 'promotions', 'another mailbox keeps its own');

  // Spam: patterns, checks, and what the company teaches.
  const spamMail = { workspaceId: 'w1', from: { name: 'Prize desk', email: 'winner@lotto.example' }, subject: 'CONGRATULATIONS YOU HAVE WON!!!', text: 'Dear friend, you have won a lottery. Claim your prize by wire transfer.' };
  const s1 = smart.scoreSpam(spamMail);
  check(s1.spam && s1.why.includes('prize'), `obvious spam scores high (${s1.score}: ${s1.why.join(', ')})`);
  const ham = { workspaceId: 'w1', from: { name: 'Nadia', email: 'nadia@kopikita.id' }, subject: 'Menu for Friday', text: 'Can you check the new menu before Friday?' };
  check(!smart.scoreSpam(ham).spam, 'ordinary mail does not');
  check(smart.scoreSpam({ ...ham, auth: 'spf=fail dkim=none dmarc=fail' }).spam, 'a failed DMARC check is spam');
  check(!smart.scoreSpam({ ...spamMail, internal: true }).spam, 'the company’s own mail never is');
  const pitch = { workspaceId: 'w1', from: { name: 'Growth team', email: 'hi@seo-boost.example' }, subject: 'Rank #1 on Google this month', text: 'We can rank your website first on Google search results this month with our backlinks package.' };
  check(!smart.scoreSpam(pitch).spam, 'a cold pitch is not spam before anyone reports it');
  smart.learn('w1', pitch, true);
  check(smart.scoreSpam({ ...pitch, subject: 'Following up: rank #1' }).spam, 'Report spam: the sender’s next email goes to Spam');
  check(!smart.scoreSpam({ ...pitch, workspaceId: 'w2' }).spam, 'only in the company that reported it');
  smart.learn('w1', pitch, false);
  smart.learn('w1', pitch, false);
  check(!smart.scoreSpam(pitch).spam, 'Not spam brings the sender back');
  // Words: after a few reports, mail like it from someone new scores higher.
  for (let i = 0; i < 4; i++) smart.learn('w3', { from: { email: `x${i}@cheap-pills${i}.example` }, subject: 'cheap meds online pharmacy discount', text: 'buy cheap meds online pharmacy no prescription' }, true);
  for (let i = 0; i < 4; i++) smart.learn('w3', { from: { email: `p${i}@client${i}.example` }, subject: 'project meeting notes', text: 'notes from our project meeting and next steps' }, false);
  const w3 = smart.scoreSpam({ workspaceId: 'w3', from: { name: 'x', email: 'new@other-pills.example' }, subject: 'cheap meds', text: 'online pharmacy cheap meds no prescription' });
  check(w3.why.includes('looks like reported spam'), `words learned from reports count (${w3.score})`);

  // The 30 days, Report spam through a save, mute and Important, with real documents.
  const ws = { id: 'w1', name: 'PnP', accounts: [{ id: 'box1', email: me, users: ['u1'] }], members: [{ userId: 'u1' }] };
  db.writeDocs('workspaces', [ws], [], null);
  db.writeDocs('users', [{ id: 'u1', name: 'Aqeel Jundiy', email: me }], [], null);
  const base = { accountId: 'box1', subject: 'Hi', starred: false, unread: true, labels: [], workspaceId: 'w1' };
  db.writeDocs('threads', [
    { ...base, id: 'old-spam', location: 'spam', spamAt: iso(31 * DAY), messages: [msg()] },
    { ...base, id: 'new-spam', location: 'spam', spamAt: iso(3 * DAY), messages: [msg()] },
    { ...base, id: 'old-trash', location: 'trash', trashedAt: iso(40 * DAY), messages: [msg()] },
    { ...base, id: 'no-clock', location: 'trash', messages: [msg()] },
    { ...base, id: 'kept', location: 'archive', messages: [msg()] },
  ], [], null);
  const sw = smart.sweepOld();
  check(sw.removed.sort().join() === 'old-spam,old-trash', 'Spam and Trash older than 30 days are deleted for good');
  check(!!db.getDoc('threads', 'new-spam') && !!db.getDoc('threads', 'kept') && !!db.getDoc('threads', 'no-clock')?.trashedAt, 'the rest stay; older Trash starts its 30 days now');

  const before = { ...base, id: 't-r', location: 'inbox', messages: [msg({ from: { name: 'Cold', email: 'cold@pitchy.example' }, body: 'buy our backlinks package today' })] };
  const reported = smart.guardSmart({ ...before, location: 'spam' }, before, 'w1');
  check(!!reported.spamAt, 'Report spam starts the 30 days');
  check(smart.scoreSpam({ workspaceId: 'w1', from: { name: 'Cold', email: 'cold@pitchy.example' }, subject: 'Hi', text: 'hello again' }).why.includes('reported before'), 'and teaches the company’s filter');
  const back2 = smart.guardSmart({ ...reported, location: 'inbox' }, reported, 'w1');
  check(!back2.spamAt && !back2.spamWhy, 'Not spam stops the clock');
  const phish = smart.guardSmart({ ...before, location: 'spam', spamWhy: ['phishing'] }, before, 'w1');
  check(phish.messages[0].warn?.some((x) => x.kind === 'reported'), 'Report phishing marks the message');
  const moved = smart.guardSmart({ ...before, category: 'updates' }, { ...before, category: 'promotions' }, 'w1');
  check(moved.category === 'updates' && smart.taughtCategory('box1', 'cold@pitchy.example') === 'updates', 'moving to another tab teaches the sender’s tab');
  const stale = smart.guardSmart({ ...before }, { ...before, category: 'social', messages: [{ ...before.messages[0], warn: [{ kind: 'auth' }] }] }, 'w1');
  check(stale.category === 'social' && stale.messages[0].warn?.[0].kind === 'auth', 'an older copy can’t drop the server’s tab or phishing signs');
  const marked = smart.guardSmart({ ...before, important: true }, before, 'w1');
  check(marked.importantBy === 'you' && smart.predictImportant('box1', { from: { name: 'Cold', email: 'cold@pitchy.example' } }, { direct: false, category: 'promotions' }), 'marking Important teaches it for the sender');

  // Important from what people do.
  const nadia = { name: 'Nadia', email: 'nadia@kopikita.id' };
  check(!smart.predictImportant('box9', { from: nadia }, { direct: true, category: 'primary' }), 'a stranger is not important at first');
  const ib = { ...base, accountId: 'box1', id: 't-i', location: 'inbox', messages: [msg({ from: nadia })] };
  smart.guardSmart({ ...ib, messages: [...ib.messages, msg({ from: { name: 'Aqeel', email: me }, to: [nadia] })] }, ib, 'w1');
  check(smart.predictImportant('box1', { from: nadia }, { direct: true, category: 'primary' }), 'after a reply, their mail is important');
  check(!smart.predictImportant('box1', { from: { name: 'News', email: 'news@shop.example' }, listUnsubscribe: { url: 'x' } }, { direct: false, category: 'promotions' }), 'newsletters are not');

  // Arrival: phishing signs, tab, spam and mute.
  const arrival = (o) => ({ from: nadia, subject: 'Re: Q3', text: 'Thanks!', headers: {}, ...o });
  const muted = { ...base, id: 't-m', location: 'archive', muted: true, messages: [msg({ from: nadia })] };
  const reply = msg({ from: nadia, to: [{ name: 'Team', email: 'team@kopikita.id' }] });
  const mt = await smart.arrive({ ...muted, unread: true, location: 'inbox', messages: [...muted.messages, reply] }, { ws, accountId: 'box1', accountEmail: me, arrival: arrival({}), authSpam: false, directTo: ['team@kopikita.id'], existing: muted });
  check(mt.location === 'archive' && mt.muted, 'a reply in a muted conversation skips the inbox');
  const mt2 = await smart.arrive({ ...muted, unread: true, location: 'inbox', messages: [...muted.messages, reply] }, { ws, accountId: 'box1', accountEmail: me, arrival: arrival({}), authSpam: false, directTo: [me], existing: muted });
  check(mt2.location === 'inbox' && !mt2.muted, 'addressed to you directly again: back in the inbox, unmuted');
  const spoofed = await smart.arrive({ ...base, id: 't-s', location: 'inbox', messages: [msg({ from: { name: 'Aqeel Jundiy', email: 'aqeel.jundiy@gmail.com' }, body: 'Urgent: can you pay this invoice today?' })] }, { ws, accountId: 'box1', accountEmail: me, arrival: arrival({ from: { name: 'Aqeel Jundiy', email: 'aqeel.jundiy@gmail.com' }, subject: 'Urgent', text: 'Urgent: can you pay this invoice today?' }), authSpam: false, directTo: [me], existing: null });
  check(spoofed.messages[0].warn?.some((x) => x.kind === 'spoof'), 'on arrival: a colleague’s name from outside is flagged');
  const lottery = await smart.arrive({ ...base, id: 't-l', location: 'inbox', messages: [msg({ from: spamMail.from, body: spamMail.text })] }, { ws, accountId: 'box1', accountEmail: me, arrival: arrival({ from: spamMail.from, subject: spamMail.subject, text: spamMail.text }), authSpam: false, directTo: [me], existing: null });
  check(lottery.location === 'spam' && !!lottery.spamAt && lottery.spamWhy?.length > 0, 'on arrival: obvious spam goes to Spam, with the reasons');

  // Search over the full-text index.
  db.writeDocs('threads', [
    { ...base, id: 's1', location: 'inbox', subject: 'Invoice October', messages: [msg({ body: 'Please find the invoice attached.', attachments: [{ name: 'invoice-oct.pdf', size: '120 KB' }] })] },
    { ...base, id: 's2', location: 'archive', subject: 'Lunch', messages: [msg({ from: { name: 'Faisal', email: 'faisal@pnp.test' }, body: 'Lunch on Friday?' })] },
    { ...base, id: 's3', accountId: 'other-box', location: 'inbox', subject: 'Invoice for someone else', messages: [msg()] },
  ], [], null);
  const ids = (s) => smart.search(s, ['box1']).map((t) => t.id).sort().join();
  check(ids('invoice') === 's1', 'search: a word, only in your own mailboxes');
  check(ids('invo') === 's1', 'search: the start of a word');
  check(ids('filename:pdf') === 's1' && ids('from:faisal') === 's2' && ids('lunch OR invoice') === 's1,s2', 'search: operators');
  check(smart.ftsQuery(['faisal@pnp.test']) === '"faisal pnp test" *', 'search: an address is searched as its parts');
  db.writeDocs('threads', [{ ...base, id: 's2', location: 'archive', subject: 'Dinner', messages: [msg({ from: { name: 'Faisal', email: 'faisal@pnp.test' }, body: 'Dinner instead?' })] }], [], null);
  check(ids('lunch') === '' && ids('dinner') === 's2', 'search: the index follows changes');
}

/* ---------- 2. end to end ---------- */
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 's2g-mailsmart-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
const env = {
  ...process.env,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  MAIL_DNSBL: '0',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  SES_KEY: '',
  SES_SECRET: '',
  MAIL_FROM: '',
  S3_BUCKET: '',
  CF_DNS_TOKEN: '',
  PUBLIC_URL: '',
  SUPPORT_EMAIL: '',
  MAIL_RELAY_URL: '',
  GEO_COUNTRY_HEADER: '',
};
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
const finish = (code) => {
  server.kill('SIGTERM');
  for (const d of [dir, unitDir])
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the server may still hold a file for a moment */
    }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  console.log(code ? `\n${failed} check(s) failed` : '\nAll mail sorting checks passed');
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 120_000).unref();

try {
  for (let i = 0; i < 300 && !/Mail: receiving/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  check(/Mail: receiving/.test(log), 'the server starts and receives mail');
  if (!/Mail: receiving/.test(log)) finish(1);
  const nodemailer = (await import('nodemailer')).default;
  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  const smtp = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, tls: { rejectUnauthorized: false }, connectionTimeout: 10_000 });
  const threadWith = (subject) => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${subject}%`).map((r) => JSON.parse(r.data));
  const waitFor = async (fn) => {
    for (let i = 0; i < 100; i++) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  };
  const tag = () => randomBytes(3).toString('hex');
  const to = 'aqeel@pixelandprofits.com';

  // A newsletter.
  const n1 = `Flash sale ${tag()}: 40% off`;
  await smtp.sendMail({ from: 'Kopi Shop <news@kopishop.example>', to, subject: n1, text: 'Our biggest sale. Shop now.', headers: { 'List-Unsubscribe': '<https://kopishop.example/unsub>', 'List-Id': 'Kopi news <news.kopishop.example>' } });
  const tn = await waitFor(() => threadWith(n1)[0]);
  check(tn?.category === 'promotions' && tn.location === 'inbox' && tn.messages[0].listId === 'news.kopishop.example', 'a newsletter arrives in Promotions with its list');
  // A person.
  const p1 = `Lunch ${tag()}`;
  await smtp.sendMail({ from: 'Nadia Rahma <nadia@kopikita.example>', to, subject: p1, text: 'Lunch on Friday?' });
  const tp = await waitFor(() => threadWith(p1)[0]);
  check(tp?.category === 'primary' && tp.location === 'inbox', 'a person’s email is Primary');
  // A lookalike of the company's own domain.
  const l1 = `Invoice ${tag()}`;
  await smtp.sendMail({ from: 'Billing <billing@pixelandprofit.com>', to, subject: l1, text: 'Please pay the attached invoice today.' });
  const tl = await waitFor(() => threadWith(l1)[0]);
  check(tl?.messages[0].warn?.some((w) => w.kind === 'lookalike' && w.detail === 'pixelandprofits.com'), 'a lookalike of the company’s domain is flagged');
  // Obvious spam.
  const s1 = `YOU HAVE WON ${tag()}!!!`;
  await smtp.sendMail({ from: 'Prize Desk <winner@lotto-desk.example>', to, subject: s1, text: 'Dear friend, you have won the lottery. Claim your prize by wire transfer.' });
  const ts = await waitFor(() => threadWith(s1)[0]);
  check(ts?.location === 'spam' && !!ts.spamAt, 'obvious spam goes to Spam');

  // Sign in for the app's side.
  const base = `http://127.0.0.1:${httpPort}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: to, password: env.SEED_PASSWORD }) });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  check(login.ok && cookie.startsWith('s2g='), 'signs in');
  const call = (method, path, body) => fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  // Mute, then a reply that isn't addressed to this mailbox directly.
  await call('POST', '/api/sync', { coll: 'threads', upserts: [{ ...tp, muted: true, location: 'archive' }], deletes: [] });
  const mid = tp.messages[0].mid;
  await smtp.sendMail({ from: 'Nadia Rahma <nadia@kopikita.example>', to: 'team@kopikita.example', cc: to, envelope: { from: 'nadia@kopikita.example', to: [to] }, subject: `Re: ${p1}`, text: 'Adding the team.', inReplyTo: mid, references: [mid] });
  const tm = await waitFor(() => (threadWith(p1)[0]?.messages.length === 2 ? threadWith(p1)[0] : null));
  check(tm?.location === 'archive' && tm.muted === true, 'a muted conversation’s reply (in Cc) stays out of the inbox');

  // Report spam from the app: the sender's next email goes to Spam.
  const c1 = `Rank first ${tag()}`;
  await smtp.sendMail({ from: 'Growth <hi@rank-agency.example>', to, subject: c1, text: 'We rank your site first with our backlinks package.' });
  const tc = await waitFor(() => threadWith(c1)[0]);
  check(tc?.location === 'inbox', 'a cold pitch arrives in the inbox');
  const r = await call('POST', '/api/sync', { coll: 'threads', upserts: [{ ...tc, location: 'spam' }], deletes: [] });
  check(r.ok, 'Report spam is saved');
  const c2 = `Following up ${tag()}`;
  await smtp.sendMail({ from: 'Growth <hi@rank-agency.example>', to, subject: c2, text: 'Just following up on my last email.' });
  const tc2 = await waitFor(() => threadWith(c2)[0]);
  check(tc2?.location === 'spam', 'after Report spam, the sender’s next email goes to Spam');

  // Search with operators, only your own mailboxes.
  const ws = (await (await call('GET', '/api/mail/search?workspaceId=pnp&q=' + encodeURIComponent(`category:promotions from:kopishop`))).json());
  check(ws.ids?.includes(tn.id) && !ws.ids.includes(tp.id), '/api/mail/search answers with operators');
  const sp = await (await call('GET', '/api/mail/search?workspaceId=pnp&q=' + encodeURIComponent('in:spam'))).json();
  check(sp.ids?.includes(ts.id), 'in:spam finds Spam');
  const other = await call('GET', '/api/mail/search?workspaceId=not-mine&q=x');
  check(other.status === 403, 'not for a company you are not in');
  finish(failed ? 1 : 0);
} catch (e) {
  console.log('FAIL', e);
  finish(1);
}
