import { ProjectBadge } from './ProjectBadge';
import { useState } from 'react';
import { PROJECT_TYPES, term } from '../terms';
import { Archive, CalendarRange, Eye, FileText, Inbox, LayoutGrid, Layers, Plus, Send, Sparkles, Building2, Sun, Users } from 'lucide-react';
import type { Client, Team, Todo } from '../types';
import { doers, isBrief, type TaskScope } from './TasksView';
import { kindOf } from '../stages';
import { localDay } from '../utils';
import { usePersisted } from '../settings';
import { Select } from './ui/Select';
import { Badge } from './ui/Person';

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
  onAddClient?: (name: string, domain?: string, type?: string) => void;
  projectsApp?: boolean; // projects have their own app: no project list here
}

export function TasksSidebar({ scope, tasks, clients: allClients, teams: allTeams, me, isAdmin, myTeamIds, myClientIds, onScope, onBrainDump, onAddClient, projectsApp }: Props) {
  const teams = isAdmin ? allTeams : allTeams.filter((t) => myTeamIds.includes(t.id));
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
  const urgent = (t: Todo) => !!t.due && t.due <= today; // late or due today: the only counts worth showing
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
      <button className="compose-btn" onClick={onBrainDump} title="Brain dump">
        <Sparkles size={16} />
        <span className="sb-label">Brain dump</span>
      </button>
      <nav className="nav">
        {(
          [
            [{ kind: 'mine' }, Inbox, 'My tasks', 0],
            [{ kind: 'today' }, Sun, 'Today', open.filter((t) => doers(t).includes(me) && urgent(t)).length],
            [{ kind: 'upcoming' }, CalendarRange, 'Upcoming', 0],
            [{ kind: 'supervising' }, Eye, 'Supervising', open.filter((t) => t.supervisorId === me && kindOf(t) === 'review').length],
            [{ kind: 'myteams' }, Users, 'My teams', 0],
            [{ kind: 'myclients' }, Building2, `My ${term.many}`, 0],
            [{ kind: 'delegated' }, Send, 'Assigned by me', open.filter((t) => t.createdBy === me && !doers(t).includes(me) && !!t.due && t.due < today).length],
            [{ kind: 'briefs' }, FileText, 'Briefs', 0],
            ...(isAdmin
              ? ([
                  [{ kind: 'all' }, Layers, 'Everything', 0],
                  [{ kind: 'grid' }, LayoutGrid, `${term.Many} × teams`, 0],
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

      {!projectsApp && (
        <>
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
        {adding ? (
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
        ) : (
          onAddClient && (
            <button className="nav-item" onClick={() => setAdding(true)} title={`Add ${term.one}`}>
              <Plus size={17} />
              <span className="sb-label">Add {term.one}</span>
            </button>
          )
        )}
      </nav>
        </>
      )}
    </>
  );
}
