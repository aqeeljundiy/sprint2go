import { useContext, useEffect, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ, ChevronRight, EyeOff, Plus, Trash2, X } from 'lucide-react';
import type { Channel, DataTable, FieldType, TableField, TableRow, User } from '../../types';
import { PickSelect } from '../ui/PickSelect';
import { actionSummary } from './Automations';
import { ButtonSetupCtx } from './ButtonDialog';
import { Popover } from '../ui/Popover';
import { FIELD_TYPES, OPTION_COLORS, cellText, fieldIcon, formulaError, rowName, valueOf, type TCtx } from './fields';
import { newOption } from './Cell';
import { uid } from '../../utils';
import { t, tx } from '../../i18n';
import { tj } from '../../i18n/tj';

/** A field put in a formula: {Name}. */
const ref = (name: string) => `{${name}}`;

/**
 * A column's settings in one popover: its name, its kind, its choices (or currency, or linked table).
 * Opened on a column header, or from "+" to add a column.
 */
export function FieldMenu({
  anchor,
  open,
  onClose,
  field,
  table,
  tables,
  isFirst,
  onSave,
  onDelete,
  onSort,
  onHide,
  hideLabel = t('Hide in this view'),
  users = [],
  channels = [],
  rows,
  previewCtx,
}: {
  rows?: TableRow[]; // for the formula preview
  previewCtx?: TCtx;
  users?: User[];
  channels?: Channel[];
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  field: TableField | null; // null: a new column
  table: DataTable;
  tables: DataTable[];
  isFirst?: boolean;
  onSave: (f: TableField) => void;
  onDelete?: () => void;
  onSort?: (dir: 'asc' | 'desc') => void;
  onHide?: () => void;
  hideLabel?: string;
}) {
  const blank = (): TableField => ({ id: uid(), name: '', type: 'text' });
  const [draft, setDraft] = useState<TableField>(field ?? blank());
  const [typesOpen, setTypesOpen] = useState(!field);
  useEffect(() => {
    if (open) {
      setDraft(field ? structuredClone(field) : blank());
      setTypesOpen(!field);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<TableField>) => setDraft((d) => ({ ...d, ...p }));
  const setupButton = useContext(ButtonSetupCtx);
  const pickType = (type: FieldType) => {
    const next: Partial<TableField> = { type };
    if ((type === 'select' || type === 'multi') && !draft.options?.length) next.options = [];
    if (type === 'money' && !draft.currency) next.currency = 'IDR';
    if (type === 'button' && !draft.button) next.button = { label: draft.name.trim() || t('Run'), actions: [] };
    if (type === 'link' && !draft.linkTable) next.linkTable = tables.find((tb) => tb.id !== table.id && tb.workspaceId === table.workspaceId)?.id;
    // Until someone names it, a column is called after its kind (or, for a link, the table it links to).
    const auto = !draft.name.trim() || FIELD_TYPES.some((f) => f.label === draft.name) || tables.some((tb) => tb.name === draft.name);
    if (auto) next.name = type === 'link' ? tables.find((tb) => tb.id === next.linkTable)?.name ?? t('Linked rows') : FIELD_TYPES.find((f) => f.type === type)!.label;
    set(next);
    setTypesOpen(false);
  };
  const save = () => {
    const name = draft.name.trim() || FIELD_TYPES.find((f) => f.type === draft.type)!.label;
    const options = draft.options?.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() }));
    onSave({ ...draft, name, ...(options ? { options } : {}) });
    onClose();
  };
  const Icon = fieldIcon(draft.type);
  const others = tables.filter((tb) => tb.id !== table.id && tb.workspaceId === table.workspaceId);
  const changingType = !!field && field.type !== draft.type;

  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={draft.type === 'formula' ? 400 : 300} title={field ? field.name : t('New field')}>
      <div className="tb-fm" onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && !(e.target as HTMLElement).closest('.tb-fm-opts, .tb-btn-set') && save()}>
        <input className="tb-fm-name" autoFocus value={draft.name} placeholder={t('Field name')} onChange={(e) => set({ name: e.target.value })} />

        <button type="button" className="tb-fm-type" onClick={() => setTypesOpen((x) => !x)} disabled={isFirst && draft.type === 'text' && !!field} title={isFirst ? t('The first field is each row’s name') : undefined}>
          <Icon size={14} />
          <span>{FIELD_TYPES.find((f) => f.type === draft.type)!.label}</span>
          <ChevronRight size={14} className={`rot-chev ${typesOpen ? 'open' : ''}`} />
        </button>
        <div className={`fold ${typesOpen ? 'open' : ''}`}>
          <div className="fold-in">
            <div className="tb-fm-types">
              {FIELD_TYPES.filter((tb) => !isFirst || ['text', 'number', 'email', 'phone', 'url'].includes(tb.type)).map(({ type, label, icon: I, hint }) => (
                <button key={type} type="button" className={draft.type === type ? 'on' : ''} onClick={() => pickType(type)} title={hint}>
                  <I size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {changingType && <p className="muted small tb-hint">{t('Existing values are converted where they fit; the rest are cleared.')}</p>}

        {(draft.type === 'select' || draft.type === 'multi') && (
          <div className="tb-fm-opts">
            <span className="tb-fm-label">{t('Choices')}</span>
            {(draft.options ?? []).map((o, i) => (
              <div key={o.id} className="tb-fm-opt">
                <button type="button" className="tb-dot big" style={{ background: o.color }} title={t('Change colour')} onClick={() => set({ options: draft.options!.map((x) => (x.id === o.id ? { ...x, color: OPTION_COLORS[(OPTION_COLORS.indexOf(x.color) + 1) % OPTION_COLORS.length] } : x)) })} />
                <input
                  value={o.label}
                  autoFocus={!o.label && i === draft.options!.length - 1 && i > 0}
                  placeholder={t('Choice {n}', { n: i + 1 })}
                  onChange={(e) => set({ options: draft.options!.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })}
                  onKeyDown={(e) => e.key === 'Enter' && set({ options: [...draft.options!, newOption(draft, '')] })}
                />
                <button type="button" className="icon-btn sm" title={t('Remove choice')} onClick={() => set({ options: draft.options!.filter((x) => x.id !== o.id) })}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="link-btn small" onClick={() => set({ options: [...(draft.options ?? []), newOption(draft, '')] })}>
              <Plus size={13} /> {t('Add a choice')}
            </button>
          </div>
        )}

        {draft.type === 'button' && (
          <div className="tb-btn-sum">
            <span className="tb-fm-label">{t('When pressed')}</span>
            <p className="small">{draft.button?.actions.length ? draft.button.actions.map((a) => actionSummary(a, table, tables, users, channels)).join(', ') : t('Nothing yet. Pick what it does: send a webhook, set fields, make a task and more.')}</p>
            {setupButton && (
              <button
                type="button"
                className={draft.button?.actions.length ? 'ghost-btn sm' : 'primary-btn sm'}
                onClick={() => {
                  save();
                  setupButton(draft.id);
                }}
              >
                {draft.button?.actions.length ? t('Change what it does') : t('Set up what it does')}
              </button>
            )}
          </div>
        )}

        {draft.type === 'formula' && (
          <div className="tb-fm-opts">
            <span className="tb-fm-label">{t('Formula')}</span>
            <textarea
              className="tb-native tall tb-formula"
              rows={3}
              value={draft.formula ?? ''}
              placeholder={`${ref(tx('field', 'Value'))} * 0.1   ${t('or')}   ${ref(table.fields[0]?.name ?? t('Name'))} & " · " & ${ref(t('City'))}`}
              onChange={(e) => set({ formula: e.target.value })}
              spellCheck={false}
            />
            <div className="tb-formula-fields">
              {table.fields.filter((f) => f.id !== draft.id && f.type !== 'button').map((f) => (
                <button key={f.id} type="button" className="tb-chip linked" onClick={() => set({ formula: `${draft.formula ?? ''}{${f.name}}` })}>
                  {f.name}
                </button>
              ))}
            </div>
            {(() => {
              const src = draft.formula?.trim();
              if (!src) return <p className="muted small">{t('Use + − × ÷, & to join text, and if(), round(), days(), today(), concat()… Click a field to put it in.')}</p>;
              const err = formulaError(src, table);
              if (err) return <p className="err small">{err}</p>;
              const row = rows?.find((r) => r.tableId === table.id);
              if (!row || !previewCtx) return <p className="muted small">{t('Looks right.')}</p>;
              const v = valueOf({ ...table, fields: [...table.fields.filter((f) => f.id !== draft.id), draft] }, draft, row, previewCtx);
              return (
                <p className="muted small">
                  {tj('For “{row}”: {value}', { row: rowName(table, row), value: <strong>{v === null ? tx('value', 'empty') : cellText(draft, v, previewCtx)}</strong> })}
                </p>
              );
            })()}
          </div>
        )}

        {draft.type === 'rollup' && (
          <div className="tb-fm-opts">
            {table.fields.some((f) => f.type === 'link') ? (
              <>
                <span className="tb-fm-label">{t('From the rows in')}</span>
                <PickSelect value={draft.rollup?.linkField ?? ''} aria-label={t('Link field')} onChange={(e) => set({ rollup: { fn: draft.rollup?.fn ?? 'count', linkField: e.target.value } })}>
                  <option value="">{t('Pick a link field')}</option>
                  {table.fields.filter((f) => f.type === 'link').map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </PickSelect>
                {(() => {
                  const link = table.fields.find((f) => f.id === draft.rollup?.linkField);
                  const target = tables.find((tb) => tb.id === link?.linkTable);
                  if (!link || !target) return null;
                  return (
                    <>
                      <span className="tb-fm-label">{t('Show')}</span>
                      <PickSelect value={draft.rollup?.fn ?? 'count'} aria-label={t('What to show')} onChange={(e) => set({ rollup: { ...draft.rollup!, fn: e.target.value as NonNullable<TableField['rollup']>['fn'] } })}>
                        <option value="count">{t('How many there are')}</option>
                        <option value="filled">{t('How many have a value in…')}</option>
                        <option value="sum">{t('The total of…')}</option>
                        <option value="avg">{t('The average of…')}</option>
                        <option value="min">{t('The smallest…')}</option>
                        <option value="max">{t('The largest…')}</option>
                        <option value="list">{t('A list of…')}</option>
                      </PickSelect>
                      {draft.rollup?.fn && draft.rollup.fn !== 'count' && (
                        <PickSelect value={draft.rollup.targetField ?? ''} aria-label={t('Of which field')} onChange={(e) => set({ rollup: { ...draft.rollup!, targetField: e.target.value } })}>
                          <option value="">{t('Pick a field in {table}', { table: target.name })}</option>
                          {target.fields.filter((f) => f.type !== 'button' && (['sum', 'avg', 'min', 'max'].includes(draft.rollup!.fn) ? ['number', 'money', 'rating', 'formula', 'rollup'].includes(f.type) : true)).map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </PickSelect>
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              <p className="muted small">{t('Add a “{type}” field first; a rollup counts or totals the rows it links to (like a client’s total deal value).', { type: t('Link to another table') })}</p>
            )}
          </div>
        )}

        {draft.type === 'rating' && (
          <div className="tb-fm-row">
            <span className="tb-fm-label">{t('Stars')}</span>
            <div className="segmented sm">
              {[3, 5, 10].map((n) => (
                <button key={n} type="button" className={(draft.max ?? 5) === n ? 'on' : ''} onClick={() => set({ max: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {(draft.type === 'created' || draft.type === 'edited' || draft.type === 'creator') && <p className="muted small">{t('Filled in by itself for every row; it can’t be typed over.')}</p>}
        {draft.type === 'files' && <p className="muted small">{t('Pictures and documents on each row (pictures are made smaller; other files up to 3 MB). For big files, put them in Drive and paste the link.')}</p>}

        {draft.type === 'money' && (
          <div className="tb-fm-row">
            <span className="tb-fm-label">{t('Currency')}</span>
            <div className="segmented sm">
              {(['IDR', 'USD', 'SGD', 'EUR'] as const).map((c) => (
                <button key={c} type="button" className={draft.currency === c ? 'on' : ''} onClick={() => set({ currency: c })}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {draft.type === 'link' && (
          <div className="tb-fm-opts">
            <span className="tb-fm-label">{t('Rows from')}</span>
            {others.length ? (
              <div className="tb-fm-types">
                {others.map((tb) => (
                  <button key={tb.id} type="button" className={draft.linkTable === tb.id ? 'on' : ''} onClick={() => set({ linkTable: tb.id, ...(!draft.name.trim() || tables.some((x) => x.name === draft.name) || draft.name === t('Linked rows') ? { name: tb.name } : {}) })}>
                    <i className="tb-dot" style={{ background: tb.color }} />
                    {tb.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small">{t('Make another table first; then rows here can link to rows there.')}</p>
            )}
          </div>
        )}

        {field && (onSort || onHide || onDelete) && (
          <div className="tb-fm-acts">
            {onSort && (
              <>
                <button type="button" onClick={() => (onSort('asc'), onClose())}>
                  <ArrowDownAZ size={14} /> {t('Sort first to last')}
                </button>
                <button type="button" onClick={() => (onSort('desc'), onClose())}>
                  <ArrowUpAZ size={14} /> {t('Sort last to first')}
                </button>
              </>
            )}
            {onHide && !isFirst && (
              <button type="button" onClick={() => (onHide(), onClose())}>
                <EyeOff size={14} /> {hideLabel}
              </button>
            )}
            {onDelete && !isFirst && (
              <button type="button" className="danger" onClick={() => confirm(t('Delete the “{name}” field and everything in it?', { name: field.name })) && (onDelete(), onClose())}>
                <Trash2 size={14} /> {t('Delete field')}
              </button>
            )}
          </div>
        )}

        <div className="tb-fm-foot">
          <button type="button" className="ghost-btn sm" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="primary-btn sm" disabled={(draft.type === 'link' && !draft.linkTable) || (draft.type === 'formula' && (!draft.formula?.trim() || !!formulaError(draft.formula, table))) || (draft.type === 'rollup' && !draft.rollup?.linkField)} onClick={save}>
            {field ? t('Save') : t('Add field')}
          </button>
        </div>
      </div>
    </Popover>
  );
}
