import { createContext, useEffect, useState } from 'react';
import { MousePointerClick, X } from 'lucide-react';
import type { ButtonDef, Channel, DataTable, TableField, User } from '../../types';
import { ButtonSettings } from './Automations';
import { t } from '../../i18n';

/** Opens a button field's setup dialog (provided by the table screen, used by the column menu). */
export const ButtonSetupCtx = createContext<((fieldId: string) => void) | null>(null);

/**
 * What a button does, in a dialog of its own: there are steps, options and conditions, too much for a popover.
 * Edits stay here until Save.
 */
export function ButtonDialog({ field, t: tb, tables, users, channels, onSave, onClose }: { field: TableField; t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; onSave: (b: ButtonDef) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<TableField>(() => structuredClone(field));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.pop') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const b = draft.button;
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal btn-modal" role="dialog" aria-label={t('What the {name} button does', { name: field.name })} onMouseDown={(e) => e.stopPropagation()}>
        <header className="big-head">
          <MousePointerClick size={15} />
          <strong>{t('What “{name}” does', { name: field.name })}</strong>
          <span className="spacer" />
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </header>
        <div className="btn-modal-body">
          <ButtonSettings field={draft} t={tb} tables={tables} users={users} channels={channels} onChange={(button) => setDraft((d) => ({ ...d, button }))} />
        </div>
        <footer className="modal-foot">
          {!b?.actions.length && <span className="muted small">{t('Add at least one step.')}</span>}
          <span className="spacer" />
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="primary-btn sm" disabled={!b?.actions.length} onClick={() => (onSave(b!), onClose())}>
            {t('Save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
