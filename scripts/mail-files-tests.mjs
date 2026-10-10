// Mail attachments (server/mailFiles.ts, server/officePreview.ts, src/mailAttachments.ts), end to end on a throwaway
// server (demo data, a temporary data folder, free ports, a local SMTP sink as "the world", a fake virus scanner):
//  1. the rules: refused types (also inside a zip and a zip in a zip), renamed programs, the 25 MB budget and which
//     files become links, filename: matching
//  2. previews: Word, Excel, PowerPoint, CSV and text become a plain, script-free HTML page; old .doc says there's none
//  3. sending: files uploaded to the server go out (the app used to send browser-only blob: links, which were refused);
//     a pasted picture goes out as a cid image and shows in place for the teammate who gets it; refused types, zips
//     holding them and email over 25 MB are refused with a reason; a scheduled email keeps its files
//  4. receiving: a refused type, a zip holding one and a file the scanner flags are listed but not kept; clean files are
//     marked scanned; with no scanner they're marked not scanned; cid pictures show in place
//  5. Download all: a zip of the message's files, streamed, that unpacks to the same bytes; nobody else can get it
//  6. Save to Drive: a copy of the real file (not just its name), in the folder picked, counted in storage
//  7. big files as links: "anyone with the link" downloads; "recipients only" asks for a code sent to that address first
//  8. every attachment across someone's mail (the Files view and search's has:attachment / filename:)
//   node --import ./server/register.mjs scripts/mail-files-tests.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { makeZip } from './fixtures/zip.mjs';
import { readZip, openEntry } from '../server/zip.ts';
import { preview, parseCsv } from '../server/officePreview.ts';
import { isBlockedName, isUnusualName, linksNeeded, fitsInEmail, filenameMatches, previewWay, mailFiles, threadHasAttachment, MAIL_SIZE_LIMIT } from '../src/mailAttachments.ts';

const ROOT = new URL('..', import.meta.url).pathname;
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
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

/* ---------- fixtures ---------- */

const VIRUS = Buffer.from('S2G-TEST-VIRUS-MARKER: a harmless file the fake scanner flags');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const program = () => {
  const b = Buffer.alloc(512);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1');
  return b;
};
const docx = makeZip([
  {
    name: 'word/document.xml',
    data: `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r" xmlns:a="a"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly plan</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold words</w:t></w:r><w:r><w:t xml:space="preserve"> and plain &amp; safe &lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>First point</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>
</w:body></w:document>`,
  },
  { name: 'word/_rels/document.xml.rels', data: '<Relationships><Relationship Id="rId9" Type="image" Target="media/image1.png"/></Relationships>' },
  { name: 'word/media/image1.png', data: PNG },
]);
const xlsx = makeZip([
  { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>' },
  { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>' },
  { name: 'xl/sharedStrings.xml', data: '<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Coffee</t></r><r><t> beans</t></r></si></sst>' },
  { name: 'xl/styles.xml', data: '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>' },
  { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12.5</v></c><c r="C2" s="1"><v>46000</v></c></row></sheetData></worksheet>' },
  { name: 'xl/worksheets/sheet2.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>secret sheet</t></is></c></row></sheetData></worksheet>' },
]);
const pptx = makeZip([
  { name: 'ppt/presentation.xml', data: '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>' },
  { name: 'ppt/_rels/presentation.xml.rels', data: '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>' },
  { name: 'ppt/slides/slide1.xml', data: '<p:sld xmlns:p="p" xmlns:a="a"><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Launch day</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>Doors open at nine</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>' },
  { name: 'ppt/slides/slide2.xml', data: '<p:sld xmlns:p="p" xmlns:a="a"><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Thank you</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>' },
]);

/* ---------- 1. the rules ---------- */

check(isBlockedName('setup.exe') && isBlockedName('invoice.pdf.EXE') && isBlockedName('run.bat') && isBlockedName('x.js') && isBlockedName('a.msi') && isBlockedName('s.scr'), 'Gmail’s refused types are refused, whatever the case, also behind a second name');
check(!isBlockedName('report.pdf') && !isBlockedName('photo.jpg') && !isBlockedName('archive.zip'), 'ordinary files are allowed');
check(isUnusualName('page.html') && isUnusualName('budget.xlsm') && isUnusualName('invoice.pdf.html') && !isUnusualName('budget.xlsx'), 'web pages, macro documents and double names get a warning');
const MB = 1024 * 1024;
check(linksNeeded([{ size: 5 * MB }, { size: 10 * MB }]).size === 0, 'files that fit in 25 MB stay attachments');
const l = linksNeeded([{ size: 5 * MB }, { size: 30 * MB }, { size: 2 * MB }]);
check(l.has(1) && !l.has(0) && !l.has(2), 'the file that doesn’t fit becomes a link; the others stay attachments');
check(linksNeeded([{ size: 1 * MB, link: true }]).has(0), 'a file chosen as a link stays a link');
check(fitsInEmail([18 * MB]) && !fitsInEmail([20 * MB]), 'the 25 MB counts files as they’re packed into an email (base64)');
check(MAIL_SIZE_LIMIT === 25 * MB, 'the limit is 25 MB, as in Gmail');
check(filenameMatches('Q4 Budget.xlsx', 'budget') && filenameMatches('Q4 Budget.xlsx', 'spreadsheet') && filenameMatches('a.pdf', 'pdf') && !filenameMatches('a.pdf', 'image'), 'filename: matches part of a name or a kind of file');
check(previewWay('a.docx') === 'converted' && previewWay('a.pdf') === 'pdf' && previewWay('a.png') === 'image' && previewWay('a.doc') === 'none' && previewWay('a.mp4') === 'media', 'what previews how');
const sample = [
  { id: 't1', location: 'inbox', subject: 'Plans', messages: [{ id: 'm1', date: '2026-10-01T00:00:00Z', from: { name: 'Nadia', email: 'nadia@x.test' }, attachments: [{ name: 'plan.pdf', size: '1 MB', url: '/api/files/' + 'a'.repeat(32) }, { name: 'logo.png', size: '1 KB', inline: true }] }] },
  { id: 't2', location: 'trash', subject: 'Old', messages: [{ id: 'm2', date: '2026-10-02T00:00:00Z', from: { name: 'Bo', email: 'bo@x.test' }, attachments: [{ name: 'old.pdf', size: '1 KB' }] }] },
  { id: 't3', location: 'inbox', subject: 'Words', messages: [{ id: 'm3', date: '2026-10-03T00:00:00Z', from: { name: 'Bo', email: 'bo@x.test' }, attachments: [{ name: 'logo.png', size: '1 KB', inline: true }] }] },
];
const listed = mailFiles(sample);
check(listed.length === 1 && listed[0].att.name === 'plan.pdf', 'every attachment: inline pictures and Trash stay out');
check(mailFiles(sample, { from: 'bo' }).length === 0 && mailFiles(sample, { kinds: ['pdf'] }).length === 1 && mailFiles(sample, { q: 'image' }).length === 0, 'filters by sender, kind and name');
check(threadHasAttachment(sample[0]) && !threadHasAttachment(sample[2]), 'has:attachment ignores pictures inside the words');
const csv = parseCsv('name;amount\r\n"Kopi, ""best""";12\nTeh;3\n');
check(csv.rows.length === 3 && csv.rows[1][0] === 'Kopi, "best"' && csv.rows[1][1] === '12', 'CSV: quotes, semicolons and line endings');

/* ---------- 2. previews ---------- */

const work = mkdtempSync(join(tmpdir(), 's2g-mailfiles-'));
const fixture = (name, data) => {
  const p = join(work, `${randomBytes(4).toString('hex')}-${name}`);
  writeFileSync(p, data);
  return p;
};
const pDocx = await preview(fixture('plan.docx', docx), 'plan.docx');
check('html' in pDocx && pDocx.html.includes('<h1>Quarterly plan</h1>') && pDocx.html.includes('<strong>Bold words</strong>') && pDocx.html.includes('<li>First point</li>') && pDocx.html.includes('<td>') && pDocx.html.includes('data:image/png;base64'), 'Word: headings, bold, lists, tables and pictures');
check('html' in pDocx && !pDocx.html.includes('<script') && pDocx.html.includes('&lt;script&gt;'), 'Word: text that looks like code stays text');
const pXlsx = await preview(fixture('budget.xlsx', xlsx), 'budget.xlsx');
check('html' in pXlsx && pXlsx.html.includes('Budget') && pXlsx.html.includes('Coffee beans') && pXlsx.html.includes('12.5') && pXlsx.html.includes('2025-12-09') && !pXlsx.html.includes('secret sheet'), 'Excel: sheets, shared text, numbers, dates; hidden sheets stay hidden');
const pPptx = await preview(fixture('deck.pptx', pptx), 'deck.pptx');
check('html' in pPptx && pPptx.html.includes('<h2>Launch day</h2>') && pPptx.html.includes('Doors open at nine') && pPptx.html.includes('Thank you') && pPptx.html.indexOf('Launch day') < pPptx.html.indexOf('Thank you'), 'PowerPoint: slides in order with titles and words');
const pCsv = await preview(fixture('list.csv', 'a,b\n<b>x</b>,2\n'), 'list.csv');
check('html' in pCsv && pCsv.html.includes('&lt;b&gt;x&lt;/b&gt;'), 'CSV: a table, its cells escaped');
const pTxt = await preview(fixture('notes.txt', 'hello <img src=x onerror=alert(1)>'), 'notes.txt');
check('html' in pTxt && !pTxt.html.includes('<img src=x'), 'text: escaped');
const pDoc = await preview(fixture('old.doc', 'binary'), 'old.doc');
check('none' in pDoc, 'old .doc: no preview, said plainly');
const pBad = await preview(fixture('broken.docx', 'not a zip'), 'broken.docx');
check('none' in pBad, 'a damaged .docx: no preview, no crash');
const bomb = makeZip([{ name: 'word/document.xml', data: '<w:document>' + 'x'.repeat(5000) + '</w:document>', claim: 10 }]);
const pBomb = await preview(fixture('bomb.docx', bomb), 'bomb.docx');
check('none' in pBomb, 'a .docx that lies about its sizes: no preview');

/* ---------- the server ---------- */

const dir = mkdtempSync(join(tmpdir(), 's2g-mailfiles-srv-'));
const [httpPort, smtpPort, sinkPort, clamPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
const sunk = [];
const sink = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  logger: false,
  size: 80 * MB,
  onData(stream, session, cb) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => (sunk.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), raw: Buffer.concat(chunks) }), cb()));
  },
});
await new Promise((res) => sink.listen(sinkPort, '127.0.0.1', res));
// A fake clamd: INSTREAM, and "FOUND" for anything holding the test marker.
let scans = 0;
const clam = createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on('data', (b) => {
    buf = Buffer.concat([buf, b]);
    if (buf.length >= 14 && buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) {
      scans++;
      sock.end(buf.includes('S2G-TEST-VIRUS-MARKER') ? 'stream: Test.Marker FOUND\0' : 'stream: OK\0');
    }
  });
  sock.on('error', () => {});
});
await new Promise((res) => clam.listen(clamPort, '127.0.0.1', res));

const env = {
  ...process.env,
  NODE_ENV: 'development',
  S2G_DATA: dir,
  PORT: String(httpPort),
  HOST: '127.0.0.1',
  MAIL_PORT: String(smtpPort),
  MAIL_HOST: 'localhost',
  SEED_PASSWORD: randomBytes(12).toString('hex'),
  SES_KEY: '',
  SES_SECRET: '',
  MAIL_FROM: '',
  S3_BUCKET: '',
  CF_DNS_TOKEN: '',
  PUBLIC_URL: '',
  SUPPORT_EMAIL: '',
  MAIL_RELAY_URL: `smtp://127.0.0.1:${sinkPort}`,
  GEO_COUNTRY_HEADER: '',
  CLAMD_HOST: `127.0.0.1:${clamPort}`,
};
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
const finish = (code) => {
  server.kill('SIGTERM');
  sink.close();
  clam.close();
  for (const d of [dir, work])
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the server may still hold a file for a moment */
    }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-40).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 180_000).unref();

try {
  for (let i = 0; i < 300 && !/Mail: receiving/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  check(/Mail: receiving/.test(log), 'the server starts');
  if (!/Mail: receiving/.test(log)) finish(1);
  const db = new DatabaseSync(join(dir, 'sprint2go.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const base = `http://127.0.0.1:${httpPort}`;
  const doc = (coll, id) => JSON.parse(db.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?').get(coll, id)?.data ?? 'null');
  const threadWith = (subject) => db.prepare("SELECT data FROM docs WHERE coll = 'threads' AND data LIKE ?").all(`%${subject}%`).map((r) => JSON.parse(r.data));
  const waitFor = async (fn, tries = 100) => {
    for (let i = 0; i < tries; i++) {
      const v = await fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  };
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.SEED_PASSWORD }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body, headers = {}) => fetch(`${base}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const j = async (method, path, body, headers) => {
      const res = await call(method, path, body, headers);
      return { status: res.status, body: await res.json().catch(() => ({})), res };
    };
    const upload = async (name, data, type = 'application/octet-stream') => (await j('POST', '/api/upload', data, { 'content-type': type, 'x-file-name': encodeURIComponent(name), 'x-workspace': 'pnp' })).body;
    return { ok: r.ok, call, j, upload, cookie };
  };
  const aqeel = await signIn('aqeel@pixelandprofits.com');
  const rizky = await signIn('rizky@pixelandprofits.com');
  check(aqeel.ok && rizky.ok, 'two teammates sign in');
  const canSend = () => {
    const w = doc('workspaces', 'pnp');
    w.mailReady = { at: new Date().toISOString(), receive: true, send: true, why: {}, mailboxes: Object.fromEntries((w.accounts ?? []).map((a) => [a.id, { receive: true, send: true }])) };
    db.prepare("UPDATE docs SET data = ? WHERE coll = 'workspaces' AND id = 'pnp'").run(JSON.stringify(w));
  };
  canSend();
  const sendMail = async (subject, files, extra = {}) => {
    const tid = `t-files-${randomBytes(4).toString('hex')}`;
    const mid = `m-files-${randomBytes(4).toString('hex')}`;
    const body = { workspaceId: 'pnp', accountId: 'pnp-aqeel', threadId: tid, messageId: mid, to: [{ name: 'Client', email: 'client@outside-files.example' }, { name: 'Rizky', email: 'rizky@pixelandprofits.com' }], cc: [], subject, text: 'Files attached.', html: '<p>Files attached.</p>', files, ...extra };
    let r = await aqeel.j('POST', '/api/mail/send', body);
    if (r.status === 409) (canSend(), (r = await aqeel.j('POST', '/api/mail/send', body)));
    return { ...r, tid, mid };
  };
  const outsideCopy = (subject) => waitFor(() => sunk.find((m) => m.raw.includes(subject) && m.to.includes('client@outside-files.example')));
  const rizkyCopy = (subject) => waitFor(() => threadWith(subject).find((t) => t.accountId === 'pnp-rizky'));

  /* ---------- 3. sending ---------- */
  const blob = await sendMail('blob link', [{ name: 'a.pdf', url: 'blob:http://localhost/123' }]);
  check(blob.status === 403, 'a browser-only blob: link is refused (why Compose now uploads files when they’re added)');
  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(3000)]);
  const pdf = await aqeel.upload('brief.pdf', pdfBytes, 'application/pdf');
  const word = await aqeel.upload('plan.docx', docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const pic = await aqeel.upload('chart.png', PNG, 'image/png');
  check(!!pdf.url && !!word.url && !!pic.url, 'files upload to the server');
  const s1 = `with files ${randomBytes(3).toString('hex')}`;
  const r1 = await sendMail(s1, [{ name: 'brief.pdf', url: pdf.url }, { name: 'plan.docx', url: word.url }], { html: `<p>See the chart:</p><p><img src="${pic.url}" alt="chart"></p>` });
  check(r1.status === 200, `an email with uploaded files is taken (${r1.status} ${r1.body.error ?? ''})`);
  const out1 = await outsideCopy(s1);
  const parsed1 = out1 ? await simpleParser(out1.raw, { keepCidLinks: true }) : null;
  check(!!parsed1 && parsed1.attachments.some((a) => a.filename === 'brief.pdf' && a.content.equals(pdfBytes)) && parsed1.attachments.some((a) => a.filename === 'plan.docx'), 'the outside copy carries both files, byte for byte');
  const cidPart = parsed1?.attachments.find((a) => a.contentId && a.contentType === 'image/png');
  check(!!cidPart && parsed1.html.includes(`cid:${String(cidPart.contentId).replace(/[<>]/g, '')}`) && !parsed1.html.includes('/api/files/'), 'the pasted picture goes out inside the email as a cid image');
  const rz1 = await rizkyCopy(s1);
  const rzAtts = rz1?.messages[0].attachments ?? [];
  check(rzAtts.filter((a) => !a.inline).length === 2 && rzAtts.every((a) => a.url && a.url !== pdf.url && a.scan === 'clean'), 'the teammate gets their own copies of the files, scanned clean');
  const inl = rzAtts.find((a) => a.inline);
  check(!!inl && rz1.messages[0].html.includes(inl.url), 'and sees the picture in place, not as an attachment');

  const exe = await aqeel.upload('tool.exe', program());
  const rExe = await sendMail('exe out', [{ name: 'tool.exe', url: exe.url }]);
  check(rExe.status === 400 && /can’t be sent/.test(rExe.body.error ?? ''), 'an .exe can’t be sent');
  const renamed = await aqeel.upload('invoice.pdf', program(), 'application/pdf');
  const rRen = await sendMail('renamed out', [{ name: 'invoice.pdf', url: renamed.url }]);
  check(rRen.status === 400 && /program/.test(rRen.body.error ?? ''), 'a program renamed to .pdf can’t be sent');
  const zipped = await aqeel.upload('photos.zip', makeZip([{ name: 'a.jpg', data: 'jpg' }, { name: 'sub/run.bat', data: 'echo' }]));
  const rZip = await sendMail('zip out', [{ name: 'photos.zip', url: zipped.url }]);
  check(rZip.status === 400 && /zip/.test(rZip.body.error ?? ''), 'a zip holding a .bat can’t be sent');
  const nested = await aqeel.upload('outer.zip', makeZip([{ name: 'inner.zip', data: makeZip([{ name: 'evil.js', data: 'x' }]) }]));
  const rNest = await sendMail('nested out', [{ name: 'outer.zip', url: nested.url }]);
  check(rNest.status === 400, 'a zip in a zip holding a .js can’t be sent');
  const okZip = await aqeel.upload('fine.zip', makeZip([{ name: 'a.txt', data: 'hello' }]));
  check((await sendMail(`fine zip ${randomBytes(2).toString('hex')}`, [{ name: 'fine.zip', url: okZip.url }])).status === 200, 'an ordinary zip goes out');
  const big = await aqeel.upload('video.mov', Buffer.alloc(20 * MB, 1), 'video/quicktime');
  const rBig = await sendMail('too big', [{ name: 'video.mov', url: big.url }]);
  check(rBig.status === 400 && /25 MB/.test(rBig.body.error ?? ''), 'an email over 25 MB with its files is refused, pointing at Drive links');

  // A scheduled email keeps its files (the app saves them with their addresses now): it goes out with them.
  const s2 = `scheduled files ${randomBytes(3).toString('hex')}`;
  const tid2 = `t-sched-${randomBytes(4).toString('hex')}`;
  const saved = await aqeel.j('POST', '/api/sync', { coll: 'threads', upserts: [{ id: tid2, accountId: 'pnp-aqeel', subject: s2, location: 'drafts', starred: false, unread: false, labels: [], sendAt: new Date(Date.now() - 1000).toISOString(), messages: [{ id: 'm-s', from: { name: 'Aqeel', email: 'aqeel@pixelandprofits.com' }, to: [{ name: 'Client', email: 'client@outside-files.example' }], date: new Date().toISOString(), body: 'Later', attachments: [{ name: 'brief.pdf', size: '3.0 KB', url: pdf.url }] }] }], deletes: [] });
  check(saved.status === 200, 'a scheduled email is saved with its files');
  const out2 = await waitFor(() => sunk.find((m) => m.raw.includes(s2)), 400);
  const parsed2 = out2 ? await simpleParser(out2.raw) : null;
  check(!!parsed2 && parsed2.attachments.some((a) => a.filename === 'brief.pdf' && a.content.equals(pdfBytes)), 'a scheduled email goes out with its files');

  /* ---------- 4. receiving ---------- */
  const smtp = nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, secure: false, tls: { rejectUnauthorized: false } });
  const s3 = `incoming ${randomBytes(3).toString('hex')}`;
  await smtp.sendMail({
    from: 'Outside <someone@outside-files.example>',
    to: 'aqeel@pixelandprofits.com',
    subject: s3,
    text: 'Files',
    html: '<p>Our logo: <img src="cid:logo123"></p>',
    attachments: [
      { filename: 'notes.txt', content: 'hello' },
      { filename: 'setup.exe', content: program() },
      { filename: 'bundle.zip', content: makeZip([{ name: 'readme.txt', data: 'x' }, { name: 'install.vbs', data: 'x' }]) },
      { filename: 'scan-me.pdf', content: VIRUS },
      { filename: 'logo.png', content: PNG, cid: 'logo123' },
    ],
  });
  const t3 = await waitFor(() => threadWith(s3).find((t) => t.accountId === 'pnp-aqeel'));
  const a3 = t3?.messages[0].attachments ?? [];
  const by = (n) => a3.find((a) => a.name === n);
  check(by('notes.txt')?.url && by('notes.txt')?.scan === 'clean', 'an ordinary file arrives, scanned clean');
  check(by('setup.exe') && !by('setup.exe').url && /run programs/.test(by('setup.exe').blocked ?? ''), 'an .exe is listed as blocked and not kept');
  check(by('bundle.zip') && !by('bundle.zip').url && /zip/.test(by('bundle.zip').blocked ?? ''), 'a zip holding a .vbs is blocked');
  check(by('scan-me.pdf') && !by('scan-me.pdf').url && /virus/.test(by('scan-me.pdf').blocked ?? ''), 'a file the scanner flags is blocked as a virus');
  check(by('logo.png')?.inline && t3.messages[0].html.includes(by('logo.png').url) && !t3.messages[0].html.includes('cid:'), 'a cid picture shows in place');
  check(scans > 0, 'the scanner was asked (CLAMD_HOST)');
  check(!db.prepare("SELECT 1 FROM files WHERE name IN ('setup.exe', 'bundle.zip', 'scan-me.pdf') AND workspace_id = 'pnp'").get(), 'nothing refused is kept as a file');

  /* ---------- 5. Download all ---------- */
  const zr = await aqeel.call('GET', `/api/mail/zip?threadId=${t3.id}&messageId=${t3.messages[0].id}`);
  check(zr.status === 200 && zr.headers.get('content-type') === 'application/zip', 'Download all answers with a zip');
  const zipPath = join(work, 'all.zip');
  writeFileSync(zipPath, Buffer.from(await zr.arrayBuffer()));
  const entries = await readZip(zipPath, { maxFiles: 50, maxTotal: 50 * MB });
  const names = entries.map((e) => e.name).sort();
  check(names.join(',') === 'notes.txt', `the zip holds the kept files only, not blocked ones or inline pictures (${names.join(', ')})`);
  const text = Buffer.concat(await Array.fromAsync(await openEntry(zipPath, entries[0]))).toString();
  check(text === 'hello', 'and unpacks to the same bytes (checksums verified)');
  const zr1 = await rizky.call('GET', `/api/mail/zip?threadId=${rz1.id}`);
  const zip1 = join(work, 'sent.zip');
  writeFileSync(zip1, Buffer.from(await zr1.arrayBuffer()));
  const e1 = await readZip(zip1, { maxFiles: 50, maxTotal: 50 * MB });
  const pdfBack = Buffer.concat(await Array.fromAsync(await openEntry(zip1, e1.find((e) => e.name === 'brief.pdf'))));
  check(pdfBack.equals(pdfBytes) && !e1.some((e) => e.name === 'chart.png'), 'a teammate’s copy zips its files too (the picture inside the words stays out)');
  check((await rizky.call('GET', `/api/mail/zip?threadId=${t3.id}`)).status === 404, 'someone without that mailbox gets nothing');

  /* ---------- 6. Save to Drive ---------- */
  const folder = { id: `d-folder-${randomBytes(3).toString('hex')}`, name: 'Clients', kind: 'folder', parentId: null, size: 0, modified: new Date().toISOString(), workspaceId: 'pnp' };
  check((await aqeel.j('POST', '/api/sync', { coll: 'drive', upserts: [folder], deletes: [] })).status === 200, 'a Drive folder to save into');
  const sv = await aqeel.j('POST', '/api/mail/files/drive', { threadId: t3.id, messageId: t3.messages[0].id, folderId: folder.id });
  const item = sv.body.items?.[0];
  check(sv.status === 200 && item?.name === 'notes.txt' && item.parentId === folder.id && /^\/api\/files\/[a-f0-9]{32}$/.test(item.url ?? ''), 'Save to Drive makes a Drive file with the real file behind it, in the folder picked');
  check(!!item && doc('drive', item.id)?.threadId === t3.id, 'the Drive file remembers the email it came from');
  const got = item ? await aqeel.call('GET', item.url) : null;
  check(!!got && (await got.text()) === 'hello', 'the saved file opens from Drive with the same content');
  const copies = db.prepare("SELECT uploaded_by AS by FROM files WHERE workspace_id = 'pnp' AND name = 'notes.txt'").all();
  check(copies.length === 2 && copies.some((c) => c.by === 'mail') && copies.some((c) => c.by !== 'mail'), 'the copy is its own file, the person’s, counted in the company’s storage');
  const svAll = await rizky.j('POST', '/api/mail/files/drive', { threadId: rz1.id });
  check(svAll.status === 200 && svAll.body.items?.length === 2 && svAll.body.items.every((i) => i.parentId === null), 'Save all to Drive saves every file (into My Drive)');
  check((await aqeel.j('POST', '/api/mail/files/drive', { threadId: t3.id, folderId: 'd-nope' })).status === 404, 'a folder that isn’t there is refused');
  check((await rizky.j('POST', '/api/mail/files/drive', { threadId: t3.id })).status === 404, 'someone without that mailbox can’t save its files');

  /* ---------- 7. big files as links ---------- */
  const lk = await aqeel.j('POST', '/api/mail/links', { workspaceId: 'pnp', access: 'anyone', recipients: [], files: [{ name: 'video.mov', url: big.url }] });
  const href = lk.body.links?.[0]?.href ?? '';
  check(lk.status === 200 && /\/f\/[a-f0-9]{40}$/.test(href), 'a big file gets a link');
  const path = href.replace(/^https?:\/\/[^/]+/, '');
  const pg = await fetch(`${base}${path}`);
  const pgText = await pg.text();
  check(pg.status === 200 && pgText.includes('video.mov') && /default-src 'none'/.test(pg.headers.get('content-security-policy') ?? ''), 'anyone with the link sees the file’s page (no scripts on it)');
  const dl = await fetch(`${base}${path}/download`);
  check(dl.status === 200 && (await dl.arrayBuffer()).byteLength === 20 * MB && /attachment/.test(dl.headers.get('content-disposition') ?? ''), 'and downloads it');
  check(db.prepare("SELECT 1 FROM docs WHERE coll = 'drive' AND data LIKE ?").get(`%${big.url}%`), 'the linked file is in Drive (Sent as links from Mail)');
  const lk2 = await aqeel.j('POST', '/api/mail/links', { workspaceId: 'pnp', access: 'recipients', recipients: ['client@outside-files.example'], files: [{ name: 'brief.pdf', url: pdf.url }] });
  const p2 = (lk2.body.links?.[0]?.href ?? '').replace(/^https?:\/\/[^/]+/, '');
  const closed = await fetch(`${base}${p2}/download`, { redirect: 'manual' });
  check(closed.status === 303, 'recipients only: no download without confirming the address');
  const form = (path, data, cookie = '') => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(data).toString() });
  const stranger = await (await form(`${p2}/code`, { email: 'stranger@else.example' })).text();
  const recipient = await (await form(`${p2}/code`, { email: 'client@outside-files.example' })).text();
  check(stranger.replace(/stranger@else\.example/g, 'X') === recipient.replace(/client@outside-files\.example/g, 'X'), 'asking for a code says the same whoever asks (nobody learns who it went to)');
  const code = await waitFor(() => /Code for client@outside-files\.example to open brief\.pdf: (\d{6})/.exec(log)?.[1]);
  check(!!code && !/Code for stranger@else/.test(log), 'only a recipient gets a code');
  const wrong = await form(`${p2}/open`, { email: 'client@outside-files.example', code: '000000' === code ? '111111' : '000000' });
  check(wrong.status === 400, 'a wrong code doesn’t open it');
  const right = await form(`${p2}/open`, { email: 'client@outside-files.example', code });
  const fcookie = (right.headers.get('set-cookie') ?? '').split(';')[0];
  check(right.status === 303 && fcookie.startsWith('s2gf='), 'the right code opens it on this browser');
  const dl2 = await fetch(`${base}${p2}/download`, { headers: { cookie: fcookie } });
  check(dl2.status === 200 && Buffer.from(await dl2.arrayBuffer()).equals(pdfBytes), 'and the recipient downloads the file');
  const forged = decodeURIComponent(fcookie.slice(5)).split('|');
  const fake = `s2gf=${encodeURIComponent(`stranger@else.example|${forged[1]}|${forged[2]}`)}`;
  check((await fetch(`${base}${p2}/download`, { headers: { cookie: fake }, redirect: 'manual' })).status === 303, 'a cookie changed to another address doesn’t work');
  const team = await rizky.call('GET', `${p2}/download`);
  check(team.status === 200, 'a teammate of the sender, signed in, opens it straight away');
  check((await fetch(`${base}/f/${'0'.repeat(40)}`)).status === 404, 'an unknown link says it doesn’t work');
  const notMine = await rizky.j('POST', '/api/mail/links', { workspaceId: 'pnp', access: 'anyone', files: [{ name: 'plan.docx', url: word.url }] });
  check(notMine.status === 403, 'nobody can make a link to a teammate’s private upload');

  /* ---------- previews over the file route ---------- */
  const pv = await aqeel.call('GET', `${word.url}/preview`);
  const pvText = await pv.text();
  check(pv.status === 200 && pvText.includes('Quarterly plan') && /sandbox/.test(pv.headers.get('content-security-policy') ?? '') && !/script-src/.test(pv.headers.get('content-security-policy') ?? ''), 'a Word file previews as a sandboxed page with no scripts');
  check((await rizky.call('GET', `${word.url}/preview`)).status === 404 || (await rizky.call('GET', word.url)).status === 200, 'a preview follows the same rule as opening the file');
  const pvPdf = await aqeel.j('GET', `${pdf.url}/preview`);
  check(pvPdf.status === 415 && !!pvPdf.body.error, 'a kind the server doesn’t convert says so');

  /* ---------- 8. every attachment ---------- */
  const fl = await aqeel.j('GET', '/api/mail/files?workspaceId=pnp');
  check(fl.status === 200 && fl.body.files.some((f) => f.name === 'notes.txt') && !fl.body.files.some((f) => f.name === 'setup.exe' || f.name === 'logo.png'), 'every attachment across the mail: kept files, not blocked ones or inline pictures');
  const fq = await aqeel.j('GET', '/api/mail/files?workspaceId=pnp&q=pdf');
  check(fq.body.files.length > 0 && fq.body.files.every((f) => /pdf/i.test(f.name)), 'filename: finds by name or kind');
  const fr = await rizky.j('GET', '/api/mail/files?workspaceId=pnp');
  check(!fr.body.files.some((f) => f.threadId === t3.id), 'nobody sees another person’s mailbox’s files');
} catch (e) {
  console.log('FAIL', e);
  failed++;
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll mail attachment checks passed.');
finish(failed ? 1 : 0);
