import { useMemo, useRef, useState, type ReactNode } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { term } from '../terms';
import { FolderPlus, ChevronUp, Handshake, ChevronDown, ChevronRight, Check, LayoutList, Pencil, Compass, Hash, Lock, MoreHorizontal, Plus, Settings, Star, Trash2, Users, X, Headphones, BellOff, Bell, Link2, LogOut, MailOpen, CheckCheck, Inbox, MessagesSquare, SendHorizontal, Bookmark, ArrowLeft, ArrowRight, EyeOff, SlidersHorizontal, PenLine } from 'lucide-react';
import type { Channel, ChannelCategory, ChatLayout, ChatMessage, ChatSection, ChatView as ChatViewDef, Status, Team, User } from '../types';
import { usePersisted } from '../settings';
import { Avatar } from './Avatar';
import { Badge } from './ui/Person';
import { Layer } from './ui/Layer';
import { Popover } from './ui/Popover';
import { PeoplePicker } from './ui/PeoplePicker';
import { Select } from './ui/Select';
import { CATEGORY_NAME, CATEGORY_ONE } from './ChannelDialog';
import { Sheet } from './ui/Sheet';
import { ActionSheet, type SheetAction } from './ui/ActionSheet';
import { useLongPress } from './ui/useLongPress';
import { SquarePen, Search as SearchIcon } from 'lucide-react';
import { useAppSettings, useCreateAction, useTitleMenu } from '../mobile/chrome';
import { routeBase } from '../tryOut';
import { toast } from '../toast';
import { dmOther, followedThreads, isMutedValue, readFallback, shortTime, TILE_NAMES, useChatState, whenText, type ChatState, type TileId } from './chat/chatPrefs';
import { preview } from './chat/Message';
import { ConfirmSheet, chanName } from './chat/Sheets';

export type Presence = 'active' | 'away' | 'meeting';
/** Pages of Chat besides the conversations: shown in the main area on wider screens, pushed full screen on phones. */
export type ChatPage = 'catchup' | 'threads' | 'drafts' | 'saved';

// "In a meeting" comes from the calendar on its own; people only set Focus, Away or their own words.
const STATUS_PRESETS: Status[] = [
  { emoji: '🎯', text: 'Focusing, slow to reply' },
  { emoji: '🌴', text: 'Away' },
];

const ALL_CATS: ChannelCategory[] = ['client', 'shared', 'team', 'project', 'social'];
/** The company layout with every built-in section present. */
export function fullLayout(l: ChatLayout | undefined): ChatLayout {
  const base = l?.sections?.length ? l.sections : [];
  const missing = ALL_CATS.filter((c) => !base.some((s) => s.category === c)).map((c) => ({ id: c, name: CATEGORY_NAME[c], category: c }));
  return { sections: [...base, ...missing], placement: l?.placement ?? {} };
}
/** Which section of the company layout a channel sits in. */
export function sectionIdOf(l: ChatLayout, c: Channel) {
  const placed = l.placement[c.id];
  if (placed && l.sections.some((s) => s.id === placed)) return placed;
  return l.sections.find((s) => s.category === (c.category ?? 'project'))!.id;
}
/** Everyone a section's access gives (people plus the current members of its teams). */
export function sectionPeople(sec: ChatSection, teams: Team[]) {
  return [...new Set([...(sec.access?.userIds ?? []), ...teams.filter((t) => sec.access?.teamIds.includes(t.id)).flatMap((t) => t.members)])];
}

/** Per conversation: its last message, what's unread, mentions of me, and a draft. */
export type ConvoInfo = { last?: ChatMessage; unread: number; mentions: number; draft?: string; muted: boolean };
export function convoInfo(channels: Channel[], messages: ChatMessage[], me: string, myFirst: string, chat: ChatState): Record<string, ConvoInfo> {
  const out: Record<string, ConvoInfo> = {};
  const at = new RegExp(`@${myFirst.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}\\b`, 'i');
  const ids = new Set(channels.map((c) => c.id));
  for (const c of channels) out[c.id] = { unread: 0, mentions: 0, draft: chat.drafts[c.id]?.text, muted: isMutedValue(chat.muted[c.id]) };
  const fallback = readFallback();
  for (const m of messages) {
    if (!ids.has(m.channelId) || m.sendAt || (m.parentId && !m.alsoInChannel)) continue;
    const o = out[m.channelId];
    if (!o.last || m.at > o.last.at) o.last = m;
    if (m.userId === me || m.kind === 'celebration') continue;
    if (m.at > (chat.read[m.channelId] ?? fallback)) {
      o.unread++;
      if (at.test(m.text)) o.mentions++;
    }
  }
  return out;
}

/* ---------------- Sidebar (wider screens) and the chat list (phones) ---------------- */

type BuiltIn = 'default' | 'unread' | 'recent';

interface SidebarProps {
  channels: Channel[]; // this workspace's channels I can see (member, or public)
  messages: ChatMessage[]; // their messages (last message, unread, mentions, threads)
  users: User[];
  me: string;
  myFirst: string;
  workspaceId: string;
  current: string | null;
  statuses: Record<string, Status>;
  presence: (id: string) => Presence;
  /** phone: the whole screen (tiles, unread on top, two-line rows); side: the sidebar on wider screens. */
  variant: 'side' | 'phone';
  page?: ChatPage | null; // the page open in the main area (wider screens)
  onPage: (p: ChatPage) => void;
  onOpen: (id: string) => void;
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  onNewChannel?: () => void; // missing: only admins start channels in this company
  onNewDm: (userId: string) => void;
  onStatus: (s: Status | null) => void;
  canManage: (c: Channel) => boolean; // owner or admin: may change the channel's category
  onMove: (id: string, category: ChannelCategory) => void;
  onSettings: (id: string) => void;
  isAdmin: boolean;
  layout?: ChatLayout; // the company's Default sidebar
  onLayout: (l: ChatLayout) => void;
  teams: Team[];
  onSectionAccess: (sectionId: string, access: { userIds: string[]; teamIds: string[] }) => void;
}

export function ChatSidebar(p: SidebarProps) {
  const phone = p.variant === 'phone';
  const chat = useChatState(p.me);
  const [views, setViews] = usePersisted<ChatViewDef[]>(`s2g-chat-views:${p.me}:${p.workspaceId}`, []);
  const [viewId, setViewId] = usePersisted<string>(`s2g-chat-view:${p.me}:${p.workspaceId}`, 'default');
  const [starred, setStarred] = usePersisted<string[]>(`s2g-chat-starred:${p.me}:${p.workspaceId}`, []);
  const [collapsed, setCollapsed] = usePersisted<string[]>(`s2g-chat-collapsed:${p.me}:${p.workspaceId}`, []);
  const [editing, setEditing] = useState<ChatViewDef | null>(null);
  const [addingDm, setAddingDm] = useState(false);
  const [newMsg, setNewMsg] = useState(false); // the phone's create button: who to write to
  const [browsing, setBrowsing] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ id: string; at?: { x: number; y: number }; anchor?: HTMLElement } | null>(null);
  const [rowSub, setRowSub] = useState<{ kind: 'mute' | 'move' | 'leave'; id: string; anchor?: HTMLElement; at?: { x: number; y: number } } | null>(null);
  const [tileMenu, setTileMenu] = useState<TileId | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  // The company's Default layout: admins add, rename and order sections and place channels for everyone.
  const [newSection, setNewSection] = useState<{ name: string; channelId?: string } | null>(null);
  const [secMenu, setSecMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const secAnchor = useRef<HTMLElement | null>(null);
  const layout = fullLayout(p.layout);
  const sectionOf = (c: Channel) => sectionIdOf(layout, c);
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const statusBtn = useRef<HTMLButtonElement>(null);

  const mine = p.channels.filter((c) => c.members.includes(p.me) && !c.archived);
  const joinable = p.channels.filter((c) => c.kind === 'channel' && !c.private && !c.archived && !c.members.includes(p.me));
  const rooms = mine.filter((c) => c.kind === 'channel');
  const dms = mine.filter((c) => c.kind === 'dm');
  const dmWith = new Set(dms.flatMap((d) => d.members));
  const star = new Set(starred);
  const myStatus = p.statuses[p.me];
  const custom = views.find((v) => v.id === viewId);
  const active: BuiltIn | 'custom' = custom ? 'custom' : (['default', 'unread', 'recent'].includes(viewId) ? viewId : 'default') as BuiltIn;
  const info = useMemo(() => convoInfo(mine, p.messages, p.me, p.myFirst, chat), [mine.map((c) => c.id).join(), p.messages, p.me, p.myFirst, chat.read, chat.drafts, chat.muted]); // eslint-disable-line react-hooks/exhaustive-deps
  const recency = (c: Channel) => info[c.id]?.last?.at ?? '';

  /** Admins can arrange everything; a channel's owner can still change its kind (its built-in section). */
  const canPlace = (c: Channel, sec: ChatSection) => p.isAdmin || (!!sec.category && p.canManage(c));
  const placeIn = (channelId: string, sectionId: string) => {
    const c = rooms.find((x) => x.id === channelId);
    const sec = layout.sections.find((x) => x.id === sectionId);
    if (!c || !sec || !canPlace(c, sec) || sectionOf(c) === sectionId) return;
    const placement = { ...layout.placement };
    if (sec.category) {
      delete placement[channelId];
      if ((c.category ?? 'project') !== sec.category) p.onMove(channelId, sec.category);
    } else placement[channelId] = sectionId;
    p.onLayout({ ...layout, placement });
  };
  const moveInView = (id: string, to: string | null) => {
    if (!custom) return;
    setViews(views.map((v) => (v.id === custom.id ? { ...custom, sections: custom.sections.map((x) => ({ ...x, channelIds: x.id === to ? [...new Set([...x.channelIds, id])] : x.channelIds.filter((y) => y !== id) })) } : v)));
  };
  const saveRename = () => {
    if (renaming?.name.trim()) p.onLayout({ ...layout, sections: layout.sections.map((x) => (x.id === renaming.id ? { ...x, name: renaming.name.trim() } : x)) });
    setRenaming(null);
  };
  const createSection = () => {
    if (!newSection?.name.trim()) return setNewSection(null);
    const id = 'sec-' + Date.now().toString(36);
    p.onLayout({
      sections: [{ id, name: newSection.name.trim() }, ...layout.sections],
      placement: newSection.channelId ? { ...layout.placement, [newSection.channelId]: id } : layout.placement,
    });
    setNewSection(null);
  };
  const moveSection = (id: string, by: -1 | 1) => {
    const i = layout.sections.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= layout.sections.length) return;
    const n = [...layout.sections];
    [n[i], n[j]] = [n[j], n[i]];
    p.onLayout({ ...layout, sections: n });
  };
  const deleteSection = (id: string) => {
    const placement = Object.fromEntries(Object.entries(layout.placement).filter(([, s]) => s !== id));
    p.onLayout({ sections: layout.sections.filter((x) => x.id !== id), placement });
  };
  const toggle = (key: string) => setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);

  const viewOptions = [
    { value: 'default', label: 'Company default', hint: 'Sections your admins set for everyone', group: 'Built in' },
    { value: 'unread', label: 'Unread first', hint: 'What needs you on top', group: 'Built in' },
    { value: 'recent', label: 'Recent', hint: 'Latest activity first', group: 'Built in' },
    ...views.map((v) => ({ value: v.id, label: v.name, hint: `${v.sections.length} section${v.sections.length === 1 ? '' : 's'}`, group: 'Your views' })),
    { value: '__new', label: 'Create a view…', hint: 'Your own sections and channels', group: 'Your views', icon: <Plus size={14} /> },
  ];
  const pickView = (v: string) => {
    if (v === '__new') setEditing({ id: 'v-' + Date.now().toString(36), name: 'My view', sections: [{ id: 's1', name: 'Focus', channelIds: [] }], showRest: true });
    else setViewId(v);
  };

  // The phone shell: New message on the create button, the view in the title switcher, status and tiles in its settings.
  useCreateAction('chat', phone && { label: 'New message', icon: SquarePen, run: () => setNewMsg(true), more: [...(p.onNewChannel ? [{ label: 'New channel', icon: Hash, run: p.onNewChannel }] : []), ...(joinable.length ? [{ label: 'Browse channels', icon: Compass, run: () => setBrowsing(true) }] : [])] });
  // On phones the title is the view: "Chat" for the company's sections.
  useTitleMenu('chat', phone && { label: 'Chat view', value: custom ? custom.id : active, options: viewOptions.map((o) => (o.value === 'default' ? { ...o, label: 'Chat', hint: 'Your company’s sections' } : o)), onChange: pickView });
  useAppSettings('chat', phone && { id: 'status', label: 'Your status', hint: myStatus ? `${myStatus.emoji} ${myStatus.text}` : 'Let people know if you’re focusing or away', render: () => <StatusPicker status={p.statuses[p.me]} onStatus={p.onStatus} /> });
  useAppSettings('chat', phone && { id: 'tiles', label: 'Tiles on top', hint: 'Which ones show, and in what order', render: () => <TilesEditor me={p.me} /> });

  /* ---------- tiles: what to act on, at a glance ---------- */
  const unreadConvos = mine.filter((c) => info[c.id]?.unread && !info[c.id].muted);
  const threads = useMemo(() => followedThreads(p.messages.filter((m) => mine.some((c) => c.id === m.channelId)), p.me, p.myFirst, chat), [p.messages, p.me, p.myFirst, chat.read]); // eslint-disable-line react-hooks/exhaustive-deps
  const newReplies = threads.reduce((n, t) => n + t.unread, 0);
  const draftCount = Object.keys(chat.drafts).filter((k) => mine.some((c) => k === c.id || k.startsWith(`${c.id}/`))).length;
  const scheduled = p.messages.filter((m) => m.sendAt && m.userId === p.me).length;
  const nextReminder = chat.saved.filter((s) => s.remindAt && !s.reminded).sort((a, b) => a.remindAt!.localeCompare(b.remindAt!))[0];
  const live = mine.filter((c) => c.huddle?.members.length);
  const tileState: Record<TileId, { line: string; hot: boolean; hidden?: boolean; icon: ReactNode }> = {
    catchup: { icon: <Inbox size={18} />, line: unreadConvos.length ? `${unreadConvos.length} new` : 'Caught up', hot: unreadConvos.length > 0 },
    threads: { icon: <MessagesSquare size={18} />, line: newReplies ? `${newReplies} new ${newReplies === 1 ? 'reply' : 'replies'}` : 'Caught up', hot: newReplies > 0 },
    drafts: { icon: <SendHorizontal size={18} />, line: [draftCount ? `${draftCount} ${draftCount === 1 ? 'draft' : 'drafts'}` : '', scheduled ? `${scheduled} to send` : ''].filter(Boolean).join(', ') || 'Nothing waiting', hot: false },
    saved: { icon: <Bookmark size={18} />, line: nextReminder ? `Reminder ${whenText(nextReminder.remindAt!)}` : chat.saved.length ? 'Your saved messages' : 'Nothing saved', hot: false },
    live: { icon: <Headphones size={18} />, line: live.length ? `${chanName(live[0], p.users, p.me)}${live.length > 1 ? ` and ${live.length - 1} more` : ''}` : '', hot: true, hidden: !live.length },
  };
  const tiles = chat.tiles.order.filter((t) => !chat.tiles.hidden.includes(t) && !tileState[t].hidden);
  const openTile = (t: TileId) => (t === 'live' ? live[0] && p.onOpen(live[0].id) : p.onPage(t));

  /* ---------- one conversation in the list ---------- */
  const rowActions = (c: Channel): SheetAction[] => {
    const i = info[c.id];
    const mutedTill = chat.mutedUntil(c.id);
    const list: SheetAction[] = [];
    if (i?.unread) list.push({ label: 'Mark read', icon: CheckCheck, run: () => chat.markRead(c.id) });
    else if (i?.last && i.last.userId !== p.me) list.push({ label: 'Mark unread', icon: MailOpen, run: () => chat.markUnread(i.last!) });
    list.push(mutedTill ? { label: 'Unmute', icon: Bell, hint: mutedTill === 'always' ? undefined : `Muted until ${whenText(mutedTill)}`, run: () => chat.unmute(c.id) } : { label: 'Mute…', icon: BellOff, run: () => setRowSub({ kind: 'mute', id: c.id, anchor: rowMenu?.anchor, at: rowMenu?.at }) });
    list.push({ label: star.has(c.id) ? 'Remove from Starred' : 'Star', icon: Star, run: () => setStarred(star.has(c.id) ? starred.filter((x) => x !== c.id) : [...starred, c.id]) });
    list.push({ label: 'Copy link', icon: Link2, run: () => navigator.clipboard?.writeText(`${location.origin}${routeBase}/chat?ws=${encodeURIComponent(c.workspaceId)}&id=${encodeURIComponent(c.id)}`).then(() => toast({ text: 'Link copied' }), () => toast({ text: 'Couldn’t copy here' })) });
    if (c.kind === 'channel' && (custom || layout.sections.some((sec) => canPlace(c, sec)))) list.push({ label: 'Move to section…', icon: LayoutList, run: () => setRowSub({ kind: 'move', id: c.id, anchor: rowMenu?.anchor, at: rowMenu?.at }) });
    if (c.kind === 'channel') list.push({ label: 'Channel settings', icon: Settings, run: () => p.onSettings(c.id) });
    if (c.kind === 'channel' && !c.teamId) list.push({ label: 'Leave', icon: LogOut, danger: true, group: 'end', run: () => setRowSub({ kind: 'leave', id: c.id }) });
    return list;
  };
  const row = (c: Channel) => <ConvoRow key={c.id} c={c} p={p} info={info[c.id]} phone={phone} starred={star.has(c.id)} draggable={c.kind === 'channel' && (active === 'custom' || (active === 'default' && (p.isAdmin || p.canManage(c))))} onDragState={setDropOn} onMenu={(where) => setRowMenu({ id: c.id, ...where })} />;

  const section = (key: string, title: ReactNode, list: Channel[], extra?: ReactNode, drop?: (channelId: string) => void, mineId?: string) => {
    // Empty sections still show while dragging, so a channel can be dropped into them.
    if (!list.length && !extra && !(drop && dropOn !== null)) return null;
    const closed = collapsed.includes(key);
    const dropProps = drop
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes('text/s2g-channel')) return;
            e.preventDefault();
            if (dropOn !== key) setDropOn(key);
          },
          onDragLeave: (e: React.DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropOn((d) => (d === key ? '' : d)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setDropOn(null);
            const id = e.dataTransfer.getData('text/s2g-channel');
            if (id) drop(id);
          },
        }
      : {};
    const n = list.reduce((sum, c) => sum + (info[c.id]?.muted ? 0 : (info[c.id]?.unread ?? 0)), 0);
    return (
      <div key={key} className={`chat-section ${dropOn === key ? 'drop-on' : ''}`} {...dropProps}>
        {renaming && renaming.id === mineId ? (
          <input
            className="sec-rename sb-label"
            autoFocus
            value={renaming.name}
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
            onBlur={saveRename}
            onKeyDown={(e) => (e.key === 'Enter' ? saveRename() : e.key === 'Escape' && setRenaming(null))}
          />
        ) : (
          <SectionHead
            title={title}
            closed={closed}
            count={closed && n ? n : 0}
            onToggle={() => toggle(key)}
            onMenu={
              mineId
                ? (el) => {
                    secAnchor.current = el;
                    setSecMenu(mineId);
                  }
                : undefined
            }
            phone={phone}
          />
        )}
        <div className={`fold ${closed ? '' : 'open'}`} aria-hidden={closed}>
          <nav className="nav">
            {list.map(row)}
            {extra}
          </nav>
        </div>
      </div>
    );
  };

  // The channel list for the chosen view.
  const starredList = [...rooms, ...dms].filter((c) => star.has(c.id));
  // Phones: unread direct messages and mentions first, each only once.
  const topDms = phone ? dms.filter((c) => info[c.id]?.unread && !info[c.id].muted && !star.has(c.id)).sort((a, b) => recency(b).localeCompare(recency(a))) : [];
  const topMentions = phone ? rooms.filter((c) => info[c.id]?.mentions && !star.has(c.id)).sort((a, b) => recency(b).localeCompare(recency(a))) : [];
  const onTop = new Set([...topDms, ...topMentions].map((c) => c.id));
  const restRooms = rooms.filter((c) => !star.has(c.id) && !onTop.has(c.id));
  let body: ReactNode;
  if (active === 'default') {
    body = layout.sections.map((sec) =>
      section(
        sec.id,
        sec.name,
        restRooms.filter((c) => sectionOf(c) === sec.id),
        !phone && !sec.category && p.isAdmin && !rooms.some((c) => sectionOf(c) === sec.id) ? <p className="muted small sec-empty sb-label">Drag channels here, or use a channel’s … menu.</p> : undefined,
        (id) => placeIn(id, sec.id),
        p.isAdmin ? sec.id : undefined,
      ),
    );
  } else if (active === 'unread') {
    const list = [...restRooms].sort((a, b) => (info[b.id]?.unread ?? 0) - (info[a.id]?.unread ?? 0) || recency(b).localeCompare(recency(a)));
    body = [section('u-unread', 'Unread', list.filter((c) => info[c.id]?.unread)), section('u-rest', 'Everything else', list.filter((c) => !info[c.id]?.unread))];
  } else if (active === 'recent') {
    body = section('recent', 'Most recent first', [...restRooms].sort((a, b) => recency(b).localeCompare(recency(a))));
  } else if (custom) {
    const used = new Set(custom.sections.flatMap((s) => s.channelIds));
    body = [
      ...custom.sections.map((s) => section(`${custom.id}:${s.id}`, s.name, restRooms.filter((c) => s.channelIds.includes(c.id)), undefined, (id) => moveInView(id, s.id))),
      custom.showRest ? section(`${custom.id}:rest`, 'Other channels', restRooms.filter((c) => !used.has(c.id)), undefined, (id) => moveInView(id, null)) : null,
    ];
  }
  const menuChannel = p.channels.find((c) => c.id === rowMenu?.id);
  const subChannel = p.channels.find((c) => c.id === rowSub?.id);

  const counts: Partial<Record<ChatPage, number>> = { catchup: unreadConvos.length, threads: newReplies };
  const pages: { id: ChatPage; label: string; icon: ReactNode; line: string; n: number }[] = (['catchup', 'threads', 'drafts', 'saved'] as const).map((id) => ({ id, label: TILE_NAMES[id], icon: tileState[id].icon, line: tileState[id].line, n: counts[id] ?? 0 }));

  return (
    <>
      {!phone && (
        <>
          <button ref={statusBtn} className="status-btn sb-label" onClick={() => setStatusOpen(true)}>
            <span className="st-emoji big">{myStatus?.emoji ?? '🙂'}</span>
            <span className="sb-label">{myStatus?.text ?? 'Set a status'}</span>
          </button>
          <Popover anchor={statusBtn} open={statusOpen} onClose={() => setStatusOpen(false)} width={280} title="Your status">
            <StatusPicker status={myStatus} onStatus={(s) => (p.onStatus(s), setStatusOpen(false))} />
          </Popover>
          <nav className="nav chat-pages" aria-label="Chat pages">
            {pages.map((pg) => (
              <button key={pg.id} className={`nav-item ${p.page === pg.id ? 'active' : ''}`} onClick={() => p.onPage(pg.id)} title={pg.line}>
                {pg.icon}
                <span className="sb-label">{pg.label}</span>
                {pg.n ? <span className="count soft">{pg.n}</span> : null}
              </button>
            ))}
            {live.map((c) => (
              <button key={c.id} className="nav-item live-row" onClick={() => p.onOpen(c.id)} title={`Huddle in ${chanName(c, p.users, p.me)}`}>
                <Headphones size={16} />
                <span className="sb-label">Live in {chanName(c, p.users, p.me)}</span>
                <span className="chat-live-dot" aria-hidden />
              </button>
            ))}
          </nav>
          <div className="view-bar sb-label">
            <Select
              value={custom ? custom.id : active}
              onChange={pickView}
              options={viewOptions}
              label="Chat view"
              className="sel-flat"
              width={280}
              renderValue={(o) => (
                <>
                  <LayoutList size={14} />
                  <span className="sel-text">View: {o?.label ?? 'Default'}</span>
                  <ChevronDown size={13} className="sel-chev" />
                </>
              )}
            />
            {custom && (
              <button className="icon-btn sm" title="Edit this view" onClick={() => setEditing(custom)}>
                <Pencil size={13} />
              </button>
            )}
          </div>
        </>
      )}

      {phone && tiles.length > 0 && (
        <div className="chat-tiles" role="list" aria-label="At a glance">
          {tiles.map((t) => (
            <Tile key={t} id={t} label={TILE_NAMES[t]} icon={tileState[t].icon} line={tileState[t].line} hot={tileState[t].hot} onOpen={() => openTile(t)} onMenu={() => setTileMenu(t)} />
          ))}
        </div>
      )}

      {phone && section('top-dms', 'Unread direct messages', topDms)}
      {phone && section('top-mentions', 'Mentions', topMentions)}
      {section(
        'starred',
        <>
          <Star size={11} /> Starred
        </>,
        starredList,
      )}
      {body}
      {!phone && (
        <nav className="nav">
          {p.onNewChannel && (
            <button className="nav-item" onClick={p.onNewChannel} title="New channel">
              <Plus size={16} />
              <span className="sb-label">New channel</span>
            </button>
          )}
          {!custom &&
            p.isAdmin &&
            (newSection ? (
              <div className="add-client sb-label">
                <input
                  autoFocus
                  value={newSection.name}
                  onChange={(e) => setNewSection({ ...newSection, name: e.target.value })}
                  onKeyDown={(e) => (e.key === 'Enter' ? createSection() : e.key === 'Escape' && setNewSection(null))}
                  onBlur={createSection}
                  placeholder="Section name, e.g. Leadership"
                />
              </div>
            ) : (
              <button className="nav-item" onClick={() => setNewSection({ name: '' })} title="New section for everyone in the company">
                <FolderPlus size={16} />
                <span className="sb-label">New section</span>
              </button>
            ))}
          {joinable.length > 0 && (
            <button className="nav-item" onClick={() => setBrowsing((b) => !b)} title="Browse channels">
              <Compass size={16} />
              <span className="sb-label">Browse channels</span>
            </button>
          )}
          {browsing &&
            joinable.map((c) => (
              <div key={c.id} className="browse-row sb-label">
                <span>
                  <Hash size={13} /> {c.name}
                  <small>{c.topic}</small>
                </span>
                <button className="ghost-btn sm" onClick={() => (p.onJoin(c.id), setBrowsing(false))}>
                  Join
                </button>
              </div>
            ))}
        </nav>
      )}
      {phone && newSection && (
        <Sheet
          title="New section"
          onClose={() => setNewSection(null)}
          footer={
            <button className="primary-btn" disabled={!newSection.name.trim()} onClick={createSection}>
              Add section
            </button>
          }
        >
          <label className="field sheet-field">
            <span>Name, for everyone in the company</span>
            <input autoFocus value={newSection.name} onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && createSection()} placeholder="e.g. Leadership" />
          </label>
        </Sheet>
      )}

      {section(
        'dms',
        'Direct messages',
        dms.filter((c) => !star.has(c.id) && !onTop.has(c.id)).sort((a, b) => (phone ? recency(b).localeCompare(recency(a)) : 0)),
        phone ? undefined : addingDm ? (
          <div className="add-client sb-label">
            <Select
              value={null}
              placeholder="Message someone…"
              label="Message someone"
              searchable
              onChange={(v) => (p.onNewDm(v), setAddingDm(false))}
              options={p.users.filter((u) => u.id !== p.me && !dmWith.has(u.id)).map((u) => ({ value: u.id, label: u.name, hint: u.title, icon: <Avatar person={u} size={22} /> }))}
            />
          </div>
        ) : (
          <button className="nav-item" onClick={() => setAddingDm(true)} title="New message">
            <Plus size={16} />
            <span className="sb-label">New message</span>
          </button>
        ),
      )}
      {phone && joinable.length > 0 && (
        <button className="cl-browse" onClick={() => setBrowsing(true)}>
          <Compass size={18} /> Browse channels you can join
        </button>
      )}
      {phone && browsing && (
        <Sheet title="Browse channels" size="tall" onClose={() => setBrowsing(false)}>
          <div className="as-list">
            {joinable.map((c) => (
              <button key={c.id} type="button" className="as-item" onClick={() => (setBrowsing(false), p.onJoin(c.id))}>
                <Hash size={18} className="as-icon" />
                <span className="as-label">
                  {c.name}
                  {c.topic && <small>{c.topic}</small>}
                </span>
                <span className="as-side">Join</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      <Popover anchor={secAnchor} open={!!secMenu} onClose={() => setSecMenu(null)} width={240} title="Section">
        {secMenu && (
          <div className="sel-pop">
            <button className="sel-opt" onClick={() => (setAccessFor(secMenu), setSecMenu(null))}>
              <Users size={14} /> People with access
              {(() => {
                const n = sectionPeople(layout.sections.find((x) => x.id === secMenu)!, p.teams).length;
                return n ? <span className="sel-hint">{n}</span> : null;
              })()}
            </button>
            <button className="sel-opt" onClick={() => (setRenaming({ id: secMenu, name: layout.sections.find((x) => x.id === secMenu)?.name ?? '' }), setSecMenu(null))}>
              <Pencil size={14} /> Rename
            </button>
            {layout.sections.findIndex((x) => x.id === secMenu) > 0 && (
              <button className="sel-opt" onClick={() => (moveSection(secMenu, -1), setSecMenu(null))}>
                <ChevronUp size={14} /> Move up
              </button>
            )}
            {layout.sections.findIndex((x) => x.id === secMenu) < layout.sections.length - 1 && (
              <button className="sel-opt" onClick={() => (moveSection(secMenu, 1), setSecMenu(null))}>
                <ChevronDown size={14} /> Move down
              </button>
            )}
            {phone && !custom && (
              <button className="sel-opt" onClick={() => (setSecMenu(null), setNewSection({ name: '' }))}>
                <FolderPlus size={14} /> New section
              </button>
            )}
            {layout.sections.find((x) => x.id === secMenu)?.category ? (
              <p className="muted small menu-note">Built-in section for {CATEGORY_ONE[layout.sections.find((x) => x.id === secMenu)!.category!].toLowerCase()} channels. You can rename and move it.</p>
            ) : (
              <>
                <button className="sel-opt danger" onClick={() => (deleteSection(secMenu), setSecMenu(null))}>
                  <Trash2 size={14} /> Delete section
                </button>
                <p className="muted small menu-note">Its channels go back to their usual section.</p>
              </>
            )}
            <p className="muted small menu-note">Changes here apply to everyone in the company.</p>
          </div>
        )}
      </Popover>

      {menuChannel && (
        <ActionSheet
          open
          onClose={() => setRowMenu(null)}
          title={phone ? undefined : chanName(menuChannel, p.users, p.me)}
          actions={rowActions(menuChannel)}
          anchor={rowMenu?.anchor ? { current: rowMenu.anchor } : undefined}
          at={rowMenu?.at ?? null}
          header={phone ? <Peek c={menuChannel} p={p} messages={p.messages} read={chat.read[menuChannel.id] ?? readFallback()} onOpen={() => (setRowMenu(null), p.onOpen(menuChannel.id))} /> : undefined}
        />
      )}
      {rowSub?.kind === 'mute' && subChannel && (
        <ActionSheet
          open
          onClose={() => setRowSub(null)}
          title={`Mute ${chanName(subChannel, p.users, p.me)}`}
          anchor={rowSub.anchor ? { current: rowSub.anchor } : undefined}
          at={rowSub.at ?? null}
          actions={(
            [
              ['hour', 'For an hour'],
              ['tomorrow', 'Until tomorrow morning'],
              ['always', 'Until I turn it back on'],
            ] as const
          ).map(([k, l]) => ({ label: l, hint: k === 'always' ? 'Mentions of you still come through' : undefined, run: () => (chat.mute(subChannel.id, k), toast({ text: `Muted ${chanName(subChannel, p.users, p.me)} ${l.toLowerCase()}` })) }))}
        />
      )}
      {rowSub?.kind === 'move' && subChannel && (
        <ActionSheet
          open
          onClose={() => setRowSub(null)}
          title={custom ? `Move to a section of “${custom.name}”` : 'Move to (for everyone)'}
          anchor={rowSub.anchor ? { current: rowSub.anchor } : undefined}
          at={rowSub.at ?? null}
          actions={
            custom
              ? custom.sections.map((s) => ({ label: s.name, checked: s.channelIds.includes(subChannel.id), run: () => moveInView(subChannel.id, s.id) }))
              : [
                  ...layout.sections.filter((sec) => canPlace(subChannel, sec)).map((sec) => ({ label: sec.name, checked: sectionOf(subChannel) === sec.id, run: () => placeIn(subChannel.id, sec.id) })),
                  ...(p.isAdmin ? [{ label: 'New section…', icon: Plus, group: 'new', run: () => setNewSection({ name: '', channelId: subChannel.id }) }] : []),
                ]
          }
        />
      )}
      {rowSub?.kind === 'leave' && subChannel && <ConfirmSheet title={`Leave ${chanName(subChannel, p.users, p.me)}?`} text={subChannel.private ? 'It’s private: someone in it has to add you back.' : 'You can join again from Browse channels.'} yes="Leave" onYes={() => p.onLeave(subChannel.id)} onClose={() => setRowSub(null)} />}
      {tileMenu && (
        <ActionSheet
          open
          onClose={() => setTileMenu(null)}
          title={TILE_NAMES[tileMenu]}
          actions={[
            ...(chat.tiles.order.indexOf(tileMenu) > 0 ? [{ label: 'Move left', icon: ArrowLeft, run: () => moveTile(chat, tileMenu, -1) }] : []),
            ...(chat.tiles.order.indexOf(tileMenu) < chat.tiles.order.length - 1 ? [{ label: 'Move right', icon: ArrowRight, run: () => moveTile(chat, tileMenu, 1) }] : []),
            { label: 'Hide this tile', icon: EyeOff, run: () => (chat.setTiles({ ...chat.tiles, hidden: [...chat.tiles.hidden, tileMenu] }), toast({ text: `${TILE_NAMES[tileMenu]} hidden. Chat’s settings bring it back.`, action: { label: 'Undo', run: () => chat.setTiles({ ...chat.tiles, hidden: chat.tiles.hidden.filter((x) => x !== tileMenu) }) } })) },
          ]}
        />
      )}

      {accessFor && (
        <Layer>
          <SectionAccess
            section={layout.sections.find((x) => x.id === accessFor)!}
            channels={p.channels.filter((c) => c.kind === 'channel' && !c.archived && sectionOf(c) === accessFor)}
            users={p.users}
            teams={p.teams}
            me={p.me}
            onSave={(access) => {
              p.onSectionAccess(accessFor, access);
              setAccessFor(null);
            }}
            onClose={() => setAccessFor(null)}
          />
        </Layer>
      )}

      {editing && (
        <Layer>
          <ViewEditor
            view={editing}
            channels={rooms}
            isNew={!views.some((v) => v.id === editing.id)}
            onClose={() => setEditing(null)}
            onDelete={() => {
              setViews(views.filter((v) => v.id !== editing.id));
              setViewId('default');
              setEditing(null);
            }}
            onSave={(v) => {
              setViews(views.some((x) => x.id === v.id) ? views.map((x) => (x.id === v.id ? v : x)) : [...views, v]);
              setViewId(v.id);
              setEditing(null);
            }}
          />
        </Layer>
      )}
      {newMsg && <NewMessageSheet users={p.users} me={p.me} onPick={p.onNewDm} onNewChannel={p.onNewChannel} onClose={() => setNewMsg(false)} />}
    </>
  );
}

const moveTile = (chat: ChatState, t: TileId, by: -1 | 1) => {
  const order = [...chat.tiles.order];
  const i = order.indexOf(t);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  chat.setTiles({ ...chat.tiles, order });
};

/** A section's heading: tap folds it; "…" (or a long-press on phones) for admins' section menu. */
function SectionHead({ title, closed, count, onToggle, onMenu, phone }: { title: ReactNode; closed: boolean; count: number; onToggle: () => void; onMenu?: (el: HTMLElement) => void; phone: boolean }) {
  const head = useRef<HTMLButtonElement>(null);
  const press = useLongPress(() => head.current && onMenu?.(head.current), { disabled: !onMenu || !phone });
  return (
    <div className="sec-head-row">
      <button ref={head} className={`nav-heading sb-label sec-head${phone && onMenu ? ' lp' : ''}`} onClick={onToggle} aria-expanded={!closed} {...(phone ? press : {})}>
        <ChevronRight size={12} className={`rot-chev ${closed ? '' : 'open'}`} /> {title}
        {count ? <span className="sec-count unread">{count}</span> : null}
      </button>
      {onMenu && !phone && (
        <button className="nav-more sec-more" aria-label="Section options" onClick={(e) => onMenu(e.currentTarget)}>
          <MoreHorizontal size={14} />
        </button>
      )}
    </div>
  );
}

/** One conversation: in the sidebar a single line; on phones two lines with the last message, time and what's unread. */
function ConvoRow({ c, p, info, phone, starred, draggable, onDragState, onMenu }: { c: Channel; p: SidebarProps; info?: ConvoInfo; phone: boolean; starred: boolean; draggable: boolean; onDragState: (d: string | null) => void; onMenu: (where: { at?: { x: number; y: number }; anchor?: HTMLElement }) => void }) {
  const other = c.kind === 'dm' ? p.users.find((u) => u.id === dmOther(c, p.me)) : undefined;
  const st = other ? p.statuses[other.id] : undefined;
  const press = useLongPress((pt) => onMenu({ at: { x: pt.x, y: pt.y } }), { disabled: !phone });
  const more = useRef<HTMLButtonElement>(null);
  const unread = !!info?.unread && !info.muted;
  const live = !!c.huddle?.members.length;
  const icon = other ? (
    <span className="dm-av">
      <Avatar person={other} size={phone ? 36 : 20} />
      <i className={`presence ${p.presence(other.id)}`} />
    </span>
  ) : c.category === 'shared' ? (
    <Handshake size={phone ? 18 : 15} />
  ) : c.private ? (
    <Lock size={phone ? 17 : 15} />
  ) : (
    <Hash size={phone ? 18 : 16} />
  );
  const name = other ? other.name : c.name;
  const guestBadge = c.category === 'shared' || c.guests?.length ? <Badge small tone="warn" title={`The ${term.whos} can see this channel`}>{term.Whos}</Badge> : null;
  if (phone) {
    const last = info?.last;
    const who = last ? (last.userId === p.me ? 'You' : last.guestEmail ? (c.guests?.find((g) => g.email === last.guestEmail)?.name.split(' ')[0] ?? 'Guest') : (p.users.find((u) => u.id === last.userId)?.name.split(' ')[0] ?? '')) : '';
    return (
      <button
        className={`cl-row lp${unread ? ' unread' : ''}${info?.muted ? ' muted' : ''}${p.current === c.id ? ' active' : ''}`}
        {...press}
        onClick={() => p.onOpen(c.id)}
        onContextMenu={(e) => (press.onContextMenu(e), e.preventDefault(), onMenu({ at: { x: e.clientX, y: e.clientY } }))}
        aria-label={`${name}${unread ? `, ${info!.unread} unread` : ''}${info?.draft ? ', draft' : ''}`}
      >
        <span className={`cl-icon${other ? ' is-dm' : ''}`}>{icon}</span>
        <span className="cl-main">
          <span className="cl-top">
            <span className="cl-name">
              {name}
              {st && <span className="st-emoji">{st.emoji}</span>}
              {guestBadge}
              {starred && <Star size={11} className="cl-star" aria-label="Starred" />}
            </span>
            {last && <time dateTime={last.at}>{shortTime(last.at)}</time>}
          </span>
          <span className="cl-bottom">
            <span className="cl-preview">
              {info?.draft ? (
                <>
                  <PenLine size={12} className="cl-draft-icon" aria-hidden />
                  <em className="cl-draft">Draft:</em> {info.draft.replace(/\s+/g, ' ')}
                </>
              ) : last ? (
                <>
                  {c.kind === 'channel' || who === 'You' ? `${who}: ` : ''}
                  {preview(last) || 'Sent something'}
                </>
              ) : (
                <span className="muted">No messages yet</span>
              )}
            </span>
            {live && <Headphones size={14} className="cl-live" aria-label="Huddle on now" />}
            {info?.muted && <BellOff size={13} className="cl-muted" aria-label="Muted" />}
            {info?.mentions ? <span className="count">{info.mentions}</span> : unread && c.kind === 'dm' ? <span className="count">{info!.unread}</span> : unread ? <span className="cl-dot" aria-hidden /> : null}
          </span>
        </span>
      </button>
    );
  }
  return (
    <div
      className={`nav-row ${p.current === c.id ? 'active' : ''}${info?.muted ? ' muted' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/s2g-channel', c.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragState(''); // dragging: show empty sections as drop targets
      }}
      onDragEnd={() => onDragState(null)}
      onContextMenu={(e) => (e.preventDefault(), onMenu({ at: { x: e.clientX, y: e.clientY } }))}
    >
      <button className={`nav-item ${p.current === c.id ? 'active' : ''} ${unread ? 'has-unread' : ''}`} onClick={() => p.onOpen(c.id)} title={other ? other.name : `#${c.name}`}>
        {icon}
        <span className="sb-label">
          {name}
          {st && (
            <span className="st-emoji" title={st.text}>
              {st.emoji}
            </span>
          )}
          {guestBadge}
        </span>
        {info?.draft && p.current !== c.id ? <PenLine size={13} className="nav-draft" aria-label="Draft" /> : null}
        {live && <Headphones size={13} className="nav-live" aria-label="Huddle on now" />}
        {info?.muted ? <BellOff size={12} className="nav-muted" aria-label="Muted" /> : info?.mentions ? <span className="count">{info.mentions}</span> : unread && c.kind === 'dm' ? <span className="count">{info!.unread}</span> : null}
      </button>
      <button ref={more} className="nav-more" aria-label="Conversation options" onClick={() => more.current && onMenu({ anchor: more.current })}>
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}

/** A look inside a conversation from the list, without marking it read. */
function Peek({ c, p, messages, read, onOpen }: { c: Channel; p: SidebarProps; messages: ChatMessage[]; read: string; onOpen: () => void }) {
  const last = messages.filter((m) => m.channelId === c.id && !m.sendAt && (!m.parentId || m.alsoInChannel)).sort((a, b) => a.at.localeCompare(b.at)).slice(-4);
  return (
    <button type="button" className="peek" onClick={onOpen} aria-label={`Open ${chanName(c, p.users, p.me)}`}>
      <span className="peek-head">
        <strong>{chanName(c, p.users, p.me)}</strong>
        <span className="muted small">Not marked read</span>
      </span>
      {last.length ? (
        last.map((m) => (
          <span key={m.id} className={`peek-line${m.at > read && m.userId !== p.me ? ' new' : ''}`}>
            <b>{m.userId === p.me ? 'You' : m.guestEmail ? (c.guests?.find((g) => g.email === m.guestEmail)?.name.split(' ')[0] ?? 'Guest') : (p.users.find((u) => u.id === m.userId)?.name.split(' ')[0] ?? 'Someone')}</b> {preview(m)}
          </span>
        ))
      ) : (
        <span className="peek-line muted">No messages yet</span>
      )}
    </button>
  );
}

/** A tile on top of the phone's chat list: one thing to act on, with its state. Hold to move or hide it. */
function Tile({ id, label, icon, line, hot, onOpen, onMenu }: { id: TileId; label: string; icon: ReactNode; line: string; hot: boolean; onOpen: () => void; onMenu: () => void }) {
  const press = useLongPress(() => onMenu());
  return (
    <button role="listitem" className={`chat-tile lp tile-${id}${hot ? ' hot' : ''}`} {...press} onClick={onOpen} onContextMenu={(e) => (press.onContextMenu(e), e.preventDefault(), onMenu())}>
      <span className="ct-icon">{icon}</span>
      <span className="ct-label">{label}</span>
      <span className="ct-line">{line}</span>
    </button>
  );
}

/** Your status: Focus, Away, your own words, or none. */
function StatusPicker({ status, onStatus }: { status?: Status; onStatus: (s: Status | null) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <div className="status-pop">
      {STATUS_PRESETS.map((s) => (
        <button key={s.text} className={`sel-opt${status?.text === s.text ? ' on' : ''}`} onClick={() => onStatus(s)}>
          <span className="st-emoji big">{s.emoji}</span>
          {s.text}
          {status?.text === s.text && <Check size={14} className="sel-check" />}
        </button>
      ))}
      <div className="status-custom">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or type your own…" aria-label="Your own status" onKeyDown={(e) => e.key === 'Enter' && custom.trim() && (onStatus({ emoji: '💬', text: custom.trim() }), setCustom(''))} />
      </div>
      {status && (
        <button className="sel-opt danger" onClick={() => onStatus(null)}>
          <X size={14} /> Clear status
        </button>
      )}
      <p className="muted small">“In a meeting” is set for you automatically from your calendar.</p>
    </div>
  );
}

/** The tiles on top of the phone's chat list: show or hide each, and their order. */
function TilesEditor({ me }: { me: string }) {
  const chat = useChatState(me);
  const { order, hidden } = chat.tiles;
  return (
    <div className="tiles-editor">
      <p className="muted small">Tiles show what to act on in Chat. Hold a tile in the list to move or hide it there too.</p>
      {order.map((t, i) => (
        <div key={t} className="te-tile">
          <SlidersHorizontal size={16} className="muted" aria-hidden />
          <span className="te-name">
            {TILE_NAMES[t]}
            {t === 'live' && <small>Only while a huddle is on</small>}
          </span>
          <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => moveTile(chat, t, -1)} aria-label={`Move ${TILE_NAMES[t]} up`}>
            <ChevronUp size={16} />
          </button>
          <button type="button" className="icon-btn sm" disabled={i === order.length - 1} onClick={() => moveTile(chat, t, 1)} aria-label={`Move ${TILE_NAMES[t]} down`}>
            <ChevronDown size={16} />
          </button>
          <button type="button" role="switch" aria-checked={!hidden.includes(t)} aria-label={`Show ${TILE_NAMES[t]}`} className={`switch ${hidden.includes(t) ? '' : 'on'}`} onClick={() => chat.setTiles({ order, hidden: hidden.includes(t) ? hidden.filter((x) => x !== t) : [...hidden, t] })}>
            <span />
          </button>
        </div>
      ))}
    </div>
  );
}

/** New message: pick someone to write to, or start a channel. Chat's create button, and New, Message in More. */
export function NewMessageSheet({ users, me, onPick, onNewChannel, onClose }: { users: User[]; me: string; onPick: (userId: string) => void; onNewChannel?: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const people = users.filter((u) => u.id !== me && (!s || s.split(/\s+/).every((w) => `${u.name} ${u.email} ${u.title ?? ''}`.toLowerCase().includes(w))));
  return (
    <Sheet onClose={onClose} title="New message" size="tall">
      <label className="sheet-search">
        <SearchIcon size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="To: a name or email" aria-label="Who to message" />
      </label>
      <div className="as-list">
        {onNewChannel && !s && (
          <button type="button" className="as-item" onClick={() => (onClose(), onNewChannel())}>
            <Hash size={18} className="as-icon" />
            <span className="as-label">
              New channel
              <small>A place for a team, a {term.one} or a topic</small>
            </span>
          </button>
        )}
        {people.map((u) => (
          <button key={u.id} type="button" className="as-item" onClick={() => (onClose(), onPick(u.id))}>
            <Avatar person={u} size={30} />
            <span className="as-label">
              {u.name}
              {u.title && <small>{u.title}</small>}
            </span>
          </button>
        ))}
        {people.length === 0 && <p className="sheet-empty">Nobody here is called “{q}”</p>}
      </div>
    </Sheet>
  );
}

/** Make or edit your own chat view: name it, add sections, pick which channels go where. */
function ViewEditor({ view, channels, isNew, onSave, onDelete, onClose }: { view: ChatViewDef; channels: Channel[]; isNew: boolean; onSave: (v: ChatViewDef) => void; onDelete: () => void; onClose: () => void }) {
  const [v, setV] = useState<ChatViewDef>(view);
  const sectionOf = (cid: string) => v.sections.find((s) => s.channelIds.includes(cid))?.id ?? '';
  const place = (cid: string, sid: string) => setV({ ...v, sections: v.sections.map((s) => ({ ...s, channelIds: s.id === sid ? [...new Set([...s.channelIds, cid])] : s.channelIds.filter((x) => x !== cid) })) });
  const fromCategories = () =>
    setV({
      ...v,
      sections: (['client', 'shared', 'team', 'project', 'social'] as ChannelCategory[]).map((cat) => ({ id: cat, name: CATEGORY_NAME[cat], channelIds: channels.filter((c) => (c.category ?? 'project') === cat).map((c) => c.id) })),
    });
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal view-modal" role="dialog" aria-label="Chat view" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <LayoutList size={15} /> {isNew ? 'Create a view' : 'Edit view'}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body connect-form">
          <SmoothHeight>
          <label className="field">
            <span>Name</span>
            <input autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={`e.g. My ${term.many}`} />
          </label>
          <div className="field">
            <span>Sections</span>
            <div className="ve-sections">
              {v.sections.map((s, i) => (
                <div key={s.id} className="ve-sec">
                  <input value={s.name} onChange={(e) => setV({ ...v, sections: v.sections.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) })} />
                  <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => setV({ ...v, sections: v.sections.map((x, j, arr) => (j === i - 1 ? arr[i] : j === i ? arr[i - 1] : x)) })} aria-label="Move up">
                    <ChevronDown size={14} className="flip" />
                  </button>
                  <button type="button" className="icon-btn sm" onClick={() => setV({ ...v, sections: v.sections.filter((x) => x.id !== s.id) })} aria-label="Remove section">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="ve-actions">
                <button type="button" className="ghost-btn sm" onClick={() => setV({ ...v, sections: [...v.sections, { id: 's' + Date.now().toString(36), name: 'New section', channelIds: [] }] })}>
                  <Plus size={13} /> Add section
                </button>
                <button type="button" className="link-btn" onClick={fromCategories}>
                  Start from the default groups
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <span>Where each channel goes</span>
            <div className="ve-channels">
              {channels.map((c) => (
                <div key={c.id} className="ve-ch">
                  <span>
                    {c.private ? <Lock size={13} /> : <Hash size={13} />} {c.name}
                  </span>
                  <Select
                    value={sectionOf(c.id)}
                    onChange={(sid) => place(c.id, sid)}
                    label={`Section for ${c.name}`}
                    className="sel-flat"
                    options={[{ value: '', label: v.showRest ? 'Other channels' : 'Hidden in this view' }, ...v.sections.map((s) => ({ value: s.id, label: s.name || 'Untitled' }))]}
                  />
                </div>
              ))}
            </div>
          </div>
          <label className="set-row toggle-row">
            <span>
              <strong>Show the rest under “Other channels”</strong>
              <small>Off: channels you didn’t place are hidden in this view (you can still find them with ⌘K)</small>
            </span>
            <button type="button" role="switch" aria-checked={v.showRest} className={`switch ${v.showRest ? 'on' : ''}`} onClick={() => setV({ ...v, showRest: !v.showRest })}>
              <span />
            </button>
          </label>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {!isNew && (
            <button className="ghost-btn danger-text" onClick={onDelete}>
              Delete view
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!v.name.trim()} onClick={() => onSave({ ...v, name: v.name.trim(), sections: v.sections.filter((s) => s.name.trim()) })}>
            {isNew ? 'Create view' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ---------------- Conversation: src/components/chat/Conversation.tsx ---------------- */

export { ChatView, type SendPayload } from './chat/Conversation';

/** Who is in every channel of a section: people and whole teams. */
function SectionAccess({ section, channels, users, teams, me, onSave, onClose }: { section: ChatSection; channels: Channel[]; users: User[]; teams: Team[]; me: string; onSave: (a: { userIds: string[]; teamIds: string[] }) => void; onClose: () => void }) {
  const [userIds, setUserIds] = useState(section.access?.userIds ?? []);
  const [teamIds, setTeamIds] = useState(section.access?.teamIds ?? []);
  const everyone = sectionPeople({ ...section, access: { userIds, teamIds } }, teams);
  const before = sectionPeople(section, teams);
  const removed = before.filter((x) => !everyone.includes(x));
  const priv = channels.filter((c) => c.private).length;
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal access-modal" role="dialog" aria-label="People with access" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Users size={15} /> {section.name}: people with access
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body access-body">
          <SmoothHeight>
          <p className="muted small">
            Everyone here is in {channels.length === 1 ? 'the channel' : `all ${channels.length} channels`} in this section{priv ? (channels.length === 1 ? ' (it’s private)' : `, including ${priv} private`) : ''}, and in any channel added to it later. No need to invite them one by one.
          </p>
          <div className="field">
            <span>Teams</span>
            <div className="team-toggles">
              {teams.map((t) => (
                <button key={t.id} type="button" className={teamIds.includes(t.id) ? 'on' : ''} onClick={() => setTeamIds((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>
                  <span className="team-square" style={{ background: t.color }} /> {t.name}
                  <small>{t.members.length}</small>
                </button>
              ))}
            </div>
            <small className="muted">New team members get access automatically.</small>
          </div>
          <div className="field">
            <span>People</span>
            <PeoplePicker value={userIds} users={users} me={me} onChange={setUserIds} label="People with access" emptyText="Add people" max={8} />
          </div>
          <p className="small">
            <b>{everyone.length}</b> {everyone.length === 1 ? 'person has' : 'people have'} access.
            {removed.length > 0 && <span className="muted"> {removed.length} will leave this section’s channels (channel owners stay).</span>}
          </p>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => onSave({ userIds, teamIds })}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
