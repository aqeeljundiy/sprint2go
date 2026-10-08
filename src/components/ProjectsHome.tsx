import { ProjectBadge } from './ProjectBadge';
import { useRef, useState } from 'react';
import { usePersisted } from '../settings';
import { Popover } from './ui/Popover';
import { ArrowRight, Check, Menu, Plus, SlidersHorizontal } from 'lucide-react';
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
  // What each card shows, chosen by each person.
  const [cardFields, setCardFields] = usePersisted<string[]>('s2g-project-card-fields', ['type', 'owner', 'state', 'next', 'updated']);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const fieldsBtn = useRef<HTMLButtonElement>(null);
  const on = (id: string) => cardFields.includes(id);
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
    const next = open.filter((t) => t.due && t.due >= today).sort((a, b) => a.due!.localeCompare(b.due!))[0];
    return { late, nobody, guest, open: open.length, last, next };
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
        <button ref={fieldsBtn} className="icon-btn" onClick={() => setFieldsOpen(true)} title="What cards show" aria-label="Fields">
          <SlidersHorizontal size={16} />
        </button>
        <Popover anchor={fieldsBtn} open={fieldsOpen} onClose={() => setFieldsOpen(false)} width={240} align="end" title="On each card">
          <div className="tab-edit-list">
            <p className="muted small">What each {term.one} card shows. Just for you.</p>
            {(
              [
                ['type', 'Type and status'],
                ['owner', 'Owner'],
                ['people', 'People on it'],
                ['state', 'What needs attention'],
                ['next', 'Next deadline'],
                ['updated', 'Last activity'],
              ] as const
            ).map(([id, name]) => (
              <label key={id} className="check-row tb-field-toggle">
                <input type="checkbox" checked={on(id)} onChange={(e) => setCardFields(e.target.checked ? [...cardFields, id] : cardFields.filter((x) => x !== id))} /> {name}
              </label>
            ))}
          </div>
        </Popover>
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
                    <ProjectBadge p={c} kind="client-badge" />
                    <span className="proj-name">
                      <strong>{c.name}</strong>
                      {on('type') && (
                        <small>
                          {[c.type, c.status === 'lead' ? 'Lead' : c.status === 'paused' ? 'Paused' : null].filter(Boolean).join(' · ') || ' '}
                        </small>
                      )}
                    </span>
                    {on('owner') && owner && <Avatar person={owner} size={24} />}
                  </span>
                  {on('people') && (c.members?.length ?? 0) > 0 && (
                    <span className="avatar-stack proj-card-people">
                      {(c.members ?? []).slice(0, 5).map((m) => {
                        const u = users.find((x) => x.id === m.userId);
                        return u ? <Avatar key={u.id} person={u} size={20} /> : null;
                      })}
                    </span>
                  )}
                  {on('next') && s.next && (
                    <span className="proj-next small">
                      Next: {s.next.title} · {new Date(`${s.next.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {on('state') && <span className={`proj-state ${issues.length ? (s.late ? 'bad' : 'warn') : 'ok'}`}>
                    {issues.length ? (
                      issues.join(' · ')
                    ) : (
                      <>
                        <Check size={13} /> {s.open ? 'On track' : 'Nothing open'}
                      </>
                    )}
                  </span>}
                  <span className="proj-foot">
                    <small>{on('updated') ? (s.last ? `Updated ${relative(s.last)}` : 'No activity yet') : ''}</small>
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
