import { useState } from 'react';
import { ChevronRight, Menu, Plus, Table2, X } from 'lucide-react';
import { Group } from '../ui/Grouped';
import { usePhone } from '../../mobile/media';
import type { Client, DataTable, TableRow } from '../../types';
import { term } from '../../terms';
import { uid } from '../../utils';
import { SmoothHeight } from '../ui/Smooth';
import { ProjectPicker } from '../ProjectPicker';
import { TABLE_COLORS, TEMPLATES, templateFields, type TemplateId } from './fields';
import { EmptyState } from '../ui/EmptyState';
import { useCreateAction } from '../../mobile/chrome';
import { useTableLinkOpen } from './hooks';
import { t, tn } from '../../i18n';

/* ---------- sidebar ---------- */

/** The Tables sidebar: the company's tables, then each project's. */
export function TablesSidebar({ tables, clients, current, onOpen, onNew }: { tables: DataTable[]; clients: Client[]; current: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const company = tables.filter((t) => !t.clientId);
  const byProject = clients.map((c) => ({ c, list: tables.filter((t) => t.clientId === c.id) })).filter((g) => g.list.length);
  const item = (tb: DataTable) => (
    <button key={tb.id} className={`nav-item ${current === tb.id ? 'active' : ''}`} onClick={() => onOpen(tb.id)} title={tb.name}>
      <span className="client-dot" style={{ background: tb.color }}>
        {tb.name.charAt(0).toUpperCase()}
      </span>
      <span className="sb-label">{tb.name}</span>
    </button>
  );
  return (
    <>
      <button className="compose-btn" onClick={onNew} title={t('New table')}>
        <Plus size={16} />
        <span className="sb-label">{t('New table')}</span>
      </button>
      {company.length > 0 && (
        <>
          <div className="nav-heading sb-label">{t('Company')}</div>
          <nav className="nav">{company.map(item)}</nav>
        </>
      )}
      {byProject.map(({ c, list }) => (
        <div key={c.id}>
          <div className="nav-heading sb-label">{c.name}</div>
          <nav className="nav">{list.map(item)}</nav>
        </div>
      ))}
      {!tables.length && <p className="muted small sb-note sb-label">{t('No tables yet. Make one for leads, a content pipeline, anything you track in rows.')}</p>}
    </>
  );
}

/* ---------- new table ---------- */

export function NewTableDialog({ clients, clientId: startClient, onCreate, onClose }: { clients: Client[]; clientId?: string; onCreate: (d: { name: string; clientId?: string; template: TemplateId }) => void; onClose: () => void }) {
  const [template, setTemplate] = useState<TemplateId>('leads');
  const [clientId, setClientId] = useState(startClient ?? '');
  const tplName = TEMPLATES.find((x) => x.id === template)!.name;
  const project = clients.find((c) => c.id === clientId);
  const suggested = template === 'blank' ? t('Untitled table') : project ? t('{project} {template}', { project: project.name, template: tplName.toLowerCase() }) : tplName;
  const [name, setName] = useState('');
  const create = () => onCreate({ name: name.trim() || suggested, clientId: clientId || undefined, template });
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={t('New table')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Table2 size={15} /> {t('New table')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body connect-form">
          <SmoothHeight>
            <div className="field">
              <span>{t('Start from')}</span>
              <div className="cat-pick two">
                {TEMPLATES.map((x) => (
                  <button key={x.id} type="button" className={template === x.id ? 'on' : ''} onClick={() => setTemplate(x.id)}>
                    <strong>{x.name}</strong>
                    <small>{x.hint}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>{t('Name')}</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} onKeyDown={(e) => e.key === 'Enter' && create()} />
            </label>
            <div className="field">
              <span>{t('Belongs to')}</span>
              <ProjectPicker value={clientId} onChange={setClientId} projects={clients} none={t('The whole company')} label={t('Belongs to')} />
            </div>
            <p className="muted small">{clientId ? t('It shows in the {project}’s Tables tab too. Every column can be changed later.', { project: term.one }) : t('Everyone in the company can open it. Every column can be changed later.')}</p>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={create}>
            {t('Create table')}
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
      <EmptyState
        icon={<Table2 size={20} />}
        title={t('No tables for this {project} yet', { project: term.one })}
        text={t('Leads, a content pipeline, a list of anything: your own columns, as a grid or a board.')}
        action={
          <button className="primary-btn sm" onClick={onNew}>
            <Plus size={14} /> {t('New table')}
          </button>
        }
      />
    );
  return (
    <div className="tb-project">
      {!bare && <div className="tb-project-head">
        <span className="spacer" />
        <button className="ghost-btn sm" onClick={onNew}>
          <Plus size={13} /> {t('New table')}
        </button>
      </div>}
      <div className="tb-cards">
        {tables.map((tb, i) => {
          const n = rows.filter((r) => r.tableId === tb.id).length;
          return (
            <button key={tb.id} className="tb-table-card" style={{ ['--i' as string]: i }} onClick={() => onOpen(tb.id)}>
              <span className="client-badge" style={{ background: tb.color }}>
                {tb.name.charAt(0).toUpperCase()}
              </span>
              <span className="tb-tc-text">
                <strong>{tb.name}</strong>
                <small>{tb.description || `${tn(n, '{n} row', '{n} rows')} · ${tn(tb.fields.length, '{n} field', '{n} fields')}`}</small>
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
  useCreateAction('tables', { label: t('New table'), icon: Plus, run: onNew });
  useTableLinkOpen(null, onOpen); // a link to a table, a view or a row
  const groups = [{ id: '', name: t('Company'), list: tables.filter((tb) => !tb.clientId) }, ...clients.map((c) => ({ id: c.id, name: c.name, list: tables.filter((tb) => tb.clientId === c.id) }))].filter((g) => g.list.length);
  const phone = usePhone();
  // Phones: Notion's home, as iOS grouped rows under who they belong to. No counts.
  if (phone && tables.length)
    return (
      <section className="tasks-pane view-enter g-page tb-home-phone">
        <div className="tracking-scroll">
          {groups.map((g) => (
            <Group key={g.id || 'company'} title={g.name}>
              {g.list.map((tb) => (
                <button key={tb.id} type="button" className="g-row has-icon tb-home-row" onClick={() => onOpen(tb.id)}>
                  <span className="tb-home-tile" style={{ background: tb.color }} aria-hidden>
                    {tb.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="g-label">
                    <span className="g-text">{tb.name}</span>
                  </span>
                  <ChevronRight size={18} className="g-chev" aria-hidden />
                </button>
              ))}
            </Group>
          ))}
        </div>
      </section>
    );
  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head tb-head-bar tb-home-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('Open menu')}>
          <Menu size={18} />
        </button>
        <div className="th-text">
          <h1>{t('Tables')}</h1>
          <p>{t('Your own databases: leads, pipelines, lists of anything. Your columns, as a grid or a board.')}</p>
        </div>
        <button className="primary-btn sm" onClick={onNew}>
          <Plus size={14} /> {t('New table')}
        </button>
      </header>
      <div className="tracking-scroll">
        {!tables.length ? (
          <EmptyState
            icon={<Table2 size={20} />}
            title={t('No tables yet')}
            text={t('Start from Leads, a content pipeline or a blank table. Add your own columns any time.')}
            action={
              <button className="primary-btn sm" onClick={onNew}>
                <Plus size={14} /> {t('New table')}
              </button>
            }
          />
        ) : (
          groups.map((g) => (
            <div key={g.id || 'company'} className="tb-home-group">
              <h3 className="tb-home-group-head">{g.name}</h3>
              <ProjectTables tables={g.list} rows={rows} onOpen={onOpen} onNew={onNew} bare />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

