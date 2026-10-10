import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Link2, Loader2, Paperclip, RotateCcw, X } from 'lucide-react';
import { fileKind, isBlockedName, isUnusualName, linksNeeded } from '../../mailAttachments';
import { fmtSize } from '../../data/drive';
import { FileIcon } from '../FileIcon';
import { driveKind } from './AttachmentViewer';
import { realFor, uploadForMail, type DraftFile, type LinkAccess } from './attachApi';
import { wasSkipped } from '../../sync';
import { toast } from '../../toast';
import { t, tn } from '../../i18n';
import '../../mailFiles.css';

/** A file as Compose and the reply boxes hand it on: its address, and whether it goes as a Drive link. */
export interface OutFile {
  name: string;
  size: number;
  url: string;
  type?: string;
  link?: boolean;
}

let seq = 0;
const key = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * The files of an email being written: each one uploads to the server the moment it's added (so drafts, scheduled
 * mail and the sent copy keep it), refused types are turned away at once, and once the email would pass 25 MB the
 * files that don't fit become Drive links. `bodyBytes`: how big the words are.
 */
export function useDraftFiles(initial: OutFile[] = [], bodyBytes = 0) {
  const [files, setFiles] = useState<DraftFile[]>(() => initial.map((f) => ({ key: key(), name: f.name, size: f.size, type: f.type, url: f.url, state: 'done', link: f.link })));
  const live = useRef(true);
  useEffect(() => () => void (live.current = false), []);
  const linked = useMemo(() => linksNeeded(files, bodyBytes), [files, bodyBytes]);

  const upload = (k: string, file: File) =>
    void uploadForMail(file).then(
      (up) => live.current && setFiles((fs) => fs.map((f) => (f.key === k ? { ...f, url: up.url, type: up.type, state: 'done', error: undefined } : f))),
      (e: Error) => {
        if (!live.current) return;
        // "Not now" on the big-file question: the file just isn't added.
        if (wasSkipped(e)) return setFiles((fs) => fs.filter((f) => f.key !== k));
        setFiles((fs) => fs.map((f) => (f.key === k ? { ...f, state: 'failed', error: e.message } : f)));
      },
    );
  const pending = useRef(new Map<string, File>());

  return {
    files,
    /** Which files go as links (by key). */
    linked: new Set(files.filter((_, i) => linked.has(i)).map((f) => f.key)),
    busy: files.some((f) => f.state === 'uploading'),
    failed: files.some((f) => f.state === 'failed'),
    add(list: FileList | File[] | null) {
      const all = Array.from(list ?? []);
      const blocked = all.filter((f) => isBlockedName(f.name));
      if (blocked.length) toast({ text: blocked.length === 1 ? t('{name} can’t be attached: this kind of file can run programs, so email doesn’t carry it (as in Gmail).', { name: blocked[0].name }) : t('{n} files can’t be attached: these kinds of files can run programs, so email doesn’t carry them (as in Gmail).', { n: blocked.length }), ms: 8000 });
      const ok = all.filter((f) => !isBlockedName(f.name));
      const fresh = ok.map((f) => ({ key: key(), name: f.name, size: f.size, type: f.type, url: '', state: 'uploading' as const }));
      setFiles((fs) => [...fs, ...fresh]);
      fresh.forEach((f, i) => (pending.current.set(f.key, ok[i]), upload(f.key, ok[i])));
    },
    /** Files already on the server (from Drive): as attachments, or as links. */
    addExisting(list: OutFile[]) {
      setFiles((fs) => [...fs, ...list.filter((f) => !fs.some((x) => x.url === f.url)).map((f) => ({ key: key(), name: f.name, size: f.size, type: f.type, url: f.url, state: 'done' as const, link: f.link }))]);
    },
    retry(k: string) {
      const file = pending.current.get(k);
      if (!file) return;
      setFiles((fs) => fs.map((f) => (f.key === k ? { ...f, state: 'uploading', error: undefined } : f)));
      upload(k, file);
    },
    clear() {
      pending.current.clear();
      setFiles([]);
    },
    remove(k: string) {
      pending.current.delete(k);
      setFiles((fs) => fs.filter((f) => f.key !== k));
    },
    /** What goes with the email: uploaded files, each marked when it goes as a link. */
    out(): OutFile[] {
      return files.flatMap((f, i) => (f.state === 'done' && f.url ? [{ name: f.name, size: f.size, url: f.url, type: f.type, ...(linked.has(i) ? { link: true } : {}) }] : []));
    },
  };
}
export type DraftFilesState = ReturnType<typeof useDraftFiles>;

/**
 * The files under what's written: a chip each (uploading with a bar, failed with Retry, a link marked as one), and when
 * some go as links, a plain note and who can open them.
 */
export function DraftFilesList({ state, access, onAccess }: { state: DraftFilesState; access?: LinkAccess; onAccess?: (a: LinkAccess) => void }) {
  const { files, linked } = state;
  if (!files.length) return null;
  const links = files.filter((f) => linked.has(f.key));
  const canLink = realFor();
  return (
    <div className="df">
      {links.length > 0 && (
        <div className="df-note" role="note">
          <Link2 size={16} />
          <div>
            <p>{canLink ? tn(links.length, 'Emails carry up to 25 MB, so {n} file goes as a Drive link instead of an attachment.', 'Emails carry up to 25 MB, so {n} files go as Drive links instead of attachments.') : t('Emails carry up to 25 MB. The demo company can’t share Drive links, so this email may be too big to send.')}</p>
            {canLink && !onAccess && <p className="df-sub">{t('Only the people on this conversation can open them.')}</p>}
            {canLink && onAccess && (
              <div className="segmented df-access" role="radiogroup" aria-label={t('Who can open the links')}>
                <button type="button" role="radio" aria-checked={access === 'recipients'} className={access === 'recipients' ? 'on' : ''} onClick={() => onAccess('recipients')}>
                  {t('Only the recipients')}
                </button>
                <button type="button" role="radio" aria-checked={access === 'anyone'} className={access === 'anyone' ? 'on' : ''} onClick={() => onAccess('anyone')}>
                  {t('Anyone with the link')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="df-list">
        {files.map((f) => {
          const link = linked.has(f.key) && canLink;
          return (
            <div key={f.key} className={`file-chip df-chip ${f.state}${link ? ' link' : ''}`} title={f.state === 'failed' ? f.error : f.name}>
              {f.state === 'uploading' ? <Loader2 size={15} className="spin" /> : f.state === 'failed' ? <AlertTriangle size={15} className="df-bad" /> : link ? <Link2 size={15} /> : isUnusualName(f.name) ? <AlertTriangle size={15} className="mf-warn" /> : <FileIcon kind={driveKind(fileKind(f.name, f.type))} size={15} />}
              <span className="fc-name">{f.name}</span>
              <span className="fc-size">{f.state === 'failed' ? t('Didn’t upload') : link ? t('Drive link') : fmtSize(f.size)}</span>
              {f.state === 'failed' && (
                <button type="button" onClick={() => state.retry(f.key)} aria-label={t('Try {name} again', { name: f.name })} title={t('Try again')}>
                  <RotateCcw size={13} />
                </button>
              )}
              <button type="button" onClick={() => state.remove(f.key)} aria-label={t('Remove {name}', { name: f.name })} title={t('Remove attachment')}>
                <X size={13} />
              </button>
              {f.state === 'uploading' && <span className="df-bar" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A paperclip that opens the file picker (for the reply boxes). */
export function AttachButton({ onFiles, className = 'icon-btn', size = 17 }: { onFiles: (f: FileList | null) => void; className?: string; size?: number }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()} title={t('Attach files')} aria-label={t('Attach files')}>
        <Paperclip size={size} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}
