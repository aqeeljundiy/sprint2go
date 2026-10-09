import type { CalcKind, CellValue, DataTable, FieldType, FileRef, RowTemplate, TableField, TableFilter, TableFilterGroup, TableRow, TableViewDef, TableViewTweak, User } from '../../types';
import { localDay, uid } from '../../utils';
// The server loads this file too: the full paths, and only t/tx/mark and the format helpers (docs/i18n.md).
import { getLang, t, tx } from '../../i18n/index';
import { fmtDate, fmtList, fmtMoney, fmtNumber, fmtTime, toDate, weekdayName } from '../../i18n/format';

/* Pure table logic, shared by the app and the server (no React, no icons). */

/** Colours for choices, soft enough to read text on in both themes. */
export const OPTION_COLORS = ['#64748b', '#3b82f6', '#0ea5e9', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6'];
export const TABLE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

const option = (label: string, color: string) => ({ id: uid(), label, color });

export const isEmpty = (v: CellValue | undefined) => v == null || v === '' || (Array.isArray(v) && !v.length) || v === false;

const CURRENCIES = ['IDR', 'USD', 'SGD', 'EUR'];
/** Money in its currency: "Rp 39.000" in both languages, other currencies the reader's way ("US$1,234.50" / "US$1.234,50"). */
export function money(n: number, currency = 'IDR') {
  const code = CURRENCIES.includes(currency) ? currency : 'IDR';
  if (code === 'IDR') return (n < 0 ? '-' : '') + fmtMoney(Math.abs(n)).replace(' ', '\u00a0'); // "Rp" never wraps away from its number
  return fmtMoney(n, code, { maximumFractionDigits: 2 });
}

/** One row's name: its first field, or "Untitled". */
export const rowName = (tb: DataTable, r: TableRow | undefined) => {
  const v = r?.values[tb.fields[0]?.id];
  return (typeof v === 'string' && v.trim()) || (typeof v === 'number' ? String(v) : '') || t('Untitled');
};

/** What cell helpers need to know: people (for names), and for links and rollups the rows and tables. */
export interface TCtx {
  users: User[];
  rowName: (id: string) => string;
  rows?: TableRow[];
  tables?: DataTable[];
  me?: string; // whoever is looking: "Me" in a filter
}

/** Fields whose value is worked out, not typed: formulas, rollups, and when and by whom a row was made or changed. */
export const COMPUTED = new Set<FieldType>(['formula', 'rollup', 'created', 'edited', 'creator']);
export const isComputed = (f: TableField) => COMPUTED.has(f.type);

/** A row's value for a field: what's stored, or for computed fields, what it works out to. */
export function valueOf(t: DataTable, f: TableField, r: TableRow, ctx: TCtx, depth = 0): CellValue {
  switch (f.type) {
    case 'created':
      return r.createdAt;
    case 'edited':
      return r.updatedAt;
    case 'creator':
      return r.createdBy;
    case 'formula':
      if (depth > 4 || !f.formula) return null;
      try {
        const out = evaluate(f.formula, (name) => {
          const ref = t.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
          return ref ? formulaValue(t, ref, r, ctx, depth + 1) : null;
        }, t.fields.map((x) => x.name));
        return out === null || out === undefined || (typeof out === 'number' && !Number.isFinite(out)) ? null : (out as CellValue);
      } catch {
        return null;
      }
    case 'rollup':
      return rollupValue(t, f, r, ctx, depth);
    default:
      return r.values[f.id] ?? null;
  }
}

/** A field's value as a formula sees it: numbers stay numbers, choices and people become their names. */
function formulaValue(t: DataTable, f: TableField, r: TableRow, ctx: TCtx, depth: number): unknown {
  const v = valueOf(t, f, r, ctx, depth);
  if (isEmpty(v)) return f.type === 'checkbox' ? false : f.type === 'number' || f.type === 'money' || f.type === 'rating' ? 0 : '';
  if (f.type === 'number' || f.type === 'money' || f.type === 'rating') return Number(v);
  if (f.type === 'checkbox') return !!v;
  if (f.type === 'formula' || f.type === 'rollup') return v;
  if (f.type === 'date') return String(v);
  if (f.type === 'created' || f.type === 'edited') return String(v).slice(0, 10);
  return cellText(f, v, ctx);
}

/** A rollup: from the rows a link field points to, count them or total one of their fields. */
function rollupValue(t: DataTable, f: TableField, r: TableRow, ctx: TCtx, depth: number): CellValue {
  const ru = f.rollup;
  const link = ru && t.fields.find((x) => x.id === ru.linkField && x.type === 'link');
  if (!ru || !link || depth > 4) return null;
  const target = ctx.tables?.find((x) => x.id === link.linkTable);
  const ids = (r.values[link.id] as string[] | null) ?? [];
  const linked = (ctx.rows ?? []).filter((x) => ids.includes(x.id));
  if (ru.fn === 'count') return linked.length;
  const tf = target?.fields.find((x) => x.id === ru.targetField);
  if (!target || !tf) return null;
  const vals = linked.map((x) => valueOf(target, tf, x, ctx, depth + 1)).filter((v) => !isEmpty(v));
  if (ru.fn === 'filled') return vals.length;
  if (ru.fn === 'list') return vals.map((v) => cellText(tf, v, ctx)).join(', ') || null;
  const nums = vals.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  if (ru.fn === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (ru.fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (ru.fn === 'min') return Math.min(...nums);
  return Math.max(...nums);
}

/** A day or a moment the reader's way ("8 Oct 2026" / "8 Okt 2026"); text that isn't a date stays as it is. */
const asDate = (v: string, opts: Intl.DateTimeFormatOptions) => (Number.isNaN(toDate(v).getTime()) ? v : fmtDate(v, opts));
const dateTime = (iso: string) => asDate(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** A number the reader's way, with at most two decimals: 1,234.5 / 1.234,5. */
const num = (n: number) => fmtNumber(n, { maximumFractionDigits: 2 });

/** A cell as plain text: for search, sorting, CSV and copying. */
export function cellText(f: TableField, v: CellValue | undefined, ctx: TCtx): string {
  if (isEmpty(v)) return '';
  switch (f.type) {
    case 'select':
      return f.options?.find((o) => o.id === v)?.label ?? '';
    case 'multi':
      return ((v as string[]) ?? []).map((id) => f.options?.find((o) => o.id === id)?.label).filter(Boolean).join(', ');
    case 'person':
      return ctx.users.find((u) => u.id === v)?.name ?? '';
    case 'creator':
      return v === 'webhook' ? 'Webhook' : String(v).includes('@') ? String(v) : (ctx.users.find((u) => u.id === v)?.name ?? t('Someone'));
    case 'money':
      return money(Number(v), f.currency);
    case 'checkbox':
      return v ? t('Yes') : '';
    case 'date':
      return asDate(String(v), { day: 'numeric', month: 'short', year: 'numeric' });
    case 'created':
    case 'edited':
      return dateTime(String(v));
    case 'link':
      return ((v as string[]) ?? []).map(ctx.rowName).join(', ');
    case 'files':
      return ((v as FileRef[]) ?? []).map((x) => x.name).join(', ');
    case 'rating':
      return `${Number(v)}/${f.max ?? 5}`;
    case 'formula':
    case 'rollup':
      return typeof v === 'number' ? num(v) : typeof v === 'boolean' ? (v ? t('Yes') : t('No')) : String(v);
    default:
      return String(v);
  }
}

/** Sort key: choices sort in their own order (New before Won), numbers as numbers, the rest as text. */
function sortKey(f: TableField, v: CellValue | undefined, ctx: TCtx): number | string {
  if (isEmpty(v)) return '';
  if (f.type === 'number' || f.type === 'money' || f.type === 'rating') return Number(v);
  if ((f.type === 'formula' || f.type === 'rollup') && typeof v === 'number') return v;
  if (f.type === 'select') return f.options?.findIndex((o) => o.id === v) ?? 0;
  if (f.type === 'checkbox') return v ? 1 : 0;
  if (f.type === 'date' || f.type === 'created' || f.type === 'edited') return String(v);
  return cellText(f, v, ctx).toLowerCase();
}

/** Words for the two sort directions, in the field's own terms. */
export function sortWords(type: FieldType): [string, string] {
  if (type === 'number' || type === 'money' || type === 'rating' || type === 'rollup' || type === 'formula') return [t('Low to high'), t('High to low')];
  if (type === 'date' || type === 'created' || type === 'edited') return [t('Oldest first'), t('Newest first')];
  if (type === 'select') return [t('In choice order'), t('Reverse choice order')];
  if (type === 'checkbox') return [t('Unchecked first'), t('Checked first')];
  return [t('A to Z'), t('Z to A')];
}

/** Does a row pass one filter? */
export function passes(flt: TableFilter, f: TableField, v0: CellValue | undefined, ctx: TCtx) {
  const v = (f.type === 'created' || f.type === 'edited') && typeof v0 === 'string' ? v0.slice(0, 10) : v0;
  const isDate = f.type === 'date' || f.type === 'created' || f.type === 'edited';
  switch (flt.op) {
    case 'empty':
      return isEmpty(v);
    case 'filled':
      return !isEmpty(v);
    case 'is':
      return Array.isArray(v) ? (v as string[]).includes(flt.value ?? '') : f.type === 'checkbox' ? !!v === (flt.value === 'yes') : String(v ?? '') === (flt.value ?? '');
    case 'not':
      return Array.isArray(v) ? !(v as string[]).includes(flt.value ?? '') : f.type === 'checkbox' ? !!v !== (flt.value === 'yes') : String(v ?? '') !== (flt.value ?? '');
    case 'has':
      return cellText(f, v, ctx).toLowerCase().includes((flt.value ?? '').toLowerCase());
    case 'gt':
      return !isEmpty(v) && (isDate ? String(v) > (flt.value ?? '') : Number(v) > Number(flt.value));
    case 'lt':
      return !isEmpty(v) && (isDate ? String(v) < (flt.value ?? '') : Number(v) < Number(flt.value));
  }
}

/**
 * Which filter tests make sense for a kind of field, in words that sit between the field's name and the value
 * ("Status is New", "Due before today"). Translated with a context: "is", "on" and "before" are short and mean
 * something else elsewhere.
 */
export function opsFor(type: FieldType): { op: TableFilter['op']; label: string }[] {
  const base = [
    { op: 'empty' as const, label: tx('filter', 'is empty') },
    { op: 'filled' as const, label: tx('filter', 'is not empty') },
  ];
  if (type === 'select' || type === 'multi' || type === 'person' || type === 'creator') return [{ op: 'is', label: type === 'multi' ? tx('filter', 'has') : tx('filter', 'is') }, { op: 'not', label: type === 'multi' ? tx('filter', 'doesn’t have') : tx('filter', 'is not') }, ...base];
  if (type === 'checkbox') return [{ op: 'is', label: tx('filter', 'is') }];
  if (type === 'number' || type === 'money' || type === 'rating' || type === 'rollup') return [{ op: 'gt', label: tx('filter', 'more than') }, { op: 'lt', label: tx('filter', 'less than') }, { op: 'is', label: tx('filter', 'equals') }, ...base];
  if (type === 'date' || type === 'created' || type === 'edited') return [{ op: 'lt', label: tx('filter', 'before') }, { op: 'gt', label: tx('filter', 'after') }, { op: 'is', label: tx('filter', 'on') }, ...base];
  if (type === 'files') return [{ op: 'filled', label: tx('filter', 'has files') }, { op: 'empty', label: tx('filter', 'has no files') }];
  return [{ op: 'has', label: tx('filter', 'contains') }, { op: 'is', label: tx('filter', 'is exactly') }, ...base];
}

/** The sorts a view uses (older views had one). */
export const sortsOf = (view: TableViewDef) => view.sorts ?? (view.sort ? [view.sort] : []);

/** A condition that can be tested: its field is there and it has a value (or needs none). */
const complete = (byId: Map<string, TableField>, flt: TableFilter) => byId.has(flt.fieldId) && (flt.op === 'empty' || flt.op === 'filled' || (flt.value ?? '') !== '');

/** How many conditions a view's filter has that actually do something (groups count each of theirs). */
export function filterCount(t: DataTable, view: Pick<TableViewDef, 'filters' | 'filterGroups'>) {
  const byId = new Map(t.fields.map((f) => [f.id, f]));
  return (view.filters ?? []).filter((x) => complete(byId, x)).length + (view.filterGroups ?? []).reduce((n, g) => n + g.filters.filter((x) => complete(byId, x)).length, 0);
}

/** "@today" is the day where it's read, "@me" whoever is looking. */
function resolveFilter(flt: TableFilter, ctx: TCtx): TableFilter {
  if (flt.value === '@today') return { ...flt, value: localDay() };
  if (flt.value === '@me') return { ...flt, value: ctx.me ?? '' };
  return flt;
}

/** One condition on one row. */
export function rowPasses(t: DataTable, flt: TableFilter, r: TableRow, ctx: TCtx) {
  const f = t.fields.find((x) => x.id === flt.fieldId);
  return !f || passes(resolveFilter(flt, ctx), f, valueOf(t, f, r, ctx), ctx);
}

/**
 * A view's filter as one test: its conditions and its groups (each with its own all/any), joined by the view's
 * all/any. Null when nothing filters. `skipField` leaves out top-level conditions on one field (for counts).
 */
export function filterTest(t: DataTable, view: Pick<TableViewDef, 'filters' | 'filterMode' | 'filterGroups'>, ctx: TCtx, skipField?: string): ((r: TableRow) => boolean) | null {
  const byId = new Map(t.fields.map((f) => [f.id, f]));
  const one = (flt: TableFilter) => (r: TableRow) => passes(resolveFilter(flt, ctx), byId.get(flt.fieldId)!, valueOf(t, byId.get(flt.fieldId)!, r, ctx), ctx);
  const items: ((r: TableRow) => boolean)[] = (view.filters ?? []).filter((flt) => complete(byId, flt) && flt.fieldId !== skipField).map(one);
  for (const g of view.filterGroups ?? []) {
    const tests = g.filters.filter((flt) => complete(byId, flt)).map(one);
    if (tests.length) items.push(g.mode === 'or' ? (r) => tests.some((x) => x(r)) : (r) => tests.every((x) => x(r)));
  }
  if (!items.length) return null;
  return view.filterMode === 'or' ? (r) => items.some((x) => x(r)) : (r) => items.every((x) => x(r));
}

/**
 * The single choice that reads as a row's status: the view's grouping choice, else the one a board of this table makes
 * columns from, else one called Status or Stage, else the first single choice. Cards show it as a pill.
 */
export function statusField(t: DataTable, view?: Pick<TableViewDef, 'groupBy'>) {
  const selects = t.fields.filter((f) => f.type === 'select');
  const board = t.views.find((v) => v.kind === 'board' && selects.some((f) => f.id === v.groupBy))?.groupBy;
  return selects.find((f) => f.id === view?.groupBy) ?? selects.find((f) => f.id === board) ?? selects.find((f) => /^(status|stage|state|tahap)$/i.test(f.name.trim())) ?? selects[0];
}

/** A view with this person's own filters and sorts on top (what they see until they save it for everyone). */
export function withTweak(view: TableViewDef, tw: TableViewTweak | null | undefined): TableViewDef {
  if (!tw) return view;
  const out = { ...view };
  if (tw.filters) out.filters = tw.filters;
  if (tw.filterMode) out.filterMode = tw.filterMode;
  if (tw.filterGroups) out.filterGroups = tw.filterGroups;
  if (tw.sorts) (out.sorts = tw.sorts), (out.sort = undefined);
  if (tw.collapsed) out.collapsed = tw.collapsed;
  return out;
}

/** Whether this person's filters or sorts differ from the view everyone sees. */
export function tweakDiffers(view: TableViewDef, tw: TableViewTweak | null | undefined) {
  if (!tw) return false;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  // Only conditions that do something count: one still being set up (no value yet) changes nothing.
  const norm = (x: TableFilter[] | undefined) => (x ?? []).filter((f) => f.op === 'empty' || f.op === 'filled' || (f.value ?? '') !== '').map((f) => ({ fieldId: f.fieldId, op: f.op, value: f.value ?? '' }));
  const groups = (x: TableFilterGroup[] | undefined) => (x ?? []).map((g) => ({ mode: g.mode, f: norm(g.filters) })).filter((g) => g.f.length);
  const mode = (m: string | undefined, fs: TableFilter[] | undefined, gs: TableFilterGroup[] | undefined) => (norm(fs).length + groups(gs).length > 1 ? (m ?? 'and') : 'and');
  return (
    (!!tw.filters && !same(norm(tw.filters), norm(view.filters))) ||
    (!!tw.filterMode && mode(tw.filterMode, tw.filters ?? view.filters, tw.filterGroups ?? view.filterGroups) !== mode(view.filterMode, view.filters, view.filterGroups)) ||
    (!!tw.filterGroups && !same(groups(tw.filterGroups), groups(view.filterGroups))) ||
    (!!tw.sorts && !same(tw.sorts, sortsOf(view)))
  );
}

/** The tint a view's colour rules give a row: one for the whole row, and one per field for cells. */
export function rowColors(t: DataTable, view: TableViewDef, r: TableRow, ctx: TCtx): { row?: string; cells: Record<string, string> } {
  const out: { row?: string; cells: Record<string, string> } = { cells: {} };
  const byId = new Map(t.fields.map((f) => [f.id, f]));
  for (const rule of view.colors ?? []) {
    if (!complete(byId, rule.when) || !rowPasses(t, rule.when, r, ctx)) continue;
    if (rule.target === 'row') out.row ??= rule.color;
    else out.cells[rule.when.fieldId] ??= rule.color;
  }
  return out;
}

/** The group or quick filter for rows with nothing in a field: "No status", "No owner". */
export const noValue = (f: TableField) => t('No {field}', { field: f.name.toLowerCase() });

/**
 * The quick values a filter sheet starts with, with how many rows each would show: the people in a person field
 * (Me first), the choices of a single-choice field, and Overdue / Today / No date for a date field.
 * Counts are among the rows the other conditions already let through.
 */
export function quickFilters(tb: DataTable, view: TableViewDef, rows: TableRow[], ctx: TCtx): { field: TableField; items: { label: string; filter: TableFilter; count: number; color?: string; on: boolean }[] }[] {
  const fields = [
    statusField(tb, view),
    tb.fields.find((f) => f.type === 'person'),
    tb.fields.find((f) => f.type === 'date'),
  ].filter(Boolean) as TableField[];
  const current = view.filters ?? [];
  const isOn = (flt: TableFilter) => current.some((x) => x.fieldId === flt.fieldId && x.op === flt.op && (x.value ?? '') === (flt.value ?? ''));
  return fields.map((f) => {
    const test = filterTest(tb, view, ctx, f.id);
    const pool = test ? rows.filter(test) : rows;
    const count = (flt: TableFilter) => pool.filter((r) => rowPasses(tb, flt, r, ctx)).length;
    const item = (label: string, filter: TableFilter, color?: string) => ({ label, filter, count: count(filter), color, on: isOn(filter) });
    const none = () => item(noValue(f), { fieldId: f.id, op: 'empty' });
    let items: ReturnType<typeof item>[] = [];
    if (f.type === 'select') items = [...(f.options ?? []).map((o) => item(o.label, { fieldId: f.id, op: 'is', value: o.id }, o.color)), none()];
    else if (f.type === 'person') {
      const ids = [...new Set(pool.map((r) => r.values[f.id]).filter((x): x is string => typeof x === 'string' && !!x))];
      const others = ids.filter((id) => id !== ctx.me).map((id) => item(ctx.users.find((u) => u.id === id)?.name ?? t('Someone'), { fieldId: f.id, op: 'is', value: id }));
      items = [...(ctx.me ? [item(tx('person', 'Me'), { fieldId: f.id, op: 'is', value: '@me' })] : []), ...others.sort((a, b) => b.count - a.count), none()];
    } else if (f.type === 'date') items = [item(tx('date', 'Overdue'), { fieldId: f.id, op: 'lt', value: '@today' }), item(t('Today'), { fieldId: f.id, op: 'is', value: '@today' }), item(tx('date', 'Later'), { fieldId: f.id, op: 'gt', value: '@today' }), none()];
    return { field: f, items: items.filter((x) => x.count > 0 || x.on) };
  }).filter((s) => s.items.length > 0);
}

/* ---------- row templates ---------- */

/** A template's values for a new row: "@today" and "@me" filled in, only fields the table still has (and can be typed). */
export function templateValues(t: DataTable, tpl: RowTemplate | undefined, me: string, today = localDay()): Record<string, CellValue> {
  if (!tpl) return {};
  const out: Record<string, CellValue> = {};
  for (const [k, v] of Object.entries(tpl.values ?? {})) {
    const f = t.fields.find((x) => x.id === k);
    if (!f || isComputed(f) || f.type === 'button') continue;
    out[k] = v === '@today' ? today : v === '@me' ? me : v;
  }
  return out;
}

/** A day of the month as English says it (5th, 22nd); Indonesian says "tanggal 5", so just the number. */
const ordinal = (n: number) => (getLang() !== 'en' ? String(n) : `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`);

/** "Every weekday at 09:00", "Every week on Monday at 09:00", "Every month on the 5th at 09:00". */
export function repeatWords(r: NonNullable<RowTemplate['repeat']>) {
  const time = fmtTime(new Date(2026, 0, 1, r.hour, 0));
  const days = [...(r.days ?? [])].sort();
  if (r.every === 'day') return days.length && days.length < 7 ? (days.join() === '1,2,3,4,5' ? t('Every weekday at {time}', { time }) : t('Every {days} at {time}', { days: days.map((d) => weekdayName(d, 'short')).join(', '), time })) : t('Every day at {time}', { time });
  if (r.every === 'week') return t('Every week on {days} at {time}', { days: fmtList((days.length ? days : [1]).map((d) => weekdayName(d))), time });
  const from = new Date(`${r.from}T12:00`);
  if (r.every === 'month') return t('Every month on the {day} at {time}', { day: ordinal(from.getDate()), time });
  return t('Every year on {date} at {time}', { date: fmtDate(from, { day: 'numeric', month: 'long' }), time });
}

/** Whether a repeating template is due now: the right day, at or after its hour, not run today, not before it starts. */
export function templateDue(r: NonNullable<RowTemplate['repeat']>, now: { day: string; hour: number; weekday: number }, lastRun?: string) {
  if (lastRun === now.day || now.day < r.from || now.hour < r.hour) return false;
  const days = r.days?.length ? r.days : r.every === 'week' ? [1] : [];
  if (r.every === 'day') return !days.length || days.includes(now.weekday);
  if (r.every === 'week') return days.includes(now.weekday);
  const [y, m, d] = now.day.split('-').map(Number);
  const want = Number(r.from.slice(8, 10));
  const last = new Date(y, m, 0).getDate(); // the 31st runs on the last day of shorter months
  if (r.every === 'month') return d === Math.min(want, last);
  return m === Number(r.from.slice(5, 7)) && d === Math.min(want, last);
}

/** The rows a view shows: its filters (all or any, with groups), the search, then its sorts (or the manual order). */
export function visibleRows(t: DataTable, view: TableViewDef, rows: TableRow[], q: string, ctx: TCtx) {
  const byId = new Map(t.fields.map((f) => [f.id, f]));
  const test = filterTest(t, view, ctx);
  let out = test ? rows.filter(test) : rows;
  const needle = q.trim().toLowerCase();
  if (needle) out = out.filter((r) => t.fields.some((f) => cellText(f, valueOf(t, f, r, ctx), ctx).toLowerCase().includes(needle)));
  const sorts = sortsOf(view)
    .map((x) => ({ f: byId.get(x.fieldId), dir: x.dir === 'desc' ? -1 : 1 }))
    .filter((x) => x.f) as { f: TableField; dir: number }[];
  if (sorts.length) {
    const keys = new Map(out.map((r) => [r.id, sorts.map((x) => sortKey(x.f, valueOf(t, x.f, r, ctx), ctx))]));
    out = [...out].sort((a, b) => {
      const ka = keys.get(a.id)!, kb = keys.get(b.id)!;
      for (let i = 0; i < sorts.length; i++) {
        if (ka[i] === '' && kb[i] !== '') return 1; // empty cells always last
        if (kb[i] === '' && ka[i] !== '') return -1;
        const c = ka[i] < kb[i] ? -1 : ka[i] > kb[i] ? 1 : 0;
        if (c) return c * sorts[i].dir;
      }
      return a.order - b.order;
    });
  } else out = [...out].sort((a, b) => a.order - b.order);
  return out;
}

/** Fields in a view's order (its own order first, then any new ones), without the hidden ones unless asked. */
export function viewFields(t: DataTable, view: TableViewDef, withHidden = false) {
  // The view's own order. The name field goes first unless someone moved it; it's never hidden.
  const pos = new Map((view.order ?? []).map((id, i) => [id, i]));
  const name = t.fields[0];
  const rank = (f: TableField) => pos.get(f.id) ?? (f === name ? -1 : 1e6 + t.fields.indexOf(f));
  const all = [...t.fields].sort((a, b) => rank(a) - rank(b));
  return withHidden ? all : all.filter((f) => f === name || !view.hidden?.includes(f.id));
}

/** Moves one field to a new place in a view's order (index among all fields, hidden ones too). */
export function orderWith(t: DataTable, view: TableViewDef, id: string, at: number) {
  const order = viewFields(t, view, true).map((f) => f.id).filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(at, order.length)), 0, id);
  return order;
}

export interface RowGroup {
  key: string;
  label: string;
  color?: string;
  value: CellValue; // what a new row in this group gets
  rows: TableRow[];
}

/** Rows grouped by a field: choices in their own order, people by name, dates by day, empty last. */
export function groupRows(tb: DataTable, f: TableField, rows: TableRow[], ctx: TCtx): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  const add = (key: string, label: string, value: CellValue, r: TableRow, color?: string) => {
    const g = groups.get(key) ?? { key, label, value, color, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  };
  for (const r of rows) {
    const v = valueOf(tb, f, r, ctx);
    if (isEmpty(v) && f.type !== 'checkbox') {
      add('', noValue(f), null, r);
      continue;
    }
    if (f.type === 'select') {
      const o = f.options?.find((x) => x.id === v);
      add(String(v), o?.label ?? t('Unknown'), v, r, o?.color);
    } else if (f.type === 'multi') {
      const o = f.options?.find((x) => x.id === (v as string[])[0]);
      add(String((v as string[])[0]), o?.label ?? t('Unknown'), [String((v as string[])[0])], r, o?.color);
    } else if (f.type === 'checkbox') add(v ? 'yes' : 'no', v ? t('{field}: yes', { field: f.name }) : t('{field}: no', { field: f.name }), !!v, r);
    else if (f.type === 'created' || f.type === 'edited') add(String(v).slice(0, 10), cellText({ ...f, type: 'date' }, String(v).slice(0, 10), ctx), null, r);
    else add(String(cellText(f, v, ctx)), cellText(f, v, ctx), isComputed(f) ? null : v, r);
  }
  const order = (g: RowGroup) => (g.key === '' ? 1e9 : f.type === 'select' ? (f.options?.findIndex((o) => o.id === g.key) ?? 0) : 0);
  return [...groups.values()].sort((a, b) => order(a) - order(b) || (a.key === '' ? 1 : b.key === '' ? -1 : a.label.localeCompare(b.label)));
}

/** The totals a column can show under it. `label` is in the reader's language (read it while rendering). */
export const CALCS: { kind: CalcKind; label: string; numeric?: boolean }[] = [
  { kind: 'count', get label() { return tx('calc', 'Count'); } },
  { kind: 'filled', get label() { return tx('calc', 'Filled'); } },
  { kind: 'empty', get label() { return tx('calc', 'Empty'); } },
  { kind: 'percent', get label() { return t('Percent filled'); } },
  { kind: 'unique', get label() { return t('Different values'); } },
  { kind: 'sum', get label() { return tx('calc', 'Sum'); }, numeric: true },
  { kind: 'avg', get label() { return t('Average'); }, numeric: true },
  { kind: 'min', get label() { return t('Smallest'); }, numeric: true },
  { kind: 'max', get label() { return t('Largest'); }, numeric: true },
];
export const isNumeric = (f: TableField) => ['number', 'money', 'rating', 'rollup', 'formula'].includes(f.type);

/** A total under a column: count, filled, sum, average… formatted like the column. */
export function calc(kind: CalcKind, t: DataTable, f: TableField, rows: TableRow[], ctx: TCtx): string {
  const vals = rows.map((r) => valueOf(t, f, r, ctx));
  const filled = vals.filter((v) => !isEmpty(v));
  const fmt = (n: number) => (f.type === 'money' ? money(n, f.currency) : num(n));
  const nums = filled.map(Number).filter(Number.isFinite);
  switch (kind) {
    case 'count':
      return num(rows.length);
    case 'filled':
      return num(filled.length);
    case 'empty':
      return num(rows.length - filled.length);
    case 'percent':
      return fmtNumber(rows.length ? Math.round((filled.length / rows.length) * 100) / 100 : 0, { style: 'percent' });
    case 'unique':
      return num(new Set(filled.map((v) => JSON.stringify(v))).size);
    case 'sum':
      return fmt(nums.reduce((a, b) => a + b, 0));
    case 'avg':
      return nums.length ? fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : '';
    case 'min':
      return nums.length ? fmt(Math.min(...nums)) : '';
    case 'max':
      return nums.length ? fmt(Math.max(...nums)) : '';
  }
}

/* ---------- formulas ---------- */

/**
 * A small, safe formula language (no code runs): {Field name}, numbers, "text", + - * / , & joins text,
 * comparisons (> < >= <= = !=), and/or/not, and functions: if, round, floor, ceil, abs, min, max, sum, concat,
 * upper, lower, len, empty, today, days, year, month, contains.
 */
export function evaluate(src: string, field: (name: string) => unknown, fieldNames: string[] = []): unknown {
  type Tok = { t: 'num' | 'str' | 'ref' | 'id' | 'op' | 'punc'; v: string };
  const toks: Tok[] = [];
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (/\s/.test(c)) i++;
    else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(t('A text is missing its closing quote'));
      toks.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new Error(t('A field name is missing its }'));
      toks.push({ t: 'ref', v: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      toks.push({ t: 'id', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ('<>!='.includes(c) && src[i + 1] === '=') {
      toks.push({ t: 'op', v: c + '=' });
      i += 2;
    } else if ('+-*/&<>='.includes(c)) {
      toks.push({ t: 'op', v: c });
      i++;
    } else if ('(),'.includes(c)) {
      toks.push({ t: 'punc', v: c });
      i++;
    } else throw new Error(t('“{char}” isn’t understood', { char: c }));
  }
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const tk = toks[p++];
    if (!tk || (v && tk.v !== v)) throw new Error(v ? t('Expected {what}', { what: v }) : t('The formula ends too soon'));
    return tk;
  };
  const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : Number(String(x ?? '').replace(/[^\d.-]/g, '')) || 0);
  const str = (x: unknown) => (x == null ? '' : typeof x === 'number' ? (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100)) : String(x));
  const truthy = (x: unknown) => !!x && x !== '0' && x !== 'false';
  const fns: Record<string, (a: unknown[]) => unknown> = {
    if: (a) => (truthy(a[0]) ? a[1] : a[2] ?? ''),
    round: (a) => {
      const k = 10 ** num(a[1] ?? 0);
      return Math.round(num(a[0]) * k) / k;
    },
    floor: (a) => Math.floor(num(a[0])),
    ceil: (a) => Math.ceil(num(a[0])),
    abs: (a) => Math.abs(num(a[0])),
    min: (a) => Math.min(...a.map(num)),
    max: (a) => Math.max(...a.map(num)),
    sum: (a) => a.map(num).reduce((x, y) => x + y, 0),
    concat: (a) => a.map(str).join(''),
    upper: (a) => str(a[0]).toUpperCase(),
    lower: (a) => str(a[0]).toLowerCase(),
    len: (a) => str(a[0]).length,
    empty: (a) => a[0] == null || a[0] === '' || a[0] === 0 || a[0] === false,
    contains: (a) => str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase()),
    today: () => localDay(),
    days: (a) => Math.round((Date.parse(str(a[1]).slice(0, 10)) - Date.parse(str(a[0]).slice(0, 10))) / 86_400_000),
    year: (a) => Number(str(a[0]).slice(0, 4)) || '',
    month: (a) => Number(str(a[0]).slice(5, 7)) || '',
    not: (a) => !truthy(a[0]),
  };
  const primary = (): unknown => {
    const tk = eat();
    if (tk.t === 'num') return Number(tk.v);
    if (tk.t === 'str') return tk.v;
    if (tk.t === 'ref') return field(tk.v);
    if (tk.t === 'op' && tk.v === '-') return -num(primary());
    if (tk.t === 'punc' && tk.v === '(') {
      const v = or();
      eat(')');
      return v;
    }
    if (tk.t === 'id') {
      if (tk.v === 'true') return true;
      if (tk.v === 'false') return false;
      const fn = fns[tk.v];
      if (peek()?.v !== '(') {
        // A plain word: a one-word field name works without braces; anything else needs them.
        if (fieldNames.some((n) => n.toLowerCase() === tk.v.toLowerCase())) return field(tk.v);
        throw new Error(t('Put field names in curly braces, like {example}', { example: `{${tk.v}}` }));
      }
      if (!fn) throw new Error(t('There’s no {name}()', { name: tk.v }));
      eat('(');
      const args: unknown[] = [];
      if (peek()?.v !== ')') {
        args.push(or());
        while (peek()?.v === ',') (eat(','), args.push(or()));
      }
      eat(')');
      return fn(args);
    }
    throw new Error(t('“{token}” is in the wrong place', { token: tk.v }));
  };
  const mul = (): unknown => {
    let v = primary();
    while (peek()?.v === '*' || peek()?.v === '/') {
      const op = eat().v;
      const r = primary();
      v = op === '*' ? num(v) * num(r) : num(r) === 0 ? null : num(v) / num(r);
    }
    return v;
  };
  const add = (): unknown => {
    let v = mul();
    while (peek()?.v === '+' || peek()?.v === '-' || peek()?.v === '&') {
      const op = eat().v;
      const r = mul();
      v = op === '&' ? str(v) + str(r) : op === '+' ? (typeof v === 'string' || typeof r === 'string' ? str(v) + str(r) : num(v) + num(r)) : num(v) - num(r);
    }
    return v;
  };
  const cmp = (): unknown => {
    let v = add();
    while (peek()?.t === 'op' && ['>', '<', '>=', '<=', '=', '!='].includes(peek()!.v)) {
      const op = eat().v;
      const r = add();
      const both = typeof v === 'number' || typeof r === 'number';
      const a = both ? num(v) : str(v), b = both ? num(r) : str(r);
      v = op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : op === '=' ? a === b : a !== b;
    }
    return v;
  };
  const and = (): unknown => {
    let v = cmp();
    while (peek()?.v === 'and') (eat(), (v = truthy(v) && truthy(cmp())));
    return v;
  };
  const or = (): unknown => {
    let v = and();
    while (peek()?.v === 'or') (eat(), (v = truthy(v) || truthy(and())));
    return v;
  };
  if (!toks.length) return null;
  const out = or();
  if (p < toks.length) throw new Error(t('“{token}” is in the wrong place', { token: toks[p].v }));
  return out;
}

/** Checks a formula against a table: an error in plain words, or null if it's fine. */
export function formulaError(src: string, tb: DataTable): string | null {
  try {
    evaluate(src, (name) => {
      if (!tb.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new Error(t('There’s no field called “{name}”', { name }));
      return 1;
    }, tb.fields.map((f) => f.name));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** A value converted when a column changes type, so nothing silently turns to garbage. */
export function convertValue(from: TableField, to: TableField, v: CellValue | undefined, ctx: TCtx): CellValue {
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
    case 'rating': {
      const n = Math.round(Number(String(Array.isArray(v) ? '' : v).replace(/[^\d.]/g, '')));
      return Number.isFinite(n) && n > 0 ? Math.min(n, to.max ?? 5) : null;
    }
    case 'link':
    case 'button':
    case 'files':
    case 'formula':
    case 'rollup':
    case 'created':
    case 'edited':
    case 'creator':
      return null;
    default:
      return text;
  }
}

/** When a column becomes a choice field, its existing words become the choices. */
export function optionsFromValues(from: TableField, rows: TableRow[], ctx: TCtx) {
  const words = [...new Set(rows.flatMap((r) => cellText(from, r.values[from.id], ctx).split(', ')).map((w) => w.trim()).filter(Boolean))].slice(0, 40);
  return words.map((w, i) => option(w, OPTION_COLORS[(i + 1) % OPTION_COLORS.length]));
}

/* ---------- templates ---------- */

export type TemplateId = 'blank' | 'leads' | 'pipeline' | 'tracker';
/** The starter tables. `name` and `hint` are in the reader's language (read them while rendering). */
export const TEMPLATES: { id: TemplateId; name: string; hint: string }[] = [
  { id: 'leads', get name() { return t('Leads'); }, get hint() { return t('Name, contact, source, status, value, owner, follow-up'); } },
  { id: 'pipeline', get name() { return t('Content pipeline'); }, get hint() { return t('Idea to posted, with platform, owner and due date'); } },
  { id: 'tracker', get name() { return t('Simple tracker'); }, get hint() { return t('Item, status, owner, due date'); } },
  { id: 'blank', get name() { return tx('template', 'Blank'); }, get hint() { return t('Start with one column and build your own'); } },
];

const grid = (hidden: string[] = []): TableViewDef => ({ id: uid(), name: tx('view', 'Grid'), kind: 'grid', hidden });
const board = (groupBy: string, name = tx('view', 'Board')): TableViewDef => ({ id: uid(), name, kind: 'board', groupBy });

/**
 * Columns and views for a new table, named in the maker's language (from then on they're the table's own words, as
 * if typed). Every column can be changed afterwards.
 */
export function templateFields(id: TemplateId): { fields: TableField[]; views: TableViewDef[] } {
  const f = (name: string, type: FieldType, extra: Partial<TableField> = {}): TableField => ({ id: uid(), name, type, ...extra });
  const owner = () => f(tx('field', 'Owner'), 'person');
  if (id === 'leads') {
    const status = f(t('Status'), 'select', { options: [option(tx('lead', 'New'), '#3b82f6'), option(t('Contacted'), '#f59e0b'), option(t('Qualified'), '#8b5cf6'), option(t('Won'), '#10b981'), option(t('Lost'), '#64748b')] });
    const fields = [
      f(t('Name'), 'text'),
      f(t('Email'), 'email'),
      f(tx('field', 'Phone'), 'phone'),
      f(t('Source'), 'select', { options: [option('Facebook Ads', '#3b82f6'), option('Instagram', '#ec4899'), option('Website', '#10b981'), option('Referral', '#f59e0b')] }),
      status,
      f(tx('field', 'Value'), 'money', { currency: 'IDR' }),
      owner(),
      f(t('Follow-up'), 'date'),
      f(t('Notes'), 'longtext'),
    ];
    return { fields, views: [grid(), board(status.id, t('Pipeline'))] };
  }
  if (id === 'pipeline') {
    const stage = f(t('Stage'), 'select', { options: [option(t('Idea'), '#64748b'), option(t('Script'), '#0ea5e9'), option(t('Shooting'), '#f59e0b'), option(t('Editing'), '#f97316'), option(t('Review'), '#8b5cf6'), option(t('Posted'), '#10b981')] });
    const fields = [f(tx('field', 'Title'), 'text'), stage, f(t('Platform'), 'multi', { options: [option('Instagram', '#ec4899'), option('TikTok', '#0f172a'), option('YouTube', '#ef4444')] }), owner(), f(tx('field', 'Due'), 'date'), f(t('Brief'), 'longtext')];
    return { fields, views: [board(stage.id), grid()] };
  }
  if (id === 'tracker') {
    const status = f(t('Status'), 'select', { options: [option(t('To do'), '#64748b'), option(t('Doing'), '#3b82f6'), option(t('Done'), '#10b981')] });
    return { fields: [f(t('Item'), 'text'), status, owner(), f(tx('field', 'Due'), 'date')], views: [grid(), board(status.id)] };
  }
  return { fields: [f(t('Name'), 'text'), f(t('Notes'), 'longtext')], views: [grid()] };
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
    case 'rating': {
      const n = Math.round(Number(s.replace(/[^\d.]/g, '')));
      return { v: Number.isFinite(n) && n > 0 ? Math.min(n, f.max ?? 5) : null };
    }
    case 'link':
    case 'button':
    case 'files':
    case 'formula':
    case 'rollup':
    case 'created':
    case 'edited':
    case 'creator':
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
