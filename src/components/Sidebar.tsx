import { useRef, type ReactNode } from 'react';
import {
  Activity,
  ListChecks,
  Sparkles,
  Archive,
  CalendarDays,
  ChevronsUpDown,
  FileText,
  HardDrive,
  Inbox,
  Layers,
  Users,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Account, FolderId, Label, Person, View } from '../types';
import { Avatar } from './Avatar';

const FOLDERS: { id: FolderId; name: string; icon: LucideIcon }[] = [
  { id: 'inbox', name: 'Inbox', icon: Inbox },
  { id: 'starred', name: 'Starred', icon: Star },
  { id: 'sent', name: 'Sent', icon: Send },
  { id: 'drafts', name: 'Drafts', icon: FileText },
  { id: 'archive', name: 'Archive', icon: Archive },
  { id: 'spam', name: 'Spam', icon: ShieldAlert },
  { id: 'trash', name: 'Trash', icon: Trash2 },
];

export type Mode = 'mail' | 'calendar' | 'drive' | 'settings';

export const MODES: { id: Exclude<Mode, 'settings'>; name: string; icon: LucideIcon }[] = [
  { id: 'mail', name: 'Mail', icon: Mail },
  { id: 'calendar', name: 'Calendar', icon: CalendarDays },
  { id: 'drive', name: 'Drive', icon: HardDrive },
];

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;

interface Props {
  mode: Mode;
  inSettings: boolean;
  onMode: (m: Mode) => void;
  collapsed: boolean;
  onCollapse: (c: boolean) => void;
  width: number;
  onWidth: (w: number) => void;
  /** Sidebar contents for calendar and drive. */
  calendarPanel: ReactNode;
  drivePanel: ReactNode;
  account: Person & { title: string; color?: string };
  switcher: ReactNode;
  accounts: Account[];
  activeAccount: string; // 'all' or an account id
  accountUnread: Record<string, number>;
  onAccountFilter: (id: string) => void;
  todoCount: number;
  onAskAI: () => void;
  aiOpen: boolean;
  accountMenu: ReactNode;
  accountOpen: boolean;
  onAccount: (open: boolean) => void;
  view: View;
  labels: Label[];
  counts: Partial<Record<FolderId, number>>;
  open: boolean; // mobile drawer
  onSelect: (v: View) => void;
  onCompose: () => void;
  onClose: () => void;
}

export function Sidebar(props: Props) {
  const { mode, collapsed, view, labels, counts, open, account } = props;
  const isActive = (v: View) => mode === 'mail' && !props.inSettings && v.kind === view.kind && v.id === view.id;
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
        <div className="sb-top">
          {props.switcher}
          <button
            className="icon-btn sm collapse-btn"
            onClick={() => props.onCollapse(!collapsed)}
            title={collapsed ? 'Expand sidebar ( [ )' : 'Collapse sidebar ( [ )'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <div className="mode-switch">
          {MODES.map(({ id, name, icon: Icon }) => (
            <button key={id} className={mode === id ? 'on' : ''} onClick={() => props.onMode(id)} title={name}>
              <Icon size={15} />
              <span className="sb-label">{name}</span>
            </button>
          ))}
        </div>

        <button className={`ask-ai ${props.aiOpen ? 'on' : ''}`} onClick={props.onAskAI} title="Ask AI (⌘J)">
          <Sparkles size={15} />
          <span className="sb-label">Ask AI</span>
          <kbd className="sb-label">⌘J</kbd>
        </button>

        <div className="sb-scroll">
          {/* keyed so the panel fades in when switching sections */}
          <div className="sb-panel" key={mode}>
            {mode === 'calendar' ? (
              props.calendarPanel
            ) : mode === 'drive' ? (
              props.drivePanel
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
                            {'connected' in a && !a.connected && <small>Not connected</small>}
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
                    title="Tracking"
                  >
                    <Activity size={17} />
                    <span className="sb-label">Tracking</span>
                  </button>
                  <button
                    className={`nav-item ${isActive({ kind: 'todos', id: 'todos' }) ? 'active' : ''}`}
                    onClick={() => props.onSelect({ kind: 'todos', id: 'todos' })}
                    title="To-do"
                  >
                    <ListChecks size={17} />
                    <span className="sb-label">To-do</span>
                    {props.todoCount ? <span className="count">{props.todoCount}</span> : null}
                  </button>
                </nav>

                <div className="nav-heading sb-label">Labels</div>
                <nav className="nav">
                  {labels.map((l) => (
                    <button
                      key={l.id}
                      className={`nav-item ${isActive({ kind: 'label', id: l.id }) ? 'active' : ''}`}
                      onClick={() => props.onSelect({ kind: 'label', id: l.id })}
                      title={l.name}
                    >
                      <span className="dot" style={{ background: l.color }} />
                      <span className="sb-label">{l.name}</span>
                    </button>
                  ))}
                </nav>
              </>
            )}
          </div>
        </div>

        <div className="account-wrap">
          <button
            className={`account-chip ${props.accountOpen || props.inSettings ? 'on' : ''}`}
            onClick={() => props.onAccount(!props.accountOpen)}
            title="Account & settings"
          >
            <Avatar person={account} size={32} />
            <span className="sb-label account-text">
              <strong>{account.name}</strong>
              <small>{account.email}</small>
            </span>
            <ChevronsUpDown size={15} className="sb-label" />
          </button>
          {props.accountOpen && props.accountMenu}
        </div>

        <div className="sb-resize" onPointerDown={startResize} onDoubleClick={() => props.onCollapse(!collapsed)} title="Drag to resize · double-click to collapse" />
      </aside>
    </>
  );
}
