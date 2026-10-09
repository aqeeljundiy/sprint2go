import { useRef, type ReactNode } from 'react';
import { Check, CheckCircle2, Inbox, MessageSquare, MoreHorizontal, Repeat as RepeatIcon, FileText } from 'lucide-react';
import { SwipeRow, type SwipeAction } from '../ui/SwipeRow';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { PeoplePicker } from '../ui/PeoplePicker';
import { dateTone, dueText } from '../../taskDates';
import { firstOf, stageBadge, stageOf, toneOf } from '../../stages';
import { holidayOn } from '../../holidayDays';
import { relative } from '../../utils';
import type { Todo } from '../../types';
import { Doer } from './TaskSheets';
import { doersOf, type TaskOps } from './taskOps';

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
  t,
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
  t: Todo;
  ops: TaskOps;
  look: RowLook;
  selecting: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  ticking: boolean;
  onTick: (t: Todo) => void;
  leaving?: boolean;
  start?: SwipeAction[];
  end?: SwipeAction[];
  menu: () => SheetAction[];
  act?: ReactNode;
  note?: string;
}) {
  const st = stageOf(t, ops.stages);
  const m = useActionMenu(menu, { title: t.title });
  const dots = useRef<HTMLButtonElement>(null);
  const done = t.done || ticking;
  const tone = t.due && !t.done ? dateTone(t.due, ops.today) : null;
  const c = look.project ? ops.clients.find((x) => x.id === t.clientId) : undefined;
  const tm = look.team ? ops.teams.find((x) => x.id === t.teamId) : undefined;
  const comments = look.show('comments') ? (t.history ?? []).filter((h) => h.kind === 'comment').length : 0;
  const cl = t.checklist ?? [];
  const brief = look.show('brief') && t.briefId ? ops.tasks.find((x) => x.id === t.briefId) : undefined;
  const showStage = look.stage && !t.done && st.kind !== 'done' && st !== firstOf('open', ops.stages);
  const hol = t.due && !t.done && tone !== 'overdue' ? holidayOn(t.due) : '';
  const last = t.history?.at(-1)?.at ?? t.createdAt;
  return (
    <SwipeRow start={selecting ? [] : start} end={selecting ? [] : end} leaving={leaving} className="trow-swipe">
      <div
        className={`trow lp${done ? ' done' : ''}${ticking ? ' ticking' : ''}${selecting ? ' selecting' : ''}${selected ? ' selected' : ''}${t.priority === 'high' && look.show('priority') ? ' high' : ''}`}
        {...m.bind}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a, input, .sel, .people-btn')) return;
          if (selecting || e.metaKey || e.ctrlKey) return onSelect(t.id);
          ops.open(t.id);
        }}
        aria-selected={selecting ? selected : undefined}
      >
        <button
          type="button"
          className={`trow-check${t.priority === 'high' && look.show('priority') ? ' p-high' : ''}${done ? ' on' : ''}`}
          onClick={(e) => (e.stopPropagation(), selecting ? onSelect(t.id) : onTick(t))}
          aria-label={selecting ? (selected ? 'Unselect' : 'Select') : t.done ? 'Mark not done' : `Mark “${t.title}” done`}
        >
          <span className="ring">{(selecting ? selected : done) && <Check size={13} strokeWidth={3} />}</span>
        </button>
        <div className="trow-main">
          <button type="button" className="trow-title" onClick={() => (selecting ? onSelect(t.id) : ops.open(t.id))} tabIndex={selecting ? -1 : 0}>
            {t.title}
          </button>
          <div className="trow-meta">
            {t.source === 'request' && (
              <span className="tm req" title={`Request from ${t.requestedBy}`}>
                <Inbox size={12} /> Request
              </span>
            )}
            {look.show('due') && t.due && !t.done && (look.dueWords !== false || t.repeat) && (
              <span className={`tm due-${tone}`}>
                {t.repeat && <RepeatIcon size={12} aria-label="Repeats" />}
                {look.dueWords !== false && dueText(t.due, ops.today)}
              </span>
            )}
            {look.show('due') && !t.due && t.repeat && !t.done && (
              <span className="tm">
                <RepeatIcon size={12} /> Repeats
              </span>
            )}
            {hol && <span className="tm hol" title={`Public holiday: ${hol}`}>Holiday</span>}
            {t.done && t.doneAt && <span className="tm">Done {relative(t.doneAt)}</span>}
            {showStage && (
              <span className={`tm stage tone-${toneOf(st)}`}>
                <span className={`stage-dot k-${st.kind} tone-${toneOf(st)}`} />
                {stageBadge(st)}
              </span>
            )}
            {look.show('checklist') && cl.length > 0 && (
              <span className={`tm${cl.every((x) => x.done) ? ' ok' : ''}`} title="Checklist">
                <CheckCircle2 size={12} /> {cl.filter((x) => x.done).length}/{cl.length}
              </span>
            )}
            {comments > 0 && (
              <span className="tm" title="Comments">
                <MessageSquare size={12} /> {comments}
              </span>
            )}
            {brief && (
              <span className="tm brief" title="Part of a brief">
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
        {look.avatar && (
          <span className="trow-who phone-only">
            <Doer t={t} ops={ops} size={24} />
          </span>
        )}
        {look.show('assignee') && (
          <span className="trow-pick hide-phone">
            <PeoplePicker compact value={doersOf(t)} users={ops.users} me={ops.me} label="Doing it" onChange={(ids) => ops.patch(t.id, { assignees: ids, userId: ids[0] ?? '' })} />
          </span>
        )}
        <button type="button" ref={dots} className="icon-btn sm trow-more hide-phone" aria-label={`More for “${t.title}”`} onClick={(e) => (e.stopPropagation(), m.openFrom(dots))}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      {m.menu}
    </SwipeRow>
  );
}
