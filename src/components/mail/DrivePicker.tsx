import { useMemo, useState } from 'react';
import { Check, ChevronRight, Folder, HardDrive, Search } from 'lucide-react';
import type { DriveItem } from '../../types';
import { Sheet } from '../ui/Sheet';
import { EmptyState } from '../ui/EmptyState';
import { useStored, session } from '../../store';
import { FileIcon } from '../FileIcon';
import { fmtSize } from '../../data/drive';
import { isBlockedName } from '../../mailAttachments';
import { realFor } from './attachApi';
import type { OutFile } from './DraftFiles';
import { t, tn } from '../../i18n';

/**
 * Insert from Drive: the company's Drive, folder by folder (or searched by name); pick files and add them to the email
 * as attachments or as links. A centred panel on desktop, a sheet on phones.
 */
export function DrivePicker({ onClose, onPick }: { onClose: () => void; onPick: (files: OutFile[]) => void }) {
  const [drive] = useStored('drive');
  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const mine = useMemo(() => (drive as DriveItem[]).filter((d) => !d.trashed && (d.workspaceId ?? 'pnp') === session.wsId), [drive]);
  const usable = (d: DriveItem) => d.kind !== 'folder' && !!d.url && (/^\/api\/files\/[a-f0-9]{32}$/.test(d.url) || d.url.startsWith('data:')) && !isBlockedName(d.name);
  const words = q.trim().toLowerCase();
  const list = words
    ? mine.filter((d) => d.kind !== 'folder' && d.name.toLowerCase().includes(words))
    : mine.filter((d) => (d.parentId ?? null) === folder).sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name));
  const trail: DriveItem[] = [];
  for (let cur = folder ? mine.find((d) => d.id === folder) : undefined, i = 0; cur && i < 10; cur = cur.parentId ? mine.find((d) => d.id === cur!.parentId) : undefined, i++) trail.unshift(cur);
  const chosen = mine.filter((d) => picked.has(d.id));
  const done = (link: boolean) => {
    onPick(chosen.map((d) => ({ name: d.name, size: d.size, url: d.url!, link })));
    onClose();
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <Sheet
      onClose={onClose}
      title={t('Insert from Drive')}
      size="tall"
      className="drive-pick"
      footer={
        <div className="dp-foot">
          <span className="dp-count">{chosen.length ? tn(chosen.length, '{n} file picked', '{n} files picked') : t('Pick the files to add')}</span>
          {realFor() && (
            <button type="button" className="ghost-btn" disabled={!chosen.length} onClick={() => done(true)}>
              {t('Add as links')}
            </button>
          )}
          <button type="button" className="primary-btn" disabled={!chosen.length} onClick={() => done(false)}>
            {t('Attach')}
          </button>
        </div>
      }
    >
      <label className="dfp-search dp-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search Drive')} aria-label={t('Search Drive')} />
      </label>
      {!words && (
        <nav className="dp-trail" aria-label={t('Folders')}>
          <button type="button" className={`dp-crumb${folder === null ? ' on' : ''}`} onClick={() => setFolder(null)}>
            <HardDrive size={14} /> {t('My Drive')}
          </button>
          {trail.map((f) => (
            <span key={f.id} className="dp-crumb-wrap">
              <ChevronRight size={14} />
              <button type="button" className={`dp-crumb${folder === f.id ? ' on' : ''}`} onClick={() => setFolder(f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div className="dp-list" role="listbox" aria-multiselectable="true">
        {list.map((d) =>
          d.kind === 'folder' ? (
            <button key={d.id} type="button" className="dp-row" onClick={() => setFolder(d.id)}>
              <Folder size={18} className="dp-icon" />
              <span className="dp-name">{d.name}</span>
              <ChevronRight size={16} className="dp-go" />
            </button>
          ) : (
            <button key={d.id} type="button" role="option" aria-selected={picked.has(d.id)} className={`dp-row${picked.has(d.id) ? ' on' : ''}`} disabled={!usable(d)} title={usable(d) ? d.name : t('This file can’t be added to an email')} onClick={() => toggle(d.id)}>
              <span className={`dp-check${picked.has(d.id) ? ' on' : ''}`}>{picked.has(d.id) && <Check size={14} />}</span>
              <FileIcon kind={d.kind} size={18} />
              <span className="dp-name">{d.name}</span>
              <span className="dp-size">{fmtSize(d.size)}</span>
            </button>
          ),
        )}
        {!list.length && <EmptyState compact title={words ? t('No files by that name') : t('This folder is empty')} />}
      </div>
    </Sheet>
  );
}
