// Mail's remaining keyboard shortcuts on a computer (App.tsx has j k e # s u c / r Esc and g then a letter), the "?"
// help sheet listing all of them, and "Move to" (one email or several: a place or an inbox tab).
import { useEffect, useState } from 'react';
import { Archive, Inbox, ShieldAlert, Trash2 } from 'lucide-react';
import type { Thread } from '../../types';
import type { Category } from '../../mailQuery';
import { Sheet } from '../ui/Sheet';
import { store } from '../../store';
import { usePhone } from '../../mobile/media';
import { baseIds, categoryName, markImportant, moveToTab, mute, tabsOn, useMailPrefs } from './sortPrefs';
import { CATEGORY_ICON } from './Sorting';
import { t } from '../../i18n';

/** What App's list actions can do (the ones that move the reader on afterwards). */
export interface MoveActions {
  done: (ids: string[]) => void;
  inbox: (ids: string[]) => void;
  trash: (ids: string[]) => void;
  spam: (ids: string[]) => void;
  read: (ids: string[], unread: boolean) => void;
}

/** "Move to": Inbox, Archive, Spam, Trash and the inbox tabs that are on. */
export function MoveToSheet({ ids, actions, onClose }: { ids: string[]; actions: MoveActions; onClose: () => void }) {
  const [prefs] = useMailPrefs();
  const list = store.threads.filter((th) => baseIds(ids).includes(th.id));
  const tabs = tabsOn(prefs);
  const all = (pred: (th: Thread) => boolean) => list.length > 0 && list.every(pred);
  const item = (key: string, Icon: typeof Inbox, label: string, run: () => void, off = false) => (
    <button key={key} type="button" className="as-item" disabled={off} onClick={() => (run(), onClose())}>
      <Icon size={18} className="as-icon" />
      <span className="as-label">{label}</span>
    </button>
  );
  return (
    <Sheet title={t('Move to')} onClose={onClose}>
      <div className="as-list">
        {item('inbox', Inbox, t('Inbox'), () => actions.inbox(ids), all((th) => th.location === 'inbox'))}
        {item('archive', Archive, t('Archive'), () => actions.done(ids), all((th) => th.location === 'archive'))}
        {item('spam', ShieldAlert, t('Spam'), () => actions.spam(ids), all((th) => th.location === 'spam'))}
        {item('trash', Trash2, t('Trash'), () => actions.trash(ids), all((th) => th.location === 'trash'))}
        {tabs.length > 1 && <div className="mv-head">{t('Inbox tab')}</div>}
        {tabs.length > 1 && tabs.map((c: Category) => item(`tab-${c}`, CATEGORY_ICON[c], categoryName(c), () => moveToTab(ids, c), all((th) => (th.category ?? 'primary') === c)))}
      </div>
    </Sheet>
  );
}

const SHORTCUTS = (): { group: string; keys: [string, string][] }[] => [
  {
    group: t('Moving around'),
    keys: [
      ['j', t('Older email')],
      ['k', t('Newer email')],
      ['/', t('Search')],
      ['Esc', t('Back to the list')],
      ['g m', t('Go to Mail')],
      ['g c', t('Go to Chat')],
      ['g l', t('Go to Calendar')],
      ['[', t('Show or hide the sidebar')],
      ['?', t('These shortcuts')],
    ],
  },
  {
    group: t('Writing'),
    keys: [
      ['c', t('Compose')],
      ['r', t('Reply')],
      ['f', t('Forward')],
      ['⌘ Enter', t('Send')],
    ],
  },
  {
    group: t('The open email'),
    keys: [
      ['e', t('Done (to Archive)')],
      ['#', t('Delete')],
      ['!', t('Report spam')],
      ['v', t('Move to…')],
      ['m', t('Mute or unmute')],
      ['s', t('Star or unstar')],
      ['+', t('Mark important')],
      ['-', t('Mark not important')],
      ['u', t('Back to the list, unread')],
      ['Shift I', t('Mark as read')],
      ['Shift U', t('Mark as unread')],
    ],
  },
];

/** The "?" sheet: every Mail shortcut. */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={t('Keyboard shortcuts')} onClose={onClose} className="kbd-sheet">
      <div className="kbd-groups">
        {SHORTCUTS().map((g) => (
          <section key={g.group} className="kbd-group">
            <h3>{g.group}</h3>
            <dl>
              {g.keys.map(([k, what]) => (
                <div key={k} className="kbd-line">
                  <dt>
                    {k.split(' ').map((x, i) => (
                      <kbd key={i}>{x}</kbd>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * The shortcuts App doesn't handle, on the open email: ! m + - v f Shift+I Shift+U, and ? for the list of them all.
 * Ignored while typing or while something else is open on top.
 */
export function MailShortcuts({ selectedId, actions, onForward }: { selectedId: string | null; actions: MoveActions; onForward: (id: string) => void }) {
  const phone = usePhone();
  const [help, setHelp] = useState(false);
  const [moving, setMoving] = useState<string[] | null>(null);
  // "Move to…" from the reader's menu (Safety.tsx openMoveTo), on phones too.
  useEffect(() => {
    const on = (e: Event) => setMoving((e as CustomEvent<string[]>).detail);
    window.addEventListener('s2g:mail-move', on);
    return () => window.removeEventListener('s2g:mail-move', on);
  }, []);
  useEffect(() => {
    if (phone) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest?.('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('.modal-scrim:not(.is-leaving), .sheet-scrim:not(.is-leaving), .pop:not(.is-leaving), .palette-scrim:not(.is-leaving)')) return;
      const th = selectedId ? store.threads.find((x) => x.id === baseIds([selectedId])[0]) : undefined;
      const id = th?.id;
      switch (e.key) {
        case '?':
          setHelp(true);
          break;
        case '!':
          if (id && th!.location !== 'spam') actions.spam([id]);
          break;
        case 'm':
          if (id) mute([id], !th!.muted);
          break;
        case '+':
        case '=':
          if (id && !th!.important) markImportant([id], true);
          break;
        case '-':
          if (id && th!.important) markImportant([id], false);
          break;
        case 'v':
          if (id) setMoving([id]);
          break;
        case 'f':
          if (id) onForward(id);
          break;
        case 'I':
          if (id) actions.read([id], false);
          break;
        case 'U':
          if (id) actions.read([id], true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phone, selectedId, actions, onForward]);
  return (
    <>
      {help && <ShortcutSheet onClose={() => setHelp(false)} />}
      {moving && <MoveToSheet ids={moving} actions={actions} onClose={() => setMoving(null)} />}
    </>
  );
}

