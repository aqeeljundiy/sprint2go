import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, FileText, Mail, MessageCircle, Paperclip, Phone, Plus, Search, Star, Trash2, X } from 'lucide-react';
import type { CellValue, DataTable, FieldOption, FileRef, TableField, TableRow, User } from '../../types';
import { Avatar } from '../Avatar';
import { Popover } from '../ui/Popover';
import { OPTION_COLORS, cellText, isEmpty, money, noteOf, passes, rowName } from './fields';
import { uid } from '../../utils';
import { PeopleList } from '../ui/PeopleList';
import { uploadFile } from '../../sync';
import { session } from '../../store';
import { t } from '../../i18n';
import { fmtDay, fmtNumber } from '../../i18n/format';

export interface CellCtx {
  users: User[];
  tables: DataTable[];
  rows: TableRow[];
  rowName: (id: string) => string; // any row's name, for links and rollups
  /** Adds a choice to a select / multi field and returns its id. */
  addOption: (fieldId: string, label: string) => string;
  /** Presses a Button field on a row; running holds "rowId:fieldId" while it works. */
  runButton?: (row: TableRow, f: TableField) => void;
  running?: Set<string>;
  isAdmin?: boolean;
  /** Guests: only some fields can be changed. */
  canEdit?: (fieldId: string) => boolean;
  /** Goes to a linked row (in its own table). */
  openLinked?: (tableId: string, rowId: string) => void;
}

/** A Button field's button on a row: hidden where "Show on" doesn't match, busy while it runs. */
export function ButtonCell({ f, row, ctx }: { f: TableField; row: TableRow; ctx: CellCtx }) {
  const b = f.button;
  if (!b || !ctx.runButton) return null;
  if (b.showWhen) {
    const sf = ctx.tables.flatMap((tb) => tb.fields).find((x) => x.id === b.showWhen!.fieldId);
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
      title={locked ? t('Only admins can press this') : last ? (last.ok ? t('Last run: {note}', { note: noteOf(last) }) : t('Failed: {note}', { note: noteOf(last) })) : undefined}
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
  const target = ctx.tables.find((tb) => tb.id === f.linkTable);
  return { target, rows: target ? ctx.rows.filter((r) => r.tableId === target.id) : [] };
};

/** A cell as you read it: chips for choices, an avatar for people, formatted money and dates. */
export function CellView({ f, v, ctx, wrap }: { f: TableField; v: CellValue | undefined; ctx: CellCtx; wrap?: boolean }) {
  if (isEmpty(v)) return f.type === 'checkbox' ? <span className="tb-check" aria-label={t('No')} /> : null;
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
      return <span className="tb-num">{fmtNumber(Number(v))}</span>;
    case 'checkbox':
      return (
        <span className="tb-check on" aria-label={t('Yes')}>
          <Check size={12} />
        </span>
      );
    case 'date': {
      const late = String(v) < new Date().toISOString().slice(0, 10);
      return <span className={late ? 'tb-date late' : 'tb-date'}>{fmtDay(String(v).slice(0, 10))}</span>;
    }
    case 'link': {
      const { target } = linkRows(f, ctx);
      return (
        <span className="tb-chips">
          {(v as string[]).map((id) => {
            const name = target ? rowName(target, ctx.rows.find((r) => r.id === id)) : t('Missing');
            const go = target && ctx.openLinked ? () => ctx.openLinked!(target.id, id) : undefined;
            // A linked row is a link: click it to go there (in a span, since it can sit inside a card's button).
            return go ? (
              <span
                key={id}
                role="link"
                tabIndex={0}
                className="tb-chip linked go"
                title={t('Open {row} in {table}', { row: name, table: target!.name })}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => (e.stopPropagation(), e.preventDefault(), go())}
                onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), go())}
              >
                {name}
              </span>
            ) : (
              <span key={id} className="tb-chip linked">
                {name}
              </span>
            );
          })}
        </span>
      );
    }
    case 'files': {
      const files = v as FileRef[];
      return (
        <span className="tb-files">
          {files.slice(0, 4).map((x, i) =>
            x.type.startsWith('image/') ? <img key={i} src={x.url} alt={x.name} title={x.name} /> : (
              <span key={i} className="tb-file-chip" title={x.name}>
                <FileText size={12} /> {x.name}
              </span>
            ),
          )}
          {files.length > 4 && <span className="muted small">+{files.length - 4}</span>}
        </span>
      );
    }
    case 'rating':
      return <Stars n={Number(v)} max={f.max ?? 5} />;
    case 'creator': {
      const u = ctx.users.find((x) => x.id === v);
      return u ? (
        <span className="tb-person">
          <Avatar person={u} size={20} />
          <span>{u.name}</span>
        </span>
      ) : (
        <span className="tb-text muted">{cellText(f, v, ctx)}</span>
      );
    }
    case 'created':
    case 'edited':
      return <span className="tb-date">{cellText(f, v, ctx)}</span>;
    case 'formula':
    case 'rollup':
      return typeof v === 'number' ? <span className="tb-num">{cellText(f, v, ctx)}</span> : <span className={wrap ? 'tb-text wrap' : 'tb-text'}>{cellText(f, v, ctx)}</span>;
    default:
      return <span className={wrap ? 'tb-text wrap' : 'tb-text'}>{String(v)}</span>;
  }
}

/** Stars, read only. */
export const Stars = ({ n, max }: { n: number; max: number }) => (
  <span className="tb-stars" aria-label={t('{n} of {max}', { n, max })}>
    {Array.from({ length: max }, (_, i) => (
      <Star key={i} size={13} className={i < n ? 'on' : ''} />
    ))}
  </span>
);

/** Stars you click: the same star again clears it. */
export function RatingInput({ v, max, onSave }: { v: CellValue | undefined; max: number; onSave: (v: CellValue) => void }) {
  const n = Number(v) || 0;
  const [hover, setHover] = useState(0);
  return (
    <span className="tb-stars edit" onMouseLeave={() => setHover(0)}>
      {Array.from({ length: max }, (_, i) => (
        <button key={i} type="button" className={i < (hover || n) ? 'on' : ''} onMouseEnter={() => setHover(i + 1)} onClick={(e) => (e.stopPropagation(), onSave(n === i + 1 ? null : i + 1))} aria-label={t('{n} of {max}', { n: i + 1, max })}>
          <Star size={14} />
        </button>
      ))}
    </span>
  );
}

const MAX_FILE = 3 * 1024 * 1024;
/** A picked file as a small stored copy: pictures shrunk to 1600px, anything else up to 3 MB. */
export async function toRef(file: File): Promise<FileRef> {
  // Pictures are shrunk to 1600px first; everything then goes to the server (a data URL in the demo).
  let blob: Blob = file;
  let type = file.type || 'application/octet-stream';
  if (file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml') {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise<Blob>((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error(t('Couldn’t read the picture')))), 'image/jpeg', 0.82));
    type = 'image/jpeg';
  } else if (file.size > MAX_FILE) throw new Error(t('Files up to 3 MB here; put bigger ones in Drive and link them.'));
  const up = await uploadFile(new File([blob], file.name, { type }), session.wsId, file.name);
  return { name: file.name, size: up.size, type: up.type, url: up.url };
}

/** A row's files: see them, add more (pick or drop), remove one. */
export function FilesPopover({ v, anchor, open, onClose, onSave, title, readOnly }: { v: CellValue | undefined; anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; onSave: (v: CellValue) => void; title: string; readOnly?: boolean }) {
  const files = (Array.isArray(v) ? v : []) as FileRef[];
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr('');
    try {
      const made = await Promise.all([...list].map(toRef));
      onSave([...files, ...made]);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={320} title={title}>
      <div className={`tb-filebox${over ? ' over' : ''}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={(e) => (e.preventDefault(), setOver(false), !readOnly && void add(e.dataTransfer.files))}>
        {files.map((x, i) => (
          <div key={i} className="tb-file-row">
            {x.type.startsWith('image/') ? <img src={x.url} alt="" /> : <span className="tb-file-ico"><FileText size={16} /></span>}
            <a href={x.url} download={x.name} target="_blank" rel="noreferrer" className="tb-file-name">
              {x.name}
            </a>
            <small className="muted">{x.size > 1e6 ? `${fmtNumber(x.size / 1e6, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB` : `${fmtNumber(Math.max(1, Math.round(x.size / 1e3)))} KB`}</small>
            {!readOnly && (
              <button type="button" className="icon-btn sm" aria-label={t('Remove {name}', { name: x.name })} onClick={() => onSave(files.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" className="tb-file-add" onClick={() => input.current?.click()}>
            <Paperclip size={14} /> {files.length ? t('Add more') : t('Add files')} <small className="muted">{t('or drop them here')}</small>
          </button>
        )}
        {err && <p className="err small">{err}</p>}
        <input ref={input} type="file" multiple hidden onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
      </div>
    </Popover>
  );
}

/** Quick actions next to contact fields: write, call, WhatsApp, open. */
export function ContactActions({ f, v }: { f: TableField; v: CellValue | undefined }) {
  if (isEmpty(v) || typeof v !== 'string') return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (f.type === 'email')
    return (
      <a className="tb-act" href={`mailto:${v}`} onClick={stop} title={t('Email {address}', { address: v })}>
        <Mail size={13} />
      </a>
    );
  if (f.type === 'phone') {
    const digits = v.replace(/[^\d]/g, '').replace(/^0/, '62');
    return (
      <>
        <a className="tb-act" href={`tel:${v.replace(/\s/g, '')}`} onClick={stop} title={t('Call')}>
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
      <a className="tb-act" href={/^https?:\/\//.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer" onClick={stop} title={t('Open')}>
        <ExternalLink size={13} />
      </a>
    );
  return null;
}

/** Fields typed straight into the cell (text, numbers, contact details, dates). */
export const typesInline = (type: TableField['type']) => ['text', 'number', 'money', 'email', 'phone', 'url'].includes(type);

/** The input for a field typed in place. Saves on Enter or leaving; Escape puts it back. */
export function InlineInput({ f, v, onSave, onDone, autoFocus = true, className, initial }: { f: TableField; v: CellValue | undefined; onSave: (v: CellValue) => void; onDone?: (move?: 'down' | 'right' | 'left') => void; autoFocus?: boolean; className?: string; initial?: string }) {
  const start = isEmpty(v) ? '' : String(v);
  const [text, setText] = useState(initial ?? start);
  const move = useRef<'down' | 'right' | 'left' | undefined>(undefined);
  const [focused, setFocused] = useState(autoFocus);
  const cancelled = useRef(false);
  // Money and numbers read formatted (Rp 4.500.000) until you click in to change them.
  const shown = !focused && !isEmpty(v) && (f.type === 'money' || f.type === 'number') ? (f.type === 'money' ? money(Number(v), f.currency) : fmtNumber(Number(v))) : text;
  useEffect(() => {
    if (initial === undefined) setText(start);
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  const finished = useRef(false); // Enter, Tab and leaving the field all save, but only once
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    if (cancelled.current) return void (cancelled.current = false);
    const typed = text.trim();
    let next: CellValue = typed || null;
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(typed.replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      next = typed && Number.isFinite(n) ? n : null;
    }
    if (next !== (isEmpty(v) ? null : v)) onSave(next);
    onDone?.(move.current);
    move.current = undefined;
  };
  return (
    <input
      className={className ?? 'tb-input'}
      autoFocus={autoFocus}
      type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
      inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : f.type === 'phone' ? 'tel' : undefined}
      value={shown}
      placeholder={f.type === 'money' ? (autoFocus ? (f.currency ?? 'IDR') : t('Empty')) : undefined}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => ((finished.current = false), setFocused(true))}
      onBlur={() => (setFocused(false), commit())}
      onKeyDown={(e) => {
        e.stopPropagation(); // the grid's own keys (arrows, copy, paste) wait until editing ends
        if (e.key === 'Enter') ((move.current = 'down'), commit());
        if (e.key === 'Tab') (e.preventDefault(), (move.current = e.shiftKey ? 'left' : 'right'), commit());
        if (e.key === 'Escape') {
          finished.current = true;
          setText(start);
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
  const chosen = new Set<string>(Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);
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
  if (f.type === 'person')
    return (
      <Popover anchor={anchor} open={open} onClose={onClose} width={300} title={f.name}>
        <PeopleList
          users={ctx.users}
          selected={[...chosen]}
          extra={chosen.size ? [{ value: '', label: t('Clear'), icon: <X size={14} /> }] : []}
          onPick={(id) => (onSave(id && !chosen.has(id) ? id : null), onClose())}
        />
      </Popover>
    );
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={260} title={f.name}>
      <div className="tb-pick">
        <label className="tb-pick-search">
          <Search size={13} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={f.type === 'link' ? t('Find a row') : t('Find or add a choice')} onKeyDown={(e) => e.key === 'Enter' && (canAdd ? add() : shown[0] && pick(shown[0].id))} />
        </label>
        <div className="tb-pick-list">
          {shown.map((i) => (
            <button key={i.id} type="button" className={chosen.has(i.id) ? 'on' : ''} onClick={() => pick(i.id)}>
              {i.icon}
              <span className="tb-pick-label">{i.label}</span>
              {chosen.has(i.id) && <Check size={13} />}
            </button>
          ))}
          {!shown.length && !canAdd && <p className="muted small tb-pick-empty">{f.type === 'link' && !linkRows(f, ctx).target ? t('Pick the table to link to in this column’s settings.') : t('Nothing matches.')}</p>}
          {canAdd && (
            <button type="button" className="tb-pick-add" onClick={add}>
              <Plus size={13} /> {t('Add “{name}”', { name: q.trim() })}
            </button>
          )}
        </div>
        {chosen.size > 0 && !many && (
          <button type="button" className="tb-pick-clear" onClick={() => (onSave(null), onClose())}>
            <X size={13} /> {t('Clear')}
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
    const typed = text.trim();
    if (typed !== (isEmpty(v) ? '' : String(v))) onSave(typed || null);
    onClose();
  };
  return (
    <Popover anchor={anchor} open={open} onClose={close} width={340} title={title}>
      <textarea className="tb-longtext" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={6} onKeyDown={(e) => (e.key === 'Escape' ? onClose() : (e.metaKey || e.ctrlKey) && e.key === 'Enter' && close())} />
      <p className="muted small tb-hint">{t('Saved when you click away. ⌘ Enter to finish.')}</p>
    </Popover>
  );
}

/** A new choice for a field, with the next colour in the palette. */
export const newOption = (f: TableField, label: string): FieldOption => ({ id: uid(), label, color: OPTION_COLORS[((f.options?.length ?? 0) + 1) % OPTION_COLORS.length] });
