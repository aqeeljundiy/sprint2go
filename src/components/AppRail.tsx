import type { ReactNode } from 'react';
import { Bell, CalendarDays, HardDrive, House, ListChecks, Mail, MessagesSquare, Search, Sparkles, Video, type LucideIcon } from 'lucide-react';
import type { AppId } from '../types';

export const APPS: { id: AppId; name: string; icon: LucideIcon; path: string }[] = [
  { id: 'home', name: 'Home', icon: House, path: '/home' },
  { id: 'mail', name: 'Mail', icon: Mail, path: '/mail' },
  { id: 'chat', name: 'Chat', icon: MessagesSquare, path: '/chat' },
  { id: 'tasks', name: 'Tasks', icon: ListChecks, path: '/tasks' },
  { id: 'calendar', name: 'Calendar', icon: CalendarDays, path: '/calendar' },
  { id: 'drive', name: 'Drive', icon: HardDrive, path: '/drive' },
  { id: 'meet', name: 'Meet', icon: Video, path: '/meet' },
];

interface Props {
  current: AppId | 'settings';
  enabled: AppId[];
  badges: Partial<Record<AppId, number>>;
  workspace: ReactNode; // the workspace switcher
  account: ReactNode; // avatar + account menu
  notifications: ReactNode; // bell popover (when open)
  unreadNotices: number;
  noticesOpen: boolean;
  aiOpen: boolean;
  onApp: (id: AppId) => void;
  onSearch: () => void;
  onAskAI: () => void;
  onNotices: () => void;
}

/** The far-left column: one icon per app, like Slack or Teams. */
export function AppRail(p: Props) {
  return (
    <nav className="rail" aria-label="Apps">
      <div className="rail-ws">{p.workspace}</div>
      <div className="rail-apps">
        {APPS.filter((a) => p.enabled.includes(a.id)).map(({ id, name, icon: Icon }) => (
          <button key={id} className={`rail-app ${p.current === id ? 'on' : ''}`} onClick={() => p.onApp(id)} title={name} aria-current={p.current === id ? 'page' : undefined}>
            <span className="rail-icon">
              <Icon size={19} />
              {p.badges[id] ? <i>{p.badges[id]! > 99 ? '99+' : p.badges[id]}</i> : null}
            </span>
            <span className="rail-label">{name}</span>
          </button>
        ))}
      </div>
      <div className="rail-foot">
        <button className="rail-tool" onClick={p.onSearch} title="Search everything (⌘K)">
          <Search size={18} />
        </button>
        <button className={`rail-tool ai ${p.aiOpen ? 'on' : ''}`} onClick={p.onAskAI} title="Ask AI (⌘J)">
          <Sparkles size={18} />
        </button>
        <div className="rail-notices">
          <button className={`rail-tool ${p.noticesOpen ? 'on' : ''}`} onClick={p.onNotices} title="Notifications">
            <Bell size={18} />
            {p.unreadNotices ? <i>{p.unreadNotices}</i> : null}
          </button>
          {p.noticesOpen && p.notifications}
        </div>
        <div className="rail-account">{p.account}</div>
      </div>
    </nav>
  );
}
