import { useRef, useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { X } from 'lucide-react';
import type { CalEvent, CalendarDef, Person, User } from '../types';
import { Draft, draftEvent, draftOf, draftTimes, EventForm } from './calendar/EventForm';
import { t } from '../i18n';

interface Props {
  start: Date;
  event?: CalEvent; // editing this one (one date of a repeating one: that date)
  calendars: CalendarDef[];
  team: User[];
  contacts: Person[];
  me: string;
  /** `at`: the Save button, where one date of a repeating event asks which dates the change is for. */
  onSave: (e: Omit<CalEvent, 'id'>, kind: 'event' | 'task', at?: Element) => void;
  onClose: () => void;
}

/** New event or task, or changing an event: a dialog (the phone uses the quick-create sheet over the grid instead). */
export function EventEditor({ start, event, calendars, team, contacts, me, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => (event ? draftOf(new Date(event.start), new Date(event.end), event.calendarId, event) : draftOf(start, new Date(start.getTime() + 60 * 60_000), calendars[0].id)));
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const saveBtn = useRef<HTMLButtonElement>(null);
  const { ok } = draftTimes(draft);
  const valid = !!draft.title.trim() && ok;
  const save = () => valid && onSave(draftEvent(draft), draft.kind, saveBtn.current ?? undefined);
  const what = event ? t('Edit event') : draft.kind === 'task' ? t('New task') : t('New event');
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
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
            <EventForm draft={draft} set={set} calendars={calendars} team={team} contacts={contacts} me={me} kindSwitch={!event} onSubmit={save} autoFocus />
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {!ok && draft.title.trim() && <span className="muted small">{t('End must be after start')}</span>}
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button ref={saveBtn} className="primary-btn" onClick={save} disabled={!valid}>
            {event ? t('Save') : draft.kind === 'task' ? t('Add task') : t('Save')} <kbd>⌘↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
