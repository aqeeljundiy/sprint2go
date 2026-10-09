import { useState } from 'react';
import { ProjectPicker } from './ProjectPicker';
import { term } from '../terms';
import { ArrowLeft, ListChecks, Lock, NotebookPen, Pin, PinOff, Plus, Search, Trash2, Users } from 'lucide-react';
import type { Client, Note, User } from '../types';
import { relative } from '../utils';
import { htmlToText } from '../sanitize';
import { RichEditor } from './RichEditor';
import { Select, Dot } from './ui/Select';
import { EmptyState } from './ui/EmptyState';
import { SquarePen } from 'lucide-react';
import { useCreateAction, useFocusedScreen } from '../mobile/chrome';

export type NotesFilter = 'all' | 'private' | 'team' | `client:${string}`;

/** The list of notes (sidebar on desktop, the first screen on phones). Pinned first, then the latest. */
export function NotesList({
  notes,
  clients,
  current,
  filter,
  onFilter,
  onOpen,
  onNew,
}: {
  notes: Note[];
  clients: Client[];
  current: string | null;
  filter: NotesFilter;
  onFilter: (f: NotesFilter) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  useCreateAction('notes', { label: 'New note', icon: SquarePen, run: onNew });
  const [q, setQ] = useState('');
  const shown = notes
    .filter((n) => (filter === 'all' ? true : filter === 'private' ? n.visibility === 'private' : filter === 'team' ? n.visibility === 'team' : n.clientId === filter.slice(7)))
    .filter((n) => !q.trim() || (n.title + ' ' + htmlToText(n.html)).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const withNotes = clients.filter((c) => notes.some((n) => n.clientId === c.id));
  return (
    <>
      <button className="compose-btn" onClick={onNew} title="New note">
        <Plus size={16} />
        <span className="sb-label">New note</span>
      </button>
      <label className="notes-search sb-label">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" />
      </label>
      <div className="notes-filters sb-label">
        <Select<string>
          value={filter}
          onChange={(v) => onFilter(v as NotesFilter)}
          label="Show"
          className="sel-flat"
          options={[
            { value: 'all', label: 'All notes' },
            { value: 'private', label: 'Only me', icon: <Lock size={13} /> },
            { value: 'team', label: 'Shared with the team', icon: <Users size={13} /> },
            ...withNotes.map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}`, icon: <Dot color={c.color} /> })),
          ]}
        />
      </div>
      <nav className="nav notes-nav">
        {shown.map((n) => {
          const c = clients.find((x) => x.id === n.clientId);
          return (
            <button key={n.id} className={`note-item ${current === n.id ? 'active' : ''}`} onClick={() => onOpen(n.id)} title={n.title || 'Untitled'}>
              <span className="ni-dot" aria-hidden>
                {(n.title || 'U').trim().charAt(0).toUpperCase()}
              </span>
              <span className="ni-title">
                {n.pinned && <Pin size={11} />}
                {n.visibility === 'private' && <Lock size={11} />}
                <strong>{n.title || 'Untitled'}</strong>
              </span>
              <small>
                {relative(n.updatedAt)}
                {c ? ` · ${c.name}` : ''}
              </small>
              <span className="ni-snip">{htmlToText(n.html).slice(0, 90)}</span>
            </button>
          );
        })}
        {!shown.length && <p className="muted small sb-note">{q ? 'No notes match.' : 'No notes here yet. Write one with “New note”, or from search: type and choose “New note”.'}</p>}
      </nav>
    </>
  );
}

/** One note, open: title, text, who can see it, its client, pin, and "make a task" from the selected text. */
export function NoteEditor({
  note,
  users,
  clients,
  me,
  onPatch,
  onDelete,
  onTask,
  onBack,
}: {
  note: Note | undefined;
  users: User[];
  clients: Client[];
  me: string;
  onPatch: (id: string, p: Partial<Note>) => void;
  onDelete: (id: string) => void;
  onTask: (text: string, note: Note) => void;
  onBack?: () => void;
}) {
  useFocusedScreen(!!onBack && !!note); // phones: an open note takes the whole screen
  if (!note)
    return (
      <section className="notes-pane view-enter">
        <EmptyState
          icon={<NotebookPen size={22} />}
          title="Pick a note, or write a new one"
          text={<>Private notes, meeting prep, how-tos for the team. Link a note to a {term.one} and it shows on their page.</>}
        />
      </section>
    );
  const mine = note.ownerId === me;
  const editedBy = users.find((u) => u.id === note.updatedBy);
  const taskFromSelection = () => {
    const sel = window.getSelection()?.toString().trim();
    onTask(sel || note.title, note);
  };
  return (
    <section className="notes-pane view-enter" key={note.id}>
      <header className="note-head">
        {onBack && (
          <button className="icon-btn back-btn" onClick={onBack} aria-label="Back to notes">
            <ArrowLeft size={20} />
          </button>
        )}
        <Select<'private' | 'team'>
          value={note.visibility}
          onChange={(v) => onPatch(note.id, { visibility: v })}
          label="Who can see it"
          className="sel-flat"
          disabled={!mine}
          options={[
            { value: 'private', label: 'Only me', icon: <Lock size={13} /> },
            { value: 'team', label: 'Everyone in the company', icon: <Users size={13} /> },
          ]}
        />
        <ProjectPicker value={note.clientId ?? ''} onChange={(v) => onPatch(note.id, { clientId: v || undefined })} projects={clients} none={`No ${term.one}`} className="sel-flat" />
        <span className="spacer" />
        <button className="ghost-btn sm" onMouseDown={(e) => e.preventDefault()} onClick={taskFromSelection} title="Select a line, then make it a task">
          <ListChecks size={14} /> Make a task
        </button>
        <button className="icon-btn sm" onClick={() => onPatch(note.id, { pinned: !note.pinned })} title={note.pinned ? 'Unpin' : 'Pin to the top'}>
          {note.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
        {mine && (
          <button className="icon-btn sm" onClick={() => onDelete(note.id)} title="Delete note">
            <Trash2 size={15} />
          </button>
        )}
      </header>
      <div className="note-body">
        <input className="note-title" value={note.title} onChange={(e) => onPatch(note.id, { title: e.target.value })} placeholder="Title" />
        <p className="note-meta muted small">
          Edited {relative(note.updatedAt)}
          {editedBy ? ` by ${editedBy.id === me ? 'you' : editedBy.name.split(' ')[0]}` : ''}
          {note.visibility === 'private' ? ' · only you can see this' : ' · everyone in the company can see and edit this'}
        </p>
        <RichEditor key={note.id} initialHtml={note.html} placeholder="Start writing… Select a line and press “Make a task” to turn it into a task." onChange={(html) => onPatch(note.id, { html })} />
      </div>
    </section>
  );
}
