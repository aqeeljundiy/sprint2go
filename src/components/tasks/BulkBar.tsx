import { createPortal } from 'react-dom';
import { CalendarDays, CheckCheck, Columns3, Flag, Trash2, UserRound, X } from 'lucide-react';
import { useFocusedScreen } from '../../mobile/chrome';
import { t, tn } from '../../i18n';

/**
 * Select many: the bar of things to do to all of them (Date, Move, Assign, Priority, Complete, Delete). On a phone it
 * takes the tab bar's place; on a computer it floats at the bottom of the list.
 */
export function BulkBar({ count, onDate, onMove, onAssign, onPriority, onComplete, onDelete, onCancel, onAll, all }: { count: number; onDate: () => void; onMove: () => void; onAssign: () => void; onPriority: () => void; onComplete: () => void; onDelete: () => void; onCancel: () => void; onAll?: () => void; all?: boolean }) {
  useFocusedScreen(true); // the tab bar and the create button step aside
  return createPortal(
    <div className="task-bulk" role="toolbar" aria-label={tn(count, '{n} selected', '{n} selected')}>
      <div className="tb-top">
        <button type="button" className="icon-btn" onClick={onCancel} aria-label={t('Stop selecting')}>
          <X size={18} />
        </button>
        <strong aria-live="polite">{count ? tn(count, '{n} selected', '{n} selected') : t('Tap tasks to select them')}</strong>
        {onAll && (
          <button type="button" className="link-btn small" onClick={onAll}>
            {all ? t('Select none') : t('Select all')}
          </button>
        )}
      </div>
      <div className="tb-acts">
        {(
          [
            ['date', t('Date'), CalendarDays, onDate],
            ['move', t('Move'), Columns3, onMove],
            ['assign', t('Assign'), UserRound, onAssign],
            ['priority', t('Priority'), Flag, onPriority],
            ['complete', t('Complete'), CheckCheck, onComplete],
            ['delete', t('Delete'), Trash2, onDelete],
          ] as const
        ).map(([id, label, Icon, run]) => (
          <button key={id} type="button" className={id === 'delete' ? 'danger' : ''} onClick={run} disabled={!count}>
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
