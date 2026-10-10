// Previews of documents, made here as plain HTML so nobody has to download a file to read it: Word (.docx), Excel
// (.xlsx), PowerPoint (.pptx), CSV and text. Small pure readers, no outside tools: the Office formats are zips of XML
// (read with server/zip.ts, which refuses zips that lie about their sizes), and only their words, tables and pictures
// come out. Nothing in a document can run here or in the page: the output is built from escaped text, pictures become
// data: links, and the page is served (and shown in the app) in a sandbox with scripts off (server/mailFiles.ts).
// Old binary Office files (.doc, .xls, .ppt) aren't read: the viewer says so and offers Download.
import { readFile, stat } from 'node:fs/promises';
import { readZip, openEntry, type ZipEntry } from './zip.ts';
import { extOf } from '../src/mailAttachments.ts';

/** What a preview gives: a whole HTML page, or why there is none (a sentence the app shows). */
export type Preview = { html: string } | { none: string };

/** Sentences the app shows (src/i18n/id/mail.files.ts has them in Indonesian). */
export const NO_PREVIEW = {
  kind: 'There’s no preview for this kind of file. Download it to open it.',
  big: 'This file is too big to preview. Download it to open it.',
  damaged: 'This file couldn’t be read, so there’s no preview. Download it to open it.',
  locked: 'This file is protected with a password, so there’s no preview.',
};

/** Limits: the file itself, one part of it unpacked, all of it unpacked, and pictures shown inside. */
const MAX_FILE = 40 * 1024 * 1024;
const MAX_PART = 30 * 1024 * 1024;
const MAX_PICTURE = 3 * 1024 * 1024;
const MAX_PICTURES = 12 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_COLS = 60;
const MAX_TEXT = 2 * 1024 * 1024;

/* ---------- XML, read just enough ---------- */

type Tok = { k: 'open'; name: string; attrs: Record<string, string>; self: boolean } | { k: 'close'; name: string } | { k: 'text'; text: string };

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const unent = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });

/** The tags and text of an XML document, in order (no DTDs, comments or processing instructions). */
export function* xml(src: string): Generator<Tok> {
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(?:[^>]*)>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) yield { k: 'text', text: m[1] };
    else if (m[3]) {
      if (m[2]) yield { k: 'close', name: m[3] };
      else {
        const attrs: Record<string, string> = {};
        for (const a of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unent(a[2] ?? a[3] ?? '');
        yield { k: 'open', name: m[3], attrs, self: !!m[5] };
      }
    } else if (m[6] !== undefined) yield { k: 'text', text: unent(m[6]) };
  }
}

export const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- reading the zip ---------- */

class Pkg {
  readonly path: string;
  readonly entries: Map<string, ZipEntry>;
  constructor(path: string, entries: Map<string, ZipEntry>) {
    this.path = path;
    this.entries = entries;
  }
  static async open(path: string) {
    const list = await readZip(path, { maxFiles: 20000, maxTotal: 1024 * 1024 * 1024 });
    return new Pkg(path, new Map(list.filter((e) => !e.dir).map((e) => [e.name, e])));
  }
  has(name: string) {
    return this.entries.has(name);
  }
  async bytes(name: string, max = MAX_PART): Promise<Buffer | null> {
    const e = this.entries.get(name);
    if (!e || e.size > max) return null;
    const s = await openEntry(this.path, e, max);
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
  async text(name: string) {
    return (await this.bytes(name))?.toString('utf8') ?? null;
  }
  /** A part's relationships: id to the path of what it points at (relative to the part's folder). */
  async rels(part: string): Promise<Map<string, string>> {
    const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/')) : '';
    const file = `${dir ? dir + '/' : ''}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`;
    const out = new Map<string, string>();
    const src = await this.text(file);
    if (!src) return out;
    for (const t of xml(src)) if (t.k === 'open' && t.name === 'Relationship' && t.attrs.Id && t.attrs.Target && t.attrs.TargetMode !== 'External') out.set(t.attrs.Id, resolve(dir, t.attrs.Target));
    return out;
  }
}
/** "word" + "media/image1.png" → "word/media/image1.png"; "ppt/slides" + "../media/a.png" → "ppt/media/a.png". */
function resolve(dir: string, target: string) {
  const parts = (target.startsWith('/') ? target.slice(1) : `${dir}/${target}`).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

/** Pictures inside a document, as data: links (only kinds a browser shows safely, and within the limits). */
class Pictures {
  used = 0;
  readonly pkg: Pkg;
  constructor(pkg: Pkg) {
    this.pkg = pkg;
  }
  async src(path: string | undefined): Promise<string | null> {
    if (!path) return null;
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[extOf(path)];
    const e = this.pkg.entries.get(path);
    if (!type || !e || e.size > MAX_PICTURE || this.used + e.size > MAX_PICTURES) return null;
    const b = await this.pkg.bytes(path, MAX_PICTURE);
    if (!b) return null;
    this.used += b.length;
    return `data:${type};base64,${b.toString('base64')}`;
  }
}

/* ---------- the page ---------- */

const PAGE_CSS = `
:root{color-scheme:light dark;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--head:#f6f7f9;--bg:#fff;--card:#fff}
.dark{--fg:#e6e7ea;--muted:#9aa0aa;--line:#2c2f36;--head:#1c1f25;--bg:#121418;--card:#181b20}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
body{padding:24px 16px 48px}
.doc{max-width:760px;margin:0 auto;background:var(--card);padding:32px;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow-wrap:anywhere}
@media (max-width:600px){body{padding:8px 0 32px}.doc{padding:16px;border-radius:0;box-shadow:none}}
h1,h2,h3,h4{line-height:1.3;margin:1.2em 0 .5em}h1{font-size:24px}h2{font-size:20px}h3{font-size:17px}h4{font-size:15px}
p{margin:0 0 .6em}ul,ol{margin:0 0 .8em;padding-left:24px}
img{max-width:100%;height:auto}
table{border-collapse:collapse;margin:0 0 1em;font-size:13px}
td,th{border:1px solid var(--line);padding:4px 8px;vertical-align:top;text-align:left}
.sheet-wrap{overflow:auto;max-width:100%;border:1px solid var(--line);border-radius:10px;margin:0 0 24px}
.sheet-wrap table{margin:0;border:0}
.sheet-wrap th{background:var(--head);color:var(--muted);font-weight:600;position:sticky;top:0}
.sheet-wrap td.n{text-align:right;font-variant-numeric:tabular-nums}
.sheet-wrap td,.sheet-wrap th{white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
.rown{color:var(--muted);background:var(--head);text-align:right}
.sheet-name{font-size:15px;font-weight:600;margin:0 0 8px}
.slide{max-width:760px;margin:0 auto 24px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:28px 32px;min-height:220px}
.slide .num{color:var(--muted);font-size:12px;margin-bottom:8px}
.slide h2{margin-top:0}
.slide img{max-height:320px;display:block;margin:12px 0}
pre{white-space:pre-wrap;word-break:break-word;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
.more{color:var(--muted);font-size:13px;margin:8px 0 24px}
.empty{color:var(--muted);text-align:center;margin:48px 0}
`;

function page(body: string, dark: boolean, title: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body class="${dark ? 'dark' : ''}">${body}</body></html>`;
}

/* ---------- Word ---------- */

async function docx(pkg: Pkg): Promise<string> {
  const main = 'word/document.xml';
  const src = await pkg.text(main);
  if (src == null) throw new Error('damaged');
  const rels = await pkg.rels(main);
  const pics = new Pictures(pkg);
  const out: string[] = [];
  // Where we are: paragraphs collect runs; tables nest.
  let para: { style: string; list: boolean; html: string } | null = null;
  let run: { b: boolean; i: boolean; u: boolean; s: boolean } | null = null;
  let inText = false;
  let listOpen = false;
  const stack: string[] = []; // 'tbl' | 'tr' | 'tc'
  const closeList = () => {
    if (listOpen) out.push('</ul>');
    listOpen = false;
  };
  const on = (v: string | undefined) => v === undefined || !/^(0|false|none|off)$/i.test(v);
  const wrap = (text: string) => {
    let h = esc(text);
    if (!run) return h;
    if (run.b) h = `<strong>${h}</strong>`;
    if (run.i) h = `<em>${h}</em>`;
    if (run.u) h = `<u>${h}</u>`;
    if (run.s) h = `<s>${h}</s>`;
    return h;
  };
  for (const t of xml(src)) {
    if (t.k === 'text') {
      if (inText && para) para.html += wrap(t.text);
      continue;
    }
    if (t.k === 'open') {
      switch (t.name) {
        case 'w:p':
          para = { style: '', list: false, html: '' };
          if (t.self) para = (emitPara(), null);
          break;
        case 'w:pStyle':
          if (para) para.style = t.attrs['w:val'] ?? '';
          break;
        case 'w:numPr':
          if (para) para.list = true;
          break;
        case 'w:r':
          run = { b: false, i: false, u: false, s: false };
          break;
        case 'w:b':
          if (run) run.b = on(t.attrs['w:val']);
          break;
        case 'w:i':
          if (run) run.i = on(t.attrs['w:val']);
          break;
        case 'w:u':
          if (run) run.u = on(t.attrs['w:val']);
          break;
        case 'w:strike':
          if (run) run.s = on(t.attrs['w:val']);
          break;
        case 'w:t':
          inText = !t.self;
          break;
        case 'w:tab':
          if (para && run) para.html += '&emsp;';
          break;
        case 'w:br':
        case 'w:cr':
          if (para) para.html += '<br>';
          break;
        case 'a:blip': {
          const src = await pics.src(rels.get(t.attrs['r:embed'] ?? ''));
          if (src && para) para.html += `<img src="${src}" alt="">`;
          break;
        }
        case 'w:tbl':
          closeList();
          stack.push('tbl');
          out.push('<table>');
          break;
        case 'w:tr':
          stack.push('tr');
          out.push('<tr>');
          break;
        case 'w:tc':
          stack.push('tc');
          out.push('<td>');
          break;
      }
      continue;
    }
    switch (t.name) {
      case 'w:t':
        inText = false;
        break;
      case 'w:r':
        run = null;
        break;
      case 'w:p':
        emitPara();
        para = null;
        break;
      case 'w:tc':
        closeList();
        stack.pop();
        out.push('</td>');
        break;
      case 'w:tr':
        stack.pop();
        out.push('</tr>');
        break;
      case 'w:tbl':
        stack.pop();
        out.push('</table>');
        break;
    }
  }
  closeList();
  return out.join('') || '<p class="empty">This document is empty.</p>';

  function emitPara() {
    if (!para) return;
    const h = /^(Heading|heading)\s?([1-6])$/.exec(para.style)?.[2] ?? (para.style === 'Title' ? '1' : para.style === 'Subtitle' ? '2' : '');
    if (para.list) {
      if (!listOpen) out.push('<ul>');
      listOpen = true;
      out.push(`<li>${para.html}</li>`);
      return;
    }
    closeList();
    if (h) out.push(`<h${h}>${para.html}</h${h}>`);
    else out.push(`<p>${para.html || '&nbsp;'}</p>`);
  }
}

/* ---------- Excel ---------- */

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** An Excel day number as a date (1900 system), YYYY-MM-DD, with the time when there is one. */
const excelDate = (v: number) => {
  const d = new Date(Math.round((v - 25569) * 86400_000));
  if (Number.isNaN(d.getTime())) return String(v);
  const iso = d.toISOString();
  return v % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
};

async function xlsx(pkg: Pkg): Promise<string> {
  const book = await pkg.text('xl/workbook.xml');
  if (book == null) throw new Error('damaged');
  const rels = await pkg.rels('xl/workbook.xml');
  const shared: string[] = [];
  const ss = await pkg.text('xl/sharedStrings.xml');
  if (ss) {
    let cur: string | null = null;
    let inT = false;
    let inRph = false;
    for (const t of xml(ss)) {
      if (t.k === 'open' && t.name === 'si') cur = '';
      else if (t.k === 'open' && t.name === 'rPh') inRph = true; // phonetic hints: not shown
      else if (t.k === 'close' && t.name === 'rPh') inRph = false;
      else if (t.k === 'open' && t.name === 't' && !t.self) inT = true;
      else if (t.k === 'close' && t.name === 't') inT = false;
      else if (t.k === 'text' && inT && !inRph && cur !== null) cur += t.text;
      else if (t.k === 'close' && t.name === 'si') (shared.push(cur ?? ''), (cur = null));
    }
  }
  // Which cell styles are dates: built-in formats 14 to 22 and 45 to 47, or one of the file's own with d, m or y in it.
  const dateStyles = new Set<number>();
  const styles = await pkg.text('xl/styles.xml');
  if (styles) {
    const custom = new Map<number, string>();
    let inXfs = false;
    let i = 0;
    for (const t of xml(styles)) {
      if (t.k === 'open' && t.name === 'numFmt') custom.set(Number(t.attrs.numFmtId), t.attrs.formatCode ?? '');
      else if (t.k === 'open' && t.name === 'cellXfs') inXfs = true;
      else if (t.k === 'close' && t.name === 'cellXfs') inXfs = false;
      else if (t.k === 'open' && t.name === 'xf' && inXfs) {
        const id = Number(t.attrs.numFmtId ?? 0);
        const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
        if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom.has(id) && /[dmy]/i.test(code) && !/^[#0.,%]+$/.test(code))) dateStyles.add(i);
        i++;
      }
    }
  }
  const sheets: { name: string; path: string; hidden: boolean }[] = [];
  for (const t of xml(book)) if (t.k === 'open' && t.name === 'sheet') sheets.push({ name: t.attrs.name ?? '', path: rels.get(t.attrs['r:id'] ?? '') ?? '', hidden: !!t.attrs.state && t.attrs.state !== 'visible' });
  const out: string[] = [];
  for (const sh of sheets.filter((s) => !s.hidden && s.path).slice(0, 30)) {
    const src = await pkg.text(sh.path);
    if (src == null) continue;
    const rows = new Map<number, Map<number, { v: string; n: boolean }>>();
    let maxCol = -1;
    let maxRow = -1;
    let rowNo = 0;
    let cell: { col: number; t: string; s: number; v: string } | null = null;
    let inV = false;
    let more = false;
    for (const t of xml(src)) {
      if (t.k === 'open' && t.name === 'row') rowNo = Number(t.attrs.r ?? rowNo + 1);
      else if (t.k === 'open' && t.name === 'c') {
        cell = { col: t.attrs.r ? colIndex(t.attrs.r) : (rows.get(rowNo)?.size ?? 0), t: t.attrs.t ?? 'n', s: Number(t.attrs.s ?? 0), v: '' };
        if (t.self) cell = null;
      } else if (t.k === 'open' && (t.name === 'v' || t.name === 't') && !t.self) inV = true;
      else if (t.k === 'close' && (t.name === 'v' || t.name === 't')) inV = false;
      else if (t.k === 'text' && inV && cell) cell.v += t.text;
      else if (t.k === 'close' && t.name === 'c' && cell) {
        const r = rowNo - 1;
        if (r >= MAX_ROWS || cell.col >= MAX_COLS) {
          more = true;
          cell = null;
          continue;
        }
        let v = cell.v;
        let n = false;
        if (cell.t === 's') v = shared[Number(v)] ?? '';
        else if (cell.t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
        else if (cell.t === 'n' && v !== '') {
          const num = Number(v);
          if (dateStyles.has(cell.s) && Number.isFinite(num)) v = excelDate(num);
          else {
            n = true;
            v = Number.isFinite(num) ? String(Math.round(num * 1e10) / 1e10) : v;
          }
        }
        if (v !== '') {
          if (!rows.has(r)) rows.set(r, new Map());
          rows.get(r)!.set(cell.col, { v, n });
          maxCol = Math.max(maxCol, cell.col);
          maxRow = Math.max(maxRow, r);
        }
        cell = null;
      }
    }
    out.push(`<h2 class="sheet-name">${esc(sh.name)}</h2>`);
    if (maxRow < 0) {
      out.push('<p class="more">This sheet is empty.</p>');
      continue;
    }
    const head = `<tr><th class="rown"></th>${Array.from({ length: maxCol + 1 }, (_, i) => `<th>${colName(i)}</th>`).join('')}</tr>`;
    const body: string[] = [];
    for (let r = 0; r <= maxRow; r++) {
      const row = rows.get(r);
      body.push(`<tr><td class="rown">${r + 1}</td>${Array.from({ length: maxCol + 1 }, (_, c) => {
        const x = row?.get(c);
        return x ? `<td${x.n ? ' class="n"' : ''}>${esc(x.v)}</td>` : '<td></td>';
      }).join('')}</tr>`);
    }
    out.push(`<div class="sheet-wrap"><table>${head}${body.join('')}</table></div>`);
    if (more) out.push(`<p class="more">Showing the first ${MAX_ROWS} rows and ${MAX_COLS} columns. Download the file to see all of it.</p>`);
  }
  return out.join('') || '<p class="empty">This workbook is empty.</p>';
}

/* ---------- PowerPoint ---------- */

async function pptx(pkg: Pkg): Promise<string> {
  const pres = await pkg.text('ppt/presentation.xml');
  if (pres == null) throw new Error('damaged');
  const rels = await pkg.rels('ppt/presentation.xml');
  const order: string[] = [];
  for (const t of xml(pres)) if (t.k === 'open' && t.name === 'p:sldId') order.push(rels.get(t.attrs['r:id'] ?? '') ?? '');
  const pics = new Pictures(pkg);
  const out: string[] = [];
  let n = 0;
  for (const path of order.filter(Boolean).slice(0, 300)) {
    const src = await pkg.text(path);
    if (src == null) continue;
    n++;
    const srels = await pkg.rels(path);
    let title = '';
    const lines: { lvl: number; text: string }[] = [];
    const images: string[] = [];
    let isTitle = false;
    let para: { lvl: number; text: string } | null = null;
    let inT = false;
    for (const t of xml(src)) {
      if (t.k === 'open') {
        if (t.name === 'p:sp') isTitle = false;
        else if (t.name === 'p:ph' && /title/i.test(t.attrs.type ?? '')) isTitle = true;
        else if (t.name === 'a:p') para = { lvl: 0, text: '' };
        else if (t.name === 'a:pPr' && para) para.lvl = Math.min(4, Number(t.attrs.lvl ?? 0));
        else if (t.name === 'a:t' && !t.self) inT = true;
        else if (t.name === 'a:br' && para) para.text += '\n';
        else if (t.name === 'a:blip') {
          const s = await pics.src(srels.get(t.attrs['r:embed'] ?? ''));
          if (s) images.push(s);
        }
      } else if (t.k === 'close') {
        if (t.name === 'a:t') inT = false;
        else if (t.name === 'a:p' && para) {
          if (para.text.trim()) {
            if (isTitle && !title) title = para.text.trim();
            else if (!isTitle) lines.push(para);
          }
          para = null;
        }
      } else if (inT && para) para.text += t.text;
    }
    const list = lines.length ? `<ul>${lines.map((l) => `<li style="margin-left:${l.lvl * 20}px">${esc(l.text).replace(/\n/g, '<br>')}</li>`).join('')}</ul>` : '';
    out.push(`<section class="slide"><div class="num">${n}</div>${title ? `<h2>${esc(title)}</h2>` : ''}${list}${images.map((s) => `<img src="${s}" alt="">`).join('')}</section>`);
  }
  return out.join('') || '<p class="empty">This presentation has no slides.</p>';
}

/* ---------- CSV and text ---------- */

/** A CSV (or TSV, or semicolons as Excel writes them in many countries) as rows of cells. */
export function parseCsv(text: string, max = MAX_ROWS): { rows: string[][]; more: boolean } {
  const s = text.replace(/^﻿/, '');
  const first = s.slice(0, s.indexOf('\n') >>> 0 || 2000);
  const sep = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) (row.push(cell), (cell = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length >= max) return { rows, more: i < s.length - 1 };
    } else cell += ch;
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row));
  return { rows, more: false };
}

function csvHtml(text: string) {
  const { rows, more } = parseCsv(text);
  if (!rows.length) return '<p class="empty">This file is empty.</p>';
  const cols = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)));
  const head = `<tr><th class="rown"></th>${Array.from({ length: cols }, (_, i) => `<th>${colName(i)}</th>`).join('')}</tr>`;
  const body = rows.map((r, i) => `<tr><td class="rown">${i + 1}</td>${Array.from({ length: cols }, (_, c) => (r[c] !== undefined && /^-?[\d.,]+%?$/.test(r[c].trim()) ? `<td class="n">${esc(r[c])}</td>` : `<td>${esc(r[c] ?? '')}</td>`)).join('')}</tr>`).join('');
  return `<div class="sheet-wrap"><table>${head}${body}</table></div>${more ? `<p class="more">Showing the first ${MAX_ROWS} rows. Download the file to see all of it.</p>` : ''}`;
}

/** Text as it was written: a byte order mark and UTF-16 read right, anything else as UTF-8. */
const decode = (b: Buffer) => (b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString('utf16le') : b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString('utf16le') : b.toString('utf8'));

/* ---------- the way in ---------- */

/** A preview of the file at `path` called `name`. `dark`: the page in dark colours (the app's theme). */
export async function preview(path: string, name: string, type = '', dark = false): Promise<Preview> {
  const ext = extOf(name) || (String(type).startsWith('text/plain') ? 'txt' : '');
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch {
    return { none: NO_PREVIEW.damaged };
  }
  try {
    if (['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm'].includes(ext)) {
      if (size > MAX_FILE) return { none: NO_PREVIEW.big };
      const pkg = await Pkg.open(path);
      const body = ext.startsWith('doc') ? `<article class="doc">${await docx(pkg)}</article>` : ext.startsWith('xls') ? await xlsx(pkg) : await pptx(pkg);
      return { html: page(body, dark, name) };
    }
    if (['csv', 'tsv'].includes(ext)) {
      if (size > MAX_FILE) return { none: NO_PREVIEW.big };
      return { html: page(csvHtml(decode(await readFile(path))), dark, name) };
    }
    if (['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'eml', 'ics', 'vcf'].includes(ext)) {
      const b = await readFile(path);
      const text = decode(b.subarray(0, MAX_TEXT));
      return { html: page(`<article class="doc"><pre>${esc(text)}</pre>${b.length > MAX_TEXT ? '<p class="more">Showing the start of the file. Download it to see all of it.</p>' : ''}</article>`, dark, name) };
    }
  } catch (e) {
    const why = (e as { why?: string })?.why;
    return { none: why === 'locked' ? NO_PREVIEW.locked : NO_PREVIEW.damaged };
  }
  return { none: NO_PREVIEW.kind };
}
