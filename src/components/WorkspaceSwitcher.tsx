import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, FlaskConical, LayoutGrid, Loader2, Plus, Settings2 } from 'lucide-react';
import type { Client, Workspace } from '../types';
import { WorkspaceLogo } from './WorkspaceLogo';
import { Badge } from './ui/Person';
import { isSandbox } from '../sandbox';

interface Props {
  workspaces: Workspace[];
  current: Workspace;
  unread: Record<string, number>;
  onSwitch: (id: string) => void;
  onAdd?: () => void;
  onSettings?: () => void;
  /** Companies this person is a client of (their portals). */
  portals?: { key: string; ws: Workspace; client: Client; unread?: number }[];
  currentPortal?: string; // set while a portal is open
  onPortal?: (key: string) => void;
  onHome?: () => void; // a guest's "Shared with you" overview
  addLabel?: string;
  /** Their own demo company when it isn't open yet (not made, or hidden): opening it makes it or shows it again. */
  demo?: { busy?: boolean; onOpen: () => void } | null;
}

export function WorkspaceSwitcher({ workspaces, current, unread, onSwitch, onAdd, onSettings, portals = [], currentPortal, onPortal, onHome, addLabel = 'Add a workspace', demo }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  // The demo company opened (or another company was picked elsewhere): the menu closes on the new company.
  useEffect(() => setOpen(false), [current.id]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="ws-switch" ref={ref}>
      <button className={`ws-current ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} title="Switch workspace">
        <WorkspaceLogo ws={current} size={30} />
        <span className="sb-label ws-name">
          <strong>{current.name}</strong>
          <small>{currentPortal ? `Shared space` : isSandbox(current) ? 'Demo company' : (current.domains[0] ?? 'Workspace')}</small>
        </span>
        <ChevronsUpDown size={15} className="sb-label ws-chev" />
      </button>

      {open && (
        <div className="ws-menu" role="menu">
          {workspaces.length > 0 && <div className="ws-menu-title">Workspaces</div>}
          {workspaces.map((w, i) => (
            <button key={w.id} className={`ws-item ${w.id === current.id && !currentPortal ? 'on' : ''}`} onClick={() => pick(() => onSwitch(w.id))}>
              <WorkspaceLogo ws={w} size={32} />
              <span className="ws-name">
                <span className="ws-name-line">
                  <strong>{w.name}</strong>
                  {isSandbox(w) && (
                    <Badge tone="info" small>
                      Demo
                    </Badge>
                  )}
                </span>
                <small>
                  {isSandbox(w) ? 'Your own copy to try things in' : `${w.accounts.filter((a) => !a.temp).length} account${w.accounts.filter((a) => !a.temp).length === 1 ? '' : 's'} · ${w.domains[0] ?? 'no domain'}`}
                </small>
              </span>
              {unread[w.id] ? <span className="ws-unread">{unread[w.id]}</span> : null}
              {w.id === current.id && !currentPortal ? <Check size={16} className="ws-check" /> : i < 9 && <kbd>⌥{i + 1}</kbd>}
            </button>
          ))}
          {demo && (
            <button className="ws-item ws-demo" onClick={demo.onOpen} disabled={demo.busy}>
              <span className="ws-demo-icon" aria-hidden="true">
                {demo.busy ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}
              </span>
              <span className="ws-name">
                <span className="ws-name-line">
                  <strong>{demo.busy ? 'Making your demo company…' : 'Demo company'}</strong>
                  <Badge tone="info" small>
                    Demo
                  </Badge>
                </span>
                <small>A sample agency to try everything in, just for you</small>
              </span>
            </button>
          )}
          {portals.length > 0 && (
            <>
              <div className="ws-menu-title">Shared with you</div>
              {onHome && (
                <button className="am-item" onClick={() => pick(onHome)}>
                  <LayoutGrid size={16} /> See everything shared with you
                </button>
              )}
              {portals.map((pt) => (
                <button key={pt.key} className={`ws-item ${pt.key === currentPortal ? 'on' : ''}`} onClick={() => pick(() => onPortal?.(pt.key))}>
                  <WorkspaceLogo ws={pt.ws} size={32} />
                  <span className="ws-name">
                    <strong>{pt.ws.name}</strong>
                    <small>Shared space · {pt.client.name}</small>
                  </span>
                  {pt.unread ? <span className="ws-unread">{pt.unread}</span> : null}
                  {pt.key === currentPortal && <Check size={16} className="ws-check" />}
                </button>
              ))}
            </>
          )}
          {(onAdd || onSettings) && <div className="am-sep" />}
          {onAdd && (
            <button className="am-item" onClick={() => pick(onAdd)}>
              <Plus size={16} /> {addLabel}
            </button>
          )}
          {onSettings && !currentPortal && (
            <button className="am-item" onClick={() => pick(onSettings)}>
              <Settings2 size={16} /> Workspace settings
            </button>
          )}
        </div>
      )}
    </div>
  );
}
