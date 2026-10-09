import { useRef, type ReactNode } from 'react';
import { Check, CheckCircle2, Inbox, MessageSquare, MoreHorizontal, Repeat as RepeatIcon, FileText } from 'lucide-react';
import { SwipeRow, type SwipeAction } from '../ui/SwipeRow';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { PeoplePicker } from '../ui/PeoplePicker';
import { dateTone, dueText } from '../../taskDates';
import { firstOf, stageBadge, stageOf, stagesForTask, toneOf } from '../../stages';
import { holidayOn } from '../../holidayDays';
import { relative } from '../../utils';
import type { Todo } from '../../types';
import { Doer } from './TaskSheets';
import { doersOf, type TaskOps } from './taskOps';
import { t, tx } from '../../i18n';

export interface RowLook {
  show: (field: string) => boolean; // what this person chose rows show (Display, "On each row")
  project: boolean; // the project's name (cross-project views)
  team: boolean;
  stage: boolean; // the stage, unless the list is grouped by it
  avatar: boolean; // whose it is (team views; always on desktop as a picker)
  dueWords?: boolean; // false under a Today or Tomorrow heading, which already says it
}

/**
 * One task in a list, three lines at most: a ring to tick it (red for high priority), the title, and one line of what
 * matters (the due date in its colour, repeat, checklist, comments, stage, project). Swipe it on a phone; hold it, or
 * right-click it, for everything else. While selecting, a tap picks it instead.
 */
export function TaskRow({
  task,
  ops,
  look,
  selecting,
  selected,
  onSelect,
  ticking,
  onTick,
  leaving,
  start,
  end,
  menu,
  act,
  note,
}: {
  task: Todo;
  ops: TaskOps;
  look: RowLook;
  selecting: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  ticking: boolean;
  onTick: (task: Todo) => void;
  leaving?: boolean;
  start?: SwipeAction[];
  end?: SwipeAction[];
  menu: () => SheetAction[];
  act?: ReactNode;
  note?: string;
}) {
  const st = stageOf(task); // its own stages (its project's or team's, when they have their own)
  const m = useActionMenu(menu, { title: task.title });
  const dots = useRef<HTMLButtonElement>(null);
  const done = task.done || ticking;
  const tone = task.due && !task.done ? dateTone(task.due, ops.today) : null;
  const c = look.project ? ops.clients.find((x) => x.id === task.clientId) : undefined;
  const tm = look.team ? ops.teams.find((x) => x.id === task.teamId) : undefined;
  const comments = look.show('comments') ? (task.history ?? []).filter((h) => h.kind === 'comment').length : 0;
  const cl = task.checklist ?? [];
  const brief = look.show('brief') && task.briefId ? ops.tasks.find((x) => x.id === task.briefId) : undefined;
  const showStage = look.stage && !task.done && st.kind !== 'done' && st !== firstOf('open', stagesForTask(task));
  const hol = task.due && !task.done && tone !== 'overdue' ? holidayOn(task.due) : '';
  const last = task.history?.at(-1)?.at ?? task.createdAt;
  return (
    <SwipeRow start={selecting ? [] : start} end={selecting ? [] : end} leaving={leaving} className="trow-swipe">
      <div
        className={`trow lp${done ? ' done' : ''}${ticking ? ' ticking' : ''}${selecting ? ' selecting' : ''}${selected ? ' selected' : ''}${task.priority === 'high' && look.show('priority') ? ' high' : ''}`}
        {...m.bind}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a, input, .sel, .people-btn')) return;
          if (selecting || e.metaKey || e.ctrlKey) return onSelect(task.id);
          ops.open(task.id);
        }}
        aria-selected={selecting ? selected : undefined}
      >
        <button
          type="button"
          className={`trow-check${task.priority === 'high' && look.show('priority') ? ' p-high' : ''}${done ? ' on' : ''}`}
          onClick={(e) => (e.stopPropagation(), selecting ? onSelect(task.id) : onTick(task))}
          aria-label={selecting ? (selected ? t('Unselect') : t('Select')) : task.done ? t('Mark not done') : t('Mark “{title}” done', { title: task.title })}
        >
          <span className="ring">{(selecting ? selected : done) && <Check size={13} strokeWidth={3} />}</span>
        </button>
        <div className="trow-main">
          <button type="button" className="trow-title" onClick={() => (selecting ? onSelect(task.id) : ops.open(task.id))} tabIndex={selecting ? -1 : 0}>
            {task.title}
          </button>
          <div className="trow-meta">
            {task.source === 'request' && (
              <span className="tm req" title={t('Request from {who}', { who: task.requestedBy ?? '' })}>
                <Inbox size={12} /> {t('Request')}
              </span>
            )}
            {look.show('due') && task.due && !task.done && (look.dueWords !== false || task.repeat) && (
              <span className={`tm due-${tone}`}>
                {task.repeat && <RepeatIcon size={12} aria-label={t('Repeats')} />}
                {look.dueWords !== false && dueText(task.due, ops.today)}
              </span>
            )}
            {look.show('due') && !task.due && task.repeat && !task.done && (
              <span className="tm">
                <RepeatIcon size={12} /> {t('Repeats')}
              </span>
            )}
            {hol && <span className="tm hol" title={t('Public holiday: {name}', { name: hol })}>{t('Holiday')}</span>}
            {task.done && task.doneAt && <span className="tm">{t('Done {when}', { when: relative(task.doneAt) })}</span>}
            {showStage && (
              <span className={`tm stage tone-${toneOf(st)}`}>
                <span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />
                {stageBadge(st)}
              </span>
            )}
            {look.show('checklist') && cl.length > 0 && (
              <span className={`tm${cl.every((x) => x.done) ? ' ok' : ''}`} title={tx('task', 'Checklist')}>
                <CheckCircle2 size={12} /> {cl.filter((x) => x.done).length}/{cl.length}
              </span>
            )}
            {comments > 0 && (
              <span className="tm" title={t('Comments')}>
                <MessageSquare size={12} /> {comments}
              </span>
            )}
            {brief && (
              <span className="tm brief" title={t('Part of a brief')}>
                <FileText size={12} /> {brief.title}
              </span>
            )}
            {look.show('updated') && <span className="tm muted">{relative(last)}</span>}
            {note && <span className="tm note">{note}</span>}
            {tm && look.show('team') && (
              <span className="tm team" style={{ ['--c' as string]: tm.color }}>
                {tm.name}
              </span>
            )}
            {c && look.show('project') && (
              <span className="tm proj" style={{ ['--c' as string]: c.color }}>
                <i />
                {c.name}
              </span>
            )}
          </div>
        </div>
        {act && <span className="trow-act">{act}</span>}
        {look.avatar && doersOf(task).length > 0 && (
          <span className="trow-who phone-only">
            <Doer task={task} ops={ops} size={24} />
          </span>
        )}
        {look.show('assignee') && (
          <span className="trow-pick hide-phone">
            <PeoplePicker compact value={doersOf(task)} users={ops.users} me={ops.me} label={tx('field', 'Doing it')} onChange={(ids) => ops.patch(task.id, { assignees: ids, userId: ids[0] ?? '' })} />
          </span>
        )}
        <button type="button" ref={dots} className="icon-btn sm trow-more hide-phone" aria-label={t('More for “{title}”', { title: task.title })} onClick={(e) => (e.stopPropagation(), m.openFrom(dots))}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      {m.menu}
    </SwipeRow>
  );
}
