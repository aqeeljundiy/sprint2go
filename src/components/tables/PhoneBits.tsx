import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDownLeft, ArrowUpDown, Check, ChevronLeft, ChevronRight, Copy, CopyPlus, Download, Eye, FileUp, Filter, Group, Info, LayoutTemplate, Palette, PencilLine, Plus, Share2, SlidersHorizontal, Trash2, Users, X, Zap } from 'lucide-react';
import type { CellValue, Client, DataTable, RowTemplate, TableField, TableRow, TableViewDef } from '../../types';
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
import { VIEW_KINDS, viewIcon } from './viewKinds';
import { TABLE_COLORS, fieldIcon, filterCount, isComputed, repeatWords, sortsOf, viewFields, type TCtx } from './fields';
import { statusFieldOf } from './CardList';

/* The phone's pieces for Tables: the views sheet, filter and settings sheets, quick create, picking several rows. */

/** The views of a table, with a tick on the one showing and "Add a view" for people who may. */
export function ViewsSheet({ table, current, onPick, onAdd, onClose }: { table: DataTable; current: string; onPick: (id: string) => void; onAdd?: (kind: TableViewDef['kind']) => void; onClose: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <Sheet title={adding ? 'Add a view' : 'Views'} onClose={onClose} className="tb-sheet" head={adding && <button type="button" className="ghost-btn sm" onClick={() => setAdding(false)}>Back</button>}>
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
                const I = viewIcon(v.kind);
                return (
                  <button key={v.id} type="button" className="as-item" aria-current={v.id === current} onClick={() => (onPick(v.id), onClose())}>
                    <I size={18} className="as-icon" />
                    <span className="as-label">{v.name}</span>
                    {v.id === current && <Check size={18} className="as-check" />}
                  </button>
                );
              })}
          {!adding && onAdd && (
            <>
              <div className="as-sep" role="separator" />
              <button type="button" className="as-item" onClick={() => setAdding(true)}>
                <Plus size={18} className="as-icon" />
                <span className="as-label">Add a view</span>
              </button>
            </>
          )}
        </div>
      </TabPane>
    </Sheet>
  );
}

/** The filter on a phone: values with counts first, conditions under them, and a button that says what you'll see. */
export function FilterSheet({ table, view, rows, ctx, shown, onChange, onClose }: { table: DataTable; view: TableViewDef; rows: TableRow[]; ctx: TCtx; shown: number; onChange: Parameters<typeof FilterPanel>[0]['onChange']; onClose: () => void }) {
  return (
    <Sheet
      title="Filter"
      onClose={onClose}
      size="tall"
      className="tb-sheet tb-filter-sheet"
      footer={
        <button type="button" className="primary-btn tb-sheet-wide" onClick={onClose}>
          {shown === 1 ? 'Show 1 row' : `Show ${shown} rows`}
        </button>
      }
    >
      <FilterPanel table={table} view={view} rows={rows} ctx={ctx} onChange={onChange} />
    </Sheet>
  );
}

/** "2 filters · Clear": the line under a narrow toolbar while something is filtered or sorted. */
export function FilterLine({ table, view, base, differs, canSave, onClear, onReset, onSave, onOpen }: { table: DataTable; view: TableViewDef; base: TableViewDef; differs: boolean; canSave: boolean; onClear: () => void; onReset: () => void; onSave: () => void; onOpen: () => void }) {
  const n = filterCount(table, view);
  const sorts = sortsOf(view);
  // Reset is only worth showing when it does something Clear doesn't: everyone's view has filters, or the sort differs.
  const resetDiffers = filterCount(table, base) > 0 || JSON.stringify(sorts) !== JSON.stringify(sortsOf(base));
  const on = n > 0 || differs;
  const sortName = sorts[0] ? table.fields.find((f) => f.id === sorts[0].fieldId)?.name : '';
  return (
    <div className={`fold ${on ? 'open' : ''}`}>
      <div className="fold-in">
        <div className="tb-fline" aria-live="polite">
          <button type="button" className="tb-fline-what" onClick={onOpen}>
            <Filter size={14} />
            <span>
              {n ? `${n} ${n === 1 ? 'filter' : 'filters'}` : 'No filters'}
              {sortName ? ` · by ${sortName}` : ''}
            </span>
          </button>
          {n > 0 && (
            <button type="button" className="link-btn small" onClick={onClear}>
              Clear
            </button>
          )}
          <span className="spacer" />
          {differs && (resetDiffers || !n) && (
            <button type="button" className="link-btn small" onClick={onReset} title="Back to what everyone sees">
              Reset
            </button>
          )}
          {differs && canSave && (
            <button type="button" className="link-btn small strong" onClick={onSave}>
              Save for everyone
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
export function SettingsSheet({ table: t, view, ctx, a, onClose }: { table: DataTable; view: TableViewDef; ctx: TCtx; a: SettingsActions; onClose: () => void }) {
  const [page, setPage] = useState<Page>('root');
  const sorts = sortsOf(view);
  const fname = (id?: string) => t.fields.find((f) => f.id === id)?.name;
  const hidden = view.hidden?.length ?? 0;
  const status = statusFieldOf(t, view);
  const showsCards = view.kind === 'board' || view.kind === 'gallery' || ((view.kind === 'grid' || view.kind === 'list') && (a.layout?.cards ?? true));
  const titles: Record<Page, string> = { root: 'Settings', sort: 'Sort', group: view.kind === 'board' ? 'Columns' : 'Group', fields: 'Fields', cards: 'On each card', colors: 'Colours', view: 'This view', table: 'This table', auto: 'Automations' };
  const back = page !== 'root' && (
    <button type="button" className="icon-btn tb-sheet-back" aria-label="Back to settings" onClick={() => setPage(page === 'auto' ? 'root' : 'root')}>
      <ChevronLeft size={20} />
    </button>
  );
  let body: ReactNode;
  if (page === 'sort') body = <SortEditor table={t} sorts={sorts} onChange={(s) => a.onMine({ sorts: s })} />;
  else if (page === 'group') body = <GroupEditor t={t} view={view} onView={a.onView} board={view.kind === 'board'} />;
  else if (page === 'fields') body = <FieldsEditor t={t} view={view} onView={a.onView} all={viewFields(t, view, true)} />;
  else if (page === 'cards') body = <CardSettings table={t} view={view} group={view.kind === 'board' ? t.fields.find((f) => f.id === view.groupBy) : status} shown={cardFieldsOf(t, view, view.kind === 'board' ? t.fields.find((f) => f.id === view.groupBy) : status)} onView={a.onView} />;
  else if (page === 'colors') body = <ColorRulesEditor table={t} view={view} users={ctx.users} me={ctx.me} onView={a.onView} />;
  else if (page === 'view') body = <ViewPage t={t} view={view} a={a} onDone={onClose} />;
  else if (page === 'table') body = <TablePage t={t} a={a} />;
  else if (page === 'auto') body = <AutomationsPhone t={t} a={a} />;
  else
    body = (
      <div className="as-list">
        {a.layout && (view.kind === 'grid' || view.kind === 'list') && (
          <div className="tb-set-seg">
            <span>Show as</span>
            <div className="segmented sm">
              <button type="button" className={a.layout.cards ? 'on' : ''} onClick={() => a.layout!.set(true)}>
                Cards
              </button>
              <button type="button" className={!a.layout.cards ? 'on' : ''} onClick={() => a.layout!.set(false)}>
                {view.kind === 'list' ? 'List' : 'Grid'}
              </button>
            </div>
          </div>
        )}
        {view.kind !== 'calendar' && <SetRow icon={ArrowUpDown} label="Sort" hint={sorts.length ? `By ${sorts.map((s) => fname(s.fieldId)).filter(Boolean).join(', then ')} (just for you)` : 'Your own order'} onClick={() => setPage('sort')} />}
        {a.structure && (view.kind === 'grid' || view.kind === 'list' || view.kind === 'board') && <SetRow icon={Group} label={titles.group} hint={view.groupBy ? `By ${fname(view.groupBy)}${view.subGroupBy ? `, then ${fname(view.subGroupBy)}` : ''}` : 'Not grouped'} onClick={() => setPage('group')} />}
        {a.structure && showsCards && <SetRow icon={SlidersHorizontal} label="On each card" hint={cardFieldsOf(t, view, status).slice(0, 3).map((f) => f.name).join(', ') || 'Just the name'} onClick={() => setPage('cards')} />}
        {a.structure && !showsCards && <SetRow icon={Eye} label="Fields" hint={hidden ? `${hidden} hidden` : 'All shown'} onClick={() => setPage('fields')} />}
        {a.structure && view.kind !== 'calendar' && view.kind !== 'timeline' && <SetRow icon={Palette} label="Colours" hint={view.colors?.length ? `${view.colors.length} ${view.colors.length === 1 ? 'rule' : 'rules'}` : 'None'} onClick={() => setPage('colors')} />}
        {a.structure && <SetRow icon={PencilLine} label="This view" hint={`${view.name}: rename, show as, duplicate, delete`} onClick={() => setPage('view')} />}
        <div className="as-sep" role="separator" />
        {a.structure && <SetRow icon={Zap} label="Automations" hint={t.rules?.length ? `${t.rules.filter((r) => r.enabled).length} of ${t.rules.length} rules on` : t.intake?.enabled ? 'Data coming in is on' : 'Rules and data coming in'} onClick={() => setPage('auto')} />}
        {a.onShare && <SetRow icon={Users} label="Share with guests" hint={t.share?.enabled ? `The ${term.one}’s guests can open it` : 'Not shared'} onClick={() => (onClose(), a.onShare!())} chevron={false} />}
        {a.structure && <SetRow icon={LayoutTemplate} label="Row templates" hint={t.templates?.length ? t.templates.map((x) => x.name).join(', ') : 'Rows to start from'} onClick={() => (onClose(), a.onTemplates())} chevron={false} />}
        {a.structure && <SetRow icon={Info} label="This table" hint="Name, description, colour, where it belongs" onClick={() => setPage('table')} />}
        {a.onDownload && <SetRow icon={Download} label="Download CSV" onClick={() => (onClose(), a.onDownload!())} chevron={false} />}
        {a.canDelete && <SetRow icon={Trash2} label="Delete table" danger onClick={() => (onClose(), a.onDeleteTable())} chevron={false} />}
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
              Done
            </button>
          )}
        </>
      }
    >
      <TabPane key={page}>{body}</TabPane>
    </Sheet>
  );
}

function ViewPage({ t, view, a, onDone }: { t: DataTable; view: TableViewDef; a: SettingsActions; onDone: () => void }) {
  const [name, setName] = useState(view.name);
  useEffect(() => setName(view.name), [view.id, view.name]);
  const save = () => name.trim() && name.trim() !== view.name && a.onView({ name: name.trim() });
  return (
    <div className="tb-set-page">
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="View name" enterKeyHint="done" />
      </label>
      <div className="field">
        <span>Show as</span>
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
          <span className="as-label">Duplicate this view</span>
        </button>
        {t.views.length > 1 && (
          <button type="button" className="as-item danger" onClick={() => (a.onDeleteView(), onDone())}>
            <Trash2 size={18} className="as-icon" />
            <span className="as-label">Delete this view</span>
          </button>
        )}
      </div>
    </div>
  );
}

function TablePage({ t, a }: { t: DataTable; a: SettingsActions }) {
  const [name, setName] = useState(t.name);
  const [desc, setDesc] = useState(t.description ?? '');
  return (
    <div className="tb-set-page">
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== t.name && a.onPatchTable({ name: name.trim() })} aria-label="Table name" enterKeyHint="done" />
      </label>
      <label className="field">
        <span>What it’s for</span>
        <textarea rows={2} value={desc} placeholder="A line for everyone who opens it" onChange={(e) => setDesc(e.target.value)} onBlur={() => desc.trim() !== (t.description ?? '') && a.onPatchTable({ description: desc.trim() || undefined })} />
      </label>
      <div className="field">
        <span>Colour</span>
        <div className="tb-colors" role="radiogroup" aria-label="Colour">
          {TABLE_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={t.color === c} className={`tb-dot big${t.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => a.onPatchTable({ color: c })} aria-label={c} />
          ))}
        </div>
      </div>
      <div className="field">
        <span>Belongs to</span>
        <ProjectPicker value={t.clientId ?? ''} onChange={(v) => a.onPatchTable({ clientId: v || undefined })} projects={a.clients} none="Whole company" label="Belongs to" />
      </div>
      {a.onImport && (
        <button type="button" className="ghost-btn" onClick={a.onImport}>
          <FileUp size={15} /> Import a CSV
        </button>
      )}
    </div>
  );
}

/**
 * Automations on a phone: run them, don't build them. Each rule with an on/off switch, the address data comes in at
 * (copy or share it, switch it on or off) and the last deliveries. Setting them up stays a job for a computer.
 */
function AutomationsPhone({ t, a }: { t: DataTable; a: SettingsActions }) {
  const rules = t.rules ?? [];
  const url = t.intake ? `${location.origin}/api/hooks/${t.intake.token}` : '';
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `${t.name}: where data comes in`, url });
      else await navigator.clipboard?.writeText(url).then(() => a.toast('Address copied'));
    } catch {
      /* they closed the share sheet */
    }
  };
  return (
    <div className="tb-set-page">
      <h4 className="tb-set-h">Rules</h4>
      {!rules.length && <p className="muted small">No rules yet. Rules are set up on a computer: Automations, Rules.</p>}
      <div className="tb-rule-list">
        {rules.map((r) => (
          <div key={r.id} className="tb-rule-row">
            <span className="tb-rule-text">
              <strong>{r.name}</strong>
              <small className="muted">{r.on === 'schedule' && r.schedule ? 'On a schedule' : r.on === 'created' ? 'When a row is added' : r.on === 'updated' ? 'When a row changes' : `When ${t.fields.find((f) => f.id === r.fieldId)?.name ?? 'a field'} changes`}</small>
            </span>
            <button type="button" role="switch" aria-checked={r.enabled} aria-label={`${r.name}: ${r.enabled ? 'on' : 'off'}`} className={`switch ${r.enabled ? 'on' : ''}`} onClick={() => a.onPatchTable({ rules: rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) })}>
              <span />
            </button>
          </div>
        ))}
      </div>
      <h4 className="tb-set-h">Data coming in</h4>
      {t.intake ? (
        <>
          <div className="tb-rule-row">
            <span className="tb-rule-text">
              <strong>
                <ArrowDownLeft size={14} /> {t.intake.enabled ? 'Adding rows from forms and other apps' : 'Not adding rows yet'}
              </strong>
              <small className="muted tb-url">{url}</small>
            </span>
            {(t.intake.enabled || Object.values(t.intake.mapping).some(Boolean)) && (
              <button type="button" role="switch" aria-checked={t.intake.enabled} aria-label="Data coming in" className={`switch ${t.intake.enabled ? 'on' : ''}`} onClick={() => a.onPatchTable({ intake: { ...t.intake!, enabled: !t.intake!.enabled } })}>
                <span />
              </button>
            )}
          </div>
          <div className="tb-set-btns">
            <button type="button" className="ghost-btn" onClick={() => void navigator.clipboard?.writeText(url).then(() => a.toast('Address copied'))}>
              <Copy size={15} /> Copy address
            </button>
            <button type="button" className="ghost-btn" onClick={() => void share()}>
              <Share2 size={15} /> Share
            </button>
          </div>
          {(t.log ?? []).slice(-3).reverse().map((l, i) => (
            <p key={i} className={`small tb-log-line${l.ok ? '' : ' bad'}`}>
              {l.text} <span className="muted">· {relative(l.at)}</span>
            </p>
          ))}
        </>
      ) : (
        <p className="muted small">Forms, ads and other apps can add rows here. Set up the address on a computer: Automations, Data coming in.</p>
      )}
      <button type="button" className="link-btn small tb-set-full" onClick={a.onAutomations}>
        Open the full setup
      </button>
    </div>
  );
}

/**
 * Quick create: the name only (fields come later), from a template when there are some, with "Create and add
 * another" for runs of rows. The sheet opens with the keyboard up.
 */
export function QuickCreate({ table, where, inputRef, onCreate, onClose }: { table: DataTable; where?: string; inputRef: React.RefObject<HTMLInputElement | null>; onCreate: (name: string, tpl: RowTemplate | undefined, again: boolean) => void; onClose: () => void }) {
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
      title={where ? `New row in ${where}` : `New row in ${table.name}`}
      onClose={onClose}
      className="tb-sheet tb-quick-sheet"
      footer={
        <>
          <button type="button" className="ghost-btn" onClick={() => go(true)}>
            Create and add another
          </button>
          <button type="button" className="primary-btn" onClick={() => go(false)}>
            Create
          </button>
        </>
      }
    >
      <div className="tb-sheet-field">
        <input ref={inputRef} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={chosen ? `${first.name} (${chosen.name})` : first.name} aria-label={first.name} enterKeyHint="done" autoCapitalize="sentences" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go(false))} />
      </div>
      {templates.length > 0 && (
        <div className="tb-tpl-chips" role="radiogroup" aria-label="Start from">
          <button type="button" role="radio" aria-checked={!tpl} className={`tb-qchip${!tpl ? ' on' : ''}`} onClick={() => setTpl('')}>
            Blank
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
    <div className={`tb-bulkbar${phone ? ' phone' : ''}`} role="toolbar" aria-label={`${count} selected`}>
      <button type="button" className="icon-btn" onClick={onCancel} aria-label="Stop selecting" title="Stop selecting (Esc)">
        <X size={18} />
      </button>
      <strong className="tb-bulk-n">{count} selected</strong>
      {onAll && (
        <button type="button" className="ghost-btn sm tb-bulk-all" onClick={onAll}>
          All
        </button>
      )}
      <span className="spacer" />
      <button type="button" className="ghost-btn sm tb-bulk-edit" disabled={!count} onClick={onEdit}>
        <PencilLine size={15} /> <span>{phone ? 'Change' : 'Change a field'}</span>
      </button>
      {onDuplicate && (
        <button type="button" className="ghost-btn sm" disabled={!count} onClick={onDuplicate} aria-label="Duplicate">
          <CopyPlus size={15} /> <span className="lbl">Duplicate</span>
        </button>
      )}
      {canDelete && onDelete && (
        <button type="button" className="ghost-btn sm danger" disabled={!count} onClick={onDelete} aria-label="Delete">
          <Trash2 size={15} /> <span className="lbl">Delete</span>
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
      <Sheet title={`${field.name} on ${rows.length} rows`} onClose={onClose} className="tb-sheet">
        <div className="as-list">
          {[true, false].map((on) => (
            <button key={String(on)} type="button" className="as-item" onClick={() => (onApply(field.id, on), onClose())}>
              <span className="as-label">{on ? 'Checked' : 'Not checked'}</span>
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
        title={`${field.name} on ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
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
    <Sheet title={`Change a field on ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`} onClose={onClose} size="tall" className="tb-sheet">
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
