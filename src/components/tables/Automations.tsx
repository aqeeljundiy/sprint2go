import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Copy, KeyRound, Plus, RefreshCw, Send, Trash2, X, Zap } from 'lucide-react';
import type { ButtonDef, Channel, DataTable, TableAction, TableField, TableIntake, TableRule, User } from '../../types';
import { relative, uid } from '../../utils';
import { TabPane } from '../ui/Smooth';
import { OPTION_COLORS, opsFor } from './fields';

/* ---------- small helpers ---------- */

const secret = (n = 24) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');

export const ACTION_KINDS: { kind: TableAction['kind']; label: string; hint: string; ruleOk: boolean }[] = [
  { kind: 'set', label: 'Set fields', hint: 'Status → Contacted, Follow-up → today', ruleOk: true },
  { kind: 'webhook', label: 'Send a webhook', hint: 'Post the row to another app', ruleOk: true },
  { kind: 'move', label: 'Move to another table', hint: 'Fields carry across by name', ruleOk: true },
  { kind: 'copy', label: 'Copy to another table', hint: 'This row stays here too', ruleOk: true },
  { kind: 'linked', label: 'Add a linked row', hint: 'A new row there, linked back here', ruleOk: true },
  { kind: 'task', label: 'Make a task', hint: 'Assigned, with a due date', ruleOk: true },
  { kind: 'notify', label: 'Notify someone', hint: 'A notification in Sprint2go', ruleOk: true },
  { kind: 'chat', label: 'Post in a channel', hint: 'A message in Chat', ruleOk: true },
  { kind: 'email', label: 'Write an email', hint: 'Opens a new email, filled in', ruleOk: false },
  { kind: 'open', label: 'Open a link', hint: 'Like https://wa.me/{Phone}', ruleOk: false },
];

function blankAction(kind: TableAction['kind'], t: DataTable, tables: DataTable[]): TableAction {
  const other = tables.find((x) => x.id !== t.id && x.workspaceId === t.workspaceId)?.id ?? '';
  const first = t.fields[0]?.name ?? 'Name';
  switch (kind) {
    case 'set':
      return { kind, values: {} };
    case 'copy':
    case 'move':
      return { kind, tableId: other };
    case 'linked':
      return { kind, tableId: other };
    case 'task':
      return { kind, title: `Follow up {${first}}`, assignee: t.fields.find((f) => f.type === 'person')?.id ?? '@me', dueDays: 1 };
    case 'email':
      return { kind, toField: t.fields.find((f) => f.type === 'email')?.id, subject: '', body: `Hi {${first}},\n\n` };
    case 'chat':
      return { kind, channelId: '', text: `{${first}}` };
    case 'notify':
      return { kind, who: t.fields.find((f) => f.type === 'person')?.id ?? '@me', text: `{${first}} needs you` };
    case 'webhook':
      return { kind, url: '' };
    case 'open':
      return { kind, url: t.fields.some((f) => f.type === 'phone') ? `https://wa.me/{${t.fields.find((f) => f.type === 'phone')!.name}}` : 'https://' };
  }
}

/** Plain one-line summary of an action, for lists. */
export function actionSummary(a: TableAction, t: DataTable, tables: DataTable[], users: User[], channels: Channel[]) {
  const fname = (id?: string) => t.fields.find((f) => f.id === id)?.name ?? '';
  const tname = (id: string) => tables.find((x) => x.id === id)?.name ?? 'another table';
  const who = (spec?: string) => (spec === '@me' ? 'whoever pressed it' : fname(spec) ? `the ${fname(spec)}` : users.find((u) => u.id === spec)?.name.split(' ')[0] ?? 'someone');
  switch (a.kind) {
    case 'set':
      return Object.keys(a.values).length ? `Set ${Object.keys(a.values).map(fname).filter(Boolean).join(', ')}` : 'Set fields (none picked yet)';
    case 'copy':
      return `Copy to ${tname(a.tableId)}`;
    case 'move':
      return `Move to ${tname(a.tableId)}`;
    case 'linked':
      return `Add a linked row in ${tname(a.tableId)}`;
    case 'task':
      return `Make a task for ${who(a.assignee)}`;
    case 'email':
      return `Write an email${a.toField ? ` to the ${fname(a.toField)}` : ''}`;
    case 'chat':
      return `Post in #${channels.find((c) => c.id === a.channelId)?.name ?? '…'}`;
    case 'notify':
      return `Notify ${who(a.who)}`;
    case 'webhook':
      return a.url ? `Send to ${a.url.replace(/^https?:\/\//, '').split('/')[0]}` : 'Send a webhook (no address yet)';
    case 'open':
      return 'Open a link';
  }
}

/** Who an action is for: a person field on the row, whoever pressed, or a named teammate. */
function PersonSpec({ t, users, value, onChange, label }: { t: DataTable; users: User[]; value?: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className="tb-native" value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="">Nobody</option>
      {t.fields.filter((f) => f.type === 'person').map((f) => (
        <option key={f.id} value={f.id}>
          The row’s {f.name}
        </option>
      ))}
      <option value="@me">Whoever pressed it</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

/** A value to set on a field, in the shape the field takes. */
function ValueInput({ f, users, value, onChange }: { f: TableField; users: User[]; value: unknown; onChange: (v: string | number | boolean | string[] | null) => void }) {
  if (f.type === 'select' || f.type === 'multi')
    return (
      <select className="tb-native" value={Array.isArray(value) ? value[0] ?? '' : String(value ?? '')} aria-label={f.name} onChange={(e) => onChange(f.type === 'multi' ? (e.target.value ? [e.target.value] : []) : e.target.value || null)}>
        <option value="">Empty</option>
        {f.options?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (f.type === 'person')
    return (
      <select className="tb-native" value={String(value ?? '')} aria-label={f.name} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Empty</option>
        <option value="@me">Whoever pressed it</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    );
  if (f.type === 'checkbox')
    return (
      <select className="tb-native" value={value ? 'yes' : 'no'} aria-label={f.name} onChange={(e) => onChange(e.target.value === 'yes')}>
        <option value="yes">Checked</option>
        <option value="no">Not checked</option>
      </select>
    );
  if (f.type === 'date')
    return (
      <select className="tb-native" value={value === '@today' ? '@today' : value ? 'pick' : ''} aria-label={f.name} onChange={(e) => onChange(e.target.value === '@today' ? '@today' : null)}>
        <option value="@today">Today (when it runs)</option>
        <option value="">Empty</option>
      </select>
    );
  return <input className="tb-native" value={String(value ?? '')} placeholder="Value, or empty" aria-label={f.name} onChange={(e) => onChange(f.type === 'number' || f.type === 'money' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null)} />;
}

/* ---------- one action ---------- */

function ActionCard({ a, i, t, tables, users, channels, onChange, onRemove, onMove, count }: { a: TableAction; i: number; t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; onChange: (a: TableAction) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; count: number }) {
  const [open, setOpen] = useState(true);
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; note?: string; payload?: unknown } | null>(null);
  const others = tables.filter((x) => x.id !== t.id && x.workspaceId === t.workspaceId);
  const kind = ACTION_KINDS.find((k) => k.kind === a.kind)!;
  const sendTest = async () => {
    if (a.kind !== 'webhook') return;
    setTest({ busy: true });
    const r = await fetch('/api/tables/test-hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: t.id, url: a.url, fields: a.fields }) }).then((x) => x.json()).catch(() => null);
    setTest(r ? { ok: r.ok, note: r.note, payload: r.payload } : { ok: false, note: 'The server didn’t answer' });
  };
  return (
    <div className="tb-act-card">
      <header>
        <button type="button" className="tb-act-head" onClick={() => setOpen((x) => !x)}>
          <span className="tb-act-n">{i + 1}</span>
          <strong>{kind.label}</strong>
          <ChevronRight size={14} className={`rot-chev ${open ? 'open' : ''}`} />
        </button>
        {count > 1 && (
          <>
            <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => onMove(-1)} aria-label="Move up">
              ↑
            </button>
            <button type="button" className="icon-btn sm" disabled={i === count - 1} onClick={() => onMove(1)} aria-label="Move down">
              ↓
            </button>
          </>
        )}
        <button type="button" className="icon-btn sm" onClick={onRemove} aria-label="Remove step">
          <X size={13} />
        </button>
      </header>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="fold-in tb-act-body">
          {a.kind === 'set' && (
            <>
              {Object.entries(a.values).map(([fid, v]) => {
                const f = t.fields.find((x) => x.id === fid);
                if (!f) return null;
                return (
                  <div key={fid} className="tb-act-row">
                    <span className="tb-act-label">{f.name}</span>
                    <ValueInput f={f} users={users} value={v} onChange={(nv) => onChange({ ...a, values: { ...a.values, [fid]: nv } })} />
                    <button type="button" className="icon-btn sm" aria-label="Remove" onClick={() => onChange({ ...a, values: Object.fromEntries(Object.entries(a.values).filter(([k]) => k !== fid)) })}>
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
              <select className="tb-native" value="" aria-label="Add a field to set" onChange={(e) => e.target.value && onChange({ ...a, values: { ...a.values, [e.target.value]: null } })}>
                <option value="">+ Field to set…</option>
                {t.fields.filter((f) => f.type !== 'button' && f.type !== 'link' && !(f.id in a.values)).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {(a.kind === 'copy' || a.kind === 'move' || a.kind === 'linked') &&
            (others.length ? (
              <>
                <select className="tb-native" value={a.tableId} aria-label="Table" onChange={(e) => onChange({ ...a, tableId: e.target.value })}>
                  {others.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <p className="muted small">Fields with the same name carry across{a.kind === 'linked' ? ', and the new row links back here (if it has a link field to this table)' : ''}.</p>
              </>
            ) : (
              <p className="muted small">Make another table first.</p>
            ))}
          {a.kind === 'task' && (
            <>
              <input className="tb-native" value={a.title} placeholder="Task title, e.g. Call {Name}" onChange={(e) => onChange({ ...a, title: e.target.value })} />
              <div className="tb-act-row">
                <span className="tb-act-label">For</span>
                <PersonSpec t={t} users={users} value={a.assignee} onChange={(v) => onChange({ ...a, assignee: v })} label="Assign to" />
              </div>
              <div className="tb-act-row">
                <span className="tb-act-label">Due in</span>
                <input className="tb-native" type="number" min={0} value={a.dueDays ?? ''} placeholder="No due date" onChange={(e) => onChange({ ...a, dueDays: e.target.value === '' ? undefined : Number(e.target.value) })} />
                <span className="muted small">days</span>
              </div>
            </>
          )}
          {a.kind === 'notify' && (
            <>
              <PersonSpec t={t} users={users} value={a.who} onChange={(v) => onChange({ ...a, who: v })} label="Who" />
              <input className="tb-native" value={a.text} placeholder="Message, e.g. {Name} is qualified" onChange={(e) => onChange({ ...a, text: e.target.value })} />
            </>
          )}
          {a.kind === 'chat' && (
            <>
              <select className="tb-native" value={a.channelId} aria-label="Channel" onChange={(e) => onChange({ ...a, channelId: e.target.value })}>
                <option value="">Pick a channel</option>
                {channels.filter((c) => c.kind !== 'dm').map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
              <input className="tb-native" value={a.text} placeholder="Message, e.g. New lead: {Name}" onChange={(e) => onChange({ ...a, text: e.target.value })} />
            </>
          )}
          {a.kind === 'email' && (
            <>
              <select className="tb-native" value={a.toField ?? ''} aria-label="To" onChange={(e) => onChange({ ...a, toField: e.target.value || undefined })}>
                <option value="">No address</option>
                {t.fields.filter((f) => f.type === 'email').map((f) => (
                  <option key={f.id} value={f.id}>
                    To the row’s {f.name}
                  </option>
                ))}
              </select>
              <input className="tb-native" value={a.subject} placeholder="Subject" onChange={(e) => onChange({ ...a, subject: e.target.value })} />
              <textarea className="tb-native tall" value={a.body} rows={4} placeholder="Hi {Name}," onChange={(e) => onChange({ ...a, body: e.target.value })} />
              <p className="muted small">It opens a new email, filled in; you read it and press send.</p>
            </>
          )}
          {a.kind === 'open' && <input className="tb-native" value={a.url} placeholder="https://wa.me/{Phone}" onChange={(e) => onChange({ ...a, url: e.target.value })} />}
          {a.kind === 'webhook' && (
            <>
              <input className="tb-native" value={a.url} placeholder="https://hooks.example.com/…" onChange={(e) => (onChange({ ...a, url: e.target.value }), setTest(null))} />
              <div className="tb-act-row">
                <span className="tb-act-label">Send</span>
                <select className="tb-native" value={a.fields ? 'pick' : 'all'} aria-label="What to send" onChange={(e) => onChange({ ...a, fields: e.target.value === 'all' ? undefined : t.fields.filter((f) => f.type !== 'button').slice(0, 3).map((f) => ({ fieldId: f.id, key: f.name.toLowerCase().replace(/\W+/g, '_') })) })}>
                  <option value="all">Every field, by its name</option>
                  <option value="pick">Chosen fields, with my own names</option>
                </select>
              </div>
              {a.fields?.map((m, j) => (
                <div key={j} className="tb-act-row">
                  <select className="tb-native" value={m.fieldId} aria-label="Field" onChange={(e) => onChange({ ...a, fields: a.fields!.map((x, k) => (k === j ? { ...x, fieldId: e.target.value } : x)) })}>
                    {t.fields.filter((f) => f.type !== 'button').map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <span className="muted">as</span>
                  <input className="tb-native" value={m.key} aria-label="Sent as" onChange={(e) => onChange({ ...a, fields: a.fields!.map((x, k) => (k === j ? { ...x, key: e.target.value } : x)) })} />
                  <button type="button" className="icon-btn sm" aria-label="Remove" onClick={() => onChange({ ...a, fields: a.fields!.filter((_, k) => k !== j) })}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              {a.fields && (
                <button type="button" className="link-btn small" onClick={() => onChange({ ...a, fields: [...a.fields!, { fieldId: t.fields[0].id, key: '' }] })}>
                  <Plus size={13} /> Add a field
                </button>
              )}
              <div className="tb-act-row">
                <span className="tb-act-label">Reply</span>
                <span className="muted small">Save something from the answer into a field (optional)</span>
              </div>
              {(a.replyTo ?? []).map((m, j) => (
                <div key={j} className="tb-act-row">
                  <input className="tb-native" value={m.path} placeholder="e.g. id or data.link" aria-label="From the reply" onChange={(e) => onChange({ ...a, replyTo: a.replyTo!.map((x, k) => (k === j ? { ...x, path: e.target.value } : x)) })} />
                  <span className="muted">into</span>
                  <select className="tb-native" value={m.fieldId} aria-label="Field" onChange={(e) => onChange({ ...a, replyTo: a.replyTo!.map((x, k) => (k === j ? { ...x, fieldId: e.target.value } : x)) })}>
                    {t.fields.filter((f) => !['button', 'link', 'select', 'multi', 'person'].includes(f.type)).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="icon-btn sm" aria-label="Remove" onClick={() => onChange({ ...a, replyTo: a.replyTo!.filter((_, k) => k !== j) })}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="tb-act-row">
                <button type="button" className="link-btn small" onClick={() => onChange({ ...a, replyTo: [...(a.replyTo ?? []), { path: 'id', fieldId: t.fields.find((f) => f.type === 'text' && f !== t.fields[0])?.id ?? t.fields[0].id }] })}>
                  <Plus size={13} /> Save from the reply
                </button>
                <span className="spacer" />
                <button type="button" className="ghost-btn sm" disabled={!/^https?:\/\/.+/.test(a.url) || test?.busy} onClick={sendTest}>
                  <Send size={13} /> {test?.busy ? 'Sending…' : 'Send test'}
                </button>
              </div>
              {test && !test.busy && (
                <div className={`tb-test ${test.ok ? 'ok' : 'bad'}`}>
                  <strong>
                    {test.ok ? <Check size={13} /> : <X size={13} />} {test.note}
                  </strong>
                  {test.payload != null && <pre>{JSON.stringify(test.payload, null, 2).slice(0, 1200)}</pre>}
                </div>
              )}
            </>
          )}
          {['task', 'notify', 'chat', 'email', 'open'].includes(a.kind) && <p className="muted small">Use {'{Field name}'} to put in the row’s value.</p>}
        </div>
      </div>
    </div>
  );
}

/** The steps a button or rule runs, in order. */
export function ActionsEditor({ t, tables, users, channels, actions, onChange, forRule }: { t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; actions: TableAction[]; onChange: (a: TableAction[]) => void; forRule?: boolean }) {
  const [adding, setAdding] = useState(!actions.length);
  return (
    <div className="tb-actions">
      {actions.map((a, i) => (
        <ActionCard
          key={i}
          a={a}
          i={i}
          count={actions.length}
          t={t}
          tables={tables}
          users={users}
          channels={channels}
          onChange={(na) => onChange(actions.map((x, j) => (j === i ? na : x)))}
          onRemove={() => onChange(actions.filter((_, j) => j !== i))}
          onMove={(d) => {
            const next = [...actions];
            [next[i], next[i + d]] = [next[i + d], next[i]];
            onChange(next);
          }}
        />
      ))}
      <div className={`fold ${adding ? 'open' : ''}`}>
        <div className="fold-in">
          <div className="tb-kinds">
            {ACTION_KINDS.filter((k) => !forRule || k.ruleOk).map((k) => (
              <button key={k.kind} type="button" onClick={() => (onChange([...actions, blankAction(k.kind, t, tables)]), setAdding(false))}>
                <strong>{k.label}</strong>
                <small>{k.hint}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
      {!adding && (
        <button type="button" className="link-btn small" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add a step
        </button>
      )}
    </div>
  );
}

/* ---------- button settings (inside a Button field's settings) ---------- */

export function ButtonSettings({ field, t, tables, users, channels, onChange }: { field: TableField; t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; onChange: (b: ButtonDef) => void }) {
  const b: ButtonDef = field.button ?? { label: field.name || 'Run', actions: [] };
  const set = (p: Partial<ButtonDef>) => onChange({ ...b, ...p });
  const sw = b.showWhen;
  const swField = t.fields.find((f) => f.id === sw?.fieldId);
  return (
    <div className="tb-btn-set">
      <div className="tb-act-row">
        <span className="tb-act-label">Label</span>
        <input className="tb-native" value={b.label} onChange={(e) => set({ label: e.target.value })} placeholder="Send to dialer" />
      </div>
      <div className="tb-act-row">
        <span className="tb-act-label">Colour</span>
        <div className="tb-colors">
          {OPTION_COLORS.map((c) => (
            <button key={c} type="button" className={`tb-dot big${(b.color ?? OPTION_COLORS[1]) === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
          ))}
        </div>
      </div>
      <span className="tb-fm-label">When pressed</span>
      <ActionsEditor t={t} tables={tables} users={users} channels={channels} actions={b.actions} onChange={(actions) => set({ actions })} />
      <span className="tb-fm-label">Options</span>
      <label className="check-row">
        <input type="checkbox" checked={!!b.confirm} onChange={(e) => set({ confirm: e.target.checked })} /> Ask “Are you sure?” first
      </label>
      <label className="check-row">
        <input type="checkbox" checked={b.who === 'admins'} onChange={(e) => set({ who: e.target.checked ? 'admins' : 'team' })} /> Only admins can press it
      </label>
      <div className="tb-act-row">
        <span className="tb-act-label">Ask for</span>
        <select className="tb-native" value="" aria-label="Fill in first" onChange={(e) => e.target.value && set({ ask: [...(b.ask ?? []), e.target.value] })}>
          <option value="">{b.ask?.length ? '+ Another field' : 'Nothing (runs straight away)'}</option>
          {t.fields.filter((f, i) => i > 0 && !['button', 'link'].includes(f.type) && !b.ask?.includes(f.id)).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      {b.ask?.length ? (
        <div className="tb-chips wrap">
          {b.ask.map((id) => (
            <button key={id} type="button" className="tb-chip linked" onClick={() => set({ ask: b.ask!.filter((x) => x !== id) })} title="Remove">
              {t.fields.find((f) => f.id === id)?.name} <X size={11} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="tb-act-row">
        <span className="tb-act-label">Show on</span>
        <select className="tb-native" value={sw?.fieldId ?? ''} aria-label="Only on rows where" onChange={(e) => {
          const f = t.fields.find((x) => x.id === e.target.value);
          set({ showWhen: f ? { fieldId: f.id, op: opsFor(f.type)[0].op } : undefined });
        }}>
          <option value="">Every row</option>
          {t.fields.filter((f) => !['button', 'link'].includes(f.type)).map((f) => (
            <option key={f.id} value={f.id}>
              Rows where {f.name}…
            </option>
          ))}
        </select>
      </div>
      {sw && swField && (
        <div className="tb-act-row">
          <select className="tb-native" value={sw.op} aria-label="Test" onChange={(e) => set({ showWhen: { ...sw, op: e.target.value as typeof sw.op } })}>
            {opsFor(swField.type).map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
          {sw.op !== 'empty' && sw.op !== 'filled' &&
            (swField.options ? (
              <select className="tb-native" value={sw.value ?? ''} aria-label="Value" onChange={(e) => set({ showWhen: { ...sw, value: e.target.value } })}>
                <option value="">Choose…</option>
                {swField.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input className="tb-native" value={sw.value ?? ''} aria-label="Value" onChange={(e) => set({ showWhen: { ...sw, value: e.target.value } })} />
            ))}
        </div>
      )}
    </div>
  );
}

/* ---------- the Automations panel: data in, rules, the log ---------- */

export function AutomationsPanel({ t, tables, users, channels, onPatch, onClose, toast }: { t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; onPatch: (p: Partial<DataTable>) => void; onClose: () => void; toast: (text: string) => void }) {
  const [tab, setTab] = useState<'in' | 'rules' | 'log'>('in');
  const [editing, setEditing] = useState<string | null>(null);
  const intake = t.intake;
  const url = intake ? `${location.origin}/api/hooks/${intake.token}` : '';
  const setIntake = (p: Partial<TableIntake>) => onPatch({ intake: { ...(intake ?? { token: secret(), enabled: true, mapping: {} }), ...p } });
  const copy = (text: string, what: string) => void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`));
  const rules = t.rules ?? [];
  const setRule = (id: string, p: Partial<TableRule>) => onPatch({ rules: rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRule = () => {
    const r: TableRule = { id: uid(), name: 'New rule', on: 'created', actions: [], enabled: true };
    onPatch({ rules: [...rules, r] });
    setEditing(r.id);
  };
  // Every key seen so far (the latest delivery's first), so earlier ones can still be mapped.
  const sampleKeys = [...new Set([...Object.keys(intake?.sample ?? {}), ...Object.keys(intake?.mapping ?? {})])];
  const example = JSON.stringify(Object.fromEntries(t.fields.filter((f) => !['button', 'link'].includes(f.type)).slice(0, 4).map((f) => [f.name.toLowerCase().replace(/\W+/g, '_'), f.type === 'email' ? 'rina@example.com' : f.type === 'phone' ? '+62 812 0000 0000' : f.type === 'money' || f.type === 'number' ? 1000000 : f.options?.[0]?.label ?? `Example ${f.name.toLowerCase()}`])), null, 2);

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer tb-drawer tb-auto" role="dialog" aria-label="Automations" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="drawer-head">
          <span className="drawer-kind">
            <Zap size={14} /> Automations · {t.name}
          </span>
          <span className="spacer" />
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="drawer-body">
          <div className="segmented tb-auto-tabs">
            <button className={tab === 'in' ? 'on' : ''} onClick={() => setTab('in')}>
              Data coming in
            </button>
            <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>
              Rules{rules.length ? ` · ${rules.filter((r) => r.enabled).length}` : ''}
            </button>
            <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
              Log
            </button>
          </div>
          <TabPane key={tab}>
            {tab === 'in' && (
              <div className="tb-auto-sec">
                <p className="muted small">Forms, ads, Zapier, Make or your own scripts can add rows by posting to this table’s own address. JSON or form data both work.</p>
                {!intake ? (
                  <button className="primary-btn sm" onClick={() => setIntake({})}>
                    <ArrowDownLeft size={14} /> Make an address for this table
                  </button>
                ) : (
                  <>
                    <div className="tb-url">
                      <code>{url}</code>
                      <button className="icon-btn sm" onClick={() => copy(url, 'Address')} aria-label="Copy address">
                        <Copy size={14} />
                      </button>
                    </div>
                    <div className="tb-act-row">
                      <label className="check-row">
                        <input type="checkbox" checked={intake.enabled} onChange={(e) => setIntake({ enabled: e.target.checked })} /> Accepting data
                      </label>
                      <span className="spacer" />
                      <button className="link-btn small" onClick={() => confirm('Make a new address? The old one stops working straight away, so update anything that posts to it.') && setIntake({ token: secret() })}>
                        <RefreshCw size={12} /> New address
                      </button>
                    </div>
                    <div className="tb-act-row">
                      <span className="tb-act-label">Duplicates</span>
                      <select className="tb-native" value={intake.dedupeField ?? ''} aria-label="Duplicates" onChange={(e) => setIntake({ dedupeField: e.target.value || undefined })}>
                        <option value="">Always add a new row</option>
                        {t.fields.filter((f) => ['text', 'email', 'phone', 'url', 'number'].includes(f.type)).map((f) => (
                          <option key={f.id} value={f.id}>
                            Same {f.name.toLowerCase()} updates that row
                          </option>
                        ))}
                      </select>
                    </div>

                    <h4 className="tb-auto-h">Which field each value goes into</h4>
                    {sampleKeys.length ? (
                      <div className="tb-map">
                        {sampleKeys.map((k) => (
                          <div key={k} className="tb-map-row">
                            <code title={k}>{k}</code>
                            <span className="tb-map-sample muted small" title={String(intake.sample?.[k] ?? '')}>
                              {intake.sample?.[k] != null ? String(intake.sample[k]).slice(0, 40) : ''}
                            </span>
                            <select className="tb-native" value={intake.mapping[k] ?? ''} aria-label={`Field for ${k}`} onChange={(e) => setIntake({ mapping: { ...intake.mapping, [k]: e.target.value } })}>
                              <option value="">Keep aside (not a field)</option>
                              {t.fields.filter((f) => !['button', 'link'].includes(f.type)).map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                        <p className="muted small">Values matched to fields by name automatically; change any of them here. Values kept aside are still saved on the row.</p>
                      </div>
                    ) : (
                      <>
                        <p className="muted small">Send one test delivery and its values appear here to match to fields. Names that match a field (like email or phone_number) go in by themselves. For example:</p>
                        <div className="tb-url">
                          <code className="block">{`curl -X POST ${url} \\\n  -H "content-type: application/json" \\\n  -d '${example.replace(/\n\s*/g, ' ')}'`}</code>
                          <button className="icon-btn sm" onClick={() => copy(`curl -X POST ${url} -H "content-type: application/json" -d '${example.replace(/\n\s*/g, ' ')}'`, 'Example')} aria-label="Copy example">
                            <Copy size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
                <h4 className="tb-auto-h">
                  <KeyRound size={13} /> Signing outgoing webhooks
                </h4>
                <p className="muted small">Webhooks this table sends carry an <code>X-Sprint2go-Signature</code> header: an HMAC-SHA256 of the body with this secret, so the other side can check it came from you.</p>
                {t.signingSecret ? (
                  <div className="tb-url">
                    <code>{t.signingSecret.slice(0, 6)}••••••••••••</code>
                    <button className="icon-btn sm" onClick={() => copy(t.signingSecret!, 'Secret')} aria-label="Copy secret">
                      <Copy size={14} />
                    </button>
                    <button className="icon-btn sm" onClick={() => confirm('Make a new secret? Receivers checking the old one will reject webhooks until updated.') && onPatch({ signingSecret: secret(32) })} aria-label="New secret">
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : (
                  <button className="ghost-btn sm" onClick={() => onPatch({ signingSecret: secret(32) })}>
                    Make a signing secret
                  </button>
                )}
              </div>
            )}

            {tab === 'rules' && (
              <div className="tb-auto-sec">
                <p className="muted small">Rules run the same steps as buttons, by themselves: when a row is added, changed, or a field becomes a value.</p>
                {rules.map((r) => {
                  const f = t.fields.find((x) => x.id === r.fieldId);
                  const open = editing === r.id;
                  const when = r.on === 'created' ? 'When a row is added' : r.on === 'updated' ? 'When a row changes' : `When ${f?.name ?? 'a field'} becomes ${f?.options?.find((o) => o.id === r.value)?.label ?? (f?.type === 'checkbox' ? (r.value === 'yes' ? 'checked' : 'unchecked') : r.value || '…')}`;
                  return (
                    <div key={r.id} className={`tb-rule${r.enabled ? '' : ' off'}`}>
                      <header>
                        <input type="checkbox" checked={r.enabled} aria-label="On" onChange={(e) => setRule(r.id, { enabled: e.target.checked })} />
                        <button type="button" className="tb-rule-head" onClick={() => setEditing(open ? null : r.id)}>
                          <strong>{r.name}</strong>
                          <small className="muted">
                            {when} · {r.actions.length ? r.actions.map((a) => actionSummary(a, t, tables, users, channels)).join(', ') : 'no steps yet'}
                          </small>
                        </button>
                        <button type="button" className="icon-btn sm" aria-label="Delete rule" onClick={() => confirm(`Delete the rule “${r.name}”?`) && onPatch({ rules: rules.filter((x) => x.id !== r.id) })}>
                          <Trash2 size={14} />
                        </button>
                      </header>
                      <div className={`fold ${open ? 'open' : ''}`}>
                        <div className="fold-in tb-rule-body">
                          <input className="tb-native" value={r.name} aria-label="Rule name" onChange={(e) => setRule(r.id, { name: e.target.value })} />
                          <div className="tb-act-row">
                            <span className="tb-act-label">When</span>
                            <select className="tb-native" value={r.on} aria-label="When" onChange={(e) => setRule(r.id, { on: e.target.value as TableRule['on'] })}>
                              <option value="created">A row is added</option>
                              <option value="updated">A row changes</option>
                              <option value="becomes">A field becomes…</option>
                            </select>
                          </div>
                          {r.on === 'becomes' && (
                            <div className="tb-act-row">
                              <select className="tb-native" value={r.fieldId ?? ''} aria-label="Field" onChange={(e) => setRule(r.id, { fieldId: e.target.value, value: undefined })}>
                                <option value="">Pick a field</option>
                                {t.fields.filter((x) => ['select', 'multi', 'checkbox', 'text', 'person'].includes(x.type)).map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name}
                                  </option>
                                ))}
                              </select>
                              {f &&
                                (f.options ? (
                                  <select className="tb-native" value={r.value ?? ''} aria-label="Value" onChange={(e) => setRule(r.id, { value: e.target.value })}>
                                    <option value="">Choose…</option>
                                    {f.options.map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : f.type === 'checkbox' ? (
                                  <select className="tb-native" value={r.value ?? 'yes'} aria-label="Value" onChange={(e) => setRule(r.id, { value: e.target.value })}>
                                    <option value="yes">Checked</option>
                                    <option value="no">Unchecked</option>
                                  </select>
                                ) : f.type === 'person' ? (
                                  <select className="tb-native" value={r.value ?? ''} aria-label="Value" onChange={(e) => setRule(r.id, { value: e.target.value })}>
                                    <option value="">Choose…</option>
                                    {users.map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input className="tb-native" value={r.value ?? ''} aria-label="Value" onChange={(e) => setRule(r.id, { value: e.target.value })} />
                                ))}
                            </div>
                          )}
                          <span className="tb-fm-label">Then</span>
                          <ActionsEditor t={t} tables={tables} users={users} channels={channels} actions={r.actions} onChange={(actions) => setRule(r.id, { actions })} forRule />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button className="ghost-btn sm" onClick={addRule}>
                  <Plus size={13} /> Add a rule
                </button>
              </div>
            )}

            {tab === 'log' && (
              <div className="tb-auto-sec">
                {(t.log ?? []).length ? (
                  <ul className="tb-log">
                    {[...t.log!].reverse().map((e, i) => (
                      <li key={i} className={e.ok ? '' : 'bad'}>
                        {e.dir === 'in' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                        <span>{e.text}</span>
                        <time className="muted small">{relative(e.at)}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Nothing yet. Deliveries coming in, webhooks going out and rules that ran show here (the last 50).</p>
                )}
              </div>
            )}
          </TabPane>
        </div>
      </aside>
    </div>
  );
}
