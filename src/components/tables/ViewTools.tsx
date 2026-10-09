import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, UserRound, X } from 'lucide-react';
import type { DataTable, TableColorRule, TableField, TableFilter, TableFilterGroup, TableRow, TableViewDef, TableViewTweak, User } from '../../types';
import { uid } from '../../utils';
import { PickSelect } from '../ui/PickSelect';
import { PersonSelect } from '../ui/PeoplePicker';
import { DatePicker } from '../ui/DatePicker';
import { fieldIcon, opsFor, quickFilters, sortWords, type TCtx } from './fields';

/* The tools that shape a view: filter (quick values, then conditions with groups), sort, fields, group, colours.
   The same pieces sit in desktop popovers and in the phone's sheets. */

type FilterPatch = Pick<TableViewTweak, 'filters' | 'filterMode' | 'filterGroups'>;

const usableFields = (t: DataTable) => t.fields.filter((f) => f.type !== 'button');
const blank = (t: DataTable): TableFilter => {
  const f = usableFields(t).find((x) => x.type === 'select') ?? usableFields(t)[0];
  return { fieldId: f.id, op: opsFor(f.type)[0].op };
};

/** One condition: [field] [test] [value] and a remove button. Values come from the field's own choices and people. */
export function ConditionRow({ table, flt, lead, users, me, onChange, onRemove }: { table: DataTable; flt: TableFilter; lead: string; users: User[]; me?: string; onChange: (f: TableFilter) => void; onRemove: () => void }) {
  const usable = usableFields(table);
  const f = table.fields.find((x) => x.id === flt.fieldId) ?? usable[0];
  const set = (p: Partial<TableFilter>) => onChange({ ...flt, ...p });
  const needsValue = flt.op !== 'empty' && flt.op !== 'filled';
  const isDate = f.type === 'date' || f.type === 'created' || f.type === 'edited';
  return (
    <div className="tb-filter">
      <span className="tb-filter-lead">{lead}</span>
      <PickSelect
        value={f.id}
        aria-label="Field"
        onChange={(e) => {
          const nf = table.fields.find((x) => x.id === e.target.value)!;
          onChange({ fieldId: nf.id, op: opsFor(nf.type)[0].op });
        }}
      >
        {usable.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </PickSelect>
      <PickSelect value={flt.op} aria-label="Test" onChange={(e) => set({ op: e.target.value as TableFilter['op'] })}>
        {opsFor(f.type).map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </PickSelect>
      {needsValue ? (
        f.type === 'select' || f.type === 'multi' ? (
          <PickSelect value={flt.value ?? ''} aria-label="Value" onChange={(e) => set({ value: e.target.value })}>
            <option value="">Choose…</option>
            {(f.options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </PickSelect>
        ) : f.type === 'person' || f.type === 'creator' ? (
          <PersonSelect value={flt.value ?? ''} users={users} me={me} label="Person" extra={[{ value: '@me', label: 'Me (whoever is looking)', icon: <UserRound size={15} /> }]} onChange={(v) => set({ value: v })} />
        ) : f.type === 'checkbox' ? (
          <PickSelect value={flt.value ?? 'yes'} aria-label="Value" onChange={(e) => set({ value: e.target.value })}>
            <option value="yes">Checked</option>
            <option value="no">Not checked</option>
          </PickSelect>
        ) : isDate ? (
          <span className="tb-filter-date">
            <button type="button" className={`tb-chip linked${flt.value === '@today' ? ' on' : ''}`} onClick={() => set({ value: '@today' })}>
              Today
            </button>
            <DatePicker value={flt.value && flt.value !== '@today' ? flt.value : ''} onChange={(d) => set({ value: d })} label="Date" placeholder="A date" className="sel-flat" />
          </span>
        ) : (
          <input className="tb-native" inputMode={['number', 'money', 'rating', 'rollup'].includes(f.type) ? 'decimal' : undefined} value={flt.value ?? ''} placeholder="Value" aria-label="Value" onChange={(e) => set({ value: e.target.value })} />
        )
      ) : (
        <span />
      )}
      <button type="button" className="icon-btn sm tb-filter-x" aria-label="Remove condition" onClick={onRemove}>
        <X size={14} />
      </button>
    </div>
  );
}

/** All of these / Any of these. */
function ModeSwitch({ mode, onMode, small }: { mode: 'and' | 'or'; onMode: (m: 'and' | 'or') => void; small?: boolean }) {
  return (
    <div className={`segmented sm tb-filter-mode${small ? ' in-group' : ''}`}>
      <button type="button" className={mode === 'and' ? 'on' : ''} onClick={() => onMode('and')}>
        All of these
      </button>
      <button type="button" className={mode === 'or' ? 'on' : ''} onClick={() => onMode('or')}>
        Any of these
      </button>
    </div>
  );
}

/**
 * The filter: quick values with counts first ("Me 4", "Overdue 3", each status), then the conditions underneath,
 * with groups one level deep ("Status is New, and any of: Owner is me, Value over 10 million").
 */
export function FilterPanel({ table, view, rows, ctx, onChange }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: TCtx; onChange: (p: FilterPatch) => void }) {
  const filters = view.filters ?? [];
  const groups = view.filterGroups ?? [];
  const mode = view.filterMode ?? 'and';
  const quick = quickFilters(table, view, rows, ctx);
  const toggle = (flt: TableFilter, on: boolean) => {
    const others = filters.filter((x) => x.fieldId !== flt.fieldId);
    onChange({ filters: on ? others : [...others, flt] });
  };
  const setGroup = (id: string, p: Partial<TableFilterGroup>) => onChange({ filterGroups: groups.map((g) => (g.id === id ? { ...g, ...p } : g)) });
  const items = filters.length + groups.length;
  return (
    <div className="tb-filters">
      {quick.length > 0 && (
        <div className="tb-quick">
          {quick.map(({ field, items: chips }) => (
            <div key={field.id} className="tb-quick-sec">
              <span className="tb-quick-label">{field.name}</span>
              <div className="tb-quick-chips">
                {chips.map((c) => (
                  <button key={c.label} type="button" className={`tb-qchip${c.on ? ' on' : ''}`} aria-pressed={c.on} onClick={() => toggle(c.filter, c.on)}>
                    {c.color && <i className="tb-dot" style={{ background: c.color }} />}
                    <span>{c.label}</span>
                    <small>{c.count}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="tb-cond-head">
        <span className="tb-quick-label">Conditions</span>
        {items > 1 && <ModeSwitch mode={mode} onMode={(m) => onChange({ filterMode: m })} />}
      </div>
      {!items && <p className="muted small">Show only the rows you want: Status is New, Follow-up before today, Owner is you.</p>}
      {filters.map((flt, i) => (
        <ConditionRow key={`c${i}`} table={table} flt={flt} lead={i === 0 ? 'Where' : mode === 'and' ? 'and' : 'or'} users={ctx.users} me={ctx.me} onChange={(nf) => onChange({ filters: filters.map((x, j) => (j === i ? nf : x)) })} onRemove={() => onChange({ filters: filters.filter((_, j) => j !== i) })} />
      ))}
      {groups.map((g, gi) => (
        <div key={g.id} className="tb-fgroup">
          <div className="tb-fgroup-head">
            <span className="tb-filter-lead">{filters.length + gi === 0 ? 'Where' : mode === 'and' ? 'and' : 'or'}</span>
            <ModeSwitch mode={g.mode} onMode={(m) => setGroup(g.id, { mode: m })} small />
            <button type="button" className="icon-btn sm" aria-label="Remove group" onClick={() => onChange({ filterGroups: groups.filter((x) => x.id !== g.id) })}>
              <X size={14} />
            </button>
          </div>
          {g.filters.map((flt, i) => (
            <ConditionRow key={i} table={table} flt={flt} lead={i === 0 ? 'Where' : g.mode === 'and' ? 'and' : 'or'} users={ctx.users} me={ctx.me} onChange={(nf) => setGroup(g.id, { filters: g.filters.map((x, j) => (j === i ? nf : x)) })} onRemove={() => setGroup(g.id, { filters: g.filters.filter((_, j) => j !== i) })} />
          ))}
          <button type="button" className="link-btn small tb-fgroup-add" onClick={() => setGroup(g.id, { filters: [...g.filters, blank(table)] })}>
            <Plus size={13} /> Add a condition to this group
          </button>
        </div>
      ))}
      <div className="tb-filters-foot">
        <button type="button" className="link-btn small" onClick={() => onChange({ filters: [...filters, blank(table)] })}>
          <Plus size={13} /> Add a condition
        </button>
        <button type="button" className="link-btn small" onClick={() => onChange({ filterGroups: [...groups, { id: uid(), mode: 'or', filters: [blank(table)] }] })}>
          <Plus size={13} /> Add a group
        </button>
        {items > 0 && (
          <button type="button" className="link-btn small tb-clear-all" onClick={() => onChange({ filters: [], filterGroups: [] })}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

/** Sort by a field, then by another: each with words that fit it (A to Z, low to high, oldest first). */
export function SortEditor({ table, sorts, onChange }: { table: DataTable; sorts: { fieldId: string; dir: 'asc' | 'desc' }[]; onChange: (s: { fieldId: string; dir: 'asc' | 'desc' }[]) => void }) {
  const sortable = table.fields.filter((f) => f.type !== 'button' && f.type !== 'files');
  const set = (i: number, p: Partial<{ fieldId: string; dir: 'asc' | 'desc' }>) => onChange(sorts.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="tb-filters">
      {!sorts.length && <p className="muted small">Rows are in your own order. Sort to order them by a field instead.</p>}
      {sorts.map((s, i) => {
        const f = table.fields.find((x) => x.id === s.fieldId) ?? sortable[0];
        const [asc, desc] = sortWords(f.type);
        return (
          <div key={i} className="tb-filter tb-sort">
            <span className="tb-filter-lead">{i === 0 ? 'Sort by' : 'then by'}</span>
            <PickSelect value={f.id} aria-label="Field" onChange={(e) => set(i, { fieldId: e.target.value })}>
              {sortable.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </PickSelect>
            <PickSelect value={s.dir} aria-label="Direction" onChange={(e) => set(i, { dir: e.target.value as 'asc' | 'desc' })}>
              <option value="asc">{asc}</option>
              <option value="desc">{desc}</option>
            </PickSelect>
            <button type="button" className="icon-btn sm tb-filter-x" aria-label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          </div>
        );
      })}
      <div className="tb-filters-foot">
        <button type="button" className="link-btn small" onClick={() => onChange([...sorts, { fieldId: (sortable.find((f) => !sorts.some((s) => s.fieldId === f.id)) ?? sortable[0]).id, dir: 'asc' }])}>
          <Plus size={13} /> {sorts.length ? 'Then by…' : 'Add a sort'}
        </button>
        {sorts.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => onChange([])}>
            Back to your own order
          </button>
        )}
      </div>
    </div>
  );
}

/** Fields in this view: show or hide each, and move them (drag, or the arrows, which work on phones and keyboards). */
export function FieldsEditor({ t, view, onView, all: allIn }: { t: DataTable; view: TableViewDef; onView: (p: Partial<TableViewDef>) => void; all: TableField[] }) {
  const all = allIn;
  const hidden = new Set(view.hidden ?? []);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ids = all.map((f) => f.id);
  const move = (id: string, to: number) => {
    const rest = ids.filter((x) => x !== id);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
    onView({ order: rest });
  };
  const drop = (target: string) => {
    if (drag && drag !== target) move(drag, ids.filter((x) => x !== drag).indexOf(target));
    setDrag(null);
    setOver(null);
  };
  return (
    <div className="tab-edit-list tb-fields-edit">
      <p className="muted small">What this view shows, in this order.</p>
      {all.map((f, i) => {
        const isName = f.id === t.fields[0].id;
        const I = fieldIcon(f.type);
        return (
          <div
            key={f.id}
            className={`tab-edit-row${hidden.has(f.id) ? ' off' : ''}${over === f.id && drag !== f.id ? ' drop-line' : ''}`}
            draggable
            onDragStart={() => setDrag(f.id)}
            onDragOver={(e) => (e.preventDefault(), setOver(f.id))}
            onDrop={() => drop(f.id)}
            onDragEnd={() => (setDrag(null), setOver(null))}
          >
            <GripVertical size={14} className="muted tb-drag" />
            <I size={14} className="muted" />
            <span className="tab-edit-name">{f.name}</span>
            <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => move(f.id, i - 1)} aria-label={`Move ${f.name} up`}>
              <ArrowUp size={14} />
            </button>
            <button type="button" className="icon-btn sm" disabled={i === all.length - 1} onClick={() => move(f.id, i + 1)} aria-label={`Move ${f.name} down`}>
              <ArrowDown size={14} />
            </button>
            {!isName ? (
              <button type="button" className="icon-btn sm" onClick={() => onView({ hidden: hidden.has(f.id) ? [...hidden].filter((x) => x !== f.id) : [...hidden, f.id] })} aria-label={hidden.has(f.id) ? `Show ${f.name}` : `Hide ${f.name}`}>
                {hidden.has(f.id) ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            ) : (
              <small className="muted tb-name-note">name</small>
            )}
          </div>
        );
      })}
      <div className="tab-edit-foot">
        <button type="button" className="link-btn small" onClick={() => onView({ hidden: [] })}>
          Show all
        </button>
        <button type="button" className="link-btn small" onClick={() => onView({ hidden: all.filter((f) => f.id !== t.fields[0].id).map((f) => f.id) })}>
          Hide all
        </button>
      </div>
    </div>
  );
}

/** Group rows by a field, then (optionally) by another inside each group. On a board: columns, then swimlanes. */
export function GroupEditor({ t, view, onView, board }: { t: DataTable; view: TableViewDef; onView: (p: Partial<TableViewDef>) => void; board?: boolean }) {
  const groupable = t.fields.filter((f) => !['button', 'files', 'longtext', 'link'].includes(f.type));
  const selects = t.fields.filter((f) => f.type === 'select');
  const main = board ? (view.groupBy ?? selects[0]?.id ?? '') : (view.groupBy ?? '');
  return (
    <div className="tb-group-edit">
      <label className="tb-ge-row">
        <span>{board ? 'Columns from' : 'Group by'}</span>
        <PickSelect value={main} aria-label={board ? 'Columns from' : 'Group by'} onChange={(e) => onView({ groupBy: e.target.value || undefined, collapsed: [], subGroupBy: e.target.value && e.target.value !== view.subGroupBy ? view.subGroupBy : undefined })}>
          {!board && <option value="">No grouping</option>}
          {(board ? selects : groupable).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </PickSelect>
      </label>
      {main && (
        <label className="tb-ge-row">
          <span>{board ? 'Swimlanes by' : 'Then by'}</span>
          <PickSelect value={view.subGroupBy ?? ''} aria-label={board ? 'Swimlanes by' : 'Then group by'} onChange={(e) => onView({ subGroupBy: e.target.value || undefined })}>
            <option value="">{board ? 'No swimlanes' : 'Nothing'}</option>
            {groupable
              .filter((f) => f.id !== main)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </PickSelect>
        </label>
      )}
      <p className="muted small">{board ? 'Swimlanes split the board into rows, one for each value, each with all the columns.' : 'Rows gather under a heading for each value, with a count, and fold open and shut.'}</p>
    </div>
  );
}

const RULE_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

/** A first colour rule that's useful straight away: past a date in red (overdue), else a choice. */
function firstRule(t: DataTable, n: number): TableColorRule {
  const date = t.fields.find((f) => f.type === 'date');
  if (date && n === 0) return { id: uid(), when: { fieldId: date.id, op: 'lt', value: '@today' }, color: '#ef4444', target: 'row' };
  return { id: uid(), when: blank(t), color: RULE_COLORS[n % RULE_COLORS.length], target: 'row' };
}

/** Colour rules: rows (or one cell) that match get a tint, like overdue in red or won in green. */
export function ColorRulesEditor({ table, view, users, me, onView }: { table: DataTable; view: TableViewDef; users: User[]; me?: string; onView: (p: Partial<TableViewDef>) => void }) {
  const rules = view.colors ?? [];
  const set = (id: string, p: Partial<TableColorRule>) => onView({ colors: rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  return (
    <div className="tb-filters tb-colors-edit">
      {!rules.length && <p className="muted small">Tint the rows that need a look: Follow-up before today in red, Won in green. Only this view.</p>}
      {rules.map((r) => (
        <div key={r.id} className="tb-crule">
          <ConditionRow table={table} flt={r.when} lead="When" users={users} me={me} onChange={(when) => set(r.id, { when })} onRemove={() => onView({ colors: rules.filter((x) => x.id !== r.id) })} />
          <div className="tb-crule-look">
            <div className="tb-colors" role="radiogroup" aria-label="Colour">
              {RULE_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={r.color === c} className={`tb-dot big${r.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set(r.id, { color: c })} aria-label={c} />
              ))}
            </div>
            <div className="segmented sm">
              <button type="button" className={r.target === 'row' ? 'on' : ''} onClick={() => set(r.id, { target: 'row' })}>
                Whole row
              </button>
              <button type="button" className={r.target === 'cell' ? 'on' : ''} onClick={() => set(r.id, { target: 'cell' })}>
                Just {table.fields.find((f) => f.id === r.when.fieldId)?.name ?? 'the cell'}
              </button>
            </div>
          </div>
        </div>
      ))}
      <div className="tb-filters-foot">
        <button type="button" className="link-btn small" onClick={() => onView({ colors: [...rules, firstRule(table, rules.length)] })}>
          <Plus size={13} /> Add a colour rule
        </button>
      </div>
    </div>
  );
}

