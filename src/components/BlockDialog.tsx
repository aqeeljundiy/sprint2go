import { useState } from 'react';
import { Ban, X } from 'lucide-react';
import type { Person } from '../types';

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
      <div className="modal" role="dialog" aria-label="Block sender" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span>Block sender</span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <div className="block-hero">
            <span>
              <Ban size={22} />
            </span>
            <div>
              <strong>Stop {sender.name} for good</strong>
              <small>Their future emails are deleted the moment they arrive, even if they ignore unsubscribe requests. They won’t be told.</small>
            </div>
          </div>
          <div className="kind-pick">
            <button className={kind === 'address' ? 'on' : ''} onClick={() => setKind('address')}>
              <strong>This address</strong>
              <small>{sender.email}</small>
            </button>
            <button className={kind === 'domain' ? 'on' : ''} disabled={!canDomain} onClick={() => setKind('domain')} title={canDomain ? '' : 'Can’t block a whole free-mail provider'}>
              <strong>Everyone at @{domain}</strong>
              <small>{canDomain ? 'Catches their other addresses too' : 'Not available for free email providers'}</small>
            </button>
          </div>
          {n > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} />
              Also move the {n} email{n > 1 ? 's' : ''} I already have from them to Trash
            </label>
          )}
        </div>
        <footer className="modal-foot">
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn danger-btn" onClick={() => onBlock({ value: kind === 'domain' ? domain : sender.email, kind }, del && n > 0)}>
            <Ban size={14} /> Block
          </button>
        </footer>
      </div>
    </div>
  );
}
