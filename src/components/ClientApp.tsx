import { useEffect, useMemo, useRef, useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { setTermWord, term } from '../terms';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Folder,
  Handshake,
  HardDrive,
  House,
  Inbox,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Sun,
  UserRound,
  Menu as MenuIcon,
  MessagesSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Sparkles,
  Upload,
  UserPlus,
  Table2,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Channel, ChatMessage, Client, ClientAccess, ClientPerson, DataTable, DriveItem, Meeting, Notice, Todo, User, Workspace } from '../types';
import type { ClientActions } from '../clientActions';
import { can, companyOf, guestRow, guestTable, requestStatus, teamLabel } from '../clientView';
import { useStored } from '../store';
import { server } from '../sync';
import { TableScreen } from './tables/TablesApp';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { PhotoPicker } from './PhotoPicker';
import { PasswordRow } from './SettingsPage';
import { createPortal } from 'react-dom';
import { ACCENTS, usePersisted, type ThemePref } from '../settings';
import { SIDEBAR_MAX, SIDEBAR_MIN } from './Sidebar';
import { WorkspaceLogo, applyBranding } from './WorkspaceLogo';
import { Logo } from './Logo';
import { MobileTop } from './MobileTop';
import { Notifications } from './Notifications';
import { ChatView } from './ChatApp';
import { ChannelMaterials } from './ChannelMaterials';
import { Assistant, type AskChat } from './Assistant';
import { DatePicker } from './ui/DatePicker';
import { Popover } from './ui/Popover';
import { dueLabel, isBrief, statusOf } from './TasksView';
import { useOnePanel } from '../onePanel';

type Mode = 'home' | 'requests' | 'chat' | 'work' | 'files' | 'meet' | 'tables';

interface Props {
  ws: Workspace;
  client: Client;
  person: ClientPerson;
  access: ClientAccess;
  team: User[];
  actions: ClientActions;
  messages: ChatMessage[];
  allTasks: Todo[]; // for brief progress (counts only)
  notices: Notice[];
  onReadNotices: () => void;
  /** "View as client": a pill to switch person or leave. */
  preview?: { onExit: () => void; people: ClientPerson[]; onSwitch: (email: string) => void };
  onSignOut?: () => void;
  /** Someone with their own workspace (or several portals): the workspace switcher, in place of the logo. */
  switcher?: React.ReactNode;
  mobileSwitch?: { workspaces: Workspace[]; onWorkspace: (id: string) => void };
  /** Their own account: profile, photo, password and light or dark. Not in "View as guest". */
  account?: { me: User; theme: ThemePref; onTheme: (t: ThemePref) => void; onProfile: (patch: Partial<User>) => void };
}

const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const ROLE: Record<ClientPerson['role'], string> = { viewer: 'Viewer', collaborator: 'Collaborator', approver: 'Approver' };

function useMobile() {
  const [m, setM] = useState(() => matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 760px)');
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

/**
 * The client's portal, built from the same parts as the team app (rail, sidebars, task rows, drawers, chat, Ask AI),
 * showing only what the company shares with them.
 */
export function ClientApp(p: Props) {
  const { ws, client, person, access, actions } = p;
  setTermWord(ws.terms?.word); // the inviting company's words
  const fromWho = companyOf(person.email, person.company, client) ?? client.name; // where this guest works: their uploads folder
  const v = actions.view();
  const mobile = useMobile();
  const [mode, setMode] = useState<Mode>('home');
  const [sub, setSub] = useState<string>(''); // the sidebar choice inside a mode
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [newRequest, setNewRequest] = useState(false);
  const [chanId, setChanId] = useState<string | null>(mobile ? null : (v.channels[0]?.id ?? null));
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // The sidebar can be resized like the team's (remembered on this device).
  const [sbW, setSbW] = usePersisted('s2g-guest-sb', 248);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sbW;
    document.body.classList.add('resizing', 'resizing-x');
    const move = (ev: PointerEvent) => setSbW(Math.min(Math.max(startW + ev.clientX - startX, SIDEBAR_MIN), SIDEBAR_MAX));
    const up = () => {
      document.body.classList.remove('resizing', 'resizing-x');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const [askOpen, setAskOpen] = useState(false);
  const [askChats, setAskChats] = useState<AskChat[]>([]);
  const [toast, setToast] = useState('');
  const meBtn = useRef<HTMLButtonElement>(null);
  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 3500);
  };

  // The company's colour drives the accent, the same way it does in the team app.
  useEffect(() => {
    applyBranding(ws); // the company's icon in the browser tab
    document.documentElement.style.setProperty('--brand', ws.color);
    document.title = `${client.name} · ${ws.name}`;
  }, [ws.color, ws.name, client.name]);

  const teamUser = (id?: string) => p.team.find((u) => u.id === id);
  const nameOf = (by: string) => (by.includes('@') ? (v.people.find((x) => x.email.toLowerCase() === by.toLowerCase())?.name ?? by) : teamLabel(teamUser(by), access, ws.name));
  // Team members as the client sees them (names per the company's setting).
  const shownTeam: User[] = useMemo(() => p.team.map((u) => (access.teamNames === 'hide' ? { ...u, name: `${ws.name} team`, color: ws.color } : { ...u, name: teamLabel(u, access, ws.name) })), [p.team, access, ws.name, ws.color]);
  const avatarOf = (by: string, size = 24) => {
    if (by.includes('@')) return <Avatar person={{ name: nameOf(by), email: by, color: client.color }} size={size} />;
    const u = shownTeam.find((x) => x.id === by);
    return access.teamNames === 'hide' || !u ? <WorkspaceLogo ws={ws} size={size} /> : <Avatar person={u} size={size} />;
  };

  const requests = v.tasks.filter((t) => t.source === 'request').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shared = v.tasks.filter((t) => t.source !== 'request');
  const briefs = shared.filter(isBrief);
  const work = shared.filter((t) => !isBrief(t));
  const approvals = work.filter((t) => t.approval?.status === 'waiting');
  const waitingOnMe = requests.filter((t) => requestStatus(t).cls === 'waiting');
  const unread = p.notices.filter((n) => !n.read).length;
  const task = v.tasks.find((t) => t.id === openTask);

  // Tables the team shared with this project (leads and so on): only shared fields, shaped like the server does.
  const [allTables] = useStored('tables');
  const [allRows, setAllRows] = useStored('rows');
  const sharedTables = useMemo(() => allTables.filter((t) => t.workspaceId === ws.id).map((t) => guestTable(client, t)).filter(Boolean) as DataTable[], [allTables, ws.id, client]);
  const sharedRows = useMemo(() => {
    const byId = new Map(sharedTables.map((t) => [t.id, t]));
    return allRows.filter((r) => byId.has(r.tableId)).map((r) => guestRow(byId.get(r.tableId)!, r));
  }, [allRows, sharedTables]);
  const [tableRow, setTableRow] = useState<string | null>(null);

  const MODES: [Mode, string, LucideIcon, number?][] = [
    ['home', 'Home', House],
    ...(access.requests ? ([['requests', 'Requests', Inbox, waitingOnMe.length]] as [Mode, string, LucideIcon, number][]) : []),
    ['chat', 'Chat', MessagesSquare],
    ['work', 'Work', ListChecks, approvals.length],
    ['files', 'Files', HardDrive],
    ['meet', 'Meetings', Video],
    ...(sharedTables.length ? ([['tables', 'Tables', Table2]] as [Mode, string, LucideIcon][]) : []),
  ];
  const go = (m: Mode, s = '') => {
    setMode(m);
    setSub(s);
    setOpenTask(null);
    if (m === 'chat' && mobile) setChanId(null);
  };
  const title = MODES.find((x) => x[0] === mode)?.[1] ?? '';
  const hasSidebar = mode !== 'home';

  /* ---------------- sidebars ---------------- */
  const navItem = (key: string, label: React.ReactNode, Icon: LucideIcon | null, count?: number, on = sub === key, click = () => setSub(key)) => (
    <button key={key} className={`nav-item ${on ? 'active' : ''}`} onClick={click}>
      {Icon ? <Icon size={17} /> : null}
      <span className="sb-label">{label}</span>
      {count ? <span className="count warn-count">{count}</span> : null}
    </button>
  );
  const sidebar: Partial<Record<Mode, React.ReactNode>> = {
    tables: (
      <nav className="nav">
        {sharedTables.map((t) =>
          navItem(
            t.id,
            <>
              <span className="client-dot sm" style={{ background: t.color }}>
                {t.name.charAt(0).toUpperCase()}
              </span>{' '}
              {t.name}
            </>,
            null,
            undefined,
            (sub || sharedTables[0]?.id) === t.id,
            () => (setSub(t.id), setTableRow(null)),
          ),
        )}
      </nav>
    ),
    requests: (
      <>
        {can(person, 'request') && (
          <button className="compose-btn" onClick={() => setNewRequest(true)}>
            <Plus size={16} />
            <span className="sb-label">New request</span>
          </button>
        )}
        <nav className="nav">
          {navItem('', 'Open', Inbox)}
          {navItem('waiting', 'Waiting on you', Clock, waitingOnMe.length)}
          {navItem('done', 'Done', CheckCircle2)}
          {navItem('all', 'All requests', ListChecks)}
        </nav>
      </>
    ),
    chat: (
      <nav className="nav">
        {v.channels.map((c) => navItem(c.id, c.name, Handshake, undefined, chanId === c.id, () => setChanId(c.id)))}
        {!v.channels.length && <p className="muted small sb-label sb-note">{ws.name} hasn’t added you to a conversation yet.</p>}
      </nav>
    ),
    work: (
      <>
        <nav className="nav">
          {navItem('', 'Everything', ListChecks)}
          {navItem('approve', 'Needs approval', Clock, approvals.length)}
          {navItem('done', 'Done', CheckCircle2)}
        </nav>
        {briefs.length > 0 && (
          <>
            <div className="nav-heading sb-label">Briefs</div>
            <nav className="nav">{briefs.map((b) => navItem(`brief:${b.id}`, b.title, FileText))}</nav>
          </>
        )}
      </>
    ),
    files: (
      <>
        {access.uploads && can(person, 'upload') && <UploadButton actions={actions} say={say} />}
        <nav className="nav">
          {navItem('', 'All files', HardDrive)}
          {navItem('shared', 'Shared with you', FileText)}
          {navItem('mine', `From ${fromWho}`, Upload)}
        </nav>
        {v.channels.length > 0 && (
          <>
            <div className="nav-heading sb-label">Channel materials</div>
            <nav className="nav">{v.channels.map((c) => navItem(`chan:${c.id}`, c.name, Folder))}</nav>
          </>
        )}
      </>
    ),
    meet: (
      <nav className="nav">
        {v.meetings
          .slice()
          .sort((a, b) => b.meeting.at.localeCompare(a.meeting.at))
          .map(({ meeting: m }) => navItem(m.id, m.title, Video, undefined, (sub || v.meetings[0]?.meeting.id) === m.id))}
        {!v.meetings.length && <p className="muted small sb-label sb-note">No meetings yet.</p>}
      </nav>
    ),
  };

  /* ---------------- shared bits ---------------- */
  const stLabel = (t: Todo) => (t.source === 'request' ? requestStatus(t).label : t.done ? 'Done' : statusOf(t) === 'doing' || statusOf(t) === 'review' ? 'In progress' : statusOf(t) === 'waiting' ? 'Waiting on you' : 'Planned');
  const taskRow = (t: Todo) => {
    const d = t.due && !t.done ? dueLabel(t.due) : null;
    const doers = [...new Set((t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []))];
    return (
      <div key={t.id} className={`task ${t.done ? 'done' : ''}`} onClick={() => setOpenTask(t.id)}>
        <span className={`st-dot st-${t.done ? 'done' : statusOf(t)} task-dot`} />
        <div className="task-main">
          <button className="task-title-btn">{t.title}</button>
          <div className="task-meta">
            {t.approval?.status === 'waiting' ? <span className="due waiting">Needs approval</span> : <span className={`due ${statusOf(t) === 'waiting' ? 'waiting' : statusOf(t) === 'doing' ? 'doing' : ''}`}>{stLabel(t)}</span>}
            {d && <span className={`due ${d.cls}`}>{d.text}</span>}
            {t.source === 'request' && <span className="src">from {nameOf(t.requestedBy ?? '').split(' ')[0]}</span>}
          </div>
        </div>
        {doers.length > 0 && <span className="av-stack">{doers.slice(0, 3).map((id) => <span key={id}>{avatarOf(id, 24)}</span>)}</span>}
      </div>
    );
  };
  const empty = (art: React.ReactNode, title: string, subText: string) => (
    <div className="empty">
      <div className="empty-art">{art}</div>
      <p className="empty-title">{title}</p>
      <p className="empty-sub">{subText}</p>
    </div>
  );
  const pane = (heading: string, subtitle: string, body: React.ReactNode, action?: React.ReactNode) => (
    <section className="tasks-pane view-enter" key={`${mode}:${sub}`}>
      <header className="tracking-head tasks-head">
        <div className="th-text">
          <h1>{heading}</h1>
          <p>{subtitle}</p>
        </div>
        {action}
      </header>
      <div className="tracking-scroll">{body}</div>
    </section>
  );

  /* ---------------- pages ---------------- */
  let content: React.ReactNode = null;
  if (mode === 'home') {
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Good morning' : hour < 15 ? 'Good afternoon' : hour < 19 ? 'Good evening' : 'Good evening';
    const card = (id: string, icon: React.ReactNode, name: string, body: React.ReactNode, link?: [string, () => void], wide = false) => (
      <div key={id} className={`side-card home-card ${wide ? 'wide' : ''}`}>
        <h3>
          {icon} {name}
          {link && (
            <button className="link-btn" onClick={link[1]}>
              {link[0]} <ArrowRight size={13} />
            </button>
          )}
        </h3>
        <div className="card-body">{body}</div>
      </div>
    );
    const needs = [...approvals.map((t) => ({ t, text: `Approve “${t.title}”`, go: () => (setMode('work'), setOpenTask(t.id)) })), ...waitingOnMe.map((t) => ({ t, text: `Your request “${t.title}” is waiting on you`, go: () => (setMode('requests'), setOpenTask(t.id)) }))];
    content = (
      <section className="home-pane view-enter">
        <div className="home-scroll">
          <header className="home-head">
            <div className="home-head-text">
              <p className="home-date">{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              <h1>
                {greet}, {person.name.split(' ')[0]}.
              </h1>
            </div>
          </header>
          <div className="home-grid cards">
            {card(
              'needs',
              <Clock size={15} />,
              'Needs you',
              needs.length ? (
                <ul className="home-list">
                  {needs.map((n) => (
                    <li key={n.t.id}>
                      <button className="home-notice" onClick={n.go}>
                        <span>{n.text}</span>
                        <time>{n.t.due ? fmtDay(n.t.due) : ''}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="te-empty">Nothing waiting on you. 🎉</p>
              ),
            )}
            {access.requests &&
              card(
                'requests',
                <Inbox size={15} />,
                'Your requests',
                requests.filter((t) => !t.done).length ? (
                  <ul className="home-list">
                    {requests
                      .filter((t) => !t.done)
                      .slice(0, 5)
                      .map((t) => (
                        <li key={t.id}>
                          <button className="home-notice" onClick={() => (setMode('requests'), setOpenTask(t.id))}>
                            <span>{t.title}</span>
                            <span className={`req-status ${requestStatus(t).cls}`}>{requestStatus(t).label}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="te-empty">Need something? Send a request and the team picks it up.</p>
                ),
                can(person, 'request') ? ['New request', () => (setMode('requests'), setNewRequest(true))] : undefined,
              )}
            {card(
              'work',
              <FileText size={15} />,
              'Work in progress',
              briefs.length ? (
                <ul className="home-list">
                  {briefs.map((b) => {
                    const all = v.tasks.filter((t) => t.briefId === b.id); // shared tasks only
                    const done = all.filter((t) => t.done).length;
                    return (
                      <li key={b.id}>
                        <button className="home-brief" onClick={() => go('work', `brief:${b.id}`)}>
                          <strong>{b.title}</strong>
                          <span className="hb-progress">
                            <span className="bar wide">
                              <span style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
                            </span>
                            {done}/{all.length}
                            {b.due ? ` · due ${fmtDay(b.due)}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="te-empty">The team shares briefs here as work starts.</p>
              ),
              ['Work', () => go('work')],
            )}
            {card(
              'meeting',
              <Video size={15} />,
              'Latest meeting',
              v.meetings.length ? (
                (() => {
                  const { meeting: m, notes } = v.meetings.slice().sort((a, b) => b.meeting.at.localeCompare(a.meeting.at))[0];
                  return (
                    <button className="home-meeting" onClick={() => go('meet', m.id)}>
                      <strong>{m.title}</strong>
                      <small>
                        {fmtDay(m.at)} · {m.minutes} min
                      </small>
                      {notes && <p>{m.summary}</p>}
                    </button>
                  );
                })()
              ) : (
                <p className="te-empty">No meetings yet.</p>
              ),
              v.meetings.length ? ['Meetings', () => go('meet')] : undefined,
            )}
            {card(
              'files',
              <HardDrive size={15} />,
              'Recent files',
              v.files.length ? (
                <ul className="home-list">
                  {v.files
                    .slice()
                    .sort((a, b) => b.modified.localeCompare(a.modified))
                    .slice(0, 4)
                    .map((f) => (
                      <li key={f.id}>
                        <a className="home-notice" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => !f.url && (e.preventDefault(), say('This is a demo file without content.'))}>
                          <span>{f.name}</span>
                          <time>{relative(f.modified)}</time>
                        </a>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="te-empty">Nothing shared yet.</p>
              ),
              ['Files', () => go('files')],
            )}
            {card(
              'news',
              <Bell size={15} />,
              'From the team',
              p.notices.length ? (
                <ul className="home-list">
                  {p.notices.slice(0, 4).map((n) => (
                    <li key={n.id}>
                      <button className="home-notice" onClick={() => n.link?.id && (setMode(n.link.app === 'chat' ? 'chat' : 'requests'), setOpenTask(n.link.id))}>
                        <span>{n.text}</span>
                        <time>{relative(n.at)}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="te-empty">You’re all caught up.</p>
              ),
            )}
          </div>
          {!access.hideBranding && (
            <p className="client-made">
              Made with <Logo size={12} /> Sprint2go
            </p>
          )}
        </div>
      </section>
    );
  }

  if (mode === 'requests') {
    const list = requests.filter((t) => (sub === 'done' ? t.done : sub === 'waiting' ? requestStatus(t).cls === 'waiting' : sub === 'all' ? true : !t.done));
    content = pane(
      sub === 'done' ? 'Done' : sub === 'waiting' ? 'Waiting on you' : sub === 'all' ? 'All requests' : 'Requests',
      waitingOnMe.length ? `${waitingOnMe.length} waiting on you` : 'The team picks these up like tickets',
      list.length ? <div className="todo-group">{list.map(taskRow)}</div> : empty(<Inbox size={22} />, 'No requests here', can(person, 'request') ? 'Send one with “New request”.' : 'Your colleagues’ requests show up here.'),
      can(person, 'request') && mobile ? (
        <button className="primary-btn sm" onClick={() => setNewRequest(true)}>
          <Plus size={14} /> New
        </button>
      ) : undefined,
    );
  }

  if (mode === 'work') {
    const brief = sub.startsWith('brief:') ? briefs.find((b) => `brief:${b.id}` === sub) : undefined;
    const list = brief ? work.filter((t) => t.briefId === brief.id) : work.filter((t) => (sub === 'approve' ? t.approval?.status === 'waiting' : sub === 'done' ? t.done : !t.done));
    const groups = brief
      ? [{ key: brief.id, label: null as string | null, items: list }]
      : [...briefs.map((b) => ({ key: b.id, label: b.title, items: list.filter((t) => t.briefId === b.id) })), { key: 'other', label: briefs.length ? 'Other work' : null, items: list.filter((t) => !t.briefId || !briefs.some((b) => b.id === t.briefId)) }].filter((g) => g.items.length);
    content = pane(
      brief ? brief.title : sub === 'approve' ? 'Needs approval' : sub === 'done' ? 'Done' : 'Work',
      brief ? `${brief.due ? `Due ${fmtDay(brief.due)} · ` : ''}${list.filter((t) => t.done).length} of ${list.length} done` : approvals.length ? `${approvals.length} waiting for your approval` : 'Nothing waiting on you',
      <>
        {brief?.context && <p className="client-brief-context">{brief.context}</p>}
        {groups.length
          ? groups.map((g) => (
              <div key={g.key} className="todo-group">
                {g.label && <div className="d-heading">{g.label}</div>}
                {g.items.map(taskRow)}
              </div>
            ))
          : empty(<ListChecks size={22} />, 'Nothing here', 'The team shares tasks and briefs with you as work moves.')}
      </>,
    );
  }

  if (mode === 'tables') {
    const t = sharedTables.find((x) => x.id === sub) ?? sharedTables[0];
    if (t) {
      const editable = can(person, 'comment') && client.status !== 'ended';
      content = (
        <TableScreen
          key={t.id}
          table={t}
          tables={sharedTables}
          rows={sharedRows}
          users={shownTeam}
          clients={[client]}
          me={p.account?.me.id ?? person.email}
          setTables={() => {}}
          setRows={setAllRows /* the server keeps only the changes guests may make */}
          onOpenTable={(id, rowId) => (setSub(id), setTableRow(rowId ?? null))}
          openRow={tableRow}
          setOpenRow={setTableRow}
          onDeleted={() => {}}
          onMenu={() => go('home')}
          toast={(x) => say(x.text)}
          channels={[]}
          isAdmin={false}
          serverOn={server.on}
          onCompose={() => {}}
          guest={{ canEdit: (id) => editable && (t.share?.edit ?? []).includes(id), add: editable && !!t.share?.add, download: !!t.share?.download }}
        />
      );
    }
  }

  if (mode === 'files') {
    const chan = sub.startsWith('chan:') ? v.channels.find((c) => `chan:${c.id}` === sub) : undefined;
    if (chan) {
      const msgs = p.messages.filter((m) => m.channelId === chan.id);
      const links = msgs.flatMap((m) => (m.text.match(/https?:\/\/[^\s)]+/g) ?? []).map((url) => ({ url, who: m.guestEmail ? nameOf(m.guestEmail) : nameOf(m.userId), at: m.at })));
      const chatFiles = msgs.flatMap((m) => (m.files ?? []).map((f) => ({ key: `file:${m.id}:${f.name}`, name: f.name, type: f.type, size: f.size, url: f.url, who: m.guestEmail ? nameOf(m.guestEmail) : nameOf(m.userId), at: m.at, where: 'in chat' })));
      content = pane(
        chan.name,
        'Files, links and docs in this channel',
        <ChannelMaterials channel={chan} users={shownTeam} me={person.email} chatFiles={chatFiles} chatLinks={links} onChannel={() => {}} readOnly />,
      );
    } else {
      const list = v.files.filter((f) => (sub === 'shared' ? !f.uploadedBy : sub === 'mine' ? !!f.uploadedBy : true)).sort((a, b) => b.modified.localeCompare(a.modified));
      content = pane(
        sub === 'shared' ? 'Shared with you' : sub === 'mine' ? `From ${fromWho}` : 'Files',
        access.uploads ? `Uploads go to “From ${fromWho}”` : 'What the team shares with you',
        list.length ? (
          <div className="todo-group">
            {list.map((f) => (
              <FileRow key={f.id} f={f} by={f.uploadedBy ? nameOf(f.uploadedBy) : ws.name} say={say} />
            ))}
          </div>
        ) : (
          empty(<HardDrive size={22} />, 'No files yet', sub === 'mine' ? 'Upload files for the team here.' : `${ws.name} shares files with you here.`)
        ),
        access.uploads && can(person, 'upload') && mobile ? <UploadButton actions={actions} say={say} compact /> : undefined,
      );
    }
  }

  if (mode === 'meet') {
    const sel = v.meetings.find((x) => x.meeting.id === sub) ?? v.meetings.slice().sort((a, b) => b.meeting.at.localeCompare(a.meeting.at))[0];
    content = sel ? (
      pane(
        sel.meeting.title,
        `${fmtDay(sel.meeting.at)} · ${sel.meeting.minutes} min · ${sel.meeting.attendees.join(', ')}`,
        <MeetingNotes m={sel.meeting} notes={sel.notes} recording={access.recordings} />,
      )
    ) : (
      pane('Meetings', 'Notes from meetings you were in', empty(<Video size={22} />, 'No meetings yet', 'Notes appear here after you meet with the team.'))
    );
  }

  if (mode === 'chat') {
    const ch = v.channels.find((c) => c.id === chanId);
    content =
      mobile && !ch ? (
        <section className="mobile-list view-enter">
          <nav className="nav">{v.channels.map((c) => navItem(c.id, c.name, Handshake, undefined, false, () => setChanId(c.id)))}</nav>
        </section>
      ) : ch ? (
        <ChatView
          key={ch.id}
          channel={ch}
          messages={p.messages.filter((m) => m.channelId === ch.id)}
          users={shownTeam}
          me={person.email}
          myRole="member"
          clients={[client]}
          teams={[]}
          tasks={[]}
          mail={[]}
          drive={v.files as DriveItem[]}
          statuses={{}}
          presence={() => 'active'}
          gifs={false}
          onSend={(pl) => actions.send(ch.id, pl)}
          onDelete={() => {}}
          onPin={() => {}}
          onToggleTask={() => {}}
          onChannel={() => {}}
          summaryCost=""
          since=""
          onReact={() => {}}
          onVote={() => {}}
          onMakeTask={() => {}}
          onCreateTask={() => {}}
          onOpenTask={() => {}}
          onOpenClient={() => {}}
          onOpenTeam={() => {}}
          onOpenMail={() => {}}
          onSettings={() => {}}
          onMenu={() => {}}
          onBack={mobile ? () => setChanId(null) : undefined}
          guest={{ canPost: can(person, 'comment') }}
        />
      ) : (
        pane('Chat', '', empty(<MessagesSquare size={22} />, 'No conversations yet', `${ws.name} will add you to a channel.`))
      );
  }

  /* ---------------- the shell ---------------- */
  return (
    <div className={`app client-app mode-${mode === 'work' ? 'tasks' : mode === 'files' ? 'drive' : mode} ${hasSidebar ? '' : 'no-sidebar'}`}>
      <nav className="rail" aria-label="Portal">
        <div className="rail-ws">
          {p.switcher ?? (
            <span className="client-ws" title={`${ws.name} for ${client.name}`}>
              <WorkspaceLogo ws={ws} size={34} />
            </span>
          )}
        </div>
        <div className="rail-apps">
          {MODES.map(([id, name, Icon, n]) => (
            <button key={id} className={`rail-app ${mode === id ? 'on' : ''}`} onClick={() => go(id)} title={name} aria-current={mode === id ? 'page' : undefined}>
              <span className="rail-icon">
                <Icon size={19} />
                {n ? <i>{n}</i> : null}
              </span>
              <span className="rail-label">{name}</span>
            </button>
          ))}
        </div>
        <div className="rail-foot">
          {access.ai && (
            <button className={`rail-tool ai ${askOpen ? 'on' : ''}`} onClick={() => setAskOpen((o) => !o)} title="Ask AI">
              <Sparkles size={18} />
            </button>
          )}
          <div className="rail-notices">
            <button className={`rail-tool ${noticesOpen ? 'on' : ''}`} onClick={() => (setNoticesOpen((o) => !o), p.onReadNotices())} title="Notifications">
              <Bell size={18} />
              {unread ? <i>{unread}</i> : null}
            </button>
            {noticesOpen && <Notifications notices={p.notices} onOpen={(n) => (setNoticesOpen(false), n.link?.id && (setMode(n.link.app === 'chat' ? 'chat' : 'requests'), setOpenTask(n.link.id)))} onReadAll={p.onReadNotices} onClose={() => setNoticesOpen(false)} />}
          </div>
          <div className="rail-account">
            <button ref={meBtn} className={`rail-avatar ${meOpen ? 'on' : ''}`} onClick={() => setMeOpen(true)} title={person.name}>
              <Avatar person={{ name: p.account?.me.name ?? person.name, email: person.email, color: p.account?.me.color ?? client.color }} size={32} />
            </button>
          </div>
        </div>
      </nav>

      {hasSidebar && (
        <aside className="sidebar client-sidebar" style={{ ['--sb-w' as string]: `${sbW}px` }}>
          <div className="sb-top">
            <h2 className="sb-title sb-label">{title}</h2>
          </div>
          <div className="sb-scroll">
            <div className="sb-panel" key={mode}>
              {sidebar[mode]}
            </div>
          </div>
          <div className="sb-resize" onPointerDown={startResize} onDoubleClick={() => setSbW(248)} title="Drag to resize · double-click to reset" />
        </aside>
      )}

      <main className="main" key={mode}>
        {client.status === 'ended' && (
          <div className="ended-banner">
            Your work with {ws.name} ended{client.endedAt ? ` on ${new Date(client.endedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. You can still read everything and download files.
          </div>
        )}
        {mobile && (
          <MobileTop
            title={title}
            switcher={
              mode === 'work'
                ? { value: sub, label: 'Which work', onChange: setSub, options: [{ value: '', label: 'Work' }, { value: 'approve', label: 'Needs approval' }, { value: 'done', label: 'Done' }, ...briefs.map((b) => ({ value: `brief:${b.id}`, label: b.title, group: 'Briefs' }))] }
                : mode === 'files'
                  ? { value: sub, label: 'Which files', onChange: setSub, options: [{ value: '', label: 'Files' }, { value: 'shared', label: 'Shared with you' }, { value: 'mine', label: `From ${fromWho}` }, ...v.channels.map((c) => ({ value: `chan:${c.id}`, label: c.name, group: 'Channel materials' }))] }
                  : mode === 'requests'
                    ? { value: sub, label: 'Which requests', onChange: setSub, options: [{ value: '', label: 'Requests' }, { value: 'waiting', label: 'Waiting on you' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All requests' }] }
                    : mode === 'meet' && v.meetings.length
                      ? { value: sub || v.meetings[0].meeting.id, label: 'Which meeting', onChange: setSub, options: v.meetings.map((x) => ({ value: x.meeting.id, label: x.meeting.title })) }
                      : undefined
            }
            workspaces={p.mobileSwitch?.workspaces ?? [ws]}
            current={ws}
            unread={unread}
            onWorkspace={p.mobileSwitch?.onWorkspace ?? (() => {})}
            onAddWorkspace={() => {}}
            onSearch={() => (access.ai ? setAskOpen(true) : go('home'))}
            onBell={() => (setNoticesOpen(true), p.onReadNotices())}
          />
        )}
        {content}
      </main>

      {mobile && (
        <nav className="tabbar">
          {MODES.slice(0, 5).map(([id, label, Icon, n]) => (
            <button key={id} className={mode === id ? 'on' : ''} onClick={() => go(id)}>
              <span className="tab-icon">
                <Icon size={21} />
                {n ? <i>{n}</i> : null}
              </span>
              {label}
            </button>
          ))}
          <button className={meOpen ? 'on' : ''} onClick={() => setMeOpen(true)}>
            <span className="tab-icon">
              <MenuIcon size={21} />
            </span>
            More
          </button>
        </nav>
      )}

      {task && (
        <TaskPanel
          t={task}
          subs={isBrief(task) ? work.filter((x) => x.briefId === task.id) : []}
          person={person}
          clientName={client.name}
          nameOf={nameOf}
          avatarOf={avatarOf}
          stLabel={stLabel}
          actions={actions}
          onOpen={setOpenTask}
          onClose={() => setOpenTask(null)}
        />
      )}
      {newRequest && (
        <NewRequest
          onClose={() => setNewRequest(false)}
          onSend={async (r) => {
            const id = await actions.request(r);
            setNewRequest(false);
            setMode('requests');
            setOpenTask(id);
            say('Request sent. The team has been told.');
          }}
        />
      )}
      {askOpen && (
        <Assistant
          scope={{ kind: 'all' }}
          setScope={() => {}}
          scopeOptions={[{ value: 'all', label: `What ${ws.name} shared with ${client.name}` }]}
          chats={askChats}
          setChats={setAskChats}
          ask={(q) => actions.ask(q)}
          citeLabel={() => 'source'}
          onCite={() => {}}
          live
          onClose={() => setAskOpen(false)}
        />
      )}
      <Popover anchor={meBtn} open={meOpen} onClose={() => setMeOpen(false)} width={300} title="Account">
        <PersonMenu p={p} close={() => setMeOpen(false)} mobileModes={mobile ? MODES.slice(5) : []} go={go} say={say} onProfile={() => setProfileOpen(true)} />
      </Popover>
      {profileOpen && p.account && <ProfileDialog me={p.account.me} email={person.email} onSave={(patch) => (p.account!.onProfile(patch), say('Profile saved'))} onClose={() => setProfileOpen(false)} />}
      {p.preview && (
        <div className="view-as-pill">
          <Eye size={14} />
          <span>
            Viewing as <b>{person.name}</b>
          </span>
          {p.preview.people.length > 1 && (
            <select value={person.email} onChange={(e) => p.preview!.onSwitch(e.target.value)} aria-label="Switch person">
              {p.preview.people.map((x) => (
                <option key={x.email} value={x.email}>
                  {x.name} · {ROLE[x.role]}
                </option>
              ))}
            </select>
          )}
          <button className="primary-btn sm" onClick={p.preview.onExit}>
            Exit
          </button>
        </div>
      )}
      {toast && <div className="toast client-toast">{toast}</div>}
    </div>
  );
}

/* ---------------- pieces ---------------- */

function UploadButton({ actions, say, compact }: { actions: ClientActions; say: (t: string) => void; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={compact ? 'primary-btn sm' : 'compose-btn'} onClick={() => ref.current?.click()}>
        <Upload size={16} />
        <span className="sb-label">Upload</span>
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        onChange={async (e) => {
          const fs = [...(e.target.files ?? [])];
          e.target.value = '';
          const big = fs.filter((f) => f.size > 8_000_000).length;
          const done = await actions.upload(fs);
          say(big ? `${done.length} uploaded. Files over 8 MB: share a link instead.` : `${done.length} file${done.length === 1 ? '' : 's'} uploaded.`);
        }}
      />
    </>
  );
}

function FileRow({ f, by, say }: { f: DriveItem; by: string; say: (t: string) => void }) {
  return (
    <a className="task file-task" href={f.url} target="_blank" rel="noreferrer" download={f.url ? f.name : undefined} onClick={(e) => !f.url && (e.preventDefault(), say('This is a demo file without content.'))}>
      <span className="cf-icon">{f.kind === 'video' ? <Video size={16} /> : <FileText size={16} />}</span>
      <div className="task-main">
        <span className="task-title-btn">{f.name}</span>
        <div className="task-meta">
          <span className="src">
            {fmtSize(f.size)} · {by} · {relative(f.modified)}
          </span>
        </div>
      </div>
    </a>
  );
}

function MeetingNotes({ m, notes, recording }: { m: Meeting; notes: boolean; recording: ClientAccess['recordings'] }) {
  return (
    <div className="client-notes">
      {recording !== 'off' && (
        <div className="client-recording">
          <Video size={16} /> Audio recording
          <small className="muted">Plays here once recordings are stored on the server.</small>
        </div>
      )}
      {notes ? (
        <>
          <div className="side-card">
            <h3>Summary</h3>
            <p>{m.summary}</p>
          </div>
          {!!m.decisions?.length && (
            <div className="side-card">
              <h3>Decisions</h3>
              <ul>{m.decisions.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {!!m.keyPoints?.length && (
            <div className="side-card">
              <h3>Key points</h3>
              <ul>{m.keyPoints.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {m.actions.length > 0 && (
            <div className="side-card">
              <h3>Next steps</h3>
              <ul>
                {m.actions.map((a) => (
                  <li key={a.title}>
                    {a.title}
                    {a.due ? <small className="muted"> · {fmtDay(a.due)}</small> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="te-empty">The team hasn’t shared notes for this meeting.</p>
      )}
    </div>
  );
}

/** A task, brief or request, opened in the same side panel the team uses. */
function TaskPanel({
  t,
  subs,
  person,
  clientName,
  nameOf,
  avatarOf,
  stLabel,
  actions,
  onOpen,
  onClose,
}: {
  t: Todo;
  subs: Todo[];
  person: ClientPerson;
  clientName: string;
  nameOf: (by: string) => string;
  avatarOf: (by: string, size?: number) => React.ReactNode;
  stLabel: (t: Todo) => string;
  actions: ClientActions;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  useOnePanel(onClose);
  const [comment, setComment] = useState('');
  const [changes, setChanges] = useState<string | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const doers = [...new Set(t.assignees?.length ? t.assignees : t.userId ? [t.userId] : [])];
  const history = (t.history ?? []).filter((h) => h.toClient || h.by.includes('@') || (h.kind === 'created' && t.source === 'request'));
  const send = () => {
    if (!comment.trim()) return;
    actions.comment(t.id, comment.trim());
    setComment('');
  };
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label={t.title}>
        <header className="drawer-head">
          {isBrief(t) ? (
            <span className="brief-badge">
              <FileText size={12} /> Brief
            </span>
          ) : (
            <span className="drawer-kind">{t.source === 'request' ? 'Request' : 'Task'}</span>
          )}
          <span className="spacer" />
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <h2 className="client-title">{t.title}</h2>

          <SmoothHeight>
          {t.approval?.status === 'waiting' && (
            <div className="review-banner">
              <span>
                <strong>Waiting for your approval</strong>
                <small>{can(person, 'approve') ? 'Approve it, or tell the team what to change.' : `Only approvers at ${clientName} can approve. You can still comment.`}</small>
              </span>
              {can(person, 'approve') && changes === null && (
                <span className="rb-actions">
                  <button className="ghost-btn sm" onClick={() => setChanges('')}>
                    <RotateCcw size={13} /> Ask for changes
                  </button>
                  <button className="primary-btn sm" onClick={() => actions.decide(t.id, 'approved', '')}>
                    <CheckCircle2 size={14} /> Approve
                  </button>
                </span>
              )}
            </div>
          )}
          </SmoothHeight>
          <SmoothHeight>
          {changes !== null && (
            <div className="comment-box to-client">
              <textarea autoFocus rows={3} value={changes} onChange={(e) => setChanges(e.target.value)} placeholder="What should change?" />
              <div className="cb-foot">
                <button className="ghost-btn sm" onClick={() => setChanges(null)}>
                  Cancel
                </button>
                <button className="primary-btn sm" disabled={!changes.trim()} onClick={() => (actions.decide(t.id, 'changes', changes.trim()), setChanges(null))}>
                  Send changes
                </button>
              </div>
            </div>
          )}
          </SmoothHeight>
          {t.approval && t.approval.status !== 'waiting' && (
            <p className={`ap-tag ${t.approval.status}`}>
              {t.approval.status === 'approved' ? 'Approved' : 'Changes asked'} by {nameOf(t.approval.by ?? '')}
              {t.approval.note ? `: “${t.approval.note}”` : ''}
            </p>
          )}

          <dl className="fields">
            <dt>Status</dt>
            <dd>
              <span className={`st-dot st-${t.done ? 'done' : statusOf(t)}`} /> {stLabel(t)}
            </dd>
            {doers.length > 0 && (
              <>
                <dt>{isBrief(t) ? 'In charge' : 'Doing it'}</dt>
                <dd className="client-doers">
                  {doers.map((id) => (
                    <span key={id}>
                      {avatarOf(id, 22)} {nameOf(id)}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {t.due && (
              <>
                <dt>{t.source === 'request' ? 'Needed by' : 'Due'}</dt>
                <dd>{fmtDay(t.due)}</dd>
              </>
            )}
            {t.source === 'request' && (
              <>
                <dt>Sent by</dt>
                <dd>
                  {nameOf(t.requestedBy ?? '')} · {relative(t.createdAt)}
                </dd>
              </>
            )}
          </dl>

          {isBrief(t) && t.context && (
            <>
              <label className="drawer-label">Context</label>
              <p className="client-brief-context">{t.context}</p>
            </>
          )}
          {subs.length > 0 && (
            <>
              <label className="drawer-label">Tasks in this brief</label>
              <div className="sub-list">
                {subs.map((s) => (
                  <div key={s.id} className={`sub ${s.done ? 'done' : ''}`}>
                    <span className={`st-dot st-${s.done ? 'done' : statusOf(s)}`} />
                    <button className="sub-title" onClick={() => onOpen(s.id)}>
                      {s.title}
                    </button>
                    <span className="muted small">{stLabel(s)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <label className="drawer-label">Conversation</label>
          <ol className="history">
            {history.map((h) => (
              <li key={h.id} className={`h-${h.kind}`}>
                {avatarOf(h.by, 22)}
                <span className="h-body">
                  {h.kind === 'comment' ? (
                    <>
                      <b>{h.by.toLowerCase() === person.email.toLowerCase() ? 'You' : nameOf(h.by)}</b>
                      <span className="h-comment">{h.text}</span>
                    </>
                  ) : (
                    <span>
                      <b>{h.by.toLowerCase() === person.email.toLowerCase() ? 'You' : nameOf(h.by)}</b> {h.text}
                    </span>
                  )}
                  <time>{relative(h.at)}</time>
                </span>
              </li>
            ))}
            {!history.length && <li className="muted small">No messages yet.</li>}
          </ol>
          {can(person, 'comment') && (
            <div className="comment-box">
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} placeholder="Write to the team…" />
              <div className="cb-foot">
                <button className="primary-btn sm" disabled={!comment.trim()} onClick={send}>
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function NewRequest({ onSend, onClose }: { onSend: (r: { title: string; details: string; due?: string; files: File[] }) => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [due, setDue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal request-modal" role="dialog" aria-label="New request" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Inbox size={15} /> New request
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body request-body">
          <SmoothHeight>
          <label className="field">
            <span>What do you need?</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A new banner for the Ramadan promo" />
          </label>
          <label className="field">
            <span>Details</span>
            <textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Sizes, wording, examples you like, anything that helps" />
          </label>
          <div className="request-row">
            <div className="field">
              <span>Needed by (optional)</span>
              <DatePicker value={due} onChange={setDue} label="Needed by" placeholder="No date" />
            </div>
            <div className="field">
              <span>Files</span>
              <button className="ghost-btn sm" onClick={() => ref.current?.click()}>
                <Paperclip size={14} /> Attach
              </button>
            </div>
          </div>
          {files.length > 0 && (
            <div className="request-files">
              {files.map((f) => (
                <span key={f.name} className="chip">
                  {f.name}
                  <button aria-label="Remove" onClick={() => setFiles(files.filter((x) => x !== f))}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input ref={ref} type="file" multiple hidden onChange={(e) => (setFiles([...files, ...(e.target.files ?? [])]), (e.target.value = ''))} />
          <p className="muted small">The team gets this straight away. You’ll see when they pick it up, and you can talk about it on the request.</p>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!title.trim()} onClick={() => onSend({ title, details, due: due || undefined, files })}>
            Send request
          </button>
        </footer>
      </div>
    </div>
  );
}

function PersonMenu({ p, close, mobileModes, go, say, onProfile }: { p: Props; close: () => void; mobileModes: [Mode, string, LucideIcon, number?][]; go: (m: Mode) => void; say: (t: string) => void; onProfile: () => void }) {
  const { person, access, ws, account } = p;
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ text: string; link?: string | null } | null>(null);
  const me = account?.me;
  const company = companyOf(person.email, person.company, p.client);
  return (
    <div className="sel-pop guest-menu">
      <div className="am-head">
        <Avatar person={{ name: me?.name ?? person.name, email: person.email, color: me?.color ?? p.client.color }} size={42} />
        <div>
          <strong>{me?.name ?? person.name}</strong>
          <small>{person.email}</small>
          <small>
            {ROLE[person.role]}
            {company ? ` · ${company}` : ''}
          </small>
        </div>
      </div>
      {account && (
        <div className="am-theme">
          {(
            [
              ['light', Sun, 'Light'],
              ['dark', Moon, 'Dark'],
              ['system', Monitor, 'Auto'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} className={account.theme === id ? 'on' : ''} onClick={() => account.onTheme(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}
      {account && (
        <button className="am-item" onClick={() => (close(), onProfile())}>
          <UserRound size={16} /> Your profile and password
        </button>
      )}
      {mobileModes.map(([id, label, Icon]) => (
        <button key={id} className="am-item" onClick={() => (close(), go(id))}>
          <Icon size={16} /> {label}
        </button>
      ))}
      {access.invites !== 'off' &&
        (inviting ? (
          <div className="client-invite">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${person.email.split('@')[1] ?? 'company.com'}`} />
            {msg && (
              <p className="small">
                {msg.text}{' '}
                {msg.link && (
                  <button className="link-btn" onClick={() => void navigator.clipboard?.writeText(msg.link!).then(() => say('Invite link copied'))}>
                    Copy link
                  </button>
                )}
              </p>
            )}
            <div className="ci-actions">
              <button className="ghost-btn sm" onClick={() => (setInviting(false), setMsg(null))}>
                Cancel
              </button>
              <button
                className="primary-btn sm"
                disabled={!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
                onClick={async () => {
                  const r = await p.actions.invite({ name, email });
                  setMsg({ text: r.message, link: r.link });
                  if (r.ok) (setName(''), setEmail(''));
                }}
              >
                {access.invites === 'approve' ? 'Ask to add them' : 'Invite'}
              </button>
            </div>
          </div>
        ) : (
          <button className="am-item" onClick={() => setInviting(true)}>
            <UserPlus size={16} /> Invite a colleague
          </button>
        ))}
      <div className="am-sep" />
      {(p.onSignOut ?? p.preview?.onExit) && (
        <button className="am-item danger" onClick={() => (close(), (p.onSignOut ?? p.preview!.onExit)())}>
          <LogOut size={16} /> {p.onSignOut ? 'Sign out' : `Exit ${term.who} view`}
        </button>
      )}
      <p className="muted small menu-note">You see what {ws.name} shares with you. Need something? Use Requests or Chat.</p>
    </div>
  );
}

/** A guest's own profile: photo, name, job title, colour and password. The same account works in every shared space. */
function ProfileDialog({ me, email, onSave, onClose }: { me: User; email: string; onSave: (patch: Partial<User>) => void; onClose: () => void }) {
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title ?? '');
  const [color, setColor] = useState(me.color);
  const [photo, setPhoto] = useState(me.photo);
  return createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal profile-modal" role="dialog" aria-label="Your profile" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <UserRound size={15} /> Your profile
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
          <PhotoPicker name={name || me.name} email={email} color={color} photo={photo} onChange={setPhoto} />
          {!photo && (
            <div className="avatar-colors">
              <small>Or a colour</small>
              <div>
                {ACCENTS.map((c) => (
                  <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Job title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Marketing lead" />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={email} readOnly />
            <small>You sign in with this address. The same sign-in works for everything shared with you.</small>
          </div>
          <PasswordRow />
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!name.trim()} onClick={() => (onSave({ name: name.trim(), title: title.trim(), color, photo }), onClose())}>
            Save
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export type { Channel };
