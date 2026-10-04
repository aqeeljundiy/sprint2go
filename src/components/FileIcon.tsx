import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import type { DriveKind } from '../types';

const MAP: Record<DriveKind, { icon: LucideIcon; color: string }> = {
  folder: { icon: Folder, color: 'var(--accent)' },
  image: { icon: FileImage, color: '#14b8a6' },
  video: { icon: FileVideo, color: '#8b5cf6' },
  pdf: { icon: FileText, color: '#ef4444' },
  doc: { icon: FileText, color: '#3b82f6' },
  sheet: { icon: FileSpreadsheet, color: '#10b981' },
  slides: { icon: Presentation, color: '#f59e0b' },
  zip: { icon: FileArchive, color: '#6b7280' },
  audio: { icon: FileAudio, color: '#ec4899' },
  other: { icon: File, color: '#6b7280' },
};

export const kindColor = (k: DriveKind) => MAP[k].color;

export function FileIcon({ kind, size = 18 }: { kind: DriveKind; size?: number }) {
  const { icon: Icon, color } = MAP[kind];
  return (
    <span className="ficon" style={{ ['--fc' as string]: color, width: size * 2, height: size * 2 }}>
      <Icon size={size} />
    </span>
  );
}
