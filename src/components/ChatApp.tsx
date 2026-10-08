import { TabBar } from './ui/TabBar';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SmoothHeight, TabPane } from './ui/Smooth';
import { term } from '../terms';
import { companyOf } from '../clientView';
import { AlertTriangle, FolderPlus, ChevronUp, Handshake, ArrowLeft, ArrowUp, BarChart3, ChevronDown, ChevronRight, Check, LayoutList, Pencil, Compass, FileText, Hash, Image as ImageIcon, ListChecks, Lock, Mail, Menu, MessageSquareReply, Mic, MoreHorizontal, Paperclip, HardDrive, Pin, Pause, Play, Plus, Settings, SmilePlus, Sparkles, SquareCheck, Star, Trash2, Users, Video, X, Headphones } from 'lucide-react';
import type { Channel, ChannelCategory, ChatLayout, ChatSection, ChatFile, ChatMessage, ChatView as ChatViewDef, Client, DriveItem, Role, Status, Team, Thread, Todo, User } from '../types';
import { localDay, relative } from '../utils';
import { usePersisted } from '../settings';
import { ai } from '../ai';
import { Avatar } from './Avatar';
import { dueLabel } from './TasksView';
import { stageName, stageOf } from '../stages';
import { DatePicker } from './ui/DatePicker';
import { Popover } from './ui/Popover';
import { PeoplePicker } from './ui/PeoplePicker';
import { Select } from './ui/Select';
import { CATEGORY_NAME, CATEGORY_ONE } from './ChannelDialog';
import { ChannelMaterials } from './ChannelMaterials';
import { personOption } from './ui/PeopleList';
import { server, uploadFile, wasSkipped } from '../sync';
import { channelSchedule, companyTz, nextSummaryDay, settledKey } from '../jobTimes';

const dmOther = (c: Channel, me: string) => c.members.find((m) => m !== me) ?? me;
export const QUICK_REACTIONS = ['👍', '🔥', '🙌', '😂', '❤️', '👀', '✅', '🙏'];
// "In a meeting" comes from the calendar on its own; people only set Focus, Away or their own words.
const STATUS_PRESETS: Status[] = [
  { emoji: '🎯', text: 'Focusing, slow to reply' },
  { emoji: '🌴', text: 'Away' },
];
const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export type Presence = 'active' | 'away' | 'meeting';

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

/* ---------------- Sidebar ---------------- */

type BuiltIn = 'default' | 'unread' | 'recent';

interface SidebarProps {
  channels: Channel[]; // this workspace's channels I can see (member, or public)
  users: User[];
  me: string;
  workspaceId: string;
  current: string | null;
  unread: Record<string, number>;
  lastAt: Record<string, string>; // channel id -> last message time
  statuses: Record<string, Status>;
  presence: (id: string) => Presence;
  onOpen: (id: string) => void;
  onJoin: (id: string) => void;
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
  const [views, setViews] = usePersisted<ChatViewDef[]>(`s2g-chat-views:${p.me}:${p.workspaceId}`, []);
  const [viewId, setViewId] = usePersisted<string>(`s2g-chat-view:${p.me}:${p.workspaceId}`, 'default');
  const [starred, setStarred] = usePersisted<string[]>(`s2g-chat-starred:${p.me}:${p.workspaceId}`, []);
  const [collapsed, setCollapsed] = usePersisted<string[]>(`s2g-chat-collapsed:${p.me}:${p.workspaceId}`, []);
  const [editing, setEditing] = useState<ChatViewDef | null>(null);
  const [addingDm, setAddingDm] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  // The company's Default layout: admins add, rename and order sections and place channels for everyone.
  const [newSection, setNewSection] = useState<{ name: string; channelId?: string } | null>(null);
  const [secMenu, setSecMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const secAnchor = useRef<HTMLElement | null>(null);
  const layout = fullLayout(p.layout);
  const sectionOf = (c: Channel) => sectionIdOf(layout, c);
  const [accessFor, setAccessFor] = useState<string | null>(null);
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
  const [statusOpen, setStatusOpen] = useState(false);
  const [customStatus, setCustomStatus] = useState('');
  const menuAnchor = useRef<HTMLElement | null>(null);
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

  const toggle = (key: string) => setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);
  const recency = (c: Channel) => p.lastAt[c.id] ?? '';

  const row = (c: Channel) => {
    const other = c.kind === 'dm' ? p.users.find((u) => u.id === dmOther(c, p.me)) : undefined;
    const st = other ? p.statuses[other.id] : undefined;
    return (
      <div
        key={c.id}
        className={`nav-row ${p.current === c.id ? 'active' : ''}`}
        draggable={c.kind === 'channel' && (active === 'custom' || (active === 'default' && (p.isAdmin || p.canManage(c))))}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/s2g-channel', c.id);
          e.dataTransfer.effectAllowed = 'move';
          setDropOn(''); // dragging: show empty sections as drop targets
        }}
        onDragEnd={() => setDropOn(null)}
      >
        <button className={`nav-item ${p.current === c.id ? 'active' : ''} ${p.unread[c.id] ? 'has-unread' : ''}`} onClick={() => p.onOpen(c.id)} title={other ? other.name : `#${c.name}`}>
          {other ? (
            <span className="dm-av">
              <Avatar person={other} size={20} />
              <i className={`presence ${p.presence(other.id)}`} />
            </span>
          ) : c.category === 'shared' ? (
            <Handshake size={15} />
          ) : c.private ? (
            <Lock size={15} />
          ) : (
            <Hash size={16} />
          )}
          <span className="sb-label">
            {other ? other.name : c.name}
            {st && <span className="st-emoji" title={st.text}>{st.emoji}</span>}
            {c.category === 'shared' || c.guests?.length ? <em className="ext-tag" title={`The ${term.whos} can see this channel`}>{term.whos}</em> : null}
          </span>
          {p.unread[c.id] ? <span className="count">{p.unread[c.id]}</span> : null}
        </button>
        <button
          className="nav-more"
          aria-label="Channel options"
          onClick={(e) => {
            menuAnchor.current = e.currentTarget;
            setMenuFor(c.id);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    );
  };

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
          <div className="sec-head-row">
            <button className="nav-heading sb-label sec-head" onClick={() => toggle(key)}>
              <ChevronRight size={12} className={`rot-chev ${closed ? '' : 'open'}`} /> {title}
              {(() => {
                const n = list.reduce((sum, c) => sum + (p.unread[c.id] ?? 0), 0);
                return closed && n ? <span className="sec-count unread">{n}</span> : null; // collapsed: show what you'd miss
              })()}
            </button>
            {mineId && (
              <button
                className="nav-more sec-more"
                aria-label="Section options"
                onClick={(e) => {
                  secAnchor.current = e.currentTarget;
                  setSecMenu(mineId);
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>
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
  let body: ReactNode;
  if (active === 'default') {
    body = layout.sections.map((sec) =>
      section(
        sec.id,
        sec.name,
        rooms.filter((c) => sectionOf(c) === sec.id && !star.has(c.id)),
        !sec.category && p.isAdmin && !rooms.some((c) => sectionOf(c) === sec.id) ? <p className="muted small sec-empty sb-label">Drag channels here, or use a channel’s … menu.</p> : undefined,
        (id) => placeIn(id, sec.id),
        p.isAdmin ? sec.id : undefined,
      ),
    );
  } else if (active === 'unread') {
    const list = rooms.filter((c) => !star.has(c.id)).sort((a, b) => (p.unread[b.id] ?? 0) - (p.unread[a.id] ?? 0) || recency(b).localeCompare(recency(a)));
    body = [section('u-unread', 'Unread', list.filter((c) => p.unread[c.id])), section('u-rest', 'Everything else', list.filter((c) => !p.unread[c.id]))];
  } else if (active === 'recent') {
    body = section('recent', 'Most recent first', rooms.filter((c) => !star.has(c.id)).sort((a, b) => recency(b).localeCompare(recency(a))));
  } else if (custom) {
    const used = new Set(custom.sections.flatMap((s) => s.channelIds));
    const moveInView = (id: string, to: string | null) =>
      setViews(views.map((v) => (v.id === custom.id ? { ...custom, sections: custom.sections.map((x) => ({ ...x, channelIds: x.id === to ? [...new Set([...x.channelIds, id])] : x.channelIds.filter((y) => y !== id) })) } : v)));
    body = [
      ...custom.sections.map((s) => section(`${custom.id}:${s.id}`, s.name, rooms.filter((c) => s.channelIds.includes(c.id) && !star.has(c.id)), undefined, (id) => moveInView(id, s.id))),
      custom.showRest ? section(`${custom.id}:rest`, 'Other channels', rooms.filter((c) => !used.has(c.id) && !star.has(c.id)), undefined, (id) => moveInView(id, null)) : null,
    ];
  }

  const viewOptions = [
    { value: 'default', label: 'Company default', hint: 'Sections your admins set for everyone', group: 'Built in' },
    { value: 'unread', label: 'Unread first', hint: 'What needs you on top', group: 'Built in' },
    { value: 'recent', label: 'Recent', hint: 'Latest activity first', group: 'Built in' },
    ...views.map((v) => ({ value: v.id, label: v.name, hint: `${v.sections.length} section${v.sections.length === 1 ? '' : 's'}`, group: 'Your views' })),
    { value: '__new', label: 'Create a view…', hint: 'Your own sections and channels', group: 'Your views', icon: <Plus size={14} /> },
  ];
  const menuChannel = p.channels.find((c) => c.id === menuFor);

  return (
    <>
      <button ref={statusBtn} className="status-btn sb-label" onClick={() => setStatusOpen(true)}>
        <span className="st-emoji big">{myStatus?.emoji ?? '🙂'}</span>
        <span className="sb-label">{myStatus?.text ?? 'Set a status'}</span>
      </button>
      <Popover anchor={statusBtn} open={statusOpen} onClose={() => setStatusOpen(false)} width={280} title="Your status">
        <div className="status-pop">
          {STATUS_PRESETS.map((s) => (
            <button key={s.text} className="sel-opt" onClick={() => (p.onStatus(s), setStatusOpen(false))}>
              <span className="st-emoji big">{s.emoji}</span>
              {s.text}
            </button>
          ))}
          <div className="status-custom">
            <input value={customStatus} onChange={(e) => setCustomStatus(e.target.value)} placeholder="Or type your own…" onKeyDown={(e) => e.key === 'Enter' && customStatus.trim() && (p.onStatus({ emoji: '💬', text: customStatus.trim() }), setStatusOpen(false), setCustomStatus(''))} />
          </div>
          {myStatus && (
            <button className="sel-opt danger" onClick={() => (p.onStatus(null), setStatusOpen(false))}>
              <X size={14} /> Clear status
            </button>
          )}
          <p className="muted small">“In a meeting” is set for you automatically from your calendar.</p>
        </div>
      </Popover>

      <div className="view-bar sb-label">
        <Select
          value={custom ? custom.id : active}
          onChange={(v) => {
            if (v === '__new') setEditing({ id: 'v-' + Date.now().toString(36), name: 'My view', sections: [{ id: 's1', name: 'Focus', channelIds: [] }], showRest: true });
            else setViewId(v);
          }}
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

      {section(
        'starred',
        <>
          <Star size={11} /> Starred
        </>,
        starredList,
      )}
      {body}
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

      {section(
        'dms',
        'Direct messages',
        dms.filter((c) => !star.has(c.id)),
        addingDm ? (
          <div className="add-client sb-label">
            <Select
              value={null}
              placeholder="Message someone…"
              label="Message someone"
              searchable
              onChange={(v) => (p.onNewDm(v), setAddingDm(false))}
              options={p.users.filter((u) => u.id !== p.me && !dmWith.has(u.id)).map((u) => ({ ...personOption(u), label: u.name, hint: u.title, icon: <Avatar person={u} size={22} /> }))}
            />
          </div>
        ) : (
          <button className="nav-item" onClick={() => setAddingDm(true)} title="New message">
            <Plus size={16} />
            <span className="sb-label">New message</span>
          </button>
        ),
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

      {accessFor && (
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
      )}

      <Popover anchor={menuAnchor} open={!!menuChannel} onClose={() => setMenuFor(null)} width={250} title={menuChannel ? (menuChannel.kind === 'dm' ? 'Conversation' : `#${menuChannel.name}`) : ''}>
        {menuChannel && (
          <div className="sel-pop">
            <button className="sel-opt" onClick={() => (setStarred(star.has(menuChannel.id) ? starred.filter((x) => x !== menuChannel.id) : [...starred, menuChannel.id]), setMenuFor(null))}>
              <Star size={14} /> {star.has(menuChannel.id) ? 'Remove from Starred' : 'Star'}
            </button>
            {custom && menuChannel.kind === 'channel' && (
              <>
                <div className="sel-group">Move to section in “{custom.name}”</div>
                {custom.sections.map((s) => (
                  <button
                    key={s.id}
                    className="sel-opt"
                    onClick={() => {
                      const next = { ...custom, sections: custom.sections.map((x) => ({ ...x, channelIds: x.id === s.id ? [...new Set([...x.channelIds, menuChannel.id])] : x.channelIds.filter((y) => y !== menuChannel.id) })) };
                      setViews(views.map((v) => (v.id === custom.id ? next : v)));
                      setMenuFor(null);
                    }}
                  >
                    {s.name}
                    {s.channelIds.includes(menuChannel.id) && <Check size={14} className="sel-check" />}
                  </button>
                ))}
              </>
            )}
            {!custom && menuChannel.kind === 'channel' && (
              <>
                <div className="sel-group">Move to (for everyone)</div>
                {layout.sections.filter((sec) => canPlace(menuChannel, sec)).map((sec) => (
                  <button key={sec.id} className="sel-opt" onClick={() => (setMenuFor(null), placeIn(menuChannel.id, sec.id))}>
                    {sec.name}
                    {sectionOf(menuChannel) === sec.id && <Check size={14} className="sel-check" />}
                  </button>
                ))}
                {p.isAdmin && (
                  <button className="sel-opt" onClick={() => (setMenuFor(null), setNewSection({ name: '', channelId: menuChannel.id }))}>
                    <Plus size={14} /> New section…
                  </button>
                )}
                {!p.isAdmin && !p.canManage(menuChannel) && <p className="muted small menu-note">Admins arrange the company’s sidebar. For your own arrangement, choose “Create a view…” in the View menu.</p>}
                {(p.isAdmin || p.canManage(menuChannel)) && <p className="muted small menu-note">Tip: you can also drag a channel onto another section.</p>}
              </>
            )}
            {menuChannel.kind === 'channel' && (
              <button className="sel-opt" onClick={() => (setMenuFor(null), p.onSettings(menuChannel.id))}>
                <Settings size={14} /> Channel settings
              </button>
            )}
          </div>
        )}
      </Popover>

      {editing && (
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
      )}
    </>
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

/* ---------------- Conversation ---------------- */

export interface SendPayload {
  text: string;
  parentId?: string;
  alsoInChannel?: boolean;
  files?: ChatFile[];
  voice?: ChatMessage['voice'];
  poll?: ChatMessage['poll'];
  kind?: ChatMessage['kind'];
  kudosFor?: string;
}

interface ViewProps {
  channel: Channel | null;
  messages: ChatMessage[]; // the whole channel, threads included
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
  onSend: (p: SendPayload) => void;
  onDelete: (id: string) => void;
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
  onSettings: () => void;
  onMenu: () => void;
  onBack?: () => void; // phones: back to the channel list
  /** Someone at a client (their portal): messages and materials only, none of the team's tools. */
  guest?: { canPost: boolean };
  huddle?: { joined: boolean; onJoin: () => void }; // a quick voice call in this channel
  /** Land on this message (from a notification): open its thread if it's a reply, scroll to it and highlight it. */
  focusId?: string | null;
  onFocused?: () => void;
  /** The company's time zone (Settings, General): when scheduled summaries are written. */
  timeZone?: string;
}

/** "@Rizky" → <b>@Rizky</b>; links clickable; keeps everything else as text. */
function Text({ text, users }: { text: string; users: User[] }) {
  const names = users.map((u) => u.name.split(' ')[0]).join('|');
  const re = new RegExp(`(${names ? `@(?:${names})\\b|` : ''}https?://\\S+)`, 'g');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('@') ? (
          <b key={i} className="mention">
            {p}
          </b>
        ) : /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
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

export function ChatView(p: ViewProps) {
  const { channel, users, me } = p;
  const [text, setText] = useState('');
  const [mention, setMention] = useState<string | null>(null);
  const [tab, setTab] = useState<'messages' | 'materials' | 'tasks' | 'pinned' | 'summary' | 'about'>('messages');
  const [summarizing, setSummarizing] = useState<'period' | 'since' | null>(null);
  const [sinceText, setSinceText] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskWho, setTaskWho] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [kudos, setKudos] = useState<{ who: string; text: string } | null>(null);
  const [rec, setRec] = useState<{ start: number; secs: number; stream?: MediaStream; recorder?: MediaRecorder; chunks: Blob[] } | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const reactAnchor = useRef<HTMLElement | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const plusBtn = useRef<HTMLButtonElement>(null);
  const person = (id: string) => users.find((u) => u.id === id);
  const client = channel?.clientId ? p.clients.find((c) => c.id === channel.clientId) : undefined;
  const team = channel?.teamId ? p.teams.find((t) => t.id === channel.teamId) : undefined;
  const sorted = useMemo(() => [...p.messages].sort((a, b) => a.at.localeCompare(b.at)), [p.messages]);
  const top = sorted.filter((m) => !m.parentId || m.alsoInChannel);
  const replies = (id: string) => sorted.filter((m) => m.parentId === id);
  const guest = p.guest;
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

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [channel?.id, top.length]);
  useEffect(() => {
    input.current?.focus();
    setText('');
    setThreadId(null);
    setKudos(null);
    setTab('messages');
    setSinceText(null);
  }, [channel?.id]);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRec((r) => r && { ...r, secs: (Date.now() - r.start) / 1000 }), 250);
    return () => clearInterval(t);
  }, [rec?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(
    () => (mention === null ? [] : users.filter((u) => u.id !== me && u.name.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 5)),
    [mention, users, me],
  );
  const slash = !guest && text.startsWith('/') && !text.includes(' ') ? COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase())) : [];

  if (!channel)
    return (
      <section className="chat-pane chat-empty view-enter">
        <Hash size={28} />
        <p className="empty-title">Pick a channel or person</p>
        <p className="empty-sub">{term.One} channels keep every conversation about a {term.one} in one place.</p>
      </section>
    );

  const other = channel.kind === 'dm' ? person(dmOther(channel, me)) : undefined;
  const title = other ? other.name : channel.category === 'shared' ? channel.name : `#${channel.name}`;
  const chanFiles = p.messages.flatMap((m) => (m.files ?? []).map((f) => ({ f, m })));
  const chanTasks = p.tasks.filter((t) => t.kind !== 'brief' && (t.channelId === channel.id || (client && t.clientId === client.id) || (team && t.teamId === team.id)));
  const pinned = sorted.filter((m) => m.pinned);
  const links = sorted.flatMap((m) =>
    (m.text.match(/https?:\/\/[^\s)]+/g) ?? []).map((url, i) => ({
      key: m.id + i,
      url,
      at: m.at,
      who: m.guestEmail ? (channel.guests?.find((g) => g.email === m.guestEmail)?.name ?? 'Guest') : (person(m.userId)?.name.split(' ')[0] ?? 'Someone'),
    })),
  ).reverse();

  // The schedule the server runs (server/summaries.ts): when the next one comes, and what happened to the last one.
  const schedule = channelSchedule(channel);
  const lastRun = channel.summary?.last;
  const nextDay = nextSummaryDay(schedule, settledKey(lastRun), Date.now(), companyTz({ timeZone: p.timeZone }), !!lastRun);
  const nextRun = () => (!nextDay ? '' : nextDay === localDay() ? 'today' : new Date(`${nextDay}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }));
  const lastMissed = lastRun && (lastRun.state === 'off' || lastRun.state === 'failed') && lastRun.key === settledKey(lastRun) ? lastRun : null;
  const lastRetrying = lastRun?.state === 'failed' && !settledKey(lastRun) ? lastRun : null;
  /** AI summary of a period (this month / week / day) or of what I missed. Only on click, or on the schedule. */
  const summarize = async (kind: 'period' | 'since') => {
    setSummarizing(kind);
    const sch = schedule === 'off' ? 'monthly' : schedule;
    const from = kind === 'since' ? p.since : new Date(Date.now() - (sch === 'daily' ? 1 : sch === 'weekly' ? 7 : 31) * 86_400_000).toISOString();
    const msgs = sorted.filter((m) => m.at > from).map((m) => ({
      who: m.guestEmail ? (channel.guests?.find((g) => g.email === m.guestEmail)?.name ?? 'Guest') : (person(m.userId)?.name.split(' ')[0] ?? 'Someone'),
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

  const send = () => {
    const t = text.trim();
    if (!t) return;
    if (t.startsWith('/') && runCommand(t)) {
      setText('');
      return;
    }
    p.onSend({ text: t });
    setText('');
    setMention(null);
  };
  const pickMention = (u: User) => {
    setText((t) => t.replace(/@(\w*)$/, `@${u.name.split(' ')[0]} `));
    setMention(null);
    input.current?.focus();
  };
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    // To the server first, so the file is there for everyone and after a reload (a data URL in the demo).
    const files: ChatFile[] = [];
    for (const f of [...list]) {
      try {
        const up = await uploadFile(f, channel.workspaceId);
        files.push({ name: f.name, size: f.size, type: up.type, url: up.url });
      } catch (e) {
        if (wasSkipped(e)) continue; // they chose not to upload a big file
        // On a real server a file only this browser has would look sent but nobody else could open it: say why instead.
        if (server.on) window.dispatchEvent(new CustomEvent('s2g:save-failed', { detail: { error: `${f.name}: ${(e as Error).message}` } }));
        else files.push({ name: f.name, size: f.size, type: f.type || 'application/octet-stream', url: URL.createObjectURL(f) });
      }
    }
    if (!files.length) return;
    p.onSend({ text: text.trim(), files });
    setText('');
  };

  // Voice notes: the browser's recorder when allowed; otherwise a timed demo note.
  const startRec = async () => {
    setPlusOpen(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
      setRec({ start: Date.now(), secs: 0, stream, recorder, chunks });
    } catch {
      setRec({ start: Date.now(), secs: 0, chunks: [] });
    }
  };
  const stopRec = (keep: boolean) => {
    if (!rec) return;
    const secs = Math.max(1, Math.round((Date.now() - rec.start) / 1000));
    const finish = (url?: string) => {
      rec.stream?.getTracks().forEach((t) => t.stop());
      if (keep) p.onSend({ text: '', voice: { seconds: secs, url } });
      setRec(null);
    };
    if (rec.recorder && rec.recorder.state !== 'inactive') {
      rec.recorder.onstop = () => {
        const blob = new Blob(rec.chunks, { type: 'audio/webm' });
        void uploadFile(blob, channel.workspaceId, 'voice-note.webm').then((up) => finish(up.url)).catch(() => finish(URL.createObjectURL(blob)));
      };
      rec.recorder.stop();
    } else finish();
  };

  const authorOf = (m: ChatMessage) => {
    if (m.guestEmail) {
      const g = channel.guests?.find((x) => x.email === m.guestEmail);
      return { name: `${g?.name ?? m.guestEmail}${m.via === 'whatsapp' ? ' · WhatsApp' : ''}`, guest: true, person: { name: g?.name ?? m.guestEmail, email: m.guestEmail } };
    }
    const u = person(m.userId);
    return { name: m.userId === me ? 'You' : (u?.name ?? 'Someone'), guest: false, person: u };
  };

  const message = (m: ChatMessage, grouped: boolean, inThread = false) => {
    if (m.kind === 'celebration')
      return (
        <div key={m.id} className="chat-celebration">
          <span>🎉 {m.text}</span>
          <time>{relative(m.at)}</time>
        </div>
      );
    if (m.kind === 'summary')
      return (
        <div key={m.id} data-msg={m.id} className="chat-summary">
          <div className="chat-summary-head">
            <Sparkles size={13} aria-hidden /> Summary{m.summaryOf ? `, ${m.summaryOf}` : ''}
            <time>{relative(m.at)}</time>
          </div>
          <p>{m.text}</p>
        </div>
      );
    if (m.kind === 'system')
      return (
        <div key={m.id} className="chat-celebration system">
          <span>
            {authorOf(m).name} {m.text}
          </span>
          <time>{relative(m.at)}</time>
        </div>
      );
    const a = authorOf(m);
    const task = m.taskId ? p.tasks.find((t) => t.id === m.taskId) : undefined;
    const reps = inThread ? [] : replies(m.id);
    const st = !a.guest ? p.statuses[m.userId] : undefined;
    return (
      <div key={m.id} data-msg={m.id} className={`chat-msg ${grouped ? 'grouped' : ''} ${m.kind === 'kudos' ? 'kudos-msg' : ''}`}>
        {grouped ? <span className="cm-gutter" /> : a.person ? <Avatar person={a.person} size={34} /> : <span className="cm-gutter" />}
        <div className="cm-body">
          {!grouped && (
            <div className="cm-head">
              <strong>{a.name}</strong>
              {a.guest && <span className="guest-badge">Guest{(() => { const co = companyOf(a.person?.email ?? '', client?.people?.find((x) => x.email === a.person?.email)?.company, client); return co ? ` · ${co}` : ''; })()}</span>}
              {st && <span className="st-emoji" title={st.text}>{st.emoji}</span>}
              <time>{relative(m.at)}</time>
              {m.parentId && m.alsoInChannel && !inThread && <span className="muted small">replied in a thread</span>}
            </div>
          )}
          {m.kind === 'kudos' ? (
            <div className="kudos-card">
              <span className="kudos-emoji">🙌</span>
              <span>
                <strong>Kudos to {m.kudosFor === me ? 'you' : person(m.kudosFor ?? '')?.name}</strong>
                {m.text && <span> {m.text}</span>}
              </span>
            </div>
          ) : (
            m.text && (
              <div className="cm-text">
                <Text text={m.text} users={users} />
              </div>
            )
          )}
          {m.voice && <VoiceNote voice={m.voice} />}
          {m.poll && (
            <div className="poll">
              <div className="poll-q">
                <BarChart3 size={14} /> {m.poll.question}
              </div>
              {m.poll.options.map((o, i) => {
                const total = m.poll!.options.reduce((s, x) => s + x.votes.length, 0) || 1;
                const mineVote = o.votes.includes(me);
                return (
                  <button key={i} className={`poll-opt ${mineVote ? 'on' : ''}`} onClick={() => p.onVote(m.id, i)}>
                    <span className="poll-fill" style={{ width: `${(o.votes.length / total) * 100}%` }} />
                    <span className="poll-text">{o.text}</span>
                    <span className="poll-votes">
                      {o.votes.slice(0, 3).map((v) => person(v) && <Avatar key={v} person={person(v)!} size={16} />)}
                      {o.votes.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {m.files?.map((f) => (
            <a key={f.name} className="chat-file" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => !f.url && e.preventDefault()}>
              <span className="cf-icon">{f.type.startsWith('video') ? <Video size={16} /> : f.type.startsWith('image') ? <ImageIcon size={16} /> : <FileText size={16} />}</span>
              <span className="cf-text">
                <strong>{f.name}</strong>
                <small>
                  {fmtSize(f.size)}
                  {client ? ` · saved to Drive › ${client.name}` : ' · saved to Drive'}
                </small>
              </span>
            </a>
          ))}
          {task && (
            <button className={`cm-task ${task.done ? 'done' : ''}`} onClick={() => p.onOpenTask(task.id)}>
              <SquareCheck size={14} />
              <span>{task.title}</span>
              <em>
                {stageName(stageOf(task))} · {person(task.userId)?.name.split(' ')[0] ?? 'team queue'}
              </em>
            </button>
          )}
          {m.reactions && Object.keys(m.reactions).some((k) => m.reactions![k].length) && (
            <div className="reactions">
              {Object.entries(m.reactions)
                .filter(([, who]) => who.length)
                .map(([emoji, who]) => (
                  <button key={emoji} className={`reaction ${who.includes(me) ? 'on' : ''}`} onClick={() => p.onReact(m.id, emoji)} title={who.map((w) => (w === me ? 'You' : person(w)?.name.split(' ')[0])).join(', ')}>
                    {emoji} <b>{who.length}</b>
                  </button>
                ))}
              <button
                className="reaction add"
                onClick={(e) => {
                  reactAnchor.current = e.currentTarget;
                  setReactFor(m.id);
                }}
                aria-label="Add reaction"
              >
                <SmilePlus size={13} />
              </button>
            </div>
          )}
          {reps.length > 0 && (
            <button className="thread-link" onClick={() => setThreadId(m.id)}>
              <span className="tl-avs">{[...new Set(reps.map((r) => r.userId))].slice(0, 3).map((u) => person(u) && <Avatar key={u} person={person(u)!} size={18} />)}</span>
              <b>
                {reps.length} repl{reps.length === 1 ? 'y' : 'ies'}
              </b>
              <span className="muted">Last reply {relative(reps[reps.length - 1].at)}</span>
            </button>
          )}
        </div>
        <div className="cm-tools">
          {!guest && (
            <button
              title="React"
              onClick={(e) => {
                reactAnchor.current = e.currentTarget;
                setReactFor(m.id);
              }}
            >
              <SmilePlus size={15} />
            </button>
          )}
          {!inThread && (
            <button title="Reply in thread" onClick={() => setThreadId(m.id)}>
              <MessageSquareReply size={15} />
            </button>
          )}
          {!inThread && !guest && (
            <button title={m.pinned ? 'Unpin' : 'Pin to the channel'} onClick={() => p.onPin(m.id)}>
              <Pin size={15} className={m.pinned ? 'pinned' : ''} />
            </button>
          )}
          {!guest && !task && m.kind !== 'kudos' && m.text && (
            <button title="Turn into a task" onClick={() => p.onMakeTask(m)}>
              <ListChecks size={15} />
            </button>
          )}
          {!guest && m.userId === me && !m.guestEmail && (
            <button title="Delete" onClick={() => p.onDelete(m.id)}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Group consecutive messages by the same person within 5 minutes.
  let prev: ChatMessage | null = null;
  let prevDay = '';

  const composer = canPost ? (
    <div className="chat-compose">
      {suggestions.length > 0 && (
        <div className="mention-pop">
          {suggestions.map((u) => (
            <button key={u.id} onMouseDown={(e) => (e.preventDefault(), pickMention(u))}>
              <Avatar person={u} size={22} /> {u.name}
            </button>
          ))}
        </div>
      )}
      {slash.length > 0 && (
        <div className="mention-pop">
          {slash.map((c) => (
            <button key={c.cmd} onMouseDown={(e) => (e.preventDefault(), setText(c.cmd + ' '), input.current?.focus())}>
              <b>{c.cmd}</b> <span className="muted small">{c.hint}</span>
            </button>
          ))}
        </div>
      )}
      {rec ? (
        <div className="rec-bar">
          <span className="rec-dot" /> Recording {fmtSecs(rec.secs)}
          {!rec.recorder && <span className="muted small">(demo: microphone not available here)</span>}
          <span className="spacer" />
          <button className="ghost-btn sm" onClick={() => stopRec(false)}>
            Cancel
          </button>
          <button className="primary-btn sm" onClick={() => stopRec(true)}>
            Send voice note
          </button>
        </div>
      ) : (
        <>
          <button ref={plusBtn} className="icon-btn compose-plus" onClick={() => setPlusOpen((o) => !o)} aria-label="More: files, voice, poll, kudos">
            <Plus size={18} />
          </button>
          <textarea
            ref={input}
            id="chat-input"
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const m = /@(\w*)$/.exec(e.target.value);
              setMention(m ? m[1] : null);
            }}
            onPaste={(e) => e.clipboardData.files.length && (e.preventDefault(), onFiles(e.clipboardData.files))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (suggestions.length && mention !== null) pickMention(suggestions[0]);
                else if (slash.length === 1 && text.trim() === slash[0].cmd.slice(0, text.trim().length) && text.trim() !== slash[0].cmd) setText(slash[0].cmd + ' ');
                else send();
              }
              if (e.key === 'Escape') setMention(null);
            }}
            placeholder={guest ? `Message ${title}` : `Message ${title}  ·  type / for commands`}
          />

          {text.trim() || guest ? (
            <button className="ai-send chat-send" onClick={send} aria-label="Send" disabled={!text.trim()}>
              <ArrowUp size={16} />
            </button>
          ) : (
            <button className="icon-btn mic-btn" onClick={startRec} aria-label="Record a voice note">
              <Mic size={18} />
            </button>
          )}
        </>
      )}
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
      <Popover anchor={plusBtn} open={plusOpen} onClose={() => setPlusOpen(false)} width={240} title="Add to message">
        <div className="sel-pop">
          <button className="sel-opt" onClick={() => (setPlusOpen(false), fileInput.current?.click())}>
            <Paperclip size={15} /> Upload a file
          </button>
          {!guest && (
            <>
              <button className="sel-opt" onClick={startRec}>
                <Mic size={15} /> Record a voice note
              </button>
              <button className="sel-opt" onClick={() => (setPlusOpen(false), setKudos({ who: '', text: '' }))}>
                <span>🙌</span> Give kudos
              </button>
              <button className="sel-opt" onClick={() => (setPlusOpen(false), runCommand('/meet'))}>
                <Video size={15} /> Share the meeting link
              </button>
            </>
          )}
        </div>
      </Popover>

    </div>
  ) : (
    <div className="chat-locked">
      <Lock size={14} /> Only admins post in #{channel.name}. You can still react and reply in threads.
    </div>
  );

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
              <span>{channel.members.length + (channel.guests?.length ?? 0)}</span>
            </button>
          )}
          {channel.kind === 'channel' && !guest && (
            <button className="icon-btn sm" onClick={p.onSettings} title="Channel settings">
              <Settings size={16} />
            </button>
          )}

        </header>

        <TabBar
          storageKey="channel-tabs"
          className="chan-tabs"
          value={tab}
          onSelect={(id) => setTab(id as typeof tab)}
          fixed={['messages']}
          items={(
            [
              ['messages', 'Messages', null],
              ['materials', 'Materials', (channel.materials?.items.length ?? channel.bookmarks?.length ?? 0) + chanFiles.length + p.drive.length + new Set(links.map((l) => l.url)).size],
              ['tasks', 'Tasks', chanTasks.filter((t) => !t.done && !!t.due && t.due < localDay()).length], // late only
              ['pinned', 'Pinned', pinned.length],
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
        {tab === 'materials' && (
          <>
            <p className="space-used chan-space">
              <HardDrive size={14} /> {chanFiles.length ? <>Files shared here use <b>{fmtSize(chanFiles.reduce((s2, x) => s2 + x.f.size, 0))}</b> of team storage</> : 'Files, links and docs for this channel, in folders if you like'}
              {p.drive.length ? <span className="muted"> · {fmtSize(p.drive.reduce((s2, d) => s2 + d.size, 0))} in {client?.name}’s Drive folder</span> : null}
            </p>
            <ChannelMaterials
              channel={channel}
              users={users}
              me={me}
              chatFiles={[
                ...chanFiles.map(({ f, m }) => ({ key: `file:${m.id}:${f.name}`, name: f.name, type: f.type, size: f.size, url: f.url, who: m.guestEmail ? (channel.guests?.find((g) => g.email === m.guestEmail)?.name ?? 'Guest') : (person(m.userId)?.name.split(' ')[0] ?? 'Someone'), at: m.at, where: 'in chat' })),
                ...p.drive.map((d) => ({ key: `drive:${d.id}`, name: d.name, type: d.kind === 'image' ? 'image/' : d.kind === 'video' ? 'video/' : 'application/', size: d.size, url: undefined, who: '', at: d.modified, where: client ? `in ${client.name}’s Drive folder` : 'in Drive' })),
              ]}
              chatLinks={links}
              onChannel={p.onChannel}
              readOnly={!!guest}
            />
          </>
        )}

        {tab === 'tasks' && (
          <div className="chan-pane">
            <p className="muted small">
              {client ? `Tasks for ${client.name}, plus anything added here.` : team ? `${team.name}’s tasks, plus anything added here.` : `This channel’s own to-do list.`}
            </p>
            <div className="todo-add task-add">
              <Plus size={16} />
              <input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && taskTitle.trim() && (p.onCreateTask({ title: taskTitle.trim(), userId: taskWho || me, due: taskDue || undefined }), setTaskTitle(''), setTaskDue(''))}
                placeholder={`Add to ${title}’s list…`}
              />
              <Select value={taskWho || me} onChange={setTaskWho} label="Assign to" className="sel-flat" options={users.map((u) => ({ ...personOption(u), label: u.id === me ? 'Me' : u.name, icon: <Avatar person={u} size={18} /> }))} />
              <DatePicker value={taskDue} onChange={setTaskDue} label="Due" placeholder="Due" className="sel-flat" />
              <button className="primary-btn sm" disabled={!taskTitle.trim()} onClick={() => (p.onCreateTask({ title: taskTitle.trim(), userId: taskWho || me, due: taskDue || undefined }), setTaskTitle(''), setTaskDue(''))}>
                Add
              </button>
            </div>
            {[false, true].map((done) => {
              const list = chanTasks.filter((t) => t.done === done).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
              if (!list.length) return null;
              return (
                <div key={String(done)} className="todo-group">
                  <div className="d-heading">
                    {done ? 'Done' : 'Open'} <span>{list.length}</span>
                  </div>
                  {list.map((t) => (
                    <div key={t.id} className={`task ${t.done ? 'done' : ''}`}>
                      <button className="todo-check" onClick={() => p.onToggleTask(t.id)} aria-label="Toggle done">
                        {t.done && <span>✓</span>}
                      </button>
                      <button className="task-title-btn" onClick={() => p.onOpenTask(t.id)}>
                        {t.title}
                      </button>
                      {t.due && !t.done && <span className={`due ${dueLabel(t.due).cls}`}>{dueLabel(t.due).text}</span>}
                      {person(t.userId) ? <Avatar person={person(t.userId)!} size={22} /> : <span className="avatar-empty sm">?</span>}
                    </div>
                  ))}
                </div>
              );
            })}
            {!chanTasks.length && <p className="te-empty">Nothing on this list yet. Add one above, or type /task in a message.</p>}
          </div>
        )}

        {tab === 'summary' && (
          <div className="chan-pane">
            <div className="sum-head">
              <span>
                <strong>{schedule !== 'off' ? `Updated ${schedule === 'monthly' ? 'every month' : schedule === 'weekly' ? 'every week' : 'every day with new messages'}` : 'No automatic summary'}</strong>
                <small className="muted">
                  {schedule === 'off' ? `Each summary uses ${p.summaryCost}` : p.summaryOff ? 'Paused until AI works for this company' : `Next: ${nextRun()} · skipped when nothing happened · each uses ${p.summaryCost}`}
                </small>
              </span>
              <Select
                value={schedule}
                onChange={(v) => p.onChannel({ summary: { ...channel.summary, schedule: v, post: channel.summary?.post ?? false, history: channel.summary?.history ?? [] } })}
                label="Summary schedule"
                className="sel-flat"
                options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>
            <div className="sum-actions">
              <button className="primary-btn sm" disabled={!!summarizing} onClick={() => summarize('period')}>
                <Sparkles size={14} /> {summarizing === 'period' ? 'Writing…' : 'Update now'}
              </button>
              <button className="ghost-btn sm" disabled={!!summarizing} onClick={() => summarize('since')}>
                {summarizing === 'since' ? 'Reading…' : `Since my last visit (${relative(p.since)})`}
              </button>
              <label className="check-row small">
                <input type="checkbox" checked={channel.summary?.post ?? false} onChange={(e) => p.onChannel({ summary: { ...channel.summary, schedule, post: e.target.checked, history: channel.summary?.history ?? [] } })} /> Post new summaries in the channel
              </label>
            </div>
            {schedule !== 'off' && (p.summaryOff || lastMissed || lastRetrying) && (
              <div className="sum-off" role="status">
                <AlertTriangle size={15} aria-hidden />
                <span>
                  {p.summaryOff
                    ? `Scheduled summaries can’t be written: ${p.summaryOff.text}`
                    : lastRetrying
                      ? `The ${lastRetrying.label ?? 'latest'} summary couldn’t be written yet (${lastRetrying.why ?? 'the AI service failed'}). It’s tried again by itself${lastRetrying.retryAt ? ` at ${new Date(lastRetrying.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.`
                      : `The ${lastMissed!.label ?? 'last'} summary wasn’t written: ${lastMissed!.why ?? 'the AI service failed'}`}{' '}
                  {p.summaryOff?.fix && (
                    <button className="link-btn" onClick={p.summaryOff.fix.run}>
                      {p.summaryOff.fix.label}
                    </button>
                  )}
                </span>
              </div>
            )}
            {sinceText && (
              <div className="sum-card since">
                <div className="sum-meta">Since your last visit</div>
                <p>{sinceText}</p>
              </div>
            )}
            {(channel.summary?.history ?? []).map((h) => (
              <div key={h.id} className="sum-card">
                <div className="sum-meta">
                  {h.period} · {h.auto ? 'scheduled' : `asked by ${person(h.by ?? '')?.name.split(' ')[0] ?? 'someone'}`} · {relative(h.at)}
                </div>
                <p>{h.text}</p>
              </div>
            ))}
            {!(channel.summary?.history ?? []).length && !sinceText && <p className="te-empty">No summaries yet. Click “Update now” for the first one.</p>}
          </div>
        )}

        {tab === 'about' && <ChannelAbout {...p} channel={channel} client={client} team={team} other={other} />}

        {tab === 'pinned' && (
          <div className="chan-pane">
            {pinned.map((m) => message(m, false))}
            {!pinned.length && <p className="te-empty">Nothing pinned. Hover a message and click the pin to keep it here: briefs, links, decisions.</p>}
          </div>
        )}

        {tab === 'messages' && (
        <div className="chat-scroll" ref={scroll}>
          {top.map((m) => {
            const day = new Date(m.at).toDateString();
            const showDay = day !== prevDay;
            const grouped = !!(!showDay && prev && prev.userId === m.userId && prev.kind !== 'celebration' && m.kind !== 'kudos' && new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60_000);
            prev = m;
            prevDay = day;
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="chat-day">
                    <span>{new Date(m.at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  </div>
                )}
                {message(m, grouped)}
              </div>
            );
          })}
          {top.length === 0 && <p className="chat-start">This is the start of {title}. Say hello 👋</p>}
        </div>

        )}
        {tab === 'messages' && kudos && (
          <div className="inline-sheet">
            <div className="is-head">
              🙌 Give kudos
              <button className="icon-btn sm" onClick={() => setKudos(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <Select value={kudos.who || null} onChange={(v) => setKudos({ ...kudos, who: v })} placeholder="Who?" label="Who gets kudos" options={users.filter((u) => u.id !== me).map((u) => ({ ...personOption(u), label: u.name, icon: <Avatar person={u} size={22} /> }))} />
            <input className="is-input" value={kudos.text} onChange={(e) => setKudos({ ...kudos, text: e.target.value })} placeholder="For what? e.g. saving the KopiKita invoice" />
            <div className="is-foot">
              <span className="muted small">Shows on everyone’s Home under Wins this week.</span>
              <span className="spacer" />
              <button className="primary-btn sm" disabled={!kudos.who} onClick={() => (p.onSend({ text: kudos.text.trim(), kind: 'kudos', kudosFor: kudos.who }), setKudos(null))}>
                Send kudos
              </button>
            </div>
          </div>
        )}
        {tab === 'messages' && channel.category === 'shared' && !guest && (
          <div className="shared-note">
            <Handshake size={14} />
            <span>
              {channel.guests?.length ? `${channel.guests.map((g) => g.name.split(' ')[0]).join(', ')} can read this channel.` : `Shared with ${client?.name ?? 'guests'}. Invite people in channel settings.`} Keep internal talk in your team’s own channel.
            </span>
          </div>
        )}
        {tab === 'messages' && composer}
        </TabPane>
      </div>

      {thread && (
        <ThreadPanel
          root={thread}
          replies={replies(thread.id)}
          render={(m) => message(m, false, true)}
          channelName={title}
          canPost={true}
          onClose={() => setThreadId(null)}
          onSend={(t, also) => p.onSend({ text: t, parentId: thread.id, alsoInChannel: also })}
        />
      )}

      <Popover anchor={reactAnchor} open={!!reactFor} onClose={() => setReactFor(null)} width={292} title="React">
        <div className="react-grid">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} onClick={() => (p.onReact(reactFor!, e), setReactFor(null))}>
              {e}
            </button>
          ))}
        </div>
      </Popover>
    </section>
  );
}

function VoiceNote({ voice }: { voice: NonNullable<ChatMessage['voice']> }) {
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState(voice.transcript ?? '');
  const [transcribing, setTranscribing] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bars = useMemo(() => Array.from({ length: 28 }, (_, i) => 6 + Math.abs(Math.sin(i * 1.7 + voice.seconds)) * 18), [voice.seconds]);
  const toggle = () => {
    if (voice.url) {
      if (!audio.current) {
        audio.current = new Audio(voice.url);
        audio.current.onended = () => setPlaying(false);
      }
      if (playing) audio.current.pause();
      else audio.current.play().catch(() => setPlaying(false));
    } else if (!playing) setTimeout(() => setPlaying(false), Math.min(voice.seconds, 6) * 1000);
    setPlaying(!playing);
  };
  return (
    <div className="voice">
      <button className="voice-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <span className={`voice-wave ${playing ? 'playing' : ''}`}>
        {bars.map((h, i) => (
          <i key={i} style={{ height: h, animationDelay: `${i * 40}ms` }} />
        ))}
      </span>
      <span className="voice-len">{fmtSecs(voice.seconds)}</span>
      {text ? (
        <button className="link-btn small" onClick={() => setShowText((s) => !s)}>
          {showText ? 'Hide text' : 'Show text'}
        </button>
      ) : (
        <button
          className="link-btn small"
          disabled={transcribing}
          title="Turns speech into text with the AI your company picked. Only when someone asks"
          onClick={() => {
            setTranscribing(true);
            setTimeout(() => {
              setText('Demo transcript: once an AI provider is connected, the real words of this voice note appear here.');
              setShowText(true);
              setTranscribing(false);
            }, 1200);
          }}
        >
          <Sparkles size={11} /> {transcribing ? 'Transcribing…' : 'Transcribe'}
        </button>
      )}
      {showText && text && <p className="voice-text">{text}</p>}
    </div>
  );
}

function ThreadPanel({
  root,
  replies,
  render,
  channelName,
  canPost,
  onClose,
  onSend,
}: {
  root: ChatMessage;
  replies: ChatMessage[];
  render: (m: ChatMessage) => ReactNode;
  channelName: string;
  canPost: boolean;
  onClose: () => void;
  onSend: (text: string, alsoInChannel: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [also, setAlso] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [replies.length]);
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim(), also);
    setText('');
    setAlso(false);
  };
  return (
    <aside className="chat-side">
      <header className="cs-head">
        <strong>Thread</strong>
        <span className="muted small">{channelName}</span>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={onClose} aria-label="Close thread">
          <X size={16} />
        </button>
      </header>
      <div className="cs-body">
        {render(root)}
        <div className="thread-count">
          {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}
        </div>
        {replies.map((m) => render(m))}
        <div ref={end} />
      </div>
      {canPost && (
        <div className="thread-compose">
          <textarea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} placeholder="Reply…" />
          <div className="tc-foot">
            <label className="check-row small">
              <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> Also send to {channelName}
            </label>
            <button className="ai-send chat-send" onClick={send} disabled={!text.trim()} aria-label="Send reply">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/* ---------------- Info panel: everything about this channel's client or team ---------------- */

/** The About tab: purpose, client, team, owner, access, briefs, people, client contacts and client emails. */
function ChannelAbout(p: ViewProps & { channel: Channel; client?: Client; team?: Team; other?: User }) {
  const { channel, client, team, other } = p;
  const person = (id: string) => p.users.find((u) => u.id === id);

  const emails = client?.domain ? p.mail.filter((t) => t.messages.some((m) => [m.from, ...m.to].some((x) => x.email.toLowerCase().endsWith('@' + client.domain)))) : [];
  const contacts = client?.domain
    ? [...new Map(p.mail.flatMap((t) => t.messages.flatMap((m) => [m.from, ...m.to])).filter((x) => x.email.toLowerCase().endsWith('@' + client.domain)).map((x) => [x.email.toLowerCase(), x])).values()]
    : [];
  const lastContact = (email: string) =>
    p.mail
      .flatMap((t) => t.messages)
      .filter((m) => [m.from, ...m.to].some((x) => x.email.toLowerCase() === email))
      .map((m) => m.date)
      .sort()
      .pop();
  const briefs = p.tasks.filter((t) => t.kind === 'brief' && !t.done && client && t.clientId === client.id);

  return (
    <div className="chan-pane about-pane">
        {
          (other ? (
            <div className="profile">
              <Avatar person={other} size={64} />
              <strong>{other.name}</strong>
              <span className="muted">{other.title}</span>
              {p.statuses[other.id] && (
                <span className="profile-status">
                  {p.statuses[other.id].emoji} {p.statuses[other.id].text}
                </span>
              )}
              <a href={`mailto:${other.email}`}>{other.email}</a>
              <span className="muted small">Local time {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: companyTz({ timeZone: p.timeZone }), timeZoneName: 'short' })}</span>
            </div>
          ) : (
            <dl className="fields about-fields">
              <dt>Purpose</dt>
              <dd>{channel.topic ?? 'Not set'}</dd>
              <dt>Category</dt>
              <dd>{CATEGORY_ONE[channel.category ?? 'project']}</dd>
              {client && (
                <>
                  <dt>{term.One}</dt>
                  <dd>
                    <button className="link-btn" onClick={() => p.onOpenClient(client.id)}>
                      {client.name}
                    </button>
                    {client.domain && <span className="muted small">@{client.domain}</span>}
                  </dd>
                  <dt>Account owner</dt>
                  <dd>{person(client.ownerId)?.name ?? 'Not set'}</dd>
                </>
              )}
              {team && (
                <>
                  <dt>Team</dt>
                  <dd>
                    <button className="link-btn" onClick={() => p.onOpenTeam(team.id)}>
                      {team.name}
                    </button>
                  </dd>
                  <dt>Team lead</dt>
                  <dd>{person(team.leadId ?? '')?.name ?? 'Not set'}</dd>
                </>
              )}
              <dt>Channel owner</dt>
              <dd>{person(channel.ownerId ?? '')?.name ?? 'Not set'}</dd>
              <dt>Access</dt>
              <dd>
                {channel.private ? 'Private, invite only' : 'Public in the company'}
                {channel.postPolicy === 'admins' ? ' · announcements' : ''}
              </dd>
              {briefs.length > 0 && (
                <>
                  <dt>Briefs</dt>
                  <dd className="col">
                    {briefs.map((b) => (
                      <button key={b.id} className="brief-chip" onClick={() => p.onOpenTask(b.id)}>
                        <FileText size={11} /> {b.title}
                      </button>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          ))}

        {client && (
          <div className="te-list">
            <div className="d-heading">Emails with {client.name}</div>
            {emails.length === 0 && <p className="te-empty">No emails with @{client?.domain} in inboxes you can open.</p>}
            {emails.map((t) => {
              const last = t.messages[t.messages.length - 1];
              return (
                <button key={t.id} className="te-row simple" onClick={() => p.onOpenMail(t.id)}>
                  <Avatar person={last.from} size={28} />
                  <div className="te-main">
                    <strong>{t.subject}</strong>
                    <small>
                      {last.from.name} · {relative(last.date)}
                    </small>
                  </div>
                </button>
              );
            })}
            <p className="muted small">Only emails from inboxes you’re allowed to open are shown.</p>
          </div>
        )}

        {!other && (
          <div className="people-list">
            <div className="d-heading">People</div>
            <div className="sel-group">Team · {channel.members.length}</div>
            {channel.members.map((id) => {
              const u = person(id);
              return (
                u && (
                  <div key={id} className="pl-row">
                    <span className="dm-av">
                      <Avatar person={u} size={28} />
                      <i className={`presence ${p.presence(id)}`} />
                    </span>
                    <span className="pl-text">
                      <strong>
                        {u.name}
                        {channel.ownerId === id ? <em className="ext-tag">owner</em> : null}
                      </strong>
                      <small>{p.statuses[id] ? `${p.statuses[id].emoji} ${p.statuses[id].text}` : u.title}</small>
                    </span>
                  </div>
                )
              );
            })}
            {!!channel.guests?.length && <div className="sel-group">Guests · {channel.guests.length}</div>}
            {channel.guests?.map((g) => (
              <div key={g.email} className="pl-row">
                <span className="guest-av">{g.name.charAt(0)}</span>
                <span className="pl-text">
                  <strong>
                    {g.name}
                    {companyOf(g.email, client?.people?.find((x) => x.email === g.email)?.company, client) ? ` · ${companyOf(g.email, client?.people?.find((x) => x.email === g.email)?.company, client)}` : ''} <em className="ext-tag">guest</em>
                  </strong>
                  <small>
                    {g.email} · {g.status === 'joined' ? 'joined' : 'invite sent'}
                  </small>
                </span>
              </div>
            ))}
            {contacts.length > 0 && <div className="sel-group">Contacts at {client?.name} · from emails</div>}
            {contacts.map((c) => (
              <div key={c.email} className="pl-row">
                <Avatar person={c} size={28} />
                <span className="pl-text">
                  <strong>{c.name}</strong>
                  <small>
                    {c.email}
                    {lastContact(c.email.toLowerCase()) ? ` · last email ${relative(lastContact(c.email.toLowerCase())!)}` : ''}
                  </small>
                </span>
                <a className="icon-btn sm" href={`mailto:${c.email}`} title="Email">
                  <Mail size={14} />
                </a>
              </div>
            ))}
            <button className="ghost-btn sm" onClick={p.onSettings}>
              <Users size={14} /> Add people or guests
            </button>
          </div>
        )}

    </div>
  );
}

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
