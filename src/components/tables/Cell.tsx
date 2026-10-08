import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Mail, MessageCircle, Phone, Plus, Search, X } from 'lucide-react';
import type { CellValue, DataTable, FieldOption, TableField, TableRow, User } from '../../types';
import { Avatar } from '../Avatar';
import { Popover } from '../ui/Popover';
import { OPTION_COLORS, isEmpty, money, passes, rowName } from './fields';
import { uid } from '../../utils';

export interface CellCtx {
  users: User[];
  tables: DataTable[];
  rows: TableRow[];
  /** Adds a choice to a select / multi field and returns its id. */
  addOption: (fieldId: string, label: string) => string;
  /** Presses a Button field on a row; running holds "rowId:fieldId" while it works. */
  runButton?: (row: TableRow, f: TableField) => void;
  running?: Set<string>;
  isAdmin?: boolean;
  /** Guests: only some fields can be changed. */
  canEdit?: (fieldId: string) => boolean;
}

/** A Button field's button on a row: hidden where "Show on" doesn't match, busy while it runs. */
export function ButtonCell({ f, row, ctx }: { f: TableField; row: TableRow; ctx: CellCtx }) {
  const b = f.button;
  if (!b || !ctx.runButton) return null;
  if (b.showWhen) {
    const sf = ctx.tables.flatMap((t) => t.fields).find((x) => x.id === b.showWhen!.fieldId);
    if (sf && !passes(b.showWhen, sf, row.values[sf.id], { users: ctx.users, rowName: () => '' })) return null;
  }
  const busy = ctx.running?.has(`${row.id}:${f.id}`);
  const last = [...(row.runs ?? [])].reverse().find((x) => x.fieldId === f.id);
  const locked = b.who === 'admins' && !ctx.isAdmin;
  return (
    <button
      type="button"
      className={`tb-run${busy ? ' busy' : ''}${last && !last.ok ? ' failed' : ''}`}
      style={{ ['--c' as string]: b.color ?? OPTION_COLORS[1] }}
      disabled={busy || locked}
      title={locked ? 'Only admins can press this' : last ? `${last.ok ? 'Last run' : 'Failed'}: ${last.note}` : undefined}
      onClick={(e) => (e.stopPropagation(), ctx.runButton!(row, f))}
    >
      {busy ? <span className="tb-spin" aria-hidden /> : null}
      {b.label || f.name}
    </button>
  );
}

export const Chip = ({ o }: { o: FieldOption }) => (
  <span className="tb-chip" style={{ ['--c' as string]: o.color }}>
    {o.label}
  </span>
);

const linkRows = (f: TableField, ctx: CellCtx) => {
  const target = ctx.tables.find((t) => t.id === f.linkTable);
  return { target, rows: target ? ctx.rows.filter((r) => r.tableId === target.id) : [] };
};

/** A cell as you read it: chips for choices, an avatar for people, formatted money and dates. */
export function CellView({ f, v, ctx, wrap }: { f: TableField; v: CellValue | undefined; ctx: CellCtx; wrap?: boolean }) {
  if (isEmpty(v)) return f.type === 'checkbox' ? <span className="tb-check" aria-label="No" /> : null;
  switch (f.type) {
    case 'select': {
      const o = f.options?.find((x) => x.id === v);
      return o ? <Chip o={o} /> : null;
    }
    case 'multi':
      return (
        <span className="tb-chips">
          {(v as string[]).map((id) => {
            const o = f.options?.find((x) => x.id === id);
            return o ? <Chip key={id} o={o} /> : null;
          })}
        </span>
      );
    case 'person': {
      const u = ctx.users.find((x) => x.id === v);
      return u ? (
        <span className="tb-person">
          <Avatar person={u} size={20} />
          <span>{u.name}</span>
        </span>
      ) : null;
    }
    case 'money':
      return <span className="tb-num">{money(Number(v), f.currency)}</span>;
    case 'number':
      return <span className="tb-num">{Number(v).toLocaleString()}</span>;
    case 'checkbox':
      return (
        <span className="tb-check on" aria-label="Yes">
          <Check size={12} />
        </span>
      );
    case 'date': {
      const d = new Date(`${v}T00:00:00`);
      const late = String(v) < new Date().toISOString().slice(0, 10);
      return <span className={late ? 'tb-date late' : 'tb-date'}>{d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}</span>;
    }
    case 'link': {
      const { target } = linkRows(f, ctx);
      return (
        <span className="tb-chips">
          {(v as string[]).map((id) => (
            <span key={id} className="tb-chip linked">
              {target ? rowName(target, ctx.rows.find((r) => r.id === id)) : 'Missing'}
            </span>
          ))}
        </span>
      );
    }
    default:
      return <span className={wrap ? 'tb-text wrap' : 'tb-text'}>{String(v)}</span>;
  }
}

/** Quick actions next to contact fields: write, call, WhatsApp, open. */
export function ContactActions({ f, v }: { f: TableField; v: CellValue | undefined }) {
  if (isEmpty(v) || typeof v !== 'string') return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (f.type === 'email')
    return (
      <a className="tb-act" href={`mailto:${v}`} onClick={stop} title={`Email ${v}`}>
        <Mail size={13} />
      </a>
    );
  if (f.type === 'phone') {
    const digits = v.replace(/[^\d]/g, '').replace(/^0/, '62');
    return (
      <>
        <a className="tb-act" href={`tel:${v.replace(/\s/g, '')}`} onClick={stop} title="Call">
          <Phone size={13} />
        </a>
        <a className="tb-act" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" onClick={stop} title="WhatsApp">
          <MessageCircle size={13} />
        </a>
      </>
    );
  }
  if (f.type === 'url')
    return (
      <a className="tb-act" href={/^https?:\/\//.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer" onClick={stop} title="Open">
        <ExternalLink size={13} />
      </a>
    );
  return null;
}

/** Fields typed straight into the cell (text, numbers, contact details, dates). */
export const typesInline = (t: TableField['type']) => ['text', 'number', 'money', 'email', 'phone', 'url', 'date'].includes(t);

/** The input for a field typed in place. Saves on Enter or leaving; Escape puts it back. */
export function InlineInput({ f, v, onSave, onDone, autoFocus = true, className }: { f: TableField; v: CellValue | undefined; onSave: (v: CellValue) => void; onDone?: () => void; autoFocus?: boolean; className?: string }) {
  const start = isEmpty(v) ? '' : String(v);
  const [text, setText] = useState(start);
  const [focused, setFocused] = useState(autoFocus);
  const cancelled = useRef(false);
  // Money and numbers read formatted (Rp 4.500.000) until you click in to change them.
  const shown = !focused && !isEmpty(v) && (f.type === 'money' || f.type === 'number') ? (f.type === 'money' ? money(Number(v), f.currency) : Number(v).toLocaleString()) : text;
  useEffect(() => setText(start), [start]);
  const commit = () => {
    if (cancelled.current) return void (cancelled.current = false);
    const t = text.trim();
    let next: CellValue = t || null;
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(t.replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      next = t && Number.isFinite(n) ? n : null;
    }
    if (next !== (isEmpty(v) ? null : v)) onSave(next);
    onDone?.();
  };
  return (
    <input
      className={className ?? 'tb-input'}
      autoFocus={autoFocus}
      type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
      inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : f.type === 'phone' ? 'tel' : undefined}
      value={shown}
      placeholder={f.type === 'money' ? (f.currency ?? 'IDR') : undefined}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => (setFocused(false), commit())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setText(start);
          (e.currentTarget as HTMLInputElement).blur();
          onDone?.();
        }
      }}
    />
  );
}

/**
 * The picker for choices, people and linked rows, in a popover under the cell. Search, pick (several for
 * multiple choice and links), and "+ Add" a new choice from what you typed.
 */
export function PickPopover({ f, v, ctx, anchor, open, onClose, onSave }: { f: TableField; v: CellValue | undefined; ctx: CellCtx; anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; onSave: (v: CellValue) => void }) {
  const [q, setQ] = useState('');
  useEffect(() => setQ(''), [open]);
  const many = f.type === 'multi' || f.type === 'link';
  const chosen = new Set(Array.isArray(v) ? v : v ? [String(v)] : []);
  const items: { id: string; label: string; icon?: React.ReactNode }[] =
    f.type === 'person'
      ? ctx.users.map((u) => ({ id: u.id, label: u.name, icon: <Avatar person={u} size={20} /> }))
      : f.type === 'link'
        ? (() => {
            const { target, rows } = linkRows(f, ctx);
            return target ? rows.map((r) => ({ id: r.id, label: rowName(target, r) })) : [];
          })()
        : (f.options ?? []).map((o) => ({ id: o.id, label: o.label, icon: <i className="tb-dot" style={{ background: o.color }} /> }));
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => !needle || i.label.toLowerCase().includes(needle)).slice(0, 200);
  const canAdd = (f.type === 'select' || f.type === 'multi') && needle && !items.some((i) => i.label.toLowerCase() === needle);
  const pick = (id: string) => {
    if (many) {
      const next = chosen.has(id) ? [...chosen].filter((x) => x !== id) : [...chosen, id];
      onSave(next);
    } else {
      onSave(chosen.has(id) ? null : id);
      onClose();
    }
  };
  const add = () => {
    const id = ctx.addOption(f.id, q.trim());
    pick(id);
    setQ('');
  };
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={260} title={f.name}>
      <div className="tb-pick">
        <label className="tb-pick-search">
          <Search size={13} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={f.type === 'link' ? 'Find a row' : f.type === 'person' ? 'Find someone' : 'Find or add a choice'} onKeyDown={(e) => e.key === 'Enter' && (canAdd ? add() : shown[0] && pick(shown[0].id))} />
        </label>
        <div className="tb-pick-list">
          {shown.map((i) => (
            <button key={i.id} type="button" className={chosen.has(i.id) ? 'on' : ''} onClick={() => pick(i.id)}>
              {i.icon}
              <span className="tb-pick-label">{i.label}</span>
              {chosen.has(i.id) && <Check size={13} />}
            </button>
          ))}
          {!shown.length && !canAdd && <p className="muted small tb-pick-empty">{f.type === 'link' && !linkRows(f, ctx).target ? 'Pick the table to link to in this column’s settings.' : 'Nothing matches.'}</p>}
          {canAdd && (
            <button type="button" className="tb-pick-add" onClick={add}>
              <Plus size={13} /> Add “{q.trim()}”
            </button>
          )}
        </div>
        {chosen.size > 0 && !many && (
          <button type="button" className="tb-pick-clear" onClick={() => (onSave(null), onClose())}>
            <X size={13} /> Clear
          </button>
        )}
      </div>
    </Popover>
  );
}

/** Long text in a roomy popover. */
export function TextPopover({ v, anchor, open, onClose, onSave, title }: { v: CellValue | undefined; anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; onSave: (v: CellValue) => void; title: string }) {
  const [text, setText] = useState(isEmpty(v) ? '' : String(v));
  useEffect(() => {
    if (open) setText(isEmpty(v) ? '' : String(v));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    const t = text.trim();
    if (t !== (isEmpty(v) ? '' : String(v))) onSave(t || null);
    onClose();
  };
  return (
    <Popover anchor={anchor} open={open} onClose={close} width={340} title={title}>
      <textarea className="tb-longtext" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={6} onKeyDown={(e) => (e.key === 'Escape' ? onClose() : (e.metaKey || e.ctrlKey) && e.key === 'Enter' && close())} />
      <p className="muted small tb-hint">Saved when you click away. ⌘ Enter to finish.</p>
    </Popover>
  );
}

/** A new choice for a field, with the next colour in the palette. */
export const newOption = (f: TableField, label: string): FieldOption => ({ id: uid(), label, color: OPTION_COLORS[((f.options?.length ?? 0) + 1) % OPTION_COLORS.length] });
