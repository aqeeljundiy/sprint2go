// Small pieces the Mail for teams screens share: an on/off row, a busy button, the mail log in words.
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { User } from '../../types';
import { SmoothHeight } from '../ui/Smooth';
import { EmptyState } from '../ui/EmptyState';
import { relative } from '../../utils';
import type { AuditEntry } from './teamsApi';
import { brand } from '../../terms';
import { mark, t } from '../../i18n';

/** A setting that's on or off: the words on the left, the switch on the right. */
export function SwitchLine({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className="set-row toggle-row mx-switch">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
        <span />
      </button>
    </div>
  );
}

/** A button that shows it's working. */
export function BusyButton({ busy, children, className = 'primary-btn sm', disabled, onClick, type = 'button' }: { busy?: boolean; children: ReactNode; className?: string; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit' }) {
  return (
    <button type={type} className={className} disabled={disabled || busy} onClick={onClick} aria-busy={busy || undefined}>
      {busy && <Loader2 size={14} className="spin" />} {children}
    </button>
  );
}

/** A problem to show under a form, folding in and out. */
export const ErrorLine = ({ text }: { text: string }) => <SmoothHeight>{text ? <p className="err mx-err" role="alert">{text}</p> : null}</SmoothHeight>;

/** What each logged action is, in words. */
const ACTIONS: Record<string, string> = {
  'delegate.grant': mark('Gave access to the mailbox'),
  'delegate.change': mark('Changed how a delegate sends'),
  'delegate.revoke': mark('Took access back'),
  'delegate.send': mark('Sent an email as a delegate'),
  'forward.address-add': mark('Added a forwarding address'),
  'forward.address-verified': mark('Confirmed a forwarding address'),
  'forward.address-remove': mark('Removed a forwarding address'),
  'forward.on': mark('Switched forwarding on'),
  'forward.off': mark('Switched forwarding off'),
  'group.add': mark('Made a group'),
  'group.change': mark('Changed a group'),
  'group.remove': mark('Removed a group'),
  'policy.change': mark('Changed the mail rules'),
  'retention.run': mark('Deleted old mail (retention)'),
  'dlp.block': mark('A data loss rule blocked an email'),
  'dlp.warn': mark('A data loss rule warned about an email'),
  'dlp.warn-sent': mark('An email was sent after a data loss warning'),
  'mailbox.export': mark('Exported a mailbox'),
};

/** The mail log: who did what, when, newest first. `mailbox` names the mailbox an entry is about. */
export function MailLog({ entries, users, mailbox, limit = 12 }: { entries: AuditEntry[]; users: User[]; mailbox?: (id: string) => string | undefined; limit?: number }) {
  const who = (id: string) => (id === 'system' ? brand.name : (users.find((u) => u.id === id)?.name ?? t('Someone')));
  // A person the entry is about (delegation: their id leads the detail).
  const about = (e: AuditEntry) => {
    const id = /^(u-[\w-]+)/.exec(e.detail ?? '')?.[1];
    return id ? users.find((u) => u.id === id)?.name : e.action.startsWith('forward.address') ? (e.detail ?? '').split(':')[0].split(' ')[0] : undefined;
  };
  if (!entries.length) return <EmptyState compact text={t('Nothing yet.')} />;
  return (
    <ul className="mx-log">
      {entries.slice(0, limit).map((e) => {
        const box = e.accountId ? mailbox?.(e.accountId) : undefined;
        const person = about(e);
        return (
          <li key={e.id}>
            <span className="mx-log-what">
              {t(ACTIONS[e.action] ?? 'Changed something')}
              {person ? <b> · {person}</b> : null}
            </span>
            <small>{box ? t('{who}, {mailbox}, {when}', { who: who(e.actor), mailbox: box, when: relative(e.at) }) : t('{who}, {when}', { who: who(e.actor), when: relative(e.at) })}</small>
          </li>
        );
      })}
    </ul>
  );
}
