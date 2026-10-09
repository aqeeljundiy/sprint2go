import { useMemo, useState } from 'react';
import { CalendarDays, Check, PartyPopper, SkipForward, Sun, Sunrise } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { addDays, dueText } from '../../taskDates';
import { stageIdFor } from '../../stages';
import type { Todo } from '../../types';
import { DayPicker } from './TaskSheets';
import type { TaskOps } from './taskOps';

type Step = { id: string; did: 'today' | 'moved' | 'done' | 'skipped'; before?: string };

/**
 * Plan my day: your overdue tasks, then today's, one at a time. For each: keep it for Today, move it to Tomorrow or
 * another day, mark it Done, or Skip. A short tally at the end. Each step can be undone with Back.
 */
export function PlanMyDay({ ops, tasks, onClose }: { ops: TaskOps; tasks: Todo[]; onClose: () => void }) {
  // The list is fixed when it opens, so moving one doesn't reshuffle the rest.
  const [queue] = useState(() => tasks.map((t) => t.id));
  const [steps, setSteps] = useState<Step[]>([]);
  const [picking, setPicking] = useState(false);
  const i = steps.length;
  const t = ops.tasks.find((x) => x.id === queue[i]);
  const total = queue.length;
  const tally = useMemo(() => {
    const n = (k: Step['did']) => steps.filter((s) => s.did === k).length;
    return { today: n('today'), moved: n('moved'), done: n('done'), skipped: n('skipped') };
  }, [steps]);

  const act = (did: Step['did'], day?: string) => {
    if (!t) return;
    const step: Step = { id: t.id, did, before: t.due };
    if (did === 'today' && t.due !== ops.today) ops.patch(t.id, { due: ops.today });
    if (did === 'moved' && day !== undefined) ops.patch(t.id, { due: day || undefined });
    if (did === 'done') ops.status(t.id, stageIdFor(t, 'done'), true);
    setPicking(false);
    setSteps((s) => [...s, step]);
  };
  const back = () => {
    const last = steps[steps.length - 1];
    if (!last) return;
    const x = ops.tasks.find((y) => y.id === last.id);
    if (x && (last.did === 'today' || last.did === 'moved')) ops.patch(x.id, { due: last.before });
    if (x && last.did === 'done') ops.status(x.id, stageIdFor(x, 'open'), true);
    setSteps((s) => s.slice(0, -1));
  };

  const c = t ? ops.clients.find((x) => x.id === t.clientId) : undefined;
  const late = t?.due && t.due < ops.today;
  return (
    <Sheet
      onClose={onClose}
      title="Plan my day"
      className="pmd-sheet"
      head={
        i > 0 ? (
          <button type="button" className="ghost-btn sm" onClick={back}>
            Back
          </button>
        ) : undefined
      }
    >
      <SmoothHeight>
        <TabPane key={t ? `${t.id}:${picking}` : 'end'}>
          {t ? (
            <div className="pmd-step">
              <p className="pmd-count">
                {i + 1} of {total}
                <span className="pmd-bar" aria-hidden="true">
                  <span style={{ width: `${(i / total) * 100}%` }} />
                </span>
              </p>
              <div className="pmd-card">
                <strong>{t.title}</strong>
                <span className={late ? 'due-overdue' : 'due-today'}>
                  {late ? `Was due ${dueText(t.due!, ops.today).replace(/^Yesterday$/, 'yesterday')}` : 'Due today'}
                  {c ? ` · ${c.name}` : ''}
                </span>
              </div>
              {picking ? (
                <DayPicker today={ops.today} value={t.due} onPick={(d) => act('moved', d)} />
              ) : (
                <div className="pmd-acts">
                  <button type="button" className="pmd-act primary" onClick={() => act('today')}>
                    <Sun size={18} /> Today
                  </button>
                  <button type="button" className="pmd-act" onClick={() => act('moved', addDays(ops.today, 1))}>
                    <Sunrise size={18} /> Tomorrow
                  </button>
                  <button type="button" className="pmd-act" onClick={() => setPicking(true)}>
                    <CalendarDays size={18} /> Pick a date
                  </button>
                  <button type="button" className="pmd-act ok" onClick={() => act('done')}>
                    <Check size={18} /> Done
                  </button>
                  <button type="button" className="pmd-act quiet" onClick={() => act('skipped')}>
                    <SkipForward size={18} /> Skip
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="pmd-end">
              <PartyPopper size={28} />
              <strong>{total ? 'Your day is planned' : 'Nothing to plan'}</strong>
              <p className="muted">
                {total
                  ? [tally.today && `${tally.today} for today`, tally.moved && `${tally.moved} moved`, tally.done && `${tally.done} done`, tally.skipped && `${tally.skipped} skipped`].filter(Boolean).join(', ') + '.'
                  : 'Nothing is overdue or due today.'}
              </p>
              <button type="button" className="primary-btn" onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </TabPane>
      </SmoothHeight>
    </Sheet>
  );
}

