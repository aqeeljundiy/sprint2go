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
import { CATEGORY_NAME, CATEGORY_ONE, categoryText } from './ChannelDialog';
import { Sheet } from './ui/Sheet';
import { ActionSheet, type SheetAction } from './ui/ActionSheet';
import { useLongPress } from './ui/useLongPress';
import { SquarePen, Search as SearchIcon } from 'lucide-react';
import { useAppSettings, useCreateAction, useTitleMenu } from '../mobile/chrome';
import { routeBase } from '../tryOut';
import { toast } from '../toast';
import { dmOther, followedThreads, isMutedValue, readFallback, shortTime, STATUS_PRESETS, statusText, TILE_NAMES, useChatState, whenText, type ChatState, type TileId } from './chat/chatPrefs';
export { statusText };
import { preview } from './chat/Message';
import { ConfirmSheet, chanName } from './chat/Sheets';
import { mark, t, tn, tx } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtNumber } from '../i18n/format';

export type Presence = 'active' | 'away' | 'meeting';
/** Pages of Chat besides the conversations: shown in the main area on wider screens, pushed full screen on phones. */
export type ChatPage = 'catchup' | 'threads' | 'drafts' | 'saved';



const ALL_CATS: ChannelCategory[] = ['client', 'shared', 'team', 'project', 'social'];
/** The company layout with every built-in section present. */
export function fullLayout(l: ChatLayout | undefined): ChatLayout {
  const base = l?.sections?.length ? l.sections : [];
  const missing = ALL_CATS.filter((c) => !base.some((s) => s.category === c)).map((c) => ({ id: c, name: sectionDefault(c), category: c }));
  return { sections: [...base, ...missing], placement: l?.placement ?? {} };
}
/** A built-in section's name as the company layout saves it: English, so each reader sees it in their own language. */
function sectionDefault(c: ChannelCategory) {
  const clients = term.word === 'client';
  return { client: clients ? mark('Clients') : mark('Projects'), shared: mark('Shared'), team: mark('Teams'), project: clients ? mark('Projects') : mark('Other'), social: mark('Social') }[c];
}
/** A section's name on screen: built-in ones in the reader's language, the company's own as they named them. */
export const sectionTitle = (s: ChatSection) => (s.category ? categoryText(s.name) : s.name);
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
    { value: 'default', label: t('Company default'), hint: t('Sections your admins set for everyone'), group: t('Built in') },
    { value: 'unread', label: t('Unread first'), hint: t('What needs you on top'), group: t('Built in') },
    { value: 'recent', label: t('Recent'), hint: t('Latest activity first'), group: t('Built in') },
    ...views.map((v) => ({ value: v.id, label: v.name, hint: tn(v.sections.length, '{n} section', '{n} sections'), group: t('Your views') })),
    { value: '__new', label: t('Create a view…'), hint: t('Your own sections and channels'), group: t('Your views'), icon: <Plus size={14} /> },
  ];
  const pickView = (v: string) => {
    if (v === '__new') setEditing({ id: 'v-' + Date.now().toString(36), name: t('My view'), sections: [{ id: 's1', name: t('Focus'), channelIds: [] }], showRest: true });
    else setViewId(v);
  };

  // The phone shell: New message on the create button, the view in the title switcher, status and tiles in its settings.
  useCreateAction('chat', phone && { label: t('New message'), icon: SquarePen, run: () => setNewMsg(true), more: [...(p.onNewChannel ? [{ label: t('New channel'), icon: Hash, run: p.onNewChannel }] : []), ...(joinable.length ? [{ label: t('Browse channels'), icon: Compass, run: () => setBrowsing(true) }] : [])] });
  // On phones the title is the view: "Chat" for the company's sections.
  useTitleMenu('chat', phone && { label: t('Chat view'), value: custom ? custom.id : active, options: viewOptions.map((o) => (o.value === 'default' ? { ...o, label: t('Chat'), hint: t('Your company’s sections') } : o)), onChange: pickView });
  useAppSettings('chat', phone && { id: 'status', label: t('Your status'), hint: myStatus ? `${myStatus.emoji} ${statusText(myStatus)}` : t('Let people know if you’re focusing or away'), render: () => <StatusPicker status={p.statuses[p.me]} onStatus={p.onStatus} /> });
  useAppSettings('chat', phone && { id: 'tiles', label: t('Tiles on top'), hint: t('Which ones show, and in what order'), render: () => <TilesEditor me={p.me} /> });

  /* ---------- tiles: what to act on, at a glance ---------- */
  const unreadConvos = mine.filter((c) => info[c.id]?.unread && !info[c.id].muted);
  const threads = useMemo(() => followedThreads(p.messages.filter((m) => mine.some((c) => c.id === m.channelId)), p.me, p.myFirst, chat), [p.messages, p.me, p.myFirst, chat.read]); // eslint-disable-line react-hooks/exhaustive-deps
  const newReplies = threads.reduce((n, th) => n + th.unread, 0);
  const draftCount = Object.keys(chat.drafts).filter((k) => mine.some((c) => k === c.id || k.startsWith(`${c.id}/`))).length;
  const scheduled = p.messages.filter((m) => m.sendAt && m.userId === p.me).length;
  const nextReminder = chat.saved.filter((s) => s.remindAt && !s.reminded).sort((a, b) => a.remindAt!.localeCompare(b.remindAt!))[0];
  const live = mine.filter((c) => c.huddle?.members.length);
  const tileState: Record<TileId, { line: string; hot: boolean; hidden?: boolean; icon: ReactNode }> = {
    catchup: { icon: <Inbox size={18} />, line: unreadConvos.length ? tn(unreadConvos.length, '{n} new', '{n} new') : t('Caught up'), hot: unreadConvos.length > 0 },
    threads: { icon: <MessagesSquare size={18} />, line: newReplies ? tn(newReplies, '{n} new reply', '{n} new replies') : t('Caught up'), hot: newReplies > 0 },
    drafts: { icon: <SendHorizontal size={18} />, line: [draftCount ? tn(draftCount, '{n} draft', '{n} drafts') : '', scheduled ? tn(scheduled, '{n} to send', '{n} to send') : ''].filter(Boolean).join(', ') || tx('tile', 'Nothing waiting'), hot: false },
    saved: { icon: <Bookmark size={18} />, line: nextReminder ? t('Reminder {when}', { when: whenText(nextReminder.remindAt!) }) : chat.saved.length ? t('Your saved messages') : tx('tile', 'Nothing saved'), hot: false },
    live: { icon: <Headphones size={18} />, line: live.length ? (live.length > 1 ? t('{name} and {n} more', { name: chanName(live[0], p.users, p.me), n: fmtNumber(live.length - 1) }) : chanName(live[0], p.users, p.me)) : '', hot: true, hidden: !live.length },
  };
  const tiles = chat.tiles.order.filter((id) => !chat.tiles.hidden.includes(id) && !tileState[id].hidden);
  const openTile = (id: TileId) => (id === 'live' ? live[0] && p.onOpen(live[0].id) : p.onPage(id));

  /* ---------- one conversation in the list ---------- */
  const rowActions = (c: Channel): SheetAction[] => {
    const i = info[c.id];
    const mutedTill = chat.mutedUntil(c.id);
    const list: SheetAction[] = [];
    if (i?.unread) list.push({ label: t('Mark read'), icon: CheckCheck, run: () => chat.markRead(c.id) });
    else if (i?.last && i.last.userId !== p.me) list.push({ label: t('Mark unread'), icon: MailOpen, run: () => chat.markUnread(i.last!) });
    list.push(mutedTill ? { label: t('Unmute'), icon: Bell, hint: mutedTill === 'always' ? undefined : t('Muted until {when}', { when: whenText(mutedTill) }), run: () => chat.unmute(c.id) } : { label: t('Mute…'), icon: BellOff, run: () => setRowSub({ kind: 'mute', id: c.id, anchor: rowMenu?.anchor, at: rowMenu?.at }) });
    list.push({ label: star.has(c.id) ? t('Remove from Starred') : t('Star'), icon: Star, run: () => setStarred(star.has(c.id) ? starred.filter((x) => x !== c.id) : [...starred, c.id]) });
    list.push({ label: t('Copy link'), icon: Link2, run: () => navigator.clipboard?.writeText(`${location.origin}${routeBase}/chat?ws=${encodeURIComponent(c.workspaceId)}&id=${encodeURIComponent(c.id)}`).then(() => toast({ text: t('Link copied') }), () => toast({ text: t('Couldn’t copy here') })) });
    if (c.kind === 'channel' && (custom || layout.sections.some((sec) => canPlace(c, sec)))) list.push({ label: t('Move to section…'), icon: LayoutList, run: () => setRowSub({ kind: 'move', id: c.id, anchor: rowMenu?.anchor, at: rowMenu?.at }) });
    if (c.kind === 'channel') list.push({ label: t('Channel settings'), icon: Settings, run: () => p.onSettings(c.id) });
    if (c.kind === 'channel' && !c.teamId) list.push({ label: t('Leave'), icon: LogOut, danger: true, group: 'end', run: () => setRowSub({ kind: 'leave', id: c.id }) });
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
        sectionTitle(sec),
        restRooms.filter((c) => sectionOf(c) === sec.id),
        !phone && !sec.category && p.isAdmin && !rooms.some((c) => sectionOf(c) === sec.id) ? <p className="muted small sec-empty sb-label">{t('Drag channels here, or use a channel’s … menu.')}</p> : undefined,
        (id) => placeIn(id, sec.id),
        p.isAdmin ? sec.id : undefined,
      ),
    );
  } else if (active === 'unread') {
    const list = [...restRooms].sort((a, b) => (info[b.id]?.unread ?? 0) - (info[a.id]?.unread ?? 0) || recency(b).localeCompare(recency(a)));
    body = [section('u-unread', t('Unread'), list.filter((c) => info[c.id]?.unread)), section('u-rest', t('Everything else'), list.filter((c) => !info[c.id]?.unread))];
  } else if (active === 'recent') {
    body = section('recent', t('Most recent first'), [...restRooms].sort((a, b) => recency(b).localeCompare(recency(a))));
  } else if (custom) {
    const used = new Set(custom.sections.flatMap((s) => s.channelIds));
    body = [
      ...custom.sections.map((s) => section(`${custom.id}:${s.id}`, s.name, restRooms.filter((c) => s.channelIds.includes(c.id)), undefined, (id) => moveInView(id, s.id))),
      custom.showRest ? section(`${custom.id}:rest`, t('Other channels'), restRooms.filter((c) => !used.has(c.id)), undefined, (id) => moveInView(id, null)) : null,
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
            <span className="sb-label">{myStatus ? statusText(myStatus) : t('Set a status')}</span>
          </button>
          <Popover anchor={statusBtn} open={statusOpen} onClose={() => setStatusOpen(false)} width={280} title={t('Your status')}>
            <StatusPicker status={myStatus} onStatus={(s) => (p.onStatus(s), setStatusOpen(false))} />
          </Popover>
          <nav className="nav chat-pages" aria-label={t('Chat pages')}>
            {pages.map((pg) => (
              <button key={pg.id} className={`nav-item ${p.page === pg.id ? 'active' : ''}`} onClick={() => p.onPage(pg.id)} title={pg.line}>
                {pg.icon}
                <span className="sb-label">{pg.label}</span>
                {pg.n ? <span className="count soft">{pg.n}</span> : null}
              </button>
            ))}
            {live.map((c) => (
              <button key={c.id} className="nav-item live-row" onClick={() => p.onOpen(c.id)} title={t('Huddle in {name}', { name: chanName(c, p.users, p.me) })}>
                <Headphones size={16} />
                <span className="sb-label">{t('Live in {name}', { name: chanName(c, p.users, p.me) })}</span>
                <span className="chat-live-dot" aria-hidden />
              </button>
            ))}
          </nav>
          <div className="view-bar sb-label">
            <Select
              value={custom ? custom.id : active}
              onChange={pickView}
              options={viewOptions}
              label={t('Chat view')}
              className="sel-flat"
              width={280}
              renderValue={(o) => (
                <>
                  <LayoutList size={14} />
                  <span className="sel-text">{t('View: {name}', { name: o?.label ?? t('Default') })}</span>
                  <ChevronDown size={13} className="sel-chev" />
                </>
              )}
            />
            {custom && (
              <button className="icon-btn sm" title={t('Edit this view')} onClick={() => setEditing(custom)}>
                <Pencil size={13} />
              </button>
            )}
          </div>
        </>
      )}

      {phone && tiles.length > 0 && (
        <div className="chat-tiles" role="list" aria-label={t('At a glance')}>
          {tiles.map((id) => (
            <Tile key={id} id={id} label={TILE_NAMES[id]} icon={tileState[id].icon} line={tileState[id].line} hot={tileState[id].hot} onOpen={() => openTile(id)} onMenu={() => setTileMenu(id)} />
          ))}
        </div>
      )}

      {phone && section('top-dms', t('Unread direct messages'), topDms)}
      {phone && section('top-mentions', t('Mentions'), topMentions)}
      {section(
        'starred',
        <>
          <Star size={11} /> {t('Starred')}
        </>,
        starredList,
      )}
      {body}
      {!phone && (
        <nav className="nav">
          {p.onNewChannel && (
            <button className="nav-item" onClick={p.onNewChannel} title={t('New channel')}>
              <Plus size={16} />
              <span className="sb-label">{t('New channel')}</span>
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
                  placeholder={t('Section name, e.g. Leadership')}
                />
              </div>
            ) : (
              <button className="nav-item" onClick={() => setNewSection({ name: '' })} title={t('New section for everyone in the company')}>
                <FolderPlus size={16} />
                <span className="sb-label">{t('New section')}</span>
              </button>
            ))}
          {joinable.length > 0 && (
            <button className="nav-item" onClick={() => setBrowsing((b) => !b)} title={t('Browse channels')}>
              <Compass size={16} />
              <span className="sb-label">{t('Browse channels')}</span>
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
                  {t('Join')}
                </button>
              </div>
            ))}
        </nav>
      )}
      {phone && newSection && (
        <Sheet
          title={t('New section')}
          onClose={() => setNewSection(null)}
          footer={
            <button className="primary-btn" disabled={!newSection.name.trim()} onClick={createSection}>
              {t('Add section')}
            </button>
          }
        >
          <label className="field sheet-field">
            <span>{t('Name, for everyone in the company')}</span>
            <input autoFocus value={newSection.name} onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && createSection()} placeholder={t('e.g. Leadership')} />
          </label>
        </Sheet>
      )}

      {section(
        'dms',
        t('Direct messages'),
        dms.filter((c) => !star.has(c.id) && !onTop.has(c.id)).sort((a, b) => (phone ? recency(b).localeCompare(recency(a)) : 0)),
        phone ? undefined : addingDm ? (
          <div className="add-client sb-label">
            <Select
              value={null}
              placeholder={t('Message someone…')}
              label={t('Message someone')}
              searchable
              onChange={(v) => (p.onNewDm(v), setAddingDm(false))}
              options={p.users.filter((u) => u.id !== p.me && !dmWith.has(u.id)).map((u) => ({ value: u.id, label: u.name, hint: u.title, icon: <Avatar person={u} size={22} /> }))}
            />
          </div>
        ) : (
          <button className="nav-item" onClick={() => setAddingDm(true)} title={t('New message')}>
            <Plus size={16} />
            <span className="sb-label">{t('New message')}</span>
          </button>
        ),
      )}
      {phone && joinable.length > 0 && (
        <button className="cl-browse" onClick={() => setBrowsing(true)}>
          <Compass size={18} /> {t('Browse channels you can join')}
        </button>
      )}
      {phone && browsing && (
        <Sheet title={t('Browse channels')} size="tall" onClose={() => setBrowsing(false)}>
          <div className="as-list">
            {joinable.map((c) => (
              <button key={c.id} type="button" className="as-item" onClick={() => (setBrowsing(false), p.onJoin(c.id))}>
                <Hash size={18} className="as-icon" />
                <span className="as-label">
                  {c.name}
                  {c.topic && <small>{c.topic}</small>}
                </span>
                <span className="as-side">{t('Join')}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      <Popover anchor={secAnchor} open={!!secMenu} onClose={() => setSecMenu(null)} width={240} title={t('Section')}>
        {secMenu && (
          <div className="sel-pop">
            <button className="sel-opt" onClick={() => (setAccessFor(secMenu), setSecMenu(null))}>
              <Users size={14} /> {t('People with access')}
              {(() => {
                const n = sectionPeople(layout.sections.find((x) => x.id === secMenu)!, p.teams).length;
                return n ? <span className="sel-hint">{n}</span> : null;
              })()}
            </button>
            <button className="sel-opt" onClick={() => (setRenaming({ id: secMenu, name: layout.sections.find((x) => x.id === secMenu)?.name ?? '' }), setSecMenu(null))}>
              <Pencil size={14} /> {t('Rename')}
            </button>
            {layout.sections.findIndex((x) => x.id === secMenu) > 0 && (
              <button className="sel-opt" onClick={() => (moveSection(secMenu, -1), setSecMenu(null))}>
                <ChevronUp size={14} /> {t('Move up')}
              </button>
            )}
            {layout.sections.findIndex((x) => x.id === secMenu) < layout.sections.length - 1 && (
              <button className="sel-opt" onClick={() => (moveSection(secMenu, 1), setSecMenu(null))}>
                <ChevronDown size={14} /> {t('Move down')}
              </button>
            )}
            {phone && !custom && (
              <button className="sel-opt" onClick={() => (setSecMenu(null), setNewSection({ name: '' }))}>
                <FolderPlus size={14} /> {t('New section')}
              </button>
            )}
            {layout.sections.find((x) => x.id === secMenu)?.category ? (
              <p className="muted small menu-note">{t('Built-in section for {kind} channels. You can rename and move it.', { kind: categoryText(CATEGORY_ONE[layout.sections.find((x) => x.id === secMenu)!.category!]).toLowerCase() })}</p>
            ) : (
              <>
                <button className="sel-opt danger" onClick={() => (deleteSection(secMenu), setSecMenu(null))}>
                  <Trash2 size={14} /> {t('Delete section')}
                </button>
                <p className="muted small menu-note">{t('Its channels go back to their usual section.')}</p>
              </>
            )}
            <p className="muted small menu-note">{t('Changes here apply to everyone in the company.')}</p>
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
          title={t('Mute {name}', { name: chanName(subChannel, p.users, p.me) })}
          anchor={rowSub.anchor ? { current: rowSub.anchor } : undefined}
          at={rowSub.at ?? null}
          actions={(
            [
              ['hour', t('For an hour'), t('Muted {name} for an hour', { name: chanName(subChannel, p.users, p.me) })],
              ['tomorrow', t('Until tomorrow morning'), t('Muted {name} until tomorrow morning', { name: chanName(subChannel, p.users, p.me) })],
              ['always', t('Until I turn it back on'), t('Muted {name} until you turn it back on', { name: chanName(subChannel, p.users, p.me) })],
            ] as const
          ).map(([k, l, done]) => ({ label: l, hint: k === 'always' ? t('Mentions of you still come through') : undefined, run: () => (chat.mute(subChannel.id, k), toast({ text: done })) }))}
        />
      )}
      {rowSub?.kind === 'move' && subChannel && (
        <ActionSheet
          open
          onClose={() => setRowSub(null)}
          title={custom ? t('Move to a section of “{view}”', { view: custom.name }) : t('Move to (for everyone)')}
          anchor={rowSub.anchor ? { current: rowSub.anchor } : undefined}
          at={rowSub.at ?? null}
          actions={
            custom
              ? custom.sections.map((s) => ({ label: s.name, checked: s.channelIds.includes(subChannel.id), run: () => moveInView(subChannel.id, s.id) }))
              : [
                  ...layout.sections.filter((sec) => canPlace(subChannel, sec)).map((sec) => ({ label: sectionTitle(sec), checked: sectionOf(subChannel) === sec.id, run: () => placeIn(subChannel.id, sec.id) })),
                  ...(p.isAdmin ? [{ label: t('New section…'), icon: Plus, group: 'new', run: () => setNewSection({ name: '', channelId: subChannel.id }) }] : []),
                ]
          }
        />
      )}
      {rowSub?.kind === 'leave' && subChannel && <ConfirmSheet title={t('Leave {name}?', { name: chanName(subChannel, p.users, p.me) })} text={subChannel.private ? t('It’s private: someone in it has to add you back.') : t('You can join again from Browse channels.')} yes={t('Leave')} onYes={() => p.onLeave(subChannel.id)} onClose={() => setRowSub(null)} />}
      {tileMenu && (
        <ActionSheet
          open
          onClose={() => setTileMenu(null)}
          title={TILE_NAMES[tileMenu]}
          actions={[
            ...(chat.tiles.order.indexOf(tileMenu) > 0 ? [{ label: t('Move left'), icon: ArrowLeft, run: () => moveTile(chat, tileMenu, -1) }] : []),
            ...(chat.tiles.order.indexOf(tileMenu) < chat.tiles.order.length - 1 ? [{ label: t('Move right'), icon: ArrowRight, run: () => moveTile(chat, tileMenu, 1) }] : []),
            { label: t('Hide this tile'), icon: EyeOff, run: () => (chat.setTiles({ ...chat.tiles, hidden: [...chat.tiles.hidden, tileMenu] }), toast({ text: t('{tile} hidden. Chat’s settings bring it back.', { tile: TILE_NAMES[tileMenu] }), action: { label: t('Undo'), run: () => chat.setTiles({ ...chat.tiles, hidden: chat.tiles.hidden.filter((x) => x !== tileMenu) }) } })) },
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

const moveTile = (chat: ChatState, id: TileId, by: -1 | 1) => {
  const order = [...chat.tiles.order];
  const i = order.indexOf(id);
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
        <button className="nav-more sec-more" aria-label={t('Section options')} onClick={(e) => onMenu(e.currentTarget)}>
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
  const guestBadge = c.category === 'shared' || c.guests?.length ? <Badge small tone="warn" title={t('The {whos} can see this channel', { whos: term.whos })}>{term.Whos}</Badge> : null;
  if (phone) {
    const last = info?.last;
    const mineLast = last?.userId === p.me;
    const who = last ? (mineLast ? t('You') : last.guestEmail ? (c.guests?.find((g) => g.email === last.guestEmail)?.name.split(' ')[0] ?? t('Guest')) : (p.users.find((u) => u.id === last.userId)?.name.split(' ')[0] ?? '')) : '';
    return (
      <button
        className={`cl-row lp${unread ? ' unread' : ''}${info?.muted ? ' muted' : ''}${p.current === c.id ? ' active' : ''}`}
        {...press}
        onClick={() => p.onOpen(c.id)}
        onContextMenu={(e) => (press.onContextMenu(e), e.preventDefault(), onMenu({ at: { x: e.clientX, y: e.clientY } }))}
        aria-label={[name, unread ? tn(info!.unread, '{n} unread', '{n} unread') : '', info?.draft ? t('draft') : ''].filter(Boolean).join(', ')}
      >
        <span className={`cl-icon${other ? ' is-dm' : ''}`}>{icon}</span>
        <span className="cl-main">
          <span className="cl-top">
            <span className="cl-name">
              {name}
              {st && <span className="st-emoji">{st.emoji}</span>}
              {guestBadge}
              {starred && <Star size={11} className="cl-star" aria-label={t('Starred')} />}
            </span>
            {last && <time dateTime={last.at}>{shortTime(last.at)}</time>}
          </span>
          <span className="cl-bottom">
            <span className="cl-preview">
              {info?.draft ? (
                <>
                  <PenLine size={12} className="cl-draft-icon" aria-hidden />
                  <em className="cl-draft">{t('Draft:')}</em> {info.draft.replace(/\s+/g, ' ')}
                </>
              ) : last ? (
                <>
                  {c.kind === 'channel' || mineLast ? `${who}: ` : ''}
                  {preview(last) || t('Sent something')}
                </>
              ) : (
                <span className="muted">{t('No messages yet')}</span>
              )}
            </span>
            {live && <Headphones size={14} className="cl-live" aria-label={t('Huddle on now')} />}
            {info?.muted && <BellOff size={13} className="cl-muted" aria-label={t('Muted')} />}
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
            <span className="st-emoji" title={statusText(st)}>
              {st.emoji}
            </span>
          )}
          {guestBadge}
        </span>
        {info?.draft && p.current !== c.id ? <PenLine size={13} className="nav-draft" aria-label={t('Draft')} /> : null}
        {live && <Headphones size={13} className="nav-live" aria-label={t('Huddle on now')} />}
        {info?.muted ? <BellOff size={12} className="nav-muted" aria-label={t('Muted')} /> : info?.mentions ? <span className="count">{info.mentions}</span> : unread && c.kind === 'dm' ? <span className="count">{info!.unread}</span> : null}
      </button>
      <button ref={more} className="nav-more" aria-label={t('Conversation options')} onClick={() => more.current && onMenu({ anchor: more.current })}>
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}

/** A look inside a conversation from the list, without marking it read. */
function Peek({ c, p, messages, read, onOpen }: { c: Channel; p: SidebarProps; messages: ChatMessage[]; read: string; onOpen: () => void }) {
  const last = messages.filter((m) => m.channelId === c.id && !m.sendAt && (!m.parentId || m.alsoInChannel)).sort((a, b) => a.at.localeCompare(b.at)).slice(-4);
  return (
    <button type="button" className="peek" onClick={onOpen} aria-label={t('Open {name}', { name: chanName(c, p.users, p.me) })}>
      <span className="peek-head">
        <strong>{chanName(c, p.users, p.me)}</strong>
        <span className="muted small">{t('Not marked read')}</span>
      </span>
      {last.length ? (
        last.map((m) => (
          <span key={m.id} className={`peek-line${m.at > read && m.userId !== p.me ? ' new' : ''}`}>
            <b>{m.userId === p.me ? t('You') : m.guestEmail ? (c.guests?.find((g) => g.email === m.guestEmail)?.name.split(' ')[0] ?? t('Guest')) : (p.users.find((u) => u.id === m.userId)?.name.split(' ')[0] ?? t('Someone'))}</b> {preview(m)}
          </span>
        ))
      ) : (
        <span className="peek-line muted">{t('No messages yet')}</span>
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
export function StatusPicker({ status, onStatus }: { status?: Status; onStatus: (s: Status | null) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <div className="status-pop">
      {STATUS_PRESETS.map((s) => (
        <button key={s.text} className={`sel-opt${status?.text === s.text ? ' on' : ''}`} onClick={() => onStatus(s)}>
          <span className="st-emoji big">{s.emoji}</span>
          {t(s.text)}
          {status?.text === s.text && <Check size={14} className="sel-check" />}
        </button>
      ))}
      <div className="status-custom">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t('Or type your own…')} aria-label={t('Your own status')} onKeyDown={(e) => e.key === 'Enter' && custom.trim() && (onStatus({ emoji: '💬', text: custom.trim() }), setCustom(''))} />
      </div>
      {status && (
        <button className="sel-opt danger" onClick={() => onStatus(null)}>
          <X size={14} /> {t('Clear status')}
        </button>
      )}
      <p className="muted small">{t('“In a meeting” is set for you automatically from your calendar.')}</p>
    </div>
  );
}

/** The tiles on top of the phone's chat list: show or hide each, and their order. */
function TilesEditor({ me }: { me: string }) {
  const chat = useChatState(me);
  const { order, hidden } = chat.tiles;
  return (
    <div className="tiles-editor">
      <p className="muted small">{t('Tiles show what to act on in Chat. Hold a tile in the list to move or hide it there too.')}</p>
      {order.map((id, i) => (
        <div key={id} className="te-tile">
          <SlidersHorizontal size={16} className="muted" aria-hidden />
          <span className="te-name">
            {TILE_NAMES[id]}
            {id === 'live' && <small>{t('Only while a huddle is on')}</small>}
          </span>
          <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => moveTile(chat, id, -1)} aria-label={t('Move {name} up', { name: TILE_NAMES[id] })}>
            <ChevronUp size={16} />
          </button>
          <button type="button" className="icon-btn sm" disabled={i === order.length - 1} onClick={() => moveTile(chat, id, 1)} aria-label={t('Move {name} down', { name: TILE_NAMES[id] })}>
            <ChevronDown size={16} />
          </button>
          <button type="button" role="switch" aria-checked={!hidden.includes(id)} aria-label={t('Show {name}', { name: TILE_NAMES[id] })} className={`switch ${hidden.includes(id) ? '' : 'on'}`} onClick={() => chat.setTiles({ order, hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] })}>
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
    <Sheet onClose={onClose} title={t('New message')} size="tall">
      <label className="sheet-search">
        <SearchIcon size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('To: a name or email')} aria-label={t('Who to message')} />
      </label>
      <div className="as-list">
        {onNewChannel && !s && (
          <button type="button" className="as-item" onClick={() => (onClose(), onNewChannel())}>
            <Hash size={18} className="as-icon" />
            <span className="as-label">
              {t('New channel')}
              <small>{t('A place for a team, a {project} or a topic', { project: term.one })}</small>
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
        {people.length === 0 && <p className="sheet-empty">{t('Nobody here is called “{q}”', { q })}</p>}
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
      sections: (['client', 'shared', 'team', 'project', 'social'] as ChannelCategory[]).map((cat) => ({ id: cat, name: categoryText(CATEGORY_NAME[cat]), channelIds: channels.filter((c) => (c.category ?? 'project') === cat).map((c) => c.id) })),
    });
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal view-modal" role="dialog" aria-label={t('Chat view')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <LayoutList size={15} /> {isNew ? t('Create a view') : t('Edit view')}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body connect-form">
          <SmoothHeight>
          <label className="field">
            <span>{t('Name')}</span>
            <input autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('e.g. My {projects}', { projects: term.many })} />
          </label>
          <div className="field">
            <span>{t('Sections')}</span>
            <div className="ve-sections">
              {v.sections.map((s, i) => (
                <div key={s.id} className="ve-sec">
                  <input value={s.name} onChange={(e) => setV({ ...v, sections: v.sections.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) })} />
                  <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => setV({ ...v, sections: v.sections.map((x, j, arr) => (j === i - 1 ? arr[i] : j === i ? arr[i - 1] : x)) })} aria-label={t('Move up')}>
                    <ChevronDown size={14} className="flip" />
                  </button>
                  <button type="button" className="icon-btn sm" onClick={() => setV({ ...v, sections: v.sections.filter((x) => x.id !== s.id) })} aria-label={t('Remove section')}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="ve-actions">
                <button type="button" className="ghost-btn sm" onClick={() => setV({ ...v, sections: [...v.sections, { id: 's' + Date.now().toString(36), name: t('New section'), channelIds: [] }] })}>
                  <Plus size={13} /> {t('Add section')}
                </button>
                <button type="button" className="link-btn" onClick={fromCategories}>
                  {t('Start from the default groups')}
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <span>{t('Where each channel goes')}</span>
            <div className="ve-channels">
              {channels.map((c) => (
                <div key={c.id} className="ve-ch">
                  <span>
                    {c.private ? <Lock size={13} /> : <Hash size={13} />} {c.name}
                  </span>
                  <Select
                    value={sectionOf(c.id)}
                    onChange={(sid) => place(c.id, sid)}
                    label={t('Section for {name}', { name: c.name })}
                    className="sel-flat"
                    options={[{ value: '', label: v.showRest ? t('Other channels') : t('Hidden in this view') }, ...v.sections.map((s) => ({ value: s.id, label: s.name || t('Untitled') }))]}
                  />
                </div>
              ))}
            </div>
          </div>
          <label className="set-row toggle-row">
            <span>
              <strong>{t('Show the rest under “Other channels”')}</strong>
              <small>{t('Off: channels you didn’t place are hidden in this view (you can still find them with ⌘K)')}</small>
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
              {t('Delete view')}
            </button>
          )}
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!v.name.trim()} onClick={() => onSave({ ...v, name: v.name.trim(), sections: v.sections.filter((s) => s.name.trim()) })}>
            {isNew ? t('Create view') : t('Save')}
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
      <div className="modal access-modal" role="dialog" aria-label={t('People with access')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Users size={15} /> {t('{section}: people with access', { section: sectionTitle(section) })}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body access-body">
          <SmoothHeight>
          <p className="muted small">
            {channels.length === 1
              ? priv
                ? t('Everyone here is in the channel in this section (it’s private), and in any channel added to it later. No need to invite them one by one.')
                : t('Everyone here is in the channel in this section, and in any channel added to it later. No need to invite them one by one.')
              : priv
                ? t('Everyone here is in all {n} channels in this section, including {priv} private, and in any channel added to it later. No need to invite them one by one.', { n: fmtNumber(channels.length), priv: fmtNumber(priv) })
                : t('Everyone here is in all {n} channels in this section, and in any channel added to it later. No need to invite them one by one.', { n: fmtNumber(channels.length) })}
          </p>
          <div className="field">
            <span>{t('Teams')}</span>
            <div className="team-toggles">
              {teams.map((tm) => (
                <button key={tm.id} type="button" className={teamIds.includes(tm.id) ? 'on' : ''} onClick={() => setTeamIds((x) => (x.includes(tm.id) ? x.filter((y) => y !== tm.id) : [...x, tm.id]))}>
                  <span className="team-square" style={{ background: tm.color }} /> {tm.name}
                  <small>{tm.members.length}</small>
                </button>
              ))}
            </div>
            <small className="muted">{t('New team members get access automatically.')}</small>
          </div>
          <div className="field">
            <span>{t('People')}</span>
            <PeoplePicker value={userIds} users={users} me={me} onChange={setUserIds} label={t('People with access')} emptyText={t('Add people')} max={8} />
          </div>
          <p className="small">
            {everyone.length === 1 ? tj('{n} person has access.', { n: <b>{fmtNumber(1)}</b> }) : tj('{n} people have access.', { n: <b>{fmtNumber(everyone.length)}</b> })}
            {removed.length > 0 && <span className="muted"> {tn(removed.length, '{n} will leave this section’s channels (channel owners stay).', '{n} will leave this section’s channels (channel owners stay).')}</span>}
          </p>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={() => onSave({ userIds, teamIds })}>
            {t('Save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
