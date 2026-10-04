import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, CheckCircle2, Clock, Eye, EyeOff, FileText, Hash, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { Client, TaskStatus, Team, Todo, User } from '../types';
import { relative } from '../utils';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { DatePicker } from './ui/DatePicker';
import { SOURCE, clientOptions, dueLabel, isBrief, peopleOptions, statusOf, teamOptions } from './TasksView';

interface Props {
  task: Todo;
  tasks: Todo[];
  clients: Client[];
  teams: Team[];
  users: User[];
  me: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onPatch: (id: string, p: Partial<Todo>) => void;
  onStatus: (id: string, s: TaskStatus) => void;
  onDelete: (id: string) => void;
  onToCalendar: (t: Todo) => void;
  onAddSubtask: (briefId: string, t: { title: string; userId: string; teamId?: string; due?: string }) => void;
  onOpenThread: (id: string) => void;
  onOpenChannel?: (clientId: string) => void;
  onAskApproval: (id: string) => void;
}

/** A task or brief, opened. A brief shows its context and its tasks; a task shows the brief it belongs to and who's in charge. */
export function TaskDrawer(p: Props) {
  const t = p.task;
  const brief = isBrief(t);
  const parent = t.briefId ? p.tasks.find((x) => x.id === t.briefId) : undefined;
  const subs = brief ? p.tasks.filter((x) => x.briefId === t.id) : [];
  const person = (id?: string) => p.users.find((u) => u.id === id);
  const teamOf = (id?: string) => p.teams.find((x) => x.id === id);
  const [subTitle, setSubTitle] = useState('');
  const [subWho, setSubWho] = useState('');
  const [subTeam, setSubTeam] = useState('');
  const [subDue, setSubDue] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const src = SOURCE[t.source];

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [t.title, t.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.pop') && p.onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [p]);

  const addSub = () => {
    if (!subTitle.trim()) return;
    p.onAddSubtask(t.id, { title: subTitle.trim(), userId: subWho, teamId: subTeam || undefined, due: subDue || undefined });
    setSubTitle('');
    setSubDue('');
  };

  const doneN = subs.filter((s) => s.done).length;

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <aside className="drawer" role="dialog" aria-label={brief ? 'Brief' : 'Task'}>
        <header className="drawer-head">
          {brief ? (
            <span className="brief-badge">
              <FileText size={12} /> Brief
            </span>
          ) : (
            <span className="drawer-kind">Task</span>
          )}
          <span className="spacer" />
          {!brief && !t.done && (
            <button className="icon-btn sm" title="Add to calendar" onClick={() => p.onToCalendar(t)}>
              <CalendarPlus size={16} />
            </button>
          )}
          <button className="icon-btn sm" title="Delete" onClick={() => (p.onDelete(t.id), p.onClose())}>
            <Trash2 size={16} />
          </button>
          <button className="icon-btn sm" onClick={p.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <div className="drawer-title-row">
            {!brief && (
              <button className={`todo-check big ${t.done ? 'on' : ''}`} onClick={() => p.onStatus(t.id, t.done ? 'todo' : 'done')} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
                {t.done && <span>✓</span>}
              </button>
            )}
            <textarea ref={titleRef} className="drawer-title" rows={1} value={t.title} onChange={(e) => p.onPatch(t.id, { title: e.target.value })} aria-label="Title" />
          </div>

          {parent && (
            <button className="parent-brief" onClick={() => p.onOpen(parent.id)}>
              <span className="pb-head">
                <FileText size={13} /> Part of <strong>{parent.title}</strong>
              </span>
              <span className="pb-owner">
                {person(parent.userId) && <Avatar person={person(parent.userId)!} size={18} />}
                {parent.userId === p.me ? 'You are' : `${person(parent.userId)?.name ?? 'Someone'} is`} in charge
              </span>
              {parent.context && <span className="pb-context">{parent.context.slice(0, 260)}{parent.context.length > 260 ? '…' : ''}</span>}
              <span className="pb-open">Open the brief</span>
            </button>
          )}

          {t.clientId && (
            <div className={`client-vis ${t.visibleToClient ? 'on' : ''}`}>
              <button className="cv-toggle" onClick={() => p.onPatch(t.id, { visibleToClient: !t.visibleToClient })}>
                {t.visibleToClient ? <Eye size={15} /> : <EyeOff size={15} />}
                <span>
                  <strong>{t.visibleToClient ? 'Visible to client' : 'Internal only'}</strong>
                  <small>{t.visibleToClient ? `${p.clients.find((c) => c.id === t.clientId)?.name} can see this in their portal` : 'Only your team can see this'}</small>
                </span>
              </button>
              {!brief &&
                (t.approval ? (
                  <span className={`ap-tag ${t.approval.status}`}>
                    {t.approval.status === 'waiting' ? (
                      <>
                        <Clock size={12} /> Waiting for client approval
                      </>
                    ) : t.approval.status === 'approved' ? (
                      <>
                        <CheckCircle2 size={12} /> Approved {t.approval.at ? relative(t.approval.at) : ''}
                      </>
                    ) : (
                      <>
                        <RotateCcw size={12} /> Changes asked: “{t.approval.note}”
                      </>
                    )}
                  </span>
                ) : (
                  <button className="ghost-btn sm" onClick={() => p.onAskApproval(t.id)}>
                    <CheckCircle2 size={13} /> Ask client to approve
                  </button>
                ))}
              {t.approval && t.approval.status !== 'waiting' && (
                <button className="link-btn small" onClick={() => p.onAskApproval(t.id)}>
                  Ask again
                </button>
              )}
            </div>
          )}

          <dl className="fields">
            <dt>Status</dt>
            <dd>
              <Select<TaskStatus>
                value={statusOf(t)}
                onChange={(v) => p.onStatus(t.id, v)}
                label="Status"
                options={[
                  { value: 'todo', label: 'To do', icon: <span className="st-dot st-todo" /> },
                  { value: 'doing', label: 'In progress', icon: <span className="st-dot st-doing" /> },
                  { value: 'done', label: 'Done', icon: <span className="st-dot st-done" /> },
                ]}
              />
            </dd>
            <dt>{brief ? 'In charge' : 'Assignee'}</dt>
            <dd>
              <Select value={t.userId} options={peopleOptions(p.users, p.me, !brief)} onChange={(v) => p.onPatch(t.id, { userId: v })} label={brief ? 'In charge' : 'Assignee'} />
            </dd>
            {!brief && (
              <>
                <dt>Team</dt>
                <dd>
                  <Select value={t.teamId ?? ''} options={teamOptions(p.teams)} onChange={(v) => p.onPatch(t.id, { teamId: v || undefined })} label="Team" />
                </dd>
              </>
            )}
            <dt>Client</dt>
            <dd>
              <Select value={t.clientId ?? ''} options={clientOptions(p.clients)} onChange={(v) => p.onPatch(t.id, { clientId: v || undefined })} label="Client" />
            </dd>
            <dt>Due</dt>
            <dd>
              <DatePicker value={t.due ?? ''} onChange={(v) => p.onPatch(t.id, { due: v || undefined })} label="Due date" placeholder="No date" />
              {t.due && !t.done && <span className={`due ${dueLabel(t.due).cls}`}>{dueLabel(t.due).text}</span>}
            </dd>
            <dt>Priority</dt>
            <dd>
              <Select<'normal' | 'high'>
                value={t.priority}
                onChange={(v) => p.onPatch(t.id, { priority: v })}
                label="Priority"
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High', icon: <span className="st-dot st-high" /> },
                ]}
              />
            </dd>
          </dl>

          {brief ? (
            <>
              <label className="drawer-label">Context</label>
              <textarea
                className="drawer-notes tall"
                value={t.context ?? ''}
                onChange={(e) => p.onPatch(t.id, { context: e.target.value })}
                placeholder="Goal, background, what to deliver, deadlines, links to files…"
              />
              <div className="drawer-label row">
                Tasks in this brief
                <span className="bc-progress">
                  <span className="bar">
                    <span style={{ width: `${subs.length ? (doneN / subs.length) * 100 : 0}%` }} />
                  </span>
                  {doneN}/{subs.length}
                </span>
              </div>
              <div className="sub-list">
                {subs.map((s) => {
                  const u = person(s.userId);
                  const tm = teamOf(s.teamId);
                  return (
                    <div key={s.id} className={`sub ${s.done ? 'done' : ''}`}>
                      <button className="todo-check" onClick={() => p.onStatus(s.id, s.done ? 'todo' : 'done')} aria-label="Toggle done">
                        {s.done && <span>✓</span>}
                      </button>
                      <button className="sub-title" onClick={() => p.onOpen(s.id)}>
                        {s.title}
                      </button>
                      {tm && (
                        <span className="team-chip" style={{ ['--c' as string]: tm.color }}>
                          {tm.name}
                        </span>
                      )}
                      {s.due && !s.done && <span className={`due ${dueLabel(s.due).cls}`}>{dueLabel(s.due).text}</span>}
                      {u ? <Avatar person={u} size={22} /> : <span className="avatar-empty sm">?</span>}
                    </div>
                  );
                })}
                <div className="sub sub-add">
                  <Plus size={15} />
                  <input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder="Add a task to this brief…" />
                  <Select value={subWho} options={peopleOptions(p.users, p.me)} onChange={setSubWho} label="Assign to" compact renderValue={() => (person(subWho) ? <Avatar person={person(subWho)!} size={22} /> : <span className="avatar-empty sm">?</span>)} />
                  <Select value={subTeam} options={teamOptions(p.teams)} onChange={setSubTeam} label="Team" className="sel-flat" />
                  <DatePicker value={subDue} onChange={setSubDue} compact label="Due" className="sel-flat" />
                  <button className="primary-btn sm" onClick={addSub} disabled={!subTitle.trim()}>
                    Add
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <label className="drawer-label">Notes</label>
              <textarea className="drawer-notes" value={t.notes ?? ''} onChange={(e) => p.onPatch(t.id, { notes: e.target.value })} placeholder="Details, links, what done looks like…" />
            </>
          )}

          <div className="drawer-meta">
            <span>
              <src.icon size={12} /> {src.label}
            </span>
            {t.createdBy && <span>Created by {t.createdBy === p.me ? 'you' : (person(t.createdBy)?.name ?? 'someone')} {relative(t.createdAt)}</span>}
            {t.done && t.doneAt && <span>Done by {t.doneBy === p.me ? 'you' : (person(t.doneBy)?.name ?? 'someone')} {relative(t.doneAt)}</span>}
            {t.threadId && (
              <button className="link-btn" onClick={() => p.onOpenThread(t.threadId!)}>
                Open the email
              </button>
            )}
            {t.clientId && p.onOpenChannel && (
              <button className="link-btn" onClick={() => p.onOpenChannel!(t.clientId!)}>
                <Hash size={12} /> Client channel
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
