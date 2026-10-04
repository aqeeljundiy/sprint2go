import { useRef, type ReactNode } from 'react';
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
  type LucideIcon,
} from 'lucide-react';
import type { Account, AppId, FolderId, Label, View } from '../types';
import { providerName } from './Onboarding';

const FOLDERS: { id: FolderId; name: string; icon: LucideIcon }[] = [
  { id: 'inbox', name: 'Inbox', icon: Inbox },
  { id: 'starred', name: 'Starred', icon: Star },
  { id: 'sent', name: 'Sent', icon: Send },
  { id: 'drafts', name: 'Drafts', icon: FileText },
  { id: 'archive', name: 'Archive', icon: Archive },
  { id: 'spam', name: 'Spam', icon: ShieldAlert },
  { id: 'trash', name: 'Trash', icon: Trash2 },
];

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
  accounts: Account[];
  activeAccount: string; // 'all' or an account id
  accountUnread: Record<string, number>;
  onAccountFilter: (id: string) => void;
  view: View;
  labels: Label[];
  clients?: { id: string; name: string; color: string }[];
  onClient?: (id: string) => void;
  counts: Partial<Record<FolderId, number>>;
  open: boolean; // mobile drawer
  onSelect: (v: View) => void;
  onCompose: () => void;
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
          <button
            className="icon-btn sm collapse-btn"
            onClick={() => props.onCollapse(!collapsed)}
            title={collapsed ? 'Expand sidebar ( [ )' : 'Collapse sidebar ( [ )'}
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
                <button className="compose-btn" onClick={props.onCompose} title="Compose (C)">
                  <PenLine size={16} />
                  <span className="sb-label">Compose</span>
                  <kbd className="sb-label">C</kbd>
                </button>

                {props.accounts.length > 1 && (
                  <>
                    <div className="nav-heading sb-label">Inboxes</div>
                    <nav className="nav inbox-nav">
                      {[{ id: 'all', name: 'All inboxes', email: '', kind: 'all' as const }, ...props.accounts].map((a) => (
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
                              <small>Not connected</small>
                            ) : 'provider' in a && a.provider && a.provider !== 'sprint2go' ? (
                              <small className="via">via {providerName(a.provider)}</small>
                            ) : null}
                          </span>
                          {props.accountUnread[a.id] ? <span className="count">{props.accountUnread[a.id]}</span> : null}
                        </button>
                      ))}
                    </nav>
                    <div className="nav-heading sb-label">Folders</div>
                  </>
                )}
                <nav className="nav">
                  {FOLDERS.map(({ id, name, icon: Icon }) => (
                    <button
                      key={id}
                      className={`nav-item ${isActive({ kind: 'folder', id }) ? 'active' : ''}`}
                      onClick={() => props.onSelect({ kind: 'folder', id })}
                      title={name}
                    >
                      <Icon size={17} />
                      <span className="sb-label">{name}</span>
                      {counts[id] ? <span className="count">{counts[id]}</span> : null}
                    </button>
                  ))}
                </nav>

                <nav className="nav">
                  <button
                    className={`nav-item ${isActive({ kind: 'tracking', id: 'tracking' }) ? 'active' : ''}`}
                    onClick={() => props.onSelect({ kind: 'tracking', id: 'tracking' })}
                    title="Waiting for reply"
                  >
                    <Activity size={17} />
                    <span className="sb-label">Waiting for reply</span>
                  </button>

                </nav>

                {!!props.clients?.length && (
                  <>
                    <div className="nav-heading sb-label">Clients</div>
                    <nav className="nav">
                      {props.clients.map((c) => (
                        <button key={c.id} className="nav-item" onClick={() => props.onClient?.(c.id)} title={`${c.name}: emails on the client page`}>
                          <span className="dot" style={{ background: c.color }} />
                          <span className="sb-label">{c.name}</span>
                        </button>
                      ))}
                    </nav>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="sb-resize" onPointerDown={startResize} onDoubleClick={() => props.onCollapse(!collapsed)} title="Drag to resize · double-click to collapse" />
      </aside>
    </>
  );
}
