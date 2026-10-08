import { PickSelect } from '../ui/PickSelect';
import { useMemo, useRef, useState } from 'react';
import { FileUp, Upload, X } from 'lucide-react';
import type { CellValue, DataTable, FieldType, TableField, TableRow, User } from '../../types';
import { uid } from '../../utils';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { FIELD_TYPES, guessField, isEmpty, optionsFromValues, parseIncoming } from './fields';
import { guessType, parseCsv } from './csv';

type Target = { kind: 'field'; fieldId: string } | { kind: 'new'; type: FieldType } | { kind: 'skip' };
export interface ImportPlan {
  fields: TableField[]; // the table's fields after the import (new ones added, new choices added)
  creates: Record<string, CellValue>[];
  updates: { id: string; values: Record<string, CellValue> }[];
  runRules: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * CSV into a table: pick the file, match each column to a field (by name to start with) or make it a new
 * field, choose what duplicates do, then import. Everything converts the way incoming webhooks do.
 */
export function ImportDialog({ table, rows, users, onImport, onClose }: { table: DataTable; rows: TableRow[]; users: User[]; onImport: (plan: ImportPlan) => Promise<void> | void; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [dedupe, setDedupe] = useState('');
  const [runRules, setRunRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const usable = table.fields.filter((f) => f.type !== 'button' && f.type !== 'link');

  const load = async (file: File) => {
    setError('');
    if (file.size > 15_000_000) return setError('That file is over 15 MB. Split it into smaller files.');
    const text = await file.text();
    const g = parseCsv(text);
    if (g.length < 2) return setError('That file has no rows under its header. Save the sheet as CSV and try again.');
    if (g.length > 20_001) return setError(`That file has ${g.length - 1} rows; at most 20,000 at a time.`);
    setName(file.name);
    setGrid(g);
    const head = g[0];
    const used = new Set<string>();
    setTargets(
      head.map((h, i) => {
        const fid = guessField(h, usable, used);
        if (fid) {
          used.add(fid);
          return { kind: 'field', fieldId: fid };
        }
        return h.trim() ? { kind: 'new', type: guessType(h, g.slice(1).map((r) => r[i] ?? '')) } : { kind: 'skip' };
      }),
    );
    const email = usable.find((f) => f.type === 'email');
    setDedupe(email && head.some((h) => norm(h) === norm(email.name)) ? email.id : '');
  };

  const head = grid?.[0] ?? [];
  const body = useMemo(() => grid?.slice(1) ?? [], [grid]);

  /** The import worked out: new fields, then each row's values; duplicates become updates. */
  const plan = useMemo((): ImportPlan | null => {
    if (!grid) return null;
    let fields = [...table.fields];
    const colField: (string | null)[] = targets.map((t, i) => {
      if (t.kind === 'skip') return null;
      if (t.kind === 'field') return t.fieldId;
      const f: TableField = { id: uid(), name: head[i] || `Column ${i + 1}`, type: t.type, ...(t.type === 'money' ? { currency: 'IDR' as const } : {}) };
      const tmp: TableField = { id: 'tmp', name: f.name, type: 'text' };
      if (t.type === 'select' || t.type === 'multi')
        f.options = optionsFromValues(tmp, body.map((r) => ({ id: '', workspaceId: '', tableId: '', order: 0, createdBy: '', createdAt: '', updatedAt: '', values: { tmp: r[i] ?? '' } })), { users, rowName: () => '' });
      fields.push(f);
      return f.id;
    });
    const existing = new Map<string, TableRow>();
    if (dedupe) for (const r of rows) if (!isEmpty(r.values[dedupe])) existing.set(String(r.values[dedupe]).toLowerCase(), r);
    const creates: Record<string, CellValue>[] = [];
    const updates = new Map<string, Record<string, CellValue>>();
    for (const line of body) {
      const values: Record<string, CellValue> = {};
      colField.forEach((fid, i) => {
        if (!fid) return;
        const f = fields.find((x) => x.id === fid)!;
        const { v, field } = parseIncoming(f, line[i] ?? '', users);
        if (field) fields = fields.map((x) => (x.id === field.id ? field : x));
        if (!isEmpty(v)) values[fid] = v;
      });
      if (!Object.keys(values).length) continue;
      const hit = dedupe && !isEmpty(values[dedupe]) ? existing.get(String(values[dedupe]).toLowerCase()) : undefined;
      if (hit) updates.set(hit.id, { ...(updates.get(hit.id) ?? {}), ...values });
      else creates.push(values);
    }
    return { fields, creates, updates: [...updates].map(([id, values]) => ({ id, values })), runRules };
  }, [grid, targets, dedupe, runRules, rows, table.fields, users, body, head]);

  const go = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await onImport(plan);
    } finally {
      setBusy(false);
    }
  };
  const setTarget = (i: number, v: string) => setTargets((ts) => ts.map((t, j) => (j !== i ? t : v === 'skip' ? { kind: 'skip' } : v.startsWith('new:') ? { kind: 'new', type: v.slice(4) as FieldType } : { kind: 'field', fieldId: v })));
  const taken = (i: number) => new Set(targets.flatMap((t, j) => (j !== i && t.kind === 'field' ? [t.fieldId] : [])));

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-import" role="dialog" aria-label="Import CSV" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <FileUp size={15} /> Import into {table.name}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <SmoothHeight>
            <TabPane key={grid ? 'map' : 'pick'}>
              {!grid ? (
                <>
                  <button
                    type="button"
                    className={`tb-drop${over ? ' over' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => (e.preventDefault(), setOver(true))}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOver(false);
                      const f = e.dataTransfer.files[0];
                      if (f) void load(f);
                    }}
                  >
                    <Upload size={22} />
                    <strong>Drop a CSV file here, or choose one</strong>
                    <small>From Excel or Google Sheets: File, Download (or Save as), CSV. The first row should be the column names.</small>
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
                  {error && <p className="err">{error}</p>}
                </>
              ) : (
                <>
                  <p className="muted small">
                    {name}: {body.length} row{body.length === 1 ? '' : 's'}. Each column goes into a field; matching names are already set.
                  </p>
                  <div className="tb-imap">
                    {head.map((h, i) => {
                      const t = targets[i];
                      const value = t.kind === 'skip' ? 'skip' : t.kind === 'new' ? `new:${t.type}` : t.fieldId;
                      const samples = body.slice(0, 3).map((r) => r[i]).filter(Boolean);
                      return (
                        <div key={i} className={`tb-imap-row${t.kind === 'skip' ? ' skip' : ''}`}>
                          <span className="tb-imap-col">
                            <strong>{h || `Column ${i + 1}`}</strong>
                            <small className="muted">{samples.join(' · ').slice(0, 70) || 'empty'}</small>
                          </span>
                          <PickSelect value={value} aria-label={`Where ${h} goes`} onChange={(e) => setTarget(i, e.target.value)}>
                            <optgroup label="Into a field">
                              {usable.filter((f) => !taken(i).has(f.id)).map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label={`New field “${h}” as`}>
                              {FIELD_TYPES.filter((x) => x.type !== 'button' && x.type !== 'link').map((x) => (
                                <option key={x.type} value={`new:${x.type}`}>
                                  New: {x.label}
                                </option>
                              ))}
                            </optgroup>
                            <option value="skip">Skip this column</option>
                          </PickSelect>
                        </div>
                      );
                    })}
                  </div>
                  <div className="tb-act-row">
                    <span className="tb-act-label">Duplicates</span>
                    <PickSelect value={dedupe} aria-label="Duplicates" onChange={(e) => setDedupe(e.target.value)}>
                      <option value="">Always add new rows</option>
                      {usable.filter((f) => ['text', 'email', 'phone', 'url', 'number'].includes(f.type) && targets.some((t) => t.kind === 'field' && t.fieldId === f.id)).map((f) => (
                        <option key={f.id} value={f.id}>
                          Same {f.name.toLowerCase()} updates the row already here
                        </option>
                      ))}
                    </PickSelect>
                  </div>
                  {(table.rules ?? []).some((r) => r.enabled && r.on === 'created') && (
                    <label className="check-row">
                      <input type="checkbox" checked={runRules} onChange={(e) => setRunRules(e.target.checked)} /> Run “when a row is added” rules for these rows too
                    </label>
                  )}
                </>
              )}
            </TabPane>
          </SmoothHeight>
        </div>
        <footer className="modal-foot">
          {grid && (
            <button className="ghost-btn" onClick={() => (setGrid(null), setName(''))}>
              Another file
            </button>
          )}
          <span className="spacer" />
          {plan && (
            <span className="muted small tb-imp-sum">
              {plan.creates.length} new{plan.updates.length ? `, ${plan.updates.length} updated` : ''}
            </span>
          )}
          <button className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!plan || busy || (!plan.creates.length && !plan.updates.length)} onClick={go}>
            {busy ? 'Importing…' : plan ? `Import ${plan.creates.length + plan.updates.length} row${plan.creates.length + plan.updates.length === 1 ? '' : 's'}` : 'Import'}
          </button>
        </footer>
      </div>
    </div>
  );
}
