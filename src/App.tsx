import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Building2, CalendarPlus, FileText, Hash, House, ListChecks, Mail, MessagesSquare, Menu as MenuIcon, PenLine, Plus, Sparkles, Undo2, Upload, User as UserIcon, Video } from 'lucide-react';
import type { Account, AppId, Attachment, BlockRule, CalEvent, Channel, ChatFile, ChatMessage, Meeting, Notice, TaskStatus, Todo, DriveItem, DriveSection, FolderId, Location, Person, Thread, User, View, Workspace } from './types';
import { LABELS } from './data/mock';
import { CALENDARS } from './data/calendar';
import { MAIL_USAGE, QUOTA, fmtSize, kindOf, parseSize } from './data/drive';
import { lastMessage, uid, localDay } from './utils';
import { eventsOn } from './calendarUtils';
import { useSettings, usePersisted } from './settings';
import { DEFAULT_TRACK_OPTIONS, isTeam } from './tracking';
import { isMine, setIdentity } from './identity';
import { scanned, useStored } from './store';
import { ai } from './ai';
import { AIAssistant } from './components/AIAssistant';
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
import { ChatSidebar, ChatView, type Presence, type SendPayload } from './components/ChatApp';
import { ChannelDialog } from './components/ChannelDialog';
import { celebrate } from './components/ui/confetti';
import { MeetView } from './components/MeetView';
import { Onboarding } from './components/Onboarding';
import { textToHtml } from './sanitize';

const FOLDER_TITLES: Record<FolderId, string> = {
  inbox: 'Inbox',
  starred: 'Starred',
  sent: 'Sent',
  drafts: 'Drafts',
  archive: 'Archive',
  spam: 'Spam',
  trash: 'Trash',
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

function inView(t: Thread, v: View) {
  if (v.kind === 'tracking' || v.kind === 'todos') return false;
  if (v.kind === 'label') return t.labels.includes(v.id) && t.location !== 'trash' && t.location !== 'spam';
  switch (v.id) {
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
  onInvite: (u: User) => void;
  onUpdateUser: (patch: Partial<User>) => void;
}

export default function App({ user, signedInUsers, allUsers, workspaces: allWorkspaces, setWorkspaces, onSwitchUser, onAddUser, onSignOut, onInvite, onUpdateUser }: AppProps) {
  const [settings, updateSettings] = useSettings(user);

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
    applyBranding(ws);
    const root = document.documentElement;
    root.style.setProperty('--accent', ws.color);
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${ws.color} 86%, #000)`);
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${ws.color} 13%, transparent)`);
  }, [ws]);

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
  const [aiOpen, setAiOpen] = useState(false);
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
  const [teams] = useStored('teams');
  const [statuses, setStatuses] = useStored('statuses');
  const [chanDialog, setChanDialog] = useState<{ id?: string } | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [meetId, setMeetId] = useState<string | null>(null);
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
      .filter((t) => inView(t, view))
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
      inbox: scoped.filter((t) => t.location === 'inbox' && t.unread).length,
      drafts: scoped.filter((t) => t.location === 'drafts').length,
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

  /* ---------------- AI to-dos ---------------- */

  /** Reads new inbox mail and adds the tasks it asks of you. */
  const scan = async (force = false) => {
    const fresh = wsThreads.filter((t) => {
      if (t.location !== 'inbox' || fromBlocked(t)) return false;
      const last = t.messages[t.messages.length - 1];
      if (isMine(last.from.email) || last.listUnsubscribe) return false;
      return force || !scanned.has(`${user.id}:${t.id}:${last.id}`);
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
  const wsClients = useMemo(() => clients.filter((c) => c.workspaceId === ws.id), [clients, ws.id]);
  const wsTeams = useMemo(() => teams.filter((t) => t.workspaceId === ws.id), [teams, ws.id]);
  const wsTasks = useMemo(() => todos.filter((t) => (t.workspaceId ?? 'pnp') === ws.id), [todos, ws.id]);
  const wsChannels = useMemo(() => channels.filter((c) => c.workspaceId === ws.id && c.members.includes(user.id) && !c.archived), [channels, ws.id, user.id]);
  // Channels I can see in the sidebar: mine, plus public ones I could join.
  const visibleChannels = useMemo(() => channels.filter((c) => c.workspaceId === ws.id && !c.archived && (c.members.includes(user.id) || (c.kind === 'channel' && !c.private))), [channels, ws.id, user.id]);
  const myRole = ws.members.find((m) => m.userId === user.id)?.role ?? 'member';
  const myNotices = useMemo(() => notices.filter((n) => n.userId === user.id && n.workspaceId === ws.id), [notices, user.id, ws.id]);
  const wsMeetings = useMemo(() => meetings.filter((m) => m.workspaceId === ws.id), [meetings, ws.id]);
  const firstOf = (id?: string) => (allUsers.find((u) => u.id === id)?.name ?? 'Someone').split(' ')[0];
  const myFirst = (settings.name || user.name).split(' ')[0];
  const nowIso = () => new Date().toISOString();

  /** Which client an email belongs to, by the sender's domain. */
  function clientForThread(t: Thread) {
    return wsClients.find((c) => c.domain && t.messages.some((m) => [m.from, ...m.to].some((p) => p.email.toLowerCase().endsWith('@' + c.domain))));
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
  const chatUnreadTotal = Object.values(chatUnread).reduce((a, b) => a + b, 0);

  // Chat always opens on a channel (the first one, usually #general), also after switching workspace.
  useEffect(() => {
    if (mode === 'chat' && !wsChannels.some((c) => c.id === chatId) && wsChannels.length) setChatId(wsChannels[0].id);
  }, [mode, chatId, wsChannels]);

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
    return `“${t.title}”${c ? ` for ${c.name}` : ''}${t.due ? `, due ${dueLabel(t.due).text.toLowerCase()}` : ''}`;
  };

  const createTask = (
    t: {
      title: string;
      clientId?: string;
      teamId?: string;
      briefId?: string;
      kind?: Todo['kind'];
      context?: string;
      userId: string;
      due?: string;
      priority?: 'high' | 'normal';
      source: Todo['source'];
      threadId?: string;
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
      createdAt: nowIso(),
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

  function setTaskStatus(id: string, status: TaskStatus, quiet = false) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    const before = { status: t.status, done: t.done, doneAt: t.doneAt, doneBy: t.doneBy };
    setTodos((ts) =>
      ts.map((x) =>
        x.id === id ? { ...x, status, done: status === 'done', doneAt: status === 'done' ? (x.done ? x.doneAt : nowIso()) : undefined, doneBy: status === 'done' ? (x.done ? x.doneBy : user.id) : undefined } : x,
      ),
    );
    if (status === 'done' && !t.done) {
      if (t.createdBy && t.createdBy !== user.id) notify(t.createdBy, 'done', `${myFirst} finished ${describe(t)}`, { app: 'tasks', id: t.id });
      // Finishing the last task of a brief tells the person in charge.
      const br = t.briefId ? todos.find((x) => x.id === t.briefId) : undefined;
      if (br && br.userId !== user.id && todos.filter((x) => x.briefId === br.id && x.id !== id).every((x) => x.done))
        notify(br.userId, 'done', `All tasks in the brief “${br.title}” are done`, { app: 'tasks', id: br.id });
      // Celebrate in the client's (or team's) channel, and with a little confetti for the person who finished it.
      if (ws.chat?.celebrations !== false && !isBrief(t)) {
        const ch = channels.find((c) => c.workspaceId === ws.id && !c.archived && c.kind === 'channel' && ((t.clientId && c.clientId === t.clientId) || (!t.clientId && t.teamId && c.teamId === t.teamId)));
        if (ch) setMessages((ms) => [...ms, { id: uid(), channelId: ch.id, userId: user.id, text: `${myFirst} finished “${t.title}”`, at: nowIso(), kind: 'celebration', taskId: t.id }]);
        if (!quiet) celebrate();
      }
      if (!quiet)
        showToast({
          text: `Done: ${t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title}`,
          action: { label: 'Undo', run: () => setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, ...before } : x))) },
          ms: 6000,
        });
    }
  }

  const patchTask = (id: string, patch: Partial<Todo>) => {
    const t = todos.find((x) => x.id === id);
    setTodos((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (t && patch.userId && patch.userId !== t.userId && patch.userId !== user.id) {
      notify(patch.userId, 'task', `${myFirst} assigned you ${describe(t)}`, { app: 'tasks', id });
      showToast({ text: `Assigned to ${firstOf(patch.userId)}` });
    }
  };

  const openTasks = (scope: TaskScope) => {
    setTaskScope(scope);
    go('tasks');
  };
  const openClient = (id: string) => openTasks({ kind: 'client', id });
  const openChannel = (id: string) => {
    setChatId(id);
    go('chat');
  };
  const openMeeting = (id: string) => {
    setMeetId(id);
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
      return visibleEvents.some((e) => !e.allDay && e.start <= now && e.end > now) ? 'meeting' : 'active';
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
    setMessages((ms) => [...ms, { id: uid(), channelId: chatId, userId: user.id, text: pl.text, at: nowIso(), parentId: pl.parentId, alsoInChannel: pl.alsoInChannel, files, voice: pl.voice, poll: pl.poll, kind: pl.kind, kudosFor: pl.kudosFor }]);
    const text = pl.text;
    const where = ch.kind === 'dm' ? 'a message' : `#${ch.name}`;
    if (pl.kind === 'kudos' && pl.kudosFor) notify(pl.kudosFor, 'mention', `🙌 ${myFirst} gave you kudos in ${where}${text ? `: “${text.slice(0, 80)}”` : ''}`, { app: 'chat', id: ch.id });
    if (pl.parentId) {
      const root = messages.find((m) => m.id === pl.parentId);
      if (root && root.userId !== user.id && root.userId !== 'guest') notify(root.userId, 'mention', `${myFirst} replied to your message in ${where}: “${text.slice(0, 80)}”`, { app: 'chat', id: ch.id });
    }
    for (const id of ch.members) {
      if (id === user.id) continue;
      const fn = firstOf(id);
      if (ch.kind === 'dm') notify(id, 'mention', `${myFirst} messaged you: “${(text || (pl.voice ? 'a voice note' : pl.files ? 'a file' : '')).slice(0, 80)}”`, { app: 'chat', id: ch.id });
      else if (text && new RegExp(`@${fn}\\b`, 'i').test(text)) notify(id, 'mention', `${myFirst} mentioned you in #${ch.name}: “${text.slice(0, 80)}”`, { app: 'chat', id: ch.id });
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
    const task = createTask({ title: a.title, userId: owner?.id ?? user.id, clientId: m.clientId, due: dueFromWord(a.due), source: 'meeting' }, { chat: true });
    setMeetings((ms) => ms.map((x) => (x.id === m.id ? { ...x, actions: x.actions.map((y, j) => (j === i ? { ...y, taskId: task.id } : y)) } : x)));
    if (!quiet) showToast({ text: `Task created for ${owner ? (owner.id === user.id ? 'you' : owner.name.split(' ')[0]) : 'you'}` });
  };

  const openNotice = (n: Notice) => {
    setNotices((ns) => ns.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setNoticesOpen(false);
    if (!n.link) return;
    if (n.link.app === 'tasks') return n.link.id ? openTask(n.link.id) : openTasks({ kind: 'mine' });
    if (n.link.app === 'chat') return n.link.id ? openChannel(n.link.id) : go('chat');
    if (n.link.app === 'meet') return n.link.id ? openMeeting(n.link.id) : go('meet');
    go(n.link.app);
  };

  /* ---------------- Calendar ---------------- */

  const visibleEvents = useMemo(() => events.filter((e) => !hiddenCals.has(e.calendarId) && (e.workspaceId ?? 'pnp') === ws.id && (e.userId ?? 'u-aqeel') === user.id), [events, hiddenCals, ws.id, user.id]);
  const busyDays = useMemo(() => new Set(visibleEvents.map((e) => new Date(e.start).toDateString())), [visibleEvents]);
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
    eventsOn(visibleEvents, new Date(start)).filter((e) => !e.allDay && e.start < end && e.end > start);

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
        setAiOpen((o) => !o);
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
            : null;

  // ⌘K: everything you can jump to
  const paletteItems: PaletteItem[] = [
    { id: 'a-dump', group: 'Actions', title: 'Brain dump', sub: 'Turn your thoughts into assigned tasks', icon: Brain, run: () => setDump('') },
    ...(enabled.has('mail') ? [{ id: 'a-compose', group: 'Actions', title: 'Compose email', icon: PenLine, run: () => openCompose() }] : []),
    { id: 'a-task', group: 'Actions', title: 'New task', icon: ListChecks, run: () => { openTasks({ kind: 'mine' }); setTimeout(() => document.getElementById('new-task')?.focus(), 200); } },
    ...(enabled.has('calendar') ? [{ id: 'a-event', group: 'Actions', title: 'New event', icon: CalendarPlus, run: () => { go('calendar'); openNewEvent(); } }] : []),
    ...APPS.filter((a) => enabled.has(a.id)).map((a) => ({ id: 'go-' + a.id, group: 'Go to', title: a.name, icon: a.icon, run: () => go(a.id) })),
    ...wsClients.map((c) => ({ id: 'c-' + c.id, group: 'Clients', title: c.name, sub: c.domain, icon: Building2, run: () => openClient(c.id) })),
    ...wsTasks.filter((t) => !t.done).map((t) => ({ id: 't-' + t.id, group: 'Tasks', title: t.title, sub: firstOf(t.userId), icon: ListChecks, run: () => openTask(t.id) })),
    ...members.filter((u) => u.id !== user.id).map((u) => ({ id: 'p-' + u.id, group: 'People', title: u.name, sub: u.title || u.email, icon: UserIcon, run: () => openChannel(dmWith(u.id)) })),
    ...wsChannels.filter((c) => c.kind === 'channel').map((c) => ({ id: 'ch-' + c.id, group: 'Channels', title: '#' + c.name, icon: Hash, run: () => openChannel(c.id) })),
    ...wsThreads.slice(0, 60).map((t) => ({ id: 'm-' + t.id, group: 'Emails', title: t.subject, sub: t.messages[t.messages.length - 1].from.name, icon: Mail, run: () => openThread(t.id) })),
    ...wsMeetings.map((m) => ({ id: 'mt-' + m.id, group: 'Meetings', title: m.title, icon: Video, run: () => openMeeting(m.id) })),
    ...wsDrive.filter((i) => i.kind !== 'folder' && !i.trashed).map((i) => ({ id: 'f-' + i.id, group: 'Files', title: i.name, icon: FileText, run: () => { go('drive'); setPreview({ item: i, list: [i] }); } })),
  ];

  return (
    <div className={`app mode-${mode} ${readerOpen ? 'reading' : ''} ${collapsed ? 'sb-collapsed' : ''} ${['home', 'meet', 'settings'].includes(mode) ? 'no-sidebar' : ''}`}>
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
        aiOpen={aiOpen}
        onApp={go}
        onSearch={() => setPaletteOpen(true)}
        onAskAI={() => setAiOpen((o) => !o)}
        onNotices={() => setNoticesOpen((o) => !o)}
      />
      <Sidebar
        mode={appMode}
        title={({ home: 'Home', mail: 'Mail', chat: 'Chat', tasks: 'Tasks', calendar: 'Calendar', drive: 'Drive', meet: 'Meet', settings: 'Settings' } as Record<string, string>)[appMode]}
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
            clients={wsClients}
            teams={wsTeams}
            me={user.id}
            onScope={(sc) => {
              setTaskScope(sc);
              setSidebarOpen(false);
            }}
            onBrainDump={() => setDump('')}
            onAddClient={(name, domain) => {
              const c = { id: uid(), workspaceId: ws.id, name, domain, color: ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444'][wsClients.length % 6], status: 'active' as const, ownerId: user.id };
              setClients((cs) => [...cs, c]);
              setTaskScope({ kind: 'client', id: c.id });
              showToast({ text: `${name} added` });
            }}
          />
          ) : appMode === 'chat' ? (
          <ChatSidebar
            channels={visibleChannels}
            users={members}
            me={user.id}
            workspaceId={ws.id}
            current={chatId}
            unread={chatUnread}
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
            onStatus={(st) =>
              setStatuses((all) => {
                const next = { ...all };
                if (st) next[user.id] = st;
                else delete next[user.id];
                return next;
              })
            }
          />
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
        counts={counts}
        open={sidebarOpen}
        onSelect={selectView}
        onCompose={() => openCompose()}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main" key={`${ws.id}:${mode}`}>
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
            onOpenTask={openTask}
            onOpenTeam={(id) => openTasks({ kind: 'team', id })}
            onOpenBriefs={() => openTasks({ kind: 'briefs' })}
            onOpenGrid={() => openTasks({ kind: 'grid' })}
            threads={scoped}
            events={visibleEvents}
            meetings={wsMeetings}
            notices={myNotices}
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
            clients={wsClients}
            teams={wsTeams}
            onScope={setTaskScope}
            onOpenTask={setTaskOpen}
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
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'chat' && (
          <ChatView
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
              return cl ? drive.filter((d) => !d.trashed && !d.channelId && (d.workspaceId ?? 'pnp') === ws.id && (d.clientId === cl.id || (!!word && d.name.toLowerCase().includes(word)))) : [];
            })()}
            statuses={statuses}
            presence={presence}
            gifs={ws.chat?.gifs !== false}
            meetUrl={ws.meetUrl}
            onSend={sendChat}
            onDelete={deleteMessage}
            onReact={reactTo}
            onVote={votePoll}
            onMakeTask={makeTaskFromMessage}
            onCreateTask={(t) => {
              const ch = channels.find((c) => c.id === chatId);
              const task = createTask({ ...t, clientId: ch?.clientId, teamId: ch?.teamId, source: 'chat' }, { chat: false });
              if (chatId) setMessages((ms) => [...ms, { id: uid(), channelId: chatId, userId: user.id, text: `📌 New task${t.userId !== user.id ? ` for @${firstOf(t.userId)}` : ''}`, at: nowIso(), taskId: task.id }]);
            }}
            onOpenTask={openTask}
            onOpenClient={openClient}
            onOpenTeam={(id) => openTasks({ kind: 'team', id })}
            onOpenMail={openThread}
            onSettings={() => chatId && setChanDialog({ id: chatId })}
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'meet' && (
          <MeetView
            meetings={wsMeetings}
            clients={wsClients}
            tasks={wsTasks}
            selected={meetId}
            meetUrl={ws.meetUrl}
            onSelect={setMeetId}
            onMakeTask={(m, i) => meetingActionToTask(m, i)}
            onMakeAll={(m) => {
              m.actions.forEach((a, i) => !a.taskId && meetingActionToTask(m, i, true));
              showToast({ text: 'Action items are now tasks, owners notified' });
            }}
            onOpenTask={openTask}
            onOpenClient={openClient}
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'mail' && view.kind !== 'tracking' && (
          <div className="mail-view view-enter">
            <MessageList
              ref={searchRef}
              title={title}
              threads={visible}
              labels={LABELS}
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
              onMenu={() => setSidebarOpen(true)}
            />
            <Reader
              thread={selected}
              labels={LABELS}
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
            calendars={CALENDARS}
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
          />
        )}

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
            myRole={role}
            onInvite={() => setInviting(true)}
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
        {(
          [
            ['home', House, 'Home', 0],
            ['mail', Mail, 'Mail', accountUnread.all ?? 0],
            ['chat', MessagesSquare, 'Chat', chatUnreadTotal],
            ['tasks', ListChecks, 'Tasks', 0],
          ] as const
        )
          .filter(([id]) => enabled.has(id))
          .map(([id, Icon, label, badge]) => (
            <button key={id} className={mode === id ? 'on' : ''} onClick={() => go(id)}>
              <span className="tab-icon">
                <Icon size={21} />
                {badge > 0 && <i>{badge}</i>}
              </span>
              {label}
            </button>
          ))}
        <button className={moreOpen || ['calendar', 'drive', 'meet', 'settings'].includes(mode) ? 'on' : ''} onClick={() => setMoreOpen((o) => !o)}>
          <span className="tab-icon">
            <MenuIcon size={21} />
            {myNotices.some((n) => !n.read) && <i>{myNotices.filter((n) => !n.read).length}</i>}
          </span>
          More
        </button>
      </nav>
      {moreOpen && (
        <div className="more-sheet" onClick={() => setMoreOpen(false)}>
          <div className="more-card" onClick={(e) => e.stopPropagation()}>
            {APPS.filter((a) => enabled.has(a.id) && ['calendar', 'drive', 'meet'].includes(a.id)).map((a) => (
              <button key={a.id} onClick={() => go(a.id)}>
                <a.icon size={20} /> {a.name}
              </button>
            ))}
            <button onClick={() => (setMoreOpen(false), setNoticesOpen(true))}>
              <Hash size={20} /> Notifications {myNotices.some((n) => !n.read) && <b>{myNotices.filter((n) => !n.read).length}</b>}
            </button>
            <button onClick={() => (setMoreOpen(false), setPaletteOpen(true))}>
              <Sparkles size={20} /> Search
            </button>
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
      {newEventAt && <EventEditor start={newEventAt} calendars={CALENDARS} onSave={saveEvent} onClose={() => setNewEventAt(null)} />}
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
          clients={wsClients}
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
          onOpenChannel={(clientId) => {
            const ch = channels.find((c) => c.workspaceId === ws.id && c.clientId === clientId);
            if (ch) (setTaskOpen(null), openChannel(ch.id));
            else showToast({ text: 'This client has no channel yet' });
          }}
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
          guestsAllowed={true}
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
      {paletteOpen && <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
      <AIAssistant
        open={aiOpen}
        threads={scoped}
        me={settings.name || user.name}
        onClose={() => setAiOpen(false)}
        onOpenThread={(id) => {
          openThread(id);
          if (mobile) setAiOpen(false);
        }}
      />
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
