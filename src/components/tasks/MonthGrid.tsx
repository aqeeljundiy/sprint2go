import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, dayDate, isoDay, weekStart } from '../../taskDates';
import { holidayOn } from '../../holidayDays';
import { t } from '../../i18n';
import { fmtDate, fmtWeekdayLong, weekdayNames } from '../../i18n/format';

/**
 * A month you can pick a day in, laid out flat (inside a sheet or a panel, not as its own popover): weeks start on
 * Monday, today is ringed, the picked day filled, and days with tasks get a dot. Used by Schedule, Plan my day and
 * Upcoming's month picker.
 */
export function MonthGrid({ value, today, onPick, busy, min }: { value?: string; today: string; onPick: (day: string) => void; busy?: Set<string>; min?: string }) {
  const [month, setMonth] = useState(() => (value || today).slice(0, 7) + '-01');
  const days = useMemo(() => {
    const first = weekStart(month);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);
  const m = dayDate(month);
  const label = fmtDate(m, m.getFullYear() === dayDate(today).getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
  const lastRow = days.slice(35).every((d) => d.slice(0, 7) !== month.slice(0, 7)); // a sixth row only when the month needs it
  return (
    <div className="mgp">
      <div className="mgp-head">
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label={t('Previous month')} disabled={!!min && addMonths(month, -1).slice(0, 7) < min.slice(0, 7)}>
          <ChevronLeft size={18} />
        </button>
        <strong aria-live="polite">{label}</strong>
        <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label={t('Next month')}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mgp-grid" role="grid" aria-label={label}>
        {weekdayNames('narrow').map((d, i) => (
          <span key={i} className="mgp-wd" aria-hidden="true">
            {d}
          </span>
        ))}
        {(lastRow ? days.slice(0, 35) : days).map((d) => {
          const out = d.slice(0, 7) !== month.slice(0, 7);
          const hol = holidayOn(d);
          const n = dayDate(d).getDate();
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className={`mgp-day${out ? ' out' : ''}${d === today ? ' today' : ''}${d === value ? ' on' : ''}${busy?.has(d) ? ' busy' : ''}${hol ? ' hol' : ''}`}
              aria-selected={d === value}
              aria-label={[fmtWeekdayLong(d), hol, busy?.has(d) ? t('has tasks') : ''].filter(Boolean).join(', ')}
              disabled={!!min && d < min}
              onClick={() => onPick(d)}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Today's day, in the person's own time. */
export const todayDay = () => isoDay(new Date());
