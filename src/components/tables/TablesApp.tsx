import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, Users, Zap, ArrowLeft, ArrowUpDown, Columns3, EyeOff, Filter, LayoutGrid, Menu, MoreHorizontal, Plus, Search, Table2, Trash2, X } from 'lucide-react';
import type { CellValue, Channel, Client, DataTable, TableField, TableFilter, TableRow, TableViewDef, User } from '../../types';
import { AutomationsPanel } from './Automations';
import { ImportDialog, type ImportPlan } from './ImportDialog';
import { download, rowsToCsv } from './csv';
import { term } from '../../terms';
import { uid } from '../../utils';
import { usePersisted } from '../../settings';
import { Popover } from '../ui/Popover';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { ProjectPicker } from '../ProjectPicker';
import { newOption, type CellCtx } from './Cell';
import { GridView } from './GridView';
import { BoardView } from './BoardView';
import { FieldLine, RecordDrawer } from './RecordDrawer';
import { TABLE_COLORS, TEMPLATES, convertValue, isEmpty, opsFor, optionsFromValues, rowName, templateFields, visibleRows, type TemplateId } from './fields';

type Setter<T> = (fn: (x: T) => T) => void;

/* ---------- sidebar ---------- */

/** The Tables sidebar: the company's tables, then each project's. */
export function TablesSidebar({ tables, clients, current, onOpen, onNew }: { tables: DataTable[]; clients: Client[]; current: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const company = tables.filter((t) => !t.clientId);
  const byProject = clients.map((c) => ({ c, list: tables.filter((t) => t.clientId === c.id) })).filter((g) => g.list.length);
  const item = (t: DataTable) => (
    <button key={t.id} className={`nav-item ${current === t.id ? 'active' : ''}`} onClick={() => onOpen(t.id)} title={t.name}>
      <span className="client-dot" style={{ background: t.color }}>
        {t.name.charAt(0).toUpperCase()}
      </span>
      <span className="sb-label">{t.name}</span>
    </button>
  );
  return (
    <>
      <button className="compose-btn" onClick={onNew} title="New table">
        <Plus size={16} />
        <span className="sb-label">New table</span>
      </button>
      {company.length > 0 && (
        <>
          <div className="nav-heading sb-label">Company</div>
          <nav className="nav">{company.map(item)}</nav>
        </>
      )}
      {byProject.map(({ c, list }) => (
        <div key={c.id}>
          <div className="nav-heading sb-label">{c.name}</div>
          <nav className="nav">{list.map(item)}</nav>
        </div>
      ))}
      {!tables.length && <p className="muted small sb-note sb-label">No tables yet. Make one for leads, a content pipeline, anything you track in rows.</p>}
    </>
  );
}

/* ---------- new table ---------- */

export function NewTableDialog({ clients, clientId: startClient, onCreate, onClose }: { clients: Client[]; clientId?: string; onCreate: (d: { name: string; clientId?: string; template: TemplateId }) => void; onClose: () => void }) {
  const [template, setTemplate] = useState<TemplateId>('leads');
  const [clientId, setClientId] = useState(startClient ?? '');
  const tplName = TEMPLATES.find((t) => t.id === template)!.name;
  const project = clients.find((c) => c.id === clientId);
  const suggested = template === 'blank' ? 'Untitled table' : project ? `${project.name} ${tplName.toLowerCase()}` : tplName;
  const [name, setName] = useState('');
  const create = () => onCreate({ name: name.trim() || suggested, clientId: clientId || undefined, template });
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="New table" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Table2 size={15} /> New table
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body connect-form">
          <SmoothHeight>
            <div className="field">
              <span>Start from</span>
              <div className="cat-pick two">
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" className={template === t.id ? 'on' : ''} onClick={() => setTemplate(t.id)}>
                    <strong>{t.name}</strong>
                    <small>{t.hint}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Name</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} onKeyDown={(e) => e.key === 'Enter' && create()} />
            </label>
            <div className="field">
              <span>Belongs to</span>
              <ProjectPicker value={clientId} onChange={setClientId} projects={clients} none="The whole company" label="Belongs to" />
            </div>
            <p className="muted small">{clientId ? `It shows in the ${term.one}’s Tables tab too.` : 'Everyone in the company can open it.'} Every column can be changed later.</p>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={create}>
            Create table
          </button>
        </footer>
      </div>
    </div>
  );
}

/** A new table's document, from a template. */
export function makeTable(d: { name: string; clientId?: string; template: TemplateId }, workspaceId: string, me: string, color?: string): DataTable {
  const { fields, views } = templateFields(d.template);
  return { id: uid(), workspaceId, name: d.name, color: color ?? TABLE_COLORS[Math.floor(Math.random() * TABLE_COLORS.length)], clientId: d.clientId, fields, views, createdBy: me, createdAt: new Date().toISOString() };
}

/* ---------- a project's tables (its Tables tab) ---------- */

export function ProjectTables({ tables, rows, onOpen, onNew, bare }: { tables: DataTable[]; rows: TableRow[]; onOpen: (id: string) => void; onNew: () => void; bare?: boolean }) {
  if (!tables.length)
    return (
      <div className="empty">
        <div className="empty-art">
          <Table2 size={20} />
        </div>
        <p className="empty-title">No tables for this {term.one} yet</p>
        <p className="empty-sub">Leads, a content pipeline, a list of anything: your own columns, as a grid or a board.</p>
        <button className="primary-btn sm" onClick={onNew}>
          <Plus size={14} /> New table
        </button>
      </div>
    );
  return (
    <div className="tb-project">
      {!bare && <div className="tb-project-head">
        <span className="spacer" />
        <button className="ghost-btn sm" onClick={onNew}>
          <Plus size={13} /> New table
        </button>
      </div>}
      <div className="tb-cards">
        {tables.map((t, i) => {
          const n = rows.filter((r) => r.tableId === t.id).length;
          return (
            <button key={t.id} className="tb-table-card" style={{ ['--i' as string]: i }} onClick={() => onOpen(t.id)}>
              <span className="client-badge" style={{ background: t.color }}>
                {t.name.charAt(0).toUpperCase()}
              </span>
              <span className="tb-tc-text">
                <strong>{t.name}</strong>
                <small>{t.description || `${n} row${n === 1 ? '' : 's'} · ${t.fields.length} fields`}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- the table screen ---------- */

interface ScreenProps {
  table: DataTable;
  tables: DataTable[];
  rows: TableRow[]; // every row the person can see (links reach into other tables)
  users: User[];
  clients: Client[];
  me: string;
  setTables: Setter<DataTable[]>;
  setRows: Setter<TableRow[]>;
  onOpenTable: (id: string, rowId?: string) => void;
  openRow: string | null;
  setOpenRow: (id: string | null) => void;
  onDeleted: () => void;
  onMenu: () => void;
  toast: (t: { text: string; action?: { label: string; run: () => void } }) => void;
  channels: Channel[];
  isAdmin: boolean;
  serverOn: boolean;
  onCompose: (m: { to: string; subject: string; body: string }) => void;
  /** A project's guest looking at a shared table: what they may do. */
  guest?: { canEdit: (fieldId: string) => boolean; add: boolean; download: boolean };
}

export function TableScreen(p: ScreenProps) {
  const t = p.table;
  const [viewId, setViewId] = usePersisted<string>(`s2g-table-view:${t.id}`, t.views[0]?.id ?? '');
  const view = t.views.find((v) => v.id === viewId) ?? t.views[0];
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pop, setPop] = useState<null | 'filter' | 'sort' | 'fields' | 'view' | 'more' | 'addView'>(null);
  const refs = { filter: useRef<HTMLButtonElement>(null), sort: useRef<HTMLButtonElement>(null), fields: useRef<HTMLButtonElement>(null), view: useRef<HTMLButtonElement>(null), more: useRef<HTMLButtonElement>(null), addView: useRef<HTMLButtonElement>(null) };
  const [name, setName] = useState(t.name);
  const [renamingView, setRenamingView] = useState('');
  const [autoOpen, setAutoOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const g = p.guest;
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<{ row: TableRow; f: TableField } | null>(null);

  const mine = useMemo(() => p.rows.filter((r) => r.tableId === t.id), [p.rows, t.id]);
  const rowNameOf = (id: string) => {
    const r = p.rows.find((x) => x.id === id);
    const tt = r && p.tables.find((x) => x.id === r.tableId);
    return tt ? rowName(tt, r) : '';
  };
  const textCtx = { users: p.users, rowName: rowNameOf };
  const shown = useMemo(() => (view ? visibleRows(t, view, mine, q, textCtx) : mine), [t, view, mine, q, p.users, p.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  /* table changes */
  const patchTable = (patch: Partial<DataTable>) => p.setTables((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
  const patchView = (patch: Partial<TableViewDef>) => view && patchTable({ views: t.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  const addOption = (fieldId: string, label: string) => {
    const f = t.fields.find((x) => x.id === fieldId)!;
    const o = newOption(f, label);
    patchTable({ fields: t.fields.map((x) => (x.id === fieldId ? { ...x, options: [...(x.options ?? []), o] } : x)) });
    return o.id;
  };
  const saveField = (f: TableField) => {
    const before = t.fields.find((x) => x.id === f.id);
    if (!before) return patchTable({ fields: [...t.fields, f] });
    let next = f;
    if (before.type !== f.type) {
      // Becoming a choice field: the words already in the column become its choices.
      if ((f.type === 'select' || f.type === 'multi') && !f.options?.length) next = { ...f, options: optionsFromValues(before, mine, textCtx) };
      const target = next;
      p.setRows((rs) => rs.map((r) => (r.tableId === t.id && !isEmpty(r.values[f.id]) ? { ...r, values: { ...r.values, [f.id]: convertValue(before, target, r.values[f.id], textCtx) } } : r)));
    } else if (f.options) {
      // Choices removed: their cells empty out.
      const keep = new Set(f.options.map((o) => o.id));
      p.setRows((rs) =>
        rs.map((r) => {
          if (r.tableId !== t.id) return r;
          const v = r.values[f.id];
          if (f.type === 'select' && typeof v === 'string' && !keep.has(v)) return { ...r, values: { ...r.values, [f.id]: null } };
          if (f.type === 'multi' && Array.isArray(v) && v.some((x) => !keep.has(x))) return { ...r, values: { ...r.values, [f.id]: v.filter((x) => keep.has(x)) } };
          return r;
        }),
      );
    }
    patchTable({ fields: t.fields.map((x) => (x.id === f.id ? next : x)) });
  };
  const deleteField = (id: string) => {
    patchTable({
      fields: t.fields.filter((f) => f.id !== id),
      views: t.views.map((v) => ({ ...v, hidden: v.hidden?.filter((x) => x !== id), filters: v.filters?.filter((x) => x.fieldId !== id), sort: v.sort?.fieldId === id ? undefined : v.sort, groupBy: v.groupBy === id ? undefined : v.groupBy })),
    });
    p.setRows((rs) => rs.map((r) => (r.tableId === t.id && id in r.values ? { ...r, values: Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== id)) } : r)));
  };

  /* row changes */
  const now = () => new Date().toISOString();
  const setCell = (rowId: string, fieldId: string, v: CellValue) =>
    p.setRows((rs) =>
      rs.map((r) => {
        if (r.id !== rowId) return r;
        const from = r.values[fieldId] ?? null;
        if (JSON.stringify(from) === JSON.stringify(v)) return r;
        return { ...r, values: { ...r.values, [fieldId]: v }, updatedAt: now(), history: [...(r.history ?? []), { by: p.me, at: now(), fieldId, from, to: v }].slice(-50) };
      }),
    );
  const addRow = (values: Record<string, CellValue> = {}) => {
    const r: TableRow = { id: uid(), workspaceId: t.workspaceId, tableId: t.id, values, order: Math.max(0, ...mine.map((x) => x.order)) + 1, createdBy: p.me, createdAt: now(), updatedAt: now() };
    p.setRows((rs) => [...rs, r]);
    return r.id;
  };
  const deleteRows = (ids: string[]) => {
    const gone = p.rows.filter((r) => ids.includes(r.id));
    p.setRows((rs) => rs.filter((r) => !ids.includes(r.id)));
    setSelected(new Set());
    if (p.openRow && ids.includes(p.openRow)) p.setOpenRow(null);
    p.toast({ text: ids.length === 1 ? `Deleted “${rowName(t, gone[0])}”` : `Deleted ${ids.length} rows`, action: { label: 'Undo', run: () => p.setRows((rs) => [...rs, ...gone]) } });
  };
  const duplicate = (id: string) => {
    const r = mine.find((x) => x.id === id);
    if (!r) return;
    const nid = addRow({ ...r.values, [t.fields[0].id]: `${rowName(t, r)} (copy)` });
    p.setOpenRow(nid);
  };
  const comment = (id: string, text: string) => p.setRows((rs) => rs.map((r) => (r.id === id ? { ...r, comments: [...(r.comments ?? []), { id: uid(), by: p.me, at: now(), text }] } : r)));

  /* views */
  const addView = (kind: TableViewDef['kind']) => {
    const v: TableViewDef = { id: uid(), name: kind === 'board' ? 'Board' : 'Grid', kind, groupBy: kind === 'board' ? t.fields.find((f) => f.type === 'select')?.id : undefined };
    patchTable({ views: [...t.views, v] });
    setViewId(v.id);
    setPop(null);
  };
  const deleteView = () => {
    if (!view || t.views.length < 2) return;
    patchTable({ views: t.views.filter((v) => v.id !== view.id) });
    setViewId(t.views.find((v) => v.id !== view.id)!.id);
    setPop(null);
  };
  const deleteTable = () => {
    if (!confirm(`Delete “${t.name}” and its ${mine.length} row${mine.length === 1 ? '' : 's'}? This can’t be undone.`)) return;
    p.setRows((rs) => rs.filter((r) => r.tableId !== t.id));
    p.setTables((ts) => ts.filter((x) => x.id !== t.id));
    p.onDeleted();
  };

  /* CSV */
  const exportCsv = () => {
    const ids = view?.kind === 'grid' ? t.fields.filter((f) => !view.hidden?.includes(f.id)).map((f) => f.id) : undefined;
    download(`${t.name.replace(/[^\w\s-]/g, '').trim() || 'table'}.csv`, rowsToCsv(t, shown, p.users, rowNameOf, ids));
  };
  const importPlan = async (plan: ImportPlan) => {
    if (p.serverOn) {
      const r = await fetch('/api/tables/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: t.id, ...plan }) });
      const out = await r.json().catch(() => null);
      if (!r.ok) return p.toast({ text: out?.error ?? 'The import didn’t go through. Try again.' });
    } else {
      patchTable({ fields: plan.fields });
      let order = Math.max(0, ...mine.map((x) => x.order));
      const made: TableRow[] = plan.creates.map((values) => ({ id: uid(), workspaceId: t.workspaceId, tableId: t.id, values, order: ++order, createdBy: p.me, createdAt: now(), updatedAt: now() }));
      const upd = new Map(plan.updates.map((u) => [u.id, u.values]));
      p.setRows((rs) => [...rs.map((r) => (upd.has(r.id) ? { ...r, values: { ...r.values, ...upd.get(r.id)! }, updatedAt: now() } : r)), ...made]);
    }
    setImporting(false);
    p.toast({ text: `Imported ${plan.creates.length} row${plan.creates.length === 1 ? '' : 's'}${plan.updates.length ? `, updated ${plan.updates.length}` : ''}` });
  };

  /* buttons */
  const press = async (row: TableRow, f: TableField, input: Record<string, CellValue> = {}) => {
    if (!p.serverOn) return p.toast({ text: 'Buttons run on the server; they work once Sprint2go is running on one.' });
    const key = `${row.id}:${f.id}`;
    setRunning((x) => new Set(x).add(key));
    try {
      const r = await fetch('/api/tables/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: t.id, rowId: row.id, fieldId: f.id, input }) });
      const out = (await r.json().catch(() => null)) as { ok: boolean; results: { ok: boolean; note: string; open?: string; compose?: { to: string; subject: string; body: string } }[]; error?: string } | null;
      if (!r.ok || !out) return p.toast({ text: out?.error ?? 'The button didn’t run. Try again.' });
      for (const x of out.results) {
        if (x.open) window.open(x.open, '_blank', 'noopener');
        if (x.compose) p.onCompose(x.compose);
      }
      const failed = out.results.filter((x) => !x.ok);
      p.toast({ text: failed.length ? `${f.button?.label ?? f.name}: ${failed.map((x) => x.note).join(' · ')}` : `${f.button?.label ?? f.name}: ${out.results.map((x) => x.note).join(' · ') || 'done'}` });
    } finally {
      setRunning((x) => {
        const n = new Set(x);
        n.delete(key);
        return n;
      });
    }
  };
  const runButton = (row: TableRow, f: TableField) => {
    const b = f.button;
    if (!b) return;
    if (b.ask?.length) return setAsking({ row, f });
    if (b.confirm && !confirm(`${b.label || f.name}: run this for “${rowName(t, row)}”?`)) return;
    void press(row, f);
  };

  const ctx: CellCtx = { users: p.users, tables: p.tables, rows: p.rows, addOption, runButton, running, isAdmin: p.isAdmin || !!g, canEdit: g?.canEdit };
  const filters = view?.filters ?? [];
  const setFilters = (fs: TableFilter[]) => patchView({ filters: fs });
  const openRow = p.openRow ? mine.find((r) => r.id === p.openRow) : undefined;
  const fieldsHidden = view?.hidden?.length ?? 0;

  return (
    <section className="tasks-pane tb-pane view-enter">
      <header className="tracking-head tasks-head tb-head-bar">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <button className="icon-btn tb-back" onClick={p.onMenu} aria-label="All tables">
          <ArrowLeft size={18} />
        </button>
        <button type="button" className="client-badge tb-badge" style={{ background: t.color }} title={g ? t.name : 'Change colour'} disabled={!!g} onClick={() => patchTable({ color: TABLE_COLORS[(TABLE_COLORS.indexOf(t.color) + 1) % TABLE_COLORS.length] })}>
          {t.name.charAt(0).toUpperCase()}
        </button>
        <div className="th-text">
          <input className="tb-title" value={name} readOnly={!!g} aria-label="Table name" onChange={(e) => setName(e.target.value)} onBlur={() => (name.trim() ? name.trim() !== t.name && patchTable({ name: name.trim() }) : setName(t.name))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          {g ? t.description && <span className="muted small">{t.description}</span> : <ProjectPicker value={t.clientId ?? ''} onChange={(v) => patchTable({ clientId: v || undefined })} projects={p.clients} none="Whole company" label="Belongs to" className="sel-flat" />}
        </div>
        {!g && t.clientId && (
          <button className={`ghost-btn sm tb-share-btn${t.share?.enabled ? ' on' : ''}`} onClick={() => setSharing(true)} title="What the project’s guests see">
            <Users size={13} /> <span className="lbl">{t.share?.enabled ? 'Shared' : 'Share'}</span>
          </button>
        )}
        {!g && <button className={`ghost-btn sm tb-auto-btn${t.intake?.enabled || t.rules?.some((r) => r.enabled) ? ' on' : ''}`} onClick={() => setAutoOpen(true)} title="Data coming in, rules, webhooks">
          <Zap size={13} /> <span className="lbl">Automations</span>
        </button>}
        {g ? (
          g.download && (
            <button className="icon-btn" onClick={exportCsv} aria-label="Download CSV" title="Download CSV">
              <Download size={16} />
            </button>
          )
        ) : <button ref={refs.more} className="icon-btn" onClick={() => setPop('more')} aria-label="Table options">
          <MoreHorizontal size={17} />
        </button>}
        <Popover anchor={refs.more} open={pop === 'more'} onClose={() => setPop(null)} width={240} align="end" title="Table">
          <div className="tb-menu">
            <label className="tb-menu-desc">
              <span className="muted small">Description</span>
              <textarea rows={2} defaultValue={t.description ?? ''} placeholder="What this table is for" onBlur={(e) => e.target.value.trim() !== (t.description ?? '') && patchTable({ description: e.target.value.trim() || undefined })} />
            </label>
            <button type="button" onClick={() => (setPop(null), setImporting(true))}>
              <FileUp size={14} /> Import CSV
            </button>
            <button type="button" onClick={() => (setPop(null), exportCsv())}>
              <Download size={14} /> Download CSV{view && shown.length !== mine.length ? ` (${shown.length} shown)` : ''}
            </button>
            <button type="button" className="danger" onClick={() => (setPop(null), deleteTable())}>
              <Trash2 size={14} /> Delete table
            </button>
          </div>
        </Popover>
      </header>

      <div className="tb-bar">
        <div className="client-tabs tb-views">
          {t.views.map((v) => (
            <button key={v.id} ref={v.id === view?.id ? refs.view : undefined} className={v.id === view?.id ? 'on' : ''} onClick={() => (v.id === view?.id ? !g && (setRenamingView(v.name), setPop('view')) : (setViewId(v.id), setSelected(new Set())))} title={v.id === view?.id ? 'View settings' : undefined}>
              {v.kind === 'board' ? <Columns3 size={13} /> : <LayoutGrid size={13} />} {v.name}
            </button>
          ))}
          {!g && (
            <button ref={refs.addView} className="tb-add-view" onClick={() => setPop('addView')} title="Add a view">
              <Plus size={14} />
            </button>
          )}
        </div>
        <Popover anchor={refs.addView} open={pop === 'addView'} onClose={() => setPop(null)} width={220} title="Add a view">
          <div className="tb-menu">
            <button type="button" onClick={() => addView('grid')}>
              <LayoutGrid size={14} /> Grid
            </button>
            <button type="button" onClick={() => addView('board')}>
              <Columns3 size={14} /> Board
            </button>
          </div>
        </Popover>
        <Popover anchor={refs.view} open={pop === 'view'} onClose={() => (renamingView.trim() && renamingView.trim() !== view?.name && patchView({ name: renamingView.trim() }), setPop(null))} width={240} title="View">
          <div className="tb-menu">
            <input className="tb-fm-name" autoFocus value={renamingView} onChange={(e) => setRenamingView(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (renamingView.trim() && patchView({ name: renamingView.trim() }), setPop(null))} aria-label="View name" />
            {t.views.length > 1 && (
              <button type="button" className="danger" onClick={deleteView}>
                <Trash2 size={14} /> Delete view
              </button>
            )}
          </div>
        </Popover>

        <span className="spacer" />
        <label className="tb-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search rows" />
        </label>
        {!g && <>
        <button ref={refs.filter} className={`ghost-btn sm${filters.length ? ' on' : ''}`} onClick={() => setPop('filter')}>
          <Filter size={13} /> <span className="lbl">{filters.length ? `${filters.length} filter${filters.length === 1 ? '' : 's'}` : 'Filter'}</span>
        </button>
        <button ref={refs.sort} className={`ghost-btn sm${view?.sort ? ' on' : ''}`} onClick={() => setPop('sort')}>
          <ArrowUpDown size={13} /> <span className="lbl">{view?.sort ? `By ${t.fields.find((f) => f.id === view.sort!.fieldId)?.name}` : 'Sort'}</span>
        </button>
        {view?.kind === 'grid' && (
          <button ref={refs.fields} className={`ghost-btn sm${fieldsHidden ? ' on' : ''}`} onClick={() => setPop('fields')}>
            <EyeOff size={13} /> <span className="lbl">{fieldsHidden ? `${fieldsHidden} hidden` : 'Fields'}</span>
          </button>
        )}
        </>}
        {(!g || g.add) && (
          <button className="primary-btn sm" onClick={() => (view?.kind === 'board' ? p.setOpenRow(addRow()) : addRow())}>
            <Plus size={14} /> <span className="lbl">New row</span>
          </button>
        )}

        <Popover anchor={refs.filter} open={pop === 'filter'} onClose={() => setPop(null)} width={420} title="Filter">
          <FilterEditor table={t} filters={filters} users={p.users} onChange={setFilters} />
        </Popover>
        <Popover anchor={refs.sort} open={pop === 'sort'} onClose={() => setPop(null)} width={260} title="Sort">
          <div className="tb-menu">
            <button type="button" className={!view?.sort ? 'on' : ''} onClick={() => (patchView({ sort: undefined }), setPop(null))}>
              Your own order
            </button>
            {t.fields.map((f) => (
              <div key={f.id} className="tb-sort-row">
                <span>{f.name}</span>
                <div className="segmented sm">
                  {(['asc', 'desc'] as const).map((dir) => (
                    <button key={dir} type="button" className={view?.sort?.fieldId === f.id && view.sort.dir === dir ? 'on' : ''} onClick={() => patchView({ sort: { fieldId: f.id, dir } })}>
                      {dir === 'asc' ? 'First to last' : 'Last to first'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Popover>
        <Popover anchor={refs.fields} open={pop === 'fields'} onClose={() => setPop(null)} width={260} title="Fields in this view">
          <div className="tb-menu">
            {t.fields.slice(1).map((f) => (
              <label key={f.id} className="check-row tb-field-toggle">
                <input type="checkbox" checked={!view?.hidden?.includes(f.id)} onChange={(e) => patchView({ hidden: e.target.checked ? (view?.hidden ?? []).filter((x) => x !== f.id) : [...(view?.hidden ?? []), f.id] })} /> {f.name}
              </label>
            ))}
          </div>
        </Popover>
      </div>

      <div className={`fold ${selected.size ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="tb-bulk">
            <strong>{selected.size} selected</strong>
            <button className="ghost-btn sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button className="ghost-btn sm danger" onClick={() => confirm(`Delete ${selected.size} row${selected.size === 1 ? '' : 's'}?`) && deleteRows([...selected])}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      </div>

      <div className="tb-body">
        <TabPane key={view?.id ?? 'none'}>
          {!view ? null : view.kind === 'board' ? (
            <BoardView table={t} view={view} rows={shown} ctx={ctx} onCell={setCell} onOpenRow={p.setOpenRow} onAddRow={(v) => p.setOpenRow(addRow(v))} onView={patchView} readOnly={!!g && !g.add && !t.fields.some((f) => g.canEdit(f.id))} />
          ) : (
            <GridView locked={!!g} canAdd={!g || g.add} channels={p.channels} table={t} tables={p.tables} view={view} rows={shown} ctx={ctx} selected={selected} onSelect={setSelected} onCell={setCell} onOpenRow={p.setOpenRow} onAddRow={() => addRow()} onSaveField={saveField} onDeleteField={deleteField} onView={patchView} />
          )}
          {view && !shown.length && (mine.length ? (
            <p className="muted small tb-none">No rows match {q.trim() ? 'the search' : 'the filters'}.</p>
          ) : view.kind === 'board' ? null : (
            <p className="muted small tb-none">No rows yet. Add one, or they’ll arrive here from a form or import.</p>
          ))}
        </TabPane>
      </div>

      {importing && <ImportDialog table={t} rows={mine} users={p.users} onImport={importPlan} onClose={() => setImporting(false)} />}
      {sharing && <ShareTableDialog t={t} onSave={(share) => (patchTable({ share }), setSharing(false), p.toast({ text: share.enabled ? 'Shared with the project’s guests' : 'No longer shared' }))} onClose={() => setSharing(false)} />}
      {autoOpen && <AutomationsPanel t={t} tables={p.tables} users={p.users} channels={p.channels} onPatch={patchTable} onClose={() => setAutoOpen(false)} toast={(text) => p.toast({ text })} />}
      {asking && (
        <AskDialog
          table={t}
          row={asking.row}
          f={asking.f}
          ctx={ctx}
          onRun={(input) => {
            const a = asking;
            setAsking(null);
            void press(a.row, a.f, input);
          }}
          onClose={() => setAsking(null)}
        />
      )}
      {openRow && (
        <RecordDrawer
          table={t}
          row={openRow}
          ctx={ctx}
          me={p.me}
          onCell={(fieldId, v) => setCell(openRow.id, fieldId, v)}
          onComment={(text) => comment(openRow.id, text)}
          onDelete={() => deleteRows([openRow.id])}
          onDuplicate={() => duplicate(openRow.id)}
          onClose={() => p.setOpenRow(null)}
          onOpenRow={(tableId, rowId) => p.onOpenTable(tableId, rowId)}
          guest={!!g}
        />
      )}
    </section>
  );
}

/** Filters for a view: field, test, value. All must match. */
function FilterEditor({ table, filters, users, onChange }: { table: DataTable; filters: TableFilter[]; users: User[]; onChange: (f: TableFilter[]) => void }) {
  const set = (i: number, p: Partial<TableFilter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const add = () => {
    const f = table.fields.find((x) => x.type === 'select') ?? table.fields[0];
    onChange([...filters, { fieldId: f.id, op: opsFor(f.type)[0].op }]);
  };
  return (
    <div className="tb-filters">
      {!filters.length && <p className="muted small">Show only the rows you want, like Status is New, or Follow-up before today.</p>}
      {filters.map((flt, i) => {
        const f = table.fields.find((x) => x.id === flt.fieldId) ?? table.fields[0];
        const needsValue = flt.op !== 'empty' && flt.op !== 'filled';
        return (
          <div key={i} className="tb-filter">
            <select className="tb-native" value={f.id} aria-label="Field" onChange={(e) => {
              const nf = table.fields.find((x) => x.id === e.target.value)!;
              set(i, { fieldId: nf.id, op: opsFor(nf.type)[0].op, value: undefined });
            }}>
              {table.fields.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select className="tb-native" value={flt.op} aria-label="Test" onChange={(e) => set(i, { op: e.target.value as TableFilter['op'] })}>
              {opsFor(f.type).map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            {needsValue &&
              (f.type === 'select' || f.type === 'multi' || f.type === 'person' || f.type === 'checkbox' ? (
                <select className="tb-native" value={flt.value ?? ''} aria-label="Value" onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {f.type === 'checkbox'
                    ? [<option key="yes" value="yes">Checked</option>, <option key="no" value="no">Not checked</option>]
                    : f.type === 'person'
                      ? users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))
                      : (f.options ?? []).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                </select>
              ) : (
                <input className="tb-native" type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'money' ? 'number' : 'text'} value={flt.value ?? ''} aria-label="Value" onChange={(e) => set(i, { value: e.target.value })} />
              ))}
            <button type="button" className="icon-btn sm" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))}>
              <X size={13} />
            </button>
          </div>
        );
      })}
      <div className="tb-filters-foot">
        <button type="button" className="link-btn small" onClick={add}>
          <Plus size={13} /> Add a filter
        </button>
        {filters.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}


/** Tables with none open: every table as a card (company first, then each project's), or how to start. */
export function TablesHome({ tables, rows, clients, onOpen, onNew, onMenu }: { tables: DataTable[]; rows: TableRow[]; clients: Client[]; onOpen: (id: string) => void; onNew: () => void; onMenu: () => void }) {
  const groups = [{ id: '', name: 'Company', list: tables.filter((t) => !t.clientId) }, ...clients.map((c) => ({ id: c.id, name: c.name, list: tables.filter((t) => t.clientId === c.id) }))].filter((g) => g.list.length);
  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head tb-head-bar tb-home-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="th-text">
          <h1>Tables</h1>
          <p>Your own databases: leads, pipelines, lists of anything. Your columns, as a grid or a board.</p>
        </div>
        <button className="primary-btn sm" onClick={onNew}>
          <Plus size={14} /> New table
        </button>
      </header>
      <div className="tracking-scroll">
        {!tables.length ? (
          <div className="empty">
            <div className="empty-art">
              <Table2 size={20} />
            </div>
            <p className="empty-title">No tables yet</p>
            <p className="empty-sub">Start from Leads, a content pipeline or a blank table. Add your own columns any time.</p>
            <button className="primary-btn sm" onClick={onNew}>
              <Plus size={14} /> New table
            </button>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.id || 'company'} className="tb-group">
              <h3 className="tb-group-head">{g.name}</h3>
              <ProjectTables tables={g.list} rows={rows} onOpen={onOpen} onNew={onNew} bare />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** Before a button runs: the fields it asks for (e.g. "Why lost?"), filled in on the spot. */
function AskDialog({ table, row, f, ctx, onRun, onClose }: { table: DataTable; row: TableRow; f: TableField; ctx: CellCtx; onRun: (input: Record<string, CellValue>) => void; onClose: () => void }) {
  const ask = (f.button?.ask ?? []).map((id) => table.fields.find((x) => x.id === id)).filter(Boolean) as TableField[];
  const [draft, setDraft] = useState<Record<string, CellValue>>(() => Object.fromEntries(ask.map((x) => [x.id, row.values[x.id] ?? null])));
  const fake: TableRow = { ...row, values: { ...row.values, ...draft } };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={f.button?.label ?? f.name} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Zap size={15} /> {f.button?.label || f.name} · {rowName(table, row)}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <div className="tb-rd-fields">
            {ask.map((x) => (
              <FieldLine key={x.id} f={x} row={fake} ctx={ctx} onCell={(id, v) => setDraft((d) => ({ ...d, [id]: v }))} />
            ))}
          </div>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => onRun(draft)}>
            {f.button?.label || 'Run'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** What a project's guests get of this table: they see some fields, change fewer, press chosen buttons. */
function ShareTableDialog({ t, onSave, onClose }: { t: DataTable; onSave: (s: NonNullable<DataTable['share']>) => void; onClose: () => void }) {
  const [s, setS] = useState<NonNullable<DataTable['share']>>(
    () => t.share ?? { enabled: true, fields: t.fields.filter((f, i) => i > 0 && !['button', 'link', 'longtext'].includes(f.type)).map((f) => f.id), edit: [], buttons: [], add: false, download: true },
  );
  const toggle = (key: 'fields' | 'edit' | 'buttons', id: string, on: boolean) =>
    setS((x) => {
      const next = { ...x, [key]: on ? [...x[key], id] : x[key].filter((y) => y !== id) };
      if (key === 'fields' && !on) next.edit = next.edit.filter((y) => y !== id); // can't change what they can't see
      if (key === 'edit' && on && !next.fields.includes(id)) next.fields = [...next.fields, id];
      return next;
    });
  const first = t.fields[0];
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-share" role="dialog" aria-label="Share with guests" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Users size={15} /> Share {t.name} with guests
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <label className="check-row tb-share-on">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            <span>
              <strong>Guests on this {term.one} can open this table</strong>
              <small className="muted">It shows in their shared space. Rules, webhook addresses and the team’s notes on rows stay hidden.</small>
            </span>
          </label>
          <div className={`fold ${s.enabled ? 'open' : ''}`}>
            <div className="fold-in">
              <div className="tb-share-grid">
                <span />
                <small className="muted">Sees</small>
                <small className="muted">Can change</small>
                <span className="tb-share-name">{first.name}</span>
                <input type="checkbox" checked disabled aria-label={`${first.name} is always seen`} />
                <input type="checkbox" checked={s.edit.includes(first.id)} onChange={(e) => toggle('edit', first.id, e.target.checked)} aria-label={`Guests can change ${first.name}`} />
                {t.fields.slice(1).filter((f) => f.type !== 'link').map((f) =>
                  f.type === 'button' ? (
                    <div key={f.id} className="contents">
                      <span className="tb-share-name">{f.button?.label ?? f.name} <small className="muted">button</small></span>
                      <input type="checkbox" checked={s.buttons.includes(f.id)} onChange={(e) => toggle('buttons', f.id, e.target.checked)} aria-label={`Guests can press ${f.name}`} />
                      <span />
                    </div>
                  ) : (
                    <div key={f.id} className="contents">
                      <span className="tb-share-name">{f.name}</span>
                      <input type="checkbox" checked={s.fields.includes(f.id)} onChange={(e) => toggle('fields', f.id, e.target.checked)} aria-label={`Guests see ${f.name}`} />
                      <input type="checkbox" checked={s.edit.includes(f.id)} onChange={(e) => toggle('edit', f.id, e.target.checked)} aria-label={`Guests can change ${f.name}`} />
                    </div>
                  ),
                )}
              </div>
              <label className="check-row">
                <input type="checkbox" checked={!!s.add} onChange={(e) => setS({ ...s, add: e.target.checked })} /> They can add rows
              </label>
              <label className="check-row">
                <input type="checkbox" checked={!!s.download} onChange={(e) => setS({ ...s, download: e.target.checked })} /> They can download it as CSV
              </label>
            </div>
          </div>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => onSave(s)}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
