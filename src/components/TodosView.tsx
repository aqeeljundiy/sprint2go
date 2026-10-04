import { useState } from 'react';
import { CalendarPlus, Check, Loader2, Mail, Menu, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Thread, Todo } from '../types';
import { AI_LIVE } from '../ai';

interface Props {
  todos: Todo[];
  threads: Thread[];
  scanning: boolean;
  onAdd: (title: string, due?: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onToCalendar: (t: Todo) => void;
  onOpenThread: (id: string) => void;
  onScan: () => void;
  onMenu: () => void;
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

function dueLabel(due: string) {
  const today = dayStr(new Date());
  const tomorrow = dayStr(new Date(Date.now() + 86_400_000));
  if (due < today) return { text: 'Overdue', cls: 'overdue' };
  if (due === today) return { text: 'Today', cls: 'today' };
  if (due === tomorrow) return { text: 'Tomorrow', cls: 'soon' };
  return { text: new Date(due + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), cls: '' };
}

export function TodosView({ todos, threads, scanning, onAdd, onToggle, onDelete, onToCalendar, onOpenThread, onScan, onMenu }: Props) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const today = dayStr(new Date());

  const open = todos.filter((t) => !t.done);
  const groups: [string, Todo[]][] = [
    ['Overdue', open.filter((t) => t.due && t.due < today)],
    ['Today', open.filter((t) => t.due === today)],
    ['Upcoming', open.filter((t) => t.due && t.due > today).sort((a, b) => a.due!.localeCompare(b.due!))],
    ['No date', open.filter((t) => !t.due)],
  ];
  const done = todos.filter((t) => t.done);

  const add = () => {
    if (!title.trim()) return;
    onAdd(title.trim(), due || undefined);
    setTitle('');
    setDue('');
  };

  const row = (t: Todo) => {
    const th = t.threadId ? threads.find((x) => x.id === t.threadId) : undefined;
    const d = t.due ? dueLabel(t.due) : null;
    return (
      <div key={t.id} className={`todo ${t.done ? 'done' : ''} ${t.priority === 'high' ? 'high' : ''}`}>
        <button className="todo-check" onClick={() => onToggle(t.id)} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
          {t.done && <Check size={13} strokeWidth={3} />}
        </button>
        <div className="todo-main">
          <span className="todo-title">{t.title}</span>
          <span className="todo-meta">
            {d && <span className={`due ${d.cls}`}>{d.text}</span>}
            {t.source === 'ai' && (
              <span className="ai-tag">
                <Sparkles size={11} /> AI
              </span>
            )}
            {th && (
              <button className="todo-src" onClick={() => onOpenThread(th.id)}>
                <Mail size={12} /> {th.messages[0].from.name.split(' ')[0]} · {th.subject}
              </button>
            )}
          </span>
        </div>
        <div className="todo-actions">
          {!t.done && (
            <button className="icon-btn sm" title="Add to calendar" onClick={() => onToCalendar(t)}>
              <CalendarPlus size={15} />
            </button>
          )}
          <button className="icon-btn sm" title="Delete" onClick={() => onDelete(t.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="todos-pane view-enter">
      <header className="tracking-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div>
          <h1>To-do</h1>
          <p>{open.length ? `${open.length} open · AI picks tasks out of new email for you` : 'You’re all done'}</p>
        </div>
        <button className="ghost-btn outline sm scan-btn" onClick={onScan} disabled={scanning}>
          {scanning ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {scanning ? 'Reading inbox…' : 'Scan inbox'}
          {!AI_LIVE && <span className="demo-tag">Demo</span>}
        </button>
      </header>

      <div className="tracking-scroll">
        <div className="todo-add">
          <Plus size={16} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a to-do…" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <button className="primary-btn sm" onClick={add} disabled={!title.trim()}>
            Add
          </button>
        </div>

        {open.length === 0 && (
          <div className="empty">
            <div className="empty-art">✓</div>
            <p className="empty-title">Nothing to do</p>
            <p className="empty-sub">New tasks from your email will show up here.</p>
          </div>
        )}

        {groups.map(([name, list]) =>
          list.length ? (
            <div key={name} className="todo-group">
              <div className={`d-heading ${name === 'Overdue' ? 'red' : ''}`}>
                {name} <span>{list.length}</span>
              </div>
              {list.map(row)}
            </div>
          ) : null,
        )}

        {done.length > 0 && (
          <div className="todo-group">
            <button className="d-heading done-toggle" onClick={() => setShowDone((s) => !s)}>
              Done <span>{done.length}</span> {showDone ? '▾' : '▸'}
            </button>
            {showDone && done.map(row)}
          </div>
        )}
      </div>
    </section>
  );
}
