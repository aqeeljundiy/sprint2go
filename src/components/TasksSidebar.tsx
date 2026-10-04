import { useState } from 'react';
import { Inbox, Layers, Plus, Send, Sparkles } from 'lucide-react';
import type { Client, Todo } from '../types';
import type { TaskScope } from './TasksView';

interface Props {
  scope: TaskScope;
  tasks: Todo[];
  clients: Client[];
  me: string;
  onScope: (s: TaskScope) => void;
  onBrainDump: () => void;
  onAddClient: (name: string, domain?: string) => void;
}

export function TasksSidebar({ scope, tasks, clients, me, onScope, onBrainDump, onAddClient }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const open = tasks.filter((t) => !t.done);
  const is = (s: TaskScope) => s.kind === scope.kind && (s.kind !== 'client' || (scope.kind === 'client' && scope.id === s.id));

  const save = () => {
    if (!name.trim()) return;
    onAddClient(name.trim(), domain.trim().replace(/^@/, '') || undefined);
    setName('');
    setDomain('');
    setAdding(false);
  };

  return (
    <>
      <button className="compose-btn" onClick={onBrainDump} title="Brain dump">
        <Sparkles size={16} />
        <span className="sb-label">Brain dump</span>
      </button>
      <nav className="nav">
        {(
          [
            [{ kind: 'mine' }, Inbox, 'My tasks', open.filter((t) => t.userId === me).length],
            [{ kind: 'delegated' }, Send, 'Assigned by me', open.filter((t) => t.createdBy === me && t.userId !== me).length],
            [{ kind: 'all' }, Layers, 'All tasks', open.length],
          ] as const
        ).map(([s, Icon, label, count]) => (
          <button key={label} className={`nav-item ${is(s) ? 'active' : ''}`} onClick={() => onScope(s)} title={label}>
            <Icon size={17} />
            <span className="sb-label">{label}</span>
            {count ? <span className="count muted-count">{count}</span> : null}
          </button>
        ))}
      </nav>

      <div className="nav-heading sb-label">Clients</div>
      <nav className="nav">
        {clients.map((c) => {
          const n = open.filter((t) => t.clientId === c.id).length;
          return (
            <button key={c.id} className={`nav-item ${is({ kind: 'client', id: c.id }) ? 'active' : ''}`} onClick={() => onScope({ kind: 'client', id: c.id })} title={c.name}>
              <span className="client-dot" style={{ background: c.color }}>
                {c.name.charAt(0)}
              </span>
              <span className="sb-label">
                {c.name}
                {c.status === 'lead' && <em className="lead-tag">lead</em>}
              </span>
              {n ? <span className="count muted-count">{n}</span> : null}
            </button>
          );
        })}
        {adding ? (
          <div className="add-client sb-label">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Client name" onKeyDown={(e) => e.key === 'Enter' && save()} />
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Email domain (optional)" onKeyDown={(e) => e.key === 'Enter' && save()} />
            <div>
              <button className="ghost-btn sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="primary-btn sm" onClick={save} disabled={!name.trim()}>
                Add
              </button>
            </div>
          </div>
        ) : (
          <button className="nav-item" onClick={() => setAdding(true)} title="Add client">
            <Plus size={17} />
            <span className="sb-label">Add client</span>
          </button>
        )}
      </nav>
    </>
  );
}
