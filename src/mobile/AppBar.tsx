import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLongPress } from '../components/ui/useLongPress';
import { ActionSheet } from '../components/ui/ActionSheet';
import type { AppSections, CreateAction } from './chrome';
import { tn } from '../i18n';

const count = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * An app's own bottom bar on phones (research/launcher/plan.md, section 3; Gmail's and Zoho's in-app bar): the app's
 * two to four sections, always labelled, a pill behind the selected icon that slides between them, a red count where
 * something is for you. Other apps are on the launcher, not here. The bar steps aside on focused screens and while the
 * keyboard is open (the `.bar-away` class on <html>, set by App). The app's create button floats above it (<CreateFab>).
 * Tapping the selected section again scrolls to the top, then goes back to the section's root.
 */
export function AppBar({ bar, label }: { bar: AppSections; label: string }) {
  const { sections, current } = bar;
  const at = sections.findIndex((s) => s.id === current);
  return (
    <nav className="tabbar app-bar" aria-label={label}>
      <div className="tabbar-tabs" style={{ '--tabs': sections.length, '--at': at } as CSSProperties}>
        <span className={`tabbar-ink${at < 0 ? ' off' : ''}`} aria-hidden="true">
          <i />
        </span>
        {sections.map(({ id, label: name, icon: Icon, badge, run }) => {
          const on = current === id;
          return (
            <button key={id} type="button" className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => (run ? run() : on ? reselect(bar, id) : bar.onChange(id))}>
              <span className="tab-icon">
                <Icon size={24} strokeWidth={on ? 2.25 : 1.75} />
                {badge ? <i aria-label={tn(badge, '{n} new', '{n} new')}>{count(badge)}</i> : null}
              </span>
              <span className="tab-label">{name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** The selected section tapped again: to the top of its list first; already there, back to the section's root. */
function reselect(bar: AppSections, id: string) {
  const list = [...document.querySelectorAll<HTMLElement>('.main *')].find((el) => el.scrollTop > 0 && el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible');
  if (list) return list.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  bar.onReselect?.(id);
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
