import type { DataTable, FieldType, TableRow, User } from '../../types';
import { cellText, isEmpty } from './core';

/**
 * CSV text into rows of cells. Handles quotes, line breaks inside quotes, the byte-order mark Excel adds,
 * and the delimiter: comma, semicolon (Excel in Indonesia and Europe) or tab, whichever the header uses.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  const count = (d: string) => firstLine.split('"').filter((_, i) => i % 2 === 0).join('').split(d).length - 1;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) (row.push(cell), (cell = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/** A new column's best kind, from its values. */
export function guessType(name: string, values: string[]): FieldType {
  const v = values.filter((x) => x !== '').slice(0, 200);
  if (!v.length) return 'text';
  const all = (re: RegExp) => v.every((x) => re.test(x));
  if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return 'email';
  if (/phone|telp|whatsapp|\bwa\b|\bhp\b|mobile/i.test(name) || all(/^\+?[\d\s().-]{8,}$/)) return all(/^\+?[\d\s().-]{6,}$/) ? 'phone' : 'text';
  if (all(/^https?:\/\/\S+$/)) return 'url';
  if (all(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/)) return 'date';
  if (all(/^(yes|no|true|false|ya|tidak|y|n|1|0)$/i) && new Set(v.map((x) => x.toLowerCase())).size <= 2) return 'checkbox';
  if (all(/^-?(rp\s?)?[\d.,]+$/i)) return /price|harga|value|nilai|budget|revenue|amount|total|rp/i.test(name) || v.some((x) => /^rp/i.test(x)) ? 'money' : 'number';
  const distinct = new Set(v.map((x) => x.toLowerCase()));
  if (v.length >= 4 && distinct.size <= Math.min(12, Math.ceil(v.length / 2)) && v.every((x) => x.length <= 40)) return 'select';
  if (v.some((x) => x.length > 120 || x.includes('\n'))) return 'longtext';
  return 'text';
}

/** Rows as CSV (with the mark Excel needs to read the letters right). Numbers stay plain numbers. */
export function rowsToCsv(t: DataTable, rows: TableRow[], users: User[], rowNameOf: (id: string) => string, fieldIds?: string[]) {
  const fields = t.fields.filter((f) => f.type !== 'button' && (!fieldIds || fieldIds.includes(f.id)));
  const esc = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = fields.map((f) => esc(f.name)).join(',');
  const body = rows.map((r) =>
    fields
      .map((f) => {
        const v = r.values[f.id];
        if ((f.type === 'number' || f.type === 'money') && !isEmpty(v)) return String(v);
        if (f.type === 'date' && !isEmpty(v)) return String(v);
        return esc(cellText(f, v, { users, rowName: rowNameOf }));
      })
      .join(','),
  );
  return '﻿' + [head, ...body].join('\r\n');
}

/** Saves text as a file in the browser. */
export function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
