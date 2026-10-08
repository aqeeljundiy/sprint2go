import { useEffect, useRef, useState } from 'react';
import { Copy, Send, Trash2, X } from 'lucide-react';
import type { CellValue, DataTable, TableField, TableRow, User } from '../../types';
import { Avatar } from '../Avatar';
import { relative } from '../../utils';
import { ButtonCell, CellView, ContactActions, InlineInput, PickPopover, typesInline, type CellCtx } from './Cell';
import { cellText, fieldIcon, rowName } from './fields';

/** One field on the row page: label on the left, the value (editable in place) on the right. */
export function FieldLine({ f, row, ctx, onCell, readOnly }: { f: TableField; row: TableRow; ctx: CellCtx; onCell: (fieldId: string, v: CellValue) => void; readOnly?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState(false);
  const v = row.values[f.id];
  const Icon = fieldIcon(f.type);
  const save = (x: CellValue) => onCell(f.id, x);
  let editor: React.ReactNode;
  if (f.type === 'button') editor = <span className="tb-rd-btn"><ButtonCell f={f} row={row} ctx={ctx} /></span>;
  else if (readOnly) editor = <span className="tb-rd-val ro"><CellView f={f} v={v} ctx={ctx} wrap /></span>;
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
          {cellText(f, v, { users: ctx.users, rowName: () => 'x' }) === '' && <span className="muted">Empty</span>}
        </button>
        <PickPopover f={f} v={v} ctx={ctx} anchor={ref} open={pop} onClose={() => setPop(false)} onSave={save} />
      </>
    );
  return (
    <div className="tb-rd-line">
      <span className="tb-rd-label">
        <Icon size={13} /> {f.name}
      </span>
      {editor}
    </div>
  );
}

function LongText({ v, onSave, label }: { v: CellValue | undefined; onSave: (v: CellValue) => void; label: string }) {
  const start = typeof v === 'string' ? v : '';
  const [text, setText] = useState(start);
  useEffect(() => setText(start), [start]);
  return <textarea className="tb-rd-text" rows={3} value={text} aria-label={label} placeholder="Empty" onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== start && onSave(text.trim() || null)} />;
}

/** The row page: every field, the rows that link here, comments and what changed. */
export function RecordDrawer({
  table,
  row,
  ctx,
  me,
  onCell,
  onComment,
  onDelete,
  onDuplicate,
  onClose,
  onOpenRow,
  readOnly,
}: {
  table: DataTable;
  row: TableRow;
  ctx: CellCtx;
  me: string;
  onCell: (fieldId: string, v: CellValue) => void;
  onComment: (text: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
  onOpenRow: (tableId: string, rowId: string) => void;
  readOnly?: boolean;
}) {
  const [title, setTitle] = useState(String(row.values[table.fields[0].id] ?? ''));
  const [comment, setComment] = useState('');
  useEffect(() => setTitle(String(row.values[table.fields[0].id] ?? '')), [row.id, row.values, table.fields]);
  const first = table.fields[0];
  const userOf = (id: string): User | undefined => ctx.users.find((u) => u.id === id);
  const byName = (id: string) => (id === 'webhook' ? 'A webhook' : id === 'rule' ? 'A rule' : (userOf(id)?.name.split(' ')[0] ?? 'Someone'));
  // Rows in other tables whose link fields point here.
  const linkedFrom = ctx.tables.flatMap((t) =>
    t.fields
      .filter((f) => f.type === 'link' && f.linkTable === table.id)
      .flatMap((f) => ctx.rows.filter((r) => r.tableId === t.id && Array.isArray(r.values[f.id]) && (r.values[f.id] as string[]).includes(row.id)).map((r) => ({ t, f, r }))),
  );
  const fieldName = (id: string) => table.fields.find((f) => f.id === id)?.name ?? 'a field';
  const show = (id: string, v: CellValue) => {
    const f = table.fields.find((x) => x.id === id);
    return f ? cellText(f, v, { users: ctx.users, rowName: (rid) => rowName(ctx.tables.find((t) => t.id === f.linkTable) ?? table, ctx.rows.find((r) => r.id === rid)) }) || 'empty' : '';
  };
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer tb-drawer" role="dialog" aria-label={rowName(table, row)} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="drawer-head">
          <span className="drawer-kind">
            <i className="tb-dot" style={{ background: table.color }} /> {table.name}
          </span>
          <span className="spacer" />
          {!readOnly && (
            <>
              <button type="button" className="icon-btn sm" title="Duplicate row" onClick={onDuplicate}>
                <Copy size={15} />
              </button>
              <button type="button" className="icon-btn sm" title="Delete row" onClick={() => confirm(`Delete “${rowName(table, row)}”?`) && onDelete()}>
                <Trash2 size={15} />
              </button>
            </>
          )}
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="drawer-body">
          <textarea
            className="drawer-title"
            rows={1}
            value={title}
            readOnly={readOnly}
            placeholder={first.name}
            aria-label={first.name}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== String(row.values[first.id] ?? '') && onCell(first.id, title.trim() || null)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
          />
          <p className="muted small tb-rd-meta">
            Added {relative(row.createdAt)}
            {row.createdBy === 'webhook' ? ' from a webhook' : userOf(row.createdBy) ? ` by ${userOf(row.createdBy)!.name.split(' ')[0]}` : ''}
            {row.updatedAt !== row.createdAt ? ` · changed ${relative(row.updatedAt)}` : ''}
          </p>

          <div className="tb-rd-fields">
            {table.fields.slice(1).map((f) => (
              <FieldLine key={f.id} f={f} row={row} ctx={ctx} onCell={onCell} readOnly={readOnly} />
            ))}
          </div>

          {row.extra && Object.keys(row.extra).length > 0 && (
            <div className="tb-rd-sec">
              <h4>Also received</h4>
              <p className="muted small">Came in with the data but isn’t in a field. Map it in Automations to give it one.</p>
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
              <h4>Linked here</h4>
              {linkedFrom.map(({ t, f, r }) => (
                <button key={`${f.id}:${r.id}`} type="button" className="tb-rd-link" onClick={() => onOpenRow(t.id, r.id)}>
                  <i className="tb-dot" style={{ background: t.color }} />
                  <span>{rowName(t, r)}</span>
                  <small className="muted">
                    {t.name} · {f.name}
                  </small>
                </button>
              ))}
            </div>
          )}

          <div className="tb-rd-sec">
            <h4>Comments</h4>
            {(row.comments ?? []).map((c) => {
              const u = userOf(c.by);
              return (
                <div key={c.id} className="tb-comment">
                  {u && <Avatar person={u} size={24} />}
                  <div>
                    <strong>{u?.name.split(' ')[0] ?? 'Someone'}</strong> <small className="muted">{relative(c.at)}</small>
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
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" />
              <button type="submit" className="icon-btn sm" disabled={!comment.trim()} aria-label="Send comment">
                <Send size={14} />
              </button>
            </form>
          </div>

          {(row.history?.length ?? 0) > 0 && (
            <div className="tb-rd-sec">
              <h4>History</h4>
              <ul className="tb-history">
                {[...row.history!].reverse().slice(0, 15).map((h, i) => (
                  <li key={i}>
                    <strong>{byName(h.by)}</strong> changed {fieldName(h.fieldId)}: <span className="muted">{show(h.fieldId, h.from)}</span> → {show(h.fieldId, h.to)} <small className="muted">· {relative(h.at)}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
