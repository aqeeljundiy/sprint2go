import { useState } from 'react';
import { ArrowDown, ArrowUp, LayoutTemplate, Pin, Plus, Trash2, X } from 'lucide-react';
import type { DataTable, TablePage } from '../../types';
import { uid } from '../../utils';
import { PickSelect } from '../ui/PickSelect';
import { fieldIcon } from './fields';
import { autoPins } from './RecordDrawer';

/**
 * How every row's page is laid out: up to five key fields pinned under the name, named sections of fields after the
 * rest, and a main button (pinned to the bottom on phones). Edits stay here until Save.
 */
export function PageLayoutDialog({ t, onSave, onClose }: { t: DataTable; onSave: (p: TablePage) => void; onClose: () => void }) {
  const [page, setPage] = useState<TablePage>(() => structuredClone(t.page ?? {}));
  const rest = t.fields.slice(1);
  const pinned = (page.pinned ?? []).filter((id) => rest.some((f) => f.id === id));
  const sections = page.sections ?? [];
  const inSection = new Set(sections.flatMap((s) => s.fields));
  const name = (id: string) => t.fields.find((f) => f.id === id)?.name ?? '';
  const setSections = (s: NonNullable<TablePage['sections']>) => setPage((p) => ({ ...p, sections: s }));
  const movePin = (id: string, d: -1 | 1) => {
    const list = [...pinned];
    const i = list.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPage((p) => ({ ...p, pinned: list }));
  };
  const buttons = t.fields.filter((f) => f.type === 'button');
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-layout-modal" role="dialog" aria-label="Row page layout" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.pop') && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <LayoutTemplate size={15} /> Row page layout · {t.name}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <section className="tb-lay-sec">
            <h4 className="tb-set-h">Pinned under the name</h4>
            <p className="muted small">
              Up to five fields people look at first, like Status, Owner and Value. On phones they show as chips you can tap.
              {!page.pinned && ` Until you pick some, phones pin ${autoPins(t).map((id) => t.fields.find((f) => f.id === id)?.name).filter(Boolean).join(', ') || 'none'}.`}
            </p>
            <div className="tab-edit-list">
              {pinned.map((id, i) => {
                const f = t.fields.find((x) => x.id === id)!;
                const I = fieldIcon(f.type);
                return (
                  <div key={id} className="tab-edit-row">
                    <Pin size={14} className="muted" />
                    <I size={14} className="muted" />
                    <span className="tab-edit-name">{f.name}</span>
                    <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => movePin(id, -1)} aria-label={`Move ${f.name} up`}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className="icon-btn sm" disabled={i === pinned.length - 1} onClick={() => movePin(id, 1)} aria-label={`Move ${f.name} down`}>
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" className="icon-btn sm" onClick={() => setPage((p) => ({ ...p, pinned: pinned.filter((x) => x !== id) }))} aria-label={`Unpin ${f.name}`}>
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            {pinned.length < 5 && (
              <PickSelect value="" aria-label="Pin a field" onChange={(e) => e.target.value && setPage((p) => ({ ...p, pinned: [...pinned, e.target.value] }))}>
                <option value="">Pin a field…</option>
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
            <h4 className="tb-set-h">Main button</h4>
            <p className="muted small">The one thing people do with a row, like Approve or Move to Won. Phones keep it at the bottom of the page, in reach of a thumb.</p>
            {buttons.length ? (
              <PickSelect value={page.main ?? ''} aria-label="Main button" onChange={(e) => setPage((p) => ({ ...p, main: e.target.value || undefined }))}>
                <option value="">The first button that applies</option>
                {buttons.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.button?.label || f.name}
                  </option>
                ))}
              </PickSelect>
            ) : (
              <p className="muted small">This table has no Button field yet. Add one from a column’s menu.</p>
            )}
          </section>

          <section className="tb-lay-sec">
            <h4 className="tb-set-h">Sections</h4>
            <p className="muted small">Named groups of fields, after the rest: Contact, Deal, Billing.</p>
            {sections.map((s, si) => (
              <div key={s.id} className="tb-sec-edit">
                <div className="tb-sec-head">
                  <input value={s.name} aria-label="Section name" onChange={(e) => setSections(sections.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                  <button type="button" className="icon-btn sm" disabled={si === 0} aria-label="Move section up" onClick={() => setSections(sections.map((x, j) => (j === si - 1 ? s : j === si ? sections[si - 1] : x)))}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="icon-btn sm" aria-label={`Delete the ${s.name} section`} onClick={() => setSections(sections.filter((x) => x.id !== s.id))}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="tb-sec-fields">
                  {s.fields.map((id) => (
                    <span key={id} className="tb-chip linked">
                      {name(id)}
                      <button type="button" aria-label={`Take ${name(id)} out`} onClick={() => setSections(sections.map((x) => (x.id === s.id ? { ...x, fields: x.fields.filter((y) => y !== id) } : x)))}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <PickSelect value="" aria-label="Add a field to this section" onChange={(e) => e.target.value && setSections(sections.map((x) => (x.id === s.id ? { ...x, fields: [...x.fields, e.target.value] } : x)))}>
                    <option value="">Add a field…</option>
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
            <button type="button" className="link-btn small" onClick={() => setSections([...sections, { id: uid(), name: sections.length ? `Section ${sections.length + 1}` : 'Details', fields: [] }])}>
              <Plus size={13} /> Add a section
            </button>
          </section>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" onClick={() => (onSave({ ...page, pinned: page.pinned || pinned.length ? pinned : undefined, sections: sections.map((s) => ({ ...s, name: s.name.trim() || 'Section' })) }), onClose())}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
