import { useState } from 'react';
import { Menu, Plus, Table2, X } from 'lucide-react';
import type { Client, DataTable, TableRow } from '../../types';
import { term } from '../../terms';
import { uid } from '../../utils';
import { SmoothHeight } from '../ui/Smooth';
import { ProjectPicker } from '../ProjectPicker';
import { TABLE_COLORS, TEMPLATES, templateFields, type TemplateId } from './fields';

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

