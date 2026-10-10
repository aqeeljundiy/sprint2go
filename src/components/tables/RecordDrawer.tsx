import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Copy, CopyPlus, GripVertical, LayoutTemplate, Link2, Maximize2, Minimize2, MoreHorizontal, Plus, Send, Trash2, X } from 'lucide-react';
import type { CellValue, Channel, DataTable, TableField, TablePage, TableRow, User } from '../../types';
import { FieldMenu } from './FieldMenu';
import { Avatar } from '../Avatar';
import { relative } from '../../utils';
import { ButtonCell, CellView, ContactActions, FilesPopover, InlineInput, PickPopover, RatingInput, typesInline, type CellCtx } from './Cell';
import { DatePicker } from '../ui/DatePicker';
import { PushScreen } from '../ui/PushScreen';
import { TabPane } from '../ui/Smooth';
import { useActionMenu } from '../ui/ActionSheet';
import { cellText, fieldIcon, isComputed, isEmpty, passes, rowName, statusField, valueOf } from './fields';
import { useOnePanel } from '../../onePanel';
import { useFocusedScreen } from '../../mobile/chrome';
import { EditSheet } from './EditSheet';
import { t, tn, tx } from '../../i18n';
import { tj } from '../../i18n/tj';

/** What the row page can do with its fields' settings (people who may change the table's columns). */
export interface PageEdit {
  tables: DataTable[];
  channels: Channel[];
  onSave: (f: TableField) => void;
  onDelete: (id: string) => void;
  onHide: (id: string) => void;
}

/** One field on the desktop row page: label on the left, the value (editable in place) on the right. */
export function FieldLine({ f, row, ctx, onCell, readOnly, table, edit, dragProps }: { f: TableField; row: TableRow; ctx: CellCtx; onCell: (fieldId: string, v: CellValue) => void; readOnly?: boolean; table?: DataTable; edit?: PageEdit; dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } }) {
  const ref = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState(false);
  const [settings, setSettings] = useState(false);
  const tb = table ?? ctx.tables.find((x) => x.id === row.tableId);
  const v = tb ? valueOf(tb, f, row, ctx) : row.values[f.id];
  const Icon = fieldIcon(f.type);
  const save = (x: CellValue) => onCell(f.id, x);
  let editor: React.ReactNode;
  if (f.type === 'button') editor = <span className="tb-rd-btn"><ButtonCell f={f} row={row} ctx={ctx} /></span>;
  else if (readOnly || isComputed(f)) editor = <span className="tb-rd-val ro"><CellView f={f} v={v} ctx={ctx} wrap />{isEmpty(v) && <span className="muted">{tx('value', 'Empty')}</span>}</span>;
  else if (f.type === 'rating') editor = <span className="tb-rd-val"><RatingInput v={v} max={f.max ?? 5} onSave={save} /></span>;
  else if (f.type === 'date') editor = <span className="tb-rd-date"><DatePicker value={typeof v === 'string' ? v : ''} onChange={(d) => save(d || null)} label={f.name} placeholder={tx('value', 'Empty')} className="sel-flat" /></span>;
  else if (f.type === 'files')
    editor = (
      <>
        <button ref={ref} type="button" className="tb-rd-val" onClick={() => setPop(true)}>
          <CellView f={f} v={v} ctx={ctx} />
          {isEmpty(v) && <span className="muted">{t('Add files')}</span>}
        </button>
        <FilesPopover v={v} anchor={ref} open={pop} onClose={() => setPop(false)} onSave={save} title={f.name} />
      </>
    );
  else if (f.type === 'checkbox') editor = <input type="checkbox" checked={!!v} onChange={(e) => save(e.target.checked)} aria-label={f.name} />;
  else if (f.type === 'longtext') editor = <LongText v={v} onSave={save} label={f.name} />;
  else if (typesInline(f.type))
    editor = (
      <span className="tb-rd-inline">
        <InlineInput f={f} v={v} onSave={save} autoFocus={false} className="tb-rd-input" />
        <ContactActions f={f} v={v} />
      </span>
    );
  else
    editor = (
      <>
        <button ref={ref} type="button" className="tb-rd-val" onClick={() => setPop(true)}>
          <CellView f={f} v={v} ctx={ctx} />
          {cellText(f, v, { users: ctx.users, rowName: () => 'x' }) === '' && <span className="muted">{tx('value', 'Empty')}</span>}
        </button>
        <PickPopover f={f} v={v} ctx={ctx} anchor={ref} open={pop} onClose={() => setPop(false)} onSave={save} />
      </>
    );
  return (
    <div className="tb-rd-line" {...dragProps}>
      <span className="tb-rd-labelcell">
        {edit && tb ? (
          <>
            <button ref={labelRef} type="button" className="tb-rd-label editable" title={f.description || t('Rename, change type, hide or delete')} onClick={() => setSettings((x) => !x)}>
              {dragProps?.draggable && <GripVertical size={13} className="tb-rd-grip" />}
              <Icon size={13} /> <span>{f.name}</span>
            </button>
            <FieldMenu anchor={labelRef} open={settings} onClose={() => setSettings(false)} field={f} table={tb} tables={edit.tables} onSave={edit.onSave} onDelete={() => edit.onDelete(f.id)} onHide={() => edit.onHide(f.id)} hideLabel={t('Hide on the row page')} users={ctx.users} channels={edit.channels} rows={ctx.rows} previewCtx={ctx} />
          </>
        ) : (
          <span className="tb-rd-label" title={f.description}>
            <Icon size={13} /> {f.name}
          </span>
        )}
        {f.description && <small className="tb-rd-desc">{f.description}</small>}
      </span>
      {editor}
    </div>
  );
}

function LongText({ v, onSave, label }: { v: CellValue | undefined; onSave: (v: CellValue) => void; label: string }) {
  const start = typeof v === 'string' ? v : '';
  const [text, setText] = useState(start);
  useEffect(() => setText(start), [start]);
  return <textarea className="tb-rd-text" rows={1} value={text} aria-label={label} placeholder={tx('value', 'Empty')} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== start && onSave(text.trim() || null)} />;
}

/** Where a row sits among the rows shown, with the way to the one before and after. */
export interface RowNav {
  index: number; // 0-based
  count: number;
  prev?: () => void;
  next?: () => void;
}

export interface RecordProps {
  edit?: PageEdit; // set when this person may change the table's columns
  onPage?: (p: TablePage) => void; // field order and what's shown on every row's page
  onLayout?: () => void; // opens the row page layout (pinned fields, sections, main button)
  onNewField?: (f: TableField) => void;
  full?: boolean; // shown as a page instead of a side panel
  onToggleFull?: () => void;
  guest?: boolean; // a project's guest: no comments, no duplicate or delete
  table: DataTable;
  row: TableRow;
  ctx: CellCtx;
  me: string;
  phone?: boolean; // a page of its own (pushed over the table), with editors in sheets
  nav?: RowNav;
  onCell: (fieldId: string, v: CellValue) => void;
  onComment: (text: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopyLink?: () => void;
  onClose: () => void;
  onOpenRow: (tableId: string, rowId: string) => void;
  readOnly?: boolean;
}

/** Phones pin a few key fields by themselves when the table hasn't chosen: the status, a person, a date, an amount. */
export function autoPins(table: DataTable) {
  const status = statusField(table);
  return [status, ...(['person', 'date', 'money'] as const).map((k) => table.fields.slice(1).find((f) => f.type === k))].filter((f): f is TableField => !!f && f.id !== table.fields[0]?.id).map((f) => f.id);
}

/** How the page lays out a row's fields: pinned ones, the rest in order, named sections, and what's folded away. */
function layoutOf(table: DataTable, row: TableRow, ctx: CellCtx, foldEmpty: boolean, autoPin = false) {
  const page = table.page ?? {};
  const pos = new Map((page.order ?? []).map((id, i) => [id, i]));
  const rest = table.fields.slice(1).sort((a, b) => (pos.get(a.id) ?? 1e6 + table.fields.indexOf(a)) - (pos.get(b.id) ?? 1e6 + table.fields.indexOf(b)));
  const hiddenIds = new Set(page.hidden ?? []);
  const emptyHere = (f: TableField) => f.type !== 'button' && isEmpty(valueOf(table, f, row, ctx));
  const exists = new Set(table.fields.map((f) => f.id));
  const pinIds = page.pinned ?? (autoPin ? autoPins(table) : []);
  const pinned = pinIds.filter((id) => exists.has(id)).map((id) => table.fields.find((f) => f.id === id)!).slice(0, 5);
  const pinnedIds = new Set(pinned.map((f) => f.id));
  const main = page.main ? table.fields.find((f) => f.id === page.main && f.type === 'button') : undefined;
  const sectionOf = new Map<string, string>();
  for (const s of page.sections ?? []) for (const id of s.fields) if (!sectionOf.has(id)) sectionOf.set(id, s.id);
  const shown = (f: TableField) => !hiddenIds.has(f.id) && !pinnedIds.has(f.id) && f.id !== main?.id && !((page.hideEmpty || foldEmpty) && emptyHere(f));
  const body = rest.filter((f) => shown(f) && !sectionOf.has(f.id));
  const sections = (page.sections ?? []).map((s) => ({ ...s, list: s.fields.map((id) => rest.find((f) => f.id === id)).filter((f): f is TableField => !!f && shown(f) && sectionOf.get(f.id) === s.id) })).filter((s) => s.list.length);
  const folded = rest.filter((f) => !pinnedIds.has(f.id) && f.id !== main?.id && !shown(f));
  return { page, rest, hiddenIds, pinned, main, body, sections, folded };
}

/** The row page: every field, the rows that link here, comments and what changed. A side panel, or a page on phones. */
export function RecordDrawer(p: RecordProps) {
  if (p.phone) return <RecordPage {...p} />;
  return <RecordPanel {...p} />;
}

function linkedFromOf(table: DataTable, row: TableRow, ctx: CellCtx) {
  return ctx.tables.flatMap((tb) =>
    tb.fields
      .filter((f) => f.type === 'link' && f.linkTable === table.id)
      .flatMap((f) => ctx.rows.filter((r) => r.tableId === tb.id && Array.isArray(r.values[f.id]) && (r.values[f.id] as string[]).includes(row.id)).map((r) => ({ t: tb, f, r }))),
  );
}

function useRowKeys(nav: RowNav | undefined, onClose?: () => void) {
  const ref = useRef(nav);
  ref.current = nav;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Escape closes the panel wherever the focus is (a menu, a sheet or a dialog on top takes it first).
      if (e.key === 'Escape' && close.current && !e.defaultPrevented && !document.querySelector('.pop:not(.is-leaving), .modal-scrim:not(.is-leaving), .sheet-scrim:not(.is-leaving)') && !el.closest('.tb-drawer')) return void close.current();
      if (el.closest('input, textarea, [contenteditable=true], .pop') || e.altKey) return;
      const k = e.key.toLowerCase();
      const n = ref.current;
      // J and K (with or without Ctrl/Cmd+Shift, as in Notion): the next and the previous row.
      if (k === 'j' && (!e.metaKey && !e.ctrlKey ? !e.shiftKey : e.shiftKey) && n?.next) (e.preventDefault(), n.next());
      else if (k === 'k' && (!e.metaKey && !e.ctrlKey ? !e.shiftKey : e.shiftKey) && n?.prev) (e.preventDefault(), n.prev());
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
}

function Comments({ row, ctx, me, onComment }: { row: TableRow; ctx: CellCtx; me: string; onComment: (tb: string) => void }) {
  const [comment, setComment] = useState('');
  const userOf = (id: string): User | undefined => ctx.users.find((u) => u.id === id);
  return (
    <div className="tb-rd-sec">
      <h4>{t('Comments')}</h4>
      {(row.comments ?? []).map((c) => {
        const u = userOf(c.by);
        return (
          <div key={c.id} className="tb-comment">
            {u && <Avatar person={u} size={24} />}
            <div>
              <strong>{u?.name.split(' ')[0] ?? t('Someone')}</strong> <small className="muted">{relative(c.at)}</small>
              <p>{c.text}</p>
            </div>
          </div>
        );
      })}
      <form
        className="tb-comment-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (!comment.trim()) return;
          onComment(comment.trim());
          setComment('');
        }}
      >
        {userOf(me) && <Avatar person={userOf(me)!} size={24} />}
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('Write a comment')} aria-label={t('Write a comment')} enterKeyHint="send" />
        <button type="submit" className="icon-btn sm" disabled={!comment.trim()} aria-label={t('Send comment')}>
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}

function History({ table, row, ctx }: { table: DataTable; row: TableRow; ctx: CellCtx }) {
  const [all, setAll] = useState(false);
  if (!row.history?.length) return null;
  const byName = (id: string) => (id === 'webhook' ? t('A webhook') : id === 'rule' ? t('A rule') : (ctx.users.find((u) => u.id === id)?.name.split(' ')[0] ?? t('Someone')));
  const fieldName = (id: string) => table.fields.find((f) => f.id === id)?.name ?? t('a field');
  const show = (id: string, v: CellValue) => {
    const f = table.fields.find((x) => x.id === id);
    return f ? cellText(f, v, { users: ctx.users, rowName: (rid) => rowName(ctx.tables.find((tb) => tb.id === f.linkTable) ?? table, ctx.rows.find((r) => r.id === rid)) }) || tx('value', 'empty') : '';
  };
  const list = [...row.history].reverse();
  return (
    <div className="tb-rd-sec">
      <h4>{t('History')}</h4>
      <ul className="tb-history">
        {list.slice(0, all ? 50 : 5).map((h, i) => (
          <li key={i}>
            {tj('{who} changed {field}: {from} → {to}', { who: <strong>{byName(h.by)}</strong>, field: fieldName(h.fieldId), from: <span className="muted">{show(h.fieldId, h.from)}</span>, to: show(h.fieldId, h.to) })} <small className="muted">· {relative(h.at)}</small>
          </li>
        ))}
      </ul>
      {list.length > 5 && (
        <button type="button" className="link-btn small" onClick={() => setAll((x) => !x)}>
          {all ? t('Show less') : tn(list.length - 5, 'Show {n} older', 'Show {n} older')}
        </button>
      )}
    </div>
  );
}

function Extras({ row, linkedFrom, onOpenRow }: { row: TableRow; linkedFrom: ReturnType<typeof linkedFromOf>; onOpenRow: (tb: string, r: string) => void }) {
  return (
    <>
      {row.extra && Object.keys(row.extra).length > 0 && (
        <div className="tb-rd-sec">
          <h4>{t('Also received')}</h4>
          <p className="muted small">{t('Came in with the data but isn’t in a field. Map it in Automations to give it one.')}</p>
          <dl className="tb-extra">
            {Object.entries(row.extra).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {linkedFrom.length > 0 && (
        <div className="tb-rd-sec">
          <h4>{t('Linked here')}</h4>
          {linkedFrom.map(({ t: tb, f, r }) => (
            <button key={`${f.id}:${r.id}`} type="button" className="tb-rd-link" onClick={() => onOpenRow(tb.id, r.id)}>
              <i className="tb-dot" style={{ background: tb.color }} />
              <span>{rowName(tb, r)}</span>
              <small className="muted">
                {tb.name} · {f.name}
              </small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function TitleField({ table, row, readOnly, onCell, className }: { table: DataTable; row: TableRow; readOnly?: boolean; onCell: RecordProps['onCell']; className: string }) {
  const first = table.fields[0];
  const [title, setTitle] = useState(String(row.values[first.id] ?? ''));
  useEffect(() => setTitle(String(row.values[first.id] ?? '')), [row.id, row.values, first.id]);
  return (
    <textarea
      className={className}
      rows={1}
      value={title}
      readOnly={readOnly}
      placeholder={first.name}
      aria-label={first.name}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => title.trim() !== String(row.values[first.id] ?? '') && onCell(first.id, title.trim() || null)}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
    />
  );
}

function Meta({ row, ctx }: { row: TableRow; ctx: CellCtx }) {
  const u = ctx.users.find((x) => x.id === row.createdBy);
  return (
    <p className="muted small tb-rd-meta">
      {row.createdBy === 'webhook' ? t('Added {when} from a webhook', { when: relative(row.createdAt) }) : u ? t('Added {when} by {name}', { when: relative(row.createdAt), name: u.name.split(' ')[0] }) : t('Added {when}', { when: relative(row.createdAt) })}
      {row.updatedAt !== row.createdAt ? ` · ${t('changed {when}', { when: relative(row.updatedAt) })}` : ''}
    </p>
  );
}

/* ---------- desktop: the side panel (or a page) ---------- */

function RecordPanel({ table, row, ctx, me, onCell, onComment, onDelete, onDuplicate, onCopyLink, onClose, onOpenRow, readOnly, guest, full, onToggleFull, edit, onPage, onLayout, onNewField, nav }: RecordProps) {
  useOnePanel(onClose);
  useFocusedScreen();
  useRowKeys(nav, onClose);
  const { page, rest, hiddenIds, pinned, main, body, sections, folded } = layoutOf(table, row, ctx, false);
  const [showFolded, setShowFolded] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 }); // (newer browsers return a promise from scrollTo: never hand it to React)
  }, [row.id]);
  const ro = (f: TableField) => readOnly || (!!ctx.canEdit && !ctx.canEdit(f.id));
  const dropOn = (target: string) => {
    if (drag && drag !== target && onPage) {
      const ids = rest.map((f) => f.id).filter((x) => x !== drag);
      ids.splice(ids.indexOf(target), 0, drag);
      onPage({ ...page, order: ids });
    }
    setDrag(null);
    setOverId(null);
  };
  const line = (f: TableField, draggable: boolean) => (
    <FieldLine
      key={f.id}
      f={f}
      row={row}
      ctx={ctx}
      table={table}
      onCell={onCell}
      edit={edit}
      readOnly={ro(f)}
      dragProps={
        draggable && onPage
          ? {
              draggable: true,
              className: `tb-rd-line${drag === f.id ? ' dragging' : ''}${overId === f.id && drag !== f.id ? ' drop-line' : ''}`,
              onDragStart: (e) => ((e.dataTransfer.effectAllowed = 'move'), e.dataTransfer.setData('text/plain', f.id), setDrag(f.id)),
              onDragOver: (e) => (e.preventDefault(), overId !== f.id && setOverId(f.id)),
              onDrop: (e) => (e.preventDefault(), dropOn(f.id)),
              onDragEnd: () => (setDrag(null), setOverId(null)),
            }
          : undefined
      }
    />
  );
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer tb-drawer${full ? ' full' : ''}`} role="dialog" aria-label={rowName(table, row)} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="drawer-head">
          <span className="drawer-kind">
            <i className="tb-dot" style={{ background: table.color }} /> {table.name}
          </span>
          {nav && nav.count > 1 && (
            <span className="tb-rd-nav">
              <button type="button" className="icon-btn sm" disabled={!nav.prev} onClick={nav.prev} title={t('Previous row (K)')} aria-label={t('Previous row')}>
                <ChevronUp size={16} />
              </button>
              <button type="button" className="icon-btn sm" disabled={!nav.next} onClick={nav.next} title={t('Next row (J)')} aria-label={t('Next row')}>
                <ChevronDown size={16} />
              </button>
              <small className="muted">
                {t('{index} of {count}', { index: nav.index + 1, count: nav.count })}
              </small>
            </span>
          )}
          <span className="spacer" />
          {onCopyLink && (
            <button type="button" className="icon-btn sm" title={t('Copy a link to this row')} aria-label={t('Copy link')} onClick={onCopyLink}>
              <Link2 size={15} />
            </button>
          )}
          {onToggleFull && (
            <button type="button" className="icon-btn sm tb-rd-full" title={full ? t('Open as a side panel') : t('Open as a page')} aria-label={full ? t('Open as a side panel') : t('Open as a page')} onClick={onToggleFull}>
              {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
          {!readOnly && !guest && (
            <>
              <button type="button" className="icon-btn sm" title={t('Duplicate row')} aria-label={t('Duplicate row')} onClick={onDuplicate}>
                <Copy size={15} />
              </button>
              <span className="tb-rd-sep" aria-hidden />
              <button type="button" className="icon-btn sm" title={t('Delete row')} aria-label={t('Delete row')} onClick={() => confirm(t('Delete “{name}”?', { name: rowName(table, row) })) && onDelete()}>
                <Trash2 size={15} />
              </button>
            </>
          )}
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label={t('Close')} title={t('Close (Esc)')}>
            <X size={16} />
          </button>
        </header>
        <div className="drawer-body" ref={bodyRef}>
          <TitleField table={table} row={row} readOnly={ro(table.fields[0])} onCell={onCell} className="drawer-title" />
          <Meta row={row} ctx={ctx} />
          {pinned.length > 0 && <div className="tb-rd-fields tb-rd-pinned">{pinned.map((f) => line(f, false))}</div>}
          {main && (
            <div className="tb-rd-main">
              <ButtonCell f={main} row={row} ctx={ctx} />
            </div>
          )}
          <div className="tb-rd-fields">{body.map((f) => line(f, true))}</div>
          {sections.map((s) => (
            <div key={s.id} className="tb-rd-section">
              <h4>{s.name}</h4>
              <div className="tb-rd-fields">{s.list.map((f) => line(f, false))}</div>
            </div>
          ))}
          {folded.length > 0 && (
            <>
              <button type="button" className="link-btn small tb-rd-more" onClick={() => setShowFolded((x) => !x)} aria-expanded={showFolded}>
                <ChevronRight size={13} className={`rot-chev ${showFolded ? 'open' : ''}`} />
                {page.hideEmpty && folded.every((f) => !hiddenIds.has(f.id))
                  ? showFolded ? tn(folded.length, 'Hide {n} empty field', 'Hide {n} empty fields') : tn(folded.length, 'Show {n} empty field', 'Show {n} empty fields')
                  : showFolded ? tn(folded.length, 'Hide {n} more field', 'Hide {n} more fields') : tn(folded.length, 'Show {n} more field', 'Show {n} more fields')}
              </button>
              <div className={`fold ${showFolded ? 'open' : ''}`}>
                <div className="fold-in">
                  <div className="tb-rd-fields">
                    {folded.map((f) => (
                      <div key={f.id} className="tb-rd-folded">
                        {line(f, false)}
                        {hiddenIds.has(f.id) && onPage && (
                          <button type="button" className="link-btn small" onClick={() => onPage({ ...page, hidden: (page.hidden ?? []).filter((x) => x !== f.id) })}>
                            {t('Show on the page')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
          {onPage && (
            <div className="tb-rd-tools">
              {onNewField && (
                <>
                  <button ref={addRef} type="button" className="link-btn small" onClick={() => setAdding(true)}>
                    <Plus size={13} /> {t('Add a field')}
                  </button>
                  {edit && <FieldMenu anchor={addRef} open={adding} onClose={() => setAdding(false)} field={null} table={table} tables={edit.tables} onSave={onNewField} users={ctx.users} channels={edit.channels} rows={ctx.rows} previewCtx={ctx} />}
                </>
              )}
              {onLayout && (
                <button type="button" className="link-btn small" onClick={onLayout}>
                  <LayoutTemplate size={13} /> {t('Page layout')}
                </button>
              )}
              <label className="check-row small">
                <input type="checkbox" checked={!!page.hideEmpty} onChange={(e) => onPage({ ...page, hideEmpty: e.target.checked })} /> {t('Fold empty fields away')}
              </label>
            </div>
          )}
          <Extras row={row} linkedFrom={linkedFromOf(table, row, ctx)} onOpenRow={onOpenRow} />
          {!guest && <Comments row={row} ctx={ctx} me={me} onComment={onComment} />}
          <History table={table} row={row} ctx={ctx} />
        </div>
      </aside>
    </div>
  );
}

/* ---------- phones: a page of its own ---------- */

/** The value of one field on the phone page: tap to change it in a sheet (a checkbox flips, a button runs). */
function PhoneField({ f, table, row, ctx, readOnly, onEdit, onCell }: { f: TableField; table: DataTable; row: TableRow; ctx: CellCtx; readOnly: boolean; onEdit: (f: TableField) => void; onCell: RecordProps['onCell'] }) {
  const v = valueOf(table, f, row, ctx);
  const Icon = fieldIcon(f.type);
  const ro = readOnly || isComputed(f);
  const label = (
    <span className="tb-pf-label">
      <Icon size={13} /> {f.name}
    </span>
  );
  if (f.type === 'button')
    return (
      <div className="tb-pf">
        {label}
        <span className="tb-pf-val">
          <ButtonCell f={f} row={row} ctx={ctx} />
        </span>
      </div>
    );
  if (f.type === 'checkbox')
    return (
      <div className="tb-pf tb-pf-check">
        {label}
        <button type="button" role="switch" aria-checked={!!v} aria-label={f.name} disabled={ro} className={`switch ${v ? 'on' : ''}`} onClick={() => onCell(f.id, !v)}>
          <span />
        </button>
      </div>
    );
  return (
    <div className={`tb-pf${ro ? ' ro' : ''}`}>
      <button type="button" className="tb-pf-tap" disabled={ro} onClick={() => onEdit(f)} aria-label={ro ? t('{field}: {value}', { field: f.name, value: cellText(f, v, ctx) || tx('value', 'empty') }) : t('{field}: {value}, change', { field: f.name, value: cellText(f, v, ctx) || tx('value', 'empty') })}>
        {label}
        {f.description && <small className="tb-rd-desc">{f.description}</small>}
        <span className="tb-pf-val">{isEmpty(v) ? <span className="muted">{ro ? tx('value', 'Empty') : t('Add {field}', { field: f.name.toLowerCase() })}</span> : <CellView f={f} v={v} ctx={ctx} wrap />}</span>
      </button>
      {!isEmpty(v) && <ContactActions f={f} v={v} />}
    </div>
  );
}

/**
 * A row on a phone: its own page (Notion's). The name, then every field as a label-and-value row (the pinned ones
 * first), empty ones folded away, tabs when it's long, and the row's main button pinned at the bottom.
 */
function RecordPage({ table, row, ctx, me, onCell, onComment, onDelete, onDuplicate, onCopyLink, onClose, onOpenRow, readOnly, guest, nav }: RecordProps) {
  const { pinned, main: mainField, body, sections, folded } = layoutOf(table, row, ctx, true, true);
  const [showFolded, setShowFolded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<'fields' | 'activity' | 'files'>('fields');
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.querySelector('.tb-page .push-body')?.scrollTo({ top: 0 });
    setShowFolded(false);
  }, [row.id]);
  const ro = (f: TableField) => !!readOnly || (!!ctx.canEdit && !ctx.canEdit(f.id));
  const editField = editing ? table.fields.find((f) => f.id === editing) : undefined;
  // The main button: the one the layout names, else the first button that applies to this row.
  const applies = (f: TableField) => !f.button?.showWhen || (() => {
    const sf = table.fields.find((x) => x.id === f.button!.showWhen!.fieldId);
    return !sf || passes(f.button!.showWhen!, sf, row.values[sf.id], { users: ctx.users, rowName: () => '' });
  })();
  const main = mainField ?? (ctx.runButton ? table.fields.find((f) => f.type === 'button' && f.button && applies(f)) : undefined);
  const fileFields = table.fields.filter((f) => f.type === 'files');
  const activity = (row.comments?.length ?? 0) + (row.history?.length ?? 0);
  const long = body.length + sections.reduce((n, s) => n + s.list.length, 0) > 8 || (!guest && activity > 0) || fileFields.some((f) => !isEmpty(row.values[f.id]));
  const linkedFrom = linkedFromOf(table, row, ctx);
  const field = (f: TableField) => <PhoneField key={f.id} f={f} table={table} row={row} ctx={ctx} readOnly={ro(f)} onEdit={(x) => setEditing(x.id)} onCell={onCell} />;
  const more = useActionMenu(
    () => [
      ...(onCopyLink ? [{ label: t('Copy link'), icon: Link2, run: onCopyLink }] : []),
      ...(!readOnly && !guest ? [{ label: t('Duplicate'), icon: CopyPlus, run: onDuplicate }, { label: t('Delete'), icon: Trash2, danger: true, group: 'end', run: () => confirm(t('Delete “{name}”?', { name: rowName(table, row) })) && onDelete() }] : []),
    ],
    // When and by whom it was added lives here (Notion keeps it out of the page's way).
    { title: rowName(table, row), header: <div className="tb-page-meta"><Meta row={row} ctx={ctx} /></div> },
  );
  const moreBtn = useRef<HTMLButtonElement>(null);
  // Notion's page: one list of label-and-value rows, the pinned fields first.
  const fields: ReactNode = (
    <>
      <div className="tb-pf-list">{[...pinned, ...body].map(field)}</div>
      {sections.map((s) => (
        <div key={s.id} className="tb-pf-section">
          <h4>{s.name}</h4>
          <div className="tb-pf-list">{s.list.map(field)}</div>
        </div>
      ))}
      {folded.length > 0 && (
        <>
          <button type="button" className="tb-pf-more" onClick={() => setShowFolded((x) => !x)} aria-expanded={showFolded}>
            <ChevronRight size={15} className={`rot-chev ${showFolded ? 'open' : ''}`} />
            {showFolded ? t('Fewer fields') : tn(folded.length, '{n} more field', '{n} more fields')}
          </button>
          <div className={`fold ${showFolded ? 'open' : ''}`}>
            <div className="fold-in">
              <div className="tb-pf-list">{folded.map(field)}</div>
            </div>
          </div>
        </>
      )}
      <Extras row={row} linkedFrom={linkedFrom} onOpenRow={onOpenRow} />
    </>
  );
  const activityPane = (
    <>
      {!guest && <Comments row={row} ctx={ctx} me={me} onComment={onComment} />}
      <History table={table} row={row} ctx={ctx} />
    </>
  );
  const filesPane = <div className="tb-pf-list">{fileFields.map(field)}</div>;
  // Phones have no previous / next (Back, or a swipe from the left edge, is the way out); the row's main button stays.
  const footer = main ? (
    <div className="tb-page-foot">
      <span className="tb-page-main">
        <ButtonCell f={main} row={row} ctx={ctx} />
      </span>
    </div>
    ) : undefined;
  return (
    <PushScreen
      title={table.name}
      onBack={onClose}
      className="tb-page"
      actions={
        more.open || (!readOnly && !guest) || onCopyLink ? (
          <button ref={moreBtn} type="button" className="icon-btn" aria-label={t('Row options')} onClick={() => more.openFrom(moreBtn)}>
            <MoreHorizontal size={20} />
          </button>
        ) : undefined
      }
      footer={footer}
    >
      <div className="tb-page-body" ref={bodyRef}>
        {ro(table.fields[0]) ? (
          <h2 className="tb-page-title">{rowName(table, row)}</h2>
        ) : (
          <button type="button" className="tb-page-title" onClick={() => setEditing(table.fields[0].id)} aria-label={t('{field}: {value}, change', { field: table.fields[0].name, value: rowName(table, row) })}>
            {rowName(table, row)}
          </button>
        )}
        {long ? (
          <>
            <div className="segmented tb-page-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'fields'} className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>
                {t('Fields')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>
                {t('Activity')}
              </button>
              {fileFields.length > 0 && (
                <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
                  {t('Files')}
                </button>
              )}
            </div>
            <TabPane key={tab}>{tab === 'fields' ? fields : tab === 'activity' ? activityPane : filesPane}</TabPane>
          </>
        ) : (
          <>
            {fields}
            {activityPane}
          </>
        )}
      </div>
      {more.menu}
      {editField && <EditSheet table={table} field={editField} row={row} ctx={ctx} onSave={(v) => onCell(editField.id, v)} onClose={() => setEditing(null)} canCreate={!guest} />}
    </PushScreen>
  );
}
