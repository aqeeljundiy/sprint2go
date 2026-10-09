// Tables, checked two ways.
//  1. The table logic (src/components/tables/core.ts) and the server's engine (server/tables.ts), in this process on a
//     throwaway data folder: filters with groups, each person's own filters and sorts, colour rules, the filter
//     sheet's counts, row templates and the ones that repeat (made once each day they're due, rules run on them).
//  2. The server's rules, end to end (the server on a throwaway folder and free ports, demo data): a member who may
//     not change how tables work keeps the views, the row page and the templates as they are while her rows still
//     save; her own filters live in her prefs; the owner saves a view for everyone; a guest sees only views that point
//     at fields she may see, and can't change the table.
//   node --import ./server/register.mjs scripts/tables-tests.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const unitDir = mkdtempSync(join(tmpdir(), 's2g-tables-unit-'));
process.env.S2G_DATA = unitDir;

let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message.split('\n').join('\n     ') : e}`);
  }
};

/* ---------- 1. the logic ---------- */

const core = await import('../src/components/tables/core.ts');
const users = [
  { id: 'u-a', name: 'Ana', email: 'ana@x.example' },
  { id: 'u-b', name: 'Budi', email: 'budi@x.example' },
];
const opt = (id, label, color = '#3b82f6') => ({ id, label, color });
const table = {
  id: 't1',
  workspaceId: 'w1',
  name: 'Leads',
  color: '#111',
  fields: [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'status', name: 'Status', type: 'select', options: [opt('new', 'New'), opt('won', 'Won', '#10b981'), opt('lost', 'Lost', '#64748b')] },
    { id: 'owner', name: 'Owner', type: 'person' },
    { id: 'value', name: 'Value', type: 'money', currency: 'IDR' },
    { id: 'due', name: 'Follow-up', type: 'date' },
    { id: 'made', name: 'Made', type: 'created' },
  ],
  views: [{ id: 'v1', name: 'All', kind: 'grid' }],
  createdBy: 'u-a',
  createdAt: '2026-01-01T00:00:00Z',
};
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const row = (id, values, order = 1) => ({ id, workspaceId: 'w1', tableId: 't1', values: { name: id, ...values }, order, createdBy: 'u-a', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
const rows = [
  row('r1', { status: 'new', owner: 'u-a', value: 100, due: day(-2) }, 1),
  row('r2', { status: 'won', owner: 'u-b', value: 500, due: day(0) }, 2),
  row('r3', { status: 'new', owner: 'u-b', value: 50, due: day(3) }, 3),
  row('r4', { status: 'lost', value: 900 }, 4),
];
const ctx = { users, rowName: () => '', me: 'u-a' };
const names = (v, q = '') => core.visibleRows(table, v, rows, q, ctx).map((r) => r.id).join(',');

await test('Filters: a group of "any" inside "all" (Status is New, and Owner is me or Value over 400)', () => {
  const v = { ...table.views[0], filterMode: 'and', filters: [{ fieldId: 'status', op: 'not', value: 'lost' }], filterGroups: [{ id: 'g', mode: 'or', filters: [{ fieldId: 'owner', op: 'is', value: '@me' }, { fieldId: 'value', op: 'gt', value: '400' }] }] };
  assert.equal(names(v), 'r1,r2');
  assert.equal(core.filterCount(table, v), 3);
});
await test('Filters: "any" at the top joins a condition and a group', () => {
  const v = { ...table.views[0], filterMode: 'or', filters: [{ fieldId: 'status', op: 'is', value: 'lost' }], filterGroups: [{ id: 'g', mode: 'and', filters: [{ fieldId: 'owner', op: 'is', value: 'u-b' }, { fieldId: 'value', op: 'lt', value: '100' }] }] };
  assert.equal(names(v), 'r3,r4');
});
await test('Filters: an empty group and an unfinished condition filter nothing', () => {
  const v = { ...table.views[0], filters: [{ fieldId: 'status', op: 'is' }], filterGroups: [{ id: 'g', mode: 'and', filters: [] }] };
  assert.equal(names(v), 'r1,r2,r3,r4');
  assert.equal(core.filterCount(table, v), 0);
});
await test('Filters: "today" and "me" fill in for whoever is looking', () => {
  assert.equal(names({ ...table.views[0], filters: [{ fieldId: 'due', op: 'lt', value: '@today' }] }), 'r1');
  assert.equal(names({ ...table.views[0], filters: [{ fieldId: 'due', op: 'is', value: '@today' }] }), 'r2');
  assert.equal(core.visibleRows(table, { ...table.views[0], filters: [{ fieldId: 'owner', op: 'is', value: '@me' }] }, rows, '', { ...ctx, me: 'u-b' }).map((r) => r.id).join(','), 'r2,r3');
});
await test('Own filters and sorts: shown on top of the view, and only "different" when they are', () => {
  const view = { ...table.views[0], filters: [{ fieldId: 'status', op: 'is', value: 'new' }] };
  assert.equal(core.tweakDiffers(view, null), false);
  assert.equal(core.tweakDiffers(view, { filters: [{ fieldId: 'status', op: 'is', value: 'new' }] }), false);
  const tw = { filters: [], sorts: [{ fieldId: 'value', dir: 'desc' }] };
  assert.equal(core.tweakDiffers(view, tw), true);
  const mine = core.withTweak(view, tw);
  assert.equal(names(mine), 'r4,r2,r1,r3');
  assert.equal(view.filters.length, 1, 'the shared view is left alone');
});
await test('Colour rules: the first matching row rule tints the row, cell rules tint their own field', () => {
  const v = { ...table.views[0], colors: [{ id: 'c1', when: { fieldId: 'status', op: 'is', value: 'won' }, color: '#10b981', target: 'row' }, { id: 'c2', when: { fieldId: 'value', op: 'gt', value: '400' }, color: '#ef4444', target: 'cell' }, { id: 'c3', when: { fieldId: 'status', op: 'filled' }, color: '#000', target: 'row' }] };
  assert.deepEqual(core.rowColors(table, v, rows[1], ctx), { row: '#10b981', cells: { value: '#ef4444' } });
  assert.deepEqual(core.rowColors(table, v, rows[0], ctx), { row: '#000', cells: {} });
});
await test('Filter sheet: values with counts among what the other conditions let through', () => {
  const v = { ...table.views[0], filters: [{ fieldId: 'owner', op: 'is', value: 'u-b' }] };
  const q = core.quickFilters(table, v, rows, ctx);
  const status = q.find((s) => s.field.id === 'status');
  assert.deepEqual(status.items.map((i) => `${i.label} ${i.count}`), ['New 1', 'Won 1']);
  const owner = q.find((s) => s.field.id === 'owner');
  assert.equal(owner.items[0].label, 'Me');
  assert.equal(owner.items[0].count, 1, 'the owner filter itself is left out of its own counts');
  assert.equal(owner.items.find((i) => i.label === 'Budi').on, true);
  const due = q.find((s) => s.field.id === 'due');
  assert.deepEqual(due.items.map((i) => `${i.label} ${i.count}`), ['Today 1', 'Later 1']);
});
await test('Templates: values with "today" and "me" filled in, only fields that can be typed', () => {
  const tpl = { id: 'tp', name: 'Hot lead', values: { status: 'new', owner: '@me', due: '@today', made: 'x', gone: 'y' } };
  assert.deepEqual(core.templateValues(table, tpl, 'u-b', '2026-10-09'), { status: 'new', owner: 'u-b', due: '2026-10-09' });
});
await test('Repeating templates: due on the right days, from the hour, once a day', () => {
  const at = (d, hour) => ({ day: d, hour, weekday: new Date(`${d}T12:00`).getDay() });
  const weekly = { every: 'week', days: [1], hour: 9, tz: 'Asia/Jakarta', from: '2026-10-01' };
  assert.equal(core.templateDue(weekly, at('2026-10-12', 9)), true, 'a Monday at 9');
  assert.equal(core.templateDue(weekly, at('2026-10-12', 8)), false, 'not before 9');
  assert.equal(core.templateDue(weekly, at('2026-10-13', 10)), false, 'not on a Tuesday');
  assert.equal(core.templateDue(weekly, at('2026-10-12', 11), '2026-10-12'), false, 'not twice a day');
  assert.equal(core.templateDue({ ...weekly, from: '2026-10-20' }, at('2026-10-12', 9)), false, 'not before it starts');
  const monthly = { every: 'month', hour: 0, tz: 'UTC', from: '2026-01-31' };
  assert.equal(core.templateDue(monthly, at('2026-02-28', 1)), true, 'the 31st runs on the last day of February');
  assert.equal(core.templateDue(monthly, at('2026-03-30', 1)), false);
  assert.equal(core.templateDue(monthly, at('2026-03-31', 1)), true);
  const weekdays = { every: 'day', days: [1, 2, 3, 4, 5], hour: 9, tz: 'UTC', from: '2026-01-01' };
  assert.equal(core.templateDue(weekdays, at('2026-10-10', 9)), false, 'not on a Saturday');
  assert.equal(core.repeatWords(weekdays), 'Every weekday at 09:00');
  assert.equal(core.repeatWords(weekly), 'Every week on Monday at 09:00');
  assert.equal(core.repeatWords(monthly), 'Every month on the 31st at 00:00');
});

const db = await import('../server/db.ts');
const engine = await import('../server/tables.ts');
await test('Repeating templates on the server: one row each day it is due, rules run on it, the log says so', () => {
  const sent = [];
  const env = { broadcast: (coll, up) => sent.push([coll, up.length]) };
  db.writeDocs('workspaces', [{ id: 'w1', name: 'W', members: [{ userId: 'u-a', role: 'owner' }], accounts: [] }], [], null);
  db.writeDocs('users', users, [], null);
  const t = {
    ...table,
    templates: [{ id: 'tp1', name: 'Weekly report', values: { name: 'Weekly report', status: 'new', due: '@today' }, repeat: { every: 'week', days: [1], hour: 9, tz: 'Asia/Jakarta', from: '2026-10-01' } }],
    rules: [{ id: 'ru', name: 'Owner on new rows', on: 'created', enabled: true, actions: [{ kind: 'set', values: { owner: 'u-b' } }] }],
  };
  db.writeDocs('tables', [t], [], null);
  const monday = () => ({ day: '2026-10-12', hour: 9, weekday: 1 });
  engine.runTemplates(env, monday);
  engine.runTemplates(env, monday);
  engine.runTemplates(env, () => ({ day: '2026-10-13', hour: 9, weekday: 2 }));
  const made = db.allDocs('rows').filter((r) => r.tableId === 't1');
  assert.equal(made.length, 1, 'made once');
  assert.equal(made[0].values.name, 'Weekly report');
  assert.equal(made[0].values.due, '2026-10-12', '"today" is the template\'s own day');
  assert.equal(made[0].createdBy, 'u-a', 'added as the table\'s maker');
  const after = db.getDoc('tables', 't1');
  assert.equal(after.templateRuns.tp1, '2026-10-12');
  assert.ok(after.log.some((l) => l.text.includes('Weekly report')), 'the log says what it added');
  return new Promise((res) => setTimeout(res, 50)).then(() => assert.equal(db.getDoc('rows', made[0].id).values.owner, 'u-b', 'the table\'s rules ran on it'));
});

/* ---------- 2. the server's rules ---------- */

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 's2g-tables-'));
const [httpPort, smtpPort] = [await freePort(), await freePort()];
const env = { ...process.env, NODE_ENV: 'development', S2G_DATA: dir, PORT: String(httpPort), HOST: '127.0.0.1', MAIL_PORT: String(smtpPort), MAIL_HOST: 'localhost', SEED_PASSWORD: randomBytes(12).toString('hex'), SES_KEY: '', SES_SECRET: '', MAIL_FROM: '', S3_BUCKET: '', CF_DNS_TOKEN: '', PUBLIC_URL: '', RECORDER_URL: '', MAIL_RELAY_URL: '' };
const server = spawn(process.execPath, ['--import', './server/register.mjs', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (b) => (log += b));
server.stderr.on('data', (b) => (log += b));
const finish = (code) => {
  server.kill('SIGTERM');
  for (const d of [dir, unitDir]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the server may still hold a file for a moment */
    }
  }
  if (code) console.log(`\nServer log:\n${log.split('\n').slice(-30).join('\n')}`);
  process.exit(code);
};
setTimeout(() => (console.log('FAIL timed out'), finish(1)), 120_000).unref();

try {
  for (let i = 0; i < 300 && !/Mail: receiving|sprint2go on http/.test(log); i++) {
    if (server.exitCode !== null) break;
    await sleep(100);
  }
  await test('the server starts', () => assert.match(log, /sprint2go on http/));
  const base = `http://127.0.0.1:${httpPort}`;
  const signIn = async (email) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: env.SEED_PASSWORD }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
      ok: r.ok,
      state: () => call('GET', '/api/state').then((x) => x.json()),
      sync: (coll, upserts, deletes = []) => call('POST', '/api/sync', { coll, upserts, deletes }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })),
    };
  };
  const aqeel = await signIn('aqeel@pixelandprofits.com');
  const dewi = await signIn('dewi@pixelandprofits.com');
  const nadia = await signIn('nadia@kopikita.co.id');
  await test('the owner, a member and a guest sign in', () => assert.ok(aqeel.ok && dewi.ok && nadia.ok));

  const tableOf = async (who, id) => (await who.state()).tables.find((t) => t.id === id);
  const s0 = await aqeel.state();
  const pnp = s0.workspaces.find((w) => w.id === 'pnp');
  // A company table Dewi didn't make, with a template and a row page layout, and the company's "Change how tables work" off.
  const t0 = s0.tables.find((t) => !t.clientId && t.workspaceId === 'pnp');
  const first = t0.fields[0].id;
  await aqeel.sync('tables', [{ ...t0, templates: [{ id: 'tp', name: 'Idea', values: {} }], page: { pinned: [t0.fields[1].id] } }]);
  await aqeel.sync('workspaces', [{ ...pnp, permissions: { ...(pnp.permissions ?? {}), editTables: false } }]);

  const before = await tableOf(dewi, t0.id);
  await test('a member without "Change how tables work" sees the table', () => assert.ok(before));
  const changed = { ...before, name: before.name, views: before.views.map((v, i) => (i === 0 ? { ...v, filters: [{ fieldId: first, op: 'filled' }], sorts: [{ fieldId: first, dir: 'desc' }] } : v)), page: { pinned: [] }, templates: [], templateRuns: { tp: '2099-01-01' } };
  await dewi.sync('tables', [changed]);
  const after = await tableOf(aqeel, t0.id);
  await test('…her filter and sort on a shared view don\'t change it for everyone', () => assert.deepEqual(after.views, before.views));
  await test('…nor the row page layout or the templates', () => {
    assert.deepEqual(after.page, { pinned: [t0.fields[1].id] });
    assert.equal(after.templates?.length, 1);
  });
  await test('…and the server\'s own record of repeating templates can\'t be written from an app', () => assert.equal(after.templateRuns?.tp, undefined));

  const someRow = (await dewi.state()).rows.find((r) => r.tableId === t0.id);
  await dewi.sync('rows', [{ ...someRow, values: { ...someRow.values, [first]: 'Changed by Dewi' } }]);
  await test('…while her changes to rows still save', async () => assert.equal((await aqeel.state()).rows.find((r) => r.id === someRow.id).values[first], 'Changed by Dewi'));

  const key = `s2g-table-mine:${t0.id}`;
  const mine = { [before.views[0].id]: { filters: [{ fieldId: first, op: 'filled' }] } };
  await dewi.sync('prefs', [{ id: 'u-dewi', value: { [key]: mine } }]);
  await test('her own filters are kept in her prefs, for her only', async () => {
    const d = await dewi.state();
    assert.deepEqual(d.prefs.find((p) => p.id === 'u-dewi')?.value?.[key], mine);
    const a = await aqeel.state();
    assert.ok(!a.prefs.some((p) => p.id === 'u-dewi'), 'nobody else gets her prefs');
  });
  await dewi.sync('prefs', [{ id: 'u-aqeel', value: { [key]: mine } }]);
  await test('nobody writes someone else\'s prefs', async () => assert.equal((await aqeel.state()).prefs.find((p) => p.id === 'u-aqeel')?.value?.[key], undefined));

  // "Save for everyone": the owner, and then a member once the company allows it.
  const saved = { ...after, views: after.views.map((v, i) => (i === 0 ? { ...v, filters: [{ fieldId: first, op: 'filled' }] } : v)) };
  await aqeel.sync('tables', [saved]);
  await test('the owner saves a view\'s filter for everyone', async () => assert.deepEqual((await tableOf(dewi, t0.id)).views[0].filters, [{ fieldId: first, op: 'filled' }]));
  await aqeel.sync('workspaces', [{ ...(await aqeel.state()).workspaces.find((w) => w.id === 'pnp'), permissions: { ...(pnp.permissions ?? {}), editTables: true } }]);
  const allowed = await tableOf(dewi, t0.id);
  await dewi.sync('tables', [{ ...allowed, views: allowed.views.map((v, i) => (i === 0 ? { ...v, filters: [] } : v)) }]);
  await test('with "Change how tables work" on, a member saves a view for everyone too', async () => assert.deepEqual((await tableOf(aqeel, t0.id)).views[0].filters, []));

  // A table shared with KopiKita's guests: they see Name and Status, not Value.
  const kopi = { id: 'tb-kopi', workspaceId: 'pnp', name: 'Shoots', color: '#111', clientId: 'c-kopikita', createdBy: 'u-aqeel', createdAt: new Date().toISOString(),
    fields: [{ id: 'k-name', name: 'Name', type: 'text' }, { id: 'k-status', name: 'Status', type: 'select', options: [opt('a', 'Planned')] }, { id: 'k-value', name: 'Value', type: 'money' }],
    views: [{ id: 'kv', name: 'All', kind: 'grid', filters: [{ fieldId: 'k-value', op: 'gt', value: '1000' }], filterGroups: [{ id: 'g', mode: 'or', filters: [{ fieldId: 'k-value', op: 'lt', value: '5' }, { fieldId: 'k-status', op: 'filled' }] }], colors: [{ id: 'c', when: { fieldId: 'k-value', op: 'gt', value: '99' }, color: '#f00', target: 'row' }], sorts: [{ fieldId: 'k-value', dir: 'asc' }], subGroupBy: 'k-value' }],
    templates: [{ id: 'kt', name: 'Secret', values: { 'k-value': 5 } }],
    page: { pinned: ['k-status', 'k-value'], sections: [{ id: 's', name: 'Money', fields: ['k-value'] }] },
    share: { enabled: true, fields: ['k-status'], edit: [], buttons: [] } };
  await aqeel.sync('tables', [kopi]);
  const g = await tableOf(nadia, 'tb-kopi');
  await test('a guest gets the shared table', () => assert.ok(g));
  await test('…with no view pointing at a field she can\'t see (filters, groups, colours, sorts, sub-groups)', () => {
    const v = g.views[0];
    assert.deepEqual(v.filters, []);
    assert.deepEqual(v.filterGroups, [{ id: 'g', mode: 'or', filters: [{ fieldId: 'k-status', op: 'filled' }] }]);
    assert.deepEqual(v.colors, []);
    assert.deepEqual(v.sorts, []);
    assert.equal(v.subGroupBy, undefined);
  });
  await test('…and no templates or page sections, only the pinned fields she sees', () => {
    assert.equal(g.templates, undefined);
    assert.deepEqual(g.page.pinned, ['k-status']);
    assert.equal(g.page.sections, undefined);
  });
  await nadia.sync('tables', [{ ...g, views: [{ ...g.views[0], filters: [{ fieldId: 'k-status', op: 'empty' }] }] }]);
  await test('…and her changes to the table itself are refused', async () => assert.deepEqual((await tableOf(aqeel, 'tb-kopi')).views[0].filters, kopi.views[0].filters));
  await nadia.sync('prefs', [{ id: 'cu-nadia-c-kopikita', value: { 's2g-table-mine:tb-kopi': { kv: { filters: [{ fieldId: 'k-status', op: 'empty' }] } } } }]);
  await test('…while her own filters save in her own prefs', async () => assert.ok((await nadia.state()).prefs.find((p) => p.id === 'cu-nadia-c-kopikita')?.value?.['s2g-table-mine:tb-kopi']));
} catch (e) {
  failed++;
  console.log('FAIL', e);
}

console.log(failed ? `\n${failed} failed` : '\nAll table checks passed');
finish(failed ? 1 : 0);
