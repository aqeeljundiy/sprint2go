import { Clock, FolderPlus, HardDrive, Image, Paperclip, Star, Trash2, Upload, type LucideIcon } from 'lucide-react';
import type { DriveSection } from '../types';
import { fmtSize } from '../data/drive';

export const DRIVE_SECTIONS: { id: DriveSection; name: string; icon: LucideIcon }[] = [
  { id: 'my', name: 'My Drive', icon: HardDrive },
  { id: 'recent', name: 'Recent', icon: Clock },
  { id: 'media', name: 'Photos & videos', icon: Image },
  { id: 'email', name: 'From email', icon: Paperclip },
  { id: 'starred', name: 'Starred', icon: Star },
  { id: 'trash', name: 'Trash', icon: Trash2 },
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
      <button className="compose-btn" onClick={onUpload} title="Upload files">
        <Upload size={16} />
        <span className="sb-label">Upload</span>
      </button>
      <nav className="nav">
        <button className="nav-item" onClick={onNewFolder} title="New folder">
          <FolderPlus size={17} />
          <span className="sb-label">New folder</span>
        </button>
      </nav>
      <div className="nav-heading sb-label">Drive</div>
      <nav className="nav">
        {DRIVE_SECTIONS.map(({ id, name, icon: Icon }) => (
          <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => onSection(id)} title={name}>
            <Icon size={17} />
            <span className="sb-label">{name}</span>
          </button>
        ))}
      </nav>
      {used / quota >= 0.8 && (
      <div className="storage sb-label">
        <div className="storage-row">
          <span>Storage</span>
          <span>
            {fmtSize(used)} / {fmtSize(quota)}
          </span>
        </div>
        <div className="bar">
          <span style={{ width: `${Math.max(1, (used / quota) * 100)}%` }} className="warn" />
        </div>
        <small className="muted">Running low. Free up space or add storage in Settings.</small>
      </div>
      )}
    </>
  );
}
