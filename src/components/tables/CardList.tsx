import { useMemo } from 'react';
import { Check, ChevronRight, Plus } from 'lucide-react';
import type { CellValue, DataTable, TableField, TableRow, TableViewDef } from '../../types';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { useLeaving } from '../ui/Smooth';
import { CellView, type CellCtx } from './Cell';
import { cardFieldsOf } from './BoardView';
import { groupRows, isComputed, isEmpty, rowColors, rowName, statusField, valueOf, type RowGroup } from './fields';

/** The field a card shows as its coloured pill. */
export const statusFieldOf = (t: DataTable, view: TableViewDef) => statusField(t, view);

export interface CardHandlers {
  onOpen: (id: string) => void;
  onToggle: (id: string) => void; // select or unselect (while selecting)
  actions: (row: TableRow) => SheetAction[]; // the long-press menu
  onPill?: (row: TableRow, f: TableField) => void; // the status pill, tapped in place
  onAdd?: (values: Record<string, CellValue>, label?: string) => void; // + in a group
}

/** One row as a card: the name, the status as a pill you can tap, and two or three chosen fields. */
function Card({ t, view, row, ctx, status, meta, selecting, selected, leaving, h, i }: { t: DataTable; view: TableViewDef; row: TableRow; ctx: CellCtx; status?: TableField; meta: TableField[]; selecting: boolean; selected: boolean; leaving: boolean; h: CardHandlers; i: number }) {
  const menu = useActionMenu(() => h.actions(row), { title: rowName(t, row), disabled: selecting });
  const tint = rowColors(t, view, row, ctx);
  const sv = status ? valueOf(t, status, row, ctx) : null;
  const opt = status?.options?.find((o) => o.id === sv);
  const canPill = !!status && !!h.onPill && !isComputed(status) && (!ctx.canEdit || ctx.canEdit(status.id));
  const pill = (status && (opt || canPill)) ? (
    <span
      role={canPill ? 'button' : undefined}
      tabIndex={canPill ? 0 : undefined}
      className={`tb-chip tb-crd-pill${opt ? '' : ' none'}`}
      style={{ ['--c' as string]: opt?.color ?? '#94a3b8' }}
      onClick={canPill ? (e) => (e.stopPropagation(), h.onPill!(row, status)) : undefined}
      onKeyDown={canPill ? (e) => e.key === 'Enter' && (e.stopPropagation(), h.onPill!(row, status)) : undefined}
      aria-label={canPill ? `${status.name}: ${opt?.label ?? 'none'}, change` : undefined}
    >
      {opt?.label ?? `No ${status.name.toLowerCase()}`}
    </span>
  ) : null;
  const shown = meta.map((f) => ({ f, v: valueOf(t, f, row, ctx) })).filter((x) => !isEmpty(x.v));
  return (
    <div className={`tb-crd-wrap${leaving ? ' leaving' : ''}`} style={{ ['--i' as string]: Math.min(i, 16) }}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selecting ? selected : undefined}
        className={`tb-crd lp${selected ? ' on' : ''}${tint.row ? ' tinted' : ''}`}
        style={tint.row ? { ['--tint' as string]: tint.row } : undefined}
        {...menu.bind}
        onClick={() => (selecting ? h.onToggle(row.id) : h.onOpen(row.id))}
        onKeyDown={(e) => e.key === 'Enter' && (selecting ? h.onToggle(row.id) : h.onOpen(row.id))}
      >
        {selecting && (
          <span className={`tb-crd-check${selected ? ' on' : ''}`} aria-hidden>
            <Check size={14} />
          </span>
        )}
        <span className="tb-crd-body">
          <span className="tb-crd-top">
            <strong className="tb-crd-name">{rowName(t, row)}</strong>
            {pill}
          </span>
          {shown.length > 0 && (
            <span className="tb-crd-meta">
              {shown.map(({ f, v }) => (
                <span key={f.id} className="tb-crd-f" title={f.name} style={tint.cells[f.id] ? { ['--tint' as string]: tint.cells[f.id] } : undefined} data-tinted={tint.cells[f.id] ? '' : undefined}>
                  <CellView f={f} v={v} ctx={ctx} />
                </span>
              ))}
            </span>
          )}
        </span>
      </div>
      {menu.menu}
    </div>
  );
}

function Cards({ rows, ...p }: { t: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; status?: TableField; meta: TableField[]; selecting: boolean; selected: Set<string>; h: CardHandlers }) {
  const list = useLeaving(rows, (r) => r.id);
  return (
    <div className="tb-crd-list">
      {list.map(({ item, leaving }, i) => (
        <Card key={item.id} {...p} row={item} leaving={leaving} selected={p.selected.has(item.id)} i={i} />
      ))}
    </div>
  );
}

/**
 * A grid or list view on a narrow screen: one card per row (the name, the status pill, a few fields), grouped and
 * sub-grouped like the view. Tap opens the row, long-press opens its menu (Select starts picking several).
 */
export function CardList({ t, view, rows, ctx, selecting, selected, collapsed, onCollapse, canAdd, h }: { t: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; selecting: boolean; selected: Set<string>; collapsed: Set<string>; onCollapse: (key: string) => void; canAdd: boolean; h: CardHandlers }) {
  const status = statusFieldOf(t, view);
  const meta = useMemo(() => cardFieldsOf(t, view, status).filter((f) => f.type !== 'files').slice(0, 3), [t, view, status]);
  const gf = view.groupBy ? t.fields.find((f) => f.id === view.groupBy) : undefined;
  const sf = gf && view.subGroupBy ? t.fields.find((f) => f.id === view.subGroupBy) : undefined;
  const groups: RowGroup[] = useMemo(() => (gf ? groupRows(t, gf, rows, ctx) : []), [gf, t, rows, ctx]);
  const cards = (list: TableRow[]) => <Cards t={t} view={view} rows={list} ctx={ctx} status={status} meta={meta} selecting={selecting} selected={selected} h={h} />;
  const head = (key: string, g: RowGroup, field: TableField, values: Record<string, CellValue>, sub?: boolean) => (
    <div className={`tb-crd-ghead${sub ? ' sub' : ''}`}>
      <button type="button" className="tb-group-toggle" onClick={() => onCollapse(key)} aria-expanded={!collapsed.has(key)}>
        <ChevronRight size={15} className={`rot-chev ${collapsed.has(key) ? '' : 'open'}`} />
        {g.color && <i className="tb-dot" style={{ background: g.color }} />}
        <strong>{g.label}</strong>
        <span className="muted small">{g.rows.length}</span>
      </button>
      {canAdd && h.onAdd && !isComputed(field) && g.value !== null && (
        <button type="button" className="icon-btn tb-crd-gadd" aria-label={`New row in ${g.label}`} onClick={() => h.onAdd!(values, g.label)}>
          <Plus size={17} />
        </button>
      )}
    </div>
  );
  if (!gf) return <div className="tb-crd-scroll">{cards(rows)}</div>;
  return (
    <div className="tb-crd-scroll">
      {groups.map((g) => {
        const own = { [gf.id]: g.value } as Record<string, CellValue>;
        return (
          <section key={g.key} className="tb-crd-group">
            {head(g.key, g, gf, own)}
            <div className={`fold ${collapsed.has(g.key) ? '' : 'open'}`}>
              <div className="fold-in">
                {sf
                  ? groupRows(t, sf, g.rows, ctx).map((sg) => {
                      const key = `${g.key}/${sg.key}`;
                      return (
                        <div key={key} className="tb-crd-sub">
                          {head(key, sg, sf, { ...own, ...(sg.value !== null && !isComputed(sf) ? { [sf.id]: sg.value } : {}) }, true)}
                          <div className={`fold ${collapsed.has(key) ? '' : 'open'}`}>
                            <div className="fold-in">{cards(sg.rows)}</div>
                          </div>
                        </div>
                      );
                    })
                  : cards(g.rows)}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
