import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CalEvent, CalendarDef, Person, User } from '../../types';
import { fromWall, wallIn } from './calTools';
import { Sheet } from '../ui/Sheet';
import { Draft, draftEvent, draftTimes, EventForm, NO_REPEAT } from './EventForm';

/**
 * New event on a phone: the block drawn on the grid (with handles for its time) and this sheet over the lower part
 * of the screen: title, Event or Task, when, guests and Save. "More options" (or swiping the sheet up) shows the
 * quiet extras. The grid above stays live: tap another slot to move the block, drag its handles to change the time.
 */
export function QuickCreate({
  quick,
  onTimes,
  calendars,
  team,
  contacts,
  me,
  titleRef,
  onSave,
  onClose,
}: {
  quick: { start: Date; end: Date };
  onTimes: (start: Date, end: Date) => void;
  calendars: CalendarDef[];
  team: User[];
  contacts: Person[];
  me: string;
  titleRef: RefObject<HTMLInputElement | null>;
  onSave: (e: Omit<CalEvent, 'id'>, kind: 'event' | 'task') => void;
  onClose: () => void;
}) {
  const [rest, setRest] = useState<Omit<Draft, 'date' | 'from' | 'to'>>({ kind: 'event', title: '', allDay: false, calendarId: calendars[0].id, guests: [], location: '', meetUrl: '', notes: '', remind: null, tz: null, repeat: NO_REPEAT, sendInvites: true });
  const [more, setMore] = useState(false);
  const s0 = wallIn(quick.start, rest.tz);
  const draft: Draft = { ...rest, date: s0.date, from: s0.time, to: wallIn(quick.end, rest.tz).time };
  const set = (p: Partial<Draft>) => {
    const { date, from, to, ...other } = p;
    if (Object.keys(other).length) setRest((r) => ({ ...r, ...other }));
    // Another time zone keeps the same clock times: the block moves to where they fall here.
    if ('tz' in other && other.tz !== rest.tz) {
      onTimes(fromWall(draft.date, draft.from, other.tz ?? null), fromWall(draft.date, draft.to, other.tz ?? null));
      return;
    }
    if (date !== undefined || from !== undefined || to !== undefined) {
      const d = { ...draft, ...p };
      const { start, end, ok } = draftTimes({ ...d, allDay: false });
      if (ok) onTimes(start, end);
      else if (!isNaN(start.getTime())) onTimes(start, new Date(start.getTime() + 30 * 60_000));
    }
  };
  const valid = !!draft.title.trim() && draftTimes(draft).ok;
  const save = () => valid && onSave(draftEvent(draft), draft.kind);

  // Swiping the sheet up from its handle shows everything.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sheet = box.current?.closest('.sheet') as HTMLElement | null;
    if (!sheet || more) return;
    let y0 = 0;
    let on = false;
    const start = (e: TouchEvent) => {
      on = !!(e.target as Element).closest('.sheet-grab, .sheet-head, .ev-more');
      y0 = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => on && y0 - e.touches[0].clientY > 36 && ((on = false), setMore(true));
    sheet.addEventListener('touchstart', start, { passive: true });
    sheet.addEventListener('touchmove', move, { passive: true });
    return () => {
      sheet.removeEventListener('touchstart', start);
      sheet.removeEventListener('touchmove', move);
    };
  }, [more]);

  return (
    <Sheet
      onClose={onClose}
      label={draft.kind === 'task' ? 'New task' : 'New event'}
      className={`quick-sheet${more ? ' more' : ''}`}
      footer={
        <>
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-btn" onClick={save} disabled={!valid}>
            {draft.kind === 'task' ? 'Add task' : 'Save'}
          </button>
        </>
      }
    >
      <div ref={box} className="quick-body">
        <EventForm draft={draft} set={set} calendars={calendars} team={team} contacts={contacts} me={me} kindSwitch compact={!more} onMore={() => setMore(true)} titleRef={titleRef} onSubmit={save} />
      </div>
    </Sheet>
  );
}
