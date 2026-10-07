import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { term, setTermWord } from './terms';
import { setPhotos } from './photos';
import { SmoothHeight, TabPane } from './components/ui/Smooth';
import { Brain, Building2, CalendarPlus, FileText, Hash, ListChecks, Mail, Menu as MenuIcon, PenLine, Plus, Sparkles, Undo2, Upload, User as UserIcon, Video } from 'lucide-react';
import type { Note, Account, AppId, Attachment, BlockRule, CalEvent, Channel, ChannelCategory, Client, ClientPerson, ChatFile, ChatMessage, Meeting, Notice, TaskEvent, TaskStatus, Todo, DriveItem, DriveSection, FolderId, Location, Person, Thread, User, View, Workspace } from './types';
import { LABELS } from './data/mock';
import { CALENDARS, externalEvents } from './data/calendar';
import { JOBS, costPer100 } from './data/aiCatalog';
import { rp } from './data/pricing';
import { ConnectCalendar } from './components/ConnectCalendar';
import { MAIL_USAGE, QUOTA, fmtSize, kindOf, parseSize } from './data/drive';
import { fmtTime } from './calendarUtils';
import { lastMessage, uid, localDay, nextDue, addWorkdays } from './utils';
import { BUILT_IN_TEMPLATES, type TaskTemplate } from './data/templates';
import { TemplateDialog } from './components/TemplateDialog';
import { EndClientDialog } from './components/EndClientDialog';
import { NoteEditor, NotesList, type NotesFilter } from './components/NotesApp';
import { VaultSidebar, VaultView, type VaultItem } from './components/VaultApp';
import { eventsOn } from './calendarUtils';
import { useSettings, usePersisted } from './settings';
import { DEFAULT_TRACK_OPTIONS, isTeam } from './tracking';
import { isMine, setIdentity } from './identity';
import { scanned, useStored } from './store';
import { server } from './sync';
import { ai, aiLive } from './ai';
import { Assistant, type AskChat } from './components/Assistant';
import { BlockDialog } from './components/BlockDialog';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { InviteMember, NewAccount } from './components/WorkspaceForms';
import { applyBranding } from './components/WorkspaceLogo';
import { TrackingDashboard } from './components/TrackingDashboard';
import { Sidebar, SIDEBAR_MAX, SIDEBAR_MIN, type Mode } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { Reader } from './components/Reader';
import { Compose, type Outgoing } from './components/Compose';
import { CalendarView, type CalView } from './components/CalendarView';
import { CalendarSidebar } from './components/CalendarSidebar';
import { EventEditor } from './components/EventEditor';
import { AccountMenu, type SettingsSection } from './components/AccountMenu';
import { SettingsPage } from './components/SettingsPage';
import { DriveSidebar } from './components/DriveSidebar';
import { DriveView } from './components/DriveView';
import { DrivePreview } from './components/DrivePreview';
import { AppRail, APPS } from './components/AppRail';
import { Avatar } from './components/Avatar';
import { Notifications } from './components/Notifications';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { HomeView } from './components/HomeView';
import { TaskDrawer } from './components/TaskDrawer';
import { TasksView, dueLabel, isBrief, type TaskScope } from './components/TasksView';
import { TasksSidebar } from './components/TasksSidebar';
import { BrainDump, type DumpResult } from './components/BrainDump';
import { ChatSidebar, ChatView, fullLayout, sectionIdOf, sectionPeople, type Presence, type SendPayload } from './components/ChatApp';
import { ChannelDialog, CATEGORY_ONE } from './components/ChannelDialog';
import { MobileTop } from './components/MobileTop';
import { ClientApp } from './components/ClientApp';
import { clientActions } from './clientActions';
import { accessFor, afterEnd, clientInbox, clientPeople, portalsFor, requestStatus, teamLabel } from './clientView';
import { celebrate } from './components/ui/confetti';
import { MeetSidebar, MeetView, SendBotDialog, ShareDialog, SharedPage, type AskScope, type MeetPage } from './components/MeetApp';
import { DEFAULT_MEETINGS } from './data/workspaces';
import { DEMO_SCRIPT } from './data/team';
import { Onboarding } from './components/Onboarding';
import { textToHtml } from './sanitize';

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
  const raw = hashRouting ? location.hash.replace(/^#\/?/, '') : location.pathname.replace(/^\//, '');
  const first = raw.split('/')[0];
  return APP_IDS.includes(first) ? (first as AppId) : first === 'settings' ? 'settings' : 'home';
}
function writeRoute(m: Mode) {
  try {
    if (hashRouting) {
      if (location.hash !== `#/${m}`) history.replaceState(null, '', `#/${m}`);
    } else if (location.pathname !== `/${m}`) history.pushState(null, '', `/${m}`);
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

function useMedia(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    window.addEventListener('resize', on);
    return () => {
      mq.removeEventListener('change', on);
      window.removeEventListener('resize', on);
    };
  }, [query]);
  return match;
}

type Toast = { id: number; text: string; action?: { label: string; run: () => void }; ms?: number };
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
}

export default function App({ user, signedInUsers, allUsers, workspaces: allWorkspaces, setWorkspaces, onSwitchUser, onAddUser, onSignOut, onInvite: inviteUser, onWorkspace, onUpdateUser }: AppProps) {
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
  const [wsId, setWsId] = usePersisted(`pm-ws:${user.id}`, workspaces[0]?.id ?? '');
  const ws = workspaces.find((w) => w.id === wsId) ?? workspaces[0];
  setTermWord(ws?.terms?.word); // "Projects" or "Clients", before anything below renders words
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
  const [activeAccount, setActiveAccount] = useState<string>('all');
  const [newWs, setNewWs] = useState(false);
  const [newAcct, setNewAcct] = useState(false);
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
  const mobile = useMedia('(max-width: 760px)');

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
  const [collapsed, setCollapsed] = usePersisted('pm-sidebar-collapsed', false);
  const [sidebarW, setSidebarW] = usePersisted('pm-sidebar-w', 248);
  const [listW, setListW] = usePersisted('pm-list-w', 400);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = (t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() });

  // Mail
  const [threads, setThreads] = useStored('threads');
  // Threads in mailboxes this user can open in this workspace, narrowed to one inbox when picked.
  const wsThreads = useMemo(() => threads.filter((t) => myAccounts.some((a) => a.id === t.accountId)), [threads, myAccounts]);
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
  const latest = useRef({ threads, notifyOpens: settings.notifyOpens });
  latest.current = { threads, notifyOpens: settings.notifyOpens };

  // Calendar
  const [events, setEvents] = useStored('events');
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const [extCals, setExtCals] = useStored('calendars');
  const [shownMates, setShownMates] = useState<Set<string>>(new Set());
  const [connectCal, setConnectCal] = useState(false);
  const [calCursor, setCalCursor] = useState(new Date());
  const [calView, setCalView] = useState<CalView>(() => (matchMedia('(max-width: 760px)').matches ? 'day' : 'week'));
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
  const [messages, setMessages] = useStored('messages');
  const [notices, setNotices] = useStored('notices');
  const [meetings, setMeetings] = useStored('meetings');
  const [taskScope, setTaskScope] = useState<TaskScope>({ kind: 'mine' });
  const [taskOpen, setTaskOpen] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<'overview' | 'tasks' | 'chat' | 'emails' | 'meetings' | 'files' | 'portal' | undefined>(undefined);
  const [teams, setTeams] = useStored('teams');
  const [statuses, setStatuses] = useStored('statuses');
  const [savedTemplates, setSavedTemplates] = useStored('templates');
  const [tplOpen, setTplOpen] = useState<{ clientId?: string } | null>(null);
  const [chanDialog, setChanDialog] = useState<{ id?: string } | null>(null);
  const [notes, setNotes] = useStored('notes');
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
  const [meetPage, setMeetPage] = useState<MeetPage>({ kind: 'list' });
  const [sendBotOpen, setSendBotOpen] = useState(false);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [sharedPreview, setSharedPreview] = useState<string | null>(null);
  const [askScope, setAskScope] = useState<AskScope | null>(null);
  const [tabApps, setTabApps] = usePersisted<AppId[]>(`s2g-tabbar:${user.id}`, ['home', 'mail', 'chat', 'tasks']);
  const [editingBar, setEditingBar] = useState(false);
  const [askChats, setAskChats] = usePersisted<AskChat[]>(`s2g-ask-chats:${user.id}`, []);
  const [joinOverrides, setJoinOverrides] = usePersisted<Record<string, boolean>>(`s2g-join:${user.id}`, {});
  const [sentEvents, setSentEvents] = useState<Record<string, string>>({});
  const botTimers = useRef<Record<string, number[]>>({});
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

  const go = (m: Mode) => {
    if (m !== 'settings') setLastMode(m);
    setMode(m);
    setSidebarOpen(false);
    setAccountOpen(false);
    setNoticesOpen(false);
    setMoreOpen(false);
  };

  /* ---------------- Mail ---------------- */

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

  const contacts = useMemo(() => {
    const map = new Map<string, Person>();
    for (const t of wsThreads) for (const m of t.messages) for (const p of [m.from, ...m.to]) map.set(p.email, p);
    for (const e of events) for (const g of e.guests ?? []) map.set(g.email, g);
    for (const e of [...map.keys()]) if (isMine(e)) map.delete(e);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [wsThreads, events]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  const update = (id: string, patch: Partial<Thread>) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const openCompose = (init?: Omit<ComposeState, 'key'>) => {
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

  const reply = (id: string, html: string, text: string) => {
    setThreads((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        const last = lastMessage(t);
        const to = isMine(last.from.email) ? last.to : [last.from];
        const from = senderFor(accountOf(t.accountId));
        return { ...t, messages: [...t.messages, { id: uid(), from, to, date: new Date().toISOString(), body: text, html }] };
      }),
    );
    showToast({ text: 'Reply sent' });
  };

  const toThread = (m: Outgoing, location: Location, id = uid()): Thread => ({
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
        trackOptions: m.track && location !== 'drafts' ? m.trackOptions : undefined,
        tracking:
          m.track && location !== 'drafts'
            ? Object.fromEntries([...m.to, ...m.cc].filter((p) => !isTeam(p.email)).map((p) => [p.email, { opens: [], clicks: [] }]))
            : undefined,
      },
    ],
  });

  /** Files a sent copy and drops copies straight into any of our own recipients' inboxes. */
  const deliver = (m: Outgoing, draftId?: string) => {
    const thread = toThread(m, 'archive');
    // Mail to one of our own mailboxes arrives straight in its inbox.
    const delivered: Thread[] = [...m.to, ...m.cc]
      .map((p) => allAccounts.find((a) => a.email === p.email.toLowerCase() && a.id !== m.fromId))
      .filter((a): a is Account => !!a)
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

  const send = (m: Outgoing) => {
    if (m.sendAt) {
      // Send later: kept as a scheduled draft until its time (the server does this for real).
      const t = { ...toThread(m, 'drafts'), sendAt: m.sendAt };
      setThreads((ts) => [t, ...ts.filter((x) => x.id !== compose?.draftId)]);
      setCompose(null);
      showToast({ text: `Scheduled for ${new Date(m.sendAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, action: { label: 'Undo', run: () => setThreads((ts) => ts.filter((x) => x.id !== t.id)) } });
      return;
    }
    const { thread, delivered } = deliver(m, compose?.draftId);
    setCompose(null);
    if (thread.messages[0].tracking) simulateOpen(thread);
    showToast({
      text: 'Message sent',
      ms: settings.undoSend ? settings.undoSend * 1000 : 4000,
      action: settings.undoSend
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
      const open = { at: new Date().toISOString(), device: 'iPhone · Gmail', place: 'Jakarta, ID' };
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
        showToast({ text: `👀 ${who} just opened “${thread.subject}”`, action: { label: 'View', run: () => openThread(thread.id) } });
    }, 9000);
  };

  const closeCompose = (draft: Outgoing | null) => {
    const draftId = compose?.draftId;
    setCompose(null);
    if (!draft) return;
    const t = toThread(draft, 'drafts', draftId);
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

  // Scheduled mail goes out on time; snoozed mail comes back to the inbox (the backend does both on the server).
  useEffect(() => {
    if (server.on) return; // the local server does this for everyone
    const tick = () => {
      const now = new Date().toISOString();
      setThreads((ts) =>
        ts.map((t) => {
          if (t.sendAt && t.sendAt <= now) return { ...t, sendAt: undefined, location: 'archive', messages: t.messages.map((m) => ({ ...m, date: now })) };
          if (t.snoozedUntil && t.snoozedUntil <= now) return { ...t, snoozedUntil: undefined, unread: true };
          return t;
        }),
      );
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Task reminders: ping everyone doing the task when its time comes (the backend sends these as push and email too).
  useEffect(() => {
    if (server.on) return; // the local server does this for everyone
    const tick = () => {
      const now = new Date().toISOString();
      const due = todosRef.current.filter((t) => t.remindAt && !t.reminded && !t.done && t.remindAt <= now);
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
        const have = new Set(todosRef.current.filter((x) => x.userId === user.id && x.threadId === t.id).map((x) => x.title.toLowerCase()));
        const next = found
          .filter((f) => !have.has(f.title.toLowerCase()))
          .map<Todo>((f) => ({ id: uid(), title: f.title, due: f.due ?? undefined, priority: f.priority, done: false, status: 'todo', threadId: t.id, source: 'ai', userId: user.id, createdBy: user.id, workspaceId: ws.id, clientId: clientForThread(t)?.id, createdAt: new Date().toISOString() }));
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

  const toggleTodo = (id: string) => {
    const t = todos.find((x) => x.id === id);
    if (t) setTaskStatus(id, t.done ? 'todo' : 'done');
  };
  const deleteTodo = (id: string) => {
    const snapshot = todos;
    setTodos((list) => list.filter((t) => t.id !== id));
    showToast({ text: 'To-do deleted', action: { label: 'Undo', run: () => setTodos(snapshot) } });
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
    setUnsubscribed((u) => ({ ...u, [domainOf(from.email)]: at }));
    // Real version: one-click senders get an automatic POST (RFC 8058); others open their page.
    showToast({ text: `Unsubscribed from ${from.name}${m.listUnsubscribe!.oneClick ? '' : ', request sent'}` });

    // DEMO ONLY: senders without one-click unsubscribe often keep mailing. Simulate that,
    // so the "still sending → Block" flow can be tried.
    if (!m.listUnsubscribe!.oneClick)
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

  const enabledApps: AppId[] = ws.apps ?? APPS.map((a) => a.id);
  const enabled = new Set<string>(enabledApps);
  useEffect(() => {
    if (mode !== 'settings' && !enabled.has(mode)) setMode('home');
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = useMemo(() => ws.members.map((m) => allUsers.find((u) => u.id === m.userId)).filter(Boolean) as User[], [ws.members, allUsers]);
  // Every client, including past ones (client pages, search, history) …
  const wsClientsAll = useMemo(() => clients.filter((c) => c.workspaceId === ws.id), [clients, ws.id]);
  // … and the ones you work with now (pickers, sidebars, Home, filing).
  const wsClients = useMemo(() => wsClientsAll.filter((c) => c.status !== 'ended'), [wsClientsAll]);
  const wsTeams = useMemo(() => teams.filter((t) => t.workspaceId === ws.id), [teams, ws.id]);
  const allWsTasks = useMemo(() => todos.filter((t) => (t.workspaceId ?? 'pnp') === ws.id), [todos, ws.id]);
  // Who sees which tasks: owners and admins see everything; everyone else sees their own work,
  // their teams' work, the clients they work on, and the channels they're in.
  const isAdmin = ws.members.some((m) => m.userId === user.id && m.role !== 'member');
  const myTeamIds = useMemo(() => teams.filter((t) => t.workspaceId === ws.id && (t.members.includes(user.id) || t.leadId === user.id)).map((t) => t.id), [teams, ws.id, user.id]);
  const myClientIds = useMemo(
    () =>
      clients
        .filter(
          (c) =>
            c.workspaceId === ws.id &&
            (c.ownerId === user.id ||
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
              (t.clientId && myClientIds.includes(t.clientId)) ||
              (t.channelId && channels.some((c) => c.id === t.channelId && c.members.includes(user.id))),
          ),
    [allWsTasks, isAdmin, user.id, myTeamIds, myClientIds, channels],
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
    const included = ws.plan?.track === 'ai' && ws.plan.tier !== 'free' && ws.ai?.payer !== 'own';
    if (ws.plan?.tier === 'free' && !ws.ai?.providers.length) return '1 of your free AI summaries this month';
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
      status: t.kind === 'brief' ? 'doing' : 'todo',
      source: t.source,
      createdBy: user.id,
      workspaceId: ws.id,
      threadId: t.threadId,
      checklist: t.checklist,
      repeat: t.repeat,
      createdAt: nowIso(),
      assignees: t.userId ? [t.userId] : [],
      supervisorId: user.id, // whoever assigns it supervises it, unless someone changes it
      history: [{ id: uid(), at: nowIso(), by: user.id, kind: 'created', text: `created this${{ ai: ' from an email', manual: '', braindump: ' from a brain dump', chat: ' from chat', meeting: ' from a meeting', request: ' from a request' }[t.source]}${t.userId && t.userId !== user.id ? ` for ${firstOf(t.userId)}` : ''}` }],
    };
    setTodos((ts) => [...ts, task]);
    // Not assigned yet: tell the team lead it's waiting in their queue.
    if (!t.userId && t.teamId) {
      const tm = wsTeams.find((x) => x.id === t.teamId);
      if (tm?.leadId && tm.leadId !== user.id) notify(tm.leadId, 'task', `New in ${tm.name}’s queue: ${describe(task)}. Pick someone for it.`, { app: 'tasks', id: task.id });
    }
    if (t.userId && t.userId !== user.id) {
      notify(t.userId, 'task', `${myFirst} assigned you ${describe(task)}`, { app: 'tasks', id: task.id });
      if (tell.chat) postChat(dmWith(t.userId), `📌 New task for you: ${describe(task)}`, task.id);
      if (tell.email)
        emailTeammate(t.userId, `New task: ${task.title}`, `Hi ${firstOf(t.userId)},\n\nI've assigned you a task: ${describe(task)}.\n\nYou'll find it in Sprint2go under Tasks.`);
    }
    return task;
  };

  function setTaskStatus(id: string, requested: TaskStatus, quiet = false) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    // The review step: when the team asks for it, finishing a task sends it to the supervisor first.
    const team = teams.find((x) => x.id === t.teamId);
    const needsReview = requested === 'done' && !!team?.review && !!t.supervisorId && t.supervisorId !== user.id && !doersOf(t).includes(t.supervisorId) && t.status !== 'review';
    const status: TaskStatus = needsReview ? 'review' : requested;
    const before = { status: t.status, done: t.done, doneAt: t.doneAt, doneBy: t.doneBy, history: t.history };
    if (status !== (t.done ? 'done' : (t.status ?? 'todo'))) {
      const text = needsReview
        ? 'finished it and sent it for review'
        : status === 'done'
          ? t.status === 'review'
            ? 'approved it'
            : 'marked it done'
          : status === 'waiting'
            ? `set it to Waiting on ${term.who}`
            : status === 'doing'
              ? 'started it'
              : t.done
                ? 'reopened it'
                : 'moved it back to To do';
      logTask(id, needsReview || t.status === 'review' ? 'review' : 'status', text);
    }
    if (needsReview) {
      setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, status: 'review', done: false } : x)));
      notify(t.supervisorId!, 'task', `${myFirst} finished ${describe(t)}. Ready for your review`, { app: 'tasks', id });
      if (!quiet) showToast({ text: `Sent to ${firstOf(t.supervisorId)} for review` });
      return;
    }
    // A repeating task: finishing it creates the next one.
    const next: Todo | undefined =
      status === 'done' && !t.done && t.repeat
        ? {
            ...t,
            id: uid(),
            status: 'todo',
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
        x.id === id ? { ...x, status, done: status === 'done', doneAt: status === 'done' ? (x.done ? x.doneAt : nowIso()) : undefined, doneBy: status === 'done' ? (x.done ? x.doneBy : user.id) : undefined } : x,
      ),
    );
    // Requests: the client sees each status change.
    if (t.requestedBy && requestStatus(t).label !== requestStatus({ ...t, status, done: status === 'done' }).label) tellClient(t, `Your request “${t.title}” is now: ${requestStatus({ ...t, status, done: status === 'done' }).label}`);
    else if (t.visibleToClient && status === 'done' && !t.done) tellClient(t, `“${t.title}” is done`);
    if (status === 'done' && !t.done) {
      const tell = new Set([t.supervisorId ?? t.createdBy, ...(t.followers ?? []), ...(t.status === 'review' ? doersOf(t) : [])].filter((x): x is string => !!x && x !== user.id));
      tell.forEach((uid2) => notify(uid2, 'done', t.status === 'review' ? `${myFirst} approved ${describe(t)}` : `${myFirst} finished ${describe(t)}`, { app: 'tasks', id: t.id }));
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
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, status: 'doing', done: false } : x)));
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
    setTaskScope(scope);
    go('tasks');
  };
  /** The client page is the hub: overview, tasks, chat, mail, meetings, files, portal. */
  const openClient = (id: string, tab?: typeof clientTab) => {
    setClientTab(tab);
    openTasks({ kind: 'client', id });
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



  const patchClient = (id: string, patch: Partial<Client>) => setClients((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  /** With the local server: a link where a client person sets their password and signs in to their portal. */
  const makeClientInvite = (clientId: string) => async (p: { name: string; email: string }) => {
    if (!server.on) return null;
    const r = await fetch('/api/client-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, clientId, ...p }) });
    if (!r.ok) return null;
      const { link } = (await r.json()) as { link: string | null };
      return link ? `${location.origin}${link}` : null; // null: they already sign in, nothing to send
  };
  /** Gives someone at a client access to their portal: added to the client's people and its shared channels. */
  const giveClientAccess = async (clientId: string, person: { name: string; email: string; role: ClientPerson['role']; company?: string }, status: ClientPerson['status']) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const entry: ClientPerson = { ...person, status, invitedBy: user.id, at: nowIso() };
    setClients((cs) => cs.map((x) => (x.id === clientId ? { ...x, people: [...(x.people ?? []).filter((p) => p.email !== person.email), entry] } : x)));
    setChannels((chs) => chs.map((ch) => (ch.clientId === clientId && ch.category === 'shared' && !ch.guests?.some((g) => g.email === person.email) ? { ...ch, guests: [...(ch.guests ?? []), { email: person.email, name: person.name, status: 'invited', invitedBy: user.id, at: nowIso() }] } : ch)));
    const link = await makeClientInvite(clientId)(person);
    showToast(
      link
        ? { text: `${person.name.split(' ')[0]} can sign in with their invite link`, action: { label: 'Copy link', run: () => void navigator.clipboard?.writeText(link) }, ms: 20000 }
        : { text: `${person.name} invited to ${c.name}` },
    );
  };
  const inviteClientPerson = (clientId: string, person: { name: string; email: string; role: ClientPerson['role'] }) => void giveClientAccess(clientId, person, 'invited');
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
    if (o.closeTasks) setTodos((ts) => ts.map((t) => (t.clientId === id && !t.done ? { ...t, done: true, status: 'done', doneAt: nowIso(), doneBy: user.id } : t)));
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
    if (!server.on) return;
    void fetch(`/api/vault?ws=${encodeURIComponent(ws.id)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: VaultItem[] }) => setVaultItems(d.items));
  };
  useEffect(() => {
    if (mode === 'vault') loadVault();
  }, [mode, ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Notes ---------------- */
  // Mine, and the ones shared with the company.
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

  /** Free covers 5 people: the 6th invite shows the price at that moment instead of a wall. */
  const openInvite = () => {
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
  const toggleAsk = () => setAskScope((s2) => (s2 ? null : contextScope()));
  const askOptions = [
    { value: 'all', label: 'Everything', group: 'Everywhere' },
    ...wsClients.map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}` })),
    ...wsChannels.filter((c) => c.kind === 'channel').map((c) => ({ value: `channel:${c.id}`, label: `#${c.name}`, group: 'Channels' })),
    ...[...wsMeetings].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12).map((m) => ({ value: `meeting:${m.id}`, label: m.title, group: 'Meetings' })),
  ];

  /** Sources for a scope: meetings, emails, chat and tasks, shaped the same way for the AI. */
  const askAnything = async (q: string, scope: AskScope) => {
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
      events: events.filter((e) => (e.workspaceId ?? 'pnp') === ws.id),
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
    if (ch.kind === 'dm' && !pl.parentId) {
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

  /** The demo bot: joins, waits to be let in, records a short sample conversation, leaves and writes notes. */
  const sendBot = (d: { url: string; title: string; botName: string; clientId: string; attendees?: string[]; fromEvent?: string }) => {
    const id = uid();
    const zoom = /zoom/i.test(d.url);
    const m: Meeting = { id, workspaceId: ws.id, title: d.title, at: nowIso(), minutes: 0, clientId: d.clientId || undefined, filedBy: d.clientId ? 'user' : undefined, attendees: d.attendees ?? [], summary: '', actions: [], status: 'queued', platform: zoom ? 'zoom' : 'meet', url: d.url, botName: d.botName, transcript: [], log: [{ message: d.fromEvent ? `Sent from calendar: ${d.title}` : 'Queued', at: nowIso() }], createdBy: user.id };
    setMeetings((ms) => [m, ...ms]);
    if (d.fromEvent) setSentEvents((s2) => ({ ...s2, [d.fromEvent!]: id }));
    setSendBotOpen(false);
    setMeetPage({ kind: 'meeting', id });
    go('meet');
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
    if (!n.link) return;
    if (n.link.app === 'tasks') return n.link.id ? openTask(n.link.id) : openTasks({ kind: 'mine' });
    if (n.link.app === 'chat') {
      if (n.link.msg) setFocusMsg(n.link.msg);
      return n.link.id ? openChannel(n.link.id) : go('chat');
    }
    if (n.link.app === 'mail' && n.link.id) return openThread(n.link.id);
    if (n.link.app === 'meet') return n.link.id ? openMeeting(n.link.id) : go('meet');
    go(n.link.app);
  };

  /* ---------------- Calendar ---------------- */

  // My outside calendars (personal: they show in every workspace) and teammates' availability on top.
  const myExtCals = useMemo(() => extCals.filter((c) => c.ownerId === user.id), [extCals, user.id]);
  const extIds = useMemo(() => new Set(extCals.map((c) => c.id)), [extCals]);
  const mateCals = useMemo(() => members.filter((u) => shownMates.has(u.id)).map((u) => ({ id: `mate-${u.id}`, name: u.name, color: u.color })), [members, shownMates]);
  const allCals = useMemo(() => [...CALENDARS, ...myExtCals, ...mateCals], [myExtCals, mateCals]);
  const visibleEvents = useMemo(() => {
    const mine = events.filter((e) => !hiddenCals.has(e.calendarId) && (e.userId ?? 'u-aqeel') === user.id && (extIds.has(e.calendarId) ? myExtCals.some((c) => c.id === e.calendarId) : (e.workspaceId ?? 'pnp') === ws.id));
    const mates = events.flatMap((e) => {
      const owner = e.userId ?? 'u-aqeel';
      if (owner === user.id || !shownMates.has(owner)) return [];
      const ext = extCals.find((c) => c.id === e.calendarId);
      if (!ext && (e.workspaceId ?? 'pnp') !== ws.id) return [];
      const share = ext ? (ext.share ?? 'busy') : 'details';
      if (share === 'private') return [];
      const first = (allUsers.find((u) => u.id === owner)?.name ?? 'Someone').split(' ')[0];
      return [{ ...e, id: `m-${e.id}`, calendarId: `mate-${owner}`, title: `${first}: ${share === 'busy' ? 'Busy' : e.title}`, notes: undefined, guests: undefined, location: share === 'busy' ? undefined : e.location, threadId: undefined }];
    });
    return [...mine, ...mates];
  }, [events, hiddenCals, ws.id, user.id, extIds, myExtCals, extCals, shownMates, allUsers]);
  const myEvents = useMemo(() => visibleEvents.filter((e) => !e.calendarId.startsWith('mate-')), [visibleEvents]);
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
    setEvents((es) => [...es, ev]);
    setNewEventAt(null);
    setCalCursor(new Date(ev.start));
    setSelectedEventId(ev.id);
    showToast({ text: 'Event created' });
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

  const upload = (files: FileList) => {
    const parentId = driveSection === 'my' ? driveFolder : null;
    const added: DriveItem[] = Array.from(files).map((f) => {
      const kind = kindOf(f);
      return {
        id: uid(),
        name: f.name,
        kind,
        parentId,
        size: f.size,
        modified: new Date().toISOString(),
        thumb: kind === 'image' || kind === 'video' ? URL.createObjectURL(f) : undefined,
        workspaceId: ws.id,
      };
    });
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

  const fab =
    mode === 'mail'
      ? { icon: PenLine, label: 'Compose', run: () => openCompose() }
      : mode === 'calendar'
        ? { icon: Plus, label: 'New event', run: () => openNewEvent() }
        : mode === 'drive'
          ? { icon: Upload, label: 'Upload', run: () => fileInput.current?.click() }
          : mode === 'tasks' || mode === 'home'
            ? { icon: Sparkles, label: 'Brain dump', run: () => setDump('') }
            : mode === 'chat' && !chatId
              ? { icon: Plus, label: 'New channel', run: () => setChanDialog({}) }
              : mode === 'meet'
                ? { icon: Video, label: 'Send bot to a meeting', run: () => setSendBotOpen(true) }
                : null;

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
    if (mode === 'tasks') {
      const sc = taskScope;
      return {
        label: 'Which tasks',
        value: sc.kind === 'client' ? `client:${sc.id}` : sc.kind === 'team' ? `team:${sc.id}` : sc.kind,
        options: [
          { value: 'mine', label: 'My tasks', group: 'Views' },
          { value: 'supervising', label: 'Supervising', group: 'Views' },
          { value: 'myteams', label: 'My teams', group: 'Views' },
          { value: 'myclients', label: `My ${term.many}`, group: 'Views' },
          { value: 'delegated', label: 'Assigned by me', group: 'Views' },
          { value: 'briefs', label: 'Briefs', group: 'Views' },
          ...(isAdmin ? [{ value: 'all', label: 'Everything', group: 'Views' }] : []),
          ...wsTeams.filter((t) => isAdmin || myTeamIds.includes(t.id)).map((t) => ({ value: `team:${t.id}`, label: t.name, group: 'Teams' })),
          ...wsClients.filter((c) => isAdmin || myClientIds.includes(c.id)).map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}` })),
        ],
        onChange: (v: string) => setTaskScope(v.startsWith('client:') ? { kind: 'client', id: v.slice(7) } : v.startsWith('team:') ? { kind: 'team', id: v.slice(5) } : ({ kind: v } as TaskScope)),
      };
    }
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

  // ⌘K: everything you can jump to
  const today0 = localDay();
  const paletteItems: PaletteItem[] = [
    // What needs you, so an empty search is already useful.
    ...wsTasks
      .filter((t) => !t.done && ((t.status === 'review' && t.supervisorId === user.id) || (doersOf(t).includes(user.id) && !!t.due && t.due <= today0)))
      .map((t) => ({ id: 'n-' + t.id, group: 'Needs you', title: t.title, sub: t.status === 'review' ? 'Waiting for your review' : t.due! < today0 ? 'Late' : 'Due today', icon: ListChecks, run: () => openTask(t.id) })),
    { id: 'a-dump', group: 'Actions', title: 'Brain dump', sub: 'Turn your thoughts into assigned tasks', icon: Brain, run: () => setDump('') },
    ...(enabled.has('mail') ? [{ id: 'a-compose', group: 'Actions', title: 'Compose email', icon: PenLine, run: () => openCompose() }] : []),
    { id: 'a-task', group: 'Actions', title: 'New task', icon: ListChecks, run: () => { openTasks({ kind: 'mine' }); setTimeout(() => document.getElementById('new-task')?.focus(), 200); } },
    ...(enabled.has('calendar') ? [{ id: 'a-event', group: 'Actions', title: 'New event', icon: CalendarPlus, run: () => { go('calendar'); openNewEvent(); } }] : []),
    ...APPS.filter((a) => enabled.has(a.id)).map((a) => ({ id: 'go-' + a.id, group: 'Go to', title: a.name, icon: a.icon, run: () => go(a.id) })),
    ...wsClientsAll.map((c) => ({ id: 'c-' + c.id, group: `${term.Many}`, title: c.name, sub: c.status === 'ended' ? `Past ${term.one}` : c.domain, icon: Building2, run: () => openClient(c.id) })),
    ...wsTasks.filter((t) => !t.done).map((t) => ({ id: 't-' + t.id, group: 'Tasks', title: t.title, sub: [wsClients.find((c) => c.id === t.clientId)?.name, t.userId ? firstOf(t.userId) : 'nobody yet'].filter(Boolean).join(' · '), icon: ListChecks, run: () => openTask(t.id) })),
    ...members.filter((u) => u.id !== user.id).map((u) => ({ id: 'p-' + u.id, group: 'People', title: u.name, sub: u.title || u.email, icon: UserIcon, run: () => openChannel(dmWith(u.id)) })),
    ...wsChannels.filter((c) => c.kind === 'channel').map((c) => ({ id: 'ch-' + c.id, group: 'Channels', title: '#' + c.name, icon: Hash, run: () => openChannel(c.id) })),
    ...wsThreads.slice(0, 60).map((t) => ({ id: 'm-' + t.id, group: 'Emails', title: t.subject, sub: t.messages[t.messages.length - 1].from.name, icon: Mail, run: () => openThread(t.id) })),
    ...wsNotes.map((n) => ({ id: 'no-' + n.id, group: 'Notes', title: n.title || 'Untitled note', sub: wsClientsAll.find((c) => c.id === n.clientId)?.name, icon: FileText, run: () => openNote(n.id) })),
    ...wsMeetings.map((m) => ({ id: 'mt-' + m.id, group: 'Meetings', title: m.title, icon: Video, run: () => openMeeting(m.id) })),
    ...wsDrive.filter((i) => i.kind !== 'folder' && !i.trashed).map((i) => ({ id: 'f-' + i.id, group: 'Files', title: i.name, icon: FileText, run: () => { go('drive'); setPreview({ item: i, list: [i] }); } })),
  ];

  // A company this person is a client of: their portal, with the same sign-in.
  const portal = myPortals.find((pt) => pt.key === portalKey);
  if (portal) {
    const pws = portal.ws;
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
        notices={notices.filter((n) => n.workspaceId === pws.id && inbox.includes(n.userId))}
        onReadNotices={() => setNotices((ns) => ns.map((n) => (n.workspaceId === pws.id && inbox.includes(n.userId) ? { ...n, read: true } : n)))}
        onSignOut={onSignOut}
        account={{ me: user, theme: settings.theme, onTheme: (t) => updateSettings({ theme: t }), onProfile: (patch) => (patch.name !== undefined && updateSettings({ name: patch.name, title: patch.title ?? settings.title, avatarColor: patch.color ?? settings.avatarColor }), onUpdateUser(patch)) }}
        switcher={<WorkspaceSwitcher workspaces={workspaces} current={pws} currentPortal={portal.key} unread={wsUnread} portals={portalItems} onPortal={setPortalKey} onSwitch={(id) => (setPortalKey(''), switchWorkspace(id))} />}
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
          notices={notices.filter((n) => n.userId === inbox)}
          onReadNotices={() => setNotices((ns) => ns.map((n) => (n.userId === inbox ? { ...n, read: true } : n)))}
          preview={{ onExit: () => setViewAs(null), people: people.filter((x) => x.status !== 'pending'), onSwitch: (email) => setViewAs({ clientId: vc.id, email }) }}
        />
      );
    }
  }

  return (
    <div className={`app mode-${mode} ${readerOpen ? 'reading' : ''} ${collapsed ? 'sb-collapsed' : ''} ${['home', 'settings'].includes(mode) ? 'no-sidebar' : ''}`}>
      <AppRail
        current={mode}
        enabled={enabledApps}
        badges={{ mail: accountUnread.all, chat: chatUnreadTotal, tasks: wsTasks.filter((t) => t.userId === user.id && !t.done && t.due && t.due <= localDay()).length }}
        workspace={
          <WorkspaceSwitcher
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
        width={Math.min(Math.max(sidebarW, SIDEBAR_MIN), SIDEBAR_MAX)}
        onWidth={setSidebarW}
        mobileTop={
          <div className="drawer-top">
          <WorkspaceSwitcher
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
            onAddCalendar={() => setConnectCal(true)}
            toPlan={wsTasks
              .filter((t) => !t.done && !isBrief(t) && doersOf(t).includes(user.id) && !events.some((e) => e.taskId === t.id && new Date(e.end).getTime() > Date.now()))
              .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
              .map((t) => ({ id: t.id, title: t.title, sub: [wsClients.find((c) => c.id === t.clientId)?.name, t.due ? dueLabel(t.due).text : ''].filter(Boolean).join(' · '), late: !!t.due && t.due < localDay() }))}
            onPlan={(id) => {
              const t = todos.find((x) => x.id === id);
              if (t) todoToCalendar(t);
            }}
            onShare={(id, share) => setExtCals((cs) => cs.map((c) => (c.id === id ? { ...c, share } : c)))}
            onSync={(id) => {
              setExtCals((cs) => cs.map((c) => (c.id === id ? { ...c, syncedAt: nowIso() } : c)));
              showToast({ text: 'Synced' });
            }}
            onRemove={(id) => {
              const cal = extCals.find((c) => c.id === id);
              const snapshot = { extCals, events };
              setExtCals((cs) => cs.filter((c) => c.id !== id));
              setEvents((es) => es.filter((e) => e.calendarId !== id));
              showToast({ text: `${cal?.name ?? 'Calendar'} removed`, action: { label: 'Undo', run: () => (setExtCals(snapshot.extCals), setEvents(snapshot.events)) } });
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
              setTaskScope(sc);
              setSidebarOpen(false);
            }}
            onBrainDump={() => setDump('')}
            onAddClient={(name, domain, type) => {
              const c = { id: uid(), workspaceId: ws.id, name, domain, type, color: ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444'][wsClients.length % 6], status: 'active' as const, ownerId: user.id };
              setClients((cs) => [...cs, c]);
              setTaskScope({ kind: 'client', id: c.id });
              showToast({ text: `${name} added` });
            }}
          />
          ) : appMode === 'meet' ? (
          <MeetSidebar
            page={meetPage}
            meetings={wsMeetings}
            clients={wsClients}
            canSend={meetSettings.whoCanRecord === 'everyone' || myRole !== 'member'}
            onPage={(pg) => (setMeetPage(pg), setSidebarOpen(false))}
            onSend={() => setSendBotOpen(true)}
            onAsk={() => setAskScope({ kind: 'all' })}
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
            onNewChannel={() => setChanDialog({})}
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
          ) : appMode === 'notes' ? (
            <NotesList notes={wsNotes} clients={wsClientsAll} current={noteId} filter={notesFilter} onFilter={setNotesFilter} onOpen={(id) => (setNoteId(id), setSidebarOpen(false))} onNew={() => newNote()} />
          ) : null
        }
        accounts={myAccounts}
        activeAccount={activeAccount}
        accountUnread={accountUnread}
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
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main" key={`${ws.id}:${mode}`}>
        {mobile && (
          <MobileTop
            title={({ home: 'Home', mail: 'Mail', chat: 'Chat', tasks: 'Tasks', calendar: 'Calendar', notes: 'Notes', drive: 'Drive', meet: 'Meet', vault: 'Vault', settings: 'Settings' } as Record<string, string>)[mode]}
            switcher={mobileSwitcher}
            workspaces={workspaces}
            current={ws}
            unread={myNotices.filter((n) => !n.read).length}
            onWorkspace={switchWorkspace}
            onAddWorkspace={() => setNewWs(true)}
            portals={portalItems}
            onPortal={setPortalKey}
            onSearch={() => setPaletteOpen(true)}
            onBell={() => setNoticesOpen(true)}
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
              onNewChannel={() => setChanDialog({})}
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
            onDump={(text) => setDump(text ?? '')}
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
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'tasks' && (
          <TasksView
            scope={taskScope}
            tasks={wsTasks}
            clients={wsClientsAll}
            teams={wsTeams}
            onScope={setTaskScope}
            onOpenTask={setTaskOpen}
            myTeamIds={myTeamIds}
            myClientIds={myClientIds}
            files={drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id)}
            workspace={ws}
            canManage={isAdmin}
            onViewAs={(clientId, email) => setViewAs({ clientId, email })}
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
            onAdd={(t) => {
              const task = createTask({ ...t, source: 'manual' }, { chat: true });
              if (task.userId && task.userId !== user.id) showToast({ text: `Assigned to ${firstOf(task.userId)}, they’ve been notified` });
              else if (!task.userId) showToast({ text: `Added to ${wsTeams.find((x) => x.id === task.teamId)?.name ?? 'the'} queue` });
            }}
            onStatus={setTaskStatus}
            onPatch={patchTask}
            onDelete={deleteTodo}
            onToCalendar={todoToCalendar}
            onOpenThread={openThread}
            onOpenChannel={openChannel}
            onOpenMeeting={openMeeting}
            onBrainDump={() => setDump('')}
            onTemplate={() => setTplOpen({ clientId: taskScope.kind === 'client' ? taskScope.id : undefined })}
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'chat' && (!mobile || chatId) && (
          <ChatView
            focusId={focusMsg}
            onFocused={() => setFocusMsg(null)}
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
            sentEvents={sentEvents}
            onPage={setMeetPage}
            onStop={stopBot}
            onRegenerate={(id) => finishMeeting(id, true)}
            onDelete={deleteMeeting}
            onFolder={setMeetingFolder}
            onPatch={patchMeeting}
            onShare={setShareFor}
            onToggleTask={toggleTodo}
            onPatchTask={patchTask}
            onBulk={(ids, action) =>
              action === 'delete'
                ? setTodos((ts) => ts.filter((t) => !ids.includes(t.id)))
                : setTodos((ts) => ts.map((t) => (ids.includes(t.id) ? { ...t, done: action === 'done', status: action === 'done' ? 'done' : 'todo', doneAt: action === 'done' ? nowIso() : undefined, doneBy: action === 'done' ? user.id : undefined } : t)))
            }
            onAddTask={(t) => createTask({ ...t, source: t.meetingId ? 'meeting' : 'manual' }, { chat: true })}
            onOpenTask={openTask}
            onOpenClient={openClient}
            onWriteOverview={writeOverview}
            onJoinMode={(jm) => patchWorkspace(ws.id, { meetings: { ...meetSettings, joinMode: jm } })}
            onOverride={(eid, join) =>
              setJoinOverrides((o) => {
                const n = { ...o };
                if (join === null) delete n[eid];
                else n[eid] = join;
                return n;
              })
            }
            onSendNow={(e) => {
              const zoom = /zoom/i.test(e.location ?? '');
              sendBot({ url: zoom ? 'https://zoom.us/j/1234567890' : 'https://meet.google.com/abc-defg-hij', title: e.title, botName: meetSettings.botName, clientId: '', attendees: (e.guests ?? []).map((g) => g.name), fromEvent: e.id });
              setSentEvents((s2) => ({ ...s2, [e.id]: 'pending' }));
            }}
            onAsk={setAskScope}
            onSend={() => setSendBotOpen(true)}
            onMenu={() => setSidebarOpen(true)}
            toast={(text) => showToast({ text })}
          />
        )}

        {mode === 'mail' && view.kind !== 'tracking' && (
          <div className="mail-view view-enter">
            <MessageList
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
            />
            <Reader
              thread={selected}
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
              onOpenTodos={() => openTasks({ kind: 'mine' })}
              unsubscribedAt={selected && incomingFrom(selected) ? unsubscribed[domainOf(incomingFrom(selected)!.email)] : undefined}
              onUnsubscribe={unsubscribe}
              onBlock={setBlockTarget}
              inviteAdded={!!selected && events.some((e) => e.threadId === selected.id && e.start === selected.invite?.start)}
              inviteConflicts={selected?.invite ? conflictsWith(selected.invite.start, selected.invite.end) : []}
              savedToDrive={savedToDrive}
              onSaveToDrive={saveToDrive}
              onAddInvite={addInvite}
              onBack={() => setReaderOpen(false)}
              onArchive={archive}
              onTrash={trash}
              onSpam={spam}
              onMoveToInbox={toInbox}
              onStar={star}
              onMarkUnread={markUnread}
              onReply={reply}
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
            canEdit={(e) => !e.calendarId.startsWith('mate-') && !extCals.find((c) => c.id === e.calendarId)?.readOnly && events.some((x) => x.id === e.id)}
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
            onTaskDone={(e) => e.taskId && setTaskStatus(e.taskId, 'done')}
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
          />
        )}

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

        {mode === 'settings' && (
          <SettingsPage
            email={ME.email}
            settings={settings}
            update={updateSettings}
            section={settingsSection}
            onSection={setSettingsSection}
            usage={usage}
            onMenu={() => setSidebarOpen(true)}
            workspace={ws}
            onWorkspace={(p) => patchWorkspace(ws.id, p)}
            onAddAccount={() => setNewAcct(true)}
            users={allUsers}
            me={user.id}
            onPhoto={(photo) => onUpdateUser({ photo })}
            onPreviewOnboarding={() => setPreviewOnboarding(true)}
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
              drive: drive.filter((d) => (d.workspaceId ?? 'pnp') === ws.id),
              byChannel: channels
                .filter((c) => c.workspaceId === ws.id && c.kind === 'channel')
                .map((c) => ({ name: c.name, size: messages.filter((m) => m.channelId === c.id).flatMap((m) => m.files ?? []).reduce((s2, f) => s2 + f.size, 0) }))
                .filter((c) => c.size > 0)
                .sort((a, b) => b.size - a.size),
              onTeams: (t) => {
                // A new team gets its own channel, with the team in it.
                const fresh = t.filter((x) => !wsTeams.some((y) => y.id === x.id));
                fresh.forEach((tm) => {
                  const id = uid();
                  setChannels((cs) => [...cs, { id, workspaceId: ws.id, kind: 'channel', name: tm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), members: [...new Set([user.id, ...tm.members])], teamId: tm.id, topic: `${tm.name} team`, category: 'team', ownerId: user.id, createdAt: nowIso() }]);
                });
                // People added to a team join its channel.
                t.forEach((tm) => setChannels((cs) => cs.map((c) => (c.teamId === tm.id ? { ...c, members: [...new Set([...c.members, ...tm.members])] } : c))));
                setTeams((all) => [...all.filter((x) => x.workspaceId !== ws.id), ...t]);
              },
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
            }}
            onRemoveAccount={(id) => {
              patchWorkspace(ws.id, { accounts: ws.accounts.filter((a) => a.id !== id) });
              if (activeAccount === id) setActiveAccount('all');
              showToast({ text: 'Account removed from this workspace' });
            }}
          />
        )}
      </main>

      {/* Phone: floating action + bottom tabs */}
      {fab && !(mode === 'mail' && readerOpen) && (
        <button className="fab" onClick={fab.run} aria-label={fab.label}>
          <fab.icon size={22} />
        </button>
      )}
      <nav className="tabbar">
        {tabApps
          .filter((id) => enabled.has(id))
          .slice(0, 4)
          .map((id) => [id, APPS.find((a) => a.id === id)!.icon, APPS.find((a) => a.id === id)!.name, id === 'mail' ? (accountUnread.all ?? 0) : id === 'chat' ? chatUnreadTotal : 0] as const)
          .map(([id, Icon, label, badge]) => (
            <button key={id} className={mode === id ? 'on' : ''} onClick={() => go(id)}>
              <span className="tab-icon">
                <Icon size={21} />
                {badge > 0 && <i>{badge}</i>}
              </span>
              {label}
            </button>
          ))}
        <button className={moreOpen || (!tabApps.includes(mode as AppId) && mode !== 'settings') || mode === 'settings' ? 'on' : ''} onClick={() => setMoreOpen((o) => !o)}>
          <span className="tab-icon">
            <MenuIcon size={21} />
          </span>
          More
        </button>
      </nav>
      {moreOpen && (
        <div className="more-sheet" onClick={() => setMoreOpen(false)}>
          <div className="more-card" onClick={(e) => e.stopPropagation()}>
            <SmoothHeight>
            <TabPane key={String(editingBar)}>
            {editingBar ? (
              <div className="bar-edit">
                <strong>Your bottom bar</strong>
                <small className="muted">Pick up to 4 apps. The rest live here in More.</small>
                {APPS.filter((a) => enabled.has(a.id)).map((a) => (
                  <label key={a.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={tabApps.includes(a.id)}
                      disabled={!tabApps.includes(a.id) && tabApps.length >= 4}
                      onChange={() => setTabApps(tabApps.includes(a.id) ? tabApps.filter((x) => x !== a.id) : [...tabApps, a.id])}
                    />
                    <a.icon size={17} /> {a.name}
                  </label>
                ))}
                <button className="primary-btn sm" onClick={() => setEditingBar(false)}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="more-apps">
                  {APPS.filter((a) => enabled.has(a.id) && !tabApps.slice(0, 4).includes(a.id)).map((a) => (
                    <button key={a.id} onClick={() => go(a.id)}>
                      <a.icon size={22} />
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => (setMoreOpen(false), toggleAsk())}>
                  <Sparkles size={20} /> Ask AI
                </button>
                <button onClick={() => setEditingBar(true)}>
                  <MenuIcon size={20} /> Edit the bottom bar
                </button>
              </>
            )}
            </TabPane>
            </SmoothHeight>
            <button onClick={() => go('settings')}>
              <UserIcon size={20} /> Account & settings
            </button>
          </div>
        </div>
      )}
      {noticesOpen && mobile && (
        <div className="more-sheet" onClick={() => setNoticesOpen(false)}>
          <div className="more-card notices-sheet" onClick={(e) => e.stopPropagation()}>
            <Notifications notices={myNotices} onOpen={openNotice} onReadAll={() => setNotices((ns) => ns.map((n) => (n.userId === user.id && n.workspaceId === ws.id ? { ...n, read: true } : n)))} onClose={() => setNoticesOpen(false)} />
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files);
          e.target.value = '';
        }}
      />

      {compose && (
        <Compose
          key={compose.key}
          contacts={contacts}
          signature={settings.signature}
          trackByDefault={settings.trackByDefault}
          accounts={myAccounts}
          defaultFrom={activeAccount !== 'all' ? activeAccount : myAccounts[0]?.id}
          initial={compose.initial}
          onSend={send}
          onClose={closeCompose}
        />
      )}
      {previewOnboarding && <Onboarding preview me={user} existingEmails={[]} onCreate={() => {}} onClose={() => (setPreviewOnboarding(false), new URLSearchParams(location.search).has('preview') && history.replaceState(null, '', location.pathname))} />}
      {newWs && (
        <Onboarding
          me={user}
          existingEmails={allUsers.map((u) => u.email.toLowerCase())}
          onClose={() => setNewWs(false)}
          onCreate={(w, newUsers) => {
            newUsers.forEach(onInvite);
            setWorkspaces((list) => [...list, w]);
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
          onClose={() => setConnectCal(false)}
          onConnect={(cals) => {
            setExtCals((cs) => [...cs, ...cals]);
            setEvents((es) => [...es, ...cals.flatMap(externalEvents)]);
            setConnectCal(false);
            showToast({ text: `${cals.length > 1 ? `${cals.length} calendars` : cals[0].name} connected` });
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
          onOpenChannel={(clientId) => {
            const ch = channels.find((c) => c.workspaceId === ws.id && c.clientId === clientId && c.category !== 'shared') ?? channels.find((c) => c.workspaceId === ws.id && c.clientId === clientId);
            if (ch) (setTaskOpen(null), openChannel(ch.id));
            else showToast({ text: `This ${term.one} has no channel yet` });
          }}
        />
      )}
      {sendBotOpen && <SendBotDialog clients={wsClients} botName={meetSettings.botName} onSend={sendBot} onClose={() => setSendBotOpen(false)} />}
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
          templates={[...savedTemplates.filter((t) => t.workspaceId === ws.id), ...BUILT_IN_TEMPLATES]}
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
          recentKey={`s2g-palette-recent:${user.id}:${ws.id}`}
          queryActions={(q) => [
            { id: 'q-task', group: 'Do with “' + (q.length > 40 ? q.slice(0, 40) + '…' : q) + '”', title: `Create task “${q}”`, sub: 'Assigned to you', icon: ListChecks, run: () => { const t = createTask({ title: q.charAt(0).toUpperCase() + q.slice(1), userId: user.id, source: 'manual' }); showToast({ text: 'Task created', action: { label: 'Open', run: () => openTask(t.id) } }); } },
            { id: 'q-note', group: 'Do with “' + (q.length > 40 ? q.slice(0, 40) + '…' : q) + '”', title: `New note “${q}”`, sub: 'Only you can see it until you share it', icon: FileText, run: () => newNote(q.charAt(0).toUpperCase() + q.slice(1)) },
            { id: 'q-ask', group: 'Do with “' + (q.length > 40 ? q.slice(0, 40) + '…' : q) + '”', title: `Ask AI: “${q}”`, sub: 'Answers from your mail, chat, meetings and tasks', icon: Sparkles, run: () => { setAskSeed(q); setAskScope({ kind: 'all' }); } },
          ]}
          onClose={() => setPaletteOpen(false)}
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
        </div>
      )}
    </div>
  );
}
