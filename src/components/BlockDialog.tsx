import { useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { Ban, X } from 'lucide-react';
import type { Person } from '../types';
import { t, tn } from '../i18n';

interface Props {
  sender: Person;
  count: number; // existing emails from this sender
  domainCount: number;
  onBlock: (rule: { value: string; kind: 'address' | 'domain' }, deleteExisting: boolean) => void;
  onClose: () => void;
}

const FREE_MAIL = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com'];

/** "Force unsubscribe": mail from this sender is deleted on arrival from now on. */
export function BlockDialog({ sender, count, domainCount, onBlock, onClose }: Props) {
  const domain = sender.email.split('@')[1] ?? '';
  const canDomain = domain && !FREE_MAIL.includes(domain);
  const [kind, setKind] = useState<'address' | 'domain'>('address');
  const [del, setDel] = useState(true);
  const n = kind === 'domain' ? domainCount : count;

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={t('Block sender')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span>{t('Block sender')}</span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
          <div className="block-hero">
            <span>
              <Ban size={22} />
            </span>
            <div>
              <strong>{t('Stop {name} for good', { name: sender.name })}</strong>
              <small>{t('Their future emails are deleted the moment they arrive, even if they ignore unsubscribe requests. They won’t be told.')}</small>
            </div>
          </div>
          <div className="kind-pick">
            <button className={kind === 'address' ? 'on' : ''} onClick={() => setKind('address')}>
              <strong>{t('This address')}</strong>
              <small>{sender.email}</small>
            </button>
            <button className={kind === 'domain' ? 'on' : ''} disabled={!canDomain} onClick={() => setKind('domain')} title={canDomain ? '' : t('Can’t block a whole free-mail provider')}>
              <strong>{t('Everyone at @{domain}', { domain })}</strong>
              <small>{canDomain ? t('Catches their other addresses too') : t('Not available for free email providers')}</small>
            </button>
          </div>
          {n > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} />
              {tn(n, 'Also move the {n} email I already have from them to Trash', 'Also move the {n} emails I already have from them to Trash')}
            </label>
          )}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn danger-btn" onClick={() => onBlock({ value: kind === 'domain' ? domain : sender.email, kind }, del && n > 0)}>
            <Ban size={14} /> {t('Block')}
          </button>
        </footer>
      </div>
    </div>
  );
}
