import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlignLeft, ArrowUp, Bell, CalendarDays, CalendarPlus, Check, CheckCircle2, ChevronRight, Clock, Copy, Eye, EyeOff, Flag, Hash, Link2, ListChecks, MoreHorizontal, Pencil, Plus, Repeat as RepeatIcon, RotateCcw, Trash2, UserRound, Users, X, type LucideIcon } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { SwipeRow } from '../ui/SwipeRow';
import { useLeaving } from '../ui/Smooth';
import { Avatar } from '../Avatar';
import { Select, Dot } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';
import { PeoplePicker } from '../ui/PeoplePicker';
import { useActionMenu } from '../ui/ActionSheet';
import { ProjectPicker } from '../ProjectPicker';
import { usePhone } from '../../mobile/media';
import { dateTone, addDays, dayDate } from '../../taskDates';
import { remindText } from '../../quickAdd';
import { stageName, stageOf, stageIdFor, stagesForTask, toneOf } from '../../stages';
import { holidayOn } from '../../holidayDays';
import { term } from '../../terms';
import { localDay, relative } from '../../utils';
import type { Client, Repeat, TaskStatus, Team, Todo, User } from '../../types';
import { copyTaskLink, doersOf } from './taskOps';
import { t, tn, tx } from '../../i18n';
import { fmtTime } from '../../i18n/format';

const repeats = (): { value: Repeat | ''; label: string }[] => [
  { value: '', label: t('Doesn’t repeat') },
  { value: 'daily', label: t('Every day') },
  { value: 'weekdays', label: t('Every weekday') },
  { value: 'weekly', label: t('Every week') },
  { value: 'monthly', label: t('Every month') },
];
/** 09:00 the local way ("09:00" / "09.00"). */
const nine = () => fmtTime(new Date(2026, 0, 1, 9, 0));

/**
 * A task, opened: its project and stage on top, then the fields it has as rows and the ones it doesn't as a row of
 * chips (tap a chip to give the task that field). A new task stays short; a busy one stays readable. The comment bar
 * is pinned to the bottom and says who will hear about it. A side panel on a computer, a sheet on a phone.
 */
export function TaskDetail({
  t: task,
  wsId,
  users,
  me,
  clients,
  teams,
  onClose,
  onPatch,
  onStatus,
  onDelete,
  onDuplicate,
  onToCalendar,
  onComment,
  clientCanSee,
  above,
  history,
  meta,
  guest,
}: {
  t: Todo;
  wsId: string;
  users: User[];
  me: string;
  clients: Client[];
  teams: Team[];
  onClose: () => void;
  onPatch: (id: string, p: Partial<Todo>) => void;
  onStatus: (id: string, s: TaskStatus) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (t: Todo) => void;
  onToCalendar: (t: Todo) => void;
  onComment: (id: string, text: string, toClient?: boolean) => void;
  clientCanSee: boolean;
  above: ReactNode; // the brief it's part of, guest visibility, the review banner
  history: ReactNode;
  meta: ReactNode;
  /** Phones: the guest side of a project's task (who can see it, the guest's approval) as a row and a "…" item. */
  guest?: { visible: boolean; toggle: () => void; approval?: Todo['approval']; ask: () => void };
}) {
  const phone = usePhone();
  const stages = stagesOf(task);
  const st = stageOf(task, stages);
  const today = localDay();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [opened, setOpened] = useState<string[]>([]); // empty fields someone just gave the task (notes, checklist)
  const [checkText, setCheckText] = useState('');
  const [comment, setComment] = useState('');
  const [toClient, setToClient] = useState(false);
  const [checkOpen, setCheckOpen] = useState(true); // phones: the checklist folds like Todoist's sub-tasks
  const [allActivity, setAllActivity] = useState(false); // phones: the last comment, or everything that happened
  const dots = useRef<HTMLButtonElement>(null);
  const checkInput = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setOpened([]), [task.id]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [task.title, task.id]);

  const menu = useActionMenu(
    () => [
      ...(!task.done ? [{ label: t('Add to calendar'), icon: CalendarPlus, run: () => onToCalendar(task) }] : []),
      ...(phone && guest && !task.done && guest.approval?.status !== 'waiting' ? [{ label: guest.approval ? t('Ask again') : t('Ask {who} to approve', { who: term.who }), icon: CheckCircle2, run: guest.ask }] : []),
      ...(onDuplicate ? [{ label: t('Duplicate'), icon: Copy, run: () => onDuplicate(task) }] : []),
      { label: t('Copy link'), icon: Link2, run: () => void copyTaskLink(wsId, task.id) },
      { label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => (onDelete(task.id), onClose()) },
    ],
    { title: task.title },
  );

  const doers = doersOf(task);
  const checklist = task.checklist ?? [];
  const reminder = task.remindAt && !task.reminded ? task.remindAt : '';
  const project = clients.find((c) => c.id === task.clientId);
  const team = teams.find((x) => x.id === task.teamId);
  const tone = task.due && !task.done ? dateTone(task.due, today) : null;
  const remindChoices = (() => {
    const at = (day: string, h: number) => {
      const d = dayDate(day);
      d.setHours(h, 0, 0, 0);
      return d.toISOString();
    };
    const list: [string, string][] = [
      [t('In 1 hour'), new Date(Date.now() + 3_600_000).toISOString()],
      [t('Tomorrow, {time}', { time: nine() }), at(addDays(today, 1), 9)],
      ...(task.due ? ([[t('The day before, {time}', { time: nine() }), at(addDays(task.due, -1), 9)], [t('On the day, {time}', { time: nine() }), at(task.due, 9)]] as [string, string][]) : []),
    ];
    return list.filter(([, v]) => v > new Date().toISOString());
  })();
  const remindOptions = [
    { value: '', label: tx('option', 'No reminder') },
    ...(reminder && !remindChoices.some(([, v]) => v === reminder) ? [{ value: reminder, label: remindText(reminder, today), icon: <Bell size={14} /> }] : []),
    ...remindChoices.map(([l, v]) => ({ value: v, label: l, hint: remindText(v, today), icon: <Bell size={14} /> })),
  ];
  const peopleOpts = [{ value: '', label: t('Nobody') }, ...users.map((u) => ({ value: u.id, label: u.id === me ? t('{name} (me)', { name: u.name }) : u.name }))];
  const teamOpts = [{ value: '', label: t('No team'), icon: <Dot color="var(--text-3)" /> }, ...teams.map((x) => ({ value: x.id, label: x.name, icon: <Dot color={x.color} /> }))];
  const projectOpts = [{ value: '', label: t('No {project}', { project: term.one }), icon: <Dot color="var(--text-3)" /> }, ...clients.filter((c) => c.status !== 'ended' || c.id === task.clientId).map((c) => ({ value: c.id, label: c.name, icon: <Dot color={c.color} /> }))];

  // Each field: shown as a row when it has a value (or was just added), as a chip when it doesn't.
  type Field = { id: string; label: string; icon: LucideIcon; filled: boolean; row: ReactNode; chip: ReactNode };
  const chipLook = (icon: LucideIcon, label: string) => {
    const I = icon;
    return (
      <span className="td-chip-in">
        <I size={15} />
        {label}
      </span>
    );
  };
  const fields: Field[] = [
    {
      id: 'who',
      label: tx('field', 'Doing it'),
      icon: UserRound,
      filled: doers.length > 0,
      row: <PeoplePicker value={doers} users={users} me={me} label={tx('field', 'Doing it')} emptyText={t('Waiting in the team queue')} onChange={(ids) => onPatch(task.id, { assignees: ids, userId: ids[0] ?? '' })} />,
      chip: (
        <span className="td-chip-people">
          <PeoplePicker value={doers} users={users} me={me} label={tx('field', 'Doing it')} emptyText={t('Assign')} onChange={(ids) => onPatch(task.id, { assignees: ids, userId: ids[0] ?? '' })} />
        </span>
      ),
    },
    {
      id: 'due',
      label: t('Due'),
      icon: CalendarDays,
      filled: !!task.due,
      row: (
        <span className={`td-due due-${tone ?? 'none'}`}>
          <DatePicker value={task.due ?? ''} onChange={(v) => onPatch(task.id, { due: v || undefined })} label={t('Due date')} placeholder={t('No date')} className="sel-flat" />
          {task.due && !task.done && tone !== 'overdue' && holidayOn(task.due) && <small className="hol-hint">{t('{holiday} is a public holiday', { holiday: holidayOn(task.due) ?? '' })}</small>}
        </span>
      ),
      chip: <DatePicker value="" onChange={(v) => onPatch(task.id, { due: v || undefined })} label={t('Due date')} placeholder={t('Due date')} className="td-chip" />,
    },
    {
      id: 'priority',
      label: t('Priority'),
      icon: Flag,
      filled: task.priority === 'high',
      row: (
        <Select<'normal' | 'high'>
          value={task.priority}
          onChange={(v) => onPatch(task.id, { priority: v })}
          label={t('Priority')}
          className="sel-flat td-prio"
          options={[
            { value: 'normal', label: t('Normal') },
            { value: 'high', label: t('High'), icon: <span className="st-dot st-high" /> },
          ]}
        />
      ),
      chip: (
        <button type="button" className="td-chip" onClick={() => onPatch(task.id, { priority: 'high' })}>
          {chipLook(Flag, t('High priority'))}
        </button>
      ),
    },
    {
      id: 'project',
      label: term.One,
      icon: Hash,
      filled: !!task.clientId,
      row: <ProjectPicker value={task.clientId ?? ''} projects={clients} none={t('No {project}', { project: term.one })} onChange={(v) => onPatch(task.id, { clientId: v || undefined })} className="sel-flat" />,
      chip: <Select value="" options={projectOpts} onChange={(v) => onPatch(task.id, { clientId: v || undefined })} label={term.One} className="td-chip" renderValue={() => chipLook(Hash, term.One)} />,
    },
    {
      id: 'team',
      label: t('Team'),
      icon: Users,
      filled: !!task.teamId,
      row: <Select value={task.teamId ?? ''} options={teamOpts} onChange={(v) => onPatch(task.id, { teamId: v || undefined })} label={t('Team')} className="sel-flat" />,
      chip: <Select value="" options={teamOpts} onChange={(v) => onPatch(task.id, { teamId: v || undefined })} label={t('Team')} className="td-chip" renderValue={() => chipLook(Users, t('Team'))} />,
    },
    {
      id: 'supervisor',
      label: t('Checks it'),
      icon: Eye,
      filled: !!task.supervisorId,
      row: <Select value={task.supervisorId ?? ''} options={peopleOpts} onChange={(v) => onPatch(task.id, { supervisorId: v || undefined })} label={t('Supervisor')} className="sel-flat" />,
      chip: <Select value="" options={peopleOpts.slice(1)} onChange={(v) => onPatch(task.id, { supervisorId: v || undefined })} label={t('Supervisor')} className="td-chip" renderValue={() => chipLook(Eye, t('Supervisor'))} />,
    },
    {
      id: 'followers',
      label: t('Followers'),
      icon: Users,
      filled: (task.followers ?? []).length > 0,
      row: <PeoplePicker value={task.followers ?? []} users={users} me={me} label={t('Followers')} emptyText={t('Nobody')} onChange={(ids) => onPatch(task.id, { followers: ids })} />,
      chip: (
        <span className="td-chip-people">
          <PeoplePicker value={[]} users={users} me={me} label={t('Followers')} emptyText={t('Followers')} onChange={(ids) => onPatch(task.id, { followers: ids })} />
        </span>
      ),
    },
    {
      id: 'repeat',
      label: t('Repeats'),
      icon: RepeatIcon,
      filled: !!task.repeat,
      row: (
        <span className="td-val-col">
          <Select<Repeat | ''> value={task.repeat ?? ''} options={repeats()} onChange={(v) => onPatch(task.id, { repeat: v || undefined, ...(v && !task.due ? { due: today } : {}) })} label={t('Repeats')} className="sel-flat" />
          <small className="muted">{t('When it’s done, the next one appears')}</small>
        </span>
      ),
      chip: <Select<Repeat | ''> value="" options={repeats().slice(1)} onChange={(v) => onPatch(task.id, { repeat: v || undefined, ...(v && !task.due ? { due: today } : {}) })} label={t('Repeats')} className="td-chip" renderValue={() => chipLook(RepeatIcon, t('Repeat'))} />,
    },
    {
      id: 'remind',
      label: t('Reminder'),
      icon: Bell,
      filled: !!reminder,
      row: <Select value={reminder} options={remindOptions} onChange={(v) => onPatch(task.id, { remindAt: v || undefined, reminded: false })} label={t('Reminder')} className="sel-flat" />,
      chip: <Select value="" options={remindOptions.slice(1)} onChange={(v) => onPatch(task.id, { remindAt: v || undefined, reminded: false })} label={t('Reminder')} className="td-chip" renderValue={() => chipLook(Bell, t('Reminder'))} />,
    },
    {
      id: 'notes',
      label: t('Notes'),
      icon: AlignLeft,
      filled: !!task.notes || opened.includes('notes'),
      row: null,
      chip: (
        <button type="button" className="td-chip" onClick={() => (setOpened((o) => [...o, 'notes']), requestAnimationFrame(() => notesRef.current?.focus()))}>
          {chipLook(AlignLeft, phone ? t('Description') : t('Notes'))}
        </button>
      ),
    },
    {
      id: 'checklist',
      label: tx('task', 'Checklist'),
      icon: ListChecks,
      filled: checklist.length > 0 || opened.includes('checklist'),
      row: null,
      chip: (
        <button type="button" className="td-chip" onClick={() => (setOpened((o) => [...o, 'checklist']), requestAnimationFrame(() => checkInput.current?.focus()))}>
          {chipLook(ListChecks, tx('task', 'Checklist'))}
        </button>
      ),
    },
  ];
  const rows = fields.filter((f) => f.filled && f.row);
  const chips = fields.filter((f) => !f.filled);

  const addCheck = () => {
    if (!checkText.trim()) return;
    onPatch(task.id, { checklist: [...checklist, { id: Math.random().toString(36).slice(2), text: checkText.trim(), done: false }] });
    setCheckText('');
  };

  // Who hears about a comment: everyone on the task but you.
  const told = [...new Set([...doers, task.supervisorId, ...(task.followers ?? [])].filter((x): x is string => !!x && x !== me))].map((id) => users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean) as string[];
  const toldText = !told.length ? t('Nobody else is on this task yet') : told.length === 1 ? t('{name} will be notified', { name: told[0] }) : tn(told.length - 1, '{name} and {n} other will be notified', '{name} and {n} others will be notified', { name: told[0] });
  const send = () => {
    if (!comment.trim()) return;
    onComment(task.id, comment.trim(), toClient);
    setComment('');
  };

  const crumbs = (
    <nav className="td-crumbs" aria-label={t('Where it is')}>
      <Select
        value={task.clientId ?? ''}
        options={projectOpts}
        onChange={(v) => onPatch(task.id, { clientId: v || undefined })}
        label={term.One}
        className="td-crumb"
        renderValue={() => (
          <>
            <span className="dot" style={{ background: project?.color ?? 'var(--text-3)' }} />
            <span className="td-crumb-text">{project?.name ?? (team ? team.name : t('No {project}', { project: term.one }))}</span>
          </>
        )}
      />
      <ChevronRight size={14} className="td-crumb-sep" aria-hidden="true" />
      <Select<TaskStatus>
        value={st.id}
        onChange={(v) => onStatus(task.id, v)}
        label={t('Stage')}
        className="td-crumb"
        options={stages.map((s) => ({ value: s.id, label: stageName(s), icon: <span className={`stage-dot k-${s.kind} tone-${toneOf(s)}`} /> }))}
        renderValue={() => (
          <>
            <span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />
            <span className="td-crumb-text">{stageName(st)}</span>
          </>
        )}
      />
    </nav>
  );
  const head = (
    <>
      <button ref={dots} type="button" className="icon-btn" aria-label={t('More')} onClick={() => menu.openFrom(dots)}>
        <MoreHorizontal size={18} />
      </button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
        <X size={18} />
      </button>
    </>
  );
  const body = (
    <div className="td">
      <div className="drawer-title-row td-title-row">
        <button type="button" className={`trow-check td-check${task.priority === 'high' ? ' p-high' : ''}${task.done ? ' on' : ''}`} onClick={() => onStatus(task.id, stageIdFor(task, task.done ? 'open' : 'done', stages))} aria-label={task.done ? t('Mark not done') : t('Mark done')}>
          <span className="ring">{task.done && <span>✓</span>}</span>
        </button>
        <textarea ref={titleRef} className="drawer-title" rows={1} value={task.title} onChange={(e) => onPatch(task.id, { title: e.target.value })} aria-label={t('Task title')} />
      </div>
      {above}
      {rows.length > 0 && (
        <div className="td-rows">
          {rows.map((f) => (
            <div key={f.id} className={`td-row td-f-${f.id}`}>
              <span className="td-label">
                <f.icon size={16} />
                {f.label}
              </span>
              <span className="td-val">{f.row}</span>
            </div>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <div className="td-chips" role="group" aria-label={t('Add to this task')}>
          {chips.map((f) => (
            <span key={f.id} className="td-chip-slot">
              {f.chip}
            </span>
          ))}
        </div>
      )}
      {(task.notes || opened.includes('notes')) && (
        <section className="td-sec">
          <h3 className="td-h">
            <AlignLeft size={15} /> {t('Notes')}
          </h3>
          <textarea ref={notesRef} className="drawer-notes" value={task.notes ?? ''} onChange={(e) => onPatch(task.id, { notes: e.target.value })} placeholder={t('Details, links, what done looks like…')} />
        </section>
      )}
      {(checklist.length > 0 || opened.includes('checklist')) && (
        <section className="td-sec">
          <h3 className="td-h">
            <ListChecks size={15} /> {tx('task', 'Checklist')}
            {checklist.length > 0 && (
              <span className="muted">
                {checklist.filter((c) => c.done).length}/{checklist.length}
              </span>
            )}
          </h3>
          <ul className="checklist">
            {checklist.map((c) => (
              <li key={c.id} className={c.done ? 'done' : ''}>
                <label>
                  <input type="checkbox" checked={c.done} onChange={() => onPatch(task.id, { checklist: checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                  <span>{c.text}</span>
                </label>
                <button className="icon-btn sm" aria-label={t('Remove {step}', { step: c.text })} onClick={() => onPatch(task.id, { checklist: checklist.filter((x) => x.id !== c.id) })}>
                  <X size={13} />
                </button>
              </li>
            ))}
            <li className="check-add">
              <Plus size={14} />
              <input ref={checkInput} value={checkText} onChange={(e) => setCheckText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCheck()} placeholder={t('Add a step…')} />
            </li>
          </ul>
        </section>
      )}
      <section className="td-sec">
        <h3 className="td-h">{t('Activity')}</h3>
        {history}
      </section>
      {meta}
    </div>
  );
  const foot = (
    <div className={`td-comment${toClient ? ' to-client' : ''}`}>
      <div className="td-c-row">
        <textarea
          rows={1}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), send())}
          placeholder={toClient ? t('Reply to the {who}…', { who: term.who }) : t('Add a comment…')}
          aria-label={t('Comment')}
        />
        <button type="button" className="primary-btn sm" disabled={!comment.trim()} onPointerDown={(e) => e.preventDefault()} onClick={send}>
          {toClient ? t('Send') : t('Comment')}
        </button>
      </div>
      <div className="td-c-foot">
        <small className="muted">{toClient ? t('The {who} and your team will see this', { who: term.who }) : toldText}</small>
        {clientCanSee && (
          <label className="cb-toggle">
            <input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} /> {t('{Who} can see this', { who: term.who })}
          </label>
        )}
      </div>
    </div>
  );

  /* ---------- Phones: Todoist's task view. Set fields as icon-and-value rows, the rest as one sideways row of chips,
     the checklist as sub-tasks, the last comment, and the comment field pinned at the bottom. ---------- */
  const order = ['notes', 'due', 'who', 'supervisor', 'priority', 'repeat', 'remind', 'team', 'followers', 'checklist'];
  const pFields = fields.filter((f) => f.id !== 'project').sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const pRows = pFields.filter((f) => f.filled && (f.row || f.id === 'notes'));
  const pChips = pFields.filter((f) => !f.filled);
  const comments = (task.history ?? []).filter((h) => h.kind === 'comment');
  const lastComment = comments.at(-1);
  const lastBy = lastComment ? users.find((u) => u.id === lastComment.by) : undefined;
  const items = useLeaving(checklist, (c) => c.id);
  const doneN = checklist.filter((c) => c.done).length;
  const setList = (list: typeof checklist) => onPatch(task.id, { checklist: list });
  const ap = guest?.approval;
  const pBody = (
    <div className="td tdp">
      <div className="td-title-row tdp-title">
        <button type="button" className={`trow-check td-check${task.priority === 'high' ? ' p-high' : ''}${task.done ? ' on' : ''}`} onClick={() => onStatus(task.id, stageIdFor(task, task.done ? 'open' : 'done', stages))} aria-label={task.done ? t('Mark not done') : t('Mark done')}>
          <span className="ring">{task.done && <Check size={14} strokeWidth={3} />}</span>
        </button>
        <textarea ref={titleRef} className="drawer-title" rows={1} value={task.title} onChange={(e) => onPatch(task.id, { title: e.target.value })} aria-label={t('Task title')} />
      </div>
      {above}
      {(pRows.length > 0 || guest) && (
        <div className="tdp-rows">
          {pRows.map((f) => (
            <div key={f.id} className={`tdp-row td-f-${f.id}`} role="group" aria-label={f.label}>
              <f.icon size={20} className="tdp-icon" aria-hidden="true" />
              <span className="tdp-val">
                {f.id === 'notes' ? <textarea ref={notesRef} className="tdp-desc" rows={1} value={task.notes ?? ''} onChange={(e) => onPatch(task.id, { notes: e.target.value })} placeholder={t('Description')} aria-label={t('Description')} /> : f.row}
              </span>
            </div>
          ))}
          {guest && (
            <div className={`tdp-row tdp-guest${guest.visible ? ' on' : ''}`}>
              {guest.visible ? <Eye size={20} className="tdp-icon" aria-hidden="true" /> : <EyeOff size={20} className="tdp-icon" aria-hidden="true" />}
              <button type="button" className="tdp-btn" role="switch" aria-checked={guest.visible} onClick={guest.toggle}>
                {guest.visible ? t('Visible to {whos}', { whos: term.whos }) : t('Internal only')}
                <span className={`switch ${guest.visible ? 'on' : ''}`} aria-hidden="true">
                  <span />
                </span>
              </button>
            </div>
          )}
          {ap && (
            <div className={`tdp-row tdp-ap ${ap.status}`}>
              {ap.status === 'waiting' ? <Clock size={20} className="tdp-icon" aria-hidden="true" /> : ap.status === 'approved' ? <CheckCircle2 size={20} className="tdp-icon" aria-hidden="true" /> : <RotateCcw size={20} className="tdp-icon" aria-hidden="true" />}
              <span className="tdp-val">{ap.status === 'waiting' ? t('Waiting for {who} approval', { who: term.who }) : ap.status === 'approved' ? (ap.at ? t('Approved {when}', { when: relative(ap.at) }) : t('Approved')) : t('Changes asked: “{note}”', { note: ap.note ?? '' })}</span>
            </div>
          )}
        </div>
      )}
      {pChips.length > 0 && (
        <div className="tdp-chips" role="group" aria-label={t('Add to this task')}>
          {pChips.map((f) => (
            <span key={f.id} className="td-chip-slot">
              {f.chip}
            </span>
          ))}
        </div>
      )}
      {(checklist.length > 0 || opened.includes('checklist')) && (
        <section className="tdp-sec">
          <button type="button" className="tdp-head" onClick={() => setCheckOpen((o) => !o)} aria-expanded={checkOpen}>
            <span>{tx('task', 'Checklist')}</span>
            {checklist.length > 0 && (
              <span className="tdp-count">
                <Pie part={doneN / checklist.length} />
                {doneN}/{checklist.length}
              </span>
            )}
            <ChevronRight size={18} className={`rot-chev tdp-chev ${checkOpen ? 'open' : ''}`} />
          </button>
          <div className={`fold ${checkOpen ? 'open' : ''}`}>
            <div className="fold-in">
              {items.map(({ item: c, leaving }) => (
                <CheckItem
                  key={c.id}
                  item={c}
                  leaving={leaving}
                  onToggle={() => setList(checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))}
                  onRename={(text) => setList(checklist.map((x) => (x.id === c.id ? { ...x, text } : x)))}
                  onDelete={() => {
                    const before = checklist;
                    setList(checklist.filter((x) => x.id !== c.id));
                    return () => setList(before);
                  }}
                />
              ))}
              <label className="tdp-add">
                <Plus size={20} aria-hidden="true" />
                <input ref={checkInput} value={checkText} onChange={(e) => setCheckText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCheck()} onBlur={addCheck} placeholder={t('Add item')} enterKeyHint="done" />
              </label>
            </div>
          </div>
        </section>
      )}
      <section className="tdp-sec">
        <button type="button" className="tdp-head" onClick={() => setAllActivity((o) => !o)} aria-expanded={allActivity}>
          <span>{t('Comments')}</span>
          {comments.length > 0 && <span className="tdp-count">{comments.length}</span>}
          <ChevronRight size={18} className={`rot-chev tdp-chev ${allActivity ? 'open' : ''}`} />
        </button>
        {!allActivity &&
          (lastComment ? (
            <div className="tdp-last">
              {lastBy ? <Avatar person={lastBy} size={24} /> : <span className="avatar-empty sm">{lastComment.by.charAt(0).toUpperCase()}</span>}
              <span className="tdp-last-text">
                <b>{lastBy ? (lastBy.id === me ? t('You') : lastBy.name.split(' ')[0]) : (lastComment.byName ?? lastComment.by)}</b>
                <span>{lastComment.text}</span>
              </span>
            </div>
          ) : (
            <p className="tdp-none">{t('No comments yet')}</p>
          ))}
        <div className={`fold ${allActivity ? 'open' : ''}`}>
          <div className="fold-in">{allActivity && history}</div>
        </div>
        <button type="button" className="link-btn tdp-all" onClick={() => setAllActivity((o) => !o)}>
          {allActivity ? t('Show less') : t('Show all activity')}
        </button>
      </section>
      {meta}
    </div>
  );
  const pFoot = (
    <div className={`tdp-comment${toClient ? ' to-client' : ''}`}>
      <div className="tdp-field">
        <textarea
          rows={1}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), send())}
          placeholder={toClient ? t('Reply to the {who}…', { who: term.who }) : t('Comment')}
          aria-label={t('Comment')}
        />
        <button type="button" className={`tdp-send${comment.trim() ? ' on' : ''}`} disabled={!comment.trim()} onPointerDown={(e) => e.preventDefault()} onClick={send} aria-label={toClient ? t('Send') : t('Comment')}>
          <ArrowUp size={18} strokeWidth={2.5} />
        </button>
      </div>
      {(told.length > 0 || clientCanSee) && (
        <div className="td-c-foot">
          <small className="muted">{toClient ? t('The {who} and your team will see this', { who: term.who }) : told.length ? toldText : ''}</small>
          {clientCanSee && (
            <label className="cb-toggle">
              <input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} /> {t('{Who} can see this', { who: term.who })}
            </label>
          )}
        </div>
      )}
    </div>
  );

  if (phone)
    return (
      <>
        <Sheet onClose={onClose} size="tall" className="td-sheet tdp-sheet" label={t('Task')} title={crumbs} head={head} footer={pFoot}>
          {pBody}
        </Sheet>
        {menu.menu}
      </>
    );
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer td-drawer" role="dialog" aria-label={t('Task')}>
        <header className="drawer-head">
          {crumbs}
          {head}
        </header>
        <div className="drawer-body">{body}</div>
        <footer className="drawer-foot">{foot}</footer>
      </aside>
      {menu.menu}
    </div>
  );
}

/** The task's own stages: its project's or team's, else the company's. */
const stagesOf = (task: Todo) => stagesForTask(task);

/** A small progress pie (Todoist's sub-tasks count). */
function Pie({ part }: { part: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="tdp-pie">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r={r / 2} fill="none" stroke="currentColor" strokeWidth={r} strokeDasharray={`${(part * Math.PI * r).toFixed(2)} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

/** One checklist item on a phone: a ring to tick it, swipe left to delete, hold for Rename and Delete. */
function CheckItem({ item, leaving, onToggle, onRename, onDelete }: { item: { id: string; text: string; done: boolean }; leaving: boolean; onToggle: () => void; onRename: (text: string) => void; onDelete: () => () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.text]);
  const m = useActionMenu(
    () => [
      { label: t('Rename'), icon: Pencil, run: () => setEditing(true) },
      { label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => void onDelete() },
    ],
    { title: item.text },
  );
  const commit = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== item.text) onRename(text.trim());
    else setText(item.text);
  };
  return (
    <SwipeRow leaving={leaving} className="tdp-citem-swipe" end={[{ id: 'delete', label: t('Delete'), icon: Trash2, tone: 'danger', removes: true, done: t('Deleted'), run: onDelete }]}>
      <div className={`tdp-citem lp${item.done ? ' done' : ''}`} {...m.bind}>
        <button type="button" className={`trow-check${item.done ? ' on' : ''}`} onClick={onToggle} aria-label={item.done ? t('Mark not done') : t('Mark “{title}” done', { title: item.text })}>
          <span className="ring">{item.done && <Check size={12} strokeWidth={3} />}</span>
        </button>
        {editing ? (
          <input autoFocus className="tdp-ctext" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => (e.key === 'Enter' ? commit() : e.key === 'Escape' && (setText(item.text), setEditing(false)))} aria-label={t('Rename')} enterKeyHint="done" />
        ) : (
          <span className="tdp-ctext">{item.text}</span>
        )}
      </div>
      {m.menu}
    </SwipeRow>
  );
}
