import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, LogOut, Menu, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import type { Client, HomeTemplateId, Team, Todo, User } from '../../types';
import { localDay, relative } from '../../utils';
import { Avatar } from '../Avatar';
import { HOME_TEMPLATES } from '../HomeView';
import { PeoplePicker, PersonSelect } from '../ui/PeoplePicker';
import { PeopleList } from '../ui/PeopleList';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
import { SmoothHeight, TabPane } from '../ui/Smooth';

export const TEAM_COLORS = ['#0ea5e9', '#10b981', '#f97316', '#8b5cf6', '#d946ef', '#ef4444', '#f59e0b', '#64748b'];

/** Who can change a team: admins, and the team's lead. */
export const canManageTeam = (t: Team, me: string, isAdmin: boolean) => isAdmin || t.leadId === me;

const isOpen = (t: Todo) => !t.doneAt && t.status !== 'done';
const doers = (t: Todo) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
const today = () => localDay();
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const shortDate = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export interface TeamActions {
  patch: (id: string, p: Partial<Team>) => void;
  join: (t: Team) => void; // joins an open team, or asks the lead
  direct: (t: Team) => boolean; // this person can join without asking (an open team, or they're an admin)
  leave: (t: Team) => void;
  remove: (t: Team) => void;
}

/* ---------- the sidebar: your teams, then the rest ---------- */

export function TeamsSidebar({ teams, me, current, canCreate, onOpen, onNew }: { teams: Team[]; me: string; current: string | null; canCreate: boolean; onOpen: (id: string | null) => void; onNew: () => void }) {
  const mine = teams.filter((t) => t.members.includes(me));
  const others = teams.filter((t) => !t.members.includes(me));
  const item = (t: Team) => (
    <button key={t.id} className={`nav-item ${current === t.id ? 'active' : ''}`} onClick={() => onOpen(t.id)} title={t.name}>
      <span className="team-square" style={{ background: t.color }} />
      <span className="sb-label">{t.name}</span>
      {(t.requests?.length ?? 0) > 0 && t.leadId === me && <span className="count">{t.requests!.length}</span>}
    </button>
  );
  return (
    <>
      {canCreate && (
        <button className="compose-btn" onClick={onNew} title="New team">
          <Plus size={16} />
          <span className="sb-label">New team</span>
        </button>
      )}
      <nav className="nav">
        <button className={`nav-item ${current === null ? 'active' : ''}`} onClick={() => onOpen(null)}>
          <Users size={16} />
          <span className="sb-label">All teams</span>
        </button>
      </nav>
      {mine.length > 0 && (
        <>
          <div className="nav-heading sb-label">Your teams</div>
          <nav className="nav">{mine.map(item)}</nav>
        </>
      )}
      {others.length > 0 && (
        <>
          <div className="nav-heading sb-label">Other teams</div>
          <nav className="nav">{others.map(item)}</nav>
        </>
      )}
    </>
  );
}

/** Join, ask to join, or a note that you're in it. */
function JoinButton({ t, me, actions, small }: { t: Team; me: string; actions: TeamActions; small?: boolean }) {
  const cls = small ? 'ghost-btn sm' : 'primary-btn sm';
  if (t.members.includes(me))
    return (
      <span className="team-in small">
        <Check size={13} /> You’re in it
      </span>
    );
  if (t.requests?.some((r) => r.userId === me))
    return (
      <button type="button" className="ghost-btn sm" onClick={(e) => (e.stopPropagation(), actions.patch(t.id, { requests: t.requests!.filter((r) => r.userId !== me) }))} title="Take back your request">
        Asked to join · Undo
      </button>
    );
  return (
    <button type="button" className={cls} onClick={(e) => (e.stopPropagation(), actions.join(t))}>
      <UserPlus size={14} /> {actions.direct(t) ? 'Join' : 'Ask to join'}
    </button>
  );
}

/** What needs attention on a team, in a few words (or that it's fine). */
function teamState(t: Team, tasks: Todo[]) {
  const open = tasks.filter((x) => x.teamId === t.id && isOpen(x));
  const late = open.filter((x) => x.due && x.due < today()).length;
  const waiting = open.filter((x) => !doers(x).length).length;
  const review = open.filter((x) => x.status === 'review').length;
  const issues = [late && `${late} late`, waiting && `${waiting} not picked up`, review && `${review} to review`].filter(Boolean) as string[];
  return { open: open.length, late, issues };
}

/* ---------- all teams ---------- */

export function TeamsHome({ teams, users, tasks, me, canCreate, actions, onOpen, onNew, onMenu }: { teams: Team[]; users: User[]; tasks: Todo[]; me: string; canCreate: boolean; actions: TeamActions; onOpen: (id: string) => void; onNew: () => void; onMenu: () => void }) {
  const sorted = [...teams].sort((a, b) => Number(b.members.includes(me)) - Number(a.members.includes(me)) || a.name.localeCompare(b.name));
  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="th-text">
          <h1>Teams</h1>
          <p>Departments like Video, Design or Finance. Tasks belong to a project and a team, so leads see their team’s work and who has too much.</p>
        </div>
        {canCreate && (
          <button className="primary-btn sm" onClick={onNew}>
            <Plus size={14} /> New team
          </button>
        )}
      </header>
      <div className="tracking-scroll">
        {!teams.length ? (
          <div className="empty">
            <div className="empty-art">
              <Users size={20} />
            </div>
            <p className="empty-title">No teams yet</p>
            <p className="empty-sub">Make one per department. People can be in more than one team.</p>
            {canCreate && (
              <button className="primary-btn sm" onClick={onNew}>
                <Plus size={14} /> New team
              </button>
            )}
          </div>
        ) : (
          <div className="proj-grid">
            {sorted.map((t, i) => {
              const lead = users.find((u) => u.id === t.leadId);
              const s = teamState(t, tasks);
              return (
                <div key={t.id} className="proj-card team-card-x" role="button" tabIndex={0} style={{ ['--i' as string]: i }} onClick={() => onOpen(t.id)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(t.id)}>
                  <span className="proj-top">
                    <span className="team-square big" style={{ background: t.color }} />
                    <span className="proj-name">
                      <strong>{t.name}</strong>
                      <small>{t.about || (lead ? `Led by ${lead.name}` : 'No lead yet')}</small>
                    </span>
                  </span>
                  <span className="team-people">
                    <span className="av-stack">
                      {t.members.slice(0, 6).map((id) => {
                        const u = users.find((x) => x.id === id);
                        return u ? <Avatar key={id} person={u} size={22} /> : null;
                      })}
                    </span>
                    <small className="muted">{t.members.length ? `${t.members.length} ${t.members.length === 1 ? 'person' : 'people'}` : 'Nobody yet'}</small>
                  </span>
                  <span className={`proj-state ${s.issues.length ? (s.late ? 'bad' : 'warn') : 'ok'}`}>
                    {s.issues.length ? (
                      s.issues.join(' · ')
                    ) : (
                      <>
                        <Check size={13} /> {s.open ? 'On track' : 'Nothing open'}
                      </>
                    )}
                  </span>
                  <span className="proj-foot">
                    <JoinButton t={t} me={me} actions={actions} small />
                    <ChevronRight size={14} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- one team ---------- */

type TeamTab = 'members' | 'work' | 'workload' | 'settings';

export function TeamPage({
  team: t,
  teams,
  users,
  tasks,
  clients,
  me,
  isAdmin,
  actions,
  homeTemplate,
  onHomeTemplate,
  onOpenTask,
  onBack,
}: {
  team: Team;
  teams: Team[];
  users: User[];
  tasks: Todo[];
  clients: Client[];
  me: string;
  isAdmin: boolean;
  actions: TeamActions;
  homeTemplate?: HomeTemplateId;
  onHomeTemplate: (v: HomeTemplateId) => void;
  onOpenTask: (id: string) => void;
  onBack: () => void;
}) {
  const manage = canManageTeam(t, me, isAdmin);
  const [tab, setTab] = useState<TeamTab>('members');
  const tabs: { id: TeamTab; label: string }[] = [
    { id: 'members', label: 'People' },
    { id: 'work', label: 'Work' },
    { id: 'workload', label: 'Workload' },
    ...(manage ? [{ id: 'settings' as const, label: 'Settings' }] : []),
  ];
  const lead = users.find((u) => u.id === t.leadId);
  return (
    <section className="tasks-pane view-enter team-page">
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={onBack} aria-label="All teams">
          <ArrowLeft size={18} />
        </button>
        <span className="team-square big" style={{ background: t.color }} />
        <div className="th-text">
          <h1>{t.name}</h1>
          <p>{t.about || (lead ? `Led by ${lead.name}` : 'No lead yet')}</p>
        </div>
        <JoinButton t={t} me={me} actions={actions} />
      </header>
      <div className="client-tabs team-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.label}
            {x.id === 'members' && manage && (t.requests?.length ?? 0) > 0 && <span className="count">{t.requests!.length}</span>}
          </button>
        ))}
      </div>
      <div className="tracking-scroll">
        <TabPane key={tab}>
          {tab === 'members' && <MembersTab t={t} teams={teams} users={users} me={me} manage={manage} actions={actions} />}
          {tab === 'work' && <WorkTab t={t} tasks={tasks} users={users} clients={clients} onOpenTask={onOpenTask} />}
          {tab === 'workload' && <WorkloadTab t={t} tasks={tasks} users={users} onOpenTask={onOpenTask} />}
          {tab === 'settings' && manage && <SettingsTab t={t} users={users} isAdmin={isAdmin} actions={actions} homeTemplate={homeTemplate} onHomeTemplate={onHomeTemplate} />}
        </TabPane>
      </div>
    </section>
  );
}

function MembersTab({ t, teams, users, me, manage, actions }: { t: Team; teams: Team[]; users: User[]; me: string; manage: boolean; actions: TeamActions }) {
  const people = t.members.map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[];
  const requests = (t.requests ?? []).map((r) => ({ r, u: users.find((u) => u.id === r.userId) })).filter((x) => x.u) as { r: { userId: string; at: string }; u: User }[];
  const approve = (id: string) => actions.patch(t.id, { members: [...new Set([...t.members, id])], requests: (t.requests ?? []).filter((r) => r.userId !== id) });
  const decline = (id: string) => actions.patch(t.id, { requests: (t.requests ?? []).filter((r) => r.userId !== id) });
  return (
    <div className="team-sec">
      {manage && requests.length > 0 && (
        <div className="team-block">
          <h3>Asked to join</h3>
          {requests.map(({ r, u }) => (
            <div key={u.id} className="team-row">
              <Avatar person={u} size={32} />
              <span className="team-row-text">
                <strong>{u.name}</strong>
                <small className="muted">
                  {u.title ? `${u.title} · ` : ''}asked {relative(r.at)}
                </small>
              </span>
              <button className="ghost-btn sm" onClick={() => decline(u.id)}>
                Decline
              </button>
              <button className="primary-btn sm" onClick={() => approve(u.id)}>
                Add to team
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="team-block">
        <div className="team-block-head">
          <h3>People</h3>
          {manage && <AddPeople t={t} users={users} me={me} onChange={(members) => actions.patch(t.id, { members, leadId: t.leadId && !members.includes(t.leadId) ? undefined : t.leadId })} />}
        </div>
        {!people.length && <p className="muted small">Nobody in this team yet.{manage ? ' Add people above.' : t.join === 'open' ? ' Join it from the top.' : ''}</p>}
        {people.map((u) => {
          const also = teams.filter((x) => x.id !== t.id && x.members.includes(u.id));
          return (
            <div key={u.id} className="team-row">
              <Avatar person={u} size={32} />
              <span className="team-row-text">
                <strong>
                  {u.id === me ? `${u.name} (me)` : u.name}
                  {t.leadId === u.id && <span className="team-lead-tag">Lead</span>}
                </strong>
                <small className="muted">{[u.title, also.length ? `Also in ${also.map((x) => x.name).join(', ')}` : ''].filter(Boolean).join(' · ') || u.email}</small>
              </span>
              {manage && t.leadId !== u.id && (
                <button className="link-btn small" onClick={() => actions.patch(t.id, { leadId: u.id })}>
                  Make lead
                </button>
              )}
              {u.id === me && !manage ? (
                <button className="ghost-btn sm" onClick={() => actions.leave(t)}>
                  <LogOut size={13} /> Leave
                </button>
              ) : (
                manage && (
                  <button className="icon-btn sm" aria-label={`Remove ${u.name}`} title="Remove from team" onClick={() => actions.patch(t.id, { members: t.members.filter((x) => x !== u.id), leadId: t.leadId === u.id ? undefined : t.leadId })}>
                    <X size={14} />
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "Add people": the searchable people list; ticking adds, unticking removes. */
function AddPeople({ t, users, me, onChange }: { t: Team; users: User[]; me: string; onChange: (members: string[]) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={btn} type="button" className="ghost-btn sm" onClick={() => setOpen((o) => !o)}>
        <UserPlus size={14} /> Add people
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={300} align="end" title={`People in ${t.name}`}>
        <PeopleList users={users} me={me} selected={t.members} onPick={(id) => onChange(t.members.includes(id) ? t.members.filter((x) => x !== id) : [...t.members, id])} />
      </Popover>
    </>
  );
}

/** The team's open work, by when it's due. */
function WorkTab({ t, tasks, users, clients, onOpenTask }: { t: Team; tasks: Todo[]; users: User[]; clients: Client[]; onOpenTask: (id: string) => void }) {
  const [who, setWho] = useState<string>('');
  const open = tasks.filter((x) => x.teamId === t.id && isOpen(x) && (!who || (who === '-' ? !doers(x).length : doers(x).includes(who))));
  const groups: { id: string; label: string; list: Todo[]; bad?: boolean }[] = [
    { id: 'late', label: 'Late', list: open.filter((x) => x.due && x.due < today()), bad: true },
    { id: 'week', label: 'This week', list: open.filter((x) => x.due && x.due >= today() && x.due <= inDays(7)) },
    { id: 'later', label: 'Later', list: open.filter((x) => x.due && x.due > inDays(7)) },
    { id: 'none', label: 'No date', list: open.filter((x) => !x.due) },
  ].filter((g) => g.list.length);
  const doneWeek = tasks.filter((x) => x.teamId === t.id && x.doneAt && x.doneAt.slice(0, 10) >= inDays(-7)).length;
  return (
    <div className="team-sec">
      <div className="team-filter">
        <PersonSelect
          value={who}
          users={users.filter((u) => t.members.includes(u.id))}
          label="Whose work"
          extra={[
            { value: '', label: 'Everyone in the team', icon: <Users size={15} /> },
            { value: '-', label: 'Not picked up yet', icon: <UserPlus size={15} /> },
          ]}
          onChange={setWho}
        />
        {doneWeek > 0 && <span className="muted small">{doneWeek} done this week</span>}
      </div>
      {!groups.length && <p className="muted small team-empty">{who ? 'Nothing open here.' : `Nothing open for ${t.name}. Tasks with this team show up here.`}</p>}
      {groups.map((g) => (
        <div key={g.id} className="team-block">
          <h3 className={g.bad ? 'bad' : ''}>
            {g.label} <span className="muted">{g.list.length}</span>
          </h3>
          {g.list
            .sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))
            .map((x) => {
              const client = clients.find((c) => c.id === x.clientId);
              const people = doers(x).map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[];
              return (
                <button key={x.id} type="button" className="team-row team-task" onClick={() => onOpenTask(x.id)}>
                  <span className="team-row-text">
                    <strong>{x.title}</strong>
                    <small className="muted">{[client?.name, x.status === 'review' ? 'Waiting for review' : x.status === 'waiting' ? 'Waiting on the guest' : ''].filter(Boolean).join(' · ') || ' '}</small>
                  </span>
                  {x.due && <span className={`team-due small ${x.due < today() ? 'bad' : ''}`}>{shortDate(x.due)}</span>}
                  <span className="av-stack">{people.length ? people.slice(0, 3).map((u) => <Avatar key={u.id} person={u} size={22} />) : <span className="team-nobody small">Nobody</span>}</span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/** Who has how much: everyone's open work (all of it, not only this team's), late first. */
function WorkloadTab({ t, tasks, users, onOpenTask }: { t: Team; tasks: Todo[]; users: User[]; onOpenTask: (id: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      t.members
        .map((id) => users.find((u) => u.id === id))
        .filter(Boolean)
        .map((u) => {
          const mine = tasks.filter((x) => isOpen(x) && doers(x).includes(u!.id));
          return { u: u!, mine, late: mine.filter((x) => x.due && x.due < today()).length, week: mine.filter((x) => x.due && x.due >= today() && x.due <= inDays(7)).length, here: mine.filter((x) => x.teamId === t.id).length };
        })
        .sort((a, b) => b.late - a.late || b.mine.length - a.mine.length),
    [t, tasks, users],
  );
  const most = Math.max(1, ...rows.map((r) => r.mine.length));
  if (!rows.length) return <p className="muted small team-empty">Add people to the team to see who has how much.</p>;
  return (
    <div className="team-sec">
      <p className="muted small">Everything each person has open, from every team and project. Late work first; open someone to see their list.</p>
      <div className="team-block">
        {rows.map(({ u, mine, late, week, here }) => (
          <div key={u.id} className="team-load">
            <button type="button" className="team-row" onClick={() => setOpenId(openId === u.id ? null : u.id)} aria-expanded={openId === u.id}>
              <Avatar person={u} size={30} />
              <span className="team-row-text">
                <strong>{u.name}</strong>
                <small className="muted">{[late && `${late} late`, week && `${week} due this week`, `${here} in ${t.name}`].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="team-bar" aria-label={`${mine.length} open`}>
                <i style={{ width: `${(mine.length / most) * 100}%` }} className={late ? 'bad' : mine.length > 8 ? 'warn' : ''} />
              </span>
              <span className="team-count">{mine.length}</span>
              <ChevronRight size={14} className={`rot-chev ${openId === u.id ? 'open' : ''}`} />
            </button>
            <div className={`fold ${openId === u.id ? 'open' : ''}`}>
              <div className="fold-in">
                <div className="team-load-list">
                  {mine.length === 0 && <p className="muted small">Nothing open.</p>}
                  {mine
                    .sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))
                    .map((x) => (
                      <button key={x.id} type="button" className="team-mini" onClick={() => onOpenTask(x.id)}>
                        <span>{x.title}</span>
                        {x.due && <small className={x.due < today() ? 'bad' : 'muted'}>{shortDate(x.due)}</small>}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsTab({ t, users, isAdmin, actions, homeTemplate, onHomeTemplate }: { t: Team; users: User[]; isAdmin: boolean; actions: TeamActions; homeTemplate?: HomeTemplateId; onHomeTemplate: (v: HomeTemplateId) => void }) {
  const patch = (p: Partial<Team>) => actions.patch(t.id, p);
  return (
    <div className="team-sec team-settings">
      <label className="team-field">
        <span>Name</span>
        <input value={t.name} onChange={(e) => patch({ name: e.target.value })} />
      </label>
      <label className="team-field">
        <span>What it does</span>
        <input value={t.about ?? ''} placeholder="Edits every video and reel" onChange={(e) => patch({ about: e.target.value })} />
      </label>
      <div className="team-field">
        <span>Colour</span>
        <div className="tb-colors">
          {TEAM_COLORS.map((c) => (
            <button key={c} type="button" className={`tb-dot big${t.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => patch({ color: c })} aria-label={c} />
          ))}
        </div>
      </div>
      <div className="team-field">
        <span>Lead</span>
        <PersonSelect value={t.leadId ?? ''} users={users} label="Lead" extra={[{ value: '', label: 'No lead', icon: <X size={14} /> }]} onChange={(id) => patch({ leadId: id || undefined, members: id && !t.members.includes(id) ? [...t.members, id] : t.members })} />
      </div>
      <div className="team-field">
        <span>Joining</span>
        <div className="segmented sm">
          <button type="button" className={t.join === 'open' ? 'on' : ''} onClick={() => patch({ join: 'open' })}>
            Anyone can join
          </button>
          <button type="button" className={t.join !== 'open' ? 'on' : ''} onClick={() => patch({ join: 'lead' })}>
            The lead adds people
          </button>
        </div>
      </div>
      <p className="muted small team-hint">{t.join === 'open' ? 'Anyone in the company can join from the team page.' : 'Others can ask to join; the lead gets a notification to approve.'}</p>
      <div className="team-field">
        <span>Review</span>
        <label className="check-row small">
          <input type="checkbox" checked={!!t.review} onChange={(e) => patch({ review: e.target.checked })} /> Finished tasks wait for the lead before they count as done
        </label>
      </div>
      <label className="team-field">
        <span>Keywords</span>
        <input value={(t.keywords ?? []).join(', ')} onChange={(e) => patch({ keywords: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} placeholder="video, reel, edit (the brain dump uses these)" />
      </label>
      <div className="team-field">
        <span>Home</span>
        <Select<HomeTemplateId> value={homeTemplate ?? null} onChange={onHomeTemplate} placeholder="Guess from role" label="Default Home" options={(Object.keys(HOME_TEMPLATES) as HomeTemplateId[]).map((k) => ({ value: k, label: HOME_TEMPLATES[k].name, hint: HOME_TEMPLATES[k].hint }))} />
      </div>
      {isAdmin && (
        <div className="team-danger">
          <button className="ghost-btn sm danger" onClick={() => confirm(`Delete ${t.name}? Its tasks keep their projects.`) && actions.remove(t)}>
            <Trash2 size={14} /> Delete team
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- a new team ---------- */

export function NewTeamDialog({ users, me, count, onCreate, onClose }: { users: User[]; me: string; count: number; onCreate: (t: Omit<Team, 'id' | 'workspaceId'>) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [leadId, setLeadId] = useState(me);
  const [members, setMembers] = useState<string[]>([me]);
  const [join, setJoin] = useState<'open' | 'lead'>('lead');
  const create = () => name.trim() && (onCreate({ name: name.trim(), about: about.trim() || undefined, color: TEAM_COLORS[count % TEAM_COLORS.length], leadId: leadId || undefined, members: [...new Set([...members, ...(leadId ? [leadId] : [])])], join, keywords: [] }), onClose());
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="New team" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span>New team</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
            <div className="team-new">
              <input className="title-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Team name, e.g. Video" />
              <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What it does (optional)" />
              <div className="team-field">
                <span>Lead</span>
                <PersonSelect value={leadId} users={users} me={me} label="Lead" extra={[{ value: '', label: 'No lead yet', icon: <X size={14} /> }]} onChange={setLeadId} />
              </div>
              <div className="team-field">
                <span>People</span>
                <PeoplePicker value={members} users={users} me={me} label="People in the team" emptyText="Add people" onChange={setMembers} />
              </div>
              <div className="team-field">
                <span>Joining</span>
                <div className="segmented sm">
                  <button type="button" className={join === 'open' ? 'on' : ''} onClick={() => setJoin('open')}>
                    Anyone can join
                  </button>
                  <button type="button" className={join === 'lead' ? 'on' : ''} onClick={() => setJoin('lead')}>
                    The lead adds people
                  </button>
                </div>
              </div>
            </div>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <button className="ghost-btn sm" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn sm" disabled={!name.trim()} onClick={create}>
            Create team
          </button>
        </footer>
      </div>
    </div>
  );
}
