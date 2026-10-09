import { useMemo, useState } from 'react';
import { CalendarDays, Check, PartyPopper, SkipForward, Sun, Sunrise } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { addDays } from '../../taskDates';
import { stageIdFor } from '../../stages';
import type { Todo } from '../../types';
import { DayPicker, dayWords } from './TaskSheets';
import type { TaskOps } from './taskOps';
import { t, tn } from '../../i18n';

type Step = { id: string; did: 'today' | 'moved' | 'done' | 'skipped'; before?: string };

/**
 * Plan my day: your overdue tasks, then today's, one at a time. For each: keep it for Today, move it to Tomorrow or
 * another day, mark it Done, or Skip. A short tally at the end. Each step can be undone with Back.
 */
export function PlanMyDay({ ops, tasks, onClose }: { ops: TaskOps; tasks: Todo[]; onClose: () => void }) {
  // The list is fixed when it opens, so moving one doesn't reshuffle the rest.
  const [queue] = useState(() => tasks.map((task) => task.id));
  const [steps, setSteps] = useState<Step[]>([]);
  const [picking, setPicking] = useState(false);
  const i = steps.length;
  const task = ops.tasks.find((x) => x.id === queue[i]);
  const total = queue.length;
  const tally = useMemo(() => {
    const n = (k: Step['did']) => steps.filter((s) => s.did === k).length;
    return { today: n('today'), moved: n('moved'), done: n('done'), skipped: n('skipped') };
  }, [steps]);

  const act = (did: Step['did'], day?: string) => {
    if (!task) return;
    const step: Step = { id: task.id, did, before: task.due };
    if (did === 'today' && task.due !== ops.today) ops.patch(task.id, { due: ops.today });
    if (did === 'moved' && day !== undefined) ops.patch(task.id, { due: day || undefined });
    if (did === 'done') ops.status(task.id, stageIdFor(task, 'done'), true);
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

  const c = task ? ops.clients.find((x) => x.id === task.clientId) : undefined;
  const late = task?.due && task.due < ops.today;
  return (
    <Sheet
      onClose={onClose}
      title={t('Plan my day')}
      className="pmd-sheet"
      head={
        i > 0 ? (
          <button type="button" className="ghost-btn sm" onClick={back}>
            {t('Back')}
          </button>
        ) : undefined
      }
    >
      <SmoothHeight>
        <TabPane key={task ? `${task.id}:${picking}` : 'end'}>
          {task ? (
            <div className="pmd-step">
              <p className="pmd-count">
                {t('{n} of {total}', { n: i + 1, total })}
                <span className="pmd-bar" aria-hidden="true">
                  <span style={{ width: `${(i / total) * 100}%` }} />
                </span>
              </p>
              <div className="pmd-card">
                <strong>{task.title}</strong>
                <span className={late ? 'due-overdue' : 'due-today'}>
                  {late ? t('Was due {day}', { day: dayWords(task.due!, ops.today) }) : t('Due today')}
                  {c ? ` · ${c.name}` : ''}
                </span>
              </div>
              {picking ? (
                <DayPicker today={ops.today} value={task.due} onPick={(d) => act('moved', d)} />
              ) : (
                <div className="pmd-acts">
                  <button type="button" className="pmd-act primary" onClick={() => act('today')}>
                    <Sun size={18} /> {t('Today')}
                  </button>
                  <button type="button" className="pmd-act" onClick={() => act('moved', addDays(ops.today, 1))}>
                    <Sunrise size={18} /> {t('Tomorrow')}
                  </button>
                  <button type="button" className="pmd-act" onClick={() => setPicking(true)}>
                    <CalendarDays size={18} /> {t('Pick a date')}
                  </button>
                  <button type="button" className="pmd-act ok" onClick={() => act('done')}>
                    <Check size={18} /> {t('Done')}
                  </button>
                  <button type="button" className="pmd-act quiet" onClick={() => act('skipped')}>
                    <SkipForward size={18} /> {t('Skip')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="pmd-end">
              <PartyPopper size={28} />
              <strong>{total ? t('Your day is planned') : t('Nothing to plan')}</strong>
              <p className="muted">
                {total
                  ? [tally.today && tn(tally.today, '{n} for today', '{n} for today'), tally.moved && tn(tally.moved, '{n} moved', '{n} moved'), tally.done && tn(tally.done, '{n} done', '{n} done'), tally.skipped && tn(tally.skipped, '{n} skipped', '{n} skipped')].filter(Boolean).join(', ') + '.'
                  : t('Nothing is overdue or due today.')}
              </p>
              <button type="button" className="primary-btn" onClick={onClose}>
                {t('Close')}
              </button>
            </div>
          )}
        </TabPane>
      </SmoothHeight>
    </Sheet>
  );
}

