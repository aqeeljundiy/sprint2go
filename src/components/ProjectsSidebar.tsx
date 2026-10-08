import { ProjectBadge } from './ProjectBadge';
import { useState } from 'react';
import { PROJECT_TYPES, term } from '../terms';
import { Archive, LayoutGrid, Plus } from 'lucide-react';
import type { Client, Todo } from '../types';
import { isBrief, type TaskScope } from './TasksView';
import { SmoothHeight } from './ui/Smooth';
import { localDay } from '../utils';
import { usePersisted } from '../settings';
import { Select } from './ui/Select';
import { Badge } from './ui/Person';

interface Props {
  scope: TaskScope;
  tasks: Todo[];
  clients: Client[];
  isAdmin: boolean;
  myClientIds: string[];
  onScope: (s: TaskScope) => void;
  onAddClient?: (name: string, domain?: string, type?: string) => void; // missing: this person can't start projects
}

/**
 * The Projects app's sidebar: every project (filter by type), past ones, and a new one in two taps.
 * A project's page is the hub for everything about it (tasks, chat, mail, meetings, files, notes, logins, guests).
 */
export function ProjectsSidebar({ scope, tasks, clients: allClients, isAdmin, myClientIds, onScope, onAddClient }: Props) {
  const mineOrAll = isAdmin ? allClients : allClients.filter((c) => myClientIds.includes(c.id));
  const [typeFilter, setTypeFilter] = usePersisted<string>('s2g-project-type', '');
  const types = [...new Set(mineOrAll.filter((c) => c.status !== 'ended' && c.type).map((c) => c.type!))];
  const clients = mineOrAll.filter((c) => c.status !== 'ended' && (!typeFilter || !types.includes(typeFilter) || c.type === typeFilter));
  const past = mineOrAll.filter((c) => c.status === 'ended');
  const [showPast, setShowPast] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [type, setType] = useState('');
  const open = tasks.filter((t) => !t.done && !isBrief(t));
  const today = localDay();
  const is = (s: TaskScope) => s.kind === scope.kind && (!('id' in s) || ('id' in scope && scope.id === s.id));

  const save = () => {
    if (!name.trim()) return;
    onAddClient?.(name.trim(), domain.trim().replace(/^@/, '') || undefined, type || undefined);
    setName('');
    setDomain('');
    setType('');
    setAdding(false);
  };

  return (
    <>
      {onAddClient && (
        <button className="compose-btn" onClick={() => setAdding((a) => !a)} title={`New ${term.one}`}>
          <Plus size={16} />
          <span className="sb-label">New {term.one}</span>
        </button>
      )}
      <SmoothHeight>
        {adding && (
          <div className="add-client sb-label">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`${term.One} name`} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Email domain (optional)" onKeyDown={(e) => e.key === 'Enter' && save()} />
            <Select<string> value={type} onChange={setType} label="Type" options={[{ value: '', label: 'No type' }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]} />
            <div>
              <button className="ghost-btn sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="primary-btn sm" onClick={save} disabled={!name.trim()}>
                Add
              </button>
            </div>
          </div>
        )}
      </SmoothHeight>
      <nav className="nav">
        <button className={`nav-item ${scope.kind === 'projects' ? 'active' : ''}`} onClick={() => onScope({ kind: 'projects' })} title={`All ${term.many}`}>
          <LayoutGrid size={17} />
          <span className="sb-label">All {term.many}</span>
        </button>
      </nav>
      <div className="nav-heading sb-label">{term.Many}</div>
      {types.length > 1 && (
        <div className="type-chips sb-label" role="group" aria-label={`Filter ${term.many} by type`}>
          {['', ...types].map((t) => (
            <button key={t || 'all'} className={(typeFilter && types.includes(typeFilter) ? typeFilter : '') === t ? 'on' : ''} onClick={() => setTypeFilter(t)}>
              {t || 'All'}
            </button>
          ))}
        </div>
      )}
      <nav className="nav">
        {clients.map((c) => {
          const n = open.filter((t) => t.clientId === c.id && !!t.due && t.due < today).length; // late work only
          return (
            <button key={c.id} className={`nav-item ${is({ kind: 'client', id: c.id }) ? 'active' : ''}`} onClick={() => onScope({ kind: 'client', id: c.id })} title={c.name}>
              <ProjectBadge p={c} kind="client-dot" />
              <span className="sb-label">
                {c.name}
                {c.status === 'lead' && <Badge small>Lead</Badge>}
              </span>
              {n ? <span className="count warn-count" title={`${n} late`}>{n}</span> : null}
            </button>
          );
        })}
        {past.length > 0 && (
          <button className={`nav-item past-toggle ${is({ kind: 'past' }) ? 'active' : ''}`} onClick={() => (setShowPast((x) => !x), onScope({ kind: 'past' }))} title={`Past ${term.many}`}>
            <Archive size={16} />
            <span className="sb-label">Past {term.many}</span>
          </button>
        )}
        {showPast &&
          past.map((c) => (
            <button key={c.id} className={`nav-item past ${is({ kind: 'client', id: c.id }) ? 'active' : ''}`} onClick={() => onScope({ kind: 'client', id: c.id })} title={c.name}>
              <ProjectBadge p={c} kind="client-dot" />
              <span className="sb-label">{c.name}</span>
            </button>
          ))}
      </nav>
    </>
  );
}
