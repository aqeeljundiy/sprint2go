import { Archive, Check, Clock, MailOpen, Minus, Star, Trash2, type LucideIcon } from 'lucide-react';
import { usePersisted } from '../../settings';

/** What a swipe on an email does. Kept on this device (a phone and a tablet can differ, like Spark). */
export type SwipeKind = 'done' | 'snooze' | 'read' | 'star' | 'trash' | 'none';
export interface MailSwipes {
  right: SwipeKind; // swipe right: the action on the left
  left: SwipeKind; // swipe left: the action on the right
}
export const DEFAULT_SWIPES: MailSwipes = { right: 'done', left: 'snooze' };

export const SWIPE_CHOICES: { id: SwipeKind; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'done', label: 'Done', hint: 'Out of the inbox, into Archive', icon: Archive },
  { id: 'snooze', label: 'Snooze', hint: 'Back at a time you pick', icon: Clock },
  { id: 'read', label: 'Read or unread', hint: 'Mark it either way', icon: MailOpen },
  { id: 'star', label: 'Star', hint: 'Keep it in Starred', icon: Star },
  { id: 'trash', label: 'Delete', hint: 'Into Trash', icon: Trash2 },
  { id: 'none', label: 'Nothing', hint: 'The row stays still', icon: Minus },
];

export const useMailSwipes = () => usePersisted<MailSwipes>('s2g-mail-swipes', DEFAULT_SWIPES);

export const swipeWords = (s: MailSwipes) => `Right: ${SWIPE_CHOICES.find((c) => c.id === s.right)?.label ?? 'Done'}. Left: ${SWIPE_CHOICES.find((c) => c.id === s.left)?.label ?? 'Snooze'}.`;

/** Mail's swipe settings, opened full screen from the title switcher on phones. */
export function SwipeSettings() {
  const [swipes, setSwipes] = useMailSwipes();
  const side = (key: keyof MailSwipes, title: string, sub: string) => (
    <section className="swipe-set">
      <h3>{title}</h3>
      <p className="set-hint">{sub}</p>
      <div className="as-list" role="radiogroup" aria-label={title}>
        {SWIPE_CHOICES.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={swipes[key] === c.id} className={`as-item${swipes[key] === c.id ? ' on' : ''}`} onClick={() => setSwipes((s) => ({ ...s, [key]: c.id }))}>
            <c.icon size={18} className="as-icon" />
            <span className="as-label">
              {c.label}
              <small>{c.hint}</small>
            </span>
            {swipes[key] === c.id && <Check size={16} className="as-check" />}
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <div className="mail-swipe-settings">
      {side('right', 'Swipe right', 'Move a finger to the right across an email.')}
      {side('left', 'Swipe left', 'Move a finger to the left across an email.')}
      <p className="set-hint">Every swipe can be undone for a few seconds. These are kept on this device.</p>
    </div>
  );
}
