import { useState } from 'react';
import { Archive, Check, ChevronRight, Clock, MailOpen, Minus, Star, Trash2, type LucideIcon } from 'lucide-react';
import { usePersisted } from '../../settings';
import { PushScreen } from '../ui/PushScreen';
import { Sheet } from '../ui/Sheet';
import { mark, t } from '../../i18n';
import { InboxSettingsScreen, inboxSummary } from './Sorting';
import { useMailPrefs } from './sortPrefs';

/** What a swipe on an email does. Kept on this device (a phone and a tablet can differ, like Spark). */
export type SwipeKind = 'done' | 'snooze' | 'read' | 'star' | 'trash' | 'none';
export interface MailSwipes {
  right: SwipeKind; // swipe right: the action on the left
  left: SwipeKind; // swipe left: the action on the right
}
export const DEFAULT_SWIPES: MailSwipes = { right: 'done', left: 'snooze' };

export const SWIPE_CHOICES: { id: SwipeKind; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'done', label: mark('Done'), hint: mark('Out of the inbox, into Archive'), icon: Archive },
  { id: 'snooze', label: mark('Snooze'), hint: mark('Back at a time you pick'), icon: Clock },
  { id: 'read', label: mark('Read or unread'), hint: mark('Mark it either way'), icon: MailOpen },
  { id: 'star', label: mark('Star'), hint: mark('Keep it in Starred'), icon: Star },
  { id: 'trash', label: mark('Delete'), hint: mark('Into Trash'), icon: Trash2 },
  { id: 'none', label: mark('Nothing'), hint: mark('The row stays still'), icon: Minus },
];

export const useMailSwipes = () => usePersisted<MailSwipes>('s2g-mail-swipes', DEFAULT_SWIPES);

export const swipeWords = (s: MailSwipes) => t('Right: {right}. Left: {left}.', { right: t(SWIPE_CHOICES.find((c) => c.id === s.right)?.label ?? 'Done'), left: t(SWIPE_CHOICES.find((c) => c.id === s.left)?.label ?? 'Snooze') });

const TONE: Record<SwipeKind, string> = { done: 'ok', snooze: 'warn', read: 'accent', star: 'warn', trash: 'danger', none: 'none' };

/** Gmail's swipe settings on phones: each side with its action, Change, and a row showing what the swipe uncovers. */
export function SwipeSettingsPhone() {
  const [swipes, setSwipes] = useMailSwipes();
  const [changing, setChanging] = useState<keyof MailSwipes | null>(null);
  const side = (key: keyof MailSwipes, title: string) => {
    const c = SWIPE_CHOICES.find((x) => x.id === swipes[key]) ?? SWIPE_CHOICES[0];
    return (
      <section className="gm-swipe-block">
        <div className="gm-swipe-top">
          <span className="gm-swipe-words">
            <b>{title}</b>
            <span>{t(c.label)}</span>
          </span>
          <button type="button" className="link-btn gm-swipe-change" onClick={() => setChanging(key)}>
            {t('Change')}
          </button>
        </div>
        <div className={`gm-swipe-demo ${key}`} data-tone={TONE[c.id]} aria-hidden="true">
          <span className="gm-swipe-under">
            <c.icon size={22} />
          </span>
          <span className="gm-swipe-face">
            <i className="gm-swipe-av" />
            <span className="gm-swipe-lines">
              <i />
              <i />
            </span>
          </span>
        </div>
      </section>
    );
  };
  return (
    <div className="gm-swipes">
      {side('right', t('Right swipe'))}
      {side('left', t('Left swipe'))}
      <p className="set-hint">{t('Every swipe can be undone for a few seconds. These are kept on this device.')}</p>
      {changing && (
        <Sheet title={changing === 'right' ? t('Right swipe') : t('Left swipe')} onClose={() => setChanging(null)}>
          <div className="as-list" role="radiogroup">
            {SWIPE_CHOICES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={swipes[changing] === c.id} className={`as-item${swipes[changing] === c.id ? ' on' : ''}`} onClick={() => (setSwipes((s) => ({ ...s, [changing]: c.id })), setChanging(null))}>
                <c.icon size={18} className="as-icon" />
                <span className="as-label">
                  {t(c.label)}
                  <small>{t(c.hint)}</small>
                </span>
                {swipes[changing] === c.id && <Check size={16} className="as-check" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

export interface MailSettingsRow {
  id: string;
  label: string;
  value?: string;
  run: () => void;
}

/** Mail settings on phones (Gmail's, from the drawer): grouped rows, each opening its own screen. */
export function MailSettingsScreen({ rows, onBack }: { rows: MailSettingsRow[]; onBack: () => void }) {
  const [swipesOpen, setSwipesOpen] = useState(false);
  const [swipes] = useMailSwipes();
  const [inboxOpen, setInboxOpen] = useState(false); // Inbox: tabs, order, reading (Sorting.tsx)
  const [prefs] = useMailPrefs();
  return (
    <PushScreen title={t('Mail settings')} onBack={onBack} iconBack className="gm-settings">
      <div className="gm-set-list">
        <button type="button" className="gm-set-row" onClick={() => setInboxOpen(true)}>
          <span className="gm-set-words">
            <b>{t('Inbox')}</b>
            <span>{inboxSummary(prefs)}</span>
          </span>
          <ChevronRight size={20} />
        </button>
        <button type="button" className="gm-set-row" onClick={() => setSwipesOpen(true)}>
          <span className="gm-set-words">
            <b>{t('Swipe actions')}</b>
            <span>{swipeWords(swipes)}</span>
          </span>
          <ChevronRight size={20} />
        </button>
        {rows.map((r) => (
          <button key={r.id} type="button" className="gm-set-row" onClick={r.run}>
            <span className="gm-set-words">
              <b>{r.label}</b>
              {r.value && <span>{r.value}</span>}
            </span>
            <ChevronRight size={20} />
          </button>
        ))}
      </div>
      {inboxOpen && <InboxSettingsScreen onBack={() => setInboxOpen(false)} />}
      {swipesOpen && (
        <PushScreen title={t('Swipe actions')} onBack={() => setSwipesOpen(false)} iconBack className="gm-settings">
          <SwipeSettingsPhone />
        </PushScreen>
      )}
    </PushScreen>
  );
}
