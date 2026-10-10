import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Columns3, Eye, EyeOff, GripVertical, ImageOff, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { CellValue, DataTable, FieldOption, FileRef, TableField, TableRow, TableViewDef } from '../../types';
import { CellView, type CellCtx } from './Cell';
import { OPTION_COLORS, fieldIcon, groupRows, isComputed, isEmpty, noValue, rowColors, rowName, valueOf, viewFields, type RowGroup } from './fields';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { GroupEditor } from './ViewTools';
import { PickSelect } from '../ui/PickSelect';
import { Popover } from '../ui/Popover';
import { uid } from '../../utils';
import { t, tn } from '../../i18n';

const NONE_COLOR = '#94a3b8';

/** The fields a card shows: the view's choice, or a few that move a pipeline (owner, due date, value, choices). */
export function cardFieldsOf(tb: DataTable, view: TableViewDef, group?: TableField) {
  const usable = viewFields(tb, view, true).filter((f) => f.id !== tb.fields[0]?.id && f.id !== group?.id && f.type !== 'button');
  if (view.cardFields) return view.cardFields.map((id) => usable.find((f) => f.id === id)).filter(Boolean) as TableField[];
  const rank: Partial<Record<TableField['type'], number>> = { person: 0, date: 1, money: 2, select: 3, multi: 4, number: 5, checkbox: 6 };
  return usable
    .filter((f) => f.type !== 'longtext' && !view.hidden?.includes(f.id))
    .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))
    .slice(0, 4);
}

/** A card on the board: drag it (computers), long-press it for its menu (phones), tap its status pill to move it. */
function BoardCard({ table, view, r, ctx, shown, cover, canMove, dragging, onDragStart, onDragEnd, onOpen, phone }: {
  table: DataTable;
  view: TableViewDef;
  r: TableRow;
  ctx: CellCtx;
  shown: TableField[];
  cover?: TableField;
  canMove: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  phone?: BoardPhone;
}) {
  const menu = useActionMenu(() => phone?.actions(r) ?? [], { title: rowName(table, r), disabled: !phone || phone.selecting });
  const img = cover ? ((r.values[cover.id] as FileRef[] | null) ?? []).find((x) => x.type.startsWith('image/')) : undefined;
  const tint = view.colors?.length ? rowColors(table, view, r, ctx) : null;
  const group = phone?.group;
  const gv = group ? r.values[group.id] : null;
  const opt = group?.options?.find((o) => o.id === gv);
  const selected = !!phone?.selected.has(r.id);
  return (
    <div className="tb-card-wrap">
      <button
        type="button"
        className={`tb-card${dragging ? ' dragging' : ''}${phone ? ' lp' : ''}${tint?.row ? ' tinted' : ''}${selected ? ' on' : ''}`}
        style={tint?.row ? { ['--tint' as string]: tint.row } : undefined}
        draggable={canMove && !phone}
        onDragStart={(e) => (e.stopPropagation(), e.dataTransfer.setData('text/plain', r.id), (e.dataTransfer.effectAllowed = 'move'), onDragStart())}
        onDragEnd={onDragEnd}
        {...(phone ? menu.bind : {})}
        onClick={() => (phone?.selecting ? phone.onToggle(r.id) : onOpen())}
        aria-pressed={phone?.selecting ? selected : undefined}
      >
        {cover && <span className="tb-card-cover">{img ? <img src={img.url} alt="" /> : <ImageOff size={16} className="muted" />}</span>}
        <strong>{rowName(table, r)}</strong>
        {shown.map((f) => {
          const v = valueOf(table, f, r, ctx);
          return isEmpty(v) ? null : (
            <span key={f.id} className="tb-card-f" data-tinted={tint?.cells[f.id] ? '' : undefined} style={tint?.cells[f.id] ? { ['--tint' as string]: tint.cells[f.id] } : undefined}>
              {view.cardSize === 'roomy' && <small className="muted">{f.name}</small>}
              <CellView f={f} v={v} ctx={ctx} />
            </span>
          );
        })}
        {phone && group && canMove && !phone.selecting && (
          <span
            role="button"
            tabIndex={0}
            className="tb-chip tb-card-pill"
            style={{ ['--c' as string]: opt?.color ?? '#94a3b8' }}
            onClick={(e) => (e.stopPropagation(), phone.onPill(r, group))}
            onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), phone.onPill(r, group))}
            aria-label={t('{field}: {value}, move', { field: group.name, value: opt?.label ?? t('none') })}
          >
            {opt?.label ?? noValue(group)}
          </span>
        )}
      </button>
      {menu.menu}
    </div>
  );
}

/** What a phone (or a narrow pane) adds to the board: menus on cards, the pill that moves a card, picking several. */
export interface BoardPhone {
  actions: (r: TableRow) => SheetAction[];
  onPill: (r: TableRow, f: TableField) => void;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  group?: TableField;
}

/**
 * Kanban: one column per choice of a single-choice field (Status, Stage…), plus "No status". Drag cards between
 * columns, drag columns to reorder the choices, and edit a column (its choice) from its menu. With no choice field
 * yet, everything sits in one column and adding a column makes the field. Swimlanes split it by another field.
 * On a phone: one column at a time with the next peeking, a strip of column names to jump, + in each header,
 * "Move to" in a card's long-press menu and its status pill tappable in place.
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
  phone,
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
  onAddRow: (values: Record<string, CellValue>, label?: string) => void;
  onView: (p: Partial<TableViewDef>) => void;
  readOnly?: boolean;
  phone?: Omit<BoardPhone, 'group'>;
}) {
  const selects = table.fields.filter((f) => f.type === 'select');
  const group = selects.find((f) => f.id === view.groupBy) ?? selects[0];
  const lane = view.subGroupBy ? table.fields.find((f) => f.id === view.subGroupBy && f.id !== group?.id) : undefined;
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [colDrag, setColDrag] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // the new column's name being typed
  const [at, setAt] = useState(0); // phones: the column in view
  const wrap = useRef<HTMLDivElement>(null);
  const editable = !readOnly && canEditColumns && !phone;

  const shown = cardFieldsOf(table, view, group);
  const cover = view.cover ? table.fields.find((f) => f.id === view.cover && f.type === 'files') : undefined;
  const hiddenGroups = new Set(view.hiddenGroups ?? []);
  const options = group?.options ?? [];
  const noneLabel = group ? noValue(group) : t('No status');
  // Phones show one column at a time and open on the first: "No status" leads there, so rows that have no status yet
  // are what you see first instead of an empty column (it only shows while it has cards).
  const noneCol = { id: '', label: noneLabel, color: NONE_COLOR };
  const columns: { id: string; label: string; color: string }[] = phone ? [noneCol, ...options] : [...options, noneCol];
  const listOf = (id: string, from: TableRow[] = rows) => (group ? from.filter((r) => (r.values[group.id] ?? '') === id || (!id && !options.some((o) => o.id === r.values[group.id]))) : id ? [] : from);
  const canMove = !readOnly && !!group && (!ctx.canEdit || ctx.canEdit(group.id));
  // Which columns show: hidden ones never; "No status" when it has cards (or while dragging); empty ones unless hidden.
  const visible = columns.filter((c) => {
    if (hiddenGroups.has(c.id)) return false;
    const n = listOf(c.id).length;
    if (!c.id && group && !n && dragging === null) return false;
    if (c.id && view.hideEmptyGroups && !n && dragging === null) return false;
    return true;
  });
  const lanes: RowGroup[] = lane ? groupRows(table, lane, rows, ctx) : [{ key: '*', label: '', value: null, rows }];
  const collapsed = new Set(view.collapsed ?? []);

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
    const f: TableField = { id: uid(), name: table.fields.some((x) => x.name === t('Status')) ? t('Stage') : t('Status'), type: 'select', options: [opt] };
    onNewField(f);
    onView({ groupBy: f.id });
  };
  const dropCard = (col: string, laneValue?: CellValue) => {
    if (dragging && canMove && group) {
      const r = rows.find((x) => x.id === dragging);
      if (r && (r.values[group.id] ?? '') !== col) onCell(dragging, group.id, col || null);
      if (r && lane && laneValue !== undefined && !isComputed(lane) && JSON.stringify(r.values[lane.id] ?? null) !== JSON.stringify(laneValue)) onCell(dragging, lane.id, laneValue);
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
  // Phones: jump to a column (every lane moves together), and follow the one in view.
  const jump = (i: number) => {
    wrap.current?.querySelectorAll<HTMLElement>('.tb-board').forEach((b) => {
      const col = b.querySelectorAll<HTMLElement>(':scope > .tb-col')[i];
      if (col) b.scrollTo({ left: col.offsetLeft - b.offsetLeft - 16, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    setAt(i);
  };
  // Phones: open on the first column that has cards, never on an empty one.
  useEffect(() => {
    if (!phone) return;
    const i = visible.findIndex((c) => listOf(c.id).length > 0);
    if (i <= 0) return;
    requestAnimationFrame(() => {
      wrap.current?.querySelectorAll<HTMLElement>('.tb-board').forEach((b) => {
        const col = b.querySelectorAll<HTMLElement>(':scope > .tb-col')[i];
        if (col) b.scrollLeft = col.offsetLeft - b.offsetLeft - 16;
      });
      setAt(i);
    });
  }, [view.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!phone) return;
    const b = e.currentTarget;
    const cols = [...b.querySelectorAll<HTMLElement>(':scope > .tb-col')];
    const i = cols.findIndex((c) => c.offsetLeft - b.offsetLeft + c.offsetWidth / 2 > b.scrollLeft + 16);
    if (i >= 0 && i !== at) setAt(i);
  };
  const ph: BoardPhone | undefined = phone ? { ...phone, group } : undefined;

  const board = (laneRows: TableRow[], laneKey: string, laneValue?: CellValue) => (
    <div className={`tb-board${view.cardSize === 'roomy' ? ' roomy' : ''}`} onScroll={laneKey === lanes[0].key ? onScroll : undefined}>
      {visible.map((c) => {
        const list = listOf(c.id, laneRows);
        const key = `${laneKey}:${c.id}`;
        const values = { ...(c.id && group ? { [group.id]: c.id } : {}), ...(lane && laneValue !== undefined && laneValue !== null && !isComputed(lane) ? { [lane.id]: laneValue } : {}) };
        return (
          <section
            key={c.id || 'none'}
            className={`tb-col${over === key ? ' over' : ''}${colDrag === c.id ? ' col-dragging' : ''}`}
            onDragOver={(e) => (e.preventDefault(), over !== key && setOver(key))}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
            onDrop={(e) => (e.preventDefault(), colDrag ? dropColumn(c.id) : dropCard(c.id, laneValue))}
          >
            <ColumnHead
              c={c}
              count={list.length}
              editable={editable && !!c.id}
              canHide={!readOnly && !phone}
              group={group}
              options={options}
              onSaveOptions={saveOptions}
              onHide={() => onView({ hiddenGroups: [...hiddenGroups, c.id] })}
              onDragStart={() => setColDrag(c.id)}
              onDragEnd={() => (setColDrag(null), setOver(null))}
              onAdd={!readOnly && canAdd && phone ? () => onAddRow(values, c.label) : undefined}
            />
            <div className="tb-col-cards">
              {list.map((r) => (
                <BoardCard key={r.id} table={table} view={view} r={r} ctx={ctx} shown={shown} cover={cover} canMove={canMove} dragging={dragging === r.id} onDragStart={() => setDragging(r.id)} onDragEnd={() => (setDragging(null), setOver(null))} onOpen={() => onOpenRow(r.id)} phone={ph} />
              ))}
              {!list.length && <p className="muted small tb-col-empty">{group ? (phone ? t('Nothing here') : t('Drop a card here')) : t('Every row is here until you add columns.')}</p>}
            </div>
            {!readOnly && canAdd && !phone && (
              <button type="button" className="tb-col-add" onClick={() => onAddRow(values, c.label)}>
                <Plus size={14} /> {t('Add')}
              </button>
            )}
          </section>
        );
      })}
      {editable && laneKey === lanes[0].key && (
        <section className="tb-col tb-col-new">
          {adding === null ? (
            <button type="button" className="tb-col-add" onClick={() => setAdding('')}>
              <Plus size={14} /> {t('Add a column')}
            </button>
          ) : (
            <input
              autoFocus
              className="tb-col-input"
              value={adding}
              placeholder={group ? t('New {field}', { field: group.name.toLowerCase() }) : t('Column name, e.g. To do')}
              onChange={(e) => setAdding(e.target.value)}
              onBlur={() => addColumn(adding)}
              onKeyDown={(e) => (e.key === 'Enter' ? addColumn(adding) : e.key === 'Escape' && setAdding(null))}
            />
          )}
        </section>
      )}
    </div>
  );

  return (
    <div className={`tb-board-wrap${phone ? ' phone' : ''}${lane ? ' laned' : ''}`} ref={wrap}>
      {phone && visible.length > 1 && (
        <div className="tb-jump" role="tablist" aria-label={t('Columns')}>
          {visible.map((c, i) => (
            <button key={c.id || 'none'} type="button" role="tab" aria-selected={i === at} className={i === at ? 'on' : ''} onClick={() => jump(i)}>
              <i className="tb-dot" style={{ background: c.color }} />
              {c.label}
              <small>{listOf(c.id).length}</small>
            </button>
          ))}
        </div>
      )}
      {lane ? (
        <div className="tb-lanes">
          {lanes.map((l) => (
            <section key={l.key} className="tb-lane">
              <button type="button" className="tb-group-toggle tb-lane-head" onClick={() => onView({ collapsed: collapsed.has(`lane:${l.key}`) ? [...collapsed].filter((x) => x !== `lane:${l.key}`) : [...collapsed, `lane:${l.key}`] })} aria-expanded={!collapsed.has(`lane:${l.key}`)}>
                <ChevronRight size={14} className={`rot-chev ${collapsed.has(`lane:${l.key}`) ? '' : 'open'}`} />
                {l.color && <i className="tb-dot" style={{ background: l.color }} />}
                <strong>{l.label}</strong>
                <span className="muted small">{l.rows.length}</span>
              </button>
              <div className={`fold ${collapsed.has(`lane:${l.key}`) ? '' : 'open'}`}>
                <div className="fold-in">{board(l.rows, l.key, l.value)}</div>
              </div>
            </section>
          ))}
        </div>
      ) : (
        board(rows, '*')
      )}
    </div>
  );
}

/** A column's header: its choice, how many cards, a grip to move it, and a menu to rename, recolour, hide or delete it. */
function ColumnHead({ c, count, editable, canHide, group, options, onSaveOptions, onHide, onDragStart, onDragEnd, onAdd }: {
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
  onAdd?: () => void; // phones: + in the header
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
      {onAdd && (
        <button type="button" className="icon-btn tb-col-plus" aria-label={t('New row in {group}', { group: c.label })} onClick={onAdd}>
          <Plus size={17} />
        </button>
      )}
      {(editable || canHide) && (
        <button ref={btn} type="button" className="icon-btn sm tb-col-menu" aria-label={t('{name} options', { name: c.label })} onClick={() => (open ? close() : (setName(c.label), setOpen(true)))}>
          <MoreHorizontal size={14} />
        </button>
      )}
      <Popover anchor={btn} open={open} onClose={close} width={240} align="end" title={c.label}>
        <div className="tb-colmenu">
          {editable && (
            <>
              <input className="tb-fm-name" value={name} aria-label={t('Column name')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && close()} />
              <div className="tb-colors">
                {OPTION_COLORS.map((col) => (
                  <button key={col} type="button" className={`tb-dot big${c.color === col ? ' on' : ''}`} style={{ background: col }} onClick={() => patch({ color: col })} aria-label={col} />
                ))}
              </div>
              <div className="tb-colmenu-sep" />
            </>
          )}
          <button type="button" onClick={() => (onHide(), setOpen(false))}>
            <EyeOff size={14} /> {t('Hide in this view')}
          </button>
          {editable && (
            <button
              type="button"
              className="danger"
              onClick={() => confirm(tn(count, 'Delete “{name}”? Its {n} card moves to “{none}”.', 'Delete “{name}”? Its {n} cards move to “{none}”.', { name: c.label, none: group ? noValue(group) : t('No status') })) && (onSaveOptions(options.filter((o) => o.id !== c.id)), setOpen(false))}
            >
              <Trash2 size={14} /> {t('Delete this choice')}
            </button>
          )}
        </div>
      </Popover>
    </header>
  );
}

/** What each card shows: which fields and in what order, its size, a cover picture, and empty columns. */
/**
 * A board's own controls, in the table's toolbar next to Search and Filter (one line, not a row of their own):
 * which choice field makes the columns, columns you hid, and what each card shows.
 */
export function BoardTools({ table, view, onView, onNewField, readOnly }: { table: DataTable; view: TableViewDef; onView: (p: Partial<TableViewDef>) => void; onNewField: (f: TableField) => void; readOnly?: boolean }) {
  const selects = table.fields.filter((f) => f.type === 'select');
  const group = selects.find((f) => f.id === view.groupBy) ?? selects[0];
  const hidden = view.hiddenGroups ?? [];
  const groupBtn = useRef<HTMLButtonElement>(null);
  const cardsBtn = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState<'group' | 'cards' | null>(null);
  const shown = cardFieldsOf(table, view, group);
  const showHidden = tn(hidden.length, 'Show {n} hidden', 'Show {n} hidden');
  return (
    <>
      {readOnly || !group ? (
        <span className="tb-board-by-text small">
          <Columns3 size={13} /> <span className="lbl">{group ? t('By {field}', { field: group.name }) : t('No choice field yet')}</span>
        </span>
      ) : (
        <button ref={groupBtn} type="button" className="ghost-btn sm on" onClick={() => setPop('group')} title={t('Columns come from this field')}>
          <Columns3 size={13} /> <span className="lbl">{view.subGroupBy ? t('By {field}, in lanes', { field: group.name }) : t('By {field}', { field: group.name })}</span>
        </button>
      )}
      <Popover anchor={groupBtn} open={pop === 'group'} onClose={() => setPop(null)} width={320} title={t('Columns and swimlanes')}>
        <div className="tb-menu">
          <GroupEditor t={table} view={view} onView={onView} board />
          <button type="button" onClick={() => (newChoiceField(table, onNewField, onView), setPop(null))}>
            <Plus size={14} /> {t('New choice field for the columns')}
          </button>
        </div>
      </Popover>
      {hidden.length > 0 && (
        <button type="button" className="link-btn small tb-quiet" onClick={() => onView({ hiddenGroups: [] })} title={showHidden} aria-label={showHidden}>
          <Eye size={13} /> <span className="lbl">{showHidden}</span>
        </button>
      )}
      <button ref={cardsBtn} type="button" className="ghost-btn sm" onClick={() => setPop((x) => (x === 'cards' ? null : 'cards'))}>
        <SlidersHorizontal size={13} /> <span className="lbl">{t('Cards')}</span>
      </button>
      <Popover anchor={cardsBtn} open={pop === 'cards'} onClose={() => setPop(null)} width={280} align="end" title={t('Cards')}>
        <CardSettings table={table} view={view} group={group} shown={shown} onView={onView} />
      </Popover>
    </>
  );
}

export function CardSettings({ table, view, group, shown, onView }: { table: DataTable; view: TableViewDef; group?: TableField; shown: TableField[]; onView: (p: Partial<TableViewDef>) => void }) {
  const usable = viewFields(table, view, true).filter((f) => f.id !== table.fields[0]?.id && f.id !== group?.id && f.type !== 'button');
  const on = shown.map((f) => f.id);
  const ordered = [...shown, ...usable.filter((f) => !on.includes(f.id))];
  const [drag, setDrag] = useState<string | null>(null);
  const files = table.fields.filter((f) => f.type === 'files');
  const set = (ids: string[]) => onView({ cardFields: ids });
  const move = (id: string, d: -1 | 1) => {
    const list = [...on];
    const i = list.indexOf(id);
    if (i + d < 0 || i + d >= list.length) return;
    [list[i], list[i + d]] = [list[i + d], list[i]];
    set(list);
  };
  return (
    <div className="tab-edit-list tb-card-set">
      <p className="muted small">{t('Shown on each card, in this order.')}</p>
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
            {isOn && (
              <>
                <button type="button" className="icon-btn sm" disabled={on.indexOf(f.id) === 0} onClick={() => move(f.id, -1)} aria-label={t('Move {name} up', { name: f.name })}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" className="icon-btn sm" disabled={on.indexOf(f.id) === on.length - 1} onClick={() => move(f.id, 1)} aria-label={t('Move {name} down', { name: f.name })}>
                  <ArrowDown size={14} />
                </button>
              </>
            )}
            <button type="button" className="icon-btn sm" onClick={() => set(isOn ? on.filter((x) => x !== f.id) : [...on, f.id])} aria-label={isOn ? t('Hide {name}', { name: f.name }) : t('Show {name}', { name: f.name })}>
              {isOn ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
        );
      })}
      <div className="tb-card-opts">
        <span className="muted small">{t('Size')}</span>
        <div className="segmented sm">
          <button type="button" className={view.cardSize !== 'roomy' ? 'on' : ''} onClick={() => onView({ cardSize: 'compact' })}>
            {t('Compact')}
          </button>
          <button type="button" className={view.cardSize === 'roomy' ? 'on' : ''} onClick={() => onView({ cardSize: 'roomy' })}>
            {t('With labels')}
          </button>
        </div>
        {files.length > 0 && (
          <>
            <span className="muted small">{t('Picture')}</span>
            <PickSelect value={view.cover ?? ''} aria-label={t('Card picture')} onChange={(e) => onView({ cover: e.target.value || undefined })}>
              <option value="">{t('None')}</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </PickSelect>
          </>
        )}
        <label className="check-row small tb-card-empty">
          <input type="checkbox" checked={!!view.hideEmptyGroups} onChange={(e) => onView({ hideEmptyGroups: e.target.checked })} /> {t('Hide columns with no cards')}
        </label>
      </div>
    </div>
  );
}

/** "+ New choice field" from a board: a Stage field with three starting choices, as columns straight away. Rename them from each column's menu. */
export function newChoiceField(tb: DataTable, onNewField: (f: TableField) => void, onView: (p: Partial<TableViewDef>) => void) {
  // Named in the maker's language, like a template's columns; from then on they're the table's own words.
  const base = tb.fields.some((x) => x.name === t('Status')) ? t('Stage') : t('Status');
  const name = tb.fields.some((x) => x.name === base) ? `${base} ${tb.fields.length}` : base;
  const f: TableField = { id: uid(), name, type: 'select', options: [t('To do'), t('Doing'), t('Done')].map((l, i) => ({ id: uid(), label: l, color: ['#64748b', '#3b82f6', '#10b981'][i] })) };
  onNewField(f);
  onView({ groupBy: f.id });
}
