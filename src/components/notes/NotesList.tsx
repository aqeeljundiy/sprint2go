import { TopBar } from '../../mobile/TopBar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ListTodo, Lock, MoreHorizontal, Pin, PinOff, Plus, RotateCcw, Search, SquarePen, Trash2, Users, X } from 'lucide-react';
import type { Note } from '../../types';
import { term } from '../../terms';
import { relative } from '../../utils';
import { htmlToText } from '../../sanitize';
import { useCreateAction, useTitleMenu } from '../../mobile/chrome';
import { fmtDate, fmtMonth, fmtTime } from '../../i18n/format';
import { Avatar } from '../Avatar';
import { EmptyState } from '../ui/EmptyState';
import { PushScreen } from '../ui/PushScreen';
import { Select, Dot } from '../ui/Select';
import { SwipeRow } from '../ui/SwipeRow';
import { useActionMenu, type SheetAction } from '../ui/ActionSheet';
import { useLeaving } from '../ui/Smooth';
import { firstLine, hasTasks, snippetAround } from './noteHtml';
import { noteActions, type NoteMenuCtx } from './noteMenu';
import { useNoteMenu, type NotesApi } from './useNoteMenu';
import { KEEP_DAYS } from './noteDraft';
import { t, tn } from '../../i18n';

export type NotesFilter = 'all' | 'private' | 'team' | 'shared' | `client:${string}`;
type Facet = { kind: 'pinned' | 'shared' | 'tasks' } | { kind: 'project'; id: string } | { kind: 'person'; id: string };

const inFilter = (n: Note, f: NotesFilter, me: string) =>
  f === 'all' ? true : f === 'private' ? n.visibility === 'private' : f === 'team' ? n.visibility === 'team' : f === 'shared' ? n.visibility === 'team' && n.ownerId !== me : n.clientId === f.slice(7);
function inFacet(n: Note, f: Facet | null, me: string) {
  if (!f) return true;
  switch (f.kind) {
    case 'pinned':
      return !!n.pinned;
    case 'shared':
      return n.visibility === 'team' && n.ownerId !== me;
    case 'tasks':
      return hasTasks(n);
    case 'project':
      return n.clientId === f.id;
    case 'person':
      return n.ownerId === f.id;
  }
}
const matches = (n: Note, q: string) => !q || `${n.title} ${htmlToText(n.html)}`.toLowerCase().includes(q.toLowerCase());
/** Apple Notes' sections: Today, Yesterday, Previous 7 days, Previous 30 days, then each month. */
function sectionOf(iso: string, now = new Date()) {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return { key: 'today', label: t('Today') };
  if (diff === 1) return { key: 'yesterday', label: t('Yesterday') };
  if (diff < 7) return { key: 'week', label: t('Previous 7 days') };
  if (diff < 30) return { key: 'month', label: t('Previous 30 days') };
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.getFullYear() === now.getFullYear() ? fmtDate(d, { month: 'long' }) : fmtMonth(d) };
}
/** When, the short way Apple Notes puts it before the first line: 13:05, Yesterday, Mon, 8 Oct. */
function whenShort(iso: string, now = new Date()) {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return fmtTime(d);
  if (diff === 1) return t('Yesterday');
  if (diff < 7) return fmtDate(d, { weekday: 'short' });
  return fmtDate(d, d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

const byPinnedThenNew = (a: Note, b: Note) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt);

/**
 * The notes: the first screen on a phone (an open note pushes over it), the side panel on desktop. Pinned first,
 * then the latest. On a phone: chips on top for Only me, Shared with me and each project; the search at the bottom,
 * with chips before you type; swipe a row right to pin it, left to move it or delete it; hold it for its menu.
 */
export function NotesList({
  notes,
  api,
  current,
  filter,
  onFilter,
  onOpen,
  onNew,
  phone,
}: {
  notes: Note[]; // the company's notes this person sees, Recently deleted included
  api: NotesApi;
  current: string | null;
  filter: NotesFilter;
  onFilter: (f: NotesFilter) => void;
  onOpen: (id: string, find?: string) => void;
  onNew: () => void;
  phone: boolean;
}) {
  useCreateAction('notes', { label: t('New note'), icon: SquarePen, run: onNew });
  const me = api.me;
  const { ctx, sheets } = useNoteMenu(api);
  const [q, setQ] = useState('');
  const [facet, setFacet] = useState<Facet | null>(null);
  const [searching, setSearching] = useState(false);
  const [trash, setTrash] = useState(false);
  const live = useMemo(() => notes.filter((n) => !n.deletedAt), [notes]);
  const deleted = useMemo(() => notes.filter((n) => n.deletedAt && (n.ownerId === me || n.deletedBy === me)).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')), [notes, me]);
  const query = q.trim();
  const shown = useMemo(() => live.filter((n) => inFilter(n, query || facet ? 'all' : filter, me) && inFacet(n, facet, me) && matches(n, query)).sort(byPinnedThenNew), [live, filter, facet, query, me]);
  const withNotes = api.clients.filter((c) => live.some((n) => n.clientId === c.id));
  const rows = useLeaving(shown, (n) => n.id);
  const pinned = rows.filter((r) => r.item.pinned);
  const rest = rows.filter((r) => !r.item.pinned);
  const looking = !!(query || facet);

  // Phones: Apple's folder list is the title switcher (All notes, Only me, Shared with me, each project, Recently deleted).
  useTitleMenu(
    'notes',
    phone && {
      label: t('Which notes'),
      value: filter,
      options: [
        { value: 'all', label: t('All notes'), icon: <SquarePen size={15} /> },
        { value: 'private', label: t('Only me'), icon: <Lock size={15} /> },
        { value: 'shared', label: t('Shared with me'), icon: <Users size={15} /> },
        ...withNotes.map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}`, icon: <Dot color={c.color} /> })),
        ...(deleted.length ? [{ value: 'trash', label: t('Recently deleted'), group: t('More'), icon: <Trash2 size={15} /> }] : []),
      ],
      onChange: (v) => (v === 'trash' ? setTrash(true) : onFilter(v as NotesFilter)),
    },
  );
  const mixed = filter === 'all' || filter === 'shared';
  const row = (r: { item: Note; leaving: boolean }) => <NoteRow key={r.item.id} n={r.item} leaving={r.leaving} ctx={ctx} api={api} active={!phone && current === r.item.id} q={query} phone={phone} mixed={mixed} onOpen={(find) => (setSearching(false), onOpen(r.item.id, find))} />;
  const list = (
    <>
      {pinned.length > 0 && !looking && <div className="nl-head">{t('Pinned')}</div>}
      {(looking ? rows : pinned).map(row)}
      {pinned.length > 0 && rest.length > 0 && !looking && <div className="nl-head">{t('Notes')}</div>}
      {!looking && rest.map(row)}
      {!shown.length &&
        (looking ? (
          <p className="nl-none">{query ? t('No notes with “{query}”.', { query }) : t('No notes here.')}</p>
        ) : (
          <EmptyState compact icon={<SquarePen size={20} />} title={filter === 'all' ? t('No notes yet') : t('No notes here yet')} text={phone ? t('Tap the pen to write one. The first line is its title.') : t('Write one with New note. The first line is its title.')} />
        ))}
      {deleted.length > 0 && !looking && (
        <button type="button" className="nl-trash" onClick={() => setTrash(true)}>
          <Trash2 size={17} />
          <span>{t('Recently deleted')}</span>
          <ChevronRight size={16} />
        </button>
      )}
    </>
  );

  const trashView = <RecentlyDeleted notes={deleted} api={api} onOpen={(id) => onOpen(id)} />;

  // The Search tab in Notes' own bar (App's useAppSections) puts the cursor in this search.
  const phoneRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = () => phoneRoot.current?.querySelector<HTMLInputElement>('.nl-search input')?.focus();
    addEventListener('s2g:notes-search', on);
    return () => removeEventListener('s2g:notes-search', on);
  }, []);
  if (!phone)
    return (
      <>
        <button className="compose-btn" onClick={onNew} title={t('New note')}>
          <Plus size={16} />
          <span className="sb-label">{t('New note')}</span>
        </button>
        {trash ? (
          <>
            <button type="button" className="nl-back sb-label" onClick={() => setTrash(false)}>
              <ChevronRight size={15} className="flip" /> {t('All notes')}
            </button>
            {trashView}
          </>
        ) : (
          <>
            <label className="notes-search sb-label">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search notes')} aria-label={t('Search notes')} />
              {q && (
                <button type="button" className="icon-btn sm" onClick={() => setQ('')} aria-label={t('Clear the search')}>
                  <X size={14} />
                </button>
              )}
            </label>
            <div className="notes-filters sb-label">
              <Select<string>
                value={filter}
                onChange={(v) => onFilter(v as NotesFilter)}
                label={t('Show')}
                className="sel-flat"
                options={[
                  { value: 'all', label: t('All notes') },
                  { value: 'private', label: t('Only me'), icon: <Lock size={13} /> },
                  { value: 'shared', label: t('Shared with me'), icon: <Users size={13} /> },
                  ...withNotes.map((c) => ({ value: `client:${c.id}`, label: c.name, group: `${term.Many}`, icon: <Dot color={c.color} /> })),
                ]}
              />
            </div>
            <nav className="nav notes-nav" aria-label={t('Notes')}>
              {list}
            </nav>
          </>
        )}
        {sheets}
      </>
    );

  // Phones: Apple Notes' grouped cards under date sections, Pinned first.
  const sections: { key: string; label: string; rows: typeof rows }[] = [];
  if (!looking) {
    if (pinned.length) sections.push({ key: 'pinned', label: t('Pinned'), rows: pinned });
    for (const r of rest) {
      const s = sectionOf(r.item.updatedAt);
      const last = sections[sections.length - 1];
      if (last && last.key === s.key) last.rows.push(r);
      else sections.push({ ...s, rows: [r] });
    }
  }
  const phoneList = looking ? (
    <>
      {rows.length > 0 && <div className="nl-card">{rows.map(row)}</div>}
      {!shown.length && <p className="nl-none">{query ? t('No notes with “{query}”.', { query }) : t('No notes here.')}</p>}
    </>
  ) : shown.length ? (
    sections.map((s) => (
      <section key={s.key} className="nl-section">
        <h2 className="nl-sec-head">{s.label}</h2>
        <div className="nl-card">{s.rows.map(row)}</div>
      </section>
    ))
  ) : (
    <EmptyState icon={<SquarePen size={22} />} title={filter === 'all' ? t('No notes yet') : t('No notes here yet')} text={t('Tap the pen to write one. The first line is its title.')} />
  );
  const people = [...new Set(live.filter((n) => n.ownerId !== me).map((n) => n.ownerId))].map((id) => api.users.find((u) => u.id === id)).filter(Boolean).slice(0, 4);
  const facets: { f: Facet; label: string; icon: React.ReactNode }[] = [
    { f: { kind: 'pinned' }, label: t('Pinned'), icon: <Pin size={14} /> },
    { f: { kind: 'shared' }, label: t('Shared with me'), icon: <Users size={14} /> },
    { f: { kind: 'tasks' }, label: t('Has tasks'), icon: <ListTodo size={14} /> },
    ...withNotes.map((c) => ({ f: { kind: 'project', id: c.id } as Facet, label: c.name, icon: <Dot color={c.color} /> })),
    ...people.map((u) => ({ f: { kind: 'person', id: u!.id } as Facet, label: u!.name.split(' ')[0], icon: <Avatar person={u!} size={18} /> })),
  ];
  const same = (a: Facet | null, b: Facet) => !!a && a.kind === b.kind && ('id' in a ? a.id : '') === ('id' in b ? b.id : '');
  return (
    <section ref={phoneRoot} className={`notes-phone view-enter${searching || looking ? ' searching' : ''}`}>
      {/* One search: the pill at the bottom (Apple Notes). No magnifier in the bar. */}
      <TopBar app="notes" search={false} />
      {/* While searching, the ways to narrow it sit at the top (Apple Notes' suggestions), not floating over the list. */}
      <div className={`fold nl-facets-top${searching && !query ? ' open' : ''}`}>
          <div>
            <div className="nl-facets" aria-label={t('Narrow the search')}>
              {facets.map((x) => (
                <button key={x.label + x.f.kind} type="button" className={`nl-chip${same(facet, x.f) ? ' on' : ''}`} onPointerDown={(e) => e.preventDefault()} onClick={() => setFacet(same(facet, x.f) ? null : x.f)}>
                  {x.icon}
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      <div className={`nl-scroll${shown.length || looking ? '' : ' is-empty'}`}>{phoneList}</div>
      <div className="nl-search-dock">
        <label className="nl-search">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setSearching(true)} onBlur={() => setSearching(false)} placeholder={facet ? t('Search in {place}', { place: facets.find((x) => same(facet, x.f))?.label ?? '' }) : t('Search')} aria-label={t('Search notes')} enterKeyHint="search" />
          {(q || facet) && (
            <button type="button" className="nl-clear" onPointerDown={(e) => e.preventDefault()} onClick={() => (setQ(''), setFacet(null))} aria-label={t('Clear the search')}>
              <X size={16} />
            </button>
          )}
        </label>
      </div>
      {trash && (
        <PushScreen title={t('Recently deleted')} backLabel={t('Notes')} onBack={() => setTrash(false)}>
          {trashView}
        </PushScreen>
      )}
      {sheets}
    </section>
  );
}

function NoteRow({ n, leaving, ctx, api, active, q, phone, mixed, onOpen }: { n: Note; leaving: boolean; ctx: NoteMenuCtx; api: NotesApi; active: boolean; q: string; phone: boolean; mixed?: boolean; onOpen: (find?: string) => void }) {
  const dots = useRef<HTMLButtonElement>(null);
  const menu = useActionMenu(() => noteActions(n, ctx), { title: n.title || t('Untitled') });
  const project = api.clients.find((c) => c.id === n.clientId);
  const editedBy = n.updatedBy && n.updatedBy !== api.me ? api.users.find((u) => u.id === n.updatedBy)?.name.split(' ')[0] : '';
  const snip = snippetAround(n, q);
  const edit = ctx.canEdit(n);
  const shared = n.visibility === 'team';
  const phoneFace = (
    <div className="note-item nl-row lp" {...menu.bind} onClick={() => onOpen(q || undefined)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(q || undefined)}>
      {shared && <Users size={14} className="nl-shared" aria-label={t('Shared')} />}
      <strong className="nl-title">{n.title || t('Untitled')}</strong>
      <span className="nl-line">
        <span className="nl-when">{whenShort(n.updatedAt)}</span>
        {q && snip.hit ? (
          <span className="nl-first">
            {snip.before}
            <mark>{snip.hit}</mark>
            {snip.after}
          </span>
        ) : (
          <span className="nl-first">{firstLine(n) || t('No more text')}</span>
        )}
      </span>
      {mixed && project && (
        <span className="nl-proj">
          <Dot color={project.color} />
          {project.name}
        </span>
      )}
    </div>
  );
  const face = phone ? phoneFace : (
    <div className={`note-item lp${active ? ' active' : ''}`} {...menu.bind} onClick={() => onOpen(q || undefined)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(q || undefined)} title={n.title || t('Untitled')}>
      <span className="ni-dot" aria-hidden>
        {(n.title || 'U').trim().charAt(0).toUpperCase()}
      </span>
      <span className="ni-title">
        {n.pinned && <Pin size={12} aria-label={t('Pinned')} />}
        {n.visibility === 'private' && <Lock size={12} aria-label={t('Only you see it')} />}
        <strong>{n.title || t('Untitled')}</strong>
      </span>
      <small>
        {editedBy ? t('{when} by {name}', { when: relative(n.updatedAt), name: editedBy }) : relative(n.updatedAt)}
        {project ? ` · ${project.name}` : ''}
      </small>
      <span className="ni-snip">
        {snip.before}
        {snip.hit && <mark>{snip.hit}</mark>}
        {snip.after}
      </span>
      <button
        ref={dots}
        type="button"
        className="ni-more"
        aria-label={t('Actions for {title}', { title: n.title || t('Untitled') })}
        onClick={(e) => {
          e.stopPropagation();
          menu.openFrom(dots);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
  return (
    <>
      {phone ? (
        <SwipeRow
          leaving={leaving}
          className="note-swipe"
          start={edit ? [{ id: 'pin', label: n.pinned ? t('Unpin') : t('Pin'), icon: n.pinned ? PinOff : Pin, tone: 'accent', done: n.pinned ? t('Unpinned') : t('Pinned'), run: () => (api.patch(n.id, { pinned: !n.pinned }), () => api.patch(n.id, { pinned: !!n.pinned })) }] : []}
          end={[
            ...(edit ? [{ id: 'move', label: t('Move'), icon: ChevronRight, tone: 'neutral' as const, run: () => ctx.move(n) }] : []),
            ...(ctx.canDelete(n) ? [{ id: 'delete', label: t('Delete'), icon: Trash2, tone: 'danger' as const, removes: true, run: () => ctx.remove(n) }] : []),
          ]}
        >
          {face}
        </SwipeRow>
      ) : (
        <div className={leaving ? 'row-leaving' : undefined}>{face}</div>
      )}
      {menu.menu}
    </>
  );
}

/** Notes deleted in the last 30 days: open, put back or delete for good. */
function RecentlyDeleted({ notes, api, onOpen }: { notes: Note[]; api: NotesApi; onOpen: (id: string) => void }) {
  const rows = useLeaving(notes, (n) => n.id);
  return (
    <div className="nl-deleted">
      <p className="nl-deleted-note">{t('Deleted notes stay here for {n} days, then they’re gone for good.', { n: KEEP_DAYS })}</p>
      {rows.map(({ item: n, leaving }) => (
        <DeletedRow key={n.id} n={n} leaving={leaving} api={api} onOpen={() => onOpen(n.id)} />
      ))}
      {!notes.length && <p className="nl-none">{t('Nothing deleted lately.')}</p>}
    </div>
  );
}

function DeletedRow({ n, leaving, api, onOpen }: { n: Note; leaving: boolean; api: NotesApi; onOpen: () => void }) {
  const left = Math.max(0, KEEP_DAYS - Math.floor((Date.now() - Date.parse(n.deletedAt ?? '')) / 86_400_000));
  const actions: SheetAction[] = [
    { label: t('Put back'), icon: RotateCcw, run: () => api.restore(n.id) },
    { label: t('Delete for good'), icon: Trash2, danger: true, group: 'end', run: () => api.purge(n.id) },
  ];
  const menu = useActionMenu(actions, { title: n.title || t('Untitled') });
  return (
    <SwipeRow
      leaving={leaving}
      className="note-swipe"
      start={[{ id: 'back', label: t('Put back'), icon: RotateCcw, tone: 'ok', removes: true, run: () => api.restore(n.id) }]}
      end={[{ id: 'gone', label: t('Delete'), icon: Trash2, tone: 'danger', removes: true, run: () => api.purge(n.id) }]}
    >
      <div className="note-item deleted lp" {...menu.bind} role="button" tabIndex={0} onClick={onOpen}>
        <span className="ni-title">
          <strong>{n.title || t('Untitled')}</strong>
        </span>
        <small>
          {t('Deleted {when}', { when: relative(n.deletedAt ?? '') })} · {left ? tn(left, '{n} day left', '{n} days left') : t('goes today')}
        </small>
        <span className="nl-deleted-acts">
          <button type="button" className="ghost-btn sm" onClick={(e) => (e.stopPropagation(), api.restore(n.id))}>
            <RotateCcw size={14} /> {t('Put back')}
          </button>
        </span>
      </div>
      {menu.menu}
    </SwipeRow>
  );
}
