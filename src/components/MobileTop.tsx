import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bell, Check, ChevronDown, ChevronLeft, ChevronRight, FlaskConical, LayoutGrid, Loader2, Search, Settings } from 'lucide-react';
import type { Client, Workspace } from '../types';
import { WorkspaceLogo } from './WorkspaceLogo';
import { Badge } from './ui/Person';
import { isSandbox } from '../sandbox';
import { Popover } from './ui/Popover';
import { Sheet } from './ui/Sheet';
import type { TitleMenu } from '../mobile/chrome';
import { t, tn } from '../i18n';

export interface TopSettingsRow {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * The phone's top bar, one row on every screen: the company (a switcher, with unread mail per company), the screen
 * title (a switcher where the app has one, with the app's settings at its bottom) and search. On a focused screen
 * that has no Back of its own, Back takes the company's place. Replaces the ☰ drawers.
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
  onBell?: () => void; // the guest portal keeps its bell here; the team app's notifications are in More and Home
  unread?: number;
  portals?: { key: string; ws: Workspace; client: Client }[];
  onPortal?: (key: string) => void;
  onShared?: () => void; // everything shared with you, on one page
  currentPortal?: string; // the shared space on screen (the guest portal), ticked in the list
  account?: ReactNode; // the guest portal's own account button, at the end of the row
  demo?: { busy?: boolean; onOpen: () => void } | null; // their own demo company, not made yet
}) {
  const wsBtn = useRef<HTMLButtonElement>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [titleOpen, setTitleOpen] = useState(false);
  useEffect(() => setWsOpen(false), [current.id]); // the demo company opened, or another company was picked
  const elsewhere = workspaces.some((w) => w.id !== current.id && (unreadByWs[w.id] ?? 0) > 0);
  const canSwitch = workspaces.length > 0 || portals.length > 0 || !!onAddWorkspace || !!demo; // "View as guest" has nothing to switch to
  const switches = !!menu || settings.length > 0;
  const shownTitle = (menu && menu.options.find((o) => o.value === menu.value)?.label) || title;
  return (
    <header className="mobile-top">
      {back ? (
        <button className="mt-back" onClick={back} aria-label={t('Back')}>
          <ChevronLeft size={24} />
        </button>
      ) : (
        <button ref={wsBtn} className="mt-ws" onClick={() => canSwitch && setWsOpen(true)} aria-label={elsewhere ? t('Workspace: {name}, new mail in another workspace', { name: current.name }) : t('Workspace: {name}', { name: current.name })}>
          <WorkspaceLogo ws={current} size={30} />
          {elsewhere && <i className="mt-ws-dot" />}
        </button>
      )}
      <Popover anchor={wsBtn} open={wsOpen} onClose={() => setWsOpen(false)} title={t('Workspaces')}>
        <div className="sel-pop">
          {workspaces.map((w) => (
            <button key={w.id} className="sel-opt" aria-selected={w.id === current.id} onClick={() => (onWorkspace(w.id), setWsOpen(false))}>
              <span className="sel-icon">
                <WorkspaceLogo ws={w} size={24} />
              </span>
              <span className="sel-label">
                <span className="ws-name-line">
                  {w.name}
                  {isSandbox(w) && (
                    <Badge tone="info" small>
                      {t('Demo')}
                    </Badge>
                  )}
                </span>
                <small>{isSandbox(w) ? t('Your own copy to try things in') : (w.domains[0] ?? '')}</small>
              </span>
              {(unreadByWs[w.id] ?? 0) > 0 && (
                <b className="ws-unread" aria-label={tn(unreadByWs[w.id], '{n} unread', '{n} unread')}>
                  {unreadByWs[w.id] > 99 ? '99+' : unreadByWs[w.id]}
                </b>
              )}
            </button>
          ))}
          {demo && (
            <button className="sel-opt" onClick={demo.onOpen} disabled={demo.busy}>
              <span className="sel-icon ws-demo-icon">{demo.busy ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}</span>
              <span className="sel-label">
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
          {portals.length > 0 && <div className="sel-group">{t('Shared with you')}</div>}
          {onShared && (
            <button className="sel-opt" onClick={() => (onShared(), setWsOpen(false))}>
              <span className="sel-icon">
                <LayoutGrid size={18} />
              </span>
              <span className="sel-label">
                {t('See everything shared with you')}
                <small>{tn(portals.length, '{n} shared space', '{n} shared spaces')}</small>
              </span>
            </button>
          )}
          {portals.map((pt) => (
            <button key={pt.key} className="sel-opt" aria-selected={pt.key === currentPortal} onClick={() => (onPortal?.(pt.key), setWsOpen(false))}>
              <span className="sel-icon">
                <WorkspaceLogo ws={pt.ws} size={24} />
              </span>
              <span className="sel-label">
                {pt.ws.name}
                <small>{t('Shared space · {name}', { name: pt.client.name })}</small>
              </span>
            </button>
          ))}
          {onAddWorkspace && (
            <button className="sel-opt" onClick={() => (onAddWorkspace(), setWsOpen(false))}>
              <span className="sel-label">{t('+ Add a workspace')}</span>
            </button>
          )}
        </div>
      </Popover>

      {switches ? (
        <button type="button" className={`mt-title${titleOpen ? ' open' : ''}`} onClick={() => setTitleOpen(true)} aria-haspopup="dialog" aria-label={menu ? `${menu.label}: ${shownTitle}` : t('{title}: settings', { title })}>
          <span className="mt-title-text">{shownTitle}</span>
          <ChevronDown size={16} className="mt-chev" />
        </button>
      ) : (
        <h1 className="mt-title plain">{title}</h1>
      )}
      {titleOpen && <TitleSheet title={title} menu={menu ?? null} settings={settings} onClose={() => setTitleOpen(false)} />}

      <span className="spacer" />
      <button className="icon-btn mt-search" onClick={onSearch} aria-label={t('Search {title}', { title })}>
        <Search size={21} />
      </button>
      {onBell && (
        <button className="icon-btn mt-bell" onClick={onBell} aria-label={t('Notifications')}>
          <Bell size={20} />
          {unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
        </button>
      )}
      {account}
    </header>
  );
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
