import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, ArrowUpDown, Check, CheckSquare, ChevronDown, Copy, CopyPlus, Download, EyeOff, FileUp, Filter, Group, LayoutTemplate, Link2, Maximize2, Menu, MoreHorizontal, Palette, PanelRight, Plus, Search, SlidersHorizontal, Table2, Trash2, Undo2, Users, X, Zap } from 'lucide-react';
import type { CellValue, Channel, Client, DataTable, RowTemplate, TableField, TableRow, TableViewDef, TableViewTweak, User } from '../../types';
import { term, brand as product } from '../../terms';
import { uid } from '../../utils';
import { usePersisted } from '../../settings';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { TabPane } from '../ui/Smooth';
import { PickSelect } from '../ui/PickSelect';
import { ProjectPicker } from '../ProjectPicker';
import { usePhone } from '../../mobile/media';
import { useCreateAction } from '../../mobile/chrome';
import { TopBar, TopBarBack, TopBarButton } from '../../mobile/TopBar';
import type { SheetAction } from '../ui/ActionSheet';
import { newOption, type CellCtx } from './Cell';
import { GridView } from './GridView';
import { BoardTools, BoardView, newChoiceField } from './BoardView';
import { CalendarView, GalleryView, ListView } from './Views';
import { TimelineView } from './TimelineView';
import { CardList, statusFieldOf } from './CardList';
import { FieldLine, RecordDrawer } from './RecordDrawer';
import { AutomationsPanel } from './Automations';
import { ButtonDialog, ButtonSetupCtx } from './ButtonDialog';
import { ImportDialog, type ImportPlan } from './ImportDialog';
import { TemplatesDialog } from './Templates';
import { PageLayoutDialog } from './PageLayout';
import { ViewTabs } from './ViewTabs';
import { ColorRulesEditor, FieldsEditor, FilterPanel, GroupEditor, SortEditor } from './ViewTools';
import { BulkBar, BulkEditSheet, FilterLine, FilterSheet, QuickCreate, SettingsSheet, ViewsSheet, openWithFocus, type SettingsActions } from './PhoneBits';
import { EditSheet } from './EditSheet';
import { EmptyState } from '../ui/EmptyState';
import { VIEW_KINDS, kindDefaults, newView, viewIcon, viewName, isDefaultViewName } from './viewKinds';
import { NARROW_PANE, clearTableLink, readTableLink, tableLink, usePaneWidth, useTweaks } from './hooks';
import { download, rowsToCsv } from './csv';
import { TABLE_COLORS, cellText, convertValue, filterCount, isComputed, isEmpty, noteOf, opsFor, optionsFromValues, parseIncoming, rowName, sortsOf, templateValues, viewFields, visibleRows } from './fields';
import { t, tn, tx, type Msg } from '../../i18n';
import { fmtWeekday } from '../../i18n/format';

type Setter<T> = (fn: (x: T) => T) => void;

interface ScreenProps {
  table: DataTable;
  tables: DataTable[];
  rows: TableRow[]; // every row the person can see (links reach into other tables)
  users: User[];
  clients: Client[];
  me: string;
  setTables: Setter<DataTable[]>;
  setRows: Setter<TableRow[]>;
  onOpenTable: (id: string, rowId?: string) => void;
  openRow: string | null;
  setOpenRow: (id: string | null) => void;
  onDeleted: () => void;
  onMenu: () => void;
  toast: (tb: { text: string; action?: { label: string; run: () => void } }) => void;
  channels: Channel[];
  isAdmin: boolean;
  canEditTables?: boolean; // Members may change columns, views and automations (company setting)
  canDeleteThings?: boolean; // Members may delete tables they didn't make (company setting)
  serverOn: boolean;
  inDemo?: boolean; // the demo company: buttons, webhooks and imports stay inside it
  onCompose: (m: { to: string; subject: string; body: string }) => void;
  /** A project's guest looking at a shared table: what they may do. */
  guest?: { canEdit: (fieldId: string) => boolean; add: boolean; download: boolean };
}

/** View settings that are each person's own (until saved for everyone): what's filtered, how it's sorted, what's folded. */
const PERSONAL = new Set(['filters', 'filterMode', 'filterGroups', 'sorts', 'sort', 'collapsed']);

export function TableScreen(p: ScreenProps) {
  const tb = p.table;
  const g = p.guest;
  const paneRef = useRef<HTMLElement>(null);
  const paneW = usePaneWidth(paneRef);
  const phone = usePhone();
  const narrow = paneW < NARROW_PANE; // the phone layout: cards, one toolbar row, sheets (also in a narrow pane)
  const [viewId, setViewId] = usePersisted<string>(`s2g-table-view:${tb.id}`, tb.views[0]?.id ?? '');
  const base = tb.views.find((v) => v.id === viewId) ?? tb.views[0];
  const tweaks = useTweaks(tb.id);
  const view = base ? tweaks.effective(base) : undefined;
  const differs = base ? tweaks.differs(base) : false;
  const [cardsOn, setCardsOn] = usePersisted<Record<string, boolean>>('s2g-tb-cards', {}); // per view, on this device
  const cards = narrow && !!view && (view.kind === 'grid' || view.kind === 'list') && (cardsOn[view.id] ?? true);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false); // narrow screens: picking several rows
  const [pop, setPop] = useState<null | 'filter' | 'sort' | 'fields' | 'group' | 'colors' | 'view' | 'more' | 'addView' | 'newRow'>(null);
  const [sheet, setSheet] = useState<null | 'views' | 'filter' | 'settings' | 'bulk' | 'tables'>(null);
  const refs = { filter: useRef<HTMLButtonElement>(null), sort: useRef<HTMLButtonElement>(null), fields: useRef<HTMLButtonElement>(null), group: useRef<HTMLButtonElement>(null), colors: useRef<HTMLButtonElement>(null), more: useRef<HTMLButtonElement>(null), newRow: useRef<HTMLButtonElement>(null) };
  const tabAnchor = useRef<HTMLElement | null>(null);
  const addViewAnchor = useRef<HTMLElement | null>(null);
  const [name, setName] = useState(tb.name);
  const [renamingView, setRenamingView] = useState('');
  const [autoOpen, setAutoOpen] = useState(false);
  const [buttonFor, setButtonFor] = useState<string | null>(null);
  const [freshRow, setFreshRow] = useState<string | null>(null); // just added in the grid: shown and ready to type
  const [importing, setImporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [laying, setLaying] = useState(false);
  const [full, setFull] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const [editCell, setEditCell] = useState<{ rowId: string; fieldId: string; title?: string } | null>(null);
  const [quick, setQuick] = useState<{ values: Record<string, CellValue>; title?: string } | null>(null);
  const quickInput = useRef<HTMLInputElement>(null);
  const rowMenuAnchor = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = usePersisted('s2g-tables-tip', true);
  // Columns, views and automations: admins, whoever made the table, and Members when the company allows it.
  const structure = !g && (p.isAdmin || p.canEditTables !== false || tb.createdBy === p.me);
  const canDeleteTable = !g && (p.isAdmin || !!p.canDeleteThings || tb.createdBy === p.me);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<{ row: TableRow; f: TableField } | null>(null);
  useEffect(() => setName(tb.name), [tb.name]);

  // A link to a view or a row (/tables?t=…&v=…&r=…): open what it points at.
  useEffect(() => {
    const l = readTableLink();
    if (!l) return;
    if (l.t !== tb.id) return void p.onOpenTable(l.t, l.r);
    if (l.v && tb.views.some((v) => v.id === l.v)) setViewId(l.v);
    if (l.r) p.setOpenRow(l.r);
    clearTableLink();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => p.rows.filter((r) => r.tableId === tb.id), [p.rows, tb.id]);
  const rowNameOf = (id: string) => {
    const r = p.rows.find((x) => x.id === id);
    const tt = r && p.tables.find((x) => x.id === r.tableId);
    return tt ? rowName(tt, r) : '';
  };
  const textCtx = { users: p.users, rowName: rowNameOf, rows: p.rows, tables: p.tables, me: p.me };
  const shown = useMemo(() => (view ? visibleRows(tb, view, mine, q, textCtx) : mine), [tb, view, mine, q, p.users, p.rows, p.tables, p.me]); // eslint-disable-line react-hooks/exhaustive-deps

  /* undo: what this table and its rows were before each change made here (Cmd/Ctrl+Z) */
  const undo = useRef<{ rows: TableRow[]; table: DataTable; what: string }[]>([]);
  const remember = (what: string) => {
    undo.current.push({ rows: mine, table: tb, what });
    if (undo.current.length > 40) undo.current.shift();
  };
  const undoLast = () => {
    const s = undo.current.pop();
    if (!s) return p.toast({ text: t('Nothing to undo') });
    p.setRows((rs) => [...rs.filter((r) => r.tableId !== tb.id), ...s.rows]);
    p.setTables((ts) => ts.map((x) => (x.id === tb.id ? s.table : x)));
    p.toast({ text: t('Undone: {what}', { what: s.what }) });
  };
  useEffect(() => {
    if (g) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (document.querySelector('.modal-scrim, .pop:not(.is-leaving), .sheet-scrim:not(.is-leaving)')) return;
      // Escape lets go of the rows picked.
      if (e.key === 'Escape' && (selected.size || selecting) && !p.openRow) return void (setSelected(new Set()), setSelecting(false));
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || el.closest('input, textarea, [contenteditable=true]')) return;
      e.preventDefault();
      undoLast();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  /* table changes */
  const patchTable = (patch: Partial<DataTable>) => p.setTables((ts) => ts.map((x) => (x.id === tb.id ? { ...x, ...patch } : x)));
  const patchShared = (patch: Partial<TableViewDef>) => base && structure && patchTable({ views: tb.views.map((v) => (v.id === base.id ? { ...v, ...patch } : v)) });
  /** A change to the view: filters, sorts and folded groups are this person's own; the rest is the view everyone sees. */
  const patchView = (patch: Partial<TableViewDef>) => {
    if (!base) return;
    const own: TableViewTweak = {};
    const shared: Partial<TableViewDef> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'sort') continue; // older views' single sort: sorts replace it
      if (PERSONAL.has(k)) (own as Record<string, unknown>)[k] = v;
      else (shared as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(own).length) tweaks.set(base.id, own);
    if (Object.keys(shared).length) patchShared(shared);
  };
  const saveForEveryone = () => {
    const tw = base && tweaks.of(base.id);
    if (!base || !tw || !structure) return;
    patchTable({
      views: tb.views.map((v) =>
        v.id !== base.id ? v : { ...v, ...(tw.filters ? { filters: tw.filters } : {}), ...(tw.filterMode ? { filterMode: tw.filterMode } : {}), ...(tw.filterGroups ? { filterGroups: tw.filterGroups } : {}), ...(tw.sorts ? { sorts: tw.sorts, sort: undefined } : {}) },
      ),
    });
    tweaks.reset(base.id);
    p.toast({ text: t('“{view}” now shows these filters and sorts for everyone', { view: base.name }) });
  };
  const addOption = (fieldId: string, label: string) => {
    const f = tb.fields.find((x) => x.id === fieldId)!;
    const o = newOption(f, label);
    patchTable({ fields: tb.fields.map((x) => (x.id === fieldId ? { ...x, options: [...(x.options ?? []), o] } : x)) });
    return o.id;
  };
  /** Saves a field; a new one goes at a view position when given (a column added left or right of another). */
  const saveField = (f: TableField, at?: number) => {
    const before = tb.fields.find((x) => x.id === f.id);
    remember(before ? t('change to {name}', { name: before.name }) : t('new column {name}', { name: f.name }));
    if (!before) {
      const views = at === undefined || !base ? tb.views : tb.views.map((v) => {
        if (v.id !== base.id) return v;
        const vis = viewFields(tb, v).map((x) => x.id);
        const rest = viewFields(tb, v, true).map((x) => x.id);
        const anchorId = vis[at];
        const idx = anchorId ? rest.indexOf(anchorId) : rest.length;
        rest.splice(idx < 0 ? rest.length : idx, 0, f.id);
        return { ...v, order: rest };
      });
      // Read the latest table: two new fields in a row (a timeline's Start and End) both land.
      return p.setTables((ts) => ts.map((x) => (x.id === tb.id ? { ...x, fields: [...x.fields, f], views: at === undefined ? x.views : views } : x)));
    }
    let next = f;
    if (before.type !== f.type) {
      // Becoming a choice field: the words already in the column become its choices.
      if ((f.type === 'select' || f.type === 'multi') && !f.options?.length) next = { ...f, options: optionsFromValues(before, mine, textCtx) };
      const target = next;
      p.setRows((rs) => rs.map((r) => (r.tableId === tb.id && !isEmpty(r.values[f.id]) ? { ...r, values: { ...r.values, [f.id]: convertValue(before, target, r.values[f.id], textCtx) } } : r)));
    } else if (f.options) {
      // Choices removed: their cells empty out.
      const keep = new Set(f.options.map((o) => o.id));
      p.setRows((rs) =>
        rs.map((r) => {
          if (r.tableId !== tb.id) return r;
          const v = r.values[f.id];
          if (f.type === 'select' && typeof v === 'string' && !keep.has(v)) return { ...r, values: { ...r.values, [f.id]: null } };
          if (f.type === 'multi' && Array.isArray(v) && (v as string[]).some((x) => !keep.has(x))) return { ...r, values: { ...r.values, [f.id]: (v as string[]).filter((x) => keep.has(x)) } };
          return r;
        }),
      );
    }
    patchTable({ fields: tb.fields.map((x) => (x.id === f.id ? next : x)) });
  };
  const deleteField = (id: string) => {
    const f = tb.fields.find((x) => x.id === id);
    remember(t('delete column {name}', { name: f?.name ?? '' }));
    const strip = <V extends TableViewTweak>(v: V): V => ({ ...v, filters: v.filters?.filter((x) => x.fieldId !== id), filterGroups: v.filterGroups?.map((gr) => ({ ...gr, filters: gr.filters.filter((x) => x.fieldId !== id) })), sorts: v.sorts?.filter((x) => x.fieldId !== id) });
    patchTable({
      fields: tb.fields.filter((x) => x.id !== id),
      views: tb.views.map((v) => ({
        ...strip(v),
        hidden: v.hidden?.filter((x) => x !== id),
        order: v.order?.filter((x) => x !== id),
        wrap: v.wrap?.filter((x) => x !== id),
        colors: v.colors?.filter((x) => x.when.fieldId !== id),
        sort: v.sort?.fieldId === id ? undefined : v.sort,
        groupBy: v.groupBy === id ? undefined : v.groupBy,
        subGroupBy: v.subGroupBy === id ? undefined : v.subGroupBy,
        endField: v.endField === id ? undefined : v.endField,
        calcs: v.calcs ? Object.fromEntries(Object.entries(v.calcs).filter(([k]) => k !== id)) : v.calcs,
      })),
      page: tb.page ? { ...tb.page, pinned: tb.page.pinned?.filter((x) => x !== id), main: tb.page.main === id ? undefined : tb.page.main, sections: tb.page.sections?.map((s) => ({ ...s, fields: s.fields.filter((x) => x !== id) })) } : tb.page,
      templates: tb.templates?.map((x) => ({ ...x, values: Object.fromEntries(Object.entries(x.values).filter(([k]) => k !== id)) })),
    });
    p.setRows((rs) => rs.map((r) => (r.tableId === tb.id && id in r.values ? { ...r, values: Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== id)) } : r)));
    p.toast({ text: t('Deleted the {name} column', { name: f?.name ?? '' }), action: { label: t('Undo'), run: undoLast } });
  };
  const duplicateField = (id: string) => {
    const f = tb.fields.find((x) => x.id === id);
    if (!f) return;
    remember(t('copy of {name}', { name: f.name }));
    const copy: TableField = { ...structuredClone(f), id: uid(), name: t('{name} copy', { name: f.name }) };
    const rest = base ? viewFields(tb, base, true).map((x) => x.id) : [];
    rest.splice(rest.indexOf(id) + 1, 0, copy.id);
    patchTable({ fields: [...tb.fields, copy], views: tb.views.map((v) => (v.id === base?.id ? { ...v, order: rest } : v)) });
    if (!isComputed(f)) p.setRows((rs) => rs.map((r) => (r.tableId === tb.id && !isEmpty(r.values[id]) ? { ...r, values: { ...r.values, [copy.id]: r.values[id] } } : r)));
  };

  /* row changes */
  const now = () => new Date().toISOString();
  const withValue = (r: TableRow, fieldId: string, v: CellValue): TableRow => {
    const from = r.values[fieldId] ?? null;
    if (JSON.stringify(from) === JSON.stringify(v)) return r;
    return { ...r, values: { ...r.values, [fieldId]: v }, updatedAt: now(), history: [...(r.history ?? []), { by: p.me, at: now(), fieldId, from, to: v }].slice(-50) };
  };
  const setCell = (rowId: string, fieldId: string, v: CellValue) => {
    remember(t('edit'));
    p.setRows((rs) => rs.map((r) => (r.id === rowId ? withValue(r, fieldId, v) : r)));
  };
  const setValues = (rowId: string, values: Record<string, CellValue>) => {
    remember(t('edit'));
    p.setRows((rs) => rs.map((r) => (r.id === rowId ? Object.entries(values).reduce((acc, [k, v]) => withValue(acc, k, v), r) : r)));
  };
  const orderNear = (targetId?: string, after = true) => {
    const list = [...mine].sort((a, b) => a.order - b.order);
    if (!targetId) return Math.max(0, ...list.map((x) => x.order)) + 1;
    const i = list.findIndex((x) => x.id === targetId);
    const here = list[i]?.order ?? 0;
    const there = after ? list[i + 1]?.order : list[i - 1]?.order;
    return there === undefined ? here + (after ? 1 : -1) : (here + there) / 2;
  };
  const defaultTpl = tb.templates?.find((x) => x.isDefault);
  /** A new row: the template's values (the default one unless told otherwise; null for a blank row), then these. */
  const addRow = (values: Record<string, CellValue> = {}, near?: { rowId: string; after: boolean }, tpl?: RowTemplate | null) => {
    remember(t('new row'));
    const from = g ? {} : templateValues(tb, tpl === null ? undefined : (tpl ?? defaultTpl), p.me);
    const r: TableRow = { id: uid(), workspaceId: tb.workspaceId, tableId: tb.id, values: { ...from, ...values }, order: orderNear(near?.rowId, near?.after), createdBy: p.me, createdAt: now(), updatedAt: now() };
    p.setRows((rs) => [...rs, r]);
    return r.id;
  };
  const deleteRows = (ids: string[]) => {
    remember(tn(ids.length, 'delete {n} row', 'delete {n} rows'));
    const gone = p.rows.filter((r) => ids.includes(r.id));
    p.setRows((rs) => rs.filter((r) => !ids.includes(r.id)));
    setSelected(new Set());
    setSelecting(false);
    if (p.openRow && ids.includes(p.openRow)) p.setOpenRow(null);
    p.toast({ text: ids.length === 1 ? t('Deleted “{name}”', { name: rowName(tb, gone[0]) }) : tn(ids.length, 'Deleted {n} row', 'Deleted {n} rows'), action: { label: t('Undo'), run: undoLast } });
  };
  const duplicate = (id: string) => {
    const r = mine.find((x) => x.id === id);
    if (!r) return;
    return addRow({ ...r.values, [tb.fields[0].id]: t('{name} (copy)', { name: rowName(tb, r) }) }, { rowId: id, after: true }, null);
  };
  const duplicateMany = (ids: string[]) => {
    remember(tn(ids.length, 'copy {n} row', 'copy {n} rows'));
    let order = Math.max(0, ...mine.map((x) => x.order));
    const made = mine.filter((r) => ids.includes(r.id)).map((r) => ({ ...r, id: uid(), order: ++order, values: { ...r.values, [tb.fields[0].id]: t('{name} (copy)', { name: rowName(tb, r) }) }, comments: undefined, history: undefined, runs: undefined, createdBy: p.me, createdAt: now(), updatedAt: now() }));
    p.setRows((rs) => [...rs, ...made]);
    setSelected(new Set());
    setSelecting(false);
    p.toast({ text: tn(made.length, 'Copied {n} row', 'Copied {n} rows'), action: { label: t('Undo'), run: undoLast } });
  };
  /** One field changed on several rows at once. */
  const bulkSet = (ids: string[], fieldId: string, v: CellValue) => {
    const f = tb.fields.find((x) => x.id === fieldId);
    const field = f?.name ?? t('Field');
    remember(tn(ids.length, 'change {field} on {n} row', 'change {field} on {n} rows', { field }));
    p.setRows((rs) => rs.map((r) => (ids.includes(r.id) ? withValue(r, fieldId, v) : r)));
    p.toast({ text: tn(ids.length, '{field} changed on {n} row', '{field} changed on {n} rows', { field }), action: { label: t('Undo'), run: undoLast } });
  };
  const comment = (id: string, text: string) => p.setRows((rs) => rs.map((r) => (r.id === id ? { ...r, comments: [...(r.comments ?? []), { id: uid(), by: p.me, at: now(), text }] } : r)));
  const moveRow = (id: string, targetId: string, after: boolean, grp?: { fieldId: string; value: CellValue }) => {
    remember(t('move row'));
    const order = orderNear(targetId, after);
    p.setRows((rs) => rs.map((r) => (r.id !== id ? r : grp ? { ...withValue(r, grp.fieldId, grp.value), order } : { ...r, order })));
  };
  const clearCells = (cells: { rowId: string; fieldId: string }[]) => {
    remember(tn(cells.length, 'clear {n} cell', 'clear {n} cells'));
    p.setRows((rs) =>
      rs.map((r) => {
        const mineCells = cells.filter((c) => c.rowId === r.id);
        return mineCells.reduce((acc, c) => withValue(acc, c.fieldId, tb.fields.find((f) => f.id === c.fieldId)?.type === 'checkbox' ? false : null), r);
      }),
    );
  };
  /** Pasted cells (from a spreadsheet or this table): each value fitted to its column; extra lines become new rows. */
  const paste = (startRow: number, startField: number, grid: string[][], fields: TableField[], flat: TableRow[]) => {
    remember(t('paste'));
    let nextFields = tb.fields;
    const fieldNow = (id: string) => nextFields.find((f) => f.id === id)!;
    const updates = new Map<string, Record<string, CellValue>>();
    const created: TableRow[] = [];
    let order = Math.max(0, ...mine.map((x) => x.order));
    let cells = 0;
    grid.forEach((line, i) => {
      let target = flat[startRow + i];
      if (!target) {
        if (g && !g.add) return;
        target = { id: uid(), workspaceId: tb.workspaceId, tableId: tb.id, values: {}, order: ++order, createdBy: p.me, createdAt: now(), updatedAt: now() };
        created.push(target);
      }
      line.forEach((text, j) => {
        const fv = fields[startField + j];
        if (!fv || isComputed(fv) || fv.type === 'button' || fv.type === 'link' || fv.type === 'files' || (g && !g.canEdit(fv.id))) return;
        const { v, field } = parseIncoming(fieldNow(fv.id), text, p.users);
        if (field) nextFields = nextFields.map((x) => (x.id === field.id ? field : x));
        updates.set(target!.id, { ...(updates.get(target!.id) ?? {}), [fv.id]: fv.type === 'checkbox' ? !!v && text.trim() !== '' : v });
        cells++;
      });
    });
    if (nextFields !== tb.fields) patchTable({ fields: nextFields });
    p.setRows((rs) => [
      ...rs.map((r) => (updates.has(r.id) ? Object.entries(updates.get(r.id)!).reduce((acc, [k, v]) => withValue(acc, k, v), r) : r)),
      ...created.map((r) => ({ ...r, values: updates.get(r.id) ?? {} })),
    ]);
    p.toast({ text: created.length ? t('Pasted {cells}, {rows}', { cells: tn(cells, '{n} cell', '{n} cells'), rows: tn(created.length, '{n} new row', '{n} new rows') }) : tn(cells, 'Pasted {n} cell', 'Pasted {n} cells'), action: { label: t('Undo'), run: undoLast } });
  };

  /* views */
  const addView = (kind: TableViewDef['kind']) => {
    const v = newView(tb, kind);
    patchTable({ views: [...tb.views, v] });
    setViewId(v.id);
    setPop(null);
  };
  const duplicateView = () => {
    if (!base) return;
    const v = { ...structuredClone(base), id: uid(), name: t('{name} copy', { name: base.name }) };
    patchTable({ views: [...tb.views, v] });
    setViewId(v.id);
    setPop(null);
  };
  const deleteView = () => {
    if (!base || tb.views.length < 2) return;
    remember(t('delete view {name}', { name: base.name }));
    patchTable({ views: tb.views.filter((v) => v.id !== base.id) });
    setViewId(tb.views.find((v) => v.id !== base.id)!.id);
    setPop(null);
    p.toast({ text: t('Deleted the “{name}” view', { name: base.name }), action: { label: t('Undo'), run: undoLast } });
  };
  /** The same view shown another way: what the new way needs comes from the table (a choice field, dates). */
  const changeKind = (kind: TableViewDef['kind']) => {
    if (!base || base.kind === kind) return;
    const d = kindDefaults(tb, kind);
    // A view still called by its old kind ("Table", "Grid") takes the new kind's name, so names never go stale.
    const renamed = isDefaultViewName(base.name) ? { name: VIEW_KINDS.find((x) => x.kind === kind)!.name } : {};
    patchShared({ ...renamed, kind, groupBy: base.groupBy && (kind !== 'board' || tb.fields.find((f) => f.id === base.groupBy)?.type === 'select') ? base.groupBy : d.groupBy, dateField: base.dateField ?? d.dateField, endField: base.endField ?? d.endField, cover: base.cover ?? d.cover });
  };
  const copyLink = (rowId?: string) => {
    void navigator.clipboard?.writeText(tableLink(tb.id, base?.id, rowId)).then(() => p.toast({ text: rowId ? t('Link to the row copied') : t('Link to the view copied') }));
  };
  const deleteTable = () => {
    if (!confirm(tn(mine.length, 'Delete “{name}” and its {n} row? This can’t be undone.', 'Delete “{name}” and its {n} rows? This can’t be undone.', { name: tb.name }))) return;
    p.setRows((rs) => rs.filter((r) => r.tableId !== tb.id));
    p.setTables((ts) => ts.filter((x) => x.id !== tb.id));
    p.onDeleted();
  };

  /* CSV */
  const exportCsv = () => {
    const ids = view ? viewFields(tb, view).map((f) => f.id) : undefined;
    download(`${tb.name.replace(/[^\w\s-]/g, '').trim() || t('table')}.csv`, rowsToCsv(tb, shown, p.users, rowNameOf, ids));
  };
  const importPlan = async (plan: ImportPlan) => {
    if (p.serverOn) {
      const r = await fetch('/api/tables/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: tb.id, ...plan }) });
      const out = await r.json().catch(() => null);
      if (!r.ok) return p.toast({ text: out?.error ? t(out.error) : t('The import didn’t go through. Try again.') });
    } else {
      patchTable({ fields: plan.fields });
      let order = Math.max(0, ...mine.map((x) => x.order));
      const made: TableRow[] = plan.creates.map((values) => ({ id: uid(), workspaceId: tb.workspaceId, tableId: tb.id, values, order: ++order, createdBy: p.me, createdAt: now(), updatedAt: now() }));
      const upd = new Map(plan.updates.map((u) => [u.id, u.values]));
      p.setRows((rs) => [...rs.map((r) => (upd.has(r.id) ? { ...r, values: { ...r.values, ...upd.get(r.id)! }, updatedAt: now() } : r)), ...made]);
    }
    setImporting(false);
    p.toast({ text: plan.updates.length ? t('Imported {rows}, updated {updated}', { rows: tn(plan.creates.length, '{n} row', '{n} rows'), updated: tn(plan.updates.length, '{n} row', '{n} rows') }) : tn(plan.creates.length, 'Imported {n} row', 'Imported {n} rows') });
  };

  /* buttons */
  const press = async (row: TableRow, f: TableField, input: Record<string, CellValue> = {}) => {
    if (!p.serverOn) return p.toast({ text: p.inDemo ? t('Buttons don’t run in the demo company: they reach other apps and send email.') : t('Buttons run on the server; they work once {product} is running on one.', { product: product.name }) });
    const key = `${row.id}:${f.id}`;
    setRunning((x) => new Set(x).add(key));
    try {
      const r = await fetch('/api/tables/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: tb.id, rowId: row.id, fieldId: f.id, input }) });
      const out = (await r.json().catch(() => null)) as { ok: boolean; results: { ok: boolean; note: string; tr?: Msg; open?: string; compose?: { to: string; subject: string; body: string } }[]; error?: string } | null;
      if (!r.ok || !out) return p.toast({ text: out?.error ? t(out.error) : t('The button didn’t run. Try again.') });
      for (const x of out.results) {
        if (x.open) window.open(x.open, '_blank', 'noopener');
        if (x.compose) p.onCompose(x.compose);
      }
      const failed = out.results.filter((x) => !x.ok);
      const said = (list: typeof out.results) => list.map(noteOf).join(' · ');
      p.toast({ text: `${f.button?.label ?? f.name}: ${failed.length ? said(failed) : said(out.results) || t('done')}` });
    } finally {
      setRunning((x) => {
        const n = new Set(x);
        n.delete(key);
        return n;
      });
    }
  };
  const runButton = (row: TableRow, f: TableField) => {
    const b = f.button;
    if (!b) return;
    if (b.ask?.length) return setAsking({ row, f });
    if (b.confirm && !confirm(t('{button}: run this for “{row}”?', { button: b.label || f.name, row: rowName(tb, row) }))) return;
    void press(row, f);
  };

  const ctx: CellCtx = { users: p.users, tables: p.tables, rows: p.rows, rowName: rowNameOf, addOption, runButton, running, isAdmin: p.isAdmin || !!g, canEdit: g?.canEdit, openLinked: g ? undefined : (tableId, rowId) => p.onOpenTable(tableId, rowId) };
  const filters = view?.filters ?? [];
  const nFilters = view ? filterCount(tb, view) : 0;
  const sorts = view ? sortsOf(view) : [];
  const setFilters = (fs: typeof filters) => patchView({ filters: fs });
  const openRow = p.openRow ? mine.find((r) => r.id === p.openRow) : undefined;
  const fieldsHidden = view?.hidden?.length ?? 0;
  const groupField = view?.groupBy ? tb.fields.find((f) => f.id === view.groupBy) : undefined;
  const openRowFull = (id: string, wantFull = false) => (setFull(wantFull), p.setOpenRow(id));
  const filterBy = (fieldId: string) => {
    const f = tb.fields.find((x) => x.id === fieldId)!;
    setFilters([...filters, { fieldId, op: opsFor(f.type)[0].op }]);
    if (narrow) setSheet('filter');
    else setPop('filter');
  };
  const menuRow = rowMenu ? mine.find((r) => r.id === rowMenu.rowId) : undefined;
  const canAdd = !g || g.add;
  const canEditField = (f: TableField) => !isComputed(f) && f.type !== 'button' && (!g || g.canEdit(f.id));
  // The row before and after the open one, in the order shown (J and K, the arrows, or the phone's footer).
  const navIndex = openRow ? shown.findIndex((r) => r.id === openRow.id) : -1;
  const nav = openRow && navIndex >= 0 ? { index: navIndex, count: shown.length, prev: navIndex > 0 ? () => p.setOpenRow(shown[navIndex - 1].id) : undefined, next: navIndex < shown.length - 1 ? () => p.setOpenRow(shown[navIndex + 1].id) : undefined } : undefined;

  /** New row from the toolbar: the grid makes it in place, ready to type; elsewhere its page opens. */
  const newRowHere = (tpl?: RowTemplate | null) => {
    const id = addRow({}, undefined, tpl);
    if (view?.kind === 'grid' || !view) setFreshRow(id);
    else openRowFull(id);
  };
  /** Quick create (phones and narrow panes): a sheet that asks for the name, with the keyboard up. */
  const openQuick = (values: Record<string, CellValue> = {}, title?: string) => openWithFocus(() => setQuick({ values, title }), quickInput);
  const inGroup = (label?: string) => (label ? t('New row in {group}', { group: label }) : undefined);
  const quickMade = (nm: string, tpl: RowTemplate | undefined, again: boolean) => {
    if (!quick) return;
    const first = tb.fields[0];
    const id = addRow({ ...quick.values, ...(nm ? { [first.id]: nm } : {}) }, undefined, tpl ?? null);
    if (!again) setQuick(null);
    p.toast({ text: nm ? t('Added “{name}”', { name: nm }) : t('Added a row'), action: { label: t('Open'), run: () => (setQuick(null), p.setOpenRow(id)) } });
  };

  // Phones: the create button adds a row (templates on a long-press); the title switches between tables.
  const templates = tb.templates ?? [];
  useCreateAction('tables', !g && canAdd && !!view && { label: t('New row'), icon: Plus, run: () => openQuick(), more: templates.map((x) => ({ label: t('New “{name}”', { name: x.name }), icon: LayoutTemplate, run: () => openQuick(templateValues(tb, x, p.me), t('New “{name}”', { name: x.name })) })) });
  // Phones: a table is a sub-screen of All tables: the back arrow, its name at 17/600, row search and its settings.
  const [settingsStart, setSettingsStart] = useState<'root' | 'sort'>('root');
  const openSettings = (start: 'root' | 'sort') => (setSettingsStart(start), setSheet('settings'));

  // Picking several rows: the long-press menu's "Select", or the grid's checkboxes on a computer.
  const pickedRows = mine.filter((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  useEffect(() => {
    if (selecting && !selected.size) setSelecting(false);
  }, [selected.size, selecting]);
  const status = view ? (view.kind === 'board' ? tb.fields.find((f) => f.id === view.groupBy && f.type === 'select') ?? tb.fields.find((f) => f.type === 'select') : statusFieldOf(tb, view)) : undefined;
  const rowActions = (row: TableRow): SheetAction[] => [
    ...(canAdd || !g ? [{ label: t('Select'), icon: CheckSquare, run: () => (setSelecting(true), setSelected(new Set([row.id]))) }] : []),
    { label: t('Open'), icon: PanelRight, run: () => openRowFull(row.id) },
    ...(status && canEditField(status) ? [{ label: view?.kind === 'board' ? t('Move to') : t('Change {field}', { field: status.name.toLowerCase() }), icon: ArrowRightLeft, run: () => setEditCell({ rowId: row.id, fieldId: status.id, title: view?.kind === 'board' ? t('Move “{name}” to', { name: rowName(tb, row) }) : undefined }) }] : []),
    ...(canAdd ? [{ label: t('Duplicate'), icon: CopyPlus, run: () => duplicate(row.id) }] : []),
    ...(!g ? [{ label: t('Copy link'), icon: Link2, run: () => copyLink(row.id) }] : []),
    { label: t('Copy as text'), icon: Copy, run: () => copyText(row) },
    ...(!g ? [{ label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => deleteRows([row.id]) }] : []),
  ];
  const copyText = (row: TableRow) => {
    const text = viewFields(tb, view ?? tb.views[0]).map((f) => `${f.name}: ${cellText(f, row.values[f.id] ?? null, textCtx)}`).filter((l) => !l.endsWith(': ')).join('\n');
    void navigator.clipboard?.writeText(text);
    p.toast({ text: t('Row copied as text') });
  };
  const touchCell = (rowId: string, fieldId: string) => {
    const f = tb.fields.find((x) => x.id === fieldId);
    const row = mine.find((r) => r.id === rowId);
    if (!f || !row) return;
    if (f.type === 'button') return runButton(row, f);
    if (!canEditField(f)) return openRowFull(rowId);
    setEditCell({ rowId, fieldId });
  };
  const collapsedSet = new Set(view?.collapsed ?? []);
  const foldGroup = (key: string) => patchView({ collapsed: collapsedSet.has(key) ? [...collapsedSet].filter((x) => x !== key) : [...collapsedSet, key] });
  const editRow = editCell ? mine.find((r) => r.id === editCell.rowId) : undefined;
  const editField = editCell ? tb.fields.find((f) => f.id === editCell.fieldId) : undefined;
  const dateField = view ? tb.fields.find((f) => f.id === view.dateField) ?? tb.fields.find((f) => f.type === 'date') : undefined;

  const settingsActions: SettingsActions = {
    structure,
    canDelete: canDeleteTable,
    onView: patchShared,
    onMine: (x) => patchView(x),
    onPatchTable: patchTable,
    onDuplicateView: duplicateView,
    onDeleteView: deleteView,
    onKind: changeKind,
    onShare: structure && tb.clientId ? () => setSharing(true) : undefined,
    onAutomations: () => (setSheet(null), setAutoOpen(true)),
    onTemplates: () => setTemplating(true),
    onImport: structure ? () => (setSheet(null), setImporting(true)) : undefined,
    onDownload: !g || g.download ? exportCsv : undefined,
    onDeleteTable: deleteTable,
    onNewField: (f) => saveField(f),
    layout: view && (view.kind === 'grid' || view.kind === 'list') ? { cards, set: (on) => setCardsOn((x) => ({ ...x, [view.id]: on })) } : undefined,
    clients: p.clients,
    toast: (text) => p.toast({ text }),
  };

  const buttonField = buttonFor ? tb.fields.find((f) => f.id === buttonFor && f.type === 'button') : undefined;
  // The pill shows the layout as it renders here: a grid shown as rows on a phone is a list.
  const ViewIcon = view ? viewIcon(cards ? 'list' : view.kind) : Table2;
  const showPlus = canAdd && !!view && (!phone || !!g);
  return (
    <ButtonSetupCtx.Provider value={setButtonFor}>
    <section ref={paneRef} className={`tasks-pane tb-pane view-enter${narrow ? ' tb-narrow' : ''}${phone ? ' tb-phone' : ''}`}>
      {phone && !g && (
        <TopBar
          app="tables"
          lead={<TopBarBack onClick={p.onMenu} />}
          title={
            <h1 className="mt-title plain small">
              <span className="mt-title-text">{tb.name}</span>
            </h1>
          }
          actions={
            <>
              <TopBarButton icon={Search} label={t('Search rows')} onClick={() => setSearching(true)} className={q ? 'on' : ''} />
              {view && <TopBarButton icon={MoreHorizontal} label={t('View and table settings')} onClick={() => openSettings('root')} />}
            </>
          }
          search={false}
        />
      )}
      {g && phone && (
        <header className="tb-guest-head">
          {p.tables.length > 1 ? (
            <button type="button" className="tb-guest-title" onClick={() => setSheet('tables')} aria-haspopup="dialog">
              <span>{tb.name}</span>
              <ChevronDown size={17} className="muted" />
            </button>
          ) : (
            <h2 className="tb-guest-title">
              <span>{tb.name}</span>
            </h2>
          )}
          {tb.description && <p className="muted small">{tb.description}</p>}
        </header>
      )}
      {!phone && (
        <header className="tracking-head tasks-head tb-head-bar">
          <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label={t('Open menu')}>
            <Menu size={18} />
          </button>
          <button type="button" className="client-badge tb-badge" style={{ background: tb.color }} title={g || !structure ? tb.name : t('Change colour')} disabled={!!g || !structure} onClick={() => patchTable({ color: TABLE_COLORS[(TABLE_COLORS.indexOf(tb.color) + 1) % TABLE_COLORS.length] })}>
            {tb.name.charAt(0).toUpperCase()}
          </button>
          <div className="th-text">
            <input className="tb-title" value={name} readOnly={!!g || !structure} aria-label={t('Table name')} onChange={(e) => setName(e.target.value)} onBlur={() => (name.trim() ? name.trim() !== tb.name && patchTable({ name: name.trim() }) : setName(tb.name))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            {g || !structure ? tb.description && <span className="muted small tb-desc">{tb.description}</span> : <ProjectPicker value={tb.clientId ?? ''} onChange={(v) => patchTable({ clientId: v || undefined })} projects={p.clients} none={t('Whole company')} label={t('Belongs to')} className="sel-flat" />}
          </div>
          {!g && !narrow && (
            <button className="icon-btn" onClick={undoLast} title={t('Undo (Cmd/Ctrl+Z)')} aria-label={t('Undo')}>
              <Undo2 size={16} />
            </button>
          )}
          {!g && !narrow && structure && tb.clientId && (
            <button className={`ghost-btn sm tb-share-btn${tb.share?.enabled ? ' on' : ''}`} onClick={() => setSharing(true)} title={t('What the {project}’s guests see', { project: term.one })}>
              <Users size={13} /> <span className="lbl">{tb.share?.enabled ? t('Shared') : t('Share')}</span>
            </button>
          )}
          {structure && !narrow && (
            <button className={`ghost-btn sm tb-auto-btn${tb.intake?.enabled || tb.rules?.some((r) => r.enabled) ? ' on' : ''}`} onClick={() => setAutoOpen(true)} title={t('Data coming in, rules, webhooks')}>
              <Zap size={13} /> <span className="lbl">{t('Automations')}</span>
            </button>
          )}
          {g ? (
            g.download && (
              <button className="icon-btn" onClick={exportCsv} aria-label={t('Download CSV')} title={t('Download CSV')}>
                <Download size={16} />
              </button>
            )
          ) : (
            !narrow && (
              <button ref={refs.more} className="icon-btn" onClick={() => setPop('more')} aria-label={t('Table options')}>
                <MoreHorizontal size={17} />
              </button>
            )
          )}
          <Popover anchor={refs.more} open={pop === 'more'} onClose={() => setPop(null)} width={260} align="end" title={t('Table')}>
            <div className="tb-menu">
              {structure && (
                <label className="tb-menu-desc">
                  <span className="muted small">{t('Description')}</span>
                  <textarea rows={2} defaultValue={tb.description ?? ''} placeholder={t('What this table is for')} onBlur={(e) => e.target.value.trim() !== (tb.description ?? '') && patchTable({ description: e.target.value.trim() || undefined })} />
                </label>
              )}
              {structure && (
                <button type="button" onClick={() => (setPop(null), setTemplating(true))}>
                  <LayoutTemplate size={14} /> {t('Row templates')}{templates.length ? ` (${templates.length})` : ''}
                </button>
              )}
              {structure && (
                <button type="button" onClick={() => (setPop(null), setLaying(true))}>
                  <PanelRight size={14} /> {t('Row page layout')}
                </button>
              )}
              {structure && (
                <button type="button" onClick={() => (setPop(null), setImporting(true))}>
                  <FileUp size={14} /> {t('Import CSV')}
                </button>
              )}
              <button type="button" onClick={() => (setPop(null), exportCsv())}>
                <Download size={14} /> {view && shown.length !== mine.length ? t('Download CSV ({n} shown)', { n: shown.length }) : t('Download CSV')}
              </button>
              {canDeleteTable && (
                <button type="button" className="danger" onClick={() => (setPop(null), deleteTable())}>
                  <Trash2 size={14} /> {t('Delete table')}
                </button>
              )}
            </div>
          </Popover>
        </header>
      )}

      {narrow ? (
        <div className={`tb-phonebar${searching ? ' searching' : ''}`}>
          {searching ? (
            <label className="tb-psearch">
              <Search size={16} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search {name}', { name: tb.name })} aria-label={t('Search rows')} enterKeyHint="search" />
              <button type="button" className="icon-btn" onClick={() => (setQ(''), setSearching(false))} aria-label={t('Stop searching')}>
                <X size={18} />
              </button>
            </label>
          ) : (
            <>
              <button type="button" className="tb-vpill" onClick={() => setSheet('views')} aria-haspopup="dialog" aria-label={t('View: {name}. Switch views', { name: view?.name ?? '' })}>
                <ViewIcon size={16} />
                <span>{view ? viewName(view, narrow && cards ? 'list' : view.kind) : t('Views')}</span>
                <ChevronDown size={15} className="muted" />
              </button>
              <span className="spacer" />
              {!phone && (
                <button type="button" className={`icon-btn tb-pbtn${q ? ' on' : ''}`} onClick={() => setSearching(true)} aria-label={t('Search rows')}>
                  <Search size={19} />
                </button>
              )}
              {view && (
                <button type="button" className={`icon-btn tb-pbtn${nFilters ? ' on' : ''}`} onClick={() => setSheet('filter')} aria-label={nFilters ? t('Filter, {n} on', { n: nFilters }) : t('Filter')}>
                  <Filter size={19} />
                  {nFilters > 0 && <b className="tb-pbadge">{nFilters}</b>}
                </button>
              )}
              {view && phone && view.kind !== 'calendar' && (
                <button type="button" className={`icon-btn tb-pbtn${sortsOf(view).length ? ' on' : ''}`} onClick={() => openSettings('sort')} aria-label={t('Sort')}>
                  <ArrowUpDown size={20} />
                </button>
              )}
              {view && !phone && (
                <button type="button" className="icon-btn tb-pbtn" onClick={() => openSettings('root')} aria-label={t('View and table settings')}>
                  <SlidersHorizontal size={19} />
                </button>
              )}
              {showPlus && (
                <button type="button" className="primary-btn tb-pplus" onClick={() => openQuick()} aria-label={t('New row')}>
                  <Plus size={18} />
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="tb-bar">
          <ViewTabs
            views={tb.views}
            current={base?.id ?? ''}
            canEdit={structure}
            onSelect={(id) => id !== base?.id && (setViewId(id), setSelected(new Set()))}
            onMenu={(id, el) => {
              tabAnchor.current = el;
              setViewId(id);
              setRenamingView(tb.views.find((v) => v.id === id)?.name ?? '');
              setPop('view');
            }}
            onReorder={structure ? (ids) => patchTable({ views: ids.map((id) => tb.views.find((v) => v.id === id)!).filter(Boolean) }) : undefined}
            onAdd={structure ? (el) => ((addViewAnchor.current = el), setPop('addView')) : undefined}
          />
          <Popover anchor={addViewAnchor} open={pop === 'addView'} onClose={() => setPop(null)} width={280} title={t('Add a view')}>
            <div className="tb-menu">
              {VIEW_KINDS.map(({ kind, name: n, icon: I, hint }) => (
                <button key={kind} type="button" onClick={() => addView(kind)} className="tb-menu-2line">
                  <I size={15} />
                  <span>
                    {n}
                    <small className="muted">{hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </Popover>
          {base && (
            <Popover anchor={tabAnchor} open={pop === 'view'} onClose={() => (renamingView.trim() && renamingView.trim() !== base.name && patchShared({ name: renamingView.trim() }), setPop(null))} width={300} title={tx('view', 'View')}>
              <div className="tb-menu">
                {structure && <input className="tb-fm-name" autoFocus value={renamingView} onChange={(e) => setRenamingView(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (renamingView.trim() && patchShared({ name: renamingView.trim() }), setPop(null))} aria-label={t('View name')} />}
                {structure && (
                  <div className="tb-view-kinds" role="group" aria-label={t('Show as')}>
                    {VIEW_KINDS.map(({ kind, name: n, icon: I }) => (
                      <button key={kind} type="button" className={base.kind === kind ? 'on' : ''} aria-pressed={base.kind === kind} title={n} onClick={() => changeKind(kind)}>
                        <I size={15} />
                        <span>{n}</span>
                      </button>
                    ))}
                  </div>
                )}
                {structure && <ViewSettings t={tb} view={base} onView={patchShared} onNewField={(f) => saveField(f)} />}
                <button type="button" onClick={() => (copyLink(), setPop(null))}>
                  <Link2 size={14} /> {t('Copy a link to this view')}
                </button>
                {structure && (
                  <button type="button" onClick={duplicateView}>
                    <CopyPlus size={14} /> {t('Duplicate view')}
                  </button>
                )}
                {structure && tb.views.length > 1 && (
                  <button type="button" className="danger" onClick={deleteView}>
                    <Trash2 size={14} /> {t('Delete view')}
                  </button>
                )}
              </div>
            </Popover>
          )}

          <label className="tb-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} aria-label={t('Search rows')} />
          </label>
          {view && (
            <>
              <button ref={refs.filter} className={`ghost-btn sm${nFilters ? ' on' : ''}`} onClick={() => setPop('filter')} aria-label={nFilters ? t('Filter, {n} on', { n: nFilters }) : t('Filter')}>
                <Filter size={13} /> <span className="lbl">{nFilters ? tn(nFilters, '{n} filter', '{n} filters') : t('Filter')}</span>
              </button>
              {view.kind !== 'calendar' && (
                <button ref={refs.sort} className={`ghost-btn sm tb-quiet${sorts.length ? ' on' : ''}`} onClick={() => setPop('sort')} title={t('Sort')} aria-label={t('Sort')}>
                  <ArrowUpDown size={13} /> <span className="lbl">{sorts.length ? (sorts.length > 1 ? t('Sorted ({n})', { n: sorts.length }) : t('Sorted: {field}', { field: tb.fields.find((f) => f.id === sorts[0].fieldId)?.name ?? '' })) : t('Sort')}</span>
                </button>
              )}
              {structure && (view.kind === 'grid' || view.kind === 'list') && (
                <button ref={refs.group} className={`ghost-btn sm tb-quiet${groupField ? ' on' : ''}`} onClick={() => setPop('group')} title={groupField ? (view.subGroupBy ? t('Grouped by {field}, then by {sub}', { field: groupField.name, sub: tb.fields.find((f) => f.id === view.subGroupBy)?.name ?? t('another field') }) : t('Grouped by {field}', { field: groupField.name })) : t('Group')} aria-label={t('Group')}>
                  <Group size={13} /> <span className="lbl">{groupField ? t('By {field}', { field: groupField.name }) : t('Group')}</span>
                </button>
              )}
              {/* A board's "Cards" is what its fields menu would be (what each card shows): one button, not two. */}
              {view.kind === 'board' ? (
                <BoardTools table={tb} view={view} onView={patchShared} onNewField={(f) => saveField(f)} readOnly={!structure} />
              ) : (
                structure &&
                view.kind !== 'calendar' &&
                view.kind !== 'timeline' && (
                  <button ref={refs.fields} className={`ghost-btn sm tb-quiet${fieldsHidden ? ' on' : ''}`} onClick={() => setPop('fields')} title={t('Fields in this view')} aria-label={t('Fields')}>
                    <EyeOff size={13} /> <span className="lbl">{fieldsHidden ? tn(fieldsHidden, '{n} hidden', '{n} hidden') : t('Fields')}</span>
                  </button>
                )
              )}
              {structure && view.kind !== 'calendar' && view.kind !== 'timeline' && (
                <button ref={refs.colors} className={`ghost-btn sm tb-quiet${view.colors?.length ? ' on' : ''}`} onClick={() => setPop('colors')} title={t('Colours')} aria-label={t('Colours')}>
                  <Palette size={13} /> <span className="lbl">{view.colors?.length ? t('Colours ({n})', { n: view.colors.length }) : t('Colours')}</span>
                </button>
              )}
            </>
          )}
          {canAdd && view && (
            <span className="tb-split">
              <button className="primary-btn sm tb-add-row" aria-label={t('New row')} onClick={() => newRowHere()}>
                <Plus size={14} /> <span className="lbl">{t('New row')}</span>
              </button>
              {!g && (templates.length > 0 || structure) && (
                <button ref={refs.newRow} className="primary-btn sm tb-add-more" aria-label={t('New row from a template')} onClick={() => setPop('newRow')}>
                  <ChevronDown size={14} />
                </button>
              )}
            </span>
          )}
          <Popover anchor={refs.newRow} open={pop === 'newRow'} onClose={() => setPop(null)} width={260} align="end" title={t('New row')}>
            <div className="tb-menu">
              <button type="button" onClick={() => (setPop(null), newRowHere(null))}>
                <Plus size={14} /> {t('Blank row')}
              </button>
              {templates.map((x) => (
                <button key={x.id} type="button" className="tb-menu-2line" onClick={() => (setPop(null), newRowHere(x))}>
                  <LayoutTemplate size={14} />
                  <span>
                    {x.name}
                    {(x.isDefault || x.repeat) && <small className="muted">{[x.isDefault ? t('New rows start from it') : '', x.repeat ? t('Also adds itself on a schedule') : ''].filter(Boolean).join(' · ')}</small>}
                  </span>
                </button>
              ))}
              {structure && (
                <>
                  <div className="tb-colmenu-sep" />
                  <button type="button" onClick={() => (setPop(null), setTemplating(true))}>
                    <SlidersHorizontal size={14} /> {templates.length ? t('Edit templates') : t('Make a template')}
                  </button>
                </>
              )}
            </div>
          </Popover>

          {view && (
            <>
              <Popover anchor={refs.filter} open={pop === 'filter'} onClose={() => setPop(null)} width={520} title={t('Filter')}>
                <FilterPanel table={tb} view={view} rows={mine} ctx={textCtx} onChange={patchView} />
              </Popover>
              <Popover anchor={refs.sort} open={pop === 'sort'} onClose={() => setPop(null)} width={420} title={t('Sort')}>
                <SortEditor table={tb} sorts={sorts} onChange={(s) => patchView({ sorts: s })} />
              </Popover>
              <Popover anchor={refs.group} open={pop === 'group'} onClose={() => setPop(null)} width={320} title={view.kind === 'board' ? t('Columns and swimlanes') : t('Group by')}>
                <GroupEditor t={tb} view={view} onView={patchShared} board={view.kind === 'board'} />
              </Popover>
              <Popover anchor={refs.fields} open={pop === 'fields'} onClose={() => setPop(null)} width={300} title={t('Fields in this view')}>
                <FieldsEditor t={tb} view={view} onView={patchShared} all={viewFields(tb, view, true)} />
              </Popover>
              <Popover anchor={refs.colors} open={pop === 'colors'} onClose={() => setPop(null)} width={520} title={t('Colours')}>
                <ColorRulesEditor table={tb} view={view} users={p.users} me={p.me} onView={patchShared} />
              </Popover>
            </>
          )}
        </div>
      )}

      {view &&
        (narrow ? (
          <FilterLine phone={phone} table={tb} view={view} base={base!} differs={differs} canSave={structure} onClear={() => patchView({ filters: [], filterGroups: [] })} onReset={() => base && tweaks.reset(base.id)} onSave={saveForEveryone} onOpen={() => setSheet('filter')} />
        ) : (
          <div className={`fold ${differs ? 'open' : ''}`}>
            <div className="fold-in">
              <div className="tb-mine" aria-live="polite">
                <span>{structure ? t('These filters and sorts are just for you until you save them for everyone.') : t('These filters and sorts are just for you.')}</span>
                <button type="button" className="link-btn small" onClick={() => base && tweaks.reset(base.id)}>
                  {t('Reset')}
                </button>
                {structure && (
                  <button type="button" className="link-btn small strong" onClick={saveForEveryone}>
                    {t('Save for everyone')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

      {!g && !narrow && tip && view?.kind === 'grid' && (
        <div className="tb-tip">
          <span>{t('Click a column’s name to rename it, change its type, sort, filter or hide it. Drag columns and rows to move them. Click a cell once to choose it, again to edit; copy and paste blocks of cells, even from a spreadsheet.')}</span>
          <button className="icon-btn sm" onClick={() => setTip(false)} aria-label={t('Got it')}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className="tb-body">
        <TabPane key={`${view?.id ?? 'none'}:${view?.kind}:${cards ? 'c' : 'g'}`}>
          {!view ? null : view.kind === 'board' ? (
            <BoardView
              table={tb}
              view={view}
              rows={shown}
              ctx={ctx}
              onCell={setCell}
              onOpenRow={(id) => openRowFull(id)}
              onAddRow={(v, label) => (narrow ? openQuick(v, inGroup(label)) : openRowFull(addRow(v)))}
              onView={patchView}
              onNewField={(f) => saveField(f)}
              onSaveField={(f) => saveField(f)}
              canEditColumns={structure}
              readOnly={!!g && !g.add && !tb.fields.some((f) => g.canEdit(f.id))}
              canAdd={canAdd}
              phone={narrow ? { actions: rowActions, onPill: (r, f) => setEditCell({ rowId: r.id, fieldId: f.id, title: t('Move “{name}” to', { name: rowName(tb, r) }) }), selecting, selected, onToggle: toggle } : undefined}
            />
          ) : cards ? (
            <CardList
              t={tb}
              view={view}
              rows={shown}
              ctx={ctx}
              selecting={selecting}
              selected={selected}
              collapsed={collapsedSet}
              onCollapse={foldGroup}
              canAdd={canAdd}
              total={mine.length}
              onNew={canAdd ? () => openQuick() : undefined}
              h={{ onOpen: (id) => openRowFull(id), onToggle: toggle, actions: rowActions, onPill: (r, f) => setEditCell({ rowId: r.id, fieldId: f.id }), onAdd: (v, label) => openQuick(v, inGroup(label)) }}
            />
          ) : view.kind === 'list' ? (
            <ListView table={tb} view={view} rows={shown} ctx={ctx} onOpenRow={(id) => openRowFull(id)} onView={patchView} />
          ) : view.kind === 'gallery' ? (
            <GalleryView table={tb} view={view} rows={shown} ctx={ctx} onOpenRow={(id) => openRowFull(id)} onAddRow={canAdd ? () => (narrow ? openQuick() : openRowFull(addRow())) : undefined} />
          ) : view.kind === 'calendar' ? (
            <CalendarView
              table={tb}
              view={view}
              rows={shown}
              ctx={ctx}
              onOpenRow={(id) => openRowFull(id)}
              onCell={setCell}
              onAddRow={canAdd ? (values) => (narrow ? openQuick(values) : openRowFull(addRow(values))) : undefined}
              onView={patchShared}
              onNewField={(f) => saveField(f)}
              readOnly={!!g || !structure}
              narrow={narrow}
              onLongPressDay={canAdd && dateField ? (day) => openQuick({ [dateField.id]: day }, t('New row on {day}', { day: fmtWeekday(day) })) : undefined}
            />
          ) : view.kind === 'timeline' ? (
            <TimelineView table={tb} view={view} rows={shown} ctx={ctx} onOpenRow={(id) => openRowFull(id)} onValues={setValues} onView={patchShared} onNewField={(f) => saveField(f)} readOnly={!!g && !(dateField && g.canEdit(dateField.id))} narrow={narrow} canAdd={canAdd} onAddRow={(values) => (narrow ? openQuick(values) : openRowFull(addRow(values)))} />
          ) : (
            <GridView
              locked={!!g}
              fixedColumns={!structure}
              canAdd={canAdd}
              channels={p.channels}
              table={tb}
              tables={p.tables}
              view={view}
              rows={shown}
              ctx={ctx}
              selected={selected}
              onSelect={setSelected}
              onCell={setCell}
              onOpenRow={(id, f) => openRowFull(id, f)}
              onAddRow={(v) => (phone ? openQuick(v) : setFreshRow(addRow(v)))}
              focusRowId={freshRow}
              onFocused={() => setFreshRow(null)}
              onSaveField={saveField}
              onDeleteField={deleteField}
              onDuplicateField={duplicateField}
              onMakeName={(id) => {
                const f = tb.fields.find((x) => x.id === id);
                if (!f) return;
                remember(t('{name} as the name', { name: f.name }));
                // Every view keeps its columns where they are; only which one names the row changes.
                patchTable({ fields: [f, ...tb.fields.filter((x) => x.id !== id)], views: tb.views.map((v) => ({ ...v, order: viewFields(tb, v, true).map((x) => x.id) })) });
                p.toast({ text: t('{name} is now each row’s name', { name: f.name }) });
              }}
              onView={patchView}
              onFilterBy={filterBy}
              onMoveRow={moveRow}
              onRowMenu={(rowId, at) => setRowMenu({ rowId, ...at })}
              onPaste={paste}
              onClear={clearCells}
              toast={(text) => p.toast({ text })}
              touch={phone}
              onTouchCell={touchCell}
            />
          )}
          {view && !shown.length && (mine.length ? <p className="muted small tb-none">{q.trim() ? t('No rows match the search.') : t('No rows match the filters.')}</p> : view.kind === 'board' || view.kind === 'calendar' || view.kind === 'timeline' ? null : narrow ? <EmptyState
                className="tb-empty"
                icon={<ViewIcon size={22} />}
                title={t('No rows yet')}
                text={canAdd ? t('Each row is one thing you track: a lead, a video, an order. Add one, then tap it to fill in its fields.') : undefined}
                action={
                  canAdd ? (
                    <button type="button" className="ghost-btn tonal" onClick={() => openQuick()}>
                      {t('New row')}
                    </button>
                  ) : undefined
                }
              /> : <p className="muted small tb-none">{t('No rows yet. Add one, paste from a spreadsheet, or they’ll arrive from a form or import.')}</p>)}
        </TabPane>
      </div>

      {(narrow ? selecting : selected.size > 0) && (
        <BulkBar
          count={selected.size}
          phone={phone}
          canDelete={!g}
          onEdit={() => setSheet('bulk')}
          onDuplicate={canAdd ? () => duplicateMany([...selected]) : undefined}
          onDelete={() => confirm(tn(selected.size, 'Delete {n} row?', 'Delete {n} rows?')) && deleteRows([...selected])}
          onAll={narrow && selected.size < shown.length ? () => setSelected(new Set(shown.map((r) => r.id))) : undefined}
          onCancel={() => (setSelected(new Set()), setSelecting(false))}
        />
      )}

      {/* The row menu: right-click a row, its ⋯, or a long-press in the phone's grid. */}
      <span ref={rowMenuAnchor} className="tb-menu-anchor" style={rowMenu ? { left: rowMenu.x, top: rowMenu.y } : undefined} aria-hidden />
      <Popover anchor={rowMenuAnchor} open={!!menuRow} onClose={() => setRowMenu(null)} width={230} title={menuRow ? rowName(tb, menuRow) : t('Row')}>
        {menuRow && (
          <div className="tb-menu">
            <button type="button" onClick={() => (setRowMenu(null), openRowFull(menuRow.id))}>
              <PanelRight size={14} /> {t('Open')}
            </button>
            {!narrow && (
              <button type="button" onClick={() => (setRowMenu(null), openRowFull(menuRow.id, true))}>
                <Maximize2 size={14} /> {t('Open as a page')}
              </button>
            )}
            {canAdd && !phone && (
              <>
                <button type="button" onClick={() => (setRowMenu(null), addRow({}, { rowId: menuRow.id, after: false }))}>
                  <Plus size={14} /> {t('Insert a row above')}
                </button>
                <button type="button" onClick={() => (setRowMenu(null), addRow({}, { rowId: menuRow.id, after: true }))}>
                  <Plus size={14} /> {t('Insert a row below')}
                </button>
              </>
            )}
            {canAdd && (
              <button type="button" onClick={() => (setRowMenu(null), duplicate(menuRow.id))}>
                <CopyPlus size={14} /> {t('Duplicate')}
              </button>
            )}
            {!g && (
              <button type="button" onClick={() => (setRowMenu(null), copyLink(menuRow.id))}>
                <Link2 size={14} /> {t('Copy link')}
              </button>
            )}
            <button type="button" onClick={() => (setRowMenu(null), copyText(menuRow))}>
              <Copy size={14} /> {t('Copy as text')}
            </button>
            {!g && (
              <button type="button" className="danger" onClick={() => (setRowMenu(null), deleteRows([menuRow.id]))}>
                <Trash2 size={14} /> {t('Delete')}
              </button>
            )}
          </div>
        )}
      </Popover>

      {sheet === 'tables' && (
        <Sheet title={t('Shared tables')} onClose={() => setSheet(null)} className="tb-sheet">
          <div className="as-list">
            {p.tables.map((x) => (
              <button key={x.id} type="button" className="as-item" aria-current={x.id === tb.id} onClick={() => (setSheet(null), p.onOpenTable(x.id))}>
                <i className="tb-dot" style={{ background: x.color }} />
                <span className="as-label">{x.name}</span>
                {x.id === tb.id && <Check size={18} className="as-check" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'views' && <ViewsSheet table={tb} gridAsList={narrow && (cardsOn[base?.id ?? ''] ?? true)} current={base?.id ?? ''} onPick={(id) => (setViewId(id), setSelected(new Set()), setSelecting(false))} onAdd={structure ? addView : undefined} onClose={() => setSheet(null)} />}
      {sheet === 'filter' && view && <FilterSheet table={tb} view={view} rows={mine} ctx={textCtx} shown={shown.length} onChange={patchView} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && view && <SettingsSheet start={settingsStart} table={tb} view={view} ctx={textCtx} a={settingsActions} onClose={() => setSheet(null)} />}
      {sheet === 'bulk' && <BulkEditSheet table={tb} rows={pickedRows} ctx={ctx} onApply={(fieldId, v) => bulkSet([...selected], fieldId, v)} onClose={() => setSheet(null)} />}
      {quick && <QuickCreate table={tb} title={quick.title} inputRef={quickInput} onCreate={quickMade} onClose={() => setQuick(null)} />}
      {editRow && editField && <EditSheet table={tb} field={editField} row={editRow} ctx={ctx} title={editCell?.title} onSave={(v) => setCell(editRow.id, editField.id, v)} onClose={() => setEditCell(null)} canCreate={!g} />}

      {importing && <ImportDialog table={tb} rows={mine} users={p.users} onImport={importPlan} onClose={() => setImporting(false)} />}
      {sharing && <ShareTableDialog t={tb} onSave={(share) => (patchTable({ share }), setSharing(false), p.toast({ text: share.enabled ? t('Shared with the {project}’s guests', { project: term.one }) : t('No longer shared') }))} onClose={() => setSharing(false)} />}
      {templating && <TemplatesDialog t={tb} ctx={ctx} onSave={(list) => (patchTable({ templates: list }), p.toast({ text: t('Templates saved') }))} onClose={() => setTemplating(false)} />}
      {laying && <PageLayoutDialog t={tb} onSave={(page) => (patchTable({ page }), p.toast({ text: t('Row page layout saved') }))} onClose={() => setLaying(false)} />}
      {autoOpen && <AutomationsPanel t={tb} tables={p.tables} users={p.users} channels={p.channels} onPatch={patchTable} onClose={() => setAutoOpen(false)} toast={(text) => p.toast({ text })} />}
      {buttonField && <ButtonDialog key={buttonField.id} field={buttonField} t={tb} tables={p.tables} users={p.users} channels={p.channels} onSave={(button) => saveField({ ...buttonField, button })} onClose={() => setButtonFor(null)} />}
      {asking && (
        <AskDialog
          table={tb}
          row={asking.row}
          f={asking.f}
          ctx={ctx}
          onRun={(input) => {
            const a = asking;
            setAsking(null);
            void press(a.row, a.f, input);
          }}
          onClose={() => setAsking(null)}
        />
      )}
      {openRow && (
        <RecordDrawer
          table={tb}
          row={openRow}
          ctx={ctx}
          me={p.me}
          phone={phone}
          nav={nav}
          full={full}
          onToggleFull={() => setFull((x) => !x)}
          onCell={(fieldId, v) => setCell(openRow.id, fieldId, v)}
          onComment={(text) => comment(openRow.id, text)}
          onDelete={() => deleteRows([openRow.id])}
          onDuplicate={() => {
            const id = duplicate(openRow.id);
            if (id) p.setOpenRow(id);
          }}
          onCopyLink={g ? undefined : () => copyLink(openRow.id)}
          onClose={() => (p.setOpenRow(null), setFull(false))}
          onOpenRow={(tableId, rowId) => p.onOpenTable(tableId, rowId)}
          guest={!!g}
          edit={structure ? { tables: p.tables, channels: p.channels, onSave: (f) => saveField(f), onDelete: deleteField, onHide: (id) => patchTable({ page: { ...tb.page, hidden: [...new Set([...(tb.page?.hidden ?? []), id])] } }) } : undefined}
          onPage={structure ? (page) => patchTable({ page }) : undefined}
          onLayout={structure ? () => setLaying(true) : undefined}
          onNewField={structure ? (f) => saveField(f) : undefined}
        />
      )}
    </section>
    </ButtonSetupCtx.Provider>
  );
}


/* ---------- the view's own settings (under its tab) ---------- */

function ViewSettings({ t: tb, view, onView, onNewField }: { t: DataTable; view: TableViewDef; onView: (p: Partial<TableViewDef>) => void; onNewField: (f: TableField) => void }) {
  if (view.kind === 'board') {
    const selects = tb.fields.filter((f) => f.type === 'select');
    return (
      <div className="tb-view-set">
        <span className="tb-fm-label">{t('Grouped by')}</span>
        <PickSelect value={view.groupBy ?? selects[0]?.id ?? ''} aria-label={t('Grouped by')} onChange={(e) => (e.target.value === '__new' ? newChoiceField(tb, onNewField, onView) : onView({ groupBy: e.target.value }))}>
          {selects.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          <option value="__new">{t('+ New choice field…')}</option>
        </PickSelect>
        <p className="muted small">{t('A board makes one column for each choice of a single-choice field.')}</p>
      </div>
    );
  }
  if (view.kind === 'calendar' || view.kind === 'timeline') {
    const dates = tb.fields.filter((f) => f.type === 'date' || f.type === 'created' || f.type === 'edited');
    return (
      <div className="tb-view-set">
        <span className="tb-fm-label">{view.kind === 'timeline' ? t('Bars start at') : t('Dates from')}</span>
        <PickSelect value={view.dateField ?? dates[0]?.id ?? ''} aria-label={view.kind === 'timeline' ? t('Bars start at') : t('Dates from')} onChange={(e) => onView({ dateField: e.target.value })}>
          {dates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </PickSelect>
        {view.kind === 'timeline' && (
          <>
            <span className="tb-fm-label">{t('and end at')}</span>
            <PickSelect value={view.endField ?? ''} aria-label={t('Bars end at')} onChange={(e) => onView({ endField: e.target.value || undefined })}>
              <option value="">{t('The same day')}</option>
              {dates
                .filter((f) => f.type === 'date' && f.id !== view.dateField)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </PickSelect>
          </>
        )}
      </div>
    );
  }
  if (view.kind === 'gallery') {
    const files = tb.fields.filter((f) => f.type === 'files');
    return (
      <div className="tb-view-set">
        <span className="tb-fm-label">{t('Card picture from')}</span>
        <PickSelect value={view.cover ?? ''} aria-label={t('Card picture')} onChange={(e) => onView({ cover: e.target.value || undefined })}>
          <option value="">{t('No picture')}</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </PickSelect>
      </div>
    );
  }
  return null;
}

/* ---------- dialogs ---------- */

/** Before a button runs: the fields it asks for (e.g. "Why lost?"), filled in on the spot. */
function AskDialog({ table, row, f, ctx, onRun, onClose }: { table: DataTable; row: TableRow; f: TableField; ctx: CellCtx; onRun: (input: Record<string, CellValue>) => void; onClose: () => void }) {
  const ask = (f.button?.ask ?? []).map((id) => table.fields.find((x) => x.id === id)).filter(Boolean) as TableField[];
  const [draft, setDraft] = useState<Record<string, CellValue>>(() => Object.fromEntries(ask.map((x) => [x.id, row.values[x.id] ?? null])));
  const fake: TableRow = { ...row, values: { ...row.values, ...draft } };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={f.button?.label ?? f.name} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Zap size={15} /> {f.button?.label || f.name} · {rowName(table, row)}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <div className="tb-rd-fields">
            {ask.map((x) => (
              <FieldLine key={x.id} f={x} row={fake} ctx={ctx} onCell={(id, v) => setDraft((d) => ({ ...d, [id]: v }))} />
            ))}
          </div>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={() => onRun(draft)}>
            {f.button?.label || t('Run')}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** What a project's guests get of this table: they see some fields, change fewer, press chosen buttons. */
function ShareTableDialog({ t: tb, onSave, onClose }: { t: DataTable; onSave: (s: NonNullable<DataTable['share']>) => void; onClose: () => void }) {
  const [s, setS] = useState<NonNullable<DataTable['share']>>(
    () => tb.share ?? { enabled: true, fields: tb.fields.filter((f, i) => i > 0 && !['button', 'link', 'longtext'].includes(f.type)).map((f) => f.id), edit: [], buttons: [], add: false, download: true },
  );
  const toggle = (key: 'fields' | 'edit' | 'buttons', id: string, on: boolean) =>
    setS((x) => {
      const next = { ...x, [key]: on ? [...x[key], id] : x[key].filter((y) => y !== id) };
      if (key === 'fields' && !on) next.edit = next.edit.filter((y) => y !== id); // can't change what they can't see
      if (key === 'edit' && on && !next.fields.includes(id)) next.fields = [...next.fields, id];
      return next;
    });
  const first = tb.fields[0];
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-share" role="dialog" aria-label={t('Share with guests')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Users size={15} /> {t('Share {name} with guests', { name: tb.name })}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <label className="check-row tb-share-on">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            <span>
              <strong>{t('Guests on this {project} can open this table', { project: term.one })}</strong>
              <small className="muted">{t('It shows in their shared space. Rules, webhook addresses and the team’s notes on rows stay hidden.')}</small>
            </span>
          </label>
          <div className={`fold ${s.enabled ? 'open' : ''}`}>
            <div className="fold-in">
              <div className="tb-share-grid">
                <span />
                <small className="muted">{t('Sees')}</small>
                <small className="muted">{t('Can change')}</small>
                <span className="tb-share-name">{first.name}</span>
                <input type="checkbox" checked disabled aria-label={t('{name} is always seen', { name: first.name })} />
                <input type="checkbox" checked={s.edit.includes(first.id)} onChange={(e) => toggle('edit', first.id, e.target.checked)} aria-label={t('Guests can change {name}', { name: first.name })} />
                {tb.fields.slice(1).filter((f) => f.type !== 'link').map((f) =>
                  f.type === 'button' ? (
                    <div key={f.id} className="contents">
                      <span className="tb-share-name">{f.button?.label ?? f.name} <small className="muted">{t('button')}</small></span>
                      <input type="checkbox" checked={s.buttons.includes(f.id)} onChange={(e) => toggle('buttons', f.id, e.target.checked)} aria-label={t('Guests can press {name}', { name: f.name })} />
                      <span />
                    </div>
                  ) : (
                    <div key={f.id} className="contents">
                      <span className="tb-share-name">{f.name}</span>
                      <input type="checkbox" checked={s.fields.includes(f.id)} onChange={(e) => toggle('fields', f.id, e.target.checked)} aria-label={t('Guests see {name}', { name: f.name })} />
                      <input type="checkbox" checked={s.edit.includes(f.id)} onChange={(e) => toggle('edit', f.id, e.target.checked)} aria-label={t('Guests can change {name}', { name: f.name })} />
                    </div>
                  ),
                )}
              </div>
              <label className="check-row">
                <input type="checkbox" checked={!!s.add} onChange={(e) => setS({ ...s, add: e.target.checked })} /> {t('They can add rows')}
              </label>
              <label className="check-row">
                <input type="checkbox" checked={!!s.download} onChange={(e) => setS({ ...s, download: e.target.checked })} /> {t('They can download it as CSV')}
              </label>
            </div>
          </div>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={() => onSave(s)}>
            {t('Save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
