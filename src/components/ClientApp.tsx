import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { setBrand } from '../brandInk';
import { CreateFab } from '../mobile/BottomBar';
import { SmoothHeight } from './ui/Smooth';
import { setTermWord, term, brand as product } from '../terms';
import {
  ArrowRight,
  BadgeCheck,
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
  MoreHorizontal as MenuIcon,
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
import { TableScreen } from './tables/TableScreen';
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
import { dueLabel, isBrief } from './TasksView';
import { kindOf } from '../stages';
import { useOnePanel } from '../onePanel';
import { AttachButton, dropFiles, FileCards, useCommentFiles, WaitingFiles } from './tasks/CommentFiles';
import { isPhone as mobilePhone } from '../mobile/media';
import { Select } from './ui/Select';
import { GuestQuotes } from './Quotes';
import type { Quote } from '../types';
import { EmptyState } from './ui/EmptyState';
import { PHONE } from '../mobile/media';
import { LANGS, mark, t, textOf, tn, tx, type Lang, type Msg } from '../i18n';
import { tj } from '../i18n/tj';
import { useLang } from '../i18n/useLang';
import { fmtDayLong, fmtDayWord, fmtNumber, fmtWeekday, fmtWeekdayLong } from '../i18n/format';

/** The dot for a task in the guest's view: planned, in progress, waiting on them, or done. */
const stCls = (task: Todo) => ({ open: 'todo', active: 'doing', review: 'doing', waiting: 'waiting', done: 'done' } as const)[kindOf(task)];

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
  quotes?: Quote[]; // quotes and contracts sent to this client
  onDecideQuote?: (id: string, status: 'accepted' | 'declined', text: string) => void;
  notices: Notice[];
  onReadNotices: () => void;
  /** "View as client": a pill to switch person or leave. */
  preview?: { onExit: () => void; people: ClientPerson[]; onSwitch: (email: string) => void };
  onSignOut?: () => void;
  /** Someone with their own workspace (or several portals): the workspace switcher, in place of the logo. */
  switcher?: React.ReactNode;
  /** Phones: the logo's switcher, with every space shared with this person (the current one ticked). */
  mobileSwitch?: { workspaces: Workspace[]; onWorkspace: (id: string) => void; portals?: { key: string; ws: Workspace; client: Client; unread?: number }[]; current?: string; onPortal?: (key: string) => void; onShared?: () => void; onAdd?: () => void };
  /** Their own account: profile, photo, password, light or dark, and their language. Not in "View as guest". */
  account?: { me: User; theme: ThemePref; onTheme: (theme: ThemePref) => void; onProfile: (patch: Partial<User>) => void; language?: Lang; onLanguage?: (l: Lang) => void };
}

const fmtSize = (b: number) => (b > 1e6 ? `${fmtNumber(b / 1e6, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB` : `${fmtNumber(Math.max(1, Math.round(b / 1e3)))} KB`);
/** "Thu 8 Oct" / "Kam, 8 Okt". */
const fmtDay = (iso: string) => fmtWeekday(iso);
/** A due day on a row: Overdue, Today, Tomorrow, else the day (the guest's own words, whatever the team's tasks say). */
const dueText = (cls: string, due: string) => (cls === 'overdue' ? t('Overdue') : fmtDayWord(due));
// The roles' names: English here, translated where they're shown (t(ROLE[role])).
const ROLE: Record<ClientPerson['role'], string> = { viewer: mark('Viewer'), collaborator: mark('Collaborator'), approver: mark('Approver') };

function useMobile() {
  const [m, setM] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE);
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
  const say = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 3500);
  };

  // The company's colour drives the accent, the same way it does in the team app.
  useEffect(() => {
    applyBranding(ws); // the company's icon in the browser tab
    setBrand(ws.color);
    document.title = `${client.name} · ${ws.name}`;
  }, [ws.color, ws.name, client.name]);

  const teamUser = (id?: string) => p.team.find((u) => u.id === id);
  const nameOf = (by: string) => (by.includes('@') ? (v.people.find((x) => x.email.toLowerCase() === by.toLowerCase())?.name ?? by) : teamLabel(teamUser(by), access, ws.name));
  // Team members as the client sees them (names per the company's setting).
  const lang = useLang(); // "{company} team" is built in the memo below
  const shownTeam: User[] = useMemo(() => p.team.map((u) => (access.teamNames === 'hide' ? { ...u, name: teamLabel(undefined, access, ws.name), color: ws.color } : { ...u, name: teamLabel(u, access, ws.name) })), [p.team, access, ws.name, ws.color, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const avatarOf = (by: string, size = 24) => {
    if (by.includes('@')) return <Avatar person={{ name: nameOf(by), email: by, color: client.color }} size={size} />;
    const u = shownTeam.find((x) => x.id === by);
    return access.teamNames === 'hide' || !u ? <WorkspaceLogo ws={ws} size={size} /> : <Avatar person={u} size={size} />;
  };

  const requests = v.tasks.filter((tk) => tk.source === 'request').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shared = v.tasks.filter((tk) => tk.source !== 'request');
  const briefs = shared.filter(isBrief);
  const work = shared.filter((tk) => !isBrief(tk));
  const approvals = work.filter((tk) => tk.approval?.status === 'waiting');
  const waitingOnMe = requests.filter((tk) => requestStatus(tk).cls === 'waiting');
  const unread = p.notices.filter((n) => !n.read).length;
  const task = v.tasks.find((tk) => tk.id === openTask);

  // Tables the team shared with this project (leads and so on): only shared fields, shaped like the server does.
  const [allTables] = useStored('tables');
  const [allRows, setAllRows] = useStored('rows');
  const sharedTables = useMemo(() => allTables.filter((tb) => tb.workspaceId === ws.id).map((tb) => guestTable(client, tb)).filter(Boolean) as DataTable[], [allTables, ws.id, client]);
  const sharedRows = useMemo(() => {
    const byId = new Map(sharedTables.map((tb) => [tb.id, tb]));
    return allRows.filter((r) => byId.has(r.tableId)).map((r) => guestRow(byId.get(r.tableId)!, r));
  }, [allRows, sharedTables]);
  const [tableRow, setTableRow] = useState<string | null>(null);

  const MODES: [Mode, string, LucideIcon, number?][] = [
    ['home', t('Home'), House],
    ...(access.requests ? ([['requests', t('Requests'), Inbox, waitingOnMe.length]] as [Mode, string, LucideIcon, number][]) : []),
    ['chat', t('Messages'), MessagesSquare],
    ['work', t('Work'), ListChecks, approvals.length],
    ['files', t('Files'), HardDrive],
    ['meet', t('Meetings'), Video],
    ...(sharedTables.length ? ([['tables', t('Tables'), Table2]] as [Mode, string, LucideIcon][]) : []),
  ];
  // Phones: a short fixed bar of only what's shared with them, in this order, with More only when it can't fit.
  // Five tabs next to the create button: the bar's own shorter words where Indonesian runs long (tx 'bar').
  const BAR: [Mode, string, LucideIcon, number?][] = [
    ['home', t('Home'), House],
    ...(v.channels.length ? ([['chat', t('Messages'), MessagesSquare]] as [Mode, string, LucideIcon][]) : []),
    ...(shared.length ? ([['work', tx('bar', 'Approvals'), BadgeCheck, approvals.length]] as [Mode, string, LucideIcon, number][]) : []),
    ...(v.files.length || access.uploads ? ([['files', t('Files'), HardDrive]] as [Mode, string, LucideIcon][]) : []),
    ...(access.requests ? ([['requests', tx('bar', 'Requests'), Inbox, waitingOnMe.length]] as [Mode, string, LucideIcon, number][]) : []),
  ];
  // Meetings and tables, when shared, are on Home and in the account sheet; the bar only grows a More past five.
  const extra = MODES.filter(([id]) => (id === 'meet' && v.meetings.length) || id === 'tables');
  // Phones: the screen's main job sits at the end of the bar, like the team app's create button.
  const uploader = useUploader(actions, say);
  const create = mode === 'requests' && access.requests && can(person, 'request') && client.status !== 'ended' ? { label: t('New request'), icon: Plus, run: () => setNewRequest(true) } : mode === 'files' && access.uploads && can(person, 'upload') && client.status !== 'ended' ? { label: t('Upload'), icon: Upload, run: uploader.pick } : null;
  const barFits = BAR.length <= 5;
  const barItems = barFits ? BAR : BAR.slice(0, 4);
  const barMore = [...(barFits ? [] : BAR.slice(4)), ...extra];
  const go = (m: Mode, s = '') => {
    setMode(m);
    setSub(s);
    setOpenTask(null);
    // Phones: one conversation opens straight away; several show their list first.
    if (m === 'chat' && mobile) setChanId(v.channels.length === 1 ? v.channels[0].id : null);
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
        {sharedTables.map((tb) =>
          navItem(
            tb.id,
            <>
              <span className="client-dot sm" style={{ background: tb.color }}>
                {tb.name.charAt(0).toUpperCase()}
              </span>{' '}
              {tb.name}
            </>,
            null,
            undefined,
            (sub || sharedTables[0]?.id) === tb.id,
            () => (setSub(tb.id), setTableRow(null)),
          ),
        )}
      </nav>
    ),
    requests: (
      <>
        {can(person, 'request') && (
          <button className="compose-btn" onClick={() => setNewRequest(true)}>
            <Plus size={16} />
            <span className="sb-label">{t('New request')}</span>
          </button>
        )}
        <nav className="nav">
          {navItem('', tx('requests', 'Open'), Inbox)}
          {navItem('waiting', t('Waiting on you'), Clock, waitingOnMe.length)}
          {navItem('done', t('Done'), CheckCircle2)}
          {navItem('all', t('All requests'), ListChecks)}
        </nav>
      </>
    ),
    chat: (
      <nav className="nav">
        {v.channels.map((c) => navItem(c.id, c.name, Handshake, undefined, chanId === c.id, () => setChanId(c.id)))}
        {!v.channels.length && <p className="muted small sb-label sb-note">{t('{company} hasn’t added you to a conversation yet.', { company: ws.name })}</p>}
      </nav>
    ),
    work: (
      <>
        <nav className="nav">
          {navItem('', t('Everything'), ListChecks)}
          {navItem('approve', t('Needs approval'), Clock, approvals.length)}
          {navItem('done', t('Done'), CheckCircle2)}
        </nav>
        {briefs.length > 0 && (
          <>
            <div className="nav-heading sb-label">{t('Briefs')}</div>
            <nav className="nav">{briefs.map((b) => navItem(`brief:${b.id}`, b.title, FileText))}</nav>
          </>
        )}
      </>
    ),
    files: (
      <>
        {access.uploads && can(person, 'upload') && <UploadButton actions={actions} say={say} />}
        <nav className="nav">
          {navItem('', t('All files'), HardDrive)}
          {navItem('shared', t('Shared with you'), FileText)}
          {navItem('mine', t('From {company}', { company: fromWho }), Upload)}
        </nav>
        {v.channels.length > 0 && (
          <>
            <div className="nav-heading sb-label">{t('Channel materials')}</div>
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
        {!v.meetings.length && <p className="muted small sb-label sb-note">{t('No meetings yet.')}</p>}
      </nav>
    ),
  };

  /* ---------------- shared bits ---------------- */
  // Guests see where work is in their words, from the kind of stage it's in (the team's own stage names stay inside).
  const stLabel = (tk: Todo) => (tk.source === 'request' ? t(requestStatus(tk).label) : { done: t('Done'), active: t('In progress'), review: t('In progress'), waiting: t('Waiting on you'), open: t('Planned') }[kindOf(tk)]);
  const taskRow = (tk: Todo) => {
    const d = tk.due && !tk.done ? dueLabel(tk.due) : null;
    const doers = [...new Set((tk.assignees?.length ? tk.assignees : tk.userId ? [tk.userId] : []))];
    return (
      <div key={tk.id} className={`task ${tk.done ? 'done' : ''}`} onClick={() => setOpenTask(tk.id)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), setOpenTask(tk.id))}>
        <span className={`st-dot st-${stCls(tk)} task-dot`} />
        <div className="task-main">
          <button className="task-title-btn">{tk.title}</button>
          <div className="task-meta">
            {tk.approval?.status === 'waiting' ? <span className="due waiting">{t('Needs approval')}</span> : <span className={`due ${stCls(tk) === 'waiting' || stCls(tk) === 'doing' ? stCls(tk) : ''}`}>{stLabel(tk)}</span>}
            {d && tk.due && <span className={`due ${d.cls}`}>{dueText(d.cls, tk.due)}</span>}
            {tk.source === 'request' && <span className="src">{t('from {name}', { name: nameOf(tk.requestedBy ?? '').split(' ')[0] })}</span>}
          </div>
        </div>
        {doers.length > 0 && <span className="av-stack">{doers.slice(0, 3).map((id) => <span key={id}>{avatarOf(id, 24)}</span>)}</span>}
      </div>
    );
  };
  const empty = (art: React.ReactNode, title: string, subText: string) => (
    <EmptyState
      icon={art}
      title={title}
      text={subText}
    />
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
    const first = person.name.split(' ')[0];
    // Indonesian says pagi until 11, siang until 15, sore until 18, malam after (the same keys as Home).
    const greet = hour < 11 ? t('Good morning, {name}.', { name: first }) : hour < 15 ? t('Good afternoon, {name}.', { name: first }) : hour < 18 ? t('Good evening, {name}.', { name: first }) : tx('after 6 pm', 'Good evening, {name}.', { name: first });
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
    const quotesToAnswer = (p.quotes ?? []).filter((q) => q.clientId === client.id && q.status === 'sent');
    const needs = [...quotesToAnswer.map((q) => ({ task: undefined as Todo | undefined, text: t('Answer the quote “{title}”', { title: q.title }), go: () => setMode('work') })), ...approvals.map((tk) => ({ task: tk as Todo | undefined, text: t('Approve “{title}”', { title: tk.title }), go: () => (setMode('work'), setOpenTask(tk.id)) })), ...waitingOnMe.map((tk) => ({ task: tk as Todo | undefined, text: t('Your request “{title}” is waiting on you', { title: tk.title }), go: () => (setMode('requests'), setOpenTask(tk.id)) }))];
    content = (
      <section className="home-pane view-enter">
        <div className="home-scroll">
          <header className="home-head">
            <div className="home-head-text">
              <p className="home-date">{fmtWeekdayLong(new Date())}</p>
              <h1>{greet}</h1>
            </div>
          </header>
          <div className="home-grid cards">
            {card(
              'needs',
              <Clock size={15} />,
              t('Needs you'),
              needs.length ? (
                <ul className="home-list">
                  {needs.map((n, i) => (
                    <li key={n.task?.id ?? 'q' + i}>
                      <button className="home-notice" onClick={n.go}>
                        <span>{n.text}</span>
                        <time>{n.task?.due ? fmtDay(n.task.due) : ''}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact text={t('Nothing waiting on you. 🎉')} />
              ),
            )}
            {access.requests &&
              card(
                'requests',
                <Inbox size={15} />,
                t('Your requests'),
                requests.filter((tk) => !tk.done).length ? (
                  <ul className="home-list">
                    {requests
                      .filter((tk) => !tk.done)
                      .slice(0, 5)
                      .map((tk) => (
                        <li key={tk.id}>
                          <button className="home-notice" onClick={() => (setMode('requests'), setOpenTask(tk.id))}>
                            <span>{tk.title}</span>
                            <span className={`req-status ${requestStatus(tk).cls}`}>{t(requestStatus(tk).label)}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <EmptyState compact text={t('Need something? Send a request and the team picks it up.')} />
                ),
                can(person, 'request') ? [t('New request'), () => (setMode('requests'), setNewRequest(true))] : undefined,
              )}
            {card(
              'work',
              <FileText size={15} />,
              t('Work in progress'),
              briefs.length ? (
                <ul className="home-list">
                  {briefs.map((b) => {
                    const all = v.tasks.filter((tk) => tk.briefId === b.id); // shared tasks only
                    const done = all.filter((tk) => tk.done).length;
                    return (
                      <li key={b.id}>
                        <button className="home-brief" onClick={() => go('work', `brief:${b.id}`)}>
                          <strong>{b.title}</strong>
                          <span className="hb-progress">
                            <span className="bar wide">
                              <span style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
                            </span>
                            {done}/{all.length}
                            {b.due ? ` · ${t('due {date}', { date: fmtDay(b.due) })}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState compact text={t('The team shares briefs here as work starts.')} />
              ),
              [t('Work'), () => go('work')],
            )}
            {card(
              'meeting',
              <Video size={15} />,
              t('Latest meeting'),
              v.meetings.length ? (
                (() => {
                  const { meeting: m, notes } = v.meetings.slice().sort((a, b) => b.meeting.at.localeCompare(a.meeting.at))[0];
                  return (
                    <button className="home-meeting" onClick={() => go('meet', m.id)}>
                      <strong>{m.title}</strong>
                      <small>
                        {fmtDay(m.at)} · {tn(m.minutes, '{n} min', '{n} min')}
                      </small>
                      {notes && <p>{m.summary}</p>}
                    </button>
                  );
                })()
              ) : (
                <EmptyState compact text={t('No meetings yet.')} />
              ),
              v.meetings.length ? [t('Meetings'), () => go('meet')] : undefined,
            )}
            {card(
              'files',
              <HardDrive size={15} />,
              t('Recent files'),
              v.files.length ? (
                <ul className="home-list">
                  {v.files
                    .slice()
                    .sort((a, b) => b.modified.localeCompare(a.modified))
                    .slice(0, 4)
                    .map((f) => (
                      <li key={f.id}>
                        <a className="home-notice" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => !f.url && (e.preventDefault(), say(t('This is a demo file without content.')))}>
                          <span>{f.name}</span>
                          <time>{relative(f.modified)}</time>
                        </a>
                      </li>
                    ))}
                </ul>
              ) : (
                <EmptyState compact text={t('Nothing shared yet.')} />
              ),
              [t('Files'), () => go('files')],
            )}
            {card(
              'news',
              <Bell size={15} />,
              t('From the team'),
              p.notices.length ? (
                <ul className="home-list">
                  {p.notices.slice(0, 4).map((n) => (
                    <li key={n.id}>
                      <button className="home-notice" onClick={() => n.link?.id && (setMode(n.link.app === 'chat' ? 'chat' : 'requests'), setOpenTask(n.link.id))}>
                        <span>{textOf(n)}</span>
                        <time>{relative(n.at)}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact text={t('You’re all caught up.')} />
              ),
            )}
          </div>
          {!access.hideBranding && !product.white && (
            <p className="client-made">{tj('Made with {logo} sprint2go', { logo: <Logo size={12} /> })}</p>
          )}
        </div>
      </section>
    );
  }

  if (mode === 'requests') {
    const list = requests.filter((tk) => (sub === 'done' ? tk.done : sub === 'waiting' ? requestStatus(tk).cls === 'waiting' : sub === 'all' ? true : !tk.done));
    content = pane(
      sub === 'done' ? t('Done') : sub === 'waiting' ? t('Waiting on you') : sub === 'all' ? t('All requests') : t('Requests'),
      waitingOnMe.length ? tn(waitingOnMe.length, '{n} waiting on you', '{n} waiting on you') : t('The team picks these up like tickets'),
      list.length ? <div className="todo-group">{list.map(taskRow)}</div> : empty(<Inbox size={22} />, t('No requests here'), can(person, 'request') ? t('Send one with “New request”.') : t('Your colleagues’ requests show up here.')),
      can(person, 'request') && mobile ? (
        <button className="primary-btn sm" onClick={() => setNewRequest(true)}>
          <Plus size={14} /> {t('New')}
        </button>
      ) : undefined,
    );
  }

  if (mode === 'work') {
    const brief = sub.startsWith('brief:') ? briefs.find((b) => `brief:${b.id}` === sub) : undefined;
    const list = brief ? work.filter((tk) => tk.briefId === brief.id) : work.filter((tk) => (sub === 'approve' ? tk.approval?.status === 'waiting' : sub === 'done' ? tk.done : !tk.done));
    const groups = brief
      ? [{ key: brief.id, label: null as string | null, items: list }]
      : [...briefs.map((b) => ({ key: b.id, label: b.title, items: list.filter((tk) => tk.briefId === b.id) })), { key: 'other', label: briefs.length ? t('Other work') : null, items: list.filter((tk) => !tk.briefId || !briefs.some((b) => b.id === tk.briefId)) }].filter((g) => g.items.length);
    const progress = brief ? { done: list.filter((tk) => tk.done).length, total: list.length } : null;
    content = pane(
      brief ? brief.title : sub === 'approve' ? t('Needs approval') : sub === 'done' ? t('Done') : t('Work'),
      brief && progress
        ? brief.due
          ? t('Due {date} · {done} of {total} done', { date: fmtDay(brief.due), done: progress.done, total: progress.total })
          : t('{done} of {total} done', { done: progress.done, total: progress.total })
        : approvals.length
          ? tn(approvals.length, '{n} waiting for your approval', '{n} waiting for your approval')
          : t('Nothing waiting on you'),
      <>
        {!brief && !sub && p.quotes && p.onDecideQuote && <GuestQuotes quotes={p.quotes.filter((q) => q.clientId === client.id)} company={p.ws.name} canApprove={can(person, 'approve') && client.status !== 'ended'} onDecide={p.onDecideQuote} />}
        {brief?.context && <p className="client-brief-context">{brief.context}</p>}
        {groups.length
          ? groups.map((g) => (
              <div key={g.key} className="todo-group">
                {g.label && <div className="d-heading">{g.label}</div>}
                {g.items.map(taskRow)}
              </div>
            ))
          : empty(<ListChecks size={22} />, t('Nothing here yet'), t('The team shares tasks and briefs with you as work moves.'))}
      </>,
    );
  }

  if (mode === 'tables') {
    const tb = sharedTables.find((x) => x.id === sub) ?? sharedTables[0];
    if (tb) {
      const editable = can(person, 'comment') && client.status !== 'ended';
      content = (
        <TableScreen
          key={tb.id}
          table={tb}
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
          toast={(x) => say(t(x.text))}
          channels={[]}
          isAdmin={false}
          serverOn={server.on}
          onCompose={() => {}}
          guest={{ canEdit: (id) => editable && (tb.share?.edit ?? []).includes(id), add: editable && !!tb.share?.add, download: !!tb.share?.download }}
        />
      );
    }
  }

  if (mode === 'files') {
    const chan = sub.startsWith('chan:') ? v.channels.find((c) => `chan:${c.id}` === sub) : undefined;
    if (chan) {
      const msgs = p.messages.filter((m) => m.channelId === chan.id);
      const links = msgs.flatMap((m) => (m.text.match(/https?:\/\/[^\s)]+/g) ?? []).map((url) => ({ url, who: m.guestEmail ? nameOf(m.guestEmail) : nameOf(m.userId), at: m.at })));
      const chatFiles = msgs.flatMap((m) => (m.files ?? []).map((f) => ({ key: `file:${m.id}:${f.name}`, name: f.name, type: f.type, size: f.size, url: f.url, who: m.guestEmail ? nameOf(m.guestEmail) : nameOf(m.userId), at: m.at, where: t('in chat') })));
      content = pane(
        chan.name,
        t('Files, links and docs in this channel'),
        <ChannelMaterials channel={chan} users={shownTeam} me={person.email} chatFiles={chatFiles} chatLinks={links} onChannel={() => {}} readOnly />,
      );
    } else {
      const list = v.files.filter((f) => (sub === 'shared' ? !f.uploadedBy : sub === 'mine' ? !!f.uploadedBy : true)).sort((a, b) => b.modified.localeCompare(a.modified));
      content = pane(
        sub === 'shared' ? t('Shared with you') : sub === 'mine' ? t('From {company}', { company: fromWho }) : t('Files'),
        access.uploads ? t('Uploads go to “From {company}”', { company: fromWho }) : t('What the team shares with you'),
        list.length ? (
          <div className="todo-group">
            {list.map((f) => (
              <FileRow key={f.id} f={f} by={f.uploadedBy ? nameOf(f.uploadedBy) : ws.name} say={say} />
            ))}
          </div>
        ) : (
          empty(<HardDrive size={22} />, t('No files yet'), sub === 'mine' ? t('Upload files for the team here.') : t('{company} shares files with you here.', { company: ws.name }))
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
        `${fmtDay(sel.meeting.at)} · ${tn(sel.meeting.minutes, '{n} min', '{n} min')} · ${sel.meeting.attendees.join(', ')}`,
        <MeetingNotes m={sel.meeting} notes={sel.notes} recording={access.recordings} />,
      )
    ) : (
      pane(t('Meetings'), t('Notes from meetings you were in'), empty(<Video size={22} />, t('No meetings yet'), t('Notes appear here after you meet with the team.')))
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
          onBack={mobile && v.channels.length > 1 ? () => setChanId(null) : undefined}
          guest={{ canPost: can(person, 'comment') }}
        />
      ) : (
        pane(t('Chat'), '', empty(<MessagesSquare size={22} />, t('No conversations yet'), t('{company} will add you to a channel.', { company: ws.name })))
      );
  }

  /* ---------------- the shell ---------------- */
  return (
    <div className={`app client-app mode-${mode === 'work' ? 'tasks' : mode === 'files' ? 'drive' : mode} ${hasSidebar ? '' : 'no-sidebar'}`}>
      <nav className="rail" aria-label={t('Portal')}>
        <div className="rail-ws">
          {p.switcher ?? (
            <span className="client-ws" title={t('{company} for {project}', { company: ws.name, project: client.name })}>
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
            <button className={`rail-tool ai ${askOpen ? 'on' : ''}`} onClick={() => setAskOpen((o) => !o)} title={t('Ask AI')}>
              <Sparkles size={18} />
            </button>
          )}
          <div className="rail-notices">
            <button className={`rail-tool ${noticesOpen ? 'on' : ''}`} onClick={() => (setNoticesOpen((o) => !o), p.onReadNotices())} title={t('Notifications')}>
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
          <div className="sb-resize" onPointerDown={startResize} onDoubleClick={() => setSbW(248)} title={t('Drag to resize · double-click to reset')} />
        </aside>
      )}

      <main className="main" key={mode}>
        {client.status === 'ended' && (
          <div className="ended-banner">
            {client.endedAt
              ? t('Your work with {company} ended on {date}. You can still read everything and download files.', { company: ws.name, date: fmtDayLong(client.endedAt) })
              : t('Your work with {company} ended. You can still read everything and download files.', { company: ws.name })}
          </div>
        )}
        {mobile && (
          <MobileTop
            title={title}
            menu={
              mode === 'work'
                ? { value: sub, label: t('Which work'), onChange: setSub, options: [{ value: '', label: t('Work') }, { value: 'approve', label: t('Needs approval') }, { value: 'done', label: t('Done') }, ...briefs.map((b) => ({ value: `brief:${b.id}`, label: b.title, group: t('Briefs') }))] }
                : mode === 'files'
                  ? { value: sub, label: t('Which files'), onChange: setSub, options: [{ value: '', label: t('Files') }, { value: 'shared', label: t('Shared with you') }, { value: 'mine', label: t('From {company}', { company: fromWho }) }, ...v.channels.map((c) => ({ value: `chan:${c.id}`, label: c.name, group: t('Channel materials') }))] }
                  : mode === 'requests'
                    ? { value: sub, label: t('Which requests'), onChange: setSub, options: [{ value: '', label: t('Requests') }, { value: 'waiting', label: t('Waiting on you') }, { value: 'done', label: t('Done') }, { value: 'all', label: t('All requests') }] }
                    : mode === 'meet' && v.meetings.length
                      ? { value: sub || v.meetings[0].meeting.id, label: t('Which meeting'), onChange: setSub, options: v.meetings.map((x) => ({ value: x.meeting.id, label: x.meeting.title })) }
                      : undefined
            }
            workspaces={p.mobileSwitch?.workspaces ?? []}
            current={ws}
            unread={unread}
            onWorkspace={p.mobileSwitch?.onWorkspace ?? (() => {})}
            portals={p.mobileSwitch?.portals}
            currentPortal={p.mobileSwitch?.current}
            onPortal={p.mobileSwitch?.onPortal}
            onShared={p.mobileSwitch?.onShared}
            onAddWorkspace={p.mobileSwitch?.onAdd}
            onSearch={() => (access.ai ? setAskOpen(true) : go('home'))}
            onBell={() => (setNoticesOpen(true), p.onReadNotices())}
            account={
              <button type="button" className="icon-btn mt-account" onClick={() => setMeOpen(true)} aria-label={t('Your account')}>
                <Avatar person={{ name: p.account?.me.name ?? person.name, email: person.email, color: p.account?.me.color ?? client.color }} size={28} />
              </button>
            }
          />
        )}
        {content}
      </main>

      {mobile && (
        <>
          <nav className="tabbar guest-bar" aria-label={client.name}>
            {(() => {
              const at = barItems.findIndex(([id]) => id === mode);
              const more = !barFits && (meOpen || barMore.some(([id]) => id === mode));
              const tabs = barItems.length + (barFits ? 0 : 1);
              return (
                <div className="tabbar-tabs" style={{ '--tabs': tabs, '--at': more ? barItems.length : at } as CSSProperties}>
                  <span className={`tabbar-ink${at < 0 && !more ? ' off' : ''}`} aria-hidden="true">
                    <i />
                  </span>
                  {barItems.map(([id, label, Icon, n]) => (
                    <button key={id} type="button" className={mode === id ? 'on' : ''} aria-current={mode === id ? 'page' : undefined} onClick={() => (id === 'work' && mode !== 'work' && approvals.length ? go('work', 'approve') : go(id))}>
                      <span className="tab-icon">
                        <Icon size={24} strokeWidth={mode === id ? 2.25 : 1.75} />
                        {n ? <i aria-label={tn(n, '{n} waiting', '{n} waiting')}>{n > 99 ? '99+' : n}</i> : null}
                      </span>
                      <span className="tab-label" title={label}>
                        {label}
                      </span>
                    </button>
                  ))}
                  {!barFits && (
                    <button type="button" className={more ? 'on' : ''} onClick={() => setMeOpen(true)} aria-haspopup="dialog">
                      <span className="tab-icon">
                        <MenuIcon size={24} strokeWidth={more ? 2.25 : 1.75} />
                      </span>
                      <span className="tab-label">{t('More')}</span>
                    </button>
                  )}
                </div>
              );
            })()}
            {uploader.input}
          </nav>
          <CreateFab create={create} />
        </>
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
            say(t('Request sent. The team has been told.'));
          }}
        />
      )}
      {askOpen && (
        <Assistant
          scope={{ kind: 'all' }}
          setScope={() => {}}
          scopeOptions={[{ value: 'all', label: t('What {company} shared with {project}', { company: ws.name, project: client.name }) }]}
          chats={askChats}
          setChats={setAskChats}
          ask={(q) => actions.ask(q)}
          citeLabel={() => t('source')}
          onCite={() => {}}
          live
          onClose={() => setAskOpen(false)}
        />
      )}
      <Popover anchor={meBtn} open={meOpen} onClose={() => setMeOpen(false)} width={300} title={t('Account')}>
        <PersonMenu p={p} close={() => setMeOpen(false)} mobileModes={mobile ? barMore : []} go={go} say={say} onProfile={() => setProfileOpen(true)} />
      </Popover>
      {profileOpen && p.account && <ProfileDialog me={p.account.me} email={person.email} onSave={(patch) => (p.account!.onProfile(patch), say(t('Profile saved')))} onClose={() => setProfileOpen(false)} />}
      {p.preview && (
        <div className="view-as-pill">
          <Eye size={14} />
          <span>{tj('Viewing as {name}', { name: <b>{person.name}</b> })}</span>
          {p.preview.people.length > 1 && (
            <Select<string> value={person.email} onChange={(v) => p.preview!.onSwitch(v)} label={t('Switch person')} className="sel-flat" options={p.preview.people.map((x) => ({ value: x.email, label: x.name, hint: t(ROLE[x.role]) }))} />
          )}
          <button className="primary-btn sm" onClick={p.preview.onExit}>
            {t('Exit')}
          </button>
        </div>
      )}
      {toast && <div className="toast client-toast">{toast}</div>}
    </div>
  );
}

/* ---------------- pieces ---------------- */

/** A hidden file field and a way to open it: the sidebar's Upload button and the phone's create button share it. */
function useUploader(actions: ClientActions, say: (text: string) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
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
        say(big ? tn(done.length, '{n} file uploaded. Files over 8 MB: share a link instead.', '{n} files uploaded. Files over 8 MB: share a link instead.') : tn(done.length, '{n} file uploaded.', '{n} files uploaded.'));
      }}
    />
  );
  return { input, pick: () => ref.current?.click() };
}

function UploadButton({ actions, say, compact }: { actions: ClientActions; say: (text: string) => void; compact?: boolean }) {
  const up = useUploader(actions, say);
  return (
    <>
      <button className={compact ? 'primary-btn sm' : 'compose-btn'} onClick={up.pick}>
        <Upload size={16} />
        <span className="sb-label">{t('Upload')}</span>
      </button>
      {up.input}
    </>
  );
}

function FileRow({ f, by, say }: { f: DriveItem; by: string; say: (text: string) => void }) {
  return (
    <a className="task file-task" href={f.url} target="_blank" rel="noreferrer" download={f.url ? f.name : undefined} onClick={(e) => !f.url && (e.preventDefault(), say(t('This is a demo file without content.')))}>
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
      {recording !== 'off' && m.recording?.url && (
        <div className="client-recording">
          {recording === 'video' && m.recording.videoUrl ? (
            <video className="client-video" src={m.recording.videoUrl} controls preload="metadata" playsInline />
          ) : (
            <>
              <span className="client-rec-label">
                <Video size={16} /> {tx('noun', 'Recording')}
              </span>
              <audio src={m.recording.url} controls preload="metadata" />
            </>
          )}
        </div>
      )}
      {notes ? (
        <>
          <div className="side-card">
            <h3>{t('Summary')}</h3>
            <p>{m.summary}</p>
          </div>
          {!!m.decisions?.length && (
            <div className="side-card">
              <h3>{t('Decisions')}</h3>
              <ul>{m.decisions.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {!!m.keyPoints?.length && (
            <div className="side-card">
              <h3>{t('Key points')}</h3>
              <ul>{m.keyPoints.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {m.actions.length > 0 && (
            <div className="side-card">
              <h3>{t('Next steps')}</h3>
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
        <EmptyState compact text={t('The team hasn’t shared notes for this meeting.')} />
      )}
    </div>
  );
}

/** A task, brief or request, opened in the same side panel the team uses. */
function TaskPanel({
  t: task,
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
  stLabel: (task: Todo) => string;
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
  const doers = [...new Set(task.assignees?.length ? task.assignees : task.userId ? [task.userId] : [])];
  const history = (task.history ?? []).filter((h) => h.toClient || h.by.includes('@') || (h.kind === 'created' && task.source === 'request'));
  // Files on their comment, where the project lets them add files (uploads count toward the company's storage).
  const att = useCommentFiles(actions.workspaceId);
  const attach = actions.canAttach();
  const canSend = (!!comment.trim() || att.files.length > 0) && !att.busy;
  const send = () => {
    if (!canSend) return;
    actions.comment(task.id, comment.trim(), att.files.length ? att.files : undefined);
    setComment('');
    att.clear();
  };
  const ap = task.approval;
  const apBy = nameOf(ap?.by ?? '');
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label={task.title}>
        <header className="drawer-head">
          {isBrief(task) ? (
            <span className="brief-badge">
              <FileText size={12} /> {t('Brief')}
            </span>
          ) : (
            <span className="drawer-kind">{task.source === 'request' ? t('Request') : t('Task')}</span>
          )}
          <span className="spacer" />
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <h2 className="client-title">{task.title}</h2>

          <SmoothHeight>
          {ap?.status === 'waiting' && (
            <div className="review-banner">
              <span>
                <strong>{t('Waiting for your approval')}</strong>
                <small>{can(person, 'approve') ? t('Approve it, or tell the team what to change.') : t('Only approvers at {company} can approve. You can still comment.', { company: clientName })}</small>
              </span>
              {can(person, 'approve') && changes === null && (
                <span className="rb-actions">
                  <button className="ghost-btn sm" onClick={() => setChanges('')}>
                    <RotateCcw size={13} /> {t('Ask for changes')}
                  </button>
                  <button className="primary-btn sm" onClick={() => actions.decide(task.id, 'approved', '')}>
                    <CheckCircle2 size={14} /> {t('Approve')}
                  </button>
                </span>
              )}
            </div>
          )}
          </SmoothHeight>
          <SmoothHeight>
          {changes !== null && (
            <div className="comment-box to-client">
              <textarea autoFocus rows={3} value={changes} onChange={(e) => setChanges(e.target.value)} placeholder={t('What should change?')} />
              <div className="cb-foot">
                <button className="ghost-btn sm" onClick={() => setChanges(null)}>
                  {t('Cancel')}
                </button>
                <button className="primary-btn sm" disabled={!changes.trim()} onClick={() => (actions.decide(task.id, 'changes', changes.trim()), setChanges(null))}>
                  {t('Send changes')}
                </button>
              </div>
            </div>
          )}
          </SmoothHeight>
          {ap && ap.status !== 'waiting' && (
            <p className={`ap-tag ${ap.status}`}>
              {ap.status === 'approved'
                ? ap.note
                  ? t('Approved by {name}: “{note}”', { name: apBy, note: ap.note })
                  : t('Approved by {name}', { name: apBy })
                : ap.note
                  ? t('Changes asked by {name}: “{note}”', { name: apBy, note: ap.note })
                  : t('Changes asked by {name}', { name: apBy })}
            </p>
          )}

          <dl className="fields">
            <dt>{t('Status')}</dt>
            <dd>
              <span className={`st-dot st-${stCls(task)}`} /> {stLabel(task)}
            </dd>
            {doers.length > 0 && (
              <>
                <dt>{isBrief(task) ? t('In charge') : t('Doing it')}</dt>
                <dd className="client-doers">
                  {doers.map((id) => (
                    <span key={id}>
                      {avatarOf(id, 22)} {nameOf(id)}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {task.due && (
              <>
                <dt>{task.source === 'request' ? t('Needed by') : t('Due')}</dt>
                <dd>{fmtDay(task.due)}</dd>
              </>
            )}
            {task.source === 'request' && (
              <>
                <dt>{t('Sent by')}</dt>
                <dd>
                  {nameOf(task.requestedBy ?? '')} · {relative(task.createdAt)}
                </dd>
              </>
            )}
          </dl>

          {isBrief(task) && task.context && (
            <>
              <label className="drawer-label">{t('Context')}</label>
              <p className="client-brief-context">{task.context}</p>
            </>
          )}
          {subs.length > 0 && (
            <>
              <label className="drawer-label">{t('Tasks in this brief')}</label>
              <div className="sub-list">
                {subs.map((s) => (
                  <div key={s.id} className={`sub ${s.done ? 'done' : ''}`}>
                    <span className={`st-dot st-${stCls(s)}`} />
                    <button className="sub-title" onClick={() => onOpen(s.id)}>
                      {s.title}
                    </button>
                    <span className="muted small">{stLabel(s)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <label className="drawer-label">{t('Conversation')}</label>
          <ol className="history">
            {history.map((h) => (
              <li key={h.id} className={`h-${h.kind}`}>
                {avatarOf(h.by, 22)}
                <span className="h-body">
                  {h.kind === 'comment' ? (
                    <>
                      <b>{h.by.toLowerCase() === person.email.toLowerCase() ? t('You') : nameOf(h.by)}</b>
                      {h.text && <span className="h-comment">{h.text}</span>}
                      <FileCards files={h.files} />
                    </>
                  ) : (
                    <span>
                      {/* What happened: in the reader's words when it was saved with msg() (clientActions), else as saved. */}
                      <b>{h.by.toLowerCase() === person.email.toLowerCase() ? t('You') : nameOf(h.by)}</b> {textOf(h as { text: string; tr?: Msg })}
                    </span>
                  )}
                  <time>{relative(h.at)}</time>
                </span>
              </li>
            ))}
            {!history.length && <li className="muted small">{t('No messages yet.')}</li>}
          </ol>
          {can(person, 'comment') && (
            <div className="comment-box" {...(attach ? dropFiles(att) : {})}>
              {attach && <WaitingFiles state={att} />}
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} placeholder={t('Write to the team…')} />
              <div className="cb-foot">
                {attach && <AttachButton state={att} phone={mobilePhone()} className="icon-btn sm" />}
                <button className="primary-btn sm" disabled={!canSend} onClick={send}>
                  {t('Send')}
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
      <div className="modal request-modal" role="dialog" aria-label={t('New request')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Inbox size={15} /> {t('New request')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body request-body">
          <SmoothHeight>
          <label className="field">
            <span>{t('What do you need?')}</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. A new banner for the Ramadan promo')} />
          </label>
          <label className="field">
            <span>{t('Details')}</span>
            <textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t('Sizes, wording, examples you like, anything that helps')} />
          </label>
          <div className="request-row">
            <div className="field">
              <span>{t('Needed by (optional)')}</span>
              <DatePicker value={due} onChange={setDue} label={t('Needed by')} placeholder={t('No date')} />
            </div>
            <div className="field">
              <span>{t('Files')}</span>
              <button className="ghost-btn sm" onClick={() => ref.current?.click()}>
                <Paperclip size={14} /> {t('Attach')}
              </button>
            </div>
          </div>
          {files.length > 0 && (
            <div className="request-files">
              {files.map((f) => (
                <span key={f.name} className="chip">
                  {f.name}
                  <button aria-label={t('Remove')} onClick={() => setFiles(files.filter((x) => x !== f))}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input ref={ref} type="file" multiple hidden onChange={(e) => (setFiles([...files, ...(e.target.files ?? [])]), (e.target.value = ''))} />
          <p className="muted small">{t('The team gets this straight away. You’ll see when they pick it up, and you can talk about it on the request.')}</p>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!title.trim()} onClick={() => onSend({ title, details, due: due || undefined, files })}>
            {t('Send request')}
          </button>
        </footer>
      </div>
    </div>
  );
}

function PersonMenu({ p, close, mobileModes, go, say, onProfile }: { p: Props; close: () => void; mobileModes: [Mode, string, LucideIcon, number?][]; go: (m: Mode) => void; say: (text: string) => void; onProfile: () => void }) {
  const { person, access, ws, account } = p;
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ text: string; link?: string | null } | null>(null);
  const me = account?.me;
  const company = companyOf(person.email, person.company, p.client);
  // Guests have no Settings: their language is picked here, like Settings, Account (their pick, else what's showing).
  const lang = useLang();
  const shownLang = account?.language ?? lang;
  return (
    <div className="sel-pop guest-menu">
      <div className="am-head">
        <Avatar person={{ name: me?.name ?? person.name, email: person.email, color: me?.color ?? p.client.color }} size={42} />
        <div>
          <strong>{me?.name ?? person.name}</strong>
          <small>{person.email}</small>
          <small>
            {t(ROLE[person.role])}
            {company ? ` · ${company}` : ''}
          </small>
        </div>
      </div>
      {account && (
        <div className="am-theme segmented wide">
          {(
            [
              ['light', Sun, t('Light')],
              ['dark', Moon, t('Dark')],
              ['system', Monitor, t('Auto')],
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} className={account.theme === id ? 'on' : ''} onClick={() => account.onTheme(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}
      {account?.onLanguage && (
        <div className="am-lang segmented wide" role="group" aria-label={t('Language')}>
          {LANGS.map((l) => (
            <button key={l.id} type="button" lang={l.id} className={shownLang === l.id ? 'on' : ''} aria-pressed={shownLang === l.id} onClick={() => account.onLanguage?.(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      )}
      {account && (
        <button className="am-item" onClick={() => (close(), onProfile())}>
          <UserRound size={16} /> {t('Your profile and password')}
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
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Their name')} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('name@{domain}', { domain: person.email.split('@')[1] ?? 'company.com' })} />
            {msg && (
              <p className="small">
                {msg.text}{' '}
                {msg.link && (
                  <button className="link-btn" onClick={() => void navigator.clipboard?.writeText(msg.link!).then(() => say(t('Invite link copied')))}>
                    {t('Copy link')}
                  </button>
                )}
              </p>
            )}
            <div className="ci-actions">
              <button className="ghost-btn sm" onClick={() => (setInviting(false), setMsg(null))}>
                {t('Cancel')}
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
                {access.invites === 'approve' ? t('Ask to add them') : t('Invite')}
              </button>
            </div>
          </div>
        ) : (
          <button className="am-item" onClick={() => setInviting(true)}>
            <UserPlus size={16} /> {t('Invite a colleague')}
          </button>
        ))}
      <div className="am-sep" />
      {(p.onSignOut ?? p.preview?.onExit) && (
        <button className="am-item danger" onClick={() => (close(), (p.onSignOut ?? p.preview!.onExit)())}>
          <LogOut size={16} /> {p.onSignOut ? t('Sign out') : t('Exit {who} view', { who: term.who })}
        </button>
      )}
      <p className="muted small menu-note">{t('You see what {company} shares with you. Need something? Use Requests or Chat.', { company: ws.name })}</p>
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
      <div className="modal profile-modal" role="dialog" aria-label={t('Your profile')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <UserRound size={15} /> {t('Your profile')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
          <PhotoPicker name={name || me.name} email={email} color={color} photo={photo} onChange={setPhoto} />
          {!photo && (
            <div className="avatar-colors">
              <small>{t('Or a colour')}</small>
              <div>
                {ACCENTS.map((c) => (
                  <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={t('Colour {color}', { color: c })} />
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>{t('Name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>{t('Job title')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Marketing lead')} />
          </div>
          <div className="field">
            <label>{t('Email')}</label>
            <input value={email} readOnly />
            <small>{t('You sign in with this address. The same sign-in works for everything shared with you.')}</small>
          </div>
          <PasswordRow />
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!name.trim()} onClick={() => (onSave({ name: name.trim(), title: title.trim(), color, photo }), onClose())}>
            {t('Save')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export type { Channel };
