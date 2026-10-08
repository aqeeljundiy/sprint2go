import { useState } from 'react';
import { ArrowRight, Check, Menu, Plus } from 'lucide-react';
import type { Client, Todo, User } from '../types';
import { PROJECT_TYPES, term } from '../terms';
import { localDay, relative } from '../utils';
import { Avatar } from './Avatar';
import { isBrief, statusOf } from './TasksView';
import { Select } from './ui/Select';
import { SmoothHeight } from './ui/Smooth';

/**
 * The Projects app's home: every project, the ones that need something first. Each card says what's wrong (late,
 * nobody on it, waiting on a guest) or that it's on track, and opens the project's hub.
 */
export function ProjectsHome({ projects, tasks, users, onOpen, onCreate, onMenu, startAdding }: { startAdding?: boolean; projects: Client[]; tasks: Todo[]; users: User[]; onOpen: (id: string) => void; onCreate: (name: string, type?: string) => void; onMenu: () => void }) {
  const [adding, setAdding] = useState(!!startAdding);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const today = localDay();
  const live = projects.filter((c) => c.status !== 'ended');
  const stats = (c: Client) => {
    const open = tasks.filter((t) => t.clientId === c.id && !t.done && !isBrief(t));
    const late = open.filter((t) => t.due && t.due < today).length;
    const nobody = open.filter((t) => !t.userId && !(t.assignees?.length)).length;
    const guest = open.filter((t) => statusOf(t) === 'waiting' || t.approval?.status === 'waiting').length;
    const last = tasks
      .filter((t) => t.clientId === c.id)
      .map((t) => t.history?.at(-1)?.at ?? t.createdAt)
      .sort()
      .pop();
    return { late, nobody, guest, open: open.length, last };
  };
  const rows = live.map((c) => ({ c, s: stats(c) })).sort((a, b) => b.s.late - a.s.late || b.s.nobody - a.s.nobody || a.c.name.localeCompare(b.c.name));
  const save = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), type || undefined);
    setName('');
    setType('');
    setAdding(false);
  };
  return (
    <section className="tasks-pane view-enter">
      <header className="tracking-head tasks-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="th-text">
          <h1>{term.Many}</h1>
          <p>Everything about each one, in one place: tasks, chat, mail, meetings, files, notes and logins.</p>
        </div>
        <button className="primary-btn sm" onClick={() => setAdding((a) => !a)}>
          <Plus size={14} /> New {term.one}
        </button>
      </header>
      <div className="tracking-scroll">
        <SmoothHeight>
          {adding && (
            <div className="proj-new">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && setAdding(false))} placeholder={`${term.One} name`} />
              <Select<string> value={type} onChange={setType} label="Type" className="sel-flat" options={[{ value: '', label: 'No type' }, ...PROJECT_TYPES.map((t) => ({ value: t, label: t }))]} />
              <button className="ghost-btn sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button className="primary-btn sm" disabled={!name.trim()} onClick={save}>
                Add
              </button>
            </div>
          )}
        </SmoothHeight>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="empty-art">
              <Plus size={20} />
            </div>
            <p className="empty-title">No {term.many} yet</p>
            <p className="empty-sub">A {term.one} holds everything about one piece of work: its tasks, chat, mail, meetings, files, notes, logins and the guests you invite.</p>
            <button className="primary-btn sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> New {term.one}
            </button>
          </div>
        ) : (
          <div className="proj-grid">
            {rows.map(({ c, s }, i) => {
              const owner = users.find((u) => u.id === c.ownerId);
              const issues = [s.late && `${s.late} late`, s.nobody && `${s.nobody} not picked up`, s.guest && `${s.guest} waiting on ${term.who}`].filter(Boolean) as string[];
              return (
                <button key={c.id} className="proj-card" style={{ ['--i' as string]: i }} onClick={() => onOpen(c.id)}>
                  <span className="proj-top">
                    <span className="client-badge" style={{ background: c.color }}>
                      {c.name.charAt(0)}
                    </span>
                    <span className="proj-name">
                      <strong>{c.name}</strong>
                      <small>
                        {[c.type, c.status === 'lead' ? 'Lead' : c.status === 'paused' ? 'Paused' : null].filter(Boolean).join(' · ') || ' '}
                      </small>
                    </span>
                    {owner && <Avatar person={owner} size={24} />}
                  </span>
                  <span className={`proj-state ${issues.length ? (s.late ? 'bad' : 'warn') : 'ok'}`}>
                    {issues.length ? (
                      issues.join(' · ')
                    ) : (
                      <>
                        <Check size={13} /> {s.open ? 'On track' : 'Nothing open'}
                      </>
                    )}
                  </span>
                  <span className="proj-foot">
                    <small>{s.last ? `Updated ${relative(s.last)}` : 'No activity yet'}</small>
                    <ArrowRight size={14} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
