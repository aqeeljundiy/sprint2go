import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Download, Mail, Star, Trash2, X } from 'lucide-react';
import type { DriveItem } from '../types';
import { fmtSize } from '../data/drive';
import { fullDate } from '../utils';
import { FileIcon } from './FileIcon';
import { t } from '../i18n';

interface Props {
  item: DriveItem;
  list: DriveItem[];
  onNav: (item: DriveItem) => void;
  onClose: () => void;
  onStar: (id: string) => void;
  onTrash: (id: string) => void;
  onOpenThread: (threadId: string) => void;
}

/** Full-screen preview with ←/→ (or a sideways swipe on phones) to flip through the folder. */
export function DrivePreview({ item, list, onNav, onClose, onStar, onTrash, onOpenThread }: Props) {
  const idx = list.findIndex((i) => i.id === item.id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const fromEmail = item.id.startsWith('att:');
  const isBlob = item.thumb?.startsWith('blob:');

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) onNav(prev);
      if (e.key === 'ArrowRight' && next) onNav(next);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [prev, next, onNav, onClose]);

  // A sideways swipe flips to the next or previous file; anything more up-and-down than sideways is left alone.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => {
      touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = touch.current;
      touch.current = null;
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0 && next) onNav(next);
      if (dx > 0 && prev) onNav(prev);
    },
  };

  return (
    <div className="lightbox" onClick={onClose} {...swipe}>
      <header className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <FileIcon kind={item.kind} size={14} />
        <div className="lb-title">
          <strong>{item.name}</strong>
          <small>
            {fmtSize(item.size)} · {fullDate(item.modified)}
          </small>
        </div>
        {item.threadId && (
          <button className="lb-btn" onClick={() => onOpenThread(item.threadId!)} title={t('Open related email')}>
            <Mail size={17} />
          </button>
        )}
        {isBlob && (
          <a className="lb-btn" href={item.thumb} download={item.name} title={t('Download')}>
            <Download size={17} />
          </a>
        )}
        {!fromEmail && (
          <>
            <button className={`lb-btn ${item.starred ? 'starred' : ''}`} onClick={() => onStar(item.id)} title={item.starred ? t('Unstar') : t('Star')}>
              <Star size={17} />
            </button>
            <button
              className="lb-btn"
              onClick={() => {
                onTrash(item.id);
                onClose();
              }}
              title={t('Move to trash')}
            >
              <Trash2 size={17} />
            </button>
          </>
        )}
        <button className="lb-btn" onClick={onClose} title={t('Close (Esc)')}>
          <X size={19} />
        </button>
      </header>

      <div className="lb-stage" key={item.id}>
        {item.kind === 'video' && isBlob ? (
          <video src={item.thumb} controls autoPlay onClick={(e) => e.stopPropagation()} />
        ) : item.thumb ? (
          <div className="lb-media" onClick={(e) => e.stopPropagation()}>
            <img src={item.thumb} alt={item.name} />
            {item.kind === 'video' && <span className="lb-note">{t('Sample video. Upload your own to play it here')}</span>}
          </div>
        ) : (
          <div className="lb-doc" onClick={(e) => e.stopPropagation()}>
            <FileIcon kind={item.kind} size={40} />
            <strong>{item.name}</strong>
            <span>{fmtSize(item.size)}</span>
            <small>{t('Previews for documents arrive with the real file server.')}</small>
          </div>
        )}
      </div>

      {prev && (
        <button className="lb-nav left" onClick={(e) => (e.stopPropagation(), onNav(prev))} aria-label={t('Previous file')}>
          <ChevronLeft size={24} />
        </button>
      )}
      {next && (
        <button className="lb-nav right" onClick={(e) => (e.stopPropagation(), onNav(next))} aria-label={t('Next file')}>
          <ChevronRight size={24} />
        </button>
      )}
      {list.length > 1 && idx >= 0 && (
        <div className="lb-count">
          {idx + 1} / {list.length}
        </div>
      )}
    </div>
  );
}
