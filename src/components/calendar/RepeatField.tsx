import { useState } from 'react';
import { ChevronDown, Minus, Plus, Repeat } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { PushScreen } from '../ui/PushScreen';
import { DatePicker } from '../ui/DatePicker';
import { Select, type Option } from '../ui/Select';
import { SmoothHeight } from '../ui/Smooth';
import { dateFacts, dayName, monthlyWords, presetOf, presetSpec, specWords, type Freq, type RepeatPreset, type RepeatSpec } from '../../repeat';
import { t, tn } from '../../i18n';
import { weekdayName } from '../../i18n/format';

/** What the event form holds for its repeat: the picker's choice, or a rule it can't show (kept as written, in words). */
export interface RepeatDraft {
  spec: RepeatSpec | null;
  raw: string | null; // a rule from an invite the picker can't show
  rawWords?: string; // that rule in words
  touched: boolean; // picked in this edit (only then does the rule go with the save)
}

const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first
/** "day" or "days" after "Every 2…" in Custom. */
const unit = (f: Freq, n: number) =>
  ({ DAILY: tn(n, 'day', 'days'), WEEKLY: tn(n, 'week', 'weeks'), MONTHLY: tn(n, 'month', 'months'), YEARLY: tn(n, 'year', 'years') })[f];

/** The presets for a date: their names say the day ("Every week on Tuesday", "Every month on the 2nd Tuesday"). */
export function repeatOptions(startWall: number, spec: RepeatSpec | null): Option<RepeatPreset>[] {
  const f = dateFacts(startWall);
  const cur = presetOf(spec);
  const weekly = (p: 'weekly' | 'biweekly') => specWords(cur === p && spec ? spec : presetSpec(p, startWall)!, startWall, false);
  const monthly = (m: NonNullable<RepeatSpec['monthly']>) => specWords({ freq: 'MONTHLY', interval: 1, monthly: m }, startWall, false);
  return [
    { value: 'none', label: t('Doesn’t repeat') },
    { value: 'daily', label: t('Every day') },
    { value: 'weekdays', label: t('Every weekday'), hint: t('{first} to {last}', { first: weekdayName(1), last: weekdayName(5) }) },
    { value: 'weekly', label: weekly('weekly') },
    { value: 'biweekly', label: weekly('biweekly') },
    { value: 'monthly-date', label: monthly('date') },
    { value: 'monthly-nth', label: monthly('nth') },
    ...(f.lastWeek ? [{ value: 'monthly-lastWeekday' as const, label: monthly('lastWeekday') }] : []),
    ...(f.lastDay ? [{ value: 'monthly-last' as const, label: monthly('last') }] : []),
    { value: 'yearly', label: specWords({ freq: 'YEARLY', interval: 1 }, startWall) },
    { value: 'custom', label: t('Custom'), hint: cur === 'custom' && spec ? specWords(spec, startWall) : t('Every few days or weeks, or until a date') },
  ];
}

/** The quiet "Repeat" word: tapping it picks a repeat straight away. */
export function RepeatToken({ startWall, onPick }: { startWall: number; onPick: (spec: RepeatSpec | null, custom: boolean) => void }) {
  return (
    <Select<RepeatPreset>
      value={null}
      options={repeatOptions(startWall, null).slice(1)}
      onChange={(p) => onPick(p === 'custom' ? { freq: 'WEEKLY', interval: 1, days: [dateFacts(startWall).wd] } : presetSpec(p, startWall), p === 'custom')}
      label={t('Repeat')}
      title={t('Repeat')}
      className="ev-token"
      searchable={false}
      width={280}
      renderValue={() => (
        <>
          <Repeat size={14} />
          {t('Repeat')}
        </>
      )}
    />
  );
}

/** Weekday chips, Monday first; at least one stays on. */
function Days({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="rp-days" role="group" aria-label={t('On these days')}>
      {WEEK.map((d) => {
        const on = days.includes(d);
        return (
          <button key={d} type="button" className={`rp-day${on ? ' on' : ''}`} aria-pressed={on} aria-label={dayName(d)} title={dayName(d)} onClick={() => (on ? days.length > 1 && onChange(days.filter((x) => x !== d)) : onChange([...days, d]))}>
            {weekdayName(d, 'narrow')}
          </button>
        );
      })}
    </div>
  );
}

/** A number with − and + (typing works too). */
function Stepper({ value, min = 1, max = 999, onChange, label }: { value: number; min?: number; max?: number; onChange: (n: number) => void; label: string }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n) || min));
  return (
    <span className="rp-step" role="group" aria-label={label}>
      <button type="button" className="icon-btn sm" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={t('One fewer')}>
        <Minus size={14} />
      </button>
      <input value={String(value)} inputMode="numeric" aria-label={label} onChange={(e) => e.target.value.replace(/\D/g, '') && onChange(clamp(Number(e.target.value.replace(/\D/g, ''))))} onFocus={(e) => e.target.select()} />
      <button type="button" className="icon-btn sm" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={t('One more')}>
        <Plus size={14} />
      </button>
    </span>
  );
}

/**
 * How an event repeats, opened: the presets (named for its date), weekday chips for a weekly repeat, and Custom: every
 * so many days, weeks, months or years, which days, and when it ends (never, on a date, after so many times). All our
 * own controls. A rule from an invite the picker can't show is kept and shown in words until another is picked.
 */
export function RepeatField({ value, startWall, startDay, onChange, custom, onCustom }: { value: RepeatDraft; startWall: number; startDay: string; onChange: (r: RepeatDraft) => void; custom: boolean; onCustom: (on: boolean) => void }) {
  const { spec } = value;
  const preset = value.raw && !spec ? 'raw' : custom && spec ? 'custom' : presetOf(spec);
  const set = (s: RepeatSpec | null) => onChange({ spec: s, raw: null, touched: true });
  const options: Option<string>[] = [...(value.raw && !spec ? [{ value: 'raw', label: value.rawWords ?? t('Repeats'), hint: t('As the invite says') }] : []), ...repeatOptions(startWall, spec)];
  const pick = (p: string) => {
    if (p === 'raw') return;
    if (p === 'custom') {
      onCustom(true);
      if (!spec) set({ freq: 'WEEKLY', interval: 1, days: [dateFacts(startWall).wd] });
      return;
    }
    onCustom(false);
    set(presetSpec(p as RepeatPreset, startWall, p === 'weekly' || p === 'biweekly' ? (spec?.freq === 'WEEKLY' ? spec.days : undefined) : undefined));
  };
  const f = dateFacts(startWall);
  const monthModes: Option<NonNullable<RepeatSpec['monthly']>>[] = [
    { value: 'date', label: monthlyWords('date', startWall) },
    { value: 'nth', label: monthlyWords('nth', startWall) },
    ...(f.lastWeek ? [{ value: 'lastWeekday' as const, label: monthlyWords('lastWeekday', startWall) }] : []),
    ...(f.lastDay ? [{ value: 'last' as const, label: monthlyWords('last', startWall) }] : []),
  ];
  const ends = spec?.count ? 'count' : spec?.until ? 'until' : 'never';
  return (
    <div className="rp">
      <div className="ev-extra">
        <Repeat size={16} />
        <Select<string>
          value={preset}
          options={options}
          onChange={pick}
          label={t('Repeat')}
          title={t('Repeat')}
          className="sel-flat"
          width={300}
          searchable={false}
          // Custom says what it is ("Every 2 weeks on Monday, until 31 Dec 2026").
          renderValue={(o) => (
            <>
              <span className="sel-text">{preset === 'custom' && spec ? specWords(spec, startWall) : o?.label}</span>
              <ChevronDown size={14} className="sel-chev" />
            </>
          )}
        />
      </div>
      <SmoothHeight>
        {spec && (preset === 'weekly' || preset === 'biweekly') && (
          <div className="rp-more">
            <Days days={spec.days ?? [f.wd]} onChange={(days) => set({ ...spec, days })} />
          </div>
        )}
        {spec && preset === 'custom' && (
          <div className="rp-more rp-custom">
            <div className="rp-line">
              <span className="rp-label">{t('Every')}</span>
              <Stepper value={spec.interval} max={99} onChange={(interval) => set({ ...spec, interval })} label={t('How often')} />
              <Select<Freq>
                value={spec.freq}
                options={(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as Freq[]).map((x) => ({ value: x, label: unit(x, spec.interval) }))}
                onChange={(freq) => set({ freq, interval: spec.interval, until: spec.until, count: spec.count, ...(freq === 'WEEKLY' ? { days: [f.wd] } : freq === 'MONTHLY' ? { monthly: 'date' } : {}) })}
                label={t('Days, weeks, months or years')}
                title={t('Every')}
                className="sel-flat rp-unit"
                width={160}
              />
            </div>
            {spec.freq === 'WEEKLY' && <Days days={spec.days ?? [f.wd]} onChange={(days) => set({ ...spec, days })} />}
            {spec.freq === 'MONTHLY' && (
              <div className="rp-line">
                <Select value={spec.monthly ?? 'date'} options={monthModes} onChange={(monthly) => set({ ...spec, monthly })} label={t('Which day of the month')} title={t('Which day')} className="sel-flat" width={240} />
              </div>
            )}
            <div className="rp-line">
              <span className="rp-label">{t('Ends')}</span>
              <Select<'never' | 'until' | 'count'>
                value={ends}
                options={[
                  { value: 'never', label: t('Never') },
                  { value: 'until', label: t('On a date') },
                  { value: 'count', label: t('After a number of times') },
                ]}
                onChange={(v) => set({ ...spec, until: v === 'until' ? (spec.until ?? addMonths(startDay, 3)) : undefined, count: v === 'count' ? (spec.count ?? 10) : undefined })}
                label={t('Ends')}
                title={t('Ends')}
                className="sel-flat"
                width={220}
              />
              {ends === 'until' && <DatePicker value={spec.until} onChange={(v) => v && set({ ...spec, until: v < startDay ? startDay : v })} clearable={false} label={t('Last day')} />}
              {ends === 'count' && (
                <>
                  <Stepper value={spec.count ?? 10} onChange={(count) => set({ ...spec, count })} label={t('How many times')} />
                  <span className="rp-label">{tn(spec.count ?? 10, 'time', 'times')}</span>
                </>
              )}
            </div>
          </div>
        )}
      </SmoothHeight>
    </div>
  );
}

/** "2026-10-13" three months on (the last day a new end date offers). */
function addMonths(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Phones (Google Calendar's): the Repeat row says the repeat in words; tapping it opens a sheet of radio rows (Does not
 * repeat first, the presets named for the date, Custom…). A tap picks and closes. Custom opens its own screen: every so
 * many days, weeks, months or years, which weekdays, and when it ends, with Done.
 */
export function RepeatRow({ value, startWall, startDay, onChange }: { value: RepeatDraft; startWall: number; startDay: string; onChange: (r: RepeatDraft) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<RepeatSpec | null>(null);
  const { spec } = value;
  const raw = !!value.raw && !spec;
  const preset = raw ? 'raw' : presetOf(spec);
  const words = raw ? (value.rawWords ?? t('Repeats')) : spec ? specWords(spec, startWall) : t('Does not repeat');
  // Every 2 weeks lives in Custom on phones, as in Google's list.
  const current = preset === 'biweekly' ? 'custom' : preset;
  const options: Option<string>[] = [
    ...(raw ? [{ value: 'raw', label: value.rawWords ?? t('Repeats'), hint: t('As the invite says') }] : []),
    ...repeatOptions(startWall, spec)
      .filter((o) => o.value !== 'biweekly')
      .map((o) => (o.value === 'none' ? { ...o, label: t('Does not repeat') } : o.value === 'custom' ? { ...o, label: t('Custom…'), hint: current === 'custom' && spec ? specWords(spec, startWall) : undefined } : o)),
  ];
  const pick = (p: string) => {
    setOpen(false);
    if (p === 'raw') return;
    if (p === 'custom') return setCustom(spec ?? { freq: 'WEEKLY', interval: 1, days: [dateFacts(startWall).wd] });
    if (p === 'none') return onChange({ spec: null, raw: null, touched: true });
    onChange({ spec: presetSpec(p as RepeatPreset, startWall, p === 'weekly' && spec?.freq === 'WEEKLY' ? spec.days : undefined), raw: null, touched: true });
  };
  return (
    <>
      <button type="button" className={`er-line er-value${spec || raw ? '' : ' er-empty'}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={t('Repeat: {how}', { how: words })}>
        <span>{words}</span>
      </button>
      {open && (
        <Sheet title={t('Repeat')} onClose={() => setOpen(false)} className="rp-sheet">
          <div className="rp-list" role="radiogroup" aria-label={t('Repeat')}>
            {options.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={current === o.value} className={`rp-opt${current === o.value ? ' on' : ''}`} onClick={() => pick(o.value)}>
                <span className="rp-radio" aria-hidden />
                <span className="rp-opt-text">
                  {o.label}
                  {o.hint && <small>{o.hint}</small>}
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {custom && (
        <PushScreen
          title={t('Custom repeat')}
          onBack={() => setCustom(null)}
          className="rp-custom-screen"
          actions={
            <button type="button" className="primary-btn sm rp-done" onClick={() => (onChange({ spec: custom, raw: null, touched: true }), setCustom(null))}>
              {t('Done')}
            </button>
          }
        >
          <CustomRepeat spec={custom} startWall={startWall} startDay={startDay} onChange={setCustom} />
        </PushScreen>
      )}
    </>
  );
}

/** Custom repeat, as rows: every N units, on which weekdays, which day of the month, and when it ends. */
function CustomRepeat({ spec, startWall, startDay, onChange }: { spec: RepeatSpec; startWall: number; startDay: string; onChange: (s: RepeatSpec) => void }) {
  const f = dateFacts(startWall);
  const ends = spec.count ? 'count' : spec.until ? 'until' : 'never';
  const monthModes: Option<NonNullable<RepeatSpec['monthly']>>[] = [
    { value: 'date', label: monthlyWords('date', startWall) },
    { value: 'nth', label: monthlyWords('nth', startWall) },
    ...(f.lastWeek ? [{ value: 'lastWeekday' as const, label: monthlyWords('lastWeekday', startWall) }] : []),
    ...(f.lastDay ? [{ value: 'last' as const, label: monthlyWords('last', startWall) }] : []),
  ];
  const endRow = (v: 'never' | 'until' | 'count', label: string, extra?: React.ReactNode) => (
    <div className={`rp-opt rp-end${ends === v ? ' on' : ''}`}>
      <button type="button" role="radio" aria-checked={ends === v} className="rp-end-pick" onClick={() => onChange({ ...spec, until: v === 'until' ? (spec.until ?? addMonths(startDay, 3)) : undefined, count: v === 'count' ? (spec.count ?? 10) : undefined })}>
        <span className="rp-radio" aria-hidden />
        <span className="rp-opt-text">{label}</span>
      </button>
      {ends === v && extra}
    </div>
  );
  return (
    <div className="rp-custom-page">
      <div className="rp-c-row">
        <span className="rp-c-label">{t('Every')}</span>
        <Stepper value={spec.interval} max={99} onChange={(interval) => onChange({ ...spec, interval })} label={t('How often')} />
        <Select<Freq>
          value={spec.freq}
          options={(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as Freq[]).map((x) => ({ value: x, label: unit(x, spec.interval) }))}
          onChange={(freq) => onChange({ freq, interval: spec.interval, until: spec.until, count: spec.count, ...(freq === 'WEEKLY' ? { days: [f.wd] } : freq === 'MONTHLY' ? { monthly: 'date' } : {}) })}
          label={t('Days, weeks, months or years')}
          title={t('Every')}
          className="sel-flat rp-unit"
          width={160}
        />
      </div>
      {spec.freq === 'WEEKLY' && (
        <div className="rp-c-block">
          <div className="rp-c-head">{t('On')}</div>
          <Days days={spec.days ?? [f.wd]} onChange={(days) => onChange({ ...spec, days })} />
        </div>
      )}
      {spec.freq === 'MONTHLY' && (
        <div className="rp-c-block">
          <Select value={spec.monthly ?? 'date'} options={monthModes} onChange={(monthly) => onChange({ ...spec, monthly })} label={t('Which day of the month')} title={t('Which day')} className="sel-flat" width={240} />
        </div>
      )}
      <div className="rp-c-block" role="radiogroup" aria-label={t('Ends')}>
        <div className="rp-c-head">{t('Ends')}</div>
        {endRow('never', t('Never'))}
        {endRow('until', t('On a date'), <DatePicker value={spec.until} onChange={(v) => v && onChange({ ...spec, until: v < startDay ? startDay : v })} clearable={false} label={t('Last day')} />)}
        {endRow(
          'count',
          t('After a number of times'),
          <span className="rp-count">
            <Stepper value={spec.count ?? 10} onChange={(count) => onChange({ ...spec, count })} label={t('How many times')} />
            <span className="rp-label">{tn(spec.count ?? 10, 'time', 'times')}</span>
          </span>,
        )}
      </div>
    </div>
  );
}
