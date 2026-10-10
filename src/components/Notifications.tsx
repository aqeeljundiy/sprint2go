import { useEffect, useRef, useState } from 'react';
import { AtSign, Bell, CheckCheck, CircleCheck, ListChecks, Mail, Users, Video, type LucideIcon } from 'lucide-react';
import type { Notice, User } from '../types';
import { localDay, relative } from '../utils';
import { fmtDayWord } from '../i18n/format';
import { Avatar } from './Avatar';
import { PushScreen } from './ui/PushScreen';
import { SwipeRow } from './ui/SwipeRow';
import { TabPane } from './ui/Smooth';
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

/** Who a notification is from: the person it names first ("Henry assigned you…"), when that's someone here. */
function actorOf(n: Notice, users: User[]): User | undefined {
  const v = n.tr?.vars ?? {};
  const named = [v.name, v.who, v.by].find((x): x is string => typeof x === 'string');
  const first = (named ?? n.text.split(/\s/)[0] ?? '').split(' ')[0].toLowerCase();
  if (!first) return undefined;
  return users.find((u) => u.name.split(' ')[0].toLowerCase() === first);
}

type NoticeFilter = 'all' | 'unread' | 'mentions';

/**
 * All notifications on a phone (Slack's Activity, Teams' pills): a full screen with All, Unread and Mentions, the
 * person's photo on each row (the kind as a small badge on it), grouped by day. Swipe left to mark read or unread.
 */
export function NoticesScreen({ notices, users, needs, onOpen, onRead, onReadAll, onBack }: { notices: Notice[]; users: User[]; needs: string[]; onOpen: (n: Notice) => void; onRead: (ids: string[], read: boolean) => void; onReadAll: () => void; onBack: () => void }) {
  const [filter, setFilter] = useState<NoticeFilter>('all');
  const sorted = [...notices].sort((a, b) => b.at.localeCompare(a.at));
  const shown = sorted.filter((n) => (filter === 'unread' ? !n.read : filter === 'mentions' ? n.kind === 'mention' : true));
  let lastDay = '';
  return (
    <PushScreen
      title={t('Notifications')}
      onBack={onBack}
      iconBack
      className="notices-screen"
      actions={
        notices.some((n) => !n.read) ? (
          <button type="button" className="link-btn ns-readall" onClick={onReadAll}>
            {t('Mark all read')}
          </button>
        ) : undefined
      }
    >
      <div className="segmented ns-chips" role="tablist" aria-label={t('Show')}>
        {(
          [
            ['all', t('All')],
            ['unread', t('Unread')],
            ['mentions', t('Mentions')],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <TabPane key={filter}>
        {shown.length === 0 ? (
          <EmptyState icon={<Bell size={20} />} title={filter === 'all' ? t('You’re all caught up') : t('Nothing here')} text={filter === 'mentions' ? t('When someone mentions you, it shows up here.') : t('New mentions, assignments and replies show up here.')} />
        ) : (
          <div className="ns-list">
            {shown.map((n) => {
              const day = localDay(new Date(n.at));
              const head = day !== lastDay ? fmtDayWord(day) : null;
              lastDay = day;
              const Icon = ICON[n.kind];
              const who = actorOf(n, users);
              return (
                <div key={n.id} className="ns-item">
                  {head && <h3 className="ns-day">{head}</h3>}
                  <SwipeRow end={[{ id: 'read', label: n.read ? t('Unread') : t('Read'), icon: n.read ? Mail : CheckCheck, tone: 'neutral', run: () => onRead([n.id], !n.read) }]} className="ns-swipe">
                    <button type="button" className={`ns-row${n.read ? '' : ' unread'}`} onClick={() => onOpen(n)}>
                      <span className="ns-face">
                        {who ? (
                          <Avatar person={who} size={36} />
                        ) : (
                          <span className={`ns-kind-big k-${n.kind}`}>
                            <Icon size={18} />
                          </span>
                        )}
                        {who && (
                          <span className={`ns-kind k-${n.kind}`}>
                            <Icon size={10} strokeWidth={2.5} />
                          </span>
                        )}
                      </span>
                      <span className="ns-text">
                        <span className="ns-line">{textOf(n)}</span>
                        <span className="ns-meta">
                          <time>{relative(n.at)}</time>
                          {needs.includes(n.id) && <em className="ns-needs">{t('Needs you')}</em>}
                        </span>
                      </span>
                      {!n.read && <i className="ns-dot" aria-label={t('Unread')} />}
                    </button>
                  </SwipeRow>
                </div>
              );
            })}
          </div>
        )}
      </TabPane>
    </PushScreen>
  );
}
