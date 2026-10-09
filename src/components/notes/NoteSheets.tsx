import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import { Bold, Check, FileText, Italic, Link2, List, ListChecks, ListOrdered, Lock, Minus, Quote, Search, Strikethrough, Underline, Users } from 'lucide-react';
import type { Client, Note, User } from '../../types';
import { term } from '../../terms';
import { Avatar } from '../Avatar';
import { Dot } from '../ui/Select';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { usePhone } from '../../mobile/media';
import type { Caret } from './NoteText';
import { mark, t, tx } from '../../i18n';

/** A sheet on phones, a popover by its button on desktop. */
function Panel({ anchor, title, onClose, children, width = 300, className = '' }: { anchor?: RefObject<HTMLElement | null>; title: string; onClose: () => void; children: ReactNode; width?: number; className?: string }) {
  const phone = usePhone();
  if (phone || !anchor)
    return (
      <Sheet title={title} onClose={onClose} className={className}>
        {children}
      </Sheet>
    );
  return (
    <Popover anchor={anchor} open onClose={onClose} width={width} title={title}>
      <div className={`np-pop ${className}`}>{children}</div>
    </Popover>
  );
}

export const HIGHLIGHTS: { name: string; color: string }[] = [
  { name: mark('Yellow'), color: 'rgba(250, 204, 21, 0.38)' },
  { name: mark('Green'), color: 'rgba(34, 197, 94, 0.3)' },
  { name: mark('Blue'), color: 'rgba(59, 130, 246, 0.3)' },
  { name: mark('Pink'), color: 'rgba(236, 72, 153, 0.28)' },
];

export interface FormatActions {
  block: (tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE') => void;
  cmd: (name: string) => void;
  checklist: () => void;
  highlight: (color: string | null) => void;
}

/**
 * Aa: the text styles, taking the keyboard's place on a phone (a popover on desktop). Title, Heading, Subheading,
 * Body; bold, italic, underline, strikethrough; lists, quote, divider; highlight colours.
 */
export function FormatPanel({ caret, a, anchor, onClose }: { caret: Caret; a: FormatActions; anchor?: RefObject<HTMLElement | null>; onClose: () => void }) {
  const pick = (fn: () => void) => () => (onClose(), fn());
  const styles: [('P' | 'H1' | 'H2' | 'H3'), string, string][] = [
    ['H1', tx('style', 'Title'), 'h1'],
    ['H2', t('Heading'), 'h2'],
    ['H3', t('Subheading'), 'h3'],
    ['P', t('Body'), 'p'],
  ];
  const isBody = !['h1', 'h2', 'h3'].some((h) => caret.on.has(h));
  return (
    <Panel anchor={anchor} title={t('Text styles')} onClose={onClose} className="fmt-panel" width={320}>
      <div className="fmt">
        <div className="fmt-styles" role="group" aria-label={t('Style')}>
          {styles.map(([tag, label, cls]) => {
            const on = cls === 'p' ? isBody : caret.on.has(cls);
            return (
              <button key={tag} type="button" className={`fmt-style fs-${cls}${on ? ' on' : ''}`} aria-pressed={on} onClick={pick(() => a.block(tag))}>
                {label}
              </button>
            );
          })}
        </div>
        <div className="fmt-row" role="group" aria-label={t('Letters')}>
          {(
            [
              ['bold', t('Bold'), Bold],
              ['italic', t('Italic'), Italic],
              ['underline', t('Underline'), Underline],
              ['strikeThrough', t('Strikethrough'), Strikethrough],
            ] as const
          ).map(([c, label, Icon]) => (
            <button key={c} type="button" className={`fmt-btn${caret.on.has(c) ? ' on' : ''}`} aria-label={label} aria-pressed={caret.on.has(c)} onClick={pick(() => a.cmd(c))}>
              <Icon size={18} />
            </button>
          ))}
        </div>
        <div className="fmt-row" role="group" aria-label={t('Lists and blocks')}>
          <button type="button" className={`fmt-btn${caret.on.has('insertUnorderedList') && !caret.inChecklist ? ' on' : ''}`} aria-label={t('Bulleted list')} onClick={pick(() => a.cmd('insertUnorderedList'))}>
            <List size={18} />
          </button>
          <button type="button" className={`fmt-btn${caret.on.has('insertOrderedList') ? ' on' : ''}`} aria-label={t('Numbered list')} onClick={pick(() => a.cmd('insertOrderedList'))}>
            <ListOrdered size={18} />
          </button>
          <button type="button" className={`fmt-btn${caret.inChecklist ? ' on' : ''}`} aria-label={t('Checklist')} onClick={pick(a.checklist)}>
            <ListChecks size={18} />
          </button>
          <button type="button" className={`fmt-btn${caret.on.has('quote') ? ' on' : ''}`} aria-label={t('Quote')} onClick={pick(() => a.block('BLOCKQUOTE'))}>
            <Quote size={18} />
          </button>
          <button type="button" className="fmt-btn" aria-label={t('Divider')} onClick={pick(() => a.cmd('insertHorizontalRule'))}>
            <Minus size={18} />
          </button>
        </div>
        <div className="fmt-row fmt-colors" role="group" aria-label={t('Highlight')}>
          {HIGHLIGHTS.map((h) => (
            <button key={h.name} type="button" className="fmt-swatch" style={{ ['--hl' as string]: h.color }} aria-label={t('Highlight: {color}', { color: t(h.name) })} title={t(h.name)} onClick={pick(() => a.highlight(h.color))} />
          ))}
          <button type="button" className="fmt-swatch none" aria-label={t('No highlight')} title={t('No highlight')} onClick={pick(() => a.highlight(null))} />
        </div>
      </div>
    </Panel>
  );
}

/** A link on the selected words (or a new one at the caret). */
export function LinkPanel({ anchor, onApply, onClose }: { anchor?: RefObject<HTMLElement | null>; onApply: (href: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const apply = () => {
    const u = url.trim();
    if (!u) return;
    onClose();
    onApply(/^(https?:|mailto:|\/)/i.test(u) ? u : `https://${u}`);
  };
  return (
    <Panel anchor={anchor} title={t('Link')} onClose={onClose} className="link-panel" width={320}>
      <form
        className="np-link"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="sheet-search">
          <Link2 size={16} />
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('Paste or type a link')} inputMode="url" aria-label={t('Link')} enterKeyHint="done" />
        </label>
        <button type="submit" className="primary-btn" disabled={!url.trim()}>
          {t('Add link')}
        </button>
      </form>
    </Panel>
  );
}

/** @: a person or a note, found by name. */
export function MentionPanel({ users, notes, me, onPick, onClose }: { users: User[]; notes: Note[]; me: string; onPick: (p: { kind: 'person'; u: User } | { kind: 'note'; n: Note }) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const people = users.filter((u) => u.id !== me && (!s || `${u.name} ${u.email} ${u.title}`.toLowerCase().includes(s))).slice(0, 8);
  const found = notes.filter((n) => !n.deletedAt && (!s || n.title.toLowerCase().includes(s))).slice(0, 8);
  return (
    <Sheet title={t('Mention')} onClose={onClose} size="tall" className="mention-sheet">
      <label className="sheet-search">
        <Search size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('A person or a note')} aria-label={t('Find a person or a note')} />
      </label>
      <div className="as-list">
        {people.length > 0 && <div className="as-group">{t('People')}</div>}
        {people.map((u) => (
          <button key={u.id} type="button" className="as-item" onClick={() => (onClose(), onPick({ kind: 'person', u }))}>
            <Avatar person={u} size={28} />
            <span className="as-label">
              {u.name}
              {u.title && <small>{u.title}</small>}
            </span>
          </button>
        ))}
        {found.length > 0 && <div className="as-group">{t('Notes')}</div>}
        {found.map((n) => (
          <button key={n.id} type="button" className="as-item" onClick={() => (onClose(), onPick({ kind: 'note', n }))}>
            <FileText size={20} className="as-icon" />
            <span className="as-label">{n.title || t('Untitled')}</span>
          </button>
        ))}
        {!people.length && !found.length && <p className="sheet-empty">{t('Nobody and no note called “{query}”', { query: q })}</p>}
      </div>
    </Sheet>
  );
}

/** Move to a project (or out of one). */
export function MoveSheet({ note, clients, onPick, onClose }: { note: Note; clients: Client[]; onPick: (clientId: string | undefined) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => clients.filter((c) => c.status !== 'ended' && (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()))), [clients, q]);
  return (
    <Sheet title={t('Move “{title}”', { title: note.title || t('Untitled') })} onClose={onClose} size={clients.length > 8 ? 'tall' : 'auto'} className="move-sheet">
      {clients.length > 8 && (
        <label className="sheet-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a {project}', { project: term.one })} aria-label={t('Find a {project}', { project: term.one })} />
        </label>
      )}
      <div className="as-list">
        <button type="button" className={`as-item${!note.clientId ? ' on' : ''}`} onClick={() => (onClose(), onPick(undefined))}>
          <Lock size={18} className="as-icon" />
          <span className="as-label">{t('No {project}', { project: term.one })}</span>
          {!note.clientId && <Check size={16} className="as-check" />}
        </button>
        {list.map((c) => (
          <button key={c.id} type="button" className={`as-item${note.clientId === c.id ? ' on' : ''}`} onClick={() => (onClose(), onPick(c.id))}>
            <span className="as-icon">
              <Dot color={c.color} />
            </span>
            <span className="as-label">{c.name}</span>
            {note.clientId === c.id && <Check size={16} className="as-check" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Who sees the note, and whether they can change it (the owner's choice). */
export function ShareSheet({ note, company, project, onChange, onClose }: { note: Note; company: string; project?: string; onChange: (p: Partial<Note>) => void; onClose: () => void }) {
  const shared = note.visibility === 'team';
  const can = note.teamCan ?? 'edit';
  const everyone = project ? t('People on {project}', { project }) : t('Everyone at {company}', { company });
  const row = (on: boolean, label: string, hint: string, icon: ReactNode, run: () => void) => (
    <button type="button" className={`as-item${on ? ' on' : ''}`} aria-pressed={on} onClick={run}>
      <span className="as-icon">{icon}</span>
      <span className="as-label">
        {label}
        <small>{hint}</small>
      </span>
      {on && <Check size={16} className="as-check" />}
    </button>
  );
  return (
    <Sheet title={t('Who sees it')} onClose={onClose} className="share-sheet">
      <div className="as-list">
        {row(!shared, t('Only me'), t('Private until you share it'), <Lock size={18} />, () => onChange({ visibility: 'private' }))}
        {row(shared, everyone, project ? t('Shows on the {project}’s page', { project: term.one }) : t('Anyone in the company can find it'), <Users size={18} />, () => onChange({ visibility: 'team' }))}
      </div>
      {shared && (
        <>
          <div className="as-group">{t('They can')}</div>
          <div className="as-list">
            {row(can === 'edit', t('Edit'), t('Change it like you can'), <Check size={18} />, () => onChange({ teamCan: 'edit' }))}
            {row(can === 'view', t('Only read it'), t('Only you change it'), <FileText size={18} />, () => onChange({ teamCan: 'view' }))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Where a note is: the small chip that says who sees it (the project's name only where nothing else shows it). */
export function whoSees(note: Note, company: string, project?: string, named = true) {
  if (note.visibility !== 'team') return { label: t('Only me'), icon: Lock };
  if (project) return { label: named ? project : t('People on the {project}', { project: term.one }), icon: Users };
  return { label: t('Everyone at {company}', { company }), icon: Users };
}
