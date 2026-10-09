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
import { t, tn, tx } from '../i18n';

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
  const teams = isAdmin ? allTeams : allTeams.filter((tm) => myTeamIds.includes(tm.id));
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
  const open = tasks.filter((x) => !x.done && !isBrief(x));
  const today = localDay();
  const urgent = (x: Todo) => !!x.due && x.due <= today; // late or due today: the only counts worth showing
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
      <button className="compose-btn" onClick={onBrainDump} title={t('Brain dump')}>
        <Sparkles size={16} />
        <span className="sb-label">{t('Brain dump')}</span>
      </button>
      <nav className="nav">
        {(
          [
            [{ kind: 'mine' }, Inbox, t('My tasks'), 0],
            [{ kind: 'today' }, Sun, t('Today'), open.filter((x) => doers(x).includes(me) && urgent(x)).length],
            [{ kind: 'upcoming' }, CalendarRange, t('Upcoming'), 0],
            [{ kind: 'supervising' }, Eye, t('Supervising'), open.filter((x) => x.supervisorId === me && kindOf(x) === 'review').length],
            [{ kind: 'myteams' }, Users, t('My teams'), 0],
            [{ kind: 'myclients' }, Building2, t('My {projects}', { projects: term.many }), 0],
            [{ kind: 'delegated' }, Send, t('Assigned by me'), open.filter((x) => x.createdBy === me && !doers(x).includes(me) && !!x.due && x.due < today).length],
            [{ kind: 'briefs' }, FileText, t('Briefs'), 0],
            ...(isAdmin
              ? ([
                  [{ kind: 'all' }, Layers, t('Everything'), 0],
                  [{ kind: 'grid' }, LayoutGrid, t('{Projects} × teams', { projects: term.many }), 0],
                ] as const)
              : []),
          ] as const
        ).map(([s, Icon, label, count]) => (
          <button key={s.kind} className={`nav-item ${is(s) ? 'active' : ''}`} onClick={() => onScope(s)} title={label}>
            <Icon size={17} />
            <span className="sb-label">{label}</span>
            {count ? <span className="count warn-count">{count}</span> : null}
          </button>
        ))}
      </nav>

      {teams.length > 0 && (
        <>
          <div className="nav-heading sb-label">{t('Teams')}</div>
          <nav className="nav">
            {teams.map((tm) => {
              const mine = open.filter((x) => x.teamId === tm.id);
              const waiting = mine.filter((x) => !x.userId).length;
              return (
                <button key={tm.id} className={`nav-item ${is({ kind: 'team', id: tm.id }) ? 'active' : ''}`} onClick={() => onScope({ kind: 'team', id: tm.id })} title={tm.name}>
                  <span className="team-square" style={{ background: tm.color }} />
                  <span className="sb-label">{tm.name}</span>
                  {waiting ? (
                    <span className="count warn-count" title={tn(waiting, '{n} not assigned', '{n} not assigned')}>
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
        <div className="type-chips sb-label" role="group" aria-label={t('Filter {projects} by type', { projects: term.many })}>
          {['', ...types].map((ty) => (
            <button key={ty || 'all'} className={(typeFilter && types.includes(typeFilter) ? typeFilter : '') === ty ? 'on' : ''} onClick={() => setTypeFilter(ty)}>
              {ty ? t(ty) : t('All')}
            </button>
          ))}
        </div>
      )}
      <nav className="nav">
        {clients.map((c) => {
          const n = open.filter((x) => x.clientId === c.id && !!x.due && x.due < today).length; // late work only
          return (
            <button key={c.id} className={`nav-item ${is({ kind: 'client', id: c.id }) ? 'active' : ''}`} onClick={() => onScope({ kind: 'client', id: c.id })} title={c.name}>
              <ProjectBadge p={c} kind="client-dot" />
              <span className="sb-label">
                {c.name}
                {c.status === 'lead' && <Badge small>{tx('status', 'Lead')}</Badge>}
              </span>
              {n ? <span className="count warn-count" title={tn(n, '{n} late', '{n} late')}>{n}</span> : null}
            </button>
          );
        })}
        {past.length > 0 && (
          <button className={`nav-item past-toggle ${is({ kind: 'past' }) ? 'active' : ''}`} onClick={() => (setShowPast((x) => !x), onScope({ kind: 'past' }))} title={t('Past {projects}', { projects: term.many })}>
            <Archive size={16} />
            <span className="sb-label">{t('Past {projects}', { projects: term.many })}</span>
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
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('{Project} name', { project: term.one })} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={t('Email domain (optional)')} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <Select<string> value={type} onChange={setType} label={t('Type')} options={[{ value: '', label: t('No type') }, ...PROJECT_TYPES.map((ty) => ({ value: ty, label: t(ty) }))]} />
            <div>
              <button className="ghost-btn sm" onClick={() => setAdding(false)}>
                {t('Cancel')}
              </button>
              <button className="primary-btn sm" onClick={save} disabled={!name.trim()}>
                {t('Add')}
              </button>
            </div>
          </div>
        ) : (
          onAddClient && (
            <button className="nav-item" onClick={() => setAdding(true)} title={t('Add {project}', { project: term.one })}>
              <Plus size={17} />
              <span className="sb-label">{t('Add {project}', { project: term.one })}</span>
            </button>
          )
        )}
      </nav>
        </>
      )}
    </>
  );
}
