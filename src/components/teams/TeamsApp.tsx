import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Crown, LogOut, Mail, Menu, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useActionMenu } from '../ui/ActionSheet';
import { usePhone } from '../../mobile/media';
import type { Client, HomeTemplateId, Team, Todo, User } from '../../types';
import { localDay, relative } from '../../utils';
import { kindOf, projectStages, stageBadge, stageOf, stagesFor } from '../../stages';
import { OwnStages, type Move } from '../admin/TaskStages';
import { Avatar } from '../Avatar';
import { Badge, PersonCell } from '../ui/Person';
import { EmptyState } from '../ui/EmptyState';
import { HOME_TEMPLATES } from '../HomeView';
import { PeoplePicker, PersonSelect } from '../ui/PeoplePicker';
import { PeopleList } from '../ui/PeopleList';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { useCreateAction, useFocusedScreen, useTitleMenu } from '../../mobile/chrome';
import { toastUndo } from '../../toast';
import { term } from '../../terms';
import { t, tn, tx } from '../../i18n';
import { fmtDay } from '../../i18n/format';

export const TEAM_COLORS = ['#0ea5e9', '#10b981', '#f97316', '#8b5cf6', '#d946ef', '#ef4444', '#f59e0b', '#64748b'];

/** Who can change a team: admins, and the team's lead. */
export const canManageTeam = (tm: Team, me: string, isAdmin: boolean) => isAdmin || tm.leadId === me;

const isOpen = (tm: Todo) => !tm.done;
const doers = (tm: Todo) => (tm.assignees?.length ? tm.assignees : tm.userId ? [tm.userId] : []);
const today = () => localDay();
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const shortDate = (day: string) => fmtDay(day);

export interface TeamActions {
  patch: (id: string, p: Partial<Team>) => void;
  patchTask?: (id: string, p: Partial<Todo>) => void; // tasks moved when the team's own stages change
  join: (tm: Team) => void; // joins an open team, or asks the lead
  direct: (tm: Team) => boolean; // this person can join without asking (an open team, or they're an admin)
  leave: (tm: Team) => void;
  remove: (tm: Team) => void;
}

/* ---------- the sidebar: your teams, then the rest ---------- */

export function TeamsSidebar({ teams, me, current, canCreate, onOpen, onNew }: { teams: Team[]; me: string; current: string | null; canCreate: boolean; onOpen: (id: string | null) => void; onNew: () => void }) {
  const mine = teams.filter((tm) => tm.members.includes(me));
  const others = teams.filter((tm) => !tm.members.includes(me));
  const item = (tm: Team) => (
    <button key={tm.id} className={`nav-item ${current === tm.id ? 'active' : ''}`} onClick={() => onOpen(tm.id)} title={tm.name}>
      <span className="team-square" style={{ background: tm.color }} />
      <span className="sb-label">{tm.name}</span>
      {(tm.requests?.length ?? 0) > 0 && tm.leadId === me && <span className="count">{tm.requests!.length}</span>}
    </button>
  );
  return (
    <>
      {canCreate && (
        <button className="compose-btn" onClick={onNew} title={t('New team')}>
          <Plus size={16} />
          <span className="sb-label">{t('New team')}</span>
        </button>
      )}
      <nav className="nav">
        <button className={`nav-item ${current === null ? 'active' : ''}`} onClick={() => onOpen(null)}>
          <Users size={16} />
          <span className="sb-label">{t('All teams')}</span>
        </button>
      </nav>
      {mine.length > 0 && (
        <>
          <div className="nav-heading sb-label">{t('Your teams')}</div>
          <nav className="nav">{mine.map(item)}</nav>
        </>
      )}
      {others.length > 0 && (
        <>
          <div className="nav-heading sb-label">{t('Other teams')}</div>
          <nav className="nav">{others.map(item)}</nav>
        </>
      )}
    </>
  );
}

/** Join, ask to join, or a note that you're in it. */
function JoinButton({ tm, me, actions, small }: { tm: Team; me: string; actions: TeamActions; small?: boolean }) {
  const cls = small ? 'ghost-btn sm' : 'primary-btn sm';
  if (tm.members.includes(me))
    return (
      <span className="team-in small">
        <Check size={13} /> {t('You’re in it')}
      </span>
    );
  if (tm.requests?.some((r) => r.userId === me))
    return (
      <button type="button" className="ghost-btn sm" onClick={(e) => (e.stopPropagation(), actions.patch(tm.id, { requests: tm.requests!.filter((r) => r.userId !== me) }))} title={t('Take back your request')}>
        {t('Asked to join · Undo')}
      </button>
    );
  return (
    <button type="button" className={cls} onClick={(e) => (e.stopPropagation(), actions.join(tm))}>
      <UserPlus size={14} /> {actions.direct(tm) ? t('Join') : t('Ask to join')}
    </button>
  );
}

/** What needs attention on a team, in a few words (or that it's fine). */
function teamState(tm: Team, tasks: Todo[]) {
  const open = tasks.filter((x) => x.teamId === tm.id && isOpen(x));
  const late = open.filter((x) => x.due && x.due < today()).length;
  const waiting = open.filter((x) => !doers(x).length).length;
  const review = open.filter((x) => kindOf(x) === 'review').length;
  const issues = [late && tn(late, '{n} late', '{n} late'), waiting && tn(waiting, '{n} not picked up', '{n} not picked up'), review && tn(review, '{n} to review', '{n} to review')].filter(Boolean) as string[];
  return { open: open.length, late, issues };
}

/* ---------- all teams ---------- */

export function TeamsHome({ teams, users, tasks, me, canCreate, actions, onOpen, onNew, onMenu }: { teams: Team[]; users: User[]; tasks: Todo[]; me: string; canCreate: boolean; actions: TeamActions; onOpen: (id: string) => void; onNew: () => void; onMenu: () => void }) {
  const sorted = [...teams].sort((a, b) => Number(b.members.includes(me)) - Number(a.members.includes(me)) || a.name.localeCompare(b.name));
  useCreateAction('teams', canCreate && { label: t('New team'), icon: Plus, run: onNew });
  const phone = usePhone();
  if (phone && teams.length)
    return (
      <section className="tasks-pane view-enter tdir-pane">
        <div className="tracking-scroll">
          <TeamsPhone teams={teams} users={users} tasks={tasks} me={me} actions={actions} onOpen={onOpen} />
        </div>
      </section>
    );
  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('Open menu')}>
          <Menu size={18} />
        </button>
        <div className="th-text">
          <h1>{t('Teams')}</h1>
          <p>{t('Departments like Video, Design or Finance. Tasks belong to a project and a team, so leads see their team’s work and who has too much.')}</p>
        </div>
        {canCreate && (
          <button className="primary-btn sm" onClick={onNew}>
            <Plus size={14} /> {t('New team')}
          </button>
        )}
      </header>
      <div className="tracking-scroll">
        {!teams.length ? (
          <EmptyState
            icon={<Users size={20} />}
            title={t('No teams yet')}
            text={t('Make one per department. People can be in more than one team.')}
            action={
              canCreate && (
                <button className="primary-btn sm" onClick={onNew}>
                  <Plus size={14} /> {t('New team')}
                </button>
              )
            }
          />
        ) : (
          <div className="proj-grid">
            {sorted.map((tm, i) => {
              const lead = users.find((u) => u.id === tm.leadId);
              const s = teamState(tm, tasks);
              return (
                <div key={tm.id} className="proj-card team-card-x" role="button" tabIndex={0} style={{ ['--i' as string]: i }} onClick={() => onOpen(tm.id)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(tm.id)}>
                  <span className="proj-top">
                    <span className="team-square big" style={{ background: tm.color }} />
                    <span className="proj-name">
                      <strong>{tm.name}</strong>
                      <small>{tm.about || (lead ? t('Led by {name}', { name: lead.name }) : t('No lead yet'))}</small>
                    </span>
                  </span>
                  <span className="team-people">
                    <span className="av-stack">
                      {tm.members.slice(0, 6).map((id) => {
                        const u = users.find((x) => x.id === id);
                        return u ? <Avatar key={id} person={u} size={22} /> : null;
                      })}
                    </span>
                    <small className="muted">{tm.members.length ? tn(tm.members.length, '{n} person', '{n} people') : t('Nobody yet')}</small>
                  </span>
                  <span className={`proj-state ${s.issues.length ? (s.late ? 'bad' : 'warn') : 'ok'}`}>
                    {s.issues.length ? (
                      s.issues.join(' · ')
                    ) : (
                      <>
                        <Check size={13} /> {s.open ? t('On track') : t('Nothing open')}
                      </>
                    )}
                  </span>
                  <span className="proj-foot">
                    <JoinButton tm={tm} me={me} actions={actions} small />
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

/**
 * Teams on a phone: Slack's people directory. Search on top, then Your teams and Other teams as plain rows (a status
 * word only when something needs a look), and the people who match while searching.
 */
function TeamsPhone({ teams, users, tasks, me, actions, onOpen }: { teams: Team[]; users: User[]; tasks: Todo[]; me: string; actions: TeamActions; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const hit = (s?: string) => !!s && s.toLowerCase().includes(query);
  const shown = teams.filter((tm) => !query || hit(tm.name) || hit(tm.about)).sort((a, b) => a.name.localeCompare(b.name));
  const mine = shown.filter((tm) => tm.members.includes(me));
  const others = shown.filter((tm) => !tm.members.includes(me));
  const people = query ? users.filter((u) => hit(u.name) || hit(u.title) || hit(u.email)).slice(0, 20) : [];
  const row = (tm: Team, other: boolean) => {
    const lead = users.find((u) => u.id === tm.leadId);
    const s = teamState(tm, tasks);
    return (
      <div key={tm.id} className="tdir-row" role="button" tabIndex={0} onClick={() => onOpen(tm.id)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(tm.id)}>
        <span className="tdir-tile" style={{ background: tm.color }} aria-hidden>
          {tm.name.charAt(0).toUpperCase()}
        </span>
        <span className="tdir-text">
          <strong>{tm.name}</strong>
          <small>{[lead ? t('Led by {name}', { name: lead.name.split(' ')[0] }) : t('No lead yet'), tm.members.length ? tn(tm.members.length, '{n} person', '{n} people') : t('Nobody yet')].join(' · ')}</small>
        </span>
        {s.issues.length > 0 && <span className={`tdir-state ${s.late ? 'bad' : 'warn'}`}>{s.issues[0]}</span>}
        {other && <JoinButton tm={tm} me={me} actions={actions} small />}
      </div>
    );
  };
  const section = (title: string, list: Team[], other: boolean) =>
    list.length > 0 && (
      <section className="tdir-sec">
        <h2 className="tdir-head">{title}</h2>
        <div className="tdir-list">{list.map((tm) => row(tm, other))}</div>
      </section>
    );
  return (
    <div className="tdir">
      <label className="tdir-search">
        <Search size={17} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search teams and people')} aria-label={t('Search teams and people')} enterKeyHint="search" />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label={t('Clear the search')}>
            <X size={15} />
          </button>
        )}
      </label>
      {section(t('Your teams'), mine, false)}
      {section(t('Other teams'), others, true)}
      {people.length > 0 && (
        <section className="tdir-sec">
          <h2 className="tdir-head">{t('People')}</h2>
          <div className="tdir-list">
            {people.map((u) => {
              const theirs = teams.filter((tm) => tm.members.includes(u.id));
              return (
                <div key={u.id} className="tdir-row" role={theirs[0] ? 'button' : undefined} onClick={theirs[0] ? () => onOpen(theirs[0].id) : undefined}>
                  <Avatar person={u} size={36} />
                  <span className="tdir-text">
                    <strong>{u.name}</strong>
                    <small>{[u.title, theirs.map((x) => x.name).join(', ')].filter(Boolean).join(' · ') || u.email}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {query && !shown.length && !people.length && <p className="tdir-none">{t('Nothing matches “{q}”.', { q: q.trim() })}</p>}
    </div>
  );
}

/** A member on a phone: a 56 px row; tap for their profile and, for whoever runs the team, Make lead and Remove. */
function MemberRow({ u, tm, teams, me, manage, actions }: { u: User; tm: Team; teams: Team[]; me: string; manage: boolean; actions: TeamActions }) {
  const also = teams.filter((x) => x.id !== tm.id && x.members.includes(u.id));
  const remove = () => {
    const before = { members: tm.members, leadId: tm.leadId };
    actions.patch(tm.id, { members: tm.members.filter((x) => x !== u.id), leadId: tm.leadId === u.id ? undefined : tm.leadId });
    toastUndo(t('Removed {name} from {team}', { name: u.name.split(' ')[0], team: tm.name }), () => actions.patch(tm.id, before));
  };
  const menu = useActionMenu(
    () => [
      ...(u.email ? [{ label: t('Email {name}', { name: u.name.split(' ')[0] }), icon: Mail, run: () => void (location.href = `mailto:${u.email}`) }] : []),
      ...(manage && tm.leadId !== u.id ? [{ label: t('Make lead'), icon: Crown, run: () => actions.patch(tm.id, { leadId: u.id }) }] : []),
      ...(u.id === me && !manage ? [{ label: t('Leave'), icon: LogOut, danger: true, group: 'end', run: () => actions.leave(tm) }] : []),
      ...(manage ? [{ label: t('Remove from team'), icon: X, danger: true, group: 'end', run: remove }] : []),
    ],
    {
      header: (
        <div className="tdir-profile">
          <Avatar person={u} size={56} />
          <strong>{u.name}</strong>
          <small>{[u.title, u.email].filter(Boolean).join(' · ')}</small>
          {also.length > 0 && <small>{t('Also in {teams}', { teams: also.map((x) => x.name).join(', ') })}</small>}
        </div>
      ),
    },
  );
  return (
    <>
      <div className="tdir-row tdir-member lp" role="button" tabIndex={0} {...menu.bind} onClick={(e) => menu.openAt(e.clientX, e.clientY)} onKeyDown={(e) => e.key === 'Enter' && menu.openAt(0, 0)}>
        <Avatar person={u} size={36} />
        <span className="tdir-text">
          <strong>
            {u.name}
            {u.id === me && <Badge tone="accent">{t('You')}</Badge>}
            {tm.leadId === u.id && <Badge>{t('Lead')}</Badge>}
          </strong>
          <small>{u.title || u.email}</small>
        </span>
      </div>
      {menu.menu}
    </>
  );
}

/* ---------- one team ---------- */

type TeamTab = 'members' | 'work' | 'workload' | 'settings';

export function TeamPage({
  team: tm,
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
  onOpen,
  companyName,
  wordsKey,
  onMoveTasks,
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
  onOpen?: (id: string) => void; // another team, from the phone's title switcher
  /** The company's name and word for the work (a team's own task stages start from the company's). */
  companyName?: string;
  wordsKey?: string;
  onMoveTasks?: (moves: Move[]) => void;
}) {
  const manage = canManageTeam(tm, me, isAdmin);
  // Phones: the team takes the screen with Back to all teams, and its name is the title (a switcher to the others).
  useFocusedScreen(true, onBack);
  useTitleMenu('teams', !!onOpen && { label: t('Teams'), value: tm.id, options: teams.map((x) => ({ value: x.id, label: x.name, icon: <span className="team-square" style={{ background: x.color }} /> })), onChange: onOpen });
  const [tab, setTab] = useState<TeamTab>('members');
  const tabs: { id: TeamTab; label: string }[] = [
    { id: 'members', label: t('People') },
    { id: 'work', label: tx('team', 'Work') },
    { id: 'workload', label: t('Workload') },
    ...(manage ? [{ id: 'settings' as const, label: t('Settings') }] : []),
  ];
  const lead = users.find((u) => u.id === tm.leadId);
  return (
    <section className="tasks-pane view-enter team-page">
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={onBack} aria-label={t('All teams')}>
          <ArrowLeft size={18} />
        </button>
        <span className="team-square big" style={{ background: tm.color }} />
        <div className="th-text">
          <h1>{tm.name}</h1>
          <p>{tm.about || (lead ? t('Led by {name}', { name: lead.name }) : t('No lead yet'))}</p>
        </div>
        <JoinButton tm={tm} me={me} actions={actions} />
      </header>
      <div className="client-tabs team-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
            {x.label}
            {x.id === 'members' && manage && (tm.requests?.length ?? 0) > 0 && <span className="tab-count">{tm.requests!.length}</span>}
          </button>
        ))}
      </div>
      <div className="tracking-scroll">
        <TabPane key={tab}>
          {tab === 'members' && <MembersTab tm={tm} teams={teams} users={users} me={me} manage={manage} actions={actions} />}
          {tab === 'work' && <WorkTab tm={tm} tasks={tasks} users={users} clients={clients} onOpenTask={onOpenTask} />}
          {tab === 'workload' && <WorkloadTab tm={tm} tasks={tasks} users={users} onOpenTask={onOpenTask} />}
          {tab === 'settings' && manage && <SettingsTab tm={tm} users={users} isAdmin={isAdmin} actions={actions} homeTemplate={homeTemplate} onHomeTemplate={onHomeTemplate} tasks={tasks} teams={teams} me={me} companyName={companyName ?? t('the company')} wordsKey={wordsKey ?? ''} onMoveTasks={onMoveTasks ?? ((moves) => moves.forEach((m) => actions.patchTask?.(m.id, m.patch)))} />}
        </TabPane>
      </div>
    </section>
  );
}

function MembersTab({ tm, teams, users, me, manage, actions }: { tm: Team; teams: Team[]; users: User[]; me: string; manage: boolean; actions: TeamActions }) {
  const phone = usePhone();
  const people = tm.members.map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[];
  const requests = (tm.requests ?? []).map((r) => ({ r, u: users.find((u) => u.id === r.userId) })).filter((x) => x.u) as { r: { userId: string; at: string }; u: User }[];
  const approve = (id: string) => actions.patch(tm.id, { members: [...new Set([...tm.members, id])], requests: (tm.requests ?? []).filter((r) => r.userId !== id) });
  const decline = (id: string) => actions.patch(tm.id, { requests: (tm.requests ?? []).filter((r) => r.userId !== id) });
  return (
    <div className="team-sec">
      {manage && requests.length > 0 && (
        <div className="team-block">
          <h3>{t('Asked to join')}</h3>
          {requests.map(({ r, u }) => (
            <div key={u.id} className="team-row">
              <PersonCell person={u} sub={[u.title, t('asked {when}', { when: relative(r.at) })].filter(Boolean).join(' · ')} />
              <button className="ghost-btn sm" onClick={() => decline(u.id)}>
                {t('Decline')}
              </button>
              <button className="primary-btn sm" onClick={() => approve(u.id)}>
                {t('Add to team')}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="team-block">
        <div className="team-block-head">
          <h3>{t('People')}</h3>
          {manage && <AddPeople tm={tm} users={users} me={me} onChange={(members) => actions.patch(tm.id, { members, leadId: tm.leadId && !members.includes(tm.leadId) ? undefined : tm.leadId })} />}
        </div>
        {!people.length && <p className="muted small">{manage ? t('Nobody in this team yet. Add people above.') : tm.join === 'open' ? t('Nobody in this team yet. Join it from the top.') : t('Nobody in this team yet.')}</p>}
        {people.map((u) => {
          if (phone) return <MemberRow key={u.id} u={u} tm={tm} teams={teams} me={me} manage={manage} actions={actions} />;
          const also = teams.filter((x) => x.id !== tm.id && x.members.includes(u.id));
          return (
            <div key={u.id} className="team-row">
              <PersonCell
                person={u}
                badges={
                  <>
                    {u.id === me && <Badge tone="accent">{t('You')}</Badge>}
                    {tm.leadId === u.id && <Badge>{t('Lead')}</Badge>}
                  </>
                }
                sub={[u.title, also.length ? t('Also in {teams}', { teams: also.map((x) => x.name).join(', ') }) : ''].filter(Boolean).join(' · ') || u.email}
              />
              {manage && tm.leadId !== u.id && (
                <button className="link-btn small" onClick={() => actions.patch(tm.id, { leadId: u.id })}>
                  {t('Make lead')}
                </button>
              )}
              {u.id === me && !manage ? (
                <button className="ghost-btn sm" onClick={() => actions.leave(tm)}>
                  <LogOut size={13} /> {t('Leave')}
                </button>
              ) : (
                manage && (
                  <button
                    className="icon-btn sm"
                    aria-label={t('Remove {name} from the team', { name: u.name })}
                    title={t('Remove from team')}
                    onClick={() => {
                      const before = { members: tm.members, leadId: tm.leadId };
                      actions.patch(tm.id, { members: tm.members.filter((x) => x !== u.id), leadId: tm.leadId === u.id ? undefined : tm.leadId });
                      toastUndo(t('Removed {name} from {team}', { name: u.name.split(' ')[0], team: tm.name }), () => actions.patch(tm.id, before));
                    }}
                  >
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
function AddPeople({ tm, users, me, onChange }: { tm: Team; users: User[]; me: string; onChange: (members: string[]) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={btn} type="button" className="ghost-btn sm" onClick={() => setOpen((o) => !o)}>
        <UserPlus size={14} /> {t('Add people')}
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={300} align="end" title={t('People in {team}', { team: tm.name })}>
        <PeopleList users={users} me={me} selected={tm.members} onPick={(id) => onChange(tm.members.includes(id) ? tm.members.filter((x) => x !== id) : [...tm.members, id])} />
      </Popover>
    </>
  );
}

/** The team's open work, by when it's due. */
function WorkTab({ tm, tasks, users, clients, onOpenTask }: { tm: Team; tasks: Todo[]; users: User[]; clients: Client[]; onOpenTask: (id: string) => void }) {
  const [who, setWho] = useState<string>('');
  const open = tasks.filter((x) => x.teamId === tm.id && isOpen(x) && (!who || (who === '-' ? !doers(x).length : doers(x).includes(who))));
  const groups: { id: string; label: string; list: Todo[]; bad?: boolean }[] = [
    { id: 'late', label: t('Late'), list: open.filter((x) => x.due && x.due < today()), bad: true },
    { id: 'week', label: t('This week'), list: open.filter((x) => x.due && x.due >= today() && x.due <= inDays(7)) },
    { id: 'later', label: t('Later'), list: open.filter((x) => x.due && x.due > inDays(7)) },
    { id: 'none', label: t('No date'), list: open.filter((x) => !x.due) },
  ].filter((g) => g.list.length);
  const doneWeek = tasks.filter((x) => x.teamId === tm.id && x.doneAt && x.doneAt.slice(0, 10) >= inDays(-7)).length;
  return (
    <div className="team-sec">
      <div className="team-filter">
        <PersonSelect
          value={who}
          users={users.filter((u) => tm.members.includes(u.id))}
          label={t('Whose work')}
          extra={[
            { value: '', label: t('Everyone in the team'), icon: <Users size={15} /> },
            { value: '-', label: t('Not picked up yet'), icon: <UserPlus size={15} /> },
          ]}
          onChange={setWho}
        />
        {doneWeek > 0 && <span className="muted small">{tn(doneWeek, '{n} done this week', '{n} done this week')}</span>}
      </div>
      {!groups.length && <p className="muted small team-empty">{who ? t('Nothing open here.') : t('Nothing open for {team}. Tasks with this team show up here.', { team: tm.name })}</p>}
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
                    <small className="muted">{[client?.name, kindOf(x) === 'review' || kindOf(x) === 'waiting' ? stageBadge(stageOf(x)) : ''].filter(Boolean).join(' · ') || ' '}</small>
                  </span>
                  {x.due && <span className={`team-due small ${x.due < today() ? 'bad' : ''}`}>{shortDate(x.due)}</span>}
                  <span className="av-stack">{people.length ? people.slice(0, 3).map((u) => <Avatar key={u.id} person={u} size={22} />) : <span className="team-nobody small">{t('Nobody')}</span>}</span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/** Who has how much: everyone's open work (all of it, not only this team's), late first. */
function WorkloadTab({ tm, tasks, users, onOpenTask }: { tm: Team; tasks: Todo[]; users: User[]; onOpenTask: (id: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      tm.members
        .map((id) => users.find((u) => u.id === id))
        .filter(Boolean)
        .map((u) => {
          const mine = tasks.filter((x) => isOpen(x) && doers(x).includes(u!.id));
          return { u: u!, mine, late: mine.filter((x) => x.due && x.due < today()).length, week: mine.filter((x) => x.due && x.due >= today() && x.due <= inDays(7)).length, here: mine.filter((x) => x.teamId === tm.id).length };
        })
        .sort((a, b) => b.late - a.late || b.mine.length - a.mine.length),
    [tm, tasks, users],
  );
  const most = Math.max(1, ...rows.map((r) => r.mine.length));
  if (!rows.length) return <p className="muted small team-empty">{t('Add people to the team to see who has how much.')}</p>;
  return (
    <div className="team-sec">
      <p className="muted small">{t('Everything each person has open, from every team and project. Late work first; open someone to see their list.')}</p>
      <div className="team-block">
        {rows.map(({ u, mine, late, week, here }) => (
          <div key={u.id} className="team-load">
            <button type="button" className="team-row" onClick={() => setOpenId(openId === u.id ? null : u.id)} aria-expanded={openId === u.id}>
              <PersonCell person={u} sub={[late && tn(late, '{n} late', '{n} late'), week && tn(week, '{n} due this week', '{n} due this week'), tn(here, '{n} in {team}', '{n} in {team}', { team: tm.name })].filter(Boolean).join(' · ')} />
              <span className="team-bar" aria-label={tn(mine.length, '{n} open', '{n} open')}>
                <i style={{ width: `${(mine.length / most) * 100}%` }} className={late ? 'bad' : mine.length > 8 ? 'warn' : ''} />
              </span>
              <span className="team-count">{mine.length}</span>
              <ChevronRight size={14} className={`rot-chev ${openId === u.id ? 'open' : ''}`} />
            </button>
            <div className={`fold ${openId === u.id ? 'open' : ''}`}>
              <div className="fold-in">
                <div className="team-load-list">
                  {mine.length === 0 && <p className="muted small">{t('Nothing open.')}</p>}
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

function SettingsTab({ tm, users, isAdmin, actions, homeTemplate, onHomeTemplate, tasks, teams, me, companyName, wordsKey, onMoveTasks }: { tm: Team; users: User[]; isAdmin: boolean; actions: TeamActions; homeTemplate?: HomeTemplateId; onHomeTemplate: (v: HomeTemplateId) => void; tasks: Todo[]; teams: Team[]; me: string; companyName: string; wordsKey: string; onMoveTasks: (moves: Move[]) => void }) {
  const patch = (p: Partial<Team>) => actions.patch(tm.id, p);
  return (
    <div className="team-sec team-settings">
      <label className="team-field">
        <span>{t('Name')}</span>
        <input value={tm.name} onChange={(e) => patch({ name: e.target.value })} />
      </label>
      <label className="team-field">
        <span>{t('What it does')}</span>
        <input value={tm.about ?? ''} placeholder={t('Edits every video and reel')} onChange={(e) => patch({ about: e.target.value })} />
      </label>
      <div className="team-field">
        <span>{t('Colour')}</span>
        <div className="tb-colors">
          {TEAM_COLORS.map((c) => (
            <button key={c} type="button" className={`tb-dot big${tm.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => patch({ color: c })} aria-label={c} />
          ))}
        </div>
      </div>
      <div className="team-field">
        <span>{t('Lead')}</span>
        <PersonSelect value={tm.leadId ?? ''} users={users} label={t('Lead')} extra={[{ value: '', label: t('No lead'), icon: <X size={14} /> }]} onChange={(id) => patch({ leadId: id || undefined, members: id && !tm.members.includes(id) ? [...tm.members, id] : tm.members })} />
      </div>
      <div className="team-field">
        <span>{tx('team', 'Joining')}</span>
        <div className="segmented sm">
          <button type="button" className={tm.join === 'open' ? 'on' : ''} onClick={() => patch({ join: 'open' })}>
            {t('Anyone can join')}
          </button>
          <button type="button" className={tm.join !== 'open' ? 'on' : ''} onClick={() => patch({ join: 'lead' })}>
            {t('The lead adds people')}
          </button>
        </div>
      </div>
      <p className="muted small team-hint">{tm.join === 'open' ? t('Anyone in the company can join from the team page.') : t('Others can ask to join; the lead gets a notification to approve.')}</p>
      <div className="team-field">
        <span>{t('Review')}</span>
        <label className="check-row small">
          <input type="checkbox" checked={!!tm.review} onChange={(e) => patch({ review: e.target.checked })} /> {t('Finished tasks wait for the lead before they count as done')}
        </label>
      </div>
      <div className="team-field team-stages">
        <span>{t('Task stages')}</span>
        <OwnStages
          what="team"
          name={tm.name}
          own={tm.taskStages}
          inherited={stagesFor(tm.workspaceId)}
          inheritedFrom={companyName}
          canManage
          tasks={tasks.filter((x) => x.teamId === tm.id && !projectStages(x.clientId))}
          teams={teams}
          me={me}
          wordsKey={wordsKey}
          onStages={(taskStages) => patch({ taskStages })}
          onMoveTasks={onMoveTasks}
        />
      </div>
      <label className="team-field">
        <span>{t('Keywords')}</span>
        <input value={(tm.keywords ?? []).join(', ')} onChange={(e) => patch({ keywords: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} placeholder={t('video, reel, edit (the brain dump uses these)')} />
      </label>
      <div className="team-field">
        <span>{t('Home')}</span>
        <Select<HomeTemplateId> value={homeTemplate ?? null} onChange={onHomeTemplate} placeholder={t('Guess from role')} label={t('Default Home')} options={(Object.keys(HOME_TEMPLATES) as HomeTemplateId[]).map((k) => ({ value: k, label: t(HOME_TEMPLATES[k].name), hint: t(HOME_TEMPLATES[k].hint) }))} />
      </div>
      {isAdmin && (
        <div className="team-danger">
          <button className="ghost-btn sm danger" onClick={() => confirm(t('Delete {team}? Its tasks keep their {projects}.', { team: tm.name, projects: term.many })) && actions.remove(tm)}>
            <Trash2 size={14} /> {t('Delete team')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- a new team ---------- */

export function NewTeamDialog({ users, me, count, onCreate, onClose }: { users: User[]; me: string; count: number; onCreate: (tm: Omit<Team, 'id' | 'workspaceId'>) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [leadId, setLeadId] = useState(me);
  const [members, setMembers] = useState<string[]>([me]);
  const [join, setJoin] = useState<'open' | 'lead'>('lead');
  const create = () => name.trim() && (onCreate({ name: name.trim(), about: about.trim() || undefined, color: TEAM_COLORS[count % TEAM_COLORS.length], leadId: leadId || undefined, members: [...new Set([...members, ...(leadId ? [leadId] : [])])], join, keywords: [] }), onClose());
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={t('New team')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span>{t('New team')}</span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
            <div className="team-new">
              <input className="title-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder={t('Team name, e.g. Video')} />
              <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder={t('What it does (optional)')} />
              <div className="team-field">
                <span>{t('Lead')}</span>
                <PersonSelect value={leadId} users={users} me={me} label={t('Lead')} extra={[{ value: '', label: t('No lead yet'), icon: <X size={14} /> }]} onChange={setLeadId} />
              </div>
              <div className="team-field">
                <span>{t('People')}</span>
                <PeoplePicker value={members} users={users} me={me} label={t('People in the team')} emptyText={t('Add people')} onChange={setMembers} />
              </div>
              <div className="team-field">
                <span>{tx('team', 'Joining')}</span>
                <div className="segmented sm">
                  <button type="button" className={join === 'open' ? 'on' : ''} onClick={() => setJoin('open')}>
                    {t('Anyone can join')}
                  </button>
                  <button type="button" className={join === 'lead' ? 'on' : ''} onClick={() => setJoin('lead')}>
                    {t('The lead adds people')}
                  </button>
                </div>
              </div>
            </div>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <button className="ghost-btn sm" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn sm" disabled={!name.trim()} onClick={create}>
            {t('Create team')}
          </button>
        </footer>
      </div>
    </div>
  );
}
