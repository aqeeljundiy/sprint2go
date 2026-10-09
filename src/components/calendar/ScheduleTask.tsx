import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { CalEvent } from '../../types';
import { toDateInput } from '../../calendarUtils';
import { DatePicker, TimePicker } from '../ui/DatePicker';
import { Sheet } from '../ui/Sheet';
import { SmoothHeight } from '../ui/Smooth';
import { freeSlots } from './calTools';

const LENGTHS = [15, 30, 60, 90];
const words = (m: number) => (m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`);
const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Give a task a time without dragging (phones can't drag a task onto the calendar): how long, then the next free slots
 * today and tomorrow as one-tap chips, or a day and time of your own.
 */
export function ScheduleTask({ title, events, onPick, onClose }: { title: string; events: CalEvent[]; onPick: (start: Date, minutes: number) => void; onClose: () => void }) {
  const [len, setLen] = useState<number | null>(null);
  const [own, setOwn] = useState(false);
  const [day, setDay] = useState(() => toDateInput(new Date(Date.now() + 86_400_000)));
  const [at, setAt] = useState('09:00');
  const slots = useMemo(() => (len ? freeSlots(events, len) : null), [events, len]);
  return (
    <Sheet onClose={onClose} title="Block time for it" className="sched-sheet">
      <div className="sched">
        <p className="sched-task">
          <CalendarClock size={16} />
          <span>{title}</span>
        </p>
        <div className="sched-label">How long?</div>
        <div className="cal-chips" role="radiogroup" aria-label="How long">
          {LENGTHS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={len === m} className={`cal-chip${len === m ? ' on' : ''}`} onClick={() => setLen(m)}>
              {words(m)}
            </button>
          ))}
        </div>
        <SmoothHeight>
          {slots && (
            <div className="sched-slots" key={len}>
              {(['today', 'tomorrow'] as const).map((k) => (
                <div key={k}>
                  <div className="sched-label">{k === 'today' ? 'Free today' : 'Free tomorrow'}</div>
                  <div className="cal-chips">
                    {slots[k].map((s) => (
                      <button key={s.getTime()} type="button" className="cal-chip slot" onClick={() => onPick(s, len!)}>
                        {t(s)}
                      </button>
                    ))}
                    {!slots[k].length && <span className="muted sched-none">{k === 'today' ? 'Nothing free for that long today' : 'Nothing free for that long'}</span>}
                  </div>
                </div>
              ))}
              {own ? (
                <div className="sched-own">
                  <DatePicker value={day} onChange={(v) => v && setDay(v)} clearable={false} label="Day" />
                  <TimePicker value={at} onChange={setAt} label="Starts" />
                  <button type="button" className="primary-btn" onClick={() => onPick(new Date(`${day}T${at}`), len!)}>
                    Block it
                  </button>
                </div>
              ) : (
                <button type="button" className="link-btn sched-other" onClick={() => setOwn(true)}>
                  Another day or time
                </button>
              )}
            </div>
          )}
        </SmoothHeight>
      </div>
    </Sheet>
  );
}
