import { useContext, useState, type ReactNode } from 'react';
import { usePersisted } from '../settings';
import { TabDefaultsCtx, arrange, type TabPrefs } from './ui/TabBar';
import { Briefcase, UsersRound, KeyRound, Table2, NotebookPen, Bell, CalendarDays, HardDrive, House, ListChecks, Mail, MessagesSquare, Search, Sparkles, Video, type LucideIcon } from 'lucide-react';
import { term } from '../terms';
import type { AppId } from '../types';

export const APPS: { id: AppId; name: string; icon: LucideIcon; path: string }[] = [
  { id: 'home', name: 'Home', icon: House, path: '/home' },
  { id: 'mail', name: 'Mail', icon: Mail, path: '/mail' },
  { id: 'chat', name: 'Chat', icon: MessagesSquare, path: '/chat' },
  { id: 'tasks', name: 'Tasks', icon: ListChecks, path: '/tasks' },
  {
    id: 'projects',
    get name() {
      return term.Many; // Projects, or Clients for companies that use that word
    },
    icon: Briefcase,
    path: '/projects',
  },
  { id: 'teams', name: 'Teams', icon: UsersRound, path: '/teams' },
  { id: 'tables', name: 'Tables', icon: Table2, path: '/tables' },
  { id: 'calendar', name: 'Calendar', icon: CalendarDays, path: '/calendar' },
  { id: 'notes', name: 'Notes', icon: NotebookPen, path: '/notes' },
  { id: 'drive', name: 'Drive', icon: HardDrive, path: '/drive' },
  { id: 'meet', name: 'Meet', icon: Video, path: '/meet' },
  { id: 'vault', name: 'Vault', icon: KeyRound, path: '/vault' },
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

/** The apps in this person's order (drag them in the rail, or use Settings → Your apps), else the company's. */
export function useAppOrder() {
  const shared = useContext(TabDefaultsCtx);
  const [mine, setMine] = usePersisted<TabPrefs | null>('s2g-tabs:rail', null);
  const prefs = mine ?? shared.defaults.rail ?? null;
  return { arranged: (list: typeof APPS) => arrange(list, prefs), setOrder: (order: string[]) => setMine({ order, hidden: [] }), reset: () => setMine(null), mine, shared };
}

/** The far-left column: one icon per app, like Slack or Teams. Drag an app to move it. */
export function AppRail(p: Props) {
  const { arranged, setOrder } = useAppOrder();
  const apps = arranged(APPS.filter((a) => p.enabled.includes(a.id)));
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const drop = () => {
    if (drag && over && drag !== over.id) {
      const ids: string[] = arranged(APPS).map((a) => a.id as string).filter((x) => x !== drag);
      ids.splice(ids.indexOf(over.id) + (over.after ? 1 : 0), 0, drag);
      setOrder(ids);
    }
    setDrag(null);
    setOver(null);
  };
  return (
    <nav className="rail" aria-label="Apps">
      <div className="rail-ws">{p.workspace}</div>
      <div className="rail-apps">
        {apps.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            className={`rail-app ${p.current === id ? 'on' : ''}${drag === id ? ' tab-dragging' : ''}${over?.id === id && drag !== id ? (over.after ? ' drop-below' : ' drop-above') : ''}`}
            onClick={() => p.onApp(id)}
            title={name}
            aria-current={p.current === id ? 'page' : undefined}
            draggable
            onDragStart={(e) => ((e.dataTransfer.effectAllowed = 'move'), e.dataTransfer.setData('text/plain', id), setDrag(id))}
            onDragEnd={() => (setDrag(null), setOver(null))}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > r.top + r.height / 2;
              if (over?.id !== id || over.after !== after) setOver({ id, after });
            }}
            onDrop={(e) => (e.preventDefault(), drop())}
          >
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
