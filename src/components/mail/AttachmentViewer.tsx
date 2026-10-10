import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, HardDriveUpload, Check, Loader2, Mail, MoreVertical, Share2, ShieldAlert, X } from 'lucide-react';
import type { Attachment, DriveKind } from '../../types';
import { fileKind, isUnusualName, previewWay, type FileKind } from '../../mailAttachments';
import { FileIcon } from '../FileIcon';
import { ActionSheet, type SheetAction } from '../ui/ActionSheet';
import { usePhone } from '../../mobile/media';
import { previewPage } from './attachApi';
import { fmtSize, parseSize } from '../../data/drive';
import { t } from '../../i18n';
import '../../mailFiles.css';

/** One file the viewer can show, with the email it came from (for "Open email" in the Files view). */
export interface ViewItem {
  key: string;
  att: Attachment;
  threadId?: string;
  messageId?: string;
  from?: string; // who sent it, for the warning on unusual files
}

export const driveKind = (k: FileKind): DriveKind => (k === 'text' ? 'doc' : k === 'archive' ? 'zip' : k);
export const sizeOf = (a: Attachment) => fmtSize(parseSize(a.size));

/**
 * Gmail's attachment viewer: the file on a dark stage, its name and size on top with Download, Save to Drive and
 * Close, arrows (and ←/→, and a sideways swipe on phones) to the email's other files. Pictures show as they are, PDFs
 * render here with pdf.js (no scripts), video and audio play, Word, Excel, PowerPoint, CSV and text come from the server
 * as a plain page in a sandboxed frame, and anything else says there's no preview, with Download.
 */
export function AttachmentViewer({
  items,
  index,
  onIndex,
  onClose,
  saved,
  onSave,
  onOpenEmail,
}: {
  items: ViewItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  saved?: (it: ViewItem) => boolean;
  onSave?: (it: ViewItem, anchor: HTMLElement | null) => void;
  onOpenEmail?: (it: ViewItem) => void;
}) {
  const phone = usePhone();
  const it = items[index];
  const prev = index > 0 ? index - 1 : null;
  const next = index < items.length - 1 ? index + 1 : null;
  const box = useRef<HTMLDivElement>(null);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);
  // A sideways swipe on phones: the files move with the finger and settle on the next one.
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const touch = useRef<{ x: number; y: number; side: boolean | null } | null>(null);

  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      // A menu or picker open over the viewer gets the keys first (Escape closes it, not the viewer).
      if (document.querySelector('.pop:not(.is-leaving), .sheet-scrim:not(.is-leaving)')) return;
      if (e.key === 'Escape') (e.stopPropagation(), onClose());
      else if (e.key === 'ArrowLeft' && prev !== null) onIndex(prev);
      else if (e.key === 'ArrowRight' && next !== null) onIndex(next);
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [prev, next, onIndex, onClose]);

  if (!it) return null;
  const a = it.att;
  const isSaved = !!saved?.(it);
  const unusual = isUnusualName(a.name);

  const go = (to: number | null, dir: 1 | -1) => {
    if (to === null) return setDx(0);
    const w = box.current?.clientWidth ?? innerWidth;
    setSettling(true);
    setDx(-dir * w);
    setTimeout(() => {
      setSettling(false);
      setDx(0);
      onIndex(to);
    }, 220);
  };
  const swipe = phone
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          touch.current = e.touches.length === 1 && !settling ? { x: e.touches[0].clientX, y: e.touches[0].clientY, side: null } : null;
        },
        onTouchMove: (e: React.TouchEvent) => {
          const s = touch.current;
          if (!s) return;
          const mx = e.touches[0].clientX - s.x;
          const my = e.touches[0].clientY - s.y;
          if (s.side === null && Math.hypot(mx, my) > 8) s.side = Math.abs(mx) > Math.abs(my) * 1.2;
          if (s.side) setDx((prev === null && mx > 0) || (next === null && mx < 0) ? mx / 4 : mx);
        },
        onTouchEnd: () => {
          const s = touch.current;
          touch.current = null;
          if (!s?.side) return;
          const w = box.current?.clientWidth ?? innerWidth;
          if (dx < -w * 0.2 && next !== null) go(next, 1);
          else if (dx > w * 0.2 && prev !== null) go(prev, -1);
          else {
            setSettling(true);
            setDx(0);
            setTimeout(() => setSettling(false), 220);
          }
        },
      }
    : {};

  const download = a.url ? (
    <a className="lb-btn" href={a.url} download={a.name} title={t('Download')} aria-label={t('Download {name}', { name: a.name })}>
      <Download size={18} />
    </a>
  ) : null;
  const actions = (): SheetAction[] => [
    ...(a.url ? [{ label: t('Download'), icon: Download, run: () => clickDownload(a) }] : []),
    ...(onSave && a.url ? [{ label: isSaved ? t('Saved to Drive') : t('Save to Drive'), icon: isSaved ? Check : HardDriveUpload, disabled: isSaved, run: () => onSave(it, moreBtn.current) }] : []),
    ...(onOpenEmail && it.threadId ? [{ label: t('Open email'), icon: Mail, run: () => onOpenEmail(it) }] : []),
    ...(a.url && typeof navigator !== 'undefined' && 'share' in navigator ? [{ label: t('Share'), icon: Share2, run: () => void navigator.share({ title: a.name, url: new URL(a.url!, location.href).href }).catch(() => {}) }] : []),
  ];

  const slide = (i: number | null, live: boolean) => (
    <div className="mv-slide" key={i === null ? `none-${live}` : items[i].key} aria-hidden={!live}>
      {i !== null && <Stage item={items[i]} live={live} />}
    </div>
  );

  return createPortal(
    <div ref={box} className="lightbox mail-viewer" role="dialog" aria-modal="true" aria-label={a.name} tabIndex={-1} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <header className="lb-bar mv-bar">
        {phone && (
          <button type="button" className="lb-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        )}
        {!phone && <FileIcon kind={driveKind(fileKind(a.name, a.type))} size={16} />}
        <div className="lb-title">
          <strong title={a.name}>{a.name}</strong>
          <small>
            {sizeOf(a)}
            {a.url && a.scan !== 'clean' && <span className="mv-unscanned">{t('Not scanned for viruses')}</span>}
          </small>
        </div>
        {phone ? (
          <button type="button" ref={moreBtn} className="lb-btn" onClick={() => setMore(true)} aria-label={t('More')}>
            <MoreVertical size={20} />
          </button>
        ) : (
          <>
            {onOpenEmail && it.threadId && (
              <button type="button" className="lb-btn" onClick={() => onOpenEmail(it)} title={t('Open email')} aria-label={t('Open email')}>
                <Mail size={18} />
              </button>
            )}
            {download}
            {onSave && a.url && (
              <button type="button" ref={saveBtn} className={`lb-btn${isSaved ? ' done' : ''}`} disabled={isSaved} onClick={() => onSave(it, saveBtn.current)} title={isSaved ? t('Saved to Drive') : t('Save to Drive')} aria-label={isSaved ? t('Saved to Drive') : t('Save to Drive')}>
                {isSaved ? <Check size={18} /> : <HardDriveUpload size={18} />}
              </button>
            )}
            <button type="button" className="lb-btn" onClick={onClose} title={t('Close (Esc)')} aria-label={t('Close')}>
              <X size={19} />
            </button>
          </>
        )}
      </header>
      {unusual && a.url && (
        <div className="mv-warn" role="note">
          <AlertTriangle size={16} />
          <span>{it.from ? t('This kind of file can hold code that runs when it’s opened. Open it only if you trust {name}.', { name: it.from }) : t('This kind of file can hold code that runs when it’s opened. Open it only if you trust who sent it.')}</span>
        </div>
      )}
      <div className="mv-viewport" {...swipe}>
        <div className={`mv-track${settling ? ' settling' : ''}`} style={{ transform: `translate3d(calc(-100% + ${dx}px), 0, 0)` }}>
          {slide(prev, false)}
          {slide(index, true)}
          {slide(next, false)}
        </div>
      </div>
      {!phone && prev !== null && (
        <button type="button" className="lb-nav left" onClick={() => onIndex(prev)} aria-label={t('Previous file')}>
          <ChevronLeft size={24} />
        </button>
      )}
      {!phone && next !== null && (
        <button type="button" className="lb-nav right" onClick={() => onIndex(next)} aria-label={t('Next file')}>
          <ChevronRight size={24} />
        </button>
      )}
      {items.length > 1 && (
        <div className="mv-foot">
          {phone && (
            <button type="button" className="lb-btn" disabled={prev === null} onClick={() => go(prev, -1)} aria-label={t('Previous file')}>
              <ChevronLeft size={20} />
            </button>
          )}
          <span className="lb-count-text">{t('{n} of {total}', { n: index + 1, total: items.length })}</span>
          {phone && (
            <button type="button" className="lb-btn" disabled={next === null} onClick={() => go(next, 1)} aria-label={t('Next file')}>
              <ChevronRight size={20} />
            </button>
          )}
        </div>
      )}
      {phone && <ActionSheet open={more} onClose={() => setMore(false)} anchor={moreBtn} menu actions={actions()} />}
    </div>,
    document.body,
  );
}

/** Starts a download of one file (the browser's own download, with its name). */
export function clickDownload(a: Attachment) {
  if (!a.url) return;
  const link = document.createElement('a');
  link.href = a.url;
  link.download = a.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** What's on the stage for one file. `live`: the one on screen (neighbours only show pictures, or a quiet card). */
function Stage({ item, live }: { item: ViewItem; live: boolean }) {
  const a = item.att;
  const way = a.blocked || !a.url ? 'none' : previewWay(a.name, a.type);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  if (a.blocked) return <NoPreview a={a} text={t(a.blocked)} icon={<ShieldAlert size={36} />} />;
  if (way === 'image' && !failed)
    return (
      <div className={`mv-image${zoom ? ' zoomed' : ''}`} onDoubleClick={() => setZoom((z) => !z)}>
        <img src={a.url} alt={a.name} draggable={false} onError={() => setFailed(true)} />
      </div>
    );
  if (!live) return <NoPreview a={a} quiet />;
  if (way === 'pdf') return <PdfView url={a.url!} name={a.name} />;
  if (way === 'media')
    return fileKind(a.name, a.type) === 'audio' ? (
      <div className="mv-card">
        <FileIcon kind="audio" size={40} />
        <strong>{a.name}</strong>
        <audio src={a.url} controls preload="metadata" />
      </div>
    ) : (
      <video className="mv-video" src={a.url} controls preload="metadata" playsInline />
    );
  if (way === 'converted') return <Converted a={a} />;
  return <NoPreview a={a} text={failed ? t('This picture can’t be shown here. Download it to open it.') : t('There’s no preview for this kind of file. Download it to open it.')} />;
}

function NoPreview({ a, text, icon, quiet }: { a: Attachment; text?: string; icon?: ReactNode; quiet?: boolean }) {
  return (
    <div className="mv-card">
      {icon ?? <FileIcon kind={driveKind(fileKind(a.name, a.type))} size={40} />}
      <strong>{a.name}</strong>
      <span className="mv-size">{sizeOf(a)}</span>
      {!quiet && text && <p>{text}</p>}
      {!quiet && a.url && !a.blocked && (
        <a className="primary-btn" href={a.url} download={a.name}>
          <Download size={15} /> {t('Download')}
        </a>
      )}
    </div>
  );
}

/** Word, Excel, PowerPoint, CSV and text: the server's plain page, in a frame with no scripts and no way out. */
function Converted({ a }: { a: Attachment }) {
  const [page, setPage] = useState<{ html: string } | { none: string } | null>(null);
  useEffect(() => {
    let on = true;
    setPage(null);
    void previewPage(a.url!, document.documentElement.dataset.theme === 'dark').then((p) => on && setPage(p));
    return () => void (on = false);
  }, [a.url]);
  if (!page) return <Loading />;
  if ('none' in page) return <NoPreview a={a} text={page.none} />;
  return <iframe className="mv-frame" title={a.name} sandbox="" srcDoc={page.html} referrerPolicy="no-referrer" />;
}

function Loading() {
  return (
    <div className="mv-loading" role="status" aria-label={t('Loading the preview')}>
      <Loader2 size={24} className="spin" />
    </div>
  );
}

/**
 * A PDF drawn here with pdf.js (loaded only when a PDF is opened): pages as pictures, drawn as they scroll into view.
 * PDF scripts never run (pdf.js doesn't run them, and eval is off).
 */
function PdfView({ url, name }: { url: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [pages, setPages] = useState<{ n: number; ratio: number }[]>([]);
  const docRef = useRef<{ getPage: (n: number) => Promise<any>; destroy: () => Promise<void> } | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const data = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
        // pdf.js runs no PDF scripts (scripting is a separate viewer part we don't load), and no forms (XFA).
        const task = pdfjs.getDocument({ data, enableXfa: false });
        const doc = await task.promise;
        if (!on) return void task.destroy();
        docRef.current = { getPage: (n) => doc.getPage(n), destroy: () => task.destroy() };
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setPages(Array.from({ length: Math.min(doc.numPages, 500) }, (_, i) => ({ n: i + 1, ratio: vp.height / vp.width })));
        setState('ready');
      } catch {
        if (on) setState('failed');
      }
    })();
    return () => {
      on = false;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    if (state !== 'ready' || !host.current) return;
    const drawn = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const n = Number((e.target as HTMLElement).dataset.page);
          if (drawn.has(n)) continue;
          drawn.add(n);
          void (async () => {
            const doc = docRef.current;
            if (!doc) return;
            const page = await doc.getPage(n);
            const box = e.target as HTMLElement;
            const base = page.getViewport({ scale: 1 });
            const scale = (box.clientWidth / base.width) * Math.min(devicePixelRatio || 1, 2);
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            box.style.aspectRatio = `${base.width} / ${base.height}`;
            await page.render({ canvas, viewport: vp }).promise;
            box.replaceChildren(canvas);
          })().catch(() => {});
        }
      },
      { root: host.current, rootMargin: '600px 0px' },
    );
    host.current.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [state, pages]);

  if (state === 'failed') return <NoPreview a={{ name, size: '', url }} text={t('This PDF couldn’t be shown here. Download it to open it.')} />;
  if (state === 'loading') return <Loading />;
  return (
    <div ref={host} className="mv-pdf" aria-label={name}>
      {pages.map((p) => (
        <div key={p.n} className="mv-page" data-page={p.n} style={{ aspectRatio: `1 / ${p.ratio}` }} aria-label={t('Page {n}', { n: p.n })} />
      ))}
    </div>
  );
}
