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
  type LucideIcon, Clock, CalendarClock, UserCheck, Timer, MoreHorizontal, Plus, ListChecks, Inbox as InboxIcon, Hourglass, ListTodo, File, Tag, Folder, Settings, HelpCircle, Contact as ContactIcon, UserRoundCheck } from 'lucide-react';
import type { Account, AppId, FolderId, Label, View, Workspace } from '../types';
import { usePhone } from '../mobile/media';
import { WorkspaceLogo } from './WorkspaceLogo';
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
  /** Mailboxes someone gave you access to (delegation): marked as theirs in the list. */
  delegated?: Set<string>;
  onAccountFilter: (id: string) => void;
  onNewTemp?: () => void;
  onNewProject?: () => void;
  onTempMenu?: (a: Account, anchor: HTMLElement) => void;
  view: View;
  labels: Label[];
  /** Mail's Labels under the folders (src/components/mail/Labels.tsx: the tree, folds, + and each label's menu). */
  labelNav?: ReactNode;
  clients?: { id: string; name: string; color: string }[];
  onClient?: (id: string) => void;
  counts: Partial<Record<FolderId, number>>;
  open: boolean; // mobile drawer
  onSelect: (v: View) => void;
  onCompose: () => void;
  /** Why Compose is off (sending isn't set up). The button stays clickable so it can say why. */
  composeOff?: string;
  onClose: () => void;
  /** Mail: saved searches (desktop sidebar and phone drawer), and the inbox tabs in the phone drawer (mail/Sorting.tsx). */
  savedNav?: ReactNode;
  tabNav?: ReactNode;
  /** Phones, Mail: Gmail's drawer. Its header (the company and you), labels and projects with counts, settings last. */
  phoneMail?: {
    workspace: Workspace;
    email: string;
    onAccounts: () => void;
    labels: Label[]; // the ones in use
    labelNav?: ReactNode; // Mail's own Labels section (replaces `labels` when given)
    tagUnread: Record<string, number>; // `label:<id>` / `project:<id>`: unread in the inbox
    todo: number;
    onSettings: () => void;
    onHelp: () => void;
  };
}

export function Sidebar(props: Props) {
  const { mode, collapsed, view, counts, open } = props;
  const isActive = (v: View) => mode === 'mail' && v.kind === view.kind && v.id === view.id;
  const asideRef = useRef<HTMLElement>(null);
  const phone = usePhone();

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
        {phone && mode === 'mail' && props.phoneMail ? (
          <PhoneMailDrawer {...props} pm={props.phoneMail} isActive={isActive} />
        ) : (
          <>
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
                          {a.kind === 'all' ? <Layers size={17} /> : a.kind === 'shared' ? <Users size={17} /> : props.delegated?.has(a.id) ? <UserRoundCheck size={17} /> : <Inbox size={17} />}
                          <span className="sb-label acct-text">
                            <span>{a.kind === 'all' ? a.name : a.email.split('@')[0] + '@'}</span>
                            {props.delegated?.has(a.id) ? (
                              <small>{t('Delegated to you')}</small>
                            ) : 'connected' in a && !a.connected ? (
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
                  <button
                    className={`nav-item ${isActive({ kind: 'contacts', id: 'contacts' }) ? 'active' : ''}`}
                    onClick={() => props.onSelect({ kind: 'contacts', id: 'contacts' })}
                    title={t('Contacts')}
                  >
                    <ContactIcon size={17} />
                    <span className="sb-label">{t('Contacts')}</span>
                  </button>

                </nav>
                {props.savedNav}

                {props.labelNav}

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

          </>
        )}
        <div className="sb-resize" onPointerDown={startResize} onDoubleClick={() => props.onCollapse(!collapsed)} title={t('Drag to resize · double-click to collapse')} />
      </aside>
    </>
  );
}

/**
 * Mail's folders on a phone: Gmail's drawer. Inboxes where Gmail lists accounts, then the folders, labels and projects
 * (Gmail's labels), with what's unread on the right and the current one on a pill; Mail settings and Help last.
 */
function PhoneMailDrawer(props: Props & { pm: NonNullable<Props['phoneMail']>; isActive: (v: View) => boolean }) {
  const { pm, view, counts, isActive } = props;
  const boxes = props.accounts.filter((a) => !a.temp);
  const temps = props.accounts.filter((a) => a.temp);
  const shared = boxes.some((a) => a.kind === 'shared');
  const inboxOn = (id: string) => view.kind === 'folder' && view.id === 'inbox' && props.activeAccount === id;
  const item = (key: string, Icon: LucideIcon | null, label: string, on: boolean, run: () => void, count?: number, color?: string) => (
    <button key={key} type="button" className={`gm-nav${on ? ' active' : ''}`} aria-current={on || undefined} onClick={run}>
      {Icon ? <Icon size={20} style={color ? { color } : undefined} /> : <span />}
      <span className="gm-nav-label">{label}</span>
      {count ? <span className="gm-nav-count">{count > 999 ? '999+' : count}</span> : null}
    </button>
  );
  // Picking a folder looks across all your inboxes (as the title switcher did).
  const pick = (v: View) => {
    if (props.activeAccount !== 'all') props.onAccountFilter('all');
    props.onSelect(v);
  };
  return (
    <div className="gm-drawer">
      <button type="button" className="gm-drawer-head" onClick={pm.onAccounts} aria-haspopup="dialog" aria-label={t('Your account and companies')}>
        <WorkspaceLogo ws={pm.workspace} size={28} />
        <span className="gm-drawer-who">
          <b>{pm.workspace.name}</b>
          <small>{pm.email}</small>
        </span>
      </button>
      <div className="gm-drawer-scroll">
        <nav className="gm-nav-group" aria-label={t('Inboxes')}>
          {boxes.length > 1 && item('all', Layers, t('All inboxes'), inboxOn('all'), () => props.onAccountFilter('all'), props.accountUnread.all)}
          {boxes.map((a) =>
            item(a.id, a.kind === 'shared' ? Users : props.delegated?.has(a.id) ? UserRoundCheck : InboxIcon, a.kind === 'shared' || props.delegated?.has(a.id) ? a.name || a.email : boxes.length > 1 ? t('My inbox') : t('Inbox'), inboxOn(a.id), () => props.onAccountFilter(a.id), props.accountUnread[a.id]),
          )}
          {boxes.length === 0 && item('inbox', InboxIcon, t('Inbox'), inboxOn('all'), () => props.onAccountFilter('all'), counts.inbox)}
          {temps.map((a) => item(a.id, Timer, a.email.split('@')[0] + '@', inboxOn(a.id), () => props.onAccountFilter(a.id), props.accountUnread[a.id]))}
          {props.tabNav}
          {shared && item('assigned', UserCheck, t('Assigned to me'), isActive({ kind: 'folder', id: 'assigned' }), () => pick({ kind: 'folder', id: 'assigned' }), counts.assigned)}
        </nav>
        <div className="gm-sep" />
        <nav className="gm-nav-group" aria-label={t('Folders')}>
          {item('starred', Star, folderName('starred'), isActive({ kind: 'folder', id: 'starred' }), () => pick({ kind: 'folder', id: 'starred' }))}
          {item('snoozed', Clock, folderName('snoozed'), isActive({ kind: 'folder', id: 'snoozed' }), () => pick({ kind: 'folder', id: 'snoozed' }))}
          {item('tracking', Hourglass, t('Waiting for reply'), isActive({ kind: 'tracking', id: 'tracking' }), () => pick({ kind: 'tracking', id: 'tracking' }))}
          {item('todos', ListTodo, t('To-do'), isActive({ kind: 'todos', id: 'todos' }), () => pick({ kind: 'todos', id: 'todos' }), pm.todo)}
          {item('sent', Send, folderName('sent'), isActive({ kind: 'folder', id: 'sent' }), () => pick({ kind: 'folder', id: 'sent' }))}
          {item('scheduled', CalendarClock, folderName('scheduled'), isActive({ kind: 'folder', id: 'scheduled' }), () => pick({ kind: 'folder', id: 'scheduled' }), counts.scheduled)}
          {item('drafts', File, folderName('drafts'), isActive({ kind: 'folder', id: 'drafts' }), () => pick({ kind: 'folder', id: 'drafts' }), counts.drafts)}
          {item('archive', Archive, folderName('archive'), isActive({ kind: 'folder', id: 'archive' }), () => pick({ kind: 'folder', id: 'archive' }))}
          {item('spam', ShieldAlert, folderName('spam'), isActive({ kind: 'folder', id: 'spam' }), () => pick({ kind: 'folder', id: 'spam' }), counts.spam)}
          {item('trash', Trash2, folderName('trash'), isActive({ kind: 'folder', id: 'trash' }), () => pick({ kind: 'folder', id: 'trash' }))}
        </nav>
        {props.savedNav}
        {pm.labelNav}
        {!pm.labelNav && pm.labels.length > 0 && (
          <>
            <div className="gm-sep" />
            <div className="gm-head">{t('Labels')}</div>
            <nav className="gm-nav-group" aria-label={t('Labels')}>
              {pm.labels.map((l) => item(`label:${l.id}`, Tag, l.name, isActive({ kind: 'label', id: l.id }), () => pick({ kind: 'label', id: l.id }), pm.tagUnread[`label:${l.id}`], l.color))}
            </nav>
          </>
        )}
        {(props.clients?.length || props.onNewTemp) && (
          <>
            {pm.labels.length === 0 && !pm.labelNav && <div className="gm-sep" />}
            {!!props.clients?.length && <div className="gm-head">{term.Many}</div>}
            <nav className="gm-nav-group" aria-label={term.Many}>
              {props.clients?.map((c) => item(`project:${c.id}`, Folder, c.name, isActive({ kind: 'project', id: c.id }), () => pick({ kind: 'project', id: c.id }), pm.tagUnread[`project:${c.id}`], c.color))}
              {props.onNewTemp && item('temp-add', Plus, t('Temporary address'), false, props.onNewTemp)}
            </nav>
          </>
        )}
        <div className="gm-sep" />
        <nav className="gm-nav-group">
          {item('contacts', ContactIcon, t('Contacts'), isActive({ kind: 'contacts', id: 'contacts' }), () => props.onSelect({ kind: 'contacts', id: 'contacts' }))}
          {item('settings', Settings, t('Mail settings'), false, pm.onSettings)}
          {item('help', HelpCircle, t('Help'), false, pm.onHelp)}
        </nav>
      </div>
    </div>
  );
}
