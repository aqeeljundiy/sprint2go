// The top of the desktop reply box (Gmail's): Reply or Reply all (with Forward) in a menu, the people it goes to (click
// to change them, Cc included), the subject when you choose to edit it, and Pop out into the full compose window.
import { useRef, useState } from 'react';
import { ChevronDown, Forward, Maximize2, PenLine, Reply, ReplyAll } from 'lucide-react';
import type { Person } from '../../types';
import { ActionSheet } from '../ui/ActionSheet';
import { RecipientInput } from '../RecipientInput';
import { SmoothHeight } from '../ui/Smooth';
import { isMine } from '../../identity';
import { t } from '../../i18n';

const names = (ps: Person[]) => ps.map((p) => (isMine(p.email) ? t('me') : p.name || p.email)).join(', ');

export function ReplyHead({
  all,
  canAll,
  to,
  cc,
  subject,
  contacts,
  onKind,
  onPeople,
  onSubject,
  onForward,
  onPopOut,
}: {
  all: boolean;
  canAll: boolean;
  to: Person[];
  cc: Person[];
  subject: string;
  contacts: Person[];
  onKind: (all: boolean) => void;
  onPeople: (to: Person[], cc: Person[]) => void;
  onSubject: (s: string | null) => void;
  onForward: () => void;
  onPopOut?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(false);
  const kindBtn = useRef<HTMLButtonElement>(null);
  const Icon = all ? ReplyAll : Reply;
  return (
    <div className="reply-head">
      <div className="rh-row">
        <button type="button" ref={kindBtn} className={`rh-kind${menu ? ' on' : ''}`} onClick={() => setMenu((o) => !o)} aria-label={t('Type of response')} title={t('Type of response')}>
          <Icon size={15} />
          <ChevronDown size={13} className={`rot-chev${menu ? ' open' : ''}`} />
        </button>
        {editing ? (
          <span className="rh-label">{t('To')}</span>
        ) : (
          <button type="button" className="rh-people" onClick={() => setEditing(true)} title={t('Change who it goes to')}>
            <span className="rh-to">{names(to) || t('Add people')}</span>
            {cc.length > 0 && <span className="rh-cc">{t('Cc {names}', { names: names(cc) })}</span>}
          </button>
        )}
        <span className="spacer" />
        {onPopOut && (
          <button type="button" className="icon-btn sm" onClick={onPopOut} aria-label={t('Open in a full window')} title={t('Open in a full window')}>
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      <SmoothHeight>
        {editing && (
          <div className="rh-fields">
            <RecipientInput label={t('To')} value={to} contacts={contacts} autoFocus onChange={(v) => onPeople(v, cc)} />
            <RecipientInput label="Cc" value={cc} contacts={contacts} onChange={(v) => onPeople(to, v)} />
          </div>
        )}
        {editSubject && (
          <label className="compose-field rh-subject">
            <span>{t('Subject')}</span>
            <input value={subject} autoFocus onChange={(e) => onSubject(e.target.value)} />
          </label>
        )}
      </SmoothHeight>
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        anchor={kindBtn}
        title={t('Type of response')}
        actions={[
          { label: t('Reply'), icon: Reply, checked: !all, run: () => (onKind(false), setEditing(false)) },
          ...(canAll ? [{ label: t('Reply all'), icon: ReplyAll, checked: all, run: () => (onKind(true), setEditing(false)) }] : []),
          { label: t('Forward'), icon: Forward, run: onForward },
          { label: t('Edit subject'), icon: PenLine, group: 'more', checked: editSubject, run: () => (setEditSubject((v) => !v), editSubject && onSubject(null)) },
          ...(onPopOut ? [{ label: t('Pop out reply'), icon: Maximize2, group: 'more', run: onPopOut }] : []),
        ]}
      />
    </div>
  );
}
