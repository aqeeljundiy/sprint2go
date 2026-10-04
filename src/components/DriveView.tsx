import { useMemo, useState } from 'react';
import { ChevronRight, LayoutGrid, List, Mail, Menu, Play, RotateCcw, Search, Star, Trash2, Upload, X } from 'lucide-react';
import type { DriveItem, DriveSection } from '../types';
import { fmtSize } from '../data/drive';
import { relative } from '../utils';
import { usePersisted } from '../settings';
import { DRIVE_SECTIONS } from './DriveSidebar';
import { FileIcon } from './FileIcon';

interface Props {
  items: DriveItem[]; // everything, including attachments from email
  section: DriveSection;
  folderId: string | null;
  renamingId: string | null;
  senderOf: (threadId: string) => string;
  onFolder: (id: string | null) => void;
  onSection: (s: DriveSection) => void;
  onOpen: (item: DriveItem, list: DriveItem[]) => void;
  onStar: (id: string) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onStartRename: (id: string) => void;
  onRename: (id: string, name: string | null) => void;
  onPickFiles: () => void;
  onDropFiles: (files: FileList) => void;
  onOpenThread: (threadId: string) => void;
  onMenu: () => void;
}

const byName = (a: DriveItem, b: DriveItem) => a.name.localeCompare(b.name, undefined, { numeric: true });
const byDate = (a: DriveItem, b: DriveItem) => b.modified.localeCompare(a.modified);

export function DriveView(props: Props) {
  const { items, section, folderId } = props;
  const [layout, setLayout] = usePersisted<'grid' | 'list'>('pm-drive-layout', 'grid');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);

  const live = items.filter((i) => !i.trashed);
  const q = query.trim().toLowerCase();

  const shown = useMemo(() => {
    if (q) return live.filter((i) => i.name.toLowerCase().includes(q)).sort(byName);
    switch (section) {
      case 'my':
        return live.filter((i) => i.parentId === folderId && !i.id.startsWith('att:')).sort(byName);
      case 'recent':
        return live.filter((i) => i.kind !== 'folder').sort(byDate).slice(0, 30);
      case 'media':
        return live.filter((i) => i.kind === 'image' || i.kind === 'video').sort(byDate);
      case 'email':
        return live.filter((i) => i.id.startsWith('att:')).sort(byDate);
      case 'starred':
        return live.filter((i) => i.starred).sort(byName);
      case 'trash':
        return items.filter((i) => i.trashed).sort(byDate);
    }
  }, [items, section, folderId, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const folders = shown.filter((i) => i.kind === 'folder');
  const files = shown.filter((i) => i.kind !== 'folder');

  // Breadcrumb for My Drive
  const crumbs: DriveItem[] = [];
  for (let id = folderId; id; ) {
    const f = items.find((i) => i.id === id);
    if (!f) break;
    crumbs.unshift(f);
    id = f.parentId;
  }

  const sectionName = DRIVE_SECTIONS.find((s) => s.id === section)!.name;
  const open = (item: DriveItem) => (item.kind === 'folder' ? props.onFolder(item.id) : props.onOpen(item, files));

  const meta = (i: DriveItem) =>
    section === 'email' && i.threadId
      ? `${props.senderOf(i.threadId)} · ${relative(i.modified)}`
      : i.kind === 'folder'
        ? `${items.filter((x) => x.parentId === i.id && !x.trashed).length} items`
        : `${fmtSize(i.size)} · ${relative(i.modified)}`;

  const actions = (i: DriveItem) =>
    section === 'trash' ? (
      <>
        <button className="icon-btn sm" title="Restore" onClick={() => props.onRestore(i.id)}>
          <RotateCcw size={14} />
        </button>
        <button className="icon-btn sm" title="Delete forever" onClick={() => props.onDeleteForever(i.id)}>
          <X size={14} />
        </button>
      </>
    ) : i.id.startsWith('att:') ? (
      <button className="icon-btn sm" title="Open email" onClick={() => props.onOpenThread(i.threadId!)}>
        <Mail size={14} />
      </button>
    ) : (
      <>
        <button className={`icon-btn sm ${i.starred ? 'starred' : ''}`} title={i.starred ? 'Unstar' : 'Star'} onClick={() => props.onStar(i.id)}>
          <Star size={14} />
        </button>
        <button className="icon-btn sm" title="Move to trash" onClick={() => props.onTrash(i.id)}>
          <Trash2 size={14} />
        </button>
      </>
    );

  const name = (i: DriveItem) =>
    props.renamingId === i.id ? (
      <input
        className="rename-input"
        autoFocus
        defaultValue={i.name}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => props.onRename(i.id, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') props.onRename(i.id, null);
        }}
      />
    ) : (
      <span
        className="d-name"
        title={i.name}
        onDoubleClick={(e) => {
          if (section === 'trash' || i.id.startsWith('att:')) return;
          e.stopPropagation();
          props.onStartRename(i.id);
        }}
      >
        {i.name}
      </span>
    );

  const thumb = (i: DriveItem) =>
    i.thumb ? (
      <span className="d-thumb">
        <img src={i.thumb} alt="" loading="lazy" draggable={false} />
        {i.kind === 'video' && (
          <span className="play">
            <Play size={14} fill="currentColor" />
            {i.duration}
          </span>
        )}
      </span>
    ) : (
      <span className={`d-thumb icon-thumb k-${i.kind}`}>
        <FileIcon kind={i.kind} size={22} />
      </span>
    );

  return (
    <section
      className={`drive-pane view-enter ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (section === 'trash' || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) props.onDropFiles(e.dataTransfer.files);
      }}
    >
      <header className="drive-head">
        <button className="icon-btn menu-btn" onClick={props.onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="crumbs">
          {q ? (
            <h1>Search results</h1>
          ) : section === 'my' ? (
            <>
              <button className={crumbs.length ? 'crumb' : 'crumb cur'} onClick={() => props.onFolder(null)}>
                My Drive
              </button>
              {crumbs.map((c, idx) => (
                <span key={c.id} className="crumb-wrap">
                  <ChevronRight size={16} />
                  <button className={`crumb ${idx === crumbs.length - 1 ? 'cur' : ''}`} onClick={() => props.onFolder(c.id)}>
                    {c.name}
                  </button>
                </span>
              ))}
            </>
          ) : (
            <h1>{sectionName}</h1>
          )}
        </div>
        <label className="search drive-search">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in Drive" />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        <div className="segmented icon-seg">
          <button className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')} title="Grid">
            <LayoutGrid size={15} />
          </button>
          <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')} title="List">
            <List size={15} />
          </button>
        </div>
        <button className="primary-btn hide-mobile" onClick={props.onPickFiles}>
          <Upload size={15} /> Upload
        </button>
      </header>

      <div className="drive-scroll" key={`${section}:${folderId}:${layout}`}>
        {section === 'email' && !q && (
          <p className="drive-note">
            <Mail size={14} /> Attachments from your emails appear here automatically.
          </p>
        )}
        {section === 'trash' && shown.length > 0 && <p className="drive-note">Items in trash are deleted forever after 30 days.</p>}

        {shown.length === 0 ? (
          <div className="empty">
            <div className="empty-art">{section === 'trash' ? '✓' : '+'}</div>
            <p className="empty-title">{q ? 'No files found' : section === 'trash' ? 'Trash is empty' : 'Nothing here yet'}</p>
            <p className="empty-sub">{q ? `Nothing matches “${query}”.` : section === 'trash' ? '' : 'Drag files here or press Upload.'}</p>
          </div>
        ) : layout === 'list' ? (
          <div className="d-table">
            <div className="d-tr d-th">
              <span>Name</span>
              <span className="hide-mobile">Modified</span>
              <span className="hide-mobile">Size</span>
              <span />
            </div>
            {shown.map((i, n) => (
              <div key={i.id} className="d-tr" style={{ ['--i' as string]: Math.min(n, 12) }} onClick={() => open(i)}>
                <span className="d-cell-name">
                  {i.thumb ? <img className="mini-thumb" src={i.thumb} alt="" /> : <FileIcon kind={i.kind} size={14} />}
                  {name(i)}
                  {i.starred && section !== 'starred' && <Star size={12} className="star-mark" />}
                </span>
                <span className="muted hide-mobile">{relative(i.modified)}</span>
                <span className="muted hide-mobile">{i.kind === 'folder' ? '' : fmtSize(i.size)}</span>
                <span className="d-actions" onClick={(e) => e.stopPropagation()}>
                  {actions(i)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {folders.length > 0 && (
              <>
                <div className="d-heading">Folders</div>
                <div className="folder-grid">
                  {folders.map((f, n) => (
                    <div key={f.id} className="folder-card" style={{ ['--i' as string]: n }} onClick={() => open(f)}>
                      <FileIcon kind="folder" size={16} />
                      <span className="fc-text">
                        {name(f)}
                        <small>{meta(f)}</small>
                      </span>
                      <span className="d-actions" onClick={(e) => e.stopPropagation()}>
                        {actions(f)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {files.length > 0 && (
              <>
                {folders.length > 0 && <div className="d-heading">Files</div>}
                <div className={section === 'media' && !q ? 'media-grid' : 'file-grid'}>
                  {files.map((f, n) => (
                    <div key={f.id} className="file-card" style={{ ['--i' as string]: Math.min(n, 16) }} onClick={() => open(f)}>
                      {thumb(f)}
                      {section !== 'media' || q ? (
                        <span className="fc-text">
                          {name(f)}
                          <small>{meta(f)}</small>
                        </span>
                      ) : null}
                      <span className="d-actions" onClick={(e) => e.stopPropagation()}>
                        {actions(f)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {dragging && (
        <div className="drop-overlay">
          <Upload size={28} />
          <strong>Drop to upload</strong>
          <span>{section === 'my' && crumbs.length ? `to ${crumbs[crumbs.length - 1].name}` : 'to My Drive'}</span>
        </div>
      )}
    </section>
  );
}
