import { useMemo, useState } from 'react';
import {
  Brain,
  CalendarPlus,
  Columns3,
  Hash,
  List,
  Mail,
  Menu,
  MessagesSquare,
  Plus,
  Sparkles,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { Channel, Client, Meeting, TaskStatus, Thread, Todo, User } from '../types';
import { usePersisted } from '../settings';
import { relative } from '../utils';
import { Avatar } from './Avatar';

export type TaskScope = { kind: 'mine' } | { kind: 'all' } | { kind: 'delegated' } | { kind: 'client'; id: string };

const SOURCE: Record<Todo['source'], { icon: LucideIcon; label: string }> = {
  ai: { icon: Mail, label: 'From email' },
  manual: { icon: Plus, label: 'Added by hand' },
  braindump: { icon: Brain, label: 'From a brain dump' },
  chat: { icon: MessagesSquare, label: 'From chat' },
  meeting: { icon: Video, label: 'From a meeting' },
};
const COLUMNS: { id: TaskStatus; name: string }[] = [
  { id: 'todo', name: 'To do' },
  { id: 'doing', name: 'In progress' },
  { id: 'done', name: 'Done' },
];

export const statusOf = (t: Todo): TaskStatus => (t.done ? 'done' : t.status === 'doing' ? 'doing' : 'todo');

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
export function dueLabel(due: string) {
  const today = dayStr(new Date());
  const tomorrow = dayStr(new Date(Date.now() + 86_400_000));
  if (due < today) return { text: 'Overdue', cls: 'overdue' };
  if (due === today) return { text: 'Today', cls: 'today' };
  if (due === tomorrow) return { text: 'Tomorrow', cls: 'soon' };
  return { text: new Date(due + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), cls: '' };
}

interface Props {
  scope: TaskScope;
  tasks: Todo[]; // this workspace's tasks
  clients: Client[];
  users: User[]; // workspace members
  me: string;
  threads: Thread[];
  channels: Channel[];
  meetings: Meeting[];
  onAdd: (t: { title: string; clientId?: string; userId: string; due?: string }) => void;
  onStatus: (id: string, s: TaskStatus) => void;
  onPatch: (id: string, p: Partial<Todo>) => void;
  onDelete: (id: string) => void;
  onToCalendar: (t: Todo) => void;
  onOpenThread: (id: string) => void;
  onOpenChannel: (id: string) => void;
  onOpenMeeting: (id: string) => void;
  onBrainDump: () => void;
  onMenu: () => void;
}

export function TasksView(p: Props) {
  const [layout, setLayout] = usePersisted<'list' | 'board'>('s2g-task-layout', 'list');
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(p.me);
  const [due, setDue] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<'tasks' | 'emails' | 'meetings'>('tasks');

  const client = p.scope.kind === 'client' ? p.clients.find((c) => c.id === (p.scope as { id: string }).id) : undefined;
  const person = (id?: string) => p.users.find((u) => u.id === id);
  const clientOf = (id?: string) => p.clients.find((c) => c.id === id);

  const shown = useMemo(() => {
    switch (p.scope.kind) {
      case 'mine':
        return p.tasks.filter((t) => t.userId === p.me);
      case 'delegated':
        return p.tasks.filter((t) => t.createdBy === p.me && t.userId !== p.me);
      case 'client':
        return p.tasks.filter((t) => t.clientId === (p.scope as { id: string }).id);
      default:
        return p.tasks;
    }
  }, [p.tasks, p.scope, p.me]);

  const open = shown.filter((t) => !t.done).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const done = shown.filter((t) => t.done);
  const overdue = open.filter((t) => t.due && t.due < dayStr(new Date())).length;

  const heading =
    p.scope.kind === 'mine' ? 'My tasks' : p.scope.kind === 'delegated' ? 'Assigned by me' : p.scope.kind === 'all' ? 'All tasks' : client?.name ?? 'Client';

  const add = () => {
    if (!title.trim()) return;
    p.onAdd({ title: title.trim(), clientId: client?.id, userId: assignee, due: due || undefined });
    setTitle('');
    setDue('');
  };

  // Group by client in list view (except on a client page)
  const groups: [string, Todo[]][] = useMemo(() => {
    if (client) return [['', open]];
    const map = new Map<string, Todo[]>();
    for (const t of open) {
      const k = t.clientId ?? '';
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()].sort(([a], [b]) => (a ? clientOf(a)!.name : 'zzz').localeCompare(b ? clientOf(b)!.name : 'zzz'));
  }, [open, client]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (t: Todo) => {
    const d = t.due ? dueLabel(t.due) : null;
    const src = SOURCE[t.source];
    const c = clientOf(t.clientId);
    const owner = person(t.userId);
    return (
      <div key={t.id} className={`task ${t.done ? 'done' : ''} ${t.priority === 'high' ? 'high' : ''} ${statusOf(t) === 'doing' ? 'doing' : ''}`}>
        <button className="todo-check" onClick={() => p.onStatus(t.id, t.done ? 'todo' : 'done')} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
          {t.done && <span>✓</span>}
        </button>
        <div className="task-main">
          <input className="task-title" value={t.title} onChange={(e) => p.onPatch(t.id, { title: e.target.value })} aria-label="Task title" />
          <div className="task-meta">
            {statusOf(t) === 'doing' && <span className="due doing">In progress</span>}
            {d && <span className={`due ${d.cls}`}>{d.text}</span>}
            {c && !client && (
              <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                {c.name}
              </span>
            )}
            <span className="src" title={src.label}>
              <src.icon size={12} /> {src.label}
            </span>
            {t.threadId && (
              <button className="todo-src" onClick={() => p.onOpenThread(t.threadId!)}>
                Open email
              </button>
            )}
            {t.createdBy && t.createdBy !== t.userId && <span className="src">from {t.createdBy === p.me ? 'you' : person(t.createdBy)?.name.split(' ')[0]}</span>}
          </div>
        </div>
        <label className="assignee" title={`Assigned to ${owner?.name ?? 'nobody'}`}>
          {owner ? <Avatar person={owner} size={26} /> : <span className="avatar-empty">?</span>}
          <select value={t.userId} onChange={(e) => p.onPatch(t.id, { userId: e.target.value })} aria-label="Assignee">
            {p.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === p.me ? `${u.name} (me)` : u.name}
              </option>
            ))}
          </select>
        </label>
        <div className="todo-actions">
          {!t.done && (
            <button className="icon-btn sm" title={statusOf(t) === 'doing' ? 'Move back to To do' : 'Start (In progress)'} onClick={() => p.onStatus(t.id, statusOf(t) === 'doing' ? 'todo' : 'doing')}>
              <Columns3 size={15} />
            </button>
          )}
          {!t.done && (
            <button className="icon-btn sm" title="Add to calendar" onClick={() => p.onToCalendar(t)}>
              <CalendarPlus size={15} />
            </button>
          )}
          <button className="icon-btn sm" title="Delete" onClick={() => p.onDelete(t.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  };

  const clientThreads = client?.domain ? p.threads.filter((t) => t.messages.some((m) => [m.from, ...m.to].some((x) => x.email.endsWith('@' + client.domain)))) : [];
  const clientChannel = client ? p.channels.find((c) => c.clientId === client.id) : undefined;
  const clientMeetings = client ? p.meetings.filter((m) => m.clientId === client.id) : [];

  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head">
        <button className="icon-btn menu-btn" onClick={p.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        {client && (
          <span className="client-badge" style={{ background: client.color }}>
            {client.name.charAt(0)}
          </span>
        )}
        <div className="th-text">
          <h1>{heading}</h1>
          <p>
            {client
              ? `${client.status === 'lead' ? 'Lead' : client.status === 'paused' ? 'Paused' : 'Active client'}${client.domain ? ` · @${client.domain}` : ''} · owner ${person(client.ownerId)?.name ?? 'not set'}`
              : `${open.length} open${overdue ? ` · ${overdue} overdue` : ''}`}
          </p>
        </div>
        <button className="primary-btn sm brain-btn" onClick={p.onBrainDump}>
          <Sparkles size={14} /> Brain dump
        </button>
        <div className="segmented icon-seg">
          <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')} title="List">
            <List size={15} />
          </button>
          <button className={layout === 'board' ? 'on' : ''} onClick={() => setLayout('board')} title="Board">
            <Columns3 size={15} />
          </button>
        </div>
      </header>

      {client && (
        <div className="client-tabs">
          {(
            [
              ['tasks', `Tasks · ${open.length}`],
              ['emails', `Emails · ${clientThreads.length}`],
              ['meetings', `Meetings · ${clientMeetings.length}`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={clientTab === id ? 'on' : ''} onClick={() => setClientTab(id)}>
              {label}
            </button>
          ))}
          {clientChannel && (
            <button onClick={() => p.onOpenChannel(clientChannel.id)}>
              <Hash size={13} /> {clientChannel.name}
            </button>
          )}
        </div>
      )}

      <div className="tracking-scroll" key={`${JSON.stringify(p.scope)}:${layout}:${clientTab}`}>
        {(!client || clientTab === 'tasks') && (
          <>
            <div className="todo-add task-add">
              <Plus size={16} />
              <input id="new-task" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={client ? `Add a task for ${client.name}…` : 'Add a task…'} />
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to">
                {p.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id === p.me ? 'Me' : u.name.split(' ')[0]}
                  </option>
                ))}
              </select>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
              <button className="primary-btn sm" onClick={add} disabled={!title.trim()}>
                Add
              </button>
            </div>

            {layout === 'board' ? (
              <div className="board">
                {COLUMNS.map((col) => {
                  const items = shown.filter((t) => statusOf(t) === col.id);
                  return (
                    <div
                      key={col.id}
                      className={`board-col ${dragging ? 'droppable' : ''}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragging) p.onStatus(dragging, col.id);
                        setDragging(null);
                      }}
                    >
                      <div className="board-head">
                        {col.name} <span>{items.length}</span>
                      </div>
                      {items.map((t) => {
                        const c = clientOf(t.clientId);
                        const d = t.due ? dueLabel(t.due) : null;
                        const owner = person(t.userId);
                        return (
                          <div key={t.id} className={`card-task ${t.priority === 'high' ? 'high' : ''}`} draggable onDragStart={() => setDragging(t.id)} onDragEnd={() => setDragging(null)}>
                            <div className="ct-title">{t.title}</div>
                            <div className="ct-meta">
                              {c && !client && (
                                <span className="client-chip" style={{ ['--c' as string]: c.color }}>
                                  {c.name}
                                </span>
                              )}
                              {d && col.id !== 'done' && <span className={`due ${d.cls}`}>{d.text}</span>}
                              <span className="spacer" />
                              {owner && <Avatar person={owner} size={22} />}
                            </div>
                          </div>
                        );
                      })}
                      {items.length === 0 && <div className="board-empty">Drop tasks here</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {open.length === 0 && (
                  <div className="empty">
                    <div className="empty-art">✓</div>
                    <p className="empty-title">Nothing open</p>
                    <p className="empty-sub">Add a task above, or use Brain dump to turn your thoughts into tasks.</p>
                  </div>
                )}
                {groups.map(([cid, list]) => {
                  const c = clientOf(cid);
                  return (
                    <div key={cid || 'none'} className="todo-group">
                      {!client && (
                        <div className="d-heading">
                          {c ? (
                            <>
                              <span className="dot" style={{ background: c.color }} />
                              {c.name}
                            </>
                          ) : (
                            'No client'
                          )}{' '}
                          <span>{list.length}</span>
                        </div>
                      )}
                      {list.map(row)}
                    </div>
                  );
                })}
                {done.length > 0 && (
                  <div className="todo-group">
                    <button className="d-heading done-toggle" onClick={() => setShowDone((s) => !s)}>
                      Done <span>{done.length}</span> {showDone ? '▾' : '▸'}
                    </button>
                    {showDone && done.map(row)}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {client && clientTab === 'emails' && (
          <div className="te-list">
            {clientThreads.length === 0 && <p className="te-empty">No emails with @{client.domain ?? 'this client'} yet.</p>}
            {clientThreads.map((t) => {
              const last = t.messages[t.messages.length - 1];
              return (
                <button key={t.id} className="te-row simple" onClick={() => p.onOpenThread(t.id)}>
                  <Avatar person={last.from} size={30} />
                  <div className="te-main">
                    <strong>{t.subject}</strong>
                    <small>
                      {last.from.name} · {relative(last.date)}
                    </small>
                  </div>
                  {t.unread && <span className="te-status seen">New</span>}
                </button>
              );
            })}
          </div>
        )}

        {client && clientTab === 'meetings' && (
          <div className="te-list">
            {clientMeetings.length === 0 && <p className="te-empty">No recorded meetings with {client.name} yet.</p>}
            {clientMeetings.map((m) => (
              <button key={m.id} className="te-row simple" onClick={() => p.onOpenMeeting(m.id)}>
                <span className="kpi-icon">
                  <Video size={15} />
                </span>
                <div className="te-main">
                  <strong>{m.title}</strong>
                  <small>
                    {relative(m.at)} · {m.minutes} min · {m.actions.length} action items
                  </small>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
