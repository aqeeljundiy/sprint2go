import { useState } from 'react';
import { Eye, FileText, Inbox, LayoutGrid, Layers, Plus, Send, Sparkles, Building2, Users } from 'lucide-react';
import type { Client, Team, Todo } from '../types';
import { doers, isBrief, statusOf, type TaskScope } from './TasksView';
import { localDay } from '../utils';

interface Props {
  scope: TaskScope;
  tasks: Todo[];
  clients: Client[];
  teams: Team[];
  me: string;
  isAdmin: boolean;
  myTeamIds: string[];
  myClientIds: string[];
  onScope: (s: TaskScope) => void;
  onBrainDump: () => void;
  onAddClient: (name: string, domain?: string) => void;
}

export function TasksSidebar({ scope, tasks, clients: allClients, teams: allTeams, me, isAdmin, myTeamIds, myClientIds, onScope, onBrainDump, onAddClient }: Props) {
  const teams = isAdmin ? allTeams : allTeams.filter((t) => myTeamIds.includes(t.id));
  const clients = isAdmin ? allClients : allClients.filter((c) => myClientIds.includes(c.id));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const open = tasks.filter((t) => !t.done && !isBrief(t));
  const today = localDay();
  const urgent = (t: Todo) => !!t.due && t.due <= today; // late or due today: the only counts worth showing
  const is = (s: TaskScope) => s.kind === scope.kind && (!('id' in s) || ('id' in scope && scope.id === s.id));

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
            [{ kind: 'mine' }, Inbox, 'My tasks', open.filter((t) => doers(t).includes(me) && urgent(t)).length],
            [{ kind: 'supervising' }, Eye, 'Supervising', open.filter((t) => t.supervisorId === me && statusOf(t) === 'review').length],
            [{ kind: 'myteams' }, Users, 'My teams', 0],
            [{ kind: 'myclients' }, Building2, 'My clients', 0],
            [{ kind: 'delegated' }, Send, 'Assigned by me', open.filter((t) => t.createdBy === me && !doers(t).includes(me) && !!t.due && t.due < today).length],
            [{ kind: 'briefs' }, FileText, 'Briefs', 0],
            ...(isAdmin
              ? ([
                  [{ kind: 'all' }, Layers, 'Everything', 0],
                  [{ kind: 'grid' }, LayoutGrid, 'Clients × teams', 0],
                ] as const)
              : []),
          ] as const
        ).map(([s, Icon, label, count]) => (
          <button key={label} className={`nav-item ${is(s) ? 'active' : ''}`} onClick={() => onScope(s)} title={label}>
            <Icon size={17} />
            <span className="sb-label">{label}</span>
            {count ? <span className="count warn-count">{count}</span> : null}
          </button>
        ))}
      </nav>

      {teams.length > 0 && (
        <>
          <div className="nav-heading sb-label">Teams</div>
          <nav className="nav">
            {teams.map((tm) => {
              const mine = open.filter((t) => t.teamId === tm.id);
              const waiting = mine.filter((t) => !t.userId).length;
              return (
                <button key={tm.id} className={`nav-item ${is({ kind: 'team', id: tm.id }) ? 'active' : ''}`} onClick={() => onScope({ kind: 'team', id: tm.id })} title={tm.name}>
                  <span className="team-square" style={{ background: tm.color }} />
                  <span className="sb-label">{tm.name}</span>
                  {waiting ? (
                    <span className="count warn-count" title={`${waiting} not assigned`}>
                      {waiting}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </>
      )}

      <div className="nav-heading sb-label">Clients</div>
      <nav className="nav">
        {clients.map((c) => {
          const n = open.filter((t) => t.clientId === c.id && !!t.due && t.due < today).length; // late work only
          return (
            <button key={c.id} className={`nav-item ${is({ kind: 'client', id: c.id }) ? 'active' : ''}`} onClick={() => onScope({ kind: 'client', id: c.id })} title={c.name}>
              <span className="client-dot" style={{ background: c.color }}>
                {c.name.charAt(0)}
              </span>
              <span className="sb-label">
                {c.name}
                {c.status === 'lead' && <em className="lead-tag">lead</em>}
              </span>
              {n ? <span className="count warn-count" title={`${n} late`}>{n}</span> : null}
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
