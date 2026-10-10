import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useLongPress } from '../components/ui/useLongPress';
import { ActionSheet } from '../components/ui/ActionSheet';
import type { CreateAction } from './chrome';
import { t, tn } from '../i18n';

export interface BarApp {
  id: string;
  name: string;
  icon: LucideIcon;
  badge?: number;
  dot?: boolean; // something new without a number (Home: new in Needs you since you last looked)
}

const count = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * The phone's bottom bar (Teams' plain full-width bar with Gmail's selected pill): four apps and More, always
 * labelled, a pill behind the selected icon that slides between tabs. Long-press the bar to edit it. The bar steps
 * aside on focused screens and while the keyboard is open (the `.bar-away` class on <html>, set by App). The app's
 * create button floats above it (<CreateFab>).
 */
export function BottomBar({ apps, current, moreOn, onApp, onMore, onEdit }: { apps: BarApp[]; current: string; moreOn: boolean; onApp: (id: string) => void; onMore: () => void; onEdit: () => void }) {
  const edit = useLongPress(() => onEdit());
  const at = moreOn ? apps.length : apps.findIndex((a) => a.id === current);
  return (
    <nav className="tabbar" aria-label={t('Apps')}>
      <div className="tabbar-tabs lp" {...edit} style={{ '--tabs': apps.length + 1, '--at': at } as CSSProperties}>
        <span className={`tabbar-ink${at < 0 ? ' off' : ''}`} aria-hidden="true">
          <i />
        </span>
        {apps.map(({ id, name, icon: AppIcon, badge, dot }) => (
          <button key={id} type="button" className={current === id && !moreOn ? 'on' : ''} aria-current={current === id && !moreOn ? 'page' : undefined} onClick={() => onApp(id)}>
            <span className="tab-icon">
              <AppIcon size={24} strokeWidth={current === id && !moreOn ? 2.25 : 1.75} />
              {badge ? <i aria-label={tn(badge, '{n} new', '{n} new')}>{count(badge)}</i> : dot ? <i className="dot" aria-label={t('New')} /> : null}
            </span>
            <span className="tab-label">{name}</span>
          </button>
        ))}
        <button type="button" className={moreOn ? 'on' : ''} onClick={onMore} aria-haspopup="dialog" aria-expanded={moreOn}>
          <span className="tab-icon">
            <MoreHorizontal size={24} strokeWidth={moreOn ? 2.25 : 1.75} />
          </span>
          <span className="tab-label">{t('More')}</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * The app's create button, floating 16 px above the bar at the right (Gmail's Compose, Teams' compose). Round with the
 * icon; `extended` adds the label and shrinks back to the round form while a list scrolls down. Long-press (or
 * right-click) for the app's other create actions. It scales away on focused screens, with the keyboard, while More
 * is open and when the app hides it.
 */
export function CreateFab({ create, off }: { create: CreateAction | null; off?: boolean }) {
  // The last action stays drawn while the button scales away, so it doesn't change icon on its way out.
  const last = useRef<CreateAction | null>(create);
  if (create) last.current = create;
  const shown = create ?? last.current;
  const [more, setMore] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const hold = useLongPress(() => create?.more?.length && setMore(true));
  const visible = !!create && !create.hidden && !off;
  const small = useShrinkOnScroll(!!create?.extended && visible);
  // Toasts and docked things make room for it (src/mobile/shell.css, `.has-fab`).
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains('has-fab') !== visible) root.classList.toggle('has-fab', visible);
  }, [visible]);
  useEffect(() => () => document.documentElement.classList.remove('has-fab'), []);
  const Icon = shown?.icon;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`fab lp${visible ? ' on' : ''}${shown?.extended ? ' extended' : ''}${small ? ' small' : ''}`}
        onClick={() => create?.run()}
        aria-label={shown?.label}
        title={shown?.label}
        tabIndex={visible ? 0 : -1}
        aria-hidden={!visible}
        {...hold}
        onContextMenu={(e) => {
          hold.onContextMenu(e);
          if (create?.more?.length) (e.preventDefault(), setMore(true));
        }}
      >
        {Icon && <Icon size={24} />}
        {shown?.extended && <span className="fab-label">{shown.label}</span>}
      </button>
      {create?.more && <ActionSheet open={more} onClose={() => setMore(false)} title={create.label} anchor={btn} actions={[{ label: create.label, icon: create.icon, run: create.run }, ...create.more]} />}
    </>
  );
}

/** Gmail: the extended button shrinks while the list scrolls down and grows back on the way up or at the top. */
function useShrinkOnScroll(on: boolean) {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (!on) return void setSmall(false);
    const last = new WeakMap<EventTarget, number>();
    const onScroll = (e: Event) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || !el.closest('.main')) return;
      const y = el.scrollTop;
      const before = last.get(el) ?? 0;
      if (Math.abs(y - before) < 8 && y > 8) return;
      last.set(el, y);
      const next = y > 8 && y > before;
      setSmall((was) => (was === next ? was : next));
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [on]);
  return small;
}
