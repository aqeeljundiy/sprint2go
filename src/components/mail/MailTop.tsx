import { forwardRef } from 'react';
import { Check, Inbox, Mail, MailOpen, Menu, MoreVertical, Trash2, X } from 'lucide-react';
import type { Person } from '../../types';
import { Avatar } from '../Avatar';
import { t, tn } from '../../i18n';

/**
 * Mail's top on phones: Gmail's search pill. ☰ opens the folders drawer, the field opens Mail's search, your picture
 * opens your account and companies (with a dot when another company has new mail).
 */
export function MailSearchPill({ me, elsewhere, onMenu, onSearch, onAccounts }: { me: Person; elsewhere?: boolean; onMenu: () => void; onSearch: () => void; onAccounts?: () => void }) {
  return (
    <div className="gm-search gm-fade" role="search">
      <button type="button" className="gm-icon" onClick={onMenu} aria-label={t('Folders and inboxes')}>
        <Menu size={22} />
      </button>
      <button type="button" className="gm-field" onClick={onSearch}>
        {t('Search in mail')}
      </button>
      {onAccounts && (
        <button type="button" className="gm-avatar" onClick={onAccounts} aria-haspopup="dialog" aria-label={elsewhere ? t('Your account and companies, new mail in another company') : t('Your account and companies')}>
          <Avatar person={me} size={32} />
          {elsewhere && <i className="gm-avatar-dot" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

/** Mail's top on phones with the launcher: your picture on the right of the bar (the launcher button and the mailbox
 * switcher, "Inbox", are the shell's). It opens your account and companies, with a dot when another has new mail. */
export function MailAvatar({ me, elsewhere, onAccounts }: { me: Person; elsewhere?: boolean; onAccounts: () => void }) {
  return (
    <button type="button" className="gm-avatar mt-avatar" onClick={onAccounts} aria-haspopup="dialog" aria-label={elsewhere ? t('Your account and companies, new mail in another company') : t('Your account and companies')}>
      <Avatar person={me} size={32} />
      {elsewhere && <i className="gm-avatar-dot" aria-hidden="true" />}
    </button>
  );
}

/** Selecting emails on phones: Gmail's contextual bar in place of the search pill. */
export const MailSelectBar = forwardRef<HTMLButtonElement, { count: number; inInbox: boolean; unread: boolean; onClose: () => void; onDone: () => void; onTrash: () => void; onRead: () => void; onMore: () => void }>(function MailSelectBar(p, moreRef) {
  return (
    <div className="gm-select gm-fade" role="toolbar" aria-label={tn(p.count, '{n} selected', '{n} selected')}>
      <button type="button" className="gm-icon" onClick={p.onClose} aria-label={t('Stop selecting')}>
        <X size={22} />
      </button>
      <span className="gm-count" aria-live="polite">
        {p.count}
      </span>
      <span className="spacer" />
      <button type="button" className="gm-icon" onClick={p.onDone} aria-label={p.inInbox ? t('Done') : t('Move to Inbox')} title={p.inInbox ? t('Done') : t('Move to Inbox')}>
        {p.inInbox ? <Check size={22} /> : <Inbox size={22} />}
      </button>
      <button type="button" className="gm-icon" onClick={p.onTrash} aria-label={t('Delete')} title={t('Delete')}>
        <Trash2 size={22} />
      </button>
      <button type="button" className="gm-icon" onClick={p.onRead} aria-label={p.unread ? t('Mark as read') : t('Mark as unread')} title={p.unread ? t('Mark as read') : t('Mark as unread')}>
        {p.unread ? <MailOpen size={22} /> : <Mail size={22} />}
      </button>
      <button type="button" className="gm-icon" ref={moreRef} onClick={p.onMore} aria-label={t('More')} title={t('More')}>
        <MoreVertical size={22} />
      </button>
    </div>
  );
});
