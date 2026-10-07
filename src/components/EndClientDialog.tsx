import { useState } from 'react';
import { SmoothHeight } from './ui/Smooth';
import { Archive, X } from 'lucide-react';
import type { Client } from '../types';
import { localDay } from '../utils';
import { DatePicker } from './ui/DatePicker';
import { Select } from './ui/Select';

const REASONS = ['Project finished', 'Budget', 'Moved to another partner', 'Brought it in-house', 'Paused indefinitely', 'Other'];

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
      <div className="modal end-modal" role="dialog" aria-label={`End work with ${client.name}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <Archive size={15} /> End work with {client.name}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body end-body">
          <SmoothHeight>
          <p className="muted small">{client.name} moves to Past clients. Nothing is deleted: tasks, mail, meetings and files stay, and you can start working with them again any time.</p>
          <div className="end-row">
            <div className="field">
              <span>Last day</span>
              <DatePicker value={date} onChange={(v) => setDate(v || localDay())} clearable={false} label="Last day" />
            </div>
            <div className="field">
              <span>Why it ended</span>
              <Select value={reason} onChange={setReason} label="Why it ended" options={REASONS.map((r) => ({ value: r, label: r }))} />
            </div>
          </div>
          {channels > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Archive its {channels} channel{channels === 1 ? '' : 's'}
            </label>
          )}
          {people > 0 && (
            <div className="field">
              <span>
                Their {people} {people === 1 ? 'person' : 'people'} in the portal
              </span>
              <Select
                value={portal}
                onChange={setPortal}
                label={`Shared space access`}
                options={[
                  { value: 'readonly', label: 'Keep read-only access', hint: 'They can still read and download' },
                  { value: 'off', label: 'Switch off access', hint: 'Their sign-in stops working here' },
                ]}
              />
            </div>
          )}
          {openTasks > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={closeTasks} onChange={(e) => setCloseTasks(e.target.checked)} /> Mark its {openTasks} open task{openTasks === 1 ? '' : 's'} done
            </label>
          )}
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => onEnd({ date, reason, archive, portal, closeTasks })}>
            End work
          </button>
        </footer>
      </div>
    </div>
  );
}
