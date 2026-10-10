import { useRef, useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { X } from 'lucide-react';
import type { CalEvent, CalendarDef, Person, User } from '../types';
import { Draft, draftEvent, draftOf, draftTimes, EventForm, EventRows } from './calendar/EventForm';
import { ActionSheet } from './ui/ActionSheet';
import { Sheet } from './ui/Sheet';
import { usePhone } from '../mobile/media';
import { t } from '../i18n';

/** What a new one is: an event, a task with its time blocked, or time out of office (an all-day event). */
export type EditorKind = Draft['kind'];

interface Props {
  start: Date;
  end?: Date; // new ones: an hour after the start unless given (quick create's block)
  event?: CalEvent; // editing this one (one date of a repeating one: that date)
  kind?: EditorKind; // new ones: what the + menu picked
  seed?: Partial<Draft>; // new ones: what was typed already (quick create's title and guests)
  calendars: CalendarDef[];
  team: User[];
  contacts: Person[];
  me: string;
  /** `at`: the Save button, where one date of a repeating event asks which dates the change is for. */
  onSave: (e: Omit<CalEvent, 'id'>, kind: 'event' | 'task', at?: Element) => void;
  onClose: () => void;
}

/** A new draft of the given kind (Out of office: all day, its own title). */
function fresh(start: Date, end: Date | undefined, calendarId: string, kind: EditorKind, seed?: Partial<Draft>): Draft {
  const d = draftOf(start, end ?? new Date(start.getTime() + 60 * 60_000), calendarId);
  return { ...d, ...seed, kind, title: seed?.title ?? (kind === 'ooo' ? t('Out of office') : ''), allDay: kind === 'ooo' ? true : d.allDay };
}

/**
 * New event or task, or changing an event. Desktop: a dialog. Phones: Google Calendar's full-screen editor, the same
 * for new and edit: X and Save at the top, the title, then one fixed list of rows that never move (a filled row shows
 * its value, an empty one its placeholder).
 */
export function EventEditor({ start, end, event, kind = 'event', seed, calendars, team, contacts, me, onSave, onClose }: Props) {
  const phone = usePhone();
  const [draft, setDraft] = useState<Draft>(() => (event ? draftOf(new Date(event.start), new Date(event.end), event.calendarId, event) : fresh(start, end, calendars[0].id, kind, seed)));
  const first = useRef(JSON.stringify(draft));
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const saveBtn = useRef<HTMLButtonElement>(null);
  const { ok } = draftTimes(draft);
  const valid = !!draft.title.trim() && ok;
  const save = () => valid && onSave(draftEvent(draft), draft.kind === 'task' ? 'task' : 'event', saveBtn.current ?? undefined);
  const what = event ? t('Edit event') : draft.kind === 'task' ? t('New task') : draft.kind === 'ooo' ? t('Out of office') : t('New event');

  // Phones: closing with changes asks first (swiping the page down counts as closing).
  const [asking, setAsking] = useState(false);
  const tryClose = () => (JSON.stringify(draft) !== first.current && draft.title.trim() ? setAsking(true) : onClose());

  if (phone)
    return (
      <>
        <Sheet
          size="full"
          className="ev-page ev-editor"
          label={what}
          onClose={tryClose}
          head={
            <>
              <button type="button" className="icon-btn ev-page-x" onClick={tryClose} aria-label={t('Close')}>
                <X size={22} />
              </button>
              <span className="spacer" />
              <button ref={saveBtn} type="button" className="primary-btn ev-page-save" onClick={save} disabled={!valid}>
                {t('Save')}
              </button>
            </>
          }
        >
          <EventRows draft={draft} set={set} calendars={calendars} team={team} contacts={contacts} me={me} kinds={!event} onSubmit={save} autoFocus={!event && !seed?.title} />
        </Sheet>
        <ActionSheet
          open={asking}
          onClose={() => setAsking(false)}
          title={event ? t('Discard your changes?') : t('Discard this event?')}
          className="ev-discard"
          actions={[
            { label: t('Discard'), danger: true, run: onClose },
            { label: t('Keep editing'), group: 'keep', run: () => setAsking(false) },
          ]}
        />
      </>
    );

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
