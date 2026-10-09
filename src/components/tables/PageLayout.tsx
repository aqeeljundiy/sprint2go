import { useState } from 'react';
import { ArrowDown, ArrowUp, LayoutTemplate, Pin, Plus, Trash2, X } from 'lucide-react';
import type { DataTable, TablePage } from '../../types';
import { uid } from '../../utils';
import { PickSelect } from '../ui/PickSelect';
import { fieldIcon } from './fields';
import { autoPins } from './RecordDrawer';
import { t } from '../../i18n';
import { fmtList } from '../../i18n/format';

/**
 * How every row's page is laid out: up to five key fields pinned under the name, named sections of fields after the
 * rest, and a main button (pinned to the bottom on phones). Edits stay here until Save.
 */
export function PageLayoutDialog({ t: tb, onSave, onClose }: { t: DataTable; onSave: (p: TablePage) => void; onClose: () => void }) {
  const [page, setPage] = useState<TablePage>(() => structuredClone(tb.page ?? {}));
  const rest = tb.fields.slice(1);
  const pinned = (page.pinned ?? []).filter((id) => rest.some((f) => f.id === id));
  const sections = page.sections ?? [];
  const inSection = new Set(sections.flatMap((s) => s.fields));
  const name = (id: string) => tb.fields.find((f) => f.id === id)?.name ?? '';
  const setSections = (s: NonNullable<TablePage['sections']>) => setPage((p) => ({ ...p, sections: s }));
  const movePin = (id: string, d: -1 | 1) => {
    const list = [...pinned];
    const i = list.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPage((p) => ({ ...p, pinned: list }));
  };
  const buttons = tb.fields.filter((f) => f.type === 'button');
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-layout-modal" role="dialog" aria-label={t('Row page layout')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <LayoutTemplate size={15} /> {t('Row page layout · {table}', { table: tb.name })}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <section className="tb-lay-sec">
            <h4 className="tb-set-h">{t('Pinned under the name')}</h4>
            <p className="muted small">
              {t('Up to five fields people look at first, like Status, Owner and Value. On phones they show as chips you can tap.')}
              {!page.pinned && ` ${t('Until you pick some, phones pin {fields}.', { fields: fmtList(autoPins(tb).map((id) => tb.fields.find((f) => f.id === id)?.name ?? '').filter(Boolean)) || t('none') })}`}
            </p>
            <div className="tab-edit-list">
              {pinned.map((id, i) => {
                const f = tb.fields.find((x) => x.id === id)!;
                const I = fieldIcon(f.type);
                return (
                  <div key={id} className="tab-edit-row">
                    <Pin size={14} className="muted" />
                    <I size={14} className="muted" />
                    <span className="tab-edit-name">{f.name}</span>
                    <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => movePin(id, -1)} aria-label={t('Move {name} up', { name: f.name })}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className="icon-btn sm" disabled={i === pinned.length - 1} onClick={() => movePin(id, 1)} aria-label={t('Move {name} down', { name: f.name })}>
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" className="icon-btn sm" onClick={() => setPage((p) => ({ ...p, pinned: pinned.filter((x) => x !== id) }))} aria-label={t('Unpin {name}', { name: f.name })}>
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            {pinned.length < 5 && (
              <PickSelect value="" aria-label={t('Pin a field')} onChange={(e) => e.target.value && setPage((p) => ({ ...p, pinned: [...pinned, e.target.value] }))}>
                <option value="">{t('Pin a field…')}</option>
                {rest
                  .filter((f) => !pinned.includes(f.id) && f.type !== 'button' && f.type !== 'longtext')
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </PickSelect>
            )}
          </section>

          <section className="tb-lay-sec">
            <h4 className="tb-set-h">{t('Main button')}</h4>
            <p className="muted small">{t('The one thing people do with a row, like Approve or Move to Won. Phones keep it at the bottom of the page, in reach of a thumb.')}</p>
            {buttons.length ? (
              <PickSelect value={page.main ?? ''} aria-label={t('Main button')} onChange={(e) => setPage((p) => ({ ...p, main: e.target.value || undefined }))}>
                <option value="">{t('The first button that applies')}</option>
                {buttons.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.button?.label || f.name}
                  </option>
                ))}
              </PickSelect>
            ) : (
              <p className="muted small">{t('This table has no Button field yet. Add one from a column’s menu.')}</p>
            )}
          </section>

          <section className="tb-lay-sec">
            <h4 className="tb-set-h">{t('Sections')}</h4>
            <p className="muted small">{t('Named groups of fields, after the rest: Contact, Deal, Billing.')}</p>
            {sections.map((s, si) => (
              <div key={s.id} className="tb-sec-edit">
                <div className="tb-sec-head">
                  <input value={s.name} aria-label={t('Section name')} onChange={(e) => setSections(sections.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                  <button type="button" className="icon-btn sm" disabled={si === 0} aria-label={t('Move section up')} onClick={() => setSections(sections.map((x, j) => (j === si - 1 ? s : j === si ? sections[si - 1] : x)))}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="icon-btn sm" aria-label={t('Delete the {name} section', { name: s.name })} onClick={() => setSections(sections.filter((x) => x.id !== s.id))}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="tb-sec-fields">
                  {s.fields.map((id) => (
                    <span key={id} className="tb-chip linked">
                      {name(id)}
                      <button type="button" aria-label={t('Take {name} out', { name: name(id) })} onClick={() => setSections(sections.map((x) => (x.id === s.id ? { ...x, fields: x.fields.filter((y) => y !== id) } : x)))}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <PickSelect value="" aria-label={t('Add a field to this section')} onChange={(e) => e.target.value && setSections(sections.map((x) => (x.id === s.id ? { ...x, fields: [...x.fields, e.target.value] } : x)))}>
                    <option value="">{t('Add a field…')}</option>
                    {rest
                      .filter((f) => !inSection.has(f.id))
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </PickSelect>
                </div>
              </div>
            ))}
            <button type="button" className="link-btn small" onClick={() => setSections([...sections, { id: uid(), name: sections.length ? t('Section {n}', { n: sections.length + 1 }) : t('Details'), fields: [] }])}>
              <Plus size={13} /> {t('Add a section')}
            </button>
          </section>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" onClick={() => (onSave({ ...page, pinned: page.pinned || pinned.length ? pinned : undefined, sections: sections.map((s) => ({ ...s, name: s.name.trim() || t('Section') })) }), onClose())}>
            {t('Save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
