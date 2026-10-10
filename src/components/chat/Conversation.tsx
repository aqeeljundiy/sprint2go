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
import { authorOf, DayLine, fmtSize, MONTHS, Msg, NewLine, preview, type MsgCtx } from './Message';
import { ConfirmSheet, EmojiGrid, EmojiSheet, ForwardSheet, ReactionRow, WhenSheet, WhoReactedSheet, chanName } from './Sheets';
import { ChannelAbout, PinnedPane, SummaryPane, TasksPane } from './Details';
import { draftKey, dmOther, statusText, useChatState, whenText } from './chatPrefs';
import { msg, phrase, t, tn, type Msg as Words } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtList, fmtNumber } from '../../i18n/format';
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
  tr?: Words; // a line sprint2go writes (a summary, a call link): each reader sees it in their own language
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

const commands = () => [
  { cmd: '/task', hint: t('Make a task: /task Send the deck @Rizky friday') },
  { cmd: '/remind', hint: t('Remind yourself: /remind call Nadia tomorrow') },
];

// The day words /task and /remind understand, in English and Indonesian ("minggu depan" before "minggu", Sunday).
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HARI = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
function dueIn(text: string): { due?: string; rest: string } {
  const s = text.toLowerCase();
  const d = new Date();
  let hit = '';
  if (/\btomorrow\b/.test(s)) (d.setDate(d.getDate() + 1), (hit = 'tomorrow'));
  else if (/\bbesok\b/.test(s)) (d.setDate(d.getDate() + 1), (hit = 'besok'));
  else if (/\bnext week\b/.test(s)) (d.setDate(d.getDate() + 7), (hit = 'next week'));
  else if (/\bminggu depan\b/.test(s)) (d.setDate(d.getDate() + 7), (hit = 'minggu depan'));
  else if (/\btoday\b/.test(s)) hit = 'today';
  else if (/\bhari ini\b/.test(s)) hit = 'hari ini';
  else {
    let i = DAYS.findIndex((x) => new RegExp(`\\b${x}\\b`).test(s));
    let word = DAYS[i];
    if (i < 0) {
      i = HARI.findIndex((x) => new RegExp(`\\b${x}\\b`).test(s));
      word = HARI[i];
    }
    if (i >= 0) {
      d.setDate(d.getDate() + (((i - d.getDay() + 7) % 7) || 7));
      hit = word;
    }
  }
  if (!hit) return { rest: text };
  const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { due, rest: text.replace(new RegExp(`\\s*(by|on|due|pada|hari)?\\s*${hit}\\b`, 'i'), '').trim() };
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
          {shown === 'offline' ? t('Offline. What you write is sent when you’re back.') : t('Connecting…')}
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
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-msg="${p.focusId}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 2200);
      }
      p.onFocused?.();
    }, 250);
    return () => clearTimeout(timer);
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
        <EmptyState icon={<Hash size={22} />} title={t('Pick a channel or person')} text={t('{Project} channels keep every conversation about a {project} in one place.', { project: term.one })} />
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
        who: m.guestEmail ? (channel.guests?.find((g) => g.email === m.guestEmail)?.name ?? t('Guest')) : (person(m.userId)?.name.split(' ')[0] ?? t('Someone')),
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
        task: m.taskId ? p.tasks.find((x) => x.id === m.taskId)?.title : undefined,
        files: m.files?.map((f) => f.name),
      }));
    const text = await ai.catchUp(title, msgs, person(me)?.name.split(' ')[0] ?? 'me');
    if (kind === 'since') setSinceText(text);
    else {
      // Saved in English (Details shows it in each reader's language with periodWords).
      const now = new Date();
      const period = sch === 'daily' ? 'Today' : sch === 'weekly' ? 'This week' : `${MONTHS[now.getMonth()]} ${now.getFullYear()} so far`;
      p.onChannel({ summary: { schedule, post: channel.summary?.post ?? false, history: [{ id: Math.random().toString(36).slice(2), text, period, at: new Date().toISOString(), auto: false, by: me }, ...(channel.summary?.history ?? [])] } });
      if (channel.summary?.post) {
        const words = msg('📝 Summary ({period}): {text}', { period: sch === 'daily' ? phrase('Today') : sch === 'weekly' ? phrase('This week') : phrase('This month so far'), text });
        p.onSend({ text: words.text, tr: words.tr });
      }
    }
    setSummarizing(null);
  };
  const mentioned = (s: string) => users.find((u) => u.id !== me && new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(s));

  /** Slash commands run here; everything else is a message. */
  const runCommand = (raw: string): boolean => {
    if (guest) return false;
    const [cmd, ...rest] = raw.split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case '/task': {
        if (!arg) return true;
        const who = mentioned(arg);
        const { due, rest } = dueIn(arg.replace(/@\w+\s*/g, ''));
        p.onCreateTask({ title: rest.charAt(0).toUpperCase() + rest.slice(1), userId: who?.id ?? me, due });
        return true;
      }
      case '/remind': {
        if (!arg) return true;
        const { due, rest } = dueIn(arg);
        p.onCreateTask({ title: rest.charAt(0).toUpperCase() + rest.slice(1), userId: me, due: due ?? undefined });
        return true;
      }
      case '/kudos': {
        const who = mentioned(arg);
        if (who) p.onSend({ text: arg.replace(/@\w+\s*/, '').trim(), kind: 'kudos', kudosFor: who.id });
        else setKudos({ who: '', text: arg });
        return true;
      }
      case '/meet': {
        const words = msg('📹 Join the call: {url}', { url: p.meetUrl ?? 'https://meet.sprint2go.com/' + channel.name });
        p.onSend({ text: words.text, tr: words.tr });
        return true;
      }
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
      () => toast({ text: t('Couldn’t copy here') }),
    );
  const toggleSave = (m: ChatMessage) => {
    const was = chat.savedItem(m.id);
    if (was) {
      chat.unsave(m.id);
      toastUndo(t('Removed from saved'), () => chat.restoreSaved(was));
    } else {
      chat.save(m);
      toast({ text: t('Saved. Find it under Saved in Chat.'), action: { label: t('Remind me'), run: () => setSub({ kind: 'remind', m }) } });
    }
  };
  const markUnread = (m: ChatMessage) => {
    chat.markUnread(m);
    if (m.parentId && !m.alsoInChannel) return toast({ text: t('Thread marked unread') });
    setHoldRead(true);
    toast({ text: t('Marked unread from here') });
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
    if (threadId !== root) list.push({ label: m.parentId ? t('Open thread') : t('Reply in thread'), icon: MessageSquareReply, run: () => openThread(root) });
    if (!guest && !m.taskId && m.text && m.kind !== 'kudos') list.push({ label: t('Make a task'), icon: ListChecks, run: () => p.onMakeTask(m) });
    if (!guest) {
      list.push(saved ? { label: t('Remove from saved'), icon: BookmarkMinus, run: () => toggleSave(m) } : { label: t('Save'), icon: Bookmark, run: () => toggleSave(m) });
      list.push({ label: t('Remind me'), icon: Clock, hint: saved?.remindAt && !saved.reminded ? t('Set for {when}', { when: whenText(saved.remindAt) }) : undefined, run: () => setSub({ kind: 'remind', m }) });
    }
    if (!mine) list.push({ label: t('Mark unread'), icon: MailOpen, run: () => markUnread(m) });
    if (!guest) list.push({ label: t('Copy link'), icon: Link2, run: () => copy(linkTo(m), t('Link copied')) });
    if (m.text) list.push({ label: t('Copy text'), icon: Copy, run: () => copy(m.text, t('Text copied')) });
    if (!guest && p.onForward && p.channels) list.push({ label: t('Forward'), icon: Forward, run: () => setSub({ kind: 'forward', m }) });
    if (!guest && channel.kind === 'channel' && !m.parentId) list.push({ label: m.pinned ? t('Unpin') : t('Pin to the channel'), icon: Pin, group: 'end', run: () => p.onPin(m.id) });
    if (mine && p.onEdit && m.text && !m.voice && !m.poll && m.kind !== 'kudos') list.push({ label: t('Edit'), icon: Pencil, group: 'end', run: () => setEditing(m) });
    if (mine && !guest) list.push({ label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => setSub({ kind: 'delete', m }) });
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
      {top.length === 0 && <p className="chat-start">{t('This is the start of {name}. Say hello 👋', { name: title })}</p>}
    </div>
  );

  const composer = canPost ? (
    <Composer
      chat={chat}
      draftKey={draftKey(channel.id)}
      text={text}
      setText={setText}
      placeholder={t('Message {name}', { name: title })}
      users={users}
      me={me}
      phone={phone}
      guest={!!guest}
      autoFocus
      commands={guest ? undefined : commands()}
      onCommand={runCommand}
      onSend={(o: Outgoing) => {
        p.onSend(o);
        chatDraft.sent();
        if (o.sendAt) toast({ text: t('Goes {when}', { when: whenText(o.sendAt) }), action: p.onOpenScheduled ? { label: t('See'), run: p.onOpenScheduled } : undefined });
      }}
      upload={upload}
      editing={editing}
      onEdit={(id, words) => (p.onEdit?.(id, words), setEditing(null))}
      onCancelEdit={() => setEditing(null)}
      canSchedule={!guest}
      library={guest ? undefined : p.library}
      onKudos={guest ? undefined : () => setKudos({ who: '', text: '' })}
      onMeetLink={guest ? undefined : () => runCommand('/meet')}
    />
  ) : (
    <div className="chat-locked">
      <Lock size={14} /> {t('Only admins post in #{channel}. You can still react and reply in threads.', { channel: channel.name })}
    </div>
  );

  const above = (
    <>
      {channel.category === 'shared' && !guest && (
        <div className="shared-note">
          <Handshake size={14} />
          <span>
            {channel.guests?.length
              ? t('{names} can read this channel. Keep internal talk in your team’s own channel.', { names: fmtList(channel.guests.map((g) => g.name.split(' ')[0])) })
              : client
                ? t('Shared with {name}. Invite people in channel settings. Keep internal talk in your team’s own channel.', { name: client.name })
                : t('Shared with guests. Invite people in channel settings. Keep internal talk in your team’s own channel.')}
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
                tj('Files shared here use {size} of team storage', { size: <b>{fmtSize(chanFiles.reduce((s2, x) => s2 + x.f.size, 0))}</b> })
              ) : (
                t('Files, links and docs for this channel, in folders if you like')
              )}
              {p.drive.length ? <span className="muted"> · {t('{size} in {name}’s Drive folder', { size: fmtSize(p.drive.reduce((s2, d) => s2 + d.size, 0)), name: client?.name ?? '' })}</span> : null}
            </p>
            <ChannelMaterials
              channel={channel}
              users={users}
              me={me}
              chatFiles={[
                ...chanFiles.map(({ f, m }) => ({ key: `file:${m.id}:${f.name}`, name: f.name, type: f.type, size: f.size, url: f.url, who: authorOf(m, { me, users, channel }).first, at: m.at, where: t('in chat') })),
                ...p.drive.map((d) => ({ key: `drive:${d.id}`, name: d.name, type: d.kind === 'image' ? 'image/' : d.kind === 'video' ? 'video/' : 'application/', size: d.size, url: undefined, who: '', at: d.modified, where: client ? t('in {name}’s Drive folder', { name: client.name }) : t('in Drive') })),
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
          <EmojiSheet title={t('React')} onPick={(e) => p.onReact(sub.m.id, e)} onClose={() => setSub(null)} />
        ) : (
          <Popover anchor={anchorRef} open onClose={() => setSub(null)} width={320} title={t('React')}>
            <EmojiGrid onPick={(e) => (setSub(null), p.onReact(sub.m.id, e))} />
          </Popover>
        ))}
      {sub?.kind === 'remind' && (
        <WhenSheet
          title={t('Remind me')}
          kind="remind"
          note={<p className="when-note">{t('It’s saved, and you get a notification then: “{text}”', { text: preview(sub.m).slice(0, 70) })}</p>}
          onPick={(at) => {
            chat.save(sub.m, at);
            toast({ text: t('Saved. You’ll be reminded {when}.', { when: whenText(at) }) });
          }}
          onClose={() => setSub(null)}
        />
      )}
      {sub?.kind === 'forward' && p.onForward && p.channels && <ForwardSheet m={sub.m} channels={p.channels} users={users} me={me} onForward={(to, note) => p.onForward?.(sub.m, to, note)} onClose={() => setSub(null)} />}
      {sub?.kind === 'who' && <WhoReactedSheet m={sub.m} first={sub.emoji ?? ''} users={users} me={me} channel={channel} onClose={() => setSub(null)} />}
      {sub?.kind === 'delete' && <ConfirmSheet title={t('Delete this message?')} text={channel.kind === 'dm' ? t('It’s gone for both of you, with any replies in its thread.') : t('Everyone in {name} stops seeing it, with any replies in its thread.', { name: title })} yes={t('Delete')} onYes={() => p.onDelete(sub.m.id)} onClose={() => setSub(null)} />}
      {kudos && (
        <Sheet
          title={t('🙌 Give kudos')}
          onClose={() => setKudos(null)}
          footer={
            <>
              <span className="muted small sheet-foot-note">{t('Shows on everyone’s Home under Wins this week.')}</span>
              <button className="primary-btn" disabled={!kudos.who} onClick={() => (p.onSend({ text: kudos.text.trim(), kind: 'kudos', kudosFor: kudos.who }), setKudos(null))}>
                {t('Send kudos')}
              </button>
            </>
          }
        >
          <div className="kudos-form">
            <Select value={kudos.who || null} onChange={(v) => setKudos({ ...kudos, who: v })} placeholder={t('Who?')} label={t('Who gets kudos')} options={users.filter((u) => u.id !== me).map((u) => ({ ...personOption(u), label: u.name, icon: <Avatar person={u} size={22} /> }))} />
            <input className="is-input" value={kudos.text} onChange={(e) => setKudos({ ...kudos, text: e.target.value })} placeholder={t('For what? e.g. saving the KopiKita invoice')} aria-label={t('For what')} />
          </div>
        </Sheet>
      )}
      {leaving && (
        <ConfirmSheet title={t('Leave {name}?', { name: title })} text={channel.private ? t('It’s private: someone in it has to add you back.') : t('You can join again from Browse channels.')} yes={t('Leave')} onYes={() => p.onLeave?.()} onClose={() => setLeaving(false)} />
      )}
    </>
  );

  /* ---------- Phones: one header row, the messages, the box; details and threads push over it ---------- */
  if (phone && p.onBack) {
    const subtitle = other ? (p.statuses[other.id] ? `${p.statuses[other.id].emoji} ${statusText(p.statuses[other.id])}` : (other.title ?? '')) : guest ? (channel.topic ?? '') : tn(members, '{n} member', '{n} members');
    const detailRows: { id: Exclude<Tab, 'messages'> | 'people'; label: string; hint?: string }[] = [
      ...(other ? [] : [{ id: 'people' as const, label: t('People'), hint: channel.guests?.length ? t('{team} on the team, {guests}', { team: fmtNumber(channel.members.length), guests: tn(channel.guests.length, '{n} guest', '{n} guests') }) : undefined }]),
      { id: 'materials', label: t('Files and links') },
      ...(guest ? [] : [{ id: 'pinned' as const, label: t('Pinned'), hint: pinned.length ? undefined : t('Nothing yet') }]),
      ...(guest ? [] : [{ id: 'tasks' as const, label: t('Tasks'), hint: lateTasks ? tn(lateTasks, '{n} late', '{n} late') : undefined }]),
      ...(guest ? [] : [{ id: 'summary' as const, label: t('Summaries') }]),
      ...(guest ? [] : [{ id: 'about' as const, label: other ? t('Profile') : t('About') }]),
    ];
    const paneTitle: Record<string, string> = { people: t('People'), materials: t('Files and links'), pinned: t('Pinned'), tasks: t('Tasks'), summary: t('Summaries'), about: other ? t('Profile') : t('About') };
    return (
      <PushScreen
        className="chat-push"
        onBack={p.onBack}
        title={
          <button type="button" className="chan-title-btn" onClick={() => !guest && setDetails('menu')} aria-label={guest ? title : t('{name}: details', { name: title })} disabled={!!guest}>
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
                {muted && <BellOff size={13} className="ctb-muted" aria-label={t('Muted')} />}
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
            {/* Slack's order: the AI summary, then the huddle. */}
            {!guest && (
              <button type="button" className="icon-btn" onClick={() => (setCatchUp(true), !sinceText && !summarizing && !p.summaryOff && void summarize('since'))} aria-label={t('Catch me up: what I missed here')}>
                <Sparkles size={22} />
              </button>
            )}
            {p.huddle && !guest && (
              <button type="button" className={`icon-btn huddle-icon${channel.huddle?.members.length ? ' live' : ''}${p.huddle.joined ? ' on' : ''}`} onClick={p.huddle.joined ? p.huddle.onOpen : p.huddle.onJoin} aria-label={p.huddle.joined ? t('Open the huddle') : channel.huddle?.members.length ? t('Join the huddle') : t('Start a huddle')}>
                <Headphones size={22} />
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
          <PushScreen title={t('Details')} backLabel={title.length > 14 ? t('Back') : title} onBack={() => setDetails(null)} className="chat-details">
            <div className="cd-hero">
              {other ? <Avatar person={other} size={56} /> : <span className="cd-icon">{channel.private ? <Lock size={24} /> : channel.category === 'shared' ? <Handshake size={24} /> : <Hash size={24} />}</span>}
              <strong>{other ? other.name : title}</strong>
              <span className="muted">{other ? other.title : (channel.topic ?? (client ? t('{name} {project} channel', { name: client.name, project: term.one }) : ''))}</span>
            </div>
            <div className="cdt-actions">
              <button type="button" onClick={() => (muted ? (chat.unmute(channel.id), toast({ text: t('Notifications back on') })) : setMuteOpen((o) => !o))} className={muted || muteOpen ? 'on' : ''} aria-expanded={!muted ? muteOpen : undefined}>
                {muted ? <BellOff size={20} /> : <Bell size={20} />}
                <span>{muted ? t('Unmute') : t('Mute')}</span>
              </button>
              <button type="button" onClick={() => copy(`${location.origin}${routeBase}/chat?ws=${encodeURIComponent(channel.workspaceId)}&id=${encodeURIComponent(channel.id)}`, t('Link copied'))}>
                <Link2 size={20} />
                <span>{t('Copy link')}</span>
              </button>
              {channel.kind === 'channel' && (
                <button type="button" onClick={p.onSettings}>
                  <Settings size={20} />
                  <span>{t('Settings')}</span>
                </button>
              )}
            </div>
            <div className={`fold cd-mute-fold${muteOpen && !muted ? ' open' : ''}`} aria-hidden={!muteOpen || !!muted}>
              <div>
                <div className="cd-mute" role="group" aria-label={t('Mute for how long')}>
                  {(
                    [
                      ['hour', t('For an hour'), t('Muted for an hour. Mentions of you still come through.')],
                      ['tomorrow', t('Until tomorrow morning'), t('Muted until tomorrow morning. Mentions of you still come through.')],
                      ['always', t('Until I turn it back on'), t('Muted until you turn it back on. Mentions of you still come through.')],
                    ] as const
                  ).map(([k, l, done]) => (
                    <button key={k} type="button" className="chip" tabIndex={muteOpen ? 0 : -1} onClick={() => (chat.mute(channel.id, k), setMuteOpen(false), toast({ text: done }))}>
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
                <span className="cd-label">{t('Leave {name}', { name: title })}</span>
              </button>
            )}
            {details !== 'menu' && (
              <PushScreen title={paneTitle[details]} backLabel={t('Details')} onBack={() => setDetails('menu')} className="chat-pane-screen">
                {pane(details)}
              </PushScreen>
            )}
          </PushScreen>
        )}
        {catchUp && (
          <Sheet title={t('What you missed')} onClose={() => setCatchUp(false)} className="catchme-sheet">
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
              <p className="muted catchme-wait">{t('Reading what came in since {when}…', { when: whenText(p.since) })}</p>
            ) : (
              <p className="catchme-text">{sinceText ?? t('Nothing to catch up on.')}</p>
            )}
            <button type="button" className="link-btn" onClick={() => (setCatchUp(false), setDetails('summary'))}>
              {t('All summaries of {name}', { name: title })}
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
          <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label={t('Open menu')}>
            <Menu size={18} />
          </button>
          {p.onBack && (
            <button className="icon-btn back-btn" onClick={p.onBack} aria-label={t('Back to channels')}>
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
              {muted && <BellOff size={14} className="ctb-muted" aria-label={muted === 'always' ? t('Muted') : t('Muted until {when}', { when: whenText(muted) })} />}
            </h1>
            <p>
              {other ? (p.statuses[other.id] ? statusText(p.statuses[other.id]) : other.title) : (channel.topic ?? (client ? t('{name} {project} channel', { name: client.name, project: term.one }) : ''))}
              {channel.guests?.length ? ` · ${tn(channel.guests.length, '{n} guest', '{n} guests')}` : ''}
              {channel.sharedWith ? ` · ${channel.sharedWith.status === 'pending' ? t('shared with {name} (waiting)', { name: channel.sharedWith.workspaceName }) : t('shared with {name}', { name: channel.sharedWith.workspaceName })}` : ''}
            </p>
          </div>
          {p.huddle && !guest && (
            <button className={`ghost-btn sm huddle-btn${channel.huddle?.members.length ? ' live' : ''}${p.huddle.joined ? ' on' : ''}`} onClick={p.huddle.onJoin} title={p.huddle.joined ? t('You’re in this huddle') : t('Talk, right here')} disabled={p.huddle.joined}>
              <Headphones size={14} />
              <span className="lbl">{p.huddle.joined ? t('In the huddle') : channel.huddle?.members.length ? t('Join huddle · {n}', { n: fmtNumber(channel.huddle.members.length) }) : t('Huddle')}</span>
            </button>
          )}
          {channel.kind === 'channel' && !guest && (
            <button className="chat-members" onClick={p.onSettings} title={t('People and settings')}>
              {channel.members.slice(0, 4).map((id) => person(id) && <Avatar key={id} person={person(id)!} size={24} />)}
              <span>{members}</span>
            </button>
          )}
          {channel.kind === 'channel' && !guest && (
            <button className="icon-btn sm" onClick={p.onSettings} title={t('Channel settings')} aria-label={t('Channel settings')}>
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
              ['messages', t('Messages'), null],
              ['materials', t('Materials'), null],
              ['tasks', t('Tasks'), lateTasks], // late only
              ['pinned', t('Pinned'), null],
              ['summary', t('Summary'), null],
              ['about', other ? t('Profile') : t('About'), null],
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
      <div className="thread-count">{p.replies.length ? tn(p.replies.length, '{n} reply', '{n} replies') : t('No replies yet')}</div>
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
      placeholder={t('Reply…')}
      users={p.users}
      me={p.me}
      phone={p.phone}
      autoFocus
      onSend={(o) => (p.onSend(o, also), setAlso(false))}
      upload={p.upload}
      also={{ label: t('Also send to {name}', { name: p.title }), on: also, set: setAlso }}
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
            {t('Thread')}
            <small>{p.title}</small>
          </span>
        }
        backLabel={t('Back')}
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
        <strong>{t('Thread')}</strong>
        <span className="muted small">{p.title}</span>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={p.onClose} aria-label={t('Close thread')}>
          <X size={16} />
        </button>
      </header>
      {body}
      {composer && <div className="thread-compose">{composer}</div>}
    </aside>
  );
}

