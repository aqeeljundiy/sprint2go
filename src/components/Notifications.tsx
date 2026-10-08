import { useEffect, useRef } from 'react';
import { AtSign, Bell, CheckCheck, CircleCheck, ListChecks, Mail, Users, Video, type LucideIcon } from 'lucide-react';
import type { Notice } from '../types';
import { relative } from '../utils';

const ICON: Record<Notice['kind'], LucideIcon> = { task: ListChecks, mention: AtSign, meeting: Video, mail: Mail, done: CircleCheck, team: Users };

interface Props {
  notices: Notice[];
  onOpen: (n: Notice) => void;
  onReadAll: () => void;
  onClose: () => void;
}

export function Notifications({ notices, onOpen, onReadAll, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !(e.target as HTMLElement).closest('.rail-notices') && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const sorted = [...notices].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="notices" ref={ref} role="dialog" aria-label="Notifications">
      <header>
        <strong>Notifications</strong>
        {notices.some((n) => !n.read) && (
          <button className="ghost-btn sm" onClick={onReadAll}>
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
      </header>
      {sorted.length === 0 ? (
        <div className="notices-empty">
          <Bell size={22} />
          <p>You’re all caught up.</p>
        </div>
      ) : (
        <ul>
          {sorted.map((n) => {
            const Icon = ICON[n.kind];
            return (
              <li key={n.id}>
                <button className={n.read ? '' : 'unread'} onClick={() => onOpen(n)}>
                  <span className={`nt-icon k-${n.kind}`}>
                    <Icon size={14} />
                  </span>
                  <span className="nt-text">
                    {n.text}
                    <time>{relative(n.at)}</time>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
