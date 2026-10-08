import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Maximize2, Plus } from 'lucide-react';
import type { CellValue, Channel, DataTable, TableField, TableRow, TableViewDef } from '../../types';
import { ButtonCell, CellView, ContactActions, InlineInput, PickPopover, TextPopover, typesInline, type CellCtx } from './Cell';
import { FieldMenu } from './FieldMenu';
import { fieldIcon } from './fields';

const DEFAULT_W: Partial<Record<TableField['type'], number>> = { button: 150, text: 200, longtext: 240, email: 210, phone: 180, url: 190, checkbox: 90, number: 120, money: 150, date: 130, person: 170, select: 150, multi: 200, link: 200 };
const widthOf = (view: TableViewDef, f: TableField, first: boolean) => view.widths?.[f.id] ?? (first ? 220 : DEFAULT_W[f.type] ?? 160);

export interface GridProps {
  table: DataTable;
  tables: DataTable[];
  view: TableViewDef;
  rows: TableRow[];
  ctx: CellCtx;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onCell: (rowId: string, fieldId: string, v: CellValue) => void;
  onOpenRow: (id: string) => void;
  onAddRow: () => void;
  onSaveField: (f: TableField) => void;
  onDeleteField: (id: string) => void;
  onView: (p: Partial<TableViewDef>) => void;
  readOnly?: boolean;
  locked?: boolean; // guests: no field settings, no selecting rows, no new fields
  canAdd?: boolean; // false: no "New row" (guests who can't add rows)
  channels?: Channel[];
}

/** One cell: shows the value, and edits it in the way that fits the field (typing, a picker, a toggle). */
function GridCell({ f, row, ctx, onCell, readOnly }: { f: TableField; row: TableRow; ctx: CellCtx; onCell: GridProps['onCell']; readOnly?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [pop, setPop] = useState(false);
  const v = row.values[f.id];
  const save = (x: CellValue) => onCell(row.id, f.id, x);
  if (f.type === 'button')
    return (
      <div className="tb-cell t-button" role="gridcell">
        <ButtonCell f={f} row={row} ctx={ctx} />
      </div>
    );
  const start = () => {
    if (readOnly) return;
    if (f.type === 'checkbox') return save(!v);
    if (typesInline(f.type)) return setEditing(true);
    setPop(true);
  };
  return (
    <div
      ref={ref}
      className={`tb-cell t-${f.type}${editing || pop ? ' editing' : ''}`}
      role="gridcell"
      tabIndex={0}
      // The pickers render elsewhere on the page but React still passes their clicks and keys up to here:
      // only react to what happened inside the cell itself.
      onClick={(e) => !editing && e.currentTarget.contains(e.target as Node) && start()}
      onKeyDown={(e) => {
        if (editing || !e.currentTarget.contains(e.target as Node)) return;
        if (e.key === 'Enter' || e.key === 'F2') (e.preventDefault(), start());
        if ((e.key === 'Backspace' || e.key === 'Delete') && !readOnly && f.type !== 'checkbox') save(null);
      }}
    >
      {editing ? (
        <InlineInput f={f} v={v} onSave={save} onDone={() => (setEditing(false), ref.current?.focus())} />
      ) : (
        <>
          <CellView f={f} v={v} ctx={ctx} />
          <ContactActions f={f} v={v} />
        </>
      )}
      {(f.type === 'select' || f.type === 'multi' || f.type === 'person' || f.type === 'link') && <PickPopover f={f} v={v} ctx={ctx} anchor={ref} open={pop} onClose={() => setPop(false)} onSave={save} />}
      {f.type === 'longtext' && <TextPopover v={v} anchor={ref} open={pop} onClose={() => setPop(false)} onSave={save} title={f.name} />}
    </div>
  );
}

/** A column header: the field's name and kind; click for its settings; drag the edge to resize. */
function Header({ f, table, tables, view, first, onSaveField, onDeleteField, onView, readOnly, ctx, channels }: { f: TableField; first: boolean } & Pick<GridProps, 'table' | 'tables' | 'view' | 'onSaveField' | 'onDeleteField' | 'onView' | 'readOnly' | 'ctx' | 'channels'>) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const Icon = fieldIcon(f.type);
  const sorted = view.sort?.fieldId === f.id ? view.sort.dir : null;
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(view, f, first);
    const cell = (e.currentTarget as HTMLElement).closest('.tb-grid') as HTMLElement;
    const idx = table.fields.filter((x) => !view.hidden?.includes(x.id)).findIndex((x) => x.id === f.id);
    const move = (ev: PointerEvent) => {
      const w = Math.max(80, Math.min(600, startW + ev.clientX - startX));
      const cols = getComputedStyle(cell).getPropertyValue('--cols').trim().split(/\s+/);
      cols[idx + 1] = `${w}px`;
      cell.style.setProperty('--cols', cols.join(' '));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const w = Math.max(80, Math.min(600, startW + ev.clientX - startX));
      if (w !== startW) onView({ widths: { ...view.widths, [f.id]: w } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={`tb-th${first ? ' sticky' : ''}`} role="columnheader">
      <button ref={ref} type="button" className="tb-th-btn" onClick={() => !readOnly && setOpen(true)} title={readOnly ? f.name : `${f.name}: settings`}>
        <Icon size={13} />
        <span>{f.name}</span>
        {sorted === 'asc' && <ArrowDown size={12} className="tb-sorted" />}
        {sorted === 'desc' && <ArrowUp size={12} className="tb-sorted" />}
      </button>
      {!readOnly && <span className="tb-resize" onPointerDown={resize} aria-hidden />}
      {!readOnly && (
        <FieldMenu
          anchor={ref}
          open={open}
          onClose={() => setOpen(false)}
          field={f}
          table={table}
          tables={tables}
          isFirst={first}
          onSave={onSaveField}
          onDelete={() => onDeleteField(f.id)}
          users={ctx.users}
          channels={channels}
          onSort={(dir) => onView({ sort: { fieldId: f.id, dir } })}
          onHide={() => onView({ hidden: [...(view.hidden ?? []), f.id] })}
        />
      )}
    </div>
  );
}

/** The spreadsheet: every row, every visible field. The first column (the name) stays in view when scrolling sideways. */
export function GridView(p: GridProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const fields = p.table.fields.filter((f) => !p.view.hidden?.includes(f.id));
  const cols = `44px ${fields.map((f, i) => `${widthOf(p.view, f, i === 0)}px`).join(' ')} 48px`;
  const all = p.rows.length > 0 && p.rows.every((r) => p.selected.has(r.id));
  const toggle = (id: string) => {
    const next = new Set(p.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    p.onSelect(next);
  };
  return (
    <div className="tb-grid-wrap">
      <div className="tb-grid" role="grid" style={{ ['--cols' as string]: cols }} aria-rowcount={p.rows.length}>
        <div className="tb-tr tb-head" role="row">
          <div className="tb-th tb-sel sticky0">{!p.readOnly && !p.locked && <input type="checkbox" aria-label="Select all" checked={all} onChange={() => p.onSelect(all ? new Set() : new Set(p.rows.map((r) => r.id)))} />}</div>
          {fields.map((f, i) => (
            <Header key={f.id} f={f} first={i === 0} {...p} readOnly={p.readOnly || p.locked} />
          ))}
          <div className="tb-th tb-add-col">
            {!p.readOnly && !p.locked && (
              <button ref={addRef} type="button" className="icon-btn sm" title="Add a field" onClick={() => setAdding(true)}>
                <Plus size={15} />
              </button>
            )}
          </div>
        </div>
        {p.rows.map((r, n) => (
          <div key={r.id} className={`tb-tr${p.selected.has(r.id) ? ' on' : ''}`} role="row" style={{ ['--i' as string]: Math.min(n, 20) }}>
            <div className="tb-sel sticky0">
              {!p.readOnly && !p.locked && <input type="checkbox" aria-label="Select row" checked={p.selected.has(r.id)} onChange={() => toggle(r.id)} />}
              <span className="tb-n">{n + 1}</span>
            </div>
            {fields.map((f, i) =>
              i === 0 ? (
                <div key={f.id} className="tb-first">
                  <GridCell f={f} row={r} ctx={p.ctx} onCell={p.onCell} readOnly={p.readOnly || (!!p.ctx.canEdit && !p.ctx.canEdit(f.id))} />
                  <button type="button" className="tb-expand" onClick={() => p.onOpenRow(r.id)} title="Open row" aria-label="Open row">
                    <Maximize2 size={13} />
                  </button>
                </div>
              ) : (
                <GridCell key={f.id} f={f} row={r} ctx={p.ctx} onCell={p.onCell} readOnly={p.readOnly || (!!p.ctx.canEdit && !p.ctx.canEdit(f.id))} />
              ),
            )}
            <div />
          </div>
        ))}
        {!p.readOnly && p.canAdd !== false && (
          <button type="button" className="tb-new-row" onClick={p.onAddRow}>
            <Plus size={14} /> New row
          </button>
        )}
      </div>
      <FieldMenu anchor={addRef} open={adding} onClose={() => setAdding(false)} field={null} table={p.table} tables={p.tables} onSave={p.onSaveField} users={p.ctx.users} channels={p.channels} />
    </div>
  );
}
