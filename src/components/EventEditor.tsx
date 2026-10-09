import { useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { X } from 'lucide-react';
import type { CalEvent, CalendarDef, Person, User } from '../types';
import { Draft, draftEvent, draftOf, draftTimes, EventForm } from './calendar/EventForm';

interface Props {
  start: Date;
  event?: CalEvent; // editing this one
  calendars: CalendarDef[];
  team: User[];
  contacts: Person[];
  me: string;
  onSave: (e: Omit<CalEvent, 'id'>, kind: 'event' | 'task') => void;
  onClose: () => void;
}

/** New event or task, or changing an event: a dialog (the phone uses the quick-create sheet over the grid instead). */
export function EventEditor({ start, event, calendars, team, contacts, me, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => (event ? draftOf(new Date(event.start), new Date(event.end), event.calendarId, event) : draftOf(start, new Date(start.getTime() + 60 * 60_000), calendars[0].id)));
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const { ok } = draftTimes(draft);
  const valid = !!draft.title.trim() && ok;
  const save = () => valid && onSave(draftEvent(draft), draft.kind);
  const what = event ? 'Edit event' : draft.kind === 'task' ? 'New task' : 'New event';
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal ev-modal"
        role="dialog"
        aria-label={what}
        onMouseDown={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape' && !document.querySelector('.pop:not(.is-leaving)')) onClose();
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) save();
        }}
      >
        <header className="modal-head">
          <span>{what}</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
            <EventForm draft={draft} set={set} calendars={calendars} team={team} contacts={contacts} me={me} kindSwitch={!event} onSubmit={save} autoFocus />
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {!ok && draft.title.trim() && <span className="muted small">End must be after start</span>}
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={save} disabled={!valid}>
            {event ? 'Save' : draft.kind === 'task' ? 'Add task' : 'Save'} <kbd>⌘↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
