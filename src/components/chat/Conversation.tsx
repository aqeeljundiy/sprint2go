import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bell, BellOff, Bookmark, BookmarkMinus, ChevronRight, Clock, Copy, Forward, Handshake, Hash, Headphones, Link2, ListChecks, Lock, LogOut, MailOpen, Menu, MessageSquareReply, Pencil, Pin, Settings, Sparkles, Trash2, WifiOff, X } from 'lucide-react';
import type { Channel, ChatFile, ChatMessage, Client, DriveItem, Role, Status, Team, Thread, Todo, User } from '../../types';
import { localDay } from '../../utils';
import { term } from '../../terms';
import { ai } from '../../ai';
import { routeBase } from '../../tryOut';
import { server, retryUnsent, uploadFile, wasSkipped } from '../../sync';
import { channelSchedule } from '../../jobTimes';
import { toast, toastUndo } from '../../toast';
import { usePhone } from '../../mobile/media';
import { useFocusedScreen } from '../../mobile/chrome';
import { Avatar } from '../Avatar';
import { EmptyState } from '../ui/EmptyState';
import { TabBar } from '../ui/TabBar';
import { TabPane } from '../ui/Smooth';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { PushScreen } from '../ui/PushScreen';
import { ActionSheet, type SheetAction } from '../ui/ActionSheet';
import { Select } from '../ui/Select';
import { personOption } from '../ui/PeopleList';
import { ChannelMaterials } from '../ChannelMaterials';
import { DraftNote, useChatDraft } from '../ChatDraft';
import type { Presence } from '../ChatApp';
import { Composer, ScheduledLine, type Library, type Outgoing } from './Composer';
import { authorOf, DayLine, fmtSize, Msg, NewLine, preview, type MsgCtx } from './Message';
import { ConfirmSheet, EmojiGrid, EmojiSheet, ForwardSheet, ReactionRow, WhenSheet, WhoReactedSheet, chanName } from './Sheets';
import { ChannelAbout, PinnedPane, SummaryPane, TasksPane } from './Details';
import { draftKey, dmOther, useChatState, whenText } from './chatPrefs';
import { useConnection, useUnsent } from './net';
import { useDockRef } from './huddleDock';
import './chat.css';

export interface SendPayload {
  text: string;
  parentId?: string;
  alsoInChannel?: boolean;
  files?: ChatFile[];
  voice?: ChatMessage['voice'];
  poll?: ChatMessage['poll'];
  kind?: ChatMessage['kind'];
  kudosFor?: string;
  sendAt?: string;
  taskId?: string;
  ref?: ChatMessage['ref'];
}

export interface ViewProps {
  channel: Channel | null;
  messages: ChatMessage[]; // the whole channel, threads included
  channels?: Channel[]; // my conversations (forwarding)
  users: User[];
  me: string;
  myRole: Role;
  clients: Client[];
  teams: Team[];
  tasks: Todo[];
  mail: Thread[];
  drive: DriveItem[]; // files saved for this channel's client
  statuses: Record<string, Status>;
  presence: (id: string) => Presence;
  gifs: boolean;
  meetUrl?: string;
  library?: Library; // what the composer's + can share
  onSend: (p: SendPayload) => void;
  onDelete: (id: string) => void;
  onEdit?: (id: string, text: string) => void;
  onForward?: (m: ChatMessage, to: { channelId?: string; userId?: string }, note: string) => void;
  onPin: (id: string) => void;
  onToggleTask: (id: string) => void;
  onChannel: (p: Partial<Channel>) => void; // bookmarks, summaries
  summaryCost: string;
  /** Why scheduled summaries can't be written for this company right now (no AI, allowance used up); fixed where. */
  summaryOff?: { text: string; fix?: { label: string; run: () => void } };
  since: string; // when I last opened this channel, before now
  onReact: (id: string, emoji: string) => void;
  onVote: (id: string, option: number) => void;
  onMakeTask: (m: ChatMessage) => void;
  onCreateTask: (t: { title: string; userId: string; due?: string }) => void;
  onOpenTask: (id: string) => void;
  onOpenClient: (id: string) => void;
  onOpenTeam: (id: string) => void;
  onOpenMail: (id: string) => void;
  onOpenRef?: (ref: NonNullable<ChatMessage['ref']>) => void;
  onOpenScheduled?: () => void; // Drafts and sent, Scheduled
  onLeave?: () => void;
  onSettings: () => void;
  onMenu: () => void;
  onBack?: () => void; // phones: back to the channel list
  /** Someone at a client (their portal): messages and materials only, none of the team's tools. */
  guest?: { canPost: boolean };
  huddle?: { joined: boolean; onJoin: () => void; onOpen?: () => void }; // a quick voice call in this channel
  /** Land on this message (from a notification): open its thread if it's a reply, scroll to it and highlight it. */
  focusId?: string | null;
  onFocused?: () => void;
  /** The company's time zone (Settings, General): when scheduled summaries are written. */
  timeZone?: string;
}

const COMMANDS = [
  { cmd: '/task', hint: 'Make a task: /task Send the deck @Rizky friday' },
  { cmd: '/remind', hint: 'Remind yourself: /remind call Nadia tomorrow' },
];

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dueIn(text: string): { due?: string; rest: string } {
  const t = text.toLowerCase();
  const d = new Date();
  let hit = '';
  if (/\btomorrow\b/.test(t)) (d.setDate(d.getDate() + 1), (hit = 'tomorrow'));
  else if (/\bnext week\b/.test(t)) (d.setDate(d.getDate() + 7), (hit = 'next week'));
  else if (/\btoday\b/.test(t)) hit = 'today';
  else {
    const i = DAYS.findIndex((x) => new RegExp(`\\b${x}\\b`).test(t));
    if (i >= 0) {
      d.setDate(d.getDate() + (((i - d.getDay() + 7) % 7) || 7));
      hit = DAYS[i];
    }
  }
  if (!hit) return { rest: text };
  const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { due, rest: text.replace(new RegExp(`\\s*(by|on|due)?\\s*${hit}\\b`, 'i'), '').trim() };
}

type Tab = 'messages' | 'materials' | 'tasks' | 'pinned' | 'summary' | 'about';
type Sub = { kind: 'react' | 'remind' | 'forward' | 'who' | 'delete'; m: ChatMessage; emoji?: string; anchor?: HTMLElement };

/** The line under a conversation's header when this device can't reach the server. */
export function ConnectionLine() {
  const state = useConnection();
  const last = useRef(state);
  if (state !== 'ok') last.current = state;
  const shown = state === 'ok' ? last.current : state;
  return (
    <div className={`fold conn-fold${state !== 'ok' ? ' open' : ''}`} aria-hidden={state === 'ok'}>
      <div>
        <div className={`conn-line is-${shown}`} role="status">
          {shown === 'offline' ? <WifiOff size={14} aria-hidden /> : <span className="conn-dot" aria-hidden />}
          {shown === 'offline' ? 'Offline. What you write is sent when you’re back.' : 'Connecting…'}
        </div>
      </div>
    </div>
  );
}

export function ChatView(p: ViewProps) {
  const { channel, users, me } = p;
  const phone = usePhone();
  useFocusedScreen(!!p.onBack); // phones: a channel (and its threads) takes the whole screen, the tab bar steps aside
  const chat = useChatState(me);
  const unsentNow = useUnsent('messages');
  const [text, setText] = useState('');
  const [tab, setTab] = useState<Tab>('messages');
  const [details, setDetails] = useState<null | 'menu' | Exclude<Tab, 'messages'> | 'people'>(null);
  const [summarizing, setSummarizing] = useState<'period' | 'since' | null>(null);
  const [sinceText, setSinceText] = useState<string | null>(null);
  const [catchUp, setCatchUp] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [kudos, setKudos] = useState<{ who: string; text: string } | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<{ m: ChatMessage; at?: { x: number; y: number }; anchor?: HTMLElement } | null>(null);
  const [sub, setSub] = useState<Sub | null>(null);
  const [holdRead, setHoldRead] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchorRef = useRef<HTMLElement | null>(null);
  const dockRef = useDockRef();
  const foot = useRef<HTMLDivElement>(null);
  // Phones: toasts sit just above the message box, not on it (src/mobile/chat.css reads --chat-foot).
  useEffect(() => {
    const el = foot.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--chat-foot', `${Math.round(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--chat-foot');
    };
  }, [phone, channel?.id]);
  const person = (id: string) => users.find((u) => u.id === id);
  const client = channel?.clientId ? p.clients.find((c) => c.id === channel.clientId) : undefined;
  const team = channel?.teamId ? p.teams.find((t) => t.id === channel.teamId) : undefined;
  const sorted = useMemo(() => p.messages.filter((m) => !m.sendAt).sort((a, b) => a.at.localeCompare(b.at)), [p.messages]);
  const waiting = useMemo(() => p.messages.filter((m) => m.sendAt && m.userId === me), [p.messages, me]);
  const top = sorted.filter((m) => !m.parentId || m.alsoInChannel);
  const replies = (id: string) => sorted.filter((m) => m.parentId === id);
  const guest = p.guest;
  const firstNew = !p.since ? undefined : top.find((m) => m.at > p.since && m.userId !== me && m.kind !== 'celebration' && m.kind !== 'system')?.id;

  useEffect(() => {
    if (!p.focusId) return;
    const target = p.messages.find((m) => m.id === p.focusId);
    if (!target) return;
    setTab('messages');
    if (target.parentId) setThreadId(target.parentId);
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-msg="${p.focusId}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 2200);
      }
      p.onFocused?.();
    }, 250);
    return () => clearTimeout(t);
  }, [p.focusId, p.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const canPost = guest ? guest.canPost : !channel || channel.postPolicy !== 'admins' || p.myRole !== 'member' || channel.ownerId === me;
  const thread = threadId ? p.messages.find((m) => m.id === threadId) : undefined;

  // Opening a conversation: land on what's new (or the end), with an empty box (or the draft left there).
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const line = el.querySelector('.chat-new') as HTMLElement | null;
    el.scrollTop = line ? Math.max(0, line.offsetTop - 80) : el.scrollHeight;
    atBottom.current = !line;
  }, [channel?.id, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // New messages: follow them when you're at the end, or when you sent one.
  const lastTop = top[top.length - 1];
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || !lastTop) return;
    if (atBottom.current || lastTop.userId === me) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [lastTop?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The keyboard opening (or anything that resizes the list) keeps the end in view when you were at it.
  useEffect(() => {
    const el = scroll.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => atBottom.current && (el.scrollTop = el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [channel?.id, tab]);
  useEffect(() => {
    setThreadId(null);
    setKudos(null);
    setTab('messages');
    setSinceText(null);
    setEditing(null);
    setDetails(null);
    setHoldRead(false);
    setMuteOpen(false);
  }, [channel?.id]);
  // Reading marks it read (unless you just marked it unread here).
  useEffect(() => {
    if (channel && !holdRead) chat.markRead(channel.id);
  }, [channel?.id, top.length, holdRead]); // eslint-disable-line react-hooks/exhaustive-deps
  // Up in an empty box: edit your last message.
  useEffect(() => {
    const on = () => {
      const mine = [...top].reverse().find((m) => m.userId === me && !m.guestEmail && m.text && !m.voice && m.kind !== 'kudos');
      if (mine) setEditing(mine);
    };
    window.addEventListener('s2g:chat-edit-last', on);
    return () => window.removeEventListener('s2g:chat-edit-last', on);
  });
  // What a connected AI app drafted for this channel (guests read it): fills the box to check and send (ChatDraft.tsx).
  const chatDraft = useChatDraft(me, channel?.id, (f) => setText(f));

  if (!channel)
    return (
      <section className="chat-pane chat-empty view-enter">
        <EmptyState icon={<Hash size={22} />} title="Pick a channel or person" text={`${term.One} channels keep every conversation about a ${term.one} in one place.`} />
      </section>
    );

  const other = channel.kind === 'dm' ? person(dmOther(channel, me)) : undefined;
  const title = chanName(channel, users, me);
  const chanFiles = p.messages.flatMap((m) => (m.files ?? []).map((f) => ({ f, m })));
  const chanTasks = p.tasks.filter((t) => t.kind !== 'brief' && (t.channelId === channel.id || (client && t.clientId === client.id) || (team && t.teamId === team.id)));
  const pinned = sorted.filter((m) => m.pinned);
  const lateTasks = chanTasks.filter((t) => !t.done && !!t.due && t.due < localDay()).length;
  const links = sorted
    .flatMap((m) =>
      (m.text.match(/https?:\/\/[^\s)]+/g) ?? []).map((url, i) => ({
        key: m.id + i,
        url,
        at: m.at,
        who: m.guestEmail ? (channel.guests?.find((g) => g.email === m.guestEmail)?.name ?? 'Guest') : (person(m.userId)?.name.split(' ')[0] ?? 'Someone'),
      })),
    )
    .reverse();
  const muted = chat.mutedUntil(channel.id);
  const members = channel.members.length + (channel.guests?.length ?? 0);

  /** AI summary of a period (this month / week / day) or of what I missed. Only on click, or on the schedule. */
  const summarize = async (kind: 'period' | 'since') => {
    setSummarizing(kind);
    const schedule = channelSchedule(channel);
    const sch = schedule === 'off' ? 'monthly' : schedule;
    const from = kind === 'since' ? p.since : new Date(Date.now() - (sch === 'daily' ? 1 : sch === 'weekly' ? 7 : 31) * 86_400_000).toISOString();
    const msgs = sorted
      .filter((m) => m.at > from)
      .map((m) => ({
        who: authorOf(m, { me, users, channel }).first,
        text: m.voice?.transcript ?? m.text,
        at: m.at,
        task: m.taskId ? p.tasks.find((t) => t.id === m.taskId)?.title : undefined,
        files: m.files?.map((f) => f.name),
      }));
    const text = await ai.catchUp(title, msgs, person(me)?.name.split(' ')[0] ?? 'me');
    if (kind === 'since') setSinceText(text);
    else {
      const period = sch === 'daily' ? 'Today' : sch === 'weekly' ? 'This week' : new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }) + ' so far';
      p.onChannel({ summary: { schedule, post: channel.summary?.post ?? false, history: [{ id: Math.random().toString(36).slice(2), text, period, at: new Date().toISOString(), auto: false, by: me }, ...(channel.summary?.history ?? [])] } });
      if (channel.summary?.post) p.onSend({ text: `📝 Summary (${period}): ${text}` });
    }
    setSummarizing(null);
  };
  const mentioned = (t: string) => users.find((u) => u.id !== me && new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(t));

  /** Slash commands run here; everything else is a message. */
  const runCommand = (raw: string): boolean => {
    if (guest) return false;
    const [cmd, ...rest] = raw.split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case '/task': {
        if (!arg) return true;
        const who = mentioned(arg);
        const { due, rest: t } = dueIn(arg.replace(/@\w+\s*/g, ''));
        p.onCreateTask({ title: t.charAt(0).toUpperCase() + t.slice(1), userId: who?.id ?? me, due });
        return true;
      }
      case '/remind': {
        if (!arg) return true;
        const { due, rest: t } = dueIn(arg);
        p.onCreateTask({ title: t.charAt(0).toUpperCase() + t.slice(1), userId: me, due: due ?? undefined });
        return true;
      }
      case '/kudos': {
        const who = mentioned(arg);
        if (who) p.onSend({ text: arg.replace(/@\w+\s*/, '').trim(), kind: 'kudos', kudosFor: who.id });
        else setKudos({ who: '', text: arg });
        return true;
      }
      case '/meet':
        p.onSend({ text: `📹 Join the call: ${p.meetUrl ?? 'https://meet.sprint2go.com/' + channel.name}` });
        return true;
    }
    return false;
  };

  /** A file to the server first, so it's there for everyone and after a reload (a data URL in the demo). */
  const upload = async (f: File | Blob, name?: string): Promise<ChatFile | null> => {
    const fileName = name ?? (f as File).name ?? 'file';
    try {
      const up = await uploadFile(f, channel.workspaceId, fileName);
      return { name: fileName, size: f.size, type: up.type, url: up.url };
    } catch (e) {
      if (wasSkipped(e)) return null; // they chose not to upload a big file
      // On a real server a file only this browser has would look sent but nobody else could open it: say why instead.
      if (server.on) window.dispatchEvent(new CustomEvent('s2g:save-failed', { detail: { error: `${fileName}: ${(e as Error).message}` } }));
      else return { name: fileName, size: f.size, type: f.type || 'application/octet-stream', url: URL.createObjectURL(f) };
      return null;
    }
  };

  const linkTo = (m: ChatMessage) => `${location.origin}${routeBase}/chat?ws=${encodeURIComponent(channel.workspaceId)}&id=${encodeURIComponent(channel.id)}&msg=${encodeURIComponent(m.id)}`;
  const copy = (s: string, said: string) =>
    navigator.clipboard?.writeText(s).then(
      () => toast({ text: said }),
      () => toast({ text: 'Couldn’t copy here' }),
    );
  const toggleSave = (m: ChatMessage) => {
    const was = chat.savedItem(m.id);
    if (was) {
      chat.unsave(m.id);
      toastUndo('Removed from saved', () => chat.restoreSaved(was));
    } else {
      chat.save(m);
      toast({ text: 'Saved. Find it under Saved in Chat.', action: { label: 'Remind me', run: () => setSub({ kind: 'remind', m }) } });
    }
  };
  const markUnread = (m: ChatMessage) => {
    chat.markUnread(m);
    if (m.parentId && !m.alsoInChannel) return toast({ text: 'Thread marked unread' });
    setHoldRead(true);
    toast({ text: 'Marked unread from here' });
    if (phone) p.onBack?.();
  };
  const openThread = (rootId: string) => {
    setThreadId(rootId);
    chat.markThreadRead(rootId);
  };

  const actionsFor = (m: ChatMessage): SheetAction[] => {
    const mine = m.userId === me && !m.guestEmail;
    const saved = chat.savedItem(m.id);
    const root = m.parentId && !m.alsoInChannel ? m.parentId : m.id;
    const list: SheetAction[] = [];
    if (threadId !== root) list.push({ label: m.parentId ? 'Open thread' : 'Reply in thread', icon: MessageSquareReply, run: () => openThread(root) });
    if (!guest && !m.taskId && m.text && m.kind !== 'kudos') list.push({ label: 'Make a task', icon: ListChecks, run: () => p.onMakeTask(m) });
    if (!guest) {
      list.push(saved ? { label: 'Remove from saved', icon: BookmarkMinus, run: () => toggleSave(m) } : { label: 'Save', icon: Bookmark, run: () => toggleSave(m) });
      list.push({ label: 'Remind me', icon: Clock, hint: saved?.remindAt && !saved.reminded ? `Set for ${whenText(saved.remindAt)}` : undefined, run: () => setSub({ kind: 'remind', m }) });
    }
    if (!mine) list.push({ label: 'Mark unread', icon: MailOpen, run: () => markUnread(m) });
    if (!guest) list.push({ label: 'Copy link', icon: Link2, run: () => copy(linkTo(m), 'Link copied') });
    if (m.text) list.push({ label: 'Copy text', icon: Copy, run: () => copy(m.text, 'Text copied') });
    if (!guest && p.onForward && p.channels) list.push({ label: 'Forward', icon: Forward, run: () => setSub({ kind: 'forward', m }) });
    if (!guest && channel.kind === 'channel' && !m.parentId) list.push({ label: m.pinned ? 'Unpin' : 'Pin to the channel', icon: Pin, group: 'end', run: () => p.onPin(m.id) });
    if (mine && p.onEdit && m.text && !m.voice && !m.poll && m.kind !== 'kudos') list.push({ label: 'Edit', icon: Pencil, group: 'end', run: () => setEditing(m) });
    if (mine && !guest) list.push({ label: 'Delete', icon: Trash2, danger: true, group: 'end', run: () => setSub({ kind: 'delete', m }) });
    return list;
  };

  const ctx: MsgCtx = {
    me,
    users,
    channel,
    client,
    tasks: p.tasks,
    statuses: p.statuses,
    guest: !!guest,
    phone,
    replies,
    threadDraft: (rootId) => !!chat.drafts[draftKey(channel.id, rootId)],
    saved: (id) => chat.savedItem(id),
    unsent: unsentNow,
    onReact: p.onReact,
    onVote: p.onVote,
    onOpenTask: p.onOpenTask,
    onOpenThread: openThread,
    onMenu: (m, where) => setMenu('anchor' in where ? { m, anchor: where.anchor } : { m, at: where }),
    onReactPick: (m, anchor) => {
      anchorRef.current = anchor;
      setSub({ kind: 'react', m, anchor });
    },
    onWhoReacted: (m, emoji) => setSub({ kind: 'who', m, emoji }),
    onOpenRef: (r) => p.onOpenRef?.(r),
    onMakeTask: p.onMakeTask,
    onSave: toggleSave,
    onRetry: retryUnsent,
  };

  const list = (
    <div
      className="chat-scroll"
      ref={scroll}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {(() => {
        let prev: ChatMessage | null = null;
        let prevDay = '';
        return top.map((m) => {
          const day = new Date(m.at).toDateString();
          const showDay = day !== prevDay;
          const grouped = !!(!showDay && prev && prev.userId === m.userId && prev.kind !== 'celebration' && m.kind !== 'kudos' && m.id !== firstNew && new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60_000);
          prev = m;
          prevDay = day;
          return (
            <div key={m.id} className="msg-wrap">
              {showDay && <DayLine at={m.at} />}
              {m.id === firstNew && <NewLine />}
              <Msg m={m} grouped={grouped} ctx={ctx} />
            </div>
          );
        });
      })()}
      {top.length === 0 && <p className="chat-start">This is the start of {title}. Say hello 👋</p>}
    </div>
  );

  const composer = canPost ? (
    <Composer
      chat={chat}
      draftKey={draftKey(channel.id)}
      text={text}
      setText={setText}
      placeholder={`Message ${title}`}
      users={users}
      me={me}
      phone={phone}
      guest={!!guest}
      autoFocus
      commands={guest ? undefined : COMMANDS}
      onCommand={runCommand}
      onSend={(o: Outgoing) => {
        p.onSend(o);
        chatDraft.sent();
        if (o.sendAt) toast({ text: `Goes ${whenText(o.sendAt)}`, action: p.onOpenScheduled ? { label: 'See', run: p.onOpenScheduled } : undefined });
      }}
      upload={upload}
      editing={editing}
      onEdit={(id, t) => (p.onEdit?.(id, t), setEditing(null))}
      onCancelEdit={() => setEditing(null)}
      canSchedule={!guest}
      library={guest ? undefined : p.library}
      onKudos={guest ? undefined : () => setKudos({ who: '', text: '' })}
      onMeetLink={guest ? undefined : () => runCommand('/meet')}
    />
  ) : (
    <div className="chat-locked">
      <Lock size={14} /> Only admins post in #{channel.name}. You can still react and reply in threads.
    </div>
  );

  const above = (
    <>
      {channel.category === 'shared' && !guest && (
        <div className="shared-note">
          <Handshake size={14} />
          <span>
            {channel.guests?.length ? `${channel.guests.map((g) => g.name.split(' ')[0]).join(', ')} can read this channel.` : `Shared with ${client?.name ?? 'guests'}. Invite people in channel settings.`} Keep internal talk in your team’s own channel.
          </span>
        </div>
      )}
      {canPost && <DraftNote draft={chatDraft.draft} text={text} onUse={chatDraft.use} onDiscard={chatDraft.discard} />}
      <ScheduledLine list={waiting} onSee={() => p.onOpenScheduled?.()} />
    </>
  );

  const paneProps = { channel, users, me, tasks: p.tasks, mail: p.mail, statuses: p.statuses, presence: p.presence, timeZone: p.timeZone, onOpenClient: p.onOpenClient, onOpenTeam: p.onOpenTeam, onOpenTask: p.onOpenTask, onOpenMail: p.onOpenMail, onSettings: p.onSettings };
  const pane = (id: Exclude<Tab, 'messages'> | 'people') => {
    switch (id) {
      case 'materials':
        return (
          <>
            <p className="space-used chan-space">
              {chanFiles.length ? (
                <>
                  Files shared here use <b>{fmtSize(chanFiles.reduce((s2, x) => s2 + x.f.size, 0))}</b> of team storage
                </>
              ) : (
                'Files, links and docs for this channel, in folders if you like'
              )}
              {p.drive.length ? <span className="muted"> · {fmtSize(p.drive.reduce((s2, d) => s2 + d.size, 0))} in {client?.name}’s Drive folder</span> : null}
            </p>
            <ChannelMaterials
              channel={channel}
              users={users}
              me={me}
              chatFiles={[
                ...chanFiles.map(({ f, m }) => ({ key: `file:${m.id}:${f.name}`, name: f.name, type: f.type, size: f.size, url: f.url, who: authorOf(m, { me, users, channel }).first, at: m.at, where: 'in chat' })),
                ...p.drive.map((d) => ({ key: `drive:${d.id}`, name: d.name, type: d.kind === 'image' ? 'image/' : d.kind === 'video' ? 'video/' : 'application/', size: d.size, url: undefined, who: '', at: d.modified, where: client ? `in ${client.name}’s Drive folder` : 'in Drive' })),
              ]}
              chatLinks={links}
              onChannel={p.onChannel}
              readOnly={!!guest}
            />
          </>
        );
      case 'tasks':
        return <TasksPane channel={channel} title={title} client={client} team={team} tasks={chanTasks} users={users} me={me} onCreateTask={p.onCreateTask} onToggleTask={p.onToggleTask} onOpenTask={p.onOpenTask} />;
      case 'summary':
        return <SummaryPane channel={channel} users={users} since={p.since} summaryCost={p.summaryCost} summaryOff={p.summaryOff} timeZone={p.timeZone} summarizing={summarizing} sinceText={sinceText} summarize={summarize} onChannel={p.onChannel} />;
      case 'pinned':
        return <PinnedPane pinned={pinned} render={(m) => <Msg key={m.id} m={m} grouped={false} ctx={ctx} />} />;
      case 'people':
        return <ChannelAbout {...paneProps} client={client} team={team} other={other} only="people" />;
      case 'about':
        return <ChannelAbout {...paneProps} client={client} team={team} other={other} only={phone ? 'about' : undefined} />;
    }
  };

  const overlays = (
    <>
      {thread && (
        <ThreadView
          root={thread}
          replies={replies(thread.id)}
          ctx={ctx}
          chat={chat}
          channel={channel}
          title={title}
          users={users}
          me={me}
          phone={phone}
          canPost={!guest || guest.canPost}
          upload={upload}
          library={guest ? undefined : p.library}
          onClose={() => setThreadId(null)}
          onSend={(o, also) => p.onSend({ ...o, parentId: thread.id, alsoInChannel: also })}
          editing={editing && editing.parentId === thread.id ? editing : null}
          onEdit={(id, t) => (p.onEdit?.(id, t), setEditing(null))}
          onCancelEdit={() => setEditing(null)}
        />
      )}
      {menu && (
        <ActionSheet
          open
          onClose={() => setMenu(null)}
          actions={actionsFor(menu.m)}
          anchor={menu.anchor ? { current: menu.anchor } : undefined}
          at={menu.at ?? null}
          header={
            guest ? undefined : (
              <ReactionRow
                mine={Object.entries(menu.m.reactions ?? {})
                  .filter(([, who]) => who.includes(me))
                  .map(([e]) => e)}
                onReact={(e) => (setMenu(null), p.onReact(menu.m.id, e))}
                onMore={() => {
                  const m = menu.m;
                  setMenu(null);
                  setTimeout(() => setSub({ kind: 'react', m, anchor: menu.anchor }), 0);
                }}
              />
            )
          }
        />
      )}
      {sub?.kind === 'react' &&
        (phone || !sub.anchor ? (
          <EmojiSheet title="React" onPick={(e) => p.onReact(sub.m.id, e)} onClose={() => setSub(null)} />
        ) : (
          <Popover anchor={anchorRef} open onClose={() => setSub(null)} width={320} title="React">
            <EmojiGrid onPick={(e) => (setSub(null), p.onReact(sub.m.id, e))} />
          </Popover>
        ))}
      {sub?.kind === 'remind' && (
        <WhenSheet
          title="Remind me"
          kind="remind"
          note={<p className="when-note">It’s saved, and you get a notification then: “{preview(sub.m).slice(0, 70)}”</p>}
          onPick={(at) => {
            chat.save(sub.m, at);
            toast({ text: `Saved. You’ll be reminded ${whenText(at)}.` });
          }}
          onClose={() => setSub(null)}
        />
      )}
      {sub?.kind === 'forward' && p.onForward && p.channels && <ForwardSheet m={sub.m} channels={p.channels} users={users} me={me} onForward={(to, note) => p.onForward?.(sub.m, to, note)} onClose={() => setSub(null)} />}
      {sub?.kind === 'who' && <WhoReactedSheet m={sub.m} first={sub.emoji ?? ''} users={users} me={me} channel={channel} onClose={() => setSub(null)} />}
      {sub?.kind === 'delete' && <ConfirmSheet title="Delete this message?" text={channel.kind === 'dm' ? 'It’s gone for both of you, with any replies in its thread.' : `Everyone in ${title} stops seeing it, with any replies in its thread.`} yes="Delete" onYes={() => p.onDelete(sub.m.id)} onClose={() => setSub(null)} />}
      {kudos && (
        <Sheet
          title="🙌 Give kudos"
          onClose={() => setKudos(null)}
          footer={
            <>
              <span className="muted small sheet-foot-note">Shows on everyone’s Home under Wins this week.</span>
              <button className="primary-btn" disabled={!kudos.who} onClick={() => (p.onSend({ text: kudos.text.trim(), kind: 'kudos', kudosFor: kudos.who }), setKudos(null))}>
                Send kudos
              </button>
            </>
          }
        >
          <div className="kudos-form">
            <Select value={kudos.who || null} onChange={(v) => setKudos({ ...kudos, who: v })} placeholder="Who?" label="Who gets kudos" options={users.filter((u) => u.id !== me).map((u) => ({ ...personOption(u), label: u.name, icon: <Avatar person={u} size={22} /> }))} />
            <input className="is-input" value={kudos.text} onChange={(e) => setKudos({ ...kudos, text: e.target.value })} placeholder="For what? e.g. saving the KopiKita invoice" aria-label="For what" />
          </div>
        </Sheet>
      )}
      {leaving && (
        <ConfirmSheet title={`Leave ${title}?`} text={channel.private ? 'It’s private: someone in it has to add you back.' : 'You can join again from Browse channels.'} yes="Leave" onYes={() => p.onLeave?.()} onClose={() => setLeaving(false)} />
      )}
    </>
  );

  /* ---------- Phones: one header row, the messages, the box; details and threads push over it ---------- */
  if (phone && p.onBack) {
    const subtitle = other ? (p.statuses[other.id] ? `${p.statuses[other.id].emoji} ${p.statuses[other.id].text}` : (other.title ?? '')) : guest ? (channel.topic ?? '') : `${members} ${members === 1 ? 'member' : 'members'}`;
    const detailRows: { id: Exclude<Tab, 'messages'> | 'people'; label: string; hint?: string }[] = [
      ...(other ? [] : [{ id: 'people' as const, label: 'People', hint: channel.guests?.length ? `${channel.members.length} on the team, ${channel.guests.length} ${channel.guests.length === 1 ? 'guest' : 'guests'}` : undefined }]),
      { id: 'materials', label: 'Files and links' },
      ...(guest ? [] : [{ id: 'pinned' as const, label: 'Pinned', hint: pinned.length ? undefined : 'Nothing yet' }]),
      ...(guest ? [] : [{ id: 'tasks' as const, label: 'Tasks', hint: lateTasks ? `${lateTasks} late` : undefined }]),
      ...(guest ? [] : [{ id: 'summary' as const, label: 'Summaries' }]),
      ...(guest ? [] : [{ id: 'about' as const, label: other ? 'Profile' : 'About' }]),
    ];
    const paneTitle: Record<string, string> = { people: 'People', materials: 'Files and links', pinned: 'Pinned', tasks: 'Tasks', summary: 'Summaries', about: other ? 'Profile' : 'About' };
    return (
      <PushScreen
        className="chat-push"
        onBack={p.onBack}
        title={
          <button type="button" className="chan-title-btn" onClick={() => !guest && setDetails('menu')} aria-label={guest ? title : `${title}: details`} disabled={!!guest}>
            {other ? (
              <span className="dm-av">
                <Avatar person={other} size={28} />
                <i className={`presence ${p.presence(other.id)}`} />
              </span>
            ) : null}
            <span className="ctb-text">
              <span className="ctb-name">
                {channel.category === 'shared' && !other ? <Handshake size={15} /> : channel.private && !other ? <Lock size={14} /> : null}
                <span className="ctb-label">{title}</span>
                {muted && <BellOff size={13} className="ctb-muted" aria-label="Muted" />}
              </span>
              <span className="ctb-sub">
                {subtitle}
                {!guest && <ChevronRight size={13} aria-hidden />}
              </span>
            </span>
          </button>
        }
        actions={
          <>
            {p.huddle && !guest && (
              <button type="button" className={`icon-btn huddle-icon${channel.huddle?.members.length ? ' live' : ''}${p.huddle.joined ? ' on' : ''}`} onClick={p.huddle.joined ? p.huddle.onOpen : p.huddle.onJoin} aria-label={p.huddle.joined ? 'Open the huddle' : channel.huddle?.members.length ? 'Join the huddle' : 'Start a huddle'}>
                <Headphones size={20} />
              </button>
            )}
            {!guest && (
              <button type="button" className="icon-btn" onClick={() => (setCatchUp(true), !sinceText && !summarizing && !p.summaryOff && void summarize('since'))} aria-label="Catch me up: what I missed here">
                <Sparkles size={19} />
              </button>
            )}
          </>
        }
        footer={
          <div className="chat-foot" ref={foot}>
            {above}
            {composer}
          </div>
        }
      >
        <ConnectionLine />
        <div className="huddle-dock" ref={dockRef} />
        {list}
        {details && !guest && (
          <PushScreen title="Details" backLabel={title.length > 14 ? 'Back' : title} onBack={() => setDetails(null)} className="chat-details">
            <div className="cd-hero">
              {other ? <Avatar person={other} size={56} /> : <span className="cd-icon">{channel.private ? <Lock size={24} /> : channel.category === 'shared' ? <Handshake size={24} /> : <Hash size={24} />}</span>}
              <strong>{other ? other.name : title}</strong>
              <span className="muted">{other ? other.title : (channel.topic ?? (client ? `${client.name} ${term.one} channel` : ''))}</span>
            </div>
            <div className="cdt-actions">
              <button type="button" onClick={() => (muted ? (chat.unmute(channel.id), toast({ text: 'Notifications back on' })) : setMuteOpen((o) => !o))} className={muted || muteOpen ? 'on' : ''} aria-expanded={!muted ? muteOpen : undefined}>
                {muted ? <BellOff size={20} /> : <Bell size={20} />}
                <span>{muted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button type="button" onClick={() => copy(`${location.origin}${routeBase}/chat?ws=${encodeURIComponent(channel.workspaceId)}&id=${encodeURIComponent(channel.id)}`, 'Link copied')}>
                <Link2 size={20} />
                <span>Copy link</span>
              </button>
              {channel.kind === 'channel' && (
                <button type="button" onClick={p.onSettings}>
                  <Settings size={20} />
                  <span>Settings</span>
                </button>
              )}
            </div>
            <div className={`fold cd-mute-fold${muteOpen && !muted ? ' open' : ''}`} aria-hidden={!muteOpen || !!muted}>
              <div>
                <div className="cd-mute" role="group" aria-label="Mute for how long">
                  {(
                    [
                      ['hour', 'For an hour'],
                      ['tomorrow', 'Until tomorrow morning'],
                      ['always', 'Until I turn it back on'],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} type="button" className="chip" tabIndex={muteOpen ? 0 : -1} onClick={() => (chat.mute(channel.id, k), setMuteOpen(false), toast({ text: `Muted ${k === 'always' ? 'until you turn it back on' : l.toLowerCase()}. Mentions of you still come through.` }))}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="cd-rows">
              {detailRows.map((r) => (
                <button key={r.id} type="button" className="cd-row" onClick={() => setDetails(r.id)}>
                  <span className="cd-label">{r.label}</span>
                  {r.hint && <span className="cd-hint">{r.hint}</span>}
                  <ChevronRight size={16} className="cd-chev" />
                </button>
              ))}
            </div>
            {channel.kind === 'channel' && p.onLeave && !channel.teamId && (
              <button type="button" className="cd-row danger" onClick={() => setLeaving(true)}>
                <LogOut size={17} />
                <span className="cd-label">Leave {title}</span>
              </button>
            )}
            {details !== 'menu' && (
              <PushScreen title={paneTitle[details]} backLabel="Details" onBack={() => setDetails('menu')} className="chat-pane-screen">
                {pane(details)}
              </PushScreen>
            )}
          </PushScreen>
        )}
        {catchUp && (
          <Sheet title="What you missed" onClose={() => setCatchUp(false)} className="catchme-sheet">
            {p.summaryOff ? (
              <p className="sum-off-text">
                <AlertTriangle size={15} aria-hidden /> {p.summaryOff.text}{' '}
                {p.summaryOff.fix && (
                  <button className="link-btn" onClick={() => (setCatchUp(false), p.summaryOff!.fix!.run())}>
                    {p.summaryOff.fix.label}
                  </button>
                )}
              </p>
            ) : summarizing === 'since' ? (
              <p className="muted catchme-wait">Reading what came in since {whenText(p.since)}…</p>
            ) : (
              <p className="catchme-text">{sinceText ?? 'Nothing to catch up on.'}</p>
            )}
            <button type="button" className="link-btn" onClick={() => (setCatchUp(false), setDetails('summary'))}>
              All summaries of {title}
            </button>
          </Sheet>
        )}
        {overlays}
      </PushScreen>
    );
  }

  /* ---------- Wider screens: the header, the tabs, and the thread beside the conversation ---------- */
  return (
    <section className={`chat-pane view-enter ${thread ? 'with-panel' : ''}`}>
      <div className="chat-main">
        <header className="chat-head">
          <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
            <Menu size={18} />
          </button>
          {p.onBack && (
            <button className="icon-btn back-btn" onClick={p.onBack} aria-label="Back to channels">
              <ArrowLeft size={20} />
            </button>
          )}
          {other && (
            <span className="dm-av">
              <Avatar person={other} size={28} />
              <i className={`presence ${p.presence(other.id)}`} />
            </span>
          )}
          <div className="th-text">
            <h1>
              {channel.category === 'shared' && !other ? <Handshake size={16} /> : channel.private && !other && <Lock size={15} />} {title}
              {other && p.statuses[other.id] && <span className="st-emoji">{p.statuses[other.id].emoji}</span>}
              {muted && <BellOff size={14} className="ctb-muted" aria-label={`Muted${muted === 'always' ? '' : ` until ${whenText(muted)}`}`} />}
            </h1>
            <p>
              {other ? (p.statuses[other.id]?.text ?? other.title) : (channel.topic ?? (client ? `${client.name} ${term.one} channel` : ''))}
              {channel.guests?.length ? ` · ${channel.guests.length} guest${channel.guests.length > 1 ? 's' : ''}` : ''}
              {channel.sharedWith ? ` · shared with ${channel.sharedWith.workspaceName}${channel.sharedWith.status === 'pending' ? ' (waiting)' : ''}` : ''}
            </p>
          </div>
          {p.huddle && !guest && (
            <button className={`ghost-btn sm huddle-btn${channel.huddle?.members.length ? ' live' : ''}${p.huddle.joined ? ' on' : ''}`} onClick={p.huddle.onJoin} title={p.huddle.joined ? 'You’re in this huddle' : 'Talk, right here'} disabled={p.huddle.joined}>
              <Headphones size={14} />
              <span className="lbl">{p.huddle.joined ? 'In the huddle' : channel.huddle?.members.length ? `Join huddle · ${channel.huddle.members.length}` : 'Huddle'}</span>
            </button>
          )}
          {channel.kind === 'channel' && !guest && (
            <button className="chat-members" onClick={p.onSettings} title="People and settings">
              {channel.members.slice(0, 4).map((id) => person(id) && <Avatar key={id} person={person(id)!} size={24} />)}
              <span>{members}</span>
            </button>
          )}
          {channel.kind === 'channel' && !guest && (
            <button className="icon-btn sm" onClick={p.onSettings} title="Channel settings" aria-label="Channel settings">
              <Settings size={16} />
            </button>
          )}
        </header>
        <ConnectionLine />

        <TabBar
          storageKey="channel-tabs"
          className="chan-tabs"
          value={tab}
          onSelect={(id) => setTab(id as Tab)}
          fixed={['messages']}
          items={(
            [
              ['messages', 'Messages', null],
              ['materials', 'Materials', null],
              ['tasks', 'Tasks', lateTasks], // late only
              ['pinned', 'Pinned', null],
              ['summary', 'Summary', null],
              ['about', other ? 'Profile' : 'About', null],
            ] as const
          )
            .filter(([id]) => !guest || id === 'messages' || id === 'materials')
            .map(([id, l, n]) => ({
              id,
              name: l,
              label: (
                <>
                  {l}
                  {id === 'tasks' && n ? <span>{n}</span> : null}
                </>
              ),
            }))}
        />

        <TabPane key={tab}>
          {tab === 'messages' ? (
            <>
              {list}
              {above}
              {composer}
            </>
          ) : (
            pane(tab)
          )}
        </TabPane>
      </div>
      {overlays}
    </section>
  );
}

/** A thread: full screen on phones, beside the conversation on wider screens. Replies keep their own draft. */
function ThreadView(p: {
  root: ChatMessage;
  replies: ChatMessage[];
  ctx: MsgCtx;
  chat: ReturnType<typeof useChatState>;
  channel: Channel;
  title: string;
  users: User[];
  me: string;
  phone: boolean;
  canPost: boolean;
  upload: (f: File | Blob, name?: string) => Promise<ChatFile | null>;
  library?: Library;
  onClose: () => void;
  onSend: (o: Outgoing, also: boolean) => void;
  editing: ChatMessage | null;
  onEdit: (id: string, text: string) => void;
  onCancelEdit: () => void;
}) {
  const [text, setText] = useState('');
  const [also, setAlso] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const { chat, root } = p;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
    chat.markThreadRead(root.id);
  }, [p.replies.length, root.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx = { ...p.ctx };
  const body = (
    <div className="cs-body">
      <Msg m={root} grouped={false} inThread ctx={ctx} />
      <div className="thread-count">{p.replies.length ? `${p.replies.length} repl${p.replies.length === 1 ? 'y' : 'ies'}` : 'No replies yet'}</div>
      {p.replies.map((m) => (
        <Msg key={m.id} m={m} grouped={false} inThread ctx={ctx} />
      ))}
      <div ref={end} />
    </div>
  );
  const composer = p.canPost ? (
    <Composer
      chat={chat}
      draftKey={draftKey(p.channel.id, root.id)}
      text={text}
      setText={setText}
      placeholder="Reply…"
      users={p.users}
      me={p.me}
      phone={p.phone}
      autoFocus
      onSend={(o) => (p.onSend(o, also), setAlso(false))}
      upload={p.upload}
      also={{ label: `Also send to ${p.title}`, on: also, set: setAlso }}
      editing={p.editing}
      onEdit={p.onEdit}
      onCancelEdit={p.onCancelEdit}
      canSchedule={!p.ctx.guest}
      library={p.library}
      className="thread-composer"
    />
  ) : null;
  if (p.phone)
    return (
      <PushScreen
        title={
          <span className="push-title-2">
            Thread<small>{p.title}</small>
          </span>
        }
        backLabel="Back"
        onBack={p.onClose}
        className="thread-push"
        footer={composer}
      >
        {body}
      </PushScreen>
    );
  return (
    <aside className="chat-side">
      <header className="cs-head">
        <strong>Thread</strong>
        <span className="muted small">{p.title}</span>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={p.onClose} aria-label="Close thread">
          <X size={16} />
        </button>
      </header>
      {body}
      {composer && <div className="thread-compose">{composer}</div>}
    </aside>
  );
}

