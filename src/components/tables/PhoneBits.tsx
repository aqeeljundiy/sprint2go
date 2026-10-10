import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDownLeft, ArrowUpDown, Check, ChevronLeft, ChevronRight, Copy, CopyPlus, Download, Eye, FileUp, Filter, Group, Info, LayoutTemplate, Palette, PencilLine, Plus, Share2, SlidersHorizontal, Trash2, Users, X, Zap } from 'lucide-react';
import type { CellValue, Client, DataTable, RowTemplate, TableField, TableFilter, TableRow, TableViewDef } from '../../types';
import { Sheet } from '../ui/Sheet';
import { TabPane } from '../ui/Smooth';
import { ProjectPicker } from '../ProjectPicker';
import { useFocusedScreen } from '../../mobile/chrome';
import { relative } from '../../utils';
import { term } from '../../terms';
import type { CellCtx } from './Cell';
import { CardSettings, cardFieldsOf } from './BoardView';
import { ColorRulesEditor, FieldsEditor, FilterPanel, GroupEditor, SortEditor } from './ViewTools';
import { EditSheet } from './EditSheet';
import { VIEW_KINDS, viewIcon, viewName } from './viewKinds';
import { TABLE_COLORS, fieldIcon, filterCount, isComputed, quickFilters, repeatWords, sortsOf, viewFields, type TCtx } from './fields';
import { statusFieldOf } from './CardList';
import { t, tn, tx, textOf } from '../../i18n';

/* The phone's pieces for Tables: the views sheet, filter and settings sheets, quick create, picking several rows. */

/** The views of a table, with a tick on the one showing and "Add a view" for people who may. */
export function ViewsSheet({ table, current, onPick, onAdd, onClose, gridAsList }: { table: DataTable; current: string; gridAsList?: (viewId: string) => boolean; onPick: (id: string) => void; onAdd?: (kind: TableViewDef['kind']) => void; onClose: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <Sheet title={adding ? t('Add a view') : t('Views')} onClose={onClose} className="tb-sheet" head={adding && <button type="button" className="ghost-btn sm" onClick={() => setAdding(false)}>{t('Back')}</button>}>
      <TabPane key={adding ? 'add' : 'list'}>
        <div className="as-list">
          {adding
            ? VIEW_KINDS.map(({ kind, name, icon: I, hint }) => (
                <button key={kind} type="button" className="as-item" onClick={() => (onAdd!(kind), onClose())}>
                  <I size={18} className="as-icon" />
                  <span className="as-label">
                    {name}
                    <small>{hint}</small>
                  </span>
                </button>
              ))
            : table.views.map((v) => {
                const I = viewIcon(v.kind === 'grid' && gridAsList?.(v.id) ? 'list' : v.kind); // a grid shows as rows on a phone
                return (
                  <button key={v.id} type="button" className="as-item" aria-current={v.id === current} onClick={() => (onPick(v.id), onClose())}>
                    <I size={18} className="as-icon" />
                    <span className="as-label">{viewName(v, v.kind === 'grid' && gridAsList?.(v.id) ? 'list' : v.kind)}</span>
                    {v.id === current && <Check size={18} className="as-check" />}
                  </button>
                );
              })}
          {!adding && onAdd && (
            <>
              <div className="as-sep" role="separator" />
              <button type="button" className="as-item" onClick={() => setAdding(true)}>
                <Plus size={18} className="as-icon" />
                <span className="as-label">{t('Add a view')}</span>
              </button>
            </>
          )}
        </div>
      </TabPane>
    </Sheet>
  );
}

/**
 * The filter on a phone (Notion's one menu): what's filtered now, then the fields to filter by. A field opens its
 * values inside the sheet (a tick on the one in use, counts on the right); results change as you tick, and the count
 * is in the title. The full conditions builder is behind "Advanced filter".
 */
export function FilterSheet({ table, view, rows, ctx, shown, onChange, onClose }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: TCtx; shown: number; onChange: Parameters<typeof FilterPanel>[0]['onChange']; onClose: () => void }) {
  const [page, setPage] = useState<string | null>(null); // a field's id, 'advanced', or null for the menu
  const filters = view.filters ?? [];
  const groups = view.filterGroups ?? [];
  const quick = quickFilters(table, view, rows, ctx);
  const qOf = (fieldId: string) => quick.find((q) => q.field.id === fieldId);
  const summary = (flt: TableFilter) => qOf(flt.fieldId)?.items.find((i) => i.on && i.filter.op === flt.op && (i.filter.value ?? '') === (flt.value ?? ''))?.label ?? t('Custom condition');
  const pick = (flt: TableFilter, on: boolean) => {
    const others = filters.filter((x) => x.fieldId !== flt.fieldId);
    onChange({ filters: on ? others : [...others, flt] });
  };
  const remove = (i: number) => onChange({ filters: filters.filter((_, j) => j !== i) });
  const field = page && page !== 'advanced' ? qOf(page) : undefined;
  const title = page === 'advanced' ? t('Advanced filter') : field ? field.field.name : t('Filter');
  return (
    <Sheet
      title={
        <span className="tb-fs-title">
          {title}
          <small>{tn(shown, '{n} row', '{n} rows')}</small>
        </span>
      }
      label={title}
      onClose={onClose}
      size={page === 'advanced' ? 'tall' : 'auto'}
      className="tb-sheet tb-filter-sheet"
      head={
        page ? (
          <button type="button" className="tb-fs-head-btn" onClick={() => setPage(null)}>
            <ChevronLeft size={18} /> {t('Back')}
          </button>
        ) : (
          <button type="button" className="tb-fs-head-btn strong" onClick={onClose}>
            {t('Done')}
          </button>
        )
      }
    >
      <TabPane key={page ?? 'menu'}>
        {page === 'advanced' ? (
          <FilterPanel table={table} view={view} rows={rows} ctx={ctx} onChange={onChange} />
        ) : field ? (
          <div className="as-list">
            {field.items.map((c) => (
              <button key={c.label} type="button" className="as-item tb-fs-val" aria-pressed={c.on} onClick={() => pick(c.filter, c.on)}>
                {c.color ? <i className="tb-fs-tag" style={{ ['--c' as string]: c.color }}>{c.label}</i> : <span className="as-label">{c.label}</span>}
                {c.color && <span className="as-label" />}
                <small className="tb-fs-count">{c.count}</small>
                <Check size={18} className={`as-check tb-fs-tick${c.on ? ' on' : ''}`} />
              </button>
            ))}
          </div>
        ) : (
          <div className="as-list">
            {filters.length + groups.length > 0 && (
              <>
                {filters.map((flt, i) => {
                  const f = table.fields.find((x) => x.id === flt.fieldId);
                  if (!f) return null;
                  const I = fieldIcon(f.type);
                  return (
                    <div key={i} className="tb-fs-on">
                      <button type="button" className="as-item" onClick={() => setPage(qOf(f.id) ? f.id : 'advanced')}>
                        <I size={18} className="as-icon" />
                        <span className="as-label">{f.name}</span>
                        <small className="tb-fs-sum">{summary(flt)}</small>
                        <ChevronRight size={16} className="tb-fs-chev" />
                      </button>
                      <button type="button" className="icon-btn tb-fs-x" aria-label={t('Remove the filter on {field}', { field: f.name })} onClick={() => remove(i)}>
                        <X size={16} />
                      </button>
                    </div>
                  );
                })}
                {groups.length > 0 && (
                  <button type="button" className="as-item" onClick={() => setPage('advanced')}>
                    <Filter size={18} className="as-icon" />
                    <span className="as-label">{tn(groups.length, '{n} group of conditions', '{n} groups of conditions')}</span>
                    <ChevronRight size={16} className="tb-fs-chev" />
                  </button>
                )}
                <button type="button" className="as-item danger" onClick={() => onChange({ filters: [], filterGroups: [] })}>
                  <X size={18} className="as-icon" />
                  <span className="as-label">{t('Clear all')}</span>
                </button>
                <div className="as-sep" role="separator" />
              </>
            )}
            <p className="tb-fs-head">{t('Filter by')}</p>
            {quick.map(({ field: f }) => {
              const I = fieldIcon(f.type);
              return (
                <button key={f.id} type="button" className="as-item" onClick={() => setPage(f.id)}>
                  <I size={18} className="as-icon" />
                  <span className="as-label">{f.name}</span>
                  <ChevronRight size={16} className="tb-fs-chev" />
                </button>
              );
            })}
            <button type="button" className="as-item" onClick={() => setPage('advanced')}>
              <SlidersHorizontal size={18} className="as-icon" />
              <span className="as-label">{t('Advanced filter')}</span>
              <ChevronRight size={16} className="tb-fs-chev" />
            </button>
          </div>
        )}
      </TabPane>
    </Sheet>
  );
}

/** "2 filters · Clear": the line under a narrow toolbar while something is filtered or sorted. */
export function FilterLine({ phone, table, view, base, differs, canSave, onClear, onReset, onSave, onOpen }: { phone?: boolean; table: DataTable; view: TableViewDef; base: TableViewDef; differs: boolean; canSave: boolean; onClear: () => void; onReset: () => void; onSave: () => void; onOpen: () => void }) {
  const n = filterCount(table, view);
  const sorts = sortsOf(view);
  // Reset is only worth showing when it does something Clear doesn't: everyone's view has filters, or the sort differs.
  const resetDiffers = filterCount(table, base) > 0 || JSON.stringify(sorts) !== JSON.stringify(sortsOf(base));
  // Phones: "2 filters · Clear" only while something is filtered (the Sort button shows its own state).
  const on = phone ? n > 0 : n > 0 || differs;
  const sortName = sorts[0] ? table.fields.find((f) => f.id === sorts[0].fieldId)?.name : '';
  return (
    <div className={`fold ${on ? 'open' : ''}`}>
      <div className="fold-in">
        <div className="tb-fline" aria-live="polite">
          <button type="button" className="tb-fline-what" onClick={onOpen}>
            <Filter size={14} />
            <span>
              {n ? tn(n, '{n} filter', '{n} filters') : t('No filters')}
              {sortName && !phone ? ` · ${t('by {field}', { field: sortName })}` : ''}
            </span>
          </button>
          {n > 0 && (
            <button type="button" className="link-btn small" onClick={onClear}>
              {t('Clear')}
            </button>
          )}
          <span className="spacer" />
          {!phone && differs && (resetDiffers || !n) && (
            <button type="button" className="link-btn small" onClick={onReset} title={t('Back to what everyone sees')}>
              {t('Reset')}
            </button>
          )}
          {!phone && differs && canSave && (
            <button type="button" className="link-btn small strong" onClick={onSave}>
              {t('Save for everyone')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A row in a settings list: icon, label, what it's set to, and a chevron when it opens a page. */
function SetRow({ icon: I, label, hint, onClick, danger, chevron = true }: { icon: typeof Plus; label: string; hint?: string; onClick: () => void; danger?: boolean; chevron?: boolean }) {
  return (
    <button type="button" className={`as-item${danger ? ' danger' : ''}`} onClick={onClick}>
      <I size={18} className="as-icon" />
      <span className="as-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {chevron && <ChevronRight size={16} className="as-icon" />}
    </button>
  );
}

export interface SettingsActions {
  structure: boolean; // may change how the table works (views, fields, automations)
  canDelete: boolean;
  onView: (p: Partial<TableViewDef>) => void; // the shared view (people who may)
  onMine: (p: { sorts?: TableViewDef['sorts'] }) => void; // this person's own sort
  onPatchTable: (p: Partial<DataTable>) => void;
  onDuplicateView: () => void;
  onDeleteView: () => void;
  onKind: (kind: TableViewDef['kind']) => void;
  onShare?: () => void;
  onAutomations: () => void;
  onTemplates: () => void;
  onImport?: () => void;
  onDownload?: () => void;
  onDeleteTable: () => void;
  onNewField: (f: TableField) => void;
  layout?: { cards: boolean; set: (cards: boolean) => void }; // a grid view on a narrow screen
  clients: Client[];
  toast: (text: string) => void;
}

type Page = 'root' | 'sort' | 'group' | 'fields' | 'cards' | 'colors' | 'view' | 'table' | 'auto';

/**
 * Everything about the view and the table on a phone, in one sheet: sort, group, fields, what cards show, colours,
 * the view itself, then the table (automations, sharing, templates, download, delete). Each opens a page in the sheet.
 */
export function SettingsSheet({ table: tb, view, ctx, a, onClose, start = 'root' }: { table: DataTable; view: TableViewDef; ctx: TCtx; a: SettingsActions; onClose: () => void; start?: 'root' | 'sort' }) {
  const [page, setPage] = useState<Page>(start);
  const sorts = sortsOf(view);
  const fname = (id?: string) => tb.fields.find((f) => f.id === id)?.name;
  const hidden = view.hidden?.length ?? 0;
  const status = statusFieldOf(tb, view);
  const showsCards = view.kind === 'board' || view.kind === 'gallery' || ((view.kind === 'grid' || view.kind === 'list') && (a.layout?.cards ?? true));
  const titles: Record<Page, string> = { root: t('Settings'), sort: t('Sort'), group: view.kind === 'board' ? t('Columns') : t('Group'), fields: t('Fields'), cards: t('On each card'), colors: t('Colours'), view: t('This view'), table: t('This table'), auto: t('Automations') };
  const back = page !== 'root' && (
    <button type="button" className="icon-btn tb-sheet-back" aria-label={t('Back to settings')} onClick={() => setPage(page === 'auto' ? 'root' : 'root')}>
      <ChevronLeft size={20} />
    </button>
  );
  let body: ReactNode;
  if (page === 'sort') body = <SortEditor table={tb} sorts={sorts} onChange={(s) => a.onMine({ sorts: s })} />;
  else if (page === 'group') body = <GroupEditor t={tb} view={view} onView={a.onView} board={view.kind === 'board'} />;
  else if (page === 'fields') body = <FieldsEditor t={tb} view={view} onView={a.onView} all={viewFields(tb, view, true)} />;
  else if (page === 'cards') body = <CardSettings table={tb} view={view} group={view.kind === 'board' ? tb.fields.find((f) => f.id === view.groupBy) : status} shown={cardFieldsOf(tb, view, view.kind === 'board' ? tb.fields.find((f) => f.id === view.groupBy) : status)} onView={a.onView} />;
  else if (page === 'colors') body = <ColorRulesEditor table={tb} view={view} users={ctx.users} me={ctx.me} onView={a.onView} />;
  else if (page === 'view') body = <ViewPage t={tb} view={view} a={a} onDone={onClose} />;
  else if (page === 'table') body = <TablePage t={tb} a={a} />;
  else if (page === 'auto') body = <AutomationsPhone t={tb} a={a} />;
  else
    body = (
      <div className="as-list">
        {a.layout && (view.kind === 'grid' || view.kind === 'list') && (
          <div className="tb-set-seg">
            <span>{t('Show as')}</span>
            <div className="segmented sm">
              <button type="button" className={a.layout.cards ? 'on' : ''} onClick={() => a.layout!.set(true)}>
                {t('Cards')}
              </button>
              <button type="button" className={!a.layout.cards ? 'on' : ''} onClick={() => a.layout!.set(false)}>
                {view.kind === 'list' ? tx('view', 'List') : tx('view', 'Table')}
              </button>
            </div>
          </div>
        )}
        {view.kind !== 'calendar' && <SetRow icon={ArrowUpDown} label={t('Sort')} hint={sorts.length ? t('By {fields} (just for you)', { fields: sorts.map((s) => fname(s.fieldId)).filter(Boolean).join(t(', then ')) }) : t('Your own order')} onClick={() => setPage('sort')} />}
        {a.structure && (view.kind === 'grid' || view.kind === 'list' || view.kind === 'board') && <SetRow icon={Group} label={titles.group} hint={view.groupBy ? (view.subGroupBy ? t('By {field}, then {sub}', { field: fname(view.groupBy) ?? '', sub: fname(view.subGroupBy) ?? '' }) : t('By {field}', { field: fname(view.groupBy) ?? '' })) : t('Not grouped')} onClick={() => setPage('group')} />}
        {a.structure && showsCards && <SetRow icon={SlidersHorizontal} label={t('On each card')} hint={cardFieldsOf(tb, view, status).slice(0, 3).map((f) => f.name).join(', ') || t('Just the name')} onClick={() => setPage('cards')} />}
        {a.structure && !showsCards && <SetRow icon={Eye} label={t('Fields')} hint={hidden ? tn(hidden, '{n} hidden', '{n} hidden') : t('All shown')} onClick={() => setPage('fields')} />}
        {a.structure && view.kind !== 'calendar' && view.kind !== 'timeline' && <SetRow icon={Palette} label={t('Colours')} hint={view.colors?.length ? tn(view.colors.length, '{n} rule', '{n} rules') : t('None')} onClick={() => setPage('colors')} />}
        {a.structure && <SetRow icon={PencilLine} label={t('This view')} hint={t('{view}: rename, show as, duplicate, delete', { view: view.name })} onClick={() => setPage('view')} />}
        <div className="as-sep" role="separator" />
        {a.structure && <SetRow icon={Zap} label={t('Automations')} hint={tb.rules?.length ? tn(tb.rules.length, '{on} of {n} rule on', '{on} of {n} rules on', { on: tb.rules.filter((r) => r.enabled).length }) : tb.intake?.enabled ? t('Data coming in is on') : t('Rules and data coming in')} onClick={() => setPage('auto')} />}
        {a.onShare && <SetRow icon={Users} label={t('Share with guests')} hint={tb.share?.enabled ? t('The {project}’s guests can open it', { project: term.one }) : t('Not shared')} onClick={() => (onClose(), a.onShare!())} chevron={false} />}
        {a.structure && <SetRow icon={LayoutTemplate} label={t('Row templates')} hint={tb.templates?.length ? tb.templates.map((x) => x.name).join(', ') : t('Rows to start from')} onClick={() => (onClose(), a.onTemplates())} chevron={false} />}
        {a.structure && <SetRow icon={Info} label={t('This table')} hint={t('Name, description, colour, where it belongs')} onClick={() => setPage('table')} />}
        {a.onDownload && <SetRow icon={Download} label={t('Download CSV')} onClick={() => (onClose(), a.onDownload!())} chevron={false} />}
        {a.canDelete && <SetRow icon={Trash2} label={t('Delete table')} danger onClick={() => (onClose(), a.onDeleteTable())} chevron={false} />}
      </div>
    );
  return (
    <Sheet
      title={titles[page]}
      onClose={onClose}
      size="tall"
      className="tb-sheet tb-set-sheet"
      head={
        <>
          {back}
          {page !== 'root' && (
            <button type="button" className="ghost-btn sm" onClick={onClose}>
              {t('Done')}
            </button>
          )}
        </>
      }
    >
      <TabPane key={page}>{body}</TabPane>
    </Sheet>
  );
}

function ViewPage({ t: tb, view, a, onDone }: { t: DataTable; view: TableViewDef; a: SettingsActions; onDone: () => void }) {
  const [name, setName] = useState(view.name);
  useEffect(() => setName(view.name), [view.id, view.name]);
  const save = () => name.trim() && name.trim() !== view.name && a.onView({ name: name.trim() });
  return (
    <div className="tb-set-page">
      <label className="field">
        <span>{t('Name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={t('View name')} enterKeyHint="done" />
      </label>
      <div className="field">
        <span>{t('Show as')}</span>
        <div className="tb-kind-pick">
          {VIEW_KINDS.map(({ kind, name: n, icon: I }) => (
            <button key={kind} type="button" className={view.kind === kind ? 'on' : ''} aria-pressed={view.kind === kind} onClick={() => a.onKind(kind)}>
              <I size={18} />
              <span>{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="as-list">
        <button type="button" className="as-item" onClick={() => (a.onDuplicateView(), onDone())}>
          <CopyPlus size={18} className="as-icon" />
          <span className="as-label">{t('Duplicate this view')}</span>
        </button>
        {tb.views.length > 1 && (
          <button type="button" className="as-item danger" onClick={() => (a.onDeleteView(), onDone())}>
            <Trash2 size={18} className="as-icon" />
            <span className="as-label">{t('Delete this view')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function TablePage({ t: tb, a }: { t: DataTable; a: SettingsActions }) {
  const [name, setName] = useState(tb.name);
  const [desc, setDesc] = useState(tb.description ?? '');
  return (
    <div className="tb-set-page">
      <label className="field">
        <span>{t('Name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== tb.name && a.onPatchTable({ name: name.trim() })} aria-label={t('Table name')} enterKeyHint="done" />
      </label>
      <label className="field">
        <span>{t('What it’s for')}</span>
        <textarea rows={2} value={desc} placeholder={t('A line for everyone who opens it')} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc.trim() !== (tb.description ?? '') && a.onPatchTable({ description: desc.trim() || undefined })} />
      </label>
      <div className="field">
        <span>{t('Colour')}</span>
        <div className="tb-colors" role="radiogroup" aria-label={t('Colour')}>
          {TABLE_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={tb.color === c} className={`tb-dot big${tb.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => a.onPatchTable({ color: c })} aria-label={c} />
          ))}
        </div>
      </div>
      <div className="field">
        <span>{t('Belongs to')}</span>
        <ProjectPicker value={tb.clientId ?? ''} onChange={(v) => a.onPatchTable({ clientId: v || undefined })} projects={a.clients} none={t('Whole company')} label={t('Belongs to')} />
      </div>
      {a.onImport && (
        <button type="button" className="ghost-btn" onClick={a.onImport}>
          <FileUp size={15} /> {t('Import a CSV')}
        </button>
      )}
    </div>
  );
}

/**
 * Automations on a phone: run them, don't build them. Each rule with an on/off switch, the address data comes in at
 * (copy or share it, switch it on or off) and the last deliveries. Setting them up stays a job for a computer.
 */
function AutomationsPhone({ t: tb, a }: { t: DataTable; a: SettingsActions }) {
  const rules = tb.rules ?? [];
  const url = tb.intake ? `${location.origin}/api/hooks/${tb.intake.token}` : '';
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('{table}: where data comes in', { table: tb.name }), url });
      else await navigator.clipboard?.writeText(url).then(() => a.toast(t('Address copied')));
    } catch {
      /* they closed the share sheet */
    }
  };
  return (
    <div className="tb-set-page">
      <h4 className="tb-set-h">{t('Rules')}</h4>
      {!rules.length && <p className="muted small">{t('No rules yet. Rules are set up on a computer: Automations, Rules.')}</p>}
      <div className="tb-rule-list">
        {rules.map((r) => (
          <div key={r.id} className="tb-rule-row">
            <span className="tb-rule-text">
              <strong>{r.name}</strong>
              <small className="muted">{r.on === 'schedule' && r.schedule ? t('On a schedule') : r.on === 'created' ? t('When a row is added') : r.on === 'updated' ? t('When a row changes') : t('When {field} changes', { field: tb.fields.find((f) => f.id === r.fieldId)?.name ?? t('a field') })}</small>
            </span>
            <button type="button" role="switch" aria-checked={r.enabled} aria-label={r.enabled ? t('{name}: on', { name: r.name }) : t('{name}: off', { name: r.name })} className={`switch ${r.enabled ? 'on' : ''}`} onClick={() => a.onPatchTable({ rules: rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) })}>
              <span />
            </button>
          </div>
        ))}
      </div>
      <h4 className="tb-set-h">{t('Data coming in')}</h4>
      {tb.intake ? (
        <>
          <div className="tb-rule-row">
            <span className="tb-rule-text">
              <strong>
                <ArrowDownLeft size={14} /> {tb.intake.enabled ? t('Adding rows from forms and other apps') : t('Not adding rows yet')}
              </strong>
              <small className="muted tb-url">{url}</small>
            </span>
            {(tb.intake.enabled || Object.values(tb.intake.mapping).some(Boolean)) && (
              <button type="button" role="switch" aria-checked={tb.intake.enabled} aria-label={t('Data coming in')} className={`switch ${tb.intake.enabled ? 'on' : ''}`} onClick={() => a.onPatchTable({ intake: { ...tb.intake!, enabled: !tb.intake!.enabled } })}>
                <span />
              </button>
            )}
          </div>
          <div className="tb-set-btns">
            <button type="button" className="ghost-btn" onClick={() => void navigator.clipboard?.writeText(url).then(() => a.toast(t('Address copied')))}>
              <Copy size={15} /> {t('Copy address')}
            </button>
            <button type="button" className="ghost-btn" onClick={() => void share()}>
              <Share2 size={15} /> {t('Share')}
            </button>
          </div>
          {(tb.log ?? []).slice(-3).reverse().map((l, i) => (
            <p key={i} className={`small tb-log-line${l.ok ? '' : ' bad'}`}>
              {textOf(l)} <span className="muted">· {relative(l.at)}</span>
            </p>
          ))}
        </>
      ) : (
        <p className="muted small">{t('Forms, ads and other apps can add rows here. Set up the address on a computer: Automations, Data coming in.')}</p>
      )}
      <button type="button" className="link-btn small tb-set-full" onClick={a.onAutomations}>
        {t('Open the full setup')}
      </button>
    </div>
  );
}

/**
 * Quick create: the name only (fields come later), from a template when there are some, with "Create and add
 * another" for runs of rows. The sheet opens with the keyboard up.
 */
export function QuickCreate({ table, title, inputRef, onCreate, onClose }: { table: DataTable; title?: string; inputRef: React.RefObject<HTMLInputElement | null>; onCreate: (name: string, tpl: RowTemplate | undefined, again: boolean) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const templates = table.templates ?? [];
  const [tpl, setTpl] = useState<string>(templates.find((x) => x.isDefault)?.id ?? '');
  const chosen = templates.find((x) => x.id === tpl);
  const first = table.fields[0];
  const go = (again: boolean) => {
    onCreate(name.trim(), chosen, again);
    if (again) {
      setName('');
      inputRef.current?.focus();
    }
  };
  return (
    <Sheet
      title={title ?? t('New row in {group}', { group: table.name })}
      onClose={onClose}
      className="tb-sheet tb-quick-sheet"
      footer={
        <>
          <button type="button" className="ghost-btn" onClick={() => go(true)}>
            {t('Create and add another')}
          </button>
          <button type="button" className="primary-btn" onClick={() => go(false)}>
            {t('Create')}
          </button>
        </>
      }
    >
      <div className="tb-sheet-field">
        <input ref={inputRef} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={chosen ? `${first.name} (${chosen.name})` : first.name} aria-label={first.name} enterKeyHint="done" autoCapitalize="sentences" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go(false))} />
      </div>
      {templates.length > 0 && (
        <div className="tb-tpl-chips" role="radiogroup" aria-label={t('Start from')}>
          <button type="button" role="radio" aria-checked={!tpl} className={`tb-qchip${!tpl ? ' on' : ''}`} onClick={() => setTpl('')}>
            {tx('template', 'Blank')}
          </button>
          {templates.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={tpl === x.id} className={`tb-qchip${tpl === x.id ? ' on' : ''}`} onClick={() => setTpl(x.id)} title={x.repeat ? repeatWords(x.repeat) : undefined}>
              {x.name}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** Opens a sheet with its field focused inside the tap, so a phone's keyboard comes up (iPhone wants that). */
export function openWithFocus(open: () => void, input: React.RefObject<HTMLInputElement | null>) {
  flushSync(open);
  input.current?.focus();
}

/**
 * Picking several rows on a phone: the bar that takes the tab bar's place. Change a field for all of them, duplicate,
 * delete; Cancel stops picking.
 */
export function BulkBar({ count, onEdit, onDuplicate, onDelete, onAll, onCancel, phone, canDelete }: { count: number; onEdit: () => void; onDuplicate?: () => void; onDelete?: () => void; onAll?: () => void; onCancel: () => void; phone: boolean; canDelete: boolean }) {
  useFocusedScreen(phone);
  return (
    <div className={`tb-bulkbar${phone ? ' phone' : ''}`} role="toolbar" aria-label={t('{n} selected', { n: count })}>
      <button type="button" className="icon-btn" onClick={onCancel} aria-label={t('Stop selecting')} title={t('Stop selecting (Esc)')}>
        <X size={18} />
      </button>
      <strong className="tb-bulk-n">{t('{n} selected', { n: count })}</strong>
      {onAll && (
        <button type="button" className="ghost-btn sm tb-bulk-all" onClick={onAll}>
          {t('All')}
        </button>
      )}
      <span className="spacer" />
      <button type="button" className="ghost-btn sm tb-bulk-edit" disabled={!count} onClick={onEdit}>
        <PencilLine size={15} /> <span>{phone ? t('Change') : t('Change a field')}</span>
      </button>
      {onDuplicate && (
        <button type="button" className="ghost-btn sm" disabled={!count} onClick={onDuplicate} aria-label={t('Duplicate')}>
          <CopyPlus size={15} /> <span className="lbl">{t('Duplicate')}</span>
        </button>
      )}
      {canDelete && onDelete && (
        <button type="button" className="ghost-btn sm danger" disabled={!count} onClick={onDelete} aria-label={t('Delete')}>
          <Trash2 size={15} /> <span className="lbl">{t('Delete')}</span>
        </button>
      )}
    </div>
  );
}

/** Change one field on every picked row: choose the field, then its value (the same editor as one cell). */
export function BulkEditSheet({ table, rows, ctx, onApply, onClose }: { table: DataTable; rows: TableRow[]; ctx: CellCtx; onApply: (fieldId: string, v: CellValue) => void; onClose: () => void }) {
  const [field, setField] = useState<TableField | null>(null);
  const pending = useRef<{ v: CellValue } | null>(null);
  const editable = table.fields.filter((f) => !isComputed(f) && f.type !== 'button' && (!ctx.canEdit || ctx.canEdit(f.id)));
  if (field && field.type === 'checkbox')
    return (
      <Sheet title={tn(rows.length, '{field} on {n} row', '{field} on {n} rows', { field: field.name })} onClose={onClose} className="tb-sheet">
        <div className="as-list">
          {[true, false].map((on) => (
            <button key={String(on)} type="button" className="as-item" onClick={() => (onApply(field.id, on), onClose())}>
              <span className="as-label">{on ? t('Checked') : t('Not checked')}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  if (field) {
    // One value for all of them: the editor starts empty (or with the value they already share).
    const same = rows.every((r) => JSON.stringify(r.values[field.id] ?? null) === JSON.stringify(rows[0]?.values[field.id] ?? null));
    const fake: TableRow = { ...rows[0], id: '__bulk', values: same ? { [field.id]: rows[0]?.values[field.id] ?? null } : {} };
    return (
      <EditSheet
        table={table}
        field={table.fields.find((f) => f.id === field.id) ?? field}
        row={fake}
        ctx={ctx}
        title={tn(rows.length, '{field} on {n} row', '{field} on {n} rows', { field: field.name })}
        onSave={(v) => (pending.current = { v })}
        onClose={() => {
          if (pending.current) onApply(field.id, pending.current.v);
          onClose();
        }}
        canCreate={!ctx.canEdit}
      />
    );
  }
  return (
    <Sheet title={tn(rows.length, 'Change a field on {n} row', 'Change a field on {n} rows')} onClose={onClose} size="tall" className="tb-sheet">
      <div className="as-list">
        {editable.map((f) => {
          const I = fieldIcon(f.type);
          return (
            <button key={f.id} type="button" className="as-item" onClick={() => setField(f)}>
              <I size={18} className="as-icon" />
              <span className="as-label">{f.name}</span>
              <ChevronRight size={16} className="as-icon" />
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
