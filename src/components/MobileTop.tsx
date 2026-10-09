import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, ChevronDown, FlaskConical, LayoutGrid, Loader2, Search } from 'lucide-react';
import type { Client, Workspace } from '../types';
import { WorkspaceLogo } from './WorkspaceLogo';
import { Badge } from './ui/Person';
import { isSandbox } from '../sandbox';
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
  portals = [],
  onPortal,
  onShared,
  settings,
  demo,
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
  portals?: { key: string; ws: Workspace; client: Client }[];
  onPortal?: (key: string) => void;
  onShared?: () => void; // everything shared with you, on one page
  settings?: ReactNode; // this app's settings button
  demo?: { busy?: boolean; onOpen: () => void } | null; // their own demo company, not made yet
}) {
  const wsBtn = useRef<HTMLButtonElement>(null);
  const [wsOpen, setWsOpen] = useState(false);
  useEffect(() => setWsOpen(false), [current.id]); // the demo company opened, or another company was picked
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
                <span className="ws-name-line">
                  {w.name}
                  {isSandbox(w) && (
                    <Badge tone="info" small>
                      Demo
                    </Badge>
                  )}
                </span>
                <small>{isSandbox(w) ? 'Your own copy to try things in' : (w.domains[0] ?? '')}</small>
              </span>
            </button>
          ))}
          {demo && (
            <button className="sel-opt" onClick={demo.onOpen} disabled={demo.busy}>
              <span className="sel-icon ws-demo-icon">{demo.busy ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}</span>
              <span className="sel-label">
                <span className="ws-name-line">
                  {demo.busy ? 'Making your demo company…' : 'Demo company'}
                  <Badge tone="info" small>
                    Demo
                  </Badge>
                </span>
                <small>A sample agency to try everything in, just for you</small>
              </span>
            </button>
          )}
          {portals.length > 0 && <div className="sel-group">Shared with you</div>}
          {onShared && (
            <button className="sel-opt" onClick={() => (onShared(), setWsOpen(false))}>
              <span className="sel-icon">
                <LayoutGrid size={18} />
              </span>
              <span className="sel-label">
                See everything shared with you
                <small>{portals.length} shared spaces</small>
              </span>
            </button>
          )}
          {portals.map((pt) => (
            <button key={pt.key} className="sel-opt" onClick={() => (onPortal?.(pt.key), setWsOpen(false))}>
              <span className="sel-icon">
                <WorkspaceLogo ws={pt.ws} size={24} />
              </span>
              <span className="sel-label">
                {pt.ws.name}
                <small>Shared space · {pt.client.name}</small>
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
      {settings}
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
