import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpDown, CalendarDays, Columns3, Copy, CopyPlus, Download, Eye, EyeOff, FileUp, Filter, GalleryHorizontalEnd, GripVertical, Group, LayoutGrid, List, Maximize2, Menu, MoreHorizontal, PanelRight, Plus, Search, Trash2, Undo2, Users, X, Zap } from 'lucide-react';
import type { CellValue, Channel, Client, DataTable, TableField, TableFilter, TableRow, TableViewDef, User } from '../../types';
import { term } from '../../terms';
import { uid } from '../../utils';
import { usePersisted } from '../../settings';
import { Popover } from '../ui/Popover';
import { TabPane } from '../ui/Smooth';
import { TabBar } from '../ui/TabBar';
import { DatePicker } from '../ui/DatePicker';
import { PickSelect } from '../ui/PickSelect';
import { ProjectPicker } from '../ProjectPicker';
import { newOption, type CellCtx } from './Cell';
import { GridView } from './GridView';
import { BoardView, newChoiceField } from './BoardView';
import { CalendarView, GalleryView, ListView } from './Views';
import { FieldLine, RecordDrawer } from './RecordDrawer';
import { AutomationsPanel } from './Automations';
import { ImportDialog, type ImportPlan } from './ImportDialog';
import { download, rowsToCsv } from './csv';
import { TABLE_COLORS, cellText, convertValue, fieldIcon, isComputed, isEmpty, opsFor, optionsFromValues, parseIncoming, rowName, sortWords, sortsOf, viewFields, visibleRows } from './fields';

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
  toast: (t: { text: string; action?: { label: string; run: () => void } }) => void;
  channels: Channel[];
  isAdmin: boolean;
  serverOn: boolean;
  onCompose: (m: { to: string; subject: string; body: string }) => void;
  /** A project's guest looking at a shared table: what they may do. */
  guest?: { canEdit: (fieldId: string) => boolean; add: boolean; download: boolean };
}

const VIEW_KINDS: { kind: TableViewDef['kind']; name: string; icon: typeof LayoutGrid; hint: string }[] = [
  { kind: 'grid', name: 'Table', icon: LayoutGrid, hint: 'Rows and columns, like a spreadsheet' },
  { kind: 'board', name: 'Board', icon: Columns3, hint: 'Cards in columns by a choice, like Status' },
  { kind: 'list', name: 'List', icon: List, hint: 'A compact list, a few fields per row' },
  { kind: 'gallery', name: 'Gallery', icon: GalleryHorizontalEnd, hint: 'Cards with a picture' },
  { kind: 'calendar', name: 'Calendar', icon: CalendarDays, hint: 'Rows on their dates' },
];
const viewIcon = (k: TableViewDef['kind']) => VIEW_KINDS.find((x) => x.kind === k)?.icon ?? LayoutGrid;

export function TableScreen(p: ScreenProps) {
  const t = p.table;
  const [viewId, setViewId] = usePersisted<string>(`s2g-table-view:${t.id}`, t.views[0]?.id ?? '');
  const view = t.views.find((v) => v.id === viewId) ?? t.views[0];
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pop, setPop] = useState<null | 'filter' | 'sort' | 'fields' | 'group' | 'view' | 'more' | 'addView'>(null);
  const refs = { filter: useRef<HTMLButtonElement>(null), sort: useRef<HTMLButtonElement>(null), fields: useRef<HTMLButtonElement>(null), group: useRef<HTMLButtonElement>(null), view: useRef<HTMLButtonElement>(null), more: useRef<HTMLButtonElement>(null), addView: useRef<HTMLButtonElement>(null) };
  const [name, setName] = useState(t.name);
  const [renamingView, setRenamingView] = useState('');
  const [autoOpen, setAutoOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [full, setFull] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const rowMenuAnchor = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = usePersisted('s2g-tables-tip', true);
  const g = p.guest;
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<{ row: TableRow; f: TableField } | null>(null);
  useEffect(() => setName(t.name), [t.name]);

  const mine = useMemo(() => p.rows.filter((r) => r.tableId === t.id), [p.rows, t.id]);
  const rowNameOf = (id: string) => {
    const r = p.rows.find((x) => x.id === id);
    const tt = r && p.tables.find((x) => x.id === r.tableId);
    return tt ? rowName(tt, r) : '';
  };
  const textCtx = { users: p.users, rowName: rowNameOf, rows: p.rows, tables: p.tables };
  const shown = useMemo(() => (view ? visibleRows(t, view, mine, q, textCtx) : mine), [t, view, mine, q, p.users, p.rows, p.tables]); // eslint-disable-line react-hooks/exhaustive-deps

  /* undo: what this table and its rows were before each change made here (Cmd/Ctrl+Z) */
  const undo = useRef<{ rows: TableRow[]; table: DataTable; what: string }[]>([]);
  const remember = (what: string) => {
    undo.current.push({ rows: mine, table: t, what });
    if (undo.current.length > 40) undo.current.shift();
  };
  const undoLast = () => {
    const s = undo.current.pop();
    if (!s) return p.toast({ text: 'Nothing to undo' });
    p.setRows((rs) => [...rs.filter((r) => r.tableId !== t.id), ...s.rows]);
    p.setTables((ts) => ts.map((x) => (x.id === t.id ? s.table : x)));
    p.toast({ text: `Undone: ${s.what}` });
  };
  useEffect(() => {
    if (g) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || el.closest('input, textarea, [contenteditable=true]')) return;
      if (document.querySelector('.modal-scrim, .pop:not(.is-leaving)')) return;
      e.preventDefault();
      undoLast();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  /* table changes */
  const patchTable = (patch: Partial<DataTable>) => p.setTables((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
  const patchView = (patch: Partial<TableViewDef>) => view && patchTable({ views: t.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  const addOption = (fieldId: string, label: string) => {
    const f = t.fields.find((x) => x.id === fieldId)!;
    const o = newOption(f, label);
    patchTable({ fields: t.fields.map((x) => (x.id === fieldId ? { ...x, options: [...(x.options ?? []), o] } : x)) });
    return o.id;
  };
  /** Saves a field; a new one goes at a view position when given (a column added left or right of another). */
  const saveField = (f: TableField, at?: number) => {
    const before = t.fields.find((x) => x.id === f.id);
    remember(before ? `change to ${before.name}` : `new column ${f.name}`);
    if (!before) {
      const views = at === undefined || !view ? t.views : t.views.map((v) => {
        if (v.id !== view.id) return v;
        const vis = viewFields(t, v).map((x) => x.id);
        const rest = viewFields(t, v, true).map((x) => x.id).slice(1);
        const anchorId = vis[at];
        const idx = anchorId && anchorId !== t.fields[0].id ? rest.indexOf(anchorId) : at <= 0 ? 0 : rest.length;
        rest.splice(idx < 0 ? rest.length : idx, 0, f.id);
        return { ...v, order: rest };
      });
      return patchTable({ fields: [...t.fields, f], views });
    }
    let next = f;
    if (before.type !== f.type) {
      // Becoming a choice field: the words already in the column become its choices.
      if ((f.type === 'select' || f.type === 'multi') && !f.options?.length) next = { ...f, options: optionsFromValues(before, mine, textCtx) };
      const target = next;
      p.setRows((rs) => rs.map((r) => (r.tableId === t.id && !isEmpty(r.values[f.id]) ? { ...r, values: { ...r.values, [f.id]: convertValue(before, target, r.values[f.id], textCtx) } } : r)));
    } else if (f.options) {
      // Choices removed: their cells empty out.
      const keep = new Set(f.options.map((o) => o.id));
      p.setRows((rs) =>
        rs.map((r) => {
          if (r.tableId !== t.id) return r;
          const v = r.values[f.id];
          if (f.type === 'select' && typeof v === 'string' && !keep.has(v)) return { ...r, values: { ...r.values, [f.id]: null } };
          if (f.type === 'multi' && Array.isArray(v) && (v as string[]).some((x) => !keep.has(x))) return { ...r, values: { ...r.values, [f.id]: (v as string[]).filter((x) => keep.has(x)) } };
          return r;
        }),
      );
    }
    patchTable({ fields: t.fields.map((x) => (x.id === f.id ? next : x)) });
  };
  const deleteField = (id: string) => {
    const f = t.fields.find((x) => x.id === id);
    remember(`delete column ${f?.name ?? ''}`);
    patchTable({
      fields: t.fields.filter((x) => x.id !== id),
      views: t.views.map((v) => ({
        ...v,
        hidden: v.hidden?.filter((x) => x !== id),
        order: v.order?.filter((x) => x !== id),
        wrap: v.wrap?.filter((x) => x !== id),
        filters: v.filters?.filter((x) => x.fieldId !== id),
        sort: v.sort?.fieldId === id ? undefined : v.sort,
        sorts: v.sorts?.filter((x) => x.fieldId !== id),
        groupBy: v.groupBy === id ? undefined : v.groupBy,
        calcs: v.calcs ? Object.fromEntries(Object.entries(v.calcs).filter(([k]) => k !== id)) : v.calcs,
      })),
    });
    p.setRows((rs) => rs.map((r) => (r.tableId === t.id && id in r.values ? { ...r, values: Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== id)) } : r)));
    p.toast({ text: `Deleted the ${f?.name ?? ''} column`, action: { label: 'Undo', run: undoLast } });
  };
  const duplicateField = (id: string) => {
    const f = t.fields.find((x) => x.id === id);
    if (!f) return;
    remember(`copy of ${f.name}`);
    const copy: TableField = { ...structuredClone(f), id: uid(), name: `${f.name} copy` };
    const rest = view ? viewFields(t, view, true).map((x) => x.id).slice(1) : [];
    rest.splice(rest.indexOf(id) + 1, 0, copy.id);
    patchTable({ fields: [...t.fields, copy], views: t.views.map((v) => (v.id === view?.id ? { ...v, order: rest } : v)) });
    if (!isComputed(f)) p.setRows((rs) => rs.map((r) => (r.tableId === t.id && !isEmpty(r.values[id]) ? { ...r, values: { ...r.values, [copy.id]: r.values[id] } } : r)));
  };

  /* row changes */
  const now = () => new Date().toISOString();
  const withValue = (r: TableRow, fieldId: string, v: CellValue): TableRow => {
    const from = r.values[fieldId] ?? null;
    if (JSON.stringify(from) === JSON.stringify(v)) return r;
    return { ...r, values: { ...r.values, [fieldId]: v }, updatedAt: now(), history: [...(r.history ?? []), { by: p.me, at: now(), fieldId, from, to: v }].slice(-50) };
  };
  const setCell = (rowId: string, fieldId: string, v: CellValue) => {
    remember('edit');
    p.setRows((rs) => rs.map((r) => (r.id === rowId ? withValue(r, fieldId, v) : r)));
  };
  const orderNear = (targetId?: string, after = true) => {
    const list = [...mine].sort((a, b) => a.order - b.order);
    if (!targetId) return Math.max(0, ...list.map((x) => x.order)) + 1;
    const i = list.findIndex((x) => x.id === targetId);
    const here = list[i]?.order ?? 0;
    const there = after ? list[i + 1]?.order : list[i - 1]?.order;
    return there === undefined ? here + (after ? 1 : -1) : (here + there) / 2;
  };
  const addRow = (values: Record<string, CellValue> = {}, near?: { rowId: string; after: boolean }) => {
    remember('new row');
    const r: TableRow = { id: uid(), workspaceId: t.workspaceId, tableId: t.id, values, order: orderNear(near?.rowId, near?.after), createdBy: p.me, createdAt: now(), updatedAt: now() };
    p.setRows((rs) => [...rs, r]);
    return r.id;
  };
  const deleteRows = (ids: string[]) => {
    remember(ids.length === 1 ? 'delete row' : `delete ${ids.length} rows`);
    const gone = p.rows.filter((r) => ids.includes(r.id));
    p.setRows((rs) => rs.filter((r) => !ids.includes(r.id)));
    setSelected(new Set());
    if (p.openRow && ids.includes(p.openRow)) p.setOpenRow(null);
    p.toast({ text: ids.length === 1 ? `Deleted “${rowName(t, gone[0])}”` : `Deleted ${ids.length} rows`, action: { label: 'Undo', run: undoLast } });
  };
  const duplicate = (id: string) => {
    const r = mine.find((x) => x.id === id);
    if (!r) return;
    const nid = addRow({ ...r.values, [t.fields[0].id]: `${rowName(t, r)} (copy)` }, { rowId: id, after: true });
    return nid;
  };
  const comment = (id: string, text: string) => p.setRows((rs) => rs.map((r) => (r.id === id ? { ...r, comments: [...(r.comments ?? []), { id: uid(), by: p.me, at: now(), text }] } : r)));
  const moveRow = (id: string, targetId: string, after: boolean, grp?: { fieldId: string; value: CellValue }) => {
    remember('move row');
    const order = orderNear(targetId, after);
    p.setRows((rs) => rs.map((r) => (r.id !== id ? r : grp ? { ...withValue(r, grp.fieldId, grp.value), order } : { ...r, order })));
  };
  const clearCells = (cells: { rowId: string; fieldId: string }[]) => {
    remember(cells.length === 1 ? 'clear cell' : `clear ${cells.length} cells`);
    p.setRows((rs) =>
      rs.map((r) => {
        const mineCells = cells.filter((c) => c.rowId === r.id);
        return mineCells.reduce((acc, c) => withValue(acc, c.fieldId, t.fields.find((f) => f.id === c.fieldId)?.type === 'checkbox' ? false : null), r);
      }),
    );
  };
  /** Pasted cells (from a spreadsheet or this table): each value fitted to its column; extra lines become new rows. */
  const paste = (startRow: number, startField: number, grid: string[][], fields: TableField[], flat: TableRow[]) => {
    remember('paste');
    let nextFields = t.fields;
    const fieldNow = (id: string) => nextFields.find((f) => f.id === id)!;
    const updates = new Map<string, Record<string, CellValue>>();
    const created: TableRow[] = [];
    let order = Math.max(0, ...mine.map((x) => x.order));
    let cells = 0;
    grid.forEach((line, i) => {
      let target = flat[startRow + i];
      if (!target) {
        if (g && !g.add) return;
        target = { id: uid(), workspaceId: t.workspaceId, tableId: t.id, values: {}, order: ++order, createdBy: p.me, createdAt: now(), updatedAt: now() };
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
    if (nextFields !== t.fields) patchTable({ fields: nextFields });
    p.setRows((rs) => [
      ...rs.map((r) => (updates.has(r.id) ? Object.entries(updates.get(r.id)!).reduce((acc, [k, v]) => withValue(acc, k, v), r) : r)),
      ...created.map((r) => ({ ...r, values: updates.get(r.id) ?? {} })),
    ]);
    p.toast({ text: `Pasted ${cells} cell${cells === 1 ? '' : 's'}${created.length ? `, ${created.length} new row${created.length === 1 ? '' : 's'}` : ''}`, action: { label: 'Undo', run: undoLast } });
  };

  /* views */
  const addView = (kind: TableViewDef['kind']) => {
    const v: TableViewDef = {
      id: uid(),
      name: VIEW_KINDS.find((x) => x.kind === kind)!.name,
      kind,
      groupBy: kind === 'board' ? t.fields.find((f) => f.type === 'select')?.id : undefined,
      dateField: kind === 'calendar' ? (t.fields.find((f) => f.type === 'date') ?? t.fields.find((f) => f.type === 'created'))?.id : undefined,
      cover: kind === 'gallery' ? t.fields.find((f) => f.type === 'files')?.id : undefined,
    };
    patchTable({ views: [...t.views, v] });
    setViewId(v.id);
    setPop(null);
  };
  const duplicateView = () => {
    if (!view) return;
    const v = { ...structuredClone(view), id: uid(), name: `${view.name} copy` };
    patchTable({ views: [...t.views, v] });
    setViewId(v.id);
    setPop(null);
  };
  const deleteView = () => {
    if (!view || t.views.length < 2) return;
    patchTable({ views: t.views.filter((v) => v.id !== view.id) });
    setViewId(t.views.find((v) => v.id !== view.id)!.id);
    setPop(null);
  };
  const deleteTable = () => {
    if (!confirm(`Delete “${t.name}” and its ${mine.length} row${mine.length === 1 ? '' : 's'}? This can’t be undone.`)) return;
    p.setRows((rs) => rs.filter((r) => r.tableId !== t.id));
    p.setTables((ts) => ts.filter((x) => x.id !== t.id));
    p.onDeleted();
  };

  /* CSV */
  const exportCsv = () => {
    const ids = view ? viewFields(t, view).map((f) => f.id) : undefined;
    download(`${t.name.replace(/[^\w\s-]/g, '').trim() || 'table'}.csv`, rowsToCsv(t, shown, p.users, rowNameOf, ids));
  };
  const importPlan = async (plan: ImportPlan) => {
    if (p.serverOn) {
      const r = await fetch('/api/tables/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: t.id, ...plan }) });
      const out = await r.json().catch(() => null);
      if (!r.ok) return p.toast({ text: out?.error ?? 'The import didn’t go through. Try again.' });
    } else {
      patchTable({ fields: plan.fields });
      let order = Math.max(0, ...mine.map((x) => x.order));
      const made: TableRow[] = plan.creates.map((values) => ({ id: uid(), workspaceId: t.workspaceId, tableId: t.id, values, order: ++order, createdBy: p.me, createdAt: now(), updatedAt: now() }));
      const upd = new Map(plan.updates.map((u) => [u.id, u.values]));
      p.setRows((rs) => [...rs.map((r) => (upd.has(r.id) ? { ...r, values: { ...r.values, ...upd.get(r.id)! }, updatedAt: now() } : r)), ...made]);
    }
    setImporting(false);
    p.toast({ text: `Imported ${plan.creates.length} row${plan.creates.length === 1 ? '' : 's'}${plan.updates.length ? `, updated ${plan.updates.length}` : ''}` });
  };

  /* buttons */
  const press = async (row: TableRow, f: TableField, input: Record<string, CellValue> = {}) => {
    if (!p.serverOn) return p.toast({ text: 'Buttons run on the server; they work once Sprint2go is running on one.' });
    const key = `${row.id}:${f.id}`;
    setRunning((x) => new Set(x).add(key));
    try {
      const r = await fetch('/api/tables/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: t.id, rowId: row.id, fieldId: f.id, input }) });
      const out = (await r.json().catch(() => null)) as { ok: boolean; results: { ok: boolean; note: string; open?: string; compose?: { to: string; subject: string; body: string } }[]; error?: string } | null;
      if (!r.ok || !out) return p.toast({ text: out?.error ?? 'The button didn’t run. Try again.' });
      for (const x of out.results) {
        if (x.open) window.open(x.open, '_blank', 'noopener');
        if (x.compose) p.onCompose(x.compose);
      }
      const failed = out.results.filter((x) => !x.ok);
      p.toast({ text: failed.length ? `${f.button?.label ?? f.name}: ${failed.map((x) => x.note).join(' · ')}` : `${f.button?.label ?? f.name}: ${out.results.map((x) => x.note).join(' · ') || 'done'}` });
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
    if (b.confirm && !confirm(`${b.label || f.name}: run this for “${rowName(t, row)}”?`)) return;
    void press(row, f);
  };

  const ctx: CellCtx = { users: p.users, tables: p.tables, rows: p.rows, rowName: rowNameOf, addOption, runButton, running, isAdmin: p.isAdmin || !!g, canEdit: g?.canEdit };
  const filters = view?.filters ?? [];
  const activeFilters = filters.filter((f) => f.op === 'empty' || f.op === 'filled' || (f.value ?? '') !== '');
  const sorts = view ? sortsOf(view) : [];
  const setFilters = (fs: TableFilter[]) => patchView({ filters: fs });
  const openRow = p.openRow ? mine.find((r) => r.id === p.openRow) : undefined;
  const fieldsHidden = view?.hidden?.length ?? 0;
  const groupField = view?.groupBy ? t.fields.find((f) => f.id === view.groupBy) : undefined;
  const openRowFull = (id: string, wantFull = false) => (setFull(wantFull), p.setOpenRow(id));
  const filterBy = (fieldId: string) => {
    const f = t.fields.find((x) => x.id === fieldId)!;
    setFilters([...filters, { fieldId, op: opsFor(f.type)[0].op }]);
    setPop('filter');
  };
  const menuRow = rowMenu ? mine.find((r) => r.id === rowMenu.rowId) : undefined;
  const canAdd = !g || g.add;

  return (
    <section className="tasks-pane tb-pane view-enter">
      <header className="tracking-head tasks-head tb-head-bar">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <button className="icon-btn tb-back" onClick={p.onMenu} aria-label="All tables">
          <ArrowLeft size={18} />
        </button>
        <button type="button" className="client-badge tb-badge" style={{ background: t.color }} title={g ? t.name : 'Change colour'} disabled={!!g} onClick={() => patchTable({ color: TABLE_COLORS[(TABLE_COLORS.indexOf(t.color) + 1) % TABLE_COLORS.length] })}>
          {t.name.charAt(0).toUpperCase()}
        </button>
        <div className="th-text">
          <input className="tb-title" value={name} readOnly={!!g} aria-label="Table name" onChange={(e) => setName(e.target.value)} onBlur={() => (name.trim() ? name.trim() !== t.name && patchTable({ name: name.trim() }) : setName(t.name))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          {g ? t.description && <span className="muted small">{t.description}</span> : <ProjectPicker value={t.clientId ?? ''} onChange={(v) => patchTable({ clientId: v || undefined })} projects={p.clients} none="Whole company" label="Belongs to" className="sel-flat" />}
        </div>
        {!g && (
          <button className="icon-btn" onClick={undoLast} title="Undo (Cmd/Ctrl+Z)" aria-label="Undo">
            <Undo2 size={16} />
          </button>
        )}
        {!g && t.clientId && (
          <button className={`ghost-btn sm tb-share-btn${t.share?.enabled ? ' on' : ''}`} onClick={() => setSharing(true)} title={`What the ${term.one}’s guests see`}>
            <Users size={13} /> <span className="lbl">{t.share?.enabled ? 'Shared' : 'Share'}</span>
          </button>
        )}
        {!g && (
          <button className={`ghost-btn sm tb-auto-btn${t.intake?.enabled || t.rules?.some((r) => r.enabled) ? ' on' : ''}`} onClick={() => setAutoOpen(true)} title="Data coming in, rules, webhooks">
            <Zap size={13} /> <span className="lbl">Automations</span>
          </button>
        )}
        {g ? (
          g.download && (
            <button className="icon-btn" onClick={exportCsv} aria-label="Download CSV" title="Download CSV">
              <Download size={16} />
            </button>
          )
        ) : (
          <button ref={refs.more} className="icon-btn" onClick={() => setPop('more')} aria-label="Table options">
            <MoreHorizontal size={17} />
          </button>
        )}
        <Popover anchor={refs.more} open={pop === 'more'} onClose={() => setPop(null)} width={240} align="end" title="Table">
          <div className="tb-menu">
            <label className="tb-menu-desc">
              <span className="muted small">Description</span>
              <textarea rows={2} defaultValue={t.description ?? ''} placeholder="What this table is for" onBlur={(e) => e.target.value.trim() !== (t.description ?? '') && patchTable({ description: e.target.value.trim() || undefined })} />
            </label>
            <button type="button" onClick={() => (setPop(null), setImporting(true))}>
              <FileUp size={14} /> Import CSV
            </button>
            <button type="button" onClick={() => (setPop(null), exportCsv())}>
              <Download size={14} /> Download CSV{view && shown.length !== mine.length ? ` (${shown.length} shown)` : ''}
            </button>
            <button type="button" className="danger" onClick={() => (setPop(null), deleteTable())}>
              <Trash2 size={14} /> Delete table
            </button>
          </div>
        </Popover>
      </header>

      <div className="tb-bar">
        <TabBar
          storageKey={`table-views:${t.id}`}
          className="client-tabs tb-views"
          value={view?.id ?? ''}
          canHide={false}
          order={{ order: t.views.map((v) => v.id), hidden: [] }}
          onOrder={g ? undefined : (o) => patchTable({ views: o.order.map((id) => t.views.find((v) => v.id === id)!).filter(Boolean) })}
          onSelect={(id) => {
            if (id !== view?.id) return (setViewId(id), setSelected(new Set()));
            if (g) return;
            // Clicking the open view: its settings, under its tab.
            refs.view.current = document.querySelector<HTMLButtonElement>(`.tb-views [role=tab].on`);
            setRenamingView(view.name);
            setPop('view');
          }}
          items={t.views.map((v) => {
            const I = viewIcon(v.kind);
            return { id: v.id, name: v.name, title: v.id === view?.id && !g ? 'View settings' : undefined, label: <><I size={13} /> {v.name}</> };
          })}
          extra={
            !g && (
              <button ref={refs.addView} className="tb-add-view" onClick={() => setPop('addView')} title="Add a view">
                <Plus size={14} />
              </button>
            )
          }
        />
        <Popover anchor={refs.addView} open={pop === 'addView'} onClose={() => setPop(null)} width={260} title="Add a view">
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
        {view && (
          <Popover anchor={refs.view} open={pop === 'view'} onClose={() => (renamingView.trim() && renamingView.trim() !== view.name && patchView({ name: renamingView.trim() }), setPop(null))} width={280} title="View">
            <div className="tb-menu">
              <input className="tb-fm-name" autoFocus value={renamingView} onChange={(e) => setRenamingView(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (renamingView.trim() && patchView({ name: renamingView.trim() }), setPop(null))} aria-label="View name" />
              <ViewSettings t={t} view={view} onView={patchView} onNewField={(f) => saveField(f)} />
              <button type="button" onClick={duplicateView}>
                <CopyPlus size={14} /> Duplicate view
              </button>
              {t.views.length > 1 && (
                <button type="button" className="danger" onClick={deleteView}>
                  <Trash2 size={14} /> Delete view
                </button>
              )}
            </div>
          </Popover>
        )}

        <span className="spacer" />
        <label className="tb-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search rows" />
        </label>
        {!g && view && (
          <>
            <button ref={refs.filter} className={`ghost-btn sm${activeFilters.length ? ' on' : ''}`} onClick={() => setPop('filter')}>
              <Filter size={13} /> <span className="lbl">{activeFilters.length ? `${activeFilters.length} filter${activeFilters.length === 1 ? '' : 's'}` : 'Filter'}</span>
            </button>
            {view.kind !== 'calendar' && (
              <button ref={refs.sort} className={`ghost-btn sm${sorts.length ? ' on' : ''}`} onClick={() => setPop('sort')}>
                <ArrowUpDown size={13} /> <span className="lbl">{sorts.length ? `Sorted${sorts.length > 1 ? ` (${sorts.length})` : `: ${t.fields.find((f) => f.id === sorts[0].fieldId)?.name}`}` : 'Sort'}</span>
              </button>
            )}
            {(view.kind === 'grid' || view.kind === 'list') && (
              <button ref={refs.group} className={`ghost-btn sm${groupField ? ' on' : ''}`} onClick={() => setPop('group')}>
                <Group size={13} /> <span className="lbl">{groupField ? `By ${groupField.name}` : 'Group'}</span>
              </button>
            )}
            <button ref={refs.fields} className={`ghost-btn sm${fieldsHidden ? ' on' : ''}`} onClick={() => setPop('fields')}>
              <EyeOff size={13} /> <span className="lbl">{fieldsHidden ? `${fieldsHidden} hidden` : 'Fields'}</span>
            </button>
          </>
        )}
        {canAdd && (
          <button className="primary-btn sm tb-new-row" aria-label="New row" onClick={() => (view?.kind === 'grid' ? addRow() : openRowFull(addRow()))}>
            <Plus size={14} /> <span className="lbl">New row</span>
          </button>
        )}

        {view && (
          <>
            <Popover anchor={refs.filter} open={pop === 'filter'} onClose={() => setPop(null)} width={460} title="Filter">
              <FilterEditor table={t} filters={filters} mode={view.filterMode ?? 'and'} users={p.users} onChange={setFilters} onMode={(m) => patchView({ filterMode: m })} />
            </Popover>
            <Popover anchor={refs.sort} open={pop === 'sort'} onClose={() => setPop(null)} width={400} title="Sort">
              <SortEditor table={t} sorts={sorts} onChange={(s) => patchView({ sorts: s, sort: undefined })} />
            </Popover>
            <Popover anchor={refs.group} open={pop === 'group'} onClose={() => setPop(null)} width={260} title="Group by">
              <div className="tb-menu">
                <p className="muted small tb-menu-note">Rows gather under a heading for each value, with a count, and fold open and shut.</p>
                <button type="button" className={!view.groupBy ? 'on' : ''} onClick={() => (patchView({ groupBy: undefined }), setPop(null))}>
                  No grouping
                </button>
                {t.fields.filter((f) => !['button', 'files', 'longtext', 'link'].includes(f.type)).map((f) => {
                  const I = fieldIcon(f.type);
                  return (
                    <button key={f.id} type="button" className={view.groupBy === f.id ? 'on' : ''} onClick={() => (patchView({ groupBy: f.id, collapsed: [] }), setPop(null))}>
                      <I size={14} /> {f.name}
                    </button>
                  );
                })}
              </div>
            </Popover>
            <Popover anchor={refs.fields} open={pop === 'fields'} onClose={() => setPop(null)} width={280} title="Fields in this view">
              <FieldsEditor t={t} view={view} onView={patchView} />
            </Popover>
          </>
        )}
      </div>

      <div className={`fold ${selected.size ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="tb-bulk">
            <strong>{selected.size} selected</strong>
            <button className="ghost-btn sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button className="ghost-btn sm danger" onClick={() => confirm(`Delete ${selected.size} row${selected.size === 1 ? '' : 's'}?`) && deleteRows([...selected])}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      </div>

      {!g && tip && view?.kind === 'grid' && (
        <div className="tb-tip">
          <span>Click a column’s name to rename it, change its type, sort, filter or hide it. Drag columns and rows to move them. Click a cell once to choose it, again to edit; copy and paste blocks of cells, even from a spreadsheet.</span>
          <button className="icon-btn sm" onClick={() => setTip(false)} aria-label="Got it">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="tb-body">
        <TabPane key={view?.id ?? 'none'}>
          {!view ? null : view.kind === 'board' ? (
            <BoardView table={t} view={view} rows={shown} ctx={ctx} onCell={setCell} onOpenRow={(id) => openRowFull(id)} onAddRow={(v) => openRowFull(addRow(v))} onView={patchView} onNewField={(f) => saveField(f)} readOnly={!!g && !g.add && !t.fields.some((f) => g.canEdit(f.id))} canAdd={canAdd} />
          ) : view.kind === 'list' ? (
            <ListView table={t} view={view} rows={shown} ctx={ctx} onOpenRow={(id) => openRowFull(id)} onView={patchView} />
          ) : view.kind === 'gallery' ? (
            <GalleryView table={t} view={view} rows={shown} ctx={ctx} onOpenRow={(id) => openRowFull(id)} onAddRow={canAdd ? () => openRowFull(addRow()) : undefined} />
          ) : view.kind === 'calendar' ? (
            <CalendarView table={t} view={view} rows={shown} ctx={ctx} onOpenRow={(id) => openRowFull(id)} onCell={setCell} onAddRow={canAdd ? (values) => openRowFull(addRow(values)) : undefined} onView={patchView} onNewField={(f) => saveField(f)} readOnly={!!g} />
          ) : (
            <GridView
              locked={!!g}
              canAdd={canAdd}
              channels={p.channels}
              table={t}
              tables={p.tables}
              view={view}
              rows={shown}
              ctx={ctx}
              selected={selected}
              onSelect={setSelected}
              onCell={setCell}
              onOpenRow={(id, f) => openRowFull(id, f)}
              onAddRow={(v) => addRow(v)}
              onSaveField={saveField}
              onDeleteField={deleteField}
              onDuplicateField={duplicateField}
              onView={patchView}
              onFilterBy={filterBy}
              onMoveRow={moveRow}
              onRowMenu={(rowId, at) => setRowMenu({ rowId, ...at })}
              onPaste={paste}
              onClear={clearCells}
              toast={(text) => p.toast({ text })}
            />
          )}
          {view && !shown.length && (mine.length ? <p className="muted small tb-none">No rows match {q.trim() ? 'the search' : 'the filters'}.</p> : view.kind === 'board' || view.kind === 'calendar' ? null : <p className="muted small tb-none">No rows yet. Add one, paste from a spreadsheet, or they’ll arrive from a form or import.</p>)}
        </TabPane>
      </div>

      {/* The row menu: right-click a row, or its ⋯. */}
      <span ref={rowMenuAnchor} className="tb-menu-anchor" style={rowMenu ? { left: rowMenu.x, top: rowMenu.y } : undefined} aria-hidden />
      <Popover anchor={rowMenuAnchor} open={!!menuRow} onClose={() => setRowMenu(null)} width={220} title={menuRow ? rowName(t, menuRow) : 'Row'}>
        {menuRow && (
          <div className="tb-menu">
            <button type="button" onClick={() => (setRowMenu(null), openRowFull(menuRow.id))}>
              <PanelRight size={14} /> Open
            </button>
            <button type="button" onClick={() => (setRowMenu(null), openRowFull(menuRow.id, true))}>
              <Maximize2 size={14} /> Open as a page
            </button>
            {canAdd && (
              <>
                <button type="button" onClick={() => (setRowMenu(null), addRow({}, { rowId: menuRow.id, after: false }))}>
                  <Plus size={14} /> Insert a row above
                </button>
                <button type="button" onClick={() => (setRowMenu(null), addRow({}, { rowId: menuRow.id, after: true }))}>
                  <Plus size={14} /> Insert a row below
                </button>
                <button type="button" onClick={() => (setRowMenu(null), duplicate(menuRow.id))}>
                  <CopyPlus size={14} /> Duplicate
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                const text = viewFields(t, view!).map((f) => `${f.name}: ${cellText(f, menuRow.values[f.id] ?? null, textCtx)}`).filter((l) => !l.endsWith(': ')).join('\n');
                void navigator.clipboard?.writeText(text);
                setRowMenu(null);
                p.toast({ text: 'Row copied as text' });
              }}
            >
              <Copy size={14} /> Copy as text
            </button>
            {!g && (
              <button type="button" className="danger" onClick={() => (setRowMenu(null), deleteRows([menuRow.id]))}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        )}
      </Popover>

      {importing && <ImportDialog table={t} rows={mine} users={p.users} onImport={importPlan} onClose={() => setImporting(false)} />}
      {sharing && <ShareTableDialog t={t} onSave={(share) => (patchTable({ share }), setSharing(false), p.toast({ text: share.enabled ? 'Shared with the project’s guests' : 'No longer shared' }))} onClose={() => setSharing(false)} />}
      {autoOpen && <AutomationsPanel t={t} tables={p.tables} users={p.users} channels={p.channels} onPatch={patchTable} onClose={() => setAutoOpen(false)} toast={(text) => p.toast({ text })} />}
      {asking && (
        <AskDialog
          table={t}
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
          table={t}
          row={openRow}
          ctx={ctx}
          me={p.me}
          full={full}
          onToggleFull={() => setFull((x) => !x)}
          onCell={(fieldId, v) => setCell(openRow.id, fieldId, v)}
          onComment={(text) => comment(openRow.id, text)}
          onDelete={() => deleteRows([openRow.id])}
          onDuplicate={() => {
            const id = duplicate(openRow.id);
            if (id) p.setOpenRow(id);
          }}
          onClose={() => (p.setOpenRow(null), setFull(false))}
          onOpenRow={(tableId, rowId) => p.onOpenTable(tableId, rowId)}
          guest={!!g}
        />
      )}
    </section>
  );
}

/* ---------- the view's own settings (under its tab) ---------- */

function ViewSettings({ t, view, onView, onNewField }: { t: DataTable; view: TableViewDef; onView: (p: Partial<TableViewDef>) => void; onNewField: (f: TableField) => void }) {
  if (view.kind === 'board') {
    const selects = t.fields.filter((f) => f.type === 'select');
    return (
      <div className="tb-view-set">
        <span className="tb-fm-label">Columns from</span>
        <PickSelect value={view.groupBy ?? selects[0]?.id ?? ''} aria-label="Columns from" onChange={(e) => (e.target.value === '__new' ? newChoiceField(t, onNewField, onView) : onView({ groupBy: e.target.value }))}>
          {selects.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          <option value="__new">+ New choice field…</option>
        </PickSelect>
        <p className="muted small">A board makes one column for each choice of a single-choice field.</p>
      </div>
    );
  }
  if (view.kind === 'calendar') {
    const dates = t.fields.filter((f) => f.type === 'date' || f.type === 'created' || f.type === 'edited');
    return (
      <div className="tb-view-set">
        <span className="tb-fm-label">Dates from</span>
        <PickSelect value={view.dateField ?? dates[0]?.id ?? ''} aria-label="Dates from" onChange={(e) => onView({ dateField: e.target.value })}>
          {dates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </PickSelect>
      </div>
    );
  }
  if (view.kind === 'gallery') {
    const files = t.fields.filter((f) => f.type === 'files');
    return (
      <div className="tb-view-set">
        <span className="tb-fm-label">Card picture from</span>
        <PickSelect value={view.cover ?? ''} aria-label="Card picture" onChange={(e) => onView({ cover: e.target.value || undefined })}>
          <option value="">No picture</option>
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

/* ---------- toolbar editors ---------- */

/** Sort by a field, then by another: each with words that fit it (A to Z, low to high, oldest first). */
function SortEditor({ table, sorts, onChange }: { table: DataTable; sorts: { fieldId: string; dir: 'asc' | 'desc' }[]; onChange: (s: { fieldId: string; dir: 'asc' | 'desc' }[]) => void }) {
  const sortable = table.fields.filter((f) => f.type !== 'button' && f.type !== 'files');
  const set = (i: number, p: Partial<{ fieldId: string; dir: 'asc' | 'desc' }>) => onChange(sorts.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="tb-filters">
      {!sorts.length && <p className="muted small">Rows are in your own order (drag them in the table). Sort to order them by a field instead.</p>}
      {sorts.map((s, i) => {
        const f = table.fields.find((x) => x.id === s.fieldId) ?? sortable[0];
        const [asc, desc] = sortWords(f.type);
        return (
          <div key={i} className="tb-filter">
            <span className="tb-filter-lead">{i === 0 ? 'Sort by' : 'then by'}</span>
            <PickSelect value={f.id} aria-label="Field" onChange={(e) => set(i, { fieldId: e.target.value })}>
              {sortable.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </PickSelect>
            <PickSelect value={s.dir} aria-label="Direction" onChange={(e) => set(i, { dir: e.target.value as 'asc' | 'desc' })}>
              <option value="asc">{asc}</option>
              <option value="desc">{desc}</option>
            </PickSelect>
            <button type="button" className="icon-btn sm" aria-label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
              <X size={13} />
            </button>
          </div>
        );
      })}
      <div className="tb-filters-foot">
        <button type="button" className="link-btn small" onClick={() => onChange([...sorts, { fieldId: (sortable.find((f) => !sorts.some((s) => s.fieldId === f.id)) ?? sortable[0]).id, dir: 'asc' }])}>
          <Plus size={13} /> {sorts.length ? 'Then by…' : 'Add a sort'}
        </button>
        {sorts.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => onChange([])}>
            Back to your own order
          </button>
        )}
      </div>
    </div>
  );
}

/** Where [field] [is] [value]: all of these, or any of them. Values come from the field's own choices and people. */
function FilterEditor({ table, filters, mode, users, onChange, onMode }: { table: DataTable; filters: TableFilter[]; mode: 'and' | 'or'; users: User[]; onChange: (f: TableFilter[]) => void; onMode: (m: 'and' | 'or') => void }) {
  const usable = table.fields.filter((f) => f.type !== 'button');
  const set = (i: number, p: Partial<TableFilter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const add = () => {
    const f = usable.find((x) => x.type === 'select') ?? usable[0];
    onChange([...filters, { fieldId: f.id, op: opsFor(f.type)[0].op }]);
  };
  return (
    <div className="tb-filters">
      {!filters.length && <p className="muted small">Show only the rows you want: Status is New, Follow-up before today, Owner is you.</p>}
      {filters.length > 1 && (
        <div className="segmented sm tb-filter-mode">
          <button type="button" className={mode === 'and' ? 'on' : ''} onClick={() => onMode('and')}>
            All of these
          </button>
          <button type="button" className={mode === 'or' ? 'on' : ''} onClick={() => onMode('or')}>
            Any of these
          </button>
        </div>
      )}
      {filters.map((flt, i) => {
        const f = table.fields.find((x) => x.id === flt.fieldId) ?? usable[0];
        const needsValue = flt.op !== 'empty' && flt.op !== 'filled';
        const isDate = f.type === 'date' || f.type === 'created' || f.type === 'edited';
        return (
          <div key={i} className="tb-filter">
            <span className="tb-filter-lead">{i === 0 ? 'Where' : mode === 'and' ? 'and' : 'or'}</span>
            <PickSelect
              value={f.id}
              aria-label="Field"
              onChange={(e) => {
                const nf = table.fields.find((x) => x.id === e.target.value)!;
                set(i, { fieldId: nf.id, op: opsFor(nf.type)[0].op, value: undefined });
              }}
            >
              {usable.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </PickSelect>
            <PickSelect value={flt.op} aria-label="Test" onChange={(e) => set(i, { op: e.target.value as TableFilter['op'] })}>
              {opsFor(f.type).map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </PickSelect>
            {needsValue &&
              (f.type === 'select' || f.type === 'multi' ? (
                <PickSelect value={flt.value ?? ''} aria-label="Value" onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </PickSelect>
              ) : f.type === 'person' || f.type === 'creator' ? (
                <PickSelect value={flt.value ?? ''} aria-label="Person" searchable onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">Choose someone…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </PickSelect>
              ) : f.type === 'checkbox' ? (
                <PickSelect value={flt.value ?? 'yes'} aria-label="Value" onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="yes">Checked</option>
                  <option value="no">Not checked</option>
                </PickSelect>
              ) : isDate ? (
                <span className="tb-filter-date">
                  <button type="button" className={`tb-chip linked${flt.value === '@today' ? ' on' : ''}`} onClick={() => set(i, { value: '@today' })}>
                    Today
                  </button>
                  <DatePicker value={flt.value && flt.value !== '@today' ? flt.value : ''} onChange={(d) => set(i, { value: d })} label="Date" placeholder="A date" className="sel-flat" />
                </span>
              ) : (
                <input className="tb-native" type={['number', 'money', 'rating', 'rollup'].includes(f.type) ? 'number' : 'text'} value={flt.value ?? ''} placeholder="Value" aria-label="Value" onChange={(e) => set(i, { value: e.target.value })} />
              ))}
            <button type="button" className="icon-btn sm tb-filter-x" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))}>
              <X size={13} />
            </button>
          </div>
        );
      })}
      <div className="tb-filters-foot">
        <button type="button" className="link-btn small" onClick={add}>
          <Plus size={13} /> Add a condition
        </button>
        {filters.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

/** Fields in this view: show or hide each, and drag them into the order you want. */
function FieldsEditor({ t, view, onView }: { t: DataTable; view: TableViewDef; onView: (p: Partial<TableViewDef>) => void }) {
  const all = viewFields(t, view, true);
  const hidden = new Set(view.hidden ?? []);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = (target: string) => {
    if (!drag || drag === target) return (setDrag(null), setOver(null));
    const rest = all.slice(1).map((f) => f.id).filter((x) => x !== drag);
    rest.splice(rest.indexOf(target) < 0 ? 0 : rest.indexOf(target), 0, drag);
    onView({ order: rest });
    setDrag(null);
    setOver(null);
  };
  return (
    <div className="tab-edit-list">
      <p className="muted small">What this view shows, in this order. Drag to reorder.</p>
      {all.map((f, i) => {
        const I = fieldIcon(f.type);
        return (
          <div
            key={f.id}
            className={`tab-edit-row${hidden.has(f.id) ? ' off' : ''}${over === f.id && drag !== f.id ? ' drop-line' : ''}`}
            draggable={i > 0}
            onDragStart={() => setDrag(f.id)}
            onDragOver={(e) => (e.preventDefault(), i > 0 && setOver(f.id))}
            onDrop={() => drop(f.id)}
            onDragEnd={() => (setDrag(null), setOver(null))}
          >
            {i > 0 ? <GripVertical size={14} className="muted tb-drag" /> : <span style={{ width: 14 }} />}
            <I size={13} className="muted" />
            <span className="tab-edit-name">{f.name}</span>
            {i > 0 ? (
              <button type="button" className="icon-btn sm" onClick={() => onView({ hidden: hidden.has(f.id) ? [...hidden].filter((x) => x !== f.id) : [...hidden, f.id] })} aria-label={hidden.has(f.id) ? `Show ${f.name}` : `Hide ${f.name}`}>
                {hidden.has(f.id) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            ) : (
              <small className="muted">always</small>
            )}
          </div>
        );
      })}
      <div className="tab-edit-foot">
        <button type="button" className="link-btn small" onClick={() => onView({ hidden: [] })}>
          Show all
        </button>
        <button type="button" className="link-btn small" onClick={() => onView({ hidden: all.slice(1).map((f) => f.id) })}>
          Hide all
        </button>
      </div>
    </div>
  );
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
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
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
            Cancel
          </button>
          <button className="primary-btn" onClick={() => onRun(draft)}>
            {f.button?.label || 'Run'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** What a project's guests get of this table: they see some fields, change fewer, press chosen buttons. */
function ShareTableDialog({ t, onSave, onClose }: { t: DataTable; onSave: (s: NonNullable<DataTable['share']>) => void; onClose: () => void }) {
  const [s, setS] = useState<NonNullable<DataTable['share']>>(
    () => t.share ?? { enabled: true, fields: t.fields.filter((f, i) => i > 0 && !['button', 'link', 'longtext'].includes(f.type)).map((f) => f.id), edit: [], buttons: [], add: false, download: true },
  );
  const toggle = (key: 'fields' | 'edit' | 'buttons', id: string, on: boolean) =>
    setS((x) => {
      const next = { ...x, [key]: on ? [...x[key], id] : x[key].filter((y) => y !== id) };
      if (key === 'fields' && !on) next.edit = next.edit.filter((y) => y !== id); // can't change what they can't see
      if (key === 'edit' && on && !next.fields.includes(id)) next.fields = [...next.fields, id];
      return next;
    });
  const first = t.fields[0];
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-share" role="dialog" aria-label="Share with guests" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Users size={15} /> Share {t.name} with guests
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <label className="check-row tb-share-on">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            <span>
              <strong>Guests on this {term.one} can open this table</strong>
              <small className="muted">It shows in their shared space. Rules, webhook addresses and the team’s notes on rows stay hidden.</small>
            </span>
          </label>
          <div className={`fold ${s.enabled ? 'open' : ''}`}>
            <div className="fold-in">
              <div className="tb-share-grid">
                <span />
                <small className="muted">Sees</small>
                <small className="muted">Can change</small>
                <span className="tb-share-name">{first.name}</span>
                <input type="checkbox" checked disabled aria-label={`${first.name} is always seen`} />
                <input type="checkbox" checked={s.edit.includes(first.id)} onChange={(e) => toggle('edit', first.id, e.target.checked)} aria-label={`Guests can change ${first.name}`} />
                {t.fields.slice(1).filter((f) => f.type !== 'link').map((f) =>
                  f.type === 'button' ? (
                    <div key={f.id} className="contents">
                      <span className="tb-share-name">{f.button?.label ?? f.name} <small className="muted">button</small></span>
                      <input type="checkbox" checked={s.buttons.includes(f.id)} onChange={(e) => toggle('buttons', f.id, e.target.checked)} aria-label={`Guests can press ${f.name}`} />
                      <span />
                    </div>
                  ) : (
                    <div key={f.id} className="contents">
                      <span className="tb-share-name">{f.name}</span>
                      <input type="checkbox" checked={s.fields.includes(f.id)} onChange={(e) => toggle('fields', f.id, e.target.checked)} aria-label={`Guests see ${f.name}`} />
                      <input type="checkbox" checked={s.edit.includes(f.id)} onChange={(e) => toggle('edit', f.id, e.target.checked)} aria-label={`Guests can change ${f.name}`} />
                    </div>
                  ),
                )}
              </div>
              <label className="check-row">
                <input type="checkbox" checked={!!s.add} onChange={(e) => setS({ ...s, add: e.target.checked })} /> They can add rows
              </label>
              <label className="check-row">
                <input type="checkbox" checked={!!s.download} onChange={(e) => setS({ ...s, download: e.target.checked })} /> They can download it as CSV
              </label>
            </div>
          </div>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => onSave(s)}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
