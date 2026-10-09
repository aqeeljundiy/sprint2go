import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Plus } from 'lucide-react';
import { usePersisted } from '../../settings';
import { useLongPress } from '../ui/useLongPress';
import type { CellValue, DataTable, FileRef, TableField, TableRow, TableViewDef } from '../../types';
import { localDay, uid } from '../../utils';
import { CellView, type CellCtx } from './Cell';
import { groupRows, isEmpty, rowColors, rowName, valueOf, viewFields } from './fields';
import { EmptyState } from '../ui/EmptyState';

/** The fields a card or list row shows: the view's visible ones after the name, minus long and empty ones. */
const cardFields = (t: DataTable, view: TableViewDef, n: number) => viewFields(t, view).filter((f) => f.id !== t.fields[0]?.id && f.type !== 'longtext' && f.type !== 'button' && f.id !== view.cover).slice(0, n);

/** A compact list: the name and a few fields on one line per row, grouped (and sub-grouped) if the view groups. */
export function ListView({ table: t, view, rows, ctx, onOpenRow, onView }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; onOpenRow: (id: string) => void; onView: (p: Partial<TableViewDef>) => void }) {
  const fields = cardFields(t, view, 5);
  const gf = view.groupBy ? t.fields.find((f) => f.id === view.groupBy) : undefined;
  const sf = gf && view.subGroupBy ? t.fields.find((f) => f.id === view.subGroupBy) : undefined;
  const groups = useMemo(() => (gf ? groupRows(t, gf, rows, ctx) : [{ key: '*', label: '', value: null, rows }]), [gf, t, rows, ctx]);
  const collapsed = new Set(view.collapsed ?? []);
  const fold = (key: string) => onView({ collapsed: collapsed.has(key) ? [...collapsed].filter((x) => x !== key) : [...collapsed, key] });
  const toggle = (key: string, g: { label: string; color?: string; rows: TableRow[] }, sub?: boolean) => (
    <button type="button" className={`tb-group-toggle${sub ? ' sub' : ''}`} onClick={() => fold(key)} aria-expanded={!collapsed.has(key)}>
      <ChevronRight size={14} className={`rot-chev ${collapsed.has(key) ? '' : 'open'}`} />
      {g.color && <i className="tb-dot" style={{ background: g.color }} />}
      <strong>{g.label}</strong>
      <span className="muted small">{g.rows.length}</span>
    </button>
  );
  const list = (rs: TableRow[]) =>
    rs.map((r, i) => {
      const tint = rowColors(t, view, r, ctx);
      return (
        <button key={r.id} type="button" className={`tb-list-row${tint.row ? ' tinted' : ''}`} style={{ ['--i' as string]: Math.min(i, 20), ...(tint.row ? { ['--tint' as string]: tint.row } : {}) }} onClick={() => onOpenRow(r.id)}>
          <strong>{rowName(t, r)}</strong>
          <span className="tb-list-fields">
            {fields.map((f) => {
              const v = valueOf(t, f, r, ctx);
              return isEmpty(v) ? null : (
                <span key={f.id} className="tb-list-f" title={f.name} data-tinted={tint.cells[f.id] ? '' : undefined} style={tint.cells[f.id] ? { ['--tint' as string]: tint.cells[f.id] } : undefined}>
                  <CellView f={f} v={v} ctx={ctx} />
                </span>
              );
            })}
          </span>
        </button>
      );
    });
  return (
    <div className="tb-list">
      {groups.map((g) => (
        <div key={g.key} className="tb-list-group">
          {gf && toggle(g.key, g)}
          {!collapsed.has(g.key) &&
            (sf
              ? groupRows(t, sf, g.rows, ctx).map((sg) => {
                  const key = `${g.key}/${sg.key}`;
                  return (
                    <div key={key} className="tb-list-sub">
                      {toggle(key, sg, true)}
                      {!collapsed.has(key) && list(sg.rows)}
                    </div>
                  );
                })
              : list(g.rows))}
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
export function CalendarView({ table: t, view, rows, ctx, onOpenRow, onCell, onAddRow, onView, onNewField, readOnly, narrow, onLongPressDay }: {
  narrow?: boolean; // a phone or a narrow pane: dots on a month, the day's rows under it, or an agenda
  onLongPressDay?: (day: string) => void; // phones: hold a day to add a row on it
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
  if (narrow) return <PhoneCalendar table={t} view={view} rows={rows} ctx={ctx} field={df} onOpenRow={onOpenRow} onAddRow={onAddRow} onLongPressDay={onLongPressDay} />;
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

/* ---------- phones: calendar as dots, the day's list, or an agenda ---------- */

const dayTitle = (key: string, today: string) => {
  const d = new Date(`${key}T12:00`);
  const t = new Date(`${today}T12:00`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Tomorrow · ${date}` : diff === -1 ? `Yesterday · ${date}` : date;
};

function AgendaRow({ t, view, r, ctx, end, onOpenRow }: { t: DataTable; view?: TableViewDef; r: TableRow; ctx: CellCtx; end?: TableField; onOpenRow: (id: string) => void }) {
  const tint = view ? rowColors(t, view, r, ctx).row : undefined;
  const until = end ? r.values[end.id] : null;
  return (
    <button type="button" className="tb-ag-row" onClick={() => onOpenRow(r.id)}>
      <i className="tb-dot" style={{ background: tint ?? t.color }} />
      <span className="tb-ag-name">{rowName(t, r)}</span>
      {typeof until === 'string' && until && <small className="muted">until {new Date(`${until}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>}
    </button>
  );
}

/** Rows by date, from today on: earlier ones folded on top, undated ones at the end. */
export function Agenda({ table: t, view, rows, ctx, field, end, onOpenRow, canAdd, onAddRow }: { table: DataTable; view?: TableViewDef; rows: TableRow[]; ctx: CellCtx; field: TableField; end?: TableField; onOpenRow: (id: string) => void; canAdd?: boolean; onAddRow?: (values: Record<string, CellValue>) => void }) {
  const today = localDay();
  const [earlier, setEarlier] = useState(false);
  const [undatedOpen, setUndatedOpen] = useState(false);
  const byDay = new Map<string, TableRow[]>();
  const undated: TableRow[] = [];
  for (const r of rows) {
    const v = valueOf(t, field, r, ctx);
    if (isEmpty(v)) undated.push(r);
    else {
      const k = String(v).slice(0, 10);
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
  }
  const keys = [...byDay.keys()].sort();
  const past = keys.filter((k) => k < today);
  const next = keys.filter((k) => k >= today);
  const day = (k: string) => (
    <section key={k} className="tb-ag-day">
      <h4 className={k === today ? 'today' : ''}>{dayTitle(k, today)}</h4>
      {byDay.get(k)!.map((r) => (
        <AgendaRow key={r.id} t={t} view={view} r={r} ctx={ctx} end={end} onOpenRow={onOpenRow} />
      ))}
    </section>
  );
  return (
    <div className="tb-agenda">
      {past.length > 0 && (
        <>
          <button type="button" className="tb-ag-fold" onClick={() => setEarlier((x) => !x)} aria-expanded={earlier}>
            <ChevronRight size={15} className={`rot-chev ${earlier ? 'open' : ''}`} />
            Earlier <span className="muted small">{past.reduce((n, k) => n + byDay.get(k)!.length, 0)}</span>
          </button>
          <div className={`fold ${earlier ? 'open' : ''}`}>
            <div className="fold-in">{past.map(day)}</div>
          </div>
        </>
      )}
      {!next.length && <p className="muted small tb-ag-none">Nothing from today on.</p>}
      {next.map(day)}
      {canAdd && onAddRow && field.type === 'date' && (
        <button type="button" className="tb-ag-add" onClick={() => onAddRow({ [field.id]: today })}>
          <Plus size={16} /> New row today
        </button>
      )}
      {undated.length > 0 && (
        <>
          <button type="button" className="tb-ag-fold" onClick={() => setUndatedOpen((x) => !x)} aria-expanded={undatedOpen}>
            <ChevronRight size={15} className={`rot-chev ${undatedOpen ? 'open' : ''}`} />
            Without {field.name.toLowerCase()} <span className="muted small">{undated.length}</span>
          </button>
          <div className={`fold ${undatedOpen ? 'open' : ''}`}>
            <div className="fold-in">
              {undated.map((r) => (
                <AgendaRow key={r.id} t={t} view={view} r={r} ctx={ctx} onOpenRow={onOpenRow} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One day on the phone's month: its number and up to three dots. Tap picks it; hold adds a row on it. */
function DayCell({ day, n, out, today, picked, onPick, onHold }: { day: string; n: number; out: boolean; today: boolean; picked: boolean; onPick: () => void; onHold?: () => void }) {
  const press = useLongPress(() => onHold?.(), { disabled: !onHold });
  const date = new Date(`${day}T12:00`);
  return (
    <button type="button" className={`tb-pcal-day lp${out ? ' out' : ''}${today ? ' today' : ''}${picked ? ' on' : ''}`} aria-pressed={picked} aria-label={`${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${n ? `, ${n} ${n === 1 ? 'row' : 'rows'}` : ''}`} onClick={onPick} {...press}>
      <span className="tb-pcal-n">{date.getDate()}</span>
      <span className="tb-pcal-dots" aria-hidden>
        {Array.from({ length: Math.min(3, n) }, (_, i) => (
          <i key={i} />
        ))}
      </span>
    </button>
  );
}

function PhoneCalendar({ table: t, view, rows, ctx, field: df, onOpenRow, onAddRow, onLongPressDay }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; field: TableField; onOpenRow: (id: string) => void; onAddRow?: (values: Record<string, CellValue>) => void; onLongPressDay?: (day: string) => void }) {
  const today = localDay();
  const [mode, setMode] = usePersisted<'month' | 'agenda'>(`s2g-tb-cal:${view.id}`, 'month');
  const [picked, setPicked] = useState(today);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const byDay = useMemo(() => {
    const m = new Map<string, TableRow[]>();
    for (const r of rows) {
      const v = valueOf(t, df, r, ctx);
      if (!isEmpty(v)) m.set(String(v).slice(0, 10), [...(m.get(String(v).slice(0, 10)) ?? []), r]);
    }
    return m;
  }, [rows, df, t, ctx]);
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const weeks = Math.ceil((((month.getDay() + 6) % 7) + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const canAdd = !!onAddRow && df.type === 'date';
  const list = byDay.get(picked) ?? [];
  const go = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div className="tb-pcal">
      <div className="tb-pcal-head">
        {mode === 'month' ? (
          <>
            <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Previous month">
              <ChevronLeft size={20} />
            </button>
            <strong className="tb-pcal-month">{month.toLocaleDateString(undefined, { month: 'long', year: month.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}</strong>
            <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="Next month">
              <ChevronRight size={20} />
            </button>
          </>
        ) : (
          <strong>By {df.name.toLowerCase()}</strong>
        )}
        <span className="spacer" />
        <div className="segmented sm">
          <button type="button" className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
            Month
          </button>
          <button type="button" className={mode === 'agenda' ? 'on' : ''} onClick={() => setMode('agenda')}>
            Agenda
          </button>
        </div>
      </div>
      {mode === 'agenda' ? (
        <Agenda table={t} view={view} rows={rows} ctx={ctx} field={df} onOpenRow={onOpenRow} canAdd={canAdd} onAddRow={onAddRow} />
      ) : (
        <>
          <div className="tb-pcal-grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="tb-pcal-wd" aria-hidden>
                {w.slice(0, 1)}
              </span>
            ))}
            {days.map((d) => {
              const key = localDay(d);
              return (
                <DayCell
                  key={key}
                  day={key}
                  n={byDay.get(key)?.length ?? 0}
                  out={d.getMonth() !== month.getMonth()}
                  today={key === today}
                  picked={key === picked}
                  onPick={() => (setPicked(key), d.getMonth() !== month.getMonth() && setMonth(new Date(d.getFullYear(), d.getMonth(), 1)))}
                  onHold={canAdd && onLongPressDay ? () => (setPicked(key), onLongPressDay(key)) : undefined}
                />
              );
            })}
          </div>
          <div className="tb-pcal-list">
            <h4>{dayTitle(picked, today)}</h4>
            {list.map((r) => (
              <AgendaRow key={r.id} t={t} view={view} r={r} ctx={ctx} onOpenRow={onOpenRow} />
            ))}
            {!list.length && <p className="muted small tb-ag-none">Nothing on this day.{canAdd && onLongPressDay ? ' Hold a day to add a row on it.' : ''}</p>}
            {canAdd && (
              <button type="button" className="tb-ag-add" onClick={() => (onLongPressDay ? onLongPressDay(picked) : onAddRow!({ [df.id]: picked }))}>
                <Plus size={16} /> New row on this day
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
