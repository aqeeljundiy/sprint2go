import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, HardDrive, Mail, PenLine, Plus, Undo2, Upload, UserRound } from 'lucide-react';
import type { Account, Attachment, BlockRule, CalEvent, Todo, DriveItem, DriveSection, FolderId, Location, Person, Thread, User, View, Workspace } from './types';
import { LABELS } from './data/mock';
import { CALENDARS } from './data/calendar';
import { MAIL_USAGE, QUOTA, fmtSize, kindOf, parseSize } from './data/drive';
import { lastMessage, uid } from './utils';
import { eventsOn } from './calendarUtils';
import { useSettings, usePersisted } from './settings';
import { DEFAULT_TRACK_OPTIONS, isTeam } from './tracking';
import { isMine, setIdentity } from './identity';
import { scanned, useStored } from './store';
import { ai } from './ai';
import { AIAssistant } from './components/AIAssistant';
import { TodosView } from './components/TodosView';
import { BlockDialog } from './components/BlockDialog';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { InviteMember, NewAccount, NewWorkspace } from './components/WorkspaceForms';
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

const FOLDER_TITLES: Record<FolderId, string> = {
  inbox: 'Inbox',
  starred: 'Starred',
  sent: 'Sent',
  drafts: 'Drafts',
  archive: 'Archive',
  spam: 'Spam',
  trash: 'Trash',
};

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
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
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
  const [mode, setMode] = useState<Mode>('mail');
  const [lastMode, setLastMode] = useState<Exclude<Mode, 'settings'>>('mail');
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
  const [scanning, setScanning] = useState(false);
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

  const send = (m: Outgoing) => {
    const draftId = compose?.draftId;
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
          .map<Todo>((f) => ({ id: uid(), title: f.title, due: f.due ?? undefined, priority: f.priority, done: false, threadId: t.id, source: 'ai', userId: user.id, createdAt: new Date().toISOString() }));
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
          action: { label: 'View', run: () => selectView({ kind: 'todos', id: 'todos' }) },
        });
      else if (force) showToast({ text: 'No new to-dos found' });
    });
  };

  useEffect(() => {
    scan();
  }, [wsThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTodo = (id: string) => setTodos((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const deleteTodo = (id: string) => {
    const snapshot = todos;
    setTodos((list) => list.filter((t) => t.id !== id));
    showToast({ text: 'To-do deleted', action: { label: 'Undo', run: () => setTodos(snapshot) } });
  };
  const todoToCalendar = (t: Todo) => {
    const start = new Date(`${t.due ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T09:00`);
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
      if (compose || newEventAt || preview) return;

      // "g" then m / c / d jumps between sections
      if (e.key === 'g') {
        gPressed.current = Date.now();
        return;
      }
      if (Date.now() - gPressed.current < 1000) {
        const target = { m: 'mail', c: 'calendar', d: 'drive' }[e.key] as Mode | undefined;
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
          : null;

  return (
    <div className={`app mode-${mode} ${readerOpen ? 'reading' : ''} ${collapsed ? 'sb-collapsed' : ''}`}>
      <Sidebar
        mode={appMode}
        inSettings={mode === 'settings'}
        onMode={go}
        collapsed={collapsed && !mobile}
        onCollapse={setCollapsed}
        width={Math.min(Math.max(sidebarW, SIDEBAR_MIN), SIDEBAR_MAX)}
        onWidth={setSidebarW}
        account={{ ...ME, title: settings.title }}
        switcher={
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
        todoCount={myTodos.filter((t) => !t.done).length}
        onAskAI={() => setAiOpen((o) => !o)}
        aiOpen={aiOpen}
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
        accountOpen={accountOpen}
        onAccount={setAccountOpen}
        accountMenu={
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
        }
        calendarPanel={
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
        }
        drivePanel={
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
        }
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

        {mode === 'mail' && view.kind === 'todos' && (
          <TodosView
            todos={myTodos}
            threads={wsThreads}
            scanning={scanning}
            onAdd={(title, due) =>
              setTodos((list) => [...list, { id: uid(), title, due, done: false, priority: 'normal', source: 'manual', userId: user.id, createdAt: new Date().toISOString() }])
            }
            onToggle={toggleTodo}
            onDelete={deleteTodo}
            onToCalendar={todoToCalendar}
            onOpenThread={openThread}
            onScan={() => scan(true)}
            onMenu={() => setSidebarOpen(true)}
          />
        )}

        {mode === 'mail' && view.kind !== 'tracking' && view.kind !== 'todos' && (
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
              onOpenTodos={() => selectView({ kind: 'todos', id: 'todos' })}
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
        {([
          ['mail', Mail, 'Mail', counts.inbox],
          ['calendar', CalendarDays, 'Calendar', 0],
          ['drive', HardDrive, 'Drive', 0],
          ['settings', UserRound, 'Account', 0],
        ] as const).map(([id, Icon, label, badge]) => (
          <button key={id} className={mode === id ? 'on' : ''} onClick={() => go(id)}>
            <span className="tab-icon">
              <Icon size={21} />
              {badge > 0 && <i>{badge}</i>}
            </span>
            {label}
          </button>
        ))}
      </nav>

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
        <NewWorkspace
          userId={user.id}
          userName={settings.name || user.name}
          onClose={() => setNewWs(false)}
          onCreate={(w) => {
            setWorkspaces((list) => [...list, w]);
            setNewWs(false);
            setWsId(w.id);
            setActiveAccount('all');
            setSelectedId(null);
            setView({ kind: 'folder', id: 'inbox' });
            go('mail');
            showToast({ text: `${w.name} is ready` });
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
