import { useMemo, useRef, useState } from 'react';
import { Camera, Check, FileText, Paperclip, Plus, Search, Star, Trash2, X } from 'lucide-react';
import type { CellValue, DataTable, FileRef, TableField, TableRow } from '../../types';
import { Sheet } from '../ui/Sheet';
import { PeopleList } from '../ui/PeopleList';
import { DatePicker } from '../ui/DatePicker';
import { toRef, type CellCtx } from './Cell';
import { isComputed, isEmpty, money, rowName, valueOf } from './fields';

/**
 * Changing one value on a phone: every kind of field gets a bottom sheet with the right keyboard (numbers, phone,
 * email, links), choices with search and "Create", people with avatars, a full-screen search for linked rows, the
 * camera first for files. Checkboxes and buttons don't need one (they change or run where they are).
 */
export function EditSheet({ table, field: f, row, ctx, onSave, onClose, title, canCreate = true }: { table: DataTable; field: TableField; row: TableRow; ctx: CellCtx; onSave: (v: CellValue) => void; onClose: () => void; title?: string; canCreate?: boolean }) {
  const v = valueOf(table, f, row, ctx);
  const name = title ?? f.name;
  if (f.type === 'select' || f.type === 'multi') return <ChoiceSheet f={f} v={v} ctx={ctx} title={name} onSave={onSave} onClose={onClose} canCreate={canCreate} />;
  if (f.type === 'person')
    return (
      <Sheet title={name} onClose={onClose} size="tall" className="tb-edit-sheet">
        <PeopleList users={ctx.users} me={undefined} selected={typeof v === 'string' && v ? [v] : []} extra={!isEmpty(v) ? [{ value: '', label: 'Nobody', icon: <X size={16} /> }] : []} onPick={(id) => (onSave(id && id !== v ? id : null), onClose())} />
      </Sheet>
    );
  if (f.type === 'link') return <LinkSheet f={f} v={v} ctx={ctx} title={name} onSave={onSave} onClose={onClose} />;
  if (f.type === 'date')
    return (
      <span className="tb-date-hidden">
        <DatePicker value={typeof v === 'string' ? v : ''} onChange={(d) => onSave(d || null)} label={name} autoOpen onClosed={onClose} compact />
      </span>
    );
  if (f.type === 'files') return <FilesSheet v={v} title={name} onSave={onSave} onClose={onClose} />;
  if (f.type === 'rating') return <RatingSheet v={v} max={f.max ?? 5} title={name} onSave={onSave} onClose={onClose} />;
  if (f.type === 'longtext') return <TextSheet f={f} v={v} title={name} onSave={onSave} onClose={onClose} long />;
  if (isComputed(f) || f.type === 'button' || f.type === 'checkbox') return null;
  return <TextSheet f={f} v={v} title={name} onSave={onSave} onClose={onClose} />;
}

/** Text, numbers, money, email, phone and links: one field with the keyboard that fits. */
function TextSheet({ f, v, title, onSave, onClose, long }: { f: TableField; v: CellValue; title: string; onSave: (v: CellValue) => void; onClose: () => void; long?: boolean }) {
  const [text, setText] = useState(isEmpty(v) ? '' : String(v));
  const numeric = f.type === 'number' || f.type === 'money';
  const save = () => {
    const t = text.trim();
    let next: CellValue = t || null;
    if (numeric) {
      const n = Number(t.replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      next = t && Number.isFinite(n) ? n : null;
    }
    if (JSON.stringify(next) !== JSON.stringify(isEmpty(v) ? null : v)) onSave(next);
    onClose();
  };
  const attrs = {
    autoFocus: true,
    value: text,
    'aria-label': title,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
  };
  return (
    <Sheet
      title={title}
      onClose={save}
      size={long ? 'tall' : 'auto'}
      className="tb-edit-sheet"
      footer={
        <>
          {!isEmpty(v) && (
            <button type="button" className="ghost-btn" onClick={() => (onSave(null), onClose())}>
              Clear
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="primary-btn" onClick={save}>
            Done
          </button>
        </>
      }
    >
      {long ? (
        <textarea className="tb-sheet-text" rows={8} {...attrs} />
      ) : (
        <div className="tb-sheet-field">
          <input
            {...attrs}
            type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : 'text'}
            inputMode={numeric ? 'decimal' : f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
            autoComplete="off"
            autoCapitalize={f.type === 'text' ? 'sentences' : 'off'}
            enterKeyHint="done"
            placeholder={f.type === 'money' ? `Amount in ${f.currency ?? 'IDR'}` : f.type === 'phone' ? '+62 812 …' : f.type === 'email' ? 'name@company.com' : f.type === 'url' ? 'website.com' : f.name}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
          />
          {f.type === 'money' && text.trim() && Number.isFinite(Number(text.replace(/[^\d.-]/g, ''))) && <small className="muted">{money(Number(text.replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')), f.currency)}</small>}
        </div>
      )}
    </Sheet>
  );
}

/** Choices: search on top, coloured options with ticks, "Create" from what was typed, Done for several. */
function ChoiceSheet({ f, v, ctx, title, onSave, onClose, canCreate }: { f: TableField; v: CellValue; ctx: CellCtx; title: string; onSave: (v: CellValue) => void; onClose: () => void; canCreate: boolean }) {
  const many = f.type === 'multi';
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>(Array.isArray(v) ? (v as string[]) : typeof v === 'string' && v ? [v] : []);
  const needle = q.trim().toLowerCase();
  const options = (f.options ?? []).filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const exact = (f.options ?? []).some((o) => o.label.toLowerCase() === needle);
  const pick = (id: string) => {
    if (!many) {
      onSave(picked[0] === id ? null : id);
      return onClose();
    }
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    onSave(next);
  };
  const create = () => {
    const id = ctx.addOption(f.id, q.trim());
    setQ('');
    pick(id);
  };
  return (
    <Sheet
      title={title}
      onClose={onClose}
      size="tall"
      className="tb-edit-sheet"
      head={
        many && (
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      {(f.options?.length ?? 0) > 6 || canCreate ? (
        <label className="sheet-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={canCreate ? 'Find or create a choice' : 'Find a choice'} aria-label="Find a choice" enterKeyHint="done" onKeyDown={(e) => e.key === 'Enter' && (needle && !exact && canCreate ? create() : options[0] && pick(options[0].id))} />
        </label>
      ) : null}
      <div className="as-list" role="listbox" aria-multiselectable={many || undefined}>
        {options.map((o) => (
          <button key={o.id} type="button" role="option" aria-selected={picked.includes(o.id)} className="as-item tb-choice" onClick={() => pick(o.id)}>
            <span className="tb-chip" style={{ ['--c' as string]: o.color }}>
              {o.label}
            </span>
            <span className="spacer" />
            {picked.includes(o.id) && <Check size={18} className="as-check" />}
          </button>
        ))}
        {needle && !exact && canCreate && (
          <button type="button" className="as-item" onClick={create}>
            <Plus size={18} className="as-icon" />
            <span className="as-label">Create “{q.trim()}”</span>
          </button>
        )}
        {!options.length && !(needle && canCreate) && <p className="muted small tb-pick-empty">Nothing matches.</p>}
        {!many && picked.length > 0 && !needle && (
          <button type="button" className="as-item" onClick={() => (onSave(null), onClose())}>
            <X size={18} className="as-icon" />
            <span className="as-label">Clear</span>
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Linked rows: a full-screen search over the other table, several can be picked. */
function LinkSheet({ f, v, ctx, title, onSave, onClose }: { f: TableField; v: CellValue; ctx: CellCtx; title: string; onSave: (v: CellValue) => void; onClose: () => void }) {
  const target = ctx.tables.find((t) => t.id === f.linkTable);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>(Array.isArray(v) ? (v as string[]) : []);
  const all = useMemo(() => (target ? ctx.rows.filter((r) => r.tableId === target.id) : []), [target, ctx.rows]);
  const needle = q.trim().toLowerCase();
  const shown = all.filter((r) => !needle || rowName(target!, r).toLowerCase().includes(needle)).slice(0, 200);
  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    onSave(next);
  };
  return (
    <Sheet
      title={title}
      onClose={onClose}
      size="full"
      className="tb-edit-sheet"
      head={
        <button type="button" className="ghost-btn sm" onClick={onClose}>
          Done
        </button>
      }
    >
      <label className="sheet-search">
        <Search size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={target ? `Find in ${target.name}` : 'Find a row'} aria-label="Find a row" />
      </label>
      {!target && <p className="muted small tb-pick-empty">Pick the table to link to in this field’s settings (on a computer).</p>}
      <div className="as-list" role="listbox" aria-multiselectable>
        {shown.map((r) => (
          <button key={r.id} type="button" role="option" aria-selected={picked.includes(r.id)} className="as-item" onClick={() => toggle(r.id)}>
            <i className="tb-dot" style={{ background: target?.color }} />
            <span className="as-label">{rowName(target!, r)}</span>
            {picked.includes(r.id) && <Check size={18} className="as-check" />}
          </button>
        ))}
        {target && !shown.length && <p className="muted small tb-pick-empty">Nothing matches.</p>}
      </div>
    </Sheet>
  );
}

/** Files: the camera first, then the phone's files; each one can be opened or removed. */
function FilesSheet({ v, title, onSave, onClose }: { v: CellValue; title: string; onSave: (v: CellValue) => void; onClose: () => void }) {
  const [files, setFiles] = useState<FileRef[]>(Array.isArray(v) ? (v as FileRef[]) : []);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setErr('');
    setBusy(true);
    try {
      const made = await Promise.all([...list].map(toRef));
      const next = [...files, ...made];
      setFiles(next);
      onSave(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = (i: number) => {
    const next = files.filter((_, j) => j !== i);
    setFiles(next);
    onSave(next.length ? next : null);
  };
  return (
    <Sheet title={title} onClose={onClose} className="tb-edit-sheet">
      <div className="as-list">
        <button type="button" className="as-item" disabled={busy} onClick={() => camera.current?.click()}>
          <Camera size={18} className="as-icon" />
          <span className="as-label">Take a photo</span>
        </button>
        <button type="button" className="as-item" disabled={busy} onClick={() => picker.current?.click()}>
          <Paperclip size={18} className="as-icon" />
          <span className="as-label">
            Choose files
            <small>Photos up to 1600 px, other files up to 3 MB</small>
          </span>
        </button>
        {busy && <p className="muted small tb-pick-empty">Adding…</p>}
        {err && <p className="err small tb-pick-empty">{err}</p>}
        {files.length > 0 && <div className="as-sep" role="separator" />}
        {files.map((x, i) => (
          <div key={i} className="tb-file-row tb-file-row-lg">
            {x.type.startsWith('image/') ? <img src={x.url} alt="" /> : <span className="tb-file-ico"><FileText size={18} /></span>}
            <a href={x.url} download={x.name} target="_blank" rel="noreferrer" className="tb-file-name">
              {x.name}
            </a>
            <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => remove(i)}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
      <input ref={picker} type="file" multiple hidden onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
    </Sheet>
  );
}

/** Stars, big enough for a thumb. */
function RatingSheet({ v, max, title, onSave, onClose }: { v: CellValue; max: number; title: string; onSave: (v: CellValue) => void; onClose: () => void }) {
  const n = Number(v) || 0;
  return (
    <Sheet title={title} onClose={onClose} className="tb-edit-sheet">
      <div className="tb-stars-big" role="radiogroup" aria-label={title}>
        {Array.from({ length: max }, (_, i) => (
          <button key={i} type="button" role="radio" aria-checked={n === i + 1} className={i < n ? 'on' : ''} onClick={() => (onSave(n === i + 1 ? null : i + 1), onClose())} aria-label={`${i + 1} of ${max}`}>
            <Star size={30} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
