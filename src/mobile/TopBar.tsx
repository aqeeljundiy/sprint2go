import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import { t } from '../i18n';
import type { AppId } from '../types';
import { useLargeTitleClaim, useTopBarClaim, useTopTargets } from './chrome';

/**
 * An app takes over parts of the phone's top bar (docs/mobile-kit.md, section 3). Render it anywhere in the app's own
 * tree, before or after an early return; what it holds stays live with the app's state. Parts left out keep the
 * shell's default (the company logo with your avatar, the app's name, search).
 *
 *   <TopBar app="calendar" lead={<TopBarButton icon={Menu} label={t('Menu')} onClick={openDrawer} />} title={<MonthButton />} actions={<TodayButton />} />
 *   <TopBar app="mail" replace={<MailSearchPill />} />            the whole row is the app's (Gmail's search pill)
 *   <TopBar app="tasks" lead={<TopBarBack label={t('Tasks')} onClick={toBrowse} />} />
 *
 * Nothing on desktop: the bar is phones only.
 */
export function TopBar({ app, lead, title, actions, search = true, replace }: { app: AppId; lead?: ReactNode; title?: ReactNode; actions?: ReactNode; search?: boolean; replace?: ReactNode }) {
  useTopBarClaim(app, { lead: lead !== undefined, title: title !== undefined, actions: actions !== undefined, search, replace: replace !== undefined });
  const to = useTopTargets();
  return (
    <>
      {replace !== undefined && to.replace && createPortal(replace, to.replace)}
      {replace === undefined && lead !== undefined && to.lead && createPortal(lead, to.lead)}
      {replace === undefined && title !== undefined && to.title && createPortal(title, to.title)}
      {replace === undefined && actions !== undefined && to.actions && createPortal(actions, to.actions)}
    </>
  );
}

/** A 44 px icon button for the bar's left slot or its actions (☰, Today, a filter). */
export function TopBarButton({ icon: Icon, label, onClick, className = '' }: { icon: LucideIcon; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`icon-btn mt-btn ${className}`} onClick={onClick} aria-label={label} title={label}>
      <Icon size={22} />
    </button>
  );
}

/** Back in the bar's left slot: the chevron alone, or with the screen it goes back to ("‹ Tasks"). */
export function TopBarBack({ label, onClick }: { label?: string; onClick: () => void }) {
  return (
    <button type="button" className={`mt-back${label ? ' named' : ''}`} onClick={onClick} aria-label={label ? t('Back to {screen}', { screen: label }) : t('Back')}>
      <ChevronLeft size={24} />
      {label && <span>{label}</span>}
    </button>
  );
}

/**
 * A large title in the page (Apple's 34 pt title, Home's greeting, a Tasks list's name). While it's on screen the bar's
 * own title is tucked away; once it scrolls under the bar, `title` fades into the bar (17 px).
 */
export function LargeTitle({ app, children, className = '' }: { app: AppId; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ tucked: true, subs: new Set<() => void>() });
  useLargeTitleClaim(
    app,
    () => state.current.tucked,
    (f) => (state.current.subs.add(f), () => void state.current.subs.delete(f)),
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // The bar covers the top of the screen: the title counts as gone once its lower half is under the bar.
    const bar = document.querySelector('.mobile-top')?.getBoundingClientRect().bottom ?? 56;
    const io = new IntersectionObserver(
      ([e]) => {
        const tucked = e.isIntersecting;
        if (tucked === state.current.tucked) return;
        state.current.tucked = tucked;
        state.current.subs.forEach((f) => f());
      },
      { rootMargin: `-${Math.round(bar)}px 0px 0px 0px`, threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`large-title ${className}`}>
      {children}
    </div>
  );
}
