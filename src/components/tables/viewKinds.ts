import { CalendarDays, ChartGantt, Columns3, GalleryHorizontalEnd, LayoutGrid, List, type LucideIcon } from 'lucide-react';
import type { DataTable, TableViewDef } from '../../types';
import { uid } from '../../utils';
import { t, tx } from '../../i18n';

/** The ways a table can be shown, in the order the "Add a view" list shows them. `name` and `hint` are in the reader's language. */
export const VIEW_KINDS: { kind: TableViewDef['kind']; name: string; icon: LucideIcon; hint: string }[] = [
  { kind: 'grid', get name() { return tx('view', 'Table'); }, icon: LayoutGrid, get hint() { return t('Rows and columns, like a spreadsheet'); } },
  { kind: 'board', get name() { return tx('view', 'Board'); }, icon: Columns3, get hint() { return t('Cards in columns by a choice, like Status'); } },
  { kind: 'list', get name() { return tx('view', 'List'); }, icon: List, get hint() { return t('A compact list, a few fields per row'); } },
  { kind: 'gallery', get name() { return tx('view', 'Gallery'); }, icon: GalleryHorizontalEnd, get hint() { return t('Cards with a picture'); } },
  { kind: 'calendar', get name() { return tx('view', 'Calendar'); }, icon: CalendarDays, get hint() { return t('Rows on their dates'); } },
  { kind: 'timeline', get name() { return tx('view', 'Timeline'); }, icon: ChartGantt, get hint() { return t('Bars from a start date to an end date'); } },
];
/** A view still called by a kind's own name, in English or the reader's language ("Grid", "Table", "Papan"). */
export function isDefaultViewName(name: string) {
  const n = name.trim().toLowerCase();
  const english = ['grid', 'grid view', 'table', 'table view', 'board', 'list', 'gallery', 'calendar', 'timeline'];
  return english.includes(n) || VIEW_KINDS.some((k) => k.name.toLowerCase() === n);
}
/** The name to show: a view called by its kind's name shows the kind it's shown as here (a grid shown as rows is a List). */
export const viewName = (v: Pick<TableViewDef, 'name' | 'kind'>, shownAs: TableViewDef['kind'] = v.kind) => (isDefaultViewName(v.name) ? (VIEW_KINDS.find((x) => x.kind === shownAs)?.name ?? v.name) : v.name);
export const viewIcon = (k: TableViewDef['kind']) => VIEW_KINDS.find((x) => x.kind === k)?.icon ?? LayoutGrid;

/** What a view of a kind needs to work straight away: a choice field for a board, dates for a calendar or timeline. */
export function kindDefaults(t: DataTable, kind: TableViewDef['kind']): Partial<TableViewDef> {
  const dates = t.fields.filter((f) => f.type === 'date');
  return {
    kind,
    groupBy: kind === 'board' ? t.fields.find((f) => f.type === 'select')?.id : undefined,
    dateField: kind === 'calendar' || kind === 'timeline' ? (dates[0] ?? t.fields.find((f) => f.type === 'created'))?.id : undefined,
    endField: kind === 'timeline' ? dates[1]?.id : undefined,
    cover: kind === 'gallery' ? t.fields.find((f) => f.type === 'files')?.id : undefined,
  };
}

export function newView(t: DataTable, kind: TableViewDef['kind']): TableViewDef {
  return { id: uid(), name: VIEW_KINDS.find((x) => x.kind === kind)!.name, ...kindDefaults(t, kind), kind };
}
