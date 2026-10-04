import { useRef, useState } from 'react';
import { Bell, ChevronDown, Search } from 'lucide-react';
import type { Workspace } from '../types';
import { WorkspaceLogo } from './WorkspaceLogo';
import { Popover } from './ui/Popover';
import { Select, type Option } from './ui/Select';

/**
 * The phone's top bar, the same on every screen: workspace, the screen title (a switcher where it helps),
 * search and the notification bell. Replaces the ☰ drawers.
 */
export function MobileTop({
  title,
  switcher,
  workspaces,
  current,
  unread,
  onWorkspace,
  onAddWorkspace,
  onSearch,
  onBell,
}: {
  title: string;
  switcher?: { value: string; options: Option[]; onChange: (v: string) => void; label: string };
  workspaces: Workspace[];
  current: Workspace;
  unread: number;
  onWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  onSearch: () => void;
  onBell: () => void;
}) {
  const wsBtn = useRef<HTMLButtonElement>(null);
  const [wsOpen, setWsOpen] = useState(false);
  return (
    <header className="mobile-top">
      <button ref={wsBtn} className="mt-ws" onClick={() => setWsOpen(true)} aria-label={`Workspace: ${current.name}`}>
        <WorkspaceLogo ws={current} size={30} />
      </button>
      <Popover anchor={wsBtn} open={wsOpen} onClose={() => setWsOpen(false)} title="Workspaces">
        <div className="sel-pop">
          {workspaces.map((w) => (
            <button key={w.id} className="sel-opt" aria-selected={w.id === current.id} onClick={() => (onWorkspace(w.id), setWsOpen(false))}>
              <span className="sel-icon">
                <WorkspaceLogo ws={w} size={24} />
              </span>
              <span className="sel-label">
                {w.name}
                <small>{w.domains[0] ?? ''}</small>
              </span>
            </button>
          ))}
          <button className="sel-opt" onClick={() => (onAddWorkspace(), setWsOpen(false))}>
            <span className="sel-label">+ Add a workspace</span>
          </button>
        </div>
      </Popover>

      {switcher ? (
        <Select
          value={switcher.value}
          options={switcher.options}
          onChange={switcher.onChange}
          label={switcher.label}
          className="mt-title"
          searchable={switcher.options.length > 10}
          renderValue={(o) => (
            <>
              <span className="sel-text">{o?.label ?? title}</span>
              <ChevronDown size={16} className="sel-chev" />
            </>
          )}
        />
      ) : (
        <h1 className="mt-title plain">{title}</h1>
      )}

      <span className="spacer" />
      <button className="icon-btn" onClick={onSearch} aria-label="Search everything">
        <Search size={20} />
      </button>
      <button className="icon-btn mt-bell" onClick={onBell} aria-label="Notifications">
        <Bell size={20} />
        {unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
      </button>
    </header>
  );
}
