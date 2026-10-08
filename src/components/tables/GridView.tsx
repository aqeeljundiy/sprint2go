import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Maximize2, MoreHorizontal, Plus } from 'lucide-react';
import type { CalcKind, CellValue, Channel, DataTable, TableField, TableRow, TableViewDef } from '../../types';
import { ButtonCell, CellView, ContactActions, FilesPopover, InlineInput, PickPopover, RatingInput, TextPopover, typesInline, type CellCtx } from './Cell';
import { ColumnMenu, type ColumnAction } from './ColumnMenu';
import { FieldMenu } from './FieldMenu';
import { CALCS, calc, cellText, fieldIcon, groupRows, isComputed, isNumeric, sortsOf, valueOf, viewFields, type RowGroup } from './fields';
import { DatePicker } from '../ui/DatePicker';
import { Popover } from '../ui/Popover';

const DEFAULT_W: Partial<Record<TableField['type'], number>> = { button: 150, text: 200, longtext: 240, email: 210, phone: 180, url: 190, checkbox: 90, number: 120, money: 150, date: 130, person: 170, select: 150, multi: 200, link: 200, files: 160, rating: 130, formula: 160, rollup: 140, created: 170, edited: 170, creator: 160 };
const widthOf = (view: TableViewDef, f: TableField, first: boolean) => view.widths?.[f.id] ?? (first ? 240 : DEFAULT_W[f.type] ?? 160);
const SEL_W = 56;

export interface GridProps {
  table: DataTable;
  tables: DataTable[];
  view: TableViewDef;
  rows: TableRow[];
  ctx: CellCtx;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onCell: (rowId: string, fieldId: string, v: CellValue) => void;
  onOpenRow: (id: string, full?: boolean) => void;
  onAddRow: (values?: Record<string, CellValue>) => void;
  focusRowId?: string | null; // a row just added: scroll to it and start typing its name
  onFocused?: () => void;
  onSaveField: (f: TableField, at?: number) => void; // at: insert at this view position
  onDeleteField: (id: string) => void;
  onDuplicateField: (id: string) => void;
  onMakeName: (id: string) => void; // this column becomes each row's name
  onView: (p: Partial<TableViewDef>) => void;
  onFilterBy: (fieldId: string) => void;
  onMoveRow: (id: string, targetId: string, after: boolean, groupValue?: { fieldId: string; value: CellValue }) => void;
  onRowMenu: (rowId: string, at: { x: number; y: number }) => void;
  onPaste: (startRow: number, startField: number, grid: string[][], fields: TableField[], rows: TableRow[]) => void;
  onClear: (cells: { rowId: string; fieldId: string }[]) => void;
  readOnly?: boolean;
  locked?: boolean; // guests: no field settings, no selecting rows, no new fields
  fixedColumns?: boolean; // Members without "Change how tables work": rows yes, columns no
  canAdd?: boolean;
  channels?: Channel[];
  toast?: (t: string) => void;
}

type Pos = { r: number; c: number };
const key = (rowId: string, fieldId: string) => `${rowId}:${fieldId}`;

/** One cell. Shows the value; the grid tells it when to edit (typing, a picker, the date picker, stars). */
function GridCell({ t, f, row, ctx, onCell, readOnly, active, inRange, editing, initial, onActivate, onEdit, onDone, wrap }: {
  t: DataTable;
  f: TableField;
  row: TableRow;
  ctx: CellCtx;
  onCell: GridProps['onCell'];
  readOnly?: boolean;
  active: boolean;
  inRange: boolean;
  editing: boolean;
  initial?: string;
  onActivate: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onDone: (move?: 'down' | 'right' | 'left') => void;
  wrap: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const v = valueOf(t, f, row, ctx);
  const save = (x: CellValue) => onCell(row.id, f.id, x);
  const ro = readOnly || isComputed(f);
  useEffect(() => {
    if (active && !editing) ref.current?.focus({ preventScroll: true });
  }, [active, editing]);
  if (f.type === 'button')
    return (
      <div className={`tb-cell t-button${active ? ' active' : ''}`} role="gridcell" data-cell={key(row.id, f.id)} onMouseDown={onActivate}>
        <ButtonCell f={f} row={row} ctx={ctx} />
      </div>
    );
  const inline = editing && !ro && typesInline(f.type);
  return (
    <div
      ref={ref}
      className={`tb-cell t-${f.type}${active ? ' active' : ''}${inRange ? ' in-range' : ''}${editing ? ' editing' : ''}${wrap ? ' wrap' : ''}${ro ? ' ro' : ''}`}
      role="gridcell"
      tabIndex={active ? 0 : -1}
      data-cell={key(row.id, f.id)}
      onMouseDown={(e) => !editing && e.currentTarget.contains(e.target as Node) && onActivate(e)}
      // A click on the cell you're already on edits it; a checkbox changes at once.
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target as Node) || ro || editing) return;
        if (f.type === 'checkbox') return save(!v);
        if (active && f.type !== 'rating') onEdit();
      }}
      onDoubleClick={() => !ro && f.type !== 'checkbox' && f.type !== 'rating' && onEdit()}
    >
      {inline ? (
        <InlineInput f={f} v={v} initial={initial} onSave={save} onDone={onDone} />
      ) : f.type === 'rating' && !ro ? (
        <RatingInput v={v} max={f.max ?? 5} onSave={save} />
      ) : (
        <>
          <CellView f={f} v={v} ctx={ctx} wrap={wrap} />
          <ContactActions f={f} v={v} />
        </>
      )}
      {!ro && (f.type === 'select' || f.type === 'multi' || f.type === 'person' || f.type === 'link') && <PickPopover f={f} v={v} ctx={ctx} anchor={ref} open={editing} onClose={() => onDone()} onSave={save} />}
      {!ro && f.type === 'longtext' && <TextPopover v={v} anchor={ref} open={editing} onClose={() => onDone()} onSave={save} title={f.name} />}
      {!ro && f.type === 'files' && <FilesPopover v={v} anchor={ref} open={editing} onClose={() => onDone()} onSave={save} title={f.name} />}
      {!ro && f.type === 'date' && editing && (
        <span className="tb-date-pick">
          <DatePicker value={typeof v === 'string' ? v : ''} onChange={(d) => save(d || null)} label={f.name} autoOpen onClosed={() => onDone()} compact />
        </span>
      )}
    </div>
  );
}

/** A column header: the field's name and kind, a ⌄ for its menu, drag to move, drag the edge to resize. */
function Header({ f, i, count, p, sticky, onDragStart, onDragOver, dropSide, dragging }: {
  f: TableField;
  i: number;
  count: number;
  p: GridProps;
  sticky?: number;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  dropSide: 'before' | 'after' | null;
  dragging: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inserting, setInserting] = useState<number | null>(null);
  const view = p.view;
  const Icon = fieldIcon(f.type);
  const sort = sortsOf(view).find((x) => x.fieldId === f.id);
  const ro = p.readOnly || p.locked;
  const first = f.id === p.table.fields[0]?.id; // the row's name: can move, can't be hidden or deleted
  const pinnedN = view.pinned ?? 0;
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(view, f, first);
    const grid = (e.currentTarget as HTMLElement).closest('.tb-grid') as HTMLElement;
    const base = getComputedStyle(grid).getPropertyValue('--cols').trim().split(/\s+/);
    const move = (ev: PointerEvent) => {
      const w = Math.max(80, Math.min(640, startW + ev.clientX - startX));
      const cols = [...base];
      cols[i + 1] = `${w}px`;
      grid.style.setProperty('--cols', cols.join(' '));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      grid.style.removeProperty('--cols');
      const w = Math.max(80, Math.min(640, startW + ev.clientX - startX));
      if (w !== startW) p.onView({ widths: { ...view.widths, [f.id]: w } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const moveBy = (d: -1 | 1) => {
    const order = viewFields(p.table, view, true).map((x) => x.id);
    const visible = viewFields(p.table, view).map((x) => x.id);
    const swap = visible[i + d];
    if (!swap) return;
    const a = order.indexOf(f.id), b = order.indexOf(swap);
    [order[a], order[b]] = [order[b], order[a]];
    p.onView({ order });
  };
  const action = (a: ColumnAction) => {
    if (a === 'edit') return setEditing(true);
    if (a === 'asc' || a === 'desc') return p.onView({ sorts: [{ fieldId: f.id, dir: a }], sort: undefined });
    if (a === 'filter') return p.onFilterBy(f.id);
    if (a === 'group') return p.onView({ groupBy: view.groupBy === f.id ? undefined : f.id });
    if (a === 'wrap') return p.onView({ wrap: view.wrap?.includes(f.id) ? view.wrap.filter((x) => x !== f.id) : [...(view.wrap ?? []), f.id] });
    if (a === 'pin') return p.onView({ pinned: i + 1 });
    if (a === 'unpin') return p.onView({ pinned: 0 });
    if (a === 'primary') return p.onMakeName(f.id);
    if (a === 'hide') return p.onView({ hidden: [...(view.hidden ?? []), f.id] });
    if (a === 'insertLeft') return setInserting(i);
    if (a === 'insertRight') return setInserting(i + 1);
    if (a === 'left') return moveBy(-1);
    if (a === 'right') return moveBy(1);
    if (a === 'duplicate') return p.onDuplicateField(f.id);
    if (a === 'delete') return p.onDeleteField(f.id);
  };
  return (
    <div
      className={`tb-th${i < pinnedN ? ' tb-pinned' : ''}${dragging ? ' col-dragging' : ''}${dropSide ? ` drop-${dropSide}` : ''}`}
      style={sticky !== undefined ? { left: sticky } : undefined}
      role="columnheader"
      draggable={!ro}
      onDragStart={(e) => (e.dataTransfer.setData('text/plain', f.id), (e.dataTransfer.effectAllowed = 'move'), onDragStart())}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(e.clientX > r.left + r.width / 2);
      }}
    >
      <button ref={ref} type="button" className="tb-th-btn" onClick={() => !ro && (menu || editing ? (setMenu(false), setEditing(false)) : setMenu(true))} title={f.description || (ro ? f.name : `${f.name}: click for options, drag to move`)}>
        <Icon size={13} />
        <span>{f.name}</span>
        {first && <span className="tb-name-tag" title="Each row’s name. Another column can take this role from its menu.">Title</span>}
        {sort?.dir === 'asc' && <ArrowDown size={12} className="tb-sorted" />}
        {sort?.dir === 'desc' && <ArrowUp size={12} className="tb-sorted" />}
        {!ro && <ChevronDown size={13} className="tb-th-chev" />}
      </button>
      {!ro && <span className="tb-resize" onPointerDown={resize} aria-hidden />}
      {!ro && (
        <>
          <ColumnMenu
            anchor={ref}
            open={menu}
            onClose={() => setMenu(false)}
            field={f}
            first={first}
            last={i === count - 1}
            leftmost={i === 0}
            wrapped={!!view.wrap?.includes(f.id)}
            pinned={i < pinnedN}
            grouped={view.groupBy === f.id}
            fixed={p.fixedColumns}
            onRename={(name) => p.onSaveField({ ...f, name })}
            onDescribe={(description) => p.onSaveField({ ...f, description: description || undefined })}
            onAction={action}
          />
          <FieldMenu anchor={ref} open={editing} onClose={() => setEditing(false)} field={f} table={p.table} tables={p.tables} isFirst={first} onSave={(nf) => p.onSaveField(nf)} users={p.ctx.users} channels={p.channels} rows={p.ctx.rows} previewCtx={p.ctx} />
          <FieldMenu anchor={ref} open={inserting !== null} onClose={() => setInserting(null)} field={null} table={p.table} tables={p.tables} onSave={(nf) => p.onSaveField(nf, inserting ?? undefined)} users={p.ctx.users} channels={p.channels} rows={p.ctx.rows} previewCtx={p.ctx} />
        </>
      )}
    </div>
  );
}

/** A total under a column: click to choose count, sum, average and so on. */
function FootCell({ f, p, rows, sticky }: { f: TableField; p: GridProps; rows: TableRow[]; sticky?: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const kind = p.view.calcs?.[f.id];
  const set = (k: CalcKind | null) => {
    const calcs = { ...(p.view.calcs ?? {}) };
    if (k) calcs[f.id] = k;
    else delete calcs[f.id];
    p.onView({ calcs });
    setOpen(false);
  };
  const style = sticky !== undefined ? { left: sticky } : undefined;
  if (f.type === 'button') return <div className={`tb-foot-cell${sticky !== undefined ? ' tb-pinned' : ''}`} style={style} />;
  return (
    <div className={`tb-foot-cell${sticky !== undefined ? ' tb-pinned' : ''}`} style={style}>
      <button ref={ref} type="button" className={kind ? 'on' : ''} onClick={() => !p.readOnly && setOpen(true)} disabled={p.readOnly}>
        {kind ? (
          <>
            <small>{CALCS.find((c) => c.kind === kind)?.label}</small> {calc(kind, p.table, f, rows, p.ctx)}
          </>
        ) : (
          <small className="tb-foot-add">Calculate</small>
        )}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={200} title={`${f.name}: total`}>
        <div className="tb-menu">
          <button type="button" className={!kind ? 'on' : ''} onClick={() => set(null)}>
            None
          </button>
          {CALCS.filter((c) => !c.numeric || isNumeric(f)).map((c) => (
            <button key={c.kind} type="button" className={kind === c.kind ? 'on' : ''} onClick={() => set(c.kind)}>
              {c.label}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/**
 * The spreadsheet, Notion-style: click a cell to choose it, click again (or type, or Enter) to edit, arrows and Tab
 * to move, copy and paste blocks of cells (from Excel or Sheets too), drag columns and rows, a ⌄ menu on every
 * column, groups, and totals under each column.
 */
export function GridView(p: GridProps) {
  const { table: t, view } = p;
  const fields = useMemo(() => viewFields(t, view), [t, view]);
  const pinnedN = Math.min(view.pinned ?? 0, fields.length);
  const nameId = t.fields[0]?.id;
  const widths = fields.map((f) => widthOf(view, f, f.id === nameId));
  const cols = `${SEL_W}px ${widths.map((w) => `${w}px`).join(' ')} 48px`;
  const stickyLeft = (i: number) => (i < pinnedN ? SEL_W + widths.slice(0, i).reduce((a, b) => a + b, 0) : undefined);

  const groupField = view.groupBy ? t.fields.find((f) => f.id === view.groupBy) : undefined;
  const groups: RowGroup[] = useMemo(() => (groupField ? groupRows(t, groupField, p.rows, p.ctx) : [{ key: '*', label: '', value: null, rows: p.rows }]), [groupField, t, p.rows, p.ctx]);
  const collapsed = new Set(view.collapsed ?? []);
  const flat = groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows)); // rows in screen order, for the keyboard

  const [active, setActive] = useState<Pos | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null); // with shift: a range from here to active
  const [editing, setEditing] = useState<{ pos: Pos; initial?: string } | null>(null);
  const [colDrag, setColDrag] = useState<{ id: string; over?: { id: string; after: boolean } } | null>(null);
  const [rowDrag, setRowDrag] = useState<{ id: string; over?: { id: string; after: boolean } } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  // Keep the active cell inside the grid when rows or columns change.
  useEffect(() => {
    if (active && (active.r >= flat.length || active.c >= fields.length)) setActive(flat.length && fields.length ? { r: Math.min(active.r, flat.length - 1), c: Math.min(active.c, fields.length - 1) } : null);
  }, [flat.length, fields.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = active && anchor ? { r0: Math.min(active.r, anchor.r), r1: Math.max(active.r, anchor.r), c0: Math.min(active.c, anchor.c), c1: Math.max(active.c, anchor.c) } : null;
  const inRange = (r: number, c: number) => !!range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1 && (range.r0 !== range.r1 || range.c0 !== range.c1);
  const canEdit = (f: TableField) => !p.readOnly && !isComputed(f) && f.type !== 'button' && (!p.ctx.canEdit || p.ctx.canEdit(f.id));

  const moveTo = (r: number, c: number, extend = false) => {
    if (!flat.length || !fields.length) return;
    const pos = { r: Math.max(0, Math.min(flat.length - 1, r)), c: Math.max(0, Math.min(fields.length - 1, c)) };
    if (extend) setAnchor((a) => a ?? active);
    else setAnchor(null);
    setActive(pos);
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${key(flat[pos.r]?.id ?? '', fields[pos.c]?.id ?? '')}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };
  // A new row: bring it into view with its name ready to type. Hidden by a filter? Open its page instead.
  useEffect(() => {
    if (!p.focusRowId) return;
    const r = flat.findIndex((x) => x.id === p.focusRowId);
    const c = Math.max(0, fields.findIndex((f) => f.id === nameId));
    p.onFocused?.();
    if (r < 0) return p.onOpenRow(p.focusRowId);
    setActive({ r, c });
    setAnchor(null);
    setEditing({ pos: { r, c } });
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${key(p.focusRowId!, fields[c]?.id ?? '')}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [p.focusRowId]); // eslint-disable-line react-hooks/exhaustive-deps
  const startEdit = (pos: Pos, initial?: string) => {
    const f = fields[pos.c];
    if (!f || !canEdit(f) || f.type === 'checkbox' || f.type === 'rating') return;
    setActive(pos);
    setAnchor(null);
    setEditing({ pos, initial: typesInline(f.type) ? initial : undefined });
  };
  const doneEditing = (move?: 'down' | 'right' | 'left') => {
    const pos = editing?.pos ?? active;
    setEditing(null);
    if (!pos) return;
    if (move === 'down') moveTo(pos.r + 1, pos.c);
    else if (move === 'right') moveTo(pos.r, pos.c + 1);
    else if (move === 'left') moveTo(pos.r, pos.c - 1);
    else requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>('.tb-cell.active')?.focus({ preventScroll: true }));
  };

  const cellsText = () => {
    const r = range ?? (active ? { r0: active.r, r1: active.r, c0: active.c, c1: active.c } : null);
    if (!r) return '';
    const lines: string[] = [];
    for (let i = r.r0; i <= r.r1; i++) {
      const row = flat[i];
      const cells: string[] = [];
      for (let j = r.c0; j <= r.c1; j++) {
        const f = fields[j];
        const v = valueOf(t, f, row, p.ctx);
        const txt = f.type === 'number' || f.type === 'money' || f.type === 'date' ? (v == null ? '' : String(v)) : cellText(f, v, p.ctx);
        cells.push(/[\t\n"]/.test(txt) ? `"${txt.replace(/"/g, '""')}"` : txt);
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (editing || !active || (e.target as HTMLElement).closest('input, textarea, .pop')) return;
    const { r, c } = active;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown') (e.preventDefault(), moveTo(mod ? flat.length - 1 : r + 1, c, e.shiftKey));
    else if (e.key === 'ArrowUp') (e.preventDefault(), moveTo(mod ? 0 : r - 1, c, e.shiftKey));
    else if (e.key === 'ArrowRight') (e.preventDefault(), moveTo(r, mod ? fields.length - 1 : c + 1, e.shiftKey));
    else if (e.key === 'ArrowLeft') (e.preventDefault(), moveTo(r, mod ? 0 : c - 1, e.shiftKey));
    else if (e.key === 'Tab') (e.preventDefault(), moveTo(r, c + (e.shiftKey ? -1 : 1)));
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) p.onOpenRow(flat[r].id);
      else startEdit(active);
    } else if (e.key === 'Escape') (setAnchor(null), setActive(null));
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const rr = range ?? { r0: r, r1: r, c0: c, c1: c };
      const cells: { rowId: string; fieldId: string }[] = [];
      for (let i = rr.r0; i <= rr.r1; i++) for (let j = rr.c0; j <= rr.c1; j++) if (canEdit(fields[j])) cells.push({ rowId: flat[i].id, fieldId: fields[j].id });
      if (cells.length) p.onClear(cells);
    } else if (e.key === ' ' && fields[c]?.type === 'checkbox' && canEdit(fields[c])) {
      e.preventDefault();
      p.onCell(flat[r].id, fields[c].id, !valueOf(t, fields[c], flat[r], p.ctx));
    } else if (!mod && !e.altKey && e.key.length === 1 && canEdit(fields[c]) && typesInline(fields[c].type)) {
      e.preventDefault();
      startEdit(active, e.key); // typing replaces the cell, like a spreadsheet
    }
  };

  // Copy and paste blocks of cells, as tab-separated text (what Excel and Google Sheets use).
  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || !active || (e.target as HTMLElement).closest('input, textarea, .pop')) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', cellsText());
    p.toast?.(range ? `Copied ${(range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)} cells` : 'Copied');
  };
  const onPasteEv = (e: React.ClipboardEvent) => {
    if (editing || !active || (e.target as HTMLElement).closest('input, textarea, .pop') || p.readOnly) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    p.onPaste(active.r, active.c, parseTsv(text), fields, flat);
  };

  const selAll = flat.length > 0 && flat.every((r) => p.selected.has(r.id));
  const toggle = (id: string) => {
    const next = new Set(p.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    p.onSelect(next);
  };
  const rowsDraggable = !p.readOnly && !p.locked && !sortsOf(view).length;
  const indexOf = new Map(flat.map((r, i) => [r.id, i]));

  const renderRow = (row: TableRow, g: RowGroup) => {
    const ri = indexOf.get(row.id) ?? 0;
    const over = rowDrag?.over?.id === row.id && rowDrag.id !== row.id ? (rowDrag.over.after ? ' drop-after' : ' drop-before') : '';
    return (
      <div
        key={row.id}
        className={`tb-tr${p.selected.has(row.id) ? ' on' : ''}${rowDrag?.id === row.id ? ' row-dragging' : ''}${over}`}
        role="row"
        style={{ ['--i' as string]: Math.min(ri, 20) }}
        onContextMenu={(e) => !p.locked && !p.readOnly && (e.preventDefault(), p.onRowMenu(row.id, { x: e.clientX, y: e.clientY }))}
        onDragOver={(e) => {
          if (!rowDrag) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          if (rowDrag.over?.id !== row.id || rowDrag.over.after !== after) setRowDrag({ ...rowDrag, over: { id: row.id, after } });
        }}
        onDrop={(e) => {
          if (!rowDrag) return;
          e.preventDefault();
          if (rowDrag.id !== row.id && rowDrag.over) p.onMoveRow(rowDrag.id, row.id, rowDrag.over.after, groupField && !isComputed(groupField) ? { fieldId: groupField.id, value: g.value } : undefined);
          setRowDrag(null);
        }}
      >
        <div className="tb-sel sticky0">
          {rowsDraggable && (
            <span className="tb-grip" draggable onDragStart={(e) => (e.dataTransfer.setData('text/plain', row.id), (e.dataTransfer.effectAllowed = 'move'), setRowDrag({ id: row.id }))} onDragEnd={() => setRowDrag(null)} title="Drag to move">
              <GripVertical size={13} />
            </span>
          )}
          {!p.readOnly && !p.locked && <input type="checkbox" aria-label="Select row" checked={p.selected.has(row.id)} onChange={() => toggle(row.id)} />}
          <span className="tb-n">{ri + 1}</span>
        </div>
        {fields.map((f, ci) => {
          const cell = (
            <GridCell
              key={f.id}
              t={t}
              f={f}
              row={row}
              ctx={p.ctx}
              onCell={p.onCell}
              readOnly={!canEdit(f)}
              active={active?.r === ri && active?.c === ci}
              inRange={inRange(ri, ci)}
              editing={editing?.pos.r === ri && editing?.pos.c === ci}
              initial={editing?.pos.r === ri && editing?.pos.c === ci ? editing.initial : undefined}
              onActivate={(e) => {
                if (e.shiftKey && active) {
                  setAnchor((a) => a ?? active);
                  setActive({ r: ri, c: ci });
                } else {
                  setAnchor(null);
                  setActive({ r: ri, c: ci });
                }
              }}
              onEdit={() => startEdit({ r: ri, c: ci })}
              onDone={doneEditing}
              wrap={!!view.wrap?.includes(f.id)}
            />
          );
          if (f.id === nameId)
            return (
              <div key={f.id} className={`tb-first${ci < pinnedN ? ' tb-pinned' : ''}`} style={ci < pinnedN ? { left: stickyLeft(ci) } : undefined}>
                {cell}
                <button type="button" className="tb-expand" onClick={() => p.onOpenRow(row.id)} title="Open (Shift+Enter)" aria-label="Open row">
                  <Maximize2 size={13} />
                </button>
                {!p.locked && !p.readOnly && (
                  <button type="button" className="tb-expand" onClick={(e) => p.onRowMenu(row.id, { x: e.clientX, y: e.clientY })} title="More" aria-label="Row options">
                    <MoreHorizontal size={13} />
                  </button>
                )}
              </div>
            );
          return ci < pinnedN ? (
            <div key={f.id} className="tb-pin-wrap tb-pinned" style={{ left: stickyLeft(ci) }}>
              {cell}
            </div>
          ) : (
            cell
          );
        })}
        <div />
      </div>
    );
  };

  const colDrop = () => {
    if (!colDrag?.over || colDrag.id === colDrag.over.id) return setColDrag(null);
    const order = viewFields(t, view, true).map((x) => x.id).filter((x) => x !== colDrag.id);
    const at = order.indexOf(colDrag.over.id) + (colDrag.over.after ? 1 : 0);
    order.splice(at, 0, colDrag.id);
    p.onView({ order });
    setColDrag(null);
  };

  return (
    <div className="tb-grid-wrap" ref={wrapRef} onKeyDown={onKey} onCopy={onCopy} onPaste={onPasteEv}>
      <div className="tb-grid" role="grid" style={{ ['--cols' as string]: cols }} aria-rowcount={flat.length}>
        <div className="tb-tr tb-head" role="row" onDrop={(e) => (e.preventDefault(), colDrop())} onDragEnd={() => setColDrag(null)}>
          <div className="tb-th tb-sel sticky0">{!p.readOnly && !p.locked && <input type="checkbox" aria-label="Select all" checked={selAll} onChange={() => p.onSelect(selAll ? new Set() : new Set(flat.map((r) => r.id)))} />}</div>
          {fields.map((f, i) => (
            <Header
              key={f.id}
              f={f}
              i={i}
              count={fields.length}
              p={p}
              sticky={stickyLeft(i)}
              dragging={colDrag?.id === f.id}
              dropSide={colDrag && colDrag.id !== f.id && colDrag.over?.id === f.id ? (colDrag.over.after ? 'after' : 'before') : null}
              onDragStart={() => setColDrag({ id: f.id })}
              onDragOver={(after) => {
                if (colDrag && (colDrag.over?.id !== f.id || colDrag.over.after !== after)) setColDrag({ ...colDrag, over: { id: f.id, after } });
              }}
            />
          ))}
          <div className="tb-th tb-add-col">
            {!p.readOnly && !p.locked && !p.fixedColumns && (
              <button ref={addRef} type="button" className="icon-btn sm" title="Add a column" onClick={() => setAdding(true)}>
                <Plus size={15} />
              </button>
            )}
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.key} className="tb-group-block">
            {groupField && (
              <div className="tb-group-row">
                <button type="button" className="tb-group-toggle" onClick={() => p.onView({ collapsed: collapsed.has(g.key) ? [...collapsed].filter((x) => x !== g.key) : [...collapsed, g.key] })} aria-expanded={!collapsed.has(g.key)}>
                  <ChevronRight size={14} className={`rot-chev ${collapsed.has(g.key) ? '' : 'open'}`} />
                  {g.color && <i className="tb-dot" style={{ background: g.color }} />}
                  <strong>{g.label}</strong>
                  <span className="muted small">{g.rows.length}</span>
                </button>
              </div>
            )}
            {!collapsed.has(g.key) && g.rows.map((r) => renderRow(r, g))}
            {!collapsed.has(g.key) && !p.readOnly && p.canAdd !== false && (
              <button type="button" className="tb-grid-add" onClick={() => p.onAddRow(groupField && g.value !== null && !isComputed(groupField) ? { [groupField.id]: g.value } : {})}>
                <Plus size={14} /> New row{groupField ? ` in ${g.label}` : ''}
              </button>
            )}
          </div>
        ))}

        {p.rows.length > 0 && (
          <div className="tb-tr tb-foot" role="row">
            <div className="tb-foot-cell sticky0" />
            {fields.map((f, i) => (
              <FootCell key={f.id} f={f} p={p} rows={p.rows} sticky={stickyLeft(i)} />
            ))}
            <div className="tb-foot-cell" />
          </div>
        )}
      </div>
      <FieldMenu anchor={addRef} open={adding} onClose={() => setAdding(false)} field={null} table={t} tables={p.tables} onSave={(f) => p.onSaveField(f)} users={p.ctx.users} channels={p.channels} rows={p.ctx.rows} previewCtx={p.ctx} />
    </div>
  );
}

/** Tab-separated text (from a spreadsheet) into rows of cells, quotes and line breaks inside cells handled. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === '\t') (row.push(cell), (cell = ''));
    else if (ch === '\n') (row.push(cell), rows.push(row), (row = []), (cell = ''));
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
