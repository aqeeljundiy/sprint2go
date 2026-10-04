import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Hash, ListChecks, Menu, Plus, SquareCheck, Users } from 'lucide-react';
import type { Channel, ChatMessage, Client, Todo, User } from '../types';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { statusOf } from './TasksView';

const dmName = (c: Channel, me: string, users: User[]) => users.find((u) => u.id === c.members.find((m) => m !== me))?.name ?? 'Direct message';

/* ---------------- Sidebar ---------------- */

interface SidebarProps {
  channels: Channel[];
  users: User[];
  me: string;
  current: string | null;
  unread: Record<string, number>;
  onOpen: (id: string) => void;
  onNewChannel: (name: string) => void;
  onNewDm: (userId: string) => void;
}

export function ChatSidebar({ channels, users, me, current, unread, onOpen, onNewChannel, onNewDm }: SidebarProps) {
  const [adding, setAdding] = useState<'channel' | 'dm' | null>(null);
  const [name, setName] = useState('');
  const mine = channels.filter((c) => c.members.includes(me));
  const rooms = mine.filter((c) => c.kind === 'channel');
  const dms = mine.filter((c) => c.kind === 'dm');
  const dmWith = new Set(dms.flatMap((d) => d.members));

  return (
    <>
      <div className="nav-heading sb-label">Channels</div>
      <nav className="nav">
        {rooms.map((c) => (
          <button key={c.id} className={`nav-item ${current === c.id ? 'active' : ''} ${unread[c.id] ? 'has-unread' : ''}`} onClick={() => onOpen(c.id)} title={`#${c.name}`}>
            <Hash size={16} />
            <span className="sb-label">{c.name}</span>
            {unread[c.id] ? <span className="count">{unread[c.id]}</span> : null}
          </button>
        ))}
        {adding === 'channel' ? (
          <div className="add-client sb-label">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))}
              placeholder="channel-name"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name) {
                  onNewChannel(name);
                  setName('');
                  setAdding(null);
                }
                if (e.key === 'Escape') setAdding(null);
              }}
            />
          </div>
        ) : (
          <button className="nav-item" onClick={() => setAdding('channel')} title="New channel">
            <Plus size={16} />
            <span className="sb-label">New channel</span>
          </button>
        )}
      </nav>

      <div className="nav-heading sb-label">Direct messages</div>
      <nav className="nav">
        {dms.map((c) => {
          const other = users.find((u) => u.id === c.members.find((m) => m !== me));
          return (
            <button key={c.id} className={`nav-item ${current === c.id ? 'active' : ''} ${unread[c.id] ? 'has-unread' : ''}`} onClick={() => onOpen(c.id)} title={other?.name}>
              {other ? <Avatar person={other} size={20} /> : <Users size={16} />}
              <span className="sb-label">{other?.name ?? 'Direct message'}</span>
              {unread[c.id] ? <span className="count">{unread[c.id]}</span> : null}
            </button>
          );
        })}
        {adding === 'dm' ? (
          <div className="add-client sb-label">
            <select autoFocus defaultValue="" onChange={(e) => (onNewDm(e.target.value), setAdding(null))}>
              <option value="" disabled>
                Message someone…
              </option>
              {users
                .filter((u) => u.id !== me && !dmWith.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <button className="nav-item" onClick={() => setAdding('dm')} title="New message">
            <Plus size={16} />
            <span className="sb-label">New message</span>
          </button>
        )}
      </nav>
    </>
  );
}

/* ---------------- Conversation ---------------- */

interface ViewProps {
  channel: Channel | null;
  messages: ChatMessage[];
  users: User[];
  me: string;
  clients: Client[];
  tasks: Todo[];
  onSend: (text: string) => void;
  onMakeTask: (m: ChatMessage) => void;
  onOpenTask: (id: string) => void;
  onOpenClient: (id: string) => void;
  onMenu: () => void;
}

/** "@Rizky" → <b>@Rizky</b>; keeps everything else as text. */
function Text({ text, users }: { text: string; users: User[] }) {
  const names = users.map((u) => u.name.split(' ')[0]).join('|');
  if (!names) return <>{text}</>;
  const parts = text.split(new RegExp(`(@(?:${names})\\b)`, 'g'));
  return <>{parts.map((p, i) => (p.startsWith('@') ? <b key={i} className="mention">{p}</b> : p))}</>;
}

export function ChatView({ channel, messages, users, me, clients, tasks, onSend, onMakeTask, onOpenTask, onOpenClient, onMenu }: ViewProps) {
  const [text, setText] = useState('');
  const [mention, setMention] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const person = (id: string) => users.find((u) => u.id === id);
  const client = channel?.clientId ? clients.find((c) => c.id === channel.clientId) : undefined;

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [channel?.id, messages.length]);
  useEffect(() => {
    input.current?.focus();
    setText('');
  }, [channel?.id]);

  const suggestions = useMemo(
    () => (mention === null ? [] : users.filter((u) => u.id !== me && u.name.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 5)),
    [mention, users, me],
  );

  if (!channel)
    return (
      <section className="chat-pane chat-empty view-enter">
        <Hash size={28} />
        <p className="empty-title">Pick a channel or person</p>
        <p className="empty-sub">Client channels keep every conversation about a client in one place.</p>
      </section>
    );

  const title = channel.kind === 'dm' ? dmName(channel, me, users) : `#${channel.name}`;
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
    setMention(null);
  };
  const pickMention = (u: User) => {
    setText((t) => t.replace(/@(\w*)$/, `@${u.name.split(' ')[0]} `));
    setMention(null);
    input.current?.focus();
  };

  // Group consecutive messages by the same person within 5 minutes.
  let prev: ChatMessage | null = null;
  let prevDay = '';

  return (
    <section className="chat-pane view-enter">
      <header className="chat-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        {channel.kind === 'dm' && person(channel.members.find((m) => m !== me)!) && <Avatar person={person(channel.members.find((m) => m !== me)!)!} size={28} />}
        <div className="th-text">
          <h1>{title}</h1>
          <p>
            {channel.topic ?? (channel.kind === 'dm' ? person(channel.members.find((m) => m !== me)!)?.title : '')}
            {client && (
              <>
                {' · '}
                <button className="link-btn" onClick={() => onOpenClient(client.id)}>
                  {client.name} client page
                </button>
              </>
            )}
          </p>
        </div>
        <div className="chat-members">
          {channel.members.slice(0, 4).map((id) => person(id) && <Avatar key={id} person={person(id)!} size={24} />)}
          {channel.members.length > 4 && <span>+{channel.members.length - 4}</span>}
        </div>
      </header>

      <div className="chat-scroll" ref={scroll}>
        {messages.map((m) => {
          const u = person(m.userId);
          const day = new Date(m.at).toDateString();
          const showDay = day !== prevDay;
          const grouped = !showDay && prev && prev.userId === m.userId && new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60_000;
          prev = m;
          prevDay = day;
          const task = m.taskId ? tasks.find((t) => t.id === m.taskId) : undefined;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="chat-day">
                  <span>{new Date(m.at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                </div>
              )}
              <div className={`chat-msg ${grouped ? 'grouped' : ''}`}>
                {grouped ? <span className="cm-gutter" /> : u ? <Avatar person={u} size={34} /> : <span className="cm-gutter" />}
                <div className="cm-body">
                  {!grouped && (
                    <div className="cm-head">
                      <strong>{m.userId === me ? 'You' : u?.name}</strong>
                      <time>{relative(m.at)}</time>
                    </div>
                  )}
                  <div className="cm-text">
                    <Text text={m.text} users={users} />
                  </div>
                  {task && (
                    <button className={`cm-task ${statusOf(task)}`} onClick={() => onOpenTask(task.id)}>
                      <SquareCheck size={14} />
                      <span>{task.title}</span>
                      <em>
                        {statusOf(task) === 'done' ? 'Done' : statusOf(task) === 'doing' ? 'In progress' : 'To do'} · {person(task.userId)?.name.split(' ')[0]}
                      </em>
                    </button>
                  )}
                </div>
                {!task && (
                  <button className="cm-action" title="Turn into a task" onClick={() => onMakeTask(m)}>
                    <ListChecks size={14} /> Task
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {messages.length === 0 && <p className="chat-start">This is the start of {title}. Say hello 👋</p>}
      </div>

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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (suggestions.length && mention !== null) pickMention(suggestions[0]);
              else send();
            }
            if (e.key === 'Escape') setMention(null);
          }}
          placeholder={`Message ${title}`}
        />
        <button className="ai-send chat-send" onClick={send} disabled={!text.trim()} aria-label="Send">
          <ArrowUp size={16} />
        </button>
      </div>
    </section>
  );
}
