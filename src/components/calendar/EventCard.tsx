import { useRef } from 'react';
import { Check, CircleCheck, MapPin, Mic, Repeat, Video } from 'lucide-react';
import type { CalEvent } from '../../types';
import { fmtTimeRange } from '../../calendarUtils';
import { meetingLinkOf } from '../../meetingLinks';
import { useLongPress } from '../ui/useLongPress';
import { isMaybe, isPast, isPending, joinable, onColor, placeOf } from './calTools';
import { t } from '../../i18n';

export interface CardKit {
  color: (calendarId: string) => string;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Long-press (or right-click) for the event's menu. Phones have none: the actions live in its details (Google's). */
  onMenu?: (e: CalEvent, x: number, y: number) => void;
  taskOf?: (e: CalEvent) => { title: string; done: boolean } | null;
  onTaskDone?: (e: CalEvent) => void;
  botWillJoin?: (e: CalEvent) => boolean;
  /** Phones: Google Calendar's solid cards (white text on the calendar's colour, Join on the card when it's near). */
  phone?: boolean;
}

/**
 * One event as a full-width card (Schedule, the all-day list). The state is drawn, not written: dashed (an outline on
 * phones) for an invite not answered yet, a dashed edge for maybe, faded once it's over, a checkbox for a task's time
 * block, a mic when the notetaker joins. Desktop: long-press or right-click for its menu.
 */
export function EventCard({ e, kit, now }: { e: CalEvent; kit: CardKit; now: number }) {
  const press = useLongPress((p) => kit.onMenu?.(e, p.x, p.y), { disabled: !kit.onMenu });
  // Phones: a long hold does nothing (Google's schedule), so the click a long hold ends in doesn't open the event.
  const downAt = useRef(0);
  const task = kit.taskOf?.(e) ?? null;
  const link = meetingLinkOf(e);
  const where = e.location && e.location !== link?.url ? e.location : '';
  const color = kit.color(e.calendarId);
  const cls = ['ev-card', kit.onMenu && 'lp', isPending(e) && 'pending', isMaybe(e) && 'maybe', isPast(e, now) && 'past', kit.selectedId === e.id && 'picked', task && 'is-task', task?.done && 'done'].filter(Boolean).join(' ');
  const check = task && (
    <button
      type="button"
      className={`ev-check${task.done ? ' on' : ''}`}
      aria-label={task.done ? t('Done') : t('Mark the task done')}
      aria-pressed={task.done}
      onClick={(c) => (c.stopPropagation(), !task.done && kit.onTaskDone?.(e))}
    >
      {task.done && <Check size={13} strokeWidth={3} />}
    </button>
  );
  const open = {
    role: 'button',
    tabIndex: 0,
    onClick: () => kit.onSelect(e.id),
    onKeyDown: (k: React.KeyboardEvent) => (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), kit.onSelect(e.id)),
  } as const;

  if (kit.phone) {
    const place = placeOf(e, link?.url);
    return (
      <div
        {...open}
        onPointerDown={() => (downAt.current = performance.now())}
        onClick={() => !(downAt.current && performance.now() - downAt.current >= 500) && kit.onSelect(e.id)}
        className={`${cls} solid${place ? ' three' : ''}`}
        style={{ ['--c' as string]: color, ['--on' as string]: onColor(color) }}
      >
        {task && (task.done ? <span className="ev-done-mark" aria-hidden><CircleCheck size={16} /></span> : check)}
        <span className="ev-card-text">
          <span className="ev-card-title">{e.title}</span>
          <span className="ev-card-meta">
            {e.allDay ? t('All day') : fmtTimeRange(e.start, e.end)}
            {e.rrule && <Repeat size={12} className="ev-repeat" aria-label={t('Repeats')} />}
            {kit.botWillJoin?.(e) && <Mic size={12} className="ev-card-bot" aria-label={t('The notetaker will join')} />}
          </span>
          {place && <span className="ev-card-place">{place}</span>}
        </span>
        {link && !e.allDay && joinable(e, now) && (
          <a className="ev-join-pill" href={link.url} target="_blank" rel="noopener noreferrer" onClick={(c) => c.stopPropagation()}>
            {t('Join')}
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      {...open}
      className={cls}
      style={{ ['--c' as string]: color }}
      {...press}
      onContextMenu={(m) => {
        press.onContextMenu(m);
        if (!kit.onMenu) return;
        m.preventDefault();
        kit.onMenu(e, m.clientX, m.clientY);
      }}
    >
      {check}
      <span className="ev-card-text">
        <span className="ev-card-title">{e.title}</span>
        <span className="ev-card-meta">
          {e.allDay ? t('All day') : fmtTimeRange(e.start, e.end)}
          {e.rrule && <Repeat size={12} className="ev-repeat" aria-label={t('Repeats')} />}
          {link && (
            <>
              {' · '}
              <Video size={13} aria-label={t('Video call')} />
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
      {kit.botWillJoin?.(e) && <Mic size={15} className="ev-card-bot" aria-label={t('The notetaker will join')} />}
    </div>
  );
}
