import { PickSelect } from '../ui/PickSelect';
import { PeoplePicker, PersonSelect } from '../ui/PeoplePicker';
import type { ExtraOption } from '../ui/PeopleList';
import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Ban, Check, ChevronRight, Copy, KeyRound, MousePointerClick, Plus, RefreshCw, ScrollText, Send, Trash2, UserRound, X, Zap } from 'lucide-react';
import type { ButtonDef, Channel, DataTable, TableAction, TableField, TableIntake, TableRule, User } from '../../types';
import { relative, uid } from '../../utils';
import { TabPane } from '../ui/Smooth';
import { OPTION_COLORS, isComputed, noteOf, opsFor } from './fields';
import { guessType } from './csv';
import { brand as product } from '../../terms';
import { deviceTz } from '../../jobTimes';
import { t, tn, tx, textOf } from '../../i18n';
import { tj } from '../../i18n/tj';
import { fmtTime, weekdayName } from '../../i18n/format';

/** data.full_name -> Full name */
const humanize = (k: string) => {
  const w = (k.split('.').pop() ?? k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return w ? w[0].toUpperCase() + w.slice(1) : k;
};

/* ---------- small helpers ---------- */

const secret = (n = 24) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');

/** What a button or rule can do. `label` and `hint` are in the reader's language (read them while rendering). */
export const ACTION_KINDS: { kind: TableAction['kind']; label: string; hint: string; ruleOk: boolean }[] = [
  { kind: 'set', get label() { return t('Set fields'); }, get hint() { return t('Status → Contacted, Follow-up → today'); }, ruleOk: true },
  { kind: 'webhook', get label() { return t('Send a webhook'); }, get hint() { return t('Post the row to another app'); }, ruleOk: true },
  { kind: 'move', get label() { return t('Move to another table'); }, get hint() { return t('Fields carry across by name'); }, ruleOk: true },
  { kind: 'copy', get label() { return t('Copy to another table'); }, get hint() { return t('This row stays here too'); }, ruleOk: true },
  { kind: 'linked', get label() { return t('Add a linked row'); }, get hint() { return t('A new row there, linked back here'); }, ruleOk: true },
  { kind: 'assign', get label() { return t('Assign in turns'); }, get hint() { return t('The next salesperson, round robin'); }, ruleOk: true },
  { kind: 'task', get label() { return t('Make a task'); }, get hint() { return t('Assigned, with a due date'); }, ruleOk: true },
  { kind: 'notify', get label() { return t('Notify someone'); }, get hint() { return t('A notification in {product}', { product: product.name }); }, ruleOk: true },
  { kind: 'chat', get label() { return t('Post in a channel'); }, get hint() { return t('A message in Chat'); }, ruleOk: true },
  { kind: 'email', get label() { return t('Write an email'); }, get hint() { return t('Opens a new email, filled in'); }, ruleOk: false },
  { kind: 'open', get label() { return t('Open a link'); }, get hint() { return t('Like {example}', { example: `https://wa.me/{${t('Phone')}}` }); }, ruleOk: false },
];

/** A field put in a message as {Field name}, with the field's name as the person reads it. */
const ref = (name: string) => `{${name}}`;

function blankAction(kind: TableAction['kind'], tb: DataTable, tables: DataTable[]): TableAction {
  const other = tables.find((x) => x.id !== tb.id && x.workspaceId === tb.workspaceId)?.id ?? '';
  const first = tb.fields[0]?.name ?? t('Name');
  switch (kind) {
    case 'set':
      return { kind, values: {} };
    case 'copy':
    case 'move':
      return { kind, tableId: other };
    case 'linked':
      return { kind, tableId: other };
    case 'task':
      return { kind, title: t('Follow up {name}', { name: ref(first) }), assignee: tb.fields.find((f) => f.type === 'person')?.id ?? '@me', dueDays: 1 };
    case 'email':
      return { kind, toField: tb.fields.find((f) => f.type === 'email')?.id, subject: '', body: `${t('Hi {name},', { name: ref(first) })}\n\n` };
    case 'chat':
      return { kind, channelId: '', text: `{${first}}` };
    case 'notify':
      return { kind, who: tb.fields.find((f) => f.type === 'person')?.id ?? '@me', text: t('{name} needs you', { name: ref(first) }) };
    case 'webhook':
      return { kind, url: '' };
    case 'open':
      return { kind, url: tb.fields.some((f) => f.type === 'phone') ? `https://wa.me/{${tb.fields.find((f) => f.type === 'phone')!.name}}` : 'https://' };
    case 'assign':
      return { kind, fieldId: tb.fields.find((f) => f.type === 'person')?.id ?? '', among: [] };
  }
}

/** Plain one-line summary of an action, for lists. */
export function actionSummary(a: TableAction, tb: DataTable, tables: DataTable[], users: User[], channels: Channel[]) {
  const fname = (id?: string) => tb.fields.find((f) => f.id === id)?.name ?? '';
  const tname = (id: string) => tables.find((x) => x.id === id)?.name ?? t('another table');
  const who = (spec?: string) => (spec === '@me' ? t('whoever pressed it') : fname(spec) ? t('the {field}', { field: fname(spec) }) : users.find((u) => u.id === spec)?.name.split(' ')[0] ?? t('someone'));
  switch (a.kind) {
    case 'set':
      return Object.keys(a.values).length ? t('Set {fields}', { fields: Object.keys(a.values).map(fname).filter(Boolean).join(', ') }) : t('Set fields (none picked yet)');
    case 'copy':
      return t('Copy to {table}', { table: tname(a.tableId) });
    case 'move':
      return t('Move to {table}', { table: tname(a.tableId) });
    case 'linked':
      return t('Add a linked row in {table}', { table: tname(a.tableId) });
    case 'task':
      return t('Make a task for {who}', { who: who(a.assignee) });
    case 'email':
      return a.toField ? t('Write an email to the {field}', { field: fname(a.toField) }) : t('Write an email');
    case 'chat':
      return t('Post in #{channel}', { channel: channels.find((c) => c.id === a.channelId)?.name ?? '…' });
    case 'notify':
      return t('Notify {who}', { who: who(a.who) });
    case 'webhook':
      return a.url ? t('Send to {host}', { host: a.url.replace(/^https?:\/\//, '').split('/')[0] }) : t('Send a webhook (no address yet)');
    case 'open':
      return t('Open a link');
    case 'assign':
      return a.among.length ? tn(a.among.length, 'Assign {field} in turns ({n} person)', 'Assign {field} in turns ({n} people)', { field: fname(a.fieldId) || t('a person') }) : t('Assign in turns (nobody picked yet)');
  }
}

/** Who an action is for: a person field on the row, whoever pressed, or a named teammate. */
function PersonSpec({ t: tb, users, value, onChange, label }: { t: DataTable; users: User[]; value?: string; onChange: (v: string) => void; label: string }) {
  const extra: ExtraOption[] = [
    { value: '', label: t('Nobody'), icon: <Ban size={15} /> },
    ...tb.fields.filter((f) => f.type === 'person').map((f) => ({ value: f.id, label: t('The row’s {field}', { field: f.name }), icon: <UserRound size={15} /> })),
    { value: '@me', label: t('Whoever pressed it'), icon: <MousePointerClick size={15} /> },
  ];
  return <PersonSelect value={value ?? ''} users={users} extra={extra} label={label} onChange={onChange} />;
}

/** A value to set on a field, in the shape the field takes. */
function ValueInput({ f, users, value, onChange }: { f: TableField; users: User[]; value: unknown; onChange: (v: string | number | boolean | string[] | null) => void }) {
  if (f.type === 'select' || f.type === 'multi')
    return (
      <PickSelect value={Array.isArray(value) ? value[0] ?? '' : String(value ?? '')} aria-label={f.name} onChange={(e) => onChange(f.type === 'multi' ? (e.target.value ? [e.target.value] : []) : e.target.value || null)}>
        <option value="">{tx('value', 'Empty')}</option>
        {f.options?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </PickSelect>
    );
  if (f.type === 'person')
    return (
      <PersonSelect
        value={String(value ?? '')}
        users={users}
        label={f.name}
        extra={[
          { value: '', label: tx('value', 'Empty'), icon: <Ban size={15} /> },
          { value: '@me', label: t('Whoever pressed it'), icon: <MousePointerClick size={15} /> },
        ]}
        onChange={(v) => onChange(v || null)}
      />
    );
  if (f.type === 'checkbox')
    return (
      <PickSelect value={value ? 'yes' : 'no'} aria-label={f.name} onChange={(e) => onChange(e.target.value === 'yes')}>
        <option value="yes">{t('Checked')}</option>
        <option value="no">{t('Not checked')}</option>
      </PickSelect>
    );
  if (f.type === 'date')
    return (
      <PickSelect value={value === '@today' ? '@today' : value ? 'pick' : ''} aria-label={f.name} onChange={(e) => onChange(e.target.value === '@today' ? '@today' : null)}>
        <option value="@today">{t('Today (when it runs)')}</option>
        <option value="">{tx('value', 'Empty')}</option>
      </PickSelect>
    );
  return <input className="tb-native" value={String(value ?? '')} placeholder={t('Value, or empty')} aria-label={f.name} onChange={(e) => onChange(f.type === 'number' || f.type === 'money' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value || null)} />;
}

/* ---------- one action ---------- */

function ActionCard({ a, i, t: tb, tables, users, channels, onChange, onRemove, onMove, count }: { a: TableAction; i: number; t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; onChange: (a: TableAction) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; count: number }) {
  const [open, setOpen] = useState(true);
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; note?: string; payload?: unknown } | null>(null);
  const others = tables.filter((x) => x.id !== tb.id && x.workspaceId === tb.workspaceId);
  const kind = ACTION_KINDS.find((k) => k.kind === a.kind)!;
  const sendTest = async () => {
    if (a.kind !== 'webhook') return;
    setTest({ busy: true });
    const r = await fetch('/api/tables/test-hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tableId: tb.id, url: a.url, fields: a.fields }) }).then((x) => x.json()).catch(() => null);
    setTest(r ? { ok: r.ok, note: noteOf(r), payload: r.payload } : { ok: false, note: t('The server didn’t answer') });
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
            <button type="button" className="icon-btn sm" disabled={i === 0} onClick={() => onMove(-1)} aria-label={t('Move up')}>
              ↑
            </button>
            <button type="button" className="icon-btn sm" disabled={i === count - 1} onClick={() => onMove(1)} aria-label={t('Move down')}>
              ↓
            </button>
          </>
        )}
        <button type="button" className="icon-btn sm" onClick={onRemove} aria-label={t('Remove step')}>
          <X size={13} />
        </button>
      </header>
      <div className={`fold ${open ? 'open' : ''}`}>
        <div className="fold-in tb-act-body">
          {a.kind === 'set' && (
            <>
              {Object.entries(a.values).map(([fid, v]) => {
                const f = tb.fields.find((x) => x.id === fid);
                if (!f) return null;
                return (
                  <div key={fid} className="tb-act-row">
                    <span className="tb-act-label">{f.name}</span>
                    <ValueInput f={f} users={users} value={v} onChange={(nv) => onChange({ ...a, values: { ...a.values, [fid]: nv } })} />
                    <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => onChange({ ...a, values: Object.fromEntries(Object.entries(a.values).filter(([k]) => k !== fid)) })}>
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
              <PickSelect value="" aria-label={t('Add a field to set')} onChange={(e) => e.target.value && onChange({ ...a, values: { ...a.values, [e.target.value]: null } })}>
                <option value="">{t('+ Field to set…')}</option>
                {tb.fields.filter((f) => f.type !== 'button' && f.type !== 'link' && !(f.id in a.values)).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </PickSelect>
            </>
          )}
          {(a.kind === 'copy' || a.kind === 'move' || a.kind === 'linked') &&
            (others.length ? (
              <>
                <PickSelect value={a.tableId} aria-label={t('Table')} onChange={(e) => onChange({ ...a, tableId: e.target.value })}>
                  {others.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </PickSelect>
                <p className="muted small">{a.kind === 'linked' ? t('Fields with the same name carry across, and the new row links back here (if it has a link field to this table).') : t('Fields with the same name carry across.')}</p>
              </>
            ) : (
              <p className="muted small">{t('Make another table first.')}</p>
            ))}
          {a.kind === 'task' && (
            <>
              <input className="tb-native" value={a.title} placeholder={t('Task title, e.g. Call {name}', { name: ref(t('Name')) })} onChange={(e) => onChange({ ...a, title: e.target.value })} />
              <div className="tb-act-row">
                <span className="tb-act-label">{t('For')}</span>
                <PersonSpec t={tb} users={users} value={a.assignee} onChange={(v) => onChange({ ...a, assignee: v })} label={t('Assign to')} />
              </div>
              <div className="tb-act-row">
                <span className="tb-act-label">{t('Due in')}</span>
                <input className="tb-native" type="number" min={0} value={a.dueDays ?? ''} placeholder={t('No due date')} onChange={(e) => onChange({ ...a, dueDays: e.target.value === '' ? undefined : Number(e.target.value) })} />
                <span className="muted small">{t('days')}</span>
              </div>
            </>
          )}
          {a.kind === 'notify' && (
            <>
              <PersonSpec t={tb} users={users} value={a.who} onChange={(v) => onChange({ ...a, who: v })} label={t('Who')} />
              <input className="tb-native" value={a.text} placeholder={t('Message, e.g. {name} is qualified', { name: ref(t('Name')) })} onChange={(e) => onChange({ ...a, text: e.target.value })} />
            </>
          )}
          {a.kind === 'chat' && (
            <>
              <PickSelect value={a.channelId} aria-label={t('Channel')} onChange={(e) => onChange({ ...a, channelId: e.target.value })}>
                <option value="">{t('Pick a channel')}</option>
                {channels.filter((c) => c.kind !== 'dm').map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </PickSelect>
              <input className="tb-native" value={a.text} placeholder={t('Message, e.g. New lead: {name}', { name: ref(t('Name')) })} onChange={(e) => onChange({ ...a, text: e.target.value })} />
            </>
          )}
          {a.kind === 'email' && (
            <>
              <PickSelect value={a.toField ?? ''} aria-label={t('To')} onChange={(e) => onChange({ ...a, toField: e.target.value || undefined })}>
                <option value="">{t('No address')}</option>
                {tb.fields.filter((f) => f.type === 'email').map((f) => (
                  <option key={f.id} value={f.id}>
                    {t('To the row’s {field}', { field: f.name })}
                  </option>
                ))}
              </PickSelect>
              <input className="tb-native" value={a.subject} placeholder={t('Subject')} onChange={(e) => onChange({ ...a, subject: e.target.value })} />
              <textarea className="tb-native tall" value={a.body} rows={4} placeholder={t('Hi {name},', { name: ref(t('Name')) })} onChange={(e) => onChange({ ...a, body: e.target.value })} />
              <p className="muted small">{t('It opens a new email, filled in; you read it and press send.')}</p>
            </>
          )}
          {a.kind === 'assign' &&
            (tb.fields.some((f) => f.type === 'person') ? (
              <>
                <div className="tb-act-row">
                  <span className="tb-act-label">{t('Field')}</span>
                  <PickSelect value={a.fieldId} aria-label={t('Person field')} onChange={(e) => onChange({ ...a, fieldId: e.target.value })}>
                    {tb.fields.filter((f) => f.type === 'person').map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </PickSelect>
                </div>
                <div className="tb-act-row">
                  <span className="tb-act-label">{t('Among')}</span>
                  <PeoplePicker value={a.among} users={users} me="" label={t('People who take turns')} emptyText={t('Pick people')} max={6} onChange={(among) => onChange({ ...a, among })} />
                </div>
                <p className="muted small">{t('Each time, the next person in this list gets it, then it starts again from the top.')}</p>
              </>
            ) : (
              <p className="muted small">{t('Add a Person field (like Owner) first.')}</p>
            ))}
          {a.kind === 'open' && <input className="tb-native" value={a.url} placeholder="https://wa.me/{Phone}" onChange={(e) => onChange({ ...a, url: e.target.value })} />}
          {a.kind === 'webhook' && (
            <>
              <input className="tb-native" value={a.url} placeholder="https://hooks.example.com/…" onChange={(e) => (onChange({ ...a, url: e.target.value }), setTest(null))} />
              <div className="tb-act-row">
                <span className="tb-act-label">{t('Send')}</span>
                <PickSelect value={a.fields ? 'pick' : 'all'} aria-label={t('What to send')} onChange={(e) => onChange({ ...a, fields: e.target.value === 'all' ? undefined : tb.fields.filter((f) => f.type !== 'button').slice(0, 3).map((f) => ({ fieldId: f.id, key: f.name.toLowerCase().replace(/\W+/g, '_') })) })}>
                  <option value="all">{t('Every field, by its name')}</option>
                  <option value="pick">{t('Chosen fields, with my own names')}</option>
                </PickSelect>
              </div>
              {a.fields?.map((m, j) => (
                <div key={j} className="tb-act-row">
                  <PickSelect value={m.fieldId} aria-label={t('Field')} onChange={(e) => onChange({ ...a, fields: a.fields!.map((x, k) => (k === j ? { ...x, fieldId: e.target.value } : x)) })}>
                    {tb.fields.filter((f) => f.type !== 'button').map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </PickSelect>
                  <span className="muted">{t('as')}</span>
                  <input className="tb-native" value={m.key} aria-label={t('Sent as')} onChange={(e) => onChange({ ...a, fields: a.fields!.map((x, k) => (k === j ? { ...x, key: e.target.value } : x)) })} />
                  <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => onChange({ ...a, fields: a.fields!.filter((_, k) => k !== j) })}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              {a.fields && (
                <button type="button" className="link-btn small" onClick={() => onChange({ ...a, fields: [...a.fields!, { fieldId: tb.fields[0].id, key: '' }] })}>
                  <Plus size={13} /> {t('Add a field')}
                </button>
              )}
              <div className="tb-act-row">
                <span className="tb-act-label">{tx('webhook', 'Reply')}</span>
                <span className="muted small">{t('Save something from the answer into a field (optional)')}</span>
              </div>
              {(a.replyTo ?? []).map((m, j) => (
                <div key={j} className="tb-act-row">
                  <input className="tb-native" value={m.path} placeholder={t('e.g. id or data.link')} aria-label={t('From the reply')} onChange={(e) => onChange({ ...a, replyTo: a.replyTo!.map((x, k) => (k === j ? { ...x, path: e.target.value } : x)) })} />
                  <span className="muted">{t('into')}</span>
                  <PickSelect value={m.fieldId} aria-label={t('Field')} onChange={(e) => onChange({ ...a, replyTo: a.replyTo!.map((x, k) => (k === j ? { ...x, fieldId: e.target.value } : x)) })}>
                    {tb.fields.filter((f) => !['button', 'link', 'select', 'multi', 'person'].includes(f.type)).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </PickSelect>
                  <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => onChange({ ...a, replyTo: a.replyTo!.filter((_, k) => k !== j) })}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="tb-act-row">
                <button type="button" className="link-btn small" onClick={() => onChange({ ...a, replyTo: [...(a.replyTo ?? []), { path: 'id', fieldId: tb.fields.find((f) => f.type === 'text' && f !== tb.fields[0])?.id ?? tb.fields[0].id }] })}>
                  <Plus size={13} /> {t('Save from the reply')}
                </button>
                <span className="spacer" />
                <button type="button" className="ghost-btn sm" disabled={!/^https?:\/\/.+/.test(a.url) || test?.busy} onClick={sendTest}>
                  <Send size={13} /> {test?.busy ? t('Sending…') : t('Send test')}
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
          {['task', 'notify', 'chat', 'email', 'open'].includes(a.kind) && <p className="muted small">{t('Use {example} to put in the row’s value.', { example: ref(t('Field name')) })}</p>}
        </div>
      </div>
    </div>
  );
}

/** The steps a button or rule runs, in order. */
export function ActionsEditor({ t: tb, tables, users, channels, actions, onChange, forRule }: { t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; actions: TableAction[]; onChange: (a: TableAction[]) => void; forRule?: boolean }) {
  const [adding, setAdding] = useState(!actions.length);
  return (
    <div className="tb-actions">
      {actions.map((a, i) => (
        <ActionCard
          key={i}
          a={a}
          i={i}
          count={actions.length}
          t={tb}
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
              <button key={k.kind} type="button" onClick={() => (onChange([...actions, blankAction(k.kind, tb, tables)]), setAdding(false))}>
                <strong>{k.label}</strong>
                <small>{k.hint}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
      {!adding && (
        <button type="button" className="link-btn small" onClick={() => setAdding(true)}>
          <Plus size={13} /> {t('Add a step')}
        </button>
      )}
    </div>
  );
}

/* ---------- button settings (inside a Button field's settings) ---------- */

export function ButtonSettings({ field, t: tb, tables, users, channels, onChange }: { field: TableField; t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; onChange: (b: ButtonDef) => void }) {
  const b: ButtonDef = field.button ?? { label: field.name || t('Run'), actions: [] };
  const set = (p: Partial<ButtonDef>) => onChange({ ...b, ...p });
  const sw = b.showWhen;
  const swField = tb.fields.find((f) => f.id === sw?.fieldId);
  return (
    <div className="tb-btn-set">
      <div className="tb-act-row">
        <span className="tb-act-label">{t('Label')}</span>
        <input className="tb-native" value={b.label} onChange={(e) => set({ label: e.target.value })} placeholder={t('Send to dialer')} />
      </div>
      <div className="tb-act-row">
        <span className="tb-act-label">{t('Colour')}</span>
        <div className="tb-colors">
          {OPTION_COLORS.map((c) => (
            <button key={c} type="button" className={`tb-dot big${(b.color ?? OPTION_COLORS[1]) === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
          ))}
        </div>
      </div>
      <span className="tb-fm-label">{t('When pressed')}</span>
      <ActionsEditor t={tb} tables={tables} users={users} channels={channels} actions={b.actions} onChange={(actions) => set({ actions })} />
      <span className="tb-fm-label">{t('Options')}</span>
      <label className="check-row">
        <input type="checkbox" checked={!!b.confirm} onChange={(e) => set({ confirm: e.target.checked })} /> {t('Ask “Are you sure?” first')}
      </label>
      <label className="check-row">
        <input type="checkbox" checked={b.who === 'admins'} onChange={(e) => set({ who: e.target.checked ? 'admins' : 'team' })} /> {t('Only admins can press it')}
      </label>
      <div className="tb-act-row">
        <span className="tb-act-label">{t('Ask for')}</span>
        <PickSelect value="" aria-label={t('Fill in first')} onChange={(e) => e.target.value && set({ ask: [...(b.ask ?? []), e.target.value] })}>
          <option value="">{b.ask?.length ? t('+ Another field') : t('Nothing (runs straight away)')}</option>
          {tb.fields.filter((f, i) => i > 0 && !['button', 'link'].includes(f.type) && !b.ask?.includes(f.id)).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </PickSelect>
      </div>
      {b.ask?.length ? (
        <div className="tb-chips wrap">
          {b.ask.map((id) => (
            <button key={id} type="button" className="tb-chip linked" onClick={() => set({ ask: b.ask!.filter((x) => x !== id) })} title={t('Remove')}>
              {tb.fields.find((f) => f.id === id)?.name} <X size={11} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="tb-act-row">
        <span className="tb-act-label">{t('Show on')}</span>
        <PickSelect value={sw?.fieldId ?? ''} aria-label={t('Only on rows where')} onChange={(e) => {
          const f = tb.fields.find((x) => x.id === e.target.value);
          set({ showWhen: f ? { fieldId: f.id, op: opsFor(f.type)[0].op } : undefined });
        }}>
          <option value="">{t('Every row')}</option>
          {tb.fields.filter((f) => !['button', 'link'].includes(f.type)).map((f) => (
            <option key={f.id} value={f.id}>
              {t('Rows where {field}…', { field: f.name })}
            </option>
          ))}
        </PickSelect>
      </div>
      {sw && swField && (
        <div className="tb-act-row">
          <PickSelect value={sw.op} aria-label={t('Test')} onChange={(e) => set({ showWhen: { ...sw, op: e.target.value as typeof sw.op } })}>
            {opsFor(swField.type).map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </PickSelect>
          {sw.op !== 'empty' && sw.op !== 'filled' &&
            (swField.options ? (
              <PickSelect value={sw.value ?? ''} aria-label={t('Value')} onChange={(e) => set({ showWhen: { ...sw, value: e.target.value } })}>
                <option value="">{t('Choose…')}</option>
                {swField.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </PickSelect>
            ) : (
              <input className="tb-native" value={sw.value ?? ''} aria-label={t('Value')} onChange={(e) => set({ showWhen: { ...sw, value: e.target.value } })} />
            ))}
        </div>
      )}
    </div>
  );
}

/* ---------- the Automations panel: data in, rules, the log ---------- */

export function AutomationsPanel({ t: tb, tables, users, channels, onPatch, onClose, toast }: { t: DataTable; tables: DataTable[]; users: User[]; channels: Channel[]; onPatch: (p: Partial<DataTable>) => void; onClose: () => void; toast: (text: string) => void }) {
  const [tab, setTab] = useState<'in' | 'rules' | 'log'>('in');
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.pop') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const intake = tb.intake;
  const url = intake ? `${location.origin}/api/hooks/${intake.token}` : '';
  const setIntake = (p: Partial<TableIntake>) => onPatch({ intake: { ...(intake ?? { token: secret(), enabled: true, mapping: {} }), ...p } });
  const copy = (text: string, what: string) => void navigator.clipboard?.writeText(text).then(() => toast(t('{what} copied', { what })));
  const rules = tb.rules ?? [];
  const setRule = (id: string, p: Partial<TableRule>) => onPatch({ rules: rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRule = () => {
    const r: TableRule = { id: uid(), name: t('New rule'), on: 'created', actions: [], enabled: true };
    onPatch({ rules: [...rules, r] });
    setEditing(r.id);
  };
  // A variable as a field: a new field named after it, of the kind its value looks like, mapped straight away.
  const newFieldFor = (k: string) => {
    if (!intake) return;
    const name = humanize(k);
    const f: TableField = { id: uid(), name, type: guessType(name, [String(intake.sample?.[k] ?? '')]) };
    if (f.type === 'money') f.currency = 'IDR';
    onPatch({ fields: [...tb.fields, f], intake: { ...intake, mapping: { ...intake.mapping, [k]: f.id } } });
  };
  // The latest test's keys are what matter; keys matched from earlier tests stay, folded away.
  const latestKeys = Object.keys(intake?.sample ?? {});
  const olderKeys = Object.keys(intake?.mapping ?? {}).filter((k) => intake?.mapping[k] && !latestKeys.includes(k));
  const [showOlder, setShowOlder] = useState(false);
  const [showCurl, setShowCurl] = useState(false);
  const mapRow = (k: string) => {
    if (!intake) return null;
    const v = intake.sample?.[k];
    const shown = v != null && v !== '' ? (typeof v === 'object' ? JSON.stringify(v) : String(v)) : '';
    return (
      <div key={k} className={`tb-maptable-row${intake.mapping[k] ? '' : ' skip'}`} role="row">
        <code role="cell" title={k}>
          {k}
        </code>
        <span role="cell" className={`tb-map-sample${shown ? '' : ' muted'}`} title={shown}>
          {shown ? shown.slice(0, 80) : latestKeys.includes(k) ? tx('sample', 'empty') : t('not in the latest test')}
        </span>
        <span role="cell">
          <PickSelect value={intake.mapping[k] ?? ''} aria-label={t('Field for {key}', { key: k })} onChange={(e) => (e.target.value === '__new' ? newFieldFor(k) : setIntake({ mapping: { ...intake.mapping, [k]: e.target.value } }))}>
            <option value="">{t('Skip')}</option>
            {tb.fields.filter((f) => !['button', 'link'].includes(f.type) && !isComputed(f)).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="__new">{t('+ New field “{name}”', { name: humanize(k) })}</option>
          </PickSelect>
        </span>
      </div>
    );
  };
  const example = JSON.stringify(Object.fromEntries(tb.fields.filter((f) => !['button', 'link'].includes(f.type)).slice(0, 4).map((f) => [f.name.toLowerCase().replace(/\W+/g, '_'), f.type === 'email' ? 'nina@example.com' : f.type === 'phone' ? '+62 812 0000 0000' : f.type === 'money' || f.type === 'number' ? 1000000 : f.options?.[0]?.label ?? t('Example {field}', { field: f.name.toLowerCase() })])), null, 2);

  const failed = (tb.log ?? []).filter((e) => !e.ok).length;
  const sections: { id: typeof tab; label: string; icon: typeof Zap; meta?: string; bad?: boolean }[] = [
    { id: 'in', label: t('Data coming in'), icon: ArrowDownLeft, meta: intake?.enabled ? t('On') : intake ? t('Not on yet') : undefined },
    { id: 'rules', label: t('Rules'), icon: Zap, meta: rules.length ? t('{n} on', { n: rules.filter((r) => r.enabled).length }) : undefined },
    { id: 'log', label: t('Log'), icon: ScrollText, meta: failed ? t('{n} failed', { n: failed }) : undefined, bad: failed > 0 },
  ];

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal big-modal tb-auto" role="dialog" aria-label={t('Automations for {name}', { name: tb.name })} onMouseDown={(e) => e.stopPropagation()}>
        <header className="big-head">
          <Zap size={15} />
          <strong>{t('Automations')}</strong>
          <span className="muted">{tb.name}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </header>
        <div className="big-body">
          <nav className="big-nav" aria-label={t('Sections')}>
            {sections.map(({ id, label, icon: I, meta, bad }) => (
              <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                <I size={15} />
                <span>{label}</span>
                {meta && <small className={bad ? 'bad' : ''}>{meta}</small>}
              </button>
            ))}
          </nav>
          <div className="big-main">
          <TabPane key={tab}>
            {tab === 'in' && (
              <div className="tb-auto-sec">
                <p className="muted small">{t('Leads from Facebook, Zapier, Make, a website form or your own scripts can land in this table. Give them this table’s address, send one test, then match what arrives to fields.')}</p>
                <ol className="tb-steps">
                  <li className={intake ? 'done' : 'now'}>
                    <span className="tb-step-n">{intake ? <Check size={12} /> : 1}</span>
                    <div>
                      <strong>{t('Your webhook address')}</strong>
                      {!intake ? (
                        <button className="primary-btn sm" onClick={() => setIntake({ enabled: false, listening: true, listenFrom: new Date().toISOString() })}>
                          <ArrowDownLeft size={14} /> {t('Make the address')}
                        </button>
                      ) : (
                        <>
                          <div className="tb-url">
                            <code>{url}</code>
                            <button className="icon-btn sm" onClick={() => copy(url, t('Address'))} aria-label={t('Copy address')}>
                              <Copy size={14} />
                            </button>
                          </div>
                          <button className="link-btn small" onClick={() => confirm(t('Make a new address? The old one stops working straight away, so update anything that posts to it.')) && setIntake({ token: secret() })}>
                            <RefreshCw size={12} /> {t('New address')}
                          </button>
                        </>
                      )}
                    </div>
                  </li>

                  <li className={!intake ? '' : intake.listening ? 'now' : intake.sample ? 'done' : 'now'}>
                    <span className="tb-step-n">{intake?.sample && !intake.listening ? <Check size={12} /> : 2}</span>
                    <div>
                      <strong>{tx('webhook', 'Send a test')}</strong>
                      {intake?.listening ? (
                        <div className="tb-listen">
                          <span className="tb-spin" aria-hidden />
                          <span>
                            {t('Waiting for a test… Send something to the address now: from Zapier or Make, a test lead from your form, or anywhere that sends webhooks. Nothing is added to the table; it’s only to see what arrives.')}
                          </span>
                          <button className="link-btn small" onClick={() => setIntake({ listening: false })}>
                            {t('Stop')}
                          </button>
                        </div>
                      ) : intake ? (
                        <div className="tb-act-row">
                          <button className={intake.sample ? 'ghost-btn sm' : 'primary-btn sm'} onClick={() => setIntake({ listening: true, listenFrom: new Date().toISOString() })}>
                            <ArrowDownLeft size={14} /> {intake.sample ? t('Listen for another test') : t('Listen for a test')}
                          </button>
                          {intake.testAt && <span className="muted small">{t('Last test {when}', { when: relative(intake.testAt) })}</span>}
                        </div>
                      ) : (
                        <p className="muted small">{t('After the address.')}</p>
                      )}
                      {intake && (
                        <div className="tb-try">
                          <button type="button" className="link-btn small" onClick={() => setShowCurl((x) => !x)}>
                            <ChevronRight size={13} className={`rot-chev ${showCurl ? 'open' : ''}`} /> {t('Or send one yourself')}
                          </button>
                          <div className={`fold ${showCurl ? 'open' : ''}`}>
                            <div className="fold-in">
                          <div className="tb-url">
                            <code className="block">{`curl -X POST ${url} \\\n  -H "content-type: application/json" \\\n  -d '${example.replace(/\n\s*/g, ' ')}'`}</code>
                            <button className="icon-btn sm" onClick={() => copy(`curl -X POST ${url} -H "content-type: application/json" -d '${example.replace(/\n\s*/g, ' ')}'`, t('Example'))} aria-label={t('Copy example')}>
                              <Copy size={14} />
                            </button>
                          </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>

                  <li className={!intake?.sample ? '' : intake.enabled ? 'done' : 'now'}>
                    <span className="tb-step-n">{intake?.enabled && intake.sample ? <Check size={12} /> : 3}</span>
                    <div>
                      <strong>{t('Match what arrived to fields')}</strong>
                      {intake && (latestKeys.length || olderKeys.length) ? (
                        <>
                          <div className="tb-maptable" role="table" aria-label={t('Match values to fields')}>
                            <div className="tb-maptable-row head" role="row">
                              <span role="columnheader">{t('Arrived as')}</span>
                              <span role="columnheader">{t('In the latest test')}</span>
                              <span role="columnheader">{t('Goes into')}</span>
                            </div>
                            {latestKeys.map(mapRow)}
                          </div>
                          {olderKeys.length > 0 && (
                            <>
                              <button type="button" className="link-btn small tb-older" onClick={() => setShowOlder((x) => !x)}>
                                <ChevronRight size={13} className={`rot-chev ${showOlder ? 'open' : ''}`} />
                                {tn(olderKeys.length, '{n} matched from earlier tests', '{n} matched from earlier tests')}
                              </button>
                              <div className={`fold ${showOlder ? 'open' : ''}`}>
                                <div className="fold-in">
                                  <div className="tb-maptable" role="table" aria-label={t('Matched from earlier tests')}>
                                    {olderKeys.map(mapRow)}
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="muted small">{t('The values from your test appear here, each with what it contained, to put into the right field.')}</p>
                      )}
                    </div>
                  </li>

                  <li className={intake?.enabled ? 'done' : intake?.sample ? 'now' : ''}>
                    <span className="tb-step-n">{intake?.enabled ? <Check size={12} /> : 4}</span>
                    <div>
                      <strong>{t('Turn it on')}</strong>
                      {intake && (
                        <div className="tb-act-row">
                          <span className="tb-act-label">{t('Duplicates')}</span>
                          <PickSelect value={intake.dedupeField ?? ''} aria-label={t('Duplicates')} onChange={(e) => setIntake({ dedupeField: e.target.value || undefined })}>
                            <option value="">{t('Always add a new row')}</option>
                            {tb.fields.filter((f) => ['text', 'email', 'phone', 'url', 'number'].includes(f.type)).map((f) => (
                              <option key={f.id} value={f.id}>
                                {t('Same {field} updates that row', { field: f.name.toLowerCase() })}
                              </option>
                            ))}
                          </PickSelect>
                        </div>
                      )}
                      {intake?.enabled ? (
                        <div className="tb-act-row">
                          <span className="tb-on-dot" aria-hidden />
                          <span className="small">{t('On: every delivery adds a row.')}</span>
                          <span className="spacer" />
                          <button className="link-btn small" onClick={() => setIntake({ enabled: false })}>
                            {t('Pause')}
                          </button>
                        </div>
                      ) : (
                        <button className="primary-btn sm" disabled={!intake?.sample || !Object.values(intake.mapping).some(Boolean)} onClick={() => setIntake({ enabled: true, listening: false })}>
                          {t('Save and turn on')}
                        </button>
                      )}
                    </div>
                  </li>
                </ol>

              </div>
            )}

            {tab === 'rules' && (
              <div className="tb-auto-sec">
                <p className="muted small">{t('Rules run the same steps as buttons, by themselves: when a row is added, changed, or a field becomes a value.')}</p>
                {rules.map((r) => {
                  const f = tb.fields.find((x) => x.id === r.fieldId);
                  const open = editing === r.id;
                  const when = r.on === 'schedule' ? scheduleText(r) : r.on === 'created' ? t('When a row is added') : r.on === 'updated' ? t('When a row changes') : t('When {field} becomes {value}', { field: f?.name ?? t('a field'), value: f?.options?.find((o) => o.id === r.value)?.label ?? (f?.type === 'checkbox' ? (r.value === 'yes' ? t('checked') : t('unchecked')) : r.value || '…') });
                  return (
                    <div key={r.id} className={`tb-rule${r.enabled ? '' : ' off'}`}>
                      <header>
                        <input type="checkbox" checked={r.enabled} aria-label={t('On')} onChange={(e) => setRule(r.id, { enabled: e.target.checked })} />
                        <button type="button" className="tb-rule-head" onClick={() => setEditing(open ? null : r.id)}>
                          <strong>{r.name}</strong>
                          <small className="muted">
                            {when} · {r.actions.length ? r.actions.map((a) => actionSummary(a, tb, tables, users, channels)).join(', ') : t('no steps yet')}
                          </small>
                        </button>
                        <button type="button" className="icon-btn sm" aria-label={t('Delete rule')} onClick={() => confirm(t('Delete the rule “{name}”?', { name: r.name })) && onPatch({ rules: rules.filter((x) => x.id !== r.id) })}>
                          <Trash2 size={14} />
                        </button>
                      </header>
                      <div className={`fold ${open ? 'open' : ''}`}>
                        <div className="fold-in tb-rule-body">
                          <input className="tb-native" value={r.name} aria-label={t('Rule name')} onChange={(e) => setRule(r.id, { name: e.target.value })} />
                          <div className="tb-act-row">
                            <span className="tb-act-label">{t('When')}</span>
                            <PickSelect value={r.on} aria-label={t('When')} onChange={(e) => {
                              const on = e.target.value as TableRule['on'];
                              setRule(r.id, { on, ...(on === 'schedule' && !r.schedule ? { schedule: { days: [1, 2, 3, 4, 5], hour: 9, tz: deviceTz() } } : {}) });
                            }}>
                              <option value="created">{t('A row is added')}</option>
                              <option value="updated">{t('A row changes')}</option>
                              <option value="becomes">{t('A field becomes…')}</option>
                              <option value="schedule">{t('On a schedule…')}</option>
                            </PickSelect>
                          </div>
                          {r.on === 'schedule' && (
                            <ScheduleEditor
                              t={tb}
                              users={users}
                              rule={r}
                              onChange={(p) => setRule(r.id, p)}
                            />
                          )}
                          {r.on === 'becomes' && (
                            <div className="tb-act-row">
                              <PickSelect value={r.fieldId ?? ''} aria-label={t('Field')} onChange={(e) => setRule(r.id, { fieldId: e.target.value, value: undefined })}>
                                <option value="">{t('Pick a field')}</option>
                                {tb.fields.filter((x) => ['select', 'multi', 'checkbox', 'text', 'person'].includes(x.type)).map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name}
                                  </option>
                                ))}
                              </PickSelect>
                              {f &&
                                (f.options ? (
                                  <PickSelect value={r.value ?? ''} aria-label={t('Value')} onChange={(e) => setRule(r.id, { value: e.target.value })}>
                                    <option value="">{t('Choose…')}</option>
                                    {f.options.map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </PickSelect>
                                ) : f.type === 'checkbox' ? (
                                  <PickSelect value={r.value ?? 'yes'} aria-label={t('Value')} onChange={(e) => setRule(r.id, { value: e.target.value })}>
                                    <option value="yes">{t('Checked')}</option>
                                    <option value="no">{t('Unchecked')}</option>
                                  </PickSelect>
                                ) : f.type === 'person' ? (
                                  <PersonSelect value={r.value ?? ''} users={users} label={t('Value')} onChange={(v) => setRule(r.id, { value: v })} />
                                ) : (
                                  <input className="tb-native" value={r.value ?? ''} aria-label={t('Value')} onChange={(e) => setRule(r.id, { value: e.target.value })} />
                                ))}
                            </div>
                          )}
                          <span className="tb-fm-label">{t('Then')}</span>
                          <ActionsEditor t={tb} tables={tables} users={users} channels={channels} actions={r.actions} onChange={(actions) => setRule(r.id, { actions })} forRule />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button className="ghost-btn sm" onClick={addRule}>
                  <Plus size={13} /> {t('Add a rule')}
                </button>
                <h4 className="tb-auto-h">
                  <KeyRound size={13} /> {t('Signing webhooks this table sends')}
                </h4>
                <p className="muted small">{tj('Webhooks sent by buttons and rules carry an {header} header: an HMAC-SHA256 of the body with this secret, so the other side can check it came from you.', { header: <code>X-sprint2go-Signature</code> })}</p>
                {tb.signingSecret ? (
                  <div className="tb-url">
                    <code>{tb.signingSecret.slice(0, 6)}••••••••••••</code>
                    <button className="icon-btn sm" onClick={() => copy(tb.signingSecret!, t('Secret'))} aria-label={t('Copy secret')}>
                      <Copy size={14} />
                    </button>
                    <button className="icon-btn sm" onClick={() => confirm(t('Make a new secret? Receivers checking the old one will reject webhooks until updated.')) && onPatch({ signingSecret: secret(32) })} aria-label={t('New secret')}>
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : (
                  <button className="ghost-btn sm" onClick={() => onPatch({ signingSecret: secret(32) })}>
                    {t('Make a signing secret')}
                  </button>
                )}
              </div>
            )}

            {tab === 'log' && (
              <div className="tb-auto-sec">
                {(tb.log ?? []).length ? (
                  <ul className="tb-log">
                    {[...tb.log!].reverse().map((e, i) => (
                      <li key={i} className={e.ok ? '' : 'bad'}>
                        {e.dir === 'in' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                        <span>{textOf(e)}</span>
                        <time className="muted small">{relative(e.at)}</time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{t('Nothing yet. Deliveries coming in, webhooks going out and rules that ran show here (the last 50).')}</p>
                )}
              </div>
            )}
          </TabPane>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A day's short name, 0 is Sunday: Mon / Sen. */
const day = (d: number) => weekdayName(d, 'short');
/** An hour as the time fields write it: 09:00 / 09.00. */
const hour = (h: number) => fmtTime(new Date(2026, 0, 1, h, 0));
/** "Weekdays at 09:00, every row" */
function scheduleText(r: TableRule) {
  const sc = r.schedule;
  if (!sc?.days.length) return t('On a schedule (no days picked)');
  const days = sc.days.length === 7 ? t('Every day') : [1, 2, 3, 4, 5].every((d) => sc.days.includes(d)) && sc.days.length === 5 ? t('Weekdays') : sc.days.map(day).join(', ');
  return r.where?.length ? tn(r.where.length, '{days} at {time}, rows matching {n} condition', '{days} at {time}, rows matching {n} conditions', { days, time: hour(sc.hour) }) : t('{days} at {time}, every row', { days, time: hour(sc.hour) });
}

/** When a scheduled rule runs, and on which rows. */
function ScheduleEditor({ t: tb, users, rule, onChange }: { t: DataTable; users: User[]; rule: TableRule; onChange: (p: Partial<TableRule>) => void }) {
  const sc = rule.schedule ?? { days: [1, 2, 3, 4, 5], hour: 9, tz: deviceTz() };
  const set = (p: Partial<typeof sc>) => onChange({ schedule: { ...sc, ...p } });
  const where = rule.where ?? [];
  const setWhere = (w: typeof where) => onChange({ where: w });
  return (
    <div className="tb-sched">
      <div className="tb-act-row">
        <span className="tb-act-label">{t('Days')}</span>
        <div className="tb-days">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" className={sc.days.includes(d) ? 'on' : ''} aria-pressed={sc.days.includes(d)} onClick={() => set({ days: sc.days.includes(d) ? sc.days.filter((x) => x !== d) : [...sc.days, d] })}>
              {day(d)}
            </button>
          ))}
        </div>
      </div>
      <div className="tb-act-row">
        <span className="tb-act-label">{t('At')}</span>
        <PickSelect value={sc.hour} aria-label={t('Hour')} onChange={(e) => set({ hour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {hour(h)}
            </option>
          ))}
        </PickSelect>
        <span className="muted small">{sc.tz}</span>
      </div>
      <span className="tb-fm-label">{t('For rows where')}</span>
      {where.map((w, i) => {
        const f = tb.fields.find((x) => x.id === w.fieldId) ?? tb.fields[0];
        const needs = w.op !== 'empty' && w.op !== 'filled';
        return (
          <div key={i} className="tb-act-row">
            <PickSelect value={f.id} aria-label={t('Field')} onChange={(e) => {
              const nf = tb.fields.find((x) => x.id === e.target.value)!;
              setWhere(where.map((x, j) => (j === i ? { fieldId: nf.id, op: opsFor(nf.type)[0].op } : x)));
            }}>
              {tb.fields.filter((x) => x.type !== 'button').map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </PickSelect>
            <PickSelect value={w.op} aria-label={t('Test')} onChange={(e) => setWhere(where.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof w.op } : x)))}>
              {opsFor(f.type).map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </PickSelect>
            {needs &&
              (f.options ? (
                <PickSelect value={w.value ?? ''} aria-label={t('Value')} onChange={(e) => setWhere(where.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                  <option value="">{t('Choose…')}</option>
                  {f.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </PickSelect>
              ) : f.type === 'person' ? (
                <PersonSelect value={w.value ?? ''} users={users} label={t('Value')} onChange={(v) => setWhere(where.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
              ) : f.type === 'date' ? (
                <PickSelect value={w.value ?? '@today'} aria-label={t('Value')} onChange={(e) => setWhere(where.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                  <option value="@today">{t('today (when it runs)')}</option>
                </PickSelect>
              ) : (
                <input className="tb-native" value={w.value ?? ''} aria-label={t('Value')} onChange={(e) => setWhere(where.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              ))}
            <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => setWhere(where.filter((_, j) => j !== i))}>
              <X size={13} />
            </button>
          </div>
        );
      })}
      <button type="button" className="link-btn small" onClick={() => {
        const d = tb.fields.find((x) => x.type === 'date');
        setWhere([...where, d ? { fieldId: d.id, op: 'lt', value: '@today' } : { fieldId: tb.fields[0].id, op: 'filled' }]);
      }}>
        <Plus size={13} /> {where.length ? t('Another condition') : t('Only some rows (every row otherwise)')}
      </button>
    </div>
  );
}
