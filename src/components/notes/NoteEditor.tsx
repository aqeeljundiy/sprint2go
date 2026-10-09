import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, ArrowUp, Bold, Check, ChevronDown, Cloud, CloudOff, Copy, Eye, Highlighter, Italic, Link2, List, ListChecks, ListOrdered, ListTodo, MoreHorizontal, NotebookPen, Pin, PinOff, Quote, RotateCcw, SquareCheck, Strikethrough, Trash2, Type, Underline } from 'lucide-react';
import type { Note, Todo } from '../../types';
import { relative } from '../../utils';
import { toast } from '../../toast';
import { EmptyState } from '../ui/EmptyState';
import { PushScreen } from '../ui/PushScreen';
import { ActionSheet, useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { ProjectPicker } from '../ProjectPicker';
import { term } from '../../terms';
import { NoteBar } from './NoteBar';
import { NoteText, type Caret, type NoteTextHandle } from './NoteText';
import { FormatPanel, HIGHLIGHTS, LinkPanel, MentionPanel, whoSees } from './NoteSheets';
import { lineText, linkedFrom, noteLink } from './noteHtml';
import { noteActions } from './noteMenu';
import { canEditNote, useNoteMenu, type NotesApi } from './useNoteMenu';
import { KEEP_DAYS, keepDraft, useNoteDraft, useSaveState } from './noteDraft';
import { t, tx } from '../../i18n';
import { fmtDate } from '../../i18n/format';

const NO_CARET: Caret = { inList: false, inChecklist: false, selection: false, on: new Set() };

export interface NoteEditorProps {
  note: Note | undefined;
  notes: Note[]; // the company's notes (for Linked from and @)
  todos: Todo[];
  api: NotesApi;
  phone: boolean;
  find?: string; // opened from a search: show this match
  fresh?: boolean; // just made: start on the title with the keyboard up
  onBack?: () => void; // phones
  onTask: (text: string, note: Note) => Todo;
  onUndoTask: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenNote: (id: string) => void;
  onMention: (userId: string, note: Note) => void;
  onUpload: (file: File) => Promise<{ url: string; name: string }>;
}

/**
 * One note. On a phone it's a full screen pushed over the list (Back, or swipe from the left edge): it opens to read,
 * a tap puts the caret where you tapped, and while you write a bar of tools rides on the keyboard. On desktop it's the
 * pane next to the list, with its toolbar on top and "Linked from" at the side when there's room.
 */
export function NoteEditor(p: NoteEditorProps) {
  const { note, api } = p;
  useNoteDraft(note, api.patch);
  if (!note)
    return (
      <section className="notes-pane view-enter">
        <EmptyState icon={<NotebookPen size={22} />} title={t('Pick a note, or write a new one')} text={t('Private notes, meeting prep, how-tos for the team. Link a note to a {project} and it shows on their page.', { project: term.one })} />
      </section>
    );
  return <Open key={note.id} {...p} note={note} />;
}

function Open(p: NoteEditorProps & { note: Note }) {
  const { note, api, phone } = p;
  const me = api.me;
  const owner = note.ownerId === me;
  const canEdit = canEditNote(note, me) && !note.deletedAt;
  const text = useRef<NoteTextHandle>(null);
  const title = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const doc = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<Caret>(NO_CARET);
  const [focus, setFocus] = useState<'title' | 'text' | null>(null);
  // Phones open a note to read; a tap starts writing. A new note starts on its title.
  const [editing, setEditing] = useState(!phone || !!p.fresh || (!note.title && !note.html));
  const [panel, setPanel] = useState<'format' | 'link' | 'mention' | null>(null);
  const [lineMenu, setLineMenu] = useState<{ block: HTMLElement; x: number; y: number } | null>(null);
  const save = useSaveState(note.id);
  const { ctx, sheets } = useNoteMenu(api);
  const tasks = useMemo(() => new Map(p.todos.filter((t) => t.noteId === note.id || note.html.includes(t.id)).map((t) => [t.id, t])), [p.todos, note.id, note.html]);
  const links = useMemo(() => linkedFrom(note, p.notes, p.todos), [note, p.notes, p.todos]);
  const project = api.clients.find((c) => c.id === note.clientId);
  const who = whoSees(note, api.company, project?.name, phone);
  const editedBy = api.users.find((u) => u.id === note.updatedBy);
  const ownerName = api.users.find((u) => u.id === note.ownerId)?.name.split(' ')[0] ?? t('its owner');
  const aaBtn = useRef<HTMLButtonElement>(null);
  const linkBtn = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const dots = useRef<HTMLButtonElement>(null);
  const menu = useActionMenu(() => noteActions(note, ctx), { title: note.title || t('Untitled') });

  // Opened from a search: the match, marked for a moment. A new note: straight onto its title.
  useEffect(() => {
    if (p.find) setTimeout(() => text.current?.showMatch(p.find!), 250);
    if (p.fresh && canEdit) title.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘K in the text: the link field.
  useEffect(() => {
    const d = doc.current;
    if (!d) return;
    const on = () => openPanel('link');
    d.addEventListener('note-link', on);
    return () => d.removeEventListener('note-link', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The title grows with what's written (it wraps rather than scrolling sideways).
  useLayoutEffect(() => {
    const t = title.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, [note.title, phone]);

  const change = (patch: Partial<Note>) => {
    const next = { ...note, ...patch };
    keepDraft(note.id, next.title, next.html);
    save.edited();
    api.patch(note.id, patch);
  };

  /* ---------- making a task from a line ---------- */
  const makeTask = (block?: HTMLElement) => {
    const l = block ? { block, text: lineText(block) } : text.current?.line() ?? { text: '', block: null };
    const existing = l.block?.querySelector<HTMLElement>('.note-task')?.dataset.task;
    if (existing && tasks.has(existing)) return p.onOpenTask(existing);
    if (!l.text) return toast({ text: t('Write the task on a line first, then make it a task.') });
    const task = p.onTask(l.text, note);
    if (l.block) text.current?.pill(l.block, task.id);
    toast({
      text: t('Task made: “{title}”', { title: task.title }),
      also: { label: t('Open'), run: () => p.onOpenTask(task.id) },
      action: { label: t('Undo'), run: () => (p.onUndoTask(task.id), text.current?.unpill(task.id)) },
    });
  };

  /* ---------- the line's own menu (hold a line while reading, or a checklist line's "…") ---------- */
  const lineActions = (b: HTMLElement): SheetAction[] => {
    const tid = b.querySelector<HTMLElement>('.note-task')?.dataset.task;
    const check = b.matches('ul.checklist > li');
    const words = lineText(b);
    const moved = (dir: -1 | 1) => {
      const other = dir < 0 ? b.previousElementSibling : b.nextElementSibling;
      if (!other || !b.parentNode) return;
      b.parentNode.insertBefore(b, dir < 0 ? other : other.nextSibling);
      text.current?.changed();
    };
    return [
      ...(tid && tasks.has(tid) ? [{ label: t('Open its task'), icon: ListTodo, run: () => p.onOpenTask(tid) }] : canEdit && words ? [{ label: t('Make a task'), icon: ListTodo, run: () => makeTask(b) }] : []),
      ...(check && canEdit ? [{ label: b.classList.contains('done') ? t('Untick') : t('Tick'), icon: SquareCheck, run: () => (b.classList.toggle('done'), text.current?.changed()) }] : []),
      ...(canEdit && b.previousElementSibling ? [{ label: t('Move up'), icon: ArrowUp, group: 'move', run: () => moved(-1) }] : []),
      ...(canEdit && b.nextElementSibling ? [{ label: t('Move down'), icon: ArrowDown, group: 'move', run: () => moved(1) }] : []),
      ...(words ? [{ label: t('Copy the line'), icon: Copy, group: 'copy', run: () => void navigator.clipboard?.writeText(words).then(() => toast({ text: t('Copied') })) }] : []),
      ...(canEdit ? [{ label: t('Delete the line'), icon: Trash2, danger: true, group: 'end', run: () => (b.remove(), text.current?.changed()) }] : []),
    ];
  };

  // A checklist line's "…": by the line the caret is in (or the pointer is over).
  const [dotsAt, setDotsAt] = useState<{ li: HTMLElement; top: number } | null>(null);
  const placeDots = (li: HTMLElement | null) => {
    if (!li || !doc.current || !canEdit) return setDotsAt(null);
    const top = li.getBoundingClientRect().top - doc.current.getBoundingClientRect().top;
    setDotsAt((d) => (d && d.li === li && Math.abs(d.top - top) < 1 ? d : { li, top }));
  };
  useEffect(() => {
    if (focus !== 'text') return;
    const sel = getSelection();
    const li = (sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement)?.closest<HTMLElement>('ul.checklist > li') ?? null;
    placeDots(li);
  }, [caret, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineBtn = useRef<HTMLButtonElement>(null);

  /* ---------- tools ---------- */
  const hl = HIGHLIGHTS[0].color;
  // Aa, a link, @: the sheet takes the keyboard's place (the selection is kept for when it's done).
  const openPanel = (k: 'format' | 'link' | 'mention') => {
    text.current?.save();
    if (phone) text.current?.blur();
    setPanel(k);
  };
  const back = () => text.current?.restore();
  const bar = {
    checklist: () => text.current?.checklist(),
    task: () => makeTask(),
    format: () => openPanel('format'),
    mention: () => openPanel('mention'),
    attach: () => (text.current?.save(), file.current?.click()),
    undo: () => text.current?.cmd('undo'),
    hide: () => (text.current?.blur(), title.current?.blur()),
    indent: (dir: 1 | -1) => text.current?.cmd(dir > 0 ? 'indent' : 'outdent'),
    move: (dir: -1 | 1) => text.current?.moveLine(dir),
    cmd: (c: string) => text.current?.cmd(c),
    highlight: () => text.current?.highlight(hl),
    link: () => openPanel('link'),
  };
  const fmt = { block: (t: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE') => text.current?.block(t), cmd: (c: string) => text.current?.cmd(c), checklist: () => text.current?.checklist(), highlight: (c: string | null) => text.current?.highlight(c) };
  const done = () => {
    text.current?.blur();
    title.current?.blur();
    if (phone) setEditing(false);
  };

  const status =
    save.state === 'device' ? (
      <>
        <CloudOff size={13} /> {t('Saved on this device, will sync')}
      </>
    ) : save.state === 'failed' ? (
      <>
        <CloudOff size={13} /> {save.why ? t('Not saved to the server: {why}. It’s kept on this device.', { why: t(save.why) }) : t('Not saved to the server. It’s kept on this device.')}
      </>
    ) : save.state === 'saving' ? (
      <>
        <Cloud size={13} /> {t('Saving…')}
      </>
    ) : Date.now() - Date.parse(note.updatedAt) < 8000 && note.updatedBy === me ? (
      <>
        <Cloud size={13} /> {t('Saved')}
      </>
    ) : (
      <>
        {editedBy ? (editedBy.id === me ? t('Edited {when} by you', { when: relative(note.updatedAt) }) : t('Edited {when} by {name}', { when: relative(note.updatedAt), name: editedBy.name.split(' ')[0] })) : t('Edited {when}', { when: relative(note.updatedAt) })}
      </>
    );

  const linked = (links.notes.length > 0 || links.tasks.length > 0) && (
    <section className="note-linked" aria-label={t('Linked from')}>
      <h3>{t('Linked from')}</h3>
      {links.notes.map((n) => (
        <button key={n.id} type="button" className="nl-link" onClick={() => p.onOpenNote(n.id)}>
          <NotebookPen size={15} />
          <span>{n.title || t('Untitled')}</span>
        </button>
      ))}
      {links.tasks.map((task) => (
        <button key={task.id} type="button" className={`nl-link${task.done ? ' done' : ''}`} onClick={() => p.onOpenTask(task.id)}>
          {task.done ? <Check size={15} /> : <ListTodo size={15} />}
          <span>{task.title}</span>
        </button>
      ))}
    </section>
  );

  const body = (
    <div className="note-wrap">
      <div className="note-scroll" ref={scroller}>
        <div className="note-doc" ref={doc} onMouseMove={(e) => !phone && placeDots((e.target as HTMLElement).closest<HTMLElement>('ul.checklist > li'))}>
          {note.deletedAt && (
            <div className="note-banner">
              <Trash2 size={15} />
              <span>{t('In Recently deleted. It goes for good {date}.', { date: fmtDate(Date.parse(note.deletedAt) + KEEP_DAYS * 86_400_000, { day: 'numeric', month: 'long' }) })}</span>
              {ctx.canDelete(note) && (
                <button type="button" className="ghost-btn sm" onClick={() => api.restore(note.id)}>
                  <RotateCcw size={14} /> {t('Put back')}
                </button>
              )}
            </div>
          )}
          {!note.deletedAt && !canEdit && (
            <div className="note-banner quiet">
              <Eye size={15} />
              <span>{t('View only. {name} keeps this note as it is.', { name: ownerName })}</span>
            </div>
          )}
          <textarea
            ref={title}
            className="note-title"
            rows={1}
            value={note.title}
            readOnly={!canEdit}
            onChange={(e) => change({ title: e.target.value.replace(/\n/g, ' ') })}
            onFocus={() => (setFocus('title'), setEditing(true))}
            onBlur={() => setFocus((f) => (f === 'title' ? null : f))}
            onKeyDown={(e) => {
              // The first line is the title: Enter goes on to the note.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                text.current?.focus(!note.html || note.html === '<p><br></p>');
              }
            }}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text/plain');
              if (!t.includes('\n')) return;
              e.preventDefault();
              const [first, ...rest] = t.split(/\r?\n/);
              change({ title: (note.title + first).trim(), html: `${rest.map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '<br>'}</p>`).join('')}${note.html}` });
            }}
            placeholder={tx('note', 'Title')}
            aria-label={tx('note', 'Title')}
            enterKeyHint="next"
          />
          <p className="note-meta">{status}</p>
          <NoteText
            ref={text}
            html={note.html}
            editable={canEdit && editing}
            tasks={tasks}
            placeholder={canEdit ? t('Write here. A line can become a task: put the caret on it and tap Make task.') : ''}
            onChange={(html) => change({ html })}
            onCaret={setCaret}
            onFocus={(on) => setFocus((f) => (on ? 'text' : f === 'text' ? null : f))}
            onOpenTask={p.onOpenTask}
            onOpenNote={p.onOpenNote}
            onTapToEdit={
              phone && canEdit
                ? (x, y) => {
                    flushSync(() => setEditing(true));
                    text.current?.focusAt(x, y);
                  }
                : undefined
            }
            onLineMenu={phone ? (block, x, y) => setLineMenu({ block, x, y }) : undefined}
          />
          {dotsAt && (
            <button
              ref={lineBtn}
              type="button"
              className="note-line-dots"
              style={{ top: dotsAt.top }}
              aria-label={t('This line’s actions')}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                const r = lineBtn.current!.getBoundingClientRect();
                setLineMenu({ block: dotsAt.li, x: r.left, y: r.bottom });
              }}
            >
              <MoreHorizontal size={16} />
            </button>
          )}
          {phone && linked}
        </div>
        {!phone && linked && <aside className="note-side">{linked}</aside>}
      </div>
      <input
        ref={file}
        type="file"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          toast({ text: t('Adding {name}…', { name: f.name }) });
          try {
            const up = await p.onUpload(f);
            text.current?.restore();
            text.current?.link(up.url, up.name);
            toast({ text: t('{name} added', { name: up.name }) });
          } catch (err) {
            toast({ text: err instanceof Error ? t(err.message) : t('The file couldn’t be added.') });
          }
        }}
      />
      {panel === 'format' && <FormatPanel caret={caret} a={fmt} anchor={phone ? undefined : aaBtn} onClose={() => (setPanel(null), phone && back())} />}
      {panel === 'link' && <LinkPanel anchor={phone ? undefined : linkBtn} onApply={(href) => (back(), text.current?.link(href))} onClose={() => (setPanel(null), back())} />}
      {panel === 'mention' && (
        <MentionPanel
          users={api.users}
          notes={p.notes.filter((n) => n.id !== note.id)}
          me={me}
          onClose={() => (setPanel(null), back())}
          onPick={(x) => {
            back();
            if (x.kind === 'note') return text.current?.link(noteLink(x.n.id), x.n.title || t('Untitled'));
            text.current?.link(`mailto:${x.u.email}`, `@${x.u.name.split(' ')[0]}`);
            if (note.visibility === 'team') p.onMention(x.u.id, note);
          }}
        />
      )}
      {lineMenu && <ActionSheet open onClose={() => setLineMenu(null)} title={lineText(lineMenu.block).slice(0, 60) || t('This line')} actions={lineActions(lineMenu.block)} at={phone ? null : { x: lineMenu.x, y: lineMenu.y }} />}
      {menu.menu}
      {sheets}
    </div>
  );

  const whoBtn = (
    <button type="button" className="note-who" onClick={() => (owner ? ctx.share(note) : undefined)} disabled={!owner} aria-label={owner ? t('Who sees it: {who}. Change', { who: who.label }) : t('Who sees it: {who}', { who: who.label })}>
      <who.icon size={14} />
      <span>{who.label}</span>
      {owner && <ChevronDown size={14} />}
    </button>
  );

  if (phone)
    return (
      <PushScreen
        title={whoBtn}
        backLabel={t('Notes')}
        onBack={() => (done(), p.onBack?.())}
        className="note-screen"
        actions={
          focus ? (
            <button type="button" className="note-done" onClick={done}>
              {t('Done')}
            </button>
          ) : (
            <button ref={dots} type="button" className="icon-btn" onClick={() => menu.openFrom(dots)} aria-label={t('Note actions')}>
              <MoreHorizontal size={20} />
            </button>
          )
        }
        footer={focus === 'text' && canEdit && !panel ? <NoteBar caret={caret} a={bar} canTask /> : undefined}
      >
        {body}
      </PushScreen>
    );

  return (
    <section className="notes-pane view-enter">
      <header className="note-head">
        {whoBtn}
        {canEdit && <ProjectPicker value={note.clientId ?? ''} onChange={(v) => change({ clientId: v || undefined })} projects={api.clients} none={t('No {project}', { project: term.one })} className="sel-flat" />}
        <span className="spacer" />
        {canEdit && (
          <button className="icon-btn sm" onClick={() => ctx.pin(note)} title={note.pinned ? t('Unpin') : t('Pin to the top')} aria-label={note.pinned ? t('Unpin') : t('Pin to the top')}>
            {note.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
        )}
        <button ref={dots} className="icon-btn sm" onClick={() => menu.openFrom(dots)} aria-label={t('Note actions')} title={t('More')}>
          <MoreHorizontal size={16} />
        </button>
      </header>
      {canEdit && (
        <div className="note-tools" role="toolbar" aria-label={t('Formatting')} onMouseDown={(e) => (e.target as HTMLElement).closest('button') && e.preventDefault()}>
          <button ref={aaBtn} type="button" className={`tb${panel === 'format' ? ' on' : ''}`} onClick={() => openPanel('format')} title={t('Text styles')} aria-label={t('Text styles')}>
            <Type size={15} />
          </button>
          <span className="tb-sep" />
          {(
            [
              ['bold', `${t('Bold')} (⌘B)`, Bold],
              ['italic', `${t('Italic')} (⌘I)`, Italic],
              ['underline', `${t('Underline')} (⌘U)`, Underline],
              ['strikeThrough', t('Strikethrough'), Strikethrough],
            ] as const
          ).map(([c, label, Icon]) => (
            <button key={c} type="button" className={`tb${caret.on.has(c) ? ' on' : ''}`} onClick={() => text.current?.cmd(c)} title={label} aria-label={label} aria-pressed={caret.on.has(c)}>
              <Icon size={15} />
            </button>
          ))}
          <button type="button" className="tb" onClick={() => text.current?.highlight(hl)} title={t('Highlight')} aria-label={t('Highlight')}>
            <Highlighter size={15} />
          </button>
          <span className="tb-sep" />
          <button type="button" className={`tb${caret.on.has('insertUnorderedList') && !caret.inChecklist ? ' on' : ''}`} onClick={() => text.current?.cmd('insertUnorderedList')} title={t('Bulleted list')} aria-label={t('Bulleted list')}>
            <List size={15} />
          </button>
          <button type="button" className={`tb${caret.on.has('insertOrderedList') ? ' on' : ''}`} onClick={() => text.current?.cmd('insertOrderedList')} title={t('Numbered list')} aria-label={t('Numbered list')}>
            <ListOrdered size={15} />
          </button>
          <button type="button" className={`tb${caret.inChecklist ? ' on' : ''}`} onClick={() => text.current?.checklist()} title={t('Checklist')} aria-label={t('Checklist')}>
            <ListChecks size={15} />
          </button>
          <button type="button" className={`tb${caret.on.has('quote') ? ' on' : ''}`} onClick={() => text.current?.block('BLOCKQUOTE')} title={t('Quote')} aria-label={t('Quote')}>
            <Quote size={15} />
          </button>
          <button ref={linkBtn} type="button" className={`tb${panel === 'link' ? ' on' : ''}`} onClick={() => openPanel('link')} title={t('Link (⌘K)')} aria-label={t('Link')}>
            <Link2 size={15} />
          </button>
          <span className="spacer" />
          <button type="button" className="ghost-btn sm note-make-task" onClick={() => makeTask()} title={t('Make a task from the line the caret is on')}>
            <ListTodo size={14} /> {t('Make a task')}
          </button>
        </div>
      )}
      {body}
    </section>
  );
}
