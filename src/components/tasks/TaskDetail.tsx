import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlignLeft, Bell, CalendarDays, CalendarPlus, ChevronRight, Copy, Eye, Flag, Hash, Link2, ListChecks, MoreHorizontal, Plus, Repeat as RepeatIcon, Trash2, UserRound, Users, X, type LucideIcon } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
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
import { localDay } from '../../utils';
import type { Client, Repeat, TaskStatus, Team, Todo, User } from '../../types';
import { copyTaskLink, doersOf } from './taskOps';

const REPEATS: { value: Repeat | ''; label: string }[] = [
  { value: '', label: 'Doesn’t repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

/**
 * A task, opened: its project and stage on top, then the fields it has as rows and the ones it doesn't as a row of
 * chips (tap a chip to give the task that field). A new task stays short; a busy one stays readable. The comment bar
 * is pinned to the bottom and says who will hear about it. A side panel on a computer, a sheet on a phone.
 */
export function TaskDetail({
  t,
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
}) {
  const phone = usePhone();
  const stages = stagesOf(t);
  const st = stageOf(t, stages);
  const today = localDay();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [opened, setOpened] = useState<string[]>([]); // empty fields someone just gave the task (notes, checklist)
  const [checkText, setCheckText] = useState('');
  const [comment, setComment] = useState('');
  const [toClient, setToClient] = useState(false);
  const dots = useRef<HTMLButtonElement>(null);
  const checkInput = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setOpened([]), [t.id]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [t.title, t.id]);

  const menu = useActionMenu(
    () => [
      ...(!t.done ? [{ label: 'Add to calendar', icon: CalendarPlus, run: () => onToCalendar(t) }] : []),
      ...(onDuplicate ? [{ label: 'Duplicate', icon: Copy, run: () => onDuplicate(t) }] : []),
      { label: 'Copy link', icon: Link2, run: () => void copyTaskLink(wsId, t.id) },
      { label: 'Delete', icon: Trash2, danger: true, group: 'end', run: () => (onDelete(t.id), onClose()) },
    ],
    { title: t.title },
  );

  const doers = doersOf(t);
  const checklist = t.checklist ?? [];
  const reminder = t.remindAt && !t.reminded ? t.remindAt : '';
  const project = clients.find((c) => c.id === t.clientId);
  const team = teams.find((x) => x.id === t.teamId);
  const tone = t.due && !t.done ? dateTone(t.due, today) : null;
  const remindChoices = (() => {
    const at = (day: string, h: number) => {
      const d = dayDate(day);
      d.setHours(h, 0, 0, 0);
      return d.toISOString();
    };
    const list: [string, string][] = [
      ['In 1 hour', new Date(Date.now() + 3_600_000).toISOString()],
      ['Tomorrow, 09:00', at(addDays(today, 1), 9)],
      ...(t.due ? ([['The day before, 09:00', at(addDays(t.due, -1), 9)], ['On the day, 09:00', at(t.due, 9)]] as [string, string][]) : []),
    ];
    return list.filter(([, v]) => v > new Date().toISOString());
  })();
  const remindOptions = [
    { value: '', label: 'No reminder' },
    ...(reminder && !remindChoices.some(([, v]) => v === reminder) ? [{ value: reminder, label: remindText(reminder, today), icon: <Bell size={14} /> }] : []),
    ...remindChoices.map(([l, v]) => ({ value: v, label: l, hint: remindText(v, today), icon: <Bell size={14} /> })),
  ];
  const peopleOpts = [{ value: '', label: 'Nobody' }, ...users.map((u) => ({ value: u.id, label: u.id === me ? `${u.name} (me)` : u.name }))];
  const teamOpts = [{ value: '', label: 'No team', icon: <Dot color="var(--text-3)" /> }, ...teams.map((x) => ({ value: x.id, label: x.name, icon: <Dot color={x.color} /> }))];
  const projectOpts = [{ value: '', label: `No ${term.one}`, icon: <Dot color="var(--text-3)" /> }, ...clients.filter((c) => c.status !== 'ended' || c.id === t.clientId).map((c) => ({ value: c.id, label: c.name, icon: <Dot color={c.color} /> }))];

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
      label: 'Doing it',
      icon: UserRound,
      filled: doers.length > 0,
      row: <PeoplePicker value={doers} users={users} me={me} label="Doing it" emptyText="Waiting in the team queue" onChange={(ids) => onPatch(t.id, { assignees: ids, userId: ids[0] ?? '' })} />,
      chip: (
        <span className="td-chip-people">
          <PeoplePicker value={doers} users={users} me={me} label="Doing it" emptyText="Assign" onChange={(ids) => onPatch(t.id, { assignees: ids, userId: ids[0] ?? '' })} />
        </span>
      ),
    },
    {
      id: 'due',
      label: 'Due',
      icon: CalendarDays,
      filled: !!t.due,
      row: (
        <span className={`td-due due-${tone ?? 'none'}`}>
          <DatePicker value={t.due ?? ''} onChange={(v) => onPatch(t.id, { due: v || undefined })} label="Due date" placeholder="No date" className="sel-flat" />
          {t.due && !t.done && tone !== 'overdue' && holidayOn(t.due) && <small className="hol-hint">{holidayOn(t.due)} is a public holiday</small>}
        </span>
      ),
      chip: <DatePicker value="" onChange={(v) => onPatch(t.id, { due: v || undefined })} label="Due date" placeholder="Due date" className="td-chip" />,
    },
    {
      id: 'priority',
      label: 'Priority',
      icon: Flag,
      filled: t.priority === 'high',
      row: (
        <Select<'normal' | 'high'>
          value={t.priority}
          onChange={(v) => onPatch(t.id, { priority: v })}
          label="Priority"
          className="sel-flat td-prio"
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High', icon: <span className="st-dot st-high" /> },
          ]}
        />
      ),
      chip: (
        <button type="button" className="td-chip" onClick={() => onPatch(t.id, { priority: 'high' })}>
          {chipLook(Flag, 'High priority')}
        </button>
      ),
    },
    {
      id: 'project',
      label: term.One,
      icon: Hash,
      filled: !!t.clientId,
      row: <ProjectPicker value={t.clientId ?? ''} projects={clients} none={`No ${term.one}`} onChange={(v) => onPatch(t.id, { clientId: v || undefined })} className="sel-flat" />,
      chip: <Select value="" options={projectOpts} onChange={(v) => onPatch(t.id, { clientId: v || undefined })} label={term.One} className="td-chip" renderValue={() => chipLook(Hash, term.One)} />,
    },
    {
      id: 'team',
      label: 'Team',
      icon: Users,
      filled: !!t.teamId,
      row: <Select value={t.teamId ?? ''} options={teamOpts} onChange={(v) => onPatch(t.id, { teamId: v || undefined })} label="Team" className="sel-flat" />,
      chip: <Select value="" options={teamOpts} onChange={(v) => onPatch(t.id, { teamId: v || undefined })} label="Team" className="td-chip" renderValue={() => chipLook(Users, 'Team')} />,
    },
    {
      id: 'supervisor',
      label: 'Checks it',
      icon: Eye,
      filled: !!t.supervisorId,
      row: <Select value={t.supervisorId ?? ''} options={peopleOpts} onChange={(v) => onPatch(t.id, { supervisorId: v || undefined })} label="Supervisor" className="sel-flat" />,
      chip: <Select value="" options={peopleOpts.slice(1)} onChange={(v) => onPatch(t.id, { supervisorId: v || undefined })} label="Supervisor" className="td-chip" renderValue={() => chipLook(Eye, 'Supervisor')} />,
    },
    {
      id: 'followers',
      label: 'Followers',
      icon: Users,
      filled: (t.followers ?? []).length > 0,
      row: <PeoplePicker value={t.followers ?? []} users={users} me={me} label="Followers" emptyText="Nobody" onChange={(ids) => onPatch(t.id, { followers: ids })} />,
      chip: (
        <span className="td-chip-people">
          <PeoplePicker value={[]} users={users} me={me} label="Followers" emptyText="Followers" onChange={(ids) => onPatch(t.id, { followers: ids })} />
        </span>
      ),
    },
    {
      id: 'repeat',
      label: 'Repeats',
      icon: RepeatIcon,
      filled: !!t.repeat,
      row: (
        <span className="td-val-col">
          <Select<Repeat | ''> value={t.repeat ?? ''} options={REPEATS} onChange={(v) => onPatch(t.id, { repeat: v || undefined, ...(v && !t.due ? { due: today } : {}) })} label="Repeats" className="sel-flat" />
          <small className="muted">When it’s done, the next one appears</small>
        </span>
      ),
      chip: <Select<Repeat | ''> value="" options={REPEATS.slice(1)} onChange={(v) => onPatch(t.id, { repeat: v || undefined, ...(v && !t.due ? { due: today } : {}) })} label="Repeats" className="td-chip" renderValue={() => chipLook(RepeatIcon, 'Repeat')} />,
    },
    {
      id: 'remind',
      label: 'Reminder',
      icon: Bell,
      filled: !!reminder,
      row: <Select value={reminder} options={remindOptions} onChange={(v) => onPatch(t.id, { remindAt: v || undefined, reminded: false })} label="Reminder" className="sel-flat" />,
      chip: <Select value="" options={remindOptions.slice(1)} onChange={(v) => onPatch(t.id, { remindAt: v || undefined, reminded: false })} label="Reminder" className="td-chip" renderValue={() => chipLook(Bell, 'Reminder')} />,
    },
    {
      id: 'notes',
      label: 'Notes',
      icon: AlignLeft,
      filled: !!t.notes || opened.includes('notes'),
      row: null,
      chip: (
        <button type="button" className="td-chip" onClick={() => (setOpened((o) => [...o, 'notes']), requestAnimationFrame(() => notesRef.current?.focus()))}>
          {chipLook(AlignLeft, 'Notes')}
        </button>
      ),
    },
    {
      id: 'checklist',
      label: 'Checklist',
      icon: ListChecks,
      filled: checklist.length > 0 || opened.includes('checklist'),
      row: null,
      chip: (
        <button type="button" className="td-chip" onClick={() => (setOpened((o) => [...o, 'checklist']), requestAnimationFrame(() => checkInput.current?.focus()))}>
          {chipLook(ListChecks, 'Checklist')}
        </button>
      ),
    },
  ];
  const rows = fields.filter((f) => f.filled && f.row);
  const chips = fields.filter((f) => !f.filled);

  const addCheck = () => {
    if (!checkText.trim()) return;
    onPatch(t.id, { checklist: [...checklist, { id: Math.random().toString(36).slice(2), text: checkText.trim(), done: false }] });
    setCheckText('');
  };

  // Who hears about a comment: everyone on the task but you.
  const told = [...new Set([...doers, t.supervisorId, ...(t.followers ?? [])].filter((x): x is string => !!x && x !== me))].map((id) => users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean) as string[];
  const toldText = told.length ? `${told[0]}${told.length > 1 ? ` and ${told.length - 1} other${told.length > 2 ? 's' : ''}` : ''} will be notified` : 'Nobody else is on this task yet';
  const send = () => {
    if (!comment.trim()) return;
    onComment(t.id, comment.trim(), toClient);
    setComment('');
  };

  const crumbs = (
    <nav className="td-crumbs" aria-label="Where it is">
      <Select
        value={t.clientId ?? ''}
        options={projectOpts}
        onChange={(v) => onPatch(t.id, { clientId: v || undefined })}
        label={term.One}
        className="td-crumb"
        renderValue={() => (
          <>
            <span className="dot" style={{ background: project?.color ?? 'var(--text-3)' }} />
            <span className="td-crumb-text">{project?.name ?? (team ? team.name : 'No project')}</span>
          </>
        )}
      />
      <ChevronRight size={14} className="td-crumb-sep" aria-hidden="true" />
      <Select<TaskStatus>
        value={st.id}
        onChange={(v) => onStatus(t.id, v)}
        label="Stage"
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
      <button ref={dots} type="button" className="icon-btn" aria-label="More" onClick={() => menu.openFrom(dots)}>
        <MoreHorizontal size={18} />
      </button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
    </>
  );
  const body = (
    <div className="td">
      <div className="drawer-title-row td-title-row">
        <button type="button" className={`trow-check td-check${t.priority === 'high' ? ' p-high' : ''}${t.done ? ' on' : ''}`} onClick={() => onStatus(t.id, stageIdFor(t, t.done ? 'open' : 'done', stages))} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
          <span className="ring">{t.done && <span>✓</span>}</span>
        </button>
        <textarea ref={titleRef} className="drawer-title" rows={1} value={t.title} onChange={(e) => onPatch(t.id, { title: e.target.value })} aria-label="Title" />
      </div>
      {above}
      {rows.length > 0 && (
        <div className="td-rows">
          {rows.map((f) => (
            <div key={f.id} className={`td-row td-${f.id}`}>
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
        <div className="td-chips" role="group" aria-label="Add to this task">
          {chips.map((f) => (
            <span key={f.id} className="td-chip-slot">
              {f.chip}
            </span>
          ))}
        </div>
      )}
      {(t.notes || opened.includes('notes')) && (
        <section className="td-sec">
          <h3 className="td-h">
            <AlignLeft size={15} /> Notes
          </h3>
          <textarea ref={notesRef} className="drawer-notes" value={t.notes ?? ''} onChange={(e) => onPatch(t.id, { notes: e.target.value })} placeholder="Details, links, what done looks like…" />
        </section>
      )}
      {(checklist.length > 0 || opened.includes('checklist')) && (
        <section className="td-sec">
          <h3 className="td-h">
            <ListChecks size={15} /> Checklist
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
                  <input type="checkbox" checked={c.done} onChange={() => onPatch(t.id, { checklist: checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                  <span>{c.text}</span>
                </label>
                <button className="icon-btn sm" aria-label={`Remove ${c.text}`} onClick={() => onPatch(t.id, { checklist: checklist.filter((x) => x.id !== c.id) })}>
                  <X size={13} />
                </button>
              </li>
            ))}
            <li className="check-add">
              <Plus size={14} />
              <input ref={checkInput} value={checkText} onChange={(e) => setCheckText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCheck()} placeholder="Add a step…" />
            </li>
          </ul>
        </section>
      )}
      <section className="td-sec">
        <h3 className="td-h">Activity</h3>
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
          placeholder={toClient ? `Reply to the ${term.who}…` : 'Add a comment…'}
          aria-label="Comment"
        />
        <button type="button" className="primary-btn sm" disabled={!comment.trim()} onPointerDown={(e) => e.preventDefault()} onClick={send}>
          {toClient ? 'Send' : 'Comment'}
        </button>
      </div>
      <div className="td-c-foot">
        <small className="muted">{toClient ? `The ${term.who} and your team will see this` : toldText}</small>
        {clientCanSee && (
          <label className="cb-toggle">
            <input type="checkbox" checked={toClient} onChange={(e) => setToClient(e.target.checked)} /> {term.Who} can see this
          </label>
        )}
      </div>
    </div>
  );

  if (phone)
    return (
      <>
        <Sheet onClose={onClose} size="full" className="td-sheet" label="Task" title={crumbs} head={head} footer={foot}>
          {body}
        </Sheet>
        {menu.menu}
      </>
    );
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer td-drawer" role="dialog" aria-label="Task">
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
const stagesOf = (t: Todo) => stagesForTask(t);
