import { TabDefaultsCtx } from './components/ui/TabBar';
import { Assistant, BlockDialog, BrainDump, CalendarView, ClientApp, ConnectCalendar, DriveView, EndClientDialog, EventEditor, MeetSidebar, MeetView, NewTeamDialog, NoteEditor, NotesList, Onboarding, SendBotDialog, SettingsPage, ShareDialog, SharedHome, SharedPage, TableScreen, TeamPage, TeamsHome, TeamsSidebar, TemplateDialog, TrackingDashboard, VaultSidebar, VaultView } from './lazy';
import { NewTableDialog, TablesHome, TablesSidebar, makeTable } from './components/tables/TablesApp';
import type { TeamActions } from './components/teams/TeamsApp';
import type { TemplateId } from './components/tables/fields';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { term, setTermWord, brand as product, setBrandName, brandOf, portalOrigin } from './terms';
import { setPhotos } from './photos';
import { TempAddressDialog, lifeLeft } from './components/TempAddress';
import { AppSetupCard } from './components/AppSetupCard';
import { ProjectsCtx } from './components/ProjectPicker';
import { ProjectsSidebar } from './components/ProjectsSidebar';
import { ProjectsHome } from './components/ProjectsHome';
import { Popover } from './components/ui/Popover';
import { Brain, Briefcase, Building2, CalendarPlus, Copy, FileText, Hash, ListChecks, Mail, PenLine, Send, Sparkles, Timer, Trash2, Undo2, Upload, User as UserIcon, Video, Table2, MessagesSquare, AlertTriangle, Menu } from 'lucide-react';
import { DEFAULT_PERMISSIONS } from './types';
import type { Quote, Team, Note, Account, AppId, Attachment, BlockRule, CalEvent, Channel, ChannelCategory, Client, ClientPerson, ChatFile, ChatMessage, Meeting, Message, Notice, RsvpStatus, TaskEvent, TaskStatus, Todo, DriveItem, DriveSection, FolderId, Location, Person, Thread, User, View, Workspace } from './types';
import { LABELS } from './data/mock';
import { CALENDARS, externalEvents } from './data/calendar';
import { JOBS, costPer100 } from './data/aiCatalog';
import { rp, storageGB } from './data/pricing';
import { MAIL_USAGE, QUOTA, fmtSize, kindOf, parseSize } from './data/drive';
import { fmtTime } from './calendarUtils';
import { lastMessage, uid, localDay, nextDue, addWorkdays } from './utils';
import { templatesFor, type TaskTemplate } from './data/templates';
import type { NotesFilter } from './components/NotesApp';
import type { VaultItem } from './components/VaultApp';
import { eventsOn } from './calendarUtils';
import { botJoins, callKey, meetingLinkOf, notetakerJoins, MEETING_NAME } from './meetingLinks';
import { setHolidayDays } from './holidayDays';
import { holidayCalendarId, holidayCountry } from './data/holidays';
import { useSettings, usePersisted, usePrefsSync } from './settings';
import { DEFAULT_TRACK_OPTIONS, REPLY_TRACK_OPTIONS, isTeam } from './tracking';
import { isMine, setIdentity } from './identity';
import { scanned, session, useStored } from './store';
import { live, reloadAll, resync, server, uploadFile, uploadPolicy, wasSkipped } from './sync';
import { isSandbox, isSandboxId, sandboxWsId, type TryKey } from './sandbox';
import { DemoCompanyBar, DemoInvite, ResetDemoDialog, TryList, demoCompanySeen, hideDemoCompany, openDemoCompany, resetDemoCompany, useDemoState } from './components/DemoCompany';
import { InviteCard, type InviteState } from './components/InviteCard';
import { OutOfOffice } from './components/OutOfOffice';
import { caps } from './caps';
import { EmailDeliverySection } from './components/admin/EmailDelivery';
import { ai, aiLive } from './ai';
import type { AskChat } from './components/Assistant';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { InviteMember, NewAccount, RemoveMailbox } from './components/WorkspaceForms';
import { applyBranding } from './components/WorkspaceLogo';
import { Sidebar, SIDEBAR_MAX, SIDEBAR_MIN, type Mode } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { Reader } from './components/Reader';
import { Compose, type Outgoing } from './components/Compose';
import type { CalView } from './components/CalendarView';
import { CalendarSidebar } from './components/CalendarSidebar';
import { AccountMenu, type SettingsSection } from './components/AccountMenu';
import { DriveSidebar } from './components/DriveSidebar';
import { DrivePreview } from './components/DrivePreview';
import { AppRail, APPS } from './components/AppRail';
import { AppSettingsButton, appSettingsLinks } from './components/AppSettings';
import { Avatar } from './components/Avatar';
import { Notifications } from './components/Notifications';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { HomeView } from './components/HomeView';
import { TaskDrawer } from './components/TaskDrawer';
import { TasksView, dueLabel, isBrief, type TaskScope } from './components/TasksView';
import { TasksSidebar } from './components/TasksSidebar';
import type { DumpResult } from './components/BrainDump';
import { ChatSidebar, ChatView, NewMessageSheet, fullLayout, sectionIdOf, sectionPeople, type Presence, type SendPayload } from './components/ChatApp';
import { ChannelDialog, CATEGORY_ONE } from './components/ChannelDialog';
import { MobileTop } from './components/MobileTop';
import { PushScreen } from './components/ui/PushScreen';
import { Sheet } from './components/ui/Sheet';
import { offerInstall } from './components/InstallPrompt';
import { BottomBar } from './mobile/BottomBar';
import { MoreSheet } from './mobile/MoreSheet';
import { duplicateOf } from './components/tasks/taskOps';
import { needsCount, needsYou } from './needsYou';
import { DEFAULT_BAR, MORE_ORDER, companyBar } from './mobile/BarDefaults';
import { useChrome, useFocusedScreen } from './mobile/chrome';
import { PHONE, TABLET, useMedia } from './mobile/media';
import { usePullToSearch } from './mobile/usePullToSearch';
import { useKeyboard } from './mobile/keyboard';
import { SEARCHABLE } from './components/CommandPalette';
import type { ToastMsg } from './toast';
import { clientActions } from './clientActions';
import { accessFor, afterEnd, clientInbox, clientPeople, portalsFor, requestStatus, teamLabel } from './clientView';
import { firstOf as firstStage, kindOf as stageKind, registerStages, stageIdFor, stageName, stageOf, stagesFor } from './stages';
import { celebrate } from './components/ui/confetti';
import type { AskScope, MeetPage } from './components/MeetApp';
import { DEFAULT_MEETINGS, trialPlan } from './data/workspaces';
import { DEMO_SCRIPT } from './data/team';
import { htmlToText, textToHtml } from './sanitize';
import { rowName } from './components/tables/core';
import { Huddle } from './components/Huddle';
import { usePushBridge } from './pushBridge';
import { routeBase } from './tryOut';

/** "today", "tomorrow", "in 3 days" read lower-case mid-sentence; dates keep their capitals. */
const dueWords = (d: string) => {
  const t = dueLabel(d).text;
  return /^[A-Z][a-z]{2},/.test(t) ? t : t.toLowerCase();
};

const FOLDER_TITLES: Record<FolderId, string> = {
  inbox: 'Inbox',
  starred: 'Starred',
  sent: 'Sent',
  drafts: 'Drafts',
  archive: 'Archive',
  spam: 'Spam',
  trash: 'Trash',
  snoozed: 'Snoozed',
  scheduled: 'Scheduled',
  assigned: 'Assigned to me',
};

const APP_IDS = APPS.map((a) => a.id) as string[];
// app.sprint2go.com/mail, /chat… on a real server; #/mail when opened as a local file.
const hashRouting = !location.protocol.startsWith('http');
function readRoute(): Mode {
  const raw = hashRouting ? location.hash.replace(/^#\/?/, '') : location.pathname.slice(routeBase.length).replace(/^\//, '');
  const first = raw.split('/')[0];
  return APP_IDS.includes(first) ? (first as AppId) : first === 'settings' ? 'settings' : 'home';
}
function writeRoute(m: Mode) {
  try {
    if (hashRouting) {
      if (location.hash !== `#/${m}`) history.replaceState(null, '', `#/${m}`);
    } else if (location.pathname !== `${routeBase}/${m}`) history.pushState(null, '', `${routeBase}/${m}`);
  } catch {
    /* some previews forbid history changes */
  }
}

const fromMe = (t: Thread) => t.messages.some((m) => isMine(m.from.email));

function inView(t: Thread, v: View, me = '') {
  if (v.kind === 'tracking' || v.kind === 'todos') return false;
  if (v.kind === 'label') return t.labels.includes(v.id) && t.location !== 'trash' && t.location !== 'spam';
  const snoozed = !!t.snoozedUntil && t.snoozedUntil > new Date().toISOString();
  switch (v.id) {
    case 'inbox':
      return t.location === 'inbox' && !snoozed;
    case 'snoozed':
      return snoozed && t.location !== 'trash';
    case 'scheduled':
      return !!t.sendAt;
    case 'assigned':
      return t.assignee === me && t.location !== 'trash';
    case 'drafts':
      return t.location === 'drafts' && !t.sendAt;
    case 'starred':
      return t.starred && t.location !== 'trash';
    case 'sent':
      return fromMe(t) && t.location !== 'trash' && t.location !== 'drafts';
    default:
      return t.location === v.id;
  }
}

/** Settings for one app, opened from the phone's title switcher: the same section, full screen over the app. */
function PushedSettings({ push, onBack, children }: { push: { label: string } | null; onBack: () => void; children: React.ReactNode }) {
  return push ? (
    <PushScreen title={push.label} onBack={onBack} className="settings-push">
      {children}
    </PushScreen>
  ) : (
    <>{children}</>
  );
}

type Toast = { id: number; text: string; action?: { label: string; run: () => void }; also?: { label: string; run: () => void }; ms?: number };
type ComposeState = { key: number; draftId?: string; initial?: Outgoing };

interface AppProps {
  user: User;
  signedInUsers: User[];
  allUsers: User[];
  workspaces: Workspace[];
  setWorkspaces: (fn: (w: Workspace[]) => Workspace[]) => void;
  onSwitchUser: (id: string) => void;
  onAddUser: () => void;
  onSignOut: () => void;
  onInvite: (u: User) => Promise<string | null>; // the invite link, when the local server makes one
  onWorkspace?: (id: string) => void;
  onUpdateUser: (patch: Partial<User>) => void;
  /** A bar on top of everything (the try-out's "You're trying sprint2go"). */
  topBar?: React.ReactNode;
}

export default function App({ user, signedInUsers, allUsers, workspaces: allWorkspaces, setWorkspaces, onSwitchUser, onAddUser, onSignOut, onInvite: inviteUser, onWorkspace, onUpdateUser, topBar }: AppProps) {
  const [settings, updateSettings] = useSettings(user);
  const [previewOnboarding, setPreviewOnboarding] = useState(() => new URLSearchParams(location.search).get('preview') === 'onboarding');
  setPhotos(allUsers); // every Avatar finds people's photos by email

  // Keep the user's profile in step with their settings.
  useEffect(() => {
    if (settings.name !== user.name || settings.title !== user.title || settings.avatarColor !== user.color)
      onUpdateUser({ name: settings.name, title: settings.title, color: settings.avatarColor });
  }, [settings.name, settings.title, settings.avatarColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Workspaces: one per business, each with its own brand and accounts.
  // A user only sees workspaces they're a member of, and only mailboxes they've been given.
  const workspaces = allWorkspaces.filter((w) => w.members.some((m) => m.userId === user.id));
  usePrefsSync(user.id); // settings, saved views and Ask AI chats follow this person between devices
  const [wsId, setWsId] = usePersisted(`pm-ws:${user.id}`, workspaces[0]?.id ?? '');
  const ws = workspaces.find((w) => w.id === wsId) ?? workspaces[0];
  session.wsId = ws?.id ?? '';
  // Their own demo company (src/sandbox.ts): everything in it behaves as the demo, and nothing in it leaves it.
  // `real`: what's on screen is real, so the server does the real thing (sending, the notetaker, calendar links).
  const inSandbox = isSandbox(ws);
  const real = server.on && !inSandbox;
  const demo = useDemoState(); // their demo company: allowed, and not made yet, open or hidden
  const [demoBusy, setDemoBusy] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [demoInviteOff, setDemoInviteOff] = usePersisted(`s2g-demo-invite-off:${user.id}`, false);
  // Looking at the demo company: it isn't unused (the server removes ones nobody opened for a month).
  useEffect(() => {
    if (inSandbox && server.on) demoCompanySeen();
  }, [inSandbox, ws.id]);
  // Uploads ask before big files (Settings, Storage); the demo has no server to ask, so it uses these.
  uploadPolicy.askOverMb = ws?.storage?.askOver ?? 500;
  uploadPolicy.storageTotal = ws ? storageGB(ws.plan ?? trialPlan(ws.name, ''), ws.members.length) * 1024 ** 3 : 0;
  setBrandName(brandOf(ws)); // white label: an agency's name in place of ours
  setTermWord(ws?.terms?.word); // "Projects" or "Clients", before anything below renders words
  registerStages(allWorkspaces, ws?.id); // each company's task stages, so every screen reads a task's stage from its company
  // Companies this person is a client of (same sign-in): their portals sit in the workspace switcher.
  const [portalKey, setPortalKey] = usePersisted(`s2g-portal:${user.id}`, '');
  useEffect(() => onWorkspace?.(portalKey && allWorkspaces.some((w) => portalKey.startsWith(w.id + ':')) ? portalKey.split(':')[0] : ws.id), [ws.id, ws.ai, portalKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Adds the person; with the local server, also makes a link where they set their password. */
  const onInvite = (u: User) =>
    void inviteUser(u).then(
      (link) =>
        link &&
        showToast({
          text: `${u.name.split(' ')[0]} can join with their invite link`,
          action: { label: 'Copy link', run: () => void navigator.clipboard?.writeText(link) },
          ms: 20000,
        }),
    );
  const role = ws.members.find((m) => m.userId === user.id)?.role ?? 'member';
  // Your personal mailbox first, then shared inboxes.
  const myAccounts = useMemo(
    () => ws.accounts.filter((a) => a.users.includes(user.id)).sort((a, b) => Number(a.kind === 'shared') - Number(b.kind === 'shared')),
    [ws.accounts, user.id],
  );
  // What really works (worked out on the server). The standalone demo, demo servers and the demo company have everything on.
  const demoOk = !server.on || caps.demo || inSandbox;
  const ready = ws.mailReady;
  const boxReady = (id: string): { receive: boolean; send: boolean; why?: string; sendWhy?: string } => (demoOk ? { receive: true, send: true } : ready?.mailboxes?.[id] ?? { receive: false, send: false, why: ready ? undefined : 'Checking your email setup…' });
  const mailIn = myAccounts.some((a) => boxReady(a.id).receive);
  const mailOut = myAccounts.some((a) => boxReady(a.id).send);
  const whyFor = (k: 'receive' | 'send') =>
    myAccounts
      .map((a) => boxReady(a.id))
      .filter((b) => !b[k])
      .map((b) => (k === 'send' ? (b.sendWhy ?? b.why) : b.why))
      .find(Boolean);
  const mailWhy = { receive: whyFor('receive') ?? ready?.why?.receive, send: whyFor('send') ?? ready?.why?.send };
  const sendable = myAccounts.filter((a) => boxReady(a.id).send);
  // AI: on when the company has it (included or its own key), or in a demo.
  const [aiOn, setAiOn] = useState(true);
  const [aiWhy, setAiWhy] = useState<'no-key' | 'down' | 'used-up' | null>(null); // why it's off: nothing set up, our AI is down, or the allowance is used up
  useEffect(() => {
    if (!server.on || inSandbox) return (setAiOn(true), setAiWhy(null)); // the demo company answers with samples
    let on = true;
    fetch(`/api/ai/status?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : { live: false }))
      .then((d: { live: boolean; why?: 'no-key' | 'down' | 'used-up' | null }) => on && (setAiOn(d.live || caps.demo), setAiWhy(d.why ?? null)), () => on && setAiOn(caps.demo));
    return () => {
      on = false;
    };
  }, [ws.id, ws.ai]);
  const [activeAccount, setActiveAccount] = useState<string>('all');
  const [newWs, setNewWs] = useState(false);
  const [newAcct, setNewAcct] = useState(false);
  const [removeAcct, setRemoveAcct] = useState<Account | null>(null); // asking what happens to its mail
  // Throwaway addresses: the dialog (new or editing one) and the little menu on each.
  const [tempDialog, setTempDialog] = useState<{ editing?: Account } | null>(null);
  const [tempMenu, setTempMenu] = useState<Account | null>(null);
  const tempAnchor = useRef<HTMLElement | null>(null);
  const [inviting, setInviting] = useState(false);
  const allAccounts = allWorkspaces.flatMap((w) => w.accounts);
  const mine = workspaces.flatMap((w) => w.accounts.filter((a) => a.users.includes(user.id)));
  setIdentity(mine.map((a) => a.email), ws.domains);
  const primary = myAccounts.find((a) => a.id === activeAccount) ?? myAccounts[0] ?? { email: user.email };
  const ME: Person & { color: string } = { name: settings.name || user.name, email: primary.email, color: settings.avatarColor };
  const accountOf = (id: string) => allAccounts.find((a) => a.id === id);
  const senderFor = (a: Account | undefined): Person =>
    a ? { name: a.kind === 'shared' ? a.name : settings.name || a.name, email: a.email } : ME;

  useEffect(() => {
    if (myPortals.some((pt) => pt.key === portalKey)) return; // the portal brands itself
    applyBranding(ws);
    const root = document.documentElement;
    // The workspace colour is the brand; polish.css turns it into a light- or dark-friendly accent.
    root.style.setProperty('--brand', ws.color);
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--accent-soft');
  }, [ws, portalKey]); // also when coming back from a client portal (it uses the other company's brand)

  const patchWorkspace = (id: string, patch: Partial<Workspace>) => setWorkspaces((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const mobile = useMedia(PHONE);

  // Shell
  const [mode, setMode] = useState<Mode>(readRoute);
  const [lastMode, setLastMode] = useState<AppId>(() => (readRoute() === 'settings' ? 'home' : (readRoute() as AppId)));
  useEffect(() => {
    writeRoute(mode);
  }, [mode]);
  useEffect(() => {
    const back = () => setMode(readRoute());
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, []);
  // Tablets (iPad portrait, small landscape): the sidebar starts folded to icons so the page gets the room.
  // Each size keeps its own choice, so opening it on the iPad doesn't change the laptop.
  const tablet = useMedia(TABLET);
  const [collapsedWide, setCollapsedWide] = usePersisted('pm-sidebar-collapsed', false);
  const [collapsedTablet, setCollapsedTablet] = usePersisted('pm-sidebar-collapsed-tablet', true);
  const collapsed = tablet ? collapsedTablet : collapsedWide;
  const setCollapsed = tablet ? setCollapsedTablet : setCollapsedWide;
  const [sidebarW, setSidebarW] = usePersisted('pm-sidebar-w', 248);
  const [listW, setListW] = usePersisted('pm-list-w', 400);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = (t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() });
  // Shared pieces (SwipeRow, sheets) send their toasts here through src/toast.ts.
  useEffect(() => {
    const on = (e: Event) => setToast({ ...(e as CustomEvent<ToastMsg>).detail, id: Date.now() });
    window.addEventListener('s2g:toast', on);
    return () => window.removeEventListener('s2g:toast', on);
  }, []);
  // News from the sprint2go team (operator backend, Product), minus what this person dismissed on this device.
  const [news, setNews] = useState<{ id: string; text: string; link?: string; kind: 'news' | 'warning' }[]>([]);
  const [newsSeen, setNewsSeen] = usePersisted<string[]>('s2g-news-dismissed', []);
  useEffect(() => {
    if (!server.on) return;
    const load = () =>
      fetch('/api/announcements')
        .then((r) => (r.ok ? r.json() : { announcements: [] }))
        .then((d: { announcements: typeof news }) => setNews(d.announcements), () => {});
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 15 * 60_000);
    return () => clearInterval(t);
  }, []);

  // Mail
  const [threads, setThreads] = useStored('threads');
  // Threads in mailboxes this user can open in this workspace, narrowed to one inbox when picked.
  const wsThreads = useMemo(() => threads.filter((t) => myAccounts.some((a) => a.id === t.accountId)), [threads, myAccounts]);

  /* ---------------- Throwaway addresses ---------------- */

  const withAccounts = (wsId: string, fn: (list: Account[]) => Account[]) => setWorkspaces((list) => list.map((w) => (w.id === wsId ? { ...w, accounts: fn(w.accounts) } : w)));
  /** Delete one, its mail with it. A person doing it gets Undo; the timer does it quietly. */
  const deleteTemp = (a: Account, quiet = false) => {
    const w = workspaces.find((x) => x.accounts.some((y) => y.id === a.id));
    if (!w) return;
    const gone = threads.filter((t) => t.accountId === a.id);
    withAccounts(w.id, (l) => l.filter((x) => x.id !== a.id));
    setThreads((ts) => ts.filter((t) => t.accountId !== a.id));
    if (activeAccount === a.id) setActiveAccount('all');
    if (!quiet)
      showToast({
        text: `${a.email} deleted`,
        // The address goes back first; its mail follows once the server knows the address again (or it would be refused).
        action: { label: 'Undo', run: () => (withAccounts(w.id, (l) => [...l, a]), setTimeout(() => setThreads((ts) => [...ts, ...gone]), 900)) },
      });
  };
  // Time's up: the people who can see an address clear it out (whoever opens the app first).
  const sweepRef = useRef(() => {});
  sweepRef.current = () => {
    const now = new Date().toISOString();
    workspaces.forEach((w) => w.accounts.filter((a) => a.temp?.expiresAt && a.temp.expiresAt < now && a.users.includes(user.id)).forEach((a) => deleteTemp(a, true)));
  };
  useEffect(() => {
    sweepRef.current();
    const t = setInterval(() => sweepRef.current(), 60_000);
    return () => clearInterval(t);
  }, []);
  /** Until real mail flows in: a test message, so you can see how codes show up. */
  const testTemp = (a: Account) => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setThreads((ts) => [
      {
        id: uid(),
        accountId: a.id,
        subject: `Test: your verification code is ${code}`,
        location: 'inbox',
        starred: false,
        unread: true,
        labels: [],
        messages: [{ id: uid(), from: { name: 'sprint2go test', email: 'test@s2g.email' }, to: [{ name: a.email, email: a.email }], date: nowIso(), body: `This is a test message for ${a.email}.\n\nYour verification code is ${code}. It expires in 10 minutes.` }],
      },
      ...ts,
    ]);
    setActiveAccount(a.id);
    if (mode !== 'mail') go('mail');
  };
  // Blocked senders (per user): their mail never shows outside Trash.
  const [blocked, setBlocked] = usePersisted<BlockRule[]>(`pm-blocked:${user.id}`, []);
  const [unsubscribed, setUnsubscribed] = usePersisted<Record<string, string>>(`pm-unsub:${user.id}`, {});
  const isBlocked = (email: string) => {
    const e = email.toLowerCase();
    return blocked.some((b) => (b.kind === 'address' ? b.value === e : e.endsWith('@' + b.value)));
  };
  const incomingFrom = (t: Thread) => [...t.messages].reverse().find((m) => !isMine(m.from.email))?.from;
  const fromBlocked = (t: Thread) => {
    const f = incomingFrom(t);
    return !!f && isBlocked(f.email);
  };
  const scopedAll = useMemo(() => (activeAccount === 'all' ? wsThreads : wsThreads.filter((t) => t.accountId === activeAccount)), [wsThreads, activeAccount]);
  const scoped = useMemo(() => scopedAll.filter((t) => t.location === 'trash' || !fromBlocked(t)), [scopedAll, blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // AI to-dos
  const [todos, setTodos] = useStored('todos');
  const myTodos = useMemo(() => todos.filter((t) => t.userId === user.id), [todos, user.id]);
  const todosRef = useRef(todos);
  todosRef.current = todos;
  const [, setScanning] = useState(false);
  const [blockTarget, setBlockTarget] = useState<Thread | null>(null);
  const [view, setView] = useState<View>({ kind: 'folder', id: 'inbox' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readerOpen, setReaderOpen] = useState(false); // narrow screens: list vs reader
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  // Latest values for timers that fire later.
  const latest = useRef({ threads, notifyOpens: settings.notifyOpens, workspaces: allWorkspaces });
  latest.current = { threads, notifyOpens: settings.notifyOpens, workspaces: allWorkspaces };

  // Calendar
  const [events, setEvents] = useStored('events');
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const [extCals, setExtCals] = useStored('calendars');
  const [shownMates, setShownMates] = useState<Set<string>>(new Set());
  const [connectCal, setConnectCal] = useState<false | true | 'holidays'>(false);
  const [calCursor, setCalCursor] = useState(new Date());
  const [calView, setCalView] = useState<CalView>(() => (matchMedia(PHONE).matches ? 'day' : 'week'));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [newEventAt, setNewEventAt] = useState<Date | null>(null);

  // Drive
  const [drive, setDrive] = useStored('drive');
  const [driveSection, setDriveSection] = useState<DriveSection>('my');
  const [driveFolder, setDriveFolder] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ item: DriveItem; list: DriveItem[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Team: clients, chat, notifications, meetings
  const [clients, setClients] = useStored('clients');
  const [channels, setChannels] = useStored('channels');
  const [quotes, setQuotes] = useStored('quotes');
  const [messages, setMessages] = useStored('messages');
  const [notices, setNotices] = useStored('notices');
  const [meetings, setMeetings] = useStored('meetings');
  const [taskScope, setTaskScope] = usePersisted<TaskScope>('s2g-task-scope', { kind: 'mine' }); // the last one used, on this device
  // The Projects app: all projects, past ones, or one project's hub.
  const [projScope, setProjScope] = useState<TaskScope>({ kind: 'projects' });
  const [projNew, setProjNew] = useState(0); // bumps to open the "new project" form
  const [taskOpen, setTaskOpen] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<'overview' | 'tasks' | 'chat' | 'emails' | 'meetings' | 'files' | 'notes' | 'tables' | 'logins' | 'portal' | undefined>(undefined);
  const [teams, setTeams] = useStored('teams');
  const [statuses, setStatuses] = useStored('statuses');
  const [savedTemplates, setSavedTemplates] = useStored('templates');
  const [tplOpen, setTplOpen] = useState<{ clientId?: string } | null>(null);
  const [chanDialog, setChanDialog] = useState<{ id?: string } | null>(null);
  const [notes, setNotes] = useStored('notes');
  // Tables: the company's own databases (leads, pipelines…). Table structure and rows sync separately.
  const [tables, setTables] = useStored('tables');
  const [tableRows, setTableRows] = useStored('rows');
  const [tableId, setTableId] = usePersisted<string | null>('s2g-table', null);
  const [tableRow, setTableRow] = useState<string | null>(null);
  const [newTableFor, setNewTableFor] = useState<{ clientId?: string } | null>(null);
  const [teamId, setTeamId] = usePersisted<string | null>('s2g-team', null);
  const [newTeam, setNewTeam] = useState(false);
  // Vault: only titles and who can use them are loaded; passwords come from the server one at a time.
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [vaultFilter, setVaultFilter] = useState('');
  const [vaultEditing, setVaultEditing] = useState<VaultItem | 'new' | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [notesFilter, setNotesFilter] = useState<NotesFilter>('all');
  const [askSeed, setAskSeed] = useState(''); // a question handed to Ask AI from search
  const [focusMsg, setFocusMsg] = useState<string | null>(null); // a notification lands on this chat message
  const [viewAs, setViewAs] = useState<{ clientId: string; email: string } | null>(null); // "View as client"
  const [chatId, setChatId] = useState<string | null>(null);
  const [huddleId, setHuddleId] = useState<string | null>(null); // the channel whose huddle I'm in
  const [meetPage, setMeetPage] = useState<MeetPage>({ kind: 'list' });
  const [sendBotOpen, setSendBotOpen] = useState(false);
  // Sending the notetaker to a calendar event that has no link it can join: the dialog asks, with the event filled in.
  const [sendBotSeed, setSendBotSeed] = useState<{ title: string; fromEvent: string; attendees: string[]; note?: string } | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [sharedPreview, setSharedPreview] = useState<string | null>(null);
  const [askScope, setAskScope] = useState<AskScope | null>(null);
  // The phone's bottom bar: the person's own, else their team's or company's (Settings, Apps & chat), else the usual.
  // A bar saved before company bars existed counts as their own when it isn't the usual one.
  const [savedBar, setSavedBar] = usePersisted<AppId[]>(`s2g-tabbar:${user.id}`, DEFAULT_BAR);
  const [ownBar, setOwnBar] = usePersisted<boolean>(`s2g-tabbar:own:${user.id}`, false);
  const [editingBar, setEditingBar] = useState(false);
  const [askChats, setAskChats] = usePersisted<AskChat[]>(`s2g-ask-chats:${user.id}`, []);
  const [joinOverrides, setJoinOverrides] = usePersisted<Record<string, boolean>>(`s2g-join:${user.id}`, {});
  const [sentEvents, setSentEvents] = useState<Record<string, string>>({});
  const botTimers = useRef<Record<string, number[]>>({});
  // The real meeting recorder (recorder/), when this server has one; otherwise the bot is a demo.
  const [recorderOn, setRecorderOn] = useState(false);
  useEffect(() => {
    if (server.on) void fetch('/api/meet/status').then((r) => (r.ok ? r.json() : null)).then((x) => setRecorderOn(!!x?.recorder && x.reachable !== false), () => {});
  }, []);
  const meetingsRef = useRef<Meeting[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dump, setDump] = useState<string | null>(null); // null = closed
  const [lastRead, setLastRead] = usePersisted<Record<string, string>>(`s2g-read:${user.id}`, {});

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.ms ?? 5000);
    return () => clearTimeout(t);
  }, [toast]);

  /** A feature that depends on something not set up: say what's missing (and where to fix it, for admins). */
  const explainOff = (text: string, fix?: SettingsSection) =>
    showToast({ text, ms: 7000, action: fix && ws.members.some((m) => m.userId === user.id && m.role !== 'member') ? { label: 'Set it up', run: () => (setSettingsSection(fix), go('settings')) } : undefined });
  const aiOff = (what: string) =>
    aiWhy === 'used-up'
      ? explainOff('The company’s AI allowance for this month is used up. An admin can add a top-up in Settings, Plan & billing.', 'billing')
      : aiWhy === 'down'
        ? explainOff('AI isn’t available right now. We’ve been told; try again in a few minutes.')
        : explainOff(`AI isn’t set up for this company yet${what}. An admin can add an AI key in Settings, AI, or switch to the AI plan.`, 'ai');
  const openDump = (t: string) => (aiOn ? setDump(t) : aiOff(', so the brain dump can’t turn notes into tasks'));
  const openAsk = (scope: AskScope) => (aiOn ? setAskScope(scope) : aiOff(''));
  const botOn = !server.on || caps.demo || inSandbox || recorderOn;
  const openSendBot = () => (botOn ? (setSendBotSeed(null), setSendBotOpen(true)) : explainOff('The meeting notetaker isn’t available yet. Recordings and notes start working as soon as it is.'));
  const calendarsOn = !server.on || caps.demo || inSandbox || caps.googleCalendar || caps.microsoftCalendar || caps.calendarLinks;
  const go = (m: Mode) => {
    if (m !== 'settings') setLastMode(m);
    if (m !== mode) window.dispatchEvent(new CustomEvent('s2g:app', { detail: m })); // a calm moment (the install prompt waits for one)
    setMode(m);
    setSidebarOpen(false);
    setAccountOpen(false);
    setNoticesOpen(false);
    setMoreOpen(false);
  };

  /* ---------------- Mail ---------------- */

  // New mail arrives live. Refresh pulls the mailboxes again, reconnects when the live connection dropped, and asks
  // the server to check the mail setup again; the list says when mail last came in fresh.
  const [mailLive, setMailLive] = useState(() => ({ down: live.down, at: live.mailAt || Date.now() }));
  useEffect(() => {
    const on = () => setMailLive({ down: live.down, at: live.mailAt });
    window.addEventListener('s2g:live', on);
    return () => window.removeEventListener('s2g:live', on);
  }, []);
  const readyAsked = useRef(0);
  const refreshMail = async () => {
    if (!real) return void setMailLive({ down: false, at: Date.now() });
    // The mailbox check looks at DNS and the server's ports: once a minute is plenty.
    if (Date.now() - readyAsked.current > 60_000) {
      readyAsked.current = Date.now();
      void fetch('/api/mail/ready', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id }) }).catch(() => {});
    }
    try {
      await resync(['threads', 'workspaces']);
    } catch {
      showToast({ text: 'Couldn’t reach the server. Check your connection, then try again.' });
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((t) => inView(t, view, user.id))
      .filter((t) => filter === 'all' || t.unread)
      .filter(
        (t) =>
          !q ||
          t.subject.toLowerCase().includes(q) ||
          t.messages.some((m) => m.from.name.toLowerCase().includes(q) || m.from.email.includes(q) || m.body.toLowerCase().includes(q)),
      )
      .sort((a, b) => lastMessage(b).date.localeCompare(lastMessage(a).date));
  }, [scoped, view, filter, query]);

  const counts = useMemo(
    () => ({
      inbox: scoped.filter((t) => inView(t, { kind: 'folder', id: 'inbox' }) && t.unread).length,
      drafts: scoped.filter((t) => t.location === 'drafts' && !t.sendAt).length,
      scheduled: scoped.filter((t) => t.sendAt).length,
      assigned: scoped.filter((t) => t.assignee === user.id && t.location === 'inbox').length,
      spam: scoped.filter((t) => t.location === 'spam' && t.unread).length,
    }),
    [scoped],
  );

  const accountUnread = useMemo(() => {
    const r: Record<string, number> = { all: 0 };
    for (const t of wsThreads) if (t.location === 'inbox' && t.unread) {
      r[t.accountId] = (r[t.accountId] ?? 0) + 1;
      r.all++;
    }
    return r;
  }, [wsThreads]);

  const wsUnread = useMemo(() => {
    const r: Record<string, number> = {};
    for (const w of workspaces)
      r[w.id] = threads.filter((t) => t.location === 'inbox' && t.unread && w.accounts.some((a) => a.id === t.accountId && a.users.includes(user.id))).length;
    return r;
  }, [threads, workspaces]);

  const switchWorkspace = (id: string) => {
    if (id === ws.id) return;
    setWsId(id);
    setActiveAccount('all');
    setSelectedId(null);
    setReaderOpen(false);
    setView({ kind: 'folder', id: 'inbox' });
    setQuery('');
    setDriveFolder(null);
    setSelectedEventId(null);
    setSidebarOpen(false);
    if (mode === 'settings') setMode(lastMode);
  };

  /* ---------------- The demo company (src/sandbox.ts, server/sandbox.ts) ---------------- */

  const sandboxWs = workspaces.find((w) => isSandbox(w));
  /** Opens their own demo company: made the first time, shown again when it was hidden. */
  const openDemo = async () => {
    if (sandboxWs) return (switchWorkspace(sandboxWs.id), go('home'));
    setDemoBusy(true);
    const r = await openDemoCompany();
    if (r.error) return (setDemoBusy(false), showToast({ text: r.error, ms: 7000 }));
    await reloadAll().catch(() => {});
    setDemoBusy(false);
    if (r.workspaceId) switchWorkspace(r.workspaceId);
    go('home');
  };
  const hideDemo = async () => {
    const other = workspaces.find((w) => !isSandbox(w));
    setDemoBusy(true);
    const err = await hideDemoCompany();
    setDemoBusy(false);
    if (err) return showToast({ text: err });
    if (other) switchWorkspace(other.id);
    await reloadAll().catch(() => {});
    showToast({ text: 'The demo company is hidden. Help & support brings it back.', ms: 7000, action: { label: 'Undo', run: () => void openDemo() } });
  };
  const resetDemo = async (): Promise<boolean> => {
    const err = await resetDemoCompany();
    if (err) return (showToast({ text: err }), false);
    await reloadAll().catch(() => {});
    setResettingDemo(false);
    go('home');
    showToast({ text: 'The demo company is new again' });
    return true;
  };
  /** In the switcher until it's made: "Demo company". Hidden ones come back from Help & support, not from here. */
  const demoEntry = !sandboxWs && demo?.allowed && demo.state === 'none' ? { busy: demoBusy, onOpen: () => void openDemo() } : null;
  /** Ticks something off the demo company's "Try this" list (only when it was really done there). */
  const tried = (key: TryKey) => {
    if (!inSandbox) return;
    setWorkspaces((list) => list.map((w) => (w.id === ws.id && w.sandbox && !w.sandbox.tried?.includes(key) ? { ...w, sandbox: { ...w.sandbox, tried: [...(w.sandbox.tried ?? []), key] } } : w)));
  };
  /** "Try this" back on the demo company's Home (from Help & support). */
  const showTryList = () => {
    if (!sandboxWs?.sandbox) return void openDemo();
    patchWorkspace(sandboxWs.id, { sandbox: { ...sandboxWs.sandbox, listOff: false } });
    switchWorkspace(sandboxWs.id);
    go('home');
  };
  /** "Show me": where each thing on the list is done (it doesn't do it for them). */
  const goTry = (key: TryKey) => {
    const id = (seedId: string) => `${sandboxWsId(user.id)}-${seedId}`;
    const has = <T extends { id: string }>(list: T[], x: string) => list.some((d) => d.id === x);
    switch (key) {
      case 'reply':
      case 'email-task':
        return has(threads, id('t1')) ? openThread(id('t1')) : go('mail');
      case 'stage':
        return openTasks({ kind: 'mine' });
      case 'ask':
        return openAsk(has(clients, id('c-kopikita')) ? { kind: 'client', id: id('c-kopikita') } : { kind: 'all' });
      case 'guest':
        return has(clients, id('c-kopikita')) ? openClient(id('c-kopikita'), 'portal') : go(enabled.has('projects') ? 'projects' : 'tasks');
      case 'voice':
        return openChannel(has(channels, id('dm-aqeel-rizky')) ? id('dm-aqeel-rizky') : (wsChannels[0]?.id ?? ''));
      case 'event':
        return (go('calendar'), openNewEvent());
      case 'meeting':
        return has(meetings, id('mt-kopikita')) ? openMeeting(id('mt-kopikita')) : go('meet');
    }
  };

  const contacts = useMemo(() => {
    const map = new Map<string, Person>();
    for (const t of wsThreads) for (const m of t.messages) for (const p of [m.from, ...m.to]) map.set(p.email, p);
    for (const e of events) for (const g of e.guests ?? []) map.set(g.email, g);
    for (const e of [...map.keys()]) if (isMine(e)) map.delete(e);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [wsThreads, events]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = threads.find((t) => t.id === selectedId) ?? null;
  const selectedAcct = selected ? accountOf(selected.accountId) : undefined;
  const wsAdmin = ws.members.some((m) => m.userId === user.id && m.role !== 'member');

  const update = (id: string, patch: Partial<Thread>) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const openCompose = (init?: Omit<ComposeState, 'key'>) => {
    // No mailbox can send yet: say why instead of opening a window that can't send.
    if (!mailOut && myAccounts.length) {
      showToast({ text: `Sending isn’t set up yet. ${mailWhy.send ?? ''}`.trim(), ms: 7000, action: wsAdmin ? { label: 'Set it up', run: () => (setSettingsSection('email'), go('settings')) } : undefined });
      return;
    }
    setCompose({ key: Date.now(), ...init });
    setSidebarOpen(false);
  };

  const open = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      if (t?.location === 'drafts') {
        const m = t.messages[0];
        openCompose({
          draftId: t.id,
          initial: { to: m.to, cc: [], subject: t.subject === '(no subject)' ? '' : t.subject, html: m.html ?? m.body.replace(/\n/g, '<br>'), text: m.body, files: [], track: settings.trackByDefault, trackOptions: m.trackOptions ?? DEFAULT_TRACK_OPTIONS, fromId: t.accountId },
        });
        return;
      }
      setSelectedId(id);
      setReaderOpen(true);
      setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, unread: false } : x)));
    },
    [threads], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Animate a thread out of the list, then move it, select its neighbour and offer undo. */
  const move = (id: string, location: Location, text: string) => {
    const idx = visible.findIndex((t) => t.id === id);
    const next = visible[idx + 1] ?? visible[idx - 1];
    const snapshot = threads;
    setLeaving((l) => new Set(l).add(id));
    if (selectedId === id) {
      setSelectedId(next && next.id !== id ? next.id : null);
      if (!next) setReaderOpen(false);
    }
    setTimeout(() => {
      update(id, { location });
      setLeaving((l) => {
        const n = new Set(l);
        n.delete(id);
        return n;
      });
    }, 220);
    showToast({ text, action: { label: 'Undo', run: () => setThreads(snapshot) } });
  };

  const archive = (id: string) => move(id, 'archive', 'Conversation archived');
  const trash = (id: string) => move(id, 'trash', 'Moved to Trash');
  const spam = (id: string) => move(id, 'spam', 'Reported as spam');
  const toInbox = (id: string) => move(id, 'inbox', 'Moved to Inbox');
  const star = (id: string) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, starred: !t.starred } : t)));
  const markUnread = (id: string) => {
    update(id, { unread: true });
    setSelectedId(null);
    setReaderOpen(false);
  };

  const replyWhy = (acct: { id: string; email: string }) => boxReady(acct.id).sendWhy ?? `Replies can’t go out from ${acct.email} yet. ${boxReady(acct.id).why ?? mailWhy.send ?? ''}`.trim();
  const replyBlocked = (acct: { id: string; email: string }) =>
    showToast({ text: replyWhy(acct), ms: 7000, action: wsAdmin ? { label: 'Set it up', run: () => (setSettingsSection('email'), go('settings')) } : undefined });
  /**
   * Undo send for real: the mail engine keeps each email for the sender's Undo window (Settings, Mail) before anything
   * leaves, so taking it back means nobody gets it. `then` runs once the server has it back.
   */
  const takeBack = (threadId: string, messageId: string, then: () => void) =>
    void fetch('/api/mail/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId, messageId }) }).then(
      async (r) => (r.ok ? then() : showToast({ text: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'It couldn’t be taken back.' })),
      () => showToast({ text: 'No connection: it couldn’t be taken back.' }),
    );
  /** After the mail engine took an email: "sent", with Undo for as long as it's still waiting there. */
  const sentToast = async (r: Response, text: string, undo: () => void) => {
    const d = (await r.json().catch(() => ({}))) as { held?: boolean; until?: string };
    const left = d.held && d.until ? Date.parse(d.until) - Date.now() - 300 : 0;
    showToast(left > 1000 ? { text, ms: left, action: { label: 'Undo', run: undo } } : { text });
  };
  const [restoreReply, setRestoreReply] = useState<{ threadId: string; html: string; text: string; key: number } | null>(null);

  /** Why the mail engine didn't take an email, as a sentence that ends properly. */
  const refusal = async (r: Response | null, fallback: string) => {
    const why = (r ? (((await r.json().catch(() => ({}))) as { error?: string }).error ?? fallback) : 'There’s no connection.').trim();
    return /[.!?]$/.test(why) ? why : `${why}.`;
  };

  const reply = (id: string, html: string, text: string, track = false) => {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    const acct = accountOf(t.accountId);
    if (acct && !boxReady(acct.id).send) return replyBlocked(acct);
    const last = lastMessage(t);
    const to = isMine(last.from.email) ? last.to : [last.from];
    const from = senderFor(acct);
    const msgId = uid();
    // Tracked like a new email: only people outside the team, and only when the company allows it.
    const outside = to.filter((p) => !isTeam(p.email));
    const tracked = track && ws.readTracking !== false && outside.length > 0;
    const tracking = tracked ? Object.fromEntries(outside.map((p) => [p.email, { opens: [], clicks: [] }])) : undefined;
    setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, messages: [...x.messages, { id: msgId, from, to, date: new Date().toISOString(), body: text, html, ...(tracked ? { tracking, trackOptions: REPLY_TRACK_OPTIONS } : {}) }] } : x)));
    /** It didn't go: the reply leaves the conversation and its words go back in the reply box, to send again or change. */
    const notSent = (why: string) => {
      setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, messages: x.messages.filter((m) => m.id !== msgId) } : x)));
      const back = () => setRestoreReply({ threadId: id, html, text, key: Date.now() });
      back();
      showToast({ text: `Reply not sent. ${why} What you wrote is back in the reply box.`, ms: 10000, action: { label: 'Open', run: () => (setSelectedId(id), setReaderOpen(true), back()) } });
    };
    // With the server, the mail engine sends it for real, threaded under the message it answers.
    if (real && acct && (!acct.provider || acct.provider === 'sprint2go')) {
      const refs = t.messages.map((m) => m.mid).filter(Boolean) as string[];
      void fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: ws.id, accountId: acct.id, threadId: t.id, messageId: msgId, to, cc: [], subject: /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`, text, html, files: [], inReplyTo: last.mid, references: refs, track: tracked, trackOptions: tracked ? { opens: REPLY_TRACK_OPTIONS.opens, clicks: REPLY_TRACK_OPTIONS.clicks, notify: REPLY_TRACK_OPTIONS.notify } : undefined, undoSeconds: settings.undoSend }),
      }).then(
        async (r) =>
          r.ok
            ? sentToast(r, 'Reply sent', () =>
                takeBack(id, msgId, () => {
                  setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, messages: x.messages.filter((m) => m.id !== msgId) } : x)));
                  setRestoreReply({ threadId: id, html, text, key: Date.now() });
                }),
              )
            : notSent(await refusal(r, 'The mail engine refused it.')),
        async () => notSent(await refusal(null, '')),
      );
    } else showToast({ text: inSandbox ? 'Reply sent in the demo company. Nothing left it.' : 'Reply sent' });
    if (inSandbox && clientForThread(t)) tried('reply');
  };

  /** `scheduled`: a "send later" draft keeps its tracking, so the server tracks it when it goes out. */
  const toThread = (m: Outgoing, location: Location, id = uid(), scheduled = false): Thread => ({
    id,
    accountId: m.fromId,
    subject: m.subject || '(no subject)',
    location,
    starred: false,
    unread: false,
    labels: [],
    messages: [
      {
        id: uid(),
        from: senderFor(accountOf(m.fromId)),
        to: [...m.to, ...m.cc],
        date: new Date().toISOString(),
        body: m.text,
        html: m.html,
        attachments: m.files.length ? m.files.map((f) => ({ name: f.name, size: fmtSize(f.size) })) : undefined,
        trackOptions: m.track && (location !== 'drafts' || scheduled) ? m.trackOptions : undefined,
        tracking:
          m.track && (location !== 'drafts' || scheduled)
            ? Object.fromEntries([...m.to, ...m.cc].filter((p) => !isTeam(p.email)).map((p) => [p.email, { opens: [], clicks: [] }]))
            : undefined,
      },
    ],
  });

  /** Files a sent copy and drops copies straight into any of our own recipients' inboxes. */
  const deliver = (m: Outgoing, draftId?: string) => {
    const thread = toThread(m, 'archive');
    // Mail to one of our own mailboxes arrives straight in its inbox (an alias: in each of its mailboxes). With the
    // server, the mail engine does that, for mailboxes this person can't open too.
    // The demo company delivers only to its own mailboxes: nothing in it reaches a real one.
    const pool = inSandbox ? [ws] : allWorkspaces;
    const boxesFor = (email: string) => {
      const e = email.toLowerCase();
      const direct = pool.flatMap((w) => w.accounts).filter((a) => a.email === e);
      return direct.length ? direct : pool.flatMap((w) => (w.mailAliases ?? []).filter((al) => al.address === e).flatMap((al) => w.accounts.filter((a) => al.to.includes(a.id))));
    };
    const delivered: Thread[] = (real ? [] : [...new Map([...m.to, ...m.cc].flatMap((p) => boxesFor(p.email)).filter((a) => a.id !== m.fromId).map((a) => [a.id, a] as const)).values()])
      .map((a) => ({
        ...thread,
        id: uid(),
        accountId: a.id,
        location: 'inbox' as const,
        unread: true,
        messages: thread.messages.map((msg) => ({ ...msg, tracking: undefined, trackOptions: undefined })),
      }));
    setThreads((ts) => [thread, ...delivered, ...ts.filter((t) => t.id !== draftId)]);
    return { thread, delivered };
  };

  /**
   * The mail engine didn't take it (the mailbox can't send yet, a sending limit, a paused company) or it never got
   * there: nobody got it, so it isn't kept as sent. It goes back to Drafts, untracked, with the reason and a way to
   * open it again (to change it, or to send it once the problem is fixed).
   */
  const notSent = (thread: Thread, m: Outgoing, why: string) => {
    const draft = toThread(m, 'drafts');
    setThreads((ts) => [draft, ...ts.filter((x) => x.id !== thread.id)]);
    showToast({ text: `Not sent. ${why} It’s in Drafts.`, ms: 10000, action: { label: 'Open draft', run: () => openCompose({ draftId: draft.id, initial: m }) } });
  };

  const send = (m: Outgoing) => {
    if (m.sendAt) {
      // Send later: kept as a scheduled draft until its time (the server does this for real).
      const t = { ...toThread(m, 'drafts', undefined, true), sendAt: m.sendAt };
      setThreads((ts) => [t, ...ts.filter((x) => x.id !== compose?.draftId)]);
      setCompose(null);
      // Undo: not scheduled any more, back to the draft it was (the server sends only what's still scheduled at its time).
      showToast({
        text: `Scheduled for ${new Date(m.sendAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`,
        action: {
          label: 'Undo',
          run: () => {
            setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, sendAt: undefined } : x)));
            openCompose({ draftId: t.id, initial: { ...m, sendAt: undefined } });
          },
        },
      });
      return;
    }
    const from = accountOf(m.fromId);
    // With the server, a mailbox that can't send keeps the message open instead of pretending it went out.
    if (!demoOk && (!from || !boxReady(from.id).send)) {
      showToast({ text: from ? replyWhy(from) : 'Choose a mailbox that can send.', ms: 7000, action: wsAdmin ? { label: 'Set it up', run: () => (setSettingsSection('email'), go('settings')) } : undefined });
      return;
    }
    // A reply drafted in a connected AI app keeps the conversation's headers, so it lands in the same thread.
    const replyOf = compose?.draftId ? threads.find((x) => x.id === compose.draftId)?.replyTo : undefined;
    const { thread, delivered } = deliver(m, compose?.draftId);
    setCompose(null);
    // With the server: the mail engine really sends it (our own mailboxes already have their copies).
    const handedOver = real && !!from && (!from.provider || from.provider === 'sprint2go');
    if (handedOver) {
      void fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: ws.id, accountId: from.id, threadId: thread.id, messageId: thread.messages[0].id, to: m.to, cc: m.cc, subject: m.subject, text: m.text, html: m.html, files: m.files.map((f) => ({ name: f.name, url: f.url })), inReplyTo: replyOf?.mid, references: replyOf?.references, track: m.track, trackOptions: m.track ? { opens: m.trackOptions.opens, clicks: m.trackOptions.clicks, notify: m.trackOptions.notify, remindDays: m.trackOptions.remindDays } : undefined, undoSeconds: settings.undoSend }),
      }).then(
        async (r) => {
          if (!r.ok) return notSent(thread, m, await refusal(r, 'The mail engine refused it.'));
          // Undo while the mail engine still has it waiting: it comes back as a draft, and nobody got it.
          await sentToast(r, 'Message sent', () =>
            takeBack(thread.id, thread.messages[0].id, () => {
              setThreads((ts) => ts.map((x) => (x.id === thread.id ? { ...x, location: 'drafts', messages: x.messages.map((msg) => ({ ...msg, delivery: undefined })) } : x)));
              openCompose({ draftId: thread.id, initial: m });
            }),
          );
        },
        async () => notSent(thread, m, await refusal(null, '')),
      );
      return;
    } else if (demoOk && thread.messages[0].tracking) simulateOpen(thread);
    // Without the mail engine (the demo), nothing has left yet: Undo just puts it back.
    const canUndo = !!settings.undoSend && !real;
    showToast({
      text: inSandbox ? 'Sent in the demo company. Nothing left it.' : 'Message sent',
      ms: canUndo ? settings.undoSend * 1000 : 4000,
      action: canUndo
        ? {
            label: 'Undo',
            run: () => {
              const gone = new Set([thread.id, ...delivered.map((d) => d.id)]);
              setThreads((ts) => ts.filter((t) => !gone.has(t.id)));
              openCompose({ initial: m });
            },
          }
        : undefined,
    });
  };

  /**
   * DEMO ONLY: pretends the first external recipient opens the email a few seconds
   * after sending, so the live "just opened" flow can be tried without a server.
   * The real tracking service (pixel + click redirects) replaces this.
   */
  const simulateOpen = (thread: Thread) => {
    const msg = thread.messages[0];
    const email = Object.keys(msg.tracking ?? {})[0];
    if (!email) return;
    const who = msg.to.find((p) => p.email === email)?.name ?? email;
    setTimeout(() => {
      if (!latest.current.threads.some((t) => t.id === thread.id)) return; // send was undone
      const open = { at: new Date().toISOString(), device: 'Windows PC · Outlook' };
      setThreads((ts) =>
        ts.map((t) =>
          t.id !== thread.id
            ? t
            : {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === msg.id && m.tracking
                    ? { ...m, tracking: { ...m.tracking, [email]: { ...m.tracking[email], opens: [...m.tracking[email].opens, open] } } }
                    : m,
                ),
              },
        ),
      );
      if (latest.current.notifyOpens)
        showToast({ text: `${who} just opened “${thread.subject}”`, action: { label: 'View', run: () => openThread(thread.id) } });
    }, 9000);
  };

  const closeCompose = (draft: Outgoing | null) => {
    const draftId = compose?.draftId;
    setCompose(null);
    if (!draft) return;
    const replyTo = draftId ? threads.find((x) => x.id === draftId)?.replyTo : undefined;
    const t = { ...toThread(draft, 'drafts', draftId), ...(replyTo ? { replyTo } : {}) };
    setThreads((ts) => (draftId ? ts.map((x) => (x.id === draftId ? t : x)) : [t, ...ts]));
    showToast({ text: 'Draft saved', action: { label: 'Open', run: () => openCompose({ draftId: t.id, initial: draft }) } });
  };

  const selectView = (v: View) => {
    setView(v);
    setSelectedId(null);
    setReaderOpen(false);
    setSidebarOpen(false);
    setQuery('');
    if (mode !== 'mail') go('mail');
  };

  // Scheduled mail goes out on time; snoozed mail comes back to the inbox (the backend does both on the server, for
  // real mailboxes; here only for the demo and the demo company's mailboxes).
  useEffect(() => {
    const tick = () => {
      const now = new Date().toISOString();
      const demoBoxes = new Set(latest.current.workspaces.filter((w) => isSandbox(w)).flatMap((w) => w.accounts.map((a) => a.id)));
      const ours = (t: Thread) => !server.on || demoBoxes.has(t.accountId);
      const due = (t: Thread) => ours(t) && ((!!t.sendAt && t.sendAt <= now) || (!!t.snoozedUntil && t.snoozedUntil <= now));
      if (!latest.current.threads.some(due)) return;
      setThreads((ts) =>
        ts.map((t) => {
          if (!ours(t)) return t;
          if (t.sendAt && t.sendAt <= now) return { ...t, sendAt: undefined, location: 'archive', messages: t.messages.map((m) => ({ ...m, date: now })) };
          if (t.snoozedUntil && t.snoozedUntil <= now) return { ...t, snoozedUntil: undefined, unread: true };
          return t;
        }),
      );
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Task reminders: ping everyone doing the task when its time comes (the backend does this for real companies, with
  // push and email too; here only for the demo and the demo company).
  useEffect(() => {
    const tick = () => {
      const now = new Date().toISOString();
      const due = todosRef.current.filter((t) => (!server.on || isSandboxId(t.workspaceId)) && t.remindAt && !t.reminded && !t.done && t.remindAt <= now);
      if (!due.length) return;
      setTodos((ts) => ts.map((t) => (due.some((d) => d.id === t.id) ? { ...t, reminded: true } : t)));
      setNotices((ns) => [
        ...due.flatMap((t) =>
          (t.assignees?.length ? t.assignees : [t.userId || t.createdBy || '']).filter(Boolean).map((who) => ({ id: uid(), userId: who, workspaceId: t.workspaceId ?? '', kind: 'task' as const, text: `Reminder: “${t.title}”${t.due ? `, due ${dueWords(t.due)}` : ''}`, at: now, read: false, link: { app: 'tasks' as const, id: t.id } })),
        ),
        ...ns,
      ]);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A time block for a task just ended and the task isn't done: offer to extend it (once per block).
  const askedBlocks = useRef(new Set<string>());
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const ended = events.find(
        (e) => e.taskId && (e.userId ?? user.id) === user.id && !askedBlocks.current.has(e.id) && new Date(e.end).getTime() <= now && now - new Date(e.end).getTime() < 15 * 60_000 && todos.some((t) => t.id === e.taskId && !t.done),
      );
      if (!ended) return;
      askedBlocks.current.add(ended.id);
      showToast({
        text: `Time’s up for “${ended.title}”, but it isn’t done`,
        action: { label: 'Extend 30 min', run: () => setEvents((es) => es.map((e) => (e.id === ended.id ? { ...e, end: new Date(Math.max(Date.now(), new Date(e.end).getTime()) + 30 * 60_000).toISOString() } : e))) },
        ms: 15000,
      });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [events, todos]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchThread = (id: string, patch: Partial<Thread>) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /* ---------------- AI to-dos ---------------- */

  /** Reads new inbox mail and adds the tasks it asks of you. */
  const scan = async (force = false) => {
    // Automatic, once, and only for real client mail: the admin can switch it off, and newsletters,
    // receipts and no-reply senders never reach the AI.
    if (!force && ws.ai?.auto.emailTodos === false) return;
    const clientDomains = new Set(wsClients.map((c) => c.domain).filter(Boolean) as string[]);
    const known = new Set(wsThreads.flatMap((t) => (t.messages.some((m) => isMine(m.from.email)) ? t.messages.flatMap((m) => m.to.map((p) => p.email.toLowerCase())) : [])));
    const fresh = wsThreads.filter((t) => {
      if (t.location !== 'inbox' || fromBlocked(t)) return false;
      const last = t.messages[t.messages.length - 1];
      if (isMine(last.from.email) || last.listUnsubscribe) return false;
      const from = last.from.email.toLowerCase();
      if (/no-?reply|notifications?@|billing@|receipts?@|invoice/i.test(from)) return false;
      if (!force && !clientDomains.has(from.split('@')[1]) && !known.has(from) && !isTeam(from)) return false;
      return force || (!scanned.has(`${user.id}:${t.id}:${last.id}`) && !t.scannedFor?.includes(`${user.id}:${last.id}`));
    });
    if (!fresh.length) return;
    // Claim every thread up front so overlapping scans never read the same email twice.
    for (const t of fresh) scanned.add(`${user.id}:${t.id}:${t.messages[t.messages.length - 1].id}`);
    setScanning(true);
    let added = 0;
    for (const t of fresh) {
      const last = t.messages[t.messages.length - 1];
      try {
        const found = await ai.todos(t, settings.name || user.name);
        // A project's email is shared work: if a teammate's app already made this to-do, don't make it again for you.
        const shared = !!clientForThread(t);
        const have = new Set(todosRef.current.filter((x) => x.threadId === t.id && (shared || x.userId === user.id)).map((x) => x.title.toLowerCase()));
        const next = found
          .filter((f) => !have.has(f.title.toLowerCase()))
          .map<Todo>((f) => ({ id: uid(), title: f.title, due: f.due ?? undefined, priority: f.priority, done: false, status: stageIdFor({ workspaceId: ws.id }, 'open'), threadId: t.id, source: 'ai', userId: user.id, createdBy: user.id, workspaceId: ws.id, clientId: clientForThread(t)?.id, createdAt: new Date().toISOString() }));
        // Remember it on the email itself, so no reload or other device reads it again.
        const mark = `${user.id}:${last.id}`;
        setThreads((ts) => ts.map((x) => (x.id === t.id && !x.scannedFor?.includes(mark) ? { ...x, scannedFor: [...(x.scannedFor ?? []), mark].slice(-20) } : x)));
        if (next.length) {
          todosRef.current = [...todosRef.current, ...next];
          setTodos((list) => [...list, ...next]);
          added += next.length;
        }
      } catch {
        // AI unavailable — try again on the next scan
        scanned.delete(`${user.id}:${t.id}:${last.id}`);
      }
    }
    setScanning(false);
    setTimeout(() => {
      if (added)
        showToast({
          text: `✨ Found ${added} to-do${added > 1 ? 's' : ''} in your email`,
          action: { label: 'View', run: () => openTasks({ kind: 'mine' }) },
        });
      else if (force) showToast({ text: 'No new to-dos found' });
    });
  };

  useEffect(() => {
    scan();
  }, [wsThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "Make a task" on an email: a task from it for you, with its project and a link back to the email. */
  const taskFromThread = (id: string) => {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    const task = createTask({ title: t.subject.replace(/^((re|fwd?)\s*:\s*)+/i, '').trim() || 'Follow up on this email', userId: user.id, source: 'ai', threadId: t.id, clientId: clientForThread(t)?.id });
    tried('email-task');
    showToast({ text: 'Task made from this email', action: { label: 'Open', run: () => openTask(task.id) } });
  };
  const toggleTodo = (id: string) => {
    const t = todos.find((x) => x.id === id);
    if (t) setTaskStatus(id, stageIdFor(t, t.done ? 'open' : 'done'));
  };
  /** Deletes tasks, with Undo (quiet: no toast, e.g. undoing an add that just happened). */
  const deleteTodo = (ids: string | string[], quiet = false) => {
    const gone = new Set(Array.isArray(ids) ? ids : [ids]);
    const snapshot = todos;
    setTodos((list) => list.filter((t) => !gone.has(t.id)));
    if (!quiet) showToast({ text: gone.size === 1 ? 'Task deleted' : `${gone.size} tasks deleted`, action: { label: 'Undo', run: () => setTodos(snapshot) } });
  };
  const todoToCalendar = (t: Todo) => {
    const start = new Date(`${t.due ?? localDay(new Date(Date.now() + 86_400_000))}T09:00`);
    const ev: CalEvent = {
      id: uid(),
      title: t.title,
      calendarId: 'work',
      start: start.toISOString(),
      end: new Date(start.getTime() + 30 * 60_000).toISOString(),
      threadId: t.threadId,
      taskId: t.id,
      workspaceId: ws.id,
      userId: user.id,
    };
    setEvents((es) => [...es, ev]);
    showToast({
      text: `Added to calendar · ${start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} 9:00`,
      action: { label: 'View', run: () => { go('calendar'); setCalCursor(start); setSelectedEventId(ev.id); } },
    });
  };

  /* ---------------- Unsubscribe & block ---------------- */

  const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? email;

  const unsubscribe = (t: Thread) => {
    const m = [...t.messages].reverse().find((x) => x.listUnsubscribe);
    const from = incomingFrom(t);
    if (!m || !from) return;
    const at = new Date().toISOString();
    const link = m.listUnsubscribe!.url;
    const openPage = () => /^https?:\/\//i.test(link) && window.open(link, '_blank', 'noopener,noreferrer');
    if (!demoOk) {
      // Senders without one-click unsubscribe: their own page, opened from this click so it isn't blocked.
      if (!m.listUnsubscribe!.oneClick) {
        openPage();
        setUnsubscribed((u) => ({ ...u, [domainOf(from.email)]: at }));
        showToast({ text: `${from.name}’s unsubscribe page is open. Finish there.`, ms: 6000 });
        return;
      }
      // One-click senders (RFC 8058): the server sends the request for you.
      void fetch('/api/mail/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: t.id }) })
        .then(async (r) => ({ ok: r.ok, d: (await r.json().catch(() => ({}))) as { error?: string; open?: string } }))
        .then(
          ({ ok, d }) => {
            if (ok) {
              setUnsubscribed((u) => ({ ...u, [domainOf(from.email)]: at }));
              showToast({ text: `Unsubscribed from ${from.name}` });
            } else showToast({ text: d.error ?? 'Couldn’t unsubscribe. Try again.', ms: 7000, action: d.open ? { label: 'Open their page', run: () => void openPage() } : undefined });
          },
          () => showToast({ text: 'No connection. Try again.' }),
        );
      return;
    }
    setUnsubscribed((u) => ({ ...u, [domainOf(from.email)]: at }));
    showToast({ text: `Unsubscribed from ${from.name}${m.listUnsubscribe!.oneClick ? '' : ', request sent'}` });

    // DEMO ONLY: senders without one-click unsubscribe often keep mailing. Simulate that,
    // so the "still sending → Block" flow can be tried.
    if (demoOk && !m.listUnsubscribe!.oneClick)
      setTimeout(() => {
        const again: Thread = {
          id: uid(),
          accountId: t.accountId,
          subject: 'LAST CHANCE 🔥 Extra 10% off ends tonight',
          location: 'inbox',
          starred: false,
          unread: true,
          labels: [],
          messages: [
            { id: uid(), from, to: t.messages[0].to, date: new Date().toISOString(), body: 'Final hours! Use code LAST10 for an extra 10% off.', listUnsubscribe: m.listUnsubscribe, trackersBlocked: 4 },
          ],
        };
        setThreads((ts) => [again, ...ts]);
        showToast({ text: `${from.name} emailed you again after you unsubscribed`, ms: 8000, action: { label: 'Block', run: () => setBlockTarget(again) } });
      }, 8000);
  };

  const blockSender = (rule: { value: string; kind: 'address' | 'domain' }, deleteExisting: boolean) => {
    const prevThreads = threads;
    const r: BlockRule = { id: uid(), ...rule, value: rule.value.toLowerCase(), at: new Date().toISOString() };
    const matches = (email: string) => (r.kind === 'address' ? email.toLowerCase() === r.value : email.toLowerCase().endsWith('@' + r.value));
    setBlocked((b) => [...b, r]);
    if (deleteExisting)
      setThreads((ts) => ts.map((t) => (myAccounts.some((a) => a.id === t.accountId) && incomingFrom(t) && matches(incomingFrom(t)!.email) ? { ...t, location: 'trash' } : t)));
    if (blockTarget && selectedId === blockTarget.id) {
      setSelectedId(null);
      setReaderOpen(false);
    }
    setBlockTarget(null);
    showToast({
      text: `Blocked ${r.kind === 'domain' ? '@' + r.value : r.value}. Future emails are deleted on arrival`,
      ms: 7000,
      action: {
        label: 'Undo',
        run: () => {
          setBlocked((b) => b.filter((x) => x.id !== r.id));
          setThreads(prevThreads);
        },
      },
    });
  };


  /* ---------------- Team: tasks, clients, chat, notifications ---------------- */

  // The company's apps, minus the ones this person hid from their own sidebar (Settings, Your apps).
  // Projects used to live inside Tasks: companies that chose their apps before it existed get it with Tasks.
  // Projects and Teams came after some companies picked their apps: they're on wherever Tasks is.
  const companyApps: AppId[] = ws.apps ? (ws.apps.includes('tasks') ? [...new Set<AppId>([...ws.apps, 'projects', 'teams'])] : ws.apps) : APPS.map((a) => a.id);
  const myHidden: AppId[] = user.hiddenApps ?? [];
  const imAdmin = ws.members.some((m) => m.userId === user.id && m.role !== 'member');
  // Members only see an app once it works; admins still see it, with the steps to set it up.
  const notReady = new Set<AppId>(!imAdmin && !demoOk && myAccounts.length && !mailIn && !mailOut ? ['mail'] : []);
  const enabledApps: AppId[] = companyApps.filter((a) => a === 'home' || (!myHidden.includes(a) && !notReady.has(a)));
  const enabled = new Set<string>(enabledApps);
  const setMyHidden = (list: AppId[]) => {
    onUpdateUser({ hiddenApps: list });
    if (list.includes(mode as AppId)) go('home');
  };
  const [askedApps, setAskedApps] = useState<AppId[]>([]);
  /** Someone wants an app the company switched off: every owner and admin gets a notification with a way to switch it on. */
  const askForApp = (id: AppId) => {
    const admins = ws.members.filter((m) => m.role !== 'member' && m.userId !== user.id).map((m) => m.userId);
    const name = APPS.find((a) => a.id === id)?.name ?? id;
    admins.forEach((a) => notify(a, 'task', `${myFirst} asked to switch on ${name} for ${ws.name}`, { app: 'settings', id: 'apps' }));
    setAskedApps((l) => [...l, id]);
    showToast({ text: admins.length ? `Asked ${admins.map(firstOf).join(', ')}` : 'There’s no other admin to ask yet' });
  };
  useEffect(() => {
    if (mode !== 'settings' && !enabled.has(mode)) setMode('home');
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = useMemo(() => ws.members.map((m) => allUsers.find((u) => u.id === m.userId)).filter(Boolean) as User[], [ws.members, allUsers]);
  // Every client, including past ones (client pages, search, history) …
  const wsClientsAll = useMemo(() => clients.filter((c) => c.workspaceId === ws.id), [clients, ws.id]);
  // … and the ones you work with now (pickers, sidebars, Home, filing).
  const wsClients = useMemo(() => wsClientsAll.filter((c) => c.status !== 'ended'), [wsClientsAll]);
  const wsTeams = useMemo(() => teams.filter((t) => t.workspaceId === ws.id), [teams, ws.id]);
  /** A new project, from anywhere (any project picker, ⌘K, the Projects app). Returns it so the picker can select it. */
  const createProject = (name: string, extra: Partial<Client> = {}): Client => {
    const c: Client = { id: uid(), workspaceId: ws.id, name: name.trim(), color: ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444'][wsClientsAll.length % 6], status: 'active', since: nowIso(), ownerId: user.id, ...extra };
    setClients((cs) => [...cs, c]);
    showToast({ text: `${c.name} added`, action: { label: 'Open', run: () => openClient(c.id) } });
    return c;
  };
  const projectsCtx = useMemo(() => ({ create: (name: string) => createProject(name) }), [ws.id, wsClientsAll.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const allWsTasks = useMemo(() => todos.filter((t) => (t.workspaceId ?? 'pnp') === ws.id), [todos, ws.id]);
  // Who sees which tasks: owners and admins see everything; everyone else sees their own work,
  // their teams' work, the clients they work on, and the channels they're in.
  const isAdmin = ws.members.some((m) => m.userId === user.id && m.role !== 'member');
  const perms = { ...DEFAULT_PERMISSIONS, ...ws.permissions };
  // What the server didn't keep, and a session that ended elsewhere.
  useEffect(() => {
    const failed = (e: Event) => showToast({ text: (e as CustomEvent<{ error?: string }>).detail.error ?? 'That change couldn’t be saved.', ms: 7000 });
    const out = () => showToast({ text: 'You were signed out (your password changed, or the session ended). Sign in again.', action: { label: 'Sign in', run: () => location.reload() }, ms: 20000 });
    window.addEventListener('s2g:save-failed', failed);
    window.addEventListener('s2g:signed-out', out);
    return () => (window.removeEventListener('s2g:save-failed', failed), window.removeEventListener('s2g:signed-out', out));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* quotes and contracts */
  const wsQuotes = useMemo(() => quotes.filter((q) => q.workspaceId === ws.id), [quotes, ws.id]);
  const saveQuote = (q: Quote) => setQuotes((qs) => (qs.some((x) => x.id === q.id) ? qs.map((x) => (x.id === q.id ? q : x)) : [...qs, q]));
  const sendQuote = (q: Quote) => {
    const sent: Quote = { ...q, status: 'sent', sentAt: nowIso() };
    saveQuote(sent);
    const client = wsClientsAll.find((c) => c.id === q.clientId);
    // The guests who can accept hear about it in their shared space.
    (client ? clientPeople(client, channels) : []).filter((x) => x.status !== 'pending' && x.role === 'approver').forEach((x) => notify(clientInbox(x.email), 'task', `${ws.name} sent you a quote: ${q.title}`, { app: 'projects', id: q.clientId }));
    showToast({ text: client ? `Sent to ${client.name}. They see it in their shared space.` : 'Sent' });
  };
  /** An accepted quote becomes a brief: one task per line, due by its days (or spaced a few days apart). */
  const briefFromQuote = (q: Quote) => {
    const client = wsClientsAll.find((c) => c.id === q.clientId);
    const start = localDay();
    const brief = createTask({ kind: 'brief', title: q.title, context: [q.intro, q.terms ? `Terms: ${q.terms}` : '', `Quote accepted${q.signature ? ` by ${q.signature}` : ''}: ${q.items.map((i) => `${i.title} (${i.qty} × ${i.price})`).join(', ')}`].filter(Boolean).join('\n\n'), clientId: q.clientId, userId: user.id, due: addWorkdays(start, Math.max(5, ...q.items.map((i, k) => i.days ?? (k + 1) * 3))), source: 'manual' });
    q.items.forEach((i, k) => createTask({ title: i.title, briefId: brief.id, clientId: q.clientId, userId: '', due: addWorkdays(start, i.days ?? (k + 1) * 3), source: 'manual' }));
    saveQuote({ ...q, briefId: brief.id });
    showToast({ text: `Brief made from the quote${client ? ` for ${client.name}` : ''}`, action: { label: 'Open', run: () => openTask(brief.id) } });
  };
  /** A guest's answer, when they're viewed or hosted from here (real guests answer through the server's rules). */
  const decideQuote = (email: string) => (id: string, status: 'accepted' | 'declined', text: string) => {
    setQuotes((qs) => qs.map((x) => (x.id === id && x.status === 'sent' ? { ...x, status, decidedAt: nowIso(), decidedBy: email, signature: status === 'accepted' ? text || email : undefined, note: status === 'declined' && text ? text : undefined } : x)));
    const q = quotes.find((x) => x.id === id);
    if (q) notify(q.createdBy, 'task', `${email} ${status} your quote “${q.title}”`, { app: 'projects', id: q.clientId });
  };
  // A quote accepted by a guest: tell its author (notices to teammates come from the app that saw the change).
  const seenQuotes = useRef(new Map<string, string>());
  useEffect(() => {
    for (const q of wsQuotes) {
      const was = seenQuotes.current.get(q.id);
      if (was && was === 'sent' && (q.status === 'accepted' || q.status === 'declined') && q.decidedBy?.includes('@') && q.createdBy === user.id)
        showToast({ text: `${q.decidedBy} ${q.status} “${q.title}”`, action: q.status === 'accepted' && !q.briefId ? { label: 'Make the brief', run: () => briefFromQuote(q) } : undefined });
      seenQuotes.current.set(q.id, q.status);
    }
  }, [wsQuotes]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Out of the huddle: off the channel's list; the huddle ends when nobody is left. */
  const leaveHuddle = () => {
    const id = huddleId;
    setHuddleId(null);
    if (!id) return;
    setChannels((cs) =>
      cs.map((c) => {
        if (c.id !== id || !c.huddle) return c;
        const members = c.huddle.members.filter((m) => m !== user.id);
        return { ...c, huddle: members.length ? { ...c.huddle, members } : undefined };
      }),
    );
  };
  const huddleChannel = huddleId ? channels.find((c) => c.id === huddleId) : undefined;
  // Dropped from the list elsewhere (the huddle ended, or this account left on another device): stop here too.
  useEffect(() => {
    if (huddleId && !huddleChannel?.huddle?.members.includes(user.id)) setHuddleId(null);
  }, [huddleId, huddleChannel?.huddle?.members, user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const myTeamIds = useMemo(() => teams.filter((t) => t.workspaceId === ws.id && (t.members.includes(user.id) || t.leadId === user.id)).map((t) => t.id), [teams, ws.id, user.id]);
  const myClientIds = useMemo(
    () =>
      clients
        .filter(
          (c) =>
            c.workspaceId === ws.id &&
            (c.ownerId === user.id ||
              (c.members ?? []).some((m) => m.userId === user.id) ||
              channels.some((ch) => ch.clientId === c.id && ch.members.includes(user.id)) ||
              allWsTasks.some((t) => t.clientId === c.id && (t.userId === user.id || t.assignees?.includes(user.id) || t.supervisorId === user.id))),
        )
        .map((c) => c.id),
    [clients, channels, allWsTasks, ws.id, user.id],
  );
  const wsTasks = useMemo(
    () =>
      isAdmin
        ? allWsTasks
        : allWsTasks.filter(
            (t) =>
              t.userId === user.id ||
              t.assignees?.includes(user.id) ||
              t.supervisorId === user.id ||
              t.followers?.includes(user.id) ||
              t.createdBy === user.id ||
              (t.teamId && myTeamIds.includes(t.teamId)) ||
              (t.clientId && (perms.seeAllProjects || myClientIds.includes(t.clientId))) ||
              (t.channelId && channels.some((c) => c.id === t.channelId && c.members.includes(user.id))),
          ),
    [allWsTasks, isAdmin, user.id, myTeamIds, myClientIds, channels, perms.seeAllProjects],
  );
  const wsChannels = useMemo(() => channels.filter((c) => c.workspaceId === ws.id && c.members.includes(user.id) && !c.archived), [channels, ws.id, user.id]);
  // Channels I can see in the sidebar: mine, plus public ones I could join.
  const visibleChannels = useMemo(() => channels.filter((c) => c.workspaceId === ws.id && !c.archived && (c.members.includes(user.id) || (c.kind === 'channel' && !c.private))), [channels, ws.id, user.id]);
  const myRole = ws.members.find((m) => m.userId === user.id)?.role ?? 'member';
  const myPortals = useMemo(() => portalsFor(user.email, workspaces.map((w) => w.id), allWorkspaces, clients, channels), [user.email, workspaces, allWorkspaces, clients, channels]);
  const portalItems = myPortals.map((pt) => ({ key: pt.key, ws: pt.ws, client: pt.client, unread: notices.filter((n) => !n.read && n.workspaceId === pt.ws.id && (n.userId === user.id || n.userId === clientInbox(user.email))).length }));
  const myNotices = useMemo(() => notices.filter((n) => n.userId === user.id && n.workspaceId === ws.id), [notices, user.id, ws.id]);
  const wsMeetings = useMemo(() => meetings.filter((m) => m.workspaceId === ws.id), [meetings, ws.id]);
  const firstOf = (id?: string) => (allUsers.find((u) => u.id === id)?.name ?? 'Someone').split(' ')[0];
  const myFirst = (settings.name || user.name).split(' ')[0];
  const nowIso = () => new Date().toISOString();

  /** Which client an email belongs to, by the sender's domain. */
  function clientForThread(t: Thread) {
    return wsClientsAll.find((c) => c.domain && t.messages.some((m) => [m.from, ...m.to].some((p) => p.email.toLowerCase().endsWith('@' + c.domain))));
  }

  const chatUnread = useMemo(() => {
    const out: Record<string, number> = {};
    const fallback = new Date(Date.now() - 90 * 60_000).toISOString();
    for (const c of wsChannels) {
      const since = lastRead[c.id] ?? fallback;
      const n = messages.filter((m) => m.channelId === c.id && m.userId !== user.id && m.at > since && (!m.parentId || m.alsoInChannel)).length;
      if (n) out[c.id] = n;
    }
    return out;
  }, [wsChannels, messages, lastRead, user.id]);
  const chatLastAt = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of messages) if (!out[m.channelId] || m.at > out[m.channelId]) out[m.channelId] = m.at;
    return out;
  }, [messages]);
  const chatUnreadTotal = Object.values(chatUnread).reduce((a, b) => a + b, 0);

  // Chat always opens on a channel (the first one, usually #general), also after switching workspace.
  useEffect(() => {
    if (mode === 'chat' && !mobile && !wsChannels.some((c) => c.id === chatId) && wsChannels.length) setChatId(wsChannels[0].id);
  }, [mode, chatId, wsChannels]);

  // "Since my last visit" needs the time I last read a channel, before opening it now marks it read.
  const [sinceRead, setSinceRead] = useState(() => new Date(Date.now() - 90 * 60_000).toISOString());
  useEffect(() => {
    if (chatId) setSinceRead(lastRead[chatId] ?? new Date(Date.now() - 90 * 60_000).toISOString());
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** What one AI channel summary costs this company, said plainly. */
  const summaryCost = (() => {
    const trial = !!ws.plan?.trialEnds && ws.plan.trialEnds > nowIso();
    const included = ((ws.plan?.track === 'ai' && ws.plan.tier !== 'free') || trial) && ws.ai?.payer !== 'own';
    if (included) return 'about 1 summary from your AI allowance';
    const job = ws.ai?.jobs.digest ?? ws.ai?.jobs.summary;
    const c = job ? costPer100(JOBS.find((j) => j.id === 'digest')!, job.provider, job.model) : null;
    return c !== null && c !== undefined ? `about ${rp(c / 100)} on your own AI key` : 'a small amount on your own AI key';
  })();

  // Reading a channel marks it read.
  useEffect(() => {
    if (mode === 'chat' && chatId) setLastRead((r) => ({ ...r, [chatId]: nowIso() }));
  }, [mode, chatId, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const notify = (userId: string, kind: Notice['kind'], text: string, link?: Notice['link']) => {
    if (userId === user.id) return;
    setNotices((ns) => [{ id: uid(), userId, workspaceId: ws.id, kind, text, at: nowIso(), read: false, link }, ...ns]);
  };

  /** Saves this company's teams. A new team gets its own channel; people added to a team join it and hear about it. */
  const saveTeams = (t: Team[]) => {
    const fresh = t.filter((x) => !wsTeams.some((y) => y.id === x.id));
    fresh.forEach((tm) => {
      const id = uid();
      setChannels((cs) => [...cs, { id, workspaceId: ws.id, kind: 'channel', name: tm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), members: [...new Set([user.id, ...tm.members])], teamId: tm.id, topic: `${tm.name} team`, category: 'team', ownerId: user.id, createdAt: nowIso() }]);
    });
    t.forEach((tm) => {
      const before = wsTeams.find((x) => x.id === tm.id);
      tm.members.filter((m) => m !== user.id && !before?.members.includes(m)).forEach((m) => notify(m, 'team', `${user.name} added you to ${tm.name}`, { app: 'teams', id: tm.id }));
      setChannels((cs) => cs.map((c) => (c.teamId === tm.id ? { ...c, members: [...new Set([...c.members, ...tm.members])] } : c)));
    });
    setTeams((all) => [...all.filter((x) => x.workspaceId !== ws.id), ...t]);
  };
  const teamActions: TeamActions = {
    patch: (id, p) => saveTeams(wsTeams.map((t) => (t.id === id ? { ...t, ...p } : t))),
    direct: (t) => t.join === 'open' || isAdmin,
    join: (t) => {
      if (t.join === 'open' || isAdmin) {
        saveTeams(wsTeams.map((x) => (x.id === t.id ? { ...x, members: [...new Set([...x.members, user.id])], requests: (x.requests ?? []).filter((r) => r.userId !== user.id) } : x)));
        return showToast({ text: `You joined ${t.name}` });
      }
      saveTeams(wsTeams.map((x) => (x.id === t.id ? { ...x, requests: [...(x.requests ?? []).filter((r) => r.userId !== user.id), { userId: user.id, at: nowIso() }] } : x)));
      const to = t.leadId ? [t.leadId] : ws.members.filter((m) => m.role !== 'member').map((m) => m.userId);
      to.forEach((id) => notify(id, 'team', `${user.name} asked to join ${t.name}`, { app: 'teams', id: t.id }));
      showToast({ text: t.leadId ? `Asked ${firstOf(t.leadId)} to add you` : 'Asked an admin to add you' });
    },
    leave: (t) => {
      saveTeams(wsTeams.map((x) => (x.id === t.id ? { ...x, members: x.members.filter((m) => m !== user.id), leadId: x.leadId === user.id ? undefined : x.leadId } : x)));
      showToast({ text: `You left ${t.name}` });
    },
    remove: (t) => {
      saveTeams(wsTeams.filter((x) => x.id !== t.id));
      setTeamId(null);
      showToast({ text: `${t.name} deleted. Its tasks keep their ${term.many}` });
    },
  };
  const canCreateTeams = isAdmin || perms.createTeams;
  const canCreateProjects = isAdmin || perms.createProjects;
  const seesAllProjects = isAdmin || perms.seeAllProjects;

  /** The DM channel between me and someone (created on first use). */
  const dmWith = (otherId: string) => {
    const found = channels.find((c) => c.workspaceId === ws.id && c.kind === 'dm' && c.members.includes(user.id) && c.members.includes(otherId));
    if (found) return found.id;
    const id = uid();
    setChannels((cs) => [...cs, { id, workspaceId: ws.id, kind: 'dm', name: '', members: [user.id, otherId] }]);
    return id;
  };

  const postChat = (channelId: string, text: string, taskId?: string, fromId = user.id) =>
    setMessages((ms) => [...ms, { id: uid(), channelId, userId: fromId, text, at: nowIso(), taskId }]);

  /** A short email from me to a teammate (used for task notifications). */
  const emailTeammate = (toId: string, subject: string, text: string) => {
    const to = allUsers.find((u) => u.id === toId);
    const from = myAccounts.find((a) => a.kind === 'personal') ?? myAccounts[0];
    if (!to || !from) return;
    deliver({ to: [{ name: to.name, email: to.email }], cc: [], subject, html: textToHtml(text) + settings.signature, text, files: [], track: false, trackOptions: DEFAULT_TRACK_OPTIONS, fromId: from.id });
  };

  const describe = (t: Pick<Todo, 'title' | 'clientId' | 'due'>) => {
    const c = wsClients.find((x) => x.id === t.clientId);
    return `“${t.title}”${c ? ` for ${c.name}` : ''}${t.due ? `, due ${dueWords(t.due)}` : ''}`;
  };

  const createTask = (
    t: {
      title: string;
      clientId?: string;
      teamId?: string;
      briefId?: string;
      meetingId?: string;
      saidAt?: number;
      channelId?: string;
      kind?: Todo['kind'];
      context?: string;
      userId: string;
      due?: string;
      priority?: 'high' | 'normal';
      source: Todo['source'];
      threadId?: string;
      checklist?: Todo['checklist'];
      repeat?: Todo['repeat'];
      assignees?: string[]; // everyone doing it (Quick Add's "+dewi +rizky"); userId is the first
      remindAt?: string;
      status?: TaskStatus;
      notes?: string;
    },
    tell: { chat?: boolean; email?: boolean } = {},
  ) => {
    const task: Todo = {
      id: uid(),
      kind: t.kind,
      title: t.title,
      clientId: t.clientId,
      teamId: t.teamId,
      briefId: t.briefId,
      meetingId: t.meetingId,
      saidAt: t.saidAt,
      channelId: t.channelId,
      context: t.context,
      userId: t.userId,
      due: t.due,
      priority: t.priority ?? 'normal',
      done: false,
      status: t.status && stagesFor(ws.id).some((s) => s.id === t.status && s.kind !== 'done') ? t.status : stageIdFor({ workspaceId: ws.id }, t.kind === 'brief' ? 'active' : 'open'),
      source: t.source,
      createdBy: user.id,
      workspaceId: ws.id,
      threadId: t.threadId,
      checklist: t.checklist,
      repeat: t.repeat,
      ...(t.remindAt ? { remindAt: t.remindAt, reminded: false } : {}),
      ...(t.notes ? { notes: t.notes } : {}),
      createdAt: nowIso(),
      assignees: t.assignees?.length ? t.assignees : t.userId ? [t.userId] : [],
      supervisorId: user.id, // whoever assigns it supervises it, unless someone changes it
      history: [{ id: uid(), at: nowIso(), by: user.id, kind: 'created', text: `created this${{ ai: ' from an email', manual: '', braindump: ' from a brain dump', chat: ' from chat', meeting: ' from a meeting', request: ' from a request', import: ' from an import' }[t.source]}${t.userId && t.userId !== user.id ? ` for ${firstOf(t.userId)}` : ''}` }],
    };
    setTodos((ts) => [...ts, task]);
    // Not assigned yet: tell the team lead it's waiting in their queue.
    if (!t.userId && t.teamId) {
      const tm = wsTeams.find((x) => x.id === t.teamId);
      if (tm?.leadId && tm.leadId !== user.id) notify(tm.leadId, 'task', `New in ${tm.name}’s queue: ${describe(task)}. Pick someone for it.`, { app: 'tasks', id: task.id });
    }
    for (const who of (task.assignees ?? []).filter((x) => x !== user.id)) {
      notify(who, 'task', `${myFirst} assigned you ${describe(task)}`, { app: 'tasks', id: task.id });
      if (tell.chat) postChat(dmWith(who), `📌 New task for you: ${describe(task)}`, task.id);
      if (tell.email)
        emailTeammate(who, `New task: ${task.title}`, `Hi ${firstOf(who)},\n\nI've assigned you a task: ${describe(task)}.\n\nYou'll find it in ${product.name} under Tasks.`);
    }
    return task;
  };

  function setTaskStatus(id: string, requested: TaskStatus, quiet = false) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    // Stages are the company's own; what happens depends on the kind of stage, not on its name.
    const list = stagesFor(t.workspaceId);
    const target = list.find((s) => s.id === requested);
    if (!target) return;
    const from = stageOf(t, list);
    // The review step: when the team asks for it, finishing a task sends it to the supervisor first.
    const team = teams.find((x) => x.id === t.teamId);
    const reviewStage = firstStage('review', list);
    const needsReview = target.kind === 'done' && !!reviewStage && !!team?.review && !!t.supervisorId && t.supervisorId !== user.id && !doersOf(t).includes(t.supervisorId) && from.kind !== 'review';
    const to = needsReview ? reviewStage : target;
    const status: TaskStatus = to.id;
    const done = to.kind === 'done';
    const before = { status: t.status, done: t.done, doneAt: t.doneAt, doneBy: t.doneBy, history: t.history };
    if (to.id !== from.id) {
      tried('stage');
      const text = needsReview
        ? 'finished it and sent it for review'
        : done && !t.done
          ? from.kind === 'review'
            ? 'approved it'
            : 'marked it done'
          : !done && t.done
            ? to.kind === 'open'
              ? 'reopened it'
              : `reopened it (${stageName(to)})`
            : to.kind === 'active' && from.kind === 'open'
              ? 'started it'
              : `moved it to ${stageName(to)}`;
      logTask(id, needsReview || from.kind === 'review' ? 'review' : 'status', text);
    }
    if (needsReview) {
      setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, status, done: false } : x)));
      notify(t.supervisorId!, 'task', `${myFirst} finished ${describe(t)}. Ready for your review`, { app: 'tasks', id });
      if (!quiet) showToast({ text: `Sent to ${firstOf(t.supervisorId)} for review` });
      return;
    }
    // A repeating task: finishing it creates the next one.
    const next: Todo | undefined =
      done && !t.done && t.repeat
        ? {
            ...t,
            id: uid(),
            status: stageIdFor(t, 'open', list),
            done: false,
            doneAt: undefined,
            doneBy: undefined,
            due: nextDue(t.due, t.repeat),
            remindAt: t.remindAt && t.due ? new Date(new Date(t.remindAt).getTime() + (new Date(nextDue(t.due, t.repeat)).getTime() - new Date(t.due).getTime())).toISOString() : undefined,
            reminded: false,
            checklist: t.checklist?.map((c) => ({ ...c, done: false })),
            approval: undefined,
            createdAt: nowIso(),
            history: [{ id: uid(), at: nowIso(), by: user.id, kind: 'created', text: `created this (repeats ${t.repeat === 'weekdays' ? 'every weekday' : t.repeat})` }],
          }
        : undefined;
    if (next) setTodos((ts) => [...ts, next]);
    setTodos((ts) =>
      ts.map((x) =>
        x.id === id ? { ...x, status, done, doneAt: done ? (x.done ? x.doneAt : nowIso()) : undefined, doneBy: done ? (x.done ? x.doneBy : user.id) : undefined } : x,
      ),
    );
    // Requests: the client sees each status change.
    if (t.requestedBy && requestStatus(t).label !== requestStatus({ ...t, status, done }).label) tellClient(t, `Your request “${t.title}” is now: ${requestStatus({ ...t, status, done }).label}`);
    else if (t.visibleToClient && done && !t.done) tellClient(t, `“${t.title}” is done`);
    if (done && !t.done) {
      const tell = new Set([t.supervisorId ?? t.createdBy, ...(t.followers ?? []), ...(from.kind === 'review' ? doersOf(t) : [])].filter((x): x is string => !!x && x !== user.id));
      tell.forEach((uid2) => notify(uid2, 'done', from.kind === 'review' ? `${myFirst} approved ${describe(t)}` : `${myFirst} finished ${describe(t)}`, { app: 'tasks', id: t.id }));
      // Finishing the last task of a brief tells the person in charge.
      const br = t.briefId ? todos.find((x) => x.id === t.briefId) : undefined;
      if (br && br.userId !== user.id && todos.filter((x) => x.briefId === br.id && x.id !== id).every((x) => x.done))
        notify(br.userId, 'done', `All tasks in the brief “${br.title}” are done`, { app: 'tasks', id: br.id });
      // Celebrate in the client's (or team's) channel, and with a little confetti for the person who finished it.
      if (ws.chat?.celebrations !== false && !isBrief(t)) {
        const ch = channels.find((c) => c.workspaceId === ws.id && !c.archived && c.kind === 'channel' && c.category !== 'shared' && ((t.clientId && c.clientId === t.clientId) || (!t.clientId && t.teamId && c.teamId === t.teamId)));
        if (ch) setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: user.id, text: `${myFirst} finished “${t.title}”`, at: nowIso(), kind: 'celebration', taskId: t.id }]);
        if (!quiet) celebrate();
      }
      if (!quiet) offerInstall(); // finishing something is a good moment to offer the app
      if (!quiet)
        showToast({
          text: next ? `Done. The next one is due ${dueWords(next.due!)}` : `Done: ${t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title}`,
          action: { label: 'Undo', run: () => setTodos((ts) => ts.filter((x) => x.id !== next?.id).map((x) => (x.id === id ? { ...x, ...before } : x))) },
          ms: 6000,
        });
    }
  }

  const doersOf = (t: Todo) => (t.assignees?.length ? t.assignees : t.userId ? [t.userId] : []);
  /** Adds a line to a task's history. */
  const logTask = (id: string, kind: TaskEvent['kind'], text: string, by = user.id) =>
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, history: [...(x.history ?? []), { id: uid(), at: nowIso(), by, kind, text }] } : x)));

  const patchTask = (id: string, patch: Partial<Todo>) => {
    const t = todos.find((x) => x.id === id);
    // Keep userId (first person doing it) and assignees in step.
    if (patch.userId !== undefined && patch.assignees === undefined && t) patch = { ...patch, assignees: patch.userId ? [patch.userId, ...doersOf(t).filter((x) => x !== patch.userId && x !== t.userId)] : [] };
    if (patch.assignees && patch.userId === undefined) patch = { ...patch, userId: patch.assignees[0] ?? '' };
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (!t) return;
    const before = doersOf(t);
    if (patch.assignees) {
      const added = patch.assignees.filter((x) => !before.includes(x));
      const removed = before.filter((x) => !patch.assignees!.includes(x));
      if (added.length || removed.length)
        logTask(id, 'assigned', [added.length ? `added ${added.map(firstOf).join(', ')}` : '', removed.length ? `removed ${removed.map(firstOf).join(', ')}` : ''].filter(Boolean).join(' and '));
      added.filter((x) => x !== user.id).forEach((x) => notify(x, 'task', `${myFirst} assigned you ${describe(t)}`, { app: 'tasks', id }));
      if (added.length === 1 && added[0] !== user.id) showToast({ text: `Assigned to ${firstOf(added[0])}` });
    }
    if (patch.supervisorId && patch.supervisorId !== t.supervisorId) {
      logTask(id, 'supervisor', `made ${patch.supervisorId === user.id ? 'themselves' : firstOf(patch.supervisorId)} the supervisor`);
      if (patch.supervisorId !== user.id) notify(patch.supervisorId, 'task', `${myFirst} asked you to supervise ${describe(t)}`, { app: 'tasks', id });
    }
    if ('repeat' in patch && patch.repeat !== t.repeat) logTask(id, 'edit', patch.repeat ? `set it to repeat ${patch.repeat === 'weekdays' ? 'every weekday' : patch.repeat}` : 'stopped it repeating');
    if ('due' in patch && patch.due !== t.due) logTask(id, 'due', patch.due ? `moved the due date ${t.due ? `from ${dueLabel(t.due).text} ` : ''}to ${dueLabel(patch.due).text}` : 'removed the due date');
    if (patch.followers) {
      const added = patch.followers.filter((x) => !(t.followers ?? []).includes(x));
      if (added.length) logTask(id, 'edit', `added ${added.map((x) => (x === user.id ? 'themselves' : firstOf(x))).join(', ')} as follower${added.length > 1 ? 's' : ''}`);
    }
  };

  /** A comment on a task: everyone on it hears about it (mentions too). */
  const commentTask = (id: string, text: string, toClient = false) => {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, history: [...(x.history ?? []), { id: uid(), at: nowIso(), by: user.id, kind: 'comment', text, ...(toClient ? { toClient: true } : {}) }] } : x)));
    if (toClient) {
      const c = clients.find((x) => x.id === t.clientId);
      tellClient(t, `${c ? teamLabel(user, accessFor(ws, c), ws.name) : myFirst} replied on “${t.title}”: “${text.slice(0, 80)}”`);
    }
    const tell = new Set([...doersOf(t), t.supervisorId, ...(t.followers ?? []), ...members.filter((u) => new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(text)).map((u) => u.id)].filter((x): x is string => !!x && x !== user.id));
    tell.forEach((x) => notify(x, 'task', `${myFirst} commented on “${t.title}”: “${text.slice(0, 80)}”`, { app: 'tasks', id }));
  };

  /** The supervisor sends a finished task back with a note. */
  const sendBack = (id: string, note: string) => {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, status: stageIdFor(x, 'active'), done: false } : x)));
    logTask(id, 'review', `sent it back: “${note}”`);
    doersOf(t)
      .filter((x) => x !== user.id)
      .forEach((x) => notify(x, 'task', `${myFirst} sent back “${t.title}”: “${note.slice(0, 80)}”`, { app: 'tasks', id }));
    showToast({ text: 'Sent back with your note' });
  };

  /** Creates a brief and its tasks from a template, spaced out in working days. Tasks go to the matching team's queue. */
  const fromTemplate = (tpl: TaskTemplate, o: { clientId?: string; start: string; ownerId: string; skip: number[] }) => {
    const client = wsClients.find((c) => c.id === o.clientId);
    const brief = createTask({ kind: 'brief', title: client ? `${tpl.name}: ${client.name}` : tpl.name, context: tpl.description, clientId: o.clientId, userId: o.ownerId, due: addWorkdays(o.start, Math.max(0, ...tpl.tasks.map((x) => x.days))), source: 'manual' });
    tpl.tasks.forEach((x, i) => {
      if (o.skip.includes(i)) return;
      const tl = x.title.toLowerCase();
      // The team whose keywords match the most (longer matches win ties).
      const team = wsTeams
        .map((tm) => ({ tm, hits: (tm.keywords ?? []).filter((k) => tl.includes(k)) }))
        .filter((x) => x.hits.length)
        .sort((a, b) => b.hits.length - a.hits.length || Math.max(...b.hits.map((k) => k.length)) - Math.max(...a.hits.map((k) => k.length)))[0]?.tm;
      createTask({
        title: x.title,
        briefId: brief.id,
        clientId: o.clientId,
        teamId: team?.id,
        userId: team ? '' : o.ownerId,
        due: addWorkdays(o.start, x.days),
        source: 'manual',
        checklist: x.checklist?.map((text) => ({ id: uid(), text, done: false })),
        repeat: x.repeat,
      });
    });
    setTplOpen(null);
    setTaskOpen(brief.id);
    showToast({ text: `Brief created with ${tpl.tasks.length - o.skip.length} tasks` });
  };
  /** Saves a brief and its tasks as a template the whole company can reuse. */
  const saveTemplate = (briefId: string) => {
    const br = todos.find((x) => x.id === briefId);
    if (!br) return;
    const subs = todos.filter((x) => x.briefId === briefId);
    const start = subs.map((x) => x.due).filter(Boolean).sort()[0] ?? localDay();
    const workdaysBetween = (a: string, b: string) => {
      let n = 0;
      while (a < b && n < 200) ((a = addWorkdays(a, 1)), n++);
      return n;
    };
    const client = wsClients.find((c) => c.id === br.clientId);
    const name = client ? br.title.replace(new RegExp(`[:\\s-]*${client.name}`, 'i'), '').trim() || br.title : br.title;
    setSavedTemplates((ts) => [
      { id: uid(), name, description: br.context ?? '', workspaceId: ws.id, tasks: subs.map((x) => ({ title: x.title, days: x.due ? workdaysBetween(start, x.due) : 0, checklist: x.checklist?.map((c) => c.text), repeat: x.repeat })) },
      ...ts,
    ]);
    showToast({ text: `Saved “${name}” as a template` });
  };

  /** Gives people (and whole teams) every channel in a section of the company sidebar. */
  const setSectionAccess = (sectionId: string, access: { userIds: string[]; teamIds: string[] }) => {
    const layout = fullLayout(ws.chat?.layout);
    const sec = layout.sections.find((x) => x.id === sectionId);
    if (!sec) return;
    const next = { ...sec, access };
    const before = sectionPeople(sec, wsTeams);
    const after = sectionPeople(next, wsTeams);
    const removed = before.filter((x) => !after.includes(x));
    patchWorkspace(ws.id, { chat: { ...(ws.chat ?? { gifs: false, celebrations: true, whoCanCreate: 'everyone' }), layout: { ...layout, sections: layout.sections.map((x) => (x.id === sectionId ? next : x)) } } });
    const inSection = channels.filter((c) => c.workspaceId === ws.id && c.kind === 'channel' && !c.archived && sectionIdOf(layout, c) === sectionId);
    setChannels((cs) => cs.map((c) => (inSection.some((x) => x.id === c.id) ? { ...c, members: [...new Set([...c.members.filter((m) => !removed.includes(m) || m === c.ownerId), ...after])] } : c)));
    after.filter((x) => !before.includes(x) && x !== user.id).forEach((x) => notify(x, 'mention', `${myFirst} gave you access to the ${sec.name} channels`, { app: 'chat' }));
    showToast({ text: `${after.length} ${after.length === 1 ? 'person has' : 'people have'} access to ${sec.name} (${inSection.length} channel${inSection.length === 1 ? '' : 's'})` });
  };
  // Section access stays up to date: channels moved or created in a section, and new team members, get the right people.
  useEffect(() => {
    const layout = fullLayout(ws.chat?.layout);
    if (!layout.sections.some((s) => s.access)) return;
    const missing = channels.filter((c) => {
      if (c.workspaceId !== ws.id || c.kind !== 'channel' || c.archived) return false;
      const sec = layout.sections.find((s) => s.id === sectionIdOf(layout, c));
      return !!sec?.access && sectionPeople(sec, wsTeams).some((x) => !c.members.includes(x));
    });
    if (!missing.length) return;
    setChannels((cs) =>
      cs.map((c) => {
        if (!missing.some((m) => m.id === c.id)) return c;
        const sec = layout.sections.find((s) => s.id === sectionIdOf(layout, c))!;
        return { ...c, members: [...new Set([...c.members, ...sectionPeople(sec, wsTeams)])] };
      }),
    );
  }, [channels, ws.chat?.layout, wsTeams]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Settings, Apps & chat: "Who can create channels" (the server checks it too). */
  const canStartChannels = myRole !== 'member' || ws.chat?.whoCanCreate !== 'admins';
  /** The channel owner and admins can change a channel's category for everyone. */
  const canManageChannel = (c: Channel) => myRole !== 'member' || c.ownerId === user.id;
  /** Moves a channel to another category (sidebar menu or drag and drop). */
  const moveChannel = (id: string, category: ChannelCategory) => {
    const c = channels.find((x) => x.id === id);
    if (!c) return;
    const label = CATEGORY_ONE[category];
    // A client channel needs to know which client: ask in the settings.
    if ((category === 'client' || category === 'shared') && !c.clientId) {
      setChanDialog({ id });
      showToast({ text: `Pick the ${term.one}, then choose the category` });
      return;
    }
    const apply = () => {
      const before = c;
      setChannels((cs) => cs.map((x) => (x.id === id ? { ...x, category, guests: category === 'shared' ? x.guests : [] } : x)));
      showToast({ text: `#${c.name} moved to ${label}`, action: { label: 'Undo', run: () => setChannels((cs) => cs.map((x) => (x.id === id ? before : x))) } });
    };
    // Leaving "With client" removes the client's guests, so ask first.
    if (c.category === 'shared' && category !== 'shared' && c.guests?.length) {
      showToast({ text: `Moving #${c.name} out of Shared removes ${c.guests.length} guest${c.guests.length > 1 ? 's' : ''}`, action: { label: 'Move anyway', run: apply }, ms: 8000 });
      return;
    }
    apply();
  };

  const openTasks = (scope: TaskScope) => {
    if ((scope.kind === 'client' || scope.kind === 'past') && enabled.has('projects')) return (setProjScope(scope), go('projects'));
    setTaskScope(scope);
    go('tasks');
  };
  /** The project page is the hub: overview, tasks, chat, mail, meetings, files, notes, logins, guests. It lives in the Projects app. */
  const openClient = (id: string, tab?: typeof clientTab) => {
    setClientTab(tab);
    openTasks({ kind: 'client', id });
  };
  const newProjectFlow = () => {
    setProjScope({ kind: 'projects' });
    setProjNew((n) => n + 1);
    go('projects');
  };
  const openChannel = (id: string) => {
    setChatId(id);
    go('chat');
  };
  const openMeeting = (id: string) => {
    setMeetPage({ kind: 'meeting', id });
    go('meet');
  };
  /** Opens a task or brief in the detail panel, on a task page where it shows up. */
  const openTask = (id: string) => {
    const t = todos.find((x) => x.id === id);
    if (mode !== 'tasks' && mode !== 'home') openTasks(t?.userId === user.id ? { kind: 'mine' } : t?.clientId ? { kind: 'client', id: t.clientId } : { kind: 'all' });
    setTaskOpen(id);
  };

  const createFromDump = (r: DumpResult) => {
    const br = r.brief ? createTask({ ...r.brief, kind: 'brief', priority: 'normal', source: 'braindump' }, r.notify) : null;
    const made = r.tasks.map((t) => createTask({ ...t, briefId: br?.id, source: 'braindump' }, r.notify));
    if (Object.keys(r.learned).length) patchWorkspace(ws.id, { aliases: { ...(ws.aliases ?? {}), ...r.learned } });
    setDump(null);
    const people = new Set(made.filter((t) => t.userId && t.userId !== user.id).map((t) => t.userId));
    showToast({
      text: `${br ? 'Brief and ' : 'Created '}${made.length} task${made.length === 1 ? '' : 's'}${br ? ' created' : ''}${people.size ? `, ${people.size} ${people.size === 1 ? 'person' : 'people'} notified` : ''}`,
      action: br ? { label: 'Open brief', run: () => openTask(br.id) } : { label: 'View', run: () => openTasks({ kind: 'all' }) },
    });
  };

  /** Ask the client to approve a task: it becomes visible in their portal and the guests are told in the client channel. */
  const askApproval = (id: string) => {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    patchTask(id, { visibleToClient: true, approval: { status: 'waiting', askedBy: user.id, askedAt: nowIso() } });
    const ch = channels.find((c) => c.workspaceId === ws.id && c.clientId === t.clientId && c.guests?.length);
    if (ch) setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: user.id, text: `Could you approve “${t.title}”? It’s waiting for you in your shared space 🙏`, at: nowIso(), taskId: id }]);
    showToast({ text: ch ? `Approval requested. ${ch.guests!.map((g) => g.name.split(' ')[0]).join(', ')} will see it in the shared space` : `Approval requested in the shared space` });
  };



  const patchClient = (id: string, patch: Partial<Client>) => {
    const before = clients.find((c) => c.id === id);
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    // Teammates added to a project hear about it (and it shows in their sidebar from now on).
    if (before && patch.members)
      for (const m of patch.members.filter((x) => x.userId !== user.id && !(before.members ?? []).some((y) => y.userId === x.userId)))
        notify(m.userId, 'task', `${user.name.split(' ')[0]} added you to ${before.name}${m.role === 'lead' ? ' as lead' : ''}`, { app: 'projects', id: id });
  };
  /** With the local server: a link where a client person sets their password and signs in to their portal. */
  const makeClientInvite = (clientId: string) => async (p: { name: string; email: string }) => {
    if (!real) return null; // the demo, and the demo company: nobody gets a link
    const r = await fetch('/api/client-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, clientId, ...p }) });
    if (!r.ok) return null;
      const { link } = (await r.json()) as { link: string | null };
      return link ? `${portalOrigin(ws)}${link}` : null; // null: they already sign in, nothing to send. Guests get the company's own address.
  };
  /** Gives someone at a client access to their portal: added to the client's people and its shared channels. */
  const giveClientAccess = async (clientId: string, person: { name: string; email: string; role: ClientPerson['role']; company?: string; phone?: string }, status: ClientPerson['status']) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const entry: ClientPerson = { ...person, status, invitedBy: user.id, at: nowIso() };
    setClients((cs) => cs.map((x) => (x.id === clientId ? { ...x, people: [...(x.people ?? []).filter((p) => p.email !== person.email), entry] } : x)));
    setChannels((chs) => chs.map((ch) => (ch.clientId === clientId && ch.category === 'shared' && !ch.guests?.some((g) => g.email === person.email) ? { ...ch, guests: [...(ch.guests ?? []), { email: person.email, name: person.name, status: 'invited', invitedBy: user.id, at: nowIso() }] } : ch)));
    const link = await makeClientInvite(clientId)(person);
    showToast(
      inSandbox
        ? { text: `${person.name} added to ${c.name}. It’s the demo company, so no invite goes out.`, ms: 6000 }
        : link
          ? { text: `${person.name.split(' ')[0]} can sign in with their invite link`, action: { label: 'Copy link', run: () => void navigator.clipboard?.writeText(link) }, ms: 20000 }
          : { text: `${person.name} invited to ${c.name}` },
    );
  };
  const inviteClientPerson = (clientId: string, person: { name: string; email: string; role: ClientPerson['role']; company?: string; phone?: string }) => void giveClientAccess(clientId, person, 'invited');
  const approveClientPerson = (clientId: string, email: string) => {
    const p = clients.find((x) => x.id === clientId)?.people?.find((x) => x.email === email);
    if (p) void giveClientAccess(clientId, { name: p.name, email: p.email, role: p.role }, 'invited');
  };
  /** Ending work with a client: archive their channels, decide what their people keep, optionally close open tasks. */
  const [ending, setEnding] = useState<string | null>(null);
  const endClient = (id: string, o: { date: string; reason: string; archive: boolean; portal: 'readonly' | 'off'; closeTasks: boolean }) => {
    const chans = o.archive ? channels.filter((c) => c.clientId === id && !c.archived).map((c) => c.id) : [];
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, status: 'ended', endedAt: new Date(o.date + 'T12:00').toISOString(), endReason: o.reason || undefined, portalAfterEnd: o.portal, archivedOnEnd: chans } : c)));
    if (chans.length) setChannels((cs) => cs.map((c) => (chans.includes(c.id) ? { ...c, archived: true } : c)));
    if (o.closeTasks) setTodos((ts) => ts.map((t) => (t.clientId === id && !t.done ? { ...t, done: true, status: stageIdFor(t, 'done'), doneAt: nowIso(), doneBy: user.id } : t)));
    setEnding(null);
    const c = clients.find((x) => x.id === id);
    showToast({ text: `Work with ${c?.name} ended. They’re in Past ${term.many}`, action: { label: 'Undo', run: () => reactivateClient(id) } });
  };
  const reactivateClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setClients((cs) => cs.map((x) => (x.id === id ? { ...x, status: 'active', endedAt: undefined, endReason: undefined, portalAfterEnd: undefined, archivedOnEnd: undefined } : x)));
    if (c.archivedOnEnd?.length) setChannels((cs) => cs.map((ch) => (c.archivedOnEnd!.includes(ch.id) ? { ...ch, archived: false } : ch)));
    showToast({ text: `${c.name} is an active ${term.one} again` });
  };

  const loadVault = () => {
    if (!real) return;
    void fetch(`/api/vault?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: VaultItem[] }) => setVaultItems(d.items));
  };
  useEffect(() => {
    // Vault itself, and a project's Logins tab (which lists the project's logins you can see).
    if (mode === 'vault' || mode === 'projects') loadVault();
  }, [mode, ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Notes ---------------- */
  // Mine, and the ones shared with the company.
  // Tab orders an admin made everyone's default (each person can still arrange their own).
  const tabDefaults = useMemo(
    () => ({ defaults: ws.tabDefaults ?? {}, canSet: isAdmin, set: (key: string, prefs: { order: string[]; hidden: string[] } | null) => patchWorkspace(ws.id, { tabDefaults: Object.fromEntries(Object.entries({ ...(ws.tabDefaults ?? {}), [key]: prefs }).filter(([, v]) => v)) as Record<string, { order: string[]; hidden: string[] }> }) }),
    [ws.tabDefaults, ws.id, isAdmin], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const wsTables = useMemo(() => tables.filter((t) => t.workspaceId === ws.id), [tables, ws.id]);
  const wsTableRows = useMemo(() => tableRows.filter((r) => r.workspaceId === ws.id), [tableRows, ws.id]);
  const currentTable = wsTables.find((t) => t.id === tableId);
  const openTable = (id: string, rowId?: string) => {
    setTableId(id);
    setTableRow(rowId ?? null);
    go('tables');
  };
  const createTable = (d: { name: string; clientId?: string; template: TemplateId }) => {
    const t = makeTable(d, ws.id, user.id);
    setTables((ts) => [...ts, t]);
    setNewTableFor(null);
    openTable(t.id);
  };
  const wsNotes = useMemo(() => notes.filter((n) => n.workspaceId === ws.id && (n.visibility === 'team' || n.ownerId === user.id)), [notes, ws.id, user.id]);
  const patchNote = (id: string, patch: Partial<Note>) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso(), updatedBy: user.id } : n)));
  const newNote = (title = '', clientId?: string) => {
    const n: Note = { id: uid(), workspaceId: ws.id, title, html: '', ownerId: user.id, visibility: clientId ? 'team' : 'private', clientId, createdAt: nowIso(), updatedAt: nowIso(), updatedBy: user.id };
    setNotes((ns) => [n, ...ns]);
    setNoteId(n.id);
    go('notes');
    setTimeout(() => (document.querySelector(title ? '.note-body [contenteditable]' : '.note-title') as HTMLElement | null)?.focus(), 150);
  };
  const deleteNote = (id: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    setNotes((ns) => ns.filter((x) => x.id !== id));
    setNoteId(null);
    showToast({ text: `“${n.title || 'Untitled'}” deleted`, action: { label: 'Undo', run: () => (setNotes((ns) => [n, ...ns]), setNoteId(n.id)) } });
  };
  const openNote = (id: string) => (setNoteId(id), go('notes'));

  /** Tells the client people who should know (the requester, or everyone at the client for shared work). */
  const tellClient = (t: Todo, text: string) => {
    const c = clients.find((x) => x.id === t.clientId);
    if (!c) return;
    const to = t.requestedBy ? [t.requestedBy] : clientPeople(c, channels).filter((p) => p.status !== 'pending').map((p) => p.email);
    setNotices((ns) => [...to.map((e) => ({ id: uid(), userId: clientInbox(e), workspaceId: ws.id, kind: 'task' as const, text, at: nowIso(), read: false, link: { app: 'tasks' as const, id: t.id } })), ...ns]);
  };

  /** Inviting from the demo company: it says it's the demo, and where to invite people for real. */
  const demoNoInvites = () => {
    const realWs = workspaces.find((w) => !isSandbox(w));
    showToast({ text: 'This is the demo company, so nobody is invited from here. Invite your team in your real company.', ms: 7000, action: realWs ? { label: `Go to ${realWs.name}`, run: () => switchWorkspace(realWs.id) } : undefined });
  };
  /** Free covers 5 people: the 6th invite shows the price at that moment instead of a wall. */
  const openInvite = () => {
    if (inSandbox) return demoNoInvites();
    if (ws.plan?.tier === 'free' && members.length >= 5) {
      showToast({ text: 'Free covers 5 people. Add more on Small for Rp 39.000 per person a month', action: { label: 'See plans', run: () => (setSettingsSection('billing'), go('settings')) }, ms: 8000 });
      return;
    }
    setInviting(true);
  };

  /* ---------------- The one assistant ---------------- */

  /** Ask AI starts where you are: this meeting, this channel, this client, or everything. */
  const contextScope = (): AskScope =>
    mode === 'meet' && meetPage.kind === 'meeting'
      ? { kind: 'meeting', id: meetPage.id }
      : mode === 'meet' && meetPage.kind === 'folder'
        ? { kind: 'client', id: meetPage.clientId }
        : mode === 'chat' && chatId
          ? { kind: 'channel', id: chatId }
          : mode === 'tasks' && taskScope.kind === 'client'
            ? { kind: 'client', id: taskScope.id }
            : { kind: 'all' };
  const toggleAsk = () => (askScope ? setAskScope(null) : openAsk(contextScope()));
  const askOptions = [
    { value: 'all', label: 'Everything', group: 'Everywhere' },
    ...wsClients.map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}` })),
    ...wsChannels.filter((c) => c.kind === 'channel').map((c) => ({ value: `channel:${c.id}`, label: `#${c.name}`, group: 'Channels' })),
    ...[...wsMeetings].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12).map((m) => ({ value: `meeting:${m.id}`, label: m.title, group: 'Meetings' })),
  ];

  /** Sources for a scope: meetings, emails, chat and tasks, shaped the same way for the AI. */
  const askAnything = async (q: string, scope: AskScope) => {
    tried('ask');
    const client = scope.kind === 'client' ? wsClients.find((c) => c.id === scope.id) : undefined;
    const meetSrc = (m: Meeting) => ({ kind: 'M' as const, id: m.id, title: m.title, summary: m.summary, transcript: m.transcript ?? [], actions: m.actions.map((a) => ({ title: a.title, owner: a.owner, done: !!todos.find((t) => t.id === a.taskId)?.done })) });
    const mailSrc = (t: Thread) => ({ kind: 'E' as const, id: t.id, title: t.subject, summary: t.messages[t.messages.length - 1].body.slice(0, 300), transcript: t.messages.map((m, i) => ({ speaker: m.from.name, text: m.body.slice(0, 400), at: i })), actions: [] });
    const chanSrc = (c: Channel) => ({ kind: 'C' as const, id: c.id, title: `#${c.name}`, summary: c.topic ?? '', transcript: messages.filter((m) => m.channelId === c.id && m.text).slice(-60).map((m, i) => ({ speaker: allUsers.find((u) => u.id === m.userId)?.name.split(' ')[0] ?? 'Guest', text: m.text, at: i })), actions: [] });
    const taskSrc = (id: string, list: Todo[]) => ({ kind: 'T' as const, id, title: 'Tasks', summary: '', transcript: [], actions: list.filter((t) => t.kind !== 'brief').map((t) => ({ title: t.title + (t.due && t.due < localDay() && !t.done ? ' (overdue)' : ''), owner: allUsers.find((u) => u.id === t.userId)?.name.split(' ')[0], done: t.done })) });
    // Mail questions in the "everything" view use the inbox assistant.
    if (scope.kind === 'all' && /urgent|unread|inbox|email|mail|invoice/i.test(q)) {
      const r = await ai.assistant(q, scoped, settings.name || user.name);
      return r.answer + (r.threadIds.length ? '\n' + r.threadIds.map((id) => `[E:${id}]`).join(' ') : '');
    }
    const sources =
      scope.kind === 'meeting'
        ? wsMeetings.filter((m) => m.id === scope.id).map(meetSrc)
        : scope.kind === 'channel'
          ? wsChannels.filter((c) => c.id === scope.id).map(chanSrc)
          : scope.kind === 'client' && client
            ? [
                ...wsMeetings.filter((m) => m.clientId === client.id && m.summary).map(meetSrc),
                ...(client.domain ? wsThreads.filter((t) => t.messages.some((m) => [m.from, ...m.to].some((x) => x.email.endsWith('@' + client.domain)))).map(mailSrc) : []),
                ...wsChannels.filter((c) => c.clientId === client.id).map(chanSrc),
                taskSrc(client.id, wsTasks.filter((t) => t.clientId === client.id)),
              ]
            : [...wsMeetings.filter((m) => m.summary).slice(0, 25).map(meetSrc), ...wsChannels.filter((c) => c.kind === 'channel').map(chanSrc), taskSrc('all', wsTasks)];
    return ai.askMeetings(q, sources);
  };

  /** Everything this company has, as one JSON file. Always free, on every plan. */
  const exportEverything = () => {
    const data = {
      exportedAt: nowIso(),
      workspace: { ...ws, ai: ws.ai && { ...ws.ai, providers: ws.ai.providers.map((p) => ({ ...p, keyLast4: '••••' })) } },
      people: members,
      teams: wsTeams,
      clients: wsClients,
      tasks: wsTasks,
      channels: channels.filter((c) => c.workspaceId === ws.id),
      messages: messages.filter((m) => channels.some((c) => c.id === m.channelId && c.workspaceId === ws.id)),
      meetings: wsMeetings,
      mail: wsThreads,
      events: events.filter((e) => e.feed !== 'link' && !e.busy && (e.workspaceId ?? 'pnp') === ws.id), // not people's own calendar links
      files: drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id).map((d) => ({ ...d, thumb: undefined })),
    };
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ws.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-export-${nowIso().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast({ text: 'Export downloaded' });
    } catch {
      showToast({ text: 'Your browser blocked the download' });
    }
  };

  /** Invite someone by name and email (from the brain dump's "Who is Andi?"). */
  const inviteByName = (name: string, email: string): User => {
    // The demo company's people are made up: nobody real is invited from it, so the work stays with you.
    if (inSandbox) return (demoNoInvites(), user);
    const existing = allUsers.find((u) => u.email.toLowerCase() === email);
    const u: User = existing ?? { id: uid(), name: name.charAt(0).toUpperCase() + name.slice(1), email, title: 'Invited', color: ['#0ea5e9', '#f97316', '#8b5cf6', '#10b981'][allUsers.length % 4] };
    if (!existing) onInvite(u);
    if (!ws.members.some((m) => m.userId === u.id)) patchWorkspace(ws.id, { members: [...ws.members, { userId: u.id, role: 'member' }] });
    showToast({ text: `Invited ${u.name} (${email})` });
    return u;
  };

  /** Who's around: in a meeting (from the calendar or their status), away, or active. */
  const presence = (id: string): Presence => {
    if (id === user.id) {
      const now = new Date().toISOString();
      return myEvents.some((e) => !e.allDay && e.start <= now && e.end > now) ? 'meeting' : 'active';
    }
    if (statuses[id]?.emoji === '🗓️') return 'meeting';
    return id === 'u-dewi' || id === 'u-bayu' ? 'away' : 'active';
  };

  /** Files shared in chat are saved to Drive, filed under the channel's client. */
  const saveChatFiles = (files: ChatFile[], ch: Channel): ChatFile[] =>
    files.map((f) => {
      const id = uid();
      setDrive((d) => [...d, { id, name: f.name, kind: kindOf(f), parentId: null, size: f.size, modified: nowIso(), workspaceId: ws.id, clientId: ch.clientId, channelId: ch.id, thumb: f.type.startsWith('image') ? f.url : undefined }]);
      return { ...f, driveId: id };
    });

  const sendChat = (pl: SendPayload) => {
    if (!chatId) return;
    const ch = channels.find((c) => c.id === chatId);
    if (!ch) return;
    const files = pl.files ? saveChatFiles(pl.files, ch) : undefined;
    const msgId = uid();
    if (pl.voice) tried('voice');
    setMessages((ms) => [...ms, { id: msgId, channelId: chatId, userId: user.id, text: pl.text, at: nowIso(), parentId: pl.parentId, alsoInChannel: pl.alsoInChannel, files, voice: pl.voice, poll: pl.poll, kind: pl.kind, kudosFor: pl.kudosFor }]);
    const text = pl.text;
    const where = ch.kind === 'dm' ? 'a message' : `#${ch.name}`;
    if (pl.kind === 'kudos' && pl.kudosFor) notify(pl.kudosFor, 'mention', `🙌 ${myFirst} gave you kudos in ${where}${text ? `: “${text.slice(0, 80)}”` : ''}`, { app: 'chat', id: ch.id, msg: msgId });
    if (pl.parentId) {
      const root = messages.find((m) => m.id === pl.parentId);
      if (root && root.userId !== user.id && root.userId !== 'guest') notify(root.userId, 'mention', `${myFirst} replied to your message in ${where}: “${text.slice(0, 80)}”`, { app: 'chat', id: ch.id, msg: msgId });
    }
    for (const id of ch.members) {
      if (id === user.id) continue;
      const fn = firstOf(id);
      if (ch.kind === 'dm') notify(id, 'mention', `${myFirst} messaged you: “${(text || (pl.voice ? 'a voice note' : pl.files ? 'a file' : '')).slice(0, 80)}”`, { app: 'chat', id: ch.id, msg: msgId });
      else if (text && new RegExp(`@${fn}\\b`, 'i').test(text)) notify(id, 'mention', `${myFirst} mentioned you in #${ch.name}: “${text.slice(0, 80)}”`, { app: 'chat', id: ch.id, msg: msgId });
    }
    // DEMO ONLY: the other person answers a DM a few seconds later, so the chat feels alive.
    if (demoOk && ch.kind === 'dm' && !pl.parentId) {
      const other = ch.members.find((m) => m !== user.id)!;
      setTimeout(() => {
        const reply = pl.voice ? 'Got your voice note, will do 👍' : /\?/.test(text) ? 'Good question, let me check and get back to you shortly.' : /thank/i.test(text) ? 'Anytime! 🙌' : '👍 Got it, on it.';
        setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: other, text: reply, at: nowIso() }]);
      }, 3500);
    }
  };

  const reactTo = (id: string, emoji: string) =>
    setMessages((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const r = { ...(m.reactions ?? {}) };
        const who = r[emoji] ?? [];
        r[emoji] = who.includes(user.id) ? who.filter((x) => x !== user.id) : [...who, user.id];
        return { ...m, reactions: r };
      }),
    );
  const votePoll = (id: string, option: number) =>
    setMessages((ms) =>
      ms.map((m) =>
        m.id === id && m.poll
          ? { ...m, poll: { ...m.poll, options: m.poll.options.map((o, i) => ({ ...o, votes: i === option ? (o.votes.includes(user.id) ? o.votes.filter((v) => v !== user.id) : [...o.votes, user.id]) : o.votes.filter((v) => v !== user.id) })) } }
          : m,
      ),
    );
  const deleteMessage = (id: string) => {
    const snapshot = messages;
    setMessages((ms) => ms.filter((m) => m.id !== id && m.parentId !== id));
    showToast({ text: 'Message deleted', action: { label: 'Undo', run: () => setMessages(snapshot) } });
  };

  const makeTaskFromMessage = (m: ChatMessage) => {
    const ch = channels.find((c) => c.id === m.channelId);
    const mentioned = members.find((u) => u.id !== m.userId && new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(m.text));
    const assignee = mentioned?.id ?? (m.userId === user.id ? user.id : user.id);
    let title = m.text.replace(/@\w+\s*/g, '').replace(/^(can you|could you|please)\s+/i, '').replace(/[?!.]+$/, '').trim();
    title = (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 90);
    const task = createTask({ title, userId: assignee, clientId: ch?.clientId, source: 'chat' });
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, taskId: task.id } : x)));
    showToast({ text: `Task created for ${assignee === user.id ? 'you' : firstOf(assignee)}`, action: { label: 'View', run: () => openTask(task.id) } });
  };

  const DAY_WORDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dueFromWord = (w?: string) => {
    if (!w) return undefined;
    const l = w.toLowerCase();
    const d = new Date();
    if (l.startsWith('tomorrow')) d.setDate(d.getDate() + 1);
    else if (l.startsWith('next week')) d.setDate(d.getDate() + 7);
    else {
      const i = DAY_WORDS.findIndex((x) => l.startsWith(x));
      if (i < 0) return undefined;
      d.setDate(d.getDate() + (((i - d.getDay() + 7) % 7) || 7));
    }
    return localDay(d);
  };

  const meetingActionToTask = (m: Meeting, i: number, quiet = false) => {
    const a = m.actions[i];
    if (a.taskId) return;
    const owner = members.find((u) => a.owner && u.name.toLowerCase().startsWith(a.owner.toLowerCase()));
    const task = createTask({ title: a.title, userId: owner?.id ?? '', clientId: m.clientId, due: dueFromWord(a.due), source: 'meeting', meetingId: m.id, saidAt: a.saidAt }, { chat: true });
    setMeetings((ms) => ms.map((x) => (x.id === m.id ? { ...x, actions: x.actions.map((y, j) => (j === i ? { ...y, taskId: task.id } : y)) } : x)));
    if (!quiet) showToast({ text: owner ? `Task created for ${owner.id === user.id ? 'you' : owner.name.split(' ')[0]}` : 'Task created, not assigned yet' });
  };

  /* ---------------- Meet: the notetaker ---------------- */

  meetingsRef.current = meetings;
  const patchMeeting = (id: string, p: Partial<Meeting>) => setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const meetLog = (id: string, message: string, p: Partial<Meeting> = {}) =>
    setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, ...p, log: [...(m.log ?? []), { message, at: nowIso() }] } : m)));
  const later = (id: string, ms: number, fn: () => void) => {
    const t = window.setTimeout(fn, ms);
    botTimers.current[id] = [...(botTimers.current[id] ?? []), t];
  };
  const meetSettings = ws.meetings ?? DEFAULT_MEETINGS;

  /** Which client a meeting belongs to: the first matching rule, else the AI's suggestion. */
  const fileByRules = (m: Meeting, aiFolder: string) => {
    const speakers = (m.transcript ?? []).map((l) => l.speaker.toLowerCase());
    const text = `${m.title} ${m.summary}`.toLowerCase();
    const rule = (ws.meetingRules ?? []).find((r) =>
      r.kind === 'participant' ? speakers.includes(r.value.toLowerCase()) : r.kind === 'domain' ? (m.url ?? '').includes(r.value) || m.attendees.some((a) => a.toLowerCase().includes(r.value.split('.')[0])) : text.includes(r.value.toLowerCase()),
    );
    if (rule) return { clientId: rule.clientId, filedBy: 'rule' as const };
    const c = wsClients.find((x) => x.name.toLowerCase() === aiFolder.toLowerCase());
    return c ? { clientId: c.id, filedBy: 'ai' as const } : { clientId: undefined, filedBy: undefined };
  };

  /** After the bot leaves: write notes, file the meeting, make tasks. */
  const finishMeeting = (id: string, regenerate = false) => {
    const m = meetings.find((x) => x.id === id);
    meetLog(id, regenerate ? 'Writing notes again' : 'Writing notes', { status: 'processing' });
    later(id, 50, async () => {
      const current = meetingsRef.current.find((x) => x.id === id) ?? m;
      if (!current) return;
      if (!current.transcript?.length) {
        meetLog(id, 'No transcript, so no notes', { status: 'done' });
        return;
      }
      const notes = await ai.meetingNotes(current.title, current.transcript, wsClients.map((c) => c.name), members.map((u) => u.name.split(' ')[0]));
      const filed = current.filedBy === 'user' ? { clientId: current.clientId, filedBy: 'user' as const } : fileByRules({ ...current, summary: notes.summary }, notes.folder);
      const actions = notes.actions.map((a) => ({ ...a, taskId: undefined as string | undefined }));
      // Regenerating keeps tasks people edited; AI tasks nobody touched are replaced.
      if (regenerate) setTodos((ts) => ts.filter((t) => !(t.meetingId === id && t.source === 'meeting' && !t.done && t.createdBy === user.id && !t.notes)));
      const mins = Math.max(1, Math.round((current.transcript[current.transcript.length - 1].at + 60_000) / 60_000));
      const keep = filed.clientId ? meetSettings.clientMeetings : meetSettings.internalMeetings;
      const next: Meeting = {
        ...current,
        title: current.title || notes.title,
        summary: notes.summary,
        keyPoints: notes.keyPoints,
        decisions: notes.decisions,
        openQuestions: notes.openQuestions,
        topics: notes.topics,
        type: current.type ?? notes.type,
        tags: notes.tags,
        actions,
        minutes: current.minutes || mins,
        clientId: filed.clientId,
        filedBy: filed.filedBy,
        status: 'done',
        recording: current.recording ?? { keep, sizeMb: keep === 'video' ? mins * 18.3 : keep === 'audio' ? mins * 0.8 : 0.4 },
        sharedWithClient: current.sharedWithClient ?? (filed.clientId ? meetSettings.shareNotesWithClient : false),
      };
      setMeetings((ms) => ms.map((x) => (x.id === id ? { ...next, log: [...(x.log ?? []), ...(filed.filedBy === 'rule' ? [{ message: `Filed in ${wsClients.find((c) => c.id === filed.clientId)?.name} by rule`, at: nowIso() }] : filed.filedBy === 'ai' ? [{ message: `Filed in ${wsClients.find((c) => c.id === filed.clientId)?.name} by AI`, at: nowIso() }] : []), { message: `Kept: ${keep === 'video' ? 'video, audio and notes' : keep === 'audio' ? 'audio and notes' : 'notes and transcript only'}`, at: nowIso() }, { message: 'Done', at: nowIso() }] } : x)));
      if (meetSettings.autoTasks !== false && ws.ai?.auto.meetingNotes !== false) later(id, 60, () => next.actions.forEach((_, i) => meetingActionToTask(next, i, true)));
      notify(current.createdBy ?? user.id, 'meeting', `Notes are ready for “${next.title}” · ${actions.length} action item${actions.length === 1 ? '' : 's'}`, { app: 'meet', id });
      if (current.createdBy !== user.id) return;
      showToast({ text: `Notes ready for “${next.title}”`, action: { label: 'Open', run: () => openMeeting(id) } });
    });
  };

  // The recorder bot's notes were written on the server: the person who sent it gets the tasks and the heads-up.
  useEffect(() => {
    meetings
      .filter((m) => m.needsTasks && m.createdBy === user.id && m.workspaceId === ws.id)
      .forEach((m) => {
        patchMeeting(m.id, { needsTasks: false });
        // Notes written again (another language, say): AI tasks from the old notes that nobody touched make way for the new ones.
        setTodos((ts) => ts.filter((t) => !(t.meetingId === m.id && t.source === 'meeting' && !t.done && !t.notes && t.createdBy === user.id)));
        if (meetSettings.autoTasks !== false && ws.ai?.auto.meetingNotes !== false) m.actions.forEach((_, i) => meetingActionToTask(m, i, true));
        notify(user.id, 'meeting', `Notes are ready for “${m.title}” · ${m.actions.length} action item${m.actions.length === 1 ? '' : 's'}`, { app: 'meet', id: m.id });
        showToast({ text: `Notes ready for “${m.title}”`, action: { label: 'Open', run: () => openMeeting(m.id) } });
      });
  }, [meetings]); // eslint-disable-line react-hooks/exhaustive-deps

  // The demo company's "Try this": a meeting with notes was opened.
  useEffect(() => {
    if (inSandbox && mode === 'meet' && meetPage.kind === 'meeting' && meetings.some((m) => m.id === meetPage.id && !!m.summary)) tried('meeting');
  }, [inSandbox, mode, meetPage]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The demo bot: joins, waits to be let in, records a short sample conversation, leaves and writes notes. */
  const sendBot = (d: { url: string; title: string; botName: string; clientId: string; attendees?: string[]; fromEvent?: string; language?: string }) => {
    const id = uid();
    const zoom = /zoom/i.test(d.url);
    const m: Meeting = { id, workspaceId: ws.id, title: d.title, at: nowIso(), minutes: 0, clientId: d.clientId || undefined, filedBy: d.clientId ? 'user' : undefined, attendees: d.attendees ?? [], summary: '', actions: [], status: 'queued', platform: zoom ? 'zoom' : 'meet', url: d.url, botName: d.botName, transcript: [], log: [{ message: d.fromEvent ? `Sent from calendar: ${d.title}` : 'Queued', at: nowIso() }], createdBy: user.id };
    if (d.fromEvent) setSentEvents((s2) => ({ ...s2, [d.fromEvent!]: id }));
    setSendBotOpen(false);
    setMeetPage({ kind: 'meeting', id });
    go('meet');
    // With the real recorder, the server saves the meeting and the bot fills it in from there (never from the demo company).
    if (recorderOn && real) {
      const real = { ...m, bot: true, ...(d.language ? { language: d.language } : {}) };
      setMeetings((ms) => [real, ...ms]);
      void fetch('/api/meet/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ meeting: real }) }).then(async (r) => {
        if (r.ok) return;
        const error = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t send the notetaker';
        // Refused before it was saved (no hours left, a read-only company): the meeting says so instead of waiting forever.
        setMeetings((ms) => ms.map((x) => (x.id === id && x.status === 'queued' ? { ...x, status: 'failed', error, log: [...(x.log ?? []), { message: `Couldn’t send the bot: ${error}`, at: nowIso() }] } : x)));
        showToast({ text: error, ms: 7000 });
      });
      return;
    }
    setMeetings((ms) => [m, ...ms]);
    later(id, 1200, () => meetLog(id, `Joining ${zoom ? 'Zoom' : 'Google Meet'} as “${d.botName}”`, { status: 'joining' }));
    later(id, 2800, () => meetLog(id, 'Waiting to be let in', { status: 'waiting_room' }));
    later(id, 5000, () => meetLog(id, `Let in. Posted in the meeting chat: “Hi, I'm ${d.botName}. I'm recording this meeting and taking notes.”`, { status: meetSettings.announce ? 'recording' : 'recording' }));
    DEMO_SCRIPT.forEach((line, i) =>
      later(id, 6500 + i * 2200, () =>
        setMeetings((ms) => ms.map((x) => (x.id === id && x.status === 'recording' ? { ...x, transcript: [...(x.transcript ?? []), { speaker: line.speaker === 'You' ? myFirst : line.speaker === `${term.One}` ? 'Guest' : line.speaker, text: line.text, at: 15_000 + i * 42_000 }] } : x))),
      ),
    );
    later(id, 6500 + DEMO_SCRIPT.length * 2200 + 1500, () => {
      if (meetingsRef.current.find((y) => y.id === id)?.status === 'recording') {
        meetLog(id, 'Everyone else left');
        finishMeeting(id);
      }
    });
  };

  const stopBot = (id: string) => {
    const m = meetings.find((x) => x.id === id);
    if (m?.bot) return void fetch(`/api/meet/stop/${id}`, { method: 'POST' });
    (botTimers.current[id] ?? []).forEach(clearTimeout);
    botTimers.current[id] = [];
    if (!m || m.status !== 'recording') {
      meetLog(id, 'Stopped before recording began', { status: 'stopped' });
      return;
    }
    meetLog(id, 'Asked to leave', { status: 'stopping' });
    later(id, 900, () => finishMeeting(id));
  };

  const deleteMeeting = (id: string) => {
    const snapshot = { meetings, todos };
    (botTimers.current[id] ?? []).forEach(clearTimeout);
    setMeetings((ms) => ms.filter((m) => m.id !== id));
    setTodos((ts) => ts.filter((t) => t.meetingId !== id || t.done));
    setMeetPage({ kind: 'list' });
    showToast({ text: 'Meeting deleted', action: { label: 'Undo', run: () => (setMeetings(snapshot.meetings), setTodos(snapshot.todos)) } });
  };

  const setMeetingFolder = (id: string, clientId: string | null, remember: boolean) => {
    const m = meetings.find((x) => x.id === id);
    patchMeeting(id, { clientId: clientId ?? undefined, filedBy: 'user' });
    if (remember && m && clientId) {
      const outsiders = [...new Set((m.transcript ?? []).map((l) => l.speaker))].filter((sp) => !members.some((u) => u.name.split(' ')[0] === sp.split(' ')[0]) && sp !== 'Guest');
      const rules = outsiders.map((v) => ({ id: uid(), kind: 'participant' as const, value: v, clientId }));
      patchWorkspace(ws.id, { meetingRules: [...(ws.meetingRules ?? []), ...rules] });
      showToast({ text: `Meetings with ${outsiders.join(', ')} will be filed here` });
    }
  };

  const writeOverview = async (clientId: string) => {
    const c = wsClients.find((x) => x.id === clientId);
    const list = wsMeetings.filter((m) => m.clientId === clientId && m.summary);
    if (!c) return;
    const t = wsTasks.filter((x) => x.meetingId && list.some((m) => m.id === x.meetingId));
    const o = await ai.folderOverview(c.name, list.map((m) => ({ title: m.title, summary: m.summary, decisions: m.decisions ?? [], openQuestions: m.openQuestions ?? [] })), t.filter((x) => !x.done).map((x) => x.title), t.filter((x) => x.done).length);
    setClients((cs) => cs.map((x) => (x.id === clientId ? { ...x, overview: { ...o, at: nowIso(), from: list.length } } : x)));
    showToast({ text: 'Overview updated' });
  };

  const openNotice = (n: Notice) => {
    setNotices((ns) => ns.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setNoticesOpen(false);
    if (n.url) return void location.assign(n.url);
    if (!n.link) return;
    if (n.link.app === 'tasks') return n.link.id ? openTask(n.link.id) : openTasks({ kind: 'mine' });
    if (n.link.app === 'projects' && n.link.id) return openClient(n.link.id);
    if (n.link.app === 'chat') {
      if (n.link.msg) setFocusMsg(n.link.msg);
      return n.link.id ? openChannel(n.link.id) : go('chat');
    }
    if (n.link.app === 'mail' && n.link.id) return openThread(n.link.id);
    if (n.link.app === 'meet') return n.link.id ? openMeeting(n.link.id) : go('meet');
    if (n.link.app === 'tables' && n.link.id) return openTable(n.link.id, n.link.msg);
    if (n.link.app === 'teams') return (setTeamId(n.link.id ?? null), go('teams'));
    if (n.link.app === 'settings') return (setSettingsSection((n.link.id ?? 'account') as SettingsSection), go('settings'));
    if (n.link.app === 'calendar' && n.link.id) {
      const ev = events.find((e) => e.id === n.link!.id);
      if (ev) (setCalCursor(new Date(ev.start)), setSelectedEventId(ev.id));
    }
    go(n.link.app);
  };
  // Notifications on phones and computers: a tap opens the item, the icon shows the unread count (pushBridge.ts).
  usePushBridge({ userId: user.id, wsId: ws.id, workspaceIds: workspaces.map((w) => w.id), notices, switchWs: setWsId, open: openNotice, toast: showToast });
  // Someone just opened an email you sent (the server's notice, server/readTracking.ts): a toast too while you're here.
  const openedSeen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const opened = myNotices.filter((n) => n.event === 'opened');
    if (!openedSeen.current) return void (openedSeen.current = new Set(opened.map((n) => n.id)));
    for (const n of opened) {
      if (openedSeen.current.has(n.id)) continue;
      openedSeen.current.add(n.id);
      if (!n.read && Date.now() - Date.parse(n.at) < 120_000) showToast({ text: n.text, action: { label: 'View', run: () => openNotice(n) } });
    }
  }, [myNotices]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Calendar ---------------- */

  // My outside calendars (personal: they show in every workspace), this company's public holidays, and teammates'
  // availability on top.
  const myExtCals = useMemo(() => extCals.filter((c) => c.ownerId === user.id || (c.source === 'holidays' && c.workspaceId === ws.id)), [extCals, user.id, ws.id]);
  const extIds = useMemo(() => new Set(extCals.map((c) => c.id)), [extCals]);
  // Public holidays by day, for the date picker and tasks due on a holiday.
  const holidayDays = useMemo(() => {
    const days = new Map<string, string>();
    for (const e of events) {
      if (e.feed !== 'holidays' || e.workspaceId !== ws.id) continue;
      for (let d = new Date(e.start); d < new Date(e.end); d.setDate(d.getDate() + 1)) {
        const day = localDay(d);
        days.set(day, days.has(day) ? `${days.get(day)}, ${e.title}` : e.title);
      }
    }
    return days;
  }, [events, ws.id]);
  setHolidayDays(holidayDays);
  const mateCals = useMemo(() => members.filter((u) => shownMates.has(u.id)).map((u) => ({ id: `mate-${u.id}`, name: u.name, color: u.color })), [members, shownMates]);
  const allCals = useMemo(() => [...CALENDARS, ...myExtCals, ...mateCals], [myExtCals, mateCals]);
  const visibleEvents = useMemo(() => {
    const mine = events.filter((e) => {
      if (hiddenCals.has(e.calendarId)) return false;
      if (e.feed === 'holidays') return e.workspaceId === ws.id; // the company's: everyone's
      return (e.userId ?? 'u-aqeel') === user.id && (extIds.has(e.calendarId) ? myExtCals.some((c) => c.id === e.calendarId) : (e.workspaceId ?? 'pnp') === ws.id);
    });
    const mates = events.flatMap((e) => {
      if (e.feed === 'holidays') return [];
      const owner = e.userId ?? 'u-aqeel';
      if (owner === user.id || !shownMates.has(owner)) return [];
      const ext = extCals.find((c) => c.id === e.calendarId);
      if (!ext && (e.workspaceId ?? 'pnp') !== ws.id) return [];
      const share = ext ? (ext.share ?? 'busy') : 'details';
      if (share === 'private') return [];
      const first = (allUsers.find((u) => u.id === owner)?.name ?? 'Someone').split(' ')[0];
      return [{ ...e, id: `m-${e.id}`, calendarId: `mate-${owner}`, title: `${first}: ${share === 'busy' || e.busy ? 'Busy' : e.title}`, notes: undefined, guests: undefined, location: share === 'busy' ? undefined : e.location, threadId: undefined, meetUrl: undefined }];
    });
    return [...mine, ...mates];
  }, [events, hiddenCals, ws.id, user.id, extIds, myExtCals, extCals, shownMates, allUsers]);
  const myEvents = useMemo(() => visibleEvents.filter((e) => !e.calendarId.startsWith('mate-')), [visibleEvents]);
  // The notetaker joining by itself: the server does it when the real recorder answers; the demo keeps its switches.
  const autoJoin: 'live' | 'demo' | 'off' = recorderOn && real ? 'live' : demoOk ? 'demo' : 'off';
  // (It joins from two minutes before the start until a minute after; a meeting already going gets "Send now".)
  const botWillJoin = (e: CalEvent) => autoJoin === 'live' && (e.userId ?? user.id) === user.id && !e.calendarId.startsWith('mate-') && new Date(e.start).getTime() > Date.now() - 60_000 && botJoins(e, meetSettings.joinMode, joinOverrides, isMine);
  const setBotJoin = (eventId: string, join: boolean | null) =>
    setJoinOverrides((o) => {
      const n = { ...o };
      if (join === null) delete n[eventId];
      else n[eventId] = join;
      return n;
    });
  /** Events the notetaker was sent to (from here, or by itself from the calendar: the same call at the same time). */
  const sentFor = useMemo(() => {
    const out: Record<string, string> = { ...sentEvents };
    const auto = wsMeetings.filter((m) => m.auto && m.scheduledFor && m.url);
    if (!auto.length) return out;
    for (const e of myEvents) {
      if (out[e.id]) continue;
      const link = meetingLinkOf(e);
      const start = new Date(e.start).toISOString();
      const hit = auto.find((m) => m.eventId === e.id || (!!link && m.scheduledFor === start && callKey(m.url!) === callKey(link.url)));
      if (hit) out[e.id] = hit.id;
    }
    return out;
  }, [sentEvents, wsMeetings, myEvents]);
  const busyDays = useMemo(() => new Set(myEvents.map((e) => new Date(e.start).toDateString())), [myEvents]);
  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  function openNewEvent(at?: Date) {
    const d = at ?? new Date(calCursor);
    if (!at) d.setHours(new Date().getHours() + 1, 0, 0, 0);
    setNewEventAt(d);
    setSidebarOpen(false);
  }

  const saveEvent = (e: Omit<CalEvent, 'id'>) => {
    const ev = { ...e, id: uid(), workspaceId: ws.id, userId: user.id };
    tried('event');
    setEvents((es) => [...es, ev]);
    setNewEventAt(null);
    setCalCursor(new Date(ev.start));
    setSelectedEventId(ev.id);
    showToast({ text: 'Event created' });
  };

  /** My outside calendars other than holidays (links, and the demo's pretend Google and Outlook ones). */
  const linkCals = myExtCals.filter((c) => c.source !== 'holidays');
  /** Read all my calendar links again now (Meet's Upcoming). */
  const refreshLinks = async () => {
    const results = await Promise.all(
      linkCals
        .filter((c) => c.source === 'ics')
        .map((c) =>
          fetch(`/api/calendars/${c.id}/refresh`, { method: 'POST' })
            .then((r) => r.json() as Promise<{ ok?: boolean; error?: string }>)
            .catch(() => ({ ok: false, error: 'Couldn’t reach the server.' }))
            .then((r) => ({ name: c.name, ...r })),
        ),
    );
    const bad = results.find((r) => !r.ok);
    showToast({ text: bad ? `${bad.name}: ${bad.error ?? 'couldn’t update it'}` : 'Your calendars are up to date', ms: bad ? 8000 : undefined });
  };

  /** The standalone demo has no server to read holidays: its holiday calendar just follows the setting. */
  const demoHolidays = (country: string | null) => {
    const id = holidayCalendarId(ws.id);
    const c = holidayCountry(country ?? undefined);
    setExtCals((cs) => [...cs.filter((x) => x.id !== id), ...(c ? [{ id, name: `Holidays in ${c.name}`, color: '#dc2626', source: 'holidays' as const, workspaceId: ws.id, readOnly: true, share: 'details' as const, country: c.code }] : [])]);
    if (!c) setEvents((es) => es.filter((e) => e.calendarId !== id));
  };

  /**
   * The notetaker to an event's call: its real Meet or Zoom link. Without one it can join, the send dialog opens with the
   * event filled in and asks for the link (the demo makes one up when the event has none).
   */
  const sendNotetakerTo = (e: CalEvent) => {
    if (!botOn) return explainOff('The meeting notetaker isn’t available yet. Recordings and notes start working as soon as it is.');
    const link = meetingLinkOf(e);
    const attendees = (e.guests ?? []).map((g) => g.name);
    const url = link && notetakerJoins(link.kind) ? link.url : !link && demoOk ? (/zoom/i.test(e.location ?? '') ? 'https://zoom.us/j/1234567890' : 'https://meet.google.com/abc-defg-hij') : null;
    if (!url) {
      setSendBotSeed({ title: e.title, fromEvent: e.id, attendees, note: link ? `This is a ${MEETING_NAME[link.kind]} call, and the notetaker joins Google Meet and Zoom only.` : undefined });
      setSendBotOpen(true);
      return;
    }
    sendBot({ url, title: e.title, botName: meetSettings.botName, clientId: '', attendees, fromEvent: e.id });
    setSentEvents((s2) => ({ ...s2, [e.id]: 'pending' }));
  };

  const deleteEvent = (id: string) => {
    const snapshot = events;
    setEvents((es) => es.filter((e) => e.id !== id));
    setSelectedEventId(null);
    showToast({ text: 'Event deleted', action: { label: 'Undo', run: () => setEvents(snapshot) } });
  };

  const conflictsWith = (start: string, end: string) =>
    eventsOn(myEvents, new Date(start)).filter((e) => !e.allDay && e.start < end && e.end > start);

  const addInvite = (threadId: string) => {
    const t = threads.find((x) => x.id === threadId);
    if (!t?.invite) return;
    const from = t.messages[0].from;
    const ev: CalEvent = {
      id: uid(),
      title: t.invite.title,
      calendarId: 'clients',
      start: t.invite.start,
      end: t.invite.end,
      location: t.invite.location,
      guests: isMine(from.email) ? [] : [from],
      workspaceId: ws.id,
      userId: user.id,
      threadId,
    };
    setEvents((es) => [...es, ev]);
    showToast({
      text: 'Added to calendar',
      action: {
        label: 'View',
        run: () => {
          go('calendar');
          setCalCursor(new Date(ev.start));
          setSelectedEventId(ev.id);
        },
      },
    });
  };

  /* ---------------- Calendar invites in mail ---------------- */

  /** What's known around an invite: the answer given (in any of its emails), your calendar, later versions. */
  const inviteState = (t: Thread, m: Message): InviteState => {
    const inv = m.invite!;
    const related = threads.filter((x) => x.accountId === t.accountId).flatMap((x) => x.messages.filter((y) => y.invite?.uid === inv.uid).map((y) => ({ t: x, m: y, inv: y.invite! })));
    const sameDate = (x: { recurrenceId?: string }) => !x.recurrenceId || x.recurrenceId === inv.recurrenceId;
    const cancelled = related.some((r) => (r.inv.method === 'CANCEL' || !!r.inv.cancelled) && r.inv.sequence >= inv.sequence && sameDate(r.inv));
    const newer = related.find((r) => (r.inv.method === 'REQUEST' || r.inv.method === 'PUBLISH') && r.inv.sequence > inv.sequence && (r.inv.recurrenceId ?? '') === (inv.recurrenceId ?? ''));
    const last = related.map((r) => r.inv.answer).filter((a) => !!a).sort((a, b) => b!.at.localeCompare(a!.at))[0];
    // A shared inbox answers as the mailbox: say who did.
    const answer = last && { status: last.status, sent: last.sent, who: last.by === user.id ? undefined : firstOf(last.by) };
    const mine = events.some((e) => e.inviteUid === inv.uid && (e.userId ?? 'u-aqeel') === user.id);
    return { answer, onCalendar: mine, cancelled, newer: newer && newer.t.id !== t.id ? () => openThread(newer.t.id) : undefined };
  };
  /** Opens the calendar on this invite's next date. */
  const showInvite = (uid: string, start: string) => {
    const mine = events.filter((e) => e.inviteUid === uid && (e.userId ?? 'u-aqeel') === user.id).sort((a, b) => a.start.localeCompare(b.start));
    const ev = mine.find((e) => e.end >= new Date().toISOString()) ?? mine[0];
    go('calendar');
    setCalCursor(new Date(ev?.start ?? start));
    if (ev) setSelectedEventId(ev.id);
  };
  /** Yes, Maybe or No: the organiser hears it from this mailbox, and the event goes on (or off) your calendar. */
  const answerInvite = async (t: Thread, m: Message, status: RsvpStatus): Promise<boolean> => {
    const inv = m.invite!;
    const org = inv.organizer?.name.split(' ')[0];
    const tell = (sent: boolean, extra = '') =>
      showToast({
        text: `${status === 'accepted' ? (inv.method === 'PUBLISH' ? 'Added to your calendar' : 'You’re going') : status === 'tentative' ? 'You said maybe' : 'You said no'}${sent && org ? `. ${org} knows` : ''}.${extra}`,
        ms: extra ? 8000 : 5000,
        action: status !== 'declined' ? { label: 'View', run: () => showInvite(inv.uid, inv.start) } : undefined,
      });
    if (real) {
      try {
        const r = await fetch('/api/mail/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: t.id, messageId: m.id, answer: status }) });
        const d = (await r.json().catch(() => ({}))) as { error?: string; sent?: boolean; firstOnly?: boolean };
        if (!r.ok) {
          showToast({ text: d.error ?? 'Your answer couldn’t be saved. Try again.', ms: 7000, action: r.status === 409 && wsAdmin ? { label: 'Set it up', run: () => (setSettingsSection('email'), go('settings')) } : undefined });
          return false;
        }
        tell(!!d.sent, d.firstOnly ? ' Only the first date is on your calendar: this kind of repeat can’t be read yet.' : '');
        return true;
      } catch {
        showToast({ text: 'No connection: your answer wasn’t sent.' });
        return false;
      }
    }
    // The demo (no server, or the demo company): answered here, and nothing is sent.
    const at = nowIso();
    setThreads((ts) => ts.map((x) => (x.id !== t.id ? x : { ...x, messages: x.messages.map((y) => (y.id === m.id ? { ...y, invite: { ...inv, answer: { status, at, by: user.id, sent: false } } } : y)) })));
    setEvents((es) => [
      ...es.filter((e) => !(e.inviteUid === inv.uid && (e.userId ?? 'u-aqeel') === user.id)),
      ...(status === 'declined' ? [] : [{ id: uid(), title: inv.title, calendarId: 'work', start: inv.start, end: inv.end, allDay: inv.allDay, location: inv.location, meetUrl: inv.url, guests: [...(inv.organizer ? [inv.organizer] : []), ...inv.attendees].filter((g, i, all) => !isMine(g.email) && all.findIndex((x) => x.email === g.email) === i).map((g) => ({ name: g.name, email: g.email })), threadId: t.id, workspaceId: ws.id, userId: user.id, inviteUid: inv.uid, sequence: inv.sequence, rsvp: status, organizer: inv.organizer } as CalEvent]),
    ]);
    tell(false, ' Demo: no answer is sent.');
    return true;
  };
  const inviteCard = (t: Thread, m: Message) => {
    const inv = m.invite!;
    const acct = accountOf(t.accountId);
    return (
      <InviteCard
        key={m.id}
        invite={inv}
        state={inviteState(t, m)}
        conflicts={conflictsWith(inv.start, inv.end).filter((e) => e.inviteUid !== inv.uid)}
        answerOff={acct && !boxReady(acct.id).send ? replyWhy(acct) : undefined}
        onAnswerOff={() => acct && replyBlocked(acct)}
        onAnswer={(st) => answerInvite(t, m, st)}
        onOpenCalendar={() => showInvite(inv.uid, inv.start)}
      />
    );
  };


  /** Removing a mailbox: its mail moves to another mailbox or goes with it, and its address stops receiving. */
  const removeMailbox = async (a: Account, moveTo: string | null): Promise<boolean> => {
    const target = moveTo ? ws.accounts.find((x) => x.id === moveTo) : undefined;
    if (real) {
      const r = await fetch('/api/mail/mailbox/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, accountId: a.id, moveTo }) }).catch(() => null);
      if (!r?.ok) {
        showToast({ text: ((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? 'No connection: the mailbox wasn’t removed.' });
        return false;
      }
    } else {
      setThreads((ts) => (target ? ts.map((t) => (t.accountId === a.id ? { ...t, accountId: target.id } : t)) : ts.filter((t) => t.accountId !== a.id)));
      patchWorkspace(ws.id, { accounts: ws.accounts.filter((x) => x.id !== a.id), mailAliases: (ws.mailAliases ?? []).map((al) => ({ ...al, to: al.to.filter((id) => id !== a.id) })).filter((al) => al.to.length) });
    }
    if (activeAccount === a.id) setActiveAccount('all');
    setRemoveAcct(null);
    showToast({ text: target ? `${a.email} removed. Its mail is in ${target.email} now` : `${a.email} and its mail removed` });
    return true;
  };

  const openThread = (threadId: string) => {
    const t = threads.find((x) => x.id === threadId);
    if (!t) return;
    setPreview(null);
    go('mail');
    setView({ kind: 'folder', id: t.location });
    setQuery('');
    setSelectedId(threadId);
    setReaderOpen(true);
    update(threadId, { unread: false });
  };

  /* ---------------- Drive ---------------- */

  // Attachments from email show up in Drive automatically.
  const attachments = useMemo<DriveItem[]>(
    () =>
      wsThreads
        .filter((t) => t.location !== 'trash' && t.location !== 'spam')
        .flatMap((t) =>
          t.messages.flatMap((m) =>
            (m.attachments ?? []).map((a) => ({
              id: `att:${t.id}:${m.id}:${a.name}`,
              name: a.name,
              kind: kindOf({ name: a.name }),
              parentId: null,
              size: parseSize(a.size),
              modified: m.date,
              threadId: t.id,
            })),
          ),
        ),
    [wsThreads],
  );
  const wsDrive = useMemo(() => drive.filter((i) => (i.workspaceId ?? 'pnp') === ws.id), [drive, ws.id]);
  const allDrive = useMemo(() => [...wsDrive, ...attachments], [wsDrive, attachments]);

  const usage = useMemo(() => {
    const own = wsDrive.filter((i) => i.kind !== 'folder');
    return {
      mail: MAIL_USAGE,
      drive: own.reduce((s, i) => s + i.size, 0),
      media: own.filter((i) => i.kind === 'image' || i.kind === 'video').reduce((s, i) => s + i.size, 0),
      quota: QUOTA,
    };
  }, [wsDrive]);

  const patchDrive = (id: string, patch: Partial<DriveItem>) => setDrive((d) => d.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const upload = async (files: FileList) => {
    const parentId = driveSection === 'my' ? driveFolder : null;
    // Each file goes to the server first (a data URL in the demo), so it's still there tomorrow and on other devices.
    const added: DriveItem[] = [];
    for (const f of Array.from(files)) {
      const kind = kindOf(f);
      try {
        const up = await uploadFile(f, ws.id);
        added.push({ id: uid(), name: f.name, kind, parentId, size: f.size, modified: new Date().toISOString(), url: up.url, thumb: kind === 'image' || kind === 'video' ? up.url : undefined, workspaceId: ws.id, uploadedBy: user.id });
      } catch (e) {
        if (!wasSkipped(e)) showToast({ text: `${f.name}: ${(e as Error).message}` });
      }
    }
    if (!added.length) return;
    setDrive((d) => [...d, ...added]);
    if (!['my', 'recent', 'media'].includes(driveSection)) setDriveSection('my');
    showToast({ text: `Uploaded ${added.length} file${added.length > 1 ? 's' : ''}` });
  };

  const newFolder = () => {
    const parentId = driveSection === 'my' ? driveFolder : null;
    const f: DriveItem = { id: uid(), name: 'Untitled folder', kind: 'folder', parentId, size: 0, modified: new Date().toISOString(), workspaceId: ws.id };
    setDrive((d) => [...d, f]);
    setDriveSection('my');
    setDriveFolder(parentId);
    setRenamingId(f.id);
    go('drive');
  };

  const trashDrive = (id: string) => {
    patchDrive(id, { trashed: true });
    showToast({ text: 'Moved to trash', action: { label: 'Undo', run: () => patchDrive(id, { trashed: false }) } });
  };

  const deleteForever = (id: string) => {
    const snapshot = drive;
    setDrive((d) => d.filter((i) => i.id !== id && i.parentId !== id));
    showToast({ text: 'Deleted forever', action: { label: 'Undo', run: () => setDrive(snapshot) } });
  };

  const savedToDrive = (name: string) => wsDrive.some((i) => i.name === name && i.threadId === selectedId && !i.trashed);
  const saveToDrive = (threadId: string, a: Attachment) => {
    const msg = threads.find((t) => t.id === threadId)?.messages.find((m) => m.attachments?.some((x) => x.name === a.name));
    setDrive((d) => [
      ...d,
      { id: uid(), name: a.name, kind: kindOf({ name: a.name }), parentId: null, size: parseSize(a.size), modified: msg?.date ?? new Date().toISOString(), threadId, workspaceId: ws.id },
    ]);
    showToast({
      text: 'Saved to My Drive',
      action: {
        label: 'View',
        run: () => {
          setDriveSection('my');
          setDriveFolder(null);
          go('drive');
        },
      },
    });
  };

  /* ---------------- Keyboard ---------------- */

  const gPressed = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleAsk();
        return;
      }
      // ⌥1–9 switches workspace (works everywhere)
      if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
        const target = workspaces[Number(e.code.slice(5)) - 1];
        if (target) {
          e.preventDefault();
          switchWorkspace(target.id);
        }
        return;
      }
      if (el.closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Escape') (el as HTMLInputElement).blur?.();
        return;
      }
      if (compose || newEventAt || preview || dump !== null || paletteOpen || newWs) return;

      // "g" then m / c / d jumps between sections
      if (e.key === 'g') {
        gPressed.current = Date.now();
        return;
      }
      if (Date.now() - gPressed.current < 1000) {
        const target = ({ h: 'home', m: 'mail', c: 'chat', t: 'tasks', l: 'calendar', d: 'drive', e: 'meet' } as Record<string, Mode>)[e.key];
        gPressed.current = 0;
        if (target) {
          e.preventDefault();
          go(target);
          return;
        }
      }
      if (e.key === '[') {
        setCollapsed((c) => !c);
        return;
      }
      if (mode === 'calendar') {
        if (e.key === 'c') {
          e.preventDefault();
          openNewEvent();
        }
        return;
      }
      if (mode !== 'mail') return;

      const idx = visible.findIndex((t) => t.id === selectedId);
      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          const n = visible[Math.min(idx + 1, visible.length - 1)];
          if (n) open(n.id);
          break;
        }
        case 'k':
        case 'ArrowUp': {
          const n = visible[Math.max(idx - 1, 0)];
          if (n) open(n.id);
          break;
        }
        case 'e':
          if (selectedId) archive(selectedId);
          break;
        case '#':
          if (selectedId) trash(selectedId);
          break;
        case 's':
          if (selectedId) star(selectedId);
          break;
        case 'u':
          if (selectedId) markUnread(selectedId);
          break;
        case 'c':
          openCompose();
          break;
        case '/':
          searchRef.current?.focus();
          break;
        case 'Escape':
          setSelectedId(null);
          setReaderOpen(false);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------------- Render ---------------- */

  const title = view.kind === 'folder' ? FOLDER_TITLES[view.id] : view.kind === 'tracking' ? 'Tracking' : view.kind === 'todos' ? 'To-do' : LABELS.find((l) => l.id === view.id)?.name ?? '';
  const appMode = mode === 'settings' ? lastMode : mode;

  /** Each app's gear: Settings at that app's section (only sections this person can use). */
  const appSettings = (app: Mode, place: 'sidebar' | 'phone') => (
    <AppSettingsButton
      app={APPS.find((a) => a.id === app)?.name ?? 'App'}
      links={appSettingsLinks(app, { admin: isAdmin, perms })}
      onOpen={(id) => (setSettingsSection(id), setSidebarOpen(false), go('settings'))}
      className={place === 'sidebar' ? 'sb-settings' : 'mt-settings'}
      big={place === 'phone'}
    />
  );

  /** The phone's title switcher for each app. */
  const mobileSwitcher = (() => {
    if (mode === 'mail')
      return {
        label: 'Mailbox and folder',
        value: view.kind === 'tracking' ? 'track' : view.kind === 'folder' ? `folder:${view.id}` : 'folder:inbox',
        options: [
          ...(Object.keys(FOLDER_TITLES) as FolderId[]).map((f) => ({ value: `folder:${f}`, label: FOLDER_TITLES[f], group: 'Folders' })),
          { value: 'track', label: 'Waiting for reply', group: 'Folders' },
          ...[{ id: 'all', email: 'All inboxes' }, ...myAccounts].map((a) => ({ value: `acct:${a.id}`, label: a.id === 'all' ? 'All inboxes' : a.email, group: 'Mailboxes' })),
          ...wsClients.map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}` })),
        ],
        onChange: (v: string) => {
          if (v === 'track') selectView({ kind: 'tracking', id: 'tracking' });
          else if (v.startsWith('folder:')) selectView({ kind: 'folder', id: v.slice(7) as FolderId });
          else if (v.startsWith('acct:')) (setActiveAccount(v.slice(5)), selectView({ kind: 'folder', id: 'inbox' }));
          else openClient(v.slice(7), 'emails');
        },
      };
    // Tasks registers its own switcher (TasksView, useTitleMenu).
    if (mode === 'meet')
      return {
        label: 'Meet',
        value: meetPage.kind === 'folder' ? `folder:${meetPage.clientId}` : meetPage.kind === 'meeting' ? 'list' : meetPage.kind,
        options: [
          { value: 'list', label: 'Meetings', group: 'Meet' },
          { value: 'upcoming', label: 'Upcoming', group: 'Meet' },
          { value: 'tasks', label: 'Tasks from meetings', group: 'Meet' },
          { value: 'unfiled', label: 'Unfiled', group: 'Meet' },
          ...wsClients.map((c) => ({ value: `folder:${c.id}`, label: c.name, group: `${term.Many}` })),
        ],
        onChange: (v: string) => setMeetPage(v.startsWith('folder:') ? { kind: 'folder', clientId: v.slice(7) } : ({ kind: v } as MeetPage)),
      };
    // Projects: the open project's name, and a quick way to another one (the sidebar isn't there on phones).
    if (mode === 'projects')
      return {
        label: term.Many,
        value: projScope.kind === 'client' ? projScope.id : projScope.kind === 'past' ? 'past' : 'all',
        options: [
          { value: 'all', label: `All ${term.many}`, group: term.Many },
          ...wsClients.map((c) => ({ value: c.id, label: c.name, group: term.Many })),
          { value: 'past', label: `Past ${term.many}`, group: 'More' },
        ],
        onChange: (v: string) => setProjScope(v === 'all' ? { kind: 'projects' } : v === 'past' ? { kind: 'past' } : { kind: 'client', id: v }),
      };
    if (mode === 'drive')
      return {
        label: 'Drive',
        value: driveSection,
        options: (
          [
            ['my', 'My Drive'],
            ['recent', 'Recent'],
            ['media', 'Photos & videos'],
            ['email', 'From email'],
            ['starred', 'Starred'],
            ['trash', 'Trash'],
          ] as const
        ).map(([v, l]) => ({ value: v, label: l })),
        onChange: (v: string) => (setDriveSection(v as DriveSection), setDriveFolder(null)),
      };
    return undefined;
  })();

  /* ---------------- The phone shell (src/mobile/, docs/mobile-kit.md) ---------------- */

  const chrome = useChrome(mode);
  const kb = useKeyboard();
  const ownBarOn = ownBar || savedBar.join() !== DEFAULT_BAR.join();
  const teamBar = companyBar(ws, myTeamIds);
  const tabApps: AppId[] = (ownBarOn ? savedBar : (teamBar ?? DEFAULT_BAR)).filter((id) => enabled.has(id)).slice(0, 4);
  const setTabApps = (bar: string[]) => (setSavedBar(bar as AppId[]), setOwnBar(true));
  // Focused screens that live in this file: an open mail on a phone, and a project's page (its Back goes in the top bar).
  useFocusedScreen(mobile && mode === 'mail' && readerOpen);
  useFocusedScreen(mobile && mode === 'projects' && projScope.kind === 'client', () => setProjScope({ kind: 'projects' }));
  // The bar steps aside on focused screens and while the keyboard is up.
  const barAway = chrome.focused || kb.open;
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains('bar-away') !== barAway) root.classList.toggle('bar-away', barAway);
  }, [barAway]);
  useEffect(() => () => document.documentElement.classList.remove('bar-away'), []);
  // Chat's badge: what's written to you (direct messages) and mentions of you, not every channel's chatter.
  const chatForMe = useMemo(() => {
    const fallback = new Date(Date.now() - 90 * 60_000).toISOString();
    const name = myFirst.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
    const at = new RegExp(`@${name}\\b`, 'i');
    let n = 0;
    for (const c of wsChannels) {
      const u = chatUnread[c.id];
      if (!u) continue;
      if (c.kind === 'dm') n += u;
      else n += messages.filter((m) => m.channelId === c.id && m.userId !== user.id && m.at > (lastRead[c.id] ?? fallback) && at.test(m.text)).length;
    }
    return n;
  }, [chatUnread, wsChannels, messages, lastRead, myFirst, user.id]);
  // Home's badge: what's in its "Needs you" list (src/needsYou.ts, the same rules Home and the AI connector use).
  const needsBadge = useMemo(
    () =>
      needsCount(
        needsYou({
          me: user.id,
          today: localDay(),
          now: Date.now(),
          tasks: wsTasks,
          stageKind: (t) => stageKind(t as Todo),
          teams: wsTeams,
          clients: wsClients,
          isOwner: ws.members.some((m) => m.userId === user.id && m.role === 'owner'),
          firstName: (id) => firstOf(id),
          threads: scoped,
          mine: isMine,
          notices: myNotices,
        }),
      ),
    [wsTasks, wsTeams, wsClients, scoped, myNotices, user.id, ws.members], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const barBadge = (id: AppId) => (id === 'home' ? needsBadge : id === 'mail' ? (accountUnread.all ?? 0) : id === 'chat' ? chatForMe : 0);
  // Search: inside the app on screen when it has things to search, with "All apps" one tap away.
  const [searchScope, setSearchScope] = useState<AppId | null>(null);
  const openSearch = (scope: AppId | null) => (setSearchScope(scope), setPaletteOpen(true));
  const searchHere = () => openSearch(mode !== 'settings' && SEARCHABLE.includes(mode) ? mode : null);
  usePullToSearch(searchHere, mobile && !paletteOpen);
  // Recent: the last projects, notes and tables opened here (More lists five).
  const [recentIds, setRecentIds] = usePersisted<{ kind: 'project' | 'note' | 'table'; id: string }[]>(`s2g-recent:${user.id}:${ws.id}`, []);
  const visited = (kind: 'project' | 'note' | 'table', id: string) => setRecentIds((list) => (list[0]?.kind === kind && list[0]?.id === id ? list : [{ kind, id }, ...list.filter((x) => !(x.kind === kind && x.id === id))].slice(0, 12)));
  useEffect(() => {
    if (mode === 'projects' && projScope.kind === 'client') visited('project', projScope.id);
  }, [mode, projScope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode === 'notes' && noteId) visited('note', noteId);
  }, [mode, noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode === 'tables' && tableId && wsTables.some((t) => t.id === tableId)) visited('table', tableId);
  }, [mode, tableId]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentLinks = recentIds
    .map((r) => {
      if (r.kind === 'project') {
        const c = wsClientsAll.find((x) => x.id === r.id);
        return c && { id: `p-${c.id}`, label: c.name, hint: term.One, icon: Briefcase, run: () => openClient(c.id) };
      }
      if (r.kind === 'note') {
        const n = wsNotes.find((x) => x.id === r.id);
        return n && { id: `n-${n.id}`, label: n.title || 'Untitled note', hint: 'Note', icon: FileText, run: () => openNote(n.id) };
      }
      const t = wsTables.find((x) => x.id === r.id);
      return t && { id: `t-${t.id}`, label: t.name, hint: 'Table', icon: Table2, run: () => (openTable(t.id), go('tables')) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 5);
  // An app's settings, opened over the app (Back returns to it) instead of jumping to the Settings page.
  const [pushed, setPushed] = useState<{ kind: 'own' | 'section'; id: string; label: string } | null>(null);
  useEffect(() => setPushed(null), [mode, ws.id]);
  const settingsRows =
    mode === 'settings'
      ? []
      : [
          ...chrome.settings.map((e) => ({ id: `own:${e.id}`, label: e.label, hint: e.hint, run: () => setPushed({ kind: 'own', id: e.id, label: e.label }) })),
          ...appSettingsLinks(mode, { admin: isAdmin, perms }).map((l) => ({ id: l.id, label: l.name, hint: l.hint, run: () => (setSettingsSection(l.id), setPushed({ kind: 'section', id: l.id, label: l.name })) })),
        ];
  const ownSettings = pushed?.kind === 'own' ? chrome.settings.find((e) => e.id === pushed.id) : undefined;
  // More: New things from anywhere.
  const [newMessage, setNewMessage] = useState(false);
  const [taskAdd, setTaskAdd] = useState(0); // bumps to open Tasks' new task field
  const makeLinks = [
    ...(enabled.has('mail') && mailOut ? [{ id: 'email', label: 'Email', icon: PenLine, run: () => openCompose() }] : []),
    ...(enabled.has('chat') ? [{ id: 'message', label: 'Message', icon: MessagesSquare, run: () => setNewMessage(true) }] : []),
    ...(enabled.has('tasks') ? [{ id: 'task', label: 'Task', icon: ListChecks, run: () => (openTasks({ kind: 'mine' }), setTaskAdd((n) => n + 1)) }] : []),
    ...(enabled.has('calendar') ? [{ id: 'event', label: 'Event', icon: CalendarPlus, run: () => (go('calendar'), openNewEvent()) }] : []),
    ...(enabled.has('notes') ? [{ id: 'note', label: 'Note', icon: FileText, run: () => newNote() }] : []),
    ...(enabled.has('drive') ? [{ id: 'upload', label: 'Upload', icon: Upload, run: () => (go('drive'), fileInput.current?.click()) }] : []),
  ];
  const meetLive = wsMeetings.some((m) => m.status === 'joining' || m.status === 'waiting_room' || m.status === 'recording');
  const moreApps = MORE_ORDER.filter((id) => enabled.has(id) && !tabApps.includes(id)).map((id) => {
    const a = APPS.find((x) => x.id === id)!;
    return { id, name: a.name, icon: a.icon, badge: barBadge(id), live: id === 'meet' && meetLive ? 'Recording' : undefined };
  });
  // Edit the bar lists the apps in More's order (Calendar first), after the ones on the bar.
  const enabledForBar = MORE_ORDER.filter((id) => enabled.has(id)).map((id) => APPS.find((a) => a.id === id)!).map((a) => ({ id: a.id, name: a.name, icon: a.icon }));

  // ⌘K: everything you can jump to
  const today0 = localDay();
  // Search inside tables and chat too. Built only when they change: they're the biggest part of the list.
  const deepItems = useMemo<PaletteItem[]>(() => {
    const chanIds = new Set(wsChannels.map((c) => c.id));
    const rows = wsTableRows.slice(0, 3000).map((r) => {
      const t = wsTables.find((x) => x.id === r.tableId);
      const name = t ? rowName(t, r) : 'Row';
      const cells = (Object.values(r.values) as unknown[])
        .flatMap((v) => (Array.isArray(v) ? (v as unknown[]) : [v]))
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
        .join(' ');
      return { id: 'row-' + r.id, group: 'Rows', title: name || 'Untitled row', sub: t?.name, icon: Table2, keywords: cells.slice(0, 1200), run: () => openTable(r.tableId, r.id) };
    });
    const msgs = messages
      .filter((m) => chanIds.has(m.channelId) && m.text)
      .slice(-800)
      .reverse()
      .map((m) => {
        const c = wsChannels.find((x) => x.id === m.channelId)!;
        return { id: 'msg-' + m.id, group: 'Messages', title: m.text.replace(/\s+/g, ' ').slice(0, 90), sub: `${c.kind === 'dm' ? 'Direct message' : '#' + c.name} · ${firstOf(m.userId)}`, icon: MessagesSquare, keywords: m.text.slice(0, 1500), run: () => (setFocusMsg(m.id), openChannel(m.channelId)) };
      });
    return [...rows, ...msgs];
  }, [wsTableRows, wsTables, messages, wsChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  const paletteItems: PaletteItem[] = [
    // What needs you, so an empty search is already useful.
    ...wsTasks
      .filter((t) => !t.done && ((stageKind(t) === 'review' && t.supervisorId === user.id) || (doersOf(t).includes(user.id) && !!t.due && t.due <= today0)))
      .map((t) => ({ id: 'n-' + t.id, group: 'Needs you', title: t.title, sub: stageKind(t) === 'review' ? 'Waiting for your review' : t.due! < today0 ? 'Late' : 'Due today', icon: ListChecks, run: () => openTask(t.id) })),
    { id: 'a-dump', group: 'Actions', title: 'Brain dump', sub: 'Turn your thoughts into assigned tasks', icon: Brain, app: 'tasks' as const, run: () => openDump('') },
    ...(enabled.has('mail') && mailOut ? [{ id: 'a-compose', group: 'Actions', title: 'Compose email', icon: PenLine, app: 'mail' as const, run: () => openCompose() }] : []),
    { id: 'a-task', group: 'Actions', title: 'New task', icon: ListChecks, app: 'tasks' as const, run: () => (openTasks({ kind: 'mine' }), setTaskAdd((n) => n + 1)) },
    ...(enabled.has('calendar') ? [{ id: 'a-event', group: 'Actions', title: 'New event', icon: CalendarPlus, app: 'calendar' as const, run: () => { go('calendar'); openNewEvent(); } }] : []),
    ...APPS.filter((a) => enabled.has(a.id)).map((a) => ({ id: 'go-' + a.id, group: 'Go to', title: a.name, icon: a.icon, run: () => go(a.id) })),
    ...wsClientsAll.map((c) => ({ id: 'c-' + c.id, group: `${term.Many}`, title: c.name, sub: c.status === 'ended' ? `Past ${term.one}` : c.domain, icon: Building2, run: () => openClient(c.id) })),
    ...wsTasks.filter((t) => !t.done).map((t) => ({ id: 't-' + t.id, group: 'Tasks', title: t.title, sub: [wsClients.find((c) => c.id === t.clientId)?.name, t.userId ? firstOf(t.userId) : 'nobody yet'].filter(Boolean).join(' · '), icon: ListChecks, keywords: [t.notes, t.context].filter(Boolean).join(' ').slice(0, 1500), run: () => openTask(t.id) })),
    ...members.filter((u) => u.id !== user.id).map((u) => ({ id: 'p-' + u.id, group: 'People', title: u.name, sub: u.title || u.email, icon: UserIcon, run: () => openChannel(dmWith(u.id)) })),
    ...wsChannels.filter((c) => c.kind === 'channel').map((c) => ({ id: 'ch-' + c.id, group: 'Channels', title: '#' + c.name, icon: Hash, run: () => openChannel(c.id) })),
    ...wsThreads.slice(0, 200).map((t) => ({ id: 'm-' + t.id, group: 'Emails', title: t.subject, sub: t.messages[t.messages.length - 1].from.name, icon: Mail, keywords: t.messages.slice(-2).map((m) => m.body).join(' ').slice(0, 1500), run: () => openThread(t.id) })),
    ...wsNotes.map((n) => ({ id: 'no-' + n.id, group: 'Notes', title: n.title || 'Untitled note', sub: wsClientsAll.find((c) => c.id === n.clientId)?.name, icon: FileText, keywords: htmlToText(n.html).slice(0, 2000), run: () => openNote(n.id) })),
    ...wsMeetings.map((m) => ({ id: 'mt-' + m.id, group: 'Meetings', title: m.title, icon: Video, keywords: [m.summary, ...(m.keyPoints ?? []), ...(m.decisions ?? []), ...(m.transcript ?? []).map((l) => l.text)].join(' ').slice(0, 6000), run: () => openMeeting(m.id) })),
    ...deepItems,
    ...wsDrive.filter((i) => i.kind !== 'folder' && !i.trashed).map((i) => ({ id: 'f-' + i.id, group: 'Files', title: i.name, icon: FileText, run: () => { go('drive'); setPreview({ item: i, list: [i] }); } })),
  ];

  // Everything shared with this person by other companies, on one page (from the switcher, also on phones).
  if (portalKey === '*' && myPortals.length)
    return <SharedHome name={user.name} portals={myPortals} todos={todos} channels={channels} messages={messages} onOpen={setPortalKey} onStart={() => setPortalKey('')} onSignOut={onSignOut} ownWorkspace={ws.name} />;

  // A company this person is a client of: their portal, with the same sign-in.
  const portal = myPortals.find((pt) => pt.key === portalKey);
  if (portal) {
    const pws = portal.ws;
    setBrandName(brandOf(pws)); // guests see the brand of the company that invited them
    const ended = afterEnd(portal.client, portal.person, accessFor(pws, portal.client));
    const access = ended.access;
    const team = allUsers.filter((u) => pws.members.some((m) => m.userId === u.id));
    const inbox = [user.id, clientInbox(user.email)];
    const actions = clientActions({
      ws: pws,
      client: portal.client,
      person: ended.person,
      access,
      team,
      teams: teams.filter((t) => t.workspaceId === pws.id),
      todos,
      channels,
      messages,
      meetings: meetings.filter((m) => m.workspaceId === pws.id),
      drive,
      setTodos,
      setMessages,
      setDrive,
      setClients,
      setNotices,
      setChannels,
      makeInvite: async (pp) => {
        if (!server.on) return null;
        const r = await fetch('/api/client-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: pws.id, clientId: portal.client.id, ...pp }) });
        if (!r.ok) return null;
      const { link } = (await r.json()) as { link: string | null };
      return link ? `${location.origin}${link}` : null; // null: they already sign in, nothing to send
      },
    });
    return (
      <ClientApp
        key={portal.key}
        ws={pws}
        client={portal.client}
        person={ended.person}
        access={access}
        team={team}
        actions={actions}
        messages={messages}
        allTasks={todos}
        quotes={quotes.filter((q) => q.workspaceId === pws.id)}
        onDecideQuote={decideQuote(user.email)}
        notices={notices.filter((n) => n.workspaceId === pws.id && inbox.includes(n.userId))}
        onReadNotices={() => setNotices((ns) => ns.map((n) => (n.workspaceId === pws.id && inbox.includes(n.userId) ? { ...n, read: true } : n)))}
        onSignOut={onSignOut}
        account={{ me: user, theme: settings.theme, onTheme: (t) => updateSettings({ theme: t }), onProfile: (patch) => (patch.name !== undefined && updateSettings({ name: patch.name, title: patch.title ?? settings.title, avatarColor: patch.color ?? settings.avatarColor }), onUpdateUser(patch)) }}
        switcher={<WorkspaceSwitcher onHome={myPortals.length > 1 ? () => setPortalKey('*') : undefined} workspaces={workspaces} current={pws} currentPortal={portal.key} unread={wsUnread} portals={portalItems} onPortal={setPortalKey} onSwitch={(id) => (setPortalKey(''), switchWorkspace(id))} />}
        mobileSwitch={{ workspaces: [...workspaces, pws], onWorkspace: (id) => id !== pws.id && (setPortalKey(''), switchWorkspace(id)) }}
      />
    );
  }

  // "View as client": the whole app becomes exactly what this client person sees.
  if (viewAs) {
    const vc = wsClients.find((c) => c.id === viewAs.clientId);
    const people = vc ? clientPeople(vc, channels) : [];
    const person = people.find((x) => x.email === viewAs.email);
    if (vc && person) {
      const view = afterEnd(vc, person, accessFor(ws, vc));
      const access = view.access;
      const actions = clientActions({ ws, client: vc, person: view.person, access, team: members, teams: wsTeams, todos, channels, messages, meetings: wsMeetings, drive, setTodos, setMessages, setDrive, setClients, setNotices, setChannels, makeInvite: makeClientInvite(vc.id) });
      const inbox = clientInbox(person.email);
      return (
        <ClientApp
          ws={ws}
          client={vc}
          person={view.person}
          access={access}
          team={members}
          actions={actions}
          messages={messages}
          allTasks={wsTasks}
          quotes={wsQuotes}
          onDecideQuote={decideQuote(person.email)}
          notices={notices.filter((n) => n.userId === inbox)}
          onReadNotices={() => setNotices((ns) => ns.map((n) => (n.userId === inbox ? { ...n, read: true } : n)))}
          preview={{ onExit: () => setViewAs(null), people: people.filter((x) => x.status !== 'pending'), onSwitch: (email) => setViewAs({ clientId: vc.id, email }) }}
        />
      );
    }
  }

  return (
    <TabDefaultsCtx.Provider value={tabDefaults}>
    <ProjectsCtx.Provider value={projectsCtx}>
    {inSandbox ? <DemoCompanyBar busy={demoBusy} onReset={() => setResettingDemo(true)} onHide={() => void hideDemo()} /> : topBar}
    <div className={`app mode-${mode} ${readerOpen ? 'reading' : ''} ${collapsed ? 'sb-collapsed' : ''} ${['home', 'settings'].includes(mode) ? 'no-sidebar' : ''} ${inSandbox || topBar ? 'with-demo-bar' : ''}`}>
      <AppRail
        current={mode}
        enabled={enabledApps}
        pinned={tablet ? tabApps : undefined}
        onPinned={setTabApps}
        badges={{ mail: accountUnread.all, chat: chatUnreadTotal, tasks: wsTasks.filter((t) => t.userId === user.id && !t.done && t.due && t.due <= localDay()).length }}
        workspace={
          <WorkspaceSwitcher onHome={myPortals.length > 1 ? () => setPortalKey('*') : undefined}
            workspaces={workspaces}
            current={ws}
            unread={wsUnread}
            onSwitch={switchWorkspace}
            portals={portalItems}
            onPortal={setPortalKey}
            onAdd={() => setNewWs(true)}
            onSettings={() => {
              setSettingsSection('workspace');
              go('settings');
            }}
            demo={demoEntry}
          />
        }
        account={
          <div className="account-wrap">
            <button className={`rail-avatar ${accountOpen || mode === 'settings' ? 'on' : ''}`} onClick={() => setAccountOpen((o) => !o)} title={`${ME.name} · account & settings`}>
              <Avatar person={ME} size={32} />
            </button>
            {accountOpen && (
          <AccountMenu
            me={ME}
            settings={settings}
            used={usage.mail + usage.drive}
            quota={usage.quota}
            onTheme={(theme) => updateSettings({ theme })}
            onSettings={(s) => {
              setSettingsSection(s);
              go('settings');
            }}
            onSignOut={onSignOut}
            others={signedInUsers.filter((u) => u.id !== user.id)}
            onSwitchUser={onSwitchUser}
            onAddUser={onAddUser}
            onClose={() => setAccountOpen(false)}
          />
            )}
          </div>
        }
        notifications={<Notifications notices={myNotices} onOpen={openNotice} onReadAll={() => setNotices((ns) => ns.map((n) => (n.userId === user.id && n.workspaceId === ws.id ? { ...n, read: true } : n)))} onClose={() => setNoticesOpen(false)} />}
        unreadNotices={myNotices.filter((n) => !n.read).length}
        noticesOpen={noticesOpen}
        aiOpen={!!askScope}
        onApp={go}
        onSearch={() => setPaletteOpen(true)}
        onAskAI={toggleAsk}
        onNotices={() => setNoticesOpen((o) => !o)}
      />
      <Sidebar
        mode={appMode}
        title={({ home: 'Home', mail: 'Mail', chat: 'Chat', tasks: 'Tasks', calendar: 'Calendar', notes: 'Notes', drive: 'Drive', meet: 'Meet', vault: 'Vault', settings: 'Settings' } as Record<string, string>)[appMode]}
        collapsed={collapsed && !mobile}
        onCollapse={setCollapsed}
        settings={appSettings(appMode, 'sidebar')}
        width={Math.min(Math.max(sidebarW, SIDEBAR_MIN), SIDEBAR_MAX)}
        onWidth={setSidebarW}
        mobileTop={
          <div className="drawer-top">
          <WorkspaceSwitcher onHome={myPortals.length > 1 ? () => setPortalKey('*') : undefined}
            workspaces={workspaces}
            current={ws}
            unread={wsUnread}
            onSwitch={switchWorkspace}
            portals={portalItems}
            onPortal={setPortalKey}
            onAdd={() => setNewWs(true)}
            onSettings={() => {
              setSettingsSection('workspace');
              go('settings');
            }}
            demo={demoEntry}
          />
            <button className="ghost-btn outline sm" onClick={() => go('settings')}>
              Settings
            </button>
          </div>
        }
        panel={
          appMode === 'calendar' ? (
          <CalendarSidebar
            cursor={calCursor}
            calendars={CALENDARS}
            external={myExtCals}
            teammates={members.filter((u) => u.id !== user.id)}
            shownMates={shownMates}
            onToggleMate={(id) =>
              setShownMates((m) => {
                const n = new Set(m);
                n.has(id) ? n.delete(id) : n.add(id);
                return n;
              })
            }
            onAddCalendar={() => (calendarsOn ? setConnectCal(true) : explainOff('Connecting Google, Outlook and iCloud calendars comes soon. Events made here already sync to everyone.'))}
            toPlan={wsTasks
              .filter((t) => !t.done && !isBrief(t) && doersOf(t).includes(user.id) && !events.some((e) => e.taskId === t.id && new Date(e.end).getTime() > Date.now()))
              .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
              .map((t) => ({ id: t.id, title: t.title, sub: [wsClients.find((c) => c.id === t.clientId)?.name, t.due ? dueLabel(t.due).text : ''].filter(Boolean).join(' · '), late: !!t.due && t.due < localDay() }))}
            onPlan={(id) => {
              const t = todos.find((x) => x.id === id);
              if (t) todoToCalendar(t);
            }}
            onShare={(id, share) => setExtCals((cs) => cs.map((c) => (c.id === id ? { ...c, share } : c)))}
            onSync={async (id) => {
              const cal = extCals.find((c) => c.id === id);
              // Links and holidays are read by the server: ask it to read them again now.
              if (real && (cal?.source === 'ics' || cal?.source === 'holidays')) {
                const r = (await fetch(`/api/calendars/${id}/refresh`, { method: 'POST' })
                  .then((x) => x.json())
                  .catch(() => ({ ok: false, error: 'Couldn’t reach the server. Try again in a moment.' }))) as { ok?: boolean; error?: string };
                showToast({ text: r.ok ? `${cal.name} is up to date` : `${cal.name} didn’t update. ${r.error ?? 'Try again later.'}`, ms: r.ok ? undefined : 8000 });
                return;
              }
              setExtCals((cs) => cs.map((c) => (c.id === id ? { ...c, syncedAt: nowIso() } : c)));
              showToast({ text: 'Synced' });
            }}
            onRemove={(id) => {
              const cal = extCals.find((c) => c.id === id);
              if (!cal) return;
              const snapshot = { extCals, events };
              setExtCals((cs) => cs.filter((c) => c.id !== id));
              setEvents((es) => es.filter((e) => e.calendarId !== id));
              // A link is put back and read again by the server (its events come back with it).
              const relink = real && cal.source === 'ics';
              showToast({ text: `${cal.name} removed`, action: { label: 'Undo', run: () => (relink ? setExtCals((cs) => [...cs, cal]) : (setExtCals(snapshot.extCals), setEvents(snapshot.events))) } });
            }}
            companyName={ws.name}
            isAdmin={isAdmin}
            onHolidays={() => setConnectCal('holidays')}
            onHolidaysOff={() => {
              const before = ws.holidays;
              patchWorkspace(ws.id, { holidays: undefined });
              if (!real) demoHolidays(null);
              showToast({ text: 'Public holidays removed for everyone', action: { label: 'Undo', run: () => (patchWorkspace(ws.id, { holidays: before }), !real && demoHolidays(before?.country ?? null)) } });
            }}
            hidden={hiddenCals}
            busyDays={busyDays}
            onCursor={(d) => {
              setCalCursor(d);
              setSidebarOpen(false);
              if (mode !== 'calendar') go('calendar');
            }}
            onToggle={(id) =>
              setHiddenCals((h) => {
                const n = new Set(h);
                n.has(id) ? n.delete(id) : n.add(id);
                return n;
              })
            }
            onNew={() => openNewEvent()}
          />
          ) : appMode === 'drive' ? (
          <DriveSidebar
            section={mode === 'drive' ? driveSection : null}
            used={usage.mail + usage.drive}
            quota={usage.quota}
            onSection={(s) => {
              setDriveSection(s);
              setDriveFolder(null);
              setSidebarOpen(false);
              if (mode !== 'drive') go('drive');
            }}
            onUpload={() => fileInput.current?.click()}
            onNewFolder={newFolder}
          />
          ) : appMode === 'projects' ? (
          <ProjectsSidebar
            scope={projScope}
            tasks={wsTasks}
            clients={wsClientsAll}
            isAdmin={seesAllProjects}
            myClientIds={myClientIds}
            onScope={(sc) => {
              setProjScope(sc);
              setSidebarOpen(false);
            }}
            onAddClient={
              canCreateProjects
                ? (name, domain, type) => {
                    const c = createProject(name, { domain, type });
                    setProjScope({ kind: 'client', id: c.id });
                  }
                : undefined
            }
          />
          ) : appMode === 'tasks' ? (
          <TasksSidebar
            scope={taskScope}
            tasks={wsTasks}
            clients={wsClientsAll}
            teams={wsTeams}
            me={user.id}
            isAdmin={isAdmin}
            myTeamIds={myTeamIds}
            myClientIds={myClientIds}
            onScope={(sc) => {
              openTasks(sc);
              setSidebarOpen(false);
            }}
            projectsApp={enabled.has('projects')}
            onBrainDump={() => openDump('')}
            onAddClient={
              canCreateProjects
                ? (name, domain, type) => {
                    const c = createProject(name, { domain, type });
                    setTaskScope({ kind: 'client', id: c.id });
                  }
                : undefined
            }
          />
          ) : appMode === 'meet' ? (
          <MeetSidebar
            page={meetPage}
            meetings={wsMeetings}
            clients={wsClients}
            canSend={meetSettings.whoCanRecord === 'everyone' || myRole !== 'member'}
            onPage={(pg) => (setMeetPage(pg), setSidebarOpen(false))}
            onSend={() => openSendBot()}
            onAsk={() => openAsk({ kind: 'all' })}
            onSettings={() => (setSettingsSection('meetings'), go('settings'))}
          />
          ) : appMode === 'chat' ? (
          <ChatSidebar
            channels={visibleChannels}
            users={members}
            me={user.id}
            workspaceId={ws.id}
            current={chatId}
            unread={chatUnread}
            lastAt={chatLastAt}
            statuses={statuses}
            presence={presence}
            onOpen={(id) => {
              setChatId(id);
              setSidebarOpen(false);
            }}
            onJoin={(id) => {
              setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, members: [...c.members, user.id] } : c)));
              setChatId(id);
              setSidebarOpen(false);
            }}
            onNewChannel={canStartChannels ? () => setChanDialog({}) : undefined}
            onNewDm={(uidOther) => setChatId(dmWith(uidOther))}
            canManage={canManageChannel}
            onMove={moveChannel}
            onSettings={(id) => setChanDialog({ id })}
            isAdmin={isAdmin}
            layout={ws.chat?.layout}
            teams={wsTeams}
            onSectionAccess={setSectionAccess}
            onLayout={(layout) => patchWorkspace(ws.id, { chat: { ...(ws.chat ?? { gifs: false, celebrations: true, whoCanCreate: 'everyone' }), layout } })}
            onStatus={(st) =>
              setStatuses((all) => {
                const next = { ...all };
                if (st) next[user.id] = st;
                else delete next[user.id];
                return next;
              })
            }
          />
          ) : appMode === 'vault' ? (
            <VaultSidebar items={vaultItems} clients={wsClientsAll} filter={vaultFilter} onFilter={(f) => (setVaultFilter(f), setSidebarOpen(false))} onNew={() => setVaultEditing('new')} />
          ) : appMode === 'teams' ? (
            <TeamsSidebar teams={wsTeams} me={user.id} current={wsTeams.some((t) => t.id === teamId) ? teamId : null} canCreate={canCreateTeams} onOpen={(id) => (setTeamId(id), setSidebarOpen(false))} onNew={() => setNewTeam(true)} />
          ) : appMode === 'tables' ? (
            <TablesSidebar tables={wsTables} clients={wsClientsAll} current={currentTable?.id ?? null} onOpen={(id) => (openTable(id), setSidebarOpen(false))} onNew={() => setNewTableFor({})} />
          ) : appMode === 'notes' ? (
            <NotesList notes={wsNotes} clients={wsClientsAll} current={noteId} filter={notesFilter} onFilter={setNotesFilter} onOpen={(id) => (setNoteId(id), setSidebarOpen(false))} onNew={() => newNote()} />
          ) : null
        }
        accounts={myAccounts}
        activeAccount={activeAccount}
        accountUnread={accountUnread}
        onNewTemp={() => setTempDialog({})}
        onNewProject={enabled.has('projects') ? () => (newProjectFlow(), setSidebarOpen(false)) : undefined}
        onTempMenu={(a, el) => ((tempAnchor.current = el), setTempMenu(a))}
        onAccountFilter={(id) => {
          setActiveAccount(id);
          setSelectedId(null);
          setReaderOpen(false);
          setSidebarOpen(false);
          if (view.kind !== 'folder') setView({ kind: 'folder', id: 'inbox' });
          if (mode !== 'mail') go('mail');
        }}
        view={view}
        labels={LABELS}
        clients={wsClients}
        onClient={(id) => (openClient(id, 'emails'), setSidebarOpen(false))}
        counts={counts}
        open={sidebarOpen}
        onSelect={selectView}
        onCompose={() => openCompose()}
        composeOff={mailOut ? undefined : 'Sending isn’t set up yet'}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main" key={`${ws.id}:${mode}`}>
        {mobile && (
          <MobileTop
            title={({ home: 'Home', mail: 'Mail', chat: 'Chat', tasks: 'Tasks', projects: term.Many, teams: 'Teams', tables: 'Tables', calendar: 'Calendar', notes: 'Notes', drive: 'Drive', meet: 'Meet', vault: 'Vault', settings: 'Settings' } as Record<string, string>)[mode] ?? ''}
            menu={chrome.title ?? mobileSwitcher}
            settings={settingsRows}
            back={chrome.back}
            workspaces={workspaces}
            current={ws}
            unreadByWs={wsUnread}
            onWorkspace={switchWorkspace}
            onAddWorkspace={() => setNewWs(true)}
            demo={demoEntry}
            portals={portalItems}
            onPortal={setPortalKey}
            onShared={myPortals.length > 1 ? () => setPortalKey('*') : undefined}
            onSearch={searchHere}
          />
        )}
        {mobile && mode === 'chat' && !chatId && (
          <section className="mobile-list view-enter">
            <ChatSidebar
              channels={visibleChannels}
              users={members}
              me={user.id}
              workspaceId={ws.id}
              current={chatId}
              unread={chatUnread}
              lastAt={chatLastAt}
              statuses={statuses}
              presence={presence}
              onOpen={setChatId}
              onJoin={(id) => {
                setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, members: [...c.members, user.id] } : c)));
                setChatId(id);
              }}
              onNewChannel={canStartChannels ? () => setChanDialog({}) : undefined}
              onNewDm={(uidOther) => setChatId(dmWith(uidOther))}
              canManage={canManageChannel}
              onMove={moveChannel}
              onSettings={(id) => setChanDialog({ id })}
              isAdmin={isAdmin}
              layout={ws.chat?.layout}
              teams={wsTeams}
              onSectionAccess={setSectionAccess}
              onLayout={(layout) => patchWorkspace(ws.id, { chat: { ...(ws.chat ?? { gifs: false, celebrations: true, whoCanCreate: 'everyone' }), layout } })}
              onStatus={(st) =>
                setStatuses((all) => {
                  const next = { ...all };
                  if (st) next[user.id] = st;
                  else delete next[user.id];
                  return next;
                })
              }
            />
          </section>
        )}
        {mode === 'mail' && view.kind === 'tracking' && (
          <TrackingDashboard
            threads={scoped}
            me={ME}
            onOpenThread={openThread}
            onNudge={(t, p) =>
              openCompose({
                initial: {
                  to: [p],
                  cc: [],
                  subject: /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`,
                  html: `<p>Hi ${p.name.split(' ')[0]}, just bringing this back to the top of your inbox. Any thoughts?</p>${settings.signature}`,
                  text: 'Hi, just bringing this back to the top of your inbox',
                  files: [],
                  track: true,
                  trackOptions: DEFAULT_TRACK_OPTIONS,
                  fromId: t.accountId,
                },
              })
            }
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'home' && (
          <HomeView
            key={ws.id}
            me={user}
            firstName={myFirst}
            isOwner={ws.members.some((m) => m.userId === user.id && m.role === 'owner')}
            workspaceId={ws.id}
            defaultTemplate={ws.teamHome?.[wsTeams.find((t) => t.members.includes(user.id))?.id ?? '']}
            tasks={wsTasks}
            clients={wsClients}
            teams={wsTeams}
            users={members}
            onAssign={(id, uid2) => patchTask(id, { userId: uid2 })}
            onSearch={() => setPaletteOpen(true)}
            onNudge={(id) => {
              const t = todos.find((x) => x.id === id);
              if (!t) return;
              doersOf(t).filter((x) => x !== user.id).forEach((x) => notify(x, 'task', `${myFirst} is checking on “${t.title}”${t.due ? `, it was due ${dueWords(t.due)}` : ''}`, { app: 'tasks', id }));
              logTask(id, 'comment', 'sent a reminder');
              showToast({ text: `Reminded ${doersOf(t).map(firstOf).join(', ')}` });
            }}
            onOpenTask={openTask}
            onOpenTeam={(id) => openTasks({ kind: 'team', id })}
            onOpenBriefs={() => openTasks({ kind: 'briefs' })}
            onOpenGrid={() => openTasks({ kind: 'grid' })}
            threads={scoped}
            events={myEvents}
            meetings={wsMeetings}
            notices={myNotices}
            kudos={messages
              .filter((m) => m.kind === 'kudos' && m.kudosFor && channels.some((c) => c.id === m.channelId && c.workspaceId === ws.id) && m.at > new Date(Date.now() - 7 * 86_400_000).toISOString())
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((m) => ({ id: m.id, to: m.kudosFor!, from: m.userId, text: m.text, at: m.at }))}
            enabled={enabled}
            ai={aiOn}
            onDump={(text) => openDump(text ?? '')}
            onToggleTask={toggleTodo}
            onOpenTasks={() => openTasks({ kind: 'mine' })}
            onOpenThread={openThread}
            onOpenMail={() => go('mail')}
            onOpenCalendar={(id) => {
              go('calendar');
              if (id) setSelectedEventId(id);
            }}
            onOpenClient={openClient}
            onOpenMeeting={openMeeting}
            onNotice={openNotice}
            onStart={(id) => {
              const t = todos.find((x) => x.id === id);
              if (t) setTaskStatus(id, stageIdFor(t, 'active'));
            }}
            onReschedule={(id, day) => patchTask(id, { due: day || undefined })}
            onReadNotices={(ids) => setNotices((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)))}
            onAllNotices={() => setNoticesOpen(true)}
            calls={wsChannels
              .filter((c) => c.huddle && c.huddle.members.some((m) => m !== user.id) && huddleId !== c.id)
              .map((c) => ({ id: c.id, name: c.name, people: c.huddle!.members.filter((m) => m !== user.id).map((m) => allUsers.find((u) => u.id === m)).filter((u): u is User => !!u) }))}
            onJoinHuddle={
              server.on
                ? (id) => {
                    if (huddleId && huddleId !== id) leaveHuddle();
                    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, huddle: { by: c.huddle?.by ?? user.id, at: c.huddle?.at ?? nowIso(), members: [...new Set([...(c.huddle?.members ?? []), user.id])] } } : c)));
                    setHuddleId(id);
                    openChannel(id);
                  }
                : (id) => openChannel(id)
            }
            botWillJoin={autoJoin === 'live' ? (e) => !sentFor[e.id] && botWillJoin(e) : undefined}
            onBotJoin={
              autoJoin === 'live'
                ? (e, join) => {
                    const byRule = botJoins(e, meetSettings.joinMode, {}, isMine);
                    setBotJoin(e.id, join === byRule ? null : join);
                    showToast({ text: join ? `The notetaker will join “${e.title}”` : `The notetaker won’t join “${e.title}”`, action: { label: 'Undo', run: () => setBotJoin(e.id, e.id in joinOverrides ? joinOverrides[e.id] : null) } });
                  }
                : undefined
            }
            onSendNotetaker={botOn && autoJoin !== 'live' ? sendNotetakerTo : undefined}
            notetakerSent={sentFor}
            onMenu={() => setSidebarOpen(true)}
            news={news.filter((n) => !newsSeen.includes(n.id))}
            onDismissNews={(id) => setNewsSeen((s) => [...s.slice(-50), id])}
            top={
              inSandbox && ws.sandbox && !ws.sandbox.listOff ? (
                <TryList
                  tried={ws.sandbox.tried ?? []}
                  onGo={goTry}
                  onClose={() => (patchWorkspace(ws.id, { sandbox: { ...ws.sandbox!, listOff: true } }), showToast({ text: 'The list is in Help & support whenever you want it' }))}
                  onDone={(() => {
                    const realWs = workspaces.find((w) => !isSandbox(w));
                    return realWs ? { label: `Go to ${realWs.name}`, run: () => switchWorkspace(realWs.id) } : { label: 'Set up your company', run: () => setNewWs(true) };
                  })()}
                />
              ) : !inSandbox && demo?.allowed && demo.state === 'none' && !demoInviteOff && !allWsTasks.length && !wsClientsAll.length ? (
                <DemoInvite busy={demoBusy} onOpen={() => void openDemo()} onClose={() => setDemoInviteOff(true)} />
              ) : undefined
            }
            setup={
              !inSandbox && ws.members.some((m) => m.userId === user.id && m.role !== 'member')
                ? [
                    {
                      key: 'email',
                      label: 'Email',
                      hint: ws.emailSetup === 'none' ? 'Mail is off for this company' : mailIn && mailOut ? 'Receiving and sending work' : `${mailIn ? 'Receiving works. ' : ''}${mailOut ? 'Sending works. ' : ''}${(!mailIn ? mailWhy.receive : mailWhy.send) ?? 'Add the records for your domain'}`,
                      done: ws.emailSetup === 'none' || (mailIn && mailOut),
                      onOpen: () => (setSettingsSection('email'), go('settings')),
                    },
                    { key: 'people', label: 'Your team', hint: ws.members.length > 1 ? `${ws.members.length} people in` : 'Invite the people you work with', done: ws.members.length > 1, onOpen: () => (setSettingsSection('workspace'), go('settings')) },
                    { key: 'brand', label: 'Logo and colour', hint: ws.logo ? 'Set' : 'Your logo on the app and in shared spaces', done: !!ws.logo, onOpen: () => (setSettingsSection('workspace'), go('settings')) },
                    { key: 'plan', label: 'Plan', hint: ws.plan?.payment ? 'Payment set up' : ws.plan?.trialEnds ? `Trial ends ${new Date(ws.plan.trialEnds).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}; pick a plan before then` : 'Pick a plan', done: !!ws.plan?.payment || ws.plan?.tier === 'free', onOpen: () => (setSettingsSection('billing'), go('settings')) },
                  ]
                : undefined
            }
          />
        )}

        {mode === 'projects' && projScope.kind === 'projects' && (
          <ProjectsHome
            key={projNew}
            startAdding={projNew > 0}
            projects={seesAllProjects ? wsClientsAll : wsClientsAll.filter((c) => myClientIds.includes(c.id))}
            tasks={wsTasks}
            users={members}
            onOpen={(id) => setProjScope({ kind: 'client', id })}
            onCreate={
              canCreateProjects
                ? (name, type) => {
                    const c = createProject(name, { type });
                    setProjScope({ kind: 'client', id: c.id });
                  }
                : undefined
            }
            onMenu={() => setSidebarOpen(true)}
          />
        )}
        {(mode === 'tasks' || (mode === 'projects' && projScope.kind !== 'projects')) && (
          <TasksView
            scope={mode === 'projects' ? projScope : taskScope}
            canInviteGuests={isAdmin || perms.inviteGuests}
            quotes={wsQuotes}
            onQuote={{ save: saveQuote, remove: (id) => setQuotes((qs) => qs.filter((x) => x.id !== id)), send: sendQuote, brief: briefFromQuote }}
            tasks={wsTasks}
            clients={wsClientsAll}
            teams={wsTeams}
            onScope={(sc) => (mode === 'projects' && (sc.kind === 'client' || sc.kind === 'past') ? setProjScope(sc) : openTasks(sc))}
            logins={vaultItems.map((v) => ({ id: v.id, title: v.meta.title, url: v.meta.url, username: v.meta.username, clientId: v.meta.clientId, hasTotp: v.hasTotp }))}
            onOpenLogins={(clientId) => (setVaultFilter(clientId), go('vault'))}
            onNewLogin={(clientId) => (setVaultFilter(clientId), setVaultEditing('new'), go('vault'))}
            tables={enabled.has('tables') ? wsTables : undefined}
            tableRows={wsTableRows}
            onOpenTable={enabled.has('tables') ? (id) => openTable(id) : undefined}
            onNewTable={(clientId) => setNewTableFor({ clientId })}
            onOpenTask={setTaskOpen}
            myTeamIds={myTeamIds}
            myClientIds={myClientIds}
            files={drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id)}
            workspace={ws}
            canManage={isAdmin}
            onViewAs={(clientId, email) => (tried('guest'), setViewAs({ clientId, email }))}
            onPatchClient={patchClient}
            onInviteClientPerson={inviteClientPerson}
            onApproveClientPerson={approveClientPerson}
            onEndClient={setEnding}
            notes={wsNotes}
            onOpenNote={openNote}
            onNewNote={(clientId) => newNote('', clientId)}
            onReactivateClient={reactivateClient}
            messages={messages}
            clientTab={clientTab}
            onWriteOverview={writeOverview}
            onShareMeeting={(id, shared) => setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, sharedWithClient: shared } : m)))}
            onShareFile={(id, shared) => patchDrive(id, { sharedWithClient: shared })}
            users={members}
            me={user.id}
            threads={wsThreads}
            channels={wsChannels}
            meetings={wsMeetings}
            onAdd={(t) => createTask({ ...t, source: 'manual' }, { chat: true }).id}
            onOpenProject={enabled.has('projects') ? (id) => openClient(id) : undefined}
            onPastProjects={enabled.has('projects') ? () => (setProjScope({ kind: 'past' }), go('projects')) : undefined}
            onStatus={setTaskStatus}
            onPatch={patchTask}
            onDelete={deleteTodo}
            onToCalendar={todoToCalendar}
            onOpenThread={openThread}
            onOpenChannel={openChannel}
            onOpenMeeting={openMeeting}
            onBrainDump={() => openDump('')}
            addKey={taskAdd}
            dumpInSidebar={mode === 'tasks'}
            onTemplate={() => setTplOpen({ clientId: taskScope.kind === 'client' ? taskScope.id : undefined })}
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'chat' && (!mobile || chatId) && (
          <ChatView
            huddle={
              server.on && chatId
                ? {
                    joined: huddleId === chatId,
                    onJoin: () => {
                      tried('voice');
                      if (huddleId && huddleId !== chatId) leaveHuddle();
                      setChannels((cs) => cs.map((c) => (c.id === chatId ? { ...c, huddle: { by: c.huddle?.by ?? user.id, at: c.huddle?.at ?? nowIso(), members: [...new Set([...(c.huddle?.members ?? []), user.id])] } } : c)));
                      setHuddleId(chatId);
                    },
                  }
                : undefined
            }
            focusId={focusMsg}
            onFocused={() => setFocusMsg(null)}
            timeZone={ws.timeZone}
            channel={wsChannels.find((c) => c.id === chatId) ?? null}
            messages={messages.filter((m) => m.channelId === chatId)}
            users={members}
            me={user.id}
            myRole={myRole}
            clients={wsClients}
            teams={wsTeams}
            tasks={wsTasks}
            mail={wsThreads}
            drive={(() => {
              const ch = channels.find((c) => c.id === chatId);
              const cl = wsClients.find((c) => c.id === ch?.clientId);
              const word = cl?.name.split(' ')[0].toLowerCase();
              return cl ? drive.filter((d) => !d.trashed && d.kind !== 'folder' && !d.channelId && (d.workspaceId ?? 'pnp') === ws.id && (d.clientId === cl.id || (!!word && d.name.toLowerCase().includes(word)))) : [];
            })()}
            statuses={statuses}
            presence={presence}
            gifs={ws.chat?.gifs !== false}
            meetUrl={ws.meetUrl}
            onSend={sendChat}
            onDelete={deleteMessage}
            onPin={(id) => {
              const m = messages.find((x) => x.id === id);
              setMessages((ms) => ms.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)));
              showToast({ text: m?.pinned ? 'Unpinned' : 'Pinned to the channel' });
            }}
            onToggleTask={toggleTodo}
            onChannel={(patch) => chatId && setChannels((cs) => cs.map((c) => (c.id === chatId ? { ...c, ...patch } : c)))}
            summaryCost={summaryCost}
            summaryOff={
              server.on && !aiOn
                ? {
                    text: aiWhy === 'used-up' ? 'the company’s AI allowance for this month is used up.' : aiWhy === 'down' ? 'AI isn’t available right now. They start again by themselves when it’s back.' : 'AI isn’t set up for this company yet.',
                    fix: isAdmin && aiWhy !== 'down' ? { label: aiWhy === 'used-up' ? 'Add a top-up' : 'Set up AI', run: () => (setSettingsSection(aiWhy === 'used-up' ? 'billing' : 'ai'), go('settings')) } : undefined,
                  }
                : undefined
            }
            since={sinceRead}
            onReact={reactTo}
            onVote={votePoll}
            onMakeTask={makeTaskFromMessage}
            onCreateTask={(t) => {
              const ch = channels.find((c) => c.id === chatId);
              const task = createTask({ ...t, clientId: ch?.clientId, teamId: ch?.teamId, channelId: chatId ?? undefined, source: 'chat' }, { chat: false });
              if (chatId) setMessages((ms) => [...ms, { id: uid(), channelId: chatId, userId: user.id, text: `📌 New task${t.userId !== user.id ? ` for @${firstOf(t.userId)}` : ''}`, at: nowIso(), taskId: task.id }]);
            }}
            onOpenTask={openTask}
            onOpenClient={openClient}
            onOpenTeam={(id) => openTasks({ kind: 'team', id })}
            onOpenMail={openThread}
            onSettings={() => chatId && setChanDialog({ id: chatId })}
            onMenu={() => setSidebarOpen(true)}
            onBack={mobile ? () => setChatId(null) : undefined}
          />
        )}

        {mode === 'meet' && (
          <MeetView
            page={meetPage}
            meetings={wsMeetings}
            clients={wsClients}
            tasks={wsTasks}
            users={members}
            me={user.id}
            myRole={myRole}
            events={myEvents}
            settings={meetSettings}
            overrides={joinOverrides}
            sentEvents={sentFor}
            autoJoin={autoJoin}
            onPage={setMeetPage}
            onStop={stopBot}
            onRegenerate={(id) => finishMeeting(id, true)}
            onTranscribeAgain={
              recorderOn && real
                ? (id, language) =>
                    void fetch(`/api/meet/again/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language }) }).then(async (r) =>
                      showToast({ text: r.ok ? 'Transcribing again. The notes update when it’s done.' : (((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Couldn’t transcribe again') }),
                    )
                : undefined
            }
            onDelete={deleteMeeting}
            onFolder={setMeetingFolder}
            onPatch={patchMeeting}
            onShare={setShareFor}
            onToggleTask={toggleTodo}
            onPatchTask={patchTask}
            onBulk={(ids, action) =>
              action === 'delete'
                ? setTodos((ts) => ts.filter((t) => !ids.includes(t.id)))
                : setTodos((ts) => ts.map((t) => (ids.includes(t.id) ? { ...t, done: action === 'done', status: stageIdFor(t, action === 'done' ? 'done' : 'open'), doneAt: action === 'done' ? nowIso() : undefined, doneBy: action === 'done' ? user.id : undefined } : t)))
            }
            onAddTask={(t) => createTask({ ...t, source: t.meetingId ? 'meeting' : 'manual' }, { chat: true })}
            onOpenTask={openTask}
            onOpenClient={openClient}
            onWriteOverview={writeOverview}
            onJoinMode={(jm) => patchWorkspace(ws.id, { meetings: { ...meetSettings, joinMode: jm } })}
            onOverride={setBotJoin}
            onSendNow={(e) => sendNotetakerTo(e)}
            demo={demoOk}
            calendarsSyncedAt={linkCals.reduce<string | undefined>((a, c) => (c.syncedAt && (!a || c.syncedAt > a) ? c.syncedAt : a), undefined)}
            onSyncCalendars={real && linkCals.some((c) => c.source === 'ics') ? refreshLinks : demoOk ? () => showToast({ text: 'Synced' }) : undefined}
            onAsk={setAskScope}
            onSend={() => openSendBot()}
            canSendBot={botOn}
            onMenu={() => setSidebarOpen(true)}
            toast={(text) => showToast({ text })}
          />
        )}

        {mode === 'mail' && myAccounts.length === 0 && (
          <AppSetupCard
            icon={Mail}
            title="Your email isn’t here yet"
            body={
              isAdmin
                ? 'Connect a mailbox to read and send email here, next to your tasks and chat. You can keep Gmail or Outlook and forward a copy, or move your email over.'
                : 'An admin connects mailboxes for the team. Ask them to add yours, or make a temporary address for a quick sign-up in the meantime.'
            }
            actions={
              <>
                {isAdmin ? (
                  <button className="primary-btn" onClick={() => setNewAcct(true)}>
                    <Mail size={15} /> Connect a mailbox
                  </button>
                ) : (
                  <button
                    className="primary-btn"
                    onClick={() => {
                      const admins = ws.members.filter((m) => m.role !== 'member' && m.userId !== user.id).map((m) => m.userId);
                      admins.forEach((a) => notify(a, 'mail', `${myFirst} asked for a mailbox in ${ws.name}`, { app: 'settings', id: 'workspace' }));
                      showToast({ text: admins.length ? `Asked ${admins.map(firstOf).join(', ')}` : 'There’s no other admin to ask yet' });
                    }}
                  >
                    Ask for a mailbox
                  </button>
                )}
                <button className="ghost-btn outline" onClick={() => setTempDialog({})}>
                  <Timer size={15} /> Make a temporary address
                </button>
              </>
            }
            onHide={() => setMyHidden([...myHidden, 'mail'])}
          />
        )}
        {mode === 'mail' && myAccounts.length > 0 && !mailIn && !mailOut && (
          <section className="settings-pane view-enter mail-setup">
            <header className="settings-head">
              <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
                <Menu size={18} />
              </button>
              <h1>Mail</h1>
            </header>
            <div className="mail-setup-body">
              <div className="mail-setup-lead">
                <strong>Email isn’t working here yet</strong>
                <span>{isAdmin ? 'Mail opens as soon as your domain’s records are in place. Pick how it should work, add the records, then check.' : 'An admin is setting up email for the company. Mail opens here as soon as it works.'}</span>
                {(mailWhy.receive || mailWhy.send) && <small>{mailWhy.receive ?? mailWhy.send}</small>}
              </div>
              {isAdmin && (
                <EmailDeliverySection ws={ws} canManage firstName={myFirst} onWorkspace={(p) => patchWorkspace(ws.id, p)} onAddAccount={() => setNewAcct(true)} onRemoveAccount={setRemoveAcct} toast={(text) => showToast({ text })} />
              )}
            </div>
          </section>
        )}
        {mode === 'mail' && myAccounts.length > 0 && (mailIn || mailOut) && view.kind !== 'tracking' && (
          <div className="mail-view view-enter">
            <MessageList
              notice={
                !mailIn || !mailOut ? (
                  <div className="mail-gate">
                    <AlertTriangle size={14} />
                    <span>{!mailIn ? `Incoming mail isn’t connected yet. ${mailWhy.receive ?? ''}` : `Compose and Reply are off here. ${mailWhy.send ?? 'Sending isn’t set up yet.'}`}</span>
                    {isAdmin && (
                      <button type="button" className="link-btn small" onClick={() => (setSettingsSection('email'), go('settings'))}>
                        Fix it
                      </button>
                    )}
                  </div>
                ) : undefined
              }
              ref={searchRef}
              title={title}
              threads={visible}
              clientOf={clientForThread}
              personName={(id) => allUsers.find((u) => u.id === id)?.name}
              meId={user.id}
              me={ME}
              selectedId={selectedId}
              query={query}
              filter={filter}
              leaving={leaving}
              showSnippets={settings.showSnippets}
              width={Math.min(Math.max(listW, 300), 560)}
              onWidth={setListW}
              onRefresh={refreshMail}
              onCompose={mailOut ? () => openCompose() : undefined}
              updatedAt={mailLive.at}
              offline={real && mailLive.down}
              onQuery={setQuery}
              onFilter={setFilter}
              onOpen={open}
              onStar={star}
              onArchive={archive}
              onTrash={trash}
              onSnooze={(id) => {
                const when = new Date();
                when.setDate(when.getDate() + 1);
                when.setHours(9, 0, 0, 0);
                patchThread(id, { snoozedUntil: when.toISOString() });
                if (selectedId === id) (setSelectedId(null), setReaderOpen(false));
                showToast({ text: 'Snoozed until tomorrow 9:00', action: { label: 'Undo', run: () => patchThread(id, { snoozedUntil: undefined }) } });
              }}
              onMenu={() => setSidebarOpen(true)}
              empty={(() => {
                const t = myAccounts.find((a) => a.id === activeAccount && a.temp);
                return t
                  ? {
                      title: 'Nothing here yet',
                      sub: `Mail sent to ${t.email} lands here. ${lifeLeft(t)}.`,
                      action: (
                        <button className="ghost-btn sm outline" onClick={() => testTemp(t)}>
                          <Send size={14} /> Send a test email
                        </button>
                      ),
                    }
                  : undefined;
              })()}
            />
            <Reader
              thread={selected}
              restoreReply={restoreReply}
              replyOff={selectedAcct && !boxReady(selectedAcct.id).send ? 'Sending isn’t set up for this mailbox yet' : undefined}
              onReplyOff={() => selectedAcct && replyBlocked(selectedAcct)}
              teammates={selected ? members.filter((u) => ws.accounts.find((a) => a.id === selected.accountId)?.users.includes(u.id)) : []}
              shared={!!selected && ws.accounts.find((a) => a.id === selected.accountId)?.kind === 'shared'}
              onAssign={(id, who) => {
                patchThread(id, { assignee: who || undefined });
                const t = threads.find((x) => x.id === id);
                if (who && who !== user.id) notify(who, 'mail', `${myFirst} asked you to handle “${t?.subject}”`, { app: 'mail', id });
                showToast({ text: who ? `${who === user.id ? 'You’re' : `${firstOf(who)} is`} handling this one` : 'Unassigned' });
              }}
              onSnooze={(id, until) => {
                patchThread(id, { snoozedUntil: until });
                setSelectedId(null);
                setReaderOpen(false);
                showToast({ text: `Snoozed until ${new Date(until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, action: { label: 'Undo', run: () => patchThread(id, { snoozedUntil: undefined }) } });
              }}
              onNote={(id, text) => {
                const t = threads.find((x) => x.id === id);
                patchThread(id, { notes: [...(t?.notes ?? []), { id: uid(), by: user.id, text, at: nowIso() }] });
                members.filter((u) => u.id !== user.id && new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(text)).forEach((u) => notify(u.id, 'mention', `${myFirst} mentioned you in a note on “${t?.subject}”`, { app: 'mail', id }));
              }}
              client={selected ? clientForThread(selected) : undefined}
              onClient={(id) => openClient(id, 'emails')}
              me={ME}
              signature={settings.signature}
              blockTrackers={settings.blockTrackers}
              myName={settings.name || user.name}
              todos={selected ? myTodos.filter((t) => t.threadId === selected.id) : []}
              onToggleTodo={toggleTodo}
              onMakeTask={enabled.has('tasks') ? taskFromThread : undefined}
              onOpenTodos={() => openTasks({ kind: 'mine' })}
              unsubscribedAt={selected && incomingFrom(selected) ? unsubscribed[domainOf(incomingFrom(selected)!.email)] : undefined}
              onUnsubscribe={unsubscribe}
              onBlock={setBlockTarget}
              inviteAdded={!!selected && events.some((e) => e.threadId === selected.id && e.start === selected.invite?.start)}
              inviteConflicts={selected?.invite ? conflictsWith(selected.invite.start, selected.invite.end) : []}
              savedToDrive={savedToDrive}
              onSaveToDrive={saveToDrive}
              onAddInvite={addInvite}
              inviteCard={(m) => selected && inviteCard(selected, m)}
              onBack={() => setReaderOpen(false)}
              onArchive={archive}
              onTrash={trash}
              onSpam={spam}
              onMoveToInbox={toInbox}
              onStar={star}
              onMarkUnread={markUnread}
              onReply={reply}
              canTrack={ws.readTracking !== false}
              trackByDefault={settings.trackByDefault}
            />
          </div>
        )}

        {mode === 'calendar' && (
          <CalendarView
            events={visibleEvents}
            calendars={allCals}
            cursor={calCursor}
            view={calView}
            selected={selectedEvent}
            onCursor={setCalCursor}
            onView={setCalView}
            onSelect={setSelectedEventId}
            onCreate={(d) => openNewEvent(d)}
            onDelete={deleteEvent}
            onOpenThread={openThread}
            onMenu={() => setSidebarOpen(true)}
            canEdit={(e) => !e.calendarId.startsWith('mate-') && !e.feed && !extCals.find((c) => c.id === e.calendarId)?.readOnly && events.some((x) => x.id === e.id)}
            onNotetaker={botOn ? sendNotetakerTo : undefined}
            botWillJoin={autoJoin === 'live' ? (e) => !sentFor[e.id] && botWillJoin(e) : undefined}
            onBotJoin={
              autoJoin === 'live'
                ? (e, join) => {
                    const byRule = botJoins(e, meetSettings.joinMode, {}, isMine);
                    setBotJoin(e.id, join === byRule ? null : join);
                    showToast({ text: join ? `The notetaker will join “${e.title}”` : `The notetaker won’t join “${e.title}”`, action: { label: 'Undo', run: () => setBotJoin(e.id, e.id in joinOverrides ? joinOverrides[e.id] : null) } });
                  }
                : undefined
            }
            onMove={(id, start, end) => {
              const before = events.find((e) => e.id === id);
              if (!before) return;
              setEvents((es) => es.map((e) => (e.id === id ? { ...e, start: start.toISOString(), end: end.toISOString() } : e)));
              const resized = new Date(before.start).getTime() === start.getTime();
              showToast({
                text: resized ? `Now ${fmtTime(start)} to ${fmtTime(end)}` : `Moved to ${start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(start)}`,
                action: { label: 'Undo', run: () => setEvents((es) => es.map((e) => (e.id === id ? before : e))) },
              });
            }}
            onSchedule={(taskId, start) => {
              const t = todos.find((x) => x.id === taskId);
              if (!t) return;
              const ev: CalEvent = { id: uid(), title: t.title, calendarId: 'work', start: start.toISOString(), end: new Date(start.getTime() + 60 * 60_000).toISOString(), taskId, threadId: t.threadId, workspaceId: ws.id, userId: user.id };
              setEvents((es) => [...es, ev]);
              showToast({ text: `Blocked ${fmtTime(start)} for “${t.title}”. Drag the bottom edge to change how long`, action: { label: 'Undo', run: () => setEvents((es) => es.filter((e) => e.id !== ev.id)) } });
            }}
            taskOf={(e) => {
              const t = e.taskId ? todos.find((x) => x.id === e.taskId) : undefined;
              return t ? { title: t.title, done: t.done } : null;
            }}
            onExtend={(id, m) => setEvents((es) => es.map((e) => (e.id === id ? { ...e, end: new Date(new Date(e.end).getTime() + m * 60_000).toISOString() } : e)))}
            onTomorrow={(id) =>
              setEvents((es) =>
                es.map((e) => (e.id === id ? { ...e, start: new Date(new Date(e.start).getTime() + 86_400_000).toISOString(), end: new Date(new Date(e.end).getTime() + 86_400_000).toISOString() } : e)),
              )
            }
            onTaskDone={(e) => e.taskId && setTaskStatus(e.taskId, stageIdFor(todos.find((x) => x.id === e.taskId) ?? { workspaceId: ws.id }, 'done'))}
            sentBot={(e) => {
              const mid = sentFor[e.id];
              return mid ? () => (setMeetPage({ kind: 'meeting', id: mid }), go('meet')) : undefined;
            }}
          />
        )}

        {mode === 'vault' && (
          <VaultView
            workspaceId={ws.id}
            items={vaultItems}
            reload={loadVault}
            filter={vaultFilter}
            clients={wsClientsAll}
            users={members}
            teams={wsTeams}
            me={user.id}
            isAdmin={isAdmin}
            editing={vaultEditing}
            setEditing={setVaultEditing}
            toast={(text) => showToast({ text })}
            vaultKey={allUsers.find((u) => u.id === user.id)?.vaultKey}
            onVaultKey={(record) => onUpdateUser({ vaultKey: record })}
            adminIds={ws.members.filter((m) => m.role !== 'member').map((m) => m.userId)}
          />
        )}

        {mode === 'tables' &&
          (currentTable && !(mobile && !tableId) ? (
            <TableScreen
              key={currentTable.id}
              table={currentTable}
              tables={wsTables}
              rows={wsTableRows}
              users={members}
              clients={wsClientsAll}
              me={user.id}
              setTables={setTables}
              setRows={setTableRows}
              onOpenTable={openTable}
              openRow={tableRow}
              setOpenRow={setTableRow}
              onDeleted={() => setTableId(null)}
              onMenu={() => (mobile ? setTableId(null) : setSidebarOpen(true))}
              toast={showToast}
              channels={wsChannels}
              isAdmin={isAdmin}
              canEditTables={perms.editTables}
              canDeleteThings={perms.deleteThings}
              serverOn={real}
              inDemo={inSandbox}
              onCompose={(m) => openCompose({ initial: { to: m.to ? [{ name: m.to, email: m.to }] : [], cc: [], subject: m.subject, html: textToHtml(m.body) + settings.signature, text: m.body, files: [], track: settings.trackByDefault, trackOptions: DEFAULT_TRACK_OPTIONS, fromId: (myAccounts.find((a) => a.kind === 'personal') ?? myAccounts[0])?.id ?? '' } })}
            />
          ) : (
            <TablesHome tables={wsTables} rows={wsTableRows} clients={wsClientsAll} onOpen={openTable} onNew={() => setNewTableFor({})} onMenu={() => setSidebarOpen(true)} />
          ))}
        {mode === 'teams' &&
          (() => {
            const team = wsTeams.find((t) => t.id === teamId);
            return team ? (
              <TeamPage
                key={team.id}
                team={team}
                teams={wsTeams}
                users={members}
                tasks={wsTasks}
                clients={wsClientsAll}
                me={user.id}
                isAdmin={isAdmin}
                actions={teamActions}
                homeTemplate={ws.teamHome?.[team.id]}
                onHomeTemplate={(v) => patchWorkspace(ws.id, { teamHome: { ...(ws.teamHome ?? {}), [team.id]: v } })}
                onOpenTask={openTask}
                onBack={() => setTeamId(null)}
              />
            ) : (
              <TeamsHome teams={wsTeams} users={members} tasks={wsTasks} me={user.id} canCreate={canCreateTeams} actions={teamActions} onOpen={setTeamId} onNew={() => setNewTeam(true)} onMenu={() => setSidebarOpen(true)} />
            );
          })()}
        {newTeam && (
          <NewTeamDialog
            users={members}
            me={user.id}
            count={wsTeams.length}
            onClose={() => setNewTeam(false)}
            onCreate={(t) => {
              const id = 't-' + Date.now().toString(36);
              saveTeams([...wsTeams, { ...t, id, workspaceId: ws.id }]);
              setTeamId(id);
              go('teams');
              showToast({ text: `${t.name} created, with its own channel` });
            }}
          />
        )}
        {newTableFor && <NewTableDialog clients={wsClients} clientId={newTableFor.clientId} onCreate={createTable} onClose={() => setNewTableFor(null)} />}

        {mode === 'notes' &&
          (mobile && !noteId ? (
            <section className="mobile-list view-enter">
              <NotesList notes={wsNotes} clients={wsClientsAll} current={noteId} filter={notesFilter} onFilter={setNotesFilter} onOpen={setNoteId} onNew={() => newNote()} />
            </section>
          ) : (
            <NoteEditor
              note={wsNotes.find((n) => n.id === noteId)}
              users={members}
              clients={wsClientsAll}
              me={user.id}
              onPatch={patchNote}
              onDelete={deleteNote}
              onTask={(text, n) => {
                const t = createTask({ title: text.length > 120 ? text.slice(0, 117) + '…' : text, clientId: n.clientId, userId: user.id, source: 'manual' });
                showToast({ text: `Task made: “${t.title}”`, action: { label: 'Open', run: () => openTask(t.id) } });
              }}
              onBack={mobile ? () => setNoteId(null) : undefined}
            />
          ))}

        {mode === 'drive' && (
          <DriveView
            items={allDrive}
            section={driveSection}
            folderId={driveFolder}
            renamingId={renamingId}
            senderOf={(id) => threads.find((t) => t.id === id)?.messages[0].from.name ?? ''}
            onFolder={(id) => {
              setDriveSection('my');
              setDriveFolder(id);
            }}
            onSection={setDriveSection}
            onOpen={(item, list) => setPreview({ item, list })}
            onStar={(id) => patchDrive(id, { starred: !drive.find((i) => i.id === id)?.starred })}
            onTrash={trashDrive}
            onRestore={(id) => patchDrive(id, { trashed: false })}
            onDeleteForever={deleteForever}
            onStartRename={setRenamingId}
            onRename={(id, name) => {
              setRenamingId(null);
              if (name && name.trim()) patchDrive(id, { name: name.trim(), modified: new Date().toISOString() });
            }}
            onPickFiles={() => fileInput.current?.click()}
            onDropFiles={upload}
            onOpenThread={openThread}
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {(mode === 'settings' || pushed?.kind === 'section') && (
          <PushedSettings push={mode === 'settings' ? null : pushed} onBack={() => setPushed(null)}>
          <SettingsPage
            embedded={mode !== 'settings'}
            demo={
              demo && server.on
                ? { inDemo: inSandbox, allowed: demo.allowed, state: demo.state, listOff: !!sandboxWs?.sandbox?.listOff, busy: demoBusy, onOpen: () => void openDemo(), onList: showTryList, realWorkspaceId: workspaces.find((w) => !isSandbox(w))?.id }
                : undefined
            }
            email={ME.email}
            settings={settings}
            update={updateSettings}
            section={settingsSection}
            onSection={setSettingsSection}
            usage={usage}
            onMenu={() => setSidebarOpen(true)}
            workspace={ws}
            onWorkspace={(p) => patchWorkspace(ws.id, p)}
            onHolidays={(country) => {
              patchWorkspace(ws.id, { holidays: country ? { country } : undefined });
              if (!real) demoHolidays(country);
            }}
            holidayCal={extCals.find((c) => c.id === holidayCalendarId(ws.id))}
            onAddAccount={() => setNewAcct(true)}
            users={allUsers}
            me={user.id}
            onPhoto={(photo) => onUpdateUser({ photo })}
            onPreviewOnboarding={() => setPreviewOnboarding(true)}
            myApps={{ hidden: myHidden, asked: askedApps, onHidden: setMyHidden, onAsk: askForApp }}
            myRole={role}
            onInvite={() => openInvite()}
            onRole={(uid2, r) => patchWorkspace(ws.id, { members: ws.members.map((m) => (m.userId === uid2 ? { ...m, role: r } : m)) })}
            onRemoveMember={(uid2) => {
              patchWorkspace(ws.id, {
                members: ws.members.filter((m) => m.userId !== uid2),
                accounts: ws.accounts.map((a) => ({ ...a, users: a.users.filter((x) => x !== uid2) })),
              });
              showToast({ text: 'Removed from the workspace' });
            }}
            blocked={blocked}
            onUnblock={(id) => {
              setBlocked((b) => b.filter((x) => x.id !== id));
              showToast({ text: 'Unblocked. Their email will arrive again' });
            }}
            onAccess={(accountId, users) => {
              const before = ws.accounts.find((x) => x.id === accountId)?.users ?? [];
              patchWorkspace(ws.id, { accounts: ws.accounts.map((x) => (x.id === accountId ? { ...x, users } : x)) });
              const added = users.find((x) => !before.includes(x));
              const name = (id: string) => allUsers.find((u) => u.id === id)?.name.split(' ')[0] ?? 'They';
              showToast({ text: added ? `${name(added)} can now open this inbox` : `${name(before.find((x) => !users.includes(x))!)} no longer has access` });
            }}
            admin={{
              people: members.length,
              teams: wsTeams,
              projects: wsClientsAll.map((c) => ({ id: c.id, name: c.name, color: c.color })),
              drive: drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id),
              byChannel: channels
                .filter((c) => c.workspaceId === ws.id && c.kind === 'channel')
                .map((c) => ({ name: c.name, size: messages.filter((m) => m.channelId === c.id).flatMap((m) => m.files ?? []).reduce((s2, f) => s2 + f.size, 0) }))
                .filter((c) => c.size > 0)
                .sort((a, b) => b.size - a.size),
              onTeams: saveTeams,
              onOpenTeams: (id?: string) => (setTeamId(id ?? null), go('teams')),
              onTeamHome: (teamId, t) => patchWorkspace(ws.id, { teamHome: { ...(ws.teamHome ?? {}), [teamId]: t } }),
              onAI: (ai) => patchWorkspace(ws.id, { ai }),
              onPlan: (plan) => patchWorkspace(ws.id, { plan }),
              onMeetings: (m) => patchWorkspace(ws.id, { meetings: m }),
              onStorage: (st) => patchWorkspace(ws.id, { storage: st }),
              onExport: exportEverything,
              onDelete: () => {
                const rest = workspaces.filter((w) => w.id !== ws.id);
                setWorkspaces((list) => list.filter((w) => w.id !== ws.id));
                if (rest[0]) setWsId(rest[0].id);
                go('home');
                showToast({ text: `${ws.name} deleted` });
              },
              toast: (text) => showToast({ text }),
              tasks: allWsTasks,
              onMoveTasks: (moves) => {
                const by = new Map(moves.map((m) => [m.id, m.patch]));
                setTodos((ts) => ts.map((t) => (by.has(t.id) ? { ...t, ...by.get(t.id) } : t)));
                if (moves.length) showToast({ text: `Moved ${moves.length} task${moves.length === 1 ? '' : 's'}` });
              },
            }}
            onRemoveAccount={(id) => setRemoveAcct(ws.accounts.find((a) => a.id === id) ?? null)}
            mailExtras={
              <OutOfOffice
                accounts={myAccounts.filter((a) => !a.temp)}
                canSend={(id) => (boxReady(id).send ? null : (boxReady(id).sendWhy ?? boxReady(id).why ?? 'Sending isn’t set up for this mailbox yet.'))}
                onSave={async (a, away) => {
                  if (!real) {
                    patchWorkspace(ws.id, { accounts: ws.accounts.map((x) => (x.id === a.id ? { ...x, away: { ...away, since: away.on ? nowIso() : undefined } } : x)) });
                    return null;
                  }
                  const r = await fetch('/api/mail/away', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, accountId: a.id, away }) }).catch(() => null);
                  return r?.ok ? null : (((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? 'No connection. Try again.');
                }}
              />
            }
          />
          </PushedSettings>
        )}
      </main>

      {/* Phones: the bottom bar with the app's create button, More, and the sheets they open (src/mobile/) */}
      {mobile && (
        <BottomBar
          apps={tabApps.map((id) => {
            const a = APPS.find((x) => x.id === id)!;
            return { id, name: a.name, icon: a.icon, badge: barBadge(id) };
          })}
          current={moreOpen ? '' : mode}
          moreOn={moreOpen || !tabApps.includes(mode as AppId)}
          onApp={(id) => go(id as AppId)}
          onMore={() => (setEditingBar(false), setMoreOpen((o) => !o))}
          onEdit={() => (setEditingBar(true), setMoreOpen(true))}
          create={mode === 'settings' ? null : chrome.create}
        />
      )}
      {moreOpen && (
        <MoreSheet
          onClose={() => (setMoreOpen(false), setEditingBar(false))}
          onSearch={() => (setMoreOpen(false), openSearch(null))}
          make={makeLinks}
          apps={moreApps}
          onApp={(id) => go(id as AppId)}
          current={mode}
          recent={recentLinks}
          onAsk={toggleAsk}
          onAccount={() => go('settings')}
          editing={editingBar}
          onEditing={setEditingBar}
          edit={{
            apps: enabledForBar,
            bar: tabApps,
            onChange: setTabApps,
            reset: ownBarOn ? { label: teamBar ? 'Use the company’s bar' : 'Back to the usual bar', run: () => (setSavedBar(DEFAULT_BAR), setOwnBar(false)) } : undefined,
          }}
        />
      )}
      {noticesOpen && mobile && (
        <Sheet onClose={() => setNoticesOpen(false)} label="Notifications" className="notices-sheet" size="tall">
          <Notifications notices={myNotices} onOpen={openNotice} onReadAll={() => setNotices((ns) => ns.map((n) => (n.userId === user.id && n.workspaceId === ws.id ? { ...n, read: true } : n)))} onClose={() => setNoticesOpen(false)} />
        </Sheet>
      )}
      {newMessage && <NewMessageSheet users={members} me={user.id} onPick={(id) => openChannel(dmWith(id))} onNewChannel={canStartChannels ? () => setChanDialog({}) : undefined} onClose={() => setNewMessage(false)} />}
      {ownSettings && (
        <PushScreen title={ownSettings.label} onBack={() => setPushed(null)}>
          {ownSettings.render()}
        </PushScreen>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = '';
        }}
      />

      {compose && (
        <Compose
          key={compose.key}
          contacts={contacts}
          signature={settings.signature}
          trackByDefault={settings.trackByDefault}
          canTrack={ws.readTracking !== false}
          accounts={sendable.length ? sendable : myAccounts}
          defaultFrom={activeAccount !== 'all' && sendable.some((a) => a.id === activeAccount) ? activeAccount : (sendable[0] ?? myAccounts[0])?.id}
          initial={compose.initial}
          onSend={send}
          onClose={closeCompose}
        />
      )}
      {previewOnboarding && <Onboarding preview me={user} existingEmails={[]} onCreate={() => {}} onClose={() => (setPreviewOnboarding(false), new URLSearchParams(location.search).has('preview') && history.replaceState(null, '', location.pathname))} />}
      {tempDialog && (
        <TempAddressDialog
          ws={ws}
          me={user.id}
          people={members}
          editing={tempDialog.editing}
          onClose={() => setTempDialog(null)}
          onSave={(a) => {
            const editing = !!tempDialog.editing;
            withAccounts(ws.id, (l) => (editing ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a]));
            setTempDialog(null);
            if (editing) return showToast({ text: 'Saved' });
            setActiveAccount(a.id);
            setView({ kind: 'folder', id: 'inbox' });
            go('mail');
            showToast({ text: `${a.email} is ready`, action: { label: 'Copy', run: () => void navigator.clipboard?.writeText(a.email) } });
          }}
        />
      )}
      {tempMenu && (
        <Popover anchor={tempAnchor} open onClose={() => setTempMenu(null)} width={250} title={tempMenu.email}>
          <div className="sel-pop temp-pop">
            <button className="am-item" onClick={() => (void navigator.clipboard?.writeText(tempMenu.email), setTempMenu(null), showToast({ text: 'Address copied' }))}>
              <Copy size={15} /> Copy address
            </button>
            <button className="am-item" onClick={() => (setTempDialog({ editing: tempMenu }), setTempMenu(null))}>
              <Timer size={15} /> Who can see it, how long
            </button>
            <button className="am-item" onClick={() => (testTemp(tempMenu), setTempMenu(null))}>
              <Send size={15} /> Send a test email
            </button>
            <div className="am-sep" />
            <button className="am-item danger" onClick={() => (deleteTemp(tempMenu), setTempMenu(null))}>
              <Trash2 size={15} /> Delete now
            </button>
          </div>
        </Popover>
      )}
      {resettingDemo && inSandbox && <ResetDemoDialog onReset={resetDemo} onClose={() => setResettingDemo(false)} />}
      {newWs && (
        <Onboarding
          me={user}
          existingEmails={allUsers.map((u) => u.email.toLowerCase())}
          onClose={() => setNewWs(false)}
          onCreate={(w, newUsers) => {
            newUsers.forEach(onInvite);
            setWorkspaces((list) => [...list, w]);
            // Starter tables for what the company does, so Tables isn't empty on day one.
            const starters: Record<string, { name: string; template: TemplateId }[]> = {
              agency: [{ name: 'Leads', template: 'leads' }, { name: 'Content pipeline', template: 'pipeline' }],
              ecommerce: [{ name: 'Customers', template: 'leads' }, { name: 'Product launches', template: 'pipeline' }],
              consulting: [{ name: 'Prospects', template: 'leads' }, { name: 'Engagements', template: 'tracker' }],
              software: [{ name: 'Roadmap', template: 'pipeline' }, { name: 'Bugs', template: 'tracker' }],
              events: [{ name: 'Sponsors', template: 'leads' }, { name: 'Vendors', template: 'tracker' }],
            };
            const made = (starters[w.industry ?? ''] ?? []).map((d) => makeTable(d, w.id, user.id));
            if (made.length) setTables((ts) => [...ts, ...made]);
            // Every company starts with a #general channel for the whole team.
            setChannels((cs) => [...cs, { id: uid(), workspaceId: w.id, kind: 'channel', name: 'general', members: w.members.map((m) => m.userId), topic: 'Everyone at ' + w.name }]);
            setNewWs(false);
            setWsId(w.id);
            setActiveAccount('all');
            setSelectedId(null);
            setView({ kind: 'folder', id: 'inbox' });
            go('home');
            showToast({ text: `${w.name} is ready${newUsers.length ? `, ${newUsers.length} invite${newUsers.length > 1 ? 's' : ''} sent` : ''}` });
          }}
        />
      )}
      {newAcct && (
        <NewAccount
          workspace={ws}
          userId={user.id}
          onClose={() => setNewAcct(false)}
          onAdd={(a) => {
            patchWorkspace(ws.id, { accounts: [...ws.accounts, a] });
            setNewAcct(false);
            showToast({ text: `${a.email} added` });
          }}
        />
      )}
      {inviting && (
        <InviteMember
          workspace={ws}
          users={allUsers}
          onClose={() => setInviting(false)}
          onInvite={(u, r, box, shared) => {
            onInvite(u);
            patchWorkspace(ws.id, {
              members: [...ws.members, { userId: u.id, role: r }],
              accounts: [...ws.accounts.map((a) => (shared.includes(a.id) ? { ...a, users: [...a.users, u.id] } : a)), ...(box ? [box] : [])],
            });
            setInviting(false);
            showToast({ text: `Invited ${u.name}. They can sign in as ${u.email}` });
          }}
        />
      )}
      {newEventAt && <EventEditor start={newEventAt} calendars={[...CALENDARS, ...myExtCals.filter((c) => !c.readOnly)]} onSave={saveEvent} onClose={() => setNewEventAt(null)} />}
      {connectCal && (
        <ConnectCalendar
          me={{ id: user.id, email: user.email }}
          existing={myExtCals}
          workspace={ws}
          isAdmin={isAdmin}
          live={real}
          demo={demoOk}
          google={caps.googleCalendar}
          microsoft={caps.microsoftCalendar}
          start={connectCal === 'holidays' ? 'holidays' : undefined}
          onClose={() => setConnectCal(false)}
          onConnect={(cals) => {
            setExtCals((cs) => [...cs, ...cals]);
            setEvents((es) => [...es, ...cals.flatMap(externalEvents)]);
            setConnectCal(false);
            showToast({ text: `${cals.length > 1 ? `${cals.length} calendars` : cals[0].name} connected` });
          }}
          onLinked={(cal, upcoming) => {
            setConnectCal(false);
            setHiddenCals((h) => (h.has(cal.id) ? new Set([...h].filter((x) => x !== cal.id)) : h));
            showToast({ text: upcoming ? `${cal.name} added. It updates every 30 minutes.` : `${cal.name} added, but it has nothing in the coming year. Check it’s the right calendar.`, ms: upcoming ? undefined : 9000 });
          }}
          onHolidays={(country) => {
            const before = ws.holidays;
            patchWorkspace(ws.id, { holidays: country ? { country } : undefined });
            if (!real) demoHolidays(country);
            setConnectCal(false);
            showToast({ text: country ? `Holidays in ${holidayCountry(country)?.name ?? country} now show for everyone at ${ws.name}` : 'Public holidays removed for everyone', action: { label: 'Undo', run: () => (patchWorkspace(ws.id, { holidays: before }), !real && demoHolidays(before?.country ?? null)) } });
          }}
        />
      )}
      {preview && (
        <DrivePreview
          item={allDrive.find((i) => i.id === preview.item.id) ?? preview.item}
          list={preview.list}
          onNav={(item) => setPreview((p) => p && { ...p, item })}
          onClose={() => setPreview(null)}
          onStar={(id) => patchDrive(id, { starred: !drive.find((i) => i.id === id)?.starred })}
          onTrash={trashDrive}
          onOpenThread={openThread}
        />
      )}

      {taskOpen && wsTasks.some((t) => t.id === taskOpen) && (
        <TaskDrawer
          task={wsTasks.find((t) => t.id === taskOpen)!}
          tasks={wsTasks}
          clients={wsClientsAll}
          teams={wsTeams}
          users={members}
          me={user.id}
          onClose={() => setTaskOpen(null)}
          onOpen={setTaskOpen}
          onPatch={patchTask}
          onStatus={setTaskStatus}
          onDelete={deleteTodo}
          onToCalendar={todoToCalendar}
          onAddSubtask={(briefId, t) => {
            const br = wsTasks.find((x) => x.id === briefId);
            createTask({ ...t, briefId, clientId: br?.clientId, source: 'manual' }, { chat: true });
          }}
          onOpenThread={(id) => (setTaskOpen(null), openThread(id))}
          onAskApproval={askApproval}
          onComment={commentTask}
          clientNames={(() => {
            const c = wsClients.find((x) => x.id === wsTasks.find((t) => t.id === taskOpen)?.clientId);
            return c ? Object.fromEntries(clientPeople(c, channels).map((x) => [x.email.toLowerCase(), x.name])) : {};
          })()}
          onSendBack={sendBack}
          onSaveTemplate={saveTemplate}
          onDuplicate={(t) => {
            const copy = createTask({ ...duplicateOf(t), source: 'manual' });
            showToast({ text: `Duplicated “${t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title}”`, action: { label: 'Open', run: () => setTaskOpen(copy.id) } });
          }}
          onOpenChannel={(clientId) => {
            const ch = channels.find((c) => c.workspaceId === ws.id && c.clientId === clientId && c.category !== 'shared') ?? channels.find((c) => c.workspaceId === ws.id && c.clientId === clientId);
            if (ch) (setTaskOpen(null), openChannel(ch.id));
            else showToast({ text: `This ${term.one} has no channel yet` });
          }}
        />
      )}
      {sendBotOpen && (
        <SendBotDialog
          clients={wsClients}
          botName={meetSettings.botName}
          languages={meetSettings.languages}
          real={recorderOn && real}
          workspaceId={ws.id}
          isOwner={ws.members.some((m) => m.userId === user.id && m.role === 'owner')}
          seed={sendBotSeed ?? undefined}
          onSend={(d) => sendBot({ ...d, ...(sendBotSeed ? { fromEvent: sendBotSeed.fromEvent, attendees: sendBotSeed.attendees } : {}) })}
          onClose={() => setSendBotOpen(false)}
        />
      )}
      {removeAcct && (
        <RemoveMailbox
          account={removeAcct}
          workspace={ws}
          conversations={removeAcct.users.includes(user.id) ? threads.filter((t) => t.accountId === removeAcct.id).length : null}
          onRemove={(moveTo) => removeMailbox(removeAcct, moveTo)}
          onClose={() => setRemoveAcct(null)}
        />
      )}
      {shareFor && meetings.some((m) => m.id === shareFor) && (
        <ShareDialog
          m={meetings.find((m) => m.id === shareFor)!}
          toast={(text) => showToast({ text })}
          onClose={() => setShareFor(null)}
          onPreview={() => setSharedPreview(shareFor)}
          onOff={() => (patchMeeting(shareFor, { share: undefined }), showToast({ text: 'Link turned off' }))}
          onSave={(opts) => {
            const m = meetings.find((x) => x.id === shareFor)!;
            patchMeeting(shareFor, { share: { token: m.share?.token ?? Math.random().toString(36).slice(2, 10), ...opts } });
            showToast({ text: 'Link ready' });
          }}
        />
      )}
      {sharedPreview && meetings.some((m) => m.id === sharedPreview) && (
        <SharedPage m={meetings.find((m) => m.id === sharedPreview)!} brand={ws.name} tasks={wsTasks.filter((t) => t.meetingId === sharedPreview)} users={members} onClose={() => setSharedPreview(null)} />
      )}
      {huddleChannel?.huddle?.members.includes(user.id) && <Huddle key={huddleChannel.id} channel={huddleChannel} users={allUsers} me={user.id} onLeave={leaveHuddle} />}
      {askScope && (
        <Assistant
          scope={askScope}
          setScope={setAskScope}
          scopeOptions={askOptions}
          chats={askChats}
          setChats={setAskChats}
          ask={askAnything}
          seed={askSeed}
          live={aiLive()}
          citeLabel={(k, id) =>
            k === 'M' ? (meetings.find((m) => m.id === id)?.title ?? 'meeting') : k === 'E' ? (threads.find((t) => t.id === id)?.subject ?? 'email') : k === 'C' ? `#${channels.find((c) => c.id === id)?.name ?? 'channel'}` : 'Tasks'
          }
          onCite={(k, id, at) => {
            if (k === 'M') (setMeetPage({ kind: 'meeting', id }), go('meet'));
            else if (k === 'E') openThread(id);
            else if (k === 'C') openChannel(id);
            else openTasks(id === 'all' ? { kind: 'mine' } : { kind: 'client', id });
            void at;
            if (mobile) setAskScope(null);
          }}
          onClose={() => setAskScope(null)}
        />
      )}
      {chanDialog && (
        <ChannelDialog
          channel={chanDialog.id ? channels.find((c) => c.id === chanDialog.id) : undefined}
          users={members}
          clients={wsClients}
          teams={wsTeams}
          me={user.id}
          canManage={myRole !== 'member' || !chanDialog.id || channels.find((c) => c.id === chanDialog.id)?.ownerId === user.id}
          summaryCost={summaryCost}
          guestsAllowed={ws.plan?.tier !== 'free' || channels.filter((c) => c.workspaceId === ws.id).flatMap((c) => c.guests ?? []).length < 1}
          onClose={() => setChanDialog(null)}
          onArchive={() => {
            const id = chanDialog.id!;
            setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, archived: true } : c)));
            setChanDialog(null);
            setChatId(null);
            showToast({ text: 'Channel archived', action: { label: 'Undo', run: () => setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, archived: false } : c))) } });
          }}
          onSave={(d) => {
            if (chanDialog.id) {
              const before = channels.find((c) => c.id === chanDialog.id);
              setChannels((cs) => cs.map((c) => (c.id === chanDialog.id ? { ...c, ...d } : c)));
              const added = d.members.filter((m) => !before?.members.includes(m));
              added.forEach((m) => notify(m, 'mention', `${myFirst} added you to #${d.name}`, { app: 'chat', id: chanDialog.id }));
              const newGuests = (d.guests ?? []).filter((g) => !before?.guests?.some((x) => x.email === g.email));
              showToast({ text: newGuests.length ? `Saved. Invite sent to ${newGuests.map((g) => g.name).join(', ')}` : 'Channel saved' });
            } else {
              const id = uid();
              setChannels((cs) => [...cs, { ...d, id, workspaceId: ws.id, kind: 'channel' }]);
              d.members.forEach((m) => notify(m, 'mention', `${myFirst} added you to #${d.name}`, { app: 'chat', id }));
              setMessages((ms) => [...ms, { id: uid(), channelId: id, userId: user.id, text: `created #${d.name}${d.topic ? `: ${d.topic}` : ''}`, at: nowIso(), kind: 'system' }]);
              setChatId(id);
              go('chat');
              showToast({ text: `#${d.name} created${d.guests?.length ? `, invite sent to ${d.guests.length} guest${d.guests.length > 1 ? 's' : ''}` : ''}` });
            }
            setChanDialog(null);
          }}
        />
      )}
      {ending && wsClientsAll.some((c) => c.id === ending) && (
        <EndClientDialog
          client={wsClientsAll.find((c) => c.id === ending)!}
          openTasks={wsTasks.filter((t) => t.clientId === ending && !t.done).length}
          channels={channels.filter((c) => c.clientId === ending && !c.archived).length}
          people={clientPeople(wsClientsAll.find((c) => c.id === ending)!, channels).length}
          onEnd={(o) => endClient(ending, o)}
          onClose={() => setEnding(null)}
        />
      )}
      {tplOpen && (
        <TemplateDialog
          templates={[...savedTemplates.filter((t) => t.workspaceId === ws.id), ...templatesFor(ws.industry)]}
          clients={wsClients}
          users={members}
          me={user.id}
          clientId={tplOpen.clientId}
          onCreate={fromTemplate}
          onDelete={(id) => setSavedTemplates((ts) => ts.filter((t) => t.id !== id))}
          onClose={() => setTplOpen(null)}
        />
      )}
      {dump !== null && (
        <BrainDump
          language={meetSettings.languages?.[0]}
          users={members}
          clients={wsClients}
          teams={wsTeams}
          me={user.id}
          aliases={ws.aliases ?? {}}
          initialText={dump}
          onCreate={createFromDump}
          onInvite={inviteByName}
          onClose={() => setDump(null)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          scope={searchScope}
          recentKey={`s2g-palette-recent:${user.id}:${ws.id}`}
          queryActions={(q) => [
            { id: 'q-task', group: 'Do with “' + (q.length > 40 ? q.slice(0, 40) + '…' : q) + '”', title: `Create task “${q}”`, sub: 'Assigned to you', icon: ListChecks, run: () => { const t = createTask({ title: q.charAt(0).toUpperCase() + q.slice(1), userId: user.id, source: 'manual' }); showToast({ text: 'Task created', action: { label: 'Open', run: () => openTask(t.id) } }); } },
            { id: 'q-project', group: 'Do with “' + (q.length > 40 ? q.slice(0, 40) + '…' : q) + '”', title: `New ${term.one} “${q}”`, sub: `Opens its page: tasks, chat, files, logins…`, icon: Briefcase, run: () => { const c = createProject(q.charAt(0).toUpperCase() + q.slice(1)); openClient(c.id); } },
            { id: 'q-note', group: 'Do with “' + (q.length > 40 ? q.slice(0, 40) + '…' : q) + '”', title: `New note “${q}”`, sub: 'Only you can see it until you share it', icon: FileText, run: () => newNote(q.charAt(0).toUpperCase() + q.slice(1)) },
            { id: 'q-ask', group: 'Do with “' + (q.length > 40 ? q.slice(0, 40) + '…' : q) + '”', title: `Ask AI: “${q}”`, sub: 'Answers from your mail, chat, meetings and tasks', icon: Sparkles, run: () => { setAskSeed(q); setAskScope({ kind: 'all' }); } },
          ]}
          onClose={() => (setPaletteOpen(false), setSearchScope(null))}
        />
      )}

      {blockTarget && incomingFrom(blockTarget) && (
        <BlockDialog
          sender={incomingFrom(blockTarget)!}
          count={wsThreads.filter((t) => t.location !== 'trash' && incomingFrom(t)?.email === incomingFrom(blockTarget)!.email).length}
          domainCount={wsThreads.filter((t) => t.location !== 'trash' && domainOf(incomingFrom(t)?.email ?? '') === domainOf(incomingFrom(blockTarget)!.email)).length}
          onBlock={blockSender}
          onClose={() => setBlockTarget(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label === 'Undo' && <Undo2 size={14} />} {toast.action.label}
            </button>
          )}
          {toast.also && (
            <button
              onClick={() => {
                toast.also!.run();
                setToast(null);
              }}
            >
              {toast.also.label}
            </button>
          )}
        </div>
      )}
    </div>
    </ProjectsCtx.Provider>
    </TabDefaultsCtx.Provider>
  );
}
