// Tables on the server: what buttons and rules do, data arriving at a table's own URL, and webhooks out.
// One engine for all of them, so a button, a rule and an incoming lead behave the same way.
import { createHmac, randomBytes } from 'node:crypto';
import * as db from './db.ts';
import { cellText, guessField, isEmpty, parseIncoming, passes, rowName, valueOf } from '../src/components/tables/core.ts';
import type { CellValue, DataTable, TableAction, TableField, TableLogEntry, TableRow, User } from '../src/types.ts';
import { stageIdFor, stagesFrom } from '../src/stages.ts';
import { companyTz } from '../src/jobTimes.ts';

export interface Env {
  broadcast: (coll: string, upserts: db.Doc[], deletes: string[]) => void;
}
export interface RunResult {
  ok: boolean;
  note: string;
  open?: string; // a link for the browser to open
  compose?: { to: string; subject: string; body: string }; // an email for the browser to open, filled in
}

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + randomBytes(5).toString('hex');
const tables = () => db.allDocs('tables') as unknown as DataTable[];
const rows = () => db.allDocs('rows') as unknown as TableRow[];
const usersOf = (wsId: string): User[] => {
  const ws = db.getDoc('workspaces', wsId) as any;
  const ids = new Set((ws?.members ?? []).map((m: any) => m.userId));
  return (db.allDocs('users') as any[]).filter((u) => ids.has(u.id));
};
function save(env: Env, coll: string, docs: unknown[], deletes: string[] = []) {
  db.writeDocs(coll, docs as db.Doc[], deletes, null);
  env.broadcast(coll, docs as db.Doc[], deletes);
}
const nameOf = (id: string) => {
  const r = rows().find((x) => x.id === id);
  const t = r && tables().find((x) => x.id === r.tableId);
  return t ? rowName(t, r) : '';
};
const textOf = (f: TableField, v: CellValue | undefined, users: User[]) => cellText(f, v, { users, rowName: nameOf });
/** A row's value for a field, formulas and rollups worked out. */
const val = (t: DataTable, f: TableField, r: TableRow, users: User[]) => valueOf(t, f, r, { users, rowName: nameOf, rows: rows(), tables: tables() });

/** {Field name} in text becomes the row's value (URL-encoded inside links). */
export function fill(template: string, t: DataTable, r: TableRow, users: User[], encode = false) {
  return template.replace(/\{([^{}]+)\}/g, (all, name: string) => {
    const f = t.fields.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!f) return all;
    const v = f.type === 'phone' ? String(r.values[f.id] ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^0/, '62') : textOf(f, val(t, f, r, users), users);
    return encode ? encodeURIComponent(v) : v;
  });
}

/** "@me" is whoever pressed; a person field's id is the person in that cell; anything else is a user id. */
function personFrom(spec: string | undefined, t: DataTable, r: TableRow, me: string): string | null {
  if (!spec) return null;
  if (spec === '@me') return me;
  const f = t.fields.find((x) => x.id === spec);
  if (f) return typeof r.values[f.id] === 'string' ? (r.values[f.id] as string) : null;
  return spec;
}

/** A value set by an action, with @today / @now / @me filled in. */
function resolve(v: CellValue, me: string): CellValue {
  if (v === '@today' || v === '@now') return today();
  if (v === '@me') return me;
  return v;
}

/** A row with some values changed, its history and time updated. */
function changed(r: TableRow, values: Record<string, CellValue>, by: string): TableRow {
  const history = [...(r.history ?? [])];
  for (const [k, v] of Object.entries(values)) {
    const from = r.values[k] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(v)) history.push({ by, at: now(), fieldId: k, from, to: v });
  }
  return { ...r, values: { ...r.values, ...values }, updatedAt: now(), history: history.slice(-50) };
}

/** A value from one table's field, fitted to another table's field of the same name (choices by label). */
function fit(from: TableField, to: TableField, v: CellValue | undefined, users: User[]): CellValue {
  if (isEmpty(v)) return null;
  if (from.type === to.type && from.type !== 'select' && from.type !== 'multi' && from.type !== 'link') return v as CellValue;
  const text = textOf(from, v, users);
  if (to.type === 'select') return to.options?.find((o) => o.label.toLowerCase() === text.toLowerCase())?.id ?? null;
  if (to.type === 'multi') return text.split(', ').map((l) => to.options?.find((o) => o.label.toLowerCase() === l.toLowerCase())?.id).filter(Boolean) as string[];
  if (to.type === 'number' || to.type === 'money') return Number.isFinite(Number(v)) ? Number(v) : null;
  if (to.type === 'checkbox') return !!v;
  if (to.type === 'person') return from.type === 'person' ? (v as string) : null;
  if (to.type === 'link' || to.type === 'button') return null;
  return text || null;
}

/** This row's values for another table: fields with the same name carry across. */
function carry(t: DataTable, r: TableRow, target: DataTable, users: User[]) {
  const out: Record<string, CellValue> = {};
  for (const tf of target.fields) {
    const sf = t.fields.find((f) => f.name.toLowerCase() === tf.name.toLowerCase()) ?? (tf === target.fields[0] ? t.fields[0] : undefined);
    if (sf) {
      const v = fit(sf, tf, r.values[sf.id], users);
      if (!isEmpty(v)) out[tf.id] = v;
    }
  }
  return out;
}

const newRow = (target: DataTable, values: Record<string, CellValue>, by: string): TableRow => ({
  id: uid(),
  workspaceId: target.workspaceId,
  tableId: target.id,
  values,
  order: Math.max(0, ...rows().filter((x) => x.tableId === target.id).map((x) => x.order)) + 1,
  createdBy: by,
  createdAt: now(),
  updatedAt: now(),
});

/** Adds a line to the table's delivery log (the last 50 are kept). */
function logTo(env: Env, tableId: string, e: Omit<TableLogEntry, 'at'>) {
  const t = db.getDoc('tables', tableId) as unknown as DataTable | undefined;
  if (!t) return;
  save(env, 'tables', [{ ...t, log: [...(t.log ?? []), { ...e, at: now() }].slice(-50) }]);
}

/* ---------- webhooks out ---------- */

/** What a webhook sends: the row by field name (or the keys you chose), signed with the table's secret. */
export function hookPayload(t: DataTable, r: TableRow, a: Extract<TableAction, { kind: 'webhook' }>, event: string, users: User[]) {
  const data: Record<string, unknown> = {};
  const pick = a.fields?.length ? a.fields.map((x) => ({ f: t.fields.find((f) => f.id === x.fieldId), key: x.key })) : t.fields.filter((f) => f.type !== 'button').map((f) => ({ f, key: f.name }));
  for (const { f, key } of pick) {
    if (!f) continue;
    const v = val(t, f, r, users);
    data[key] = f.type === 'files' ? ((v as { name: string }[] | null) ?? []).map((x) => x.name) : (f.type === 'formula' || f.type === 'rollup') && typeof v === 'number' ? v : f.type === 'number' || f.type === 'money' || f.type === 'checkbox' ? (isEmpty(v) && f.type !== 'checkbox' ? null : v ?? false) : textOf(f, v, users) || null;
  }
  return { event, table: { id: t.id, name: t.name }, row: { id: r.id }, data, sentAt: now() };
}

const dig = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Sends one webhook, retrying network errors and server errors (1s, 4s, 10s). Returns the reply. */
export async function sendHook(t: DataTable, url: string, payload: unknown): Promise<{ ok: boolean; status: number; reply: unknown; note: string }> {
  if (!/^https?:\/\//.test(url)) return { ok: false, status: 0, reply: null, note: 'The webhook address must start with https://' };
  const body = JSON.stringify(payload);
  const sig = t.signingSecret ? createHmac('sha256', t.signingSecret).update(body).digest('hex') : '';
  const waits = [0, 1000, 4000, 10000];
  let last = { ok: false, status: 0, reply: null as unknown, note: '' };
  for (const w of waits) {
    if (w) await new Promise((r) => setTimeout(r, w));
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'sprint2go-Webhooks', ...(sig ? { 'x-sprint2go-signature': `sha256=${sig}` } : {}) }, body, signal: AbortSignal.timeout(10_000) });
      const text = await res.text().catch(() => '');
      let reply: unknown = text;
      try {
        reply = JSON.parse(text);
      } catch {
        /* not JSON: keep the text */
      }
      last = { ok: res.ok, status: res.status, reply, note: res.ok ? `Sent (${res.status})` : `The other side said ${res.status}` };
      if (res.ok || (res.status < 500 && res.status !== 429)) return last;
    } catch (err) {
      last = { ok: false, status: 0, reply: null, note: err instanceof Error && err.name === 'TimeoutError' ? 'No answer within 10 seconds' : 'Couldn’t reach the address' };
    }
  }
  return { ...last, note: `${last.note}, after 4 tries` };
}

/* ---------- actions ---------- */

async function runAction(env: Env, a: TableAction, t: DataTable, r0: TableRow, me: string, depth: number, event: string): Promise<RunResult> {
  const users = usersOf(t.workspaceId);
  const r = (db.getDoc('rows', r0.id) as unknown as TableRow | undefined) ?? r0; // the latest, after earlier actions
  switch (a.kind) {
    case 'set': {
      const values = Object.fromEntries(Object.entries(a.values).map(([k, v]) => [k, resolve(v, me)]));
      const next = changed(r, values, me);
      save(env, 'rows', [next]);
      afterRowWrite(env, new Map([[r.id, r]]), [next], me, depth + 1);
      const names = Object.keys(values).map((k) => t.fields.find((f) => f.id === k)?.name).filter(Boolean);
      return { ok: true, note: `Set ${names.join(', ')}` };
    }
    case 'copy':
    case 'move':
    case 'linked': {
      const target = tables().find((x) => x.id === a.tableId && x.workspaceId === t.workspaceId);
      if (!target) return { ok: false, note: 'The other table is gone' };
      const values = carry(t, r, target, users);
      if (a.kind === 'linked') {
        const lf = target.fields.find((f) => f.id === a.linkFieldId) ?? target.fields.find((f) => f.type === 'link' && f.linkTable === t.id);
        if (lf) values[lf.id] = [r.id];
      }
      const made = newRow(target, values, me);
      save(env, 'rows', [made]);
      afterRowWrite(env, new Map(), [made], me, depth + 1);
      if (a.kind === 'move') save(env, 'rows', [], [r.id]);
      return { ok: true, note: a.kind === 'move' ? `Moved to ${target.name}` : a.kind === 'copy' ? `Copied to ${target.name}` : `Added to ${target.name}` };
    }
    case 'task': {
      const who = personFrom(a.assignee, t, r, me) ?? '';
      const due = a.dueDays != null ? new Date(Date.now() + a.dueDays * 86_400_000).toISOString().slice(0, 10) : undefined;
      const title = fill(a.title || 'Follow up {' + t.fields[0].name + '}', t, r, users).slice(0, 200);
      // The project's own stages when the table belongs to one that has them, else the company's.
      const stages = stagesFrom({ client: t.clientId ? (db.getDoc('clients', t.clientId) as any) : null, workspace: db.getDoc('workspaces', t.workspaceId) as any });
      const task = { id: uid(), title, userId: who, assignees: who ? [who] : [], due, done: false, status: stageIdFor(t, 'open', stages), priority: 'normal', source: 'manual', workspaceId: t.workspaceId, clientId: t.clientId, createdBy: me, createdAt: now(), notes: `From ${t.name}: ${rowName(t, r)}`, history: [{ id: uid(), at: now(), by: me, kind: 'created' }] };
      save(env, 'todos', [task]);
      if (who && who !== me) save(env, 'notices', [{ id: uid(), userId: who, workspaceId: t.workspaceId, kind: 'task', text: `New task: ${title}`, at: now(), read: false, link: { app: 'tasks', id: task.id } }]);
      return { ok: true, note: `Task made${who ? ` for ${users.find((u) => u.id === who)?.name.split(' ')[0] ?? 'someone'}` : ''}` };
    }
    case 'email': {
      const f = t.fields.find((x) => x.id === a.toField) ?? t.fields.find((x) => x.type === 'email');
      const to = f ? String(r.values[f.id] ?? '') : '';
      return { ok: true, note: to ? `Email to ${to} opened` : 'Email opened', compose: { to, subject: fill(a.subject, t, r, users), body: fill(a.body, t, r, users) } };
    }
    case 'chat': {
      const ch = db.getDoc('channels', a.channelId) as any;
      if (!ch || ch.workspaceId !== t.workspaceId) return { ok: false, note: 'That channel is gone' };
      save(env, 'messages', [{ id: uid(), channelId: ch.id, userId: me, text: fill(a.text, t, r, users), at: now(), kind: 'message' }]);
      return { ok: true, note: `Posted in #${ch.name}` };
    }
    case 'notify': {
      const who = personFrom(a.who, t, r, me);
      if (!who) return { ok: false, note: 'Nobody to tell (the person field is empty)' };
      save(env, 'notices', [{ id: uid(), userId: who, workspaceId: t.workspaceId, kind: 'task', text: fill(a.text, t, r, users), at: now(), read: false, link: { app: 'tables', id: t.id, msg: r.id } }]);
      return { ok: true, note: `Told ${users.find((u) => u.id === who)?.name.split(' ')[0] ?? 'them'}` };
    }
    case 'webhook': {
      const out = await sendHook(t, a.url, hookPayload(t, r, a, event, users));
      logTo(env, t.id, { dir: 'out', ok: out.ok, text: `${event === 'button' ? 'Button' : 'Rule'} sent ${rowName(t, r)} to ${new URL(a.url).host}: ${out.note}`, rowId: r.id });
      // Write what came back into fields, like a record id or a booking link.
      if (out.ok && a.replyTo?.length) {
        const values: Record<string, CellValue> = {};
        for (const m of a.replyTo) {
          const v = dig(out.reply, m.path);
          if (v != null && typeof v !== 'object') values[m.fieldId] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
        }
        const cur = db.getDoc('rows', r.id) as unknown as TableRow | undefined;
        if (cur && Object.keys(values).length) save(env, 'rows', [changed(cur, values, me)]);
      }
      return { ok: out.ok, note: out.note };
    }
    case 'open':
      return { ok: true, note: 'Opened', open: fill(a.url, t, r, users, true) };
    case 'assign': {
      // The next person in turn (the turn is remembered per field, so it carries on across rows and days).
      const among = a.among.filter((id) => users.some((u) => u.id === id));
      const f = t.fields.find((x) => x.id === a.fieldId && x.type === 'person');
      if (!f || !among.length) return { ok: false, note: 'Nobody to assign to' };
      const cur = db.getDoc('tables', t.id) as unknown as DataTable;
      const n = (cur.turns?.[f.id] ?? -1) + 1;
      const who = among[n % among.length];
      save(env, 'tables', [{ ...cur, turns: { ...(cur.turns ?? {}), [f.id]: n % among.length } }]);
      const next = changed(r, { [f.id]: who }, me);
      save(env, 'rows', [next]);
      afterRowWrite(env, new Map([[r.id, r]]), [next], me, depth + 1);
      return { ok: true, note: `Assigned to ${users.find((u) => u.id === who)?.name.split(' ')[0] ?? 'someone'}` };
    }
  }
}

/** Presses a button on a row: fills the asked-for fields, then runs its actions in order. */
export async function runButton(env: Env, tableId: string, rowId: string, fieldId: string, me: string, input: Record<string, CellValue> = {}) {
  const t = tables().find((x) => x.id === tableId);
  const r = rows().find((x) => x.id === rowId && x.tableId === tableId);
  const f = t?.fields.find((x) => x.id === fieldId && x.type === 'button');
  if (!t || !r || !f?.button) return { ok: false, results: [{ ok: false, note: 'That button or row is gone' }] as RunResult[] };
  const users = usersOf(t.workspaceId);
  if (f.button.showWhen) {
    const sf = t.fields.find((x) => x.id === f.button!.showWhen!.fieldId);
    if (sf && !passes(f.button.showWhen, sf, r.values[sf.id], { users, rowName: nameOf })) return { ok: false, results: [{ ok: false, note: 'This button doesn’t apply to this row' }] };
  }
  const asked = Object.fromEntries(Object.entries(input).filter(([k]) => f.button!.ask?.includes(k)));
  if (Object.keys(asked).length) {
    const next = changed(r, asked, me);
    save(env, 'rows', [next]);
    afterRowWrite(env, new Map([[r.id, r]]), [next], me, 1);
  }
  const results: RunResult[] = [];
  for (const a of f.button.actions) {
    try {
      results.push(await runAction(env, a, t, r, me, 1, 'button'));
    } catch (err) {
      results.push({ ok: false, note: err instanceof Error ? err.message.slice(0, 120) : 'Something went wrong' });
    }
  }
  const ok = results.every((x) => x.ok);
  const cur = db.getDoc('rows', rowId) as unknown as TableRow | undefined;
  if (cur) save(env, 'rows', [{ ...cur, runs: [...(cur.runs ?? []), { fieldId, at: now(), by: me, ok, note: results.map((x) => x.note).join(' · ') }].slice(-20) }]);
  return { ok, results };
}

/* ---------- rules ---------- */

/**
 * After rows were written (by a person, a webhook, an import or another action): runs the tables' rules.
 * depth stops rules from setting each other off forever.
 */
export function afterRowWrite(env: Env, before: Map<string, TableRow | undefined>, after: TableRow[], by: string, depth = 0) {
  if (depth > 2) return;
  const all = tables();
  for (const r of after) {
    const t = all.find((x) => x.id === r.tableId);
    if (!t) continue;
    const was = before.get(r.id);
    // Someone set you as a row's person (owner, assignee…): you hear about it, unless you did it yourself.
    for (const f of t.fields.filter((x) => x.type === 'person')) {
      const who = r.values[f.id];
      if (typeof who === 'string' && who && who !== by && who !== (was?.values[f.id] ?? null))
        save(env, 'notices', [{ id: uid(), userId: who, workspaceId: t.workspaceId, kind: 'task', text: `${rowName(t, r)} in ${t.name} is yours (${f.name})`, at: now(), read: false, link: { app: 'tables', id: t.id, msg: r.id } }]);
    }
    const rules = (t.rules ?? []).filter((x) => x.enabled && x.actions.length && x.on !== 'schedule');
    if (!rules.length) continue;
    for (const rule of rules) {
      let fire = false;
      if (rule.on === 'created') fire = !was;
      else if (rule.on === 'updated') fire = !!was && JSON.stringify(was.values) !== JSON.stringify(r.values);
      else if (rule.on === 'becomes' && rule.fieldId) {
        const f = t.fields.find((x) => x.id === rule.fieldId);
        const hit = (v: CellValue | undefined) => (f?.type === 'checkbox' ? !!v === (rule.value === 'yes') : Array.isArray(v) ? (v as string[]).includes(rule.value ?? '') : String(v ?? '') === (rule.value ?? ''));
        fire = !!f && hit(r.values[f.id]) && (!was || !hit(was.values[f.id]));
      }
      if (!fire) continue;
      void (async () => {
        const notes: string[] = [];
        for (const a of rule.actions.filter((x) => x.kind !== 'email' && x.kind !== 'open')) {
          const out = await runAction(env, a, t, r, by, depth + 1, 'rule').catch((e) => ({ ok: false, note: String(e?.message ?? e).slice(0, 120) }) as RunResult);
          notes.push(out.note);
        }
        if (rule.actions.some((a) => a.kind !== 'webhook')) logTo(env, t.id, { dir: 'out', ok: true, text: `Rule “${rule.name}” ran on ${rowName(t, r)}: ${notes.join(' · ')}`, rowId: r.id });
      })();
    }
  }
}

/* ---------- data coming in ---------- */

/** {a: {b: 1}, c: [x, y]} -> {"a.b": 1, "c": "x, y"}: every incoming value gets one key to map. */
export function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(obj)) {
    if (obj.every((x) => x == null || typeof x !== 'object')) out[prefix] = obj.join(', ');
    else obj.forEach((x, i) => flatten(x, `${prefix}.${i}`, out));
  } else if (prefix) out[prefix] = obj;
  return out;
}

const hits = new Map<string, number[]>();

/** Data posted to a table's own URL: mapped into a row (or into the matching row, when duplicates are merged). */
export function intake(env: Env, token: string, payload: unknown): { status: number; body: unknown } {
  const t = tables().find((x) => x.intake?.token === token);
  if (!t || !t.intake) return { status: 404, body: { error: 'Unknown address' } };

  const recent = (hits.get(token) ?? []).filter((x) => Date.now() - x < 60_000);
  if (recent.length >= 120) return { status: 429, body: { error: 'Too many deliveries; at most 120 a minute' } };
  hits.set(token, [...recent, Date.now()]);

  const flat = flatten(payload);
  if (!Object.keys(flat).length) {
    logTo(env, t.id, { dir: 'in', ok: false, text: 'A delivery arrived with no data' });
    return { status: 400, body: { error: 'No data' } };
  }
  // Listening for a test: capture what arrived so its variables can be matched to fields; no row yet.
  if (t.intake.listening) {
    const sample = Object.fromEntries(Object.entries(flat).slice(0, 80));
    const mapping = { ...t.intake.mapping };
    for (const k of Object.keys(sample)) if (!(k in mapping)) mapping[k] = guessField(k, t.fields) ?? '';
    save(env, 'tables', [{ ...t, intake: { ...t.intake, listening: false, sample, mapping, testAt: now() }, log: [...(t.log ?? []), { at: now(), dir: 'in' as const, ok: true, text: `Test received: ${Object.keys(sample).length} values to match to fields` }].slice(-50) }]);
    return { status: 200, body: { ok: true, test: true, received: Object.keys(sample) } };
  }
  if (!t.intake.enabled) return { status: 403, body: { error: 'This table isn’t accepting data yet. Finish matching the test delivery to fields, then turn it on.' } };
  const users = usersOf(t.workspaceId);
  // Keys never seen before get their best field by name, remembered so the mapping screen shows them.
  const mapping = { ...t.intake.mapping };
  for (const k of Object.keys(flat)) if (!(k in mapping)) mapping[k] = guessField(k, t.fields) ?? '';
  let fields = t.fields;
  const values: Record<string, CellValue> = {};
  const extra: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(flat)) {
    const f = fields.find((x) => x.id === mapping[k]);
    if (!f) {
      extra[k] = raw;
      continue;
    }
    const { v, field } = parseIncoming(f, raw, users);
    if (field) fields = fields.map((x) => (x.id === field.id ? field : x));
    if (!isEmpty(v)) values[f.id] = v;
  }
  // Duplicates: the same value in the chosen field updates that row instead.
  const dd = t.intake.dedupeField;
  const match = dd && !isEmpty(values[dd]) ? rows().find((r) => r.tableId === t.id && String(r.values[dd] ?? '').toLowerCase() === String(values[dd]).toLowerCase()) : undefined;
  const row = match ? { ...changed(match, values, 'webhook'), extra: { ...(match.extra ?? {}), ...extra } } : { ...newRow({ ...t, fields }, values, 'webhook'), ...(Object.keys(extra).length ? { extra } : {}) };
  const label = rowName({ ...t, fields }, row);
  const nextTable: DataTable = {
    ...t,
    fields,
    intake: { ...t.intake, mapping, sample: Object.fromEntries(Object.entries(flat).slice(0, 60)) },
    log: [...(t.log ?? []), { at: now(), dir: 'in' as const, ok: true, text: match ? `Updated ${label} (same ${t.fields.find((f) => f.id === dd)?.name.toLowerCase()})` : `Added ${label}`, rowId: row.id }].slice(-50),
  };
  save(env, 'tables', [nextTable]);
  save(env, 'rows', [row]);
  afterRowWrite(env, new Map(match ? [[match.id, match]] : []), [row], 'webhook');
  return { status: match ? 200 : 201, body: { ok: true, id: row.id, updated: !!match } };
}

/** A sample delivery for "Send test": the first row, or made-up values from the field names. */
export function testPayload(t: DataTable, a: Extract<TableAction, { kind: 'webhook' }>) {
  const r = rows().find((x) => x.tableId === t.id) ?? newRow(t, Object.fromEntries(t.fields.filter((f) => f.type === 'text').map((f) => [f.id, `Test ${f.name.toLowerCase()}`])), 'test');
  return hookPayload(t, r, a, 'test', usersOf(t.workspaceId));
}

/** A CSV import: the table's fields (with any new ones), new rows, and rows updated because they matched. */
export function importRows(env: Env, tableId: string, me: string, plan: { fields: TableField[]; creates: Record<string, CellValue>[]; updates: { id: string; values: Record<string, CellValue> }[]; runRules?: boolean }) {
  const t = tables().find((x) => x.id === tableId);
  if (!t) return { status: 404, body: { error: 'No such table' } };
  if (!Array.isArray(plan.fields) || !plan.fields.length || plan.creates.length + plan.updates.length > 20_000) return { status: 400, body: { error: 'That import is too big or incomplete' } };
  // Existing fields keep their kind and settings; only new fields and new choices come from the import.
  const fields = plan.fields.map((f) => {
    const before = t.fields.find((x) => x.id === f.id);
    return before ? { ...before, options: f.options ?? before.options } : f;
  });
  save(env, 'tables', [{ ...t, fields }]);
  let order = Math.max(0, ...rows().filter((x) => x.tableId === t.id).map((x) => x.order));
  const made: TableRow[] = plan.creates.map((values) => ({ ...newRow(t, values, me), order: ++order }));
  const before = new Map<string, TableRow | undefined>();
  const updated: TableRow[] = [];
  for (const u of plan.updates) {
    const r = db.getDoc('rows', u.id) as unknown as TableRow | undefined;
    if (!r || r.tableId !== t.id) continue;
    before.set(r.id, r);
    updated.push(changed(r, u.values, me));
  }
  save(env, 'rows', [...made, ...updated]);
  logTo(env, t.id, { dir: 'in', ok: true, text: `CSV import: ${made.length} added${updated.length ? `, ${updated.length} updated` : ''}` });
  if (plan.runRules) afterRowWrite(env, before, [...made, ...updated], me);
  return { status: 200, body: { ok: true, added: made.length, updated: updated.length } };
}

/* ---------- scheduled rules ---------- */

/** The weekday, hour and calendar day right now in a time zone. */
function localNow(tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}

/** Runs rules set to a schedule ("every weekday at 9:00, for rows where Follow-up is before today"): once each day it's due. */
export function runSchedules(env: Env) {
  for (const t of tables()) {
    for (const rule of (t.rules ?? []).filter((x) => x.enabled && x.on === 'schedule' && x.schedule && x.actions.length)) {
      // The rule's own time zone (set when it was made), else the company's.
      const home = companyTz(db.getDoc('workspaces', t.workspaceId) as { timeZone?: string } | undefined);
      let at;
      try {
        at = localNow(rule.schedule!.tz || home);
      } catch {
        at = localNow(home);
      }
      if (!rule.schedule!.days.includes(at.weekday) || at.hour < rule.schedule!.hour || t.ruleRuns?.[rule.id] === at.day) continue;
      const cur = db.getDoc('tables', t.id) as unknown as DataTable;
      save(env, 'tables', [{ ...cur, ruleRuns: { ...(cur.ruleRuns ?? {}), [rule.id]: at.day } }]);
      const users = usersOf(t.workspaceId);
      const ctx = { users, rowName: nameOf };
      // "today" in a filter means the rule's own today.
      const where = (rule.where ?? []).map((w) => (w.value === '@today' ? { ...w, value: at.day } : w));
      const due = rows()
        .filter((r) => r.tableId === t.id)
        .filter((r) => where.every((w) => {
          const f = t.fields.find((x) => x.id === w.fieldId);
          return !f || passes(w, f, r.values[f.id], ctx);
        }))
        .slice(0, 500);
      void (async () => {
        for (const r of due) for (const a of rule.actions.filter((x) => x.kind !== 'email' && x.kind !== 'open')) await runAction(env, a, t, r, t.createdBy, 1, 'schedule').catch(() => null);
        logTo(env, t.id, { dir: 'out', ok: true, text: `Scheduled rule “${rule.name}” ran on ${due.length} row${due.length === 1 ? '' : 's'}` });
      })();
    }
  }
}
