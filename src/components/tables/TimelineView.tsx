import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CellValue, DataTable, TableField, TableRow, TableViewDef } from '../../types';
import { localDay, uid } from '../../utils';
import { usePersisted } from '../../settings';
import { EmptyState } from '../ui/EmptyState';
import { PickSelect } from '../ui/PickSelect';
import type { CellCtx } from './Cell';
import { isEmpty, rowColors, rowName, valueOf } from './fields';
import { Agenda } from './Views';

const DAY = 86_400_000;
// Days as whole numbers, worked out on the calendar date itself (UTC arithmetic), so no time zone can shift a day.
const toDay = (s: string) => Math.round(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / DAY);
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const dateOf = (n: number) => new Date(n * DAY);
const ZOOMS = { week: 40, month: 18, quarter: 7 } as const;
type Zoom = keyof typeof ZOOMS;

/**
 * A timeline: each row is a bar from its start date to its end date (a single day when there's no end). Drag a bar to
 * move it, drag its ends to change the dates, click it to open the row; click the empty line of an undated row to put
 * it on that day. On a narrow screen it reads as a list by date instead.
 */
export function TimelineView({ table: t, view, rows, ctx, onOpenRow, onValues, onView, onNewField, readOnly, narrow, canAdd, onAddRow }: {
  table: DataTable;
  view: TableViewDef;
  rows: TableRow[];
  ctx: CellCtx;
  onOpenRow: (id: string) => void;
  onValues: (rowId: string, values: Record<string, CellValue>) => void;
  onView: (p: Partial<TableViewDef>) => void;
  onNewField: (f: TableField) => void;
  readOnly?: boolean;
  narrow?: boolean;
  canAdd?: boolean;
  onAddRow?: (values: Record<string, CellValue>) => void;
}) {
  const sf = t.fields.find((f) => f.id === view.dateField && (f.type === 'date' || f.type === 'created')) ?? t.fields.find((f) => f.type === 'date');
  const ef = t.fields.find((f) => f.id === view.endField && f.type === 'date' && f.id !== sf?.id);
  const [zoom, setZoom] = usePersisted<Zoom>(`s2g-tl-zoom:${view.id}`, 'month');
  const dw = ZOOMS[zoom] ?? ZOOMS.month;
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'start' | 'end'; x0: number; delta: number; moved: boolean } | null>(null);
  const today = toDay(localDay());

  const spans = useMemo(() => {
    if (!sf) return new Map<string, { s: number; e: number }>();
    const m = new Map<string, { s: number; e: number }>();
    for (const r of rows) {
      const sv = valueOf(t, sf, r, ctx);
      if (isEmpty(sv)) continue;
      const s = toDay(String(sv));
      const ev = ef ? r.values[ef.id] : null;
      const e = typeof ev === 'string' && ev ? Math.max(s, toDay(ev)) : s;
      m.set(r.id, { s, e });
    }
    return m;
  }, [rows, sf, ef, t, ctx]);
  const all = [...spans.values()];
  const min = Math.min(today - 14, ...all.map((x) => x.s - 7));
  const max = Math.max(today + 60, ...all.map((x) => x.e + 21));
  const from = Math.max(min, max - 730);
  const days = Math.max(1, max - from + 1);

  // Open on today, a little in from the left edge.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (today - from - 3) * dw);
  }, [view.id, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, delta: Math.round((e.clientX - d.x0) / dw), moved: d.moved || Math.abs(e.clientX - d.x0) > 3 } : d));
    const up = (e: PointerEvent) => {
      const d0 = dragRef.current;
      setDrag(null);
      if (!d0) return;
      const d = { ...d0, delta: Math.round((e.clientX - d0.x0) / dw), moved: d0.moved || Math.abs(e.clientX - d0.x0) > 3 };
      const span = spans.get(d.id);
      if (!d.moved) return onOpenRow(d.id);
      if (!span || !d.delta || sf?.type !== 'date') return;
      const values: Record<string, CellValue> = {};
      if (d.mode !== 'end') values[sf.id] = fromDay(Math.min(span.s + d.delta, d.mode === 'start' ? span.e : Infinity));
      if (ef && d.mode !== 'start') values[ef.id] = fromDay(Math.max(span.e + d.delta, d.mode === 'end' ? span.s : -Infinity));
      if (ef && d.mode === 'move' && !rows.find((r) => r.id === d.id)?.values[ef.id]) delete values[ef.id];
      onValues(d.id, values);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sf)
    return (
      <EmptyState
        title="A timeline needs dates"
        text="Add a Start and an End date; each row then shows as a bar between them."
        action={
          !readOnly && (
            <button
              className="primary-btn sm"
              onClick={() => {
                const s: TableField = { id: uid(), name: 'Start', type: 'date' };
                const e: TableField = { id: uid(), name: 'End', type: 'date' };
                onNewField(s);
                onNewField(e);
                onView({ dateField: s.id, endField: e.id });
              }}
            >
              <Plus size={14} /> Add Start and End
            </button>
          )
        }
      />
    );
  if (narrow) return <Agenda table={t} view={view} rows={rows} ctx={ctx} field={sf} end={ef} onOpenRow={onOpenRow} canAdd={canAdd} onAddRow={onAddRow} />;

  const dates = t.fields.filter((f) => f.type === 'date' || f.type === 'created');
  const movable = !readOnly && sf.type === 'date' && (!ctx.canEdit || ctx.canEdit(sf.id));
  // Month labels over the days.
  const months: { left: number; width: number; label: string }[] = [];
  for (let i = 0; i < days; ) {
    const d = dateOf(from + i);
    const left = i;
    const next = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY);
    const n = Math.min(days - i, Math.max(1, next - (from + i)));
    months.push({ left: left * dw, width: n * dw, label: d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: d.getUTCFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) });
    i += n;
  }
  const dayLabels = dw >= 18;
  return (
    <div className="tb-tl-wrap">
      <div className="tb-tl-tools">
        <span className="muted small">From</span>
        <PickSelect value={sf.id} aria-label="Bars start at" onChange={(e) => onView({ dateField: e.target.value })}>
          {dates.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </PickSelect>
        <span className="muted small">to</span>
        <PickSelect value={ef?.id ?? ''} aria-label="Bars end at" onChange={(e) => onView({ endField: e.target.value || undefined })}>
          <option value="">Same day</option>
          {dates
            .filter((f) => f.type === 'date' && f.id !== sf.id)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </PickSelect>
        <span className="spacer" />
        <div className="segmented sm">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button key={z} type="button" className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>
              {z === 'week' ? 'Weeks' : z === 'month' ? 'Months' : 'Quarters'}
            </button>
          ))}
        </div>
        <button type="button" className="ghost-btn sm" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, (today - from - 3) * dw), behavior: 'smooth' })}>
          Today
        </button>
      </div>
      <div className="tb-tl" ref={scroller} style={{ ['--dw' as string]: `${dw}px`, ['--days' as string]: days }}>
        <div className="tb-tl-head">
          <div className="tb-tl-corner">{t.fields[0].name}</div>
          <div className="tb-tl-scale">
            <div className="tb-tl-months">
              {months.map((m, i) => (
                <span key={i} style={{ left: m.left, width: m.width }}>
                  {m.width > 40 ? m.label : ''}
                </span>
              ))}
            </div>
            <div className="tb-tl-days">
              {Array.from({ length: days }, (_, i) => {
                const d = dateOf(from + i);
                const wk = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                return (
                  <span key={i} className={`${from + i === today ? 'today' : ''}${wk ? ' wkend' : ''}`}>
                    {dayLabels ? d.getUTCDate() : d.getUTCDay() === 1 ? d.getUTCDate() : ''}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="tb-tl-body">
          <i className="tb-tl-now" style={{ left: `calc(var(--tl-name) + ${(today - from) * dw + dw / 2}px)` }} aria-hidden />
          {rows.map((r, i) => {
            const span = spans.get(r.id);
            const live = drag?.id === r.id ? drag : null;
            let s = span?.s ?? 0;
            let e = span?.e ?? 0;
            if (live && span) {
              if (live.mode === 'move') (s += live.delta), (e += live.delta);
              else if (live.mode === 'start') s = Math.min(e, s + live.delta);
              else e = Math.max(s, e + live.delta);
            }
            const tint = rowColors(t, view, r, ctx).row;
            const startDrag = (mode: 'move' | 'start' | 'end') => (ev: React.PointerEvent) => {
              if (ev.button > 0) return;
              ev.stopPropagation();
              if (!movable) return void (ev.preventDefault(), onOpenRow(r.id));
              setDrag({ id: r.id, mode, x0: ev.clientX, delta: 0, moved: false });
            };
            return (
              <div key={r.id} className="tb-tl-row" style={{ ['--i' as string]: Math.min(i, 20) }}>
                <button type="button" className="tb-tl-name" onClick={() => onOpenRow(r.id)} title={rowName(t, r)}>
                  {rowName(t, r)}
                </button>
                <div
                  className="tb-tl-track"
                  onClick={(ev) => {
                    if (span || !movable) return;
                    const box = ev.currentTarget.getBoundingClientRect();
                    const day = from + Math.floor((ev.clientX - box.left) / dw);
                    onValues(r.id, { [sf.id]: fromDay(day), ...(ef ? { [ef.id]: fromDay(day) } : {}) });
                  }}
                  title={span ? undefined : movable ? 'Click a day to put it there' : undefined}
                >
                  {span && (
                    <div
                      className={`tb-tl-bar${live?.moved ? ' dragging' : ''}`}
                      style={{ left: (s - from) * dw, width: (e - s + 1) * dw, ...(tint ? { ['--c' as string]: tint } : {}) }}
                      onPointerDown={startDrag('move')}
                      role="button"
                      tabIndex={0}
                      aria-label={`${rowName(t, r)}: ${fromDay(s)}${e !== s ? ` to ${fromDay(e)}` : ''}`}
                      onKeyDown={(ev) => ev.key === 'Enter' && onOpenRow(r.id)}
                    >
                      {movable && <span className="tb-tl-grip start" onPointerDown={startDrag('start')} aria-hidden />}
                      <span className="tb-tl-label">{rowName(t, r)}</span>
                      {movable && ef && <span className="tb-tl-grip end" onPointerDown={startDrag('end')} aria-hidden />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!readOnly && canAdd && onAddRow && (
            <button type="button" className="tb-grid-add tb-tl-add" onClick={() => onAddRow({ [sf.id]: localDay(), ...(ef ? { [ef.id]: localDay() } : {}) })}>
              <Plus size={14} /> New row
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
