import { useRef, useState } from 'react';
import { Eye, EyeOff, GripVertical, ImageOff, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { CellValue, DataTable, FieldOption, FileRef, TableField, TableRow, TableViewDef } from '../../types';
import { CellView, type CellCtx } from './Cell';
import { OPTION_COLORS, fieldIcon, isEmpty, rowName, valueOf, viewFields } from './fields';
import { PickSelect } from '../ui/PickSelect';
import { Popover } from '../ui/Popover';
import { uid } from '../../utils';

const NONE_COLOR = '#94a3b8';

/** The fields a card shows: the view's choice, or a few that move a pipeline (owner, due date, value, choices). */
export function cardFieldsOf(t: DataTable, view: TableViewDef, group?: TableField) {
  const usable = viewFields(t, view, true).filter((f) => f.id !== t.fields[0]?.id && f.id !== group?.id && f.type !== 'button');
  if (view.cardFields) return view.cardFields.map((id) => usable.find((f) => f.id === id)).filter(Boolean) as TableField[];
  const rank: Partial<Record<TableField['type'], number>> = { person: 0, date: 1, money: 2, select: 3, multi: 4, number: 5, checkbox: 6 };
  return usable
    .filter((f) => f.type !== 'longtext' && !view.hidden?.includes(f.id))
    .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))
    .slice(0, 4);
}

/**
 * Kanban: one column per choice of a single-choice field (Status, Stage…), plus "No status".
 * Drag cards between columns, drag columns to reorder the choices, and edit a column (its choice) from its menu.
 * With no choice field yet, everything sits in one column and adding a column makes the field.
 */
export function BoardView({
  table,
  view,
  rows,
  ctx,
  onCell,
  onOpenRow,
  onAddRow,
  onView,
  onNewField,
  onSaveField,
  readOnly,
  canAdd = true,
  canEditColumns = true,
}: {
  onNewField: (f: TableField) => void;
  onSaveField: (f: TableField) => void;
  canAdd?: boolean;
  canEditColumns?: boolean; // the choices themselves (rename, colour, add, delete, reorder)
  table: DataTable;
  view: TableViewDef;
  rows: TableRow[];
  ctx: CellCtx;
  onCell: (rowId: string, fieldId: string, v: CellValue) => void;
  onOpenRow: (id: string) => void;
  onAddRow: (values: Record<string, CellValue>) => void;
  onView: (p: Partial<TableViewDef>) => void;
  readOnly?: boolean;
}) {
  const selects = table.fields.filter((f) => f.type === 'select');
  const group = selects.find((f) => f.id === view.groupBy) ?? selects[0];
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [colDrag, setColDrag] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // the new column's name being typed
  const [cardsOpen, setCardsOpen] = useState(false);
  const cardsBtn = useRef<HTMLButtonElement>(null);
  const editable = !readOnly && canEditColumns;

  const shown = cardFieldsOf(table, view, group);
  const cover = view.cover ? table.fields.find((f) => f.id === view.cover && f.type === 'files') : undefined;
  const hiddenGroups = new Set(view.hiddenGroups ?? []);
  const options = group?.options ?? [];
  const noneLabel = group ? `No ${group.name.toLowerCase()}` : 'No status';
  const columns: { id: string; label: string; color: string }[] = [...options, { id: '', label: noneLabel, color: NONE_COLOR }];
  const listOf = (id: string) => (group ? rows.filter((r) => (r.values[group.id] ?? '') === id || (!id && !options.some((o) => o.id === r.values[group.id]))) : id ? [] : rows);
  const canMove = !readOnly && !!group && (!ctx.canEdit || ctx.canEdit(group.id));

  const saveOptions = (opts: FieldOption[]) => group && onSaveField({ ...group, options: opts });
  const committing = useRef(false); // Enter adds, then the input's blur fires as it goes: add once
  const addColumn = (label: string) => {
    if (committing.current) return;
    committing.current = true;
    setTimeout(() => (committing.current = false), 0);
    const name = label.trim();
    setAdding(null);
    if (!name) return;
    const opt: FieldOption = { id: uid(), label: name, color: OPTION_COLORS[(options.length + 1) % OPTION_COLORS.length] };
    if (group) return saveOptions([...options, opt]);
    // The first column makes the field: Status, with this as its first choice.
    const f: TableField = { id: uid(), name: table.fields.some((x) => x.name === 'Status') ? 'Stage' : 'Status', type: 'select', options: [opt] };
    onNewField(f);
    onView({ groupBy: f.id });
  };
  const dropCard = (col: string) => {
    if (dragging && canMove && group) {
      const r = rows.find((x) => x.id === dragging);
      if (r && (r.values[group.id] ?? '') !== col) onCell(dragging, group.id, col || null);
    }
    setOver(null);
    setDragging(null);
  };
  const dropColumn = (target: string) => {
    if (colDrag && target && colDrag !== target) {
      const rest = options.filter((o) => o.id !== colDrag);
      rest.splice(rest.findIndex((o) => o.id === target), 0, options.find((o) => o.id === colDrag)!);
      saveOptions(rest);
    }
    setColDrag(null);
    setOver(null);
  };

  // A plain render function, not a component: a new component type each render would remount the card mid-drag.
  const card = (r: TableRow) => {
    const img = cover ? ((r.values[cover.id] as FileRef[] | null) ?? []).find((x) => x.type.startsWith('image/')) : undefined;
    return (
      <button
        key={r.id}
        type="button"
        className={`tb-card${dragging === r.id ? ' dragging' : ''}`}
        draggable={canMove}
        onDragStart={(e) => (e.stopPropagation(), e.dataTransfer.setData('text/plain', r.id), (e.dataTransfer.effectAllowed = 'move'), setDragging(r.id))}
        onDragEnd={() => (setDragging(null), setOver(null))}
        onClick={() => onOpenRow(r.id)}
      >
        {cover && <span className="tb-card-cover">{img ? <img src={img.url} alt="" /> : <ImageOff size={16} className="muted" />}</span>}
        <strong>{rowName(table, r)}</strong>
        {shown.map((f) => {
          const v = valueOf(table, f, r, ctx);
          return isEmpty(v) ? null : (
            <span key={f.id} className="tb-card-f">
              {view.cardSize === 'roomy' && <small className="muted">{f.name}</small>}
              <CellView f={f} v={v} ctx={ctx} />
            </span>
          );
        })}
      </button>
    );
  };

  return (
    <div className="tb-board-wrap">
      <div className="tb-board-by">
        <span className="muted small">Columns from</span>
        {readOnly || !group ? (
          <strong className="small">{group?.name ?? 'nothing yet: add a column'}</strong>
        ) : (
          <PickSelect value={group.id} aria-label="Columns from" onChange={(e) => (e.target.value === '__new' ? newChoiceField(table, onNewField, onView) : onView({ groupBy: e.target.value }))}>
            {selects.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="__new">+ New choice field</option>
          </PickSelect>
        )}
        {hiddenGroups.size > 0 && (
          <button type="button" className="link-btn small" onClick={() => onView({ hiddenGroups: [] })}>
            Show {hiddenGroups.size} hidden {hiddenGroups.size === 1 ? 'column' : 'columns'}
          </button>
        )}
        <span className="spacer" />
        <button ref={cardsBtn} type="button" className="ghost-btn sm" onClick={() => setCardsOpen((o) => !o)}>
          <SlidersHorizontal size={13} /> Cards
        </button>
        <Popover anchor={cardsBtn} open={cardsOpen} onClose={() => setCardsOpen(false)} width={280} align="end" title="Cards">
          <CardSettings table={table} view={view} group={group} shown={shown} onView={onView} />
        </Popover>
      </div>
      <div className={`tb-board${view.cardSize === 'roomy' ? ' roomy' : ''}`}>
        {columns.map((c) => {
          const list = listOf(c.id);
          if (hiddenGroups.has(c.id)) return null;
          // "No status" shows when it has cards, while dragging, or when there's no field yet; empty choices only if wanted.
          if (!c.id && group && !list.length && dragging === null) return null;
          if (c.id && view.hideEmptyGroups && !list.length && dragging === null) return null;
          return (
            <section
              key={c.id || 'none'}
              className={`tb-col${over === c.id ? ' over' : ''}${colDrag === c.id ? ' col-dragging' : ''}`}
              onDragOver={(e) => (e.preventDefault(), over !== c.id && setOver(c.id))}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={(e) => (e.preventDefault(), colDrag ? dropColumn(c.id) : dropCard(c.id))}
            >
              <ColumnHead c={c} count={list.length} editable={editable && !!c.id} canHide={!readOnly} group={group} options={options} onSaveOptions={saveOptions} onHide={() => onView({ hiddenGroups: [...hiddenGroups, c.id] })} onDragStart={() => setColDrag(c.id)} onDragEnd={() => (setColDrag(null), setOver(null))} />
              <div className="tb-col-cards">
                {list.map(card)}
                {!list.length && <p className="muted small tb-col-empty">{group ? 'Drop a card here' : 'Every row is here until you add columns.'}</p>}
              </div>
              {!readOnly && canAdd && (
                <button type="button" className="tb-col-add" onClick={() => onAddRow(c.id && group ? { [group.id]: c.id } : {})}>
                  <Plus size={14} /> Add
                </button>
              )}
            </section>
          );
        })}
        {editable && (
          <section className="tb-col tb-col-new">
            {adding === null ? (
              <button type="button" className="tb-col-add" onClick={() => setAdding('')}>
                <Plus size={14} /> Add a column
              </button>
            ) : (
              <input
                autoFocus
                className="tb-col-input"
                value={adding}
                placeholder={group ? `New ${group.name.toLowerCase()}` : 'Column name, e.g. To do'}
                onChange={(e) => setAdding(e.target.value)}
                onBlur={() => addColumn(adding)}
                onKeyDown={(e) => (e.key === 'Enter' ? addColumn(adding) : e.key === 'Escape' && setAdding(null))}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** A column's header: its choice, how many cards, a grip to move it, and a menu to rename, recolour, hide or delete it. */
function ColumnHead({ c, count, editable, canHide, group, options, onSaveOptions, onHide, onDragStart, onDragEnd }: {
  c: { id: string; label: string; color: string };
  count: number;
  editable: boolean;
  canHide: boolean;
  group?: TableField;
  options: FieldOption[];
  onSaveOptions: (o: FieldOption[]) => void;
  onHide: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(c.label);
  const patch = (p: Partial<FieldOption>) => onSaveOptions(options.map((o) => (o.id === c.id ? { ...o, ...p } : o)));
  const close = () => {
    if (name.trim() && name.trim() !== c.label) patch({ label: name.trim() });
    setOpen(false);
  };
  return (
    <header className="tb-col-head" draggable={editable} onDragStart={(e) => (e.dataTransfer.setData('text/x-col', c.id), (e.dataTransfer.effectAllowed = 'move'), onDragStart())} onDragEnd={onDragEnd}>
      {editable && <GripVertical size={13} className="muted tb-col-grip" />}
      <i className="tb-dot" style={{ background: c.color }} />
      <strong>{c.label}</strong>
      <span className="muted small">{count}</span>
      {(editable || canHide) && (
        <button ref={btn} type="button" className="icon-btn sm tb-col-menu" aria-label={`${c.label} options`} onClick={() => (open ? close() : (setName(c.label), setOpen(true)))}>
          <MoreHorizontal size={14} />
        </button>
      )}
      <Popover anchor={btn} open={open} onClose={close} width={240} align="end" title={c.label}>
        <div className="tb-colmenu">
          {editable && (
            <>
              <input className="tb-fm-name" value={name} aria-label="Column name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && close()} />
              <div className="tb-colors">
                {OPTION_COLORS.map((col) => (
                  <button key={col} type="button" className={`tb-dot big${c.color === col ? ' on' : ''}`} style={{ background: col }} onClick={() => patch({ color: col })} aria-label={col} />
                ))}
              </div>
              <div className="tb-colmenu-sep" />
            </>
          )}
          <button type="button" onClick={() => (onHide(), setOpen(false))}>
            <EyeOff size={14} /> Hide in this view
          </button>
          {editable && (
            <button
              type="button"
              className="danger"
              onClick={() => confirm(`Delete “${c.label}”? Its ${count} ${count === 1 ? 'card moves' : 'cards move'} to “No ${group?.name.toLowerCase() ?? 'status'}”.`) && (onSaveOptions(options.filter((o) => o.id !== c.id)), setOpen(false))}
            >
              <Trash2 size={14} /> Delete this choice
            </button>
          )}
        </div>
      </Popover>
    </header>
  );
}

/** What each card shows: which fields and in what order, its size, a cover picture, and empty columns. */
function CardSettings({ table, view, group, shown, onView }: { table: DataTable; view: TableViewDef; group?: TableField; shown: TableField[]; onView: (p: Partial<TableViewDef>) => void }) {
  const usable = viewFields(table, view, true).filter((f) => f.id !== table.fields[0]?.id && f.id !== group?.id && f.type !== 'button');
  const on = shown.map((f) => f.id);
  const ordered = [...shown, ...usable.filter((f) => !on.includes(f.id))];
  const [drag, setDrag] = useState<string | null>(null);
  const files = table.fields.filter((f) => f.type === 'files');
  const set = (ids: string[]) => onView({ cardFields: ids });
  return (
    <div className="tab-edit-list tb-card-set">
      <p className="muted small">Shown on each card, in this order. Drag to reorder.</p>
      {ordered.map((f) => {
        const I = fieldIcon(f.type);
        const isOn = on.includes(f.id);
        return (
          <div
            key={f.id}
            className={`tab-edit-row${isOn ? '' : ' off'}`}
            draggable={isOn}
            onDragStart={() => setDrag(f.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!drag || drag === f.id || !isOn) return setDrag(null);
              const rest = on.filter((x) => x !== drag);
              rest.splice(rest.indexOf(f.id), 0, drag);
              set(rest);
              setDrag(null);
            }}
          >
            {isOn ? <GripVertical size={14} className="muted tb-drag" /> : <span style={{ width: 14 }} />}
            <I size={13} className="muted" />
            <span className="tab-edit-name">{f.name}</span>
            <button type="button" className="icon-btn sm" onClick={() => set(isOn ? on.filter((x) => x !== f.id) : [...on, f.id])} aria-label={isOn ? `Hide ${f.name}` : `Show ${f.name}`}>
              {isOn ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
        );
      })}
      <div className="tb-card-opts">
        <span className="muted small">Size</span>
        <div className="segmented sm">
          <button type="button" className={view.cardSize !== 'roomy' ? 'on' : ''} onClick={() => onView({ cardSize: 'compact' })}>
            Compact
          </button>
          <button type="button" className={view.cardSize === 'roomy' ? 'on' : ''} onClick={() => onView({ cardSize: 'roomy' })}>
            With labels
          </button>
        </div>
        {files.length > 0 && (
          <>
            <span className="muted small">Picture</span>
            <PickSelect value={view.cover ?? ''} aria-label="Card picture" onChange={(e) => onView({ cover: e.target.value || undefined })}>
              <option value="">None</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </PickSelect>
          </>
        )}
        <label className="check-row small tb-card-empty">
          <input type="checkbox" checked={!!view.hideEmptyGroups} onChange={(e) => onView({ hideEmptyGroups: e.target.checked })} /> Hide columns with no cards
        </label>
      </div>
    </div>
  );
}

/** "+ New choice field" from a board: a Stage field with three starting choices, as columns straight away. Rename them from each column's menu. */
export function newChoiceField(t: DataTable, onNewField: (f: TableField) => void, onView: (p: Partial<TableViewDef>) => void) {
  const base = t.fields.some((x) => x.name === 'Status') ? 'Stage' : 'Status';
  const name = t.fields.some((x) => x.name === base) ? `${base} ${t.fields.length}` : base;
  const f: TableField = { id: uid(), name, type: 'select', options: ['To do', 'Doing', 'Done'].map((l, i) => ({ id: uid(), label: l, color: ['#64748b', '#3b82f6', '#10b981'][i] })) };
  onNewField(f);
  onView({ groupBy: f.id });
}
