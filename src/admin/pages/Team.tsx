import { useEffect, useState } from 'react';
import { BellOff, Bell, MessageSquare, Pencil, Plus, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { Select } from '../../components/ui/Select';

import { rel, dateTime, post, ROLE_HINT, ROLE_LABEL, type OpRole } from '../api';
import { Badge, Confirm, CopyBtn, Dialog, Empty, Failed, Field, Initials, Loading, Page, Section, Switch, Table, Tabs, useAct, useAdmin, useApi } from '../ui';

export function Team({ tab }: { tab: string }) {
  const { go } = useAdmin();
  return (
    <Page title="Team & settings" sub="Who runs sprint2go, what they may do, and how the backend behaves.">
      <Tabs
        value={tab}
        onChange={(t) => go(`/admin/team/${t}`)}
        items={[
          { id: 'operators', label: 'Operators' },
          { id: 'replies', label: 'Saved replies' },
          { id: 'settings', label: 'Settings' },
          { id: 'audit', label: 'Audit log' },
        ]}
      />
      <div className="adm-tab-body" key={tab}>
        {tab === 'replies' ? <Replies /> : tab === 'settings' ? <Settings /> : tab === 'audit' ? <Audit /> : <Operators />}
      </div>
    </Page>
  );
}

interface Op {
  email: string;
  role: OpRole;
  addedBy: string | null;
  addedAt: string;
  totpOn: boolean;
  disabled: boolean;
  alerts: boolean;
  name: string | null;
  userId: string | null;
  color: string | null;
  hasLogin: boolean;
  lastSeen: string | null;
  sessions: number;
}
const ROLES: OpRole[] = ['owner', 'admin', 'support', 'finance', 'readonly'];

function Operators() {
  const { me, may, go } = useAdmin();
  const { data, error, reload } = useApi<{ operators: Op[]; me: string; role: OpRole }>('team');
  const act = useAct();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Op | null>(null);
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={4} />;
  const active = data.operators.filter((o) => !o.disabled);
  const canTeam = may('team');
  const roleOptions = ROLES.filter((r) => r !== 'owner' || me.role === 'owner').map((r) => ({ value: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] }));
  return (
    <>
      <Section
        title="Operators"
        hint="Everyone here signs in with two-step codes"
        actions={
          canTeam && (
            <button className="primary-btn sm" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add an operator
            </button>
          )
        }
      >
        <Table
          id="operators"
          rows={active}
          rowKey={(o) => o.email}
          onOpen={(o) => o.userId && go(`/admin/people/${o.userId}`)}
          dense
          cols={[
            {
              key: 'who',
              label: 'Person',
              width: 'minmax(0, 2fr)',
              sort: (o) => o.name ?? o.email,
              render: (o) => (
                <span className="adm-cell-main with-dot">
                  <Initials name={o.name ?? o.email} color={o.color} />
                  <span>
                    <strong>
                      {o.name ?? o.email.split('@')[0]}
                      {o.email === me.email && <Badge tone="accent">you</Badge>}
                    </strong>
                    <small>{o.email}</small>
                  </span>
                </span>
              ),
            },
            {
              key: 'role',
              label: 'Role',
              width: '150px',
              sort: (o) => ROLES.indexOf(o.role),
              render: (o) =>
                canTeam && (o.role !== 'owner' || me.role === 'owner') ? (
                  <Select value={o.role} options={roleOptions} onChange={(r) => void act(() => post('team/save', { email: o.email, role: r }), `${o.name ?? o.email} is now ${ROLE_LABEL[r as OpRole]}`).then(reload)} label="Role" />
                ) : (
                  ROLE_LABEL[o.role]
                ),
            },
            { key: '2fa', label: '2FA', width: '90px', hide: 'phone', sort: (o) => (o.totpOn ? 1 : 0), render: (o) => (o.totpOn ? <Badge tone="good">On</Badge> : <Badge tone="warn">Not yet</Badge>) },
            { key: 'seen', label: 'Last seen', width: '110px', hide: 'tablet', sort: (o) => o.lastSeen ?? '', render: (o) => <span className="muted">{!o.hasLogin ? 'not signed up' : o.lastSeen ? rel(o.lastSeen) : 'not yet'}</span> },
            {
              key: 'act',
              label: '',
              width: '110px',
              align: 'right',
              render: (o) => (
                <span className="adm-row-actions">
                  {(o.email === me.email || canTeam) && (
                    <button className="icon-btn sm" title={o.alerts ? 'Alerts on: click to stop' : 'Alerts off: click to get them'} aria-label="Alerts" onClick={() => void act(() => post('team/alerts', { email: o.email, on: !o.alerts }), o.alerts ? 'Alerts off' : 'Alerts on').then(reload)}>
                      {o.alerts ? <Bell size={14} /> : <BellOff size={14} />}
                    </button>
                  )}
                  {canTeam && o.totpOn && o.email !== me.email && (
                    <button className="icon-btn sm" title="Reset their 2FA (lost phone)" aria-label="Reset 2FA" onClick={() => void act(() => post('team/2fa-reset', { email: o.email }), `${o.email} sets up 2FA again on their next visit`).then(reload)}>
                      <ShieldOff size={14} />
                    </button>
                  )}
                  {canTeam && o.email !== me.email && (o.role !== 'owner' || me.role === 'owner') && (
                    <button className="icon-btn sm" title="Remove from the team" aria-label="Remove" onClick={() => setRemoving(o)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Section>
      <Section title="What each role may do">
        <div className="adm-roles">
          {ROLES.map((r) => (
            <div key={r} className="adm-role">
              <ShieldCheck size={15} />
              <span>
                <strong>{ROLE_LABEL[r]}</strong>
                <small>{ROLE_HINT[r]}</small>
              </span>
            </div>
          ))}
        </div>
      </Section>
      {adding && <AddOperator roleOptions={roleOptions} onClose={() => setAdding(false)} onDone={reload} />}
      {removing && <Confirm title={`Remove ${removing.name ?? removing.email}`} action="Remove" danger text="They lose the backend straight away. Their account in the app stays." onClose={() => setRemoving(null)} onConfirm={() => act(() => post('team/remove', { email: removing.email }), 'Removed from the team').then(() => (setRemoving(null), reload()))} />}
    </>
  );
}
function AddOperator({ roleOptions, onClose, onDone }: { roleOptions: { value: string; label: string; hint: string }[]; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('support');
  const [link, setLink] = useState<string | null | 'none'>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useAdmin();
  return (
    <Dialog
      title="Add an operator"
      onClose={onClose}
      foot={
        link ? (
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="ghost-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary-btn"
              disabled={busy || !email.includes('@')}
              onClick={() => {
                setBusy(true);
                post<{ link: string | null }>('team/save', { email, name, role })
                  .then((r) => (setLink(r.link ?? 'none'), onDone()))
                  .catch((e: Error) => toast(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Add
            </button>
          </>
        )
      }
    >
      {link ? (
        <div className="adm-form">
          <p className="adm-dialog-text">{link === 'none' ? 'They already have an account. Next time they open /admin they set up their two-step codes.' : 'They need an account first. Send them this link to pick a password (valid 7 days); then they open /admin and set up their two-step codes.'}</p>
          {link !== 'none' && (
            <div className="adm-linkbox">
              <code>{link}</code>
              <CopyBtn text={link} label="Copy link" />
            </div>
          )}
        </div>
      ) : (
        <div className="adm-form">
          <div className="adm-grid2">
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@sprint2go.com" autoFocus />
            </Field>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="For a new account" />
            </Field>
          </div>
          <Field label="Role">
            <Select value={role} onChange={setRole} options={roleOptions} label="Role" />
          </Field>
          <p className="adm-note">{ROLE_HINT[role as OpRole]}. If our own company is set under Settings, they join it too, so they see tickets and alerts in the app.</p>
        </div>
      )}
    </Dialog>
  );
}

function Replies() {
  const { may } = useAdmin();
  const { data, error, reload } = useApi<{ macros: { id: string; title: string; body: string; by: string; at: string }[] }>('macros');
  const [edit, setEdit] = useState<{ id?: string; title: string; body: string } | null>(null);
  const act = useAct();
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={4} />;
  return (
    <Section
      title="Saved replies"
      hint="{name} becomes their first name, {me} yours"
      actions={
        may('support') && (
          <button className="primary-btn sm" onClick={() => setEdit({ title: '', body: '' })}>
            <Plus size={13} /> New reply
          </button>
        )
      }
    >
      {data.macros.length === 0 ? (
        <Empty title="No saved replies yet" text="Answers you give again and again: how to add the MX record, how to invite a guest, how billing works." />
      ) : (
        <div className="adm-cards">
          {data.macros.map((m) => (
            <article key={m.id} className="adm-card">
              <header>
                <MessageSquare size={15} />
                <strong>{m.title}</strong>
                <span className="spacer" />
                {may('support') && (
                  <>
                    <button className="icon-btn sm" aria-label="Edit" onClick={() => setEdit(m)}>
                      <Pencil size={13} />
                    </button>
                    <button className="icon-btn sm" aria-label="Delete" onClick={() => void act(() => post('macro', { delete: m.id }), 'Deleted').then(reload)}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </header>
              <p className="adm-pre-line">{m.body}</p>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <Dialog
          title={edit.id ? 'Edit saved reply' : 'New saved reply'}
          onClose={() => setEdit(null)}
          foot={
            <>
              <button className="ghost-btn" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="primary-btn" disabled={!edit.title.trim() || !edit.body.trim()} onClick={() => void act(() => post('macro', edit), 'Saved').then((ok) => ok && (setEdit(null), reload()))}>
                Save
              </button>
            </>
          }
        >
          <div className="adm-form">
            <Field label="Title">
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="How to add the MX record" autoFocus />
            </Field>
            <Field label="Reply">
              <textarea rows={8} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder={'Hi {name},\n\n…\n\n{me}'} />
            </Field>
          </div>
        </Dialog>
      )}
    </Section>
  );
}

interface SettingsData {
  settings: { homeWorkspace: string | null; internal: string[]; slaHours: { urgent: number; paid: number; other: number }; autoSuspendDays: number; supportName: string; billing: { name: string; address: string; npwp: string; bank: string; email: string } };
  companies: { id: string; name: string }[];
  supportEmail: string;
}
function Settings() {
  const { may } = useAdmin();
  const { data, error, reload } = useApi<SettingsData>('settings');
  const act = useAct();
  const [s, setS] = useState<SettingsData['settings'] | null>(null);
  useEffect(() => {
    if (data) setS(JSON.parse(JSON.stringify(data.settings)));
  }, [data]);
  if (error) return <Failed error={error} retry={reload} />;
  if (!data || !s) return <Loading rows={6} />;
  const can = may('platform');
  const changed = JSON.stringify(s) !== JSON.stringify(data.settings);
  return (
    <div className="adm-settings">
      <Section title="Our own company" hint="We use sprint2go too">
        <div className="adm-form">
          <Field label="sprint2go’s workspace" hint="Left out of revenue and growth; operators get tickets and alerts in its bell">
            <Select value={s.homeWorkspace ?? ''} onChange={(v) => setS({ ...s, homeWorkspace: v || null })} label="Our workspace" searchable options={[{ value: '', label: 'Not set' }, ...data.companies.map((c) => ({ value: c.id, label: c.name }))]} disabled={!can} />
          </Field>
        </div>
      </Section>
      <Section title="Support">
        <div className="adm-form">
          <div className="adm-grid2">
            <Field label="Sender name on replies">
              <input value={s.supportName} onChange={(e) => setS({ ...s, supportName: e.target.value })} disabled={!can} />
            </Field>
            <Field label="Support address" hint="Set SUPPORT_EMAIL on the server to change it">
              <input value={data.supportEmail} readOnly />
            </Field>
          </div>
          <span className="adm-label">First reply within (hours)</span>
          <div className="adm-grid3">
            <Field label="Urgent">
              <input type="number" min={0.25} step={0.25} value={s.slaHours.urgent} onChange={(e) => setS({ ...s, slaHours: { ...s.slaHours, urgent: Number(e.target.value) } })} disabled={!can} />
            </Field>
            <Field label="Paying companies">
              <input type="number" min={0.25} step={0.25} value={s.slaHours.paid} onChange={(e) => setS({ ...s, slaHours: { ...s.slaHours, paid: Number(e.target.value) } })} disabled={!can} />
            </Field>
            <Field label="Everyone else">
              <input type="number" min={0.25} step={0.25} value={s.slaHours.other} onChange={(e) => setS({ ...s, slaHours: { ...s.slaHours, other: Number(e.target.value) } })} disabled={!can} />
            </Field>
          </div>
        </div>
      </Section>
      <Section title="Unpaid invoices">
        <div className="adm-form">
          <Switch label="Make companies read-only when an invoice stays unpaid" hint={s.autoSuspendDays ? `After ${s.autoSuspendDays} days overdue. They see why, and paying lifts it.` : 'Off: you decide case by case from Today.'} on={s.autoSuspendDays > 0} disabled={!can} onChange={(v) => setS({ ...s, autoSuspendDays: v ? 14 : 0 })} />
          {s.autoSuspendDays > 0 && (
            <Field label="Days overdue">
              <input type="number" min={1} max={180} value={s.autoSuspendDays} onChange={(e) => setS({ ...s, autoSuspendDays: Number(e.target.value) || 14 })} disabled={!can} />
            </Field>
          )}
        </div>
      </Section>
      <Section title="On our invoices">
        <div className="adm-form">
          <div className="adm-grid2">
            <Field label="Company name">
              <input value={s.billing.name} onChange={(e) => setS({ ...s, billing: { ...s.billing, name: e.target.value } })} placeholder="PT …" disabled={!can} />
            </Field>
            <Field label="NPWP">
              <input value={s.billing.npwp} onChange={(e) => setS({ ...s, billing: { ...s.billing, npwp: e.target.value } })} disabled={!can} />
            </Field>
          </div>
          <Field label="Address">
            <textarea rows={2} value={s.billing.address} onChange={(e) => setS({ ...s, billing: { ...s.billing, address: e.target.value } })} disabled={!can} />
          </Field>
          <div className="adm-grid2">
            <Field label="Pay to (bank)" hint="e.g. BCA 123 456 7890 a.n. PT …">
              <input value={s.billing.bank} onChange={(e) => setS({ ...s, billing: { ...s.billing, bank: e.target.value } })} disabled={!can} />
            </Field>
            <Field label="Billing email">
              <input value={s.billing.email} onChange={(e) => setS({ ...s, billing: { ...s.billing, email: e.target.value } })} disabled={!can} />
            </Field>
          </div>
        </div>
      </Section>
      {can && (
        <div className={`adm-savebar ${changed ? 'show' : ''}`} aria-hidden={!changed}>
          <span>Unsaved changes</span>
          <button className="ghost-btn sm" onClick={() => setS(JSON.parse(JSON.stringify(data.settings)))}>
            Undo
          </button>
          <button className="primary-btn sm" onClick={() => void act(() => post('settings', s), 'Settings saved').then(reload)}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

interface AuditEntry {
  id: number;
  at: string;
  operator: string;
  action: string;
  target: string | null;
  targetName: string | null;
  detail: string | null;
}
function Audit() {
  const { go } = useAdmin();
  const { data, error, reload } = useApi<{ entries: AuditEntry[] }>('audit?limit=1000');
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <Loading rows={8} />;
  const area = (a: string) => a.split('.')[0];
  const link = (e: AuditEntry) => (!e.target ? null : e.target.startsWith('t-') ? `/admin/tickets/${e.target}` : e.action.startsWith('person') ? `/admin/people/${e.target}` : e.action.startsWith('company') || e.action.startsWith('invoice') || e.action.startsWith('coupon') || e.action.startsWith('mail') ? `/admin/companies/${e.target}` : null);
  return (
    <Table
      id="audit"
      rows={data.entries}
      rowKey={(e) => String(e.id)}
      search={(e) => `${e.operator} ${e.action} ${e.targetName ?? ''} ${e.detail ?? ''}`}
      initialSort={{ key: 'at', dir: -1 }}
      dense
      views={[
        { id: 'all', label: 'Everything', test: () => true },
        { id: 'customers', label: 'Customers', test: (e) => ['company', 'person'].includes(area(e.action)) },
        { id: 'support', label: 'Support', test: (e) => ['ticket', 'macro'].includes(area(e.action)) },
        { id: 'money', label: 'Money', test: (e) => ['invoice', 'coupon', 'pricing'].includes(area(e.action)) },
        { id: 'team', label: 'Team & platform', test: (e) => ['team', 'settings', 'system', 'mail', 'error', 'flag', 'announcement', 'broadcast', 'maintenance'].includes(area(e.action)) },
      ]}
      empty={{ title: 'Nothing yet' }}
      cols={[
        { key: 'at', label: 'When', width: '130px', sort: (e) => e.at, render: (e) => <span className="muted">{dateTime(e.at)}</span> },
        { key: 'who', label: 'Who', width: 'minmax(0, 1fr)', hide: 'phone', sort: (e) => e.operator, render: (e) => <span className="adm-ellipsis">{e.operator}</span> },
        {
          key: 'what',
          label: 'What',
          width: 'minmax(0, 3fr)',
          sort: (e) => e.action,
          render: (e) => {
            const to = link(e);
            return (
              <span className="adm-cell-main">
                <strong>
                  {e.action}{' '}
                  {e.targetName &&
                    (to ? (
                      <button type="button" className="adm-link" onClick={() => go(to)}>
                        {e.targetName}
                      </button>
                    ) : (
                      e.targetName
                    ))}
                </strong>
                {e.detail && <small className="adm-wrap">{e.detail}</small>}
              </span>
            );
          },
        },
      ]}
    />
  );
}
