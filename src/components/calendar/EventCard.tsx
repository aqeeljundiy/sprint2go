import { Check, MapPin, Mic, Video } from 'lucide-react';
import type { CalEvent } from '../../types';
import { fmtTime } from '../../calendarUtils';
import { meetingLinkOf } from '../../meetingLinks';
import { useLongPress } from '../ui/useLongPress';
import { isMaybe, isPast, isPending } from './calTools';

export interface CardKit {
  color: (calendarId: string) => string;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onMenu: (e: CalEvent, x: number, y: number) => void;
  taskOf?: (e: CalEvent) => { title: string; done: boolean } | null;
  onTaskDone?: (e: CalEvent) => void;
  botWillJoin?: (e: CalEvent) => boolean;
}

/**
 * One event as a full-width card (Schedule, and the tapped day under Month on phones). The state is drawn, not
 * written: dashed for an invite not answered yet, a dashed edge for maybe, faded once it's over, a checkbox for a
 * task's time block, a mic when the notetaker joins. Long-press (or right-click) for its menu.
 */
export function EventCard({ e, kit, now }: { e: CalEvent; kit: CardKit; now: number }) {
  const press = useLongPress((p) => kit.onMenu(e, p.x, p.y));
  const task = kit.taskOf?.(e) ?? null;
  const link = meetingLinkOf(e);
  const where = e.location && e.location !== link?.url ? e.location : '';
  const cls = ['ev-card', 'lp', isPending(e) && 'pending', isMaybe(e) && 'maybe', isPast(e, now) && 'past', kit.selectedId === e.id && 'picked', task && 'is-task', task?.done && 'done'].filter(Boolean).join(' ');
  return (
    <div
      role="button"
      tabIndex={0}
      className={cls}
      style={{ ['--c' as string]: kit.color(e.calendarId) }}
      {...press}
      onClick={() => kit.onSelect(e.id)}
      onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), kit.onSelect(e.id))}
      onContextMenu={(m) => {
        press.onContextMenu(m);
        m.preventDefault();
        kit.onMenu(e, m.clientX, m.clientY);
      }}
    >
      {task && (
        <button
          type="button"
          className={`ev-check${task.done ? ' on' : ''}`}
          aria-label={task.done ? 'Done' : 'Mark the task done'}
          aria-pressed={task.done}
          onClick={(c) => (c.stopPropagation(), !task.done && kit.onTaskDone?.(e))}
        >
          {task.done && <Check size={13} strokeWidth={3} />}
        </button>
      )}
      <span className="ev-card-text">
        <span className="ev-card-title">{e.title}</span>
        <span className="ev-card-meta">
          {e.allDay ? 'All day' : `${fmtTime(e.start)} to ${fmtTime(e.end)}`}
          {link && (
            <>
              {' · '}
              <Video size={13} aria-label="Video call" />
            </>
          )}
          {where && (
            <>
              {' · '}
              <MapPin size={13} aria-hidden />
              <span className="ev-card-where">{where}</span>
            </>
          )}
        </span>
      </span>
      {kit.botWillJoin?.(e) && <Mic size={15} className="ev-card-bot" aria-label="The notetaker will join" />}
    </div>
  );
}
