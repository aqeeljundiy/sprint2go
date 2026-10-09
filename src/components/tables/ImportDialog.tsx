import { PickSelect } from '../ui/PickSelect';
import { useMemo, useRef, useState } from 'react';
import { FileUp, Upload, X } from 'lucide-react';
import type { CellValue, DataTable, FieldType, TableField, TableRow, User } from '../../types';
import { uid } from '../../utils';
import { SmoothHeight, TabPane } from '../ui/Smooth';
import { FIELD_TYPES, guessField, isEmpty, optionsFromValues, parseIncoming } from './fields';
import { guessType, parseCsv } from './csv';
import { t, tn } from '../../i18n';
import { fmtNumber } from '../../i18n/format';
import { useLang } from '../../i18n/useLang';

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
  const lang = useLang(); // a new column without a header is named "Column 3" in the reader's words

  const load = async (file: File) => {
    setError('');
    if (file.size > 15_000_000) return setError(t('That file is over 15 MB. Split it into smaller files.'));
    const text = await file.text();
    const g = parseCsv(text);
    if (g.length < 2) return setError(t('That file has no rows under its header. Save the sheet as CSV and try again.'));
    if (g.length > 20_001) return setError(t('That file has {n} rows; at most {max} at a time.', { n: fmtNumber(g.length - 1), max: fmtNumber(20_000) }));
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
    const colField: (string | null)[] = targets.map((tg, i) => {
      if (tg.kind === 'skip') return null;
      if (tg.kind === 'field') return tg.fieldId;
      const f: TableField = { id: uid(), name: head[i] || t('Column {n}', { n: i + 1 }), type: tg.type, ...(tg.type === 'money' ? { currency: 'IDR' as const } : {}) };
      const tmp: TableField = { id: 'tmp', name: f.name, type: 'text' };
      if (tg.type === 'select' || tg.type === 'multi')
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
  }, [grid, targets, dedupe, runRules, rows, table.fields, users, body, head, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await onImport(plan);
    } finally {
      setBusy(false);
    }
  };
  const setTarget = (i: number, v: string) => setTargets((ts) => ts.map((tg, j) => (j !== i ? tg : v === 'skip' ? { kind: 'skip' } : v.startsWith('new:') ? { kind: 'new', type: v.slice(4) as FieldType } : { kind: 'field', fieldId: v })));
  const taken = (i: number) => new Set(targets.flatMap((tg, j) => (j !== i && tg.kind === 'field' ? [tg.fieldId] : [])));

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal tb-import" role="dialog" aria-label={t('Import CSV')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <span className="dump-title">
            <FileUp size={15} /> {t('Import into {table}', { table: table.name })}
          </span>
          <button className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
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
                    <strong>{t('Drop a CSV file here, or choose one')}</strong>
                    <small>{t('From Excel or Google Sheets: File, Download (or Save as), CSV. The first row should be the column names.')}</small>
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
                  {error && <p className="err">{error}</p>}
                </>
              ) : (
                <>
                  <p className="muted small">{tn(body.length, '{file}: {n} row. Each column goes into a field; matching names are already set.', '{file}: {n} rows. Each column goes into a field; matching names are already set.', { file: name })}</p>
                  <div className="tb-imap">
                    {head.map((h, i) => {
                      const tg = targets[i];
                      const value = tg.kind === 'skip' ? 'skip' : tg.kind === 'new' ? `new:${tg.type}` : tg.fieldId;
                      const samples = body.slice(0, 3).map((r) => r[i]).filter(Boolean);
                      return (
                        <div key={i} className={`tb-imap-row${tg.kind === 'skip' ? ' skip' : ''}`}>
                          <span className="tb-imap-col">
                            <strong>{h || t('Column {n}', { n: i + 1 })}</strong>
                            <small className="muted">{samples.join(' · ').slice(0, 70) || t('empty')}</small>
                          </span>
                          <PickSelect value={value} aria-label={t('Where {column} goes', { column: h || t('Column {n}', { n: i + 1 }) })} onChange={(e) => setTarget(i, e.target.value)}>
                            <optgroup label={t('Into a field')}>
                              {usable.filter((f) => !taken(i).has(f.id)).map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label={t('New field “{name}” as', { name: h || t('Column {n}', { n: i + 1 }) })}>
                              {FIELD_TYPES.filter((x) => x.type !== 'button' && x.type !== 'link').map((x) => (
                                <option key={x.type} value={`new:${x.type}`}>
                                  {t('New: {type}', { type: x.label })}
                                </option>
                              ))}
                            </optgroup>
                            <option value="skip">{t('Skip this column')}</option>
                          </PickSelect>
                        </div>
                      );
                    })}
                  </div>
                  <div className="tb-act-row">
                    <span className="tb-act-label">{t('Duplicates')}</span>
                    <PickSelect value={dedupe} aria-label={t('Duplicates')} onChange={(e) => setDedupe(e.target.value)}>
                      <option value="">{t('Always add new rows')}</option>
                      {usable.filter((f) => ['text', 'email', 'phone', 'url', 'number'].includes(f.type) && targets.some((tg) => tg.kind === 'field' && tg.fieldId === f.id)).map((f) => (
                        <option key={f.id} value={f.id}>
                          {t('Same {field} updates the row already here', { field: f.name.toLowerCase() })}
                        </option>
                      ))}
                    </PickSelect>
                  </div>
                  {(table.rules ?? []).some((r) => r.enabled && r.on === 'created') && (
                    <label className="check-row">
                      <input type="checkbox" checked={runRules} onChange={(e) => setRunRules(e.target.checked)} /> {t('Run “when a row is added” rules for these rows too')}
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
              {t('Another file')}
            </button>
          )}
          <span className="spacer" />
          {plan && (
            <span className="muted small tb-imp-sum">
              {plan.updates.length ? t('{created} new, {updated} updated', { created: fmtNumber(plan.creates.length), updated: fmtNumber(plan.updates.length) }) : t('{n} new', { n: fmtNumber(plan.creates.length) })}
            </span>
          )}
          <button className="ghost-btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary-btn" disabled={!plan || busy || (!plan.creates.length && !plan.updates.length)} onClick={go}>
            {busy ? t('Importing…') : plan ? tn(plan.creates.length + plan.updates.length, 'Import {n} row', 'Import {n} rows') : t('Import')}
          </button>
        </footer>
      </div>
    </div>
  );
}
