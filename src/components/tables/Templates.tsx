import { useState } from 'react';
import { CalendarClock, Copy, LayoutTemplate, Plus, Trash2, UserRound, X } from 'lucide-react';
import type { CellValue, DataTable, RowTemplate, TableField, TableRow } from '../../types';
import { localDay, uid } from '../../utils';
import { deviceTz } from '../../jobTimes';
import { SmoothHeight } from '../ui/Smooth';
import { DatePicker } from '../ui/DatePicker';
import { PickSelect } from '../ui/PickSelect';
import { PersonSelect } from '../ui/PeoplePicker';
import { FieldLine } from './RecordDrawer';
import type { CellCtx } from './Cell';
import { fieldIcon, isComputed, repeatWords } from './fields';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One value in a template: a date can be "the day it's made", a person "whoever adds it". */
function TemplateValue({ t, f, tpl, ctx, onValue }: { t: DataTable; f: TableField; tpl: RowTemplate; ctx: CellCtx; onValue: (id: string, v: CellValue) => void }) {
  const v = tpl.values[f.id];
  const Icon = fieldIcon(f.type);
  if (f.type === 'date')
    return (
      <div className="tb-rd-line">
        <span className="tb-rd-labelcell">
          <span className="tb-rd-label">
            <Icon size={13} /> {f.name}
          </span>
        </span>
        <span className="tb-tpl-val">
          <button type="button" className={`tb-chip linked${v === '@today' ? ' on' : ''}`} aria-pressed={v === '@today'} onClick={() => onValue(f.id, v === '@today' ? null : '@today')}>
            The day it’s made
          </button>
          <DatePicker value={typeof v === 'string' && v !== '@today' ? v : ''} onChange={(d) => onValue(f.id, d || null)} label={f.name} placeholder="Empty" className="sel-flat" />
        </span>
      </div>
    );
  if (f.type === 'person')
    return (
      <div className="tb-rd-line">
        <span className="tb-rd-labelcell">
          <span className="tb-rd-label">
            <Icon size={13} /> {f.name}
          </span>
        </span>
        <PersonSelect className="sel-flat" value={typeof v === 'string' ? v : ''} users={ctx.users} label={f.name} placeholder="Empty" extra={[{ value: '', label: 'Empty', icon: <X size={15} /> }, { value: '@me', label: 'Whoever adds it', icon: <UserRound size={15} /> }]} onChange={(id) => onValue(f.id, id || null)} />
      </div>
    );
  const fake: TableRow = { id: `tpl-${tpl.id}`, workspaceId: t.workspaceId, tableId: t.id, values: tpl.values, order: 0, createdBy: '', createdAt: '', updatedAt: '' };
  return <FieldLine f={f} row={fake} ctx={{ ...ctx, runButton: undefined }} table={t} onCell={onValue} />;
}

/**
 * Row templates: rows to start from ("Hot lead", "Weekly report"), one of them the default for new rows, and any of
 * them made by itself on a schedule (the server adds the row; see server/tables.ts runTemplates). Edits stay here
 * until Save.
 */
export function TemplatesDialog({ t, ctx, onSave, onClose }: { t: DataTable; ctx: CellCtx; onSave: (templates: RowTemplate[]) => void; onClose: () => void }) {
  const [list, setList] = useState<RowTemplate[]>(() => structuredClone(t.templates ?? []));
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null);
  const fields = t.fields.filter((f) => !isComputed(f) && f.type !== 'button' && f.type !== 'link');
  const patch = (id: string, p: Partial<RowTemplate>) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const add = (from?: RowTemplate) => {
    const n: RowTemplate = from ? { ...structuredClone(from), id: uid(), name: `${from.name} copy`, isDefault: false } : { id: uid(), name: `Template ${list.length + 1}`, values: {} };
    setList((l) => [...l, n]);
    setOpen(n.id);
  };
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-tpl-modal" role="dialog" aria-label="Row templates" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <LayoutTemplate size={15} /> Row templates · {t.name}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          {!list.length && <p className="muted small">Rows people start from, filled in already: a hot lead with its source and status, a weekly report that adds itself every Monday.</p>}
          {list.map((tpl) => {
            const isOpen = open === tpl.id;
            return (
              <section key={tpl.id} className={`tb-tpl${isOpen ? ' open' : ''}`}>
                <button type="button" className="tb-tpl-head" onClick={() => setOpen(isOpen ? null : tpl.id)} aria-expanded={isOpen}>
                  <strong>{tpl.name || 'Untitled'}</strong>
                  {tpl.isDefault && <span className="tb-name-tag">Default</span>}
                  {tpl.repeat && (
                    <small className="muted">
                      <CalendarClock size={12} /> {repeatWords(tpl.repeat)}
                    </small>
                  )}
                </button>
                <div className={`fold ${isOpen ? 'open' : ''}`}>
                  <div className="fold-in">
                    <div className="tb-tpl-body">
                      <label className="field">
                        <span>Name</span>
                        <input value={tpl.name} onChange={(e) => patch(tpl.id, { name: e.target.value })} aria-label="Template name" />
                      </label>
                      <div className="tb-rd-fields">
                        {fields.map((f) => (
                          <TemplateValue key={f.id} t={t} f={f} tpl={tpl} ctx={ctx} onValue={(id, v) => patch(tpl.id, { values: Object.fromEntries(Object.entries({ ...tpl.values, [id]: v }).filter(([, x]) => x !== null && x !== '')) })} />
                        ))}
                      </div>
                      <label className="check-row">
                        <input type="checkbox" checked={!!tpl.isDefault} onChange={(e) => setList((l) => l.map((x) => ({ ...x, isDefault: x.id === tpl.id ? e.target.checked : e.target.checked ? false : x.isDefault })))} />
                        <span>New rows start from this one</span>
                      </label>
                      <label className="check-row">
                        <input type="checkbox" checked={!!tpl.repeat} onChange={(e) => patch(tpl.id, { repeat: e.target.checked ? { every: 'week', days: [1], hour: 9, tz: deviceTz(), from: localDay() } : undefined })} />
                        <span>Add a row from it by itself, on a schedule</span>
                      </label>
                      <SmoothHeight>
                        {tpl.repeat && (
                          <div className="tb-repeat">
                            <div className="segmented sm">
                              {(['day', 'week', 'month', 'year'] as const).map((k) => (
                                <button key={k} type="button" className={tpl.repeat!.every === k ? 'on' : ''} onClick={() => patch(tpl.id, { repeat: { ...tpl.repeat!, every: k, days: k === 'week' ? (tpl.repeat!.days?.length ? tpl.repeat!.days : [1]) : k === 'day' ? tpl.repeat!.days : undefined } })}>
                                  {k === 'day' ? 'Daily' : k === 'week' ? 'Weekly' : k === 'month' ? 'Monthly' : 'Yearly'}
                                </button>
                              ))}
                            </div>
                            {(tpl.repeat.every === 'day' || tpl.repeat.every === 'week') && (
                              <div className="tb-days" role="group" aria-label="On these days">
                                {DAYS.map((d, i) => {
                                  const on = tpl.repeat!.days?.includes(i) ?? tpl.repeat!.every === 'day';
                                  return (
                                    <button
                                      key={d}
                                      type="button"
                                      aria-pressed={on}
                                      className={on ? 'on' : ''}
                                      onClick={() => {
                                        const cur = tpl.repeat!.days ?? (tpl.repeat!.every === 'day' ? [0, 1, 2, 3, 4, 5, 6] : []);
                                        const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
                                        if (next.length) patch(tpl.id, { repeat: { ...tpl.repeat!, days: next } });
                                      }}
                                    >
                                      {d}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className="tb-repeat-row">
                              <span className="muted small">At</span>
                              <PickSelect value={String(tpl.repeat.hour)} aria-label="Hour" onChange={(e) => patch(tpl.id, { repeat: { ...tpl.repeat!, hour: Number(e.target.value) } })}>
                                {Array.from({ length: 24 }, (_, h) => (
                                  <option key={h} value={String(h)}>
                                    {`${String(h).padStart(2, '0')}:00`}
                                  </option>
                                ))}
                              </PickSelect>
                              <span className="muted small">{tpl.repeat.every === 'month' || tpl.repeat.every === 'year' ? 'from' : 'starting'}</span>
                              <DatePicker value={tpl.repeat.from} onChange={(d) => d && patch(tpl.id, { repeat: { ...tpl.repeat!, from: d } })} label="Starting" clearable={false} className="sel-flat" />
                            </div>
                            <p className="muted small">
                              {repeatWords(tpl.repeat)}, {tpl.repeat.tz.replace(/_/g, ' ')} time. Rows it adds count as added by the table’s maker, and rules run on them.
                            </p>
                          </div>
                        )}
                      </SmoothHeight>
                      <div className="tb-tpl-actions">
                        <button type="button" className="link-btn small" onClick={() => add(tpl)}>
                          <Copy size={13} /> Duplicate
                        </button>
                        <button type="button" className="link-btn small danger" onClick={() => setList((l) => l.filter((x) => x.id !== tpl.id))}>
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
          <button type="button" className="ghost-btn sm tb-tpl-add" onClick={() => add()}>
            <Plus size={14} /> New template
          </button>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => (onSave(list.map((x) => ({ ...x, name: x.name.trim() || 'Untitled' }))), onClose())}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
