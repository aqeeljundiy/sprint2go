import { useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Menu, Paperclip, Search, User, X } from 'lucide-react';
import type { DriveItem, Thread } from '../../types';
import { mailFiles, type FileKind, type MailFile } from '../../mailAttachments';
import { Popover } from '../ui/Popover';
import { EmptyState } from '../ui/EmptyState';
import { FileIcon } from '../FileIcon';
import { AttachmentViewer, driveKind, sizeOf, type ViewItem } from './AttachmentViewer';
import { DriveFolderPicker } from './DriveFolderPicker';
import { inDrive, saveToDrive } from './attachApi';
import { useStored } from '../../store';
import { usePhone } from '../../mobile/media';
import { toast } from '../../toast';
import { fmtAgo, fmtDay } from '../../i18n/format';
import { mark, t, tn, tx } from '../../i18n';
import '../../mailFiles.css';

const KINDS: { id: string; label: string; kinds: FileKind[] }[] = [
  { id: 'all', label: mark('All'), kinds: [] },
  { id: 'image', label: mark('Images'), kinds: ['image'] },
  { id: 'pdf', label: mark('PDFs'), kinds: ['pdf'] },
  { id: 'doc', label: mark('Documents'), kinds: ['doc', 'text'] },
  { id: 'sheet', label: mark('Spreadsheets'), kinds: ['sheet'] },
  { id: 'slides', label: mark('Presentations'), kinds: ['slides'] },
  { id: 'media', label: mark('Video and audio'), kinds: ['video', 'audio'] },
  { id: 'other', label: mark('Other'), kinds: ['archive', 'other'] },
];
const WHEN: { id: string; label: string; days: number }[] = [
  { id: 'any', label: mark('Any time'), days: 0 },
  { id: 'week', label: mark('Past week'), days: 7 },
  { id: 'month', label: mark('Past month'), days: 31 },
  { id: 'year', label: mark('Past year'), days: 366 },
];
const PAGE = 120;

/**
 * Every attachment in one place (Mail, Files): all the files in this person's mail, newest first, by kind, sender,
 * date and name. A file opens in the viewer, with the others to flip through; "Open email" goes to where it came from.
 */
export function FilesView({ threads, onOpenThread, onMenu }: { threads: Thread[]; onOpenThread: (id: string) => void; onMenu: () => void }) {
  const phone = usePhone();
  const [drive] = useStored('drive');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [from, setFrom] = useState<{ email: string; name: string } | null>(null);
  const [when, setWhen] = useState('any');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState<MailFile | null>(null);
  const [fromOpen, setFromOpen] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [fromQ, setFromQ] = useState('');
  const fromBtn = useRef<HTMLButtonElement>(null);
  const whenBtn = useRef<HTMLButtonElement>(null);
  const saveAnchor = useRef<HTMLElement | null>(null);

  const all = useMemo(() => mailFiles(threads).filter((f) => !f.att.blocked), [threads]);
  const senders = useMemo(() => {
    const m = new Map<string, { email: string; name: string; n: number }>();
    for (const f of all) {
      const e = f.from.email.toLowerCase();
      const cur = m.get(e);
      m.set(e, { email: e, name: cur?.name || f.from.name || e, n: (cur?.n ?? 0) + 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [all]);
  const days = WHEN.find((w) => w.id === when)?.days ?? 0;
  const list = useMemo(() => {
    const after = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
    return mailFiles(threads, { q: q.trim() || undefined, kinds: KINDS.find((k) => k.id === kind)?.kinds, from: from?.email, after }).filter((f) => !f.att.blocked);
  }, [threads, q, kind, from, days]);
  const items: ViewItem[] = list.map((f) => ({ key: f.key, att: f.att, threadId: f.threadId, messageId: f.messageId, from: f.from.name || f.from.email }));
  const filtered = !!q.trim() || kind !== 'all' || !!from || when !== 'any';
  const clear = () => (setQ(''), setKind('all'), setFrom(null), setWhen('any'), setShown(PAGE));
  const saved = (f: { threadId?: string; att: { name: string } }) => !!f.threadId && inDrive(f.threadId, f.att.name, drive as DriveItem[]);
  const fromWords = fromQ.trim().toLowerCase();

  return (
    <section className="tracking-pane files-pane view-enter">
      <header className="tracking-head">
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label={t('Open menu')}>
          <Menu size={18} />
        </button>
        <div>
          <h1>{t('Files')}</h1>
          <p>{t('Every file in your mail, newest first')}</p>
        </div>
      </header>
      <div className="fv-tools">
        <label className="fv-search">
          <Search size={16} />
          <input value={q} onChange={(e) => (setQ(e.target.value), setShown(PAGE))} placeholder={t('Search by file name')} aria-label={t('Search by file name')} />
          {q && (
            <button type="button" className="fv-clear" onClick={() => setQ('')} aria-label={t('Clear')}>
              <X size={14} />
            </button>
          )}
        </label>
        <div className="fv-chips" role="toolbar" aria-label={t('Filters')}>
          <button type="button" ref={fromBtn} className={`fv-chip${from ? ' on' : ''}`} onClick={() => setFromOpen(true)} aria-haspopup="dialog">
            <User size={14} /> <span>{from ? from.name : tx('mail', 'From')}</span> <ChevronDown size={14} />
          </button>
          <button type="button" ref={whenBtn} className={`fv-chip${when !== 'any' ? ' on' : ''}`} onClick={() => setWhenOpen(true)} aria-haspopup="menu">
            <CalendarDays size={14} /> <span>{t(WHEN.find((w) => w.id === when)!.label)}</span> <ChevronDown size={14} />
          </button>
          <span className="fv-sep" aria-hidden="true" />
          {KINDS.map((k) => (
            <button key={k.id} type="button" className={`fv-chip${kind === k.id ? ' on' : ''}`} aria-pressed={kind === k.id} onClick={() => (setKind(k.id), setShown(PAGE))}>
              {t(k.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="fv-scroll">
        {!list.length ? (
          <EmptyState
            icon={<Paperclip size={28} />}
            title={filtered ? t('No files match') : t('No files yet')}
            text={filtered ? t('Try another name or fewer filters.') : t('Files people send you, and files you send, show up here.')}
            action={
              filtered ? (
                <button type="button" className="ghost-btn" onClick={clear}>
                  {t('Clear filters')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className={phone ? 'fv-list' : 'fv-grid'}>
              {list.slice(0, shown).map((f, i) => (
                <button key={f.key} type="button" className="fv-item" style={{ ['--i' as string]: Math.min(i, 12) }} onClick={() => setOpen(i)} title={`${f.att.name} · ${sizeOf(f.att)}`}>
                  <span className="fv-thumb">{f.kind === 'image' && f.att.url && !/\.(heic|heif)$/i.test(f.att.name) ? <img src={f.att.url} alt="" loading="lazy" /> : <FileIcon kind={driveKind(f.kind)} size={phone ? 20 : 28} />}</span>
                  <span className="fv-text">
                    <span className="fv-name">{f.att.name}</span>
                    <span className="fv-meta">{t('{who}, {when}', { who: f.from.name || f.from.email, when: phone ? fmtAgo(f.date) : fmtDay(f.date) })}</span>
                  </span>
                  <span className="fv-size">{sizeOf(f.att)}</span>
                </button>
              ))}
            </div>
            {list.length > shown && (
              <div className="fv-more">
                <button type="button" className="ghost-btn" onClick={() => setShown((n) => n + PAGE)}>
                  {tn(list.length - shown, 'Show {n} more file', 'Show {n} more files')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {open !== null && items[open] && (
        <AttachmentViewer
          items={items}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          saved={saved}
          onSave={(it, el) => {
            saveAnchor.current = el;
            setSaving(list.find((f) => f.key === it.key) ?? null);
          }}
          onOpenEmail={(it) => {
            setOpen(null);
            if (it.threadId) onOpenThread(it.threadId);
          }}
        />
      )}
      <DriveFolderPicker
        open={!!saving}
        onClose={() => setSaving(null)}
        anchor={saveAnchor.current ? saveAnchor : undefined}
        onPick={(folderId, name) =>
          saving &&
          void saveToDrive({ threadId: saving.threadId, messageId: saving.messageId, atts: [saving.att], folderId, date: saving.date }).then(
            (n) => toast({ text: tn(n, 'Saved {n} file to {folder}', 'Saved {n} files to {folder}', { folder: name }) }),
            (e: Error) => toast({ text: e.message, ms: 7000 }),
          )
        }
      />
      <Popover anchor={fromBtn} open={fromOpen} onClose={() => (setFromOpen(false), setFromQ(''))} width={300} title={tx('mail', 'From')}>
        <div className="mail-pick in-pop fv-from">
          <label className="dfp-search">
            <Search size={16} />
            <input value={fromQ} onChange={(e) => setFromQ(e.target.value)} placeholder={t('Find a person')} aria-label={t('Find a person')} autoFocus={!phone} />
          </label>
          <div className="as-list" role="menu">
            {!fromWords && (
              <button type="button" role="menuitemradio" aria-checked={!from} className="as-item" onClick={() => (setFrom(null), setFromOpen(false))}>
                <span className="as-label">{t('Anyone')}</span>
                {!from && <Check size={16} className="as-icon" />}
              </button>
            )}
            {senders
              .filter((s) => !fromWords || s.name.toLowerCase().includes(fromWords) || s.email.includes(fromWords))
              .slice(0, 60)
              .map((s) => (
                <button key={s.email} type="button" role="menuitemradio" aria-checked={from?.email === s.email} className="as-item" onClick={() => (setFrom(s), setFromOpen(false), setFromQ(''), setShown(PAGE))}>
                  <span className="as-label">
                    {s.name}
                    <small>{s.email}</small>
                  </span>
                  {from?.email === s.email && <Check size={16} className="as-icon" />}
                </button>
              ))}
          </div>
        </div>
      </Popover>
      <Popover anchor={whenBtn} open={whenOpen} onClose={() => setWhenOpen(false)} width={220} title={t('When')}>
        <div className="mail-pick in-pop">
          <div className="as-list" role="menu">
            {WHEN.map((w) => (
              <button key={w.id} type="button" role="menuitemradio" aria-checked={when === w.id} className="as-item" onClick={() => (setWhen(w.id), setWhenOpen(false), setShown(PAGE))}>
                <span className="as-label">{t(w.label)}</span>
                {when === w.id && <Check size={16} className="as-icon" />}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </section>
  );
}
