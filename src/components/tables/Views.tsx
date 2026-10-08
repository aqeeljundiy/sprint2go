import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Plus } from 'lucide-react';
import type { CellValue, DataTable, FileRef, TableField, TableRow, TableViewDef } from '../../types';
import { localDay, uid } from '../../utils';
import { CellView, type CellCtx } from './Cell';
import { groupRows, isEmpty, rowName, valueOf, viewFields } from './fields';
import { EmptyState } from '../ui/EmptyState';

/** The fields a card or list row shows: the view's visible ones after the name, minus long and empty ones. */
const cardFields = (t: DataTable, view: TableViewDef, n: number) => viewFields(t, view).filter((f) => f.id !== t.fields[0]?.id && f.type !== 'longtext' && f.type !== 'button' && f.id !== view.cover).slice(0, n);

/** A compact list: the name and a few fields on one line per row, grouped if the view groups. */
export function ListView({ table: t, view, rows, ctx, onOpenRow, onView }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; onOpenRow: (id: string) => void; onView: (p: Partial<TableViewDef>) => void }) {
  const fields = cardFields(t, view, 5);
  const gf = view.groupBy ? t.fields.find((f) => f.id === view.groupBy) : undefined;
  const groups = useMemo(() => (gf ? groupRows(t, gf, rows, ctx) : [{ key: '*', label: '', value: null, rows }]), [gf, t, rows, ctx]);
  const collapsed = new Set(view.collapsed ?? []);
  return (
    <div className="tb-list">
      {groups.map((g) => (
        <div key={g.key} className="tb-list-group">
          {gf && (
            <button type="button" className="tb-group-toggle" onClick={() => onView({ collapsed: collapsed.has(g.key) ? [...collapsed].filter((x) => x !== g.key) : [...collapsed, g.key] })}>
              <ChevronRight size={14} className={`rot-chev ${collapsed.has(g.key) ? '' : 'open'}`} />
              {g.color && <i className="tb-dot" style={{ background: g.color }} />}
              <strong>{g.label}</strong>
              <span className="muted small">{g.rows.length}</span>
            </button>
          )}
          {!collapsed.has(g.key) &&
            g.rows.map((r, i) => (
              <button key={r.id} type="button" className="tb-list-row" style={{ ['--i' as string]: Math.min(i, 20) }} onClick={() => onOpenRow(r.id)}>
                <strong>{rowName(t, r)}</strong>
                <span className="tb-list-fields">
                  {fields.map((f) => {
                    const v = valueOf(t, f, r, ctx);
                    return isEmpty(v) ? null : (
                      <span key={f.id} className="tb-list-f" title={f.name}>
                        <CellView f={f} v={v} ctx={ctx} />
                      </span>
                    );
                  })}
                </span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

/** Cards with a picture (the first image in the chosen files field), the name and a few fields. */
export function GalleryView({ table: t, view, rows, ctx, onOpenRow, onAddRow }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; onOpenRow: (id: string) => void; onAddRow?: () => void }) {
  const fields = cardFields(t, view, 4);
  const cover = view.cover ? t.fields.find((f) => f.id === view.cover) : undefined;
  return (
    <div className="tb-gallery">
      {rows.map((r, i) => {
        const img = cover ? ((r.values[cover.id] as FileRef[] | null) ?? []).find((x) => x.type.startsWith('image/')) : undefined;
        return (
          <button key={r.id} type="button" className="tb-gcard" style={{ ['--i' as string]: Math.min(i, 24) }} onClick={() => onOpenRow(r.id)}>
            {cover && <span className="tb-gcover">{img ? <img src={img.url} alt="" /> : <ImageOff size={18} className="muted" />}</span>}
            <span className="tb-gbody">
              <strong>{rowName(t, r)}</strong>
              {fields.map((f) => {
                const v = valueOf(t, f, r, ctx);
                return isEmpty(v) ? null : (
                  <span key={f.id} className="tb-gfield">
                    <small className="muted">{f.name}</small>
                    <CellView f={f} v={v} ctx={ctx} />
                  </span>
                );
              })}
            </span>
          </button>
        );
      })}
      {onAddRow && (
        <button type="button" className="tb-gcard tb-gadd" onClick={onAddRow}>
          <Plus size={18} /> New row
        </button>
      )}
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A month of days with each row on its date. Drag a row to another day to move it; + on a day adds one there. */
export function CalendarView({ table: t, view, rows, ctx, onOpenRow, onCell, onAddRow, onView, onNewField, readOnly }: {
  table: DataTable;
  view: TableViewDef;
  rows: TableRow[];
  ctx: CellCtx;
  onOpenRow: (id: string) => void;
  onCell: (rowId: string, fieldId: string, v: CellValue) => void;
  onAddRow?: (values: Record<string, CellValue>) => void;
  onView: (p: Partial<TableViewDef>) => void;
  onNewField: (f: TableField) => void;
  readOnly?: boolean;
}) {
  const df = t.fields.find((f) => f.id === view.dateField) ?? t.fields.find((f) => f.type === 'date');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!df)
    return (
      <EmptyState
        title="A calendar needs a date field"
        text="Add one like Due or Follow-up; rows then sit on their dates."
        action={
          !readOnly && (
            <button
              className="primary-btn sm"
              onClick={() => {
                const f: TableField = { id: uid(), name: 'Date', type: 'date' };
                onNewField(f);
                onView({ dateField: f.id });
              }}
            >
              <Plus size={14} /> Add a date field
            </button>
          )
        }
      />
    );
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7)); // weeks start on Monday
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const byDay = new Map<string, TableRow[]>();
  for (const r of rows) {
    const v = valueOf(t, df, r, ctx);
    if (isEmpty(v)) continue;
    const day = String(v).slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const today = localDay();
  const movable = !readOnly && df.type === 'date';
  const undated = rows.filter((r) => isEmpty(valueOf(t, df, r, ctx))).length;
  return (
    <div className="tb-cal">
      <div className="tb-cal-head">
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
        <button className="ghost-btn sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Today
        </button>
        <span className="spacer" />
        <span className="muted small tb-cal-note">
          By {df.name}
          {undated ? ` · ${undated} without a date` : ''}
        </span>
      </div>
      <div className="tb-cal-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="tb-cal-wd">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const key = localDay(d);
          const list = byDay.get(key) ?? [];
          const out = d.getMonth() !== month.getMonth();
          return (
            <div
              key={key}
              className={`tb-cal-day${out ? ' out' : ''}${key === today ? ' today' : ''}${over === key ? ' over' : ''}`}
              onDragOver={(e) => movable && drag && (e.preventDefault(), over !== key && setOver(key))}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && movable) onCell(drag, df.id, key);
                setDrag(null);
                setOver(null);
              }}
            >
              <span className="tb-cal-n">{d.getDate()}</span>
              {onAddRow && df.type === 'date' && (
                <button type="button" className="tb-cal-add" onClick={() => onAddRow({ [df.id]: key })} aria-label={`New row on ${key}`}>
                  <Plus size={12} />
                </button>
              )}
              <div className="tb-cal-items">
                {list.slice(0, 4).map((r) => (
                  <button key={r.id} type="button" className={`tb-cal-item${drag === r.id ? ' dragging' : ''}`} draggable={movable} onDragStart={(e) => (e.dataTransfer.setData('text/plain', r.id), setDrag(r.id))} onDragEnd={() => (setDrag(null), setOver(null))} onClick={() => onOpenRow(r.id)} title={rowName(t, r)}>
                    {rowName(t, r)}
                  </button>
                ))}
                {list.length > 4 && <span className="muted small tb-cal-more">+{list.length - 4} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
