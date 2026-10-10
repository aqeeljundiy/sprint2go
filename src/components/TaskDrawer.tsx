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
import { SOURCE, doers, dueLabel, historyText, isBrief, peopleOptions, statusOf, teamOptions } from './TasksView';
import { kindOf, stageBadge, stageIdFor, stageName, stageOf, stagesForTask, toneOf } from '../stages';
import { PeoplePicker } from './ui/PeoplePicker';
import { useOnePanel } from '../onePanel';
import { usePhone } from '../mobile/media';
import { TaskDetail } from './tasks/TaskDetail';
import { t, tx } from '../i18n';
import { tj } from '../i18n/tj';
import { fmtDateTime, fmtTime } from '../i18n/format';

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
  onToCalendar: (task: Todo) => void;
  onAddSubtask: (briefId: string, task: { title: string; userId: string; teamId?: string; due?: string }) => void;
  onOpenThread: (id: string) => void;
  onOpenChannel?: (clientId: string) => void;
  onAskApproval: (id: string) => void;
  onComment: (id: string, text: string, toClient?: boolean) => void;
  clientNames?: Record<string, string>; // client people by email (for their comments)
  onSendBack: (id: string, note: string) => void;
  onSaveTemplate?: (briefId: string) => void;
  onDuplicate?: (task: Todo) => void;
}

/** A task or brief, opened. A brief shows its context and its tasks; a task shows the brief it belongs to and who's in charge. */
export function TaskDrawer(p: Props) {
  useOnePanel(p.onClose);
  const task = p.task;
  const brief = isBrief(task);
  const parent = task.briefId ? p.tasks.find((x) => x.id === task.briefId) : undefined;
  const subs = brief ? p.tasks.filter((x) => x.briefId === task.id) : [];
  const person = (id?: string) => p.users.find((u) => u.id === id);
  const teamOf = (id?: string) => p.teams.find((x) => x.id === id);
  const [subTitle, setSubTitle] = useState('');
  const [subWho, setSubWho] = useState('');
  const [subTeam, setSubTeam] = useState('');
  const [subDue, setSubDue] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [comment, setComment] = useState('');
  const clientCanSee = !!task.clientId && (!!task.visibleToClient || task.source === 'request');
  const [toClient, setToClient] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [backNote, setBackNote] = useState('');
  const src = SOURCE[task.source];
  const phone = usePhone(); // a task's guest card is a row and a "…" item in the phone's sheet (TaskDetail)

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [task.title, task.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.pop') && p.onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [p]);

  const addSub = () => {
    if (!subTitle.trim()) return;
    p.onAddSubtask(task.id, { title: subTitle.trim(), userId: subWho, teamId: subTeam || undefined, due: subDue || undefined });
    setSubTitle('');
    setSubDue('');
  };

  const doneN = subs.filter((s) => s.done).length;
  const [checkText, setCheckText] = useState('');
  const checklist = task.checklist ?? [];
  const addCheck = () => {
    if (!checkText.trim()) return;
    p.onPatch(task.id, { checklist: [...checklist, { id: Math.random().toString(36).slice(2), text: checkText.trim(), done: false }] });
    setCheckText('');
  };
  const at9 = (day: string) => new Date(day + 'T09:00:00').toISOString();
  const dayBefore = (day: string) => {
    const d = new Date(day + 'T09:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  };
  const nine = fmtTime(new Date(2026, 0, 1, 9, 0));
  const remindChoices: [string, string][] = [
    [t('In 1 hour'), new Date(Date.now() + 3_600_000).toISOString()],
    [t('Tomorrow, {time}', { time: nine }), (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); })()],
    ...(task.due ? ([[t('The day before, {time}', { time: nine }), dayBefore(task.due)], [t('On the day, {time}', { time: nine }), at9(task.due)]] as [string, string][]) : []),
  ].filter(([, v]) => v > new Date().toISOString()) as [string, string][];
  const remindLabel = (iso: string) => fmtDateTime(iso);

  const fieldsBlock = (
          <dl className="fields">
            <dt>{t('Status')}</dt>
            <dd>
              <Select<TaskStatus>
                value={statusOf(task)}
                onChange={(v) => p.onStatus(task.id, v)}
                label={t('Status')}
                options={stagesForTask(task).map((s) => ({
                  value: s.id,
                  label: stageName(s),
                  hint: s.kind === 'waiting' ? t('The next step is the {who}’s', { who: term.who }) : s.kind === 'review' ? t('The supervisor checks it') : undefined,
                  icon: <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} />,
                }))}
              />
            </dd>
            {brief ? (
              <>
                <dt>{t('In charge')}</dt>
                <dd>
                  <Select value={task.userId} options={peopleOptions(p.users, p.me, false)} onChange={(v) => p.onPatch(task.id, { userId: v })} label={t('In charge')} />
                </dd>
              </>
            ) : (
              <>
                <dt>{tx('field', 'Doing it')}</dt>
                <dd>
                  <PeoplePicker value={doers(task)} users={p.users} me={p.me} label={tx('field', 'Doing it')} emptyText={t('Waiting in the team queue')} onChange={(ids) => p.onPatch(task.id, { assignees: ids })} />
                </dd>
                <dt>{t('Supervisor')}</dt>
                <dd>
                  <Select
                    value={task.supervisorId ?? ''}
                    options={[{ value: '', label: t('Nobody') }, ...peopleOptions(p.users, p.me, false)]}
                    onChange={(v) => p.onPatch(task.id, { supervisorId: v || undefined })}
                    label={t('Supervisor')}
                  />
                </dd>
                <dt>{t('Followers')}</dt>
                <dd>
                  <PeoplePicker value={task.followers ?? []} users={p.users} me={p.me} label={t('Followers')} emptyText={t('Add people to keep informed')} onChange={(ids) => p.onPatch(task.id, { followers: ids })} />
                </dd>
              </>
            )}
            {!brief && (
              <>
                <dt>{t('Team')}</dt>
                <dd>
                  <Select value={task.teamId ?? ''} options={teamOptions(p.teams)} onChange={(v) => p.onPatch(task.id, { teamId: v || undefined })} label={t('Team')} />
                </dd>
              </>
            )}
            <dt>{term.One}</dt>
            <dd>
              <ProjectPicker value={task.clientId ?? ''} projects={p.clients} none={t('No {project}', { project: term.one })} onChange={(v) => p.onPatch(task.id, { clientId: v || undefined })} />
            </dd>
            <dt>{t('Due')}</dt>
            <dd>
              <DatePicker value={task.due ?? ''} onChange={(v) => p.onPatch(task.id, { due: v || undefined })} label={t('Due date')} placeholder={t('No date')} />
              {task.due && !task.done && dueLabel(task.due).cls && <span className={`due ${dueLabel(task.due).cls}`}>{dueLabel(task.due).text}</span>}
              {task.due && !task.done && dueLabel(task.due).cls !== 'overdue' && holidayOn(task.due) && <span className="hol-hint">{t('{holiday} is a public holiday', { holiday: holidayOn(task.due) ?? '' })}</span>}
            </dd>
            {!brief && (
              <>
                <dt>{t('Repeats')}</dt>
                <dd>
                  <Select<Repeat | ''>
                    value={task.repeat ?? ''}
                    onChange={(v) => p.onPatch(task.id, { repeat: v || undefined, ...(v && !task.due ? { due: localDay() } : {}) })}
                    label={t('Repeats')}
                    options={[
                      { value: '', label: t('Never') },
                      { value: 'daily', label: t('Every day'), icon: <RepeatIcon size={14} /> },
                      { value: 'weekdays', label: t('Every weekday'), icon: <RepeatIcon size={14} /> },
                      { value: 'weekly', label: t('Every week'), icon: <RepeatIcon size={14} /> },
                      { value: 'monthly', label: t('Every month'), icon: <RepeatIcon size={14} /> },
                    ]}
                  />
                  {task.repeat && <span className="muted small">{t('When it’s done, the next one appears')}</span>}
                </dd>
                <dt>{t('Reminder')}</dt>
                <dd>
                  <Select
                    value={task.remindAt && !task.reminded ? task.remindAt : ''}
                    onChange={(v) => p.onPatch(task.id, { remindAt: v || undefined, reminded: false })}
                    label={t('Reminder')}
                    options={[
                      { value: '', label: tx('option', 'No reminder') },
                      ...(task.remindAt && !task.reminded && !remindChoices.some(([, v]) => v === task.remindAt) ? [{ value: task.remindAt, label: remindLabel(task.remindAt), icon: <Bell size={14} /> }] : []),
                      ...remindChoices.map(([l, v]) => ({ value: v, label: l, hint: remindLabel(v), icon: <Bell size={14} /> })),
                    ]}
                  />
                </dd>
              </>
            )}
            <dt>{t('Priority')}</dt>
            <dd>
              <Select<'normal' | 'high'>
                value={task.priority}
                onChange={(v) => p.onPatch(task.id, { priority: v })}
                label={t('Priority')}
                options={[
                  { value: 'normal', label: t('Normal') },
                  { value: 'high', label: t('High'), icon: <span className="st-dot st-high" /> },
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
            {task.createdBy && <span>{t('Created by {name} {when}', { name: task.createdBy === p.me ? t('you') : (person(task.createdBy)?.name ?? t('someone')), when: relative(task.createdAt) })}</span>}
            {task.done && task.doneAt && <span>{t('Done by {name} {when}', { name: task.doneBy === p.me ? t('you') : (person(task.doneBy)?.name ?? t('someone')), when: relative(task.doneAt) })}</span>}
            {task.threadId && (
              <button className="link-btn" onClick={() => p.onOpenThread(task.threadId!)}>
                {t('Open the email')}
              </button>
            )}
            {task.clientId && p.onOpenChannel && (
              <button className="link-btn" onClick={() => p.onOpenChannel!(task.clientId!)}>
                <Hash size={12} /> {t('{Project} channel', { project: term.one })}
              </button>
            )}
          </div>
  );

  const aboveBlock = (
    <>
          {parent && (
            <button className="parent-brief" onClick={() => p.onOpen(parent.id)}>
              <span className="pb-head">
                <FileText size={13} /> {tj('Part of {title}', { title: <strong>{parent.title}</strong> })}
              </span>
              <span className="pb-owner">
                {person(parent.userId) && <Avatar person={person(parent.userId)!} size={18} />}
                {parent.userId === p.me ? t('You’re in charge') : t('{name} in charge', { name: person(parent.userId)?.name ?? t('Someone') })}
              </span>
              {parent.context && <span className="pb-context">{parent.context.slice(0, 260)}{parent.context.length > 260 ? '…' : ''}</span>}
              <span className="pb-open">{t('Open the brief')}</span>
            </button>
          )}

          {task.clientId && !(phone && !brief) && (
            <div className={`client-vis ${task.visibleToClient ? 'on' : ''}`}>
              <button className="cv-toggle" onClick={() => p.onPatch(task.id, { visibleToClient: !task.visibleToClient })}>
                {task.visibleToClient ? <Eye size={15} /> : <EyeOff size={15} />}
                <span>
                  <strong>{task.visibleToClient ? t('Visible to {whos}', { whos: term.whos }) : t('Internal only')}</strong>
                  <small>{task.visibleToClient ? t('{name} can see this in their shared space', { name: p.clients.find((c) => c.id === task.clientId)?.name ?? term.One }) : t('Only your team can see this')}</small>
                </span>
              </button>
              {!brief &&
                (task.approval ? (
                  <span className={`ap-tag ${task.approval.status}`}>
                    {task.approval.status === 'waiting' ? (
                      <>
                        <Clock size={12} /> {t('Waiting for {who} approval', { who: term.who })}
                      </>
                    ) : task.approval.status === 'approved' ? (
                      <>
                        <CheckCircle2 size={12} /> {task.approval.at ? t('Approved {when}', { when: relative(task.approval.at) }) : t('Approved')}
                      </>
                    ) : (
                      <>
                        <RotateCcw size={12} /> {t('Changes asked: “{note}”', { note: task.approval.note ?? '' })}
                      </>
                    )}
                  </span>
                ) : (
                  <button className="ghost-btn sm" onClick={() => p.onAskApproval(task.id)}>
                    <CheckCircle2 size={13} /> {t('Ask {who} to approve', { who: term.who })}
                  </button>
                ))}
              {task.approval && task.approval.status !== 'waiting' && (
                <button className="link-btn small" onClick={() => p.onAskApproval(task.id)}>
                  {t('Ask again')}
                </button>
              )}
            </div>
          )}

          <SmoothHeight>
          {kindOf(task) === 'review' && (
            <div className="review-banner">
              <span>
                <strong>{stageBadge(stageOf(task))}</strong>
                <small>
                  {task.supervisorId === p.me
                    ? t('You supervise this. Approve it, or send it back with a note.')
                    : (() => {
                        const who = p.users.find((u) => u.id === task.supervisorId)?.name.split(' ')[0];
                        return who ? t('{name} checks it before it counts as done.', { name: who }) : t('The supervisor checks it before it counts as done.');
                      })()}
                </small>
              </span>
              {task.supervisorId === p.me && (
                <span className="rb-actions">
                  {sendingBack ? (
                    <>
                      <input autoFocus value={backNote} onChange={(e) => setBackNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && backNote.trim() && (p.onSendBack(task.id, backNote.trim()), setSendingBack(false), setBackNote(''))} placeholder={t('What needs to change?')} />
                      <button className="primary-btn sm" disabled={!backNote.trim()} onClick={() => (p.onSendBack(task.id, backNote.trim()), setSendingBack(false), setBackNote(''))}>
                        {t('Send back')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="ghost-btn sm" onClick={() => setSendingBack(true)}>
                        {t('Send back')}
                      </button>
                      <button className="primary-btn sm" onClick={() => p.onStatus(task.id, stageIdFor(task, 'done'))}>
                        {t('Approve')}
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          )}
          </SmoothHeight>
    </>
  );
  const historyBlock = (
          <ol className="history">
            {(task.history ?? []).map((h) => {
              const who = p.users.find((u) => u.id === h.by);
              const fromClient = h.by.includes('@');
              const name = fromClient ? (p.clientNames?.[h.by.toLowerCase()] ?? h.by) : who ? (who.id === p.me ? t('You') : who.name.split(' ')[0]) : (h.byName ?? t('Someone'));
              return (
                <li key={h.id} className={`h-${h.kind} ${fromClient ? 'h-client' : ''}`}>
                  {who ? <Avatar person={who} size={22} /> : fromClient ? <span className="avatar-empty sm client">{name.charAt(0)}</span> : h.byName ? <Avatar person={{ name: h.byName, email: h.byName }} size={22} /> : <span className="avatar-empty sm">?</span>}
                  <span className="h-body">
                    {h.kind === 'comment' ? (
                      <>
                        <b>
                          {name}
                          {fromClient && <em className="h-tag client">{term.One}</em>}
                          {!fromClient && h.toClient && <em className="h-tag">{t('To {who}', { who: term.who })}</em>}
                        </b>
                        <span className="h-comment">{h.text}</span>
                      </>
                    ) : (
                      <span>
                        <b>{name}</b> {historyText(h)}
                      </span>
                    )}
                    <time>{relative(h.at)}</time>
                  </span>
                </li>
              );
            })}
          </ol>
  );

  // A task: its own panel (a sheet on phones), with set fields as rows and the rest as chips.
  if (!brief)
    return (
      <TaskDetail
        t={task}
        wsId={task.workspaceId ?? ''}
        users={p.users}
        me={p.me}
        clients={p.clients}
        teams={p.teams}
        onClose={p.onClose}
        onPatch={p.onPatch}
        onStatus={p.onStatus}
        onDelete={p.onDelete}
        onDuplicate={p.onDuplicate}
        onToCalendar={p.onToCalendar}
        onComment={p.onComment}
        clientCanSee={clientCanSee}
        above={aboveBlock}
        history={historyBlock}
        meta={metaBlock}
        guest={task.clientId ? { visible: !!task.visibleToClient, toggle: () => p.onPatch(task.id, { visibleToClient: !task.visibleToClient }), approval: task.approval, ask: () => p.onAskApproval(task.id) } : undefined}
      />
    );

  // A brief has a lot to read (goal, context, everyone's tasks): a large dialog in the middle. A task: the side panel.
  const Shell = brief ? 'div' : 'aside';
  return (
    <div className={brief ? 'modal-scrim' : 'drawer-scrim'} onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <Shell className={brief ? 'modal big-modal brief-modal' : 'drawer'} role="dialog" aria-label={brief ? t('Brief') : t('Task')}>
        <header className="drawer-head">
          {brief ? (
            <span className="brief-badge">
              <FileText size={12} /> {t('Brief')}
            </span>
          ) : (
            <span className="drawer-kind">{t('Task')}</span>
          )}
          <span className="spacer" />
          {brief && p.onSaveTemplate && (
            <button className="icon-btn sm" title={t('Save as a template')} aria-label={t('Save as a template')} onClick={() => p.onSaveTemplate!(task.id)}>
              <LayoutTemplate size={16} />
            </button>
          )}
          {!brief && !task.done && (
            <button className="icon-btn sm" title={t('Add to calendar')} aria-label={t('Add to calendar')} onClick={() => p.onToCalendar(task)}>
              <CalendarPlus size={16} />
            </button>
          )}
          <button className="icon-btn sm" title={t('Delete')} aria-label={t('Delete')} onClick={() => (p.onDelete(task.id), p.onClose())}>
            <Trash2 size={16} />
          </button>
          <button className="icon-btn sm" onClick={p.onClose} aria-label={t('Close')}>
            <X size={18} />
          </button>
        </header>

        <div className={`drawer-body${brief ? ' brief-body' : ''}`}>
          <div className={brief ? 'bf-main' : 'bf-flat'}>
          <div className="drawer-title-row">
            {!brief && (
              <button className={`todo-check big ${task.done ? 'on' : ''}`} onClick={() => p.onStatus(task.id, stageIdFor(task, task.done ? 'open' : 'done'))} aria-label={task.done ? t('Mark not done') : t('Mark done')}>
                {task.done && <span>✓</span>}
              </button>
            )}
            <textarea ref={titleRef} className="drawer-title" rows={1} value={task.title} onChange={(e) => p.onPatch(task.id, { title: e.target.value })} aria-label={t('Task title')} />
          </div>

          {aboveBlock}

          {!brief && fieldsBlock}

          {brief ? (
            <>
              <label className="drawer-label">{t('Context')}</label>
              <textarea
                className="drawer-notes tall"
                value={task.context ?? ''}
                onChange={(e) => p.onPatch(task.id, { context: e.target.value })}
                placeholder={t('Goal, background, what to deliver, deadlines, links to files…')}
              />
              <div className="drawer-label label-row">
                {t('Tasks in this brief')}
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
                      <button className="todo-check" onClick={() => p.onStatus(s.id, stageIdFor(s, s.done ? 'open' : 'done'))} aria-label={s.done ? t('Mark not done') : t('Mark done')}>
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
                  <input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder={t('Add a task to this brief…')} />
                  <Select value={subWho} options={peopleOptions(p.users, p.me)} onChange={setSubWho} label={t('Assign to')} compact renderValue={() => (person(subWho) ? <Avatar person={person(subWho)!} size={22} /> : <span className="avatar-empty sm">?</span>)} />
                  <Select value={subTeam} options={teamOptions(p.teams)} onChange={setSubTeam} label={t('Team')} className="sel-flat" />
                  <DatePicker value={subDue} onChange={setSubDue} compact label={t('Due')} className="sel-flat" />
                  <button className="primary-btn sm" onClick={addSub} disabled={!subTitle.trim()}>
                    {t('Add')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <label className="drawer-label">{t('Notes')}</label>
              <textarea className="drawer-notes" value={task.notes ?? ''} onChange={(e) => p.onPatch(task.id, { notes: e.target.value })} placeholder={t('Details, links, what done looks like…')} />
              <div className="drawer-label label-row">
                {tx('task', 'Checklist')}
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
                      <input type="checkbox" checked={c.done} onChange={() => p.onPatch(task.id, { checklist: checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                      <span>{c.text}</span>
                    </label>
                    <button className="icon-btn sm" aria-label={t('Remove {step}', { step: c.text })} onClick={() => p.onPatch(task.id, { checklist: checklist.filter((x) => x.id !== c.id) })}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
                <li className="check-add">
                  <Plus size={14} />
                  <input value={checkText} onChange={(e) => setCheckText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCheck()} placeholder={t('Add a step…')} />
                </li>
              </ul>
            </>
          )}

          <label className="drawer-label">{t('History')}</label>
          {historyBlock}
          <div className={`comment-box ${toClient ? 'to-client' : ''}`}>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && comment.trim() && (e.preventDefault(), p.onComment(task.id, comment.trim(), toClient), setComment(''))} placeholder={toClient ? t('Reply to the {who}… they will see this', { who: term.who }) : t('Internal comment… @mention someone')} />
            <div className="cb-foot">
              {clientCanSee && (
                <label className="cb-toggle">
                  <input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} /> {t('{Who} can see this', { who: term.who })}
                </label>
              )}
              <button className="primary-btn sm" disabled={!comment.trim()} onClick={() => (p.onComment(task.id, comment.trim(), toClient), setComment(''))}>
                {toClient ? t('Send to {who}', { who: term.who }) : t('Comment')}
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
