import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { usePersisted } from '../../settings';
import { useLongPress } from '../ui/useLongPress';
import type { CellValue, DataTable, FileRef, TableField, TableRow, TableViewDef } from '../../types';
import { localDay, uid } from '../../utils';
import { CellView, type CellCtx } from './Cell';
import { groupRows, isEmpty, rowColors, rowName, valueOf, viewFields } from './fields';
import { EmptyState } from '../ui/EmptyState';
import { t, tn } from '../../i18n';
import { fmtDate, fmtDay, fmtMonth, fmtWeekday, fmtWeekdayLong, weekdayNames } from '../../i18n/format';
import { useLang } from '../../i18n/useLang';

/** The fields a card or list row shows: the view's visible ones after the name, minus long and empty ones. */
const cardFields = (tb: DataTable, view: TableViewDef, n: number) => viewFields(tb, view).filter((f) => f.id !== tb.fields[0]?.id && f.type !== 'longtext' && f.type !== 'button' && f.id !== view.cover).slice(0, n);

/** A compact list: the name and a few fields on one line per row, grouped (and sub-grouped) if the view groups. */
export function ListView({ table: tb, view, rows, ctx, onOpenRow, onView }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; onOpenRow: (id: string) => void; onView: (p: Partial<TableViewDef>) => void }) {
  const lang = useLang(); // group names ("No status") are words: rebuild them on a language switch
  const fields = cardFields(tb, view, 5);
  const gf = view.groupBy ? tb.fields.find((f) => f.id === view.groupBy) : undefined;
  const sf = gf && view.subGroupBy ? tb.fields.find((f) => f.id === view.subGroupBy) : undefined;
  const groups = useMemo(() => (gf ? groupRows(tb, gf, rows, ctx) : [{ key: '*', label: '', value: null, rows }]), [gf, tb, rows, ctx, lang]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const tint = rowColors(tb, view, r, ctx);
      return (
        <button key={r.id} type="button" className={`tb-list-row${tint.row ? ' tinted' : ''}`} style={{ ['--i' as string]: Math.min(i, 20), ...(tint.row ? { ['--tint' as string]: tint.row } : {}) }} onClick={() => onOpenRow(r.id)}>
          <strong>{rowName(tb, r)}</strong>
          <span className="tb-list-fields">
            {fields.map((f) => {
              const v = valueOf(tb, f, r, ctx);
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
              ? groupRows(tb, sf, g.rows, ctx).map((sg) => {
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
export function GalleryView({ table: tb, view, rows, ctx, onOpenRow, onAddRow }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; onOpenRow: (id: string) => void; onAddRow?: () => void }) {
  const fields = cardFields(tb, view, 4);
  const cover = view.cover ? tb.fields.find((f) => f.id === view.cover) : undefined;
  return (
    <div className="tb-gallery">
      {rows.map((r, i) => {
        const img = cover ? ((r.values[cover.id] as FileRef[] | null) ?? []).find((x) => x.type.startsWith('image/')) : undefined;
        return (
          <button key={r.id} type="button" className="tb-gcard" style={{ ['--i' as string]: Math.min(i, 24) }} onClick={() => onOpenRow(r.id)}>
            {/* Every card has a picture: the cover image, else the row's first letter on the table's colour. */}
            <span className={`tb-gcover${img ? '' : ' tb-gletter'}`} style={img ? undefined : { ['--tb-c' as string]: tb.color }}>
              {img ? <img src={img.url} alt="" /> : <span aria-hidden>{(rowName(tb, r) || '?').trim().charAt(0).toUpperCase()}</span>}
            </span>
            <span className="tb-gbody">
              <strong>{rowName(tb, r)}</strong>
              {fields.map((f) => {
                const v = valueOf(tb, f, r, ctx);
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
          <Plus size={18} /> {t('New row')}
        </button>
      )}
    </div>
  );
}

/** A month of days with each row on its date. Drag a row to another day to move it; + on a day adds one there. */
export function CalendarView({ table: tb, view, rows, ctx, onOpenRow, onCell, onAddRow, onView, onNewField, readOnly, narrow, onLongPressDay }: {
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
  const df = tb.fields.find((f) => f.id === view.dateField) ?? tb.fields.find((f) => f.type === 'date');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!df)
    return (
      <EmptyState
        title={t('A calendar needs a date field')}
        text={t('Add one like Due or Follow-up; rows then sit on their dates.')}
        action={
          !readOnly && (
            <button
              className="primary-btn sm"
              onClick={() => {
                const f: TableField = { id: uid(), name: t('Date'), type: 'date' };
                onNewField(f);
                onView({ dateField: f.id });
              }}
            >
              <Plus size={14} /> {t('Add a date field')}
            </button>
          )
        }
      />
    );
  if (narrow) return <PhoneCalendar table={tb} view={view} rows={rows} ctx={ctx} field={df} onOpenRow={onOpenRow} onAddRow={onAddRow} onLongPressDay={onLongPressDay} />;
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7)); // weeks start on Monday
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const byDay = new Map<string, TableRow[]>();
  for (const r of rows) {
    const v = valueOf(tb, df, r, ctx);
    if (isEmpty(v)) continue;
    const day = String(v).slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const today = localDay();
  const movable = !readOnly && df.type === 'date';
  const undated = rows.filter((r) => isEmpty(valueOf(tb, df, r, ctx))).length;
  return (
    <div className="tb-cal">
      <div className="tb-cal-head">
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t('Previous month')}>
          <ChevronLeft size={16} />
        </button>
        <strong>{fmtMonth(month)}</strong>
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t('Next month')}>
          <ChevronRight size={16} />
        </button>
        <button className="ghost-btn sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          {t('Today')}
        </button>
        <span className="spacer" />
        <span className="muted small tb-cal-note">{undated ? tn(undated, 'By {field} · {n} without a date', 'By {field} · {n} without a date', { field: df.name }) : t('By {field}', { field: df.name })}</span>
      </div>
      <div className="tb-cal-grid">
        {weekdayNames('short').map((w, i) => (
          <div key={i} className="tb-cal-wd">
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
                <button type="button" className="tb-cal-add" onClick={() => onAddRow({ [df.id]: key })} aria-label={t('New row on {day}', { day: fmtDay(key) })}>
                  <Plus size={12} />
                </button>
              )}
              <div className="tb-cal-items">
                {list.slice(0, 4).map((r) => (
                  <button key={r.id} type="button" className={`tb-cal-item${drag === r.id ? ' dragging' : ''}`} draggable={movable} onDragStart={(e) => (e.dataTransfer.setData('text/plain', r.id), setDrag(r.id))} onDragEnd={() => (setDrag(null), setOver(null))} onClick={() => onOpenRow(r.id)} title={rowName(tb, r)}>
                    {rowName(tb, r)}
                  </button>
                ))}
                {list.length > 4 && <span className="muted small tb-cal-more">{t('+{n} more', { n: list.length - 4 })}</span>}
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
  const now = new Date(`${today}T12:00`);
  const diff = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  const date = fmtWeekday(d);
  return diff === 0 ? t('Today · {date}', { date }) : diff === 1 ? t('Tomorrow · {date}', { date }) : diff === -1 ? t('Yesterday · {date}', { date }) : date;
};

function AgendaRow({ t: tb, view, r, ctx, end, onOpenRow }: { t: DataTable; view?: TableViewDef; r: TableRow; ctx: CellCtx; end?: TableField; onOpenRow: (id: string) => void }) {
  const tint = view ? rowColors(tb, view, r, ctx).row : undefined;
  const until = end ? r.values[end.id] : null;
  return (
    <button type="button" className="tb-ag-row" onClick={() => onOpenRow(r.id)}>
      <i className="tb-dot" style={{ background: tint ?? tb.color }} />
      <span className="tb-ag-name">{rowName(tb, r)}</span>
      {typeof until === 'string' && until && <small className="muted">{t('until {date}', { date: fmtDay(until.slice(0, 10)) })}</small>}
    </button>
  );
}

/** Rows by date, from today on: earlier ones folded on top, undated ones at the end. */
export function Agenda({ table: tb, view, rows, ctx, field, end, onOpenRow, canAdd, onAddRow }: { table: DataTable; view?: TableViewDef; rows: TableRow[]; ctx: CellCtx; field: TableField; end?: TableField; onOpenRow: (id: string) => void; canAdd?: boolean; onAddRow?: (values: Record<string, CellValue>) => void }) {
  const today = localDay();
  const [earlier, setEarlier] = useState(false);
  // When no row has a date yet, the undated rows are the whole view: show them open rather than a near-empty screen.
  const [undatedOpen, setUndatedOpen] = useState(() => !rows.some((r) => !isEmpty(valueOf(tb, field, r, ctx))));
  const byDay = new Map<string, TableRow[]>();
  const undated: TableRow[] = [];
  for (const r of rows) {
    const v = valueOf(tb, field, r, ctx);
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
        <AgendaRow key={r.id} t={tb} view={view} r={r} ctx={ctx} end={end} onOpenRow={onOpenRow} />
      ))}
    </section>
  );
  return (
    <div className="tb-agenda">
      {past.length > 0 && (
        <>
          <button type="button" className="tb-ag-fold" onClick={() => setEarlier((x) => !x)} aria-expanded={earlier}>
            <ChevronRight size={15} className={`rot-chev ${earlier ? 'open' : ''}`} />
            {t('Earlier')} <span className="muted small">{past.reduce((n, k) => n + byDay.get(k)!.length, 0)}</span>
          </button>
          <div className={`fold ${earlier ? 'open' : ''}`}>
            <div className="fold-in">{past.map(day)}</div>
          </div>
        </>
      )}
      {!next.length && <p className="muted small tb-ag-none">{keys.length || !undated.length ? t('Nothing from today on.') : t('No row has a {field} yet. Open one to give it a date and it shows here by day.', { field: field.name.toLowerCase() })}</p>}
      {next.map(day)}
      {canAdd && onAddRow && field.type === 'date' && (
        <button type="button" className="tb-ag-add" onClick={() => onAddRow({ [field.id]: today })}>
          <Plus size={16} /> {t('New row today')}
        </button>
      )}
      {undated.length > 0 && (
        <>
          <button type="button" className="tb-ag-fold" onClick={() => setUndatedOpen((x) => !x)} aria-expanded={undatedOpen}>
            <ChevronRight size={15} className={`rot-chev ${undatedOpen ? 'open' : ''}`} />
            {t('Without {field}', { field: field.name.toLowerCase() })} <span className="muted small">{undated.length}</span>
          </button>
          <div className={`fold ${undatedOpen ? 'open' : ''}`}>
            <div className="fold-in">
              {undated.map((r) => (
                <AgendaRow key={r.id} t={tb} view={view} r={r} ctx={ctx} onOpenRow={onOpenRow} />
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
    <button type="button" className={`tb-pcal-day lp${out ? ' out' : ''}${today ? ' today' : ''}${picked ? ' on' : ''}`} aria-pressed={picked} aria-label={n ? t('{date}, {rows}', { date: fmtWeekdayLong(date), rows: tn(n, '{n} row', '{n} rows') }) : fmtWeekdayLong(date)} onClick={onPick} {...press}>
      <span className="tb-pcal-n">{date.getDate()}</span>
      <span className="tb-pcal-dots" aria-hidden>
        {Array.from({ length: Math.min(3, n) }, (_, i) => (
          <i key={i} />
        ))}
      </span>
    </button>
  );
}

function PhoneCalendar({ table: tb, view, rows, ctx, field: df, onOpenRow, onAddRow, onLongPressDay }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: CellCtx; field: TableField; onOpenRow: (id: string) => void; onAddRow?: (values: Record<string, CellValue>) => void; onLongPressDay?: (day: string) => void }) {
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
      const v = valueOf(tb, df, r, ctx);
      if (!isEmpty(v)) m.set(String(v).slice(0, 10), [...(m.get(String(v).slice(0, 10)) ?? []), r]);
    }
    return m;
  }, [rows, df, tb, ctx]);
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
            <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label={t('Previous month')}>
              <ChevronLeft size={20} />
            </button>
            <strong className="tb-pcal-month">{month.getFullYear() === new Date().getFullYear() ? fmtDate(month, { month: 'long' }) : fmtMonth(month)}</strong>
            <button type="button" className="icon-btn" onClick={() => go(1)} aria-label={t('Next month')}>
              <ChevronRight size={20} />
            </button>
          </>
        ) : (
          <strong>{t('By {field}', { field: df.name.toLowerCase() })}</strong>
        )}
        <span className="spacer" />
        <div className="segmented sm">
          <button type="button" className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
            {t('Month')}
          </button>
          <button type="button" className={mode === 'agenda' ? 'on' : ''} onClick={() => setMode('agenda')}>
            {t('Agenda')}
          </button>
        </div>
      </div>
      {mode === 'agenda' ? (
        <Agenda table={tb} view={view} rows={rows} ctx={ctx} field={df} onOpenRow={onOpenRow} canAdd={canAdd} onAddRow={onAddRow} />
      ) : (
        <>
          <div className="tb-pcal-grid">
            {weekdayNames('narrow').map((w, i) => (
              <span key={i} className="tb-pcal-wd" aria-hidden>
                {w}
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
              <AgendaRow key={r.id} t={tb} view={view} r={r} ctx={ctx} onOpenRow={onOpenRow} />
            ))}
            {!list.length && (
              <p className="muted small tb-ag-none">
                {t('Nothing on this day.')}
                {canAdd && onLongPressDay ? ` ${t('Hold a day to add a row on it.')}` : ''}
              </p>
            )}
            {canAdd && (
              <button type="button" className="tb-ag-add" onClick={() => (onLongPressDay ? onLongPressDay(picked) : onAddRow!({ [df.id]: picked }))}>
                <Plus size={16} /> {t('New row on this day')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
