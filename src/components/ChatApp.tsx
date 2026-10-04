import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Hash,
  Image as ImageIcon,
  Info,
  ListChecks,
  Lock,
  Mail,
  Menu,
  MessageSquareReply,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pause,
  Play,
  Plus,
  Settings,
  SmilePlus,
  Sparkles,
  SquareCheck,
  Star,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { Channel, ChannelCategory, ChatFile, ChatMessage, Client, DriveItem, Role, Status, Team, Thread, Todo, User } from '../types';
import { relative } from '../utils';
import { usePersisted } from '../settings';
import { ai } from '../ai';
import { Avatar } from './Avatar';
import { dueLabel, statusOf } from './TasksView';
import { Popover } from './ui/Popover';
import { Select } from './ui/Select';
import { CATEGORY_NAME } from './ChannelDialog';

const dmOther = (c: Channel, me: string) => c.members.find((m) => m !== me) ?? me;
export const QUICK_REACTIONS = ['👍', '🔥', '🙌', '😂', '❤️', '👀', '✅', '🙏'];
const STICKERS = ['🎉', '🚀', '🙌', '🔥', '💯', '☕️', '🤝', '👏', '😎', '🥳', '🫡', '💪'];
const STATUS_PRESETS: Status[] = [
  { emoji: '🎯', text: 'Focusing, slow to reply' },
  { emoji: '🗓️', text: 'In meetings' },
  { emoji: '🎬', text: 'Editing' },
  { emoji: '🚗', text: 'Commuting' },
  { emoji: '🤒', text: 'Out sick' },
  { emoji: '🌴', text: 'On leave' },
];
const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export type Presence = 'active' | 'away' | 'meeting';

/* ---------------- Sidebar ---------------- */

interface Sections {
  starred: string[];
  custom: { id: string; name: string; channelIds: string[] }[];
  collapsed: string[];
}

interface SidebarProps {
  channels: Channel[]; // this workspace's channels I can see (member, or public)
  users: User[];
  me: string;
  workspaceId: string;
  current: string | null;
  unread: Record<string, number>;
  statuses: Record<string, Status>;
  presence: (id: string) => Presence;
  onOpen: (id: string) => void;
  onJoin: (id: string) => void;
  onNewChannel: () => void;
  onNewDm: (userId: string) => void;
  onStatus: (s: Status | null) => void;
}

export function ChatSidebar(p: SidebarProps) {
  const [sections, setSections] = usePersisted<Sections>(`s2g-chat-sections:${p.me}:${p.workspaceId}`, { starred: [], custom: [], collapsed: [] });
  const [addingDm, setAddingDm] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [newSection, setNewSection] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [customStatus, setCustomStatus] = useState('');
  const menuAnchor = useRef<HTMLElement | null>(null);
  const statusBtn = useRef<HTMLButtonElement>(null);

  const mine = p.channels.filter((c) => c.members.includes(p.me) && !c.archived);
  const joinable = p.channels.filter((c) => c.kind === 'channel' && !c.private && !c.archived && !c.members.includes(p.me));
  const rooms = mine.filter((c) => c.kind === 'channel');
  const dms = mine.filter((c) => c.kind === 'dm');
  const dmWith = new Set(dms.flatMap((d) => d.members));
  const inCustom = new Set(sections.custom.flatMap((s) => s.channelIds));
  const starred = new Set(sections.starred);
  const myStatus = p.statuses[p.me];

  const toggle = (key: string) => setSections({ ...sections, collapsed: sections.collapsed.includes(key) ? sections.collapsed.filter((k) => k !== key) : [...sections.collapsed, key] });
  const star = (id: string) => setSections({ ...sections, starred: starred.has(id) ? sections.starred.filter((x) => x !== id) : [...sections.starred, id] });
  const moveTo = (channelId: string, sectionId: string | null) =>
    setSections({
      ...sections,
      custom: sections.custom.map((s) => ({ ...s, channelIds: s.id === sectionId ? [...new Set([...s.channelIds, channelId])] : s.channelIds.filter((x) => x !== channelId) })),
    });
  const addSection = (channelId: string) => {
    if (!newSection.trim()) return;
    const id = 'sec-' + Date.now().toString(36);
    setSections({ ...sections, custom: [...sections.custom.map((s) => ({ ...s, channelIds: s.channelIds.filter((x) => x !== channelId) })), { id, name: newSection.trim(), channelIds: [channelId] }] });
    setNewSection('');
    setMenuFor(null);
  };

  const row = (c: Channel) => {
    const other = c.kind === 'dm' ? p.users.find((u) => u.id === dmOther(c, p.me)) : undefined;
    const st = other ? p.statuses[other.id] : undefined;
    return (
      <div key={c.id} className={`nav-row ${p.current === c.id ? 'active' : ''}`}>
        <button className={`nav-item ${p.current === c.id ? 'active' : ''} ${p.unread[c.id] ? 'has-unread' : ''}`} onClick={() => p.onOpen(c.id)} title={other ? other.name : `#${c.name}`}>
          {other ? (
            <span className="dm-av">
              <Avatar person={other} size={20} />
              <i className={`presence ${p.presence(other.id)}`} />
            </span>
          ) : c.private ? (
            <Lock size={15} />
          ) : (
            <Hash size={16} />
          )}
          <span className="sb-label">
            {other ? other.name : c.name}
            {st && <span className="st-emoji" title={st.text}>{st.emoji}</span>}
            {c.guests?.length ? <em className="ext-tag" title="Has client guests">ext</em> : null}
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

  const section = (key: string, title: ReactNode, list: Channel[], extra?: ReactNode) => {
    if (!list.length && !extra) return null;
    const closed = sections.collapsed.includes(key);
    return (
      <div key={key} className="chat-section">
        <button className="nav-heading sb-label sec-head" onClick={() => toggle(key)}>
          {closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />} {title}
        </button>
        {!closed && (
          <nav className="nav">
            {list.map(row)}
            {extra}
          </nav>
        )}
      </div>
    );
  };

  const byCategory = (cat: ChannelCategory) => rooms.filter((c) => (c.category ?? 'project') === cat && !starred.has(c.id) && !inCustom.has(c.id));
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

      {section(
        'starred',
        <>
          <Star size={11} /> Starred
        </>,
        [...rooms, ...dms].filter((c) => starred.has(c.id)),
      )}
      {sections.custom.map((s) => section(s.id, s.name, rooms.filter((c) => s.channelIds.includes(c.id) && !starred.has(c.id))))}
      {(['client', 'team', 'project', 'social'] as ChannelCategory[]).map((cat) => section(cat, CATEGORY_NAME[cat], byCategory(cat)))}
      <nav className="nav">
        <button className="nav-item" onClick={p.onNewChannel} title="New channel">
          <Plus size={16} />
          <span className="sb-label">New channel</span>
        </button>
        {joinable.length > 0 && (
          <button className="nav-item" onClick={() => setBrowsing((b) => !b)} title="Browse channels">
            <Compass size={16} />
            <span className="sb-label">Browse channels</span>
            <span className="count muted-count">{joinable.length}</span>
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
        dms.filter((c) => !starred.has(c.id)),
        addingDm ? (
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

      <Popover anchor={menuAnchor} open={!!menuChannel} onClose={() => setMenuFor(null)} width={240} title={menuChannel ? (menuChannel.kind === 'dm' ? 'Conversation' : `#${menuChannel.name}`) : ''}>
        {menuChannel && (
          <div className="sel-pop">
            <button className="sel-opt" onClick={() => (star(menuChannel.id), setMenuFor(null))}>
              <Star size={14} /> {starred.has(menuChannel.id) ? 'Remove from Starred' : 'Star'}
            </button>
            {menuChannel.kind === 'channel' && (
              <>
                <div className="sel-group">Move to section</div>
                {sections.custom.map((s) => (
                  <button key={s.id} className="sel-opt" onClick={() => (moveTo(menuChannel.id, s.id), setMenuFor(null))}>
                    {s.name}
                  </button>
                ))}
                {inCustom.has(menuChannel.id) && (
                  <button className="sel-opt" onClick={() => (moveTo(menuChannel.id, null), setMenuFor(null))}>
                    Back to {CATEGORY_NAME[menuChannel.category ?? 'project']}
                  </button>
                )}
                <div className="status-custom">
                  <input value={newSection} onChange={(e) => setNewSection(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSection(menuChannel.id)} placeholder="New section, e.g. My clients" />
                </div>
              </>
            )}
          </div>
        )}
      </Popover>
    </>
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
  { cmd: '/poll', hint: 'Quick vote: /poll Lunch? | Bakmi | Sate' },
  { cmd: '/remind', hint: 'Remind yourself: /remind call Nadia tomorrow' },
  { cmd: '/kudos', hint: 'Thank someone: /kudos @Dewi for saving the invoice' },
  { cmd: '/meet', hint: 'Share the meeting link' },
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
  const [panel, setPanel] = usePersisted<'info' | null>('s2g-chat-info', null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [pollDraft, setPollDraft] = useState<{ q: string; opts: string[] } | null>(null);
  const [kudos, setKudos] = useState<{ who: string; text: string } | null>(null);
  const [rec, setRec] = useState<{ start: number; secs: number; stream?: MediaStream; recorder?: MediaRecorder; chunks: Blob[] } | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const reactAnchor = useRef<HTMLElement | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const plusBtn = useRef<HTMLButtonElement>(null);
  const stickerBtn = useRef<HTMLButtonElement>(null);
  const person = (id: string) => users.find((u) => u.id === id);
  const client = channel?.clientId ? p.clients.find((c) => c.id === channel.clientId) : undefined;
  const team = channel?.teamId ? p.teams.find((t) => t.id === channel.teamId) : undefined;
  const sorted = useMemo(() => [...p.messages].sort((a, b) => a.at.localeCompare(b.at)), [p.messages]);
  const top = sorted.filter((m) => !m.parentId || m.alsoInChannel);
  const replies = (id: string) => sorted.filter((m) => m.parentId === id);
  const canPost = !channel || channel.postPolicy !== 'admins' || p.myRole !== 'member' || channel.ownerId === me;
  const thread = threadId ? p.messages.find((m) => m.id === threadId) : undefined;

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [channel?.id, top.length]);
  useEffect(() => {
    input.current?.focus();
    setText('');
    setThreadId(null);
    setPollDraft(null);
    setKudos(null);
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
  const slash = text.startsWith('/') && !text.includes(' ') ? COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase())) : [];

  if (!channel)
    return (
      <section className="chat-pane chat-empty view-enter">
        <Hash size={28} />
        <p className="empty-title">Pick a channel or person</p>
        <p className="empty-sub">Client channels keep every conversation about a client in one place.</p>
      </section>
    );

  const other = channel.kind === 'dm' ? person(dmOther(channel, me)) : undefined;
  const title = other ? other.name : `#${channel.name}`;
  const mentioned = (t: string) => users.find((u) => u.id !== me && new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(t));

  /** Slash commands run here; everything else is a message. */
  const runCommand = (raw: string): boolean => {
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
      case '/poll': {
        const [q, ...opts] = arg.split('|').map((s) => s.trim()).filter(Boolean);
        if (q && opts.length >= 2) p.onSend({ text: '', poll: { question: q, options: opts.map((o) => ({ text: o, votes: [] })) } });
        else setPollDraft({ q: q ?? '', opts: opts.length ? opts : ['', ''] });
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
  const onFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const files: ChatFile[] = [...list].map((f) => ({ name: f.name, size: f.size, type: f.type || 'application/octet-stream', url: URL.createObjectURL(f) }));
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
      rec.recorder.onstop = () => finish(URL.createObjectURL(new Blob(rec.chunks, { type: 'audio/webm' })));
      rec.recorder.stop();
    } else finish();
  };

  const authorOf = (m: ChatMessage) => {
    if (m.guestEmail) {
      const g = channel.guests?.find((x) => x.email === m.guestEmail);
      return { name: g?.name ?? m.guestEmail, guest: true, person: { name: g?.name ?? m.guestEmail, email: m.guestEmail } };
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
      <div key={m.id} className={`chat-msg ${grouped ? 'grouped' : ''} ${m.kind === 'kudos' ? 'kudos-msg' : ''}`}>
        {grouped ? <span className="cm-gutter" /> : a.person ? <Avatar person={a.person} size={34} /> : <span className="cm-gutter" />}
        <div className="cm-body">
          {!grouped && (
            <div className="cm-head">
              <strong>{a.name}</strong>
              {a.guest && <span className="guest-badge">Guest · {client?.name ?? 'client'}</span>}
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
            <button className={`cm-task ${statusOf(task)}`} onClick={() => p.onOpenTask(task.id)}>
              <SquareCheck size={14} />
              <span>{task.title}</span>
              <em>
                {statusOf(task) === 'done' ? 'Done' : statusOf(task) === 'doing' ? 'In progress' : 'To do'} · {person(task.userId)?.name.split(' ')[0] ?? 'team queue'}
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
          <button
            title="React"
            onClick={(e) => {
              reactAnchor.current = e.currentTarget;
              setReactFor(m.id);
            }}
          >
            <SmilePlus size={15} />
          </button>
          {!inThread && (
            <button title="Reply in thread" onClick={() => setThreadId(m.id)}>
              <MessageSquareReply size={15} />
            </button>
          )}
          {!task && m.kind !== 'kudos' && m.text && (
            <button title="Turn into a task" onClick={() => p.onMakeTask(m)}>
              <ListChecks size={15} />
            </button>
          )}
          {m.userId === me && !m.guestEmail && (
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
            placeholder={`Message ${title}  ·  type / for commands`}
          />
          {p.gifs && (
            <button ref={stickerBtn} className="icon-btn" onClick={() => setStickerOpen((o) => !o)} aria-label="Stickers">
              <span className="gif-tag">GIF</span>
            </button>
          )}
          {text.trim() ? (
            <button className="ai-send chat-send" onClick={send} aria-label="Send">
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
          <button className="sel-opt" onClick={startRec}>
            <Mic size={15} /> Record a voice note
          </button>
          <button className="sel-opt" onClick={() => (setPlusOpen(false), setPollDraft({ q: '', opts: ['', ''] }))}>
            <BarChart3 size={15} /> Create a poll
          </button>
          <button className="sel-opt" onClick={() => (setPlusOpen(false), setKudos({ who: '', text: '' }))}>
            <span>🙌</span> Give kudos
          </button>
          <button className="sel-opt" onClick={() => (setPlusOpen(false), runCommand('/meet'))}>
            <Video size={15} /> Share the meeting link
          </button>
        </div>
      </Popover>
      <Popover anchor={stickerBtn} open={stickerOpen} onClose={() => setStickerOpen(false)} width={260} title="Stickers">
        <div className="sticker-grid">
          {STICKERS.map((s) => (
            <button key={s} onClick={() => (p.onSend({ text: s }), setStickerOpen(false))}>
              {s}
            </button>
          ))}
          <p className="muted small">GIF search connects with Tenor or Giphy when the backend is live.</p>
        </div>
      </Popover>
    </div>
  ) : (
    <div className="chat-locked">
      <Lock size={14} /> Only admins post in #{channel.name}. You can still react and reply in threads.
    </div>
  );

  return (
    <section className={`chat-pane view-enter ${panel || thread ? 'with-panel' : ''}`}>
      <div className="chat-main">
        <header className="chat-head">
          <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
            <Menu size={18} />
          </button>
          {other && (
            <span className="dm-av">
              <Avatar person={other} size={28} />
              <i className={`presence ${p.presence(other.id)}`} />
            </span>
          )}
          <div className="th-text">
            <h1>
              {channel.private && !other && <Lock size={15} />} {title}
              {other && p.statuses[other.id] && <span className="st-emoji">{p.statuses[other.id].emoji}</span>}
            </h1>
            <p>
              {other ? (p.statuses[other.id]?.text ?? other.title) : (channel.topic ?? (client ? `${client.name} client channel` : ''))}
              {channel.guests?.length ? ` · ${channel.guests.length} client guest${channel.guests.length > 1 ? 's' : ''}` : ''}
            </p>
          </div>
          {channel.kind === 'channel' && (
            <button className="chat-members" onClick={p.onSettings} title="People and settings">
              {channel.members.slice(0, 4).map((id) => person(id) && <Avatar key={id} person={person(id)!} size={24} />)}
              <span>{channel.members.length + (channel.guests?.length ?? 0)}</span>
            </button>
          )}
          {channel.kind === 'channel' && (
            <button className="icon-btn sm" onClick={p.onSettings} title="Channel settings">
              <Settings size={16} />
            </button>
          )}
          <button className={`icon-btn sm ${panel ? 'on' : ''}`} onClick={() => (setThreadId(null), setPanel(panel ? null : 'info'))} title="Details: files, emails, people, tasks">
            <Info size={17} />
          </button>
        </header>

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

        {pollDraft && (
          <div className="inline-sheet">
            <div className="is-head">
              <BarChart3 size={15} /> New poll
              <button className="icon-btn sm" onClick={() => setPollDraft(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <input autoFocus className="is-input" value={pollDraft.q} onChange={(e) => setPollDraft({ ...pollDraft, q: e.target.value })} placeholder="Ask a question" />
            {pollDraft.opts.map((o, i) => (
              <input key={i} className="is-input" value={o} onChange={(e) => setPollDraft({ ...pollDraft, opts: pollDraft.opts.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Option ${i + 1}`} />
            ))}
            <div className="is-foot">
              {pollDraft.opts.length < 6 && (
                <button className="link-btn" onClick={() => setPollDraft({ ...pollDraft, opts: [...pollDraft.opts, ''] })}>
                  + Add option
                </button>
              )}
              <span className="spacer" />
              <button
                className="primary-btn sm"
                disabled={!pollDraft.q.trim() || pollDraft.opts.filter((o) => o.trim()).length < 2}
                onClick={() => {
                  p.onSend({ text: '', poll: { question: pollDraft.q.trim(), options: pollDraft.opts.filter((o) => o.trim()).map((o) => ({ text: o.trim(), votes: [] })) } });
                  setPollDraft(null);
                }}
              >
                Post poll
              </button>
            </div>
          </div>
        )}
        {kudos && (
          <div className="inline-sheet">
            <div className="is-head">
              🙌 Give kudos
              <button className="icon-btn sm" onClick={() => setKudos(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <Select value={kudos.who || null} onChange={(v) => setKudos({ ...kudos, who: v })} placeholder="Who?" label="Who gets kudos" options={users.filter((u) => u.id !== me).map((u) => ({ value: u.id, label: u.name, icon: <Avatar person={u} size={22} /> }))} />
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
        {composer}
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
      {!thread && panel === 'info' && <InfoPanel {...p} channel={channel} client={client} team={team} other={other} onClose={() => setPanel(null)} />}

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
      {voice.transcript ? (
        <button className="link-btn small" onClick={() => setShowText((s) => !s)}>
          {showText ? 'Hide text' : 'Show text'}
        </button>
      ) : (
        <span className="muted small" title="Turns speech into text with the AI your company picked. Only when someone asks.">
          <Sparkles size={11} /> Transcribe
        </span>
      )}
      {showText && voice.transcript && <p className="voice-text">{voice.transcript}</p>}
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

function InfoPanel(p: ViewProps & { channel: Channel; client?: Client; team?: Team; other?: User; onClose: () => void }) {
  const { channel, client, team, other } = p;
  const [tab, setTab] = useState<'about' | 'files' | 'emails' | 'people' | 'tasks' | 'summary'>('about');
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const person = (id: string) => p.users.find((u) => u.id === id);

  const chatFiles = p.messages.flatMap((m) => (m.files ?? []).map((f) => ({ f, m })));
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
  const tasks = p.tasks.filter((t) => !t.done && t.kind !== 'brief' && (client ? t.clientId === client.id : team ? t.teamId === team.id : false));
  const briefs = p.tasks.filter((t) => t.kind === 'brief' && !t.done && client && t.clientId === client.id);

  const catchUp = async () => {
    setLoading(true);
    const recent = p.messages.slice(-40).map((m) => ({
      who: m.guestEmail ? (channel.guests?.find((g) => g.email === m.guestEmail)?.name ?? m.guestEmail) : (person(m.userId)?.name.split(' ')[0] ?? 'Someone'),
      text: m.voice?.transcript ?? m.text,
      at: m.at,
      task: m.taskId ? p.tasks.find((t) => t.id === m.taskId)?.title : undefined,
      files: m.files?.map((f) => f.name),
    }));
    setSummary(await ai.catchUp(other ? other.name : `#${channel.name}`, recent, person(p.me)?.name.split(' ')[0] ?? 'me'));
    setLoading(false);
  };

  const tabs = (
    other
      ? [
          ['about', 'Profile'],
          ['files', `Files · ${chatFiles.length}`],
          ['summary', 'Catch me up'],
        ]
      : [
          ['about', 'About'],
          ['files', `Files · ${chatFiles.length + p.drive.length}`],
          ...(client ? [['emails', `Emails · ${emails.length}`]] : []),
          ['people', `People · ${channel.members.length + (channel.guests?.length ?? 0) + contacts.length}`],
          ...(client || team ? [['tasks', `Tasks · ${tasks.length}`]] : []),
          ['summary', 'Catch me up'],
        ]
  ) as [typeof tab, string][];

  return (
    <aside className="chat-side">
      <header className="cs-head">
        <strong>{other ? other.name : `#${channel.name}`}</strong>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={p.onClose} aria-label="Close details">
          <X size={16} />
        </button>
      </header>
      <div className="cs-tabs">
        {tabs.map(([id, l]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {l}
          </button>
        ))}
      </div>
      <div className="cs-body">
        {tab === 'about' &&
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
              <span className="muted small">Local time {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} WIB</span>
            </div>
          ) : (
            <dl className="fields about-fields">
              <dt>Purpose</dt>
              <dd>{channel.topic ?? 'Not set'}</dd>
              <dt>Category</dt>
              <dd>{CATEGORY_NAME[channel.category ?? 'project'].replace(/s$/, '')}</dd>
              {client && (
                <>
                  <dt>Client</dt>
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

        {tab === 'files' && (
          <div className="file-list">
            {chatFiles.length === 0 && p.drive.length === 0 && <p className="te-empty">No files yet. Anything shared here is saved to Drive automatically.</p>}
            {chatFiles.map(({ f, m }) => (
              <a key={m.id + f.name} className="chat-file flat" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => !f.url && e.preventDefault()}>
                <span className="cf-icon">{f.type.startsWith('video') ? <Video size={16} /> : f.type.startsWith('image') ? <ImageIcon size={16} /> : <FileText size={16} />}</span>
                <span className="cf-text">
                  <strong>{f.name}</strong>
                  <small>
                    {fmtSize(f.size)} · {person(m.userId)?.name.split(' ')[0] ?? 'Guest'} · {relative(m.at)}
                  </small>
                </span>
              </a>
            ))}
            {p.drive.length > 0 && <div className="sel-group">In Drive{client ? ` › ${client.name}` : ''}</div>}
            {p.drive.map((d) => (
              <div key={d.id} className="chat-file flat">
                <span className="cf-icon">
                  <FileText size={16} />
                </span>
                <span className="cf-text">
                  <strong>{d.name}</strong>
                  <small>
                    {d.size ? fmtSize(d.size) : 'Folder'} · {relative(d.modified)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'emails' && (
          <div className="te-list">
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

        {tab === 'people' && (
          <div className="people-list">
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
            {!!channel.guests?.length && <div className="sel-group">Client guests · {channel.guests.length}</div>}
            {channel.guests?.map((g) => (
              <div key={g.email} className="pl-row">
                <span className="guest-av">{g.name.charAt(0)}</span>
                <span className="pl-text">
                  <strong>
                    {g.name} <em className="ext-tag">guest</em>
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

        {tab === 'tasks' && (
          <div className="te-list">
            {tasks.length === 0 && <p className="te-empty">No open tasks for {client?.name ?? team?.name}.</p>}
            {tasks.map((t) => (
              <button key={t.id} className="te-row simple" onClick={() => p.onOpenTask(t.id)}>
                <SquareCheck size={16} className="muted" />
                <div className="te-main">
                  <strong>{t.title}</strong>
                  <small>
                    {person(t.userId)?.name.split(' ')[0] ?? 'Not assigned'}
                    {t.due ? ` · ${dueLabel(t.due).text}` : ''}
                  </small>
                </div>
              </button>
            ))}
            {client && (
              <button className="link-btn" onClick={() => p.onOpenClient(client.id)}>
                Open {client.name}’s page
              </button>
            )}
          </div>
        )}

        {tab === 'summary' && (
          <div className="catchup">
            {summary ? (
              <>
                <p className="catchup-text">{summary}</p>
                <button className="link-btn" onClick={catchUp}>
                  Refresh
                </button>
              </>
            ) : (
              <>
                <p className="muted">A few lines on what you missed: decisions, questions, files and tasks.</p>
                <button className="primary-btn sm" onClick={catchUp} disabled={loading}>
                  <Sparkles size={14} /> {loading ? 'Reading…' : 'Catch me up'}
                </button>
                <p className="muted small">Uses AI only when you click. About 1 summary from your monthly allowance.</p>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
