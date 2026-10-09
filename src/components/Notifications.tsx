import { useEffect, useRef } from 'react';
import { AtSign, Bell, CheckCheck, CircleCheck, ListChecks, Mail, Users, Video, type LucideIcon } from 'lucide-react';
import type { Notice } from '../types';
import { relative } from '../utils';
import { EmptyState } from './ui/EmptyState';
import { t, textOf } from '../i18n';

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
    // Outside the list closes it (the phone's sheet has its own scrim, and taps inside it stay inside).
    const down = (e: MouseEvent) => !(e.target as HTMLElement).closest('.rail-notices, .notices, .sheet') && onClose();
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
    <div className="notices" ref={ref} role="dialog" aria-label={t('Notifications')}>
      <header>
        <strong>{t('Notifications')}</strong>
        {notices.some((n) => !n.read) && (
          <button className="ghost-btn sm" onClick={onReadAll}>
            <CheckCheck size={14} /> {t('Mark all read')}
          </button>
        )}
      </header>
      {sorted.length === 0 ? (
        <EmptyState className="notices-empty" icon={<Bell size={20} />} title={t('You’re all caught up')} text={t('New mentions, assignments and replies show up here.')} />
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
                    {textOf(n)}
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
