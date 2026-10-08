import { useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Popover } from './Popover';

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

/** Sprint2go's date field: quick picks plus a month grid. Value is YYYY-MM-DD or '' for none. */
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
              return (
                <button
                  key={v}
                  type="button"
                  className={`dp-day ${d.getMonth() !== month.getMonth() ? 'out' : ''} ${v === today ? 'today' : ''} ${v === value ? 'on' : ''}`}
                  onClick={() => pick(v)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
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
