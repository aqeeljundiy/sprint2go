import { useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { Popover } from './Popover';
import { holidayOn } from '../../holidayDays';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const nextWeekday = (wd: number) => {
  const d = new Date();
  d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7 || 7));
  return iso(d);
};

export function shortDate(v: string) {
  const today = iso(new Date());
  if (v === today) return 'Today';
  if (v === addDays(1)) return 'Tomorrow';
  if (v === addDays(-1)) return 'Yesterday';
  return new Date(v + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** sprint2go's date field: quick picks plus a month grid. Value is YYYY-MM-DD or '' for none. */
export function DatePicker({
  value,
  onChange,
  label = 'Date',
  placeholder = 'Date',
  clearable = true,
  compact,
  className = '',
  autoOpen,
  onClosed,
}: {
  autoOpen?: boolean; // opens straight away (editing a table cell)
  onClosed?: () => void; // after it closes, picked or not
  value: string | null | undefined;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  clearable?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpenRaw] = useState(!!autoOpen);
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenRaw((o) => {
    const n = typeof v === 'function' ? v(o) : v;
    if (o && !n) setTimeout(() => onClosed?.(), 0);
    return n;
  });
  const base = value ? new Date(value + 'T12:00') : new Date();
  const [month, setMonth] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));

  const days = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start on Monday
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const today = iso(new Date());
  const quick: [string, string][] = [
    ['Today', today],
    ['Tomorrow', addDays(1)],
    ['Friday', nextWeekday(5)],
    ['Next Monday', nextWeekday(1)],
    ['In 2 weeks', addDays(14)],
  ];

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`sel date-sel ${value ? '' : 'empty'} ${compact ? 'sel-compact' : ''} ${className}`}
        onClick={() => {
          setMonth(new Date(base.getFullYear(), base.getMonth(), 1));
          setOpen((o) => !o);
        }}
        aria-label={label}
      >
        <CalendarDays size={14} />
        {(!compact || value) && <span className="sel-text">{value ? shortDate(value) : placeholder}</span>}
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={272} title={label}>
        <div className="dp">
          <div className="dp-quick">
            {quick.map(([l, v]) => (
              <button key={l} type="button" className={v === value ? 'on' : ''} onClick={() => pick(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="dp-head">
            <button type="button" className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <strong>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
            <button type="button" className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="dp-grid">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i} className="dp-wd">
                {d}
              </span>
            ))}
            {days.map((d) => {
              const v = iso(d);
              const hol = holidayOn(v);
              return (
                <button
                  key={v}
                  type="button"
                  className={`dp-day ${d.getMonth() !== month.getMonth() ? 'out' : ''} ${v === today ? 'today' : ''} ${v === value ? 'on' : ''} ${hol ? 'hol' : ''}`}
                  title={hol ? `${hol}, a public holiday` : undefined}
                  aria-label={hol ? `${d.getDate()}, ${hol}, public holiday` : undefined}
                  onClick={() => pick(v)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          {value && holidayOn(value) && <p className="dp-hol">{holidayOn(value)} is a public holiday</p>}
          {clearable && value && (
            <button type="button" className="dp-clear" onClick={() => pick('')}>
              <X size={13} /> No date
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}

/** Times every 15 minutes, for event editors. */
export const TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

/** "930", "9:30", "14", "2pm", "2.15 pm" → "09:30", "14:00", "14:15"; null when it isn't a time. */
export function parseTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * sprint2go's time field: type a time ("9:30", "2pm") or pick one from a list every 15 minutes that opens on the
 * current time, not at midnight. Value is HH:MM. On phones the list is a bottom sheet like every other picker.
 */
export function TimePicker({ value, onChange, label = 'Time', className = '' }: { value: string; onChange: (v: string) => void; label?: string; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const near = TIMES.reduce((best, t) => (Math.abs(mins(t) - mins(value)) < Math.abs(mins(best) - mins(value)) ? t : best), TIMES[0]);
  const parsed = parseTime(typed);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setTyped('');
    btn.current?.focus();
  };
  return (
    <>
      <button ref={btn} type="button" className={`sel time-sel ${open ? 'open' : ''} ${className}`} onClick={() => setOpen((o) => !o)} aria-label={`${label}: ${value}`} aria-haspopup="listbox" aria-expanded={open}>
        <Clock size={14} />
        <span className="sel-text">{value}</span>
      </button>
      <Popover anchor={btn} open={open} onClose={() => (setOpen(false), setTyped(''))} width={180} title={label}>
        <div className="tp">
          <input
            className="tp-input"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsed) (e.preventDefault(), pick(parsed));
            }}
            placeholder="Type a time, like 9:30"
            aria-label={`Type the ${label.toLowerCase()}`}
          />
          {typed && (
            <button type="button" className={`tp-opt typed ${parsed ? '' : 'bad'}`} disabled={!parsed} onClick={() => parsed && pick(parsed)}>
              {parsed ?? 'Not a time'}
            </button>
          )}
          <div
            className="tp-list"
            role="listbox"
            aria-label={label}
            ref={(el) => {
              list.current = el;
              // Open on the current time (centred), not at the top of the day.
              const on = el?.querySelector<HTMLElement>('[aria-selected="true"]');
              if (el && on && !el.dataset.placed) {
                el.dataset.placed = '1';
                el.scrollTop = on.offsetTop - el.clientHeight / 2 + on.offsetHeight / 2;
              }
            }}
          >
            {TIMES.map((t) => (
              <button key={t} type="button" role="option" aria-selected={t === near} className={`tp-opt ${t === near ? 'on' : ''}`} onClick={() => pick(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
const mins = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
