import { useRef, type ReactNode } from 'react';
import { term } from '../terms';
import {
  Activity,
  Archive,
  FileText,
  Inbox,
  Layers,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  type LucideIcon, Clock, CalendarClock, UserCheck, Timer, MoreHorizontal, Plus, ListChecks } from 'lucide-react';
import type { Account, AppId, FolderId, Label, View } from '../types';
import { providerName } from './Onboarding';
import { lifeLeft } from './TempAddress';
import { t, tx } from '../i18n';

const FOLDERS: { id: FolderId; icon: LucideIcon }[] = [
  { id: 'inbox', icon: Inbox },
  { id: 'starred', icon: Star },
  { id: 'sent', icon: Send },
  { id: 'drafts', icon: FileText },
  { id: 'archive', icon: Archive },
  { id: 'spam', icon: ShieldAlert },
  { id: 'trash', icon: Trash2 },
  { id: 'snoozed', icon: Clock },
  { id: 'scheduled', icon: CalendarClock },
  { id: 'assigned', icon: UserCheck },
];

/** A mail folder's name in the person's language: the sidebar, the list's title, the phone's switcher. */
export function folderName(id: FolderId): string {
  switch (id) {
    case 'inbox':
      return t('Inbox');
    case 'starred':
      return t('Starred');
    case 'sent':
      return t('Sent');
    case 'drafts':
      return t('Drafts');
    case 'archive':
      return tx('folder', 'Archive');
    case 'spam':
      return t('Spam');
    case 'trash':
      return t('Trash');
    case 'snoozed':
      return t('Snoozed');
    case 'scheduled':
      return t('Scheduled');
    case 'assigned':
      return t('Assigned to me');
  }
}

export type Mode = AppId | 'settings';

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;

interface Props {
  mode: Mode;
  title: string;
  collapsed: boolean;
  onCollapse: (c: boolean) => void;
  width: number;
  onWidth: (w: number) => void;
  /** Sidebar contents for every app except Mail. */
  panel?: ReactNode;
  /** Workspace switcher + account, shown in the phone drawer (the rail is hidden there). */
  mobileTop?: ReactNode;
  /** The app's settings button (a gear that opens Settings at this app's section), next to the title. */
  settings?: ReactNode;
  accounts: Account[];
  activeAccount: string; // 'all' or an account id
  accountUnread: Record<string, number>;
  onAccountFilter: (id: string) => void;
  onNewTemp?: () => void;
  onNewProject?: () => void;
  onTempMenu?: (a: Account, anchor: HTMLElement) => void;
  view: View;
  labels: Label[];
  clients?: { id: string; name: string; color: string }[];
  onClient?: (id: string) => void;
  counts: Partial<Record<FolderId, number>>;
  open: boolean; // mobile drawer
  onSelect: (v: View) => void;
  onCompose: () => void;
  /** Why Compose is off (sending isn't set up). The button stays clickable so it can say why. */
  composeOff?: string;
  onClose: () => void;
}

export function Sidebar(props: Props) {
  const { mode, collapsed, view, counts, open } = props;
  const isActive = (v: View) => mode === 'mail' && v.kind === view.kind && v.id === view.id;
  const asideRef = useRef<HTMLElement>(null);

  /** Drag the right edge to resize; dragging far enough left collapses it. */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = collapsed ? 68 : props.width;
    document.body.classList.add('resizing', 'resizing-x');
    const move = (ev: PointerEvent) => {
      const w = startW + ev.clientX - startX;
      if (w < 140) {
        props.onCollapse(true);
      } else {
        props.onCollapse(false);
        props.onWidth(Math.min(Math.max(w, SIDEBAR_MIN), SIDEBAR_MAX));
      }
    };
    const up = () => {
      document.body.classList.remove('resizing', 'resizing-x');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={props.onClose} />
      <aside
        ref={asideRef}
        className={`sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}
        style={{ ['--sb-w' as string]: `${collapsed ? 68 : props.width}px` }}
      >
        {props.mobileTop && <div className="sb-mobile-top">{props.mobileTop}</div>}
        <div className="sb-top">
          <h2 className="sb-title sb-label">{props.title}</h2>
          {props.settings}
          <button
            className="icon-btn sm collapse-btn"
            onClick={() => props.onCollapse(!collapsed)}
            title={collapsed ? t('Expand sidebar ( [ )') : t('Collapse sidebar ( [ )')}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <div className="sb-scroll">
          {/* keyed so the panel fades in when switching sections */}
          <div className="sb-panel" key={mode}>
            {mode !== 'mail' ? (
              props.panel
            ) : (
              <>
                <button className={`compose-btn ${props.composeOff ? 'off' : ''}`} onClick={props.onCompose} title={props.composeOff ?? t('Compose (C)')} aria-disabled={props.composeOff ? true : undefined}>
                  <PenLine size={16} />
                  <span className="sb-label">{t('Compose')}</span>
                  <kbd className="sb-label">C</kbd>
                </button>

                {props.accounts.filter((a) => !a.temp).length > 1 && (
                  <>
                    <div className="nav-heading sb-label">{t('Inboxes')}</div>
                    <nav className="nav inbox-nav">
                      {[{ id: 'all', name: t('All inboxes'), email: '', kind: 'all' as const }, ...props.accounts.filter((a) => !a.temp)].map((a) => (
                        <button
                          key={a.id}
                          className={`nav-item acct ${props.activeAccount === a.id ? 'active' : ''}`}
                          onClick={() => props.onAccountFilter(a.id)}
                          title={a.email || a.name}
                        >
                          {a.kind === 'all' ? <Layers size={17} /> : a.kind === 'shared' ? <Users size={17} /> : <Inbox size={17} />}
                          <span className="sb-label acct-text">
                            <span>{a.kind === 'all' ? a.name : a.email.split('@')[0] + '@'}</span>
                            {'connected' in a && !a.connected ? (
                              <small>{t('Not connected')}</small>
                            ) : 'provider' in a && a.provider && a.provider !== 'sprint2go' ? (
                              <small className="via">{t('via {provider}', { provider: providerName(a.provider) })}</small>
                            ) : null}
                          </span>
                          {props.accountUnread[a.id] ? <span className="count">{props.accountUnread[a.id]}</span> : null}
                        </button>
                      ))}
                    </nav>
                  </>
                )}
                {(props.onNewTemp || props.accounts.some((a) => a.temp)) && (
                  <>
                    {props.accounts.some((a) => a.temp) && <div className="nav-heading sb-label">{t('Temporary')}</div>}
                    <nav className="nav temp-nav">
                      {props.accounts
                        .filter((a) => a.temp)
                        .map((a) => (
                          <div key={a.id} className={`nav-item acct temp-row ${props.activeAccount === a.id ? 'active' : ''}`}>
                            <button className="temp-open" onClick={() => props.onAccountFilter(a.id)} title={a.email}>
                              <Timer size={17} />
                              <span className="sb-label acct-text">
                                <span>{a.email.split('@')[0]}@</span>
                                <small>{lifeLeft(a)}</small>
                              </span>
                            </button>
                            {props.accountUnread[a.id] ? <span className="count">{props.accountUnread[a.id]}</span> : null}
                            <button className="icon-btn sm temp-more sb-label" title={t('Copy, share or delete')} onClick={(e) => props.onTempMenu?.(a, e.currentTarget)}>
                              <MoreHorizontal size={15} />
                            </button>
                          </div>
                        ))}
                      {props.onNewTemp && (
                        <button className="nav-item temp-add" onClick={props.onNewTemp} title={t('Temporary address')}>
                          <Plus size={16} />
                          <span className="sb-label">{t('Temporary address')}</span>
                        </button>
                      )}
                    </nav>
                  </>
                )}
                {(props.accounts.filter((a) => !a.temp).length > 1 || props.accounts.some((a) => a.temp)) && <div className="nav-heading sb-label">{t('Folders')}</div>}
                <nav className="nav">
                  {FOLDERS.map(({ id, icon: Icon }) => (
                    <button
                      key={id}
                      className={`nav-item ${isActive({ kind: 'folder', id }) ? 'active' : ''}`}
                      onClick={() => props.onSelect({ kind: 'folder', id })}
                      title={folderName(id)}
                    >
                      <Icon size={17} />
                      <span className="sb-label">{folderName(id)}</span>
                      {counts[id] ? <span className="count">{counts[id]}</span> : null}
                    </button>
                  ))}
                </nav>

                <nav className="nav">
                  <button
                    className={`nav-item ${isActive({ kind: 'tracking', id: 'tracking' }) ? 'active' : ''}`}
                    onClick={() => props.onSelect({ kind: 'tracking', id: 'tracking' })}
                    title={t('Waiting for reply')}
                  >
                    <Activity size={17} />
                    <span className="sb-label">{t('Waiting for reply')}</span>
                  </button>
                  <button
                    className={`nav-item ${isActive({ kind: 'todos', id: 'todos' }) ? 'active' : ''}`}
                    onClick={() => props.onSelect({ kind: 'todos', id: 'todos' })}
                    title={t('To-do: emails that asked you to do something')}
                  >
                    <ListChecks size={17} />
                    <span className="sb-label">{t('To-do')}</span>
                  </button>

                </nav>

                {(!!props.clients?.length || props.onNewProject) && (
                  <>
                    <div className="nav-heading sb-label">{term.Many}</div>
                    <nav className="nav">
                      {props.clients?.map((c) => (
                        <button key={c.id} className="nav-item" onClick={() => props.onClient?.(c.id)} title={t('{name}: emails on the {project} page', { name: c.name, project: term.one })}>
                          <span className="dot" style={{ background: c.color }} />
                          <span className="sb-label">{c.name}</span>
                        </button>
                      ))}
                      {props.onNewProject && (
                        <button className="nav-item temp-add" onClick={props.onNewProject} title={t('New {project}', { project: term.one })}>
                          <Plus size={16} />
                          <span className="sb-label">{t('New {project}', { project: term.one })}</span>
                        </button>
                      )}
                    </nav>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="sb-resize" onPointerDown={startResize} onDoubleClick={() => props.onCollapse(!collapsed)} title={t('Drag to resize · double-click to collapse')} />
      </aside>
    </>
  );
}
