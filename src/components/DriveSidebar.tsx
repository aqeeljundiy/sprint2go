import { Clock, FolderPlus, HardDrive, Image, Paperclip, Star, Trash2, Upload, type LucideIcon } from 'lucide-react';
import type { DriveSection } from '../types';
import { fmtSize } from '../data/drive';
import { mark, t } from '../i18n';

/** Drive's sections. The names are English: show them with t(name). */
export const DRIVE_SECTIONS: { id: DriveSection; name: string; icon: LucideIcon }[] = [
  { id: 'my', name: mark('My Drive'), icon: HardDrive },
  { id: 'recent', name: mark('Recent'), icon: Clock },
  { id: 'media', name: mark('Photos & videos'), icon: Image },
  { id: 'email', name: mark('From email'), icon: Paperclip },
  { id: 'starred', name: mark('Starred'), icon: Star },
  { id: 'trash', name: mark('Trash'), icon: Trash2 },
];

interface Props {
  section: DriveSection | null;
  used: number;
  quota: number;
  onSection: (s: DriveSection) => void;
  onUpload: () => void;
  onNewFolder: () => void;
}

export function DriveSidebar({ section, used, quota, onSection, onUpload, onNewFolder }: Props) {
  return (
    <>
      <button className="compose-btn" onClick={onUpload} title={t('Upload files')}>
        <Upload size={16} />
        <span className="sb-label">{t('Upload')}</span>
      </button>
      <nav className="nav">
        <button className="nav-item" onClick={onNewFolder} title={t('New folder')}>
          <FolderPlus size={17} />
          <span className="sb-label">{t('New folder')}</span>
        </button>
      </nav>
      <div className="nav-heading sb-label">{t('Drive')}</div>
      <nav className="nav">
        {DRIVE_SECTIONS.map(({ id, name, icon: Icon }) => (
          <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => onSection(id)} title={t(name)}>
            <Icon size={17} />
            <span className="sb-label">{t(name)}</span>
          </button>
        ))}
      </nav>
      {used / quota >= 0.8 && (
      <div className="storage sb-label">
        <div className="storage-row">
          <span>{t('Storage')}</span>
          <span>
            {fmtSize(used)} / {fmtSize(quota)}
          </span>
        </div>
        <div className="bar">
          <span style={{ width: `${Math.max(1, (used / quota) * 100)}%` }} className="warn" />
        </div>
        <small className="muted">{t('Running low. Free up space or add storage in Settings.')}</small>
      </div>
      )}
    </>
  );
}
