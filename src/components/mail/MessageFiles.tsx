import { useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileArchive, HardDriveUpload, Image as ImageIcon, Share2, ShieldAlert, ShieldQuestion, FileText } from 'lucide-react';
import type { Attachment, DriveItem, Message, Thread } from '../../types';
import { fileKind, isUnusualName, extOf } from '../../mailAttachments';
import { useActionMenu } from '../ui/ActionSheet';
import { usePhone } from '../../mobile/media';
import { useStored } from '../../store';
import { FileIcon } from '../FileIcon';
import { AttachmentViewer, clickDownload, driveKind, sizeOf, type ViewItem } from './AttachmentViewer';
import { DriveFolderPicker } from './DriveFolderPicker';
import { inDrive, realFor, saveToDrive, zipUrl } from './attachApi';
import { toast } from '../../toast';
import { t, tn } from '../../i18n';
import '../../mailFiles.css';

/**
 * The files of one email in the reader, the way Gmail shows them: a row of cards (a picture's own preview, else the
 * file's kind), each opening the viewer; Download and Save to Drive on each; "Download all" (one zip) and "Save all to
 * Drive" when there are several. A blocked file shows why it wasn't kept; a file nobody scanned says so.
 */
export function MessageFiles({ thread, message }: { thread: Thread; message: Message }) {
  const phone = usePhone();
  const [drive] = useStored('drive');
  const files = (message.attachments ?? []).filter((a) => !a.inline);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState<{ atts: Attachment[]; anchor: HTMLElement | null } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const saveAllBtn = useRef<HTMLButtonElement>(null);
  if (!files.length) return null;
  const kept = files.filter((a) => a.url && !a.blocked);
  const saved = (a: Attachment) => inDrive(thread.id, a.name, drive as DriveItem[]);
  const unsaved = kept.filter((a) => !saved(a));
  const unscanned = kept.some((a) => a.scan !== 'clean');
  const sender = message.from.name || message.from.email;
  const items: ViewItem[] = files.map((a, i) => ({ key: `${message.id}/${i}`, att: a, threadId: thread.id, messageId: message.id, from: sender }));

  const scanNote = (
    <span className="mf-scan" title={t('No virus scanner checked these files. Open them only if you trust who sent them.')}>
      <ShieldQuestion size={14} /> {t('Not scanned for viruses')}
    </span>
  );
  const startSave = (atts: Attachment[], anchor: HTMLElement | null) => {
    anchorRef.current = anchor;
    setSaving({ atts, anchor });
  };
  const doSave = (atts: Attachment[], folderId: string | null, folder: string) =>
    void saveToDrive({ threadId: thread.id, messageId: message.id, atts, folderId, date: message.date }).then(
      (n) => toast({ text: tn(n, 'Saved {n} file to {folder}', 'Saved {n} files to {folder}', { folder }) }),
      (e: Error) => toast({ text: e.message, ms: 7000 }),
    );

  return (
    <div className={phone ? 'gm-atts' : 'mf'}>
      {(files.length > 1 || (unscanned && !phone)) && (
        <div className={phone ? 'gm-atts-head' : 'mf-head'}>
          <span className="mf-count">
            {files.length > 1 ? tn(files.length, '{n} attachment', '{n} attachments') : null}
            {unscanned && !phone && scanNote}
          </span>
          {kept.length > 1 && (
            <span className="mf-all">
              {realFor() && (
                <a className="link-btn" href={zipUrl(thread.id, message.id)} download>
                  {phone ? <FileArchive size={16} /> : null}
                  {t('Download all')}
                </a>
              )}
              {unsaved.length > 0 && (
                <button type="button" ref={saveAllBtn} className="link-btn" onClick={() => startSave(unsaved, saveAllBtn.current)}>
                  {t('Save all to Drive')}
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {unscanned && phone && <div className="mf-scanline">{scanNote}</div>}
      <div className={phone ? 'gm-att-row' : 'mf-row'}>
        {files.map((a, i) =>
          phone ? (
            <PhoneCard key={i} a={a} saved={saved(a)} onOpen={() => setOpen(i)} onSave={(el) => startSave([a], el)} />
          ) : (
            <DeskCard key={i} a={a} saved={saved(a)} onOpen={() => setOpen(i)} onSave={(el) => startSave([a], el)} />
          ),
        )}
      </div>
      {open !== null && (
        <AttachmentViewer
          items={items}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          saved={(it) => saved(it.att)}
          onSave={(it, el) => startSave([it.att], el)}
        />
      )}
      <DriveFolderPicker
        open={!!saving}
        onClose={() => setSaving(null)}
        anchor={saving?.anchor ? anchorRef : undefined}
        count={saving?.atts.length ?? 1}
        onPick={(id, name) => saving && doSave(saving.atts, id, name)}
      />
    </div>
  );
}

const thumbOf = (a: Attachment) => (a.url && !a.blocked && fileKind(a.name, a.type) === 'image' && !/\.(heic|heif)$/i.test(a.name) ? a.url : null);

/** Desktop: a tile with a preview and the name; Download and Save to Drive show on hover (and on focus). */
function DeskCard({ a, saved, onOpen, onSave }: { a: Attachment; saved: boolean; onOpen: () => void; onSave: (el: HTMLElement | null) => void }) {
  const saveBtn = useRef<HTMLButtonElement>(null);
  const thumb = thumbOf(a);
  const kind = fileKind(a.name, a.type);
  const warn = !a.blocked && isUnusualName(a.name);
  return (
    <div className={`mf-card${a.blocked ? ' blocked' : ''}`} title={a.blocked ? t(a.blocked) : `${a.name} · ${sizeOf(a)}`}>
      <button type="button" className="mf-open" onClick={onOpen} aria-label={a.blocked ? t('{name}: blocked', { name: a.name }) : t('Open {name}', { name: a.name })}>
        <span className="mf-preview">{a.blocked ? <ShieldAlert size={28} /> : thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="mf-ext"><FileIcon kind={driveKind(kind)} size={28} /><b>{extOf(a.name).toUpperCase().slice(0, 4)}</b></span>}</span>
        <span className="mf-name">
          {warn ? <AlertTriangle size={14} className="mf-warn" /> : <FileIcon kind={driveKind(kind)} size={14} />}
          <span>{a.name}</span>
        </span>
        <span className="mf-size">{a.blocked ? t('Blocked') : sizeOf(a)}</span>
      </button>
      {a.url && !a.blocked && (
        <span className="mf-tools">
          <button type="button" className="mf-tool" onClick={() => clickDownload(a)} title={t('Download')} aria-label={t('Download {name}', { name: a.name })}>
            <Download size={15} />
          </button>
          <button type="button" ref={saveBtn} className={`mf-tool${saved ? ' done' : ''}`} disabled={saved} onClick={() => onSave(saveBtn.current)} title={saved ? t('Saved to Drive') : t('Save to Drive')} aria-label={saved ? t('Saved to Drive') : t('Save {name} to Drive', { name: a.name })}>
            {saved ? <Check size={15} /> : <HardDriveUpload size={15} />}
          </button>
        </span>
      )}
    </div>
  );
}

/** Phones: Gmail's card (a preview, then the name). Tap opens the viewer; hold for Download, Save to Drive, Share. */
function PhoneCard({ a, saved, onOpen, onSave }: { a: Attachment; saved: boolean; onOpen: () => void; onSave: (el: HTMLElement | null) => void }) {
  const self = useRef<HTMLButtonElement>(null);
  const thumb = thumbOf(a);
  const img = fileKind(a.name, a.type) === 'image';
  const menu = useActionMenu(
    () => [
      ...(a.url && !a.blocked ? [{ label: t('Download'), icon: Download, run: () => clickDownload(a) }] : []),
      ...(a.url && !a.blocked ? [{ label: saved ? t('Saved to Drive') : t('Save to Drive'), icon: saved ? Check : HardDriveUpload, disabled: saved, run: () => onSave(null) }] : []),
      ...(a.url && !a.blocked && typeof navigator !== 'undefined' && 'share' in navigator ? [{ label: t('Share'), icon: Share2, run: () => void navigator.share({ title: a.name, url: new URL(a.url!, location.href).href }).catch(() => {}) }] : []),
    ],
    { title: a.name, disabled: !a.url || !!a.blocked },
  );
  return (
    <>
      <button type="button" ref={self} className={`gm-att lp${a.blocked ? ' blocked' : ''}`} title={a.blocked ? t(a.blocked) : `${a.name} · ${sizeOf(a)}`} onClick={onOpen} {...menu.bind}>
        <span className="gm-att-preview">{a.blocked ? <ShieldAlert size={24} /> : thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="gm-att-ext">{extOf(a.name).slice(0, 4).toUpperCase() || <FileText size={24} />}</span>}</span>
        <span className="gm-att-name">
          {a.blocked ? <ShieldAlert size={16} /> : isUnusualName(a.name) ? <AlertTriangle size={16} className="mf-warn" /> : img ? <ImageIcon size={16} /> : <FileText size={16} />}
          <span>{a.name}</span>
        </span>
      </button>
      {menu.menu}
    </>
  );
}
