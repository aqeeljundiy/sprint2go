import { useEffect, useRef, useState } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { SmoothHeight } from './ui/Smooth';
import { term } from '../terms';
import { Bell, CalendarPlus, CheckCircle2, Clock, Eye, EyeOff, FileText, Hash, LayoutTemplate, Plus, Repeat as RepeatIcon, RotateCcw, Trash2, X } from 'lucide-react';
import type { Client, Repeat, TaskStatus, Team, Todo, User } from '../types';
import { localDay, relative } from '../utils';
import { Avatar } from './Avatar';
import { Select } from './ui/Select';
import { DatePicker } from './ui/DatePicker';
import { holidayOn } from '../holidayDays';
import { SOURCE, doers, dueLabel, isBrief, peopleOptions, statusOf, teamOptions } from './TasksView';
import { kindOf, stageBadge, stageIdFor, stageName, stageOf, stagesForTask, toneOf } from '../stages';
import { PeoplePicker } from './ui/PeoplePicker';
import { useOnePanel } from '../onePanel';

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
  onComment: (id: string, text: string, toClient?: boolean) => void;
  clientNames?: Record<string, string>; // client people by email (for their comments)
  onSendBack: (id: string, note: string) => void;
  onSaveTemplate?: (briefId: string) => void;
}

/** A task or brief, opened. A brief shows its context and its tasks; a task shows the brief it belongs to and who's in charge. */
export function TaskDrawer(p: Props) {
  useOnePanel(p.onClose);
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
  const [comment, setComment] = useState('');
  const clientCanSee = !!t.clientId && (!!t.visibleToClient || t.source === 'request');
  const [toClient, setToClient] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [backNote, setBackNote] = useState('');
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
  const [checkText, setCheckText] = useState('');
  const checklist = t.checklist ?? [];
  const addCheck = () => {
    if (!checkText.trim()) return;
    p.onPatch(t.id, { checklist: [...checklist, { id: Math.random().toString(36).slice(2), text: checkText.trim(), done: false }] });
    setCheckText('');
  };
  const at9 = (day: string) => new Date(day + 'T09:00:00').toISOString();
  const dayBefore = (day: string) => {
    const d = new Date(day + 'T09:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  };
  const remindChoices: [string, string][] = [
    ['In 1 hour', new Date(Date.now() + 3_600_000).toISOString()],
    ['Tomorrow 9:00', (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); })()],
    ...(t.due ? ([['Day before it’s due, 9:00', dayBefore(t.due)], ['On the due date, 9:00', at9(t.due)]] as [string, string][]) : []),
  ].filter(([, v]) => v > new Date().toISOString()) as [string, string][];
  const remindLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const fieldsBlock = (
          <dl className="fields">
            <dt>Status</dt>
            <dd>
              <Select<TaskStatus>
                value={statusOf(t)}
                onChange={(v) => p.onStatus(t.id, v)}
                label="Status"
                options={stagesForTask(t).map((s) => ({
                  value: s.id,
                  label: stageName(s),
                  hint: s.kind === 'waiting' ? `The next step is the ${term.who}’s` : s.kind === 'review' ? 'The supervisor checks it' : undefined,
                  icon: <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} />,
                }))}
              />
            </dd>
            {brief ? (
              <>
                <dt>In charge</dt>
                <dd>
                  <Select value={t.userId} options={peopleOptions(p.users, p.me, false)} onChange={(v) => p.onPatch(t.id, { userId: v })} label="In charge" />
                </dd>
              </>
            ) : (
              <>
                <dt>Doing it</dt>
                <dd>
                  <PeoplePicker value={doers(t)} users={p.users} me={p.me} label="Doing it" emptyText="Waiting in the team queue" onChange={(ids) => p.onPatch(t.id, { assignees: ids })} />
                </dd>
                <dt>Supervisor</dt>
                <dd>
                  <Select
                    value={t.supervisorId ?? ''}
                    options={[{ value: '', label: 'Nobody' }, ...peopleOptions(p.users, p.me, false)]}
                    onChange={(v) => p.onPatch(t.id, { supervisorId: v || undefined })}
                    label="Supervisor"
                  />
                </dd>
                <dt>Followers</dt>
                <dd>
                  <PeoplePicker value={t.followers ?? []} users={p.users} me={p.me} label="Followers" emptyText="Add people to keep informed" onChange={(ids) => p.onPatch(t.id, { followers: ids })} />
                </dd>
              </>
            )}
            {!brief && (
              <>
                <dt>Team</dt>
                <dd>
                  <Select value={t.teamId ?? ''} options={teamOptions(p.teams)} onChange={(v) => p.onPatch(t.id, { teamId: v || undefined })} label="Team" />
                </dd>
              </>
            )}
            <dt>{term.One}</dt>
            <dd>
              <ProjectPicker value={t.clientId ?? ''} projects={p.clients} none={`No ${term.one}`} onChange={(v) => p.onPatch(t.id, { clientId: v || undefined })} />
            </dd>
            <dt>Due</dt>
            <dd>
              <DatePicker value={t.due ?? ''} onChange={(v) => p.onPatch(t.id, { due: v || undefined })} label="Due date" placeholder="No date" />
              {t.due && !t.done && dueLabel(t.due).cls && <span className={`due ${dueLabel(t.due).cls}`}>{dueLabel(t.due).text}</span>}
              {t.due && !t.done && dueLabel(t.due).cls !== 'overdue' && holidayOn(t.due) && <span className="hol-hint">{holidayOn(t.due)} is a public holiday</span>}
            </dd>
            {!brief && (
              <>
                <dt>Repeats</dt>
                <dd>
                  <Select<Repeat | ''>
                    value={t.repeat ?? ''}
                    onChange={(v) => p.onPatch(t.id, { repeat: v || undefined, ...(v && !t.due ? { due: localDay() } : {}) })}
                    label="Repeats"
                    options={[
                      { value: '', label: 'Never' },
                      { value: 'daily', label: 'Every day', icon: <RepeatIcon size={14} /> },
                      { value: 'weekdays', label: 'Every weekday', icon: <RepeatIcon size={14} /> },
                      { value: 'weekly', label: 'Every week', icon: <RepeatIcon size={14} /> },
                      { value: 'monthly', label: 'Every month', icon: <RepeatIcon size={14} /> },
                    ]}
                  />
                  {t.repeat && <span className="muted small">When it’s done, the next one appears</span>}
                </dd>
                <dt>Reminder</dt>
                <dd>
                  <Select
                    value={t.remindAt && !t.reminded ? t.remindAt : ''}
                    onChange={(v) => p.onPatch(t.id, { remindAt: v || undefined, reminded: false })}
                    label="Reminder"
                    options={[
                      { value: '', label: 'No reminder' },
                      ...(t.remindAt && !t.reminded && !remindChoices.some(([, v]) => v === t.remindAt) ? [{ value: t.remindAt, label: remindLabel(t.remindAt), icon: <Bell size={14} /> }] : []),
                      ...remindChoices.map(([l, v]) => ({ value: v, label: l, hint: remindLabel(v), icon: <Bell size={14} /> })),
                    ]}
                  />
                </dd>
              </>
            )}
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
  );
  const metaBlock = (
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
                <Hash size={12} /> {term.One} channel
              </button>
            )}
          </div>
  );

  // A brief has a lot to read (goal, context, everyone's tasks): a large dialog in the middle. A task: the side panel.
  const Shell = brief ? 'div' : 'aside';
  return (
    <div className={brief ? 'modal-scrim' : 'drawer-scrim'} onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <Shell className={brief ? 'modal big-modal brief-modal' : 'drawer'} role="dialog" aria-label={brief ? 'Brief' : 'Task'}>
        <header className="drawer-head">
          {brief ? (
            <span className="brief-badge">
              <FileText size={12} /> Brief
            </span>
          ) : (
            <span className="drawer-kind">Task</span>
          )}
          <span className="spacer" />
          {brief && p.onSaveTemplate && (
            <button className="icon-btn sm" title="Save as a template" onClick={() => p.onSaveTemplate!(t.id)}>
              <LayoutTemplate size={16} />
            </button>
          )}
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

        <div className={`drawer-body${brief ? ' brief-body' : ''}`}>
          <div className={brief ? 'bf-main' : 'bf-flat'}>
          <div className="drawer-title-row">
            {!brief && (
              <button className={`todo-check big ${t.done ? 'on' : ''}`} onClick={() => p.onStatus(t.id, stageIdFor(t, t.done ? 'open' : 'done'))} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
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
                  <strong>{t.visibleToClient ? `Visible to ${term.whos}` : 'Internal only'}</strong>
                  <small>{t.visibleToClient ? `${p.clients.find((c) => c.id === t.clientId)?.name} can see this in their shared space` : 'Only your team can see this'}</small>
                </span>
              </button>
              {!brief &&
                (t.approval ? (
                  <span className={`ap-tag ${t.approval.status}`}>
                    {t.approval.status === 'waiting' ? (
                      <>
                        <Clock size={12} /> Waiting for {term.who} approval
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
                    <CheckCircle2 size={13} /> Ask {term.who} to approve
                  </button>
                ))}
              {t.approval && t.approval.status !== 'waiting' && (
                <button className="link-btn small" onClick={() => p.onAskApproval(t.id)}>
                  Ask again
                </button>
              )}
            </div>
          )}

          <SmoothHeight>
          {kindOf(t) === 'review' && (
            <div className="review-banner">
              <span>
                <strong>{stageBadge(stageOf(t))}</strong>
                <small>{t.supervisorId === p.me ? 'You supervise this. Approve it, or send it back with a note.' : `${p.users.find((u) => u.id === t.supervisorId)?.name.split(' ')[0] ?? 'The supervisor'} checks it before it counts as done.`}</small>
              </span>
              {t.supervisorId === p.me && (
                <span className="rb-actions">
                  {sendingBack ? (
                    <>
                      <input autoFocus value={backNote} onChange={(e) => setBackNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && backNote.trim() && (p.onSendBack(t.id, backNote.trim()), setSendingBack(false), setBackNote(''))} placeholder="What needs to change?" />
                      <button className="primary-btn sm" disabled={!backNote.trim()} onClick={() => (p.onSendBack(t.id, backNote.trim()), setSendingBack(false), setBackNote(''))}>
                        Send back
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="ghost-btn sm" onClick={() => setSendingBack(true)}>
                        Send back
                      </button>
                      <button className="primary-btn sm" onClick={() => p.onStatus(t.id, stageIdFor(t, 'done'))}>
                        Approve
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          )}
          </SmoothHeight>

          {!brief && fieldsBlock}

          {brief ? (
            <>
              <label className="drawer-label">Context</label>
              <textarea
                className="drawer-notes tall"
                value={t.context ?? ''}
                onChange={(e) => p.onPatch(t.id, { context: e.target.value })}
                placeholder="Goal, background, what to deliver, deadlines, links to files…"
              />
              <div className="drawer-label label-row">
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
                      <button className="todo-check" onClick={() => p.onStatus(s.id, stageIdFor(s, s.done ? 'open' : 'done'))} aria-label="Toggle done">
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
              <div className="drawer-label label-row">
                Checklist
                {checklist.length > 0 && (
                  <span className="bc-progress">
                    {checklist.filter((c) => c.done).length}/{checklist.length}
                  </span>
                )}
              </div>
              <ul className="checklist">
                {checklist.map((c) => (
                  <li key={c.id} className={c.done ? 'done' : ''}>
                    <label>
                      <input type="checkbox" checked={c.done} onChange={() => p.onPatch(t.id, { checklist: checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                      <span>{c.text}</span>
                    </label>
                    <button className="icon-btn sm" aria-label="Remove" onClick={() => p.onPatch(t.id, { checklist: checklist.filter((x) => x.id !== c.id) })}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
                <li className="check-add">
                  <Plus size={14} />
                  <input value={checkText} onChange={(e) => setCheckText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCheck()} placeholder="Add a step…" />
                </li>
              </ul>
            </>
          )}

          <label className="drawer-label">History</label>
          <ol className="history">
            {(t.history ?? []).map((h) => {
              const who = p.users.find((u) => u.id === h.by);
              const fromClient = h.by.includes('@');
              const name = fromClient ? (p.clientNames?.[h.by.toLowerCase()] ?? h.by) : who ? (who.id === p.me ? 'You' : who.name.split(' ')[0]) : 'Someone';
              return (
                <li key={h.id} className={`h-${h.kind} ${fromClient ? 'h-client' : ''}`}>
                  {who ? <Avatar person={who} size={22} /> : fromClient ? <span className="avatar-empty sm client">{name.charAt(0)}</span> : <span className="avatar-empty sm">?</span>}
                  <span className="h-body">
                    {h.kind === 'comment' ? (
                      <>
                        <b>
                          {name}
                          {fromClient && <em className="h-tag client">{term.One}</em>}
                          {!fromClient && h.toClient && <em className="h-tag">To {term.who}</em>}
                        </b>
                        <span className="h-comment">{h.text}</span>
                      </>
                    ) : (
                      <span>
                        <b>{name}</b> {h.text}
                      </span>
                    )}
                    <time>{relative(h.at)}</time>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className={`comment-box ${toClient ? 'to-client' : ''}`}>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && comment.trim() && (e.preventDefault(), p.onComment(t.id, comment.trim(), toClient), setComment(''))} placeholder={toClient ? `Reply to the ${term.who}… they will see this` : 'Internal comment… @mention someone'} />
            <div className="cb-foot">
              {clientCanSee && (
                <label className="cb-toggle">
                  <input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} /> {term.Who} can see this
                </label>
              )}
              <button className="primary-btn sm" disabled={!comment.trim()} onClick={() => (p.onComment(t.id, comment.trim(), toClient), setComment(''))}>
                {toClient ? `Send to ${term.who}` : 'Comment'}
              </button>
            </div>
          </div>

          {!brief && metaBlock}
          </div>
          {brief && (
            <aside className="bf-side">
              {fieldsBlock}
              {metaBlock}
            </aside>
          )}
        </div>
      </Shell>
    </div>
  );
}
