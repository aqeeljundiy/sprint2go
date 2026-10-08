import type { CellValue, DataTable, FieldType, TableField, TableFilter, TableRow, TableViewDef, User } from '../../types';
import { localDay, uid } from '../../utils';

/* Pure table logic, shared by the app and the server (no React, no icons). */

/** Colours for choices, soft enough to read text on in both themes. */
export const OPTION_COLORS = ['#64748b', '#3b82f6', '#0ea5e9', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6'];
export const TABLE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

const option = (label: string, color: string) => ({ id: uid(), label, color });

export const isEmpty = (v: CellValue | undefined) => v == null || v === '' || (Array.isArray(v) && !v.length) || v === false;

const CURRENCY: Record<string, { locale: string; code: string }> = {
  IDR: { locale: 'id-ID', code: 'IDR' },
  USD: { locale: 'en-US', code: 'USD' },
  SGD: { locale: 'en-SG', code: 'SGD' },
  EUR: { locale: 'de-DE', code: 'EUR' },
};
export function money(n: number, currency = 'IDR') {
  const c = CURRENCY[currency] ?? CURRENCY.IDR;
  return new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.code, maximumFractionDigits: currency === 'IDR' ? 0 : 2 }).format(n);
}

/** One row's name: its first field, or "Untitled". */
export const rowName = (t: DataTable, r: TableRow | undefined) => {
  const v = r?.values[t.fields[0]?.id];
  return (typeof v === 'string' && v.trim()) || (typeof v === 'number' ? String(v) : '') || 'Untitled';
};

/** A cell as plain text: for search, sorting, CSV and copying. */
export function cellText(f: TableField, v: CellValue | undefined, ctx: { users: User[]; rowName: (id: string) => string }): string {
  if (isEmpty(v)) return '';
  switch (f.type) {
    case 'select':
      return f.options?.find((o) => o.id === v)?.label ?? '';
    case 'multi':
      return ((v as string[]) ?? []).map((id) => f.options?.find((o) => o.id === id)?.label).filter(Boolean).join(', ');
    case 'person':
      return ctx.users.find((u) => u.id === v)?.name ?? '';
    case 'money':
      return money(Number(v), f.currency);
    case 'checkbox':
      return v ? 'Yes' : '';
    case 'date':
      return new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    case 'link':
      return ((v as string[]) ?? []).map(ctx.rowName).join(', ');
    default:
      return String(v);
  }
}

/** Sort key: choices sort in their own order (New before Won), numbers as numbers, the rest as text. */
function sortKey(f: TableField, v: CellValue | undefined, ctx: Parameters<typeof cellText>[2]): number | string {
  if (isEmpty(v)) return '';
  if (f.type === 'number' || f.type === 'money') return Number(v);
  if (f.type === 'select') return f.options?.findIndex((o) => o.id === v) ?? 0;
  if (f.type === 'checkbox') return v ? 1 : 0;
  if (f.type === 'date') return String(v);
  return cellText(f, v, ctx).toLowerCase();
}

/** Does a row pass one filter? */
export function passes(flt: TableFilter, f: TableField, v: CellValue | undefined, ctx: Parameters<typeof cellText>[2]) {
  switch (flt.op) {
    case 'empty':
      return isEmpty(v);
    case 'filled':
      return !isEmpty(v);
    case 'is':
      return Array.isArray(v) ? v.includes(flt.value ?? '') : f.type === 'checkbox' ? !!v === (flt.value === 'yes') : String(v ?? '') === (flt.value ?? '');
    case 'not':
      return Array.isArray(v) ? !v.includes(flt.value ?? '') : f.type === 'checkbox' ? !!v !== (flt.value === 'yes') : String(v ?? '') !== (flt.value ?? '');
    case 'has':
      return cellText(f, v, ctx).toLowerCase().includes((flt.value ?? '').toLowerCase());
    case 'gt':
      return !isEmpty(v) && (f.type === 'date' ? String(v) > (flt.value ?? '') : Number(v) > Number(flt.value));
    case 'lt':
      return !isEmpty(v) && (f.type === 'date' ? String(v) < (flt.value ?? '') : Number(v) < Number(flt.value));
  }
}

/** Which filter tests make sense for a kind of field. */
export function opsFor(t: FieldType): { op: TableFilter['op']; label: string }[] {
  const base = [
    { op: 'empty' as const, label: 'is empty' },
    { op: 'filled' as const, label: 'is not empty' },
  ];
  if (t === 'select' || t === 'multi' || t === 'person') return [{ op: 'is', label: t === 'multi' ? 'has' : 'is' }, { op: 'not', label: t === 'multi' ? 'doesn’t have' : 'is not' }, ...base];
  if (t === 'checkbox') return [{ op: 'is', label: 'is' }];
  if (t === 'number' || t === 'money') return [{ op: 'gt', label: 'more than' }, { op: 'lt', label: 'less than' }, { op: 'is', label: 'equals' }, ...base];
  if (t === 'date') return [{ op: 'lt', label: 'before' }, { op: 'gt', label: 'after' }, { op: 'is', label: 'on' }, ...base];
  return [{ op: 'has', label: 'contains' }, { op: 'is', label: 'is exactly' }, ...base];
}

/** The rows a view shows: its filters, the search, then its sort (or the manual order). */
export function visibleRows(t: DataTable, view: TableViewDef, rows: TableRow[], q: string, ctx: Parameters<typeof cellText>[2]) {
  const byId = new Map(t.fields.map((f) => [f.id, f]));
  let out = rows.filter((r) =>
    (view.filters ?? []).every((flt) => {
      const f = byId.get(flt.fieldId);
      return !f || passes(flt, f, r.values[f.id], ctx);
    }),
  );
  const needle = q.trim().toLowerCase();
  if (needle) out = out.filter((r) => t.fields.some((f) => cellText(f, r.values[f.id], ctx).toLowerCase().includes(needle)));
  const sf = view.sort && byId.get(view.sort.fieldId);
  if (sf) {
    const dir = view.sort!.dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const ka = sortKey(sf, a.values[sf.id], ctx), kb = sortKey(sf, b.values[sf.id], ctx);
      if (ka === '' && kb !== '') return 1; // empty cells always last
      if (kb === '' && ka !== '') return -1;
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir || a.order - b.order;
    });
  } else out = [...out].sort((a, b) => a.order - b.order);
  return out;
}

/** A value converted when a column changes type, so nothing silently turns to garbage. */
export function convertValue(from: TableField, to: TableField, v: CellValue | undefined, ctx: Parameters<typeof cellText>[2]): CellValue {
  if (isEmpty(v)) return null;
  const text = cellText(from, v, ctx);
  switch (to.type) {
    case 'number':
    case 'money': {
      const n = Number(String(Array.isArray(v) ? '' : v).replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
    }
    case 'checkbox':
      return !!v && text !== '' && !/^(no|false|0)$/i.test(text);
    case 'select':
      return to.options?.find((o) => o.label.toLowerCase() === text.split(', ')[0]?.toLowerCase())?.id ?? null;
    case 'multi':
      return text.split(', ').map((l) => to.options?.find((o) => o.label.toLowerCase() === l.toLowerCase())?.id).filter(Boolean) as string[];
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
    case 'person':
      return ctx.users.find((u) => u.name.toLowerCase() === text.toLowerCase())?.id ?? null;
    case 'link':
    case 'button':
      return null;
    default:
      return text;
  }
}

/** When a column becomes a choice field, its existing words become the choices. */
export function optionsFromValues(from: TableField, rows: TableRow[], ctx: Parameters<typeof cellText>[2]) {
  const words = [...new Set(rows.flatMap((r) => cellText(from, r.values[from.id], ctx).split(', ')).map((w) => w.trim()).filter(Boolean))].slice(0, 40);
  return words.map((w, i) => option(w, OPTION_COLORS[(i + 1) % OPTION_COLORS.length]));
}

/* ---------- templates ---------- */

export type TemplateId = 'blank' | 'leads' | 'pipeline' | 'tracker';
export const TEMPLATES: { id: TemplateId; name: string; hint: string }[] = [
  { id: 'leads', name: 'Leads', hint: 'Name, contact, source, status, value, owner, follow-up' },
  { id: 'pipeline', name: 'Content pipeline', hint: 'Idea to posted, with platform, owner and due date' },
  { id: 'tracker', name: 'Simple tracker', hint: 'Item, status, owner, due date' },
  { id: 'blank', name: 'Blank', hint: 'Start with one column and build your own' },
];

const grid = (hidden: string[] = []): TableViewDef => ({ id: uid(), name: 'Grid', kind: 'grid', hidden });
const board = (groupBy: string, name = 'Board'): TableViewDef => ({ id: uid(), name, kind: 'board', groupBy });

/** Columns and views for a new table. Every column can be changed afterwards. */
export function templateFields(id: TemplateId): { fields: TableField[]; views: TableViewDef[] } {
  const f = (name: string, type: FieldType, extra: Partial<TableField> = {}): TableField => ({ id: uid(), name, type, ...extra });
  if (id === 'leads') {
    const status = f('Status', 'select', { options: [option('New', '#3b82f6'), option('Contacted', '#f59e0b'), option('Qualified', '#8b5cf6'), option('Won', '#10b981'), option('Lost', '#64748b')] });
    const fields = [
      f('Name', 'text'),
      f('Email', 'email'),
      f('Phone', 'phone'),
      f('Source', 'select', { options: [option('Facebook Ads', '#3b82f6'), option('Instagram', '#ec4899'), option('Website', '#10b981'), option('Referral', '#f59e0b')] }),
      status,
      f('Value', 'money', { currency: 'IDR' }),
      f('Owner', 'person'),
      f('Follow-up', 'date'),
      f('Notes', 'longtext'),
    ];
    return { fields, views: [grid(), board(status.id, 'Pipeline')] };
  }
  if (id === 'pipeline') {
    const stage = f('Stage', 'select', { options: [option('Idea', '#64748b'), option('Script', '#0ea5e9'), option('Shooting', '#f59e0b'), option('Editing', '#f97316'), option('Review', '#8b5cf6'), option('Posted', '#10b981')] });
    const fields = [f('Title', 'text'), stage, f('Platform', 'multi', { options: [option('Instagram', '#ec4899'), option('TikTok', '#0f172a'), option('YouTube', '#ef4444')] }), f('Owner', 'person'), f('Due', 'date'), f('Brief', 'longtext')];
    return { fields, views: [board(stage.id), grid()] };
  }
  if (id === 'tracker') {
    const status = f('Status', 'select', { options: [option('To do', '#64748b'), option('Doing', '#3b82f6'), option('Done', '#10b981')] });
    return { fields: [f('Item', 'text'), status, f('Owner', 'person'), f('Due', 'date')], views: [grid(), board(status.id)] };
  }
  return { fields: [f('Name', 'text'), f('Notes', 'longtext')], views: [grid()] };
}

/** A value from outside (a webhook, a CSV cell) turned into what the field holds: choices by label (new ones added), Indonesian or English number formats, dates, people by email or name. */
export function parseIncoming(f: TableField, raw: unknown, users: User[]): { v: CellValue; field?: TableField } {
  if (raw == null || raw === '') return { v: null };
  const s = String(raw).trim();
  switch (f.type) {
    case 'number':
    case 'money': {
      const n = Number(s.replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      return { v: Number.isFinite(n) ? n : null };
    }
    case 'checkbox':
      return { v: !/^(0|false|no|tidak|off)$/i.test(s) };
    case 'date': {
      // 08/10/2026 or 8-10-2026 is day first (as written in Indonesia and Europe), never US month first.
      const dm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      if (dm) return { v: `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` };
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { v: s.slice(0, 10) };
      const d = new Date(/^\d+$/.test(s) ? Number(s) * (s.length <= 10 ? 1000 : 1) : s);
      return { v: Number.isNaN(d.getTime()) ? null : localDay(d) }; // the calendar day where it's read, not UTC
    }
    case 'person': {
      const u = users.find((x) => x.email?.toLowerCase() === s.toLowerCase() || x.name.toLowerCase() === s.toLowerCase());
      return { v: u?.id ?? null };
    }
    case 'select':
    case 'multi': {
      const labels = f.type === 'multi' ? s.split(/\s*[,;]\s*/).filter(Boolean) : [s];
      let field = f;
      const ids = labels.map((l) => {
        const hit = field.options?.find((o) => o.label.toLowerCase() === l.toLowerCase());
        if (hit) return hit.id;
        const o = { id: uid(), label: l.slice(0, 60), color: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#0ea5e9'][(field.options?.length ?? 0) % 6] };
        field = { ...field, options: [...(field.options ?? []), o] };
        return o.id;
      });
      return { v: f.type === 'multi' ? ids : ids[0], field: field !== f ? field : undefined };
    }
    case 'link':
    case 'button':
      return { v: null };
    default:
      return { v: s.slice(0, 5000) };
  }
}


const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Other names people use for common fields (English and Indonesian). */
const SAME: Record<string, string[]> = {
  name: ['fullname', 'firstname', 'nama', 'namalengkap', 'contactname', 'customer', 'pelanggan'],
  email: ['emailaddress', 'mail', 'surel'],
  phone: ['phonenumber', 'mobile', 'whatsapp', 'wa', 'telp', 'telepon', 'hp', 'nohp', 'nomorhp', 'nowa'],
  company: ['organization', 'business', 'perusahaan', 'brand'],
  city: ['kota'],
  notes: ['note', 'catatan', 'keterangan', 'message', 'pesan'],
};
/** A key or column's field by name: email -> Email, phone_number -> Phone, data.full_name -> Name, Nama -> Name. */
export function guessField(key: string, fields: TableField[], skip: Set<string> = new Set()) {
  const last = norm(key.split('.').pop() ?? key);
  const ok = fields.filter((f) => f.type !== 'button' && f.type !== 'link' && !skip.has(f.id));
  return (ok.find((f) => norm(f.name) === last) ?? ok.find((f) => (SAME[norm(f.name)] ?? []).includes(last) || Object.entries(SAME).some(([k, list]) => list.includes(norm(f.name)) && (k === last || list.includes(last)))))?.id;
}
