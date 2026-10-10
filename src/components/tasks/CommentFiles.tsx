import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Paperclip, Upload, X } from 'lucide-react';
import type { CommentFile } from '../../types';
import { uploadFile, wasSkipped } from '../../sync';
import { fmtSize, kindOf } from '../../data/drive';
import { toast } from '../../toast';
import { FileIcon } from '../FileIcon';
import { ActionSheet } from '../ui/ActionSheet';
import { useLeaving } from '../ui/Smooth';
import { t } from '../../i18n';

/*
 * Files on a task's comments: the paperclip in the comment bar, the files waiting to go with the comment, and the
 * cards under a comment. Uploads go through uploadFile (src/sync.ts) like Drive's and chat's, so they count toward
 * the company's storage and "Ask before saving big files" asks first. A card opens the file from the server, which
 * decides what may open in the browser (images, video, audio, PDF, plain text) and downloads everything else.
 */

/** Only our own uploads open from a card; the demo company's inline files are saved instead (never opened as a page). */
const fromServer = (url: string) => /^\/api\/files\/[a-f0-9]{32}$/.test(url);
const inline = (url: string) => /^data:[\w.+-]+\/[\w.+-]+;base64,/.test(url);
const openable = (url: string) => fromServer(url) || inline(url);
const isImage = (f: Pick<CommentFile, 'type' | 'name'>) => kindOf(f) === 'image' && !/svg/i.test(f.type);

interface Waiting {
  key: string;
  name: string;
  size: number;
  type: string;
  preview?: string; // an object URL while an image uploads
  file?: CommentFile; // set once it's on the server
}

/** The files someone is about to send with a comment: they upload as soon as they're picked. */
export function useCommentFiles(wsId: string) {
  const [items, setItems] = useState<Waiting[]>([]);
  const alive = useRef(true);
  const seen = useRef<Waiting[]>([]);
  useEffect(
    () => () => {
      alive.current = false;
      seen.current.forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
    },
    [],
  );
  const add = (list: FileList | File[] | null | undefined) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const fresh = files.map((f) => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: f.name || t('Photo'), size: f.size, type: f.type || 'application/octet-stream', preview: f.type.startsWith('image/') && typeof URL !== 'undefined' ? URL.createObjectURL(f) : undefined }));
    setItems((xs) => [...xs, ...fresh]);
    files.forEach((f, i) => {
      const w = fresh[i];
      uploadFile(f, wsId, w.name).then(
        (r) => alive.current && setItems((xs) => xs.map((x) => (x.key === w.key ? { ...x, file: { name: r.name, size: r.size, type: r.type, url: r.url } } : x))),
        (e) => {
          if (!alive.current) return;
          setItems((xs) => xs.filter((x) => x.key !== w.key));
          if (!wasSkipped(e)) toast({ text: e instanceof Error && e.message ? e.message : t('The upload failed.') });
        },
      );
    });
  };
  const remove = (key: string) => setItems((xs) => xs.filter((x) => x.key !== key));
  // Previews are let go when their file leaves the list.
  useEffect(() => {
    const keep = new Set(items.map((x) => x.key));
    seen.current.filter((x) => !keep.has(x.key) && x.preview).forEach((x) => setTimeout(() => URL.revokeObjectURL(x.preview!), 400));
    seen.current = items;
  }, [items]);
  return {
    items,
    add,
    remove,
    clear: () => setItems([]),
    /** Still uploading: the comment waits. */
    busy: items.some((x) => !x.file),
    files: items.filter((x) => x.file).map((x) => x.file!),
  };
}
export type CommentFilesState = ReturnType<typeof useCommentFiles>;

/**
 * The paperclip. On a computer it opens the file picker (several at once); on a phone a small sheet with the camera
 * first, then files (Drive's New sheet does the same).
 */
export function AttachButton({ state, phone, className = 'icon-btn' }: { state: CommentFilesState; phone: boolean; className?: string }) {
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const take = (input: HTMLInputElement) => {
    state.add(input.files);
    input.value = '';
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`cf-clip ${className}`}
        aria-label={t('Attach files')}
        title={t('Attach files')}
        // Keeps the field's focus (and the phone's keyboard) while the picker opens.
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => (phone ? setMenu(true) : pick.current?.click())}
      >
        <Paperclip size={phone ? 20 : 16} />
      </button>
      <input ref={pick} type="file" multiple hidden onChange={(e) => take(e.currentTarget)} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.currentTarget)} />
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={t('Attach files')}
        anchor={btn}
        actions={[
          { label: t('Take a photo'), icon: Camera, run: () => camera.current?.click() },
          { label: t('Upload a file'), icon: Upload, run: () => pick.current?.click() },
        ]}
      />
    </>
  );
}

/** The files going with the comment, above the field: a picture or an icon, the name, and X to take it off. */
export function WaitingFiles({ state }: { state: CommentFilesState }) {
  const rows = useLeaving(state.items, (x) => x.key, 180);
  if (!rows.length) return null;
  return (
    <ul className="cf-waiting" aria-label={t('Files to send')}>
      {rows.map(({ item: x, leaving }) => (
        <li key={x.key} className={`cf-chip${leaving ? ' leaving' : ''}${x.file ? '' : ' up'}`}>
          <span className="cf-chip-pic" aria-hidden="true">
            {x.preview ? <img src={x.preview} alt="" /> : <FileIcon kind={kindOf(x)} size={16} />}
            {!x.file && (
              <span className="cf-spin">
                <Loader2 size={16} />
              </span>
            )}
          </span>
          <span className="cf-chip-text">
            <span className="cf-name">{x.name}</span>
            <small>{x.file ? fmtSize(x.size) : t('Uploading…')}</small>
          </span>
          <button type="button" className="cf-chip-x" onPointerDown={(e) => e.preventDefault()} onClick={() => state.remove(x.key)} aria-label={t('Remove {name}', { name: x.name })}>
            <X size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Under a comment: pictures as small previews, other files as cards with their name and size. */
export function FileCards({ files }: { files?: CommentFile[] }) {
  if (!files?.length) return null;
  return (
    <div className="cf-cards">
      {files.map((f, i) => {
        const ok = openable(f.url);
        const pic = ok && isImage(f);
        const body = (
          <>
            {pic ? (
              <span className="cf-thumb">
                <img src={f.url} alt="" loading="lazy" />
              </span>
            ) : (
              <span className="cf-icon" aria-hidden="true">
                <FileIcon kind={kindOf(f)} size={16} />
              </span>
            )}
            <span className="cf-card-text">
              <span className="cf-name">{f.name}</span>
              <small>{fmtSize(f.size)}</small>
            </span>
          </>
        );
        return ok ? (
          <a key={`${f.url}-${i}`} className={`cf-card${pic ? ' pic' : ''}`} href={f.url} title={f.name} {...(fromServer(f.url) ? { target: '_blank', rel: 'noopener noreferrer' } : { download: f.name })}>
            {body}
          </a>
        ) : (
          <span key={`${f.url}-${i}`} className="cf-card off" title={f.name}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

/** Pasted or dropped files go with the comment too (desktop): the handlers for the comment bar. */
export function dropFiles(state: CommentFilesState) {
  return {
    onPaste: (e: React.ClipboardEvent) => {
      const files = [...e.clipboardData.files];
      if (files.length) (e.preventDefault(), state.add(files));
    },
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      state.add(e.dataTransfer.files);
    },
  };
}
