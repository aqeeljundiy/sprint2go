import { useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, FileText, Folder, FolderInput, FolderPlus, Image as ImageIcon, Link2, MoreHorizontal, NotebookPen, Pencil, Plus, Trash2, Upload, Video, X } from 'lucide-react';
import type { Channel, Material, Materials, User } from '../types';
import { relative } from '../utils';
import { htmlToText, sanitize } from '../sanitize';
import { Popover } from './ui/Popover';
import { RichEditor } from './RichEditor';

/** Something shown in Materials: an item added here, or a file or link that came from the chat or Drive. */
interface Entry {
  key: string; // material id, or "file:…", "link:…", "drive:…"
  kind: 'link' | 'doc' | 'file';
  title: string;
  sub: string;
  url?: string;
  type?: string;
  size?: number;
  at: string;
  folderId?: string;
  material?: Material;
  fromChat?: boolean;
}

interface Props {
  channel: Channel;
  users: User[];
  me: string;
  chatFiles: { key: string; name: string; type: string; size: number; url?: string; who: string; at: string; where: string }[];
  chatLinks: { url: string; who: string; at: string }[];
  onChannel: (patch: Partial<Channel>) => void;
  readOnly?: boolean; // clients: open and download, no changes
}

const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_UPLOAD = 8_000_000; // stored with the channel for now; big files belong in Drive

/** The channel's Materials: folders like "Project A" holding files, links and docs, plus everything shared in chat. */
export function ChannelMaterials({ channel, users, me, chatFiles, chatLinks, onChannel, readOnly }: Props) {
  // Older channels kept links as "bookmarks": they show here as links until the first change saves them as materials.
  const mats: Materials = channel.materials ?? {
    folders: [],
    placed: {},
    items: (channel.bookmarks ?? []).map((b) => ({ id: b.id, kind: 'link', title: b.title, url: b.url, addedBy: b.addedBy, at: b.at })),
  };
  const save = (m: Materials) => onChannel({ materials: m, bookmarks: [] });

  const [folder, setFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'file' | 'link' | 'doc'>('all');
  const [adding, setAdding] = useState<null | 'link' | 'folder'>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [doc, setDoc] = useState<{ id: string; title: string; html: string; isNew: boolean } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const menuAnchor = useRef<HTMLElement | null>(null);
  const addAnchor = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const who = (id?: string) => users.find((u) => u.id === id)?.name.split(' ')[0] ?? 'Someone';

  const own: Entry[] = mats.items.map((m) => ({
    key: m.id,
    kind: m.kind,
    title: m.title,
    sub: m.kind === 'link' ? `${host(m.url ?? '')} · ${who(m.addedBy)}` : m.kind === 'doc' ? `Doc · ${m.editedAt ? `edited by ${who(m.editedBy)} ${relative(m.editedAt)}` : `by ${who(m.addedBy)}`}` : `${fmtSize(m.file?.size ?? 0)} · ${who(m.addedBy)}`,
    url: m.kind === 'link' ? m.url : m.file?.url,
    type: m.file?.type,
    size: m.file?.size,
    at: m.editedAt ?? m.at,
    folderId: m.folderId,
    material: m,
  }));
  const ownUrls = new Set(mats.items.filter((m) => m.kind === 'link').map((m) => m.url));
  const shared: Entry[] = [
    ...chatFiles.map((f) => ({ key: f.key, kind: 'file' as const, title: f.name, sub: [fmtSize(f.size), f.who, f.where].filter(Boolean).join(' · '), url: f.url, type: f.type, size: f.size, at: f.at, folderId: mats.placed[f.key], fromChat: true })),
    ...[...new Map(chatLinks.map((l) => [l.url, l])).values()]
      .filter((l) => !ownUrls.has(l.url))
      .map((l) => ({ key: `link:${l.url}`, kind: 'link' as const, title: host(l.url), sub: `${l.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)} · ${l.who}`, url: l.url, at: l.at, folderId: mats.placed[`link:${l.url}`], fromChat: true })),
  ];
  const all = [...own, ...shared].filter((e) => filter === 'all' || e.kind === filter).sort((a, b) => b.at.localeCompare(a.at));
  const current = mats.folders.find((f) => f.id === folder);
  const inFolder = (id: string) => [...own, ...shared].filter((e) => e.folderId === id);

  /* ---------- changes ---------- */
  const moveTo = (e: Entry, folderId: string | undefined) => {
    if (e.material) save({ ...mats, items: mats.items.map((m) => (m.id === e.key ? { ...m, folderId } : m)) });
    else {
      const placed = { ...mats.placed };
      if (folderId) placed[e.key] = folderId;
      else delete placed[e.key];
      save({ ...mats, placed });
    }
  };
  const remove = (e: Entry) => e.material && save({ ...mats, items: mats.items.filter((m) => m.id !== e.key) });
  const addLink = () => {
    const u = url.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(u)) return setError('Paste a full link, starting with https://');
    save({ ...mats, items: [...mats.items, { id: uid(), kind: 'link', title: name.trim() || host(u), url: u, folderId: folder ?? undefined, addedBy: me, at: new Date().toISOString() }] });
    setAdding(null);
    setName('');
    setUrl('');
    setError('');
  };
  const addFolder = () => {
    if (!name.trim()) return setAdding(null);
    const id = uid();
    save({ ...mats, folders: [...mats.folders, { id, name: name.trim() }] });
    setAdding(null);
    setName('');
    setFolder(id);
  };
  const upload = (files: FileList | null) => {
    const list = [...(files ?? [])];
    const big = list.filter((f) => f.size > MAX_UPLOAD);
    setError(big.length ? `${big.map((f) => f.name).join(', ')} ${big.length > 1 ? 'are' : 'is'} over 8 MB. Share big files in Drive and add the link here.` : '');
    const ok = list.filter((f) => f.size <= MAX_UPLOAD);
    if (!ok.length) return;
    void Promise.all(
      ok.map(
        (f) =>
          new Promise<Material>((res) => {
            const r = new FileReader();
            r.onload = () => res({ id: uid(), kind: 'file', title: f.name, file: { name: f.name, type: f.type || 'application/octet-stream', size: f.size, url: String(r.result) }, folderId: folder ?? undefined, addedBy: me, at: new Date().toISOString() });
            r.readAsDataURL(f);
          }),
      ),
    ).then((items) => save({ ...mats, items: [...mats.items, ...items] }));
  };
  const saveDoc = () => {
    if (!doc) return;
    const now = new Date().toISOString();
    const title = doc.title.trim() || 'Untitled doc';
    save({
      ...mats,
      items: doc.isNew
        ? [...mats.items, { id: doc.id, kind: 'doc', title, html: doc.html, folderId: folder ?? undefined, addedBy: me, at: now }]
        : mats.items.map((m) => (m.id === doc.id ? { ...m, title, html: doc.html, editedBy: me, editedAt: now } : m)),
    });
    setDoc(null);
  };
  const rename = () => {
    if (!renaming) return;
    const n = renaming.name.trim();
    if (n) {
      if (mats.folders.some((f) => f.id === renaming.key)) save({ ...mats, folders: mats.folders.map((f) => (f.id === renaming.key ? { ...f, name: n } : f)) });
      else save({ ...mats, items: mats.items.map((m) => (m.id === renaming.key ? { ...m, title: n } : m)) });
    }
    setRenaming(null);
  };
  const deleteFolder = (id: string) => {
    // Its contents stay; they just leave the folder.
    save({
      folders: mats.folders.filter((f) => f.id !== id),
      items: mats.items.map((m) => (m.folderId === id ? { ...m, folderId: undefined } : m)),
      placed: Object.fromEntries(Object.entries(mats.placed).filter(([, f]) => f !== id)),
    });
    if (folder === id) setFolder(null);
  };

  /* ---------- a doc, read only (clients) ---------- */
  if (doc && readOnly)
    return (
      <div className="chan-pane mat-doc">
        <div className="mat-bar">
          <button className="ghost-btn sm" onClick={() => setDoc(null)}>
            <ArrowLeft size={14} /> Back
          </button>
        </div>
        <h2 className="mat-doc-title">{doc.title}</h2>
        <div className="mat-doc-read" dangerouslySetInnerHTML={{ __html: sanitize(doc.html) }} />
      </div>
    );

  /* ---------- the doc editor ---------- */
  if (doc)
    return (
      <div className="chan-pane mat-doc">
        <div className="mat-bar">
          <button className="ghost-btn sm" onClick={() => setDoc(null)}>
            <ArrowLeft size={14} /> Back
          </button>
          <span className="spacer" />
          <button className="primary-btn sm" onClick={saveDoc}>
            Save doc
          </button>
        </div>
        <input className="mat-doc-title" autoFocus={doc.isNew} value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} placeholder="Doc title, e.g. Project A brief" />
        <RichEditor initialHtml={doc.html} placeholder="Goals, deliverables, dates, links… Everyone in the channel can read and edit this." onChange={(html) => setDoc((d) => d && { ...d, html })} onSubmit={saveDoc} />
      </div>
    );

  const icon = (e: Entry) =>
    e.kind === 'link' ? <Link2 size={15} /> : e.kind === 'doc' ? <NotebookPen size={15} /> : e.type?.startsWith('image') ? <ImageIcon size={15} /> : e.type?.startsWith('video') ? <Video size={15} /> : <FileText size={15} />;
  const open = (e: Entry) => {
    if (e.kind === 'doc' && e.material) setDoc({ id: e.material.id, title: e.material.title, html: e.material.html ?? '', isNew: false });
    else if (e.url) window.open(e.url, '_blank', 'noopener');
  };
  const row = (e: Entry) => (
    <div key={e.key} className="mat-row">
      <span className={`cf-icon k-${e.kind}`}>{icon(e)}</span>
      {renaming?.key === e.key ? (
        <input className="mat-rename" autoFocus value={renaming.name} onChange={(ev) => setRenaming({ ...renaming, name: ev.target.value })} onKeyDown={(ev) => (ev.key === 'Enter' ? rename() : ev.key === 'Escape' && setRenaming(null))} onBlur={rename} />
      ) : (
        <button className="cf-text" onClick={() => open(e)} disabled={!e.url && e.kind !== 'doc'}>
          <strong>{e.title}</strong>
          <small>
            {e.sub} · {relative(e.at)}
            {e.fromChat && !e.key.startsWith('drive:') ? ' · from chat' : ''}
          </small>
          {e.kind === 'doc' && e.material?.html && <span className="mat-doc-peek">{htmlToText(e.material.html).slice(0, 140)}</span>}
        </button>
      )}
      {!readOnly && <button
        className="icon-btn sm mat-more"
        aria-label="More"
        onClick={(ev) => {
          menuAnchor.current = ev.currentTarget;
          setMenu(e.key);
        }}
      >
        <MoreHorizontal size={15} />
      </button>}
    </div>
  );
  const menuEntry = [...own, ...shared].find((e) => e.key === menu);
  const menuFolder = mats.folders.find((f) => f.id === menu);

  return (
    <div className="chan-pane materials">
      <div className="mat-bar">
        {current ? (
          <nav className="mat-crumbs">
            <button className="link-btn" onClick={() => setFolder(null)}>
              Materials
            </button>
            <ChevronRight size={13} />
            <strong>{current.name}</strong>
          </nav>
        ) : (
          <div className="segmented">
            {(
              [
                ['all', 'All'],
                ['file', 'Files'],
                ['link', 'Links'],
                ['doc', 'Docs'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {!current && !readOnly && (
          <button className="ghost-btn sm" onClick={() => (setAdding('folder'), setName(''))}>
            <FolderPlus size={14} /> New folder
          </button>
        )}
        {!readOnly && (
          <button ref={addAnchor} className="primary-btn sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add
          </button>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
      </div>

      <Popover anchor={addAnchor} open={addOpen} onClose={() => setAddOpen(false)} width={240} title="Add">
        <div className="sel-pop">
          <button className="sel-opt" onClick={() => (setAddOpen(false), setAdding('link'), setName(''), setUrl(''))}>
            <Link2 size={14} /> Link
          </button>
          <button className="sel-opt" onClick={() => (setAddOpen(false), setDoc({ id: uid(), title: '', html: '', isNew: true }))}>
            <NotebookPen size={14} /> Doc
          </button>
          <button className="sel-opt" onClick={() => (setAddOpen(false), fileInput.current?.click())}>
            <Upload size={14} /> Upload a file
          </button>
          {current && <p className="muted small menu-note">Goes into {current.name}.</p>}
        </div>
      </Popover>

      {adding === 'folder' && (
        <div className="todo-add task-add mat-add">
          <Folder size={15} />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? addFolder() : e.key === 'Escape' && setAdding(null))} placeholder="Folder name, e.g. Project A" />
          <button className="ghost-btn sm" onClick={() => setAdding(null)}>
            Cancel
          </button>
          <button className="primary-btn sm" onClick={addFolder} disabled={!name.trim()}>
            Create
          </button>
        </div>
      )}
      {adding === 'link' && (
        <div className="todo-add task-add mat-add">
          <Link2 size={15} />
          <input autoFocus value={url} onChange={(e) => (setUrl(e.target.value), setError(''))} onKeyDown={(e) => e.key === 'Enter' && addLink()} placeholder="https://…" />
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLink()} placeholder="Name (optional), e.g. Figma file" />
          <button className="ghost-btn sm" onClick={() => setAdding(null)}>
            Cancel
          </button>
          <button className="primary-btn sm" onClick={addLink} disabled={!url.trim()}>
            Add link
          </button>
        </div>
      )}
      {error && <p className="err small">{error}</p>}

      {current ? (
        <>
          {inFolder(current.id).length ? inFolder(current.id).sort((a, b) => b.at.localeCompare(a.at)).map(row) : <p className="te-empty">Empty folder. Add files, links or docs, or move things here from Materials.</p>}
        </>
      ) : (
        <>
          {mats.folders.length > 0 && (
            <div className="mat-folders">
              {mats.folders.map((f) => {
                const items = inFolder(f.id);
                const n = (k: Entry['kind']) => items.filter((e) => e.kind === k).length;
                return (
                  <div key={f.id} className="mat-folder">
                    {renaming?.key === f.id ? (
                      <input className="mat-rename" autoFocus value={renaming.name} onChange={(ev) => setRenaming({ ...renaming, name: ev.target.value })} onKeyDown={(ev) => (ev.key === 'Enter' ? rename() : ev.key === 'Escape' && setRenaming(null))} onBlur={rename} />
                    ) : (
                      <button className="mf-open" onClick={() => setFolder(f.id)}>
                        <Folder size={18} />
                        <strong>{f.name}</strong>
                        <small>{items.length ? [n('file') && `${n('file')} file${n('file') > 1 ? 's' : ''}`, n('link') && `${n('link')} link${n('link') > 1 ? 's' : ''}`, n('doc') && `${n('doc')} doc${n('doc') > 1 ? 's' : ''}`].filter(Boolean).join(' · ') : 'Empty'}</small>
                      </button>
                    )}
                    {!readOnly && <button
                      className="icon-btn sm mat-more"
                      aria-label="Folder options"
                      onClick={(ev) => {
                        menuAnchor.current = ev.currentTarget;
                        setMenu(f.id);
                      }}
                    >
                      <MoreHorizontal size={15} />
                    </button>}
                  </div>
                );
              })}
            </div>
          )}
          {(() => {
            const loose = all.filter((e) => !e.folderId);
            const added = loose.filter((e) => !e.fromChat);
            const fromChat = loose.filter((e) => e.fromChat);
            return (
              <>
                {added.length > 0 && (
                  <>
                    <div className="d-heading">
                      Not in a folder <span>{added.length}</span>
                    </div>
                    {added.map(row)}
                  </>
                )}
                {fromChat.length > 0 && (
                  <>
                    <div className="d-heading">
                      From chat and Drive <span>{fromChat.length}</span>
                    </div>
                    {fromChat.map(row)}
                  </>
                )}
                {!mats.folders.length && !loose.length && <p className="te-empty">Nothing here yet. Make a folder for a project, then add files, links and docs. Anything shared in the chat shows up here too.</p>}
              </>
            );
          })()}
        </>
      )}

      <Popover anchor={menuAnchor} open={!!menu} onClose={() => setMenu(null)} width={230} title={menuFolder?.name ?? menuEntry?.title ?? ''}>
        <div className="sel-pop">
          {menuFolder && (
            <>
              <button className="sel-opt" onClick={() => (setRenaming({ key: menuFolder.id, name: menuFolder.name }), setMenu(null))}>
                <Pencil size={14} /> Rename
              </button>
              <button className="sel-opt danger" onClick={() => (deleteFolder(menuFolder.id), setMenu(null))}>
                <Trash2 size={14} /> Delete folder
              </button>
              <p className="muted small menu-note">Deleting a folder keeps what’s inside.</p>
            </>
          )}
          {menuEntry && (
            <>
              <div className="sel-group">
                <FolderInput size={12} /> Move to folder
              </div>
              {mats.folders.map((f) => (
                <button key={f.id} className="sel-opt" onClick={() => (moveTo(menuEntry, f.id), setMenu(null))}>
                  <Folder size={14} /> {f.name}
                  {menuEntry.folderId === f.id && <span className="sel-hint">here</span>}
                </button>
              ))}
              {menuEntry.folderId && (
                <button className="sel-opt" onClick={() => (moveTo(menuEntry, undefined), setMenu(null))}>
                  <X size={14} /> Take out of the folder
                </button>
              )}
              {!mats.folders.length && <p className="muted small menu-note">No folders yet. Use “New folder” first.</p>}
              {menuEntry.material && (
                <>
                  <button className="sel-opt" onClick={() => (setRenaming({ key: menuEntry.key, name: menuEntry.title }), setMenu(null))}>
                    <Pencil size={14} /> Rename
                  </button>
                  <button className="sel-opt danger" onClick={() => (remove(menuEntry), setMenu(null))}>
                    <Trash2 size={14} /> Remove
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}
