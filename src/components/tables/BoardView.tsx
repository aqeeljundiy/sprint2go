import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { CellValue, DataTable, TableField, TableRow, TableViewDef } from '../../types';
import { CellView, type CellCtx } from './Cell';
import { isEmpty, rowName } from './fields';

/**
 * Kanban: one column per choice of a single-choice field (Status, Stage…), plus "No status".
 * Drag a card to another column to change it; "+" in a column adds a row already in that column.
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
  readOnly,
}: {
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
  if (!group)
    return (
      <div className="empty">
        <p className="empty-title">A board needs a single-choice field</p>
        <p className="empty-sub">Add one like Status or Stage in the grid, then its choices become the board’s columns.</p>
      </div>
    );
  // Up to three more fields on each card: the ones with something in them, in the table's order.
  // Cards show what moves a pipeline first: who has it, when it's due, its value and choices; contact details after.
  const rank: Partial<Record<TableField['type'], number>> = { person: 0, date: 1, money: 2, select: 3, multi: 4, number: 5, checkbox: 6 };
  const shown = table.fields
    .filter((f, i) => i > 0 && f.id !== group.id && !view.hidden?.includes(f.id) && f.type !== 'longtext')
    .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))
    .slice(0, 4);
  const columns: { id: string; label: string; color: string }[] = [...(group.options ?? []), { id: '', label: `No ${group.name.toLowerCase()}`, color: '#94a3b8' }];
  const canMove = !readOnly && (!ctx.canEdit || ctx.canEdit(group.id));
  const drop = (col: string) => {
    if (dragging && canMove) {
      const r = rows.find((x) => x.id === dragging);
      if (r && (r.values[group.id] ?? '') !== col) onCell(dragging, group.id, col || null);
    }
    setOver(null);
    setDragging(null);
  };
  // A plain render function, not a component: a new component type each render would remount the card mid-drag.
  const card = (r: TableRow) => (
    <button
      key={r.id}
      type="button"
      className={`tb-card${dragging === r.id ? ' dragging' : ''}`}
      draggable={canMove}
      onDragStart={(e) => (e.dataTransfer.setData('text/plain', r.id), (e.dataTransfer.effectAllowed = 'move'), setDragging(r.id))}
      onDragEnd={() => (setDragging(null), setOver(null))}
      onClick={() => onOpenRow(r.id)}
    >
      <strong>{rowName(table, r)}</strong>
      {shown.map((f: TableField) =>
        isEmpty(r.values[f.id]) ? null : (
          <span key={f.id} className="tb-card-f">
            <CellView f={f} v={r.values[f.id]} ctx={ctx} />
          </span>
        ),
      )}
    </button>
  );
  return (
    <div className="tb-board-wrap">
      {selects.length > 1 && (
        <div className="tb-board-by">
          <span className="muted small">Columns from</span>
          <div className="segmented sm">
            {selects.map((f) => (
              <button key={f.id} type="button" className={f.id === group.id ? 'on' : ''} onClick={() => onView({ groupBy: f.id })}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="tb-board">
        {columns.map((c) => {
          const list = rows.filter((r) => (r.values[group.id] ?? '') === c.id || (!c.id && !group.options?.some((o) => o.id === r.values[group.id])));
          if (!c.id && !list.length && dragging === null) return null; // "No status" only when it has cards (or while dragging)
          return (
            <section
              key={c.id || 'none'}
              className={`tb-col${over === c.id ? ' over' : ''}`}
              onDragOver={(e) => (e.preventDefault(), over !== c.id && setOver(c.id))}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={(e) => (e.preventDefault(), drop(c.id))}
            >
              <header className="tb-col-head">
                <i className="tb-dot" style={{ background: c.color }} />
                <strong>{c.label}</strong>
                <span className="muted small">{list.length}</span>
              </header>
              <div className="tb-col-cards">
                {list.map(card)}
              </div>
              {!readOnly && (
                <button type="button" className="tb-col-add" onClick={() => onAddRow(c.id ? { [group.id]: c.id } : {})}>
                  <Plus size={14} /> Add
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
