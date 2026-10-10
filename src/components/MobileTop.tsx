import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bell, Check, ChevronDown, ChevronLeft, ChevronRight, FlaskConical, LayoutGrid, Loader2, Plus, Search, Settings } from 'lucide-react';
import type { Client, Person, Workspace } from '../types';
import { Avatar } from './Avatar';
import { WorkspaceLogo } from './WorkspaceLogo';
import { Badge } from './ui/Person';
import { isSandbox } from '../sandbox';
import { Sheet } from './ui/Sheet';
import { setTopTargets, type TitleMenu, type TopBarClaim } from '../mobile/chrome';
import { t, tn } from '../i18n';

export interface TopSettingsRow {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * The phone's top bar, one row on every screen (Teams' row): the company logo with your avatar on its corner (your
 * account, status and companies), the screen title (a switcher where the app has one, with the app's settings at its
 * bottom) and search. On a focused screen that has no Back of its own, Back takes the logo's place. An app can take
 * over the left button, the title, add actions or replace the whole row with <TopBar> (src/mobile/TopBar.tsx); a
 * <LargeTitle> in the page tucks the title away until it scrolls under the bar. The hairline under the bar shows only
 * once the content has scrolled under it.
 */
export function MobileTop({
  title,
  menu,
  settings = [],
  workspaces,
  current,
  unreadByWs = {},
  onWorkspace,
  onAddWorkspace,
  onSearch,
  back,
  onBell,
  unread = 0,
  portals = [],
  onPortal,
  onShared,
  currentPortal,
  account,
  demo,
  me,
  status,
  onSettings,
  claim,
  large,
}: {
  title: string;
  menu?: TitleMenu | null;
  settings?: TopSettingsRow[]; // this app's settings, at the bottom of the title switcher
  workspaces: Workspace[];
  current: Workspace;
  unreadByWs?: Record<string, number>; // unread mail per company
  onWorkspace: (id: string) => void;
  onAddWorkspace?: () => void; // none for guests: they can't add a company from a shared space
  onSearch: () => void;
  back?: () => void;
  onBell?: () => void; // the guest portal keeps its bell here; the team app's notifications are on Home
  unread?: number;
  portals?: { key: string; ws: Workspace; client: Client }[];
  onPortal?: (key: string) => void;
  onShared?: () => void; // everything shared with you, on one page
  currentPortal?: string; // the shared space on screen (the guest portal), ticked in the list
  account?: ReactNode; // the guest portal's own account button, at the end of the row
  demo?: { busy?: boolean; onOpen: () => void } | null; // their own demo company, not made yet
  me?: { person: Person & { color?: string }; onOpen: () => void }; // you: on the logo's corner, first row of the panel
  status?: { emoji?: string; text: string; run: () => void }; // your status, under you in the panel
  onSettings?: () => void; // last row of the panel
  claim?: TopBarClaim | null; // what the app on screen took over (<TopBar>)
  large?: { large: boolean; tucked: boolean }; // a large title in the page (<LargeTitle>)
}) {
  const [wsOpen, setWsOpen] = useState(false);
  const [titleOpen, setTitleOpen] = useState(false);
  useEffect(() => setWsOpen(false), [current.id]); // the demo company opened, or another company was picked
  const elsewhere = workspaces.some((w) => w.id !== current.id && (unreadByWs[w.id] ?? 0) > 0);
  const canSwitch = workspaces.length > 0 || portals.length > 0 || !!onAddWorkspace || !!demo || !!me; // "View as guest" has nothing to switch to
  const switches = !!menu || settings.length > 0;
  const shownTitle = (menu && menu.options.find((o) => o.value === menu.value)?.label) || title;
  const scrolled = useScrolledUnder();
  // Where an app's <TopBar> puts its parts (callback refs: they register as they mount and go).
  const lead = useCallback((el: HTMLElement | null) => setTopTargets({ lead: el }), []);
  const titleSlot = useCallback((el: HTMLElement | null) => setTopTargets({ title: el }), []);
  const actions = useCallback((el: HTMLElement | null) => setTopTargets({ actions: el }), []);
  const replace = useCallback((el: HTMLElement | null) => setTopTargets({ replace: el }), []);
  const tuck = large?.large ? (large.tucked ? ' tucked' : ' small') : '';
  const own = !!claim?.replace;
  return (
    <header className={`mobile-top${own ? ' own' : ''}${scrolled ? ' scrolled' : ''}`}>
      <span className="mt-slot mt-replace" ref={replace} />
      {!own && (
        <>
          <span className="mt-slot" ref={lead} />
          {claim?.lead ? null : back ? (
            <button className="mt-back" onClick={back} aria-label={t('Back')}>
              <ChevronLeft size={24} />
            </button>
          ) : (
            <button className="mt-ws" onClick={() => canSwitch && setWsOpen(true)} aria-haspopup="dialog" aria-label={elsewhere ? t('Workspace: {name}, new mail in another workspace', { name: current.name }) : t('Workspace: {name}', { name: current.name })}>
              <WorkspaceLogo ws={current} size={32} />
              {me && (
                <span className="mt-me" aria-hidden="true">
                  <Avatar person={me.person} size={16} />
                </span>
              )}
              {elsewhere && <i className="mt-ws-dot" />}
            </button>
          )}
          <span className="mt-slot" ref={titleSlot} />
          {claim?.title ? null : switches && !large?.large ? (
            <button type="button" className={`mt-title${titleOpen ? ' open' : ''}`} onClick={() => setTitleOpen(true)} aria-haspopup="dialog" aria-label={menu ? `${menu.label}: ${shownTitle}` : t('{title}: settings', { title })}>
              <span className="mt-title-text">{shownTitle}</span>
              <ChevronDown size={16} className="mt-chev" />
            </button>
          ) : (
            <h1 className={`mt-title plain${tuck}`} aria-hidden={large?.tucked || undefined}>
              <span className="mt-title-text">{shownTitle}</span>
            </h1>
          )}
          {titleOpen && <TitleSheet title={title} menu={menu ?? null} settings={settings} onClose={() => setTitleOpen(false)} />}

          <span className="spacer" />
          <span className="mt-slot" ref={actions} />
          {claim?.search !== false && (
            <button className="icon-btn mt-search" onClick={onSearch} aria-label={t('Search {title}', { title })}>
              <Search size={22} />
            </button>
          )}
          {onBell && (
            <button className="icon-btn mt-bell" onClick={onBell} aria-label={t('Notifications')}>
              <Bell size={20} />
              {unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
            </button>
          )}
          {account}
        </>
      )}
      {wsOpen && (
        <CompanySheet
          onClose={() => setWsOpen(false)}
          {...{ workspaces, current, unreadByWs, onWorkspace, onAddWorkspace, portals, onPortal, onShared, currentPortal, demo, me, status, onSettings }}
        />
      )}
    </header>
  );
}

/**
 * Who you are and where you are (Teams' account panel, in our bottom sheet): you, your status, your companies with a
 * tick on the one on screen, shared spaces, Add a company, Settings.
 */
export function CompanySheet({
  onClose,
  workspaces,
  current,
  unreadByWs = {},
  onWorkspace,
  onAddWorkspace,
  portals = [],
  onPortal,
  onShared,
  currentPortal,
  demo,
  me,
  status,
  onSettings,
}: {
  onClose: () => void;
  workspaces: Workspace[];
  current: Workspace;
  unreadByWs?: Record<string, number>;
  onWorkspace: (id: string) => void;
  onAddWorkspace?: () => void;
  portals?: { key: string; ws: Workspace; client: Client }[];
  onPortal?: (key: string) => void;
  onShared?: () => void;
  currentPortal?: string;
  demo?: { busy?: boolean; onOpen: () => void } | null;
  me?: { person: Person & { color?: string }; onOpen: () => void };
  status?: { emoji?: string; text: string; run: () => void };
  onSettings?: () => void;
}) {
  return (
    <Sheet onClose={onClose} label={t('Your account and companies')} className="ws-sheet" size={workspaces.length + portals.length > 5 ? 'tall' : 'auto'}>
      <div className="as-list ws-panel">
        {me && (
          <button type="button" className="as-item ws-you" onClick={() => (onClose(), me.onOpen())}>
            <Avatar person={me.person} size={40} />
            <span className="as-label">
              <span className="ws-you-name">{me.person.name}</span>
              <small>{me.person.email}</small>
            </span>
            <ChevronRight size={18} className="as-chev" />
          </button>
        )}
        {status && (
          <button type="button" className="as-item ws-status" onClick={() => (onClose(), status.run())}>
            <span className="ws-status-icon">{status.emoji ? <span className="st-emoji">{status.emoji}</span> : <i className="ws-presence" />}</span>
            <span className="as-label">{status.text}</span>
          </button>
        )}
        {(me || status) && <div className="as-sep" />}
        <div className="as-group">{t('Companies')}</div>
        {workspaces.map((w) => {
          const n = unreadByWs[w.id] ?? 0;
          const on = w.id === current.id && !currentPortal;
          return (
            <button key={w.id} type="button" className={`as-item ws-row${on ? ' on' : ''}`} aria-current={on || undefined} onClick={() => (onWorkspace(w.id), onClose())}>
              <span className="ws-logo">
                <WorkspaceLogo ws={w} size={32} />
              </span>
              <span className="as-label">
                <span className="ws-name-line">
                  {isSandbox(w) ? t('Demo company') : w.name}
                  {isSandbox(w) && (
                    <Badge tone="info" small>
                      {t('Demo')}
                    </Badge>
                  )}
                </span>
                <small>{isSandbox(w) ? t('Your own copy to try things in') : (w.domains[0] ?? '')}</small>
              </span>
              {n > 0 && (
                <b className="ws-unread" aria-label={tn(n, '{n} unread', '{n} unread')}>
                  {n > 99 ? '99+' : n}
                </b>
              )}
              {on && <Check size={20} className="ws-check" aria-label={t('Current')} />}
            </button>
          );
        })}
        {demo && (
          <button type="button" className="as-item ws-row" onClick={demo.onOpen} disabled={demo.busy}>
            <span className="ws-logo ws-demo-icon">{demo.busy ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}</span>
            <span className="as-label">
              <span className="ws-name-line">
                {demo.busy ? t('Making your demo company…') : t('Demo company')}
                <Badge tone="info" small>
                  {t('Demo')}
                </Badge>
              </span>
              <small>{t('A sample agency to try everything in, just for you')}</small>
            </span>
          </button>
        )}
        {(portals.length > 0 || onShared) && <div className="as-group">{t('Shared with you')}</div>}
        {onShared && (
          <button type="button" className="as-item ws-row" onClick={() => (onShared(), onClose())}>
            <span className="ws-logo ws-plain-icon">
              <LayoutGrid size={18} />
            </span>
            <span className="as-label">
              {t('See everything shared with you')}
              <small>{tn(portals.length, '{n} shared space', '{n} shared spaces')}</small>
            </span>
          </button>
        )}
        {portals.map((pt) => (
          <button key={pt.key} type="button" className={`as-item ws-row${pt.key === currentPortal ? ' on' : ''}`} onClick={() => (onPortal?.(pt.key), onClose())}>
            <span className="ws-logo">
              <WorkspaceLogo ws={pt.ws} size={32} />
            </span>
            <span className="as-label">
              {pt.ws.name}
              <small>{t('Shared space · {name}', { name: pt.client.name })}</small>
            </span>
            {pt.key === currentPortal && <Check size={20} className="ws-check" aria-label={t('Current')} />}
          </button>
        ))}
        {onAddWorkspace && (
          <button type="button" className="as-item ws-row" onClick={() => (onAddWorkspace(), onClose())}>
            <span className="ws-logo ws-add-icon">
              <Plus size={20} />
            </span>
            <span className="as-label">{t('Add a company')}</span>
          </button>
        )}
        {onSettings && (
          <>
            <div className="as-sep" />
            <button type="button" className="as-item ws-settings" onClick={() => (onClose(), onSettings())}>
              <Settings size={20} className="as-icon" />
              <span className="as-label">{t('Settings')}</span>
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** True once whatever scrolls on the screen has moved under the top bar (for its hairline). */
function useScrolledUnder() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const check = (e: Event) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || !el.closest('.main') || el.closest('.sheet, .push-screen, .pop, .modal')) return;
      const next = el.scrollTop > 2;
      setOn((was) => (was === next ? was : next));
    };
    document.addEventListener('scroll', check, true);
    return () => document.removeEventListener('scroll', check, true);
  }, []);
  return on;
}

/** The title switcher: the app's places (mailboxes, scopes…), then its settings. */
function TitleSheet({ title, menu, settings, onClose }: { title: string; menu: TitleMenu | null; settings: TopSettingsRow[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const many = (menu?.options.length ?? 0) > 10;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = menu?.options ?? [];
    return s ? all.filter((o) => s.split(/\s+/).every((w) => `${o.label} ${o.hint ?? ''} ${o.keywords ?? ''} ${o.group ?? ''}`.toLowerCase().includes(w))) : all;
  }, [menu, q]);
  let lastGroup: string | undefined;
  return (
    <Sheet onClose={onClose} title={menu?.label ?? title} size={many ? 'tall' : 'auto'} className="title-sheet">
      {many && (
        <label className="sheet-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find…')} aria-label={t('Find in {place}', { place: menu?.label ?? title })} />
        </label>
      )}
      {menu && (
        <div className="as-list" role="listbox" aria-label={menu.label}>
          {shown.length === 0 && <p className="sheet-empty">{t('Nothing called “{q}”', { q })}</p>}
          {shown.map((o) => {
            const head = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={o.value} role="presentation">
                {head && <div className="as-group">{head}</div>}
                <button type="button" role="option" aria-selected={o.value === menu.value} className={`as-item${o.value === menu.value ? ' on' : ''}`} onClick={() => (onClose(), menu.onChange(o.value))}>
                  {o.icon && <span className="as-icon">{o.icon}</span>}
                  <span className="as-label">
                    <span className="more-ellipsis">{o.label}</span>
                    {o.hint && <small>{o.hint}</small>}
                  </span>
                  {o.value === menu.value && <Check size={16} className="as-check" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {settings.length > 0 && !q && (
        <>
          {menu && <div className="as-sep" />}
          <div className="as-list">
            {settings.map((s) => (
              <button key={s.id} type="button" className="as-item" onClick={() => (onClose(), s.run())}>
                <Settings size={18} className="as-icon" />
                <span className="as-label">
                  {s.label}
                  {s.hint && <small>{s.hint}</small>}
                </span>
                <ChevronRight size={16} className="as-icon" />
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
