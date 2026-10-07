import { useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { X } from 'lucide-react';
import type { CalEvent, CalendarDef } from '../types';
import { toDateInput, toTimeInput } from '../calendarUtils';
import { Select } from './ui/Select';
import { DatePicker, TIMES } from './ui/DatePicker';

interface Props {
  start: Date;
  calendars: CalendarDef[];
  onSave: (e: Omit<CalEvent, 'id'>) => void;
  onClose: () => void;
}

export function EventEditor({ start, calendars, onSave, onClose }: Props) {
  const end = new Date(start.getTime() + 60 * 60_000);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(toDateInput(start));
  const [from, setFrom] = useState(toTimeInput(start));
  const [to, setTo] = useState(toTimeInput(end));
  const [allDay, setAllDay] = useState(false);
  const [calendarId, setCalendarId] = useState(calendars[0].id);
  const [location, setLocation] = useState('');
  const [guests, setGuests] = useState('');
  const [notes, setNotes] = useState('');

  const s = new Date(`${date}T${allDay ? '00:00' : from}`);
  let e = new Date(`${date}T${allDay ? '00:00' : to}`);
  if (allDay) e = new Date(s.getTime() + 86_400_000);
  const valid = title.trim() && !isNaN(s.getTime()) && e > s;

  const save = () => {
    if (!valid) return;
    onSave({
      title: title.trim(),
      calendarId,
      start: s.toISOString(),
      end: e.toISOString(),
      allDay,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      guests: guests
        .split(/[,\s]+/)
        .filter((g) => /\S+@\S+\.\S+/.test(g))
        .map((email) => ({ name: email.split('@')[0], email })),
    });
  };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="New event"
        onMouseDown={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') onClose();
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) save();
        }}
      >
        <header className="modal-head">
          <span>New event</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
          <input
            className="title-input"
            autoFocus
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && save()}
            placeholder="Add title"
          />
          <div className="field-row">
            <DatePicker value={date} onChange={(v) => v && setDate(v)} clearable={false} label="Date" />
            {!allDay && (
              <>
                <Select value={from} onChange={setFrom} label="Starts" options={TIMES.map((t) => ({ value: t, label: t }))} width={130} />
                <span className="muted">to</span>
                <Select value={to} onChange={setTo} label="Ends" options={TIMES.map((t) => ({ value: t, label: t }))} width={130} />
              </>
            )}
          </div>
          <label className="check-row">
            <input type="checkbox" checked={allDay} onChange={(ev) => setAllDay(ev.target.checked)} />
            All day
          </label>
          <div className="cal-pick">
            {calendars.map((c) => (
              <button
                key={c.id}
                className={calendarId === c.id ? 'on' : ''}
                style={{ ['--c' as string]: c.color }}
                onClick={() => setCalendarId(c.id)}
              >
                <span className="dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
          <input value={location} onChange={(ev) => setLocation(ev.target.value)} placeholder="Location or video link" />
          <input value={guests} onChange={(ev) => setGuests(ev.target.value)} placeholder="Guests (emails, comma separated)" />
          <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="Notes" rows={3} />
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {!valid && title.trim() && <span className="muted small">End must be after start</span>}
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={save} disabled={!valid}>
            Save <kbd>⌘↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
