import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Plus, Settings2 } from 'lucide-react';
import type { Workspace } from '../types';
import { WorkspaceLogo } from './WorkspaceLogo';

interface Props {
  workspaces: Workspace[];
  current: Workspace;
  unread: Record<string, number>;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onSettings: () => void;
}

export function WorkspaceSwitcher({ workspaces, current, unread, onSwitch, onAdd, onSettings }: Props) {
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
          <small>{current.domains[0] ?? 'Workspace'}</small>
        </span>
        <ChevronsUpDown size={15} className="sb-label ws-chev" />
      </button>

      {open && (
        <div className="ws-menu" role="menu">
          <div className="ws-menu-title">Workspaces</div>
          {workspaces.map((w, i) => (
            <button key={w.id} className={`ws-item ${w.id === current.id ? 'on' : ''}`} onClick={() => pick(() => onSwitch(w.id))}>
              <WorkspaceLogo ws={w} size={32} />
              <span className="ws-name">
                <strong>{w.name}</strong>
                <small>
                  {w.accounts.length} account{w.accounts.length > 1 ? 's' : ''} · {w.domains[0] ?? 'no domain'}
                </small>
              </span>
              {unread[w.id] ? <span className="ws-unread">{unread[w.id]}</span> : null}
              {w.id === current.id ? <Check size={16} className="ws-check" /> : i < 9 && <kbd>⌥{i + 1}</kbd>}
            </button>
          ))}
          <div className="am-sep" />
          <button className="am-item" onClick={() => pick(onAdd)}>
            <Plus size={16} /> Add a workspace
          </button>
          <button className="am-item" onClick={() => pick(onSettings)}>
            <Settings2 size={16} /> Workspace settings
          </button>
        </div>
      )}
    </div>
  );
}
