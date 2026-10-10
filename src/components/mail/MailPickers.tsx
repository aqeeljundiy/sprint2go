import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, CalendarDays, Check, ChevronDown, Clock, Coffee, Moon, Search, Send, Sun, UserX } from 'lucide-react';
import type { User } from '../../types';
import { Sheet } from '../ui/Sheet';
import { Popover } from '../ui/Popover';
import { DatePicker, TimePicker } from '../ui/DatePicker';
import { SmoothHeight } from '../ui/Smooth';
import { Avatar } from '../Avatar';
import { usePhone } from '../../mobile/media';
import { snoozePresets, whenWords } from '../../mailRules';
import { localDay } from '../../utils';
import { mark, t, tn } from '../../i18n';

/**
 * A short pick next to what was tapped: a bottom sheet on phones, a menu by the button on desktop (a centred panel when
 * there's no button to sit by, e.g. after a swipe).
 */
function PickPanel({ open, onClose, anchor, title, width = 300, className = '', children }: { open: boolean; onClose: () => void; anchor?: RefObject<HTMLElement | null>; title: string; width?: number; className?: string; children: ReactNode }) {
  const phone = usePhone();
  if (!open) return null;
  if (phone || !anchor)
    return (
      <Sheet onClose={onClose} title={title} className={`mail-pick ${className}`}>
        {children}
      </Sheet>
    );
  return (
    <Popover anchor={anchor} open onClose={onClose} width={width} title={title} align="end">
      <div className={`mail-pick in-pop ${className}`}>
        <div className="mp-title">{title}</div>
        {children}
      </div>
    </Popover>
  );
}

/** A date and a time picked with our own pickers; only the future counts. */
function useCustomTime(hours = 9) {
  const [day, setDay] = useState(() => localDay(new Date(Date.now() + 86_400_000)));
  const [time, setTime] = useState(`${String(hours).padStart(2, '0')}:00`);
  const at = useMemo(() => new Date(`${day}T${time}`), [day, time]);
  return { day, setDay, time, setTime, at, ok: Number.isFinite(at.getTime()) && at.getTime() > Date.now() + 60_000 };
}

const PRESET_ICON: Record<string, typeof Clock> = { later: Clock, evening: Moon, tomorrow: Sun, weekend: Coffee, week: CalendarDays };

/**
 * Snooze: the presets with their exact times, "Pick a date and time", and "Only if no reply" (on by default when we
 * wrote last and are waiting on them).
 */
export function SnoozePicker({ open, onClose, anchor, onPick, waiting = false, count = 1 }: { open: boolean; onClose: () => void; anchor?: RefObject<HTMLElement | null>; onPick: (until: string, ifNoReply: boolean) => void; waiting?: boolean; count?: number }) {
  const [noReply, setNoReply] = useState(waiting);
  const [custom, setCustom] = useState(false);
  const pick = useCustomTime();
  const presets = useMemo(() => snoozePresets(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (d: Date) => (onClose(), onPick(d.toISOString(), noReply));
  const phone = usePhone();
  if (phone) return <SnoozeDialog open={open} onClose={onClose} presets={presets} done={done} pick={pick} custom={custom} setCustom={setCustom} noReply={noReply} setNoReply={setNoReply} waiting={waiting} count={count} />;
  return (
    <PickPanel open={open} onClose={onClose} anchor={anchor} title={count > 1 ? tn(count, 'Snooze {n} email until', 'Snooze {n} emails until') : t('Snooze until')} className="snooze-pick">
      <div className="as-list" role="menu">
        {presets.map((p) => {
          const Icon = PRESET_ICON[p.id] ?? Clock;
          return (
            <button key={p.id} type="button" role="menuitem" className="as-item" onClick={() => done(p.at)}>
              <Icon size={18} className="as-icon" />
              <span className="as-label">
                {t(p.label)}
                <small>{whenWords(p.at)}</small>
              </span>
            </button>
          );
        })}
        <button type="button" className={`as-item${custom ? ' on' : ''}`} aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
          <CalendarClock size={18} className="as-icon" />
          <span className="as-label">{t('Pick a date and time')}</span>
          <ChevronDown size={16} className={`as-icon rot-chev${custom ? ' open' : ''}`} />
        </button>
      </div>
      <SmoothHeight>
        {custom && (
          <div className="mp-custom">
            <DatePicker value={pick.day} onChange={pick.setDay} clearable={false} label={t('Day')} />
            <TimePicker value={pick.time} onChange={pick.setTime} />
            <button type="button" className="primary-btn" disabled={!pick.ok} onClick={() => done(pick.at)} title={pick.ok ? undefined : t('Pick a time in the future')}>
              {t('Snooze')}
            </button>
          </div>
        )}
      </SmoothHeight>
      <div className="mp-toggle">
        <span>
          <strong>{t('Only if no reply')}</strong>
          <small>{noReply ? t('It stays away if anyone writes in this conversation before then.') : t('It comes back at that time either way.')}</small>
        </span>
        <button type="button" role="switch" aria-checked={noReply} aria-label={t('Only if no reply')} className={`switch ${noReply ? 'on' : ''}`} onClick={() => setNoReply((v) => !v)}>
          <span />
        </button>
      </div>
    </PickPanel>
  );
}

/**
 * Snooze on phones: Gmail's centred dialog of tiles (Later today, Tomorrow, This weekend, Next week), then Pick a date
 * and time; "Only if nobody replies" when we wrote last and are waiting on them.
 */
function SnoozeDialog(p: {
  open: boolean;
  onClose: () => void;
  presets: ReturnType<typeof snoozePresets>;
  done: (d: Date) => void;
  pick: ReturnType<typeof useCustomTime>;
  custom: boolean;
  setCustom: (f: (c: boolean) => boolean) => void;
  noReply: boolean;
  setNoReply: (f: (v: boolean) => boolean) => void;
  waiting: boolean;
  count: number;
}) {
  useEffect(() => {
    if (!p.open) return;
    // Escape closes the dialog only (caught first, so the screen under it doesn't go back too).
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.pop:not(.is-leaving)')) return;
      e.stopPropagation();
      p.onClose();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p.open) return null;
  // Gmail's four: "This evening" only stands in for "Later today" when that's gone.
  const tiles = p.presets.filter((x) => x.id !== 'evening' || !p.presets.some((y) => y.id === 'later')).slice(0, 4);
  return createPortal(
    <div className="gm-dialog-scrim" onMouseDown={p.onClose}>
      <div className="gm-dialog gm-snooze" role="dialog" aria-label={p.count > 1 ? tn(p.count, 'Snooze {n} email until', 'Snooze {n} emails until') : t('Snooze until')} onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="gm-dialog-title">{p.count > 1 ? tn(p.count, 'Snooze {n} email until', 'Snooze {n} emails until') : t('Snooze until')}</h2>
        <div className="gm-tiles">
          {tiles.map((x) => {
            const Icon = PRESET_ICON[x.id] ?? Clock;
            return (
              <button key={x.id} type="button" className="gm-tile" onClick={() => p.done(x.at)}>
                <Icon size={28} />
                <b>{t(x.label)}</b>
                <small>{whenWords(x.at)}</small>
              </button>
            );
          })}
        </div>
        <button type="button" className={`gm-tile gm-tile-wide${p.custom ? ' on' : ''}`} aria-expanded={p.custom} onClick={() => p.setCustom((c) => !c)}>
          <CalendarClock size={24} />
          <b>{t('Pick date and time')}</b>
          <ChevronDown size={18} className={`rot-chev${p.custom ? ' open' : ''}`} />
        </button>
        <SmoothHeight>
          {p.custom && (
            <div className="mp-custom">
              <DatePicker value={p.pick.day} onChange={p.pick.setDay} clearable={false} label={t('Day')} />
              <TimePicker value={p.pick.time} onChange={p.pick.setTime} />
              <button type="button" className="primary-btn" disabled={!p.pick.ok} onClick={() => p.done(p.pick.at)} title={p.pick.ok ? undefined : t('Pick a time in the future')}>
                {t('Snooze')}
              </button>
            </div>
          )}
        </SmoothHeight>
        {p.waiting && (
          <div className="mp-toggle gm-noreply">
            <span>
              <strong>{t('Only if nobody replies')}</strong>
              <small>{p.noReply ? t('It stays away if anyone writes in this conversation before then.') : t('It comes back at that time either way.')}</small>
            </span>
            <button type="button" role="switch" aria-checked={p.noReply} aria-label={t('Only if nobody replies')} className={`switch ${p.noReply ? 'on' : ''}`} onClick={() => p.setNoReply((v) => !v)}>
              <span />
            </button>
          </div>
        )}
        <div className="gm-dialog-foot">
          <button type="button" className="ghost-btn" onClick={p.onClose}>
            {t('Cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export type PresenceOf = (id: string) => 'active' | 'away' | 'meeting';

/** Who handles this email: Unassigned and Me first, then the others with the mailbox, with who's around. */
export function AssignPicker({ open, onClose, anchor, people, me, current, presence, onPick }: { open: boolean; onClose: () => void; anchor?: RefObject<HTMLElement | null>; people: User[]; me: User; current?: string; presence?: PresenceOf; onPick: (userId: string) => void }) {
  const [q, setQ] = useState('');
  const others = useMemo(() => people.filter((u) => u.id !== me.id).sort((a, b) => a.name.localeCompare(b.name)), [people, me.id]);
  const s = q.trim().toLowerCase();
  const shown = s ? others.filter((u) => `${u.name} ${u.email} ${u.title ?? ''}`.toLowerCase().includes(s)) : others;
  const pick = (id: string) => (onClose(), onPick(id));
  const away = (id: string) => (presence?.(id) === 'meeting' ? t('In a meeting') : presence?.(id) === 'away' ? t('Away') : undefined);
  const row = (u: User, label: string, hint?: string) => (
    <button key={u.id} type="button" role="option" aria-selected={current === u.id} className={`as-item${current === u.id ? ' on' : ''}`} onClick={() => pick(u.id)}>
      <span className="dm-av">
        <Avatar person={u} size={28} />
        {presence && <i className={`presence ${presence(u.id)}`} />}
      </span>
      <span className="as-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {current === u.id && <Check size={16} className="as-check" />}
    </button>
  );
  return (
    <PickPanel open={open} onClose={onClose} anchor={anchor} title={t('Who handles this')} width={280} className="assign-pick">
      {others.length > 6 && (
        <label className="sheet-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find someone')} aria-label={t('Find someone')} />
        </label>
      )}
      <div className="as-list" role="listbox" aria-label={t('Who handles this')}>
        {!s && (
          <>
            <button type="button" role="option" aria-selected={!current} className={`as-item${!current ? ' on' : ''}`} onClick={() => pick('')}>
              <UserX size={18} className="as-icon mp-none" />
              <span className="as-label">
                {t('Unassigned')}
                <small>{t('Anyone with this inbox can take it')}</small>
              </span>
              {!current && <Check size={16} className="as-check" />}
            </button>
            {row(me, t('Me'), t('You handle it'))}
            {others.length > 0 && <div className="as-sep" />}
          </>
        )}
        {shown.map((u) => row(u, u.name, away(u.id) ?? u.title))}
        {s && !shown.length && <p className="sheet-empty">{t('Nobody called “{name}” has this inbox', { name: q })}</p>}
      </div>
    </PickPanel>
  );
}

/** Send later: tonight, tomorrow morning, Monday, or a date and time. */
export function SendLaterPicker({ open, onClose, anchor, onPick }: { open: boolean; onClose: () => void; anchor?: RefObject<HTMLElement | null>; onPick: (at: string) => void }) {
  const [custom, setCustom] = useState(false);
  const pick = useCustomTime(8);
  const options = useMemo(() => {
    const now = new Date();
    const at = (days: number, h: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      d.setHours(h, 0, 0, 0);
      return d;
    };
    const out: { id: string; label: string; at: Date }[] = [];
    if (now.getHours() < 20) out.push({ id: 'tonight', label: mark('Tonight'), at: at(0, 21) });
    out.push({ id: 'morning', label: mark('Tomorrow morning'), at: at(1, 8) });
    if (![5, 6, 0].includes(now.getDay())) out.push({ id: 'afternoon', label: mark('Tomorrow afternoon'), at: at(1, 13) });
    out.push({ id: 'monday', label: mark('Monday morning'), at: at(((8 - now.getDay()) % 7) || 7, 8) });
    return out;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (d: Date) => (onClose(), onPick(d.toISOString()));
  return (
    <PickPanel open={open} onClose={onClose} anchor={anchor} title={t('Send later')} className="later-pick">
      <div className="as-list" role="menu">
        {options.map((o) => (
          <button key={o.id} type="button" role="menuitem" className="as-item" onClick={() => done(o.at)}>
            <Send size={18} className="as-icon" />
            <span className="as-label">
              {t(o.label)}
              <small>{whenWords(o.at)}</small>
            </span>
          </button>
        ))}
        <button type="button" className={`as-item${custom ? ' on' : ''}`} aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
          <CalendarClock size={18} className="as-icon" />
          <span className="as-label">{t('Pick a date and time')}</span>
          <ChevronDown size={16} className={`as-icon rot-chev${custom ? ' open' : ''}`} />
        </button>
      </div>
      <SmoothHeight>
        {custom && (
          <div className="mp-custom">
            <DatePicker value={pick.day} onChange={pick.setDay} clearable={false} label={t('Day')} />
            <TimePicker value={pick.time} onChange={pick.setTime} />
            <button type="button" className="primary-btn" disabled={!pick.ok} onClick={() => done(pick.at)} title={pick.ok ? undefined : t('Pick a time in the future')}>
              {t('Schedule')}
            </button>
          </div>
        )}
      </SmoothHeight>
    </PickPanel>
  );
}
