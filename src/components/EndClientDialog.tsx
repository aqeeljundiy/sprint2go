import { useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { Archive, X } from 'lucide-react';
import type { Client } from '../types';
import { localDay } from '../utils';
import { DatePicker } from './ui/DatePicker';
import { Select } from './ui/Select';
import { mark, t, tn } from '../i18n';
import { term } from '../terms';

// Saved in English (the project keeps its reason) and shown with t(reason).
const REASONS = [mark('Project finished'), mark('Budget'), mark('Moved to another partner'), mark('Brought it in-house'), mark('Paused indefinitely'), mark('Other')];

/** Ending work with a client: when, why, and what happens to their channels, their people's access and open tasks. */
export function EndClientDialog({
  client,
  openTasks,
  channels,
  people,
  onEnd,
  onClose,
}: {
  client: Client;
  openTasks: number;
  channels: number;
  people: number;
  onEnd: (o: { date: string; reason: string; archive: boolean; portal: 'readonly' | 'off'; closeTasks: boolean }) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(localDay());
  const [reason, setReason] = useState('Project finished');
  const [archive, setArchive] = useState(true);
  const [portal, setPortal] = useState<'readonly' | 'off'>('readonly');
  const [closeTasks, setCloseTasks] = useState(false);
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal end-modal" role="dialog" aria-label={t('End work with {name}', { name: client.name })} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Archive size={15} /> {t('End work with {name}', { name: client.name })}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body end-body">
          <SmoothHeight>
          <p className="muted small">{t('{name} moves to Past {projects}. Nothing is deleted: tasks, mail, meetings and files stay, and you can start working with them again any time.', { name: client.name, projects: term.many })}</p>
          <div className="end-row">
            <div className="field">
              <span>{t('Last day')}</span>
              <DatePicker value={date} onChange={(v) => setDate(v || localDay())} clearable={false} label={t('Last day')} />
            </div>
            <div className="field">
              <span>{t('Why it ended')}</span>
              <Select value={reason} onChange={setReason} label={t('Why it ended')} options={REASONS.map((r) => ({ value: r, label: t(r) }))} />
            </div>
          </div>
          {channels > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> {tn(channels, 'Archive its channel', 'Archive its {n} channels')}
            </label>
          )}
          {people > 0 && (
            <div className="field">
              <span>{tn(people, 'Their {n} person in the shared space', 'Their {n} people in the shared space')}</span>
              <Select
                value={portal}
                onChange={setPortal}
                label={t('Shared space access')}
                options={[
                  { value: 'readonly', label: t('Keep read-only access'), hint: t('They can still read and download') },
                  { value: 'off', label: t('Switch off access'), hint: t('Their sign-in stops working here') },
                ]}
              />
            </div>
          )}
          {openTasks > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={closeTasks} onChange={(e) => setCloseTasks(e.target.checked)} /> {tn(openTasks, 'Mark its open task done', 'Mark its {n} open tasks done')}
            </label>
          )}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={() => onEnd({ date, reason, archive, portal, closeTasks })}>
            {t('End work')}
          </button>
        </footer>
      </div>
    </div>
  );
}
